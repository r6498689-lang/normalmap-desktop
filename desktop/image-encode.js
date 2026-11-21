'use strict';

/*
 * image-encode.js — 把 nativeImage 编成四种缩略图格式（1.1.20）
 *
 *   png   交给 Chromium，无损，法线图首选
 *   jpeg  交给 Chromium，质量默认 88，照片用它最省
 *   tiff  baseline 未压缩 RGB，自己写（Electron 不提供）
 *   tga   未压缩 24 位真彩，自己写（Electron 不提供）
 *
 * 两种自写格式都是“无压缩、从上到下、RGB/BGR”，刚好覆盖看图与后处理，
 * 不做 LZW/RLE —— 缩略图最大 1024，体积差可以接受，代码少一半出错点。
 */

const FORMATS = {
  png: { mime: 'image/png', ext: '.png' },
  jpeg: { mime: 'image/jpeg', ext: '.jpg' },
  tiff: { mime: 'image/tiff', ext: '.tiff' },
  tga: { mime: 'image/x-targa', ext: '.tga' }
};

const ALIASES = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  tif: 'tiff',
  tiff: 'tiff',
  tga: 'tga',
  targa: 'tga'
};

const DEFAULT_QUALITY = 88;

function normalizeFormat(value) {
  const key = String(value || 'png').toLowerCase().replace(/^\./, '');
  return ALIASES[key] || null;
}

/* TGA 2.0：18 字节头 + 未压缩 24 位 BGR，origin 置顶。 */
function encodeTga(image) {
  const size = image.getSize();
  const width = size.width;
  const height = size.height;
  const pixels = image.toBitmap();
  const header = Buffer.alloc(18);

  header[2] = 2; /* uncompressed true-color */
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header[16] = 24;
  header[17] = 0x20; /* 最高位 = 1：原点在左上 */

  const body = Buffer.alloc(width * height * 3);
  for (let i = 0, src = 0, dst = 0; i < width * height; i++, src += 4, dst += 3) {
    body[dst] = pixels[src]; /* B */
    body[dst + 1] = pixels[src + 1]; /* G */
    body[dst + 2] = pixels[src + 2]; /* R */
  }
  return Buffer.concat([header, body]);
}

/*
 * TIFF baseline（小端、无压缩、RGB）：
 *   8 字节头 → IFD（12 个标签）→ BitsPerSample / 分辨率 → 像素。
 * 标签必须按 tag 升序排列，值字段对 SHORT 是左对齐（低 2 字节）。
 */
function encodeTiff(image) {
  const size = image.getSize();
  const width = size.width;
  const height = size.height;
  const pixels = image.toBitmap();
  const pixelBytes = width * height * 3;

  const IFD_OFFSET = 8;
  const ENTRIES = 12;
  const IFD_BYTES = 2 + ENTRIES * 12 + 4;
  const bitsOffset = IFD_OFFSET + IFD_BYTES;
  const xresOffset = bitsOffset + 6;
  const yresOffset = xresOffset + 8;
  const dataOffset = yresOffset + 8;
  const buf = Buffer.alloc(dataOffset + pixelBytes);

  buf.write('II', 0, 'ascii');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(IFD_OFFSET, 4);
  buf.writeUInt16LE(ENTRIES, IFD_OFFSET);

  let at = IFD_OFFSET + 2;
  function entry(tag, type, count, value) {
    buf.writeUInt16LE(tag, at);
    buf.writeUInt16LE(type, at + 2);
    buf.writeUInt32LE(count, at + 4);
    buf.writeUInt32LE(value, at + 8);
    at += 12;
  }

  entry(256, 4, 1, width); /* ImageWidth */
  entry(257, 4, 1, height); /* ImageLength */
  entry(258, 3, 3, bitsOffset); /* BitsPerSample → 8,8,8 */
  entry(259, 3, 1, 1); /* Compression = none */
  entry(262, 3, 1, 2); /* Photometric = RGB */
  entry(273, 4, 1, dataOffset); /* StripOffsets */
  entry(277, 3, 1, 3); /* SamplesPerPixel */
  entry(278, 4, 1, height); /* RowsPerStrip */
  entry(279, 4, 1, pixelBytes); /* StripByteCounts */
  entry(282, 5, 1, xresOffset); /* XResolution */
  entry(283, 5, 1, yresOffset); /* YResolution */
  entry(296, 3, 1, 2); /* ResolutionUnit = inch */
  buf.writeUInt32LE(0, at); /* 没有下一个 IFD */

  buf.writeUInt16LE(8, bitsOffset);
  buf.writeUInt16LE(8, bitsOffset + 2);
  buf.writeUInt16LE(8, bitsOffset + 4);
  buf.writeUInt32LE(72, xresOffset);
  buf.writeUInt32LE(1, xresOffset + 4);
  buf.writeUInt32LE(72, yresOffset);
  buf.writeUInt32LE(1, yresOffset + 4);

  for (let i = 0, src = 0, dst = dataOffset; i < width * height; i++, src += 4, dst += 3) {
    buf[dst] = pixels[src + 2]; /* R */
    buf[dst + 1] = pixels[src + 1]; /* G */
    buf[dst + 2] = pixels[src]; /* B */
  }
  return buf;
}

/**
 * @param {Electron.NativeImage} image
 * @param {string} format png | jpeg | tiff | tga（别名 jpg/tif/targa 也认）
 * @param {number} [quality] JPEG 质量 1–100
 * @returns {{buffer:Buffer, mime:string, ext:string, format:string}}
 */
function encodeImage(image, format, quality) {
  const key = normalizeFormat(format);
  if (!key) throw new Error('不支持的缩略图格式：' + format);

  let buffer;
  if (key === 'png') {
    buffer = image.toPNG();
  } else if (key === 'jpeg') {
    const q = Math.max(1, Math.min(100, Math.round(Number(quality) || DEFAULT_QUALITY)));
    buffer = image.toJPEG(q);
  } else if (key === 'tiff') {
    buffer = encodeTiff(image);
  } else {
    buffer = encodeTga(image);
  }

  return { buffer: buffer, mime: FORMATS[key].mime, ext: FORMATS[key].ext, format: key };
}

module.exports = { encodeImage, normalizeFormat, FORMATS, DEFAULT_QUALITY };
