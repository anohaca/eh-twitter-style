import { test, expect, open, EH, ui, tap, waitForRoute, settle } from './harness.mjs';

const supportedProjects = new Set(['webkit-iphone-13', 'iphone-13-chromium']);
const onlySafariLikeProjects = (testInfo) => test.skip(
  !supportedProjects.has(testInfo.project.name),
  'realistic Back regression coverage is limited to WebKit iPhone and iPhone Chromium'
);
const detailUrl = (gallery) => `${EH}/g/${gallery.gid}/${gallery.token}/`;
const detailTitle = (page, gallery) => ui(page)
  .locator(`.ehtw-tweet[data-ehtw-href="${detailUrl(gallery)}"] .ehtw-tweet-title .glink`);

async function openReader(page, testInfo, gallery) {
  await tap(page, testInfo, detailTitle(page, gallery));
  await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
  await tap(page, testInfo, ui(page).locator('#gdt a').first());
  await waitForRoute(page, new RegExp(`/s/`), 'ehtw-reader');
}

test('failed reader Back pop replaces the current entry and preserves Forward', async ({ page, site, diagnostics }, testInfo) => {
  onlySafariLikeProjects(testInfo);
  await open(page, `${EH}/#ehtw-navlog-on`);
  const gallery = site.state.galleries[5];
  await openReader(page, testInfo, gallery);
  await page.reload(); // eliminate the in-memory suspended detail so this exercises fallback
  await waitForRoute(page, new RegExp(`/s/`), 'ehtw-reader');

  let abortedFetches = 0;
  await page.route((url) => url.href === detailUrl(gallery), async (route) => {
    if (route.request().resourceType() === 'fetch' && abortedFetches < 2) {
      abortedFetches += 1;
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });
  const historyLengthBeforeBack = await page.evaluate(() => history.length);
  const documentsBeforeBack = diagnostics.documentNavigations.length;
  await page.evaluate(() => history.back());
  await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail', null, 15_000);

  expect(abortedFetches, 'both SPA pop fetch attempts were aborted offline').toBe(2);
  expect(await page.evaluate(() => history.length), 'pop fallback must replace the active entry').toBe(historyLengthBeforeBack);
  expect(diagnostics.documentNavigations.length).toBe(documentsBeforeBack + 1);
  await expect(ui(page).locator('#gn')).toHaveText(gallery.title);
  const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
  expect(events.some((entry) => entry.event === 'navigate-fallback' && entry.mode === 'pop' && entry.historyPrepared === false)).toBe(true);

  await page.goForward();
  await waitForRoute(page, new RegExp(`/s/`), 'ehtw-reader', null, 15_000);
  expect(page.url()).toContain(`/s/`);
});

test('reader Back restores the suspended detail without fetching it again', async ({ page, site, diagnostics }, testInfo) => {
  onlySafariLikeProjects(testInfo);
  await open(page, `${EH}/#ehtw-navlog-on`);
  const gallery = site.state.galleries[6];
  await openReader(page, testInfo, gallery);
  const detailRequestsBeforeBack = site.state.log.filter((request) =>
    new URL(request.url).pathname === `/g/${gallery.gid}/${gallery.token}/`
  ).length;
  const documentsBeforeBack = diagnostics.documentNavigations.length;

  await page.evaluate(() => history.back());
  await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
  expect(await ui(page).locator('#gn')).toHaveText(gallery.title);
  expect(site.state.log.filter((request) =>
    new URL(request.url).pathname === `/g/${gallery.gid}/${gallery.token}/`
  )).toHaveLength(detailRequestsBeforeBack);
  expect(diagnostics.documentNavigations).toHaveLength(documentsBeforeBack);
  const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
  expect(events.some((entry) => entry.event === 'navigate-finish' && entry.mode === 'pop' && entry.outcome === 'resumed-suspended-page')).toBe(true);
});

test('restoring cached reader history does not trigger a later document navigation', async ({ page, site, diagnostics }, testInfo) => {
  onlySafariLikeProjects(testInfo);
  await open(page, `${EH}/#ehtw-navlog-on`);
  const documentCountAtStart = diagnostics.documentNavigations.length;
  const documentInstance = await page.evaluate(() => {
    window.__ehtwDocumentInstance = `${Date.now()}-${Math.random()}`;
    return window.__ehtwDocumentInstance;
  });

  await tap(page, testInfo, ui(page).locator('#nb a[href$="/popular"]').first());
  await waitForRoute(page, (url) => url.pathname === '/popular', 'ehtw-list');
  const gallery = site.state.galleries[4];
  await tap(page, testInfo, detailTitle(page, gallery));
  await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
  await tap(page, testInfo, ui(page).locator('#gdt a').first());
  await waitForRoute(page, new RegExp(`/s/`), 'ehtw-reader');

  await page.evaluate(() => history.back());
  await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
  await page.evaluate(() => history.back());
  await waitForRoute(page, (url) => url.pathname === '/popular', 'ehtw-list');
  await page.waitForTimeout(1500);

  expect(diagnostics.documentNavigations, 'two cache restores stay in the original document').toHaveLength(documentCountAtStart);
  expect(await page.evaluate(() => window.__ehtwDocumentInstance)).toBe(documentInstance);
  const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
  expect(events.some((entry) => entry.event === 'suspended-nodes-reinsert' && entry.counts.iframe > 0)).toBe(true);
  expect(events.some((entry) => entry.event === 'navigate-finish' && entry.outcome === 'resumed-suspended-page')).toBe(true);
  expect(events.some((entry) => entry.event === 'api-history-back' && entry.stack?.length <= 800)).toBe(true);
  expect(events.find((entry) => entry.event === 'document-navigation-entry')).toHaveProperty('type');
});

test('scroll history replaceState is debounced during continuous scrolling', async ({ page }, testInfo) => {
  onlySafariLikeProjects(testInfo);
  await open(page, `${EH}/`);
  await settle(page, 350);
  await page.evaluate(() => {
    const nativeReplaceState = history.replaceState.bind(history);
    window.__ehtwReplaceStateCalls = [];
    history.replaceState = (...args) => {
      window.__ehtwReplaceStateCalls.push(performance.now());
      return nativeReplaceState(...args);
    };
  });
  const finalY = await page.evaluate(async () => {
    for (let index = 0; index < 40; index += 1) {
      window.scrollTo(0, 300 + index * 24);
      window.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return Math.round(window.scrollY);
  });
  await page.waitForTimeout(350);
  const callCount = await page.evaluate(() => window.__ehtwReplaceStateCalls.length);
  expect(finalY).toBeGreaterThan(300);
  expect(callCount, '40 scrolling updates in one second cause at most three history writes').toBeLessThanOrEqual(3);
  expect(callCount, 'the settled position is written to the active history entry').toBeGreaterThan(0);
});

test('left-edge touch blocks history writes until the quiet window ends', async ({ page }, testInfo) => {
  onlySafariLikeProjects(testInfo);
  await open(page, `${EH}/`);
  await settle(page, 300);
  const result = await page.evaluate(async () => {
    const nativeReplaceState = history.replaceState.bind(history);
    window.__ehtwReplaceStateCalls = [];
    history.replaceState = (...args) => {
      window.__ehtwReplaceStateCalls.push(performance.now());
      return nativeReplaceState(...args);
    };
    const touch = { identifier: 731, clientX: 12, clientY: 200 };
    const dispatchTouch = (type) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'changedTouches', { value: [touch] });
      document.dispatchEvent(event);
    };
    dispatchTouch('touchstart');
    for (let index = 0; index < 12; index += 1) {
      window.scrollTo(0, 400 + index * 30);
      window.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const callsDuringGesture = window.__ehtwReplaceStateCalls.length;
    dispatchTouch('touchend');
    await new Promise((resolve) => setTimeout(resolve, 450));
    return { callsDuringGesture, callsAfterQuiet: window.__ehtwReplaceStateCalls.length };
  });
  expect(result.callsDuringGesture, 'edge touch and scroll inertia never rewrite history').toBe(0);
  expect(result.callsAfterQuiet, 'pending scroll is saved once after touchend quiet time').toBe(1);
});

test('empty history.state on a detail entry recovers the suspended detail on Back', async ({ page, site, diagnostics }, testInfo) => {
  onlySafariLikeProjects(testInfo);
  await open(page, `${EH}/#ehtw-navlog-on`);
  const gallery = site.state.galleries[7];
  await tap(page, testInfo, detailTitle(page, gallery));
  await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
  await page.evaluate(() => {
    const nativePushState = history.pushState.bind(history);
    const nativeReplaceState = history.replaceState.bind(history);
    history.pushState = (state, title, href) => {
      if (new URL(href, location.href).pathname.startsWith('/s/')) {
        nativeReplaceState({}, '', location.href); // simulate the site clobbering the leaving entry state
      }
      return nativePushState(state, title, href);
    };
  });
  await tap(page, testInfo, ui(page).locator('#gdt a').first());
  await waitForRoute(page, new RegExp(`/s/`), 'ehtw-reader');
  const detailUrlBeforeBack = detailUrl(gallery);
  const detailRequestsBeforeBack = site.state.log.filter((request) =>
    new URL(request.url).pathname === `/g/${gallery.gid}/${gallery.token}/`
  ).length;

  await page.evaluate(() => history.back());
  await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
  expect(page.url()).toBe(detailUrlBeforeBack);
  await expect(ui(page).locator('#gn')).toHaveText(gallery.title);
  expect(site.state.log.filter((request) =>
    new URL(request.url).pathname === `/g/${gallery.gid}/${gallery.token}/`
  )).toHaveLength(detailRequestsBeforeBack);
  const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
  expect(events.some((entry) => entry.event === 'popstate' && entry.stateRecovered === true)).toBe(true);
  await expect.poll(() => page.evaluate(() => !!history.state?.ehtwSpa && !!history.state?.ehtwEntryId), { timeout: 2000 }).toBe(true);
  expect(diagnostics.documentNavigations).toHaveLength(1);
});

test('restored scroll is not overwritten by a zero scroll event', async ({ page, site }, testInfo) => {
  onlySafariLikeProjects(testInfo);
  await open(page, `${EH}/#ehtw-navlog-on`);
  const gallery = site.state.galleries[8];
  const title = detailTitle(page, gallery);
  await title.scrollIntoViewIfNeeded();
  await settle(page, 250);
  const requestedScrollY = await page.evaluate(() => Math.round(window.scrollY));
  expect(requestedScrollY).toBeGreaterThan(300);
  await tap(page, testInfo, title);
  await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
  await page.evaluate(() => history.back());
  await expect(page.locator('html.ehtw-list')).toBeAttached();
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(requestedScrollY - 100);

  await page.evaluate((targetY) => {
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event('scroll'));
    setTimeout(() => {
      window.scrollTo(0, targetY);
      window.dispatchEvent(new Event('scroll'));
    }, 100);
  }, requestedScrollY);
  await page.waitForTimeout(1000);
  const saved = await page.evaluate(() => ({
    href: location.href,
    stateY: Number(history.state?.ehtwScrollY) || 0,
    sessionY: Number(sessionStorage.getItem(`ehtw-scroll-v1:${location.href}`)) || 0,
    events: JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]')
  }));
  expect(saved.stateY).toBeGreaterThan(requestedScrollY - 100);
  expect(saved.sessionY).toBeGreaterThan(requestedScrollY - 100);
  const restoreFinishedAt = saved.events.filter((entry) => entry.event === 'scroll-restore-finish').at(-1)?.timeMs || 0;
  expect(saved.events.filter((entry) => entry.event === 'scroll-save' && entry.timeMs >= restoreFinishedAt && entry.scrollY === 0)).toEqual([]);
});

test('replaceState SecurityError is recorded in navigation diagnostics', async ({ page }, testInfo) => {
  onlySafariLikeProjects(testInfo);
  await open(page, `${EH}/#ehtw-navlog-on`);
  await settle(page, 300);
  await page.evaluate(async (href) => {
    history.replaceState = () => { throw new DOMException('history rate limit', 'SecurityError'); };
    await window.__EHTW_SPA_NAVIGATE__(href, { historyMode: 'push' });
  }, `${EH}/popular`);
  await waitForRoute(page, (url) => url.pathname === '/popular', 'ehtw-list');
  await expect.poll(() => page.evaluate(() => {
    const entries = JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]');
    return entries.some((entry) => entry.event === 'history-replace-state-error' && entry.errorName === 'SecurityError' && entry.source === 'scroll-navigate-before');
  })).toBe(true);
});
