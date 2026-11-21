'use strict';

/*
 * agent.spec.js — 1.1.16 本机 Agent 桥。
 *
 * 覆盖：
 *   - 不带令牌 / 错令牌一律 401；
 *   - ping 返回版本与窗口状态；
 *   - open_image 把本地文件送进页面并套类别预设；
 *   - categories 返回类别清单（AI 从中选类别）；
 *   - preview 返回缩略图与配色统计（AI 用它“看”图，导入前也能看）；
 *   - set_category 换类别后预设重算；
 *   - export 写盘、命名规则、像素统计与哈希；
 *   - batch 一批图各自带类别，逐张导出并回传逐张结果；
 *   - async 批量、进度事件、GET /events 与取消；
 *   - 命令审计日志（JSONL、脱敏、不记 ping/log）；
 *   - --agent-out 白名单：只允许往指定目录（含子目录）导出；
 *   - 批量 retry 重试与 resume 断点续跑；
 *   - 未知命令、坏路径、坏类别都有结构化错误；
 *   - 发现文件写入与删除；
 *   - window 命令能隐藏 / 显示窗口。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const driver = require('../lib/driver');
const { startAgentServer, writeDiscoveryFile, removeDiscoveryFile } = require('../../desktop/agent-server');
const { createAgentCommands } = require('../../desktop/agent-commands');

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  await driver.waitForBoot(ctx);

  const token = 'spec-' + Math.random().toString(36).slice(2);
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-log-'));
  const activities = [];
  const commands = createAgentCommands({
    getWindow: () => ctx.win,
    version: '1.1.16-spec',
    logDir: logDir,
    outDir: os.tmpdir(),
    onActivity: (payload) => activities.push(payload)
  });
  const server = await startAgentServer({ commands: commands, token: token });
  const base = 'http://127.0.0.1:' + server.port;

  async function call(cmd, args, options) {
    const opts = options || {};
    const headers = { 'content-type': 'application/json' };
    if (opts.token !== null) headers.authorization = 'Bearer ' + (opts.token || token);
    const res = await fetch(base + '/command', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ cmd: cmd, args: args || {} })
    });
    return { status: res.status, body: await res.json() };
  }

  try {
    /* ---------------------------------------------------------- 鉴权 */
    const noToken = await call('ping', {}, { token: null });
    check('没有令牌返回 401', noToken.status === 401 && /unauthorized/.test(noToken.body.error.code), JSON.stringify(noToken.body));

    const badToken = await call('ping', {}, { token: 'wrong-token' });
    check('错令牌返回 401', badToken.status === 401, String(badToken.status));

    const health = await fetch(base + '/health', {
      headers: { authorization: 'Bearer ' + token }
    });
    const healthBody = await health.json();
    check('health 返回版本', health.status === 200 && healthBody.ok && healthBody.version === '1.1.16-spec', JSON.stringify(healthBody));

    /* ---------------------------------------------------------- 未知命令 */
    const unknown = await call('nope');
    check('未知命令有结构化错误', unknown.body.ok === false && unknown.body.error.code === 'unknown_command', JSON.stringify(unknown.body));

    /* ---------------------------------------------------------- 开图 */
    const image = driver.fixture('height-bumps-256.png');
    const opened = await call('open_image', { path: image, category: 'wood' });
    check('open_image 成功', opened.body.ok === true, JSON.stringify(opened.body).slice(0, 300));
    check(
      '读到 256×256',
      opened.body.ok && opened.body.image && opened.body.image.size && opened.body.image.size.width === 256,
      JSON.stringify(opened.body.image)
    );
    check('类别写进源上下文', opened.body.ok && opened.body.category === 'wood', String(opened.body.category));
    check('类别预设已套用（粗糙度有 base）', opened.body.ok && opened.body.params.roughness && typeof opened.body.params.roughness.base === 'number', JSON.stringify(opened.body.params && opened.body.params.roughness).slice(0, 200));
    check('粗糙度画布已生成', opened.body.ok && Boolean(opened.body.generated.roughness), JSON.stringify(opened.body.generated));

    /* ---------------------------------------------------------- 坏输入 */
    const missing = await call('open_image', { path: 'D:\\no\\such\\file.png', category: 'wood' });
    check('不存在的文件报 file_not_found', missing.body.ok === false && missing.body.error.code === 'file_not_found', JSON.stringify(missing.body));

    const badCategory = await call('set_category', { category: 'unobtanium' });
    check('未知类别被拒绝', badCategory.body.ok === false && badCategory.body.error.code === 'unknown_category', JSON.stringify(badCategory.body).slice(0, 200));

    /* ---------------------------------------------------------- 换类别 */
    const stone = await call('set_category', { category: 'stone' });
    check('set_category 生效', stone.body.ok && stone.body.category === 'stone', JSON.stringify(stone.body.category));

    /* ---------------------------------------------------------- 类别清单 */
    const cats = await call('categories');
    const catList = (cats.body && cats.body.categories) || [];
    check('categories 返回类别表', cats.body.ok && catList.length >= 15, String(catList.length));
    const woodRow = catList.filter((c) => c.value === 'wood')[0] || {};
    check(
      '类别带中文标签与预设',
      woodRow.label === '木材' && woodRow.preset && typeof woodRow.preset.base === 'number',
      JSON.stringify(woodRow)
    );
    check('类别带下一个编号', typeof woodRow.nextNumber === 'number', String(woodRow.nextNumber));
    check('categories 回报当前类别', cats.body.current === 'stone', String(cats.body.current));

    /* ---------------------------------------------------------- 缩略图（AI 的眼睛） */
    const thumb = await call('preview', { path: image, max: 96 });
    const thumbImage = (thumb.body && thumb.body.image) || {};
    check('preview 返回 PNG', thumb.body.ok && /^iVBOR/.test(thumbImage.data || ''), String(thumbImage.data || '').slice(0, 8));
    check(
      'preview 缩到最长边 96',
      thumbImage.thumbWidth === 96 && thumbImage.thumbHeight === 96,
      JSON.stringify({ w: thumbImage.thumbWidth, h: thumbImage.thumbHeight })
    );
    check(
      'preview 带原图尺寸',
      thumbImage.width === 256 && thumbImage.height === 256,
      JSON.stringify({ w: thumbImage.width, h: thumbImage.height })
    );
    check(
      'preview 带配色统计',
      thumb.body.stats && Array.isArray(thumb.body.stats.meanRGB) && thumb.body.stats.meanRGB.length === 3,
      JSON.stringify(thumb.body.stats)
    );

    const current = await call('preview', { max: 128 });
    check(
      '不带 path 看当前已打开的图',
      current.body.ok && current.body.image && current.body.image.thumbWidth === 128,
      JSON.stringify(current.body && current.body.image && { w: current.body.image.thumbWidth })
    );
    check('当前图预览标记为 source', current.body.ok && current.body.image.which === 'source', String(current.body.image && current.body.image.which));

    const normalThumb = await call('preview', { which: 'normal', max: 64 });
    check(
      '可以预览已生成的法线图',
      normalThumb.body.ok && normalThumb.body.image && normalThumb.body.image.which === 'normal',
      JSON.stringify(normalThumb.body).slice(0, 160)
    );

    /* ---------------------------------------------------------- 缩略图格式 */
    const jpgThumb = await call('preview', { path: image, max: 96, format: 'jpg' });
    check(
      'preview 可回 JPEG',
      jpgThumb.body.ok &&
        /^\/9j\//.test(jpgThumb.body.image.data) &&
        jpgThumb.body.image.mime === 'image/jpeg' &&
        jpgThumb.body.image.format === 'jpeg',
      JSON.stringify({ mime: jpgThumb.body.image && jpgThumb.body.image.mime, head: String(jpgThumb.body.image && jpgThumb.body.image.data).slice(0, 8) })
    );

    const tiffThumb = await call('preview', { path: image, max: 96, format: 'tiff' });
    const tiffBuf = Buffer.from((tiffThumb.body.image && tiffThumb.body.image.data) || '', 'base64');
    check(
      'preview 可回 TIFF（小端、无压缩、RGB）',
      tiffThumb.body.ok &&
        tiffBuf.slice(0, 4).toString('latin1') === 'II*\u0000' &&
        tiffBuf.readUInt16LE(2) === 42 &&
        tiffThumb.body.image.mime === 'image/tiff',
      JSON.stringify({ head: tiffBuf.slice(0, 4).toString('latin1'), mime: tiffThumb.body.image && tiffThumb.body.image.mime })
    );

    const tgaThumb = await call('preview', { path: image, max: 96, format: 'tga' });
    const tgaBuf = Buffer.from((tgaThumb.body.image && tgaThumb.body.image.data) || '', 'base64');
    check(
      'preview 可回 TGA（未压缩 24 位、顶原点）',
      tgaThumb.body.ok &&
        tgaBuf[2] === 2 &&
        tgaBuf[16] === 24 &&
        tgaBuf[17] === 0x20 &&
        tgaBuf.readUInt16LE(12) === 96 &&
        tgaBuf.readUInt16LE(14) === 96 &&
        tgaBuf.length === 18 + 96 * 96 * 3 &&
        tgaThumb.body.image.mime === 'image/x-targa',
      JSON.stringify({ type: tgaBuf[2], depth: tgaBuf[16], w: tgaBuf.readUInt16LE(12), bytes: tgaBuf.length })
    );

    const badFormat = await call('preview', { format: 'gif' });
    check(
      '未知缩略图格式被拒绝',
      badFormat.body.ok === false && badFormat.body.error.code === 'bad_format',
      JSON.stringify(badFormat.body).slice(0, 160)
    );

    const currentTiff = await call('preview', { max: 64, format: 'tiff' });
    check(
      '当前图也能转成非 PNG 格式',
      currentTiff.body.ok && currentTiff.body.image.format === 'tiff' && currentTiff.body.image.mime === 'image/tiff',
      JSON.stringify(currentTiff.body.image && { f: currentTiff.body.image.format, m: currentTiff.body.image.mime })
    );

    /* ---------------------------------------------------------- 批量预览 */
    const multi = await call('preview_batch', {
      max: 64,
      items: [
        { path: image },
        { path: driver.fixture('height-300x200.png'), format: 'jpg' },
        { path: path.join(os.tmpdir(), 'nmo-missing-preview.png') }
      ]
    });
    const multiBody = multi.body;
    const multiOk = (multiBody.items || []).filter((row) => row.ok);
    check(
      '批量预览一次回多张',
      multiBody.total === 3 && multiBody.succeeded === 2 && multiBody.failed === 1,
      JSON.stringify({ t: multiBody.total, s: multiBody.succeeded, f: multiBody.failed })
    );
    check(
      '每张各自尺寸与统计',
      multiOk.length === 2 &&
        multiOk[0].image.thumbWidth === 64 &&
        multiOk[1].image.thumbWidth === 64 &&
        multiOk[1].image.thumbHeight === 43 &&
        multiOk.every((row) => row.stats && typeof row.stats.meanLuma === 'number'),
      JSON.stringify(
        multiOk.map((r) => ({ w: r.image.thumbWidth, h: r.image.thumbHeight, l: r.stats && r.stats.meanLuma }))
      )
    );
    check(
      '每张可单独指定格式',
      multiOk[1].image.mime === 'image/jpeg' &&
        /^\/9j\//.test(multiOk[1].image.data) &&
        multiOk[0].image.format === 'png',
      JSON.stringify(multiOk.map((r) => r.image.format))
    );
    const multiBad = (multiBody.items || []).filter((row) => !row.ok)[0] || {};
    check(
      '坏路径单独报错，不影响其它张',
      multiBad.index === 2 && multiBad.error && multiBad.error.code === 'file_not_found',
      JSON.stringify(multiBad).slice(0, 200)
    );
    check('批量预览汇总字节数', multiBody.totalBytes > 0, String(multiBody.totalBytes));

    const tooMany = await call('preview_batch', { items: new Array(9).fill({ path: image }) });
    check(
      '批量预览上限 8 张',
      tooMany.body.ok === false && tooMany.body.error.code === 'too_many_items',
      JSON.stringify(tooMany.body).slice(0, 140)
    );

    const badItemFormat = await call('preview_batch', { items: [{ path: image, format: 'gif' }] });
    check(
      '单张坏格式只废那一张',
      badItemFormat.body.ok === false &&
        badItemFormat.body.items[0].error.code === 'bad_format',
      JSON.stringify(badItemFormat.body.items && badItemFormat.body.items[0]).slice(0, 160)
    );

    /* ---------------------------------------------------------- 导出 */
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-agent-'));
    ctx.saveText('agent-export-dir.txt', outDir + '\n');

    const exported = await call('export', { dir: outDir, types: ['normal', 'roughness'] });
    const body = exported.body;
    check('export 成功', body.ok === true, JSON.stringify(body).slice(0, 400));
    check('写出 2 个文件', body.ok && body.written === 2, String(body.written));

    const names = (body.outputs || []).map((f) => f.name).sort();
    check(
      '文件名符合 类别_编号_属性',
      names.length === 2 && /^stone_\d{3,}_Normal\.png$/.test(names[0]) && /^stone_\d{3,}_Roughness\.png$/.test(names[1]),
      names.join(',')
    );

    const normal = (body.outputs || []).filter((f) => /_Normal\.png$/.test(f.name))[0] || {};
    check('文件真的落盘', Boolean(normal.path) && fs.existsSync(normal.path), normal.path);
    check('统计里有宽高', normal.width === 256 && normal.height === 256, normal.width + '×' + normal.height);
    check('统计里有均值与极值', typeof normal.mean === 'number' && typeof normal.min === 'number' && typeof normal.max === 'number', JSON.stringify({ mean: normal.mean, min: normal.min, max: normal.max }));
    check('返回 SHA-256', typeof normal.sha256 === 'string' && normal.sha256.length === 64, String(normal.sha256).slice(0, 16));

    const diskBytes = fs.statSync(normal.path).size;
    check('字节数与磁盘一致', normal.bytes === diskBytes, normal.bytes + ' vs ' + diskBytes);

    /* 同名再导一次：默认保留原文件，不覆盖 */
    const again = await call('export', { dir: outDir, types: ['normal'] });
    check(
      '同名文件默认保留（skipped）',
      again.body.ok && (again.body.skipped === 1 || again.body.written === 1),
      JSON.stringify({ written: again.body.written, skipped: again.body.skipped })
    );

    const notADir = path.join(os.tmpdir(), 'nmo-not-a-dir.png');
    fs.writeFileSync(notADir, 'x');
    const badDir = await call('export', { dir: notADir, types: ['normal'] });
    check('把文件当目录会报错', badDir.body.ok === false && /export_failed/.test(badDir.body.error.code), JSON.stringify(badDir.body).slice(0, 200));

    /* ---------------------------------------------------------- 导出白名单 */
    const outside = path.join(os.tmpdir(), '..', 'nmo-outside-export');
    const outsideExport = await call('export', { dir: outside, types: ['normal'] });
    check(
      '白名单外的导出被拒绝',
      outsideExport.body.ok === false && outsideExport.body.error.code === 'out_of_scope',
      JSON.stringify(outsideExport.body).slice(0, 200)
    );
    const outsideBatch = await call('batch', {
      dir: path.join(os.tmpdir(), '..', 'nmo-outside-batch'),
      types: ['normal'],
      items: [{ path: image, category: 'wood' }]
    });
    check(
      '白名单外的批量被拒绝',
      outsideBatch.body.ok === false && outsideBatch.body.error.code === 'out_of_scope',
      JSON.stringify(outsideBatch.body).slice(0, 200)
    );
    const pingInfo = await call('ping', {});
    check(
      'ping 回明白名单根目录',
      pingInfo.body.ok && typeof pingInfo.body.outDir === 'string' && pingInfo.body.outDir.length > 0,
      JSON.stringify(pingInfo.body && pingInfo.body.outDir)
    );

    /* ---------------------------------------------------------- 批量 */
    const batchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-batch-'));
    const batch = await call('batch', {
      dir: batchDir,
      types: ['normal'],
      items: [
        { path: image, category: 'wood' },
        { path: driver.fixture('height-300x200.png'), category: 'stone' },
        { path: 'D:\\no\\such\\file.png', category: 'wood' }
      ]
    });
    const batchBody = batch.body;
    check(
      'batch 统计总数/成功/失败',
      batchBody.total === 3 && batchBody.succeeded === 2 && batchBody.failed === 1,
      JSON.stringify({ total: batchBody.total, succeeded: batchBody.succeeded, failed: batchBody.failed })
    );
    check('有失败项时整体 ok=false', batchBody.ok === false, String(batchBody.ok));

    const okItems = (batchBody.items || []).filter((row) => row.ok);
    check(
      '两张成功的图各写 1 个文件',
      okItems.length === 2 && okItems.every((row) => row.written === 1),
      JSON.stringify(okItems.map((row) => ({ w: row.written, c: row.category })))
    );
    const batchNames = okItems.reduce((all, row) => all.concat(row.files.map((f) => f.name)), []);
    check(
      '批量按各自类别命名',
      batchNames.some((n) => /^wood_\d{3,}_Normal\.png$/.test(n)) &&
        batchNames.some((n) => /^stone_\d{3,}_Normal\.png$/.test(n)),
      batchNames.join(',')
    );
    check(
      '批量每张都带像素统计与哈希',
      okItems.every((row) =>
        row.files.every((f) => typeof f.mean === 'number' && typeof f.sha256 === 'string' && f.sha256.length === 64)
      ),
      JSON.stringify(okItems.map((row) => row.files.map((f) => ({ m: f.mean, s: String(f.sha256).slice(0, 8) }))))
    );
    check(
      '批量文件真的落盘',
      okItems.every((row) => row.files.every((f) => fs.existsSync(f.path))),
      batchDir
    );
    const badItem = (batchBody.items || []).filter((row) => !row.ok)[0] || {};
    check(
      '失败项标出阶段与错误码',
      badItem.stage === 'read' && badItem.error && badItem.error.code === 'file_not_found',
      JSON.stringify(badItem).slice(0, 200)
    );

    /* ---------------------------------------------------------- 重试与续跑 */
    const notADirRetry = path.join(os.tmpdir(), 'nmo-retry-not-a-dir.png');
    fs.writeFileSync(notADirRetry, 'x');
    const retried = await call('batch', {
      dir: notADirRetry,
      types: ['normal'],
      retry: 1,
      items: [{ path: image, category: 'wood' }]
    });
    check(
      '失败按 retry 重试',
      retried.body.ok === false &&
        retried.body.items[0].attempts === 2 &&
        retried.body.items[0].stage === 'export' &&
        retried.body.items[0].error.code === 'export_failed',
      JSON.stringify(retried.body.items && retried.body.items[0]).slice(0, 240)
    );

    const missingFile = path.join(os.tmpdir(), 'nmo-retry-missing.png');
    const missingRun = await call('batch', {
      dir: outDir,
      retry: 3,
      types: ['normal'],
      items: [{ path: missingFile, category: 'wood' }]
    });
    check(
      '确定性错误不重试',
      missingRun.body.items[0].attempts === 1 &&
        missingRun.body.items[0].error.code === 'file_not_found',
      JSON.stringify(missingRun.body.items[0]).slice(0, 200)
    );

    const resumeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-resume-'));
    const resumeItems = [
      { path: image, category: 'wood' },
      { path: driver.fixture('height-300x200.png'), category: 'stone' }
    ];
    const firstRun = await call('batch', {
      dir: resumeDir,
      types: ['normal'],
      items: resumeItems
    });
    check(
      '续跑前先完整跑一批',
      firstRun.body.ok && firstRun.body.written === 2,
      JSON.stringify({ ok: firstRun.body.ok, written: firstRun.body.written })
    );
    check(
      '续跑账本落盘',
      fs.existsSync(path.join(logDir, 'batch-state.json')),
      path.join(logDir, 'batch-state.json')
    );

    const secondRun = await call('batch', {
      dir: resumeDir,
      types: ['normal'],
      resume: true,
      items: resumeItems
    });
    check(
      'resume 跳过已完成的图',
      secondRun.body.ok &&
        secondRun.body.resumed.skipped === 2 &&
        secondRun.body.written === 0 &&
        secondRun.body.items.every((row) => row.skippedDone === true),
      JSON.stringify(secondRun.body.resumed) + ' written=' + secondRun.body.written
    );
    check(
      '续跑不会重复写文件',
      fs.readdirSync(resumeDir).filter((f) => /\.png$/.test(f)).length === 2,
      fs.readdirSync(resumeDir).join(',')
    );

    /* 1.1.28：items 顺序不参与指纹，反过来也给同一批续跑。 */
    const reversedRun = await call('batch', {
      dir: resumeDir,
      types: ['normal'],
      resume: true,
      items: resumeItems.slice().reverse()
    });
    check(
      'items 换顺序仍认得出同一批',
      reversedRun.body.ok &&
        reversedRun.body.resumed.skipped === 2 &&
        reversedRun.body.written === 0 &&
        reversedRun.body.resumed.fingerprint === secondRun.body.resumed.fingerprint,
      JSON.stringify(reversedRun.body.resumed) + ' written=' + reversedRun.body.written
    );

    /* 1.1.28：显式 batchId —— 中途加图，续跑只补新图。 */
    const bidDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-batchid-'));
    const firstBid = await call('batch', {
      dir: bidDir,
      types: ['normal'],
      batchId: 'nightly',
      items: [{ path: image, category: 'wood' }]
    });
    check(
      'batchId 首批写出 1 张',
      firstBid.body.ok && firstBid.body.written === 1 && firstBid.body.resumed.batchId === 'nightly',
      JSON.stringify({ written: firstBid.body.written, resumed: firstBid.body.resumed })
    );

    const secondBid = await call('batch', {
      dir: bidDir,
      types: ['normal'],
      batchId: 'nightly',
      resume: true,
      items: [
        { path: driver.fixture('height-300x200.png'), category: 'stone' },
        { path: image, category: 'wood' }
      ]
    });
    check(
      'batchId 续跑只补新图',
      secondBid.body.ok &&
        secondBid.body.resumed.skipped === 1 &&
        secondBid.body.written === 1 &&
        secondBid.body.items.filter((row) => row.skippedDone).length === 1,
      JSON.stringify(secondBid.body.resumed) +
        ' written=' +
        secondBid.body.written +
        ' skippedDone=' +
        secondBid.body.skippedDone
    );

    const ledgerJson = JSON.parse(fs.readFileSync(path.join(logDir, 'batch-state.json'), 'utf8'));
    const bidEntry = ledgerJson.batches[secondBid.body.resumed.fingerprint];
    check(
      '账本拆开 lastRun 与 cumulative',
      bidEntry &&
        bidEntry.batchId === 'nightly' &&
        bidEntry.lastRun.skippedDone === 1 &&
        bidEntry.lastRun.written === 1 &&
        bidEntry.cumulative.items === 2 &&
        bidEntry.cumulative.done === 2 &&
        bidEntry.cumulative.written === 2 &&
        bidEntry.summary === undefined,
      JSON.stringify(bidEntry && { lastRun: bidEntry.lastRun, cumulative: bidEntry.cumulative })
    );

    const stateRead = await call('batch_state', { dir: bidDir });
    check(
      'batch_state 查得到这一批',
      stateRead.body.ok &&
        stateRead.body.batches.length === 1 &&
        stateRead.body.batches[0].batchId === 'nightly' &&
        stateRead.body.batches[0].cumulative.written === 2,
      JSON.stringify(stateRead.body).slice(0, 240)
    );

    /* ---------------------------------------------------------- 进度事件 */
    const asyncDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-async-'));
    const asyncBatch = await call('batch', {
      dir: asyncDir,
      types: ['normal'],
      async: true,
      items: [
        { path: image, category: 'wood' },
        { path: driver.fixture('height-300x200.png'), category: 'wood' }
      ]
    });
    check(
      'async 批量立即返回 jobId',
      asyncBatch.body.ok && typeof asyncBatch.body.jobId === 'string' && asyncBatch.body.status === 'running',
      JSON.stringify(asyncBatch.body).slice(0, 200)
    );

    let progress = null;
    for (let i = 0; i < 80; i++) {
      const res = await call('progress', { jobId: asyncBatch.body.jobId, since: 0 });
      progress = res.body;
      if (progress && progress.job && progress.job.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    check(
      'progress 能查到任务结束',
      progress && progress.job && progress.job.status === 'done',
      JSON.stringify(progress && progress.job).slice(0, 240)
    );
    const eventTypes = (progress.events || []).map((e) => e.type);
    check(
      '事件序列含开始/逐张/结束',
      eventTypes[0] === 'job_start' &&
        eventTypes.filter((t) => t === 'item_done').length === 2 &&
        eventTypes[eventTypes.length - 1] === 'job_done',
      eventTypes.join(',')
    );
    check(
      '结束时带完整结果',
      progress.job.result && progress.job.result.succeeded === 2 && progress.job.result.written === 2,
      JSON.stringify(progress.job.result && { s: progress.job.result.succeeded, w: progress.job.result.written })
    );
    check(
      '事件序号严格递增',
      (progress.events || []).every((e, i, arr) => i === 0 || e.seq > arr[i - 1].seq),
      (progress.events || []).map((e) => e.seq).join(',')
    );

    const delta = await call('progress', { jobId: asyncBatch.body.jobId, since: progress.nextSeq });
    check(
      'since 能取增量（无新事件）',
      delta.body.ok && delta.body.events.length === 0 && delta.body.nextSeq === progress.nextSeq,
      JSON.stringify({ len: delta.body.events.length, next: delta.body.nextSeq })
    );

    const eventsNoAuth = await fetch(base + '/events?since=0');
    check('GET /events 也要令牌', eventsNoAuth.status === 401, String(eventsNoAuth.status));
    const eventsOk = await fetch(base + '/events?since=0', {
      headers: { authorization: 'Bearer ' + token }
    });
    const eventsBody = await eventsOk.json();
    check(
      'GET /events 返回事件流',
      eventsOk.status === 200 && Array.isArray(eventsBody.events) && eventsBody.events.length > 0,
      JSON.stringify({ status: eventsOk.status, n: eventsBody.events && eventsBody.events.length })
    );

    /* ---------------------------------------------------------- 取消 */
    const cancelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-cancel-'));
    const cancelBatch = await call('batch', {
      dir: cancelDir,
      types: ['normal', 'roughness'],
      async: true,
      items: [
        { path: image, category: 'wood' },
        { path: driver.fixture('height-300x200.png'), category: 'wood' },
        { path: driver.fixture('height-255x257.png'), category: 'wood' },
        { path: driver.fixture('height-alpha-192.png'), category: 'wood' }
      ]
    });
    check(
      '取消前任务在跑',
      cancelBatch.body.ok && cancelBatch.body.status === 'running',
      JSON.stringify(cancelBatch.body).slice(0, 160)
    );

    /* 只读命令不该排在批量后面：批量跑着时 status 仍要秒回。 */
    const quickStart = Date.now();
    const quickStatus = await call('status');
    const quickMs = Date.now() - quickStart;
    check(
      '批量进行中 status 不被队列阻塞',
      quickStatus.body.ok && quickMs < 3000,
      quickMs + 'ms'
    );

    const cancelRes = await fetch(
      base + '/cancel?jobId=' + encodeURIComponent(cancelBatch.body.jobId),
      { method: 'POST', headers: { authorization: 'Bearer ' + token } }
    );
    const cancelBody = await cancelRes.json();
    check(
      'POST /cancel 接受取消',
      cancelRes.status === 200 && cancelBody.ok && cancelBody.status === 'cancelling',
      JSON.stringify(cancelBody).slice(0, 160)
    );

    let cancelSnap = null;
    for (let i = 0; i < 80; i++) {
      const res = await call('progress', { jobId: cancelBatch.body.jobId, since: 0 });
      cancelSnap = res.body;
      if (cancelSnap.job && cancelSnap.job.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    check(
      '任务以 cancelled 结束',
      cancelSnap.job && cancelSnap.job.status === 'cancelled',
      JSON.stringify(cancelSnap.job).slice(0, 240)
    );
    check(
      '取消后只处理了一部分',
      cancelSnap.job.done < 4 &&
        cancelSnap.job.result &&
        cancelSnap.job.result.cancelled === true &&
        cancelSnap.job.result.notProcessed > 0,
      JSON.stringify(cancelSnap.job.result && { done: cancelSnap.job.done, r: cancelSnap.job.result }).slice(0, 240)
    );
    check(
      '事件流里有 cancel_requested',
      (cancelSnap.events || []).some((e) => e.type === 'cancel_requested'),
      (cancelSnap.events || []).map((e) => e.type).join(',')
    );

    const cancelAgain = await fetch(
      base + '/cancel?jobId=' + encodeURIComponent(cancelBatch.body.jobId),
      { method: 'POST', headers: { authorization: 'Bearer ' + token } }
    );
    const cancelAgainBody = await cancelAgain.json();
    check(
      '取消已完成任务返回 already',
      cancelAgainBody.ok && cancelAgainBody.already === 'finished',
      JSON.stringify(cancelAgainBody)
    );

    /* ---------------------------------------------------------- 发现文件 */
    const discovery = path.join(outDir, 'agent.json');
    writeDiscoveryFile(discovery, { port: server.port, token: token, pid: process.pid });
    const doc = JSON.parse(fs.readFileSync(discovery, 'utf8'));
    check('发现文件可读且含端口/令牌', doc.port === server.port && doc.token === token, JSON.stringify({ port: doc.port }));
    removeDiscoveryFile(discovery);
    check('发现文件可删除', !fs.existsSync(discovery), discovery);

    /* ---------------------------------------------------------- 窗口 */
    const hidden = await call('window', { show: false });
    check('window 命令能隐藏窗口', hidden.body.ok && ctx.win.isVisible() === false, JSON.stringify(hidden.body));
    const shown = await call('window', { show: true });
    check('window 命令能显示窗口', shown.body.ok && ctx.win.isVisible() === true, JSON.stringify(shown.body));

    /* ---------------------------------------------------------- 审计日志 */
    const logRes = await call('log', { lines: 200 });
    const logBody = logRes.body;
    check(
      'log 命令返回最近命令',
      logBody.ok && logBody.enabled && Array.isArray(logBody.entries) && logBody.entries.length >= 5,
      JSON.stringify({ ok: logBody.ok, enabled: logBody.enabled, n: logBody.entries && logBody.entries.length })
    );
    const loggedCmds = (logBody.entries || []).map((e) => e.cmd);
    check(
      '审计覆盖预览/导出/批量',
      loggedCmds.indexOf('preview') !== -1 &&
        loggedCmds.indexOf('export') !== -1 &&
        loggedCmds.indexOf('batch') !== -1,
      loggedCmds.join(',')
    );
    check(
      '审计不记录 ping 与 log 自己',
      loggedCmds.indexOf('ping') === -1 && loggedCmds.indexOf('log') === -1,
      loggedCmds.join(',')
    );
    const logLines = fs.existsSync(logBody.file) ? fs.readFileSync(logBody.file, 'utf8').split('\n').filter(Boolean) : [];
    check(
      '每行都是合法 JSON 且带时间/命令/结果',
      logLines.length >= 5 &&
        logLines.every((line) => {
          try {
            const entry = JSON.parse(line);
            return typeof entry.at === 'string' && typeof entry.cmd === 'string' && entry.result && typeof entry.result.ok === 'boolean';
          } catch {
            return false;
          }
        }),
      String(logLines.length)
    );
    check(
      '审计文件不含图片内容',
      logLines.length > 0 && !/iVBORw0KGgo/.test(logLines.join('\n')),
      String(logLines.join('\n').length)
    );
    const previewEntry = (logBody.entries || []).filter((e) => e.cmd === 'preview')[0] || {};
    check(
      '审计里 preview 只留元数据',
      previewEntry.result &&
        previewEntry.result.image &&
        previewEntry.result.image.data === undefined &&
        typeof previewEntry.result.image.name === 'string',
      JSON.stringify(previewEntry.result && previewEntry.result.image).slice(0, 200)
    );
    const resultEntry = (logBody.entries || []).filter((e) => e.cmd === 'batch_result')[0] || {};
    check(
      '后台批量的结果也进审计',
      resultEntry.result &&
        typeof resultEntry.result.written === 'number' &&
        typeof resultEntry.result.succeeded === 'number',
      JSON.stringify(resultEntry).slice(0, 240)
    );

    check(
      '命令层会通知活动（徽标/托盘）',
      activities.some((a) => a.cmd === 'export' && a.ok !== false) &&
        activities.some((a) => a.cmd === 'batch' && a.done === true),
      JSON.stringify(activities.slice(-6))
    );

    /* 页面侧徽标：模拟主进程推送，确认它真的显示出来。 */
    ctx.win.webContents.send('nmo:agent-activity', { cmd: 'export', ok: true, finished: true });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const badge = await ctx.win.webContents.executeJavaScript(
      "(function(){var e=document.getElementById('nmo_agent_badge');return e?{text:e.textContent,cls:e.className}:null;})()"
    );
    check(
      '页面徽标显示 AI 活动',
      badge && /AI · export/.test(badge.text) && /nmo_agent_badge_visible/.test(badge.cls),
      JSON.stringify(badge)
    );
    ctx.win.webContents.send('nmo:agent-activity', { state: 'stopped' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const badgeOff = await ctx.win.webContents.executeJavaScript(
      "(function(){var e=document.getElementById('nmo_agent_badge');return e?{text:e.textContent,cls:e.className}:null;})()"
    );
    check('Agent 停止后徽标隐藏', badgeOff && !/nmo_agent_badge_visible/.test(badgeOff.cls), JSON.stringify(badgeOff));
  } finally {
    await server.close();
  }

  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无未预期的控制台错误', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'agent',
    port: server.port,
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
