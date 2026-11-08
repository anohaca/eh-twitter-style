// Native browser pinch stays in control; reader layout and chrome remain stable.
import { test, expect, ui, open, EH } from './harness.mjs';

const modes = ['scroll', 'click'];
const isMobile = (info) => /iphone|pixel/i.test(info.project.name);

async function openReader(page, site, mode) {
  const gallery = site.state.galleries[0];
  await open(page, site.readerUrl(EH, gallery, 6), { waitFor: 'html.ehtw-reader' });
  await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
  await ui(page).locator('.ehtw-reader-mode').nth(mode === 'click' ? 1 : 0).click();
  await page.waitForTimeout(160);
}

async function fakeScale(page, scale) {
  return page.evaluate((value) => {
    if (!visualViewport) return false;
    try {
      Object.defineProperty(visualViewport, 'scale', { configurable: true, value });
      Object.defineProperty(visualViewport, 'width', { configurable: true, value: innerWidth / value });
      Object.defineProperty(visualViewport, 'height', { configurable: true, value: innerHeight / value });
      Object.defineProperty(visualViewport, 'offsetLeft', { configurable: true, value: 0 });
      Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 0 });
      return true;
    }
    catch (_) { return false; }
  }, scale);
}

for (const mode of modes) {
  test.describe(`native zoom reader (${mode})`, () => {
    test('ignores visual width changes, sizes from layout viewport, and responds to rotation', async ({ page, site }) => {
      await openReader(page, site, mode);
      test.skip(!await fakeScale(page, 2), 'this browser does not allow visualViewport scale stubbing');
      const initial = await page.evaluate(() => ({ width: document.querySelector('.ehtw-reader-image-frame').getBoundingClientRect().width, scrollY }));
      await page.evaluate(() => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: document.documentElement.clientWidth / 2 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: document.documentElement.clientHeight / 2 });
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForTimeout(80);
      const half = await page.evaluate(() => ({ width: document.querySelector('.ehtw-reader-image-frame').getBoundingClientRect().width, scrollY }));
      expect(half.width).toBeCloseTo(initial.width, 0);
      expect(half.scrollY).toBe(initial.scrollY);
      await page.evaluate(() => document.querySelector('.ehtw-reader-page-image').dispatchEvent(new Event('load')));
      const afterLoad = await page.locator('.ehtw-reader-image-frame').first().evaluate((el) => el.getBoundingClientRect().width);
      expect(afterLoad).toBeGreaterThan(initial.width - 8);
      await page.evaluate(() => {
        delete window.innerWidth;
        delete window.innerHeight;
        Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 1 });
        Object.defineProperty(visualViewport, 'width', { configurable: true, value: window.innerWidth });
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: window.innerHeight });
      });
      const size = page.viewportSize();
      await page.setViewportSize({ width: size.height, height: size.width });
      await page.waitForTimeout(120);
      const rotated = await page.locator('.ehtw-reader-image-frame').first().evaluate((el) => el.getBoundingClientRect().width);
      expect(rotated).not.toBeCloseTo(initial.width, 0);
    });

    // 1.17.247 (user decision): chrome stays hidden for the whole native zoom and
    // returns only at scale 1, because iOS moved the counter-scaled toolbars around.
    test('hides chrome while natively zoomed and restores it at original margins after zooming out', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'visual viewport and touch motion cases run on mobile projects');
      await openReader(page, site, mode);
      // Baseline measured at scale 1, against the visual viewport, exactly like `shown` below.
      const baseline = await page.evaluate(() => {
        const c = document.querySelector('.ehtw-reader-controls').getBoundingClientRect();
        const b = document.querySelector('.ehtw-reader-page-tools').getBoundingClientRect();
        return { top: c.top - visualViewport.offsetTop, bottom: visualViewport.offsetTop + visualViewport.height - b.bottom, left: b.left - visualViewport.offsetLeft, right: visualViewport.offsetLeft + visualViewport.width - b.right };
      });
      test.skip(!await fakeScale(page, 2), 'this browser does not allow visualViewport scale stubbing');
      const hidden = await page.evaluate(() => {
        visualViewport.dispatchEvent(new Event('scroll'));
        return ['.ehtw-reader-controls', '.ehtw-reader-page-tools'].map((s) => {
          const e = document.querySelector(s);
          return { moving: document.querySelector('.ehtw-reader-root').classList.contains('ehtw-reader-chrome-moving'), opacity: getComputedStyle(e).opacity, pointerEvents: getComputedStyle(e).pointerEvents };
        });
      });
      for (const x of hidden) { expect(x.moving).toBe(true); expect(x.pointerEvents).toBe('none'); }
      await page.waitForTimeout(140);
      for (const selector of ['.ehtw-reader-controls', '.ehtw-reader-page-tools']) expect(await page.locator(selector).evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
      await page.waitForTimeout(280);
      const stillZoomed = await page.evaluate(() => ({ moving: document.querySelector('.ehtw-reader-root').classList.contains('ehtw-reader-chrome-moving'), opacity: getComputedStyle(document.querySelector('.ehtw-reader-controls')).opacity }));
      expect(stillZoomed.moving, 'chrome stays hidden while still zoomed after movement stops').toBe(true);
      expect(stillZoomed.opacity).toBe('0');
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 1 });
        Object.defineProperty(visualViewport, 'width', { configurable: true, value: window.innerWidth });
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: window.innerHeight });
        visualViewport.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(280);
      const shown = await page.evaluate(() => {
        const c = document.querySelector('.ehtw-reader-controls').getBoundingClientRect();
        const b = document.querySelector('.ehtw-reader-page-tools').getBoundingClientRect();
        return { moving: document.querySelector('.ehtw-reader-root').classList.contains('ehtw-reader-chrome-moving'), opacity: getComputedStyle(document.querySelector('.ehtw-reader-controls')).opacity, top: (c.top - visualViewport.offsetTop) * visualViewport.scale, bottom: (visualViewport.offsetTop + visualViewport.height - b.bottom) * visualViewport.scale, left: (b.left - visualViewport.offsetLeft) * visualViewport.scale, right: (visualViewport.offsetLeft + visualViewport.width - b.right) * visualViewport.scale };
      });
      expect(shown.moving).toBe(false); expect(shown.opacity).toBe('1');
      for (const key of ["top", "bottom", "left", "right"]) expect(Math.abs(shown[key] - baseline[key]), `${key} margin ${JSON.stringify({ baseline, shown })}`).toBeLessThanOrEqual(2);
    });

    test('waits for touch end, leaves unzoomed chrome alone, preserves hidden state, and cleans up', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'synthetic touch cases run on mobile projects');
      await openReader(page, site, mode);
      test.skip(!await fakeScale(page, 2), 'this browser does not allow visualViewport scale stubbing');
      await page.evaluate(() => {
        const start = new Event('touchstart', { bubbles: true }); Object.defineProperty(start, 'touches', { value: [{ identifier: 1 }] }); document.dispatchEvent(start);
        visualViewport.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(260);
      expect(await page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-chrome-moving'))).toBe(true);
      await page.evaluate(() => { const end = new Event('touchend', { bubbles: true }); Object.defineProperty(end, 'touches', { value: [] }); document.dispatchEvent(end); });
      await page.waitForTimeout(260);
      // 1.17.247: still zoomed, so chrome stays hidden after the fingers lift.
      expect(await page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-chrome-moving'))).toBe(true);
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 1 });
        Object.defineProperty(visualViewport, 'width', { configurable: true, value: window.innerWidth });
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: window.innerHeight });
        visualViewport.dispatchEvent(new Event('scroll'));
        const move = new Event('touchmove', { bubbles: true }); Object.defineProperty(move, 'touches', { value: [{ identifier: 1 }] }); document.dispatchEvent(move);
      });
      expect(await page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-chrome-moving'))).toBe(false);
      await page.evaluate(() => document.querySelector('.ehtw-reader-page-image').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2 })));
      await page.waitForTimeout(30);
      expect(await page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-settings-hidden'))).toBe(true);
      await page.evaluate(() => { Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 2 }); visualViewport.dispatchEvent(new Event('scroll')); });
      await page.waitForTimeout(260);
      expect(await page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-settings-hidden'))).toBe(true);
      await page.evaluate(() => window.__EHTW_PAGE_CLEANUP__?.());
      expect(await page.locator('.ehtw-reader-root').count()).toBe(0);
    });

    // 1.17.252: iOS can skip the final visualViewport event when a pinch settles
    // back at scale 1, or settle a hair above 1. The chrome must still come back.
    test('restores chrome after zoom-out even without a final viewport event', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'visual viewport cases run on mobile projects');
      await openReader(page, site, mode);
      test.skip(!await fakeScale(page, 2.5), 'this browser does not allow visualViewport scale stubbing');
      const moving = () => page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-chrome-moving'));
      await page.evaluate(() => visualViewport.dispatchEvent(new Event('scroll')));
      expect(await moving()).toBe(true);
      await page.waitForTimeout(900);
      expect(await moving(), 'still zoomed: stays hidden').toBe(true);
      // Back to scale 1 silently: no visualViewport, scroll or touch event at all.
      await fakeScale(page, 1);
      await expect.poll(moving, { timeout: 2_000 }).toBe(false);
      expect(await page.locator('.ehtw-reader-controls').evaluate((e) => getComputedStyle(e).pointerEvents)).not.toBe('none');
    });

    test('restores chrome when the pinch settles slightly above scale 1 and on finger lift', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'synthetic touch cases run on mobile projects');
      await openReader(page, site, mode);
      test.skip(!await fakeScale(page, 2), 'this browser does not allow visualViewport scale stubbing');
      const moving = () => page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-chrome-moving'));
      await page.evaluate(() => visualViewport.dispatchEvent(new Event('scroll')));
      expect(await moving()).toBe(true);
      await fakeScale(page, 1.015);
      await page.evaluate(() => visualViewport.dispatchEvent(new Event('resize')));
      expect(await moving(), 'scale 1.015 counts as unzoomed for the chrome').toBe(false);
      await fakeScale(page, 2);
      await page.evaluate(() => {
        const start = new Event('touchstart', { bubbles: true }); Object.defineProperty(start, 'touches', { value: [{ identifier: 1 }, { identifier: 2 }] }); document.dispatchEvent(start);
        visualViewport.dispatchEvent(new Event('scroll'));
      });
      expect(await moving()).toBe(true);
      await fakeScale(page, 1);
      // Only the finger lift is observed; it alone must restore the chrome.
      await page.evaluate(() => { const end = new Event('touchend', { bubbles: true }); Object.defineProperty(end, 'touches', { value: [] }); document.dispatchEvent(end); });
      expect(await moving()).toBe(false);
    });

    // 1.17.253 (user request): toolbars must never visibly move with a pinch.
    // They vanish instantly on the second finger, before iOS scales anything,
    // and stay hidden through zoom-out and the below-1 rubber band.
    test('hides chrome instantly on a two-finger touch and keeps it hidden until the pinch fully settles', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'synthetic touch cases run on mobile projects');
      await openReader(page, site, mode);
      test.skip(!await fakeScale(page, 1), 'this browser does not allow visualViewport scale stubbing');
      const state = () => page.evaluate(() => ({
        moving: document.querySelector('.ehtw-reader-root').classList.contains('ehtw-reader-chrome-moving'),
        opacity: getComputedStyle(document.querySelector('.ehtw-reader-controls')).opacity,
        toolsOpacity: getComputedStyle(document.querySelector('.ehtw-reader-page-tools')).opacity
      }));
      const touch = (type, count) => page.evaluate(([t, n]) => {
        const e = new Event(t, { bubbles: true });
        Object.defineProperty(e, 'touches', { value: Array.from({ length: n }, (_, i) => ({ identifier: i + 1 })) });
        document.dispatchEvent(e);
      }, [type, count]);
      // Second finger lands at scale 1: hidden at once, no fade.
      const instant = await page.evaluate(() => {
        const e = new Event('touchstart', { bubbles: true });
        Object.defineProperty(e, 'touches', { value: [{ identifier: 1 }, { identifier: 2 }] });
        document.dispatchEvent(e);
        return getComputedStyle(document.querySelector('.ehtw-reader-controls')).opacity;
      });
      expect(instant, 'hidden in the same frame as the second finger').toBe('0');
      await fakeScale(page, 2.4);
      await page.evaluate(() => visualViewport.dispatchEvent(new Event('scroll')));
      expect((await state()).moving).toBe(true);
      // Zoomed back to 1 but fingers still down: still hidden, even after the watchdog runs.
      await fakeScale(page, 1);
      await page.evaluate(() => visualViewport.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(900);
      expect((await state()).moving, 'fingers still down').toBe(true);
      // Pinched below 1 (iOS rubber band), fingers lifted while bouncing back.
      await fakeScale(page, 0.8);
      await page.evaluate(() => visualViewport.dispatchEvent(new Event('resize')));
      await touch('touchend', 0);
      expect((await state()).moving, 'still rubber-banding below scale 1').toBe(true);
      await fakeScale(page, 0.9);
      await page.evaluate(() => visualViewport.dispatchEvent(new Event('resize')));
      expect((await state()).moving).toBe(true);
      await fakeScale(page, 1);
      await page.evaluate(() => visualViewport.dispatchEvent(new Event('resize')));
      const settled = await state();
      expect(settled.moving).toBe(false);
      expect(settled.opacity).toBe('1');
      expect(settled.toolsOpacity).toBe('1');
      // A single-finger touch at scale 1 never hides the chrome.
      await touch('touchstart', 1);
      expect((await state()).moving).toBe(false);
      await touch('touchend', 0);
    });

    test('restores chrome when a below-1 scale never settles back to exactly 1', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'synthetic touch cases run on mobile projects');
      await openReader(page, site, mode);
      test.skip(!await fakeScale(page, 1), 'this browser does not allow visualViewport scale stubbing');
      const moving = () => page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-chrome-moving'));
      await page.evaluate(() => {
        const s = new Event('touchstart', { bubbles: true }); Object.defineProperty(s, 'touches', { value: [{ identifier: 1 }, { identifier: 2 }] }); document.dispatchEvent(s);
      });
      await fakeScale(page, 0.95);
      await page.evaluate(() => {
        visualViewport.dispatchEvent(new Event('resize'));
        const e = new Event('touchend', { bubbles: true }); Object.defineProperty(e, 'touches', { value: [] }); document.dispatchEvent(e);
      });
      expect(await moving()).toBe(true);
      // The page stays at 0.95: the watchdog sees a stable scale and restores.
      await expect.poll(moving, { timeout: 3_000 }).toBe(false);
    });

    // 1.17.254 (user request): after hiding the toolbars and zooming in, a tap on
    // the centre of the visible screen must bring them back while still zoomed.
    test('a centre tap while zoomed shows the hidden chrome on screen, and movement hides it until it settles', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'visual viewport cases run on mobile projects');
      await openReader(page, site, mode);
      test.skip(!await fakeScale(page, 1), 'this browser does not allow visualViewport scale stubbing');
      const tapScreenCentre = () => page.evaluate(() => {
        const x = visualViewport.offsetLeft + visualViewport.width / 2;
        const vTop = visualViewport.offsetTop, vBottom = visualViewport.offsetTop + visualViewport.height;
        // Tap the vertical middle of the on-screen part of the visible image (click mode
        // letterboxes wide images at the top, so the screen centre can be black margin).
        const visible = [...document.querySelectorAll('.ehtw-reader-image-frame')].filter((f) => getComputedStyle(f).visibility !== 'hidden')
          .map((f) => ({ img: f.querySelector('.ehtw-reader-page-image'), b: f.getBoundingClientRect() }))
          .filter(({ b }) => b.width > 0 && b.bottom > vTop && b.top < vBottom)
          .sort((a, b) => (Math.min(b.b.bottom, vBottom) - Math.max(b.b.top, vTop)) - (Math.min(a.b.bottom, vBottom) - Math.max(a.b.top, vTop)));
        const { img, b } = visible[0];
        const y = (Math.max(b.top, vTop) + Math.min(b.bottom, vBottom)) / 2;
        img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      });
      const state = () => page.evaluate(() => {
        const root = document.querySelector('.ehtw-reader-root');
        const c = document.querySelector('.ehtw-reader-controls');
        const t = document.querySelector('.ehtw-reader-page-tools');
        const vv = { left: visualViewport.offsetLeft, top: visualViewport.offsetTop, right: visualViewport.offsetLeft + visualViewport.width, bottom: visualViewport.offsetTop + visualViewport.height };
        const inside = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.left >= vv.left - 1 && b.right <= vv.right + 1 && b.top >= vv.top - 1 && b.bottom <= vv.bottom + 1; };
        return {
          moving: root.classList.contains('ehtw-reader-chrome-moving'),
          settingsHidden: root.classList.contains('ehtw-reader-settings-hidden'),
          shown: getComputedStyle(c).display !== 'none' && getComputedStyle(c).opacity === '1' && getComputedStyle(t).display !== 'none' && getComputedStyle(t).opacity === '1',
          pointerEvents: getComputedStyle(c).pointerEvents,
          inside: inside(c) && inside(t),
          pageCount: document.querySelector('.ehtw-reader-page-count')?.textContent
        };
      });
      await tapScreenCentre();
      expect((await state()).settingsHidden, 'centre tap at scale 1 hides').toBe(true);
      // Zoom in to the right half of the page, so the screen centre is NOT the image centre.
      await fakeScale(page, 2);
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, 'offsetLeft', { configurable: true, value: document.documentElement.clientWidth / 2 });
        visualViewport.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(500);
      const before = await state();
      expect(before.shown).toBe(false);
      await tapScreenCentre();
      await page.waitForTimeout(150);
      const shown = await state();
      expect(shown.shown, JSON.stringify(shown)).toBe(true);
      expect(shown.pointerEvents).not.toBe('none');
      expect(shown.inside, `toolbars sit inside the visible screen ${JSON.stringify(shown)}`).toBe(true);
      expect(shown.pageCount, 'a centre tap never pages').toBe(before.pageCount);
      await page.waitForTimeout(900);
      expect((await state()).shown, 'stays shown while zoomed and still').toBe(true);
      // Panning hides it at once; it comes back after the page settles.
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 40 });
        visualViewport.dispatchEvent(new Event('scroll'));
      });
      expect((await state()).moving, 'hidden instantly while moving').toBe(true);
      await expect.poll(async () => (await state()).shown, { timeout: 2_000 }).toBe(true);
      expect((await state()).inside).toBe(true);
      // A new pinch hides it instantly.
      await page.evaluate(() => { const e = new Event('touchstart', { bubbles: true }); Object.defineProperty(e, 'touches', { value: [{ identifier: 1 }, { identifier: 2 }] }); document.dispatchEvent(e); });
      expect((await state()).moving).toBe(true);
      await page.evaluate(() => { const e = new Event('touchend', { bubbles: true }); Object.defineProperty(e, 'touches', { value: [] }); document.dispatchEvent(e); });
      await expect.poll(async () => (await state()).shown, { timeout: 2_000 }).toBe(true);
      // Another centre tap while zoomed hides it again, and zooming out keeps that choice.
      await tapScreenCentre();
      expect((await state()).settingsHidden).toBe(true);
      expect((await state()).shown).toBe(false);
      await fakeScale(page, 1);
      await page.evaluate(() => visualViewport.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(150);
      const out = await state();
      expect(out.moving).toBe(false);
      expect(out.settingsHidden).toBe(true);
      await tapScreenCentre();
      expect((await state()).shown).toBe(true);
    });

    // 1.17.254 (user report): hide the toolbars, pinch in, pinch back to the
    // original size; a centre tap must bring them back on screen even when iOS
    // never sends a final viewport event.
    test('chrome hidden before zooming comes back on screen after zooming back out', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'visual viewport cases run on mobile projects');
      await openReader(page, site, mode);
      test.skip(!await fakeScale(page, 1), 'this browser does not allow visualViewport scale stubbing');
      const tapCentre = () => page.evaluate(() => {
        const x = visualViewport.offsetLeft + visualViewport.width / 2;
        const vTop = visualViewport.offsetTop, vBottom = visualViewport.offsetTop + visualViewport.height;
        // Tap the vertical middle of the on-screen part of the visible image (click mode
        // letterboxes wide images at the top, so the screen centre can be black margin).
        const visible = [...document.querySelectorAll('.ehtw-reader-image-frame')].filter((f) => getComputedStyle(f).visibility !== 'hidden')
          .map((f) => ({ img: f.querySelector('.ehtw-reader-page-image'), b: f.getBoundingClientRect() }))
          .filter(({ b }) => b.width > 0 && b.bottom > vTop && b.top < vBottom)
          .sort((a, b) => (Math.min(b.b.bottom, vBottom) - Math.max(b.b.top, vTop)) - (Math.min(a.b.bottom, vBottom) - Math.max(a.b.top, vTop)));
        const { img, b } = visible[0];
        const y = (Math.max(b.top, vTop) + Math.min(b.bottom, vBottom)) / 2;
        img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      });
      const rects = () => page.evaluate(() => ['.ehtw-reader-controls', '.ehtw-reader-page-tools'].map((s) => {
        const e = document.querySelector(s); const b = e.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), display: getComputedStyle(e).display, opacity: getComputedStyle(e).opacity };
      }));
      const baseline = await rects();
      await tapCentre();
      expect((await rects()).every((r) => r.display === 'none')).toBe(true);
      for (const silent of [false, true]) {
        await page.evaluate(() => { const e = new Event('touchstart', { bubbles: true }); Object.defineProperty(e, 'touches', { value: [{ identifier: 1 }, { identifier: 2 }] }); document.dispatchEvent(e); });
        await fakeScale(page, 2.5);
        await page.evaluate(() => visualViewport.dispatchEvent(new Event('resize')));
        await page.waitForTimeout(300);
        await fakeScale(page, 1);
        if (!silent) await page.evaluate(() => visualViewport.dispatchEvent(new Event('resize')));
        await page.evaluate(() => { const e = new Event('touchend', { bubbles: true }); Object.defineProperty(e, 'touches', { value: [] }); document.dispatchEvent(e); });
        await page.waitForTimeout(600);
        await tapCentre();
        await page.waitForTimeout(150);
        const after = await rects();
        for (let i = 0; i < 2; i++) {
          expect(after[i].display, `silent=${silent}`).not.toBe('none');
          expect(after[i].opacity).toBe('1');
          for (const k of ['top', 'bottom', 'left', 'right']) expect(Math.abs(after[i][k] - baseline[i][k]), `silent=${silent} ${k} ${JSON.stringify({ baseline, after })}`).toBeLessThanOrEqual(2);
        }
        await tapCentre();
      }
    });
  });
}

// Regression coverage for the 1.17.244 audit findings. Keep these cases
// additive: the earlier native zoom assertions above are intentionally intact.
for (const mode of modes) {
  test.describe(`native zoom reader regressions (${mode})`, () => {
    test('does not fade on toolbar touches and keeps zoom controls tappable', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'native touch cases run on mobile projects');
      await openReader(page, site, mode);
      test.skip(!await fakeScale(page, 2), 'this browser does not allow visualViewport scale stubbing');
      const button = page.locator('.ehtw-reader-zoom-button').first();
      const pageBefore = await page.locator('.ehtw-reader-page-count').textContent();
      const zoomBefore = await page.locator('.ehtw-reader-zoom-input').inputValue();
      await button.dispatchEvent('touchstart', { touches: [{ identifier: 1 }] });
      const during = await button.evaluate((el) => ({
        moving: document.querySelector('.ehtw-reader-root').classList.contains('ehtw-reader-chrome-moving'),
        pointerEvents: getComputedStyle(el).pointerEvents
      }));
      expect(during.moving).toBe(false);
      expect(during.pointerEvents).not.toBe('none');
      await page.evaluate(() => {
        const end = new Event('touchend', { bubbles: true });
        Object.defineProperty(end, 'touches', { value: [] });
        document.dispatchEvent(end);
      });
      await button.tap();
      const zoomAfter = await page.locator('.ehtw-reader-zoom-input').inputValue();
      expect(Number(zoomAfter)).not.toBe(Number(zoomBefore));
      expect(await page.locator('.ehtw-reader-page-count').textContent()).toBe(pageBefore);
    });

    test('tracks touch lifecycle from unzoomed state and waits for fingers to lift', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'native touch cases run on mobile projects');
      await openReader(page, site, mode);
      test.skip(!await fakeScale(page, 2), 'this browser does not allow visualViewport scale stubbing');
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 1 });
        Object.defineProperty(visualViewport, 'width', { configurable: true, value: innerWidth });
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: innerHeight });
        visualViewport.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(40);
      await page.evaluate(() => {
        const root = document.querySelector('.ehtw-reader-root');
        const before = root.classList.contains('ehtw-reader-chrome-moving');
        const start = new Event('touchstart', { bubbles: true, cancelable: true });
        Object.defineProperty(start, 'touches', { value: [{ identifier: 1 }, { identifier: 2 }] });
        document.querySelector('.ehtw-reader-page-image').dispatchEvent(start);
        window.__ehtwTestUnzoomedBefore = before;
        window.__ehtwTestStartPrevented = start.defaultPrevented;
        Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 2 });
        Object.defineProperty(visualViewport, 'width', { configurable: true, value: innerWidth / 2 });
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: innerHeight / 2 });
        visualViewport.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => window.__ehtwTestStartPrevented)).toBe(false);
      expect(await page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-chrome-moving'))).toBe(true);
      await page.evaluate(() => {
        const end = new Event('touchend', { bubbles: true });
        Object.defineProperty(end, 'touches', { value: [] });
        document.dispatchEvent(end);
      });
      await page.waitForTimeout(240);
      // 1.17.247: fingers lifted but still zoomed, so chrome remains hidden.
      expect(await page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-chrome-moving'))).toBe(true);

      await page.evaluate(() => {
        Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 1 });
        Object.defineProperty(visualViewport, 'width', { configurable: true, value: innerWidth });
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: innerHeight });
        visualViewport.dispatchEvent(new Event('scroll'));
        const target = document.querySelector('.ehtw-reader-page-image');
        const start = new Event('touchstart', { bubbles: true, cancelable: true });
        Object.defineProperty(start, 'touches', { value: [{ identifier: 3 }] });
        target.dispatchEvent(start);
        const move = new Event('touchmove', { bubbles: true, cancelable: true });
        Object.defineProperty(move, 'touches', { value: [{ identifier: 3 }] });
        target.dispatchEvent(move);
        window.__ehtwTestUnzoomedTouch = {
          moving: document.querySelector('.ehtw-reader-root').classList.contains('ehtw-reader-chrome-moving'),
          startPrevented: start.defaultPrevented,
          movePrevented: move.defaultPrevented
        };
      });
      const unzoomed = await page.evaluate(() => window.__ehtwTestUnzoomedTouch);
      expect(unzoomed.moving).toBe(false);
      if (mode === 'scroll') expect(unzoomed.movePrevented).toBe(false);
    });

    // 1.17.247 replaces "only image movement fades chrome": chrome is hidden for the
    // whole native zoom (toolbars unreachable), and unzoomed slider use never hides it.
    test('keeps chrome hidden and untouchable through native zoom, and slider use at scale 1 never hides it', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'native touch cases run on mobile projects');
      await openReader(page, site, mode);
      test.skip(!await fakeScale(page, 2), 'this browser does not allow visualViewport scale stubbing');
      const dispatchTouch = (selector, type, touches) => page.locator(selector).first().evaluate((el, { eventType, points }) => {
        const event = new Event(eventType, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'touches', { value: points });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      }, { eventType: type, points: touches });
      await page.evaluate(() => visualViewport.dispatchEvent(new Event('scroll')));
      await dispatchTouch('.ehtw-reader-page-image', 'touchstart', [{ identifier: 1 }]);
      expect(await dispatchTouch('.ehtw-reader-page-image', 'touchmove', [{ identifier: 1 }]), 'zoomed pan is never canceled').toBe(false);
      await dispatchTouch('.ehtw-reader-page-image', 'touchend', []);
      await page.waitForTimeout(400);
      expect(await page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-chrome-moving'))).toBe(true);
      expect(await page.locator('.ehtw-reader-page-slider').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 1 });
        Object.defineProperty(visualViewport, 'width', { configurable: true, value: window.innerWidth });
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: window.innerHeight });
        visualViewport.dispatchEvent(new Event('scroll'));
      });
      expect(await page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-chrome-moving'))).toBe(false);
      const slider = page.locator('.ehtw-reader-page-slider');
      await slider.dispatchEvent('touchstart', { touches: [{ identifier: 2 }] });
      await slider.dispatchEvent('touchmove', { touches: [{ identifier: 2 }] });
      expect(await page.locator('.ehtw-reader-root').evaluate((e) => e.classList.contains('ehtw-reader-chrome-moving'))).toBe(false);
      expect(await slider.evaluate((el) => getComputedStyle(el).pointerEvents)).not.toBe('none');
      await page.evaluate(() => { const end = new Event('touchend', { bubbles: true }); Object.defineProperty(end, 'touches', { value: [] }); document.dispatchEvent(end); });
    });

    test('keeps chrome at the same screen margins for zoom offsets and layout widths', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'visual viewport geometry cases run on mobile projects');
      await openReader(page, site, mode);
      await page.evaluate(() => {
        const start = new Event('touchstart', { bubbles: true });
        Object.defineProperty(start, 'touches', { value: [{ identifier: 1 }, { identifier: 2 }] });
        document.querySelector('.ehtw-reader-page-image').dispatchEvent(start);
      });
      test.skip(!await fakeScale(page, 2), 'this browser does not allow visualViewport scale stubbing');
      const baseline = await page.evaluate(() => {
        const controls = document.querySelector('.ehtw-reader-controls').getBoundingClientRect();
        const tools = document.querySelector('.ehtw-reader-page-tools').getBoundingClientRect();
        return {
          top: controls.top,
          bottom: document.documentElement.clientHeight - tools.bottom,
          left: tools.left,
          right: document.documentElement.clientWidth - tools.right,
          center: document.documentElement.clientWidth / 2
        };
      });
      for (const scenario of [
        { scale: 2, left: 40, top: 300 },
        { scale: 3, left: 0, top: 0 }
      ]) for (const innerSizeFactor of [null, 0.5, 4]) {
        await page.evaluate(({ scale, left, top, factor }) => {
          const layoutWidth = document.documentElement.clientWidth;
          const layoutHeight = document.documentElement.clientHeight;
          const desiredWidth = factor === null ? window.innerWidth : layoutWidth * factor;
          const desiredHeight = factor === null ? window.innerHeight : layoutHeight * factor;
          Object.defineProperty(window, 'innerWidth', { configurable: true, value: desiredWidth });
          Object.defineProperty(window, 'innerHeight', { configurable: true, value: desiredHeight });
          Object.defineProperty(visualViewport, 'scale', { configurable: true, value: scale });
          Object.defineProperty(visualViewport, 'width', { configurable: true, value: layoutWidth / scale });
          Object.defineProperty(visualViewport, 'height', { configurable: true, value: layoutHeight / scale });
          Object.defineProperty(visualViewport, 'offsetLeft', { configurable: true, value: left });
          Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: top });
          visualViewport.dispatchEvent(new Event('scroll'));
        }, { ...scenario, factor: innerSizeFactor });
        await page.waitForTimeout(70);
        const actual = await page.evaluate(() => {
          const controls = document.querySelector('.ehtw-reader-controls').getBoundingClientRect();
          const tools = document.querySelector('.ehtw-reader-page-tools').getBoundingClientRect();
          const scale = visualViewport.scale;
          return {
            top: Math.round((controls.top - visualViewport.offsetTop) * scale),
            bottom: Math.round((visualViewport.offsetTop + visualViewport.height - tools.bottom) * scale),
            left: Math.round((tools.left - visualViewport.offsetLeft) * scale),
            right: Math.round((visualViewport.offsetLeft + visualViewport.width - tools.right) * scale),
            center: Math.round((controls.left + controls.width / 2 - visualViewport.offsetLeft) * scale)
          };
        });
        for (const key of ['top', 'bottom', 'left', 'right']) expect(Math.abs(actual[key] - baseline[key]), `${key} margin: ${actual[key]} vs ${baseline[key]} at ${JSON.stringify({ scenario, innerSizeFactor })}`).toBeLessThanOrEqual(2);
        expect(Math.abs(actual.left - actual.right)).toBeLessThanOrEqual(2);
        expect(Math.abs(actual.center - baseline.center)).toBeLessThanOrEqual(2);
      }
      await page.evaluate(() => {
        const end = new Event('touchend', { bubbles: true });
        Object.defineProperty(end, 'touches', { value: [] });
        document.dispatchEvent(end);
      });
    });

    test('logs numeric zoom diagnostics only when navigation logging is enabled', async ({ page, site }, info) => {
      test.skip(!isMobile(info), 'visual viewport cases run on mobile projects');
      const gallery = site.state.galleries[0];
      await open(page, `${site.readerUrl(EH, gallery, 6)}#ehtw-navlog-on`, { waitFor: 'html.ehtw-reader' });
      await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
      await ui(page).locator('.ehtw-reader-mode').nth(mode === 'click' ? 1 : 0).click();
      test.skip(!await fakeScale(page, 2), 'this browser does not allow visualViewport scale stubbing');
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 1 });
        Object.defineProperty(visualViewport, 'width', { configurable: true, value: innerWidth });
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: innerHeight });
        visualViewport.dispatchEvent(new Event('scroll'));
        const start = new Event('touchstart', { bubbles: true }); Object.defineProperty(start, 'touches', { value: [{ identifier: 1 }] }); document.querySelector('.ehtw-reader-page-image').dispatchEvent(start);
        Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 2 });
        Object.defineProperty(visualViewport, 'width', { configurable: true, value: innerWidth / 2 });
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: innerHeight / 2 });
        visualViewport.dispatchEvent(new Event('scroll'));
        const end = new Event('touchend', { bubbles: true }); Object.defineProperty(end, 'touches', { value: [] }); document.dispatchEvent(end);
      });
      await page.waitForTimeout(260);
      const entries = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
      const diagnostics = entries.filter((entry) => entry.event === 'reader-native-zoom-diagnostic');
      expect(diagnostics.length).toBeGreaterThan(0);
      for (const key of ['scale', 'innerWidth', 'clientWidth', 'visualViewportWidth', 'windowResizeCount', 'visualViewportEventCount', 'maximumScale', 'scrollRewriteCount', 'userScrollRewriteCount', 'nonUserScrollJumpCount']) {
        expect(typeof diagnostics.at(-1)[key]).toBe('number');
      }
      expect(diagnostics.at(-1).windowResizeCount).toBe(0);
      await page.evaluate(() => localStorage.setItem('ehtw-navigation-log-enabled-v1', '0'));
      const disabledPage = await page.context().newPage();
      await open(disabledPage, site.readerUrl(EH, gallery, 6), { waitFor: 'html.ehtw-reader' });
      await disabledPage.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
      await ui(disabledPage).locator('.ehtw-reader-mode').nth(mode === 'click' ? 1 : 0).click();
      await fakeScale(disabledPage, 2);
      await disabledPage.evaluate(() => visualViewport.dispatchEvent(new Event('scroll')));
      const disabledEntries = await disabledPage.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
      expect(disabledEntries.filter((entry) => entry.event === 'reader-native-zoom-diagnostic')).toHaveLength(0);
      await disabledPage.close();
    });
  });
}

// Added by Claude audit (1.17.246): the FIRST zoom event may already report a
// shrunken innerHeight on iOS. The toolbar baseline must come from layout size.
for (const mode of modes) {
  for (const scenario of [{ scale: 2, left: 40, top: 300 }, { scale: 3, left: 0, top: 0 }]) {
    test(`first zoom with shrunken innerWidth/innerHeight keeps toolbars on screen in ${mode} mode (scale ${scenario.scale})`, async ({ page, site }, testInfo) => {
      test.skip(!isMobile(testInfo), 'visual viewport zoom is a mobile behavior');
      await openReader(page, site, mode);
      const measure = () => page.evaluate(() => {
        const v = visualViewport;
        const c = document.querySelector('.ehtw-reader-controls').getBoundingClientRect();
        const t = document.querySelector('.ehtw-reader-page-tools').getBoundingClientRect();
        return {
          top: (c.top - v.offsetTop) * v.scale,
          bottom: (v.offsetTop + v.height - t.bottom) * v.scale,
          left: (t.left - v.offsetLeft) * v.scale,
          right: (v.offsetLeft + v.width - t.right) * v.scale,
          centerOffset: ((c.left + c.width / 2) - (v.offsetLeft + v.width / 2)) * v.scale
        };
      });
      const baseline = await measure();
      const stubbed = await page.evaluate(({ scale, left, top }) => {
        if (!visualViewport) return false;
        const layoutWidth = document.documentElement.clientWidth;
        const layoutHeight = document.documentElement.clientHeight;
        try {
          Object.defineProperty(window, 'innerWidth', { configurable: true, value: layoutWidth / scale });
          Object.defineProperty(window, 'innerHeight', { configurable: true, value: layoutHeight / scale });
          Object.defineProperty(visualViewport, 'scale', { configurable: true, value: scale });
          Object.defineProperty(visualViewport, 'width', { configurable: true, value: layoutWidth / scale });
          Object.defineProperty(visualViewport, 'height', { configurable: true, value: layoutHeight / scale });
          Object.defineProperty(visualViewport, 'offsetLeft', { configurable: true, value: left });
          Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: top });
        } catch (_) { return false; }
        visualViewport.dispatchEvent(new Event('scroll'));
        return true;
      }, scenario);
      test.skip(!stubbed, 'this browser does not allow visualViewport stubbing');
      await page.waitForTimeout(500);
      const zoomed = await measure();
      const detail = JSON.stringify({ baseline, zoomed });
      expect(Math.abs(zoomed.bottom - baseline.bottom), `page tools bottom margin ${detail}`).toBeLessThanOrEqual(2);
      expect(Math.abs(zoomed.top - baseline.top), `controls top margin ${detail}`).toBeLessThanOrEqual(2);
      expect(Math.abs(zoomed.left - zoomed.right), `page tools left/right symmetry ${detail}`).toBeLessThanOrEqual(2);
      expect(Math.abs(zoomed.centerOffset), `controls centered ${detail}`).toBeLessThanOrEqual(2);
    });
  }
}

// 1.17.255: status bar diagnostic is gated by the nav log and numeric-only.
test('reader status bar diagnostic is numeric-only and only logged with the nav log on', async ({ page, site }, info) => {
  test.skip(!isMobile(info), 'mobile reader diagnostic');
  const gallery = site.state.galleries[0];
  await open(page, `${site.readerUrl(EH, gallery, 6)}#ehtw-navlog-on`, { waitFor: 'html.ehtw-reader' });
  await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
  const read = (p) => p.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]').filter((e) => e.event === 'reader-status-bar-diagnostic'));
  await expect.poll(async () => (await read(page)).length, { timeout: 3_000 }).toBeGreaterThan(0);
  const entry = (await read(page))[0];
  for (const [key, value] of Object.entries(entry)) {
    if (['timestamp', 'event'].includes(key)) continue;
    expect(typeof value, key).toBe('number');
  }
  for (const key of ['safeAreaTop', 'innerHeight', 'screenHeight', 'frameTop', 'clickMode']) expect(entry).toHaveProperty(key);
  expect(entry).not.toHaveProperty('href');
  await page.evaluate(() => localStorage.setItem('ehtw-navigation-log-enabled-v1', '0'));
  const off = await page.context().newPage();
  await open(off, site.readerUrl(EH, gallery, 6), { waitFor: 'html.ehtw-reader' });
  await off.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
  await off.waitForTimeout(800);
  expect(await read(off)).toHaveLength(0);
  await off.close();
});
