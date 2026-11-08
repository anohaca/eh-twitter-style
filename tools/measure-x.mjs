// Read-only measurement of the open x.com tab. Nothing is clicked, scrolled or typed.
// Media is blurred for the screenshot only, and both the blur and the viewport are undone.
// Usage: node measure-x.mjs <out.json> <out.png>
import { writeFileSync } from "node:fs";

const [outJson, outPng] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tabs = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const tab = tabs.find((t) => t.type === "page" && new URL(t.url).hostname === "x.com");
if (!tab) throw new Error("No x.com tab");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

const expr = `(() => {
  const m = (e) => { if (!e) return null; const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), font: s.fontFamily.slice(0, 34), size: s.fontSize, weight: s.fontWeight, line: s.lineHeight, color: s.color, bg: s.backgroundColor, radius: s.borderRadius, pad: s.padding, gap: s.gap, borderB: s.borderBottomWidth + ' ' + s.borderBottomColor, borderR: s.borderRightWidth + ' ' + s.borderRightColor }; };
  const q = (s, r = document) => r.querySelector(s);
  const t = (id) => '[data-testid="' + id + '"]';
  const tweet = q('article' + t('tweet'));
  const textOf = (e) => e ? [...e.querySelectorAll('[dir]')].filter((n) => n.children.length === 0 || n.textContent.length < 12) : [];
  const nav = q('nav[role=navigation]');
  const links = nav ? [...nav.querySelectorAll('a,button')] : [];
  const firstLink = links[1] || links[0];
  const linkInner = firstLink?.firstElementChild;
  const tablist = q('[role=tablist]');
  const tabEls = tablist ? [...tablist.querySelectorAll('[role=tab]')] : [];
  const selTab = tabEls.find((e) => e.getAttribute('aria-selected') === 'true');
  const underline = selTab ? [...selTab.querySelectorAll('div')].find((d) => { const b = d.getBoundingClientRect(); return b.height > 0 && b.height <= 5 && b.width > 20; }) : null;
  const actions = tweet ? q('[role=group]', tweet) : null;
  const sidebar = q(t('sidebarColumn'));
  const search = q(t('SearchBox_Search_Input'));
  const searchForm = search?.closest('form');
  const trend = q(t('trend'));
  const trendLines = trend ? [...trend.querySelectorAll('[dir=ltr],[dir=auto]')].slice(0, 3) : [];
  const trendCard = trend?.closest('section') || trend?.parentElement?.parentElement;
  const compose = q(t('tweetTextarea_0'));
  const composeBtn = q(t('tweetButtonInline'));
  return {
    viewport: [innerWidth, innerHeight],
    body: m(document.body),
    primary: m(q(t('primaryColumn'))), header: m(q('[role=banner]')), sidebar: m(sidebar), nav: m(nav),
    logo: m(q('h1 a')), logoSvg: m(q('h1 svg')),
    navCount: links.length, navLink: m(firstLink), navInner: m(linkInner), navIcon: m(firstLink?.querySelector('svg')), navLabel: m(firstLink?.querySelector('[dir]')), navLabels: links.map((l) => l.textContent.trim().slice(0, 14)),
    post: m(q(t('SideNav_NewTweet_Button'))), postText: m(q(t('SideNav_NewTweet_Button') + ' span')), account: m(q(t('SideNav_AccountSwitcher_Button'))),
    tablist: m(tablist), tabs: tabEls.map((e) => [e.textContent.slice(0, 14), e.getAttribute('aria-selected'), Math.round(e.getBoundingClientRect().width)]), tabText: m(selTab?.querySelector('span')), tabOff: m(tabEls.find((e) => e !== selTab)?.querySelector('span')), underline: m(underline),
    compose: m(compose), composeBtn: m(composeBtn), composeBox: m(compose?.closest('[data-testid=primaryColumn] div[style]')),
    tweet: m(tweet), tweetCell: m(q(t('cellInnerDiv'))), tweetAvatar: m(q(t('Tweet-User-Avatar'))), tweetName: m(q(t('User-Name'))), tweetNameText: m(q(t('User-Name') + ' span span')), tweetHandle: m(q(t('User-Name') + ' a[tabindex="-1"] span')), tweetTime: m(q(t('User-Name') + ' time')),
    tweetText: m(q(t('tweetText'))), tweetHashtag: m(q(t('tweetText') + ' a')), tweetPhoto: m(q(t('tweetPhoto'))), tweetMediaWrap: m(q(t('tweetPhoto'))?.parentElement?.parentElement?.parentElement),
    tweetMore: m(q(t('caret'))), actions: m(actions), actionItems: actions ? [...actions.children].map((c) => { const b = c.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.width), c.querySelector('[data-testid]')?.getAttribute('data-testid')]; }) : [], actionIcon: m(actions?.querySelector('svg')), actionCount: m(q('[data-testid=app-text-transition-container] span', actions || document)),
    search: m(search), searchForm: m(searchForm), searchIcon: m(searchForm?.querySelector('svg')), searchBox: m(search?.parentElement?.parentElement),
    trendCard: m(trendCard), trendRow: m(trend), trendLine1: m(trendLines[0]), trendLine2: m(trendLines[1]), trendLine3: m(trendLines[2]),
    sidebarTitles: sidebar ? [...sidebar.querySelectorAll('h2,[role=heading]')].slice(0, 6).map((h) => [h.textContent.slice(0, 24), getComputedStyle(h).fontSize, getComputedStyle(h).fontWeight]) : [],
    sectionTitle: m(sidebar?.querySelector('h2,[role=heading]')),
  };
})()`;

await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(1500);
const data = await evaluate(expr);
writeFileSync(outJson, JSON.stringify(data, null, 1));
await evaluate(`(() => { const s = document.createElement('style'); s.id = '__measure_blur'; s.textContent = '[data-testid=tweetPhoto] *, [data-testid=videoComponent] *, [data-testid=card.wrapper] img, video { filter: blur(24px) !important; }'; document.head.appendChild(s); })()`);
await sleep(300);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(outPng, Buffer.from(shot.result.data, "base64"));
await evaluate(`document.getElementById('__measure_blur')?.remove()`);
await send("Emulation.clearDeviceMetricsOverride");
ws.close();
console.log("ok", Object.keys(data).length);
