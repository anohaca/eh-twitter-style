// Shared Playwright fixtures: a mocked E-Hentai network, userscript injection
// that mirrors Tampermonkey (@match + document-start), and diagnostics.
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockSite } from '../mock-site/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCRIPT_PATH = path.resolve(process.env.EHTW_SCRIPT || path.join(ROOT, 'eh-twitter-style_user.js'));
export const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, 'utf8');
export const SCRIPT_VERSION = SCRIPT_SOURCE.match(/@version\s+(\S+)/)?.[1] || 'unknown';
export const MATCHES = [...SCRIPT_SOURCE.matchAll(/^\/\/\s*@match\s+(\S+)/gm)].map((m) => m[1]);
export const EH = 'https://e-hentai.org';
export const EX = 'https://exhentai.org';

// Tampermonkey @match semantics are glob-like; '*' matches any run of characters.
const matchSource = JSON.stringify(MATCHES.map((pattern) =>
  `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));

export function buildInitScript(source = SCRIPT_SOURCE) {
  return `(() => {
  const patterns = ${matchSource}.map((p) => new RegExp(p));
  if (!patterns.some((re) => re.test(location.href))) return;
  window.__ehtwInjected = (window.__ehtwInjected || 0) + 1;
  ${source}
})();`;
}

export const test = base.extend({
  siteOptions: [{}, { option: true }],
  injectScript: [true, { option: true }],
  // Runs before the userscript; used for fault-injection tests.
  preInitScript: ['', { option: true }],

  site: async ({ siteOptions }, use) => {
    await use(createMockSite(siteOptions));
  },

  diagnostics: async ({}, use) => {
    await use({ pageErrors: [], consoleErrors: [], consoleWarnings: [], external: [], documentNavigations: [], requests: [] });
  },

  context: async ({ context, site, diagnostics, injectScript, preInitScript }, use) => {
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      let response = null;
      try {
        response = site.handle({
          url,
          method: request.method(),
          type: request.resourceType(),
          referer: request.headers().referer || '',
          originHeader: request.headers().origin || '',
          body: request.postData() || '',
          contentType: (await request.allHeaders())['content-type'] || ''
        });
      } catch (error) {
        diagnostics.pageErrors.push(`mock-site error for ${url}: ${error.stack || error}`);
        return route.fulfill({ status: 500, body: 'mock failure' });
      }
      diagnostics.requests.push({ url, method: request.method(), type: request.resourceType() });
      if (!response) {
        diagnostics.external.push({ url, type: request.resourceType() });
        return route.abort('blockedbyclient');
      }
      if (response.delayMs) await new Promise((r) => setTimeout(r, response.delayMs));
      return route.fulfill({ status: response.status, headers: response.headers, body: response.body });
    });
    if (preInitScript) await context.addInitScript(preInitScript);
    if (injectScript) await context.addInitScript(buildInitScript());
    await use(context);
  },

  page: async ({ page, diagnostics }, use) => {
    page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error.stack || error.message || error)));
    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
      if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
    });
    // 'domcontentloaded' only fires for real document loads, not for
    // pushState/replaceState (SPA) URL changes.
    page.on('domcontentloaded', () => diagnostics.documentNavigations.push(page.url()));
    await use(page);
  }
});

export { expect };

// --- helpers --------------------------------------------------------------

/**
 * Locator root for the page the user currently sees. The SPA router keeps
 * suspended pages in an aria-hidden shadow root attached to <html>, and
 * Playwright selectors pierce shadow DOM, so plain page.locator() would also
 * match elements of those hidden pages.
 */
export const ui = (page) => page.locator('body');

export function layoutOf(testInfo) {
  const width = testInfo.project.use.viewport?.width ?? 1280;
  if (width < 700) return 'phone';
  if (width < 1000) return 'tablet';
  return 'desktop';
}

export const isTouch = (testInfo) => !!testInfo.project.use.hasTouch;

export async function open(page, url, { waitFor = 'html.ehtw-enabled, html.ehtw-reader, html.ehtw-login' } = {}) {
  await page.goto(url, { waitUntil: 'load' });
  if (waitFor) await page.waitForSelector(waitFor, { state: 'attached', timeout: 15_000 });
  // Let deferred layout work (requestAnimationFrame / timers) settle.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Errors that are produced by the userscript (or that it causes) on the page. */
export function scriptErrors(diagnostics) {
  return diagnostics.pageErrors.filter((e) => !/mock-site error/.test(e) || true);
}

export async function expectNoHorizontalOverflow(page, label = '') {
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    const offenders = [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none') return false;
      if (e.closest('[aria-hidden="true"], .ehtw-native-hidden')) return false;
      return r.right > de.clientWidth + 1 && !e.closest('#gdt, .ehtw-strip, [style*="overflow-x"]');
    }).slice(0, 5).map((e) => `${e.tagName}#${e.id}.${String(e.className?.baseVal ?? e.className).slice(0, 50)}`);
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, offenders };
  });
  expect(overflow.scrollWidth, `${label} document scrollWidth vs clientWidth; offenders: ${overflow.offenders.join(', ')}`)
    .toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/** Scrolls an element into view and checks a real pointer at its center would hit it. */
export async function hitTest(page, selector, { index = 0 } = {}) {
  return page.evaluate(async ({ selector, index }) => {
    const element = document.querySelectorAll(selector)[index];
    if (!element) return { found: false };
    element.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y);
    const map = element.closest('#gdr');
    const hit = !!top && (top === element || element.contains(top) || top.contains(element) ||
      (top.tagName === 'AREA' && !!map?.contains(top)) || (top.tagName === 'IMG' && top.useMap && !!map?.contains(top)));
    return { found: true, hit, x, y, width: box.width, height: box.height,
      top: top ? `${top.tagName}#${top.id}.${String(top.className?.baseVal ?? top.className).slice(0, 40)}` : null };
  }, { selector, index });
}

export async function tap(page, testInfo, locator) {
  if (isTouch(testInfo)) await locator.tap();
  else await locator.click();
}

export async function isVisible(page, selector) {
  return page.evaluate((selector) => {
    const e = document.querySelector(selector);
    if (!e) return false;
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  }, selector);
}

export async function settle(page, ms = 250) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Requests the userscript (not the page) made to the site, excluding document loads. */
export function backgroundRequests(diagnostics) {
  return diagnostics.requests.filter((r) => ['fetch', 'xhr'].includes(r.type));
}

/**
 * Waits for an in-page (SPA) or document navigation to finish rendering.
 * cls: html class expected on the destination (ehtw-list, ehtw-detail, ehtw-reader …).
 * token: optional marker placed on the previous shell by navigate(); the wait
 * only succeeds once a different (freshly rendered or resumed) shell is shown.
 */
export async function waitForRoute(page, urlMatcher, cls, token = null, timeout = 20_000) {
  // Poll the URL instead of waitForURL(): SPA pushState, replaceState and real
  // document loads all count, and an already-matching URL resolves at once.
  const matches = (href) => {
    const url = new URL(href);
    if (typeof urlMatcher === 'function') return !!urlMatcher(url);
    if (urlMatcher instanceof RegExp) return urlMatcher.test(href);
    return href === String(urlMatcher);
  };
  await expect.poll(() => { try { return matches(page.url()); } catch { return false; } }, { timeout, intervals: [50, 100, 200] }).toBe(true);
  // The router renders in several passes (shell, header, deferred widgets), so
  // require the "rendered" condition to hold for a few consecutive polls.
  await page.waitForFunction(({ cls, token }) => {
    const root = document.documentElement;
    const ready = (() => {
      if (!root || !root.classList.contains(cls)) return false;
      if (root.classList.contains('ehtw-navigation-pending') || root.classList.contains('ehtw-page-boot')) return false;
      const surface = document.querySelector('#ehtw-shell, .ehtw-reader-root');
      if (token && (!surface || surface.dataset.ehtwTestNav === token)) return false;
      if (cls === 'ehtw-reader') return !!document.querySelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]');
      return document.querySelectorAll('#ehtw-shell').length === 1 &&
        document.querySelectorAll('#ehtw-header').length === 1 &&
        document.querySelectorAll('#ehtw-header .ehtw-back-link').length <= 1 &&
        window.__EHTW_SPA_READY__ !== false;
    })();
    window.__ehtwStableFrames = ready ? (window.__ehtwStableFrames || 0) + 1 : 0;
    return window.__ehtwStableFrames >= 6;
  }, { cls, token }, { timeout, polling: 50 });
  await page.evaluate(() => { window.__ehtwStableFrames = 0; });
}

/** Marks the current page, performs `action`, and waits until a different page is rendered. */
export async function navigate(page, action, urlMatcher, cls, timeout) {
  const token = `nav-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.evaluate((token) => {
    const surface = document.querySelector('#ehtw-shell, .ehtw-reader-root');
    if (surface) surface.dataset.ehtwTestNav = token;
  }, token);
  await action();
  await waitForRoute(page, urlMatcher, cls, token, timeout);
}
