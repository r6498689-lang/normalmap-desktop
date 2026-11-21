'use strict';

/*
 * pack.js — builds the Windows x64 portable folder and its ZIP.
 *
 * Deliberately not using electron-builder: the app has zero runtime
 * dependencies, so packaging is "copy the Electron runtime, drop app/ in,
 * rename the exe". Fewer moving parts, and every file in the result is
 * inspectable by whoever reviews the build.
 *
 * Run: node build/pack.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const DIST = path.join(ROOT, 'dist');
const FOLDER_NAME = `${pkg.productName}-${pkg.version}-win32-x64`;
const OUT_DIR = path.join(DIST, FOLDER_NAME);
const ZIP_PATH = path.join(DIST, `${FOLDER_NAME}.zip`);
const EXE_NAME = 'NormalMap Desktop.exe';

const RUNTIME_ENTRIES = ['package.json', 'desktop', 'renderer'];
const SKIP_ROOT_ENTRIES = new Set(['node_modules']);

function fail(message) {
  console.error('pack: ' + message);
  process.exit(1);
}

/**
 * Asks the packaged Electron binary for its own versions. Runs with
 * ELECTRON_RUN_AS_NODE so it behaves like plain Node and prints JSON.
 * Returns null if the query fails; the caller records that as unknown
 * instead of guessing.
 */
function runtimeVersions() {
  try {
    const out = execFileSync(
      path.join(ELECTRON_DIST, process.platform === 'win32' ? 'electron.exe' : 'electron'),
      ['-p', 'JSON.stringify(process.versions)'],
      {
        env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
        encoding: 'utf8',
        timeout: 20000
      }
    );
    const v = JSON.parse(out.trim());
    return { electron: v.electron, chromium: v.chrome, node: v.node, v8: v.v8 };
  } catch (err) {
    console.warn('pack: could not read runtime versions: ' + err.message);
    return null;
  }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else fs.copyFileSync(src, dst);
  }
}

function main() {
  if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
    fail('Electron runtime not found at ' + ELECTRON_DIST + ' — run "npm install" first.');
  }

  console.log('pack: cleaning ' + OUT_DIR);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.rmSync(ZIP_PATH, { force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('pack: copying Electron runtime');
  copyDir(ELECTRON_DIST, OUT_DIR);

  const exeFrom = path.join(OUT_DIR, 'electron.exe');
  const exeTo = path.join(OUT_DIR, EXE_NAME);
  fs.renameSync(exeFrom, exeTo);

  // Electron ships ~50 locale packs (~49 MB). The UI is English-only; Chromium
  // falls back to en-US.pak for anything else, so keep the two Chinese ones
  // for OS-level dialogs and drop the rest.
  const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak']);
  const localesDir = path.join(OUT_DIR, 'locales');
  if (fs.existsSync(localesDir)) {
    let removed = 0;
    for (const name of fs.readdirSync(localesDir)) {
      if (!KEEP_LOCALES.has(name)) {
        fs.rmSync(path.join(localesDir, name), { force: true });
        removed += 1;
      }
    }
    console.log(`pack: pruned ${removed} locale packs (kept en-US, zh-CN, zh-TW)`);
  }

  // A zip of the folder is shipped next to it; the folder must not contain it.
  const resourcesApp = path.join(OUT_DIR, 'resources', 'app');
  fs.rmSync(resourcesApp, { recursive: true, force: true });
  fs.mkdirSync(resourcesApp, { recursive: true });

  console.log('pack: copying application files');
  for (const entry of RUNTIME_ENTRIES) {
    const src = path.join(ROOT, entry);
    if (!fs.existsSync(src)) fail('missing runtime entry: ' + entry);
    if (fs.statSync(src).isDirectory()) copyDir(src, path.join(resourcesApp, entry));
    else fs.copyFileSync(src, path.join(resourcesApp, entry));
  }

  // Ship the licence stack next to the exe, not only inside app/.
  for (const name of ['LICENSE', 'LICENSE-THIRD-PARTY.md', 'THIRD_PARTY_NOTICES.md', '使用说明.md']) {
    const src = path.join(ROOT, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT_DIR, name));
  }

  // MCP adapter lives next to the exe so clients can point at a short path:
  //   "D:\...\NormalMap\mcp\normalmap-mcp.js"
  const mcpSrc = path.join(ROOT, 'mcp');
  if (fs.existsSync(mcpSrc)) copyDir(mcpSrc, path.join(OUT_DIR, 'mcp'));

  // Default Electron app is not ours and must not be reachable.
  const defaultApp = path.join(OUT_DIR, 'resources', 'default_app.asar');
  if (fs.existsSync(defaultApp)) fs.rmSync(defaultApp);

  // A test run creates nmo-test.flag next to the exe and deletes it afterwards.
  // If one ever survives (killed run), it must not travel in the release zip:
  // the flag is what lets the harness load inside a packaged build.
  const strayFlag = path.join(OUT_DIR, 'nmo-test.flag');
  if (fs.existsSync(strayFlag)) {
    fs.rmSync(strayFlag, { force: true });
    console.warn('pack: removed a leftover nmo-test.flag from ' + FOLDER_NAME);
  }

  const sizeMb = dirSize(OUT_DIR) / (1024 * 1024);
  console.log(`pack: folder ready (${sizeMb.toFixed(1)} MB): ${path.relative(ROOT, OUT_DIR)}`);

  console.log('pack: writing ' + path.relative(ROOT, ZIP_PATH));
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
          `[System.IO.Compression.ZipFile]::CreateFromDirectory('${OUT_DIR.replace(/'/g, "''")}','${ZIP_PATH.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Optimal, $true)`
      ],
      { stdio: 'inherit' }
    );
  } else {
    execFileSync('zip', ['-r', '-q', ZIP_PATH, FOLDER_NAME], { cwd: DIST, stdio: 'inherit' });
  }

  const zipMb = fs.statSync(ZIP_PATH).size / (1024 * 1024);
  console.log(`pack: zip ready (${zipMb.toFixed(1)} MB): ${path.relative(ROOT, ZIP_PATH)}`);
  fs.writeFileSync(
    path.join(DIST, 'BUILD.json'),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        productName: pkg.productName,
        version: pkg.version,
        // Runtime identity comes from the shipped binary, not from whatever
        // Node happened to build it. The two differ: building with Node 22
        // still ships Electron's own Node 24.
        runtime: runtimeVersions(),
        buildHost: {
          node: process.version,
          platform: `${process.platform}-${process.arch}`
        },
        folder: FOLDER_NAME,
        zip: path.basename(ZIP_PATH)
      },
      null,
      2
    ),
    'utf8'
  );
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else total += fs.statSync(p).size;
  }
  return total;
}

if (require.main === module) main();

module.exports = { main, OUT_DIR, EXE_NAME, FOLDER_NAME };
