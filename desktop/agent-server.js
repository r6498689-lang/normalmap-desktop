'use strict';

/*
 * agent-server.js — 本机 Agent 桥（1.1.16）
 *
 * 只监听 127.0.0.1，只认 Bearer 令牌，只转发白名单命令。
 * 不提供静态文件、不接受任意 JS、不做 CORS。
 *
 * 端点：
 *   GET  /health    → 进程与窗口状态
 *   GET  /events    → 批量任务进度（?since=N&jobId=…）
 *   POST /cancel    → 请求取消批量任务（?jobId=…）
 *   POST /command   → {"cmd":"open_image","args":{...}}
 *
 * /events 与 /cancel 不进命令队列：批量正阻塞在队列里跑时，它们照样能立刻生效，
 * 这正是“边跑边看、随时叫停”的关键。
 *
 * 令牌由主进程生成，写在 userData/agent.json 里（含端口、PID），
 * 同一个文件也是客户端发现端口的入口。
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function isLoopback(address) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    // 某些 Windows 版本把回环映射成这个地址
    address === '::ffff:7f00:1'
  );
}

function tokenMatches(header, token) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  if (!match) return false;
  const given = Buffer.from(match[1], 'utf8');
  const expected = Buffer.from(token, 'utf8');
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体超过 1 MB。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function startAgentServer(options) {
  const commands = options.commands;
  const token = options.token;
  const host = options.host || '127.0.0.1';
  const port = Number.isInteger(options.port) ? options.port : 0;

  /* 一次只跑一个会改状态的命令：两个 export 并发会互相抢编号。 */
  let chain = Promise.resolve();
  function enqueue(fn) {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  }

  /*
   * 只读命令不进队列：批量阻塞时，用户还得能查状态、看日志、预览磁盘图。
   * 会画布/会改状态的（open_image / set_category / export / batch）继续串行。
   */
  const READ_ONLY_COMMANDS = new Set([
    'ping',
    'status',
    'categories',
    'log',
    'progress',
    'batch_state'
  ]);
  function isReadOnly(cmd, args) {
    if (READ_ONLY_COMMANDS.has(cmd)) return true;
    if (cmd === 'preview' && args && args.path) return true;
    if (cmd === 'preview_batch') return true;
    return false;
  }

  const server = http.createServer(async (req, res) => {
    if (!isLoopback(req.socket.remoteAddress)) {
      sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '只接受本机连接。' } });
      return;
    }
    if (!tokenMatches(req.headers.authorization, token)) {
      sendJson(res, 401, {
        ok: false,
        error: { code: 'unauthorized', message: '缺少或错误的 Bearer 令牌。' }
      });
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/health') {
      const result = await commands.run('ping', {});
      sendJson(res, result.ok ? 200 : 500, result);
      return;
    }

    /* 进度查询刻意绕开 enqueue：阻塞中的批量任务不该挡住它。 */
    if (req.method === 'GET' && url.pathname === '/events') {
      if (!commands.jobs || typeof commands.jobs.snapshot !== 'function') {
        sendJson(res, 404, {
          ok: false,
          error: { code: 'not_supported', message: '这个实例没有任务记录。' }
        });
        return;
      }
      sendJson(
        res,
        200,
        commands.jobs.snapshot({
          jobId: url.searchParams.get('jobId') || undefined,
          since: url.searchParams.get('since') || 0
        })
      );
      return;
    }

    /* 取消同样绕开队列：阻塞中的批量正占着队列，排队等它等于永远等不到。 */
    if (req.method === 'POST' && url.pathname === '/cancel') {
      if (!commands.jobs || typeof commands.jobs.requestCancel !== 'function') {
        sendJson(res, 404, {
          ok: false,
          error: { code: 'not_supported', message: '这个实例没有任务记录。' }
        });
        return;
      }
      sendJson(res, 200, commands.jobs.requestCancel(url.searchParams.get('jobId') || undefined));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/command') {
      let payload;
      try {
        const text = await readBody(req);
        payload = JSON.parse(text || '{}');
      } catch (err) {
        sendJson(res, 400, {
          ok: false,
          error: { code: 'bad_json', message: (err && err.message) || '请求体不是 JSON。' }
        });
        return;
      }

      const cmd = payload && payload.cmd;
      const args = (payload && payload.args) || {};
      let result;
      try {
        result = isReadOnly(cmd, args)
          ? await commands.run(cmd, args)
          : await enqueue(() => commands.run(cmd, args));
      } catch (err) {
        result = {
          ok: false,
          error: { code: 'command_failed', message: (err && err.message) || String(err) }
        };
      }
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: { code: 'not_found', message: '只支持 GET /health、GET /events、POST /cancel 与 POST /command。' }
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        host: host,
        port: address.port,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          })
      });
    });
  });
}

function writeDiscoveryFile(filePath, info) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(info, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* Windows 上 chmod 基本无效，文件本来就在用户目录 */
  }
}

function removeDiscoveryFile(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    /* 删不掉也不影响下次启动覆盖 */
  }
}

module.exports = { startAgentServer, writeDiscoveryFile, removeDiscoveryFile };
