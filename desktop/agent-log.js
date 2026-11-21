'use strict';

/*
 * agent-log.js — Agent 命令审计（追加式 JSONL）
 *
 * 目的：出了问题时能回答“谁在什么时候让程序做了什么、结果如何”，
 * 而不是只能翻控制台。默认写在 userData 下的 agent-log.jsonl。
 *
 * 三条硬规则：
 *   1. 只追加，不改历史；超过 5 MB 轮转成 agent-log.1.jsonl（只留一代）。
 *   2. 绝不写图片内容：base64 / data 字段一律替换成“长度说明”。
 *   3. 日志本身出错不能影响命令执行——写失败就静默放弃。
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_LINES = 200;
const MAX_STRING = 300;

function sanitize(value, depth) {
  if (depth > 3) return '…';
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitize(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      const entry = value[key];
      if (key === 'base64' || key === 'data') {
        out[key] = '（' + (typeof entry === 'string' ? entry.length : 0) + ' 字符，已省略）';
        continue;
      }
      out[key] = sanitize(entry, depth + 1);
    }
    return out;
  }
  return value;
}

/* 只留体积小、对排查有用的字段，避免把 50 张图的明细全抄一遍。 */
function briefResult(result) {
  if (!result || typeof result !== 'object') return null;
  const brief = { ok: result.ok === true };
  if (result.ok === false && result.error) {
    brief.code = result.error.code;
    brief.message = String(result.error.message || '').slice(0, 200);
  }
  for (const key of ['category', 'count', 'total', 'succeeded', 'failed', 'written', 'skipped', 'jobId', 'status', 'visible', 'cancelled', 'skippedDone']) {
    if (result[key] !== undefined) brief[key] = result[key];
  }
  if (result.image) {
    brief.image = {
      name: result.image.name,
      format: result.image.format,
      width: result.image.width,
      height: result.image.height,
      thumbWidth: result.image.thumbWidth,
      thumbHeight: result.image.thumbHeight
    };
  }
  if (Array.isArray(result.items)) brief.items = result.items.length;
  if (Array.isArray(result.outputs)) brief.outputs = result.outputs.length;
  return brief;
}

function createAuditLog(options) {
  options = options || {};
  const dir = options.dir;
  if (!dir) {
    return { enabled: false, write: () => {}, recent: () => null, file: null };
  }
  const file = path.join(dir, 'agent-log.jsonl');
  const rotated = path.join(dir, 'agent-log.1.jsonl');

  function rotateIfNeeded() {
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size < MAX_BYTES) return;
    try {
      if (fs.existsSync(rotated)) fs.rmSync(rotated, { force: true });
      fs.renameSync(file, rotated);
    } catch {
      /* 轮转失败就继续往原文件追加 */
    }
  }

  function write(cmd, args, result, durationMs) {
    const entry = {
      at: new Date().toISOString(),
      cmd: String(cmd || ''),
      ms: Math.round(durationMs),
      result: briefResult(result)
    };
    if (args && Object.keys(args).length) entry.args = sanitize(args, 0);
    try {
      fs.mkdirSync(dir, { recursive: true });
      rotateIfNeeded();
      fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      /* 审计失败不拖累业务 */
    }
  }

  function recent(lines) {
    const wanted = Math.max(1, Math.min(MAX_LINES, Math.round(Number(lines) || 20)));
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return { file: file, bytes: 0, entries: [] };
    }
    const all = text.split('\n').filter(Boolean);
    const tail = all.slice(-wanted);
    const entries = [];
    for (const line of tail) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        entries.push({ at: null, cmd: null, badLine: true });
      }
    }
    let bytes = 0;
    try {
      bytes = fs.statSync(file).size;
    } catch {
      /* ignore */
    }
    return { file: file, bytes: bytes, total: all.length, entries: entries };
  }

  return { enabled: true, write: write, recent: recent, file: file };
}

module.exports = { createAuditLog };
