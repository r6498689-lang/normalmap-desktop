'use strict';

/*
 * orm.spec.js — 阶段 D 验收（O01–O03）
 *
 * 重点不是“看起来像 ORM”，而是：
 *   - ORM 文件是真 RGB PNG（IHDR color type = 2，没有 Alpha 通道）
 *   - 解码后 R/G/B 与 AO / 粗糙度 / 金属度逐像素一致
 *   - 开关规则：只有三项全勾才可点，不自动开启，取消一项立即关闭
 *   - 开启后只输出一张 ORM，替代三张单图
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-orm-'));
  ctx.dialogs.folderIs(outDir);

  const tick = (id) => ctx.js(`document.getElementById('${id}').click()`);
  const isChecked = (id) => ctx.js(`document.getElementById('${id}').checked`);
  const ormDisabled = () => ctx.js("Boolean(document.getElementById('orm_toggle').disabled)");
  const ormPressed = () => ctx.js("document.getElementById('orm_toggle').getAttribute('aria-pressed')");
  const ormEnabled = () => ctx.js('NMO_ORM.isEnabled()');

  await driver.waitForBoot(ctx);
  // 走一次分类，拿到受控命名上下文（ORM 的命名与编号也在这次验收里）。
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), null, {
    keepContext: true,
    category: 'wood'
  });
  await ctx.js("document.getElementById('rough_mode').value='uniform'; document.getElementById('rough_mode').dispatchEvent(new Event('change'))");
  await driver.setControl(ctx, 'rough_value_nmb', '0.25');
  await ctx.js("document.getElementById('metal_mode').value='full'; document.getElementById('metal_mode').dispatchEvent(new Event('change'))");
  await ctx.wait(500);

  /* ---------------- O01 8 种勾选组合 ---------------- */
  const combos = [];
  for (let mask = 0; mask < 8; mask += 1) {
    const want = { ao: Boolean(mask & 1), rough: Boolean(mask & 2), metal: Boolean(mask & 4) };
    for (const [id, on] of [
      ['ambient_tick', want.ao],
      ['roughness_tick', want.rough],
      ['metallic_tick', want.metal]
    ]) {
      if ((await isChecked(id)) !== on) await tick(id);
    }
    await ctx.wait(120);
    const disabled = await ormDisabled();
    combos.push({ mask, want, disabled });
    const all = want.ao && want.rough && want.metal;
    check(
      `O01 组合 ${mask}（AO=${+want.ao} 粗糙=${+want.rough} 金属=${+want.metal}）按钮${all ? '可用' : '禁用'}`,
      disabled === !all,
      'disabled=' + disabled
    );
  }

  // 补齐三项：可用但不能自动开启
  for (const [id, on] of [
    ['ambient_tick', true],
    ['roughness_tick', true],
    ['metallic_tick', true]
  ]) {
    if ((await isChecked(id)) !== on) await tick(id);
  }
  await ctx.wait(150);
  check('O01 三项全勾后按钮可点', (await ormDisabled()) === false);
  check('O01 三项全勾不自动开启', (await ormEnabled()) === false && (await ormPressed()) === 'false');

  await ctx.js("document.getElementById('orm_toggle').click()");
  await ctx.wait(250);
  check('O01 点击进入启用状态', (await ormEnabled()) === true && (await ormPressed()) === 'true');

  // 取消任一前置项 → 立即关闭并灰置
  await tick('metallic_tick');
  await ctx.wait(200);
  check('O01 取消一项后自动关闭', (await ormEnabled()) === false && (await ormPressed()) === 'false');
  check('O01 取消一项后按钮禁用', (await ormDisabled()) === true);

  await tick('metallic_tick');
  await ctx.wait(200);
  check('O01 补齐后只恢复可点，不自动开启', (await ormDisabled()) === false && (await ormEnabled()) === false);
  await ctx.js("document.getElementById('orm_toggle').click()");
  await ctx.wait(200);
  check('O01 需要再次主动开启', (await ormEnabled()) === true);

  /* ---------------- O02 数量与逐通道数据 ---------------- */
  // 只保留 AO / 粗糙度 / 金属度，其余勾掉，便于核对数量
  for (const id of ['normal_tick', 'displacement_tick', 'specular_tick']) {
    if (await isChecked(id)) await tick(id);
  }
  const before = new Set(fs.readdirSync(outDir));

  await ctx.js("document.getElementById('download_all').click()");
  // 状态提示 7 秒后自动消失，先在它还在的时候取一次。
  await ctx.wait(1500);
  const earlyStatus = await ctx.js(
    "document.getElementById('nmo_status') ? document.getElementById('nmo_status').textContent : ''"
  );
  ctx.saveText('orm-export-status-early.txt', earlyStatus);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && fs.readdirSync(outDir).length === before.size) {
    await ctx.wait(200);
  }
  await ctx.wait(600);

  const exportStatus = earlyStatus || (await ctx.js(
    "document.getElementById('nmo_status') ? document.getElementById('nmo_status').textContent : ''"
  ));
  ctx.saveText('orm-export-status.txt', exportStatus);
  const files = fs.readdirSync(outDir).sort();
  check('O02 导出给出反馈', /已写入 1 个文件/.test(exportStatus), exportStatus);
  check('O02 开启 ORM 只写 1 个文件', files.length === 1, JSON.stringify(files));
  check('O02 文件名是 wood_001_ORM.png', files[0] === 'wood_001_ORM.png', JSON.stringify(files));

  const ormFile = path.join(outDir, files[0]);
  const bytes = fs.readFileSync(ormFile);
  const colorType = bytes[25];
  check('O02 IRDR color type = 2（真 RGB，无 Alpha）', colorType === 2, 'colorType=' + colorType);
  check('O02 位深 8', bytes[24] === 8, 'bitDepth=' + bytes[24]);

  // 逐点核对：文件像素 == AO / 粗糙度 / 金属度画布
  const decoded = ctx.decodeToBitmap(bytes);
  check('O02 导出尺寸与源图一致', decoded.width === 256 && decoded.height === 256, decoded.width + 'x' + decoded.height);

  const points = [
    [10, 10],
    [128, 64],
    [64, 200],
    [240, 240]
  ];
  for (const [x, y] of points) {
    const expected = JSON.parse(
      await ctx.js(`(function(){
        function px(c){
          // AO 是 WebGL 画布，先画到 2D 临时画布再取像素。
          var t = document.createElement('canvas');
          t.width = c.width; t.height = c.height;
          var g = t.getContext('2d');
          g.drawImage(c, 0, 0);
          return g.getImageData(${x}, ${y}, 1, 1).data[0];
        }
        return JSON.stringify({
          ao: px(NMO_AmbientOccMap.ao_canvas),
          rough: px(NMO_RoughnessMap.roughness_canvas),
          metal: px(NMO_MetallicMap.metallic_canvas)
        });
      })()`)
    );
    const offset = (y * decoded.width + x) * 4;
    const bgra = {
      b: decoded.bitmap[offset],
      g: decoded.bitmap[offset + 1],
      r: decoded.bitmap[offset + 2],
      a: decoded.bitmap[offset + 3]
    };
    check(
      `O02 (${x},${y}) R=AO`,
      bgra.r === expected.ao,
      `file=${bgra.r} canvas=${expected.ao}`
    );
    check(
      `O02 (${x},${y}) G=粗糙度`,
      bgra.g === expected.rough,
      `file=${bgra.g} canvas=${expected.rough}`
    );
    check(
      `O02 (${x},${y}) B=金属度`,
      bgra.b === expected.metal,
      `file=${bgra.b} canvas=${expected.metal}`
    );
  }

  /* ---------------- O02 关闭 ORM：三张单图 ---------------- */
  const outDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-orm-off-'));
  ctx.dialogs.folderIs(outDir2);
  await ctx.js("document.getElementById('orm_toggle').click()");
  await ctx.wait(200);
  check('O02 可再次关闭 ORM', (await ormEnabled()) === false);

  await ctx.js("document.getElementById('download_all').click()");
  const deadline2 = Date.now() + 30000;
  while (Date.now() < deadline2 && fs.readdirSync(outDir2).length < 3) {
    await ctx.wait(200);
  }
  await ctx.wait(500);
  const offFiles = fs.readdirSync(outDir2).sort();
  check('O02 关闭后输出 3 张单图', offFiles.length === 3, JSON.stringify(offFiles));
  check(
    'O02 单图属性正确（AO/Roughness/Metallic）',
    offFiles.join(',') === 'wood_001_AO.png,wood_001_Metallic.png,wood_001_Roughness.png',
    JSON.stringify(offFiles)
  );

  /* ---------------- O03 合法常量可以打包；坏数据不能伪成功 ---------------- */
  await driver.setControl(ctx, 'rough_value_nmb', '0');
  await ctx.js("document.getElementById('metal_mode').value='none'; document.getElementById('metal_mode').dispatchEvent(new Event('change'))");
  await ctx.wait(400);
  const readyZero = await ctx.js('NMO_ORM.isReady()');
  check('O03 全零常量仍视为有效输入', readyZero === true);
  const zeroBytes = await ctx.js(
    "NMO_ORM.encodeRgb().then(function(u){ return JSON.stringify(Array.prototype.slice.call(u, 0, 8)); })"
  );
  check('O03 全零常量能编码出 PNG', /^\[137,80,78,71/.test(zeroBytes), zeroBytes);

  const badReason = await ctx.js(`(function(){
    var original = NMO_MetallicMap.hasData;
    NMO_MetallicMap.hasData = function(){ return false; };
    var ready = NMO_ORM.isReady();
    var reason = NMO_ORM.reason();
    NMO_MetallicMap.hasData = original;
    return JSON.stringify({ready: ready, reason: reason});
  })()`);
  const bad = JSON.parse(badReason);
  check('O03 缺数据时 ORM 不就绪', bad.ready === false, badReason);
  check('O03 缺数据时给出原因', /金属度/.test(bad.reason || ''), bad.reason);

  ctx.dialogs.restore();
  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无渲染进程报错', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'orm',
    method: '按钮状态矩阵 + 导出文件 IHDR 检查 + nativeImage 解码逐像素比对',
    ormFile: ormFile,
    ormBytes: bytes.length,
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
