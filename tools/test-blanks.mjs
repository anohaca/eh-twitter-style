// Scrolls a whole list like a reader and reports which tweets stay without stats, and why.
// Usage: node test-blanks.mjs <script.user.js> <name=url> [...]
import { readFileSync } from "node:fs";
import { CDP_HTTP } from './cdp-endpoint.mjs';
const [scriptPath, ...pages] = process.argv.slice(2);
const script = readFileSync(scriptPath, "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const page of pages) {
  const eq = page.indexOf("="); const name = page.slice(0, eq), url = page.slice(eq + 1);
  const res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const p = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; p.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 40; i++) { if (await ev(`location.protocol === "https:" && document.readyState === "complete"`)) break; await sleep(500); }
  await ev(`(() => { const real = window.fetch; window.__log = []; window.fetch = async (...a) => { const r = await real(...a); const c = r.clone(); const t = await c.text(); window.__log.push({ url: String(a[0]), status: r.status, size: t.length, fav: t.includes('id="favcount"'), warning: /Content Warning/i.test(t), head: t.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').slice(0, 90) }); return r; }; })()`);
  await ev(script);
  const total = await ev(`document.querySelectorAll('[data-ehtw-href]').length`);
  // Fast flick to the bottom, then dwell: what a reader sees right now.
  await sleep(1000);
  await ev(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await sleep(4000);
  const atBottom = await ev(`(() => { const vis = [...document.querySelectorAll('[data-ehtw-href]')].filter((t) => { const b = t.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; }); return { visible: vis.length, filled: vis.filter((t) => t.querySelector('.ehtw-stat-comments')?.textContent).length }; })()`);
  // Then walk through everything so each row gets its turn.
  for (let i = 0; i < total; i++) {
    await ev(`document.querySelectorAll('[data-ehtw-href]')[${i}]?.scrollIntoView({ block: 'center' })`);
    await sleep(1900);
  }
  await sleep(2500);
  const r = await ev(`(() => { const t = [...document.querySelectorAll('[data-ehtw-href]')]; const blank = t.filter((e) => !e.querySelector('.ehtw-stat-comments')?.textContent); return { total: t.length, filled: t.length - blank.length, blankHrefs: blank.map((e) => e.getAttribute('data-ehtw-href')), html: document.documentElement.className, blockedUntil: (JSON.parse(localStorage.getItem('ehtw-gallery-stats-v6') || '{}').blockedUntil || 0) > Date.now(), log: window.__log.filter((l) => !l.fav).slice(0, 5), reqs: window.__log.length }; })()`);
  console.log(name, JSON.stringify({ total, atBottom, ...r }));
  ws.close();
  await fetch(`${CDP_HTTP}/json/close/${tab.id}`);
}
