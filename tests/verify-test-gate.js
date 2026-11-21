'use strict';

/*
 * verify-test-gate.js
 *
 * Proves the negative case: with NMO_TEST_MODE=1 and a spec path in the
 * environment, but *no* nmo-test.flag next to the exe, the packaged build must
 * not load the harness. Observable effects of "harness did not load":
 *
 *   - no result JSON is written,
 *   - the process does not exit by itself (no app.exit in the harness),
 *   - the app window is up and serving the renderer (it is a normal launch).
 *
 * The positive case is covered by `tests/run-all.js --packaged`, which creates
 * the flag, runs the spec, and deletes the flag again.
 *
 * Usage: node tests/verify-test-gate.js [--exe=<path>]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function resolveExe() {
  const arg = process.argv.find((a) => a.startsWith('--exe='));
  if (arg) return path.resolve(arg.slice(6).replace(/^"|"$/g, ''));

  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(dist)) return null;
  for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/-win32-x64$/.test(entry.name)) continue;
    const dir = path.join(dist, entry.name);
    const exe = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.exe'));
    if (exe) return path.join(dir, exe);
  }
  return null;
}

/** Kills the process tree: the app spawns renderer/GPU children. */
function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (err) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (err2) {
        /* already gone */
      }
    }
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function main() {
  const exe = resolveExe();
  if (!exe) {
    console.error('No packaged build found. Run "npm run pack" first.');
    process.exit(2);
  }

  const exeDir = path.dirname(exe);
  const flagPath = path.join(exeDir, 'nmo-test.flag');
  if (fs.existsSync(flagPath)) {
    fs.rmSync(flagPath, { force: true });
    console.log('note: removed a stale nmo-test.flag before the check');
  }

  const outPath = path.join(os.tmpdir(), `nmo-gate-${process.pid}.json`);
  fs.rmSync(outPath, { force: true });

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.NMO_TEST_MODE = '1';
  env.NMO_TEST_SPEC = path.join(ROOT, 'tests', 'specs', 'smoke.spec.js');
  env.NMO_TEST_OUT = outPath;
  env.NMO_EVIDENCE_DIR = path.join(ROOT, 'evidence', 'phase3', 'test-gate');

  const child = spawn(exe, [], { cwd: ROOT, env, stdio: 'ignore', detached: false });
  const startedAt = Date.now();
  let exitedEarly = null;
  child.on('exit', (code) => {
    exitedEarly = { code, ms: Date.now() - startedAt };
  });

  // The smoke spec finishes in ~4s when hooks are active; 9s is well past that.
  sleep(9000);

  const resultWritten = fs.existsSync(outPath);
  const stillRunning = exitedEarly === null;
  const flagStillAbsent = !fs.existsSync(flagPath);

  killTree(child.pid);
  sleep(800);
  fs.rmSync(outPath, { force: true });

  const checks = [
    {
      label: '无标记文件时不写测试结果（钩子未加载）',
      ok: !resultWritten,
      detail: 'result file ' + (resultWritten ? 'exists' : 'absent')
    },
    {
      label: '进程不会自行退出（不是在跑测试）',
      ok: stillRunning,
      detail: exitedEarly ? `exited after ${exitedEarly.ms}ms, code ${exitedEarly.code}` : 'still running after 9000ms'
    },
    {
      label: '校验过程中没有生成标记文件',
      ok: flagStillAbsent,
      detail: flagPath
    }
  ];

  const report = {
    ok: checks.every((c) => c.ok),
    exe,
    ranAt: new Date().toISOString(),
    note:
      'Same environment as a scored run (NMO_TEST_MODE=1 + NMO_TEST_SPEC), minus nmo-test.flag. ' +
      'The harness must stay inert.',
    checks
  };

  const outDir = path.join(ROOT, 'evidence', 'phase3');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'test-gate.json'), JSON.stringify(report, null, 2) + '\n');

  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ' — ' + c.detail}`);
  }
  console.log(report.ok ? 'test gate: OK' : 'test gate: FAILED');
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
