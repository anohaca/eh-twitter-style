// Deterministic, content-free stand-in for E-Hentai / ExHentai.
//
// Every page is generated from a small synthetic data set (neutral titles,
// generic tags, SVG placeholder images) using the same markup structure the
// real site serves. The site is stateful per instance so that follow / favorite
// / My Tags flows can be exercised end to end without touching a real account.
import { readFileSync } from 'node:fs';

const NATIVE_JS = readFileSync(new URL('./native.js', import.meta.url), 'utf8');
const REAL_SITE = new URL('../fixtures/real-site/2026-11-06/', import.meta.url);
const REAL_SCRIPTS = Object.fromEntries(['ehg_index.c.js', 'ehg_gallery.c.js', 'ehg_show.c.js']
  .map((name) => [name, readFileSync(new URL(name, REAL_SITE), 'utf8')]));
const REAL_CSS = readFileSync(new URL('g.css', REAL_SITE), 'utf8');

export const CATEGORIES = [
  // [ctClass, label, bitIndex used by toggle_category, f_cats bit]
  ['ct2', 'Doujinshi', 2, 2],
  ['ct3', 'Manga', 3, 4],
  ['ct4', 'Artist CG', 4, 8],
  ['ct5', 'Game CG', 5, 16],
  ['cta', 'Western', 10, 512],
  ['ct9', 'Non-H', 9, 256],
  ['ct6', 'Image Set', 6, 32],
  ['ct7', 'Cosplay', 7, 64],
  ['ct8', 'Asian Porn', 8, 128],
  ['ct1', 'Misc', 1, 1]
];

export const UPLOADERS = ['alice_uploader', 'bob uploader', 'carol', 'dave_d', 'erin-e'];
const TAG_POOL = [
  'language:english', 'language:japanese', 'parody:original', 'character:sample hero',
  'artist:alpha studio', 'artist:gamma ink', 'group:beta circle', 'female:glasses',
  'female:twintails', 'male:hat', 'other:full color', 'other:multi-work series', 'mixed:group'
];
export const XSS_TITLE = '<img src=x onerror="window.__ehtwXss=1">Escaped <b>title</b> & "quotes"';

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const hex = (n, len = 10) => (Math.abs(Math.imul(n, 2654435761) >>> 0).toString(16) + 'abcdef0123456789').slice(0, len);
const pad = (n) => String(n).padStart(2, '0');
const fmtPosted = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtComment = (date) => `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

export function buildGalleries({ count = 60, now = Date.now() } = {}) {
  const galleries = [];
  for (let i = 0; i < count; i += 1) {
    const gid = 5000 - i;
    const category = CATEGORIES[i % CATEGORIES.length];
    const tagCount = 3 + (i % 8); // up to 10 tags, so the 6-tag cap is exercised
    const tags = [];
    for (let t = 0; t < tagCount; t += 1) {
      const tag = TAG_POOL[(i + t * 3) % TAG_POOL.length];
      if (!tags.includes(tag)) tags.push(tag);
    }
    const pages = i === 0 ? 45 : i === 1 ? 3 : 8 + (i % 30);
    galleries.push({
      index: i,
      gid,
      token: hex(gid),
      title: i === 3 ? XSS_TITLE : `Sample Gallery ${String(i + 1).padStart(2, '0')}`,
      jtitle: `サンプル ${i + 1}`,
      category,
      uploader: UPLOADERS[i % UPLOADERS.length],
      posted: new Date(now - (i * 37 + 5) * 60_000 - (i > 40 ? 400 * 86_400_000 : 0)),
      rating: [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1][i % 9],
      ratingCount: 10 + i * 7,
      favorites: 3 + i * 11,
      pages,
      tags,
      torrents: i % 3 === 0 ? 1 + (i % 2) : 0,
      comments: i === 0 ? 4 : i % 4,
      lazyThumb: i >= 5
    });
  }
  return galleries;
}

// Background-position values the site uses for star sprites.
function ratingStyle(rating) {
  const full = Math.ceil(rating);
  const x = -16 * (5 - full);
  const y = Number.isInteger(rating) ? -1 : -21;
  return `background-position:${x}px ${y}px;opacity:1`;
}

const svgImage = (w, h, label, color = '#8899aa') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-size="${Math.max(12, Math.round(w / 12))}" text-anchor="middle" fill="#fff" font-family="sans-serif">${esc(label)}</text></svg>`;

export function createMockSite(options = {}) {
  const now = options.now ?? Date.now();
  const state = {
    loggedIn: options.loggedIn ?? true,
    displayMode: options.displayMode || 'l', // m p l e t
    galleries: buildGalleries({ count: options.galleryCount ?? 60, now }),
    favorites: new Map(), // path -> favcat
    myTags: (options.myTags || [
      { id: 101, tag: 'female:glasses', watch: false, hide: false },
      { id: 102, tag: 'artist:alpha studio', watch: true, hide: false },
      { id: 103, tag: 'male:hat', watch: false, hide: true },
      { id: 104, tag: 'group:beta circle', watch: false, hide: false }
    ]).map((entry) => ({ ...entry })),
    tagSetEnabled: options.tagSetEnabled ?? true,
    excludedUploaders: [...(options.excludedUploaders || [])],
    failImages: new Set(options.failImages || []), // "gid-page" keys that always 404
    failOnceImages: new Set(options.failOnceImages || []),
    slowImagesMs: options.slowImagesMs || 0,
    rateLimitApi: !!options.rateLimitApi,
    log: [], // every handled request
    writes: [], // non-GET requests to the site
    // Fault injection for router tests. Each rule:
    //   { path: RegExp|string, type?: 'fetch'|'document'|…, method?, times?: n,
    //     status?, headers?, body?, delayMs?, serve?: 'gallery'|'list'|'unsupported'|'redirect', location? }
    // Rules match in order; `times` counts down and the rule is dropped at 0.
    faults: [...(options.faults || [])],
    faultHits: [],
    recordTiming: !!options.recordTiming,
    showpageCalls: []
  };
  for (const path of options.favorites || []) state.favorites.set(path, 9);

  const byGid = new Map(state.galleries.map((g) => [g.gid, g]));
  const galleryPath = (g) => `/g/${g.gid}/${g.token}/`;
  const pageToken = (g, page) => hex(g.gid * 131 + page);

  function frame(origin, { title = 'E-Hentai Galleries', body, bodyAttrs = '', head = '', script = '' }) {
    const exStyle = origin.includes('exhentai') ? ' style="background:#34353b;color:#f1f1f1"' : ' style="background:#e3e0d1;color:#5c0d11"';
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="/z/0381/g.css">
<script src="https://ehgt.org/mock/ehg_native.js"></script>${script}${head}
</head><body${bodyAttrs || exStyle}>
${body}
</body></html>`;
  }

  const nativeScript = (name) => `<script src="/z/0381/${name}"></script>`;

  function nav(origin) {
    const uploads = origin.includes('exhentai') ? 'https://upld.exhentai.org/upld/manage' : 'https://upld.e-hentai.org/manage?ss=d&sd=d';
    const items = state.loggedIn
      ? [['/', 'Front Page'], ['/watched', 'Watched'], ['/popular', 'Popular'], ['/torrents.php', 'Torrents'],
        ['/favorites.php', 'Favorites'], ['/home.php', 'My Home'], [uploads, 'My Uploads'], ['/toplist.php', 'Toplists'],
        ['/bounty.php', 'Bounties'], ['/news.php', 'News'], ['https://forums.e-hentai.org/', 'Forums'],
        ['https://ehwiki.org/', 'Wiki'], ['https://hentaiverse.org/', 'HentaiVerse']]
      : [['/', 'Front Page'], ['/watched', 'Watched'], ['/popular', 'Popular'], ['/torrents.php', 'Torrents'],
        ['/favorites.php', 'Favorites'], ['/toplist.php', 'Toplists'], ['/bounty.php', 'Bounties'], ['/news.php', 'News'],
        ['https://forums.e-hentai.org/', 'Forums'], ['https://ehwiki.org/', 'Wiki'], ['https://hentaiverse.org/', 'HentaiVerse'],
        ['https://forums.e-hentai.org/index.php?act=Login&CODE=00', 'Login']];
    return `<div id="nb" class="nosel">${items.map(([href, label]) =>
      `<div><a href="${esc(href.startsWith('/') ? origin + href : href)}">${esc(label)}</a></div>`).join('')}</div>`;
  }

  // The ad message listener is a 非真站行为 hypothesis: the captured pages
  // did not load or inspect the ad script domain, so keep it behind the same
  // opt-in switch as the other hypothetical residue.
  const adSlot = () => `<ins id="adslot_${Math.floor(Math.random() * 1e6)}" data-width="728" data-height="90" style="display:inline-block;width:728px;height:90px"><iframe title="Advertisement" src="https://ads.e-hentai.org/mock/ad-frame" width="1" height="1" loading="lazy" style="border:0"></iframe></ins><script>if(window.__ehtwHypotheticalResidueEnabled&&!window.__ehtwAdFrameListener){window.__ehtwAdFrameListener=true;window.__ehtwAdFrameLoads=0;window.addEventListener('message',function(event){if(event.data==='ehtw-ad-frame-ready')window.__ehtwAdFrameLoads++})}</script>`;

  function searchBox(origin, query, cats = 0) {
    const catCells = CATEGORIES.map(([ct, label, idx, bit]) =>
      `<td><div id="cat_${bit}" class="cs ${ct}" onclick="toggle_category(${idx})"${cats & bit ? ' data-disabled="1"' : ''}>${esc(label)}</div></td>`);
    return `<div id="searchbox" class="idi"><form action="${origin}/" method="get" style="margin:0px; padding:0px">
<input type="hidden" id="f_cats" name="f_cats" value="${cats}"${cats ? '' : ' disabled="disabled"'}>
<table class="itc"><tr>${catCells.slice(0, 5).join('')}</tr><tr>${catCells.slice(5).join('')}</tr></table>
<div><input type="text" id="f_search" name="f_search" placeholder="Search Keywords" value="${esc(query)}" size="50" maxlength="200"><input type="submit" value="Search"><input type="button" value="Clear" onclick="top.location.href='${origin}/'"></div>
<div id="advdiv" style="display:none"><table class="itss"><tr><td><input type="checkbox" id="f_sh" name="f_sh"><label for="f_sh">Browse Expunged Galleries</label></td></tr><tr><td>Minimum Rating: <select id="f_srdd" name="f_srdd"><option value="2">2 stars</option><option value="3">3 stars</option></select></td></tr></table></div>
<div id="fsdiv" style="display:none"><p>File Search</p><input type="file" name="sfile" size="40"><input type="submit" name="f_sfile" value="File Search"></div>
<div class="searchadv"><a href="#" onclick="toggle_advsearch_pane(this); return false">Show Advanced Options</a> &nbsp; <a href="#" onclick="toggle_filesearch_pane(this); return false">Show File Search</a></div>
</form></div>`;
  }

  function searchnav(prefix, origin, url, prevGid, nextGid, firstHref, lastHref) {
    const base = new URL(url);
    const link = (key, value) => { const u = new URL(base); u.searchParams.delete('next'); u.searchParams.delete('prev'); if (key) u.searchParams.set(key, value); return u.href; };
    const modeLabels = [['m', 'Minimal'], ['p', 'Minimal+'], ['l', 'Compact'], ['e', 'Extended'], ['t', 'Thumbnail']];
    return `<div class="searchnav"><div></div>
<div>${prevGid ? `<a id="${prefix}first" href="${esc(firstHref || link())}">&lt;&lt; First</a>` : `<span id="${prefix}first">&lt;&lt; First</span>`}</div>
<div>${prevGid ? `<a id="${prefix}prev" href="${esc(link('prev', prevGid))}">&lt; Prev</a>` : `<span id="${prefix}prev">&lt; Prev</span>`}</div>
<div id="${prefix}jumpbox" class="jumpbox"><a id="${prefix}jump" href="javascript:void(0)">Jump/Seek</a></div>
<div>${nextGid ? `<a id="${prefix}next" href="${esc(link('next', nextGid))}">Next &gt;</a>` : `<span id="${prefix}next">Next &gt;</span>`}</div>
<div>${nextGid ? `<a id="${prefix}last" href="${esc(lastHref || link('prev', 1))}">Last &gt;&gt;</a>` : `<span id="${prefix}last">Last &gt;&gt;</span>`}</div>
<div><select onchange="document.location='${origin}/?inline_set=dm_'+this.value">${modeLabels.map(([v, l]) =>
      `<option value="${v}"${v === state.displayMode ? ' selected="selected"' : ''}>${l}</option>`).join('')}</select></div></div>`;
  }

  const thumbUrl = (g) => `https://ehgt.org/t/${g.gid % 97}/${g.token}-${g.gid}_250.webp`;
  const catDiv = (g, cls = 'cn') => `<div class="${cls} ${g.category[0]}" onclick="document.location='https://e-hentai.org/${g.category[1].toLowerCase().replace(/\s+/g, '')}'">${esc(g.category[1])}</div>`;
  const gldown = (g, origin) => g.torrents
    ? `<div class="gldown"><a href="${origin}/gallerytorrents.php?gid=${g.gid}&amp;t=${g.token}" onclick="return popUp('${origin}/gallerytorrents.php?gid=${g.gid}&amp;t=${g.token}',610,590)" rel="nofollow"><img src="https://ehgt.org/g/t.png" alt="T" title="Show torrents"></a></div>`
    : `<div class="gldown"><img src="https://ehgt.org/g/td.png" alt="T" title="No torrents available"></div>`;
  // Tags the user colored / watched in My Tags carry inline colors, like the real site.
  const tagStyle = (tag) => state.myTags.some((t) => t.tag === tag && t.watch)
    ? ' style="color:#f1f1f1;border-color:#1357df;background:radial-gradient(#1357df,#3377FF)"' : '';
  const tagsDivs = (g, cls = 'gt', limit = 10) => g.tags.slice(0, limit).map((tag) =>
    `<div class="${cls}" title="${esc(tag)}"${tagStyle(tag)}>${esc(tag.split(':')[1])}</div>`).join('');
  const imgTag = (g, extra = '') => g.lazyThumb
    ? `<img style="height:283px;width:200px${extra}" alt="${esc(g.title)}" title="${esc(g.title)}" data-src="${thumbUrl(g)}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">`
    : `<img style="height:283px;width:200px${extra}" alt="${esc(g.title)}" title="${esc(g.title)}" src="${thumbUrl(g)}">`;

  function rowCompact(g, origin) {
    return `<tr><td class="gl1c glcat">${catDiv(g)}</td>
<td class="gl2c"><div class="glcut" id="ic${g.gid}"></div><div class="glthumb" id="it${g.gid}" style="visibility:hidden"><div>${imgTag(g)}</div><div><div>${catDiv(g)}<div onclick="popUp('${origin}/gallerypopups.php?gid=${g.gid}&amp;t=${g.token}&amp;act=addfav',675,415)" id="postedpop_${g.gid}">${fmtPosted(g.posted)}</div></div><div><div class="ir" style="${ratingStyle(g.rating)}"></div><div>${g.pages} pages</div></div></div></div>
<div><div onclick="popUp('${origin}/gallerypopups.php?gid=${g.gid}&amp;t=${g.token}&amp;act=addfav',675,415)" id="posted_${g.gid}">${fmtPosted(g.posted)}</div><div class="ir" style="${ratingStyle(g.rating)}"></div>${gldown(g, origin)}</div></td>
<td class="gl3c glname" onmouseover="show_image_pane(${g.gid})" onmouseout="hide_image_pane(${g.gid})"><a href="${origin}${galleryPath(g)}"><div class="glink">${esc(g.title)}</div><div>${tagsDivs(g)}</div></a></td>
<td class="gl4c glhide"><div><a href="${origin}/uploader/${encodeURIComponent(g.uploader).replace(/%20/g, '+')}">${esc(g.uploader)}</a></div><div>${g.pages} pages</div></td></tr>`;
  }

  function rowMinimal(g, origin, plus) {
    return `<tr><td class="gl1m glcat">${catDiv(g)}</td>
<td class="gl2m"><div class="glcut" id="ic${g.gid}"></div><div class="glthumb" id="it${g.gid}" style="visibility:hidden"><div>${imgTag(g)}</div></div><div onclick="popUp('${origin}/gallerypopups.php?gid=${g.gid}&amp;t=${g.token}&amp;act=addfav',675,415)" id="posted_${g.gid}">${fmtPosted(g.posted)}</div></td>
<td class="gl3m glname" onmouseover="show_image_pane(${g.gid})" onmouseout="hide_image_pane(${g.gid})"><a href="${origin}${galleryPath(g)}"><div class="glink">${esc(g.title)}</div>${plus ? `<div>${tagsDivs(g)}</div>` : ''}</a></td>
<td class="gl4m"><div class="ir" style="${ratingStyle(g.rating)}"></div>${gldown(g, origin)}</td>
<td class="gl5m glhide"><div><a href="${origin}/uploader/${encodeURIComponent(g.uploader).replace(/%20/g, '+')}">${esc(g.uploader)}</a></div></td></tr>`;
  }

  function rowExtended(g, origin) {
    return `<tr><td class="gl1e" style="width:250px"><div style="height:354px;width:250px"><a href="${origin}${galleryPath(g)}"><img style="height:354px;width:250px;top:0px" alt="${esc(g.title)}" title="${esc(g.title)}" src="${thumbUrl(g)}"></a></div></td>
<td class="gl2e"><div><div class="gl3e">${catDiv(g)}<div onclick="popUp('${origin}/gallerypopups.php?gid=${g.gid}&amp;t=${g.token}&amp;act=addfav',675,415)" id="posted_${g.gid}">${fmtPosted(g.posted)}</div><div class="ir" style="${ratingStyle(g.rating)}"></div><div><a href="${origin}/uploader/${encodeURIComponent(g.uploader).replace(/%20/g, '+')}">${esc(g.uploader)}</a></div><div>${g.pages} pages</div>${gldown(g, origin)}</div>
<a href="${origin}${galleryPath(g)}"><div class="gl4e glname" style="min-height:354px"><div class="glink">${esc(g.title)}</div><div><table><tbody>${g.tags.slice(0, 6).map((tag) => `<tr><td class="tc">${esc(tag.split(':')[0])}:</td><td><div class="gtl" title="${esc(tag)}">${esc(tag.split(':')[1])}</div></td></tr>`).join('')}</tbody></table></div></div></a></div></td></tr>`;
  }

  function cardThumb(g, origin) {
    return `<div class="gl1t"><a href="${origin}${galleryPath(g)}"><div class="gl4t glname glink">${esc(g.title)}</div></a>
<div class="gl3t" style="height:340px;width:250px"><a href="${origin}${galleryPath(g)}"><img style="height:340px;width:240px;top:0px" alt="${esc(g.title)}" title="${esc(g.title)}" src="${thumbUrl(g)}"></a></div>
<div class="gl5t"><div>${catDiv(g, 'cs')}<div onclick="popUp('${origin}/gallerypopups.php?gid=${g.gid}&amp;t=${g.token}&amp;act=addfav',675,415)" id="posted_${g.gid}">${fmtPosted(g.posted)}</div></div><div><div class="ir" style="${ratingStyle(g.rating)}"></div><div>${g.pages} pages</div>${gldown(g, origin)}</div></div>
<div class="gl6t">${tagsDivs(g, 'gt', 3)}</div></div>`;
  }

  function galleryTable(list, origin, mode, { ads = true } = {}) {
    const rows = list.map((g) => mode === 'm' ? rowMinimal(g, origin, false)
      : mode === 'p' ? rowMinimal(g, origin, true)
        : mode === 'e' ? rowExtended(g, origin)
          : mode === 't' ? cardThumb(g, origin)
            : rowCompact(g, origin));
    if (mode === 't') return `<div class="itg gld">${rows.join('\n')}</div>`;
    if (ads && rows.length > 6) rows.splice(5, 0, `<tr><td colspan="4" style="text-align:center">${adSlot()}</td></tr>`);
    const cls = mode === 'm' || mode === 'p' ? 'gltm' : mode === 'e' ? 'glte' : 'gltc';
    const header = mode === 'e' ? '' : mode === 'm' || mode === 'p'
      ? '<tr><th>Category</th><th>Published</th><th>Title</th><th></th><th class="glhide">Uploader</th></tr>'
      : '<tr><th></th><th>Published</th><th>Title</th><th class="glhide">Uploader</th></tr>';
    return `<table class="itg ${cls}">${header}${rows.join('\n')}</table>`;
  }

  function filterGalleries(url) {
    let list = state.galleries;
    const search = url.searchParams.get('f_search') || '';
    const tagMatch = url.pathname.match(/^\/tag\/(.+)$/);
    const uploaderMatch = url.pathname.match(/^\/uploader\/(.+)$/);
    if (tagMatch) {
      const tag = decodeURIComponent(tagMatch[1]).replace(/\+/g, ' ').toLowerCase();
      list = list.filter((g) => g.tags.some((t) => t === tag || t.split(':')[1] === tag));
    }
    if (uploaderMatch) {
      const name = decodeURIComponent(uploaderMatch[1]).replace(/\+/g, ' ').toLowerCase();
      list = list.filter((g) => g.uploader.toLowerCase() === name);
    }
    if (search) {
      const q = search.toLowerCase().replace(/^uploader:/, '');
      const words = q.replace(/[$"]/g, '').split(/\s+/).filter(Boolean);
      if (/^uploader:/i.test(search)) list = list.filter((g) => g.uploader.toLowerCase() === q.replace(/[$"]/g, ''));
      else list = list.filter((g) => words.every((w) => g.title.toLowerCase().includes(w) || g.tags.some((t) => t.includes(w.replace(/^[a-z]+:/, '')))));
    }
    if (url.pathname === '/watched' && !state.loggedIn) return [];
    if (url.pathname === '/watched') {
      const watched = state.myTags.filter((t) => t.watch).map((t) => t.tag);
      list = list.filter((g) => g.tags.some((t) => watched.includes(t)));
    }
    if (url.pathname === '/favorites.php') {
      const favcat = url.searchParams.get('favcat');
      list = list.filter((g) => state.favorites.has(galleryPath(g)) && (!favcat || favcat === 'all' || String(state.favorites.get(galleryPath(g))) === favcat));
    }
    return list;
  }

  function listPage(origin, url, { title, heading, showSearch = true, popular = false } = {}) {
    const list = filterGalleries(url);
    const pageSize = popular ? 50 : 25;
    let start = 0;
    const nextParam = Number(url.searchParams.get('next'));
    const prevParam = Number(url.searchParams.get('prev'));
    if (nextParam) start = Math.max(0, list.findIndex((g) => g.gid < nextParam));
    else if (prevParam === 1) start = Math.max(0, list.length - pageSize);
    else if (prevParam) start = Math.max(0, list.findIndex((g) => g.gid <= prevParam) - pageSize);
    if (start < 0) start = list.length;
    const slice = list.slice(start, start + pageSize);
    const nextGid = start + pageSize < list.length ? slice[slice.length - 1]?.gid : 0;
    const prevGid = start > 0 ? slice[0]?.gid : 0;
    const cats = Number(url.searchParams.get('f_cats')) || 0;
    const search = url.searchParams.get('f_search') || '';
    const empty = !slice.length;
    const results = `<div class="searchtext"><p>Found ${list.length ? `about ${list.length.toLocaleString('en-US')}` : 'no'} results.</p></div>`;
    // ehg_index.c.js itself declares the global lexical `const matchyear`;
    // this fixture keeps its script-reexecution probe under a distinct name.
    const lexicalScript = '<script>const ehtwFixtureListLexical = 1; let ehtwFixtureMatchYear = 2026; var ehtwFixtureVar = (window.ehtwFixtureVar || 0) + 1;</script>';
    const body = `${nav(origin)}
${adSlot()}
<div class="ido"><div id="toppane"><h1 class="ih">${esc(heading || 'E-Hentai Galleries: The Free Hentai Doujinshi, Manga and Image Gallery System')}</h1>
${showSearch ? searchBox(origin, search, cats) : ''}
${showSearch && !popular ? results : ''}
</div>
${showSearch ? '<div id="rangebar"><div id="rangeleft"></div><div id="rangeright"></div></div>' : ''}
${empty && url.pathname === '/watched' ? '<p class="ip">You do not have any watched tags. You can watch tags from My Tags.</p><p>No hits found</p>'
    : empty ? '<p>No hits found</p>'
      : `${popular ? '' : searchnav('u', origin, url.href, prevGid, nextGid)}
<div>${galleryTable(slice, origin, state.displayMode)}</div>
${popular ? '' : searchnav('d', origin, url.href, prevGid, nextGid)}`}
</div>
${lexicalScript}
<div class="dp"><a href="https://e-hentai.org/tos.php">Terms of Service</a> <a href="https://e-hentai.org/dmca">Takedown</a></div>`;
    const globals = `<script>function popUp(URL,w,h){window.__nativeCalls.push({name:'popUp',detail:String(URL)});window.open(URL,'popUp','width='+w+',height='+h+',scrollbars=yes,resizable=yes');return false}var ulhost='${origin}/';var prevurl='';var nexturl='';var maxdate='2026-12-31';var mindate='2000-01-01';var rangeurl='';var rangemin=0;var rangemax=99;var rangespan=1;</script>`;
    return frame(origin, { title: title || 'E-Hentai Galleries', body: body + globals, script: nativeScript('ehg_index.c.js') });
  }

  function galleryPage(origin, url, g) {
    const p = Math.max(0, Number(url.searchParams.get('p')) || 0);
    const perPage = 20;
    const pageCount = Math.ceil(g.pages / perPage);
    const from = p * perPage + 1;
    const to = Math.min(g.pages, from + perPage - 1);
    const thumbs = [];
    for (let n = from; n <= to; n += 1) {
      thumbs.push(`<a href="${origin}/s/${pageToken(g, n)}/${g.gid}-${n}"><div title="Page ${n}: ${String(n).padStart(3, '0')}.jpg" style="width:200px;height:283px;background:transparent url(https://ehgt.org/m/${g.gid}/${n}.webp) -0px 0 no-repeat"></div></a>`);
    }
    const ptt = (cls) => {
      const cells = [];
      cells.push(p > 0 ? `<td onclick="document.location=this.firstChild.href"><a href="${origin}${galleryPath(g)}?p=${p - 1}">&lt;</a></td>` : '<td class="ptdd">&lt;</td>');
      for (let i = 0; i < pageCount; i += 1) {
        cells.push(i === p ? `<td class="ptds"><a href="${origin}${galleryPath(g)}${i ? `?p=${i}` : ''}">${i + 1}</a></td>` : `<td onclick="document.location=this.firstChild.href"><a href="${origin}${galleryPath(g)}${i ? `?p=${i}` : ''}">${i + 1}</a></td>`);
      }
      cells.push(p < pageCount - 1 ? `<td onclick="document.location=this.firstChild.href"><a href="${origin}${galleryPath(g)}?p=${p + 1}">&gt;</a></td>` : '<td class="ptdd">&gt;</td>');
      return `<table class="${cls}"><tr>${cells.join('')}</tr></table>`;
    };
    const grouped = new Map();
    for (const tag of g.tags) {
      const [ns, name] = tag.split(':');
      if (!grouped.has(ns)) grouped.set(ns, []);
      grouped.get(ns).push(name);
    }
    const taglist = [...grouped].map(([ns, names]) => `<tr><td class="tc">${esc(ns)}:</td><td>${names.map((name) =>
      `<div id="td_${esc(`${ns}:${name}`.replace(/ /g, '_'))}" class="gt" style="opacity:1.0"><a id="ta_${esc(`${ns}:${name}`.replace(/ /g, '_'))}" href="${origin}/tag/${esc(`${ns}:${name}`.replace(/ /g, '+'))}" class="" onclick="return toggle_tagmenu(1,'${esc(`${ns}:${name}`)}',this)">${esc(name)}</a></div>`).join('')}</td></tr>`).join('');
    const comments = [];
    for (let c = 0; c < g.comments; c += 1) {
      const author = c === 0 ? g.uploader : UPLOADERS[(g.index + c + 1) % UPLOADERS.length];
      // Comments are newer than the gallery but never in the future.
      const posted = new Date(Math.min(now - (g.comments - c) * 7 * 60_000, g.posted.getTime() + (c + 1) * 3_600_000));
      comments.push(`<a name="c${c + 1}"></a><div class="c1"><div class="c2"><div class="c3">Posted on ${fmtComment(posted)} by: &nbsp; <a href="${origin}/uploader/${encodeURIComponent(author)}">${esc(author)}</a>&nbsp; &nbsp; ${c === 0 ? '' : `<a href="${origin}/forums">[PM]</a>`}</div>
${c === 0 ? '<div class="c4 nosel">Uploader Comment</div>' : `<div class="c4 nosel">[<a id="comment_vote_up_${c}" style="" href="#" onclick="vote_comment_up(${c}); return false">Vote+</a>] &nbsp; [<a id="comment_vote_down_${c}" style="" href="#" onclick="vote_comment_down(${c}); return false">Vote-</a>]</div>
<div class="c5 nosel" onmouseover="show_cvotes(${c})" onmouseout="hide_cvotes(${c})">Score <span id="comment_score_${c}" style="opacity:1">+${10 + c}</span></div>`}
<div class="c"></div></div><div class="c6" id="comment_${c}">Comment number ${c + 1} for ${esc(g.title)}<br>second line &lt;not html&gt;</div>${c === 0 ? '' : `<div class="c7" id="cvotes_${c}" style="display:none">Base +3, <span>voter_${c} +${7 + c}</span></div>`}</div>`);
    }
    const favcat = state.favorites.get(galleryPath(g));
    const body = `${nav(origin)}
<div class="gm"><div id="gleft"><div id="gd1"><div style="width:250px; height:354px; background:transparent url(https://ehgt.org/c/${g.gid}/cover.webp) 0 0 no-repeat"></div></div></div>
<div id="gd2"><h1 id="gn">${esc(g.title)}</h1><h1 id="gj">${esc(g.jtitle)}</h1></div>
<div id="gright"><div id="gd5">
<p class="g3"><img src="https://ehgt.org/g/mr.gif"> <a href="${origin}/stats.php?gid=${g.gid}&amp;t=${g.token}" onclick="return popUp('${origin}/stats.php?gid=${g.gid}&amp;t=${g.token}',480,320)">Report Gallery</a></p>
<p class="g2 gsp"><img src="https://ehgt.org/g/mr.gif"> <a href="#" onclick="return popUp('${origin}/archiver.php?gid=${g.gid}&amp;token=${g.token}',480,320)">Archive Download</a></p>
<p class="g2"><img src="https://ehgt.org/g/mr.gif"> <a href="#" onclick="return popUp('${origin}/gallerytorrents.php?gid=${g.gid}&amp;t=${g.token}',610,590)">Torrent Download (${g.torrents})</a></p>
<p class="g2"><img src="https://ehgt.org/g/mr.gif"> <a href="#" onclick="return popUp('${origin}/gallerypopups.php?gid=${g.gid}&amp;t=${g.token}&amp;act=expunge',675,415)">Petition to Expunge</a></p>
<p class="g2"><img src="https://ehgt.org/g/mr.gif"> <a href="#" onclick="return popUp('${origin}/gallerypopups.php?gid=${g.gid}&amp;t=${g.token}&amp;act=rename',675,415)">Petition to Rename</a></p>
<p class="g2"><img src="https://ehgt.org/g/mr.gif"> <a href="${origin}/stats.php?gid=${g.gid}&amp;t=${g.token}">Show Gallery Stats</a></p>
</div></div>
<div id="gmid"><div id="gd3"><div id="gdc">${catDiv(g, 'cs')}</div>
<div id="gdn"><a href="${origin}/uploader/${encodeURIComponent(g.uploader).replace(/%20/g, '+')}">${esc(g.uploader)}</a>&nbsp; <a href="${origin}/?f_search=uploader%3A${encodeURIComponent(g.uploader)}"><img class="ygm" src="https://ehgt.org/g/ygm.png" alt="Search Uploader" title="Search Uploader"></a></div>
<div id="gdd"><table><tr><td class="gdt1">Posted:</td><td class="gdt2">${fmtPosted(g.posted)}</td></tr><tr><td class="gdt1">Parent:</td><td class="gdt2">None</td></tr><tr><td class="gdt1">Visible:</td><td class="gdt2">Yes</td></tr><tr><td class="gdt1">Language:</td><td class="gdt2">English &nbsp;</td></tr><tr><td class="gdt1">File Size:</td><td class="gdt2">${(g.pages * 1.3).toFixed(1)} MiB</td></tr><tr><td class="gdt1">Length:</td><td class="gdt2">${g.pages} pages</td></tr><tr><td class="gdt1">Favorited:</td><td class="gdt2" id="favcount">${g.favorites} times</td></tr></table></div>
<div id="gdr" onmouseout="rating_reset()"><table><tr><td id="grt1">Rating:</td><td id="grt2"><div id="rating_image" class="ir irb" style="${ratingStyle(g.rating)}"><img src="https://ehgt.org/g/blank.gif" usemap="#rating" style="width:80px;height:16px"></div></td><td id="grt3"><span id="rating_count">${g.ratingCount}</span></td></tr><tr><td id="rating_label" colspan="3">Average: ${g.rating.toFixed(2)}</td></tr></table>
<map name="rating" id="rating">${Array.from({ length: 10 }, (_, i) => `<area shape="rect" coords="${i * 8},0,${i * 8 + 7},16" href="javascript:rating_set(${i + 1})" onclick="rating_set(${i + 1});return false" onmouseover="rating_show(${i + 1})">`).join('')}</map></div>
<div id="gdf" onclick="return popUp('${origin}/gallerypopups.php?gid=${g.gid}&amp;t=${g.token}&amp;act=addfav',675,415)"><div style="float:left; cursor:pointer" id="fav">${favcat !== undefined ? `<div class="i" style="background-image:url(https://ehgt.org/g/fav.png); background-position:0px -${2 + 19 * favcat}px; margin-left:16px" title="Favorites ${favcat}"></div>` : ''}</div><div style="float:left">&nbsp; <a id="favoritelink" href="#" onclick="return popUp('${origin}/gallerypopups.php?gid=${g.gid}&amp;t=${g.token}&amp;act=addfav',675,415)">${favcat !== undefined ? `Favorites ${favcat}` : '<img src="https://ehgt.org/g/mr.gif"> Add to Favorites'}</a></div><div class="c"></div></div>
</div>
<div id="gd4"><div id="taglist"><table><tbody>${taglist}</tbody></table></div><div id="tagmenu_act" style="display:none"><a href="#">Vote Up</a></div><div id="tagmenu_new"><form><input type="text" id="newtagfield" name="newtags" placeholder="Enter new tags, separated with comma" size="60" maxlength="200"><input type="button" id="newtagbutton" value="Tag"></form></div></div>
</div><div class="c"></div></div>
<div id="asm"></div>
<div class="gtb"><p class="gpc">Showing ${from} - ${to} of ${g.pages} images</p>${ptt('ptt')}</div>
<div id="gdo"><div id="gdo4"><div class="ths nosel">Normal</div><div class="tha nosel">Large</div></div></div>
<div id="gdt" class="gt200">${thumbs.join('')}</div>
<div class="gtb">${ptt('ptb')}</div>
<div id="cdiv" class="gm">${comments.join('\n')}
<div id="chd"><p>There are no more comments.</p></div></div>
<div id="postnewcomment"><a href="#" onclick="display_comment_field(); return false">Post New Comment</a></div>
<div id="formdiv" style="display:none"><form method="post" action="${origin}${galleryPath(g)}#cdiv"><textarea name="commenttext_new" placeholder="Enter your comments here"></textarea><br><input type="submit" value="Post Comment"></form></div>
${adSlot()}
<div class="dp"><a href="https://e-hentai.org/tos.php">Terms of Service</a></div>
<script>var gid = ${g.gid}; var token = "${g.token}"; var apiuid = 12345; var apikey = "fixtureapikey"; var api_url = "${origin}/api.php";</script>`;
    const globals = `<script>function popUp(URL,w,h){window.__nativeCalls.push({name:'popUp',detail:String(URL)});window.open(URL,'popUp','width='+w+',height='+h+',scrollbars=yes,resizable=yes');return false}var pop_fav='${origin}/gallerypopups.php?gid=${g.gid}&t=${g.token}&act=addfav';var pop_ren='${origin}/gallerypopups.php?gid=${g.gid}&t=${g.token}&act=rename';var login_url='${origin}/login';var base_url='${origin}/';var api_url='${origin}/api.php';var gid=${g.gid};var token='${g.token}';var apiuid=12345;var apikey='fixtureapikey';var average_rating=${g.rating};var display_rating=${g.rating};var popbase='${origin}/gallerypopups.php';</script>`;
    return frame(origin, { title: `${g.title} - E-Hentai Galleries`, body: body + globals, script: nativeScript('ehg_gallery.c.js') });
  }

  function readerPage(origin, url, g, page) {
    const prev = Math.max(1, page - 1);
    const next = Math.min(g.pages, page + 1);
    const href = (n) => `${origin}/s/${pageToken(g, n)}/${g.gid}-${n}`;
    const sn = `<div class="sn"><a onclick="return load_image(1, '${pageToken(g, 1)}')" href="${href(1)}"><img src="https://ehgt.org/g/f.png"></a><a id="prev" onclick="return load_image(${prev}, '${pageToken(g, prev)}')" href="${href(prev)}"><img src="https://ehgt.org/g/p.png"></a><div><span>${page}</span> / <span>${g.pages}</span></div><a id="next" onclick="return load_image(${next}, '${pageToken(g, next)}')" href="${href(next)}"><img src="https://ehgt.org/g/n.png"></a><a onclick="return load_image(${g.pages}, '${pageToken(g, g.pages)}')" href="${href(g.pages)}"><img src="https://ehgt.org/g/l.png"></a></div>`;
    const w = 1280;
    const h = page === 1 ? 777 : page === 2 ? 742 : 760 + (page % 3) * 17;
    const body = `<div id="i1" class="sni" style="width:${w + 20}px"><h1>${esc(g.title)}</h1>
<div id="i2">${sn}<div>${String(page).padStart(3, '0')}.jpg :: ${w} x ${h} :: 410.2 KiB</div></div>
<div id="i3"><a onclick="return load_image(${next}, '${pageToken(g, next)}')" href="${href(next)}"><img id="img" src="https://mock1.hath.network/h/${g.gid}-${page}/keystamp=1;fileindex=${page}/${String(page).padStart(3, '0')}.jpg" style="height:${h}px;width:${w}px;max-width:${w}px;max-height:${h}px" onerror="this.onerror=null; nl('${g.gid}-${page}')"></a></div>
<div id="i4"><div>${String(page).padStart(3, '0')}.jpg :: ${w} x ${h} :: 410.2 KiB</div>${sn}</div>
<div id="i5"><div class="sb"><a href="${origin}${galleryPath(g)}?p=${Math.floor((page - 1) / 20)}"><img src="https://ehgt.org/g/b.png" referrerpolicy="no-referrer"></a></div></div>
<div id="i6" class="if"><a href="${origin}/?f_shash=x&amp;fs_from=sample">Show all galleries with this file</a></div>
<div id="i7" class="if"><a href="${origin}/fullimg/${g.gid}/${page}/x/${String(page).padStart(3, '0')}.jpg">Download original</a></div>
</div>
<script>function popUp(URL,w,h){window.__nativeCalls.push({name:'popUp',detail:String(URL)});window.open(URL,'popUp','width='+w+',height='+h+',scrollbars=yes,resizable=yes');return false}var gid=${g.gid};var startpage=${page};var startkey="${pageToken(g, page)}";var showkey="fixtureshowkey";var base_url="${origin}/";var api_url="${origin}/api.php";var prl=5;var si=${page};var xres=${w};var yres=${h};if(window.__ehtwInstallHypotheticalReaderPopstate)window.__ehtwInstallHypotheticalReaderPopstate();</script>`;
    return frame(origin, { title: `${g.title} - E-Hentai Galleries`, body, bodyAttrs: ' style="background:#e3e0d1"', script: nativeScript('ehg_show.c.js') });
  }

  function toplistPage(origin, url) {
    const tl = url.searchParams.get('tl');
    const sections = [['Galleries All-Time', 11], ['Galleries Past Year', 12], ['Galleries Past Month', 13], ['Galleries Yesterday', 15],
      ['Uploader All-Time', 21], ['Uploader Past Year', 22], ['Uploader Past Month', 23], ['Uploader Yesterday', 25]];
    if (tl) {
      const list = state.galleries.slice(0, 25);
      const body = `${nav(origin)}<div class="ido"><h1 class="ih">Toplists</h1>
<div><table class="ptt"><tr><td class="ptds"><a href="${origin}/toplist.php?tl=${esc(tl)}">1</a></td><td><a href="${origin}/toplist.php?tl=${esc(tl)}&amp;p=1">2</a></td></tr></table></div>
<table class="itg gltc"><tr><th></th><th>Published</th><th>Title</th><th class="glhide">Uploader</th></tr>${list.map((g) => rowCompact(g, origin)).join('')}</table></div>`;
      return frame(origin, { title: 'Toplists - E-Hentai Galleries', body });
    }
    const body = `${nav(origin)}<div class="ido"><h1>Toplists</h1><div class="dc"><h2>E-Hentai Toplists</h2>
${sections.map(([label, id], s) => `<div class="tdo"><p><img class="mr" src="https://ehgt.org/g/mr.gif"> <a href="${origin}/toplist.php?tl=${id}">${esc(label)}</a></p><table class="ttl"><tbody>${state.galleries.slice(s, s + 10).map((g, i) =>
      `<tr><td class="pso">${i + 1}.</td><td><div class="tun"><a href="${id < 20 ? origin + galleryPath(g) : `${origin}/uploader/${encodeURIComponent(g.uploader)}`}">${esc(id < 20 ? g.title : g.uploader)}</a></div></td></tr>`).join('')}</tbody></table></div>`).join('\n')}
</div></div><div class="dp"><a href="https://e-hentai.org/tos.php">Terms of Service</a></div>`;
    return frame(origin, { title: 'Toplists - E-Hentai Galleries', body });
  }

  function torrentsPage(origin) {
    const rows = state.galleries.filter((g) => g.torrents).slice(0, 15).map((g, i) => `<tr><td class="itd" style="padding-left:4px">${fmtPosted(g.posted)}</td><td class="itd" style="width:75%"><div style="float:left"><a href="${origin}/torrent/${g.gid}/${hex(g.gid * 7, 40)}.torrent" rel="nofollow">${esc(g.title)} [torrent]</a></div></td><td class="itd"><a href="${origin}${galleryPath(g)}">View Gallery</a></td><td class="itd" style="text-align:right">${(i + 1) * 11}.4 MiB</td><td class="itd" style="text-align:right">${i + 2}</td><td class="itd" style="text-align:right">${i}</td><td class="itd" style="text-align:right">${30 + i}</td><td class="itd"><a href="${origin}/uploader/${encodeURIComponent(g.uploader)}">${esc(g.uploader)}</a></td></tr>`);
    const body = `${nav(origin)}<div class="ido"><h1 class="ih">Torrents</h1>
<form id="torrentform" action="${origin}/torrents.php" method="get"><input type="text" id="focusme" name="search" value="" size="50"><p><a href="${origin}/torrents.php?o=s">All Torrents</a> | <a href="${origin}/torrents.php?o=s&amp;t=1">Only Seeded</a> | <a href="${origin}/torrents.php?m=1">My Torrents</a> | <a href="${origin}/torrents.php?o=d">Newest</a> <span>[Filtered]</span></p><input type="button" value="Search Torrents" onclick="document.getElementById('torrentform').submit()"> <input type="button" value="Clear" onclick="document.location='${origin}/torrents.php'"></form>
<p class="ip">Showing 1-15 of 15 torrents</p>
<table class="ptt"><tr><td class="ptds"><a href="${origin}/torrents.php">1</a></td><td><a href="${origin}/torrents.php?page=1">2</a></td><td><a href="${origin}/torrents.php?page=1">&gt;</a></td></tr></table>
<table class="itg"><tr><th><a href="${origin}/torrents.php?o=a">Added</a></th><th>Torrent Name</th><th>Gallery</th><th>Size</th><th>Seeds</th><th>Peers</th><th>DLs</th><th>Uploader</th></tr>${rows.join('\n')}</table>
<table class="ptb"><tr><td class="ptds"><a href="${origin}/torrents.php">1</a></td><td><a href="${origin}/torrents.php?page=1">2</a></td></tr></table></div>`;
    return frame(origin, { title: 'Torrents - E-Hentai Galleries', body });
  }

  function newsPage(origin) {
    const body = `<div id="newsouter"><div class="baredge"></div><div id="botm"></div><div class="bartop"></div><div id="newsinner">${nav(origin)}
<table id="nt"><tr><td class="nd">${[1, 2, 3].map((n) => `<div class="nwo"><h2><a href="${origin}/news.php?id=${n}">Fixture news item ${n}</a></h2><div class="nwi"><p>Neutral announcement text number ${n}.</p></div></div>`).join('')}</td><td class="ns"><p>Sidebar</p></td></tr></table></div></div>`;
    return frame(origin, { title: 'E-Hentai News', body });
  }

  function loginPage(origin) {
    const body = `<div class="d"><p>This page requires you to log on.</p><form name="ipb_login_form" method="post" action="https://forums.e-hentai.org/index.php?act=Login&amp;CODE=01"><input type="hidden" name="referer" value="${origin}/"><input type="hidden" name="b" value="d"><input type="hidden" name="bt" value="1-1"><table style="margin:auto"><tr><td>User:</td><td><input type="text" name="UserName" size="20" maxlength="32"></td></tr><tr><td>Pass:</td><td><input type="password" name="PassWord" size="20" maxlength="32"></td></tr></table><input type="submit" value="Login!"></form><p><a href="https://forums.e-hentai.org/index.php?act=Reg&amp;CODE=00">Register</a></p></div>`;
    return frame(origin, { title: 'Login', body, bodyAttrs: ' style="background:#e3e0d1;text-align:center"' });
  }

  function genericAccountPage(origin, title, inner) {
    return frame(origin, { title: `${title} - E-Hentai Galleries`, body: `${nav(origin)}<div class="stuffbox"><h1>${esc(title)}</h1>${inner}</div><div class="dp"><a href="https://e-hentai.org/tos.php">Terms of Service</a></div>` });
  }

  function myHomePage(origin, path) {
    const titles = { '/home.php': 'Overview', '/uconfig.php': 'Settings', '/stats.php': 'Stats', '/hentaiathome.php': 'Hentai@Home', '/bitcoin.php': 'Donations', '/hathperks.php': 'Hath Perks', '/exchange.php': 'Exchange', '/logs.php': 'Logs' };
    const sub = `<div id="homenav"><a href="${origin}/home.php">Overview</a> <a href="${origin}/stats.php">Stats</a> <a href="${origin}/uconfig.php">Settings</a> <a href="${origin}/mytags">My Tags</a> <a href="${origin}/hentaiathome.php">Hentai@Home</a> <a href="${origin}/bitcoin.php">Donations</a> <a href="${origin}/hathperks.php">Hath Perks</a> <a href="${origin}/exchange.php">Exchange</a> <a href="${origin}/logs.php">Logs</a></div>`;
    const inner = path === '/uconfig.php'
      ? `${sub}<form method="post" action="${origin}/uconfig.php" id="outer"><div class="optouter"><h2>Image Load Settings</h2><p><input type="radio" name="uh" value="0" id="uh_0" checked><label for="uh_0">Any client</label></p><h2>Gallery Name Display</h2><select name="tl"><option value="0">Default</option><option value="1">Japanese</option></select><h2>Excluded Uploaders</h2><textarea id="xu" name="xu" rows="5" cols="40">${esc(state.excludedUploaders.join('\n'))}</textarea></div><input type="submit" name="apply" value="Apply"></form>`
      : `${sub}<div class="homebox"><h2>${esc(titles[path] || 'Overview')}</h2><table><tr><td>Image limits</td><td><strong>120 / 5000</strong></td></tr><tr><td>Credits</td><td>1,234</td></tr><tr><td>GP</td><td>5,678</td></tr></table><p><input type="button" value="Reset Limit" onclick="return false"></p></div>`;
    return genericAccountPage(origin, titles[path] || 'My Home', inner);
  }

  function myTagsPage(origin) {
    const rows = state.myTags.map((t) => `<div id="usertag_${t.id}" style="height:29px"><div style="float:left; width:300px"><div id="tagpreview_${t.id}" class="gt" title="${esc(t.tag)}">${esc(t.tag)}</div></div><div style="float:left"><input type="checkbox" id="tagwatch_${t.id}" name="tagwatch_${t.id}"${t.watch ? ' checked' : ''}></div><div style="float:left"><input type="checkbox" id="taghide_${t.id}" name="taghide_${t.id}"${t.hide ? ' checked' : ''}></div><div style="float:left"><input type="text" id="tagcolor_${t.id}" name="tagcolor_${t.id}" value="" size="7"></div><div style="float:left"><input type="text" id="tagweight_${t.id}" name="tagweight_${t.id}" value="10" size="3"></div><div style="float:left"><input type="button" id="tagsave_${t.id}" value="Save" onclick="var f=document.getElementById('usertag_form');f.querySelector('[name=usertag_target]').value='${t.id}';f.submit()"></div></div>`);
    const inner = `<form id="tagset_form" method="post" action="${origin}/mytags"><select name="tagset" id="tagset_outer"><option value="1" selected>Default</option></select><input type="checkbox" id="tagset_enable" name="tagset_enable"${state.tagSetEnabled ? ' checked' : ''}><label for="tagset_enable">Enable</label></form>
<form id="usertag_form" method="post" action="${origin}/mytags"><div id="usertags_outer"><div id="usertag_0"><input type="text" id="tagname_new" name="tagname_new" placeholder="Enter tag"><input type="checkbox" id="tagwatch_0" name="tagwatch_new"><input type="checkbox" id="taghide_0" name="taghide_new"><input type="text" id="tagcolor_0" name="tagcolor_new" value=""><input type="text" id="tagweight_0" name="tagweight_new" value="10"><input type="submit" id="tagsave_0" name="usertag_action" value="New"></div>${rows.join('')}</div><input type="hidden" name="usertag_target" value="0"></form>
<script>var apiuid = 12345; var apikey = "fixtureapikey"; var api_url = "${origin}/api.php";</script>`;
    return genericAccountPage(origin, 'My Tags', inner);
  }

  function favoritesPage(origin, url) {
    const html = listPage(origin, url, { title: 'Favorites - E-Hentai Galleries', heading: 'Favorites' });
    const favcats = `<div class="ido"><div class="nosel" style="margin:5px auto 0">${Array.from({ length: 10 }, (_, i) => `<div class="fp" onclick="document.location='${origin}/favorites.php?favcat=${i}'"><div class="i" style="background-position:0px -${2 + 19 * i}px"></div><div>${[...state.favorites.values()].filter((v) => v === i).length}</div><div>Favorites ${i}</div></div>`).join('')}</div></div>`;
    return html.replace('<div class="ido">', `${favcats}<div class="ido">`);
  }

  function bountyPage(origin) {
    const rows = [1, 2, 3].map((n) => `<tr><td>2026-10-0${n}</td><td><a href="${origin}/bounty.php?bid=${n}">Fixture bounty request ${n}</a></td><td>Open</td><td>${n * 1000} C</td><td>${esc(UPLOADERS[n])}</td></tr>`);
    return frame(origin, { title: 'Bounties - E-Hentai Galleries', body: `${nav(origin)}<div class="ido"><h1 class="ih">Bounties</h1><form method="get" action="${origin}/bounty.php"><input type="text" name="s" value=""><input type="submit" value="Search"></form><table class="itg"><tr><th>Posted</th><th>Title</th><th>Status</th><th>Reward</th><th>Poster</th></tr>${rows.join('')}</table></div>` });
  }

  function uploadPage(origin, url) {
    const isBountyPost = /bounty_post/.test(url.pathname);
    const navHtml = nav(origin.replace('upld.', ''));
    const body = isBountyPost
      ? `${navHtml}<div class="stuffbox"><h1>Post Bounty</h1><form method="post"><input type="text" name="title" placeholder="Title"><textarea name="desc"></textarea><input type="submit" value="Post Bounty"></form></div>`
      : `${navHtml}<div class="stuffbox"><h1>My Uploads</h1><table class="s"><tr><th>Gallery</th><th>Posted</th><th>Files</th><th>Public</th></tr>${state.galleries.slice(0, 5).map((g) => `<tr><td><a href="${origin.replace('upld.', '')}${galleryPath(g)}">${esc(g.title)}</a></td><td>${fmtPosted(g.posted)}</td><td>${g.pages}</td><td>Yes</td></tr>`).join('')}</table><p><a href="${origin}/managefolders">Manage Folders</a> <input type="button" value="Create New Gallery" onclick="return false"></p></div>`;
    return frame(origin, { title: 'My Uploads', body });
  }

  function favoritePopup(origin, url, method, form, { contentType = '', referer = '', originHeader = '' } = {}) {
    const gid = Number(url.searchParams.get('gid'));
    const g = byGid.get(gid);
    if (!g) return { status: 404, body: 'Invalid gallery' };
    if (method === 'POST') {
      const favcat = form.get('favcat');
      const expectedApply = state.favorites.has(galleryPath(g)) ? 'Apply Changes' : 'Add to Favorites';
      const validFavcat = /^\d$/.test(String(favcat || '')) ||
        (favcat === 'favdel' && state.favorites.has(galleryPath(g)));
      const expectedReferer = `${origin}/gallerypopups.php?gid=${gid}&t=${g.token}&act=addfav`;
      if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(contentType)) {
        return { status: 403, body: 'Favorites form encoding rejected' };
      }
      if (originHeader !== origin || referer !== expectedReferer || form.get('apply') !== expectedApply || form.get('update') !== '1' || !validFavcat || !form.has('favnote')) {
        return { status: 403, body: 'Native favorites request validation failed' };
      }
      if (favcat === 'favdel') state.favorites.delete(galleryPath(g));
      else state.favorites.set(galleryPath(g), Number(favcat));
      return html(`<html><body><script>window.close()</script>Favorites updated</body></html>`);
    }
    const applyLabel = state.favorites.has(galleryPath(g)) ? 'Apply Changes' : 'Add to Favorites';
    return html(`<!DOCTYPE html><html><body><form id="galpop" method="post" action="${origin}/gallerypopups.php?gid=${gid}&amp;t=${g.token}&amp;act=addfav">${Array.from({ length: 10 }, (_, i) => `<input type="radio" name="favcat" value="${i}" id="fav${i}"${state.favorites.get(galleryPath(g)) === i ? ' checked' : ''}><label for="fav${i}">Favorites ${i}</label>`).join('')}<textarea name="favnote"></textarea><input type="hidden" name="update" value="1"><input type="submit" name="apply" value="${applyLabel}"></form></body></html>`);
  }

  function apiCall(body) {
    if (state.rateLimitApi) return { status: 429, headers: { 'content-type': 'application/json' }, body: '{"error":"rate limited"}' };
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch (_) {}
    if (payload.method === 'showpage') {
      state.showpageCalls.push({ page: payload.page, imgkey: payload.imgkey, keys: Object.keys(payload) });
      const gallery = byGid.get(Number(payload.gid));
      const page = Number(payload.page);
      if (!gallery || !Number.isInteger(page) || page < 1 || page > gallery.pages || payload.imgkey !== pageToken(gallery, page)) return json({ error: 'Invalid page or image key' });
      const w = 1280, h = page === 1 ? 777 : page === 2 ? 742 : 760 + (page % 3) * 17;
      const img = `<a href="${galleryPath(gallery)}"><img id="img" src="https://mock1.hath.network/h/${gallery.gid}-${page}/keystamp=1;fileindex=${page}/${String(page).padStart(3, '0')}.jpg" style="height:${h}px;width:${w}px;max-width:${w}px;max-height:${h}px"></a>`;
      return json({ p: page, k: payload.imgkey, s: `s/${payload.imgkey}/${gallery.gid}-${page}`, n: `<div class="sn">${page} / ${gallery.pages}</div>`, i: `${String(page).padStart(3, '0')}.jpg :: ${w} x ${h}`, i3: img, i5: '', i6: '', si: page, x: w, y: h });
    }
    if (payload.method === 'setusertag') {
      const tag = state.myTags.find((t) => t.id === Number(payload.tagid));
      if (!tag) return json({ error: 'No such tag' });
      tag.watch = !!payload.tagwatch;
      tag.hide = !!payload.taghide;
      return json({ tagid: tag.id, tagwatch: tag.watch ? 1 : 0, taghide: tag.hide ? 1 : 0 });
    }
    if (payload.method === 'gdata') {
      return json({ gmetadata: (payload.gidlist || []).map(([gid]) => { const g = byGid.get(Number(gid)); return g ? { gid: g.gid, token: g.token, title: g.title, filecount: String(g.pages), rating: String(g.rating), uploader: g.uploader, tags: g.tags } : { gid, error: 'not found' }; }) });
    }
    return json({ error: 'unsupported method' });
  }

  function myTagsPost(form) {
    // Mirrors the native editor: a "New" submit adds a row; a row save updates it.
    const newTag = String(form.get('tagname_new') || '').trim();
    const target = Number(form.get('usertag_target') || 0);
    if (newTag && !target) {
      const existing = state.myTags.find((t) => t.tag === newTag.toLowerCase());
      if (existing) existing.watch = form.get('tagwatch_new') === 'on';
      else state.myTags.push({ id: 200 + state.myTags.length, tag: newTag.toLowerCase(), watch: form.get('tagwatch_new') === 'on', hide: form.get('taghide_new') === 'on' });
      return;
    }
    const tag = state.myTags.find((t) => t.id === target);
    if (tag) {
      tag.watch = form.get(`tagwatch_${tag.id}`) === 'on';
      tag.hide = form.get(`taghide_${tag.id}`) === 'on';
    }
  }

  const html = (body, status = 200) => ({ status, headers: { 'content-type': 'text/html; charset=utf-8' }, body });
  const json = (data, status = 200) => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

  function image(url) {
    const m = url.pathname.match(/\/h\/(\d+)-(\d+)\//);
    if (m) {
      const key = `${m[1]}-${m[2]}`;
      if (state.failImages.has(key)) return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'missing' };
      if (state.failOnceImages.has(key)) {
        state.failOnceImages.delete(key);
        return { status: 503, headers: { 'content-type': 'text/plain' }, body: 'busy' };
      }
      const page = Number(m[2]);
      const height = page === 1 ? 777 : page === 2 ? 742 : 760 + (page % 3) * 17;
      return { status: 200, headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' }, body: svgImage(1280, height, `page ${page}`, page % 2 ? '#6a7f99' : '#7f996a'), delayMs: state.slowImagesMs };
    }
    if (/\/(t|m|c)\//.test(url.pathname)) {
      return { status: 200, headers: { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600' }, body: svgImage(250, 354, 'thumb') };
    }
    // Site chrome sprites (blank.gif, mr.gif, t.png …): transparent placeholders.
    return { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>' };
  }

  /**
   * Handles one request. Returns { status, headers, body } or null for requests
   * that must be blocked (anything outside the mocked hosts).
   */
  // A fetch made by the SPA router carries its own (already pushed) URL as the
  // referrer; background fetches of the same page from the timeline do not.
  // Fetch rules only hit router fetches unless `routerOnly: false`.
  function matchFault(url, method, type, referer = '') {
    for (let i = 0; i < state.faults.length; i += 1) {
      const rule = state.faults[i];
      const target = url.pathname + url.search;
      const pathOk = rule.path instanceof RegExp ? rule.path.test(target) : target === rule.path || url.pathname === rule.path;
      if (!pathOk) continue;
      if (rule.type && rule.type !== type) continue;
      if (rule.method && rule.method !== method) continue;
      if (rule.type === 'fetch' && rule.routerOnly !== false && referer && referer !== url.href) continue;
      if (rule.times !== undefined) {
        rule.times -= 1;
        if (rule.times <= 0) state.faults.splice(i, 1);
      }
      state.faultHits.push({ url: url.href, type, rule: rule.name || String(rule.path) });
      return rule;
    }
    return null;
  }

  function serveFault(rule, url, origin, method, body, contentType, type) {
    const delayMs = rule.delayMs || 0;
    if (rule.serve === 'redirect') {
      return { status: rule.status || 302, headers: { location: rule.location || `${origin}/`, 'content-type': 'text/html' }, body: '', delayMs };
    }
    if (rule.serve === 'gallery') {
      // A valid site page of the wrong type (detail markup under any URL).
      const g = state.galleries[0];
      return { ...html(galleryPage(origin, new URL(`${origin}${galleryPath(g)}`), g)), delayMs };
    }
    if (rule.serve === 'list') {
      return { ...html(listPage(origin, new URL(`${origin}/`), {})), delayMs };
    }
    if (rule.serve === 'unsupported') {
      return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<!DOCTYPE html><html><head><title>bare</title></head><body><p>No site chrome.</p></body></html>', delayMs };
    }
    if (rule.status) {
      return { status: rule.status, headers: rule.headers || { 'content-type': 'text/html; charset=utf-8' }, body: rule.body ?? `<html><body>fault ${rule.status}</body></html>`, delayMs };
    }
    // Delay only: serve the real response late.
    const real = handleInner({ url: url.href, method, body, contentType, type });
    return real ? { ...real, delayMs: (real.delayMs || 0) + delayMs } : real;
  }

  function handle(request) {
    const url = new URL(request.url);
    const method = request.method || 'GET';
    const isSite = url.origin === 'https://e-hentai.org' || url.origin === 'https://exhentai.org';
    if (isSite && state.faults.length) {
      const rule = matchFault(url, method, request.type || '', request.referer || '');
      if (rule) {
        state.log.push({ method, url: url.href, fault: rule.name || String(rule.path), ...(state.recordTiming ? { at: Date.now() } : {}) });
        return serveFault(rule, url, url.origin, method, request.body, request.contentType, request.type);
      }
    }
    return handleInner(request);
  }

  function handleInner({ url: rawUrl, method = 'GET', body = '', contentType = '', referer = '', originHeader = '' }) {
    const url = new URL(rawUrl);
    const origin = url.origin;
    state.log.push({ method, url: url.href, ...(state.recordTiming ? { at: Date.now() } : {}) });
    if (method !== 'GET' && method !== 'HEAD') state.writes.push({ method, url: url.href, body: String(body || '').slice(0, 2000), contentType, referer, originHeader });

    if (url.hostname === 'ehgt.org' || url.hostname.endsWith('.hath.network') || url.hostname === 'exhentai.org' && url.pathname.startsWith('/t/')) {
      if (url.pathname === '/mock/ehg_native.js') return { status: 200, headers: { 'content-type': 'application/javascript' }, body: NATIVE_JS };
      if (url.pathname.endsWith('.css')) return { status: 200, headers: { 'content-type': 'text/css' }, body: '' };
      return image(url);
    }

    if (url.hostname === 'ads.e-hentai.org' && url.pathname === '/mock/ad-frame') {
      return html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><script>setTimeout(function(){parent.postMessage('ehtw-ad-frame-ready','*')},50)</script></body></html>`);
    }

    const isSite = origin === 'https://e-hentai.org' || origin === 'https://exhentai.org';
    const isUpload = origin === 'https://upld.e-hentai.org' || origin === 'https://upld.exhentai.org';
    if (isUpload) return state.loggedIn ? html(uploadPage(origin, url)) : html(loginPage(origin));
    if (!isSite) return null;

    if (url.pathname === '/z/0381/g.css') return { status: 200, headers: { 'content-type': 'text/css' }, body: REAL_CSS };
    const realScript = url.pathname.match(/^\/z\/0381\/(ehg_(?:index|gallery|show)\.c\.js)$/);
    if (realScript) return { status: 200, headers: { 'content-type': 'application/javascript' }, body: REAL_SCRIPTS[realScript[1]] };

    const form = parseForm(body, contentType);
    const path = url.pathname;
    const inline = url.searchParams.get('inline_set');
    if (inline && /^dm_[mplet]$/.test(inline)) state.displayMode = inline.slice(3);

    if (path === '/api.php') return method === 'POST' ? apiCall(body) : json({ error: 'GET not allowed' }, 405);
    if (path === '/gallerypopups.php') return favoritePopup(origin, url, method, form, { contentType, referer, originHeader });
    if (path === '/mytags') {
      if (!state.loggedIn) return html(loginPage(origin));
      if (method === 'POST') myTagsPost(form);
      return html(myTagsPage(origin));
    }
    const g = path.match(/^\/g\/(\d+)\/([0-9a-f]+)\/?$/);
    if (g) {
      const gallery = byGid.get(Number(g[1]));
      if (!gallery || gallery.token !== g[2]) return html(frame(origin, { body: `${nav(origin)}<div class="d"><p>Key missing, or incorrect key provided.</p></div>` }), 404);
      return html(galleryPage(origin, url, gallery));
    }
    const s = path.match(/^\/s\/([0-9a-f]+)\/(\d+)-(\d+)\/?$/);
    if (s) {
      const gallery = byGid.get(Number(s[2]));
      const page = Number(s[3]);
      if (!gallery || page < 1 || page > gallery.pages || pageToken(gallery, page) !== s[1]) return html(frame(origin, { body: '<p>Invalid page.</p>' }), 404);
      return html(readerPage(origin, url, gallery, page));
    }
    if (path === '/' || path === '/watched' || /^\/(tag|uploader)\//.test(path)) {
      return html(listPage(origin, url, { title: path === '/' ? 'E-Hentai Galleries' : `${decodeURIComponent(path.split('/').pop())} - E-Hentai Galleries` }));
    }
    if (path === '/popular') return html(listPage(origin, url, { heading: 'Currently Popular Recent Galleries', popular: true }));
    if (path === '/toplist.php') return html(toplistPage(origin, url));
    if (path === '/torrents.php') return html(torrentsPage(origin));
    if (path === '/news.php') return html(newsPage(origin));
    if (path === '/favorites.php') return state.loggedIn ? html(favoritesPage(origin, url)) : html(loginPage(origin));
    if (path === '/bounty.php') return state.loggedIn ? html(bountyPage(origin)) : html(loginPage(origin));
    if (path === '/uconfig.php' && method === 'POST' && state.loggedIn) {
      state.excludedUploaders = String(form.get('xu') || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    }
    if (/^\/(home|uconfig|stats|hentaiathome|bitcoin|hathperks|exchange|logs)\.php$/.test(path)) {
      if (path === '/stats.php' && url.searchParams.get('gid')) return html(genericAccountPage(origin, 'Gallery Stats', '<table><tr><td>Views</td><td>1,000</td></tr></table>'));
      return state.loggedIn ? html(myHomePage(origin, path)) : html(loginPage(origin));
    }
    if (path === '/login') return html(loginPage(origin));
    if (path === '/plain.html') return html('<!DOCTYPE html><html><head><title>plain</title></head><body><p id="plain">No site navigation here.</p></body></html>');
    if (path === '/favicon.ico') return { status: 204, headers: {}, body: '' };
    if (/\.(js|css)$/.test(path)) return { status: 200, headers: { 'content-type': path.endsWith('.js') ? 'application/javascript' : 'text/css' }, body: '' };
    return html(frame(origin, { title: 'Not Found', body: `${nav(origin)}<div class="d"><p>404 fixture page for ${esc(path)}</p></div>` }), 404);
  }

  return { state, handle, galleryPath, pageToken, readerUrl: (origin, g, page) => `${origin}/s/${pageToken(g, page)}/${g.gid}-${page}` };
}

function parseForm(body, contentType) {
  const form = new Map();
  if (!body) return form;
  const text = String(body);
  if (/multipart\/form-data/i.test(contentType)) {
    const boundary = contentType.match(/boundary=([^;]+)/i)?.[1];
    if (boundary) {
      for (const part of text.split(`--${boundary}`)) {
        const name = part.match(/name="([^"]+)"/)?.[1];
        if (!name) continue;
        const value = part.split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/\r?\n$/, '');
        form.set(name, value);
      }
    }
    return form;
  }
  if (/json/i.test(contentType)) return form;
  for (const [k, v] of new URLSearchParams(text)) form.set(k, v);
  return form;
}
