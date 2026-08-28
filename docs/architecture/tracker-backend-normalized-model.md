> ⚠️ 已废弃（2026-08-28 起）— 本文档标题与正文中出现的 `capability-by-fill` 为旧口径，已由 G5 双轨取代：**操作能力** = 运行时试出来、**检查项** = 声明式卡片 `{check, show, actions}` 各走各的。为保留追溯，标题与旧段落暂不改名，仅加本提示正本清源。以后请以 `docs/adr/20260826-check-item-chain-contract.md`（G5 双名制）与 `CONTEXT.md` 为准。
> **版本与效力**：以更新者为准（同 CONTEXT.md 规则）。
>
> 跳转：新口径见 ADR §5.4 与 CONTEXT.md “操作能力 / 界面检查项”。

# Tracker 后端抽象契约 · 完整数据形状 + capability-by-fill 推导

> 本文件是子图 #112「定稿 Tracker 契约」内子票「定稿契约：完整数据形状 + capability-by-fill 推导」(#127) 的解答产物，供子图 #114–#119 各后端实现时的共享归一化模型。
>
> ⚠️ **定版说明**：本文件已按 #127 拍板重写为**后端中性版**——删 `key`+`number` 双 id（只留单 `key`）、删 base `Issue.subIssues`（树边 = `parentKey`(向上) + `MapNode.tickets`(向下)）、采纳 **EMPTY vs MISSING**、`state` 只两态、`RepositoryRef` 定版 `{backend(非空), refId, name, url}` 且弃 `'other'`、`MapStats` 增 `indeterminate` 且 `frontier` 排除它、删「open=sum」伪不变量。**原先的 4 个「待确认」点已全部敲定，本节移除。**
>
> 前置约束（只引用）：`docs/architecture/tracker-backend-design-contract.md` §2（完整形状 / capability-by-fill / UI 假设全字段必填 / 诊断=日志二分 / G4 契约测试）。要改本契约任意一条，须先在本子图内推翻共享契约或本人这张票。
>
> 权威形状定版：`C:\Users\辰辰洋洋\AppData\Local\Temp\dsh-tracker-contract-issue-map-design.md`；影响点：`.scratch/tracker-contract-refactor-impact.md`。

---

## 1. 归一化三规则

1. **完整形状**：`interface` 声明全部字段（UI 据此假设字段必填）；后端负责把来源数据归一化到这个形状。
2. **核心 vs 能力字段**（EMPTY vs MISSING 的关键，二者不可混用）：
   - **核心字段**（`key / type / title / state / body / url / createdAt / updatedAt / closedAt / parentKey`）**永远存在**，来源给不了的用确定空值（`''` / `null`）补齐。
   - **能力字段**（`author / assignees / labels / milestone / customFields / reason / blockedBy / blocking / comments`）**可 MISSING**：能实现 → 填值或 `EMPTY`（`[]` / `''` / `null`）；**真不能实现** → 从对象中**省略**该字段（或对应操作返回 `{ok:false, error:{kind:'unsupported'}}`）。
   - `EMPTY` = 字段**存在**但值为空（`[]` / `''` / `null`）→ 该能力**存在**，但此条无内容。`MISSING` = 字段**不存在** → 该能力**缺失**。
   - 空值约定：数组 `[]` = EMPTY、省略 = MISSING；标量 `''`/`null`；**数组不填 `null`/`undefined`**（`null` 只给 `closedAt`/`parentKey`）。
3. **日志二分**：host 记录归一化后每字段填/空。capability 侧**不再产布尔能力开关**——只有 `diagnoseCapabilities(issue, log)`（字段在但空 = `EMPTY`、省略 = `MISSING`、有值 = 原值）；操作能力 = 运行时调用结果（得数据 = 可用、`unsupported` = 不可用）。**无能力表、无能力缓存、无能力分支。** client 记录渲染/隐藏。正确性由 G4 契约测试在 CI 兜底。
   - **判定依据 = 后端能力，而非单次查询结果**（#126 定稿）：后端原生支持该能力 → 字段恒存在（无内容写 `[]` / `''`）；后端无此概念 → 字段省略（MISSING）。日志统一写法：`labels:[...] (EMPTY)` / `labels:<absent> (MISSING)`。

---

## 2. 实体

### 2.1 RepositoryRef（后端面对的工作区仓库）

```ts
type BackendId = string   // 开放 string；一等内置 'github' | 'markdown' | 'gitlab'；'other' 保留串已弃用

interface RepositoryRef {
  backend: BackendId;     // 开放 string（**非空**）。'other' 弃用——「无后端」只在 Selection.backendId: null，此时不产出 RepositoryRef
  refId: string;          // 稳定标识（github/gitlab='owner/name'；markdown='<path>'（.scratch/<feature-slug>））；后端自解析，UI 可直接展示
  name: string;           // 显示名
  url: string;            // 远端 URL；本地=''
}
```

- 来源给不了的默认 `''`（如本地 `url`）。**无 `owner`/`number`/`extension`/`snapMode`**。

### 2.2 Issue（票 / 图 统一实体）

```ts
type State      = 'open' | 'closed'                     // deck 只认两态；GH OPEN/CLOSED、md Status→state 归 #115 后端归一
type IssueType  = 'issue' | 'map'                      // wayfinder 语义；显式标记（map 可空）
type ClosedReason = 'completed' | 'not_planned' | 'reopened' | 'duplicate' | string   // 开放 string
type ActorKind    = 'user' | 'bot' | 'organization' | string
type FieldType    = 'text' | 'number' | 'date' | 'single' | 'multi' | string

interface IssueRef { key: string; title: string; state: State; type?: IssueType }   // 边上带 type（指向 map 还是票）

interface Issue {
  // ── 核心字段（永远存在，缺→''/null）──
  key: string               // 规范 id（github=String(number)；markdown='<NN>'；gitlab=String(iid)）；仓库内唯一；全局身份=(RepositoryRef, key)
  type: IssueType           // 显式标记：后端按约定定（GH: wayfinder:map/有子票根；md: map.md）
  title: string             // ''
  state: State              // 两态；frontier/claimed/blocked 由 deck 推导，不进形状
  body: string              // ''（宿主端从 markdown 渲染，不重复 bodyHTML）
  url: string               // ''（本地）
  createdAt: string         // ''
  updatedAt: string         // ''
  closedAt: string | null   // null=未关闭
  parentKey: string | null  // 父 map 的 key；根=null（核心字段，永远存在）
  // ── 能力字段（可 MISSING；EMPTY=有能力无内容，MISSING=无能力）──
  author?: Actor            // 创建者（provenance）
  assignees?: Actor[]       // 指派/认领；[]=EMPTY=未认领；省略=indeterminate（未知认领态）
  labels?: Label[]          // EMPTY if none；MISSING if unsupported
  milestone?: Milestone
  customFields?: CustomField[]   // 结构化、说明性，绝不驱动 deck 逻辑
  reason?: ClosedReason     // closed 时给原因（或 EMPTY=关了但没说明）；open 依后端支持给 ''(EMPTY) 或省略(MISSING)
  blockedBy?: IssueRef[]    // 谁阻塞我（入边；**唯一真源**）
  blocking?: IssueRef[]     // 我阻塞谁（出边）
  comments?: Comment[]      // 决策记录
}
```

- **base `Issue` 不设 `subIssues`**：树边只 `parentKey`(向上) + `MapNode.tickets`(向下)，不冗余。
- **`authorAssociation`** 保留为开放串，交后端自设计（`OWNER|MEMBER|CONTRIBUTOR|NONE|''`），UI 只展示不分支。

### 2.3 Comment

```ts
interface Comment {
  id?: string              // 评论 id（threading/编辑追踪）
  author: Actor
  authorAssociation: string   // OWNER|MEMBER|CONTRIBUTOR|NONE|''（本地=''）
  body: string
  createdAt: string
  updatedAt: string
  editedAt?: string | null // 编辑追踪
}
```

### 2.4 Label

```ts
interface Label { name: string; color: string; description?: string }   // color '' 若无；本地 markdown 用 Status/Type 行内字段表达语义
```

### 2.5 Actor

```ts
interface Actor { login: string; kind?: ActorKind; name?: string; avatarUrl?: string }
```

### 2.6 Milestone

```ts
interface Milestone { name: string; description?: string; state?: 'open' | 'closed'; dueOn?: string | null }
```

### 2.7 CustomField

```ts
interface CustomField { name: string; value: string | number | boolean | null; type: FieldType; options?: string[] }   // single/multi 候选
```

### 2.8 MapNode（type='map' 的 Issue 追加字段）

```ts
interface MapNode extends Issue {
  tickets: Issue[];   // 子票（一层）；永远存在、缺省 []（EMPTY）——「能否展开」用能力位表达，不作 MISSING
}
```

> `stats` **移出形状** → 改由 `MapStats` 派生视图（deck 侧推导，见 §2.9），`frontier/claimed/blocked` 不进后端形状。

### 2.9 MapStats（deck 派生视图，非后端形状）

```ts
interface MapStats {
  total: number
  open: number
  closed: number
  frontier: number      // open 且无未满足依赖(blockedBy 空/全满足) 且未认领；天然排除 indeterminate
  claimed: number       // 有 assignee（认领）
  blocked: number       // open 且 blockedBy 非空（未满足依赖）
  indeterminate: number // assignees=MISSING（未知认领态；不计 0、不误计 frontier）
}
```

- **独立计数**：`claimed/blocked/indeterminate` 各算各，**可重叠**；**「open=sum」为伪不变量，删除**。
- **`frontier` 精确口径**：`state==='open' && assignees 已知且空 && !claimed && !blocked` = 天然排除 `indeterminate`。
- **NOT-FOUND 依赖（破链）→ `blocked`（安全），绝不误判 `frontier`**，并记 diagnostics 供排查。

### 2.10 Snapshot / deck 投影（宿主编排）

```ts
interface Snapshot {
  repository: RepositoryRef
  maps: MapNode[]
  issues: Issue[]                 // 孤儿票（parentKey 指向已删/不存在 map）
  deck: DeckProjection            // host 计算，UI 无脑用，绝不分支
}

interface DeckProjection {
  progressOf: Record<string, number | null>   // 每票 `## 进度:N%`；无→null
  labels: { name: string; color: string }[]   // 标签色板目录
  stats: {
    total; open; closed; frontier; claimed; blocked; indeterminate
    levels: { total: number; open: number; closed: number }[]   // 每层（数组）
    levelOf: Record<string, number>                             // 每 key 的 level
  }
  blockedByKeys?: Record<string, string[]>    // 把 IssueRef[] 投影成 key 数组（UI 用）
}
```

- **display 直接用 `key`（`#${key}`）**，无 `displayNumber` / 无 `number`。
- `deck` 与 `deck-derive.js` 只在 host 计算；**后端绝不存 `deck` 字段**（deck 是派生，非能力声明）。

---

## 3. capability-by-fill 推导（精确规则）

- **能力 = 运行时调用结果**（第一性原理：能力是"事后的事实"，不是"事先的断言"）：
  - **字段能力** = 归一化结果上 `hasField`（`hasOwnProperty`）：`[]`/`''`/`null` 存在 = EMPTY = 有能力；字段**省略** = MISSING = 无能力。
  - **操作能力** = 调用该 op → 得数据 = 可用；返回 `{ok:false, error:{kind:'unsupported'}}` = 不可用。
- **不做**：手写 capabilities 声明清单、`CapabilityFootprint`、`supportedOps`、能力缓存、能力分支。
- **诊断**：`diagnoseCapabilities(issue, log)` 只写日志（字段在但空 = `EMPTY`、省略 = `MISSING`、有值 = 原值），**不导出布尔开关**。
- 判断 `hasField` 的字段集：核心字段（`key/type/title/state/body/url/createdAt/updatedAt/closedAt/parentKey`）+ 能力字段（`author/assignees/labels/milestone/customFields/reason/blockedBy/blocking/comments`）。**不再含 `number` / `subIssues`**。

### 3.1 EMPTY vs MISSING 的三条一致性裁决

1. 后端**能**实现但来源无数据 → `EMPTY`（字段存在且为空）。
2. 后端**不**实现 → **省略该字段**（`MISSING`）。
3. 操作未实现 → 该 op 返回 `{ok:false, error:{kind:'unsupported'}}`.

> 已定：不实现的能力统一走「省略字段」；UI 按现有容错读取（`(x.labels||[]).map` 等）自然不渲染。

---

## 4. 本地 Markdown 的状态映射（**归 #115 后端**，契约层不议）

- 本地 Markdown 无 labels，用行内字段表达语义（契约 §5）：`Status:`（claimed/resolved/ready-for-agent）、`Type:`（research/prototype/grilling/task）、`Blocked by:`。
- **`Status` → `state` 的具体映射规则（`resolved→closed`、`claimed/ready-for-agent→open`）由 #115 后端归一化时定稿；本契约只约定 `state` 只两态（`open|closed`），不在契约层重复决策。**
- `Issue.labels` 为 MISSING（本地无 labels 能力），而非 EMPTY。
- `Issue.type` 由 wayfinder 语义定（issue/map），与 `Type:`（research/…）正交；`Type:` 作为附加信息保留在 body/诊断。
- `Issue.parentKey` / `MapNode.tickets`：由 `.scratch/<effort>/` 目录层级推导（map.md 下的 issues/ 即其子票）。

---

## 5. G4 契约测试骨架（各后端验收）

- **夹具**：每后端一个「含完整数据」repo + 一个「空」repo。
- **断言**：
  - 来源有数据 → 必映射（非空）。
  - 来源无 → 能实现字段必 `EMPTY`（`[]` / `''` / `null`），不能实现字段必 `MISSING`（省略）。
  - 定版形状骨架：单 `key`(string)、无 `number`/`subIssues`、`parentKey` 核心字段、`state` 只两态。
  - `MapStats` 计数口径：`assignees` MISSING → `indeterminate`（不计 0、不误计 frontier）；NOT-FOUND 依赖 → 安全 `blocked`。
- 共享骨架：`tests/verify-tracker-contract.js` + `tests/tracker-contract/{harness,fixtures}`；**`node tests/verify-tracker-contract.js` 必过是迁移完成门禁**。具体夹具与断言实现归各后端子图。

---

## 6. 定版回顾（原「开放待确认」全部敲定）

| 原待确认 | 定版 |
|---|---|
| markdown `Status:` → `state` 映射 | 归 #115 后端定稿；契约层只约 `state` 两态 |
| 双 id（key+number） | **删 `number`，只留单 `key`**（string） |
| EMPTY vs MISSING 取舍 | **省略字段 = MISSING（无能力）**；UI 按现有容错读取自然不渲染 |
| `parentKey`/`tickets` 归属 | `parentKey`(Issue，核心字段) + `MapNode.tickets`(向下)；base Issue 无 `subIssues` |
| `RepositoryRef` | `{backend(非空), refId, name, url}`；`'other'` 弃用（无后端→`Selection.backendId:null`） |
| `MapStats` | 增 `indeterminate`；`frontier` 排除 indeterminate；删「open=sum」伪不变量 |