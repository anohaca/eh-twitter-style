import { test, expect, ui, open, EH, tap, waitForRoute, settle } from './harness.mjs';
import { PROBE_SCRIPT } from '../stability/probe.mjs';

test.use({ preInitScript: `${PROBE_SCRIPT}\ndocument.addEventListener('DOMContentLoaded', () => { window.__ehtwTimersBeforeMain = window.__ehtwProbe?.timers?.created || 0; }, { once: true });` });

const diagnosticState = (page) => page.evaluate(() => {
  const probe = window.__ehtwProbe;
  const listeners = probe.listenerSnapshot();
  const timerValues = [...probe.timers.alive.values()];
  return {
    byType: { window: listeners.byType.window, document: listeners.byType.document, element: listeners.byType.element },
    timeouts: timerValues.filter((timer) => timer.kind === 'timeout').length,
    intervals: timerValues.filter((timer) => timer.kind === 'interval').length,
    timerCreated: probe.timers.created,
    timersBeforeMain: window.__ehtwTimersBeforeMain,
    logApi: window.__EHTW_NAV_LOG__ ? {
      diagnosticListeners: window.__EHTW_NAV_LOG__.diagnosticListeners,
      diagnosticTimers: window.__EHTW_NAV_LOG__.diagnosticTimers
    } : null,
    enabled: localStorage.getItem('ehtw-navigation-log-enabled-v1') === '1',
    storedLog: sessionStorage.getItem('ehtw-navigation-log-session-v1')
  };
});

test('navigation diagnostic is inert when off and records, displays, copies, and clears when on', async ({ page, site }, testInfo) => {
  await open(page, `${EH}/`);
  await settle(page, 400);
  const off = await diagnosticState(page);
  expect(off.enabled).toBe(false);
  expect(off.logApi).toBeNull();
  expect(off.storedLog).toBeNull();

  const enabledPage = await page.context().newPage();
  await open(enabledPage, `${EH}/#ehtw-navlog-on`);
  await settle(enabledPage, 400);
  const on = await diagnosticState(enabledPage);
  expect(on.enabled).toBe(true);
  expect(enabledPage.url()).toBe(`${EH}/`); // the command hash is consumed
  expect(on.logApi).toEqual({ diagnosticListeners: 4, diagnosticTimers: 0 });

  const differences = {};
  for (const category of ['window', 'document', 'element']) {
    const types = new Set([...Object.keys(off.byType[category]), ...Object.keys(on.byType[category])]);
    for (const type of types) {
      const delta = (on.byType[category][type] || 0) - (off.byType[category][type] || 0);
      if (delta) differences[`${category}:${type}`] = delta;
    }
  }
  const diagnosticDocumentListeners = Object.fromEntries(Object.entries(differences).filter(([key]) => key.startsWith('document:')));
  expect(diagnosticDocumentListeners, 'enabled logging adds the requested capture diagnostics and edge-touch listeners').toEqual({
    'document:touchstart': 1,
    'document:touchend': 1,
    'document:touchcancel': 1,
    'document:click': 1,
    'document:submit': 1,
    'document:visibilitychange': 1,
    'document:__ehtw_mainworld_report_v1': 1
  });
  expect((differences['window:hashchange'] || 0) + (differences['window:touchstart'] || 0) + (differences['window:touchend'] || 0)).toBe(0);
  expect(on.timersBeforeMain - off.timersBeforeMain, 'diagnostic initialization adds no timer before the site UI starts').toBe(0);

  const gallery = site.state.galleries[0];
  await tap(enabledPage, testInfo, ui(enabledPage).locator(`.ehtw-tweet[data-ehtw-href="${EH}/g/${gallery.gid}/${gallery.token}/"] .ehtw-tweet-title .glink`));
  await waitForRoute(enabledPage, new RegExp(`/g/${gallery.gid}/${gallery.token}/$`), 'ehtw-detail');
  await enabledPage.goBack();
  await waitForRoute(enabledPage, (url) => url.pathname === '/', 'ehtw-list');
  const entries = await enabledPage.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]'));
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.some((entry) => entry.event === 'navigate-start')).toBe(true);
  expect(entries.some((entry) => entry.event === 'popstate')).toBe(true);
  expect(entries.some((entry) => entry.event === 'navigation-log-enabled' && entry.suspendCache === 'on')).toBe(true);
  const heartbeat = await enabledPage.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-heartbeat-v1') || 'null'));
  expect(heartbeat).toMatchObject({ href: `${EH}/`, suspendedCount: 0 });
  expect(Number.isFinite(heartbeat.t)).toBe(true);
  expect(Number.isFinite(heartbeat.approxImageCount)).toBe(true);
  for (const entry of entries) {
    expect(Number.isFinite(entry.timeMs)).toBe(true);
    expect(entry.timestamp).toMatch(/\.\d{3}Z$/);
  }

  await open(enabledPage, `${EH}/#ehtw-navlog`);
  await enabledPage.reload(); // ensure the hash command is read at document start
  const panel = ui(enabledPage).locator('#ehtw-navlog-panel');
  const textarea = panel.locator('#ehtw-navlog-text');
  await expect(panel).toBeVisible();
  await expect(textarea).toHaveValue(/navigate-start/);
  const box = await panel.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(enabledPage.viewportSize().width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(enabledPage.viewportSize().height + 1);

  await enabledPage.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.__ehtwCopiedNavigationLog = text; } }
    });
  });
  await tap(enabledPage, testInfo, panel.locator('#ehtw-navlog-copy'));
  await expect.poll(() => enabledPage.evaluate(() => window.__ehtwCopiedNavigationLog || '')).toContain('navigate-start');
  await settle(enabledPage, 350); // let already-queued scroll history writes finish before clearing the log
  await tap(enabledPage, testInfo, panel.locator('#ehtw-navlog-clear'));
  await expect(textarea).toHaveValue('');
  expect(await enabledPage.evaluate(() => sessionStorage.getItem('ehtw-navigation-log-session-v1'))).toBeNull();

  await open(enabledPage, `${EH}/#ehtw-navlog-off`);
  await enabledPage.reload();
  const disabledAgain = await diagnosticState(enabledPage);
  expect(disabledAgain.enabled).toBe(false);
  expect(disabledAgain.logApi).toBeNull();
  expect(enabledPage.url()).toBe(`${EH}/`);
});

test('navigation diagnostic reports a previous document without a clean exit', async ({ page }) => {
  await open(page, `${EH}/#ehtw-navlog-on`);
  const heartbeat = { t: Date.now() - 1250, href: `${EH}/popular`, suspendedCount: 2, approxImageCount: 17 };
  await page.evaluate((previousHeartbeat) => {
    sessionStorage.setItem('ehtw-navigation-log-heartbeat-v1', JSON.stringify(previousHeartbeat));
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ehtw-navigation-log-clean-exit-v1') return;
      return Reflect.apply(nativeSetItem, this, [key, value]);
    };
  }, heartbeat);
  await page.goto(`${EH}/popular`, { referer: `${EH}/popular`, waitUntil: 'load' });
  await expect.poll(() => page.evaluate(() => {
    const entries = JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]');
    return entries.find((entry) => entry.event === 'previous-document-no-clean-exit') || null;
  })).toMatchObject({ previousHeartbeat: heartbeat });
  const diagnostic = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ehtw-navigation-log-session-v1') || '[]')
    .find((entry) => entry.event === 'previous-document-no-clean-exit'));
  expect(diagnostic.intervalMs).toBeGreaterThanOrEqual(1000);
  expect(diagnostic.intervalMs).toBeLessThan(10_000);
});
