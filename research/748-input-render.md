# #748 输入卡顿时客户端渲染在做什么：面板打开下的输入延迟测量与渲染热点

> 落盘日期：2026-09-26。效力规则见 CONTEXT.md：今天的内容是当前生效的基线，未来有新定版以未来版本为准。
> 纪律：只读代码与文档，没有改生产代码。凡是写了毫秒数的地方都注明是历史面板打开数字还是本次输入延迟实测；本次没有跑出输入延迟数字的地方如实写没量到，不猜。
> 用词：只用 CONTEXT.md 已有词与本票正文已有词（面板、状态栏胶囊、列表行、地图行、标签折叠、布局零抖动、量改交替、重排风暴、测量相、变更相、工作区共享数据、会话私有状态、面板快照）。新东西用完整一句话说清，不造简称。

## 先说结论（给第一次读的人）

1. 对话框里打字到字出现在屏幕上，插件自己没有在按键这条路上安排任何重渲染。按键只走到 `src/client/kernel/attention-heartbeat.js` 的 `attentionNoteHuman`（记下最近一次有人动过的时间，不发出更新），没有调用 `emit`。面板里自己的评论输入框则相反，每敲一个字就发出一次更新（`src/client/views/IssueDetailComments.js` 的 `onChange` 里 `st.cmtDraft = ev.target.value; emit(st)`）。两处不要混为一谈。
2. 面板打开时最贵的历史数字与输入延迟无关，不能直接当输入延迟用。`docs/adr/20260911-zero-layout-jitter.md` 记录的是面板打开：修复前渲染起点到提交结束 4948 毫秒，其中标签折叠占 4911 毫秒，浏览器长动画帧账本记到强制布局 4824 毫秒；修复后三数分别降到 117 毫秒、81 毫秒、76 毫秒。这些是面板打开的数字，不是打字延迟的数字。
3. 剩下最可疑的三处都在折叠这条路上，按单次同步执行里强制重排次数排序：状态栏胶囊的阶梯机（`src/client/statusbar/capFoldMachine.js` 的 `runCapFold`，每档两次强制重排再加一次放下判断，档数随字数变多）、面板头部折叠（`src/client/panel/Dock.js` 里 `applyHead` 与 `applyTier`，每档一次强制重排，档数随仓库名与时间字数变多）、标签栏折叠（同一文件里 `applyFold`，每收起一个按钮一次强制重排）。三处循环次数都不随票数放大，所以按布局零抖动的第 3 条此前允许不动；但输入时每次提交后都会重跑，仍是输入延迟里布局重算的第一嫌疑。
4. 随票数放大的计算有两处，都不在布局读写里，在纯计算里：地图详情的迷雾判断（`src/client/views/MapDetail.js` 的 `isFog`，每张票都去全表里找阻塞者，票多时接近票数乘以票数）与状态栏每次渲染的多遍全表扫描（`src/client/statusbar/checksums.js` 的 `checksumsOf` 一次调起 `occCount`、`frontierCount`、`bugCount`、`triageCount`，每遍都扫一遍未关闭票）。单次耗时都没量到，位置与复现方式见第 2 章。
5. 三种状态的输入延迟对照表目前是空表，没量到。可跑的计时方案与复现步骤见第 1 章；按那套步骤在同一台电脑跑完即可填表。渲染占多少、布局重算占多少同样没量到，量法见第 1 章第 4 节。

## 1. 测量回路

### 1.1 三种状态对照（票面要的三种状态）

同一台电脑、同一个会话、同一段字（例如 20 个汉字，一字一停顿匀速打），分别在三种状态下各打 3 遍，记每次从按键到字出现在屏幕上的毫秒数：

- 状态一：右侧面板打开，并且显示本插件的面板。
- 状态二：右侧面板打开，但是显示别的面板（本插件的面板不在当前页）。
- 状态三：右侧面板完全关闭。

只记输入延迟，不记面板打开速度。每次打字前等面板数据稳定（面板头部时间标签不再变化、没有转圈），避免把取数等待算进打字延迟。

对照表（没量到，先空着，跑完第 1.4 节填）：

| 状态 | 第 1 遍 | 第 2 遍 | 第 3 遍 | 中位 |
| --- | --- | --- | --- | --- |
| 右侧面板打开并显示本插件面板 | 没量到 | 没量到 | 没量到 | 没量到 |
| 右侧面板打开但显示别的面板 | 没量到 | 没量到 | 没量到 | 没量到 |
| 右侧面板完全关闭 | 没量到 | 没量到 | 没量到 | 没量到 |

本地数字只看倍数关系（打开本插件面板是不是明显慢于另外两种），不当真机数字用。

### 1.2 输入按键到上屏经过的客户端文件（静态列出）

对话框输入框本身是宿主画的，不在本仓库。本插件与这次打字有关的只有两条挂载路，都在 `src/client/panelAssembly.js` 里注册：

- 输入区那条：`conversation.input.dock` 槽位注册 `StatusBar`（`src/client/statusbar/StatusBar.js`）。它与对话框住在同一列，宽度随对话框共用同一套卡片宽度算法（`dswsStatusDockGeom`，注释里写明对照宿主 `dsh-client-ui-conversation/lib/client.js` 第 15757 行）。
- 右侧那条：原生右侧边栏类型注册，内容体是 `DeckSidebarTab`（`src/client/kernel/router.js`），两跳之后挂 `DetailsDock`（`src/client/panel/Dock.js`）。

按键到上屏的静态链路（只读代码得到的先后，不含耗时）：

1. 宿主把按键写进输入框并画出来（宿主代码，不在本仓库，路径没查到）。
2. 浏览器在同一份文档里做布局与绘制。本插件的节点与宿主输入框在同一份文档里，所以本插件若在此时同步读写布局，会与输入框抢同一次布局重算（依据见 `docs/adr/20260911-zero-layout-jitter.md` 第 4 章：插件节点与外壳共享同一份文档，强制重排按整棵文档收钱）。
3. 本插件这边可能被带跑的三条被动路（都是监听，不是按键直接调用）：
   - 文档级按键监听：`src/client/kernel/attention-heartbeat.js` 的 `startAttentionSignals` 给 `document` 加了 `keydown` 监听（捕获），只调 `attentionNoteHuman` 记时间，不发出更新、不读写布局。
   - 尺寸监听：`StatusBar.js` 里胶囊与父容器各一个 `ResizeObserver`（`roFold`、`roParent`），回调都是 `applyFold`；`Dock.js` 里标签栏与头部各一个 `ResizeObserver`；`ListTab.js` 里面板容器与内容区一个 `ResizeObserver`。输入框变高或列宽变化时会响，响了就重跑折叠。
   - 每次提交后重算：`StatusBar.js` 里一条没有依赖数组的 `React.useEffect(function () { applyFold() })`，每次渲染提交后都跑一次 `runCapFold`。
4. 面板侧的渲染树（只在收到更新时重跑，按键本身不发更新，见第 3 章）：`DetailsDock`（`src/client/panel/Dock.js`）→ `ListTab`（`src/client/views/ListTab.js`）或 `MapDetail`（`src/client/views/MapDetail.js`）或 `IssueDetail`；行级是 `listIssueRow`（`src/client/views/ListTabRow.js`）与 `TicketRow`（`src/client/views/TicketRow.js`）；提交阶段的折叠是 `fitAllTags`（`src/client/views/shared/tagsFit.js`）与 `fitMapRows`（`src/client/views/ListTab.js`）。

涉及的客户端文件清单（票面点名的五处加实际链路）：`src/client/index.js`（拼接装配，只负责把各模块拼进同一闭包）、`src/client/panelAssembly.js`（两条挂载路）、`src/client/panel/Dock.js`、`src/client/panel/DockSync.js`、`src/client/panel/headFold.js`、`src/client/statusbar/StatusBar.js`、`src/client/statusbar/Seg.js`、`src/client/statusbar/checksums.js`、`src/client/statusbar/capFold.js`、`src/client/statusbar/capFoldMachine.js`、`src/client/kernel/store-snapshot.js`（`storeOf`、`emit`、`sub`、`useStore`）、`src/client/kernel/router.js`（`panelClock`、`panelNow`、`DeckSidebarTab`）、`src/client/kernel/probe-snapshot.js`（`loadSnapshot`）、`src/client/kernel/probe-auto.js`（`probeNow`、`refreshAll`）、`src/client/kernel/probe-chain.js`（`loadChain`）、`src/client/kernel/attention-heartbeat.js`。

### 1.3 可跑的计时方案（不动生产代码）

全部用浏览器自带能力，在开发者工具控制台里跑，不改仓库代码：

- 取样位置一（按键到上屏）：在控制台给对话框输入框加一对一次性监听。按下键时记 `performance.now()`（记为 `tKey`），下一帧输入框内容变化且浏览器画完后记时间。做法：`keydown` 记 `tKey`；用 `requestAnimationFrame` 嵌两层（与 `DeckSidebarTab` 里两跳同理，保证本次渲染已提交）后再读一次 `performance.now()`（记为 `tPaint`）；延迟 = `tPaint - tKey`。每敲一个字记一对，取中位。
- 取样位置二（长任务归因）：用 `PerformanceObserver('longtask')` 记录打字期间超过 50 毫秒的长任务，看长任务的起止是否落在 `tKey` 与 `tPaint` 之间。长任务的归因只能到任务级，到不了函数级；函数级用取样位置三。
- 取样位置三（插件内部分段）：打开调试开关后读已有测点。`src/client/kernel/router.js` 的 `panelNow` 与 `panelClock`（起点 `t0`、进入渲染 `renderT0`、提交完成 `commitMs`、折叠测量累计 `fitMs`），`src/client/panel/Dock.js` 的进入渲染与提交完成两处，`src/client/views/ListTab.js` 的折叠测量累计，`src/client/panel/DockSync.js` 的收口日志（`render-commit`、`render-paint`、`fit-measure`、`click-to-painted`）。注意这套是面板打开的测点，不是输入延迟的测点；输入延迟需要取样位置一另起一对时间戳。
- 渲染占多少、布局重算占多少的量法：同一遍打字同时记三数——输入延迟（取样位置一）、长任务总时长（取样位置二）、折叠测量累计（取样位置三的 `fitMs` 思路另起一对 `performance.now` 包住 `runCapFold` 与 `fitAllTags`）。渲染占比 = 长任务总时长 / 输入延迟；布局重算占比 = 折叠测量累计 / 输入延迟。数字没量到，量完填第 1.1 节的表。

### 1.4 复现步骤

1. 同一台电脑，固定窗口大小（建议左右分屏能同时看到对话框与右侧面板），关闭其他占用界面的程序。
2. 进一个有 dozen 级以上票的工作区（行数越多，折叠与扫描越容易显形；具体多少张在记录里写清）。
3. 按第 1.1 节三种状态各打同一段 20 个汉字，一字一停顿，每种状态 3 遍，记下每次的中位延迟。
4. 打字期间开着 `PerformanceObserver('longtask')`，记下长任务条数与总时长。
5. 三种状态跑完再跑一次强制刷新后第一次打开面板（`docs/adr/20260911-zero-layout-jitter.md` 第 5 章的判据），确认面板打开本身是否仍是百毫秒级，排除面板打开与输入延迟互相掺杂。

## 2. 布局零抖动违规排查

判据来自 `docs/adr/20260911-zero-layout-jitter.md` 第 2 章：同一次同步执行里布局只允许被重算一次；测量相只读、不写，变更相只写、不再回头读；循环次数随数据量放大的必须改，次数固定的不动。下面按这个判据逐处过，重点是票面点的四处。

### 2.1 已修好、这次确认仍是分相的两处（历史数字是面板打开的，不是输入延迟）

- 标签折叠 `fitAllTags`（`src/client/views/shared/tagsFit.js`）：三趟分相，第一趟只写（还原显示），第二趟只读（一次读完 `clientWidth`、`offsetWidth`），第三趟只写（按算好的结果隐藏）。历史数字：面板打开时标签折叠从 4911 毫秒降到 81 毫秒（`docs/adr/20260911-zero-layout-jitter.md` 第 1 章）。输入延迟里它单次耗时没量到。调用点：`src/client/views/ListTab.js` 的 `ListTab` 提交阶段（`React.useLayoutEffect`，按内容指纹跳过）与容器尺寸监听。
- 地图行适配 `fitMapRows`（`src/client/views/ListTab.js`）：四趟分相，第一趟只读行宽，第三趟只读标题放不放得下（`scrollWidth <= clientWidth + 1`），其余两趟只写类名。输入延迟里单次耗时没量到。注意它每次提交后都可能跑（指纹只拦内容没变的情况，列宽变化会重跑）。

### 2.2 剩下嫌疑按单次同步执行里强制重排次数排序（都是没量到单次耗时）

1. 状态栏胶囊阶梯机 `runCapFold`（`src/client/statusbar/capFoldMachine.js`，判据在 `src/client/statusbar/capFold.js` 的 `capFoldLadderOf` 与 `capFoldStateAt`）。写法：每一档先去折叠类、强制重排一次（`void cap.offsetWidth`），写完每段文字再强制重排一次；放下判断 `capFoldFits` 里还要把每段行内 `flex` 改成不收缩、强制重排、读 `scrollWidth <= clientWidth + 1`、再写回去。档数 = 各段字数之和（品牌段按字逐个收，其余七段按整段收，时间串按字收），通常几十档。循环次数不随票数放大（只随九段字长），所以按纪律此前允许不动；但它是每次提交后都跑（`StatusBar.js` 里那条无依赖副作用）加两个 `ResizeObserver`，是输入时最容易被带跑的一处。复现：窄窗口下来回打字，看 `cap.dataset.foldTier` 是否频繁变化。
2. 面板头部折叠 `applyHead` 与 `applyTier`（`src/client/panel/Dock.js`，阶梯在 `src/client/panel/headFold.js` 的 `headFoldLadderOf` 与 `headFoldStateAt`）。写法：从第 0 档起逐档写（仓库名、刷新字、时间字、图标显隐）再强制重排（`void hd.offsetWidth`），读 `hd.scrollWidth <= hd.clientWidth + 1`，放不下就下一档，直到放下或走完。档数 = 三串字长之和加 3 个图标。循环次数不随票数放大。复现：面板宽度在临界值附近时打字或拖列宽，看 `data-head-tier` 是否逐档跳。
3. 标签栏折叠 `applyFold`（`src/client/panel/Dock.js`，tabs 行那段副作用）。写法：全展开后强制重排一次，按优先级从低到高逐个收起，每收起一个强制重排一次并读 `t.scrollWidth <= t.clientWidth + 1`。循环次数 = 标签按钮个数（个位数），不随票数放大。复现：面板窄到标签放不下时切换标签页。
4. 标签栏宽度测量 `measureContentWidth`（`src/client/index.js`）：只读每个孩子的 `getBoundingClientRect`，一次同步执行里读多次但不写样式，不算量改交替。列在这里是因为容易被误判，实际没违规。

### 2.3 循环随数据量放大的纯计算（不读写布局，但随票数变贵）

- 地图详情迷雾判断 `isFog`（`src/client/views/MapDetail.js`）：每张票都用 `tickets.find` 去全表里找阻塞者，再按阻塞者状态判断；层内排序与 `blockerNames`（`src/client/kernel/probe-chain.js`）同样逐票全表找。票数记为 N 时单次渲染接近 N 乘以 N 次查找。单次耗时没量到。复现：打开一张子票多的地图，对比子票少图的输入延迟。
- 状态栏每次渲染的多遍全表扫描 `checksumsOf`（`src/client/statusbar/checksums.js`）：一次渲染调起 `occCount`、`frontierCount`（内部又调一次 `occCount`）、`bugCount`、`triageCount`，每遍都扫一遍未关闭票；`isOccupied` 对每张票还要建表查阻塞（`src/client/kernel/store-derived.js`）。列表页 `ListTab` 渲染里同类扫描还有 `sortIssues`（全表排序）、`buildColorOf` 思想的逐票收颜色、`mapBlockOf` 加 `applyStandaloneBlocks`。单次耗时都没量到。复现：同一工作区对比票多与票少时的输入延迟。
- 行级渲染量：`ListTab` 把每行都经 `listIssueRow`（`src/client/views/ListTabRow.js`）当场建成节点，没有按行记忆；地图详情内行是 `TicketRow`（`src/client/views/TicketRow.js`，包了 `React.memo`）。所以列表页每次更新重建全部行，地图详情内行在输入相同的情况下可跳过。行数、每行标签数、按钮数都要在测量记录里写清。

## 3. 按键是否触发重渲染

### 3.1 订阅链（静态结论：对话框按键不在链上）

- 更新机制只有一条：`src/client/kernel/store-snapshot.js` 的 `emit(st)` 把 `st.tick` 加一并逐个调 `st.subs` 里的回调；`useStore(sid)`（同一文件）用 `React.useState` 订阅，`tick` 一变就重渲染。`sub(st, f)` 只负责登记与摘掉。
- 发出更新的都是插件自己的事件：取数回包（`probe-snapshot.js` 的 `loadSnapshot`、`probe-chain.js` 的 `loadChain`、`probe-auto.js` 的 `probeNow` 与 `refreshAll`）、探测走针（`touchProbeAt` 同组会话逐个 `emit`）、用户在面板里点的筛选与导航（`ListTab.js`、`store-prefs.js` 的 `pushNav`/`popNav`）、面板自己评论框的每个字（`IssueDetailComments.js` 的 `onChange`）、提示条定时清除（`flash` 与 `scheduleFlashClear`）。
- 对话框按键走的是另一条：`attention-heartbeat.js` 的 `startAttentionSignals` 给 `document` 加了 `keydown`、`pointerdown`、`wheel`、`touchstart` 四个监听，回调都是 `attentionNoteHuman`（只记 `Date.now()`，不调 `emit`，不读写布局）。心跳 `attentionBeat` 有三道门（页面可见、窗口在前台、60 秒内有人动过），门内才发一条 `wf.focus` 上报，不在按键同步路径里。所以静态结论是：对话框每敲一个字不会触发面板重渲染。没查到按键直达 `emit` 的调用链；如有反例，以实测为准。

### 3.2 重渲染入口（按键不进，更新进了会重画哪里）

- 输入区这支：`StatusBar`（`src/client/statusbar/StatusBar.js`）经 `useStore(sid)` 订阅当前会话；任何一次 `emit` 都重跑整个胶囊（含 `checksumsOf` 的多遍扫描与提交后的 `applyFold`）。
- 面板这支：`DetailsDock`（`src/client/panel/Dock.js`）同样经 `useStore(sid)` 订阅；任何一次 `emit` 都重跑头部、标签栏、当前页（列表/地图详情/检查/技能页）。
- 行级：列表行无记忆，每次列表重渲染全部重建；地图详情内 `TicketRow` 有 `React.memo`，输入相同时可跳过。
- 定时触发的活：`probe-auto.js` 的 `startAutoProbe`（60 秒一拍的兜底探测，页签藏起时不发）、`startActiveProbeLoop`（活跃工作区节拍）、`attention-heartbeat.js` 的 `startAttentionHeartbeat`（20 秒本地心跳，三道门内才上报）。三条都不在按键同步路径里，但会与打字在时间上交叠；打字时若正好撞上它们，输入延迟里会混入一次更新。复现时在记录里注明是否撞上（看日志里 `host.call` 的 `wf.probe` 与 `wf.focus` 时间戳）。

### 3.3 单次耗时（没量到，给量法）

- 单次重渲染耗时没量到。量法：用 React 开发者工具的性能记录（Profiler）在打字期间录 10 秒，看 `StatusBar` 与 `DetailsDock` 各提交几次、每次几毫秒；或在控制台给 `emit` 包一层 `performance.now`（只包 timing，不改生产代码），记每次 `emit` 到提交结束的间隔。
- 是否和输入字数成正比：静态看不成正比。`emit` 与字数无关；`runCapFold` 的档数随胶囊九段字长（与对话框字数无关）；`fitAllTags` 与 `fitMapRows` 随行数与标签数（与对话框字数无关）。如果实测出正比关系，说明另有链路把对话框内容同步进了面板状态，需要另起一票查那条同步链，本票没查到这条链。

## 4. 没查到与没量到（诚实清单）

- 三种状态的输入延迟数字：没量到（表在第 1.1 节，方案在第 1.3 节）。
- 渲染占多少、布局重算占多少：没量到（量法在第 1.3 节）。
- `runCapFold`、`applyHead`、`applyFold`、`fitAllTags`、`fitMapRows` 在输入时的单次耗时：没量到。
- 地图详情 `isFog` 与状态栏 `checksumsOf` 在大工作区下的单次耗时：没量到。
- 宿主输入框内部从按键到上屏的耗时拆解：宿主代码不在本仓库，没查到。
- 定时任务与缓存改动：本次只读代码，没有动定时任务与缓存，不涉及先跑通 `tests/verify-log-*`。

## 引用来源

- 票面：`gh issue view 748 --json title,body`（三种状态、布局零抖动四处、按键重渲染三问）。
- 用词：`CONTEXT.md`（布局零抖动、量改交替、重排风暴、测量相与变更相、工作区共享数据、会话私有状态、面板快照）。
- 纪律与历史数字：`docs/adr/20260911-zero-layout-jitter.md`（4948/4911/4824 与 117/81/76 四组面板打开数字、5.1 秒降到 0.19 秒、只改随数据量放大的两处）。
- 挂载与时钟：`src/client/panelAssembly.js`（`conversation.input.dock` 注册 `StatusBar`、右侧边栏内容体）、`src/client/kernel/router.js`（`panelClock`、`panelNow`、`DeckSidebarTab` 两跳、`openPanel`）。
- 面板与状态栏：`src/client/panel/Dock.js`（`DetailsDock`、`applyFold`、`applyHead`、`applyTier`）、`src/client/panel/DockSync.js`（四行收口日志）、`src/client/panel/headFold.js`（`headFoldLadderOf`、`headFoldStateAt`）、`src/client/statusbar/StatusBar.js`（`dswsStatusDockGeom`、`applyFold`、无依赖副作用、两个 `ResizeObserver`）、`src/client/statusbar/capFold.js`（`capFoldLadderOf`、`capFoldStateAt`）、`src/client/statusbar/capFoldMachine.js`（`runCapFold`、`capFoldFits`、`capFoldRoom`）、`src/client/statusbar/checksums.js`（`checksumsOf`）、`src/client/statusbar/Seg.js`（`seg`、`num`）。
- 列表与地图：`src/client/views/ListTab.js`（`fitMapRows`、`ListTab` 两处 `useLayoutEffect`）、`src/client/views/shared/tagsFit.js`（`fitAllTags` 三趟分相）、`src/client/views/ListTabRow.js`（`listIssueRow`）、`src/client/views/TicketRow.js`（`TicketRow` 的 `React.memo`）、`src/client/views/MapDetail.js`（`isFog`、`byLevel` 排序）、`src/client/views/MapDetailHead.js`、`src/client/views/IssueDetailComments.js`（评论框 `onChange` 的 `emit`）。
- 状态与取数：`src/client/kernel/store-snapshot.js`（`storeOf`、`emit`、`sub`、`useStore`、`hydrateFromCache`）、`src/client/kernel/store-derived.js`（`compute`、`isOccupied`、`occCount`、`frontierCount`、`bugCount`、`triageCount`、`buildColorOf`）、`src/client/kernel/probe-snapshot.js`（`loadSnapshot`）、`src/client/kernel/probe-auto.js`（`probeNow`、`refreshAll`、`startAutoProbe`、`startActiveProbeLoop`）、`src/client/kernel/probe-chain.js`（`loadChain`、`readyCount`、`envTotal`）、`src/client/kernel/attention-heartbeat.js`（`attentionNoteHuman`、`startAttentionSignals`、`attentionBeat`）、`src/client/kernel/api-io.js`（`inject`）、`src/client/index.js`（`measureContentWidth`）。
