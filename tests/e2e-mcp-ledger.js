'use strict';

/*
 * e2e-mcp-ledger.js — 1.1.28 真链路：MCP 适配器（部署目录里的那份）
 * 对着真实的 --agent 实例，验证第十四号工具 normalmap_batch_state
 * 与 batch 的 batchId 字段确实能打通。
 *
 * 用法：node tests/e2e-mcp-ledger.js --exe="D:\...\NormalMap Desktop.exe"
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const readline = require('node:readline');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const exe = path.resolve(arg('exe', path.join(__dirname, '..', 'dist', 'NormalMap Desktop-1.2.0-win32-x64', 'NormalMap Desktop.exe')));
const mcpScript = path.join(path.dirname(exe), 'mcp', 'normalmap-mcp.js');
const port = Number(arg('port', 47356));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(agentFile, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const info = JSON.parse(fs.readFileSync(agentFile, 'utf8'));
      if (info.token) {
        const ok = await new Promise((resolve) => {
          const req = http.get(
            { host: '127.0.0.1', port: port, path: '/health', headers: { Authorization: 'Bearer ' + info.token } },
            (res) => {
              res.resume();
              res.on('end', () => resolve(res.statusCode === 200));
            }
          );
          req.on('error', () => resolve(false));
        });
        if (ok) return info;
      }
    } catch {
      /* 还没写 */
    }
    await sleep(250);
  }
  throw new Error('等不到 Agent 就绪：' + agentFile);
}

function startClient(agentFile) {
  const env = { ...process.env, NMO_AGENT_FILE: agentFile, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_OPTIONS;
  const child = spawn(process.execPath, [mcpScript], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let seq = 0;
  readline.createInterface({ input: child.stdout, terminal: false }).on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const done = pending.get(msg.id);
      pending.delete(msg.id);
      done(msg);
    }
  });
  function request(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP 超时：' + method)), 120000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params }) + '\n');
    });
  }
  return {
    request: request,
    close: () =>
      new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill();
        setTimeout(resolve, 1500);
      })
  };
}

function textOf(message) {
  try {
    const block = (message.result.content || []).filter((b) => b.type === 'text')[0];
    return block ? JSON.parse(block.text) : null;
  } catch {
    return null;
  }
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-mcp-ledger-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-mcp-ledger-out-'));
  const agentFile = path.join(profile, 'agent.json');
  const report = { ok: false, profile: profile, outDir: outDir, mcpScript: mcpScript, steps: [] };
  const check = (label, ok, detail) => report.steps.push({ label: label, ok: Boolean(ok), detail: detail });
  let app = null;
  let client = null;

  try {
    app = spawn(exe, ['--agent', '--agent-port=' + port, '--profile=' + profile], {
      stdio: 'ignore',
      windowsHide: true
    });
    await waitReady(agentFile, 60000);
    report.mcpScriptExists = fs.existsSync(mcpScript);
    if (!report.mcpScriptExists) throw new Error('部署目录里没有 mcp/normalmap-mcp.js');

    client = startClient(agentFile);
    const init = await client.request('initialize', { protocolVersion: '2024-11-05' });
    check('部署版 MCP 握手带版本', init.result && init.result.serverInfo && init.result.serverInfo.version === '1.1.34', init.result && init.result.serverInfo);

    const list = await client.request('tools/list', {});
    const names = ((list.result && list.result.tools) || []).map((t) => t.name).sort();
    check('部署版 MCP 有 14 个工具', names.length === 14 && names.indexOf('normalmap_batch_state') !== -1, names.join(','));

    const empty = await client.request('tools/call', { name: 'normalmap_batch_state', arguments: {} });
    const emptyText = textOf(empty);
    check('空账本也能查', emptyText && emptyText.ok === true && Array.isArray(emptyText.batches), JSON.stringify(emptyText).slice(0, 160));

    const image = path.join(ROOT, 'tests', 'fixtures', 'height-bumps-256.png');
    const batch = await client.request('tools/call', {
      name: 'normalmap_batch_export',
      arguments: {
        dir: outDir,
        types: ['normal'],
        batchId: 'mcp-ledger',
        items: [{ path: image, category: 'wood' }]
      }
    });
    const batchText = textOf(batch);
    check(
      'batch 回 batchId 与写出数',
      batchText && batchText.ok && batchText.written === 1 && batchText.resumed.batchId === 'mcp-ledger',
      JSON.stringify(batchText && { written: batchText.written, resumed: batchText.resumed })
    );

    const ledger = await client.request('tools/call', {
      name: 'normalmap_batch_state',
      arguments: { dir: outDir }
    });
    const ledgerText = textOf(ledger);
    const row = (ledgerText && ledgerText.batches && ledgerText.batches[0]) || {};
    check(
      'batch_state 查到刚跑的那批',
      Boolean(ledgerText && ledgerText.ok) &&
        row.batchId === 'mcp-ledger' &&
        row.lastRun &&
        row.lastRun.written === 1 &&
        row.cumulative &&
        row.cumulative.done === 1,
      JSON.stringify(row).slice(0, 280)
    );

    const files = fs.readdirSync(outDir).filter((f) => /\.png$/.test(f));
    check('文件真的落盘', files.length === 1, files.join(','));

    await client.request('tools/call', { name: 'normalmap_quit', arguments: {} }).catch(() => null);
    await sleep(1200);
    report.ok = report.steps.every((s) => s.ok);
  } catch (err) {
    report.error = err.message;
  } finally {
    if (client) await client.close().catch(() => null);
    if (app) {
      try {
        execFileSync('taskkill', ['/F', '/PID', String(app.pid)], { stdio: 'ignore' });
      } catch {
        /* 已经退出 */
      }
    }
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
})();
