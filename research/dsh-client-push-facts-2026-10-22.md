# DSH 客户端推送事实：助手回复结束时，数据能不能立刻到浏览器

> 只认一手来源（DSH 0.2.1-rc.2 的 asar 内源码与包内说明；本机桌面版的实现装在 D:\DeepseekHarness\resources\app.asar 里）。每条结论后面跟 `文件:行`。本文件只报事实，不写方案、不做决策。
> 调查时间 2026-10-22（Asia/Shanghai）。
>
> **DSH 侧引用的读法**：下文 `dsh-api-session-controller/lib/index.js:2997` 指的是 asar 内 `dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js:2997`。asar 内路径用系统 Node 直接读不到，本次用脚本按 asar 文件头的 offset/size 把相关文件抽到仓内 `.scratch/dshpush/x/` 与 `.scratch/dshpush/sc/`（该目录不入库），行号按抽取出来的文本计。抽取件到 asar 路径、行数、字节数、SHA-256 前 16 位的对照见文末附表；抽取脚本没有拿 asar 文件头里的 integrity 摘要逐项比对。
>
> **三类事实分开标**：**源码**＝原文件里写着的实现或注释；**观察**＝本机跑出来、扫描出来的结果；**推理**＝由前两者推出、本次没有单独做实验的。没有引用任何 DSH 日志。

## 一句话结论

**能立刻拿到，但只有「会话事件流」这一条路是事件级的。** 浏览器先通过 `sessions.retain(...)` 拿到 `binding.eventSource`，再订阅它：宿主每写入一条会话事件（工具调用 `tool/call`、工具结果 `tool/result`、助手消息 `assistant/message`、整轮结束 `turn/end` 等），客户端都会在收到的同一刻同步发布一次，没有批量、没有定时器。通道是 `/api/remote.mux` 的 WebSocket。`ctx.remote.$on` 的转发事件里没有工具或助手消息事件，只有 `api-session/status`（整轮 running 翻转，粒度更粗）。现有的 5 秒快照探测不是唯一路径。

## 1 问题与范围

本仓要在界面里显示「下一步建议气泡」，需要判断这条数据能不能在助手回复结束时立刻到浏览器，还是只能靠现有 5 秒一轮的快照探测（`src/client/kernel/probe-auto.ts:239-287` 的 `startActiveProbeLoop`，节拍是 `config/intervals.yaml:17` 的 `probeIntervalMs: 5000`）。

本文件按共享任务 task-1 的问题清单逐条查：Q1a 客户端事件订阅、Q1b 本插件能不能用 `ctx.remote / $on`、Q1c `sessions` 服务的订阅与投影格、Q1d 浏览器与宿主的通道、Q2 若 Q1 全否时的最快信号。只报事实，不写方案。

## 2 Q1a 浏览器侧第三方插件能否立刻知道「一次工具调用 / 一次助手回复结束」

### 结论

1. **客户端事件订阅存在，官方自己就在用。** 浏览器侧 `ctx.remote.$on(event, listener)` 订阅宿主转发过来的事件；DSH 自己的会话客户端插件在 apply 里订阅了 `api-session/added / removed / status / activity / error` 五个事件（`dsh-api-session-controller/lib/client.js:4262-4283`）。
2. **转发事件清单里没有工具调用、工具结果、助手消息、整轮结束这些事件。** 宿主只转发 `API_REMOTE_FORWARDED_EVENTS` 列出的那批（`dsh-api-remotes/lib/index.js:21-139`）；其中与会话有关的是 `api-session/added / removed / status / activity / error`，没有任何 `tool/*`、`assistant/*`、`turn/*` 事件。
3. **`api-session/activity` 在工具结果和助手回复结束时都不发。** 宿主只在 `session/event` 是「用户发的 `user/message`」时才发 `api-session/activity`（`dsh-api-session-controller/lib/index.js:2997-3004`）；工具结果、助手消息都在 `return` 之前被过滤掉。
4. **`api-session/status` 能给出「这一轮结束了」，但只有整轮粒度。** 它由 `agent/status` 翻转触发（`dsh-api-session-controller/lib/index.js:2991-2993`）；agent-loop 在整轮驱动 `kick()` 的 `finally` 里把 running 翻成 idle（`dsh-agent-loop/lib/index.js:887-901`），翻转时发 `agent/status`（`dsh-agent-loop/lib/index.js:790-798`）。单条工具结果、单条助手消息不会让 `api-session/status` 发。
5. **工具结果与助手消息本身在「会话事件流」里，浏览器能事件级拿到。** 宿主 `session.follow` 逐条把 `session/event` 推给客户端（`dsh-api-session-controller/lib/index.js:1510-1558`）；客户端收到后同步发布到会话自己的事件流 `eventSource`（`dsh-api-session-controller/lib/types/client/transport.js:45-72`、`dsh-api-gateway/lib/types/client/journal-stream.js:127-152` 与 `:186-207`、`dsh-api-session-controller/lib/types/client/contract/events.js:40` 与 `:78-85`、`:91-110`）。工具结果、助手消息、`turn/end` 都是这条流里的条目。

### 证据（源码原文）

**源码**：客户端 `$on` 的注册与官方用法（`dsh-api-session-controller/lib/client.js:4262-4283`）：

```
const remotes = ctx.remote;
const connection = ctx.get("connection");
const sessions = new ClientSessions(ctx, remotes);
ctx.remote.$on("api-session/added", (summary) => { sessions.handleSessionAdded(summary); });
ctx.remote.$on("api-session/removed", (sessionId) => { sessions.handleSessionRemoved(sessionId); });
ctx.remote.$on("api-session/status", (sessionId, running) => { sessions.handleSessionStatus(sessionId, running); });
ctx.remote.$on("api-session/activity", (sessionId, updatedAt) => { sessions.handleSessionActivity(sessionId, updatedAt); });
ctx.remote.$on("api-session/error", (sessionId, message) => { sessions.handleSessionError(sessionId, message); });
```

**源码**：宿主发这五个事件的位置（`dsh-api-session-controller/lib/index.js:2980-3004`）：

```
ctx.on("session/created", (session) => { ctx.emit("api-session/added", this.listState.summaryFor(session)); });
ctx.on("session/disposed", (session) => { ctx.emit("api-session/removed", session.id); });
...
ctx.on("agent/status", ({ agent, status }) => { ctx.emit("api-session/status", agent.id, status === "running"); });
ctx.on("agent/error", ({ agent, error }) => { ctx.emit("api-session/error", agent.id, errorChain(error)); });
ctx.on("session/event", (session, event) => {
  if (event.type === "request/header") { ... }
  if (event.type !== "user/message" || event.data.source.kind !== "user") return;
  ctx.emit("api-session/activity", session.id, event.time);
});
```

**源码**：转发白名单里与会话有关的五条（`dsh-api-remotes/lib/index.js:21-139`）：

```
{ event: "api-session/activity", mode: "emit", resources: { session: (sessionId) => sessionId } },
{ event: "api-session/added", mode: "emit" },
{ event: "api-session/error", mode: "emit" },
{ event: "api-session/removed", mode: "emit" },
{ event: "api-session/status", mode: "emit" },
```

**源码**：转发队列是「推一条、取一条」，没有合并或节流（`dsh-api-remotes/lib/index.js:183-222`）：

```
push(frame) { if (this.done) return false; this.buffer.pushBack(frame); this.waiter?.(); return true; }
async *iterate(signal, cleanup) {
  while (true) {
    if (done || aborted) return;
    while (buffer.size > 0) yield buffer.popFront();
    await new Promise((resolve) => { this.waiter = resolve; });
  }
}
```

**源码**：宿主 `session.follow` 逐条推送会话事件与助手流帧（`dsh-api-session-controller/lib/index.js:1529-1554`）：

```
const disposeEvent = this.ctx.on("session/event", (session, event) => {
  if (session.id !== target) return;
  buffered.pushBack({ type: "event", event });
  notify();
}, { global: true });
...
const disposeAssistantStream = request.assistantStream !== true ? void 0 : this.ctx.on("agent/assistant-stream", ({ agent, frame }) => {
  if (agent.session.id !== target) return;
  buffered.pushBack({ type: "assistant-stream", frame: wireAssistantStreamFrame(frame, cursorBeforeNext(agent.session.seq)), ordinal: ++assistantStreamOrdinal });
  notify();
}, { global: true });
```

**源码**：会话事件写入时同步通知监听者（`dsh-session/lib/index.js:1579-1599`）：

```
commit(event, entry) {
  this.surfaceManager.validateNext(event);
  if (entry !== void 0) entry.appending = true;
  try {
    let callbacks;
    const callbackArgs = [this, event];
    if (entry !== void 0) callbacks = collectSessionCallbacks(entry.emitCtx, [entry.carrier, "session/event", ...callbackArgs]);
    this.log.push(event);
    this.eventsSnapshot = void 0;
    if (callbacks !== void 0 && entry !== void 0) invokeContainedSessionObservers(entry.emitCtx, "session/event", entry.id, callbackArgs, callbacks);
  } finally { ... }
}
```

**源码**：事件流契约写明「每次接受的窗口变更都同步发布」（`dsh-api-session-controller/lib/types/client/contract/events.js:40`、`:91-110`）：

```
/** Session-owned event feed; every accepted window mutation publishes synchronously. */
...
publish(hasMore, change) {
  this.snapshot = windowSnapshot(this.window, hasMore, this.snapshot.revision + 1, change);
  notifySubscribers(this.listeners, '[session-controller] event feed');
}
```

**推理**：所以「一次工具调用 / 一次助手回复结束」这种事件级知识，只能从会话事件流拿；`$on` 只能给到「整轮开始/结束」这类更粗的状态。清单里问的 `api-session/activity`，在工具结果与助手回复结束时都不发。

## 3 Q1b 本插件客户端半能不能用 `ctx.remote / $on`

### 结论

- 服务名是 `remote`；`$on` 挂在它上面（`dsh-api-gateway/lib/client.browser.js:1617-1631`、`dsh-api-gateway/README.zh.md:52`）。
- 用 `$on` 的前提是 `interactions = answer`：浏览器里默认就是 answer（`dsh-client-connection/lib/client.browser.js:1386`）；不满足时 `$on` 直接抛错（`dsh-api-gateway/lib/client.browser.js:1680-1683`）。
- 浏览器端的身份是 owner（`dsh-client-connection/lib/index.js:714`、`dsh-client-connection/README.zh.md:49`），第三方客户端插件共享同一个 owner 连接；转发事件对 owner 不做额外的访问控制过滤（`dsh-api-gateway/lib/index.js:1037-1060`）。
- 第三方订阅没有「不能订阅」的限制，但有边界：只能收到宿主装配时声明转发的那批事件（`dsh-api-gateway/README.zh.md:66`、`dsh-api-remotes/lib/index.js:21-139`）；订阅归调用方插件的 fiber 所有，dispose 即取消（`dsh-api-gateway/README.zh.md:66`）。
- 本插件客户端产物声明的 inject 是 `['connection', 'slots', 'locale', 'workspaces', 'sessions']`，不含 `remote`（`package/lib/client.js:41798`）；但 cordis 的 `ctx.get(name)` 注释写明「Read a service from the store without the inject requirement」（`cordis/lib/index.js:755-765`），严格模式下只要求提供方 fiber 已就绪（`cordis/lib/index.js:766-772`）。本插件产物里已经在用 `timer / sidebarRight / uiWorkspace / sidebarRightTabs` 这些没写进 inject 的服务（观察）。**推理**：技术上能调用 `ctx.get('remote')`，但 apply 当下能不能取到取决于客户端插件的加载顺序，本次没有实测。

### 证据（源码原文）

**源码**：`remote` 服务与 `$on`（`dsh-api-gateway/lib/client.browser.js:1617-1631`、`:1680-1683`、`:796-801`、`:816-820`）：

```
class ClientRemoteService extends cordis.Service {
  constructor(ctx) { super(ctx, "remote"); ... }
  $on(event, listener) {
    if (this.events === void 0) throw new Error('client api: forwarded events require interactions=answer');
    return this.events.subscribe(this.ctx, event, listener);
  }
}
...
subscribe(callerCtx, event, listener) {
  const dispose = privateEvents(callerCtx).on(this.eventKey(event), listener);
  return () => { dispose(); };
}
...
deliver(frame) { privateEvents(this.ownerCtx).parallel(this.eventKey(frame.event), ...frame.args).catch(...); }
```

**源码**：浏览器连接的默认 `interactions` 是 answer（`dsh-client-connection/lib/client.browser.js:1386`）；浏览器 Peer 是 owner（`dsh-client-connection/lib/index.js:714`）：

```
const interactions = options.interactions ?? (pageLocation === void 0 ? "none" : "answer");
...
this.browserPeer = new Peer(ctx, { principal: { kind: "owner" } });
```

**源码**：宿主只对非 owner 做访问控制过滤，owner 直接入队（`dsh-api-gateway/lib/index.js:1037-1060`）：

```
for (const client of this.remoteEventClients.values()) {
  if (!client.answers) {
    resources = eventResources(...);
    if (this.ctx.remoteAccess.decide({ principal: client.principal, action: "event:" + frame.event, resources }).kind === "deny") continue;
  }
  client.queue.push(wire);
}
```

**源码**：`$on` 的合法键来自宿主装配声明、订阅归调用方 fiber、`interactions=answer` 才注册事件泵（`dsh-api-gateway/README.zh.md:66`）；`remote` 是 ctx 服务键（`dsh-api-gateway/README.zh.md:52`）。

**源码**：本插件客户端产物的 inject 与 apply（`package/lib/client.js:41798-41799`）：

```
exports.inject = ['connection', 'slots', 'locale', 'workspaces', 'sessions'];
exports.apply = function (ctx) { __DSW_CTX__ = ctx; return __plugin.apply(ctx) };
```

**源码**：cordis 的服务读取不要求 inject，但严格模式要求提供方就绪（`cordis/lib/index.js:755-772`）：

```
/** Read a service from the store without the inject requirement. */
get(name, strict = true) { return getTraceable(this.ctx, this._getImpl(name, strict)?.value); }
...
_getImpl(name, strict) {
  const store = this.ctx[symbols.isolate][name];
  ...
  if (strict && provider.fiber.state !== 2) return void 0;
}
```

**观察**：本插件产物里出现的 `ctx.get(...)` 名字有 `connection / timer / slots / locale / sessions / sidebarRight / workspaces / uiWorkspace / sidebarRightTabs`，其中后四个不在 inject 列表里。

**源码**：第三方 bundle 不能随意新增模块请求，但「用已有服务」不需要新增 import（`dsh-client-modules/README.zh.md:34`、`:51`；本插件 `package/package.json:54-63` 的 `dsh.client.external` 为空）。

**推理**：本插件若要用 `$on`，最自然的入口是 `ctx.get('remote').$on(...)`；它不需要改 `dsh.client.external`。是否在 apply 当下已就绪取决于 gateway 客户端插件与第三方插件的加载顺序，这一点清单里没有可查的一手证据，本次未实测。

## 4 Q1c `sessions` 服务的订阅与投影格

### 结论

先给清单要的五个读取口：

1. **`createSnapshotStore` 的实现读不到。** 客户端源码只 require 了 `@deepseek-ai/dsh-client-store` 并调用 `createSnapshotStore({...})`（`dsh-api-session-controller/lib/client.js:9`、`:3814`），但全 asar 里没有这个包，页面壳产物是压缩过的（观察）。所以只能按使用方的可观察行为报。
2. **`sessions.list`（即那个 snapshot store）**：官方 UI 用 `sessions.list.subscribe(...)` 订阅（`dsh-client-ui-session/lib/client.js:808`、`:811`）；服务内部用 `list.getSnapshot()` 读、`list.set(...)` 写（`dsh-api-session-controller/lib/types/client/sessions/service.js:436`、`:446`、`:450`、`:493`、`:566`）。它更新的是「会话列表行」：id、displayTitle、running、retainedBy、blank、updatedAt、formatStatus、projectionValues 等（`.../sessions/service.js:499-514`）。
3. **Session 级有两个读口**：`session.subscribe(listener)`（快照，微任务批处理，`.../sessions/session.js:422-423`、`.../sessions/notifier.js:30-36`、`:65-96`）；以及 `binding.eventSource`（事件流，同步发布，见 Q1a/Q2）。
4. **投影 face**：`projectionStore.faceOf(name)` 返回 `{ getSnapshot, subscribe }`（`.../sessions/projection-store.js:20-31`、`:145-160`），`subscribe` 走 notifier 的微任务批处理。
5. **`projectionValues`**：`manager.projectionValues(sessionId)` 直接读该会话投影 store 的当前值快照（`.../sessions/manager.js:554-556`），不是订阅。

这些口在工具结果 / 助手消息结束时会不会触发：

- **工具结果**：不会产生任何「工具」投影格。`tool/result` 只作为 surface 事件参与上下文计价，会让 `contextBreakdown` 与 `contextPressure` 变化（`dsh-session/lib/index.js:157-163`、`:177-180`、`:298-311`；`dsh-token-meter/lib/types/breakdown-projection.js:111-151`、`.../usage-projection.js:141-188`）。所以工具结果到达时，订阅这两个投影 face 会收到一次（微任务后）；`sessions.list` 行本身不会因为工具结果变化（推理：manager 只在控制帧、状态、活动、错误时标脏，见 `.../sessions/manager.js:525-531`、`:562-577`）。
- **助手消息结束**：会让 `tokenUsage`、`contextPressure`、`contextBreakdown` 三个 wire 投影变化（`.../usage-projection.js:86-118`、`:141-188`；`.../breakdown-projection.js:111-151`），对应 face 与 `sessions.list` 的 `projectionValues` 在微任务后更新。
- **整轮结束**：`api-session/status` 到达 → manager 记录一次 status 变更并标脏 → `sessions.list` 的 `running` 更新（`.../sessions/manager.js:525-531`、`:562-577`；宿主发事件见 `dsh-api-session-controller/lib/index.js:2991-2993`）。
- **列表元数据投影**：`sessionListMetadata` 只在 `turn/start` 与用户消息时变化（`dsh-api-session-controller/lib/index.js:1872-1879`、注册 `:1907-1920`）。
- **待办投影**：`todos` 只在 `todo/write` 与 `turn/start` 时变化（`dsh-tool-todo/lib/types/index.js:87-100`）。

**投影格里有没有「工具结果」这一格：没有。** 全 asar 扫描到的投影键里，wire=true 的是 `inbox、agentPreset、modelSelection、agentTeam、goal、plan、title、subagentCatalog、subagentTiming、subagent、contextBreakdown、tokenUsage、contextPressure、userQuestions、sessionListMetadata、imageLimits、permissions、todos、workingDirectory`；wire=false 的是 `turnBoundary、sessionStats、turnOutline、subagentModelSelectionPolicy、imageOffload`。没有任何以工具调用或工具结果为语义的键；最接近步骤边界的是 `turnBoundary`，但它 wire=false（只在宿主侧，浏览器收不到，`dsh-agent-loop/lib/index.js:1365-1412`、注册 `:1581`）。工具事件只作为会话事件存在（`tool/call`、`tool/result` 在 `KNOWN_SESSION_EVENT_TYPES` 里，`dsh-session/lib/types/known-event-types.js:74`、`:77`）。

### 证据（源码原文）

**源码**：snapshot store 的创建与注入（`dsh-api-session-controller/lib/client.js:9`、`:3814`；`.../sessions/service.js:165-168`、`:186`）：

```
let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
...
this.list = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({ ids: [], byId: {}, phase: 'pending', projectionsBySession: {} });
```

```
this.list = createSnapshotStore({ ids: [], byId: {}, phase: 'pending', projectionsBySession: {} });
const disposeManagerProjection = this.manager.subscribe(() => { this.projectList(); });
...
rootCtx.reflect.provide('sessions', this, void 0);
```

**观察**：全 asar 没有 `@deepseek-ai/dsh-client-store` 包目录；`dsh-web-frontend/dist/assets` 只有 index/vendor/langs/fonts/css 几份产物，其中 `index-CN7NIWNw.js` 是压缩后的页面壳；在 `index.js`、`vendor.js` 里 grep `createSnapshotStore` / `client-store` 只命中无关文本。

**源码**：`sessions.list` 的读/写/订阅用法（`.../sessions/service.js:436`、`:446`、`:450`、`:493`、`:566`；`dsh-client-ui-session/lib/client.js:808`、`:811`）：

```
if (this.list.getSnapshot().byId[id] === undefined && this.manager.subagentAddress(id) !== undefined) { this.projectList(); }
...
const state = this.list.getSnapshot();
const row = state.byId[id];
...
this.list.set({ ...state, byId: { ...state.byId, [id]: { ...row, retainedBy } } });
...
projectList() {
  const previousById = this.list.getSnapshot().byId;
  const { items, phase, projectionsBySession } = this.manager.getListSnapshot();
  ...
  this.list.set({ ids, byId, phase, projectionsBySession });
}
```

```
const disposeList = sessions.list.subscribe(() => { this.publishMain(); });
const disposeStatus = sessions.list.subscribe(() => { this.reconcileStatus(); });
```

**源码**：`sessions.list` 的更新来源是 manager 的 notifier（微任务批处理）（`.../sessions/manager.js:50-52`、`:525-531`、`:538-540`、`:562-577`）：

```
notifier = new Notifier(() => { this.listSnapshotCache = this.buildListSnapshot(); });
...
recordMutation(mutation) { ... this.notifier.markDirty(); }
...
subscribe(listener) { return this.notifier.subscribe(listener); }
...
handleControlFrame(frame) {
  if (frame.type === "baseline") { this.replaceControlBaseline(frame.value); return; }
  this.projectionStore(frame.sessionId).apply(frame.key, frame.value, SessionSeq(frame.seq));
  this.notifier.markDirty();
}
```

**源码**：Session 快照订阅走 notifier，notifier 用 `queueMicrotask` 发布（`.../sessions/session.js:422-423`；`.../sessions/notifier.js:30-36`、`:65-96`）：

```
subscribe(listener) { return this.notifier.subscribe(listener); }
```

```
markDirty() { this.dirty = true; this.schedule('microtask'); }
...
schedule(kind) { ... queueMicrotask(() => this.flush()); }
...
flush() { ... this.rebuild(); notifySubscribers(this.listeners, '[session-controller] state'); }
```

**源码**：投影 face 的读与订阅（`.../sessions/projection-store.js:20-31`、`:145-160`）：

```
anyNotifier = new Notifier(() => {});
faceOf(key) { return this.channel(key).face; }
...
channel(key) {
  ...
  face: { getSnapshot: () => this.rows.get(key)?.value, subscribe: (listener) => notifier.subscribe(listener) }
}
```

**源码**：`projectionValues` 是快照读取（`.../sessions/manager.js:554-556`）：

```
projectionValues(sessionId) { return this.projectionStores.get(sessionId)?.values(); }
```

**源码**：`binding.eventSource` 的来源（`.../sessions/service.js:412-414`、`:471-490`；官方 UI 用法 `dsh-client-ui-conversation/lib/client.js:4078-4085`）：

```
binding(id) { return this.scopes.get(id)?.binding; }
...
materializeScope(id) {
  ...
  const binding = { sessionId: id, session, eventSource: session.eventSource, ctx };
  ...
}
```

```
binding(source) {
  const sessionId = typeof source === "string" ? source : source.sessionId;
  const owner = typeof source === "string" ? this.sessions.binding(source) : source;
  if (owner === void 0) throw new Error('uiConversation.binding: unknown session "' + sessionId + '"');
  ...
  const binding = new BoundConversation(owner.eventSource, new ConversationNodeAssembler(this.events, this.views, this.groups));
}
```

**源码**：surface 事件集合与工具结果的位置（`dsh-session/lib/index.js:157-163`、`:177-180`、`:298-311`）：

```
const SURFACE_EVENT_TYPES = new Set(["user/message", "assistant/message", "tool/result"]);
...
function isSurfaceEvent(event) { return SURFACE_EVENT_TYPES.has(event.type); }
```

**源码**：`tool/result` 与 `assistant/message` 都是已知会话事件（`dsh-session/lib/types/known-event-types.js:28`、`:74`、`:77`、`:78`）：

```
'assistant/message',
...
'tool/call',
'tool/result',
'turn/end',
```

**源码**：助手消息结束会让 `tokenUsage` / `contextPressure` / `contextBreakdown` 变化（`dsh-token-meter/lib/types/usage-projection.js:86-118`、`:141-188`；`.../breakdown-projection.js:111-151`）。

**观察**：全 asar 扫描投影定义得到的 wire 键清单（扫描脚本 `.scratch/dshpush/scan2.js`、`scan3.js`）：wire=true 的 19 个键与 wire=false 的 5 个键见上面的结论；没有任何以工具调用/工具结果为语义的键。

**源码**：`turnBoundary` 投影存在但不对浏览器发（`dsh-agent-loop/lib/index.js:1365-1412`，注册 `:1581`）；它的状态是 `openTurnStartSeq / lastStepStartSeq / lastStepBoundary / lastTurn`，没有 `wire` 字段。

**推理**：投影通道能提供「助手消息结束了」的间接证据（`tokenUsage` 等变化），但给不出「哪一次工具调用」；工具级语义只能从 `binding.eventSource` 的事件里读。`sessions.list` 的 `subscribe` 实现读不到，无法从源码确认它是否和 UI 观察到的一样在微任务后通知。

## 5 Q1d 浏览器与宿主走哪条通道

### 结论

- 会话数据走一条 WebSocket：`/api/remote.mux`。`session.follow` 与转发事件流 `$events` 都在这条多路复用连接上（`dsh-api-gateway/lib/client.browser.js:105-108`、`:761`、`:828`、`:1630`；`dsh-client-connection/lib/client.browser.js:1348-1354`、`:1423`、`:1497`）。
- 清单里说的「`dsh-client-modules` 那条 SSE」不成立：`dsh-client-modules/lib/client.js` 里没有 `EventSource`、没有 `text/event-stream`、没有 `fetch`（观察：全 asar 扫描）。SSE 在 `dsh-client-hmr/lib/client.js:235`、`:252`、`:299`，路径是 `/plugins/events`，用于模块图/产物重载，不是会话数据。
- 插件能直接用这条通道：`connection` 服务暴露 `openWebSocket(path)`（`dsh-client-connection/lib/client.browser.js:1423`、`:1497`），本插件产物 inject 里就有 `connection`（`package/lib/client.js:41798`）；路径按 `document.baseURI` 拼，没有路径白名单（`dsh-client-connection/lib/client.browser.js:1348-1354`）。
- **推理**：正常用会话数据不需要自己开 socket——`sessions.retain(...)` 拿 `binding.eventSource` 或 `ctx.get('remote').$on` 已经走这条通道；自己开 `/api/remote.mux` 还要自己实现 `RemoteStreamMuxClient` 的帧协议，本次没有查第三方直接用的例子。

### 证据（源码原文）

**源码**：WebSocket 路由与复用（`dsh-api-gateway/lib/client.browser.js:105-108`、`:342`、`:761`、`:828`、`:1630`）：

```
/** Exact WebSocket route carrying every Typert Remote stream. */
const REMOTE_STREAM_MUX_PATH = "/api/remote.mux";
const REMOTE_EVENT_STREAM_ENDPOINT = "$events";
...
constructor(openSocket = () => new WebSocket(remoteStreamUrl()), waitForReconnect = false) { ... }
...
const url = new URL(REMOTE_STREAM_MUX_PATH.slice(1), globals.__DSH_TRANSPORT__?.streamBaseUrl ?? document.baseURI);
...
const source = this.openStream(REMOTE_EVENT_STREAM_ENDPOINT, REMOTE_EVENT_STREAM_PAYLOAD, generationSignal);
...
this.streams = new RemoteStreamMuxClient((path) => connection.openWebSocket(path), connection.interactions === "answer");
```

**源码**：连接服务的打开函数与提供（`dsh-client-connection/lib/client.browser.js:1348-1354`、`:1386`、`:1423`、`:1497`）：

```
function openConnectionWebSocket(path, factory = (url) => new WebSocket(url), baseUrl) {
  const base = baseUrl ?? (typeof document === "undefined" ? void 0 : document.baseURI);
  if (base === void 0) throw new Error("connection: WebSocket carrier requires streamBaseUrl outside a document");
  const url = new URL(path.slice(1), base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return factory(url.href);
}
...
openWebSocket: (path) => openConnectionWebSocket(path, transport?.createWebSocket, transport?.streamBaseUrl)
...
ctx.provide("connection", handle);
```

**源码**：SSE 属于模块重载通道（`dsh-client-hmr/lib/client.js:235`、`:252`、`:299`）：

```
const EVENTS_ROUTE = "/plugins/events".slice(1);
...
headers: { accept: "text/event-stream" }
...
const source = new EventSource(EVENTS_ROUTE);
```

**观察**：`dsh-client-modules/lib/client.js` 全文没有 `EventSource` / `text/event-stream` / `fetch(` 命中；`dsh-client-modules` 的重载机制是模块图与 chunk URL（`dsh-client-modules/lib/client.js:431`、`:860`）。

**源码**：Remote 流共用 Gateway WebSocket、`$events` 的来源与非 owner 判定（`dsh-api-gateway/README.zh.md:47`、`:58`、`:64`）；每个 Remote 端点受 remote-access 访问控制（`dsh-api-session-controller/README.zh.md:36`）。

## 6 Q2 客户端能拿到的「这一轮结束了」最快信号

### 结论

1. **最快的是会话事件流 `binding.eventSource.subscribe(listener)`。** 它同步发布每一条接受的窗口变更（`.../contract/events.js:40`、`:91-110`）；客户端从 `session.follow` 收帧后同步 append（`dsh-api-gateway/lib/types/client/journal-stream.js:186-207`；`.../sessions/transport.js:45-72`）。
2. **具体信号：**
   - 单条助手消息结束：`assistant/message` 在 assistant-stream 的 `end` 帧到达时发布（`dsh-api-session-controller/lib/client.js:2114-2141` → `:2730-2757` → `:2772-2779`）；订阅者看到的是一次 `append`，条目类型 `assistant/message`。客户端打开会话流时显式请求了助手流（`dsh-api-session-controller/lib/client.js:433` 的 `assistantStream: true`），所以这条路径默认是开着的。
   - 整轮结束：`turn/end` 事件（`dsh-agent-loop/lib/index.js:1029`）；它比 `api-session/status` 的 running 翻转更早（`dsh-agent-loop/lib/index.js:887-901` 在 `turn()` 返回后才翻）。
   - 工具结果：`tool/result` 逐条 append，没有额外等待。
3. **次快的是 `ctx.remote.$on('api-session/status', ...)`**：整轮 running 翻转时到达，粒度是「整轮」，拿不到单条消息/工具结果（`dsh-api-session-controller/lib/index.js:2991-2993`）。
4. **投影 face 与 `sessions.list` 的订阅在微任务之后**：notifier 用 `queueMicrotask` 合并同一轮变更（`.../sessions/notifier.js:30-36`、`:65-96`；`.../sessions/projection-store.js:145-160`；`.../sessions/manager.js:50-52`、`:538-540`）。
5. **延迟量级**：这条路上没有固定批量、没有节流、没有轮询定时器（转发队列 `dsh-api-remotes/lib/index.js:183-222`；宿主广播 `dsh-api-gateway/lib/index.js:993-1025`、`:1037-1060`；客户端泵每帧投递 `dsh-api-gateway/lib/client.browser.js:822-870`）。**推理**：实际延迟就是一条 WebSocket 帧加上浏览器事件循环的量级，本次没有实测毫秒数；与现有 5 秒轮询（`config/intervals.yaml:17`）不是同一量级。

### 证据（源码原文）

**源码**：assistant-stream 的 `end` 帧到达后发布 assistant/message（`dsh-api-session-controller/lib/client.js:2114-2141`、`:2730-2757`、`:2772-2779`）：

```
case "end": {
  const attempt = this.activeAttempt;
  if (attempt === void 0 || attempt.attemptId !== frame.attemptId) return;
  this.activeAttempt = void 0;
  if (frame.index !== attempt.nextIndex) return { type: "rebaseline" };
  if (frame.outcome.kind === "abandoned") ...
  const entry = this.pending.get(frame.outcome.seq);
  if (entry === void 0 || entry.event.type !== frame.outcome.eventType) return { type: "rebaseline" };
  this.pending.delete(frame.outcome.seq);
  if (entry.event.type === "assistant/message" && entry.event.data.interrupted !== true) {
    this.retainedAttempt = { attemptId: attempt.attemptId, turn: attempt.turn, step: attempt.step };
    return this.publish(entry);
  }
  ...
}
```

```
publishAssistantEntry(result) {
  ...
  if (result?.type === "publish") {
    const changed = this.appendLive(result.entry);
    if (result.retireAttemptId !== void 0) this.eventSource.settleAssistant(result.retireAttemptId);
    if (changed || result.retireAttemptId !== void 0) this.notifier.markDirty();
  } else if (result?.type === "transient") {
    this.eventSource.append(result.entry);
    this.notifier.markDirty();
  }
}
...
appendLive(entry) {
  const event = entry.event;
  ...
  this.eventSource.append(entry);
  ...
}
```

**源码**：客户端显式请求助手流（`dsh-api-session-controller/lib/client.js:433`）：

```
assistantStream: true,
```

**源码**：事件流同步发布与客户端逐帧接受（`.../contract/events.js:40`、`:78-85`、`:91-110`；`dsh-api-gateway/lib/types/client/journal-stream.js:186-207`）：

```
/** Session-owned event feed; every accepted window mutation publishes synchronously. */
...
append(entry) { this.publish(this.hasMore, { kind: 'append', entries: [entry] }); }
...
async acceptEntry(entry, item, iterator) {
  ...
  this.options.publish({ type: 'append', entry });
}
```

**源码**：整轮结束的写入与状态翻转顺序（`dsh-agent-loop/lib/index.js:1029`、`:887-901`、`:790-798`）：

```
this.session.append("turn/end", { ... });
...
async kick() {
  try { while (await this.turn()); }
  catch (_error) {} finally {
    if (this.phase.kind === "running") {
      const { turn, wakeRequested } = this.phase;
      this.setPhase({ kind: "idle", lastTurn: turn });
      if (wakeRequested && this.inbox.hasPending) this.wakeDriver();
    }
  }
}
...
setPhase(next) {
  const previousStatus = this.status;
  this.phase = next;
  const status = this.status;
  if (status !== previousStatus) this.dispatch.emit("agent/status", { status });
}
```

**源码**：客户端事件泵每帧投递、没有合并（`dsh-api-gateway/lib/client.browser.js:822-870`）；宿主转发队列 pull 驱动（`dsh-api-gateway/lib/index.js:993-1025`、`:1037-1060`；`dsh-api-remotes/lib/index.js:183-222`）。

**源码**：现有轮询节拍（仓内，`config/intervals.yaml:16-17`）：

```
# 变化探测的间隔：正在看的那个活跃工作区每 5 秒探一次。
probeIntervalMs: 5000
```

**源码**：轮询的启动点（仓内，`src/client/kernel/probe-auto.ts:239-287`）：

```
shared._activeTimer = timer.interval(step, _attentionPlan.intervalMs);
```

## 7 对哪张票有影响

本调查服务共享任务 task-1（「下一步建议气泡」这条数据能不能在助手回复结束时立刻到浏览器）。仓内没有找到对应的票号：在仓库里搜「建议气泡」「下一步建议」只命中 HoverTip 等无关历史文档（观察）。本文件只报事实，方案与取舍留给任务 owner。

## 8 还没确定的

1. `createSnapshotStore` 的实现（`subscribe` 的确切语义、是否微任务通知）读不到：`@deepseek-ai/dsh-client-store` 不在 asar 里，页面壳产物压缩过。
2. 本插件 `apply` 当下 `ctx.get('remote')` 是否已就绪：本插件 inject 未声明 `remote`，cordis 的 `get` 不要求 inject 但严格模式要求提供方就绪；实际加载顺序本次没实测。
3. assistant-stream `end` 帧到浏览器的实际毫秒延迟没实测；只证明了这条路上没有固定批量、节流或定时器。
4. 非 owner 身份（远程访问）下 `$on` 能收到哪些事件没查；本机浏览器是 owner。
5. `dsh-client-store` 是否在页面壳里另有实现没查（页面壳是压缩产物）。

## 附：本次核对过的原文（行号与哈希）

抽取件在 `.scratch/dshpush/` 下（不入库）；行数、字节数、SHA-256 前 16 位由抽取件本身计算。下表「asar 内路径」都以 `dsh/node_modules/@deepseek-ai/` 开头。

| 文件（asar 内路径） | 行数 | 字节数 | SHA-256 前 16 位 |
| --- | ---: | ---: | --- |
| dsh/node_modules/@deepseek-ai/cordis/lib/index.js | 1830 | 60361 | 6a9394c0877ff452 |
| dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js | 2024 | 74599 | cf57e3ecd487ac5c |
| dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/client.browser.js | 2187 | 84127 | 3043de82334846a3 |
| dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/index.js | 1831 | 74266 | 4fbe460fec585ebc |
| dsh/node_modules/@deepseek-ai/dsh-api-gateway/README.zh.md | 109 | 22287 | e86a14a31efdf2d6 |
| dsh/node_modules/@deepseek-ai/dsh-api-remotes/lib/index.js | 258 | 6991 | 2e7068e388541ca6 |
| dsh/node_modules/@deepseek-ai/dsh-api-remotes/README.zh.md | 93 | 9347 | 329c3d59c9e02685 |
| dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js | 4326 | 166568 | 82f2301c18f0e513 |
| dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js | 3368 | 132150 | a9801acb577b0305 |
| dsh/node_modules/@deepseek-ai/dsh-api-session-controller/README.zh.md | 138 | 24730 | 3c5b1b834d923e65 |
| dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/client.browser.js | 1523 | 60601 | dfc3544eb894c74b |
| dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js | 1073 | 44434 | 0ebcca7583e08271 |
| dsh/node_modules/@deepseek-ai/dsh-client-connection/README.zh.md | 95 | 13194 | d352865f0285408b |
| dsh/node_modules/@deepseek-ai/dsh-client-hmr/lib/client.js | 316 | 13248 | 697e5273fa6f7ac7 |
| dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js | 1019 | 46292 | 426084f8672c26a4 |
| dsh/node_modules/@deepseek-ai/dsh-client-modules/README.zh.md | 152 | 15968 | 4290f59f22039ea4 |
| dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js | 20065 | 773901 | 843dbcd884e05d77 |
| dsh/node_modules/@deepseek-ai/dsh-client-ui-session/lib/client.js | 1141 | 39988 | c2aee5c41e606b62 |
| dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js | 2053 | 94982 | 2f5dd07cb5c744a2 |
| dsh/node_modules/@deepseek-ai/dsh-session/lib/types/known-event-types.js | 89 | 2923 | f2adf39f26ecf7cc |
| dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/events.js | 112 | 3902 | 11326d2c2fbde3d0 |
| dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/manager.js | 800 | 37910 | 1791454916544c64 |
| dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/notifier.js | 98 | 3078 | fe4983f05f26b4d2 |
| dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/projection-store.js | 162 | 6803 | 027de778b5f4f95c |
| dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/service.js | 583 | 24664 | d53c5c016915dbc0 |
| dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/session.js | 867 | 38957 | 880409eecfdd6970 |
| dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/transport.js | 130 | 5627 | ee4679f56c57b00f |
| dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/types/client/journal-stream.js | 398 | 16203 | 8fe06849fcf8cf5d |
| dsh/node_modules/@deepseek-ai/dsh-token-meter/lib/types/breakdown-projection.js | 152 | 7167 | 0d577366eadb69e1 |
| dsh/node_modules/@deepseek-ai/dsh-token-meter/lib/types/surface-projection.js | 68 | 3578 | d5641cb8f02fb41f |
| dsh/node_modules/@deepseek-ai/dsh-token-meter/lib/types/usage-projection.js | 189 | 8800 | 30a766b7b43553dc |
| dsh/node_modules/@deepseek-ai/dsh-tool-todo/lib/types/index.js | 179 | 8199 | d2cdf40f3523f2af |
| dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-CN7NIWNw.js | 192 | 939867 | 4bc914bfbb6adbdd |
| dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/vendor-DcuzkuQH.js | 412 | 741114 | c14ba1089d78f48b |
