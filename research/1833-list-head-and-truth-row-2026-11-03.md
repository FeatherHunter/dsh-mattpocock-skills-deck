# 列表页状态行与列表头部吸顶：为 #1833 分诊做的只读取证

这份调查只做取证，不改业务代码，也不开始修复，目的是把 #1833 里两个界面问题——列表上方那条状态行（div.dsws-truth）和随列表滚走的统计与筛选区——的现状、数据来源、历史约束和可选岔路摆清。行号按任务指定的 main 提交 02e84876 读取；本地 main 在调查期间从 1b8197f0 前进到 9476c783，新增的三个提交只改了 research 下的两份 #1833 笔记，调查涉及的源码文件没有变化（git show --stat 核对）。取证方式是读源码、门禁测试、词表与 ADR，读 #1833 正文以及 #1699、#715、#734、#1446 的票面与交付记录，查 git log、git blame、git show；没有在浏览器里复现，也没有拿到票面截图的原图，凡属推断或需要真机确认的地方都标了「待核实」。

## A. 状态行 div.dsws-truth 现在是什么

### A1. 位置与画法

这一行在列表树里的位置是固定的：在已选标签过滤条、KPI 行、多目录签和筛选行之后，在列表行之前（来源：src/client/views/ListTab.ts:429-436）。它只在 truthNoticeLines 返回非空时渲染（来源：src/client/views/ListTab.ts:433）。容器是一个允许换行的 flex 行，字号 11，句与句之间留 8 像素，红、黄、灰三种语气分别取 #f87171、#f59e0b 和灰色（来源：src/client/views/ListTab.ts:434-435）。截图里那种「只有一句红字、右侧全空」的样子，是这一行只有一条内容时的自然结果，不是单独的组件。

div.dsws-truth 这个类名只出现在 ListTab.ts 这一处，tests 里没有按这个类名或它的页面位置做断言（在 tests 目录检索 dsws-truth 无命中）。因此改它的位置或删掉它，现有门禁不会直接判红；真正会挡住改动的是 truthNoticeLines 与 budgetNoticeLines 的函数级契约（见 A4）。

### A2. 它承载哪些状态句，各由什么驱动

它承载的句子由 truthNoticeLines 一次算出（来源：src/client/views/shared/truthLines.ts:197-247），同一个 key 只保留先出现的一条（:201-204）。按代码顺序是：

- 取数迟迟没回来（truth.pendingLate）：当 snapMode 是 err、有 snapError、且 snapPending 为真时，直接返回这一句，后面的句子都不再出现，黄色（来源：src/client/views/shared/truthLines.ts:210-211）。
- 上次刷新失败三句（红）：snapMode 是 err 且有 snapError 时，若 snapFail.kind 是 quota-exhausted，说 truth.failQuota；否则若刷新处于暂停（refresh.paused 为真，或 refresh.tier 已降档到红档），说 truth.failPaused；再否则说 truth.failRetry（来源：src/client/views/shared/truthLines.ts:207-208、:219-221）。
- 数据可能落后（truth.lag）：refresh.tier 的承诺延迟大于探测间隔时，黄色（来源：src/client/views/shared/truthLines.ts:225-227）。
- 自动刷新已暂停（truth.paused）：refresh.paused 或降档到红档时，黄色；如果上面失败句已经说过，按键去重后不再说（来源：src/client/views/shared/truthLines.ts:208、:231）。
- 有更新已推后（truth.deferred）：refresh.deferred 为真，黄色（来源：src/client/views/shared/truthLines.ts:233）。
- 未在刷新（truth.notRefreshing）：refresh.notRefreshing 为真，灰色（来源：src/client/views/shared/truthLines.ts:234）。
- 上次已知（truth.replayLastKnown）：快照带 diskReplay.lastKnownAtMs 时，黄色，时间取那一刻（来源：src/client/views/shared/truthLines.ts:237-240）。
- 额度读数：最后把 budgetNoticeLines 的结果并进来（来源：src/client/views/shared/truthLines.ts:242-245）。

没有快照时，除了 pendingLate 这一种，整行是空的（来源：src/client/views/shared/truthLines.ts:213）。这些句子的中文和英文词条现在住在 config/copy/pages.yaml:25-50 与 :111-136；src/client/kernel/locale-data.ts 仍保留同名的旧条目（例如 :1884 的 detail.refreshFailed、:1891 的 event.refreshFailed、:1902 的 type.refreshFailed，英文 :2215、:2222、:2233），但按 ADR 20261020-ui-copy-data-driven，现行真源是 YAML，旧文件不是改文案该动的地方。

### A3. 额度句与「健康态常驻」

额度句不是失败时才出现的。GitHub 房间声明自己的额度模型是 two-buckets（来源：src/tracker/rooms/github/room/index.ts:232）；宿主的 budgetState 只有在 GraphQL 与 REST 两个桶都读到数字时才把 readKnown 置真，否则给 readKnown:false 和 reason:'not-measured'（来源：src/refresh/rooms/host/budget-state.ts:114-141）。宿主入口把 budgetReadout 接给快照组装与刷新（来源：src/host/index.ts:229、:233）；快照组装只搬运读数，拿不到就不写 backend，绝不塞 0（来源：src/host/tracker/snapshot.ts:56-66）。

于是健康态下（GitHub、两桶读数已知）这一行至少常驻两句 GraphQL/REST 剩余读数（来源：src/client/views/shared/truthLines.ts:187-195）；读数未知时常驻一句「额度读数还没同步上来」；模型未知时常驻一句「额度未知，这个后端没有可用的预算模型」；只有 budgetKind 是 none 且不离网时才一句额度话都没有（来源：src/client/views/shared/truthLines.ts:175-186）。真正耗尽时（请求额度剩 0，或两桶都已知且都为 0）额度句会被一句红色 failQuota 取代（来源：src/client/views/shared/truthLines.ts:179-184、:187-195）。

这也解释了为什么「这行只在失败时出现」不成立：在 GitHub 后端上，它平时就是额度读数行，失败句只是插在最前面。票面截图只看到一句红字，按代码推断那一刻要么快照里没有 refresh.backend，要么报错态走了 pendingLate 或无快照分支，要么截图裁切、模糊；这一点待核实。

### A4. 与门禁、词表的耦合

改这一行的呈现会碰到函数级契约，但不会碰到页面结构契约。失败句、暂停、落后、延后、pending 在 tests/verify-visible-truth.ts:159-215 里逐条断言；额度句并进 truthNoticeLines 这件事在 tests/verify-1446-panel.ts:232-245 断言；磁盘回放句在 tests/verify-1692-disk-replay-eviction.ts:247-255 断言。它们都直接调用 truthNoticeLines 或 budgetNoticeLines，不查列表页的 div。

词条纪律见 A2：新增或改写句子要同时补 config/copy/pages.yaml 的中文与英文两份，不能只改一份。旧词表 locale-data.ts 里虽然还有同名条目，但按现行 ADR 它不是真源。

## B. 与头部、通知中心的重复关系

### B1. 头部的时间标签与铃铛各表达什么

面板头部第一行从左到右是刷新按钮、通知中心铃铛、时间标签（来源：src/client/panel/Dock.ts:335-347）；页签行在滚动区外（:376）。时间标签画的是「刚刚 / N 分钟前 / N 小时前 / N 天前」这类相对时间，颜色按快照取数时刻的新鲜度取三档，悬停给「上次更新 X，取数时刻 HH:MM」（来源：src/client/views/shared/truthLines.ts:56-63、:95-107、:113-114；阈值 5 分钟黄、30 分钟红，唯一实现在 src/refresh/kernel/host-budget.ts:355-377）。它只回答「这份数据离现在多久」，不回答「上一次刷新成没成」：刚取到数据就变绿，哪怕紧接着的探测失败，标签仍是绿的。

铃铛是通知中心的入口，只在有历史可看时画，未读时带一个数字（来源：src/client/views/shared/notificationCenter.ts:101-143）；浮层用 portal 固定定位挂在 body 上，不占列表高度（:95-99、:145-151）。

### B2. 通知中心的「当前状态」只表达降级

浮层顶部有一行「当前状态」，它只从快照的 fallback 标记派生：只有 snap.fallback 等于 'rest' 才说「数据源降级（走 REST 通道）」，其余一律说「正常」（来源：src/client/views/shared/notificationCenterModel.ts:279-283；src/client/views/shared/notificationCenter.ts:49、:64-67）。这意味着刷新失败但没有走 REST 时，通知中心会一边列着「刷新失败」的历史，一边在顶上写「当前状态：正常」——按代码推断会同屏冲突，待真机截图核实。

### B3. 通知中心记录哪些事件，刷新失败从哪来

通知中心记四类事件：degraded-start、degraded-recovery、refresh-failed、write-failed（来源：src/refresh/kernel/notification-events.ts:29）。历史落盘在 src/refresh/rooms/host/notification-store.ts：快照变化时记降级开始与恢复（:165-187），宿主刷新失败时记 refresh-failed（:189-202，原因截 80 字、同因去重），写工具失败时记 write-failed（:204-219）。

但「刷新失败」这条历史只覆盖宿主刷新这一条路：createSessionRefresh 里的本地函数 noteRefreshFail 在选后端失败和刷新抛错两处调用（来源：src/refresh/rooms/host/session-refresh-schedule.ts:83-85、:120、:403），注释明确说它只记历史、不改刷新语义（:73）。客户端探测失败走的是另一条路：src/refresh/rooms/client/refresh-timer.ts:116-130 把本组会话置成 snapMode='err'、snapError、snapFail={kind:'probe-failed'} 并刷新界面，成功时只撤掉 probe-failed（:135-144）；它不调用宿主事件库，所以通知中心看不到这类失败的历史。客户端取数失败也一样：src/refresh/rooms/client/snapshot-sync.ts 只把 snapFail 写成 fetch-failed 或 quota-exhausted（:282-292），没有写通知事件。

### B4. 哪些重复、哪些不重复

「重复」只在一种情况下成立：宿主刷新失败过，历史里有 refresh-failed，列表里又还挂着当前失败句。两者说的不是同一件事——事件是「发生过」，状态行是「此刻还在失败、还在重试」。反过来，铃铛、时间标签、通知中心的当前状态都不表达当前失败：铃铛只表达未读历史数量；时间标签只表达数据年龄；浮层的当前状态只表达降级，不表达失败，而且失败时还可能写「正常」。

这也是 #1699 留下的分界：当前是否降级改成列表头部的行内小标识，历史交给通知中心（来源：src/client/views/shared/fallbackMark.ts:1-16；tests/verify-rest-fallback-banner.ts:252）。事件库只做历史、当前状态必须从快照派生，是 ADR 20261030-panel-snapshot-single-source.md:67-68 和 GLOSSARY.md:77-78 写死的约定。把红句整句搬进通知中心，能搬走历史，搬不走「当前」；而探测失败连历史都没有。

## C. 列表头部三行的吸顶现状

### C1. 绿框三行在页面结构里其实是两个块

票面绿框里的三行，在页面结构里其实是两个块：第一行是 KPI 行（来源：src/client/views/ListTab.ts:367-409，行上带 data-list-head="kpi"，:368；三枚读数、降级小标识、体检按钮，允许换行）；第二、三行是同一个筛选行在 460 像素宽下换行出来的（来源：src/client/views/listFilterRow.ts:110-114 的宿主 div 就是 flexWrap:'wrap'），它依次放状态药丸、排序药丸、「全部」、最多四枚标签芯片和「+N」（:117-143）。第三行的 wayfinder:grilling、+7 是标签芯片的续行，不是另一条独立的「已选标签过滤条」。

真正的「已选标签过滤条」是条件节点：只有 st.lblFilters 非空时才画，带「已选标签」字样和每枚标签的 ✕（来源：src/client/views/ListTab.ts:348-362）。它不在截图绿框的描述里，但如果做吸顶，它会出现或消失，影响头部高度。状态行在筛选行之后（:429-436），所以它不在绿框内，滚动时同样会走。

### C2. 滚动容器只有一处

列表整棵树都挂在 Dock 的 div.dsws-body 里（来源：src/client/panel/Dock.ts:432；ListTab.ts:346 是根 div），这个容器是 flex:1、overflow-y:auto、padding:10px 12px（来源：src/client/kernel/styles.ts:50）。页签行在它外面（Dock.ts:376），所以页签不滚；列表、详情等页面都共用这个 body（:435-437）。面板本身固定 460 像素宽、最大高度按视口算、overflow:hidden（来源：src/client/kernel/styles.ts:35），滚动只发生在 body 里。因此 KPI 行、筛选行、状态行、列表行都在同一个滚动容器内，没有例外。

### C3. 现成的 .dsws-stickybar 能做什么、限制在哪

仓里已经有一份吸顶样式 .dsws-stickybar（来源：src/client/kernel/styles.ts:51）：position:sticky、top:-10px、z-index:5、背景取面板同层色、margin:-10px -12px 6px、padding:10px 12px 8px、下边框一条。负 margin 与 padding 是配套的，正好抵消 dsws-body 的 10/12 像素内边距，让吸顶条贴住滚动口。它现在用在详情页 src/client/views/IssueDetail.ts:364 和 src/client/views/MapDetailTop.ts:130，两处都是 flex 列的第一个孩子、单行、nowrap、overflow:hidden。

这个类本身不限制行数，里面放多行也会粘住；但那套 top:-10px、负 margin 和下边框是按「单行、第一个孩子」调的。如果把列表头部包成一个多行 sticky 容器，需要重新算 top（多半用 0，而不是 -10）、自己补背景、内边距和边框，并确认它前面的条件节点（已选标签过滤条）不会被负 margin 压住。z-index:5 也要复核：卡片流注释提醒过，卡片自己不成层时 z-index 会和 stickybar 的 5 平起平坐（来源：src/client/views/cards/PixelCardsStyles.ts:27）；列表行里有可点的卡片和筛选药丸，吸顶后谁盖谁需要在浏览器里看。筛选行还是液态墨块的定位宿主（listFilterRow.ts:110 的 dsws-ink-host），包一层 sticky 会产生新的层叠上下文，墨块的对齐与层级也要真机确认。

### C4. 还有哪些固定头部的先例，票面的判断准不准

另一个吸顶先例是 #1732 的状态栏在办浮层：表头用行内 position:sticky、top:0、z-index:1、背景同层（来源：src/client/statusbar/SessionChainCapsule.ts:399），整个浮层是 position:fixed、按 left/bottom 定位（:479）、高度按 window.innerHeight 算（:407）。它不在面板 body 里，和列表吸顶不是同一个容器，只能作交互参考（#1732 已关闭：表头吸顶、打开停末行、高度随窗口）。

票面「src/client 全仓唯一一处 position:sticky 在 SessionChainCapsule.ts:399」这句不准确：.dsws-stickybar 就是 position:sticky，而且已经在同一个 .dsws-body 里用了两处（来源：src/client/kernel/styles.ts:51、src/client/views/IssueDetail.ts:364、src/client/views/MapDetailTop.ts:130）。这个误判会让方案低估现成机制，也会漏掉「详情页已经这么干过」的先例。

### C5. 吸顶的代价与限制

吸顶的代价是实打实的高度。460 像素宽下，KPI 行通常一行，筛选行已经要两行；如果连条件出现的已选标签过滤条一起钉，头部还会再高一截。面板最大高度按视口减 24 像素算（来源：src/client/kernel/styles.ts:35），头部每多一行，列表可视区就少一行。

实现上有两条路：一是在 ListTab 里包一个 sticky 容器，把 KPI 行和筛选行放进去；二是把头部搬出 dsws-body，放进 Dock 的列布局。后者要改 Dock，而 body 是多个页签共用的，得按当前页签条件渲染；Dock.ts:435 还留着「正贴着 350 行上限」的注释，新增结构要算行数。范围上，「三行都固定」在页面结构里只需固定两个块（KPI 加筛选行），第三行会跟着筛选行一起粘住；若只固定 KPI 加筛选行，状态行仍在它们之后，会随列表滚走；若状态行也要固定，就得多包一个节点，或者把它并进 KPI 行。

## D. 历史与约束

### D1. 状态行与列表头部的提交轨迹

状态行是 #715（诚实显示）落地的：afca59f483（2026-09-23）新建这一行与 truthLines。第二天 492357a2e1（2026-09-24）做头部改造，把「上次更新」搬到头部时间标签；这次提交的 diff 明确删掉了状态行里 truthFreshnessLine 那句，只留 truthNoticeLines，并在 ListTab.ts:431 写下「2026-09-22 维护者定……同一条信息不再出现两次」。truthLines.ts:85-93 也记了同一个决定。

8ec5993bc9（2026-09-24）加头部逐字折叠阶梯；62c2b2c7（2026-10-24，#1446）把账本换到后端预算模型，额度句并进 truthNoticeLines；f2ca853c（#1693）建通知事件库；56476b81（2026-10-31，#1697）加通知中心与未读入口；225444e8（2026-10-31，#1699）把列表里占一行的降级横幅退役，当前降级改成 KPI 行内一枚小标识，历史交给通知中心，旧门禁改成真渲染断言，其中一条明确断言小标识在 [data-list-head="kpi"] 行内（来源：tests/verify-rest-fallback-banner.ts:252）。#1699 的交付记录还记了一处偏差：小标识落在列表头部，没有放到面板 Dock 头部。

#1833 本身是 2026-11-02 开的（父 #1825，标签 bug 与 needs-triage，0 评论），边界是只改呈现、不改刷新逻辑，两处可拆，fallbackMark 不动。

### D2. 哪些是明确约束

- #715 的硬要求：失败必可见、失败直说、推迟要说、降档说落后、时间取快照取数时刻、5 与 30 分钟阈值、词条双语（来源：票 #715；tests/verify-visible-truth.ts:1-17、:159-215）。它允许把「上次更新」放面板头部或状态栏，没有规定失败句必须留在列表那一行；但「失败必可见」意味着不能只有悬停提示，也不能只留在历史里。
- #734 与 #1446 的诚实口径：没有真实读数不许说「配额已耗尽」；额度按后端模型显示，未知与离网不许拿 0 冒充；额度句并进 truthNoticeLines（来源：票 #734、#1446；tests/verify-1446-panel.ts:237-243）。
- 当前状态与历史分开：事件库只做历史，当前是否降级从快照派生（来源：docs/adr/20261030-panel-snapshot-single-source.md:67-68；GLOSSARY.md:77-78；src/host/notifications.ts:1-16 第 2 条）。把「当前失败」做成通知事件、再从事件反推当前，和这条冲突。
- 词条数据化：新增或改写文案要进 config/copy/pages.yaml，中英文各一份（来源：docs/adr/20261020-ui-copy-data-driven.md；config/copy/pages.yaml:25-50、:111-136）。
- 文件行数：单文件有效行 350 的上限还在（来源：src/client/panel/Dock.ts:435 的注释；#734 的纪律），新逻辑放哪里要考虑这条。
- 本票边界：只改呈现、不改刷新逻辑；fallbackMark 不动；两处可拆（来源：#1833 正文）。

### D3. 哪些只是先例

属于先例、不是硬约束的：2026-09-22 的「同一条信息不出现两次」；#1699 的「当前状态行内小标识，历史进通知中心」；#1732 的浮层表头吸顶；详情页对 .dsws-stickybar 的两次使用。它们证明这些做法在本仓走得通，但没有一条说「刷新失败也必须这样」或「列表头部必须吸顶」。属于硬约束的是 D2 列的那些。分诊时可以把先例当证据，不能当授权。

### D4. 票面初步定位里需要修正的两点

一是「列表页没有吸顶先例」不成立（见 C4）；二是把绿框三行当成三个独立节点，实际是两个（见 C1），这会让「固定三行」的改动量看起来比真实的大。票面列状态句时只列了失败、落后、暂停、未在刷新、磁盘回放，漏了额度句；而额度句在 GitHub 健康态是常驻的，这直接影响「整行退役」的代价。

## E. 分诊需要维护者拍板的设计岔路

下面每条只摆事实和代价，不替维护者选。需要拍板的核心是两件事：红句所代表的当前失败状态放哪，以及吸顶包住哪些节点。

### E1. 退役整行，还是只退役失败句

如果只退役失败三句：truthNoticeLines 的失败分支和 ListTab 的渲染要改，额度、落后、暂停、延后、回放句保持原样；当前失败必须有新落点，否则 #715 的「失败必可见」失守。因为 GitHub 健康态本来就有额度句，这一行大概率还在，只是不再红、不再独占一句——「独占一行」的观感是否算解决，取决于维护者要的是「红字别独占」还是「这一行别存在」。

如果整行退役：八类句子都要重新找地方；额度句有 #1446 的「面板按后端显示额度」验收口径，搬去通知中心或设置页都要重新论证；verify-1446 与 verify-1692 的函数级断言要改；探测失败还没有历史可搬。代价最大，收益是列表头少一行。

事实依据：#1833 的期望写的是「红句不再独占一整行（可以收进通知中心这类不占布局的位置，或者行内放得下就不单独占行）」，不是「删掉整条状态行」；维护者原话也只点了红框这一句。

### E2. 当前失败状态放哪

选项一，KPI 行内小标识。事实：KPI 行已经允许换行，里面已有三枚读数、fallbackMark、体检按钮和一个 flex 占位（来源：src/client/views/ListTab.ts:367-409）；#1699 的 fallbackMark 就是行内小标识，门禁断言它在 KPI 行内（来源：src/client/views/shared/fallbackMark.ts:1-16；tests/verify-rest-fallback-banner.ts:252）。代价：460 像素下这一行会更挤，窄面板换行更多；如果 KPI 行吸顶，红标识会一直钉在顶部。另一个差异：fallbackMark 可以按会话关掉，失败标识若也允许关，会和「失败必可见」冲突。

选项二，头部，铃铛或时间标签旁边。事实：铃铛现在是「历史未读数」，时间标签是「数据年龄」，两者都没有「当前失败」的语义；把失败塞进未读数会把「发生过」与「正在发生」混在一起，ADR 明确反对从历史反推当前。另加一枚独立小标识可行，但头部第一行已经有刷新按钮、铃铛、时间标签，宽度也紧；只做悬停提示不满足「失败必可见」。

选项三，通知中心。事实：宿主刷新失败有历史（来源：src/refresh/rooms/host/notification-store.ts:189-202），客户端探测失败没有（src/refresh/rooms/client/refresh-timer.ts:116-130 不写事件库）；浮层「当前状态」只表达降级，失败时可能写「正常」（src/client/views/shared/notificationCenterModel.ts:279-283）。要让通知中心表达当前失败，得改「当前只从快照派生」的模型，属于设计变更，不是搬一行界面。

选项四，留在列表但改成行内或紧凑形态。事实：状态行本身就是 flexWrap 的行，字号 11，理论上可以塞进筛选行或 KPI 行；但红字与筛选药丸混排会抢注意力，窄面板仍可能换行，而且额度句也在同一行，合并后信息密度高。

### E3. 额度、落后、暂停这些句子去哪

留在原行：改动最小，但「整行退役」就不成立；GitHub 健康态仍会常驻一到两句额度。并进 KPI 行：KPI 行已有三枚读数、小标识、体检按钮，额度两句再加进去，460 像素下几乎必然换行；好处是不多占一行。进头部悬停：不占版面，但额度是持续信息，藏起来与 #1446「面板按后端显示额度」的意图有张力。单独可折叠行：仍占一行（折叠时），只是可收。搬到设置或关于页：面板上不再显示额度，需要确认 #1446 的验收是否允许。

事实依据：额度句最多两句（GraphQL 与 REST），语气会随已用比例变黄或变红（来源：src/client/views/shared/truthLines.ts:133-150、:187-195）；#1446 的门禁只断言函数输出，不按页面位置断言，所以「搬到哪」在门禁层是自由的，在验收意图层不是。

### E4. 吸顶范围

三行都固定：页面结构上固定 KPI 加筛选行即可，第三行自动跟随；如果连已选标签过滤条也固定，条件出现时头部更高。只固定 KPI 加筛选行：状态行留在滚动区，红句（若保留）会滚走，这反而符合「红句别占固定头部」的方向。只固定筛选行：KPI 滚走，省高度，但统计数字也看不到了。

机制：复用 .dsws-stickybar 的视觉语言，但多行容器要重算 top、margin、padding、背景和边框；或者把头部搬出 dsws-body（改 Dock，多页签共用，Dock 接近 350 行）。无论哪条，460 像素与更窄宽度下的实际高度、换行、液态墨块层级都要真机验。事实依据：dsws-body 是唯一滚动容器（来源：src/client/panel/Dock.ts:432；src/client/kernel/styles.ts:50）；KPI 与筛选行是两个块（见 C1）；.dsws-stickybar 现有用法都是单行第一个孩子（见 C3）；面板 460 像素（styles.ts:35）。

### E5. 有没有更简单的做法

从改动面看，改动最少的一种组合是只处理红句：把它从独占行改成 KPI 行内的一枚标识，或筛选行内的一段文字，额度句留在原行。这样不用动额度契约，不用给八类句子找新家，也不用改 verify-1446 与 verify-1692；代价是列表头仍有一行额度，红句不再独占，但「这一行」还在。

第二步才是吸顶：只包 KPI 加筛选行，状态行留在滚动区；如果红句已经并进 KPI 行，它会跟着吸顶，正好是「当前失败一直可见」。这两步可以分开交付，也符合票面「两处可拆」。另一条更省事的做法是只把状态行改成「有失败才出现、平时不占位」：失败时仍是一行，但健康态不再常驻额度。这和 #1446 的「面板显示额度」冲突，需要维护者确认额度是否可以不常驻。以上都不是建议，只是把改动面和代价摆出来。

### E6. 两处要不要拆、先做哪一处

票面说两处可拆。事实：红句去留主要动 ListTab 的渲染与 truthNoticeLines 的消费方式；吸顶主要动 ListTab 的结构与样式，可能动 Dock。二者唯一的交叉点是「红标识如果放进 KPI 行，而 KPI 行又要吸顶」，这时标识的位置会被吸顶方案再动一次；先定吸顶范围再定标识落点，或反过来，都可以，但同时做要避免返工。

## 待核实

1. 截图那一行为什么只有红字、没有额度句。按代码，GitHub 已知读数会常驻两句；可能是快照没有 refresh.backend、走了 pendingLate 或无快照分支、截图裁切，或安装的 1.9.0-beta.34 产物与 main 源码不一致。需要原图或真机复现，本次没有核对发布包。
2. 那次刷新失败的根因。#1833 明确不修根因；#1753 记的是 GitLab 探针漏传 exec，本机仓库是 GitHub，不能直接套用。
3. 三行吸顶在 460 像素和更窄宽度下的实际高度、换行、液态墨块对齐与层叠。代码只能推断，需要浏览器或真机验证。
4. 通知中心「当前状态：正常」与列表红字同屏的实际情况。代码推断成立（fallback 不是 rest 时），但没有截图。
5. 本机安装的 1.9.0-beta.34 构建产物是否与 main 这几行源码一致。package.json 的版本对得上，构建新鲜度没有查。
6. #1699 的 fallbackMark 允许按会话关闭；刷新失败标识是否也能关闭，是设计问题，不是事实，需要维护者定。

## 附：主要来源

- 源码：src/client/views/ListTab.ts、src/client/views/shared/truthLines.ts、src/client/views/listFilterRow.ts、src/client/views/shared/fallbackMark.ts、src/client/views/shared/notificationCenter.ts、src/client/views/shared/notificationCenterModel.ts、src/client/panel/Dock.ts、src/client/kernel/styles.ts、src/client/views/IssueDetail.ts、src/client/views/MapDetailTop.ts、src/client/statusbar/SessionChainCapsule.ts、src/refresh/rooms/client/refresh-timer.ts、src/refresh/rooms/client/snapshot-sync.ts、src/refresh/rooms/host/session-refresh-schedule.ts、src/refresh/rooms/host/notification-store.ts、src/refresh/rooms/host/budget-state.ts、src/refresh/kernel/notification-events.ts、src/refresh/kernel/host-budget.ts、src/tracker/rooms/github/room/index.ts、src/host/index.ts、src/host/notifications.ts、src/host/tracker/snapshot.ts。
- 门禁：tests/verify-visible-truth.ts、tests/verify-1446-panel.ts、tests/verify-rest-fallback-banner.ts、tests/verify-1692-disk-replay-eviction.ts。
- 词表与文档：config/copy/pages.yaml、config/copy/panel.yaml、src/client/kernel/locale-data.ts、GLOSSARY.md、docs/adr/20261030-panel-snapshot-single-source.md、docs/adr/20261020-ui-copy-data-driven.md。
- 提交与票：afca59f483（#715）、492357a2e1（2026-09-24 头部改造）、8ec5993bc9（头部折叠）、62c2b2c7（#1446）、f2ca853c（#1693）、56476b81（#1697）、225444e8（#1699）；#1833、#1699、#715、#734、#1446、#1753、#1732。

维护者拍板结果见 research/1833-triage-2026-11-03.md 第九节（2026-11-03）：Q3 改为整行退役，额度句移入通知中心。
