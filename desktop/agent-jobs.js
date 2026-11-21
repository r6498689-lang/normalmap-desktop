'use strict';

/*
 * agent-jobs.js — 长任务的进度账本（1.1.21）
 *
 * 批量导出要跑十几秒到几分钟，调用方不能只“干等一个 HTTP 响应”。
 * 这里记三类东西：
 *   - job：一次批量任务的摘要（总张数、已完成、失败、状态、最终结果）；
 *   - events：按序递增的事件流（job_start / item_start / item_done / job_done）；
 *   - snapshot：调用方从某个 seq 开始取增量，用于轮询或 /events 端点。
 *
 * 只存内存，进程结束就没了；上限 1000 条事件、10 个任务，够一次会话用。
 */

const MAX_EVENTS = 1000;
const MAX_JOBS = 10;

function createJobStore(options) {
  const eventLimit = (options && options.eventLimit) || MAX_EVENTS;
  const jobLimit = (options && options.jobLimit) || MAX_JOBS;

  const events = [];
  const jobs = [];
  let seq = 0;
  let current = null;

  function stamp() {
    return new Date().toISOString();
  }

  function record(job, event) {
    seq += 1;
    const row = Object.assign({ seq: seq, at: stamp(), jobId: job.id }, event);
    events.push(row);
    if (events.length > eventLimit) events.splice(0, events.length - eventLimit);
    return row;
  }

  function start(kind, total, meta) {
    if (current) return { busy: current };
    const job = {
      id:
        String(kind || 'job') +
        '-' +
        Date.now().toString(36) +
        '-' +
        Math.random().toString(36).slice(2, 6),
      kind: String(kind || 'job'),
      total: Number(total) || 0,
      done: 0,
      failed: 0,
      status: 'running',
      startedAt: stamp(),
      finishedAt: null,
      cancelRequested: false,
      meta: meta || null,
      result: null
    };
    jobs.push(job);
    if (jobs.length > jobLimit) jobs.splice(0, jobs.length - jobLimit);
    current = job;
    record(job, { type: 'job_start', total: job.total });
    return { job: job };
  }

  function itemStart(job, index, data) {
    record(
      job,
      Object.assign({ type: 'item_start', index: index, total: job.total }, data || {})
    );
  }

  function itemDone(job, index, data) {
    const payload = data || {};
    job.done += 1;
    if (payload.ok === false) job.failed += 1;
    record(
      job,
      Object.assign({ type: 'item_done', index: index, total: job.total, done: job.done }, payload)
    );
  }

  function finish(job, result, options) {
    const cancelled = Boolean(options && options.cancelled);
    job.result = result || null;
    if (cancelled) job.status = 'cancelled';
    else if (result?.error) job.status = 'failed';
    else if (job.failed === 0 && job.done > 0) job.status = 'done';
    else if (job.done > job.failed) job.status = 'partial';
    else job.status = 'failed';
    job.finishedAt = stamp();
    record(job, {
      type: 'job_done',
      done: job.done,
      failed: job.failed,
      status: job.status,
      cancelled: cancelled
    });
    if (current === job) current = null;
    return job;
  }

  /*
   * 取消是“请求”不是“强杀”：批量只在一张图与下一张之间检查这个标记。
   * 已经写出的文件保留，编号已经消耗；没轮到的图直接跳过。
   */
  function requestCancel(jobId) {
    const job = jobId ? find(jobId) : current;
    if (!job) {
      return { ok: false, error: { code: 'no_job', message: '没有可取消的批量任务。' } };
    }
    if (job.status !== 'running') {
      return { ok: true, jobId: job.id, status: job.status, already: 'finished' };
    }
    job.cancelRequested = true;
    record(job, { type: 'cancel_requested' });
    return { ok: true, jobId: job.id, status: 'cancelling' };
  }

  function isCancelled(job) {
    return Boolean(job && job.cancelRequested);
  }

  function summary(job) {
    if (!job) return null;
    const out = {
      id: job.id,
      kind: job.kind,
      total: job.total,
      done: job.done,
      failed: job.failed,
      status: job.status,
      cancelRequested: Boolean(job.cancelRequested),
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      meta: job.meta
    };
    if (job.status !== 'running' && job.result) out.result = job.result;
    return out;
  }

  function find(jobId) {
    if (!jobId) return jobs[jobs.length - 1] || null;
    for (let i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].id === jobId) return jobs[i];
    }
    return null;
  }

  function snapshot(opts) {
    opts = opts || {};
    const job = find(opts.jobId);
    const since = Math.max(0, Number(opts.since) || 0);
    const list = events.filter(function (row) {
      if (row.seq <= since) return false;
      return job ? row.jobId === job.id : true;
    });
    return {
      ok: true,
      job: summary(job),
      events: list,
      nextSeq: seq
    };
  }

  return {
    start: start,
    itemStart: itemStart,
    itemDone: itemDone,
    finish: finish,
    requestCancel: requestCancel,
    isCancelled: isCancelled,
    snapshot: snapshot,
    isBusy: function () {
      return current ? current.id : null;
    },
    jobs: function () {
      return jobs.map(summary);
    }
  };
}

module.exports = { createJobStore };
