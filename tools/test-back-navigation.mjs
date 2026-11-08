import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');
assert.match(source, /@version\s+1\.17\.277/, 'userscript version includes the latest navigation fix');
const galleryBackStatePosition = source.indexOf('let galleryBackTraversalPending = false;');
assert.ok(galleryBackStatePosition >= 0 && galleryBackStatePosition < source.indexOf('function runMain()'), 'popstate back-traversal state is in the outer scope, not trapped in runMain');
const thumbIndexStart = source.indexOf('function getGalleryThumbPageIndex(');
assert.notEqual(thumbIndexStart, -1, 'gallery thumbnail page index resolver exists');
const thumbIndexBodyStart = source.indexOf('{', thumbIndexStart);
let thumbIndexDepth = 0;
let thumbIndexEnd = -1;
for (let i = thumbIndexBodyStart; i < source.length; i++) {
  if (source[i] === '{') thumbIndexDepth++;
  else if (source[i] === '}' && --thumbIndexDepth === 0) {
    thumbIndexEnd = i + 1;
    break;
  }
}
assert.notEqual(thumbIndexEnd, -1, 'gallery thumbnail page index resolver is complete');
const getGalleryThumbPageIndex = vm.runInNewContext(
  `(${source.slice(thumbIndexStart, thumbIndexEnd)})`,
  { URL, location: { href: 'https://e-hentai.org/g/10/token/' } }
);
assert.equal(getGalleryThumbPageIndex('https://e-hentai.org/g/10/token/?p=3'), 3, 'thumbnail page indices are read from the URL');
assert.equal(getGalleryThumbPageIndex('https://e-hentai.org/g/10/token/'), 0, 'the first gallery page uses index zero');
const start = source.indexOf('function shouldUseHistoryBack(');
assert.notEqual(start, -1, 'same-origin history-back guard exists');
const bodyStart = source.indexOf('{', start);
let depth = 0;
let end = -1;
for (let i = bodyStart; i < source.length; i++) {
  if (source[i] === '{') depth++;
  else if (source[i] === '}' && --depth === 0) {
    end = i + 1;
    break;
  }
}
assert.notEqual(end, -1, 'history-back guard is complete');

const shouldUseHistoryBack = vm.runInNewContext(
  `(${source.slice(start, end)})`,
  { URL }
);
const click = (overrides = {}) => ({
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides
});

assert.equal(
  shouldUseHistoryBack(click(), 'https://e-hentai.org/?page=4', 'https://e-hentai.org', 3),
  true,
  'ordinary clicks return through history to a same-origin source page'
);
assert.equal(
  shouldUseHistoryBack(click(), 'https://outside.example/', 'https://e-hentai.org', 3, true),
  true,
  'an SPA route can return to its recorded same-document history parent even when document.referrer is stale'
);
assert.equal(
  shouldUseHistoryBack(click(), 'https://e-hentai.org/', 'https://e-hentai.org', 1),
  false,
  'a tab without a previous history entry uses the fallback link'
);
assert.equal(
  shouldUseHistoryBack(click(), 'https://example.com/', 'https://e-hentai.org', 3),
  false,
  'cross-origin referrers use the fallback link'
);
for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
  assert.equal(
    shouldUseHistoryBack(click({ [modifier]: true }), 'https://e-hentai.org/', 'https://e-hentai.org', 3),
    false,
    `${modifier} clicks preserve normal link behavior`
  );
}

const getGalleryIdStart = source.indexOf('function getGalleryIdFromUrl(');
const getGalleryIdBodyStart = source.indexOf('{', getGalleryIdStart);
let galleryIdDepth = 0;
let getGalleryIdEnd = -1;
for (let i = getGalleryIdBodyStart; i < source.length; i++) {
  if (source[i] === '{') galleryIdDepth++;
  else if (source[i] === '}' && --galleryIdDepth === 0) {
    getGalleryIdEnd = i + 1;
    break;
  }
}
assert.notEqual(getGalleryIdEnd, -1, 'gallery URL identity helper is complete');
const getGalleryIdFromUrl = vm.runInNewContext(
  `(${source.slice(getGalleryIdStart, getGalleryIdEnd)})`,
  { URL, location: { href: 'https://e-hentai.org/' } }
);
assert.equal(getGalleryIdFromUrl('https://e-hentai.org/g/4298995/token/?p=3'), '4298995', 'thumbnail pages share a gallery identity');
assert.equal(getGalleryIdFromUrl('https://exhentai.org/g/4298995/token/?p=3'), '4298995', 'ExHentai gallery links use the same gallery identity');
assert.equal(getGalleryIdFromUrl('https://e-hentai.org/?f_search=test'), null, 'listing pages are not mistaken for gallery pages');

const resolveStart = source.indexOf('function resolveGalleryReturnHref(');
const resolveBodyStart = source.indexOf('{', resolveStart);
let resolveDepth = 0;
let resolveEnd = -1;
for (let i = resolveBodyStart; i < source.length; i++) {
  if (source[i] === '{') resolveDepth++;
  else if (source[i] === '}' && --resolveDepth === 0) {
    resolveEnd = i + 1;
    break;
  }
}
assert.notEqual(resolveEnd, -1, 'gallery return resolver is complete');
const resolveGalleryReturnHref = vm.runInNewContext(
  `(${source.slice(resolveStart, resolveEnd)})`,
  { URL, getGalleryIdFromUrl }
);
assert.equal(
  resolveGalleryReturnHref(null, 'https://e-hentai.org/g/4298995/token/?p=2', 'https://e-hentai.org', '4298995'),
  '/',
  'a same-gallery thumbnail page is never treated as the return destination'
);
assert.equal(
  resolveGalleryReturnHref(null, 'https://e-hentai.org/?f_search=magazine', 'https://e-hentai.org', '4298995'),
  'https://e-hentai.org/?f_search=magazine',
  'the original listing URL is preserved as the gallery return target'
);
assert.equal(
  resolveGalleryReturnHref('https://e-hentai.org/watched', 'https://e-hentai.org/g/4298995/token/?p=2', 'https://e-hentai.org', '4298995'),
  'https://e-hentai.org/watched',
  'the stored original URL takes precedence over thumbnail pagination referrers'
);
const searchBackStart = source.indexOf('function resolveSearchBackHref(');
const searchBackBodyStart = source.indexOf('{', searchBackStart);
let searchBackDepth = 0;
let searchBackEnd = -1;
for (let i = searchBackBodyStart; i < source.length; i++) {
  if (source[i] === '{') searchBackDepth++;
  else if (source[i] === '}' && --searchBackDepth === 0) {
    searchBackEnd = i + 1;
    break;
  }
}
assert.notEqual(searchBackEnd, -1, 'Search back resolver is complete');
const resolveSearchBackHref = vm.runInNewContext(
  `(${source.slice(searchBackStart, searchBackEnd)})`,
  { URL, getGalleryIdFromUrl, resolveGalleryReturnHref }
);
assert.equal(
  resolveSearchBackHref(
    'https://e-hentai.org/g/4298995/token/?p=2',
    'https://e-hentai.org/?f_search=tag',
    'https://e-hentai.org',
    { getItem: () => 'https://e-hentai.org/watched?page=4' }
  ),
  'https://e-hentai.org/watched?page=4',
  'a Search page uses the source list saved for a gallery referrer instead of returning to that detail'
);
assert.equal(
  resolveSearchBackHref(
    'https://e-hentai.org/g/4298995/token/?p=2',
    'https://e-hentai.org/non-h',
    'https://e-hentai.org',
    { getItem: () => 'https://e-hentai.org/non-h' }
  ),
  '/',
  'a Search page never loops to itself or falls back to the stale detail referrer'
);
const backTargetStart = source.indexOf('const resolveSpaBackTarget = (value, currentHref) => {');
assert.notEqual(backTargetStart, -1, 'stable Search back target capture exists');
const backTargetBodyStart = source.indexOf('{', backTargetStart);
let backTargetDepth = 0;
let backTargetEnd = -1;
for (let i = backTargetBodyStart; i < source.length; i++) {
  if (source[i] === '{') backTargetDepth++;
  else if (source[i] === '}' && --backTargetDepth === 0) {
    backTargetEnd = i + 1;
    break;
  }
}
assert.notEqual(backTargetEnd, -1, 'stable Search back target resolver is complete');
const resolveSpaBackTarget = vm.runInNewContext(
  `(value, currentHref) => {${source.slice(backTargetBodyStart + 1, backTargetEnd - 1)}}`,
  {
    URL,
    location: { origin: 'https://e-hentai.org' },
    getGalleryIdFromUrl,
    window: { sessionStorage: { getItem(key) { return key === 'ehtw-gallery-return-v1:4298995' ? 'https://e-hentai.org/?f_search=source' : null; } } }
  }
);
assert.equal(
  resolveSpaBackTarget('https://e-hentai.org/g/4298995/token/?p=2', 'https://e-hentai.org/?f_search=target'),
  'https://e-hentai.org/?f_search=source',
  'a list page reached from a gallery records its originating search page rather than the gallery referrer'
);
assert.equal(
  resolveSpaBackTarget('https://e-hentai.org/g/4298995/token/?p=2', 'https://e-hentai.org/?f_search=source'),
  '/',
  'a gallery referrer that resolves to the current list falls back safely instead of creating a detail loop'
);
const scrollGateStart = source.indexOf('function shouldRestoreSpaScrollOnPageShow(');
assert.notEqual(scrollGateStart, -1, 'pageshow scroll restoration gate exists');
const scrollGateBodyStart = source.indexOf('{', scrollGateStart);
let scrollGateDepth = 0;
let scrollGateEnd = -1;
for (let i = scrollGateBodyStart; i < source.length; i++) {
  if (source[i] === '{') scrollGateDepth++;
  else if (source[i] === '}' && --scrollGateDepth === 0) {
    scrollGateEnd = i + 1;
    break;
  }
}
assert.notEqual(scrollGateEnd, -1, 'pageshow scroll gate is complete');
const shouldRestoreSpaScrollOnPageShow = vm.runInNewContext(
  `(${source.slice(scrollGateStart, scrollGateEnd)})`,
  { URL }
);
assert.equal(shouldRestoreSpaScrollOnPageShow({ persisted: false }, 'navigate', false), false, 'fresh link navigation does not restore the prior list scroll');
assert.equal(shouldRestoreSpaScrollOnPageShow({ persisted: false }, 'back_forward', false), true, 'browser Back/Forward restores a saved scroll');
assert.equal(shouldRestoreSpaScrollOnPageShow({ persisted: true }, 'navigate', false), true, 'a BFCache return restores a saved scroll');
assert.equal(shouldRestoreSpaScrollOnPageShow({ persisted: false }, 'navigate', true), true, 'an explicit SPA fallback can request scroll restoration');
const sameHref = 'https://e-hentai.org/popular?f_search=cat#old';
assert.equal(shouldRestoreSpaScrollOnPageShow({ persisted: false }, 'navigate', false, 'https://e-hentai.org/popular?f_search=cat#new', sameHref, { ehtwSpa: true }), true, 'same-URL SPA document reload restores saved scroll while ignoring hashes');
assert.equal(shouldRestoreSpaScrollOnPageShow({ persisted: false }, 'navigate', false, 'https://e-hentai.org/popular?f_search=dog', sameHref, { ehtwSpa: true }), false, 'a different referrer URL does not qualify for same-URL reload recovery');
assert.equal(shouldRestoreSpaScrollOnPageShow({ persisted: false }, 'navigate', false, '', sameHref, { ehtwSpa: true }), false, 'manual address-bar navigation has no referrer and does not restore');
assert.equal(shouldRestoreSpaScrollOnPageShow({ persisted: false }, 'navigate', false, sameHref, sameHref, { ehtwSpa: false }), false, 'non-SPA entries do not restore scroll after a fresh navigation');
assert.match(source, /ehtw-gallery-return-v1:/, 'gallery origin is remembered per gallery in the tab session');
assert.match(source, /ehtw-gallery-back-traversal-v1/, 'older sessions can walk backward past same-gallery thumbnail pages');
assert.match(source, /storedGalleryReturnHref &&[\s\S]*?shouldUseHistoryBack\([\s\S]*?event\.preventDefault\(\);\s*window\.history\.back\(\)/, 'a saved search or listing page is restored through browser history instead of reloaded');
assert.doesNotMatch(source, /if \(storedGalleryReturnHref\)\s*\{\s*event\.preventDefault\(\);\s*location\.assign\(back\.href\)/, 'the stored source URL is not directly reloaded');
assert.match(source, /event\.preventDefault\(\);\s*window\.history\.back\(\)/, 'same-gallery pagination uses history only as a traversal step');
assert.match(source, /if \(window\.history\.length > 1\)[\s\S]*?window\.history\.back\(\)[\s\S]*?navigatePage\(storedGalleryReturnHref \|\| getBackHref\(\)\)/, 'when history cannot be traversed, same-gallery Back uses the exact saved source page instead of the site home');
assert.match(source, /isThumbnailPaginationPage = new URL\(location\.href\)\.searchParams\.has\('p'\)[\s\S]*?!isThumbnailPaginationPage[\s\S]*?window\.history\.go\(/, 'thumbnail pagination never skips list history by an estimated SPA depth');
assert.match(source, /if \(isThumbnailPaginationPage && storedGalleryReturnHref\) \{[\s\S]*?historyMode: 'replace'[\s\S]*?location\.replace\(storedGalleryReturnHref\)/, 'thumbnail-page Back returns directly to the original list even when SPA navigation is unavailable');
assert.match(source, /const isSameGalleryPagination = !!currentGalleryId[\s\S]*?historyMode: isSameGalleryPagination \? 'replace' : 'push'/, 'same-gallery thumbnail pagination replaces its entry so one browser Back returns to the source list');
assert.match(source, /let galleryBackTraversalPending = false;[\s\S]*?if \(galleryBackTraversalPending\) return true;[\s\S]*?galleryBackTraversalPending = true/, 'the same restored page cannot schedule duplicate history Back calls');
assert.match(source, /addUserScriptListener\(window, 'popstate', \(event\) => \{[\s\S]*?galleryBackTraversalPending = false/, 'each actual history step unlocks the next thumbnail-to-list traversal');
assert.match(source, /previousPageHref &&\s*getGalleryIdFromUrl\(previousPageHref\) === galleryId/, 'an empty referrer cannot be resolved as the current gallery and trigger history.back()');
assert.match(source, /previousGalleryId === destinationGalleryId[\s\S]*?destinationThumbIndex < previousThumbIndex[\s\S]*?setItem\(\s*galleryBackTraversalStorageKey,\s*destinationGalleryId/, 'a Back gesture that lands on a legacy thumbnail entry continues to the original list');
assert.match(source, /const spaPreviousHref = window\.history\.state\?\.ehtwSpaPreviousHref[\s\S]*?const isExplicitReturnEntry = window\.history\.state\?\.ehtwSpaReturnBackTarget === true[\s\S]*?previousPageHref = spaPreviousHref \|\| \(isExplicitReturnEntry \? '' : document\.referrer\)/, 'an explicit list return target suppresses the stale document referrer');
assert.match(source, /ehtwSpaRoute: true[\s\S]*?ehtwSpaPreviousHref: leavingHref/, 'each pushed SPA history item records that it can be popped and its exact parent URL');
assert.match(source, /if \(traversalGalleryId && getGalleryIdFromUrl\(targetUrl\.href\) !== traversalGalleryId\)[\s\S]*?removeItem\('ehtw-gallery-back-traversal-v1'\)/, 'gallery back traversal persists across SPA thumbnail entries and clears when leaving that gallery');
assert.match(source, /anchor\.matches\('\.ehtw-back-link'\)/, 'left-header Back uses history traversal so the saved scroll position is restored');
assert.match(source, /previousPageGalleryId && isOrdinaryLeftClick[\s\S]*?historyMode: 'replace'/, 'Search Back bypasses the stale gallery referrer and navigates to the saved source page');
assert.match(source, /isExplicitReturnEntry && isOrdinaryLeftClick[\s\S]*?historyMode: 'replace'/, 'a list restored after a gallery return follows its stored parent URL instead of browser Back');
assert.match(source, /addUserScriptListener\(document, 'touchstart',[\s\S]*?classList\.add\('ehtw-touch-ui'\)/, 'touch interaction is detected even when Safari reports hover capability');
assert.match(source, /ehtw-touch-ui #ehtw-header \.ehtw-top-tab:is\(:hover, :focus, :active\):not\(\.ehtw-tab-active\)[\s\S]*?color: var\(--ehtw-muted\) !important/, 'touch hover, focus, and active states cannot keep an unselected tab highlighted after Back');

assert.match(source, /history\.scrollRestoration = 'manual'/, 'SPA routes disable browser auto-restoration that can race with DOM replacement');
assert.match(source, /const saveCurrentScroll = \(source = 'scroll', forceHistoryReplace = false\) => \{[\s\S]*?const y = window\.scrollY \|\| 0;[\s\S]*?saveSpaScroll\(location\.href, y\)[\s\S]*?queueScrollHistoryStateWrite\(location\.href, state, y, source, forceHistoryReplace\)/, 'current scroll is saved to sessionStorage immediately and history state through the coalesced writer');
assert.match(source, /addUserScriptListener\(window, 'pageshow',[\s\S]*?state\.ehtwSpa[\s\S]*?restoreSpaScrollPosition\(scrollY(?:,\s*'[^']+')?\)/, 'full-document SPA fallback restores saved list and detail scroll positions after pageshow');
assert.match(source, /shouldRestoreSpaScrollOnPageShow\(event, navigationType, explicitRestore, document\.referrer, location\.href, window\.history\.state\)/, 'pageshow also recovers same-URL SPA document reloads');
assert.match(source, /let cancelActiveSpaScrollRestore = null;[\s\S]*?cancelActiveSpaScrollRestore\?\.\(\);[\s\S]*?cancelActiveSpaScrollRestore = finish/, 'a new restoration replaces and can cancel the prior delayed restore');
assert.match(source, /const historyMode = options\.historyMode \|\| 'push';[\s\S]*?cancelActiveSpaScrollRestore\?\.\(\);[\s\S]*?saveCurrentScrollForSpa\('navigate-before', true\);[\s\S]*?spaNavigationInProgress = true/, 'a new route flushes safe scroll state before activating the navigation lock');
assert.match(source, /else \{\s*window\.scrollTo\?\.\(0, 0\);\s*if \(historyMode === 'push'\) saveSpaScroll\(location\.href, 0\);/, 'ordinary pushed links start at the top and clear stale saved scroll for their destination');
const restoreMatch = source.match(/const restoreSpaScrollPosition = \(value(?:,\s*source = '[^']+')?\) => \{([\s\S]*?)\n    \};/);
assert.ok(restoreMatch, 'post-render scroll restoration helper exists');
const frameQueue = [];
const scrollCalls = [];
const restoreWindow = {
  scrollY: 0,
  innerHeight: 1000,
  __EHTW_SCROLL_SAVE_LOCK__: false,
  requestAnimationFrame(callback) { frameQueue.push(callback); },
  setTimeout(callback) { frameQueue.push(callback); return frameQueue.length; },
  clearTimeout() {},
  addEventListener() {},
  removeEventListener() {},
  scrollTo(x, y) { scrollCalls.push([x, y]); this.scrollY = y; }
};
const restoreSpaScrollPosition = vm.runInNewContext(`(value) => {${restoreMatch[1]}\n}`, {
  Math,
  navLogEnabled: false,
  cancelActiveSpaScrollRestore: null,
  scrollHistoryStateWriteTimer: null,
  protectScrollStateAfterRestore() {},
  addUserScriptListener(target, type, listener, options) { return target.addEventListener(type, listener, options); },
  window: restoreWindow,
  document: { documentElement: { scrollHeight: 3000 }, body: {} }
});
restoreSpaScrollPosition(735);
assert.deepEqual(scrollCalls, [[0, 735]], 'scroll restoration applies the saved position');
assert.equal(restoreWindow.scrollY, 735, 'scroll restoration updates the actual window position');
assert.equal(restoreWindow.__EHTW_SCROLL_SAVE_LOCK__, false, 'scroll saving unlocks after restoration completes');

console.log('PASS detail back button returns to the original page instead of a previous thumbnail page');
