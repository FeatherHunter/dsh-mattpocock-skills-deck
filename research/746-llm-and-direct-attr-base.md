# 746 全文版摘要落地前的底座确认（只读研究）

> 工作区：`D:\dsh-plugin\dsh-mattpocock-skills-deck`
> 底座：`D:\DSH NEXT\resources\app\node_modules\@deepseek-ai`（0.1.7-rc.2 系）
> 方法：只读查底座与本仓文件，不改代码、不改票、不提交。
> 下面“底座”指 DSH 官方包，“本仓”指这个插件仓库。

## 结论先行一张表

| 事项 | 入口 | 证据行号 | 可用性 |
| --- | --- | --- | --- |
| 1. 宿主插件上下文里调大模型 | 服务键名 `llm`，方法 `stream(options)`；备用还有 `prepareCall` / `resolveCallConfig` | 底座 `dsh-llm/lib/typert.host.js:117`（键名 `llm`）、`:220-221`（`stream` 签名）、`:213-214`（`prepareCall`）、`:206-207`（`resolveCallConfig`）；参数形状同文件 `:312-313`（`GenerateOptions`）、`:340`（`LlmCallConfig`）；失败形状同文件 `:356-357`（`LlmFailure`）、`:504-505`（`StreamChunk` 的 `finish`）；宿主沙箱门在 `dsh-cordis-host-runner/lib/index.js:629`（`sandboxContext`）、`:621`（`declaredInjects`）、`:601`（`guardedService`）、`:592`（`denyContext`）；本仓当前声明在 `src/host/index.js:12`（只有 `connection`） | 机制可用，但本仓现在没声明：想直调要在插件 `inject` 里加 `llm`，再经 `ctx.get('llm').stream(...)` 或 `ctx.llm.stream(...)` 调用；要过沙箱的“声明了才能用”检查，否则按未注入拒绝。备选是“经会话内 AI 顺带总结”（把原文回给会话 AI 让它总结），代价见第 1.4 节 |
| 2. 读首轮两段（某会话完整原始事件） | 会话查询服务键名 `sessionQuery`，方法 `readSession(sessionId)` / `listEvents(sessionId)` / `readSurface(sessionId)`；首轮两段的事件名是 `user/message` 与 `assistant/message` | 服务键名在底座 `dsh-session-query/lib/index.js:1046`（`super(ctx, "sessionQuery")`）、`:1041`（`static inject = ["sessions"]`）；完整读在同文件 `:1074-1076`（`readSession` 文档“不变成活跃会话”）、`:1079`（方法名）；事件名单在底座 `dsh-session/lib/types/known-event-types.js:78`（`user/message`）、`:28`（`assistant/message`）、`:27`（`assistant/attempt`，注意区分）；分页截断在 `dsh-session-query/lib/index.js:9`（上限 50）、`:1047-1048`（`readWindowMax` 默认 50）、`:1233-1236`（`_readWindow` 越界抛错）；是否激活见 `:126-151`（`_corpus.load` 只做深拷贝）与 `:348-393`（`_observations.read` 会保留一次冷准备） | 可用：要“完整原始事件且不激活”就用 `readSession` / `listEvents` / `readSurface`（走 `_corpus.load`）；不要用 `observeSession`（即 `_observations.read`），它会留一次冷准备直到释放。`readEvent` 的前后窗口各最多 50，缺省都是 0 |
| 3. deck 工具成功直达编号归属 | 本仓两处成功返回里票号与标题都在手；写事件映射已认得 deck 工具名；编号归属纯函数可直调 | 本仓 `src/host/tools/deckIssueCreate.js:83`（`created.data` 取票）、`:90`（`key: issue.key`）、`:96`（`data: { ticket: issue, ... }`）、`:99`（`touched`）；本仓 `src/host/tools/deckMapPlanCreate.js:119`（`state.mapKey = created.data.key`）、`:143`（`state.keys[...] = created.data.key`）、`:196-198`（`data: { mapKey, builtKeys, ... }`）、`:205`（`touched`）；写事件映射在 `src/host/refresh/writeEvents.js:36`（`SESSION_RESULT_SHAPES`）、`:162-163`（`ACTION_BY_TOOL` 把 deck 工具名映射到动作）、`:191` / `:198`（成功判定）；归属真源在 `src/shared/naming-attribution.js:42`（`newNumbersSince`）、`:55`（`isNumberAwaitStage`）、`:102`（`attributeNewNumbers` 返回 `[{ sessionId, number, title }]`）；落点在 `src/host/namingGuardian.js:170`（`reduceTrackingState(entry, { type: 'numbered', number, title })`）；票字段基线在 `src/host/tracker/capability.js:34`（`key`、`title` 为核心字段） | 可行：在成功回调里拿 `issue.key`（或 `mapKey` / `state.keys` 的值）与传入的 `title`，直接推进编号归属，不必等下一轮快照掃描。但要守三条已有规则（候选须处等待编号状态、语义相关才配、有号会话不重复出单），否则会与周期掃描打架。细节见第 3.3 节 |

## 1. 宿主插件上下文里调大模型的入口

### 1.1 服务总表里有什么

底座 `dsh-llm` 的类型总表在：

- `D:\DSH NEXT\resources\app\node_modules\@deepseek-ai\dsh-llm\lib\typert.host.js`

关键行：

- `:117` 写着 `"key": "llm"`。这是服务键名。宿主插件上下文里就是用这个名字取服务。
- `:220-221` 写着 `"name": "stream"`，签名是 `stream(options: GenerateOptions): AsyncIterable<StreamChunk>`。这是调大模型的主入口：一次调用，按数据块逐步返回。
- `:213-214` 是 `prepareCall(config, signal)`，返回 `PreparedLlmCall`。作用是把一次调用的配置先固定下来，防止中途换适配器。
- `:206-207` 是 `resolveCallConfig(config, signal)`，只校验配置、不发送。
- `:312-313` 是 `GenerateOptions` 的形状（见 1.2 节）。
- `:340` 是 `LlmCallConfig` 的形状（提供方与模型加可选控制）。
- `:356-357` 是 `LlmFailure` 的形状（见 1.3 节）。
- `:504-505` 是 `StreamChunk` 的形状，其中 `finish` 块带最终成功或失败的原因。
- `:607-609` 是 `llm/stream` 事件，签名是 `'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>)`。这是环绕每次调用的瀑布事件，别人可以监听或短路。

底座 `dsh-cordis-host-runner` 决定宿主插件能碰到什么：

- `D:\DSH NEXT\resources\app\node_modules\@deepseek-ai\dsh-cordis-host-runner\lib\index.js`
- `:550` 起是 `CTX_VERBS`（`effect`、`on`、`once`、`provide` 与定时器 helper）。这是沙箱上下文白名单里的动词。
- `:562` 起是 `TIMER_VERBS`。定时器 helper 须先声明 `timer` 才能用。
- `:592` 是 `denyContext`。服务返回里若夹带整个上下文对象，直接拒绝，不让沙箱拿到逃逸句柄。
- `:601` 是 `guardedService`。注入服务的每个方法都经它转发，返回值再过一次 `denyContext`。
- `:621` 是 `declaredInjects`。它读插件声明的 `inject`，决定插件能看哪些服务。
- `:629` 起是 `sandboxContext`。`:631` 读已声明表，`:633` 起的 `denyRead` 写明：没声明的服务即使存在也拒绝，并提示去 `inject` 里声明；`:636-641` 是 `readService`，`ctx.get(name)` 与 `ctx.<name>` 都走这里。

结论是：底座机制上允许宿主插件调大模型，条件是插件在 `inject` 里声明 `llm`，然后用 `ctx.get('llm')` 或 `ctx.llm` 拿到 `LlmRuntime` 再调 `stream`。

### 1.2 参数形状

`GenerateOptions`（`dsh-llm/lib/typert.host.js:312-313`）按声明是：

```ts
export interface GenerateOptions {
  provider: string;
  model: string;
  reasoningEffort?: ReasoningEffortId;
  messages: RequestMessage[];
  system?: string;
  tools?: ToolSchema[];
  toolHistory?: ToolHistory;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  signal?: AbortSignal;
  sessionId?: Branded<'SessionId'>;
  purpose?: 'compaction' | 'session-title';
}
```

`RequestMessage` 可以是完整消息（含编号与来源），也可以是只有 `role: 'user'` 与 `content` 的手写输入（见同文件 `RequestUserInput` 声明）。手写调用不带循环标记，调用者要保证在流结束前不改输入对象。

一个已存在的正确调用范例是会话标题包：

- `D:\DSH NEXT\resources\app\node_modules\@deepseek-ai\dsh-session-title-llm\lib\index.js:213` 把 `purpose` 写成 `"session-title"`。
- 同文件 `:202` 把来源写成 `{ kind: "dsh-session-title-llm" }`。
- 同文件 `:226` 起是 `for await (const chunk of ctx.llm.stream(options))`，并用 `BlockAssembler` 拼块。
- 同文件 `:192-195` 先算输入字节数，超 `maxInputBytes` 直接抛错，不发送。

### 1.3 失败形状

失败分两层，不要只看一层：

1. 流内终结块。`dsh-llm/lib/index.js:2376-2388` 的 `adapterFailureChunk` 把适配器选择、发送、迭代三处的抛错统一变成一个终结块：`{ type: 'finish', reason: { kind: 'error' | 'aborted', failure } }`。`aborted` 是调用者取消或失败码为 `ABORTED` 时的分支。
2. `failure` 本体是 `LlmFailure`（`dsh-llm/lib/typert.host.js:356-357`）：`{ message: string; code: string; status?: number; providerRetryAfterMs?: number; requestId?: ProviderRequestId; offloadImages?: number }`。归一化在 `dsh-llm/lib/index.js:402` 起的 `normalizeLlmFailure`：非 `Error` 的抛值先包成错，再取消息与码并冻结。
3. 抛错类是 `LlmError`（`dsh-llm/lib/index.js:1615` 起，继承自 `HarnessError`）。注册、发现、配置校验一类问题走抛错，不走流内终结块。

所以宿主直调要同时处理“流里最后一个 `finish` 是 `error`/`aborted`”与“`await` 直接抛 `LlmError`”两种失败。

### 1.4 本仓现状与备选

本仓宿主入口在 `src/host/index.js:12`，现在只写了 `inject: ['connection']`。注释里还记着不能再加 `webServer` 的实测结论。全仓搜 `ctx.get('llm')` 没有命中（搜过 `src/host/**/*.js` 的 `ctx.get(`，命中的只有 `skills`、`logger`、`fs`、`subprocess`、`timer`、`sessions`、`platform` 等，没有 `llm`）。也就是说：直调大模型的底座入口存在，但本仓现在没接。

备选（经会话内 AI 顺带总结）是可行的：

- 把全文版摘要需要的那两段原文（用户第一段与助手第一段，见第 2 节）与票号标题一起放进工具返回值，让当前会话的 AI 按固定格式总结。已有范例是 `dsh-session-title-first-prompt-llm` 包：`lib/index.js:27-30` 只取 `messages[0]` 做标题输入；`lib/index.js:6-8` 的 `inject` 是 `["sessionTitle", "llm", "sessions"]`，说明“标题这类小总结”在底座设计里就是复用会话已选模型顺带做的。
- 代价有三笔：多一次会话往返（工具返回变大，会话 AI 再读再写）；质量随当前会话模型走，不稳定；失败时难区分是“原文没读到”还是“总结没写好”。直调 `llm.stream` 则要自己选 `provider`/`model`、自己处理 `maxInputBytes` 与超时（可抄 `dsh-session-title-llm` 的 `timeoutMs` 与字节上限做法），但结果稳定、可重试、可记账。

## 2. 读首轮两段的入口

### 2.1 服务与方法名

会话查询服务的键名与注入在：

- `D:\DSH NEXT\resources\app\node_modules\@deepseek-ai\dsh-session-query\lib\index.js:1046`（`super(ctx, "sessionQuery")`）
- 同文件 `:1041`（`static inject = ["sessions"]`）

读某会话完整原始事件用这三个中的一个（都走“逻辑语料库读”，不是“观察并保留准备”）：

- `:1079` 的 `async readSession(sessionId)`。文档在 `:1074-1076`：“读并重放校验一整份逻辑会话日志，不把它变成活跃会话”，返回“克隆后的头与完整原始事件”。
- `:1141` 起的 `async listEvents(sessionId)`。文档是“列出一个逻辑会话的轻量原始日志事件记录”，按 `seq` 升序。
- `:1166` 起的 `async readSurface(sessionId)`。文档是“读一个会话当前模型可见面”，返回克隆头、当前面事件与 `capturedThroughSeq`。

不要用 `:348` 起的 `_observations.read`（对外叫 `observeSession`）。它的文档是“观察一个活跃优先的会话，并保留一次冷准备直到释放”。实现里 `:366-378` 会在持久化命中但内存没有时调 `this.ctx.sessions.prepare(...)`，并在 `:393` 经 `preparedLease` 留下来。这不是全量激活（不是 `attach` 到存储），但它会在会话存储里留一份准备好的会话直到释放。只想“读而不碰活跃态”时，用上一段三个方法。

### 2.2 首轮两段的事件名

事件词表在：

- `D:\DSH NEXT\resources\app\node_modules\@deepseek-ai\dsh-session\lib\types\known-event-types.js`

其中：

- `:78` 是 `'user/message'`。这是用户第一段要找的事件名。
- `:28` 是 `'assistant/message'`。这是助手第一段要找的事件名。
- `:27` 是 `'assistant/attempt'`。这是助手尝试（含推理与工具调用过程），不是最终可见的第一段正文，不要拿它当第一段。

取首轮两段的做法是：按 `seq` 升序扫 `readSession` 回来的 `events`，第一个 `type === 'user/message'` 的 `data` 即用户第一段，第一个 `type === 'assistant/message'` 的 `data` 即助手第一段。若会话被压缩或含分支，会出现 `compaction/*` 与 `session/end-seed` 一类事件，扫时按 `seq` 顺序取“第一次出现”即可，不要按数组下标硬取第 0、1 个。

### 2.3 分页或截断语义

- `readSession` / `listEvents` / `readSurface` 都是“完整”语义，没有分页参数。`readSession` 的注释写的是完整日志（`:1076`），`listEvents` 写的是按升序全量（`:1141-1145`），`_corpus.load`（`:126-151`）是把头与事件逐个深拷贝后返回，没有截断。
- 只有 `readEvent`（`:1208` 起）是窗口语义：`request.before` 与 `request.after` 各自是前后多带几条，缺省都是 0（`:1209-1210`），上限由 `readWindowMax` 卡。上限常量在 `:9`（`SESSION_QUERY_READ_WINDOW_MAX = 50`），实例默认值在 `:1047`（`config.readWindowMax ?? 50`），越界检查在 `:1233-1236`（非整数、小于 0、大于上限都抛 `SESSION_QUERY_INVALID_WINDOW`）。
- 所以“读首轮两段”不会被截断；只有“读某一条的前后上下文”会被 50 条上限卡。

### 2.4 读操作是否会激活会话

- `readSession` / `listEvents` / `readSurface` / `filterEvents` 走 `_corpus.load`（`:126-151`）：先看内存有没有（`this._ctx.sessions.get`），有就快照内存，没有就读持久化并做头兼容检查，全程只做 `structuredClone`，不调 `prepare`，不 `attach`。文档 `:1074-1076` 的“不把它变成活跃会话”就是这个意思。
- `observeSession`（即 `_observations.read`，`:348-393`）会调 `prepare` 并保留，其他读不会。
- 结论：摘要场景用 `readSession(sessionId)` 或 `listEvents(sessionId)`，读完不激活；读完是否要释放也不用管，因为没留准备态。

## 3. deck 工具成功直达归属的接线点

### 3.1 成功返回形状（含号与标题的字段名）

建单票工具在 `src/host/tools/deckIssueCreate.js`：

- `:83` 把契约层回来的票拿出来：`const issue = created.data || {}`。票号与标题都在这个对象上。
- `:87` 写后读回判父子落点：`c.tracker.get(repo, issue.key, ...)`。说明票号字段名是 `key`（字符串票号）。
- `:90` 把边事项推进 `items`：`{ key: issue.key, edge: { op: 'parent', target: rel }, ... }`。
- `:94-96` 是成功值：`status: DECK_STATUS.OK`，`data: { ticket: issue, kind, idempotencyKey, limits }`。所以“号”是 `data.ticket.key`（与 `issue.key` 同一个值），“标题”是调用时传入的 `title`（回显在 `text` 里，不另存字段；要原文就用入参 `title`）。
- `:99` 是 `touched: issue.key ? [String(issue.key)] : []`。写后失效缓存就靠这一格。

建整图工具在 `src/host/tools/deckMapPlanCreate.js`：

- `:98-99` 是续跑态：`{ planId, mapKey, keys, edges, done }`。`mapKey` 是地图票号，`keys` 是计划短标识到真实票号的映射。
- `:119` 是地图票建成：`state.mapKey = String((created.data && created.data.key) || '')`。字段名同样是 `key`。
- `:122` / `:125` 把地图票推进 `items`：`{ key: state.mapKey, role: 'map', title, ... }`。
- `:129-130` 算本片待建与已跳过：`pending` 与 `skippedKeys`。
- `:139-145` 是子票建成：同样 `created.data.key`，记入 `state.keys[计划短标识]`，并推 `{ key, role: 'child', planKey, title, status: 'ok' }`。
- `:154` 是边端点解析：`@map` 指 `state.mapKey`，否则查 `state.keys`。
- `:177` 是逐项校验：`c.tracker.list(repo, { parentKey: state.mapKey }, ...)`。
- `:196-198` 是成功 `data`：`{ planId, mapKey, builtKeys: Object.values(state.keys), skippedKeys, restKeys, edges, counts, shards, nextCall }`。
- `:205` 是 `touched: [state.mapKey].concat(Object.values(state.keys))`。

票对象的字段基线在 `src/host/tracker/capability.js:34`：`key`、`title` 等是核心字段（永远存在）。所以直调归属时“号”取 `key`（字符串），“标题”取入参 `title` 或 `currIndex` 里的 `title`，不要用 `number`（本仓已删 `number` 遍历，见同文件注释）。

### 3.2 写事件映射现在认得什么

`src/host/refresh/writeEvents.js`：

- `:36` 的 `SESSION_RESULT_SHAPES = ['tool/result', 'tool/ptc-dispatch', 'tool/code-dispatch']`。只认结果形态，`tool/call` 与 `*-start` 不进表。
- `:162-163` 的 `ACTION_BY_TOOL` 已把本仓工具名映射到动作：`deck_issue_create → create`、`deck_issue_patch → edit`、`deck_map_plan_create → create`、`deck_map_link → link`。`:169` / `:172` 的 `actionOf` 先查表，查不到才从 `gh`/`glab` 命令行里取第二个词。
- `:191` 的 `succeededFromRuntime` 只认成功（`isError === false`，或结构化 `exitCode === 0`）。
- `:198` 的 `succeededFromSession` 认 `[exit code: N]`、`isError`、`error`，认不出按没成功处理（注释写明往保守一侧倒）。
- `:296` 的 `onToolResult` 与 `:308-310` 的 `onSessionEvent` 共用 `handle`，`:321` 的 `attach` 在会话事件上先过工作区白名单再看事件名。

也就是说，deck 写工具成功一次，现有写事件链已经能认出动作并触发取数与会话票据（`note`）。直调编号归属是同步替代，不是重复建设：一个在成功回调里立刻落号，一个在事件里异步收敛。

### 3.3 在成功回调里直调编号归属是否可行

可行，但要按编号归属已有的三条规则来，不要自己编一套。

编号归属真源在 `src/shared/naming-attribution.js`：

- `:42` 的 `newNumbersSince(prevIndex, currIndex)` 算新增编号（升序，`prev` 为空视为基线、无新增）。
- `:55` 的 `isNumberAwaitStage(state)` 判定等待编号状态：没锁、还没号、仍处占位或草稿档。
- `:102` 的 `attributeNewNumbers({ prevIndex, currIndex, sessions })` 做归属：候选按 `createdAt → updatedAt → sessionId` 排序（`:137-143`），逐个配号；有标题时要求语义相关（`:150-160` 起的 `isHintRelatedToTitle` 分支），无标题取最早候选；返回 `[{ sessionId, number, title }]`（`:167` 起的 `out.push`）。

宿主落点在 `src/host/namingGuardian.js:170`：`core.reduceTrackingState(entry, { type: 'numbered', number, title })`。周期掃描现在就是调这一句把号落到跟踪态。

在 `deckIssueCreate` / `deckMapPlanCreate` 的成功回调里直调，做法是：

1. 号从 `issue.key`（或 `state.mapKey` / `state.keys` 的值）解析：`Number(key)`，注意 `key` 是字符串票号。
2. 标题用本次传入的 `title`（建单票就是入参 `title`；建整图就是地图 `title` 或子票 `title`，看这次为哪个会话配号）。
3. 调 `attributeNewNumbers`（或等价的单次判定）算出这次该归属的会话，再对命中会话调 `reduceTrackingState` 写 `numbered` 事件。已有会话表与索引快照从命名守护现成状态里取，不要另起快照。

三条必须守的规则（都是现成代码，不是新要求）：

- 候选须处等待编号状态（`isNumberAwaitStage`）。已锁、已有号、已到编号或精修档的不配。
- 有标题时须语义相关（`isHintRelatedToTitle`，`:77-100` 的高精度规则）。无关新号不硬配，否则会错配（`namingGuardian.js` 里还有 `keepRelatedAssigned` 再拦一道）。
- 同一号不重复出单（`reduceTrackingState` 里 `numberedDone` 与目标名收敛逻辑，见 `src/shared/naming-tracking.js:119-122` 与 `:214-222` 的计划单收敛）。直调后要走同一套持久化（`persistNamingState`），否则下一轮掃描会再配一次。

一句话：成功回调里号与标题都在手，直调技术上可行；可行不等于绕开判定，直调必须复用 `attributeNewNumbers` 与 `reduceTrackingState` 这两段真源，否则会与周期掃描打架。

## 4. 给 746 的落地建议（只读结论，不改代码）

1. 全文版摘要的两段原文优先用 `sessionQuery.readSession(sessionId)` 取（不激活），按 `seq` 取首个 `user/message` 与首个 `assistant/message`。`assistant/attempt` 不当第一段。
2. 摘要模型能直调就直调 `llm.stream`（先在插件 `inject` 里加 `llm`），`purpose` 建议照抄会话标题包的做法，按场景取名；输入先算字节、设超时（抄 `dsh-session-title-llm` 的 `maxInputBytes` 与 `timeoutMs`）。不能直调就先走备选（返回值给会话 AI 总结），把“直调”记成后续票。
3. 建票成功后直达编号归属可以做，但实现时必须复用 `attributeNewNumbers` 与 `reduceTrackingState`，并复用命名守护的持久化，不要在工具文件里另写一套归属。

## 5. 跑了什么和为什么（只用只读命令）

只用 `pwsh` 读文件与搜字符串，没有写盘（写盘只有本产物一处，经写盘工具一次性落盘）。

1. 列工作区与底座目录（`Get-ChildItem`）：先确认工作区根与底座包名，锁定 `dsh-cordis-host-runner`、`dsh-llm`、`dsh-session-query` 等包的位置。
2. 读包清单（`Get-Content package.json`）：确认每个包的主入口与类型表位置，避免读错生成物。
3. 搜服务键名与方法签名（`Select-String` 搜 `llm/`、`stream`、`prepareCall`、`sessionQuery`、`readSession` 等）：定位第 1、2 事项的入口与行号。
4. 按行读关键段（`Get-Content | Select-Object -Index`）：抄 `GenerateOptions`、`LlmFailure`、`StreamChunk`、`sandboxContext`、`_corpus.load`、`_observations.read`、`_readWindow`、`ACTION_BY_TOOL`、`attributeNewNumbers` 等原文，防止转述走样。
5. 本仓搜 `inject` 与 `ctx.get(`（`Select-String src/host/**/*.js`）：确认本仓现在没声明 `llm`，以及写事件已认得 deck 工具名。
6. 读本仓三份实现（`Get-Content deckIssueCreate.js / deckMapPlanCreate.js / writeEvents.js` 全文）：确认成功返回里 `key` 与 `title` 的字段名与 `touched`，以及直调是否可行。
7. 列 `research/`（`Get-ChildItem research`）：确认产物文件名不与现有文件撞名（`746-llm-and-direct-attr-base.md` 当前不存在，是新建）。
