'use strict';

/*
 * manifest.js — identity of what was built and what built it.
 * Run: node build/manifest.js  (after build/pack.js)
 *
 * Produces:
 *   dist/SHA256SUMS.txt        portable folder zip + exe
 *   evidence/source-hashes.txt every source file, so the build can be tied
 *                              back to a source tree even without git
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'evidence', '.git', '.workbuddy']);
const SKIP_EXT = new Set(['.zip']);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (!SKIP_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const files = walk(ROOT, []).sort();
  const lines = files.map((f) => {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    return `${sha256(f)}  ${rel}`;
  });
  const sourcePath = path.join(ROOT, 'evidence', 'source-hashes.txt');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, lines.join('\n') + '\n', 'utf8');
  console.log(`manifest: ${files.length} source files -> ${path.relative(ROOT, sourcePath)}`);

  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(distDir)) {
    console.log('manifest: no dist/ yet, skipped build hashes');
    return;
  }

  const targets = [];
  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    const full = path.join(distDir, entry.name);
    if (entry.isDirectory() && /-win32-x64$/.test(entry.name)) {
      for (const exe of fs.readdirSync(full)) {
        if (exe.toLowerCase().endsWith('.exe')) {
          targets.push({ label: path.relative(ROOT, path.join(full, exe)), file: path.join(full, exe) });
        }
      }
    } else if (entry.isFile() && entry.name.endsWith('.zip')) {
      targets.push({ label: path.relative(ROOT, full), file: full });
    }
  }

  const sums = targets.map((t) => `${sha256(t.file)}  ${t.label.replace(/\\/g, '/')}`);
  fs.writeFileSync(path.join(distDir, 'SHA256SUMS.txt'), sums.join('\n') + '\n', 'utf8');
  sums.forEach((line) => console.log('  ' + line));
}

if (require.main === module) main();

module.exports = { main, sha256 };
