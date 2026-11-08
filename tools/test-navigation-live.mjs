#!/usr/bin/env node
// Live, read-only navigation suite for the EH Twitter Style SPA router.
//
// Drives a real Chrome tab over CDP with real input events (mouse or touch),
// real browser Back/Forward (Page.navigateToHistoryEntry) and network fault
// injection through the Fetch domain. Nothing is ever POSTed and no account
// action is clicked; faults are synthesized locally, so the site only ever
// sees ordinary GET page loads.
//
// Usage:
//   node tools/test-navigation-live.mjs <script.user.js> <listUrl> <galleryUrl> [options]
// Options:
//   --mobile iphone|android|ipad   Phone/tablet emulation (touch taps; modifier cases skipped)
//   --width N --height N           Viewport (default 1280x900 desktop, device default on mobile)
//   --only a,b                     Run only the named cases
//   --mock                         Self-test: serve every request from tests/mock-site
//                                  (no network needed; used to validate this tool)
// Env: EHTW_CDP_HTTP (default http://127.0.0.1:9222)
// Output: one JSON report on stdout; exit code 1 if any case FAILs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CDP_HTTP } from './cdp-endpoint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const positional = [];
const opts = { mobile: '', width: 0, height: 0, only: null, mock: false };
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--mobile') opts.mobile = argv[++i] || 'iphone';
  else if (a === '--width') opts.width = Number(argv[++i]) || 0;
  else if (a === '--height') opts.height = Number(argv[++i]) || 0;
  else if (a === '--only') opts.only = new Set(String(argv[++i] || '').split(',').filter(Boolean));
  else if (a === '--mock') opts.mock = true;
  else positional.push(a);
}
const [scriptPath, listUrlArg, galleryUrlArg] = positional;
if (!scriptPath || !listUrlArg || !galleryUrlArg) {
  console.error('Usage: node tools/test-navigation-live.mjs <script.user.js> <listUrl> <galleryUrl> [--mobile iphone|android|ipad] [--only a,b] [--mock]');
  process.exit(2);
}
const SCRIPT = readFileSync(scriptPath, 'utf8');
const EXPECTED_VERSION = SCRIPT.match(/@version\s+(\S+)/)?.[1] || '';
const MATCHES = [...SCRIPT.matchAll(/^\/\/\s*@match\s+(\S+)/gm)].map((m) => m[1]);
const LIST_URL = new URL(listUrlArg).href;
const GALLERY_URL = new URL(galleryUrlArg).href;
const ORIGIN = new URL(LIST_URL).origin;
const OTHER_ORIGIN = ORIGIN.includes('exhentai') ? 'https://e-hentai.org' : 'https://exhentai.org';

const DEVICES = {
  iphone: { width: 390, height: 844, dpr: 3, platform: 'iPhone', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  android: { width: 412, height: 915, dpr: 2.625, platform: 'Linux armv8l', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' },
  ipad: { width: 768, height: 1024, dpr: 2, platform: 'iPad', ua: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }
};
const DEVICE = opts.mobile ? (DEVICES[opts.mobile] || DEVICES.iphone) : null;
const VIEWPORT = { width: opts.width || DEVICE?.width || 1280, height: opts.height || DEVICE?.height || 900 };
const TOUCH = !!DEVICE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const redact = (value) => String(value ?? '')
  .replace(/(\/g\/\d+\/)[a-f0-9]+/gi, '$1[t]')
  .replace(/(\/s\/)[a-f0-9]+\/(\d+)-(\d+)/gi, '$1[t]/$2-$3')
  .replace(/([?&]f_search=)[^&\s"]*/gi, '$1[q]');

// ---------------------------------------------------------------------------
// Optional mock backend (self-test)
let mockSite = null;
if (opts.mock) {
  const { createMockSite } = await import(pathToFileURL(path.join(ROOT, 'tests/mock-site/site.mjs')).href);
  mockSite = createMockSite({});
}

// ---------------------------------------------------------------------------
// CDP plumbing
const knownTargets = new Set((await (await fetch(`${CDP_HTTP}/json/list`)).json()).map((t) => t.id));
const tab = await (await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: 'PUT' })).json();
knownTargets.add(tab.id);
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let nextId = 0;
const pending = new Map();
const events = { documentLoads: [], sameDocument: [], errors: [], consoleErrors: [], requests: [] };
// The router pushes the new URL before fetching it, so a router fetch carries
// the target itself as Referer; background fetches of the same gallery made by
// the timeline (comment counts etc.) carry the list URL and are left alone.
const isRouterFetch = (target) => (url, type, method, referer) => type === 'fetch' && url === target && (referer === target || referer === '');
// Active fault rules: { name, test(url, type), action: 'status'|'delay'|'redirect'|'stub', status, delayMs, location, body, times, hits }
let faults = [];
const faultHits = [];

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  const p = message.params || {};
  switch (message.method) {
    case 'Page.frameNavigated':
      if (!p.frame.parentId) events.documentLoads.push(p.frame.url);
      break;
    case 'Page.navigatedWithinDocument':
      events.sameDocument.push(p.url);
      break;
    case 'Runtime.exceptionThrown':
      events.errors.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text || 'exception').slice(0, 300));
      break;
    case 'Runtime.consoleAPICalled':
      if (p.type === 'error') events.consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      break;
    case 'Fetch.requestPaused':
      // A request can be cancelled by the page while paused (e.g. the reader
      // releases an image); that is not a page error.
      onRequestPaused(p).catch((error) => { if (!/Invalid InterceptionId/i.test(error.message)) events.errors.push(`fetch-intercept: ${error.message}`); });
      break;
    default:
  }
};

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30_000);
  pending.set(id, (result) => {
    clearTimeout(timer);
    if (result.error) reject(new Error(`${method}: ${result.error.message}`));
    else resolve(result.result);
  });
  ws.send(JSON.stringify({ id, method, params }));
});

async function evaluate(expression, { gesture = false } = {}) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: gesture });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'evaluate failed');
  return response.result?.value;
}
const js = (fn, ...args) => `(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`;

async function waitFor(expression, timeoutMs = 20_000, label = expression) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { last = await evaluate(expression); if (last) return last; } catch (_) { /* document swapping */ }
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label.slice(0, 160)}`);
}

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
async function onRequestPaused(p) {
  const url = p.request.url;
  // Chrome reports window.fetch() as either Fetch or XHR depending on version.
  const rawType = String(p.resourceType || '').toLowerCase();
  const type = rawType === 'xhr' ? 'fetch' : rawType;
  events.requests.push({ url, type, method: p.request.method });
  const referer = p.request.headers?.Referer || p.request.headers?.referer || '';
  const rule = faults.find((r) => r.test(url, type, p.request.method, referer));
  if (rule) {
    rule.hits = (rule.hits || 0) + 1;
    faultHits.push({ name: rule.name, url: redact(url), type });
    if (rule.times !== undefined && rule.hits >= rule.times) faults = faults.filter((r) => r !== rule);
    if (rule.delayMs) await sleep(rule.delayMs);
    if (rule.action === 'status') {
      return send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: rule.status, responseHeaders: [{ name: 'content-type', value: 'text/html' }], body: b64(`<html><body>synthetic ${rule.status}</body></html>`) });
    }
    if (rule.action === 'redirect') {
      return send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 302, responseHeaders: [{ name: 'location', value: rule.location }], body: '' });
    }
    if (rule.action === 'stub') {
      return send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html' }], body: b64(rule.body || '<html><body>stub</body></html>') });
    }
    // 'delay' falls through to the normal response.
  }
  if (mockSite) {
    let response = null;
    try {
      response = mockSite.handle({ url, method: p.request.method, type, referer, body: p.request.postData || '', contentType: p.request.headers?.['Content-Type'] || '' });
    } catch (error) {
      events.errors.push(`mock-site: ${error.message}`);
    }
    if (!response) return send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' });
    if (response.delayMs) await sleep(response.delayMs);
    const headers = Object.entries(response.headers || {}).map(([name, value]) => ({ name, value: String(value) }));
    return send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: response.status, responseHeaders: headers, body: b64(response.body || '') });
  }
  return send('Fetch.continueRequest', { requestId: p.requestId });
}

// ---------------------------------------------------------------------------
// Page helpers
const READY_EXPR = (urlTest, classes, token) => `(() => {
  const ok = (() => {
    let url; try { url = new URL(location.href); } catch (_) { return false; }
    if (!(${urlTest})(url)) return false;
    const root = document.documentElement;
    if (!${JSON.stringify(classes)}.some((c) => root.classList.contains(c))) return false;
    if (root.classList.contains('ehtw-navigation-pending') || root.classList.contains('ehtw-page-boot')) return false;
    const surface = document.querySelector('#ehtw-shell, .ehtw-reader-root');
    if (${JSON.stringify(token)} && (!surface || surface.dataset.ehtwLiveNav === ${JSON.stringify(token)})) return false;
    if (root.classList.contains('ehtw-reader')) return !!document.querySelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]');
    if (root.classList.contains('ehtw-login')) return true;
    return document.querySelectorAll('#ehtw-shell').length === 1 && window.__EHTW_SPA_READY__ !== false;
  })();
  window.__ehtwLiveStable = ok ? (window.__ehtwLiveStable || 0) + 1 : 0;
  return window.__ehtwLiveStable >= 5;
})()`;
const SHELL_CLASSES = ['ehtw-enabled', 'ehtw-login', 'ehtw-reader'];

async function waitRoute(urlTest, classes = SHELL_CLASSES, token = null, timeoutMs = 25_000) {
  try {
    await waitFor(READY_EXPR(urlTest, classes, token), timeoutMs, `route ${urlTest} ${classes}`);
  } catch (error) {
    const state = await evaluate(`({ url: location.href, cls: document.documentElement.className, gn: document.body?.querySelector('#gn')?.textContent || '' })`).catch(() => ({}));
    const { currentIndex, entries } = await send('Page.getNavigationHistory').catch(() => ({ entries: [] }));
    throw new Error(`${error.message} — now at ${state.url} [${state.cls}]${state.gn ? ` showing "${state.gn.slice(0, 30)}"` : ''}; history ${entries.map((e, i) => `${i === currentIndex ? '*' : ''}${new URL(e.url).pathname}`).join(' → ')}`);
  }
  await evaluate('window.__ehtwLiveStable = 0');
}
async function navigate(action, urlTest, classes, timeoutMs) {
  const token = `live-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await evaluate(js((t) => { const s = document.querySelector('#ehtw-shell, .ehtw-reader-root'); if (s) s.dataset.ehtwLiveNav = t; }, token));
  await action();
  await waitRoute(urlTest, classes, token, timeoutMs);
}

async function load(url) {
  await send('Page.navigate', { url });
  await waitFor(`document.readyState === 'complete' && location.href !== 'about:blank'`, 30_000, `load ${redact(url)}`);
  await waitFor(`document.documentElement.classList.contains('ehtw-enabled') || document.documentElement.classList.contains('ehtw-reader') || document.documentElement.classList.contains('ehtw-login')`, 20_000, 'userscript applied');
  await sleep(300);
}

/** Center of the first visible element matching selector (scrolled into view); null if none. */
async function pointOf(selector, { index = 0, text = null, scroll = true } = {}) {
  return evaluate(js((selector, index, text, scroll) => {
    const all = [...document.body.querySelectorAll(selector)].filter((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && (text === null || e.textContent.trim() === text);
    });
    const e = all[index];
    if (!e) return null;
    if (scroll) e.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(r.width / 2, 40)), y: Math.round(r.top + r.height / 2), href: e.closest('a')?.href || '' };
  }, selector, index, text, scroll));
}

const MODIFIER_BITS = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 };
async function press(point, { button = 'left', modifiers = [] } = {}) {
  if (!point) throw new Error('nothing to press');
  await sleep(80);
  const mods = modifiers.reduce((m, k) => m | (MODIFIER_BITS[k] || 0), 0);
  if (TOUCH && button === 'left' && !mods) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
    await sleep(40);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, modifiers: mods });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button, buttons: button === 'middle' ? 4 : 1, clickCount: 1, modifiers: mods });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button, buttons: 0, clickCount: 1, modifiers: mods });
}
async function pressSelector(selector, options = {}) {
  const point = await pointOf(selector, options);
  if (!point) throw new Error(`no visible element for ${selector}${options.text ? ` "${options.text}"` : ''}`);
  await press(point, options);
  return point;
}
async function key(keyName) {
  const codes = { Enter: 13, Escape: 27 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName, windowsVirtualKeyCode: codes[keyName] || 0, text: keyName === 'Enter' ? '\r' : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: codes[keyName] || 0 });
}

async function historyStep(delta) {
  const { currentIndex, entries } = await send('Page.getNavigationHistory');
  const target = entries[currentIndex + delta];
  if (!target) throw new Error(`no history entry at ${delta}`);
  await send('Page.navigateToHistoryEntry', { entryId: target.id });
}
const back = () => historyStep(-1);
const forward = () => historyStep(1);
// Depth of the current entry (forward entries left over from earlier cases are ignored).
const historyLength = async () => (await send('Page.getNavigationHistory')).currentIndex + 1;
const scrollY = () => evaluate('Math.round(window.scrollY)');

async function newTargetsSince() {
  const list = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  return list.filter((t) => t.type === 'page' && !knownTargets.has(t.id));
}
async function closeNewTargets() {
  for (const t of await newTargetsSince()) {
    try { await fetch(`${CDP_HTTP}/json/close/${t.id}`); } catch (_) {}
    knownTargets.add(t.id);
  }
}

async function urlDomState() {
  return evaluate(`(() => ({
    path: location.pathname, search: location.search, href: location.href,
    detail: document.documentElement.classList.contains('ehtw-detail'),
    gmid: !!document.body.querySelector('#gmid'),
    gn: document.body.querySelector('#gn')?.textContent || '',
    shells: document.body.querySelectorAll('#ehtw-shell').length,
    pending: document.documentElement.classList.contains('ehtw-navigation-pending')
  }))()`);
}
async function assertUrlMatchesDom(label = '') {
  const s = await urlDomState();
  check(!s.pending, `${label} navigation left pending`);
  check(s.shells <= 1, `${label} ${s.shells} visible shells`);
  if (/^\/g\/\d+\//.test(s.path)) check(s.detail && s.gmid, `${label} gallery URL ${redact(s.path)} is not showing gallery markup`);
  else check(!s.gmid, `${label} URL ${redact(s.path + s.search)} is showing gallery markup ("${redact(s.gn).slice(0, 40)}")`);
  return s;
}

function check(condition, message) { if (!condition) throw new Error(message); }
function near(actual, expected, tolerance, message) {
  check(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}±${tolerance}, got ${actual}`);
}

const URL_IS = {
  list: `(u) => u.href === ${JSON.stringify(LIST_URL)}`,
  front: `(u) => u.origin === ${JSON.stringify(ORIGIN)} && u.pathname === '/' && !u.search`,
  gallery: (gid) => `(u) => new RegExp('^/g/${gid}/').test(u.pathname)`,
  galleryAny: `(u) => /^\\/g\\/\\d+\\//.test(u.pathname)`,
  reader: `(u) => /^\\/s\\//.test(u.pathname)`,
  path: (p) => `(u) => u.origin === ${JSON.stringify(ORIGIN)} && u.pathname === ${JSON.stringify(p)}`,
  pathSearch: (p, s) => `(u) => u.pathname === ${JSON.stringify(p)} && u.search === ${JSON.stringify(s)}`
};
const TWEET_TITLE = '.ehtw-tweet .ehtw-tweet-title .glink';
const BACK_ARROW = '#ehtw-header .ehtw-back-link';

async function tweetCount() { return evaluate(`document.body.querySelectorAll('.ehtw-tweet').length`); }
async function loadMoreTweets(minCount, rounds = 10) {
  for (let i = 0; i < rounds && (await tweetCount()) < minCount; i += 1) {
    await evaluate('window.scrollTo(0, document.documentElement.scrollHeight)');
    await sleep(1200);
  }
  return tweetCount();
}
/** Opens the first visible tweet at or after `index` and returns its gallery id. */
async function openTweet(index) {
  const info = await evaluate(js((sel, i) => {
    const links = [...document.body.querySelectorAll(sel)];
    const link = links[Math.min(i, links.length - 1)];
    if (!link) return null;
    link.scrollIntoView({ block: 'center' });
    const href = link.closest('a')?.href || link.closest('.ehtw-tweet')?.dataset.ehtwHref || '';
    return { href, gid: href.match(/\/g\/(\d+)\//)?.[1] || '', index: Math.min(i, links.length - 1) };
  }, TWEET_TITLE, index));
  check(info?.gid, 'no tweet to open');
  await sleep(250);
  const y = await scrollY();
  await navigate(() => pressSelector(TWEET_TITLE, { index: info.index, scroll: false }), URL_IS.gallery(info.gid), ['ehtw-detail']);
  return { ...info, y };
}
async function navEntryPoint(label) {
  let point = await pointOf('#ehtw-left #nb a', { text: label });
  if (!point) {
    const more = await pointOf('.ehtw-more-button');
    if (more) { await press(more); await sleep(400); point = await pointOf('#ehtw-left #nb a', { text: label }); }
  }
  return point;
}

// ---------------------------------------------------------------------------
// Cases
const cases = [];
const def = (name, fn, { desktopOnly = false, mobileOnly = false } = {}) => cases.push({ name, fn, desktopOnly, mobileOnly });

def('deep-list-roundtrip', async (ctx) => {
  await load(LIST_URL);
  const loaded = await loadMoreTweets(45);
  if (loaded < 30) return ctx.skip(`list only has ${loaded} tweets`);
  const docs = events.documentLoads.length;
  const before = await tweetCount();
  const opened = await openTweet(Math.min(before - 3, 35));
  check(opened.y > 1500, `opened tweet is not deep (${opened.y}px)`);
  await navigate(back, URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
  await sleep(1200);
  near(await scrollY(), opened.y, 120, 'restored scroll');
  check((await tweetCount()) === before, `appended pages lost: ${before} → ${await tweetCount()}`);
  check(events.documentLoads.length === docs, 'a document load happened');
  ctx.note(`depth ${opened.y}px, ${before} tweets`);
});

def('back-arrow-roundtrip', async () => {
  await load(LIST_URL);
  await loadMoreTweets(30);
  const opened = await openTweet(20);
  await navigate(() => pressSelector(BACK_ARROW), URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
  await sleep(1200);
  near(await scrollY(), opened.y, 120, 'restored scroll after the back arrow');
});

def('forward-then-back', async () => {
  await load(LIST_URL);
  const opened = await openTweet(8);
  await navigate(back, URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
  await navigate(forward, URL_IS.gallery(opened.gid), ['ehtw-detail']);
  check((await scrollY()) < 200, 'gallery reopened by Forward is not at the top');
  await navigate(back, URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
  await sleep(1000);
  near(await scrollY(), opened.y, 120, 'restored scroll after forward+back');
});

def('list-gallery-reader-history', async () => {
  await load(LIST_URL);
  const opened = await openTweet(0);
  await navigate(() => pressSelector('#gdt a'), URL_IS.reader, ['ehtw-reader']);
  await navigate(back, URL_IS.gallery(opened.gid), ['ehtw-detail']);
  await navigate(back, URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
  await navigate(forward, URL_IS.gallery(opened.gid), ['ehtw-detail']);
  await assertUrlMatchesDom();
});

def('thumbnail-pagination-history', async (ctx) => {
  await load(LIST_URL);
  const hl = await historyLength();
  await navigate(() => evaluate(`window.__EHTW_SPA_NAVIGATE__(${JSON.stringify(GALLERY_URL)}, { historyMode: 'push' })`, { gesture: true }), URL_IS.galleryAny, ['ehtw-detail']);
  const expand = await pointOf('.ehtw-gallery-grid-section .ehtw-detail-expand-button');
  if (expand && (await evaluate(`document.body.querySelector('.ehtw-gallery-grid-section .ehtw-detail-expand-button')?.getAttribute('aria-expanded')`)) !== 'true') {
    await press(expand); await sleep(500);
  }
  const two = await pointOf('.ehtw-gallery-pagination a', { text: '2' });
  if (!two) return ctx.skip('sample gallery has a single thumbnail page');
  const docs = events.documentLoads.length;
  await navigate(() => press(two), (`(u) => u.searchParams.get('p') === '1'`), ['ehtw-detail']);
  const extraDocs = events.documentLoads.length - docs;
  const entries = (await historyLength()) - hl;
  await navigate(back, URL_IS.list, ['ehtw-list', 'ehtw-enabled'], 15_000).catch(() => {});
  const s = await urlDomState();
  check(extraDocs === 0, `thumbnail page 2 was a document load (${extraDocs})`);
  check(entries === 1, `list → gallery → page 2 created ${entries} history entries (expected 1)`);
  check(s.href === LIST_URL, `one Back from page 2 landed on ${redact(s.path + s.search)}, not the list`);
});

def('thumbnail-page-back-arrow', async (ctx) => {
  await load(LIST_URL);
  await navigate(() => evaluate(`window.__EHTW_SPA_NAVIGATE__(${JSON.stringify(GALLERY_URL)}, { historyMode: 'push' })`, { gesture: true }), URL_IS.galleryAny, ['ehtw-detail']);
  const expand = await pointOf('.ehtw-gallery-grid-section .ehtw-detail-expand-button');
  if (expand && (await evaluate(`document.body.querySelector('.ehtw-gallery-grid-section .ehtw-detail-expand-button')?.getAttribute('aria-expanded')`)) !== 'true') {
    await press(expand); await sleep(500);
  }
  const two = await pointOf('.ehtw-gallery-pagination a', { text: '2' });
  if (!two) return ctx.skip('sample gallery has a single thumbnail page');
  await navigate(() => press(two), `(u) => u.searchParams.get('p') === '1'`, ['ehtw-detail']);
  await navigate(() => pressSelector(BACK_ARROW), URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
});

def('hash-history-keeps-dom', async (ctx) => {
  await load(GALLERY_URL);
  const reply = await pointOf('.ehtw-detail-reply-count');
  if (!reply) return ctx.skip('no reply-count link on the sample gallery');
  await evaluate(`document.querySelector('#ehtw-shell').dataset.liveMarker = 'kept'`);
  await press(reply);
  await waitFor('location.hash !== ""', 5000, 'hash set');
  await back();
  await waitFor('location.hash === ""', 5000, 'hash cleared');
  await sleep(800);
  check(await evaluate(`document.querySelector('#ehtw-shell')?.dataset.liveMarker === 'kept'`), 'hash history rebuilt the page');
});

def('back-while-loading', async () => {
  await load(LIST_URL);
  const href = await evaluate(js((sel) => document.body.querySelectorAll(sel)[3]?.closest('a')?.href || '', TWEET_TITLE));
  check(href, 'no tweet link');
  faults.push({ name: 'hold-gallery', test: isRouterFetch(href), action: 'delay', delayMs: 2500, times: 1 });
  await pressSelector(TWEET_TITLE, { index: 3 });
  await waitFor(`location.pathname.startsWith('/g/')`, 3000, 'gallery URL pushed');
  await sleep(150);
  await back();
  await sleep(4500);
  const s = await assertUrlMatchesDom('after Back during load:');
  check(s.href === LIST_URL, `ended on ${redact(s.href)}`);
});

def('second-click-while-loading', async () => {
  await load(LIST_URL);
  const hrefs = await evaluate(js((sel) => [...document.body.querySelectorAll(sel)].slice(4, 6).map((e) => e.closest('a')?.href || ''), TWEET_TITLE));
  faults.push({ name: 'hold-first', test: isRouterFetch(hrefs[0]), action: 'delay', delayMs: 2000, times: 1 });
  await pressSelector(TWEET_TITLE, { index: 4 });
  await sleep(200);
  await pressSelector(TWEET_TITLE, { index: 5, scroll: false }).catch(() => {});
  await sleep(4000);
  const s = await assertUrlMatchesDom('after two quick clicks:');
  check(hrefs.some((h) => h === s.href), `ended on ${redact(s.href)}`);
});

def('fault-502-retried', async () => {
  await load(LIST_URL);
  const href = await evaluate(js((sel) => document.body.querySelectorAll(sel)[2]?.closest('a')?.href || '', TWEET_TITLE));
  faults.push({ name: '502', test: isRouterFetch(href), action: 'status', status: 502, times: 1 });
  const docs = events.documentLoads.length;
  await navigate(() => pressSelector(TWEET_TITLE, { index: 2 }), `(u) => u.href === ${JSON.stringify(href)}`, ['ehtw-detail']);
  check(faultHits.some((h) => h.name === '502'), '502 was not injected');
  check(events.documentLoads.length === docs, 'the 502 retry fell back to a document load');
});

for (const [name, rule] of [
  ['fault-500-fallback', { action: 'status', status: 500 }],
  ['fault-503x2-fallback', { action: 'status', status: 503, times: 2 }],
  ['fault-302-fallback', { action: 'redirect', location: `${ORIGIN}/` }],
  ['fault-unsupported-fallback', { action: 'stub', body: '<html><head><title>x</title></head><body><p>no chrome</p></body></html>' }]
]) {
  def(name, async () => {
    await load(LIST_URL);
    const href = await evaluate(js((sel) => document.body.querySelectorAll(sel)[1]?.closest('a')?.href || '', TWEET_TITLE));
    faults.push({ name, test: isRouterFetch(href), times: rule.times || 1, ...rule });
    const docs = events.documentLoads.length;
    const hl = await historyLength();
    await pressSelector(TWEET_TITLE, { index: 1 });
    await waitRoute(`(u) => u.href === ${JSON.stringify(href)}`, ['ehtw-detail']);
    check(faultHits.some((h) => h.name === name), 'fault was not injected');
    check(events.documentLoads.length === docs + 1, `expected exactly one fallback document load, got ${events.documentLoads.length - docs}`);
    if ((await historyLength()) !== hl + 1) {
      const h = await send('Page.getNavigationHistory');
      throw new Error(`fallback left ${h.currentIndex + 1 - hl} new history entries (expected 1): ${h.entries.map((e, i) => `${i === h.currentIndex ? '*' : ''}${redact(new URL(e.url).pathname)}`).join(' → ')}`);
    }
    await assertUrlMatchesDom();
    await navigate(back, URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
  });
}

def('fallback-after-reload-restores-scroll', async () => {
  await load(LIST_URL);
  const opened = await openTweet(12);
  await send('Page.reload');
  await waitRoute(URL_IS.gallery(opened.gid), ['ehtw-detail']);
  faults.push({ name: 'list-500', test: isRouterFetch(LIST_URL), action: 'status', status: 500, times: 1 });
  await back();
  await waitRoute(URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
  await sleep(2500);
  near(await scrollY(), opened.y, 250, 'scroll on the fallback document');
});

def('modifier-clicks-open-new-tabs', async () => {
  await load(LIST_URL);
  const url = await evaluate('location.href');
  const hl = await historyLength();
  const combos = [[{ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Ctrl'] }, 'Ctrl/Cmd'], [{ modifiers: ['Shift'] }, 'Shift'], [{ button: 'middle' }, 'middle']];
  for (const [options, label] of combos) {
    // New tabs leave the mocked/fault-injected tab, so block their network.
    await pressSelector(TWEET_TITLE, { index: 0, ...options });
    await sleep(1200);
    const opened = await newTargetsSince();
    check(opened.length >= 1, `${label}-click did not open a new tab/window`);
    await closeNewTargets();
    check((await evaluate('location.href')) === url, `${label}-click navigated this tab`);
    check((await historyLength()) === hl, `${label}-click added history`);
    check(!(await evaluate(`document.documentElement.classList.contains('ehtw-navigation-pending')`)), `${label}-click left navigation pending`);
  }
}, { desktopOnly: true });

def('external-link-is-document-navigation', async (ctx) => {
  await load(LIST_URL);
  const forums = await navEntryPoint('Forums');
  if (!forums) return ctx.skip('no Forums entry');
  faults.push({ name: 'forums-stub', test: (url, type) => type === 'document' && /forums\.e-hentai\.org/.test(url), action: 'stub', body: '<html><body id="stub">forums stub</body></html>', times: 1 });
  await press(forums);
  await waitFor(`location.hostname === 'forums.e-hentai.org' && !!document.getElementById('stub')`, 10_000, 'forums stub loaded');
});

def('other-gallery-site-is-document-navigation', async () => {
  await load(LIST_URL);
  faults.push({ name: 'other-site-stub', test: (url, type) => type === 'document' && url.startsWith(OTHER_ORIGIN), action: 'stub', body: '<html><body id="stub">other</body></html>', times: 1 });
  await evaluate(js((href) => {
    const a = Object.assign(document.createElement('a'), { href, id: 'live-other', textContent: 'other site' });
    a.style.cssText = 'position:fixed;top:140px;left:40%;z-index:2147483647;padding:16px;background:#fff;color:#000';
    document.body.appendChild(a);
  }, `${OTHER_ORIGIN}/popular`));
  const docs = events.documentLoads.length;
  await pressSelector('#live-other');
  await waitFor(`location.origin === ${JSON.stringify(OTHER_ORIGIN)}`, 10_000, 'other site loaded');
  check(events.documentLoads.length === docs + 1, 'cross-site link did not do a document navigation');
});

def('target-blank-not-routed', async () => {
  await load(LIST_URL);
  const url = await evaluate('location.href');
  await evaluate(js((href) => {
    const a = Object.assign(document.createElement('a'), { href, target: '_blank', id: 'live-blank', textContent: 'blank' });
    a.style.cssText = 'position:fixed;top:140px;left:40%;z-index:2147483647;padding:16px;background:#fff;color:#000';
    document.body.appendChild(a);
  }, `${ORIGIN}/popular`));
  await pressSelector('#live-blank');
  await sleep(1200);
  check((await newTargetsSince()).length >= 1, 'target=_blank did not open a tab');
  await closeNewTargets();
  check((await evaluate('location.href')) === url, 'target=_blank navigated this tab');
});

def('nav-current-on-front-page', async () => {
  await load(`${ORIGIN}/`);
  const current = await evaluate(`[...document.body.querySelectorAll('#ehtw-left .ehtw-nav-current a')].map((a) => a.textContent.trim())`);
  check(current.length === 1, `front page marks ${current.length} entries as current: ${current.join(', ')}`);
});

def('nav-entries-route-in-place', async (ctx) => {
  await load(`${ORIGIN}/news.php`);
  const entries = await evaluate(js((origin) => [...document.body.querySelectorAll('#ehtw-left #nb a')]
    .map((a) => ({ label: a.textContent.trim(), href: a.href }))
    .filter((e) => e.label && e.href.startsWith(origin + '/') && !/[?&]act=|logout|login/i.test(e.href)), ORIGIN));
  const docs = events.documentLoads.length;
  const problems = [];
  for (const entry of entries) {
    const point = await navEntryPoint(entry.label);
    if (!point) { problems.push(`${entry.label}: not reachable`); continue; }
    const target = new URL(entry.href);
    try {
      await navigate(() => press(point), URL_IS.pathSearch(target.pathname, target.search), SHELL_CLASSES);
    } catch (error) { problems.push(`${entry.label}: ${error.message}`); continue; }
    const current = await evaluate(`[...document.body.querySelectorAll('#ehtw-left .ehtw-nav-current a')].map((a) => a.textContent.trim())`);
    const loggedOutRedirect = await evaluate(`document.documentElement.classList.contains('ehtw-login')`);
    if (!loggedOutRedirect && (current.length !== 1 || current[0] !== entry.label)) problems.push(`${entry.label}: current marker = [${current.join(', ')}]`);
    await assertUrlMatchesDom(entry.label).catch((e) => problems.push(e.message));
  }
  const extraDocs = events.documentLoads.length - docs;
  ctx.note(`${entries.length} entries: ${entries.map((e) => e.label).join(', ')}`);
  check(!problems.length, problems.join('; '));
  check(extraDocs === 0, `${extraDocs} document loads while moving between site pages`);
});

def('nav-history-walk', async () => {
  await load(`${ORIGIN}/`);
  const walk = ['/watched', '/popular', '/toplist.php', '/news.php'];
  for (const p of walk) await navigate(() => evaluate(`window.__EHTW_SPA_NAVIGATE__(${JSON.stringify(ORIGIN + p)}, { historyMode: 'push' })`, { gesture: true }), URL_IS.path(p), SHELL_CLASSES);
  for (const p of [...walk.slice(0, -1)].reverse()) {
    await navigate(back, URL_IS.path(p), SHELL_CLASSES);
    await assertUrlMatchesDom(p);
  }
  await navigate(back, URL_IS.front, ['ehtw-list', 'ehtw-enabled']);
});

def('top-tabs-route-in-place', async (ctx) => {
  await load(`${ORIGIN}/`);
  const watched = await pointOf('.ehtw-top-tab', { text: 'Watched' });
  if (!watched) return ctx.skip('no Watched tab');
  const docs = events.documentLoads.length;
  await navigate(() => press(watched), URL_IS.path('/watched'), SHELL_CLASSES);
  await navigate(() => pressSelector('.ehtw-top-tab', { text: 'For you' }), URL_IS.front, ['ehtw-list', 'ehtw-enabled']);
  const active = await evaluate(`[...document.body.querySelectorAll('.ehtw-top-tab.ehtw-tab-active')].map((t) => t.textContent.trim())`);
  check(active.length === 1 && active[0] === 'For you', `active tab = [${active.join(', ')}]`);
  const colors = await evaluate(`[...document.body.querySelectorAll('.ehtw-top-tab:not(.ehtw-tab-active)')].map((t) => getComputedStyle(t).color)`);
  check(new Set(colors).size <= 1, `inactive tabs differ in color (sticky highlight): ${colors.join(' | ')}`);
  check(events.documentLoads.length === docs, 'tab switch did a document load');
});

def('uploader-tag-routes', async () => {
  await load(LIST_URL);
  const docs = events.documentLoads.length;
  await openTweet(0);
  await navigate(() => pressSelector('.ehtw-detail-author .ehtw-handle a'), `(u) => u.pathname.startsWith('/uploader/')`, ['ehtw-list', 'ehtw-enabled']);
  await navigate(() => pressSelector(BACK_ARROW), URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
  await navigate(() => pressSelector('.ehtw-tweet .ehtw-tag-link'), `(u) => u.pathname.startsWith('/tag/')`, ['ehtw-list', 'ehtw-enabled']);
  await navigate(() => pressSelector(BACK_ARROW), URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
  check(events.documentLoads.length === docs, 'a document load happened');
});

def('keyboard-enter-routes', async () => {
  await load(LIST_URL);
  const gid = await evaluate(js((sel) => {
    const a = document.body.querySelector(sel)?.closest('a');
    a?.focus();
    return document.activeElement === a ? (a.href.match(/\/g\/(\d+)\//)?.[1] || '') : '';
  }, TWEET_TITLE));
  check(gid, 'could not focus a title link');
  const docs = events.documentLoads.length;
  await navigate(() => key('Enter'), URL_IS.gallery(gid), ['ehtw-detail']);
  check(events.documentLoads.length === docs, 'Enter did a document load');
}, { desktopOnly: true });

def('suspended-cache-walk', async () => {
  const chain = ['/', '/watched', '/popular', '/?f_search=english', '/tag/language:english', '/toplist.php?tl=15'];
  await load(`${ORIGIN}${chain[0]}`);
  const positions = [];
  for (let i = 0; i < chain.length; i += 1) {
    await evaluate(`window.scrollTo(0, ${400 + i * 200})`);
    await sleep(500);
    positions.push(await scrollY());
    if (i === chain.length - 1) break;
    const next = new URL(chain[i + 1], ORIGIN);
    await navigate(() => evaluate(`window.__EHTW_SPA_NAVIGATE__(${JSON.stringify(next.href)}, { historyMode: 'push' })`, { gesture: true }), URL_IS.pathSearch(next.pathname, next.search), SHELL_CLASSES);
  }
  const problems = [];
  for (let i = chain.length - 2; i >= 0; i -= 1) {
    const u = new URL(chain[i], ORIGIN);
    await navigate(back, URL_IS.pathSearch(u.pathname, u.search), SHELL_CLASSES);
    await sleep(1200);
    await assertUrlMatchesDom(chain[i]).catch((e) => problems.push(e.message));
    const y = await scrollY();
    if (Math.abs(y - positions[i]) > 150 && positions[i] > 0) problems.push(`${redact(chain[i])}: scroll ${y} vs ${positions[i]}`);
  }
  const parked = await evaluate(`document.querySelectorAll('html > div[aria-hidden="true"]').length`);
  check(parked <= 3, `${parked} suspended pages kept`);
  check(!problems.length, problems.join('; '));
});

def('safari-url-reconcile', async () => {
  await load(LIST_URL);
  await openTweet(0);
  await evaluate(`history.replaceState(history.state, '', ${JSON.stringify(`${ORIGIN}/popular`)})`);
  await waitRoute(URL_IS.path('/popular'), ['ehtw-list', 'ehtw-enabled'], null, 6000);
  await assertUrlMatchesDom();
});

def('title-follows-route', async () => {
  await load(LIST_URL);
  const listTitle = await evaluate('document.title');
  await openTweet(0);
  const galleryTitle = await evaluate('document.title');
  const gn = await evaluate(`document.body.querySelector('#gn')?.textContent || ''`);
  check(galleryTitle !== listTitle, 'title did not change on the gallery');
  check(!gn || galleryTitle.includes(gn.slice(0, 20)), 'gallery title does not contain the gallery name');
  await navigate(back, URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
  check((await evaluate('document.title')) === listTitle, 'list title not restored');
});

def('reload-mid-chain', async () => {
  await load(LIST_URL);
  const opened = await openTweet(2);
  await send('Page.reload');
  await waitRoute(URL_IS.gallery(opened.gid), ['ehtw-detail']);
  await navigate(() => pressSelector(BACK_ARROW), `(u) => u.origin === ${JSON.stringify(ORIGIN)} && !/^\\/g\\//.test(u.pathname)`, ['ehtw-list', 'ehtw-enabled']);
  await assertUrlMatchesDom();
});

def('reader-scroll-then-back', async () => {
  await load(LIST_URL);
  const opened = await openTweet(0);
  await navigate(() => pressSelector('#gdt a', { index: 2 }), URL_IS.reader, ['ehtw-reader']);
  await evaluate('window.scrollBy(0, 2500)');
  await sleep(1500);
  await navigate(back, URL_IS.gallery(opened.gid), ['ehtw-detail']);
  await navigate(() => pressSelector(BACK_ARROW), URL_IS.list, ['ehtw-list', 'ehtw-enabled']);
});

// ---------------------------------------------------------------------------
// Runner
const results = [];
let observedVersion = '';
let fatal = '';
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: DEVICE?.dpr || 1, mobile: !!DEVICE });
  if (DEVICE) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', { userAgent: DEVICE.ua, platform: DEVICE.platform });
  }
  const patterns = mockSite
    ? [{ urlPattern: '*', requestStage: 'Request' }]
    : ['Fetch', 'XHR', 'Document'].map((resourceType) => ({ urlPattern: '*', resourceType, requestStage: 'Request' }));
  await send('Fetch.enable', { patterns });

  // Use a preinstalled userscript manager when present; otherwise inject at
  // document start for every matching document, like Tampermonkey.
  await send('Page.navigate', { url: LIST_URL });
  await waitFor(`document.readyState === 'complete'`, 30_000, 'first load');
  await sleep(1500);
  const preinstalled = await evaluate(`!!window.__EHTW_STYLE_050__`);
  if (!preinstalled) {
    const patternsSource = JSON.stringify(MATCHES.map((p) => `^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const ps = ${patternsSource}.map((p) => new RegExp(p)); if (!ps.some((re) => re.test(location.href))) return;\n${SCRIPT}\n})();`
    });
  }
  await load(LIST_URL);
  observedVersion = await evaluate(`document.documentElement.dataset.ehtwScriptVersion || ''`);
  check(observedVersion === EXPECTED_VERSION, `active userscript is ${observedVersion || 'none'}, expected ${EXPECTED_VERSION}`);

  for (const testCase of cases) {
    if (opts.only && !opts.only.has(testCase.name)) continue;
    const started = Date.now();
    if (testCase.desktopOnly && TOUCH) { results.push({ name: testCase.name, status: 'SKIPPED', detail: 'desktop only' }); continue; }
    faults = [];
    faultHits.length = 0;
    const errorsBefore = events.errors.length;
    const notes = [];
    let skipped = '';
    const ctx = { skip: (why) => { skipped = why; }, note: (n) => notes.push(n) };
    let status = 'PASS';
    let detail = '';
    try {
      await Promise.race([
        testCase.fn(ctx),
        sleep(90_000).then(() => { throw new Error('case timeout (90s)'); })
      ]);
      if (skipped) { status = 'SKIPPED'; detail = skipped; }
      const newErrors = events.errors.slice(errorsBefore).filter((e) => !/api\.e-hentai\.org|access control checks|ResizeObserver loop/i.test(e));
      if (status === 'PASS' && newErrors.length) { status = 'FAIL'; detail = `page errors: ${newErrors.join(' | ')}`; }
    } catch (error) {
      status = 'FAIL';
      detail = String(error?.message || error);
    }
    await closeNewTargets().catch(() => {});
    results.push({ name: testCase.name, status, detail: redact([detail, ...notes].filter(Boolean).join(' — ')), ms: Date.now() - started });
  }
} catch (error) {
  fatal = redact(String(error?.stack || error));
} finally {
  try { await send('Fetch.disable'); } catch (_) {}
  try { ws.close(); } catch (_) {}
  try { await fetch(`${CDP_HTTP}/json/close/${tab.id}`); } catch (_) {}
}

const counts = results.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {});
const report = {
  suite: 'navigation-live',
  mode: mockSite ? 'mock' : 'live',
  platform: DEVICE ? `mobile-${opts.mobile}` : 'desktop',
  viewport: VIEWPORT,
  expectedVersion: EXPECTED_VERSION,
  observedVersion,
  list: redact(new URL(LIST_URL).pathname + new URL(LIST_URL).search),
  gallery: redact(new URL(GALLERY_URL).pathname),
  counts,
  results,
  fatal
};
console.log(JSON.stringify(report));
process.exit(fatal || results.some((r) => r.status === "FAIL") ? 1 : 0);
