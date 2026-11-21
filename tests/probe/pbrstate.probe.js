'use strict';

/*
 * pbrstate.probe.js — 把 3D 预览的材质/几何实际状态读出来。
 *   node tests/probe.js pbrstate
 */
const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), null, {
    category: 'metal',
    keepContext: true
  });
  await ctx.wait(600);

  const before = await ctx.js(`(function(){
    var m = NMO_RenderView.render_model;
    return {
      model: m ? m.geometry.type : null,
      material: m && m.material ? (m.material.name || m.material.type) : null,
      pbrToggle: document.getElementById('pbr_preview_toggle').checked
    };
  })()`);

  await ctx.js(`(function(){
    var t = document.getElementById('pbr_preview_toggle');
    if (!t.checked) t.click();
    NMO_RenderView.setRotationEnabled(false);
  })()`);
  await ctx.wait(900);

  const after = await ctx.js(`(function(){
    var m = NMO_RenderView.render_model;
    var mat = m.material;
    function tex(t) {
      if (!t) return null;
      var img = t.image;
      return {
        kind: img ? (img.tagName || img.constructor.name) : null,
        w: img ? (img.width || 0) : 0,
        h: img ? (img.height || 0) : 0
      };
    }
    return {
      model: m.geometry.type,
      material: mat.name || mat.type,
      type: mat.type,
      color: mat.color ? mat.color.getHexString() : null,
      metalness: mat.metalness,
      roughness: mat.roughness,
      envMap: !!mat.envMap,
      envMapIntensity: mat.envMapIntensity,
      map: tex(mat.map),
      roughnessMap: tex(mat.roughnessMap),
      metalnessMap: tex(mat.metalnessMap),
      normalMap: tex(mat.normalMap),
      aoMap: tex(mat.aoMap),
      lights: NMO_RenderView.scene.children
        .filter(function (o) { return o.isLight; })
        .map(function (o) { return { type: o.type, intensity: o.intensity, color: o.color.getHexString() }; }),
      background: NMO_RenderView.scene.background ? NMO_RenderView.scene.background.constructor.name : null,
      cubeReady: !!(NMO_RenderView.textureCube && NMO_RenderView.textureCube.image)
    };
  })()`);

  return { ok: true, spec: 'pbrstate', before: before, after: after };
};
