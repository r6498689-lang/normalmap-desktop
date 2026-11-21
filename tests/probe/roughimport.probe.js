'use strict';

/*
 * roughimport.probe.js — 导入贴图模式下的「基础值 / 强度」量尺子。
 *
 *   node tests/probe.js roughimport
 *
 * 要证明四件事：
 *   1. 选中预设后，基础值被对齐到贴图自身的中值（画面＝原图，不整体增亮）；
 *   2. 拖基础值 → 输出均值跟着走（原来是死的）；
 *   3. 拖强度 → 对比变大（max−min 变大，均值基本不动）；
 *   4. 强度归 0 时逐像素回到原贴图（哈希等于 adopted 那一张）。
 */

const driver = require('../lib/driver');

function snapshot(label) {
  return `(function(){
    var c = NMO_RoughnessMap.roughness_canvas;
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    var min = 255, max = 0, sum = 0, n = 0, hash = 0;
    for (var i = 0; i < d.length; i += 4) {
      var v = d[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v; n += 1;
      hash = (hash * 31 + v) % 2147483647;
    }
    var s = NMO_RoughnessMap.getSettings();
    var slider = document.getElementById('rough_value');
    var num = document.getElementById('rough_value_nmb');
    return {
      label: ${JSON.stringify(label)},
      mode: s.mode,
      base: s.base,
      strength: s.strength,
      mapMean: typeof NMO_RoughnessMap.mapMean === 'number'
        ? Math.round(NMO_RoughnessMap.mapMean * 1000) / 1000 : null,
      sliderValue: Number(slider.value),
      numberValue: Number(num.value),
      min: min, max: max,
      spread: max - min,
      mean: Math.round(sum / n),
      hash: hash,
      status: document.getElementById('nmo_status').textContent
    };
  })()`;
}

function setRange(id, value) {
  return `(function(){
    var el = document.getElementById('${id}');
    el.value = ${JSON.stringify(String(value))};
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`;
}

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-300x200.png'), null, {
    category: 'wood',
    keepContext: true
  });
  await ctx.js("document.getElementById('tab_btn_roughness').click()");
  await ctx.wait(400);

  // 选一张“明暗分布有明显中值”的遮罩
  await ctx.js(`(function(){
    var s = document.getElementById('rough_preset');
    s.value = 'peeling-wood';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await ctx.waitFor("NMO_RoughnessMap.getPresetId() === 'peeling-wood' && NMO_RoughnessMap.hasData()", 20000);
  await ctx.wait(400);
  const adopted = await ctx.js(snapshot('adopted'));

  // 1) 基础值 +0.2：整张图应整体抬高，均值跟着走
  await ctx.js(setRange('rough_value_nmb', 0.9));
  await ctx.wait(400);
  const highBase = await ctx.js(snapshot('base-0.9'));

  // 2) 基础值回落
  await ctx.js(setRange('rough_value_nmb', adopted.base));
  await ctx.wait(400);
  const backBase = await ctx.js(snapshot('base-back'));

  // 3) 强度 0.6：对比放大，均值基本不动、极差变大
  await ctx.js(setRange('rough_strength', 0.6));
  await ctx.wait(400);
  const strong = await ctx.js(snapshot('strength-0.6'));

  // 4) 强度归 0：应回到 adopted 那张（逐像素哈希一致）
  await ctx.js(setRange('rough_strength', 0));
  await ctx.wait(400);
  const backZero = await ctx.js(snapshot('strength-0'));

  const shot = await ctx.screenshotRect('roughimport-params.png', await ctx.js(`(function(){
    var r = document.getElementById('cell_params').getBoundingClientRect();
    return { x: r.left - 4, y: r.top - 4, width: r.width + 8, height: r.height + 8 };
  })()`));

  return {
    ok: true,
    spec: 'roughimport',
    adopted: adopted,
    highBase: highBase,
    backBase: backBase,
    strong: strong,
    backZero: backZero,
    screenshot: shot
  };
};
