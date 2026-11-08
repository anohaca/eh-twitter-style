import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CDP_HTTP } from './cdp-endpoint.mjs';

const [scriptPath, readerUrl] = process.argv.slice(2);
if (!scriptPath || !readerUrl) {
  throw new Error('Usage: node test-reader-backward-browser.mjs <script.user.js> <readerUrl>');
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
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
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

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 700, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: readerUrl });

  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await evaluate(`document.readyState === 'complete' && !!document.querySelector('#img')`);
    if (ready) break;
    await sleep(500);
  }
  assert.ok(ready, 'the original mid-gallery /s/ page loads');
  await evaluate(`(() => {
    localStorage.removeItem('ehtw-reader-preload-count-v1');
    localStorage.removeItem('ehtw-reader-mode-v1');
    localStorage.removeItem('ehtw-reader-zoom-percent-v1');
    localStorage.removeItem('ehtw-gallery-index-prefetch-count-v1');
  })()`);

  const before = await evaluate(`(() => {
    const image = document.querySelector('#img');
    image.scrollIntoView({ block: 'center' });
    return { url:location.href, top:image.getBoundingClientRect().top };
  })()`);

  await evaluate(`(() => {
    window.__ehtwPageRequests = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href).href;
      if (new URL(url).origin === location.origin && new URL(url).pathname.startsWith('/s/')) window.__ehtwPageRequests.push(url);
      return originalFetch(input, init);
    };
  })()`);
  await evaluate(script);

  let readyImages = false;
  for (let i = 0; i < 80; i++) {
    readyImages = await evaluate(`document.querySelectorAll('.ehtw-reader-page-image').length >= 7 && document.querySelector('.ehtw-reader-root')?.getAttribute('data-ehtw-reader-ready') === 'true'`);
    if (readyImages) break;
    await sleep(250);
  }
  assert.ok(readyImages, 'current page plus three images before and after it are preloaded');

  let allImagesLoaded = false;
  for (let i = 0; i < 40; i++) {
    allImagesLoaded = await evaluate(`([...document.querySelectorAll('.ehtw-reader-page-image')]).every((image) => image.complete && image.naturalWidth > 0)`);
    if (allImagesLoaded) break;
    await sleep(250);
  }
  assert.ok(allImagesLoaded, 'all six surrounding images are downloaded');

  const initial = await evaluate(`(() => {
    const images = [...document.querySelectorAll('.ehtw-reader-page-image')];
    const current = document.querySelector('#img');
    const pageNumber = (image) => {
      const segment = image.dataset.pageUrl.split('/').filter(Boolean).at(-1) || '';
      return Number(segment.slice(segment.lastIndexOf('-') + 1)) || 0;
    };
    return {
      url: location.href,
      pages: images.map(pageNumber),
      sources: images.map((image) => image.currentSrc || image.src),
      pageUrls: images.map((image) => image.dataset.pageUrl),
      currentIndex: images.indexOf(current),
      currentTop: current.getBoundingClientRect().top,
      scrollY,
      bodyScrollTop:document.body.scrollTop,
      htmlScrollTop:document.documentElement.scrollTop,
      pageCount: document.querySelector('.ehtw-reader-page-count')?.textContent,
      requests: [...window.__ehtwPageRequests]
    };
  })()`);
  const totalPageCount = Number.parseInt(String(initial.pageCount || '').split('/')[1], 10);
  const currentPageNumber = Number(new URL(initial.url).pathname.split('/').filter(Boolean).at(-1).split('-').at(-1));
  assert.ok(Number.isFinite(totalPageCount) && totalPageCount >= 9, 'middle-page fixture has enough pages for both preload directions and the top boundary');

  assert.ok(currentPageNumber >= 4, 'middle-page fixture has at least three earlier pages');
  assert.deepEqual(initial.pages, Array.from({ length: 7 }, (_, index) => currentPageNumber - 3 + index), 'previous images are ordered above the clicked page, followed by next images');
  assert.equal(initial.currentIndex, 3, 'the clicked page remains at its sequence position');
  assert.equal(initial.pageCount, `${currentPageNumber} / ${totalPageCount}`, 'counter remains on the clicked page');
  assert.equal(initial.requests.length, 6, 'three previous and three next pages are preloaded');
  assert.equal(new Set([initial.url, ...initial.requests]).size, 7, 'bidirectional preload has no duplicate page requests');
  assert.ok(Math.abs(initial.currentTop - before.top) < 60, 'preloading above preserves the clicked page near its opening position');

  for (const urls of [initial.sources.slice(0, 3), initial.sources.slice(4)]) {
    const spread = await evaluate(`(() => {
      const urls = ${JSON.stringify(urls)};
      const starts = performance.getEntriesByType('resource')
        .filter((entry) => urls.includes(entry.name))
        .map((entry) => entry.startTime);
      return starts.length === 3 ? Math.max(...starts) - Math.min(...starts) : null;
    })()`);
    if (spread === null || spread >= 1000) {
      console.log('PARALLEL_IMAGE_DIAGNOSTIC', JSON.stringify({ urls, spread, entries: await evaluate(`performance.getEntriesByType('resource').filter((entry)=>${JSON.stringify(urls)}.includes(entry.name)).map((entry)=>({name:entry.name,startTime:entry.startTime,duration:entry.duration}))`) }));
    }
    assert.ok(spread !== null && spread < 1000, 'images in each direction start loading in parallel');
  }

  await evaluate(`document.querySelector('[data-mode="click"]').click()`);
  assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl`), initial.url, 'click mode starts on the page opened from the gallery');

  const imageRect = async () => evaluate(`(() => {
    const bounds = document.querySelector('.ehtw-reader-page-image.ehtw-reader-active').getBoundingClientRect();
    return { x:bounds.x, y:bounds.y, width:bounds.width, height:bounds.height };
  })()`);
  let rect = await imageRect();
  await clickAt(rect.x + rect.width * 0.2, rect.y + Math.min(rect.height / 2, 300));
  assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl`), initial.pageUrls[2], 'left click advances to the immediately previous preloaded image');
  rect = await imageRect();
  await clickAt(rect.x + rect.width * 0.8, rect.y + Math.min(rect.height / 2, 300));
  assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl`), initial.url, 'right click returns to the originally opened image');

  await evaluate(`document.querySelector('[data-mode="scroll"]').click()`);
  await evaluate(`document.querySelector('.ehtw-reader-page-image').scrollIntoView({ block: 'start' })`);
  let expanded = false;
  for (let i = 0; i < 80; i++) {
    expanded = await evaluate(`document.querySelectorAll('.ehtw-reader-page-image').length >= 9`);
    if (expanded) break;
    await sleep(250);
  }
  assert.ok(expanded, 'scrolling upward loads remaining previous pages');
  assert.deepEqual(await evaluate(`([...document.querySelectorAll('.ehtw-reader-page-image')]).map((image) => {
    const segment = image.dataset.pageUrl.split('/').filter(Boolean).at(-1) || '';
    return Number(segment.slice(segment.lastIndexOf('-') + 1)) || 0;
  })`), Array.from({ length: currentPageNumber + 3 }, (_, index) => index + 1), 'upward preload inserts pages in gallery order without duplicates');
  assert.equal(await evaluate('window.__ehtwPageRequests.length'), 6 + Math.max(0, currentPageNumber - 4), 'only the remaining earlier pages are requested');
  await evaluate(`document.querySelector('.ehtw-reader-page-image').scrollIntoView({ block: 'start' })`);
  let atFirstPage = false;
  for (let i = 0; i < 40; i++) {
    atFirstPage = await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent === '1 / ${totalPageCount}'`);
    if (atFirstPage) break;
    await sleep(100);
  }
  assert.ok(atFirstPage, 'scrolling to the top updates the page indicator');
  assert.deepEqual(errors, [], 'no runtime exceptions occur');

  console.log('PASS mid-gallery reader preloads and orders pages above and below the clicked page');
  console.log('PASS click paging traverses preloaded previous and next images locally');
  console.log('PASS scrolling upward progressively loads earlier pages without losing order');
} finally {
  ws.close();
  await fetch(`${CDP_HTTP}/json/close/${tab.id}`);
}
