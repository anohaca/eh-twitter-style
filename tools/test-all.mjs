#!/usr/bin/env node
// Full read-only desktop/mobile test runner for EH Twitter Style.
// Usage: node tools/test-all.mjs [--site both|e-hentai|exhentai] [options]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertBuildCurrent } from './build-check.mjs';

assertBuildCurrent();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SCRIPT = path.join(ROOT, 'eh-twitter-style_user.js');
const DEFAULT_CDP = process.env.EHTW_CDP_HTTP || 'http://127.0.0.1:9222';
const DEFAULT_TIMEOUT = 600_000;
const REQUIRED_VERSION = '1.17.278';
const COMMON_PATHS = [
  ['home', '/', false],
  ['watched', '/watched', true],
  ['popular', '/popular', false],
  ['search', '/?f_search=sample', false],
  ['toplists', '/toplist.php', false],
  ['torrents', '/torrents.php', false],
  ['favorites', '/favorites.php', true],
  ['bounties', '/bounty.php', false],
  ['news', '/news.php', false],
  ['toplist-yesterday', '/toplist.php?tl=15', false],
  ['tag-listing', '/tag/language:english', false],
  ['following-authors', '/watched?ehtw_following=authors', true],
  ['following-uploaders', '/watched?ehtw_following=uploaders', true]
];
// Phone / tablet device matrix for tools/test-phone.mjs: [width, height, device profile].
const MOBILE_MATRIX = [
  [390, 844, 'iphone'],   // iPhone 13/14/15
  [430, 932, 'iphone'],   // iPhone Pro Max
  [844, 390, 'iphone'],   // iPhone landscape
  [412, 915, 'android'],  // Pixel / common Android
  [768, 1024, 'ipad']     // iPad portrait (tablet layout, touch)
];
const MY_HOME_PATHS = [
  ['/home.php', 'myhome'], ['/mytags', 'mytags'], ['/uconfig.php', 'uconfig'],
  ['/stats.php', 'myhome-stats'], ['/hentaiathome.php', 'myhome-hath'],
  ['/bitcoin.php', 'myhome-bitcoin'], ['/hathperks.php', 'myhome-hathperks'],
  ['/exchange.php', 'myhome-exchange'], ['/logs.php', 'myhome-logs']
];
const FALLBACK_DISPLAY_MODES = [
  ['dm_m', 'Minimal'], ['dm_p', 'Minimal+'], ['dm_c', 'Compact'],
  ['dm_e', 'Extended'], ['dm_t', 'Thumbnail']
];

function parseArgs(argv) {
  const options = {
    script: DEFAULT_SCRIPT,
    site: 'both',
    cdpUrl: DEFAULT_CDP.replace(/\/+$/, ''),
    output: '',
    listUrl: '',
    galleryUrl: '',
    readerUrl: '',
    staticOnly: false,
    networkStress: false,
    platform: 'both',
    offline: 'auto',
    navigation: 'on',
    timeoutMs: DEFAULT_TIMEOUT
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--static-only') options.staticOnly = true;
    else if (token === '--network-stress') options.networkStress = true;
    else if (token === '--script') options.script = argv[++i] || '';
    else if (token === '--site') options.site = argv[++i] || '';
    else if (token === '--cdp-url') options.cdpUrl = (argv[++i] || '').replace(/\/+$/, '');
    else if (token === '--out') options.output = argv[++i] || '';
    else if (token === '--list-url') options.listUrl = argv[++i] || '';
    else if (token === '--gallery-url') options.galleryUrl = argv[++i] || '';
    else if (token === '--reader-url') options.readerUrl = argv[++i] || '';
    else if (token === '--platform') options.platform = argv[++i] || '';
    else if (token === '--offline') options.offline = argv[++i] || '';
    else if (token === '--navigation') options.navigation = argv[++i] || '';
    else if (token === '--timeout-seconds') options.timeoutMs = Math.max(30, Number(argv[++i]) || 600) * 1000;
    else throw new Error(`Unknown option: ${token}`);
  }
  if (!['both', 'e-hentai', 'exhentai'].includes(options.site)) throw new Error('--site must be both, e-hentai, or exhentai');
  if (!['both', 'desktop', 'mobile'].includes(options.platform)) throw new Error('--platform must be both, desktop, or mobile');
  if (!['auto', 'on', 'off'].includes(options.offline)) throw new Error('--offline must be auto, on, or off');
  if (!['on', 'off'].includes(options.navigation)) throw new Error('--navigation must be on or off');
  if (!options.script) throw new Error('--script cannot be empty');
  if (!options.cdpUrl) throw new Error('--cdp-url cannot be empty');
  return options;
}

function helpText() {
  return `Usage: node tools/test-all.mjs [options]

Options:
  --script PATH             Userscript to test (default: eh-twitter-style_user.js)
  --site both|e-hentai|exhentai   Site matrix (default: both)
  --cdp-url URL             Chrome CDP endpoint (default: ${DEFAULT_CDP})
  --out DIR                 Report and artifact directory (default: work/test-runs/<UTC timestamp>)
  --list-url URL            Override list sample; the path/query is reused on selected sites
  --gallery-url URL         Override gallery detail sample; the path is reused on selected sites
  --reader-url URL          Override reader sample; the path is reused on selected sites
  --static-only             Run deterministic suite/audit without browser automation
  --network-stress          Opt in to the gallery-stats network/rate-limit test
  --platform both|desktop|mobile   Limit the live browser matrix (default: both)
  --offline auto|on|off     Also run the offline Playwright suite in tests/ (desktop + phones +
                            WebKit against a mocked site; auto = run when tests/node_modules exists)
  --navigation on|off       Full live navigation suite (tools/test-navigation-live.mjs) on
                            desktop, iPhone and Android emulation (default: on)
  --timeout-seconds N       Per browser subtest timeout (default: 600)

Example:
  node tools/test-all.mjs --script ./eh-twitter-style_user.js --site both --out work/test-runs/latest
`;
}

function safeName(value) {
  return String(value || 'test').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'test';
}

function redact(value) {
  return String(value ?? '')
    .replace(/(https?:\/\/(?:e-hentai|exhentai)\.org\/g\/\d+\/)[a-f0-9]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/(?:e-hentai|exhentai)\.org\/s\/)[a-f0-9]+\/(\d+)-\d+/gi, '$1[redacted]/$2-[page]')
    .replace(/([?&]f_search=)[^&\s]*/gi, '$1[redacted]');
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/g\/(\d+)\/[a-f0-9]+/i, '/g/$1/[redacted]');
    url.pathname = url.pathname.replace(/\/s\/[a-f0-9]+\/(\d+)-(\d+)/i, '/s/[redacted]/$1-$2');
    if (url.searchParams.has('f_search')) url.searchParams.set('f_search', '[redacted]');
    return `${url.origin}${url.pathname}${url.search}`;
  } catch { return redact(value); }
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function classifyError(message) {
  const text = String(message || '');
  if (/api\.e-hentai\.org\/api\.php|due to access control checks/i.test(text)) {
    return { kind: 'native-site-cors', severity: 'warning', message: redact(text) };
  }
  if (/ERR_ABORTED|cancelled|canceled/i.test(text)) {
    return { kind: 'request-cancelled', severity: 'info', message: redact(text) };
  }
  return { kind: 'script-or-page-error', severity: 'error', message: redact(text) };
}

function selectedSites(siteOption) {
  const result = [];
  if (siteOption === 'both' || siteOption === 'e-hentai') {
    result.push({ id: 'eh', label: 'E-Hentai', origin: 'https://e-hentai.org', uploadOrigins: ['https://upld.e-hentai.org'] });
  }
  if (siteOption === 'both' || siteOption === 'exhentai') {
    result.push({ id: 'ex', label: 'ExHentai', origin: 'https://exhentai.org', uploadOrigins: ['https://upld.exhentai.org'] });
  }
  return result;
}

function adaptUrlToOrigin(value, origin, fallbackPath = '/') {
  if (!value) return new URL(fallbackPath, origin).href;
  const source = new URL(value, origin);
  return new URL(`${source.pathname}${source.search}${source.hash}`, origin).href;
}

function safeReaderPageUrl(template, pageNumber) {
  if (!template || !Number.isFinite(pageNumber)) return '';
  try {
    const url = new URL(template);
    if (!/-(\d+)(\/?)$/.test(url.pathname)) return '';
    url.pathname = url.pathname.replace(/-(\d+)(\/?)$/, `-${pageNumber}$2`);
    return url.href;
  } catch { return ''; }
}

async function openCdpPage(cdpUrl, url = 'about:blank') {
  const response = await fetch(`${cdpUrl}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Chrome CDP tab creation failed (${response.status})`);
  const target = await response.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome CDP timed out: ${method}`)); }, 30000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message || `Chrome CDP failed: ${method}`));
      else resolve(message);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || 'Runtime.evaluate failed');
    return response.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  if (url !== 'about:blank') await send('Page.navigate', { url });
  await waitForDocument(evaluate);
  return {
    target, ws, send, evaluate,
    async navigate(nextUrl) {
      await send('Page.navigate', { url: nextUrl });
      return waitForDocument(evaluate);
    },
    async close() {
      try { ws.close(); } catch {}
      try { await fetch(`${cdpUrl}/json/close/${target.id}`); } catch {}
    }
  };
}

async function waitForDocument(evaluate, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if (await evaluate(`document.readyState === 'complete'`)) return true; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function snapshotStorage(cdpUrl, origin) {
  const page = await openCdpPage(cdpUrl, `${origin}/`);
  const state = await page.evaluate(`(() => Object.fromEntries(
    Object.keys(localStorage).filter((key) => key.startsWith('ehtw-')).map((key) => [key, localStorage.getItem(key)])
  ))()`);
  return { origin, page, state: state || {} };
}

async function restoreStorage(guard) {
  const state = JSON.stringify(guard.state || {});
  await guard.page.evaluate(`(() => {
    const original = ${state};
    for (const key of Object.keys(localStorage)) if (key.startsWith('ehtw-')) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(original)) localStorage.setItem(key, value);
    return true;
  })()`);
  await guard.page.close();
}

async function inspectSite(cdpUrl, url) {
  const page = await openCdpPage(cdpUrl, url);
  try {
    return await page.evaluate(`(() => {
      const anchors = [...document.querySelectorAll('a[href]')];
      const labels = anchors.map((a) => String(a.textContent || '').trim().toLowerCase());
      const hrefs = anchors.map((a) => String(a.getAttribute('href') || a.href || ''));
      const login = labels.some((label) => /^(log\\s*in|login|sign\\s*in)$/.test(label)) || hrefs.some((href) => /act=Login&CODE=00/i.test(href));
      const account = labels.some((label) => /^(my\\s+tags|my\\s+uploads?|my\\s+home)$/.test(label)) || hrefs.some((href) => /(?:\\/mytags|\\/home\\.php|\\/upld\\/manage)/i.test(href));
      const galleryLinks = [...new Set(anchors.map((a) => {
        try { const u = new URL(a.href, location.href); return u.origin === location.origin && /^\\/g\\/\\d+\\/[0-9a-f]+\\/?$/i.test(u.pathname) ? u.href : ''; }
        catch { return ''; }
      }).filter(Boolean))];
      const modePairs = [...new Map([
        ...anchors.map((a) => {
          try { const u = new URL(a.href, location.href); const value = u.searchParams.get('inline_set'); return value ? [value, a.textContent.trim() || value] : null; }
          catch { return null; }
        }).filter(Boolean),
        ...[...document.querySelectorAll('select option')].map((option) => {
          const value = String(option.value || '');
          return value.startsWith('dm_') ? [value, option.textContent.trim() || value] : null;
        }).filter(Boolean)
      ].map((pair) => [pair[0], pair]))].map(([, pair]) => pair);
      const bodyText = document.body?.innerText || '';
      return {
        href: location.href, title: document.title, hasSiteNav: !!document.querySelector('#nb'),
        loggedIn: !login && account, hasLogin: login, galleryLinks: galleryLinks.slice(0, 15),
        modes: modePairs,
        blocked: /sad panda|access denied|cloudflare.*challenge/i.test(bodyText.slice(0, 3000)),
        loginForm: !!document.querySelector('form[name="ipb_login_form"]')
      };
    })()`);
  } finally { await page.close(); }
}

async function inspectGallery(cdpUrl, url) {
  const page = await openCdpPage(cdpUrl, url);
  try {
    return await page.evaluate(`(() => {
      const links = [...document.querySelectorAll('#gdt a[href], a[href^="/s/"]')];
      const galleryPath = location.pathname.replace(/\/$/, '');
      const thumbnailPageLinks = [...document.querySelectorAll('#gdt a[href], .searchnav a[href], .ptt a[href]')].map((a) => {
        try { const u = new URL(a.href, location.href); return u.origin === location.origin && u.pathname.replace(/\/$/, '') === galleryPath && Number(u.searchParams.get('p')) > 0 ? u.href : ''; }
        catch { return ''; }
      }).filter(Boolean);
      const readerPages = [...new Set(links.map((a) => {
        try { const u = new URL(a.href, location.href); return u.origin === location.origin && /^\\/s\\/[0-9a-f]+\\/\\d+-\\d+\\/?$/i.test(u.pathname) ? u.href : ''; }
        catch { return ''; }
      }).filter(Boolean))];
      const pageNumbers = readerPages.map((href) => Number(new URL(href).pathname.split('/').filter(Boolean).at(-1).match(/-(\\d+)$/)?.[1] || 0)).filter(Number.isFinite);
      const text = document.querySelector('#gdd')?.innerText || '';
      const length = text.match(/Length\\s*:\\s*([\\d,]+)\\s*pages?/i);
      return {
        href: location.href, valid: !!document.querySelector('#gmid'), readerPages,
        totalPages: length ? Number(length[1].replace(/,/g, '')) : Math.max(0, ...pageNumbers),
        totalPagesExact: !!length,
        hasComments: !!document.querySelector('.c1 .c5'),
        thumbnailPageUrl: thumbnailPageLinks[0] || ''
      };
    })()`);
  } finally { await page.close(); }
}

async function discoverSite(cdpUrl, site, options) {
  const listUrl = adaptUrlToOrigin(options.listUrl, site.origin, '/');
  const siteInfo = await inspectSite(cdpUrl, listUrl);
  const readerOverride = options.readerUrl ? adaptUrlToOrigin(options.readerUrl, site.origin) : '';
  let galleryOverride = options.galleryUrl ? adaptUrlToOrigin(options.galleryUrl, site.origin) : '';
  if (!galleryOverride && readerOverride) {
    const match = new URL(readerOverride).pathname.match(/^\/s\/([0-9a-f]+)\/(\d+)-\d+\/?$/i);
    if (match) galleryOverride = new URL(`/g/${match[2]}/${match[1]}/`, site.origin).href;
  }
  const candidateLists = [siteInfo, ...(siteInfo.galleryLinks.length ? [] : [await inspectSite(cdpUrl, new URL('/popular', site.origin).href)])];
  const discoveredGalleries = [...new Set(candidateLists.flatMap((entry) => entry.galleryLinks || []))];
  const galleryCandidates = [
    ...(galleryOverride ? [galleryOverride] : []),
    ...discoveredGalleries
  ].filter((href, index, all) => all.indexOf(href) === index).slice(0, 8);
  let galleryUrl = galleryCandidates[0] || '';
  let galleryInfo = null;
  for (const candidate of galleryCandidates) {
    try {
      const info = await inspectGallery(cdpUrl, candidate);
      if (!info?.valid) continue;
      galleryUrl = candidate;
      galleryInfo = info;
      if (info.readerPages.some((href) => /-6\/?$/.test(new URL(href).pathname)) && info.totalPages >= 10 && info.hasComments) break;
    } catch {}
  }
  if (galleryOverride) {
    galleryUrl = galleryOverride;
    try { galleryInfo = await inspectGallery(cdpUrl, galleryUrl); } catch {}
  }

  let readerTemplate = readerOverride;
  if (!readerTemplate && galleryInfo?.readerPages?.length) {
    readerTemplate = galleryInfo.readerPages.find((href) => /-6\/?$/.test(new URL(href).pathname)) ||
      galleryInfo.readerPages[Math.floor(galleryInfo.readerPages.length / 2)] || galleryInfo.readerPages[0];
  }
  if (!readerTemplate && galleryUrl) {
    const galleryMatch = new URL(galleryUrl).pathname.match(/^\/g\/(\d+)\/([0-9a-f]+)\/?$/i);
    if (galleryMatch) {
      try {
        const detail = await inspectSite(cdpUrl, galleryUrl);
        const first = detail.galleryLinks?.[0];
        if (first) {
          const page = await inspectGallery(cdpUrl, galleryUrl);
          readerTemplate = page.readerPages?.[0] || '';
        }
      } catch {}
    }
  }
  const totalPages = Number(galleryInfo?.totalPages) || 0;
  const readerLinks = galleryInfo?.readerPages || [];
  const knownPage6 = readerLinks.find((href) => /-6\/?$/.test(new URL(href).pathname)) || '';
  const readerSamples = {
    first: readerLinks.find((href) => /-1\/?$/.test(new URL(href).pathname)) || safeReaderPageUrl(readerTemplate, 1),
    page6: knownPage6 || (totalPages >= 6 ? safeReaderPageUrl(readerTemplate, 6) : ''),
    last: galleryInfo?.totalPagesExact && totalPages
      ? (readerLinks.find((href) => new URL(href).pathname.replace(/\/$/, '').endsWith(`-${totalPages}`)) || safeReaderPageUrl(readerTemplate, totalPages))
      : ''
  };
  const discoveredModes = siteInfo.modes || [];
  const modeMap = new Map(FALLBACK_DISPLAY_MODES.map(([value, label]) => [value, [value, label]]));
  for (const [value, label] of discoveredModes) modeMap.set(value, [value, label]);
  const modes = discoveredModes.length >= 5 ? discoveredModes : [...modeMap.values()];
  return {
    ...site,
    listUrl,
    siteInfo,
    loggedIn: !!siteInfo.loggedIn,
    galleryUrl,
    galleryInfo,
    totalPages,
    readerSamples,
    modes,
    modeDiscovery: discoveredModes.length >= 5 ? 'native page options' : `fallback values merged with ${discoveredModes.length} discovered options`
  };
}

function makeRouteEntries(siteRun) {
  const entries = COMMON_PATHS.map(([key, routePath, requiresAuth]) => ({
    key,
    url: key === 'home' ? siteRun.listUrl : new URL(routePath, siteRun.origin).href,
    requiresAuth
  }));
  for (const [routePath, key] of MY_HOME_PATHS) entries.push({ key, url: new URL(routePath, siteRun.origin).href, requiresAuth: true });
  for (const [value, label] of siteRun.modes) {
    const url = new URL(siteRun.listUrl);
    url.searchParams.set('inline_set', value);
    entries.push({ key: `mode-${safeName(label || value)}`, url: url.href, requiresAuth: false, mode: value });
  }
  if (siteRun.galleryUrl) entries.push({ key: 'gallery', url: siteRun.galleryUrl, requiresAuth: false });
  if (siteRun.galleryInfo?.thumbnailPageUrl) entries.push({ key: 'gallery-page2', url: siteRun.galleryInfo.thumbnailPageUrl, requiresAuth: false });
  for (const [key, url] of Object.entries(siteRun.readerSamples)) if (url) entries.push({ key: `reader-${key}`, url, requiresAuth: false });
  for (const uploadOrigin of siteRun.uploadOrigins) {
    if (siteRun.id === 'eh') {
      entries.push({ key: 'uploads-manage', url: new URL('/manage', uploadOrigin).href, requiresAuth: true });
      entries.push({ key: 'uploads-bounty-post', url: new URL('/bounty_post.php', uploadOrigin).href, requiresAuth: true });
    } else {
      entries.push({ key: 'uploads-manage', url: new URL('/upld/manage', uploadOrigin).href, requiresAuth: true });
      entries.push({ key: 'uploads-root', url: new URL('/upld/', uploadOrigin).href, requiresAuth: true });
    }
  }
  return entries;
}

function runChild(label, file, args, options) {
  const logPath = path.join(options.outputDir, 'logs', `${safeName(label)}.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const env = {
    ...process.env,
    EHTW_CDP_HTTP: options.cdpUrl,
    ...(options.env || {})
  };
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(ROOT, file), ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 40 * 1024 * 1024
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  fs.writeFileSync(logPath, redact(`${stdout}${stderr ? `\n--- STDERR ---\n${stderr}` : ''}`));
  const failLine = /^FAIL\b/m.test(stdout);
  return {
    label,
    file,
    status: result.status === 0 && !failLine ? 'PASS' : 'FAIL',
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - started,
    log: path.relative(options.outputDir, logPath),
    stdout: redact(stdout),
    stderr: redact(stderr),
    error: result.error ? String(result.error.message || result.error) : ''
  };
}

function addResult(report, result) {
  report.results.push(result);
  if (result.status === 'FAIL') report.counts.fail += 1;
  else if (result.status === 'BLOCKED') report.counts.blocked += 1;
  else if (result.status === 'SKIPPED') report.counts.skipped += 1;
  else if (result.status === 'WARN') report.counts.warn += 1;
  else if (result.status === 'PASS') report.counts.pass += 1;
}

function parseUserscriptReport(stdout) {
  const data = parseJsonOutput(stdout);
  return data && typeof data === 'object' ? data : null;
}

function parsePhoneLines(stdout) {
  const items = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const firstSpace = line.indexOf(' ');
    if (firstSpace <= 0) continue;
    try { items.push({ name: line.slice(0, firstSpace), data: JSON.parse(line.slice(firstSpace + 1)) }); } catch {}
  }
  return items;
}

function classifyUserscriptPage(report, expectedVersion, context) {
  const failures = [];
  const warnings = [];
  if (!report) return { status: 'FAIL', context, failures: ['No page report returned'] };
  if (report.scriptVersion && report.scriptVersion !== expectedVersion) failures.push(`active version ${report.scriptVersion} != ${expectedVersion}`);
  if (report.before?.runningScript && report.before.scriptVersion !== expectedVersion) failures.push(`preinstalled version ${report.before.scriptVersion || 'unknown'} != ${expectedVersion}`);
  if (report.mainNavigations?.length) failures.push(`unexpected document navigation: ${report.mainNavigations.map((url) => redactUrl(url)).join(', ')}`);
  for (const error of report.errors || []) {
    const classified = classifyError(error);
    (classified.severity === 'error' ? failures : warnings).push(classified.message);
  }
  for (const request of report.failedRequests || []) {
    const detail = `${request.type || 'resource'} ${request.error || 'failed'} ${request.url || ''}`;
    const classified = classifyError(detail);
    if (classified.severity === 'info') continue;
    if (classified.severity === 'warning') warnings.push(classified.message);
    else if (request.type === 'Image' && /(hath\.network|ehgt\.org)/i.test(request.url || '')) failures.push(classified.message);
    else warnings.push(classified.message);
  }
  for (const response of report.network?.httpFailures || []) {
    const detail = `${response.type || 'resource'} HTTP ${response.status} ${response.url || ''}`;
    if (response.type === 'Image' && /(hath\.network|ehgt\.org)/i.test(response.url || '')) failures.push(redact(detail));
    else warnings.push(redact(detail));
  }
  const viewSummaries = [];
  for (const [view, page] of Object.entries(report)) {
    if (!page || typeof page !== 'object' || !('scrollWidth' in page)) continue;
    viewSummaries.push({ view, viewport: page.viewport, scrollWidth: page.scrollWidth, overflowX: page.overflowX, injected: page.injected, columnSpill: page.columnSpill || [] });
    if (page.overflowX) failures.push(`${view}: document horizontal overflow (${page.scrollWidth}px > ${page.viewport}px)`);
    if (page.injected === false) failures.push(`${view}: userscript style not detected`);
    if (page.columnSpill?.length) warnings.push(`${view}: internal center-column spill (${page.columnSpill.length} element(s))`);
  }
  if (!viewSummaries.length) failures.push('No viewport measurements returned');
  return {
    status: failures.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS',
    context,
    views: viewSummaries,
    network: report.network || null,
    failures,
    warnings
  };
}

function classifyPhoneItem(item, expectedVersion, context) {
  const failures = [];
  const warnings = [];
  const data = item.data || {};
  const report = data.report || {};
  if (report.scriptVersion && report.scriptVersion !== expectedVersion) failures.push(`active version ${report.scriptVersion} != ${expectedVersion}`);
  if (data.mainNavigations?.length) failures.push('unexpected document navigation during mobile layout check');
  if (Array.isArray(data.errors)) {
    for (const error of data.errors) {
      const classified = classifyError(error);
      (classified.severity === 'error' ? failures : warnings).push(classified.message);
    }
  }
  if (!String(report.html || '').includes('ehtw-enabled')) failures.push('userscript page transformation was not detected');
  const expectedWidth = Number.parseInt(String(data.viewport || '').split('x')[0], 10);
  if (expectedWidth && Number(report.innerWidth) !== expectedWidth) failures.push(`viewport width ${report.innerWidth}px != requested ${expectedWidth}px`);
  for (const request of data.failedRequests || []) {
    const classified = classifyError(`${request.type || 'resource'} ${request.error || 'failed'} ${request.url || ''}`);
    if (classified.severity === 'warning') warnings.push(classified.message);
    else if (request.type === 'Image' && /(hath\.network|ehgt\.org)/i.test(request.url || '')) failures.push(classified.message);
    else warnings.push(classified.message);
  }
  if (Number(report.scrollW) > Number(report.clientW)) failures.push(`horizontal overflow ${report.scrollW}px > ${report.clientW}px`);
  if (data.report?.overlaps?.out?.length) failures.push(`overlap(s): ${data.report.overlaps.out.join(', ')}`);
  if (data.report?.overlaps?.clipped?.length) failures.push(`clipped controls: ${data.report.overlaps.clipped.join(', ')}`);
  return { status: failures.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS', context, viewport: data.viewport, failures, warnings };
}

function summarizeSiteRun(siteRun) {
  return {
    id: siteRun.id,
    origin: siteRun.origin,
    access: siteRun.access,
    loggedIn: siteRun.loggedIn,
    sampleSummary: siteRun.sampleSummary,
    modeDiscovery: siteRun.modeDiscovery,
    routeKeys: siteRun.routes.map((route) => ({ key: route.key, url: redactUrl(route.url), requiresAuth: route.requiresAuth }))
  };
}

function safariChecklistText(runId, version, outputDir) {
  return `# iPhone Safari 真机检查清单\n\nRun ID: \`${runId}\`  \n测试脚本版本：\`${version}\`  \n状态：TODO\n\n本清单必须在真实 iPhone Safari 上完成；Chrome 的 mobile emulation 不能替代 Safari/WebKit。所有站点数据只读，不提交账号修改。\n\n## 设备与脚本\n\n- [ ] iPhone 型号 / iOS / Safari 版本已记录。\n- [ ] 页面 \`data-ehtw-script-version\` 与待测版本一致。\n- [ ] Web Inspector Console 已开启“保留日志”。\n\n## 列表、详情和返回\n\n- [ ] 首页、Search、Toplists、Watched、Popular 的封面、标题和标签正常。\n- [ ] 详情页横向图片条滚轮可识别；标签展开不溢出。\n- [ ] 详情左上返回和 iOS 左边缘右滑都回到原列表、原滚动位置。\n- [ ] 缩略图展开翻页后返回不会落到上一张缩略图或首页。\n- [ ] 连续详情↔列表 3 次，无 \`matchyear\` 重复声明、意外整页导航或失去滚动位置。\n\n## 阅读页\n\n- [ ] 黑底连续滚动无图片缝隙；点击翻页一次一图；滚轮和触摸均可翻页。\n- [ ] 页数/总页数、预载设置、缩放、进度拖动与图片同步。\n- [ ] 首页/中间页/末页正常；上、下预载和直接跳页均正常。\n- [ ] 加载动画、单页重试、远页失败恢复正常，单张卡住不阻塞后续图片。\n- [ ] 地址栏/工具栏高度变化或旋转屏幕后不跳页，不出现 \`ehg_show.c.js update_window_extents\`。\n\n## 日志与证据\n\n- [ ] 无新的用户脚本异常；原站 \`api.e-hentai.org/api.php\` CORS 与脚本错误分开记录。\n- Console 错误/警告：\n- Network 失败请求/状态：\n- 复现操作：\n- 截图/录屏路径：\n\n自动化产物目录：\`${outputDir}\`\n`;
}

function renderMarkdown(report) {
  const lines = [
    '# EH Twitter Style 测试报告',
    '',
    `- Run: \`${report.runId}\``,
    `- 脚本版本: \`${report.script.version}\``,
    `- 站点: ${report.siteSelection}`,
    `- 结果: **${report.overall}**`,
    `- 通过 ${report.counts.pass} / 失败 ${report.counts.fail} / 阻塞 ${report.counts.blocked} / 跳过 ${report.counts.skipped} / 警告 ${report.counts.warn}`,
    '',
    '## 检查结果',
    '',
    '| 状态 | 检查项 | 说明 |',
    '|---|---|---|',
    ...report.results.map((entry) => `| ${entry.status} | ${entry.name || entry.context || entry.label || 'test'} | ${redact(entry.summary || entry.reason || entry.file || '').replace(/\|/g, '\\|')} |`),
    '',
    ...(() => {
      const offline = report.results.find((entry) => entry.name === 'offline-playwright-suite' && entry.failures?.length);
      return offline ? ['## 离线套件失败用例', '', ...offline.failures.map((line) => `- ${line.replace(/\|/g, '\\|')}`), ''] : [];
    })(),
    '## Safari 真机',
    '',
    `手测状态：${report.safariManual.status}。清单：\`${report.safariManual.checklist}\``,
    '',
    '报告不保存 Cookie、My Tags 内容或原始画廊 token；子测试日志会对画廊 token 和搜索词脱敏。'
  ];
  return `${lines.join('\n')}\n`;
}

// Offline Playwright suite (tests/): desktop, phone emulation and WebKit against
// a mocked, content-free site. Needs `npm install` + browsers inside tests/.
function runOfflineSuite(report, options, outputDir, scriptPath) {
  const testsDir = path.join(ROOT, 'tests');
  const installed = fs.existsSync(path.join(testsDir, 'node_modules', '@playwright', 'test'));
  if (options.offline === 'off' || (options.offline === 'auto' && !installed)) {
    addResult(report, { status: 'SKIPPED', name: 'offline-playwright-suite', reason: installed ? '--offline off' : 'tests/node_modules missing: run `cd tests && npm install && npx playwright install chromium webkit`' });
    return;
  }
  if (!installed) {
    addResult(report, { status: 'BLOCKED', name: 'offline-playwright-suite', reason: 'tests/node_modules missing: run `cd tests && npm install && npx playwright install chromium webkit`' });
    return;
  }
  const jsonFile = path.join(outputDir, 'offline-results.json');
  const projectArgs = options.platform === 'desktop'
    ? ['--project=desktop-1440-light', '--project=desktop-1440-dark', '--project=desktop-1280', '--project=tablet-900', '--project=narrow-699', '--project=webkit-desktop']
    : options.platform === 'mobile'
      ? ['--project=iphone-13-chromium', '--project=iphone-14-pro-max-chromium', '--project=pixel-7', '--project=iphone-13-landscape-chromium', '--project=webkit-iphone-13']
      : [];
  const started = Date.now();
  const cli = path.join(testsDir, 'node_modules', '@playwright', 'test', 'cli.js');
  const htmlDir = path.join(outputDir, 'offline-report');
  // EHTW_OFFLINE_ARGS: extra Playwright CLI args, e.g. "--grep reader" or "e2e/list.spec.mjs".
  const extraArgs = String(process.env.EHTW_OFFLINE_ARGS || '').split(/\s+/).filter(Boolean);
  const result = spawnSync(process.execPath, [cli, 'test', '--reporter=json,html', ...projectArgs, ...extraArgs], {
    cwd: testsDir,
    env: {
      ...process.env,
      EHTW_SCRIPT: scriptPath,
      PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
      PLAYWRIGHT_HTML_OUTPUT_DIR: htmlDir,
      PLAYWRIGHT_HTML_REPORT: htmlDir,
      PLAYWRIGHT_HTML_OPEN: 'never'
    },
    encoding: 'utf8',
    timeout: Math.max(options.timeoutMs, 3_600_000),
    maxBuffer: 200 * 1024 * 1024
  });
  let data = null;
  try { data = JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } catch {}
  if (!data) {
    addResult(report, { status: 'FAIL', name: 'offline-playwright-suite', summary: `could not read results (exit ${result.status}) ${String(result.stderr || '').slice(0, 400)}` });
    return;
  }
  const stats = data.stats || {};
  const failures = [];
  const walk = (suite, titles = []) => {
    for (const spec of suite.specs || []) for (const t of spec.tests || []) {
      if (t.status === 'unexpected') failures.push(`[${t.projectName}] ${[...titles, spec.title].join(' › ')}`);
    }
    for (const child of suite.suites || []) walk(child, [...titles, child.title].filter(Boolean));
  };
  for (const suite of data.suites || []) walk(suite);
  addResult(report, {
    status: stats.unexpected ? 'FAIL' : stats.flaky ? 'WARN' : 'PASS',
    name: 'offline-playwright-suite',
    summary: `passed ${stats.expected || 0}, failed ${stats.unexpected || 0}, flaky ${stats.flaky || 0}, skipped ${stats.skipped || 0} in ${Math.round((Date.now() - started) / 1000)}s; HTML report: ${path.relative(ROOT, htmlDir)}`,
    failures: failures.slice(0, 200),
    log: path.relative(outputDir, jsonFile)
  });
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(helpText()); return 0; }
  const scriptPath = path.resolve(options.script);
  if (!fs.existsSync(scriptPath)) throw new Error(`Userscript not found: ${scriptPath}`);
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');
  const version = scriptSource.match(/@version\s+(\S+)/)?.[1] || 'unknown';
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.resolve(options.output || path.join(ROOT, 'work', 'test-runs', runId));
  fs.mkdirSync(path.join(outputDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'screenshots'), { recursive: true });
  const report = {
    schemaVersion: 1,
    runId,
    siteSelection: options.site,
    script: { path: path.relative(ROOT, scriptPath), version },
    cdpEndpoint: options.cdpUrl,
    startedAt: new Date().toISOString(),
    sites: [],
    results: [],
    counts: { pass: 0, fail: 0, blocked: 0, skipped: 0, warn: 0 },
    safariManual: { status: 'PENDING', checklist: 'safari-checklist.md' },
    outputDir: path.relative(ROOT, outputDir)
  };
  const guards = [];
  const envBase = { cdpUrl: options.cdpUrl, outputDir, timeoutMs: options.timeoutMs };

  const audit = runChild('audit-16-dimensions', 'tools/audit-16-dimensions.mjs', [], envBase);
  const auditJson = parseJsonOutput(audit.stdout);
  addResult(report, {
    status: audit.status,
    name: 'deterministic-audit-16',
    summary: auditJson ? `${auditJson.deterministicSuites?.length || 0} deterministic suites; ${auditJson.dimensions?.length || 0} quality dimensions` : `exit ${audit.exitCode}`,
    log: audit.log,
    audit: auditJson || null
  });

  runOfflineSuite(report, options, outputDir, scriptPath);

  const checklist = safariChecklistText(runId, version, path.relative(ROOT, outputDir));
  fs.writeFileSync(path.join(outputDir, 'safari-checklist.md'), checklist);
  fs.copyFileSync(path.join(outputDir, 'safari-checklist.md'), path.join(outputDir, 'safari-checklist-template.md'));
  const sites = selectedSites(options.site);
  if (options.staticOnly) {
    for (const site of sites) addResult(report, { status: 'SKIPPED', name: `${site.id}-browser`, reason: '--static-only requested' });
  } else {
    let cdpVersion = null;
    try {
      const response = await fetch(`${options.cdpUrl}/json/version`, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error(`Chrome CDP returned ${response.status}`);
      cdpVersion = await response.json();
    } catch (error) {
      addResult(report, { status: 'BLOCKED', name: 'Chrome CDP preflight', reason: `Cannot connect to ${options.cdpUrl}: ${error.message}` });
    }

    if (cdpVersion) {
      addResult(report, { status: 'PASS', name: 'Chrome CDP preflight', summary: cdpVersion.Browser || 'Chrome debugger reachable' });
      try {
        for (const site of sites) {
          for (const origin of [site.origin, ...site.uploadOrigins]) {
            try { guards.push(await snapshotStorage(options.cdpUrl, origin)); }
            catch (error) { addResult(report, { status: 'WARN', name: `${site.id} localStorage snapshot`, reason: redact(error.message) }); }
          }
        }

        for (const site of sites) {
          const siteRun = await discoverSite(options.cdpUrl, site, options);
          siteRun.routes = makeRouteEntries(siteRun);
          siteRun.routeResults = [];
          siteRun.loggedIn = !!siteRun.loggedIn;
          siteRun.access = siteRun.siteInfo?.blocked || !siteRun.siteInfo?.hasSiteNav ? 'BLOCKED-SITE' : 'AVAILABLE';
          siteRun.sampleSummary = {
            list: redactUrl(siteRun.listUrl),
            gallery: redactUrl(siteRun.galleryUrl),
            readerPages: Object.fromEntries(Object.entries(siteRun.readerSamples).map(([k, v]) => [k, v ? redactUrl(v) : ''])),
            totalPages: siteRun.totalPages,
            displayModeCount: siteRun.modes.length,
            modeDiscovery: siteRun.modeDiscovery
          };

          if (siteRun.access !== 'AVAILABLE') {
            addResult(report, { status: 'BLOCKED', name: `${site.id}-site-discovery`, reason: siteRun.access });
            report.sites.push(summarizeSiteRun(siteRun));
            continue;
          }
          addResult(report, {
            status: 'PASS', name: `${site.id}-site-discovery`,
            summary: `${siteRun.loggedIn ? 'logged-in' : 'logged-out'}; ${siteRun.sampleSummary.displayModeCount} display-mode values; reader total ${siteRun.totalPages || 'unknown'}`
          });

          const availableRoutes = [];
          for (const route of siteRun.routes) {
            if (route.requiresAuth && !siteRun.loggedIn) {
              siteRun.routeResults.push({ name: route.key, status: 'BLOCKED-AUTH' });
              addResult(report, { status: 'BLOCKED', name: `${site.id}-${route.key}`, reason: 'requires an existing logged-in Chrome session' });
              continue;
            }
            availableRoutes.push(route);
          }

          const smokePages = availableRoutes.map((route) => `${site.id}-${safeName(route.key)}=${route.url}`);
          const smokeDir = path.join(outputDir, 'screenshots', site.id, 'route-smoke');
          if (smokePages.length) {
            const run = runChild(`${site.id}-route-smoke`, 'tools/test-userscript.mjs', [scriptPath, smokeDir, ...smokePages], {
              ...envBase,
              env: { EHTW_TEST_VIEWS: 'desktop-light,narrow-390', EHTW_CAPTURE_SCREENSHOTS: '0' }
            });
            const data = parseUserscriptReport(run.stdout);
            addResult(report, { status: run.status, name: `${site.id}-route-smoke`, summary: `${smokePages.length} page URLs; exit ${run.exitCode}`, log: run.log });
            if (!data) addResult(report, { status: 'FAIL', name: `${site.id}-route-smoke-report`, reason: 'could not parse page report JSON' });
            else {
              for (const [name, page] of Object.entries(data)) {
                const result = classifyUserscriptPage(page, version, `${site.id}/${name}`);
                siteRun.routeResults.push({ name, ...result });
                addResult(report, { ...result, name: `${site.id}/${name}`, summary: result.failures.join('; ') || result.warnings.join('; ') || `${result.views?.length || 0} viewport checks` });
              }
            }
          } else addResult(report, { status: 'SKIPPED', name: `${site.id}-route-smoke`, reason: 'no accessible routes' });

          const fullKeys = new Set(['home', 'popular', 'toplists', 'toplist-yesterday', 'news', 'tag-listing', 'gallery', 'gallery-page2', 'reader-page6', 'bounties']);
          const fullPages = availableRoutes.filter((route) => fullKeys.has(route.key)).map((route) => `${site.id}-${safeName(route.key)}=${route.url}`);
          if (fullPages.length && options.platform !== 'mobile') {
            const run = runChild(`${site.id}-full-viewports`, 'tools/test-userscript.mjs', [scriptPath, path.join(outputDir, 'screenshots', site.id, 'full-viewports'), ...fullPages], {
              ...envBase,
              env: { EHTW_TEST_VIEWS: '', EHTW_CAPTURE_SCREENSHOTS: '1' }
            });
            const data = parseUserscriptReport(run.stdout);
            addResult(report, { status: run.status, name: `${site.id}-full-viewports`, summary: `${fullPages.length} core pages × twelve viewport/color states; exit ${run.exitCode}`, log: run.log });
            if (data) {
              for (const [name, page] of Object.entries(data)) {
                const result = classifyUserscriptPage(page, version, `${site.id}/${name}/full`);
                siteRun.routeResults.push({ name: `${name}-full`, ...result });
                addResult(report, { ...result, name: `${site.id}/${name}/full`, summary: result.failures.join('; ') || result.warnings.join('; ') || `${result.views?.length || 0} viewport checks` });
              }
            } else if (run.status === 'PASS') addResult(report, { status: 'FAIL', name: `${site.id}-full-viewports-report`, reason: 'could not parse page report JSON' });
          } else addResult(report, { status: 'SKIPPED', name: `${site.id}-full-viewports`, reason: options.platform === 'mobile' ? '--platform mobile' : 'no accessible core pages' });

          const privateFullPages = availableRoutes.filter((route) => route.requiresAuth).map((route) => `${site.id}-${safeName(route.key)}=${route.url}`);
          if (privateFullPages.length && options.platform !== 'mobile') {
            const run = runChild(`${site.id}-private-viewports`, 'tools/test-userscript.mjs', [scriptPath, path.join(outputDir, 'screenshots', site.id, 'private-viewports-no-capture'), ...privateFullPages], {
              ...envBase,
              env: { EHTW_TEST_VIEWS: '', EHTW_CAPTURE_SCREENSHOTS: '0' }
            });
            const data = parseUserscriptReport(run.stdout);
            addResult(report, { status: run.status, name: `${site.id}-private-viewports`, summary: `${privateFullPages.length} authenticated pages × twelve viewport/color states; screenshots disabled for privacy; exit ${run.exitCode}`, log: run.log });
            if (data) {
              for (const [name, page] of Object.entries(data)) {
                const result = classifyUserscriptPage(page, version, `${site.id}/${name}/private`);
                siteRun.routeResults.push({ name: `${name}-private`, ...result });
                addResult(report, { ...result, name: `${site.id}/${name}/private`, summary: result.failures.join('; ') || result.warnings.join('; ') || `${result.views?.length || 0} viewport checks` });
              }
            }
          }

          const routeFor = (key) => availableRoutes.find((route) => route.key === key)?.url || '';
          const phoneKeys = ['home', 'popular', 'search', 'toplists', 'toplist-yesterday', 'tag-listing', 'news', 'torrents', 'favorites', 'watched',
            'following-authors', 'following-uploaders', 'gallery', 'gallery-page2', 'myhome', 'mytags', 'uconfig', 'uploads-manage', 'uploads-bounty-post', 'bounties'];
          const phoneRouteEntries = phoneKeys.map((key) => availableRoutes.find((route) => route.key === key)).filter(Boolean);
          const phonePages = phoneRouteEntries.map((route) => `${site.id}-${safeName(route.key)}=${route.url}`);
          const privatePhoneNames = phoneRouteEntries.filter((route) => route.requiresAuth).map((route) => `${site.id}-${safeName(route.key)}`).join(',');
          for (const [width, height, device] of options.platform === 'desktop' ? [] : MOBILE_MATRIX) {
            if (!phonePages.length) continue;
            const run = runChild(`${site.id}-mobile-${device}-${width}x${height}`, 'tools/test-phone.mjs', [scriptPath, path.join(outputDir, 'screenshots', site.id, `${device}-${width}x${height}`), ...phonePages], {
              ...envBase,
              env: {
                EHTW_PHONE_WIDTH: String(width),
                EHTW_PHONE_HEIGHT: String(height),
                EHTW_PHONE_DEVICE: device,
                EHTW_SCREENSHOT_EXCLUDE: privatePhoneNames
              }
            });
            const items = parsePhoneLines(run.stdout);
            addResult(report, { status: run.status, name: `${site.id}-mobile-${device}-${width}x${height}`, summary: `${items.length}/${phonePages.length} pages reported; exit ${run.exitCode}`, log: run.log });
            for (const item of items) {
              const result = classifyPhoneItem(item, version, `${site.id}/${item.name}/${device}-${width}x${height}`);
              siteRun.routeResults.push(result);
              addResult(report, { ...result, name: result.context, summary: result.failures.join('; ') || result.warnings.join('; ') || `viewport ${item.data?.report?.innerWidth}px; scrollWidth ${item.data?.report?.scrollW}px` });
            }
          }

          if (siteRun.galleryUrl && siteRun.galleryInfo?.hasComments) {
            const actions = runChild(`${site.id}-safe-actions`, 'tools/test-actions.mjs', [scriptPath, siteRun.galleryUrl, path.join(outputDir, 'screenshots', site.id, 'safe-actions')], envBase);
            addResult(report, { status: actions.status, name: `${site.id}-safe-actions`, summary: 'Favorites/votes are stubbed; click handling is tested without account writes', log: actions.log });
            if (/^FAIL\b/m.test(actions.stdout)) addResult(report, { status: 'FAIL', name: `${site.id}-safe-actions-details`, summary: actions.stdout.split(/\r?\n/).filter((line) => /^FAIL\b/.test(line)).map(redact).join(' | ') });
          } else addResult(report, { status: 'SKIPPED', name: `${site.id}-safe-actions`, reason: siteRun.galleryUrl ? 'no safe gallery sample with comments for the stubbed vote interaction' : 'no gallery sample discovered' });

          if (siteRun.galleryUrl && siteRun.galleryInfo?.hasComments) {
            const interaction = runChild(`${site.id}-interactions`, 'tools/test-interactions.mjs', [scriptPath, siteRun.listUrl, siteRun.galleryUrl, path.join(outputDir, 'screenshots', site.id, 'interactions')], {
              ...envBase,
              env: siteRun.galleryInfo.thumbnailPageUrl ? { MULTI_URL: siteRun.galleryUrl } : {}
            });
            const failures = interaction.stdout.split(/\r?\n/).filter((line) => /^FAIL\b/.test(line)).map(redact);
            addResult(report, { status: interaction.status === 'PASS' && !failures.length ? 'PASS' : 'FAIL', name: `${site.id}-interactions-read-only`, summary: failures.join('; ') || 'list/detail navigation, filters, menus, comment form opening and click targets', log: interaction.log });
          } else addResult(report, { status: 'SKIPPED', name: `${site.id}-interactions-read-only`, reason: 'no gallery sample with comments was discovered' });

          if (siteRun.listUrl) {
            const author = runChild(`${site.id}-author-rendering`, 'tools/test-author.mjs', [scriptPath, siteRun.listUrl], envBase);
            addResult(report, { status: author.status, name: `${site.id}-author-rendering`, summary: 'read-only author/uploader label consistency probe', log: author.log });
          }

          if (siteRun.galleryUrl && siteRun.listUrl) {
            const spa = runChild(`${site.id}-spa-repeat`, 'tools/test-spa-browser.mjs', [scriptPath, siteRun.listUrl, siteRun.galleryUrl, '3'], envBase);
            const spaData = parseJsonOutput(spa.stdout);
            const spaFailure = spaData?.error || (spaData?.documentNavigations?.length > 1 ? 'main document navigated during SPA cycles' : '');
            const spaRuntimeErrors = [...(spaData?.runtimeErrors || []), ...(spaData?.consoleErrors || [])]
              .map(classifyError)
              .filter((entry) => entry.severity === 'error')
              .map((entry) => entry.message);
            const spaDetail = redact(spaFailure || spaRuntimeErrors.join('; '));
            addResult(report, { status: spa.status === 'PASS' && !spaDetail ? 'PASS' : 'FAIL', name: `${site.id}-spa-repeat`, summary: spaDetail || `completed ${spaData?.completedCycles || 0}/3 round trips at version ${spaData?.observedVersion || 'unknown'}`, log: spa.log });
          }

          // Full navigation suite (tools/test-navigation-live.mjs): real input,
          // real Back/Forward, locally synthesized network faults; read-only.
          if (siteRun.galleryUrl && siteRun.listUrl && options.navigation === 'on') {
            const navTargets = [];
            if (options.platform !== 'mobile') navTargets.push(['desktop', []]);
            if (options.platform !== 'desktop') navTargets.push(['iphone', ['--mobile', 'iphone']], ['android', ['--mobile', 'android']]);
            for (const [label, extra] of navTargets) {
              const nav = runChild(`${site.id}-navigation-${label}`, 'tools/test-navigation-live.mjs', [scriptPath, siteRun.listUrl, siteRun.galleryUrl, ...extra], envBase);
              const navData = parseJsonOutput(nav.stdout);
              if (!navData) {
                addResult(report, { status: 'FAIL', name: `${site.id}-navigation-${label}`, summary: redact(nav.stderr || nav.error || 'no report').slice(0, 400), log: nav.log });
                continue;
              }
              if (navData.fatal) addResult(report, { status: 'FAIL', name: `${site.id}-navigation-${label}`, summary: navData.fatal.slice(0, 400), log: nav.log });
              for (const item of navData.results || []) {
                addResult(report, {
                  status: item.status,
                  name: `${site.id}-navigation-${label}-${item.name}`,
                  ...(item.status === 'SKIPPED' ? { reason: item.detail } : { summary: item.detail || `${item.ms}ms` }),
                  log: nav.log
                });
              }
            }
          } else if (options.navigation === 'on') {
            addResult(report, { status: 'BLOCKED', name: `${site.id}-navigation`, reason: 'list and gallery samples are required' });
          }

          const reader = siteRun.readerSamples;
          for (const [key, label] of [['first', 'first-page'], ['last', 'last-page']]) {
            const url = reader[key];
            if (!url) { addResult(report, { status: 'BLOCKED', name: `${site.id}-reader-${label}`, reason: 'reader page sample not discovered' }); continue; }
            if (options.platform === 'mobile') { addResult(report, { status: 'SKIPPED', name: `${site.id}-reader-${label}`, reason: '--platform mobile' }); continue; }
            const result = runChild(`${site.id}-reader-${label}`, 'tools/test-reader-browser.mjs', [scriptPath, url], envBase);
            addResult(report, { status: result.status, name: `${site.id}-reader-${label}`, summary: `desktop reader behavior; exit ${result.exitCode}`, log: result.log });
          }
          if (reader.page6 && siteRun.totalPages >= 10) {
            const backward = runChild(`${site.id}-reader-backward`, 'tools/test-reader-backward-browser.mjs', [scriptPath, reader.page6], envBase);
            addResult(report, { status: backward.status, name: `${site.id}-reader-backward`, summary: 'middle-page bidirectional preload and upward continuation', log: backward.log });
            const mobileReader = runChild(`${site.id}-reader-mobile`, 'tools/test-reader-mobile.mjs', [scriptPath, reader.page6], envBase);
            addResult(report, { status: mobileReader.status, name: `${site.id}-reader-mobile`, summary: 'touch viewport, page seek, zoom, preload and image memory behavior', log: mobileReader.log });
          } else {
            addResult(report, { status: 'BLOCKED', name: `${site.id}-reader-advanced`, reason: `automatic sample needs a page-6 link and at least 10 pages; detected ${siteRun.totalPages || 'unknown'} pages` });
          }

          report.sites.push(summarizeSiteRun(siteRun));
        }

        if (options.networkStress) {
          const run = runChild('optional-stats-network-test', 'tools/test-stats.mjs', [scriptPath], envBase);
          addResult(report, { status: run.status, name: 'optional-stats-network-test', summary: 'opt-in network/rate-limit probe', log: run.log });
        } else addResult(report, { status: 'SKIPPED', name: 'optional-stats-network-test', reason: 'not run by default to avoid unnecessary site/API requests; pass --network-stress to opt in' });
      } catch (error) {
        addResult(report, { status: 'BLOCKED', name: 'Chrome browser matrix', reason: redact(error?.stack || error) });
      } finally {
        for (const guard of guards.reverse()) {
          try { await restoreStorage(guard); }
          catch (error) { addResult(report, { status: 'WARN', name: `restore-${safeName(guard.origin)}`, reason: redact(error.message) }); }
        }
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  const failed = report.counts.fail > 0;
  const blocked = report.counts.blocked > 0;
  report.overall = failed ? 'FAIL' : blocked ? 'PARTIAL-BLOCKED' : options.staticOnly ? 'STATIC-ONLY' : report.counts.warn ? 'PASS-WITH-WARNINGS' : 'PASS-AUTOMATED';
  report.safariManual = { status: 'PENDING-MANUAL', checklist: 'safari-checklist.md' };
  writeJson(path.join(outputDir, 'summary.json'), report);
  fs.writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report));
  console.log(JSON.stringify({ overall: report.overall, counts: report.counts, outputDir: path.relative(ROOT, outputDir) }, null, 2));
  return failed ? 1 : blocked ? 2 : 0;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) console.log(helpText());
  else process.exitCode = await main();
} catch (error) {
  console.error(redact(error?.stack || error));
  process.exitCode = 1;
}
