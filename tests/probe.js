'use strict';

/*
 * probe.js — 跑一个“量尺子”脚本（tests/probe/*.probe.js），不走 run-all 的断言流程。
 *
 *   node tests/probe.js layout
 *
 * 结果写到 evidence/probe/<name>.json，截图也落在同一目录。
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const name = process.argv[2];
if (!name) {
  console.error('usage: node tests/probe.js <name>');
  process.exit(2);
}

const specPath = path.join(ROOT, 'tests', 'probe', `${name}.probe.js`);
if (!fs.existsSync(specPath)) {
  console.error('no such probe: ' + specPath);
  process.exit(2);
}

const outDir = path.join(ROOT, 'evidence', 'probe');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${name}.json`);
fs.rmSync(outPath, { force: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.NMO_TEST_MODE = '1';
env.NMO_TEST_RUN_ID = crypto.randomUUID();
env.NMO_TEST_SPEC = specPath;
env.NMO_TEST_OUT = outPath;
env.NMO_EVIDENCE_DIR = path.join(outDir, name);
env.NMO_FIXTURES = path.join(ROOT, 'tests', 'fixtures');

const res = spawnSync(ELECTRON, [ROOT], { cwd: ROOT, env, timeout: 300000, encoding: 'utf8' });
if (res.status !== 0) {
  console.error('exit code ' + res.status);
  console.error((res.stdout || '').split('\n').slice(-20).join('\n'));
  console.error((res.stderr || '').split('\n').slice(-20).join('\n'));
}
console.log(fs.existsSync(outPath) ? 'result: ' + outPath : 'no result written');
