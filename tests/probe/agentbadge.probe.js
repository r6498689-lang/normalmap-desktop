'use strict';

/*
 * agentbadge.probe.js — 验证“AI 正在操作”徽标的实际外观。
 *
 *   node tests/probe.js agentbadge
 *
 * 模拟主进程推送一条批量完成事件，读回徽标文字/位置并截图；
 * 再推 stopped，确认它会消失。
 */

const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);

  ctx.win.webContents.send('nmo:agent-activity', {
    cmd: 'batch',
    ok: true,
    done: true,
    written: 4,
    failed: 0
  });
  await ctx.wait(350);

  const read = () =>
    ctx.js(`(function () {
      var el = document.getElementById('nmo_agent_badge');
      if (!el) return null;
      var cs = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      return {
        text: el.textContent,
        className: el.className,
        display: cs.display,
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
        color: cs.color,
        bg: cs.backgroundColor,
        dot: getComputedStyle(el, '::before').backgroundColor
      };
    })()`);

  const visible = await read();
  const shot = await ctx.screenshot('agent-badge.png');
  const closeup = await ctx.screenshotRect('agent-badge-closeup.png', {
    x: Math.max(0, visible.x - 6),
    y: Math.max(0, visible.y - 6),
    width: visible.width + 12,
    height: visible.height + 12
  });

  ctx.win.webContents.send('nmo:agent-activity', { state: 'stopped' });
  await ctx.wait(180);
  const hidden = await read();

  return {
    visible: visible,
    hidden: hidden,
    screenshots: { full: shot, closeup: closeup },
    page: await ctx.js(`({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth
    })`)
  };
};
