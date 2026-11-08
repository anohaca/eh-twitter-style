// Checks name = author and @handle = uploader against the original page's own data.
// Usage: node test-author.mjs <script.user.js> <listUrl> [...]
import { readFileSync } from "node:fs";
import { CDP_HTTP } from './cdp-endpoint.mjs';
const [scriptPath, ...urls] = process.argv.slice(2);
const script = readFileSync(scriptPath, "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(url) {
  const tab = await (await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const p = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; p.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 40; i++) { if (await ev(`location.protocol === "https:" && document.readyState === "complete"`)) break; await sleep(500); }
  return { ev, close: async () => { ws.close(); await fetch(`${CDP_HTTP}/json/close/${tab.id}`); } };
}
const list = await open(urls[0]);
const before = await list.ev(`[...document.querySelectorAll('table.itg.gltc tr')].filter((r) => r.querySelector('.gl3c')).map((r) => ({ up: r.querySelector('.gl4c a')?.textContent, title: r.querySelector('.glink')?.textContent, upHref: r.querySelector('.gl4c a')?.href, tags: [...r.querySelectorAll('[title]')].map((t) => t.title).filter((t) => /^(artist|group):/.test(t)) }))`);
await list.ev(script);
await sleep(800);
const after = await list.ev(`[...document.querySelectorAll('.ehtw-tweet')].map((t) => ({ name: t.querySelector('.ehtw-author-name')?.textContent, nameHref: t.querySelector('.ehtw-author-name a')?.getAttribute('href'), handle: t.querySelector('.ehtw-handle')?.textContent, handleHref: t.querySelector('.ehtw-handle a')?.href, gallery: t.getAttribute('data-ehtw-href') }))`);
let handleOk = 0, tagged = 0, taggedOk = 0, fallback = 0;
before.forEach((b, i) => { const a = after[i]; if (a.handle === '@' + b.up.replace(/\s+/g, '_') && a.handleHref === b.upHref) handleOk++; if (b.tags.length) { tagged++; if (a.nameHref?.startsWith('/tag/')) taggedOk++; } if (a.name === b.up) fallback++; });
console.log(JSON.stringify({ rows: before.length, handleOk, tagged, taggedOk, nameIsUploader: fallback }));
await list.close();
const pick = after.find((a, i) => before[i].tags.length) || after[0];
const d = await open(pick.gallery);
const truth = await d.ev(`({ up: document.querySelector('#gdn a')?.textContent, artists: [...document.querySelectorAll('a[id^="ta_artist:"]')].map((a) => a.textContent), groups: [...document.querySelectorAll('a[id^="ta_group:"]')].map((a) => a.textContent) })`);
await d.ev(script); await sleep(700);
const detailAfter = await d.ev(`({ name: document.querySelector('.ehtw-detail-author .ehtw-author-name')?.textContent, handle: document.querySelector('.ehtw-detail-author .ehtw-handle')?.textContent, href: document.querySelector('.ehtw-detail-author .ehtw-handle a')?.href })`);
console.log("detail", JSON.stringify({ hasUploader: !!truth.up, artistTags: truth.artists.length, groupTags: truth.groups.length, hasAuthorLabel: !!detailAfter.name, hasUploaderHandle: !!detailAfter.handle, uploaderLinkPresent: /\/uploader\//.test(detailAfter.href || '') }));
await d.close();
