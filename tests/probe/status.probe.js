'use strict';
/**
 * 状态行排版取证：确认 #pbr_status 到底占几行、每行文字是什么。
 * 用 Range.getClientRects() 数行框，比 height/line-height 猜更可靠。
 */
const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await ctx.wait(500);

  const out = await ctx.js(`(function () {
    var el = document.getElementById('pbr_status');
    var cs = getComputedStyle(el);
    var node = el.firstChild;
    var lines = [];
    if (node && node.nodeType === 3) {
      var text = node.nodeValue;
      var range = document.createRange();
      var lineStart = 0;
      var prevTop = null;
      for (var i = 1; i <= text.length; i += 1) {
        range.setStart(node, lineStart);
        range.setEnd(node, Math.min(i, text.length));
        var rects = range.getClientRects();
        var r = rects.length ? rects[rects.length - 1] : null;
        var top = r ? Math.round(r.top) : null;
        if (prevTop !== null && top !== null && top !== prevTop) {
          lines.push(text.slice(lineStart, i - 1));
          lineStart = i - 1;
        }
        prevTop = top;
      }
      lines.push(text.slice(lineStart));
    }
    var b = el.getBoundingClientRect();
    return {
      text: el.textContent,
      lines: lines,
      lineCount: lines.length,
      box: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      padding: cs.padding,
      margin: cs.margin,
      whiteSpace: cs.whiteSpace
    };
  })()`);

  const shot = await ctx.screenshotRect('status-line.png', await ctx.js(`(function () {
    var r = document.getElementById('pbr_status').getBoundingClientRect();
    return { x: r.left - 8, y: r.top - 10, width: r.width + 16, height: r.height + 20 };
  })()`));

  // 再切到“源图辅助”——这是导入图片后最常见的状态，文案最长，最容易折行
  const long = await ctx.js(`(function () {
    NMO_RoughnessMap.setSetting('mode', 'source');
    NMO_RoughnessMap.setSetting('base', 0.67);
    NMO_RoughnessMap.setSetting('strength', 0.55);
    if (window.NMO_PBRUI && NMO_PBRUI.refreshAll) NMO_PBRUI.refreshAll();
    var el = document.getElementById('pbr_status');
    var b = el.getBoundingClientRect();
    var card = document.getElementById('cell_params').getBoundingClientRect();
    return {
      text: el.textContent,
      h: Math.round(b.height),
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      cardH: Math.round(card.height),
      cardBottom: Math.round(card.bottom)
    };
  })()`);

  return { ok: true, spec: 'status', data: out, long: long, screenshot: shot };
};
