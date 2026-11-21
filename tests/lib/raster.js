'use strict';

/*
 * Minimal PNG / TGA encoders used to build test fixtures without any
 * dependency. Only supports what the fixtures need: 8-bit greyscale, RGB,
 * RGBA PNG, and uncompressed 24/32-bit TGA.
 */

const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * @param {{width:number,height:number,channels:1|3|4,data:Buffer}} options
 * @returns {Buffer} PNG file bytes
 */
function encodePNG({ width, height, channels, data }) {
  const colorType = { 1: 0, 3: 2, 4: 6 }[channels];
  if (colorType === undefined) throw new Error('channels must be 1, 3 or 4');
  if (data.length !== width * height * channels) {
    throw new Error(`expected ${width * height * channels} bytes, got ${data.length}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Uncompressed true-colour TGA (24 or 32 bit, top-left origin). */
function encodeTGA({ width, height, channels, data }) {
  if (channels !== 3 && channels !== 4) throw new Error('TGA needs 3 or 4 channels');
  const header = Buffer.alloc(18);
  header[2] = 2; // uncompressed true-colour
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header[16] = channels * 8;
  header[17] = 0x20; // top-left origin

  // TGA stores BGRA/BGR.
  const pixels = Buffer.alloc(width * height * channels);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    pixels[s] = data[s + 2];
    pixels[s + 1] = data[s + 1];
    pixels[s + 2] = data[s];
    if (channels === 4) pixels[s + 3] = data[s + 3];
  }
  return Buffer.concat([header, pixels]);
}

module.exports = { encodePNG, encodeTGA, crc32 };
