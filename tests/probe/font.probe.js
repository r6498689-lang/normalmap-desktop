'use strict';

/*
 * font.probe.js — 放大字号后，逐块量高度，找出“哪一块把行高撑高了”。
 *
 *   node tests/probe.js font
 */

const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'));
  await ctx.wait(600);

  const data = await ctx.js(`(function () {
    function box(el) {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return { y: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), bottom: Math.round(r.bottom) };
    }
    function children(id) {
      var el = document.getElementById(id);
      if (!el) return [];
      return Array.prototype.map.call(el.children, function (c) {
        return {
          tag: c.tagName.toLowerCase(),
          cls: (c.className || '').toString().slice(0, 30),
          id: c.id || '',
          box: box(c)
        };
      });
    }
    var note = document.querySelector('.cell_note');
    var lib = document.getElementById('cell_library');
    var tools = document.getElementById('cell_3dtools');
    return {
      library: box(lib),
      libraryChildren: children('cell_library'),
      tools: box(tools),
      toolsChildren: children('cell_3dtools'),
      toolRows: Array.prototype.map.call(tools.querySelectorAll('.d3_row'), function (r) {
        var cs = getComputedStyle(r);
        return { box: box(r), display: cs.display, wrap: cs.flexWrap };
      }),
      note: note
        ? {
            box: box(note),
            text: note.textContent.trim().slice(0, 40),
            lineHeight: getComputedStyle(note).lineHeight,
            fontSize: getComputedStyle(note).fontSize
          }
        : null,
      paramRows: Array.prototype.map.call(
        document.querySelectorAll('#roughness_settings tr'),
        function (tr) { return box(tr); }
      ),
      paramTable: box(document.querySelector('#roughness_settings table')),
      tabs: (function () {
        var t = document.querySelector('.texture_container .tabs');
        return { box: box(t), scrollW: t.scrollWidth, clientW: t.clientWidth };
      })(),
      overflow: (function () {
        var out = [];
        ['cell_library', 'cell_params', 'column_height'].forEach(function (id) {
          var root = document.getElementById(id);
          if (!root) return;
          var nodes = root.querySelectorAll('*');
          for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n.scrollWidth > n.clientWidth + 2 && n.clientWidth > 0) {
              out.push({ id: n.id, cls: (n.className || '').toString().slice(0, 24), sw: n.scrollWidth, cw: n.clientWidth });
            }
          }
        });
        return out.slice(0, 12);
      })()
    };
  })()`);

  const shot = await ctx.screenshot('font-full.png');
  return { ok: true, spec: 'font', data: data, screenshot: shot };
};
