'use strict';

/*
 * previewzoom.probe.js — 1.1.15 预览缩放的外观证据。
 *
 * 量：画布 276、预览框 294、三张顶边齐平；
 * 拍：1× / 2× / 放大后拖动 三张图，外加中间贴图预览的 2×。
 */

const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'));
  await ctx.wait(600);

  const rect = async (id, pad) =>
    ctx.js(`(function () {
      var r = document.getElementById('${id}').getBoundingClientRect();
      var p = ${pad || 0};
      return { x: r.left - p, y: r.top - p, width: r.width + p * 2, height: r.height + p * 2 };
    })()`);

  const row = await ctx.js(`(function () {
    var ids = ['height_map', 'normal_map', 'render_view'];
    var r = ids.map(function (id) { return document.getElementById(id).getBoundingClientRect(); });
    var c = document.querySelector('.texture_container .tabs').getBoundingClientRect();
    return {
      boxes: r.map(function (b) {
        return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
      }),
      tabs: { x: Math.round(c.left), w: Math.round(c.width) },
      canvas: (function () {
        var cv = document.getElementById('height_canvas').getBoundingClientRect();
        return { w: Math.round(cv.width), h: Math.round(cv.height) };
      })(),
      page: { scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight }
    };
  })()`);

  const previewsRect = await ctx.js(`(function () {
    var boxes = ['height_map', 'normal_map', 'render_view'].map(function (id) {
      return document.getElementById(id).getBoundingClientRect();
    });
    var left = Math.min.apply(null, boxes.map(function (b) { return b.left; }));
    var right = Math.max.apply(null, boxes.map(function (b) { return b.right; }));
    var top = Math.min.apply(null, boxes.map(function (b) { return b.top; }));
    var bottom = Math.max.apply(null, boxes.map(function (b) { return b.bottom; }));
    return { x: left - 6, y: top - 38, width: right - left + 12, height: bottom - top + 44 };
  })()`);

  const shot1 = await ctx.screenshotRect('zoom-1x.png', previewsRect);

  const center = async (id) =>
    ctx.js(`(function () {
      var r = document.getElementById('${id}').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);

  const hc = await center('height_map');
  ctx.win.webContents.sendInputEvent({
    type: 'mouseWheel', x: Math.round(hc.x), y: Math.round(hc.y), deltaX: 0, deltaY: 460, canScroll: true
  });
  await ctx.wait(350);
  const shot2 = await ctx.screenshotRect('zoom-2x-height.png', previewsRect);
  const zoomed = await ctx.js(`(function () {
    var c = document.getElementById('height_canvas');
    var r = c.getBoundingClientRect();
    return { scale: NMO_PreviewZoom.getScale('height_map'), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);

  /* 放大后往左上拖 30px，看画面是否平移 */
  await ctx.js(`(function () {
    var view = document.getElementById('height_map');
    var canvas = view.querySelector('canvas');
    var r = view.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    function fire(type, px, py) {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1,
        clientX: px, clientY: py
      }));
    }
    fire('pointerdown', x, y);
    fire('pointermove', x - 30, y - 24);
    fire('pointerup', x - 30, y - 24);
  })()`);
  await ctx.wait(200);
  const shot3 = await ctx.screenshotRect('zoom-2x-panned.png', previewsRect);

  const nc = await center('normal_map');
  await ctx.js("NMO_PreviewZoom.resetAll()");
  ctx.win.webContents.sendInputEvent({
    type: 'mouseWheel', x: Math.round(nc.x), y: Math.round(nc.y), deltaX: 0, deltaY: 380, canScroll: true
  });
  await ctx.wait(350);
  const shot4 = await ctx.screenshotRect('zoom-2x-normal.png', previewsRect);
  const normalScale = await ctx.js("NMO_PreviewZoom.getScale('normal_map')");

  const state = {
    ok: true,
    spec: 'previewzoom',
    layout: row,
    zoomed,
    normalScale,
    shots: { one: shot1, height: shot2, panned: shot3, normal: shot4 },
    checkedAt: new Date().toISOString()
  };
  return state;
};
