# 列表页置顶容器组（探索地图 / 实施地图）的排序现状

- 日期：2026-10-21；基线 HEAD `a399d93d`。本轮只读调查，没有改代码、没有提交；工作树里原有的 `src/client/statusbar/StatusBar.ts` 改动与本轮无关。（注：本文行号与工作树状态以调查当时为准；随后 #1356 落地删除了 `sortContainers`，`ListTab.ts` 里相关行号已失效，改看当前源码。）
- 提问：右侧面板 ISSUE 列表里，置顶的探索地图与实施地图（规格）那一组，是否也受「更新时间 / 创建时间 / 编号 / 标题」四个排序档影响？
- 结论先行：
  - **不受。** 今天四个排序档只作用于普通票与已关闭票；打开的容器行固定按 `updatedAt` 降序、同一时刻按编号升序（`src/client/views/ListTab.ts:251-262`）。
  - 置顶区实际上是两个独立组，组间顺序写死「探索地图组 → 规格组」，时间不参与跨组比较（`src/client/views/ListTab.ts:309`；`tests/verify-1295-dual-panel.ts:386` 的 AC1f）。
  - 这是 #1286 拍板的结果，不是漏做：`docs/design/1286-implementation-map-visual.md:68` 与 `:100` 的 D8 行、以及 issue #1286 正文第 2 条都写着「组内按最近更新」。用户这次的需求等于改这条设计。
  - 仓里旧笔记回答不了「置顶组排序现状」：它们只停在「地图行恒置顶」（`research/374-reuse-inventory.md:46`、`research/677-field-consumption.md:129`，后者读的还是旧路径 `ListTab.js:121`），没有写四个排序档、两组、已关闭容器与门禁。所以另起这篇。

## 1 一次点击之后代码怎么走

- 入口组件是 `ListTab`（`src/client/views/ListTab.ts:109`）。它先把快照池子收成行池：`ticketRowsOf(st.snapshot.issues)` 再并上按需翻回来的页（`src/client/views/ListTab.ts:188`；`ticketRowsOf` 只丢掉拉取请求行，见 `src/client/kernel/store-derived.ts:121-122`）。
- 分桶在 `src/client/views/ListTab.ts:236-248`：`mapOnlyIssues` / `specOnlyIssues` / `plainOpenIssues` / `closedIssues`。注意 `state === 'CLOSED'` 的判断在最前面（`:243`），所以**已关闭的容器行会落进 `closedIssues`，不会进两个容器桶**。
- 容器种类判定走 `containerKindOfSafe`（`src/client/views/ListTab.ts:224-235`），真源是 `src/client/kernel/container-view.ts:46-55`（口径说明在 `:5-6`）：`type === 'map'` 或带 `wayfinder:map` 标签 → 探索地图；`type === 'spec'` → 规格（实施地图）。规格不许带 `wayfinder:map` 标签，否则会被认成探索地图（`src/tracker/contract/vocabulary.ts:33-47`）。两类容器在快照里同住 `snapshot.maps` 一个数组，靠 `type` 分辨（`src/host/tracker/snapshotAssemble.ts:109-116`）。
- 容器组内排序是单独一个函数 `sortContainers`（`src/client/views/ListTab.ts:251-258`）：只读 `updatedAt`，降序；同一时刻用编号升序兜底。它不读 `st.sortKey` / `st.sortDir`。
- 普通票与已关闭票走 `sortIssues`（`src/client/views/ListTab.ts:194-214`）：按面板的 `sortKey` 与 `sortDir` 排，同键兜底是「先 effort 再编号升序」（`:211`）。
- 最后拼接：`sortedMaps.concat(sortedSpecs).concat(sortedOpen)`（`src/client/views/ListTab.ts:309`），注释写的是「三段顺序 —— 探索地图 → 规格 → 普通票（容器组在前，普通票仍按面板排序档）」（`:308`）。

## 2 四个排序档今天各作用在哪

排序药丸在 `src/client/views/listFilterRow.ts:127-137`，四个键是 `['updatedAt','createdAt','number','title']`，界面词依次是「更新 / 创建 / 编号 / 标题」（`src/client/kernel/locale-data.ts:572-575`）。点当前键翻转方向，换键时标题默认升序、其余默认降序（`src/client/views/listFilterRow.ts:133-134`）；首次启动的持久化默认值是「编号升序」（`src/client/kernel/store-prefs.ts:32`），所以从别的键第一次点「编号」得到的却是降序。

| 排序档 | 普通票 | 已关闭票 | 打开的探索地图组 | 打开的规格组 |
| --- | --- | --- | --- | --- |
| 更新时间 | 生效（`ListTab.ts:261`） | 生效（`:262`） | 不生效，恒按 updatedAt 降序 | 不生效，恒按 updatedAt 降序 |
| 创建时间 | 生效 | 生效 | 不生效 | 不生效 |
| 编号 | 生效 | 生效 | 不生效 | 不生效 |
| 标题 | 生效 | 生效 | 不生效 | 不生效 |

两点容易被忽略：

1. **已关闭的容器其实跟着排序档走。** 因为它在 `:243` 先入 `closedIssues`，再被 `sortIssues` 排（`:262`）。同一张地图开放时按更新时间沉浮、关闭后按你选的档排，这是一处现成的不一致。
2. **两个容器组之间的顺序不受任何档影响。** AC1f 专门断言「组顺序压过时间」：规格组里最新的一张（09:00）也必须排在两张探索地图之后（`tests/fixtures/1295-dual-panel/list-snapshot.json:168`；`tests/verify-1295-dual-panel.ts:386`）。

## 3 设计依据与历史

- issue #1286 正文第 2 条：「列表顺序：探索地图 → 实施地图 → 普通票；同一组里按最近更新的排在前面。」（2026-10-20 当面拍板）
- `docs/design/1286-implementation-map-visual.md:100` 的落差表 D8 行写得最直白：原型「组内按最近更新」，现有代码「按面板的排序档（编号/标题/其它），地图恒置顶」，落地决定是「容器组内按 `updatedAt` 降序，普通票仍按面板排序档」。
- 更早的验收记录同口径：`docs/archive/ACCEPTANCE.md:30`（旧项目 v15）「open 列表 map 项优先置顶……map 内部按 updatedAt 倒序，已关闭行保持时间序」。
- 代码来历：`sortContainers` 与规格桶来自提交 `24bb3ff3`（#1286「让面板认得「规格」这类容器」）；分桶收口到 `containerKindOf` 来自 `7ae06e04`（#1295）；`sortIssues` 的「比较键只算一次」来自 `88b5a582`（#1253）；`ListTab.ts:189` 那句「map 组与普通组各自按所选维度排序」的 #374 注释来自 `a26d6f3a`，而 #374 是旧项目 dsh-waystation 的票号（品牌迁移提交 `db00e2e3`），与本仓 issue #374（研究笔记盘点）不是一回事。
- 文档滞后的一处旁证：`docs/research/readme-visible-features.md:16` 还写着排序只有「更新时间、编号、标题」三档，漏了创建时间。

## 4 门禁现在锁住了什么、没锁住什么

- 锁住了三段顺序：`tests/verify-1286-list.ts:279`（D1）、`tests/verify-1295-dual-panel.ts:360`（AC1b）、`:372`（AC1c）、`:386`（AC1f），以及夹具里写死的期望顺序与判据（`tests/fixtures/1295-dual-panel/list-snapshot.json:161-168`）。
- 锁住了容器组内「按 updatedAt 降序、同一时刻编号升序」：D2/D3（`tests/verify-1286-list.ts:280-281`）、AC1e（`tests/verify-1295-dual-panel.ts:383`）。
- 还锁了实现形状：`tests/verify-1286-list.ts:292` 的 E4 断言源码里存在 `sortedMaps.concat(sortedSpecs).concat(sortedOpen)` 这一串，重构拼接写法会直接变红。
- **没有锁住「容器忽略排序档」。** 现有门禁里 `st.sortKey` 全是 `updatedAt`（`tests/verify-1286-list.ts:157`、夹具 `:4`），而容器组今天恰好就是按 updatedAt 降序；如果哪天容器改走 `sortIssues`，D2、D3、AC1b、AC1c、AC1f 仍然会全绿。换句话说，这条例外只写在注释和设计文档里，没有可执行的护栏。

## 5 数据侧：容器行到底有没有这些字段

- 面板列表里的容器行来自 `src/host/sessionSnapshot.ts:170-206` 的三段拼接：先放 `inner.maps`（容器，`:171-178`），再放地图子票，再放普通票，最后 `dedupeListByPool`「地图容器优先」。容器对象是 `Object.assign({}, m, ...)`（`src/host/tracker/snapshotAssemble.ts:135-142`），行上有什么字段就带什么。
- `createdAt` / `updatedAt` 是契约的核心字段（`src/host/tracker/capability.ts:47-50`；`src/tracker/contract/entities.ts:47`、`:130`）。GitHub 房归一里两者都有（`src/tracker/rooms/github/normalize.ts:188`，列表查询也取 `createdAt`，见 `src/tracker/rooms/github/queries.ts:23`）。本地 Markdown 房的 `createdAt` 取的是票文件修改时间（`src/tracker/rooms/markdown/issues-read.ts:94-101`），语义上是「文件写入时间」，不是工单意义上的创建时间。
- 风险：`sortContainers` 读不到 `updatedAt` 时退成空串、直接沉底（`src/client/views/ListTab.ts:253-254`）。换成 `createdAt` 排序会遇到同一类缺值；夹具里的容器行只给了 `updatedAt`，没有一条按创建时间排容器的用例，真实数据上是否每张容器都有值没有验证过。GitLab 房这一版还没接规格识别（`src/host/tracker/snapshotAssemble.ts:113-114`），字段与行为都还是未知数。

## 6 用户这次需求的落点与风险

用户的说法是「置顶的探索地图和实施地图的顺序也会被 更新、创建、编号、标题 排序所影响（内部的排序，不会和普通ISSUE混合）」。从代码看，要动的是 `sortContainers` / 三段拼接这两处；但下面几点需要先和人确认：

1. **「内部」指哪一层。** 是「探索地图组内部、规格组内部各自按所选档排」，还是「两张地图合成一个置顶组、统一按所选档排」？
   - 前一种保留「探索地图 → 实施地图」的三段顺序，只改两组内部，改动面小；现有门禁会全绿（因为它们只用 updatedAt），必须补按编号、标题、创建时间的断言，否则没有门禁锁新行为。
   - 后一种会让地图与规格按时间交错，直接推翻 #1286 的视觉结论②和 D1、AC1b、AC1c、AC1f、夹具判据（`tests/fixtures/1295-dual-panel/list-snapshot.json:168`），要先确认用户是否要撤回那条设计。
2. **正倒序怎么落到容器上。** 四个档的默认方向不一致（标题升序、其余降序，`listFilterRow.ts:134`），且首次启动默认编号升序（`store-prefs.ts:32`）。若容器直接复用 `sortIssues`，「更新时间倒序」与「编号升序」会随用户点击一起翻转，需要明确是否照搬。
3. **同一时刻兜底会变。** `sortIssues` 的同键兜底是「先 effort 再编号」（`ListTab.ts:211`），`sortContainers` 只有编号（`:256`）。容器改走前者时，同一时刻的容器顺序在跨 effort 场景下会变；AC1e 只断言了同一时刻编号升序（`tests/verify-1295-dual-panel.ts:383`）。
4. **已关闭容器要不要一起改。** 它今天跟着排序档走（`ListTab.ts:243`、`:262`），与打开的容器不一致；改开态排序时应顺手决定是否统一。
5. **偏好是否要分组记忆。** 排序偏好是全局一格 `listPrefs.sortKey/sortDir`（`src/client/kernel/store-prefs.ts:32`；`src/client/views/listFilterRow.ts:135`），没有「置顶组单独一套排序」的位置；如果用户只想要置顶组单独排序，要新增偏好并接 `settings-ui.ts:50` 的 `UI_PREF_NAMES`。
6. **注释会误导下一个读者。** `src/client/views/ListTab.ts:189` 还写着「map 组与普通组各自按所选维度排序」，与今天的实现相反；改这块时应一并修正，并说明 #374 是旧项目票号。

## 7 现有 issue 有没有同主题的票

- deck 工具这条路：`deck_context` 报 backend-timeout（backend=github，repo FeatherHunter/dsh-mattpocock-skills-deck），`deck_issue_list` 用「排序」「置顶」「列表」查过，返回的 open 票都不相关（#1335、#916、#1176、#1186 等）。
- `gh issue list --search` 复核「排序」「置顶」「地图 排序」：没有找到同主题的 open 票；最接近的是已关闭的 #1286（实施地图视觉落地，含列表排序）与 #1295（双轨面板按容器类型分流）。#1010 是 deck 工具 TS 化，与本主题无关。
- 所以：同主题票目前没有；但不能据此断言绝对不存在，只能说这三种关键词没搜到。

## 8 一句话回答

现状是「置顶的两类容器各自按最近更新降序，四个排序档管不到它们」；用户要的是让排序档也管到置顶组内部。这不是补一个漏掉的判断，而是改 #1286 定下的一条设计，先要确认「组内各自排」还是「合并成一组排」，再决定是否放宽三段顺序的门禁。
