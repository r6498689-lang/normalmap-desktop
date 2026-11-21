'use strict';

/*
 * batch.spec.js
 * 批量转换：贴图种类勾选、文件数量、同名不同内容素材的对应关系（不串图）、
 * 再次批量时沿用新编号而不是覆盖旧文件。
 *
 * 阶段 A 之后批量流程是：选择文件 → 逐张分类 → 导出清单 → 写盘。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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

  const fileA = driver.fixture('batch', 'dirA', 'pattern.png');
  const fileB = driver.fixture('batch', 'dirB', 'pattern.png');

  await driver.waitForBoot(ctx);
  await ctx.wait(300);

  // 只保留 Normal 与 Specular，验证“选择贴图种类”真的控制输出
  await ctx.js("document.getElementById('displacement_tick').click()");
  await ctx.js("document.getElementById('ambient_tick').click()");
  const ticks = await ctx.js(`(function(){
    return {
      normal: document.getElementById('normal_tick').checked,
      displacement: document.getElementById('displacement_tick').checked,
      ambient: document.getElementById('ambient_tick').checked,
      specular: document.getElementById('specular_tick').checked
    };
  })()`);
  check(
    '贴图种类勾选生效（仅 Normal + Specular）',
    ticks.normal && ticks.specular && !ticks.displacement && !ticks.ambient,
    JSON.stringify(ticks)
  );

  ctx.dialogs.folderIs(outDir);

  async function runBatch() {
    await ctx.setFileInput(ctx.win, '#select_multiple_height_files', [fileA, fileB]);
    await ctx.waitFor("Boolean(document.getElementById('classify_dialog'))", 20000);
    for (let i = 0; i < 2; i++) {
      await ctx.waitFor("!document.getElementById('classify_cat_wood').disabled", 20000);
      await ctx.js("document.getElementById('classify_cat_wood').click()");
      await ctx.wait(120);
    }
    await ctx.js("document.getElementById('classify_ok').click()");
    await ctx.waitFor("document.getElementById('classify_dialog') === null", 15000);
    await ctx.waitFor("Boolean(document.getElementById('export_plan_dialog'))", 15000);
    const planCount = await ctx.js("document.getElementById('export_plan_summary').textContent");
    await ctx.js("document.getElementById('export_plan_choose_dir').click()");
    await ctx.waitFor("!document.getElementById('export_plan_start').disabled", 10000);
    await ctx.js("document.getElementById('export_plan_start').click()");
    await ctx.waitFor("document.getElementById('export_plan_dialog') === null", 15000);
    return planCount;
  }

  const planText = await runBatch();
  check('清单显示 2 张源图 × 2 个属性', /2 张源图 · 4 个文件/.test(planText), planText);

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && fs.readdirSync(outDir).length < 4) {
    await ctx.wait(300);
  }
  await ctx.wait(800);

  const files = fs.readdirSync(outDir).sort();
  check('批量导出 2 张源图 × 2 类贴图 = 4 个文件', files.length === 4, JSON.stringify(files));
  check('未勾选的贴图类型没有输出', !files.some((n) => /Height|AO/.test(n)), JSON.stringify(files));
  check(
    '文件按 种类_序号_属性 命名',
    files.join(',') ===
      'wood_001_Normal.png,wood_001_Specular.png,wood_002_Normal.png,wood_002_Specular.png',
    JSON.stringify(files)
  );

  /*
   * 这条必须在“参考结果”之前读：后面用 loadHeightFile 单独载两张图会走分类，
   * 1.1.5 起分类会弹“已套用分类预设”的状态，把批量汇总顶掉。
   */
  const status = await ctx.js(
    "document.getElementById('nmo_status') ? document.getElementById('nmo_status').textContent : ''"
  );
  check('批量结束显示写入数量与目录', /已写入 4 个文件/.test(status), JSON.stringify(status));
  await ctx.screenshot('batch-done.png');

  // 参考结果：分别单独载入两张源图，记录各自的 Normal / Specular
  await driver.loadHeightFile(ctx, fileA);
  const refA = { normal: await driver.canvasPng(ctx, 'normal'), specular: await driver.canvasPng(ctx, 'specular') };
  await driver.loadHeightFile(ctx, fileB);
  const refB = { normal: await driver.canvasPng(ctx, 'normal'), specular: await driver.canvasPng(ctx, 'specular') };

  const refDiffers = ctx.compare(refA.normal, refB.normal);
  check('两张同名源图本身结果不同（否则本测试无意义）', !refDiffers.identical, JSON.stringify(refDiffers).slice(0, 120));

  const matches = [];
  for (const name of files) {
    const full = path.join(outDir, name);
    const hit = [];
    for (const [srcKey, refMap] of [['A', refA], ['B', refB]]) {
      for (const map of ['normal', 'specular']) {
        const cmp = ctx.compare(refMap[map], fs.readFileSync(full));
        if (cmp.identical) hit.push(srcKey + ':' + map);
      }
    }
    matches.push({ file: name, matches: hit });
    check(`${name} 恰好对应一张源图的一种贴图`, hit.length === 1, JSON.stringify(hit));
  }

  const byFile = Object.fromEntries(matches.map((m) => [m.file, m.matches[0]]));
  check('目录 A 的源图先处理，其 Normal 落在 wood_001_Normal.png', byFile['wood_001_Normal.png'] === 'A:normal', JSON.stringify(byFile));
  check('目录 B 的同名源图内容仍属于 B', byFile['wood_002_Normal.png'] === 'B:normal', JSON.stringify(byFile));
  check(
    '两张源图的 Normal 没有被互相覆盖',
    byFile['wood_001_Normal.png'] === 'A:normal' && byFile['wood_002_Normal.png'] === 'B:normal',
    JSON.stringify(byFile)
  );

  // -------------------------------------------------- 再次批量：新编号，不覆盖旧文件
  const before = Object.fromEntries(
    fs.readdirSync(outDir).map((n) => [
      n,
      crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, n))).digest('hex')
    ])
  );
  await runBatch();
  const deadline2 = Date.now() + 60000;
  while (Date.now() < deadline2 && fs.readdirSync(outDir).length < 8) {
    await ctx.wait(300);
  }
  await ctx.wait(600);

  const after = fs.readdirSync(outDir).sort();
  check('第二次批量后共 8 个文件', after.length === 8, String(after.length));
  check(
    '第二次批量领新号 003/004',
    after.some((n) => n.startsWith('wood_003_')) && after.some((n) => n.startsWith('wood_004_')),
    JSON.stringify(after)
  );
  const untouched = Object.entries(before).every(([n, h]) => {
    const now = crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, n))).digest('hex');
    return now === h;
  });
  check('第二次批量没有覆盖第一次的文件', untouched);
  check('没有出现 (1) 之类的改名后缀', after.every((n) => n.indexOf('(1)') === -1), JSON.stringify(after));

  ctx.dialogs.restore();

  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无未预期的控制台错误', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'batch',
    outDir,
    files: fs.readdirSync(outDir).sort().map((n) => ({ name: n, bytes: fs.statSync(path.join(outDir, n)).size })),
    mapping: byFile,
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
