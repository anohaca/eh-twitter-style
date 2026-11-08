#!/usr/bin/env node
// Offline visual-style snapshotter. It only serves the local mock site.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, devices } from '../tests/node_modules/playwright/index.mjs';
import { createMockSite } from '../tests/mock-site/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = path.resolve(process.env.EHTW_SCRIPT || path.join(ROOT, 'eh-twitter-style_user.js'));
const outputDir = path.resolve(process.env.EHTW_SNAPSHOT_DIR || path.join(ROOT, 'work/size-opt'));
const label = process.env.EHTW_SNAPSHOT_LABEL || path.basename(inputPath).replace(/[^a-z0-9.-]/gi, '_');
mkdirSync(outputDir, { recursive: true });
const script = (await import('node:fs')).readFileSync(inputPath, 'utf8');
const projects = [
  { name: 'desktop-1440-light', engine: chromium, options: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
  { name: 'desktop-1440-dark', engine: chromium, options: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
  { name: 'iphone-13-chromium', engine: chromium, options: { ...devices['iPhone 13'], browserName: undefined } },
  { name: 'webkit-iphone-13', engine: webkit, options: { ...devices['iPhone 13'] } }
];
const scenarios = [
  ['home-list', '/'], ['gallery-strip', '__gallery__'], ['gallery-grid', '__gallery__'], ['reader-scroll', '__reader__'],
  ['reader-paging', '__reader-paging__'], ['search', '/?f_search=sample'],
  ['toplists', '/toplist.php'], ['myhome', '/home.php'], ['myuploads', '/uploader/']
];
const selectedProject = process.env.EHTW_SNAPSHOT_PROJECT;
const selectedScenario = process.env.EHTW_SNAPSHOT_SCENARIO;
const normalize = (value) => Math.round(value * 2) / 2;
const records = [];
for (const project of projects.filter((entry) => !selectedProject || entry.name === selectedProject)) {
  const browser = await project.engine.launch({ proxy: { server: 'http://127.0.0.1:9' } });
  const context = await browser.newContext(project.options);
  const site = createMockSite({ now: Date.UTC(2026, 10, 6, 12), displayMode: 'l' });
  await context.addInitScript(() => { Date.now = () => Date.UTC(2026, 10, 6, 12); });
  await context.route('**/*', async (route) => {
    const req = route.request();
    if (req.url().startsWith('data:') || req.url().startsWith('blob:')) return route.continue();
    const response = site.handle({ url: req.url(), method: req.method(), type: req.resourceType(), referer: req.headers().referer || '', body: req.postData() || '', contentType: (await req.allHeaders())['content-type'] || '' });
    if (!response) return route.abort('blockedbyclient');
    return route.fulfill({ status: response.status, headers: response.headers, body: response.body });
  });
  await context.addInitScript(`(() => { if (!location.hostname.endsWith('e-hentai.org')) return; if (location.search.includes('snapshot-paging')) localStorage.setItem('ehtw-reader-mode-v1', 'click'); ${script}\n})();`);
  for (const [scenario, routePath] of scenarios.filter(([name]) => !selectedScenario || name === selectedScenario)) {
    const page = await context.newPage();
    const g = site.state.galleries[0];
    let urlPath = routePath;
    if (routePath === '__gallery__') urlPath = site.galleryPath(g);
    if (routePath.startsWith('__reader')) urlPath = new URL(site.readerUrl('https://e-hentai.org', g, 6)).pathname;
    if (routePath === '__reader-paging__') urlPath += '?snapshot-paging';
    if (routePath === '/uploader/') urlPath = 'https://upld.e-hentai.org/manage?ss=d&sd=d';
    try {
      await page.goto(urlPath.startsWith('https://') ? urlPath : `https://e-hentai.org${urlPath}`, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(350);
      if (scenario === 'gallery-grid') {
        const expand = page.locator('#ehtw-shell button, #ehtw-shell [role=button]').filter({ hasText: /grid|expand|展开|网格/i }).first();
        if (await expand.count()) await expand.click().catch(() => {});
      }
      if (scenario.startsWith('reader')) {
        await page.waitForSelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]', { timeout: 10000 }).catch(() => {});
        if (scenario === 'reader-scroll') {
          await page.evaluate(() => window.scrollTo(0, 3000));
          await page.waitForTimeout(300);
        }
      }
      await page.evaluate(async () => {
        for (const animation of document.getAnimations()) { try { animation.cancel(); } catch {} }
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const snap = await page.evaluate(() => {
        const roots = [...document.querySelectorAll('#ehtw-shell, .ehtw-reader-root')];
        const elements = [];
        for (const root of roots) {
          const all = [root, ...root.querySelectorAll('*')];
          for (const el of all) {
            const style = getComputedStyle(el);
            const computed = {};
            for (let i = 0; i < style.length; i += 1) { const key = style[i]; computed[key] = style.getPropertyValue(key); }
            const rect = el.getBoundingClientRect();
            elements.push({ root: root.matches('.ehtw-reader-root') ? 'reader' : 'shell', tag: el.tagName, id: el.id, cls: typeof el.className === 'string' ? el.className : '', path: (() => { const a=[]; let n=el; while(n&&n!==root){let i=1;for(let p=n.previousElementSibling;p;p=p.previousElementSibling)if(p.tagName===n.tagName)i++;a.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`);n=n.parentElement;}return a.join('>');})(), rect: [rect.x,rect.y,rect.width,rect.height].map(v=>Math.round(v*2)/2), computed });
          }
        }
        const viewport = window.visualViewport;
        return { url: location.pathname + location.search, viewport: { innerWidth, innerHeight, scrollX, scrollY, visualWidth: viewport?.width ?? null, visualHeight: viewport?.height ?? null, visualScale: viewport?.scale ?? null, visualOffsetX: viewport?.offsetLeft ?? null, visualOffsetY: viewport?.offsetTop ?? null }, elements };
      });
      const file = path.join(outputDir, `${label}.${project.name}.${scenario}.json`);
      writeFileSync(file, JSON.stringify(snap));
      records.push({ project: project.name, scenario, elements: snap.elements.length, file: path.relative(ROOT, file) });
    } catch (error) { records.push({ project: project.name, scenario, error: String(error) }); }
    await page.close();
  }
  await context.close(); await browser.close();
}
writeFileSync(path.join(outputDir, `${label}.manifest.json`), JSON.stringify({ inputPath, records }, null, 2));
console.log(JSON.stringify({ label, records }, null, 2));
