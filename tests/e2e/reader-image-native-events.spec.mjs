// The reader must keep native image interactions available in both modes.
import { test, expect, ui, open, EH, tap } from './harness.mjs';

async function openReader(page, site, mode) {
  const gallery = site.state.galleries[0];
  await open(page, site.readerUrl(EH, gallery, 6), { waitFor: 'html.ehtw-reader' });
  await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
  if (mode === 'click') {
    await ui(page).locator('.ehtw-reader-mode').nth(1).click();
    await expect(page.locator('html')).toHaveClass(/ehtw-reader-click/);
  }
  await expect.poll(() => ui(page).locator('#img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  return gallery;
}

for (const mode of ['scroll', 'click']) {
  test(`reader image keeps native hit testing and context menu in ${mode} mode`, async ({ page, site }) => {
    await openReader(page, site, mode);
    const result = await ui(page).locator('#img').evaluate((img) => {
      const rect = img.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      let delivered = false;
      let eventTargetIsImage = false;
      img.addEventListener('contextmenu', (event) => {
        delivered = true;
        eventTargetIsImage = event.target === img;
      }, { once: true });
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window });
      img.dispatchEvent(event);
      return {
        hitIsImage: hit === img,
        pointerEvents: getComputedStyle(img).pointerEvents,
        touchAction: getComputedStyle(img).touchAction,
        delivered,
        eventTargetIsImage,
        defaultPrevented: event.defaultPrevented,
      };
    });
    expect(result.pointerEvents, 'reader image remains pointer-interactive').not.toBe('none');
    expect(['auto', 'manipulation'].includes(result.touchAction) || /pinch-zoom/.test(result.touchAction),
      `reader image allows pinch zoom, got touch-action: ${result.touchAction}`).toBe(true);
    expect(result.hitIsImage, 'the image is the hit-tested element at its center').toBe(true);
    expect(result.delivered, 'contextmenu reaches the image').toBe(true);
    expect(result.eventTargetIsImage).toBe(true);
    expect(result.defaultPrevented, 'reader code leaves native context menus available').toBe(false);
  });
}

test('zoom toolbar stays on top of the image and remains clickable', async ({ page, site }, testInfo) => {
  await openReader(page, site, 'scroll');
  const input = ui(page).locator('.ehtw-reader-zoom-input');
  await input.fill('250');
  await input.dispatchEvent('change');
  await expect(page.locator('html')).toHaveClass(/ehtw-reader-zoomed/);

  const plus = ui(page).locator('.ehtw-reader-page-tools .ehtw-reader-zoom-button').last();
  const hit = await plus.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { button: target === button || button.contains(target), target: target?.className || target?.tagName || null };
  });
  expect(hit.button, `toolbar hit test resolves to its button, got ${hit.target}`).toBe(true);
  await tap(page, testInfo, plus);
  await expect(input).toHaveValue('260');
});
