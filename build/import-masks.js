'use strict';

/*
 * import-masks.js — 把下载目录里的十张黑白遮罩转成应用内置的预设资源。
 *
 *   node_modules/electron/dist/electron.exe build/import-masks.js
 *
 * 为什么要转：原图是 512–4096 的 JPG（共约 20 MB），命名是素材站编号。
 * 这里统一成 1024×1024、8 位灰度 PNG，一是体积可控，二是灰度值只留亮度
 * （JPG 的色度噪声对遮罩没有意义），三是文件名能对应界面上的预设名。
 *
 * 产物：renderer/images/masks/<id>.png
 */

const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SRC = process.env.NMO_MASK_SRC || './masks';
const OUT = path.join(__dirname, '..', 'renderer', 'images', 'masks');
const SIZE = 1024;

const MAP = [
  ['6060974_0b1affe8c20461ee7974f9b7e2ab8105.jpg', 'peeling-wood'],
  ['6105601_f159d2392b9ad25be147230a51b7a019.jpg', 'mottled-wall'],
  ['6257231_5088491e553e9d22c2e4a7e621392c52.jpg', 'soft-cloud'],
  ['6342634_b659dae74a5a8ccd2cd7e355fc49f541.jpg', 'edge-fade'],
  ['7194384_7788e2fa86b037f3149818f44afc4cb8.jpg', 'heavy-stain'],
  ['JAH5455038644.jpeg', 'crumpled-cloth'],
  ['JCI54551210081.jpg', 'coarse-grain'],
  ['JCI54551858011.jpg', 'fine-grain'],
  ['JCI54559334159.jpg', 'brushed-plaster'],
  ['JFH5455300678.jpeg', 'vertical-streak']
];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** 8 位灰度 PNG（filter 0），输入为 width*height 的灰度缓冲。 */
function encodeGrayPng(width, height, gray) {
  const stride = width;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    gray.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function toGray(image) {
  const resized = image.resize({ width: SIZE, height: SIZE, quality: 'best' });
  const size = resized.getSize();
  const bitmap = resized.getBitmap(); // BGRA
  const gray = Buffer.alloc(size.width * size.height);
  let min = 255;
  let max = 0;
  let sum = 0;
  for (let i = 0, p = 0; p < gray.length; i += 4, p += 1) {
    const b = bitmap[i];
    const g = bitmap[i + 1];
    const r = bitmap[i + 2];
    const v = Math.max(0, Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));
    gray[p] = v;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return {
    gray,
    width: size.width,
    height: size.height,
    min,
    max,
    mean: Math.round(sum / gray.length)
  };
}

app.whenReady().then(() => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = [];
  for (const [file, id] of MAP) {
    const src = path.join(SRC, file);
    if (!fs.existsSync(src)) {
      report.push({ id, file, error: 'missing' });
      continue;
    }
    const image = nativeImage.createFromPath(src);
    if (image.isEmpty()) {
      report.push({ id, file, error: 'decode failed' });
      continue;
    }
    const info = toGray(image);
    const png = encodeGrayPng(info.width, info.height, info.gray);
    const dst = path.join(OUT, id + '.png');
    fs.writeFileSync(dst, png);
    report.push({
      id,
      source: path.basename(file),
      sourceSize: image.getSize(),
      size: info.width + 'x' + info.height,
      min: info.min,
      max: info.max,
      mean: info.mean,
      kb: Math.round(png.length / 1024)
    });
  }
  console.log(JSON.stringify(report, null, 2));
  app.exit(report.some((r) => r.error) ? 1 : 0);
});
