'use strict';

/*
 * catpreset.probe.js — 量“分类预设”到底套上了没有。
 * 不是测试门禁，只出数：node tests/probe.js catpreset
 */

const path = require('node:path');
const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);

  function snapshot(label) {
    return ctx.js(`(function(){
      return {
        label: ${JSON.stringify(label)},
        rough: NMO_RoughnessMap.getSettings(),
        metal: NMO_MetallicMap.getSettings(),
        roughValueBox: document.getElementById('rough_value').value,
        roughValueNum: document.getElementById('rough_value_nmb').value,
        roughMode: document.getElementById('rough_mode').value,
        metalMode: document.getElementById('metal_mode').value,
        mean: NMO_CategoryPresets.meanLuma(),
        baseForWood: NMO_CategoryPresets.baseFor('wood'),
        baseForMetal: NMO_CategoryPresets.baseFor('metal')
      };
    })()`);
  }

  const steps = [];
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), null, {
    category: 'wood',
    keepContext: true
  });
  steps.push(await snapshot('wood 第一次'));

  // 手动改强度：模拟用户微调
  await ctx.js(`(function(){
    var el = document.getElementById('rough_strength');
    el.value = '0.5';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await ctx.wait(300);
  steps.push(await snapshot('wood 手改强度 0.5'));

  await driver.loadHeightFile(ctx, driver.fixture('height-300x200.png'), null, {
    category: 'wood',
    keepContext: true
  });
  steps.push(await snapshot('wood 第二次（手改应保留）'));

  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), null, {
    category: 'metal',
    keepContext: true
  });
  steps.push(await snapshot('metal（类别变了应重套）'));

  const dialog = await ctx.js(`(function(){
    return typeof NMO_CategoryPresets.describe === 'function'
      ? NMO_CategoryPresets.describe('wood')
      : null;
  })()`);

  return { ok: true, spec: 'catpreset', steps, dialog };
};
