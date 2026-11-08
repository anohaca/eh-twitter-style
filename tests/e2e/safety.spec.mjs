// Hard constraints from the original brief: no unintended writes, native
// handlers preserved, text never interpreted as HTML, bounded background load.
import { test, expect, ui, open, EH, backgroundRequests } from './harness.mjs';

test.describe('no account writes while browsing', () => {
  test('opening every page type and the reader sends no POST/PUT/DELETE', async ({ page, site }) => {
    const g = site.state.galleries[0];
    for (const path of ['/', '/watched', '/popular', `/g/${g.gid}/${g.token}/`, '/toplist.php', '/torrents.php', '/favorites.php', '/home.php', '/mytags', '/uconfig.php']) {
      await open(page, `${EH}${path}`);
      await page.waitForTimeout(400);
    }
    await open(page, site.readerUrl(EH, g, 3), { waitFor: 'html.ehtw-reader' });
    await page.waitForTimeout(800);
    expect(site.state.writes).toEqual([]);
  });
});

test.describe('native structure is preserved', () => {
  test.describe('without the userscript', () => {
    test.use({ injectScript: false });
    test('baseline counts', async ({ page }) => {
      await page.goto(`${EH}/`);
      const counts = await page.evaluate(() => ({
        onclick: document.querySelectorAll('[onclick]').length,
        ids: ['nb', 'f_search', 'f_cats', 'searchbox', 'unext', 'dnext'].filter((id) => document.getElementById(id)).length
      }));
      test.info().annotations.push({ type: 'baseline', description: JSON.stringify(counts) });
      expect(counts.onclick).toBeGreaterThan(50);
    });
  });

  test('inline handlers and key ids survive the transformation (moved, not cloned)', async ({ page }) => {
    await open(page, `${EH}/`);
    const after = await page.evaluate(() => ({
      ids: ['nb', 'f_search', 'f_cats', 'searchbox', 'unext', 'dnext'].map((id) => document.querySelectorAll(`#${id}`).length),
      onclickCats: document.querySelectorAll('#searchbox [onclick^="toggle_category"]').length,
      posted: document.querySelectorAll('[id^="posted_"]').length,
      glinks: document.querySelectorAll('.glink').length
    }));
    expect(after.ids).toEqual([1, 1, 1, 1, 1, 1]); // no duplicated ids from cloning
    expect(after.onclickCats).toBe(10);
    expect(after.posted).toBe(25);
    expect(after.glinks).toBe(25);
  });

  test('the search form posts the same field names as the native form', async ({ page }) => {
    await open(page, `${EH}/`);
    const names = await ui(page).locator('#searchbox form').evaluate((f) => [...new FormData(f).keys()]);
    expect(names).toContain('f_search');
  });
});

test.describe('text handling', () => {
  test('comment and title text with markup is shown literally on the detail page', async ({ page, site }) => {
    const g = site.state.galleries[3]; // XSS title
    await open(page, `${EH}/g/${g.gid}/${g.token}/`);
    await expect(ui(page).locator('#gn')).toHaveText(g.title);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__ehtwXss)).toBeUndefined();
  });

  test('document.title keeps the native title', async ({ page, site }) => {
    const g = site.state.galleries[0];
    await open(page, `${EH}/g/${g.gid}/${g.token}/`);
    await expect(page).toHaveTitle(`${g.title} - E-Hentai Galleries`);
  });
});

test.describe('background load', () => {
  test('a list page load issues a bounded number of background requests', async ({ page, diagnostics }) => {
    await open(page, `${EH}/`);
    await page.waitForTimeout(3000);
    const background = backgroundRequests(diagnostics);
    test.info().annotations.push({ type: 'background-requests', description: background.map((r) => new URL(r.url).pathname + new URL(r.url).search).join('\n') });
    // Toplist sidebar + My Tags + stats for visible cards must stay small and must never hammer the API.
    expect(background.length).toBeLessThanOrEqual(40);
    expect(background.filter((r) => /api\.php/.test(r.url)).length).toBeLessThanOrEqual(2);
  });

  test('rate limiting (HTTP 429) is respected: no retry storm', async ({ page, site, diagnostics }) => {
    await page.route('**/g/**', async (route) => {
      if (['fetch', 'xhr'].includes(route.request().resourceType())) return route.fulfill({ status: 429, body: 'Too many requests' });
      return route.fallback();
    });
    await open(page, `${EH}/`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await page.waitForTimeout(4000);
    const galleryFetches = backgroundRequests(diagnostics).filter((r) => /\/g\/\d+\//.test(r.url));
    expect(galleryFetches.length).toBeLessThanOrEqual(6);
  });

  test('the script never uses eval-like APIs at runtime', async ({ page }) => {
    await page.addInitScript(() => {
      window.__evalCalls = 0;
      // Playwright uses UtilityScript on Chromium and Web Inspector's bootstrap
      // evaluator on WebKit. Neither is userscript page code.
      const fromPage = () => !/(?:UtilityScript|web-inspector:\/\/bootstrap\.js)/.test(new Error().stack || '');
      const originalEval = window.eval;
      window.eval = function (...args) { if (fromPage()) window.__evalCalls += 1; return originalEval.apply(this, args); };
      const OriginalFunction = window.Function;
      window.Function = function (...args) { if (fromPage()) window.__evalCalls += 1; return OriginalFunction.apply(this, args); };
      window.Function.prototype = OriginalFunction.prototype;
    });
    await open(page, `${EH}/`);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__evalCalls)).toBe(0);
  });
});
