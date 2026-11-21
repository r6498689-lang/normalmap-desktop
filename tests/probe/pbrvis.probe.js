'use strict';

/*
 * pbrvis.probe.js — 试几种“看得出粗糙度差别”的展示方式。
 *   node tests/probe.js pbrvis
 *
 * 对比：立方体正面 / 立方体转 35° / 球体，各自 rough 0.05 与 0.95 的差异。
 */
const driver = require('../lib/driver');

const setRange = (id, value) =>
  `(function(){
    var el = document.getElementById('${id}');
    el.value = ${JSON.stringify(String(value))};
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`;

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), null, {
    category: 'metal',
    keepContext: true
  });
  await ctx.wait(600);

  await ctx.js(`(function(){
    var t = document.getElementById('pbr_preview_toggle');
    if (!t.checked) t.click();
    NMO_RenderView.setRotationEnabled(false);
    var mm = document.getElementById('metal_mode');
    mm.value = 'none';
    mm.dispatchEvent(new Event('change', { bubbles: true }));
    var rm = document.getElementById('rough_mode');
    rm.value = 'uniform';
    rm.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await ctx.wait(900);

  const rect = await ctx.js(`(function(){
    var r = document.getElementById('render_view').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);

  const shots = {};

  async function pair(name) {
    await ctx.js(setRange('rough_value_nmb', 0.05));
    await ctx.wait(700);
    shots[name + 'Low'] = await ctx.screenshotRect(name + '-low.png', rect);
    await ctx.js(setRange('rough_value_nmb', 0.95));
    await ctx.wait(700);
    shots[name + 'High'] = await ctx.screenshotRect(name + '-high.png', rect);
  }

  // A. 立方体正面（现状）
  await pair('cube-front');

  // B. 立方体转 35°，能看到三个面
  await ctx.js(`(function(){
    var m = NMO_RenderView.render_model;
    m.rotation.y = 0.6;
    m.rotation.x = 0.25;
  })()`);
  await ctx.wait(500);
  await pair('cube-tilted');

  // C. 球体
  await ctx.js(`(function(){
    NMO_RenderView.setModel('Sphere');
    NMO_RenderView.setRotationEnabled(false);
    var m = NMO_RenderView.render_model;
    if (m) { m.rotation.y = 0; m.rotation.x = 0; }
  })()`);
  await ctx.wait(800);
  await pair('sphere');

  return { ok: true, spec: 'pbrvis', rect: rect, shots: shots };
};
