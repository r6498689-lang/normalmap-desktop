'use strict';

/*
 * png-diff.js — 两张同尺寸 PNG 的逐像素差异。
 *
 *   node tests/png-diff.js a.png b.png
 *
 * 输出：平均绝对差、差异像素占比（阈值 3）、最大差。
 * 用于判断“粗糙度/金属度改动到底有没有反映到 3D 预览上”。
 */
const fs = require('node:fs');
const zlib = require('node:zlib');

function decode(file) {
  const buf = fs.readFileSync(file);
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('bitDepth ' + bitDepth);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('colorType ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { width, height, channels, data: out };
}

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: node tests/png-diff.js a.png b.png');
  process.exit(2);
}
const A = decode(a);
const B = decode(b);
if (A.width !== B.width || A.height !== B.height) {
  console.log(JSON.stringify({ error: 'size mismatch', a: [A.width, A.height], b: [B.width, B.height] }));
  process.exit(1);
}
let sum = 0, max = 0, changed = 0, n = 0;
for (let i = 0; i < A.data.length; i += A.channels) {
  for (let c = 0; c < 3 && c < A.channels; c += 1) {
    const d = Math.abs(A.data[i + c] - B.data[i + c]);
    sum += d;
    if (d > max) max = d;
    if (d > 3) { changed += 1; break; }
  }
  n += 1;
}
const total = n * Math.min(3, A.channels);
console.log(JSON.stringify({
  size: [A.width, A.height],
  meanAbsDiff: Number((sum / total).toFixed(3)),
  maxDiff: max,
  changedRatio: Number((changed / n).toFixed(4))
}));
