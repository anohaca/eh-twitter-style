// In-page (SPA) routing, history, scroll restoration and the left/bottom
// navigation chrome.
import { test, expect, ui, open, EH, layoutOf, isTouch, tap, waitForRoute, navigate, hitTest } from './harness.mjs';

const firstTitle = (page) => ui(page).locator('.ehtw-tweet .ehtw-tweet-title .glink');

test.describe('SPA routing', () => {
  test('list → gallery → back restores the list and its scroll position without reloading', async ({ page, site, diagnostics }, testInfo) => {
    await open(page, `${EH}/`);
    const target = firstTitle(page).nth(8);
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 40));
    await page.waitForTimeout(300);
    const scrollBefore = await page.evaluate(() => Math.round(scrollY));
    expect(scrollBefore).toBeGreaterThan(500);
    const docNavsBefore = diagnostics.documentNavigations.length;
    await navigate(page, () => tap(page, testInfo, target), /\/g\/\d+\//, 'ehtw-detail');
    await navigate(page, () => page.goBack(), (url) => url.pathname === '/', 'ehtw-list');
    await expect.poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 5000 }).toBeGreaterThan(scrollBefore - 60);
    expect(await page.evaluate(() => Math.round(scrollY))).toBeLessThan(scrollBefore + 60);
    // SPA: the document itself was never reloaded.
    expect(diagnostics.documentNavigations.length).toBe(docNavsBefore);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('three list ↔ gallery round trips stay stable (no duplicate declarations, no leaks)', async ({ page, diagnostics }, testInfo) => {
    await open(page, `${EH}/`);
    for (let i = 0; i < 3; i += 1) {
      await navigate(page, () => tap(page, testInfo, firstTitle(page).nth(i)), /\/g\/\d+\//, 'ehtw-detail');
      await navigate(page, () => tap(page, testInfo, ui(page).locator('#ehtw-header .ehtw-back-link')), (url) => url.pathname === '/', 'ehtw-list');
    }
    expect(await ui(page).locator('#ehtw-shell').count()).toBe(1);
    expect(await page.locator('style').evaluateAll((s) => s.filter((e) => e.textContent.includes('#ehtw-shell')).length)).toBeLessThanOrEqual(2);
    expect(diagnostics.pageErrors.filter((e) => /already been declared|matchyear/i.test(e))).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
    expect(await page.evaluate(() => (window.__EHTW_PAGE_LISTENERS__ || []).length)).toBeLessThan(200);
  });

  test('browser back and forward walk list → gallery → reader', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries[0];
    await navigate(page, () => tap(page, testInfo, ui(page).locator(`.ehtw-tweet[data-ehtw-href*="/g/${g.gid}/"] .glink`)), new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
    await navigate(page, () => tap(page, testInfo, ui(page).locator('#gdt a').first()), new RegExp(`/s/[0-9a-f]+/${g.gid}-1$`), 'ehtw-reader');
    await navigate(page, () => page.goBack(), new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
    await navigate(page, () => page.goBack(), (url) => url.pathname === '/', 'ehtw-list');
    await navigate(page, () => page.goForward(), new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
  });

  test('searching from a gallery page lands on the results list', async ({ page, site }, testInfo) => {
    test.skip(layoutOf(testInfo) !== 'desktop', 'search box lives in the right column on desktop');
    const g = site.state.galleries[0];
    await open(page, `${EH}/g/${g.gid}/${g.token}/`);
    const input = ui(page).locator('#ehtw-right input[name="f_search"], #ehtw-right .ehtw-right-search-input').first();
    if (!(await input.count())) test.skip(true, 'no search on detail right column');
    await input.fill('glasses');
    await navigate(page, () => input.press('Enter'), /f_search=glasses/, 'ehtw-list');
  });

  test('a failing route fetch falls back to a normal document navigation', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries[3];
    // Make the next SPA fetch fail once at the network level.
    let failed = false;
    await page.route(`**/g/${g.gid}/**`, async (route) => {
      if (!failed && ['fetch', 'xhr'].includes(route.request().resourceType())) { failed = true; return route.abort('failed'); }
      return route.fallback();
    });
    await navigate(page, () => tap(page, testInfo, ui(page).locator(`.ehtw-tweet[data-ehtw-href*="/g/${g.gid}/"] .glink`)), new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
    await expect(ui(page).locator('#gn')).toHaveText(g.title);
  });
});

test.describe('navigation chrome', () => {
  test('More reveals the remaining links and closes again', async ({ page }, testInfo) => {
    await open(page, `${EH}/`);
    const visibleLinks = () => ui(page).locator('#ehtw-left #nb a').evaluateAll((links) => links.filter((a) => a.getBoundingClientRect().width > 0 && getComputedStyle(a).visibility !== 'hidden').length);
    const before = await visibleLinks();
    const more = ui(page).locator('.ehtw-more-button');
    await tap(page, testInfo, more);
    await expect.poll(visibleLinks).toBeGreaterThan(before);
    for (const label of ['Forums', 'Wiki', 'HentaiVerse']) {
      const link = ui(page).locator('#ehtw-left #nb a', { hasText: label });
      await expect(link).toBeVisible();
      // Reachable: scrolling it into view puts it under the pointer inside the viewport.
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      expect(box.y, `${label} top inside viewport`).toBeGreaterThanOrEqual(-1);
      expect(box.y + box.height, `${label} reachable inside an ${page.viewportSize().height}px-tall viewport`).toBeLessThanOrEqual(page.viewportSize().height + 1);
    }
    await tap(page, testInfo, more);
    await expect.poll(visibleLinks).toBe(before);
  });

  test('nav links point to the original destinations and the current page is marked', async ({ page }) => {
    await open(page, `${EH}/popular`);
    await expect(ui(page).locator('#ehtw-left .ehtw-nav-current a').first()).toHaveAttribute('href', `${EH}/popular`);
    const hrefs = await ui(page).locator('#ehtw-left #nb a').evaluateAll((a) => a.map((x) => x.href));
    for (const expected of [`${EH}/`, `${EH}/watched`, `${EH}/torrents.php`, `${EH}/favorites.php`, `${EH}/toplist.php`]) expect(hrefs).toContain(expected);
  });

  test('account menu opens with My Home and a logout link (desktop)', async ({ page }, testInfo) => {
    test.skip(layoutOf(testInfo) !== 'desktop', 'account card is in the desktop sidebar');
    await open(page, `${EH}/`);
    await tap(page, testInfo, ui(page).locator('.ehtw-account-card'));
    const menu = ui(page).locator('.ehtw-account-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('a', { hasText: 'My Home' })).toHaveAttribute('href', /home\.php/);
    await expect(menu.locator('a').last()).toHaveAttribute('href', /act=Login&CODE=03/);
    await page.keyboard.press('Escape');
    if (await menu.isVisible()) await tap(page, testInfo, ui(page).locator('#ehtw-header'));
    await expect(menu).toBeHidden();
  });

  test('phone bottom bar entries are large enough to tap', async ({ page }, testInfo) => {
    test.skip(layoutOf(testInfo) !== 'phone', 'phone only');
    await open(page, `${EH}/`);
    const sizes = await ui(page).locator('#ehtw-left #nb a, #ehtw-left .ehtw-more-button').evaluateAll((items) => items
      .filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    expect(sizes.length).toBeGreaterThan(3);
    for (const size of sizes) {
      expect(size.w).toBeGreaterThanOrEqual(40);
      expect(size.h).toBeGreaterThanOrEqual(40);
    }
  });

  test('every interactive control in the first screen is hittable', async ({ page }, testInfo) => {
    await open(page, `${EH}/`);
    const selectors = ['.ehtw-top-tab', '.ehtw-tweet .glink', '.ehtw-tweet .ehtw-media img', '.ehtw-tweet .ehtw-twitter-action-reply',
      '.ehtw-tweet .ehtw-twitter-action-heart', '.ehtw-tweet .ehtw-card-more-menu .ehtw-menu-button', '#f_search'];
    for (const selector of selectors) {
      const hit = await hitTest(page, selector);
      expect(hit.found, `${selector} exists`).toBe(true);
      expect(hit.hit, `${selector} is covered by ${hit.top}`).toBe(true);
    }
  });
});
