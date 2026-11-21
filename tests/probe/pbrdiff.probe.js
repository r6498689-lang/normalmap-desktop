'use strict';

/*
 * pbrdiff.probe.js — 3D 预览到底能不能看出粗糙度/金属度的差别。
 *
 *   node tests/probe.js pbrdiff
 *
 * 在同一个视角、同一张源图下拍四张 3D 画布：
 *   roughLow（0.05）/ roughHigh（0.95）/ metalNone（0）/ metalFull（1）
 * 然后由 tests/png-diff.js 比较，判断差异是否存在、是否够明显。
 */

const driver = require('../lib/driver');

const setRange = (id, value) =>
  `(function(){
    var el = document.getElementById('${id}');
    el.value = ${JSON.stringify(String(value))};
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`;

const setSelect = (id, value) =>
  `(function(){
    var el = document.getElementById('${id}');
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`;

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), null, {
    category: 'metal',
    keepContext: true
  });
  await ctx.wait(600);

  // 打开 PBR 预览（否则 3D 用的是老的 phong 路径，根本不看粗糙度/金属度）
  await ctx.js(`(function(){
    var t = document.getElementById('pbr_preview_toggle');
    if (!t.checked) t.click();
    document.getElementById('input_rot').checked = false;
    NMO_RenderView.setRotationEnabled(false);
  })()`);
  await ctx.wait(800);

  const rect = await ctx.js(`(function(){
    var c = document.getElementById('render_view');
    var r = c.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);

  // 1) 粗糙度：极低 vs 极高（金属度先压到 0，避免金属吃掉漫反射差异）
  await ctx.js(setSelect('metal_mode', 'none'));
  await ctx.js(setSelect('rough_mode', 'uniform'));
  await ctx.js(setRange('rough_value_nmb', 0.05));
  await ctx.wait(700);
  const roughLow = await ctx.screenshotRect('pbr-rough-005.png', rect);

  await ctx.js(setRange('rough_value_nmb', 0.95));
  await ctx.wait(700);
  const roughHigh = await ctx.screenshotRect('pbr-rough-095.png', rect);

  // 2) 金属度：0 vs 1（粗糙度固定中等 0.4）
  await ctx.js(setRange('rough_value_nmb', 0.4));
  await ctx.wait(500);
  const metalNone = await ctx.screenshotRect('pbr-metal-none.png', rect);

  await ctx.js(setSelect('metal_mode', 'full'));
  await ctx.wait(700);
  const metalFull = await ctx.screenshotRect('pbr-metal-full.png', rect);

  const state = await ctx.js(`(function(){
    return {
      pbrOn: document.getElementById('pbr_preview_toggle').checked,
      roughMode: NMO_RoughnessMap.getSettings().mode,
      roughValue: NMO_RoughnessMap.getSettings().value,
      metalMode: NMO_MetallicMap.getSettings().mode,
      hasRough: NMO_RoughnessMap.hasData(),
      hasMetal: NMO_MetallicMap.hasData(),
      background: NMO_RenderView.scene && NMO_RenderView.scene.background ? 'cube' : 'null',
      material: NMO_RenderView.render_model && NMO_RenderView.render_model.material
        ? NMO_RenderView.render_model.material.name || NMO_RenderView.render_model.material.type
        : null
    };
  })()`);

  return {
    ok: true,
    spec: 'pbrdiff',
    rect: rect,
    state: state,
    shots: { roughLow, roughHigh, metalNone, metalFull }
  };
};
