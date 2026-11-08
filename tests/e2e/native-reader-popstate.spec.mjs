import { test, expect, open, EH, ui, tap, waitForRoute } from './harness.mjs';

const detailUrl = (gallery) => `${EH}/g/${gallery.gid}/${gallery.token}/`;
const detailTitle = (page, gallery) => ui(page)
  .locator(`.ehtw-tweet[data-ehtw-href="${detailUrl(gallery)}"] .ehtw-tweet-title .glink`);

for (const cacheEnabled of [true, false]) {
  test(`hypothetical leaving the native reader does not reload later Back routes (cache ${cacheEnabled ? 'on' : 'off'})`, async ({ page, site, diagnostics }, testInfo) => {
    await page.addInitScript(() => { window.__ehtwHypotheticalResidueEnabled = true; });
    await open(page, `${EH}/`);
    await page.evaluate(({ cacheEnabled }) => {
      localStorage.setItem('ehtw-navigation-log-enabled-v1', '1');
      localStorage.setItem('ehtw-spa-suspend-cache-enabled-v1', cacheEnabled ? '1' : '0');
    }, { cacheEnabled });
    await page.reload();
    await waitForRoute(page, (url) => url.pathname === '/', 'ehtw-list');
    await page.evaluate(() => { window.__nativePopstateDocument = `${Date.now()}-${Math.random()}`; });
    const instance = await page.evaluate(() => window.__nativePopstateDocument);
    const documentCount = diagnostics.documentNavigations.length;

    await tap(page, testInfo, ui(page).locator('#nb a[href$="/popular"]').first());
    await waitForRoute(page, (url) => url.pathname === '/popular', 'ehtw-list');
    const gallery = site.state.galleries[0];
    await tap(page, testInfo, detailTitle(page, gallery));
    await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
    await tap(page, testInfo, ui(page).locator('#gdt a').first());
    await waitForRoute(page, new RegExp(`/s/`), 'ehtw-reader');
    expect(await page.evaluate(() => String(window.onpopstate))).toMatch(/document\.location\s*=\s*document\.location/);
    await page.evaluate(() => history.back());
    await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
    await expect(ui(page).locator('#gn')).toHaveText(gallery.title);
    expect(await page.evaluate(() => window.onpopstate == null)).toBe(true);
    await page.evaluate(() => history.back());
    await waitForRoute(page, (url) => url.pathname === '/popular', 'ehtw-list');
    await page.waitForTimeout(1500);

    expect(diagnostics.documentNavigations, 'the Back chain remains in the original document').toHaveLength(documentCount);
    expect(await page.evaluate(() => window.__nativePopstateDocument)).toBe(instance);
    await expect(ui(page).locator('.ehtw-tweet').first()).toBeAttached();
    expect(page.url()).toContain('/popular');
    const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
    expect(await page.evaluate(() => window.__nativeCalls.some((entry) => entry.name === 'hypothetical_reader_popstate_registered'))).toBe(true);
    expect(events.some((entry) => entry.event === 'document-navigation-entry')).toBe(true);
    // The fixture now loads the captured scripts before body inline code, so
    // this opt-in synthetic assignment is verified directly by its handler
    // source above; page-world setter telemetry is not the behavior under test.
    expect(events.some((entry) => entry.event === 'page-world-reader-cleanup' && entry.onpopstateCleared === true && entry.removedWindowPopstateListeners === 0)).toBe(true);
  });

  test(`real ehg_show popstate clears cleanly after SPA reader departure (cache ${cacheEnabled ? 'on' : 'off'})`, async ({ page, site, diagnostics }, testInfo) => {
    await open(page, `${EH}/`);
    await page.evaluate((enabled) => {
      localStorage.setItem('ehtw-navigation-log-enabled-v1', '1');
      localStorage.setItem('ehtw-spa-suspend-cache-enabled-v1', enabled ? '1' : '0');
    }, cacheEnabled);
    await page.reload();
    await waitForRoute(page, (url) => url.pathname === '/', 'ehtw-list');
    const docCount = diagnostics.documentNavigations.length;
    const callsBefore = site.state.showpageCalls.length;
    const gallery = site.state.galleries[0];
    await tap(page, testInfo, ui(page).locator('#nb a[href$="/popular"]').first());
    await waitForRoute(page, (url) => url.pathname === '/popular', 'ehtw-list');
    await tap(page, testInfo, detailTitle(page, gallery));
    await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
    await tap(page, testInfo, ui(page).locator('#gdt a').first());
    await waitForRoute(page, new RegExp(`/s/`), 'ehtw-reader');
    await page.evaluate(() => history.back());
    await waitForRoute(page, new RegExp(`/g/${gallery.gid}/`), 'ehtw-detail');
    await page.evaluate(() => history.back());
    await waitForRoute(page, (url) => url.pathname === '/popular', 'ehtw-list');
    await page.waitForTimeout(2000);

    const observed = {
      documentNavigations: diagnostics.documentNavigations,
      showpageCalls: site.state.showpageCalls.slice(callsBefore)
    };
    await testInfo.attach('real-ehg-show-popstate-observation.json', {
      body: Buffer.from(JSON.stringify(observed, null, 2)),
      contentType: 'application/json'
    });

    expect(diagnostics.documentNavigations, 'the real script Back chain remains in its original document').toHaveLength(docCount);
    expect(site.state.showpageCalls.slice(callsBefore), 'a non-reader SPA state must not trigger showpage with missing arguments')
      .not.toContainEqual(expect.objectContaining({ page: undefined, imgkey: undefined }));
    expect(page.url()).toContain('/popular');
    await expect(ui(page).locator('.ehtw-tweet').first()).toBeAttached();
  });
}
