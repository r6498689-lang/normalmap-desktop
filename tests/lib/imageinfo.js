'use strict';

/* Reads pixel dimensions from PNG / JPEG / TGA without any dependency. */

const fs = require('node:fs');

function readTiffSize(filePath) {
  const buf = fs.readFileSync(filePath);
  const little = buf[0] === 0x49 && buf[1] === 0x49;
  const read16 = (o) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const read32 = (o) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifdOffset = read32(4);
  const count = read16(ifdOffset);
  let width = null;
  let height = null;
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    const tag = read16(entry);
    const type = read16(entry + 2);
    const value = type === 3 ? read16(entry + 8) : read32(entry + 8);
    if (tag === 0x0100) width = value;
    if (tag === 0x0101) height = value;
  }
  return { width, height, format: 'tiff' };
}

function readImageSize(filePath) {
  const buf = fs.readFileSync(filePath);

  // PNG
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
  }

  // TIFF (little or big endian)
  if (
    buf.length > 8 &&
    ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a) ||
      (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00))
  ) {
    return readTiffSize(filePath);
  }

  // TGA (no magic; fall back to the header)
  if (/\.tga$/i.test(filePath)) {
    return {
      width: buf.readUInt16LE(12),
      height: buf.readUInt16LE(14),
      bitsPerPixel: buf[16],
      format: 'tga'
    };
  }

  // JPEG: walk the segment chain to the first Start Of Frame.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length - 9) {
      if (buf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buf[offset + 1];
      const length = buf.readUInt16BE(offset + 2);
      const isSOF =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        return {
          width: buf.readUInt16BE(offset + 7),
          height: buf.readUInt16BE(offset + 5),
          format: 'jpeg'
        };
      }
      offset += 2 + length;
    }
    return { width: null, height: null, format: 'jpeg' };
  }

  return { width: null, height: null, format: 'unknown' };
}

function magicOf(filePath) {
  const buf = fs.readFileSync(filePath).subarray(0, 12);
  return buf.toString('hex');
}

module.exports = { readImageSize, readTiffSize, magicOf };
