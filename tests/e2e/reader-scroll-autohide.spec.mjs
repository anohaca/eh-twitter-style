// 1.17.257 (user request): in scroll mode the reader chrome behaves like Safari's
// toolbar: scrolling down slides it away, scrolling up brings it back.
import { test, expect, ui, open, EH } from './harness.mjs';

const isMobile = (info) => /iphone|pixel/i.test(info.project.name);

async function openReader(page, site, mode = 'scroll') {
  const gallery = site.state.galleries[0];
  await open(page, site.readerUrl(EH, gallery, 6), { waitFor: 'html.ehtw-reader' });
  await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
  await ui(page).locator('.ehtw-reader-mode').nth(mode === 'click' ? 1 : 0).click();
  await page.waitForTimeout(600);
}

const state = (page) => page.evaluate(() => {
  const root = document.querySelector('.ehtw-reader-root');
  const c = document.querySelector('.ehtw-reader-controls').getBoundingClientRect();
  const t = document.querySelector('.ehtw-reader-page-tools').getBoundingClientRect();
  return {
    hidden: root.classList.contains('ehtw-reader-chrome-scroll-hidden'),
    settingsHidden: root.classList.contains('ehtw-reader-settings-hidden'),
    controlsBottom: c.bottom, toolsTop: t.top, innerHeight,
    toolsDisplay: getComputedStyle(document.querySelector('.ehtw-reader-page-tools')).display,
    controlsDisplay: getComputedStyle(document.querySelector('.ehtw-reader-controls')).display,
    pointerEvents: getComputedStyle(document.querySelector('.ehtw-reader-controls')).pointerEvents,
    scrollY
  };
});

// Scrolls like a user: finger down (or wheel on desktop), several small steps, finger up.
async function userScroll(page, info, total, settle = 350) {
  const steps = 6;
  if (isMobile(info)) {
    await page.evaluate(() => { const e = new Event('touchstart', { bubbles: true }); Object.defineProperty(e, 'touches', { value: [{ identifier: 1 }] }); document.querySelector('.ehtw-reader-images').dispatchEvent(e); });
    for (let i = 0; i < steps; i++) { await page.evaluate((d) => window.scrollBy(0, d), total / steps); await page.waitForTimeout(30); }
    await page.evaluate(() => { const e = new Event('touchend', { bubbles: true }); Object.defineProperty(e, 'touches', { value: [] }); document.dispatchEvent(e); });
  } else {
    await page.mouse.move(400, 400);
    for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, total / steps); await page.waitForTimeout(30); }
  }
  await page.waitForTimeout(settle);
}

test.describe('reader scroll auto-hide', () => {
  test('scrolling down hides the chrome off screen, scrolling up shows it again', async ({ page, site }, info) => {
    await openReader(page, site);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(1500);
    expect((await state(page)).hidden).toBe(false);
    await userScroll(page, info, 360);
    const down = await state(page);
    expect(down.hidden, JSON.stringify(down)).toBe(true);
    expect(down.controlsBottom).toBeLessThanOrEqual(0);
    // 1.17.262 (user request): the bottom tools are hidden at once, not slid away.
    expect(down.toolsDisplay).toBe('none');
    // 1.17.263: the top controls too.
    expect(down.controlsDisplay).toBe('none');
    expect(down.pointerEvents).toBe('none');
    await userScroll(page, info, -180);
    const up = await state(page);
    expect(up.hidden, JSON.stringify(up)).toBe(false);
    expect(up.controlsBottom).toBeGreaterThan(0);
    expect(up.toolsDisplay).not.toBe('none');
    expect(up.toolsTop).toBeLessThan(up.innerHeight);
    expect(up.pointerEvents).not.toBe('none');
  });

  // 1.17.258: on iOS, scrolling collapses Safari's bars and fires visualViewport
  // resize/scroll; the toolbar position correction must not undo the slide.
  test('viewport events while hidden or mid-slide keep the slide and the original position', async ({ page, site }, info) => {
    await openReader(page, site);
    const baseline = await state(page);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(1500);
    await userScroll(page, info, 360);
    const fire = () => page.evaluate(() => { visualViewport.dispatchEvent(new Event('resize')); visualViewport.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize')); });
    await fire();
    await page.waitForTimeout(120);
    await fire();
    await page.waitForTimeout(300);
    const hidden = await state(page);
    expect(hidden.hidden).toBe(true);
    expect(hidden.controlsBottom, JSON.stringify(hidden)).toBeLessThanOrEqual(0);
    expect(hidden.toolsDisplay, JSON.stringify(hidden)).toBe('none');
    await userScroll(page, info, -180);
    // Fire while the slide-back transition is still running.
    await page.evaluate(() => { const root = document.querySelector('.ehtw-reader-root'); root.classList.add('ehtw-reader-chrome-scroll-hidden'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.ehtw-reader-root').classList.remove('ehtw-reader-chrome-scroll-hidden'));
    await page.waitForTimeout(60);
    await fire();
    await page.waitForTimeout(500);
    const shown = await state(page);
    expect(shown.hidden).toBe(false);
    expect(Math.abs(shown.controlsBottom - baseline.controlsBottom), JSON.stringify({ baseline, shown })).toBeLessThanOrEqual(2);
    expect(Math.abs(shown.toolsTop - baseline.toolsTop), JSON.stringify({ baseline, shown })).toBeLessThanOrEqual(2);
  });

  test('the bottom tools vanish immediately instead of sliding', async ({ page, site }, info) => {
    await openReader(page, site);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(1500);
    await userScroll(page, info, 360, 0);
    const s = await state(page);
    expect(s.hidden, JSON.stringify(s)).toBe(true);
    expect(s.toolsDisplay).toBe('none');
    expect(s.controlsDisplay).toBe('none');
  });

  test('small jitters, programmatic scrolls and page loads never toggle it', async ({ page, site }, info) => {
    await openReader(page, site);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(1500);
    await userScroll(page, info, 12);
    expect((await state(page)).hidden, 'below the 24px travel threshold').toBe(false);
    await page.waitForTimeout(1400);
    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.scrollBy(0, 80)); await page.waitForTimeout(30); }
    await page.waitForTimeout(200);
    expect((await state(page)).hidden, 'scroll without user input').toBe(false);
  });

  test('a centre tap brings hidden chrome back without toggling the settings', async ({ page, site }, info) => {
    await openReader(page, site);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(1500);
    await userScroll(page, info, 360);
    expect((await state(page)).hidden).toBe(true);
    await page.evaluate(() => {
      const y = innerHeight / 2;
      const frame = [...document.querySelectorAll('.ehtw-reader-image-frame')].find((f) => { const b = f.getBoundingClientRect(); return b.top <= y && b.bottom >= y; });
      const b = frame.querySelector('.ehtw-reader-page-image').getBoundingClientRect();
      frame.querySelector('.ehtw-reader-page-image').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: y }));
    });
    await page.waitForTimeout(300);
    const s = await state(page);
    expect(s.hidden).toBe(false);
    expect(s.settingsHidden).toBe(false);
  });

  test('reaching the top shows it, and click mode never auto-hides', async ({ page, site }, info) => {
    await openReader(page, site);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(1500);
    await userScroll(page, info, 300);
    expect((await state(page)).hidden).toBe(true);
    await userScroll(page, info, -(await state(page)).scrollY - 50);
    expect((await state(page)).hidden).toBe(false);
    await userScroll(page, info, 300);
    expect((await state(page)).hidden).toBe(true);
    await ui(page).locator('.ehtw-reader-mode').nth(1).evaluate((b) => b.click());
    await page.waitForTimeout(300);
    expect((await state(page)).hidden, 'switching to click mode clears it').toBe(false);
  });
});

