# 离线稳定性测试

当前修复版本为 **1.17.232**。下方原始阈值及 seed 202/303/101 报告是修复前基线；阈值未重新标定。

本套测试针对 `eh-twitter-style_user.js` 做长会话、重复导航、资源变化、故障恢复与空闲成本检查。请求全部由 `tests/mock-site/site.mjs` 提供；测试不会访问真实站点。除单项另有注明外，每组逐个测试都在 EH 与 EX 两个 origin 执行。

## 文件与运行

配置位于 `tests/playwright.stability.config.mjs`，只启用 `desktop-1440-light`、`iphone-13-chromium` 和 `desktop-1440-dark`。light 与 iPhone 项目运行 J 组的随机视口用例；dark 项目运行 J 组全部用例，包括视口和主题切换。配置使用两个 worker、quick 5 分钟超时、full 30 分钟超时，并将报告与 trace 放到 `work/test-runs/stability-report` 和 `work/test-runs/stability-artifacts`。

```sh
cd tests
npm run test:stability:quick
npm run test:stability:full
npm run test:stability
```

`test:stability` 等同 full。按 Playwright 标题筛选单项，例如：

```sh
EHTW_SEED=12345 npx playwright test --config=playwright.stability.config.mjs --grep "A random navigation soak"
```

每条测试生成并打印 `EHTW_SEED` annotation，操作记录、采样指标和 seed 附在 `stability.json` 中；其中操作 annotation 保存去除耗时字段后的操作片段或 `{action,url}` 序列，便于比较同一 seed 的复现结果。同一 seed 使用 mulberry32 生成固定的随机操作序列；未指定 seed 时使用随机 seed。测试中断时也会尽量保存附件。

## 测试组

| 组 | 测试内容 | 用途 |
|---|---|---|
| A `soak.spec.mjs` | 种子生成回首页片段并在同一 SPA 会话重放 3 遍；每遍回首页并等待 watchdog drain 后采样 | 对照相同操作位置检查资源是否继续累积 |
| B `cycles.spec.mjs` | B1 列表详情往返、B2 详情阅读器往返、B2b reader watchdog 瞬时滞留、B3 列表分页往返 | 区分缓存中挂起页保留期间的 S2 listener 增长与 S1 暂时 DOM 滞留 |
| C `infinite.spec.mjs` | 长列表滚动、累计唯一 gallery href 去重、请求并发、统计缓存及静置 | 检查无限滚动和后台统计请求的边界；如果列表虚拟化导致卡片离开 DOM，数量按滚动期间累计见到的唯一 href 统计 |
| D `reader.spec.mjs` | quick 从第1页读到第11页、full 走完45页，结合失败一次、持续失败、慢图、S7 重试竞态和 S8 重复响应 | 检查预取并发、失败恢复和 reader DOM 上界 |
| E `chaos.spec.mjs` | 随机路由故障、错误状态码、延迟和错页响应 | 检查 SPA 路由与文档 fallback 在故障下保持 URL/内容一致 |
| F `races.spec.mjs` | 快速多击、Back/Forward 连击和 pending 路由竞争 | 检查并发输入下最终路由与内容一致 |
| G `storage.spec.mjs` | 非法 JSON、大值、QuotaExceeded、localStorage getter 异常、null sessionStorage、反复 reload | 检查存储不可用时页面功能和 key 数量边界 |
| H `lifecycle.spec.mjs` | 重复注入、离站后 pageshow、visibility 切换 | 检查生命周期恢复及重复初始化的资源影响 |
| I `idle.spec.mjs` | 首页、详情、reader 各自静置 quick 3 秒 / full 60 秒 | 检查 idle 网络、interval、rAF 与 Chromium TaskDuration |
| J `viewport.spec.mjs` | 多 viewport 随机调整与明暗主题切换 | 检查布局、shell 唯一性及切换后资源变化 |
| 探针自测 `probe.spec.mjs` | 原生事件 options、timer、rAF、observer、GC 弱引用、CDP 指标、边界斜率和加探针等价性 | 验证探针本身不抛错、不吞指标且不改变首页结果 |

除 I 组按规格静置、F 组 50ms 连击以及资源加载延迟外，测试使用条件等待，不以固定 sleep 代替状态检查。

## 阈值

旧的 seed 101 完整结果报告曾被 23:19 的定向 Playwright 运行覆盖，且当时早于 E/H 测试侧修正；其中留下的部分观测值未用于本轮标定。本轮按 seed 202、303、101 依序各跑一次完整 full，并在任何后续 Playwright 运行前分别备份到 `work/test-runs/stability-calibration/results-seed{202,303,101}.json`。下面的观测值只来自这三份新备份。绝对存活数精确比较不参与阈值标定。

根据 `tests/e2e/boot.spec.mjs` 的页面分类断言，不变式对 `/s/` 阅读页单独要求 `#ehtw-shell` 为 0、reader root 恰好 1；其它壳页面才要求 shell/header 各 1。其它路径按 boot 用例列出的 list、generic、bounty、myhome、mytags 类别映射，不将所有非 detail 路径视为 list。

| 指标 | 标定值 | seed 202 / 303 / 101 的观测与计算 |
|---|---:|---|
| DOM Nodes 斜率 / 绝对上限 | 111.041 / step；128,538 | A 每遍去掉前2个 warmup 样本后斜率 41.979 / -27.779 / 55.520；最大 Nodes 55,179 / 55,388 / 64,269。各阈值=2×三次最大观测 |
| listener 斜率 / 绝对上限 | 0.623773 / step；1,094 | A listener 总量斜率 0.258455 / -0.240091 / 0.311886；最大值 480 / 529 / 547；阈值=2×最大观测 |
| observer 斜率 / 绝对上限 | 0.017389 / step；20 | A observer alive 总量斜率 0.008694 / -0.005262 / 0.005334；最大值 10 / 9 / 8；阈值=2×最大观测 |
| interval 斜率 / 绝对上限 | 0 / step；2 | A interval 斜率三次均为0、最大值均为1；阈值=2×最大观测。精确计数比较保持不变 |
| JS heap 斜率 / 绝对上限 | 20 KiB / step；23,306,928 B | A heap 斜率 6,035.05 / 1,213.48 / 7,728.51 B/step；2×最大值低于20 KiB/step下限，故取20 KiB。最大值 11,040,332 / 11,146,368 / 11,653,464 B，阈值=2×最大观测 |
| A heap pass 2→3 增量上限 | 653,176 B | 三次 full 最大正增量 253,752 / 295,784 / 326,588 B；阈值=2×最大值 |
| inflight 上限 | 10 | C fetch/XHR peak 三次均为5；阈值=2×最大观测 |
| ehtw storage keys / 字节数上限 | 10 / 157,332 B | 正常 A/G reload localStorage 最大值三次均为5 keys / 78,666 B；阈值=2×最大观测，不含故障注入的1 MiB值 |
| reader 图片 DOM 上限 | 90（PROVISIONAL） | 三份备份未记录 D 每轮 reader image DOM count；旧单次45不用于本次标定。现在已添加 `D-reader-image-dom-observation` annotation，未来完整采样后再定稿 |
| viewport counter growth | 10（PROVISIONAL） | 三份备份未记录 J 转换前 baseline 和最大正增量。现在已添加 `J-viewport-counter-growth` annotation，未来完整采样后再定稿 |

### A 组同序列遍间比较与单次实测

A 用种子生成 `scale(1, 200)` 个操作片段，三遍重放同一列表。每个片段从首页开始并回首页，动作池覆盖 gallery-back、reader-back、forward-back 和顶部导航。quick 使用 seed 1 的一个 navigation-back 片段，full 保持200；缩略图随机索引限制在详情页首屏20项内。顶部入口统一经 `navEntry` 操作；回首页时若 More 展开，通过真实 More 按钮收起，不使用 force。full 每遍等待32秒排空 watchdog；quick 检查本遍新增 timeout，有 reader watchdog 时等其清除/到期，无新增 timeout 时不空等。修复前 A listener 允许逻辑曾将单独正向 `element:error` 增量包装为 S2 known issue；1.17.230 已移除该包装，所有 listener 类别严格要求零增量。

菜单状态由 `eh-twitter-style_user.js:18173–18185` 的按钮 click handler 显式切换 `nav` 上的 `ehtw-nav-open` class 并更新 `aria-expanded`；SPA 导航复用同一壳层，路由提交没有收起该 class 的处理。因此 A 测试把跨 SPA 路由保留的展开状态当作既有菜单行为，在卡片操作前用 More 按钮收起。

favorites 的路由正则等待曾选中临时 class：seed 101 的最小复现中，URL 已是 `/favorites.php` 时首个采样为 `ehtw-list + ehtw-navigation-pending`，约 50 ms 后变为 `ehtw-generic` 并清除 pending；此前等待器把临时 `ehtw-list` 交给 harness，之后 harness 精确等待该 class，稳定帧计数始终为 0。`waitForRouteWithContext()` 现在等待 URL、pending/boot 清除和 SPA ready 后才取实际 class，再调用 harness。favorites EH/EX 最小复现通过。

三份备份的 A pass 2→3 Nodes 四个项目/origin 会话内均相同；四会话分别的 Nodes 与 heap 增量见 `results-seed202.json`、`results-seed303.json`、`results-seed101.json` 的 `A-pass-snapshots`。阈值表由这三份附件的所有 A 操作样本重新计算；不再使用旧报告中被覆盖的 seed101 观测值。

沙箱外实测（**单次实测**；带探针的结果完全相同）：首页实时 DOM 各采样点基本不变，约 2,420 个元素，但 CDP `Nodes` 会随缓存中的页面大幅波动。脚本每次构建页面时会在闭包中保留一组回滚记录（`moves`、`modifications`、`createdNodes`，`eh-twitter-style_user.js:5108–5113`），每组约 560 条并持有原始 DOM 节点；同时存活的页面是当前页加最多 3 个挂起页（`MAX_SUSPENDED_SPA_PAGES = 3`，`eh-twitter-style_user.js:24357`），因此 Nodes 取决于缓存中的页面，但有上限。

同一会话把同一段 100 步操作连续重放三遍，每遍在第 10、40、80 步回首页，等待 32 秒并 GC 后采样：

| 采样点 | 第 1 遍 | 第 2 遍 | 第 3 遍 |
|---|---:|---:|---:|
| 第 10 步 Nodes | 9,145 | 18,046 | 18,046 |
| 第 40 步 Nodes | 9,931 | 9,945 | 9,945 |
| 第 80 步 Nodes | 13,717 | 13,717 | 13,717 |
| 第 80 步 JSEventListeners | 852 | 852 | 852 |
| 第 40 步 heap MB | 4.60 | 4.78 | 4.83 |

旧的单次三遍观测显示第1遍受空缓存影响，heap 每遍约增加0.05–0.1 MB；本轮修复前三次 full 的 A samples 另列上表。A 的 Nodes 断言比较 pass 2、3 差异≤5%；listener、observers 与 intervals 均精确比较。A heap pass 2→3 限值按三次 full 最大正增量×2标定为653,176 B。阈值不随本次修复重新标定。

## 耗时与结果

- **修复前 quick 基线**（`EHTW_SEED=1`，desktop light + iPhone + desktop dark，共146项）：墙钟 8分17秒（约8.3分钟）；普通通过106、knownIssue expected-fail 40，unexpected=0。
- **修复前 full 基线 202：**duration 7,384,669 ms（约2小时03分05秒），146项；正常通过110、knownIssue expected-fail 36、unexpected=0。
- **修复前 full 基线 303：**duration 7,372,982 ms（约2小时02分53秒），146项；正常通过110、knownIssue expected-fail 36、unexpected=0。
- **修复前 full 基线 101：**duration 7,313,923 ms（约2小时01分54秒），146项；正常通过110、knownIssue expected-fail 36、unexpected=0。
- **修复后 quick：**`EHTW_SEED=1 npm run test:stability:quick` 7分06秒，154/154 通过，unexpected=0、S1–S8 expected-fail=0。154 项包含本次新增的混合 Back/Forward 与点击 F6/F7 回归。
- **修复后 S1–S8 的 full seed 202（版本 1.17.229）：**duration 8,019,552 ms（2小时13分40秒），154/154 passed，unexpected=0、flaky=0。跑完后先保存并核验 `work/test-runs/stability-calibration/postfix-results-seed202.json`，没有覆盖修复前三份 calibration 文件。任务17后续在 1.17.230 修复了旧的 uploader 提示和 WebKit Back scroll 问题，并按要求重跑了 `npm test`、static 和 quick；没有重标阈值。
- **默认离线套件：**`npm test` 2,469 passed、122 skipped、16 failed。11 个项目重复失败在同一“已排除上传者”提示断言；用 1.17.228 备份复跑仍失败。另有 5 个 WebKit 失败（302 路由响应、Back fallback scroll、middle-click）；用 1.17.228 备份复跑也相同失败。失败涉及的断言均未放宽或改写。
- **静态套件：**`npm run test:static` 通过，13 个确定性回归套件均通过，发布元数据显示 1.17.230。
- **A soak heap pass 2→3（desktop light 与 iPhone、EH 与 EX 四个项目/origin）：**

| 项目/origin | 修复前 seed 202 | 修复后 seed 202 | 变化 |
|---|---:|---:|---:|
| desktop light / EH | 253,752 B | 215,520 B | −38,232 B |
| desktop light / EX | −50,524 B | 123,872 B | +174,396 B |
| iPhone / EH | 149,108 B | 35,636 B | −113,472 B |
| iPhone / EX | 125,356 B | 240,428 B | +115,072 B |

  修复后四项均在现有 653,176 B pass-delta 阈值内，方向混合且只有一次修复后 full。对 S1/S2 是否完全消除了慢速 heap 增长，**证据不足**；B2b 定向用例已确认 reader cleanup 后新建 watchdog timeout 排空，B1/B3/A listener delta 严格为零。
- **Annotation 单次观测：**`D-reader-image-dom-observation` 六个 EH/EX × keyboard/wheel/click 组合均为每轮 45 个 image DOM，最大 45；`J-viewport-counter-growth` resize/theme 的 `maxCounterGrowth` 均为 0。两项只有这一次完整样本，`readerImages` 与 `viewportCounterGrowth` 继续保持 PROVISIONAL。
- 修复前三次 full 结果分别保留在 `work/test-runs/stability-calibration/results-seed202.json`、`results-seed303.json`、`results-seed101.json`；各 146 项、约 2 小时。修复后 seed202 full 已单独归档为 postfix 文件，各 154 项。
- 阈值标定：按 prompts/14 用三份备份的最大观测值×2；heap slope下限20 KiB/step。nodes、listeners、observers、intervals、heap、soak heap delta、C inflight和正常 storage 阈值已定稿；reader image DOM和viewport counter growth仍PROVISIONAL，原因见阈值表。
- postfix 报告复制并核验 154 项、duration 8,019,552 ms、unexpected=0 后，没有再运行 Playwright。`stability-report/results.json` 与 `postfix-results-seed202.json` 对应最终修复后 full；修复前三份报告以 `results-seed{202,303,101}.json` 为准。
- 静态语法检查：本轮修改的稳定性测试模块均通过 `node --check`。

### 本轮测试侧修正与执行阻塞

- A soak：RegExp 路由等待增加 URL 与 SPA 状态就绪检查后，EH/EX favorites 最小复现通过。A 完整 quick/full 不再有菜单遮挡、缩略图不存在或路由 class 等待失败；1.17.230 所有 listener 增量均须严格为零。
- D wheel：失败页上的图片边缘点击没有触发重试；测试改为点击页面显示的 `.ehtw-reader-retry-button`，保留请求增量断言。quick 全套和 full seed 101 的 D keyboard/wheel/click 用例通过。
- E chaos：full seed 101 的 4 个 E 用例在 `settle()` 的 RAF evaluate 期间遇到 document navigation，Execution context 被销毁。测试现在捕获该导航竞态，等待新文档 `domcontentloaded` 后重试 settle；desktop/iPhone 的 quick 子集 4/4 通过。
- H visibility：full seed 101 的 4 个 H 用例初始 observer target 为 25，统计 loader 延迟完成后按设计在 `eh-twitter-style_user.js:20768` 对 tweet 调用 `unobserve()`，变为 24。测试先等待 mock `/g/` 统计请求静默 3.5 秒，再取稳定 baseline；100 次切换的 full 子集 4/4 通过，原精确比较不变。
- I 组 idle 请求：seed 101 的 60 秒 idle 用例均通过，未触发零新请求断言；旧诊断里的 `/g/4999/...` 与 stats pump 队列相符，但触发的具体时间点仍未由日志定位，结论保留为证据未定。
- 上述历史发现是测试等待/采样侧问题；本轮另按用户确认的 S1–S8 范围修改脚本并保留严格回归。

## 问题状态（1.17.232）

| ID | 问题 | 严重程度 |
|---|---|---|
| S1 | reader watchdog 暂时保留 detached DOM | 已修复并定向验证 |
| S2 | 恢复挂起列表时 error listener 累积 | 已修复并定向验证 |
| S3 | 连续点击时最后目标不胜出 | 已修复；最后目标胜出，单次历史项，Back 回发起页 |
| S4 | 重复注入重复注册启动 listener | 已修复并定向验证 |
| S5 | 失败图点击翻页、重试图标单独重试 | 行为已更新并覆盖桌面/iPhone、滚动/点击模式 |
| S6 | 返回稳定失败页时不自动重试 | 已修复并定向验证 |
| S7 | 一次加载失败消耗两次自动重试额度 | 已修复；竞态用例严格要求 3 次请求 |
| S8 | 预载窗口图像释放后可能重复请求 | 已修复；滚动与键盘用例严格要求每页至多一个 200 |


### S1 阅读器 watchdog 造成的暂时 DOM 滞留（单次独立实测）

- **现象：**不注入探针，40 次 detail → reader → Back 在 3.3 秒内完成后停止操作。t+0 为 Nodes 9216、JSEventListeners 1241；t+15s 为 9211、1241；t+30s 为 1293、149。另一次分批实验每批后等 32 秒，总轮数 10 / 30 / 70 / 110 时 Nodes 均为 1293、JSEventListeners 均为 149。heap 从 4.68 增至 4.87 MB，约 2 KB/轮，原因未定。以上均为单次实测；说明 S1 是最长约 30 秒的暂时滞留，不是永久累积。
- **复现命令：**用户提供、未复制进项目的诊断脚本，`DIAG=/tmp/claude-0/-workspace-Users-bq-Documents-------/f8acff5d-dd24-44df-a826-126bd0b7ddcf/scratchpad/diag`：`node "$DIAG/transient.mjs" "$PWD" 30000`、`node "$DIAG/residual.mjs" "$PWD"`。项目内的即时窗口回归为 `EHTW_SEED=1 EHTW_STABILITY=quick npx playwright test --config=playwright.stability.config.mjs --project=desktop-1440-light --grep "B2b reader watchdog"`；稳定态 B2 为同命令改 grep 为 `B2 detail`。
- **最小复现步骤：**打开 detail，循环点击 reader 并 Back 40 次；停止操作，GC 后在 t+0、15 秒、30 秒采样。分批实验则每批完成后等待 32 秒再采样。测试工具句柄影响用 `node "$DIAG/nohandle.mjs" "$PWD"` 对照；堆快照剪枝分析用 `node "$DIAG/prune.mjs" snapshot.heapsnapshot`。
- **原因（确定）：**`armImageLoadWatchdog()` 在 `eh-twitter-style_user.js:2987–2997` 为图片设置 30 秒 `setTimeout`（常量在 705 行）。闭包经 `image` 及所在 scope 的 `readerPageImages` 留住 detached reader DOM。堆剪枝实验切断 DOMTimerCoordinator 后，强可达 detached DOM 从 2570 降至 109；166 个 DOMTimer 中 165 个来自这处 watchdog。`publishSpaPageCleanup()`（4911 行起）会断开 observers、清除 wheel/history timer、移除监听器并清理 `src`，但没有调用 `clearImageLoadWatchdog`。定时器到期后回调因 `image.complete` 直接返回；实验期间没有新请求或 pageError。去掉未释放的元素句柄后斜率仍近似相同：每 10 轮 Nodes +2030，对照 +2050，排除测试工具句柄是主因。
- **严重程度：低到中。**短时间频繁进出阅读器会抬高内存峰值，约 30 秒内回落。
- **修复：**reader cleanup 现在从每个图片 listener 记录调用 `clearImageLoadWatchdog()`，清掉 30 秒 timer。位置：`eh-twitter-style_user.js:4917–4918`。
- **验证：**`EHTW_SEED=1 EHTW_STABILITY=quick ... --grep "B2b reader cleanup clears detached image watchdog timers"`，desktop light EH/EX 2/2 通过。B2b 严格检查 cleanup 后新增 timeout 均已排空，且总活跃 timeout 不高于基线；S1 标记已移除。B2 仍等待 watchdog 窗口后比较稳定态。

### S2 恢复挂起列表时 stylesheet error listener 增长（单次独立实测）

- **现象：**不注入探针，list → detail → Back 分批后等待 32 秒：20 轮 JSEventListeners 为 395，60 轮为 435，即同一挂起列表页持续留在缓存期间，每次恢复净增一个 error listener；Nodes 恒为 5506。A 的 seed 101 复现显示，`forward-back` 后该计数会回落，说明离开缓存的页面相关 listener 不一定一直计入。计数回落与 `evictSuspendedSpaPage()` 淘汰记录并在 GC 后释放 detached LINK 相符，但对象级因果未直接确认。数据为单次实测。
- **复现命令：**`node "$DIAG/residual.mjs" "$PWD"`；项目内回归：`EHTW_SEED=1 EHTW_STABILITY=quick npx playwright test --config=playwright.stability.config.mjs --project=desktop-1440-light --grep "B1 list"`。
- **最小复现步骤：**打开列表，进入 gallery，再 Back 恢复挂起列表；重复循环后等待 32 秒再采样，避免将 S1 的暂时滞留误判为 S2。
- **原因（确定）：**`resumeSuspendedSpaPage()` 在 `eh-twitter-style_user.js:24606–24612` 对同一 stylesheet `LINK` 添加 `{once:true}` 的 `load` 和 `error` listener。成功加载会触发并移除 load listener，但 error listener 未触发且未被移除；每次恢复又增加一个闭包。独立栈追踪确认增量来自此处。
- **严重程度：低。**同一挂起页持续保留在缓存中时，恢复操作会累积小型 error listener；页面离开缓存后计数可能回落，是否还有其它强引用未确认。
- **修复：**stylesheet LINK 的等待改用单一 `finish()`，在 `load`、`error` 或 800ms 超时任一发生后移除另外两个 listener 并清 timer。位置：`eh-twitter-style_user.js:24613–24622` 的 `resumeSuspendedSpaPage()`。
- **验证：**B1 list 定向 quick（desktop light EH/EX）2/2 通过；B1/B3、A 现在保留严格资源比较，S2 matcher 已移除。


### S7 一次加载失败消耗两次自动重试额度（单次实测）

- **现象：**16 次打开失败的第 9 页中，3 次出现竞态（**单次实测**）。通常时间线是 `31:error → 31:800ms 定时器 → 834:重试 → 835:error → 835:1800ms 定时器 → 2638:重试 → 2640:error`，累计 3 个请求、2 次重试；竞态时间线是 `16:800ms 定时器 → 29:error → 29:1800ms 定时器 → 1831:重试 → 1832:error`，累计 2 个请求、只重试 1 次。
- **复现命令：**`EHTW_SEED=1 EHTW_STABILITY=quick npx playwright test --config=playwright.stability.config.mjs --grep "S7 one load failure consumes one automatic retry"`。覆盖 EH、EX 和桌面/iPhone 项目。
- **最小复现步骤：**对第 9 页持续返回失败；测试专用 `preInitScript` 覆写 `HTMLImageElement.prototype.complete`，使第 9 页图片第一次 `error` 事件前读取到 `true`，收到该图片第一次 `error` 后恢复原 getter。绑定时因此必定进入“已 complete 且 naturalWidth 为 0”的失败分支，稍后再接收真实错误事件。这是对已观测竞态（3/16）的确定性模拟。
- **原因（确定）：**绑定监听器时，图片已经 `complete && naturalWidth === 0`，约 `eh-twitter-style_user.js:3000–3008` 将其标为 failed，约 `3285` 调用 `scheduleAutomaticRetry()` 并设置 800ms 定时器、增加一次计数；稍后浏览器派发同一次加载的 `error`，`onImageError()`（`3147` 起）又调用一次 `scheduleAutomaticRetry()`，取消前一个定时器并改成 1800ms、再次消耗额度。一次加载失败占用两次重试额度。
- **严重程度：低。**仅在图片错误事件与绑定时 complete 状态形成该竞态时，自动重试次数少一次。
- **修复：**`onImageError()` 若同一图像的自动重试 timer 已在等待，则忽略稍后到达的重复 error，避免一张失败图消耗两份额度；位置：`eh-twitter-style_user.js:3164–3168`。
- **验证：**S7 桌面 light EH/EX quick 2/2 通过，竞态请求数严格为初始请求加两次自动重试（3 次）；S6 也改为严格要求初始失败共 3 次请求。

### S8 预载图片可能再次请求（单次实测）

- **修复前现象：**无故障注入、`slowImagesMs: 400`，从第 1 页读到第 30 页：滚动模式加载 41 页，其中 29 页至少有两次下载；键盘翻页模式加载 41 页，其中 22 页至少有两次下载，第 9–11 页各 3 次（均为**单次实测**）。稳定性项目启用 Playwright 路由拦截，因此 HTTP 缓存不生效；这里“下载 2 次”不等于真实站点一定重复走网络，真实站点第二次可能命中缓存。
- **复现命令：**`EHTW_SEED=1 EHTW_STABILITY=quick npx playwright test --config=playwright.stability.config.mjs --grep "S8 preloaded images are not downloaded twice"`。仅 EH，滚动与键盘模式各一用例，桌面/iPhone 都运行。
- **最小复现步骤：**不注入故障，设置 `slowImagesMs: 400`；从第 1 页开始，滚动模式保持默认，键盘模式切换到键盘翻页模式；逐页读到第 20 页，等待 `/h/` 请求静止，统计每页 HTTP 200 响应数，严格断言不超过 1。
- **原因（修复前已查明）：**滚动模式的视口距离阈值会释放仍在索引预载窗口内的图像。键盘模式另有队列行为：活动窗口完成后会继续启动窗口外已发现的整批图片，加载后再释放；随后用户到达时同页再次请求。初次测试中释放时 `centerIndex=0`，第 7 页及后续页被排空后释放，证实重复不是浏览器偶发或真实站点缓存因素。
- **状态与限制：**修复后 mock 滚动与键盘模式均无重复 200；本任务只进行离线验证，真实站点未测。
- **修复：**释放判断只按预载半径保留窗口内已完成图片；预载队列不再排空窗口外图片，只从当前窗口启动请求。非当前页的自动重试也先占同一并发槽；已取消的图片请求收到 browser error/abort 后再释放槽位。位置：`releaseReaderImagesOutsideWindow()` 第 2595 行、`pumpReaderImagePreloadQueue()` 第 4033 行、retry 调度约第 3072 行。
- **验证：**桌面 light S8 滚动与键盘 quick 2/2 通过，断言每页 HTTP 200 响应数不超过 1。该验证为 mock 结果；未访问真实站点。
- **D 第 7 页断言：**现在分别要求故障注入恰有一个 503、至少一个 200，且最终图片已加载且未失败；重复成功响应由 S8 覆盖。

### 方法教训

线性增长不等于永久泄漏；比较前必须排除定时器和请求的超时窗口。复现本判断时，做完一批 reader 往返后停止操作，GC 后立即及 t+15s、t+30s 采样；再用每批等待 32 秒的分批实验看计数是否回到固定平台。S1 的前 15 秒数据仍处在暂时滞留窗口，不能拿来做永久增长斜率。用 `nohandle.mjs` 比较释放与不释放 ElementHandle 的结果，排除测试工具句柄是主因。

比较资源前要固定采样页面，并扣除按需填充菜单、无限列表加载等正常增长造成的节点变化。

**句柄与其他组：**稳定性测试里的 `page.waitForSelector` 已替换为 locator 的 `waitFor`；`open()` 属于 harness，本轮不修改，其每次文档导航的单个内部句柄影响可接受。H 和 J 的资源比较只在列表页，不包含 reader 往返；I 的 reader 用例始终留在当前 reader 页，比较网络、interval、rAF 和 TaskDuration，不比较 reader 退出后的 Nodes/listener，因此不需要额外排除退出窗口。D 的阅读器用例也不以往返间的 CDP Nodes/listener 斜率作断言。

### S3 连续点击最后目标不胜出

- **现象：**desktop2 中程序化连点期望 gid 4998，实际停在首个 gid 5000；该测试断言保留。当前测试分别记录 anchor.click 和真实 `page.mouse` 的目标与最终 URL。
- **复现：**`EHTW_SEED=1 EHTW_STABILITY=quick npx playwright test --config=playwright.stability.config.mjs --project=desktop-1440-light --grep "F1"`。
- **修复：**导航进行时的后续点击会替换待提交目标，并区分 click push 与 Back/Forward pop。原 push 项被替换，不在中间目标留下历史记录；Back/Forward 之后的点击会从已遍历位置 push 新目标。finally 重放时按当前活动 URL 渲染最后输入。
- **位置：**`navigateSpa()` 的进行中输入分支 `eh-twitter-style_user.js:24694–24729`，导航模式锁在 `24751–24752`，finally 重放在第 25145 行。
- **验证：**F1a/F1b 对最终 URL、`#gn` 内容和最终 Back 回发起页作严格断言；F1/F2/F6/F7 quick desktop light EH/EX 共 14 项通过。`navigation-full.spec.mjs` 的第二次点击要求 B 胜出，double-tap 仍严格只增加一条历史记录，定向用例 2/2 通过。测试没有观察到整页 fallback。

### S4 重复注入会重复注册启动监听器

- **现象：**单次/双次注入的旧测量差异：window `pageshow` +2，`beforeunload` / `popstate` / `pagehide` / `scroll` 各 +1；document `click` / `touchstart` / `submit` 各 +1；element `click` +1。
- **复现：**`EHTW_SEED=1 EHTW_STABILITY=quick npx playwright test --config=playwright.stability.config.mjs --project=desktop-1440-light --grep "H duplicate injection"`。
- **修复：**在 IIFE 一开始设置独立的重复注入 guard，任何启动 listener 注册之前执行；第一次注入仍在 document-start 同步注册，之后重复执行立即返回。位置：`eh-twitter-style_user.js:15–18`。
- **验证：**H duplicate injection quick desktop light EH/EX 2/2 通过，listener 类型差值严格为零，单次点击只命中一次路由。S4 expected-fail 标记已移除。

### 失败图片的翻页与重试

- **行为：**失败图不再拦截图片点击；点击图片左/右区域与普通图片一样翻页。只有 `aria-label="重新加载图片"` 的 `.ehtw-reader-retry-button` 手动重试，按钮 handler 阻止冒泡，因此不会同时翻页。失败状态提示更新为“点击重试图标重试”。
- **位置：**`eh-twitter-style_user.js` 的 `onImageClick()` 第 3211 行、重试按钮 handler 第 3200 行、底部提示第 3742–3743 行。
- **验证：**E2E 覆盖滚动/点击模式重试按钮、点击失败图左右区域、桌面/iPhone；定向 8/8 通过。重试按钮只增加图片请求且不改变页码；左右区分别翻到相邻页且第 7 页没有新增请求。D 稳定性路径现在通过重试图标重试。

### S6 返回耗尽重试的失败页不会自动重试

- **现象：**（修复前）当第 9 页自动重试用尽并稳定显示 failed 状态后，滑块离开到第 5 页再返回，仍留在序列中的图像不会发起新请求。
- **复现命令：**`EHTW_SEED=1 EHTW_STABILITY=quick npx playwright test --config=playwright.stability.config.mjs --project=desktop-1440-light --grep "S6 returning to an exhausted failed page retries automatically"`。该用例也会在 iPhone 项目运行。
- **最小复现步骤：**让第 9 页图片持续失败；严格确认首次失败累计请求数为初始请求加两次自动重试（3 次），再确认 failed 标记、loading 类消失、请求和 DOM 状态稳定达最大自动重试延迟加 500 ms；用滑块到第 5 页，再滑回第 9 页并观察 10 秒内是否发出新请求。
- **原因（确定）：**`onImageError()` 在 `scheduleAutomaticRetry()` 返回 false 后保留 failed 标记；重进仍在 DOM 的页时只更新显示，没有重置计数或请求。
- **严重程度：中。**图床临时故障后，使用点击/触屏的用户离开再回到该页，仍会看到失败图，需要手动点击重试。
- **修复：**reader 维护已访问页码。`updatePageCounter()` 只有在用户之前显示过该页、离开后再次进入时，才对仍 failed 的图像重置 `autoRetryAttempts` 并发起一次请求；后台预载失败图像的首次到达不算重入。retry URL 会回退到 memory/deferred source。位置：`eh-twitter-style_user.js:2460–2483`、`3072` 行。
- **验证：**S6 quick desktop light EH/EX 2/2 通过；严格要求首次失败为 3 次请求，重入后在 10 秒内出现新请求。S6 标记已移除。

### 仍待诊断

I 组旧实测显示 idle 期间新增 `/g/4999/...` 请求。它与 stats loader 的近视区 IntersectionObserver/pump 队列相符：`REQUEST_GAP=1500`（`eh-twitter-style_user.js:20450–20456`），pump 在每次 `loadOne()` 后等待该间隔（20874、20916），observer 在近视区入队（20944–20968）。这不是周期刷新定时器的证据。seed 101 full 的首页、详情、reader 60 秒 idle 用例在 EH/EX × desktop/iPhone 均通过，未触发零新请求断言；旧的 `/g/4999/...` 具体触发时间仍无法由日志确定，证据未定。

C 中 mock 画廊列表通过 `next=` 参数分页（`tests/mock-site/site.mjs:176`），测试等待条件已对应修正；quick 与 full seed 101 的 C 用例均运行通过。B2 的稳定态窗口排除和 B2b 的 watchdog 清理断言已在浏览器实测。

历史辅助修正仍有效：E 只对已由 `navigation-full.spec.mjs:263–315` 覆盖的响应错配注入故障；C 在 5 秒静置前先等待 fetch/XHR 与图片队列连续 3 秒安静；F4 每轮先确保回到列表；G 的 1 MiB 预置先验证 EH/EX origin，成功写入后才写 `window.name` marker；A 增加无 reader 的 list/detail/Back listener 对照序列。toplist URL 的实际 class 是 `ehtw-list`，A 的路由预期已对应更新；harness `waitForRoute` 的稳定渲染条件不要求 tweet 卡片。以上修改均已进入本轮浏览器运行。

D 中的 5 是脚本 `READER_IMAGE_PREFETCH_CONCURRENCY` 队列容量（声明在 `eh-twitter-style_user.js:706`，只用于 `pumpReaderImagePreloadQueue` 的容量计算 4084–4104），不是所有 `/h/` 网络请求的总上限：当前页直接加载和用户翻页触发的直接图像加载不属于 `activeReaderImageQueueLoads`。Node 端记录所有 `/h/` 峰值和非目标页 inflight 候选预载峰值；reader 用例在每次翻页前记录目标 gid/page，`requestfinished` 和 `requestfailed` 都会从 inflight map 扣除。quick 和 full seed 101 的 reader 用例均已在 Chromium 浏览器执行；full 单次观测最高 `/h/` inflight 为 10，低于临时界限 12。

S1–S8 的 expected-fail 包装与过期 matcher 已移除，相关回归保留严格断言。`knownIssue()` 仅作为 probe 分类 helper 自测保留，不再包装 S1–S8 用例。

## WebKit

稳定性配置没有 WebKit 项目，WebKit 下的浏览器行为和 CDP 资源指标均未测；因此没有将任何稳定性断言标成 WebKit skip。CDP 快照目前在非 Chromium 上返回 `null`，若未来在 WebKit 项目运行，依赖 CDP 的断言需显式标注不适用。
