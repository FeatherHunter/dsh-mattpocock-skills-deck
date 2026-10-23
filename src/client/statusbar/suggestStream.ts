// src/client/statusbar/suggestStream.ts —— 「下一步建议」取数通路里的订阅层（#1409）
//
// 职责：借官方对话界面已经保持着的会话事件流（sessions.binding(sid).eventSource）只读订阅，
// 认出建议工具的调用（原生预设是 tool/call，PTC 预设是 tool/ptc-dispatch-start），等同一轮
// turn/end 之后把解析好的建议清单交给上层（onReady），并挂成一个组件交给状态栏；#1411 起这个
// 组件把建议交给状态胶囊上方的气泡去渲染。
//
// 硬约束（票面与平台契约）：
//   - 只借不保：绝不调用会话服务里那几个保活接口（retain、保活作用域、using 一律不碰）。保持订阅
//     会改引用计数、把会话生命周期攥在插件手里，那是宿主的事。
//   - 不新增常驻定时器、不订阅会话列表：等「整轮结束」靠 turn/end 事件，不靠计时器猜。
//   - 拿不到事件流就安静不做，只留一条能指路的调试日志；整条路任何一步失败都吞掉，不影响界面。
//   - 只处理 append 增量：replace 是历史重放（打开旧会话时会把已有事件重放一遍），不冒泡。
//
// 契约（与仓库其它叶子文件同一套，见 scripts/build.mts 里的叶子清单）：
//   模块真源是 ESM 导出，构建时剥掉行首 export 拼进 apply 闭包；运行时不许跨文件 import，
//   跨文件的纯函数与内核函数一律用下面的 declare 声明；不许 export default；只写可剥离的 TypeScript。

declare const SUGGEST_TOOL_NAME: any;
declare function suggestHash(...args: any[]): any;
declare function suggestClipText(...args: any[]): any;
declare function suggestItemsOf(...args: any[]): any;
declare function suggestEventOf(...args: any[]): any;
declare function isEnabled(...args: any[]): any;
// #1411：建议气泡的渲染薄壳（由相邻叶子提供，构建时按 index.ts 的标记次序拼在本文件之前）。
declare const SuggestBubble: any;

/** 已认出的调用编号最多记多少条：只是防「对话极长时集合无界」的下限，超了整清一次再记。 */
const SUGGEST_SEEN_LIMIT = 500

/**
 * 造一条取数流：借当前会话的事件流，认建议工具调用，等整轮结束再交付。
 * options = { sessions, sid, onReady }；sessions 是平台 sessions 服务（可能为空），
 * onReady(items) 是上层接缝（#1411 的界面渲染），这里不关心它做什么。
 * 返回 { dispose }：切会话或卸载时调用，退订并清空中间状态；重复调用无副作用。
 */
export const createSuggestStream = function (options: any) {
  const opts = (options && typeof options === 'object') ? options : {}
  const sessions = opts.sessions
  const sid = (typeof opts.sid === 'string') ? opts.sid : ''
  const onReady = (typeof opts.onReady === 'function') ? opts.onReady : null
  const sidHash = suggestHash(sid)

  let disposed = false
  let stop: any = null
  let binding: any = null
  let pending: any = null
  let lastEndedTurn: any = null
  // PTC 预设的派发事件本身不带轮次，只能跟着 turn/start 走：记下当前这一轮的编号，
  // 给那些事件补轮次。原生 tool/call 自带轮次，不依赖它。
  let currentTurn: any = null
  let seenCount = 0
  const seenCalls: any = {}

  /** 借事件流这一趟的结论：bound 借到了；其余是按哪一步失败的指路码。 */
  function logBind(outcome: string, reason: string) {
    try {
      if (typeof isEnabled === 'function' && isEnabled('debug')) {
        log('debug', 'suggest.bind', { outcome: outcome, sidHash: sidHash, reason: reason || '' })
      }
    } catch (eLogBind) {}
  }

  /** 认出一条调用（含去重与参数解析结论）：seen 收下待整轮结束；dup 是同一编号的重复；其余是丢弃原因。 */
  function logCall(outcome: string, callId: string, callTurn: any, itemCount: number, clipped: number, reason: string) {
    try {
      if (typeof isEnabled === 'function' && isEnabled('debug')) {
        log('debug', 'suggest.call', { outcome: outcome, sidHash: sidHash, callIdHash: suggestHash(callId), turn: callTurn, items: itemCount, clipped: clipped, reason: reason || '' })
      }
    } catch (eLogCall) {}
  }

  /** 交付这一趟的结论：queued 是收到、在等整轮结束；delivered 是等到了；already-ended 是整轮早就结束、当场交付。 */
  function logReady(outcome: string, callId: string, callTurn: any, itemCount: number) {
    try {
      if (typeof isEnabled === 'function' && isEnabled('debug')) {
        log('debug', 'suggest.ready', { outcome: outcome, sidHash: sidHash, callIdHash: suggestHash(callId), turn: callTurn, items: itemCount })
      }
    } catch (eLogReady) {}
  }

  /** 把一批建议交给上层：先清 pending 再回调，回调里抛错也不影响订阅通道。 */
  function deliver(outcome: string, callTurn: any, callId: string, items: any[]) {
    pending = null
    logReady(outcome, callId, callTurn, items.length)
    try { if (onReady) onReady(items) } catch (eDeliver) {}
  }

  /** 处理一条事件：建议工具调用先记下等整轮结束；turn/end 到了再交付这一轮最后那条。 */
  function takeEvent(event: any) {
    const info = suggestEventOf(event)
    if (!info) return
    if (info.kind === 'turn-start') {
      currentTurn = info.turn
      return
    }
    if (info.kind === 'turn-end') {
      lastEndedTurn = info.turn
      currentTurn = null
      // PTC 调用可能是在界面挂载时这一轮已经开始了（没看到 turn/start），那时轮次补不出来；
      // 只要它是在这条 turn/end 之前收到的，就属于这一轮，照常交付。
      if (pending && (pending.turn === null || pending.turn <= info.turn)) {
        const job = pending
        deliver('delivered', job.turn, job.callId, job.items)
      }
      return
    }
    const callId = info.callId
    // 原生 tool/call 自带轮次；PTC 的派发事件没有，用当前轮次补上；都补不出来就记 null，等 turn/end 收尾。
    const callTurn = (info.turn === null || info.turn === undefined) ? currentTurn : info.turn
    if (seenCalls[callId] === true) {
      logCall('dup', callId, callTurn, 0, 0, '')
      return
    }
    seenCalls[callId] = true
    seenCount += 1
    if (seenCount > SUGGEST_SEEN_LIMIT) {
      for (const key in seenCalls) delete seenCalls[key]
      seenCount = 0
      seenCalls[callId] = true
      seenCount = 1
    }
    const parsed = suggestItemsOf(info.argumentsValue)
    if (!parsed.ok) {
      logCall(parsed.reason === 'bad-shape' ? 'bad-shape' : 'bad-args', callId, callTurn, 0, 0, parsed.reason)
      return
    }
    logCall('seen', callId, callTurn, parsed.items.length, parsed.clipped, '')
    if (callTurn !== null && lastEndedTurn !== null && callTurn <= lastEndedTurn) {
      deliver('already-ended', callTurn, callId, parsed.items)
      return
    }
    // 同一轮里出现第二条建议调用时以后来的为准（票面④）：模型可能在一次回复里重调工具。
    pending = { turn: callTurn, callId: callId, items: parsed.items }
    logReady('queued', callId, callTurn, parsed.items.length)
  }

  /** 事件流通知：只认 append 增量；replace 是打开旧会话时的历史重放，不能当新调用冒泡。 */
  function onChange() {
    if (disposed) return
    let snapshot: any = null
    try { snapshot = binding.eventSource.getSnapshot() } catch (eSnap) { return }
    const change = snapshot && snapshot.change
    if (!change || change.kind !== 'append') return
    const entries = Array.isArray(change.entries) ? change.entries : []
    for (let i = 0; i < entries.length; i++) {
      if (disposed) return
      const entry = entries[i]
      if (entry && entry.event) takeEvent(entry.event)
    }
  }

  /** 借事件流：任何一步拿不到就记一条指路日志后安静返回（界面不做任何事）。 */
  function start() {
    if (!sessions || typeof sessions.binding !== 'function') { logBind('no-service', ''); return }
    if (!sid) { logBind('no-session', ''); return }
    try { binding = sessions.binding(sid) } catch (eBind) { binding = null; logBind('error', 'binding'); return }
    if (!binding) { logBind('no-binding', ''); return }
    const source = binding.eventSource
    if (!source || typeof source.subscribe !== 'function' || typeof source.getSnapshot !== 'function') {
      logBind('no-event-source', '')
      return
    }
    try { stop = source.subscribe(onChange) } catch (eSub) { stop = null; logBind('error', 'subscribe'); return }
    logBind('bound', '')
  }

  function dispose() {
    if (disposed) return
    disposed = true
    pending = null
    lastEndedTurn = null
    currentTurn = null
    for (const key in seenCalls) delete seenCalls[key]
    seenCount = 0
    const stopFn = stop
    stop = null
    if (typeof stopFn === 'function') {
      try { stopFn() } catch (eStop) {}
    }
  }

  start()
  return { dispose: dispose }
}

/**
 * 挂载组件：把 #1409 的取数通路接到 #1411 的建议气泡上。
 * 为什么做成组件而不是写进 StatusBar：StatusBar.ts 已经贴着单文件 350 有效行的粒度红线，
 * 在那里加 useEffect 会超线；这里挂一个组件，状态栏只需要在已有行里加一个子节点。
 * sid 变化（切会话）时 React 会先跑上一轮的清理再建新流 —— 旧订阅退掉、新会话重新借；
 * 同时清掉上一组建议，绝不让旧会话的建议留在新会话上。
 * 本组件自身不读会话、不 retain：取数只走 createSuggestStream 里那条只读订阅。
 */
export const SuggestStreamMount = function (props: any) {
  const sid = (props && props.sid) ? String(props.sid) : ''
  const cx = React.useContext(DswsCtx)
  // 状态栏的同一份会话 store：气泡点选时要把提示词交给既有注入口子（kernel:api-io 的 inject）。
  let st: any = null
  try {
    st = (cx && cx.storeSvc && typeof cx.storeSvc.useStore === 'function') ? cx.storeSvc.useStore(sid) : null
  } catch (eStore) { st = null }
  const groupState = React.useState(null)
  const group = groupState[0]
  const setGroup = groupState[1]
  // 每一组给一个递增编号：同一条内容再来一次也算新组，保证界面能重挂（第二组覆盖第一组）。
  const seqRef = React.useRef(0)
  React.useEffect(function () {
    if (!sid) return undefined
    let alive = true
    let sessionsSvc: any = null
    try {
      sessionsSvc = (cx && cx.ctx && typeof cx.ctx.get === 'function') ? cx.ctx.get('sessions') : null
    } catch (eSvc) { sessionsSvc = null }
    // 换会话先清掉上一组：旧会话的建议不能留在新会话上。
    setGroup(null)
    const stream = createSuggestStream({
      sessions: sessionsSvc,
      sid: sid,
      onReady: function (items: any) {
        if (!alive) return
        seqRef.current = seqRef.current + 1
        setGroup({ id: seqRef.current, items: items })
      },
    })
    return function () {
      alive = false
      try { stream.dispose() } catch (eDispose) {}
    }
  }, [sid])
  if (!group) return null
  return React.createElement(SuggestBubble, {
    st: st,
    sid: sid,
    group: group,
    onDismiss: function () { setGroup(null) },
  })
}
