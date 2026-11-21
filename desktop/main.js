'use strict';

/*
 * main.js — Electron main process for NormalMap Desktop.
 *
 * Owns: window lifecycle, the app:// renderer protocol, native dialogs,
 * every disk write, and the runtime network lockdown.
 * Does NOT own: any image maths. All normals/AO/specular work stays in the
 * original renderer code (see docs/ARCHITECTURE.md).
 */

const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, Tray, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const appProtocol = require('./app-protocol');
const saveManager = require('./save-manager');
const { createPlanner } = require('./export-plan');
const { PresetStore } = require('./presets-store');
const { startAgentServer, writeDiscoveryFile, removeDiscoveryFile } = require('./agent-server');
const { createAgentCommands } = require('./agent-commands');


const APP_ORIGIN = appProtocol.APP_ORIGIN;
const IS_DEV = !app.isPackaged;

/*
 * Test-harness opt-in, deliberately two-factor:
 *   1. NMO_TEST_MODE must be set, and
 *   2. a packaged build additionally needs a flag file next to the exe.
 *
 * An environment variable alone must not be able to turn the shipped app into
 * a script runner: env vars can be inherited or planted by a launcher, while
 * the flag file sits in the install folder, which already implies write access
 * to the binary itself. `npm run test:packaged` creates the flag right before
 * launching and deletes it in a finally block; build/pack.js refuses to leave
 * one behind in a release folder.
 */
const TEST_FLAG_PATH = path.join(path.dirname(app.getPath('exe')), 'nmo-test.flag');
const IS_TEST =
  Boolean(process.env.NMO_TEST_MODE) && (IS_DEV || fs.existsSync(TEST_FLAG_PATH));

/*
 * --profile=<dir>：把 userData（编号库、预设、Agent 令牌）指到别处。
 * 用于便携部署、并行测试；测试模式自己的临时 profile 优先级更高。
 */
const PROFILE_ARG = process.argv.slice(1).find((a) => a.startsWith('--profile='));
if (PROFILE_ARG) {
  const dir = path.resolve(PROFILE_ARG.slice('--profile='.length));
  fs.mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
}

/*
 * Test runs get a throwaway profile directory.
 *
 * The shipped app owns %APPDATA%\normalmap-desktop. A test drive that shares it
 * collides with any copy the user happens to have open: Chromium cannot take
 * the cache over ("Unable to move the cache", expiring in a silent exit) and
 * the single-instance lock makes the new process quit before a window exists,
 * so the harness never writes a result. A per-process profile keeps the two
 * apart without changing anything for normal launches.
 */
const TEST_PROFILE = IS_TEST
  ? path.join(
      require('node:os').tmpdir(),
      // 随机后缀：PID 会被复用，撞上上次残留的编号库会让“001 起步”的断言失真。
      'nmo-test-profile-' + process.pid + '-' + require('node:crypto').randomBytes(4).toString('hex')
    )
  : null;
if (TEST_PROFILE) {
  try {
    fs.rmSync(TEST_PROFILE, { recursive: true, force: true });
  } catch {
    /* a leftover profile from a killed run must not break the new one */
  }
  app.setPath('userData', TEST_PROFILE);
}

/** Requests cancelled by the runtime network lockdown. */
const blockedRequests = [];

/*
 * Agent 模式（--agent）：
 *   - 窗口创建后不显示，托盘常驻；
 *   - 本机 127.0.0.1 上开一个带令牌的 HTTP 桥，命令白名单见 agent-commands.js；
 *   - 关窗口 = 收进托盘，只有托盘菜单的“退出”才真正结束进程。
 * 不加这个参数时，行为与旧版完全一致。
 */
const ARGV = process.argv.slice(1);
const AGENT_REQUESTED = ARGV.some((a) => a === '--agent' || a === '--agent=1');
/*
 * --agent-out=<dir>：导出目录白名单。
 * 给了就只允许 export / batch 往这个目录（含子目录）写，别处一律拒绝。
 * 不给则保持原行为（可写任意可写目录）。
 */
const AGENT_PORT = (() => {
  const hit = ARGV.find((a) => a.startsWith('--agent-port='));
  const value = hit ? Number(hit.slice('--agent-port='.length)) : 0;
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : 0;
})();

let agentRuntime = null; // { server, token, port, file }
let agentTray = null;
let agentLastActivity = null;
let agentActivityTimer = null;
let isQuitting = false;
/** Last folder the user exported to, reused as the next default (memory only). */
let lastExportDir = null;
/** Active batch sessions: token -> { dir, written, renamed, failed, names } */
const batchSessions = new Map();

// ---------------------------------------------------------------------------
// Number library + planned export (see library-store.js / export-plan.js)
// The store is created lazily because app.getPath('userData') is only final
// after the app is ready.
// ---------------------------------------------------------------------------
const planner = createPlanner({
  dialogs: {
    async chooseFolder(suggestedName) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择导出文件夹',
        defaultPath: lastExportDir || app.getPath('pictures'),
        buttonLabel: '导出到这里',
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || !result.filePaths.length) {
        return { ok: false, canceled: true, suggestedName: suggestedName };
      }
      const dir = path.resolve(result.filePaths[0]);
      lastExportDir = dir;
      return { ok: true, dir: dir };
    }
  }
});

/** Import previews are held in memory only; the payload is never executed. */
const importPreviews = new Map();
const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

let presetStore = null;
function getPresets() {
  if (!presetStore) {
    presetStore = new PresetStore({ dir: path.join(app.getPath('userData'), 'library') });
  }
  return presetStore;
}

appProtocol.registerSchemePrivileges();

if (process.platform === 'win32') {
  app.setAppUserModelId('local.normalmap.desktop');
}

// ---------------------------------------------------------------------------
// Single instance: a second launch focuses the existing window instead of
// spawning another Electron process tree.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null, agentWindow = null;

function createWindow(options) {
  const opts = options || {};
  const win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#101010',
    title: 'NormalMap Desktop',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: IS_DEV
    }
  });

  win.once('ready-to-show', () => {
    if (!opts.hidden) win.show();
  });

  /* Agent 常驻：关窗口只是收进托盘，否则后台服务会跟着窗口一起没。 */
  win.on('close', (event) => {
    if (agentRuntime && !isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  // The page must never navigate away from the bundled renderer.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN + '/')) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.loadURL(`${APP_ORIGIN}/index.html${opts.worker ? '?worker=1' : ''}`);
  return win;
}

// ---------------------------------------------------------------------------
// External links: only user-initiated clicks on http(s) reach the OS browser.
// ---------------------------------------------------------------------------
function openExternalSafely(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.protocol === 'http:') {
    // Upgrade plain http links to https; the original site links are all
    // https-capable and this avoids sending anything in clear text.
    url.protocol = 'https:';
  }
  shell.openExternal(url.toString());
  return true;
}

// ---------------------------------------------------------------------------
// Agent bridge: loopback-only HTTP with a random token, plus a tray icon so a
// background instance can still be found, opened and quit.
// ---------------------------------------------------------------------------
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/*
 * 把 Agent 的活动同时送到三个地方：
 *   1. 页面角落的小徽标（用户能看见“AI 正在做什么”）；
 *   2. 托盘 tooltip（窗口藏起来时也能看见）；
 *   3. 内存里的 lastActivity（页面后来才加载时用 getAgentState 补上）。
 */
function notifyAgentActivity(payload) {
  agentLastActivity = Object.assign({ at: Date.now() }, payload || {});
  if (agentTray) {
    const label = payload && payload.cmd ? 'AI 正在执行 ' + payload.cmd : 'Agent 运行中';
    agentTray.setToolTip('NormalMap Desktop · ' + label);
    clearTimeout(agentActivityTimer);
    agentActivityTimer = setTimeout(() => {
      if (agentTray) agentTray.setToolTip('NormalMap Desktop · Agent 运行中');
    }, 4000);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('nmo:agent-activity', agentLastActivity);
  }
}

function createAgentTray() {
  if (agentTray) return;
  const iconPath = path.join(__dirname, '..', 'renderer', 'images', 'favicon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16, quality: 'best' });
  agentTray = new Tray(icon);
  agentTray.setToolTip('NormalMap Desktop · Agent 运行中');
  agentTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开窗口', click: showMainWindow },
      {
        label: '隐藏窗口',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  agentTray.on('double-click', showMainWindow);
}

async function enableAgent(argv = ARGV) {
  if (agentRuntime) return agentRuntime;
  if (!mainWindow) return null;

  const token = crypto.randomBytes(24).toString('hex');
  agentWindow = createWindow({hidden:true,worker:true});
  const roots = argv.filter(a=>a.startsWith("--agent-out=")).map(a=>a.slice(12)).filter(p=>path.isAbsolute(p));
  const commands = createAgentCommands({
    getWindow: () => agentWindow,
    guiWindow: () => mainWindow,
    planner,
    version: app.getVersion(),
    logDir: app.getPath('userData'),
    outDir: roots,
    onActivity: notifyAgentActivity,
    quit: () => {
      isQuitting = true;
      app.quit();
    }
  });
  const server = await startAgentServer({ commands: commands, token: token, port: AGENT_PORT });

  const file = path.join(app.getPath('userData'), 'agent.json');
  writeDiscoveryFile(file, {
    product: 'NormalMap Desktop',
    version: app.getVersion(),
    pid: process.pid,
    host: server.host,
    port: server.port,
    token: token,
    outDir: roots,
    startedAt: new Date().toISOString(),
    commands: commands.list()
  });

  agentRuntime = { server: server, token: token, port: server.port, file: file };
  createAgentTray();
  notifyAgentActivity({ state: 'connected' });
  console.log(
    'Agent bridge: http://' + server.host + ':' + server.port + '  (token file: ' + file + ')'
  );
  return agentRuntime;
}

function stopAgent() {
  if (!agentRuntime) return;
  notifyAgentActivity({ state: 'stopped' });
  removeDiscoveryFile(agentRuntime.file);
  agentRuntime.server.close().catch(() => {});
  agentRuntime = null;
  if (agentTray) {
    agentTray.destroy();
    agentTray = null;
  }
}

// ---------------------------------------------------------------------------
// Runtime network lockdown.
// Every scheme other than app: (and devtools:) is cancelled. This is the
// enforcement point behind the "no CDN, no telemetry" requirement, and the
// log doubles as evidence.
// ---------------------------------------------------------------------------
function installNetworkLockdown() {
  const ses = session.defaultSession;

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    blockedRequests.push({
      url: details.url,
      resourceType: details.resourceType,
      at: new Date().toISOString()
    });
    callback({ cancel: true });
  });

  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

  // No downloads through the Chromium download manager: writes go through
  // save-manager so the user always sees a native dialog.
  ses.on('will-download', (event) => {
    event.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// IPC guard: only our own renderer, loaded from app://nmo, may call in.
// ---------------------------------------------------------------------------
function assertTrustedSender(event) {
  const frameUrl = event.senderFrame ? event.senderFrame.url : '';
  if (!frameUrl.startsWith(APP_ORIGIN + '/')) {
    throw new Error('Rejected IPC call from untrusted frame: ' + (frameUrl || '<none>'));
  }
  if (![mainWindow, agentWindow].some(win => win && !win.isDestroyed() && event.sender === win.webContents)) {
    throw new Error('Rejected IPC call from an unknown window.');
  }
}

function toUint8(record) {
  if (!record || typeof record !== 'object') return record;
  return record;
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('nmo:save-single', async (event, record) => {
    assertTrustedSender(event);
    const validated = saveManager.validateRecord(record, 0);
    if (!validated.ok) {
      return { ok: false, canceled: false, error: validated.error };
    }

    const ext = saveManager.IMAGE_TYPES[validated.type].ext;
    const defaultPath = path.join(
      lastExportDir || app.getPath('pictures'),
      validated.baseName + ext
    );

    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存图片',
      defaultPath,
      filters: saveManager.DIALOG_FILTERS[validated.type],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    let target = path.resolve(result.filePath);

    /*
     * A save dialog lets the user type any name, including one that lies about
     * the bytes: choosing "photo.jpg" while the canvas was encoded as PNG would
     * write a PNG into a .jpg. The filter is a convenience, not a guarantee.
     *
     * So the extension is reconciled with the actual encoding before writing.
     * If that changes the name, the user confirms against the *final* path
     * (including its own overwrite warning), never silently and never against
     * a path that is not the one being written.
     */
    const requestedExt = path.extname(target).toLowerCase();
    const actualExt = saveManager.canonicalExtension(validated.type);
    let notice = '';

    if (!saveManager.extensionMatches(validated.type, requestedExt)) {
      const finalTarget = requestedExt
        ? target.slice(0, -requestedExt.length) + actualExt
        : target + actualExt;
      const willReplace = fs.existsSync(finalTarget);
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '文件名与图片格式不一致',
        message:
          '本次导出的是 ' + validated.type.toUpperCase() + '，但文件名' +
          (requestedExt ? '以 "' + requestedExt + '" 结尾' : '没有扩展名') + '。',
        detail:
          '将保存为：\n' + path.basename(finalTarget) +
          (willReplace ? '\n\n该文件已存在，将被替换。' : ''),
        buttons: ['保存为 ' + path.basename(finalTarget), '取消'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (answer.response !== 0) {
        return { ok: false, canceled: true };
      }
      target = finalTarget;
      notice =
        '扩展名已改为 ' + actualExt + '，与 ' + validated.type.toUpperCase() + ' 数据一致。';
    }

    lastExportDir = path.dirname(target);
    try {
      fs.writeFileSync(target, validated.bytes, { flag: 'w' });
      return {
        ok: true,
        canceled: false,
        path: target,
        fileName: path.basename(target),
        ext: path.extname(target).toLowerCase(),
        bytes: validated.bytes.length,
        notice: notice
      };
    } catch (err) {
      return { ok: false, canceled: false, error: saveManager.describeFsError(err) };
    }
  });

  ipcMain.handle('nmo:begin-batch', async (event, options) => {
    assertTrustedSender(event);
    const suggested = saveManager.sanitizeBaseName(options && options.suggestedName, 'NormalMap');

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder for the exported maps',
      defaultPath: lastExportDir || app.getPath('pictures'),
      buttonLabel: 'Export here',
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || !result.filePaths.length) {
      return { canceled: true };
    }

    const dir = path.resolve(result.filePaths[0]);
    lastExportDir = dir;

    // Writability check up front, so a long batch does not fail at the end.
    try {
      const probe = path.join(dir, `.nmo-write-probe-${process.pid}-${Date.now()}`);
      fs.writeFileSync(probe, 'ok', { flag: 'wx' });
      fs.unlinkSync(probe);
    } catch (err) {
      return { canceled: false, error: saveManager.describeFsError(err) };
    }

    const token = crypto.randomUUID();
    batchSessions.set(token, {
      dir,
      createdAt: Date.now(),
      suggested,
      written: 0,
      renamed: 0,
      failed: 0,
      files: [],
      errors: []
    });

    return { canceled: false, token, dir };
  });

  ipcMain.handle('nmo:write-batch-file', async (event, token, record) => {
    assertTrustedSender(event);
    const sessionInfo = batchSessions.get(token);
    if (!sessionInfo) {
      return { ok: false, error: 'Export session expired. Start the export again.' };
    }

    const validated = saveManager.validateRecord(record, sessionInfo.written);
    if (!validated.ok) {
      sessionInfo.failed += 1;
      sessionInfo.errors.push(validated.error);
      return { ok: false, error: validated.error };
    }

    const written = saveManager.safeWriteRecord(sessionInfo.dir, validated);
    if (!written.ok) {
      sessionInfo.failed += 1;
      sessionInfo.errors.push(`${written.fileName}: ${written.error}`);
      return written;
    }

    sessionInfo.written += 1;
    if (written.renamed) sessionInfo.renamed += 1;
    sessionInfo.files.push(written.fileName);
    return written;
  });

  ipcMain.handle('nmo:end-batch', async (event, token) => {
    assertTrustedSender(event);
    const sessionInfo = batchSessions.get(token);
    if (!sessionInfo) {
      return { ok: false, error: 'Export session expired.' };
    }
    batchSessions.delete(token);
    return {
      // Writing nothing is not success: it means every item failed before or
      // during the write, and the page needs to see that as a failure.
      ok: sessionInfo.failed === 0 && sessionInfo.written > 0,
      dir: sessionInfo.dir,
      written: sessionInfo.written,
      renamed: sessionInfo.renamed,
      failed: sessionInfo.failed,
      files: sessionInfo.files,
      errors: sessionInfo.errors
    };
  });

  ipcMain.handle('nmo:choose-dir', async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择导出文件夹',
      defaultPath: lastExportDir || app.getPath('pictures'),
      buttonLabel: '使用这个文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    const dir = path.resolve(result.filePaths[0]);
    lastExportDir = dir;
    return { ok: true, dir: dir };
  });

  ipcMain.handle('nmo:plan-export', async (event, request) => {
    assertTrustedSender(event);
    try {
      return await planner.prepare(request || {});
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || 'PLAN_ERROR' };
    }
  });

  ipcMain.handle('nmo:write-plan-file', async (event, token, record) => {
    assertTrustedSender(event);
    try {
      return planner.writeOne(token, record);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('nmo:end-plan', async (event, token, mode, releaseSourceKeys) => {
    assertTrustedSender(event);
    if (mode === 'abort') return planner.abort(token);
    return planner.finish(token, {
      releaseSourceKeys: Array.isArray(releaseSourceKeys) ? releaseSourceKeys.slice(0, 500) : []
    });
  });

  const currentFile = path.join(app.getPath('userData'),'current-parameters.json');
  ipcMain.handle('nmo:current-read', event=>{
    assertTrustedSender(event);
    if(!fs.existsSync(currentFile))return null;
    return JSON.parse(fs.readFileSync(currentFile,'utf8'));
  });
  ipcMain.on('nmo:current-save',(event,data)=>{
    try {
      assertTrustedSender(event);
      if(event.sender!==mainWindow.webContents)throw Error('仅界面可以保存当前参数');
      fs.writeFileSync(currentFile+'.tmp',JSON.stringify(data));
      fs.renameSync(currentFile+'.tmp',currentFile);
      event.returnValue=true;
    } catch {event.returnValue=false;}
  });
  ipcMain.handle('nmo:presets-get', async (event) => {
    assertTrustedSender(event);
    try {
      return { ok: true, presets: getPresets().list() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('nmo:presets-save', async (event, payload) => {
    assertTrustedSender(event);
    try {
      return Object.assign(
        { ok: true },
        getPresets().save(payload && payload.name, payload && payload.data)
      );
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('nmo:presets-rename', async (event, payload) => {
    assertTrustedSender(event);
    try {
      return Object.assign(
        { ok: true },
        getPresets().rename(payload && payload.from, payload && payload.to)
      );
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('nmo:presets-delete', async (event, name) => {
    assertTrustedSender(event);
    try {
      return Object.assign({ ok: true }, getPresets().remove(name));
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('nmo:open-external', async (event, url) => {
    assertTrustedSender(event);
    return openExternalSafely(url);
  });

  ipcMain.handle('nmo:agent-state', async (event) => {
    assertTrustedSender(event);
    return {
      active: Boolean(agentRuntime),
      last: agentLastActivity
    };
  });

  ipcMain.handle('nmo:build-info', async (event) => {
    assertTrustedSender(event);
    return {
      appName: app.getName(),
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
      packaged: app.isPackaged,
      platform: `${process.platform}-${process.arch}`,
      appPath: app.getAppPath(),
      executable: process.execPath,
      testMode: IS_TEST
    };
  });

  ipcMain.handle('nmo:network-log', async (event) => {
    assertTrustedSender(event);
    return {
      blocked: blockedRequests.slice(),
      local: appProtocol.requestLog.slice()
    };
  });
}

// ---------------------------------------------------------------------------
// Menu: a minimal, non-intrusive bar. No reload/devtools in packaged builds.
// ---------------------------------------------------------------------------
function buildMenu() {
  if (!IS_DEV) {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.on('second-instance', (_event, argv) => {
  /* 已经有一个实例在跑时再带 --agent 启动：让这个实例开启桥，而不是无声退出。 */
  const wantsAgent = (argv || []).some((a) => a === '--agent' || a === '--agent=1');
  if (wantsAgent && !agentRuntime) {
    enableAgent(argv).catch((err) => console.error('Agent bridge failed:', err));
  }
  if (mainWindow && !wantsAgent) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

/*
 * 关机/硬杀会跳过 before-quit，留下“预留了号但没写出任何文件”的套组。
 * 用一个会话标记区分“上次是崩溃退出”和“上次是正常退出”：
 * 正常退出时删标记，启动时看到标记才退号；正常退出里的失败重试仍沿原号。
 */
app.whenReady().then(() => {
  appProtocol.registerHandler({ baseline: IS_TEST });
  installNetworkLockdown();
  registerIpc();

  buildMenu();
  mainWindow = createWindow({ hidden: AGENT_REQUESTED });

  if (IS_TEST) {
    // Test harness drives the app through tests/harness.js.
    require('./test-hooks').install(mainWindow);
  }

  if (AGENT_REQUESTED) {
    enableAgent().catch((err) => console.error('Agent bridge failed:', err));
  }
});

app.on('will-quit', () => {
  if (!TEST_PROFILE) return;
  try {
    fs.rmSync(TEST_PROFILE, { recursive: true, force: true });
  } catch {
    /* Chromium may still hold a file; a temp leftover is not worth failing on */
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopAgent();
  batchSessions.clear();
  /* 正常退出删标记；抢不到单实例锁的那个进程不许删（会破坏在跑实例的崩溃检测）。 */
  
});

// Keep the process honest: never allow a renderer crash to leave a zombie.
app.on('render-process-gone', (_event, _contents, details) => {
  if (!IS_TEST) {
    console.error('Renderer gone:', details && details.reason);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in main process:', reason);
});

module.exports = { APP_ORIGIN };
