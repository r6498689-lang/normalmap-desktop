'use strict';

/*
 * metalmap.probe.js — 金属度画布到底变没变、纹理有没有重新上传。
 *   node tests/probe.js metalmap
 */
const driver = require('../lib/driver');

function canvasStats(which) {
  return `(function(){
    var c = NMO_${which === 'metal' ? 'MetallicMap.metallic_canvas' : 'RoughnessMap.roughness_canvas'};
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    var min = 255, max = 0, sum = 0, n = 0;
    for (var i = 0; i < d.length; i += 4) {
      var v = d[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v; n += 1;
    }
    return {
      size: [c.width, c.height],
      min: min, max: max, mean: Math.round(sum / n),
      version: NMO_${which === 'metal' ? 'MetallicMap' : 'RoughnessMap'}.version,
      mode: NMO_${which === 'metal' ? 'MetallicMap' : 'RoughnessMap'}.getSettings().mode
    };
  })()`;
}

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

  const atBoot = await ctx.js(canvasStats('metal'));

  await ctx.js(setSelect('metal_mode', 'none'));
  await ctx.wait(400);
  const none = await ctx.js(canvasStats('metal'));

  await ctx.js(setSelect('metal_mode', 'full'));
  await ctx.wait(400);
  const full = await ctx.js(canvasStats('metal'));

  const texState = await ctx.js(`(function(){
    var p = NMO_PBRPreview;
    return {
      enabled: p.enabled,
      roughnessVersion: p.roughnessVersion,
      metalnessVersion: p.metalnessVersion,
      mapVersion: NMO_MetallicMap.version,
      texImageIsCanvas: !!(p.metalnessTexture && p.metalnessTexture.image && p.metalnessTexture.image.tagName === 'CANVAS')
    };
  })()`);

  return { ok: true, spec: 'metalmap', atBoot: atBoot, none: none, full: full, texState: texState };
};
