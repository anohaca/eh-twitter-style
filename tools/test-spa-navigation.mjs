import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');
assert.match(source, /@version\s+1\.17\.276/);
assert.match(source, /@match\s+https:\/\/exhentai\.org\/\*/, 'the userscript runs on ExHentai');
assert.match(source, /const EHTW_GALLERY_ORIGINS = new Set\(\[\s*'https:\/\/e-hentai\.org',\s*'https:\/\/exhentai\.org'/, 'both gallery origins use the SPA routing guard');
assert.ok(source.indexOf('function getGalleryIdFromUrl(') < source.indexOf('function runMain()'), 'SPA router can access the gallery ID helper outside the page-local scope');
assert.match(source, /scrollRestoration = 'manual'/, 'SPA routes use manual scroll restoration');
assert.match(source, /setUserScriptInterval\(\(\) => \{[\s\S]*?location\.href === spaRenderedHref[\s\S]*?historyMode: 'pop'/, 'Safari URL changes without popstate are reconciled back into the rendered SPA route');
assert.match(source, /addUserScriptListener\(window, 'popstate', \(event\) => \{[\s\S]*?isGallerySiteOrigin\(location\.origin\) &&\s*typeof window\.__EHTW_SPA_NAVIGATE__ === 'function'[\s\S]*?historyMode: 'pop'/, 'Safari Back events are queued even while the SPA route is temporarily not ready');
assert.match(source, /const destinationScrollY = Number\(options\.scrollY\)[\s\S]*?restoreSpaScrollPosition\(destinationScrollY, 'popstate-or-reconcile'\)/, 'popstate restoration uses the recovered history state after the rebuilt page is in place');

const compatibilityStart = source.indexOf('function isSuspendedSpaPageCompatible(');
assert.notEqual(compatibilityStart, -1, 'suspended-page route/type guard exists');
const compatibilityBodyStart = source.indexOf('{', compatibilityStart);
let compatibilityDepth = 0;
let compatibilityEnd = -1;
for (let i = compatibilityBodyStart; i < source.length; i++) {
  if (source[i] === '{') compatibilityDepth++;
  else if (source[i] === '}' && --compatibilityDepth === 0) {
    compatibilityEnd = i + 1;
    break;
  }
}
assert.notEqual(compatibilityEnd, -1, 'suspended-page guard is complete');
const isSuspendedSpaPageCompatible = vm.runInNewContext(
  `(${source.slice(compatibilityStart, compatibilityEnd)})`,
  {
    isListLikePath(pathname) {
      return !/^\/(g|s|mytags|uconfig)(\/|\.php|$)/i.test(String(pathname || ''));
    }
  }
);
assert.equal(
  isSuspendedSpaPageCompatible(
    { href: 'https://exhentai.org/non-h', rootClass: 'ehtw-enabled ehtw-detail' },
    new URL('https://exhentai.org/non-h')
  ),
  false,
  'detail DOM is never restored under a listing URL'
);
assert.equal(
  isSuspendedSpaPageCompatible(
    {
      href: 'https://exhentai.org/non-h',
      rootClass: 'ehtw-enabled ehtw-generic',
      shadow: { querySelector: (selector) => selector === '#gmid' ? {} : null }
    },
    new URL('https://exhentai.org/non-h')
  ),
  false,
  'gallery metadata in the suspended DOM is detected even if its root class says generic'
);
assert.equal(
  isSuspendedSpaPageCompatible(
    { href: 'https://exhentai.org/non-h', rootClass: 'ehtw-enabled ehtw-list' },
    new URL('https://exhentai.org/non-h')
  ),
  true,
  'a valid suspended list remains eligible for exact restoration'
);
assert.equal(
  isSuspendedSpaPageCompatible(
    { href: 'https://exhentai.org/g/1234567/abcdef/', rootClass: 'ehtw-enabled ehtw-list' },
    new URL('https://exhentai.org/g/1234567/abcdef/')
  ),
  false,
  'list DOM is not restored under a gallery URL'
);

const routeStart = source.indexOf('async function navigateSpa(');
assert.notEqual(routeStart, -1, 'same-document router exists');
const routeEnd = source.indexOf('window.__EHTW_SPA_NAVIGATE__ = navigateSpa;', routeStart);
assert.ok(routeEnd > routeStart, 'router is exposed to navigation handlers');
const route = source.slice(routeStart, routeEnd);

assert.match(route, /targetUrl\.origin !== location\.origin/, 'router stays within the current origin');
assert.match(route, /isListLikePath\(nextPath\) && responseIsGalleryDetail[\s\S]*?SPA response content does not match the target route/, 'gallery HTML cannot be rendered under a listing URL');
assert.match(source, /window\.fetch\(targetHref, requestOptions\)/, 'route content is fetched without leaving the document');
assert.match(source, /async function waitForSpaFetchRetry\(targetHref, retryDelayMs, retryReason\)[\s\S]*?window\.setTimeout\(resolve, retryDelayMs\)[\s\S]*?location\.href !== targetHref[\s\S]*?requestAnimationFrame/, 'Safari retries only after backoff/frame settling while the requested history URL remains active');
assert.match(source, /async function fetchSpaRouteResponse\(targetHref\)[\s\S]*?redirect: 'manual'[\s\S]*?error\?\.name !== 'TypeError'[\s\S]*?waitForSpaFetchRetry\(targetHref, 700, 'typeerror'\)/, 'transient Safari fetch failures get one longer guarded retry before fallback');
assert.match(route, /await fetchSpaRouteResponse\(targetUrl\.href\)/, 'SPA navigation uses the bounded retry helper');
assert.ok(route.indexOf("window.history.pushState(state, '', targetUrl.href)") < route.indexOf('await fetchSpaRouteResponse(targetUrl.href)'), 'forward history is committed synchronously before the first network await for Safari native Back');
assert.match(route, /ehtwSpaRoute: true[\s\S]*?ehtwSpaPreviousHref: leavingHref[\s\S]*?history\.pushState\(state, '', targetUrl\.href\)/, 'forward navigation records its previous URL so the custom back button can return to it');
assert.match(route, /const cleanup = window\.__EHTW_PAGE_CLEANUP__[\s\S]*?cleanup\?\.\(\)/, 'old page listeners and layout are cleaned before rendering the next route');
assert.match(route, /document\.body\.replaceChildren\([\s\S]*?runMain\(\)/, 'new native markup is installed and transformed in the same document');
assert.match(route, /targetHeadScripts = Array\.from\([\s\S]*?for \(const inertScript of targetHeadScripts\)[\s\S]*?await new Promise\(\(resolve\) => \{[\s\S]*?document\.head\.appendChild\(liveScript\)[\s\S]*?const importedBodyScripts/, 'SPA routes load missing same-origin head scripts before replaying body scripts that may depend on them');
assert.match(route, /rememberSpaExternalScriptSources\(\)[\s\S]*?existingScriptSources = new Set\(\s*spaExecutedScriptSources\s*\)[\s\S]*?existingScriptSources\.has\(sourceScriptKey\)/, 'SPA external scripts are deduplicated using a persistent registry even when their DOM nodes are parked');
assert.match(route, /for \(let scriptIndex = 0; scriptIndex < targetBodyScripts\.length[\s\S]*?liveScript\.addEventListener\('load', finish[\s\S]*?await loaded;\s*continue;[\s\S]*?inertTarget\.replaceWith\(liveScript\)/, 'SPA replays body scripts in dependency order so inline code waits for preceding external scripts');
assert.match(route, /collectInlineLexicalNames\(script\.textContent \|\| ''\)[\s\S]*?inlineLexicalAliases\.set\(name, `\$\{name\}__ehtwSpa\$\{spaInlineScriptSequence\}`\)/, 'SPA aliases page-level lexical names that would otherwise be redeclared in the persistent document realm');
assert.match(route, /rewriteInlineLexicalNames\([\s\S]*?inertScript\.textContent \|\| ''[\s\S]*?inlineLexicalAliases/, 'SPA applies lexical aliases consistently to inline code references');

function extractFunction(name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} helper exists`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`${name} helper is complete`);
}
const persistedExternalSources = new Set();
const getTestScriptKey = (value, base) => {
  const url = new URL(value, base);
  return `${url.origin}${url.pathname}`;
};
const rememberExternalScripts = vm.runInNewContext(
  `(${extractFunction('rememberSpaExternalScriptSources')})`,
  {
    Array,
    location: { href: 'https://e-hentai.org/watched' },
    spaExecutedScriptSources: persistedExternalSources,
    getSpaScriptSourceKey: getTestScriptKey,
    document: { querySelectorAll: () => [] }
  }
);
rememberExternalScripts({
  baseURI: 'https://e-hentai.org/watched',
  querySelectorAll: () => [{
    src: 'https://e-hentai.org/z/0381/ehg_index.c.js?v=1',
    getAttribute: () => '/z/0381/ehg_index.c.js?v=1'
  }]
});
const nativeIndexScriptKey = 'https://e-hentai.org/z/0381/ehg_index.c.js';
assert.equal(persistedExternalSources.has(nativeIndexScriptKey), true, 'loaded native external scripts are remembered by normalized URL');
rememberExternalScripts({ baseURI: 'https://e-hentai.org/watched', querySelectorAll: () => [] });
assert.equal(persistedExternalSources.has(nativeIndexScriptKey), true, 'script execution records survive after their DOM nodes leave document.scripts');

const retryDelays = [];
let retryFetchCount = 0;
const fetchSpaRouteResponse = vm.runInNewContext(
  `${extractFunction('waitForSpaFetchRetry')}\n${extractFunction('fetchSpaRouteResponse')}\nfetchSpaRouteResponse`,
  {
    Number,
    Promise,
    navLogEnabled: false,
    location: { href: 'https://e-hentai.org/g/1/abc/' },
    window: {
      async fetch() {
        retryFetchCount += 1;
        if (retryFetchCount === 1) throw new TypeError('Load failed');
        return { ok: true, status: 200 };
      },
      setTimeout(callback, delay) {
        retryDelays.push(delay);
        callback();
        return retryDelays.length;
      },
      requestAnimationFrame(callback) { callback(); }
    },
    get retryFetchCount() { return retryFetchCount; }
  }
);
const retriedResponse = await fetchSpaRouteResponse('https://e-hentai.org/g/1/abc/');
assert.equal(retryFetchCount, 2, 'a transient fetch TypeError gets exactly one retry');
assert.equal(retriedResponse.status, 200, 'the successful retry response is used');
assert.deepEqual(retryDelays, [700], 'the retry waits for a longer gesture-settling backoff before the second request');

const lexicalHelpers = vm.runInNewContext(
  `${extractFunction('collectInlineLexicalNames')}\n${extractFunction('rewriteInlineLexicalNames')}\n({ collectInlineLexicalNames, rewriteInlineLexicalNames })`,
  { Set }
);
assert.deepEqual(
  Array.from(lexicalHelpers.collectInlineLexicalNames(`const matchyear = 2024;\nfor (let i = 0; i < 2; i++) {}\nfunction nested() { const localName = 1; }`)),
  ['matchyear'],
  'only page-level lexical declarations are tracked, not loop or function locals'
);
const rewrittenInline = lexicalHelpers.rewriteInlineLexicalNames(
  `const matchyear = 2025; console.log(matchyear, window.matchyear, 'matchyear'); // matchyear`,
  new Map([['matchyear', 'matchyear__ehtwSpa1']])
);
assert.equal(
  rewrittenInline,
  `const matchyear__ehtwSpa1 = 2025; console.log(matchyear__ehtwSpa1, window.matchyear, 'matchyear'); // matchyear`,
  'lexical aliases update code identifiers while preserving property names, strings, and comments'
);
const getSpaScriptSourceKey = vm.runInNewContext(
  `(${extractFunction('getSpaScriptSourceKey')})`,
  { URL, location: { href: 'https://e-hentai.org/watched' } }
);
assert.equal(
  getSpaScriptSourceKey('/z/0381/ehg_gallery.c.js?v=2#source'),
  'https://e-hentai.org/z/0381/ehg_gallery.c.js',
  'script deduplication ignores cache-busting query strings and fragments'
);
assert.match(route, /const preserveTouchUi = hasTouchInput \|\| root\.classList\.contains\('ehtw-touch-ui'\)[\s\S]*?if \(preserveTouchUi\) root\.classList\.add\('ehtw-touch-ui'\)/, 'touch state survives SPA history replacement so Safari can clear sticky touch hover after back');
assert.match(route, /historyMode === 'pop'[\s\S]*?options\.scrollY/, 'back/forward restores the saved scroll position');
assert.match(route, /historyMode === 'pop'[\s\S]*?window\.__EHTW_CONTINUE_GALLERY_BACK_TRAVERSAL__\?\.\(\)/, 'SPA popstate invokes the page-local multi-entry gallery Back traversal safely');
assert.match(route, /form\[name=\"ipb_login_form\"\]/, 'login page routes are included in the supported page check');
assert.match(route, /catch \(error\)[\s\S]*?location\.assign\(targetUrl\.href\)/, 'failed SPA fetches fall back to normal navigation');

const clickHandler = source.slice(source.lastIndexOf("addUserScriptListener(document, 'click'"), source.lastIndexOf("addUserScriptListener(document, 'submit'"));
assert.match(clickHandler, /anchor\.matches\('\.ehtw-back-link'\)/, 'left-header Back buttons bypass the forward SPA click interceptor');
assert.match(clickHandler, /targetUrl\.origin === location\.origin[\s\S]*?event\.preventDefault\(\)[\s\S]*?__EHTW_SPA_NAVIGATE__/, 'same-origin anchor clicks are intercepted');
assert.match(clickHandler, /const isSameGalleryPagination = !!currentGalleryId[\s\S]*?historyMode: isSameGalleryPagination \? 'replace' : 'push'/, 'gallery page changes keep a single history entry for Safari edge-swipe Back');
assert.match(clickHandler, /isGallerySiteOrigin\(location\.origin\)[\s\S]*?targetUrl\.origin === location\.origin/, 'same-origin SPA clicks are enabled on both gallery sites');
assert.match(clickHandler, /!isGallerySiteOrigin\(targetUrl\.origin\) &&\s*!isUploadSiteOrigin\(targetUrl\.origin\)/, 'both E-Hentai and ExHentai upload hosts receive navigation masking');
assert.doesNotMatch(clickHandler, /isUploadSiteOrigin\(location\.origin\)[\s\S]*?__EHTW_SPA_NAVIGATE__/, 'Upload remains a regular document navigation instead of using SPA');
assert.match(source, /function navigatePage\(value\)[\s\S]*?window\.__EHTW_SPA_NAVIGATE__\(targetUrl\.href[\s\S]*?location\.assign\(targetUrl\.href\)/, 'reader and in-app actions use SPA routing where origin permits');
assert.match(source, /navigatePage\(page\.previousUrl\)[\s\S]*?navigatePage\(page\.nextUrl\)/, 'reader page-link fallbacks stay within the SPA');

let routeCleanupCalled = false;
let routeRunCount = 0;
let galleryBackTraversalChecks = 0;
const restoredScrollPositions = [];
const routeLocation = {
  href: 'https://e-hentai.org/watched',
  origin: 'https://e-hentai.org',
  pathname: '/watched',
  search: '',
  navigationMethods: [],
  assign(href) { this.navigationMethods.push('assign'); this.href = href; },
  replace(href) { this.navigationMethods.push('replace'); this.href = href; }
};
const rootClasses = new Set(['ehtw-navigation-pending']);
const root = {
  className: '',
  lang: 'en',
  dataset: {},
  classList: {
    add(name) { rootClasses.add(name); },
    remove(name) { rootClasses.delete(name); },
    contains(name) { return rootClasses.has(name); }
  }
};
const targetNativeNode = { nodeType: 1, id: 'target-native-content' };
const head = {
  children: [{ id: 'ehtw-page-boot-style' }],
  querySelectorAll: () => [],
  querySelector: () => null,
  appendChild(node) { this.children.push(node); return node; }
};
const body = {
  attributes: [],
  childNodes: [],
  querySelectorAll: () => [],
  replaceChildren(...children) { this.childNodes = children; },
  setAttribute() {},
  removeAttribute() {}
};
const document = {
  documentElement: root,
  body,
  head,
  scripts: [],
  title: 'Old page',
  getElementById(id) { return head.children.find((node) => node.id === id) || null; },
  querySelector: () => null,
  importNode: (node) => ({ ...node }),
  createElement: () => ({ setAttribute() {}, addEventListener() {} })
};
const nextDocument = {
  body: { attributes: [], childNodes: [targetNativeNode], querySelectorAll: () => [] },
  head: { querySelectorAll: () => [] },
  documentElement: { className: '', lang: 'en' },
  title: 'Next page',
  querySelector(selector) {
    if (selector === '#gmid' && returnGalleryDetailForList) return {};
    return selector === '#nb' ? {} : null;
  }
};
const historyCalls = [];
const savedScrollValues = [];
let routeFetchOptions = null;
let returnGalleryDetailForList = false;
const window = {
  __EHTW_SPA_READY__: true,
  __EHTW_PAGE_CLEANUP__() { routeCleanupCalled = true; },
  __EHTW_SCROLL_SAVE_LOCK__: false,
  scrollY: 812,
  __EHTW_CONTINUE_GALLERY_BACK_TRAVERSAL__() { galleryBackTraversalChecks += 1; },
  history: {
    state: { marker: 7 },
    replaceState(state, _title, href) {
      historyCalls.push(['replace', state, href]);
      this.state = state;
      routeLocation.href = href;
      routeLocation.pathname = new URL(href).pathname;
      routeLocation.search = new URL(href).search;
    },
    pushState(state, _title, href) {
      historyCalls.push(['push', state, href]);
      this.state = state;
      routeLocation.href = href;
      routeLocation.pathname = new URL(href).pathname;
      routeLocation.search = new URL(href).search;
    }
  },
  sessionStorage: { setItem() {}, getItem() { return null; }, removeItem() {} },
  DOMParser: class { parseFromString() { return nextDocument; } },
  fetch: async (_url, options) => {
    routeFetchOptions = options;
    return { ok: true, text: async () => '<html></html>' };
  },
  scrollTo(_x, y) { this.scrollY = y; }
};
const routerContext = vm.createContext({
  hasTouchInput: true,
  navLogEnabled: false,
  spaSuspendCacheEnabled: true,
  spaNavigationInProgress: false,
  cancelActiveSpaScrollRestore: null,
  saveCurrentScrollForSpa() {},
  recoverSpaHistoryState(_href, state) { return state || {}; },
  rememberSpaHistoryState() {},
  queueScrollHistoryStateWrite() {},
  pendingScrollHistoryStateWrite: null,
  flushPendingScrollHistoryStateWrite() {},
  safeReplaceHistoryState(history, state, title, href) { history.replaceState(state, title, href); return true; },
  pendingSpaPop: null,
  spaRenderedHref: routeLocation.href,
  suspendedSpaPages: new Map(),
  spaExecutedScriptSources: new Set(),
  saveSpaScroll(href, y) { savedScrollValues.push([href, y]); },
  getSavedSpaScroll() { return 0; },
  isListLikePath(pathname) { return !/^\/(g|s|mytags|uconfig)(\/|\.php|$)/i.test(pathname); },
  newSpaEntryId() { return 'test-entry'; },
  rememberSpaInlineLexicalBindings() {},
  rememberSpaExternalScriptSources() {},
  readFiniteNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : null; },
  galleryReturnDepthKey(id) { return `return-depth:${id}`; },
  resumeSuspendedSpaPage: async () => false,
  suspendCurrentSpaPage: () => false,
  isGallerySiteOrigin(value) { return value === 'https://e-hentai.org' || value === 'https://exhentai.org'; },
  getGalleryIdFromUrl(value) {
    try { return new URL(value).pathname.match(/^\/g\/(\d+)\//i)?.[1] || null; } catch { return null; }
  },
  window,
  fetchSpaRouteResponse(targetHref) {
    return window.fetch(targetHref, {
      credentials: 'same-origin',
      cache: 'default',
      redirect: 'manual'
    });
  },
  document,
  location: routeLocation,
  restoreSpaScrollPosition(value) { restoredScrollPositions.push(value); },
  evictSuspendedSpaPage() {},
  SPA_STATE_CLASSES: [],
  console,
  URL,
  runMain() { routeRunCount += 1; window.__EHTW_SPA_READY__ = true; }
});
const navigateSpa = vm.runInContext(`${route}\nnavigateSpa`, routerContext);
assert.equal(
  await navigateSpa('https://e-hentai.org/popular', { historyMode: 'push' }),
  true,
  'same-origin SPA route completes without a document navigation'
);
assert.equal(routeCleanupCalled, true, 'the previous route is cleaned before rendering');
assert.equal(routeRunCount, 1, 'the userscript transforms the fetched route in the same document');
assert.equal(routeFetchOptions.cache, 'default', 'SPA route fetches honor the browser HTTP cache');
assert.equal(document.body.childNodes[0].id, 'target-native-content', 'the target page markup is swapped into the existing body');
assert.equal(document.title, 'Next page', 'the SPA route updates the page title');
assert.deepEqual(historyCalls.map(([kind]) => kind), ['push'], 'SPA routes add the destination entry without a mid-navigation replaceState');
assert.equal(window.history.state.ehtwSpaRoute, true, 'the active route is marked as a same-document history entry');
assert.equal(window.history.state.ehtwSpaPreviousHref, 'https://e-hentai.org/watched', 'the current route remembers the exact URL to return to');
assert.equal(rootClasses.has('ehtw-navigation-pending'), true, 'the target boot phase uses the existing transition mask');
assert.equal(rootClasses.has('ehtw-touch-ui'), true, 'touch mode survives SPA route rendering');
assert.equal(routeLocation.href, 'https://e-hentai.org/popular', 'the route updates the URL without replacing the document');
assert.equal(window.scrollY, 0, 'an ordinary forward click opens the new route at the top');
assert.deepEqual(savedScrollValues.at(-1), ['https://e-hentai.org/popular', 0], 'the new route clears any stale saved scroll so only Back restores the source position');

routeLocation.href = 'https://e-hentai.org/?f_search=studio';
routeLocation.pathname = '/';
routeLocation.search = '?f_search=studio';
assert.equal(
  await navigateSpa(routeLocation.href, { historyMode: 'pop', scrollY: 835 }),
  true,
  'a popstate route can rebuild the original listing page'
);
assert.deepEqual(restoredScrollPositions, [835], 'the saved pre-navigation scroll position is passed to the post-render restoration helper');
assert.equal(galleryBackTraversalChecks, 1, 'SPA popstate checks whether another same-gallery history entry must be skipped');

routerContext.resumeSuspendedSpaPage = async () => ({ scrollY: 321 });
routerContext.suspendedSpaPages.set('test-entry', {});
routeLocation.href = 'https://e-hentai.org/g/1234567/abcdef1234/';
routeLocation.pathname = '/g/1234567/abcdef1234/';
assert.equal(
  await navigateSpa('https://e-hentai.org/g/1234567/abcdef1234/', { historyMode: 'pop', scrollY: 321 }),
  true,
  'return navigation can resume the exact suspended list document'
);
assert.equal(galleryBackTraversalChecks, 2, 'resuming a suspended list safely continues gallery history traversal');
assert.equal(routeLocation.href, 'https://e-hentai.org/g/1234567/abcdef1234/', 'resuming a prior page does not fall back to a full document navigation');
assert.deepEqual(restoredScrollPositions, [835, 321], 'resumed source pages restore their saved scroll position');

routerContext.suspendedSpaPages.clear();
window.history.state = { marker: 7 };
returnGalleryDetailForList = true;
const runCountBeforeMismatchedResponse = routeRunCount;
// A real popstate changes the address bar before the router receives the
// event, so keep the mocked location aligned with the requested destination.
routeLocation.href = 'https://e-hentai.org/non-h';
routeLocation.pathname = '/non-h';
routeLocation.search = '';
assert.equal(
  await navigateSpa('https://e-hentai.org/non-h', { historyMode: 'pop', scrollY: 321 }),
  false,
  'a gallery response returned for a listing URL is rejected'
);
assert.equal(routeLocation.href, 'https://e-hentai.org/non-h', 'route mismatch falls back to a document load of the requested list');
assert.equal(routeLocation.navigationMethods.at(-1), 'replace', 'a failed pop fetch replaces the popped entry instead of pushing and truncating Forward');
assert.equal(routeRunCount, runCountBeforeMismatchedResponse, 'mismatched gallery markup is never rendered as the list');

returnGalleryDetailForList = false;
window.__EHTW_SPA_READY__ = true;
routerContext.resumeSuspendedSpaPage = async () => ({
  scrollY: 456,
  historyState: { ehtwSpa: true, ehtwSpaDepth: 0 }
});
routerContext.suspendedSpaPages.set('source-entry', { href: 'https://e-hentai.org/non-h' });
window.history.state = { ehtwEntryId: 'thumbnail-entry', ehtwSpaDepth: 2 };
routeLocation.href = 'https://e-hentai.org/g/1234567/abcdef1234/?p=1';
routeLocation.pathname = '/g/1234567/abcdef1234/';
assert.equal(
  await navigateSpa('https://e-hentai.org/non-h', { historyMode: 'replace', restoreScrollY: 456 }),
  true,
  'thumbnail Back can return directly to the saved list entry'
);
assert.equal(routeLocation.href, 'https://e-hentai.org/non-h', 'thumbnail Back updates the current history entry to the source list');
assert.equal(historyCalls.at(-1)[0], 'replace', 'thumbnail Back replaces the detail entry instead of leaving a stale page in history');
assert.deepEqual(restoredScrollPositions, [835, 321, 456], 'direct thumbnail return restores the saved list position');

console.log('SPA navigation routing checks passed.');
