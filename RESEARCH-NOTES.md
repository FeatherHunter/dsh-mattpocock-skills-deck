# RESEARCH-NOTES · DSH-Waystation 构建期研究（T1 #343）

> 研究人：父会话（原 T1 子代理两轮无产出，2026-08-14 改由父会话实测完成）。
> 全部结论均以 `gh 2.97.0`（FeatherHunter，keyring）对 `FeatherHunter/SKILLS` 实测；DSH 契约以安装目录
> `C:\Users\辰辰洋洋\AppData\Local\npm-cache\_npx\1e7f6d9597241db0` 内类型定义为准。

---

## 1. GitHub 原生 sub-issues / blocks 读取

### 1.1 REST：sub-issues ✅ 可用

```powershell
& "D:\0Tools\GitHubCLI\gh.exe" api "repos/FeatherHunter/SKILLS/issues/342/sub_issues" --jq '.[] | [.number, .state, .title] | @tsv'
```

- 返回**数组**：`[{number, state, title, ...issue 全字段}]`（实测 6 条子票 343–348 全部返回）。
- 结论：**可用**，适合列表页；但子票各自还缺阻塞/认领信息，需二次查询。

### 1.2 REST：blocks ❌ 不存在

- `repos/.../issues/348/blocks` → **404**
- `repos/.../issues/348/dependents` → **404**
- 结论：**不要用 REST 读阻塞**；阻塞关系读原生 connection 字段（见 1.3/1.4）。

### 1.3 `gh issue view --json` 原生字段 ✅

`gh issue view <n> --json` 可用字段（gh 2.97 实测提示）：`assignees, author, blockedBy, blocking, body, closed, comments, labels, milestone, number, parent, state, subIssues, subIssuesSummary, title, updatedAt, url` 等。

- `subIssues` / `blockedBy` / `blocking` 均为 **connection 对象**：`{"nodes": [{id, number, state, title, url}...], "totalCount": N}`
- 实测：#348 blockedBy.nodes = [#347,#344,#346,#345]（4 个）；#343 blocking.nodes = [#347,#346,#345,#344]；#343 assignees = 0。
- 结论：单票详情可用；但**每票一次调用 = N+1 查询**，列表场景不划算。

### 1.4 GraphQL 单查询（推荐 · T3 数据层方案）✅ 已验证

每张 map **一次查询**拉全量子票 + 阻塞边 + 认领。用 `gh api graphql --input <json>`，变量内联（避开 PowerShell 引号坑）：

```json
{"query":"query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){number title state subIssues(first:100){totalCount nodes{number title state url assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}}}}}}}","variables":{"owner":"FeatherHunter","name":"SKILLS","n":342}}
```

```powershell
& "D:\0Tools\GitHubCLI\gh.exe" api graphql --input gql.json --jq '.data.repository.issue.subIssues.nodes[] | [.number, .state, (.blockedBy.nodes | length), (.assignees.nodes | length)] | @tsv'
```

实测输出（与 GitHub 页面一致）：

```
343  OPEN  0  0   ← frontier（无阻塞、未认领）
344  OPEN  1  0
345  OPEN  1  0
346  OPEN  3  0
347  OPEN  2  0
348  OPEN  4  0
```

**结论：T3 数据层采用「每 map 一次 GraphQL」**；frontier = state==OPEN && blockedBy.nodes 为空 && assignees 为空。

### 1.5 写操作（已由制图期实测）

- 建子票：`gh issue create --parent <map号>`（gh ≥ 2.63）
- 补挂父：`gh issue edit <子票号> --parent <map号>`
- 阻塞：`gh issue edit <子票号> --add-blocked-by <号,号,...>` / `--add-blocking`
- 认领：`gh issue edit <子票号> --add-assignee @me`（语法与 --add-blocked-by 同族，构建期仍实测一次）
- 评论：`gh issue comment <n> --body-file <path>`
- 关闭：`gh issue close <n>` / `gh issue edit <n> --state closed`

---

## 2. DSH Client `InputActions`（写输入框）✅

来源：`node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/input/contract.d.ts`

```ts
export interface InputActions {
    setDraft(text: string): void;      // 公开唯一草稿写路径（全文替换；diff 扫描算 occurrence）
    addImages(ids: readonly DraftAttachmentId[]): boolean;
    removeImage(id: DraftAttachmentId): void;
    pruneImages(ids: readonly DraftAttachmentId[]): void;
    submit(): void;                    // 进入提交（adjudication / claim / 默认 sink）
}
```

- 获得方式：`conversation.input.dock` / `conversation.input.left` / `.right` / `conversation.composer.dock` 等 session 级插槽的 **standardProps** 之一（`inputActions`）；只读快照用 `useInput`（`InputState: { draft, draftRev, phase, occurrences, queue, ... }`）。
- owner props（InputZone）：`{ session: ConversationSnapshot, input: InputState }`。
- **注入实现**：`props.inputActions.setDraft('/wayfinder\n<url>\n<指令>')` 即可；「直接发送」可用 `submit()`（原型阶段先不自动发送，保持用户确认）。
- 兜底：剪贴板（navigator.clipboard 需页面上下文，原型里直接试 setDraft，失败再降级）。

---

## 3. Host `approval` 服务（P1 备用）✅

来源：`node_modules/@deepseek-ai/dsh-user-approval/lib/types/index.d.ts`

```ts
approval.request(req: ApprovalRequest): Promise<ApprovalOutcome>
interface ApprovalRequest {
    agent: Agent; toolName: string; callId?: CallId; reason?: string; signal?: AbortSignal;
}
```

- 语义：为**工具调用**提问（callId 关联已流式的 tool call）；要求 open turn（idle 时直接拒绝）；策略 `'never'` 时**每次 ask 自动拒绝**（无提示）。
- **结论：插件 UI 动作（gh comment / assign / close）不走 approval 服务** —— 用户明确点击按钮本身就是同意，UI 内二次确认即可。approval 只留给模型工具的写操作（P1 的 wayfinder_fixate 模型工具），且受当前 'never' 策略限制，设计时按「UI 优先」走。

---

## 4. PowerShell 引号坑（Windows 实测）⚠️

- Windows PowerShell 5.1 调原生命令（gh）会**吞掉参数内嵌的双引号**：
  - jq 表达式里的 `"..."` 字符串字面量会变成无引号 → 语法错误；
  - `gh api graphql -f query='query{...owner:"FeatherHunter"...}'` 内联引号同样被吞。
- 规避：
  1. jq 里避免字符串字面量（用 `@tsv` / `@csv` / 数字计数）；
  2. GraphQL 查询用 `--input <json文件>` 且**变量内联进 JSON**（`{"query":..., "variables":{...}}`）；
  3. 长 body 一律 `--body-file <文件>`。
- DSH Host 插件内跑 gh 用 `subprocess.spawn`（不经 PowerShell），无此坑；此坑只影响调试/自测命令。

---

## 5. 遗留

- ✅ ~~`gh issue edit --add-assignee @me` 首次实测~~（T5 #347 完成）：语法可用；⚠️ PowerShell 直调会吞掉 `@me`（报 flag needs an argument），需引号包裹；host 侧 spawn argv 数组无此问题。
- 60s 轮询的 API 配额观察（P1）。

---

## 6. 数据层实现（T3 #345 · 2026-08-14）

### 6.1 实现落点

`dsh-plugin/dsh-waystation/host.js`：

- **gh 封装**：`subprocess.resolveExecutable('gh')` → 兜底 `fs.lstat('D:\0Tools\GitHubCLI\gh.exe')`；30s 超时（`Promise.race` done × `timer.timeout` + `handle.terminate()`）；错误归一化 `auth / network / notfound / exit / spawn`。
- **数据流**：`gh issue list --state open --label wayfinder:map --json ...` 枚举 → 每 map 一次 GraphQL（`subIssues + labels + assignees + blockedBy + blocking`，`-F` 变量直传，Node spawn 无引号坑）→ `parseMapBody` 五区块解析（Destination/Notes/Decisions so far/Not yet specified/Out of scope）→ `groupTickets` 分组（frontier = open + 无 open blocker + 未认领）。
- **RPC**：`wf.ping` / `wf.snapshot`（5s 缓存，`args.cwd` 可覆盖）/ `wf.refresh` / `wf.claim`（#347：`gh issue edit <n> --add-assignee @me` + 缓存失效 + 返回 assignedTo/url）。
- **轮询**：`timer.interval` 60s + 与上次 stats diff（新 closed / 新 frontier，P2 toast 预留）。

### 6.2 验证（verify.js + 真实 gh 数据）

- 9 张 open map（含并发会话新建的 #357/#349/#305/#270/#260）—— **快照必须全量动态枚举，不可硬编码**。
- #342 分组与 GitHub 页面核对：`frontier=[344] claimed=[345] blocked=[346,347,348]` **PASS**（认领中的票算 claimed，且其 open 状态会阻塞下游 —— 347 被 345 阻塞即为实证）。
- **容错事实**：9 张 map 仅 4 张有 Destination —— body 解析对缺节/半成品 body 全部兜底（空串/空数组，不抛错）。

### 6.3 subprocess 契约要点（host 侧写 gh 的标准姿势）

- `spawn({ argv, cwd, stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes } }, graceMs, signal? })`，argv 不经过 shell。
- 输出：`handle.collected.stdout.readFrom(offset)` → `{ text, nextOffset, lossy, spillPath? }`；`handle.done` → `{ exitCode, signal }`。
- host 无 `AbortController`/`process` 全局 —— 超时用 `timer.timeout(delay)` race + `handle.terminate()`。
