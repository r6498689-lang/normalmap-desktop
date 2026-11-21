'use strict';

/*
 * save-manager.js
 * Owns every write to disk. The renderer can never name an arbitrary path:
 * it only supplies a suggested *file name* plus the encoded bytes, and the
 * user picks the destination through a native dialog.
 *
 * Responsibilities
 *   - validate that the bytes really are the file type being claimed
 *   - never silently overwrite an existing file (auto "(n)" suffix)
 *   - report per-file outcome so the UI can tell the truth about failures
 */

const fs = require('node:fs');
const path = require('node:path');

const IMAGE_TYPES = {
  png: { ext: '.png', mime: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  jpg: { ext: '.jpg', mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { ext: '.jpg', mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  tif: {
    ext: '.tif',
    mime: 'image/tiff',
    magic: [
      [0x49, 0x49, 0x2a, 0x00], // little endian
      [0x4d, 0x4d, 0x00, 0x2a] // big endian
    ]
  },
  tiff: {
    ext: '.tif',
    mime: 'image/tiff',
    magic: [
      [0x49, 0x49, 0x2a, 0x00],
      [0x4d, 0x4d, 0x00, 0x2a]
    ]
  }
};

const DIALOG_FILTERS = {
  png: [{ name: 'PNG image', extensions: ['png'] }],
  jpg: [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }],
  tif: [{ name: 'TIFF image', extensions: ['tif', 'tiff'] }]
};

// Characters Windows forbids in file names, plus control characters.
// eslint-disable-next-line no-control-regex
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
]);

function normalizeType(rawType) {
  const key = String(rawType || '').toLowerCase().replace(/^\./, '');
  return IMAGE_TYPES[key] ? key : null;
}

function sanitizeBaseName(rawName, fallback) {
  let name = String(rawName || '');
  name = name.replace(ILLEGAL_NAME_CHARS, '_');
  name = name.replace(/\.+$/, '');
  name = name.trim();
  // Strip an extension the user may have typed; we append our own.
  name = name.replace(/\.(png|jpe?g|tiff?)$/i, '');
  name = name.trim();
  if (!name) {
    name = fallback;
  }
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    name = `${name}_`;
  }
  return name.slice(0, 120);
}

function matchesMagic(buffer, magicList) {
  return magicList.some((signature) => {
    if (buffer.length < signature.length) return false;
    return signature.every((byte, index) => buffer[index] === byte);
  });
}

/**
 * Validates one renderer-supplied record.
 * @returns {{ok: true, baseName: string, type: string, bytes: Buffer} | {ok: false, error: string}}
 */
function validateRecord(record, index) {
  if (!record || typeof record !== 'object') {
    return { ok: false, error: `File #${index + 1}: empty record.` };
  }

  const type = normalizeType(record.type);
  if (!type) {
    return { ok: false, error: `File #${index + 1}: unsupported image type "${record.type}".` };
  }

  const raw = record.data;
  let bytes;
  if (raw instanceof Uint8Array) {
    bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  } else if (raw instanceof ArrayBuffer) {
    bytes = Buffer.from(raw);
  } else {
    return { ok: false, error: `File #${index + 1}: payload is not binary data.` };
  }

  if (bytes.length === 0) {
    return { ok: false, error: `File #${index + 1}: generated file is empty.` };
  }
  if (bytes.length > 512 * 1024 * 1024) {
    return { ok: false, error: `File #${index + 1}: generated file exceeds 512 MB.` };
  }
  if (!matchesMagic(bytes, IMAGE_TYPES[type].magic)) {
    return {
      ok: false,
      error: `File #${index + 1}: data is not a valid ${type.toUpperCase()} image.`
    };
  }

  return {
    ok: true,
    baseName: sanitizeBaseName(record.name, 'NormalMap'),
    type,
    bytes
  };
}

/** Finds a free file name inside `dir`, appending " (1)", " (2)", ... */
/** Extension sets that are genuinely the same format, per encoded type. */
const EXT_ALIASES = {
  png: ['.png'],
  jpg: ['.jpg', '.jpeg'],
  jpeg: ['.jpg', '.jpeg'],
  tif: ['.tif', '.tiff'],
  tiff: ['.tif', '.tiff']
};

/**
 * True when `ext` (with leading dot, lower case) truthfully describes the
 * bytes of `type`. Used before writing a user-chosen path: a save dialog lets
 * the user type any name, and a PNG written into "photo.jpg" is a file that
 * lies about itself.
 */
function extensionMatches(type, ext) {
  const allowed = EXT_ALIASES[type];
  if (!allowed) return false;
  return allowed.includes(String(ext || '').toLowerCase());
}

/** Canonical extension for a type, e.g. '.jpg' for both jpg and jpeg. */
function canonicalExtension(type) {
  return IMAGE_TYPES[type] ? IMAGE_TYPES[type].ext : '';
}

function uniqueTarget(dir, baseName, ext) {
  let candidate = path.join(dir, baseName + ext);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${baseName} (${counter})${ext}`);
    counter += 1;
    if (counter > 9999) {
      throw new Error('目标文件夹里同名文件过多。');
    }
  }
  return { fullPath: candidate, fileName: path.basename(candidate), renamed: counter > 1 };
}

function writeRecord(dir, validated) {
  const { ext } = IMAGE_TYPES[validated.type];
  const { fullPath, fileName, renamed } = uniqueTarget(dir, validated.baseName, ext);
  fs.writeFileSync(fullPath, validated.bytes, { flag: 'wx' });
  return { ok: true, fileName, path: fullPath, bytes: validated.bytes.length, renamed };
}

function safeWriteRecord(dir, validated) {
  try {
    return writeRecord(dir, validated);
  } catch (err) {
    return {
      ok: false,
      fileName: validated.baseName + IMAGE_TYPES[validated.type].ext,
      error: describeFsError(err)
    };
  }
}

function describeFsError(err) {
  switch (err && err.code) {
    case 'EACCES':
    case 'EPERM':
      return '没有写入权限，请换一个你有权限的文件夹。';
    case 'ENOSPC':
      return '磁盘已满。';
    case 'EROFS':
      return '目标位置是只读的。';
    case 'ENAMETOOLONG':
      return '生成的文件名过长。';
    case 'ENOENT':
      return '文件夹已不存在。';
    case 'EINVAL':
      return '该文件夹不接受这个文件名。';
    case 'EEXIST':
      return '保存过程中该文件刚被创建，请重试。';
    default:
      return (err && err.message) || '未知的写入错误。';
  }
}

/** Validates a batch up front so the dialog only appears once. */
function validateBatch(records) {
  const valid = [];
  const errors = [];
  records.forEach((record, index) => {
    const result = validateRecord(record, index);
    if (result.ok) {
      valid.push(result);
    } else {
      errors.push(result.error);
    }
  });
  return { valid, errors };
}

module.exports = {
  IMAGE_TYPES,
  DIALOG_FILTERS,
  normalizeType,
  sanitizeBaseName,
  validateRecord,
  validateBatch,
  safeWriteRecord,
  uniqueTarget,
  describeFsError,
  extensionMatches,
  canonicalExtension
};
