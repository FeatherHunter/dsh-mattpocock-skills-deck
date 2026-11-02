# 列表页状态行与头部吸顶：事实调查（#1833）

> 这份笔记回答 #1833 分诊要用的四个事实问题：状态行是什么、它和面板头部/通知中心是不是重复、列表头为什么随列表滚走、有没有现成的吸顶机制可以用。只收一手来源（本仓源码、门禁、词表与已关闭票的交付记录），每条结论后面标出处。调查时间 2026-11-03，代码行号取自 main HEAD 1b8197f0。

## 一、状态行是什么，怎么画出来的

- 状态行的内容只在 src/client/views/shared/truthLines.ts 的 truthNoticeLines（:197-247）里算一次，依次可能产出：失败句（:219-222，失败且配额耗尽→truth.failQuota，已暂停→truth.failPaused，否则→truth.failRetry，三句都是 tone red）；落后句（:225-227，refresh.tier 的承诺延迟大于探测间隔时）；暂停句（:231）；延后句（:233）；未在刷新句（:234）；磁盘回放句（:237-240）；最后并入 budgetNoticeLines（:152-196）的额度句（:244-245）。去重靠 :201-204 按 key 去重。
- 额度句的边界：refresh.backend 不存在时 budgetNoticeLines 返回空；readKnown 不是 true 时给「额度读数还没同步上来」；two-buckets 且两桶都见底时给 quota 失败句；否则按桶给 truth.budgetGraphql / truth.budgetRest；有旧读数且同步失败过再追加 stale 句（来源：truthLines.ts:152-196；词条见 config/copy/pages.yaml:31-50）。
- GitHub 后端声明的是 two-buckets 额度（来源：src/tracker/rooms/github/room/index.ts:232；GitLab 是 requests-only（src/tracker/rooms/gitlab/index.ts:493）；markdown 是 off-network（src/tracker/rooms/markdown/index.ts:425））；宿主在 src/host/index.ts:229、:233 把 budgetReadout 接给快照组装，最终读到 src/host/tracker/snapshot.ts:93-101 的 BudgetReadout；读不到读数时 src/refresh/rooms/host/budget-state.ts:114-141 会给出 readKnown:false。因此正常 GitHub 面板只要快照带 refresh.backend，状态行至少常驻额度句或额度未知句（推断，依据上面两处类型与接线；维护者截图里只有红字，这一点待核实）。
- 画出来的是一个块级 flex 行：src/client/views/ListTab.ts:429-436 里 div.dsws-truth 带 display:flex、flexWrap:wrap、gap:8、fontSize:11、padding:'2px 2px 4px'，每句一个 span；只有失败句时整行只有一段文字，右侧留白。:431 的注释记着 2026-09-22 维护者定过「上次更新」搬去面板头部，这一行从此只说其余状态句。
- 同一棵列表树里，状态行的邻居是：已选标签过滤条（:348-362，只在 st.lblFilters 非空时画）、统计行（:365-409，行上 data-list-head="kpi"）、多目录签（:411-414，有才画）、筛选行（:415，实现在 src/client/views/listFilterRow.ts）、已关闭折叠（:416-418）；首开遮罩（:424）与无快照错误行（:428）也在树里（来源：src/client/views/ListTab.ts:346-450）。

## 二、面板头部与通知中心各自管什么

- 头部一行的组件是：刷新按钮（src/client/panel/Dock.ts:335-340）、通知中心入口（:343，组件在 src/client/views/shared/notificationCenter.ts，浮层挂 document.body，不占列表高度）、头部时间标签（:346-347，span[data-head-updated] 画「刚刚 / N 分钟前」这类相对时间，颜色取 freshnessToneColor，悬停给完整说法 truth.updatedTip）、页签行（:376，在滚动区外）。时间标签的内容来自 truthFreshnessBox（truthLines.ts:95-107）与 truthFreshnessLine（:56-63），只回答「这份数据离现在多久」，不回答「现在是否在失败」。
- 通知中心只显示历史事件：事件类型见 src/refresh/kernel/notification-events.ts:29（degraded-start、degraded-recovery、refresh-failed、write-failed）；宿主刷新失败由 src/refresh/rooms/host/notification-store.ts:189-202 的 noteRefreshFailure 记入；通知中心模型在 src/client/views/shared/notificationCenterModel.ts:32-58、:146-150；词条见 src/client/kernel/locale-data.ts:1884、:1891、:1902（英文 :2215、:2222、:2233）。未读徽标在读完历史后消失。
- 通知历史覆盖不全：宿主刷新失败的唯一记录点是 src/refresh/rooms/host/session-refresh-schedule.ts:73-85 的 noteRefreshFail（:120 选择失败、:403 refreshOf 抛错两处调用）。客户端的探测失败在 src/refresh/rooms/client/refresh-timer.ts:113-130 只写 st.snapMode='err'、st.snapError、st.snapFail={kind:'probe-failed'} 并发事件刷新界面（:152-160），客户端取数失败在 src/refresh/rooms/client/snapshot-sync.ts:291 只写 snapFail={kind:'fetch-failed'|'quota-exhausted'}；这两类都不写通知事件库（来源：上面两文件的这些行；通知库只暴露 noteSnapshot / noteRefreshFailure / noteWriteFailure，见 src/host/notifications.ts:48-59）。
- 通知库自己有一条约定：当前是否降级永远从快照派生，不从事件历史反推（来源：src/host/notifications.ts:1-16，第 2 条）。所以「把红字交给通知中心」只能搬走历史，搬不走当前状态。
- 结论（事实层）：面板头部与通知中心都不表达「当前正在刷新失败」；状态行不是它们的重复，而是唯一的当前失败位。

## 三、列表头为什么随列表滚走

- 面板的滚动容器只有一处：src/client/panel/Dock.ts:432 的 div.dsws-body（flex:1、overflowY:auto、padding:'10px 12px'）。列表、详情等页面都挂在这个容器里（列表是 :435-436）。
- ListTab 返回的整棵树都在这个容器内（src/client/views/ListTab.ts:346），统计行、筛选行、标签芯片行、状态行都没有 sticky 类；所以内容一滚，它们就一起走。
- 页签行（Dock.ts:376）在 dsws-body 外面，因此不滚。这说明「搬出滚动容器」在结构上可行（改 Dock，影响所有页面），「在容器里吸顶」不用改 Dock。

## 四、现成的吸顶机制

- src/client/kernel/styles.ts:51 定义了 .dsws-stickybar：position:sticky、top:-10px、z-index:5、背景取 var(--dsws-alias-bg-layer-2,#16181d)、margin:-10px -12px 6px、padding:10px 12px 8px，下边框一条。负 margin 与 padding 配套，正好抵掉 dsws-body 的内边距。
- 使用处：详情页 src/client/views/IssueDetail.ts:364（className dsws-stickybar，data-detail-topbar=1，带 ref）；src/client/views/MapDetailTop.ts:130（同 className）。另一处独立的内联 sticky 在 src/client/statusbar/SessionChainCapsule.ts:399（状态栏在办浮层表头），与本机制无关。
- 门禁没有守 .dsws-stickybar 的使用与位置：tests 里只有 tests/verify-cards-dir.ts:261 的注释提到它，没有断言它会存在或不存在（来源：在 tests 目录检索 dsws-stickybar / position:sticky 的结果）。因此给列表页加吸顶包装，不会撞上既有「不许 sticky」的断言。

## 五、历史与约束

- 2026-09-22 的决定：列表状态行里的「上次更新」搬去面板头部时间标签（来源：src/client/views/ListTab.ts:431 注释；truthLines.ts:85-93 的注释也记了同一件事）。状态行因此只剩其余状态句，但仍留在列表树里。
- #1699（列表内占一行的降级提示退役，已关闭）：做法是删掉 src/client/views/shared/RestFallbackBanner.ts，新增 src/client/views/shared/fallbackMark.ts，把「当前是否降级」做成列表头部统计行里一枚不占行的小标识；只从快照派生、不写会话态、不加关闭钮、不排定时器；门禁 tests/verify-rest-fallback-banner.ts 改为真投影渲染断言（列表页 13 条、通知中心 11 条、文案与登记 13 条）；演出偏差是小标识放列表头部、没放面板 Dock 头部（来源：票 #1699 的维护者交付评论，2026-10-31；tests/verify-rest-fallback-banner.ts:8、:150、:223-233、:252）。
- #1693/#1697（通知事件库与通知中心）：事件库在宿主侧记录，客户端只读历史，未读徽标在面板头部；当前状态不从历史反推（来源：src/host/notifications.ts:1-16、:48-59；src/refresh/kernel/notification-events.ts:29；Dock.ts:343）。
- #1446 的额度句契约：额度读数并进 truthNoticeLines 同一份列表，按键去重（truthLines.ts:242-245）；门禁 tests/verify-1446-panel.ts:232-245 断言额度句进 budgetGraphql/budgetRest、读数未知只说 truth.budgetUnknown。若搬走整行，这些断言要另找落点。
- #1692 的磁盘回放句：truth.replayLastKnown 也由 truthNoticeLines 产出（truthLines.ts:235-240），门禁 tests/verify-1692-disk-replay-eviction.ts:247-255 断言 replay 行。
- 文案纪律：状态句的词条都在 config/copy/pages.yaml:31-50，中英文同文件；新增短标识要同时加中英词条。
- 门禁里没有断言 div.dsws-truth 的 DOM 位置（在 tests 目录检索 dsws-truth 无命中），失败句的断言都是函数级（tests/verify-visible-truth.ts:162-213、:256、:365）。三个列表骨架测试把 truthNoticeLines 桩成空数组（tests/verify-1286-list.ts:134、tests/verify-1295-dual-panel.ts:213、tests/verify-1302-panel-list-skeleton.ts:127）。

## 六、对 #1833 方案的含义（只讲事实与代价，不给决定）

- 若只退役失败三句：改 truthNoticeLines 的失败分支与 ListTab 的状态行渲染；其余状态句与额度句保持原样，verify-1446 的额度断言不用动，verify-visible-truth 的失败句断言要改写；当前失败状态需要新落点，否则失败静默。
- 若整行退役：要同时给落后/暂停/延后/未在刷新/磁盘回放/额度句找去处；额度句在 GitHub two-buckets 下可能常驻，代价最大；verify-1446 与 verify-1692 的断言都要改。
- 吸顶：复用 .dsws-stickybar 包住列表头几行，改 ListTab 即可，不用改 Dock；窄面板下标签芯片换行会让吸顶高度变高，范围要定。没有现成门禁守位置，建议补真投影断言。
- 通知历史缺口：探测失败与客户端取数失败没有事件可搬；补它们要动宿主/客户端事件写入，超出「只改呈现」的边界。
- 待核实：维护者截图上只有红字、没有额度句，原因可能是那张快照没有 refresh.backend（推断，未核实）；这不改变「状态行是当前失败唯一出口」的结论，但影响「整行退役」的代价评估。

## 七、来源清单

- 源码：src/client/views/ListTab.ts、src/client/views/shared/truthLines.ts、src/client/views/listFilterRow.ts、src/client/views/shared/fallbackMark.ts、src/client/panel/Dock.ts、src/client/kernel/styles.ts、src/client/views/IssueDetail.ts、src/client/views/MapDetailTop.ts、src/client/statusbar/SessionChainCapsule.ts、src/client/views/shared/notificationCenterModel.ts、src/refresh/rooms/client/refresh-timer.ts、src/refresh/rooms/client/snapshot-sync.ts、src/refresh/rooms/host/session-refresh-schedule.ts、src/refresh/rooms/host/notification-store.ts、src/refresh/rooms/host/budget-state.ts、src/refresh/kernel/notification-events.ts、src/client/kernel/locale-data.ts、src/host/notifications.ts、src/host/index.ts、src/host/tracker/snapshot.ts、src/refresh/rooms/host/session-snapshot-cache.ts、src/tracker/rooms/github/room/index.ts、src/tracker/rooms/gitlab/index.ts、config/copy/pages.yaml。
- 门禁：tests/verify-visible-truth.ts、tests/verify-1446-panel.ts、tests/verify-rest-fallback-banner.ts、tests/verify-1692-disk-replay-eviction.ts、tests/verify-1286-list.ts、tests/verify-1295-dual-panel.ts、tests/verify-1302-panel-list-skeleton.ts、tests/verify-cards-dir.ts。
- 票与记录：issue #1833（正文与维护者原话，2026-11-02）、#1699（已关闭，2026-10-31 交付评论）、#1693（通知事件库）、#1697（通知中心入口）、#1446（额度句）、#1692（磁盘回放）、#1753（刷新失败原因）、#1732（另一界面表头吸顶）。
