'use strict';

/*
 * save-contract.spec.js
 * 保存契约的两条硬约束：
 *
 *   R1  一次批量导出的最终结论必须合并"页面生成失败"与"主进程写盘失败"，
 *       既不漏计也不重复计；有任何失败时不得报成功。
 *   R2  落盘文件的扩展名必须与实际编码一致；名字被纠正时必须让用户确认，
 *       且确认对象是最终要写的那个文件（含它自己的覆盖提示）。
 *
 * 结论以磁盘文件、状态栏文案与 class、桥接返回值为准。
 */

const fs = require('node:fs');
const path = require('node:path');
const driver = require('../lib/driver');
const { magicOf } = require('../lib/imageinfo');

const PNG_MAGIC = '89504e470d0a1a0a';

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
  await driver.loadHeightFile(ctx, driver.fixture('height-bumps-256.png'));
  await ctx.wait(400);

  const status = () =>
    ctx.js(`(function(){
      var el = document.getElementById('nmo_status');
      return el ? { text: el.textContent, cls: el.className } : { text: '', cls: '' };
    })()`);

  const filesNow = () => (fs.existsSync(outDir) ? fs.readdirSync(outDir).sort() : []);

  const exportMany = (options) =>
    ctx.js(`(function(){
      var opts = ${JSON.stringify(options)};
      var kinds = opts.kinds || [];
      return NMO_Desktop.exportMany({
        label: opts.label || 'Contract export',
        baseName: opts.baseName || 'contract',
        total: kinds.length,
        nameFor: function(i){ return opts.baseName + '_' + kinds[i]; },
        produce: function(i){
          var kind = kinds[i];
          if (kind === 'throw') return Promise.reject(new Error('synthetic encode failure'));
          if (kind === 'empty') return Promise.resolve(null);
          if (kind === 'badtype') return Promise.resolve({ name: opts.baseName + '_bad', type: 'gif', data: new Uint8Array([1,2,3]) });
          return NMO_Main.buildImageRecord('NormalMap', opts.baseName + '_' + kind);
        }
      });
    })()`);

  // =========================================================== R1: 统计口径
  // 混合：一张成功、一张生成失败
  ctx.dialogs.folderIs(outDir);
  const mixed = await exportMany({ label: 'Mixed', baseName: 'mixed', kinds: ['ok', 'throw'] });
  await ctx.wait(300);
  const mixedStatus = await status();
  check('R1 混合失败：ok 必须为 false', mixed && mixed.ok === false, JSON.stringify(mixed));
  check('R1 混合失败：written=1', mixed && mixed.written === 1, String(mixed && mixed.written));
  check('R1 混合失败：failed=1', mixed && mixed.failed === 1, String(mixed && mixed.failed));
  check('R1 混合失败：genFailed=1 且 writeFailed=0', mixed && mixed.genFailed === 1 && mixed.writeFailed === 0, JSON.stringify(mixed));
  check('R1 混合失败：磁盘只有 1 个文件', filesNow().length === 1, JSON.stringify(filesNow()));
  check(
    'R1 混合失败：状态栏说明"1 个未能生成"',
    /1 个失败（1 个生成失败）/.test(mixedStatus.text),
    mixedStatus.text
  );
  check('R1 混合失败：状态样式为 error', /\berror\b/.test(mixedStatus.cls), mixedStatus.cls);

  // 全部生成失败：一个文件都不该写出，结论必须是失败
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  ctx.dialogs.folderIs(outDir);
  const allFailed = await exportMany({ label: 'All fail', baseName: 'allfail', kinds: ['throw', 'empty'] });
  await ctx.wait(300);
  check('R1 全部失败：ok 为 false', allFailed && allFailed.ok === false, JSON.stringify(allFailed));
  check('R1 全部失败：written=0', allFailed && allFailed.written === 0, String(allFailed && allFailed.written));
  check('R1 全部失败：failed=2', allFailed && allFailed.failed === 2, String(allFailed && allFailed.failed));
  check('R1 全部失败：磁盘无文件', filesNow().length === 0, JSON.stringify(filesNow()));

  // 写盘被拒（记录类型不合法）：失败来自主进程，不应重复计数
  ctx.dialogs.folderIs(outDir);
  const writeRejected = await exportMany({ label: 'Bad type', baseName: 'badtype', kinds: ['ok', 'badtype'] });
  await ctx.wait(300);
  check('R1 写盘被拒：ok 为 false', writeRejected && writeRejected.ok === false, JSON.stringify(writeRejected));
  check('R1 写盘被拒：writeFailed=1', writeRejected && writeRejected.writeFailed === 1, JSON.stringify(writeRejected));
  check('R1 写盘被拒：genFailed=0（不重复计数）', writeRejected && writeRejected.genFailed === 0, JSON.stringify(writeRejected));
  check('R1 写盘被拒：failed 总数为 1', writeRejected && writeRejected.failed === 1, String(writeRejected && writeRejected.failed));

  // 会话丢失：endBatch 被提前调用后，finishBatch 必须报错而不是成功
  ctx.dialogs.folderIs(outDir);
  const lost = await ctx.js(`(async function(){
    var ctx2 = await NMO_Desktop.openFolder('Lost session', 'lost');
    await window.nmoDesktop.endBatch(ctx2.token);
    return NMO_Desktop.finishBatch(ctx2, 'Lost session');
  })()`);
  await ctx.wait(200);
  check('R1 会话丢失：ok 为 false', lost && lost.ok === false, JSON.stringify(lost));
  check('R1 会话丢失：带错误信息', Boolean(lost && lost.error), JSON.stringify(lost));

  // 输入解码失败：分类阶段就该拦下来——不建计划、不写文件、不占号。
  // （改造后坏图不再进批量循环，所以这里断言的是“更早的拦截”。）
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  ctx.dialogs.folderIs(outDir);
  await ctx.setFileInput(ctx.win, '#select_multiple_height_files', [driver.fixture('not-an-image.png')]);
  await ctx.waitFor("Boolean(document.getElementById('classify_dialog'))", 15000);
  // 错误文案要等解码真的失败才写进去，不能只看容器是否存在。
  await ctx.waitFor(
    "(document.querySelector('.nmo-modal__error-text') || {}).textContent ? true : false",
    15000
  );
  const rejectState = await ctx.js(`(function(){
    var box = document.getElementById('classify_error');
    var text = box ? box.querySelector('.nmo-modal__error-text') : null;
    return {
      visible: Boolean(box) && box.hidden === false,
      text: text ? text.textContent : '',
      canRemove: Boolean(document.getElementById('classify_remove')),
      confirmDisabled: Boolean(document.getElementById('classify_ok') && document.getElementById('classify_ok').disabled)
    };
  })()`);
  check(
    'R1 坏图：分类弹窗明确说无法预览',
    /无法|解码|受支持/.test(rejectState.text),
    JSON.stringify(rejectState).slice(0, 300)
  );
  check('R1 坏图：提供“从本次任务移除”', rejectState.canRemove === true, JSON.stringify(rejectState));
  check('R1 坏图：没有可分类项时不能确定', rejectState.confirmDisabled === true, JSON.stringify(rejectState));
  await ctx.js("document.getElementById('classify_remove').click()");
  await ctx.wait(300);
  await ctx.js("document.getElementById('classify_close').click()");
  await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);
  await ctx.wait(500);
  check('R1 坏图：磁盘无文件', filesNow().length === 0, JSON.stringify(filesNow()));
  const rejectStatus = await status();
  check(
    'R1 坏图：状态栏说明未生成任何文件',
    /已取消|未生成/.test(rejectStatus.text),
    rejectStatus.text
  );

  // ================================================= R2: 扩展名与编码一致
  await driver.setControl(ctx, 'file_name', 'ext-png');
  await driver.setControl(ctx, 'file_type', 'png');

  // PNG 编码 + 用户输入 .jpg
  // 用户输入的名字是 ext-png-as-jpeg.jpg；保留主干，只纠正扩展名
  const wrongPng = path.join(outDir, 'ext-png-as-jpeg.jpg');
  const pngTarget = path.join(outDir, 'ext-png-as-jpeg.png');
  fs.rmSync(pngTarget, { force: true });
  fs.rmSync(wrongPng, { force: true });
  ctx.dialogs.saveTo(wrongPng);
  ctx.dialogs.answerMessageBox(0);
  await ctx.js("document.getElementById('download').click()");
  const pngFixed = await driver.waitForFile(pngTarget, 10000);
  check('R2 PNG：写成 .png 而不是 .jpg', pngFixed && !fs.existsSync(wrongPng), JSON.stringify(filesNow()));
  check('R2 PNG：魔数仍是 PNG', pngFixed && magicOf(pngTarget).startsWith(PNG_MAGIC), magicOf(pngTarget));
  check('R2 PNG：弹出了扩展名提示', ctx.messages.length === 1, JSON.stringify(ctx.messages));
  check(
    'R2 PNG：提示里点名最终文件',
    ctx.messages.length === 1 && /ext-png-as-jpeg\.png/.test(ctx.messages[0].detail),
    JSON.stringify(ctx.messages)
  );
  // 复查发现过 detail 里出现字面量 //n 的转义错误；这里把它钉住。
  check(
    'R2 PNG：提示里的换行是真换行，不是字面量 //n',
    ctx.messages.length === 1 &&
      ctx.messages[0].detail.indexOf(String.fromCharCode(10)) !== -1 &&
      ctx.messages[0].detail.indexOf('//n') === -1,
    JSON.stringify(ctx.messages)
  );
  const pngStatus = await status();
  check('R2 PNG：状态栏说明已校正', /扩展名已改为 \.png/.test(pngStatus.text), pngStatus.text);

  // JPEG 编码 + 用户输入 .png
  await ctx.dialogs.restore();
  await driver.setControl(ctx, 'file_name', 'ext-jpg');
  await driver.setControl(ctx, 'file_type', 'jpg');
  const wrongJpg = path.join(outDir, 'ext-jpg-as-png.png');
  const jpgTarget = path.join(outDir, 'ext-jpg-as-png.jpg');
  fs.rmSync(jpgTarget, { force: true });
  fs.rmSync(wrongJpg, { force: true });
  ctx.dialogs.saveTo(wrongJpg);
  ctx.dialogs.answerMessageBox(0);
  await ctx.js("document.getElementById('download').click()");
  const jpgFixed = await driver.waitForFile(jpgTarget, 10000);
  check('R2 JPG：写成 .jpg 而不是 .png', jpgFixed && !fs.existsSync(wrongJpg), JSON.stringify(filesNow()));
  check('R2 JPG：魔数是 JPEG', jpgFixed && magicOf(jpgTarget).startsWith('ffd8ff'), magicOf(jpgTarget));

  // TIFF 编码 + 无扩展名
  await ctx.dialogs.restore();
  await driver.setControl(ctx, 'file_name', 'ext-tif');
  await driver.setControl(ctx, 'file_type', 'tiff');
  const tifTarget = path.join(outDir, 'ext-tif.tif');
  const noExt = path.join(outDir, 'ext-tif');
  fs.rmSync(tifTarget, { force: true });
  fs.rmSync(noExt, { force: true });
  ctx.dialogs.saveTo(noExt);
  ctx.dialogs.answerMessageBox(0);
  await ctx.js("document.getElementById('download').click()");
  const tifFixed = await driver.waitForFile(tifTarget, 10000);
  check('R2 TIFF：无扩展名时补成 .tif', tifFixed && !fs.existsSync(noExt), JSON.stringify(filesNow()));
  check(
    'R2 TIFF：魔数正确',
    tifFixed && (magicOf(tifTarget).startsWith('49492a00') || magicOf(tifTarget).startsWith('4d4d002a')),
    magicOf(tifTarget)
  );

  // 正确的别名不打扰用户：.jpeg 就是 JPEG
  await ctx.dialogs.restore();
  await driver.setControl(ctx, 'file_name', 'alias-jpeg');
  await driver.setControl(ctx, 'file_type', 'jpg');
  const aliasPath = path.join(outDir, 'alias-jpeg.jpeg');
  fs.rmSync(aliasPath, { force: true });
  ctx.dialogs.saveTo(aliasPath);
  ctx.dialogs.answerMessageBox(1); // 若真的弹框，这个 1 会让导出被取消
  await ctx.js("document.getElementById('download').click()");
  const aliasWritten = await driver.waitForFile(aliasPath, 10000);
  check('R2 .jpeg 视为合法扩展名，不弹框', aliasWritten && ctx.messages.length === 0, JSON.stringify(ctx.messages));

  // 用户在纠正提示上取消：不得写出任何文件
  await ctx.dialogs.restore();
  await driver.setControl(ctx, 'file_name', 'cancel-me');
  await driver.setControl(ctx, 'file_type', 'png');
  const cancelTarget = path.join(outDir, 'cancel-me.png');
  const cancelWrong = path.join(outDir, 'cancel-me.jpg');
  fs.rmSync(cancelTarget, { force: true });
  fs.rmSync(cancelWrong, { force: true });
  ctx.dialogs.saveTo(cancelWrong);
  ctx.dialogs.answerMessageBox(1);
  await ctx.js("document.getElementById('download').click()");
  await ctx.wait(900);
  check(
    'R2 取消校正：两个名字都不存在',
    !fs.existsSync(cancelTarget) && !fs.existsSync(cancelWrong),
    JSON.stringify(filesNow())
  );

  // 纠正后的目标已存在：提示必须点名"将被替换"
  await ctx.dialogs.restore();
  await driver.setControl(ctx, 'file_name', 'replace-me');
  const replaceTarget = path.join(outDir, 'replace-me.png');
  fs.writeFileSync(replaceTarget, Buffer.from('stale', 'utf8'));
  ctx.dialogs.saveTo(path.join(outDir, 'replace-me.jpg'));
  ctx.dialogs.answerMessageBox(0);
  await ctx.js("document.getElementById('download').click()");
  await driver.waitForFile(replaceTarget, 10000);
  await ctx.wait(300);
  check(
    'R2 覆盖提示针对最终文件',
    ctx.messages.length === 1 && /已存在，将被替换/.test(ctx.messages[0].detail),
    JSON.stringify(ctx.messages)
  );
  check(
    'R2 覆盖后是 PNG 而不是旧内容',
    magicOf(replaceTarget).startsWith(PNG_MAGIC),
    magicOf(replaceTarget)
  );

  ctx.dialogs.restore();
  await ctx.screenshot('save-contract-final.png');

  return { ok: failures.length === 0, steps, failures };
};
