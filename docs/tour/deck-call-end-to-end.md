# 一次 deck 工具调用的全程走查（第一版）

这份文档回答一个问题：AI 在对话里调一次 `deck_*` 工具，从它按下手的那一刻起，代码里到底经过了哪些环节、每一环交出去的是什么、哪一环可能失败、失败以后 AI 看到的是哪一句话。

它服务两张票：

- #1022（地图 01 讲解）：讲解时改这一份，不另开新文件。
- #1077（收口核对）：核对代码时对着这一份核对，行号对不上就是代码动了、文档该跟。

放 `docs/tour/` 是因为 #1094 正文写的就是「建议新开一份，放 `docs/tour/` 之类的位置」——这个目录此前不存在，本文件是它的第一份。

## 怎么用这份文档

- 每一层都给出「谁调用谁 / 传什么 / 失败长什么样」，并指到真实文件与行号。
- 行号是写这份文档时的仓库状态（基线提交 `f1dc6376`）。代码改动之后行号会漂，改代码的人顺手改这一份。
- 九个工具**共用**前面这条主干（进门 → 取会话 → 判参数 → 选后端 → 取沙箱策略 → 过闸 → 进房间），只在「进房间之后调哪一个契约操作」和「最后落到哪个底层」上分叉。所以先读第 1 到第 6 层，再看第 8 层的九张索引卡。
- 三座底层：**gh 进程**（GitHub 房间，第 7.1 节）、**工作区里的 Markdown 票文件**（本地房间，第 7.2 节）、**宿主侧的缓存快照**（第 7.3 节）。第三座要先看清：它服务的是面板与会话刷新，**不在这九个工具的路上**；两者只靠「写完一票就作废」打交道。

## 一眼看全的总图

```
对话里的 AI
  │ ① 工具从哪来：装机补丁装上宿主与「工具行」；宿主先装好那张表，工具行把九个工具注册进工具服务
  ▼
工具服务（DSH 的 tools 服务）   package/cordis.patch.yml:8-14
                                → 宿主装表 src/host/refresh/wiring.ts:338-447
                                → 工具行注册 src/deck/registration/agent-row.ts:393-416
  │ ② AI 发起调用 → 工具服务调 execute(args, exec)
  ▼
makeDelegatedExecute              src/deck/registration/agent-row.ts:313-391
  │ ③ 找人真跑：三条路由先到先得，都不通才回诚实占位
  │    ① 同进程共享格：table.tools[名].run(exec, args)     agent-row.ts:340-379
  │    ② 宿主电话 wf.deckExec → handleDeckExec（同一张表）  src/deck/registration/host-delegate.ts:68-113
  │    ③ 同源请求（与面板同一套调用面）                      agent-row.ts:384-388
  ▼
九个工具各自的 run                src/deck/tools/*.ts
  │ ④ 取会话目录   sessionContextOfAsync   src/deck/shell/session-workdir.ts:143
  │ ⑤ 判参数够不够 + 选后端 shell.pickBackend src/deck/shell/call-shell.ts:240
  │ ⑥ 取沙箱策略 → 过闸 + 真干活 shell.call  src/deck/shell/call-shell.ts:268
  ▼
后端注册表选出的 Tracker          src/tracker/registry/core.ts:149
  │ ⑦ registry.get(backendId) → 某座房间的门面对象
  ▼
房间门面（契约的那一组操作）        src/tracker/rooms/github/backend.ts:101
                                   src/tracker/rooms/markdown/index.ts:208
  │ ⑧ 房间内部函数（真正做事的那些）
  ▼
最底层：
  · gh 进程              src/tracker/rooms/github/client.ts:372   exec('gh', args, …)
  · 工作区 Markdown 文件  src/tracker/rooms/markdown/write.ts:33   fs.resolve + fs.writeText
  · 宿主侧缓存快照（不服务这九个工具）  src/host/tracker/snapshot.js:215  composeSnapshot
```

---

## 第 1 层：AI 手上的九个工具是从哪来的

这一层发生在**装机与宿主启动时**，不在 AI 调用时——但后面所有事情都建立在它上面。四段：装机补丁插两条插件条目 → 宿主把那张表装出来 → 表放进同进程共享格 → **agent 层的「工具行」**把九个工具注册给工具服务。

**1. 装机时，装配补丁插两条插件条目**（`package/cordis.patch.yml:8-14`；这份补丁由 `dsh plugin add` 自动装配，包声明在 `package/package.json` 的 `dsh.bundle.patch`）：

- 宿主行：`id: dsh-mattpocock-skills-deck`（控制面板插件本体）
- 工具行：`id: dsh-mattpocock-skills-deck-tools`、`name: 'dsh-mattpocock-skills-deck/tools'`

包声明里 `exports['./tools']` 指到构建产物 `deck/registration/agent-row.js`，所以这两条一起把「面板」和「工具行」都装上。本仓有一条门禁钉着「补丁必须含工具行」，理由写在测试里：**agent 层能装上**（`tests/verify-deck-tools-row-zero-dep.js:44`）。

**2. 宿主把那张表装出来**：

```
src/host/refresh/wiring.ts:338-447（deckToolsForHost）
  → src/deck/registration/host-assemble.ts:94-130（createDeckToolsForHost）
  → src/deck/rules/tool-table.ts:59-77（createDeckTools）
```

表里每个工具是 `{ definition, run }`，键是工具名；哪个工厂装不起来就少哪个，缺的如实列在 `missing` 里，**不补假桩**（`src/deck/rules/tool-table.ts:74-76`）。九个名字与顺序钉在 `src/deck/rules/tool-order.ts:12-14`（`DECK_TOOL_ORDER`）：`deck_context` / `deck_issue_get` / `deck_map_snapshot` / `deck_issue_list` / `deck_issue_create` / `deck_map_plan_create` / `deck_map_link` / `deck_issue_patch` / `deck_issue_report`。

装好之后放进**同进程共享格**（给工具行直接取用，不经任何调用面）：`src/host/refresh/wiring.ts:444` → `src/deck/shell/table-cell.ts` 的 `publishDeckTable`。这一格的生命周期与原因写在 `src/deck/shell/table-cell.ts:1-7`：行与宿主同进程时格里有货，跨进程时永远是空的。

**3. 工具行把九个工具注册给工具服务**（`src/deck/registration/agent-row.ts`）：它声明自己要用工具服务（`name` 与 `inject: ['tools']` 在 `:52-53`），`apply` 里逐条 `ctx.tools.register`（`:398-404`；服务不在就直接抛、行起不来，`:393-397`），每个工具经 `toRawRegistration`（`:173-186`）交出 `{ name, description, parameters, timeoutMs, output, execute }`，其中 `execute = makeDelegatedExecute(工具名, ctx)`（`:313-391`），`timeoutMs` 用 `AGENT_TOOL_TIMEOUT_MS`（值 300000，定义在 `src/deck/registration/register-options.ts:39`）。它同时注册一个自查用的探针工具 `deck_probe`（`:409-416`，定义在 `src/deck/registration/register-options.ts:267-271`）——这一条**不走** `makeDelegatedExecute`，`execute` 直接回一串 JSON（`:415`）。

**4. 宿主插件那侧还留着一条兼容钩子**（`src/host/refresh/wiring.ts:337`）：`hookDeckAgentTools(…)` 调向 `src/deck/registration/register-options.ts:430-477`，等两样东西都就绪、各等最多五轮每轮两秒——先要那张表（`table(retries)`，:451-452），再要工具服务（`attempt(left)`，:454-474），就绪后由 `registerDeckAgentTools`（:336-398）逐条注册，每个工具包一层 `makeExecute`（:302-324），注册时同样带 `timeoutMs`（:367）。

两条注册路都按注册表认的形状交纯数据对象（`loadDefineTool` 固定传 `null`；原因写在 `wiring.ts:334-335`：从前动态 import 自带副本，挂载后所有调用都报 `prepare undefined`）。为什么留着第二条：`src/deck/registration/agent-row.ts:5` 写着「与宿主插件那一行互不干扰。宿主插件里的兼容钩子留着（别的产品可能是同一容器）」，装配补丁里也留了同一句（`package/cordis.patch.yml:5`）。门禁钉着「装配补丁必须含工具行」，理由写在测试里：**agent 层能装上**（`tests/verify-deck-tools-row-zero-dep.js:44`；同一个文件 :61 也断言行模块交出九个）。

**这一层失败长什么样**

- **工具服务**一直不就绪：工具行起不来（服务不在就抛，`agent-row.ts:393-397`），AI 手上根本没有这些工具（对话里看不到）。兼容钩子那条路同样要求两样都就绪，否则只记日志、不抛。
- **只有表没装好**（服务在）：九个工具**照样看得见**——注册不依赖那张表；调用时走到占位，回 `not-wired`「…的执行通道还没接通（列表可见是第一步）：请先用面板操作，进展见仓库的 BUG 单。」（`src/deck/registration/register-options.ts:254-259`）。
- 注册成功与否落两条既有日志，不新增事件名：`src/deck/registration/register-options.ts:402-417`（`host.call` / `host.call.fail`，`method: 'deck.agentRegister'`）。
- **想在本机确认执行时落在哪条路由**：调探针 `deck_probe`。它回的键有二十来个（`agent-row.ts:86-170`），先看这三样：`bridgeLastPath`（上一次调用落在哪条路由：`cell` / `connection` / `fetch` / `fallback`）、`bridgeTools`（宿主那张表里有哪些工具名）、`bridgeDryRun`（拿当前会话目录干跑一次 `deck_context` 的结果：`ok` / `no-hint` / `no-table` / `no-run` / `threw` / `bad-shape`）。

---

## 第 2 层：一次调用怎么进到 `run`

从 AI 按下手到 `run` 被调用，中间是**三条路由**；三条都不通，才给一个诚实占位。本产品里发起方是第 1 层第 3 段那个工具行（宿主插件那条兼容钩子走的是另一套包装，见本节末尾）。

```
工具服务 → makeDelegatedExecute 的 execute(args, exec)   src/deck/registration/agent-row.ts:313-391
  ① 行自己先拦两档，不往外走：
      调用已被中止      :330-331 → reason: 'aborted'、「这次被中止了，没做完：请按需重调一次。」
      参数不是对象      :334-335 → reason: 'bad-args'、「参数不是一个对象，我没法做：请按这个工具的参数说明重调一次。」
  ② 取不到会话线索（:337-338）→ 也直接给占位，且三条路由一条都不试
      它和「三条路由都不通」走的是同一个 fallthrough，一样记一笔 fallback（:325）
  ③ 三条路由先到先得（落哪条各记一笔 noteDeckPath）：
      ① 同进程共享格    :340-379   table.tools[名].run(exec, args)
      ② 直连调用面      :380-383   ctx.connection.rpc.call('/api','dsws',{method:'deckExec', payload})
      ③ 同源请求        :384-388   {type:'client-request', rpcId, payload:{method:'deckExec', payload}}
  ④ 都不通：诚实占位，reason: 'not-wired'                  src/deck/registration/register-options.ts:243-248
```

- **判据是「本进程里那张表放了没」，不是先问「同不同进程」**：共享格是本进程内的模块状态——宿主在本进程调过 `publishDeckTable` 才有货（`src/deck/shell/table-cell.ts:59-72`），`peekDeckTable()` 空就直接跳过 ①（`src/deck/shell/table-cell.ts:75-80`）；行与宿主不在同一个进程时，那一格在行的进程里永远是空的，于是自然走 ②③（原因写在 `src/deck/shell/table-cell.ts:1-7`）。探针里那个 `bridgeSameProcess` 布尔（pid 比对，`src/deck/shell/table-cell.ts:78`，键的取值在 `src/deck/registration/agent-row.ts:132`）只是给人看的诊断信息，不参与判定。宿主放了表却一直没装好时，① 最多等 25 秒（`src/deck/registration/agent-row.ts:343`，`DELEGATED_CELL_WAIT_MS`）才转下一条。
- 三条路由各记一笔 `noteDeckPath(工具名, via)`（写入点 `src/deck/registration/agent-row.ts:324`，取值 `cell` / `connection` / `fetch` / `fallback` 由 `src/deck/shell/table-cell.ts:159-164` 的白名单限定），探针 `deck_probe` 能读出来（见第 1 层末尾）。
- **行模块自己只拦开头那两档**；`run` 抛错、回包不合约定这两档它不报错，而是**继续换下一条路由**：走 ① 时 `run` 抛的异常被吞掉、回包不合约定就当作这条不通（`src/deck/registration/agent-row.ts:369-372`）；换到 ②③ 时，是**宿主电话那层**把它包成 `backend-threw`（`src/deck/registration/host-delegate.ts:100-107`）。所以同一场失败可能**换一层再报**，AI 看到的那句话来自最后接住它的那层。
- ②③ 拿回来的回包还要过工具行的形状检查（`src/deck/registration/agent-row.ts:246-256` 的 `pickHostValue`）：不合约定的会被丢掉，路由继续往下走，最后回的是 `not-wired` 占位，**不是** `backend-threw`。

**宿主电话 `wf.deckExec`：工具行专用的代执行电话**

```
src/host/index.ts:252     harness.handle('wf.deckExec', …)（注释写着「agent 行经它拿真结果」）
  → src/deck/registration/host-delegate.ts:68-113   handleDeckExec(args)
```

它走的是**与面板同一套调用面**（RPC / 同源请求），但发起方只有工具行：生产代码里调用 `deckExec` 的只有 `src/deck/registration/agent-row.ts:258` 与 `:281` 两处，客户端一处都没有（门禁测试会自己造这两种信封来试：`tests/verify-deck-exec-phone.js:149`、`:189`）。

四处守卫、两处收尾，一共六种回法：

| 情形 | 行号（`src/deck/registration/host-delegate.ts`） | AI 看到的 |
| --- | --- | --- |
| 工具名不在 `DECK_TOOL_ORDER` 里 | :77-80 | `bad-args`、「工具名不对，我没法做：请按九个 deck 工具的名字重调一次。」 |
| 参数不是对象 | :81-84 | `bad-args`、「参数不是一个对象，我没法做：请按这个工具的参数说明重调一次。」 |
| 没拿到会话目录 | :85-88 | `no-session-context`、「这次没拿到当前会话的工作区目录，所以我不动任何票。请换一个会话再来。」 |
| 表或 `run` 不在 | :90-97 | `not-wired`、「〈工具名〉的执行通道还没接通（宿主那张表不在）：请先用面板操作，进展见仓库的 BUG 单。」 |
| `run` 抛错 | :99-103 | `backend-threw`、「这次没做成（内部执行抛错，已拦下）：…」 |
| 回包不合约定 | :104-108 | `backend-threw`、「这次没做成（工具内部没按约定回包，已拦下），请重试或走面板操作。」 |

**宿主插件那条兼容钩子（别的产品可能用）**：包装是 `makeExecute`（`src/deck/registration/register-options.ts:302-324`），四档——被中止（:306-308）、参数不是对象（:309-311）、`run` 抛错（:312-317）、回包不合约定（:318-323）。前两档的文案与工具行自己那两档**一字不差**；后两档在这里当场被包成 `backend-threw`，而工具行那条路不在这里定音（理由见上）。

---

## 第 3 层：九个工具的入口（进门后的共同几步）

每个 `run` 的前半段都是同一套顺序；**会话判不过就不往下走，而这一步在参数校验之前**：

1. **参数先归一、先估算**：把参数整成能用的形状（例如 `key` 去空白、`comments` 夹进 0..200），并算一次这笔预计花多少（`shell.estimateFor(工具名, 参数)`）。「归一」与「够不够」是两件事，够不够在第 3 步判。**这一步的位置有一个例外**：八个工具是「归一 → 估算 → 取会话」，只有 `deck_context` 反过来（`src/deck/tools/context.ts:90` 先取会话、`:91` 才估算）。
2. **取会话目录**：`sessionContextOfAsync(exec, …)`；不成就回 `no-session-context`（例：`src/deck/tools/issue-get.ts:151-154`）。`deck_context` 在这里稍有不同：它把这次失败连同工作区信息一起交回 AI（`src/deck/tools/context.ts:94-100`），因为「该在面板上选哪个」正是它要回答的。
3. **判参数够不够**：缺票号、缺标题、缺子票这类「没法做」的，在这里用 `shell.unsupported(…, BAD_ARGS, …)` 直接回，不往下走（例：`src/deck/tools/issue-get.ts:155`）。
4. **选后端**：`shell.pickBackend(exec, s)`（第 4 层）。
5. **取沙箱策略**：`d.sandboxPolicyFor`（细节见本节末尾）。
6. **进预算壳**：`shell.call({ tool, kind, session, pick, repo, estimate, sandbox }, work)`（第 5 层；有的工具还多传一个 `signal`，例如 `src/deck/tools/map-snapshot.ts:114`）。

九个工具的落点（行号为基线提交状态）：

| 工具 | 入口文件 | `definition` | `run` | 干什么用 | 参数校验 | `shell.call` |
| --- | --- | --- | --- | --- | --- | --- |
| `deck_context` | [src/deck/tools/context.ts](../../src/deck/tools/context.ts) | :60-65 | :87-211 | 读：确认工作区与后端 | 无参数（:87） | :116 |
| `deck_issue_get` | [issue-get.ts](../../src/deck/tools/issue-get.ts) | :79-94 | :145-248 | 读：一张票连同关系 | :155 key 必填 | :174 |
| `deck_map_snapshot` | [map-snapshot.ts](../../src/deck/tools/map-snapshot.ts) | :43-57 | :94-201 | 读：一张地图的全部子票 | :104 key 必填 | :114 |
| `deck_issue_list` | [issue-list.ts](../../src/deck/tools/issue-list.ts) | :31-48 | :106-225 | 读：按状态/label/人列薄行 | :103-117 参数归一 | :139 |
| `deck_issue_create` | [issue-create.ts](../../src/deck/tools/issue-create.ts) | :74-92 | :115-281 | 写：建一张票 | :126 title 必填 | :147 |
| `deck_map_plan_create` | [map-plan-create.ts](../../src/deck/tools/map-plan-create.ts) | :27-69 | :186-456 | 写：建整张地图骨架 | :199-201 title + children 必填 | :250 |
| `deck_map_link` | [map-link.ts](../../src/deck/tools/map-link.ts) | :49-72 | :121-278 | 写：补父子边与阻塞边 | :131 至少一条边 | :140 |
| `deck_issue_patch` | [issue-patch.ts](../../src/deck/tools/issue-patch.ts) | :67-87 | :154-403 | 写：改票 | :164 key；:181-182 至少点一件事 | :187 |
| `deck_issue_report` | [issue-report.ts](../../src/deck/tools/issue-report.ts) | :78-91 | :121-220 | 写：上报当前在办哪张票 | :131 key 必填 | :148 |

第 5 步那次沙箱策略在九个文件里写法一致：`d.sandboxPolicyFor` 包在 `withCap(…, SANDBOX_TIMEOUT_MS)` 里，5 秒上限；拿不到按 `null` 走，不拦事（例 `src/deck/tools/issue-get.ts:168-170`）。

### 第 3.1 步：会话目录怎么取出来（`sessionContextOfAsync`）

`src/deck/shell/session-workdir.ts:114-168`，两步：

1. **先按六个候选字段挨个试**（同步版 `sessionContextOf`，:114-135；候选清单在 :119-127）：
   `exec.agent.session.cwd` → `exec.agent.session.workspaceRoot` → `exec.agent.session.workspace.cwd` → `exec.agent.cwd` → `exec.session.cwd` → `exec.cwd`
   取到第一个非空字符串就用它，并把「取自哪一个」记在 `source` 里。
2. **再归一到工作区根**（异步版 `sessionContextOfAsync`，:143-168）：调接线给的 `canonicalKey`（:150，5 秒上限 `CANONICAL_TIMEOUT_MS`）。归一成功就用根目录，失败**不凑合**、按 `NO_SESSION` 如实失败（:95）。

**失败长什么样**：`sessionContextOf` 六个候选都没值 → `reason: 'no-session-context'`，`text` 是「这次没拿到当前会话的工作区目录，所以我不动任何票。」（:133）。归一失败是「这次没能把工作区目录归一到工作区根，所以我不动任何票。」

九个工具都在拿到会话之后立刻判它成不成，不成就不往下走，例如 `src/deck/tools/context.ts:94`、`src/deck/tools/issue-get.ts:151-155`。

---

## 第 4 层：选后端（全插件只有一个判定出口）

`src/deck/shell/call-shell.ts:240-348`（`pickBackend`）。

**谁调用谁 / 传什么**

```
pickBackend(exec, s)
  ├─ 目录空？                    :242            空 → NO_BACKEND
  ├─ 会话→句柄                  :244  d.handleFor(s)
  ├─ 动手前保一次剩余额度读数     :249  d.ensureReading(cwd, workspaceKey)
  ├─ 过闸跑统一判定出口          :268  gate.send({kind:'probe'}, …)
  │     └─ d.decideBackend(cwd, {registry, backendCtx, readWorkspaceFileText,
  │                             parseWorkspaceFile, readDeclarationId, autodetect})
  │           → src/tracker/detection/backendDecision.ts:1089-1151
  ├─ 仓库标识补全（缺 refId 时）  :302-335  tracker.getRepoKey + 三层兜底，8 秒上限
  └─ 结论                        :336-347
```

**判定出口里的三层**（`src/tracker/detection/backendDecision.ts:1030-1065` 的 `decidePure`，层数说明见同文件 `:1067-1088` 的注释）：人选唯一真源（工作区配置文件） → 声明文件 `docs/agents/issue-tracker.md` → 后端 `matches` 自动识别。**没有内存绑定层**——进程内绑定整层已删（同文件注释 `:1074-1077`），插件不替人记「上次选了什么」。

**2026-10-16 起不再设这道门**：维护者拍板删掉了工具壳里「非亲手选过不放行」的那一支。判定出口给出哪个后端，壳就用哪个 —— 声明文件那一层、自动识别那一层同样放行（判定出口照旧如实标出来源与写权限，`src/tracker/detection/backendDecision.ts:1086`，排查时看日志里的结论线）。壳里剩下的拒绝只有三类：多命中或未决（:336 那一支）、连后端都没有（:337-339 那一支）、闸与后端自身失败。改色电话（`src/host/workspaceLabelColors.js`）的写用途还留着同一道门：改标签颜色仍要求人亲手选过。

**失败长什么样**

| 情形 | 行号 | `reason` | AI 看到的一句话 |
| --- | --- | --- | --- |
| 目录还没就绪 | :242 | `no-backend` | 「这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。」 |
| 判定出口没装上（装配错） | :254-259 | `backend-threw` | 「判定出口这次没装上，我没往下做。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。」（附 `errorHash`；转 TypeScript 时已把旧写法里错位的信封改回同形） |
| 出口自己抛错 | :291 | `backend-threw` | 「选后端这一步的后端实现抛错了，我没往下做。」 |
| 被闸推迟 | :292-295 | `gate-defer` | 「这一次选后端被闸推迟了（…），先不做。」 |
| 多命中/还没定 | :336-339 | `no-backend` | 「这个工作区同时被 N 个后端认出，请在面板中选定后再试。」／「后端还没定下来，先在面板上选一次后端。」 |

选成功以后，`repoOf`（src/deck/shell/call-shell.ts:351-362）把「后端 id + 句柄」拼成一个仓库身份对象，缺字段就用后端 id 顶上，**不造假名字**。

---

## 第 5 层：进预算壳、过一次闸（`shell.call`）

`src/deck/shell/call-shell.ts:365-436`。这是每笔工具调用真正动手的地方，做四件事。

**① 硬顶（`gate.admitAiTool`，:369）**

```
gate.admitAiTool({ points, requests, childTickets }, { workspaceKey, kind: 'tool-batch', bucket: 'graphql' })
```

估算是调用前算好的（`src/deck/shell/call-shell.ts:199-207` 的 `estimateFor` → `src/shared/refresh/tool-cost.js:1-100`（真源 `src/shared/refresh/src/tool-cost.ts`））。硬顶的五个数在 `src/shared/refresh/budget.js:27-31`：

| 常量 | 值 |
| --- | --- |
| `AI_TOOL_MAX_POINTS_PER_CALL` | 600 |
| `AI_TOOL_MAX_REQUESTS_PER_CALL` | 400 |
| `AI_TOOL_MAX_POINTS_PER_HOUR` | 2000 |
| `AI_TOOL_MAX_REQUESTS_PER_HOUR` | 1500 |
| `AI_TOOL_MAX_CHILD_TICKETS_PER_CALL` | 60 |

顶住了就回 `reason: 'ai-tool-refused'`，文案是**闸自己那句原话**——出处是 `src/host/refresh/refusal-text.ts:32` 的 `refusalTextRef(a, q, hour, plan, limits)`，由闸挂进准入结论（`src/host/refresh/gate.ts:438`）。它分两种头（`:11` 超过插件自己给工具设的硬顶 / `:12` 额度被别人用掉），后面拼上预计花费、本小时已用、这一桶还剩多少、建议分几次；`src/deck/shell/call-shell.ts:226-232` 那一段只是闸没给文案时的兜底（`:228`），工具不自己编一个数。

**② 过闸记账（`gate.send`，:393-401）**

闸的实现是 `src/host/refresh/gate.ts`（`admitAiTool` :427、`send` :356、四张对照表 :31）。

**③ 干活（:392-400）**

工具自己那段 `work(ctx)` 在这里跑。`ctx` 里带着（:380-390）：会话、选出的后端与仓库、闸、注册表选出的 `tracker`、以及 `opCtx`（`platform` / `fs` / `exec` 那一套，加上 `cwd`、`caller: 'deck-tool'`、沙箱策略、会话号）。
`work` 回来的 `claimed`（这一笔实际花了多少请求/点数）原样记进账（:397-399）。

**④ 收口（`mergeOutcome`，:438-458）**

把工具那份结果并进统一信封（状态、逐项、注记、写后读回值），并且**写过的票要让宿主那侧的快照缓存作废**（:450-455，调接线给的 `d.invalidate`，位置在 `src/host/refresh/wiring.ts:427`）。

### 单次钳制与中止（`withCallScope`）

工具里那些「一次调用可能要发好几笔远端请求」的地方，会再包一层预算壳：`src/deck/shell/call-budget.ts`

| 常量 | 值 | 行号 |
| --- | --- | --- |
| `DEFAULT_TOOL_TIMEOUT_MS` | 300000 | :28 |
| `DEFAULT_TOOL_MARGIN_MS` | 15000 | :31 |
| `DEFAULT_PER_OP_TIMEOUT_MS` | 30000 | :33 |

- `withCallScope` :208-281，`execOp` :234-281（单笔钳制 + 可中止，中间还会问 `outOfBudget()` 决定要不要停发下一笔）。
- 超时/被中止/额度不够这三种回执的文案在 :283-290（`mapOpOutcome` 转出来的三种回执）。
- `tracker` 包装在 :312-406：读操作（`get` / `list` / `getDependencies`）带记忆，写操作穿透。
- **「带记忆」的确切范围**（只在同一笔调用里，记忆体由 `createCallMemo` 造，:226）：读回来的东西进一张表（:292-298 的 `memoGet` / `memoPut`），同一个操作 + 同一把钥匙再来一次就直接拿表里那份，不再问后端。**只记成功的**——`get` 要 `ok === true` 且有 `data`（:321）、`list` 要 `ok === true` 且是数组（:330）、`getDependencies` 同样（:339-340）；失败结果不记，下一笔会老实再问一次。
- **名册与记忆是两件事**：名册（`memo.roster`，由 `rosterUpsert` / `rosterAdoptList` / `rosterAddCreated` 维护）是「这张票和谁有关系」的关系索引，写操作之后只把**被波及的那几条**标脏（`rosterDirty`，:308、:356、:363），不整份作废；GitHub 房间做全仓检查时就靠它（`src/tracker/rooms/github/cycle-check.ts:26-27`、`roster.ts`）。

### 三种状态与七种「没做成」的原因

`src/deck/shell/call-shell.ts:45-53`

- 状态三值（`DECK_STATUS`）：`ok` / `partial` / `unsupported`
- 原因七值（`REFUSAL_REASONS`）：
  `no-session-context` / `ai-tool-refused` / `no-backend` / `gate-defer` / `backend-threw` / `backend-unsupported` / `bad-args`

另外有五个工具各带一份**传输层**标记，用它区分「后端诚实说做不到」和「这一趟根本没回来」（`src/deck/tools/context.ts:33`、`src/deck/tools/issue-get.ts:31`、`src/deck/tools/issue-create.ts:40`、`src/deck/tools/issue-patch.ts:34`、`src/deck/tools/issue-report.ts:35`）：

`backend-threw` / `timeout` / `aborted` / `over-budget`

拿到这四个之一时，工具**当场抛**，让壳收成三态（例：`src/deck/tools/issue-create.ts:171-172`），而不是当成「后端做不到」记下来。

---

## 第 6 层：后端契约与注册表

**契约**（`src/tracker/contract/index.ts`）：一座房间要能被工具用，得实现这组操作（`:32-62` 的 `Tracker` 义务清单，`:81` 的 `OPERATIONS`）：

`preflight` / `list` / `counts` / `listPage` / `get` / `getDependencies` / `create` / `close` / `reopen` / `comment` / `update` / `setLabels` / `setAssignees` / `setParent` / `setBlockedBy`

少实现的那几条由注册表的代理补一个「做不到」的桩（`src/tracker/contract/index.ts:127-133`，`create` 只实现真会的、缺的方法由注册表 Proxy 补 `unsupported` 桩）。

**注册表**（`src/tracker/registry/core.ts`）：

- `select` :164-208：三级联——显式绑定 > `matches` 认出 > 兜底（无后端时 `fallback`→null，:202-208）；顺带算出 `pending` / `multiHit`。显式绑定那一级读的是工作区文件，注册表自己不管人选（:90）。
- `describe` 经 `core.ts:212` 转出，真身在 `src/tracker/registry/views.ts:31`。
- `src/deck/shell/call-shell.ts:388` 拿到的 `tracker` 就是 `registry.get(backendId)`（`get` 在 `core.ts:149`）。

**三座房间的门面**（契约操作 → 房间内部函数）：

- GitHub：`src/tracker/rooms/github/backend.ts:101-165`（`createGithubBackend`，十五个操作在 :111-165）
- 本地 Markdown：`src/tracker/rooms/markdown/index.ts:208-300`（`createMarkdownBackend`，读操作在 :262-270、写操作在 :271-286，做不到的那几条在 :289-294 诚实回 `unsupported`）
- GitLab：`src/tracker/rooms/gitlab/index.ts:245-361`（`createGitlabBackend`）

---

## 第 7 层：三座最底层

### 7.1 GitHub 房间：最后是 `gh` 进程

**唯一出口**：`src/tracker/rooms/github/client.ts`（`ghClient` :202 造执行器，`execGh` :277 起真正干活）。所有对 GitHub 的读写都从这里出去。房间里起 `gh` 进程的地方只有两处：真正干活的全在 `execGh`（:372），另一处是**找不到 `gh` 时的一次探活**（`gh --version`，:232，走探活档（15 秒），`GITHUB_PROBE_TIMEOUT_MS` 在 `src/shared/time-config/values.js:143`）。

| 环节 | 行号 | 做什么 |
| --- | --- | --- |
| 分桶 | :287 | `isWriteGhArgs(args) ? 'write' : 'read'` |
| 定档超时 | :289 | `timeoutForGhArgs(args)`：读 12 秒 / 写 30 秒 / 探活 15 秒（档位值在 `src/tracker/kernel/outbound-tiers.ts:8-9`，函数在 :89） |
| 房内自己掐表 | :290-336 | 定时器在**拿名额之前**就起（拿名额在 :341），所以排队段也被盖住；到点算超时、被调用方取消算取消（原因见 :294） |
| 拿名额 | :341 | `control.acquire({bucket, signal})`：满了就排队，「等」不算失败。出站控制面是契约 `src/tracker/contract/outbound.ts:39-51`（`acquire`/`noteWrite`），房内经 `getOutbound` 取（:160-162），没接上就按环境失败大声报出来、不发这一笔（:282-285） |
| 报出站 | :370 | `reportOutbound(ctx, args)`——真要起进程了才报，排队中被取消的不进账 |
| **起进程** | **:372** | **`exec('gh', args, { cwd, timeout, signal })`** |
| 退出码归一 | :376-381 | 拿不到整数退出码按 `-1` 记失败，不再当 0（:377-379 讲了为什么） |
| 错误分类 | :399 | `ghVerdictOf({code, text})`：先本家前置扩展表 `GH_ERROR_RULES`（`src/tracker/rooms/github/errors.ts:65-128`，数组顺序即判档顺序，层次只许 `fact` → `errcode` → `phrase` → `vague` → `fallback`，见 :63），再通用表（:137-139）；`classifyGhError`（:155）是只要档位的简写版 |

**九个工具在 GitHub 房间各发什么命令**

| 工具 | 契约操作 | 房间函数 | 实际发出的命令 |
| --- | --- | --- | --- |
| `deck_context` | `list(type: map)` | `issues.ts:176`（`listIssues`） | GraphQL 优先（:204-206），失败降级 REST 分页 + pulls 富化 + `sub_issues` 树边修复（:263-275），这一趟带 `fallback: 'rest'` 交出去（:286-293） |
| `deck_context` | `getRepoPermissions` | `repo-permissions.ts:60`（`readRepoPermissions`） | `gh api repos/{o}/{r} --jq .permissions`（:91） |
| `deck_issue_get` | `get` | `issues.ts:312`（`getIssue`） | 先 GraphQL（:329），PR 另走查询（:359）；REST 降级 `gh api repos/{o}/{r}/issues/{n}`（:381），PR 走 `/pulls/{n}`（:397） |
| `deck_issue_get` | `getDependencies` | `graph.ts:307` | 原生 `GET …/dependencies/blocked_by`（:126）拉真值，再反向聚合 |
| `deck_map_snapshot` | `get` + `list(parentKey)` | `issues.ts:176`（`list`）／`issues.ts:312`（`get`） | 子票走的是**契约 `list`**：整仓拉一遍再在内存里按 `parentKey` 过滤（:155-157）。**不是** GraphQL——`gh api graphql -f query=<SUB_ISSUES_QUERY>`（`sub-issues.ts:41` 取查询、`listSubIssues` 在 :58、发命令在 :79）是**契约操作** `Tracker.listSubIssues`（名录第 21 条，见 :15），唯一调用者是宿主电话 `wf.mapTickets`（`src/host/mapTickets.js:107` 判能力、`:121` 调）；REST 的 `repos/{o}/{r}/issues/{n}/sub_issues?per_page=100`（`parent-repair.ts:54`，由 `issues.ts:275` 调）是**列表那条路修树边**用的。三条路名字像、去向完全不同 |
| `deck_issue_list` | `list` | `issues.ts:176` | 同 `deck_context` 那一条 |
| `deck_issue_create` | `create` | `issues-write.ts:63-97`（`createIssue`/`createIssueInner`） | `gh api repos/{o}/{r}/issues --method POST -f title=… -f body=…`（:92、发出在 :97）；标签与认领建后另补（:123-142，有现成函数走正常接口） |
| `deck_map_plan_create` | `create` ×N + `setParent` + `setBlockedBy` | 同上 + `graph.ts:149`（`setParent`）／`graph.ts:412`（`setBlockedBy`） | 同上；父边先走原生旗 `gh issue edit --remove-parent`（:205）→ `--parent`（:235、:241），裸接口走 `sub_issues` 的 `--method DELETE`（:218）／`POST`（:264）；阻塞边 `dependencies/blocked_by` 的 `--method DELETE`（:489）／`POST`（:503） |
| `deck_map_link` | `setParent` / `setBlockedBy` | `graph.ts:149` / `graph.ts:412` | 同上一行 |
| `deck_issue_patch` | `comment` | `comments.ts:45`（`addComment`） | 优先 REST：`gh api repos/{o}/{r}/issues/{n}/comments --method POST -f body=…`（:63），失败回落 `gh issue comment`（:69） |
| `deck_issue_patch` | `setLabels` | `labels.ts:114`（`setLabels`） | 先读后 diff，`gh issue edit --remove-label`（:158） / `--add-label`（:164） |
| `deck_issue_patch` | `update` | `issues-write.ts:314`（`updateIssue`） | `gh issue edit --title/--body`，`gh issue edit` 不认 `--json` 所以改完再 `view` 取回（:341） |
| `deck_issue_patch` | `close` / `reopen` | `issues-write.ts:213`（`closeIssue`）／`:266`（`reopenIssue`） | `gh issue close`；`close` 不认 `--json` 所以先关再 `view` 取回（:228）／`gh issue reopen` |
| `deck_issue_patch` | `setAssignees` | `issues-write.ts:395`（`setAssignees`） | 先读当前做 diff（增量接口要 diff，:431），`gh issue edit --remove-assignee`（:443） / `--add-assignee`（:449） |
| `deck_issue_report` | `get` | `issues.ts:312` | 与 `deck_issue_get` 同一条；上报本身只写本地链，不出网 |

**失败长什么样**

- 命令没起来（`gh` 不在 PATH、没登录）：`kind: 'env'` 或 `'auth'`，`code: -1`。
- 到点没回话：`kind: 'network'`，原文「gh 在 N 毫秒内没有回话（房内分档超时：读 12 秒 / 写 30 秒 / 探活 15 秒），这一笔已经中止」（:336；括号里那三个秒数由 `src/tracker/kernel/outbound-tiers.ts` 的档位常量现算，改档时文案跟着走、不会漂）。
- 排队中被取消：「已取消排队（出站准入等待中被取消），没有发出请求，可重试」（:350）。
- 命令跑了但退出码非 0：按 `ghVerdictOf` 分类，事实与退出码一起交表（:393-399）。

### 7.2 本地 Markdown 房间：最后是工作区里的票文件

**票文件在哪**：`src/tracker/rooms/markdown/path.ts:40-62`（`mdPath`）

- 地图：`<工作区根>/.scratch/map.md`（:49、:56）
- 单票：`<工作区根>/.scratch/issues/<键>.md`（:50、:57-60；文件名规则在 :31-36——纯数字键补成 `NN-untitled.md`，:36）
- 带 effort 范围时一律落到 `<cwd>/.scratch/<effortId>/` 下面（:69-81 的注释与 `effortIssuePath`，:81）

**读**（`src/tracker/rooms/markdown/`）

| 环节 | 文件:行号 |
| --- | --- |
| 真正读文件 | `read.ts:12-16`（`readTextFile`：`fs.resolve` + `fs.readText` 能用的形状挨个试） |
| 判断存在（含沙箱形状差异） | `read.ts:151-171`（`exists`），:153-154 记着「lstat 是路径形、stat/readText 是目标形」这个坑 |
| 列票行（含地图行与三种文件形态兜底） | `issues-read.ts:59-183`（`enumerateIssueRows`；地图行在 :104，`'00'` 即地图） |
| 列清单 | `issues-read.ts:209-263`（`listIssues`） |
| 读一张票 | `issues-read.ts:290-333`（`getIssue`；`00` 是地图：走 :311-327 那条分支，:312 定地图文件、:315 读它、:321 解析） |

**写**（四条路，都先排队；落盘真身是 `write.ts:56` 的 `publishTextFile`——临时文件 + 改名原子发布，`writeTextFile` 在 :33）

| 写什么 | 入口 | 排队 | 真正落盘 |
| --- | --- | --- | --- |
| 建票（含取号） | `issues-create.ts:223` | `withWorkspaceWriter` :251（取号 → 探测 → 落盘三段在同一条队里，:241-248） | 落盘后当场回读核对锚 :322 |
| 改票 | `updateIssue`（`issues-patch.ts:80`）等 | `readParseWrite`（:54-55，内层 `withFileWriter`） | 经 `publishTextFile` 整份覆盖 |
| 加评论 | `addComment`（`comments.ts:37`） | `withFileWriter` :50 | 同上 |
| 关闭/重开 | `closeIssue`（`issues-status.ts:90`）／`reopenIssue`（:101） | `withFileWriter` :71 | 同上 |

改票那几条的具体入口：`updateIssue` `issues-patch.ts:80`、`setBlockedByIssue` :204、`setAssigneesIssue` :269、`setParentIssue` :341、`setLabelsIssue` :449。

**为什么必须排队**：本后端改文件的统一做法是「读整份 → 内存里改 → 整份覆盖写回」，中间那次读会让出事件循环；两路并发会一起读到旧内容、各自覆盖，**两路都回成功，盘上少一半改动**。队按钥匙分：同一份文件排一条链，不同文件各走各的（`write-queue.ts` 文件头注释就是这段原委）。

| 队列函数 | 行号 | 钥匙 |
| --- | --- | --- |
| `withSingleWriter` | :29-34 | 通用：同钥匙串成一条链（`prev.then(work, work)`，:31），前一条失败不带崩后一条 |
| `workspaceWriteKey` | :45-49 | 工作区钥匙：统一斜杠、去尾部斜杠、折小写（:48） |
| `fileWriteKey` | :51-55 | 工作区钥匙 + 归一后的文件路径（:54） |
| `withWorkspaceWriter` | :58-60 | 用在「要先读整个目录才知道写哪一份」的地方（建票取号） |
| `withFileWriter` | :63-65 | 用在「已经知道该写哪一份票」的地方（改票、评论） |

**真正的落盘那一步**：`src/tracker/rooms/markdown/write.ts:33`（`writeTextFile`）与 `:56`（`publishTextFile`：临时文件 + 改名原子发布）

```
writeTextFile(ctx, fullPath, content, sandboxPolicy)
  → fs.resolve(fullPath) → fs.writeText(target, String(content), undefined, undefined, policy)
```

三种写入形状挨个试（:40-42），每一步都把沙箱拒绝单独认出来换成能指路的错（:27-32 的 `isSandboxDeny` / `sandboxDenyError`）。原子换名在 :71-73（`renameFile`）。

**失败长什么样**

- fs 不可用：`kind: 'env'`，「fs unavailable」/「fs.write not supported」。
- 沙箱拒绝写：换成 `sandboxDenyError`，调用方按「策略不让写」处理（:15-19）。
- 改票时旧正文没读回来：**宁可不写**。`src/deck/tools/issue-patch.ts:330-331` 那条原话是「旧正文没读回来，不敢拿半截正文覆盖：这次进度没写，等能读回旧正文再写（若急用，改传整段 body）。」——因为空写一次会把整张票冲成只剩进度段。

### 7.3 宿主侧的缓存快照：服务面板，不服务这九个工具

**先分清同名不同物**：这一节的「快照」是宿主**缓存**起来的一整份工作区视图（TTL 默认 5000 毫秒、最多留 20 份），给面板与会话刷新读。第 8 层那个 `deck_map_snapshot` 工具名字里虽然有 snapshot，但它**不读这份缓存**——它是当场按需取数、再自己投影（`shell.call` → 房间的 `get` / `list` → `src/tracker/deck-derive.ts:269` 的 `deriveDeck`）。两者唯一的接触是「写完一票把这份缓存作废」（本节末尾）。

**谁生成**：`src/host/tracker/snapshot.js`

| 环节 | 行号 | 说明 |
| --- | --- | --- |
| 装快照 | :88-139 | `assembleSnapshot(repo, all)`：装 `maps` / `tickets` / 未挂图的票 |
| 按后端问计数 | :158-170 | `countsFromBackend`（拿不到一律回 null，调用方退回派生值并把 `deck.partial` 置真，:166） |
| **编排入口** | **:215-294** | **`composeSnapshot`**：`list` 全量 → 组装 → deck 派生 → 计数覆盖 → 打降级标记 |
| 缓存键与版本 | :193-200（TTL 默认值在 :185-186 = 5000 毫秒） | `snapshotVersionOf`（:193） / `snapKeyOf`（:197） / `fresh`（:200） |
| LRU 上限 | :187 | `SNAP_LRU_MAX = 20` |
| 阻塞边只缓存成功结果 | :298-315 | `getDependencies`（只缓存边数据，:298；实现在 :301-315） |

**谁调它**：只有宿主的两条电话，各自在两个分支里现建现用——`src/host/sessionSnapshot.ts:161-166` 与 `:307-310`、`src/host/sessionRefresh.ts:123-126` 与 `:283-286`；产物是 `createSnapshotComposer`（`src/host/tracker/snapshot.js:184`）。**九个 deck 工具都不在这条路上**（全仓 `createSnapshotComposer` 的调用点只有上面这四处，都在宿主侧）。

**写完之后怎么让它作废**：工具在返回值里带 `touched`（写过的票号），`src/deck/shell/call-shell.ts:451-456` 拿着它调接线的 `invalidate`，实现是 `src/host/refresh/wiring.ts:427`——按**工作区目录**把那一份缓存置空。这里踩过一次坑：只给 repo 与票号、不给工作区，宿主那侧的缓存按 cwd 分桶，就认不出该作废哪一份，那一步会**静默什么也没做**（原委写在 `src/deck/shell/call-shell.ts:452-454`）。

**快照这条路的失败长什么样**：读不到就是读不到——`composeSnapshot` 失败时回 `{ok:false, error}`，调它的那条电话把它变成错误。

**注意别把两件事记成一件事**：工具取数失败**不是**这条路的失败——那是它自己那次 `t.get` / `t.list` 没成，走 `backend-unsupported` 那一档，并在 `notes` 里带一句后端原话（例：`src/deck/tools/map-snapshot.ts:143`「子票没取全（后端原话：…）：下面的进度是手上这几张票算出来的，偏乐观。」）。

---

## 第 8 层：九个工具各一条路（索引卡）

每张卡的读法：**入口 → 后半段调了哪些契约操作 → 最底层是谁 → 失败时 AI 看到什么**。

### 8.1 `deck_context` — 我在哪个仓库、后端是谁

```
run                  src/deck/tools/context.ts:87-211
  ├ 取会话            :90   → src/deck/shell/session-workdir.ts:143
  ├ 选后端            :96   → src/deck/shell/call-shell.ts:240
  ├ 沙箱策略          :107-114（5 秒上限，`DECK_SANDBOX_TIMEOUT_MS` 在 `src/shared/time-config/values.js:153`）
  └ shell.call        :116   kind: read
       ├ 预检、地图清单、仓库权限三路并行   :124-131
       ├ 预检              t.preflight   → 房间 preflight
       ├ 地图清单          t.list({type:'map'})
       ├ 仓库权限          t.getRepoPermissions（#992 只读旁路）
       └ 报账               :143  claimed { requests: 3, points: 2 }
```

**最底层**：GitHub 房间是 `gh api`（清单走 GraphQL 优先）；本地房间是读 `.scratch` 下有没有 `map.md`（`markdown/index.ts:211-232` 的 `preflight`）。

**失败长什么样**：清单没取到 → 状态从 `ok` 降成 `partial`，`notes` 里带一句后端原话（:180）；权限问不出来 → `permissions: { unknown: true }`，**不捏造**（:178）。只读仓库会多一句建议先 fork（:183-184）。

### 8.2 `deck_issue_get` — 读一张票连同关系

```
run                  src/deck/tools/issue-get.ts:145-248
  ├ key 归一与会话检查  :151-155（:151 取会话，:155 key 缺席就不动 → BAD_ARGS）
  ├ 选后端            :157
  └ shell.call        :174   kind: read
       ├ t.get(repo, key, {comments:{first}})   :182（first 在 :162 夹在 0..200，缺省 50）
       ├ 传输层标记 → 当场抛                      :184（超时那一路 1 请求 3 点）
       ├ t.getDependencies                       :202（blocking=false 时整段跳过，:201；判据在 :164）
       ├ relationsOf 拼关系                       :208   → src/deck/shell/edge-landing.ts:34（转出，真身 rules/edge-landing.ts:128；落点档 EDGE_LANDING 在真身 :30）
       ├ 落点说明                                 :234（读路径只知道契约字段里有这条关系，如实说明）
       └ 报账                                     :243  两次读 6 点 / 跳反向边一次读 3 点
```

**最底层**：GitHub → `gh api repos/{o}/{r}/issues/{n}`；本地 → 读 `<根>/issues/<键>.md` 并解析。

**失败长什么样**：票没读回来 → `unsupported` + `backend-unsupported`，「这张票没读回来（后端原话：…）。」（:193）。反向边（「谁被这张票阻塞」）没读到只是注记一句，票照样回（:213）；但**这句注记不是保证**：条件是「真的调过 `getDependencies`、且它回了不成功」（:202、:213），要是这个后端连这个方法都没有，连注记都不会出现——那时上面那一栏是空还是真的 0 条，**别当成 0 条看**。`blocking=false` 时明确写「上面『阻塞别人』记空不是 0 条」（:212）。

### 8.3 `deck_map_snapshot` — 一张地图的全部子票

```
run                  src/deck/tools/map-snapshot.ts:94-201
  ├ 参数              :43-57  key（必填）、frontierOnly、detail（full|thin）、effortId
  ├ key 必填          :104
  └ shell.call        :114   kind: read
       ├ 地图与子票同时取  :121-122（两份 promise 并行，不会互相覆盖）
       ├ 地图读不回来就整笔 unsupported（:125-133，claimed 1 请求 3 点，:133）
       ├ 派生统计用共享层同一份投影  :146   → src/tracker/deck-derive.ts:269（deriveDeck）
       ├ frontierOnly 在手上这批里筛可接  :149-169
       ├ detail=thin 只瘦回包，数字照全量算  :175-176
       ├ 报账（成功那一路）       :197   { requests: 2, points: 5 }
       └ 报账（地图读不回来那一路） :133   { requests: 1, points: 3 }
```

**最底层**：GitHub → `t.list(repo, { parentKey: key })`（`src/deck/tools/map-snapshot.ts:122`）→ 整仓拉一遍 + 内存按 `parentKey` 过滤（`src/tracker/rooms/github/backend.ts:112` 把 `list` 映到 `listIssues`、过滤在 `src/tracker/rooms/github/issues.ts:155-157`）；本地 → 枚举票行（`src/tracker/rooms/markdown/issues-read.ts:59-183`，地图行在 :104）再按父票编号筛。（房内那条 GraphQL 取子票的旁路 `listSubIssues` 不在这条路上，它只服务 `wf.mapTickets`，见 7.1 那格的说明。）

**失败长什么样**：子票没取全 → 状态 `partial`、`stats: null`、`truncated: true`，原话「地图 X：子票没取全（后端没给全），手上这 N 张算出来的数偏乐观，先重调一次再看数。」（判定在 :148，文案在 :183，`stats` 置空在 :187）。地图本身读不回来 → 整笔 `unsupported`（:125-133）。

### 8.4 `deck_issue_list` — 按状态 / label / 人列薄行

```
run                  src/deck/tools/issue-list.ts:106-225
  ├ 参数归一          :103-117（state / type / labels / assignee / query / limit / effortId，limit 夹在 1..200，:117）
  └ shell.call        :139   kind: read
       ├ t.list(repo, filter)            :150
       ├ type 在内存里再判一次（后端可能忽略它）  :168-173
       ├ label / assignee / query 在内存里筛      :174-187
       ├ 截断如实说（只回前 N 行）               :212
       └ 报账                                    :221
```

**最底层**：同 `deck_context` 的清单那一条。

**失败长什么样**：清单没取回来 → `unsupported`，「ISSUE 列表没取回来（后端原话：…）。」（:157）。截断了会说「只回前 N 行（共 M 行符合）：收窄过滤或调大 limit 再取一次。」（:212）

### 8.5 `deck_issue_create` — 建一张票

```
run                  src/deck/tools/issue-create.ts:115-281
  ├ 参数              :74-92  title（必填）、body、kind、labels、assignees、parentKey、effortId、idempotencyKey
  ├ title 必填        :119（空就 BAD_ARGS :126）
  ├ kind 缺省补齐     :120（kindOf 在本文件 :95；map / task / bug，看标题里有没有「地图」字样一类启发式）
  ├ 补齐必备标签与正文区块  :134-135 → 真身 src/deck/rules/minimal-spec.ts:49（ensureLabels）、:89（ensureBody；壳 minimal-spec.ts:31-32 只是转出）
  ├ 幂等锚            :137（显式 idempotencyKey 优先，否则 anchorKeyFor；锚函数在 src/deck/shell/minimal-spec.ts:54-56，档位宽度由 anchor.ts 的 ANCHOR_WINDOW_MS 定义，:59-62）
  └ shell.call        :147   kind: write
       ├ t.create(repo, {title, body, type, labels, idempotencyKey, parentKey?, assignees?})  :159（input 在 :156-158 现拼）
       ├ 超时那一路独立原因码 backend-timeout（票建上没有说不清，先按标题查一次再续）  :166-170，报账 :169
       ├ 后端诚实失败那一路  :173-178，报账 :177
       ├ 传输层标记 → 当场抛（可重试）  :172
       ├ 必备标签注记（补上了说补了；后端说没挂上就别当挂上）  :185-186
       ├ 命名守护钩子 onTicketCreated  :190（失败、超时都不改返回、也不注记——所以别以为它一定跑过）
       ├ 建成了但父边没挂上 → partial  :228-250（判据：写后读回的结构字段里能看到这条父子，:200-221；回包自述、正文票号都不算证据）
       ├ 建成了但标签没挂上 → partial  :252-267（#992 按结果说话）
       ├ 报账（成功那一路）        :277  有父票 3 请求 6 点 / 无父票 2 请求 4 点
       └ 报账（失败那两路）        :169、:177  各 1 请求 4 点
```

**最底层**：GitHub → `gh api repos/{o}/{r}/issues --method POST`（`src/tracker/rooms/github/issues-write.ts:92`），标签/认领/父票建后另补；本地 → 在工作区写者队列里取号并落盘（`src/tracker/rooms/markdown/issues-create.ts:223`，取号→探测→落盘三段同一队列，:241-251）。

**失败长什么样**：

- 超时 → 独立原因码 `backend-timeout`，「这张票这次没建成（超时了：在限时内没等到后端回话，票建上没有说不清；先按标题查一次再续，不要直接重建）。」（:166-170）
- 后端诚实说建不成 → `unsupported`，「这张票没建成（后端原话：…）。」（:173-178）
- 票成了、父子边没成 → `partial`，「票 X 建好了：…。父子边没挂上（要 Y）：…」（:228-250；「没读回来、判不了」那一路抬头是「父子边没确认」，:233-235）
- 票成了、标签没成 → `partial`，并说「标签没挂上，别把它当成已经打上：逐条原因在同包的 items 里。」（:185-186 注记，:252-267 回执）
- 成功时那句话点明「返回值就是写后的真状态，不必再读一次。」（:271）

### 8.6 `deck_map_plan_create` — 建整张地图骨架

这是九个里最长的一条（`src/deck/tools/map-plan-create.ts:186-456`），因为它要能**续跑**。

```
run                        :186-456
  ├ title + 至少一张子票必填  :199-201
  ├ 计划标识 planId          :202（显式优先，否则 anchorKeyFor）
  ├ 同一计划正在跑？拒绝       :203-206（ACTIVE_PLANS，:72）
  ├ 中间态存储器             :213-244（注入优先，没有退回文件游标；游标读写加竞速超时保护，:228-244）
  └ shell.call               :250  kind: write
       ① 地图票只建一次       :264-281（幂等键 'deck-plan-<planId>-map'，:269；失败报账 :275）
       ①b 批量锚预检：一次列表把已建的子票认回来  :287-308
       ② 子票：一次调用只建**第一片**（已建成的键跳过，剩下的进 restKeys）  :313-316
          这一片里的子票同时建                                              :317-329（子票的父子边另判，:336-346）
       ③ 边：端点都在计划里才做                 :363-408（阻塞边同票合并一次写，:356-357；@map 指地图票，:360）
       ④ 逐项校验：按父票列一遍，数字对不上就说 partial  :410-421
       └ 报账                                   :451（按估算实报）
```

**最底层**：GitHub → `gh api POST …/issues` ×N + 父边/阻塞边另写；本地 → 工作区队列里逐张建票、逐张写边。

**失败长什么样**

- 地图票没建成 → 整笔 `unsupported`，并明确「后面的子票与边都没动」（:274）。
- 这一片建完了、还有剩下的 → 状态 `partial`，原文「…；还有 N 张没建（…），带同一个 planId 再调一次就接着建。」，同时在 `data.nextCall` 里给出下一步该传什么（:429-430、:445 的 `nextCall.restKeys` 就是「这次没轮到的键」）。
- 额度不够主动停 → `partial`，注明「已建的不用重建」（:390）。
- 逐项校验对不上 → 注记「以这个数字为准，别按计划数字往下走。」（:380）。
- 中间态只在本进程内存里 → 注记「进程重启后重跑同一个 planId 会重新建票。」（:229）。

### 8.7 `deck_map_link` — 补父子边与阻塞边

```
run                  src/deck/tools/map-link.ts:121-278
  ├ 参数              :49-72  key / parentKey / blockedBy 一组，或 edges（一次改多张，两组二选一；顶层没有 required，缺哪边由下一步拦）
  ├ 至少一条边         :131
  ├ 阻塞边合并         :152-164（#898：**只合并 blockedBy 的目标集合**，按票号归并再逐条去重；父子边不合并，各按各自那条写。不合并的后果：同一张票写两次，后一次会删掉前一次的边）
  ├ 整批成环预检       :174-178 → src/deck/shell/edge-landing.ts:228（#929：同批互指的边会留下环）
  └ shell.call         :140   kind: write
       ├ 同票分组持锁串行、不同票并行  :165-173、:179-245（withKeyLock，:184）
       ├ 父子边 applyParentEdge        :188 → src/deck/shell/edge-landing.ts:144-176
       ├ 阻塞边 applyBlockEdges        :215 → src/deck/shell/edge-landing.ts:178-226
       ├ 落点由写后读回判              :200-210、:224-226（classifyEdgeLanding 转出在 edge-landing.ts:38，真身 rules/edge-landing.ts:171）
       ├ 逐项状态合成整笔状态          :252 → src/deck/shell/edge-landing.ts:252
       └ 报账                          :275（按估算实报）
```

**最底层**：GitHub → `gh issue edit --parent` / `gh api …/dependencies/blocked_by`；本地 → 改票文件里的父子行与依赖行（`src/tracker/rooms/markdown/issues-patch.ts`：父子 `setParentIssue` 在 :341，依赖 `setBlockedByIssue` 在 :204）。

**失败长什么样**（逐条如实报，绝不假装建好）

- 顶层一句话带失败摘要：「这次要补 N 条边，建成 M 条。失败 K 条：…」（:255-264）
- 成环预检拒绝：「这条边不写，逐条如实报失败」（:193-198）
- 锁没等到：「这张票正被另一次调用改着，这次没动：稍后带同样参数再调一次即可。」（:232-243）
- 额度不够：「剩余额度不够发这一次调用了，这张票的边这次没动：带同样参数再调一次即可。」（:186）
- 后端留下了计划外的边 → 注记提醒「setBlockedBy 是整批替换，后端却留下了它们，读回来核对一次」（:225）

### 8.8 `deck_issue_patch` — 改票

```
run                  src/deck/tools/issue-patch.ts:154-403
  ├ key 必填          :158/:164
  ├ 至少要改一件事     :174-182（comment / addLabels / removeLabels / assignees / title / body / progress / close）
  └ shell.call        :187  kind: write
       ├ comment   :226-234
       ├ labels    :238-275（整批替换：读回当前标签 → 加减 → 写；写后读回核对真的落上了，:262-271；持同票锁）
       ├ assignees :279-306（回了 ok 也要读回核对名字真的记上了，:292-303）
       ├ text      :310-352（title / body / progress；progress 走 replaceProgressSection :95-135；旧正文没读回来不敢覆盖，:330-331）
       ├ close/reopen :354-379（回了 ok 也要读回核对状态真变了，:363-376）
       ├ 写后读回真状态  :384-386
       ├ 整笔状态按逐项合成  :387-393
       └ 报账                :400（按估算实报）
```

**最底层**：GitHub → `gh issue edit` / `gh api POST /comments` / `gh issue close|reopen`；本地 → 队列里读改写那一份票文件。

**失败长什么样**

- 顶层一句话：「票 X：这次点了 N 步，成了 M 步。」（:393）
- 逐项失败带步骤名与后端原话（`fail`，:202-205）
- 有步骤没成 → 注记「有的步骤没成，逐条原因在上面：别把没成的那一步当成已经改好。」（:388）
- 认领人名字没记上：「后端回了 ok，但读回来的票上没有这些认领人（…）：它可能只改了状态、没记认领人，别当成认领已经记上。」（:302）
- 写后没读回来 → 注记「上面每步是照后端的回答记的。」（:386）

### 8.9 `deck_issue_report` — 上报当前在办哪张票

```
run                  src/deck/tools/issue-report.ts:121-220
  ├ 参数              :78-91  key（必填）、note、effortId
  ├ key 归一          :125（`normKey`，:93-98：去掉开头的 `#`、丢掉前导零，只认 1..10 位数字）
  ├ key 必填          :131
  └ shell.call        :148   kind: write
       ├ t.get(repo, key, {comments:{first:0}})   :157
       ├ 记链 d.chainNote(...)                    :187-202（竞速超时按没记进走老路，:189；没注入记链口按 `no-chain-note`，:200）
       ├ 链上有没有如实说                          :203、:208
       └ 报账                                     :217  { requests: 1, points: 3 }
```

**最底层**：读票走房间的 `get`（GitHub 是 `gh api`，本地是读文件）；上报本身**只写本地链**，不出网。

**失败长什么样**：票没读回来 → `unsupported`，「这张票没上报（票 X 没读回来，后端原话：…）。」（:171-182）。链没记进 → 注记「这次没显式记进链（…）：被动推断那一路仍会按参数里的票号记一次，去重后同一张票只留一条。」（:203）。备注只回显不进链（:156）。

**一个容易误会的：非数字的 key**。传 `key: 'abc'` 会得到「要上报哪一张票：把票号写在 key 里（例如 775）。」——明明写了 key，却像没写。原因是 `normKey` 只认纯数字（去掉开头的 `#`、丢掉前导零后必须匹配 1..10 位数字，:93-98），传别的就当成没写（:131）。看到这句话先回头看一眼 key 是不是数字。

---

## 第 9 层：失败长什么样（横着看一遍）

### 9.1 三个判据决定 AI 看到什么

| 判据 | 在哪 | AI 看到 |
| --- | --- | --- |
| 三态状态 | `src/deck/shell/call-shell.ts:48`、`src/deck/shell/call-shell.ts:426` 与 `:441-442` | `ok` / `partial` / `unsupported`，以及配套的一句话 `text` |
| 机器可读原因 | `src/deck/shell/call-shell.ts:50-59` | `reason` 七值之一 |
| 逐项明细 | 各工具的 `items` | 哪一项成了、哪一项没成、后端原话 |

### 9.2 失败在哪个位置，谁能看见

| 失败位置 | 谁兜住 | AI 看到的 |
| --- | --- | --- |
| 参数不对 | 工具自己（`BAD_ARGS`） | `bad-args` + 一句「要改哪一张票：把票号写在 key 里。」 |
| 会话目录取不到 | `src/deck/shell/session-workdir.ts:69`，同档还有 :95、:133 | `no-session-context` + 「我不动任何票。」两种文案：六个候选都没值 →「这次没拿到当前会话的工作区目录…」；归一到工作区根失败 →「这次没能把工作区目录归一到工作区根…」 |
| 后端没定 / 多命中 | `src/deck/shell/call-shell.ts:336-339` | `no-backend` + 引导去面板选 |
| 超过硬顶 | `gate.admitAiTool`（`src/deck/shell/call-shell.ts:369`） | `ai-tool-refused` + 闸那句原话 |
| 被闸推迟 | `src/deck/shell/call-shell.ts:418` | `gate-defer` + 推迟原因 |
| 工具内部抛错 | `src/deck/shell/call-shell.ts:402-408` | `backend-threw`，「后端实现抛错了（我没有把它抛给 AI，按三态返回）：…」 |
| 传输层（五个工具带这份标记） | 工具当场抛（`src/deck/tools/issue-create.ts:171-172`、`src/deck/tools/issue-get.ts:185-186` 等） | 同上，但可重试 |
| 后端诚实说做不到 | 工具按后端回答记 | `backend-unsupported` + 后端原话 |
| 工具回包不合约定 | 宿主电话那层收：`src/deck/registration/host-delegate.ts:106-107`；走兼容钩子那条路则在 `src/deck/registration/register-options.ts:322` | `backend-threw`，「工具内部没按约定回包，已拦下」 |

### 9.3 一类特别的失败：写成了、但没完全成

这是这套工具最要紧的设计——**不把「票建好了」说成「什么都成了」**：

| 情形 | 工具 | 回报 |
| --- | --- | --- |
| 票建成了、父子边没挂上 | `deck_issue_create` | `partial` + 逐项 `failed`（判据 :200-221，返回块 :228-250） |
| 票建成了、标签没挂上 | `deck_issue_create` | `partial`，并写明「别把它当成已经打上」（注记在 :185-186；:252-267 是那条 partial 的返回块） |
| 一批边里有的成有的不成 | `deck_map_link` | `partial` + 失败摘要（:252-264） |
| 地图建了一片、还有剩下的 | `deck_map_plan_create` | `partial` + `nextCall` 指路（沿用句在 :429-430，`nextCall` 字段在 :445） |
| 改了五步、成了三步 | `deck_issue_patch` | `partial` + 逐项步骤名（:387-394） |
| 认领回了 ok 但名字没记上 | `deck_issue_patch` | 该项记 `failed`（:302） |
| 子票没取全 | `deck_map_snapshot` | `partial` + `stats: null`（判定 :148，文案 :183，`stats` 置空在 :187） |

---

## 第 10 层：这份文档本身

**为什么放这里**：#1094 正文写「建议新开一份，放 `docs/tour/` 之类的位置」。`docs/tour/` 此前不存在，本文件是它的第一份。

**范围**：只写文档。这份文档的产出没有改任何产品代码、没有改测试。

**行号口径**：基线提交 `f1dc6376`。行号会随代码漂移，改代码的人顺手改这一份；核对的人发现对不上，就是该更新了。

**改完怎么自查**（2026-10-12 加：这一版走过一轮对抗式复核，下面三个动作就是那轮用的，照做即可）

1. **逐条核行号**：把全文的「文件:行号」抽出来，写成一张断言表（每条给「文件 + 行号 + 这一行该出现的片段」），跑一遍；再故意塞一条错的进去，确认脚本真能抓出来——抓不出来说明断言太松，等于没查。
2. **扫旧说法残留**：全文搜 `三段路`、`共同三步`、`面板那条路`、`没有第二个起进程的地方` 这类词。它们是这一版改掉的说法，回来一个就说明哪一处的叙事又滑回旧理解。另外搜 `七个`：正文自己叙述时一律说**九个**，只有引用代码注释或工具文案的原话时才会出现「七个」（例如 `src/deck/registration/host-delegate.ts:79` 那句），看到就先确认它是不是在原话里。
3. **找一个没读过前文的人**：把改后的文档单独给他，让他从头讲一遍这条链路，并列出「没有行号支撑的结论」和「读起来与代码相悖的结论」。**行号断言抓不出「讲反了」**——这一版最大的错就是讲反，所以这一步不能省。

**复核记录**

- 2026-10-12 第一轮（三批独立核对，按层分）：改掉的主要是**叙事讲反**的地方——第 1、2 层原来把「谁给 AI 注册工具」写成了宿主启动时的注册、把 `wf.deckExec` 写成了「面板那条路」；第 3 层原来把「取会话」写在参数校验之后（实际在前）；第 7.3 节原来把快照与工具说成一条因果链（这九个工具根本不经过那份缓存）；补齐了索引卡缺的参数项与报错数字。**产品代码一行未改。**
- 2026-10-12 第二轮（两个没读过前文的人各自从头讲一遍，再逐条回代码核对）：又改了七处，其中三处是**第一轮自己改出来的错**，记在这里当教训——
  1. 第一轮把 `deck_map_snapshot` 取子票写成 GraphQL，**这是错的**，第二轮改成「契约 `list` → 整仓拉一遍 + 内存按 `parentKey` 过滤」（`src/deck/tools/map-snapshot.ts:122`、`src/tracker/rooms/github/backend.ts:112`、`src/tracker/rooms/github/issues.ts:155-157`）。GraphQL 那条 `listSubIssues` 只服务宿主电话 `wf.mapTickets`（`src/tracker/rooms/github/backend.ts:118-120`），REST `sub_issues` 那条只用于列表修树边（`src/tracker/rooms/github/parent-repair.ts:54`）——三条名字像、去向完全不同，**改行号之前先把「谁调这条命令」查清楚**。
  2. 第一轮写的「落到哪条路由取决于行与宿主是不是同一个进程」，判据其实更朴素：**本进程里那张表放了没**（`peekDeckTable` 的模块状态，`src/deck/shell/table-cell.ts:75-80`）；`bridgeSameProcess` 只是给探针看的诊断值，不参与判定。
  3. 第 1 层原来把「表没好」与「工具服务没好」混成一句：服务不在，行起不来（`src/deck/registration/agent-row.ts:393-397`，工具看不见）；只有表没好，工具照样看得见、调用回 `not-wired` 占位。
  另有四处是写这份文档时把「注释当行为」抄错的，其中第一处在 2026-10-16 随那道门的删除而收掉：第 4 层原来说「读用途不受影响」，实际当时 `pickBackend` 没有读/写参数，纯读的四个工具同样被 `no-backend` 拦（当时 `src/deck/shell/call-shell.ts:342` 的注释与 `:343` 的行为不一致）；其余三处是判定出口没装上的那一档回包是**错位的**（`src/deck/shell/call-shell.ts:292` 少传工具名）；带传输层标记的工具是五个不是四个（`src/deck/tools/issue-get.ts:31` 也有一份）；`errors.ts` 开头注释里只有 `network` 与 `not-found` 的先后跟代码相反，不是整段写反。
- **这一版最该记住的两条**：行号断言只能证明「那一行存在」，证明不了「这话讲得对」；注释和文案里的说法可以跟代码不一致，凡是要写进「失败长什么样」的，回到代码那一行看它到底返回什么。

**已知没写到的（留给下一版）**

- 第三座房间 GitLab 只写了门面与最底层（`gitlab/index.ts:245-357` 的操作映射、`src/tracker/rooms/gitlab/client.ts:108` 的 `execGlab('glab', args, …)`），没有逐工具走一遍。它不在 #1094 点名的三座底层里（gh 进程、Markdown 文件、快照）。
- 宿主电话 `wf.deckExec` 只写到它自己的六种回法为止；行模块拿到结果之后怎么渲染给 AI，没展开。
- 快照与面板之间的那条读路（`src/host/sessionSnapshot.ts` / `src/host/sessionRefresh.ts` / `src/host/mapTickets.js`）只指了入口，没逐层展开。
- 源码里还留着几处过时的名字与注释（`src/deck/registration/agent-row.ts:34` 的常量叫 `SEVEN` 其实是九项；`src/deck/registration/register-options.ts:8`、`src/host/refresh/wiring.ts:308`、`src/deck/registration/host-delegate.ts:59`、`package/cordis.patch.yml:2` 还写着「七个」；`src/tracker/rooms/github/errors.ts:6-7` 的注释里 network 与 not-found 的先后跟代码相反）。这份文档按**代码实际行为**写，不按那些注释写；要不要改注释是另一件事。
- 两条注册路同时装上时，同一个工具名注册两次会怎样（谁生效、会不会报错）：`src/deck/registration/agent-row.ts:402` 与 `src/deck/registration/register-options.ts:387` 都调 `tools.register`，仓库里没有说明，这一版**没有结论**，别当成已查明。

**接手方式**

- #1022（地图 01 讲解）：讲解时**改这一份**，不另开新文件。
- #1077（收口核对）：对着这一份核对代码；行号与结论对不上就是文档要跟。
