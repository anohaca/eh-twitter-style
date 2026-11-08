#!/usr/bin/env node
// Reproducible quality audit for EH Twitter Style.
// Runs deterministic regression suites, static safety/resource checks, and a
// small JS parse benchmark. Browser-only dimensions are reported separately.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const sourceUrl = new URL('../src/eh-twitter-style.user.src.js', import.meta.url);
const installUrl = new URL('../eh-twitter-style_user.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const install = readFileSync(installUrl, 'utf8');
const bytes = statSync(installUrl).size;
const checks = [];
const add = (dimension, status, evidence) => checks.push({ dimension, status, evidence });
const requireCheck = (condition, message) => assert.ok(condition, message);

// 1. Functionality: existing deterministic behavior suites are the main proof.
const suites = [
  'test-account-menu.mjs',
  'test-back-navigation.mjs',
  'test-card-follow-block.mjs',
  'test-following-feed.mjs',
  'test-gallery-modes.mjs',
  'test-gallery-continuation.mjs',
  'test-gallery-wheel.mjs',
  'test-infinite-list.mjs',
  'test-myhome-layout.mjs',
  'test-reader.mjs',
  'test-search-toplists.mjs',
  'test-toplists-page.mjs',
  'test-spa-navigation.mjs'
];
const suiteResults = [];
for (const suite of suites) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`./${suite}`, import.meta.url))], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
    timeout: 120_000
  });
  suiteResults.push({
    suite,
    ok: result.status === 0,
    ms: Math.round(performance.now() - started),
    output: (result.stdout || result.stderr || '').trim().split('\n').slice(-3).join(' | ')
  });
}
const failedSuites = suiteResults.filter((result) => !result.ok);
requireCheck(failedSuites.length === 0, `Behavior suites failed: ${failedSuites.map((x) => x.suite).join(', ')}`);
add('1 功能性', 'PASS', `${suiteResults.length} 个确定性回归套件通过`);

// 2. Appearance: verify that the style system and responsive breakpoints exist;
// actual visual correctness still requires screenshots at real viewport sizes.
requireCheck(/createElement\(['"]style['"]\)/.test(source), 'No userscript styling found');
requireCheck(/@media\s*\(/.test(source), 'No responsive/media-query rules found');
add('2 外观设计', 'PARTIAL', '发现脚本样式和媒体查询；布局/视觉需浏览器截图人工检查');

// 3/12. Performance and startup: parse the actual userscript repeatedly and
// report median compile time. This is a stable code-size/parse proxy, not FCP.
const compileSamples = [];
for (let i = 0; i < 9; i += 1) {
  const started = process.hrtime.bigint();
  for (let sample = 0; sample < 25; sample += 1) {
    // Vary the trailing comment to avoid reusing V8's cached compilation result.
      new vm.Script(`${install}\n//# audit-${i}-${sample}`, { filename: `eh-twitter-style-${i}-${sample}.user.js` });
  }
  compileSamples.push(Number(process.hrtime.bigint() - started) / 25e6);
}
const median = compileSamples.sort((a, b) => a - b)[Math.floor(compileSamples.length / 2)];
requireCheck(bytes < 1_500_000, `Script grew beyond 1.5 MB (${bytes} bytes)`);
add('3 性能', 'MEASURED', `压缩安装文件 ${(bytes / 1024).toFixed(1)} KiB；Node 中位解析 ${(median).toFixed(2)} ms（不代表手机端完整加载时延）`);
add('12 启动速度', 'PARTIAL', `已测 JS 解析耗时 ${median.toFixed(2)} ms；浏览器注入延迟/首次绘制仍需设备实测`);

// 4/6. Reader memory and resource usage guardrails.
requireCheck(/READER_IMAGE_PREFETCH_CONCURRENCY\s*=\s*5/.test(source), 'Reader image prefetch concurrency guard missing');
requireCheck(/activeReaderImageQueueLoads\.size/.test(source), 'Reader queue does not account for active requests');
requireCheck(/imageMemoryObserver\?\.disconnect\(\)/.test(source), 'Reader memory observer cleanup missing');
requireCheck(/image\.removeAttribute\('src'\)/.test(source), 'Reader image memory release path missing');
requireCheck(/activeNextAbortController\?\.abort\(\)/.test(source), 'Reader request cancellation path missing');
add('4 内存', 'PASS', '检查到阅读器视口外图片释放、Observer 断开、队列请求取消');
add('6 资源占用', 'PARTIAL', '阅读器预载并发上限为 5；CPU/GPU/磁盘/电量需设备性能面板实测');

// 5. Architecture and lifecycle.
requireCheck(/const publishSpaPageCleanup\s*=/.test(source), 'SPA lifecycle cleanup publisher missing');
requireCheck(/spaPageEventListeners\.splice\(0\)/.test(source), 'SPA event listener registry is not drained on cleanup');
requireCheck(/observer\?\.disconnect\(\)/.test(source), 'Observer lifecycle cleanup missing');
add('5 架构', 'PARTIAL', '检查 SPA 路由生命周期清理和监听器登记；模块边界仍是单文件 userscript');

// 7. Security: forbid dynamic code evaluation and constrain SPA navigation to
// same-origin requests. The dynamic script execution inherited from fetched
// first-party pages is reviewed as a browser integration risk, not a sandbox.
requireCheck(!/\beval\s*\(|\bnew\s+Function\s*\(/.test(source), 'Dynamic code evaluation found');
const htmlInjectionPoints = [...source.matchAll(/\.innerHTML\s*=/g)];
requireCheck(htmlInjectionPoints.length === 1, `Expected only one audited innerHTML assignment, found ${htmlInjectionPoints.length}`);
requireCheck(/preloadSummary\.innerHTML\s*=\s*'<svg[\s\S]*?<\/svg>'/.test(source), 'The remaining innerHTML assignment must stay a static SVG literal');
const spaStart = source.indexOf('async function navigateSpa(');
const spaEnd = source.indexOf('window.__EHTW_SPA_NAVIGATE__ = navigateSpa;', spaStart);
requireCheck(spaStart >= 0 && spaEnd > spaStart, 'SPA navigation implementation missing');
const spa = source.slice(spaStart, spaEnd);
const spaFetchStart = source.indexOf('async function fetchSpaRouteResponse(');
const spaFetchEnd = spaStart;
requireCheck(spaFetchStart >= 0 && spaFetchEnd > spaFetchStart, 'SPA fetch retry helper missing');
const spaFetch = source.slice(spaFetchStart, spaFetchEnd);
requireCheck(/targetUrl\.origin !== location\.origin/.test(spa), 'SPA router does not enforce same-origin');
requireCheck(/credentials:\s*'same-origin'/.test(spaFetch), 'SPA fetch credentials policy missing');
add('7 安全性', 'PASS', '无 eval/Function；唯一 innerHTML 是静态 SVG；SPA fetch 限制同源（不替代完整安全渗透测试）');

// 8/11/15. Stability, reliability and fault recovery.
requireCheck(/READER_IMAGE_LOAD_TIMEOUT_MS\s*=\s*30000/.test(source), 'Reader image load watchdog missing');
requireCheck(/READER_IMAGE_AUTO_RETRY_LIMIT\s*=\s*2/.test(source), 'Reader bounded automatic retry missing');
requireCheck(/location\.assign\(targetUrl\.href\)/.test(spa), 'SPA fallback navigation missing');
requireCheck(/onerror|addEventListener\('error'/.test(source), 'Resource error handling missing');
add('8 稳定性', 'PASS', '阅读器图片超时、有限自动重试、SPA 失败回退均有实现');
add('11 可靠性', 'PARTIAL', '异常恢复路径有覆盖；长时间运行与真实站点错误率需要持续浏览器测试');
add('15 容错能力', 'PASS', '阅读器失败可重试；SPA 失败回退整页导航');

// 9. Compatibility: verify feature detection/fallbacks for browser APIs.
requireCheck(/typeof window\.IntersectionObserver\s*===\s*'function'/.test(source), 'IntersectionObserver feature detection missing');
requireCheck(/window\.requestAnimationFrame\s*\|\|/.test(source), 'requestAnimationFrame fallback missing');
requireCheck(/typeof window\.AbortController\s*===\s*'function'/.test(source), 'AbortController feature detection missing');
add('9 兼容性', 'PARTIAL', '关键浏览器 API 有能力检测或回退；Safari/iOS/Android 仍需真机矩阵测试');

// 10/13. Usability and interaction response contracts.
requireCheck(/aria-label=|setAttribute\(['"]aria-label['"]/.test(source), 'Accessible labels not found');
requireCheck(/addEventListener\(['"]click['"]/.test(source), 'Click interaction handlers missing');
add('10 易用性', 'PARTIAL', '检查到交互处理和 aria 标签；学习成本与可发现性需人工试用');
add('13 响应体验', 'PARTIAL', '已运行交互回归；动画帧率、触摸延迟需设备实测');

// 14. Network behavior: reader prefetch has bounded concurrency and retry path;
// SPA network latency is inherently server/device dependent.
requireCheck(/credentials:\s*'same-origin'/.test(source), 'Same-origin request policy missing');
requireCheck(/cache:\s*'default'/.test(spaFetch), 'SPA fetch bypasses normal HTTP cache');
add('14 网络能力', 'PARTIAL', '请求并发/缓存/错误恢复路径有检查；断网/弱网/服务器限流需在线模拟');

// 16. Energy and heat cannot be asserted from source. Keep this explicit rather
// than claiming a static test proves it.
add('16 资源效率', 'MANUAL', '需真机长时间阅读并记录电量、温升、后台唤醒；本审查器不伪造此类结论');

// Syntax + userscript metadata are release-level invariants.
new vm.Script(source, { filename: 'eh-twitter-style.user.src.js' });
new vm.Script(install, { filename: 'eh-twitter-style_user.js' });
requireCheck(/@match\s+https:\/\/e-hentai\.org\/\*/.test(source), 'E-Hentai match metadata missing');
const sourceVersion = source.match(/@version\s+(\S+)/)?.[1] || 'unknown';
const installVersion = install.match(/@version\s+(\S+)/)?.[1] || 'unknown';
requireCheck(sourceVersion === installVersion, `Source/install version mismatch: ${sourceVersion} vs ${installVersion}`);
add('语法/发布元数据', 'PASS', `源码与安装文件语法有效；版本 ${sourceVersion}`);

const report = {
  file: fileURLToPath(sourceUrl),
  installFile: fileURLToPath(installUrl),
  bytes,
  parsedMedianMs: Number(median.toFixed(2)),
  deterministicSuites: suiteResults,
  dimensions: checks
};
console.log(JSON.stringify(report, null, 2));
