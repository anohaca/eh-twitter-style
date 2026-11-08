// Gallery list → tweet timeline: data fidelity, native hooks, search,
// filters, infinite scroll and the sidebar.
import { test, expect, ui, open, EH, layoutOf, isTouch, hitTest, settle, isVisible, tap, waitForRoute, navigate } from './harness.mjs';
import { XSS_TITLE } from '../mock-site/site.mjs';

const tweetFor = (page, gid) => ui(page).locator(`.ehtw-tweet[data-ehtw-href*="/g/${gid}/"]`);

test.describe('timeline conversion', () => {
  test('every gallery row becomes exactly one tweet and ad rows stay hidden', async ({ page, site, diagnostics }) => {
    await open(page, `${EH}/`);
    const gids = await ui(page).locator('.ehtw-timeline .ehtw-tweet').evaluateAll((items) =>
      items.map((e) => e.getAttribute('data-ehtw-href').match(/\/g\/(\d+)\//)[1]));
    expect(gids).toEqual(site.state.galleries.slice(0, 25).map((g) => String(g.gid)));
    // Ad slots (ins) and ad rows without .gl3c are hidden, never shown in the timeline.
    for (const ad of await ui(page).locator('ins').all()) expect(await ad.isVisible()).toBe(false);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('a tweet shows avatar, author, handle, time, category, rating, title, tags, media and actions', async ({ page, site }) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries[0];
    const tweet = tweetFor(page, g.gid);
    await expect(tweet).toHaveCount(1);
    await expect(tweet.locator('.ehtw-avatar')).toHaveClass(new RegExp(g.category[0]));
    await expect(tweet.locator('.ehtw-avatar-letter')).toHaveText(/^[A-Z0-9]$/);
    await expect(tweet.locator('.ehtw-author-name')).not.toBeEmpty();
    await expect(tweet.locator('.ehtw-handle')).toHaveText(`@${g.uploader}`);
    await expect(tweet.locator('.ehtw-handle a')).toHaveAttribute('href', new RegExp(`/uploader/${g.uploader}`));
    await expect(tweet.locator('.ehtw-time')).toHaveText(/^\d+m$/);
    await expect(tweet.locator('.ehtw-time')).toHaveAttribute('title', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await expect(tweet.locator('.cn')).toHaveText(g.category[1]);
    await expect(tweet.locator('.cn')).toHaveAttribute('onclick', /document\.location/);
    await expect(tweet.locator('.ehtw-tweet-rating')).toHaveText(`★ ${g.rating}`);
    await expect(tweet.locator('.ehtw-tweet-title a')).toHaveAttribute('href', new RegExp(`/g/${g.gid}/${g.token}/`));
    await expect(tweet.locator('.ehtw-tweet-title .glink')).toHaveText(g.title);
    const media = tweet.locator('.ehtw-media img');
    await expect(media).toHaveAttribute('src', /ehgt\.org\/t\//);
    await expect(tweet.locator('.ehtw-twitter-action-reply')).toHaveAttribute('href', new RegExp(`/g/${g.gid}/${g.token}/#cdiv$`));
    await expect(tweet.locator('.ehtw-twitter-action-reply .ehtw-action-number')).toHaveText(String(g.comments));
    await expect(tweet.locator('.ehtw-twitter-action-heart')).toHaveAttribute('href', new RegExp(`gallerypopups\\.php\\?gid=${g.gid}&t=${g.token}&act=addfav`));
    await expect(tweet.locator('.ehtw-twitter-action-views .ehtw-action-number')).toHaveText(String(g.pages));
  });

  test('hashtags: namespace stripped, spaces → underscores, links encoded, max 6 shown', async ({ page, site }) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries.slice(0, 25).find((x) => x.tags.length >= 8);
    const tags = tweetFor(page, g.gid).locator('.ehtw-tags .ehtw-tag-link');
    const visible = await tags.evaluateAll((links) => links.filter((a) => a.getBoundingClientRect().width > 0 && getComputedStyle(a).display !== 'none')
      .map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThanOrEqual(6);
    for (const { text, href } of visible) {
      expect(text).toMatch(/^#[^\s:]+$/);
      expect(href).toMatch(/^(https:\/\/e-hentai\.org)?\/tag\/[a-z]+:[^ ]+$/);
      const tag = decodeURIComponent(href.split('/tag/')[1]).replace(/\+/g, ' ');
      expect(g.tags).toContain(tag);
      expect(text).toBe(`#${tag.split(':')[1].replace(/ /g, '_')}`);
    }
  });

  test('relative times: minutes, hours, same-year dates and older dates with year', async ({ page, site }) => {
    await open(page, `${EH}/`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // Load enough pages to reach galleries older than a year.
    for (let i = 0; i < 6 && await ui(page).locator('.ehtw-tweet').count() < 50; i += 1) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(600);
    }
    const times = await ui(page).locator('.ehtw-tweet .ehtw-time').allTextContents();
    expect(times.some((t) => /^\d+m$/.test(t))).toBe(true);
    expect(times.some((t) => /^\d+h$/.test(t))).toBe(true);
    if (await ui(page).locator('.ehtw-tweet').count() >= 45) {
      expect(times.some((t) => /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(t))).toBe(true);
    }
  });

  test('lazy thumbnails (data-src) still produce a real media image', async ({ page, site }) => {
    await open(page, `${EH}/`);
    const lazy = site.state.galleries.find((g) => g.lazyThumb);
    const src = await tweetFor(page, lazy.gid).locator('.ehtw-media img').getAttribute('src');
    expect(src).toMatch(/^https:\/\/ehgt\.org\/t\//);
  });

  test('card favorite opens the browser folder list without navigating the page', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries[0];
    const heart = tweetFor(page, g.gid).locator('.ehtw-twitter-action-heart');
    const listUrl = page.url();
    await tap(page, testInfo, heart);
    const picker = ui(page).locator('.ehtw-browser-favorite-picker');
    await expect(picker).toBeVisible();
    expect(page.url(), 'the folder chooser does not navigate the list').toBe(listUrl);
    expect(site.state.writes).toEqual([]);
    await picker.selectOption('6');
    await expect.poll(() => site.state.favorites.get(`/g/${g.gid}/${g.token}/`)).toBe(6);
    const write = site.state.writes.at(-1);
    expect(write?.contentType).toMatch(/^application\/x-www-form-urlencoded(?:;|$)/i);
    expect(write?.originHeader).toBe(EH);
    expect(new URLSearchParams(write?.body || '').get('apply')).toBe('Add to Favorites');
    await expect(picker).toHaveCount(0);
    await expect(heart).toHaveClass(/ehtw-liked/);
    await tap(page, testInfo, heart);
    await expect.poll(() => site.state.favorites.has(`/g/${g.gid}/${g.token}/`)).toBe(false);
    await expect(heart).not.toHaveClass(/ehtw-liked/);
    expect(new URLSearchParams(site.state.writes.at(-1)?.body || '').get('favcat')).toBe('favdel');
    expect(new URLSearchParams(site.state.writes.at(-1)?.body || '').get('apply')).toBe('Apply Changes');
    expect(page.url()).toBe(listUrl);
  });

  test('torrent icon: available is clickable via the native popUp, unavailable is dimmed', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    const withTorrent = site.state.galleries.slice(0, 25).find((g) => g.torrents);
    const without = site.state.galleries.slice(0, 25).find((g) => !g.torrents);
    const available = tweetFor(page, withTorrent.gid).locator('.ehtw-twitter-action-repost');
    await expect(available).toHaveClass(/ehtw-repost-available/);
    const unavailable = tweetFor(page, without.gid).locator('.ehtw-twitter-action-repost');
    await expect(unavailable).toHaveClass(/ehtw-repost-unavailable/);
    expect(Number(await unavailable.locator('.ehtw-twitter-action-icon').evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(0.6);
    await expect(unavailable).toHaveAttribute('title', 'No torrents available');
    await available.scrollIntoViewIfNeeded();
    const before = page.url();
    await tap(page, testInfo, available.locator('.gldown img'));
    await page.waitForTimeout(800);
    // The native onclick returns false (popup), so the page must not navigate to the link href.
    expect(page.url(), 'torrent icon navigated the page instead of opening the native popup').toBe(before);
    const calls = await page.evaluate(() => window.__nativeCalls.filter((c) => c.name === 'popUp').map((c) => c.detail));
    expect(calls.some((url) => url.includes(`gallerytorrents.php?gid=${withTorrent.gid}`))).toBe(true);
  });

  test('titles containing markup are rendered as text, never executed', async ({ page, site }) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries.find((x) => x.title === XSS_TITLE);
    await expect(tweetFor(page, g.gid).locator('.ehtw-tweet-title .glink')).toHaveText(XSS_TITLE);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__ehtwXss)).toBeUndefined();
    expect(await ui(page).locator('.ehtw-tweet img[src="x"]').count()).toBe(0);
  });

  test('native hover previews (.glthumb) never appear and hovering raises no errors', async ({ page, diagnostics }, testInfo) => {
    test.skip(isTouch(testInfo), 'hover is a pointer-only interaction');
    await open(page, `${EH}/`);
    for (let i = 0; i < 6; i += 1) {
      const title = ui(page).locator('.ehtw-tweet .glink').nth(i);
      await title.scrollIntoViewIfNeeded();
      await title.hover();
      await page.waitForTimeout(80);
    }
    const visibleThumbs = await ui(page).locator('.glthumb').evaluateAll((items) => items.filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
    }).length);
    expect(visibleThumbs).toBe(0);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('tweet hover changes the background on pointer devices', async ({ page }, testInfo) => {
    test.skip(isTouch(testInfo), 'pointer-only');
    await open(page, `${EH}/`);
    const tweet = ui(page).locator('.ehtw-tweet').nth(1);
    await page.mouse.move(5, 5);
    const before = await tweet.evaluate((e) => getComputedStyle(e).backgroundColor);
    await tweet.locator('.ehtw-tweet-title').hover();
    await page.waitForTimeout(250);
    const after = await tweet.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(after).not.toBe(before);
  });
});

test.describe('navigation from the timeline', () => {
  test('tapping a title opens the gallery', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries[2];
    await navigate(page, () => tap(page, testInfo, tweetFor(page, g.gid).locator('.ehtw-tweet-title .glink')), new RegExp(`/g/${g.gid}/${g.token}/`), 'ehtw-detail');
    await expect(ui(page).locator('#gn')).toHaveText(g.title);
  });

  test('tapping the media opens the gallery', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries[1];
    await navigate(page, () => tap(page, testInfo, tweetFor(page, g.gid).locator('.ehtw-media img')), new RegExp(`/g/${g.gid}/`), 'ehtw-detail');
  });

  test('a hashtag opens the tag listing', async ({ page }, testInfo) => {
    await open(page, `${EH}/`);
    const tag = ui(page).locator('.ehtw-tweet .ehtw-tag-link').first();
    const href = await tag.getAttribute('href');
    await navigate(page, () => tap(page, testInfo, tag), (url) => url.pathname === decodeURI(new URL(href, EH).pathname) || url.pathname === new URL(href, EH).pathname, 'ehtw-list');
    await expect(ui(page).locator('#ehtw-header .ehtw-context-title')).toHaveText(/^#/);
  });

  test('top tabs reflect the current route', async ({ page }) => {
    await open(page, `${EH}/`);
    await expect(ui(page).locator('.ehtw-top-tab.ehtw-tab-active')).toHaveText('For you');
    await open(page, `${EH}/watched`);
    await expect(ui(page).locator('.ehtw-top-tab.ehtw-tab-active')).toHaveText('Watched');
  });

  test('context headers on search, tag and uploader listings', async ({ page }) => {
    await open(page, `${EH}/?f_search=glasses`);
    await expect(ui(page).locator('#ehtw-header .ehtw-context-title')).toHaveText('glasses');
    await expect(ui(page).locator('#ehtw-header .ehtw-context-subtitle')).toHaveText(/^[\d,]+ results?$/);
    await expect(ui(page).locator('#ehtw-header .ehtw-back-link')).toHaveCount(1);
    await open(page, `${EH}/tag/female:glasses`);
    await expect(ui(page).locator('#ehtw-header .ehtw-context-title')).toHaveText('#glasses');
    await open(page, `${EH}/uploader/carol`);
    await expect(ui(page).locator('#ehtw-header .ehtw-context-title')).toHaveText('carol');
  });
});

test.describe('infinite timeline', () => {
  test('scrolling to the end appends the next page without duplicates and hides page links', async ({ page, site, diagnostics }) => {
    await open(page, `${EH}/`);
    expect(await isVisible(page, '#dnext')).toBe(false);
    const before = await ui(page).locator('.ehtw-tweet').count();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => ui(page).locator('.ehtw-tweet').count(), { timeout: 10_000 }).toBeGreaterThan(before);
    const gids = await ui(page).locator('.ehtw-tweet').evaluateAll((items) => items.map((e) => e.getAttribute('data-ehtw-href')));
    expect(new Set(gids).size).toBe(gids.length);
    expect(gids.slice(0, 50)).toEqual(site.state.galleries.slice(0, gids.length).slice(0, 50).map((g) => `${EH}/g/${g.gid}/${g.token}/`));
    // Continuation is fetched in the background: the document itself did not navigate.
    expect(diagnostics.documentNavigations.filter((u) => /next=/.test(u))).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('the timeline ends cleanly after the last page', async ({ page, site }) => {
    await open(page, `${EH}/`);
    for (let i = 0; i < 8; i += 1) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(500);
    }
    await expect.poll(() => ui(page).locator('.ehtw-tweet').count(), { timeout: 10_000 }).toBe(site.state.galleries.length);
  });
});

test.describe('search and filters', () => {
  test('Enter in the search box submits the native form', async ({ page }, testInfo) => {
    await open(page, `${EH}/`);
    const input = ui(page).locator('#f_search');
    await expect(input).toBeVisible();
    await tap(page, testInfo, input);
    await input.fill('glasses');
    await navigate(page, () => input.press('Enter'), /f_search=glasses/, 'ehtw-list');
    await expect(ui(page).locator('#ehtw-header .ehtw-context-title')).toHaveText('glasses');
  });

  test('Filters reveals the category toggles, which keep the native handler', async ({ page }, testInfo) => {
    await open(page, `${EH}/`);
    const toggle = ui(page).locator('.ehtw-filters-toggle').first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await isVisible(page, '#cat_2')).toBe(false);
    await tap(page, testInfo, toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(ui(page).locator('#cat_2')).toBeVisible();
    const hit = await hitTest(page, '#cat_2');
    expect(hit.hit, `category toggle covered by ${hit.top}`).toBe(true);
    await tap(page, testInfo, ui(page).locator('#cat_2'));
    expect(await ui(page).locator('#f_cats').inputValue()).toBe('2');
    await expect(ui(page).locator('#cat_2')).toHaveAttribute('data-disabled', '1');
    // Advanced / file search panels open inside the layout.
    await tap(page, testInfo, ui(page).locator('#searchbox a', { hasText: 'Show File Search' }));
    await expect(ui(page).locator('#fsdiv')).toBeVisible();
    expect(await ui(page).locator('#fsdiv').evaluate((e) => !!e.closest('#ehtw-shell'))).toBe(true);
    await tap(page, testInfo, toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('display mode switcher is reachable and switches the native mode', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    await tap(page, testInfo, ui(page).locator('.ehtw-filters-toggle').first());
    const select = ui(page).locator('.searchnav select:visible').first();
    await expect(select).toBeVisible();
    await navigate(page, () => select.selectOption('t'), /inline_set=dm_t/, 'ehtw-enabled');
    expect(site.state.displayMode).toBe('t');
  });
});

test.describe('sidebar', () => {
  test('desktop right column has search + toplists that link to galleries', async ({ page }, testInfo) => {
    test.skip(layoutOf(testInfo) !== 'desktop', 'right column is desktop-only');
    await open(page, `${EH}/`);
    await expect(ui(page).locator('#ehtw-right #f_search')).toBeVisible();
    await expect(ui(page).locator('#ehtw-right .ehtw-search-toplist-section').first()).toBeVisible();
    await expect.poll(() => ui(page).locator('#ehtw-right .ehtw-search-toplist-item').count()).toBeGreaterThan(3);
    const href = await ui(page).locator('#ehtw-right .ehtw-search-toplist-title').first().getAttribute('href');
    expect(href).toMatch(/\/g\/\d+\/[0-9a-f]+\//);
  });

  test('phones get the search box at the top of the timeline', async ({ page }, testInfo) => {
    test.skip(layoutOf(testInfo) === 'desktop', 'mobile search replaces the right column');
    await open(page, `${EH}/`);
    await expect(ui(page).locator('#ehtw-mobile-search #f_search')).toBeVisible();
    const box = await ui(page).locator('#ehtw-mobile-search').boundingBox();
    const first = await ui(page).locator('.ehtw-tweet').first().boundingBox();
    expect(box.y).toBeLessThan(first.y);
  });
});

test.describe('card menus', () => {
  test('the ⋯ menu lists uploader actions and gallery actions, and closes again', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries[0];
    const tweet = tweetFor(page, g.gid);
    const button = tweet.locator('.ehtw-card-more-menu .ehtw-menu-button');
    await tap(page, testInfo, button);
    const menu = tweet.locator('.ehtw-card-more-menu .ehtw-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.ehtw-menu-follow-uploader')).toContainText(g.uploader);
    await expect(menu.locator('.ehtw-menu-block-uploader')).toContainText(g.uploader);
    await expect(menu.locator('a.ehtw-menu-item', { hasText: 'Archive Download' })).toHaveAttribute('href', /archiver\.php/);
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    await page.keyboard.press('Escape');
    if (await menu.isVisible()) await tap(page, testInfo, ui(page).locator('#ehtw-header'));
    await expect(menu).toBeHidden();
  });
});
