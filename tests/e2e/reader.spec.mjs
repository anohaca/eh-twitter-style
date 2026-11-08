// Continuous reader on /s/ pages: preload in both directions, counters,
// click paging, zoom, seeking, failure recovery and memory release.
import { test, expect, ui, open, EH, isTouch, layoutOf, tap } from './harness.mjs';

const openReader = async (page, site, page_ = 6, gallery = 0) => {
  const g = site.state.galleries[gallery];
  await open(page, site.readerUrl(EH, g, page_), { waitFor: 'html.ehtw-reader' });
  await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
  await page.waitForTimeout(300); // initial scroll positioning settles
  return g;
};
/** Scrolls so that the frame showing `n` sits at the top of the viewport. */
const scrollToPage = (page, n) => page.evaluate((n) => {
  const img = [...document.querySelectorAll('.ehtw-reader-page-image')].find((i) =>
    new RegExp(`/h/\\d+-${n}/`).test(i.getAttribute('src') || i.dataset.ehtwMemorySource || ''));
  if (!img) return false;
  const frame = img.closest('.ehtw-reader-image-frame');
  window.scrollTo(0, frame.getBoundingClientRect().top + window.scrollY + 5);
  return true;
}, n);
/** Clicks / taps a horizontal fraction of the image currently at the viewport centre. */
async function pressImageAt(page, testInfo, fraction) {
  const point = await page.evaluate((fraction) => {
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    // 1.17.256 top-aligns click-mode images on phones (edge-to-edge under the
    // status bar), so a wide image may not cover the screen centre; then use the
    // visible active click-mode image instead.
    const img = document.elementFromPoint(cx, cy)?.closest('.ehtw-reader-image-frame')?.querySelector('img') ||
      (document.documentElement.classList.contains('ehtw-reader-click')
        ? document.querySelector('.ehtw-reader-image-frame.ehtw-reader-active img')
        : null);
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: r.left + r.width * fraction, y: Math.max(r.top + 5, Math.min(cy, r.bottom - 5)) };
  }, fraction);
  expect(point, 'an image is under the viewport centre').not.toBeNull();
  if (isTouch(testInfo)) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}
const counter = (page) => ui(page).locator('.ehtw-reader-page-count');
const frames = (page) => ui(page).locator('.ehtw-reader-image-frame');
const pageNumbersInDom = (page) => ui(page).locator('.ehtw-reader-page-image').evaluateAll((imgs) =>
  imgs.map((img) => {
    const src = img.getAttribute('src') || img.dataset.ehtwMemorySource || img.getAttribute('data-src') || '';
    return Number(src.match(/\/h\/\d+-(\d+)\//)?.[1] || 0);
  }));

test.describe('continuous reader', () => {
  test('opens at the requested page with counters, and preloads before and after it', async ({ page, site, diagnostics }) => {
    const g = await openReader(page, site, 6);
    await expect(counter(page)).toHaveText(`6 / ${g.pages}`);
    await expect.poll(async () => (await pageNumbersInDom(page)).filter(Boolean).length).toBeGreaterThan(6);
    const numbers = (await pageNumbersInDom(page)).filter(Boolean);
    expect(numbers).toContain(5);
    expect(numbers).toContain(7);
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers); // ordered
    expect(new Set(numbers).size).toBe(numbers.length);
    // The requested page (the native #img) is the one in view.
    const active = await ui(page).locator('#img').boundingBox();
    expect(active.y).toBeLessThan(page.viewportSize().height);
    expect(active.y + active.height).toBeGreaterThan(0);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('first page has nothing before it; last page has nothing after it', async ({ page, site }) => {
    const g = await openReader(page, site, 1);
    await expect(counter(page)).toHaveText(`1 / ${g.pages}`);
    await page.waitForTimeout(800);
    expect(Math.min(...(await pageNumbersInDom(page)).filter(Boolean))).toBe(1);
    await openReader(page, site, g.pages);
    await expect(counter(page)).toHaveText(`${g.pages} / ${g.pages}`);
    await page.waitForTimeout(800);
    expect(Math.max(...(await pageNumbersInDom(page)).filter(Boolean))).toBe(g.pages);
  });

  test('scrolling down advances the counter and keeps the URL in sync', async ({ page, site }) => {
    const g = await openReader(page, site, 6);
    expect(await scrollToPage(page, 9)).toBe(true);
    await expect(counter(page)).toHaveText(new RegExp(`^(8|9|10) / ${g.pages}$`));
    await expect.poll(() => page.url()).toMatch(new RegExp(`/${g.gid}-(8|9|10)$`));
  });

  test('short galleries load completely without errors', async ({ page, site, diagnostics }) => {
    const g = await openReader(page, site, 2, 1); // 3-page gallery
    await expect(counter(page)).toHaveText(`2 / ${g.pages}`);
    await expect.poll(async () => (await pageNumbersInDom(page)).filter(Boolean)).toEqual([1, 2, 3]);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('the reader replaces the native resize handler (no update_window_extents crash)', async ({ page, site, diagnostics }) => {
    await openReader(page, site, 6);
    const size = page.viewportSize();
    await page.setViewportSize({ width: Math.max(320, size.width - 120), height: size.height - 100 });
    await page.waitForTimeout(300);
    await page.setViewportSize(size);
    await page.waitForTimeout(300);
    expect(diagnostics.pageErrors.filter((e) => /update_window_extents/.test(e))).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('page slider seeks to a far page', async ({ page, site }) => {
    const g = await openReader(page, site, 6);
    const slider = ui(page).locator('.ehtw-reader-page-slider');
    await expect(slider).toHaveAttribute('max', String(g.pages));
    await slider.evaluate((input) => {
      input.value = '30';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      window.dispatchEvent(new Event('pointerup'));
    });
    await expect(counter(page)).toHaveText(`30 / ${g.pages}`, { timeout: 15_000 });
    await expect.poll(async () => (await pageNumbersInDom(page)).includes(30), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => page.url()).toMatch(new RegExp(`/${g.gid}-30$`));
  });

  test('preload count can be changed and is remembered', async ({ page, site }, testInfo) => {
    await openReader(page, site, 6);
    await tap(page, testInfo, ui(page).locator('.ehtw-reader-preload-details summary'));
    const input = ui(page).locator('.ehtw-reader-preload-popover input').first();
    await expect(input).toBeVisible();
    await input.fill('3');
    await input.dispatchEvent('change');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ehtw-reader-preload-count-v2'))).toBe('3');
  });

  test('distant pages release their image memory', async ({ page, site }) => {
    const g = await openReader(page, site, 6);
    const slider = ui(page).locator('.ehtw-reader-page-slider');
    await slider.evaluate((input) => {
      input.value = '40';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      window.dispatchEvent(new Event('pointerup'));
    });
    await expect(counter(page)).toHaveText(`40 / ${g.pages}`, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const near6 = await ui(page).locator('.ehtw-reader-page-image').evaluateAll((imgs) => imgs
      .filter((img) => /\/h\/\d+-(5|6|7)\//.test(img.getAttribute('src') || img.dataset.ehtwMemorySource || ''))
      .map((img) => ({ unloaded: img.dataset.ehtwMemoryUnloaded === 'true', src: !!img.getAttribute('src') })));
    for (const item of near6) expect(item.unloaded || !item.src).toBe(true);
  });
});

test.describe('click paging mode', () => {
  test('switching to click mode pages one image at a time and is remembered', async ({ page, site }, testInfo) => {
    const g = await openReader(page, site, 6);
    await tap(page, testInfo, ui(page).locator('.ehtw-reader-mode').nth(1));
    await expect(page.locator('html')).toHaveClass(/ehtw-reader-click/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ehtw-reader-mode-v1'))).toBe('click');
    await page.waitForTimeout(400);
    await expect(counter(page)).toHaveText(`6 / ${g.pages}`);
    await pressImageAt(page, testInfo, 0.85);
    await expect(counter(page)).toHaveText(`7 / ${g.pages}`);
    await page.waitForTimeout(300);
    await pressImageAt(page, testInfo, 0.15);
    await expect(counter(page)).toHaveText(`6 / ${g.pages}`);
    await page.reload();
    await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
    await expect(page.locator('html')).toHaveClass(/ehtw-reader-click/);
  });

  test('keyboard arrows and the wheel page in click mode (desktop)', async ({ page, site }, testInfo) => {
    test.skip(isTouch(testInfo), 'keyboard / wheel are desktop inputs');
    const g = await openReader(page, site, 6);
    await ui(page).locator('.ehtw-reader-mode').nth(1).click();
    await expect(page.locator('html')).toHaveClass(/ehtw-reader-click/);
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowRight');
    await expect(counter(page)).toHaveText(`7 / ${g.pages}`);
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowLeft');
    await expect(counter(page)).toHaveText(`6 / ${g.pages}`);
    await page.waitForTimeout(300);
    await page.mouse.move(page.viewportSize().width / 2, page.viewportSize().height / 2);
    await page.mouse.wheel(0, 120);
    await expect(counter(page)).toHaveText(`7 / ${g.pages}`);
  });

  test('tapping the centre toggles the reader controls', async ({ page, site }, testInfo) => {
    await openReader(page, site, 6);
    const root = ui(page).locator('.ehtw-reader-root');
    await pressImageAt(page, testInfo, 0.5);
    await expect(root).toHaveClass(/ehtw-reader-settings-hidden/);
    await page.waitForTimeout(300);
    await pressImageAt(page, testInfo, 0.5);
    await expect(root).not.toHaveClass(/ehtw-reader-settings-hidden/);
  });
});

test.describe('zoom', () => {
  test('+ / − change the zoom, Fit resets it, and the value persists', async ({ page, site }, testInfo) => {
    await openReader(page, site, 6);
    const input = ui(page).locator('.ehtw-reader-zoom-input');
    const start = Number(await input.inputValue());
    const width = async () => (await ui(page).locator('#img').boundingBox()).width;
    const w0 = await width();
    await tap(page, testInfo, ui(page).locator('.ehtw-reader-zoom-button').last());
    await expect.poll(async () => Number(await input.inputValue())).toBeGreaterThan(start);
    await expect.poll(width).toBeGreaterThan(w0 - 0.5);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ehtw-reader-zoom-percent-v1'))).not.toBeNull();
    await tap(page, testInfo, ui(page).locator('.ehtw-reader-zoom-button').first());
    await tap(page, testInfo, ui(page).locator('.ehtw-reader-zoom-button').first());
    await expect.poll(async () => Number(await input.inputValue())).toBeLessThan(start + 1);
    await tap(page, testInfo, ui(page).locator('.ehtw-reader-fit-button'));
    await expect.poll(async () => Number(await input.inputValue())).toBe(start);
  });

  test('images never overflow the viewport width at the default zoom', async ({ page, site }) => {
    await openReader(page, site, 6);
    const widths = await ui(page).locator('.ehtw-reader-page-image').evaluateAll((imgs) => imgs.map((i) => i.getBoundingClientRect().width));
    for (const w of widths) expect(w).toBeLessThanOrEqual(page.viewportSize().width + 1);
  });
});

test.describe('failure recovery', () => {
  test.describe('a permanently broken page', () => {
    test.use({ siteOptions: { failImages: ['5000-7'] } });
    test('shows a retry button and does not block the following pages', async ({ page, site }) => {
      await openReader(page, site, 6);
      const failedFrame = ui(page).locator('.ehtw-reader-image-frame.ehtw-reader-image-failed');
      await expect(failedFrame).toHaveCount(1, { timeout: 20_000 });
      await expect(failedFrame.locator('.ehtw-reader-retry-button')).toBeVisible();
      // Page 8 and later still load once the reader reaches them.
      expect(await scrollToPage(page, 8)).toBe(true);
      await expect.poll(() => ui(page).locator('.ehtw-reader-page-image').evaluateAll((imgs) =>
        imgs.some((i) => /\/h\/5000-8\//.test(i.currentSrc || i.src) && i.complete && i.naturalWidth > 0)), { timeout: 15_000 }).toBe(true);
    });

    for (const mode of ['scroll', 'click']) {
      test(`retry icon retries without paging in ${mode} mode`, async ({ page, site }, testInfo) => {
        const g = await openReader(page, site, 7);
        if (mode === 'click') await tap(page, testInfo, ui(page).locator('.ehtw-reader-mode').nth(1));
        const failed = ui(page).locator('.ehtw-reader-image-frame.ehtw-reader-image-failed').first();
        await expect(failed).toBeVisible({ timeout: 15_000 });
        const retry = failed.locator('.ehtw-reader-retry-button');
        await expect(retry).toBeVisible();
        const requestCount = () => site.state.log.filter((item) => new URL(item.url).pathname.startsWith(`/h/${g.gid}-7/`)).length;
        const before = requestCount();
        await tap(page, testInfo, retry);
        await expect(counter(page)).toHaveText(`7 / ${g.pages}`);
        await expect.poll(requestCount).toBeGreaterThan(before);
      });
    }

    for (const fraction of [0.15, 0.85]) {
      test(`failed image paging zone ${fraction < 0.5 ? 'left' : 'right'} works without retrying it`, async ({ page, site }, testInfo) => {
        const g = await openReader(page, site, 7);
        await tap(page, testInfo, ui(page).locator('.ehtw-reader-mode').nth(1));
        const failed = ui(page).locator('.ehtw-reader-image-frame.ehtw-reader-image-failed').first();
        await expect(failed).toBeVisible({ timeout: 15_000 });
        const requestCount = () => site.state.log.filter((item) => new URL(item.url).pathname.startsWith(`/h/${g.gid}-7/`)).length;
        const before = requestCount();
        await pressImageAt(page, testInfo, fraction);
        await expect(counter(page)).toHaveText(`${fraction < 0.5 ? 6 : 8} / ${g.pages}`);
        expect(requestCount(), 'paging on the failed image does not retry page 7').toBe(before);
      });
    }
  });

  test.describe('a transiently failing page', () => {
    test.use({ siteOptions: { failOnceImages: ['5000-7'] } });
    test('recovers by itself through automatic retry', async ({ page, site }) => {
      await openReader(page, site, 6);
      await expect.poll(() => ui(page).locator('.ehtw-reader-page-image').evaluateAll((imgs) =>
        imgs.some((i) => /\/h\/5000-7\//.test(i.currentSrc || i.src) && i.complete && i.naturalWidth > 0)), { timeout: 20_000 }).toBe(true);
      await expect(ui(page).locator('.ehtw-reader-image-frame.ehtw-reader-image-failed')).toHaveCount(0);
    });
  });

  test.describe('slow images', () => {
    test.use({ siteOptions: { slowImagesMs: 1500 } });
    test('show a loading spinner until they arrive', async ({ page, site }) => {
      await openReader(page, site, 6);
      await expect(ui(page).locator('.ehtw-reader-image-frame.ehtw-reader-image-loading').first()).toBeVisible();
      await expect.poll(() => ui(page).locator('#img').evaluate((i) => i.complete && i.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
    });
  });
});

test.describe('mobile reader specifics', () => {
  test('uses a mobile-friendly viewport meta and touch scrolling', async ({ page, site }, testInfo) => {
    test.skip(!isTouch(testInfo), 'touch devices only');
    const g = await openReader(page, site, 6);
    const content = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(content).toMatch(/width=device-width/);
    expect(content).toMatch(/viewport-fit=cover/);
    const firstImageFrame = await ui(page).locator('.ehtw-reader-image-frame').first().boundingBox();
    expect(firstImageFrame, 'the first image frame is present').not.toBeNull();
    expect(firstImageFrame.y, 'the first image starts at the top safe-area edge behind the status bar').toBeLessThanOrEqual(1);
    const controlsTop = await ui(page).locator('.ehtw-reader-controls').evaluate((node) => getComputedStyle(node).top);
    expect(controlsTop, 'reader controls reserve space for the status bar').toMatch(/px$/);
    // Touch scroll (synthetic) moves the document and updates the counter.
    const before = await page.evaluate(() => scrollY);
    await page.mouse.move(10, 10);
    await page.evaluate(() => window.scrollBy(0, innerHeight * 3));
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
    await expect(counter(page)).not.toHaveText(`6 / ${g.pages}`);
  });

  test('controls fit on narrow screens', async ({ page, site }, testInfo) => {
    test.skip(layoutOf(testInfo) !== 'phone', 'phone only');
    await openReader(page, site, 6);
    for (const selector of ['.ehtw-reader-controls', '.ehtw-reader-page-tools']) {
      const box = await page.locator(selector).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    }
  });
});
