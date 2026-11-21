'use strict';

/*
 * app-protocol.js
 * Serves the original NormalMap-Online renderer over a private, standard,
 * secure custom scheme instead of file://.
 *
 * Why a custom scheme:
 *   - file:// is an opaque origin in Chromium, which taints <canvas> content
 *     loaded from disk and would break getImageData/toBlob (the whole app).
 *   - A privileged standard scheme gives a real origin (app://nmo) so local
 *     images are same-origin and canvas exports stay readable.
 *   - No HTTP server, no listening port, no CORS relaxation.
 *
 * In test mode only, a second host (app://baseline) serves the pristine
 * upstream copy in tests/baseline/site, so pixel comparison can run inside the
 * same Electron build. Packaged builds never register it.
 */

const path = require('node:path');
const fs = require('node:fs');
const { protocol } = require('electron');

const SCHEME = 'app';
const APP_HOST = 'nmo';
const APP_ORIGIN = `${SCHEME}://${APP_HOST}`;
const RENDERER_ROOT = path.resolve(__dirname, '..', 'renderer');
const BASELINE_HOST = 'baseline';
const BASELINE_ROOT = path.resolve(__dirname, '..', 'tests', 'baseline', 'site');

// Set by main.js, which owns the two-factor test gate (env var + flag file
// next to the exe). Defaults to false: nothing extra is served unless the
// caller asks explicitly.
let baselineEnabled = false;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

/** Every app:// request is recorded here for the offline evidence trail. */
const requestLog = [];

function recordRequest(url, status) {
  if (requestLog.length < 20000) {
    requestLog.push({ url, status, at: new Date().toISOString() });
  }
}

function hostRoots() {
  const roots = new Map([[APP_HOST, RENDERER_ROOT]]);
  // The pristine upstream copy only exists inside the source tree. A packaged
  // build never has it, so the extra host simply never comes into existence
  // there - no test-only surface ships with the product.
  if (baselineEnabled && fs.existsSync(BASELINE_ROOT)) {
    roots.set(BASELINE_HOST, BASELINE_ROOT);
  }
  return roots;
}

function registerSchemePrivileges() {
  // Must run before app "ready".
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: false
      }
    }
  ]);
}

/**
 * @param {{baseline?: boolean}} [options] `baseline: true` additionally serves
 *   app://baseline from tests/baseline/site, which only the test harness needs.
 */
function registerHandler(options) {
  if (options && options.baseline !== undefined) {
    baselineEnabled = Boolean(options.baseline);
  }
  const roots = hostRoots();
  // Real roots are resolved once: a symlink inside the tree must not be able
  // to point outside it, and comparing only the spelled path would miss that.
  const realRoots = new Map();

  protocol.handle(SCHEME, async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      recordRequest(request.url, 'bad-url');
      return new Response('Bad request', { status: 400 });
    }

    const root = roots.get(url.host);
    if (!root) {
      recordRequest(request.url, 'bad-host');
      return new Response('Forbidden', { status: 403 });
    }

    let relative = decodeURIComponent(url.pathname);
    if (relative === '/' || relative === '') {
      relative = '/index.html';
    }

    // Resolve inside the host root only; reject traversal attempts.
    const resolved = path.resolve(root, '.' + path.posix.normalize(relative));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      recordRequest(request.url, 'traversal-blocked');
      return new Response('Forbidden', { status: 403 });
    }

    let realRoot;
    try {
      realRoot = realRoots.get(root);
      if (!realRoot) {
        realRoot = await fs.promises.realpath(root);
        realRoots.set(root, realRoot);
      }
    } catch {
      recordRequest(request.url, 'root-missing');
      return new Response('Not found', { status: 404 });
    }

    let realResolved;
    try {
      realResolved = await fs.promises.realpath(resolved);
    } catch (err) {
      recordRequest(request.url, `404:${(err && err.code) || 'ERR'}`);
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    // Second boundary check, this time on the real path: catches a symlink
    // inside renderer/ that resolves to somewhere else on disk.
    if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) {
      recordRequest(request.url, 'symlink-blocked');
      return new Response('Forbidden', { status: 403 });
    }

    let data;
    try {
      data = await fs.promises.readFile(realResolved);
    } catch (err) {
      recordRequest(request.url, `404:${(err && err.code) || 'ERR'}`);
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    const ext = path.extname(realResolved).toLowerCase();
    recordRequest(request.url, '200');

    return new Response(data, {
      status: 200,
      headers: {
        'content-type': MIME_TYPES[ext] || 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      }
    });
  });
}

module.exports = {
  SCHEME,
  APP_HOST,
  APP_ORIGIN,
  BASELINE_HOST,
  RENDERER_ROOT,
  BASELINE_ROOT,
  requestLog,
  registerSchemePrivileges,
  registerHandler
};
