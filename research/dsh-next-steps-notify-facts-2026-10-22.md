# DSH 工具调用通知事实：tool/call、会话事件流、retain 与宿主通道

> 只认一手来源（本机桌面版 asar 内的源码与包内说明；asar 在 D:/DeepseekHarness/resources/app.asar）。每条结论后面跟 文件:行。本文件只报事实，不写方案、不做决策。
> 调查时间 2026-10-22（Asia/Shanghai）。
>
> 路径约定：下文省略 asar 内的公共前缀 dsh/node_modules/@deepseek-ai/。例如 dsh-api-session-controller/lib/client.js:2077 指的是 asar 内 dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js 第 2077 行。本次用脚本按 asar 文件头的 offset/size 把相关文件抽到仓内 .scratch/dshpush/x/ 与 .scratch/dshpush/sc/（该目录不入库），行号按抽取出来的文本计。
>
> 三类事实分开标：源码＝原文件里写着的实现或注释；观察＝本机扫描出来的结果；推理＝由前两者推出、本次没有单独做运行时实验的。本次没有引用任何 DSH 运行日志。
>
> 证据里的代码块是节选：其中的 ... 表示省略了一部分代码或过长的表达式/字符串，不是原文里的省略号；字段名、判断条件与分支方向没有改写。

## 一句话结论

1. **Q1：工具调用带工具名与模型参数。** 持久事件 tool/call 的 data 含 name 与 arguments，arguments 是 JSON 文本字符串；assistant-stream 里的 tool-call-delta 带工具名与参数碎片，block-end 带完整的 tool-call 块（dsh-agent-preset-registry/lib/typert.host.js:745、:801、:897）。
2. **Q2：官方界面正在显示会话时，binding(id) 能零副作用拿到 eventSource。** binding 只从已存在的 scope 表里借用，不延长生命周期；sessions.retain 才是引用计数加一、启动共享历史 follow。binding 返回 undefined 表示当前没有 retained generation，不代表会话不存在（dsh-api-session-controller/lib/types/client/sessions/service.js:407-414、:415-441）。
3. **Q3：没有现成的「宿主插件直接通知浏览器插件」通用事件总线。** 宿主只转发一份编译期固定的白名单，里面没有 tool/*、assistant/*、turn/*；registerRemoteEvents 只允许注册唯一一个 source，第三方不能追加白名单或替换 source。底层可用的原语是宿主 registerUpgrade 加浏览器 openWebSocket，但没有现成的插件通知入口（dsh-api-remotes/lib/index.js:21-139、:146-148；dsh-api-gateway/lib/index.js:851-875）。
4. **Q4：若必须 retain，它会保活浏览器侧的 generation 与历史 follow，并改动 retainedBy；不保活 Host Agent。** 官方界面只读 retainedBy.mainView，新增来源键会触发一次 retainInfo 通知但不会改变官方对主会话的判断；没有一句话明确点名「第三方插件可以 retain」，可依据的是公开 ISessions 接口与 README 关于消费方来源键可声明合并的说明（dsh-api-session-controller/README.zh.md:80-82；dsh-client-ui-session/lib/client.js:913-931）。

## Q1 客户端会话事件流里，一条「工具调用」长什么样

### 结论

1. **tool/call 的 data 含工具名与模型传参。** 类型声明是 turn、step、callId、name、arguments 五个字段；name 是工具名，arguments 是字符串（dsh-agent-preset-registry/lib/typert.host.js:745）。
2. **arguments 是 JSON 文本，不是已经解析好的对象。** provider 在生成工具调用时用 JSON.stringify 把模型输入序列化成字符串，再交给 agent-loop 写进事件（dsh-llm-deepseek/lib/index.js:1862；dsh-llm-pi-ai/lib/index.js:1623）。
3. **写入点是 agent-loop 的 appendToolCall。** 它把 block.id、block.name、block.arguments 原样放进 session.append('tool/call', ...)（dsh-agent-loop/lib/index.js:681-688）。
4. **tool/call 的事件信封是 type、seq、time、data。** append 先对 data 做 JSON 快照与 deepFreeze，再校验；seq 取写入前的日志长度，time 取写入时刻（dsh-session/lib/index.js:1517-1537）。tool/call 不在 surface 事件集合里，因此没有 surfaceOp 或 sourceEventSeqs（dsh-session/lib/index.js:157-163）。
5. **会话事件流的条目分两种。** 持久事件是 type 为 event、event 为 SessionEvent 的条目；助手流帧是 type 为 transient、event 为 assistant/live-chunk 的条目（dsh-cordis-client-runner/lib/client.js:2141-2142）。
6. **assistant-stream 的帧里也带工具名与参数。** assistant/live-chunk 的 data.chunk 是 StreamChunk；tool-call-delta 含 index、id、可选 name、argumentsDelta；block-end 含完整的 block，而 tool-call 块含 type、id、name、arguments（dsh-agent-preset-registry/lib/typert.host.js:801、:897；dsh-cordis-client-runner/lib/client.js:1745-1753）。
7. **名字不是每一帧都有，参数是逐段累积的。** tool-call-delta 的 name 在类型和校验里是可选的；实际 provider 至少会在工具调用开始时发一次带 name 的 delta，block-end 则一定带完整 name 与完整 arguments 字符串（dsh-api-session-controller/lib/client.js:1902-1908、:1935-1957；dsh-llm-deepseek/lib/index.js:1967-1973、:1902-1910、:1982-1987；dsh-llm-pi-ai/lib/index.js:1604-1624）。
8. **官方聊天界面已经同时消费这两条来源。** 它的 toolDefinition.match 对 assistant/live-chunk 的 block-end（且 block.type 为 tool-call）、tool-call-delta，以及持久 tool/call 都返回 start；后续从 block-end 取 name/arguments，从 delta 累积 argumentsDelta（dsh-client-ui-chat/lib/client.js:10367-10390、:10139-10171、:7885）。

### 证据（源码原文，节选）

源码：tool/call 的类型声明（dsh-agent-preset-registry/lib/typert.host.js:745）

    'tool/call': { turn: number; step: number; callId: ToolCallId; name: string; arguments: string; };

源码：ToolCallBlock 带完整工具名与参数（dsh-agent-preset-registry/lib/typert.host.js:896-898）

    export interface ToolCallBlock {
        type: 'tool-call';
        id: ToolCallId;
        name: string;
        arguments: string;
    }

源码：agent-loop 的写入点（dsh-agent-loop/lib/index.js:681-688）

    function appendToolCall(session, turn, step, block) {
        return session.append("tool/call", {
            turn,
            step,
            callId: block.id,
            name: block.name,
            arguments: block.arguments
        }).seq;
    }

源码：provider 把模型参数序列化成 JSON 文本（dsh-llm-deepseek/lib/index.js:1862；dsh-llm-pi-ai/lib/index.js:1623）

    arguments: JSON.stringify(object(native.input))
    arguments: JSON.stringify(event.toolCall.arguments)

源码：assistant/live-chunk 的帧形状（dsh-cordis-client-runner/lib/client.js:1745-1746）

    export interface AssistantLiveChunkEvent {
        readonly type: 'assistant/live-chunk';
        readonly seq: number;
        readonly time: number;
        readonly data: {
            readonly attemptId: LlmAttemptId;
            readonly turn: number;
            readonly step: number;
            readonly chunk: StreamChunk;
        };
    }

源码：StreamChunk 里的工具调用两种帧（dsh-agent-preset-registry/lib/typert.host.js:801）

    | { type: 'tool-call-delta'; index: number; id: ToolCallId; name?: string; argumentsDelta: string; }
    | { type: 'block-end'; index: number; block: ContentBlock; }

源码：tool-call-delta 的展开与校验（dsh-api-session-controller/lib/client.js:1902-1908、:1952-1955）

    else chunk = {
        type: "tool-call-delta",
        index: record.index,
        id: record.id,
        ...Object.hasOwn(record, "name") ? { name: record.name } : {},
        argumentsDelta: members[index]
    };
    const args = stringArray(record.args, "tool-call-chunks args");
    if (args.length === 0) throw new TypeError("tool-call-chunks args must be non-empty");
    if (typeof record.id !== "string" || record.id.length === 0) throw new TypeError("tool-call-chunks id must be a non-empty string");
    if (record.name !== void 0 && (typeof record.name !== "string" || record.name.length === 0)) throw new TypeError("tool-call-chunks name must be a non-empty string");

源码：chunk 帧进入 transient 条目（dsh-api-session-controller/lib/client.js:2096-2111）

    return {
        type: "transient",
        entry: {
            type: "transient",
            event: {
                type: "assistant/live-chunk",
                seq: this.durableCursor + 1 - 1 / (this.transientInGap + 1),
                time: frame.time,
                data: { attemptId: frame.attemptId, turn: attempt.turn, step: attempt.step, chunk: frame.chunk }
            }
        }
    };

源码：DeepSeek 在 block-start 发带 name 的 delta，在参数增量里只发 argumentsDelta（dsh-llm-deepseek/lib/index.js:1967-1973、:1902-1910）

    } else yield {
        type: "tool-call-delta",
        index: block.index,
        id: block.content.id,
        name: block.content.name,
        argumentsDelta: ""
    };

    if (delta.type === "input_json_delta" && content.type === "tool-call") {
        const argumentsDelta = string(delta.partial_json);
        block.json += argumentsDelta;
        return { type: "tool-call-delta", index: block.index, id: content.id, argumentsDelta };
    }

源码：DeepSeek 的 block-end 带完整参数（dsh-llm-deepseek/lib/index.js:1982-1987）

    block.closed = true;
    if (block.content.type === "tool-call" && block.json.length > 0) block.content.arguments = block.json;
    yield { type: "block-end", index: block.index, block: { ...block.content } };

源码：pi-ai 的 delta 与 block-end（dsh-llm-pi-ai/lib/index.js:1604-1624）

    case "toolcall_delta": {
        const known = toolIds.get(event.contentIndex);
        yield {
            type: "tool-call-delta",
            index: event.contentIndex,
            id: brandString(known?.id ?? ""),
            ...known?.name !== void 0 && known.name.length > 0 ? { name: known.name } : {},
            argumentsDelta: event.delta
        };
        break;
    }
    case "toolcall_end":
        yield {
            type: "block-end",
            index: event.contentIndex,
            block: { type: "tool-call", id: brandString(event.toolCall.id), name: event.toolCall.name, arguments: JSON.stringify(event.toolCall.arguments) }
        };

源码：官方聊天把三条路径都当成工具调用的开始（dsh-client-ui-chat/lib/client.js:10370-10385）

    match: (event) => {
        if (event.type === "assistant/live-chunk") {
            const chunk = event.data.chunk;
            if (chunk.type === "block-end" && chunk.block.type === "tool-call") return { id: String(chunk.block.id), role: "start" };
            return chunk.type === "tool-call-delta" ? { id: String(chunk.id), role: "start" } : null;
        }
        if (event.type === "tool/call") return { id: String(event.data.callId), role: "start" };
        ...
    }

## Q2 本插件能不能订到当前会话的事件流而不产生副作用

### 结论

1. **sessions.retain 是引用计数语义，不是「打开一个一次性订阅」。** 它先做 abort 检查与 disposed 检查，解析出 session id，再 retainScope 增加引用计数和 retainedBy[source]，然后把这个引用接到共享的 Session.open() 上；返回的引用支持 release 与 Symbol.dispose（dsh-api-session-controller/lib/types/client/sessions/service.js:188-203、:204-213）。
2. **retainedBy 会按来源键累加。** retainScope 把 referenceCount 加一，把 retainedBy[source] 加一；release 回调把计数减一，减到零才 retireScope，否则 publishRetention（dsh-api-session-controller/lib/types/client/sessions/service.js:415-441）。
3. **retain 会启动该会话的历史打开与 follow。** Session.open() 是幂等的：已经 open 就返回 resolved，正在 open 就返回同一个 promise；否则 doOpen 创建 SessionEventStream 并 await events.open(HISTORY_PAGE_OPTIONS)（dsh-api-session-controller/lib/types/client/sessions/session.js:298-311、:529-545）。
4. **binding(id) 只借用，不延长生命周期。** 源码注释是 Borrow an already-retained binding without extending its lifetime，实现只有 return this.scopes.get(id)?.binding；scope(id) 也只借用（dsh-api-session-controller/lib/types/client/sessions/service.js:407-414、:365-367）。
5. **binding(id) 返回 undefined 的确切含义是「当前没有 retained generation」。** 注释写的是 the live binding, or undefined without a retained generation；这可能是从未 retain、全部 release，或者 controller 已经 dispose，不代表会话本身不存在（dsh-api-session-controller/lib/types/client/sessions/service.js:407-414）。
6. **materializeScope 只会在 retainScope 里被调用。** 它创建 scope Context、取 manager.get(id) 的 Session、bindScope，然后造出 { sessionId, session, eventSource: session.eventSource, ctx } 的 binding（dsh-api-session-controller/lib/types/client/sessions/service.js:471-490）。
7. **订阅 eventSource 是纯本地的同步监听。** subscribe 只执行 listeners.add 并返回删除函数；publish 只是替换快照并同步 notifySubscribers，不发起请求、不读历史、不改引用计数（dsh-api-session-controller/lib/types/client/contract/events.js:41-55、:107-110）。
8. **官方主界面在显示会话前已经 retain 过。** workspace 的 replaceMain 先 sessions.retain(target, { source: "mainView" })，成功后才把 mainReference 指向它并 release 前一个；clearMain 也 release 当前引用（dsh-client-ui-workspace/lib/client.js:1651-1673、:1644-1650）。右栏用 sidebarView、子代理侧栏用 sidebarChat 也是同一模式（dsh-client-ui-sidebar-right/lib/client.js:1638；dsh-client-ui-subagent/lib/client.js:39284）。
9. **官方 conversation 自己也是借 binding 的。** binding(source) 在 source 是字符串时调用 this.sessions.binding(source)，拿不到就抛 uiConversation.binding: unknown session；拿到后再检查 this.sessions.binding(sessionId) 是否仍等于 owner，不等就抛 inactive session（dsh-client-ui-conversation/lib/client.js:4078-4085）。
10. **因此有现有 retain 时是零副作用；没有时才必须 retain。** 前者的副作用只有本地 listeners.add；后者会增加 referenceCount 与 retainedBy、启动共享 open/follow，并必须在结束时 release。

### 证据（源码原文，节选）

源码：retain 与 using（dsh-api-session-controller/lib/types/client/sessions/service.js:188-213）

    retain(target, options) {
        const { source, signal } = options;
        signal?.throwIfAborted();
        if (this.closed) throw new Error('Session Controller is disposed');
        const id = this.manager.resolveTarget(target);
        const reference = this.retainScope(id, source);
        try {
            reference.attachOpening(this.manager.get(id).open(), signal);
            return reference;
        }
        catch (error) {
            reference.release();
            throw error;
        }
    }
    async using(target, options, operation) {
        const reference = this.retain(target, options);
        try {
            await reference.ready;
            return await operation(reference);
        }
        finally {
            reference.release();
        }
    }

源码：引用的 release 与 dispose（dsh-api-session-controller/lib/types/client/sessions/service.js:126-137）

    release() {
        const reason = new Error(...Session reference ... is released...);
        const release = this.releaseReference;
        this.released.abort(reason);
        this.readiness.reject(reason);
        this.record = undefined;
        this.releaseReference = undefined;
        release?.();
    }
    [Symbol.dispose]() { this.release(); }

源码：retainScope 的引用计数与 retainedBy（dsh-api-session-controller/lib/types/client/sessions/service.js:415-435）

    retainScope(id, source) {
        const record = this.scopes.get(id) ?? this.materializeScope(id);
        const previous = record.retention;
        record.retention = Object.freeze({
            referenceCount: previous.referenceCount + 1,
            retainedBy: freezeRetainedBy({ ...previous.retainedBy, [source]: (previous.retainedBy[source] ?? 0) + 1 }),
        });
        const reference = new ClientSessionReference(id, record, () => {
            if (!record.live) return;
            const count = record.retention.referenceCount - 1;
            const { [source]: sourceCount = 0, ...otherSources } = record.retention.retainedBy;
            const retainedBy = sourceCount > 1 ? { ...otherSources, [source]: sourceCount - 1 } : otherSources;
            record.retention = count === 0 ? EMPTY_RETAIN_INFO : Object.freeze({ referenceCount: count, retainedBy: freezeRetainedBy(retainedBy) });
            if (count === 0) this.retireScope(id, record);
            else this.publishRetention(id);
        });
        ...
        this.publishRetention(id);
        return reference;
    }

源码：binding 只借用已有 generation（dsh-api-session-controller/lib/types/client/sessions/service.js:407-414）

    /**
     * Borrow an already-retained binding without extending its lifetime.
     * @param id - Session identity.
     * @returns the live binding, or undefined without a retained generation.
     */
    binding(id) {
        return this.scopes.get(id)?.binding;
    }

源码：materializeScope 造出 binding 的四个字段（dsh-api-session-controller/lib/types/client/sessions/service.js:471-490）

    const { fiber, ctx } = createScope(this.rootCtx, id);
    const session = this.manager.get(id);
    session.bindScope(ctx);
    const binding = { sessionId: id, session, eventSource: session.eventSource, ctx };
    const record = { fiber, ctx, binding, session, retention: EMPTY_RETAIN_INFO, live: true };
    this.scopes.set(id, record);
    ctx.effect(() => () => { this.retireScope(id, record, false); }, 'session-controller: exact generation');
    return record;

源码：eventSource 的订阅与同步发布（dsh-api-session-controller/lib/types/client/contract/events.js:41-55、:107-110）

    export class MutableSessionEventSource {
        listeners = new Set();
        subscribe(listener) {
            this.listeners.add(listener);
            return () => { this.listeners.delete(listener); };
        }
        publish(hasMore, change) {
            this.snapshot = windowSnapshot(this.window, hasMore, this.snapshot.revision + 1, change);
            notifySubscribers(this.listeners, '[session-controller] event feed');
        }
    }

源码：官方 workspace 的 retain/release（dsh-client-ui-workspace/lib/client.js:1651-1673）

    replaceMain(target, signal, panel, beforeOpen) {
        signal.throwIfAborted();
        const reference = this.sessions.retain(target, { source: "mainView" });
        try {
            signal.throwIfAborted();
            beforeOpen?.(reference.sessionId);
            if (signal.aborted) { reference.release(); return; }
            const subagentAddress = typeof target === "string" ? this.sessions.subagentAddress(reference.sessionId) : target;
            this.selection.set({ sessionId: reference.sessionId, ... });
        } catch (error) {
            reference.release();
            throw error;
        }
        const previous = this.mainReference;
        this.mainReference = reference;
        previous?.release();
        ...
    }

源码：官方 conversation 借 binding（dsh-client-ui-conversation/lib/client.js:4078-4085）

    binding(source) {
        const sessionId = typeof source === "string" ? source : source.sessionId;
        const owner = typeof source === "string" ? this.sessions.binding(source) : source;
        if (owner === void 0) throw new Error(...uiConversation.binding: unknown session...);
        if (this.sessions.binding(sessionId) !== owner) throw new Error(...uiConversation.binding: inactive session...);
        const current = this.bindings.get(owner);
        if (current !== void 0) return current.binding;
        const binding = new BoundConversation(owner.eventSource, new ConversationNodeAssembler(...));
        ...
    }

## Q3 有没有「宿主侧插件直接通知浏览器侧插件」的现成通道

### 结论

1. **没有找到通用事件总线。** 全 asar 文本扫描（.js/.mjs/.cjs/.ts/.mts/.d.ts/.md，跳过超过 8MB 的文件）里，中文「事件总线/插件间」只命中三处包内说明（dsh-agent-preset、dsh-client-resources、dsh-jobs 各 1 次）；event bus / broadcastChannel 类关键词主要落在 pdf.js、DevTools、cordis 内部，不是宿主插件到浏览器插件的事件总线（观察；扫描脚本 .scratch/dshpush/bus-scan.js）。
2. **宿主转发给浏览器的事件是一份编译期固定白名单。** API_REMOTE_FORWARDED_EVENTS 列出 28 条业务事件，与会话有关的是 api-session/activity、added、error、removed、status；没有 tool/*、assistant/*、turn/*（dsh-api-remotes/lib/index.js:21-139）。
3. **白名单是唯一转发源，第三方不能追加。** remoteEventSource 只按这份数组逐个 ctx.on，把匹配事件推进队列；apply 把它交给 ctx.typertGateway.registerRemoteEvents；registerRemoteEvents 的注释写明 Register the sole application-selected forwarded-event source，已注册时直接抛错（dsh-api-remotes/lib/index.js:146-176；dsh-api-gateway/lib/index.js:846-852）。
4. **浏览器侧 $on 不是自定义事件入口。** 它从 Gateway 的 forwarded-event 流订阅；没有 events 时直接抛 client api: forwarded events require interactions=answer，事件键的投递与路由由 Gateway 的白名单注册决定（dsh-api-gateway/lib/client.browser.js:1680-1683、:796-820、:917-919）。
5. **HMR 的 /plugins/events 是专用 SSE，不是通用总线。** 它推送 graph 与 rebuilt 两类帧，服务客户端 bundle 图变化与重建；README 说明转发现有的图变化与重建通知（dsh-client-hmr/lib/index.js:5、:124-169；dsh-client-hmr/README.zh.md:62）。
6. **客户端 resources 是浏览器插件之间的值共享，不是宿主到浏览器的通知。** 它的模型是「另一个客户端包拥有数据」时按 dsh-resource:// 地址共享实时值，提供 ctx.resources（dsh-client-resources/README.zh.md:11、:31）。
7. **appendPluginRecord 是持久会话记录，不是瞬时通知。** 它写 plugin: 前缀、ignorable:true 的事件进会话日志，fork/resume 保留；注释限定只有 packages/experimental/ 的生产源码可调用（dsh-session/lib/index.js:1265-1297）。
8. **底层原语存在，但要自己建路由、自己做鉴权。** 宿主 webServer.registerUpgrade 接受精确路径的 WebSocket 升级路由；浏览器 connection.openWebSocket 接受任意路径并用 document.baseURI 解析；宿主 connection.requestRejection/admitConnection 提供 401/403 与 peer 准入。inspector 已经用这套原语自建了 /devtools/cdp 路由（dsh-host-webserver/lib/index.js:340-346、:432-465；dsh-client-connection/lib/client.browser.js:1348-1354、:1421-1424；dsh-client-connection/lib/index.js:736-776；dsh-experimental-inspector/lib/index.js:2461-2501）。
9. **结论：没有「宿主插件 emit 一个自定义事件，浏览器插件 $on 就能收到」的现成通道；能事件级到达浏览器的现成数据是会话事件流。** 若要新增宿主到浏览器的通知，只能走底层 WebSocket 路由，或者复用会话事件流；这两条都不是声明式的插件事件转发。

### 证据（源码原文，节选）

源码：转发白名单的开头与会话相关条目（dsh-api-remotes/lib/index.js:21-54）

    const API_REMOTE_FORWARDED_EVENTS = [
        { event: "agent-preset/selected", mode: "emit" },
        { event: "approval/request", mode: "waterfall" },
        { event: "api-session/activity", mode: "emit", resources: { session: (sessionId) => sessionId } },
        { event: "api-session/added", mode: "emit", resources: { session: (summary) => summary.sessionId } },
        { event: "api-session/error", mode: "emit", resources: { session: (sessionId) => sessionId } },
        { event: "api-session/removed", mode: "emit", resources: { session: (sessionId) => sessionId } },
        { event: "api-session/status", mode: "emit", resources: { session: (sessionId) => sessionId } },
        ...
    ];

源码：白名单里没有任何 tool/assistant/turn 条目（dsh-api-remotes/lib/index.js:55-139）

    会话相关只有：
    api-session/activity
    api-session/added
    api-session/error
    api-session/removed
    api-session/status

源码：remoteEventSource 只按白名单注册监听（dsh-api-remotes/lib/index.js:149-176）

    function remoteEventSource(ctx) {
        return (signal) => {
            const queue = new RemoteEventQueue();
            const disposers = API_REMOTE_FORWARDED_EVENTS.map((entry) => {
                const { event, mode } = entry;
                if (mode === "emit") {
                    return ctx.on(event, (...args) => {
                        queue.push({ event, args: assertJsonArgs(event, args), ...resources });
                    });
                }
                return ctx.on(event, function(request, next) { ... });
            });
            return queue.iterate(signal, () => { for (const dispose of disposers) dispose(); });
        };
    }

源码：唯一转发源的注册（dsh-api-remotes/lib/index.js:146-148）

    function apply(ctx) {
        ctx.effect(() => ctx.typertGateway.registerRemoteEvents(remoteEventSource(ctx), { home: homedir() }), "api-remotes: forwarded Cordis event source");
    }

源码：Gateway 只允许一个转发源（dsh-api-gateway/lib/index.js:846-852）

    /**
     * Register the sole application-selected forwarded-event source.
     */
    registerRemoteEvents(source, host) {
        if (this.remoteEvents !== void 0) throw new Error("typert gateway: forwarded Remote event source is already registered");
        ...
    }

源码：宿主可以加精确路径的 WebSocket 路由（dsh-host-webserver/lib/index.js:340-346、:432-457）

    registerUpgrade(route) {
        if (this.upgrades.has(route.path)) throw new Error(...webserver: duplicate upgrade route...);
        this.upgrades.set(route.path, route);
        return () => { this.upgrades.delete(route.path); };
    }
    this.server.on("upgrade", (req, socket, head) => {
        let route;
        try {
            route = this.upgrades.get(new URL(req.url ?? "/", "http://x").pathname);
        } catch (error) { ... }
        if (route === void 0) { socket.destroy(); return; }
        ...
        Promise.resolve(route.handler(req, socket, head)).catch(...);
    });

源码：inspector 自建 WebSocket 路由并复用宿主鉴权（dsh-experimental-inspector/lib/index.js:2461-2468）

    disposers.push(ctx.webServer.registerUpgrade({
        path: ... + "/cdp",
        handler: (req, socket, head) => {
            const rejection = ctx.connection.requestRejection(req);
            if (rejection !== void 0) {
                const reason = rejection === 401 ? "Unauthorized" : "Forbidden";
                socket.end(...HTTP/1.1 ... Connection: close...);
                return;
            }
            ...
        }
    }));

源码：浏览器 openWebSocket 不限制路径（dsh-client-connection/lib/client.browser.js:1348-1354、:1421-1424）

    function openConnectionWebSocket(path, factory = (url) => new WebSocket(url), baseUrl) {
        const base = baseUrl ?? (typeof document === "undefined" ? void 0 : document.baseURI);
        if (base === void 0) throw new Error(...connection: WebSocket carrier requires streamBaseUrl outside a document...);
        const url = new URL(path.slice(1), base);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        return factory(url.href);
    }
    const handle = {
        ...
        openWebSocket: (path) => openConnectionWebSocket(path, transport?.createWebSocket, transport?.streamBaseUrl),
        ...
    };

源码：宿主准入原语（dsh-client-connection/lib/index.js:736-776）

    requestRejection(request) {
        const admission = this.admit(request);
        return "rejection" in admission ? admission.rejection : void 0;
    }
    admit(request) {
        if (!this.isTrusted(request)) return { rejection: 403 };
        if (this.disposed) return { rejection: 401 };
        const secure = ...;
        if (this.browserAuth.isAuthenticated(request, secure)) return { peer: this.browserPeer };
        const id = this.browserAuth.authenticateApi(request, secure);
        const record = id === void 0 ? void 0 : this.peers.get(id);
        return record === void 0 ? { rejection: 401 } : { peer: record.peer };
    }
    admitConnection(request) {
        const admission = this.admit(request);
        if ("rejection" in admission) return admission;
        ...
        if (record.ownsSocket) return { rejection: 409 };
        record.ownsSocket = true;
        ...
    }

源码：HMR 的专用 SSE 端点（dsh-client-hmr/lib/index.js:5、:124-152）

    const EVENTS_ENDPOINT = "/plugins/events";
    const connect = (res) => {
        res.writeHead(200, { "content-type": "text/event-stream", ... });
        res.write(": connected\n\n");
        connections.add(res);
        res.write(sseData({ type: "graph", graph: ctx.clientModules.graph() }));
        res.on("close", () => { connections.delete(res); });
    };
    ctx.effect(() => {
        const disposeRoute = ctx.webServer.register({ kind: "exact", path: EVENTS_ENDPOINT, handler: (req, res) => { ... connect(res); } });
        const unsubscribeGraph = ctx.clientModules.onGraphChanged(publishGraph);
        const unsubscribe = ctx.clientModules.onRebuilt((id, rev) => { ... });
        return () => { ... };
    });

源码：plugin record 的持久性质与调用限制（dsh-session/lib/index.js:1271-1297）

    /**
     * Append one experimental plugin record: an event marked ignorable ...
     * Only production source under packages/experimental/ may call this
     * function; the verify-plugin-record-callers gate rejects any other
     * production caller in this repository.
     */
    function appendPluginRecord(session, type, data) {
        return commitPluginRecord(session, type, data);
    }

观察：全 asar 关键词扫描的分布（.scratch/dshpush/bus-scan.js；扫描整棵 asar 文本文件）

    chineseBus（事件总线|插件间|插件之间）：
      1  dsh-agent-preset
      1  dsh-client-resources
      1  dsh-jobs
    enBus（event bus / plugin bus / broadcastChannel）：
      125  dsh-client-ui-sidebar-documentpreview
      21   dsh-experimental-inspector
      12   cordis
      2    dsh-tool-workflow
      1    dsh-session-persistence-jsonl
    sse（text/event-stream / new EventSource）：
      98   other
      4    dsh-client-hmr
      3    dsh-experimental-inspector
      2    dsh-llm-deepseek
      1    dsh-client-ui-sidebar-documentpreview
      1    dsh-host-webserver

## Q4 如果必须 retain，具体后果是什么

### 结论

1. **retain 会保活浏览器侧的 generation，不只是保住一个监听器。** README 原文：引用保活本地会话数据、作用域 Context 和历史流，不保活 Host Agent。普通 Session 不因保留引用而添加目录行（dsh-api-session-controller/README.zh.md:82）。
2. **retainedBy 会变，且 sessions.list 的对应行会被更新。** retainScope 写入 retainedBy[source] 加一；publishRetention 在该行存在时替换 row.retainedBy，并在快照变化时通知 retainInfo 的订阅者（dsh-api-session-controller/lib/types/client/sessions/service.js:418-421、:445-458）。
3. **官方界面只读 retainedBy.mainView。** ui-session 的 publishMain 只在 retainInfo(currentId).getSnapshot().retainedBy.mainView 大于 0 时保留 currentId，否则从列表里找 mainView 大于 0 的行；watchMainRetention 订阅 retainInfo 后回调只重新 publishMain（dsh-client-ui-session/lib/client.js:913-931）。
4. **新增来源键不会改变官方对主会话的判断。** 观察扫描了 246 个 dsh-client-ui*/experimental-client-ui* 的 .js/.mjs bundle：除包含 .mainView 的行外，没有其它 retainedBy 读取，非 mainView 命中 0 处（.scratch/dshpush/retainedby-scan.js 输出 FILES 246 NON_MAINVIEW_HITS 0）。
5. **会不会阻止会话释放：会阻止浏览器侧这个 generation 的释放与 follow 停止，直到最后一个引用 release。** retireScope 只在 referenceCount 减到 0 时执行；它把 record.live 置 false、从 scopes 删除、unbindScope、manager.drop、projectList、publishRetention（dsh-api-session-controller/lib/types/client/sessions/service.js:459-470）。不 release 就一直保留这个 generation 及历史流；Host Agent 不受这个引用保活（README:82）。
6. **没有文档明确点名「第三方插件可以 retain」。** 可依据的是公开 ISessions 接口（retain/using/retainInfo/binding 都在接口上），以及 README 的「消费方来源键可通过声明合并扩展」。类型层面 SessionReferenceSource 是 SessionReferenceSourceMap 的键，基础 map 只有 controllerOperation 与 gateway；全 asar 没有 mainView/sidebarView 的声明合并，运行时也不校验 source 字符串（dsh-cordis-client-runner/lib/client.js:1921-1923、:2185-2190、:2201-2202；dsh-api-session-controller/README.zh.md:82；dsh-api-session-controller/lib/types/client/sessions/service.js:188-194）。

### 证据（源码原文，节选）

源码：README 对 retain 后果的原文（dsh-api-session-controller/README.zh.md:80-82）

    sessions.retain(target, { source, signal? }) 立即获取一个精确 Client generation 的引用，并启动其共享的首次历史打开。...
    引用保活本地会话数据、作用域 Context 和历史流，不保活 Host Agent。普通 Session 不因保留引用而添加目录行。...
    最后一个引用释放时，generation 先退出可访问映射，再执行清理；后续获取可以为同一 id 创建新 generation。binding(id) 和 scope(id) 只借用已有 generation。retainInfo(id) 独立于目录成员关系观察稳定的只读来源计数，不执行历史 I/O。消费方来源键可通过声明合并扩展；导航和完成确认属于 UI 消费方，不属于本控制器。

源码：publishRetention 把 retainedBy 写进列表行并通知观察者（dsh-api-session-controller/lib/types/client/sessions/service.js:445-458）

    publishRetention(id) {
        const state = this.list.getSnapshot();
        const row = state.byId[id];
        const retainedBy = this.retentionSnapshot(id).retainedBy;
        if (row !== undefined && row.retainedBy !== retainedBy) {
            this.list.set({ ...state, byId: { ...state.byId, [id]: { ...row, retainedBy } } });
        }
        const observer = this.retainObservers.get(id);
        const snapshot = this.retentionSnapshot(id);
        if (observer === undefined || observer.published === snapshot) return;
        observer.published = snapshot;
        notifySubscribers(observer.listeners, '[session-controller] reference sources');
    }

源码：retireScope 只在最后一个引用释放时执行（dsh-api-session-controller/lib/types/client/sessions/service.js:459-470）

    retireScope(id, record, disposeFiber = true) {
        if (!record.live) return;
        record.live = false;
        if (this.scopes.get(id) === record) this.scopes.delete(id);
        record.session.unbindScope();
        const sessionDisposal = this.manager.drop(id, record.session);
        this.projectList();
        this.publishRetention(id);
        this.startScopeDrop(id, record, disposeFiber, sessionDisposal);
    }

源码：官方 ui-session 只看 mainView（dsh-client-ui-session/lib/client.js:913-931）

    publishMain() {
        if (!this.active) return;
        const byId = this.sessions.list.getSnapshot().byId;
        const currentId = this.current.value.key;
        const nextId = currentId !== void 0 && (this.sessions.retainInfo(currentId).getSnapshot().retainedBy.mainView ?? 0) > 0
            ? currentId
            : Object.values(byId).find((candidate) => (candidate.retainedBy.mainView ?? 0) > 0)?.id;
        this.watchMainRetention(nextId);
        const owner = nextId === void 0 ? void 0 : this.sessions.binding(nextId);
        ...
    }
    watchMainRetention(sessionId) {
        if (sessionId === this.mainRetainId) return;
        this.disposeMainRetain();
        this.mainRetainId = sessionId;
        this.disposeMainRetain = sessionId === void 0 ? () => {} : this.sessions.retainInfo(sessionId).subscribe(() => { this.publishMain(); });
    }

源码：ISessions 公开接口（dsh-cordis-client-runner/lib/client.js:1921-1923）

    export interface ISessions {
        readonly list: ObservableSnapshot<SessionListState>;
        retain(target: SessionTarget, options: SessionRetainOptions): SessionReference;
        using<T>(target: SessionTarget, options: SessionRetainOptions, operation: (reference: SessionReference) => T | Promise<T>): Promise<T>;
        retainInfo(id: SessionId): ObservableSnapshot<SessionRetainInfo>;
        ...
        binding(id: SessionId): SessionBinding | undefined;
    }

源码：来源键的类型（dsh-cordis-client-runner/lib/client.js:2185-2190、:2201-2202）

    export type SessionReferenceSource = Extract<keyof SessionReferenceSourceMap, string>;
    export interface SessionReferenceSourceMap {
        controllerOperation: unknown;
        gateway: unknown;
    }
    export interface SessionRetainOptions {
        readonly source: SessionReferenceSource;
        readonly signal?: AbortSignal | undefined;
    }

源码：运行时 retain 不校验 source 字符串（dsh-api-session-controller/lib/types/client/sessions/service.js:188-194）

    retain(target, options) {
        const { source, signal } = options;
        signal?.throwIfAborted();
        if (this.closed) throw new Error('Session Controller is disposed');
        const id = this.manager.resolveTarget(target);
        const reference = this.retainScope(id, source);
        ...
    }

## 核对过的文件清单

> 下表都是 asar 内路径，省略公共前缀 dsh/node_modules/@deepseek-ai/。本次用 .scratch/dshpush/asar.js 按 asar 文件头 offset/size 抽取到 .scratch/dshpush/x/ 与 .scratch/dshpush/sc/，或直接按同样方式读取；行号按抽取文本计。

| asar 内路径 | 核对内容 |
| --- | --- |
| dsh-agent-preset-registry/lib/typert.host.js | SessionEventMap 的 tool/call、StreamChunk、ToolCallBlock 类型 |
| dsh-agent-loop/lib/index.js | appendToolCall 写入工具名与 arguments |
| dsh-session/lib/index.js | append 事件信封、surface 事件集合、validateSessionEventData、appendPluginRecord |
| dsh-llm-deepseek/lib/index.js | tool-call-delta 与 block-end 的实际帧、arguments 序列化 |
| dsh-llm-pi-ai/lib/index.js | toolcall_delta 与 toolcall_end 的实际帧、arguments 序列化 |
| dsh-api-session-controller/lib/client.js | expandAssistantStream、tool-call-chunks 校验、acceptFrame |
| dsh-api-session-controller/lib/types/client/contract/events.js | MutableSessionEventSource 的 subscribe 与同步 publish |
| dsh-api-session-controller/lib/types/client/session-wire-event.js | 事件名与载荷可合并扩展的注释 |
| dsh-api-session-controller/lib/types/client/sessions/service.js | retain、using、ClientSessionReference、retainScope、binding、materializeScope、publishRetention、retireScope |
| dsh-api-session-controller/lib/types/client/sessions/session.js | Session.open 幂等、doOpen 启动 SessionEventStream、eventSource.append |
| dsh-api-session-controller/lib/types/client/sessions/journal-stream.js | remote.$stream follow、open、dispose |
| dsh-api-session-controller/README.zh.md | Client 引用的语义与保活范围、来源键声明合并 |
| dsh-cordis-client-runner/lib/client.js | ISessions、SessionBinding、SessionEventLikeEntry、SessionEventSource、AssistantLiveChunkEvent、SessionReferenceSourceMap |
| dsh-api-remotes/lib/index.js | API_REMOTE_FORWARDED_EVENTS 白名单、remoteEventSource、唯一注册 |
| dsh-api-gateway/lib/index.js | registerRemoteEvents 唯一注册、/api/remote.mux 路由 |
| dsh-api-gateway/lib/client.browser.js | $on 的注册与投递 |
| dsh-host-webserver/lib/index.js | registerUpgrade 精确路径路由、upgrade 分发与鉴权责任 |
| dsh-client-connection/lib/index.js | requestRejection、admit、admitConnection |
| dsh-client-connection/lib/client.browser.js | openConnectionWebSocket、ConnectionHandle.openWebSocket |
| dsh-experimental-inspector/lib/index.js | 自建 /devtools/cdp WebSocket 路由并复用宿主鉴权 |
| dsh-client-hmr/lib/index.js | /plugins/events SSE 端点与 graph/rebuilt 推送 |
| dsh-client-hmr/README.zh.md | /plugins/events 的专用用途 |
| dsh-client-resources/README.zh.md | ctx.resources 的浏览器侧资源共享模型 |
| dsh-client-ui-chat/lib/client.js | toolDefinition.match 与 applyDelta 对 tool-call / live-chunk 的消费 |
| dsh-client-ui-conversation/lib/client.js | binding(source) 借用 sessions.binding 并订阅 eventSource |
| dsh-client-ui-session/lib/client.js | publishMain 只读 retainedBy.mainView、watchMainRetention |
| dsh-client-ui-workspace/lib/client.js | replaceMain 的 mainView retain/release、clearMain |
| dsh-client-ui-sidebar-right/lib/client.js | sidebarView 的 retain |
| dsh-client-ui-subagent/lib/client.js | sidebarChat 的 retain |

## 方法与限制

- 源码读取：按 asar 文件头的 offset/size 抽取文本；没有拿 asar 文件头里的 integrity 摘要逐项比对。
- 全 asar 扫描：.scratch/dshpush/fullscan3.js 与 .scratch/dshpush/bus-scan.js 遍历整棵 asar，扩展名覆盖 .js/.mjs/.cjs/.ts/.mts/.d.ts/.md，跳过超过 8MB 的文件；输出里 SCANNED files 为 13977（树中存在同一文件的多条路径）。
- retainedBy 消费面扫描：.scratch/dshpush/retainedby-scan.js 扫描 246 个 dsh-client-ui*/experimental-client-ui* 的 .js/.mjs，逐行跳过包含 .mainView 的行后统计非 mainView 的 retainedBy 命中，结果为 0。
- 本次没有做运行时实验：没有在浏览器里实际 retain、release 或订阅事件流；上述副作用与生命周期结论均来自源码与包内说明。凡属推理的，已在结论里写明。
