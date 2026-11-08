// Injection, page detection, run-once guard, isolation and rollback.
import { test, expect, ui, open, EH, EX, SCRIPT_VERSION, MATCHES, buildInitScript } from './harness.mjs';

test.describe('boot and page detection', () => {
  test('stamps the script version and enables the list layout on the front page', async ({ page, diagnostics }) => {
    await open(page, `${EH}/`);
    const html = page.locator('html');
    await expect(html).toHaveClass(/ehtw-enabled/);
    await expect(html).toHaveClass(/ehtw-list/);
    await expect(html).toHaveAttribute('data-ehtw-script-version', SCRIPT_VERSION);
    // Boot classes that hide the native page during startup must be released.
    await expect(html).not.toHaveClass(/ehtw-page-boot|ehtw-navigation-pending/);
    expect(await ui(page).locator('#ehtw-shell').count()).toBe(1);
    expect(await ui(page).locator('#ehtw-center').count()).toBe(1);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  const pageTypes = [
    ['/', /ehtw-list/],
    ['/watched', /ehtw-list/],
    ['/popular', /ehtw-list/],
    ['/?f_search=glasses', /ehtw-list/],
    ['/tag/female:glasses', /ehtw-list/],
    ['/uploader/carol', /ehtw-list/],
    ['/favorites.php', /ehtw-(list|generic|other)/], // empty favorites → "No hits found"
    ['/g/5000/{token}/', /ehtw-detail/],
    ['/toplist.php', /ehtw-generic/],
    ['/torrents.php', /ehtw-(generic|other)/],
    ['/news.php', /ehtw-generic/],
    ['/bounty.php', /ehtw-(bounty|generic|other)/],
    ['/home.php', /ehtw-(myhome|generic)/],
    ['/mytags', /ehtw-(mytags|myhome|generic)/],
    ['/uconfig.php', /ehtw-(myhome|generic)/],
    ['/stats.php', /ehtw-(myhome|generic)/],
    ['/hentaiathome.php', /ehtw-(myhome|generic)/],
    ['/bitcoin.php', /ehtw-(myhome|generic)/],
    ['/hathperks.php', /ehtw-(myhome|generic)/],
    ['/exchange.php', /ehtw-(myhome|generic)/],
    ['/logs.php', /ehtw-(myhome|generic)/]
  ];
  for (const [path, expected] of pageTypes) {
    test(`classifies ${path}`, async ({ page, site, diagnostics }) => {
      const g = site.state.galleries[0];
      await open(page, `${EH}${path.replace('{token}', g.token)}`);
      await expect(page.locator('html')).toHaveClass(expected);
      expect(diagnostics.pageErrors).toEqual([]);
    });
  }

  test('reader pages get the reader surface instead of the three-column shell', async ({ page, site, diagnostics }) => {
    const g = site.state.galleries[0];
    await open(page, site.readerUrl(EH, g, 6), { waitFor: 'html.ehtw-reader' });
    await expect(ui(page).locator('#ehtw-shell')).toHaveCount(0);
    await expect(ui(page).locator('.ehtw-reader-root')).toHaveCount(1);
    await expect(page.locator('html')).not.toHaveClass(/ehtw-reader-boot/);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('the login page only gets the theme, not the shell', async ({ page, diagnostics }) => {
    await open(page, `${EH}/login`, { waitFor: 'html.ehtw-login' });
    await expect(ui(page).locator('#ehtw-shell')).toHaveCount(0);
    // Login form fields keep their native names (credentials go to the site untouched).
    await expect(ui(page).locator('form[name="ipb_login_form"] input[name="UserName"]')).toHaveCount(1);
    await expect(ui(page).locator('form[name="ipb_login_form"] input[name="PassWord"]')).toHaveCount(1);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('a matched page without site navigation is left untouched', async ({ page, diagnostics }) => {
    await page.goto(`${EH}/plain.html`);
    await page.waitForTimeout(400);
    await expect(page.locator('html')).not.toHaveClass(/ehtw-/);
    await expect(ui(page).locator('#plain')).toBeVisible();
    // Only the inert boot stylesheet (keyed on html classes that are not set) may remain.
    expect(await page.locator('style').evaluateAll((s) => s.filter((e) => /ehtw/.test(e.textContent) && e.id !== 'ehtw-page-boot-style').length)).toBe(0);
    expect(await page.evaluate(() => [...document.body.children].every((e) => getComputedStyle(e).opacity === '1'))).toBe(true);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('a /s/ page without a reader image is left untouched', async ({ page, site, diagnostics }) => {
    await page.goto(`${EH}/s/0000000000/5000-999`);
    await page.waitForTimeout(400);
    await expect(page.locator('html')).not.toHaveClass(/ehtw-reader|ehtw-enabled/);
    // This intentionally invalid native /s/ URL has no #img. The site's own
    // resize handler throws when mobile emulation changes the viewport; keep
    // that native-site error separate from userscript failures.
    const nativeMissingReaderImageErrors = diagnostics.pageErrors.filter((error) =>
      /ehg_native\.js/.test(error) && /update_window_extents: #img is gone/.test(error)
    );
    expect(diagnostics.pageErrors).toEqual(nativeMissingReaderImageErrors);
  });

  test('ExHentai gets the same layout plus its own theme class', async ({ page, diagnostics }) => {
    await open(page, `${EX}/`);
    await expect(page.locator('html')).toHaveClass(/ehtw-exhentai/);
    await expect(page.locator('html')).toHaveClass(/ehtw-list/);
    expect(await ui(page).locator('.ehtw-tweet').count()).toBeGreaterThan(10);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('@match list covers both gallery sites and the upload subdomains only', async () => {
    expect(MATCHES).toEqual(expect.arrayContaining([
      'https://e-hentai.org/*', 'https://exhentai.org/*'
    ]));
    for (const pattern of MATCHES) expect(pattern).toMatch(/^https:\/\/(upld\.)?(e-hentai|exhentai)\.org\//);
  });
});

test.describe('boot curtain', () => {
  // The boot class hides every native node (opacity 0) until the layout is
  // ready. If it is (re)applied after runMain() released it, a page stays
  // invisible until the 20 s safety timer fires. Injection timing varies, so
  // each case is loaded repeatedly.
  for (const [label, path] of [['page without #nb', '/plain.html'], ['login page', '/login'], ['/s/ without image', '/s/0000000000/5000-999']]) {
    test(`boot class never outlives initialization: ${label}`, async ({ page }) => {
      const stuck = [];
      for (let i = 0; i < 25; i += 1) {
        await page.goto(`${EH}${path}`);
        await page.waitForTimeout(150);
        const state = await page.evaluate(() => ({
          cls: document.documentElement.className,
          hidden: [...document.body.children].filter((e) => getComputedStyle(e).opacity === '0').length
        }));
        if (/ehtw-(page|reader)-boot/.test(state.cls) || state.hidden) stuck.push(`load ${i + 1}: ${JSON.stringify(state)}`);
      }
      expect(stuck, 'page left hidden behind the boot curtain').toEqual([]);
    });
  }
});

test.describe('run-once guard and isolation', () => {
  test('injecting the script a second time does not duplicate the layout', async ({ page, diagnostics }) => {
    await open(page, `${EH}/`);
    const tweets = await ui(page).locator('.ehtw-tweet').count();
    await page.addScriptTag({ content: buildInitScript() });
    await page.waitForTimeout(500);
    await expect(ui(page).locator('#ehtw-shell')).toHaveCount(1);
    await expect(ui(page).locator('#ehtw-left')).toHaveCount(1);
    expect(await ui(page).locator('.ehtw-tweet').count()).toBe(tweets);
    expect(await page.locator('style').evaluateAll((s) => s.filter((e) => /#ehtw-shell/.test(e.textContent)).length)).toBeLessThanOrEqual(2);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('only one shell exists after page load (no double run at document-start + DOMContentLoaded)', async ({ page }) => {
    await open(page, `${EH}/`);
    expect(await page.evaluate(() => window.__ehtwInjected)).toBe(1);
    await expect(ui(page).locator('#ehtw-shell')).toHaveCount(1);
  });

  test('no request leaves the mocked site hosts while browsing every page type', async ({ page, site, diagnostics }) => {
    const g = site.state.galleries[0];
    for (const path of ['/', '/popular', `/g/${g.gid}/${g.token}/`, '/toplist.php', '/torrents.php', '/news.php', '/home.php', '/mytags']) {
      await open(page, `${EH}${path}`);
      await page.waitForTimeout(300);
    }
    await open(page, site.readerUrl(EH, g, 2), { waitFor: 'html.ehtw-reader' });
    await page.waitForTimeout(500);
    expect(diagnostics.external, JSON.stringify(diagnostics.external)).toEqual([]);
  });

  test('does not write cookies', async ({ page, context }) => {
    await context.addCookies([{ name: 'sl', value: 'dm_2', domain: '.e-hentai.org', path: '/' }]);
    await open(page, `${EH}/`);
    await page.waitForTimeout(500);
    const cookies = await context.cookies();
    expect(cookies.map((c) => `${c.name}=${c.value}`)).toEqual(['sl=dm_2']);
  });

  test('persists only ehtw-prefixed keys in web storage', async ({ page, site }) => {
    const g = site.state.galleries[0];
    await open(page, `${EH}/`);
    await open(page, `${EH}/g/${g.gid}/${g.token}/`);
    await open(page, site.readerUrl(EH, g, 2), { waitFor: 'html.ehtw-reader' });
    const keys = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
    for (const key of [...keys.local, ...keys.session]) expect(key).toMatch(/^ehtw[-.]/);
  });
});

test.describe('failure rollback', () => {
  test.use({
    // Fault injection: hide the center column from the post-build sanity check.
    preInitScript: `(() => {
      const original = Document.prototype.getElementById;
      Document.prototype.getElementById = function (id) {
        if (id === 'ehtw-center' && window.__ehtwBreakLayout) return null;
        return original.call(this, id);
      };
      window.__ehtwBreakLayout = true;
    })();`
  });

  test('a failed initialization rolls back to the untouched native page', async ({ page, diagnostics }) => {
    await page.goto(`${EH}/`);
    await page.waitForTimeout(800);
    const html = page.locator('html');
    await expect(html).not.toHaveClass(/ehtw-enabled|ehtw-list|ehtw-page-boot/);
    await expect(ui(page).locator('#ehtw-shell')).toHaveCount(0);
    expect(await ui(page).locator('[class*="ehtw-"]').count()).toBe(0);
    // Native structure is back where it was.
    expect(await page.evaluate(() => document.querySelector('#nb')?.parentElement === document.body)).toBe(true);
    expect(await ui(page).locator('table.itg.gltc tr').count()).toBeGreaterThan(20);
    expect(await ui(page).locator('#searchbox form #f_search').count()).toBe(1);
    expect(await page.evaluate(() => [...document.styleSheets].filter((s) => s.ownerNode?.id !== 'ehtw-page-boot-style' && s.ownerNode?.textContent?.includes('#ehtw-shell')).length)).toBe(0);
    expect(await page.evaluate(() => [...document.body.children].every((e) => getComputedStyle(e).opacity === '1'))).toBe(true);
    // And the native page still works.
    await ui(page).locator('#cat_2').click();
    expect(await ui(page).locator('#f_cats').inputValue()).toBe('2');
    expect(diagnostics.pageErrors).toEqual([]);
  });
});
