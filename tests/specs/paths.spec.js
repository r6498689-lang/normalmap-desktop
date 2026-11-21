'use strict';

/*
 * paths.spec.js
 * 中文路径、带空格路径：导入、导出、批量各走一遍。
 * 路径在系统临时目录下创建，用完即删。
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

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-paths-'));
  const cnDir = path.join(root, '中文 目录 with spaces', '高度 图');
  const outDir = path.join(root, '导出 结果 with spaces');
  fs.mkdirSync(cnDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const cnFile = path.join(cnDir, '高度 图 01.png');
  fs.copyFileSync(driver.fixture('height-bumps-256.png'), cnFile);

  try {
    await driver.waitForBoot(ctx);

    // ---------------------------------------------------------- 中文导入
    const size = await driver.loadHeightFile(ctx, cnFile);
    const label = await driver.readText(ctx, 'size');
    check('中文+空格路径导入成功', size.width === 256 && label.startsWith('256 x 256'), label);

    // ---------------------------------------------------------- 中文导出
    await driver.setControl(ctx, 'file_name', '结果 贴图');
    await driver.setControl(ctx, 'file_type', 'png');
    const target = path.join(outDir, '结果 贴图.png');
    ctx.dialogs.saveTo(target);
    await ctx.js("document.getElementById('download').click()");
    const written = await driver.waitForFile(target);
    check('导出到中文+空格目录成功', written, target);
    if (written) {
      const cmp = ctx.compare(await driver.canvasPng(ctx, 'normal'), fs.readFileSync(target));
      check('中文路径下导出内容正确', cmp.identical, `${cmp.differingPixels} px differ`);
    }

    // ------------------------------------------------------ 中文批量导出
    // 改造后批量是：选文件 → 逐张分类 → 导出清单 → 写盘。
    // 输出名由类别和编号决定，中文只体现在源路径与编号库的来源名里。
    const batchJob = path.join(root, '批量 任务');
    fs.mkdirSync(batchJob, { recursive: true });
    const batchOut = path.join(root, '批量 输出');
    fs.mkdirSync(batchOut, { recursive: true });
    for (const dir of ['甲', '乙']) {
      const d = path.join(batchJob, dir);
      fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(
        driver.fixture('batch', dir === '甲' ? 'dirA' : 'dirB', 'pattern.png'),
        path.join(d, '图案.png')
      );
    }

    ctx.dialogs.folderIs(batchOut);
    await ctx.setFileInput(ctx.win, '#select_multiple_height_files', [
      path.join(batchJob, '甲', '图案.png'),
      path.join(batchJob, '乙', '图案.png')
    ]);
    await ctx.waitFor("Boolean(document.getElementById('classify_dialog'))", 20000);
    for (let i = 0; i < 2; i++) {
      await ctx.waitFor("!document.getElementById('classify_cat_wood').disabled", 20000);
      await ctx.js("document.getElementById('classify_cat_wood').click()");
      await ctx.wait(150);
    }
    await ctx.js("document.getElementById('classify_ok').click()");
    await ctx.waitFor("document.getElementById('classify_dialog') === null", 15000);
    await ctx.waitFor("Boolean(document.getElementById('export_plan_dialog'))", 20000);
    await ctx.js("document.getElementById('export_plan_choose_dir').click()");
    await ctx.waitFor("!document.getElementById('export_plan_start').disabled", 15000);
    await ctx.js("document.getElementById('export_plan_start').click()");
    await ctx.waitFor("document.getElementById('export_plan_dialog') === null", 15000);

    const batchDeadline = Date.now() + 40000;
    while (Date.now() < batchDeadline && fs.readdirSync(batchOut).length < 8) {
      await ctx.wait(250);
    }
    await ctx.wait(600);
    const batchFiles = fs.readdirSync(batchOut).sort();
    check('中文路径批量导出产生 8 个文件（2 图 × 4 类）', batchFiles.length === 8, JSON.stringify(batchFiles));
    check(
      '批量输出按 类别_编号_属性 命名',
      batchFiles.filter((n) => /^wood_\d{3}_/.test(n)).length === 8,
      JSON.stringify(batchFiles)
    );
    check(
      '两张源图分成两个编号',
      new Set(batchFiles.map((n) => (n.match(/^wood_(\d{3})_/) || [])[1])).size === 2,
      JSON.stringify(batchFiles)
    );

    const lib = JSON.parse(
      await ctx.js('window.nmoDesktop.getLibrary().then(function(r){return JSON.stringify(r.library)})')
    );
    const sources = lib.suites.map((suite) => suite.sourceName);
    check(
      '中文源文件名在编号库里完整保留',
      sources.filter((name) => name === '图案.png').length === 2,
      JSON.stringify(sources)
    );

    ctx.dialogs.restore();
    await ctx.screenshot('paths-cjk.png');

    const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
    check('无未预期的控制台错误', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

    return {
      ok: failures.length === 0,
      spec: 'paths',
      workingDirectory: process.cwd(),
      testRoot: root,
      batchFiles,
      steps,
      failures,
      checkedAt: new Date().toISOString()
    };
  } finally {
    ctx.dialogs.restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
};
