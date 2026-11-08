# iPhone Safari 真机检查清单

Chrome CDP 自动化不能替代真实 Safari/WebKit。本清单用于补齐地址栏、触摸、系统返回和 Safari resize 行为。自动化总入口会在每次运行结果目录中生成带 run id 和脚本版本的副本。

## 运行信息

- Run ID：
- Userscript 版本（页面 `data-ehtw-script-version`）：
- iPhone 型号 / iOS / Safari 版本：
- 登录态：已登录 / 未登录
- 结果：PASS / FAIL / BLOCKED

## 页面与布局

- [ ] Front、Watched、Popular、Search、Toplists、Torrents 页面正常；标题、封面、标签和过滤布局可见。
- [ ] 五种缩略图模式分别可用；详情标签、缩略图展开和页码链接正常。
- [ ] My Home、My Tags、My Uploads、Bounties 只读页面布局正常。
- [ ] 390px 或当前 iPhone 视口没有横向溢出、控件重叠或不可点击区域。

## 导航与返回

- [ ] 从列表进入详情后，页面返回键回到来源列表和原滚动位置。
- [ ] 详情缩略图翻页后，Safari 左边缘右滑返回仍回到原列表，不停在上一张缩略图。
- [ ] 连续进行 3 次列表↔详情往返，无意外整页刷新或 `matchyear` 重复声明。

## 阅读页 `/s/`

- [ ] 首张图从屏幕顶边开始，状态栏区域能看到图片；阅读控制条避开时间、刘海和灵动岛区域。
- [ ] 黑底连续滚动、点击翻页、滚轮翻页和触摸滚动正常；图片之间没有缝隙或原站拖拽。
- [ ] 当前页/总页数、缩放、预载数量、上下页预载进度和可拖动进度条正常。
- [ ] 中间页直达、向上/向下预载、加载动画、单页重试和返回位置正常。
- [ ] 调整 Safari 地址栏/工具栏高度或旋转设备，不触发 `ehg_show.c.js update_window_extents` 异常、不跳页。
- [ ] Console 无新的用户脚本异常；原站 `api.e-hentai.org/api.php` CORS 单独记录，不作为阅读器图片错误。

## 证据

- Console 新错误 / 来源：
- Network 失败请求 / 状态：
- 失败操作与页面（gallery token 可遮蔽）：
- 截图或录屏路径：
