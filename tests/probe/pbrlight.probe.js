'use strict';

/*
 * pbrlight.probe.js — 试“加一盏近相机点光”能不能把粗糙度差别做明显。
 *   node tests/probe.js pbrlight
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
    document.getElementById('metal_mode').value = 'none';
    document.getElementById('metal_mode').dispatchEvent(new Event('change'));
    document.getElementById('rough_mode').value = 'uniform';
    document.getElementById('rough_mode').dispatchEvent(new Event('change'));
  })()`);
  await ctx.wait(900);

  const rect = await ctx.js(`(function(){
    var r = document.getElementById('render_view').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);

  const shots = {};
  async function pair(tag) {
    await ctx.js(setRange('rough_value_nmb', 0.05));
    await ctx.wait(700);
    shots[tag + 'Low'] = await ctx.screenshotRect(tag + '-low.png', rect);
    await ctx.js(setRange('rough_value_nmb', 0.95));
    await ctx.wait(700);
    shots[tag + 'High'] = await ctx.screenshotRect(tag + '-high.png', rect);
  }

  await pair('base');

  // 加一盏近相机的点光，制造随粗糙度变化的高光
  const info = await ctx.js(`(function(){
    var rv = NMO_RenderView;
    var cam = rv.camera;
    var light = new THREE.PointLight(0xffffff, 1.4, 60);
    light.position.copy(cam.position);
    light.name = 'nmo-probe-light';
    rv.scene.add(light);
    return { cam: { x: cam.position.x, y: cam.position.y, z: cam.position.z }, added: true };
  })()`);
  await ctx.wait(500);
  await pair('point');

  // 再把环境强度提一档
  await ctx.js(`(function(){
    var m = NMO_RenderView.render_model.material;
    m.envMapIntensity = 1.8;
    m.needsUpdate = true;
  })()`);
  await ctx.wait(500);
  await pair('point-env');

  return { ok: true, spec: 'pbrlight', rect: rect, info: info, shots: shots };
};
