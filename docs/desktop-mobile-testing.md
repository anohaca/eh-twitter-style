# Desktop and Mobile Test Runner

Current userscript version: **1.17.232**. Version 1.17.228–1.17.231 references below describe historical runs.

There are two complementary layers:

1. **Offline suite** (`tests/`): Playwright against a mocked, content-free copy of the site. It runs anywhere (no login, no network, no real account writes), covers every page family on desktop, phone emulation and WebKit, and also exercises write flows (follow, favorites, My Tags, block uploader) against a stateful mock backend.
2. **Live runner** (`tools/test-all.mjs`): the deterministic 16-dimension audit plus Chrome CDP checks on the real E-Hentai / ExHentai pages. It can also launch the offline suite and merge its result into the same report.

## Offline suite

```text
cd tests
npm run setup          # npm install + npx playwright install chromium webkit (first time)
npm test               # all 11 projects
npm run test:desktop   # desktop / tablet / narrow + WebKit desktop
npm run test:mobile    # iPhone 13, iPhone 14 Pro Max, Pixel 7, iPhone landscape, WebKit iPhone
npm run test:webkit    # WebKit only (closest automatable engine to iOS Safari)
npm run report         # open the HTML report
```

`EHTW_SCRIPT=/path/to/other.user.js npm test` tests another build. `EHTW_WEBKIT=0` drops the WebKit projects (for Linux hosts without WebKit system libraries).

### Projects

| Project | Viewport | Notes |
|---|---|---|
| desktop-1440-light / -dark | 1440×900 | both color schemes |
| desktop-1280 | 1280×800 | small laptop |
| tablet-900 | 900×1000 | right column hidden |
| narrow-699 | 699×900 | phone breakpoint with a mouse |
| iphone-13-chromium | 390×844 | touch, DPR 3, iPhone UA |
| iphone-14-pro-max-chromium | 430×932 | touch |
| pixel-7 | 412×915 | Android |
| iphone-13-landscape-chromium | 844×390 | rotation / short viewport |
| webkit-iphone-13 | 390×844 | WebKit engine, touch |
| webkit-desktop | 1440×900 | WebKit engine |

### Layout

- `tests/mock-site/site.mjs` generates every page (list in all five display modes, detail, reader, toplists, torrents, news, favorites, My Home children, My Tags, settings, bounties, upload subdomains, login, 404) from synthetic data with neutral titles and SVG placeholder images. It is stateful: My Tags rows, favorites, excluded uploaders and display mode change when the script posts to it. Fault knobs: `failImages`, `failOnceImages`, `slowImagesMs`, `rateLimitApi`, `loggedIn`, `displayMode`, and `faults` — per-request rules (`{ path, type: 'fetch'|'document', status | delayMs | serve: 'redirect'|'gallery'|'list'|'unsupported', times }`) that tests may push into `site.state.faults` at runtime. Fetch rules only hit the SPA router's own fetch (its Referer is the already-pushed target URL), not the timeline's background fetches of the same gallery; hits are recorded in `site.state.faultHits`.
- `tests/mock-site/native.js` stands in for the site's own JavaScript (`toggle_category`, `popUp`, rating, tag menu, comment votes, reader `update_window_extents` …) and records calls in `window.__nativeCalls`.
- `tests/e2e/harness.mjs` routes all requests to the mock (anything else is blocked and reported), injects the userscript at document start with the same `@match` rules as Tampermonkey, and collects page errors, console errors and document loads.
- Favorite flows use a transparent browser-native `<select>` picker from both list cards and detail pages. The mock validates the native form fields and the state-specific `Add to Favorites` / `Apply Changes` submit value; tests cover new favorites, changing an existing folder, the pointerdown-before-change picker sequence, save failures and no page navigation.
- Specs: `boot` (detection, run-once, isolation, rollback, boot curtain), `layout` (breakpoints, overflow, theme, bottom bar on 22 page types), `list`, `detail`, `reader`, `pages` (generic/account/upload/login/display modes/ExHentai), `navigation` (SPA, history, scroll restore, nav chrome, hit testing), `navigation-full` (see below), `follow` (creators, uploaders, feeds, block), `safety` (no writes while browsing, ids not cloned, text not executed, bounded background requests, no eval).

### Browser matrix result

The broad offline run on userscript 1.17.226 executed 1,674 Chromium cases across nine desktop, breakpoint, and touch-emulation projects. It reported 1,591 passed, 4 failed, and 83 skipped. Four failures came from one classification issue: the intentionally invalid `/s/` fixture has no `#img`, and the mocked native site's `update_window_extents` throws on mobile viewport resize. That error is now classified separately, and the four affected cases passed on rerun. Four Chrome phone sticky-header checks also passed after correcting a WebKit-only skip condition. Effective result: **1,595 passed, 79 skipped, 0 userscript failures**.

The full WebKit run executed 372 cases on iPhone and desktop projects: 350 passed, 5 failed, and 17 skipped. Two settings failures found that native WebKit select controls kept their small platform radius; select appearance and radius are now styled explicitly. Two security-counter failures were Playwright Web Inspector's own `eval` calls, not page code; the detector now excludes both supported inspector evaluators. The mobile sticky-header check used unsupported mouse-wheel input and is now skipped on touch WebKit; desktop WebKit still runs it. Rerunning the affected cases produced 5 passes and that 1 intentional skip. Effective result: **354 passed, 18 skipped, 0 userscript failures**. These WebKit projects still do not replace the real iPhone Safari checklist.

The earlier full-suite findings were fixed in userscript 1.17.226:

1. Moved `cancelActiveSpaScrollRestore = finish` into the scroll-restoration function where `finish` exists; removed it from `loadFollowedUploaderEntries()`.
2. Hash-only history changes now preserve the current SPA DOM and native anchor scroll.
3. The capture-phase router leaves native `popUp(...)` links to their inline popup handlers.
4. About-card placement runs during initialization and responds to the 1000px breakpoint.
5. An empty referrer can no longer resolve to the current gallery and trigger `history.back()`.
6. Boot release disconnects the pending observer and prevents it from adding the hidden class after initialization has already ended.
7. The comment vote breakdown is positioned outside the comment grid so it does not shift the hovered score.
8. Card menus close on deliberate wheel/touch scrolling and outside clicks; layout scrolls caused while opening a menu no longer interrupt the action.

Validation: 13/13 deterministic audit suites passed; the affected desktop checks passed 7/7 and phone checks passed 5/5 (one pointer-only hover check skipped); uploader-follow passed 1/1. The full Chromium and WebKit matrices and follow-up results are recorded above. Real iPhone Safari remains pending and must be checked separately.

### Navigation coverage (`navigation-full.spec.mjs`, 47 cases per project)

- **Deep timelines:** a gallery opened from an appended page returns to the same tweet with all pages kept, using browser Back or the header arrow; Forward then Back; infinite scrolling still works after a resume.
- **History shape:** thumbnail pagination must not add history entries; the back arrow on `?p=N`; a search kept as the back target across reader and thumbnails; Back across an in-page `#hash` entry; fresh link clicks open at the top.
- **Interrupted navigation:** Back while a gallery is loading, a second click while the first route loads, a double tap, a new route cancelling a stale scroll restore, and user wheel input winning over a restore.
- **Server faults:** a single 502 is retried in place. Repeated 503, 404, 500, 302, a page without site chrome, and a list served for a gallery URL each fall back to exactly one document load with no duplicate history entry. Gallery markup served for a list URL is rejected. A failed Back fetch after a reload restores the list scroll on the fallback document. The pending state is shown while a route is slow.
- **Not intercepted:** Ctrl/Cmd, Shift and middle clicks; `target=_blank`; external links (Forums); upload subdomains; E-Hentai ↔ ExHentai links; POST forms; `javascript:` and `#` links. GET forms are routed in place, and clicking the current page does not break it.
- **Chrome:** every site nav entry is clicked and must route in place with exactly one current marker; Back walks the nav history; the top tabs are clicked; uploader and tag routes are followed and their back arrows checked; keyboard Enter opens a link.
- **Suspended-page cache:** walks back through six list pages (the cache holds three), checking each scroll position, that the cache stays bounded, and that native scripts are never re-declared.
- **Router details:** URL changes without `popstate` (the Safari edge-swipe reconciler); `document.title`; ExHentai list → gallery → reader → Back → Back; reader → gallery → list; a reload mid-chain; the shape of the router's history state.

Initial result on 1.17.226 (nine Chromium projects, 423 cases): **376 passed, 20 skipped, 27 failed**. The three root causes were repaired in 1.17.228. The final full Chromium run on 1.17.228 reports **403 passed, 20 skipped, 0 failed**. The four focused navigation cases also passed across all 11 Chromium and WebKit projects (44/44).

| # | Bug | Failing case | Cause |
|---|---|---|---|
| N1 | **Fixed:** Back during gallery loading leaves the list URL and content in agreement. | `interrupted navigation › Back while a gallery is still loading` | Stale route responses are rejected before commit. The rendered-route marker stays pinned to the route being committed, and the queued Back is replayed against the current history URL. |
| N2 | **Fixed:** Thumbnail pagination replaces its SPA entry; Back returns to the source list. | `history shape › thumbnail pagination replaces its entry` | The capture router stops the pager cell's inline `document.location` handler after taking over its anchor. |
| N3 | **Fixed:** External root links do not receive the current-page highlight. | `navigating with the chrome › every site nav entry …` | The active navigation check now compares both URL origin and path. |

One observation that is not counted as a failure: after a reload, a failed Back fetch falls back to a fresh document, and the restored position can be about 140px away from the saved one while lazy media reflows. The test accepts ±200px as long as the tweet the user left from is on screen; the in-memory resume path holds ±80px.

## Live runner

```text
node tools/test-all.mjs --script ./eh-twitter-style_user.js --site both --out work/test-runs/<run-name>
```

The CDP endpoint defaults to `http://127.0.0.1:9222`. It can be changed with `--cdp-url`. Use a logged-in Chrome debugging session to include My Home, My Tags, Uploads and the Following feeds; otherwise they are reported as `BLOCKED` rather than passed.

Options: `--list-url`, `--gallery-url`, `--reader-url` override samples. `--platform desktop|mobile` limits the browser matrix. `--offline auto|on|off` also runs the offline suite (auto = when `tests/node_modules` exists); `EHTW_OFFLINE_ARGS="--grep reader"` passes extra Playwright arguments. `--network-stress` opts into the gallery-stats request test. `--static-only` runs the deterministic audit (and the offline suite) without CDP.

### Live navigation suite

```text
node tools/test-navigation-live.mjs ./eh-twitter-style_user.js <listUrl> <galleryUrl> [--mobile iphone|android|ipad] [--only case,case]
node tools/test-navigation-live.mjs ./eh-twitter-style_user.js https://e-hentai.org/ https://e-hentai.org/g/5000/2b80c908ab/ --mock   # self-test, no network
```

`test-all.mjs` runs this automatically per site on desktop, iPhone and Android emulation; turn it off with `--navigation off`. It uses a fresh CDP tab, real mouse/touch/keyboard input, real Back/Forward (`Page.navigateToHistoryEntry`), and Fetch-domain interception for faults. 502, 500, 503×2, 302 and unsupported pages are synthesized locally and only for the router's own fetch. Forums and the other gallery site are answered with local stubs. Nothing is POSTed, and the only requests the site sees are ordinary page GETs. If no userscript manager is installed in the Chrome profile, the script is injected at document start with the `@match` rules.

There are 30 cases. They mirror the offline groups above against real markup: deep round trips, history shape, Back or a second click while loading, every fault fallback, modifier clicks opening tabs, external, cross-site and `_blank` links, every nav entry and the current marker, tabs, uploader/tag routes, keyboard Enter, the suspended-cache walk, Safari URL reconciliation, title, reload mid-chain, and reader → Back. Each case becomes its own result line `<site>-navigation-<platform>-<case>` in `summary.md`.

The `--mock` self-test before the fixes gave 26 passed and 4 failed on desktop, and 24 passed, 4 failed and 2 skipped on iPhone. Its failures matched N1–N3. After the fixes, the full offline Playwright navigation suite passed 403 cases across nine Chromium projects, with 20 device-specific skips. The CDP-based live runner was not rerun here: `http://127.0.0.1:9222/json/version` returned a connection error, so neither its mock mode nor authenticated real-site mode could start. Timeouts report the current URL, class and history stack to help diagnose a future live run.

Manual observation on 2026-11-04 through the open Chrome tab first found version **1.17.210**: its front page marked Front Page, Forums, Wiki and HentaiVerse as current, reproducing N3. After Chrome was updated to **1.17.228**, the homepage showed only Front Page as current. On a real 38-page gallery, clicking thumbnail page 2 then using Chrome's native Back returned to the list in one step. A rapid list → gallery click followed immediately by native Back also ended on the list, with detail markup absent and `ehtw-navigation-pending` cleared. The full `tools/test-navigation-live.mjs` CDP suite is still pending because `127.0.0.1:9222` is unavailable; these are focused manual checks in the logged-in Chrome tab.

## Offline failure triage (1.17.230)

The 16 default `npm test` failures observed on 1.17.229 were investigated against the offline mock.

| Case | Classification and evidence | Resolution |
|---|---|---|
| Already-excluded uploader shows no message | **Userscript bug.** The click navigated with `#ehtw_block_uploader=...`; the settings handler consumed the hash and appended its message, but `navigateSpa()` then pinned `spaRenderedHref` to the old hash URL. The 250ms URL reconciler fetched the same page again and replaced the message. | After `runMain()`, pin `spaRenderedHref` to the actual `location.href` at `eh-twitter-style_user.js:25419`. Targeted test passed across all 11 projects; no native settings write occurs. |
| 302 fallback on WebKit | **Playwright/WebKit route limitation.** Playwright 1.64.1 with WebKit 27.2 (revision 2370) throws `route.fulfill: Cannot fulfill with redirect status: 302` before browser navigation. | Skip only the two WebKit projects for this redirect case; Chromium still runs the unchanged assertion. The other fallback cases still run on WebKit. |
| Failed Back fallback loses scroll on WebKit | **Userscript bug.** WebKit event logging showed `popstate` to `/` with `ehtwScrollY: 7223`, then `pagehide` while the destination URL was active and `scrollY: 0`; the pagehide scroll saver overwrote the destination entry with zero before the fallback document loaded. | `saveCurrentScroll()` at `eh-twitter-style_user.js:323` now ignores a pending navigation when `location.href !== spaRenderedHref`. The original scroll assertion passed in all 11 projects. |
| Middle-click opens no WebKit page | **Headless WebKit limitation.** A minimal offline native-anchor reproduction (no userscript) emitted a `page` event in Chromium 156.0.8078.4 but not WebKit 27.2; the existing WebKit timeout was 5 seconds. | Skip only `webkit-desktop` for middle-click. Chromium middle-click and modifier-click assertions remain unchanged. |

Validation on 1.17.230: `npm test` **2,482 passed, 125 skipped, 0 failed**; `npm run test:static` passed all 13 deterministic suites. Of the 125 skips, 3 are the new scoped WebKit skips above; the rest are the existing project/device-specific skips. `EHTW_SEED=1 npm run test:stability:quick` passed **154/154** with no unexpected failures or S1–S8 expected-fails.

## iPhone Safari left-edge Back diagnostics (1.17.231)

All cases below use only the offline mock. The WebKit iPhone project and iPhone 13 Chromium emulation both passed the race cases; they cannot reproduce the operating system's interactive edge-swipe snapshot or a real Safari gesture cancellation.

| Scenario | Offline result and evidence | Change |
|---|---|---|
| `popstate` and the next 250 ms poll overlap | Passed on both projects. A 700 ms mocked list response kept the pop navigation active across a poll tick. The poll logged `reconcile-skipped: navigation-in-progress`; an explicit duplicate pop request was queued and discarded after the one route render. One pop `navigate-start`, no document navigation, final list URL/content and scroll. | Added enabled-only `reconcile-skipped` logging at `eh-twitter-style_user.js` near line 25505. No route behavior change was needed. |
| URL changes without `popstate` | Passed on both projects. `history.replaceState()` changed the detail address to `/popular`; the idle poll rendered the list, and the next real Back returned to the source list at its saved position. | The existing 250 ms reconcile path works for this sequence; no code change. |
| Cancelled edge gesture, address changes out and back without `popstate` | Final URL and detail content agreed, with no full document load, on both projects. WebKit sometimes reconciled the brief intermediate address before it reverted, so the test allows an SPA route request as long as the current detail route is restored and no pending/wrong page remains. | No code change was justified by the final state. This models the URL sequence, not Safari's native transition snapshot; the precise canceled-gesture timing still needs real-device logs. |
| Two rapid Back inputs (100 ms apart) through reader → detail → list with a 700 ms detail response | **Bug reproduced** on both projects before the fix. A delayed reader `syncReaderHistory()` timer called `replaceState()` after Back had already moved `location.href` to `/`, replacing the list URL with the reader URL. The log showed `reader-history-replace` at the same timestamp window with `href=https://e-hentai.org/` and `spaRenderedHref=https://e-hentai.org/s/...`. | The delayed reader URL sync now checks that the reader route is still current and no SPA navigation is in progress before replacing history (`eh-twitter-style_user.js` near line 2660). After the fix, both Back inputs ended on list URL/content, no document load, and the saved list scroll. A skipped sync is recorded as `reader-history-replace-skipped`. |
| Reader page number changes use `replaceState`; one Back should reach detail | Passed in the existing `reader → gallery → list` case in `navigation-full.spec.mjs`, plus the fast two-level Back case above. | No extra fix. The reader history guard preserves the single gallery entry. |
| Cross-document entry and Back | The mocked `/uconfig.php` document load and Back restored the SPA list and scroll on both projects; the log recorded `pageshow.persisted=false`. | The actual bfcache restore path was **not reproduced** by this harness. Chromium is launched with `--disable-back-forward-cache`, and both current projects reported `persisted=false`. No bfcache-specific code change was inferred. Real Safari logging is needed to inspect a `persisted=true` return. |

### 真机 iPhone Safari 诊断日志使用方法

1. 在 Safari 地址栏打开要测试的站点页面，并在地址末尾加 `#ehtw-navlog-on`，例如 `https://e-hentai.org/#ehtw-navlog-on`。点“前往”后刷新一次，确保用户脚本在读取开关时看到该地址。此命令会把日志开关保存在 `localStorage`；日志内容只放在当前标签页的 `sessionStorage` 环形缓冲区，最多 500 条。
2. 从阅读页往详情页返回、详情页往列表返回，并尝试连续从左边缘向右滑动。记录每种情况是否成功、是否取消手势，以及大致发生顺序。日志会记录时间、路由 URL/渲染 URL、历史状态摘要、历史长度、滚动位置、页面生命周期和左边缘触摸坐标；不记录 cookie 或账号字段。
3. 在地址栏打开 `https://e-hentai.org/#ehtw-navlog`（或把域名换成当前的 `exhentai.org`），刷新一次。面板出现后点“复制”；若 Safari 未授予剪贴板，文本会被选中，请长按文本框复制。需要重新采集时点“清空”。
4. 复制日志发回后，在地址栏打开 `https://e-hentai.org/#ehtw-navlog-off` 并刷新。开关会保存为关闭；之后不再安装诊断触摸/可见性监听器或创建诊断定时器。切换 hash 后刷新是必要的，因为关闭状态不安装额外的 `hashchange` 监听器。

当前离线证据不能判断真机 Safari 交互手势取消时是否会短暂暴露目标地址、会不会显示旧页面快照、真实 bfcache 是否 `persisted=true`，也没有重现整页白屏或一次手势跨越多级历史。请用以上步骤采集真机日志后再判断这些现象。

Validation on 1.17.231: `npm test` **2,503 passed, 170 skipped, 0 failed** in 8.9 minutes; `npm run test:static` passed all **13 deterministic suites** (0.5 seconds; parse median 3.56 ms); `EHTW_SEED=1 npm run test:stability:quick` passed **154/154** in 7.1 minutes. There were no unexpected failures or S1–S8 expected-fails. The 170 default-suite skips include 45 skips for the five new gesture cases outside the two requested iPhone projects, plus existing device/tool-specific skips.

One earlier full-suite run had a single WebKit desktop Shift+click popup timeout (5 seconds). The same case passed immediately when run alone and passed in the final full suite, so it was left unchanged and not skipped. A separate native-link experiment failed to receive its offline route response and displayed `Key missing, or incorrect key provided.`; it was stopped immediately. I cannot rule out that this one read-only GET reached the real host. It produced no writes and is not used as evidence for a product or browser limitation; all suite runs used the offline harness.

## iPhone Safari Back follow-up (1.17.232)

The 1.17.231 nav log established that Safari pop fetches from reader to detail failed twice with `TypeError: Load failed`, then hit the document fallback. It also showed a pop arriving during fallback and a later zero scroll save after restoration. The exact Safari-only fetch abort and zero-scroll event origin cannot be reproduced offline; the related route and state bugs were reproduced in the harness as follows.

| Evidence | Root cause classification | Fix |
|---|---|---|
| Pop fetch failure and history corruption | **Confirmed code bug:** `navigateSpa()` used `location.assign()` for a `pop` fallback when `historyPrepared` was false. That adds/replaces the wrong history position and drops the forward reader entry. **Confirmed cache gap:** only list-like pages were suspended, so detail was always fetched when Back returned from reader. **Safari fetch abort mechanism remains an inference.** | Pop fallback now always uses `location.replace()`. List and gallery detail pages are suspended. Pop recovery can find a suspended page by URL when its `history.state` entry id is missing. A transient `TypeError` now waits 700 ms and one animation frame, and retries only if the destination URL is still active. If it still fails, fallback uses replace. |
| Frequent `replaceState` and empty reader state | **Confirmed code issue:** `saveCurrentScroll()` called `replaceState()` on every animation-frame save. **External state clobber source is unconfirmed:** this script's reader sync passes through the current `history.state`; the real EH reader script is absent from the offline mock. | Scroll positions still write to sessionStorage immediately; history state writes are debounced to 200 ms. Pagehide and navigation flush the pending value when safe. Edge touches, active navigation, restore, and a 650 ms post-restore window suppress scroll-driven replacements. All userscript `replaceState` calls now log exceptions. Script history metadata is backed up per URL in sessionStorage and recovered when a pop state is `{}`. |
| Scroll save writes zero just after restoration | **Zero event source is not confirmed.** The userscript's `scrollTo(0, 0)` runs on ordinary pushed navigation; the pop restore path does not call it. A delayed Safari scroll event after the restored layout is the leading inference. | Scroll saves are ignored while restoration owns the lock and during the 650 ms quiet window afterward, so a transient zero cannot overwrite history state or sessionStorage. |

Offline regressions ran on `webkit-iphone-13` and `iphone-13-chromium` for all seven new cases: two aborts on pop fallback and Forward preservation; reader→detail cache restore without another fetch; scroll write debouncing; left-edge touch suppression; empty history state recovery; restored-scroll zero protection; and SecurityError logging. Relevant existing `navigation-full`, `navigation`, `reader`, and `navigation-diagnostic` specs also ran with `desktop-1440-light` as the Chromium desktop check. Combined result: **233 passed, 28 skipped, 0 failed** in 2.3 minutes. The 7 new regressions skip only the desktop project; the other 21 skips are pre-existing or device-specific. `npm run test:static` passed **13/13** (parse median 3.68 ms). The user requested no full `npm test` or stability quick for this task, so neither was run.

The Safari fetch behavior, system back-swipe snapshot timing, true bfcache restoration, and the external site's history-state changes still require a real iPhone Safari retest. After installing 1.17.232, enable diagnostics with `#ehtw-navlog-on`, reload, reproduce reader→detail and detail→list Back (including two quick swipes), then open `#ehtw-navlog`, reload, and copy the log. Turn it off with `#ehtw-navlog-off` and reload. The buffer remains in sessionStorage across document reloads and contains no cookies or account fields.

### Matrix

- Desktop Chrome: 1920×1080, 1440×900 light/dark, 1280×800, 1024×768 dark, 1000/999px, 900×900, 768×1024, 699/700px breakpoints and 390px.
- Phone/tablet emulation (touch, device UA and DPR): iPhone 390×844, iPhone Pro Max 430×932, iPhone landscape 844×390, Android 412×915, iPad 768×1024.
- Page families: list/search/tag/toplist result/torrents/news, native display modes, detail and its second thumbnail page, Following feeds, My Home children, uploads/bounties, and reader first/middle/last pages.
- Reader checks include vertical and click modes, page seeking, preload, retry, memory release, and repeated SPA detail/list navigation.
- The real iPhone Safari items are in [desktop-mobile-test-checklist.md](desktop-mobile-test-checklist.md). Neither Chrome emulation nor Playwright WebKit replaces a real iPhone.

## Artifacts and safety

### Offline browser egress guard

An earlier isolation check found that Playwright 1.64.1 / WebKit 27.2 does not deliver Shift/Ctrl/Meta popup navigation requests to `BrowserContext.route`. The affected cases are the Ctrl/Meta-click and Shift-click new-page cases in `tests/e2e/navigation-full.spec.mjs`; these are desktop-only, so the affected project is `webkit-desktop`. Since the request bypassed the route callback, `diagnostics.external` could not observe it. The `target=_blank` case was explicitly checked with `.invalid` and did reach `context.route`, but the browser-level guard covers it too. WebKit iPhone and other touch projects skip the modifier-click cases; the WebKit desktop middle-click case is already skipped because headless WebKit does not create a page for it.

The route-only gap existed before this fix; the first date is not recorded because this workspace has no Git history. It was present at least in the 1.17.230 test set. The prior Shift-click experiment showed `Key missing, or incorrect key provided.`, consistent with an unauthenticated read-only GET reaching the site. Playwright test contexts contain no real-site account cookies, and these cases issue GET navigations only. The exact historical request count is unavailable.

Both `tests/playwright.config.mjs` and `tests/playwright.stability.config.mjs` now launch every browser with an HTTP proxy at `127.0.0.1:9`, where no proxy server is running. Requests fulfilled by Playwright routes continue to work; any browser request that escapes routing fails at the local proxy and cannot reach a public host. `tests/e2e/network-guard.spec.mjs` proves this using only `.invalid` domains: Chromium modifier/`_blank` popups are fulfilled by the mock route; WebKit modifier popups are not routed and stay on the blank page; direct unrouted navigation fails with a local connection error in both engines. Playwright-driven navigation of the recorded popup target is then fulfilled by the mock. The same test confirms `sendBeacon` and WebSocket attempts fail when routes are absent.

Service workers remain blocked by both configs. Fetch/XHR and normal document routes continue through the context mock. WebSocket, `sendBeacon`, and other browser-managed transports are covered by the browser proxy even when `context.route` does not observe them. An audit found no Playwright `browserType.launch()` calls under `tools/`; `tools/test-all.mjs` invokes the protected offline Playwright config, while the `tools/*-browser.mjs` and `tools/test-navigation-live.mjs` scripts attach to a user Chrome/CDP session and are intentionally live tools, not modified here.

Validation of the egress guard: all 10 `network-guard.spec.mjs` cases passed across desktop Chromium and WebKit desktop; the new-page route cases in `navigation-full.spec.mjs` passed for Chromium, WebKit desktop, and WebKit iPhone where applicable.

Final validation with the guard: `npm test` **2,513 passed, 215 skipped, 0 failed** in 8.8 minutes; `npm run test:static` **13/13 passed** (about 0.5 seconds; parse median 3.5 ms); `EHTW_SEED=1 npm run test:stability:quick` **154/154 passed** in 7.1 minutes, with unexpected=0 and S1–S8 expected-fail=0. Of the 215 default-suite skips, **45 are new conditional skips**: five network-isolation probe cases are run only in `desktop-1440-light` and `webkit-desktop` (the other nine projects skip those cases). Other skips are pre-existing device/tool-specific skips; no popup navigation case was newly skipped.

Each live run writes `summary.json`, `summary.md`, redacted test logs, blurred public-page screenshots, the offline results (`offline-results.json`, `offline-report/`), and a Safari checklist into the output directory. Screenshots are disabled for authenticated/private pages; the runner snapshots `ehtw-*` localStorage in memory and restores it in `finally`. The live runner does not submit favorite, follow, block, rating, comment, or upload actions; those flows are only exercised offline against the mock.

`PASS` means the automated check passed; `FAIL` indicates a regression; `BLOCKED` means required CDP/site/login access was unavailable; `SKIPPED` means an optional or inapplicable check was not run; `WARN` is evidence that needs review. A full run still requires the real iPhone checklist to be completed manually.

## Stability testing

The offline long-run stability suite, its quick/full commands, seed replay instructions, provisional thresholds, and result notes are documented in [stability-testing.md](stability-testing.md).

## iPhone Safari same-URL reload recovery and cache A/B diagnostic (1.17.234)

The 1.17.233 real-device capture recorded five full document reloads, each at the URL already shown in the address bar. New documents reported Navigation Timing `type: "navigate"`, `document.referrer` on the same path, and `pageshow.persisted: false`; none of the wrapped location, form, or anchor APIs logged a call. Two reloads occurred about 0.5 seconds after a push (one while a fetch failed, one on a detail left-edge gesture), without a preceding `pagehide` or `unload`. Two more followed a `resumed-suspended-page` return to `/popular` by about 0.6 seconds and did have `pagehide.persisted: false` plus `unload`. A previous 1.17.232 capture also saw a detail reload 0.77 seconds after reader-to-detail cache restoration. Reader-to-detail cache returns and fetch-rendered pops also completed without reloads. The initiator therefore remains unknown; these observations alone do not prove that the suspended-page cache causes the reload.

The confirmed user-visible issue was lost list scroll: the reloaded `/popular` entry retained `history.state.ehtwScrollY` (237 or 1796), but the old pageshow gate rejected `navigate` documents and left the user at the top. Version 1.17.234 restores scroll for a fresh `navigate` document when the referrer matches the current URL after removing hashes and the history entry has `ehtwSpa: true`. It reads `ehtwScrollY` from history state, then the existing sessionStorage scroll value. The same recovery now applies to detail routes. A manual address-bar open has no referrer and does not match this recovery condition.

For diagnosis, `#ehtw-nocache-on` stores the disabled setting in localStorage; refresh once after applying the hash so the document starts with the selected mode. With caching disabled, pages are not suspended and pop navigation fetches and renders the destination. `#ehtw-nocache-off` restores the default cache-enabled mode; also refresh once. When nav logging is enabled, each `navigation-log-enabled` event records `suspendCache: on|off`. Each `navigate-finish` stores a session-only heartbeat with timestamp, URL, suspended-page count, and approximate image count. At the next document start, a prior heartbeat without a `pagehide` clean-exit marker produces `previous-document-no-clean-exit`, including the heartbeat and elapsed time. This is a crash/reload distinction signal, not proof of an OS memory kill. It records no cookie or account fields.

For the real iPhone A/B capture, first keep the default cache enabled (`#ehtw-nocache-off` if needed), refresh once, enable logging with `#ehtw-navlog-on`, then repeat `/ → /popular → gallery → reader → Back → Back` and wait at least 2 seconds. Save the log. Next open `#ehtw-nocache-on`, refresh once, enable logging again if needed, repeat the same route sequence and wait, then save the second log. Compare the number of document reloads between the cache-on and cache-off runs. Also check `navigation-log-enabled.suspendCache` and look for `previous-document-no-clean-exit` after a reload. Copy logs with `#ehtw-navlog` and turn logging off with `#ehtw-navlog-off`, refreshing after each switch as needed.

The 1.17.233 captures showed no navigation API initiator; the 1.17.234 recovery and cache A/B result still need real-device confirmation. Offline tests validate the recovery predicate and same-URL navigation behavior, but cannot identify iOS WebContent process termination.

## iPhone reader `popstate` cleanup (1.17.235)

The 1.17.234 real-device A/B logs showed the same-URL `type: "navigate"` reloads both with suspended-page caching enabled and disabled. Across five logs, every reload followed a same-document SPA visit to `/s/` and a later `popstate`; earlier `popstate` events before visiting the reader did not reload. Some Back gestures had no userscript `popstate` log before the reload. After the reader rendered, `history.state` had become an object with no EHTW fields. This points to reader-page code replacing history state and leaving a window-level reader handler behind. That handler is the working hypothesis; the real site handler has not been downloaded or inspected.

Version 1.17.235 installs a small page-world bridge. It waits for `<html>` if the userscript runs before `documentElement` exists, injects a tiny DOM script to probe which world is active, then calls the bridge directly in page world or injects the bridge script for Userscripts (quoid) content-world isolation. If the bridge cannot be installed, nav log records the injection failure reason. With `#ehtw-navlog-on`, the bridge reports selected window listener counts and function source prefixes, `window.onpopstate` on each pop, Location and History calls with shortened stacks, and state key names only. Reports cross back through `CustomEvent` and `postMessage`; a shared DOM attribute signals the reader route for cleanup. No state values, cookies, or account fields are copied.

When the rendered SPA route leaves `/s/` through push or pop navigation, or before that reader page is suspended, the bridge clears `window.onpopstate` and removes window `popstate` listeners registered while the reader was active. Reader `popstate` handlers are guarded while the reader route is active so they cannot take over the userscript reader's navigation. The userscript's own popstate handler is registered before that route becomes active and remains available to the SPA router. The same cleanup applies when the Back event has already changed `location.pathname`, by checking the route whose DOM is still rendered.

The offline mock now includes an explicitly synthetic hypothesis model in `tests/mock-site/native.js`: the reader replaces state with `{page: 1}`, assigns a `window.onpopstate` reload handler, and adds the same reload logic as a window listener. It is not copied from the live site's `ehg_show.c.js`. The new `native-reader-popstate.spec.mjs` follows `/` → `/popular` → detail → `/s/`, then Back twice, checks that the document marker survives for 1.5 seconds, and verifies the detail and list content. It runs once with the default cache and once with the localStorage cache switch disabled. On the unmodified 1.17.234 script, both variants failed in all three requested browser projects by detecting an extra document navigation. On 1.17.235, the selected 288-test matrix covering this regression, Safari history recovery, navigation, reader, gesture races, and navigation diagnostics finished **254 passed, 34 skipped, 0 failed** in 2.7 minutes. The six new regression cases and six navigation-diagnostic cases passed again in a final subset run. `npm run test:static` passed all **13 deterministic suites**. Per request, the full `npm test` and stability quick suite were not run.

For a real iPhone retest, leave caching at its default enabled setting. With nav logging enabled and after refreshing, follow Home → `/popular` → detail → reader, then swipe back twice and remain on `/popular` for 2 seconds. Repeat 2–3 rounds. Check that both Back destinations render in place and that no new `document-navigation-entry` appears after leaving `/s/`. If a reload still occurs, copy the nav log with `#ehtw-navlog`; turn logging off with `#ehtw-navlog-off` and refresh when done.
