import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CDP_HTTP } from './cdp-endpoint.mjs';

const [scriptPath, readerUrl] = process.argv.slice(2);
if (!scriptPath || !readerUrl) {
  throw new Error('Usage: node test-reader-browser.mjs <script.user.js> <readerUrl>');
}

const script = readFileSync(scriptPath, 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tab = await (await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const errors = [];
const mainFrameNavigations = [];
const imageRequests = [];
const pausedRequests = [];
let stalledImageFileName = null;
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
  if (message.method === 'Page.frameNavigated' && !message.params.frame.parentId) {
    mainFrameNavigations.push(message.params.frame.url);
  }
  if (message.method === 'Network.requestWillBeSent' && message.params.type === 'Image') {
    imageRequests.push(message.params.request.url);
  }
  if (message.method === 'Fetch.requestPaused') {
    const request = message.params.request;
    if (stalledImageFileName && request.url.includes(stalledImageFileName)) {
      pausedRequests.push({ id:message.params.requestId, url:request.url });
    } else {
      send('Fetch.continueRequest', { requestId:message.params.requestId });
    }
  }
};

const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || 'Runtime.evaluate failed');
  return response.result?.result?.value;
};
const clickAt = async (x, y) => {
  for (const [type, extra] of [
    ['mouseMoved', {}],
    ['mousePressed', { button: 'left', clickCount: 1 }],
    ['mouseReleased', { button: 'left', clickCount: 1 }]
  ]) {
    await send('Input.dispatchMouseEvent', { type, x, y, ...extra });
  }
};
const wheelAt = async (x, y, deltaY) => {
  await send('Input.dispatchMouseEvent', {
    type:'mouseWheel', x, y, deltaX:0, deltaY
  });
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 700, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: readerUrl });

  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await evaluate(`document.readyState === 'complete' && !!document.querySelector('#img')`);
    if (ready) break;
    await sleep(500);
  }
  assert.ok(ready, 'the original /s/ image page loads');
  await evaluate(`(() => {
    localStorage.removeItem('ehtw-reader-preload-count-v1');
    localStorage.removeItem('ehtw-reader-mode-v1');
    localStorage.removeItem('ehtw-reader-zoom-percent-v1');
    localStorage.removeItem('ehtw-gallery-index-prefetch-count-v1');
  })()`);
  const hasPreviousPage = await evaluate(`(() => {
    const previous = document.querySelector('#prev');
    return !!previous?.href && previous.href !== location.href;
  })()`);
  const hasFollowingPage = await evaluate(`(() => {
    const next = document.querySelector('#next');
    return !!next?.href && next.href !== location.href;
  })()`);
  let stalledImageUrl = null;
  let stalledPageUrl = null;
  if (hasFollowingPage && !hasPreviousPage) {
    const nextPageUrl = await evaluate(`document.querySelector('#next').href`);
    stalledPageUrl = nextPageUrl;
    stalledImageUrl = await evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(nextPageUrl)}, { credentials:'same-origin' });
      const html = await response.text();
      const image = new DOMParser().parseFromString(html, 'text/html').querySelector('#img');
      const source = image?.getAttribute('data-src') || image?.getAttribute('src');
      return source ? new URL(source, ${JSON.stringify(nextPageUrl)}).href : null;
    })()`);
    assert.ok(stalledImageUrl, 'the next page exposes an image source for the stalled-load test');
    stalledImageFileName = new URL(stalledImageUrl).pathname.split('/').filter(Boolean).at(-1);
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled:true });
    await send('Fetch.enable', {
      patterns:[{ urlPattern:'*', resourceType:'Image', requestStage:'Request' }]
    });
  }
  await evaluate(`(() => {
    window.__ehtwPageRequests = [];
    window.__ehtwPageFetchCount = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href).href;
      if (new URL(url).origin === location.origin && new URL(url).pathname.startsWith('/s/')) {
        window.__ehtwPageRequests.push(url);
        window.__ehtwPageFetchCount++;
        if (window.__ehtwPageFetchCount === ${stalledImageUrl ? 3 : 0}) {
          return new Promise((resolve, reject) => {
            window.__ehtwHeldPageFetch = () => originalFetch(input, init).then(resolve, reject);
          });
        }
      }
      return originalFetch(input, init);
    };
  })()`);
  await evaluate(script);

  if (stalledImageUrl) {
    let earlyImagesReady = false;
    let earlyImageSource = null;
    for (let i = 0; i < 60; i++) {
      const earlyState = await evaluate(`({
        count:document.querySelectorAll('.ehtw-reader-page-image').length,
        held:typeof window.__ehtwHeldPageFetch === 'function',
        source:document.querySelectorAll('.ehtw-reader-page-image')[2]?.currentSrc || document.querySelectorAll('.ehtw-reader-page-image')[2]?.src || null
      })`);
      earlyImageSource = earlyState.source;
      earlyImagesReady = earlyState.count >= 3 && earlyState.held && imageRequests.includes(earlyState.source);
      if (earlyImagesReady) break;
      await sleep(100);
    }
    assert.ok(earlyImagesReady, 'the first discovered images begin loading before the rest of their preload batch is fetched');
    await evaluate(`(() => { const resume = window.__ehtwHeldPageFetch; window.__ehtwHeldPageFetch = null; resume?.(); })()`);
    console.log('PASS next-page images start loading while later page metadata is still being fetched');
  }

  const expectedImageCount = 1 + (hasPreviousPage ? 3 : 0) + (hasFollowingPage ? 3 : 0);
  let preloaded = false;
  for (let i = 0; i < 40; i++) {
    preloaded = await evaluate(`document.querySelectorAll('.ehtw-reader-page-image').length >= ${expectedImageCount} && document.querySelector('.ehtw-reader-root')?.getAttribute('data-ehtw-reader-ready') === 'true'`);
    if (preloaded) break;
    await sleep(250);
  }
  assert.ok(preloaded, hasFollowingPage ? 'current image and three future images are added' : 'terminal page renders its current image');

  if (stalledImageUrl) {
    let requestPaused = false;
    for (let i = 0; i < 40; i++) {
      requestPaused = pausedRequests.some((request) => request.url.includes(stalledImageFileName));
      if (requestPaused) break;
      await sleep(100);
    }
    if (!requestPaused) {
      console.log('STALL_DIAGNOSTIC', JSON.stringify({
        expected:stalledImageUrl,
        paused:pausedRequests,
        images:await evaluate(`([...document.querySelectorAll('.ehtw-reader-page-image')]).map((image)=>image.currentSrc||image.src)`)
      }));
    }
    assert.ok(requestPaused, 'the first future image request is held pending for the stall test');
  }

  let imageBytesLoaded = expectedImageCount === 1;
  if (expectedImageCount > 1) {
    for (let i = 0; i < 40; i++) {
      imageBytesLoaded = await evaluate(`(() => {
        const images = [...document.querySelectorAll('.ehtw-reader-page-image')];
        const currentIndex = images.findIndex((img) => img.dataset.pageUrl === location.href);
        const future = images.filter((_, index) => index !== currentIndex);
        const stalledPage = ${JSON.stringify(stalledPageUrl)};
        const stalled = stalledPage ? future.find((img) => img.dataset.pageUrl === stalledPage) : null;
        const others = stalledPage ? future.filter((img) => img.dataset.pageUrl !== stalledPage) : future;
        return future.length === ${expectedImageCount - 1} && others.every((img) => img.complete && img.naturalWidth > 0) && (!stalledPage || (stalled && !stalled.complete));
      })()`);
      if (imageBytesLoaded) break;
      await sleep(250);
    }
  }
  assert.ok(imageBytesLoaded, expectedImageCount > 1 ? 'preloaded image resources finish loading before they are reached' : 'single-page gallery has no future image resources');
  const initial = await evaluate(`(() => {
    const image = document.querySelector('#img');
    image.scrollIntoView({ block: 'center' });
    const rect = image.getBoundingClientRect();
    const prev = document.querySelector('#prev');
    const next = document.querySelector('#next');
    return {
      url: location.href,
      currentIndex: [...document.querySelectorAll('.ehtw-reader-page-image')].findIndex((img) => img.dataset.pageUrl === location.href),
      htmlClass: document.documentElement.className,
      buttons: [...document.querySelectorAll('.ehtw-reader-mode')].map((b) => ({ mode: b.dataset.mode, pressed: b.getAttribute('aria-pressed') })),
      pageCount: document.querySelector('.ehtw-reader-page-count')?.textContent || null,
      draggable: image.draggable,
      dragStartPrevented: (() => {
        const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
        image.dispatchEvent(event);
        return event.defaultPrevented;
      })(),
      touchAction: getComputedStyle(image).touchAction,
      image: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, maxWidth: getComputedStyle(image).maxWidth },
      overflowY: getComputedStyle(document.body).overflowY,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
      htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      imageGap: getComputedStyle(document.querySelector('.ehtw-reader-images')).gap,
      preloadCount: document.querySelector('.ehtw-reader-preload-count')?.value ?? null,
      visibleBodyChildren: [...document.body.children].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.className),
      visibleReaderChildren: [...document.querySelector('.ehtw-reader-root').children].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.className),
      images: [...document.querySelectorAll('.ehtw-reader-page-image')].map((img) => ({
        src: img.currentSrc || img.src,
        page: img.dataset.pageUrl,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        fetchPriority: img.fetchPriority,
        loading: img.parentElement.classList.contains('ehtw-reader-image-loading'),
        spinner: getComputedStyle(img.parentElement.querySelector('.ehtw-reader-loading-spinner') || img).animationName
      })),
      pageRequests: [...window.__ehtwPageRequests],
      prev: prev?.href || null,
      next: next?.href || null
    };
  })()`);

  const currentPageNumber = Number(
    new URL(initial.url).pathname.split('/').filter(Boolean).at(-1).split('-').at(-1)
  );
  const totalPageCount = Number.parseInt(String(initial.pageCount || '').split('/')[1], 10);
  assert.ok(Number.isFinite(totalPageCount) && totalPageCount >= currentPageNumber, 'reader exposes a valid total page count');
  assert.match(initial.htmlClass, /ehtw-reader/, 'reader class is applied');
  assert.equal(initial.buttons.length, 2, 'both mode buttons render');
  assert.equal(initial.buttons.find((b) => b.mode === 'scroll')?.pressed, 'true', 'vertical mode is selected by default');
  assert.equal(initial.buttons.find((b) => b.mode === 'click')?.pressed, 'false', 'click paging starts disabled');
  assert.equal(initial.htmlBackground, 'rgb(0, 0, 0)', 'document background is pure black');
  assert.equal(initial.bodyBackground, 'rgb(0, 0, 0)', 'reader background is pure black');
  assert.equal(initial.imageGap, '0px', 'vertical images have no gap');
  assert.equal(initial.preloadCount, '3', 'settings default to three future images');
  assert.equal(initial.pageCount, `${currentPageNumber} / ${totalPageCount}`, 'settings show the current page and gallery total');
  assert.equal(initial.draggable, false, 'reader images are not draggable');
  assert.equal(initial.dragStartPrevented, true, 'reader cancels native drag start');
  assert.equal(initial.touchAction, 'manipulation', 'reader images allow panning and pinch zoom (pan-y blocked iOS pinch zoom)');
  assert.deepEqual(initial.visibleBodyChildren, ['ehtw-reader-root'], 'only the reader root is visible in the page body');
  assert.deepEqual(initial.visibleReaderChildren.sort(), ['ehtw-reader-controls', 'ehtw-reader-images', 'ehtw-reader-page-tools'].sort(), 'reader root only shows image and reading controls');
  assert.equal(initial.overflowY, 'auto', 'body scrolls vertically');
  if (hasFollowingPage) {
    assert.ok(initial.scrollHeight > initial.viewportHeight, 'tall image content can be scrolled vertically');
  }
  assert.equal(initial.image.maxWidth, `${await evaluate('innerWidth')}px`, 'full-size image is constrained to viewport width');
  assert.ok(initial.prev && initial.next, 'original previous and next links are present');
  assert.equal(initial.images.length, expectedImageCount, 'reader only includes the current page plus an allowed preload batch');
  if (stalledImageUrl) {
    const stalledPageImage = initial.images.find((image) => image.page === stalledPageUrl);
    assert.equal(stalledPageImage?.loading, true, 'stalled image shows its loading animation');
    assert.equal(stalledPageImage?.spinner, 'ehtw-reader-spin', 'loading animation is active while the image is pending');
    assert.ok(initial.images.filter((image) => image.complete).every((image) => !image.loading), 'loaded images hide their loading animation');
  }
  if (hasFollowingPage) {
    assert.equal(initial.images[initial.currentIndex + 1]?.fetchPriority, 'high', 'the closest upcoming page receives highest priority');
    assert.ok(initial.images.slice(initial.currentIndex + 2).every((image) => image.fetchPriority === 'auto'), 'farther pages in the preload window keep normal priority');
  }

  if (hasFollowingPage) {
    const initialRequests = (hasPreviousPage ? 3 : 0) + 3;
    assert.equal(initial.pageRequests.length, initialRequests, 'only the configured initial pages on each side are fetched');
    assert.equal(new Set([initial.url, ...initial.pageRequests]).size, initialRequests + 1, 'preloaded page sequence contains no duplicate page URLs');
    assert.equal(new Set(initial.images.map((image) => image.page)).size, expectedImageCount, 'image nodes retain distinct source page URLs');

    const nearestPair = [
      initial.images[initial.currentIndex - 1],
      initial.images[initial.currentIndex + 1]
    ].filter((image) => image && image.page !== stalledPageUrl).map((image) => image.src);

    if (nearestPair.length === 2) {
      const parallelSpread = await evaluate(`(() => {
        const urls = ${JSON.stringify(nearestPair)};
        const starts = performance.getEntriesByType('resource')
          .filter((entry) => urls.includes(entry.name))
          .map((entry) => entry.startTime);
        return starts.length === urls.length ? Math.max(...starts) - Math.min(...starts) : null;
      })()`);
      assert.ok(parallelSpread !== null && parallelSpread < 1000, 'equidistant previous and next images start in parallel');
    }

    await evaluate(`(() => {
      const input = document.querySelector('.ehtw-reader-preload-count');
      input.value = '2';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    assert.equal(await evaluate(`localStorage.getItem('ehtw-reader-preload-count-v1')`), '2', 'changed preload count is saved for future reader pages');

    await evaluate(`document.querySelectorAll('.ehtw-reader-page-image')[${expectedImageCount - 1}].scrollIntoView({ block: 'end' })`);
    let continued = false;
    for (let i = 0; i < 120; i++) {
      continued = await evaluate(`document.querySelectorAll('.ehtw-reader-page-image').length >= ${expectedImageCount + 2}`);
      if (continued) break;
      await sleep(250);
    }
    assert.ok(continued, 'scrolling to the end triggers the user-sized two-image batch');
    assert.equal(await evaluate('window.__ehtwPageRequests.length'), initialRequests + 2, 'the custom two-image batch requests only two additional pages');

    await evaluate(`document.querySelectorAll('.ehtw-reader-page-image')[${expectedImageCount + 1}].scrollIntoView({ block: 'end' })`);
    let nextContinued = false;
    for (let i = 0; i < 120; i++) {
      nextContinued = await evaluate(`document.querySelectorAll('.ehtw-reader-page-image').length >= ${expectedImageCount + 4}`);
      if (nextContinued) break;
      await sleep(250);
    }
    assert.ok(nextContinued, 'scrolling through a custom batch schedules the next custom batch');
    if (await evaluate('window.__ehtwPageRequests.length') !== initialRequests + 4) {
      console.log('BATCH_SIZE_DIAGNOSTIC', JSON.stringify(await evaluate(`({
        requests:window.__ehtwPageRequests,
        images:[...document.querySelectorAll('.ehtw-reader-page-image')].map((image)=>({page:image.dataset.pageUrl,complete:image.complete,width:image.width,height:image.height,rectH:image.getBoundingClientRect().height})),
        sentinel:document.querySelector('.ehtw-reader-sentinel:last-child')?.getBoundingClientRect().toJSON(),
        scrollY
      })`)));
    }
    assert.equal(await evaluate('window.__ehtwPageRequests.length'), initialRequests + 4, 'each custom batch contains only two page requests');
  } else {
    assert.equal(initial.pageRequests.length, hasPreviousPage ? 3 : 0, 'terminal page preloads only earlier pages');
  }

  if (hasFollowingPage) {
    const scrollTargetIndex = initial.currentIndex + 2;
    const scrollTargetPageNumber = currentPageNumber + 2;
    await evaluate(`document.querySelectorAll('.ehtw-reader-page-image')[${scrollTargetIndex}].scrollIntoView({ block: 'center' })`);
    let scrollPageUpdated = false;
    for (let i = 0; i < 40; i++) {
      scrollPageUpdated = await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent === '${scrollTargetPageNumber} / ${totalPageCount}'`);
      if (scrollPageUpdated) break;
      await sleep(100);
    }
    assert.ok(scrollPageUpdated, 'vertical scrolling updates the current-page indicator');
    await evaluate(`document.querySelector('[data-mode="click"]').click()`);
    assert.equal(await evaluate(`localStorage.getItem('ehtw-reader-mode-v1')`), 'click', 'click mode preference is saved');
    const clickActivePage = await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl`);
    assert.equal(
      clickActivePage,
      initial.images[scrollTargetIndex].page,
      'switching to click mode keeps the image currently at the viewport center'
    );
    const fittedClickLayout = await evaluate(`(() => {
      const frame = document.querySelector('.ehtw-reader-page-image.ehtw-reader-active').parentElement;
      const imageRect = frame.getBoundingClientRect();
      const topRect = document.querySelector('.ehtw-reader-controls').getBoundingClientRect();
      const bottomRect = document.querySelector('.ehtw-reader-page-tools').getBoundingClientRect();
      return { frame:{left:imageRect.left,right:imageRect.right,top:imageRect.top,bottom:imageRect.bottom,width:imageRect.width,height:imageRect.height}, viewport:{width:innerWidth,height:innerHeight}, top:topRect.toJSON(), bottom:bottomRect.toJSON(), toolsDisplay:getComputedStyle(document.querySelector('.ehtw-reader-page-tools')).display };
    })()`);
    assert.equal(fittedClickLayout.toolsDisplay, 'flex', 'click mode shows the bottom zoom and page tools');
    assert.ok(fittedClickLayout.frame.left >= -1 && fittedClickLayout.frame.right <= fittedClickLayout.viewport.width + 1, 'fit mode keeps the page within viewport width');
    assert.ok(fittedClickLayout.frame.top >= -1 && fittedClickLayout.frame.bottom <= fittedClickLayout.viewport.height + 1, 'fit mode uses the full viewport behind the controls');
    assert.ok(fittedClickLayout.top.bottom > fittedClickLayout.frame.top && fittedClickLayout.top.top < fittedClickLayout.frame.bottom, 'top settings overlay the page viewport');
    assert.ok(fittedClickLayout.bottom.top < fittedClickLayout.frame.bottom && fittedClickLayout.bottom.bottom > fittedClickLayout.frame.top, 'bottom tools overlay the page viewport');
    const fitHeight = fittedClickLayout.frame.height;
    await evaluate(`document.querySelector('.ehtw-reader-zoom-button[aria-label="放大图片"]').click()`);
    assert.equal(await evaluate(`document.querySelector('.ehtw-reader-zoom-input').value`), '110', 'zoom-in button increases the zoom percentage');
    assert.equal(await evaluate(`localStorage.getItem('ehtw-reader-zoom-percent-v1')`), '110', 'zoom percentage is saved');
    assert.ok(await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active').parentElement.getBoundingClientRect().height`) > fitHeight, 'zoom-in enlarges the active page');
    await evaluate(`(() => { const input=document.querySelector('.ehtw-reader-zoom-input'); input.value='150'; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    assert.equal(await evaluate(`document.querySelector('.ehtw-reader-zoom-input').value`), '150', 'zoom percentage can be entered manually');
    await evaluate(`document.querySelector('.ehtw-reader-fit-button').click()`);
    assert.equal(await evaluate(`document.querySelector('.ehtw-reader-zoom-input').value`), '100', 'fit button restores automatic page fit');
    const requestsBeforeSeek = await evaluate('window.__ehtwPageRequests.length');
    await evaluate(`(() => { const slider=document.querySelector('.ehtw-reader-page-slider'); slider.value='${scrollTargetPageNumber}'; slider.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    let sliderSeekReady = false;
    for (let i = 0; i < 40; i++) {
      sliderSeekReady = await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent === '${scrollTargetPageNumber} / ${totalPageCount}'`);
      if (sliderSeekReady) break;
      await sleep(100);
    }
    assert.ok(sliderSeekReady, 'page slider selects a preloaded page');
    assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl`), initial.images[scrollTargetIndex].page, 'page slider activates the selected image');
    assert.equal(await evaluate('window.__ehtwPageRequests.length'), requestsBeforeSeek, 'seeking to an already loaded page makes no extra page requests');
    await evaluate(`document.querySelector('[data-mode="scroll"]').click()`);
    assert.equal(await evaluate(`localStorage.getItem('ehtw-reader-mode-v1')`), 'scroll', 'scroll mode preference is saved');
    assert.equal(await evaluate(`[...document.querySelectorAll('.ehtw-reader-page-image')].filter((img) => getComputedStyle(img).display !== 'none').length`), expectedImageCount + 4, 'returning to scroll mode restores the full image strip');
  }

  const firstRect = await evaluate(`(() => { const image = document.querySelector('#img'); image.scrollIntoView({ block: 'center' }); const rect = image.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })()`);
  if (hasFollowingPage) {
    let returnedToCurrent = false;
    for (let i = 0; i < 40; i++) {
      returnedToCurrent = await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent === '${currentPageNumber} / ${totalPageCount}'`);
      if (returnedToCurrent) break;
      await sleep(100);
    }
    assert.ok(returnedToCurrent, 'scrolling to the opened page updates the current page number');
  }
  await clickAt(firstRect.x + firstRect.width * 0.8, firstRect.y + Math.min(firstRect.height / 2, 300));
  await sleep(500);
  assert.equal(await evaluate('location.href'), initial.url, 'image click does not navigate in vertical mode');

  await evaluate(`document.querySelector('[data-mode="click"]').click()`);
  assert.match(await evaluate('document.documentElement.className'), /ehtw-reader-click/, 'click paging can be enabled');
  assert.equal(await evaluate(`[...document.querySelectorAll('.ehtw-reader-page-image')].filter((img) => getComputedStyle(img).display !== 'none' && getComputedStyle(img).visibility !== 'hidden').length`), 1, 'click mode shows exactly one image while keeping hidden preloads fetchable');

  if (initial.currentIndex + 1 < initial.images.length) {
    const pageBeforeWheel = await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl`);
    await wheelAt(720, 350, 120);
    let wheelAdvanced = false;
    for (let i = 0; i < 30; i++) {
      wheelAdvanced = await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl === ${JSON.stringify(initial.images[initial.currentIndex + 1].page)}`);
      if (wheelAdvanced) break;
      await sleep(50);
    }
    assert.ok(wheelAdvanced, 'wheel down advances one image in click mode');
    await sleep(260);
    await wheelAt(720, 350, -120);
    let wheelReversed = false;
    for (let i = 0; i < 30; i++) {
      wheelReversed = await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl === ${JSON.stringify(pageBeforeWheel)}`);
      if (wheelReversed) break;
      await sleep(50);
    }
    assert.ok(wheelReversed, 'wheel up returns to the previous image in click mode');
    assert.equal(await evaluate('location.href'), initial.url, 'wheel paging stays in the current reader route');
  }

  await clickAt(firstRect.x + firstRect.width * 0.5, firstRect.y + Math.min(firstRect.height / 2, 300));
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ehtw-reader-controls')).display`), 'none', 'center click hides settings');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ehtw-reader-page-tools')).display`), 'none', 'center click also hides the bottom tools');
  await clickAt(firstRect.x + firstRect.width * 0.5, firstRect.y + Math.min(firstRect.height / 2, 300));
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.ehtw-reader-controls')).display`), 'none', 'center click restores settings');
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.ehtw-reader-page-tools')).display`), 'none', 'center click also restores the bottom tools');

  if (initial.prev === initial.url) {
    await clickAt(firstRect.x + firstRect.width * 0.2, firstRect.y + Math.min(firstRect.height / 2, 300));
    await sleep(500);
    assert.equal(await evaluate('location.href'), initial.url, 'first-page self-link does not reload');
  } else if (initial.currentIndex > 0) {
    await clickAt(firstRect.x + firstRect.width * 0.2, firstRect.y + Math.min(firstRect.height / 2, 300));
    assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl`), initial.images[initial.currentIndex - 1].page, 'left click opens the immediately previous preloaded image');
    assert.equal(await evaluate('location.href'), initial.url, 'previous image is shown in the existing reader route');
    await clickAt(firstRect.x + firstRect.width * 0.8, firstRect.y + Math.min(firstRect.height / 2, 300));
    assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl`), initial.url, 'right click returns to the originally opened image');
  }

  await clickAt(firstRect.x + firstRect.width * 0.8, firstRect.y + Math.min(firstRect.height / 2, 300));
  if (hasFollowingPage) {
    const activePage = await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl || ''`);
    assert.equal(activePage, initial.images[initial.currentIndex + 1].page, 'right image zone advances to the next loaded image');
    assert.equal(await evaluate('location.href'), initial.url, 'click paging stays inside the continuous reader route');
    assert.equal(await evaluate(`[...document.querySelectorAll('.ehtw-reader-page-image')].filter((img) => getComputedStyle(img).display !== 'none').length`), 1, 'advancing still shows exactly one image');
    assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent`), `${currentPageNumber + 1} / ${totalPageCount}`, 'click paging updates the current-page indicator');

    if (stalledImageUrl) {
      assert.equal(await evaluate('window.__ehtwPageRequests.length'), 7, 'later page batches complete while the first future image remains stalled');
      assert.equal(await evaluate('document.querySelectorAll(".ehtw-reader-page-image").length'), expectedImageCount + 4, 'later images enter the reader despite the stalled earlier image');
    } else {
    const clickActiveRight = async () => {
      const rect = await evaluate(`(() => {
        const image = document.querySelector('.ehtw-reader-page-image.ehtw-reader-active');
        const bounds = image.getBoundingClientRect();
        return { x:bounds.x, y:bounds.y, width:bounds.width, height:bounds.height };
      })()`);
      await clickAt(rect.x + rect.width * 0.8, rect.y + Math.min(rect.height / 2, 300));
      await sleep(100);
    };

    for (let step = 0; step < 30; step++) {
      const position = await evaluate(`(() => {
        const images = [...document.querySelectorAll('.ehtw-reader-page-image')];
        const active = images.findIndex((image) => image.classList.contains('ehtw-reader-active'));
        return { active, total:images.length };
      })()`);
      if (position.active >= position.total - 1) break;
      await clickActiveRight();
    }
    const pageAtPreloadedEdge = await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl`);
    const pageNumberAtEdge = Number(new URL(pageAtPreloadedEdge).pathname.split('/').filter(Boolean).at(-1).split('-').at(-1));
    const requestCountAtEdge = await evaluate('window.__ehtwPageRequests.length');
    await clickActiveRight();
    let clickModeContinued = false;
    for (let i = 0; i < 80; i++) {
      clickModeContinued = await evaluate(`
        document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl &&
        Number(new URL(document.querySelector('.ehtw-reader-page-image.ehtw-reader-active').dataset.pageUrl).pathname.split('/').filter(Boolean).at(-1).split('-').at(-1)) === ${pageNumberAtEdge + 1}
      `);
      if (clickModeContinued) break;
      await sleep(250);
    }
    if (!clickModeContinued) {
      console.log('STALLED_CLICK_DIAGNOSTIC', JSON.stringify(await evaluate(`({
        active:document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl,
        count:document.querySelectorAll('.ehtw-reader-page-image').length,
        requests:window.__ehtwPageRequests,
        images:[...document.querySelectorAll('.ehtw-reader-page-image')].map((img)=>({page:img.dataset.pageUrl,complete:img.complete,failed:img.getAttribute('data-ehtw-load-failed'),display:getComputedStyle(img).display}))
      })`)));
    }
    assert.ok(clickModeContinued, 'click mode preloads another batch and advances at the loaded boundary');
    assert.equal(await evaluate('window.__ehtwPageRequests.length'), requestCountAtEdge + 2, 'click-mode boundary loads only the configured two-page batch');
    assert.equal(await evaluate(`[...document.querySelectorAll('.ehtw-reader-page-image')].filter((img) => getComputedStyle(img).display !== 'none').length`), 1, 'click-mode batch advancement still displays one image');
    assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent`), `${pageNumberAtEdge + 1} / ${totalPageCount}`, 'click-mode batch advancement updates the page indicator');

    const activeImage = await evaluate(`(() => {
      const image = document.querySelector('.ehtw-reader-page-image.ehtw-reader-active');
      const bounds = image.getBoundingClientRect();
      image.dispatchEvent(new Event('error'));
      const button = image.parentElement.querySelector('.ehtw-reader-retry-button');
      return { x:bounds.x, y:bounds.y, width:bounds.width, height:bounds.height, src:image.currentSrc || image.src, failed:image.getAttribute('data-ehtw-load-failed'), alt:image.alt, iconLabel:button?.getAttribute('aria-label') || null, iconText:button?.textContent || '' };
    })()`);
    assert.equal(activeImage.failed, 'true', 'a failed image receives a retry state');
    assert.equal(activeImage.alt, '', 'failed image does not display retry text');
    assert.equal(activeImage.iconLabel, '重新加载图片', 'centered retry icon is accessible');
    assert.equal(activeImage.iconText, '', 'centered retry icon has no text');
    await send('Network.setCacheDisabled', { cacheDisabled:true });
    const navigationsBeforeRetry = mainFrameNavigations.length;
    const pageBeforeRetry = await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent`);
    const imageRequestCountBeforeRetry = imageRequests.length;
    await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active').parentElement.querySelector('.ehtw-reader-retry-button').click()`);
    for (let i = 0; i < 40; i++) {
      if (imageRequests.slice(imageRequestCountBeforeRetry).includes(activeImage.src)) break;
      await sleep(250);
    }
    assert.ok(imageRequests.length > imageRequestCountBeforeRetry, 'retry sends a new image resource request');
    assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent`), pageBeforeRetry, 'retry icon does not page the reader');
    const refreshedImageSource = await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.currentSrc || document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.src`);
    assert.ok(imageRequests.slice(imageRequestCountBeforeRetry).includes(refreshedImageSource), 'retry uses the current image URL returned by the source page');
    assert.equal(mainFrameNavigations.length, navigationsBeforeRetry, 'retry does not navigate or refresh the reader page');
    console.log('PASS failed image retry refreshes its URL and reloads without refreshing the reader');
    }
  } else {
    await sleep(500);
    assert.equal(await evaluate('location.href'), initial.url, 'terminal page click does not navigate past the end');

    if (initial.currentIndex > 0) {
      await clickAt(firstRect.x + firstRect.width * 0.2, firstRect.y + Math.min(firstRect.height / 2, 300));
      assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl`), initial.images[initial.currentIndex - 1].page, 'left image zone moves to the last preloaded previous page');
      assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent`), `${currentPageNumber - 1} / ${totalPageCount}`, 'left click updates the page indicator at the end');
    } else if (initial.prev && initial.prev !== initial.url) {
      await clickAt(firstRect.x + firstRect.width * 0.2, firstRect.y + Math.min(firstRect.height / 2, 300));
      assert.equal(await evaluate('location.href'), initial.url, 'left boundary uses the loaded previous-page sequence');
    }
  }
  assert.deepEqual(errors, [], 'no runtime exceptions occur');

  if (hasFollowingPage) {
    await send('Page.navigate', { url: initial.url });
    let reloadedReaderReady = false;
    for (let i = 0; i < 40; i++) {
      reloadedReaderReady = await evaluate(`document.readyState === 'complete' && !!document.querySelector('#img')`);
      if (reloadedReaderReady) break;
      await sleep(250);
    }
    assert.ok(reloadedReaderReady, 'reader page reloads for the saved-setting check');
    await evaluate(script);
    let restoredCount = null;
    for (let i = 0; i < 40; i++) {
      restoredCount = await evaluate(`document.querySelector('.ehtw-reader-preload-count')?.value || null`);
      if (restoredCount) break;
      await sleep(100);
    }
    assert.equal(restoredCount, '2', 'a newly initialized reader restores the saved preload count');
    assert.equal(await evaluate(`document.documentElement.classList.contains('ehtw-reader-click')`), true, 'a newly initialized reader restores click mode');
    assert.equal(await evaluate(`document.querySelector('.ehtw-reader-zoom-input')?.value`), '100', 'a newly initialized reader restores the saved fit zoom');
    console.log('PASS preload count persists across reader page loads');
  }

  console.log('PASS actual /s/ page loads the reader');
  console.log('PASS pure black reader shows only settings and the continuous image strip');
  console.log(hasFollowingPage
    ? 'PASS vertical mode is default and fully preloads exactly three future images'
    : 'PASS final page stops without preloading extra pages');
  if (hasFollowingPage) console.log('PASS scrolling to the end preloads the next three images');
  console.log(hasFollowingPage
    ? 'PASS click mode respects the first-page boundary and advances to the original next page'
    : 'PASS click mode respects the last-page boundary');
  if (stalledImageUrl) {
    console.log('PASS stalled images show a spinner while later images and batches continue loading');
  }
  console.log(JSON.stringify({ page: initial.url, previous: initial.prev, next: initial.next, image: initial.image }));
} finally {
  ws.close();
  await fetch(`${CDP_HTTP}/json/close/${tab.id}`);
}
