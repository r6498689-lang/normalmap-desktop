/*
 * preview-sync.js — 把“贴图类型”勾选同步到 3D 预览（1.1.31）
 *
 * 上面批量面板的“贴图类型”决定要生成/导出哪些贴图；下面 3D 预览的“显示”
 * 决定预览里叠哪些通道。以前两者各管各的，取消勾选法线，预览照样画法线。
 * 这里只做单向同步：贴图类型 → 预览显示。
 *
 *   法线  normal_tick        → input_normal    （phong + PBR 都生效）
 *   置换  displacement_tick  → input_displacement（phong）
 *   环境光 ambient_tick      → input_ao        （phong + PBR 都生效）
 *   高光  specular_tick      → input_specular  （phong；PBR 无独立高光贴图）
 *
 * 粗糙度 / 金属度不在这里同步：它们是“参数”不是“通道”，只存在于 PBR 预览里，
 * 没有对应的显示开关；勾不勾只影响导出，预览里改粗糙度/金属度始终可见。
 */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  var LINKS = [
    { tick: 'normal_tick', channel: 'normal' },
    { tick: 'displacement_tick', channel: 'displacement' },
    { tick: 'ambient_tick', channel: 'ao' },
    { tick: 'specular_tick', channel: 'specular' }
  ];

  function applyChannel(channel, on) {
    var rv = window.NMO_RenderView;
    if (!rv) return;
    if (channel === 'normal') rv.setNormal(on);
    else if (channel === 'ao') rv.setAO(on);
    else if (channel === 'specular') rv.setSpecular(on);
    else if (channel === 'displacement') rv.setDisplacement(on);
  }

  function bind() {
    LINKS.forEach(function (link) {
      var tick = $(link.tick);
      if (!tick) return;
      tick.addEventListener('change', function () {
        applyChannel(link.channel, tick.checked);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
