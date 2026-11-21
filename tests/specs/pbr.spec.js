'use strict';

/*
 * pbr.spec.js — 阶段 C 验收（R01–R03、P01）
 *
 * 数值用例直接读画布像素：8 位统一值按 round(value × 255) 断言。
 * PBR 预览用固定视角截图对比：同一模型/灯光/环境，只改粗糙度或金属度，
 * 画面必须有可测差异（不是只看灰度小图）。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const driver = require('../lib/driver');

/* ---------- 极简 PNG 写入器（测试数据用） ---------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function writePng(file, width, height, pixelAt) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const rgb = pixelAt(x, y);
      const off = y * (stride + 1) + 1 + x * 3;
      raw[off] = rgb[0];
      raw[off + 1] = rgb[1];
      raw[off + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return file;
}

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-pbr-'));
  const flat = writePng(path.join(tmp, 'flat-64.png'), 64, 64, () => [128, 128, 128]);
  const mask = writePng(path.join(tmp, 'mask-256.png'), 256, 256, (x) => {
    const v = x < 85 ? 0 : x < 170 ? 128 : 255;
    return [v, v, v];
  });
  const smallMask = writePng(path.join(tmp, 'mask-64.png'), 64, 64, () => [255, 255, 255]);

  const pixel = (canvasExpr, x, y) =>
    ctx.js(`(function(){
      var c = ${canvasExpr};
      var d = c.getContext('2d').getImageData(${x}, ${y}, 1, 1).data;
      return JSON.stringify([d[0], d[1], d[2], d[3]]);
    })()`);

  const roughPixel = async (x, y) => JSON.parse(await pixel('NMO_RoughnessMap.roughness_canvas', x, y));
  const metalPixel = async (x, y) => JSON.parse(await pixel('NMO_MetallicMap.metallic_canvas', x, y));

  await driver.waitForBoot(ctx);

  /* ---------------- R01 统一数值：0 / 0.5 / 1 ---------------- */
  await ctx.js("document.getElementById('rough_mode').value = 'uniform'; document.getElementById('rough_mode').dispatchEvent(new Event('change'))");
  for (const [value, expected] of [
    ['0', 0],
    ['0.5', 128],
    ['1', 255]
  ]) {
    await driver.setControl(ctx, 'rough_value_nmb', value);
    await ctx.wait(250);
    const got = await roughPixel(3, 3);
    check(
      `R01 统一粗糙度 ${value} → ${expected}`,
      got[0] === expected && got[1] === expected && got[2] === expected,
      JSON.stringify(got)
    );
  }
  const sizeCheck = await ctx.js(
    'JSON.stringify([NMO_RoughnessMap.roughness_canvas.width, NMO_RoughnessMap.roughness_canvas.height, NMO_FileDrop.height_image.naturalWidth])'
  );
  const [rw, rh, sw] = JSON.parse(sizeCheck);
  check('R01 粗糙度画布与源图同尺寸', rw === sw && rh === sw, sizeCheck);

  /* ---------------- R01 源图辅助：强度 0 = 基础值；平坦输入无 NaN ---------------- */
  await driver.loadHeightFile(ctx, flat);
  await ctx.js("document.getElementById('rough_mode').value = 'source'; document.getElementById('rough_mode').dispatchEvent(new Event('change'))");
  await ctx.js(`(function(){
    var base = document.getElementById('rough_value_nmb');
    base.value = '0.3'; base.dispatchEvent(new Event('change', { bubbles: true }));
    var s = document.getElementById('rough_strength');
    s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await ctx.wait(400);
  const flatPixels = JSON.parse(
    await ctx.js(`(function(){
      var c = NMO_RoughnessMap.roughness_canvas;
      var d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      var min = 255, max = 0, nan = 0, sum = 0;
      for (var i = 0; i < d.length; i += 4){
        if (!isFinite(d[i])) nan += 1;
        if (d[i] < min) min = d[i];
        if (d[i] > max) max = d[i];
        sum += d[i];
      }
      return JSON.stringify({min: min, max: max, nan: nan, mean: sum / (d.length/4)});
    })()`)
  );
  // 0.3 × 255 = 76.5 → Math.round 得 77；与统一值用的是同一套量化规则。
  check('R01 强度 0 时平坦输入恒为基础值 0.3', flatPixels.min === 77 && flatPixels.max === 77, JSON.stringify(flatPixels));
  check('R01 平坦输入没有 NaN', flatPixels.nan === 0, JSON.stringify(flatPixels));

  // 非平坦源图 + 强度 0.5：应产生变化，但被 clamp 在 0..1
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'));
  await ctx.js("document.getElementById('rough_mode').value = 'source'; document.getElementById('rough_mode').dispatchEvent(new Event('change'))");
  await ctx.js(`(function(){
    var s = document.getElementById('rough_strength');
    s.value = '0.5'; s.dispatchEvent(new Event('change', { bubbles: true }));
    var inv = document.getElementById('rough_invert');
    inv.checked = false; inv.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await ctx.wait(500);
  const varied = JSON.parse(
    await ctx.js(`(function(){
      var c = NMO_RoughnessMap.roughness_canvas;
      var d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      var min = 255, max = 0;
      for (var i = 0; i < d.length; i += 4){ if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
      return JSON.stringify({min: min, max: max});
    })()`)
  );
  check('R01 源图辅助产生可观察变化', varied.max - varied.min > 5, JSON.stringify(varied));
  check('R01 输出被限制在 0..255', varied.min >= 0 && varied.max <= 255, JSON.stringify(varied));

  // 反转只改变变化方向，不把基础值变成 1-base
  await ctx.js("document.getElementById('rough_invert').checked = true; document.getElementById('rough_invert').dispatchEvent(new Event('change'))");
  await ctx.wait(300);
  const invertedMean = JSON.parse(
    await ctx.js(`(function(){
      var c = NMO_RoughnessMap.roughness_canvas;
      var d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      var sum = 0; for (var i = 0; i < d.length; i += 4) sum += d[i];
      return JSON.stringify({mean: sum / (d.length/4)});
    })()`)
  );
  check(
    'R01 反转后均值仍围绕基础值 0.3',
    Math.abs(invertedMean.mean / 255 - 0.3) < 0.08,
    JSON.stringify(invertedMean)
  );

  /* ---------------- R02 金属度：非金属 / 裸金属 ---------------- */
  await ctx.js("document.getElementById('metal_mode').value = 'none'; document.getElementById('metal_mode').dispatchEvent(new Event('change'))");
  await ctx.wait(300);
  check('R02 非金属全黑', (await metalPixel(10, 10))[0] === 0, JSON.stringify(await metalPixel(10, 10)));
  await ctx.js("document.getElementById('metal_mode').value = 'full'; document.getElementById('metal_mode').dispatchEvent(new Event('change'))");
  await ctx.wait(300);
  check('R02 裸金属全白', (await metalPixel(10, 10))[0] === 255, JSON.stringify(await metalPixel(10, 10)));

  /* ---------------- R02 导入遮罩：保留中间值、源文件不变 ---------------- */
  const maskHashBefore = crypto.createHash('sha256').update(fs.readFileSync(mask)).digest('hex');
  await ctx.setFileInput(ctx.win, '#metal_file', [mask]);
  await ctx.wait(1200);
  const modeAfterImport = await ctx.js("document.getElementById('metal_mode').value");
  check('R02 导入后自动进入遮罩模式', modeAfterImport === 'mask', modeAfterImport);
  const left = await metalPixel(20, 20);
  const mid = await metalPixel(128, 20);
  const right = await metalPixel(240, 20);
  check('R02 遮罩黑色区 → 0', left[0] === 0, JSON.stringify(left));
  check('R02 遮罩灰色区 → 128（未被强行二值化）', mid[0] === 128, JSON.stringify(mid));
  check('R02 遮罩白色区 → 255', right[0] === 255, JSON.stringify(right));
  const maskHashAfter = crypto.createHash('sha256').update(fs.readFileSync(mask)).digest('hex');
  check('R02 原始遮罩文件未被修改', maskHashBefore === maskHashAfter);

  /* ---------------- R02 尺寸不符：先询问，取消保留旧数据 ---------------- */
  await ctx.setFileInput(ctx.win, '#metal_file', [smallMask]);
  await ctx.waitFor("document.getElementById('pbr_resample').hidden === false", 10000);
  const resampleText = await ctx.js("document.getElementById('pbr_resample_text').textContent");
  check('R02 尺寸不符给出提示', /64×64/.test(resampleText), resampleText);
  await ctx.js("document.getElementById('pbr_resample_cancel').click()");
  await ctx.wait(300);
  check(
    'R02 取消导入保留上一次有效数据',
    (await metalPixel(240, 20))[0] === 255,
    JSON.stringify(await metalPixel(240, 20))
  );
  check('R02 取消后提示条收起', (await ctx.js("document.getElementById('pbr_resample').hidden")) === true);

  await ctx.setFileInput(ctx.win, '#metal_file', [smallMask]);
  await ctx.waitFor("document.getElementById('pbr_resample').hidden === false", 10000);
  await ctx.js("document.getElementById('pbr_resample_ok').click()");
  await ctx.wait(600);
  const resampled = JSON.parse(
    await ctx.js('JSON.stringify([NMO_MetallicMap.metallic_canvas.width, NMO_MetallicMap.metallic_canvas.height])')
  );
  check('R02 选择重采样后尺寸与源图一致', resampled[0] === 256 && resampled[1] === 256, JSON.stringify(resampled));

  /* ---------------- R04 金属度复用粗糙度遮罩（1.1.14） ---------------- */
  await ctx.js(`(function(){
    var s = document.getElementById('rough_preset');
    s.value = 'peeling-wood';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await ctx.waitFor("NMO_RoughnessMap.getPresetId() === 'peeling-wood' && NMO_RoughnessMap.hasData()", 20000);
  await ctx.wait(400);
  await ctx.js("document.getElementById('metal_mode').value='rough'; document.getElementById('metal_mode').dispatchEvent(new Event('change'))");
  await ctx.wait(600);

  const reuse = JSON.parse(await ctx.js(`(function(){
    var c = NMO_MetallicMap.metallic_canvas;
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    var min = 255, max = 0, sum = 0, n = 0;
    for (var i = 0; i < d.length; i += 4) {
      var v = d[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v; n += 1;
    }
    return JSON.stringify({
      valid: NMO_MetallicMap.hasData(),
      error: NMO_MetallicMap.lastError,
      size: [c.width, c.height],
      min: min, max: max, mean: Math.round(sum / n),
      importDisabled: document.getElementById('metal_import').disabled,
      mode: NMO_MetallicMap.getSettings().mode
    });
  })()`));
  check('R04 复用粗糙度遮罩后有数据', reuse.valid === true, JSON.stringify(reuse));
  check('R04 尺寸跟随源图', reuse.size[0] === 256 && reuse.size[1] === 256, JSON.stringify(reuse.size));
  check('R04 明暗起伏来自那张遮罩（不是常数）', reuse.max - reuse.min >= 60, JSON.stringify(reuse));
  check('R04 复用模式下“导入遮罩…”被禁用', reuse.importDisabled === true, String(reuse.importDisabled));

  await ctx.js(`(function(){
    var t = document.getElementById('metal_threshold');
    t.value = '0.5';
    t.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await ctx.wait(600);
  const binarized = JSON.parse(await ctx.js(`(function(){
    var c = NMO_MetallicMap.metallic_canvas;
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    var zeros = 0, fulls = 0, other = 0;
    for (var i = 0; i < d.length; i += 4) {
      var v = d[i];
      if (v === 0) zeros += 1;
      else if (v === 255) fulls += 1;
      else other += 1;
    }
    return JSON.stringify({ zeros: zeros, fulls: fulls, other: other });
  })()`));
  check(
    'R04 阈值 0.5 + 柔边 0 → 二值化（只有 0/255）',
    binarized.other === 0 && binarized.zeros > 0 && binarized.fulls > 0,
    JSON.stringify(binarized)
  );

  // 复位成“导入遮罩”，后面的 R03（换源图后旧遮罩失效）仍按原路径验证
  await ctx.js(`(function(){
    var t = document.getElementById('metal_threshold');
    t.value = '0';
    t.dispatchEvent(new Event('change', { bubbles: true }));
    var m = document.getElementById('metal_mode');
    m.value = 'mask';
    m.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await ctx.wait(300);

  /* ---------------- R03 逐源绑定：换源图后旧遮罩不冒充新数据 ---------------- */
  await driver.loadHeightFile(ctx, flat);
  const staleMask = JSON.parse(
    await ctx.js('JSON.stringify({ valid: NMO_MetallicMap.hasData(), error: NMO_MetallicMap.lastError, rev: NMO_FileDrop.sourceRevision })')
  );
  check('R03 换源图后旧遮罩不再被当成新数据', staleMask.valid === false, JSON.stringify(staleMask));
  check('R03 明确说明遮罩属于上一张源图', /上一张源图/.test(staleMask.error || ''), staleMask.error);

  /* ---------------- P01 PBR 预览：粗糙度/金属度真的改变反射 ---------------- */
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'));
  // 1.1.14 起切到“粗糙度”选项卡会自动打开 PBR 预览，这里改成“确保开着”，
  // 否则再点一次反而会把它关掉。
  await ctx.js(`(function(){
    if (!NMO_PBRPreview.isEnabled()) document.getElementById('pbr_preview_toggle').click();
  })()`);
  await ctx.js("if (document.getElementById('input_rot').checked) document.getElementById('input_rot').click()");
  await ctx.wait(1200);
  const materialName = await ctx.js('NMO_RenderView.render_model.material.name || ""');
  check('P01 预览材质已切到 PBR', materialName === 'nmo-pbr', materialName);

  const rect = await ctx.js(`(function(){
    var r = document.getElementById('render_view').getBoundingClientRect();
    return JSON.stringify({x: r.x, y: r.y, width: r.width, height: r.height});
  })()`);
  const area = JSON.parse(rect);

  async function shot(roughValue, metalValue, name) {
    await ctx.js("document.getElementById('rough_mode').value='uniform'; document.getElementById('rough_mode').dispatchEvent(new Event('change'))");
    await driver.setControl(ctx, 'rough_value_nmb', String(roughValue));
    await ctx.js(`(function(){
      document.getElementById('metal_mode').value = '${metalValue}';
      document.getElementById('metal_mode').dispatchEvent(new Event('change'));
    })()`);
    await ctx.wait(900);
    const file = await ctx.screenshotRect(name, area);
    return fs.readFileSync(file);
  }

  const smooth = await shot(0.1, 'none', 'pbr-rough-010.png');
  const rough = await shot(0.9, 'none', 'pbr-rough-090.png');
  const roughCmp = ctx.compare(smooth, rough);
  check(
    'P01 粗糙度 0.1 vs 0.9 画面有可测差异',
    !roughCmp.identical && roughCmp.differingRatio > 0.02,
    JSON.stringify({ ratio: roughCmp.differingRatio, mean: roughCmp.meanChannelDelta })
  );

  const dielectric = await shot(0.4, 'none', 'pbr-metal-000.png');
  const metallicShot = await shot(0.4, 'full', 'pbr-metal-100.png');
  const metalCmp = ctx.compare(dielectric, metallicShot);
  check(
    'P01 金属度 0 vs 1 画面有可测差异',
    !metalCmp.identical && metalCmp.differingRatio > 0.02,
    JSON.stringify({ ratio: metalCmp.differingRatio, mean: metalCmp.meanChannelDelta })
  );

  // 用截图自身算平均亮度：WebGL 未开 preserveDrawingBuffer，渲染后 readPixels 会读到 0。
  const decoded = ctx.decodeToBitmap(metallicShot);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < decoded.bitmap.length; i += 4) {
    sum += (decoded.bitmap[i] + decoded.bitmap[i + 1] + decoded.bitmap[i + 2]) / 3;
    count += 1;
  }
  const meanBrightness = count ? sum / count : 0;
  check('P01 金属预览不是全黑（环境贴图实际参与）', meanBrightness > 5, String(meanBrightness.toFixed(2)));

  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无渲染进程报错', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'pbr',
    method: '画布像素 + 固定视角截图对比（关闭旋转，同一模型/灯光/环境）',
    fixtureDir: tmp,
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
