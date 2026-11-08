// Real phone emulation: mobile:true makes Chrome honour the page's viewport meta,
// which a plain 390px window does not. Page images are blurred in screenshots.
// Usage: node test-phone.mjs <script.user.js> <outdir> <name=url> [...]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CDP_HTTP } from './cdp-endpoint.mjs';
const [scriptPath, outDir, ...pages] = process.argv.slice(2);
const script = readFileSync(scriptPath, "utf8");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Device profile: iphone (default), android or ipad. Width/height come from env.
const DEVICE_PROFILES = {
  iphone: { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone", dpr: 3 },
  android: { ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", platform: "Linux armv8l", dpr: 2.625 },
  ipad: { ua: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPad", dpr: 2 }
};
const DEVICE = DEVICE_PROFILES[process.env.EHTW_PHONE_DEVICE || 'iphone'] || DEVICE_PROFILES.iphone;
const UA = DEVICE.ua;
const PHONE_WIDTH = Math.max(320, Number.parseInt(process.env.EHTW_PHONE_WIDTH || '390', 10));
const PHONE_HEIGHT = Math.max(320, Number.parseInt(process.env.EHTW_PHONE_HEIGHT || '844', 10));
const screenshotExcluded = new Set(String(process.env.EHTW_SCREENSHOT_EXCLUDE || '').split(',').map((value) => value.trim()).filter(Boolean));
for (const page of pages) {
  const eq = page.indexOf("=");
  const name = page.slice(0, eq), url = page.slice(eq + 1);
  const res = await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: "PUT" });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = []; const mainNavigations = []; const failedRequests = []; const requestUrls = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception?.description || "").slice(0, 160));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 160));
    if (m.method === "Page.frameNavigated" && !m.params.frame.parentId) mainNavigations.push(m.params.frame.url);
    if (m.method === "Network.requestWillBeSent") requestUrls.set(m.params.requestId, m.params.request.url);
    if (m.method === "Network.loadingFailed") failedRequests.push({ url: requestUrls.get(m.params.requestId) || '', error: m.params.errorText, type: m.params.type });
  };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: PHONE_WIDTH, height: PHONE_HEIGHT, deviceScaleFactor: DEVICE.dpr, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await send("Emulation.setUserAgentOverride", { userAgent: UA, platform: DEVICE.platform });
  await send("Page.navigate", { url });
  await sleep(1500);
  for (let i = 0; i < 40; i++) { if (await ev(`location.protocol === "https:" && document.readyState === "complete"`)) break; await sleep(500); }
  const before = await ev(`({ w: innerWidth, vp: document.querySelector('meta[name=viewport]')?.content ?? null })`);
  const navigationStart = mainNavigations.length;
  const versionBefore = await ev(`({ version:document.documentElement.dataset.ehtwScriptVersion || null, running:!!window.__EHTW_STYLE_050__ })`);
  const requestedVersion = script.match(/@version\s+(\S+)/)?.[1] || null;
  if (versionBefore.running) {
    if (versionBefore.version !== requestedVersion) errors.push(`Existing userscript version ${versionBefore.version || 'unknown'} differs from requested ${requestedVersion || 'unknown'}`);
  } else {
    await ev(script);
  }
  await sleep(1000);
  const report = await ev(`(() => { const l = document.querySelector('#ehtw-left'), r = l && l.getBoundingClientRect(); const c = document.querySelector('#ehtw-center')?.getBoundingClientRect(); const nb = [...document.querySelectorAll('#nb a')].filter((a) => a.getBoundingClientRect().width > 0).length; return { innerWidth, clientW: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth, vp: document.querySelector('meta[name=viewport]')?.content ?? null, left: r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], leftPos: l && getComputedStyle(l).position, center: c && [Math.round(c.x), Math.round(c.width)], navVisible: nb, html: document.documentElement.className, scriptVersion: document.documentElement.dataset.ehtwScriptVersion || null, phoneMQ: matchMedia('(max-width: 699px)').matches }; })()`);
  report.overlaps = await ev(`(() => { const blocks = ['.ehtw-gallery-grid-section', '.ehtw-detail-tags', '.ehtw-detail-meta', '.ehtw-detail-actions', '#newtagfield', '#newtagbutton', '.ehtw-detail-timestamp', '.ehtw-detail-stats', '.ehtw-detail-favorite-action', '.ehtw-detail-rating-action'].map((s) => [s, document.querySelector(s)]).filter(([, e]) => e && e.getBoundingClientRect().height > 0); const out = []; for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) { const [a, x] = blocks[i], [b, y] = blocks[j]; if (x.contains(y) || y.contains(x)) continue; const p = x.getBoundingClientRect(), q = y.getBoundingClientRect(); if (p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1) out.push(a + ' x ' + b); } const w = document.documentElement.clientWidth; const clipped = ['#gdr', '.ehtw-detail-rating-action', '#rating_image', '.ehtw-detail-favorite-action'].filter((s) => { const e = document.querySelector(s); return e && e.getBoundingClientRect().right > w + 1; }); return { out, clipped }; })()`);
  await ev(`(() => { const s = document.createElement('style'); s.textContent = 'img, [style*="background"]:not(.ir), video { filter: blur(24px) !important; }'; document.head.appendChild(s); })()`);
  await sleep(300);
  const screenshotCaptured = !screenshotExcluded.has(name);
  if (screenshotCaptured) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${outDir}/${name}-${PHONE_WIDTH}x${PHONE_HEIGHT}.png`, Buffer.from(shot.result.data, "base64"));
  }
  console.log(name, JSON.stringify({ viewport: `${PHONE_WIDTH}x${PHONE_HEIGHT}`, before, report, errors, failedRequests, mainNavigations: mainNavigations.slice(navigationStart), screenshotCaptured }));
  ws.close();
  await fetch(`${CDP_HTTP}/json/close/${tab.id}`);
}
