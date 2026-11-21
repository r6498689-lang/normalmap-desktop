'use strict';

/*
 * mask-presets.spec.js — 内置十张黑白遮罩 + “贴图 + 源图”（1.1.6 / 1.1.7）
 *
 * 覆盖：
 *   1. 预设下拉的选项（1 个占位 + 10 张遮罩）、位置（上限下面）、导入按钮位置（来源行右端）；
 *   2. 选中预设 → 来源自动切“导入贴图”、画布有明暗起伏、尺寸跟随源图；
 *   3. 换源图后预设仍然有效（不像手动导入那样失效），并按新尺寸重采样；
 *   4. 换另一个预设 → 画面不同；
 *   5. 选回占位项 → 回到统一数值；
 *   6. “贴图 + 源图”：强度 0 时逐像素等于纯贴图，强度 > 0 时叠加源图信号；
 *   7. 混合模式下换源图仍有效；取消预设回落到“源图辅助”；
 *   8. 手动导入文件清空预设；恢复默认清空全部。
 */

const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  const started = Date.now();
  const failures = [];
  const steps = [];
  function check(label, ok, detail) {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  }

  await driver.waitForBoot(ctx);

  const read = () =>
    ctx.js(`(function(){
      var c = NMO_RoughnessMap.roughness_canvas;
      var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      var min = 255, max = 0, sum = 0, n = 0, hash = 0;
      for (var i = 0; i < d.length; i += 4) {
        var v = d[i];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v; n += 1;
        hash = (hash * 31 + v) >>> 0;
      }
      return {
        mode: document.getElementById('rough_mode').value,
        preset: NMO_RoughnessMap.getPresetId ? NMO_RoughnessMap.getPresetId() : '',
        presetValue: document.getElementById('rough_preset').value,
        valid: NMO_RoughnessMap.hasData(),
        error: NMO_RoughnessMap.lastError,
        width: c.width,
        height: c.height,
        min: min, max: max, mean: Math.round(sum / n),
        hash: hash,
        value: NMO_RoughnessMap.getSettings().value,
        base: NMO_RoughnessMap.getSettings().base,
        mapMean: typeof NMO_RoughnessMap.mapMean === 'number'
          ? Math.round(NMO_RoughnessMap.mapMean * 1000) / 1000
          : null,
        strength: NMO_RoughnessMap.getSettings().strength,
        status: document.getElementById('nmo_status').textContent
      };
    })()`);

  const pick = (id) =>
    ctx.js(`(function(){
      var s = document.getElementById('rough_preset');
      s.value = ${JSON.stringify(id)};
      s.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);

  const setMode = (value) =>
    ctx.js(`(function(){
      var s = document.getElementById('rough_mode');
      s.value = ${JSON.stringify(value)};
      s.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);

  const setBase = (value) =>
    ctx.js(`(function(){
      var el = document.getElementById('rough_value_nmb');
      el.value = ${JSON.stringify(String(value))};
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);

  const setStrength = (value) =>
    ctx.js(`(function(){
      var el = document.getElementById('rough_strength');
      el.value = ${JSON.stringify(String(value))};
      el.dispatchEvent(new Event('change', { bubbles: true }));
      var n = document.getElementById('rough_strength_nmb');
      if (n) n.value = Number(el.value).toFixed(2);
    })()`);

  /* ---------------- 1. 结构 ---------------- */
  await driver.loadHeightFile(ctx, driver.fixture('height-300x200.png'), null, {
    category: 'wood',
    keepContext: true
  });
  await ctx.js("document.getElementById('tab_btn_roughness').click()");
  await ctx.wait(400);

  const layout = await ctx.js(`(function(){
    var sel = document.getElementById('rough_preset');
    var btn = document.getElementById('rough_import');
    var max = document.getElementById('rough_max_nmb');
    var panel = document.getElementById('cell_params').getBoundingClientRect();
    // 1.1.8 起参数区有卡片内边距，按钮的“右端”是单元格的右端，不是面板边框
    var cell = btn.closest('td').getBoundingClientRect();
    function rect(el){ var b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), right: Math.round(b.right), w: Math.round(b.width) }; }
    return {
      count: sel.options.length,
      values: Array.prototype.map.call(sel.options, function (o) { return o.value; }),
      labels: Array.prototype.map.call(sel.options, function (o) { return o.textContent; }),
      modeValues: Array.prototype.map.call(document.getElementById('rough_mode').options, function (o) { return o.value; }),
      modeLabels: Array.prototype.map.call(document.getElementById('rough_mode').options, function (o) { return o.textContent; }),
      importInSourceRow: Boolean(btn.closest('.source_row')),
      importAtRight:
        cell.right - btn.getBoundingClientRect().right <= 6 &&
        btn.getBoundingClientRect().left > panel.left + panel.width * 0.5,
      importGap: Math.round(cell.right - btn.getBoundingClientRect().right),
      presetBelowMax: sel.getBoundingClientRect().top > max.getBoundingClientRect().top,
      presetLeft: Math.round(sel.getBoundingClientRect().left),
      importLeft: Math.round(btn.getBoundingClientRect().left),
      importRect: rect(btn)
    };
  })()`);

  check('M01 预设下拉共 11 项（占位 + 10 张遮罩）', layout.count === 11, String(layout.count));
  check(
    'M02 十张遮罩的 id 与中文名齐全',
    layout.values.slice(1).join(',') ===
      'peeling-wood,mottled-wall,soft-cloud,edge-fade,heavy-stain,crumpled-cloth,coarse-grain,fine-grain,brushed-plaster,vertical-streak' &&
      layout.labels.slice(1).join(',') === '剥落木纹,斑驳墙面,云雾柔斑,上下渐隐,重污渍,揉皱布料,粗颗粒,细颗粒,涂抹灰泥,竖向条纹',
    layout.labels.join(',')
  );
  check('M03 导入贴图按钮在“来源”行内', layout.importInSourceRow === true);
  check(
    'M04 导入贴图按钮贴在面板右端（红框位置）',
    layout.importAtRight === true,
    JSON.stringify({ rect: layout.importRect, gap: layout.importGap })
  );
  check('M05 预设行在上限下面', layout.presetBelowMax === true);
  check(
    'M06 来源下拉有 4 项，且含“贴图 + 源图”',
    layout.modeValues.join(',') === 'uniform,source,imported,mixed' &&
      layout.modeLabels[3] === '贴图 + 源图',
    layout.modeLabels.join(',')
  );

  /* ---------------- 2. 选预设 ---------------- */
  await pick('peeling-wood');
  await ctx.waitFor(
    "NMO_RoughnessMap.getPresetId && NMO_RoughnessMap.getPresetId() === 'peeling-wood' && NMO_RoughnessMap.hasData()",
    20000
  );
  await ctx.wait(400);
  const wood = await read();

  check('M07 选中预设后来源自动变成“导入贴图”', wood.mode === 'imported', wood.mode);
  check('M08 画布尺寸跟随源图 300×200', wood.width === 300 && wood.height === 200, wood.width + '×' + wood.height);
  check('M09 遮罩确实有明暗起伏（不是常数）', wood.max - wood.min >= 60, JSON.stringify({ min: wood.min, max: wood.max }));
  check('M10 状态行写明套用的预设名', /剥落木纹/.test(wood.status), wood.status);

  /* -------- 3.5 导入贴图下“基础值 / 强度”确实生效（1.1.13） -------- */
  const baseAdopted = wood.base;
  check(
    'N01 选预设后基础值被对齐到贴图中值',
    Math.abs(baseAdopted - wood.mapMean) < 0.005 && Math.abs(baseAdopted - 0.62) > 0.05,
    JSON.stringify({ base: baseAdopted, mapMean: wood.mapMean })
  );

  await setBase(0.9);
  await ctx.wait(400);
  const highBase = await read();
  check(
    'N02 基础值调到 0.90 后整张图抬亮（均值上升 ≥40）',
    highBase.mean - wood.mean >= 40 && highBase.hash !== wood.hash,
    JSON.stringify({ before: wood.mean, after: highBase.mean })
  );

  await setBase(baseAdopted);
  await ctx.wait(400);
  const baseRestored = await read();
  check(
    'N03 基础值调回中值后逐像素回到原图',
    baseRestored.hash === wood.hash,
    JSON.stringify({ wood: wood.hash, restored: baseRestored.hash })
  );

  await setStrength(0.6);
  await ctx.wait(400);
  const strongContrast = await read();
  check(
    'N04 强度 0.6 时对比变大（极差增加、均值基本不变）',
    strongContrast.max - strongContrast.min > wood.max - wood.min &&
      Math.abs(strongContrast.mean - wood.mean) <= 20,
    JSON.stringify({
      spreadBefore: wood.max - wood.min,
      spreadAfter: strongContrast.max - strongContrast.min,
      mean: [wood.mean, strongContrast.mean]
    })
  );

  await setStrength(0);
  await ctx.wait(400);
  const zeroAgain = await read();
  check(
    'N05 强度归 0 后逐像素回到原图（0＝原样）',
    zeroAgain.hash === wood.hash,
    JSON.stringify({ wood: wood.hash, zero: zeroAgain.hash })
  );
  check('N06 基础值控件显示的是贴图中值', Math.abs(zeroAgain.value - baseAdopted) < 0.02, String(zeroAgain.value));

  /* ---------------- 3. 换源图 ---------------- */
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), null, {
    category: 'wood',
    keepContext: true
  });
  await ctx.wait(800);
  const afterSource = await read();

  check('M11 换源图后预设仍然有效', afterSource.valid === true, afterSource.error);
  check('M12 换源图后预设没有丢', afterSource.preset === 'peeling-wood', afterSource.preset);
  check(
    'M13 换源图后按新尺寸重采样（256×256）',
    afterSource.width === 256 && afterSource.height === 256,
    afterSource.width + '×' + afterSource.height
  );

  /* ---------------- 4. 换另一个预设 ---------------- */
  await pick('soft-cloud');
  await ctx.waitFor("NMO_RoughnessMap.getPresetId() === 'soft-cloud' && NMO_RoughnessMap.hasData()", 20000);
  await ctx.wait(400);
  const cloud = await read();

  check('M14 换预设后 id 跟着变', cloud.preset === 'soft-cloud', cloud.preset);
  check(
    'M15 两张遮罩画面不同（均值差 ≥ 5）',
    Math.abs(cloud.mean - afterSource.mean) >= 5,
    JSON.stringify({ peeling: afterSource.mean, cloud: cloud.mean })
  );

  /* ---------------- 5. 选回占位项 ---------------- */
  await pick('');
  await ctx.wait(400);
  const cleared = await read();

  check('M16 选回“选择预设…”后回到统一数值', cleared.mode === 'uniform', cleared.mode);
  check('M17 预设 id 已清空', cleared.preset === '', cleared.preset);
  check('M18 状态行说明已取消预设', /取消遮罩预设/.test(cleared.status), cleared.status);

  /* ---------------- 6. 贴图 + 源图 ---------------- */
  await pick('edge-fade');
  await ctx.waitFor("NMO_RoughnessMap.getPresetId() === 'edge-fade' && NMO_RoughnessMap.hasData()", 20000);
  await setStrength(0);
  await ctx.wait(300);
  const pureZero = await read(); // 纯导入贴图，强度 0（强度在这个模式里不起作用）

  await setMode('mixed');
  await ctx.wait(400);
  const mixedZero = await read();

  check(
    'M19 混合模式强度 0 时逐像素等于纯导入贴图',
    mixedZero.hash === pureZero.hash && mixedZero.mode === 'mixed',
    JSON.stringify({ pure: pureZero.hash, mixed: mixedZero.hash, mode: mixedZero.mode })
  );
  check(
    'M20 混合模式仍然有效、尺寸不变',
    mixedZero.valid === true && mixedZero.width === pureZero.width && mixedZero.height === pureZero.height,
    JSON.stringify({ valid: mixedZero.valid, error: mixedZero.error, size: [mixedZero.width, mixedZero.height] })
  );
  check(
    'M21 状态行写明“贴图 + 源图”和预设名',
    /贴图\s*\+\s*源图/.test(mixedZero.status) && /上下渐隐/.test(mixedZero.status),
    mixedZero.status
  );

  await setStrength(0.6);
  await ctx.wait(400);
  const mixedSixty = await read();

  check(
    'M22 强度 0.6 时画面与纯贴图不同（源图信号确实叠加）',
    mixedSixty.hash !== mixedZero.hash,
    JSON.stringify({ zero: mixedZero.hash, sixty: mixedSixty.hash })
  );
  check(
    'M23 混合结果仍是 8 位有效数据（有起伏、不越界）',
    mixedSixty.min >= 0 && mixedSixty.max <= 255 && mixedSixty.max - mixedSixty.min >= 20,
    JSON.stringify({ min: mixedSixty.min, max: mixedSixty.max })
  );

  // 混合模式换源图：贴图与信号都要跟着换，且不能报“上一张源图”
  await driver.loadHeightFile(ctx, driver.fixture('height-300x200.png'), null, {
    category: 'wood',
    keepContext: true
  });
  await ctx.wait(800);
  const mixedAfterSource = await read();

  check('M24 混合模式下换源图仍然有效', mixedAfterSource.valid === true, mixedAfterSource.error);
  check(
    'M25 混合模式换源图后按新尺寸重采样（300×200）',
    mixedAfterSource.width === 300 && mixedAfterSource.height === 200,
    mixedAfterSource.width + '×' + mixedAfterSource.height
  );
  check('M26 混合模式下预设没有丢', mixedAfterSource.preset === 'edge-fade', mixedAfterSource.preset);

  // 混合模式下取消预设：应回落到“源图辅助”，而不是统一数值
  await pick('');
  await ctx.wait(400);
  const mixedCleared = await read();

  check('M27 混合模式取消预设后回落到“源图辅助”', mixedCleared.mode === 'source', mixedCleared.mode);
  check('M28 回落提示写明保留源图辅助', /保留“源图辅助”/.test(mixedCleared.status), mixedCleared.status);
  check('M29 取消后预设 id 已清空', mixedCleared.preset === '', mixedCleared.preset);

  /* ---------------- 7. 手动导入文件 ---------------- */
  await pick('edge-fade');
  await ctx.waitFor("NMO_RoughnessMap.getPresetId() === 'edge-fade'", 20000);
  await ctx.setFileInput(ctx.win, '#rough_file', [driver.fixture('height-300x200.png')]);
  await ctx.waitFor("!NMO_RoughnessMap.getPresetId()", 20000);
  await ctx.wait(400);
  const manual = await read();

  check(
    'M30 手动导入文件后预设下拉清空',
    manual.presetValue === '' && manual.preset === '',
    JSON.stringify({ value: manual.presetValue, id: manual.preset })
  );
  check('M31 手动导入后是导入贴图模式', manual.mode === 'imported', manual.mode);
  check('M32 手动导入的图有效', manual.valid === true, manual.error);

  /* ---------------- 8. 恢复默认 ---------------- */
  await ctx.js("document.getElementById('reset_btn').click()");
  await ctx.wait(400);
  const reset = await read();

  check(
    'M33 恢复默认后回到统一数值 0.50',
    reset.mode === 'uniform' && Math.abs(reset.value - 0.5) < 1e-6,
    JSON.stringify({ mode: reset.mode, value: reset.value })
  );
  check(
    'M34 恢复默认后预设清空',
    reset.preset === '' && reset.presetValue === '',
    JSON.stringify({ id: reset.preset, value: reset.presetValue })
  );
  check('M35 恢复默认后画布是常数 128', reset.min === reset.max && reset.min === 128, JSON.stringify({ min: reset.min, max: reset.max }));

  const errors = ctx.consoleLog.filter((entry) => entry.level === 'error' || entry.level === 3);
  check('M36 无未预期的控制台错误', errors.length === 0, JSON.stringify(errors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'mask-presets',
    durationMs: Date.now() - started,
    steps,
    failures,
    layout,
    wood,
    highBase,
    baseRestored,
    strongContrast,
    zeroAgain,
    afterSource,
    cloud,
    cleared,
    pureZero,
    mixedZero,
    mixedSixty,
    mixedAfterSource,
    mixedCleared,
    manual,
    reset,
    checkedAt: new Date().toISOString()
  };
};
