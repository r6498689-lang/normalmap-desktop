'use strict';

/* 快速看一张 PNG 的亮度分布（用于判断截图是不是全黑）。 */
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
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[i] = v & 0xff;
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { width, height, channels, data: out };
}

for (const file of process.argv.slice(2)) {
  const img = decode(file);
  let min = 255, max = 0, sum = 0, n = 0;
  const hist = new Map();
  for (let i = 0; i < img.data.length; i += img.channels) {
    const r = img.data[i], g = img.data[i + 1] !== undefined ? img.data[i + 1] : r, b = img.data[i + 2] !== undefined ? img.data[i + 2] : r;
    const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    if (l < min) min = l;
    if (l > max) max = l;
    sum += l;
    n++;
    hist.set(l, (hist.get(l) || 0) + 1);
  }
  const top = Array.from(hist.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(file.split(/[\\/]/).pop(), `${img.width}x${img.height}`, 'min', min, 'max', max, 'mean', (sum / n).toFixed(1), 'top', JSON.stringify(top));
}
