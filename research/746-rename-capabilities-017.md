# #746 落地输入：0.1.7 系会话重命名到底哪些调用能用（只读盘点）

> 地图 #743 · 子票 #746「落地：按挑单优化命名规则与机制并恢复新版改名」的前置只读研究。
> 不改代码、不改票、不提交。结论只对下面列出的一手来源负责。
> 新版底座实测位置：`D:\DSH NEXT\resources\app\node_modules\@deepseek-ai`，各包 `package.json` 实测为 `0.1.7-rc.2`
> （票面写 `0.1.7-rc.1 系`；本文件所有行号按实测 `rc.2` 打包代码负责，`rc.1` 需按同样方法重对一遍）。
> 本仓库侧来源：`src/host/namingGuardian.js`（350 行）、`src/client/kernel/api-naming.js`（340 行）。
> 日志字段口径遵守 `research/489-appendix.md`（本文件只记路径与行号，不记令牌、登录态、路径原文、标题原文）。

## 0 结论先行：调用 × 可用性 × 证据行号

底座根统一简写为 `BASE = D:\DSH NEXT\resources\app\node_modules\@deepseek-ai`。
`client.js = BASE/dsh-api-session-controller/lib/client.js`，`index.js = BASE/dsh-api-session-controller/lib/index.js`。

| # | 插件当前调用（仓库位置） | 0.1.7 底座上是否仍可调用 | 证据行号（一手） | 不能用的替代键 |
|---|---|---|---|---|
| C1 | `sessions.create(opts)` 建会话（`src/client/kernel/api-naming.js:101-103`，经 `createPTCSession:96-140`、`buildCreateOpts:89-95` 组装 `{workspaceId,cwd}+agentPreset:'ptc'`） | **能，但显式 `agentPreset:'ptc'` 被静默丢弃**：调用本身存在且 `workspaceId/cwd` 语义不变，但客户端 `Manager.create` 组装 `payload` 时根本不转发 `agentPreset`（全文件零命中 `agentPreset`），所以三种别名重试（`presetId`/`agentPresetId`/`preset`，见 `api-naming.js:121-136`）在 0.1.7 上全部打空 | 能调：`client.js:3324-3329`（`ClientSessions.create`）→ `client.js:2678-2687`（`Manager.create` 的 `payload` 只含 `workspaceId/cwd/sessionId`）；线 schema 仍认 `agentPreset`：`lib/typert.host.js:161-167`；宿主仍读 `request.agentPreset`：`index.js:697` | 去掉“显式 ptc 即生效”的假设：新建后一律经快照读实际预设（`projectionValues.agentPreset`，见 C3），再走隔离/重建；不要再加第四个别名键 |
| C2 | `sessions.get(sid)` 读 `.title` 做“当前标题”（`src/client/kernel/api-naming.js:155-157`：`sessions.get(sid)` 取 `s.title`） | **不能**：`Session` 对象根本没有 `title` 属性，`get()` 永远拿不到标题，该分支恒落空（设计上是死分支，回退分支才是真源） | `Session.buildSnapshot` 字段清单无 `title`：`client.js:2273-2297`；`Manager.get` 只做懒实例化与 `blank/running` 对齐：`client.js:2460-2478`；`title` 只活在投影 `title` 键与列表行：`client.js:2941-2949`、`3495-3575` | 换键：`sessions.list.getSnapshot().byId[sid].title`（`api-naming.js:161-163` 现有回退即正确）；或 `manager.projectionValues(sid).title`（`client.js:2798-2800`）；或投影面 `faceOf('title').getSnapshot()`（`client.js:942-962`） |
| C3 | `sessions.list.getSnapshot()` 读 `byId[sid]`（标题/存在性/失败面板过滤，`api-naming.js:161-163,265-268,301-305`；`getRowPreset:46-55` 读 `projectionValues.agentPreset`/`header.agentPreset`） | **能**：这是 0.1.7 读标题、判存在、读预设的唯一真源；行上有 `title/cwd/blank`，`agentPreset` 在 `projectionValues`（`header` 侧见下） | 组装：`Manager.buildListSnapshot:client.js:2938-2972`（`title` 取自 `projectionStores.get(id).get('title')`，见 `:2941`；`projectionValues` 整包挂行，见 `:2949`）→ `ClientSessions.projectList:client.js:3496-3575`（`byId[id] = {id,displayTitle,running,retainedBy,blank,updatedAt,projectionValues?,title?,cwd?,parentId?,origin?}`，见 `:3503-3515`）；存储底：`dsh-client-store/lib/index.js:70-91`（`createSnapshotStore`） | 无需换键；注意 `title` 缺席即“未知”而非空标题（`:2948` 只在非空字符串才挂 `title`），`displayTitle` 是展示回退（`:3505`），值比对锁必须用 `title` 而不用 `displayTitle` |
| C4 | `sessions.scope(sid)` 借已保留的 Agent 上下文（`api-naming.js:206`，前置检查 `api-naming.js:205`） | **能**：语义不变；未保留返回 `undefined`，不抛错 | `client.js:3363-3365`（`return this.scopes.get(id)?.ctx`）；配套保留语义 `retainScope:3409-3437`、`materializeScope:3472-3494` | 无需换键；调用前必须确认 `scope` 非空（插件 `:207` 已做），空即本轮跳过绝不盲写 |
| C5 | `sessions.sessionOf(scope)` 取业务 `Session`（`api-naming.js:207`） | **能**：语义不变；非本代 `ctx`（含跨 `bundle` 的私 `tag Symbol` 副本直引）或已结束代返回 `undefined`，不抛错 | `client.js:3395-3400`（经 `scopeOf(ctx)` 取 id，再校验 `scopeIdentityOf(record.ctx) === scopeIdentityOf(ctx)`）；`scopeOf` 服务方法边界注释见 `:3376-3385` | 无需换键；禁止跨包直引独立 `scopeOf` 实现（注释 `:3377-3380` 明示会内联第二个模块实例导致 `Symbol` 永不匹配） |
| C6 | `face.rename(target)` 执行改名（`api-naming.js:208,225-229`，含面标识校验 `:210-216` 与改名前二次值比对 `:218-224`） | **能**：`Session.rename(title)` 与 `Manager.rename(sessionId,title)` 双入口都在，语义都是 `remote.session.rename 1:1` + 高 `seq` 胜出结算投影 | `Session.rename:client.js:1817-1840`（`remote.session.rename({sessionId,title})`，成功 `projections.apply('title',title,seq)`，失败原样返回 `result` 不抛）；`Manager.rename:client.js:2751-2758`（同线，写 `projectionStore(sessionId)`）；线形：`typert.host.js:687-695`（入参 `{sessionId,title}`，回参 `{title,seq}`）；宿主实现：`index.js:754-768` | 无需换键；失败语义与 `create/fork` 不同：`rename` 失败返回 `{ok:false,error}`（调用方必须判 `r.ok`，插件 `:227-228` 已做），而 `ClientSessions.create` 抛 `SessionCreateError`（`:3324-3329`）、`fork` 抛 `SessionForkError`（`:3343-3357`）——`face.rename` 外必须包 `Promise.resolve().then/catch`（插件 `:225-229` 已做） |
| C7 | `host.call('wf.namingPlan'/'wf.namingResult'/'wf.cancelNewSessionWatcher')` 拉单/回报/终局清理（`api-naming.js:174,289,309`；另 `wf.registerNewSessionWatcher/wf.namingSignal/wf.awaitCreatedIssue` 由别处调用，宿主统一在 `namingGuardian.js:349` 出口） | **能（插件内部契约，不经 0.1.7 底座）**：七个命名族电话（注册双名同一本体，按规范入口记 `wf.registerNewSessionWatcher`）在宿主侧全部存在；高频 `namingPlan` 成功走 `debug` 按需日志 | 宿主出口一行钉死六名：`src/host/namingGuardian.js:349`（`wf.registerNewSessionWatcher`/`wf.namingSignal`/`wf.namingPlan`/`wf.namingResult`/`wf.cancelNewSessionWatcher`/`wf.awaitCreatedIssue`；兼容别名 `wf.namingRegister` 见 `:215-216`）；客户端三呼叫点见上；电话三态行注释见 `namingGuardian.js:343-348` | 无需换键；但 C7 的“执行改名”一步仍经 C6，所以 C6 的 `title` 读取（C2→C3）修不好，C7 拉到单也落不了地 |

一句话给 #746 挑单：**只动客户端“读当前标题”一处（C2 切到 C3），并删掉“显式 ptc 即生效 + 别名重试即能救”的假设（C1）；`scope/sessionOf/rename` 三件套与六个 `wf.*` 电话都不用换。**

---

## 1 `dsh-api-session-controller/lib/client.js`：`ClientSessions` 与 `Session`

### 1.1 `Session.rename(title)` / `title` / `open()`

- `Session.rename(title)`（`client.js:1817-1840`）：注释即契约——“`contract session.rename 1:1`，成功按回参 `{title,seq}` 以高 `seq` 胜出结算 `title` 投影格，列表行与 `useProjection('title')` 读者无需等控制流推送即更新”。实现 `1825-1839`：`remote.session.rename({sessionId:this.sessionId,title})`，失败直接 `return result`（不抛）；成功 `projections.apply('title',result.value.title,SessionSeq(result.value.seq))` 后返回 `{ok:true,value:{title,seq}}`。
- `Session` **没有 `title` 方法/属性**：`buildSnapshot`（`client.js:2273-2297`）返回 `{sessionId,pendingSubmissions,running,subagent,removed,openState,openError,hasMore,loadingOlder,promptError,blank,lastAgentError,promptAttempted,awaitingFirstTurn}`——无 `title`。`getSnapshot`（`:1957-1960`）只是该缓存的懒刷新。标题的唯一程序化读口是投影：`ProjectionValueStore.get('title')`（`:951-953`）、`faceOf('title').getSnapshot()`（`:942-962`）、`values().title`（`:967-970`）。
- `Session.open()`（`client.js:1856-1865`）：首次打开拉尾页，幂等（`open` 态直接 `resolve`，在途复用同一 `promise`）；`doOpen`（`:2039-2066`）、`loadOlder`（`:1867-1884`）、`loadThrough`（`:1886-1928`）、`resync`（`:1932-1944`）均为历史窗操作，与改名无关。改名不需要先 `open`（服务端 `rename` 经 `resolveAgent` 直取 `agent.session`，见 `index.js:754-759`）。

### 1.2 `ClientSessions.create / fork / scope / list / get / sessionOf` 签名与失败语义

- `ClientSessions.create(opts={})`（`client.js:3318-3329`）：“建宿主会话并在 `resolve` 前先合进目录行；调用方先保留返回的 `id` 再借 `binding`”。实现即 `manager.create(opts)`，失败 `throw new SessionCreateError(result.error, opts.sessionId)`（`:3326`），成功 `projectList()` 后返回 `result.value.sessionId`（`:3327-3328`，注意丢弃回参里的 `agentPreset`）。`SessionCreateError` 定义见 `:3019-3032`（`session create failed: {code}: {message}`，带 `requestedSessionId`）。
- `Manager.create(opts={})`（`client.js:2671-2713`）：注释“`Contract session.create`；成功立即合进 `summaries`（不等下次刷新）；新建恒 `blank:true`”。`payload` 组装（`:2679-2686`）是关键：`sessionId?` 透传；`workspaceId !== undefined` 则 `{workspaceId,…}` 否则 `{cwd?,…}`——**没有 `agentPreset` 分支**，且全文件无 `agentPreset` 字样（`pwsh` 全文搜零命中，见文末命令）。成功记 `placeholder` 行（`:2688-2698`，带 `cwd` 当且仅当入参有 `cwd`）；`workspace-attach-failed` 错误里发表的 `sessionId` 也会被合进列表（`:2700-2711`，经 `workspaceAttachSessionId:3013-3015`）。
- `ClientSessions.fork(opts)`（`client.js:3330-3357`）：`{sessionId, atSeq?, increaseTitle?}`；`atSeq` 被包成 `SessionSeq`（`:3347`）；失败 `throw new SessionForkError(result.error, opts.sessionId)`（`:3349`，定义 `:3034-3047`）；成功后若 `increaseTitle` 且源标题可读，则 `manager.rename(childId, increasedForkTitle(sourceTitle))`（`:3352-3354`），该子改名失败再抛普通 `Error('fork child rename failed: …')`（`:3354`）。`Manager.fork`（`:2714-2744`）线荷只发 `{sessionId,atSeq?}`，子行 `blank` 先暂 `true`、带 `parentSessionId` 与源 `cwd`（`:2731-2742`）。
- `ClientSessions.scope(id)`（`client.js:3358-3365`）：“借已保留的 Agent 上下文；`id` 即 agent 轴”。`return this.scopes.get(id)?.ctx`，无保留即 `undefined`，不抛。
- `ClientSessions.sessionOf(ctx)`（`client.js:3386-3400`）：“Agent 上下文到对象空间的一跳（宿主 `agent.session` 的客户端镜像）”。先 `scopeOf(ctx)` 取 id（`:3396`），再 `scopes.get(id)` 并校验同代（`scopeIdentityOf(record.ctx) === scopeIdentityOf(ctx)`，`:3399`），命中返 `record.binding.session` 否则 `undefined`。`scopeOf` 本身（`:3383-3385`）即服务方法边界，跨包必须经 `ctx.sessions` 拿，不可直引独立 helper（`:3376-3380`）。
- `list`（`client.js:3151,3166-3171`）：`ClientSessions.list` 是 `createSnapshotStore({ids:[],byId:{},phase:'pending',projectionsBySession:{}})`；`getSnapshot()` 读 `byId`（插件用法 `snap.byId[sid]` 即此）。`refresh()`（`:3258-3260`）即 `manager.refreshList()`；`refreshProjections(sessionId)`（`:3251-3253`）是不开会话读投影的一次性基线。
- `Manager.get(sessionId)`（`client.js:2453-2478`）：“懒建造：有则返，无则建（不开历史——`retain` 分配器在绑 `scope` 后才开）”。新建实例先按 `summaries` 对齐 `blank/running`（`:2465-2468`），无行则按子地址判 `blank`（`:2469-2475`）。**未知 `id` 在 `get` 不抛**；抛“未知会话”的是 `resolveTarget`/`retain` 路径（`:2382-2388`，`throw new Error('sessions.retain: unknown session …')`，见 `:2385`）。
- 事件感知入口（新建会话/状态机，改名守护的“感知新建”只能经这些）：`apply` 注册 `ctx.remote.$on('api-session/added'|'api-session/removed'|'api-session/status'|'api-session/activity'|'api-session/error')`（`client.js:3614-3628`），分别进 `handleSessionAdded:2828-2833`（合行+`blank`对齐+`applyListBlock`）、`handleSessionRemoved:2860-2880`、`handleSessionStatus:2886-2896`、`handleSessionActivity:2902-2908`、`handleSessionError:2914-2916`；控制流基线/逐帧经 `handleControlFrame:2805-2812`（`title` 键同样走 `projectionStore.apply`，见 `:2810`）。插件若要“感知新建会话”应订阅 `sessions.list`（`subscribe:2782-2784`）或上述远端事件，**不要轮询 `sessions.get`**。

## 2 同包 `lib/index.js`（宿主侧）：`rename/create` 入参校验、`workspaceId/cwd` 互斥、`agentPreset` 键名

- `create(request)`（`index.js:681-714`）：
  - 互斥校验第一行即判死（`:687`）：`request.workspaceId !== undefined && request.cwd !== undefined` → `throw new RemoteError('gateway/bad-request','session.create accepts workspaceId or cwd, not both',{})`。这就是 `api-naming.js:91-92` 注释“两分支互斥防 `bad-request`”的底座来源，0.1.7 未变。
  - `sessionId` 缺省即 `session-${randomUUID()}`（`:688`）；`workspaceId` 有则 `workspaceRegistry.get`（`:690-692`），无此工作区 → `workspace/not-found`（`:692`）；`cwd = workspace?.path ?? request.cwd ?? defaultCwd`（`:694`）。
  - 预设透传（`:697`）：`ensureSession(sessionId, cwd, request.sessionId !== undefined, request.agentPreset)`——**键名仍是 `agentPreset`**，无别名。线 schema 同证：`typert.host.js:161-167`（`session_create` 入参 `{workspaceId?,cwd?,sessionId?,agentPreset?}`，`agentPreset` 为 `z.string().optional()`）；回参 `:168-172`（`{sessionId,agentPreset?}`）。
  - 建后挂工作区（`:701-708`）失败 → `session/workspace-attach-failed`（带 `sessionId+workspaceId`）；回参带 `agentPreset` 当且仅当宿主解出非空（`:709-713`）。
- `rename(request)`（`index.js:749-768`）：
  - 先 `resolveAgent(request.sessionId)`（`:755`，找不到即 `session/not-found` 家族，见 `:996` 附近的 `resolveAgent` 失败映射）；再取 `ctx.get('sessionTitle')`（`:756`），未挂载标题服务 → `gateway/internal`（`:757`）。
  - 真改名（`:759`）：`titles.rename(agent.session, request.title)`，回 `{title:accepted.title, seq:accepted.eventSeq}`（`:760-763`）。线形 `typert.host.js:687-695`（入参 `{sessionId,title:string}`，回参 `{title:string,seq:number}`）。
  - 失败只分两类（`:764-767`）：`SessionTitleInvalidError` → `session/title-invalid`（归一为空，见 §3）；其余 → `gateway/internal`。**没有 `bad-request` 分支**：标题合法性不在网关层判，空标题也不会走到 `bad-request`。
- `agentPreset` 键名结论：宿主侧唯一合法键是 `agentPreset`（`index.js:253` 参数名 `presetId` 只是 `ensureSession/createOrAdopt/composeAgent` 的形参名，最终落线与落头都是 `agentPreset`：`:358-365` `composeAgent` 回 `{agentPreset:resolvedId}`；`:454-455` 落 `meta.agentPreset`；`dsh-session/lib/index.js:1012,1668` 头校验 `agentPreset?:string`）。`presetId`/`agentPresetId`/`preset` 在 0.1.7 线 schema 里不存在（`typert.host.js:161-172` 无此键），且客户端根本不转发（§1.2），所以插件 `createPTCSession` 的回退 2 在 0.1.7 上是**注定打空的三连试**，应视为历史兼容垫而非 0.1.7 路径。

## 3 `dsh-session-title` 相关包：标题事件名与订阅方式

- 事件名：**`session/title`**（唯一标题事件）。投影定义 `dsh-session-title/lib/index.js:170-177`（`key:'title'`，`stateSchema/viewSchema` 为 `z.string().min(1).nullable()`，`apply:(state,event)=>event.type==='session/title'?event.data.title:state`）；折叠 `foldSessionTitle:188-198`（`findLast(session/title)`）；`SessionEventMap` 同证 `typert.host.js:1993` 行内（`'session/title': SessionTitleEventData`）。
- 订阅方式（客户端只有投影订阅，没有标题专用事件订阅）：
  - 单键面：`projectionStore.faceOf('title')`（`client.js:942-962`，`getSnapshot/subscribe` 对）；
  - 整包值：`projectionValues(sessionId)`（`client.js:2798-2800`）与 `values()`（`:967-970`）；
  - 列表行：`byId[sid].title`（§1.2，`2938-2972` + `3496-3575`）。
  - 宿主 `ctx.remote.$on` 转发的五个会话事件里**没有标题专用推送**（`client.js:3614-3628` 只有 `added/removed/status/activity/error`）；标题到达靠列表块（`applyListBlock:2842-2855`，`sequenced` 高 `seq` 胜出 vs `cached` 只填空）与控制帧（`handleControlFrame:2805-2812`），以及改名回参的即时结算（`Session.rename:1831-1832`、`Manager.rename:2756`）。
- 读/写语义（`dsh-session-title/lib/index.js`）：
  - `get(session)`（`:276-283`）：对活会话折最新 `session/title`，无合格输入即 `undefined`。
  - `rename(session,title)`（`:284-311`）：非活会话（`ctx.sessions.get(id)!==session`）抛普通 `Error`（`:297`）；归一（`normalizeSessionTitle:47-56`，`cleanTitleText:24-28` + `truncateTitleUtf8:33-45`）后为空抛 `SessionTitleInvalidError`（`:299`，宿主窄化为 `session/title-invalid`，见 `index.js:765`）；否则 `supersede` 在途自动生成 + `append('session/title',{title:normalized,messageSeqs:[],source:{kind:'user'}})`（`:301-306`），`user` 源即钉死（后续 `onUserMessage:379-383` 早退，`refresh` 外不再自动覆盖）。
  - 首条感知（“感知首条建号引用”的底座侧对应物）：`titleInput` 投影（`:237-240`）记 `{first,lastSeq,count}`，`collectSessionTitleMessages:161-168` 只收 `user/message` 且 `normalizeSessionTitle≠''`；`onUserMessage:379-403` 在首条合格消息后排 `fallback` 生成。插件要的“首条建号引用”是插件自己的 `gh` 索引差值（`namingGuardian.js:134-179`），底座只保证首条消息会留下 `titleInput.first` 与后续 `fallback` 标题，**不提供“首条里出现 `#n` 即回调”的推送**。

## 4 会话列表快照形状：`byId` 行上是否有 `title/cwd/blank/header（含 agentPreset）`，在哪段代码组装

结论：**行上有 `title/cwd/blank`，有 `projectionValues.agentPreset`，没有名叫 `header` 的整包字段**（`agentPreset` 的头侧真源在持久头 `SessionHeader.agentPreset`，列表行只带其投影副本与 `cwd/origin/parentSessionId` 散字段）。

- 宿主行（`index.js`）：
  - `summaryFor:1870-1882`：`{sessionId,updatedAt,agentAvailable,running,blank:metadata?.blank ?? session.seq===0,…listFields(header),projections?}`。
  - `summarizeCold:1907-1918`：同形（冷会话 `agentAvailable:false,running:false`）。
  - `listFields:2043-2049`：只散出 `{parentSessionId?,origin?,cwd?}`——**没有 `header` 整包**，`agentPreset` 也不在行顶层；`agentPreset` 在 `projections.values.agentPreset`（读口 `presetForSession:340`、`presetForObservation:477`）。
  - `sessionListMetadata` 投影（`:1789-1846`）：`{blank:boolean}` + `lastPromptAt`，`applySessionListMetadata:1807-1811`（`blank` 一旦 `turn/start` 即永久落 `false`）；`updatedAt:2040-2042`（`max(header.createdAt,lastPromptAt)`）。
- 客户端两级组装（`client.js`）：
  - `Manager.buildListSnapshot:2938-2972`：逐 `summary` 取 `projectionStore.get('title')`（`:2941`），非空才挂 `title`（`:2948`），整包挂 `projectionValues`（`:2949`），`blank` 再与 `sessionListMetadata.blank` 取与（`:2946`），`updatedAt` 取大（`:2947`）。行恒等缓存（`:2951-2956`，`title/cwd/blank/origin/parentSessionId/depth/projectionValues` 全等才复用旧对象）。
  - `ClientSessions.projectList:3496-3575`：最终 `byId[id]` 定形 `:3503-3515`——`{id,displayTitle:displayTitleOf(title,cwd,id),running,retainedBy,blank,updatedAt,projectionValues?,title?,cwd?,parentId?,origin?}`。`displayTitleOf:3052-3059`（`title ?? cwd basename ?? id`）是展示回退，**值比对必须用 `title`**。子代理目录另两路（`:3517-3541` 目录拼行、`:3542-3568` 已保留 `scope` 兜底行）同样只保证 `title/projectionValues/displayTitle`，不保证 `cwd`。
- 存储与消费分工：
  - `dsh-client-store/lib/index.js:70-91`（`createSnapshotStore`）：只提供 `getSnapshot/subscribe/set` 三件套，不懂会话语义。
  - `dsh-session-projection/lib/index.js:58-73,281-407`：只管单会话投影格的 `init/apply/restore/seed`（`title` 格的宿主注册在标题包，见 §3），不管列表 `byId`。
  - `dsh-client-ui-conversation`：全文搜 `byId/displayTitle/.title` 只命中历史/上传/词典等无关面（`lib/client.js` 无会话标题消费，见文末命令输出），**不是组装方**，只是经 `session.projections.faceOf('inbox')`（`:14285`）等读投影的消费者。
  - `dsh-client-ui-session/lib/client.js:281-344`：是 `byId` 的消费者代表（`:281` 读 `sessions.list.getSnapshot().byId` 选主视图、`retainInfo` 判保留），同样不组装。
- 给插件的三条硬规则：① `row.title` 缺席 = 未知（绝不是空标题）；② `row.cwd` 缺席 = 冷/子行（`index.js:1900` 冷行无 `cwd` 直接跳过，`client.js:3551-3567` 子兜底行可无 `cwd`）；③ `getRowPreset`（`api-naming.js:46-55`）先读 `projectionValues.agentPreset` 再读 `header.agentPreset` 是对的，但 0.1.7 行上没有 `header` 整包，第二路恒空——**保留第一路即可**，不要为第二路加新别名。

## 5 `dsh-agent-preset*`：当前有效的预设名册（`ptc/standard/code` 是否合法）与 `resolve` 失败错形

- 名册不在包里硬编码：`dsh-agent-preset/lib/index.js:5-29` 只是声明式 `AgentPreset`（`id/name/plugins`，经 `ctx.agentPresets.register` 注册）；`dsh-agent-preset-registry/lib/index.js:502-507`（空 `id`/重复 `id` 即抛）+ `603-615`（`resolve`）证明**合法性 = 运行期 `definitions` 映射的键集合**，打包代码里搜 `ptc/standard/code` 字面零命中（`pwsh` 全包搜证，见文末）。
- `resolve(id)`（`:599-615`）：`wanted = id ?? defaultId`（`:604`）；无记录即 `throw new RemoteError('agent-preset/not-found', 'Unknown agent preset: …', {agentPreset:wanted, available:[...definitions.keys()]})`（`:606-609`）——**判 `ptc` 是否合法的唯一办法是抓该错的 `details.available`**，不能在插件里写死三预设名单（插件 `isHealthyPreset:56-64` 现行“仅 `code/broken` 判不健康、其余非空放行”与此一致，保持即可）。
- 同错形另两处：`readDocument:620-625`（同 `not-found`）、`retain:639-660`（无记录同 `not-found:643-646`；已注册但诊断 `broken`/无代际即 `agent-preset/invalid:652-655`，带 `{agentPreset,reason}`；运行中切到已开转会话即 `agent-preset/locked:756-758`）。
- 宿主建会话侧的预设失败映射：`ensureSession` 经 `assertPresetUnchanged`（`index.js:272`） mismatch 即 `ApiSessionPresetConflict`，顶层窄化为 `agent-preset/conflict`（`:1009`，带 `{sessionId,requestedPreset,existingPreset?}`）；`composeAgent` 的 `resolve` 失败即上抛 `not-found/invalid`（`:358-365`）。`create` 本身**没有为未知预设单设 `bad-request`**，未知预设走 `not-found`，这就是插件回退 2 正则里 `unknown|invalid` 分支的来源——但如 §1.2 所证，0.1.7 客户端不转发 `agentPreset`，该分支在 0.1.7 上观测不到。
- `ptc/standard/code` 三值在 0.1.7 打包代码里均无“合法/非法”字面断言；`research/dsh-platform-facts-2026-09-23.md:22,68-75`（0.1.5 基线）曾记默认 `standard`，但那是旧版事实，**不可直接沿用到 0.1.7**（`research/737-…:48-54` 同样只对 0.1.5 负责）。#746 落地前必须在真机抓一次 `not-found` 的 `available` 数组，那才是 0.1.7 名册。

## 6 本仓库七条电话/门面逐条标注（`namingGuardian.js` × `api-naming.js`）

以“插件调用点 → 0.1.7 底座对应 → 能/不能/需换键”逐条给（行号均为仓库实测行）：

1. `sessions.create`（`api-naming.js:101-103`，`doCreate` 包同步抛转异步拒绝；`buildCreateOpts:89-95`；`createPTCSession:96-140`）：**能调，需换预期**。`workspaceId/cwd` 互斥与回退 1（`:109-120`）仍成立（底座 `index.js:687` 未变）；但 `agentPreset:'ptc'` 在 0.1.7 客户端被丢（`client.js:2678-2687` 无该键），回退 2 的 `presetId→agentPresetId→preset` 三连试（`:121-136`，`#739` 补第三键）注定打空。替代：不增第四键；创建成功后读快照验 `projectionValues.agentPreset`，非 `ptc` 即按现有 `api-preset-guard.js` 隔离/重建（该文件语义见 `research/737-…:29-33`）。
2. `sessions.get(sid)` 读标题（`api-naming.js:155-157`）：**不能（该分支恒空）**。底座 `Session` 无 `title`（`client.js:2273-2297`）。替代键：`sessions.list.getSnapshot().byId[sid].title`（`:161-163` 回退即正解）；strict 场景用 `sessions` 的 `projectionValues(sid)?.title`（`client.js:2798-2800`）。
3. `sessions.list.getSnapshot()`（`api-naming.js:160-163,265-268,301-305`）：**能**。`byId` 形状见 §4（`client.js:2938-2972` + `3496-3575`）。注意 `title` 缺席即未知、`displayTitle` 不可代 `title`。
4. `sessions.scope(sid)`（`api-naming.js:206`）：**能**（`client.js:3363-3365`，无保留返 `undefined`）。保持现有空检查（`:207`）。
5. `sessions.sessionOf(scope)`（`api-naming.js:207`）：**能**（`client.js:3395-3400`，异代/未标记返 `undefined`）。保持跨包经 `ctx.sessions` 的面调用，勿直引 helper。
6. `face.rename(target)`（`api-naming.js:225-229`）：**能**（`Session.rename:client.js:1825-1840`；等价 `Manager.rename:2751-2758`）。保持面标识校验（`:210-216`）、改前二次值比对（`:218-224`）、`r.ok` 分支回报（`:227-228`）。失败只返 `{ok:false}`，外层 `catch` 报 `rename rejected` 的现有写法可留。
7. `host.call('wf.*')`（`api-naming.js:174,289,309` ↔ `namingGuardian.js:349` 六名 + 一别名）：**能（插件内契约）**。`wf.registerNewSessionWatcher`（规范入口，兼容别名 `wf.namingRegister`，见 `namingGuardian.js:215-216`）、`wf.namingSignal`（`:218-229`）、`wf.namingPlan`（`:231-287`，`tracked.done` 终局语义 `:244-254`）、`wf.namingResult`（`:289-319`，`renamed/locked/failed` 三路即时落盘 `:302-317`）、`wf.cancelNewSessionWatcher`（`:323-331`）、`wf.awaitCreatedIssue`（`:333-342`，`watching` 查询 + `namingSweepSoon(120)` 即时推进 `:340`）。电话三态行（`:343-348`）注明共七电话（含双名）。

## 7 给 #746 挑单的可落地建议（只指定位置，不给补丁）

1. 必做：`src/client/kernel/api-naming.js:149-166`（`namingCurrentTitleOf`）删 `sessions.get(sid).title` 首选分支，**只留快照分支**（或换 `projectionValues`）。否则值比对锁（`evaluateRenameLock`）的输入恒 `null`，`executeNamingOrder:182-231` 首行即 `return`，新版改名在 0.1.7 上表现为“永远本轮跳过”。
2. 必做：`src/client/kernel/api-naming.js:89-95,121-136`（`buildCreateOpts` + 回退 2）删“显式 ptc 即生效”假设的注释，保留键名 `agentPreset`（宿主线 schema 仍是它），**删对三别名的依赖心智**（代码可留作历史兼容，但 0.1.7 路径不指望它们）。判 `ptc` 合法性改从真机 `agent-preset/not-found.details.available` 读（§5），未知即不可复用（现有 `isHealthyPreset:56-64` 语义已对，不用改名单）。
3. 不做：`sessions.scope/sessionOf/face.rename`、`wf.*` 六名、`namingGuardian.js` 全文件——0.1.7 上都不用换。`getRowPreset` 第二路（`header.agentPreset`，`api-naming.js:52`）可留（恒空但无害），勿为它加别名。
4. 真机必抓（本研究在只读约束下未执行，#746 执行时补）：① 新建一次读 `byId` 行实际 `projectionValues.agentPreset`（判默认预设到底是谁）；② 故意传未知预设抓 `agent-preset/not-found.details.available`（判 0.1.7 名册）；③ `sessions.get(sid)` 打印可枚举键（复核无 `title`）。

## 附：本次只读核验跑过的命令（`pwsh` 只读）与为什么

- `Get-ChildItem BASE/@deepseek-ai`：确认底座包名册（含 `dsh-api-session-controller/dsh-session-title/dsh-session-projection/dsh-client-store/dsh-agent-preset(-registry)`）与工作区目录。
- `Get-ChildItem …/dsh-api-session-controller/lib`：定位 `client.js/index.js/typert.host.js/typert.remote-client.js` 四个一手来源。
- `Select-String client.js -Pattern 'rename|sessionOf|scope\(|fork\(|create\(|list\(|…'` 等多轮：钉 `Session.rename:1825`、`Manager.create:2678`、`Manager.rename:2751`、`ClientSessions.create:3324/fork:3343/scope:3363/sessionOf:3395/projectList:3496`、`$on:3614`。
- `Select-String client.js -Pattern 'title'` 全量 + `ProjectionValueStore:929-1066` 通读：证 `title` 只活在投影/`byId`，`Session` 快照无 `title`（C2 死分支的直接证据）。
- `Select-String client.js -Pattern 'agentPreset'`（零命中）：证 0.1.7 客户端不转发预设（C1 的核心反直觉结论）。
- `Select-String index.js -Pattern 'bad-request|workspaceId|cwd|agentPreset|…'`：钉互斥 `index.js:687`、预设透传 `:697`、改名 `:754-768`、行组装 `summaryFor:1870/listFields:2043/sessionListMetadata:1789`。
- `dsh-session-title/lib/index.js` 通读 + `Select-String 'rename|session/title|…'`：钉事件名 `session/title:177`、折叠 `:188`、`get:281`、`rename:295`、`onUserMessage:379`。
- `dsh-agent-preset-registry/lib/index.js:599-660` 通读：钉 `resolve/retain` 的 `not-found/invalid/locked` 三错形与 `available` 名册读法；全包搜 `ptc/standard/code` 零命中证无硬编码名册。
- `typert.host.js:161-172,687-695`：钉线 schema 的 `create{workspaceId?,cwd?,sessionId?,agentPreset?}` 与 `rename{sessionId,title}→{title,seq}`。
- `Select-String dsh-client-ui-conversation/dsh-client-ui-session`：证前者不消费标题、后者只消费 `byId`（组装方唯一性）。
- `Get-ChildItem research` + 通读 `research/737-dsh-0-1-7-new-session-api.md` 与 `research/206-session-naming.md`：对齐旧基线（0.1.5）口径，避免把旧结论直接当 0.1.7 结论。
- 未跑任何写命令、未改任何源文件与票；写操作仅本产物文件一处。
