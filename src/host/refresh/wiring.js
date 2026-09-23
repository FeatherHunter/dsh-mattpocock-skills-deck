// src/host/refresh/wiring.js —— 刷新机制的宿主接线（#723 T19）
//
// 这个文件只做一件事：把刷新机制那几件已经落库的东西**在宿主里真的装起来**，并交回去。
// 它自己不判断任何业务：闸与账本是 refresh/gate.js 与 ledger.js 的产物，写事件订阅是
// refresh/writeEvents.js 的产物，会话↔票处理链是 refresh/sessionTickets.js 的产物，
// 界面读数由 refresh/sessionChainReadout.js 拼 —— 这里只把它们之间的依赖接上。
//
// 为什么单开一个文件而不是写在 src/host/index.js 里：那个文件贴着 350 行上限（tests/verify-file-granularity.js
// 的零增长基线），#723 起不许再往里加行。宿主入口只留一行加载这个模块（与既有 25 处同层先例同形）。
//
// 装起来的四件（票面 3a/3b/3c/3e）：
//   a 闸与账本：createLedger + createGate，send 真的被调用（后面几件取数都经它）；
//   b 写事件订阅：createWriteEvents(...).attach(ctx)，活跃集合变化时 allowRoot / 切走时 forgetRoot；
//   c 视野模型：wf.focus 那一份「当前在看谁」就是这里的唯一来源（syncAttention 读它）；
//   e 会话↔票处理链：createSessionTickets() 真的建起来，并把界面读数交给快照回包。
//
// 日志：本文件不新增事件。它调到的每一个模块各自记自己那几行（闸的 refresh.decide / refresh.skipped、
// 账本的 quota.spend、写事件的 write.event、处理链的 sessionTickets.chain）。
import { createLedger } from './ledger.js'
import { createGate } from './gate.js'
import { createWriteEvents } from './writeEvents.js'
import { createSessionTickets } from './sessionTickets.js'
import { buildSessionChainReadout } from './sessionChainReadout.js'
import { createAttention } from './attention.js'

/** 把一堆依赖包装成「取一次、以后复用」的惰性实例（模块加载失败不许把整个插件带崩）。 */
function once(fn) {
  let box = { done: false, value: null }
  return function () {
    if (!box.done) {
      box.done = true
      try { box.value = fn() } catch (e) { box.value = null }
    }
    return box.value
  }
}

/**
 * 造宿主入口那一侧的加载器（一次加载、之后复用）。宿主入口（src/host/index.js）贴着 350 行上限，
 * 所以「动态 import 这个模块 + 把依赖传进去 + attach」那三行也收在这里，入口只留一行。
 */
export function makeRefreshLoader(deps) {
  let load = null
  return async function () {
    if (!load) load = (async function () {
      const w = createRefreshWiring(deps)
      try { w.attach() } catch (eAt) {}
      // 宿主入口那一侧拿到的对象多一样「界面读数」（e）：快照回包要挂的那个字段由它产出，
      // 形状归 refresh/sessionChainReadout.js 一处，入口不自己拼。
      return Object.assign({}, w, { chainReadout: function () { return w.chainReadoutOf() } })
    })()
    return await load
  }
}

/**
 * 装一套刷新机制。deps 由宿主入口显式传入（本文件不 import 宿主同层的模块，除本目录这几个）：
 *   ctx            宿主上下文（写事件订阅要 ctx.on）
 *   logCtx         宿主日志出口（{ fire, isEnabled }）
 *   canonicalKey   会话目录 → 工作区键的既有出口（src/host/repoKeys.js 的 canonicalKey）
 *   runGh / execProc / getRepoKey / getCacheDir / readDiskCache / writeDiskCache / getTrackerRegistry / getPlatform
 *                  宿主既有出口，交给各件跑腿用
 *   trackerRegistry 可选：后端注册表（七个 deck 工具的壳要用它选后端）
 *   gate / ledger  可选：已经造好的闸与账本（门禁与单测里注入用）；不给就现场造
 *
 * 回包：{ ledger, gate, writeEvents, sessionTickets, attention, chainReadoutOf, noteWorkspaceActive,
 *        makeFetch, attach, stats }
 */
export function createRefreshWiring(deps) {
  const d = deps || {}
  const logCtx = d.logCtx || null

  const ledger = d.ledger || createLedger({ logCtx: logCtx })
  const gate = d.gate || createGate({ ledger: ledger, logCtx: logCtx })

  // 写事件触发的那一次取数（b）：闸放行之后真去做的那一步。这里现在只报「这一次真的跑到了」，
  // 真去取行级增量（refresh/patch.js 的 run）那一条由 T18/patch 那一批接（见交付报告的「不确定」一节）。
  async function fetchForWriteEvent(step, meta) {
    return { requests: 0, points: 0 }
  }

  // e：会话↔票处理链。喂数据的是 b 那条订阅（工具结果一到就 note 一笔），读数是下面那个读数。
  const sessionTickets = d.sessionTickets || createSessionTickets({
    getCacheDir: d.getCacheDir, logCtx: logCtx,
  })

  // b：写事件订阅。订阅面是整个 DSH，门前砌的是「归我们的工作区根」白名单（见 writeEvents.js 文件头）。
  // #723（T19）：把 handle 里判定过的那一笔喂给处理链（note），界面才有东西可读 —— 喂数据与读数是
  // 同一个订阅的两头，只接一头会让界面恒显示「取到了、空的」（那比如实说「读不到」更坏）。
  const writeEvents = d.writeEvents || createWriteEvents({
    gate: gate, fetch: fetchForWriteEvent, canonicalKey: d.canonicalKey, logCtx: logCtx,
    note: function (input) { try { return sessionTickets.note(input) } catch (e) { return null } },
  })

  // c：视野模型。wf.focus 上报「我在看谁」之后，活跃集合就在这里，b 的白名单跟着它走。
  const attention = d.attention || createAttention({ canonicalKey: d.canonicalKey, logCtx: logCtx })

  /** 界面要的那份读数（e）。挂在快照回包上，界面读不到时它会如实说 ok:false + 代号。 */
  function chainReadoutOf() {
    return buildSessionChainReadout({ tickets: sessionTickets, at: Date.now() })
  }

  // 上一次同步给写事件白名单的那些根（切走的那几个要 forgetRoot）。
  let allowed = []

  /**
   * 把「现在在看哪些工作区根」同步给写事件的白名单（b 与 c 用的是同一份来源，取自视野模型）。
   * 每次 wf.focus 上报之后调一次：新来的进白名单、切走的收摊。
   */
  async function syncAttention() {
    let roots = []
    try {
      const st = attention.stateOf()
      roots = (st && Array.isArray(st.active)) ? st.active.map(function (x) { return String(x.root || '') }).filter(Boolean) : []
    } catch (e) { roots = [] }
    for (const root of roots) {
      if (allowed.indexOf(root) < 0) { try { await writeEvents.allowRoot(root) } catch (eA) {} }
    }
    for (const root of allowed) {
      if (roots.indexOf(root) < 0) { try { writeEvents.forgetRoot(root) } catch (eF) {} }
    }
    allowed = roots
    return roots
  }

  /** 一个工作区现在算不算活跃（闸裁决的输入之一：不在活跃集合里的后台档一次都不发）。 */
  function noteWorkspaceActive(root, active) {
    try { return gate.setWorkspace(String(root || ''), { active: !!active }) } catch (e) { return null }
  }

  /** b 真订阅。宿主入口在 apply 里调一次（attach 要一个 ctx）。 */
  function attach() {
    let detach = function () {}
    try { const r = writeEvents.attach(d.ctx); if (r && typeof r.detach === 'function') detach = r.detach } catch (e) {}
    return { detach: detach }
  }

  return {
    ledger: ledger,
    gate: gate,
    writeEvents: writeEvents,
    sessionTickets: sessionTickets,
    attention: attention,
    chainReadoutOf: chainReadoutOf,
    syncAttention: syncAttention,
    noteWorkspaceActive: noteWorkspaceActive,
    attach: attach,
    once: once,
    stats: function () {
      const out = { gate: null, writeEvents: null, sessionTickets: null, allowedRoots: allowed.length }
      try { out.gate = gate.stats() } catch (e) {}
      try { out.writeEvents = writeEvents.stats() } catch (e) {}
      try { out.sessionTickets = sessionTickets.stats() } catch (e) {}
      return out
    },
  }
}
