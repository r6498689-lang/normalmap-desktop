'use strict';

/*
 * params.spec.js
 * 参数有效性：每个控件改变结果，恢复后回到原结果，语义（反转）可验证。
 */

const driver = require('../lib/driver');

/**
 * Bitmap from nativeImage is BGRA, so channel offsets are 2 (R), 1 (G), 0 (B).
 * Sampling goes through the decoded PNG because normal_canvas is owned by a
 * WebGL context and has no 2D context to read back from.
 */
function sample(bitmap, count) {
  const { width, height, bitmap: px } = bitmap;
  const total = width * height;
  const step = Math.max(1, Math.floor(total / (count || 2048)));
  const out = [];
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    out.push([px[o + 2], px[o + 1], px[o], px[o + 3]]);
  }
  return out;
}

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'));
  await ctx.wait(500);

  const baseline = driver.hashOf(await driver.canvasPng(ctx, 'normal'));

  const roundTrip = async (label, apply, revert) => {
    await apply();
    await ctx.wait(650);
    const changed = driver.hashOf(await driver.canvasPng(ctx, 'normal'));
    const differs = changed !== baseline;
    await revert();
    await ctx.wait(650);
    const restored = driver.hashOf(await driver.canvasPng(ctx, 'normal'));
    check(`${label}: 改变参数会改变结果`, differs, 'hash unchanged: ' + changed.slice(0, 12));
    check(`${label}: 恢复参数回到原结果`, restored === baseline, 'hash ' + restored.slice(0, 12));
  };

  // Strength
  await roundTrip(
    'Strength 2.5 → 1.2',
    () => driver.setControl(ctx, 'strength_slider', '1.2'),
    () => driver.setControl(ctx, 'strength_slider', '2.5')
  );

  // Level
  await roundTrip(
    'Level 7.0 → 4.5',
    () => driver.setControl(ctx, 'level_slider', '4.5'),
    () => driver.setControl(ctx, 'level_slider', '7.0')
  );

  // Blur / Sharp
  await roundTrip(
    'Blur/Sharp 0 → 12',
    () => driver.setControl(ctx, 'blur_sharp_slider', '12'),
    () => driver.setControl(ctx, 'blur_sharp_slider', '0')
  );

  // Filter: Sobel / Scharr
  await roundTrip(
    'Filter Sobel → Scharr',
    () => driver.setControl(ctx, 'normal_type', 'scharr'),
    () => driver.setControl(ctx, 'normal_type', 'sobel')
  );

  // Invert R: red channel must mirror around 128.
  const beforeR = sample(ctx.decodeToBitmap(await driver.canvasPng(ctx, 'normal')));
  await ctx.js("document.getElementById('invert_r').click()");
  await ctx.wait(650);
  const afterR = sample(ctx.decodeToBitmap(await driver.canvasPng(ctx, 'normal')));
  const mirrored = beforeR.every((px, i) => Math.abs(255 - px[0] - afterR[i][0]) <= 1);
  const greenSame = beforeR.every((px, i) => px[1] === afterR[i][1]);
  check('Invert R: 红通道取反（255-r）', mirrored, mirrored ? null : 'sample mismatch');
  check('Invert R: 绿通道不受影响', greenSame);
  await ctx.js("document.getElementById('invert_r').click()");
  await ctx.wait(650);
  check('Invert R 还原', driver.hashOf(await driver.canvasPng(ctx, 'normal')) === baseline);

  // Invert G
  const beforeG = sample(ctx.decodeToBitmap(await driver.canvasPng(ctx, 'normal')));
  await ctx.js("document.getElementById('invert_g').click()");
  await ctx.wait(650);
  const afterG = sample(ctx.decodeToBitmap(await driver.canvasPng(ctx, 'normal')));
  check(
    'Invert G: 绿通道取反（255-g）',
    beforeG.every((px, i) => Math.abs(255 - px[1] - afterG[i][1]) <= 1)
  );
  await ctx.js("document.getElementById('invert_g').click()");
  await ctx.wait(650);

  // Invert Height
  await roundTrip(
    'Invert Height',
    () => ctx.js("document.getElementById('invert_height').click()"),
    () => ctx.js("document.getElementById('invert_height').click()")
  );

  // Z Range
  await roundTrip(
    'Z Range -1..+1 关',
    () => ctx.js("document.getElementById('height_offset').click()"),
    () => ctx.js("document.getElementById('height_offset').click()")
  );

  // Other map families respond to their own parameters
  const aoBefore = driver.hashOf(await driver.canvasPng(ctx, 'ambient'));
  await driver.setControl(ctx, 'ao_strength_slider', '1');
  await ctx.wait(700);
  const aoAfter = driver.hashOf(await driver.canvasPng(ctx, 'ambient'));
  check('AO Strength 改变 AO 结果', aoBefore !== aoAfter);

  const specBefore = driver.hashOf(await driver.canvasPng(ctx, 'specular'));
  await driver.setControl(ctx, 'specular_range_slider', '0.4');
  await ctx.wait(700);
  const specAfter = driver.hashOf(await driver.canvasPng(ctx, 'specular'));
  check('Specular Range 改变 Specular 结果', specBefore !== specAfter);

  const dispBefore = driver.hashOf(await driver.canvasPng(ctx, 'displacement'));
  await driver.setControl(ctx, 'dm_contrast_slider', '0.4');
  await ctx.wait(700);
  const dispAfter = driver.hashOf(await driver.canvasPng(ctx, 'displacement'));
  check('Displacement Contrast 改变位移结果', dispBefore !== dispAfter);

  /*
   * 1.1.32：法线/置换两个“反相”勾选框以前共用 id=invert_height，
   * getElementById 只会拿到法线面板那个 —— 置换面板的勾选框不刷新，
   * 置换“恢复默认”还会把法线面板的勾选和渲染状态改坏。逐条验证。
   */
  const invertNormalBaseline = driver.hashOf(await driver.canvasPng(ctx, 'normal'));
  await ctx.js("document.getElementById('invert_height').click()");
  await ctx.wait(650);
  const invertNormalOn = driver.hashOf(await driver.canvasPng(ctx, 'normal'));
  check('法线反相：勾选后结果改变', invertNormalOn !== invertNormalBaseline);

  await ctx.js("document.getElementById('tab_btn_displace').click()");
  await ctx.wait(250);
  const dispBeforeInvert = driver.hashOf(await driver.canvasPng(ctx, 'displacement'));
  const errorsBeforeDispReset = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3).length;
  await ctx.js("document.getElementById('invert_displacement').click()");
  await ctx.wait(650);
  const dispAfterInvert = driver.hashOf(await driver.canvasPng(ctx, 'displacement'));
  check(
    '置换反相有独立控件（id=invert_displacement）',
    dispAfterInvert !== dispBeforeInvert,
    'hash unchanged: ' + dispAfterInvert.slice(0, 12)
  );

  await ctx.js("document.getElementById('reset_btn').click()");
  await ctx.wait(900);
  const afterDispReset = await ctx.js(`(function(){
    return {
      dispInvert: document.getElementById('invert_displacement').checked,
      normalInvert: document.getElementById('invert_height').checked
    };
  })()`);
  check('置换恢复默认：清掉置换的反相勾选', afterDispReset.dispInvert === false, JSON.stringify(afterDispReset));
  check('置换恢复默认：不动法线面板的勾选', afterDispReset.normalInvert === true, JSON.stringify(afterDispReset));
  const errorsAfterDispReset = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3).length;
  check(
    '置换恢复默认：不抛异常',
    errorsAfterDispReset === errorsBeforeDispReset,
    JSON.stringify(ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3).slice(-2))
  );
  check(
    '置换恢复默认：不改变法线渲染结果',
    driver.hashOf(await driver.canvasPng(ctx, 'normal')) === invertNormalOn
  );

  await ctx.js("document.getElementById('tab_btn_normal').click()");
  await ctx.wait(250);
  await ctx.js("document.getElementById('invert_height').click()");
  await ctx.wait(650);
  check(
    '法线反相还原',
    driver.hashOf(await driver.canvasPng(ctx, 'normal')) === invertNormalBaseline
  );

  // Reset to default restores the normal map
  await ctx.js("document.getElementById('reset_btn').click()");
  await ctx.wait(900);
  const afterReset = driver.hashOf(await driver.canvasPng(ctx, 'normal'));
  const controls = await ctx.js(`(function(){
    return {
      strength: document.getElementById('strength_slider').value,
      level: document.getElementById('level_slider').value,
      blur: document.getElementById('blur_sharp_slider').value,
      type: document.getElementById('normal_type').value,
      invertR: document.getElementById('invert_r').checked,
      invertG: document.getElementById('invert_g').checked,
      invertHeight: document.getElementById('invert_height').checked,
      zrange: document.getElementById('height_offset').checked
    };
  })()`);

  check('Reset to default 恢复数值', controls.strength === '2.5' && controls.level === '7' && controls.blur === '0',
    JSON.stringify(controls));
  check('Reset to default 恢复计算结果', afterReset === baseline, 'hash ' + afterReset.slice(0, 12));

  await ctx.screenshot('params-after-reset.png');
  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无未预期的控制台错误', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'params',
    baselineHash: baseline,
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
