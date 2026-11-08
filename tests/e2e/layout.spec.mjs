// Responsive three-column layout, theme and overflow across every page family.
// Runs in every project, so each assertion is evaluated on desktop, tablet,
// narrow desktop and phone viewports.
import { test, expect, ui, open, EH, EX, layoutOf, expectNoHorizontalOverflow, isVisible } from './harness.mjs';

const PAGES = [
  ['front', '/'],
  ['search', '/?f_search=glasses'],
  ['tag', '/tag/female:glasses'],
  ['uploader', '/uploader/carol'],
  ['watched', '/watched'],
  ['popular', '/popular'],
  ['detail', 'DETAIL'],
  ['detail-page-2', 'DETAIL?p=1'],
  ['toplists', '/toplist.php'],
  ['toplist-result', '/toplist.php?tl=15'],
  ['torrents', '/torrents.php'],
  ['news', '/news.php'],
  ['bounties', '/bounty.php'],
  ['my-home', '/home.php'],
  ['my-tags', '/mytags'],
  ['settings', '/uconfig.php'],
  ['hath-perks', '/hathperks.php'],
  ['logs', '/logs.php'],
  ['exhentai-front', 'EX/'],
  ['uploads-manage', 'https://upld.e-hentai.org/manage?ss=d&sd=d'],
  ['uploads-bounty-post', 'https://upld.e-hentai.org/bounty_post.php'],
  ['exhentai-uploads', 'https://upld.exhentai.org/upld/manage']
];

function resolve(site, path) {
  const g = site.state.galleries[0];
  if (path.startsWith('DETAIL')) return `${EH}/g/${g.gid}/${g.token}/${path.slice(6)}`;
  if (path.startsWith('EX')) return `${EX}${path.slice(2)}`;
  if (path.startsWith('http')) return path;
  return `${EH}${path}`;
}

for (const [name, path] of PAGES) {
  test(`${name}: layout fits the viewport and follows the breakpoint rules`, async ({ page, site, diagnostics }, testInfo) => {
    await open(page, resolve(site, path));
    await expectNoHorizontalOverflow(page, name);
    const layout = layoutOf(testInfo);
    const box = async (sel) => page.locator(sel).first().boundingBox();
    const viewport = page.viewportSize();
    if (await ui(page).locator('#ehtw-shell').count()) {
      const center = await box('#ehtw-center');
      expect(center, 'center column exists').not.toBeNull();
      // Account / bounty / upload pages use a wide two-column layout (nav + 950px content).
      const wide = /ehtw-(myhome|bounty|myuploads)/.test(await page.locator('html').getAttribute('class'));
      if (layout === 'desktop') {
        expect(await isVisible(page, '#ehtw-left'), 'left column visible').toBe(true);
        expect(Math.round(center.width)).toBeLessThanOrEqual(wide ? 951 : 601);
        expect(Math.round(center.width)).toBeGreaterThanOrEqual(wide ? 900 : 560);
        if (wide) expect(await isVisible(page, '#ehtw-right'), 'wide pages have no right column').toBe(false);
        if (await ui(page).locator('#ehtw-right').count()) {
          const right = await box('#ehtw-right');
          if (right && right.width) expect(right.x).toBeGreaterThanOrEqual(center.x + center.width - 1);
        }
      }
      if (layout === 'tablet' || layout === 'phone') {
        expect(await isVisible(page, '#ehtw-right'), 'right column hidden below 1000px').toBe(false);
      }
      if (layout === 'phone') {
        expect(Math.round(center.width)).toBeGreaterThanOrEqual(viewport.width - 2);
        const left = await box('#ehtw-left');
        // Left navigation becomes a bottom tab bar pinned to the viewport bottom.
        expect(left, 'bottom tab bar').not.toBeNull();
        expect(Math.round(left.y + left.height)).toBeGreaterThanOrEqual(viewport.height - 2);
        expect(left.height).toBeLessThanOrEqual(90);
        expect(await ui(page).locator('#ehtw-left').evaluate((e) => getComputedStyle(e).position)).toBe('fixed');
      }
    }
    expect(diagnostics.pageErrors).toEqual([]);
  });
}

test('the list header is a 53px sticky bar that stays on top while scrolling', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit-iphone-13', 'mobile WebKit does not support mouse.wheel; touch scrolling is covered by the reader tests and Safari checklist');
  await open(page, `${EH}/`);
  const header = ui(page).locator('#ehtw-header');
  expect(Math.round((await header.boundingBox()).height)).toBe(53);
  await page.mouse.wheel(0, 2500);
  await page.evaluate(() => window.scrollTo(0, 2500));
  await page.waitForTimeout(200);
  const after = await header.boundingBox();
  expect(Math.round(after.y)).toBe(0);
  expect(await header.evaluate((e) => getComputedStyle(e).position)).toMatch(/sticky|fixed/);
});

test('theme follows prefers-color-scheme', async ({ page }, testInfo) => {
  await open(page, `${EH}/`);
  const scheme = testInfo.project.use.colorScheme || 'light';
  const colors = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.querySelector('.ehtw-tweet-title') || document.body).color
  }));
  if (scheme === 'dark') {
    expect(colors.bg).toBe('rgb(0, 0, 0)');
    expect(colors.text).toBe('rgb(231, 233, 234)');
  } else {
    expect(colors.bg).toBe('rgb(255, 255, 255)');
    expect(colors.text).toBe('rgb(15, 20, 25)');
  }
});

test('reader is a black full-bleed surface with no horizontal scroll', async ({ page, site }) => {
  await open(page, site.readerUrl(EH, site.state.galleries[0], 6), { waitFor: 'html.ehtw-reader' });
  await expectNoHorizontalOverflow(page, 'reader');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
  const frame = await ui(page).locator('.ehtw-reader-image-frame').first().boundingBox();
  expect(frame.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
});

test('phone bottom bar shows icon-only entries without horizontal scrolling', async ({ page }, testInfo) => {
  test.skip(layoutOf(testInfo) !== 'phone', 'phone-only layout');
  await open(page, `${EH}/`);
  const entries = await page.evaluate(() => [...document.querySelectorAll('#ehtw-left #nb > *')].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none';
  }).map((e) => {
    const r = e.getBoundingClientRect();
    const label = e.querySelector('.ehtw-nav-label');
    return { x: r.x, right: r.right, labelVisible: !!label && label.getBoundingClientRect().width > 0 && getComputedStyle(label).display !== 'none' };
  }));
  expect(entries.length).toBeGreaterThanOrEqual(4);
  expect(entries.length).toBeLessThanOrEqual(7);
  for (const entry of entries) {
    expect(entry.labelVisible).toBe(false);
    expect(entry.right).toBeLessThanOrEqual(page.viewportSize().width + 1);
  }
  const nb = ui(page).locator('#ehtw-left #nb');
  expect(await nb.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
});

test('phone content is not hidden behind the bottom bar at the end of the page', async ({ page }, testInfo) => {
  test.skip(layoutOf(testInfo) !== 'phone', 'phone-only layout');
  await open(page, `${EH}/popular`);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  const overlap = await page.evaluate(() => {
    const bar = document.querySelector('#ehtw-left').getBoundingClientRect();
    const tweets = [...document.querySelectorAll('.ehtw-tweet')];
    const last = tweets[tweets.length - 1]?.querySelector('.ehtw-twitter-actions')?.getBoundingClientRect();
    return last ? { lastBottom: last.bottom, barTop: bar.top } : null;
  });
  expect(overlap).not.toBeNull();
  expect(overlap.lastBottom).toBeLessThanOrEqual(overlap.barTop + 1);
});

test('desktop left navigation shows labels and the Post button', async ({ page }, testInfo) => {
  test.skip(layoutOf(testInfo) !== 'desktop', 'desktop-only layout');
  await open(page, `${EH}/`);
  await expect(ui(page).locator('#ehtw-left .ehtw-nav-label').first()).toBeVisible();
  await expect(ui(page).locator('#ehtw-left .ehtw-post-button')).toBeVisible();
  const current = ui(page).locator('#ehtw-left .ehtw-nav-current .ehtw-nav-label').first();
  await expect(current).toHaveText('Front Page');
  expect(Number(await current.evaluate((e) => getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(700);
});
