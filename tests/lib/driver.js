'use strict';

/*
 * driver.js — helpers shared by the scenario specs.
 * Everything here runs in the Electron main process and drives the page
 * through ctx.js / CDP, i.e. the same events a user would produce.
 */

const path = require('node:path');
const { readImageSize } = require('./imageinfo');

const FIXTURES = path.resolve(__dirname, '..', 'fixtures');

function fixture(...parts) {
  return path.join(FIXTURES, ...parts);
}

/** Waits until the app has finished booting the default height map. */
async function waitForBoot(ctx) {
  await ctx.waitFor('window.NMO_Main && window.NMO_FileDrop && NMO_FileDrop.height_image.naturalWidth > 0', 30000);
  await ctx.waitFor('NMO_NormalMap.normal_canvas.width > 0', 30000);
  await ctx.wait(600);
}

const CANVAS_NAMES = {
  normal: 'NMO_NormalMap.normal_canvas',
  displacement: 'NMO_DisplacementMap.displacement_canvas',
  ambient: 'NMO_AmbientOccMap.ao_canvas',
  specular: 'NMO_SpecularMap.specular_canvas'
};

async function canvasSizes(ctx) {
  return ctx.js(`(function(){
    return {
      normal: [NMO_NormalMap.normal_canvas.width, NMO_NormalMap.normal_canvas.height],
      displacement: [NMO_DisplacementMap.displacement_canvas.width, NMO_DisplacementMap.displacement_canvas.height],
      ambient: [NMO_AmbientOccMap.ao_canvas.width, NMO_AmbientOccMap.ao_canvas.height],
      specular: [NMO_SpecularMap.specular_canvas.width, NMO_SpecularMap.specular_canvas.height]
    };
  })()`);
}

/** PNG data URL of one generated map, straight off its canvas. */
async function canvasPng(ctx, which) {
  const expr = CANVAS_NAMES[which];
  if (!expr) throw new Error('unknown canvas: ' + which);
  return ctx.js(`${expr}.toDataURL('image/png')`);
}

async function allCanvasPng(ctx) {
  const out = {};
  for (const name of Object.keys(CANVAS_NAMES)) {
    out[name] = await canvasPng(ctx, name);
  }
  return out;
}

/**
 * 完成分类弹窗：逐张点同一个类别，再点确定。
 *
 * 阶段 A 之后，任何单图/批量导入都会先弹分类框。旧用例只关心后续的
 * 编码/写盘行为，因此这里统一给它们一个类别，并在需要时清空 sourceContext，
 * 让它们继续走“另存为”路径；新命名规则由 naming.spec 专门覆盖。
 */
async function completeClassification(ctx, category) {
  const open = await ctx.js("Boolean(document.getElementById('classify_dialog'))");
  if (!open) return false;
  await ctx.waitFor("!document.getElementById('classify_cat_wood').disabled", 20000);
  const total = await ctx.js('NMO_Classification.snapshot().total');
  for (let i = 0; i < total; i += 1) {
    await ctx.js(`document.getElementById('classify_cat_${category || 'wood'}').click()`);
    await ctx.wait(120);
  }
  await ctx.js("document.getElementById('classify_ok').click()");
  await ctx.waitFor("document.getElementById('classify_dialog') === null", 15000);
  return true;
}

/** 完成导出清单：选目录（由对话框桩提供）并开始导出。 */
async function completeExportPlan(ctx) {
  const open = await ctx.js("Boolean(document.getElementById('export_plan_dialog'))");
  if (!open) return false;
  await ctx.js("document.getElementById('export_plan_choose_dir').click()");
  await ctx.waitFor("!document.getElementById('export_plan_start').disabled", 15000);
  await ctx.js("document.getElementById('export_plan_start').click()");
  await ctx.waitFor("document.getElementById('export_plan_dialog') === null", 15000);
  return true;
}

/** Loads a file through the real <input type=file> (CDP), like a click would. */
async function loadHeightFile(ctx, filePath, win, options) {
  const target = win || ctx.win;
  const opts = options || {};
  const size = readImageSize(filePath);
  await ctx.setFileInput(target, '#select_file_height', [filePath]);
  await ctx.wait(250);
  const classified = await ctx.js("Boolean(document.getElementById('classify_dialog'))");
  if (classified) {
    await completeClassification(ctx, opts.category || 'wood');
  }
  await ctx.waitFor(
    `Math.round(NMO_FileDrop.height_image.naturalWidth) === ${size.width} && ` +
      `Math.round(NMO_FileDrop.height_image.naturalHeight) === ${size.height}`,
    25000
  );
  await ctx.waitFor(`NMO_NormalMap.normal_canvas.width === ${size.width}`, 25000);
  // 清空必须发生在图片载入之后：载入流程结束时会写 sourceContext，
  // 提前清会被它覆盖（曾经的时序 bug，让“无来源”测试走了计划导出）。
  if (classified && opts.keepContext !== true) {
    await ctx.js('NMO_Main.setSourceContext(null)');
  }
  await settle(ctx);
  return size;
}

/** Simulates a drag & drop onto an element, with a real File object. */
async function dropFile(ctx, selector, filePath, mime, options) {
  const fs = require('node:fs');
  const bytes = fs.readFileSync(filePath).toString('base64');
  const name = path.basename(filePath);
  const type = mime || guessMime(name);
  const size = readImageSize(filePath);

  await ctx.js(`(function(){
    var bin = atob(${JSON.stringify(bytes)});
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var dt = new DataTransfer();
    dt.items.add(new File([arr], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
    var el = document.querySelector(${JSON.stringify(selector)});
    var ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    el.dispatchEvent(ev);
    return true;
  })()`);

  // 高度图拖放也会先打开分类框（照片四个方向不会）。
  if (selector === '#height_map') {
    await ctx.wait(300);
    if (await ctx.js("Boolean(document.getElementById('classify_dialog'))")) {
      await completeClassification(ctx, (options && options.category) || 'wood');
      if (!options || options.keepContext !== true) {
        await ctx.js('NMO_Main.setSourceContext(null)');
      }
    }
  }

  if (size.width) {
    await ctx.waitFor(
      `NMO_NormalMap.normal_canvas.width === ${size.width} && ` +
        `NMO_NormalMap.normal_canvas.height === ${size.height}`,
      25000
    );
  }
  await settle(ctx);
  return size;
}

function guessMime(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  // Windows reports nothing for .tga; reproduce that on purpose.
  if (ext === '.tga') return '';
  return 'application/octet-stream';
}

/** WebGL readback is synchronous, but the preview frame is not; give it a tick. */
async function settle(ctx, ms) {
  await ctx.wait(ms || 500);
}

/** Sets a range/number/select control the way a user would, then waits. */
async function setControl(ctx, id, value, eventName) {
  await ctx.js(`(function(){
    var el = document.getElementById(${JSON.stringify(id)});
    if (!el) throw new Error('missing control: ' + ${JSON.stringify(id)});
    if (el.type === 'checkbox') {
      var want = ${JSON.stringify(value)} === true || ${JSON.stringify(String(value))} === 'true';
      if (el.checked !== want) { el.checked = want; el.click(); }
    } else if (el.tagName === 'SELECT') {
      el.value = ${JSON.stringify(String(value))};
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.value = ${JSON.stringify(String(value))};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`);
  await settle(ctx, 400);
}

async function readText(ctx, id) {
  return ctx.js(`document.getElementById(${JSON.stringify(id)}).value`);
}

/** Full hash of a data URL payload, so results can be compared cheaply. */
function hashOf(base64) {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
}

async function waitForFile(filePath, timeoutMs) {
  const fs = require('node:fs');
  const deadline = Date.now() + (timeoutMs || 20000);
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      // Give the writer a moment to close the handle / flush.
      await new Promise((r) => setTimeout(r, 120));
      const again = fs.statSync(filePath).size;
      if (again > 0) return true;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

module.exports = {
  FIXTURES,
  fixture,
  waitForBoot,
  canvasSizes,
  canvasPng,
  allCanvasPng,
  loadHeightFile,
  dropFile,
  completeClassification,
  completeExportPlan,
  setControl,
  readText,
  settle,
  hashOf,
  waitForFile
};
