# #1790 实施计划：可见 `Status` 成为本地 Markdown 票的 triage 唯一真源

- 日期：2026-11-02
- 状态：**计划，尚未实施业务代码**
- 依据：#1790 第 8 条评论「Agent Brief 最终版（2026-11-01，方案冻结）」；第 7 条评论为维护者认可记录；第 1–6 条评论是过程设计，已被第 8 条取代。
- 复用笔记：`research/1790-triage-2026-11-01.md`。一句话结论：缺陷 A 成立，根因是实现把 triage 状态写进了隐藏 `DSH-LABELS`，而技能原文要求它写在票头的可见 `Status:` 行；缺陷 B 已拆到 #1799，显示问题拆到 #1800，本票不处理。
- 本轮调查范围：parse、issues-read、issues-locate、issues-create、create-render、map-render、create-layout、issues-status、issues-patch、original-fields、deck 层 issue-get/issue-list/map-snapshot/issue-patch/issue-create、contract 的 entities/inputs/results、相关测试与文档。只读代码，没有改业务代码。
- 基线：分支 `main`，HEAD `b801ba1fa155d0965176ce7f2f032bcb57aa6333`，包版本 `1.9.0-beta.34`，Node `v24.19.0`（满足验证链要求的 24.15+）。

---

## 1. 目标与不变量

### 1.1 一句话目标

让本地 Markdown 后端的 **issue 文件**（implementation-ticket / plain-issue / bug / spec-ticket）只用票头可见的 `Status:` 行表达 triage 状态；隐藏 `DSH-LABELS` 只保留非 triage 标签。旧文件仍能读，第一次显式写入时归一，不做批量迁移。

### 1.2 必须守住的不变量

1. **唯一真源**：issue 文件的可见 `Status:` 是 triage 状态唯一真源。`DSH-LABELS` 不再保存五个 triage 角色（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）。
2. **双写禁止**：新写入的 issue 文件，同一个 triage 状态不得同时出现在可见 `Status:` 与隐藏 `DSH-LABELS`。
3. **不改形状**：`Issue.state` 仍是 `'open' | 'closed'` 两态；`ListFilter` 不新增状态筛选；筛选继续按 `labels` / `state` 工作。
4. **不批量迁移**：不扫描、不改写已有用户文件；旧文件按兼容规则读，第一次显式写入时才归一。
5. **不越界**：spec/map 容器继续用隐藏 `DSH-STATUS`；wayfinder 子票继续只写可见 `claimed` / `resolved`；GitHub/GitLab 后端完全不动；#1799、#1800 不做。
6. **不半写**：写侧遇到真冲突时整次不写；任何一步失败都不能留下“写了一半”的票。
7. **读侧不失败**：冲突在读侧只报告、不抛错；`deck_issue_list` / `map_snapshot` 仍能返回行。

### 1.3 票型判定

| 票型 | 主判据 | 可见 Status 规则 | 缺省状态 |
|---|---|---|---|
| spec-ticket（实施票） | 所在工作单元 `route==='spec'`，或正文有 `marker ticket`，或创建时显式 `fileKind` | 可见加粗/裸 `Status:` | `ready-for-agent` |
| plain-issue（普通票） | `route==='plain'` 且无 bug 标签、无 wayfinder 线索；旧布局且无 marker | 可见 `Status:`（可不写） | 无，不写 |
| bug（缺陷票） | `labels` 含 `bug` | 可见 `Status:` | `needs-triage` |
| map-ticket（地图子票） | `route==='map'`，或正文 `Type:` / `wayfinder:*` 标签 | 只认 `claimed` / `resolved` | `claimed` |
| spec 容器 / map 容器 | `isMap` 或文件名 `spec.md` / `map.md` | 不写可见行，继续隐藏 `DSH-STATUS` | 容器既有默认 |

判定顺序：显式 `fileKind`（建票时）→ bug 标签 → 容器 → route map / wayfinder 线索 → route spec / marker ticket → plain issue。**目录路线是读侧主判据**，marker 只作兜底；这样后端直接 `create(type:'issue', parentKey:'00')` 落在 `issues/` 下时，也能按 spec-ticket 读成 `ready-for-agent`。

### 1.4 状态词与 `state` 映射

- triage 角色：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。
- 完成值：`resolved`、`completed`、`closed`、`done`。
- 合法值 = 五 triage + 四完成值。
- `state` 映射：`wontfix` 与四个完成值 → `closed`；其余 triage 与 `claimed` → `open`；无状态 → `open`。
- 旧渲染器给 issue 文件写的默认值是 `ready-for-agent`，这是兼容读里的“旧默认”，不是新的全局默认。

### 1.5 读侧决策（issue 文件）

记：

- `V` = 可见 `Status:` 行规范化后的值；可见行没有或值非法时为 `null`。
- `H` = 隐藏 `DSH-LABELS` 里属于五 triage 的合法值集合。
- 旧默认 = `ready-for-agent`。

按顺序：

1. `V` 合法且 `V !== 'ready-for-agent'` → 采用 `V`，来源 `visible`。
2. 否则 `H` 恰好一个合法 triage → 采用该值，来源 `hidden`（旧文件兼容读；第一次写时归一）。
3. 否则 `V` 合法 → 采用 `V`，来源 `visible`。
4. 否则按票型默认：spec-ticket → `ready-for-agent`；bug → `needs-triage`；plain issue → 无；map-ticket → `claimed`。来源 `default`。
5. `V` 非法：按“缺失”参与上面的判断，同时把原始可见值保留到 `statusVisible`。
6. `H` 有多个合法 triage：跳过第 2 条，按 1 / 3 / 4 判断；第一次写入时把落选的 triage 记入 `DSH-STATUS-HISTORY`。

返回字段：

- `status`：最终有效值；plain issue 没有默认值时不出现。
- `statusVisible`：可见行原值；只在“与最终值不同 / 原值非法 / 最终值来自 hidden”时出现；没有可见行时不出现。
- `statusSource`：`visible` / `hidden` / `default`；`status` 不出现时也不出现。
- `statusConflict`：只有真冲突时出现，见 1.6。
- `state`：按 1.4 映射。

### 1.6 真冲突

只在这一组条件同时成立时叫真冲突：

> `V` 合法、`V !== 'ready-for-agent'`、`H` 恰好一个合法 triage、`V !== H[0]`。

读侧取 `V`，永不失败，并返回：

```json
{
  "visible": "wontfix",
  "hidden": ["ready-for-agent"],
  "hiddenSource": "DSH-LABELS",
  "stateFromVisible": "closed",
  "stateFromHidden": "open",
  "resolution": {
    "default": "visible",
    "rule": "visible-status-wins",
    "action": "write-visible-status-on-next-write",
    "history": "DSH-STATUS-HISTORY"
  }
}
```

说明：

- `hidden` 是数组；真冲突时只有一个元素，保留数组是为了将来扩展。
- `resolution` 的四个值在实现里写死，测试按这组字面量断言。
- 旧文件“可见 `ready-for-agent` + 隐藏 `needs-info`”**不是冲突**，按 `H` 读，`statusSource:'hidden'`，`statusVisible:'ready-for-agent'`。
- 写侧遇到真冲突：未给 `resolveStatus` 时整次不写；给了才按选择归一。

### 1.7 写侧规则

- **建票**：
  - spec-ticket / implementation → 可见 `ready-for-agent`。
  - bug → 可见 `needs-triage`。
  - plain issue → 不写 `Status:`。
  - map-ticket → 可见 `claimed`（没有认领人也写）。
  - 隐藏 `DSH-LABELS` 不含五 triage；spec/map 容器的隐藏标签不动。
- **setLabels**：
  - 传入的标签里 triage 最多一个。多个 → 整次拒绝（`ERROR_KIND.PARSE`，不写盘）。
  - 恰好一个 triage → 写可见 `Status:`，并从 `DSH-LABELS` / 可见 `Labels:` 行移除该 triage。
  - 没有 triage → 不动 `Status`；若当前有效状态来自隐藏 triage，则按当前有效状态写可见 `Status:` 并移除隐藏 triage（首次写归一）。
  - 非 triage 写 `DSH-LABELS`；已有可见 `Labels:` 行时同步该行，且只写非 triage。
  - 落选值记 `DSH-STATUS-HISTORY`。
- **close**：
  - issue 路线先读当前有效状态；当前是 `wontfix` 就保持 `wontfix`，不覆盖成 `resolved`；其他情况写 `resolved`。
  - `state` 变 `closed`；非 triage 标签保留，triage 从隐藏标签移除。
  - 关闭原因照旧追加到 `## Comments`。
  - 容器 / 地图子票 / 旧布局保持现有写法。
- **reopen**：
  - spec-ticket → `ready-for-agent`。
  - bug → `needs-triage`。
  - plain issue → 删除可见 `Status:`（不写）。
  - map-ticket → `claimed`。
  - 容器 → 隐藏 `DSH-STATUS: ready-for-agent`。
  - 旧布局 → 保持 `ready-for-agent`。
  - `state` 变 `open`。
- **冲突解决**：`resolveStatus` 只取 `visible` 或 `hidden`；只在冲突时需要；无冲突时传了也按无冲突执行。归一写成功之后再执行原调用其余步骤。
- **历史**：`DSH-STATUS-HISTORY` 一行一条，记录来源、落选值、采用值、ISO 时间；同一条（来源 + 落选值 + 采用值）重复时不再追加。

### 1.8 读面字段

| 读面 | 新增字段 | 说明 |
|---|---|---|
| `deck_issue_get` 的 `data.ticket` | `status`、`statusVisible`、`statusSource`、`statusConflict` | 按需出现，不出现 `undefined`；正文摘录仍是 2000 字 |
| `deck_issue_list` 的 `data.issues[]` | `status`（有才给）、`statusConflict`（布尔，总是给） | 普通行；text 追加“其中状态冲突 N 张” |
| `deck_map_snapshot` 的 `data.children[]` | `status`（有才给）、`statusConflict`（布尔，总是给） | `childRow` 与 `thinRow` 都加；text 追加冲突数 |
| `deck_map_snapshot` 的 `data.map` | 不加 | map 容器继续隐藏 `DSH-STATUS`，不在本票读面暴露 |
| `deck_issue_list` 的薄地图快查行 | 不加 | 仍然是 `key/title/state/url` 四格；它只查 map 容器 |

`deck_issue_list` 的筛选仍按 `labels` / `state`；因为 parse 会把可见 `Status` 合成为一枚 triage 标签，`labels:['needs-triage']` 等既有调用继续成立。

---

## 2. 新模块与契约改动

### 2.1 新模块 `src/tracker/rooms/markdown/status.ts`

纯函数模块，不读盘、不 import `parse.ts`（避免循环依赖）。内容：

- 常量：`TRIAGE_STATUS_ROLES`、`COMPLETED_STATUS_VALUES`、`LEGACY_STATUS_DEFAULT`。
- 类型：`IssueFileKind`、`StatusSource`、`StatusConflict`、`StatusRead`。
- 判定：`statusKindOf(meta, labels, raw)`、`resolveStatusRead(...)`、`stateOfStatus(...)`、`defaultStatusOf(kind)`、`normalizeStatus(raw)`、`isTriageStatus(value)`。
- 标签：`hiddenLabelsOf(labels)`、`labelsWithSynthesizedTriage(labels, status)`。
- 历史：`readStatusHistory(text)`、`appendStatusHistory(text, entry)`。
- 正文：`statusInBody(body)`，供 deck 层一致性检查与写侧复用。

如果实现后有效行超过 350，把“文本变换”部分拆到 `src/tracker/rooms/markdown/status-write.ts`；`status.ts` 保留纯判定。

### 2.2 新模块 `src/deck/tools/issue-patch-status.ts`

只被 `src/deck/tools/issue-patch.ts` 调用，避免后者超过有效行上限。内容：

- `parseResolveStatus(args)`：只接受 `visible` / `hidden`。
- `readStatusConflict(t, repo, key, opCtx)`：一次 `t.get` 读当前票，返回冲突、当前有效状态、当前标签。
- `explicitStatusInArgs(args)`：从 `addLabels` 的五 triage、`body` 里的 `Status:` 行提取显式状态；`close:true` 不算显式状态。
- `assertResolveConsistency(...)`：显式状态必须与 `resolveStatus` 一致，否则 `bad-args`。
- `normalizationCall(...)`：拼 `t.setLabels(repo, key, 非 triage 标签, { status: 选择值 }, opCtx)`。
- `conflictRefusal(...)`：拼 `status:'unsupported'`、`reason:'bad-args'`、`items`、`data.statusConflict`、`data.retry`。
- `retryArgs(originalArgs)`：复制原参数并加 `resolveStatus:'visible'`；不要保留 `undefined`。

### 2.3 契约字段

`src/tracker/contract/entities.ts` 的 `Issue` 增加：

```ts
status?: string
statusVisible?: string
statusSource?: 'visible' | 'hidden' | 'default'
statusConflict?: StatusConflict
```

注释写明：这四个字段只有本地 Markdown 后端会填；GitHub/GitLab 省略；`state` 仍是两态，不从 `status` 派生新状态值。

`src/tracker/contract/inputs.ts`：

- `SetOpts` 增加 `status?: string`，注释写“本地 Markdown 专用：setLabels 时原子写可见 Status 并归一；其他后端忽略”。
- `CreateInput` 增加 `fileKind?: 'spec-ticket' | 'plain-issue' | 'bug' | 'map-ticket'`，注释写“本地 Markdown 专用；GitHub 忽略；与 typeLine 同类先例”。
- `ListFilter` 不加字段。

### 2.4 格式真源 `original-skills.yaml` 与派生

`src/tracker/rooms/markdown/format/original-skills.yaml`：

- `status` 增加 `completed: [resolved, completed, closed, done]` 与 `legacy-default: ready-for-agent`。
- `plain-issue` 显式覆盖：`visible-line: false`、无默认值，不再继承 `implementation-ticket` 的 `ready-for-agent`。
- `wayfinder-child` 声明默认 `claimed`。
- `hidden-comments` 里 `DSH-LABELS` 的 `why` 改成“只保留非 triage 标签；triage 状态在可见 Status 行”。
- 新增 `DSH-STATUS-HISTORY` 条目，scope 写 issue 文件 / wayfinder-child / plain-issue，`why` 写“记录归一或冲突解决时落选的值，便于追溯，不参与读取”。

`src/tracker/rooms/markdown/format/field-values.ts` 从 `MD_FORMAT.status` 派生并导出 `TRIAGE_STATUS_ROLES`、`COMPLETED_STATUS_VALUES`、`STATUS_LEGACY_DEFAULT`；YAML 缺字段时回落到旧字面量。代码不手写第二份词表。

同步 `scripts/generate-md-format-config.mts` 生成物 `format/generated.ts` 与门禁 `tests/verify-md-format-config.ts`：生成器 `--check`、映射自校验、锚点逐字、坏映射演练、生成物一致。

---

## 3. 文件级改动顺序

每个阶段单独提交、单独跑测试；下一阶段开始前上一阶段必须绿。

### P0：基础模块与契约（无行为变化）

**目标**：先把词表、纯函数、类型和格式真源准备好，运行时行为完全不变。

1. `src/tracker/contract/entities.ts:163-215`
   - 加 2.3 的四个可选字段与 `StatusConflict` 接口。
   - 更新 `Issue` 文档注释：核心字段列表不变；能力字段列表不变；新增的四个字段是 Markdown 后端的能力字段。
2. `src/tracker/contract/inputs.ts:72-91`（`CreateInput`）与 `:129-131`（`SetOpts`）
   - 加 `fileKind` 与 `status`，按 2.3 写注释。
3. `src/tracker/rooms/markdown/format/original-skills.yaml:107-212`
   - 按 2.4 改 `status` 词表、`plain-issue`、`wayfinder-child`、`DSH-LABELS` 的 `why`、`DSH-STATUS-HISTORY`。
4. `src/tracker/rooms/markdown/format/field-values.ts:53-96`
   - 从 `MD_FORMAT.status` 派生并导出三组常量；保留现有导出不变。
5. 新建 `src/tracker/rooms/markdown/status.ts`
   - 按 2.1 实现纯函数；只 import 类型与 `field-values`，不 import `parse.ts`、不读盘。
6. 新建 `tests/verify-1790-status-model.ts`
   - 覆盖：`normalizeStatus` 大小写/空格/标点；九类状态与 `state` 映射；四类票型默认；`hiddenLabelsOf`；`labelsWithSynthesizedTriage`；`statusKindOf`；`resolveStatusRead` 的四个分支；冲突对象；`statusInBody`；`appendStatusHistory` 去重。
   - 期望值全部用字面量，不用生产函数算期望。

**P0 完成判据**：

```powershell
node scripts/generate-md-format-config.mts --check
node --import ./scripts/ts-hook.mts tests/verify-md-format-config.ts
node --import ./scripts/ts-hook.mts tests/verify-1790-status-model.ts
```

三条全绿；`git diff --stat` 里没有业务代码行为改动。

**P0 回滚**：删除 `status.ts` 与测试，回滚 `entities.ts`、`inputs.ts`、`original-skills.yaml`、`field-values.ts`，重新生成 `format/generated.ts`。无盘面影响。

### P1：parse 读侧与路线传递

**目标**：读出来的 `Issue` 带 `status` 等字段，旧文件按兼容规则读；不写盘。

1. `src/tracker/rooms/markdown/parse.ts:12-23`
   - `ParseMeta` 增加 `route?: 'map' | 'spec' | 'plain' | ''`、`legacy?: boolean`、`fileKind?: IssueFileKind`。
2. `src/tracker/rooms/markdown/parse.ts:240-244`
   - 删掉旧的 `statusRaw/statusNorm/closedSet/state` 判断，改调 `status.ts`：
     - 可见 raw 只取可见 `Status:` 行；隐藏 `DSH-STATUS` 只在容器路线读。
     - `H` 从 `DSH-LABELS` 的 triage 集合算。
     - 按 1.5 得到 `status/statusVisible/statusSource/statusConflict`。
     - `state` 用 `stateOfStatus`。
3. `src/tracker/rooms/markdown/parse.ts:286-308`
   - `labels` 改成“可见 `Labels:` 行与隐藏 `DSH-LABELS` 的并集，先过滤五 triage，再按有效 status 合成一枚 triage 标签”；非 triage 两处去重。
   - 容器保持现状：不合成、不过滤。
   - wayfinder 子票：隐藏 triage 过滤掉，不合成。
4. `src/tracker/rooms/markdown/parse.ts:407-422`
   - 组装 `Issue` 时加四个可选字段；没有值就不写键。
5. `src/tracker/rooms/markdown/parse.ts:429-434`
   - assignees 仍以“可见 Status 行存在”为条件；默认 `claimed` 不凭空给 assignees。
6. `src/tracker/rooms/markdown/issues-locate.ts:292-375`
   - `resolveIssueFile` 的结果增加 `route`：`u.legacy ? '' : u.kind`。
7. `src/tracker/rooms/markdown/issues-locate.ts:477-506`
   - `loadIssueFromFile` 的 `opts` 增加 `route` / `legacy`，传给 `parseMd`。
8. `src/tracker/rooms/markdown/issues-read.ts:126-150`
   - `pushTicketRow` / `pushSpecRow` 把 `route` 传给 `loadIssueFromFile`。
9. `src/tracker/rooms/markdown/issues-read.ts:192-202`
   - 工作单元循环里已知 `u.kind` / `u.legacy`，显式传下去；不要再让 `loadIssueFromFile` 自己猜。
10. `src/tracker/rooms/markdown/issues-read.ts:436-447`
    - 单票 `get` 用 `resolveIssueFile` 返回的 `route`。
11. `src/tracker/rooms/markdown/issues-create.ts:65` 与 `:91`
    - `originalKindOf(input, repo.mdScene/fileKind)`；读回 `parseMd` 时传 `route` / `legacy` / `fileKind`，让新建票的默认状态与写入值一致。
12. 新建 `tests/verify-1790-status-read.ts`
    - 4 票型 × 10 可见值（缺省 + 5 triage + 4 完成值）× 9 隐藏集合（缺省、5 个单 triage、多 triage、仅非 triage、triage + 非 triage）矩阵。
    - 每格断言 `status/state/labels/statusSource/statusVisible/statusConflict`。
    - 单独用例：旧文件（可见 `ready-for-agent` + 隐藏 `needs-info`）、可见非法值、隐藏多个 triage、wayfinder 非法值默认 `claimed`、容器 DSH-STATUS。
13. 更新 `tests/tracker-contract/fixtures/markdown.ts:26-47`
    - 夹具仍可用 `Status: claimed` / `Status: ready-for-agent`；补“可见 triage + 隐藏非 triage”与“旧文件隐藏 triage”两类夹具。
    - `:81` 的 labels 能力说明、`:137` 的 claimed→open、`:152` 的无 Status 省略 assignees 断言按新读侧口径复核。
14. 复核并跑：`tests/verify-markdown-backend.ts`、`tests/verify-1403-kind-two-layer.ts`、`tests/verify-1605-markdown-map-list.ts`、`tests/verify-bug-entry.ts`。

**P1 完成判据**：

```powershell
node --import ./scripts/ts-hook.mts tests/verify-1790-status-read.ts
node scripts/verify-chain.ts --only 1790
node --import ./scripts/ts-hook.mts tests/verify-markdown-backend.ts
node --import ./scripts/ts-hook.mts tests/verify-1403-kind-two-layer.ts
node --import ./scripts/ts-hook.mts tests/verify-1605-markdown-map-list.ts
```

**P1 回滚**：回滚 `parse.ts`、`issues-locate.ts`、`issues-read.ts`、`issues-create.ts` 与 P1 测试/夹具。没有写盘，旧文件仍按旧解析；不影响磁盘数据。

### P2：写侧（建票、setLabels、close/reopen、归一）

**目标**：新写入的文件符合唯一真源；旧文件第一次显式写入时归一；不批量迁移。

1. `src/tracker/rooms/markdown/create-render.ts:27` 与 `:64-91`
   - `originalKindOf(input, fileKind?)`：显式 `fileKind` 优先；没有时按 `labels` 含 `bug` → bug、`repo.mdScene==='effort'` → map-ticket、`repo.mdScene==='feature'` → spec-ticket、`parentKey==='00'` 且 labels 含 `ready-for-agent` → spec-ticket、`typeLine` → map-ticket、其余 → issue。
2. `src/tracker/rooms/markdown/create-render.ts:235-241`
   - `statusFor` 顺序改为：正文显式 Status > `input.status` > labels 里恰好一个 triage > 票型默认。多个 triage 直接拒绝。
   - 票型默认：spec-ticket / implementation → `ready-for-agent`；bug → `needs-triage`；plain issue → 空；map-ticket → `claimed`。
3. `src/tracker/rooms/markdown/create-render.ts:250-284`
   - `renderHeader` 的 `DSH-LABELS` 对 issue 文件与 wayfinder-child 过滤五 triage；spec/map 容器不过滤。
4. `src/tracker/rooms/markdown/create-render.ts:426-483`
   - `renderTicket` 的 `fields.forEach` 在 Status 值为空时跳过该字段，不能只把值置空（否则会留一行空 `**Status:**`）。
5. `src/tracker/rooms/markdown/map-render.ts:89-136`
   - `renderWayfinderChild` 默认 `claimed`，不再要求 `assignees` 非空；隐藏 `DSH-LABELS` 过滤五 triage。
6. `src/deck/tools/issue-create.ts:240-241` 与 `src/tracker/rooms/markdown/issues-create.ts:54-94`
   - deck 层把 `resolveCreateKind` 得到的 kind 填进 `CreateInput.fileKind`：
     - `spec-ticket` → `spec-ticket`
     - `bug` → `bug`
     - `map-ticket` → `map-ticket`
     - 普通 `issue` → `plain-issue`
     - `spec` / `map` 容器不填（继续用 `type`）。
   - 后端 `issues-create` 把 `input.fileKind` 或 `repo.mdScene` 传给 `originalKindOf` 与读回 `parseMd`；确保新建 bug / plain issue / spec-ticket 的默认状态正确。
7. `src/tracker/rooms/markdown/issues-patch.ts:486-500`
   - `setLabelsInner` 改调 `status.ts` 的标签/状态变换：
     - triage 最多一个；多个 `failAs(ERROR_KIND.PARSE)`，不写。
     - 一个 triage 写可见 `Status:`，从隐藏/可见 Labels 行移除。
     - 非 triage 写 `DSH-LABELS`；有可见 Labels 行时同步且只写非 triage。
     - 没有 triage 时按当前有效状态归一（若来自隐藏），写可见 Status。
     - `opts.status` 存在时按它归一，且与 labels 里的 triage 必须一致。
     - 落选值写 `DSH-STATUS-HISTORY`。
8. `src/tracker/rooms/markdown/issues-patch.ts:115-235`
   - `updateIssueInner` 的 `patch.labels` 分支（`:205-214`）改用同一个 helper，不再无条件写可见 `Labels:` 行。
   - 正文里显式 `Status:` 行与 `patch.labels` 的 triage 不一致时 `bad-args`，不写。
   - `rewriteTicketText` 的 `metaOf` 补 `route` / `legacy` / `fileKind`。
9. `src/tracker/rooms/markdown/issues-status.ts:147-179`
   - `rewriteTicketText` 增加可选 `precheck`（或等价参数）：在锁内、apply 前读当前文本，真冲突且无显式选择时返回失败，整次不写。
   - `metaOf` 补 `route` / `legacy` / `fileKind`。
10. `src/tracker/rooms/markdown/issues-status.ts:279-309`（close）
    - issue 路线先读当前有效状态；`wontfix` 保持，其他写 `resolved`；追加 `## Comments` 不变；归一隐藏 triage、写 history。
    - 容器 / 地图子票 / 旧布局分支保持不变。
11. `src/tracker/rooms/markdown/issues-status.ts:311-317`（reopen）
    - 按 1.7 的票型默认重写；plain issue 删除可见 Status；map-ticket `claimed`；容器 `ready-for-agent`；旧布局保持旧行为。
12. `src/tracker/rooms/markdown/original-fields.ts:157-255`
    - 增加 `removeField`（同时删加粗与裸行）供 plain issue reopen 使用；其余原语不动。
13. 新建 `tests/verify-1790-status-write.ts`
    - 建票四类默认与隐藏标签过滤；plain issue 无 `Status:`。
    - setLabels 单 triage / 多 triage 拒绝 / 非 triage / 可见 Labels 行同步。
    - close：bug 关闭 `resolved`；`wontfix` 不被覆盖；reason 进 `## Comments`。
    - reopen：spec-ticket `ready-for-agent`、bug `needs-triage`、plain 删除、map-ticket `claimed`。
    - 旧文件首次写归一 + `DSH-STATUS-HISTORY` 内容。
14. 更新既有门禁：
    - `tests/verify-1489-status-write.ts`：保留现有实施票断言；新增 bug 重开 `needs-triage`、wontfix 不被覆盖、plain 建票不写 Status、wayfinder 默认 `claimed`。
    - `tests/verify-1489-claim-labels.ts:188-200`：改为隐藏 `DSH-LABELS: bug`、可见 `Status: needs-triage`、读回两枚靠合成。
    - `tests/verify-1489-claim-labels.ts:150-177`：未认领地图子票改为默认 `claimed`。
    - `tests/verify-1788-write-route.ts`：A/B 认领不动可见 Status 保留；E 在 route spec 下仍 `ready-for-agent`；新增 plain 路线重开删 Status。
    - `tests/verify-1059-issue-write.ts`：状态归一 / 失败仍走既有 `issue.write` 事件，不新建事件名。
    - `tests/verify-922-ticket-file-queue.ts`：状态读写仍走 `withFileWriter`。
    - `tests/verify-1509-update-strict.ts`：整份正文替换/模板守卫不被状态改动绕过。

**P2 完成判据**：

```powershell
node --import ./scripts/ts-hook.mts tests/verify-1790-status-write.ts
node --import ./scripts/ts-hook.mts tests/verify-1489-status-write.ts
node --import ./scripts/ts-hook.mts tests/verify-1489-claim-labels.ts
node --import ./scripts/ts-hook.mts tests/verify-1788-write-route.ts
node --import ./scripts/ts-hook.mts tests/verify-1059-issue-write.ts
node --import ./scripts/ts-hook.mts tests/verify-922-ticket-file-queue.ts
```

**P2 回滚**：只回滚写侧文件与 P2 测试，保留 P1 读侧（新写出的文件仍能读）。如果非要连 P1 一起回滚到旧代码：新文件里的隐藏 `DSH-LABELS` 不含 triage，旧 parse 不会合成 triage 标签，列表筛选会暂时看不到状态；这不是数据丢失，但不要在生产工作区直接这么做，先跑一次性迁移或接受暂时不可见。

### P3：冲突写侧与 deck 层 `deck_issue_patch`

**目标**：真冲突在写侧整次不写；deck 层给 `data.statusConflict` 与 `data.retry`；`resolveStatus` 可重试成功。

1. 新建 `src/deck/tools/issue-patch-status.ts`
   - 按 2.2 实现；不直接写盘，只读 `t.get` 和拼参数。
2. `src/deck/tools/issue-patch-definition.ts:13-50`
   - 加 `resolveStatus`：`type:'string'`、`enum:['visible','hidden']`、描述“只在状态冲突时需要；无冲突时传了也按无冲突执行”。
   - required 仍只 `key`；`additionalProperties:false` 不变；工具级描述补一句冲突与 retry。
3. `src/deck/tools/issue-patch.ts:186-207`
   - 在 `specCloseGuard` 之后、任何 comment/labels/assignees/text/state 写之前，调 `readStatusConflict` 一次。
   - 成本：这次预检多 1 次读，按实测记入 `claimed`；与 `specCloseGuard` 的读成本口径一致。
4. `src/deck/tools/issue-patch.ts:209-219` 之前
   - 有冲突且没有 `resolveStatus`：整次不写，回：
     - `status:'unsupported'`
     - `reason:'bad-args'`
     - `items:[{key, step:'status', status:'failed', reason:...}]`
     - `data.statusConflict`
     - `data.retry = {tool:'deck_issue_patch', args:{...原调用全部参数, resolveStatus:'visible'}}`
     - text 说明“没有写入；按 data.retry.args 重试，不要原样重发”；文件在两次调用间变化时按新回执重新取 retry。
5. `src/deck/tools/issue-patch.ts` 同位置
   - 有冲突且给了 `resolveStatus`：
     1. 校验同调用显式状态（`addLabels` 的 triage、`body` 的 Status 行）与选择一致，不一致 `bad-args` 不写。
     2. 调一次 `t.setLabels(repo, key, 当前非 triage 标签, {status: 选择值}, opCtx)` 归一；失败即停。
     3. 再按原顺序执行 comment / labels / assignees / text / state。
6. `src/deck/tools/issue-patch.ts:221-260`（labels 分支）
   - `have` 先过滤五 triage，避免合成标签把 `addLabels` 变成两个 triage。
   - `addLabels` 的 triage 最多一个；多个 `bad-args`。
   - 只 `removeLabels` 掉 triage 时：状态保持，`notes` 说明“本地 Markdown 的 triage 状态在可见 Status 行，摘标签不会清掉；要改状态用 addLabels 里带一个 triage 或 close”。
   - 写后核对 `uniq` 时排除合成 triage。
7. 新建 `tests/verify-1790-status-conflict.ts`
   - 读侧真冲突对象逐字断言。
   - 后端 `setLabels` / `close` 遇冲突拒绝且文件字节不变（不半写）。
   - deck `deck_issue_patch` 冲突回执：`ok:false`、`status:'unsupported'`、`reason:'bad-args'`、items 一条 `step:'status'`、`data.statusConflict`、`data.retry.args.resolveStatus==='visible'`。
   - 按 retry 重试成功；`resolveStatus:'hidden'` 也成功；显式状态与选择不一致 `bad-args`；无冲突传 `resolveStatus` 正常执行；归一后再次读取不再冲突。
8. 更新 `tests/verify-1106-deck-surface.ts:63-74` / `:83-94`
   - `FROZEN_SHAPE` 与 `FROZEN_DESC` 加 `resolveStatus`；信封仍 14 格、三态、八原因码；说明这是 #1790 有意的契约变化。
9. 更新 `tests/verify-golden-receipts.ts`
   - 如果金标准冻住了 `data` 形状，重录；只重录 `data.statusConflict` / `data.retry` 这类新增字段，不改既有字段。

**P3 完成判据**：

```powershell
node --import ./scripts/ts-hook.mts tests/verify-1790-status-conflict.ts
node --import ./scripts/ts-hook.mts tests/verify-1106-deck-surface.ts
node --import ./scripts/ts-hook.mts tests/verify-golden-receipts.ts
```

**P3 回滚**：回滚 `issue-patch.ts`、`issue-patch-definition.ts`、`issue-patch-status.ts`、P3 测试与 FROZEN 改动。回滚后 deck 不再给 retry，但 P2 后端仍会拒绝冲突、不会半写；冲突票需要人工改文件或再升级。

### P4：读面字段

**目标**：`deck_issue_get` / `deck_issue_list` / `deck_map_snapshot` 带出状态与冲突；不改变既有字段。

1. `src/deck/tools/issue-get.ts:114-131`
   - `issueBrief` 增加 `status`、`statusVisible`、`statusSource`、`statusConflict`，按需出现。
   - `:275` `data.ticket=brief` 不变；`:283` text 加一句状态与冲突说明；`:265` 正文摘录 2000 字不变。
2. `src/deck/tools/issue-list.ts:354-365`
   - 普通行加 `status`（有才给）与 `statusConflict` 布尔（总是给）。
   - `:402` text 追加“，其中状态冲突 N 张”。
   - `:165-190` 薄地图行保持四格，不加 status/冲突。
3. `src/deck/tools/map-snapshot.ts:56-80`
   - `childRow` / `thinRow` 加 `status` 与 `statusConflict` 布尔。
   - `:196` text 加冲突数；`:198` `data.map` 容器不动。
4. 新建 `tests/verify-1790-status-surface.ts`
   - 复制 `tests/verify-1495-deck-close-reason.ts` 的 `makeWorkspace` / `platformStub` / `registry` / `tools` 骨架。
   - 覆盖：`deck_issue_get` 四个字段；`deck_issue_list` 行 status、statusConflict、text 冲突数；`deck_map_snapshot` 行两个字段；`deck_issue_patch` definition 参数；薄地图行仍是四格。
5. 复核 `tests/verify-1605-markdown-map-list.ts` 与 `tests/verify-1106-deck-surface.ts` 的 data 字段断言。

**P4 完成判据**：

```powershell
node --import ./scripts/ts-hook.mts tests/verify-1790-status-surface.ts
node --import ./scripts/ts-hook.mts tests/verify-1605-markdown-map-list.ts
node --import ./scripts/ts-hook.mts tests/verify-1106-deck-surface.ts
```

**P4 回滚**：只回滚三个读面文件与 P4 测试，无盘面影响。

### P5：文档与全链

1. `docs/architecture/tracker-backend-normalized-model.md`
   - `:62`：`State` 两态注释补“Status→state 映射见第 4 节，状态本身不是新的 State 值”。
   - `:70-84`：`Issue` 能力字段列表补 `status` / `statusVisible` / `statusSource` / `statusConflict`，注明只有本地 Markdown 给。
   - `:211-217` 第 4 节重写：本地 Markdown **有** labels；非 triage 存 `DSH-LABELS`，triage 由可见 `Status:` 合成；`Issue.status` 可选；Status→state 映射；`statusVisible/statusSource/statusConflict` 仅 Markdown；`ListFilter` 不加 status 筛选。
2. `docs/adr/20261025-markdown-format-original.md:35-40`
   - 不改 2026-10-25 历史正文；在决定三后加“2026-11-02 补记”：可见 `Status:` 是技能原文要求的行内字段，不是插件新增；它是 issue 文件 triage 的唯一真源；`DSH-LABELS` 不含五 triage；新增 `DSH-STATUS-HISTORY`。
3. `docs/agents/issue-tracker.md:50` 与 `:54-58`
   - 补“本地 Markdown 的 triage 角色落在可见 `Status:`；`deck_issue_list` 仍按 labels 筛选，因为读侧会合成标签”。
   - 补 `deck_issue_patch` 冲突回执与 `data.retry.args` 的用法。
4. `docs/agents/triage-labels.md:28-42`
   - 补同一口径：位置表不变；ensureLabels 仍补角色；后端把角色落成可见 Status（issue 文件）或隐藏 DSH-STATUS（spec/map 容器）。
5. `GLOSSARY.md:458-465`
   - `:463` “实施票”词条：状态不再写在文件头隐藏注释，triage 状态写可见 `Status:` 行。
   - `:465` “动作类型”条目：补“本地 Markdown 读侧会把可见 Status 合成 triage 标签，所以按标签判断动作的代码仍成立”。
6. 全链：

```powershell
npm run verify:parallel
```

改过 `docs/**` 与 `*.md`，按仓规必须全链；Node 24.15+，本机 v24.19.0 满足。

**P5 回滚**：文档与代码分开，可单独回滚；不影响磁盘数据。

---

## 4. 测试矩阵与命令汇总

### 4.1 新增测试

| 文件 | 覆盖 | 主要断言 |
|---|---|---|
| `tests/verify-1790-status-model.ts` | 纯函数 | 词表、state 映射、默认、标签合成/过滤、history、冲突判定 |
| `tests/verify-1790-status-read.ts` | parse 读侧 | 4 票型 × 10 可见 × 9 隐藏矩阵；旧文件、非法值、wayfinder、容器 |
| `tests/verify-1790-status-write.ts` | 写侧 | 建票默认、setLabels、close/wontfix、reopen、归一、history |
| `tests/verify-1790-status-conflict.ts` | 冲突 | 读侧对象、后端拒绝不半写、deck 回执/retry、resolveStatus |
| `tests/verify-1790-status-surface.ts` | 读面 | get/list/snapshot 字段、text 冲突数、definition、薄地图行不变 |

### 4.2 必改的既有门禁

- `tests/verify-1106-deck-surface.ts`：`FROZEN_SHAPE` / `FROZEN_DESC` 加 `resolveStatus`；14 格信封、三态、八原因码不变。
- `tests/verify-1489-status-write.ts`：保留实施票既有断言；新增 bug 重开、wontfix、plain、wayfinder。
- `tests/verify-1489-claim-labels.ts`：隐藏 `DSH-LABELS` 只留非 triage；读回靠合成；未认领地图子票默认 `claimed`。
- `tests/verify-1788-write-route.ts`：A/B 认领不动可见 Status；E 在 route spec 下仍 `ready-for-agent`；补 plain 路线。
- `tests/verify-1059-issue-write.ts`：状态归一 / 失败走既有 `issue.write` 事件。
- `tests/verify-922-ticket-file-queue.ts`：状态读写仍走 `withFileWriter`。
- `tests/verify-md-format-config.ts`：新 YAML 条目与生成物一致。
- `tests/verify-markdown-backend.ts` 与 `tests/tracker-contract/fixtures/markdown.ts`：新字段不破坏契约夹具。
- `tests/verify-1403-kind-two-layer.ts`：建票落盘/读回仍按位置。
- `tests/verify-1605-markdown-map-list.ts`：薄地图行不变。
- `tests/verify-1509-update-strict.ts`：模板守卫不被绕过。
- `tests/verify-bug-entry.ts`：bug 入口默认状态。
- `tests/verify-golden-receipts.ts`：data 新字段如被冻住则重录。

### 4.3 每阶段命令

```powershell
# 单扇
node --import ./scripts/ts-hook.mts tests/verify-1790-status-model.ts
node --import ./scripts/ts-hook.mts tests/verify-1790-status-read.ts
node --import ./scripts/ts-hook.mts tests/verify-1790-status-write.ts
node --import ./scripts/ts-hook.mts tests/verify-1790-status-conflict.ts
node --import ./scripts/ts-hook.mts tests/verify-1790-status-surface.ts

# 按名字抽查全部 1790 门禁
node scripts/verify-chain.ts --only 1790

# 提交前全链
npm run verify:parallel
```

---

## 5. 回滚点与数据安全

| 阶段 | 提交内容 | 回滚方式 | 盘面影响 |
|---|---|---|---|
| P0 | 契约字段、YAML/派生、`status.ts`、模型测试 | 单独 revert | 无 |
| P1 | parse/route 读取、读侧测试 | 单独 revert | 无（只读） |
| P2 | 建票/写侧/归一、写侧测试 | 单独 revert，保留 P1 | 新写文件仍可被 P1 读；不要直接回到旧读侧 |
| P3 | deck 冲突流、definition、冲突测试 | 单独 revert | 后端仍拒绝冲突、不半写 |
| P4 | 三个读面、surface 测试 | 单独 revert | 无 |
| P5 | 文档 | 单独 revert | 无 |

补充：

- 不批量改写用户文件；旧文件兼容读，第一次显式写入才归一。
- 如果 P2 之后必须回到旧写侧：先确认生产工作区没有新格式文件，或先跑一次性迁移；否则列表筛选会暂时读不到 triage 标签。
- 如果 P3 回滚后仍有冲突票：按 `data.statusConflict` 的 visible/hidden 人工改文件，或保留新版本直到解决；不要让旧代码反复重试。
- 每阶段提交前跑 `git status`，只 add 本阶段文件；工作区已有他人未提交的 `suggest-next-steps` 改动，不要卷进来。

---

## 6. 风险与需要提前决定的小口径

1. **parse 行数**：`parse.ts` 当前有效行 350，已顶格。P1 是净删旧状态判断 + 调用新模块，必须保证不涨；如果涨了，把 `statusInBody` / 历史读写也挪出 parse。
2. **create-render 行数**：当前 340；把默认状态表与标签过滤放进 `status.ts` 后应净减；如果不够，把 `originalKindOf` 的推断表也搬进 `status.ts`。
3. **issue-patch 行数**：当前 338；新逻辑全放 `issue-patch-status.ts`，`issue-patch.ts` 只加调用与组装，控制在 350 以内。
4. **container 的 labels**：spec 建票会补 `ready-for-agent` 标签，容器继续保留，不能被 `hiddenLabelsOf` 误删。测试要钉住“spec 容器关闭后标签仍在”。
5. **`deck_issue_patch` 的成本**：冲突预检多一次 `t.get`，归一多一次写；`claimed` 按实测记，不要估。`verify-1106` 的点数表若断言具体成本，要同步。
6. **`body` 片段里的 Status**：`deck_issue_patch` 的 body 可能是整份也可能是片段；`statusInBody` 只看一级标题前的 `Status:` 行，避免把正文里的示例文本当成显式状态。
7. **history 长度**：冲突罕见，不做上限；同一条不重复追加。若担心文件膨胀，可在实现时加“最多保留最近 10 条”，但计划里不默认加，避免超出契约。
8. **旧默认的判断**：旧默认只对 issue 文件成立；spec/map 容器的 `DSH-STATUS: ready-for-agent` 不是“旧默认”，容器不参与这条兼容规则。
9. **没有 Status 的 wayfinder 子票**：新契约默认 `claimed`，但 `assignees` 仍为空；不要因为默认状态就凭空造一个认领人。
10. **plain issue 的非法可见 Status**：最终没有 `status`，但 `statusVisible` 保留原值；测试要钉住“不因为非法值就变成 closed/open 以外的状态”。

---

## 7. 执行清单

- [ ] P0-1 契约字段与类型（entities/inputs）
- [ ] P0-2 YAML、field-values、生成物、格式门禁
- [ ] P0-3 `status.ts` 纯函数与模型测试
- [ ] P1-1 parse 读侧与 meta 路线
- [ ] P1-2 locate/read/create 读回传 route
- [ ] P1-3 读侧矩阵测试与夹具
- [ ] P2-1 create-render / map-render 建票默认与标签过滤
- [ ] P2-2 issues-patch setLabels / update labels 归一
- [ ] P2-3 issues-status close/reopen/wontfix
- [ ] P2-4 写侧测试与既有门禁更新
- [ ] P3-1 `issue-patch-status.ts` 与 definition
- [ ] P3-2 issue-patch 冲突预检/retry/归一
- [ ] P3-3 冲突测试与 verify-1106/金标准
- [ ] P4-1 issue-get/list/map-snapshot 字段
- [ ] P4-2 读面 surface 测试
- [ ] P5-1 normalized-model / ADR / issue-tracker / triage-labels / GLOSSARY
- [ ] P5-2 `npm run verify:parallel`

---

## 8. 明确不做

- 不做缺陷 B（#1799 的通用原因码 / partial 语义）。
- 不做 #1800 的 `[object Object]` 显示问题。
- 不批量迁移用户已有文件。
- 不改 GitHub/GitLab 后端。
- 不改 spec/map 容器的隐藏 `DSH-STATUS` 写法。
- 不给 `ListFilter` 加 status 筛选，不把 `state` 扩成三态。
- 不新增 `comment` 的 opts 参数；冲突归一走 `setLabels` 的 `status` 选项。
- 不把 `data.retry` 放进后端 `OpResult`；retry 只在 deck 层生成。
