'use strict';

/*
 * packaged.spec.js
 * 针对最终 dist 便携版的端到端检查：构建身份、打包后仍能导入导出、
 * 页面里没有开发入口、测试专用的 app://baseline 在正式包里不存在。
 */

const fs = require('node:fs');
const path = require('node:path');
const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  const build = await ctx.js('window.nmoDesktop.getBuildInfo()');

  check('运行的是打包版（app.isPackaged）', build.packaged === true, String(build.packaged));
  // 便携版可以被搬到任意目录（例如 D://software//NormalMap-1.1.0），
  // 该断言的是“目录结构完整”，不是“必须在工程的 dist 下”。
  const exeDir = path.dirname(build.executable);
  check(
    '便携目录结构完整（exe 旁有 resources\\app 与 locales）',
    /NormalMap Desktop\.exe$/i.test(build.executable) &&
      fs.existsSync(path.join(exeDir, 'resources', 'app', 'renderer', 'index.html')) &&
      fs.existsSync(path.join(exeDir, 'locales')),
    build.executable
  );
  check(
    '应用代码来自 resources\\app',
    /resources[\\/]app$/i.test(build.appPath),
    build.appPath
  );

  // devTools:false must be observable, not just declared in webPreferences.
  const devPrefs = ctx.win.webContents.getLastWebPreferences() || {};
  let devToolsOpened = null;
  try {
    ctx.win.webContents.openDevTools({ mode: 'detach' });
    await ctx.wait(700);
    devToolsOpened = ctx.win.webContents.isDevToolsOpened();
    if (devToolsOpened) ctx.win.webContents.closeDevTools();
  } catch (err) {
    devToolsOpened = 'threw: ' + String((err && err.message) || err);
  }
  check('打包版无法打开开发者工具', devToolsOpened === false || String(devToolsOpened).startsWith('threw'), String(devToolsOpened));
  check('contextIsolation 开启', devPrefs.contextIsolation === true, String(devPrefs.contextIsolation));
  check('nodeIntegration 关闭', devPrefs.nodeIntegration !== true, String(devPrefs.nodeIntegration));
  check('sandbox 开启', devPrefs.sandbox !== false, String(devPrefs.sandbox));

  // app://baseline 只用于开发期像素对比，正式包里必须不存在
  const { net } = require('electron');
  let baselineStatus = null;
  try {
    const res = await net.fetch('app://baseline/index.html');
    baselineStatus = res.status;
  } catch (err) {
    baselineStatus = 'error:' + String((err && err.message) || err);
  }
  check('正式包不提供 app://baseline', baselineStatus === 403 || String(baselineStatus).startsWith('error:'), String(baselineStatus));

  // --------------------------------------------------------------- 全流程
  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'));
  await ctx.wait(500);

  const outDir = path.join(ctx.evidenceDir, 'out');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await driver.setControl(ctx, 'file_name', 'packaged-check');
  await driver.setControl(ctx, 'file_type', 'png');
  const canvas = await driver.canvasPng(ctx, 'normal');
  const target = path.join(outDir, 'packaged-check.png');
  ctx.dialogs.saveTo(target);
  await ctx.js("document.getElementById('download').click()");
  const written = await driver.waitForFile(target);
  check('打包版导出成功', written, target);
  if (written) {
    const cmp = ctx.compare(canvas, fs.readFileSync(target));
    check('打包版导出内容与画布一致', cmp.identical, `${cmp.differingPixels} px differ`);
  }

  // 全部导出也要在打包版里跑一次
  const allDir = path.join(outDir, 'all');
  fs.mkdirSync(allDir, { recursive: true });
  ctx.dialogs.folderIs(allDir);
  await ctx.js("document.getElementById('download_all').click()");
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && fs.readdirSync(allDir).length < 4) {
    await ctx.wait(300);
  }
  const allFiles = fs.readdirSync(allDir).sort();
  check('打包版全部导出产生 4 个文件', allFiles.length === 4, JSON.stringify(allFiles));

  // ------------------------------------------------- 三种格式都要能真正落盘
  const { magicOf } = require('../lib/imageinfo');
  const formats = [
    ['jpg', path.join(outDir, 'packaged-format.jpg'), 'ffd8ff'],
    ['tiff', path.join(outDir, 'packaged-format.tif'), '49492a00,4d4d002a']
  ];
  for (const [type, file, magic] of formats) {
    fs.rmSync(file, { force: true });
    await driver.setControl(ctx, 'file_type', type);
    await driver.setControl(ctx, 'file_name', path.basename(file, path.extname(file)));
    ctx.dialogs.saveTo(file);
    await ctx.js("document.getElementById('download').click()");
    const wrote = await driver.waitForFile(file, 15000);
    const actual = wrote ? magicOf(file) : '';
    const matches = magic.split(',').some((m) => actual.startsWith(m));
    check(`打包版 ${type.toUpperCase()} 导出成功且魔数正确`, wrote && matches, `${file} ${actual}`);
  }

  // ------------------------------------------------------- 写盘失败要有反馈
  await driver.setControl(ctx, 'file_type', 'png');
  const unreadable = path.join(outDir, 'no-such-dir', 'cannot-write.png');
  ctx.dialogs.saveTo(unreadable);
  await ctx.js("document.getElementById('download').click()");
  await ctx.wait(800);
  const failedStatus = await ctx.js(`(function(){
    var el = document.getElementById('nmo_status');
    return { text: el.textContent, cls: el.className };
  })()`);
  check(
    '打包版写盘失败时给出错误提示',
    /保存失败/.test(failedStatus.text) && failedStatus.cls.indexOf('error') !== -1,
    JSON.stringify(failedStatus)
  );
  check('打包版写盘失败不产生文件', !fs.existsSync(unreadable), unreadable);

  // --------------------------------------------- 批量失败统计（页面 + 主进程）
  const mixedDir = path.join(outDir, 'mixed');
  fs.mkdirSync(mixedDir, { recursive: true });
  ctx.dialogs.folderIs(mixedDir);
  const mixed = await ctx.js(`(function(){
    return NMO_Desktop.exportMany({
      label: 'Packaged mixed',
      baseName: 'packaged_mixed',
      total: 2,
      nameFor: function(i){ return 'packaged_mixed_' + i; },
      produce: function(i){
        if (i === 1) return Promise.reject(new Error('synthetic encode failure'));
        return NMO_Main.buildImageRecord('NormalMap', 'packaged_mixed_0');
      }
    });
  })()`);
  await ctx.wait(400);
  const mixedStatus = await ctx.js(`document.getElementById('nmo_status').className`);
  check('打包版批量：ok 为 false', mixed && mixed.ok === false, JSON.stringify(mixed));
  check('打包版批量：written=1 / failed=1', mixed && mixed.written === 1 && mixed.failed === 1, JSON.stringify(mixed));
  check('打包版批量：生成失败单独计数', mixed && mixed.genFailed === 1 && mixed.writeFailed === 0, JSON.stringify(mixed));
  check('打包版批量：只有一个文件落盘', fs.readdirSync(mixedDir).length === 1, JSON.stringify(fs.readdirSync(mixedDir)));
  check('打包版批量：状态样式为 error', /\berror\b/.test(mixedStatus), mixedStatus);

  // --------------------------------------------------- 四方向照片与 TGA 贴图
  const beforePhotos = await driver.canvasPng(ctx, 'normal');
  await ctx.js("document.getElementById('tab_btn_pictures').click()");
  await ctx.wait(1200);
  for (const [selector, name] of [
    ['#select_file_above', 'rug-above.jpg'],
    ['#select_file_left', 'rug-left.jpg'],
    ['#select_file_right', 'rug-right.jpg'],
    ['#select_file_below', 'rug-below.jpg']
  ]) {
    await ctx.setFileInput(ctx.win, selector, [driver.fixture('photos', name)]);
    await ctx.wait(650);
  }
  await ctx.wait(800);
  const photoState = await ctx.js(`(function(){
    var c = NMO_NormalMap.normal_canvas;
    return {
      width: c.width,
      height: c.height,
      tabVisible: document.getElementById('photo_map').style.display !== 'none'
    };
  })()`);
  const afterPhotos = await driver.canvasPng(ctx, 'normal');
  check('打包版照片模式：法线画布仍然有效', photoState.width > 0 && photoState.height > 0, JSON.stringify(photoState));
  check('打包版照片模式：结果不同于高度图', !ctx.compare(beforePhotos, afterPhotos).identical, 'canvas unchanged');

  await ctx.setFileInput(ctx.win, '#select_diffuse_file', [driver.fixture('height-tga-128.tga')]);
  await ctx.waitFor("diffuse_canvas.dataset.sourceWidth === '128'", 15000);
  await ctx.wait(300);
  const tgaState = await ctx.js(`(function(){
    var c = diffuse_canvas;
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    var opaque = 0;
    for (var i = 3; i < d.length; i += 4) if (d[i] > 0) opaque += 1;
    return { width: c.width, height: c.height, opaque: opaque };
  })()`);
  check(
    '打包版 Diffuse TGA 解码成功（128x128，非空）',
    tgaState.width === 128 && tgaState.height === 128 && tgaState.opaque > 128 * 128 * 0.9,
    JSON.stringify(tgaState)
  );

  const netLog = await ctx.js('window.nmoDesktop.getNetworkLog()');
  check('打包版运行期间没有远程请求', netLog.blocked.length === 0, JSON.stringify(netLog.blocked.slice(0, 3)));

  await ctx.screenshot('packaged-window.png');
  ctx.dialogs.restore();

  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无未预期的控制台错误', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'packaged',
    build,
    exportDir: outDir,
    exportFiles: allFiles,
    formats: formats.map((f) => f[1]),
    batchMixed: mixed,
    photoState,
    diffuseTga: tgaState,
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
