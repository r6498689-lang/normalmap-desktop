'use strict';

/*
 * rot.probe.js — 3D 自动旋转开关的取证脚本。
 *
 *   node tests/probe.js rot
 *
 * 依次记录：默认（关）→ 打开 → 再关，每一步都取模型角度、开关文案/滑轨状态，
 * 并在开/关两种状态下各截一张整窗与 3D 卡片图，作为肉眼可核对的证据。
 */

const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'));
  await ctx.wait(700);

  const readState = () =>
    ctx.js(`(function () {
      var box = document.getElementById('input_rot');
      var label = document.getElementById('rot_switch');
      var track = document.querySelector('#rot_switch .d3_switch_track');
      var knob = document.querySelector('#rot_switch .d3_switch_knob');
      var tr = track ? getComputedStyle(track) : null;
      var kr = knob ? getComputedStyle(knob) : null;
      var boxRect = label ? label.getBoundingClientRect() : null;
      return {
        enabled: NMO_RenderView.rotation_enabled,
        checked: box ? box.checked : null,
        text: document.getElementById('rot_switch_text').textContent,
        onClass: label ? label.classList.contains('is-on') : null,
        trackBg: tr ? tr.backgroundColor : null,
        knobTransform: kr ? kr.transform : null,
        angle: {
          x: NMO_RenderView.render_model ? NMO_RenderView.render_model.rotation.x : null,
          y: NMO_RenderView.render_model ? NMO_RenderView.render_model.rotation.y : null
        },
        rect: boxRect
          ? { x: Math.round(boxRect.left), y: Math.round(boxRect.top), w: Math.round(boxRect.width), h: Math.round(boxRect.height) }
          : null
      };
    })()`);

  const rect = (id, pad) =>
    ctx.js(`(function () {
      var r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      return { x: r.left - ${pad || 0}, y: r.top - ${pad || 0}, width: r.width + ${(pad || 0) * 2}, height: r.height + ${(pad || 0) * 2} };
    })()`);

  // 1) 默认：关，静止
  const offA = await readState();
  const shotOff = await ctx.screenshot('rot-off-full.png');
  const cardOff = await ctx.screenshotRect('rot-off-card.png', await rect('cell_library', 4));
  await ctx.wait(600);
  const offB = await readState();

  // 2) 打开：转
  await ctx.js("document.getElementById('input_rot').click()");
  await ctx.wait(700);
  const onA = await readState();
  const shotOn = await ctx.screenshot('rot-on-full.png');
  const cardOn = await ctx.screenshotRect('rot-on-card.png', await rect('cell_library', 4));
  await ctx.wait(400);
  const onB = await readState();

  // 3) 再关：冻结，并验证拖动只动相机
  await ctx.js("document.getElementById('input_rot').click()");
  await ctx.wait(150);
  const offAgainA = await readState();
  await ctx.wait(500);
  const offAgainB = await readState();

  const drag = await ctx.js(`(function () {
    var el = NMO_RenderView.renderer.domElement;
    var r = el.getBoundingClientRect();
    var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    function fire(type, cx, cy) {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: cx, clientY: cy, button: 0, buttons: type === 'mouseup' ? 0 : 1
      }));
    }
    var before = NMO_RenderView.camera.position.clone();
    var model = NMO_RenderView.render_model.rotation.y;
    fire('mousedown', x, y);
    fire('mousemove', x + 60, y);
    fire('mouseup', x + 60, y);
    var moved = before.distanceTo(NMO_RenderView.camera.position);
    var drift = Math.abs(NMO_RenderView.render_model.rotation.y - model);
    NMO_RenderView.camera.position.copy(before);
    NMO_RenderView.camera.lookAt({ x: 0, y: 0, z: 0 });
    return { cameraMoved: moved, modelDrift: drift };
  })()`);

  return {
    ok: true,
    spec: 'rot',
    offA: offA,
    offB: offB,
    onA: onA,
    onB: onB,
    offAgainA: offAgainA,
    offAgainB: offAgainB,
    drag: drag,
    screenshots: { off: shotOff, on: shotOn, cardOff: cardOff, cardOn: cardOn }
  };
};
