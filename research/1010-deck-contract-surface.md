# deck 契约调用面清单（任务B，2026-10-11，只读代码所得）

这份文件回答一件事：下一步写 `contract/` 的 TypeScript 接口时，每一个接口成员从哪里来。范围只含 deck 代码调到的外部方法与字段，不含面板链路。每一行都带文件路径与行号；拿不准的一律标“未核实”，没有猜的。

读法：表 A 是壳调注册表、闸与后端；表 B 是九个工具调壳、边判定与 tracker 操作；表 C 是装配时递进来的全部依赖；表 D 是两房对外导出的名字；表 E 是校验条目与契约已有类型名。

## 表 A：`src/shared/deck-tools/shell.js` 调到的外部（20 个调用点）

| # | 谁调谁 | 参数形状 | 返回形状 | 证据 |
|---|--------|----------|----------|------|
| A1 | 壳调 `d.handleFor(s)` 取句柄，缺席只用会话目录 | 入参为会话对象 `s` | 返回句柄或 `{cwd}` | `src/shared/deck-tools/shell.js:167` |
| A2 | 壳调 `d.ensureReading(cwd, workspaceKey)` 保剩余额度读数，失败照旧往下走 | 工作区目录加工作区键 | 无返回值要求，抛错吞掉 | `src/shared/deck-tools/shell.js:172` |
| A3 | 壳要求 `d.decideBackend` 必须存在，缺席回三态不抛 | 无（存在性检查） | 缺席时回 `backend-threw` 三态 | `src/shared/deck-tools/shell.js:176-180` |
| A4 | 壳经统一判定出口 `useOutlet(s.cwd, {...})` 选后端，显式四层加自动识别 | 目录加 `{registry, backendCtx, readChoice, readWorkspaceFileText, parseWorkspaceFile, readDeclarationId, caller, autodetect}` | `{backendId, source, ref, multiHit, pending}` | `src/shared/deck-tools/shell.js:188-192` |
| A5 | 自动识别分支调 `registry.select(handle, ctx)`，上下文带工作区目录、调用方与中止信号 | 句柄加 `{...backendCtxNow(), cwd, caller:'deck-tool', signal}` | 注册表的选择结果（含 `backendId/source/ref/multiHit/pending`） | `src/shared/deck-tools/shell.js:183-184` |
| A6 | 标识缺失时调 `registry.describe(handle, backendId)` 补仓库身份 | 句柄加后端标识 | 仓库引用或空，抛错置空 | `src/shared/deck-tools/shell.js:195` |
| A7 | 补标识前调 `registry.get(backendId)` 取该后端的 tracker | 后端标识 | tracker 对象或空 | `src/shared/deck-tools/shell.js:216` |
| A8 | 有该能力的后端调 `tracker.getRepoKey(cwd, ctx)` 补 `owner/name`，竞速上限缺省 8000 毫秒、可经 `d.resolveTimeoutMs` 配（非法值也回落 8000） | 工作区目录加 `{...backendCtxNow(), cwd, caller}` | `{owner, name}` 或空，超时按空走 | `src/shared/deck-tools/shell.js:222-227`，竞速上限见 `:218`（`resolveTimeoutMs` 是可选依赖端口，接线未传入） |
| A9 | 选后端与补标识各过一次 `gate.send({source:'tool.call', kind:'probe', bucket:'rest', workspaceKey, plan:[{phase}]}, perform)`，执行函数回 `{requests, points}` | 闸请求加记账回调 | `{sent, requests, points, reason, detail}` | `src/shared/deck-tools/shell.js:187` 与 `:222` |
| A10 | 动手前调 `gate.admitAiTool({points, requests, childTickets}, {workspaceKey, kind:'tool-batch', bucket:'graphql'})` 判硬顶 | 估算量加工作区键与桶 | `{admitted, reason, text, points, requests}`，不通过回超顶三态 | `src/shared/deck-tools/shell.js:268` |
| A11 | 真调用包进 `gate.send({source:'tool.call', kind:'tool-batch', bucket:'graphql', workspaceKey, plan:[{phase}]}, work)` 记账 | 闸请求加工作函数 | 同 A9 的发送结果形状 | `src/shared/deck-tools/shell.js:290-297` |
| A12 | 算账前调 `d.hourUsage()` 问本小时已花量，拿不到按零算 | 无 | `{points, requests}` 或空对象 | `src/shared/deck-tools/shell.js:124-127` |
| A13 | 算账调 `d.costInputFrom(tool, args)` 组输入，再调 `estimate(input, {...limits, usedPointsThisHour, usedRequestsThisHour})` | 工具名加参数 | `{points, requests, tickets, withinCallCap, shards, perShard, text}`（用法所见形状） | `src/shared/deck-tools/shell.js:128-130` |
| A14 | 后端上下文经 `d.backendCtx` 取，可为对象或现取函数，取不到给空对象 | 无或调用一次 | `{platform, fs, exec, logEvent, isEnabled}` 一套 | `src/shared/deck-tools/shell.js:111-116` |
| A15 | 写后调 `d.invalidate({repo, backendId, keys, workspace})` 作废该工作区快照，只在本次触达非空时才调 | 仓库加票号清单加工作区 | 无返回值要求，抛错吞掉；空触达直接跳过（守卫见 `:345`） | `src/shared/deck-tools/shell.js:345-349` |
| A16 | 成功记 `log.fire('info','host.call',{method, latencyMs, ok:true, kind:'deck-tool'})`，失败记 `log.fire('warn','host.call.fail',{method, kind, errorHash})` | 方法名加耗时或错误散列 | 无 | `src/shared/deck-tools/shell.js:97-103` |
| A17 | 各阶段调 `d.noteGate({phase, verdict, reason})` 留闸口径迹 | 阶段加结论加原因枚举 | 无，缺席跳过 | `src/shared/deck-tools/shell.js:107-109` |
| A18 | 取时间调 `d.now()`，缺席用 `Date.now` | 无 | 毫秒数 | `src/shared/deck-tools/shell.js:94` |
| A19 | 工作函数收到的 `ctx.opCtx` 形状为 `{...backendCtxNow(), cwd, signal:undefined, caller:'deck-tool', sandboxPolicy, sessionId}`，`ctx.tracker` 为 `registry.get(backendId)` | 由壳组装 | 工具只读不改——这一条目前只是约定，源码没有冻结对象；写接口时用只读类型在编译期定死（记为待定项） | `src/shared/deck-tools/shell.js:279-288` |
| A20 | 发送结果的实际花费形状为 `{requests, points, remaining, tier}`，并进信封的 `cost.actual` | 由闸返回 | 工具原样透出 | `src/shared/deck-tools/shell.js:324-327` |

## 表 B：九个工具调到的壳函数、边判定与 tracker 操作

### B0：九个文件同形的六步（8 个调用点）

| # | 内容 | 证据 |
|---|------|------|
| B0-1 | `sessionContextOfAsync(exec, {canonicalKey, workspaceKeyOf})` 取会话，返回 `{ok, cwd, workspaceKey, sessionId, source}`，规范根失败回 `no-session-context` | `src/shared/deck-tools/session-resolve.js:28-47`，九个工具各调一次 |
| B0-2 | `shell.estimateFor(tool名, args)` 算账 | 九个工具各一处，如 `src/host/tools/deckContext.js:53` |
| B0-3 | `shell.unsupported(tool, reason, text, extra)` 组三态失败 | 九个工具各多处，如 `src/host/tools/deckContext.js:54` |
| B0-4 | `shell.pickBackend(exec, s)` 选后端，返回 `{ok, backendId, source, ref}` 或三态失败 | 九个工具各一处，如 `src/host/tools/deckContext.js:56` |
| B0-5 | `shell.repoOf(pick, s)` 组仓库身份 `{backend, refId, name, url, effortId}` | 九个工具各一处，如 `src/host/tools/deckContext.js:66` |
| B0-6 | `shell.call({tool, kind, session, pick, repo, estimate, sandbox, signal}, work)` 包闸执行，`kind` 为 `read` 或 `write` | 九个工具各一处，如 `src/host/tools/deckContext.js:75` |
| B0-7 | `withCallScope(c, exec, {timeoutMs:d.toolTimeoutMs, marginMs:d.toolMarginMs, now})` 取 `{tracker, opCtx, memo, budget, remainingMs, outOfBudget, execOp, ok}`，缺 tracker 则范围不成立 | `src/shared/deck-tools/call-scope.js:148-165` 与 `:324-333`，九个工具各一处 |
| B0-8 | `d.sandboxPolicyFor({cwd, sessionId})` 取沙箱策略，5000 毫秒竞速，拿不到置空 | 九个工具各一处，如 `src/host/tools/deckContext.js:67-73` |

### B1：`deck_context`（5 个调用点）

| # | 内容 | 证据 |
|---|------|------|
| B1-1 | `t.preflight({cwd}, opCtx)`，有才调，返回 `{ok, error}` | `src/host/tools/deckContext.js:81` |
| B1-2 | `t.list(repo, {type:'map'}, opCtx)` 取地图清单 | `src/host/tools/deckContext.js:82` |
| B1-3 | `t.getRepoPermissions(repo, opCtx)` 问写权限，只读旁路非契约操作，问不到按未知 | `src/host/tools/deckContext.js:87-88` |
| B1-4 | `knownWritePermissions(backendId)` 判本地后端恒可写 | `src/host/tools/deckContext.js:86`，定义见 `src/shared/tracker/backendWritePermissions.js:25` |
| B1-5 | 额度常量 `budget.AI_TOOL_MAX_POINTS_PER_CALL` 等五项拼回包的 `quota` 格 | `src/host/tools/deckContext.js:128` |

### B2：`deck_issue_get`（3 个调用点）

| # | 内容 | 证据 |
|---|------|------|
| B2-1 | `t.get(repo, key, {comments:{first}}, opCtx)` 读单票 | `src/host/tools/deckIssueGet.js:114` |
| B2-2 | `t.getDependencies(repo, key, {}, opCtx)` 取阻塞边，有才调 | `src/host/tools/deckIssueGet.js:132` |
| B2-3 | `EDGE_LANDING` 常量加 `relationsOf(issue, dependencies)` 组关系 | `src/host/tools/deckIssueGet.js:8`，定义见 `src/shared/deck-tools/edges.js:16` 与 `:61` |

### B3：`deck_map_snapshot`（5 个调用点）

| # | 内容 | 证据 |
|---|------|------|
| B3-1 | `t.get(repo, key, {}, opCtx)` 读地图票 | `src/host/tools/deckMapSnapshot.js:85` |
| B3-2 | `t.list(repo, {parentKey:key}, opCtx)` 收子票 | `src/host/tools/deckMapSnapshot.js:86` |
| B3-3 | `childrenOf(rows, mapKey)` 按父键收拢子票 | `src/host/tools/deckMapSnapshot.js:10`，定义见 `src/shared/deck-tools/edges.js:139` |
| B3-4 | `deriveDeck(input)` 与 `parseProgress(body)` 派生面板形状与进度 | `src/host/tools/deckMapSnapshot.js:11`，定义见 `src/shared/tracker/deck-derive.js:147` 与 `:33` |
| B3-5 | `parseMapBody` 认五个区块 | `src/host/tools/deckMapSnapshot.js:12` |

### B4：`deck_issue_list`（1 个调用点）

| # | 内容 | 证据 |
|---|------|------|
| B4-1 | `t.list(repo, filter, opCtx)` 按过滤器取薄行 | `src/host/tools/deckIssueList.js:108` |

### B5：`deck_issue_create`（5 个调用点）

| # | 内容 | 证据 |
|---|------|------|
| B5-1 | `t.create(repo, input, opCtx)` 建票 | `src/host/tools/deckIssueCreate.js:105` |
| B5-2 | `t.get(repo, key, {}, opCtx)` 写后读回，有才调且不出预算才调 | `src/host/tools/deckIssueCreate.js:140` |
| B5-3 | `classifyEdgeLanding`、`unsupportedEvidence`、`edgeEvidence` 组边证据 | `src/host/tools/deckIssueCreate.js:13`，定义见 `src/shared/deck-tools/edges.js:100`、`:127`、`:49` |
| B5-4 | `ensureLabels`、`ensureBody`、`anchorKeyFor` 补标签正文与幂等锚 | `src/host/tools/deckIssueCreate.js:15`，定义见 `src/shared/deck-tools/plan.js:30`、`:44`、`:89` |
| B5-5 | `d.onTicketCreated({sessionId, key, title})` 直达命名守护，超时按没调走老路 | `src/host/tools/deckIssueCreate.js:129-130` |

### B6：`deck_map_plan_create`（7 个调用点）

| # | 内容 | 证据 |
|---|------|------|
| B6-1 | `t.create(repo, {...})` 建地图票一处、建子票一处 | `src/host/tools/deckMapPlanCreate.js:165` 与 `:219` |
| B6-2 | `t.list(repo, {state:'all'}, opCtx)` 查重复锚，`t.list(repo, {parentKey:mapKey}, opCtx)` 收子票 | `src/host/tools/deckMapPlanCreate.js:189` 与 `:297` |
| B6-3 | `createMemoryPlanStore()` 与 `createFilePlanStore(opt)` 管续跑游标 | `src/host/tools/deckMapPlanCreate.js:18`，定义见 `src/shared/deck-tools/plan-store.js:20` 与 `:36` |
| B6-4 | `matchAnchor` 与 `isAnchorHit` 判幂等锚命中，真源在 `src/shared/refresh/idempotency.js` | `src/host/tools/deckMapPlanCreate.js:19` |
| B6-5 | `applyParentEdge`、`applyBlockEdges`、`statusOfItems`、`childrenOf` 写边并汇总 | `src/host/tools/deckMapPlanCreate.js:20`，定义见 `src/shared/deck-tools/edges.js:150`、`:180`、`:247`、`:139` |
| B6-6 | `d.onTicketCreated({sessionId, key, title})` 上报地图建号 | `src/host/tools/deckMapPlanCreate.js:309` |
| B6-7 | 直接引用额度常量整包与算账函数 | `src/host/tools/deckMapPlanCreate.js:22-23`（`budget` 与 `tool-cost`） |

### B7：`deck_map_link`（3 个调用点）

| # | 内容 | 证据 |
|---|------|------|
| B7-1 | 经边帮助调 `t.setParent(repo, from, want, {}, opCtx)`、`t.setBlockedBy(repo, from, want, {}, opCtx)`，读回经 `t.get` 与 `t.getDependencies`，预检经 `t.list(repo, {}, opCtx)` 全图环检 | `src/shared/deck-tools/edges.js:155`、`:183`、`:160`、`:189`、`:226`，工具侧引用见 `src/host/tools/deckMapLink.js:9` |
| B7-2 | `withKeyLock(repo, key, fn, opts)` 包同票写互斥，默认 60 秒 | `src/host/tools/deckMapLink.js:12`，定义见 `src/shared/deck-tools/key-lock.js:36`，常量见 `:22` |
| B7-3 | 直接引用算账函数 | `src/host/tools/deckMapLink.js:10`（`tool-cost`） |

### B8：`deck_issue_patch`（9 个调用点）

| # | 内容 | 证据 |
|---|------|------|
| B8-1 | `t.comment(repo, key, text, opCtx)` 发评论 | `src/host/tools/deckIssuePatch.js:164` |
| B8-2 | `t.get(repo, key, {}, opCtx)` 读现值与写后读回 | `src/host/tools/deckIssuePatch.js:176`、`:223`、`:257` |
| B8-3 | `t.setLabels(repo, key, uniq, {}, opCtx)` 改标签 | `src/host/tools/deckIssuePatch.js:182` |
| B8-4 | `t.setAssignees(repo, key, want, {}, opCtx)` 改认领 | `src/host/tools/deckIssuePatch.js:194` |
| B8-5 | `t.update(repo, key, patch, opCtx)` 改标题正文 | `src/host/tools/deckIssuePatch.js:235` |
| B8-6 | `t.close(repo, key, {}, opCtx)` 或 `t.reopen(repo, key, opCtx)` 开关票 | `src/host/tools/deckIssuePatch.js:248` |
| B8-7 | `statusOfItems(items)` 汇总部分成功 | `src/host/tools/deckIssuePatch.js:9`，定义见 `src/shared/deck-tools/edges.js:247` |
| B8-8 | `withKeyLock` 包同票写互斥 | `src/host/tools/deckIssuePatch.js:11` |
| B8-9 | `ensureBody` 补进度区 | `src/host/tools/deckIssuePatch.js:12` |

### B9：`deck_issue_report`（2 个调用点）

| # | 内容 | 证据 |
|---|------|------|
| B9-1 | `t.get(repo, key, {comments:{first:0}}, opCtx)` 校验票存在性 | `src/host/tools/deckIssueReport.js:96` |
| B9-2 | `d.chainNote({sessionId, rootKey, backend, tool, source, tier, verb, ticketKey, effortId, args, reason:'tool.deck-write'})` 记处理链，超时按没记进走老路 | `src/host/tools/deckIssueReport.js:115-125`，`reason` 实见 `:121` |

## 表 C：装配时传入的全部依赖（28 个调用点）

### C1：`createDeckToolsForHost(toolDeps)` 收的依赖（25 个）

| # | 依赖名 | 接线给的值 | 证据 |
|---|--------|------------|------|
| C1-1 | `gate` | 宿主闸唯一实例 | `src/host/refresh/wiring.js:330` |
| C1-2 | `registry` | 后端注册表，无 `select` 则整表不可用 | `src/host/refresh/wiring.js:314-315` |
| C1-3 | `budget` | 额度常量整包 | `src/host/refresh/wiring.js:332` |
| C1-4 | `estimate` | `toolCost.estimateToolCost` | `src/host/refresh/wiring.js:333` |
| C1-5 | `costInputFrom` | `toolCost.toolCostInputFrom` | `src/host/refresh/wiring.js:334` |
| C1-6 | `handleFor` | 会话找绑定句柄，找不到回 `{cwd}` | `src/host/refresh/wiring.js:335` |
| C1-7 | `canonicalKey` | 会话目录洗加锚根的唯一异步出口 | `src/host/refresh/wiring.js:337` |
| C1-8 | `readChoice` | 读本机记忆，后两层读口之一 | `src/host/refresh/wiring.js:339` |
| C1-9 | `readWorkspaceFileText` | 读工作区锚文件原文 | `src/host/refresh/wiring.js:340` |
| C1-10 | `parseWorkspaceFile` | 解析锚文件文本 | `src/host/refresh/wiring.js:341` |
| C1-11 | `sandboxPolicyFor` | 沙箱策略查询 | `src/host/refresh/wiring.js:342` |
| C1-12 | `backendCtx` | 现取函数，回 `{platform, fs, exec, logEvent, isEnabled}` 同一份 | `src/host/refresh/wiring.js:319-328` 与 `:343` |
| C1-13 | `invalidate` | 写后作废该工作区快照缓存 | `src/host/refresh/wiring.js:344` |
| C1-14 | `onTicketCreated` | 建票直达命名守护 | `src/host/refresh/wiring.js:345` |
| C1-15 | `chainNote` | 记处理链，与上报共用同一份 | `src/host/refresh/wiring.js:345` |
| C1-16 | `hourUsage` | 问账本本小时用量 | `src/host/refresh/wiring.js:346` |
| C1-17 | `ensureReading` | 动手前保剩余额度读数 | `src/host/refresh/wiring.js:347` |
| C1-18 | `noteGate` | 记闸口径迹供探针读 | `src/host/refresh/wiring.js:348` |
| C1-19 | `log` | 日志上下文原样透传 | `src/host/refresh/wiring.js:349` |
| C1-20 | `workspaceKeyOf` | 与活跃集合同一把短散列，不许换 | `src/host/refresh/wiring.js:354` |
| C1-21 | `now` | `Date.now` | `src/host/refresh/wiring.js:355` |
| C1-22 | `planStore` 未注入，批量建图中间态退回进程内存，工具回包如实说不可持久 | 缺席即老路 | `src/host/refresh/wiring.js:301-305` 注释 |
| C1-23 | `decideBackend` | 装配层递入的判定出口，壳要求必须存在，缺席回三态不抛 | `src/host/platform/deckToolsAssembly.js:116` 递入，`src/shared/deck-tools/shell.js:176-180` 消费 |
| C1-24 | `readDeclarationId` | 缺席时由装配层现拼后递入，壳经判定参数透传 | `src/host/platform/deckToolsAssembly.js:91-115` 现拼，`src/shared/deck-tools/shell.js:188-192` 透传 |
| C1-25 | `resolveTimeoutMs` | 接受但未接线：壳文档与消费俱在，接线从未传入，接口设计时定去留 | `src/shared/deck-tools/shell.js:81` 文档，`:218` 消费，接线零引用 |

### C2：装配层自带的三个（3 个调用点）

| # | 内容 | 证据 |
|---|------|------|
| C2-1 | 九个工厂 `DECK_TOOL_FACTORIES` 与九个文件 `DECK_TOOL_FILES`，顺序与 `DECK_TOOL_ORDER` 一致 | `src/host/platform/deckToolsAssembly.js:37-60` |
| C2-2 | `readDeclarationId` 缺席时由装配层现拼；`protectDoubleHit` 已退役，传了也忽略，壳全文零引用，装配层 `:116` 的传递是旧兼容残留，新接口应删不继承 | `src/host/platform/deckToolsAssembly.js:78-116`，退役证据见 `tests/verify-957-workspace-writer.js:163-165` |
| C2-3 | `hookDeckAgentTools(ctx, deckToolsForHost, loadDefineTool恒空, makeDeckRegisterReport(logCtx))` 在启动时注册，`decideBackend` 由装配层递进九个工具共用 | `src/host/refresh/wiring.js:309`，`src/host/platform/deckToolsAssembly.js:24-26` 与 `:116` |

## 表 D：两房对外导出的名字（33 个调用点）

### D1：GitHub 房入口（18 个）

| # | 名字 | 说明 | 证据 |
|---|------|------|------|
| D1-1 | `describe`、`issueUrl`、`searchUrl`、`linkPattern`、`links`、`capabilities`、`checks`、`githubMatches`、`createGithubBackend` | 只读视图与装配入口，直接转发子文件 | `src/host/tracker/backends/github/index.js:22` |
| D1-2 | `parseGithubRepo`、`getRepoKey`、`openRepository` | 仓库身份三件，转发出自 `repo.js` | `src/host/tracker/backends/github/index.js:23` |
| D1-3 | `GITHUB_CHECKS` | 检查目录 | `src/host/tracker/backends/github/index.js:24` |
| D1-4 | `initProject` | 建仓流程 | `src/host/tracker/backends/github/index.js:25` |
| D1-5 | `fixes`、`prompts` | 修复知识与注入文案数据 | `src/host/tracker/backends/github/index.js:36` 与 `:121` |
| D1-6 | `githubModule`（`{id, label, presentation, setupPrompt, create, matches, describe, issueUrl, searchUrl, linkPattern, links, capabilities, openRepository, prompts, checks, fixes}`）供注册表注册 | 模块对象 | `src/host/tracker/backends/github/index.js:192-226` |

### D2：GitHub 房 Tracker 操作面（实现 `createGithubBackend` 的返回，24 个）

`preflight`、`list`、`counts`、`listPage`、`listSubIssues`（契约外扩展）、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、`update`、`setLabels`、`listLabels`、`setLabelColors`、`setAssignees`、`setParent`、`setBlockedBy`、`getCurrentUser`、`initProject`、`describe`、`issueUrl`、`getRepoKey`、`getRepoPermissions`（只读旁路），证据见 `src/host/tracker/backends/github/backend.js:70-129`。其中 `listSubIssues` 与 `getRepoPermissions` 不在契约操作清单里，其余对齐契约。

### D3：Markdown 房（入口 12 个，操作面与 GitHub 基本同形）

入口：`matches`、`describe`、`issueUrl`、`searchUrl`、`linkPattern`、`createMarkdownBackend`、`defaultLabelPalette`、`prompts`、`fixes`、`markdownModule`（`{id, label, presentation, describe, issueUrl, searchUrl, linkPattern, setupPrompt, labelPalette, create, matches, links, openRepository:'folder', prompts, fixes}`；`presentation` 是品牌色板四值，见 `:230-235`）、默认导出，证据见 `src/host/tracker/backends/markdown/index.js:17`、`:59`、`:69`、`:85-87`、`:160`、`:179`、`:209`、`:222-253`。操作面：`preflight`、`list`、`counts`、`listPage`、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、`update`、`setLabels`、`setAssignees`、`setParent`、`setBlockedBy`、`listLabels`、`setLabelColors`、`ensureLabelColorsFile`（本房独有）、`getCurrentUser`（桩）、`initProject`（桩）、`normalize`、`parse`，证据见 `src/host/tracker/backends/markdown/index.js:87-154`。

## 表 E：校验条目与契约已有类型名（29 个调用点）

### E1：`validateMod` 只验五项（5 个）

模块是对象、`id` 非空字符串、`label` 是字符串、`create` 是函数、`matches` 是函数，`id:'other'` 拒绝注册。操作面缺方法由 `wrapTracker` 的代理自动补 `unsupported` 桩，不在校验里。证据见 `src/host/tracker/registryShape.js:96-105` 与 `:76-93`，桩形状见 `:62-69`。

### E2：契约操作清单 `OPERATIONS`（19 个名字，顺序照文件）

`preflight`、`list`、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、`update`、`setLabels`、`setAssignees`、`setParent`、`setBlockedBy`、`getCurrentUser`、`initProject`、`listLabels`、`setLabelColors`、`counts`、`listPage`，证据见 `src/host/tracker/contract.js:56-74`（亲手数过数组项，共 19 项）。注意清单里 `listSubIssues`、`getRepoPermissions`、`ensureLabelColorsFile`、`normalize`、`parse` 均不在内，它们是各房自带的能力或旁路。

### E3：契约已有类型名（23 个，照文件顺序）

`Tracker`、`OpName`、`TrackerError`、`OpResult`、`BackendContext`、`OpContext`、`RepoHandle`、`BackendModule`、`Selection`、`RepositoryRef`（转引共享形状）、`Issue`（转引）、`PreflightResult`、`ListFilter`、`GetOpts`、`DepsOpts`、`Dependencies`、`CreateInput`、`CloseOpts`、`UpdatePatch`、`SetOpts`、`LabelInput`、`AssigneeInput`、`Counts`，外加共享形状里的 `BackendId`、`IssueType`、`RepositoryRef`、`Issue`、`IssueRef`、`Actor`、`ClosedReason`、`Milestone`、`CustomField`、`ActorKind`、`ERROR_KIND`、`STATE`、`ISSUE_TYPE`、`CONTRACT_VERSION`（转引，未逐个核对原文，标未核实）。证据见 `src/host/tracker/contract.js:29-242`。

## 未核实清单

1. `sent` 结果的 `remaining` 与 `tier` 字段的完整语义未核实，只见于信封透出用法（`src/shared/deck-tools/shell.js:324-327`）。
2. `estimate` 返回的 `withinCallCap`、`shards`、`perShard`、`text` 的完整语义未核实，只见于估算与信封用法（`src/shared/deck-tools/shell.js:324-325`）。
3. `decideBackend` 出口的四层优先级细节未核实，只核实了壳传入的依赖键（`src/shared/deck-tools/shell.js:188-192`），判定本体见 `src/host/tracker/detection/backendDecision.js:179` 未通读。
4. 共享形状文件里转引类型名的原文未逐个核对，标未核实。
5. GitHub 房 `getRepoPermissions` 返回的完整形状未核实，只见于 `deck_context` 的用法（`src/host/tools/deckContext.js:102-105` 按 `{push, triage}` 布尔读取）。
