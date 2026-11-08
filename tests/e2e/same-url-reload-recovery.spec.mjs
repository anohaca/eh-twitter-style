import { test, expect, open, EH, ui, tap, waitForRoute, settle } from './harness.mjs';

test.use({ preInitScript: `
  if (sessionStorage.getItem('__ehtw_same_url_reload_recovery') === '1') {
    sessionStorage.removeItem('__ehtw_same_url_reload_recovery');
    history.replaceState({ ehtwSpa: true, ehtwEntryId: 'same-url-reload-test', ehtwScrollY: 1450 }, '', location.href);
  }
` });

async function simulateSameUrlNavigateReload(page, url) {
  await page.evaluate(() => sessionStorage.setItem('__ehtw_same_url_reload_recovery', '1'));
  await page.goto(url, { referer: url, waitUntil: 'load' });
}

test('same-URL navigate reload restores SPA list scroll with matching referrer', async ({ page }) => {
  const url = `${EH}/popular`;
  await open(page, url);
  await page.evaluate(() => {
    history.replaceState({ ...history.state, ehtwSpa: true, ehtwEntryId: 'same-url-list', ehtwScrollY: 1450 }, '', location.href);
  });
  await simulateSameUrlNavigateReload(page, url);
  await waitForRoute(page, (current) => current.pathname === '/popular', 'ehtw-list');
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(1000);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.type)).toBe('navigate');
  expect(await page.evaluate(() => new URL(document.referrer).pathname)).toBe('/popular');
});

test('same-URL navigate reload restores SPA detail scroll', async ({ page, site }) => {
  const gallery = site.state.galleries[2];
  const url = `${EH}/g/${gallery.gid}/${gallery.token}/`;
  await open(page, url);
  await page.evaluate(() => {
    history.replaceState({ ...history.state, ehtwSpa: true, ehtwEntryId: 'same-url-detail', ehtwScrollY: 200 }, '', location.href);
  });
  await simulateSameUrlNavigateReload(page, url);
  await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(180);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.type)).toBe('navigate');
});

test('nocache switch sends Back through fetch instead of a suspended-page resume', async ({ page, site }, testInfo) => {
  await open(page, `${EH}/#ehtw-nocache-on`);
  await page.reload(); // read the persisted switch on a clean document start
  await page.goto(`${EH}/#ehtw-navlog-on`);
  await page.reload(); // the diagnostic switch is also read at document start
  await settle(page, 250);
  const gallery = site.state.galleries[3];
  const title = ui(page).locator(`.ehtw-tweet[data-ehtw-href="${EH}/g/${gallery.gid}/${gallery.token}/"] .ehtw-tweet-title .glink`);
  await tap(page, testInfo, title);
  await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
  await page.evaluate(() => history.back());
  await waitForRoute(page, (current) => current.pathname === '/', 'ehtw-list');
  const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
  expect(events.some((entry) => entry.event === 'navigation-log-enabled' && entry.suspendCache === 'off')).toBe(true);
  expect(events.some((entry) => entry.event === 'navigate-finish' && entry.mode === 'pop' && entry.outcome === 'resumed-suspended-page')).toBe(false);
  expect(events.some((entry) => entry.event === 'navigate-finish' && entry.mode === 'pop' && entry.outcome === 'rendered')).toBe(true);
});
