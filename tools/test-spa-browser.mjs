// Live same-document navigation regression test. It repeats list <-> detail
// transitions and fails if native page scripts are evaluated twice or the
// router falls back to a document navigation.
// Usage: node test-spa-browser.mjs <script.user.js> <listUrl> <galleryUrl> [cycles]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CDP_HTTP } from './cdp-endpoint.mjs';

const [scriptPath, listUrl, galleryUrl, cyclesArg] = process.argv.slice(2);
if (!scriptPath || !listUrl || !galleryUrl) {
  throw new Error('Usage: node test-spa-browser.mjs <script.user.js> <listUrl> <galleryUrl> [cycles]');
}
const cycles = Math.max(1, Math.min(10, Number.parseInt(cyclesArg || '3', 10) || 3));
const script = readFileSync(scriptPath, 'utf8');
const expectedVersion = script.match(/@version\s+(\S+)/)?.[1] || '';
const tab = await (await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const mainNavigations = [];
const runtimeErrors = [];
const consoleErrors = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
  if (message.method === 'Page.frameNavigated' && !message.params.frame.parentId) {
    mainNavigations.push(message.params.frame.url);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(
      message.params.exceptionDetails.exception?.description ||
      message.params.exceptionDetails.text ||
      'Runtime exception'
    );
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
  }
};

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`CDP timeout: ${method}`));
  }, 30000);
  pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description || 'Runtime.evaluate failed');
  }
  return response.result?.result?.value;
};
const waitFor = async (expression, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

let completed = 0;
let initialDocumentUrl = '';
let observedVersion = '';
let error = null;
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: listUrl });
  assert.equal(await waitFor(`document.readyState === 'complete'`), true, 'list document loads');
  assert.equal(await evaluate(`location.origin === ${JSON.stringify(new URL(listUrl).origin)}`), true, 'list URL stays on the selected origin');

  const priorScript = await evaluate(`({ running:!!window.__EHTW_STYLE_050__, version:document.documentElement.dataset.ehtwScriptVersion || null })`);
  if (priorScript.running) {
    assert.equal(priorScript.version, expectedVersion, `preinstalled userscript version is ${expectedVersion}`);
  } else {
    await evaluate(script);
  }
  assert.equal(await waitFor(`typeof window.__EHTW_SPA_NAVIGATE__ === 'function'`), true, 'userscript SPA router is installed');
  assert.equal(await waitFor(`document.documentElement.classList.contains('ehtw-list') || document.documentElement.classList.contains('ehtw-generic')`), true, 'source list is transformed');
  initialDocumentUrl = mainNavigations.at(-1) || listUrl;
  observedVersion = await evaluate(`document.documentElement.dataset.ehtwScriptVersion || ''`);
  assert.equal(observedVersion, expectedVersion, `active userscript version is ${expectedVersion}`);

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const toGallery = await evaluate(`window.__EHTW_SPA_NAVIGATE__(${JSON.stringify(galleryUrl)}, { historyMode: 'push' })`);
    assert.equal(toGallery, true, `cycle ${cycle + 1}: detail navigation completes in SPA`);
    assert.equal(await waitFor(`document.documentElement.classList.contains('ehtw-detail')`), true, `cycle ${cycle + 1}: detail route is transformed`);

    const toList = await evaluate(`window.__EHTW_SPA_NAVIGATE__(${JSON.stringify(listUrl)}, { historyMode: 'push' })`);
    assert.equal(toList, true, `cycle ${cycle + 1}: list navigation completes in SPA`);
    assert.equal(await waitFor(`document.documentElement.classList.contains('ehtw-list') || document.documentElement.classList.contains('ehtw-generic')`), true, `cycle ${cycle + 1}: list route is transformed`);
    completed += 1;
  }

  const duplicateMatchyear = [...runtimeErrors, ...consoleErrors]
    .filter((message) => /duplicate variable:\s*'matchyear'/i.test(message));
  assert.equal(duplicateMatchyear.length, 0, 'native ehg_index.c.js does not redeclare matchyear during SPA route swaps');
  const unexpectedErrors = [...runtimeErrors, ...consoleErrors]
    .filter((message) => !/api\.e-hentai\.org\/api\.php|due to access control checks/i.test(message));
  assert.deepEqual(unexpectedErrors, [], 'repeated SPA routes do not produce unexpected runtime or console errors');
  assert.equal(mainNavigations.length, 1, 'repeated SPA route swaps do not navigate/reload the main document');
} catch (caught) {
  error = String(caught?.stack || caught);
} finally {
  try { ws.close(); } catch (_) {}
  try { await fetch(`${CDP_HTTP}/json/close/${tab.id}`); } catch (_) {}
}

const report = {
  expectedVersion,
  observedVersion,
  listUrl: new URL(listUrl).pathname,
  galleryUrl: new URL(galleryUrl).pathname,
  cycles,
  completedCycles: completed,
  initialDocumentUrl: initialDocumentUrl ? new URL(initialDocumentUrl).pathname : '',
  documentNavigations: mainNavigations.map((url) => {
    try { return new URL(url).pathname; } catch { return '[unparseable URL]'; }
  }),
  runtimeErrors: runtimeErrors.map((message) => message.slice(0, 240)),
  consoleErrors: consoleErrors.map((message) => message.slice(0, 240)),
  error
};
console.log(JSON.stringify(report));
if (error) process.exitCode = 1;
