import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');
assert.ok(/@version\s+1\.17\.276/.test(script), 'userscript version includes ExHentai support');
assert.match(script, /window\.onresize = null;[\s\S]*?window\.update_window_extents = \(\) => \{\};/, 'the custom reader disables the native resize callback that assumes #img remains present');
assert.match(script, /const edgeToEdgeViewport = [\s\S]*?viewport-fit=cover[\s\S]*?readerViewportMeta\.setAttribute\('content', edgeToEdgeViewport\)/, 'reader viewport includes viewport-fit=cover so images can extend behind the status area');
assert.match(script, /syncReaderHistory = \(pageNumber\) => \{[\s\S]*?safeReplaceHistoryState\(window\.history, readerState, '', pageUrl, 'reader-page-url-sync'\)[\s\S]*?spaRenderedHref = pageUrl;/, 'reader URL updates keep the SPA URL observer aligned while passing through the guarded history writer');

const priorityStart = script.indexOf('function getReaderImagePriority(');
const priorityBodyStart = script.indexOf('{', priorityStart);
let priorityDepth = 0;
let priorityEnd = -1;
for (let i = priorityBodyStart; i < script.length; i++) {
  if (script[i] === '{') priorityDepth++;
  else if (script[i] === '}' && --priorityDepth === 0) {
    priorityEnd = i + 1;
    break;
  }
}
assert.notEqual(priorityEnd, -1, 'reader image priority helper is complete');
const getReaderImagePriority = vm.runInNewContext(
  `(${script.slice(priorityStart, priorityEnd)})`,
  { Number }
);
assert.equal(getReaderImagePriority(16, 16, null), 'high', 'the current page receives the highest fetch priority');
assert.equal(getReaderImagePriority(17, 16, null), 'high', 'the nearest next page shares top priority with the current page');
assert.equal(getReaderImagePriority(15, 16, null), 'high', 'the nearest previous page receives equal proximity priority');
assert.equal(getReaderImagePriority(18, 16, null), 'auto', 'farther in-window pages remain below the nearest pages');
assert.equal(getReaderImagePriority(21, 16, null), 'auto', 'the fifth page remains in the preload priority window');
assert.equal(getReaderImagePriority(22, 16, null), 'low', 'pages beyond the forward preload window are low priority');
assert.equal(getReaderImagePriority(40, 16, 40), 'high', 'a directly targeted jump page receives the highest priority');

const groupStart = script.indexOf('function getReaderImagePreloadGroups(');
const groupBodyStart = script.indexOf('{', groupStart);
let groupDepth = 0;
let groupEnd = -1;
for (let i = groupBodyStart; i < script.length; i++) {
  if (script[i] === '{') groupDepth++;
  else if (script[i] === '}' && --groupDepth === 0) {
    groupEnd = i + 1;
    break;
  }
}
assert.notEqual(groupEnd, -1, 'preload-distance group helper is complete');
const getReaderImagePreloadGroups = vm.runInNewContext(
  `(${script.slice(groupStart, groupEnd)})`,
  { Number, Math }
);
assert.deepEqual(
  Array.from(getReaderImagePreloadGroups(9, 4, 3), (group) => Array.from(group)),
  [[4], [5, 3], [6, 2], [7, 1]],
  'the scheduler groups nearest pages before farther pages and starts each matching distance in parallel'
);

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.textContent = '';
    this.dataset = {};
    this.classNames = new Set();
    this.classList = {
      add: (name) => this.classNames.add(name),
      remove: (...names) => names.forEach((name) => this.classNames.delete(name)),
      contains: (name) => this.classNames.has(name),
      toggle: (name, force) => {
        const add = force === undefined ? !this.classNames.has(name) : force;
        add ? this.classNames.add(name) : this.classNames.delete(name);
        return add;
      }
    };
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'data-mode') this.dataset.mode = String(value);
  }

  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  removeEventListener(name, callback) { this.listeners[name] = (this.listeners[name] || []).filter((listener) => listener !== callback); }
  querySelectorAll() { return []; }
  remove() { this.removed = true; }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  getBoundingClientRect() { return { left: 0, width: 1000 }; }

  dispatch(name, values = {}) {
    const event = {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      target: this,
      ...values
    };
    const results = (this.listeners[name] || []).map((callback) => callback(event));
    event.completion = Promise.all(results.filter((result) => result && typeof result.then === 'function'));
    return event;
  }
}

function makePage({ previous = true, next = true, previousSame = false, nextSame = false, imagePresent = true, imageFailed = false, storage = new Map(), refreshedImageUrl = null, readyState = 'complete', pathname = '/s/current/page' } = {}) {
  const image = new FakeElement('img', 'img');
  image.complete = imageFailed;
  image.naturalWidth = imageFailed ? 0 : 1000;
  image.setAttribute('src', 'https://e-hentai.org/image.jpg');
  const controls = new FakeElement('div');
  const html = new FakeElement('html');
  const body = new FakeElement('body');
  const head = new FakeElement('head');
  const elements = { '#img': imagePresent ? image : null, '#i3 img': null };
  const prev = previous ? new FakeElement('a', 'prev') : null;
  const nextLink = next ? new FakeElement('a', 'next') : null;
  const pageMetadata = new FakeElement('div', 'i2');
  pageMetadata.textContent = '1 / 10';
  const currentUrl = `https://e-hentai.org${pathname}`;
  if (prev) prev.href = previousSame ? currentUrl : 'https://e-hentai.org/s/previous/page';
  if (nextLink) nextLink.href = nextSame ? currentUrl : 'https://e-hentai.org/s/next/page';
  elements['#prev'] = prev;
  elements['#next'] = nextLink;
  elements['#i2'] = pageMetadata;
  const documentListeners = new Map();
  const document = {
    documentElement: html,
    body,
    head,
    readyState,
    addEventListener(type, callback) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(callback);
    },
    dispatch(type) {
      (documentListeners.get(type) || []).forEach((callback) => callback());
    },
    getElementById(id) {
      let found = null;
      const visit = (node) => {
        if (found) return;
        if (node.id === id) found = node;
        node.children.forEach(visit);
      };
      [html, head, body].forEach(visit);
      return found;
    },
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_namespace, tag) => new FakeElement(tag),
    querySelector: (selector) => {
      if (selector === 'meta[name="viewport"]') {
        return head.children.find((node) => node.tagName === 'META' && node.getAttribute('name') === 'viewport') || null;
      }
      if (elements[selector]) return elements[selector];
      if (!selector.startsWith('.')) return null;
      const className = selector.slice(1);
      let found = null;
      const visit = (node) => {
        if (found) return;
        if (node.className === className) found = node;
        node.children.forEach(visit);
      };
      visit(body);
      return found;
    },
    querySelectorAll: (selector) => {
      if (selector !== 'button[data-mode]') return [];
      const found = [];
      const visit = (node) => {
        if (node.tagName === 'BUTTON' && node.dataset.mode) found.push(node);
        node.children.forEach(visit);
      };
      visit(body);
      return found;
    }
  };
  body.appendChild = (node) => {
    body.children.push(node);
    node.parentNode = body;
    controls.appendChild(node);
    return node;
  };
  const location = { pathname, hostname: 'e-hentai.org', origin: 'https://e-hentai.org', href: currentUrl, assigned: null, assign(href) { this.assigned = href; } };
  const pageFetches = [];
  const timers = [];
  let nextTimerId = 1;
  const window = {
    setTimeout(callback, delay) {
      const timer = { id: nextTimerId++, callback, delay, cancelled: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(id) {
      const timer = timers.find((item) => item.id === id);
      if (timer) timer.cancelled = true;
    },
    matchMedia() { return { matches: false }; },
    history: { state: null, replaceState() {} },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); }
    }
  };
  if (refreshedImageUrl) {
    const refreshedImage = new FakeElement('img');
    refreshedImage.setAttribute('src', refreshedImageUrl);
    window.__refreshedImage = refreshedImage;
  }
  vm.runInNewContext(script, { window, document, location, console, URL, performance });
  if (refreshedImageUrl) {
    window.fetch = async (url, options) => {
      pageFetches.push({ url, options });
      return { ok: true, text: async () => '' };
    };
    window.DOMParser = class {
      parseFromString() {
        return { querySelector: (selector) => selector === '#img' ? window.__refreshedImage : null };
      }
    };
  }
  return { image, controls, html, document, location, prev, nextLink, storage, pageFetches, timers };
}

assert.match(script, /@run-at\s+document-start/, 'site boot cover is installed at document start');
assert.match(script, /const pageBootClass = isReaderUrl \? 'ehtw-reader-boot' : 'ehtw-page-boot'/, 'all matched pages receive a boot background, with a black reader variant');
assert.match(script, /html\.ehtw-reader-boot body\s*\{\s*background:\s*#000 !important;/, 'reader sets black as the page background before native content paints');
assert.match(script, /html\.ehtw-page-boot body > :not\(#ehtw-shell\),\s*html\.ehtw-reader-boot body > :not\(\.ehtw-reader-root\)\s*\{\s*opacity:\s*0 !important;/, 'only original page content is masked while remaining available to conversion');
assert.match(script, /html\.ehtw-page-boot body > #ehtw-shell,[\s\S]*?opacity:\s*1 !important;/, 'the new site layout stays visible during boot');
assert.match(script, /html\.ehtw-navigation-pending body > :not\(#ehtw-shell\):not\(\.ehtw-reader-root\)\s*\{\s*opacity:\s*0 !important;/, 'same-site navigation masks only the outgoing native page content');
assert.match(script, /html\.ehtw-navigation-pending body > #ehtw-shell,[\s\S]*?opacity:\s*1 !important;/, 'same-site navigation keeps the transformed shell visible');
assert.match(script, /addUserScriptListener\(document, 'click',[\s\S]*?targetUrl\.origin[\s\S]*?markNavigationPending\(\)/, 'the outgoing page is held on its theme background before same-site navigation');
assert.match(script, /addUserScriptListener\(document, 'submit',[\s\S]*?markNavigationPending\(\)[\s\S]*?beforeunload/, 'form and script navigations also mask the old page after the first load');
assert.match(script, /pageshow', \(event\) => \{\s*if \(event\?\.persisted\) releasePageBoot\(\)/, 'pageshow only releases the boot mask when restoring from back-forward cache');
assert.match(script, /first-paint[\s\S]*?first-contentful-paint[\s\S]*?ehtwBootAfterFirstPaint[\s\S]*?firstPaint\.startTime/, 'diagnostics reveal whether userscript execution followed first contentful paint when Safari omits first-paint');
assert.doesNotMatch(script, /html\.ehtw-reader-boot::after/, 'reader background stays behind images instead of using a top overlay');
const firstPaintPage = makePage({ readyState: 'loading' });
assert.equal(firstPaintPage.html.classList.contains('ehtw-reader-boot'), true, 'black page background is active while the document is still loading');
assert.equal(firstPaintPage.document.querySelector('.ehtw-reader-root'), null, 'full reader waits until the page DOM is ready');
assert.match(firstPaintPage.document.getElementById('ehtw-page-boot-style').textContent, /background:\s*#000/);
firstPaintPage.document.dispatch('DOMContentLoaded');
assert.equal(firstPaintPage.document.querySelector('.ehtw-reader-root') !== null, true, 'full reader starts after DOMContentLoaded');
assert.equal(firstPaintPage.html.classList.contains('ehtw-reader-boot'), false, 'temporary boot class is removed after the reader root is installed');
assert.match(firstPaintPage.document.head.children.find((node) => node.tagName === 'STYLE' && /html\.ehtw-reader\s*,/.test(node.textContent))?.textContent || '', /background:\s*#000 !important/, 'the live reader keeps its permanent black background');

const genericBootPage = makePage({ readyState: 'loading', pathname: '/' });
assert.equal(genericBootPage.html.classList.contains('ehtw-page-boot'), true, 'non-reader pages also start with a boot background');
assert.match(genericBootPage.document.getElementById('ehtw-page-boot-style').textContent, /prefers-color-scheme: dark/);
genericBootPage.document.dispatch('DOMContentLoaded');
assert.equal(genericBootPage.html.classList.contains('ehtw-page-boot'), false, 'unmodified native pages release the boot state instead of staying hidden');

const page = makePage();
assert.equal(page.html.classList.contains('ehtw-reader'), true, 'recognized reader page gets reader class');
assert.equal(page.html.classList.contains('ehtw-reader-click'), false, 'vertical scrolling is the default');
assert.equal(page.document.querySelector('.ehtw-reader-page-count')?.textContent, '1 / 10', 'current and total page numbers render');
const readerStyle = page.document.head.children.find((node) => node.tagName === 'STYLE' && /overflow-y:\s*auto/.test(node.textContent));
assert.match(readerStyle.textContent, /overflow-y:\s*auto/, 'reader uses vertical document scrolling');
assert.match(readerStyle.textContent, /ehtw-reader:not\(\.ehtw-reader-click\) body\s*\{\s*overflow:\s*visible/, 'vertical mode keeps body from creating a second scroll container');
assert.match(readerStyle.textContent, /ehtw-reader-page-image\s*\{\s*position:\s*absolute/, 'reader images are removed from the grid sizing algorithm');
assert.match(readerStyle.textContent, /ehtw-reader-retry-button\s*\{\s*position:\s*absolute/, 'retry controls stay centered within failed image frames');
assert.match(script, /const urlDimensions = sourceUrl\.match\(/, 'reader extracts intrinsic dimensions from the image URL');
assert.match(script, /image\.dataset\.ehtwMemorySource/, 'reader preserves frame dimensions after releasing an image from memory');
assert.match(script, /Number\.parseInt\(urlDimensions\?\.\[1\]/, 'reader uses the image URL width when decoding failed');
assert.match(script, /if \(\s*image\.getAttribute\('data-ehtw-load-failed'\) !== 'true' &&[\s\S]*?ehtw-reader-image-loading/, 'deferred images keep their loading spinner while waiting in the preload window');
assert.match(script, /const updateReaderImagePriorities = \(centerPageNumber\)/, 'scrolling updates image request priorities around the visible page');
assert.match(script, /if \(distance === 0\) return 'high';\s*if \(distance <= forwardCount\) return distance === 1 \? 'high' : 'auto';\s*return 'low';/, 'near images receive higher fetch priority on either side of the current page');
assert.match(script, /image === readerImage[\s\S]*?image\.fetchPriority = 'high'/, 'the original current page is marked high priority immediately');
const previousBatchStart = script.indexOf('loadPreviousBatch = () => {');
const previousBatchEnd = script.indexOf('let pageSeekPromise = null;', previousBatchStart);
const previousBatchSource = script.slice(previousBatchStart, previousBatchEnd);
assert.match(previousBatchSource, /const \{ imageNode, frame \} = preparePageImage\(page, i\);[\s\S]*?readerImages\.insertBefore\(frame, insertionPoint\);\s*readerPageImages\.unshift\(imageNode\);/, 'previous pages enter the reader one at a time as soon as their page info arrives');
assert.doesNotMatch(previousBatchSource, /batch\.reverse\(\)/, 'previous page visibility does not wait for the whole batch to finish');
assert.match(previousBatchSource, /const insertionAnchor = !clickPaging && scrollDuringPreviousBatch[\s\S]*?const anchorTop = insertionAnchor\?\.getBoundingClientRect\?\.\(\)\.top;[\s\S]*?const scrollDelta = anchorAfterTop - anchorTop;[\s\S]*?scrollRoot\.scrollTop \+= scrollDelta/, 'progressive previous-page insertion preserves the current visible image screen position');
assert.match(script, /const captureReaderScrollAnchor = \(\) => \{[\s\S]*?const viewportCenter = window\.innerHeight \/ 2[\s\S]*?distance: Math\.abs\(center - viewportCenter\)[\s\S]*?const restoreReaderScrollAnchor = \(anchor\) => \{[\s\S]*?anchorAfterCenter[\s\S]*?scrollRoot\.scrollTop \+= scrollDelta[\s\S]*?const onImageLoad = \(\) => \{\s*const scrollAnchor = captureReaderScrollAnchor\(\)[\s\S]*?restoreReaderScrollAnchor\(scrollAnchor\)/, 'image dimension changes preserve the centered visible page to prevent page-index jumps');
assert.match(script, /scrollFallback = \(\) => \{[\s\S]*?if \(readerInitializing\) return;\s*if \(performance\.now\(\) < suppressReaderScrollUntil\) return;[\s\S]*?if \(!clickPaging\) \{[\s\S]*?updatePageCounter\(visibleInfo\.pageNumber\)/, 'compensating scroll events are ignored before updating the visible page number or starting more loads');
assert.doesNotMatch(previousBatchSource, /scrollImageToViewportCenter\(anchorImage\)/, 'previous-page preloading does not repeatedly recenter the reader');
const initialReaderSource = script.slice(script.indexOf('if (nextPageUrl || previousPageUrl)'));
assert.match(initialReaderSource, /readerInitializing = false;[\s\S]*?if \(nextPageUrl\) loadNextBatch\(\);\s*if \(previousPageUrl\) loadPreviousBatch\(\);/, 'the reader becomes scrollable before background image-page preloading finishes');
assert.doesNotMatch(initialReaderSource, /Promise\.all\(initialBatches\)/, 'initial loading does not block scroll handling on a full preload batch');
assert.match(readerStyle.textContent, /max-width:\s*100vw/, 'image fits the viewport width');
assert.match(page.document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '', /viewport-fit=cover/, 'reader viewport reaches the device safe area');
assert.match(readerStyle.textContent, /@media\s*\(max-width:\s*699px\)[\s\S]*?ehtw-reader-controls\s*\{[^}]*top:\s*calc\(env\(safe-area-inset-top, 0px\) \+ 8px\)[\s\S]*?ehtw-reader-images\s*\{[^}]*padding-top:\s*0/, 'mobile controls sit below the status bar while the first image starts behind it');
assert.match(script, /const isMobileReaderViewport = \(\) => \{[\s\S]*?matchMedia\('\(max-width: 699px\)'\)\.matches[\s\S]*?readerLayoutWidth\(\) <= 699[\s\S]*?if \(!clickPaging && !isMobileReaderViewport\(\)\) \{\s*scrollImageToViewportCenter\(readerImage\);/, 'mobile continuous reading does not center short first pages below the status bar');
assert.match(readerStyle.textContent, /@media\s*\(max-width:\s*699px\)[\s\S]*?ehtw-reader-click \.ehtw-reader-images\s*\{[^}]*justify-content:\s*flex-start/, 'mobile click paging aligns short images at the top safe-area edge');
assert.match(readerStyle.textContent, /@keyframes ehtw-reader-spin/, 'reader defines a loading spinner animation');
assert.doesNotMatch(readerStyle.textContent, /function getReaderImagePreloadGroups/, 'preload scheduling helpers stay outside the injected CSS');
assert.equal(page.image.parentNode.classList.contains('ehtw-reader-image-loading'), true, 'pending image shows a loading state');
assert.match(page.document.querySelector('.ehtw-reader-seek-status')?.textContent || '', /正在加载图片：第 1 页/, 'bottom status shows image loading outside slider seeking');
page.image.dispatch('load');
assert.equal(page.image.parentNode.classList.contains('ehtw-reader-image-loading'), false, 'loaded image hides the loading state');
assert.equal(page.document.querySelector('.ehtw-reader-seek-status')?.textContent, '', 'bottom status hides when there are no active image loads instead of showing loaded status');
assert.match(script, /const loadingPages = \[\];[\s\S]*readerPageImages\.forEach\(\(image\) => \{/, 'bottom status aggregates image loads across the reader pages');
assert.match(script, /READER_IMAGE_LOAD_TIMEOUT_MS = 30000/, 'stalled image requests have a finite timeout');
assert.match(script, /READER_IMAGE_AUTO_RETRY_LIMIT = 2/, 'each failed image receives two bounded automatic retries');
assert.match(script, /const scheduleAutomaticRetry = \(\) => \{[\s\S]*?READER_IMAGE_AUTO_RETRY_LIMIT[\s\S]*?retryImage\(\)/, 'image errors and timeouts schedule automatic retries with refreshed URLs');
assert.doesNotMatch(script, /MOBILE_READER_IMAGE_(?:LOAD_TIMEOUT|CONCURRENCY)/, 'image timeout and concurrency are no longer mobile-specific');
assert.doesNotMatch(script, /mobileImageLoadQueue/, 'image loading does not use a separate mobile-only queue');
assert.match(script, /const releaseReaderImagesOutsideWindow = \(centerIndex\) => \{[\s\S]*?image\.dataset\.ehtwMemoryUnloaded = 'true'[\s\S]*?image\.removeAttribute\('src'\)/, 'decoded images outside the active preload window release their source to reduce memory use');
assert.match(script, /image\.dataset\.ehtwMemoryUnloaded === 'true' \|\|[\s\S]*?const windowComplete = !pageTransitionPending/, 'intentionally released images do not restart the distant preload queue');
assert.doesNotMatch(script, /document\.readyState\s*!==\s*'complete'/, 'image requests do not wait for the whole page load event');
assert.match(script, /const startPageImageSource = \(imageNode, source\) => \{[\s\S]*?imageNode\.src = source;/, 'all devices start image requests directly');
assert.match(script, /imageLoadWatchdogTimer = window\.setTimeout\([\s\S]*?onImageError\(\)/, 'a stalled image becomes retryable instead of loading forever');
assert.match(script, /const startDeferredImageResource = \(image\) => \{[\s\S]*?image\.loading = 'eager';/, 'images entering the preload window switch from lazy to eager loading');
assert.match(script, /const updateReaderImagePriorities = \(centerPageNumber\)/, 'the shared preload window reprioritizes images around the current page');
assert.match(script, /const waitingToStart = windowImages\.filter\(\(image\) =>[\s\S]*?dataset\.ehtwSeekDeferredSource \|\| image\.dataset\.ehtwMemorySource/, 'only images inside the active preload window start requests');
assert.doesNotMatch(script, /waitingToStart = readerPageImages[\s\S]*?!windowImageSet\.has\(image\)/, 'outside-window images are not drained after the active window settles');
assert.match(script, /READER_IMAGE_PREFETCH_CONCURRENCY = 5/, 'reader uses a five-request image prefetch pool');
assert.match(script, /READER_IMAGE_PREFETCH_CONCURRENCY - activeReaderImageQueueLoads\.size[\s\S]*?waitingToStart\.slice\(0, capacity\)/, 'a bounded parallel pool drains only the active window');
assert.match(script, /const prefetchGalleryPageInfoRange = async[\s\S]*?Promise\.all\([\s\S]*?findGalleryPageUrl\(pageNumber\)[\s\S]*?Promise\.all\(pageUrls\.map/, 'page image URLs are resolved in parallel before native image prefetch');
assert.match(script, /galleryPageInfoCache = new Map\(\)[\s\S]*?galleryPageInfoFetchPromises = new Map\(\)[\s\S]*?activeGalleryPageInfoFetches < 5/, 'resolved page metadata is deduplicated and capped at five concurrent requests');
assert.match(script, /const pauseReaderImagesOutsideWindow = \(centerIndex, shouldPause\) => \{[\s\S]*?dataset\.ehtwSeekDeferredSource = source[\s\S]*?image\.removeAttribute\('src'\)/, 'unfinished images outside an incomplete moving window pause and resume when near again');
assert.match(script, /startDeferredImagesAround\(visibleIndex\);/, 'vertical scrolling refreshes the same moving preload window');
assert.match(script, /const imageToKeepOnScroll = !enabled[\s\S]*?startDeferredImagesAround\(activeImageIndex\);\s*scrollImageToViewportCenter\(imageToKeepOnScroll\)/, 'switching from click paging to vertical scrolling keeps the current page and refreshes its preload window');
assert.match(script, /activeImageIndex >= readerPageImages\.length - linkWindowEdge - 1[\s\S]*?loadNextBatch\(\)/, 'click paging refills upcoming page links before the image preload window runs out');
assert.match(script, /visibleIndex >= readerPageImages\.length - linkWindowEdge - 1[\s\S]*?loadNextBatch\(\)/, 'vertical scrolling refills upcoming page links before the image preload window runs out');
assert.match(readerStyle.textContent, /image-frame:not\(\.ehtw-reader-active\)\s*\{[\s\S]*?visibility:\s*hidden[\s\S]*?pointer-events:\s*none/, 'click mode keeps preloaded images fetchable while hiding them visually');
const buttons = page.document.querySelectorAll('button[data-mode]');
assert.equal(buttons.length, 2, 'both reading modes are available');
const preloadInput = page.document.querySelector('.ehtw-reader-preload-count');
assert.equal(preloadInput.value, '5', 'image preload count defaults to five pages in each direction');
preloadInput.value = '7';
preloadInput.dispatch('change');
assert.equal(page.storage.get('ehtw-reader-preload-count-v2'), '7', 'preload count is saved locally when changed');
const reopenedReader = makePage({ storage: page.storage });
assert.equal(reopenedReader.document.querySelector('.ehtw-reader-preload-count')?.value, '7', 'the next reader page restores the saved preload count');
const boundedReader = makePage({ storage: new Map([['ehtw-reader-preload-count-v2', '900']]) });
assert.equal(boundedReader.document.querySelector('.ehtw-reader-preload-count')?.value, '50', 'saved preload counts are clamped to the supported maximum');
const pageLinkPreloadInput = page.document.querySelector('.ehtw-reader-page-link-preload-count');
assert.equal(pageLinkPreloadInput?.value, '10', 'page link preload defaults to ten pages in each direction');
assert.equal(page.document.querySelector('.ehtw-reader-preload-details')?.open, undefined, 'all preload settings start collapsed');
const preloadSummary = page.document.querySelector('.ehtw-reader-preload-details')?.children[0];
assert.match(preloadSummary?.innerHTML || '', /<svg/, 'preload settings use an icon button');
assert.equal(preloadSummary?.getAttribute('aria-label'), '预载设置', 'preload icon has an accessible label');
assert.match(readerStyle.textContent, /preload-details:not\(\[open\]\)[\s\S]*?display:\s*none/, 'collapsed preload controls stay hidden until opened');
assert.match(readerStyle.textContent, /preload-popover\s*\{[\s\S]*?top:\s*calc\(100% \+ 8px\)/, 'preload options open below the top toolbar where they remain visible');
console.log('PASS preload count saves, restores, and stays within its supported range');
const rememberedReaderSettings = new Map();
const configuredReader = makePage({ storage: rememberedReaderSettings });
configuredReader.document.querySelectorAll('button[data-mode]').find((button) => button.dataset.mode === 'click').dispatch('click');
const configuredZoom = configuredReader.document.querySelector('.ehtw-reader-zoom-input');
configuredZoom.value = '165';
configuredZoom.dispatch('change');
const configuredPageLinkPreload = configuredReader.document.querySelector('.ehtw-reader-page-link-preload-count');
configuredPageLinkPreload.value = '35';
configuredPageLinkPreload.dispatch('change');
assert.equal(rememberedReaderSettings.get('ehtw-reader-mode-v1'), 'click', 'reader mode is saved when changed');
assert.equal(rememberedReaderSettings.get('ehtw-reader-zoom-percent-v1'), '165', 'zoom percentage is saved when changed');
assert.equal(rememberedReaderSettings.get('ehtw-reader-page-link-preload-count-v1'), '35', 'page link preload limit is saved when changed');
const reopenedPreferences = makePage({ storage: rememberedReaderSettings });
assert.equal(reopenedPreferences.html.classList.contains('ehtw-reader-click'), true, 'the next reader page restores click mode');
assert.equal(reopenedPreferences.document.querySelector('.ehtw-reader-zoom-input')?.value, '165', 'the next reader page restores the zoom percentage');
assert.equal(reopenedPreferences.document.querySelector('.ehtw-reader-page-link-preload-count')?.value, '35', 'the next reader page restores page link preload limit');
const boundedPageLinkPreload = makePage({ storage: new Map([['ehtw-reader-page-link-preload-count-v1', '800']]) });
assert.equal(boundedPageLinkPreload.document.querySelector('.ehtw-reader-page-link-preload-count')?.value, '50', 'page link preload limit is clamped');
console.log('PASS reading mode, zoom percentage, image preload, and page link preload settings save and restore');

const clickMode = buttons.find((button) => button.dataset.mode === 'click');
const scrollMode = buttons.find((button) => button.dataset.mode === 'scroll');
assert.ok(clickMode, 'click paging control exists');
assert.ok(scrollMode, 'vertical scrolling control exists');
clickMode.dispatch('click');
assert.equal(page.html.classList.contains('ehtw-reader-click'), true, 'click mode can be enabled');
const nextEvent = page.image.dispatch('click', { clientX: 800 });
assert.equal(nextEvent.defaultPrevented, true, 'image click is handled in click mode');
assert.equal(nextEvent.propagationStopped, true, 'site-level image handlers do not override click paging');
await Promise.resolve();
assert.equal(page.location.assigned, page.nextLink.href, 'right half falls back to the original next-page link when no batch loader is available');

page.location.assigned = null;
page.image.dispatch('click', { clientX: 200 });
await Promise.resolve();
assert.equal(page.location.assigned, page.prev.href, 'left half opens original previous-page link');
scrollMode.dispatch('click');
assert.equal(page.html.classList.contains('ehtw-reader-click'), false, 'vertical mode can be restored');
page.location.assigned = null;
const scrollEvent = page.image.dispatch('click', { clientX: 800 });
assert.equal(scrollEvent.defaultPrevented, true, "vertical mode suppresses the site's image-link navigation");
assert.equal(scrollEvent.propagationStopped, true, 'site-level image handlers do not override vertical mode');
assert.equal(page.location.assigned, null, 'vertical mode does not navigate');
const dragEvent = page.image.dispatch('dragstart');
assert.equal(dragEvent.defaultPrevented, true, 'images cancel native drag start');
assert.equal(dragEvent.propagationStopped, true, 'image drag does not bubble to site handlers');

const missingNavigation = makePage({ previous: false, next: false });
const missingMode = missingNavigation.document.querySelectorAll('button[data-mode]').find((button) => button.dataset.mode === 'click');
missingMode.dispatch('click');
assert.doesNotThrow(() => missingNavigation.image.dispatch('click', { clientX: 900 }), 'missing links are safe');
assert.equal(missingNavigation.location.assigned, null, 'missing links do not navigate');

const missingPrevious = makePage({ previous: false, next: true });
missingPrevious.document.querySelectorAll('button[data-mode]').find((button) => button.dataset.mode === 'click').dispatch('click');
missingPrevious.image.dispatch('click', { clientX: 100 });
assert.equal(missingPrevious.location.assigned, null, 'missing previous link is safe');
missingPrevious.image.dispatch('click', { clientX: 900 });
await Promise.resolve();
assert.equal(missingPrevious.location.assigned, missingPrevious.nextLink.href, 'unloaded next page falls back to the original next link');

const missingNext = makePage({ previous: true, next: false });
missingNext.document.querySelectorAll('button[data-mode]').find((button) => button.dataset.mode === 'click').dispatch('click');
missingNext.image.dispatch('click', { clientX: 900 });
assert.equal(missingNext.location.assigned, null, 'missing next link is safe');
missingNext.image.dispatch('click', { clientX: 100 });
await Promise.resolve();
assert.equal(missingNext.location.assigned, missingNext.prev.href, 'previous link still works without next link');

const firstPage = makePage({ previousSame: true });
firstPage.document.querySelectorAll('button[data-mode]').find((button) => button.dataset.mode === 'click').dispatch('click');
firstPage.image.dispatch('click', { clientX: 100 });
assert.equal(firstPage.location.assigned, null, 'first-page self-link does not reload the page');
firstPage.image.dispatch('click', { clientX: 900 });
await Promise.resolve();
assert.equal(firstPage.location.assigned, firstPage.nextLink.href, 'first image falls back to the original next page without the preload API');

const unsupportedPage = makePage({ imagePresent: false });
assert.equal(unsupportedPage.html.classList.contains('ehtw-reader'), false, 'unsupported reader page is untouched');
assert.equal(unsupportedPage.controls.children.length, 0, 'unsupported reader page gets no controls');

const brokenOnArrival = makePage({
  imageFailed: true,
  refreshedImageUrl: 'https://images.e-hentai.org/fresh-image.jpg'
});
assert.equal(brokenOnArrival.image.getAttribute('data-ehtw-load-failed'), null, 'an image that failed before script startup starts an automatic retry');
assert.equal(brokenOnArrival.image.parentNode.classList.contains('ehtw-reader-image-loading'), true, 'startup failures show the loading state during automatic retry');
assert.ok(brokenOnArrival.timers.some((timer) => timer.delay === 800 && !timer.cancelled), 'startup failures schedule the first automatic retry');
assert.equal(brokenOnArrival.image.alt, '', 'failed image does not display a text hint');
const initialRetryButton = brokenOnArrival.image.parentNode.children.find((child) => child.className === 'ehtw-reader-retry-button');
assert.ok(initialRetryButton, 'failed image gets a centered retry icon button');
assert.equal(initialRetryButton.textContent, '', 'retry control contains no visible text');
assert.equal(initialRetryButton.getAttribute('aria-label'), '重新加载图片', 'retry icon has an accessible label');
await initialRetryButton.dispatch('click').completion;
assert.equal(brokenOnArrival.location.assigned, null, 'retry does not navigate or refresh the reader page');
assert.equal(brokenOnArrival.timers.some((timer) => timer.delay === 800 && !timer.cancelled), false, 'manual retry cancels a pending automatic retry');
assert.equal(brokenOnArrival.image.src, 'https://images.e-hentai.org/fresh-image.jpg', 'retry uses the refreshed image URL when the original URL expired');
assert.equal(brokenOnArrival.pageFetches[0]?.url, brokenOnArrival.location.href, 'retry quietly refetches only the source page metadata');
assert.equal(brokenOnArrival.pageFetches[0]?.options?.cache, 'no-store', 'retry bypasses stale source-page cache');
assert.equal(brokenOnArrival.image.getAttribute('data-ehtw-load-failed'), null, 'retry clears its failed state');
assert.equal(brokenOnArrival.image.parentNode.classList.contains('ehtw-reader-image-loading'), true, 'retry shows the loading animation again');

const brokenWhileReading = makePage();
brokenWhileReading.image.dispatch('error');
assert.equal(brokenWhileReading.image.getAttribute('data-ehtw-load-failed'), null, 'automatic retry keeps the image out of the final failed state');
assert.equal(brokenWhileReading.image.parentNode.classList.contains('ehtw-reader-image-loading'), true, 'automatic retry keeps the loading animation visible');
const firstAutoRetry = brokenWhileReading.timers.find((timer) => timer.delay === 800 && !timer.cancelled);
assert.ok(firstAutoRetry, 'first automatic retry is scheduled with a short backoff');
firstAutoRetry.cancelled = true;
await firstAutoRetry.callback();
brokenWhileReading.image.dispatch('error');
const secondAutoRetry = brokenWhileReading.timers.find((timer) => timer.delay === 1800 && !timer.cancelled);
assert.ok(secondAutoRetry, 'second automatic retry is scheduled after the first retry fails');
secondAutoRetry.cancelled = true;
await secondAutoRetry.callback();
brokenWhileReading.image.dispatch('error');
assert.equal(brokenWhileReading.image.getAttribute('data-ehtw-load-failed'), 'true', 'failed images expose manual retry only after automatic attempts are exhausted');
assert.equal(brokenWhileReading.image.alt, '', 'final failures do not display text');

console.log('PASS reader defaults to vertical scrolling');
console.log('PASS mode toggle enables and restores click paging');
console.log('PASS click mode stays in the reader while locally loaded images are available');
console.log('PASS missing navigation links are safe');
console.log('PASS each direction works independently when the other link is missing');
console.log('PASS boundary self-links do not reload the current page');
console.log('PASS unsupported /s/ pages remain untouched');
console.log('PASS failed images show an icon-only retry control and reload without page navigation');
