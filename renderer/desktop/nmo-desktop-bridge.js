/*
 * nmo-desktop-bridge.js
 * Desktop-only adapter. Loaded after the original scripts, it:
 *   1. routes every export through native dialogs instead of saveAs()
 *   2. shows honest status/progress/error feedback for writes
 *   3. turns http(s) links into "open in system browser" actions
 * It contains no image maths. See docs/ARCHITECTURE.md.
 */

/* global NMO_Main */

var NMO_Desktop = new (function () {
	this.enabled = Boolean(window.nmoDesktop);

	var statusEl = null;
	var statusTimer = null;
	var busy = 0;

	function ensureStatus() {
		if (statusEl && statusEl.isConnected) return statusEl;
		statusEl = document.createElement('div');
		statusEl.id = 'nmo_status';
		statusEl.setAttribute('role', 'status');
		statusEl.setAttribute('aria-live', 'polite');
		document.body.appendChild(statusEl);
		return statusEl;
	}

	this.status = function (message, kind, keep) {
		var el = ensureStatus();
		el.textContent = message;
		el.className = 'nmo_status_visible ' + (kind || 'info');
		window.clearTimeout(statusTimer);
		if (!keep) {
			statusTimer = window.setTimeout(function () {
				if (busy === 0) {
					el.className = '';
					el.textContent = '';
				}
			}, kind === 'error' ? 14000 : 7000);
		}
	};

	function formatBytes(bytes) {
		if (typeof bytes !== 'number') return '?';
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
	}

	/* ------------------------------------------------------------------ */
	/* Single save                                                         */
	/* ------------------------------------------------------------------ */
	this.saveOne = async function (record) {
		if (!this.enabled) {
			this.status('桌面桥接层不可用，无法保存。', 'error');
			return { ok: false, canceled: true };
		}
		var result;
		try {
			result = await window.nmoDesktop.saveSingle(record);
		} catch (err) {
			this.status('保存失败：' + (err && err.message ? err.message : err), 'error');
			return { ok: false, canceled: false };
		}

		if (result.canceled) {
			this.status('已取消保存，未写入任何文件；结果仍保留在界面中。', 'info');
			return result;
		}
		if (result.ok) {
			var msg = '已保存 ' + result.fileName + '（' + formatBytes(result.bytes) + '）';
			if (result.notice) msg += '\n' + result.notice;
			this.status(msg, 'ok');
		} else {
			this.status('保存失败：' + result.error, 'error');
		}
		return result;
	};

	/* ------------------------------------------------------------------ */
	/* Folder sessions: one dialog, many files, per-file outcome           */
	/* ------------------------------------------------------------------ */
	this.openFolder = async function (label, baseName) {
		if (!this.enabled) {
			this.status('桌面桥接层不可用，无法导出。', 'error');
			return null;
		}
		var session;
		try {
			session = await window.nmoDesktop.beginBatch({ suggestedName: baseName || 'NormalMap' });
		} catch (err) {
			this.status('无法选择文件夹：' + (err && err.message ? err.message : err), 'error');
			return null;
		}
		if (session.canceled) {
			this.status(label + '：已取消，未写入任何文件。', 'info');
			return null;
		}
		if (session.error) {
			this.status('无法写入该文件夹：' + session.error, 'error');
			return null;
		}
		busy += 1;
		// Two counters, two sources: `written`/`renamed` come from the main
		// process, generation failures are only visible here. `failed` is not
		// stored on the context at all, so a failure cannot be counted twice.
		return {
			token: session.token,
			dir: session.dir,
			written: 0,
			renamed: 0,
			genFailures: [],
			lastError: ''
		};
	};

	this.writeRecord = async function (ctx, record) {
		var res = await window.nmoDesktop.writeBatchFile(ctx.token, record);
		if (res && res.ok) {
			ctx.written += 1;
			if (res.renamed) ctx.renamed += 1;
		} else {
			// The write failure is counted by the main process (summary.failed);
			// only the message is kept here.
			ctx.lastError = (res && res.error) || '未知的写入错误。';
		}
		return res;
	};

	/* Records a failure that happened before any IPC call: canvas encoding
	 * failed, no canvas existed, or the source image could not be decoded. */
	this.recordFailure = function (ctx, name, error) {
		ctx.genFailures.push({
			name: name || '(未命名)',
			error: error && error.message ? error.message : String(error)
		});
		ctx.lastError = (name ? name + ': ' : '') + (error && error.message ? error.message : String(error));
	};

	this.finishBatch = async function (ctx, label) {
		busy = Math.max(0, busy - 1);
		var summary = await window.nmoDesktop.endBatch(ctx.token);
		if (!summary || summary.error) {
			this.status(label + ' 失败：' + ((summary && summary.error) || '会话已丢失'), 'error');
			return { ok: false, written: 0, failed: 0, dir: ctx.dir, error: (summary && summary.error) || '会话已丢失' };
		}

		var written = summary.written || 0;
		var renamed = summary.renamed || 0;
		var writeFailed = summary.failed || 0;
		var genFailed = ctx.genFailures.length;
		var failed = writeFailed + genFailed;

		var text = label + '：已写入 ' + written + ' 个文件';
		if (renamed > 0) text += ' · ' + renamed + ' 个重命名以避免覆盖';
		if (failed > 0) {
			var parts = [];
			if (genFailed > 0) parts.push(genFailed + ' 个生成失败');
			if (writeFailed > 0) parts.push(writeFailed + ' 个写入失败');
			text += ' · ' + failed + ' 个失败（' + parts.join('，') + '）';
		}
		text += '\n' + summary.dir;

		// Show up to three concrete reasons, generation failures first, so the
		// summary names what failed instead of only counting it.
		var reasons = ctx.genFailures.slice(0, 3).map(function (f) {
			return '· ' + f.name + ': ' + f.error;
		});
		(summary.errors || []).slice(0, 3).forEach(function (e) {
			reasons.push('· ' + e);
		});
		if (reasons.length > 0) text += '\n' + reasons.join('\n');
		if (ctx.note) text += '\n' + ctx.note;

		// A batch is only "ok" when something was written and nothing failed.
		var ok = written > 0 && failed === 0;
		this.status(text, ok ? 'ok' : 'error');

		return {
			ok: ok,
			dir: summary.dir,
			written: written,
			renamed: renamed,
			failed: failed,
			genFailed: genFailed,
			writeFailed: writeFailed,
			failures: ctx.genFailures.concat(
				(summary.errors || []).map(function (e) {
					return { name: '(write)', error: e };
				})
			),
			files: summary.files || []
		};
	};

	/**
	 * Export `total` images into one folder.
	 * `produce(i)` runs only after the folder is confirmed, so long batches
	 * never hold every image in memory at once.
	 */
	this.exportMany = async function (options) {
		var label = options.label || '导出';
		var ctx = await this.openFolder(label, options.baseName);
		if (!ctx) return { ok: false, canceled: true };

		try {
			for (var i = 0; i < options.total; i++) {
				this.status(label + ' … ' + (i + 1) + '/' + options.total, 'info', true);
				var record;
				try {
					record = await options.produce(i);
				} catch (err) {
					this.recordFailure(ctx, options.nameFor ? options.nameFor(i) : '#' + (i + 1), err);
					continue;
				}
				if (!record) {
					this.recordFailure(
						ctx,
						options.nameFor ? options.nameFor(i) : '#' + (i + 1),
						'页面没有返回图像数据。'
					);
					continue;
				}
				await this.writeRecord(ctx, record);
			}
		} catch (err) {
			// An IPC failure must not strand the session: fall through to
			// finishBatch so the folder is closed and the UI stops showing busy.
			this.recordFailure(ctx, options.nameFor ? options.nameFor(0) : 'export', err);
		}

		return this.finishBatch(ctx, label);
	};

	/* ------------------------------------------------------------------ */
	/* Number library + planned export                                     */
	/* ------------------------------------------------------------------ */
	this.planExport = async function (request) {
		if (!this.enabled) {
			this.status('桌面桥接层不可用，无法导出。', 'error');
			return { canceled: true };
		}
		var prepared;
		try {
			prepared = await window.nmoDesktop.planExport(request || {});
		} catch (err) {
			this.status('无法开始导出：' + ((err && err.message) || err), 'error');
			return { canceled: false, error: (err && err.message) || String(err) };
		}
		if (prepared.canceled) {
			this.status((request && request.label ? request.label : '导出') + '：已取消，未写入任何文件。', 'info');
			return prepared;
		}
		if (prepared.error) {
			this.status('导出失败：' + prepared.error, 'error');
			return prepared;
		}
		busy += 1;
		return prepared;
	};

	this.writePlanFile = async function (token, record) {
		try {
			return await window.nmoDesktop.writePlanFile(token, record);
		} catch (err) {
			return { ok: false, error: (err && err.message) || String(err) };
		}
	};

	this.finishPlan = async function (token, mode, releaseSourceKeys) {
		busy = Math.max(0, busy - 1);
		try {
			return await window.nmoDesktop.endPlan(
				token,
				mode || 'finish',
				Array.isArray(releaseSourceKeys) ? releaseSourceKeys : []
			);
		} catch (err) {
			return { ok: false, error: (err && err.message) || String(err) };
		}
	};

	/** 把计划结果 + 生成期失败合并成一条如实的汇总。 */
	this.reportPlan = function (summary, label, genFailures, skippedFiles) {
		var gen = genFailures || [];
		if (!summary || summary.error) {
			this.status(label + ' 失败：' + ((summary && summary.error) || '会话已丢失'), 'error');
			return { ok: false, failed: gen.length };
		}
		var written = summary.written || 0;
		var skipped = summary.skipped || 0;
		var writeFailed = summary.failed || 0;
		var failed = Math.max(writeFailed,gen.length);
		var text = label + '：已写入 ' + written + ' 个文件';
		if (skipped > 0) text += ' · ' + skipped + ' 个同名文件已存在，按设置保留';
		if (writeFailed + gen.length > 0) text += ' · ' + (writeFailed + gen.length) + ' 个失败';
		text += '\n' + summary.dir;
		if (summary.note) text += '\n' + summary.note;

		var reasons = gen.slice(0, 3).map(function (f) {
			return '· ' + f.name + ': ' + f.error;
		});
		(summary.errors || []).slice(0, 3).forEach(function (e) {
			reasons.push('· ' + e);
		});
		if (reasons.length) text += '\n' + reasons.join('\n');
		if (skippedFiles && skippedFiles.length) {
			text += '\n跳过了 ' + skippedFiles.length + ' 个不支持的文件：' + skippedFiles.slice(0, 3).join('、');
		}
		var ok = written > 0 && failed === 0;
		this.status(text, ok ? 'ok' : 'error');
		return {
			ok: ok,
			written: written,
			skipped: skipped,
			failed: failed,
			dir: summary.dir,
			files: summary.files || [],
			failures: gen
		};
	};

	/* ------------------------------------------------------------------ */
	/* External links: labelled, and only opened by an explicit user click */
	/* ------------------------------------------------------------------ */
	function isExternalAnchor(a) {
		var href = a.getAttribute('href') || '';
		return /^https?:/i.test(href);
	}

	this.markExternalLinks = function () {
		var links = document.querySelectorAll('a[href^="http://"], a[href^="https://"]');
		Array.prototype.forEach.call(links, function (a) {
			a.classList.add('nmo_online_link');
			a.title = '在系统浏览器中打开（需要联网）';
			a.setAttribute('rel', 'noopener noreferrer');
		});
	};

	this.installLinkGuards = function () {
		document.addEventListener(
			'click',
			function (event) {
				var a = event.target && event.target.closest ? event.target.closest('a') : null;
				if (!a || !isExternalAnchor(a)) return;
				event.preventDefault();
				event.stopPropagation();
				if (window.nmoDesktop) window.nmoDesktop.openExternal(a.href);
			},
			true
		);
	};

	/* ------------------------------------------------------------------ */
	/* Boot                                                                */
	/* ------------------------------------------------------------------ */
	this.boot = function () {
		this.markExternalLinks();
		this.installLinkGuards();

		if (!this.enabled) {
			this.status(
				'桌面桥接层不可用：当前页面没有运行在 Electron 外壳里，保存会退回浏览器下载。',
				'error'
			);
			return;
		}

		window.nmoDesktop
			.getBuildInfo()
			.then(function (info) {
				document.documentElement.setAttribute('data-nmo-build', info.appVersion);
				var holder = document.createElement('div');
				holder.className = 'nmo_buildinfo';
				holder.textContent =
					'NormalMap Desktop ' +
					info.appVersion +
					' · Electron ' +
					info.electron +
					' · Chromium ' +
					info.chrome +
					' · 离线版';
				var footer = document.querySelector('footer');
				if (footer) footer.appendChild(holder);
				else document.body.appendChild(holder);
			})
			.catch(function () {
				/* build info is cosmetic; never block the app on it */
			});

		this.status('就绪 — 拖入高度图开始。', 'info');
	};
})();

window.addEventListener('DOMContentLoaded', function () {
	NMO_Desktop.boot();
});
