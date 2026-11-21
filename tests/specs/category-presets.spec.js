'use strict';

/*
 * category-presets.spec.js — 分类预设（1.1.5）
 *
 * 覆盖三件事：
 *   1. 选“木材”导入 → 自动套木材预设：粗糙度走源图辅助、有强度、金属 0；
 *   2. 手动改过参数后，再导入同类别的图 → 保留手改，不被覆盖；
 *   3. 类别换成“金属” → 重新套用：金属 1、基础粗糙度落到金属档。
 */

const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  const started = Date.now();
  const failures = [];
  const steps = [];
  function check(label, ok, detail) {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  }

  await driver.waitForBoot(ctx);

  const readSettings = () =>
    ctx.js(`(function(){
      return {
        rough: NMO_RoughnessMap.getSettings(),
        metal: NMO_MetallicMap.getSettings(),
        roughBox: Number(document.getElementById('rough_value').value),
        roughNum: Number(document.getElementById('rough_value_nmb').value),
        roughModeValue: document.getElementById('rough_mode').value,
        metalModeValue: document.getElementById('metal_mode').value,
        mean: NMO_CategoryPresets.meanLuma(),
        tableWood: NMO_CategoryPresets.table.wood,
        describeWood: NMO_CategoryPresets.describe('wood')
      };
    })()`);

  const canvasStats = () =>
    ctx.js(`(function(){
      function stats(canvas){
        var c = canvas.getContext('2d');
        var d = c.getImageData(0, 0, canvas.width, canvas.height).data;
        var min = 255, max = 0, sum = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) { var v = d[i]; if (v < min) min = v; if (v > max) max = v; sum += v; n++; }
        return { min: min, max: max, mean: Math.round(sum / n) };
      }
      return {
        rough: stats(NMO_RoughnessMap.roughness_canvas),
        metal: stats(NMO_MetallicMap.metallic_canvas),
        roughSize: [NMO_RoughnessMap.roughness_canvas.width, NMO_RoughnessMap.roughness_canvas.height]
      };
    })()`);

  /* ---------------- 1. 木材 ---------------- */
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), null, {
    category: 'wood',
    keepContext: true
  });
  const wood = await readSettings();
  const woodStats = await canvasStats();

  check('C01 木材预设把粗糙度切到“源图辅助”', wood.rough.mode === 'source', wood.rough.mode);
  check(
    'C02 木材基础值落在 0.62±0.13',
    Math.abs(wood.rough.base - 0.62) <= 0.13,
    String(wood.rough.base)
  );
  check('C03 木材强度 0.55', Math.abs(wood.rough.strength - 0.55) < 1e-6, String(wood.rough.strength));
  check('C04 木材细节来源是“局部细节”', wood.rough.detail === 'detail', wood.rough.detail);
  check('C05 木材金属度 0（非金属）', wood.metal.mode === 'none', wood.metal.mode);
  check(
    'C06 滑块与数字框都同步到基础值',
    wood.roughBox === wood.rough.base && Math.abs(wood.roughNum - wood.rough.base) < 0.005,
    JSON.stringify({ box: wood.roughBox, num: wood.roughNum, base: wood.rough.base })
  );
  check(
    'C07 粗糙度图确实随源图变化（不是常数）',
    woodStats.rough.max - woodStats.rough.min >= 10,
    JSON.stringify(woodStats.rough)
  );
  check(
    'C08 粗糙度图尺寸跟随源图',
    woodStats.roughSize[0] === 256 && woodStats.roughSize[1] === 256,
    JSON.stringify(woodStats.roughSize)
  );
  check('C09 分类弹窗的预告文案带基础值', /0\.62/.test(wood.describeWood || ''), wood.describeWood);

  /* ---------------- 2. 手改后不被覆盖 ---------------- */
  const tweakedBase = wood.rough.base;
  await ctx.js(`(function(){
    var el = document.getElementById('rough_strength');
    el.value = '0.5';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await ctx.wait(250);

  await driver.loadHeightFile(ctx, driver.fixture('height-300x200.png'), null, {
    category: 'wood',
    keepContext: true
  });
  const second = await readSettings();
  check(
    'C10 同类别再导入：手改的强度保留',
    Math.abs(second.rough.strength - 0.5) < 1e-6,
    String(second.rough.strength)
  );
  check(
    'C11 同类别再导入：基础值不被重算',
    Math.abs(second.rough.base - tweakedBase) < 1e-6,
    JSON.stringify({ before: tweakedBase, after: second.rough.base })
  );

  /* ---------------- 3. 换类别 ---------------- */
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), null, {
    category: 'metal',
    keepContext: true
  });
  const metal = await readSettings();
  const metalStats = await canvasStats();

  check('C12 换成金属：金属模式=裸金属', metal.metal.mode === 'full', metal.metal.mode);
  check(
    'C13 换成金属：基础粗糙度落到 0.35±0.13',
    Math.abs(metal.rough.base - 0.35) <= 0.13,
    String(metal.rough.base)
  );
  check(
    'C14 换成金属：强度回到 0.45（手改被新类别覆盖）',
    Math.abs(metal.rough.strength - 0.45) < 1e-6,
    String(metal.rough.strength)
  );
  check('C15 金属图整张为 255', metalStats.metal.min === 255 && metalStats.metal.max === 255, JSON.stringify(metalStats.metal));

  const errors = ctx.consoleLog.filter((entry) => entry.level === 'error' || entry.level === 3);
  check('C16 无未预期的控制台错误', errors.length === 0, JSON.stringify(errors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'category-presets',
    durationMs: Date.now() - started,
    steps,
    failures,
    wood,
    second,
    metal,
    woodStats,
    metalStats,
    checkedAt: new Date().toISOString()
  };
};
