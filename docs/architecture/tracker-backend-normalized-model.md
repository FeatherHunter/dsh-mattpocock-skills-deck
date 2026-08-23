# Tracker 后端抽象契约 · 完整数据形状 + capability-by-fill 推导

> 本文件是子图 #112「定稿 Tracker 契约」内子票「定稿契约：完整数据形状 + capability-by-fill 推导」(#127) 的解答产物，供子图 #114–#119 各后端实现时的共享归一化模型。
> 前置约束（不重复，只引用）：docs/architecture/tracker-backend-design-contract.md §2（完整形状 / capability-by-fill / UI 假设全字段必填 / 诊断=日志二分 / G4 契约测试）。要改本契约任意一条，须先在本子图内推翻共享契约或本人这张票。
> 落地依据：现有 `src/host/index.js` 已把 GitHub 归一化出实体字段（number/title/state/body/url/labels(nodes)/assignees/comments/subIssues/blockedBy/blocking/updatedAt/createdAt/closedAt…），本文件把它抽象成后端中性契约并定死字段清单与空值约定；同样对齐 `src/client/kernel/api.js` / `IssueDetail.js` 已存在的容错读取（`(x.labels||[]).map`、`(src.assignees && src.assignees.nodes) ? … : (src.assignees||[])`）。

---

## 1. 归一化三规则

1. **完整形状**：`interface` 声明全部字段（UI 据此假设字段必填）；后端负责把来源数据归一化到这个形状。
2. **EMPTY vs MISSING**（capability-by-fill 的关键，二者不可混用）：
   - `EMPTY`：字段**存在**但值为空（`[]` / `''` / `null`）→ 该能力**存在**，但此条无内容。
   - `MISSING`：字段**不存在**于归一化对象 → 该能力**缺失**。
   - 后端能实现的字段：填值或 `EMPTY`；**真不能实现**的字段/操作：从对象中**省略**该字段（或对应操作返回 `{ok:false, error:{kind:'unsupported'}}`）。
3. **日志二分**：host 记录归一化后每字段填/空（`title:"" (EMPTY)`、`labels:[] (EMPTY)`、`subIssues:<absent> (MISSING)`）；client 记录渲染/隐藏。正确性由 G4 契约测试在 CI 兜底。**不引入运行期内省或能力分支。**

---

## 2. 实体

### 2.1 RepositoryRef（后端面对的工作区仓库）

```ts
interface RepositoryRef {
  backend: string;          // backend id: 'github' | 'markdown' | 'gitlab' | 'other'
  id: string;               // 稳定标识：github/gitlab='owner/name'；markdown='<path>'（.scratch/<feature-slug>）
  name: string;             // 显示名
  owner: string | '';       // github/gitlab 的 owner；markdown=''
  remote: string | '';      // 远端 URL；本地=''
  path: string | '';        // 本地路径（markdown）；远端=''
  snapMode: 'ok' | 'loading' | 'err';  // 现有面板 snapMode 口径
}
```

来源给不了的用 `EMPTY`（`''`）。

### 2.2 Issue（票 / 图 统一实体）

```ts
interface IssueRef {
  key: string;              // 规范 id：github='<n>'；markdown='<NN>'（两位零填充，充当 ticket id）
  number: number | null;    // 数值 id：github=number；markdown=null（用 key）
  title: string;
  state: 'open' | 'closed'; // 归一化：github OPEN/CLOSED；markdown 由 Status 映射（见 §4）
}

interface Issue {
  key: string;
  number: number | null;
  type: 'issue' | 'map';    // map=wayfinder map（含子票）；issue=普通票
  title: string;
  state: 'open' | 'closed';
  body: string;
  url: string | '';         // 链接；本地=''（或 file:// 相对路径）
  labels: Label[];          // EMPTY if none；MISSING if unsupported（见 §3）
  assignees: Assignee[];
  comments: Comment[];
  subIssues: IssueRef[];    // EMPTY if none；MISSING if unsupported
  blockedBy: IssueRef[];
  blocking: IssueRef[];
  createdAt: string | '';
  updatedAt: string | '';
  closedAt: string | null;
  parentKey: string | null; // wayfinder：所属 map 的 key
}
```

### 2.3 Comment

```ts
interface Comment {
  author: { login: string };
  authorAssociation: string;   // 'OWNER'|'MEMBER'|'CONTRIBUTOR'|'NONE'|''（本地=''）
  body: string;
  createdAt: string;
  updatedAt: string;
}
```

### 2.4 Label

```ts
interface Label {
  name: string;
  color: string | '';      // github 有；markdown=''（本地用 Status/Type 行内字段表达语义）
}
```

### 2.5 MapNode（type='map' 的 Issue 追加字段）

```ts
interface MapNode extends Issue {
  tickets: Issue[];   // 子票（一层；递归由 syncSnapshot 每张 map 各自拉取，不深展开）
  stats: { total: number; open: number; closed: number; frontier: number; claimed: number; blocked: number };  // 现有 KPI 口径
}
```

### 2.6 BackendStatus / 能力视图（diagnostic only · G5）

host 计算，随 `wf.status` / `wf.snapshot` 下发，**只作诊断/信息用，不驱动 UI 隐藏**。

```ts
interface BackendStatus {
  backend: 'github' | 'markdown' | 'gitlab' | 'other';
  ok: boolean;
  capabilities: {
    labels: boolean;       // Issue.labels 字段存在
    subIssue: boolean;     // Issue.subIssues 字段存在 + Ops.subIssue 可用
    depGraph: boolean;     // Issue.blockedBy/blocking 字段存在 + Ops.blockedBy 可用
    comments: boolean;     // Issue.comments 字段存在
    closedState: boolean;  // Issue.state 能表达 closed（markdown 由 Status:resolved 映射）
    liveUpdates: boolean;  // syncSnapshot/preflight 提供刷新（github=web+API 轮询；markdown=文件监听）
    remoteSharing: boolean;// url 提供真实远端链接（markdown 无远端→false）
  };
  detail: string;          // 探测错误/提示（诊断用）
}
```

---

## 3. capability-by-fill 推导（精确规则）

### 3.1 能力 → 字段信号表

| 能力 | 判定信号 | 说明 |
|---|------|---|
| `labels` | `Issue.labels` 字段存在 | `[]` = 有此能力但本条无标签；省略 = 无 labels 能力 |
| `subIssue` | `Issue.subIssues` 字段存在 + `Ops.subIssue` 可用 | 同上 |
| `depGraph` | `Issue.blockedBy` / `blocking` 字段存在 + `Ops.blockedBy` 可用 | 同上 |
| `comments` | `Issue.comments` 字段存在 | 同上 |
| `closedState` | `Issue.state` 能表达 closed | markdown 由 `Status:resolved` 映射 |
| `liveUpdates` | `syncSnapshot` / `preflight` 提供刷新 | github=轮询；markdown=文件监听；gitlab=glab |
| `remoteSharing` | `url` 提供真实远端链接 | markdown 无远端 → false |

### 3.2 推导算法

```
cap(c) = signalFieldPresent(c)
           ? (fieldValue 为空 ? 'present-but-empty' : 'present-full')
           : 'absent'
```

- host 按上表 O(1) 映射每字段「存在 / 为空」。
- UI **不按 capabilities 分支**（G5）；只作日志与「设置 / 状态栏」诊断展示。

### 3.3 关键裁决（EMPTY vs MISSING 的三条一致性）

1. 后端**能**实现但来源无数据 → `EMPTY`。
2. 后端**不**实现 → **省略该字段**（`MISSING`）。
3. 操作未实现 → 该 op 返回 `{ok:false, error:{kind:'unsupported'}}`，且能力视图对应 `false`。

> 取舍待确认点：对「不实现的能力」，目前统一走「省略字段」；另一选项是「填 EMPTY + 能力视图标 false」。3.3 选了前者，但未与 UI 侧逐处核对（见 §5 待确认 3）。

---

## 4. 本地 Markdown 的状态映射（D4 镜像 `.scratch/`，勿自造）

- 本地 Markdown 无 labels，用行内字段表达语义（契约 §5）：`Status:`（claimed/resolved/ready-for-agent）、`Type:`（research/prototype/grilling/task）、`Blocked by:`。
- 归一化到完整形状：
  - `Issue.state`：`resolved` → `closed`；`claimed` / `ready-for-agent` → `open`。
  - `Issue.labels`：为 `MISSING`（本地无 labels 能力），而非 `EMPTY`。
  - `Issue.type`：由 `Type:` 推导——`type` 是 wayfinder 语义（issue/map），与 `Type:`（research/…）正交；`Type:` 作为附加信息保留在 body/诊断，不进 `Issue.type`。
  - `Issue.parentKey` / `subIssues`：由 `.scratch/<effort>/` 目录层级推导（map.md 下的 issues/ 即其子票）。

---

## 5. G4 契约测试骨架（各后端验收）

- **夹具**：每后端一个「含完整数据」repo + 一个「空」repo。
- **断言**：
  - 来源有数据 → 必映射（非空）。
  - 来源无 → 必 `EMPTY`（`[]` / `''` / `null`）。
  - 能实现的能力字段必须 `EMPTY` 而非 `MISSING`；不实现的能力字段必须 `MISSING` 而非 `EMPTY`。
- 本子图只定断言方向，具体夹具与断言实现归各后端子图。

---

## 6. 开放待确认（grilling · 待维护者定夺）

1. **markdown `Status:` → `state` 映射**：`resolved → closed`？`claimed` / `ready-for-agent → open`？（§4 已给草案）
2. **双 id**：采用 `key`(string) + `number`(number|null) 双主键（markdown "03" 需 string key；github 用 number）？确认后端与 UI 都无冲突。
3. **EMPTY vs MISSING 取舍**：「不实现的能力」统一用「省略字段」（§3.3 选前者），还是「填 EMPTY + 能力视图 false」？需逐处核对 UI 容错读取（`IssueDetail.js` / `ListTab.js`）能承受省略字段。
4. **`parentKey` / `tickets` 归属**：放 `Issue`（所有票统一带）还是仅 `MapNode` 专属？当前草案放 `Issue`（`parentKey`）+ `MapNode`（`tickets`）。
