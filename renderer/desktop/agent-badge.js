/*
 * agent-badge.js — 让用户看见 AI 在操作这个程序
 *
 * 主进程在每条 Agent 命令结束后发一条 nmo:agent-activity：
 *   { state: 'connected' }            桥刚启动
 *   { cmd: 'export', ok: true, ... }  某条命令完成
 * 这里只负责渲染左下角的小徽标，不参与任何图像逻辑。
 */

(function () {
	'use strict';

	var el = null;
	var timer = null;

	function ensure() {
		if (el && el.isConnected) return el;
		el = document.createElement('div');
		el.id = 'nmo_agent_badge';
		el.setAttribute('role', 'status');
		el.setAttribute('aria-live', 'polite');
		document.body.appendChild(el);
		return el;
	}

	function paint(text, mode) {
		var node = ensure();
		node.textContent = text;
		node.className = 'nmo_agent_badge_visible ' + (mode || '');
	}

	function hide() {
		window.clearTimeout(timer);
		if (el) el.className = '';
	}

	function connected() {
		window.clearTimeout(timer);
		paint('AI 已连接', 'connected');
	}

	function activity(payload) {
		if (!payload) return;
		if (payload.state === 'stopped') {
			hide();
			return;
		}
		if (payload.state === 'connected') {
			connected();
			return;
		}

		var label = payload.cmd ? 'AI · ' + payload.cmd : 'AI 工作中';
		if (payload.ok === false) label += ' · 失败';
		else if (payload.done || payload.finished) label += ' · 完成';
		paint(label, 'active');

		window.clearTimeout(timer);
		timer = window.setTimeout(connected, 4000);
	}

	function check(retries) {
		if (!window.nmoDesktop || typeof window.nmoDesktop.getAgentState !== 'function') return;
		window.nmoDesktop.getAgentState().then(function (state) {
			if (state && state.active) {
				if (state.last) activity(state.last);
				else connected();
			} else if (retries > 0) {
				/* Agent 桥可能在页面加载之后才启动，再等一会儿。 */
				window.setTimeout(function () {
					check(retries - 1);
				}, 1200);
			}
		});
	}

	window.NMO_AgentBadge = {
		activity: activity,
		connected: connected,
		hide: hide
	};

	if (window.nmoDesktop) {
		if (typeof window.nmoDesktop.onAgentActivity === 'function') {
			window.nmoDesktop.onAgentActivity(activity);
		}
		check(2);
	}
})();
