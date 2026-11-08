// Generic / account pages, upload subdomains, login, empty states and the
// four alternative native display modes.
import { test, expect, ui, open, EH, EX, layoutOf, isTouch, tap, hitTest, expectNoHorizontalOverflow, waitForRoute, navigate } from './harness.mjs';

test.describe('context headers on generic pages', () => {
  const titles = [
    ['/toplist.php', 'Toplists'], ['/torrents.php', 'Torrents'], ['/news.php', 'News'], ['/bounty.php', 'Bounties'],
    ['/favorites.php', 'Favorites'], ['/home.php', 'My Home'], ['/uconfig.php', 'Settings'], ['/mytags', 'My Tags'],
    ['https://upld.e-hentai.org/manage?ss=d&sd=d', 'My Uploads']
  ];
  for (const [path, title] of titles) {
    test(`${path} → "${title}" with a back button`, async ({ page }) => {
      await open(page, path.startsWith('http') ? path : `${EH}${path}`);
      await expect(ui(page).locator('#ehtw-header')).toContainText(title);
      await expect(ui(page).locator('#ehtw-header .ehtw-back-link')).toHaveCount(1);
      // The native h1 is hidden because the header already shows the title.
      const h1Visible = await ui(page).locator('#ehtw-center h1:not(.ehtw-context-title)').evaluateAll((h) => h.filter((e) => e.getBoundingClientRect().height > 0).length);
      expect(h1Visible).toBe(0);
    });
  }
});

test.describe('toplists', () => {
  test('sections become cards inside the content column', async ({ page }) => {
    await open(page, `${EH}/toplist.php`);
    const cards = ui(page).locator('.tdo');
    expect(await cards.count()).toBe(8);
    const center = await ui(page).locator('#ehtw-center').boundingBox();
    for (const box of await cards.evaluateAll((items) => items.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(box.width).toBeGreaterThan(100);
      expect(box.x).toBeGreaterThanOrEqual(center.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(center.x + center.width + 1);
    }
    expect(Number.parseFloat(await cards.first().evaluate((e) => getComputedStyle(e).borderTopLeftRadius))).toBeGreaterThanOrEqual(12);
    for (const link of await ui(page).locator('.tdo .tun a').evaluateAll((a) => a.slice(0, 5).map((x) => x.getAttribute('href')))) {
      expect(link).toMatch(/\/(g|uploader)\//);
    }
  });

  test('a toplist result page renders galleries as tweets and hides My Tags "hidden" tags', async ({ page, site }) => {
    await open(page, `${EH}/toplist.php?tl=15`);
    await expect(page.locator('html')).toHaveClass(/ehtw-list/);
    const hiddenTags = site.state.myTags.filter((t) => t.hide).map((t) => t.tag);
    const expected = site.state.galleries.slice(0, 25).filter((g) => !g.tags.some((t) => hiddenTags.includes(t)));
    await expect.poll(() => ui(page).locator('.ehtw-tweet:visible').count()).toBe(expected.length);
    const shown = await ui(page).locator('.ehtw-tweet:visible').evaluateAll((items) => items.map((e) => e.getAttribute('data-ehtw-href')));
    expect(shown).toEqual(expected.map((g) => `${EH}/g/${g.gid}/${g.token}/`));
  });
});

test.describe('torrents', () => {
  test('rows become flex items with the torrent name first and labelled stats', async ({ page }, testInfo) => {
    await open(page, `${EH}/torrents.php`);
    const row = ui(page).locator('table.itg tr').nth(1);
    expect(await row.evaluate((e) => getComputedStyle(e).display)).toBe('flex');
    const name = row.locator('td').nth(1);
    expect(await name.evaluate((e) => getComputedStyle(e).order)).toBe('-1');
    const seeds = await row.locator('td').nth(4).evaluate((e) => getComputedStyle(e, '::before').content);
    expect(seeds).toContain('Seeds');
    for (const selector of ['#focusme', 'table.ptt a']) {
      const hit = await hitTest(page, selector);
      expect(hit.hit, `${selector} covered by ${hit.top}`).toBe(true);
    }
    await expectNoHorizontalOverflow(page, 'torrents');
  });
});

test.describe('news', () => {
  test('news items read as posts and the decorative bars are hidden', async ({ page }) => {
    await open(page, `${EH}/news.php`);
    for (const selector of ['.baredge', '#botm', '.bartop']) {
      expect(await page.locator(selector).evaluate((e) => getComputedStyle(e).display)).toBe('none');
    }
    await expect(ui(page).locator('.nwo h2 a').first()).toBeVisible();
    expect(await ui(page).locator('.nwo').count()).toBe(3);
  });
});

test.describe('account pages', () => {
  test('My Home sub-navigation stays usable', async ({ page }, testInfo) => {
    await open(page, `${EH}/home.php`);
    const link = ui(page).locator('#homenav a', { hasText: 'Hath Perks' });
    await expect(link).toBeVisible();
    await navigate(page, () => tap(page, testInfo, link), /hathperks\.php/, 'ehtw-myhome');
    await expect(ui(page).locator('#ehtw-header')).toContainText(/Hath Perks|My Home/);
  });

  test('My Tags editor controls stay usable and nothing is saved without the user', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/mytags`);
    await expect(ui(page).locator('#usertags_outer')).toBeVisible();
    const box = ui(page).locator('#tagwatch_101');
    const hit = await hitTest(page, '#tagwatch_101');
    expect(hit.hit, `checkbox covered by ${hit.top}`).toBe(true);
    await tap(page, testInfo, box);
    await expect(box).toBeChecked();
    expect(site.state.writes).toEqual([]);
  });

  test('settings form inputs are styled but keep their native names', async ({ page }) => {
    await open(page, `${EH}/uconfig.php`);
    await expect(ui(page).locator('textarea[name="xu"]')).toBeVisible();
    await expect(ui(page).locator('select[name="tl"]')).toBeVisible();
    const radius = await ui(page).locator('select[name="tl"]').evaluate((e) => parseFloat(getComputedStyle(e).borderRadius));
    expect(radius).toBeGreaterThan(8);
  });

  test('favorites with entries render as a timeline', async ({ page, site }) => {
    for (const g of site.state.galleries.slice(0, 3)) site.state.favorites.set(`/g/${g.gid}/${g.token}/`, 0);
    await open(page, `${EH}/favorites.php`);
    await expect(page.locator('html')).toHaveClass(/ehtw-list/);
    expect(await ui(page).locator('.ehtw-tweet').count()).toBe(3);
  });

  test('bounties table fits the content column', async ({ page }) => {
    await open(page, `${EH}/bounty.php`);
    await expect(ui(page).locator('#ehtw-center a', { hasText: 'Fixture bounty request 1' })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'bounties');
  });
});

test.describe('upload subdomains', () => {
  for (const url of ['https://upld.e-hentai.org/manage?ss=d&sd=d', 'https://upld.e-hentai.org/bounty_post.php', 'https://upld.exhentai.org/upld/manage']) {
    test(`${new URL(url).host}${new URL(url).pathname} gets the shell and working forms`, async ({ page, diagnostics }) => {
      await open(page, url);
      await expect(page.locator('html')).toHaveClass(/ehtw-enabled/);
      await expect(ui(page).locator('#ehtw-left #nb')).toHaveCount(1);
      const field = ui(page).locator('#ehtw-center input, #ehtw-center textarea, #ehtw-center a').first();
      await expect(field).toBeVisible();
      expect(diagnostics.pageErrors).toEqual([]);
    });
  }
});

test.describe('logged-out state', () => {
  test.use({ siteOptions: { loggedIn: false } });

  test('watched shows a centered empty state', async ({ page }) => {
    await open(page, `${EH}/watched`);
    await expect(ui(page).locator('#ehtw-center')).toContainText('No hits found');
    expect(await ui(page).locator('.ehtw-tweet').count()).toBe(0);
  });

  test('account card offers Login instead of logout', async ({ page }, testInfo) => {
    await open(page, `${EH}/`);
    const nav = ui(page).locator('#ehtw-left');
    const loginLink = ui(page).locator('a[href*="act=Login&CODE=00"]');
    expect(await loginLink.count()).toBeGreaterThan(0);
    expect(await ui(page).locator('a[href*="act=Login&CODE=03"]').count()).toBe(0);
    await expect(nav).toBeVisible();
  });

  test('login page is a centered card that keeps the native form', async ({ page }) => {
    await open(page, `${EH}/home.php`, { waitFor: 'html.ehtw-login' });
    const card = await page.locator('body > .d').boundingBox();
    const vw = page.viewportSize().width;
    expect(Math.abs(card.x + card.width / 2 - vw / 2)).toBeLessThan(4);
    expect(card.width).toBeLessThanOrEqual(Math.min(400, vw - 32) + 1);
    await expect(ui(page).locator('input[name="UserName"]')).toBeVisible();
    await expect(ui(page).locator('input[type="submit"]')).toBeVisible();
    await expectNoHorizontalOverflow(page, 'login');
  });
});

test.describe('alternative display modes', () => {
  for (const [mode, label] of [['m', 'Minimal'], ['p', 'Minimal+'], ['e', 'Extended'], ['t', 'Thumbnail']]) {
    test.describe(label, () => {
      test.use({ siteOptions: { displayMode: mode } });
      test(`${label} rows go through the tweet renderer without overflow`, async ({ page, site, diagnostics }) => {
        await open(page, `${EH}/`);
        await expect(page.locator('html')).toHaveClass(/ehtw-list/);
        const tweets = ui(page).locator('.ehtw-tweet');
        await expect.poll(() => tweets.count()).toBe(25);
        const g = site.state.galleries[0];
        const first = ui(page).locator(`.ehtw-tweet[data-ehtw-href*="/g/${g.gid}/"]`);
        await expect(first.locator('.ehtw-tweet-title')).toContainText(g.title);
        await expect(first.locator('.ehtw-tweet-title')).toBeVisible();
        await expect(first.locator('.ehtw-media img')).toHaveAttribute('src', /ehgt\.org/);
        await expectNoHorizontalOverflow(page, label);
        expect(diagnostics.pageErrors).toEqual([]);
      });
    });
  }
});

test.describe('ExHentai', () => {
  test('detail and reader work on exhentai.org', async ({ page, site, diagnostics }) => {
    const g = site.state.galleries[0];
    await open(page, `${EX}/g/${g.gid}/${g.token}/`);
    await expect(page.locator('html')).toHaveClass(/ehtw-detail/);
    await expect(page.locator('html')).toHaveClass(/ehtw-exhentai/);
    await open(page, site.readerUrl(EX, g, 2), { waitFor: 'html.ehtw-reader' });
    await expect(ui(page).locator('.ehtw-reader-page-count')).toHaveText(`2 / ${g.pages}`);
    expect(diagnostics.pageErrors).toEqual([]);
  });
});
