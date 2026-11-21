'use strict';

/*
 * run-all.js — runs every scenario in its own Electron process.
 *
 * Usage:
 *   node tests/run-all.js                 # all specs
 *   node tests/run-all.js --phase=2       # one phase
 *   node tests/run-all.js --only=smoke,batch
 *   node tests/run-all.js --exe="dist/.../NormalMap Desktop.exe"   # packaged build
 */

const { spawnSync, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const SPECS = [
  { name:'preset-export',file:'tests/specs/preset-export.spec.js',phase:2,title:'可编辑命名清单与参数自动保存'},
  { name: 'smoke', file: 'tests/specs/smoke.spec.js', phase: 1, title: '启动、四类贴图、3D 预览可用' },
  {
    name: 'classification',
    file: 'tests/specs/classification.spec.js',
    phase: 1,
    title: '逐张分类：上一张、自定义标签、取消、坏图、防重入'
  },
  {
    name: 'baseline',
    file: 'tests/specs/baseline.spec.js',
    phase: 2,
    title: '与原始站点逐像素一致',
    // 需要 app://baseline（tests/baseline/site）。这份上游副本刻意不进安装包，
    // 所以只能在源码树跑，打包版要跳过而不是判失败。
    requiresBaseline: true
  },
  { name: 'naming', file: 'tests/specs/naming.spec.js', phase: 2, title: '命名续号：001–005、扩位、补图、坏库' },
  { name: 'pbr', file: 'tests/specs/pbr.spec.js', phase: 2, title: '粗糙度/金属度数值、遮罩、PBR 预览' },
  { name: 'orm', file: 'tests/specs/orm.spec.js', phase: 2, title: 'ORM 开关规则、RGB 编码与逐通道数据' },
  { name: 'presets', file: 'tests/specs/presets.spec.js', phase: 2, title: '参数预设、编号库备份、批量停止与重试' },
  {
    name: 'category-presets',
    file: 'tests/specs/category-presets.spec.js',
    phase: 2,
    title: '分类预设：粗糙度/金属度按类别自动套用'
  },
  {
    name: 'mask-presets',
    file: 'tests/specs/mask-presets.spec.js',
    phase: 2,
    title: '遮罩预设：十张内置黑白遮罩、换源图不失效'
  },
  { name: 'import', file: 'tests/specs/import.spec.js', phase: 2, title: '导入格式、拖放、取消、无效文件' },
  { name: 'params', file: 'tests/specs/params.spec.js', phase: 2, title: '参数、滤波、反转、恢复默认' },
  { name: 'export', file: 'tests/specs/export.spec.js', phase: 2, title: '单张 PNG/JPG/TIFF 导出与取消' },
  {
    name: 'save-contract',
    file: 'tests/specs/save-contract.spec.js',
    phase: 2,
    title: '保存契约：失败统计合并、扩展名与编码一致'
  },
  { name: 'export-all', file: 'tests/specs/export-all.spec.js', phase: 2, title: '全部导出：四类文件、命名、重名' },
  { name: 'batch', file: 'tests/specs/batch.spec.js', phase: 2, title: '批量转换：数量、对应关系、不串图' },
  {
    name: 'photos',
    file: 'tests/specs/photos.spec.js',
    phase: 2,
    title: '四方向照片：导入、模式切换、结果',
    requiresBaseline: true
  },
  { name: 'preview', file: 'tests/specs/preview.spec.js', phase: 2, title: '3D 预览：模型、OBJ、Diffuse、开关' },
  {
    name: 'preview-zoom',
    file: 'tests/specs/preview-zoom.spec.js',
    phase: 2,
    title: '预览缩放：滚轮、拖动、双击还原'
  },
  {
    name: 'agent',
    file: 'tests/specs/agent.spec.js',
    phase: 2,
    title: 'Agent 桥：鉴权、开图、类别、导出'
  },
  {
    name: 'mcp',
    file: 'tests/specs/mcp.spec.js',
    phase: 2,
    title: 'MCP 适配器：握手、工具列表、错误翻译'
  },
  { name: 'paths', file: 'tests/specs/paths.spec.js', phase: 2, title: '中文与空格路径：导入、导出、批量' },
  { name: 'perf', file: 'tests/specs/perf.spec.js', phase: 2, title: '大图耗时、显存/内存与渲染器' },
  { name: 'offline', file: 'tests/specs/offline.spec.js', phase: 3, title: '离线冷启动全流程、零远程请求' },
  {
    name: 'packaged',
    file: 'tests/specs/packaged.spec.js',
    phase: 3,
    title: '最终便携版端到端',
    requiresPackaged: true
  }
];

function parseArgs(argv) {  const args = { phase: null, only: null, exe: null, cwd: null };
  for (const raw of argv) {
    if (raw.startsWith('--phase=')) args.phase = Number(raw.split('=')[1]);
    else if (raw.startsWith('--only=')) args.only = raw.split('=')[1].split(',').map((s) => s.trim());
    else if (raw.startsWith('--exe=')) args.exe = raw.slice(6).replace(/^"|"$/g, '');
    else if (raw === '--packaged') args.packaged = true;
    else if (raw.startsWith('--cwd=')) args.cwd = raw.slice(6).replace(/^"|"$/g, '');
  }
  return args;
}

/**
 * After the process exits, make sure nothing of it is left behind.
 * Matches on the full executable path so an unrelated Electron app is ignored.
 */
function findResidualProcesses(exePath) {
  if (process.platform !== 'win32') {
    return { ok: true, pids: [], note: 'process check only implemented on win32' };
  }
  const escaped = path.resolve(exePath).replace(/'/g, "''");
  const script = [
    `$p = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${escaped}' }`,
    'if (-not $p) { "NONE" } else { ($p | ForEach-Object { $_.ProcessId }) -join "," }'
  ].join('; ');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 20000
    }).trim();
    if (!out || out === 'NONE') return { ok: true, pids: [] };
    return { ok: true, pids: out.split(',').map((s) => s.trim()).filter(Boolean) };
  } catch (err) {
    // Not knowing is not the same as "no leftovers": report it as a failure
    // instead of silently passing the spec.
    return { ok: false, pids: [], error: (err && err.message) || String(err) };
  }
}

/** Resolves the exe produced by build/pack.js (dist/<name>-win32-x64/<name>.exe). */
function resolvePackagedExe() {
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(dist)) return null;
  // 同时留着 1.0.0 与 1.1.0 时，默认要测最新那个，不能按目录顺序随便挑。
  const candidates = [];
  for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/-win32-x64$/.test(entry.name)) continue;
    const dir = path.join(dist, entry.name);
    const exe = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.exe'));
    if (!exe) continue;
    const version = (entry.name.match(/-(\d+\.\d+\.\d+)-win32-x64$/) || [])[1] || '0.0.0';
    candidates.push({ version, exe: path.join(dir, exe) });
  }
  candidates.sort((a, b) => {
    const pa = a.version.split('.').map(Number);
    const pb = b.version.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pb[i] - pa[i];
    }
    return 0;
  });
  return candidates.length ? candidates[0].exe : null;
}

function runSpec(spec, args) {
  const evidenceDir = path.join(ROOT, 'evidence', `phase${spec.phase}`, spec.name);
  const outPath = path.join(ROOT, 'evidence', `phase${spec.phase}`, `${spec.name}.json`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  // A leftover result file from an earlier run must never be mistaken for this
  // run's verdict. Delete it, then require the new result to echo a fresh id.
  fs.rmSync(outPath, { force: true });
  if (fs.existsSync(outPath)) {
    throw new Error('cannot clear stale result file: ' + outPath);
  }
  const runId = crypto.randomUUID();

  const env = { ...process.env };
  // The host shell may run every Electron binary as plain Node; that would make
  // require('electron') return a path and the app would not start.
  delete env.ELECTRON_RUN_AS_NODE;
  env.NMO_TEST_MODE = '1';
  env.NMO_TEST_RUN_ID = runId;
  env.NMO_TEST_SPEC = path.join(ROOT, spec.file);
  env.NMO_TEST_OUT = outPath;
  env.NMO_EVIDENCE_DIR = evidenceDir;
  env.NMO_FIXTURES = path.join(ROOT, 'tests', 'fixtures');
  if (args.exe) {
    env.NMO_PACKAGED_EXE = args.exe;
    env.NMO_TEST_PACKAGED = '1';
  }

  const exe = args.exe || ELECTRON;
  const exeArgs = args.exe ? [] : [ROOT];

  // A packaged build only loads the harness when nmo-test.flag sits next to the
  // exe (desktop/main.js). Create it for the duration of the run and delete it
  // again, so a released folder never carries the flag.
  const flagPath = args.exe ? path.join(path.dirname(args.exe), 'nmo-test.flag') : null;
  if (flagPath) fs.writeFileSync(flagPath, 'temporary; created by tests/run-all.js\n');

  const started = Date.now();
  let result;
  try {
    result = spawnSync(exe, exeArgs, {
      cwd: args.cwd || ROOT,
      env,
      timeout: 300000,
      encoding: 'utf8',
      windowsHide: false
    });
  } finally {
    if (flagPath) fs.rmSync(flagPath, { force: true });
  }
  const durationMs = Date.now() - started;
  if (flagPath && fs.existsSync(flagPath)) {
    console.error('warn: could not remove ' + flagPath);
  }

  // Give the OS a moment to reap the process tree, then look for leftovers.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  const residualCheck = findResidualProcesses(exe);
  const residual = residualCheck.pids || [];

  let parsed = null;
  if (fs.existsSync(outPath)) {
    try {
      parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (err) {
      parsed = { ok: false, error: 'result file is not valid JSON: ' + err.message };
    }
  }

  const reasons = [];
  if (!parsed) reasons.push('no result file was written');
  if (parsed && parsed.runId !== runId) {
    reasons.push('result file is stale (runId mismatch)');
  }
  if (parsed && !parsed.ok) reasons.push('scenario reported failure');
  if (result.status !== 0) reasons.push('exited with code ' + result.status);
  if (!residualCheck.ok) reasons.push('could not verify leftover processes');
  if (residual.length > 0) reasons.push('processes still running: ' + residual.join(', '));

  const ok = reasons.length === 0;
  return {
    name: spec.name,
    phase: spec.phase,
    title: spec.title,
    ok,
    failedBecause: reasons,
    runId,
    residualProcesses: residual,
    residualCheck,
    exitCode: result.status,
    durationMs,
    resultFile: path.relative(ROOT, outPath),
    stdoutTail: (result.stdout || '').split('\n').slice(-25).join('\n'),
    stderrTail: (result.stderr || '').split('\n').slice(-25).join('\n'),
    failures: parsed && parsed.failures ? parsed.failures : undefined,
    error: parsed && parsed.error ? parsed.error : undefined
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.packaged) {
    const resolved = resolvePackagedExe();
    if (!resolved) {
      console.error('No packaged build found in dist/. Run "npm run pack" first.');
      process.exit(2);
    }
    args.exe = resolved;
    args.only = ['packaged'];
  }

  let selected = SPECS;
  if (args.phase) selected = selected.filter((s) => s.phase === args.phase);
  if (args.only) selected = selected.filter((s) => args.only.includes(s.name));
  // Specs that only make sense against the portable build are skipped in a
  // plain source-tree run instead of being reported as failures.
  if (!args.exe) selected = selected.filter((s) => !s.requiresPackaged);

  let skippedForPackaged = [];
  if (args.exe) {
    skippedForPackaged = selected.filter((s) => s.requiresBaseline);
    selected = selected.filter((s) => !s.requiresBaseline);
  }

  if (selected.length === 0) {
    console.error('No spec matched the filters.');
    process.exit(2);
  }

  if (!args.exe && !fs.existsSync(ELECTRON)) {
    console.error('Electron runtime missing. Run "npm install" first.');
    process.exit(2);
  }

  console.log(`Running ${selected.length} spec(s)${args.exe ? ' against ' + args.exe : ''}\n`);
  if (skippedForPackaged.length) {
    console.log(
      '  skipped in packaged run: ' +
        skippedForPackaged.map((s) => s.name).join(', ') +
        '（需要未打包的 tests/baseline/site）\n'
    );
  }

  const results = [];
  for (const spec of selected) {
    process.stdout.write(`  ${spec.name.padEnd(12)} ${spec.title} ... `);
    const outcome = runSpec(spec, args);
    results.push(outcome);
    console.log(outcome.ok ? `PASS (${(outcome.durationMs / 1000).toFixed(1)}s)` : 'FAIL');
    if (!outcome.ok) {
      if (outcome.error) console.log(`      error: ${outcome.error.split('\n')[0]}`);
      if (outcome.failures) {
        for (const f of outcome.failures.slice(0, 8)) console.log('      - ' + f);
      }
      if (!outcome.error && !outcome.failures && outcome.stderrTail) {
        console.log('      stderr: ' + outcome.stderrTail.split('\n').slice(-6).join('\n      '));
      }
    }
  }

  const summaryPath = path.join(
    ROOT,
    'evidence',
    args.exe ? 'test-summary-packaged.json' : 'test-summary.json'
  );
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        target: args.exe || ELECTRON,
        workingDirectory: args.cwd || ROOT,
        total: results.length,
        passed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        skipped: skippedForPackaged.map((s) => ({
          name: s.name,
          reason: '需要 tests/baseline/site（不进安装包）'
        })),
        results
      },
      null,
      2
    ),
    'utf8'
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  console.log(`Summary: ${path.relative(ROOT, summaryPath)}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

if (require.main === module) main();

module.exports = { SPECS };
