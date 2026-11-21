'use strict';

/*
 * mcp.spec.js — 1.1.17 MCP 适配器。
 *
 * 用一个假的 Agent HTTP 服务当后端，验证适配器本身：
 *   - initialize / tools/list / tools/call 的协议形状；
 *   - 工具名与参数映射到正确的命令（含批量导出、单张/批量预览的 image 内容块）；
 *   - 后端返回 ok:false 时 isError=true；
 *   - 批量异步任务、进度通知与命令审计；
 *   - 后端没启动时给出可执行的提示；
 *   - 每次请求都带 Bearer 令牌；
 *   - 未知方法返回 -32601。
 *
 * 不需要真的启动 NormalMap 窗口，跑得快也不会碰编号库。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const MCP = path.join(__dirname, '..', '..', 'mcp', 'normalmap-mcp.js');

function startClient(agentFile) {
  const env = { ...process.env, NMO_AGENT_FILE: agentFile, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_OPTIONS;

  const child = spawn(process.execPath, [MCP], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  const notifications = [];
  let seq = 0;
  let stderr = '';

  readline.createInterface({ input: child.stdout, terminal: false }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined && message.method) {
      notifications.push(message);
      return;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve(message);
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  function request(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('MCP 响应超时：' + method));
      }, 10000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params }) + '\n');
    });
  }

  function close() {
    return new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        resolve();
      }, 2000);
    });
  }

  return { request: request, close: close, log: () => stderr, notifications: notifications };
}

function textOf(message) {
  try {
    const blocks = message.result.content || [];
    const text = blocks.filter((b) => b.type === 'text')[0];
    return text ? JSON.parse(text.text) : null;
  } catch {
    return null;
  }
}

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  const token = 'mcp-spec-token';
  const seen = [];
  let progressPolls = 0;
  const backend = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        /* ignore */
      }
      seen.push({ cmd: payload.cmd, args: payload.args || {}, auth: req.headers.authorization });

      let reply;
      if (payload.cmd === 'status') {
        reply = { ok: true, category: 'wood', nextNumber: 3, image: { name: 'x', size: { width: 256, height: 256 } } };
      } else if (payload.cmd === 'categories') {
        reply = {
          ok: true,
          current: 'wood',
          count: 2,
          categories: [
            { value: 'wood', label: '木材', nextNumber: 4, preset: { base: 0.62, strength: 0.55, metal: 'none' } },
            { value: 'stone', label: '石材', nextNumber: 1, preset: { base: 0.75, strength: 0.55, metal: 'none' } }
          ]
        };
      } else if (payload.cmd === 'preview') {
        reply = {
          ok: true,
          image: {
            name: 'wood.png',
            mime: 'image/png',
            which: 'source',
            width: 1024,
            height: 1024,
            thumbWidth: 512,
            thumbHeight: 512,
            data: 'iVBORw0KGgoAAAANSUhEUg=='
          },
          stats: { meanRGB: [120, 96, 72], meanLuma: 102.4, meanSaturation: 0.41, sampledAt: '512×512' }
        };
      } else if (payload.cmd === 'log') {
        reply = {
          ok: true,
          enabled: true,
          file: 'C:////Users////x////AppData////Roaming////NormalMap Desktop\\agent-log.jsonl',
          bytes: 1234,
          total: 2,
          entries: [
            { at: '2026-11-19T10:00:00.000Z', cmd: 'preview', ms: 42, args: { max: 384 }, result: { ok: true, image: { name: 'a.png', thumbWidth: 384, thumbHeight: 288 } } },
            { at: '2026-11-19T10:00:01.000Z', cmd: 'export', ms: 900, args: { dir: 'D:////out' }, result: { ok: true, written: 2 } }
          ]
        };
      } else if (payload.cmd === 'preview_batch') {
        reply = {
          ok: false,
          total: 3,
          succeeded: 2,
          failed: 1,
          max: 384,
          format: 'png',
          totalBytes: 4096,
          items: [
            {
              index: 0,
              ok: true,
              image: {
                name: 'a.png',
                mime: 'image/png',
                format: 'png',
                which: 'source',
                width: 1024,
                height: 1024,
                thumbWidth: 384,
                thumbHeight: 384,
                data: 'iVBORw0KGgoAAAANSUhEUg=='
              },
              stats: { meanRGB: [120, 96, 72], meanLuma: 102.4, meanSaturation: 0.41 }
            },
            {
              index: 1,
              ok: true,
              image: {
                name: 'b.jpg',
                mime: 'image/jpeg',
                format: 'jpeg',
                which: 'source',
                width: 512,
                height: 512,
                thumbWidth: 384,
                thumbHeight: 384,
                data: '/9j/4AAQSkZJRg=='
              },
              stats: { meanRGB: [90, 90, 90], meanLuma: 90, meanSaturation: 0.05 }
            },
            { index: 2, ok: false, path: 'D:\\in\\missing.png', error: { code: 'file_not_found', message: '找不到文件' } }
          ]
        };
      } else if (payload.cmd === 'open_image') {
        reply = { ok: true, category: payload.args.category || 'wood', image: { name: 'x', size: { width: 256, height: 256 } } };
      } else if (payload.cmd === 'set_category' && payload.args.category === 'stone') {
        reply = { ok: false, error: { code: 'unknown_category', message: '没有这个类别：stone' } };
      } else if (payload.cmd === 'cancel') {
        reply = { ok: true, jobId: payload.args.jobId || 'job-1', status: 'cancelling' };
      } else if (payload.cmd === 'export') {
        reply = {
          ok: true,
          written: 1,
          outputs: [{ name: 'wood_001_Normal.png', path: 'D:\\out\\wood_001_Normal.png', mean: 128 }]
        };
      } else if (payload.cmd === 'batch') {
        if (payload.args.async) {
          reply = {
            ok: true,
            jobId: 'job-1',
            status: 'running',
            total: payload.args.items.length,
            poll: 'progress'
          };
        } else {
          reply = {
            ok: payload.args.items.length === 2,
            dir: 'D:\\out',
            total: payload.args.items.length,
            succeeded: 2,
            failed: 0,
            written: 2,
            skipped: 0,
            items: payload.args.items.map((row, i) => ({
              path: row.path,
              name: row.path.split('\\').pop(),
              category: row.category || 'wood',
              ok: true,
              written: 1,
              files: [{ name: (row.category || 'wood') + '_00' + (i + 1) + '_Normal.png', mean: 120 }]
            }))
          };
        }
      } else if (payload.cmd === 'progress') {
        if (!payload.args.since) {
          reply = {
            ok: true,
            job: { id: 'job-1', kind: 'batch', status: 'running', total: 2, done: 1, failed: 0 },
            events: [
              { seq: 1, jobId: 'job-1', type: 'job_start', total: 2 },
              { seq: 2, jobId: 'job-1', type: 'item_done', index: 1, done: 1, total: 2, name: 'a.png', ok: true }
            ],
            nextSeq: 2
          };
        } else {
          reply = {
            ok: true,
            job: {
              id: 'job-1',
              kind: 'batch',
              status: 'done',
              total: 2,
              done: 2,
              failed: 0,
              result: { ok: true, total: 2, succeeded: 2, failed: 0, written: 2, items: [] }
            },
            events: [
              { seq: 3, jobId: 'job-1', type: 'item_done', index: 2, done: 2, total: 2, name: 'b.png', ok: true },
              { seq: 4, jobId: 'job-1', type: 'job_done', done: 2, failed: 0, status: 'done' }
            ],
            nextSeq: 4
          };
        }
      } else if (payload.cmd === 'batch_state') {
        reply = {
          ok: true,
          file: 'C:\\Users\\x\\AppData\\Roaming\\NormalMap Desktop\\batch-state.json',
          total: 1,
          batches: [
            {
              fingerprint: 'abc123def4567890',
              batchId: 'nightly-01',
              status: 'partial',
              dir: 'D:\\out',
              types: ['normal'],
              lastRun: { total: 2, succeeded: 1, failed: 1, skippedDone: 0, written: 1, ms: 1200 },
              cumulative: { items: 2, done: 1, failed: 1, written: 1, attempts: 2 }
            }
          ]
        };
      } else {
        reply = { ok: true };
      }
      const body = Buffer.from(JSON.stringify(reply), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': body.length });
      res.end(body);
    });
  });

  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-mcp-spec-'));
  const agentFile = path.join(dir, 'agent.json');
  fs.writeFileSync(
    agentFile,
    JSON.stringify({
      product: 'NormalMap Desktop',
      version: '1.1.17-test',
      port: backend.address().port,
      token: token
    })
  );

  const client = startClient(agentFile);
  let emptyClient = null;

  try {
    const init = await client.request('initialize', { protocolVersion: '2024-11-05' });
    check('initialize 返回协议版本', init.result && init.result.protocolVersion === '2024-11-05', JSON.stringify(init.result));
    check(
      '服务器名与版本正确',
      init.result && init.result.serverInfo.name === 'normalmap-desktop' && init.result.serverInfo.version === '1.1.17-test',
      JSON.stringify(init.result && init.result.serverInfo)
    );
    check('声明 tools 能力', Boolean(init.result && init.result.capabilities.tools), JSON.stringify(init.result && init.result.capabilities));

    const list = await client.request('tools/list', {});
    const tools = (list.result && list.result.tools) || [];
    const names = tools.map((t) => t.name).sort();
    check(
      '十四个工具都在',
      names.length === 14 &&
        names.join(',') ===
          'normalmap_batch_cancel,normalmap_batch_export,normalmap_batch_progress,normalmap_batch_state,normalmap_export,normalmap_list_categories,normalmap_log,normalmap_open_image,normalmap_preview,normalmap_preview_batch,normalmap_quit,normalmap_set_category,normalmap_status,normalmap_window',
      names.join(',')
    );
    check(
      '工具带 inputSchema',
      tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'),
      JSON.stringify(tools.map((t) => t.name))
    );

    const status = await client.request('tools/call', { name: 'normalmap_status', arguments: {} });
    const statusText = textOf(status);
    check('status 调用成功', statusText && statusText.ok === true, JSON.stringify(status.result).slice(0, 200));
    check('status 结果里带类别', statusText && statusText.category === 'wood', JSON.stringify(statusText).slice(0, 120));

    const opened = await client.request('tools/call', {
      name: 'normalmap_open_image',
      arguments: { path: 'D:\\in\\wood.png', category: 'stone' }
    });
    const openedText = textOf(opened);
    check('open_image 映射到命令', openedText && openedText.ok && openedText.category === 'stone', JSON.stringify(openedText).slice(0, 160));

    const categories = await client.request('tools/call', { name: 'normalmap_list_categories', arguments: {} });
    const categoriesText = textOf(categories);
    check(
      'list_categories 映射到 categories',
      categoriesText && categoriesText.ok && categoriesText.categories.length === 2,
      JSON.stringify(categoriesText).slice(0, 160)
    );
    check(
      '类别清单保留中文标签',
      categoriesText && categoriesText.categories[0].label === '木材',
      JSON.stringify(categoriesText && categoriesText.categories[0])
    );

    const preview = await client.request('tools/call', {
      name: 'normalmap_preview',
      arguments: { path: 'D:\\in\\wood.png', max: 512, format: 'jpeg', quality: 80 }
    });
    const blocks = (preview.result && preview.result.content) || [];
    check(
      'preview 返回 MCP image 内容',
      blocks[0] && blocks[0].type === 'image' && blocks[0].mimeType === 'image/png' && blocks[0].data.startsWith('iVBOR'),
      JSON.stringify(blocks.map((b) => b.type))
    );
    const previewMeta = textOf(preview);
    check(
      'preview 文本块带尺寸与统计',
      previewMeta && previewMeta.image.width === 1024 && previewMeta.stats.meanRGB.length === 3,
      JSON.stringify(previewMeta).slice(0, 200)
    );
    check(
      'preview 不在文本里重复 base64',
      previewMeta && previewMeta.image && previewMeta.image.data === undefined,
      JSON.stringify(previewMeta && previewMeta.image)
    );
    check(
      'preview 的 format/quality 原样转发',
      seen.some((r) => r.cmd === 'preview' && r.args.format === 'jpeg' && r.args.quality === 80),
      JSON.stringify(seen.filter((r) => r.cmd === 'preview'))
    );

    const previewBatch = await client.request('tools/call', {
      name: 'normalmap_preview_batch',
      arguments: {
        max: 384,
        items: [
          { path: 'D:\\in\\a.png' },
          { path: 'D:\\in\\b.jpg', format: 'jpg' },
          { path: 'D:\\in\\missing.png' }
        ]
      }
    });
    const multiContent = previewBatch.result.content || [];
    const imageBlocks = multiContent.filter((c) => c.type === 'image');
    const multiMeta = textOf(previewBatch);
    check(
      '批量预览回多个 image 块',
      imageBlocks.length === 2 &&
        imageBlocks[0].mimeType === 'image/png' &&
        imageBlocks[1].mimeType === 'image/jpeg',
      JSON.stringify(imageBlocks.map((b) => b.mimeType))
    );
    check(
      '批量预览的文本块不带 base64',
      multiMeta && multiMeta.items.every((row) => !row.image || row.image.data === undefined),
      JSON.stringify(multiMeta && multiMeta.items.map((row) => row.image && row.image.data))
    );
    check(
      'imageOrder 标出图块对应的下标',
      multiMeta && Array.isArray(multiMeta.imageOrder) && multiMeta.imageOrder.join(',') === '0,1',
      JSON.stringify(multiMeta && multiMeta.imageOrder)
    );
    check(
      '批量预览参数原样转发',
      seen.some(
        (r) =>
          r.cmd === 'preview_batch' &&
          r.args.max === 384 &&
          r.args.items.length === 3 &&
          r.args.items[1].format === 'jpg'
      ),
      JSON.stringify(seen.filter((r) => r.cmd === 'preview_batch'))
    );

    const logCall = await client.request('tools/call', {
      name: 'normalmap_log',
      arguments: { lines: 5 }
    });
    const logText = textOf(logCall);
    check(
      'log 工具透传审计记录',
      logText && logText.ok && logText.enabled && logText.entries.length === 2 && logText.entries[1].cmd === 'export',
      JSON.stringify(logText && { n: logText.entries && logText.entries.length, last: logText.entries && logText.entries[1] })
    );
    check(
      'log 工具不夹带图片内容',
      logText && JSON.stringify(logText).indexOf('iVBOR') === -1,
      JSON.stringify(logText).slice(0, 160)
    );
    check(
      'log 的 lines 参数原样转发',
      seen.some((r) => r.cmd === 'log' && r.args.lines === 5),
      JSON.stringify(seen.filter((r) => r.cmd === 'log'))
    );

    const exported = await client.request('tools/call', {
      name: 'normalmap_export',
      arguments: { dir: 'D:\\out', types: ['normal', 'roughness'] }
    });
    const exportedText = textOf(exported);
    check('export 结果透传', exportedText && exportedText.written === 1, JSON.stringify(exportedText).slice(0, 160));

    const batch = await client.request('tools/call', {
      name: 'normalmap_batch_export',
      arguments: {
        dir: 'D:\\out',
        types: ['normal'],
        retry: 1,
        resume: true,
        batchId: 'nightly-01',
        items: [
          { path: 'D:\\in\\a.png', category: 'wood' },
          { path: 'D:\\in\\b.png', category: 'stone' }
        ]
      }
    });
    const batchText = textOf(batch);
    check(
      'batch 结果透传',
      batchText && batchText.total === 2 && batchText.items.length === 2,
      JSON.stringify(batchText).slice(0, 200)
    );
    check(
      'batch 保留每张的类别与文件名',
      batchText && batchText.items[1].category === 'stone' && /stone_/.test(batchText.items[1].files[0].name),
      JSON.stringify(batchText && batchText.items[1]).slice(0, 160)
    );
    check(
      'batch 的参数原样转发',
      seen.some(
        (r) =>
          r.cmd === 'batch' &&
          Array.isArray(r.args.items) &&
          r.args.items.length === 2 &&
          r.args.items[0].category === 'wood'
      ),
      JSON.stringify(seen.filter((r) => r.cmd === 'batch'))
    );
    check(
      'batch 的 retry/resume/batchId 原样转发',
      seen.some(
        (r) =>
          r.cmd === 'batch' &&
          r.args.retry === 1 &&
          r.args.resume === true &&
          r.args.batchId === 'nightly-01'
      ),
      JSON.stringify(
        seen
          .filter((r) => r.cmd === 'batch')
          .map((r) => ({ retry: r.args.retry, resume: r.args.resume, batchId: r.args.batchId }))
      )
    );

    const ledgerCall = await client.request('tools/call', {
      name: 'normalmap_batch_state',
      arguments: { limit: 5, dir: 'D:\\out' }
    });
    const ledgerText = textOf(ledgerCall);
    check(
      'batch_state 回账本统计',
      ledgerText &&
        ledgerText.ok &&
        ledgerText.batches.length === 1 &&
        ledgerText.batches[0].batchId === 'nightly-01' &&
        ledgerText.batches[0].lastRun.written === 1 &&
        ledgerText.batches[0].cumulative.written === 1,
      JSON.stringify(ledgerText).slice(0, 240)
    );
    check(
      'batch_state 参数原样转发',
      seen.some((r) => r.cmd === 'batch_state' && r.args.limit === 5 && r.args.dir === 'D:\\out'),
      JSON.stringify(seen.filter((r) => r.cmd === 'batch_state'))
    );

    const asyncBatch = await client.request('tools/call', {
      name: 'normalmap_batch_export',
      arguments: {
        dir: 'D:\\out',
        async: true,
        items: [
          { path: 'D:\\in\\a.png', category: 'wood' },
          { path: 'D:\\in\\b.png', category: 'stone' }
        ]
      }
    });
    const asyncText = textOf(asyncBatch);
    check(
      'async 批量立即返回 jobId',
      asyncText && asyncText.jobId === 'job-1' && asyncText.status === 'running',
      JSON.stringify(asyncText).slice(0, 160)
    );
    check(
      'async 标记原样转发',
      seen.some((r) => r.cmd === 'batch' && r.args.async === true),
      JSON.stringify(seen.filter((r) => r.cmd === 'batch').map((r) => r.args.async))
    );

    const prog = await client.request('tools/call', {
      name: 'normalmap_batch_progress',
      arguments: { jobId: 'job-1', since: 0 }
    });
    const progText = textOf(prog);
    check(
      'batch_progress 映射到 progress',
      progText && progText.job && progText.job.status === 'running' && progText.nextSeq === 2,
      JSON.stringify(progText).slice(0, 160)
    );
    check(
      'progress 参数原样转发',
      seen.some((r) => r.cmd === 'progress' && r.args.jobId === 'job-1' && r.args.since === 0),
      JSON.stringify(seen.filter((r) => r.cmd === 'progress'))
    );

    const withProgress = await client.request('tools/call', {
      name: 'normalmap_batch_export',
      arguments: {
        dir: 'D:\\out',
        items: [
          { path: 'D:\\in\\a.png', category: 'wood' },
          { path: 'D:\\in\\b.png', category: 'stone' }
        ]
      },
      _meta: { progressToken: 'tok-1' }
    });
    const withProgressText = textOf(withProgress);
    check(
      '带进度令牌时返回最终结果',
      withProgressText && withProgressText.succeeded === 2 && withProgressText.written === 2,
      JSON.stringify(withProgressText).slice(0, 160)
    );
    const progresses = client.notifications.filter((n) => n.method === 'notifications/progress');
    check(
      '发了 MCP 进度通知',
      progresses.length === 2 &&
        progresses.every((n) => n.params.progressToken === 'tok-1') &&
        progresses[progresses.length - 1].params.progress === 2,
      JSON.stringify(progresses).slice(0, 300)
    );

    const cancelCall = await client.request('tools/call', {
      name: 'normalmap_batch_cancel',
      arguments: { jobId: 'job-1' }
    });
    const cancelText = textOf(cancelCall);
    check(
      'batch_cancel 映射到 cancel',
      cancelText && cancelText.ok && cancelText.status === 'cancelling',
      JSON.stringify(cancelText).slice(0, 160)
    );
    check(
      'cancel 参数原样转发',
      seen.some((r) => r.cmd === 'cancel' && r.args.jobId === 'job-1'),
      JSON.stringify(seen.filter((r) => r.cmd === 'cancel'))
    );

    const failed = await client.request('tools/call', {
      name: 'normalmap_set_category',
      arguments: { category: 'stone' }
    });
    check('后端错误翻译成 isError', failed.result && failed.result.isError === true, JSON.stringify(failed.result).slice(0, 160));
    check(
      '错误码保留在文本里',
      textOf(failed) && textOf(failed).error && textOf(failed).error.code === 'unknown_category',
      JSON.stringify(textOf(failed)).slice(0, 160)
    );

    const unknown = await client.request('tools/nope', {});
    check('未知方法返回 -32601', unknown.error && unknown.error.code === -32601, JSON.stringify(unknown.error));

    check('每个请求都带 Bearer 令牌', seen.length >= 4 && seen.every((row) => row.auth === 'Bearer ' + token), seen.map((r) => r.cmd).join(','));
    check(
      '参数原样转发',
      seen.some((r) => r.cmd === 'export' && Array.isArray(r.args.types) && r.args.types.join(',') === 'normal,roughness'),
      JSON.stringify(seen.filter((r) => r.cmd === 'export'))
    );
    check('open_image 路径未被改写', seen.some((r) => r.cmd === 'open_image' && r.args.path === 'D:\\in\\wood.png'), JSON.stringify(seen.filter((r) => r.cmd === 'open_image')));

    /* 后端没启动：握手仍成功，调用工具给出“先启动”的提示 */
    const missingFile = path.join(dir, 'nope.json');
    emptyClient = startClient(missingFile);
    const init2 = await emptyClient.request('initialize', {});
    check('没有令牌文件也能握手', Boolean(init2.result && init2.result.serverInfo), JSON.stringify(init2.result).slice(0, 120));
    const noAgent = await emptyClient.request('tools/call', { name: 'normalmap_status', arguments: {} });
    const noAgentText = noAgent.result && noAgent.result.content && noAgent.result.content[0].text;
    check('没启动时提示先启动', noAgent.result && noAgent.result.isError === true && /找不到 Agent 令牌文件/.test(noAgentText), String(noAgentText).slice(0, 160));
  } finally {
    await client.close();
    if (emptyClient) await emptyClient.close();
    await new Promise((resolve) => backend.close(resolve));
  }

  return {
    ok: failures.length === 0,
    spec: 'mcp',
    tools: 14,
    calls: seen.length,
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
