/*
 * pbrPreview.js — 让粗糙度/金属度真正进入三维预览
 *
 * 原来的预览用的是 ShaderMaterial（phong 着色器 + defines），Specular 和
 * 环境贴图都是手工接的。这个模块新增一条 MeshStandardMaterial 路径：
 *   roughnessMap ← 粗糙度画布
 *   metalnessMap ← 金属度画布
 *   aoMap        ← AO 画布
 *   envMap       ← 原有的 cubemaps/park（CubeTexture）
 * 切换开关只换 material，不动几何体/相机/灯光，所以同一视角下可直接对比。
 */
(function () {
  'use strict';

  var PBRPreview = function () {
    this.enabled = false;
    this.material = null;
    this.roughnessTexture = null;
    this.metalnessTexture = null;
    this.roughnessVersion = -1;
    this.metalnessVersion = -1;
  };

  PBRPreview.prototype._texture = function (canvas, key) {
    var texture = new THREE.Texture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    texture.__nmoKey = key;
    return texture;
  };

  PBRPreview.prototype.ensure = function () {
    var rv = NMO_RenderView;
    if (this.material) return this.material;

    var material = new THREE.MeshStandardMaterial({
      color: 0xaaaaaa,
      roughness: 1,
      metalness: 1,
      envMap: rv.textureCube,
      envMapIntensity: 1
    });
    material.name = 'nmo-pbr';

    /*
     * 只在用户真的载入了 Diffuse 时才挂 map。
     * 原程序的 diffuse_canvas 在没导入颜色图时是空的（全黑），无条件挂上去
     * 会把整块表面乘成黑色——金属看起来就像“没有环境”。
     */
    var diffuseInput = document.getElementById('input_diffuse');
    material.map = diffuseInput && !diffuseInput.disabled && diffuseInput.checked ? rv.diffuse_map : null;

    /*
     * 法线 / AO 是否挂图，以“显示”复选框为准（贴图类型勾选、显示勾选都会
     * 同步到这个复选框）。否则用户先关掉法线、再开 PBR 预览时，这里又无条件
     * 把法线挂回去，预览就和“显示”对不上。
     */
    var normalBox = document.getElementById('input_normal');
    var aoBox = document.getElementById('input_ao');
    material.normalMap = normalBox && !normalBox.checked ? null : rv.normal_map;
    material.aoMap = aoBox && !aoBox.checked ? null : rv.ao_map;
    material.aoMapIntensity = 1;

    this.roughnessTexture = this._texture(window.NMO_RoughnessMap.roughness_canvas, 'roughness');
    this.metalnessTexture = this._texture(window.NMO_MetallicMap.metallic_canvas, 'metalness');
    material.roughnessMap = this.roughnessTexture;
    material.metalnessMap = this.metalnessTexture;

    this.material = material;
    return material;
  };

  /** 数据变了：把画布重新传给 GPU，并在开启时保持 material 绑定。 */
  PBRPreview.prototype.refresh = function () {
    if (!this.material) {
      if (!this.enabled) return;
      this.ensure();
    }
    var rough = window.NMO_RoughnessMap;
    var metal = window.NMO_MetallicMap;
    if (rough && rough.version !== this.roughnessVersion && this.roughnessTexture) {
      this.roughnessTexture.needsUpdate = true;
      this.roughnessVersion = rough.version;
    }
    if (metal && metal.version !== this.metalnessVersion && this.metalnessTexture) {
      this.metalnessTexture.needsUpdate = true;
      this.metalnessVersion = metal.version;
    }
    if (this.enabled) this.apply();
  };

  PBRPreview.prototype.apply = function () {
    var rv = NMO_RenderView;
    var model = rv.render_model;
    if (!model) return false;
    var material = this.ensure();
    // 尺寸不一致时 Three 会直接拉伸；这里不做静默修正，交给 ORM/导出报错。
    material.roughnessMap = this.roughnessTexture;
    material.metalnessMap = this.metalnessTexture;
    material.envMap = rv.textureCube;

    // Diffuse 可能在开启 PBR 之后才导入，这里跟着勾选状态走。
    var diffuseInput = document.getElementById('input_diffuse');
    var wantMap = diffuseInput && !diffuseInput.disabled && diffuseInput.checked ? rv.diffuse_map : null;
    if (material.map !== wantMap) material.map = wantMap;

    material.needsUpdate = true;
    model.material = material;
    return true;
  };

  PBRPreview.prototype.setEnabled = function (on) {
    this.enabled = Boolean(on);
    var rv = NMO_RenderView;
    if (!rv.render_model) return;
    if (this.enabled) {
      // 显示环境本身：金属反射才有可对照的内容，也避免“黑色背景冒充金属”。
      if (rv.textureCube) rv.scene.background = rv.textureCube;
      this.apply();
    } else {
      rv.scene.background = null;
      rv.render_model.material = rv.material;
      rv.render_model.material.needsUpdate = true;
    }
    var input = document.getElementById('pbr_preview_toggle');
    if (input && input.checked !== this.enabled) input.checked = this.enabled;
  };

  PBRPreview.prototype.isEnabled = function () {
    return this.enabled;
  };

  /** 换模型（Cube/Sphere/OBJ…）后重新绑定，避免新模型用回 phong 材质。 */
  PBRPreview.prototype.hookModelChanges = function () {
    var self = this;
    var original = NMO_RenderView.setModel;
    NMO_RenderView.setModel = function (type) {
      original.call(NMO_RenderView, type);
      if (self.enabled) self.apply();
    };
  };

  window.NMO_PBRPreview = new PBRPreview();
  window.NMO_PBRPreview.hookModelChanges();
})();
