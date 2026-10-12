# 一次 deck 工具调用的全程走查（第一版）

这份文档回答一个问题：AI 在对话里调一次 `deck_*` 工具，从它按下手的那一刻起，代码里到底经过了哪些环节、每一环交出去的是什么、哪一环可能失败、失败以后 AI 看到的是哪一句话。

它服务两张票：

- #1022（地图 01 讲解）：讲解时改这一份，不另开新文件。
- #1077（收口核对）：核对代码时对着这一份核对，行号对不上就是代码动了、文档该跟。

放 `docs/tour/` 是因为 #1094 正文写的就是「建议新开一份，放 `docs/tour/` 之类的位置」——这个目录此前不存在，本文件是它的第一份。

## 怎么用这份文档

- 每一层都给出「谁调用谁 / 传什么 / 失败长什么样」，并指到真实文件与行号。
- 行号是写这份文档时的仓库状态（基线提交 `f1dc6376`）。代码改动之后行号会漂，改代码的人顺手改这一份。
- 九个工具**共用**前面三段路（进门 → 取会话 → 选后端 → 过闸 → 进房间），只在「进房间之后调哪一个契约操作」和「最后落到哪个底层」上分叉。所以先读第 1 到第 6 层，再看第 8 层的九张索引卡。
- 三座底层：**gh 进程**（GitHub 房间，第 7.1 节）、**工作区里的 Markdown 票文件**（本地房间，第 7.2 节）、**快照缓存**（第 7.3 节）。

## 一眼看全的总图

```
对话里的 AI
  │  ① 工具从哪来：宿主启动时把九个工具注册进工具服务
  ▼
工具服务（DSH 的 tools 服务）        src/shared/deck-tools/agent-register.js:306
  │  ② AI 发起调用 → 工具服务调 execute(args, exec)
  ▼
makeExecute                          src/shared/deck-tools/agent-register.js:275
  │  ③ run(exec, args)
  ▼
九个工具各自的 run                   src/host/tools/deck*.js
  │  ④ 取会话目录   sessionContextOfAsync   src/shared/deck-tools/session-resolve.js:28
  │  ⑤ 选后端       shell.pickBackend       src/shared/deck-tools/shell.js:164
  │  ⑥ 过闸 + 真干活 shell.call             src/shared/deck-tools/shell.js:266
  ▼
后端注册表选出的 Tracker             src/host/tracker/registryCore.js:129
  │  ⑦ registry.get(backendId) → 某座房间的门面对象
  ▼
房间门面（契约的那一组操作）          src/host/tracker/backends/github/backend.js:66
                                     src/host/tracker/backends/markdown/index.js:87
  │  ⑧ 房间内部函数（真正做事的那些）
  ▼
最底层：
  · gh 进程                src/host/tracker/backends/github/client.js:234   exec('gh', args, …)
  · 工作区 Markdown 文件    src/host/tracker/backends/markdown/write.js:21   fs.resolve + fs.writeText
  · 快照缓存               src/host/tracker/snapshot.js:214                 composeSnapshot
```

---

## 第 1 层：AI 手上的九个工具是从哪来的

这一层发生在**宿主启动时**，不在 AI 调用时——但后面所有事情都建立在它上面。

1. 宿主接线跑起来，调一次自举钩子：
   `src/host/refresh/wiring.js:309`
   `hookDeckAgentTools(d.ctx, deckToolsForHost, () => Promise.resolve(null), makeDeckRegisterReport(logCtx))`
   `loadDefineTool` 固定传 `null`，也就是不走框架包的官方写法，直接按注册表认的形状把纯数据对象交出去（原因写在 `wiring.js:306-308`：从前动态 import 自带副本，挂载后所有调用都报 `prepare undefined`）。

2. 钩子等两样东西都就绪，各等最多五轮、每轮两秒：
   `src/shared/deck-tools/agent-register.js:393-437`
   - 先要**那张表**（`table(retries)`，:405-411）
   - 再要**工具服务**（`attempt(left)`，:415-434）
   任一步走不通都只记一条日志、不抛——工具注册不上，宿主照样起得来。

3. 那张表这样装出来：
   `src/host/refresh/wiring.js:310-358`（`deckToolsForHost`）
   → `src/host/platform/deckToolsAssembly.js:87-117`（`createDeckToolsForHost`）
   → `src/shared/deck-tools/plan.js:109-122`（`createDeckTools`）
   表里每个工具是 `{ definition, run }`，键是工具名；哪个工厂装不起来就少哪个，缺的如实列在 `missing` 里，**不补假桩**（`plan.js:107`）。

4. 注册的九个名字与顺序由一份常量钉死：
   `src/shared/deck-tools/plan.js:100-102`（`DECK_TOOL_ORDER`）
   `deck_context` / `deck_issue_get` / `deck_map_snapshot` / `deck_issue_list` / `deck_issue_create` / `deck_map_plan_create` / `deck_map_link` / `deck_issue_patch` / `deck_issue_report`

5. 真正交到工具服务手里：
   `src/shared/deck-tools/agent-register.js:306-362`（`registerDeckAgentTools`）
   每个工具包一层 `execute`（:322），注册时带 `timeoutMs: AGENT_TOOL_TIMEOUT_MS`（:331，值 120000，定义在 `agent-register.js:16`）。

6. 同一张表还放进一个**同进程共享格**，给面板那条路直接用、不经调用面：
   `src/host/refresh/wiring.js:359` → `src/shared/deck-tools/exec-cell.js` 的 `publishDeckTable`

**这一层失败长什么样**

- 服务或表一直不就绪：`hookDeckAgentTools` 静默结束，AI 手上根本没有这些工具（对话里看不到工具）。
- 注册成功与否落两条既有日志，不新增事件名：`agent-register.js:370-383`（`host.call` / `host.call.fail`，`method: 'deck.agentRegister'`）。

---

## 第 2 层：一次调用怎么进到 `run`

有两条入口，最后都落到同一个 `run`：

**入口一：对话里的 AI（主线）**

```
工具服务 → makeExecute(run) 的 execute(args, exec)   agent-register.js:275-294
        → run(exec, args)                            九个工具各自的 run
```

`makeExecute` 是每次调用的第一道兜底（:275-294），它保证**工具永远不把异常抛给 AI**：

| 情形 | 判据（行号） | AI 看到的 |
| --- | --- | --- |
| 调用已被中止 | :278-280 | `status: 'unsupported'`、`reason: 'aborted'`、「这次被中止了，没做完：请按需重调一次。」 |
| 参数不是对象 | :281-283 | `reason: 'bad-args'`、「参数不是一个对象，我没法做：请按这个工具的参数说明重调一次。」 |
| `run` 抛了异常 | :285-289 | `reason: 'backend-threw'`、「这次没做成（内部执行抛错，已拦下）：…」 |
| `run` 回包不合约定 | :290-292 | `reason: 'backend-threw'`、「这次没做成（工具内部没按约定回包，已拦下），请重试或走面板操作。」 |

**入口二：宿主电话 `wf.deckExec`（面板那条路）**

```
src/host/index.js:240            harness.handle('wf.deckExec', …)
  → src/host/platform/deckExec.js:48-92   handleDeckExec(args)
```

它做三件事：校验工具名在 `DECK_TOOL_ORDER` 里（:57）、取那张表（:71-72，取不到就如实说表不在）、调 `run` 并把三种回包形状压成一种（`pickValue`，:26 / :83）。

---

## 第 3 层：九个工具的入口（进门后的共同三步）

每个 `run` 的前半段都做同样三件事，顺序也一致：

1. **参数归一与校验**：能从参数里判出「没法做」的（缺票号、缺标题、缺子票），在这里就用 `shell.unsupported(..., BAD_ARGS, …)` 直接回，不往下走。
2. **取会话目录**：`sessionContextOfAsync(exec, …)`。
3. **选后端**：`shell.pickBackend(exec, s)`。
4. **进预算壳**：`shell.call({ tool, kind, session, pick, repo, estimate, sandbox }, work)`。

九个工具的落点（行号为基线提交状态）：

| 工具 | 入口文件 | `definition` | `run` | 干什么用 | 参数校验 | `shell.call` |
| --- | --- | --- | --- | --- | --- | --- |
| `deck_context` | [deckContext.js](../../src/host/tools/deckContext.js) | :32-37 | :51-136 | 读：确认工作区与后端 | 无参数（:36） | :75 |
| `deck_issue_get` | [deckIssueGet.js](../../src/host/tools/deckIssueGet.js) | :30-45 | :77-177 | 读：一张票连同关系 | :90 key 必填 | :108 |
| `deck_map_snapshot` | [deckMapSnapshot.js](../../src/host/tools/deckMapSnapshot.js) | :26-41 | :66-161 | 读：一张地图的全部子票 | :72 key 必填 | :80 |
| `deck_issue_list` | [deckIssueList.js](../../src/host/tools/deckIssueList.js) | :15-33 | :73-182 | 读：按状态/label/人列薄行 | :75-82 参数归一 | :101 |
| `deck_issue_create` | [deckIssueCreate.js](../../src/host/tools/deckIssueCreate.js) | :38-57 | :70-198 | 写：建一张票 | :77 title 必填 | :97 |
| `deck_map_plan_create` | [deckMapPlanCreate.js](../../src/host/tools/deckMapPlanCreate.js) | :25-69 | :105-340 | 写：建整张地图骨架 | :113-115 title + 至少一张子票 | :150 |
| `deck_map_link` | [deckMapLink.js](../../src/host/tools/deckMapLink.js) | :24-48 | :60-206 | 写：补父子边与阻塞边 | :65-66 至少一条边 | :73 |
| `deck_issue_patch` | [deckIssuePatch.js](../../src/host/tools/deckIssuePatch.js) | :37-58 | :113-276 | 写：改票 | :119 key；:135-137 至少点一件事 | :139 |
| `deck_issue_report` | [deckIssueReport.js](../../src/host/tools/deckIssueReport.js) | :34-48 | :67-147 | 写：上报当前在办哪张票 | :73 key 必填 | :89 |

九个工具都先取一次**沙箱策略**（`d.sandboxPolicyFor`，各文件里的 `withCap(..., SANDBOX_TIMEOUT_MS)`，5 秒上限；拿不到按 `null` 走，不拦事），再把它塞进 `shell.call` 的 `sandbox` 字段。

### 第 3.1 步：会话目录怎么取出来（`sessionContextOfAsync`）

`src/shared/deck-tools/session-resolve.js:18-47`，两步：

1. **先按六个候选字段挨个试**（同步版 `sessionContextOf`，:18-27；候选清单在 :20）：
   `exec.agent.session.cwd` → `exec.agent.session.workspaceRoot` → `exec.agent.session.workspace.cwd` → `exec.agent.cwd` → `exec.session.cwd` → `exec.cwd`
   取到第一个非空字符串就用它，并把「取自哪一个」记在 `source` 里。
2. **再归一到工作区根**（异步版 `sessionContextOfAsync`，:28-47）：调接线给的 `canonicalKey`（:37，5 秒上限 `CANONICAL_TIMEOUT_MS`）。归一成功就用根目录，失败**不凑合**、按 `NO_SESSION` 如实失败（:39-42）。

**失败长什么样**：`sessionContextOf` 六个候选都没值 → `reason: 'no-session-context'`，`text` 是「这次没拿到当前会话的工作区目录，所以我不动任何票。」（:24）。归一失败是「这次没能把工作区目录归一到工作区根，所以我不动任何票。」

九个工具都在拿到会话之后立刻判它成不成，不成就不往下走，例如 `deck_context.js:54`、`deck_issue_get.js:86`。

---

## 第 4 层：选后端（全插件只有一个判定出口）

`src/shared/deck-tools/shell.js:164-250`（`pickBackend`）。

**谁调用谁 / 传什么**

```
pickBackend(exec, s)
  ├─ 目录空？                    :165            空 → NO_BACKEND
  ├─ 会话→句柄                  :167  d.handleFor(s)
  ├─ 动手前保一次剩余额度读数     :172  d.ensureReading(cwd, workspaceKey)
  ├─ 过闸跑统一判定出口          :187  gate.send({kind:'probe'}, …)
  │     └─ d.decideBackend(cwd, {registry, backendCtx, readWorkspaceFileText,
  │                             parseWorkspaceFile, readDeclarationId, autodetect})
  │           → src/host/tracker/detection/backendDecision.js:182-231
  ├─ 仓库标识补全（缺 refId 时）  :214-239  tracker.getRepoKey + 三层兜底，8 秒上限
  └─ 结论                        :240-249
```

**判定出口里的四层**（`backendDecision.js:80-98` 的 `decidePure`）：内存里这次会话亲手绑过的 → 工作区里的选择文件 → 声明文件 `docs/agents/issue-tracker.md` → 自动识别（`registry.select` 三级联）。**没有记忆层**——插件不替人记「上次选了什么」。

**读用途与写用途的门槛不一样**（:246）：判定结论不是来自「你亲手选过」的，写用途一律不做，读用途不受影响。原话：「这个工作区还没选定后端：现在这个结论是按仓库里的说明文件或自动识别得出的，不算你亲手选过，所以我没有动任何东西。请先在面板上选定这个工作区使用的后端，然后重试。」

**失败长什么样**

| 情形 | 行号 | `reason` | AI 看到的一句话 |
| --- | --- | --- | --- |
| 目录还没就绪 | :165 | `no-backend` | 「这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。」 |
| 判定出口没装上 | :177-180 | `backend-threw` | 「判定出口这次没装上，我没往下做。请重试一次；……」 |
| 出口自己抛错 | :206 | `backend-threw` | 「选后端这一步的后端实现抛错了，我没往下做。」 |
| 被闸推迟 | :207-210 | `gate-defer` | 「这一次选后端被闸推迟了（…），先不做。」 |
| 多命中/还没定 | :240-244 | `no-backend` | 「这个工作区同时被 N 个后端认出，请在面板中选定后再试。」／「后端还没定下来，先在面板上选一次后端。」 |
| 写用途、但不是亲手选的 | :246 | `no-backend` | 见上面那段原话 |

选成功以后，`repoOf`（:253-263）把「后端 id + 句柄」拼成一个仓库身份对象，缺字段就用后端 id 顶上，**不造假名字**。

---

## 第 5 层：进预算壳、过一次闸（`shell.call`）

`src/shared/deck-tools/shell.js:266-332`。这是每笔工具调用真正动手的地方，做四件事。

**① 硬顶（`gate.admitAiTool`，:270）**

```
gate.admitAiTool({ points, requests, childTickets }, { workspaceKey, kind: 'tool-batch', bucket: 'graphql' })
```

估算是调用前算好的（`shell.js:123-131` 的 `estimateFor` → `src/shared/refresh/tool-cost.js:23-55`）。硬顶的五个数在 `src/shared/refresh/budget.js:27-31`：

| 常量 | 值 |
| --- | --- |
| `AI_TOOL_MAX_POINTS_PER_CALL` | 600 |
| `AI_TOOL_MAX_REQUESTS_PER_CALL` | 400 |
| `AI_TOOL_MAX_POINTS_PER_HOUR` | 2000 |
| `AI_TOOL_MAX_REQUESTS_PER_HOUR` | 1500 |
| `AI_TOOL_MAX_CHILD_TICKETS_PER_CALL` | 60 |

顶住了就回 `reason: 'ai-tool-refused'`，文案是闸自己那句原话（`shell.js:150-156`）——工具不自己编一个数。

**② 过闸记账（`gate.send`，:292-299）**

闸的实现是 `src/host/refresh/gate.js`（`admitAiTool` :295、`send` :226、四种类别 :28）。

**③ 干活（:294-299）**

工具自己那段 `work(ctx)` 在这里跑。`ctx` 里带着（:281-290）：会话、选出的后端与仓库、闸、注册表选出的 `tracker`、以及 `opCtx`（`platform` / `fs` / `exec` 那一套，加上 `cwd`、`caller: 'deck-tool'`、沙箱策略、会话号）。
`work` 回来的 `claimed`（这一笔实际花了多少请求/点数）原样记进账（:297-298）。

**④ 收口（`mergeOutcome`，:335-355）**

把工具那份结果并进统一信封（状态、逐项、注记、写后读回值），并且**写过的票要让宿主那侧的快照缓存作废**（:347-352，调接线给的 `d.invalidate`，位置在 `src/host/refresh/wiring.js:344`）。

### 单次钳制与中止（`withCallScope`）

工具里那些「一次调用可能要发好几笔远端请求」的地方，会再包一层预算壳：`src/shared/deck-tools/call-scope.js`

| 常量 | 值 | 行号 |
| --- | --- | --- |
| `DEFAULT_TOOL_TIMEOUT_MS` | 120000 | :16 |
| `DEFAULT_TOOL_MARGIN_MS` | 10000 | :17 |
| `DEFAULT_PER_OP_TIMEOUT_MS` | 30000 | :18 |

- `withCallScope` :148-158，`execOp` :167-198（单笔钳制 + 可中止，中间还会问 `outOfBudget()` 决定要不要停发下一笔）。
- 超时/被中止/额度不够这三种回执的文案在 :132-140。
- `tracker` 包装在 :229-321：读操作（get / list / dependencies）带记忆，写操作穿透。

### 三种状态与七种「没做成」的原因

`src/shared/deck-tools/shell.js:26-38`

- 状态三值（`DECK_STATUS`）：`ok` / `partial` / `unsupported`
- 原因七值（`REFUSAL_REASONS`）：
  `no-session-context` / `ai-tool-refused` / `no-backend` / `gate-defer` / `backend-threw` / `backend-unsupported` / `bad-args`

另外有四个**传输层**标记，工具用它区分「后端诚实说做不到」和「这一趟根本没回来」（`deckContext.js:25`、`deckIssueCreate.js:31`、`deckIssuePatch.js:25`、`deckIssueReport.js:27`）：

`backend-threw` / `timeout` / `aborted` / `over-budget`

拿到这四个之一时，工具**当场抛**，让壳收成三态（例：`deckIssueCreate.js:107-108`），而不是当成「后端做不到」记下来。

---

## 第 6 层：后端契约与注册表

**契约**（`src/host/tracker/contract.js`）：一座房间要能被工具用，得实现这组操作（:29-51 的 `Tracker` 接口，:58-74 的 `OPERATIONS`）：

`preflight` / `list` / `counts` / `listPage` / `get` / `getDependencies` / `create` / `close` / `reopen` / `comment` / `update` / `setLabels` / `setAssignees` / `setParent` / `setBlockedBy`

少实现的那几条由注册表的代理补一个「做不到」的桩（`contract.js:119`）。

**注册表**（`src/host/tracker/registryCore.js`）：

- `select` :129-176：三级联——显式绑定 > `matches` 认出 > 兜底；顺带算出 `pending` / `multiHit`。
- `bind` :179-186、`describe` :194-198。
- `shell.js:287` 拿到的 `tracker` 就是 `registry.get(backendId)`。

**三座房间的门面**（契约操作 → 房间内部函数）：

- GitHub：`src/host/tracker/backends/github/backend.js:66-138`
- 本地 Markdown：`src/host/tracker/backends/markdown/index.js:87-154`（操作映射在 :124-141）
- GitLab：`src/host/tracker/backends/gitlab/index.js:112-124`

---

## 第 7 层：三座最底层

### 7.1 GitHub 房间：最后是 `gh` 进程

**唯一出口**：`src/host/tracker/backends/github/client.js:149-291`（`execGh`）。所有对 GitHub 的读写都从这里出去，房间里没有第二个起进程的地方。

| 环节 | 行号 | 做什么 |
| --- | --- | --- |
| 分桶 | :153 | `isWriteGhArgs(args) ? 'write' : 'read'` |
| 定档超时 | :155 | `timeoutForGhArgs(args)`：读 12 秒 / 写 30 秒 / 探活 3 秒（`src/shared/tracker/outbound-tiers.js:15-17`） |
| 房内自己掐表 | :161-177 | 计时器从**拿名额那一刻**开始，盖住排队段（原因见 :156-159） |
| 拿名额 | :204 | `getGhLane().acquire({bucket, signal})`：满了就排队，「等」不算失败 |
| 报出站 | :232 | `reportOutbound(ctx, args)`——真要起进程了才报，排队中被取消的不进账 |
| **起进程** | **:234** | **`exec('gh', args, { cwd, timeout, signal })`** |
| 退出码归一 | :242-259 | 拿不到整数退出码按 `-1` 记失败，不再当 0（:238-243 讲了为什么） |
| 错误分类 | :254 | `classifyGhError`（`src/host/tracker/backends/github/errors.js:64-106`，顺序 env > auth > rate-limit > network > not-found > parse） |

**九个工具在 GitHub 房间各发什么命令**

| 工具 | 契约操作 | 房间函数 | 实际发出的命令 |
| --- | --- | --- | --- |
| `deck_context` | `list(type: map)` | `issues.js:128-236` | GraphQL 优先，失败降级 `gh api repos/{o}/{r}/issues`（:74） |
| `deck_context` | `getRepoPermissions` | `repo-permissions.js:69` | `gh api repos/{o}/{r} --jq .permissions` |
| `deck_issue_get` | `get` | `issues.js:241-331` | `gh api repos/{o}/{r}/issues/{n}`（:293），PR 走 `/pulls/{n}`（:304） |
| `deck_issue_get` | `getDependencies` | `graph.js:172-215` | 全仓扫 blockedBy，再反向聚合 |
| `deck_map_snapshot` | `get` + `list(parentKey)` | `issues.js` / `sub-issues.js:44` | `gh api repos/{o}/{r}/issues/{n}/sub_issues?per_page=100` |
| `deck_issue_list` | `list` | `issues.js:128-236` | 同 `deck_context` 那一条 |
| `deck_issue_create` | `create` | `issues-write.js:29-145` | `gh api repos/{o}/{r}/issues --method POST -f title=… -f body=…`（:48）；标签另补 `gh issue edit --add-label`；认领另补 `--add-assignee`；父票另补 `gh issue edit --parent` |
| `deck_map_plan_create` | `create` ×N + `setParent` + `setBlockedBy` | 同上 + `graph.js` | 同上；边是 `gh issue edit --parent`（:113）/ `gh api …/dependencies/blocked_by --method POST`（:303） |
| `deck_map_link` | `setParent` / `setBlockedBy` | `graph.js:52-140` / `graph.js:239-330` | `gh issue edit --remove-parent`（:89）→ `--parent`（:113）；阻塞边 `--method DELETE`（:291）/ `--method POST`（:303） |
| `deck_issue_patch` | `comment` | `comments.js:38` | `gh api repos/{o}/{r}/issues/{n}/comments --method POST -f body=…`（降级 `gh issue comment`，:42） |
| `deck_issue_patch` | `setLabels` | `labels.js:118,122` | `gh issue edit --remove-label` / `--add-label` |
| `deck_issue_patch` | `update` | `issues-write.js:233` | `gh issue edit --title/--body`，改完再 `gh issue view` 取回（:239） |
| `deck_issue_patch` | `close` / `reopen` | `issues-write.js:155,191` | `gh issue close` / `gh issue reopen` |
| `deck_issue_patch` | `setAssignees` | `issues-write.js:304,308` | `gh issue edit --remove-assignee` / `--add-assignee` |
| `deck_issue_report` | `get` | `issues.js:241` | 与 `deck_issue_get` 同一条；上报本身只写本地链，不出网 |

**失败长什么样**

- 命令没起来（`gh` 不在 PATH、没登录）：`kind: 'env'` 或 `'auth'`，`code: -1`。
- 到点没回话：`kind: 'network'`，原文「gh 在 N 毫秒内没有回话（房内分档超时：读 12 秒 / 写 30 秒 / 探活 3 秒），这一笔已经中止」（:199）。
- 排队中被取消：「已取消排队（出站准入等待中被取消），没有发出请求，可重试」（:213）。
- 命令跑了但退出码非 0：按 `classifyGhError` 分类，退出码一起交回调用方（:257-259）。

### 7.2 本地 Markdown 房间：最后是工作区里的票文件

**票文件在哪**：`src/host/tracker/backends/markdown/path.js:24-42`（`mdPath`）

- 地图：`<工作区根>/.scratch/map.md`（:36）
- 单票：`<工作区根>/.scratch/issues/<键>.md`（:39；文件名规则在 :16-23——纯数字键补成 `NN-untitled.md`）
- 带 effort 范围时一律落到 `<cwd>/.scratch/<effortId>/` 下面（:48-66 的注释与 `effortIssuePath`）

**读**（`src/host/tracker/backends/markdown/`）

| 环节 | 文件:行号 |
| --- | --- |
| 真正读文件 | `read.js:4-10`（`fs.resolve` + `fs.readText`，三种 fs 形状挨个试） |
| 判断存在（含沙箱形状差异） | `read.js:18-39`，:20-22 记着「lstat 是路径形、stat/readText 是目标形」这个坑 |
| 列票行（三种文件形态兜底） | `issues-read.js:32-105` |
| 列清单 | `issues-read.js:107-144` |
| 读一张票 | `issues-read.js:145-170`（`00` 是地图，:154 读 `map.md`） |

**写**（四条路，都先排队）

| 写什么 | 入口 | 排队 | 真正落盘 |
| --- | --- | --- | --- |
| 建票（含取号） | `issues-create.js:139` | `withWorkspaceWriter` :159 | `writeTextFile` :207，写完立刻读回核对锚 :212-213 |
| 改票 | `issues-patch.js:114` 等 | `withFileWriter`（`readParseWrite` :24-34，:25 排队） | `writeTextFile` :30 |
| 加评论 | `comments.js:27-50` | `withFileWriter` :27 | `writeTextFile` :50 |
| 关闭/重开 | `issues-status.js:39-43` | `withFileWriter` :39 | `writeTextFile` :43 |

改票那几条的具体入口：`updateIssue` `issues-patch.js:114`、`setBlockedByIssue` :183、`setAssigneesIssue` :199、`setParentIssue` :244、`setLabelsIssue` :327。

**为什么必须排队**：本后端改文件的统一做法是「读整份 → 内存里改 → 整份覆盖写回」，中间那次读会让出事件循环；两路并发会一起读到旧内容、各自覆盖，**两路都回成功，盘上少一半改动**。队按钥匙分：同一份文件排一条链，不同文件各走各的（`write-queue.js:1-17` 的注释就是这段原委）。

| 队列函数 | 行号 | 钥匙 |
| --- | --- | --- |
| `withSingleWriter` | :21-26 | 通用：同钥匙串成一条链，前一条失败不带崩后一条 |
| `workspaceWriteKey` | :37-39 | 工作区钥匙：统一斜杠、去尾部斜杠、折小写 |
| `fileWriteKey` | :42-45 | 工作区钥匙 + 归一后的文件路径 |
| `withWorkspaceWriter` | :48-50 | 用在「要先读整个目录才知道写哪一份」的地方（建票取号） |
| `withFileWriter` | :53-55 | 用在「已经知道该写哪一份票」的地方（改票、评论） |

**真正的落盘那一步**：`src/host/tracker/backends/markdown/write.js:21-30`

```
writeTextFile(ctx, fullPath, content, sandboxPolicy)
  → fs.resolve(fullPath) → fs.writeText(target, String(content), undefined, undefined, policy)
```

三种 fs 形状挨个试（:26-28），每一步都把沙箱拒绝单独认出来换成能指路的错（:15-19 的 `isSandboxDeny` / `sandboxDenyError`）。原子换名在 :31-37（`renameFile`）。

**失败长什么样**

- fs 不可用：`kind: 'env'`，「fs unavailable」/「fs.write not supported」。
- 沙箱拒绝写：换成 `sandboxDenyError`，调用方按「策略不让写」处理（:15-19）。
- 改票时旧正文没读回来：**宁可不写**。`deckIssuePatch.js:226` 那条原话是「旧正文没读回来，不敢拿半截正文覆盖：这次进度没写，等能读回旧正文再写（若急用，改传整段 body）。」——因为空写一次会把整张票冲成只剩进度段。

### 7.3 快照：读回来的那份缓存

**谁生成**：`src/host/tracker/snapshot.js`

| 环节 | 行号 | 说明 |
| --- | --- | --- |
| 装快照 | :87-138 | `assembleSnapshot(repo, all)`：装 `maps` / `tickets` / 未挂图的票 |
| 按后端问计数 | :157-169 | `countsFromBackend` |
| **编排入口** | **:214-294** | **`composeSnapshot`**：`list` 全量 → 组装 → deck 派生 → 计数覆盖 → 打降级标记 |
| 缓存键与版本 | :193-199 | `snapshotVersionOf` / `snapKeyOf` / `fresh`（TTL 默认 5000 毫秒） |
| LRU 上限 | :186 | `SNAP_LRU_MAX = 20` |
| 阻塞边只缓存成功结果 | :300-312 | `getDependencies` |

**谁调它**（宿主的两条电话）：`src/host/sessionSnapshot.js:109`、`src/host/sessionRefresh.js:70`。产物是 `createSnapshotComposer`（:183）。

**写完之后怎么让它作废**：工具在返回值里带 `touched`（写过的票号），`shell.js:347-352` 拿着它调接线的 `invalidate`，实现是 `src/host/refresh/wiring.js:344`——按**工作区目录**把那一份缓存置空。这里踩过一次坑：只给 repo 与票号、不给工作区，宿主那侧的缓存按 cwd 分桶，就认不出该作废哪一份，那一步会**静默什么也没做**（原委写在 `shell.js:348-350`）。

**快照这条路的失败长什么样**：读不到就是读不到——`composeSnapshot` 失败时回 `{ok:false, error}`，调用的那条电话把它变成错误；工具侧看到的则是 `t.get` / `t.list` 的失败，走 `backend-unsupported` 那一档，并在 `notes` 里带一句后端原话（例：`deckMapSnapshot.js:107`「子票没取全（后端原话：…）：下面的进度是手上这几张票算出来的，偏乐观。」）。

---

## 第 8 层：九个工具各一条路（索引卡）

每张卡的读法：**入口 → 后半段调了哪些契约操作 → 最底层是谁 → 失败时 AI 看到什么**。

### 8.1 `deck_context` — 我在哪个仓库、后端是谁

```
run                  src/host/tools/deckContext.js:51-136
  ├ 取会话            :52   → session-resolve.js:28
  ├ 选后端            :56   → shell.js:164
  ├ 沙箱策略          :68-73（5 秒上限）
  └ shell.call        :75   kind: read
       ├ 预检、地图清单、仓库权限三路并行   :81-91
       ├ 预检              t.preflight   → 房间 preflight
       ├ 地图清单          t.list({type:'map'})
       ├ 仓库权限          t.getRepoPermissions（#992 只读旁路）
       └ 报账               :133  claimed { requests: 3, points: 2 }
```

**最底层**：GitHub 房间是 `gh api`（清单走 GraphQL 优先）；本地房间是读 `.scratch` 下有没有 `map.md`（`markdown/index.js:90-123`）。

**失败长什么样**：清单没取到 → 状态从 `ok` 降成 `partial`，`notes` 里带一句后端原话（:106-108）；权限问不出来 → `permissions: { unknown: true }`，**不捏造**（:105）。只读仓库会多一句建议先 fork（:109-112）。

### 8.2 `deck_issue_get` — 读一张票连同关系

```
run                  deckIssueGet.js:77-177
  ├ key 归一与会话检查  :86-89（:88 取会话，:89 取不到就不动）
  ├ 参数校验          :90   key 必填 → BAD_ARGS
  ├ 选后端            :92
  └ shell.call        :108   kind: read
       ├ t.get(repo, key, {comments:{first}})   :114（first 在 :97 夹在 0..200）
       ├ 传输层标记 → 当场抛                      :115-116
       ├ t.getDependencies                       :132（blocking=false 时整段跳过，:130-131；判据在 :99）
       ├ relationsOf 拼关系                       :136   → edges.js:61-70
       ├ 落点判定                                 :158-163（读路径只知道契约字段里有这条关系，如实降档，:159）
       └ 报账                                     :171  两次读 6 点 / 跳反向边一次读 3 点
```

**最底层**：GitHub → `gh api repos/{o}/{r}/issues/{n}`；本地 → 读 `<根>/issues/<键>.md` 并解析。

**失败长什么样**：票没读回来 → `unsupported` + `backend-unsupported`，「这张票没读回来（后端原话：…）。」（:117-127）。阻塞边没读到只是注记一句，票照样回（:141）。`blocking=false` 时明确写「上面『阻塞别人』记空不是 0 条」（:140）。

### 8.3 `deck_map_snapshot` — 一张地图的全部子票

```
run                  deckMapSnapshot.js:66-161
  ├ key 必填          :72
  └ shell.call        :80   kind: read
       ├ 地图与子票同时取  :85-86（两份缓存键不同，不会互相覆盖）
       ├ 地图读不回来就整笔 unsupported（:88-99，claimed 1 请求 3 点）
       ├ 派生统计用共享层同一份投影  :110   → src/shared/tracker/deck-derive.js:147（deriveDeck）
       ├ frontierOnly 在手上这批里筛可接  :117-133
       ├ detail=thin 只瘦回包，数字照全量算  :138-139
       └ 报账                     :158   { requests: 2, points: 5 }
```

**最底层**：GitHub → `gh api …/sub_issues`；本地 → 列 `issues/` 目录再按父票筛。

**失败长什么样**：子票没取全 → 状态 `partial`、`stats: null`、`truncated: true`，原话「地图 X：子票没取全（后端没给全），手上这 N 张算出来的数偏乐观，先重调一次再看数。」（:142-144）。地图本身读不回来 → 整笔 `unsupported`（:88-99）。

### 8.4 `deck_issue_list` — 按状态 / label / 人列薄行

```
run                  deckIssueList.js:73-182
  ├ 参数归一          :75-82（state / type / labels / assignee / query / limit，limit 夹在 1..200）
  └ shell.call        :101  kind: read
       ├ t.list(repo, filter)            :108
       ├ type 在内存里再判一次（后端可能忽略它）  :126-131
       ├ label / assignee / query 在内存里筛      :132-145
       ├ 截断如实说（只回前 N 行）               :170
       └ 报账                                    :179
```

**最底层**：同 `deck_context` 的清单那一条。

**失败长什么样**：清单没取回来 → `unsupported`，「ISSUE 列表没取回来（后端原话：…）。」（:109-120）。截断了会说「只回前 N 行（共 M 行符合）：收窄过滤或调大 limit 再取一次。」（:170）

### 8.5 `deck_issue_create` — 建一张票

```
run                  deckIssueCreate.js:70-198
  ├ title 必填        :77
  ├ 补齐必备标签与正文区块  :85-86 → plan.js:30-63
  ├ 幂等锚            :88（显式 idempotencyKey 优先，否则 anchorKeyFor 5 分钟窗口，plan.js:89-97）
  └ shell.call        :97   kind: write
       ├ t.create(repo, {title, body, type, labels, idempotencyKey, parentKey?, assignees?})  :105
       ├ 传输层标记 → 当场抛（可重试）  :107-108
       ├ 建成了但父边没挂上 → partial  :151-169
       ├ 建成了但标签没挂上 → partial  :170-185（#992 按结果说话）
       ├ 命名守护钩子（5 秒上限，失败不影响返回）  :128-133（#746）
       └ 报账                            :195  有父票 3 请求 6 点 / 无父票 2 请求 4 点
```

**最底层**：GitHub → `gh api …/issues --method POST`（`issues-write.js:48`），标签/认领/父票建后另补；本地 → 在工作区队列里取号并写 `<根>/issues/<号>-untitled.md`（`issues-create.js:159,207`）。

**失败长什么样**：

- 后端诚实说建不成 → `unsupported`，「这张票没建成（后端原话：…）。」（:113-119）
- 票成了、父子边没成 → `partial`，「票 X 建好了：…。父子边没挂上（要 Y）：…」（:151-169）
- 票成了、标签没成 → `partial`，并说「标签没挂上，别把它当成已经打上：逐条原因在同包的 items 里。」（:126）
- 成功时那句话点明「返回值就是写后的真状态，不必再读一次。」（:189）

### 8.6 `deck_map_plan_create` — 建整张地图骨架

这是九个里最长的一条（`deckMapPlanCreate.js:105-340`），因为它要能**续跑**。

```
run                        :105-340
  ├ title + 至少一张子票必填  :113-115
  ├ 计划标识 planId          :116（显式优先，否则 anchorKeyFor）
  ├ 同一计划正在跑？拒绝       :117-119（ACTIVE_PLANS，:70）
  ├ 中间态存储器             :127-146（有落盘的用文件，没有退回进程内存，并如实说 durable:false）
  └ shell.call               :150  kind: write
       ① 地图票只建一次       :163-183（幂等键 'deck-plan-<planId>-map'）
       ①b 批量锚预检：一次列表把已建的子票认回来  :186-205
       ② 子票按分片建（这一片同时建）           :210-240
       ③ 边：端点都在计划里才做                 :242-293
       ④ 逐项校验：按父票列一遍，数字对不上就说 partial  :295-306
       └ 报账                                   :335
```

**最底层**：GitHub → `gh api POST …/issues` ×N + `gh issue edit --parent` + `gh api …/dependencies/blocked_by`；本地 → 工作区队列里逐张建票、逐张写边。

**失败长什么样**

- 地图票没建成 → 整笔 `unsupported`，并明确「后面的子票与边都没动」（:172）。
- 这一片建完了、还有剩下的 → 状态 `partial`，原文「…；还有 N 张没建（…），带同一个 planId 再调一次就接着建。」，同时在 `data.nextCall` 里给出下一步该传什么（:313-314、:329）。
- 额度不够主动停 → `partial`，注明「已建的不用重建」（:315）。
- 逐项校验对不上 → 注记「以这个数字为准，别按计划数字往下走。」（:305）。
- 中间态只在本进程内存里 → 注记「进程重启后重跑同一个 planId 会重新建票。」（:159）。

### 8.7 `deck_map_link` — 补父子边与阻塞边

```
run                  deckMapLink.js:60-206
  ├ 至少一条边         :65-66
  ├ 阻塞边合并         :82-94（#898：同票多次出现先合并成完整集合，否则后写会删前写）
  ├ 整批成环预检       :104-108 → edges.js:224-245（#929：同批互指的边会留下环）
  └ shell.call         :73   kind: write
       ├ 同票分组持锁串行、不同票并行  :109-173（withKeyLock，:114）
       ├ 父子边 applyParentEdge        :118 → edges.js:153-172
       ├ 阻塞边 applyBlockEdges        :143 → edges.js:180-198
       ├ 落点由写后读回判              :136-138 → edges.js:100-124
       ├ 逐项状态合成整笔状态          :180 → edges.js:247-253
       └ 报账                          :203
```

**最底层**：GitHub → `gh issue edit --parent` / `gh api …/dependencies/blocked_by`；本地 → 改 `<根>/issues/<键>.md` 里的父子行与依赖行（`issues-patch.js:183-326`）。

**失败长什么样**（逐条如实报，绝不假装建好）

- 顶层一句话带失败摘要：「这次要补 N 条边，建成 M 条。失败 K 条：…」（:183-192）
- 成环预检拒绝：「这条边不写，逐条如实报失败」（:123-128）
- 锁没等到：「这张票正被另一次调用改着，这次没动：稍后带同样参数再调一次即可。」（:162）
- 额度不够：「剩余额度不够发这一次调用了，这张票的边这次没动：带同样参数再调一次即可。」（:116）
- 后端留下了计划外的边 → 注记提醒「setBlockedBy 是整批替换，后端却留下了它们，读回来核对一次」（:152-153）

### 8.8 `deck_issue_patch` — 改票

```
run                  deckIssuePatch.js:113-276
  ├ key 必填          :119
  ├ 至少要改一件事     :135-137（comment / addLabels / removeLabels / assignees / title / body / progress / close）
  └ shell.call        :139  kind: write
       ├ comment   :161-168
       ├ labels    :170-188（整批替换：读回当前标签 → 加减 → 写；持同票锁）
       ├ assignees :190-208（回了 ok 也要读回核对名字真的记上了，:196-203）
       ├ text      :210-243（title / body / progress；progress 走 replaceProgressSection :64-105）
       ├ close/reopen :245-252
       ├ 写后读回真状态  :254-259
       ├ 整笔状态按逐项合成  :260
       └ 报账                :273
```

**最底层**：GitHub → `gh issue edit` / `gh api POST /comments` / `gh issue close|reopen`；本地 → 队列里读改写那一份票文件。

**失败长什么样**

- 顶层一句话：「票 X：这次点了 N 步，成了 M 步。」（:266）
- 逐项失败带步骤名与后端原话（`fail`，:147-150）
- 有步骤没成 → 注记「有的步骤没成，逐条原因在上面：别把没成的那一步当成已经改好。」（:261）
- 认领人名字没记上：「后端回了 ok，但读回来的票上没有这些认领人（…）：它可能只改了状态、没记认领人，别当成认领已经记上。」（:202）
- 写后没读回来 → 注记「上面每步是照后端的回答记的。」（:259）

### 8.9 `deck_issue_report` — 上报当前在办哪张票

```
run                  deckIssueReport.js:67-147
  ├ key 必填          :73
  └ shell.call        :89   kind: write
       ├ t.get(repo, key, {comments:{first:0}})   :96
       ├ 记链 d.chainNote(...)                    :115-129（5 秒上限；超时按没记进走老路）
       ├ 链上有没有如实说                          :130
       └ 报账                                     :144  { requests: 1, points: 3 }
```

**最底层**：读票走房间的 `get`（GitHub 是 `gh api`，本地是读文件）；上报本身**只写本地链**，不出网。

**失败长什么样**：票没读回来 → `unsupported`，「这张票没上报（票 X 没读回来，后端原话：…）。」（:99-111）。链没记进 → 注记「这次没显式记进链（…）：被动推断那一路仍会按参数里的票号记一次，去重后同一张票只留一条。」（:130）。备注只回显不进链（:95）。

---

## 第 9 层：失败长什么样（横着看一遍）

### 9.1 三个判据决定 AI 看到什么

| 判据 | 在哪 | AI 看到 |
| --- | --- | --- |
| 三态状态 | `shell.js:28`、`shell.js:337-338` | `ok` / `partial` / `unsupported`，以及配套的一句话 `text` |
| 机器可读原因 | `shell.js:30-38` | `reason` 七值之一 |
| 逐项明细 | 各工具的 `items` | 哪一项成了、哪一项没成、后端原话 |

### 9.2 失败在哪个位置，谁能看见

| 失败位置 | 谁兜住 | AI 看到的 |
| --- | --- | --- |
| 参数不对 | 工具自己（`BAD_ARGS`） | `bad-args` + 一句「要改哪一张票：把票号写在 key 里。」 |
| 会话目录取不到 | `session-resolve.js:24` | `no-session-context` + 「我不动任何票。」 |
| 后端没定 / 不是亲手选的 | `shell.js:240-246` | `no-backend` + 引导去面板选 |
| 超过硬顶 | `gate.admitAiTool`（`shell.js:270-275`） | `ai-tool-refused` + 闸那句原话 |
| 被闸推迟 | `shell.js:312-318` | `gate-defer` + 推迟原因 |
| 工具内部抛错 | `shell.js:302-311` | `backend-threw`，「后端实现抛错了（我没有把它抛给 AI，按三态返回）：…」 |
| 传输层四种 | 工具当场抛（`deckIssueCreate.js:107-108` 等） | 同上，但可重试 |
| 后端诚实说做不到 | 工具按后端回答记 | `backend-unsupported` + 后端原话 |
| 一封回包不合约定 | `agent-register.js:290-292` | `backend-threw`，「工具内部没按约定回包，已拦下」 |

### 9.3 一类特别的失败：写成了、但没完全成

这是这套工具最要紧的设计——**不把「票建好了」说成「什么都成了」**：

| 情形 | 工具 | 回报 |
| --- | --- | --- |
| 票建成了、父子边没挂上 | `deck_issue_create` | `partial` + 逐项 `failed`（:151-169） |
| 票建成了、标签没挂上 | `deck_issue_create` | `partial`，并写明「别把它当成已经打上」（:170-185） |
| 一批边里有的成有的不成 | `deck_map_link` | `partial` + 失败摘要（:180-192） |
| 地图建了一片、还有剩下的 | `deck_map_plan_create` | `partial` + `nextCall` 指路（:312-314） |
| 改了五步、成了三步 | `deck_issue_patch` | `partial` + 逐项步骤名（:260-266） |
| 认领回了 ok 但名字没记上 | `deck_issue_patch` | 该项记 `failed`（:202） |
| 子票没取全 | `deck_map_snapshot` | `partial` + `stats: null`（:142-144） |

---

## 第 10 层：这份文档本身

**为什么放这里**：#1094 正文写「建议新开一份，放 `docs/tour/` 之类的位置」。`docs/tour/` 此前不存在，本文件是它的第一份。

**范围**：只写文档。这份文档的产出没有改任何产品代码、没有改测试。

**行号口径**：基线提交 `f1dc6376`。行号会随代码漂移，改代码的人顺手改这一份；核对的人发现对不上，就是该更新了。

**已知没写到的（留给下一版）**

- 第三座房间 GitLab 只写了门面与最底层（`gitlab/index.js:112-124` 的操作映射、`gitlab/client.js:33` 的 `exec('glab', args, …)`），没有逐工具走一遍。它不在 #1094 点名的三座底层里（gh 进程、Markdown 文件、快照）。
- 宿主侧「面板」那条路（`wf.deckExec`）只写到进门为止，没说行与面板怎么渲染这九个工具的结果。
- 快照与面板之间的那条读路（`sessionSnapshot.js` / `sessionRefresh.js` / `mapTickets.js`）只指了入口，没逐层展开。

**接手方式**

- #1022（地图 01 讲解）：讲解时**改这一份**，不另开新文件。
- #1077（收口核对）：对着这一份核对代码；行号与结论对不上就是文档要跟。
