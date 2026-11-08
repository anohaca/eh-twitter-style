import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CDP_HTTP } from './cdp-endpoint.mjs';

const [scriptPath, readerUrl] = process.argv.slice(2);
if (!scriptPath || !readerUrl) {
  throw new Error('Usage: node test-reader-mobile.mjs <script.user.js> <readerUrl>');
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

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: readerUrl });

  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await evaluate(`document.readyState === 'complete' && !!document.querySelector('#img')`);
    if (ready) break;
    await sleep(500);
  }
  assert.ok(ready, 'the mobile /s/ page loads');
  await evaluate(`(() => {
    localStorage.removeItem('ehtw-reader-preload-count-v2');
    localStorage.removeItem('ehtw-reader-mode-v1');
    localStorage.removeItem('ehtw-reader-zoom-percent-v1');
    localStorage.removeItem('ehtw-reader-page-link-preload-count-v1');
  })()`);
  await evaluate(`(() => {
    const originalFetch=window.fetch.bind(window);
    window.__ehtwGalleryIndexRequests=[];
    window.fetch=(input,init)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin && url.pathname.startsWith('/g/') && url.searchParams.has('p')){
        window.__ehtwGalleryIndexRequests.push(url.href);
      }
      return originalFetch(input,init);
    };
  })()`);
  await evaluate(`Object.defineProperty(document, 'readyState', { configurable:true, value:'interactive' })`);
  await evaluate(script);

  let readerReady = false;
  for (let i = 0; i < 20; i++) {
    readerReady = await evaluate(`!!document.querySelector('.ehtw-reader-controls')`);
    if (readerReady) break;
    await sleep(100);
  }
  assert.ok(readerReady, 'reader settings render on mobile');
  const initialReaderState = await evaluate(`(() => {
    const parts = document.querySelector('.ehtw-reader-page-count')?.textContent.split('/').map((value)=>Number.parseInt(value,10)) || [];
    const segment = location.pathname.split('/').filter(Boolean).at(-1) || '';
    return { current:Number(segment.slice(segment.lastIndexOf('-') + 1)), total:parts[1] };
  })()`);
  const totalPageCount = Number(initialReaderState.total);
  assert.equal(initialReaderState.current, 6, 'mobile reader fixture starts on page six for bidirectional seek checks');
  assert.ok(Number.isFinite(totalPageCount) && totalPageCount >= 10, 'mobile reader fixture has at least ten pages for remote seek');
  await evaluate(`(() => {const details=document.querySelector('.ehtw-reader-preload-details'); window.__ehtwPreloadSettingsInitiallyCollapsed=details?.open===false; if(details) details.open=true;})()`);
  let preloadedImagesReady = false;
  for (let i = 0; i < 300; i++) {
    preloadedImagesReady = await evaluate(`(() => {
      const count=document.querySelector('.ehtw-reader-page-count').textContent.split('/').map((value)=>Number.parseInt(value,10));
      const expected=1+Math.min(10,count[0]-1)+Math.min(10,count[1]-count[0]);
      return document.querySelectorAll('.ehtw-reader-page-image').length >= expected;
    })()`);
    if (preloadedImagesReady) break;
    await sleep(100);
  }
  assert.ok(preloadedImagesReady, 'ten page links on both sides are fetched on mobile');
  const deferredBeforeLoad = await evaluate(`(() => {
    const current=Number.parseInt(document.querySelector('.ehtw-reader-page-count').textContent.split('/')[0],10);
    return [...document.querySelectorAll('.ehtw-reader-page-image')].filter((image)=>image!==document.querySelector('#img')&&Math.abs(Number(image.dataset.pageUrl.match(/-(\\d+)\\/?$/)?.[1])-current)<=5).every((image)=>!image.hasAttribute('src')&&!!image.dataset.ehtwDeferredSource);
  })()`);
  assert.ok(deferredBeforeLoad, 'mobile defers the ten selected image requests until the main page load event');
  await evaluate(`delete document.readyState; window.dispatchEvent(new Event('load'))`);
  let deferredImagesStarted = false;
  for (let i = 0; i < 40; i++) {
    deferredImagesStarted = await evaluate(`(() => {
      const current=Number.parseInt(document.querySelector('.ehtw-reader-page-count').textContent.split('/')[0],10);
      const images=[...document.querySelectorAll('.ehtw-reader-page-image')].filter((image)=>image!==document.querySelector('#img'));
      return images.filter((image)=>Math.abs(Number(image.dataset.pageUrl.match(/-(\\d+)\\/?$/)?.[1])-current)<=5).every((image)=>image.hasAttribute('src')&&!image.dataset.ehtwDeferredSource)&&images.filter((image)=>Math.abs(Number(image.dataset.pageUrl.match(/-(\\d+)\\/?$/)?.[1])-current)>5).every((image)=>!image.hasAttribute('src')&&!!image.dataset.ehtwSeekDeferredSource);
    })()`);
    if (deferredImagesStarted) break;
    await sleep(100);
  }
  assert.ok(deferredImagesStarted, 'only the selected ten images start after the main page load event');

  const layout = await evaluate(`(() => {
    const controls = document.querySelector('.ehtw-reader-controls');
    const bounds = controls.getBoundingClientRect();
    const image = document.querySelector('#img');
    const imageBounds = image.getBoundingClientRect();
    const modes = [...document.querySelectorAll('.ehtw-reader-mode')].map((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return { w:rect.width, h:rect.height, fontSize:parseFloat(style.fontSize) };
    });
    const count = document.querySelector('.ehtw-reader-page-count');
    const countRect = count.getBoundingClientRect();
    const countStyle = getComputedStyle(count);
    const input = document.querySelector('.ehtw-reader-preload-count');
    const inputRect = input.getBoundingClientRect();
    const inputStyle = getComputedStyle(input);
    const zoomInput = document.querySelector('.ehtw-reader-zoom-input');
    const pageTools = document.querySelector('.ehtw-reader-page-tools');
    const pageToolsRect = pageTools.getBoundingClientRect();
    const imageStripStyle = getComputedStyle(document.querySelector('.ehtw-reader-images'));
    const pageLinkInput = document.querySelector('.ehtw-reader-page-link-preload-count');
    return {
      viewport:innerWidth,
      viewportHeight:innerHeight,
      viewportMeta:document.querySelector('meta[name="viewport"]')?.content || null,
      documentWidth:document.documentElement.scrollWidth,
      controls:{ left:bounds.left, right:bounds.right, top:bounds.top, bottom:bounds.bottom, width:bounds.width, height:bounds.height },
      modes,
      imagePriorities:[...document.querySelectorAll('.ehtw-reader-page-image')].map((image)=>image.fetchPriority),
      currentImagePriority:document.querySelector('#img')?.fetchPriority || null,
      imagePreloadCount:input.value,
      pageLinkPreloadCount:pageLinkInput?.value || null,
      preloadSettingsCollapsed:window.__ehtwPreloadSettingsInitiallyCollapsed,
      currentPage:Number.parseInt(count.textContent.split('/')[0],10),
      pageTools:{ display:getComputedStyle(pageTools).display, position:getComputedStyle(pageTools).position, top:pageToolsRect.top, bottom:pageToolsRect.bottom },
      imageStripPaddingBottom:parseFloat(imageStripStyle.paddingBottom),
      count:{ w:countRect.width, h:countRect.height, fontSize:parseFloat(countStyle.fontSize) },
      input:{ w:inputRect.width, h:inputRect.height, fontSize:parseFloat(inputStyle.fontSize) },
      zoomTextAlign:getComputedStyle(zoomInput).textAlign,
      imageTop:imageBounds.top
    };
  })()`);

  assert.ok(layout.controls.left >= 0 && layout.controls.right <= layout.viewport, 'settings stay within mobile screen width');
  assert.ok(layout.viewport <= 400, 'reader uses a phone-sized device-width viewport on mobile');
  assert.match(layout.viewportMeta || '', /width=device-width/, 'mobile viewport metadata is present');
  assert.ok(layout.documentWidth <= layout.viewport, 'reader does not create horizontal overflow on mobile');
  assert.ok(layout.modes.every((item) => item.h >= 44 && item.fontSize >= 15), 'mode buttons have mobile-sized targets and text');
  assert.ok(layout.count.h >= 44 && layout.count.fontSize >= 14, 'page counter is legible and touch-sized');
  assert.ok(layout.input.w >= 56 && layout.input.h >= 40 && layout.input.fontSize >= 16, 'preload count input is legible and touch-sized');
  assert.equal(layout.zoomTextAlign, 'center', 'manual zoom percentage is centered in its field');
  assert.ok(layout.imageTop >= layout.controls.bottom, 'settings do not overlap the first image');
  assert.equal(layout.currentImagePriority, 'high', 'mobile prioritizes the currently opened image');
  assert.equal(layout.imagePreloadCount, '5', 'image preload defaults to five pages in each direction');
  assert.equal(layout.pageLinkPreloadCount, '10', 'page link preload defaults to ten pages in each direction');
  assert.equal(layout.preloadSettingsCollapsed, true, 'all preload settings start collapsed');
  assert.equal(layout.pageTools.display, 'flex', 'bottom tools remain visible in vertical mode');
  assert.equal(layout.pageTools.position, 'fixed', 'bottom tools overlay the image strip');
  assert.equal(layout.imageStripPaddingBottom, 0, 'bottom tools do not reserve vertical-reading space');
  const preloadPriorities = await evaluate(`(() => {
    const current=Number.parseInt(document.querySelector('.ehtw-reader-page-count').textContent.split('/')[0],10);
    const images=[...document.querySelectorAll('.ehtw-reader-page-image')];
    const getPage=(image)=>{const m=image.dataset.pageUrl?.match(/-(\\d+)\\/?$/);return m?Number(m[1]):null;};
    const below=images.map((image)=>({page:getPage(image),priority:image.fetchPriority})).filter((item)=>item.page>current&&item.page<=current+5).sort((a,b)=>a.page-b.page);
    const above=images.map((image)=>({page:getPage(image),priority:image.fetchPriority})).filter((item)=>item.page<current&&item.page>=current-5).sort((a,b)=>b.page-a.page);
    return {below,above};
  })()`);
  assert.equal(preloadPriorities.below[0]?.priority, 'high', 'the nearest upcoming page receives high priority');
  assert.ok(preloadPriorities.below.slice(1).every((item)=>item.priority === 'auto'), 'farther upcoming pages use normal priority');
  assert.equal(preloadPriorities.above[0]?.priority, 'high', 'the nearest previous page receives high priority');
  assert.ok(preloadPriorities.above.slice(1).every((item)=>item.priority === 'auto'), 'farther previous pages use normal priority');

  await evaluate(`document.querySelector('[data-mode="click"]').click()`);
  const clickLayout = await evaluate(`(() => {
    const frame=document.querySelector('.ehtw-reader-page-image.ehtw-reader-active').parentElement.getBoundingClientRect();
    const top=document.querySelector('.ehtw-reader-controls').getBoundingClientRect();
    const bottom=document.querySelector('.ehtw-reader-page-tools').getBoundingClientRect();
    return {frame:{left:frame.left,right:frame.right,top:frame.top,bottom:frame.bottom,width:frame.width,height:frame.height},topBottom:top.bottom,bottomTop:bottom.top,tools:bottom.toJSON()};
  })()`);
  assert.ok(clickLayout.frame.left >= -1 && clickLayout.frame.right <= layout.viewport + 1, 'mobile fit mode keeps the page within screen width');
  assert.ok(clickLayout.frame.top >= -1 && clickLayout.frame.bottom <= layout.viewportHeight + 1, 'mobile fit mode uses the full viewport behind the toolbars');
  assert.ok(clickLayout.tools.left >= 0 && clickLayout.tools.right <= layout.viewport, 'bottom page tools fit the mobile screen');
  await evaluate(`document.querySelector('.ehtw-reader-zoom-button[aria-label="放大图片"]').click()`);
  assert.equal(await evaluate(`document.querySelector('.ehtw-reader-zoom-input').value`), '110', 'mobile zoom button changes scale');
  await evaluate(`(() => {const input=document.querySelector('.ehtw-reader-zoom-input'); input.value='135'; input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.equal(await evaluate(`document.querySelector('.ehtw-reader-zoom-input').value`), '135', 'mobile zoom can be entered manually');
  await evaluate(`document.querySelector('.ehtw-reader-fit-button').click()`);
  await evaluate(`(() => {const slider=document.querySelector('.ehtw-reader-page-slider'); slider.value='3'; slider.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  let mobileSeekReady = false;
  for (let i = 0; i < 40; i++) {
    mobileSeekReady = await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent === '3 / ${totalPageCount}'`);
    if (mobileSeekReady) break;
    await sleep(100);
  }
  assert.ok(mobileSeekReady, 'mobile progress bar jumps to a selected preloaded page');
  await evaluate(`(() => {
    const slider=document.querySelector('.ehtw-reader-page-slider');
    slider.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));
    slider.value='2';
    slider.dispatchEvent(new Event('input',{bubbles:true}));
    slider.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  assert.equal(await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent`), `2 / ${totalPageCount}`, 'dragging the page slider previews the corresponding loaded image');
  assert.match(await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl || ''`), /-2$/, 'image follows slider movement during the drag');
  await evaluate(`window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}))`);
  let releasedSliderReady = false;
  for (let i = 0; i < 40; i++) {
    releasedSliderReady = await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent === '2 / ${totalPageCount}'`);
    if (releasedSliderReady) break;
    await sleep(100);
  }
  assert.ok(releasedSliderReady, 'the page slider keeps the previewed page after drag release');
  await evaluate(`(() => {const slider=document.querySelector('.ehtw-reader-page-slider'); slider.value='3'; slider.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await evaluate(`(() => {
    const originalFetch=window.fetch.bind(window);
    window.__ehtwReleaseSeekFetch=null;
    window.__ehtwSeekPageFetchCount=0;
    window.__ehtwSeekPageFetchUrls=[];
    window.__ehtwSeekFetchHeld=false;
    window.fetch=(input,init)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin && url.pathname.startsWith('/s/')){
        window.__ehtwSeekPageFetchCount++;
        window.__ehtwSeekPageFetchUrls.push(url.href);
      }
      if(window.__ehtwSeekPageFetchCount===1 && !window.__ehtwSeekFetchHeld && url.origin===location.origin && url.pathname.startsWith('/s/')){
        window.__ehtwSeekFetchHeld=true;
        return new Promise((resolve,reject)=>{window.__ehtwReleaseSeekFetch=()=>originalFetch(input,init).then(resolve,reject);});
      }
      return originalFetch(input,init);
    };
  })()`);
  await evaluate(`(() => {const slider=document.querySelector('.ehtw-reader-page-slider'); slider.value='10'; slider.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  let seekOverlayVisible = false;
  let oldImagesWaiting = false;
  for (let i = 0; i < 30; i++) {
    const seekState = await evaluate(`(() => {
      const images=[...document.querySelectorAll('.ehtw-reader-page-image')];
      return {
        overlay:getComputedStyle(document.querySelector('.ehtw-reader-page-transition')).display === 'grid' && getComputedStyle(document.querySelector('.ehtw-reader-images')).visibility === 'hidden',
        held:window.__ehtwSeekFetchHeld,
        count:images.length
      };
    })()`);
    seekOverlayVisible = seekState.overlay && seekState.held;
    oldImagesWaiting = seekState.count === 4;
    if (seekOverlayVisible && oldImagesWaiting) break;
    await sleep(50);
  }
  assert.ok(seekOverlayVisible, 'an unloaded target immediately replaces the old page with a loading overlay');
  assert.ok(oldImagesWaiting, 'direct seek does not insert or load intervening pages');
  console.log('PASS seeking an unloaded page shows a loading overlay instead of the previous image');
  console.log('PASS direct seek requests the selected /s/ page without waiting for intervening /s/ pages');
  await evaluate(`window.__ehtwReleaseSeekFetch?.()`);
  let mobileRemoteSeekReady = false;
  for (let i = 0; i < 100; i++) {
    mobileRemoteSeekReady = await evaluate(`document.querySelector('.ehtw-reader-page-count')?.textContent === '10 / ${totalPageCount}'`);
    if (mobileRemoteSeekReady) break;
    await sleep(150);
  }
  assert.ok(mobileRemoteSeekReady, 'mobile page slider fetches page metadata to reach a page outside the initial preload');
  assert.match(await evaluate(`window.__ehtwSeekPageFetchUrls[0] || ''`), /-10$/, 'direct seek requests the selected page URL first');
  assert.match(await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.dataset.pageUrl || ''`), /-10$/, 'mobile page slider activates the requested remote page');
  assert.ok(await evaluate(`document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')?.hasAttribute('src')`), 'selected target image starts loading directly');
  await evaluate(`window.__ehtwMemoryTestImage=document.querySelector('.ehtw-reader-page-image.ehtw-reader-active')`);
  let memoryTestImageLoaded = false;
  for (let i = 0; i < 80; i++) {
    memoryTestImageLoaded = await evaluate(`window.__ehtwMemoryTestImage?.complete && window.__ehtwMemoryTestImage?.naturalWidth > 0`);
    if (memoryTestImageLoaded) break;
    await sleep(150);
  }
  assert.ok(memoryTestImageLoaded, 'directly selected image completes before the memory-release check');
  await evaluate(`document.querySelector('[data-mode="scroll"]').click()`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ehtw-reader-page-tools')).display`), 'flex', 'bottom zoom and page tools remain available in vertical mode');
  const unzoomedScrollWidth = await evaluate(`document.querySelector('.ehtw-reader-page-image').parentElement.getBoundingClientRect().width`);
  await evaluate(`document.querySelector('.ehtw-reader-zoom-button[aria-label="放大图片"]').click()`);
  assert.ok(await evaluate(`document.querySelector('.ehtw-reader-page-image').parentElement.getBoundingClientRect().width`) > unzoomedScrollWidth, 'vertical mode zoom changes image size');
  await evaluate(`document.querySelector('.ehtw-reader-fit-button').click()`);
  let initialPreloadReady = false;
  for (let i = 0; i < 60; i++) {
    initialPreloadReady = await evaluate(`document.querySelector('.ehtw-reader-root')?.getAttribute('data-ehtw-reader-ready') === 'true'`);
    if (initialPreloadReady) break;
    await sleep(100);
  }
  assert.ok(initialPreloadReady, 'reader finishes its initial preload before the memory check');

  await evaluate(`(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '4000px';
    document.querySelector('.ehtw-reader-images').appendChild(spacer);
    window.scrollTo(0, document.documentElement.scrollHeight);
    window.dispatchEvent(new Event('scroll'));
  })()`);
  let memoryReleased = false;
  for (let i = 0; i < 40; i++) {
    await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight); window.dispatchEvent(new Event('scroll'))`);
    memoryReleased = await evaluate(`window.__ehtwMemoryTestImage?.dataset.ehtwMemoryUnloaded === 'true'`);
    if (memoryReleased) break;
    await sleep(200);
  }
  if (!memoryReleased) {
    console.log('MOBILE_MEMORY_DIAGNOSTIC', JSON.stringify(await evaluate(`(() => {
      const image = window.__ehtwMemoryTestImage;
      const rect = image?.getBoundingClientRect();
      return { scrollY, scrollHeight:document.documentElement.scrollHeight, count:document.querySelectorAll('.ehtw-reader-page-image').length, htmlClass:document.documentElement.className, innerWidth, maxTouchPoints:navigator.maxTouchPoints, pointerCoarse:matchMedia('(pointer: coarse)').matches, complete:image?.complete, naturalWidth:image?.naturalWidth, unloaded:image?.dataset.ehtwMemoryUnloaded, source:image?.getAttribute('src'), memorySource:image?.dataset.ehtwMemorySource, rect:rect?.toJSON() };
    })()`)));
  }
  assert.ok(memoryReleased, 'mobile releases image resources after they move well outside the reading area');
  const releasedSource = await evaluate(`window.__ehtwMemoryTestImage?.dataset.ehtwMemorySource || null`);
  assert.ok(releasedSource, 'mobile retains the source URL for an unloaded image');
  await evaluate(`(() => { window.__ehtwMemoryTestImage.scrollIntoView({ block:'start' }); window.dispatchEvent(new Event('scroll')); })()`);
  let memoryRestored = false;
  for (let i = 0; i < 60; i++) {
    memoryRestored = await evaluate(`(() => { const image = window.__ehtwMemoryTestImage; return image?.dataset.ehtwMemoryUnloaded !== 'true' && image?.getAttribute('src') === ${JSON.stringify(releasedSource)}; })()`);
    if (memoryRestored) break;
    await sleep(150);
  }
  if (!memoryRestored) {
    console.log('MOBILE_MEMORY_RESTORE_DIAGNOSTIC', JSON.stringify(await evaluate(`(() => { const image=window.__ehtwMemoryTestImage; return {scrollY,src:image?.getAttribute('src'),source:image?.dataset.ehtwMemorySource,unloaded:image?.dataset.ehtwMemoryUnloaded,loading:image?.parentElement?.className,rect:image?.getBoundingClientRect().toJSON(),htmlClass:document.documentElement.className};})()`)));
  }
  assert.ok(memoryRestored, 'mobile reloads the image when scrolling back to it');
  assert.deepEqual(errors, [], 'no runtime exceptions occur');

  console.log('PASS mobile settings fit the screen without horizontal overflow');
  console.log('PASS mode buttons, page count, and preload input meet touch-size thresholds');
  console.log('PASS mobile settings do not overlap the image');
  console.log('PASS mobile prioritizes the next image ahead of farther preloads');
  console.log('PASS mobile defers preloads until the main document finishes loading');
  console.log('PASS mobile page slider seeks beyond the initial preload');
  console.log('PASS vertical mode keeps zoom and page tools overlaid on the image');
  console.log('PASS mobile releases distant image resources and reloads them when revisited');
  console.log(JSON.stringify(layout));
} finally {
  ws.close();
  await fetch(`${CDP_HTTP}/json/close/${tab.id}`);
}
