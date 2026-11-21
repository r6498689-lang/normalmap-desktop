'use strict';

/*
 * preview.spec.js
 * 3D 预览：模型切换、自定义 OBJ、Diffuse 载入、各贴图开关、环境贴图、旋转。
 * 每次切换都截取预览区域，确认画面确实变了，而不只是下拉框的值变了。
 */

const driver = require('../lib/driver');

const MODELS = ['Cube', 'Plane', 'Sphere', 'Cylinder', 'Teapot'];

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

  // ---------------------------------------------------------- 自动旋转开关（1.1.9）
  // 默认关闭 → 模型静止；打开 → 开始转；再关 → 冻结；关闭时鼠标拖动仍然有效。
  // 截图也因此天然可重复，不用再手动关旋转。
  const rotStart = await ctx.js(`(function(){
    var box = document.getElementById('input_rot');
    return {
      enabled: NMO_RenderView.rotation_enabled,
      checked: box ? box.checked : null,
      text: document.getElementById('rot_switch_text').textContent,
      on: document.getElementById('rot_switch').classList.contains('is-on'),
      angle: NMO_RenderView.render_model.rotation.y
    };
  })()`);
  check(
    '默认不自动旋转（状态 / 勾选 / 开关一致）',
    rotStart.enabled === false && rotStart.checked === false && rotStart.on === false,
    JSON.stringify(rotStart)
  );
  check('开关文案显示“关”', /关/.test(rotStart.text), rotStart.text);

  await ctx.wait(500);
  const angleStill = await ctx.js('NMO_RenderView.render_model.rotation.y');
  check('关闭状态下模型确实不动', angleStill === rotStart.angle, rotStart.angle + ' -> ' + angleStill);

  await ctx.js("document.getElementById('input_rot').click()");
  await ctx.wait(700);
  const angleOn = await ctx.js('NMO_RenderView.render_model.rotation.y');
  const rotOn = await ctx.js(`(function(){
    return {
      enabled: NMO_RenderView.rotation_enabled,
      text: document.getElementById('rot_switch_text').textContent,
      on: document.getElementById('rot_switch').classList.contains('is-on')
    };
  })()`);
  check('打开开关后模型开始旋转', angleOn - angleStill > 0.005, angleStill + ' -> ' + angleOn);
  check(
    '开关文案显示“开”',
    rotOn.enabled === true && /开/.test(rotOn.text) && rotOn.on === true,
    JSON.stringify(rotOn)
  );

  await ctx.js("document.getElementById('input_rot').click()");
  await ctx.wait(120);
  const frozenA = await ctx.js('NMO_RenderView.render_model.rotation.y');
  await ctx.wait(600);
  const frozenB = await ctx.js('NMO_RenderView.render_model.rotation.y');
  check('再关掉后模型冻结', frozenA === frozenB, frozenA + ' -> ' + frozenB);

  // 关掉自动旋转后，拖动应当只动相机、不动模型
  const drag = await ctx.js(`(function(){
    var el = NMO_RenderView.renderer.domElement;
    var r = el.getBoundingClientRect();
    var x = Math.round(r.left + r.width / 2);
    var y = Math.round(r.top + r.height / 2);
    function fire(type, cx, cy) {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: cx, clientY: cy, button: 0, buttons: type === 'mouseup' ? 0 : 1
      }));
    }
    var before = NMO_RenderView.camera.position.clone();
    var modelBefore = NMO_RenderView.render_model.rotation.y;
    fire('mousedown', x, y);
    fire('mousemove', x + 60, y);
    fire('mouseup', x + 60, y);
    var moved = before.distanceTo(NMO_RenderView.camera.position);
    var drift = Math.abs(NMO_RenderView.render_model.rotation.y - modelBefore);
    // 复原机位，后面的预览截图与之前同角度
    NMO_RenderView.camera.position.copy(before);
    NMO_RenderView.camera.lookAt({ x: 0, y: 0, z: 0 });
    return { moved: moved, drift: drift, enabled: NMO_RenderView.rotation_enabled };
  })()`);
  check('关闭时鼠标拖动仍可转视角', drag.moved > 0.5, JSON.stringify(drag));
  check('拖动只动相机、模型自身没被转', drag.drift === 0 && drag.enabled === false, JSON.stringify(drag));
  await ctx.wait(300);

  const rect = await ctx.js(`(function(){
    var r = document.getElementById('render_view').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);

  let previousShot = null;
  const modelReport = [];

  for (const model of MODELS) {
    await driver.setControl(ctx, 'model', model);
    await ctx.wait(900);
    const geometry = await ctx.js(`(function(){
      var m = NMO_RenderView.render_model;
      return {
        name: m && m.geometry ? m.geometry.type : null,
        vertices: m && m.geometry && m.geometry.attributes.position ? m.geometry.attributes.position.count : 0,
        scale: m ? [m.scale.x, m.scale.y, m.scale.z] : null
      };
    })()`);
    const shot = await ctx.screenshotRect('preview-' + model.toLowerCase() + '.png', rect);
    const buf = require('node:fs').readFileSync(shot);
    modelReport.push({ model, geometry, shot: require('node:path').basename(shot) });

    check(`模型 ${model} 已生成几何体`, geometry.vertices > 0, JSON.stringify(geometry));

    if (previousShot) {
      const diff = ctx.compare(previousShot, buf);
      check(`模型 ${model} 的画面与上一个不同`, !diff.identical && diff.differingPixels > 100, JSON.stringify({
        differingPixels: diff.differingPixels
      }));
    }
    previousShot = buf;
  }

  // ------------------------------------------------------- 自定义 OBJ 模型
  const cubeShot = require('node:fs').readFileSync(
    require('node:path').join(ctx.evidenceDir, 'preview-cube.png')
  );
  await ctx.setFileInput(ctx.win, '#select_model_file', [driver.fixture('model-pyramid.obj')]);
  await ctx.waitFor('Boolean(NMO_RenderView.customModel)', 15000);
  await ctx.wait(1200);
  const custom = await ctx.js(`(function(){
    var m = NMO_RenderView.customModel;
    return {
      // 上游不会同步下拉框的值（setModel 只被下拉框调用），这里如实记录
      selectValue: document.getElementById('model').value,
      inScene: NMO_RenderView.scene.children.indexOf(m) >= 0,
      isRenderModel: NMO_RenderView.render_model === m,
      vertices: m && m.geometry && m.geometry.attributes.position ? m.geometry.attributes.position.count : 0
    };
  })()`);
  const customShot = await ctx.screenshotRect('preview-custom-obj.png', rect);
  const customDiff = ctx.compare(cubeShot, require('node:fs').readFileSync(customShot));

  check('自定义 OBJ 解析出几何体', custom.vertices === 18, String(custom.vertices));
  check('自定义 OBJ 已加入场景并成为当前模型', custom.inScene && custom.isRenderModel, JSON.stringify(custom));
  check('载入 OBJ 后预览画面改变', !customDiff.identical, JSON.stringify({ differingPixels: customDiff.differingPixels }));

  // 下拉框切回 Custom 也应正常
  await driver.setControl(ctx, 'model', 'Custom');
  await ctx.wait(800);
  const backToCustom = await ctx.js('NMO_RenderView.render_model === NMO_RenderView.customModel');
  check('下拉框选择 Custom 可用', backToCustom === true);

  // --------------------------------------------------------------- Diffuse
  const diffuseDisabledBefore = await ctx.js("document.getElementById('input_diffuse').disabled");
  await ctx.setFileInput(ctx.win, '#select_diffuse_file', [driver.fixture('diffuse-256.png')]);
  await ctx.waitFor("document.getElementById('input_diffuse').disabled === false", 15000);
  await ctx.wait(600);
  const diffuseState = await ctx.js(`(function(){
    return {
      disabled: document.getElementById('input_diffuse').disabled,
      checked: document.getElementById('input_diffuse').checked
    };
  })()`);
  check('载入 Diffuse 后开关可用', diffuseDisabledBefore === true && diffuseState.disabled === false, JSON.stringify(diffuseState));
  check('载入 Diffuse 后自动启用', diffuseState.checked === true, JSON.stringify(diffuseState));

  // Diffuse 的 .tga：Windows 下 MIME 常为空或不标准，必须按扩展名走 TGA 解码器
  await ctx.setFileInput(ctx.win, '#select_diffuse_file', [driver.fixture('height-tga-128.tga')]);
  await ctx.waitFor("diffuse_canvas.dataset.sourceWidth === '128'", 15000);
  await ctx.wait(400);
  const diffuseTga = await ctx.js(`(function(){
    var c = diffuse_canvas;
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    var opaque = 0;
    for (var i = 3; i < d.length; i += 4) if (d[i] > 0) opaque += 1;
    return {
      width: c.width,
      height: c.height,
      source: [c.dataset.sourceWidth, c.dataset.sourceHeight],
      opaquePixels: opaque,
      enabled: document.getElementById('input_diffuse').checked
    };
  })()`);
  check(
    'Diffuse 载入 128x128 TGA',
    diffuseTga.width === 128 && diffuseTga.height === 128 && diffuseTga.source[0] === '128',
    JSON.stringify(diffuseTga)
  );
  check(
    'Diffuse TGA 像素非空（大于 90% 不透明）',
    diffuseTga.opaquePixels > 128 * 128 * 0.9,
    String(diffuseTga.opaquePixels)
  );
  check('Diffuse TGA 载入后仍处于启用状态', diffuseTga.enabled === true, String(diffuseTga.enabled));
  await ctx.screenshotRect('preview-diffuse-tga.png', rect);

  // --------------------------------------------------------------- 贴图开关
  const toggles = [
    ['input_normal', 'normal'],
    ['input_ao', 'ambient'],
    ['input_specular', 'specular'],
    ['input_displacement', 'displacement'],
    ['input_enviroment', 'environment'],
    ['input_diffuse', 'diffuse']
  ];
  for (const [id, key] of toggles) {
    const before = await ctx.js(`document.getElementById('${id}').checked`);
    await ctx.js(`document.getElementById('${id}').click()`);
    await ctx.wait(500);
    const after = await ctx.js(`document.getElementById('${id}').checked`);
    check(`预览开关 ${key} 可切换`, before !== after, `${before} → ${after}`);
    // 切回来
    await ctx.js(`document.getElementById('${id}').click()`);
    await ctx.wait(300);
  }

  /*
   * 上面把模型换成了自定义 OBJ（18 个顶点，材质没有法线贴图）：
   * 在它身上关掉 Normal 本来就看不到变化（截图为证：整块亮度 mean 6/255）。
   * 要验证“开关真的影响渲染”，得换回带法线贴图的茶壶再比。
   */
  await driver.setControl(ctx, 'model', 'Teapot');
  await ctx.wait(900);

  // 关掉 normal 后画面必须变化（证明开关真的影响渲染）
  const withNormal = await ctx.screenshotRect('preview-normal-on.png', rect);
  await ctx.js("document.getElementById('input_normal').click()");
  await ctx.wait(700);
  const withoutNormal = await ctx.screenshotRect('preview-normal-off.png', rect);
  const toggleDiff = ctx.compare(
    require('node:fs').readFileSync(withNormal),
    require('node:fs').readFileSync(withoutNormal)
  );
  check('关闭 Normal 开关后预览画面改变', !toggleDiff.identical, JSON.stringify({
    differingPixels: toggleDiff.differingPixels
  }));
  await ctx.js("document.getElementById('input_normal').click()");
  await ctx.wait(500);

  // -------------------------------------------------- 贴图类型 → 预览同步（1.1.31）
  // 上面批量面板的“贴图类型”取消勾选，下面 3D 预览的“显示”要跟着关，
  // 法线在 PBR 预览下也要真的从材质里摘掉。
  await driver.setControl(ctx, 'model', 'Teapot');
  await ctx.wait(900);

  const syncBefore = await ctx.js(`(function(){
    return {
      normalTick: document.getElementById('normal_tick').checked,
      normalShow: document.getElementById('input_normal').checked,
      normalDefine: NMO_RenderView.material.defines['USE_NORMALMAP'] === ''
    };
  })()`);
  check('初始：贴图类型与显示都开着法线', syncBefore.normalTick && syncBefore.normalShow && syncBefore.normalDefine, JSON.stringify(syncBefore));

  // 取消勾选“贴图类型 · 法线” → 显示的“法线”应跟着取消，phong 材质去掉 USE_NORMALMAP
  await ctx.js("document.getElementById('normal_tick').click()");
  await ctx.wait(400);
  const syncOff = await ctx.js(`(function(){
    return {
      normalTick: document.getElementById('normal_tick').checked,
      normalShow: document.getElementById('input_normal').checked,
      normalDefine: NMO_RenderView.material.defines['USE_NORMALMAP'] === ''
    };
  })()`);
  check(
    '取消贴图类型·法线后，显示·法线同步关闭',
    !syncOff.normalTick && !syncOff.normalShow && !syncOff.normalDefine,
    JSON.stringify(syncOff)
  );

  // 环境光(AO) 也映射到显示的 AO
  await ctx.js("document.getElementById('ambient_tick').click()");
  await ctx.wait(300);
  const aoSync = await ctx.js(`(function(){
    return {
      ambientTick: document.getElementById('ambient_tick').checked,
      aoShow: document.getElementById('input_ao').checked,
      aoDefine: NMO_RenderView.material.defines['USE_AOMAP'] === ''
    };
  })()`);
  check(
    '取消贴图类型·环境光后，显示·AO 同步关闭',
    !aoSync.ambientTick && !aoSync.aoShow && !aoSync.aoDefine,
    JSON.stringify(aoSync)
  );

  // 打开 PBR 预览：法线/AO 已被上面的勾选关掉，PBR 材质里也不能挂这两张贴图
  await ctx.js("if (!NMO_PBRPreview.isEnabled()) document.getElementById('pbr_preview_toggle').click()");
  await ctx.wait(800);
  const pbrSync = await ctx.js(`(function(){
    var m = window.NMO_PBRPreview && window.NMO_PBRPreview.material;
    return {
      name: m ? m.name : null,
      normalMap: !!(m && m.normalMap),
      aoMap: !!(m && m.aoMap)
    };
  })()`);
  check(
    'PBR 预览里法线/AO 也被摘掉',
    pbrSync.name === 'nmo-pbr' && !pbrSync.normalMap && !pbrSync.aoMap,
    JSON.stringify(pbrSync)
  );

  // 重新勾回法线/环境光，预览要恢复（含 PBR 材质重新挂图）
  await ctx.js("document.getElementById('normal_tick').click()");
  await ctx.js("document.getElementById('ambient_tick').click()");
  await ctx.wait(400);
  const syncBack = await ctx.js(`(function(){
    var m = window.NMO_PBRPreview && window.NMO_PBRPreview.material;
    return {
      normalShow: document.getElementById('input_normal').checked,
      aoShow: document.getElementById('input_ao').checked,
      normalMap: !!(m && m.normalMap),
      aoMap: !!(m && m.aoMap)
    };
  })()`);
  check(
    '勾回贴图类型后，显示与 PBR 材质恢复',
    syncBack.normalShow && syncBack.aoShow && syncBack.normalMap && syncBack.aoMap,
    JSON.stringify(syncBack)
  );

  // 关掉 PBR，回到 phong 预览，避免影响下面的最终检查
  await ctx.js("if (NMO_PBRPreview.isEnabled()) document.getElementById('pbr_preview_toggle').click()");
  await ctx.wait(500);

  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无未预期的控制台错误', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'preview',
    viewport: rect,
    models: modelReport,
    custom,
    diffuse: diffuseState,
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
