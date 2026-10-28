#!/usr/bin/env node
// tests/verify-1626-cold-start-chain.ts —— 门禁：冷启动第一条链求值要等 selection 落定（#1626）
//
// 守的是什么（#1626，发现于 #1474 的真机验收）：
//   冷启动、客户端链缓存为空、工作区已绑 GitHub 时，状态栏挂载先发链求值；而「这个工作区用哪个后端」
//   那条专用电话（wf.selection）还没回来，于是请求带着空 backendId 发出。selection 落定后链键里的
//   backendId 变成 github，空键那份回包被 _chainRespStale 按「键变了」判过期丢掉；丢掉之后没有任何补问
//   （#1474 的自动复查入口要求快照里已经有 pending 步，而快照本身没到手时为假）。结果是黄条要等下一次
//   链事件（例如打开面板）才出现。
//
// 本门禁量五件事（都是把真源码装进沙箱跑出来的结果，不读「源码里有没有某个字」）：
//   A 推迟：冷启动首帧 loadChain 不带着空 backendId 发链求值，而是先催一次 wf.selection，把这次求值记下来
//   B 补发：wf.selection 回包落定后恰好补发一次，请求日志里的 backendId 是 github、原因是 selection-resolved
//   C 不重复：等待期间再挂载一路（第二次 loadChain）也只补发一次；日志里没有空键请求、没有 stale 回包
//   D 兜底：wf.selection 回失败 / 显式「没有后端」/ 叶子沙箱里没有 selection 模块时，都照旧能求值一次、不吊死
//   E 回归：selection 已在手上时照旧立刻发，不多问 wf.selection；快照到手后 #1474 的入口（chainPendingOf）照旧为真
//
// 门禁归属: src/refresh/rooms/client/probe-chain-subscription.ts
// 门禁归属: src/refresh/rooms/client/probe-scope-selection.ts
//
// 用法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1626-cold-start-chain.ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs } from './lib/source-text.ts'

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))

let failed = false
let total = 0
const check = function (cond: boolean, msg: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('  PASS ' + msg); return }
  failed = true
  console.log('  FAIL ' + msg + (detail === undefined ? '' : ' — ' + String(detail).slice(0, 400)))
}
const sleep = function (ms: number): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}
// 从真源里按花括号配平切一个函数体（与 tests/verify-693-detail-fallback-honesty.ts 的 extractFn 同一手法）
function extractFn (src: string, header: string): string {
  let i = src.indexOf(header)
  if (i < 0) {
    const loose = new RegExp(header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'))
    const m = loose.exec(src)
    if (m) i = m.index
  }
  if (i < 0) throw new Error('真源里找不到：' + header)
  let depth = 0
  let started = false
  for (let k = i; k < src.length; k++) {
    const ch = src[k]
    if (ch === '{') { depth++; started = true } else if (ch === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1) }
  }
  throw new Error('函数体没有闭合：' + header)
}

const CWD = 'D:\\ws1626'
const SID = 'sid-1626'
// 网络不可达时宿主那份「求值过了、但有一条暂时确认不了」的回包（只要有 pending 就能接上 #1474 的自动复查）
const SNAP_PENDING = {
  steps: [
    { id: 'repo:bound', status: 'done' },
    { id: 'gh:authed', status: 'pending' },
  ],
  generatedMs: 1,
  version: 'v1',
}
const wsKeyOf = function (p: unknown): string { return p ? 'ws:' + String(p).replace(/\\/g, '/').toLowerCase() : '' }
const getChainCacheKey = function (ws: string, bid: string, lang: string): string { return ws + '|' + bid + '|' + lang }

type Mode = 'github' | 'none' | 'fail' | 'reject' | 'manual'
type World = {
  host: any
  logs: any[]
  chainCalls: any[]
  chainResolvers: any[]
  selectionCalls: any[]
  chainMod: any
  finishSelection: (sel: any) => void
}
// 链那一片整片求值；askSelectionOnce 用晚绑定代理：真闭包里它是同一个名字，这里等 selection 那半边建好再指过去。
function buildChainModule (sandbox: any): any {
  const names = Object.keys(sandbox)
  const tail = '\n;return { loadChain, chainPendingOf, chainEventRefresh, _chainKeyOfState, maybeAutoRetryChain, CHAIN_EVENT_REASONS }'
  const factory = compileFn(names, spliceableJs('src/refresh/rooms/client/probe-chain-subscription.js') + tail)
  return factory.apply(null, names.map(function (n) { return sandbox[n] }))
}
function makeWorld (mode: Mode): World {
  const w: any = { logs: [], chainCalls: [], chainResolvers: [], selectionCalls: [], finishSelection: null }
  const logFn = function (level: string, event: string, fields: any): void { w.logs.push({ level: level, event: event, fields: fields || {} }) }
  const hashFn = function (s: unknown): string { return 'h' + String(s === undefined || s === null ? '' : s).length }
  const truncFn = function (s: unknown): string { return String(s === undefined || s === null ? '' : s).slice(0, 120) }
  const emitFn = function (): void {}
  w.logFn = logFn
  w.host = {
    call: function (method: string, args: any): any {
      if (method === 'wf.chain') {
        w.chainCalls.push(args || {})
        return new Promise(function (resolve: any) { w.chainResolvers.push(resolve) })
      }
      if (method === 'wf.selection') {
        w.selectionCalls.push(args || {})
        if (mode === 'manual') return new Promise(function (resolve: any) { w.finishSelection = resolve })
        if (mode === 'reject') return Promise.reject(new Error('selection-reject'))
        if (mode === 'fail') return Promise.resolve({ ok: false, error: 'selection-failed' })
        if (mode === 'none') return Promise.resolve({ ok: true, selection: { backendId: null, source: 'explicit' } })
        return Promise.resolve({ ok: true, selection: { backendId: 'github', source: 'explicit' } })
      }
      return Promise.resolve({ ok: false, error: 'unexpected-method:' + method })
    },
  }
  // 真 mergeSelection（snapshot-cache-store.ts 切函数体）
  const mergeSrc = extractFn(spliceableJs('src/refresh/rooms/client/snapshot-cache-store.js'), 'mergeSelection = function')
  const mergeSelection = compileFn(['keepUserPick', 'log', 'dswsLogHash'], 'var ' + mergeSrc + '\n;return mergeSelection')(undefined, logFn, hashFn)
  // 真链模块：askSelectionOnce 先给晚绑定代理（真闭包里它是同一个名字）。
  const holder: any = { ask: null, loadChain: null }
  const chainSandbox: any = {
    promptLang: function (): string { return 'zh' },
    wsKeyOf: wsKeyOf,
    getChainCacheKey: getChainCacheKey,
    isEnabled: function (): boolean { return true },
    log: logFn,
    dswsLogHash: hashFn,
    dswsLogTrunc: truncFn,
    userHintOf: function (): any { return undefined },
    nowStr: function (): string { return '2026-10-29T02:30:00+08:00' },
    emit: emitFn,
    host: w.host,
    getCachedChain: function (): any { return null },
    getCachedChainEntry: function (): any { return null },
    setCachedChain: function (): void {},
    CHAIN_AUTO_RETRY_COOLDOWN_MS: 30000,
    askSelectionOnce: function (): any {
      return holder.ask ? holder.ask.apply(null, arguments) : Promise.resolve(null)
    },
  }
  const chainMod = buildChainModule(chainSandbox)
  holder.loadChain = chainMod.loadChain
  // 真 _flushDeferredChain（probe-chain-subscription.ts 切函数体）：补发时调上面那份真 loadChain，
  // 来路取真枚举（不另写一个字符串，免得两处各写一遍慢慢分家）。
  const flushSrc = extractFn(spliceableJs('src/refresh/rooms/client/probe-chain-subscription.js'), '_flushDeferredChain = function')
  const flushFn = compileFn(['loadChain', 'CHAIN_EVENT_REASONS'], 'var ' + flushSrc + '\n;return _flushDeferredChain')(function (): any {
    return holder.loadChain.apply(null, arguments)
  }, chainMod.CHAIN_EVENT_REASONS)
  // 真 askSelectionOnce（probe-scope-selection.ts 切函数体）：内部会用真 mergeSelection 与上面那份补发。
  const askSrc = extractFn(spliceableJs('src/refresh/rooms/client/probe-scope-selection.js'), 'askSelectionOnce = function')
  holder.ask = compileFn(
    ['host', 'wsKeyOf', 'isEnabled', 'log', 'dswsLogHash', 'dswsLogTrunc', 'mergeSelection', 'emit', '_flushDeferredChain'],
    'var ' + askSrc + '\n;return askSelectionOnce')(
    w.host, wsKeyOf, function (): boolean { return true }, logFn, hashFn, truncFn, mergeSelection, emitFn, flushFn)
  w.chainMod = chainMod
  return w as World
}
const requestLogs = function (w: World): any[] {
  return w.logs.filter(function (l) { return l.event === 'chain.flow' && l.fields && l.fields.side === 'request' })
}
const replyLogs = function (w: World): any[] {
  return w.logs.filter(function (l) { return l.event === 'chain.flow' && l.fields && l.fields.side === 'reply' })
}

async function main (): Promise<void> {
  console.log('#1626 A/B/C. 冷启动：首帧不空算，selection 落定后恰好补发一次 github 请求')
  {
    const w = makeWorld('manual')
    const st: any = { cwd: CWD, sessionId: SID, selection: null, chainSnapshot: null }
    const p1: any = w.chainMod.loadChain(st, false)
    await sleep(5)
    check(w.chainCalls.length === 0, 'A1 首帧没有带着空 backendId 发链求值（实得 ' + w.chainCalls.length + ' 条）')
    check(w.selectionCalls.length === 1, 'A2 首帧改问 wf.selection 那条专用电话（实得 ' + w.selectionCalls.length + ' 次）')
    check(st.selPending === true, 'A3 等待选择期间 selPending 为真（界面这几帧说「正在读取」而不是「没有设置」）')
    const r1: any = await p1
    check(r1 === null, 'A4 被推迟的那次调用返回 null（调用方按「这一次没有快照」处理）')
    // 等待期间再挂载一路（状态栏 + Dock 两次调用都要能合进同一次补发）
    const p2: any = w.chainMod.loadChain(st, false)
    await sleep(5)
    check(w.chainCalls.length === 0, 'C1 等待期间第二次 loadChain 也不再空算（实得 ' + w.chainCalls.length + ' 条）')
    check((await p2) === null, 'C2 第二次调用同样返回 null')
    // selection 落定
    w.finishSelection({ ok: true, selection: { backendId: 'github', source: 'explicit' } })
    await sleep(10)
    check(!!st.selection && st.selection.backendId === 'github', 'B1 selection 落定成 github（实得 ' + JSON.stringify(st.selection) + '）')
    check(w.chainCalls.length === 1, 'B2 落定后恰好补发一次链求值（实得 ' + w.chainCalls.length + ' 条）')
    const req = requestLogs(w)[0]
    check(!!req && req.fields.backendId === 'github', 'B3 补发那条请求的 backendId 已是 github（实得 ' + JSON.stringify(req && req.fields.backendId) + '）')
    check(!!req && req.fields.reason === 'selection-resolved', 'B4 补发的来路是 selection-resolved（实得 ' + JSON.stringify(req && req.fields.reason) + '）')
    check(/github\|zh$/.test(String(w.chainMod._chainKeyOfState(st))), 'B5 请求键里带的是 github（' + w.chainMod._chainKeyOfState(st) + '）')
    check(!requestLogs(w).some(function (l) { return l.fields.backendId === '' }), 'C3 全程没有空键链请求')
    // 回包：必须被采纳，不能判 stale
    w.chainResolvers[0]({ ok: true, snapshot: SNAP_PENDING, chain: SNAP_PENDING, resolved: {}, backendId: 'github' })
    await sleep(10)
    check(st.chainSnapshot === SNAP_PENDING, 'B6 回包被写进会话（链快照不再是 null）')
    const rep = replyLogs(w)[0]
    check(!!rep && rep.fields.outcome === 'adopted', 'B7 回包结论是 adopted（实得 ' + JSON.stringify(rep && rep.fields.outcome) + '）')
    check(!replyLogs(w).some(function (l) { return l.fields.outcome === 'stale' }), 'C4 全程没有 stale 回包')
    check(w.chainMod.chainPendingOf(st) === true, 'E1 快照到手后 #1474 的自动复查入口为真（pending 那一步还在）')
  }

  console.log('\n#1626 D. 兜底：selection 明确「没有后端」时照样求值一次（空键是诚实结论，不是猜测）')
  {
    const w = makeWorld('none')
    const st: any = { cwd: CWD, sessionId: SID, selection: null, chainSnapshot: null }
    w.chainMod.loadChain(st, false)
    check(w.chainCalls.length === 0, 'D1 回包还没到之前不空算（实得 ' + w.chainCalls.length + ' 条）')
    await sleep(15)
    check(!!st.selection && st.selection.backendId === null && st.selection.source === 'explicit', 'D2 明确「没有后端」的结论装上了（实得 ' + JSON.stringify(st.selection) + '）')
    check(w.chainCalls.length === 1, 'D3 落定后照旧求值一次（实得 ' + w.chainCalls.length + ' 条）')
    const req = requestLogs(w)[0]
    check(!!req && req.fields.backendId === '', 'D4 这一条的空 backendId 是「确实没有后端」，不是「还没读到」（字段 ' + JSON.stringify(req && req.fields.backendId) + '）')
    w.chainResolvers[0]({ ok: true, snapshot: SNAP_PENDING, chain: SNAP_PENDING, resolved: {}, backendId: null })
    await sleep(10)
    check(st.chainSnapshot === SNAP_PENDING, 'D5 空键回包被采纳（键没变过，不判 stale）')
  }

  console.log('\n#1626 D. 兜底：wf.selection 回失败 / 抛异常时不吊死，照旧空键求值一次')
  for (const mode of ['fail', 'reject'] as Mode[]) {
    const w = makeWorld(mode)
    const st: any = { cwd: CWD, sessionId: SID, selection: null, chainSnapshot: null }
    w.chainMod.loadChain(st, false)
    await sleep(15)
    check(w.chainCalls.length === 1, 'D6 (' + mode + ') selection 失败后照旧发出一次链求值（实得 ' + w.chainCalls.length + ' 条）')
    check(st.selPending === false, 'D7 (' + mode + ') 失败后「在途」标记收掉（不永远停在读取中）')
    check(st._chainDeferred == null, 'D8 (' + mode + ') 推迟记账已清掉，不会下一次莫名补发')
  }

  console.log('\n#1626 D. 兜底：叶子沙箱里没有 selection 模块（老客户端 / 独立求值）时行为与从前一致')
  {
    const w = makeWorld('github')
    const sandbox: any = {
      promptLang: function (): string { return 'zh' },
      wsKeyOf: wsKeyOf,
      getChainCacheKey: getChainCacheKey,
      isEnabled: function (): boolean { return true },
      log: w.logFn,
      dswsLogHash: function (s: unknown): string { return 'h' + String(s || '').length },
      dswsLogTrunc: function (s: unknown): string { return String(s || '') },
      userHintOf: function (): any { return undefined },
      nowStr: function (): string { return '00:00:00' },
      emit: function (): void {},
      host: w.host,
      getCachedChain: function (): any { return null },
      getCachedChainEntry: function (): any { return null },
      setCachedChain: function (): void {},
      CHAIN_AUTO_RETRY_COOLDOWN_MS: 30000,
    }
    const chainMod = buildChainModule(sandbox)
    const st: any = { cwd: CWD, sessionId: SID, selection: null, chainSnapshot: null }
    chainMod.loadChain(st, false)
    await sleep(5)
    check(w.chainCalls.length === 1, 'D9 没有 selection 模块时照旧立刻发一次（实得 ' + w.chainCalls.length + ' 条）')
    check(w.selectionCalls.length === 0, 'D10 也不会去问一条没人实现的电话（实得 ' + w.selectionCalls.length + ' 次）')
  }

  console.log('\n#1626 E. 回归：selection 已经在手上时照旧立刻发，不多问一次 wf.selection')
  {
    const w = makeWorld('github')
    const st: any = { cwd: CWD, sessionId: SID, selection: { backendId: 'github', source: 'explicit' }, chainSnapshot: null }
    w.chainMod.loadChain(st, false)
    await sleep(5)
    check(w.chainCalls.length === 1, 'E2 立刻发一条链求值（实得 ' + w.chainCalls.length + ' 条）')
    check(w.selectionCalls.length === 0, 'E3 不再多问 wf.selection（实得 ' + w.selectionCalls.length + ' 次）')
    check(requestLogs(w)[0].fields.backendId === 'github', 'E4 请求键里的 backendId 是 github')
  }

  console.log('\n共 ' + total + ' 项，' + (failed ? '有失败' : '全绿'))
  process.exit(failed ? 1 : 0)
}
main().catch(function (e: unknown): void { console.log('RUNNER ERROR: ' + ((e && (e as Error).stack) || e)); process.exit(2) })
