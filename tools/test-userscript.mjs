// Injects the userscript into real pages in the debug Chrome and reports problems.
// Page images are blurred in screenshots: layout is what is being checked.
// Usage: node test-userscript.mjs <script.user.js> <outdir> <name=url> [name=url...]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CDP_HTTP } from './cdp-endpoint.mjs';

const [scriptPath, outDir, ...pages] = process.argv.slice(2);
const userscript = readFileSync(scriptPath, "utf8");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY_SELECTORS = [
  "#nb a", "#f_search", "#searchbox form", ".searchnav select", "#unext, #dnext", ".ir",
  ".gldown", ".glink", "#gdr", "#rating_image", "#favoritelink", "#taglist a", "#gdt", ".c1", "#gd5 a",
];

const reportExpr = `(() => {
  const vis = (e) => {
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0;
  };
  const key = {};
  for (const sel of ${JSON.stringify(KEY_SELECTORS)}) {
    const all = [...document.querySelectorAll(sel)];
    if (all.length) key[sel] = all.filter(vis).length + '/' + all.length;
  }
  const de = document.documentElement;
  const wide = [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.getBoundingClientRect().right > de.clientWidth + 1)
    .slice(0, 6).map((e) => e.tagName + '.' + String(e.className).slice(0, 40) + '#' + e.id);
  return {
    url: location.pathname, htmlClass: de.className, viewport: de.clientWidth,
    scrollWidth: de.scrollWidth, overflowX: de.scrollWidth > de.clientWidth, overflowing: wide, key,
    columnSpill: (() => { const c = document.querySelector('#ehtw-center'); if (!c) return []; const edge = c.getBoundingClientRect().right + 1; return [...c.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && b.right > edge && s.visibility !== 'hidden' && !e.closest('[style*="position: fixed"]'); }).slice(0, 4).map((e) => e.tagName + '.' + String(e.className.baseVal ?? e.className).slice(0, 26)); })(),
    inlineOnclick: document.querySelectorAll('[onclick]').length,
    injected: [...document.querySelectorAll('style')].some((s) => /ehtw/.test(s.textContent)),
    scriptVersion: de.dataset.ehtwScriptVersion || null,
    runningScript: !!window.__EHTW_STYLE_050__,
    runningScript: !!window.__EHTW_STYLE_050__,
    nativeGalleryModes: [...document.querySelectorAll('table.itg, div.itg')].map((e) => String(e.className || '')).slice(0, 6),
    navigationMs: Math.round(performance.getEntriesByType('navigation')[0]?.duration || 0),
  };
})()`;

async function openTab(url) {
  const res = await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: "PUT" });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  const mainNavigations = [];
  const failedRequests = [];
  const requestUrls = new Map();
  const responseStatuses = [];
  const resourceCounts = {};
  const networkStats = { transferredBytes: 0 };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Page.frameNavigated" && !m.params.frame.parentId) mainNavigations.push(m.params.frame.url);
    if (m.method === "Network.requestWillBeSent") {
      requestUrls.set(m.params.requestId, { url: m.params.request.url, type: m.params.type || 'Other' });
      const type = m.params.type || 'Other';
      resourceCounts[type] = (resourceCounts[type] || 0) + 1;
    }
    if (m.method === "Network.responseReceived") responseStatuses.push({ url: requestUrls.get(m.params.requestId)?.url || '', type: m.params.type || 'Other', status: m.params.response.status });
    if (m.method === "Network.loadingFinished") networkStats.transferredBytes += Number(m.params.encodedDataLength) || 0;
    if (m.method === "Network.loadingFailed") failedRequests.push({ url: requestUrls.get(m.params.requestId)?.url || '', error: m.params.errorText, type: m.params.type });
  };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) errors.push(r.result.exceptionDetails.exception?.description || "evaluate failed");
    return r.result?.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Page.navigate", { url });
  return { tab, ws, send, evaluate, errors, mainNavigations, failedRequests, responseStatuses, resourceCounts, networkStats };
}

const BLUR = `(() => { const s = document.createElement('style'); s.id='__test_blur';
  s.textContent = 'img, [style*="background"]:not(.ir) , video { filter: blur(24px) !important; }'; document.head.appendChild(s); })()`;

async function shot(send, file) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
}

const out = {};
for (const page of pages) {
  const eq = page.indexOf("=");
  const name = page.slice(0, eq);
  const url = page.slice(eq + 1);
  const { tab, ws, send, evaluate, errors, mainNavigations, failedRequests, responseStatuses, resourceCounts, networkStats } = await openTab(url);
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`location.protocol === "https:" && document.readyState === "complete"`)) break;
    await sleep(500);
  }
  const before = await evaluate(reportExpr);
  const navigationStart = mainNavigations.length;
  const requestedVersion = userscript.match(/@version\s+(\S+)/)?.[1] || null;
  if (before?.runningScript) {
    if (before.scriptVersion !== requestedVersion) {
      errors.push(`Existing userscript version ${before.scriptVersion || 'unknown'} differs from requested ${requestedVersion || 'unknown'}`);
    }
  } else {
    await evaluate(userscript);
  }
  await sleep(1200);
  await evaluate(BLUR);
  const result = {
    before: { inlineOnclick: before?.inlineOnclick, key: before?.key, scriptVersion: before?.scriptVersion, runningScript: before?.runningScript, nativeGalleryModes: before?.nativeGalleryModes || [] },
    scriptVersion: await evaluate(`document.documentElement.dataset.ehtwScriptVersion || null`),
    mainNavigations: mainNavigations.slice(navigationStart),
    failedRequests,
    network: {
      resourcesByType: { ...resourceCounts },
      responseCount: responseStatuses.length,
      httpFailures: responseStatuses.filter((entry) => Number(entry.status) >= 400),
      transferredBytes: networkStats.transferredBytes
    }
  };
  const allViews = [
    ["desktop-light", 1440, 900, "light"], ["desktop-dark", 1440, 900, "dark"],
    ["desktop-1280", 1280, 800, "light"], ["tablet", 900, 900, "light"],
    ["breakpoint-699", 699, 844, "light"], ["breakpoint-700", 700, 844, "light"],
    ["narrow-390", 390, 844, "dark"],
    // Large desktop / small laptop / tablet portrait+landscape widths.
    ["desktop-1920", 1920, 1080, "light"], ["laptop-1024", 1024, 768, "dark"],
    ["tablet-768", 768, 1024, "light"], ["breakpoint-999", 999, 900, "light"], ["breakpoint-1000", 1000, 900, "light"],
  ];
  const requestedViews = String(process.env.EHTW_TEST_VIEWS || '').split(',').map((v) => v.trim()).filter(Boolean);
  const views = requestedViews.length ? allViews.filter(([name]) => requestedViews.includes(name)) : allViews;
  if (!views.length) throw new Error(`No matching test views: ${requestedViews.join(', ')}`);
  const captureScreenshots = process.env.EHTW_CAPTURE_SCREENSHOTS !== '0';
  for (const [view, width, height, scheme] of views) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await sleep(500);
    result[view] = await evaluate(reportExpr);
    if (process.env.PROBE) (result.probes ??= {})[view] = await evaluate(process.env.PROBE);
    if (captureScreenshots) await shot(send, `${outDir}/${name}-${view}.png`);
  }
  if (await evaluate(`!!document.querySelector('.c1')`)) {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('.c1').scrollIntoView({ block: 'center' })`);
    await sleep(500);
    if (captureScreenshots) await shot(send, `${outDir}/${name}-scrolled.png`);
  }
  if (process.env.SCROLLTO && await evaluate(`!!document.querySelector(${JSON.stringify(process.env.SCROLLTO)})`)) {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector(${JSON.stringify(process.env.SCROLLTO)}).scrollIntoView({ block: 'center' })`);
    await sleep(500);
    if (captureScreenshots) await shot(send, `${outDir}/${name}-target.png`);
  }
  if (process.env.PROBE) result.probe = await evaluate(process.env.PROBE);
  result.errors = [...new Set(errors)].slice(0, 10);
  out[name] = result;
  ws.close();
  await fetch(`${CDP_HTTP}/json/close/${tab.id}`);
}
console.log(JSON.stringify(out, null, 1));
