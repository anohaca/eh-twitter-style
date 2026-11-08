import { test, expect, open, EH, ui, waitForRoute } from './harness.mjs';

test.use({ preInitScript: 'window.__ehtwHypotheticalResidueEnabled = true;' });

const detailUrl = (g) => `${EH}/g/${g.gid}/${g.token}/`;

async function enter(page, site, kind) {
  const g = site.state.galleries[0];
  if (kind === 'list') await open(page, `${EH}/tag/female%3Aglasses`);
  if (kind === 'detail') await open(page, detailUrl(g));
  if (kind === 'reader') await open(page, site.readerUrl(EH, g, 5));
  if (kind === 'favorites') await open(page, `${EH}/favorites.php`);
  if (kind === 'torrents') await open(page, `${EH}/torrents.php`);
  if (kind === 'toplist') await open(page, `${EH}/toplist.php`);
  if (kind === 'account') await open(page, `${EH}/home.php`);
  await page.waitForFunction(() => window.__EHTW_SPA_READY__ === true);
  await page.evaluate(() => { window.__ehtwResidueDocument = `${Date.now()}-${Math.random()}`; });
  return { g, documentId: await page.evaluate(() => window.__ehtwResidueDocument) };
}

async function switchRoute(page, path, cls) {
  await page.evaluate(async (target) => window.__EHTW_SPA_NAVIGATE__(target), path);
  await waitForRoute(page, (url) => url.pathname === new URL(path, EH).pathname, cls);
  await expect(ui(page).locator('#ehtw-shell')).toBeAttached();
}

for (const cacheEnabled of [true, false]) {
  test.describe(`hypothetical native route residue, cache ${cacheEnabled ? 'on' : 'off'}`, () => {
    test.beforeEach(async ({ page }) => {
      await open(page, `${EH}/#ehtw-nocache-${cacheEnabled ? 'off' : 'on'}`);
      await page.evaluate((enabled) => {
        localStorage.setItem('ehtw-spa-suspend-cache-enabled-v1', enabled ? '1' : '0');
        localStorage.setItem('ehtw-navigation-log-enabled-v1', '1');
      }, cacheEnabled);
      await page.reload();
    });

    for (const kind of ['list', 'detail', 'reader', 'favorites', 'torrents', 'toplist', 'account']) {
      test(`hypothetical ${kind} handlers and timers do not survive a SPA route change`, async ({ page, site, diagnostics }, testInfo) => {
        const { g, documentId } = await enter(page, site, kind);
        const docCount = diagnostics.documentNavigations.length;
        const priorCallCount = await page.evaluate(() => window.__nativeCalls.length);
        const targetPath = kind === 'list' ? `/g/${g.gid}/${g.token}/` : '/popular';
        await switchRoute(page, targetPath, kind === 'list' ? 'ehtw-detail' : 'ehtw-list');

        if (kind === 'list') {
          const callsBeforeEvent = await page.evaluate(() => window.__nativeCalls.filter((x) => x.name === 'hypothetical_list_hashchange').length);
          await page.evaluate(() => { location.hash = '#residue-probe'; });
          await page.waitForTimeout(100);
          expect(await page.evaluate((baseline) => window.__nativeCalls.filter((x) => x.name === 'hypothetical_list_hashchange').length - baseline, callsBeforeEvent)).toBe(0);
        } else if (kind === 'detail') {
          const callsBeforeEvent = await page.evaluate(() => window.__nativeCalls.filter((x) => x.name === 'hypothetical_detail_resize' || x.name === 'hypothetical_detail_scroll').length);
          await page.evaluate(() => { window.dispatchEvent(new Event('resize')); document.dispatchEvent(new Event('scroll')); });
          const callsAfterEvent = await page.evaluate(() => window.__nativeCalls.filter((x) => x.name === 'hypothetical_detail_resize' || x.name === 'hypothetical_detail_scroll').length);
          expect(callsAfterEvent - callsBeforeEvent, 'detail handlers from the departed route must be removed').toBe(0);
        } else if (kind === 'reader') {
          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(100);
          expect(await page.evaluate(() => window.__nativeCalls.some((x) => x.name === 'hypothetical_reader_key'))).toBe(false);
        }

        const sourceInterval = { list: 'hypothetical_list_interval', detail: 'hypothetical_detail_interval', reader: 'hypothetical_reader_interval', favorites: 'hypothetical_favorites_interval', torrents: 'hypothetical_torrents_interval', toplist: 'hypothetical_toplist_interval', account: 'hypothetical_account_interval' }[kind];
        const intervalBaseline = sourceInterval
          ? await page.evaluate((name) => window.__nativeCalls.filter((x) => x.name === name).length, sourceInterval)
          : 0;
        await page.waitForTimeout(2100);
        if (sourceInterval) {
          expect(await page.evaluate(({ name, baseline }) => window.__nativeCalls.filter((x) => x.name === name).length - baseline, { name: sourceInterval, baseline: intervalBaseline })).toBe(0);
        }
        expect(diagnostics.documentNavigations, 'route changes stay in this document').toHaveLength(docCount);
        expect(await page.evaluate(() => window.__ehtwResidueDocument)).toBe(documentId);
        expect(new URL(page.url()).pathname).toBe(targetPath);
        await expect(ui(page).locator('#ehtw-shell')).toBeVisible();
        await expect(ui(page).locator(kind === 'list' ? '#gn' : '.ehtw-tweet, .ehtw-timeline').first()).toBeAttached();
        const navEvents = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
        expect(navEvents.some((entry) => entry.event === 'page-world-route-global-handlers' && entry.listeners && entry.onHandlers)).toBe(true);
      });
    }
  });
}

test('real ehg_show keyboard handler does not double navigate inside our reader', async ({ page, site, diagnostics }) => {
  await open(page, site.readerUrl(EH, site.state.galleries[0], 5));
  await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]');
  const initialUrl = page.url();
  const docCount = diagnostics.documentNavigations.length;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => typeof window.load_image)).toBe('function');
  expect(diagnostics.documentNavigations).toHaveLength(docCount);
  expect(new URL(page.url()).pathname).toMatch(/^\/s\//);
  expect(page.url()).toBe(initialUrl);
  await expect(ui(page).locator('.ehtw-reader-root')).toBeVisible();
});
