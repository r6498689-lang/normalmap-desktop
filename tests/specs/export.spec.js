'use strict';

/*
 * export.spec.js
 * 单张导出：PNG/JPG/TIFF 的真实文件、尺寸、透明度、质量、取消、不可写路径。
 *
 * 命名规则改造后，单张导出也走“选目录 → 按 <类别>_<编号>_<属性> 命名写盘”。
 * 所以每个用例用自己的子目录，避免同一源图共号时同名互相覆盖。
 * 结论以磁盘上的文件为准，不以“点了按钮没报错”为准。
 */

const fs = require('node:fs');
const path = require('node:path');
const driver = require('../lib/driver');
const { readImageSize, magicOf } = require('../lib/imageinfo');

function meanAbsDiff(a, b) {
  if (!a || !b || a.bitmap.length !== b.bitmap.length) return null;
  let sum = 0;
  let worst = 0;
  for (let i = 0; i < a.bitmap.length; i++) {
    const d = Math.abs(a.bitmap[i] - b.bitmap[i]);
    sum += d;
    if (d > worst) worst = d;
  }
  return { mean: sum / a.bitmap.length, max: worst };
}

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  const root = path.join(ctx.evidenceDir, 'out');
  fs.rmSync(root, { recursive: true, force: true });
  const dir = (name) => {
    const target = path.join(root, name);
    fs.mkdirSync(target, { recursive: true });
    return target;
  };

  await driver.waitForBoot(ctx);
  // keepContext：单张导出要走“已分类来源”的真实路径（受控命名 + 选目录）。
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), ctx.win, {
    keepContext: true
  });
  await ctx.wait(400);

  const canvas = {
    normal: await driver.canvasPng(ctx, 'normal'),
    specular: await driver.canvasPng(ctx, 'specular')
  };
  const canvasNormalBitmap = ctx.decodeToBitmap(canvas.normal);

  const statusText = () =>
    ctx.js("document.getElementById('nmo_status') ? document.getElementById('nmo_status').textContent : ''");

  /** 选目录后点下载，等某个具体文件名出现。返回完整路径或 null。 */
  async function exportTo(targetDir, fileName, timeout) {
    ctx.dialogs.folderIs(targetDir);
    await ctx.js("document.getElementById('download').click()");
    const target = path.join(targetDir, fileName);
    const written = await driver.waitForFile(target, timeout || 25000);
    return written ? target : null;
  }

  async function waitStatus(re, timeout) {
    const deadline = Date.now() + (timeout || 15000);
    while (Date.now() < deadline) {
      const text = await statusText();
      if (re.test(text)) return text;
      await ctx.wait(150);
    }
    return await statusText();
  }

  // ---------------------------------------------------------------- PNG 100%
  const pngDir = dir('png');
  await driver.setControl(ctx, 'file_type', 'png');
  await driver.setControl(ctx, 'transparency_nmb', '100');
  const pngPath = await exportTo(pngDir, 'wood_001_Normal.png');
  const pngWritten = Boolean(pngPath);
  ctx.saveText('export-png-status.txt', await statusText());
  check('PNG 文件已写入', pngWritten, path.join(pngDir, 'wood_001_Normal.png'));
  if (pngWritten) {
    const info = readImageSize(pngPath);
    check('PNG 魔数正确', magicOf(pngPath).startsWith('89504e470d0a1a0a'), magicOf(pngPath));
    check('PNG 尺寸为 256x256', info.width === 256 && info.height === 256, JSON.stringify(info));
    const same = ctx.compare(canvas.normal, fs.readFileSync(pngPath));
    check(
      'PNG 像素与画布一致',
      same.identical,
      `${same.differingPixels} px differ, max delta ${same.maxChannelDelta}`
    );
  }

  // ------------------------------------------------------------ PNG 50% 透明
  const alphaDir = dir('alpha');
  await driver.setControl(ctx, 'transparency_nmb', '50');
  const alphaPath = await exportTo(alphaDir, 'wood_001_Normal.png');
  check('PNG 50% 透明度文件已写入', Boolean(alphaPath), path.join(alphaDir, 'wood_001_Normal.png'));
  if (alphaPath) {
    const decoded = ctx.decodeToBitmap(fs.readFileSync(alphaPath));
    // BGRA: alpha is byte 3. The canvas is fully opaque, so 50% must give ~127.
    const alphas = [];
    for (let i = 0; i < decoded.bitmap.length; i += 4 * 977) alphas.push(decoded.bitmap[i + 3]);
    const avg = alphas.reduce((a, b) => a + b, 0) / alphas.length;
    check('PNG 透明度选项生效（约 50%）', Math.abs(avg - 127) <= 4, 'avg alpha=' + avg.toFixed(1));
  }

  // --------------------------------------------------------------------- JPG
  const jpgDir = dir('jpg');
  await driver.setControl(ctx, 'file_type', 'jpg');
  await driver.setControl(ctx, 'file_jpg_qual_nmb', '95');
  const jpgPath = await exportTo(jpgDir, 'wood_001_Normal.jpg');
  check('JPG 文件已写入', Boolean(jpgPath), path.join(jpgDir, 'wood_001_Normal.jpg'));
  if (jpgPath) {
    const info = readImageSize(jpgPath);
    check('JPG 魔数为 FFD8FF', magicOf(jpgPath).startsWith('ffd8ff'), magicOf(jpgPath));
    check('JPG 尺寸为 256x256', info.width === 256 && info.height === 256, JSON.stringify(info));
    const diff = meanAbsDiff(canvasNormalBitmap, ctx.decodeToBitmap(fs.readFileSync(jpgPath)));
    check(
      'JPG 与画布的偏差在有损编码的合理范围内',
      diff && diff.mean < 8,
      diff ? `mean=${diff.mean.toFixed(2)} max=${diff.max}` : 'decode failed'
    );
    check(
      'JPG 编码确实是有损的（不是原样拷贝）',
      diff && diff.mean > 0.05,
      diff ? 'mean=' + diff.mean.toFixed(3) : ''
    );
  }

  // 低质量必须比高质量失真更大（证明质量滑块真的生效）
  const jpgLowDir = dir('jpg-low');
  await driver.setControl(ctx, 'file_jpg_qual_nmb', '35');
  const jpgLowPath = await exportTo(jpgLowDir, 'wood_001_Normal.jpg');
  if (jpgLowPath && jpgPath) {
    const lowDiff = meanAbsDiff(canvasNormalBitmap, ctx.decodeToBitmap(fs.readFileSync(jpgLowPath)));
    const highDiff = meanAbsDiff(canvasNormalBitmap, ctx.decodeToBitmap(fs.readFileSync(jpgPath)));
    check(
      'JPG 质量 35 的失真大于质量 95',
      lowDiff && highDiff && lowDiff.mean > highDiff.mean,
      lowDiff && highDiff ? `q35=${lowDiff.mean.toFixed(2)} q95=${highDiff.mean.toFixed(2)}` : ''
    );
  } else {
    check('JPG 质量 35 文件已写入', false);
  }

  // -------------------------------------------------------------------- TIFF
  const tifDir = dir('tif');
  await driver.setControl(ctx, 'file_type', 'tiff');
  const tifPath = await exportTo(tifDir, 'wood_001_Normal.tif');
  check('TIFF 文件已写入', Boolean(tifPath), path.join(tifDir, 'wood_001_Normal.tif'));
  if (tifPath) {
    const magic = magicOf(tifPath);
    check(
      'TIFF 魔数正确（小端或大端）',
      magic.startsWith('49492a00') || magic.startsWith('4d4d002a'),
      magic
    );
    const info = readImageSize(tifPath);
    check('TIFF 尺寸为 256x256', info.width === 256 && info.height === 256, JSON.stringify(info));
    check('TIFF 文件非空', fs.statSync(tifPath).size > 1024, fs.statSync(tifPath).size + ' bytes');
  }

  // --------------------------------------------------- 导出的是当前可见贴图
  const specDir = dir('specular');
  await driver.setControl(ctx, 'file_type', 'png');
  // The opacity control persists between exports; reset it so this check
  // isolates "which map" from "how transparent".
  await driver.setControl(ctx, 'transparency_nmb', '100');
  await ctx.js("document.getElementById('tab_btn_specular').click()");
  await ctx.wait(700);
  const specPath = await exportTo(specDir, 'wood_001_Specular.png');
  if (specPath) {
    const same = ctx.compare(canvas.specular, fs.readFileSync(specPath));
    check('切到 Specular 页后 Download 导出的是 Specular', same.identical, `${same.differingPixels} px differ`);
  } else {
    check('Specular 导出文件已写入', false, path.join(specDir, 'wood_001_Specular.png'));
  }
  await ctx.js("document.getElementById('tab_btn_normal').click()");
  await ctx.wait(600);

  // ------------------------------------------------------------------- 取消
  const beforeCancel = listFiles(root).length;
  ctx.dialogs.cancelFolder();
  await ctx.js("document.getElementById('download').click()");
  const cancelStatus = await waitStatus(/已取消/, 8000);
  await ctx.wait(400);
  const afterCancel = listFiles(root).length;
  check('取消选择目录不写文件', beforeCancel === afterCancel, `${beforeCancel} → ${afterCancel}`);
  check('取消导出给出正常提示', /已取消/.test(cancelStatus), JSON.stringify(cancelStatus));
  check(
    '取消导出后结果仍在',
    driver.hashOf(await driver.canvasPng(ctx, 'normal')) === driver.hashOf(canvas.normal),
    'canvas changed'
  );

  // --------------------------------------------------------- 不可写目标路径
  const badDir = path.join(root, 'no-such-folder', 'deep');
  ctx.dialogs.folderIs(badDir);
  await ctx.js("document.getElementById('download').click()");
  const badStatus = await waitStatus(/失败/, 10000);
  check('不可写路径不产生文件', !fs.existsSync(badDir) || listFiles(badDir).length === 0);
  check('不可写路径给出失败提示', /失败/.test(badStatus), JSON.stringify(badStatus));

  ctx.dialogs.restore();
  await ctx.screenshot('export-final.png');

  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无未预期的控制台错误', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'export',
    outDir: root,
    files: listFiles(root),
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};

/** 递归列出目录下的文件（相对 outDir），结果稳定排序，便于比对前后数量。 */
function listFiles(root) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}
