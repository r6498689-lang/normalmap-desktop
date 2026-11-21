'use strict';

/*
 * import.spec.js
 * 单图导入：点击选择、拖放、TGA（Windows 无 MIME）、无效文件、取消、重复选同一文件。
 */

const fs = require('node:fs');
const path = require('node:path');
const driver = require('../lib/driver');
const { readImageSize } = require('../lib/imageinfo');

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, condition, detail) => {
    steps.push({ label, ok: Boolean(condition), detail: detail === undefined ? null : detail });
    if (!condition) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  await driver.waitForBoot(ctx);
  const bootSize = await driver.readText(ctx, 'size');
  check('默认高度图已载入 (512 x 512)', bootSize === '512 x 512', 'size=' + bootSize);

  // --- 1. 通过 <input type=file> 导入：逐种格式 ---
  const viaInput = [
    'height-bumps-256.png',
    'basecolor-color-256.png',
    'height-alpha-192.png',
    'height-300x200.png',
    'height-255x257.png'
  ];

  for (const name of viaInput) {
    const file = driver.fixture(name);
    const expected = readImageSize(file);
    const size = await driver.loadHeightFile(ctx, file);
    const shown = await driver.readText(ctx, 'size');
    const canvases = await driver.canvasSizes(ctx);

    // Upstream appends "NOT POWER OF 2 !" for non-power-of-two inputs; keep
    // that wording and check it against the actual dimension.
    const isPot = (n) => n > 0 && (n & (n - 1)) === 0;
    const expectedSuffix = isPot(expected.width) && isPot(expected.height) ? '' : ' NOT POWER OF 2 !';
    const expectedLabel = `${expected.width} x ${expected.height}${expectedSuffix}`;

    check(
      `点击导入 ${name}`,
      size.width === expected.width && shown === expectedLabel,
      `expected "${expectedLabel}", size label "${shown}"`
    );
    check(
      `${name} 四类贴图尺寸一致`,
      Object.values(canvases).every(([w, h]) => w === expected.width && h === expected.height),
      JSON.stringify(canvases)
    );
  }

  // --- 2. 拖放到高度图区域 ---
  const dropFile = driver.fixture('height-bumps-256.png');
  await driver.dropFile(ctx, '#height_map', dropFile, 'image/png');
  const afterDrop = await driver.readText(ctx, 'size');
  check('拖放导入 PNG', afterDrop === '256 x 256', 'size=' + afterDrop);
  await ctx.screenshot('import-drop-256.png');

  // --- 3. TGA：Windows 下 MIME 为空，上游会直接拒收 ---
  const tga = driver.fixture('height-tga-128.tga');
  await driver.dropFile(ctx, '#height_map', tga, '');
  const afterTga = await driver.readText(ctx, 'size');
  check('拖放导入 TGA（MIME 为空）', afterTga === '128 x 128', 'size=' + afterTga);

  // 同一份 TGA 通过文件选择框再导入一次（重复选择同一文件必须仍然生效）
  await ctx.setFileInput(ctx.win, '#select_file_height', [tga]);
  await ctx.wait(400);
  await driver.completeClassification(ctx, 'wood');
  await ctx.wait(600);
  const afterTgaAgain = await driver.readText(ctx, 'size');
  check('重复选择同一个 TGA 仍然导入', afterTgaAgain === '128 x 128', 'size=' + afterTgaAgain);

  // --- 4. 无效文件：不能崩溃，也不能破坏当前结果 ---
  const beforeInvalidHash = driver.hashOf(await driver.canvasPng(ctx, 'normal'));
  await ctx.setFileInput(ctx.win, '#select_file_height', [driver.fixture('not-an-image.png')]);
  await ctx.waitFor("Boolean(document.getElementById('classify_dialog'))", 15000);
  await ctx.waitFor(
    "document.getElementById('classify_error') && document.getElementById('classify_error').hidden === false",
    20000
  );
  const invalidErrorText = await ctx.js("document.getElementById('classify_error').textContent");
  check('无效图片在分类框里指出具体文件', /not-an-image\.png/.test(invalidErrorText), invalidErrorText);
  await ctx.js("document.getElementById('classify_cancel').click()");
  await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);
  await ctx.wait(400);
  const afterInvalidSize = await driver.readText(ctx, 'size');
  const afterInvalidHash = driver.hashOf(await driver.canvasPng(ctx, 'normal'));
  const statusAfterInvalid = await ctx.js(
    "document.getElementById('nmo_status') ? document.getElementById('nmo_status').textContent : ''"
  );

  check('无效图片不改变当前结果', beforeInvalidHash === afterInvalidHash, 'normal hash changed');
  check('无效图片后界面仍可用（尺寸未变）', afterInvalidSize === '128 x 128', 'size=' + afterInvalidSize);
  check(
    '无效图片给出可理解的提示',
    /无法解码|受支持|没有可分类/.test(invalidErrorText + statusAfterInvalid) ||
      /已取消分类/.test(statusAfterInvalid),
    'status=' + JSON.stringify(statusAfterInvalid)
  );

  // --- 5. 取消选择：input 上的 cancel 事件不应改变任何状态 ---
  const beforeCancel = driver.hashOf(await driver.canvasPng(ctx, 'normal'));
  await ctx.js(`(function(){
    var el = document.getElementById('select_file_height');
    el.dispatchEvent(new Event('cancel', { bubbles: true }));
    return true;
  })()`);
  await ctx.wait(400);
  const afterCancel = driver.hashOf(await driver.canvasPng(ctx, 'normal'));
  check('取消选择不改变结果', beforeCancel === afterCancel, 'normal hash changed');

  // --- 6. 拖放非图片到四方向格子 ---
  await ctx.js(`document.getElementById('tab_btn_pictures').click()`);
  await ctx.wait(1200);
  await driver.dropFile(ctx, '#picture_above_drop', driver.fixture('model-pyramid.obj'), 'application/octet-stream').catch(
    () => {}
  );
  await ctx.wait(600);
  const stillAlive = await ctx.js('Boolean(window.NMO_Main) && NMO_RenderNormalview.renderer_Normalview !== undefined');
  check('非图片拖到四方向格子不崩溃', stillAlive === true);

  // back to height mode for the screenshot
  await ctx.js(`document.getElementById('tab_btn_heightmap').click()`);
  await ctx.wait(1200);
  await ctx.screenshot('import-final-state.png');

  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无未预期的控制台错误', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'import',
    steps,
    failures,
    consoleErrors,
    checkedAt: new Date().toISOString()
  };
};
