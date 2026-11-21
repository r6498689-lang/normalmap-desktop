'use strict';

/*
 * maskpreset.probe.js — 内置遮罩预设的量尺子脚本。
 *
 *   node tests/probe.js maskpreset
 *
 * 量四件事：
 *   1. 预设下拉里是不是 1 + 10 个选项；
 *   2. 选中一个预设后，来源是否自动变成 imported、画布是否真的有纹理；
 *   3. 换源图后预设是否仍然有效、画布是否按新源图尺寸重采样；
 *   4. 选回“选择预设…”是否回到统一数值。
 */

const driver = require('../lib/driver');

function statsScript(label) {
  return `(function(){
    var c = NMO_RoughnessMap.roughness_canvas;
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    var min = 255, max = 0, sum = 0, n = 0;
    for (var i = 0; i < d.length; i += 4) {
      var v = d[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v; n += 1;
    }
    return {
      label: ${JSON.stringify(label)},
      mode: document.getElementById('rough_mode').value,
      preset: NMO_RoughnessMap.getPresetId ? NMO_RoughnessMap.getPresetId() : '',
      valid: NMO_RoughnessMap.hasData(),
      error: NMO_RoughnessMap.lastError,
      width: c.width,
      height: c.height,
      min: min,
      max: max,
      mean: Math.round(sum / n),
      status: document.getElementById('nmo_status').textContent
    };
  })()`;
}

function pick(id) {
  return `(function(){
    var s = document.getElementById('rough_preset');
    s.value = ${JSON.stringify(id)};
    s.dispatchEvent(new Event('change', { bubbles: true }));
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

  const before = await ctx.js(`(function(){
    var s = document.getElementById('rough_preset');
    return {
      exists: Boolean(s),
      options: s ? s.options.length : 0,
      values: s ? Array.prototype.map.call(s.options, function (o) { return o.value; }) : [],
      labels: s ? Array.prototype.map.call(s.options, function (o) { return o.textContent; }) : [],
      sourceRowButton: Boolean(document.querySelector('#roughness_settings .source_row #rough_import')),
      importInSourceRow: (function () {
        var b = document.getElementById('rough_import');
        return Boolean(b && b.closest('.source_row'));
      })(),
      presetBelowMax: (function () {
        var sel = document.getElementById('rough_preset');
        var max = document.getElementById('rough_max_nmb');
        if (!sel || !max) return false;
        return sel.getBoundingClientRect().top > max.getBoundingClientRect().top;
      })()
    };
  })()`);

  const geom = await ctx.js(`(function () {
    function r(el) {
      if (!el) return null;
      var b = el.getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) };
    }
    var preset = document.getElementById('rough_preset');
    return {
      panel: r(document.getElementById('cell_params')),
      settings: r(document.getElementById('roughness_settings')),
      table: r(document.querySelector('#roughness_settings .options_top')),
      sourceCell: r(document.getElementById('rough_import').closest('td')),
      select: r(document.getElementById('rough_mode')),
      btn: r(document.getElementById('rough_import')),
      preset: r(preset),
      presetCell: r(preset.closest('td')),
      reset: r(document.getElementById('reset_row')),
      status: r(document.getElementById('pbr_status')),
      tableWidth: getComputedStyle(document.querySelector('#roughness_settings .options_top')).width,
      cellWidth: getComputedStyle(document.getElementById('cell_params')).width
    };
  })()`);

  await ctx.js(pick('peeling-wood'));
  await ctx.waitFor(
    "NMO_RoughnessMap.getPresetId && NMO_RoughnessMap.getPresetId() === 'peeling-wood' && NMO_RoughnessMap.hasData()",
    20000
  );
  await ctx.wait(400);
  const first = await ctx.js(statsScript('peeling-wood'));
  const shot = await ctx.screenshot('mask-preset-panel.png');
  const cell = await ctx.js(`(function () {
    var r = document.getElementById('cell_params').getBoundingClientRect();
    return { x: r.left - 6, y: r.top - 6, width: r.width + 12, height: r.height + 12 };
  })()`);
  const crop = await ctx.screenshotRect('mask-preset-panel-crop.png', cell);

  // 换一张源图：预设属于应用本身，不该像导入的贴图那样失效
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), null, {
    category: 'wood',
    keepContext: true
  });
  await ctx.wait(800);
  const afterSource = await ctx.js(statsScript('after-source-change'));

  await ctx.js(pick('soft-cloud'));
  await ctx.waitFor("NMO_RoughnessMap.getPresetId() === 'soft-cloud' && NMO_RoughnessMap.hasData()", 20000);
  await ctx.wait(400);
  const second = await ctx.js(statsScript('soft-cloud'));

  await ctx.js(pick(''));
  await ctx.wait(400);
  const cleared = await ctx.js(statsScript('cleared'));

  /* 混合模式：贴图 + 源图 */
  await ctx.js(pick('peeling-wood'));
  await ctx.waitFor("NMO_RoughnessMap.getPresetId() === 'peeling-wood' && NMO_RoughnessMap.hasData()", 20000);
  await ctx.js(`(function () {
    var s = document.getElementById('rough_mode');
    s.value = 'mixed';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    var el = document.getElementById('rough_strength');
    el.value = '0.6';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    var n = document.getElementById('rough_strength_nmb');
    if (n) n.value = '0.60';
  })()`);
  await ctx.wait(600);
  const mixed = await ctx.js(statsScript('mixed'));
  const mixedShot = await ctx.screenshot('mask-preset-mixed.png');
  const mixedCrop = await ctx.screenshotRect('mask-preset-mixed-crop.png', await ctx.js(`(function () {
    var r = document.getElementById('cell_params').getBoundingClientRect();
    return { x: r.left - 6, y: r.top - 6, width: r.width + 12, height: r.height + 12 };
  })()`));
  const mixedGeom = await ctx.js(`(function () {
    var sel = document.getElementById('rough_mode');
    var b = sel.getBoundingClientRect();
    return { width: Math.round(b.width), text: sel.options[sel.selectedIndex].textContent };
  })()`);

  return {
    ok: true,
    spec: 'maskpreset',
    before: before,
    geom: geom,
    first: first,
    afterSource: afterSource,
    second: second,
    cleared: cleared,
    mixed: mixed,
    mixedGeom: mixedGeom,
    screenshot: shot,
    crop: crop,
    mixedShot: mixedShot,
    mixedCrop: mixedCrop
  };
};
