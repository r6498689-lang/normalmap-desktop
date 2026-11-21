'use strict';

/*
 * hidden.probe.js — 实验：窗口隐藏后，渲染进程还能不能生成贴图，慢多少。
 *
 * 只回答一个问题：Agent 要“完全后台”跑，是否必须把窗口留在屏幕上。
 * 结果只写 evidence/probe/hidden.json，不改产品代码。
 */

const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  await driver.loadHeightFile(ctx, driver.fixture('height-large-2048.png'));
  await ctx.wait(900);

  const gen = async (type) => {
    const t0 = Date.now();
    const out = await ctx.js(`NMO_Main.buildImageRecord(${JSON.stringify(type)}, 'probe').then(function (r) {
      var s = String(r.data || '');
      var sum = 0;
      for (var i = 0; i < s.length; i += 97) sum = (sum * 31 + s.charCodeAt(i)) >>> 0;
      return { type: r.type, len: s.length, sum: sum };
    })`);
    return { ms: Date.now() - t0, len: out.len, sum: out.sum, type: out.type };
  };

  const visible = {
    normal: await gen('NormalMap'),
    displacement: await gen('DisplacementMap')
  };

  ctx.win.hide();
  await ctx.wait(900);
  const pageState = await ctx.js('({ state: document.visibilityState, hidden: document.hidden })');

  const hidden = {
    normal: await gen('NormalMap'),
    displacement: await gen('DisplacementMap')
  };

  ctx.win.show();
  await ctx.wait(900);

  const again = {
    normal: await gen('NormalMap'),
    displacement: await gen('DisplacementMap')
  };

  const same = (a, b) => a.len === b.len && a.sum === b.sum;

  return {
    ok: true,
    spec: 'hidden',
    pageState,
    visible,
    hidden,
    again,
    identical: {
      normal: same(visible.normal, hidden.normal) && same(visible.normal, again.normal),
      displacement:
        same(visible.displacement, hidden.displacement) && same(visible.displacement, again.displacement)
    },
    checkedAt: new Date().toISOString()
  };
};
