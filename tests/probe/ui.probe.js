'use strict';

/*
 * ui.probe.js — 视觉改版后的取证脚本。
 *
 *   node tests/probe.js ui
 *
 * 停在“粗糙度”选项卡（中间预览有真实内容），截三张卡片、预览行和整窗，
 * 同时把关键控件的计算样式读回来，便于判断哪条 CSS 没生效。
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

  const styles = await ctx.js(`(function () {
    function pick(id) {
      var el = document.getElementById(id);
      if (!el) return null;
      var cs = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      return {
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage.slice(0, 60),
        color: cs.color,
        border: cs.borderTopColor + ' ' + cs.borderTopWidth,
        radius: cs.borderTopLeftRadius,
        h: Math.round(r.height),
        w: Math.round(r.width),
        x: Math.round(r.left),
        y: Math.round(r.top)
      };
    }
    return {
      download: pick('download'),
      exportPlan: pick('export_plan_btn'),
      presetSave: pick('preset_save'),
      modelBtn: pick('browseModelButton'),
      dmStrength: pick('dm_strength_nmb'),
      fileName: pick('file_name'),
      presetName: pick('preset_name'),
      presetSelect: pick('preset_select'),
      sourceSelect: pick('rough_mode'),
      number: pick('rough_value_nmb'),
      tabNormal: pick('tab_btn_normal'),
      view: pick('normal_map'),
      content: pick('cell_params')
    };
  })()`);

  const rect = (id, pad) =>
    ctx.js(`(function () {
      var r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      return { x: r.left - ${pad || 0}, y: r.top - ${pad || 0}, width: r.width + ${(pad || 0) * 2}, height: r.height + ${(pad || 0) * 2} };
    })()`);

  const geom = await ctx.js(`(function () {
    function box(id) {
      var el = document.getElementById(id);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      return {
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
        mt: cs.marginTop, mb: cs.marginBottom, display: cs.display
      };
    }
    var ct = document.querySelector('#cell_texture .texture_container');
    var r = ct ? ct.getBoundingClientRect() : null;
    return {
      heightTabs: box('height_tabs'),
      heightView: box('height_map'),
      container: r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) } : null,
      textureTabs: box('tab_btn_normal'),
      textureView: box('roughness_map'),
      renderView: box('render_view'),
      renderCanvas: (function () {
        var c = document.querySelector('#render_view canvas');
        if (!c) return null;
        var b = c.getBoundingClientRect();
        return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), attrW: c.width, attrH: c.height };
      })(),
      columnHeight: box('column_height'),
      batch: box('batch_settings'),
      downloadBox: box('download_box'),
      dropArea: box('drop_area'),
      children: (function () {
        var el = document.getElementById('column_height');
        return Array.prototype.map.call(el.children, function (c) {
          var b = c.getBoundingClientRect();
          return { id: c.id, y: Math.round(b.top), h: Math.round(b.height), bottom: Math.round(b.bottom) };
        });
      })(),
      paramsChildren: (function () {
        var el = document.getElementById('cell_params');
        return Array.prototype.map.call(el.children, function (c) {
          var b = c.getBoundingClientRect();
          var cs = getComputedStyle(c);
          return { id: c.id, y: Math.round(b.top), h: Math.round(b.height), bottom: Math.round(b.bottom), display: cs.display };
        });
      })(),
      status: (function () {
        var el = document.getElementById('pbr_status');
        if (!el) return null;
        var b = el.getBoundingClientRect();
        var cs = getComputedStyle(el);
        var lh = parseFloat(cs.lineHeight) || 0;
        return {
          text: el.textContent,
          box: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
          fontSize: cs.fontSize,
          lineHeight: cs.lineHeight,
          lines: lh ? Math.round(b.height / lh) : null,
          scrollW: el.scrollWidth,
          clientW: el.clientWidth
        };
      })(),
      switchInfo: (function () {
        var track = document.querySelector('#rot_switch .d3_switch_track');
        var knob = document.querySelector('#rot_switch .d3_switch_knob');
        var sel = document.getElementById('preset_select');
        if (!track) return null;
        var t = track.getBoundingClientRect();
        var k = knob ? knob.getBoundingClientRect() : null;
        var tcs = getComputedStyle(track);
        var s = sel ? sel.getBoundingClientRect() : null;
        var row = document.getElementById('preset_name');
        return {
          track: { w: Math.round(t.width), h: Math.round(t.height), bg: tcs.backgroundColor, border: tcs.borderColor },
          knob: k ? { w: Math.round(k.width), h: Math.round(k.height), x: Math.round(k.left) } : null,
          selectW: s ? Math.round(s.width) : null,
          nameW: row ? Math.round(row.getBoundingClientRect().width) : null
        };
      })()
    };
  })()`);

  const shot = await ctx.screenshot('ui-full.png');
  const left = await ctx.screenshotRect('ui-left.png', await rect('column_height', 4));
  const params = await ctx.screenshotRect('ui-params.png', await rect('cell_params', 4));
  const library = await ctx.screenshotRect('ui-library.png', await rect('cell_library', 4));
  const previews = await ctx.screenshotRect('ui-previews.png', {
    x: 140,
    y: (await rect('cell_heightmap')).y - 4,
    width: 1200,
    height: 380
  });
  const footer = await ctx.screenshotRect('ui-footer.png', await ctx.js(`(function () {
    var r = document.querySelector('footer').getBoundingClientRect();
    return { x: r.left - 10, y: r.top - 6, width: r.width + 20, height: r.height + 12 };
  })()`));

  return {
    ok: true,
    spec: 'ui',
    styles: styles,
    geom: geom,
    screenshot: shot,
    left: left,
    params: params,
    library: library,
    previews: previews,
    footer: footer
  };
};
