'use strict';

/*
 * layout.probe.js — 不是测试，是量尺子。
 *
 * 逐个选项卡点过去，把关键盒子的位置/尺寸、以及页面总高度记下来。
 * 目的：修“切换选项卡时界面一会大一会小”之前，先拿到真实的跳动幅度。
 */

function rect(el) {
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
    bottom: Math.round(b.bottom)
  };
}

module.exports.run = async function run(ctx) {
  await ctx.waitFor('window.NMO_Main && NMO_FileDrop.height_image.naturalWidth > 0', 30000);
  await ctx.waitFor('NMO_NormalMap.normal_canvas.width > 0', 30000);
  await ctx.wait(1200);

  const tabs = ['normal', 'displace', 'ao', 'specular', 'roughness', 'metallic'];
  const snapshots = {};

  for (const tab of tabs) {
    await ctx.js(`document.getElementById('tab_btn_${tab}').click()`);
    await ctx.wait(350);
    snapshots[tab] = await ctx.js(`(function(){
      function r(id){
        var el = document.getElementById(id);
        if (!el) return null;
        var b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) };
      }
      var settingsIds = ['normal_settings','displacement_settings','ao_settings','specular_settings','roughness_settings','metallic_settings'];
      var visible = settingsIds.filter(function(id){
        var el = document.getElementById(id);
        return el && el.style.display !== 'none';
      })[0] || null;
      var v = visible ? r(visible) : null;
      var dl = document.getElementById('download');
      var dlb = dl ? dl.getBoundingClientRect() : null;
      var tabsEl = document.querySelector('.texture_container .tabs');
      var tb = tabsEl ? tabsEl.getBoundingClientRect() : null;
      var tabFirst = document.querySelector('.texture_container .tab_button');
      var fb = tabFirst ? tabFirst.getBoundingClientRect() : null;
      var tabLast = document.querySelectorAll('.texture_container .tab_button');
      var lb = tabLast.length ? tabLast[tabLast.length-1].getBoundingClientRect() : null;
      var mapIds = ['normal_map','displacement_map','ao_map','specular_map','roughness_map','metallic_map'];
      var visibleMap = null;
      mapIds.forEach(function(id){
        var el = document.getElementById(id);
        if (el && el.style.display !== 'none') visibleMap = el;
      });
      var canvasEl = visibleMap ? visibleMap.querySelector('canvas') : null;
      var frameRect = visibleMap ? visibleMap.getBoundingClientRect() : null;
      var canvasRect = canvasEl ? canvasEl.getBoundingClientRect() : null;
      return {
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        dpr: window.devicePixelRatio,
        visiblePanel: visible,
        panel: v,
        paramsCell: r('cell_params'),
        paramsBottom: r('cell_params') ? r('cell_params').bottom : null,
        library: r('cell_library'),
        tools: r('cell_3dtools'),
        heightmap: r('cell_heightmap'),
        texture: r('cell_texture'),
        threeD: r('cell_3d'),
        content: r('content') || (function(){
          var c = document.querySelector('div.content');
          return c ? { x: Math.round(c.getBoundingClientRect().x), y: Math.round(c.getBoundingClientRect().y), w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height) } : null;
        })(),
        downloadBtn: dlb ? { x: Math.round(dlb.x), y: Math.round(dlb.y), w: Math.round(dlb.width), h: Math.round(dlb.height), bottom: Math.round(dlb.bottom) } : null,
        tabsRow: tb ? { x: Math.round(tb.x), y: Math.round(tb.y), w: Math.round(tb.width), h: Math.round(tb.height), bottom: Math.round(tb.bottom) } : null,
        firstTab: fb ? { x: Math.round(fb.x), y: Math.round(fb.y), w: Math.round(fb.width), h: Math.round(fb.height) } : null,
        lastTab: lb ? { x: Math.round(lb.x), y: Math.round(lb.y), w: Math.round(lb.width), h: Math.round(lb.height) } : null,
        normalView: r('normal_map'),
        roughView: r('roughness_map'),
        visibleFrame: frameRect ? {
          id: visibleMap.id,
          top: Math.round(frameRect.top),
          bottom: Math.round(frameRect.bottom),
          left: Math.round(frameRect.left),
          right: Math.round(frameRect.right)
        } : null,
        visibleCanvas: canvasRect ? {
          top: Math.round(canvasRect.top),
          bottom: Math.round(canvasRect.bottom),
          left: Math.round(canvasRect.left),
          right: Math.round(canvasRect.right)
        } : null,
        heightView: r('height_map'),
        renderView: r('render_view'),
        sizeRow: r('size_row'),
        sizeInput: r('size'),
        dropRow: (function(){
          var el = document.querySelector('.drop_row');
          if (!el) return null;
          var b = el.getBoundingClientRect();
          return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
        })(),
        dropIcons: Array.prototype.map.call(document.querySelectorAll('.drop_row a.various'), function(a){
          var b = a.getBoundingClientRect();
          return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
        }),
        toolsContentWidth: (function(){
          var el = document.getElementById('cell_3dtools');
          return el ? el.scrollWidth : null;
        })(),
        toolsHeight: (function(){
          var el = document.getElementById('cell_3dtools');
          return el ? Math.round(el.getBoundingClientRect().height) : null;
        })()
      };
    })()`);
  }

  // 3D 预览画布本身（canvas 尺寸会随窗口/resize 变）
  const canvases = await ctx.js(`(function(){
    function c(id){ var el = document.getElementById(id); return el ? [el.width, el.height, Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)] : null; }
    return {
      normal_img: c('normal_img'),
      roughness_img: c('roughness_img'),
      height_canvas: c('height_canvas'),
      render_canvas: (function(){
        var el = document.querySelector('#render_view canvas');
        return el ? [el.width, el.height, Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)] : null;
      })()
    };
  })()`);

  const shot = await ctx.screenshot('layout-probe.png');
  return { ok: true, spec: 'layout-probe', snapshots, canvases, screenshot: shot };
};
