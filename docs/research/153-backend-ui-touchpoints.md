# #153 研究：后端选择 UI 触点盘点（设置/状态栏/右侧面板 + 数据流）

> Issue #153 | Date 2026-08-24 | Author: FeatherHunter (research agent)
> Parent map #119 | Contract: docs/architecture/tracker-backend-design-contract.md §2, §6 + shape.js + #125 Selection

## 1. 目的与不变量（第一性原理）

本票是 #119 子图的 R 票，不产生行为代码，只回答「多后端化后哪些 UI 点**必须改**、哪些靠空值渲染**天然覆盖**、哪些**待定**」。

### 1.1 契约不变量（上游已定版，不得在本票内推翻）

- **§2 ① 完整数据形状**：`src/shared/tracker/shape.js:108-140` 核心字段永远存在（`key/type/title/state/body/url/createdAt/updatedAt/closedAt/parentKey` 永不缺），来源给不了用 `''`/`null` 补齐。能力字段（`author/assignees/labels/milestone/customFields/reason/blockedBy/comments`）可 MISSING（省略）或 EMPTY（`[]`/`''`/`null`）。
- **§2 ② UI 假设所有字段必填 + 不新增隐藏逻辑**：`shape.js:9` "空值由 UI 按现有渲染逻辑处理（如 labels 空则不渲染胶囊），不新增隐藏逻辑"。即：UI 代码中已有的 `if (arr.length)` / `label ? renderChip : null` 分支即是能力缺席的自然呈现，不为 MISSING 再加分支。
- **§2 ③ capability-by-fill**：`shape.js:2-9` + `constants.js:8` 能力 = 从后端填了什么推导，不引入手写 capabilities 声明。第三方不填即 MISSING。
- **§2 ④ 诊断边界 = 日志**：host 记归一化后每字段填/空（`labels:[] (EMPTY)`），client 记渲染/隐藏。跑 bug 靠日志二分，不引入运行时形状内省。
- **#125 Selection 三态 + pending**：`Selection { backendId: BackendId|null, source:'explicit'|'matches'|'fallback', ref: RepositoryRef, multiHit?:[], pending?:boolean }`（详见 issue #125 V4）。`backendId:null` = 无后端（Other 逃生舱，不注册），`pending:true` = 超时未决（仲裁超时，排除出决策集，surface 不静默 fallback）。
- **G5 能力视图仅诊断**：`docs/architecture/tracker-backend-charting-snapshot.md §3.7-G5` — host 随 `wf.status`/`wf.snapshot` 下发能力视图仅作诊断/信息用，不驱动 UI 隐藏（UI 隐藏只靠 §2 ② 空值分支）。
- **RepositoryRef**：`shape.js:143-150` `{ backend: BackendId(non-empty), refId, name, url }`，恒带真实 backendId；`labelOf(null)="Other"`（#125）。

### 1.2 推导出的判定法则

对每个 UI 渲染点做三分类：

- **必须改**：当前代码**写死了单后端假设**（如只展示 `owner/name`、只认 `github`、无 backend 选择器、无 per-workspace 覆盖存储），多后端后不改则错或缺功能。
- **天然覆盖**：当前代码**已按空值分支渲染**（如 `labels.length ? chip : null`、`assignees.length ? avatar : null`、`blockedBy.length ? lock : null`），后端回 EMPTY/MISSING 时自然不渲染或渲染空态，符合 §2 ②，无需改。
- **待定**：取决于 #154 G 票对「是否需新增显示项（如 milestone/customFields 区块、OtherCard、无后端态提示）」的决策；当前 R 票标记但不拍板。

## 2. 数据流路径结论（Selection/RepositoryRef 从 host 到 client）

### 2.1 现状（单一 GitHub 硬编码）

```
host:src/host/index.js
  getRepoKey(cwd) — 810行 parseGithubRepo → Tier1 git remote get-url origin (仅认 github.com) → Tier2 .git/config 直读 → Tier3 gh repo view
  buildStatus(cwd) 944行 → c1 repo + 9 checks → wf.status 971行 handle
  buildSnapshot(cwd) → fetchMaps(cwd) [gh issue list --label wayfinder:map] + fetchIssues(cwd) [gh issue list --limit 500] + fetchMapsDetail{GraphQL QUERY / REST fallback} → 组装 { ok, repo:{owner,name}, maps[], issues[], generatedMs } → wf.snapshot 1023行 / wf.refresh 1047行 (60s cache + disk cache .dsh-mattskillsdeck-cache/)
  ↓ RPC (harness.handle via host.call)
client:
  store.js:getCwdSync(sid) 226-252 → SessionSummary.cwd 权威
  probe.js:loadSnapshot(st,force,silent) 179-251 → hydrateFromCache / host.call('wf.snapshot'|'wf.refresh'…{cwd})
  probe.js:loadChecks(st…) 10-41 → host.call('wf.status'…{cwd,lang,force})
  store.js:shared / stores[sid] { snapshot, cwd, snapMode, checks, issuePath… } 184-201
  Dock.js:36-84 useEffect 同步 cwd + 水合 → ListTab/MapDetail/IssueDetail/StatusBar 消费 st.snapshot
  StatusBar.js:53-75 同步 cwd → 计数 (frontierCount/occCount 等) + issuePath
  ChecksTab.js:10 loadChecks → checks 分组渲染
```

关键：**现状没有 Selection/RepositoryRef/BackendRegistry**。`st.snapshot.repo` 只是 `{owner,name}` 纯 GitHub 形；未携带 `backend`、`refId`、`Selection`。`st.cwd` 是唯一 per-workspace 隔离键（`snapshotByCwd` 46-58 + `repoKey` 按 cwd 缓存）。

### 2.2 多后端化后目标路径（#125 契约已定，只待接线）

```
第三方/内置 register(mod) → trackerRegistry.modules()
  ↓ select(handle, OpContext{ cwd, signal, fs, platform … })  — 三级联 explicit>matches(并行 allSettled 3000ms + multiHit)>fallback→null
  ↓ describe(handle, backendId) → RepositoryRef { backend, refId, name, url }  (恒非空 backendId)
  ↓ buildSnapshot(cwd) 改造点：首步调 registry.select → 得 Selection{backendId, source, ref, multiHit, pending} → 按 backendId 取对应 Tracker 实现拉 maps/issues → 组装 snapshot { repository: RepositoryRef, selection: Selection, ...deck投影 }  (新增字段，不破坏既有 repo/issues/maps)
  ↓ RPC: wf.snapshot/wf.status 增量字段  (pending diagnostic)
  ↓ client: store.js 新增 st.selection / st.repositoryRef (per-cwd)，hydrateFromCache 按 cwd 隔离
  ↓ UI 消费：StatusBar(徽标) + Dock header(repo chip 换后端 label) + Settings(选择器/bound) + ListTab/MapDetail/IssueDetail(能力字段仍按 §2 ②，但 headline 加 backend 胶囊) + 引导流(与 #118 衔接：pending/multiHit→引导)
```

存储：`#119 Notes` 约束 per-workspace 覆盖 = `registry.bind(handle, backendId)` → 宿主持久化（host 侧 file 或 DSH settings，待 #154 定），client 仅写 `host.call('wf.bind', …{cwd, backendId})`。

隔离不变：`cwd` 仍是隔离键，只把 `repoKey` 从 `owner/name` 换成 `RepositoryRef.refId + backend`；`shared/stores` 分组与 #45 串台修复（`probeNow refreshGroup(cwd)` 275-353）继续适用。

### 2.3 G5 / wf.status 的消费点

- 现状 `wf.status` 返回 9 checks (`src/host/index.js:938-967`)：`Repo located / Setup run / Tracker=GitHub / gh CLI / gh auth / API / wayfinder / ask-matt / Core suite`。其中第 3 项 `checkTracker` 800行 `checkTracker` 仅读 `docs/agents/issue-tracker.md` 是否含 GitHub 模板 — **单后端假设**，多后端后需改为 "tracker = 当前 Selection.backendId 对应 label" 或通用 "tracker resolved"。
- G5 能力视图：现状 host 未下发能力视图；定版后 host 将随 `wf.status`/`wf.snapshot` 下发「每个字段填/空的诊断表」供日志/ChecksTab 诊断区展示，**不进入 `st.snapshot.issues[].labels` 等渲染分支**（`shape.js:89` customFields 说明性元数据绝不驱动 deck 逻辑）。客户端仅新增一个诊断面板/日志入口，不改 `ListTab issueRow` 的隐藏逻辑。

## 3. UI 触点清单（文件:行 + 现状 + 判定）

> 判定列：🔴 必须改 | 🟢 天然覆盖 | 🟡 待定（由 #154 G 票决定是否新增显示）

### 3.1 设置面板（SettingsPage.js — 契约：用户覆盖入口）

| # | 文件:行 | 触点（现状） | 多后端影响 | 判定 |
|---|---|---|---|---|
| S-1 | `src/client/views/SettingsPage.js:192-224` | 标题+打开位置+面板宽度+开始模板/动作模板编辑器；**无后端选择 UI** | 需新增「后端选择」区：展示 `registry.modules()` id/label 列表 + 当前 `selection {backendId, source}` + per-workspace 覆盖（`bind`/`bound`）入口 + 覆盖来源提示（explicit vs matches vs fallback） | 🔴 必须改 |
| S-2 | `src/client/views/SettingsPage.js:192` `cfg`/`templates` localStorage (config.js:9-26) | 设置以 `dsws.cfg` / `dsws.templates` 存 localStorage（全局，不按 cwd 隔离） | 后端覆盖必须 **per-workspace**，不能走全局 localStorage。需新增 host 持久化（`wf.bind` 驱动）并在 client 存 `perCwd{ [cwd]: backendId }` 或纯 host 侧 | 🔴 必须改 |
| S-3 | `src/client/views/SettingsPage.js:18-19` `TPL_NAMES` / `TPL_DESC` | 模板文案写死，不涉及后端 | 与后端无关，天然无关 | 🟢 天然覆盖（无需动） |

**溢出**：`#118` 探测流产「结果+状态」，本票消费的 "unknown/unbound" 状态提示（引导去设置页选择）与 `SettingsPage` 的跳转入口联动，待 G 票定文案。

### 3.2 状态栏（StatusBar.js + Seg.js + checksums.js + kernel/store.js）

| # | 文件:行 | 触点（现状） | 多后端影响 | 判定 |
|---|---|---|---|---|
| B-1 | `src/client/statusbar/StatusBar.js:80-85` `csx = checksumsOf(s)` → `fr/bugN/triageN/n/timeStr` + `seg` 渲染 | 状态栏仅展示 **数据类 KPI**（可接/占用/Bug/诊断/环境），**无后端标识** | 需新增 **后端胶囊**：`selection.backendId` → `labelOf(backendId) ?? backendId`（末知后端原串不分支，#119 Notes）+ `repositoryRef.name/url` 短名；空 `backendId:null` → 显示 `Other`（#125 `labelOf(null)`）但用中性色 | 🔴 必须改 |
| B-2 | `src/client/statusbar/StatusBar.js:242-316` `capsule` 折叠 (`applyFold` data-fold-priority 1-10) | 现有优先级 1-10 已含品牌/可接/Bug/诊断/沉淀/交接/issuePath/环境/刷新/技能列表；新增后端段需插优先级 | 新增后端胶囊 data-fold-priority 建议 2-3（仅次品牌），不影响现有折叠曲线；宽度 `iw` 随输入区自适应，天然可扩展 | 🔴 必须改（新增段），折叠逻辑本身 🟢 天然覆盖 |
| B-3 | `src/client/statusbar/StatusBar.js:275-307` `issuePath` 胶囊（当前 #N） | 胶囊文字 `#${current}` / `--`，与后端无关；现状已按空值分支（`s.issuePath.current ? '#N' : '--'`） | 多后端后 `issuePath.current` 语义仍是全局 `key`，不同后端 `key` 格式不同（`number` vs markdown `<NN>-slug` vs GitLab `iid`），但显示仍是 `key` 字符串，天然覆盖（不分支）。若需按后端着色，待定 | 🟢 天然覆盖（显示）；🟡 待定（着色/超链） |
| B-4 | `src/client/statusbar/StatusBar.js:310` `envLabel(n/t)` (`kernel/probe.js:44-46`) | 环境 `n/t` 来自 `wf.status` checks（当前 9 项均为 GitHub/gh 假设） | 多后端后 `checkTracker` 等需泛化，文案由「GitHub」→「Tracker」；数目不变或增 one check（后端可达），属 #118 探测流，本票只消费呈现 | 🔴 必须改（#118 T152 落地时），本票 🟡 标记 |
| B-5 | `src/client/statusbar/Seg.js:8-10` `seg()` 原语 | 纯渲染原语，传什么 icon/label/color 即显什么 | 后端徽标将复用 `seg('github'|'file'|'gitlab'|… , label, color, onClick)`，**零改** | 🟢 天然覆盖 |
| B-6 | `src/client/kernel/probe.js:44-46` + `src/client/statusBar/checksums.js` | `isOccupied / occCount / frontierCount` 按 `assignees + blockedBy` 算可接/占用，与后端无关 | 不同后端的 `assignees` 可能 MISSING（indeterminate 不计 frontier，`shape.js:162`），现有 `isOccupied` 已处理 `assignees.length` 空 → 非占用，计数语义天然符合契约 | 🟢 天然覆盖 |

**数据流**：`StatusBar.js:53-75` 已正确按 `sid→summaryCwd→st.cwd→loadChecks/loadSnapshot` 同步 cwd，多后端后只需在 `loadSnapshot` 后额外 `host.call('wf.selection'…{cwd})` 或从 `snapshot.selection` 取值（两种形态待 G 票择一），现有同步机制天然复用。

### 3.3 右侧面板 — 壳与导航（Dock.js + kernel/store.js + panel/Overlay.js）

| # | 文件:行 | 触点（现状） | 多后端影响 | 判定 |
|---|---|---|---|---|
| P-1 | `src/client/panel/Dock.js:190-200` 头部仓库芯片 `s.snapshot.repo.owner/name → https://github.com/…` | 写死 GitHub URL + `owner/name` 形，只认单一后端 | 需改造：`repositoryRef.url || ''` 为空则不链（`shape.js:149 url 本地 ''`）；`name` 来自 `describe` 的 `name`；badge 色按 `backendId` 映射（github 紫 / markdown 绿 / gitlab 橙 / other 灰） | 🔴 必须改 |
| P-2 | `src/client/panel/Dock.js:204-205` `tabs` 行（ListTab/Skills/Checks） | 与后端无关 | 🟢 天然覆盖 | 🟢 天然覆盖 |
| P-3 | `src/client/kernel/store.js:184-200` `shared/stores` + `snapshotByCwd` + `issuePath` | 已有 per-cwd 隔离与串台修复（#45），hydration 按 cwd | 多后端后 `selection` 同为 per-cwd，天然复用此机，不另新增隔离层 | 🟢 天然覆盖 |

### 3.4 右侧面板 — 列表（ListTab.js + TicketRow.js）

| # | 文件:行 | 触点 | 判定 | 说明 |
|---|---|---|---|---|
| L-1 | `src/client/views/ListTab.js:150-219` `issueRow(x)` 标题行 + 圆环 + 标签行 | **标题/state/圆环** 属核心字段，永远存在，天然显 | 🟢 天然覆盖 | `title/state/body/url` 空 `''` 则标题空/链接空，但 ListTab 直接 `String(x.title)` 显空串，不崩；契约要求后端补 `''`，UI 不守卫 |
| L-2 | `src/client/views/ListTab.js:194-199` 标签 chips `labels.map → hexA/darken` | 现状 ` (x.labels||[])` 空则零 chip，自然不渲染 | 🟢 天然覆盖 | MISSING（字段省略）vs EMPTY（`[]`）皆为零 chip，符合 §2 ②。日志二分：host 空→后端未给；host 有→前端渲染 |
| L-3 | `src/client/views/ListTab.js:200` 被阻塞 chip `blockOf` | `blockedBy` 空或全 CLOSED → 不显锁，自然隐藏 | 🟢 天然覆盖 | `blockedBy` MISSING（不支持依赖图）→ `[]`→无 chip；`shape.js:119` blocking 不得作为 Issue 字段，仅通过 blockedBy 派生，已遵守 |
| L-4 | `src/client/views/ListTab.js:202-210` 行级动作 `mkRowAction` + map 完成态 `ringOf` | 与后端无关（按 label 选动作），天然跨后端 | 🟢 天然覆盖 | 若 markdown 后端无 assignee 能力，`actionColorOf` 仍按 label 着色，无分支 |
| L-5 | `src/client/views/ListTab.js:177-178` `isMap = has(wayfinder:map)` 边框高亮 | 标签驱动高亮，若某后端无 `labels` 能力（MISSING），`isMap` 恒 false → 地图误判为普通票 | 🔴 必须改（需 G 票决策） | `IssueType type='map'` 是核心字段永远存在（`shape.js:123`），正确判定应走 `x.type==='map'` 而非 `hasLabel`，现状写死标签口径属单后端遗留 |
| L-6 | `src/client/views/TicketRow.js:7-40` 票务行（map 详情内） | 同 L-2/L-3，标签/阻塞皆 `length` 分支 | 🟢 天然覆盖 |  |
| L-7 | `src/client/views/ListTab.js:84-99` `isMapIssue` / `findMap` / 过滤 | 同 L-5 | 🔴 必须改 |  |

### 3.5 右侧面板 — 地图详情（MapDetail.js）

| # | 文件:行 | 触点 | 判定 |
|---|---|---|---|
| M-1 | `src/client/views/MapDetail.js:67-101` 节点 `ic = type→icon` / `claimedBy` / `blocked` / `tProgressBar` | `claimedBy` 来自 `ticket.claimedBy`（由 assignees 派生），`blocked` 来自 `blockedBy.some(openBlocker)`，皆 `length` 分支 | 🟢 天然覆盖 |
| M-2 | `src/client/views/MapDetail.js:180` Destination `mdToHtml(m.destination)` | 核心字段，天然显 | 🟢 天然覆盖 |

### 3.6 右侧面板 — Issue 详情（IssueDetail.js）

| # | 文件:行 | 触点 | 判定 | 能力字段去向 |
|---|---|---|---|---|
| I-1 | `src/client/views/IssueDetail.js:84-147` 标签/assignees/state 芯片行 | 皆 ` (labels\|\|[]).map` / `(assignees\|\|[]).map` 空 → 零芯片 | 🟢 天然覆盖 | `labels` / `assignees` |
| I-2 | `src/client/views/IssueDetail.js:155-159` body `mdToHtml(body)` | body 核心字段，空 `''` → `无描述` | 🟢 天然覆盖 | `body` |
| I-3 | `src/client/views/IssueDetail.js:162-174` sub-issues 列表 | `subIssues.totalCount / nodes` 空 → 零行，不崩 | 🟢 天然覆盖 | `tickets` (MapNode) — MISSING 不作空缺，契约要求 `[]` EMPTY |
| I-4 | `src/client/views/IssueDetail.js:176-187` 被阻塞 `blockedBy` | 空→不显 | 🟢 天然覆盖 | `blockedBy` |
| I-5 | `src/client/views/IssueDetail.js:191-204` 评论 `comments` | 空→`无评论` | 🟢 天然覆盖 | `comments` |
| I-6 | `src/client/views/IssueDetail.js:136-134` header 中 `assignees` 展开 | 同 I-1 | 🟢 天然覆盖 | `author/assignees` |
| I-7 | `src/client/views/IssueDetail.js:—` **缺失的字段渲染**：`author` / `milestone` / `customFields` / `reason` / `closedAt` / `parentKey` | 现状 **未渲染**这些字段的独立 UI；多后端后若某后端填这些字段，需决定是否新增区块 | 🟡 待定 | `author` / `milestone` / `customFields` / `reason` / `parentKey` |

### 3.7 其余视图

| # | 文件:行 | 触点 | 判定 |
|---|---|---|---|
| N-1 | `src/client/views/NoRepoCard.js:6-103` 无仓库红卡（checkRepo bad 且未 dismiss） | `checkRepo` 现仅 `parseGithubRepo(url)`，非 GitHub `warn` 而 Git 空 `bad` → 红卡 | 🔴 必须改 | 多后端后 "无仓库" 应泛为 "无后端/未选择后端" 卡，文案与触发条件（`selection.backendId===null && pending===false` → OtherCard）需与设置页联动 |
| N-2 | `src/client/views/ChecksTab.js:6-118` 环境检查分组 | 9 checks 中 `checkTracker`/`checkRepo` 梏死 GitHub 模板；`probeSkill` 与后端无关 | 🔴 必须改（checkTracker 泛化） |
| N-3 | `src/client/views/shared/chips.js:7-16` Dot/TypeChip | 按 `type` 文案/色，纯展示 | 🟢 天然覆盖 | research/prototype/grilling/task 皆后端无关类型，不随后端变 |

### 3.8 能力视图（G5）消费点

- **现状**：零消费点。host 未下发能力视图，client 无 `capabilities` 字段，`ChecksTab` 仅展示 9 项 `wf.status` checks。
- **定版后**：host 随 `wf.status` 增量字段 `capabilities: { labels:'supported'|'unsupported', assignees:… }` 或随 `wf.snapshot` 在 `snapshot.deck` 边缘下发 `fieldPresence: { labels: { present: N, empty: M } }`，仅作诊断卡/日志。UI 不据此隐藏任何区块（§2 ②），故 **不新增任何 if(capability) 分支**，只新增一个折叠的诊断区（ChecksTab 底部或设置页底部）。

## 4. 逐字段判定总表（shape.js 契约 → UI 渲染）

| 字段 | 种类 | 典型渲染处 | 现状空值分支 | 多后端判定 |
|---|---|---|---|---|
| `key` | 核心 | ListTab `#{number}` → 将改为 `#{key}` (待后端切换) | `String(key)` 显空不崩 | 🔴 必须改（key 形态随后端变，当前写死 number） |
| `type` | 核心 | MapDetail icon 分叉 | 不存在即 other | 🟢 天然覆盖（但 L-5 的 label 误用需改类型口径） |
| `title` | 核心 | TicketRow/ListTab/IssueDetail title | `|| '#'+key` | 🟢 天然覆盖 |
| `state` | 核心 | state chip (open/closed) | 默认 OPEN 分支 | 🟢 天然覆盖 |
| `body` | 核心 | IssueDetail md | `|| 无描述` | 🟢 天然覆盖 |
| `url` | 核心 | 外链 href | `''` → 无 href，不链 | 🟢 天然覆盖 |
| `createdAt/updatedAt` | 核心 | IssueDetail 时间 `slice(0,10)` | `''` → 不显 | 🟢 天然覆盖 |
| `closedAt` | 核心 | 未显 | `null` → 不显 | 🟡 待定（是否需显关闭时间） |
| `parentKey` | 核心 | MapDetail 归属 | `null` → 孤儿→ issues 列表 | 🟢 天然覆盖 |
| `author` | 能力 | IssueDetail 未显 | `undefined` → 不显 | 🟡 待定（是否新增 author 区块） |
| `assignees` | 能力 | IssueDetail/ListTab `claimedBy` | `[]`→未认领 / `undefined`→indeterminate(不计 frontier) | 🟢 天然覆盖（计数已按 indeterminate 排除） |
| `labels` | 能力 | Chips | `[]`→零 chip / `undefined`→零 chip | 🟢 天然覆盖 |
| `milestone` | 能力 | 未显 | `undefined`→不显 | 🟡 待定 |
| `customFields` | 能力 | 未显（说明性元数据绝不驱动 deck 逻辑 shape.js:89） | `undefined`→不显 | 🟡 待定（大概率 Out of scope — deck 逻辑绝不驱动） |
| `reason` | 能力 | 未显 | `''`/`undefined`→不显 | 🟡 待定 |
| `blockedBy` | 能力 | ListTab/MapDetail/IssueDetail 锁 chip | `[]`→不显 / `undefined`→不显 | 🟢 天然覆盖 |
| `comments` | 能力 | IssueDetail 评论 | `[]`→无评论 | 🟢 天然覆盖 |
| `tickets` (MapNode) | 核心 | MapDetail 层 | `[]`→空层 | 🟢 天然覆盖 |

**结论**：13/17 字段属 🟢 天然覆盖（空值按现有渲染逻辑已正确处理，无需改）；1 处 🔴 热（`key`/`wayfinder:map` 标签口径硬编码），1 处 🔴 批发（设置/状态栏/仓库头无后端），4 处 🟡 待 G 票拍「是否新增区块」（大概率保持不新增以守 §2 不新增隐藏逻辑）。

## 5. 必须改清单（#154 G 票前置输入）

1. **设置面板后端选择器** (`SettingsPage.js:192`)：新增选择 UI + per-workspace `bind` 存储（host 持久化，受 #125 `registry.bind/on('bind')` 约束）。
2. **状态栏后端胶囊** (`StatusBar.js:242` capsule / `Seg.js:8`)：新增 `selection → labelOf` 徽标段 + pending/multiHit 态可视化（与 #118 引导衔接）。
3. **Dock 头部仓库芯片** (`Dock.js:192`)：`owner/name → RepositoryRef.name + url`，空 url 不链，按 backend 着色。
4. **列表 key 化 + 类型判定** (`ListTab.js:150` + `TicketRow.js:7`)：`#{number}` → `#{key}`（或 `#{displayKey}` 保持 `#` 前缀），`isMap = hasLabel` → `x.type==='map'`。
5. **无后端态**：`NoRepoCard` 泛化为 `OtherCard / PendingCard`（`backendId:null` / `pending:true`），复用现有卡容器。
6. **wf.status 泛化** (`host/index.js:854 checkTracker`)：`Tracker=GitHub` → `Tracker={backendId}`，多后端后不再读 `issue-tracker.md` 硬判 GitHub。
7. **快照 Selection 下发** (`host/index.js:1023 wf.snapshot`)：增 `selection/repository` 字段，client 同 cwd 水合。

## 6. 天然覆盖清单（零改直通）

所有能力字段的 `[]`/`''` 空分支：标签、指派/认领、阻塞、评论、body、时间等。`Dock.js` 隔离、`store.js` 串台修复、`Seg.js` 原语皆零改。G5 诊断视图不进渲染分支，天然守住 §2。

## 7. 待定（交 #154 G 票拍板）

- `author/milestone/customFields/reason/closedAt/parentKey` 是否新增 Issue 详情区块（建议：`author` 可显，余者暂 Out of scope，守「不新增隐藏逻辑」）。
- `key` 显示形态：是否保留数字井号 `#N` 伪装（markdown `/NN` / gitlab `!iid` 如何显示）。
- `pending` 态的 loading 文案（等待探测 vs 引导选择）。
- `multiHit` 态是否在状态栏/设置页露出多后端并列及“建议绑定”。
- 能力视图诊断区落何处（ChecksTab 底 vs 设置页底 vs 折叠日志流）。

## 8. 与 #118 探测/引导的分工边界

- #118 产「结果+状态」：`Selection.pending/multiHit + per-workspace backend status + 三步引导（Step1 探测 / Step2 修复 / Step3 接通）`。
- 本票消费其 UI 呈现：设置页/状态栏/面板仅 **显示** `pending` 等待、`multiHit` 建议绑定、`null` 时 OtherCard，不复算探测逻辑（`#118 notes: 探测 = 中间系统层`）。

## 9. 校验与风险

- **已校验**：`src/host/index.js` 60s cache + disk cache + #45 per-cwd 隔离（`probeNow 276-353`）真实可对 `selection` 同隔离；`contract §2` 日志二分路径可行（host 记 EMPTY/MISSING，client 记渲染/隐藏）。
- **风险**：`ListTab key` 改动是全局键波动面大（`#N` 展示、`#` 锚点、`issuePath` 存储），需 G 票先收敛「显示 key 还是保留 number」再动。
- **遗留雾**：选择器交互形态（下拉 vs 卡片）、状态栏徽标点击行为（展开选择 vs 跳设置页）、per-workspace 覆盖存储选型（host fs vs DSH settings）→ 皆在 #154 一次评审落定。

---
*下一步：本报告 → #154「讨论：后端选择 UI 实现方案」一次评审输入；#154 Answer 落定逐字段显示决定表与选择器形态。*
