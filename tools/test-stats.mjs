// Verifies the lazy gallery stats loader against real pages and a simulated rate limit.
// Usage: node test-stats.mjs <script.user.js>
import { readFileSync } from "node:fs";
import { CDP_HTTP } from './cdp-endpoint.mjs';
const script = readFileSync(process.argv[2], "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "ehtw-gallery-stats-v6";

async function open(url) {
  const res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 40; i++) { if (await ev(`location.protocol === "https:" && document.readyState === "complete"`)) break; await sleep(500); }
  return { ev, close: async () => { ws.close(); await fetch(`${CDP_HTTP}/json/close/${tab.id}`); } };
}
const spy = `(() => { const real = window.fetch; window.__calls = []; window.fetch = (...a) => { window.__calls.push([performance.now(), String(a[0])]); return real(...a); }; })()`;
const read = `(() => { const rows = [...document.querySelectorAll('.ehtw-tweet')]; return { total: rows.length, filled: rows.filter((t) => t.querySelector('.ehtw-stat-favorites')?.textContent).length, rows: rows.slice(0, 4).map((t) => ({ href: t.getAttribute('data-ehtw-href'), c: t.querySelector('.ehtw-stat-comments')?.textContent, f: t.querySelector('.ehtw-stat-favorites')?.textContent, ct: t.querySelector('.ehtw-stat-comments')?.title, ft: t.querySelector('.ehtw-stat-favorites')?.title, r: t.querySelector('.ehtw-tweet-rating')?.textContent })), calls: window.__calls.map((c) => c[1]), gaps: window.__calls.slice(1).map((c, i) => Math.round(c[0] - window.__calls[i][0])) }; })()`;

// 1. Fresh load: only tweets near the viewport are requested, one at a time.
let p = await open("https://e-hentai.org/");
await p.ev(`localStorage.removeItem('${KEY}')`);
await p.ev(spy); await p.ev(script);
await sleep(9000);
const first = await p.ev(read);
console.log("fresh", JSON.stringify({ total: first.total, filled: first.filled, calls: first.calls.length, minGap: Math.min(...first.gaps), gaps: first.gaps, rows: first.rows.map((r) => ({ c: r.c, f: r.f, r: r.r })) }));
const sample = first.rows.filter((r) => r.f)[0];
await p.close();

// 2. The numbers match what the gallery page itself says.
if (sample) {
  const g = await open(sample.href);
  const truth = await g.ev(`({ fav: document.querySelector('#favcount')?.textContent, comments: document.querySelectorAll('.c1').length })`);
  console.log("truth", JSON.stringify(truth), "tweet", sample.ct, "/", sample.ft);
  await g.ev(script); await sleep(800);
  console.log("detail", JSON.stringify(await g.ev(`({ heart: document.querySelector('.ehtw-detail-favorite-count')?.textContent, reply: document.querySelector('.ehtw-detail-reply-count')?.textContent, header: document.querySelector('#ehtw-header')?.textContent, hasStars: !!document.querySelector('.ehtw-detail-rating-action #rating_image') })`)));
  await g.close();
}

// 3. Reload: cached tweets make no requests.
p = await open("https://e-hentai.org/");
await p.ev(spy); await p.ev(script);
await sleep(600);
const cached = await p.ev(read);
const cachedHrefs = new Set(first.calls);
console.log("reload", JSON.stringify({ filled: cached.filled, calls: cached.calls.length, refetched: cached.calls.filter((u) => cachedHrefs.has(u)).length }));
await p.close();

// 4. Simulated rate limit: stops after one request and stays stopped on the next load.
p = await open("https://e-hentai.org/");
await p.ev(`localStorage.removeItem('${KEY}')`);
await p.ev(`(() => { window.__calls = []; window.fetch = async (u) => { window.__calls.push([performance.now(), String(u)]); return new Response('Your IP address has been temporarily banned for excessive pageloads', { status: 200 }); }; })()`);
await p.ev(script); await sleep(5000);
const limited = await p.ev(read);
const stored = await p.ev(`JSON.parse(localStorage.getItem('${KEY}')||'{}').blockedUntil > Date.now()`);
console.log("limited", JSON.stringify({ calls: limited.calls.length, blockedStored: stored }));
await p.close();
p = await open("https://e-hentai.org/");
await p.ev(`(() => { window.__calls = []; window.fetch = async (u) => { window.__calls.push([performance.now(), String(u)]); return new Response('', { status: 200 }); }; })()`);
await p.ev(script); await sleep(2500);
console.log("afterBlock", JSON.stringify({ calls: (await p.ev(read)).calls.length }));
await p.ev(`localStorage.removeItem('${KEY}')`);
await p.close();
