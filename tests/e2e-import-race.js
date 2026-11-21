'use strict';

/*
 * e2e-import-race.js — 复查回归：同类“预留 → 导入高位备份 → 取消旧计划 → 重启续号”。
 *
 * 只碰编号库（真实 LibraryStore），不启窗口、不读图片，跑完即弃临时目录。
 *
 *   node tests/e2e-import-race.js
 *   node tests/e2e-import-race.js --app="<local-path>"
 *
 * 退出码 0 = 全部通过；1 = 有断言失败（stdout 里是 JSON 报告）。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const argApp = process.argv.find((a) => a.startsWith('--app='));
const appDir = argApp ? argApp.slice('--app='.length) : path.join(__dirname, '..');
const storePath = path.join(appDir, 'desktop', 'library-store.js');
const { LibraryStore } = require(storePath);

const steps = [];
function check(label, ok, detail) {
  steps.push({ label: label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
}

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-race-' + name + '-'));
}

/** 播一个只有 wood 类别、最大号为 max 的库文件（模拟别处导入过的历史）。 */
function seed(dir, max) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'nmo-library.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        categories: {
          wood: {
            label: '木材',
            custom: false,
            maxAssigned: max,
            createdAt: new Date().toISOString()
          }
        },
        suites: [],
        reservations: []
      },
      null,
      2
    ),
    'utf8'
  );
}

async function main() {
  const report = { appDir: appDir, storePath: storePath, steps: steps, ok: false };

  /* --- 1. 复查报告里的顺序：预留 001 → 导入 100 → 取消旧计划 → 重启续号 --- */
  const dir = tmp('main');
  const store = new LibraryStore({ dir: dir });
  const first = await store.reserve([{ category: 'wood', sourceName: 'first.png' }]);
  check('预留得到 wood_001', first[0] && first[0].number === 1, first && first[0]);

  const seedDir = tmp('seed');
  seed(seedDir, 100);
  const backup = new LibraryStore({ dir: seedDir }).buildBackup();
  const applied = await store.applyImport(store.previewImport(backup));
  check('导入把 wood 抬到 100', applied.ok === true, applied);

  const released = await store.releaseUnstarted([{ category: 'wood', number: first[0].number }]);
  check('旧计划的 001 照常释放', released.released === 1, released);

  const snapshotAfterRelease = store.getSnapshot();
  const woodAfterRelease = snapshotAfterRelease.categories.find((c) => c.value === 'wood');
  check(
    '释放后最大号仍是 100（没被旧 baseMax 抹掉）',
    woodAfterRelease.maxAssigned === 100,
    woodAfterRelease
  );

  const restarted = new LibraryStore({ dir: dir });
  const next = await restarted.reserve([{ category: 'wood', sourceName: 'next.png' }]);
  check('重启后新图拿到 wood_101', next[0] && next[0].number === 101, next && next[0]);

  /* --- 2. 不回归：连续预留（每张一个计划）全部释放后不留空号 --- */
  const gapDir = tmp('gap');
  const gapStore = new LibraryStore({ dir: gapDir });
  const seq = [];
  for (let i = 0; i < 3; i += 1) {
    /* 每次 reserve 都是新计划，baseMax 会一级级抬高（D06 的真实形态）。 */
    const row = await gapStore.reserve([{ category: 'wood', sourceName: 's' + i + '.png' }]);
    seq.push(row[0].number);
  }
  const gapReleased = await gapStore.releaseUnstarted(
    seq.map((n) => ({ category: 'wood', number: n }))
  );
  const gapNext = await gapStore.reserve([{ category: 'wood', sourceName: 'after.png' }]);
  check(
    '连续预留全部释放后下一张回到 001',
    gapReleased.released === 3 && gapNext[0].number === 1,
    { seq: seq, released: gapReleased, next: gapNext[0].number }
  );

  /* --- 3. 不回归：目录里已有的文件抬高水位，释放后不能退到它下面 --- */
  const floorDir = tmp('floor');
  const floorStore = new LibraryStore({ dir: floorDir });
  const floorRow = await floorStore.reserve([{ category: 'wood', sourceName: 'f.png', floor: 50 }]);
  await floorStore.releaseUnstarted([{ category: 'wood', number: floorRow[0].number }]);
  const floorSnapshot = floorStore.getSnapshot();
  const floorWood = floorSnapshot.categories.find((c) => c.value === 'wood');
  check(
    '目录 floor 50 不会被退号抹掉',
    floorRow[0].number === 51 && floorWood.maxAssigned === 50,
    { reserved: floorRow[0].number, wood: floorWood }
  );

  report.ok = steps.every((s) => s.ok);
  return report;
}

main()
  .then((report) => {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = report.ok ? 0 : 1;
  })
  .catch((err) => {
    process.stdout.write(
      JSON.stringify({ ok: false, error: (err && err.stack) || String(err), steps: steps }, null, 2) + '\n'
    );
    process.exitCode = 1;
  });
