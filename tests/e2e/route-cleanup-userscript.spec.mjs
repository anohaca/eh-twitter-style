import { test, expect, open, EH, ui, waitForRoute, settle } from './harness.mjs';

test.use({ preInitScript: 'window.__ehtwHypotheticalResidueEnabled = true;' });

const events = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));

test('hypothetical route cleanup preserves userscript listeners, poll, and reader keys', async ({ page, site, diagnostics }) => {
  await open(page, `${EH}/#ehtw-navlog-on`);
  await page.evaluate(() => localStorage.setItem('ehtw-navigation-log-enabled-v1', '1'));
  await page.reload();
  await waitForRoute(page, (url) => url.pathname === '/', 'ehtw-list');
  const docCount = diagnostics.documentNavigations.length;
  const gallery = site.state.galleries[0];

  // First SPA transition must remove the mock site's route residue while its
  // own native popstate diagnostic and userscript navigation logging survive.
  await page.evaluate(() => window.__EHTW_SPA_NAVIGATE__('/popular'));
  await waitForRoute(page, (url) => url.pathname === '/popular', 'ehtw-list');
  await page.evaluate(() => history.pushState({ probe: true }, '', '/watched'));
  await waitForRoute(page, (url) => url.pathname === '/watched', 'ehtw-list');
  await settle(page, 300);
  await page.evaluate(() => {
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    const anchor = document.createElement('a');
    anchor.href = '#navlog-click-probe';
    document.body.appendChild(anchor);
    anchor.click();
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const afterRoutes = await events(page);
  const cleanup = afterRoutes.filter((entry) => entry.event === 'page-world-route-cleanup');
  expect(cleanup.length).toBeGreaterThanOrEqual(2);
  // The snapshot's real ehg_index.c.js contributes beforeunload cleanup in
  // addition to the two opt-in hypothetical listeners.
  expect(cleanup[0].removedWindowDocumentListeners).toBe(3);
  expect(cleanup[0].removedListenerSources).toHaveLength(3);
  expect(cleanup[0].removedListenerSources.some((source) => source.includes('hypothetical_list_hashchange'))).toBe(true);
  expect(cleanup[0].removedListenerSources.some((source) => source.includes('ehtw-ad-frame-ready'))).toBe(true);
  expect(cleanup[0].removedListenerSources.some((source) => source.includes('hide_image_pane'))).toBe(true);
  expect(cleanup[0].clearedIntervals).toBe(1);
  expect(afterRoutes.filter((entry) => entry.event === 'page-world-popstate').length).toBeGreaterThanOrEqual(2);
  expect(afterRoutes.some((entry) => entry.event === 'default-anchor-navigation' && entry.targetPath === '/watched')).toBe(true);
  expect(afterRoutes.some((entry) => entry.event === 'visibilitychange')).toBe(true);
  expect(diagnostics.documentNavigations).toHaveLength(docCount);

  // The 250ms reconciliation path handles a URL changed without popstate.
  await page.evaluate(() => history.pushState({ probe: 'poll' }, '', '/popular'));
  await expect.poll(() => page.locator('.ehtw-tweet').count()).toBeGreaterThan(0);
  await waitForRoute(page, (url) => url.pathname === '/popular', 'ehtw-list');

  // Reader key paging works on a direct load and after an SPA transition.
  await page.evaluate(() => localStorage.setItem('ehtw-reader-mode-v1', 'click'));
  const directReader = site.readerUrl(EH, gallery, 5);
  await open(page, directReader);
  const directDocCount = diagnostics.documentNavigations.length;
  await page.keyboard.press('ArrowRight');
  await expect(ui(page).locator('.ehtw-reader-root')).toHaveAttribute('data-ehtw-reader-ready', 'true');
  await expect.poll(() => page.locator('.ehtw-reader-page-count').innerText()).not.toContain('5 /');
  expect(diagnostics.documentNavigations).toHaveLength(directDocCount);
  expect(page.url()).toContain('/s/');

  await page.evaluate(() => window.__EHTW_SPA_NAVIGATE__('/'));
  await waitForRoute(page, (url) => url.pathname === '/', 'ehtw-list');
  await page.evaluate((path) => window.__EHTW_SPA_NAVIGATE__(path), site.readerUrl(EH, gallery, 5));
  await waitForRoute(page, (url) => url.pathname.startsWith('/s/'), 'ehtw-reader');
  const spaReaderDocCount = diagnostics.documentNavigations.length;
  const currentPage = await page.locator('.ehtw-reader-page-count').innerText();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('.ehtw-reader-page-count').innerText()).not.toBe(currentPage);
  expect(diagnostics.documentNavigations).toHaveLength(spaReaderDocCount);
});
