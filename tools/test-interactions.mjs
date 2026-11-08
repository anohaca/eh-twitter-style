// Real interaction checks with the userscript applied. Rating, favourites and
// comment posting change account data, so those only get a hit test, never a click.
// Usage: node test-interactions.mjs <script.user.js> <listUrl> <galleryUrl> <outdir>
import { readFileSync, mkdirSync } from "node:fs";
import { CDP_HTTP } from './cdp-endpoint.mjs';

const [scriptPath, listUrl, galleryUrl, outDir] = process.argv.slice(2);
const userscript = readFileSync(scriptPath, "utf8");
const siteOrigin = new URL(listUrl).origin;
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);

async function open(url, width = 1440, height = 900, mobile = false) {
  const res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const loaded = async () => {
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`location.protocol === "https:" && document.readyState === "complete"`)) return;
      await sleep(500);
    }
  };
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile });
  if (mobile) {
    await send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
  }
  await loaded();
  await evaluate(userscript);
  await sleep(800);
  const close = async () => { ws.close(); await fetch(`${CDP_HTTP}/json/close/${tab.id}`); };
  return { send, evaluate, loaded, close, errors };
}

// Scrolls the element into view and reports whether a real click at its centre lands on it.
const hitExpr = (sel) => `(async () => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return { found: false };
  e.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 150));
  const b = e.getBoundingClientRect();
  const x = b.left + b.width / 2, y = b.top + b.height / 2;
  const top = document.elementFromPoint(x, y);
  return { found: true, x, y, hit: !!top && (top === e || e.contains(top) || top.contains(e) || (top.tagName === 'AREA' && !!e.closest('#gdr')?.contains(top))), top: top && (top.tagName + '.' + String(top.className).slice(0, 30) + '#' + top.id) };
})()`;

async function click(page, x, y) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

// Search form submits through real typing and a real click.
{
  const p = await open(listUrl);
  const h = await p.evaluate(hitExpr("#f_search"));
  check("search box clickable", h.hit, h.top);
  await click(p, h.x, h.y);
  await p.send("Input.insertText", { text: "test" });
  await p.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await p.send("Input.dispatchKeyEvent", { type: "char", text: "\r" });
  await p.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(2500);
  const u = await p.evaluate("location.href");
  check("search submits", /f_search=test/.test(u), u);
  await p.close();
}

// List pages continue automatically near the bottom instead of exposing page links.
{
  const p = await open(listUrl);
  const before = await p.evaluate(`document.querySelectorAll('.ehtw-tweet[data-ehtw-href]').length`);
  const navVisible = await p.evaluate(`(() => {const e=document.querySelector('#dnext');return !!e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';})()`);
  check("list pagination links are hidden", !navVisible);
  await p.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  let appended = false;
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    const after = await p.evaluate(`document.querySelectorAll('.ehtw-tweet[data-ehtw-href]').length`);
    if (after > before) { appended = true; break; }
  }
  check("scrolling near the edge appends the next page", appended, `before=${before}`);
  await p.close();
}

// Category filter toggles through the site's own inline handler.
{
  const p = await open(listUrl);
  const sel = "#searchbox [id^=cat_]";
  const toggle = await p.evaluate(hitExpr(".ehtw-filters-toggle"));
  check("filters toggle clickable", toggle.hit, toggle.top);
  await click(p, toggle.x, toggle.y);
  await sleep(300);
  const h = await p.evaluate(hitExpr(sel));
  check("category filter clickable", h.hit, h.top);
  const before = await p.evaluate(`document.querySelector('#f_cats')?.value`);
  await click(p, h.x, h.y);
  await sleep(300);
  const after = await p.evaluate(`document.querySelector('#f_cats')?.value`);
  check("category filter toggles", before !== after, `${before} -> ${after}`);
  await p.close();
}

// Tweet body opens the gallery, and display mode select still exists and is hittable.
{
  const p = await open(listUrl);
  const f = await p.evaluate(hitExpr(".ehtw-filters-toggle"));
  await click(p, f.x, f.y);
  await sleep(300);
  const m = await p.evaluate(hitExpr(".searchnav select"));
  check("display mode select clickable", m.hit, m.top);
  await click(p, f.x, f.y);
  await sleep(300);
  const h = await p.evaluate(hitExpr(".glink"));
  check("gallery title clickable", h.hit, h.top);
  await click(p, h.x, h.y);
  await sleep(2500);
  const u = await p.evaluate("location.pathname");
  check("title opens gallery", /^\/g\/\d+\//.test(u), u);
  await p.close();
}

// Collapsed navigation entries, and the actions built for each tweet.
for (const [label, width, height, mobile] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]]) {
  const p = await open(listUrl, width, height, mobile);
  const visible = `[...document.querySelectorAll('#nb a')].filter((a) => a.getBoundingClientRect().width > 0).length`;
  const before = await p.evaluate(visible);
  const more = await p.evaluate(hitExpr(".ehtw-more-button"));
  check(`${label} more menu clickable`, !!more.hit, more.top || "not found");
  if (more.found) {
    await click(p, more.x, more.y);
    await sleep(300);
  }
  const after = await p.evaluate(visible);
  check(`${label} more menu reveals links`, after > before, `${before} -> ${after}`);
  const moreAgain = await p.evaluate(hitExpr(".ehtw-more-button"));
  if (moreAgain.found) {
    await click(p, moreAgain.x, moreAgain.y);
    await sleep(300);
  }
  const collapsed = await p.evaluate(visible);
  check(`${label} more menu closes`, collapsed === before, `${after} -> ${collapsed}`);
  const s = await p.evaluate(hitExpr("#f_search"));
  check(`${label} search box reachable`, s.hit, s.top);
  for (const sel of ["#dnext", ".ehtw-repost-available .gldown img", ".ehtw-top-tab", ".ehtw-who-row a", ".ehtw-composer", ".ehtw-account-card"]) {
    if (label === "mobile" && sel !== "#dnext" && sel !== ".ehtw-repost-available .gldown img" && sel !== ".ehtw-top-tab") continue;
    const h = await p.evaluate(hitExpr(sel));
    check(`${label} ${sel} reachable`, !!h.hit, h.top || "not found");
  }
  await p.close();
}

// Panels that live behind Filters, and pages without the site's search box.
{
  const p = await open(listUrl);
  const f = await p.evaluate(hitExpr(".ehtw-filters-toggle"));
  await click(p, f.x, f.y);
  await sleep(300);
  const link = await p.evaluate(`(() => { const a = [...document.querySelectorAll('#searchbox a')].find((e) => /File Search/.test(e.textContent)); a.scrollIntoView({ block: 'center' }); const b = a.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  await click(p, link.x, link.y);
  await sleep(500);
  const fs = await p.evaluate(`(() => { const e = document.querySelector('#fsdiv'); const b = e.getBoundingClientRect(); return { h: Math.round(b.height), inShell: !!e.closest('#ehtw-shell'), input: !!e.querySelector('input[type=file]') }; })()`);
  check("file search panel opens in layout", fs.h > 0 && fs.inShell && fs.input, JSON.stringify(fs));
  const rb = await p.evaluate(`!!document.querySelector('#rangebar')?.closest('#ehtw-shell')`);
  check("date range bar inside layout", rb === true, String(rb));
  await p.close();
  const q = await open(`${siteOrigin}/popular`);
  const m = await q.evaluate(hitExpr(".searchnav select"));
  check("popular display mode reachable", m.hit, m.top || "not found");
  await q.close();
  const r = await open(`${siteOrigin}/toplist.php`);
  const s = await r.evaluate(hitExpr(".ehtw-right-search-input"));
  check("right search reachable on generic page", !!s.hit, s.top || "not found");
  if (s.found) {
    await click(r, s.x, s.y);
    await r.send("Input.insertText", { text: "test" });
    await r.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await r.send("Input.dispatchKeyEvent", { type: "char", text: "\r" });
    await r.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await sleep(2500);
    const u = await r.evaluate("location.href");
    check("right search submits", /f_search=test/.test(u), u);
  }
  await r.close();
  const n = await open(`${siteOrigin}/torrents.php`);
  const nx = await n.evaluate(hitExpr("table.ptt a"));
  check("torrents pagination reachable", nx.hit, nx.top);
  const fm = await n.evaluate(hitExpr("#focusme"));
  check("torrents search reachable", fm.hit, fm.top);
  await n.close();
}

// Actions in the tweet do what they show.
{
  const p = await open(listUrl);
  const heart = await p.evaluate(`document.querySelector('.ehtw-twitter-action-heart')?.getAttribute('href')`);
  check("heart opens favorite form", /gallerypopups\.php\?gid=\d+&t=[0-9a-f]+&act=addfav/.test(heart || ""), heart);
  const h = await p.evaluate(hitExpr(".ehtw-tag-link"));
  check("tag link reachable", h.hit, h.top);
  await click(p, h.x, h.y);
  await sleep(2500);
  const u = await p.evaluate("location.pathname");
  check("tag link opens tag page", /^\/tag\//.test(u), u);
  await p.close();
}

// Hovering every tweet must not trip the site's own preview handlers.
{
  const p = await open(listUrl);
  for (let i = 0; i < 6; i++) {
    const h = await p.evaluate(`(async () => {
      const e = document.querySelectorAll('.glink')[${i}];
      e.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 100));
      const b = e.getBoundingClientRect();
      return { x: b.left + 20, y: b.top + 5 };
    })()`);
    await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: h.x, y: h.y });
    await sleep(250);
  }
  check("hover raises no errors", p.errors.length === 0, p.errors[0]?.slice(0, 90) || "");
  await p.close();
}

// Gallery page at each width. Hit test only for anything that writes account data.
for (const [label, width, height, mobile] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]]) {
  const p = await open(galleryUrl, width, height, mobile);
  for (const sel of [".ehtw-detail-favorite-action", "#rating_image", "#taglist a", "#gdt a", ".ehtw-detail-author .ehtw-menu-button", "#postnewcomment a", ".c1 a", ".dp a"]) {
    const h = await p.evaluate(hitExpr(sel));
    if (h.found) check(`${label} ${sel} reachable`, h.hit, h.top);
    else check(`${label} ${sel} present`, false, "not on page");
  }
  await p.close();
}

// The comment form only needs to open; nothing is typed or submitted.
{
  const p = await open(galleryUrl);
  const h = await p.evaluate(hitExpr("#postnewcomment a"));
  await click(p, h.x, h.y);
  await sleep(500);
  const shown = await p.evaluate(`(() => { const f = document.querySelector('#formdiv'); if (!f) return null; const r = f.getBoundingClientRect(); return r.height > 0 && r.right <= document.documentElement.clientWidth + 1; })()`);
  check("comment form opens inside layout", shown === true, String(shown));
  await p.close();
}

// Reply form opens under the reply box; the site's score hover still works.
{
  const p = await open(galleryUrl);
  const h = await p.evaluate(hitExpr(".ehtw-comment-like .c5"));
  check("comment score reachable", h.hit, h.top);
  await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: h.x, y: h.y });
  await sleep(300);
  const shown = await p.evaluate(`(() => { const c = document.querySelector('.ehtw-comment-like .c5').closest('.c1'); const v = c.querySelector('.c7'); return v.getBoundingClientRect().height > 0; })()`);
  check("score hover shows votes", shown === true, String(shown));
  const r = await p.evaluate(hitExpr("#postnewcomment a"));
  await click(p, r.x, r.y);
  await sleep(500);
  const form = await p.evaluate(`(() => { const f = document.querySelector('#formdiv'), b = document.querySelector('#ehtw-reply-box'); const a = f.getBoundingClientRect(), c = b.getBoundingClientRect(); return { below: a.top >= c.bottom - 1, h: Math.round(a.height), hidden: getComputedStyle(document.querySelector('#postnewcomment')).display }; })()`);
  check("reply form opens under reply box", form.below && form.h > 0, JSON.stringify(form));
  await p.close();
}

// Detail strip: thumbnails open their page, and long galleries can still page.
{
  const p = await open(galleryUrl);
  const h = await p.evaluate(hitExpr("#gdt a"));
  check("strip thumbnail reachable", h.hit, h.top);
  await click(p, h.x, h.y);
  await sleep(2500);
  const u = await p.evaluate("location.pathname");
  check("strip thumbnail opens page", /^\/s\//.test(u), u.replace(/[0-9a-f]{10}/, "HASH"));
  await p.close();
  if (process.env.MULTI_URL) {
    const q = await open(process.env.MULTI_URL);
    const n = await q.evaluate(hitExpr(".ehtw-gallery-pagination table.ptt td:nth-child(3) a"));
    check("strip pagination reachable", n.hit, n.top);
    if (n.hit) {
      await click(q, n.x, n.y);
      await sleep(2500);
      const v = await q.evaluate("location.search");
      check("strip pagination turns page", /p=1/.test(v), v);
    }
    await q.close();
  } else {
    results.push('SKIP  strip pagination requires a gallery with multiple thumbnail pages');
  }
}

// Pages that must stay untouched.
{
  const p = await open(`${siteOrigin}/popular?nw=session`);
  const list = await p.evaluate(`({ html: document.documentElement.className, table: !!document.querySelector('table.itg') })`);
  results.push(`INFO  /popular ${JSON.stringify(list)}`);
  await p.close();
  const q = await open(`${siteOrigin}/?inline_set=dm_t`);
  const mode = await q.evaluate(`({ html: document.documentElement.className, gltc: !!document.querySelector('table.itg.gltc'), itg: document.querySelector('.itg')?.className, sw: document.documentElement.scrollWidth })`);
  results.push(`INFO  thumbnail mode ${JSON.stringify(mode)}`);
  await q.evaluate(`location.href = ${JSON.stringify(`${siteOrigin}/?inline_set=dm_l`)}`);
  await sleep(1500);
  await q.close();
}

console.log(results.join("\n"));
