// Menus, the favorite heart and the vote heart. Site functions are stubbed, so nothing is
// really favorited or voted. Vote links only exist when logged in, so they are mocked.
// Usage: node test-actions.mjs <script.user.js> <galleryUrl> <outdir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CDP_HTTP } from './cdp-endpoint.mjs';
const [scriptPath, galleryUrl, outDir] = process.argv.slice(2);
const script = readFileSync(scriptPath, "utf8");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
async function open(url, width = 1440, height = 900, mobile = false) {
  const res = await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: "PUT" });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const p = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; p.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (mobile) await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
  await send("Page.navigate", { url });
  await sleep(1500);
  for (let i = 0; i < 40; i++) { if (await ev(`location.protocol === "https:" && document.readyState === "complete"`)) break; await sleep(500); }
  return { send, ev, close: async () => { ws.close(); await fetch(`${CDP_HTTP}/json/close/${tab.id}`); } };
}
const click = async (p, x, y) => { for (const [type, extra] of [["mouseMoved", {}], ["mousePressed", { button: "left", clickCount: 1 }], ["mouseReleased", { button: "left", clickCount: 1 }]]) await p.send("Input.dispatchMouseEvent", { type, x, y, ...extra }); };
const center = (sel) => `(async () => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 200)); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, h: b.height }; })()`;
const stubs = `(() => { window.__calls = []; window.popUp = (u) => { window.__calls.push(['popUp', u]); return false; }; window.pop_fav = () => { window.__calls.push(['pop_fav']); return false; }; window.pop_ren = () => { window.__calls.push(['pop_ren']); return false; }; window.vote_comment_up = (i) => { window.__calls.push(['up', i]); document.getElementById('comment_vote_up_' + i).style.color = 'blue'; }; window.vote_comment_down = (i) => { window.__calls.push(['down', i]); }; })()`;
const mockLogin = `(() => { const c = [...document.querySelectorAll('.c1')].find((e) => e.querySelector('.c5')); const i = c.querySelector('[id^=comment_score_]').id.replace('comment_score_', ''); const d = document.createElement('div'); d.className = 'c4 nosel'; d.innerHTML = '[<a id="comment_vote_up_' + i + '" href="#" onclick="vote_comment_up(' + i + '); return false">Vote+</a>] [<a id="comment_vote_down_' + i + '" href="#" onclick="vote_comment_down(' + i + '); return false">Vote-</a>]'; c.querySelector('.c2').insertBefore(d, c.querySelector('.c5')); return i; })()`;

for (const [label, w, h, m] of [["desktop", 1440, 900, false], ["phone", 393, 852, true]]) {
  const p = await open(galleryUrl, w, h, m);
  await p.ev(stubs);
  const id = await p.ev(mockLogin);
  await p.ev(script);
  await sleep(800);
  check(`${label} no actions card`, !(await p.ev(`!!document.querySelector('.ehtw-operation-card')`)));
  check(`${label} add-to-favorites text gone`, (await p.ev(`document.querySelector('#favoritelink').getBoundingClientRect().height`)) === 0);
  // Dots in the post card.
  const b = await p.ev(center(".ehtw-detail-author .ehtw-menu-button"));
  check(`${label} dots present`, !!b);
  await click(p, b.x, b.y);
  await sleep(200);
  const items = await p.ev(`(() => { const m = document.querySelector('.ehtw-detail-author .ehtw-menu'); const r = m.getBoundingClientRect(); return { shown: r.height > 0, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, labels: [...m.querySelectorAll('a')].map((a) => a.textContent.trim()) }; })()`);
  check(`${label} menu opens in view`, items.shown && items.inView, JSON.stringify(items.labels));
  const arch = await p.ev(`(() => { const a = [...document.querySelectorAll('.ehtw-detail-author .ehtw-menu a')].find((e) => /Archive/.test(e.textContent)); const b = a.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  await click(p, arch.x, arch.y);
  await sleep(300);
  const calls = await p.ev(`window.__calls`);
  check(`${label} archive action runs`, calls.some((c) => c[0] === "popUp" && /archiver\.php/.test(c[1])), JSON.stringify(calls).slice(0, 80).replace(/[0-9a-f]{10}/g, "T"));
  check(`${label} menu closes after action`, !(await p.ev(`!!document.querySelector('.ehtw-menu-open')`)));
  await click(p, b.x, b.y); await sleep(150);
  await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(150);
  check(`${label} escape closes menu`, !(await p.ev(`!!document.querySelector('.ehtw-menu-open')`)));
  // Favorite heart opens the browser's native select list; do not choose a folder here.
  const f = await p.ev(center(".ehtw-detail-favorite-action"));
  await click(p, f.x, f.y); await sleep(200);
  check(`${label} browser folder list opens`, (await p.ev(`!!document.querySelector('.ehtw-browser-favorite-picker')`)) === true);
  await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(100);
  // Vote heart.
  const v = await p.ev(center("button.ehtw-comment-like"));
  check(`${label} comment heart is a button`, !!v);
  await click(p, v.x, v.y); await sleep(200);
  check(`${label} comment heart votes`, await p.ev(`window.__calls.some((c) => c[0] === 'up' && String(c[1]) === '${id}')`));
  check(`${label} voted heart turns on`, await p.ev(`document.querySelector('button.ehtw-comment-like').classList.contains('ehtw-liked')`));
  check(`${label} vote text hidden`, (await p.ev(`document.querySelector('[id^=comment_vote_up_]').getBoundingClientRect().height`)) === 0);
  const cm = await p.ev(center(".ehtw-comment-tweet:has(button.ehtw-comment-like) .ehtw-menu-button"));
  await click(p, cm.x, cm.y); await sleep(200);
  const cmItems = await p.ev(`[...document.querySelectorAll('.ehtw-menu-open .ehtw-menu-item')].map((e) => e.textContent)`);
  check(`${label} comment menu`, cmItems.includes("Vote down") && cmItems.includes("Contact Poster"), JSON.stringify(cmItems));
  const d = await p.ev(`(() => { const e = [...document.querySelectorAll('.ehtw-menu-open .ehtw-menu-item')].find((x) => x.textContent === 'Vote down'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  await click(p, d.x, d.y); await sleep(200);
  check(`${label} vote down runs`, await p.ev(`window.__calls.some((c) => c[0] === 'down')`));
  // Open menu for the picture.
  await p.ev(`(() => { const s = document.createElement('style'); s.textContent = 'img, [style*="background"]:not(.ir), video { filter: blur(24px) !important; }'; document.head.appendChild(s); window.scrollTo(0, 0); })()`);
  await sleep(300);
  const bb = await p.ev(`(() => { const b = document.querySelector('.ehtw-detail-author .ehtw-menu-button').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  await click(p, bb.x, bb.y); await sleep(250);
  const s = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${outDir}/menu-${label}.png`, Buffer.from(s.result.data, "base64"));
  await p.close();
}

// Logged-out comments: the heart stays a plain number.
{
  const p = await open(galleryUrl);
  await p.ev(script); await sleep(600);
  check("logged out heart not a button", (await p.ev(`document.querySelectorAll('button.ehtw-comment-like').length`)) === 0);
  await p.close();
}

// List cards get their dots from the gallery page.
{
  const p = await open("https://e-hentai.org/");
  await p.ev(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ehtw-gallery-stats')) localStorage.removeItem(k); })()`);
  await p.ev(script); await sleep(7000);
  const r = await p.ev(`(() => { const m = document.querySelector('.ehtw-tweet .ehtw-menu'); return m ? { labels: [...m.querySelectorAll('a')].map((a) => a.textContent), external: [...m.querySelectorAll('a')].filter((a) => !a.href.startsWith('https://e-hentai.org/')).length, count: document.querySelectorAll('.ehtw-tweet .ehtw-menu-button').length } : null; })()`);
  check("list card dots", !!r && r.labels.length > 0 && r.external === 0, JSON.stringify(r));
  const b = await p.ev(center(".ehtw-tweet .ehtw-menu-button"));
  await click(p, b.x, b.y); await sleep(200);
  const box = await p.ev(`(() => { const m = document.querySelector('.ehtw-tweet .ehtw-menu-open .ehtw-menu'); const r = m.getBoundingClientRect(); const a = m.querySelector('a').getBoundingClientRect(); const t = document.elementFromPoint(a.x + 10, a.y + 5); return { h: Math.round(r.height), top: t?.className }; })()`);
  check("list menu on top", box.h > 0 && /ehtw-menu-item/.test(box.top || ""), JSON.stringify(box));
  await p.close();
}
console.log(results.join("\n"));
