import { test, expect } from './harness.mjs';

const matrixProjects = new Set(['desktop-1440-light', 'webkit-desktop']);
const clickCases = [
  ['Shift-click', ['Shift'], false],
  ['new-tab modifier', process.platform === 'darwin' ? ['Meta'] : ['Control'], false],
  ['target=_blank', [], true]
];

for (const [label, modifiers, targetBlank] of clickCases) {
  test(`${label} popup is either routed offline or blocked by the dead proxy`, async ({ page, context }, testInfo) => {
    test.skip(!matrixProjects.has(testInfo.project.name), 'network-isolation probe runs in desktop Chromium and desktop WebKit');

    await page.goto('about:blank');
    const href = `https://ehtw-popup-${label.toLowerCase().replace(/[^a-z]+/g, '-')}.invalid/${Date.now()}`;
    await page.setContent(`<a id="popup-probe" href="${href}"${targetBlank ? ' target="_blank"' : ''}>offline popup</a>`);

    let routeHits = 0;
    const popupFailures = [];
    const popupRequests = [];
    context.on('page', (popup) => {
      popup.on('request', (request) => popupRequests.push(request.url()));
      popup.on('requestfailed', (request) => popupFailures.push({
        url: request.url(),
        error: request.failure()?.errorText || ''
      }));
    });
    await context.route('https://*.invalid/**', async (route) => {
      routeHits += 1;
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<main id="offline-fixture">offline popup response</main>' });
    });

    const openerUrl = page.url();
    const popupPromise = context.waitForEvent('page');
    await page.locator('#popup-probe').click({ modifiers });
    const popup = await popupPromise;
    const nativePopupUrl = popup.url();
    const nativeRouteHits = routeHits;

    if (testInfo.project.name === 'desktop-1440-light') {
      expect(routeHits, 'Chromium popup requests remain covered by context.route').toBe(1);
      expect(popupFailures).toEqual([]);
      expect(popup.url()).toBe(href);
      await popup.waitForLoadState('load');
      await expect(popup.locator('#offline-fixture')).toHaveText('offline popup response');
    } else {
      if (targetBlank) {
        expect(nativeRouteHits, 'target=_blank popup request is intercepted by the mock route').toBe(1);
        expect(nativePopupUrl).toBe(href);
      } else {
        expect(nativeRouteHits, 'WebKit modifier popup never reaches context.route').toBe(0);
        expect(nativePopupUrl, 'unrouted WebKit popup remains on its initial blank document').toBe('');
        expect(popupRequests).toEqual([]);
        expect(popupFailures).toEqual([]);
        // Re-issue the recorded href through Playwright navigation so the
        // regression test can also verify the offline route still works.
        await popup.goto(href, { waitUntil: 'commit' });
        await expect.poll(() => routeHits).toBe(1);
        expect(popup.url()).toBe(href);
      }
    }

    expect(page.url()).toBe(openerUrl);
  });
}

test('an unhandled .invalid navigation fails at the local proxy', async ({ page, context }, testInfo) => {
  test.skip(!matrixProjects.has(testInfo.project.name), 'proxy proof runs in desktop Chromium and desktop WebKit');
  await page.goto('about:blank');
  await context.unrouteAll({ behavior: 'wait' });
  const href = `https://ehtw-proxy-proof.invalid/${Date.now()}`;
  const failedRequests = [];
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || ''
  }));
  await expect(page.goto(href, { waitUntil: 'commit', timeout: 5000 })).rejects.toThrow();
  expect(failedRequests).toHaveLength(1);
  expect(failedRequests[0].url).toBe(href);
  expect(failedRequests[0].error).toMatch(/proxy|refused|failed|could not connect/i);
});

test('sendBeacon and WebSocket use the dead proxy when routes are absent', async ({ page, context }, testInfo) => {
  test.skip(!matrixProjects.has(testInfo.project.name), 'browser API isolation probe runs in desktop Chromium and desktop WebKit');
  await page.goto('about:blank');
  await context.unrouteAll({ behavior: 'wait' });
  const urls = [
    `https://ehtw-beacon.invalid/${Date.now()}`,
    `wss://ehtw-socket.invalid/${Date.now()}`
  ];
  const failedRequests = [];
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || ''
  }));
  const apiResults = await page.evaluate(async ([beaconUrl, socketUrl]) => new Promise((resolve) => {
    const result = { beaconQueued: false, webSocketOpened: false, webSocketFailed: false };
    try { result.beaconQueued = navigator.sendBeacon(beaconUrl, 'offline probe'); } catch (_) {}
    let socket;
    try {
      socket = new WebSocket(socketUrl);
      socket.addEventListener('open', () => { result.webSocketOpened = true; });
      socket.addEventListener('error', () => { result.webSocketFailed = true; });
    } catch (_) {}
    setTimeout(() => {
      try { socket?.close(); } catch (_) {}
      resolve(result);
    }, 1200);
  }), urls);
  expect(apiResults.beaconQueued).toBe(true);
  expect(apiResults.webSocketOpened).toBe(false);
  expect(apiResults.webSocketFailed).toBe(true);
  expect(failedRequests.some((request) => request.url === urls[0])).toBe(true);
  expect(failedRequests.every((request) => urls.includes(request.url))).toBe(true);
  expect(failedRequests.find((request) => request.url === urls[0])?.error).toMatch(/proxy|refused|failed|could not connect/i);
});
