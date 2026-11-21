'use strict';

/*
 * perf.spec.js
 * 大图处理时间与资源占用。只报告实测值，不宣称“支持上限”。
 */

const fs = require('node:fs');
const path = require('node:path');
const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  await driver.waitForBoot(ctx);

  const gpu = await ctx.js(`(function(){
    var c = document.createElement('canvas');
    var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return { ok: false };
    var ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      ok: true,
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      devicePixelRatio: window.devicePixelRatio,
      viewport: [window.innerWidth, window.innerHeight]
    };
  })()`);

  check('WebGL 可用', gpu.ok === true, JSON.stringify(gpu));

  const results = [];

  const measure = async (label, file, targetW) => {
    const t0 = Date.now();
    if (file) await driver.loadHeightFile(ctx, file);
    await ctx.waitFor(`NMO_NormalMap.normal_canvas.width === ${targetW}`, 60000);
    await ctx.wait(300);
    const ms = Date.now() - t0;
    const sizes = await driver.canvasSizes(ctx);
    const metrics = ctx.app.getAppMetrics();
    const memoryMb =
      metrics.reduce((sum, m) => sum + (m.memory && m.memory.workingSetSize ? m.memory.workingSetSize : 0), 0) /
      1024;
    results.push({ label, ms, sizes: sizes.normal, memoryMb: Number(memoryMb.toFixed(1)) });
    return ms;
  };

  await measure('512x512（启动默认图）', null, 512);
  await measure('256x256', driver.fixture('height-bumps-256.png'), 256);
  await measure('2048x2048', driver.fixture('height-large-2048.png'), 2048);

  check(
    '2048x2048 在合理时间内完成（< 20s）',
    results[2].ms < 20000,
    results[2].ms + ' ms'
  );
  check('大图输出尺寸为 2048x2048', results[2].sizes[0] === 2048 && results[2].sizes[1] === 2048, JSON.stringify(results[2].sizes));

  // 软件渲染时必须如实标注
  const softwareRendering = /swiftshader|software|llvmpipe/i.test(String(gpu.renderer));

  return {
    ok: failures.length === 0,
    spec: 'perf',
    gpu,
    softwareRendering,
    environment: {
      platform: process.platform,
      arch: process.arch,
      cpus: require('node:os').cpus().length,
      totalMemGb: Number((require('node:os').totalmem() / 1024 / 1024 / 1024).toFixed(1)),
      electron: process.versions.electron,
      chrome: process.versions.chrome
    },
    measurements: results,
    note: '耗时含文件读取、解码、四类贴图生成与预览刷新；为单次采样，不代表稳定吞吐。',
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
