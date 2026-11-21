'use strict';

/*
 * preview-zoom.spec.js
 * 1.1.15：左侧高度图 / 中间贴图预览的滚轮缩放。
 *
 * 覆盖：
 *   - 默认 1×，画布正好 276；
 *   - 真实滚轮（webContents.sendInputEvent）放大、缩小回 1×；
 *   - 放大后拖动平移，且拖动后的 click 不会触发“点一下选图”；
 *   - 双击还原；
 *   - 两张预览各记各的缩放，互不影响；
 *   - 缩放时预览框本身尺寸不变（只裁内容，不改布局）。
 */

const driver = require('../lib/driver');

const SIZE = 276;

function wheel(ctx, x, y, deltaY) {
  ctx.win.webContents.sendInputEvent({
    type: 'mouseWheel',
    x: Math.round(x),
    y: Math.round(y),
    deltaX: 0,
    /* sendInputEvent 沿用原生约定（正数＝向上），DOM WheelEvent 相反，
       这里先翻一次符号，让调用方按 DOM 的直觉写。 */
    deltaY: -deltaY,
    canScroll: true
  });
}

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'));
  await ctx.wait(600);

  const read = (id) =>
    ctx.js(`(function () {
      var view = document.getElementById('${id}');
      var canvas = view.querySelector('canvas');
      var vr = view.getBoundingClientRect();
      var cr = canvas.getBoundingClientRect();
      return {
        scale: NMO_PreviewZoom.getScale('${id}'),
        viewW: Math.round(vr.width),
        viewH: Math.round(vr.height),
        canvasW: Math.round(cr.width),
        canvasH: Math.round(cr.height),
        transform: canvas.style.transform,
        cursor: canvas.style.cursor,
        badge: (function () {
          var b = view.querySelector('.preview_zoom_badge');
          return b ? b.classList.contains('is-visible') : null;
        })()
      };
    })()`);

  const origin = async (id) =>
    ctx.js(`(function () {
      var r = document.getElementById('${id}').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);

  // ---------------------------------------------------------------- 初始状态
  const height0 = await read('height_map');
  const normal0 = await read('normal_map');
  check('高度图画布默认 276×276', height0.canvasW === SIZE && height0.canvasH === SIZE, JSON.stringify(height0));
  check('贴图预览画布默认 276×276', normal0.canvasW === SIZE && normal0.canvasH === SIZE, JSON.stringify(normal0));
  check('默认缩放 1×', height0.scale === 1 && normal0.scale === 1, height0.scale + ' / ' + normal0.scale);

  // ---------------------------------------------------------------- 滚轮放大（真实事件）
  const hp = await origin('height_map');
  wheel(ctx, hp.x, hp.y, -300);
  await ctx.wait(250);
  const height1 = await read('height_map');
  check('滚轮向上放大高度图', height1.scale > 1.4, JSON.stringify(height1));
  check(
    '画布按倍数变大（276 → 276×scale）',
    Math.abs(height1.canvasW - SIZE * height1.scale) <= 2,
    height1.canvasW + ' vs ' + (SIZE * height1.scale).toFixed(1)
  );
  check('预览框本身尺寸不变（只裁内容）', height1.viewW === height0.viewW && height1.viewH === height0.viewH, height1.viewW + '×' + height1.viewH);
  check('放大时出现倍数角标', height1.badge === true, String(height1.badge));
  check('放大后光标切换为抓取', height1.cursor === 'grab', height1.cursor);

  // ---------------------------------------------------------------- 拖动平移
  const beforeDrag = await ctx.js(`(function () {
    var c = document.getElementById('height_map').querySelector('canvas');
    var r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, tx: c.style.transform };
  })()`);
  const dragStart = { x: hp.x, y: hp.y };
  await ctx.js(`(function () {
    var view = document.getElementById('height_map');
    var canvas = view.querySelector('canvas');
    function fire(type, x, y) {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1,
        clientX: x, clientY: y
      }));
    }
    fire('pointerdown', ${dragStart.x}, ${dragStart.y});
    fire('pointermove', ${dragStart.x + 40}, ${dragStart.y + 30});
    fire('pointerup', ${dragStart.x + 40}, ${dragStart.y + 30});
  })()`);
  await ctx.wait(150);
  const afterDrag = await ctx.js(`(function () {
    var c = document.getElementById('height_map').querySelector('canvas');
    var r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, tx: c.style.transform };
  })()`);
  check(
    '放大后拖动可以平移画面',
    Math.abs(afterDrag.left - beforeDrag.left) > 10 || Math.abs(afterDrag.top - beforeDrag.top) > 10,
    JSON.stringify({ before: beforeDrag, after: afterDrag })
  );

  const clickBlocked = await ctx.js(`(function () {
    var canvas = document.getElementById('height_map').querySelector('canvas');
    var ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(ev);
    return ev.defaultPrevented;
  })()`);
  check('放大状态下单击被吞掉（不会弹出选图对话框）', clickBlocked === true, String(clickBlocked));

  // ---------------------------------------------------------------- 双击还原
  await ctx.js(`(function () {
    var canvas = document.getElementById('height_map').querySelector('canvas');
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  })()`);
  await ctx.wait(150);
  const height2 = await read('height_map');
  check('双击回到 1×', height2.scale === 1 && height2.canvasW === SIZE, JSON.stringify(height2));

  // ---------------------------------------------------------------- 缩小回 1×
  wheel(ctx, hp.x, hp.y, -200);
  await ctx.wait(150);
  const zoomed = await read('height_map');
  wheel(ctx, hp.x, hp.y, 400);
  await ctx.wait(200);
  const back = await read('height_map');
  check('滚轮向下可以缩小回 1×', zoomed.scale > 1 && back.scale === 1 && back.canvasW === SIZE, zoomed.scale + ' -> ' + back.scale);

  // ---------------------------------------------------------------- 两张预览互不影响
  const np = await origin('normal_map');
  wheel(ctx, np.x, np.y, -250);
  await ctx.wait(250);
  const normalZoom = await read('normal_map');
  const heightStill = await read('height_map');
  check('中间贴图预览也能滚轮放大', normalZoom.scale > 1.3, normalZoom.scale);
  check('两张预览的缩放互不影响', heightStill.scale === 1, 'height=' + heightStill.scale + ' normal=' + normalZoom.scale);

  await ctx.js("NMO_PreviewZoom.resetAll()");
  await ctx.wait(120);
  const normalReset = await read('normal_map');
  check('resetAll 把两张都还原', normalReset.scale === 1 && normalReset.canvasW === SIZE, JSON.stringify(normalReset));

  // ---------------------------------------------------------------- 预览框顶边仍然齐平
  const tops = await ctx.js(`(function () {
    return ['height_map', 'normal_map', 'render_view'].map(function (id) {
      return Math.round(document.getElementById(id).getBoundingClientRect().top);
    });
  })()`);
  check('三张预览顶边仍齐平', tops[0] === tops[1] && tops[1] === tops[2], JSON.stringify(tops));

  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无未预期的控制台错误', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'preview-zoom',
    size: SIZE,
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
