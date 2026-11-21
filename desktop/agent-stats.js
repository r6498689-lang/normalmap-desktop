'use strict';

/*
 * agent-stats.js — 给 Agent 回传“写出来的文件长什么样”。
 *
 * AI 看不到屏幕，只能靠数字判断结果对不对，所以每个导出文件都返回：
 * 字节数、SHA-256、宽高、亮度均值/最小/最大。
 * 统计直接读落盘后的文件，不读生成时的 canvas —— 验证的是磁盘上的东西。
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const { nativeImage } = require('electron');

/** @returns {{bytes:number, sha256:string, width:number|null, height:number|null, mean:number|null, min:number|null, max:number|null}} */
function fileStats(filePath) {
  const buf = fs.readFileSync(filePath);
  const out = {
    bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    width: null,
    height: null,
    mean: null,
    min: null,
    max: null
  };

  let image;
  try {
    image = nativeImage.createFromBuffer(buf);
  } catch {
    return out;
  }
  const size = image.getSize();
  if (!size.width || !size.height) return out;

  const bitmap = typeof image.toBitmap === 'function' ? image.toBitmap() : image.getBitmap();
  const pixels = size.width * size.height;
  if (!bitmap || bitmap.length < pixels * 4) return out;

  let sum = 0, squared = 0;
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixels; i++) {
    const b = bitmap[i * 4];
    const g = bitmap[i * 4 + 1];
    const r = bitmap[i * 4 + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += y;
    squared += y*y;
    if (y < min) min = y;
    if (y > max) max = y;
  }

  out.stddev = Math.sqrt(Math.max(0,squared/pixels-(sum/pixels)**2));
  out.width = size.width;
  out.height = size.height;
  out.mean = Math.round((sum / pixels) * 10) / 10;
  out.min = Math.round(min);
  out.max = Math.round(max);
  return out;
}

module.exports = { fileStats };
