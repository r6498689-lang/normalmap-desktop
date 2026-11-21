'use strict';

/*
 * offline.spec.js
 * 断网冷启动全流程：导入 → 参数 → 导出，全程记录应用发起的每一个请求。
 * 同时做正向对照：主动发起一次 https 请求，必须被拦截且被记录。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const driver = require('../lib/driver');

function listeningPortsFor(exeName) {
  try {
    const script = [
      `$procs = Get-CimInstance Win32_Process -Filter "Name='${exeName}'" | Where-Object { $_.ExecutablePath -like '*NormalMap*' }`,
      'if (-not $procs) { "NOPROC"; exit 0 }',
      '$ids = $procs | ForEach-Object { $_.ProcessId }',
      '$ids -join ","'
    ].join('; ');
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8'
    }).trim();
    if (!out || out === 'NOPROC') return { pids: [], listening: [] };

    const pids = out.split(',').map((s) => s.trim()).filter(Boolean);
    const netstat = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    const listening = netstat
      .split(/\r?\n/)
      .filter((line) => /LISTENING/i.test(line))
      .filter((line) => {
        const cols = line.trim().split(/\s+/);
        const pid = cols[cols.length - 1];
        return pids.includes(pid);
      })
      .map((line) => line.trim());
    return { pids, listening };
  } catch (err) {
    return { error: String(err && err.message), pids: [], listening: [] };
  }
}

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  const startedAt = new Date().toISOString();
  await driver.waitForBoot(ctx);

  // 冷启动后立刻取样：此时应当只有 app:// 请求
  const bootLog = await ctx.js('window.nmoDesktop.getNetworkLog()');
  check('冷启动期间没有任何远程请求', bootLog.blocked.length === 0, JSON.stringify(bootLog.blocked.slice(0, 3)));
  check('本地资源全部来自 app://', bootLog.local.every((r) => r.url.startsWith('app://nmo/')), String(bootLog.local.length));

  // 协议只服务 renderer/：同主机上的上一级文件不可达
  const outsideRoot = await ctx.js(`(async function(){
    try {
      var res = await fetch('app://nmo/package.json', { cache: 'no-store' });
      return { status: res.status };
    } catch (err) {
      return { status: 'error', message: String(err && err.message || err) };
    }
  })()`);
  check(
    '协议不暴露 renderer 以外的文件（app://nmo/package.json）',
    outsideRoot.status !== 200,
    JSON.stringify(outsideRoot)
  );

  // ------------------------------------------------ 第一层：页面 CSP 拦截
  const fetchProbe = await ctx.js(`(async function(){
    try {
      await fetch('https://example.com/probe.png', { cache: 'no-store' });
      return { blocked: false };
    } catch (err) {
      return { blocked: true, error: String(err && err.message || err) };
    }
  })()`);
  await ctx.wait(500);
  check('页面发起的远程请求被 CSP 拒绝', fetchProbe.blocked === true, JSON.stringify(fetchProbe));

  // ------------------------------------- 第二层：会话级网络封锁（绕过页面 CSP）
  // 新建一个临时窗口直接导航到外站。页面 CSP 管不到这个导航，
  // 只有主进程的 onBeforeRequest 取消能挡住它。
  const { BrowserWindow } = require('electron');
  const probeWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  let navigationError = null;
  try {
    await probeWin.loadURL('https://example.com/never-loads');
  } catch (err) {
    navigationError = String((err && err.message) || err);
  }
  probeWin.destroy();
  await ctx.wait(500);

  const afterProbe = await ctx.js('window.nmoDesktop.getNetworkLog()');
  const recorded = afterProbe.blocked.filter((r) => /example\.com/.test(r.url));
  check(
    '外站导航被会话级封锁拦截',
    /ERR_BLOCKED_BY_CLIENT|ERR_FAILED|ERR_ABORTED/.test(navigationError || ''),
    navigationError
  );
  check('被拦截的请求记录在案', recorded.length >= 1, JSON.stringify(afterProbe.blocked.slice(0, 3)));

  // ------------------------------------------------------------- 全流程
  const outDir = path.join(ctx.evidenceDir, 'out');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), ctx.win, {
    keepContext: true
  });
  await driver.setControl(ctx, 'strength_slider', '3.2');
  await driver.setControl(ctx, 'file_type', 'png');
  const canvas = await driver.canvasPng(ctx, 'normal');

  // 断网下走的是受控命名：选目录 → wood_001_Normal.png。
  const target = path.join(outDir, 'wood_001_Normal.png');
  ctx.dialogs.folderIs(outDir);
  await ctx.js("document.getElementById('download').click()");
  const written = await driver.waitForFile(target);
  check('断网状态下导出成功', written, target);
  if (written) {
    const cmp = ctx.compare(canvas, fs.readFileSync(target));
    check('导出内容与画布一致', cmp.identical, `${cmp.differingPixels} px differ`);
  }

  // 预览与开关在断网下也必须工作
  await ctx.js("document.getElementById('input_enviroment').click()");
  await ctx.wait(900);
  await ctx.js("document.getElementById('input_enviroment').click()");
  await ctx.wait(600);

  const endLog = await ctx.js('window.nmoDesktop.getNetworkLog()');
  const remoteAttempts = endLog.blocked.filter((r) => !/^app:\/\//.test(r.url));
  check(
    '全流程中除了对照探针没有其他远程请求',
    remoteAttempts.every((r) => /example\.com/.test(r.url)),
    JSON.stringify(remoteAttempts)
  );

  const ports = listeningPortsFor('electron.exe');
  check('应用进程没有监听端口', ports.listening.length === 0, JSON.stringify(ports));

  await ctx.screenshot('offline-final.png');

  // 上面那次 CSP 探针会留下两条“故意制造”的 CSP 违规日志，单独排除后要求其余为零。
  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  const unexpectedErrors = consoleErrors.filter(
    (e) => !/Content Security Policy|example\.com/i.test(e.message)
  );
  check('除故意的对照探针外没有控制台错误', unexpectedErrors.length === 0, JSON.stringify(unexpectedErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'offline',
    startedAt,
    finishedAt: new Date().toISOString(),
    localRequestCount: endLog.local.length,
    localRequestSample: endLog.local.slice(0, 12).map((r) => r.url),
    blockedRemote: endLog.blocked,
    listeningProcesses: ports,
    build: await ctx.js('window.nmoDesktop.getBuildInfo()'),
    steps,
    failures
  };
};
