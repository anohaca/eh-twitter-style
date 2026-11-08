// Pinch zoom must remain native while reader chrome stays fixed in visual space.
import { test, expect, ui, open, EH } from './harness.mjs';

async function openClickReader(page, site) {
  const gallery = site.state.galleries[0];
  await open(page, site.readerUrl(EH, gallery, 6), { waitFor: 'html.ehtw-reader' });
  await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
  await ui(page).locator('.ehtw-reader-mode').nth(1).click();
  await expect(page.locator('html')).toHaveClass(/ehtw-reader-click/);
  return gallery;
}

function isTouch(testInfo) {
  return /iphone|pixel/i.test(testInfo.project.name);
}

test.describe('reader pinch zoom', () => {
  for (const mode of ['scroll', 'click']) {
    for (const params of [
      { label: 'scale 2 with viewport offsets', scale: 2, width: 195, height: 332, offsetLeft: 40, offsetTop: 300 },
      { label: 'scale 3 at viewport origin', scale: 3, widthFactor: 3, heightFactor: 3, offsetLeft: 0, offsetTop: 0 }
    ]) {
      test(`keeps reader toolbar screen margins in ${mode} mode (${params.label})`, async ({ page, site }, testInfo) => {
        test.skip(!isTouch(testInfo), 'viewport pinch position checks run on mobile projects');
        const gallery = site.state.galleries[0];
        await open(page, site.readerUrl(EH, gallery, 6), { waitFor: 'html.ehtw-reader' });
        await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
        await ui(page).locator('.ehtw-reader-mode').nth(mode === 'click' ? 1 : 0).click();
        const result = await page.evaluate(async (config) => {
          const viewport = window.visualViewport;
          if (!viewport) return { supported: false };
          const controls = document.querySelector('.ehtw-reader-controls');
          const tools = document.querySelector('.ehtw-reader-page-tools');
          const baselineControls = controls.getBoundingClientRect();
          const baselineTools = tools.getBoundingClientRect();
          const baseline = {
            controlsTop: baselineControls.top,
            toolsBottom: window.innerHeight - baselineTools.bottom,
            toolsLeft: baselineTools.left,
            toolsRight: window.innerWidth - baselineTools.right
          };
          const original = Object.fromEntries(['width', 'height', 'offsetLeft', 'offsetTop', 'scale']
            .map((key) => [key, viewport[key]]));
          const desired = {
            width: config.width ?? window.innerWidth / config.widthFactor,
            height: config.height ?? window.innerHeight / config.heightFactor,
            offsetLeft: config.offsetLeft,
            offsetTop: config.offsetTop,
            scale: config.scale
          };
          try {
            for (const [key, value] of Object.entries(desired)) {
              Object.defineProperty(viewport, key, { configurable: true, value });
            }
          } catch (error) {
            for (const [key, value] of Object.entries(original)) {
              try { Object.defineProperty(viewport, key, { configurable: true, value }); } catch (_) {}
            }
            return { supported: false, reason: `cannot stub visualViewport: ${error.message}` };
          }
          viewport.dispatchEvent(new Event('resize'));
          viewport.dispatchEvent(new Event('scroll'));
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const controlRect = controls.getBoundingClientRect();
          const toolsRect = tools.getBoundingClientRect();
          const scale = viewport.scale;
          const screen = {
            controlsTop: (controlRect.top - viewport.offsetTop) * scale,
            controlsCenter: ((controlRect.left + controlRect.right) / 2 - viewport.offsetLeft) * scale,
            visibleCenter: viewport.width * scale / 2,
            toolsBottom: (viewport.offsetTop + viewport.height - toolsRect.bottom) * scale,
            toolsLeft: (toolsRect.left - viewport.offsetLeft) * scale,
            toolsRight: (viewport.offsetLeft + viewport.width - toolsRect.right) * scale
          };
          for (const [key, value] of Object.entries(original)) {
            try { Object.defineProperty(viewport, key, { configurable: true, value }); } catch (_) {}
          }
          viewport.dispatchEvent(new Event('resize'));
          viewport.dispatchEvent(new Event('scroll'));
          return { supported: true, baseline, screen, expected: {
            controlsTop: baseline.controlsTop,
            toolsBottom: baseline.toolsBottom,
            toolsLeft: baseline.toolsLeft,
            toolsRight: baseline.toolsRight
          } };
        }, params);
        test.skip(!result.supported, 'this browser does not allow visualViewport stubbing');
        expect(Math.abs(result.screen.toolsBottom - result.expected.toolsBottom), `page toolbar bottom screen margin ${JSON.stringify(result)}`).toBeLessThanOrEqual(2);
        expect(Math.abs(result.screen.toolsLeft - result.expected.toolsLeft), `page toolbar left screen margin ${JSON.stringify(result)}`).toBeLessThanOrEqual(2);
        expect(Math.abs(result.screen.toolsRight - result.expected.toolsRight), `page toolbar right screen margin ${JSON.stringify(result)}`).toBeLessThanOrEqual(2);
        expect(Math.abs(result.screen.toolsLeft - result.screen.toolsRight), `page toolbar left and right screen margins ${JSON.stringify(result)}`).toBeLessThanOrEqual(2);
        expect(Math.abs(result.screen.controlsTop - result.expected.controlsTop), `reader controls top screen margin ${JSON.stringify(result)}`).toBeLessThanOrEqual(2);
        expect(Math.abs(result.screen.controlsCenter - result.screen.visibleCenter), `reader controls centered in visual viewport ${JSON.stringify(result)}`).toBeLessThanOrEqual(2);
      });
    }
  }

  test('blocks single-finger page movement at fit zoom in click mode', async ({ page, site }, testInfo) => {
    test.skip(!isTouch(testInfo), 'synthetic touch behavior is exercised on mobile projects');
    await openClickReader(page, site);
    const result = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: [{ identifier: 1 }] });
      document.dispatchEvent(event);
      return { prevented: event.defaultPrevented, scrollY };
    });
    expect(result.prevented, 'single-finger touchmove is canceled at fit zoom').toBe(true);
    expect(result.scrollY, 'click reader remains at the top').toBe(0);
  });

  test('leaves two-finger pinch events uncanceled', async ({ page, site }, testInfo) => {
    test.skip(!isTouch(testInfo), 'synthetic touch behavior is exercised on mobile projects');
    await openClickReader(page, site);
    const prevented = await page.evaluate(() => {
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: [{ identifier: 1 }, { identifier: 2 }] });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented, 'two-finger pinch remains available to the browser').toBe(false);
  });

  test('keeps reader controls visually stable while the visual viewport is zoomed', async ({ page, site }) => {
    await openClickReader(page, site);
    const result = await page.evaluate(async () => {
      const viewport = window.visualViewport;
      if (!viewport) return { supported: false };
      const selectors = ['.ehtw-reader-controls', '.ehtw-reader-page-tools'];
      const before = Object.fromEntries(selectors.map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [selector, { width: rect.width, height: rect.height }];
      }));
      const original = {
        width: viewport.width, height: viewport.height,
        offsetLeft: viewport.offsetLeft, offsetTop: viewport.offsetTop,
        scale: viewport.scale
      };
      for (const [key, value] of Object.entries({
        width: Math.max(1, original.width / 2),
        height: Math.max(1, original.height / 2),
        offsetLeft: 12, offsetTop: 18, scale: 2
      })) {
        try { Object.defineProperty(viewport, key, { configurable: true, value }); }
        catch (_) { return { supported: false, reason: `cannot stub ${key}` }; }
      }
      let scrollToCalls = 0;
      const originalScrollTo = window.scrollTo;
      window.scrollTo = (...args) => { scrollToCalls += 1; return originalScrollTo.apply(window, args); };
      const scrollYBefore = window.scrollY;
      for (let i = 0; i < 5; i++) viewport.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = Object.fromEntries(selectors.map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [selector, { width: rect.width * viewport.scale, height: rect.height * viewport.scale }];
      }));
      const outcome = { supported: true, before, after, scrollToCalls, scrollYBefore, scrollYAfter: window.scrollY };
      window.scrollTo = originalScrollTo;
      for (const [key, value] of Object.entries(original)) {
        try { Object.defineProperty(viewport, key, { configurable: true, value }); } catch (_) {}
      }
      viewport.dispatchEvent(new Event('scroll'));
      return outcome;
    });
    test.skip(!result.supported, 'this browser does not allow visualViewport scale stubbing');
    for (const selector of ['.ehtw-reader-controls', '.ehtw-reader-page-tools']) {
      expect(Math.abs(result.after[selector].width - result.before[selector].width), `${selector} visual width`).toBeLessThanOrEqual(2);
      expect(Math.abs(result.after[selector].height - result.before[selector].height), `${selector} visual height`).toBeLessThanOrEqual(2);
    }
    expect(result.scrollToCalls, 'viewport updates never call scrollTo').toBe(0);
    expect(result.scrollYAfter, 'viewport updates never rewrite scrollY').toBe(result.scrollYBefore);
  });
});

// Added 1.17.248: iOS edge swipe-back must not be canceled by the click-mode
// scroll guard. Touches that start at a screen edge are left to the browser.
test.describe('click mode edge swipe', () => {
  for (const edge of ['left', 'right']) {
    test(`does not cancel a single-finger swipe starting at the ${edge} edge`, async ({ page, site }, testInfo) => {
      test.skip(!/iphone|pixel/i.test(testInfo.project.name), 'synthetic touch behavior is exercised on mobile projects');
      await openClickReader(page, site);
      const result = await page.evaluate((edge) => {
        const width = document.documentElement.clientWidth;
        const x = edge === 'left' ? 6 : width - 6;
        const fire = (type, clientX) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ identifier: 1, clientX, clientY: 300 }] });
          document.querySelector('.ehtw-reader-page-image').dispatchEvent(event);
          return event.defaultPrevented;
        };
        fire('touchstart', x);
        const edgeMovePrevented = fire('touchmove', edge === 'left' ? x + 60 : x - 60);
        fire('touchend', x);
        fire('touchstart', width / 2);
        const middleMovePrevented = fire('touchmove', width / 2 + 5);
        fire('touchend', width / 2);
        return { edgeMovePrevented, middleMovePrevented };
      }, edge);
      expect(result.edgeMovePrevented, 'edge swipe stays available for iOS back/forward').toBe(false);
      expect(result.middleMovePrevented, 'mid-screen drags at fit zoom are still blocked').toBe(true);
    });
  }
});
