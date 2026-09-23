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
import { buildSessionChainReadout, SESSION_CHAIN_FIELD } from './sessionChainReadout.js'
import { createAttention, createFocusHandler } from './attention.js'
// #723（T19c）第 D 件：七个 deck_* 工具。装配口在共享层（createDeckTools 只收参数、不 import 工具文件），
// 七个工厂由 ../platform/deckToolsAssembly.js 一处读进来 —— 为什么收在那一层：宿主层里的文件之间不许
// 互相引用（tests/verify-no-same-layer-import.js 把 src/host/ 整棵树算作宿主层），
// 宿主层里再读一次那七个文件就要新增 7 条同层边，本票不许。见那个文件的文件头与交付报告第 6 节。
import { createDeckToolsForHost, DECK_TOOL_FILES } from '../platform/deckToolsAssembly.js'
// #723（T19c）第 E 件：行级增量那半边（refresh/patch.js）同理收在 src/host/platform/refreshAssembly.js 一处。
import { createPatchForHost } from '../platform/refreshAssembly.js'
import * as budget from '../../shared/refresh/budget.js'
import * as toolCost from '../../shared/refresh/tool-cost.js'

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

/** 短散列：与仓库其它地方同款（只用来在日志与内存表里指代一个工作区，不落路径原文）。 */
function hash8(s) {
  try {
    const t = String(s || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e) { return '00000000' }
}

/**
 * 造宿主入口那一侧**唯一的那一套**刷新机制（调用多少次都只建一次，所有使用者共用同一个实例）。
 *
 * 为什么「唯一」是硬要求而不是省事：闸的活跃集合、写事件的白名单、视野模型、处理链、界面读数这五件
 * 认的是**同一个「当前在看谁」**。宿主要是建了两套（哪怕两套代码一模一样），标活跃标在一套上、
 * 过闸走在另一套上，后台档的 background-inactive 就会把写事件那一笔恒判推迟 —— 生产里看起来谁都在
 * 工作，实际一次都发不出去，而且读数那一边永远空着。（#723 复核抓到的正是这个：入口一处、wf.focus 又一处。）
 */
export function makeRefreshLoader(deps) {
  let load = null
  return async function () {
    if (!load) load = (async function () {
      const w = createRefreshWiring(deps)
      try { w.attach() } catch (eAt) {}
      // 界面读数（e）：快照回包要挂的那个字段由它产出，形状归 refresh/sessionChainReadout.js 一处。
      const chainReadout = function () { return w.chainReadoutOf() }
      // wf.focus 的处理器（c）：用的就是这一套里的视野模型；上报之后把活跃集合同步给白名单与闸。
      const focus = (function () {
        let h = null
        return async function (args) {
          if (!h) h = createFocusHandler({ attention: w.attention, afterReport: function () { return w.syncAttention() } })
          return await h(args)
        }
      })()
      return Object.assign({}, w, { chainReadout: chainReadout, chainField: SESSION_CHAIN_FIELD, focus: focus })
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
  // backendOf 是链要的那个后端名（链只认 github/gitlab/markdown 三个白名单名字，空串会被它丢掉）。
  const writeEvents = d.writeEvents || createWriteEvents({
    gate: gate, fetch: fetchForWriteEvent, canonicalKey: d.canonicalKey, logCtx: logCtx,
    note: function (input) { try { return sessionTickets.note(input) } catch (e) { return null } },
    backendOf: function (rootKey) { return backendOfRoot(rootKey) },
  })

  // c：视野模型。wf.focus 上报「我在看谁」之后，活跃集合就在这里，b 的白名单跟着它走。
  const attention = d.attention || createAttention({ canonicalKey: d.canonicalKey, logCtx: logCtx })

  /**
   * 「这个工作区现在用哪个后端」（#723 T19）：链只认 github / gitlab / markdown 三个白名单名字
   * （src/shared/refresh/chain.js 的 CHAIN_BACKENDS），空串与别的名字都会被它丢掉并说 chain.bad-backend。
   * 两条来源，都不在本文件里另写判定：
   *   ① 宿主既有的后端注册表（reg.describe）—— 用户手动选择那一档；
   *   ② 宿主既有的探测服务（getDetectionService().detect）—— 锚文件那一档（不传 hint、不强制）。
   * 两条都问不出来就如实回空串：让链丢掉并说原因（界面照实说读不到），**不编一个假名字**让它看着能记。
   */
  async function backendOfRoot(rootKey) {
    const cwd = String(rootKey || '')
    if (!cwd) return ''
    try {
      if (typeof d.getTrackerRegistry === 'function') {
        const reg = await d.getTrackerRegistry()
        if (reg && typeof reg.describe === 'function') {
          const info = reg.describe({ cwd: cwd })
          const id = String((info && info.backend) || '')
          if (id) return id
        }
      }
    } catch (e) { /* 往下问探测服务 */ }
    try {
      if (typeof d.getDetectionService === 'function') {
        const svc = await d.getDetectionService()
        if (svc && typeof svc.detect === 'function') {
          const res = await svc.detect({ cwd: cwd }, {})
          const id = String((res && res.selection && res.selection.backendId) || '')
          if (id) return id
        }
      }
    } catch (e2) { /* 问不出来就空串 */ }
    return ''
  }

  /** 界面要的那份读数（e）。挂在快照回包上，界面读不到时它会如实说 ok:false + 代号。 */
  function chainReadoutOf() {
    return buildSessionChainReadout({ tickets: sessionTickets, at: Date.now() })
  }

  // 上一次同步给写事件白名单的那些根（切走的那几个要 forgetRoot）。
  let allowed = []

  /**
   * 把「现在在看哪些工作区根」同步给写事件的白名单（b）与闸的活跃集合（c）——**同一份来源**（视野模型）。
   * 每次 wf.focus 上报之后调一次：新来的进白名单、切走的收摊，两个去处一起改。
   *
   * #723（T19）最关键的一处：闸那边如果没接活跃集合，写事件触发的那一次取数会被**恒判推迟**
   * （policy.js 的 background-inactive：后台档不在活跃集合里就一次都不发）—— 接线看起来接上了、
   * 实际一笔都发不出去。所以这两个去处必须由同一份「当前在看谁」同时喂，钥匙也必须是同一把：
   * writeEvents 过闸时带的 workspaceKey 是它自己的短散列（rootHash，见 writeEvents.js 的 fire），
   * 闸按那把钥匙认活跃集合，所以这里标活跃用的也是 hash8(root)。
   */
  async function syncAttention() {
    let roots = []
    try {
      const st = attention.stateOf()
      roots = (st && Array.isArray(st.active)) ? st.active.map(function (x) { return String(x.root || '') }).filter(Boolean) : []
    } catch (e) { roots = [] }
    for (const root of roots) {
      if (allowed.indexOf(root) < 0) { try { await writeEvents.allowRoot(root) } catch (eA) {} }
      try { gate.setWorkspace(hash8(root), { active: true }) } catch (eG) {}
    }
    for (const root of allowed) {
      if (roots.indexOf(root) < 0) {
        try { writeEvents.forgetRoot(root) } catch (eF) {}
        try { gate.setWorkspace(hash8(root), { active: false }) } catch (eG2) {}
      }
    }
    allowed = roots
    return roots
  }

  /** 一个工作区现在算不算活跃（闸裁决的输入之一：不在活跃集合里的后台档一次都不发）。 */
  function noteWorkspaceActive(root, active) {
    // 与 syncAttention 用同一把钥匙（hash8(root)）：散列层级不同就会让活跃集合里那一格认不出来，
    // 于是这条路上的每一笔都被判「推迟」（#723 复核抓到的那个「接上了却没走通」）。
    try { return gate.setWorkspace(hash8(String(root || '')), { active: !!active }) } catch (e) { return null }
  }

  /** b 真订阅。宿主入口在 apply 里调一次（attach 要一个 ctx）。 */
  function attach() {
    let detach = function () {}
    try { const r = writeEvents.attach(d.ctx); if (r && typeof r.detach === 'function') detach = r.detach } catch (e) {}
    return { detach: detach }
  }

  // ── D（#723 T19c）：七个 deck_* 工具在宿主里装起来 ─────────────────────────────────────────
  // 把七个工具工厂交给共享层装配口 createDeckTools，并把它要的依赖如实给全：gate（本文件造的那一个闸）、
  // registry（后端注册表，选后端走它的三级联）、budget 与 estimate/costInputFrom（额度与算账两件）、
  // handleFor（会话→注册表里绑过的真实句柄）、backendCtx（platform / fs / exec，exec 走 platformChannel
  // 的 detectionExec，也就是起进程那一层）、invalidate（写后作废那个工作区的快照缓存）、hourUsage（问账本）。
  // planStore 没有注入：批量建图的中间态因此退回进程内存，工具会在返回值里如实说 durable:false。
  let deckToolsP = null
  async function deckToolsForHost() {
    if (!deckToolsP) {
      deckToolsP = (async function () {
        const empty = { tools: {}, names: [], definitions: [], missing: [], reason: '', files: DECK_TOOL_FILES }
        let registry = null
        try { registry = d.getTrackerRegistry ? await d.getTrackerRegistry() : null } catch (eR) { registry = null }
        if (!registry || typeof registry.select !== 'function') return Object.assign({}, empty, { reason: 'no-registry' })
        let platform = null
        try { platform = d.getPlatform ? await d.getPlatform() : null } catch (eP) { platform = null }
        // 后端 ctx 一次取好、之后每笔调用复用同一份：壳按调用同步取它，所以这里不能给一个异步函数。
        const backendObj = {
          platform: platform,
          fs: (function () { try { return (d.ctx && typeof d.ctx.get === 'function') ? d.ctx.get('fs') : undefined } catch (e) { return undefined } })(),
          exec: function () {
            if (typeof d.detectionExec === 'function') { try { return d.detectionExec.apply(null, arguments) } catch (e) { return Promise.reject(e) } }
            return Promise.resolve({ ok: false, kind: 'env', error: '这个宿主实例没有把起进程的出口（detectionExec）传进来，远端后端的读写做不了' })
          },
          logEvent: function (level, event, fields) { try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire(level, event, fields) } catch (e) {} },
          isEnabled: function (level) { try { return logCtx ? logCtx.isEnabled(level) : (level === 'error' || level === 'warn') } catch (e) { return level === 'error' || level === 'warn' } },
        }
        const built = createDeckToolsForHost({
          gate: gate,
          registry: registry,
          budget: budget,
          estimate: toolCost.estimateToolCost,
          costInputFrom: toolCost.toolCostInputFrom,
          handleFor: function (s) {
            try {
              const list = (typeof registry.allBindings === 'function') ? registry.allBindings() : []
              for (let i = 0; i < list.length; i++) if (list[i] && list[i].cwd === s.cwd) return list[i].handle
            } catch (e) { /* 拿不到绑定就用会话里的目录兜底（select 会落到 matches 那一档） */ }
            return { cwd: s.cwd }
          },
          backendCtx: function () { return backendObj },
          invalidate: function (info) {
            // 写成功之后把那个工作区的快照缓存作废（下一次打开面板重建）；与 wf.commentIssue 同一语义。
            try {
              const root = (info && info.workspace && info.workspace.root) || (info && info.cwd)
              if (typeof d.setCache === 'function' && root) d.setCache({ ts: 0, snapshot: null, error: null, cwd: String(root) })
            } catch (e) { /* 缓存失效失败不影响已经写成的结果 */ }
          },
          hourUsage: function () { try { return ledger.hourOf('ai-tool') || {} } catch (e) { return {} } },
          log: logCtx || null,
          // #723（T19c）：工作区键用与活跃集合同一把短散列（hash8(root)）——**不许**在这里用别的归一
          // （散列层级不同、长度不同、空串，都会让闸里那一格从来不是活跃，于是每一笔都被判推迟；
          // 这一条有门禁盯着：tests/verify-deck-tools-host-wiring.js 与 verify-delta-wiring.js）。
          workspaceKeyOf: function (cwd) { return hash8(String(cwd || '')) },
          now: Date.now,
        })
        return Object.assign({ reason: '', files: DECK_TOOL_FILES }, built)
      })().catch(function () { return { tools: {}, names: [], definitions: [], missing: [], reason: 'assembly-failed', files: DECK_TOOL_FILES } })
    }
    return await deckToolsP
  }

  // ── E（#723 T19c）：行级增量真的能在宿主里跑起来 ────────────────────────────────────────────
  // 以前探测到变化之后没人去跑 refresh/patch.js，客户端只能整池重建（那条窄路白写）。现在它在这里
  // 装起来，由 wf.probe 那条路在「探测说变了」之后调用。依赖由宿主入口显式传入：readSnapshot /
  // writeSnapshot 读写的就是宿主那份快照缓存与磁盘缓存（与客户端看到的列表是同一份），
  // send / decide 是闸的两半，读路径的账与裁决一个字都另不算。
  let patchRunner = null
  function patchOf() {
    if (!patchRunner) {
      patchRunner = createPatchForHost({
        readSnapshot: function (cwd) { try { const e = (typeof d.getCache === 'function') ? d.getCache(cwd) : null; return (e && e.snapshot) ? e.snapshot : null } catch (eR) { return null } },
        writeSnapshot: async function (cwd, snap) {
          try { if (typeof d.setCache === 'function') d.setCache({ ts: Date.now(), snapshot: snap, error: null, cwd: cwd }) } catch (eW) {}
          try { const repo = await d.getRepoKey(cwd); if (repo && typeof d.writeDiskCache === 'function') await d.writeDiskCache(repo, snap) } catch (eD) {}
        },
        indexOfSnapshot: function (snap) { return (typeof d.issueIndexFromSnapshot === 'function') ? d.issueIndexFromSnapshot(snap) : {} },
        probeIndex: function (cwd, sinceIso) { return (typeof d.fetchIssueIndex === 'function') ? d.fetchIssueIndex(cwd, sinceIso) : Promise.resolve({ ok: false }) },
        getRepoKey: function (cwd) { return (typeof d.getRepoKey === 'function') ? d.getRepoKey(cwd) : Promise.resolve(null) },
        runGh: function (args2, cwd) { return (typeof d.runGh === 'function') ? d.runGh(args2, cwd) : Promise.resolve({ ok: false, error: 'no-runGh' }) },
        send: function (req, perform) { return gate.send(req, perform) },
        decide: function (req) { return gate.decideFor(req) },
        // 与活跃集合、写事件白名单同一把短散列（见 syncAttention）：不一致的后果是探测这一条路
        // 每一笔都被判「推迟」——门禁里的「真的放行过」那条断言会当场抓住。
        workspaceKeyOf: function (cwd) { return hash8(String(cwd || '')) },
        now: Date.now,
        logCtx: logCtx,
      })
    }
    return patchRunner
  }

  /**
   * 跑一次行级增量，回 patch.run 的原话（见 refresh/patch.js 文件头那一张表）。
   * 只在两条依赖齐了才跑（跑 gh 的出口与探测索引的出口）——缺任何一个都如实回 failed，
   * 让调用方照旧走整池那条老路，绝不假装补过。
   */
  async function deltaRefresh(cwd, opts) {
    if (typeof d.runGh !== 'function' || typeof d.fetchIssueIndex !== 'function') return { mode: 'failed', reason: 'no-transport' }
    try { return await patchOf().run(cwd, opts || {}) } catch (e) { return { mode: 'failed', reason: 'patch-threw' } }
  }

  /** 切进一个工作区那一下要问的事（有待办就整池、并清待办）。 */
  async function deltaEnter(cwd) {
    if (typeof d.getCache !== 'function') return { mode: 'use-cache', reason: 'no-cache-port' }
    try { return await patchOf().enterWorkspace(cwd) } catch (e) { return { mode: 'use-cache', reason: 'patch-threw' } }
  }

  return {
    ledger: ledger,
    gate: gate,
    writeEvents: writeEvents,
    sessionTickets: sessionTickets,
    attention: attention,
    hash8: hash8,
    chainReadoutOf: chainReadoutOf,
    deckToolsForHost: deckToolsForHost,
    deltaRefresh: deltaRefresh,
    deltaEnter: deltaEnter,
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
