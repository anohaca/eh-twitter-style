// Gallery detail page as an expanded tweet: metadata, rating/favorite hooks,
// tags, thumbnail strip, comments and the operations menu.
import { test, expect, ui, open, EH, layoutOf, isTouch, hitTest, isVisible, tap, waitForRoute, navigate } from './harness.mjs';

const detailUrl = (g, query = '') => `${EH}/g/${g.gid}/${g.token}/${query}`;
const assertFavoriteWrite = (site, g, category, apply) => {
  const write = site.state.writes.at(-1);
  expect(write?.method).toBe('POST');
  expect(write?.url).toBe(`${EH}/gallerypopups.php?gid=${g.gid}&t=${g.token}&act=addfav`);
  expect(write?.contentType).toMatch(/^application\/x-www-form-urlencoded(?:;|$)/i);
  expect(write?.originHeader).toBe(EH);
  expect(write?.referer).toBe(`${EH}/gallerypopups.php?gid=${g.gid}&t=${g.token}&act=addfav`);
  const body = new URLSearchParams(write?.body || '');
  expect(body.get('favcat')).toBe(String(category));
  expect(body.get('favnote')).toBe('');
  expect(body.get('apply')).toBe(apply);
  expect(body.get('update')).toBe('1');
};

test.describe('expanded post', () => {
  test('header, author, titles and the comment count subtitle', async ({ page, site, diagnostics }) => {
    const g = site.state.galleries[0];
    await open(page, detailUrl(g));
    await expect(ui(page).locator('#ehtw-header .ehtw-context-title')).toHaveText('Post');
    await expect(ui(page).locator('#ehtw-header .ehtw-context-subtitle')).toHaveText(`${g.comments} comments`);
    await expect(ui(page).locator('.ehtw-detail-author .ehtw-avatar')).toHaveClass(new RegExp(g.category[0]));
    await expect(ui(page).locator('.ehtw-detail-author .ehtw-handle')).toHaveText(`@${g.uploader}`);
    await expect(ui(page).locator('#gn')).toHaveText(g.title);
    await expect(ui(page).locator('#gj')).toHaveText(g.jtitle);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('single comment uses the singular label', async ({ page, site }) => {
    const g = site.state.galleries.find((x) => x.comments === 1);
    await open(page, detailUrl(g));
    await expect(ui(page).locator('#ehtw-header .ehtw-context-subtitle')).toHaveText('1 comment');
  });

  test('stats row reads pages, rating, rating count, favorites and comments from the native page', async ({ page, site }) => {
    const g = site.state.galleries[0];
    await open(page, detailUrl(g));
    const stats = await ui(page).locator('.ehtw-detail-stat').evaluateAll((items) =>
      Object.fromEntries(items.map((e) => [e.querySelector('span')?.textContent.trim(), e.querySelector('strong')?.textContent.trim()])));
    expect(stats.Pages).toBe(String(g.pages));
    expect(Number(stats.Rating)).toBeCloseTo(g.rating, 1);
    expect(stats.Ratings).toBe(String(g.ratingCount));
    expect(stats.Favorites).toBe(String(g.favorites));
    expect(stats.Comments).toBe(String(g.comments));
    await expect(ui(page).locator('.ehtw-detail-timestamp')).toHaveText(/\d{4}.*\d{1,2}:\d{2} (AM|PM)/);
  });

  test('About card: right column on desktop, inline on smaller screens', async ({ page, site }, testInfo) => {
    await open(page, detailUrl(site.state.galleries[0]));
    if (layoutOf(testInfo) === 'desktop') {
      await expect(ui(page).locator('#ehtw-right .ehtw-about-card #gdd')).toBeVisible();
    } else {
      // Below 1000px the right column is hidden, so the metadata must move inline.
      await expect(ui(page).locator('#gdd'), 'gallery metadata (#gdd) is visible on load below 1000px').toBeVisible();
      expect(await ui(page).locator('#gdd').evaluate((e) => !!e.closest('#ehtw-center'))).toBe(true);
    }
    await expect(ui(page).locator('#gdd')).toContainText('File Size:');
  });

  test('About card follows viewport changes across the 1000px breakpoint', async ({ page, site }, testInfo) => {
    test.skip(isTouch(testInfo), 'resizing is a desktop scenario');
    const original = page.viewportSize();
    await page.setViewportSize({ width: 1400, height: 900 });
    await open(page, detailUrl(site.state.galleries[0]));
    await expect(ui(page).locator('#ehtw-right #gdd')).toBeVisible();
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(ui(page).locator('#gdd')).toBeVisible();
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(ui(page).locator('#ehtw-right #gdd')).toBeVisible();
    await page.setViewportSize(original);
  });
});

test.describe('native controls keep working', () => {
  test('rating stars are hittable and the real rating_set posts to api.php', async ({ page, site }, testInfo) => {
    await open(page, detailUrl(site.state.galleries[0]));
    const hit = await hitTest(page, '#rating_image');
    expect(hit.found).toBe(true);
    expect(hit.hit, `rating covered by ${hit.top}`).toBe(true);
    // Image maps are not reliably clickable through Playwright's actionability
    // checks, so dispatch a real pointer click at the 4th star area.
    const box = await ui(page).locator('#rating_image').boundingBox();
    await page.mouse.click(box.x + 4 * 8 - 2, box.y + box.height / 2);
    await expect.poll(() => site.state.writes.filter((write) => new URL(write.url).pathname === '/api.php').length).toBeGreaterThan(0);
  });

  test('the favorite action opens the browser folder list and saves without navigating', async ({ page, site }, testInfo) => {
    const g = site.state.galleries[0];
    await open(page, detailUrl(g));
    const fav = ui(page).locator('.ehtw-detail-favorite-action');
    await expect(fav.locator('.ehtw-detail-favorite-count')).toHaveText(String(g.favorites));
    const detailPageUrl = page.url();
    await tap(page, testInfo, fav);
    const picker = ui(page).locator('.ehtw-browser-favorite-picker');
    await expect(picker).toBeVisible();
    expect(page.url(), 'the folder chooser does not replace the detail page').toBe(detailPageUrl);
    expect(site.state.writes).toEqual([]);
    // Model a mobile OS picker click retargeted to the document before its
    // select change event. The capture pointerdown must not remove the picker.
    await expect.poll(() => picker.evaluate((element) => document.activeElement === element)).toBe(true);
    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })));
    await expect(picker).toHaveCount(1);
    await picker.selectOption('3');
    await expect.poll(() => site.state.favorites.get(`/g/${g.gid}/${g.token}/`)).toBe(3);
    assertFavoriteWrite(site, g, 3, 'Add to Favorites');
    await expect(picker).toHaveCount(0);
    await expect(fav).toHaveClass(/ehtw-liked/);
    await tap(page, testInfo, fav);
    await expect.poll(() => site.state.favorites.has(`/g/${g.gid}/${g.token}/`)).toBe(false);
    await expect(fav).not.toHaveClass(/ehtw-liked/);
    expect(site.state.writes.at(-1)?.body).toContain('favcat=favdel');
    expect(site.state.writes.at(-1)?.body).toContain('apply=Apply+Changes');
    expect(page.url()).toBe(detailPageUrl);
  });

  test('favorite save errors remain visible without navigating', async ({ page, site }, testInfo) => {
    const g = site.state.galleries[0];
    const path = `/g/${g.gid}/${g.token}/`;
    site.state.faults.push({ name: 'favorite-post-failure', path: '/gallerypopups.php', method: 'POST', type: 'fetch', status: 500, times: 1, routerOnly: false });
    await open(page, detailUrl(g));
    const detailPageUrl = page.url();
    await tap(page, testInfo, ui(page).locator('.ehtw-detail-favorite-action'));
    const picker = ui(page).locator('.ehtw-browser-favorite-picker');
    await expect(picker).toBeVisible();
    await picker.selectOption('3');
    const error = ui(page).locator('.ehtw-browser-favorite-error');
    await expect(error).toContainText(/Unable to save favorite \(500\)/);
    expect(site.state.favorites.has(path)).toBe(false);
    expect(page.url()).toBe(detailPageUrl);
  });

  test('an existing favorite is recognized and removed on the next click', async ({ page, site }, testInfo) => {
    const g = site.state.galleries[0];
    const path = `/g/${g.gid}/${g.token}/`;
    site.state.favorites.set(path, 2);
    await open(page, detailUrl(g));
    const detailPageUrl = page.url();
    const favorite = ui(page).locator('.ehtw-detail-favorite-action');
    await expect(favorite).toHaveClass(/ehtw-liked/);
    await tap(page, testInfo, favorite);
    const picker = ui(page).locator('.ehtw-browser-favorite-picker');
    await expect(picker).toHaveCount(0);
    await expect.poll(() => site.state.favorites.has(path)).toBe(false);
    await expect(favorite).not.toHaveClass(/ehtw-liked/);
    expect(site.state.writes.at(-1)?.body).toContain('favcat=favdel');
    expect(site.state.writes.at(-1)?.body).toContain('apply=Apply+Changes');
    expect(page.url()).toBe(detailPageUrl);
  });

  test('failed removal keeps the favorite marked and reports the error', async ({ page, site }, testInfo) => {
    const g = site.state.galleries[0];
    const path = `/g/${g.gid}/${g.token}/`;
    site.state.favorites.set(path, 2);
    site.state.faults.push({ name: 'favorite-remove-failure', path: '/gallerypopups.php', method: 'POST', type: 'fetch', status: 403, times: 1, routerOnly: false });
    await open(page, detailUrl(g));
    const favorite = ui(page).locator('.ehtw-detail-favorite-action');
    await expect(favorite).toHaveClass(/ehtw-liked/);
    await tap(page, testInfo, favorite);
    await expect(ui(page).locator('.ehtw-browser-favorite-error')).toContainText(/403/);
    expect(site.state.favorites.get(path)).toBe(2);
    await expect(favorite).toHaveClass(/ehtw-liked/);
  });

  test('hashtags are rendered as #tags and keep their native ids, handlers and the new-tag form', async ({ page, site }, testInfo) => {
    const g = site.state.galleries[6];
    await open(page, detailUrl(g));
    const tags = ui(page).locator('#taglist a[id^="ta_"]');
    expect(await tags.count()).toBe(g.tags.length);
    for (const text of await tags.allTextContents()) expect(text).toMatch(/^#\S+$/);
    expect(await ui(page).locator('#taglist td.tc').evaluateAll((e) => e.every((x) => getComputedStyle(x).display === 'none'))).toBe(true);
    for (const handler of await tags.evaluateAll((a) => a.map((x) => x.getAttribute('onclick')))) expect(handler).toMatch(/toggle_tagmenu/);
    await expect(ui(page).locator('#newtagfield')).toBeVisible();
    await expect(ui(page).locator('#newtagbutton')).toBeVisible();
    const expand = ui(page).locator('.ehtw-detail-tags .ehtw-detail-expand-button');
    if (await expand.isVisible()) await tap(page, testInfo, expand);
    // Tapping a tag runs the native tag menu handler; the script may then open the tag listing.
    await tap(page, testInfo, tags.first());
    await page.waitForTimeout(600);
    if (/\/tag\//.test(page.url())) await waitForRoute(page, /\/tag\//, 'ehtw-list');
    else await expect.poll(() => page.evaluate(() => window.__nativeCalls.filter((c) => c.name === 'toggle_tagmenu').length)).toBe(1);
  });

  test('the ⋯ menu exposes every #gd5 operation', async ({ page, site }, testInfo) => {
    await open(page, detailUrl(site.state.galleries[0]));
    await tap(page, testInfo, ui(page).locator('.ehtw-detail-author .ehtw-menu-button'));
    const menu = ui(page).locator('.ehtw-detail-author .ehtw-menu');
    await expect(menu).toBeVisible();
    for (const label of ['Report Gallery', 'Archive Download', 'Torrent Download', 'Petition to Expunge', 'Petition to Rename', 'Show Gallery Stats']) {
      await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
    }
    const box = await menu.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    await tap(page, testInfo, menu.getByText('Archive Download').first());
    await expect.poll(() => page.evaluate(() => window.__nativeCalls.filter((c) => c.name === 'popUp').map((c) => c.detail).join(' '))).toContain('archiver.php');
  });
});

test.describe('thumbnail strip', () => {
  test('thumbnails link to reader pages and the strip scrolls horizontally', async ({ page, site }) => {
    const g = site.state.galleries[0];
    await open(page, detailUrl(g));
    const links = ui(page).locator('#gdt a');
    expect(await links.count()).toBe(20);
    expect(await links.first().getAttribute('href')).toBe(site.readerUrl(EH, g, 1));
    const strip = await ui(page).locator('#gdt').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, ox: getComputedStyle(e).overflowX }));
    expect(strip.sw).toBeGreaterThan(strip.cw);
    expect(strip.ox).toMatch(/auto|scroll/);
  });

  test('mouse wheel over the strip scrolls it sideways (desktop)', async ({ page, site }, testInfo) => {
    test.skip(isTouch(testInfo), 'wheel is a pointer interaction');
    await open(page, detailUrl(site.state.galleries[0]));
    const strip = ui(page).locator('#gdt');
    await strip.scrollIntoViewIfNeeded();
    const box = await strip.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await strip.evaluate((e) => e.scrollLeft);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => strip.evaluate((e) => e.scrollLeft)).toBeGreaterThan(before);
  });

  test('scrolling the strip to its end loads the following thumbnail pages', async ({ page, site, diagnostics }) => {
    const g = site.state.galleries[0]; // 45 pages → 3 thumbnail pages
    await open(page, detailUrl(g));
    const strip = ui(page).locator('#gdt');
    for (let i = 0; i < 6 && await ui(page).locator('#gdt a').count() < g.pages; i += 1) {
      await strip.evaluate((e) => { e.scrollLeft = e.scrollWidth; });
      await page.waitForTimeout(500);
    }
    await expect.poll(() => ui(page).locator('#gdt a').count(), { timeout: 10_000 }).toBe(g.pages);
    const hrefs = await ui(page).locator('#gdt a').evaluateAll((a) => a.map((x) => x.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.at(-1)).toBe(site.readerUrl(EH, g, g.pages));
    await expect(ui(page).locator('.ehtw-gallery-continuation')).toHaveAttribute('data-state', 'done');
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('Expand shows a grid with working thumbnail pagination, and the choice is remembered', async ({ page, site }, testInfo) => {
    const g = site.state.galleries[0];
    await open(page, detailUrl(g));
    const button = ui(page).locator('.ehtw-gallery-grid-section .ehtw-detail-expand-button');
    await tap(page, testInfo, button);
    await expect(ui(page).locator('.ehtw-gallery-grid-section')).toHaveClass(/ehtw-gallery-grid-expanded/);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const grid = await ui(page).locator('#gdt').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, h: e.getBoundingClientRect().height }));
    expect(grid.sw).toBeLessThanOrEqual(grid.cw + 1); // wraps instead of scrolling sideways
    const next = ui(page).locator('.ehtw-gallery-pagination:visible a', { hasText: '2' }).first();
    await expect(next).toBeVisible();
    await navigate(page, () => tap(page, testInfo, next), /\?p=1/, 'ehtw-detail');
    await expect(ui(page).locator('.ehtw-gallery-grid-section')).toHaveClass(/ehtw-gallery-grid-expanded/);
    expect(await ui(page).locator('#gdt a').first().getAttribute('href')).toBe(site.readerUrl(EH, g, 21));
  });

  test('tapping a thumbnail opens the reader at that page', async ({ page, site }, testInfo) => {
    const g = site.state.galleries[0];
    await open(page, detailUrl(g));
    await navigate(page, () => tap(page, testInfo, ui(page).locator('#gdt a').nth(2)), new RegExp(`/s/[0-9a-f]+/${g.gid}-3$`), 'ehtw-reader');
    await expect(ui(page).locator('.ehtw-reader-page-count')).toHaveText(`3 / ${g.pages}`);
  });

  test('a later thumbnail page (?p=1) renders its own range', async ({ page, site }) => {
    const g = site.state.galleries[0];
    await open(page, detailUrl(g, '?p=1'));
    expect(await ui(page).locator('#gdt a').first().getAttribute('href')).toBe(site.readerUrl(EH, g, 21));
  });
});

test.describe('replies', () => {
  test('each comment becomes a reply tweet with author, handle, time and body text', async ({ page, site }) => {
    const g = site.state.galleries[0];
    await open(page, detailUrl(g));
    const replies = ui(page).locator('#cdiv .c1.ehtw-comment-tweet');
    expect(await replies.count()).toBe(g.comments);
    const first = replies.first();
    await expect(first.locator('.ehtw-comment-author')).toHaveText(g.uploader);
    await expect(first.locator('.ehtw-comment-handle')).toHaveText(`@${g.uploader}`);
    await expect(first.locator('.ehtw-comment-time')).toHaveText(/^(now|\d+[mh]|[A-Z][a-z]{2} \d{1,2}(, \d{4})?)$/);
    await expect(first.locator('.c6')).toContainText('Comment number 1');
    // Comment text keeps literal "<not html>" as text.
    await expect(first.locator('.c6')).toContainText('<not html>');
    // Uploader comment label is not clipped ("Jploader" regression).
    await expect(first).not.toContainText('Jploader');
  });

  test('score shows the vote breakdown on hover without jumping away from the pointer', async ({ page, site }, testInfo) => {
    await open(page, detailUrl(site.state.galleries[0]));
    const like = ui(page).locator('.ehtw-comment-like .c5').first();
    await expect(like).toContainText(/\+\d+/);
    expect(await ui(page).locator('#comment_vote_up_1').getAttribute('onclick')).toContain('vote_comment_up(1)');
    test.skip(isTouch(testInfo), 'hover is pointer-only');
    await like.scrollIntoViewIfNeeded();
    const box = await like.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.waitForTimeout(150);
    await expect(ui(page).locator('#cvotes_1')).toBeVisible();
    // Revealing the votes must not move the score out from under the pointer
    // (otherwise mouseout hides it again and the row flickers).
    const stillUnder = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.c5'), { x, y });
    expect(stillUnder, 'score element still under the pointer after hover').toBe(true);
  });

  test('"Post your reply" opens the native comment form under the reply box', async ({ page, site }, testInfo) => {
    await open(page, detailUrl(site.state.galleries[0]));
    const hit = await hitTest(page, '#postnewcomment a');
    expect(hit.hit, `reply link covered by ${hit.top}`).toBe(true);
    await tap(page, testInfo, ui(page).locator('#postnewcomment a'));
    await expect(ui(page).locator('#formdiv')).toBeVisible();
    const form = await ui(page).locator('#formdiv').boundingBox();
    const box = await ui(page).locator('#ehtw-reply-box').boundingBox();
    expect(form.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
    expect(form.x + form.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    await expect(ui(page).locator('#formdiv textarea[name="commenttext_new"]')).toBeVisible();
  });

  test('the reply action in the toolbar jumps to the comments (in-page #hash link)', async ({ page, site }, testInfo) => {
    await open(page, detailUrl(site.state.galleries[0]));
    await page.evaluate(() => { document.querySelector('#ehtw-shell').dataset.testMarker = 'kept'; });
    await tap(page, testInfo, ui(page).locator('.ehtw-detail-reply-count'));
    await page.waitForTimeout(800);
    // A same-document #hash change must not rebuild the page or reset the scroll position.
    expect(await page.evaluate(() => document.querySelector('#ehtw-shell')?.dataset.testMarker), 'page was not rebuilt by the hash change').toBe('kept');
    await expect.poll(() => page.evaluate(() => document.querySelector('#cdiv').getBoundingClientRect().top)).toBeLessThan(page.viewportSize().height);
  });
});

test.describe('back navigation', () => {
  test('back from a gallery opened from a listing returns to that listing', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/?f_search=glasses`);
    const first = ui(page).locator('.ehtw-tweet .ehtw-tweet-title .glink').first();
    await navigate(page, () => tap(page, testInfo, first), /\/g\/\d+\//, 'ehtw-detail');
    await navigate(page, () => tap(page, testInfo, ui(page).locator('#ehtw-header .ehtw-back-link')), /f_search=glasses/, 'ehtw-list');
  });

  test('back from a gallery opened directly (no same-site referrer) stays on the site', async ({ page, site }, testInfo) => {
    // The tab already has a previous entry (about:blank here; another site in real life).
    await open(page, detailUrl(site.state.galleries[4]));
    const back = ui(page).locator('#ehtw-header .ehtw-back-link');
    expect(await back.evaluate((a) => a.href)).toBe(`${EH}/`);
    await tap(page, testInfo, back);
    await page.waitForTimeout(1500);
    expect(page.url(), 'in-page back arrow must not leave e-hentai via history.back()').toBe(`${EH}/`);
    await waitForRoute(page, (url) => url.pathname === '/', 'ehtw-list');
  });
});

// Added 1.17.249: the horizontal thumbnail strip keeps its sideways scroll
// position when the user returns from the reader (suspended page resume).
test.describe('thumbnail strip position after reader', () => {
  test('back from the reader restores the strip scroll position', async ({ page, site }, testInfo) => {
    const g = site.state.galleries[0];
    await open(page, detailUrl(g));
    const strip = ui(page).locator('#gdt');
    await strip.scrollIntoViewIfNeeded();
    await strip.evaluate((e) => { e.scrollLeft = Math.min(700, e.scrollWidth - e.clientWidth - 1); });
    await page.waitForTimeout(400);
    const before = await strip.evaluate((e) => e.scrollLeft);
    expect(before).toBeGreaterThan(200);
    const index = await strip.evaluate((e) => {
      const box = e.getBoundingClientRect();
      return Array.from(e.querySelectorAll('a')).findIndex((a) => {
        const r = a.getBoundingClientRect();
        return r.width > 0 && r.left >= box.left && r.right <= box.right;
      });
    });
    expect(index).toBeGreaterThan(0);
    await navigate(page, () => tap(page, testInfo, ui(page).locator('#gdt a').nth(index)), /\/s\/[0-9a-f]+\//, 'ehtw-reader');
    await navigate(page, () => page.goBack(), new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
    await expect.poll(() => ui(page).locator('#gdt').evaluate((e) => e.scrollLeft), { timeout: 3000 }).toBeGreaterThan(before - 4);
    expect(await ui(page).locator('#gdt').evaluate((e) => e.scrollLeft)).toBeLessThan(before + 4);
  });
});

