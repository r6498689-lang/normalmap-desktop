'use strict';

/*
 * export-all.spec.js
 * “All” 导出：一次选择文件夹、四类文件齐全、内容与各自贴图对应、重名不覆盖。
 *
 * 命名规则：<类别>_<编号>_<属性>。同一个源图再导一次会撞同名，
 * 现在的策略是“保留原文件、不自动加 (1)”，所以第二次应当写 0 个、跳过 4 个。
 */

const fs = require('node:fs');
const path = require('node:path');
const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  const outDir = path.join(ctx.evidenceDir, 'out');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'), ctx.win, {
    keepContext: true
  });
  await ctx.wait(400);

  const canvases = {
    normal: await driver.canvasPng(ctx, 'normal'),
    displacement: await driver.canvasPng(ctx, 'displacement'),
    ambient: await driver.canvasPng(ctx, 'ambient'),
    specular: await driver.canvasPng(ctx, 'specular')
  };

  await driver.setControl(ctx, 'file_type', 'png');
  await driver.setControl(ctx, 'transparency_nmb', '100');

  // ------------------------------------------------------------- 第一次导出
  ctx.dialogs.folderIs(outDir);
  await ctx.js("document.getElementById('download_all').click()");

  const expected = ['wood_001_Normal.png', 'wood_001_Height.png', 'wood_001_AO.png', 'wood_001_Specular.png'];
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !expected.every((n) => fs.existsSync(path.join(outDir, n)))) {
    await ctx.wait(250);
  }
  await ctx.wait(500);

  const firstRun = fs.readdirSync(outDir).sort();
  check('All 导出产生 4 个文件', firstRun.length === 4, JSON.stringify(firstRun));
  check('文件名为 类别_编号_属性', expected.every((n) => firstRun.includes(n)), JSON.stringify(firstRun));

  const byMap = {
    normal: 'wood_001_Normal.png',
    displacement: 'wood_001_Height.png',
    ambient: 'wood_001_AO.png',
    specular: 'wood_001_Specular.png'
  };
  for (const [map, fileName] of Object.entries(byMap)) {
    const full = path.join(outDir, fileName);
    if (!fs.existsSync(full)) continue;
    const cmp = ctx.compare(canvases[map], fs.readFileSync(full));
    check(`${fileName} 内容对应 ${map}`, cmp.identical, `${cmp.differingPixels} px differ`);
  }

  const firstHashes = Object.fromEntries(
    fs.readdirSync(outDir).map((n) => [n, require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(outDir, n))).digest('hex')])
  );

  const statusAfterFirst = await ctx.js(
    "document.getElementById('nmo_status') ? document.getElementById('nmo_status').textContent : ''"
  );
  check('导出完成后显示结果数量', /已写入 4 个文件/.test(statusAfterFirst), JSON.stringify(statusAfterFirst));
  await ctx.screenshot('export-all-first-run.png');

  // ---------------------------------------------- 第二次导出：不得静默覆盖
  await ctx.js("document.getElementById('download_all').click()");
  await ctx.wait(2500);

  const secondRun = fs.readdirSync(outDir).sort();
  check('第二次导出不新增文件（共 4 个）', secondRun.length === 4, JSON.stringify(secondRun));

  const originalsIntact = expected.every((n) => {
    const now = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(outDir, n))).digest('hex');
    return now === firstHashes[n];
  });
  check('原有文件未被覆盖（哈希不变）', originalsIntact);

  const statusAfterSecond = await ctx.js(
    "document.getElementById('nmo_status') ? document.getElementById('nmo_status').textContent : ''"
  );
  check(
    '第二次导出如实报告“同名保留、写入 0 个”',
    /已写入 0 个文件/.test(statusAfterSecond) && /同名文件已存在/.test(statusAfterSecond),
    JSON.stringify(statusAfterSecond)
  );

  // -------------------------------------------------------------- 取消导出
  ctx.dialogs.cancelFolder();
  const beforeCancel = fs.readdirSync(outDir).length;
  await ctx.js("document.getElementById('download_all').click()");
  await ctx.wait(2000);
  check('取消文件夹选择不写任何文件', fs.readdirSync(outDir).length === beforeCancel, 'count changed');
  const cancelStatus = await ctx.js(
    "document.getElementById('nmo_status') ? document.getElementById('nmo_status').textContent : ''"
  );
  check('取消后提示为正常取消', /已取消/.test(cancelStatus), JSON.stringify(cancelStatus));

  ctx.dialogs.restore();

  return {
    ok: failures.length === 0,
    spec: 'export-all',
    outDir,
    files: fs.readdirSync(outDir).sort().map((n) => ({ name: n, bytes: fs.statSync(path.join(outDir, n)).size })),
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
