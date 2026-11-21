'use strict';

/*
 * preview-zoom.js — 左侧高度图 / 中间贴图预览的滚轮缩放
 *
 * 右侧 3D 预览的缩放由 OrbitControls 的 dolly 负责；这两张 2D 画布原本
 * 是死的，只能看固定尺寸。这里补上同样的手感：
 *
 *   - 滚轮：以光标位置为中心缩放，1× ～ 6×；
 *   - 放大后按住左键拖动：平移；
 *   - 双击：回到 1×；
 *   - 缩放状态在切换选项卡后保留（每个预览各记各的）。
 *
 * 实现只用 CSS transform，不改 canvas 的 width/height —— 重绘预览时
 * （改参数、换预设）画布尺寸会被 JS 重设，transform 不受影响。
 */

(function () {
	var MIN_SCALE = 1;
	var MAX_SCALE = 6;
	var ZOOM_SENSITIVITY = 0.0016; // e.deltaY 每 100 约 17%
	var DRAG_THRESHOLD = 3; // 小于 3px 仍算点击，不吞掉“点一下选图”
	var BADGE_HIDE_MS = 900;

	var states = new WeakMap();

	function styleNumber(el, name, fallback) {
		var v = parseFloat(window.getComputedStyle(el)[name]);
		return isNaN(v) ? fallback : v;
	}

	/* 画布在预览框内容区里的“原始”位置：水平靠 text-align:center，
	   垂直靠 .helper 的 min-height 撑满后 vertical-align:middle。
	   每次都按当前 offsetWidth/offsetHeight 现算，重绘后不会错位。 */
	function measure(view, canvas) {
		var padL = styleNumber(view, 'paddingLeft', 0);
		var padT = styleNumber(view, 'paddingTop', 0);
		var padR = styleNumber(view, 'paddingRight', 0);
		var padB = styleNumber(view, 'paddingBottom', 0);
		var contentW = view.clientWidth - padL - padR;
		var contentH = view.clientHeight - padT - padB;
		var w = canvas.offsetWidth;
		var h = canvas.offsetHeight;
		return {
			padL: padL,
			padT: padT,
			borderL: styleNumber(view, 'borderLeftWidth', 0),
			borderT: styleNumber(view, 'borderTopWidth', 0),
			contentW: contentW,
			contentH: contentH,
			w: w,
			h: h,
			baseX: (contentW - w) / 2,
			baseY: (contentH - h) / 2
		};
	}

	function clampPan(state, box) {
		var zw = box.w * state.scale;
		var zh = box.h * state.scale;
		if (zw <= box.contentW) state.tx = 0;
		else state.tx = Math.min(0, Math.max(box.contentW - zw, state.tx));
		if (zh <= box.contentH) state.ty = 0;
		else state.ty = Math.min(0, Math.max(box.contentH - zh, state.ty));
	}

	function apply(state) {
		var c = state.canvas;
		c.style.transformOrigin = '0 0';
		c.style.transform =
			'translate(' + state.tx.toFixed(2) + 'px,' + state.ty.toFixed(2) + 'px) ' +
			'scale(' + state.scale.toFixed(4) + ')';
		if (state.scale > 1.001) {
			c.style.cursor = state.dragging ? 'grabbing' : 'grab';
		} else {
			c.style.cursor = state.baseCursor;
		}
		updateBadge(state);
	}

	function updateBadge(state) {
		var badge = state.badge;
		if (!badge) return;
		if (state.scale <= 1.001) {
			badge.classList.remove('is-visible');
			return;
		}
		badge.textContent = '×' + state.scale.toFixed(1);
		badge.classList.add('is-visible');
		clearTimeout(state.badgeTimer);
		state.badgeTimer = setTimeout(function () {
			badge.classList.remove('is-visible');
		}, BADGE_HIDE_MS);
	}

	function reset(state) {
		state.scale = 1;
		state.tx = 0;
		state.ty = 0;
		apply(state);
	}

	function onWheel(e) {
		var state = states.get(this);
		if (!state) return;
		/* 始终拦下来：预览框上滚动不该带动整页 */
		e.preventDefault();

		var box = measure(this, state.canvas);

		var rect = this.getBoundingClientRect();
		var cx = e.clientX - rect.left - box.borderL - box.padL;
		var cy = e.clientY - rect.top - box.borderT - box.padT;

		var delta = e.deltaY;
		if (e.deltaMode === 1) delta *= 16;
		else if (e.deltaMode === 2) delta *= box.contentH;

		var next = state.scale * Math.exp(-delta * ZOOM_SENSITIVITY);
		next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
		if (Math.abs(next - state.scale) < 1e-4) return;

		/* 光标下的那个像素在缩放前后保持不动 */
		var ux = (cx - (box.baseX + state.tx)) / state.scale;
		var uy = (cy - (box.baseY + state.ty)) / state.scale;

		state.scale = next;
		if (next <= 1.0001) {
			state.scale = 1;
			state.tx = 0;
			state.ty = 0;
		} else {
			state.tx = cx - box.baseX - ux * next;
			state.ty = cy - box.baseY - uy * next;
			clampPan(state, box);
		}
		apply(state);
	}

	function onPointerDown(e) {
		var state = states.get(this);
		if (!state || e.button !== 0 || state.scale <= 1.001) return;
		state.dragging = true;
		state.moved = false;
		state.startX = e.clientX;
		state.startY = e.clientY;
		state.startTx = state.tx;
		state.startTy = state.ty;
		state.pointerId = e.pointerId;
		try {
			this.setPointerCapture(e.pointerId);
		} catch (err) {
			/* 某些环境下没有 pointer capture，退化成普通拖动 */
		}
		apply(state);
	}

	function onPointerMove(e) {
		var state = states.get(this);
		if (!state || !state.dragging) return;
		var dx = e.clientX - state.startX;
		var dy = e.clientY - state.startY;
		if (!state.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
			return;
		}
		state.moved = true;
		e.preventDefault();

		var box = measure(this, state.canvas);
		state.tx = state.startTx + dx;
		state.ty = state.startTy + dy;
		clampPan(state, box);
		apply(state);
	}

	function onPointerUp(e) {
		var state = states.get(this);
		if (!state || !state.dragging) return;
		state.dragging = false;
		try {
			this.releasePointerCapture(e.pointerId);
		} catch (err) {
			/* 同上 */
		}
		apply(state);
	}

	/* 放大状态下的单击（包括高度图上的“点一下选图”）会打断查看，
	   直接吞掉；拖动松手后紧跟的那次 click 也在这里被吃掉。 */
	function onClickCapture(e) {
		var state = states.get(this);
		if (!state) return;
		if (state.moved || state.scale > 1.001) {
			e.preventDefault();
			e.stopPropagation();
		}
		state.moved = false;
	}

	function onDoubleClick(e) {
		var state = states.get(this);
		if (!state) return;
		if (state.scale > 1.001) {
			e.preventDefault();
			e.stopPropagation();
			reset(state);
		}
	}

	function attach(view) {
		if (!view || states.has(view)) return;
		var canvas = view.querySelector('canvas');
		if (!canvas) return;

		var state = {
			view: view,
			canvas: canvas,
			scale: 1,
			tx: 0,
			ty: 0,
			dragging: false,
			moved: false,
			baseCursor: canvas.style.cursor || '',
			badge: null,
			badgeTimer: 0
		};
		states.set(view, state);

		/* 缩放倍数的小角标：只在放大时出现，1 秒后淡出 */
		var badge = document.createElement('span');
		badge.className = 'preview_zoom_badge';
		view.appendChild(badge);
		state.badge = badge;

		if (!view.getAttribute('title')) {
			view.setAttribute('title', '滚轮缩放 · 放大后拖动平移 · 双击还原');
		}

		view.addEventListener('wheel', onWheel, { passive: false });
		view.addEventListener('pointerdown', onPointerDown);
		view.addEventListener('pointermove', onPointerMove);
		view.addEventListener('pointerup', onPointerUp);
		view.addEventListener('pointercancel', onPointerUp);
		view.addEventListener('click', onClickCapture, true);
		view.addEventListener('dblclick', onDoubleClick);
		view.addEventListener('dragstart', function (e) {
			e.preventDefault();
		});
	}

	function attachAll() {
		var height = document.getElementById('height_map');
		if (height) attach(height);

		var container = document.querySelector('.texture_container');
		if (container) {
			var views = container.querySelectorAll('.view');
			for (var i = 0; i < views.length; i++) attach(views[i]);
		}
	}

	function scaleOf(id) {
		var view = document.getElementById(id);
		var state = view && states.get(view);
		return state ? state.scale : 1;
	}

	function resetOne(id) {
		var view = document.getElementById(id);
		var state = view && states.get(view);
		if (state) reset(state);
	}

	function resetAll() {
		var height = document.getElementById('height_map');
		if (height && states.has(height)) reset(states.get(height));
		var container = document.querySelector('.texture_container');
		if (!container) return;
		var views = container.querySelectorAll('.view');
		for (var i = 0; i < views.length; i++) {
			if (states.has(views[i])) reset(states.get(views[i]));
		}
	}

	window.NMO_PreviewZoom = {
		attachAll: attachAll,
		getScale: scaleOf,
		reset: resetOne,
		resetAll: resetAll
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', attachAll);
	} else {
		attachAll();
	}
})();
