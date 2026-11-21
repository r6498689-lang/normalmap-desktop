'use strict';

/*
 * naming.spec.js — 阶段 B 验收（N01–N03）
 *
 * 走真实界面：分类弹窗 → 确定 → 下载/全部 → 主进程预留编号 → 写盘。
 * 断言的是磁盘上真实文件名与像素，不是界面文案。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const driver = require('../lib/driver');
const { LibraryStore } = require('../../desktop/library-store');
const { createPlanner } = require('../../desktop/export-plan');

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  const fx = (...p) => driver.fixture(...p);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-naming-out-'));
  ctx.saveText('naming-output-dir.txt', outDir + '\n');

  async function waitDialog() {
    await ctx.waitFor("document.getElementById('classify_dialog') !== null", 15000);
  }
  async function waitReady() {
    await ctx.waitFor("!document.getElementById('classify_cat_wood').disabled", 20000);
  }
  async function importOne(file, category) {
    await ctx.setFileInput(ctx.win, '#select_file_height', [file]);
    await waitDialog();
    await waitReady();
    await ctx.js(`document.getElementById('classify_cat_${category}').click()`);
    await ctx.wait(150);
    await ctx.js("document.getElementById('classify_ok').click()");
    await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);
    await ctx.wait(700);
  }
  async function importMany(files, category) {
    await ctx.setFileInput(ctx.win, '#select_multiple_height_files', files);
    await waitDialog();
    for (let i = 0; i < files.length; i++) {
      await waitReady();
      await ctx.js(`document.getElementById('classify_cat_${category}').click()`);
      await ctx.wait(120);
    }
    await ctx.js("document.getElementById('classify_ok').click()");
    await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);
    // 分类之后是导出清单：选目录 → 开始导出。
    await ctx.waitFor("document.getElementById('export_plan_dialog') !== null", 15000);
    await ctx.js("document.getElementById('export_plan_choose_dir').click()");
    await ctx.waitFor("!document.getElementById('export_plan_start').disabled", 10000);
    await ctx.js("document.getElementById('export_plan_start').click()");
    await ctx.waitFor("document.getElementById('export_plan_dialog') === null", 10000);
  }
  function filesIn(dir) {
    return fs
      .readdirSync(dir)
      .filter((n) => !n.startsWith('.'))
      .sort();
  }
  async function waitFile(dir, name, timeout) {
    const deadline = Date.now() + (timeout || 20000);
    while (Date.now() < deadline) {
      if (fs.existsSync(path.join(dir, name))) return true;
      await ctx.wait(120);
    }
    return false;
  }
  async function libSnapshot() {
    return JSON.parse(
      await ctx.js('window.nmoDesktop.getLibrary().then(function(r){return JSON.stringify(r.library)})')
    );
  }

  await driver.waitForBoot(ctx);
  ctx.dialogs.folderIs(outDir);

  /* ---------------- N01 单图：wood_001，各属性共号 ---------------- */
  await importOne(fx('height-bumps-256.png'), 'wood');
  const ctxState = JSON.parse(await ctx.js('JSON.stringify(NMO_Main.sourceContext)'));
  check('N01 分类后主界面记住了类别', ctxState.category === 'wood', JSON.stringify(ctxState));

  const previewName = await ctx.js("document.getElementById('file_name').value");
  check('N01 文件名框是受控预览', /^wood_\d{3,}_Normal$/.test(previewName), previewName);
  check(
    'N01 预览框是只读的',
    (await ctx.js("document.getElementById('file_name').readOnly")) === true
  );

  await ctx.js("document.getElementById('download').click()");
  check('N01 写出 wood_001_Normal.png', await waitFile(outDir, 'wood_001_Normal.png'));

  const canvasPng = await driver.canvasPng(ctx, 'normal');
  const comparison = ctx.compare(canvasPng, fs.readFileSync(path.join(outDir, 'wood_001_Normal.png')));
  check('N01 文件内容与画布逐像素一致', comparison.identical === true, JSON.stringify(comparison.sizeA));

  // 同一源图补导出：沿用 001，不领新号。
  await ctx.js("document.getElementById('download_all').click()");
  check('N01 补导出沿用 001（Height）', await waitFile(outDir, 'wood_001_Height.png'));
  const afterSecond = await libSnapshot();
  const wood = afterSecond.categories.filter((c) => c.value === 'wood')[0];
  check('N01 同源补导出不增加编号', wood.maxAssigned === 1, String(wood.maxAssigned));

  /* ---------------- N01 第二张 wood → 002 ---------------- */
  await importOne(fx('height-alpha-192.png'), 'wood');
  await ctx.js("document.getElementById('download').click()");
  check('N01 第二张 wood 得到 002', await waitFile(outDir, 'wood_002_Normal.png'));

  /* ---------------- N01 批量三张 → 003–005 ---------------- */
  // 只留 Normal，避免一次写 12 个文件。
  for (const id of ['displacement_tick', 'ambient_tick', 'specular_tick']) {
    await ctx.js(`document.getElementById('${id}').checked = false`);
  }
  await importMany(
    [fx('height-bumps-256.png'), fx('height-alpha-192.png'), fx('height-300x200.png')],
    'wood'
  );
  check('N01 批量第 3 张 → wood_003', await waitFile(outDir, 'wood_003_Normal.png', 30000));
  check('N01 批量第 4 张 → wood_004', await waitFile(outDir, 'wood_004_Normal.png'));
  check('N01 批量第 5 张 → wood_005', await waitFile(outDir, 'wood_005_Normal.png'));
  const batchFiles = filesIn(outDir).filter((n) => /^wood_00[345]_/.test(n));
  check('N01 批量 3 张只产出 3 个文件', batchFiles.length === 3, batchFiles.join(','));

  const libAfterBatch = await libSnapshot();
  const woodAfter = libAfterBatch.categories.filter((c) => c.value === 'wood')[0];
  check('N01 计数到 5', woodAfter.maxAssigned === 5, String(woodAfter.maxAssigned));
  check(
    'N01 五张源图对应 001–005',
    libAfterBatch.suites
      .filter((s) => s.category === 'wood')
      .map((s) => s.number)
      .sort((a, b) => a - b)
      .join(',') === '1,2,3,4,5'
  );

  /* ---------------- N01 独立种类从 001 开始 ---------------- */
  await importOne(fx('height-255x257.png'), 'concrete');
  await ctx.js("document.getElementById('download').click()");
  check('N01 concrete 独立从 001 开始', await waitFile(outDir, 'concrete_001_Normal.png'));

  /* ---------------- N02 目标目录已占用号要避让 ---------------- */
  fs.writeFileSync(path.join(outDir, 'wood_009_Normal.png'), 'occupied');
  await importOne(fx('height-bumps-256.png'), 'wood');
  await ctx.js("document.getElementById('download').click()");
  check('N02 目录占用 009 时跳到 010', await waitFile(outDir, 'wood_010_Normal.png'));
  check(
    'N02 没有覆盖目录里的 009',
    fs.readFileSync(path.join(outDir, 'wood_009_Normal.png'), 'utf8') === 'occupied'
  );

  /* ---------------- N02 同名不静默覆盖（keep） ---------------- */
  const before = fs.statSync(path.join(outDir, 'wood_010_Normal.png')).size;
  await ctx.js("document.getElementById('download').click()");
  await ctx.wait(1200);
  const after = fs.statSync(path.join(outDir, 'wood_010_Normal.png')).size;
  check('N02 重复导出保留原文件', before === after, before + ' -> ' + after);
  check(
    'N02 不产生 (1) 后缀',
    filesIn(outDir).every((n) => n.indexOf('(1)') === -1),
    filesIn(outDir).join(',')
  );

  /* ---------------- N02 补图：沿用旧号，只加属性 ---------------- */
  const libForSupplement = await libSnapshot();
  const target = libForSupplement.suites.filter((s) => s.category === 'wood' && s.number === 3)[0];
  check('N02 编号库有可补图的套组身份', Boolean(target && target.sourceKey), JSON.stringify(target));

  const supplementDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-supplement-'));
  ctx.dialogs.folderIs(supplementDir);
  const supplementResult = JSON.parse(
    await ctx.js(`(function(){
      return NMO_Main.exportPlanned({
        label: '补图测试',
        suggestedName: 'x',
        items: [{ sourceKey: 'manual-supplement', sourceName: 'wall.png', category: 'wood', mode: 'supplement', number: 3 }],
        tasks: [{ sourceKey: 'manual-supplement', category: 'wood', property: 'Specular', name: 'Specular',
                  produce: function(){ return NMO_Main.buildImageRecord('SpecularMap', 'x'); } }]
      }).then(function(r){ return JSON.stringify(r); });
    })()`)
  );
  check('N02 补图成功', supplementResult.ok === true, JSON.stringify(supplementResult));
  check(
    'N02 补图沿用 wood_003',
    fs.existsSync(path.join(supplementDir, 'wood_003_Specular.png')),
    filesIn(supplementDir).join(',')
  );
  const libAfterSupplement = await libSnapshot();
  const woodFinal = libAfterSupplement.categories.filter((c) => c.value === 'wood')[0];
  check('N02 补图不消费新号', woodFinal.maxAssigned === 10, String(woodFinal.maxAssigned));

  /* ---------------- N02 自然扩位与重启续号（库层） ---------------- */
  const namingMod = require('../../renderer/shared/naming.js');
  check('N02 三位补零 1→001', namingMod.formatNumber(1) === '001');
  check('N02 两位补零 9→009', namingMod.formatNumber(9) === '009');
  check('N02 三位不截断 1000→1000', namingMod.formatNumber(1000) === '1000');

  function seedLibrary(dir, maxAssigned) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'nmo-library.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          categories: {
            wood: {
              label: '木材',
              custom: false,
              maxAssigned: maxAssigned,
              createdAt: new Date().toISOString()
            }
          },
          suites: [],
          reservations: []
        },
        null,
        2
      ),
      'utf8'
    );
  }

  const expDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-expand-'));
  seedLibrary(expDir, 999);
  const store999 = new LibraryStore({ dir: expDir });
  const at999 = await store999.reserve([{ category: 'wood', sourceName: 'a.png' }]);
  check('N02 999 的下一号是 1000', at999[0].number === 1000, String(at999[0].number));
  const reopened = new LibraryStore({ dir: expDir });
  const afterRestart = await reopened.reserve([{ category: 'wood', sourceName: 'b.png' }]);
  check('N02 重新打开库仍续号 1001', afterRestart[0].number === 1001, String(afterRestart[0].number));
  check(
    'N02 文件名不截断',
    namingMod.buildFileName('wood', afterRestart[0].number, 'Normal', '.png') === 'wood_1001_Normal.png'
  );

  const expDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-expand2-'));
  seedLibrary(expDir2, 9999);
  const store9999 = new LibraryStore({ dir: expDir2 });
  const at9999 = await store9999.reserve([{ category: 'wood', sourceName: 'c.png' }]);
  check('N02 9999 的下一号是 10000', at9999[0].number === 10000, String(at9999[0].number));

  // 重启续号（同一份库，新实例）：先写 5 个 wood，再开新实例应得 006。
  const expDir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-restart-'));
  const firstRun = new LibraryStore({ dir: expDir3 });
  const five = await firstRun.reserve(
    [1, 2, 3, 4, 5].map((i) => ({ category: 'wood', sourceName: 'w' + i + '.png' }))
  );
  check('N01 五张 wood 得到 001–005', five.map((r) => r.number).join(',') === '1,2,3,4,5');
  const secondRun = new LibraryStore({ dir: expDir3 });
  const sixth = await secondRun.reserve([{ category: 'wood', sourceName: 'w6.png' }]);
  check('N01 重启后新 wood 是 006', sixth[0].number === 6, String(sixth[0].number));

  /* -------- 1.1.29 审查修复：零计数类别必须能重启、能备份导入 -------- */
  const zeroDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-zero-cat-'));
  const zeroStore = new LibraryStore({ dir: zeroDir });
  await zeroStore.addCategory('customwood', '自定义木纹');
  const zeroReload = new LibraryStore({ dir: zeroDir });
  let zeroSnapshot = null;
  let zeroLoadError = null;
  try {
    zeroSnapshot = zeroReload.getSnapshot();
  } catch (err) {
    zeroLoadError = err;
  }
  const zeroRow = zeroSnapshot && zeroSnapshot.categories.find((c) => c.value === 'customwood');
  check(
    '1.1.29 未使用的自定义类别重启后不判损坏',
    !zeroLoadError &&
      zeroSnapshot &&
      zeroSnapshot.broken === null &&
      zeroRow &&
      zeroRow.maxAssigned === 0 &&
      zeroRow.nextNumber === 1,
    zeroLoadError ? zeroLoadError.message : JSON.stringify(zeroRow)
  );

  const zeroImportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-zero-import-'));
  const zeroImportStore = new LibraryStore({ dir: zeroImportDir });
  const zeroPreview = zeroImportStore.previewImport(zeroReload.buildBackup());
  check(
    '1.1.29 含零计数类别的备份可预览',
    zeroPreview.addedCategories.some((c) => c.value === 'customwood' && c.maxAssigned === 0),
    JSON.stringify(zeroPreview.addedCategories)
  );
  const zeroApplied = await zeroImportStore.applyImport(zeroPreview);
  check('1.1.29 含零计数类别的备份可应用', Boolean(zeroApplied && zeroApplied.ok), JSON.stringify(zeroApplied).slice(0, 160));

  /* -------- 1.1.29 审查修复：退号不能倒退其他类别的历史高水位 -------- */
  const highDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-high-water-'));
  seedLibrary(highDir, 100);
  const highStore = new LibraryStore({ dir: highDir });
  const concrete = await highStore.reserve([{ category: 'concrete', sourceName: 'c.png' }]);
  check('1.1.29 新类别从 001 开始', concrete[0].number === 1, String(concrete[0].number));
  const releasedConcrete = await highStore.releaseUnstarted([
    { category: 'concrete', number: concrete[0].number }
  ]);
  check('1.1.29 未开始的预留仍然退回', releasedConcrete.released === 1, JSON.stringify(releasedConcrete));
  const woodAfterRelease = await highStore.reserve([{ category: 'wood', sourceName: 'w.png' }]);
  check(
    '1.1.29 退号不倒退其他类别的高水位',
    woodAfterRelease[0].number === 101,
    String(woodAfterRelease[0].number)
  );

  const sameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-same-cat-'));
  seedLibrary(sameDir, 5);
  const sameStore = new LibraryStore({ dir: sameDir });
  const sameFirst = await sameStore.reserve([{ category: 'wood', sourceName: 's1.png' }]);
  await sameStore.releaseUnstarted([{ category: 'wood', number: sameFirst[0].number }]);
  const sameSecond = await sameStore.reserve([{ category: 'wood', sourceName: 's2.png' }]);
  check(
    '1.1.29 同类别退号回到创建前的水位',
    sameFirst[0].number === 6 && sameSecond[0].number === 6,
    sameFirst[0].number + ' -> ' + sameSecond[0].number
  );

  /* -------- 1.1.29 审查修复：崩溃预留的号永不复用，只标记 -------- */
  const crashDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-crash-lib-'));
  const crashRun = new LibraryStore({ dir: crashDir });
  await crashRun.reserve([1, 2, 3].map((i) => ({ category: 'wood', sourceName: 'k' + i + '.png' })));
  await crashRun.recordProperty('wood', 1, 'Normal');
  await crashRun.recordProperty('wood', 2, 'Normal');

  const markedStore = new LibraryStore({ dir: crashDir });
  const marked = await markedStore.markCrashedReservations();
  check(
    '1.1.29 崩溃预留被标记而不是删除',
    marked.ok && marked.marked === 1 && marked.numbers.join(',') === 'wood_003',
    JSON.stringify(marked)
  );
  const afterMark = markedStore.getSnapshot();
  const woodMarked = afterMark.categories.find((c) => c.value === 'wood');
  check(
    '1.1.29 崩溃后套组与最大号都保留',
    afterMark.suites.length === 3 &&
      woodMarked.maxAssigned === 3 &&
      afterMark.reservations.find((r) => Number(r.number) === 3).status === 'crashed',
    JSON.stringify({
      suites: afterMark.suites.map((s) => s.number),
      max: woodMarked.maxAssigned,
      statuses: afterMark.reservations.map((r) => r.status)
    })
  );
  const markAgain = await markedStore.markCrashedReservations();
  check('1.1.29 重复标记是幂等的', markAgain.ok && markAgain.marked === 0, JSON.stringify(markAgain));
  const afterCrashNumber = await markedStore.reserve([{ category: 'wood', sourceName: 'k4.png' }]);
  check(
    '1.1.29 崩溃预留号不复用（允许空号）',
    afterCrashNumber[0].number === 4,
    String(afterCrashNumber[0].number)
  );

  /* -------- 1.1.29 审查修复：编号库回写失败要等、要报 -------- */
  const planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-plan-lib-'));
  const planOut = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-plan-out-'));
  const planStore = new LibraryStore({ dir: planDir });
  const failingStore = {
    scanDirectory: (dir) => planStore.scanDirectory(dir),
    reserve: (items) => planStore.reserve(items),
    findSuite: (category, number) => planStore.findSuite(category, number),
    releaseUnstarted: (entries) => planStore.releaseUnstarted(entries),
    recordProperty: () => Promise.reject(new Error('模拟编号库写失败'))
  };
  const planner = createPlanner({
    store: failingStore,
    dialogs: {
      async chooseFolder() {
        return { ok: true, dir: planOut };
      },
      lastDir() {
        return planOut;
      }
    }
  });
  const prepared = await planner.prepare({
    label: '审查回归',
    dir: planOut,
    items: [{ sourceKey: 'k', sourceName: 'k.png', category: 'wood', mode: 'new' }]
  });
  const planRow = await planner.writeOne(prepared.token, {
    sourceKey: 'k',
    category: 'wood',
    property: 'Normal',
    type: 'png',
    data: new Uint8Array(fs.readFileSync(fx('height-bumps-256.png'))),
    conflict: 'keep'
  });
  check(
    '1.1.29 编号库回写失败被捕获',
    planRow.ok && planRow.libraryError && planRow.libraryError.code === 'library_metadata_failed',
    JSON.stringify(planRow).slice(0, 200)
  );
  check('1.1.29 元数据失败时文件仍然落盘', fs.existsSync(planRow.path), planRow.path);
  const planSummary = await planner.finish(prepared.token, { releaseSourceKeys: [] });
  check(
    '1.1.29 导出汇总不把元数据失败当成功',
    planSummary.ok === false &&
      planSummary.written === 1 &&
      planSummary.libraryFailed === 1 &&
      planSummary.needsRepair === true,
    JSON.stringify(planSummary).slice(0, 240)
  );
  /* 组合场景：文件已落盘但属性没记上时崩溃 —— 号必须保留，下一张不能复用。 */
  const afterPlanCrash = new LibraryStore({ dir: planDir });
  const planMarked = await afterPlanCrash.markCrashedReservations();
  const afterPlanNumber = await afterPlanCrash.reserve([{ category: 'wood', sourceName: 'after.png' }]);
  check(
    '1.1.29 文件已写出但属性未记上时也不复用号',
    planMarked.marked >= 1 && afterPlanNumber[0].number === 2,
    JSON.stringify({ marked: planMarked, next: afterPlanNumber[0].number })
  );

  /* -------- 1.1.30 复查修复：同类预留 → 导入高位备份 → 取消 → 重启续号 -------- */
  const importRaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-import-race-'));
  const importSeedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-import-seed-'));
  seedLibrary(importSeedDir, 100);
  const importBackup = new LibraryStore({ dir: importSeedDir }).buildBackup();

  const raceStore = new LibraryStore({ dir: importRaceDir });
  const raceFirst = await raceStore.reserve([{ category: 'wood', sourceName: 'r1.png' }]);
  const raceApplied = await raceStore.applyImport(raceStore.previewImport(importBackup));
  const raceReleased = await raceStore.releaseUnstarted([
    { category: 'wood', number: raceFirst[0].number }
  ]);
  const raceSnapshot = raceStore.getSnapshot();
  const raceWood = raceSnapshot.categories.find((c) => c.value === 'wood');
  check(
    '1.1.30 取消旧计划不抹掉预留后导入的高位号',
    raceFirst[0].number === 1 &&
      raceApplied.ok === true &&
      raceReleased.released === 1 &&
      raceWood.maxAssigned === 100 &&
      raceWood.trustedFloor === 100,
    JSON.stringify({ first: raceFirst[0].number, applied: raceApplied, released: raceReleased, wood: raceWood })
  );
  const raceRestart = new LibraryStore({ dir: importRaceDir });
  const raceNext = await raceRestart.reserve([{ category: 'wood', sourceName: 'r2.png' }]);
  check(
    '1.1.30 重启后同类别从 101 续号',
    raceNext[0].number === 101,
    String(raceNext[0].number)
  );

  /* -------- 1.1.30 复查修复：回写超时不能结算成成功 -------- */
  const slowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-slow-lib-'));
  const slowOut = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-slow-out-'));
  const slowStore = new LibraryStore({ dir: slowDir });
  let releaseWrite = null;
  const slowBackend = {
    scanDirectory: (dir) => slowStore.scanDirectory(dir),
    reserve: (items) => slowStore.reserve(items),
    findSuite: (category, number) => slowStore.findSuite(category, number),
    releaseUnstarted: (entries) => slowStore.releaseUnstarted(entries),
    recordProperty: () =>
      new Promise((resolve) => {
        releaseWrite = () => resolve({ ok: true });
      })
  };
  const slowPlanner = createPlanner({
    store: slowBackend,
    finishWaitMs: 20,
    dialogs: {
      async chooseFolder() {
        return { ok: true, dir: slowOut };
      },
      lastDir() {
        return slowOut;
      }
    }
  });
  const slowPrepared = await slowPlanner.prepare({
    label: '超时回归',
    dir: slowOut,
    items: [{ sourceKey: 's', sourceName: 's.png', category: 'wood', mode: 'new' }]
  });
  const slowWrite = slowPlanner.writeOne(slowPrepared.token, {
    sourceKey: 's',
    category: 'wood',
    property: 'Normal',
    type: 'png',
    data: new Uint8Array(fs.readFileSync(fx('height-bumps-256.png'))),
    conflict: 'keep'
  });
  const slowSummary = await slowPlanner.finish(slowPrepared.token, { releaseSourceKeys: [] });
  check(
    '1.1.30 回写未落定时不结算为成功',
    slowSummary.ok === false &&
      slowSummary.pendingWrites === 1 &&
      slowSummary.written === 1 &&
      slowSummary.released === 0,
    JSON.stringify(slowSummary).slice(0, 240)
  );
  check('1.1.30 超时会话保留，可以再结束一次', Boolean(releaseWrite), 'releaseWrite 未就绪');
  if (releaseWrite) releaseWrite();
  const slowRow = await slowWrite;
  check('1.1.30 迟到回写落定后文件仍成功', slowRow.ok === true, JSON.stringify(slowRow).slice(0, 160));
  const slowRetry = await slowPlanner.finish(slowPrepared.token, { releaseSourceKeys: [] });
  check(
    '1.1.30 重试结束导出结算成功',
    slowRetry.ok === true && slowRetry.written === 1 && slowRetry.libraryFailed === 0,
    JSON.stringify(slowRetry).slice(0, 240)
  );

  /* ---------------- N03 取消目录不占号 ---------------- */
  ctx.dialogs.cancelFolder();
  const beforeCancel = (await libSnapshot()).categories.filter((c) => c.value === 'wood')[0].maxAssigned;
  await importOne(fx('height-bumps-256.png'), 'wood');
  await ctx.js("document.getElementById('download').click()");
  await ctx.wait(1500);
  const afterCancel = (await libSnapshot()).categories.filter((c) => c.value === 'wood')[0].maxAssigned;
  check('N03 取消目录不占号', beforeCancel === afterCancel, beforeCancel + ' -> ' + afterCancel);

  /* ---------------- N03 编号库损坏：阻止分配，不回到 001 ---------------- */
  // 直接建一个新的库实例指向损坏文件：应用内的库已经加载进内存，
  // 只有新实例才会真正去读磁盘，这才是“重启后遇到坏文件”的行为。
  const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-broken-lib-'));
  const brokenFile = path.join(brokenDir, 'nmo-library.json');
  fs.writeFileSync(brokenFile, '{ broken json', 'utf8');

  const brokenStore = new LibraryStore({ dir: brokenDir });
  let brokenError = null;
  try {
    await brokenStore.reserve([{ category: 'wood', sourceName: 'x.png' }]);
  } catch (err) {
    brokenError = err;
  }
  check('N03 编号库损坏时拒绝分配', Boolean(brokenError), brokenError && brokenError.message);
  check(
    'N03 损坏时报错而不是静默归零',
    Boolean(brokenError) && /损坏/.test(brokenError.message),
    brokenError && brokenError.message
  );
  check('N03 损坏时库文件保持原样不被覆盖', fs.readFileSync(brokenFile, 'utf8') === '{ broken json');
  check(
    'N03 快照能报告损坏状态',
    (() => {
      try {
        return brokenStore.getSnapshot().broken !== null;
      } catch {
        return false;
      }
    })()
  );

  /* -------- 1.1.33 删除标签：水位进 retired，同名重建续号 -------- */
  const tagDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-tag-del-'));
  const tagStore = new LibraryStore({ dir: tagDir });
  await tagStore.addCategory('tmp_oak', '临时橡木');
  const removedTag = await tagStore.removeCategory('tmp_oak');
  const tagSnap = tagStore.getSnapshot();
  check(
    '1.1.33 删除自定义标签后从列表消失',
    removedTag.ok === true &&
      !tagSnap.categories.some((c) => c.value === 'tmp_oak') &&
      tagSnap.retiredCategories.indexOf('tmp_oak') >= 0,
    JSON.stringify({ removed: removedTag, retired: tagSnap.retiredCategories })
  );

  let builtinTagError = null;
  try {
    await tagStore.removeCategory('wood');
  } catch (err) {
    builtinTagError = err;
  }
  check(
    '1.1.33 内置标签不能删除',
    Boolean(builtinTagError) && builtinTagError.code === 'CATEGORY_BUILTIN',
    builtinTagError && builtinTagError.code
  );

  let missingTagError = null;
  try {
    await tagStore.removeCategory('never_existed');
  } catch (err) {
    missingTagError = err;
  }
  check(
    '1.1.33 不存在的标签报错',
    Boolean(missingTagError) && missingTagError.code === 'CATEGORY_NOT_FOUND',
    missingTagError && missingTagError.code
  );

  const usedTagDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-tag-used-'));
  const usedTagStore = new LibraryStore({ dir: usedTagDir });
  await usedTagStore.addCategory('oak_used', '用过的橡木');
  const usedTagNumbers = await usedTagStore.reserve([
    { category: 'oak_used', sourceName: 'u1.png' },
    { category: 'oak_used', sourceName: 'u2.png' }
  ]);
  await usedTagStore.recordProperty('oak_used', usedTagNumbers[0].number, 'Normal');
  const usedTagRemoved = await usedTagStore.removeCategory('oak_used');
  const usedTagSnap = usedTagStore.getSnapshot();
  check(
    '1.1.33 用过的标签也能删，历史套组保留',
    usedTagRemoved.ok === true &&
      usedTagRemoved.usedSuites === 2 &&
      usedTagSnap.suites.filter((s) => s.category === 'oak_used').length === 2 &&
      usedTagSnap.retiredCategories.indexOf('oak_used') >= 0,
    JSON.stringify(usedTagRemoved)
  );

  const usedTagBackup = usedTagStore.buildBackup();
  check(
    '1.1.33 备份带上已删除标签的水位',
    Boolean(
      usedTagBackup.retired &&
        usedTagBackup.retired.oak_used &&
        usedTagBackup.retired.oak_used.maxAssigned === 2
    ),
    JSON.stringify(usedTagBackup.retired)
  );

  const cloneTagDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-tag-clone-'));
  const cloneTagStore = new LibraryStore({ dir: cloneTagDir });
  await cloneTagStore.applyImport(cloneTagStore.previewImport(usedTagBackup));
  const cloneReadded = await cloneTagStore.addCategory('oak_used', '用过的橡木');
  const cloneNext = await cloneTagStore.reserve([{ category: 'oak_used', sourceName: 'u3.png' }]);
  check(
    '1.1.33 换库导入后同名重建仍从 003 续号',
    cloneReadded.restored === true && cloneNext[0].number === 3,
    'restored=' + cloneReadded.restored + ' next=' + cloneNext[0].number
  );

  const readdedTag = await usedTagStore.addCategory('oak_used', '用过的橡木');
  const readdedNext = await usedTagStore.reserve([{ category: 'oak_used', sourceName: 'u4.png' }]);
  check(
    '1.1.33 同名标签重建接着原水位（003）',
    readdedTag.restored === true && readdedNext[0].number === 3,
    'restored=' + readdedTag.restored + ' next=' + readdedNext[0].number
  );

  ctx.dialogs.restore();

  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无渲染进程报错', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'naming',
    method: '真实分类弹窗 + 下载按钮 + 原生对话框桩；断言磁盘文件名与像素',
    outputDir: outDir,
    files: filesIn(outDir),
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
