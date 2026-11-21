'use strict';

/*
 * catpreset-shot.probe.js — 导入一张“木材”图后，停在粗糙度选项卡截图。
 * 只为证据：node tests/probe.js catpreset-shot
 */

const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), null, {
    category: 'wood',
    keepContext: true
  });
  await ctx.js("document.getElementById('tab_btn_roughness').click()");
  await ctx.wait(600);
  const shot = await ctx.screenshot('catpreset-wood-roughness.png');
  const state = await ctx.js(`(function(){
    return {
      mode: document.getElementById('rough_mode').value,
      value: document.getElementById('rough_value').value,
      strength: document.getElementById('rough_strength').value,
      detail: document.getElementById('rough_detail').value,
      metalMode: document.getElementById('metal_mode').value,
      status: document.getElementById('nmo_status').textContent
    };
  })()`);
  return { ok: true, spec: 'catpreset-shot', state, screenshot: shot };
};
