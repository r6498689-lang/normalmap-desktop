'use strict';

/*
 * presets.spec.js — 阶段 D 验收（D01–D07）
 *
 * 三块“工具性”能力，全部走真实界面，每块用自己的输出目录，
 * 避免上一阶段的迟到写入混进当前断言：
 *   D01–D04 参数预设：保存、应用、重命名、删除，文件里只有参数
 *   D05     编号库备份：导出真实文件、导入预览抬高计数、编号接着往后走
 *   D06     批量停止：停下后不重号、不覆盖已写文件
 *   D07     生成失败 → 失败计数 → 重试补回
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

  const fx = (...p) => driver.fixture(...p);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-presets-'));
  const dirA = path.join(root, 'd05-library');
  const dirB = path.join(root, 'd06-stop');
  const dirC = path.join(root, 'd07-retry');
  const backupDir = path.join(root, 'backup');
  [dirA, dirB, dirC, backupDir].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  ctx.saveText('presets-output-dirs.txt', [dirA, dirB, dirC, backupDir].join('\n') + '\n');

  const filesIn = (dir) => fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  const numOf = (name) => {
    const m = /_(\d{3,})_/.exec(name);
    return m ? Number(m[1]) : null;
  };
  const numbersIn = (dir) => filesIn(dir).map(numOf).filter((n) => n !== null);
  const statusText = () =>
    ctx.js("document.getElementById('nmo_status') ? document.getElementById('nmo_status').textContent : ''");

  async function waitStatus(re, timeout) {
    const deadline = Date.now() + (timeout || 15000);
    while (Date.now() < deadline) {
      const text = await statusText();
      if (re.test(text)) return text;
      await ctx.wait(150);
    }
    return await statusText();
  }

  async function waitFile(dir, name, timeout) {
    const deadline = Date.now() + (timeout || 25000);
    while (Date.now() < deadline) {
      if (fs.existsSync(path.join(dir, name))) return true;
      await ctx.wait(120);
    }
    return false;
  }

  /** 等到目录里出现一个不在 before 里的新文件，返回全部新文件名。 */
  async function waitNewFiles(dir, before, timeout) {
    const deadline = Date.now() + (timeout || 25000);
    while (Date.now() < deadline) {
      const fresh = filesIn(dir).filter((n) => !before.has(n));
      if (fresh.length) return fresh;
      await ctx.wait(150);
    }
    return filesIn(dir).filter((n) => !before.has(n));
  }

  async function importOne(file, category) {
    await ctx.setFileInput(ctx.win, '#select_file_height', [file]);
    await ctx.waitFor("Boolean(document.getElementById('classify_dialog'))", 20000);
    await ctx.waitFor("!document.getElementById('classify_cat_wood').disabled", 20000);
    await ctx.js(`document.getElementById('classify_cat_${category}').click()`);
    await ctx.wait(150);
    await ctx.js("document.getElementById('classify_ok').click()");
    await ctx.waitFor("document.getElementById('classify_dialog') === null", 15000);
    await ctx.wait(600);
  }

  async function importMany(files, category) {
    await ctx.setFileInput(ctx.win, '#select_multiple_height_files', files);
    await ctx.waitFor("Boolean(document.getElementById('classify_dialog'))", 20000);
    for (let i = 0; i < files.length; i++) {
      await ctx.waitFor("!document.getElementById('classify_cat_wood').disabled", 20000);
      await ctx.js(`document.getElementById('classify_cat_${category}').click()`);
      await ctx.wait(120);
    }
    await ctx.js("document.getElementById('classify_ok').click()");
    await ctx.waitFor("document.getElementById('classify_dialog') === null", 15000);
    await ctx.waitFor("Boolean(document.getElementById('export_plan_dialog'))", 20000);
    await ctx.js("document.getElementById('export_plan_choose_dir').click()");
    await ctx.waitFor("!document.getElementById('export_plan_start').disabled", 15000);
    await ctx.js("document.getElementById('export_plan_start').click()");
    await ctx.waitFor("document.getElementById('export_plan_dialog') === null", 15000);
  }

  const setControl = (id, value, eventName) =>
    ctx.js(`(function(){
      var el = document.getElementById(${JSON.stringify(id)});
      el.value = ${JSON.stringify(String(value))};
      el.dispatchEvent(new Event(${JSON.stringify(eventName || 'change')}, { bubbles: true }));
      return el.value;
    })()`);

  const setPresetName = (name) =>
    ctx.js(
      "(function(){var el=document.getElementById('preset_name'); el.value=" +
        JSON.stringify(name) +
        "; el.dispatchEvent(new Event('input',{bubbles:true})); return el.value;})()"
    );

  const optionExists = (name) =>
    ctx.js(
      "(function(){var s=document.getElementById('preset_select');" +
        'return Array.prototype.some.call(s.options,function(o){return o.value===' +
        JSON.stringify(name) +
        '})})()'
    );

  await driver.waitForBoot(ctx);

  const libraryFile = JSON.parse(
    await ctx.js('window.nmoDesktop.getLibrary().then(function(r){return JSON.stringify(r.library.file)})')
  );
  const presetFile = path.join(path.dirname(libraryFile), 'nmo-presets.json');

  /* ---------------- D01 保存预设 ---------------- */
  await setControl('rough_value', '0.15', 'input');
  await setControl('metal_mode', 'full');
  await setPresetName('哑光金属');
  await ctx.js("document.getElementById('preset_save').click()");
  const savedStatus = await waitStatus(/已保存预设/);
  check('D01 保存后给出反馈', /已保存预设/.test(savedStatus), savedStatus);
  check('D01 预设文件落盘', fs.existsSync(presetFile), presetFile);

  let presetDoc = JSON.parse(fs.readFileSync(presetFile, 'utf8'));
  check(
    'D01 文件里记下了名字与参数',
    Boolean(presetDoc.presets && presetDoc.presets['哑光金属']) &&
      presetDoc.presets['哑光金属'].data.roughness.value === 0.15 &&
      presetDoc.presets['哑光金属'].data.metallic.mode === 'full',
    JSON.stringify(presetDoc.presets && presetDoc.presets['哑光金属'] ? presetDoc.presets['哑光金属'].data : null)
  );
  check('D01 下拉框列出这个预设', (await optionExists('哑光金属')) === true);

  /* ---------------- D02 预设有意不含图片与编号 ---------------- */
  const rawPresets = fs.readFileSync(presetFile, 'utf8');
  check('D02 预设文件不含图片数据', !/data:image|base64/i.test(rawPresets), 'found image payload');
  check(
    'D02 预设文件不含编号库字段',
    !/"(suites|reservations|maxAssigned|sourceKey)"\s*:/.test(rawPresets),
    rawPresets.slice(0, 120)
  );

  /* ---------------- D03 应用预设：把改动拉回保存时的值 ---------------- */
  await setControl('rough_value', '0.82', 'input');
  await setControl('metal_mode', 'none');
  const beforeApply = JSON.parse(
    await ctx.js(
      'JSON.stringify({r:NMO_RoughnessMap.getSettings().value, m:NMO_MetallicMap.getSettings().mode})'
    )
  );
  check(
    'D03 应用前确实是改过的值',
    beforeApply.r === 0.82 && beforeApply.m === 'none',
    JSON.stringify(beforeApply)
  );

  await ctx.js("document.getElementById('preset_select').value='哑光金属'");
  await ctx.js("document.getElementById('preset_apply').click()");
  await ctx.wait(600);
  const afterApply = JSON.parse(
    await ctx.js(
      'JSON.stringify({r:NMO_RoughnessMap.getSettings().value, m:NMO_MetallicMap.getSettings().mode, ' +
        'rv:document.getElementById("rough_value").value, mv:document.getElementById("metal_mode").value})'
    )
  );
  check(
    'D03 数据层回到预设值',
    afterApply.r === 0.15 && afterApply.m === 'full',
    JSON.stringify(afterApply)
  );
  check(
    'D03 控件也同步回预设值（不是只改数据）',
    Number(afterApply.rv) === 0.15 && afterApply.mv === 'full',
    JSON.stringify(afterApply)
  );

  /* ---------------- D04 重命名 / 删除 ---------------- */
  await ctx.js("document.getElementById('preset_select').value='哑光金属'");
  await setPresetName('哑光');
  await ctx.js("document.getElementById('preset_rename').click()");
  const renameStatus = await waitStatus(/已重命名/);
  check('D04 重命名有反馈', /已重命名为/.test(renameStatus), renameStatus);
  presetDoc = JSON.parse(fs.readFileSync(presetFile, 'utf8'));
  check(
    'D04 文件里的键名已改',
    Boolean(presetDoc.presets['哑光']) && !presetDoc.presets['哑光金属'],
    Object.keys(presetDoc.presets).join(',')
  );
  check('D04 下拉框跟着改名', (await optionExists('哑光')) === true);

  await ctx.js("document.getElementById('preset_select').value='哑光'");
  await ctx.js("document.getElementById('preset_delete').click()");
  await ctx.wait(700);
  presetDoc = JSON.parse(fs.readFileSync(presetFile, 'utf8'));
  check('D04 删除后文件里没有该预设', !presetDoc.presets['哑光'], Object.keys(presetDoc.presets).join(','));
  check('D04 删除后下拉框不再列出', (await optionExists('哑光')) === false);

  /* ---------------- D05 备份 → 抬高 → 导入 ---------------- */
  // 先让编号库里真的有一条 wood 记录，否则备份里只有内置默认，没有计数可比。
  ctx.dialogs.folderIs(dirA);
  await importOne(fx('height-bumps-256.png'), 'wood');
  await ctx.js("document.getElementById('download').click()");
  check('D05 前置：先写出 wood_001', await waitFile(dirA, 'wood_001_Normal.png'));

  const backupPath = path.join(backupDir, 'library-backup.json');
  ctx.dialogs.saveTo(backupPath);
  await ctx.js("document.getElementById('library_backup').click()");
  check('D05 备份文件写出', await waitFile(backupDir, 'library-backup.json', 15000), backupPath);

  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const backupRaw = fs.readFileSync(backupPath, 'utf8');
  check(
    'D05 备份带分类与套组',
    backup.kind === 'nmo-number-library' &&
      backup.categories &&
      typeof backup.categories === 'object' &&
      Array.isArray(backup.suites),
    Object.keys(backup.categories || {}).length + ' categories'
  );
  check('D05 备份不含图片数据', !/data:image|base64/i.test(backupRaw), 'found image payload');
  const backupStatus = await waitStatus(/编号库备份已保存/);
  check('D05 状态说明备份不含图片', /不含任何图片/.test(backupStatus), backupStatus);

  const woodInBackup = backup.categories.wood || { maxAssigned: 0 };
  check('D05 备份里 wood 已有计数', Number(woodInBackup.maxAssigned) === 1, JSON.stringify(woodInBackup));

  const raisedTo = Number(woodInBackup.maxAssigned || 0) + 7;
  backup.categories.wood = { maxAssigned: raisedTo };
  backup.suites = [];
  backup.reservations = [];
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2) + '\n', 'utf8');

  ctx.dialogs.folderIs(backupPath);
  await ctx.js("document.getElementById('library_import').click()");
  await ctx.waitFor("Boolean(document.getElementById('library_import_dialog'))", 15000);
  const previewText = await ctx.js("document.getElementById('library_import_text').textContent");
  check(
    'D05 导入前给出差异预览',
    /抬高计数 1 个/.test(previewText) && /不会降号/.test(previewText),
    previewText
  );
  check(
    'D05 预览写清了大小与内容范围',
    /大小：\d+(\.\d+)?\s*(B|KB|MB)（[^）]*不含图片/.test(previewText),
    previewText
  );

  await ctx.js("document.getElementById('library_import_ok').click()");
  await ctx.waitFor("document.getElementById('library_import_dialog') === null", 10000);
  const afterImport = JSON.parse(
    await ctx.js('window.nmoDesktop.getLibrary().then(function(r){return JSON.stringify(r.library)})')
  );
  const woodAfterImport = afterImport.categories.filter((c) => c.value === 'wood')[0];
  check(
    'D05 导入把计数抬到备份里的值',
    woodAfterImport && woodAfterImport.maxAssigned === raisedTo,
    JSON.stringify(woodAfterImport)
  );

  // 导入对话框把 open-dialog 桩指向了备份文件本身，这里必须指回输出目录。
  ctx.dialogs.folderIs(dirA);
  await importOne(fx('height-bumps-256.png'), 'wood');
  await ctx.js("document.getElementById('download').click()");
  const expectedName = 'wood_' + String(raisedTo + 1).padStart(3, '0') + '_Normal.png';
  check('D05 导入后新图接着往后编号', await waitFile(dirA, expectedName), expectedName);

  /* ---------------- D06 批量停止：不重号、不覆盖 ---------------- */
  ctx.dialogs.folderIs(dirB);
  for (const id of ['displacement_tick', 'ambient_tick', 'specular_tick']) {
    await ctx.js(`document.getElementById('${id}').checked = false`);
  }
  // 只把生成环节拖慢，用来稳定命中“进行到一半点停止”的窗口。
  await ctx.js(
    "(function(){var orig=NMO_Main.buildImageRecord.bind(NMO_Main);window.__nmoOrigBuild=orig;" +
      'NMO_Main.buildImageRecord=function(t,n){return new Promise(function(res,rej){setTimeout(function(){' +
      'Promise.resolve(orig(t,n)).then(res,rej);},260);});};return true;})()'
  );
  await importMany(
    [fx('height-255x257.png'), fx('height-alpha-192.png'), fx('height-300x200.png'), fx('height-bumps-256.png')],
    'wood'
  );
  const stopDeadline = Date.now() + 20000;
  while (Date.now() < stopDeadline && filesIn(dirB).length === 0) {
    await ctx.wait(80);
  }
  await ctx.js("document.getElementById('batch_stop').click()");
  const stoppedStatus = await waitStatus(/已请求停止/, 5000);
  check('D06 点停止后给出说明', /已请求停止/.test(stoppedStatus), stoppedStatus);

  const stopEnd = Date.now() + 30000;
  while (stopEnd > Date.now()) {
    if ((await ctx.js("document.getElementById('batch_stop').style.display === 'none'")) === true) break;
    await ctx.wait(150);
  }
  await ctx.js(
    "(function(){if(window.__nmoOrigBuild){NMO_Main.buildImageRecord=window.__nmoOrigBuild;}return true;})()"
  );
  await ctx.wait(400);

  ctx.saveText('d06-stop-status.txt', await statusText());
  ctx.saveText(
    'd06-library-after-stop.json',
    await ctx.js('window.nmoDesktop.getLibrary().then(function(r){return JSON.stringify(r.library,null,1)})')
  );

  const written = filesIn(dirB);
  const writtenNumbers = written.map(numOf).filter((n) => n !== null);
  check('D06 停止后没有写满 4 张', written.length < 4, written.join(','));
  check('D06 已经写出的文件保留着', written.length >= 1, written.join(','));
  check(
    'D06 写出的编号互不重复',
    new Set(writtenNumbers).size === writtenNumbers.length,
    writtenNumbers.join(',')
  );

  const libStop = JSON.parse(
    await ctx.js('window.nmoDesktop.getLibrary().then(function(r){return JSON.stringify(r.library)})')
  );
  const woodStop = libStop.categories.filter((c) => c.value === 'wood')[0];
  check(
    'D06 计数不小于已写出的最大编号（不重号）',
    woodStop.maxAssigned >= Math.max.apply(null, writtenNumbers),
    JSON.stringify({ maxAssigned: woodStop.maxAssigned, writtenNumbers })
  );

  // 停止后再来一张：编号必须大于已写出的全部编号，不能复用空号。
  ctx.dialogs.folderIs(dirB);
  const beforeNext = new Set(filesIn(dirB));
  await importOne(fx('height-alpha-192.png'), 'wood');
  await ctx.js("document.getElementById('download').click()");
  const nextFiles = await waitNewFiles(dirB, beforeNext, 25000);
  const nextNumber = nextFiles.length ? numOf(nextFiles[0]) : null;
  // 停止时没轮到的源图必须退号：下一张应当正好接在已写出的最大号后面，
  // 不是跳过它们（那会留下永久空号），也不是复用已写出的号。
  check(
    'D06 未开始的源图不占号（下一张正好接上）',
    nextNumber !== null && nextNumber === Math.max.apply(null, writtenNumbers) + 1,
    nextFiles.join(',') + ' vs ' + writtenNumbers.join(',')
  );

  /* ---------------- D07 生成失败 → 计数 → 重试 ---------------- */
  ctx.dialogs.folderIs(dirC);
  // 分类弹窗会把无法解码的文件挡在计划之外，所以这里模拟一次“生成阶段”失败：
  // 第一张源图生成时抛错，第二张正常写出，验证失败记账与重试补回。
  await ctx.js(
    "(function(){var orig=NMO_Main.buildImageRecord.bind(NMO_Main);window.__nmoRealBuild=orig;" +
      'var first=true;NMO_Main.buildImageRecord=function(t,n){' +
      "if(first){first=false;return Promise.reject(new Error('模拟生成失败'));}" +
      'return orig(t,n);};return true;})()'
  );
  await importMany([fx('height-bumps-256.png'), fx('height-alpha-192.png')], 'wood');
  await ctx.wait(700);

  const retryState = JSON.parse(
    await ctx.js(
      "JSON.stringify({display:document.getElementById('batch_retry').style.display," +
        "text:document.getElementById('batch_retry').textContent," +
        'failures:NMO_FileDrop.batchState.failures.length})'
    )
  );
  check(
    'D07 生成失败被记成失败项并给出条数',
    retryState.failures === 1 && /重试失败项（1）/.test(retryState.text),
    JSON.stringify(retryState)
  );
  check('D07 失败时重试按钮可见', retryState.display !== 'none', JSON.stringify(retryState));
  check('D07 同批另一张照常写出（失败不牵连）', filesIn(dirC).length === 1, filesIn(dirC).join(','));

  await ctx.js(
    "(function(){if(window.__nmoRealBuild){NMO_Main.buildImageRecord=window.__nmoRealBuild;}return true;})()"
  );
  await ctx.js("document.getElementById('batch_retry').click()");
  await ctx.wait(2500);

  const afterRetry = JSON.parse(
    await ctx.js(
      "JSON.stringify({failures:NMO_FileDrop.batchState.failures.length," +
        "text:document.getElementById('batch_retry').textContent," +
        "display:document.getElementById('batch_retry').style.display})"
    )
  );
  check('D07 重试成功后失败项清零', afterRetry.failures === 0, JSON.stringify(afterRetry));
  check('D07 清零后重试按钮隐藏', afterRetry.display === 'none', JSON.stringify(afterRetry));
  check('D07 重试把缺的那张补上', filesIn(dirC).length === 2, filesIn(dirC).join(','));
  const retryNumbers = numbersIn(dirC);
  check(
    'D07 重试后编号仍无重复',
    new Set(retryNumbers).size === retryNumbers.length,
    retryNumbers.join(',')
  );

  ctx.dialogs.restore();
  return { ok: failures.length === 0, failures, steps };
};
