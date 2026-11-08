// Follow / unfollow creators (My Tags "watched"), follow uploaders (favorites
// category 9), the Following feeds and the block-uploader hand-off.
// All writes go to the stateful mock site, never to a real account.
import { test, expect, ui, open, EH, tap, waitForRoute, navigate } from './harness.mjs';

const tweetFor = (page, gid) => ui(page).locator(`.ehtw-tweet[data-ehtw-href*="/g/${gid}/"]`);
const myTag = (site, tag) => site.state.myTags.find((t) => t.tag === tag);

test.describe('follow creators through My Tags', () => {
  test('follow button reflects the current watched state', async ({ page, site }) => {
    await open(page, `${EH}/`);
    // Gallery 1 has artist:alpha studio, which is watched in the fixture.
    const watched = site.state.galleries.slice(0, 25).find((g) => g.tags.includes('artist:alpha studio') && g.tags.filter((t) => /^(artist|group):/.test(t)).length === 1);
    await expect(tweetFor(page, watched.gid).locator('.ehtw-card-follow-button')).toHaveText('取消关注');
    await expect(tweetFor(page, watched.gid).locator('.ehtw-card-follow-button')).toHaveAttribute('aria-pressed', 'true');
  });

  test('following an existing My Tags row saves it via the API and flips the button', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries[0]; // group:beta circle — present in My Tags, not watched
    expect(myTag(site, 'group:beta circle').watch).toBe(false);
    const button = tweetFor(page, g.gid).locator('.ehtw-card-follow-button');
    await expect(button).toHaveText('关注');
    await tap(page, testInfo, button);
    await expect(button).toHaveText('取消关注', { timeout: 20_000 });
    expect(myTag(site, 'group:beta circle').watch).toBe(true);
    const apiCalls = site.state.writes.filter((w) => w.url.endsWith('/api.php'));
    expect(apiCalls.length).toBe(1);
    expect(JSON.parse(apiCalls[0].body)).toMatchObject({ method: 'setusertag', tagid: 104, tagwatch: 1, apikey: 'fixtureapikey' });
    // Unfollow again.
    await tap(page, testInfo, button);
    await expect(button).toHaveText('关注', { timeout: 20_000 });
    expect(myTag(site, 'group:beta circle').watch).toBe(false);
  });

  test('following a creator that is not in My Tags adds a watched row through the native form', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries.slice(0, 25).find((x) => {
      const creators = x.tags.filter((t) => /^(artist|group):/.test(t));
      return creators.length === 1 && creators[0] === 'artist:gamma ink';
    });
    test.skip(!g, 'fixture has no single-creator gallery for artist:gamma ink');
    const button = tweetFor(page, g.gid).locator('.ehtw-card-follow-button');
    await tap(page, testInfo, button);
    await expect(button).toHaveText('取消关注', { timeout: 25_000 });
    expect(myTag(site, 'artist:gamma ink')?.watch).toBe(true);
    // The helper iframe is removed afterwards.
    await expect(ui(page).locator('iframe[aria-hidden="true"]')).toHaveCount(0);
  });

  test('a failing save leaves the button usable and the state unchanged', async ({ page, site }, testInfo) => {
    site.state.rateLimitApi = true;
    await open(page, `${EH}/`);
    const g = site.state.galleries[0];
    const button = tweetFor(page, g.gid).locator('.ehtw-card-follow-button');
    await tap(page, testInfo, button);
    await expect(button).toBeEnabled({ timeout: 20_000 });
    await expect(button).toHaveText('关注', { timeout: 20_000 });
    expect(myTag(site, 'group:beta circle').watch).toBe(false);
  });

  test('multi-creator galleries offer a choice menu', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries.slice(0, 25).find((x) => x.tags.filter((t) => /^(artist|group):/.test(t)).length > 1);
    test.skip(!g, 'fixture has no multi-creator gallery on page 1');
    const choice = tweetFor(page, g.gid).locator('.ehtw-follow-choice-button');
    await tap(page, testInfo, choice);
    const items = tweetFor(page, g.gid).locator('.ehtw-follow-choice-wrap .ehtw-menu-item');
    expect(await items.count()).toBe(g.tags.filter((t) => /^(artist|group):/.test(t)).length);
    for (const text of await items.allTextContents()) expect(text).toMatch(/(关注|取消关注) (Artist|Group) · /);
  });
});

test.describe('follow uploaders through favorites', () => {
  test('following an uploader from the card menu stores the gallery in favorites category 9', async ({ page, site }, testInfo) => {
    await open(page, `${EH}/`);
    const g = site.state.galleries[2];
    const tweet = tweetFor(page, g.gid);
    await tap(page, testInfo, tweet.locator('.ehtw-card-more-menu .ehtw-menu-button'));
    const item = tweet.locator('.ehtw-menu-follow-uploader');
    await expect(item).toHaveText(`关注上传者 ${g.uploader}`);
    await tap(page, testInfo, item);
    await expect.poll(() => site.state.favorites.get(`/g/${g.gid}/${g.token}/`), { timeout: 12_000 }).toBe(9);
    await expect(item).toHaveText(`取消关注上传者 ${g.uploader}`, { timeout: 20_000 });
    await expect(item).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Following feeds', () => {
  test('authors feed lists galleries from watched artist/group tags', async ({ page, site }) => {
    await open(page, `${EH}/watched?ehtw_following=authors`);
    await expect(page.locator('html')).toHaveClass(/ehtw-following-authors/);
    await expect(ui(page).locator('.ehtw-follow-mode-tab.ehtw-follow-mode-active')).toHaveText('作者');
    await expect.poll(() => ui(page).locator('.ehtw-tweet').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    const hrefs = await ui(page).locator('.ehtw-tweet').evaluateAll((items) => items.map((e) => e.getAttribute('data-ehtw-href')));
    for (const href of hrefs) {
      const gid = Number(href.match(/\/g\/(\d+)\//)[1]);
      expect(site.state.galleries.find((g) => g.gid === gid).tags).toContain('artist:alpha studio');
    }
  });

  test.describe('with a followed uploader', () => {
    test('uploaders feed lists galleries from uploaders kept in favorites category 9', async ({ page, site }) => {
      const carol = site.state.galleries.find((g) => g.uploader === 'carol');
      site.state.favorites.clear();
      site.state.favorites.set(`/g/${carol.gid}/${carol.token}/`, 9);
      await open(page, `${EH}/watched?ehtw_following=uploaders`);
      await expect.poll(() => ui(page).locator('.ehtw-tweet').count(), { timeout: 20_000 }).toBeGreaterThan(0);
      const handles = await ui(page).locator('.ehtw-tweet .ehtw-handle').allTextContents();
      expect(new Set(handles)).toEqual(new Set(['@carol']));
    });
  });

  test('empty uploaders feed explains how to follow someone', async ({ page }) => {
    await open(page, `${EH}/watched?ehtw_following=uploaders`);
    await expect(ui(page).locator('#ehtw-center')).toContainText(/No uploaders followed yet|No followed creators yet/, { timeout: 15_000 });
  });

  test('the Following nav entry opens the feed', async ({ page }, testInfo) => {
    await open(page, `${EH}/`);
    const entry = ui(page).locator('.ehtw-nav-following-entry a');
    if (!(await entry.isVisible())) {
      await tap(page, testInfo, ui(page).locator('.ehtw-more-button'));
    }
    await navigate(page, () => tap(page, testInfo, entry), /ehtw_following=/, 'ehtw-list');
    await expect(page.locator('html')).toHaveClass(/ehtw-following-/);
  });
});

test.describe('block uploader', () => {
  test('the block action adds the uploader to the native Excluded Uploaders list', async ({ page, site }, testInfo) => {
    site.state.excludedUploaders = ['someone_else'];
    await open(page, `${EH}/`);
    const g = site.state.galleries[0];
    const tweet = tweetFor(page, g.gid);
    await tap(page, testInfo, tweet.locator('.ehtw-card-more-menu .ehtw-menu-button'));
    await tap(page, testInfo, tweet.locator('.ehtw-menu-block-uploader'));
    await expect.poll(() => site.state.excludedUploaders, { timeout: 15_000 }).toEqual(['someone_else', g.uploader]);
    // Only the native settings form was submitted.
    expect(site.state.writes.map((w) => new URL(w.url).pathname)).toEqual(['/uconfig.php']);
  });

  test('blocking an uploader that is already excluded does not submit again', async ({ page, site }, testInfo) => {
    const g = site.state.galleries[0];
    site.state.excludedUploaders = [g.uploader];
    await open(page, `${EH}/`);
    const tweet = tweetFor(page, g.gid);
    await tap(page, testInfo, tweet.locator('.ehtw-card-more-menu .ehtw-menu-button'));
    await navigate(page, () => tap(page, testInfo, tweet.locator('.ehtw-menu-block-uploader')), /\/uconfig\.php/, 'ehtw-enabled');
    await expect(ui(page).locator('.ehtw-native-setting-message')).toContainText(g.uploader);
    await page.waitForTimeout(500);
    expect(site.state.writes).toEqual([]);
  });
});
