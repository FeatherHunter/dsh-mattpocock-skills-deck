# 研究：现行 buildSnapshot 与契约 snapshot.js 的差距（字段、缓存、回退）

> Ticket: [#310](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/310) — 研究：现行 buildSnapshot 与契约 snapshot.js 的差距（字段、缓存、回退）
> 分支: `research/snapshot-gap-310`
> 日期: 2026-08-28
> 范围: 只依据一手源码与落盘文件，不引用二手转述
> 关键词: buildSnapshot / createSnapshotComposer / shape.js EMPTY vs MISSING / CACHE_MS vs snapshotTtl / deriveDeck

---

## 摘要

现行`host/index.js#buildSnapshot`是**只走 GitHub**的直连路径：`git remote -> gh api -> GraphQL aliases -> 组装 maps/tickets/stats`。契约`host/tracker/snapshot.js#createSnapshotComposer`是**按后端分发**的编排层：`DetectionService.detect(cwd) -> selection.backendId -> registry.get(backendId).list(ref) -> Issue[] -> host 侧 deriveDeck`。

两者在四类维度上存在可度量的差距：

| 维度 | 现行 buildSnapshot | 契约 snapshot.js | 差距本质 |
|---|---|---|---|
| **字段** | GitHub 形（number/claimedBy/blocks/labels 为 string 名） | 契约形（key/type/title/state/body/url/createdAt/updatedAt/closedAt/parentKey 恒存在；author/assignees/labels/milestone/customFields/reason/blockedBy/comments 按 EMPTY`[]` vs MISSING 省略对齐） | 现行输出**不能直接被契约 UI 消费**，需映射层 |
| **缓存** | 内存`cache={ts,snapshot,error,cwd}` + 磁盘`.dsh-mattskillsdeck-cache/*.json`，TTL  `CACHE_MS=60000`，由`issueIndexFromSnapshot / fetchIssueIndex`校验 | 内存`snapCache` LRU20 + `depsCache`，TTL `snapshotTtl=5000` / `depsTtl=5000`，`fresh(at,ttl)` + `invalidateSnapshot`显式逐出，失败不缓存 | 时间、容量、失效语义均不同 |
| **回退** | 网络/配额时 GraphQL->REST 分级回退；`kind: 'auth'/'notfound'/'network'/'parse'/'graphql'/'rateLimit'`散落 | 统一`ERROR_KIND: env/auth/rate-limit/conflict/unsupported/not-found/network/parse`，能力缺失返`unsupported`、自环返`conflict`，失败一律`{ok:false,error}`不抛 | 分类体系与不抛语义不统一 |
| **deck** | host 侧`groupTickets + computeLevels`（基于`claimedBy:string`与`blockedBy:number[]`，只算`total/open/closed/frontier/claimed/blocked/levels/levelOf`） | 契约侧`deriveDeck`（基于`assignees:MISSING vs EMPTY`与`blockedBy:IssueRef[]`，产出`progressOf/labels/stats.total..indeterminate/levels/levelOf/blockedByKeys`，含 `indeterminate` 与 NOT-FOUND 安全 blocked） | 计算口径与输入形状不同，frontier 判定不一致 |

真实夹具`matt-demo-markdown-test1/.scratch/buy-luckin-coffee-plan`验证：markdown 后端`parseMd -> normalizeIssue -> list -> assembleSnapshot -> deriveDeck`链路可完整跑通；但现行 buildSnapshot **不读该夹具**，契约路径才覆盖本地 Markdown。

---

## 1 现行路径逐步（host/index.js#buildSnapshot）

> 源码主文件: `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/index.js` 全长 2852 行

### 1.1 配置与缓存基座

- 常量 `CACHE_MS = 60000`  (`src/host/index.js:47`)，另有 `STATUS_CACHE_MS = 30000` 供 `workspaceStore`（:48）。
- 内存缓存 `let cache = { ts: 0, snapshot: null, error: null, cwd: null }`（:58）。
- 磁盘缓存 `getCacheDir / cacheFileName / readDiskCache / writeDiskCache`（:557-601），目录为 `<cwd>/.dsh-mattskillsdeck-cache/`，落盘内容为`snapshot` JSON。
- 删除感知 `lastIssueIndexByRepo` + `issueIndexFromSnapshot / issueIndexChanged / rememberIssueIndex / cacheSnapshotIsCurrent`（:871-903），借`fetchIssueIndex`（:855-870）轻量索引发现删除/状态变化。

### 1.2 RPC 入口

- `wf.snapshot`（:1862-1884）：
  ```js
  if (cache.snapshot && cache.cwd === cwd) {
    const current = await cacheSnapshotIsCurrent(cache.snapshot, cwd)
    if (current === true || (current === null && now - cache.ts < CACHE_MS)) return cache.snapshot
  }
  const disk = await readDiskCache(repo0)
  if (disk) { const current = await cacheSnapshotIsCurrent(disk, cwd); if (current !== false) return adoptSnapshot(...); }
  const snap = await buildSnapshot(cwd, args && args.backendId)
  await writeDiskCache(snap.repo, snap)
  return adoptSnapshot(snap, cwd)
  ```
- `wf.refresh`（:1886-1899）：清 `ghPath` 缓存，强行 `buildSnapshot` 并落盘。
- `wf.probe`（:2112-2126）：以 `fetchIssueIndex` 全量索引作 `changed` 判断，`changed=true` 时把内存 `cache.ts=0` 失效。

### 1.3 buildSnapshot 内部（:1081-1255）——只走 GitHub

```js
async function buildSnapshot(cwd, hintBackendId) {
  const repo = await getRepoKey(cwd)           // :1084  三级：git remote get-url origin -> .git/config -> gh repo view
  const fi = await fetchIssues(cwd)            // :1086  gh api repos/.../issues?state=all  或  gh issue list 回退
  const mapsMeta = fi.issues.filter(x => x.state==='OPEN' && x.labels.some(l=>l.name==='wayfinder:map')) // :1088-1090
  let labels = []
  const fl = await runGh(['label','list','--json','name,color'], cwd) // :1093  全量标签
  const d = await fetchMapsDetail(mapsMeta.map(m=>m.number), cwd)    // :1101  GraphQL aliases 单次查全部 map
  // 逐 map 组装 tickets
  for (i...) {
    const subs = (issue.subIssues && issue.subIssues.nodes) || []      // :1111  取子票节点
    const tickets = subs.map(mapTicket)                                // :1112  归一为 number/state/claimedBy/blockedBy 等
    const bp = parseMapBody(issue.body)                                // :1113  Destination/Notes/Decisions...
    const lvInfo = computeLevels(tickets)                              // :1115  DAG 分层
    tickets.forEach(t=> t.level = lvInfo.byNumber[t.number])
    const stats = groupTickets(tickets)                                // :1117  frontier/claimed/blocked 统计
    maps.push({ number, title, state, url, labels: labels2, destination, notes, decisions, fog, outOfScope, tickets, stats })
  }
  // selection / repository / backendModules 增量 :1134-1236
  let selection = (await getDetectionService().detect({cwd}, {skipSkillProbes:true, hintBackendId})).selection
  if (!selection || (selection.backendId==null && selection.source!=='explicit'))
    selection = await reg.select(handle, ctxSel) // 裸 select 回退
  repository = reg.describe(handle, selection.backendId) // 再以 getRepoKey 兜底补 owner/name
  backendModules = reg.modules().map(m=>({id,label,presentation,links,capabilities,prompts,setupPrompt,openRepository}))
  return { ok:true, repo, repoRoot, updatedAt, generatedMs, env:{ghPath,ghError}, maps, issues, labels, fallback, repository, backendModules, selection, capabilities, viewer, viewerLogin }
}
```

关键helper：

- `fetchIssues`（:793-852）：优先 `gh api --paginate repos/{o}/{n}/issues?state=all`（带 `user.avatar_url`），回退 `gh issue list --state all --limit 500`。
- `fetchMapsDetail`（:961-990）：GraphQL aliases 拼查询（每 map 一别名），失败鉴别 `isRateLimitError` -> `fetchMapsDetailREST`（:911-951）降级（REST 逐 map + 逐子票查 `blocked_by`）。
- `mapTicket`（:701-718）：把 GraphQL 节点归一为 `{number,title,type,state,claimedBy,blockedBy,blocks,labels,url,progress,author}`，其中 `type` 由 `wayfinder:` 标签前缀推导，`claimedBy` 取 `assignees.nodes[0].login`，`blockedBy` 仅存 number。
- `parseMapBody`（:661-683）：按 `## Destination / Notes / Decisions so far / Not yet specified / Out of scope` 切片。
- `computeLevels`（:724-760）与 `groupTickets`（:762-778）：DAG 最长路径分层与 frontier/claimed/blocked 统计（见下）。

### 1.4 能力与 viewer 补充

- viewer 由 `tracker.getCurrentUser` 取得（:1138-1152），失败保持 null。
- `capabilities` 为 host 视角的 fill 计数（:1157-1170），字段集 `author/assignees/labels/milestone/customFields/reason/blockedBy/comments/closedAt`，统计 present/empty/missing。

---

## 2 契约路径逐步（host/tracker/snapshot.js#createSnapshotComposer）

> 源码: `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/snapshot.js` 全长 153 行；配合 `src/host/tracker/registry.js`, `src/host/tracker/contract.js`, `src/shared/tracker/shape.js`, `src/shared/tracker/deck-derive.js`

### 2.1 工厂与缓存

```js
export function createSnapshotComposer(registry, opts = {}) {
  const snapshotTtl = opts.snapshotTtl ?? 5000        // :57
  const depsTtl = opts.depsTtl ?? 5000                // :58
  const SNAP_LRU_MAX = 20                             // :59
  const snapCache = new Map() // backendId:refId -> {snapshot, version, at}  LRU20 :60
  const depsCache = new Map() // backendId:refId#key -> {data, at}      :64
}
```

- `fresh(e,ttl) => (Date.now()-e.at) < ttl`（:69）。
- `composeSnapshot` 支持 `o.force` 与 `o.ifNoneMatch`（etag 304）（:82-85）。

### 2.2 composeSnapshot（:76-113）

```js
async composeSnapshot(backendId, ref, ctx={}, o={}) {
  const tracker = registry.get(backendId)
  if (!tracker) return {ok:false, error:{kind:'unsupported', message:...}}
  const sk = snapKeyOf(backendId, ref)
  if (!o.force && fresh(cachedEntry, snapshotTtl)) return {ok:true, snapshot: cachedEntry.snapshot, cached:true}
  let all = null
  if (typeof tracker.snapshotFast === 'function') {
    const fast = await tracker.snapshotFast(ref, ctx)
    if (fast && fast.ok===true && Array.isArray(fast.data)) all = fast.data
  }
  if (!all) {
    const res = await tracker.list(ref, {}, ctx)       // 按后端分发
    if (!res.ok) return {ok:false, error: res.error}
    all = res.data                                     // Issue[]
  }
  if (!Array.isArray(all)) return {ok:false, error:{kind:'parse', ...}}
  const snapshot = assembleSnapshot(ref, all)
  snapshot.deck = deriveDeck(snapshot)                // host 侧纯函数派生
  snapshot.version = snapshotVersionOf(snapshot); snapshot.etag = ver
  touchSnapLRU(sk, {snapshot, version, at:Date.now()})
  return {ok:true, snapshot, version}
}
```

- `assembleSnapshot`（:22-42）：按 `type==='map'` 分拣，`byParent: Map<parentKey, Issue[]>` 挂一层 `tickets`，其余非 map 且未被挂载的为 `issues`（孤儿：破链/根票，map 节点本身不算孤儿）。
- `deriveDeck`（见 4）为 host 侧计算，后端绝不存 deck。
- `snapshotFast` 为可选旁路（contract.js :23-25 定版：非 op、不进验证，返回完整 Issue[] 才用，否则回落 list）。
- `getDependencies`（:119-131）：只缓存 `ok:true` 的边数据；`unsupported` 等一律不缓存，每次透传（G5 红线）。
- 显式失效 `invalidateSnapshot / invalidateDependencies / clear`（:134-149），写操作后由宿主编排层调用。

### 2.3 调度前置：DetectionService.detect

契约期望的真实调用序（由 ticket Question 摘要与源码共同印证）：

```
DetectionService.detect({cwd}, {skipSkillProbes, hintBackendId})
  -> registry.select -> selection = {backendId, source:'explicit'|'matches'|'fallback', ref, multiHit?, pending?}
  -> registry.describe(handle, backendId) -> RepositoryRef {backend, refId, name, url}
  -> registry.get(backendId).list(ref, {}, ctx) -> OpResult<Issue[]>
  -> assembleSnapshot + deriveDeck
```

其中 `registry.select`（`src/host/tracker/registry.js:278-314`）三级联：

1. explicit：`byHandle.has(k)` -> 显式绑定；`null` = 显式无后端（不造 RepositoryRef）。
2. matches：并行 `mod.matches(handle, ctx)`，超时 3000ms 视作 pending 排除决策集，平局按注册序取首个，暴露 `multiHit` 与 `pending`。
3. fallback：仅当无 explicit、无 match===true、无 pending 时静默 null；有 pending 必须 surface（source 仍 fallback 但 pending:true，UI 提示等待）。

---

## 3 差距表

### 3.1 字段对齐 — shape.js EMPTY vs MISSING

契约形状定义见 `src/shared/tracker/shape.js:107-140`：

- 核心字段恒存在：`key/type/title/state/body/url/createdAt/updatedAt/closedAt/parentKey`，缺则以 `''`/`null` 补齐。
- 能力字段可 MISSING：`author/assignees/labels/milestone/customFields/reason/blockedBy/comments`，能实现->填值或 `EMPTY=[]/''/null`；不能实现->省略。数组不填 `null`。
- 另有 `docs/architecture/tracker-backend-normalized-model.md` 与 `NORMALIZE_RULES.emptyVsMissing=true`（`src/host/tracker/contract.js:222-228`）。

| 字段 | 契约要求（shape.js） | GitHub 归一 | Markdown 归一 | 现行 buildSnapshot 输出 | 差距 |
|---|---|---|---|---|---|
| `key` | `string`，GitHub=`String(number)`、Markdown=`'00' 或 'NN'` | `deriveKey: String(raw.number)` | `String(meta.key)` | `number: number` 仍产出旧 `number`，不产 `key` | **现行 number 与契约 key 不互通** |
| `type` | `'issue'\|'map'`，由 `wayfinder:map` 标签推导 | `wayfinder:map` 标签 -> map | `meta.isMap ? 'map':'issue'` | `mapTicket.type = wayfinder: 段 else 'other'`，mapsMeta 也用同样过滤 | type 推导一致，但现行对非 wayfinder 票产 `'other'`（契约只认 issue/map） |
| `state` | `'open'\|'closed'` 小写两态 | `'closed'? CLOSED : OPEN` | `closedSet.has(statusNorm) ? CLOSED : OPEN` | `'OPEN'/'CLOSED'` 大写 | **大小写不归一** |
| `parentKey` | `string\|null` 核心恒存在 | `String(parent.number)\|parent.key\|null` | `meta.parentKey ?? null` | 不存在；树边用 `subIssues` + map 嵌套 | **树边模型不同** |
| `labels` | MISSING=无能力；EMPTY=`[]` | 恒 EMPTY：无来源->`[]` | **删除**：`delete issue.labels` -> MISSING | `labels: string[]` 仅名字 | GitHub EMPTY vs Markdown MISSING；现行无 color 对象 |
| `assignees` | MISSING=indeterminate；EMPTY=`[]`=未认领；`[{login}]`=已认领 | 恒 EMPTY：无来源->`[]` | `claimed ? [{login:'@me'}] : []` | `claimedBy: string` 单串 | **形状与语义不同** |
| `author` | MISSING 省略 | 有则对象，无则 MISSING | **删除** -> MISSING | `author?: {login,name,avatarUrl}` | GitHub 一致；Markdown 有意 MISSING |
| `blockedBy` | 唯一真源，`IssueRef[]` | `{key:String(n),title,state}` | `{key:pad2,title:'',state:OPEN}` | `blockedBy: number[]` 仅 number，`blocks` 另存反向边 | 契约只存 blockedBy；现行存两向且仅 number |
| `comments` | MISSING vs EMPTY | 恒 EMPTY：无来源->`[]` | 恒 `[]` 兜底 | 不组装进票，另有独立详情通路 | 契约要求归一后可 MISSING/EMPTY |
| `milestone` | MISSING 省略 | 有则对象，无则 MISSING | **删除** -> MISSING | 未出现 | Markdown 侧 MISSING 正确 |
| `customFields` | 说明性，绝不驱动 deck | 不产出 | `Type: research/task...` -> `[{name:'Type'}]` | 无 | Markdown 独有 |
| `reason` | open->`''`/MISSING，closed->原因 | open `''`，closed 取 stateReason | `closed?'completed':''` | 未归一 | 现行不含 reason |
| `closedAt` / `createdAt/updatedAt` | 恒存在，`closedAt null=未关闭` | 取 `closedAt\|closed_at\|null` | `state===CLOSED ? mtime : null` | `issues` 扇出带时间，mapTicket 不带时间 | 现行票时间不在 ticket 级 |
| `body/url` | 恒存在，url 本地 `''` | 取 `body / html_url` | `body: raw, url:''` | `parseMapBody(body)` 切片出五区块 | 契约 body 为原文，现行把 body 解析为五区块 |

**核心结论：** GitHub normalize 严格遵循 `EMPTY vs MISSING`；Markdown normalize 有意让 `labels/author/milestone` 为 MISSING。现行 buildSnapshot 的票形是第三种形状，与契约不互通。

### 3.2 缓存对比 — CACHE_MS vs snapshotTtl

| 项 | 现行（host/index.js） | 契约（host/tracker/snapshot.js） | 差距 |
|---|---|---|---|
| 默认 TTL | `CACHE_MS = 60000`（:47） | `snapshotTtl = 5000`, `depsTtl = 5000`（:57-58） | 契约短 12 倍 |
| 存储 | 内存 `cache:{ts,snapshot,error,cwd}` + 磁盘 `.dsh-mattskillsdeck-cache` + `lastIssueIndexByRepo` 索引 | 内存 `snapCache Map<backendId:refId>` LRU20 + `depsCache Map<backendId:refId#key>` | 现行两级+索引，契约仅内存多租户 |
| 容量 | 无界（单 cwd 单快照） | `SNAP_LRU_MAX=20` | 契约有逐出，现行无 |
| 新鲜度判定 | `cacheSnapshotIsCurrent` 调 `fetchIssueIndex` 轻索引比对 | `fresh(e,ttl) = Date.now()-e.at < ttl`；失败不进缓存 | 现行以远端索引为准，契约以时间戳为准 |
| 失效路径 | `wf.probe changed -> cache.ts=0`、`wf.commentIssue / wf.claim 成功 -> cache.ts=0` | `invalidateSnapshot`、`invalidateDependencies`、`clear`，由调用方显式逐出；`o.force=true` 绕过 | 现行多处自失效，契约要求显式失效 |
| 版本/etag | 无（仅 `updatedAt` 字符串） | `snapshotVersionOf` 哈希 + `version/etag` + `ifNoneMatch -> 304` | 契约支持条件请求，现行不支持 |
| 缓存不该缓存什么 | 无显式纪律 | G5：绝不缓存 hasField/unsupported 判定，`ok:false` 一律不缓存 | 契约束缚更严 |

### 3.3 出错回退 — kind 分类

契约统一分类见 `src/shared/tracker/constants.js:72-82` 与 `src/host/tracker/contract.js:65-67`：`env/auth/rate-limit/conflict/unsupported/not-found/network/parse`。

现行错误路径（分散在 helper 中）：

- `runGh`（:319-353）：`kind: 'env'/'auth'/'notfound'/'network'/'exit'/'spawn'`，基于 stderr 正则；未区分 `rate-limit` 与 `conflict`。
- `fetchIssues`（:793-851）：失败仅回落（gh api -> gh issue list），外层 `fi.ok ? ... : []` 静默空数组。
- `fetchMapsDetail`（:961-990）：`isRateLimitError -> fetchMapsDetailREST`，GraphQL 重试 2 次，单 map 失败置 `tickets:[]`。
- `fetchIssueDetail`（:996-1079）：同样 RATE_LIMIT->REST，多分支 `'env'/'parse'/'graphql'/'notFound'/'404'/'rateLimit'`（大小写不统一）。
- `registry.wrapTracker`（:41-47）：缺方法补 `unsupported` 桩。
- `github/errors.js:23-50`：`ENV->AUTH->RATELIMIT->NOTFOUND->PARSE->network` 顺序纪律；`conflict` 仅透传。
- `preflight.js:30-58`：`AUTH->RATELIMIT->ENV->NOTFOUND->UNSUPPORTED->PARSE->NETWORK` 顺序。

差距对照：

| 契约 kind | 现行对应 | 是否对齐 |
|---|---|---|
| `env` | `runGh env` / `github/errors ENV` / `preflight ENV` | 归一方向一致，但正则较窄 |
| `auth` | `runGh auth` | 基本一致 |
| `rate-limit` | 现行仅用于降级分支，不作为统一 kind；产 `'rateLimit'` 驼峰，契约为 `'rate-limit'` | **拼写不统一** |
| `not-found` | 现行有 `'notfound'` / `'notFound'` / `'404'` 三种 | **拼写不统一**，与契约 `'not-found'` 不一致 |
| `unsupported` | 现行 `unsupportedStub` 与 markdown `setParent -> unsupported` 有，但 buildSnapshot 自身不经 registry，永远不产 | **现行 buildSnapshot 无法表达 unsupported** |
| `conflict` | 现行 buildSnapshot 不产；仅 markdown `setBlockedBy 自环 -> conflict` 与 github `set* expectedUpdatedAt -> conflict` 有 | 同上 |
| `parse` | 两边均有 | 现行解析失败仅空数组，契约要求 `ok:false {kind:parse}` |
| `network` | 两边均有 | 现行 `retry 1 次` 后仍 network，契约 `network` 为兜底 |

共同不变量：失败**返回不抛**。差异在于现行把失败“吃掉”成空快照，而契约要求透传。

### 3.4 deck 差距 — deriveDeck 计算

#### 现行：groupTickets + computeLevels

- 输入：`tickets: {number, state:'OPEN'|'CLOSED', claimedBy:string, blockedBy:number[]}`。
- `computeLevels`（:724-760）：memo 递归求 `level = 1+max(level(blocker))`，无环守卫。NOT-FOUND 阻塞者被 `filter(Boolean)` 忽略。
- `groupTickets`（:762-778）：`frontier = open.filter(t => !t.claimedBy && !t.blockedBy.some(openBlocker))` 等，统计 `total/open/closed/frontier/claimed/blocked`，`levels` 含 `numbers[]`，`levelOf: {number: level}`。
- `parseProgress`（:689-699）：三级锚定，每票 `t.progress`。

#### 契约：deriveDeck

- 输入：整个 `Snapshot{maps, issues}`，全局 `byKey` 唯一化，票池 `poolKeys = U map.tickets U issues`。
- `claimedOf`（:45-48）：`!hasOwn('assignees') -> null (indeterminate)`；`[] -> false`；`>0 -> true`。
- `hasOpenBlocker`（:58-66）：`targetMissing -> true // NOT-FOUND 安全 blocked`。
- `levelOf`（:77-95）：带 `stack.has -> 0` 环守卫，NOT-FOUND->0 计层级。
- 统计（:148-173）：`stats = {total, open, closed, frontier, claimed, blocked, indeterminate, levels, levelOf}`，其中 `frontier` 天然排除 indeterminate。
- 额外产出 `progressOf`、`labels` 全量并集、`blockedByKeys`。

#### 对比

| 项 | 现行 groupTickets | 契约 deriveDeck | 影响 |
|---|---|---|---|
| 认领判定 | `!!claimedBy` 单串 | `assignees:MISSING->indeterminate / EMPTY[]->未认领 / >0->已认领` | 现行无法表达“未知认领态” |
| 阻塞判定 | 仅当 `byNum[b]!==undefined && state OPEN` 时 blocked；缺失依赖被忽略 | NOT-FOUND->安全 blocked | **契约更保守** |
| frontier | `!claimedBy && !blocked` | `isOpen && claimed===false && !blocked`，且排除了 indeterminate | 契约排除了 indeterminate，现行把 indeterminate 算进 frontier |
| level | 忽略缺失依赖；无环守卫 | 缺失按 0 计层级；有 visited 守卫 | 环票现行可能递归异常 |
| 输入形状 | `number` 键，单 map 内 tickets | 全局 key 空间，maps+issues 全量 | 契约跨 map 依赖有效，现行单 map 内 |
| 输出 | `stats{total/open/closed/frontier/claimed/blocked/levels/levelOf}` per map | `stats{total/open/closed/frontier/claimed/blocked/indeterminate/levels/levelOf}` 全快照 + `progressOf/labels/blockedByKeys` | 契约多 indeterminate 等 |
| 进度 | 每票 `t.progress` | `progressOf[key]` 聚合 | 口径一致 |

---

## 4 真实夹具验证 — matt-demo-markdown-test1/.scratch/buy-luckin-coffee-plan

> 夹具根: `D:/dsh-plugin/matt-demo-markdown-test1/.scratch/buy-luckin-coffee-plan`

### 4.1 落盘形态（原文）

| 文件 | 关键行 | 说明 |
|---|---|---|
| `map.md:1` | `Label: wayfinder:map` + `# 购买瑞幸咖啡计划...` | Markdown 地图以 `Label:` 声明 map |
| `map.md` | `## Destination / Notes / Decisions so far / Not yet specified / Out of scope / ## 进度：40%` | 契约五区块 + 进度块 |
| `issues/01-research-promos.md:3-5` | `Type: research` / `Status: resolved` / `Blocked by: ` | resolved -> `state: closed` |
| `issues/03-choose-two-drinks.md:6` | `Blocked by: 01` | 指向 01，但 01 已 closed，不算阻塞 |
| `issues/04-pick-order-time.md:6` | `Blocked by: 01, 02` | 两个前置均 closed -> 不阻塞 |
| `issues/05-fallback-plan.md:6` | 同上 `Blocked by: 01, 02` | 同上 |
| `issues/02-research-stores.md:3-5` | 同样 `resolved` + 空阻塞 | 同上 |

### 4.2 Markdown 后端映射（parseMd -> normalizeIssue -> list -> snapshot）

以 `src/host/tracker/backends/markdown/parse.js:7-111` 为主：

1. **标题** `# 购买瑞幸咖啡...` -> `title`（:13-18）。
2. **Status** `resolved/completed/closed/done` -> `state: closed`（:11-12）；其余 -> open。
3. **Type** `Type: research/grilling` -> `customFields`（:19-23），同时 `meta.isMap` 决定 `type: map/issue`（:80）。
4. **Blocked by** `Blocked by: 01, 02` -> `blockedBy: [{key:'01'},{key:'02'}]`（:24-37）。
5. **Comments** `## Comments` 段按 `### author — date` 切块（:39-77），本夹具无评论->`comments:[]`。
6. **assignees** 由 `statusNorm === 'claimed' ? [{login:'@me'}] : []`（:100-106）决定；本夹具无 claimed->`assignees:[]`（EMPTY）。
7. **其他** `key=NN, parentKey='00', body=raw, url='', closedAt, reason='completed'/'', createdAt/updatedAt=mtime`（:79-109）。

再经 `markdown/normalize.js:1-24`：删除 `labels/milestone/author` -> MISSING；补齐 core 字段；`blockedBy/comments` 兜底 `[]`。

### 4.3 本夹具在契约路径下的期望快照

- `list`（markdown/issues.js:33-68）：读 `map.md`（key '00', isMap:true）+ 5 档，共 6 Issue。
- `assembleSnapshot`：`'00'` 为唯一 map，5 票 `parentKey='00'` 挂为 `maps[0].tickets`，`issues=[]`。
- `deriveDeck` 前瞻： `byKey` 6 项；`poolKeys` 5 票（00 为容器不计数）。01/02 closed -> 不入 open；03/04/05 open、`assignees=[]`（false）、`hasOpenBlocker` 视目标是否 open：01/02 均 closed -> `false` -> 三票皆 `frontier`。若 01 被改 open，则 03 被阻塞。
- `labels`：MISSING 故 `labels=[]`；`customFields` 仅作说明性展示，不影响 stats。
- `progressOf`：map `40%`；01 `100%`；03/04/05 `0%`。

### 4.4 与现行 buildSnapshot 的反差

- 现行 buildSnapshot **不读** `.scratch` 任何文件：它只调 `gh api`，故对该夹具永远不可见；若工作区是纯本地 Markdown 且无 GitHub 远程，现行会因 `getRepoKey` 失败而返回空 maps。
- 现行 `mapTicket` 期望 `labels.nodes / assignees.nodes / blockedBy.nodes` 等 GraphQL 形，无法消费 `parseMd` 的 `blockedBy: [{key}]`。
- 现行 `groupTickets` 的 `byNum[number]` 查找对 `key='01'`->number 1 的跨形也需转换。

### 4.5 小型对照夹具

`.scratch/__fixtures__/markdown-sample/demo-full`（`map.md / issues/01-hello-world.md / 02-second-issue.md`）与本 buy-luckin 夹具同构：

- `demo-full/issues/01-hello-world.md:5-6` `Status: claimed` -> `assignees:[{login:'@me'}]`（claimed），`Blocked by: #02` -> 指向 02；`02 Status: ready-for-agent` -> open、空 assignees。
- 契约下：02 frontier；01 claimed->不计 frontier；若 02 closed 则 01 解阻塞。
- `demo-empty` 验证空票池时 `stats.total=0` 边界。

---

## 5 最小对齐清单

> 按“先形状、再缓存、再回退、再 deck”顺序，逐项给出最小改动点位与验收形态。

### 5.1 字段对齐（shape.js EMPTY vs MISSING）

- [ ] **补 `key` 并废 `number`**：host 侧所有票以 `String(number)` 产 `key`，停止产出 `number`。
- [ ] **统一 `state` 小写**：`mapTicket` 与 `fetchIssues` 的 `OPEN/CLOSED` 改小写。
- [ ] **树边改 parentKey**：票上恒 `parentKey: string|null`，来源不再是 `subIssues.nodes` 而是 `parentKey === map.key`。
- [ ] **labels 形**：GitHub 侧产 `{name,color}` 对象数组，空->`[]`；Markdown 侧保持 MISSING，不伪造 `[]`。
- [ ] **assignees 形**：改 `{login,kind?,name?,avatarUrl?}[]`，空可实现->`[]`，无能力->省略。现行 `claimedBy:string` 废止。
- [ ] **blockedBy 形**：改 `IssueRef[] {key,title,state}`，现行 `number[]` 与 `blocks` 合并为单向 `blockedBy`。
- [ ] **comments/author/milestone/reason/closedAt**：按各后端能力对齐；Markdown 的 `labels/author/milestone` MISSING 是有意为之，不要补空。
- [ ] **customFields**：仅 Markdown 产 `Type`，GitHub 不产；绝不驱动 deck。

### 5.2 缓存对齐（CACHE_MS vs snapshotTtl）

- [ ] **TTL 收敛**：按后端区分 TTL（github 60s、markdown 5s），而不是一刀切。
- [ ] **失效语义统一**：写操作后统一调 `invalidateSnapshot(backendId, ref)` + 内存 `cache.ts=0` 双失效。
- [ ] **容量与多租户**：契约 LRU20 支持多 refId；如保留磁盘秒开，需将磁盘层挂到契约层之下（以 `backendId:refId` 为键）。
- [ ] **版本/etag**：引入 `version/etag/ifNoneMatch->304`，避免磁盘旧快照被误判新鲜。
- [ ] **不缓存失败**：统一为失败不缓存，避免“一次失败 60s 内持续失败”。

### 5.3 回退对齐（kind 分类）

- [ ] **统一 ERROR_KIND 拼写**：`'notfound'/'404'` 与 `'rateLimit'` 驼峰改为 `'not-found'` / `'rate-limit'`。
- [ ] **补 `unsupported / conflict` 通路**：通过 registry 桩透传，而非在 buildSnapshot 里吃掉。
- [ ] **失败不静默**：契约 `composeSnapshot` 失败 `return {ok:false}`，现行 `fi.ok?[]:[]` 与 `maps 填空` 需改为透传错误。
- [ ] **分级回退保留**：GraphQL->REST 降级保留并下沉到各后端 `list/get` 内部。
- [ ] **错误分类顺序纪律**：按 `github/errors.js` 与 `preflight.js` 已定顺序统一到一处。

### 5.4 deck 对齐（deriveDeck 计算）

- [ ] **认领三态**：`hasOwn('assignees')` 区分 MISSING vs EMPTY。
- [ ] **NOT-FOUND 安全 blocked**：破链依赖一律算阻塞。
- [ ] **环守卫**：`levelOf` 加 visited 栈。
- [ ] **输出补齐**：补 `indeterminate`、`progressOf`、`labels` 并集、`blockedByKeys`。
- [ ] **跨 map 依赖**：deck 以整 Snapshot 为单位（全局 byKey），现行单 map 内查找改为全局。

### 5.5 路由对齐

- [ ] **wf.snapshot 改分发**：先 `detect(cwd)` 得 `selection.backendId`，再 `composeSnapshot(backendId, ref, ctx)`；仅当 `unsupported/not-found` 时回落。
- [ ] **后端注册**：registry 已注册 github/markdown/gitlab，需让 markdown 的 `list` 真正被 composeSnapshot 调用。
- [ ] **验收**：以 `buy-luckin-coffee-plan` 为夹具，断言 `composeSnapshot('markdown', {refId: cwd}, ctx).snapshot.maps[0].tickets.length === 5` 且 `stats.frontier` 符合 4.3 预言。

---

## 附录：关键源码锚点（绝对路径+行号）

- 现行总装车间: `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/index.js:1081-1255` buildSnapshot；`1862-1884` wf.snapshot；`793-990` fetchIssues/fetchMapsDetail；`701-718` mapTicket；`661-683` parseMapBody；`724-778` computeLevels/groupTickets；`855-903` 索引与缓存。
- 契约总装车间: `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/snapshot.js:56-151` createSnapshotComposer；:22-42 assembleSnapshot；:76-113 composeSnapshot；:119-131 getDependencies。
- 形状与常量: `src/shared/tracker/shape.js:107-196`；`src/shared/tracker/constants.js:72-82`；`src/host/tracker/contract.js:222-237`；`src/host/tracker/registry.js:54-71,278-314`。
- 归一实现: `src/host/tracker/backends/github/normalize.js:175-218`；`src/host/tracker/backends/github/queries.js:14-47`；`src/host/tracker/backends/markdown/parse.js:7-111`；`src/host/tracker/backends/markdown/normalize.js:1-24`；`src/host/tracker/backends/markdown/issues.js:33-68`；`src/host/tracker/backends/markdown/graph.js:21-45`。
- 错误分类: `src/host/tracker/preflight.js:30-58`；`src/host/tracker/backends/github/errors.js:23-50`。
- deck: `src/shared/tracker/deck-derive.js:32-181`。
- 真实夹具: `D:/dsh-plugin/matt-demo-markdown-test1/.scratch/buy-luckin-coffee-plan/map.md`；`issues/01-research-promos.md`～`05-fallback-plan.md`。仓库内 mini 夹具: `D:/dsh-plugin/dsh-mattpocock-skills-deck/.scratch/__fixtures__/markdown-sample/demo-full|demo-empty/**`。

---

> 结论一句话：现行 buildSnapshot 是“GitHub 直连、GHz 级远端优化过的快照工厂”；契约 snapshot.js 是“后端无关、按身份分发的编排器”。要让面板支持本地 Markdown，必须把前者**收敛到后者之下**（Detection -> list -> assemble -> deriveDeck），并把字段从“number/claimedBy/blocks”映射到“key/assignees/blockedBy”，把缓存从“60s 单槽+磁盘”对齐到“5s LRU + 显式失效”，把错误从“散落 kind”收敛到统一 ERROR_KIND，把 deck 从“单 map 内”扩展到“整快照全局”。