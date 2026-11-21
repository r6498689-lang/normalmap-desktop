'use strict';

/*
 * e2e-kill-resume.js — 1.1.28 真实验收：跑到一半硬杀进程，重启后 resume。
 *
 * 用法：
 *   node tests/e2e-kill-resume.js --exe="<local-path> Desktop.exe"
 *
 * 做的事：
 *   1. 用临时 profile 起一个 --agent 实例；
 *   2. 6 张图、batchId=kill-test，async 跑到第 2 张写完后 taskkill /F；
 *   3. 检查账本里已写的条目数 = 落盘文件数；
 *   4. 同 profile 重启，同一 batchId + resume:true 续跑；
 *   5. 断言 skipped = 崩溃前完成的张数、written = 剩下的张数、总文件数 = 6、文件名不重复；
 *   6. 退出程序并输出 JSON 结果。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const exe = path.resolve(arg('exe', path.join(__dirname, '..', 'dist', 'NormalMap Desktop-1.2.0-win32-x64', 'NormalMap Desktop.exe')));
const port = Number(arg('port', 47355));
const keep = process.argv.includes('--keep');
const startedAt = Date.now();
const log = (msg) => console.log('[' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's] ' + msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: port,
        path: urlPath,
        method: method,
        headers: Object.assign(
          { Authorization: 'Bearer ' + token },
          payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}
        )
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            reject(new Error('响应不是 JSON：' + err.message));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* 重启时 agent.json 还是上一次的旧内容，必须边等边重读，拿到新令牌。 */
async function waitForReady(file, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    let info = null;
    try {
      info = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* 还没写 */
    }
    if (info && info.token) {
      try {
        const health = await request('GET', '/health', null, info.token);
        if (health && health.ok) return info;
      } catch {
        /* 进程还没监听 */
      }
    }
    await sleep(250);
  }
  throw new Error('等不到 Agent 就绪：' + file);
}

function launch(profile) {
  const child = spawn(exe, ['--agent', '--agent-port=' + port, '--profile=' + profile], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true
  });
  child.on('error', (err) => console.error('spawn error', err.message));
  return child;
}

function killHard(pid) {
  try {
    execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
  } catch {
    /* 已经退出 */
  }
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-kill-profile-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-kill-out-'));
  const agentFile = path.join(profile, 'agent.json');

  const picks = [
    'height-bumps-256.png',
    'height-255x257.png',
    'height-300x200.png',
    'height-alpha-192.png',
    'basecolor-color-256.png',
    'diffuse-256.png'
  ];
  const items = picks.map((name) => ({ path: path.join(FIXTURES, name), category: 'wood' }));

  const report = { ok: false, exe: exe, profile: profile, outDir: outDir, steps: [] };
  let child = null;

  try {
    log('启动 1/2（' + profile + '）');
    child = launch(profile);
    const info = await waitForReady(agentFile, 60000);
    log('Agent 就绪 pid=' + info.pid + ' port=' + info.port);

    const started = await request(
      'POST',
      '/command',
      { cmd: 'batch', args: { items: items, dir: outDir, types: ['normal'], async: true, batchId: 'kill-test' } },
      info.token
    );
    if (!started.ok) throw new Error('批量没起来：' + JSON.stringify(started));
    log('批量已启动 jobId=' + started.jobId);

    /* 等“至少 2 张写完”再杀，保证账本里有部分条目。 */
    let doneBefore = 0;
    const until = Date.now() + 120000;
    while (Date.now() < until) {
      const snap = await request('GET', '/events?since=0', null, info.token);
      const job = snap.job || {};
      /* item_done 失败也会计数，必须只认成功的那几张。 */
      doneBefore = (job.done || 0) - (job.failed || 0);
      if (doneBefore >= 2) break;
      if (job.status && job.status !== 'running') break;
      await sleep(300);
    }
    if (doneBefore < 2) throw new Error('批量在超时前没跑完 2 张，done=' + doneBefore);

    log('已写 ' + doneBefore + ' 张，硬杀进程 pid=' + info.pid);
    killHard(info.pid);
    await sleep(1500);

    const filesBefore = fs.readdirSync(outDir).filter((f) => /\.png$/.test(f));
    const ledgerFile = path.join(profile, 'batch-state.json');
    const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    const entry = Object.values(ledger.batches).find((b) => b.batchId === 'kill-test');
    const doneInLedger = entry ? Object.values(entry.items).filter((row) => row.status === 'done').length : 0;
    log('崩溃现场：文件 ' + filesBefore.length + ' 个，账本 done ' + doneInLedger + ' 条');

    /*
     * 已知边界（DELIVERY §8）：文件写完、属性还没回写时被硬杀，
     * 会多出 1 个“有文件、账本没记”的孤儿。允许且只允许这 1 个。
     */
    report.steps.push({
      label: '崩溃后账本与已写文件一致（允许 1 张已写未记账）',
      ok:
        doneInLedger >= 2 &&
        filesBefore.length >= doneInLedger &&
        filesBefore.length <= doneInLedger + 1,
      detail: { files: filesBefore.length, ledgerDone: doneInLedger, doneBefore: doneBefore }
    });

    log('启动 2/2（同 profile，续跑）');
    child = launch(profile);
    const info2 = await waitForReady(agentFile, 60000);

    /* 重启后先看编号水位：崩溃时预留过的号必须保留，下一张从它后面接。 */
    const catAtRestart = await request('POST', '/command', { cmd: 'categories', args: {} }, info2.token);
    const woodRow = ((catAtRestart && catAtRestart.categories) || []).find((c) => c.value === 'wood');
    const nextAtRestart = woodRow ? woodRow.nextNumber : null;
    report.library = { nextNumberAtRestart: nextAtRestart };

    const resumed = await request(
      'POST',
      '/command',
      {
        cmd: 'batch',
        args: {
          items: items,
          dir: outDir,
          types: ['normal'],
          batchId: 'kill-test',
          resume: true
        }
      },
      info2.token
    );

    const expectWritten = items.length - doneInLedger;
    const filesAfter = fs.readdirSync(outDir).filter((f) => /\.png$/.test(f));
    const unique = new Set(filesAfter);

    report.resumed = {
      skipped: resumed.resumed && resumed.resumed.skipped,
      written: resumed.written,
      total: resumed.total,
      failed: resumed.failed,
      ms: resumed.ms
    };
    const numberOf = (name) => Number((/^wood_(\d+)_/.exec(name) || [])[1]);
    const numbers = filesAfter.map(numberOf).sort((a, b) => a - b);
    const beforeNumbers = filesBefore.map(numberOf).sort((a, b) => a - b);
    const afterNumbers = numbers.filter((n) => beforeNumbers.indexOf(n) === -1);
    report.files = {
      before: filesBefore.length,
      after: filesAfter.length,
      unique: unique.size,
      numbers: numbers,
      beforeNumbers: beforeNumbers,
      afterNumbers: afterNumbers
    };

    report.steps.push({
      label: 'resume 跳过崩溃前已完成的张数',
      ok: Boolean(resumed.ok) && resumed.resumed.skipped === doneInLedger,
      detail: { skipped: resumed.resumed && resumed.resumed.skipped, ledgerDone: doneInLedger }
    });
    report.steps.push({
      label: 'resume 只补剩下的张数',
      ok: resumed.written === expectWritten && resumed.failed === 0,
      detail: { written: resumed.written, expectWritten: expectWritten, failed: resumed.failed }
    });
    report.steps.push({
      label: '总文件数 = 6，或 7（含 1 张已写未记账的孤儿），且没有重名覆盖',
      ok:
        (filesAfter.length === items.length || filesAfter.length === items.length + 1) &&
        unique.size === filesAfter.length,
      detail: { after: filesAfter.length, unique: unique.size, names: filesAfter }
    });
    report.steps.push({
      label: '崩溃预留号不复用，续跑从下一个号接上',
      ok:
        typeof nextAtRestart === 'number' &&
        nextAtRestart >= beforeNumbers[beforeNumbers.length - 1] + 1 &&
        afterNumbers.length === expectWritten &&
        afterNumbers.every((n, i) => n === nextAtRestart + i) &&
        new Set(numbers).size === numbers.length,
      detail: { beforeNumbers: beforeNumbers, nextAtRestart: nextAtRestart, afterNumbers: afterNumbers, numbers: numbers }
    });

    const state = await request('POST', '/command', { cmd: 'batch_state', args: { dir: outDir } }, info2.token);
    const row = (state.batches || [])[0] || {};
    report.ledger = row;
    report.steps.push({
      label: '账本 cumulative 累计到 6 张',
      ok: row.cumulative && row.cumulative.done === items.length && row.cumulative.written === items.length,
      detail: row.cumulative
    });
    report.steps.push({
      label: '账本 lastRun 只算续跑这一轮',
      ok: row.lastRun && row.lastRun.skippedDone === doneInLedger && row.lastRun.written === expectWritten,
      detail: row.lastRun
    });

    await request('POST', '/command', { cmd: 'quit', args: {} }, info2.token).catch(() => null);
    await sleep(1200);

    report.ok = report.steps.every((s) => s.ok);
  } catch (err) {
    report.error = err.message;
    if (child) killHard(child.pid);
  } finally {
    if (child && child.exitCode === null) {
      try {
        killHard(child.pid);
      } catch {
        /* ignore */
      }
    }
    if (!keep) {
      /* 保留现场默认关掉；--keep 时留着给人看 */
    }
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
})();
