# 研究：契约层与快照层若增 PR 实体的冲击面（#291）

> 范围：评估在分层契约中引入 Pull Request（GitHub PR / GitLab MR）实体，对现有 shape / contract / snapshot / 前端复用与多后端退化的冲击。仅以 primary sources 行号为据，不做代码落地。
> 分支 `research/291-contract-impact` · 文件 `research/291-contract-snapshot-impact.md` · 对应 #288 子任务

## 0. 现状锚点（第一性，不可在此票内推翻）

| 层 | 文件与行号 | 不变量 |
|---|---|---|
| 契约形状 | `src/shared/tracker/shape.js:108-140` Issue | 核心字段 key/type/title/state/body/url/createdAt/updatedAt/closedAt/parentKey 永远存在（缺则 ''/null）；能力字段 author/assignees/labels/milestone/customFields/reason/blockedBy/comments 可 MISSING（省略）或 EMPTY（[]/''） |
| 类型 | `src/shared/tracker/constants.js:33-36` ISSUE_TYPE | 仅 `issue | map` 两值（wayfinder 语义），RepositoryRef.backend 为开放 string 非枚举 |
| key | `src/shared/tracker/shape.js:122` + `src/host/tracker/backends/github/normalize.js:82-88` | key = String(number) 仓库内唯一；harness 断言不产出 number 字段 |
| 契约操作 | `src/host/tracker/contract.js:54-60` OPERATIONS | 15 个动词，无 detect / snapshot / children；能力 = 事后调用结果，缺方法由 registry.js:41-47 Proxy 补桩返回 unsupported，无能力表/无能力缓存（G5） |
| 快照编排 | `src/host/tracker/snapshot.js:22-42,56-112` | assembleSnapshot(repo, all) 按 parentKey 分桶 → maps(type==='map') 附 tickets → issues(未挂非 map)；deck 由 deriveDeck 纯函数派生，后端绝不存 deck；非 op |
| 缓存 | `snapshot.js:60-67` | snapCache key= backendId:refId LRU20 TTL 5s；depsCache key= backendId:refId#key；仅缓存 ok:true 数据，unsupported 透传不缓存 |
| GitHub 读 | `queries.js:14-47` + `normalize.js:82-218` + `issues.js:36-102` | LIST_QUERY 拉 issues(states:[OPEN,CLOSED])，内存过滤 type/state/parentKey/keys；normalize 恒 EMPTY（labels/assignees/comments/blockedBy 为 []） |
| 前端消费 | `src/client/views/ListTab.js:67-203` | 按 snapshot.issues/maps 排序/过滤/标签统计，展示 #key，blockOf 依赖 blockedBy 派生；未感知 PR |

---

## 1. 核心冲突：号码同域

GitHub/GitLab 的 Issue 与 PR/MR 共享同一数字命名空间：同一个 number 既可能是 issue 也可能是 PR，在 API 上为不同 GraphQL 节点（issue(number:) vs pullRequest(number:)），REST 为不同路径（/issues/ vs /pulls/）。而现状 key = String(number) 假设仓库内唯一且与类型无关（shape.js:122），一旦引入 PR，若仍用裸 number 作 key，#42 同时对应 issue 42 与 PR 42 会发生键冲突：

- assembleSnapshot 的 byParent 与 attached Set 按 key 聚合（snapshot.js:36）会把同号异类误合并；
- deriveDeck 的全局 byKey Map（deck-derive.js:114-118）以 key 去重，重复 key 会静默丢失其一；
- depsCache / snapCache 键不含类型，getDependencies 与快照派生会串扰；
- 前端 blockOf.byNum（ListTab.js:122）等按 number 字典同样冲突。

因此任何 PR 方案都必须回答“如何让 (refId, key, kind) 三元组全局唯一”，否则即违反“全局身份 = (RepositoryRef, key)”（shape.js:122 注释）的独一性。

---

## 2. 两种草案

### 草案 A — 复用 Issue，加扩展字段

```js
// shape.js: Issue 追加可选字段，不新增实体
// @property {boolean} [isPR]        // 是否为 PR（能力字段，MISSING = 未知/不支持）
// @property {string|null} [mergedAt] // 合并时间，null=未合并；MISSING=不支持
// @property {string} [reviewState]   // open 的细分：open / merged / draft …（开放 string）按 EMPTY '' 兜底
// ISSUE_TYPE 保持 issue|map 不变
```

- 契约操作：不新增 OPERATIONS，复用 list(repo, filter) 与 get(repo, key)，filter 增 kind?: 'issue'|'pr'|'all' 透传；GitHub 后端在 normalize 阶段把 PR 节点并入同一 Issue 阵列（加 isPR=true），未实现的后端返回 MISSING（省略字段，UI 按现有“空值不渲染”自然覆盖）。
- 快照：assembleSnapshot 与 deriveDeck 不新增分区，PR 随 Issue 同池；如需 PR 独立视图，UI 侧以 isPR 过滤而非快照分片。snapCache 键保持 backendId:refId 不变，因 PR 与 Issue 同一次 list 拉回，无需后缀。
- GitHub 增量：queries 新增 PR_FRAGMENT 与 pullRequests 分页查询；normalize 新增 isPR/mergedAt/reviewState；issues.js 在 list 中并发拉 issues + pullRequests 后合并归一。

### 草案 B — 新增 PullRequest 独立实体与集合

```js
// shape.js 新增
// @typedef {Object} PullRequest  // 与 Issue 并列，核心字段同款（key/type/state/body/url/...）+ 合并态
// @property {string} key  // 独立命名空间：建议 pr-<number> 或保留 number 但与 Issue 分桶
// @property {'pr'} type   // 新增 PR 类型，或保持开放 string
// Snapshot 扩展：{ repository, maps, issues, pullRequests: PullRequest[], deck, prDeck? }
```

- 契约操作：新增 listPR / getPR / getPRDependencies（或统一为 list({kind:'pr'}) 但契约上新增动词），进入 OPERATIONS。未实现后端由 Proxy 桩返回 unsupported。
- 快照：新增 PR 分区与独立派生（prDeck 或复用 deriveDeck 但入参分开），缓存需分片：snapCache 拆为 backendId:refId:issues 与 backendId:refId:prs（或后缀），否则同 key 缓存污染。
- GitHub 增量：独立 PR queries/normalize/issues 文件（或复用但分流），与 Issue 管道物理隔离。

---

## 3. 对比表

| 维度 | 草案 A：复用 Issue + 扩展字段 | 草案 B：独立 PullRequest 实体 |
|---|---|---|
| shape 冲击 | 最小：Issue 加 3 可选能力字段（MISSING/EMPTY 兼容），ISSUE_TYPE 不动；风险是语义稀释（issue 承载 PR 语义） | 最大：新增 top-level 类型与 Snapshot 字段，全链路 shape 版本需 +1，ISSUE_TYPE 需扩或新增 PR 类型常量 |
| key 同域 | 未治本：仍 String(number)，同号异类需靠 isPR 区分，但 assemble/derive/deps 的 key 索引仍冲突；补救只能在归一层改 key 为 pr- 前缀（即隐式 B）或在 derive 前去重策略加 kind 分桶 | 治本：key 命名空间显式分离（pr-42 vs 42），assemble/derive/deps 天然隔离 |
| OPERATIONS 零能力表原则 | 兼容：不新增动词，复用 list/get 加 filter.kind；unsupported 语义保持“字段缺省 = MISSING”，不触发能力表；符合 contract.js:5-6 能力事后事实无能力表 | 冲突放大：新增 2-3 个动词，OPERATIONS 从 15 膨胀，未实现后端（markdown 无 PR、gitlab MR 形态独立）全部走 unsupported 桩；虽不违 G5（仍为运行时 unsupported），但能力维度翻倍，调用方需分支，违背 UI 不分支空值自然覆盖 |
| snapCache 键策略 | 保持 backendId:refId 即可（一次 list 合并返回）；若 PR 单独拉取则仍需分片，但 A 的卖点就是合批免分片 | 必须分片：issues 与 prs 分键或后缀，否则同 refId 覆盖；TTL 需独立或联合失效，invalidateSnapshot 需双清 |
| assembleSnapshot / deriveDeck | 不扩展分区，PR 混入 issues 池；deck 复用一套（frontier/blocked 等对 PR 语义不准，但 A 本就不承诺 PR 进 deck）；改动点最少 | 需扩展：assemble 加 pr 分区，derive 需决定 pr 是否进 deck（若进则 frontier/claimed 对 PR 含义不同，需新派生规则；若不进则需独立 prDeck 与合并展示） |
| ListTab / IssueDetail 复用度 | 高复用：列表加一枚 isPR 胶囊与 mergedAt 角标即可，过滤沿用现有 label/state 过滤；IssueDetail 复用同一详情组件，PR 特有区（reviewState/merge 按钮）按字段存在与否显隐（MISSING 即不渲染，天然满足行不存在即不误导） | 低复用：需新增 PRTab 或在 ListTab 上加分栏/分片缓存，IssueDetail 需分支为 PRDetail（或大量条件渲染），复用即分支成本高 |
| queries / normalize / issues 最小增量 | 小：queries 加 prFragment + pullRequests 查询（可复用 ISSUE_FRAGMENT 字段子集）；normalize 加 isPR/mergedAt 映射；issues.js list 加并发合并 | 大：复制一套 prQueries/prNormalize/prIssues，或在现有三文件内大段分支；GitLab MR 字段（iid vs number、state=opened/merged）需独立归一，复用收益低 |
| 多后端退化 | 优：markdown 天然 MISSING（无 PR 概念）→ 字段省略，UI 按空值不渲染空态，无需后端物理隔离分支；gitlab MR 可先以 MISSING 退化，后续真实现 PR 时再补能力字段，平滑 | 差：markdown 对 listPR/getPR 恒 unsupported（桩返回），前端必须按 unsupported 空态 + 提示该后端不支持 PR 分支，行不存在但需显式提示，否则误导无 PR；gitlab 需单独 MR 管道，B 的独立实体反而更贴合 GitLab 但与 GitHub 复用态矛盾 |
| harness / 兼容性 | 兼容：不产出 number，key 仍 String(number)，shape 版本可保持 1（仅加可选字段）；harness no number 与 labels EMPTY 断言不受影响 | 破坏面大：若 key 改 pr-42 则现有 key 假设破裂；若 snapshot 新增 pullRequests 字段则 harness 快照结构断言需更新 |

---

## 4. 推荐方案与最小增量清单

推荐：草案 A（复用 Issue 加扩展字段）作为第一阶段，预留 B 的 key 前缀逃生口。

理由：与现有“零能力表、空值自然覆盖、后端不存 deck”三不变量一致，改动最小而收益可验证；B 的独立实体在 GitLab MR 场景更干净，但对 GitHub 同域号码与前端复用度冲击过大，宜待 PR 能力真有独立 deck/写操作诉求时再分拆。

### 4.1 推荐形态（A 的收敛版）

- shape.js：Issue 新增三个能力字段（可 MISSING）：
  - isPR?: boolean — 是否为 PR/MR（MISSING = 该后端不支持 PR 区分；EMPTY 不适用，boolean 以省略表 MISSING）
  - mergedAt?: string|null — 合并时间（GitHub PR 的 mergedAt，MISSING=不支持，null=未合并）
  - reviewState?: string — 开放 string（approved / changes_requested / draft / ''），MISSING=不支持
  - 不动 ISSUE_TYPE，不动 key 生成规则；若实测同号冲突，则在 GitHub normalize 层将 PR 的 key 改为 pr- 前缀（A 向 B 的最小前缀逃生，仅归一层改，shape 仍称 key 为 string）。

- contract.js：不新增 OPERATIONS。复用 list(repo, filter, ctx) / get(repo, key, opts, ctx)，filter 增加可选 kind?: 'issue'|'pr'|'all'（默认 all，保持向后兼容）。GitHub 对 kind 做服务端/内存两级过滤；markdown/gitlab 不支持 pr 时返回空集或字段 MISSING，不抛 unsupported（列表空态自然呈现）。

- snapshot.js：不新增分区。PR 随 Issue 同池进 assembleSnapshot；如前端需 PR 独立列表，UI 侧以 isPR 过滤。snapCache 键保持 backendId:refId；若后续改为 PR 单独拉取，再引入分片键 backendId:refId:pr，当前阶段不分片。

### 4.2 最小增量清单（按文件）

| 文件 | 改动 | 需否 |
|---|---|---|
| src/shared/tracker/constants.js | 无需新增 ISSUE_TYPE_PR；若确需分支可加 PR_KIND 常量，但 shape 的 isPR 已足够 | 可不改 |
| src/shared/tracker/shape.js:121-140 | Issue 加 isPR?, mergedAt?, reviewState? 能力字段注释（MISSING/EMPTY 约定），SHAPE_VERSION 1 维持或 2 | 必改 |
| src/host/tracker/contract.js:54-60 | OPERATIONS 不新增；ListFilter 加 kind? 类型注释 | 必改（仅类型） |
| src/host/tracker/backends/github/queries.js:14-30 | 新增 PR_FRAGMENT（复用 author/assignees/labels/milestone/comments/blockedBy 子集，加 mergedAt/isDraft/reviewDecision），新增 LIST_PRS_QUERY 与 GET_PR_QUERY | 必改 |
| src/host/tracker/backends/github/normalize.js:82-218 | 新增 isPR 派生、mergedAt/reviewState 映射；同号 key 前缀策略（仅 PR 侧加 pr-） | 必改 |
| src/host/tracker/backends/github/issues.js:36-102 | list 并发拉 issues+prs（Promise.all），归一后合并；get 先试 issue 再试 pr（或按 key 前缀路由）；filter.kind 内存过滤 | 必改 |
| src/host/tracker/snapshot.js:22-67 | 可不改；若 key 加前缀则 deriveDeck 的 byKey 天然隔离，无需改键策略。后续若拆 pr 缓存再加后缀分支 | 暂不改 |
| src/shared/tracker/deck-derive.js | 暂不改（PR 不进 deck 派生）；若 PR 需独立指标再加 prDeck | 暂不改 |
| src/client/views/ListTab.js | 加 isPR 胶囊、merged/draft 角标；过滤行加 kind 切换（复用现有 chips 机制） | 必改（UI） |
| src/client/views/IssueDetail.js | 复用同一详情，按 isPR 显隐 reviewState/mergedAt 区 | 必改（UI） |
| src/host/tracker/backends/markdown/* | 不改（字段天然 MISSING，UI 空态即诚实退化） | 不改 |
| src/host/tracker/backends/gitlab/* | 暂以 MISSING 退化；真接入 MR 时独立映射（iid→key，state opened/merged）复用同一 isPR 字段 | 后续 |

> 缓存分片说明：A 合批路径下 snapCache 维持单键 backendId:refId；depsCache 仍 backendId:refId#key，若 key 已加 pr- 前缀则天然区分，无需改键函数。

---

## 5. 风险清单

1. 同号串扰：裸 String(number) 在 A 下仍冲突，ListTab.blockOf（按 number 字典）与 deriveDeck.byKey 会串 PR 与 Issue。缓解：归一层对 PR 加 pr- 前缀；代价是 key 不再纯数字，IssueDetail 链接 issueUrl 需按前缀路由到 /pull/。
2. deck 语义污染：frontier/blocked/claimed 对 PR 无意义（PR 的阻塞是 review/CI 而非 blockedBy）。若 PR 混入 deck 池会污染 KPI。缓解：deriveDeck 统计时排除 isPR===true（或 PR 单独 prDeck）。
3. OPERATIONS 膨胀诱惑：一旦为 PR 新增 listPR/getPR，会诱发后续 PR 专有写操作（approve/merge/requestReview）进一步膨胀 OPERATIONS，违背契约动词克制原则。缓解：坚持复用 list/get + filter.kind，写操作沿用 update/comment + 能力字段。
4. 多后端语义分叉：GitLab MR 与 GitHub PR 字段不完全对齐（GitLab MR 有 merged_at/merge_status，GitHub PR 有 reviewDecision/isDraft）。若用同一 isPR/mergedAt/reviewState 承载，需在 normalize 层做方言归一，否则 MISSING/EMPTY 判定漂移。
5. markdown 空态误导：A 的 MISSING 退化虽无分支，但用户在 markdown 仓库看不到 PR 会误以为无 PR 而非不支持 PR。缓解：ListTab 的 kind=pr 过滤在 markdown 后端时显“该后端不支持 PR”弱提示（仅过滤器旁文案，不做能力分支）。
6. 快照片段缓存：若后续 PR 单独走一套快照（B），invalidateSnapshot 需双清，漏清会导致 PR 列表滞后 5s（TTL 内）。A 合批路径无此风险，但需约束后续不擅自分片。
7. harness 断言：shape 加可选字段不破 harness，但若改 key 前缀则 key=String(number) 断言需更新为 key=String(number) 或 pr-String(number)。

---

## 6. 结论

- 冲击面：PR 引入本质是“同域号码 + 跨后端形态分叉”双冲击，最大受影响点为 key 唯一性与 deck 派生语义，其次为 OPERATIONS 动词克制与 snapCache 分片。
- 推荐：首阶段采用草案 A（复用 Issue 加 isPR/mergedAt/reviewState 能力字段，复用 list/get 加 kind 过滤，单键快照不设分区），以最小增量验证 GitHub PR 读链路（queries/normalize/issues 三处）与前端复用（ListTab 胶囊 + IssueDetail 分区显隐），对 markdown/gitlab 保持 MISSING 空态诚实退化。
- 逃生：仅在实测同号冲突或 PR 需独立写操作时，启用 key 前缀 pr- 与 PR 单独拉取（即向 B 渐进），届时再引入 snapCache 分片键与 prDeck 派生。

---

## 7. 溯源

- shape/ISSUE_TYPE/key：src/shared/tracker/shape.js:32-33,108-140
- 常量：src/shared/tracker/constants.js:33-36
- 契约零能力表：src/host/tracker/contract.js:5-14,54-60 + src/host/tracker/registry.js:41-71
- 快照与缓存：src/host/tracker/snapshot.js:22-67,56-112
- 派生：src/shared/tracker/deck-derive.js:45-96,106-182
- GitHub 读链路：src/host/tracker/backends/github/queries.js:14-47, normalize.js:82-218, issues.js:36-142
- 前端消费：src/client/views/ListTab.js:67-203
- 多后端：src/host/tracker/backends/markdown/index.js:61-96 (setLabels unsupported), src/host/tracker/backends/gitlab/normalize.js:47-61

> 方法：静态读码 + 行号溯源，未改契约与实现；下一步由 #288 图定版是否进入 A 的最小增量实施。
