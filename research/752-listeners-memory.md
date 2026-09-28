# #752 事件监听与内存：面板打开后监听器观察器尺寸读取是否随输入放大

调查员结论先行（给 #753 收口用）：

1. 有只增不减的监听器：每次打开面板多装 7 个 document/window 监听，关闭不清（位置见第 1 节第 4 条）。这是本次调查唯一确认的泄漏。
2. 每次按键不触发全列表尺寸读取：按键在插件侧只写一个时间戳，不触发重渲染（位置见第 2 节第 1 条）。全列表读取只发生在面板自己重渲染时，读数随票数×标签数增长，但重排次数恒为 1，符合布局零抖动纪律（第 2 节第 2、5 条）。
3. 内存稳态基本持平：同工作区快照内存里只有 1 份对象（多会话共享引用，不拷贝）；长开慢增的都是小对象（看过的票详情、无上限的键表），真正的“越用越卡”更可能来自第 1 条的重复网络上报，而不是内存膨胀（第 3 节）。

调查方法：只读代码，未改生产代码；数字来自源码计数与 `gh` 实测（本仓：票总数 736，开放 36，标签 19，见第 3 节第 1 条）。真机逐字输入的实测数字没查到，需要 #748 的取证回路补。

---

## 1. 监听器与观察器对照：打开前、打开后、关闭后

### 1.1 常驻项（与面板开关无关，插件 apply 时装一次）

| 数量 | 内容 | 代码位置 |
|---|---|---|
| 1 个 setInterval（60 秒） | 兜底探针节拍 `PROBE_MS`，页签隐藏时跳过 | `src/client/kernel/probe-auto.js:15,165-170` |
| 1 个 window focus 监听 | 回前台限流探测 | `src/client/kernel/probe-auto.js:172` |
| 1 个 document visibilitychange 监听 | 切页签回来补探测 | `src/client/kernel/probe-auto.js:175-179` |
| 1 个 setInterval（20 秒） | 本地心跳，只上报“还在看”，不出探测 | `src/client/kernel/attention-heartbeat.js:173` |
| 1 个 setInterval（5 秒/15 秒，宿主说了算） | 只探正在看的工作区那条节拍 | `src/client/kernel/probe-auto.js:189-216` |
| 1 个 window storage 监听 | 跨窗口合并偏好 | `src/client/kernel/store-prefs.js:203` |
| 每个已开会话 2 个 ResizeObserver + 1 个 window resize | 状态栏胶囊折叠（输入区那条，不是面板） | `src/client/statusbar/StatusBar.js:151-152,160`，清理在 162-166 |

上面 `startAutoProbe` 有单例守卫（`if (shared._probeTimer) return`，`probe-auto.js:158`，跨 reload 清旧 timer 在 161-164），心跳也有单例守卫（`if (shared._beatTimer) return`，`attention-heartbeat.js:171`）。这几项打开面板前后都是 1 份，不增生。

注意输入区那条：状态栏住在 `conversation.input.dock` 槽位（`src/client/panelAssembly.js:79-81`），随会话常挂载，不随面板开关。开 5 个会话就是 5 个状态栏实例，即 10 个 ResizeObserver + 5 个 resize 监听。清理函数写了（`StatusBar.js:162-166`），但会话不关就不卸载，等于常驻。

### 1.2 主题订阅：0 个，打开前后都是 0

全仓搜 `matchMedia`、`prefers-color-scheme`、`onTheme`：没查到。主题唯一相关的是 `src/client/kernel/styles.js:86` 里一条 CSS 选择器 `body[data-ds-dark-theme]`，换肤全走样式表，插件侧零 JS 订阅。这一问可以直接结案。

### 1.3 会话切换订阅：Dock 跟 2 个，状态栏跟 1 个，都是宿主的钩子

- 面板（`DetailsDock`）：`props.useSessions(x => x.current)` 取当前会话（`src/client/panel/Dock.js:23`），再取该会话的工作区目录（`:28`），另加 `useStore(sid)` 订阅本会话状态（`:29`）。切会话时副作用按 `[sid]` / `[sid,summaryCwd]` 重跑（`:22` 注释）。
- 状态栏：`props.useSessions(x => byId[sid].cwd)` 1 个（`StatusBar.js:49-51`）+ `useStore(sid)` 1 个（`:48`）。
- 上报侧：面板打开、会话切换、窗口获焦时各调一次 `wf.focus` 跨进程上报“我在看谁”（`attention-heartbeat.js:96-124`），这是网络调用不是常驻监听，不计数。

### 1.4 打开面板新增项（DetailsDock 挂载时）

| 数量 | 内容 | 代码位置 | 关闭后 |
|---|---|---|---|
| 1 个 ResizeObserver | 面板宽 `dw`（窄于 380 折按钮为图标） | `Dock.js:37-45`，清理 `:44` | 收回 |
| 1 个 ResizeObserver + 1 个 window resize | 页签行折叠 | `Dock.js:102,115`，清理 `:117` | 收回 |
| 1 个 ResizeObserver + 1 个 window resize | 头部第一行逐字折叠 | `Dock.js:163,167`，清理 `:169` | 收回 |
| 1 个 ResizeObserver（盯面板+滚动区+全部地图行）+ 1 个 window resize | 列表行宽适配 | `ListTab.js:73-84`，清理 `:89-92` | 收回 |
| 0~1 个 scroll 监听 | 只在“已关闭”筛选或折叠行展开时装 | `ListTabClosed.js:15-33`，清理 `:32` | 收回 |
| 每次打开 +7 个（5 个 document + 2 个 window） | 注意力信号：visibilitychange、pointerdown、keydown、wheel、touchstart、focus、blur | `attention-heartbeat.js:178-197`，由 `router.js:61` 每次打开面板调用 | 不收回（见下） |
| 若干 one-shot | `document.fonts.ready.then`（Dock 两处、ListTab 一处、状态栏一处） | `Dock.js:116,168`、`ListTab.js:87`、`StatusBar.js:161` | 自己结束，非持续监听 |

### 1.5 唯一确认的泄漏：每次打开面板 +7 个监听，关闭不清

`startAttentionSignals`（`attention-heartbeat.js:178-197`）没有“只装一次”守卫（对比同文件心跳的 `if (shared._beatTimer) return`，这里没有），而调用点 `afterPanelOpened`（`router.js:59-81`，第 61 行）每次走 `openPanel` 都跑一次。`stopAttentionSignals`（`:199-203`）只清心跳 timer 并上报一次“不再活跃”，没有 `removeEventListener`。

后果是打开次数 k 的线性积累：开 10 次面板，`focus` 处理器就有 10 份，每次窗口获焦发 10 次 `wf.focus` 跨进程调用（`:192` 经 `reportWorkspaceAttention` 走 `host.call`）；`visibilitychange` 同理。`keydown` 那份只写时间戳（`:187` 的 `human` 即 `attentionNoteHuman`，`:45` 只有一句 `Date.now()` 赋值），k 份也便宜。给 #753 的修法指向：给 `startAttentionSignals` 加单例守卫（与心跳同式），或在 `stopAttentionSignals` 里补 `removeEventListener`。验证方法：打开面板 3 次后切一次前台，数 `wf.focus` 发了几遍（开调试开关看 `host.call` 日志）。

附带一个非泄漏但值得知道的 churn：头部折叠副作用的依赖是 `[名字, 相对时间, 悬停提示, 面板宽]`（`Dock.js:170`），相对时间字符串每分钟一变、面板拖拽时 `dw` 逐像素变，每次都先跑清理再重建观察器。自己收拾自己，不泄漏，但拖拽面板时观察器反复重建。

---

## 2. 尺寸读取：每次按键触发几次，是否随票数标签数放大

### 2.1 每次按键：插件侧 0 次全列表读取

对话框是宿主的输入框，按键冒泡到 document 的 `keydown` 只命中注意力信号里那句记时刻（`attention-heartbeat.js:187`），不调 `emit`，不读任何几何属性，不发网络。插件状态树（`shared` / `stores`）收不到按键事件，所以 `ListTab` 的重渲染链根本不会启动。结论：单次按键触发 0 次面板列表尺寸读取。

一个没查到的边界：状态栏与对话框同住输入区一列，宿主是否在每次按键时重渲染 input dock（从而连带重渲染状态栏、跑一次胶囊折叠）是宿主行为，插件侧无证据。需要 #748 的取证回路或 #751 的归属对照确认。如果宿主逐字重渲染 dock，每次按键的代价也只是胶囊级（第 2.3 条），到不了全列表。

### 2.2 全列表读取只发生在面板重渲染时，读数 ∝ 行数×标签数，重排恒 1 次

两处全列表测量（都在 `ListTab` 每次提交后跑，`ListTab.js:53-66`，但有指纹守卫见下）：

- 标签贪心折叠 `fitAllTags`（`src/client/views/shared/tagsFit.js:18-56`）：第一趟只写（全显示），第二趟只读（每行读 `clientWidth` + `offsetWidth` 各 1 次 + 每个标签读 `offsetWidth` 1 次），第三趟只写。读数 = 2×行数 + 全行标签总数。本仓开放 36 票、标签 19 种、每行 2~3 个标签，估算约 170 次几何读取一趟，但三趟分离只触发 1 次强制重排。
- 地图行横竖排 `fitMapRows`（`ListTab.js:15-47`）：四趟分离（读宽→写类→读放不放得下→写回），读数 = 地图组行数（本仓约 10 行以内）+ 中间档行的 `scrollWidth`。同样 1 次重排。

指纹守卫（`ListTab.js:60-62`）：指纹 = 快照生成时刻|页签|状态筛|标签筛，四项都不变直接返回，一次几何属性都不碰。所以悬停菜单、定时走针等无关 `emit` 引起的重渲染到这里就停了，不读布局。这条守卫是“按键不放大”的第二道闸。

### 2.3 无守卫的每次渲染都跑：状态栏胶囊折叠（小）

`React.useEffect(function () { applyFold() })`（`StatusBar.js:172`）没有依赖数组，每次状态栏提交都跑 `runCapFold`（`capFoldMachine.js:30-80`）：读矩形+内外宽（`164-167`）、每档写字+两次强制重排（`60,67`）。典型第 0 档放得下 = 2 次重排；最窄走满全部档 ≈ 档数×2（档数 = 九段字阶梯，十几档）。触发渲染的 `emit` 来源：悬停菜单开关（`StatusMenus.js:46,69,114` 的 `emit`）、定时走针对同组全员广播（`store-snapshot.js:96-97`）、快照更新。量级是胶囊级（9 段字），与票数无关。

另有一处渲染期逐行字符串组装：`ListTabRow.js:83` 每行渲染都跑一次 `JSON.stringify(标签名数组)` 写 `data-dsws-labels` 属性。功能需要（非日志，不违反日志纪律），但它是每行×每次渲染的成本，随票数×标签数放大。36 行×3 标签是小数字，记一笔供 #753 评估。

### 2.4 观察器回调直调测量（无指纹守卫，小）

`ListTab` 的 ResizeObserver 回调 `doFit`（`ListTab.js:69`）直接调 `fitMapRows`，不经过指纹守卫。面板宽不变时观察器不回调，无事发生；拖拽面板时每次尺寸变化跑一次地图行全量读（行数级，约 10 行）。有界，不随输入放大。

### 2.5 布局零抖动 verdict：结构合规，两处小违反但 N 有界

合规的是上面两处全列表测量（三趟/四趟分离，纪律见 `docs/adr/20260911-zero-layout-jitter.md`）。违反的是：

- 页签行 `applyFold`（`Dock.js:76-101`）：循环里“读溢出→写折叠→读 `offsetWidth`”（`:92-94`）量改交替，每折叠一个页签一次重排。但 N = 页签数（4~5 个），有界。
- 胶囊 `applyTier`（`capFoldMachine.js:57-68`）：每档写→读→写→读，最坏档数×2 次重排，档数十几，有界。

按地图纪律“只对循环次数随数据量放大的地方动手”：随票数放大的只有 `fitAllTags`/`fitMapRows` 的读数（O(行数×标签数）），而它们的重排次数恒为 1。修价值低，#753 可判不修。

---

## 3. 内存与缓存：快照多大、几份、长开曲线

### 3.1 快照份数：同工作区内存里 1 份对象，多会话共享引用

- 内存表 `snapshotByCwd`，上限 20 条、超了丢最久没用（`store-snapshot.js:77-79`），键是工作区根（`:61-72`，子目录会话与根会话同桶）。
- 同组扇出是引用共享不是拷贝：探测命中后主 store 就地更新、其余会话直接赋同一对象（`probe-auto.js:69-91`，`:83` 的 `st2.snapshot = newSnap`）；手动刷新扇出同样（`:253-271`）；水合也是直接赋值（`store-snapshot.js:177`）。旧快照被替换后只剩数字数组的差异（`lastDiff` 存编号数组，`probe-auto.js:75-82`），可被回收。
- 落库前剥传输态标记（`store-snapshot.js:84-86`），内存与磁盘各 1 份；磁盘是 IndexedDB `dsws-cache/snapshots`，上限 24 条（`:100,114-137`），不可用环境静默降级（`:102,140`）。
- 链快照另有一张表 `chainByCwd`，上限 20 条，键 = 工作区+后端+语言（`:154-158`）。

### 3.2 快照大小：精确字节没查到，规模锚点如下

没跑真机 `wf.snapshot` 称重（只读调查），给 #753 留一个称重方法：开调试开关，用 `gh` 记下本仓规模再对比日志里的快照版本。已知锚点（2026-09-26 实测）：

- `gh issue list --state all` 全量 736 票；`gh api repos/...` 开放票计数 38；`gh issue list` 开放 36；`gh label list` 标签 19 种。
- 面板快照装的是开放池 + 地图子票：单票按编号/标题/标签/时间估 300~500 字节，开放 36 票约 15~20KB，地图子票与标签表另加，整份估计几十 KB。
- 由此推上限：内存缓存 20 份 × ~75KB ≈ 1.5MB；磁盘 24 份 ≈ 1.8MB。另构建产物 `client.js` 1.46MB（`package/lib/client.js` 1.46MB，两者同一份源码的双产物，同时只加载一份）。

### 3.3 长时间打开内存曲线推测：flat 为主，慢增项清单

定时器全是单例（探针/心跳/活跃节拍，见 1.1），重建前都 `clearInterval`（`probe-auto.js:193-196`、`attention-heartbeat.js:167-170`），在途去重表请求完就删（`probe-snapshot.js:160`、`probe-chain.js:158`）。不会锯齿上涨。慢增（只增不减）的小对象：

| 增速 | 内容 | 代码位置 | 上限 |
|---|---|---|---|
| 每次打开面板 +7 个函数引用 | 注意力监听器（第 1.5 条），连带每次获焦多发 `wf.focus` | `attention-heartbeat.js:178-197` | 无，k 次打开 = 7k 个 |
| 每看一张票详情 +1 条 | `issueCache` 按票号存全文+评论，TTL 只在读时判 60 秒，无定时清扫 | `api-io.js:48-66,91-92`，清缓存要主动调 `:114-127` | 无，看过的票数 |
| 每到访一个新目录/工作区 +1~2 键 | `workspaceRootByCwd`、`lastProbeAtByCwd`、`selectionByCwd`、`repositoryByCwd`、`_snapLatestByWs`（只 set 不 delete） | `store-snapshot.js:49,89`、`store-prefs.js:233-234,272-273`、`probe-stale.js:37` | 无，桌面场景个位数 |
| 用户每翻一页已关闭 +1 页 | 已关闭票分页数据常驻 store | `issue-pages.js:14,106` 注释“刷新只换快照，页数据不动” | 用户驱动 |
| 不增 | `_tagsFpOf`（WeakMap 以 store 为键）、`labelClicks`（以标签名为键，本仓 ≤19） | `tagsFit.js:17`、`ListTab.js:200-203` | 有界 |

结论：长开内存没有失控项；“越用越卡”如果存在，更可能来自第 1.5 条的重复 `wf.focus` 网络与连带重渲染，而不是堆膨胀。内存称重（真机 1 小时前后堆快照对比）没查到，列入 #753 验证方法。

### 3.4 高频路径性能守卫：合规

- 三处高频测量（`fitAllTags`/`fitMapRows`/`runCapFold`）零日志，一行都不记，组装成本为零。
- 列表计时累加先判开关：`isEnabled('debug') ? panelNow() : 0`（`ListTab.js:58`），关着连时钟都不读。
- 计数器都是百一采样 + 开关：状态栏水合计数（`StatusBar.js:78`）、快照命中（`store-snapshot.js:81`）、去重命中（`probe-stale.js:57`）。
- 面板打开记一行常驻 `panel.open`（`router.js:102`，只记散列与版本号，无原文，低频可接受）。
- 渲染路径 `JSON.stringify` 共 12 处（`grep JSON.stringify src/client`），其中渲染期逐行跑的只有 `ListTabRow.js:83`（功能属性非日志）；其余是 localStorage 持久化与日志序列化，不在输入热路径。没查到“把整个对象转成文本记进日志”的违反。

---

## 4. 没查到的（需兄弟票补）

1. 真机逐字输入延迟毫秒数：需 #748 的测量回路。
2. 快照精确字节数：需真机调一次 `wf.snapshot` 称重（本报告只有按 736 票/36 开放/19 标签的估算）。
3. 宿主 input dock 是否逐字重渲染（决定每次按键有没有胶囊级代价）：需 #748 或 #751 确认。
4. 关闭面板后监听器是否真摘掉（代码有 cleanup，但真机不断言）：验证方法见 1.5 条。

## 5. 给 #753 的清单（按修价值排序）

1. 注意力 7 监听器每次打开都重复装（`attention-heartbeat.js:178-197`，调用点 `router.js:61`）：加单例守卫或补 `removeEventListener`。验证：开面板 3 次→切前台→数 `wf.focus` 遍数。
2. `issueCache` 无淘汰（`api-io.js:91-92`）：加过期清扫或上限。验证：连看 20 张票详情前后堆对比。
3. `ListTabRow.js:83` 逐行 `JSON.stringify`：可评估是否缓存。验证：改前改后渲染耗时倍数。
4. 页签折叠量改交替（`Dock.js:92-94`）、胶囊每档双重排（`capFoldMachine.js:57-68`）：N 有界，建议不修。
5. `fitAllTags`/`fitMapRows` 读数随票数放大但重排恒 1：建议不修。
