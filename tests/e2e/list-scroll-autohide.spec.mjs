// 1.17.261 (user request): on phones the list/detail header and bottom nav slide
// away while scrolling down so iOS Safari shows page content under the status
// bar, and come back when scrolling up.
import { test, expect, open, EH } from './harness.mjs';

const isMobile = (info) => /iphone|pixel/i.test(info.project.name);

const state = (page) => page.evaluate(() => {
  const h = document.querySelector('#ehtw-header')?.getBoundingClientRect();
  const n = document.querySelector('#ehtw-left')?.getBoundingClientRect();
  const nav = document.querySelector('#ehtw-left');
  return { hidden: document.documentElement.classList.contains('ehtw-chrome-scroll-hidden'), headerBottom: h?.bottom, headerVisibility: getComputedStyle(document.querySelector('#ehtw-header')).visibility, navTop: n?.top, navDisplay: nav ? getComputedStyle(nav).display : undefined, innerHeight, scrollY };
});

async function userScroll(page, info, total, settle = 350) {
  const steps = 6;
  if (isMobile(info)) {
    await page.evaluate(() => { const e = new Event('touchstart', { bubbles: true }); Object.defineProperty(e, 'touches', { value: [{ identifier: 1 }] }); document.body.dispatchEvent(e); });
    for (let i = 0; i < steps; i++) { await page.evaluate((d) => window.scrollBy(0, d), total / steps); await page.waitForTimeout(30); }
    await page.evaluate(() => { const e = new Event('touchend', { bubbles: true }); Object.defineProperty(e, 'touches', { value: [] }); document.body.dispatchEvent(e); });
  } else {
    await page.mouse.move(600, 400);
    for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, total / steps); await page.waitForTimeout(30); }
  }
  await page.waitForTimeout(settle);
}

test.describe('list scroll auto-hide', () => {
  test('phone: scrolling down slides header and bottom nav away, scrolling up brings them back', async ({ page }, info) => {
    test.skip(!isMobile(info), 'phone layout only');
    await open(page, `${EH}/`);
    await page.waitForSelector('#ehtw-header');
    await page.waitForTimeout(1500);
    expect((await state(page)).hidden).toBe(false);
    await userScroll(page, info, 420);
    const down = await state(page);
    expect(down.hidden, JSON.stringify(down)).toBe(true);
    // 1.17.263 (user request): hidden at once in place, not slid off screen.
    expect(down.headerVisibility).toBe('hidden');
    // 1.17.264: no longer stuck at the top edge.
    expect(down.headerBottom).toBeLessThanOrEqual(0);
    // 1.17.262 (user request): the bottom nav is hidden at once, not slid away.
    if (down.navDisplay !== undefined) expect(down.navDisplay).toBe('none');
    await userScroll(page, info, -150);
    const up = await state(page);
    expect(up.hidden, JSON.stringify(up)).toBe(false);
    expect(up.headerBottom).toBeGreaterThan(0);
    expect(up.headerVisibility).toBe('visible');
    if (up.navDisplay !== undefined) {
      expect(up.navDisplay).not.toBe('none');
      expect(up.navTop).toBeLessThan(up.innerHeight);
    }
    // Programmatic scrolling (e.g. scroll restoration) never hides them.
    await page.waitForTimeout(1400);
    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.scrollBy(0, 80)); await page.waitForTimeout(30); }
    await page.waitForTimeout(200);
    expect((await state(page)).hidden).toBe(false);
  });

  test('phone: the bottom nav vanishes immediately instead of sliding', async ({ page }, info) => {
    test.skip(!isMobile(info), 'phone layout only');
    await open(page, `${EH}/`);
    await page.waitForSelector('#ehtw-left');
    await page.waitForTimeout(1500);
    await userScroll(page, info, 420, 0);
    const s = await state(page);
    expect(s.hidden, JSON.stringify(s)).toBe(true);
    expect(s.navDisplay).toBe('none');
    expect(s.headerVisibility).toBe('hidden');
  });

  test('desktop: the header never auto-hides', async ({ page }, info) => {
    test.skip(isMobile(info), 'desktop layout only');
    await open(page, `${EH}/`);
    await page.waitForSelector('#ehtw-header');
    await page.waitForTimeout(800);
    await userScroll(page, info, 600);
    expect((await state(page)).hidden).toBe(false);
  });
});
