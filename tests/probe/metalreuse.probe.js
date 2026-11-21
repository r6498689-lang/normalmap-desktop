'use strict';

/*
 * metalreuse.probe.js — 金属度「复用粗糙度遮罩」量尺子。
 *   node tests/probe.js metalreuse
 */
const driver = require('../lib/driver');

const stats = (label) => `(function(){
  var c = NMO_MetallicMap.metallic_canvas;
  var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  var min = 255, max = 0, sum = 0, n = 0, hash = 0, zeros = 0, fulls = 0;
  for (var i = 0; i < d.length; i += 4) {
    var v = d[i];
    if (v < min) min = v;
    if (v > max) max = v;
    if (v === 0) zeros += 1;
    if (v === 255) fulls += 1;
    sum += v; n += 1;
    hash = (hash * 31 + v) % 2147483647;
  }
  var s = NMO_MetallicMap.getSettings();
  return {
    label: ${JSON.stringify(label)},
    mode: s.mode,
    valid: NMO_MetallicMap.hasData(),
    error: NMO_MetallicMap.lastError,
    size: [c.width, c.height],
    min: min, max: max, mean: Math.round(sum / n),
    zeroRatio: Number((zeros / n).toFixed(3)),
    fullRatio: Number((fulls / n).toFixed(3)),
    hash: hash,
    importDisabled: document.getElementById('metal_import').disabled,
    status: document.getElementById('nmo_status').textContent
  };
})()`;

const pickRough = (id) => `(function(){
  var s = document.getElementById('rough_preset');
  s.value = ${JSON.stringify(id)};
  s.dispatchEvent(new Event('change', { bubbles: true }));
})()`;

const setMetalMode = (value) => `(function(){
  var el = document.getElementById('metal_mode');
  el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('change', { bubbles: true }));
})()`;

const setThreshold = (value, soft) => `(function(){
  var t = document.getElementById('metal_threshold');
  t.value = ${JSON.stringify(String(value))};
  t.dispatchEvent(new Event('change', { bubbles: true }));
  var s = document.getElementById('metal_softness');
  s.value = ${JSON.stringify(String(soft))};
  s.dispatchEvent(new Event('change', { bubbles: true }));
})()`;

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-300x200.png'), null, {
    category: 'wood',
    keepContext: true
  });
  await ctx.js("document.getElementById('tab_btn_metallic').click()");
  await ctx.wait(400);

  // 先选一张粗糙度遮罩
  await ctx.js(pickRough('peeling-wood'));
  await ctx.waitFor("NMO_RoughnessMap.getPresetId() === 'peeling-wood' && NMO_RoughnessMap.hasData()", 20000);
  await ctx.wait(400);

  // 复用之前：金属度是非金属（全黑）
  const beforeReuse = await ctx.js(stats('before-reuse'));

  await ctx.js(setMetalMode('rough'));
  await ctx.wait(500);
  const reused = await ctx.js(stats('reused'));

  // 阈值 0.5、柔边 0 → 应该二值化
  await ctx.js(setThreshold(0.5, 0));
  await ctx.wait(400);
  const binary = await ctx.js(stats('threshold-0.5'));

  // 柔边 0.3 → 过渡带
  await ctx.js(setThreshold(0.5, 0.3));
  await ctx.wait(400);
  const soft = await ctx.js(stats('soft-0.3'));

  // 换粗糙度预设 → 金属度应该跟着换
  await ctx.js(setThreshold(0.5, 0));
  await ctx.js(pickRough('soft-cloud'));
  await ctx.waitFor("NMO_RoughnessMap.getPresetId() === 'soft-cloud'", 20000);
  await ctx.wait(500);
  const switched = await ctx.js(stats('switched-preset'));

  const shot = await ctx.screenshotRect('metal-reuse-params.png', await ctx.js(`(function(){
    var r = document.getElementById('cell_params').getBoundingClientRect();
    return { x: r.left - 4, y: r.top - 4, width: r.width + 8, height: r.height + 8 };
  })()`));

  return {
    ok: true,
    spec: 'metalreuse',
    beforeReuse, reused, binary, soft, switched,
    screenshot: shot
  };
};
