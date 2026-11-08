// 1.17.267: after trying a document-load reader entry (265) and an in-page
// status-bar resample (266), the user chose to keep the in-page entry and accept
// the black status bar. This pins that choice: every device enters in-page.
import { test, expect, ui, open, EH, tap, navigate } from './harness.mjs';

const detailUrl = (g) => `${EH}/g/${g.gid}/${g.token}/`;

test('entering the reader from a detail page stays in-page; Back returns to the detail', async ({ page, site }, testInfo) => {
  const g = site.state.galleries[0];
  await open(page, detailUrl(g));
  await page.evaluate(() => { window.__ehtwSameDocumentMarker = 1; });
  await navigate(page, () => tap(page, testInfo, ui(page).locator('#gdt a').first()), /\/s\/[0-9a-f]+\//, 'ehtw-reader');
  await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 20_000 });
  expect(await page.evaluate(() => window.__ehtwSameDocumentMarker === 1)).toBe(true);
  expect(await page.evaluate(() => document.querySelectorAll('meta[name="theme-color"]').length)).toBe(0);
  await navigate(page, () => page.goBack(), new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
  await expect(ui(page).locator('#gdt a').first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/g/${g.gid}/${g.token}/`);
});
