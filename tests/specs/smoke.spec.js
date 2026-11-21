'use strict';

/*
 * smoke.spec.js — phase 1 gate.
 * Opens the app, waits for the bundled default height map to produce all four
 * maps, screenshots the window, and reports build identity plus any renderer
 * errors. Fails if the maps never appear or the console reports an exception.
 */

module.exports.run = async function run(ctx) {
  const started = Date.now();

  await ctx.waitFor('window.NMO_Main && window.NMO_FileDrop', 20000);
  await ctx.waitFor(
    'document.getElementById("normal_img").width > 0 && document.getElementById("normal_img").height > 0',
    25000
  );
  // Let the first WebGL frame and the fancybox/preview settle.
  await ctx.wait(1500);

  const state = await ctx.js(`(function(){
    const sizeText = document.getElementById('size').value;
    return {
      title: document.title,
      sizeText: sizeText,
      canvases: {
        normal: [NMO_NormalMap.normal_canvas.width, NMO_NormalMap.normal_canvas.height],
        displacement: [NMO_DisplacementMap.displacement_canvas.width, NMO_DisplacementMap.displacement_canvas.height],
        ambient: [NMO_AmbientOccMap.ao_canvas.width, NMO_AmbientOccMap.ao_canvas.height],
        specular: [NMO_SpecularMap.specular_canvas.width, NMO_SpecularMap.specular_canvas.height]
      },
      preview: {
        canvasWidth: document.getElementById('normal_img').width,
        canvasHeight: document.getElementById('normal_img').height
      },
      rendererPresent: Boolean(document.querySelector('#render_view canvas')),
      webglContextLost: (function(){
        const c = document.querySelector('#render_view canvas');
        if (!c) return 'no-canvas';
        const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
        return gl ? gl.isContextLost() : 'no-webgl-handle';
      })(),
      bridgeEnabled: NMO_Desktop.enabled,
      statusText: document.getElementById('nmo_status') ? document.getElementById('nmo_status').textContent : '',
      // The upstream PayPal block and the e-mail feedback block were removed on
      // purpose. Guard against them coming back through a file sync.
      removedBlocks: {
        formCount: document.querySelectorAll('form').length,
        paypalMentions: (document.body.innerHTML.match(/paypal/gi) || []).length,
        donateNodes: document.querySelectorAll('.donate_btn, img[src*="donate"], img[src*="email_adresse"]').length,
        feedbackLabel: document.body.innerText.indexOf('反馈') >= 0
      }
    };
  })()`);

  const build = await ctx.js('window.nmoDesktop.getBuildInfo()');
  const netLog = await ctx.js('window.nmoDesktop.getNetworkLog()');

  /*
   * 1.1.1 布局回归：
   *  - 贴图预览应有 6 个选项卡（法线/置换/环境光/高光/粗糙度/金属度）
   *  - 点“粗糙度”后参数面板换成粗糙度表，预览换成粗糙度画布
   *  - 没勾选“粗糙度”时，参数表也必须显示（用户明确要求）
   *  - 三个预览画布必须在同一水平带（顶部差 <= 30px）
   */
  await ctx.js("document.getElementById('tab_btn_roughness').click()");
  await ctx.wait(600);
  const roughnessShot = await ctx.screenshot('phase1-smoke-roughness.png');

  const layout = await ctx.js(`(function(){
    var tabs = Array.prototype.map.call(
      document.querySelectorAll('.texture_container .tab_button'),
      function (b) { return b.value; }
    );
    var roughVisible = document.getElementById('roughness_settings').style.cssText === '';
    var normalHidden = document.getElementById('normal_settings').style.cssText === 'display: none;';
    var roughMapVisible = document.getElementById('roughness_map').style.cssText === '';

    var tick = document.getElementById('roughness_tick');
    var wasChecked = tick.checked;
    if (wasChecked) tick.click();
    document.getElementById('tab_btn_roughness').click();
    var uncheckedStillShows =
      document.getElementById('roughness_settings').style.cssText === '' && !tick.checked;
    if (wasChecked) tick.click();

    document.getElementById('tab_btn_normal').click();
    var backToNormal =
      document.getElementById('normal_settings').style.cssText === '' &&
      document.getElementById('roughness_settings').style.cssText === 'display: none;';

    /*
     * 回归：法线/置换曾经被拖放容器盖住，点不到（elementFromPoint 返回 DIV）。
     * 这里直接问“这个点最上层是不是它自己”，比截图看更可靠。
     */
    var hitTargets = ['normal_tick', 'displacement_tick'].map(function (id) {
      var el = document.getElementById(id);
      var b = el.getBoundingClientRect();
      var top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      var reachable = top === el || (top && top.tagName === 'LABEL' && top.contains(el));
      var before = el.checked;
      el.click();
      var toggled = el.checked !== before;
      el.click();
      return { id: id, reachable: Boolean(reachable), toggled: toggled };
    });

    var tops = ['height_map', 'normal_map', 'render_view'].map(function (id) {
      var el = document.getElementById(id);
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    });

    /*
     * 回归：贴图预览的画布曾经因为 .helper 还是 300px（画布已缩到 260）
     * 而向下偏 20px、从框底溢出 20px，高度图预览没有这个占位块，于是两个框
     * 看起来一高一低。现在画布必须落在框内，且与高度图画布同高。
     */
    var frame = document.getElementById('normal_map').getBoundingClientRect();
    var canvas = document.getElementById('normal_img').getBoundingClientRect();
    var heightCanvas = document.getElementById('height_canvas').getBoundingClientRect();
    var canvasInsets = {
      top: Math.round(canvas.top - frame.top),
      bottom: Math.round(frame.bottom - canvas.bottom),
      left: Math.round(canvas.left - frame.left),
      right: Math.round(frame.right - canvas.right),
      vsHeightmap: Math.round(canvas.top - heightCanvas.top)
    };

    return {
      tabs: tabs,
      canvasInsets: canvasInsets,
      roughVisible: roughVisible,
      normalHidden: normalHidden,
      roughMapVisible: roughMapVisible,
      uncheckedStillShows: uncheckedStillShows,
      backToNormal: backToNormal,
      hitTargets: hitTargets,
      previewTops: tops
    };
  })()`);

  const tops = layout.previewTops.filter((v) => typeof v === 'number');
  const previewAligned = tops.length === 3 && Math.max.apply(null, tops) - Math.min.apply(null, tops) <= 30;

  /*
   * 1.1.2 layout regressions:
   *  - 六个选项卡逐个切过去，第二行（三个预览）的位置、页面总高度、
   *    下载区的位置都不能变（1.1.1 时参数表 76…175px 的变化会让整排预览跳 99px，
   *    粗糙度还会把页面撑出 23px 滚动条，横向再错 8px）
   *  - 最左边的“法线”要和下方预览框的左边框对齐
   *  - 下载区在左栏、3D 设置在右栏、?/! 在尺寸行
   */
  const stability = await ctx.js(`(function(){
    var names = ['normal','displace','ao','specular','roughness','metallic'];
    var rows = [];
    for (var i = 0; i < names.length; i++) {
      document.getElementById('tab_btn_' + names[i]).click();
      var cell = document.getElementById('cell_heightmap').getBoundingClientRect();
      var dl = document.getElementById('download').getBoundingClientRect();
      var tabs = document.querySelector('.texture_container .tabs').getBoundingClientRect();
      rows.push({
        tab: names[i],
        row2Top: Math.round(cell.top),
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        downloadTop: Math.round(dl.top),
        tabsLeft: Math.round(tabs.x)
      });
    }
    document.getElementById('tab_btn_normal').click();
    return rows;
  })()`);

  const alignment = await ctx.js(`(function(){
    var tabs = document.querySelector('.texture_container .tabs').getBoundingClientRect();
    var frame = document.getElementById('normal_map').getBoundingClientRect();
    return {
      tabsLeft: Math.round(tabs.x),
      frameLeft: Math.round(frame.x),
      diff: Math.round(Math.abs(tabs.x - frame.x))
    };
  })()`);

  const structure = await ctx.js(`(function(){
    var dl = document.getElementById('download');
    var tools = document.getElementById('cell_3dtools');
    return {
      downloadInLeft: dl.closest('#column_height') !== null,
      downloadInParams: dl.closest('#cell_params') !== null,
      toolsInLibrary: tools.closest('#cell_library') !== null,
      dropHelpLinks: document.querySelectorAll('.drop_row a.various').length,
      sizeHelpLinks: document.querySelectorAll('#size_row .size_help a').length,
      // 1.1.4：下载区在上、拖放提示在下
      dropAreaInLeft: document.getElementById('drop_area').closest('#column_height') !== null,
      downloadAboveDrop:
        dl.getBoundingClientRect().bottom <=
        document.getElementById('drop_area').getBoundingClientRect().top,
      gridRowCount: getComputedStyle(document.querySelector('div.content')).gridTemplateRows
        .split(' ').filter(Boolean).length
    };
  })()`);

  const uniq = (arr) => Array.from(new Set(arr));
  const insets = layout.canvasInsets;
  const canvasInside =
    insets.top >= 8 &&
    insets.bottom >= 8 &&
    insets.left >= 8 &&
    insets.right >= 8 &&
    Math.abs(insets.vsHeightmap) <= 1;
  const noJump =
    uniq(stability.map((r) => r.row2Top)).length === 1 &&
    uniq(stability.map((r) => r.scrollHeight)).length === 1 &&
    uniq(stability.map((r) => r.downloadTop)).length === 1 &&
    uniq(stability.map((r) => r.tabsLeft)).length === 1 &&
    stability.every((r) => r.scrollWidth <= r.innerWidth);

  const layoutOk =
    layout.tabs.length === 6 &&
    layout.tabs.join(',') === '法线,置换,环境光,高光,粗糙度,金属度' &&
    layout.roughVisible &&
    layout.normalHidden &&
    layout.roughMapVisible &&
    layout.uncheckedStillShows &&
    layout.backToNormal &&
    layout.hitTargets.every(function (t) { return t.reachable && t.toggled; }) &&
    previewAligned &&
    canvasInside &&
    noJump &&
    alignment.diff <= 2 &&
    structure.downloadInLeft &&
    !structure.downloadInParams &&
    structure.toolsInLibrary &&
    structure.dropAreaInLeft &&
    structure.downloadAboveDrop &&
    structure.dropHelpLinks === 0 &&
    structure.sizeHelpLinks === 2 &&
    structure.gridRowCount === 2;

  const shot = await ctx.screenshot('phase1-smoke-window.png');

  const errors = ctx.consoleLog.filter(
    (entry) => entry.level === 'error' || entry.level === 3
  );

  const remoteRequests = netLog.blocked.filter((entry) => !/^app:\/\//.test(entry.url));
  const removed = state.removedBlocks;
  const ok =
    state.canvases.normal[0] > 0 &&
    state.preview.canvasWidth > 0 &&
    state.rendererPresent === true &&
    state.bridgeEnabled === true &&
    removed.formCount === 0 &&
    removed.paypalMentions === 0 &&
    removed.donateNodes === 0 &&
    removed.feedbackLabel === false &&
    layoutOk &&
    errors.length === 0 &&
    remoteRequests.length === 0;

  return {
    ok,
    spec: 'smoke',
    durationMs: Date.now() - started,
    build,
    state,
    layout: layout,
    layoutOk: layoutOk,
    stability: stability,
    alignment: alignment,
    structure: structure,
    noJump: noJump,
    canvasInside: canvasInside,
    screenshot: shot,
    roughnessScreenshot: roughnessShot,
    consoleErrors: errors,
    blockedRemoteRequests: remoteRequests,
    localRequestCount: netLog.local.length,
    checkedAt: new Date().toISOString()
  };
};
