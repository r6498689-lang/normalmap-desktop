/*
 * pbrMaps.js — 粗糙度 / 金属度 / ORM（第一版）
 *
 * 数据定义（写进 docs/DIFF_FROM_UPSTREAM.md，避免“同设置不可复现”）：
 *   Y        ：源图按 sRGB 8 位数值直接取的亮度
 *              Y = (0.2126 R + 0.7152 G + 0.0722 B) / 255
 *              不做 sRGB→线性转换、不做色调映射（这是颜色分析，不是渲染）
 *   灰度模式 ：S = Y - mean(Y)
 *   细节模式 ：S = Y - boxBlur(Y, 半径)      （可分离盒式模糊，边界取钳制值）
 *   粗糙度   ：R = clamp(base + strength × sign × S, min, max)
 *              sign = 反转 ? -1 : 1；strength 默认 0，所以默认结果恒等于 base
 *   输出     ：8 位，round(R × 255)；全黑/全白是合法数据
 *
 * ORM：R=AO、G=Roughness、B=Metallic，无损 RGB PNG（无 Alpha 通道）。
 */
(function () {
  'use strict';

  function createCanvas(width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  function clamp01(v) {
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /** 把画布重采样到目标尺寸（高质量双线性），用于预设/导入图与源图对齐。 */
  function resampleCanvas(canvas, width, height) {
    var out = createCanvas(width, height);
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, width, height);
    return out;
  }

  /** 读源图像素；没有源图时返回 null。 */
  function readSourcePixels() {
    var image = window.NMO_FileDrop && NMO_FileDrop.height_image;
    var width = image ? image.naturalWidth || image.width : 0;
    var height = image ? image.naturalHeight || image.height : 0;
    if (!width || !height) return null;
    var canvas = createCanvas(width, height);
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    try {
      return { width: width, height: height, data: ctx.getImageData(0, 0, width, height).data };
    } catch (err) {
      return null;
    }
  }

  function lumaArray(pixels) {
    var out = new Float32Array(pixels.width * pixels.height);
    var d = pixels.data;
    for (var i = 0, p = 0; i < d.length; i += 4, p += 1) {
      out[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    }
    return out;
  }

  function meanOf(values) {
    var sum = 0;
    for (var i = 0; i < values.length; i += 1) sum += values[i];
    return values.length ? sum / values.length : 0;
  }

  /**
   * 源图信号 S：
   *   gray   ：Y − mean(Y)              （整张图的明暗）
   *   detail ：Y − boxBlur(Y, scale)    （局部细节，去掉整体明暗）
   * 源图辅助与“贴图 + 源图”共用同一份信号，保证同一设置下两者可叠加。
   */
  function sourceSignal(pixels, s) {
    var y = lumaArray(pixels);
    var out = new Float32Array(y.length);
    if (s.detail === 'detail') {
      var blurred = boxBlur(y, pixels.width, pixels.height, Math.max(1, Math.round(s.scale)));
      for (var i = 0; i < y.length; i += 1) out[i] = y[i] - blurred[i];
      return out;
    }
    var mean = meanOf(y);
    for (var j = 0; j < y.length; j += 1) out[j] = y[j] - mean;
    return out;
  }

  /** 可分离盒式模糊；边界钳制。radius 为 0 时原样返回。 */
  function boxBlur(values, width, height, radius) {
    var r = Math.max(0, Math.round(radius));
    if (!r) return values;
    var tmp = new Float32Array(values.length);
    var out = new Float32Array(values.length);
    var x;
    var y;
    for (y = 0; y < height; y += 1) {
      for (x = 0; x < width; x += 1) {
        var sum = 0;
        var count = 0;
        for (var dx = -r; dx <= r; dx += 1) {
          var sx = x + dx;
          if (sx < 0) sx = 0;
          if (sx >= width) sx = width - 1;
          sum += values[y * width + sx];
          count += 1;
        }
        tmp[y * width + x] = sum / count;
      }
    }
    for (y = 0; y < height; y += 1) {
      for (x = 0; x < width; x += 1) {
        var sumY = 0;
        var countY = 0;
        for (var dy = -r; dy <= r; dy += 1) {
          var sy = y + dy;
          if (sy < 0) sy = 0;
          if (sy >= height) sy = height - 1;
          sumY += tmp[sy * width + x];
          countY += 1;
        }
        out[y * width + x] = sumY / countY;
      }
    }
    return out;
  }

  function normalizeRange(values, min, max) {
    var lo = Infinity;
    var hi = -Infinity;
    for (var i = 0; i < values.length; i += 1) {
      if (values[i] < lo) lo = values[i];
      if (values[i] > hi) hi = values[i];
    }
    var span = hi - lo;
    if (!isFinite(span) || span <= 1e-6) return new Float32Array(values.length);
    var out = new Float32Array(values.length);
    var target = max - min;
    for (var j = 0; j < values.length; j += 1) {
      out[j] = min + ((values[j] - lo) / span) * target;
    }
    return out;
  }

  function writeGray(canvas, values) {
    var ctx = canvas.getContext('2d');
    var image = ctx.createImageData(canvas.width, canvas.height);
    var d = image.data;
    for (var i = 0, p = 0; i < values.length; i += 1, p += 4) {
      var v = Math.max(0, Math.min(255, Math.round(values[i] * 255)));
      d[p] = v;
      d[p + 1] = v;
      d[p + 2] = v;
      d[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function importedToArray(canvas, channel) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    var out = new Float32Array(canvas.width * canvas.height);
    for (var i = 0, p = 0; i < data.length; i += 4, p += 1) {
      if (channel === 'r') out[p] = data[i] / 255;
      else if (channel === 'g') out[p] = data[i + 1] / 255;
      else if (channel === 'b') out[p] = data[i + 2] / 255;
      else out[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    }
    return out;
  }

  /*
   * AO 画布是 WebGL 画布（NMO_AmbientOccMap 用 THREE.WebGLRenderer 直接画在它上面），
   * getContext('2d') 会返回 null。先 drawImage 到 2D 临时画布再读像素，
   * 对 2D/WebGL 画布都成立。
   */
  function pixelsOf(canvas) {
    var scratch = createCanvas(canvas.width, canvas.height);
    var ctx = scratch.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  }

  function applyRange(values, opts) {
    var min = clamp01(opts.min);
    var max = clamp01(opts.max);
    if (min > max) {
      var t = min;
      min = max;
      max = t;
    }
    var out = new Float32Array(values.length);
    for (var i = 0; i < values.length; i += 1) {
      var v = opts.invert ? 1 - values[i] : values[i];
      out[i] = min + clamp01(v) * (max - min);
    }
    return out;
  }

  /* ================================================================== */
  /* Roughness                                                           */
  /* ================================================================== */
  var Roughness = function () {
    this.roughness_canvas = createCanvas(1, 1);
    this.imported = null; // {canvas, name}
    this.settings = {
      mode: 'uniform', // uniform | source | imported
      value: 0.5,
      base: 0.5,
      strength: 0,
      detail: 'gray', // gray | detail
      scale: 4,
      invert: false,
      min: 0,
      max: 1,
      channel: 'luma',
      importInvert: false,
      contrast: 0,
      blur: 0
    };
    this.version = 0;
    this.valid = false;
    this.lastError = '';
    this.mapMean = 0.5; // 最近一次贴图（导入或预设）的灰度中值，供“基础值”对齐
  };

  Roughness.prototype.setSetting = function (key, value) {
    if (!(key in this.settings)) return;
    this.settings[key] = value;
    this.generate();
  };

  Roughness.prototype.setSettings = function (patch) {
    var self = this;
    Object.keys(patch || {}).forEach(function (key) {
      if (key in self.settings) self.settings[key] = patch[key];
    });
    this.generate();
  };

  Roughness.prototype.getSettings = function () {
    return JSON.parse(JSON.stringify(this.settings));
  };

  Roughness.prototype.setImported = function (canvas, name, mode) {
    this.imported = canvas ? { canvas: canvas, name: name || '' } : null;
    this.importedRevision = window.NMO_FileDrop ? NMO_FileDrop.sourceRevision : 0;
    this._presetScaled = null;
    if (canvas) this.settings.mode = mode === 'mixed' ? 'mixed' : 'imported';
    this.generate();
  };

  /*
   * 内置遮罩预设：跟“导入的贴图”走同一条渲染路径，但不受源图版本约束——
   * 预设是应用自带的，换源图后仍然有效；换图时按新源图尺寸重采样。
   */
  Roughness.prototype.setPreset = function (canvas, presetId, mode) {
    var label = (window.NMO_MaskPresets && NMO_MaskPresets.labelOf(presetId)) || presetId || '';
    this.imported = canvas ? { canvas: canvas, name: label, presetId: presetId } : null;
    this.importedRevision = -1;
    this._presetScaled = null;
    if (canvas) this.settings.mode = mode === 'mixed' ? 'mixed' : 'imported';
    this.generate();
  };

  Roughness.prototype.getPresetId = function () {
    return (this.imported && this.imported.presetId) || '';
  };

  /**
   * 把“基础值”对齐到贴图自己的中值，让画面等于原图（不做整体增亮/压暗）。
   * resetStrength=true 时把“强度”归 0（导入贴图模式下 0 = 原样对比）。
   * 返回 {base, mean, strength} 供界面提示用。
   */
  Roughness.prototype.adoptMapCenter = function (opts) {
    var resetStrength = !!(opts && opts.resetStrength);
    if (this.settings.mode !== 'imported' && this.settings.mode !== 'mixed') return null;
    this.generate();
    if (!this.valid) return null;
    var mean = typeof this.mapMean === 'number' ? this.mapMean : this.settings.base;
    this.settings.base = Math.round(mean * 1000) / 1000;
    if (resetStrength) this.settings.strength = 0;
    this.generate();
    return { base: this.settings.base, mean: mean, strength: this.settings.strength };
  };

  /** 预设图按源图尺寸重采样；同尺寸只做一次，参数改动时复用。 */
  Roughness.prototype.scaledPreset = function (canvas) {
    var image = window.NMO_FileDrop && NMO_FileDrop.height_image;
    var width = image ? image.naturalWidth || image.width : 0;
    var height = image ? image.naturalHeight || image.height : 0;
    if (!width || !height) return canvas;
    if (canvas.width === width && canvas.height === height) return canvas;
    var cached = this._presetScaled;
    if (cached && cached.source === canvas && cached.width === width && cached.height === height) {
      return cached;
    }
    var scaled = resampleCanvas(canvas, width, height);
    scaled.source = canvas;
    this._presetScaled = scaled;
    return scaled;
  };

  Roughness.prototype.hasData = function () {
    return this.valid;
  };

  Roughness.prototype.resize = function (width, height) {
    if (this.roughness_canvas.width !== width || this.roughness_canvas.height !== height) {
      this.roughness_canvas.width = width;
      this.roughness_canvas.height = height;
    }
  };

  Roughness.prototype.generate = function () {
    var s = this.settings;
    this.valid = false;
    this.lastError = '';

    if (s.mode === 'imported' || s.mode === 'mixed') {
      if (!this.imported) {
        this.lastError = '还没有导入粗糙度贴图。';
        return;
      }
      var presetId = this.imported.presetId || '';
      if (!presetId && this.importedRevision !== (window.NMO_FileDrop ? NMO_FileDrop.sourceRevision : 0)) {
        this.lastError = '导入的粗糙度贴图属于上一张源图，请重新导入。';
        return;
      }
      var sourcePixels = s.mode === 'mixed' ? readSourcePixels() : null;
      if (s.mode === 'mixed' && !sourcePixels) {
        this.lastError = '没有可用的源图。';
        return;
      }
      var src = this.imported.canvas;
      if (presetId) src = this.scaledPreset(src);
      if (sourcePixels && (src.width !== sourcePixels.width || src.height !== sourcePixels.height)) {
        src = resampleCanvas(src, sourcePixels.width, sourcePixels.height);
      }
      this.resize(src.width, src.height);
      var values = importedToArray(src, s.channel);
      if (s.blur > 0) values = boxBlur(values, src.width, src.height, s.blur);
      if (s.contrast) {
        var c = 1 + clamp01(Math.abs(s.contrast)) * (s.contrast >= 0 ? 3 : 0.9);
        for (var i = 0; i < values.length; i += 1) {
          values[i] = clamp01((values[i] - 0.5) * c + 0.5);
        }
      }
      if (s.importInvert) {
        for (var f = 0; f < values.length; f += 1) values[f] = 1 - values[f];
      }

      /*
       * 1.1.13：贴着“贴图”本身的两个参数
       *
       *   基础值 → 图案的中值（把整张图平移到这个数值）
       *   强度   → 对比（0 = 原样，1 = 3 倍；只作用于“导入贴图”，
       *            混合模式里强度仍然是“源图细节加多少”）
       *
       * 平移量取「设置的中值 − 贴图自己的中值」，所以贴图一换、
       * 只要中值被同步过（adoptMapCenter），画面就和原图一模一样。
       */
      var mapMean = meanOf(values);
      this.mapMean = mapMean;
      var center = clamp01(Number(s.base));
      var gain = s.mode === 'imported' ? 1 + 2 * Math.max(0, Math.min(1, Number(s.strength) || 0)) : 1;
      for (var g = 0; g < values.length; g += 1) {
        values[g] = clamp01(center + (values[g] - mapMean) * gain);
      }

      /*
       * 贴图 + 源图：贴图给“底”，源图信号给“起伏”。
       * R = clamp(贴图值 + 强度 × 符号 × S, 0, 1)，再套上下限。
       * 强度为 0 时逐像素等于纯“导入贴图”，方便对照。
       */
      if (s.mode === 'mixed') {
        var signal = sourceSignal(sourcePixels, s);
        var strength = Math.max(0, Math.min(3, Number(s.strength) || 0));
        var sign = s.invert ? -1 : 1;
        for (var m = 0; m < values.length; m += 1) {
          values[m] = clamp01(values[m] + strength * sign * signal[m]);
        }
      }

      writeGray(this.roughness_canvas, applyRange(values, { min: s.min, max: s.max, invert: false }));
      this.valid = true;
      this.version += 1;
      return;
    }

    var pixels = readSourcePixels();
    if (!pixels) {
      this.lastError = '没有可用的源图。';
      return;
    }
    this.resize(pixels.width, pixels.height);

    if (s.mode === 'uniform') {
      var out = new Float32Array(pixels.width * pixels.height);
      var v = clamp01(s.value);
      for (var k = 0; k < out.length; k += 1) out[k] = v;
      writeGray(this.roughness_canvas, out);
      this.valid = true;
      this.version += 1;
      return;
    }

    var signal = sourceSignal(pixels, s);

    // 平坦输入：信号恒为 0，结果就是基础值，不做归一化放大。
    var strength = Math.max(0, Math.min(3, Number(s.strength) || 0));
    var sign = s.invert ? -1 : 1;
    var out2 = new Float32Array(pixels.width * pixels.height);
    for (var n = 0; n < out2.length; n += 1) {
      var value = s.base + strength * sign * signal[n];
      out2[n] = clamp01(value);
    }
    writeGray(this.roughness_canvas, applyRange(out2, { min: s.min, max: s.max, invert: false }));
    this.valid = true;
    this.version += 1;
  };

  /* ================================================================== */
  /* Metallic                                                            */
  /* ================================================================== */
  var Metallic = function () {
    this.metallic_canvas = createCanvas(1, 1);
    this.imported = null;
    this.settings = {
      mode: 'none', // none | full | mask
      invert: false,
      min: 0,
      max: 1,
      threshold: 0,
      softness: 0,
      channel: 'luma'
    };
    this.version = 0;
    this.valid = false;
    this.lastError = '';
  };

  Metallic.prototype.setSetting = function (key, value) {
    if (!(key in this.settings)) return;
    this.settings[key] = value;
    this.generate();
  };

  Metallic.prototype.setSettings = function (patch) {
    var self = this;
    Object.keys(patch || {}).forEach(function (key) {
      if (key in self.settings) self.settings[key] = patch[key];
    });
    this.generate();
  };

  Metallic.prototype.getSettings = function () {
    return JSON.parse(JSON.stringify(this.settings));
  };

  Metallic.prototype.setImported = function (canvas, name) {
    this.imported = canvas ? { canvas: canvas, name: name || '' } : null;
    this.importedRevision = window.NMO_FileDrop ? NMO_FileDrop.sourceRevision : 0;
    if (canvas) this.settings.mode = 'mask';
    this.generate();
  };

  Metallic.prototype.hasData = function () {
    return this.valid;
  };

  Metallic.prototype.resize = function (width, height) {
    if (this.metallic_canvas.width !== width || this.metallic_canvas.height !== height) {
      this.metallic_canvas.width = width;
      this.metallic_canvas.height = height;
    }
  };

  /** 阈值 + 柔边：softness=0 时是硬阈值，但默认 threshold=0 不做二值化。 */
  Metallic.prototype._shapeMask = function (values, s) {
    var threshold = clamp01(s.threshold);
    var soft = Math.max(0, Math.min(1, s.softness));
    if (threshold <= 0 && soft <= 0) return values;
    for (var i = 0; i < values.length; i += 1) {
      if (soft === 0) {
        values[i] = values[i] >= threshold ? 1 : 0;
      } else {
        var edge = (values[i] - threshold) / Math.max(1e-4, soft);
        values[i] = clamp01(edge * 0.5 + 0.5);
      }
    }
    return values;
  };

  Metallic.prototype.generate = function () {
    var s = this.settings;
    this.valid = false;
    this.lastError = '';

    /*
     * 1.1.14：复用粗糙度遮罩。
     * 直接拿粗糙度面板里那张图（内置预设或手动导入的），阈值/柔边/反转/上下限
     * 仍然用金属度自己的——同一张噪点，粗糙度靠“明暗”读，金属靠“分区”读。
     */
    if (s.mode === 'rough') {
      var rough = window.NMO_RoughnessMap;
      if (!rough || !rough.imported) {
        this.lastError = '粗糙度面板里还没有遮罩：先选一个内置预设，或在那边的“导入贴图…”里选一张。';
        return;
      }
      var roughId = rough.imported.presetId || '';
      if (!roughId && rough.importedRevision !== (window.NMO_FileDrop ? NMO_FileDrop.sourceRevision : 0)) {
        this.lastError = '粗糙度的遮罩属于上一张源图，请重新导入后再复用。';
        return;
      }
      var pixelsR = readSourcePixels();
      if (!pixelsR) {
        this.lastError = '没有可用的源图。';
        return;
      }
      var mapCanvas = rough.imported.canvas;
      if (roughId && rough.scaledPreset) mapCanvas = rough.scaledPreset(mapCanvas);
      if (mapCanvas.width !== pixelsR.width || mapCanvas.height !== pixelsR.height) {
        mapCanvas = resampleCanvas(mapCanvas, pixelsR.width, pixelsR.height);
      }
      this.resize(pixelsR.width, pixelsR.height);
      var fromMask = importedToArray(mapCanvas, s.channel);
      this._shapeMask(fromMask, s);
      writeGray(this.metallic_canvas, applyRange(fromMask, { min: s.min, max: s.max, invert: s.invert }));
      this.valid = true;
      this.version += 1;
      return;
    }

    if (s.mode === 'mask') {
      if (!this.imported) {
        this.lastError = '还没有导入金属度遮罩。';
        return;
      }
      if (this.importedRevision !== (window.NMO_FileDrop ? NMO_FileDrop.sourceRevision : 0)) {
        this.lastError = '导入的遮罩属于上一张源图，请重新导入。';
        return;
      }
      var src = this.imported.canvas;
      this.resize(src.width, src.height);
      var values = importedToArray(src, s.channel);
      this._shapeMask(values, s);
      writeGray(this.metallic_canvas, applyRange(values, { min: s.min, max: s.max, invert: s.invert }));
      this.valid = true;
      this.version += 1;
      return;
    }

    var pixels = readSourcePixels();
    if (!pixels) {
      this.lastError = '没有可用的源图。';
      return;
    }
    this.resize(pixels.width, pixels.height);
    var out = new Float32Array(pixels.width * pixels.height);
    var v = s.mode === 'full' ? 1 : 0;
    for (var k = 0; k < out.length; k += 1) out[k] = v;
    writeGray(this.metallic_canvas, out);
    this.valid = true;
    this.version += 1;
  };

  /* ================================================================== */
  /* ORM                                                                 */
  /* ================================================================== */
  var ORM = function () {
    this.orm_canvas = createCanvas(1, 1);
    this.enabled = false;
    this.channel = 'composite';
    this.lastError = '';
    this.version = 0;
  };

  ORM.prototype.setEnabled = function (on) {
    this.enabled = Boolean(on);
  };

  ORM.prototype.isEnabled = function () {
    return this.enabled;
  };

  ORM.prototype._inputs = function () {
    var ao = window.NMO_AmbientOccMap && NMO_AmbientOccMap.ao_canvas;
    var rough = window.NMO_RoughnessMap && NMO_RoughnessMap.roughness_canvas;
    var metal = window.NMO_MetallicMap && NMO_MetallicMap.metallic_canvas;
    if (!ao || !ao.width) return { ok: false, reason: 'AO 还没有生成。' };
    if (!window.NMO_RoughnessMap || !NMO_RoughnessMap.hasData()) {
      return { ok: false, reason: NMO_RoughnessMap ? NMO_RoughnessMap.lastError || '粗糙度没有有效数据。' : '粗糙度模块不可用。' };
    }
    if (!window.NMO_MetallicMap || !NMO_MetallicMap.hasData()) {
      return { ok: false, reason: NMO_MetallicMap ? NMO_MetallicMap.lastError || '金属度没有有效数据。' : '金属度模块不可用。' };
    }
    if (ao.width !== rough.width || ao.height !== rough.height) {
      return { ok: false, reason: 'AO 与粗糙度尺寸不一致（' + ao.width + '×' + ao.height + ' vs ' + rough.width + '×' + rough.height + '）。' };
    }
    if (ao.width !== metal.width || ao.height !== metal.height) {
      return { ok: false, reason: 'AO 与金属度尺寸不一致（' + ao.width + '×' + ao.height + ' vs ' + metal.width + '×' + metal.height + '）。' };
    }
    return { ok: true, ao: ao, rough: rough, metal: metal, width: ao.width, height: ao.height };
  };

  ORM.prototype.isReady = function () {
    var inputs = this._inputs();
    this.lastError = inputs.ok ? '' : inputs.reason;
    return inputs.ok;
  };

  ORM.prototype.reason = function () {
    var inputs = this._inputs();
    return inputs.ok ? '' : inputs.reason;
  };

  ORM.prototype.compose = function () {
    var inputs = this._inputs();
    if (!inputs.ok) {
      this.lastError = inputs.reason;
      return false;
    }
    if (this.orm_canvas.width !== inputs.width || this.orm_canvas.height !== inputs.height) {
      this.orm_canvas.width = inputs.width;
      this.orm_canvas.height = inputs.height;
    }
    var ao = pixelsOf(inputs.ao);
    var rough = pixelsOf(inputs.rough);
    var metal = pixelsOf(inputs.metal);
    var ctx = this.orm_canvas.getContext('2d');
    var image = ctx.createImageData(inputs.width, inputs.height);
    var out = image.data;
    for (var i = 0; i < out.length; i += 4) {
      // 三个输入都是灰度图：取各自 R 通道，逐像素复制，不做 gamma。
      out[i] = ao[i];
      out[i + 1] = rough[i];
      out[i + 2] = metal[i];
      out[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    this.version += 1;
    this.lastError = '';
    return true;
  };

  /** 通道查看：只影响显示，不改数据。 */
  ORM.prototype.drawChannel = function (targetCanvas, channel) {
    var inputs = this._inputs();
    if (!inputs.ok) return false;
    var width = inputs.width;
    var height = inputs.height;
    if (targetCanvas.width !== width || targetCanvas.height !== height) {
      targetCanvas.width = width;
      targetCanvas.height = height;
    }
    var source =
      channel === 'R' ? inputs.ao : channel === 'G' ? inputs.rough : channel === 'B' ? inputs.metal : this.orm_canvas;
    if (channel === 'composite' && this.orm_canvas.width !== width) this.compose();
    var ctx = targetCanvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    if (channel === 'composite') {
      ctx.drawImage(this.orm_canvas, 0, 0);
      return true;
    }
    var data = pixelsOf(source);
    var image = ctx.createImageData(width, height);
    for (var i = 0; i < image.data.length; i += 4) {
      var v = data[i];
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return true;
  };

  /* ---------------- 真 RGB PNG 编码（不带 Alpha） ---------------- */
  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n += 1) {
      var c = n;
      for (var k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    var out = new Uint8Array(12 + data.length);
    var view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (var i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') {
      return Promise.reject(new Error('当前运行时缺少 CompressionStream，无法编码 ORM。'));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  /** 输出真正的 8 位 RGB PNG（color type 2），没有 Alpha 通道。 */
  ORM.prototype.encodeRgb = function () {
    var self = this;
    if (!this.compose()) return Promise.reject(new Error(this.lastError || 'ORM 无法合成。'));
    var width = this.orm_canvas.width;
    var height = this.orm_canvas.height;
    var rgba = this.orm_canvas
      .getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, width, height).data;

    var stride = width * 3;
    var raw = new Uint8Array((stride + 1) * height);
    for (var y = 0; y < height; y += 1) {
      var rowStart = y * (stride + 1);
      raw[rowStart] = 0; // filter type 0 (None)，逐字节原样
      var src = y * width * 4;
      var dst = rowStart + 1;
      for (var x = 0; x < width; x += 1) {
        raw[dst] = rgba[src];
        raw[dst + 1] = rgba[src + 1];
        raw[dst + 2] = rgba[src + 2];
        src += 4;
        dst += 3;
      }
    }

    return deflate(raw).then(function (compressed) {
      var ihdr = new Uint8Array(13);
      var view = new DataView(ihdr.buffer);
      view.setUint32(0, width);
      view.setUint32(4, height);
      ihdr[8] = 8; // bit depth
      ihdr[9] = 2; // colour type: truecolour RGB
      ihdr[10] = 0;
      ihdr[11] = 0;
      ihdr[12] = 0;

      var signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      var parts = [
        signature,
        chunk('IHDR', ihdr),
        chunk('IDAT', compressed),
        chunk('IEND', new Uint8Array(0))
      ];
      var total = parts.reduce(function (sum, part) {
        return sum + part.length;
      }, 0);
      var png = new Uint8Array(total);
      var offset = 0;
      parts.forEach(function (part) {
        png.set(part, offset);
        offset += part.length;
      });
      self.version += 1;
      return png;
    });
  };

  /* 设置变化后刷新预览与预览材质。 */
  function refreshPbr() {
    if (window.NMO_RoughnessMap) NMO_RoughnessMap.generate();
    if (window.NMO_MetallicMap) NMO_MetallicMap.generate();
    if (window.NMO_ORM && NMO_ORM.isEnabled()) NMO_ORM.compose();
    if (window.NMO_PBRPreview && NMO_PBRPreview.refresh) NMO_PBRPreview.refresh();
  }

  window.NMO_RoughnessMap = new Roughness();
  window.NMO_MetallicMap = new Metallic();
  window.NMO_ORM = new ORM();
  window.NMO_PBR = { refresh: refreshPbr, clamp01: clamp01 };
})();
