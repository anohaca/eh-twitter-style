import { test, expect, open, EH, ui, tap, waitForRoute, settle } from './harness.mjs';

const detailUrl = (g) => `${EH}/g/${g.gid}/${g.token}/`;
const supportsGestureMatrix = (testInfo) => ['webkit-iphone-13', 'iphone-13-chromium'].includes(testInfo.project.name);
const skipOutsideGestureMatrix = (testInfo) => test.skip(!supportsGestureMatrix(testInfo), 'Safari-like navigation race matrix runs on WebKit iPhone and iPhone Chromium');

async function expectRouteDom(page, pathPattern) {
  await expect.poll(() => page.evaluate(() => ({
    path: location.pathname,
    title: document.querySelector('#gn')?.textContent || '',
    detail: !!document.querySelector('#gmid'),
    reader: !!document.querySelector('.ehtw-reader-root'),
    list: document.documentElement.classList.contains('ehtw-list'),
    pending: document.documentElement.classList.contains('ehtw-navigation-pending'),
    shells: document.querySelectorAll('#ehtw-shell').length
  }))).toMatchObject({ pending: false, shells: 1 });
  const state = await page.evaluate(() => ({
    path: location.pathname,
    title: document.querySelector('#gn')?.textContent || '',
    detail: !!document.querySelector('#gmid'),
    reader: !!document.querySelector('.ehtw-reader-root'),
    list: document.documentElement.classList.contains('ehtw-list'),
    pending: document.documentElement.classList.contains('ehtw-navigation-pending'),
    shells: document.querySelectorAll('#ehtw-shell').length
  }));
  expect(state.path).toMatch(pathPattern);
  expect(state.pending).toBe(false);
  expect(state.shells).toBe(1);
  if (/^\/g\//.test(state.path)) expect(state.detail).toBe(true);
  if (/^\/s\//.test(state.path)) expect(state.reader).toBe(true);
  if (state.path === '/') expect(state.list).toBe(true);
  return state;
}

test('popstate and the next 250ms reconcile tick do not fetch or render the Back destination twice', async ({ page, site, diagnostics }, testInfo) => {
  skipOutsideGestureMatrix(testInfo);
  await open(page, `${EH}/#ehtw-navlog-on`);
  const g = site.state.galleries[2];
  await tap(page, testInfo, ui(page).locator(`.ehtw-tweet[data-ehtw-href="${detailUrl(g)}"] .ehtw-tweet-title .glink`));
  await waitForRoute(page, new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
  await page.reload(); // discard the suspended list so Back takes the slow fetch path
  await waitForRoute(page, new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
  site.state.faults.push({ name: 'slow-back-list', path: '/', type: 'fetch', delayMs: 700, times: 1 });
  const documentCount = diagnostics.documentNavigations.length;
  const beforeListRequestCount = site.state.log.filter((request) => new URL(request.url).pathname === '/').length;
  await page.goBack();
  await expect.poll(() => site.state.log.filter((request) => request.fault === 'slow-back-list').length).toBeGreaterThan(0);
  // This call is the same destination reconcileSpa would request on its next
  // tick; while popstate's fetch is pending the router must coalesce it.
  await page.evaluate(() => window.__EHTW_SPA_NAVIGATE__(location.href, {
    historyMode: 'pop', scrollY: Number(history.state?.ehtwScrollY) || 0
  }));
  await page.waitForTimeout(900);
  const state = await expectRouteDom(page, /^\/$/);
  expect(state.list).toBe(true);
  const backListRequests = site.state.log.filter((request) => new URL(request.url).pathname === '/').length - beforeListRequestCount;
  // A delayed mock request is logged once when faulted and once when served.
  expect(backListRequests).toBe(2);
  const navigationEvents = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
  expect(navigationEvents.filter((entry) => entry.event === 'navigate-start' && entry.mode === 'pop' && entry.target === `${EH}/`)).toHaveLength(1);
  expect(navigationEvents.some((entry) => entry.event === 'reconcile-skipped' && entry.reason === 'navigation-in-progress')).toBe(true);
  expect(diagnostics.documentNavigations).toHaveLength(documentCount);
  const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
  expect(events.some((entry) => entry.event === 'popstate')).toBe(true);
  expect(events.some((entry) => entry.event === 'pendingSpaPop-queued' && entry.input === 'pop')).toBe(true);
});

test('a cancelled URL-only edge gesture returns to the current route without rendering the transient address', async ({ page, site, diagnostics }, testInfo) => {
  skipOutsideGestureMatrix(testInfo);
  await open(page, `${EH}/#ehtw-navlog-on`);
  const g = site.state.galleries[1];
  const link = ui(page).locator(`.ehtw-tweet[data-ehtw-href="${detailUrl(g)}"] .ehtw-tweet-title .glink`);
  await tap(page, testInfo, link);
  await waitForRoute(page, new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
  const current = page.url();
  const documentCount = diagnostics.documentNavigations.length;
  await page.evaluate((prior) => {
    const state = history.state;
    history.replaceState(state, '', '/');
    setTimeout(() => history.replaceState(state, '', prior), 120);
  }, current);
  await page.waitForTimeout(800);
  expect(page.url()).toBe(current);
  const state = await expectRouteDom(page, new RegExp(`/g/${g.gid}/`));
  expect(state.title).toBe(g.title);
  expect(diagnostics.documentNavigations).toHaveLength(documentCount);
});

test('a URL-only Back reconciliation preserves the next real Back level', async ({ page, site, diagnostics }, testInfo) => {
  skipOutsideGestureMatrix(testInfo);
  await open(page, `${EH}/`);
  const g = site.state.galleries[1];
  const title = ui(page).locator(`.ehtw-tweet[data-ehtw-href="${detailUrl(g)}"] .ehtw-tweet-title .glink`);
  await title.scrollIntoViewIfNeeded();
  await settle(page, 250);
  const previousY = await page.evaluate(() => Math.round(scrollY));
  await tap(page, testInfo, ui(page).locator(`.ehtw-tweet[data-ehtw-href="${detailUrl(g)}"] .ehtw-tweet-title .glink`));
  await waitForRoute(page, new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
  const documents = diagnostics.documentNavigations.length;
  await page.evaluate((href) => history.replaceState(history.state, '', href), `${EH}/popular`);
  await waitForRoute(page, (url) => url.pathname === '/popular', 'ehtw-list');
  expect(await page.evaluate(() => document.documentElement.classList.contains('ehtw-list'))).toBe(true);
  expect(await page.locator('#gmid').count()).toBe(0);
  await page.goBack();
  await waitForRoute(page, (url) => url.pathname === '/', 'ehtw-list');
  expect(await page.evaluate(() => document.documentElement.classList.contains('ehtw-list'))).toBe(true);
  expect(await page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(previousY - 100);
  expect(await page.evaluate(() => Math.round(scrollY))).toBeLessThan(previousY + 100);
  expect(diagnostics.documentNavigations).toHaveLength(documents);
});

test('two fast Back inputs through a reloaded reader end on the list with its saved scroll', async ({ page, site, diagnostics }, testInfo) => {
  skipOutsideGestureMatrix(testInfo);
  await open(page, `${EH}/#ehtw-navlog-on`);
  const g = site.state.galleries[2];
  await page.evaluate(() => window.scrollTo(0, 1200));
  await settle(page, 300);
  const listScroll = await page.evaluate(() => Math.round(scrollY));
  await page.evaluate((href) => window.__EHTW_SPA_NAVIGATE__(href, { historyMode: 'push' }), detailUrl(g));
  await waitForRoute(page, new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
  await tap(page, testInfo, ui(page).locator('#gdt a').first());
  await waitForRoute(page, new RegExp(`/s/`), 'ehtw-reader');
  await page.reload();
  await waitForRoute(page, new RegExp(`/s/`), 'ehtw-reader');
  site.state.faults.push({ name: 'slow-back-detail', path: `/g/${g.gid}/${g.token}/`, type: 'fetch', delayMs: 700, times: 1 });
  const documentCount = diagnostics.documentNavigations.length;
  await page.evaluate(() => history.back());
  await page.waitForTimeout(100);
  await page.evaluate(() => history.back());
  await page.waitForTimeout(1200);
  const state = await expectRouteDom(page, /^\/$/);
  expect(state.list).toBe(true);
  await expect.poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 5000 }).toBeGreaterThan(listScroll - 100);
  expect(await page.evaluate(() => Math.round(scrollY))).toBeLessThan(listScroll + 100);
  expect(diagnostics.documentNavigations).toHaveLength(documentCount);
  const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
  expect(events.some((entry) => entry.event === 'reader-history-replace-skipped' && entry.reason === 'reader-route-is-no-longer-current')).toBe(true);
});

test('cross-document Back records pageshow persisted state and restores the SPA list', async ({ page, site, diagnostics }, testInfo) => {
  skipOutsideGestureMatrix(testInfo);
  await open(page, `${EH}/#ehtw-navlog-on`);
  await page.evaluate(() => window.scrollTo(0, 900));
  await settle(page, 250);
  const previousY = await page.evaluate(() => Math.round(scrollY));
  const documentCount = diagnostics.documentNavigations.length;
  await page.evaluate(() => { location.href = `${location.origin}/uconfig.php`; });
  await expect.poll(() => new URL(page.url()).pathname).toBe('/uconfig.php');
  await page.goBack();
  await waitForRoute(page, (url) => url.pathname === '/', 'ehtw-list');
  const state = await expectRouteDom(page, /^\/$/);
  expect(state.list).toBe(true);
  const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
  const returnPageshow = events.filter((entry) => entry.event === 'pageshow').at(-1);
  expect(returnPageshow).toBeTruthy();
  expect(typeof returnPageshow.persisted).toBe('boolean');
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(previousY - 80);
  expect(await page.evaluate(() => Math.round(scrollY))).toBeLessThan(previousY + 80);
  expect(diagnostics.documentNavigations.length).toBeGreaterThan(documentCount);
});

