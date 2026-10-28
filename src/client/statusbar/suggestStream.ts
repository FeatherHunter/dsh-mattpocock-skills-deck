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
//   - 增量通路只处理 append：replace 是历史重放（打开旧会话时会把已有事件重放一遍），不当新调用冒泡。
//     例外是 #1526（规格 #1525）的「补出」：挂载后按会话缓存为空时，读一次快照的事件窗口，
//     找最后一条所在轮已收尾的建议补出一组；这是补历史，不是把重放当增量交付。
//   - 补出看整个窗口，不看这一次变更的增量：真机上挂载可能早于窗口装载（先给空快照，装载完成后再
//     用 replace 把整个窗口装进来），也可能会话已经热着、最后一次变更是 append（历史在窗口里，
//     增量里没有）。窗口装载完成时的那一次 replace 会再给一次补出机会，其余 replace 仍不冒泡。
//     来龙去脉见 restoreFromReplay 上的说明（#1420 第五项）。
//   - 交付只看「调用到过、参数完整解析、这一轮已收尾」，不看 turn/end 的结束原因：completed 之外的
//     aborted / error / interrupted 也可能带着完整一组建议（#1420 第三项定下的口径）。
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
 * 按会话留下的建议组最多记多少组：只是防「会话开得极多时集合无界」的下限，超了删最早记入的那组。
 * 不是产品限额，真机上一个人同时开几十个会话的情况很少。
 */
const SUGGEST_GROUP_KEEP_LIMIT = 32
const suggestGroupsBySid: any = new Map()

/**
 * 按会话记下「用户在本进程里点走或关掉过这个会话的建议组」（#1526，规格 #1525）。
 * 为什么要单独留一份：用户关掉之后缓存被清空，下次切回这个会话时「缓存为空」这个条件又会成立，
 * 补出逻辑会把历史重放里的那组建议再补一遍 —— 那等于用户关不掉它。所以关掉时留一个标记，
 * 补出前先看它；这个会话之后又有新建议正常交付时把标记清掉（新建议理应能冒）。
 * 与建议组缓存一样只在内存里、不落盘；超过上限删最早记入的那一个，防会话开得极多时无界。
 */
const suggestDismissedBySid: any = new Set()

/** 记下某个会话的关闭标记（重复关同一个会话只刷新到队尾；超上限删最早记入的）。 */
const suggestMarkDismissed = function (sid: string) {
  if (!sid) return
  suggestDismissedBySid.delete(sid)
  suggestDismissedBySid.add(sid)
  while (suggestDismissedBySid.size > SUGGEST_GROUP_KEEP_LIMIT) {
    const oldest = suggestDismissedBySid.values().next()
    if (oldest.done) break
    suggestDismissedBySid.delete(oldest.value)
  }
}

/** 这个会话在本进程里被用户关掉过没有：补出前查它，是真的关过就不补。 */
export const suggestSessionWasDismissed = function (sid: string) {
  if (!sid) return false
  return suggestDismissedBySid.has(sid)
}

/** 这个会话来了新一组建议并正常上屏：关闭标记失效，之后切回来照常按缓存显示。 */
export const suggestSessionClearDismissed = function (sid: string) {
  if (!sid) return
  suggestDismissedBySid.delete(sid)
}

/**
 * 记下某个会话当前该显示的那一组建议（#1451 后续：建议气泡按会话保留）。
 * 为什么要在本文件里留一份：打开旧会话时平台把历史事件重放成 replace 通知，而本文件只认
 * append 增量（见文件头），所以切回旧会话时历史里那几次建议调用不会再交付一遍 —— 不留这一份，
 * 用户回到旧会话就永远看不到那组气泡了。
 * 只留在内存里、不落盘、不加定时器；同一个会话再记一次就覆盖旧的，并刷新到「最近记入」的队尾；
 * 超过上限删最早记入的那一个。
 */
export const suggestGroupRemember = function (sid: string, group: any) {
  if (!sid || !group) return
  suggestGroupsBySid.delete(sid)
  suggestGroupsBySid.set(sid, group)
  while (suggestGroupsBySid.size > SUGGEST_GROUP_KEEP_LIMIT) {
    const oldest = suggestGroupsBySid.keys().next()
    if (oldest.done) break
    suggestGroupsBySid.delete(oldest.value)
  }
}

/** 取出某个会话留下的那一组建议；没留下过（或已经被用户关掉）返回 null。 */
export const suggestGroupRecall = function (sid: string) {
  if (!sid) return null
  return suggestGroupsBySid.has(sid) ? suggestGroupsBySid.get(sid) : null
}

/**
 * 忘掉某个会话留下的建议：用户点走一条或关掉整组时调用，之后切走再切回也不再冒出来。
 * 同时记下关闭标记：缓存清空后「切回来」会满足补出条件，没有这个标记那组建议会被从历史重放里再补一遍。
 */
export const suggestGroupForget = function (sid: string) {
  if (!sid) return
  suggestGroupsBySid.delete(sid)
  suggestMarkDismissed(sid)
}

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
  // 要不要从历史重放里补出最后一组建议（#1526）：上层在按会话缓存为空时才传 true，
  // 缓存里已有这一组时不补，避免同一组建议出现两次。默认 false，保持 #1409 的取数契约不变。
  const restoreReplay = opts.restoreReplay === true
  const sidHash = suggestHash(sid)

  let disposed = false
  // 事件流是否真的订阅上了：没订上时不补历史（#1409 的契约是「拿不到事件流就安静不做」）。
  let bound = false
  let stop: any = null
  let binding: any = null
  let pending: any = null
  // 补出还欠一次机会：挂载时事件窗口是空的（真机上先给空快照、装载完成后再 replace 装窗）。
  // 置上之后，第一次 replace 到达时再补一次，补完就清掉；之后任何 replace 都不再冒泡（#1409）。
  let replayWaitWindow = false
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

  /**
   * 把这个调用编号记进「已经认过」的集合：返回 false 表示这次是重复到达（同一编号再出现一次）。
   * 补出（restoreFromReplay）与增量通路（takeEvent）共用一份去重：补出过的调用再从增量到达时
   * 不能再交付第二遍。#1411 的「同一条内容再来一次也算新组」指的是两次不同的调用，不是同一编号。
   */
  function markSeen(callId: string) {
    if (seenCalls[callId] === true) return false
    seenCalls[callId] = true
    seenCount += 1
    if (seenCount > SUGGEST_SEEN_LIMIT) {
      for (const key in seenCalls) delete seenCalls[key]
      seenCount = 0
      seenCalls[callId] = true
      seenCount = 1
    }
    return true
  }

  /** 把一批建议交给上层：先清 pending 再回调，回调里抛错也不影响订阅通道。 */
  function deliver(outcome: string, callTurn: any, callId: string, items: any[]) {
    pending = null
    logReady(outcome, callId, callTurn, items.length)
    // 一组新建议正常交付（增量通路送来并上屏）之后，这个会话「关过」的标记就该失效：
    // 用户后来关掉的组不该挡住更晚的新建议，切回来时也要能按缓存把新组找回来。
    if (outcome === 'delivered' || outcome === 'already-ended') suggestSessionClearDismissed(sid)
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
      // 结束原因不参与交付判据（#1420 第三项的口径）：turn/end 的 data.reason 可能是 completed，
      // 也可能是 aborted / error（用户停止、模型报错）或 interrupted（进程崩溃后平台补写的收尾）。
      // 建议工具的调用事件既然到过、参数又完整解析成功，就交出这一组；参数坏的在那一步已经被拒，
      // 所以不会出现半组。改成「只认 completed」的话，中断与报错场景会把完整的一组静默丢掉。
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
    if (!markSeen(callId)) {
      logCall('dup', callId, callTurn, 0, 0, '')
      return
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

  /**
   * 事件流通知：append 是增量，按条认调用；replace 是平台装载或重放整个窗口。
   * 挂载时窗口还是空的（真机上先给空快照、装载完成后再 replace 装窗）时，第一次 replace
   * 要把补出机会还回来；其余 replace 一律不当作新调用冒泡（#1409 的契约）。
   */
  function onChange() {
    if (disposed) return
    let snapshot: any = null
    try { snapshot = binding.eventSource.getSnapshot() } catch (eSnap) { return }
    const change = snapshot && snapshot.change
    if (!change) return
    if (change.kind === 'replace') {
      if (!replayWaitWindow) return
      replayWaitWindow = false
      restoreFromReplay()
      return
    }
    if (change.kind !== 'append') return
    const entries = Array.isArray(change.entries) ? change.entries : []
    for (let i = 0; i < entries.length; i++) {
      if (disposed) return
      const entry = entries[i]
      if (entry && entry.event) takeEvent(entry.event)
    }
  }

  /**
   * 补出（#1526，规格 #1525）：切回一个在后台跑完了一轮的会话时，那组建议从没上过屏
   * （取数层只把 append 增量当新调用），历史在事件流窗口里，只能从快照里找回来。
   * 只补窗口尾部最后一条「所在轮已收尾」的建议调用，更早的一律不补 —— 这样保证
   * 「要么没有、要么完整的一组」：参数不完整（少于 2 条、缺字段）的那条在解析处就被拒，
   * 不会只上屏半组。尾部那一轮还没收尾时不补，改为收下等增量通路送来 turn/end 再正常交付。
   *
   * 为什么扫整个窗口（snapshot.entries）而不是这一次变更的增量（snapshot.change.entries）：
   * 真机上挂载时机有两种。① 打开会话时先拿到空窗口，装载完成后平台再用一次 replace 把整个
   * 窗口装进来 —— 挂载那一刻读到的快照是空的；② 会话已经热着（别的消费者还保活着），最后
   * 一次变更是 append 或 settle-assistant，历史早在窗口里，变更增量里却一个字都没有。
   * 只扫 change.entries 时这两种都补不出来，真机上大多数「切回来没气泡」正是它们（#1420 第五项）。
   *
   * 补出只在两个时机各尝试一次：挂载时；以及挂载时窗口还空、之后第一次 replace 把窗口装进来时
   * （replayWaitWindow 标记）。之后的 replace 一律不再扫，免得把历史重放当新调用冒泡（#1409）。
   * 任何一步失败都安静吞掉，只留能指路的调试日志；读快照不保持订阅、不加定时器。
   */
  function replayEntriesOf(snapshot: any) {
    const entries = snapshot && snapshot.entries
    return Array.isArray(entries) ? entries : []
  }

  /**
   * 扫窗口里的历史，对齐轮次状态，并找出最后一条建议调用（带「它所在轮收尾没有」）。
   * 收尾只看轮次与有没有收到 turn/end，不看结束原因（completed / aborted / error / interrupted
   * 都算收尾，理由见 takeEvent 里 turn-end 那一段）。
   */
  function lastCallOfReplay(entries: any[]) {
    let lastCall: any = null
    let endedTurn: any = null
    let openTurn: any = null
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const info = suggestEventOf(entry && entry.event)
      if (!info) continue
      if (info.kind === 'turn-start') { openTurn = info.turn; continue }
      if (info.kind === 'turn-end') {
        endedTurn = info.turn
        openTurn = null
        // PTC 调用不带轮次，挂在它前面的那一轮上；这一轮的 turn/end 到了就算收尾。
        if (lastCall && !lastCall.closed && (lastCall.turn === null || lastCall.turn <= info.turn)) lastCall.closed = true
        continue
      }
      const callTurn = (info.turn === null || info.turn === undefined) ? openTurn : info.turn
      lastCall = { callId: info.callId, argumentsValue: info.argumentsValue, turn: callTurn, closed: false }
    }
    return { lastCall: lastCall, endedTurn: endedTurn, openTurn: openTurn }
  }

  function restoreFromReplay() {
    if (!restoreReplay || disposed || !sid || !bound) return
    if (!binding || !binding.eventSource || typeof binding.eventSource.getSnapshot !== 'function') return
    // 用户在本进程里点走或关掉过这个会话的组：历史里就算还有，也不补（#1525 认可的边界）。
    if (suggestSessionWasDismissed(sid)) return
    let snapshot: any = null
    try { snapshot = binding.eventSource.getSnapshot() } catch (eSnapshot) { logBind('error', 'restore-snapshot'); return }
    try {
      const entries = replayEntriesOf(snapshot)
      if (!entries.length) {
        // 窗口还没装（真机上打开会话时先给空快照，装载完成后再 replace 一次）：不判死，
        // 等那一次 replace 再补；日志留一条 deferred，真机上才分得清「窗口是空的」与
        // 「扫过窗口但没有建议」。
        replayWaitWindow = true
        logBind('deferred', 'restore-empty')
        return
      }
      // 窗口已经有内容：这一次就是补出机会，之后不再因为任何 replace 重扫。
      replayWaitWindow = false
      const scan = lastCallOfReplay(entries)
      // 把内部轮次状态对齐到历史末尾，之后增量事件照常判断「这轮结束没有」。
      lastEndedTurn = scan.endedTurn
      currentTurn = scan.openTurn
      if (!scan.lastCall) return
      if (!markSeen(scan.lastCall.callId)) return
      const parsed = suggestItemsOf(scan.lastCall.argumentsValue)
      if (!parsed.ok) {
        logCall(parsed.reason === 'bad-shape' ? 'bad-shape' : 'bad-args', scan.lastCall.callId, scan.lastCall.turn, 0, 0, parsed.reason)
        return
      }
      logCall('seen', scan.lastCall.callId, scan.lastCall.turn, parsed.items.length, parsed.clipped, '')
      if (scan.lastCall.closed) {
        deliver('restored', scan.lastCall.turn, scan.lastCall.callId, parsed.items)
        return
      }
      // 尾部这一轮还没收尾：收下等增量通路的 turn/end（同一套 pending 状态，不另立字段）。
      pending = { turn: scan.lastCall.turn, callId: scan.lastCall.callId, items: parsed.items }
      logReady('queued', scan.lastCall.callId, scan.lastCall.turn, parsed.items.length)
    } catch (eRestore) {
      logBind('error', 'restore-scan')
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
    bound = true
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
  // 订阅成功后才读快照：先借上事件流，补完历史之后到达的增量不会漏。
  restoreFromReplay()
  return { dispose: dispose }
}

/**
 * 挂载组件：把 #1409 的取数通路接到 #1411 的建议气泡上。
 * 为什么做成组件而不是写进 StatusBar：StatusBar.ts 已经贴着单文件 350 有效行的粒度红线，
 * 在那里加 useEffect 会超线；这里挂一个组件，状态栏只需要在已有行里加一个子节点。
 * sid 变化（切会话）时 React 会先跑上一轮的清理再建新流 —— 旧订阅退掉、新会话重新借；
 * 新会话只显示它自己留下的那一组建议（切回来时从按会话的缓存里取回，见 suggestGroupRecall）；
 * 缓存里没有时再从历史重放里补出最后一组（#1526）—— 后台跑完、当时没在看的那组建议也能补上；
 * 绝不把上一个会话的建议留在当前会话上；用户显式点走或关掉的组会从缓存里删掉，本次运行内不再补出。
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
  // 切回旧会话时先把它上次留下的那组建议放回来（#1451 后续：气泡按会话保留，切走再回来还在）。
  const groupState = React.useState(function () { return suggestGroupRecall(sid) })
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
    // 换会话时换成这个会话自己留下的那一组：旧会话的建议不能留在新会话上，但切回来要能找回来。
    const cached = suggestGroupRecall(sid)
    setGroup(cached)
    const stream = createSuggestStream({
      sessions: sessionsSvc,
      sid: sid,
      // 缓存里已经有这一组就不补；缓存为空才从历史重放里补出最后一组（#1526，规格 #1525）。
      restoreReplay: !cached,
      onReady: function (items: any) {
        if (!alive) return
        seqRef.current = seqRef.current + 1
        const next = { id: seqRef.current, items: items }
        // 先记进按会话的缓存再上屏：切走再回来时靠它把这组气泡放回原位。
        suggestGroupRemember(sid, next)
        setGroup(next)
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
    onDismiss: function () {
      // 用户点走或关掉的组要连缓存一起忘掉：切走再切回时不该自己复活。
      suggestGroupForget(sid)
      setGroup(null)
    },
  })
}
