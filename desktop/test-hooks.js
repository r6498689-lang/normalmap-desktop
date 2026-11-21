'use strict';

/*
 * test-hooks.js
 * Only loaded when NMO_TEST_MODE is set (see desktop/main.js). It runs a
 * scenario file inside the main process, gives it a small driver API, then
 * writes a JSON result and exits with a status code.
 *
 * This is test infrastructure, not part of the shipped runtime path: packaged
 * builds never set NMO_TEST_MODE, so this module is never required.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, nativeImage, dialog } = require('electron');

const REAL_DIALOGS = {
  showSaveDialog: dialog.showSaveDialog.bind(dialog),
  showOpenDialog: dialog.showOpenDialog.bind(dialog),
  showMessageBox: dialog.showMessageBox.bind(dialog)
};

/** Accepts raw bytes, a bare base64 payload, or a full data: URL. */
function toBuffer(dataOrUrl) {
  if (Buffer.isBuffer(dataOrUrl)) return dataOrUrl;
  if (dataOrUrl instanceof Uint8Array) return Buffer.from(dataOrUrl);
  const text = String(dataOrUrl || '');
  const marker = text.indexOf('base64,');
  const payload = marker >= 0 ? text.slice(marker + 7) : text;
  return Buffer.from(payload, 'base64');
}

function compareImages(inputA, inputB) {
  const imgA = nativeImage.createFromBuffer(toBuffer(inputA));
  const imgB = nativeImage.createFromBuffer(toBuffer(inputB));

  const sizeA = imgA.getSize();
  const sizeB = imgB.getSize();
  const report = {
    sizeA,
    sizeB,
    sizeEqual: sizeA.width === sizeB.width && sizeA.height === sizeB.height,
    identical: false,
    decodeFailed: sizeA.width === 0 || sizeB.width === 0,
    differingPixels: null,
    maxChannelDelta: null,
    meanChannelDelta: null
  };

  // An undecodable image must never be reported as "matching": empty bitmaps
  // would otherwise compare equal and silently pass.
  if (report.decodeFailed) {
    report.note = 'one or both images could not be decoded';
    return report;
  }

  if (!report.sizeEqual) return report;

  const bufA = imgA.getBitmap();
  const bufB = imgB.getBitmap();
  if (bufA.length !== bufB.length) {
    report.note = 'bitmap length mismatch';
    return report;
  }

  let differing = 0;
  let maxDelta = 0;
  let sumDelta = 0;
  const pixels = sizeA.width * sizeA.height;
  for (let i = 0; i < bufA.length; i += 4) {
    let pixelDiffers = false;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(bufA[i + c] - bufB[i + c]);
      if (d > 0) {
        pixelDiffers = true;
        if (d > maxDelta) maxDelta = d;
        sumDelta += d;
      }
    }
    if (pixelDiffers) differing += 1;
  }

  report.identical = differing === 0;
  report.differingPixels = differing;
  report.differingRatio = pixels ? differing / pixels : 0;
  report.maxChannelDelta = maxDelta;
  report.meanChannelDelta = bufA.length ? sumDelta / (bufA.length / 4) / 4 : 0;
  return report;
}

function install(mainWin) {
  const specPath = process.env.NMO_TEST_SPEC;
  if (!specPath) return;

  /*
   * 1.1.1 起界面是两行三列，需要约 1470x890 的视口才能一屏放下。
   * （1.1.2 只是把下载区/3D 设置换到左右两栏，视口需求不变。）
   * 默认窗口在测试环境里会被屏幕限制成 ~1080x670，3D 画布会落到可视区外，
   * 截图全黑导致“关闭法线后画面不变”这类假失败。
   * 产品默认窗口不动，只在测试时把窗口调到设计尺寸。
   */
  try {
    mainWin.setContentSize(1472, 888);
  } catch (err) {
    /* 屏幕不够大就按原样跑，失败信息里会体现 */
  }

  const outPath = process.env.NMO_TEST_OUT || path.join(process.cwd(), 'nmo-test-result.json');
  const evidenceDir = process.env.NMO_EVIDENCE_DIR || path.join(process.cwd(), 'evidence');

  /** Renderer console output, so a failed scenario shows the real cause. */
  const consoleLog = [];
  mainWin.webContents.on('console-message', (event) => {
    const level = typeof event.level === 'number' ? event.level : event.level;
    consoleLog.push({
      level,
      message: event.message,
      line: event.lineNumber,
      source: event.sourceId
    });
    if (consoleLog.length > 2000) consoleLog.shift();
  });

  const ctx = {
    win: mainWin,
    app,
    evidenceDir,
    specPath,
    consoleLog,
    /** Text of confirmation boxes shown during the scenario (see dialogs). */
    messages: [],

    js: (code) => mainWin.webContents.executeJavaScript(code, true),

    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

    async waitFor(expression, timeoutMs) {
      return ctx.waitForIn(mainWin, expression, timeoutMs);
    },

    /** Same, but against an arbitrary window (used for the baseline copy). */
    async waitForIn(win, expression, timeoutMs) {
      const deadline = Date.now() + (timeoutMs || 20000);
      let lastError = null;
      while (Date.now() < deadline) {
        try {
          const value = await win.webContents.executeJavaScript(`Boolean(${expression})`, true);
          if (value) return true;
        } catch (err) {
          lastError = err;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      throw new Error(
        `Timed out waiting for: ${expression}${lastError ? ' (' + lastError.message + ')' : ''}`
      );
    },

    async screenshot(name) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      const image = await mainWin.webContents.capturePage();
      const target = path.join(evidenceDir, name);
      fs.writeFileSync(target, image.toPNG());
      return target;
    },

    /** Captures one element's area (viewport coordinates). */
    async screenshotRect(name, rect) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      const image = await mainWin.webContents.capturePage({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
      const target = path.join(evidenceDir, name);
      fs.writeFileSync(target, image.toPNG());
      return target;
    },

    saveText(name, text) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      const target = path.join(evidenceDir, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
      return target;
    },

    /** Opens the pristine upstream copy in a second window for A/B comparison. */
    async openBaseline() {
      const win = new BrowserWindow({
        width: 1500,
        height: 960,
        show: true,
        backgroundColor: '#101010',
        title: 'baseline',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          devTools: false
        }
      });
      await win.loadURL('app://baseline/index.html');
      await new Promise((resolve) => setTimeout(resolve, 800));
      return win;
    },

    compare: compareImages,

    /** Decodes a data URL / base64 PNG into a BGRA bitmap for pixel maths. */
    decodeToBitmap(dataOrUrl) {
      const image = nativeImage.createFromBuffer(toBuffer(dataOrUrl));
      const size = image.getSize();
      return { width: size.width, height: size.height, bitmap: image.getBitmap() };
    },

    /**
     * Native dialogs would block a headless-ish test run, so scenarios
     * replace them with canned answers. Nothing in the shipped code knows
     * about this switch: it patches the dialog module at test time only.
     */
    dialogs: {
      saveTo(filePath) {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      },
      cancelSave() {
        dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
      },
      folderIs(dir) {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
      },
      cancelFolder() {
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      },
      /**
       * Answers the next confirmation box (used when a save path has to be
       * corrected to match the encoded format). 0 = accept, 1 = cancel.
       * Every box is recorded in `ctx.messages` for assertions.
       */
      answerMessageBox(response, options) {
        ctx.messages.length = 0;
        dialog.showMessageBox = async (winOrOptions, maybeOptions) => {
          const opts = maybeOptions || winOrOptions || {};
          ctx.messages.push({
            title: opts.title || '',
            message: opts.message || '',
            detail: opts.detail || '',
            buttons: opts.buttons || []
          });
          return { response, checkboxChecked: false };
        };
        if (options) ctx.messages.push(options);
      },
      restore() {
        dialog.showSaveDialog = REAL_DIALOGS.showSaveDialog;
        dialog.showOpenDialog = REAL_DIALOGS.showOpenDialog;
        dialog.showMessageBox = REAL_DIALOGS.showMessageBox;
        ctx.messages.length = 0;
      }
    },

    /** Drives a <input type=file> through the DevTools protocol. */
    async setFileInput(win, selector, absolutePaths) {
      const wc = win.webContents;
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      const { root } = await wc.debugger.sendCommand('DOM.getDocument', { depth: -1 });
      const { nodeId } = await wc.debugger.sendCommand('DOM.querySelector', {
        nodeId: root.nodeId,
        selector
      });
      if (!nodeId) throw new Error(`Selector not found: ${selector}`);
      await wc.debugger.sendCommand('DOM.setFileInputFiles', {
        nodeId,
        files: absolutePaths.map((p) => path.resolve(p))
      });
      return true;
    }
  };

  mainWin.webContents.once('did-finish-load', async () => {
    let result;
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const spec = require(path.resolve(specPath));
      result = await spec.run(ctx);
    } catch (err) {
      result = { ok: false, error: String((err && err.stack) || err) };
    }

    // The runner assigns a unique id per launch and refuses a result file that
    // does not carry it, so a stale JSON from an earlier run cannot pass.
    if (result && typeof result === 'object') {
      result.runId = process.env.NMO_TEST_RUN_ID || null;
    }

    try {
      fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
      fs.writeFileSync(path.resolve(outPath), JSON.stringify(result, null, 2), 'utf8');
    } catch (err) {
      console.error('Could not write test result:', err);
    }
    console.log('NMO_TEST_RESULT=' + path.resolve(outPath));
    setTimeout(() => app.exit(result && result.ok ? 0 : 1), 150);
  });
}

module.exports = { install, compareImages };
