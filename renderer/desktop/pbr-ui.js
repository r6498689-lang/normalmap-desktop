/*
 * pbr-ui.js — 粗糙度 / 金属度 / ORM 的界面接线
 *
 * 只做“控件 ↔ 数据”的映射和状态显示，不在这里做像素运算（见 pbrMaps.js）。
 * 所有数值改动都会立刻重算并刷新 PBR 预览材质。
 */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function num(id, fallback) {
    var el = $(id);
    if (!el) return fallback;
    var value = Number(el.value);
    return isFinite(value) ? value : fallback;
  }

  function drawThumb(sourceCanvas, target) {
    if (!sourceCanvas || !sourceCanvas.width || !target) return;
    var ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(sourceCanvas, 0, 0, target.width, target.height);
  }

  function roughnessSummary() {
    var s = NMO_RoughnessMap.getSettings();
    if (s.mode === 'uniform') return '统一 ' + Number(s.value).toFixed(2);
    var presetId = NMO_RoughnessMap.getPresetId ? NMO_RoughnessMap.getPresetId() : '';
    var mapName = presetId
      ? '预设 ' + NMO_MaskPresets.labelOf(presetId)
      : NMO_RoughnessMap.imported
        ? NMO_RoughnessMap.imported.name
        : '';
    if (s.mode === 'mixed') {
      return '贴图 + 源图（' + (mapName || '无贴图') + ' · 强度 ' + Number(s.strength).toFixed(2) + '）';
    }
    if (s.mode === 'imported') return '导入贴图' + (mapName ? '（' + mapName + '）' : '');
    return '源图辅助 · 基础 ' + Number(s.base).toFixed(2) + ' · 强度 ' + Number(s.strength).toFixed(2);
  }

  function metallicSummary() {
    var s = NMO_MetallicMap.getSettings();
    if (s.mode === 'none') return '非金属（0）';
    if (s.mode === 'rough') return '复用粗糙度遮罩';
    if (s.mode === 'full') return '裸金属（1）';
    return '遮罩' + (NMO_MetallicMap.imported ? '（' + NMO_MetallicMap.imported.name + '）' : '');
  }

  function updateStatus() {
    var el = $('pbr_status');
    if (!el) return;
    /*
     * 1.1.12：16px 档下 400px 宽的卡片放不下“粗糙度… · 金属度…”一整句，
     * 直接折行会把“强度”拆成“强/度”（中文可以在任意字间断行），看起来像错字。
     * 所以固定成两行：第一行粗糙度，第二行金属度（ORM 提示跟在第二行）。
     */
    var lines = ['粗糙度：' + roughnessSummary(), '金属度：' + metallicSummary()];
    if (NMO_ORM.isEnabled()) {
      lines[1] += NMO_ORM.isReady() ? ' · ORM 可就绪' : ' · ORM 缺数据：' + NMO_ORM.reason();
    }
    el.textContent = '';
    for (var i = 0; i < lines.length; i += 1) {
      var row = document.createElement('span');
      row.className = 'pbr_status_row';
      row.textContent = lines[i];
      el.appendChild(row);
    }
    el.title = lines.join('  ');
  }

  /*
   * 粗糙度/金属度不再用 44px 缩略图，直接画进“贴图预览”的大画布
   * （就是点“粗糙度/金属度”选项卡看到的那个），与法线等贴图同一套缩放逻辑。
   */
  function drawBigPreview(sourceCanvas, imgId) {
    if (!sourceCanvas || !sourceCanvas.width) return;
    if (!window.NMO_Main || !NMO_Main.setTexturePreview) return;
    NMO_Main.setTexturePreview(sourceCanvas, imgId, sourceCanvas.width, sourceCanvas.height);
  }

  function refreshAll() {
    NMO_PBR.refresh();
    drawBigPreview(NMO_RoughnessMap.roughness_canvas, 'roughness_img');
    drawBigPreview(NMO_MetallicMap.metallic_canvas, 'metallic_img');
    updateStatus();
  }

  /* 滑块 ↔ 数值框：滑块带动数值；数值回车后回写滑块并复用原有的 change 逻辑。 */
  function pairSliders() {
    ['rough_strength', 'rough_min', 'rough_max',
      'metal_min', 'metal_max', 'metal_threshold', 'metal_softness'].forEach(function (id) {
      var range = $(id);
      var numEl = $(id + '_nmb');
      if (!range || !numEl) return;
      range.addEventListener('input', function () {
        numEl.value = Number(this.value).toFixed(2);
      });
      numEl.addEventListener('change', function () {
        var v = Number(this.value);
        if (!isFinite(v)) {
          this.value = Number(range.value).toFixed(2);
          return;
        }
        v = Math.max(Number(range.min), Math.min(Number(range.max), v));
        range.value = v;
        this.value = v.toFixed(2);
        range.dispatchEvent(new Event('change'));
      });
    });
  }

  function syncNumbers() {
    ['rough_strength', 'rough_min', 'rough_max',
      'metal_min', 'metal_max', 'metal_threshold', 'metal_softness'].forEach(function (id) {
      var range = $(id);
      var numEl = $(id + '_nmb');
      if (range && numEl) numEl.value = Number(range.value).toFixed(2);
    });
  }

  function syncControlsFromSettings() {
    var r = NMO_RoughnessMap.getSettings();
    $('rough_mode').value = r.mode;
    if ($('rough_preset')) $('rough_preset').value = NMO_RoughnessMap.getPresetId();
    /*
     * “基础值”这一行在导入贴图/贴图+源图下表示“把图案抬到哪个中值”，
     * 所以显示 base；统一数值/源图辅助下它和 rough_value 是同一个数，显示谁都一样。
     */
    var shownBase = r.mode === 'imported' || r.mode === 'mixed' ? r.base : r.value;
    $('rough_value').value = shownBase;
    $('rough_value_nmb').value = Number(shownBase).toFixed(2);
    $('rough_strength').value = r.strength;
    $('rough_detail').value = r.detail;
    $('rough_invert').checked = Boolean(r.invert);
    $('rough_min').value = r.min;
    $('rough_max').value = r.max;

    var m = NMO_MetallicMap.getSettings();
    $('metal_mode').value = m.mode;
    syncMetalImportButton();
    $('metal_invert').checked = Boolean(m.invert);
    $('metal_min').value = m.min;
    $('metal_max').value = m.max;
    $('metal_threshold').value = m.threshold;
    $('metal_softness').value = m.softness;

    syncNumbers();
  }

  /* ---------- ORM 开关条件 ---------- */
  function updateOrmAvailability() {
    var btn = $('orm_toggle');
    if (!btn) return;
    var ao = $('ambient_tick') && $('ambient_tick').checked;
    var rough = $('roughness_tick') && $('roughness_tick').checked;
    var metal = $('metallic_tick') && $('metallic_tick').checked;
    var all = Boolean(ao && rough && metal);
    btn.disabled = !all;
    btn.title = all
      ? 'R=AO / G=粗糙度 / B=金属度；启用后用一张 ORM 替代三张单图'
      : '需要同时勾选 环境光(AO)、粗糙度、金属度';
    if (!all && NMO_ORM.isEnabled()) {
      NMO_ORM.setEnabled(false);
      btn.setAttribute('aria-pressed', 'false');
    }
  }

  /* ---------- 导入辅助图 ---------- */
  var pendingImport = null;

  function readImageToCanvas(file) {
    return new Promise(function (resolve, reject) {
      var isTga = /\.tga$/i.test(file.name || '');
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('读取文件失败：' + file.name));
      };
      reader.onload = function (event) {
        var source = event.target.result;
        if (isTga) {
          try {
            var tga = new TGA();
            tga.load(new Uint8Array(source));
            source = tga.getDataURL('image/png');
          } catch (err) {
            reject(new Error('TGA 解码失败：' + file.name));
            return;
          }
        }
        var img = new Image();
        img.onload = function () {
          var canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          resolve({ canvas: canvas, name: file.name });
        };
        img.onerror = function () {
          reject(new Error('图片解码失败：' + file.name));
        };
        img.src = source;
      };
      if (isTga) reader.readAsArrayBuffer(file);
      else reader.readAsDataURL(file);
    });
  }

  function sourceSize() {
    var image = NMO_FileDrop.height_image;
    return image && image.naturalWidth
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : null;
  }

  function askResample(pending) {
    var host = $('pbr_resample');
    var text = $('pbr_resample_text');
    var source = sourceSize();
    pendingImport = pending;
    host.hidden = false;
    text.textContent =
      '“' + pending.name + '” 是 ' + pending.canvas.width + '×' + pending.canvas.height +
      '，源图是 ' + (source ? source.width + '×' + source.height : '未知') +
      '。要重采样到源图尺寸，还是取消这次导入？';
  }

  function applyImport(pending, resample) {
    var canvas = pending.canvas;
    if (resample) {
      var source = sourceSize();
      if (source) {
        var scaled = document.createElement('canvas');
        scaled.width = source.width;
        scaled.height = source.height;
        var ctx = scaled.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, source.width, source.height);
        canvas = scaled;
      }
    }
    if (pending.kind === 'rough') {
      var keepMixed = $('rough_mode').value === 'mixed';
      NMO_RoughnessMap.setImported(canvas, pending.name, keepMixed ? 'mixed' : 'imported');
      NMO_RoughnessMap.adoptMapCenter({ resetStrength: !keepMixed });
      $('rough_mode').value = keepMixed ? 'mixed' : 'imported';
      syncControlsFromSettings();
      if ($('rough_preset')) $('rough_preset').value = '';
      NMO_Desktop.status(
        '已导入粗糙度贴图：' + pending.name + (keepMixed ? '（贴图 + 源图）' : ''),
        'ok'
      );
    } else {
      NMO_MetallicMap.setImported(canvas, pending.name);
      $('metal_mode').value = 'mask';
      syncMetalImportButton();
      NMO_Desktop.status('已导入金属度遮罩：' + pending.name, 'ok');
    }
    $('pbr_resample').hidden = true;
    pendingImport = null;
    refreshAll();
  }

  function importInto(kind, file) {
    if (!file) return;
    readImageToCanvas(file)
      .then(function (result) {
        var source = sourceSize();
        if (source && (result.canvas.width !== source.width || result.canvas.height !== source.height)) {
          askResample({ kind: kind, canvas: result.canvas, name: result.name });
          return;
        }
        applyImport({ kind: kind, canvas: result.canvas, name: result.name }, false);
      })
      .catch(function (err) {
        NMO_Desktop.status(err.message, 'error');
      });
  }

  /* ---------- 内置遮罩预设（1.1.6） ---------- */
  function fillPresetOptions() {
    var select = $('rough_preset');
    if (!select || !window.NMO_MaskPresets) return;
    NMO_MaskPresets.list().forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      select.appendChild(option);
    });
    select.addEventListener('change', function () {
      applyRoughPreset(this.value);
    });
  }

  function applyRoughPreset(id) {
    var select = $('rough_preset');
    if (!id) {
      if (NMO_RoughnessMap.getPresetId && NMO_RoughnessMap.getPresetId()) {
        var wasMixed = $('rough_mode').value === 'mixed';
        NMO_RoughnessMap.setSettings({ mode: wasMixed ? 'source' : 'uniform' });
        NMO_RoughnessMap.setPreset(null);
        $('rough_mode').value = wasMixed ? 'source' : 'uniform';
        NMO_Desktop.status(
          wasMixed ? '已取消遮罩预设，保留“源图辅助”。' : '已取消遮罩预设，粗糙度回到统一数值。',
          'info'
        );
        refreshAll();
      }
      return;
    }
    var preset = NMO_MaskPresets.find(id);
    if (!preset) return;
    // 已经在“贴图 + 源图”里就保持混合，不要把用户踢回纯贴图
    var mode = $('rough_mode').value === 'mixed' ? 'mixed' : 'imported';
    return NMO_MaskPresets.load(id)
      .then(function (canvas) {
        if (select && select.value !== id) return; // 解码期间又换了别的
        NMO_RoughnessMap.setPreset(canvas, id, mode);
        // 换了一张图 → 基础值对齐到这张贴图的中值（导入贴图下强度归 0，画面＝原图）
        var adopted = NMO_RoughnessMap.adoptMapCenter({ resetStrength: mode === 'imported' });
        $('rough_mode').value = mode;
        syncControlsFromSettings(); // 基础值/强度已被 adopt 改写，控件要跟着回到新数值
        NMO_Desktop.status(
          '已套用遮罩预设：' + preset.label +
            (mode === 'mixed'
              ? '（贴图 + 源图，强度 ' + Number($('rough_strength').value).toFixed(2) + '）'
              : '（来源＝导入贴图，基础值 ' + Number(adopted ? adopted.base : 0).toFixed(2) + '）'),
          'ok'
        );
        refreshAll();
      })
      .catch(function (err) {
        NMO_Desktop.status(err.message, 'error');
      });
  }

  /** “贴图 + 源图”的状态行：贴图名 + 当前强度，改强度时同步刷新。 */
  function mixedStatus() {
    if (!NMO_RoughnessMap.imported) return;
    var mapId = NMO_RoughnessMap.getPresetId();
    var mapName = mapId
      ? NMO_MaskPresets.labelOf(mapId)
      : NMO_RoughnessMap.imported.name || '';
    var strength = Number($('rough_strength').value);
    var text =
      '“贴图 + 源图”：' + (mapName ? mapName + ' ' : '') +
      '+ 源图细节 · 强度 ' + strength.toFixed(2);
    if (strength <= 0) text += '（强度为 0，结果等于纯贴图）';
    NMO_Desktop.status(text, 'ok');
  }

  /* ---------- 绑定 ---------- */
  function bindRoughness() {
    $('rough_mode').addEventListener('change', function () {
      if (
        this.value !== 'imported' &&
        this.value !== 'mixed' &&
        NMO_RoughnessMap.getPresetId &&
        NMO_RoughnessMap.getPresetId()
      ) {
        NMO_RoughnessMap.setPreset(null);
        if ($('rough_preset')) $('rough_preset').value = '';
      }
      NMO_RoughnessMap.setSetting('mode', this.value);
      if (this.value === 'imported' || this.value === 'mixed') {
        // 进入贴图模式时把“基础值”对齐到贴图中值、导入贴图下强度归 0，
        // 这样切过去的瞬间画面就是你的原图，再往上调才是改动。
        NMO_RoughnessMap.adoptMapCenter({ resetStrength: this.value === 'imported' });
        syncControlsFromSettings();
      }
      if (this.value === 'mixed') {
        if (!NMO_RoughnessMap.imported) {
          NMO_Desktop.status('“贴图 + 源图”需要先在下面选一个预设，或用“导入贴图…”导入一张遮罩。', 'error');
        } else {
          mixedStatus();
        }
      }
      refreshAll();
    });
    $('rough_value').addEventListener('input', function () {
      NMO_RoughnessMap.setSettings({ value: Number(this.value), base: Number(this.value) });
      $('rough_value_nmb').value = Number(this.value).toFixed(2);
      refreshAll();
    });
    $('rough_value_nmb').addEventListener('change', function () {
      var v = Math.max(0, Math.min(1, Number(this.value)));
      $('rough_value').value = v;
      NMO_RoughnessMap.setSettings({ value: v, base: v });
      refreshAll();
    });
    $('rough_strength').addEventListener('change', function () {
      NMO_RoughnessMap.setSetting('strength', Math.max(0, Math.min(3, Number(this.value) || 0)));
      if ($('rough_mode').value === 'mixed') mixedStatus();
      refreshAll();
    });
    $('rough_detail').addEventListener('change', function () {
      NMO_RoughnessMap.setSetting('detail', this.value);
      refreshAll();
    });
    $('rough_invert').addEventListener('change', function () {
      NMO_RoughnessMap.setSetting('invert', this.checked);
      refreshAll();
    });
    ['rough_min', 'rough_max'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        NMO_RoughnessMap.setSettings({
          min: Math.max(0, Math.min(1, Number($('rough_min').value))),
          max: Math.max(0, Math.min(1, Number($('rough_max').value)))
        });
        refreshAll();
      });
    });
    $('rough_import').addEventListener('click', function () {
      $('rough_file').click();
    });
    $('rough_file').addEventListener('change', function () {
      importInto('rough', this.files[0]);
      this.value = '';
    });
  }

  /* 复用粗糙度遮罩时，“导入遮罩…”没有意义，直接禁用并换掉提示文字。 */
  function syncMetalImportButton() {
    var btn = $('metal_import');
    if (!btn) return;
    var reuse = $('metal_mode').value === 'rough';
    btn.disabled = reuse;
    btn.title = reuse
      ? '当前复用粗糙度面板里的遮罩；要单独给金属度一张图，先把来源改成“导入遮罩”'
      : '导入一张黑白遮罩作为金属度（金属=白，非金属=黑）';
    if ($('metal_file')) $('metal_file').disabled = reuse;
  }

  function bindMetallic() {
    $('metal_mode').addEventListener('change', function () {
      NMO_MetallicMap.setSetting('mode', this.value);
      syncMetalImportButton();
      if (this.value === 'rough') {
        var hasMask = NMO_RoughnessMap && NMO_RoughnessMap.imported;
        NMO_Desktop.status(
          hasMask
            ? '金属度来源＝复用粗糙度遮罩：阈值/柔边/反转/上下限仍用金属度自己的设置。'
            : '粗糙度面板里还没有遮罩：先去那边选一个内置预设，或“导入贴图…”。',
          hasMask ? 'ok' : 'error'
        );
      }
      refreshAll();
    });
    $('metal_invert').addEventListener('change', function () {
      NMO_MetallicMap.setSetting('invert', this.checked);
      refreshAll();
    });
    ['metal_min', 'metal_max', 'metal_threshold', 'metal_softness'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        NMO_MetallicMap.setSettings({
          min: Math.max(0, Math.min(1, Number($('metal_min').value))),
          max: Math.max(0, Math.min(1, Number($('metal_max').value))),
          threshold: Math.max(0, Math.min(1, Number($('metal_threshold').value))),
          softness: Math.max(0, Math.min(1, Number($('metal_softness').value)))
        });
        refreshAll();
      });
    });
    $('metal_import').addEventListener('click', function () {
      $('metal_file').click();
    });
    $('metal_file').addEventListener('change', function () {
      importInto('metal', this.files[0]);
      this.value = '';
    });
  }

  function bindOrm() {
    $('orm_toggle').addEventListener('click', function () {
      if (this.disabled) return;
      var next = !NMO_ORM.isEnabled();
      NMO_ORM.setEnabled(next);
      this.setAttribute('aria-pressed', next ? 'true' : 'false');
      if (next && !NMO_ORM.isReady()) {
        NMO_Desktop.status('ORM 已启用，但当前数据还不完整：' + NMO_ORM.reason(), 'error');
      } else if (next) {
        NMO_Desktop.status('ORM 已启用：导出时用一张 ORM 替代 AO / 粗糙度 / 金属度 三张。', 'ok');
      } else {
        NMO_Desktop.status('ORM 已关闭：三项属性分别输出。', 'info');
      }
      updateStatus();
    });
    ['ambient_tick', 'roughness_tick', 'metallic_tick'].forEach(function (id) {
      $(id).addEventListener('change', updateOrmAvailability);
    });
    // 勾选粗糙度/金属度时默认给一份可用的常量数据，避免“勾了却没有图”。
    $('roughness_tick').addEventListener('change', function () {
      if (this.checked) NMO_PBR.refresh();
    });
    $('metallic_tick').addEventListener('change', function () {
      if (this.checked) NMO_PBR.refresh();
    });
  }

  $('pbr_resample_ok').addEventListener('click', function () {
    if (pendingImport) applyImport(pendingImport, true);
  });
  $('pbr_resample_cancel').addEventListener('click', function () {
    $('pbr_resample').hidden = true;
    pendingImport = null;
    NMO_Desktop.status('已取消导入，保留上一次的有效数据。', 'info');
  });

  window.addEventListener('DOMContentLoaded', function () {
    bindRoughness();
    bindMetallic();
    bindOrm();
    fillPresetOptions();
    pairSliders();
    syncControlsFromSettings();
    updateOrmAvailability();
    // 首帧的源图是内置示例，稍后再算，避免和初始化抢画布。
    window.setTimeout(refreshAll, 800);
  });

  window.NMO_PBRUI = {
    refreshAll: refreshAll,
    updateOrmAvailability: updateOrmAvailability,
    importInto: importInto,
    applyRoughPreset,
    async importMask(kind,file,resample){
      const decoded=await readImageToCanvas(file), size=sourceSize();
      const mismatch=size && (decoded.canvas.width!==size.width || decoded.canvas.height!==size.height);
      if(mismatch && !resample)throw Error('遮罩尺寸不同，请明确允许重采样');
      applyImport({...decoded,kind},mismatch);
    },
    drawThumb: drawThumb
  };
})();
