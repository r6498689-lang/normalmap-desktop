'use strict';

/*
 * tabs.probe.js — 选项卡逐个量右边界，确认放大字号后没有溢出预览框。
 *
 *   node tests/probe.js tabs
 */

const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await ctx.wait(500);

  const data = await ctx.js(`(function () {
    function box(el) {
      var r = el.getBoundingClientRect();
      return { x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
    }
    var row = document.querySelector('.texture_container .tabs');
    var frame = document.getElementById('normal_map');
    return {
      row: box(row),
      frame: box(frame),
      tabs: Array.prototype.map.call(row.querySelectorAll('input.tab_button'), function (b) {
        return { label: b.value, box: box(b) };
      }),
      overflow: row.scrollWidth - row.clientWidth
    };
  })()`);

  const shot = await ctx.screenshotRect('tabs-strip.png', await ctx.js(`(function () {
    var r = document.querySelector('.texture_container .tabs').getBoundingClientRect();
    var f = document.getElementById('normal_map').getBoundingClientRect();
    return { x: r.left - 6, y: r.top - 6, width: Math.max(r.width, f.width) + 12, height: 44 };
  })()`));

  return { ok: true, spec: 'tabs', data: data, screenshot: shot };
};
