#!/usr/bin/env node
// tests/verify-1474-chain-auto-retry.ts —— 门禁：#1474 链上某一步「暂时确认不了」之后，面板可见时要能自己收尾
//
// 用户在真机上遇到的那一幕（#995）：断网进 GitHub 后端工作区，链上登录态那一步判成 pending、
// 黄条写着「暂时确认不了」；网恢复以后，只要不亲手点「重新检查」，黄条就一直挂着——
// 因为链重算只挂在初始化那一步（#891 的 setup-pending）上，别的步 pending 没有任何自动再问一次的门。
//
// 本门禁量七件事（都是跑起来的结果，不读「源码里有没有某个字」）：
//   A 判据：chainPendingOf 只认 pending —— 明确失败（fail/current）与全绿都不归自动复查管
//   B 发起：链上有 pending 时发一次宿主求值，触发名是 auto-retry、不带 force、且绕开本地缓存读取
//   C 冷却：一步等待（默认 30 秒）内最多发起一次；冷却内的拍子只记一条调试日志，不再发请求
//   D 单飞：上一轮还在路上时不再叠第二份；客户端已有一趟在途时自动复查搭那趟车、不另起请求
//   E 边界：没有 pending、快照没到、非活跃/不可见时不发起（面板隐藏零新增链求值）
//   F 宿主：所有求值共用一份在途合并（连点两下「重新检查」也只真算一次）；
//     自动复查不带 force，所以既不清 gh 解析缓存，也照样参与合并
//   G 接线：活跃探测拍每一拍先看 setup-pending（#891 老路优先），没有再走自动复查；不新增任何定时器
//
// 门禁归属: src/refresh/rooms/client/probe-chain-subscription.ts
// 门禁归属: src/refresh/rooms/client/refresh-timer.ts
// 门禁归属: src/refresh/rooms/host/check-chain-evaluation.ts
//
// 用法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1474-chain-auto-retry.ts
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs } from './lib/source-text.ts'
import { STEP_WAIT_MS } from '../src/shared/time-config/values.js'

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const url = (rel: string): string => pathToFileURL(path.join(ROOT, rel)).href

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
const readSource = function (rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
// 这个客户端文件是「拼进浏览器闭包」的片段：去掉行首 export、剥掉类型后，用沙箱把跨文件名字补上，
// 就与浏览器里那份拼接结果同形（与 tests/verify-1483-client-chain-cache.ts 同一种装载法）。
// #1474 起这个客户端片段有一行中央时间参数的真 import（构建会整行删掉）；沙箱装载时照做，
// 否则 vm 会报 import 语句语法错。数值由 makeWorld 的沙箱 globals 提供。
const stripTimeConfigImport = function (source: string): string {
  return source.replace(/^\s*import\s*\{[^}]*\}\s*from\s*['"][^'"]*time-config\/values\.js['"]\s*;?\s*$/gm, '')
}
const asSnippet = function (source: string): string {
  return stripTypeScriptTypes(stripTimeConfigImport(source).replace(/^export /gm, ''), { mode: 'strip' })
}

// ---------------------------------------------------------------------------------------------
// 客户端那一半：把链订阅片段装进沙箱，直接调自动复查入口，量「发不发、带什么、发几次」
// ---------------------------------------------------------------------------------------------
type AnyObj = { [key: string]: any }

function makeWorld(opts?: AnyObj): AnyObj {
  const o = opts || {}
  const entries = new Map<string, AnyObj>()
  const requests: AnyObj[] = []
  const logs: AnyObj[] = []
  const setCalls: AnyObj[] = []
  // 想挂住下一趟请求时打开 on，逐个放行 pending 里的 resolve（用来造「在途」）。
  const hang: AnyObj = { on: false, pending: [] as AnyObj[] }
  const keyOf = function (ws: string, bid: string, lang: string): string {
    return String(ws) + '|' + String(bid) + '|' + String(lang)
  }
  const replyFor = function (tag: string): AnyObj {
    return {
      ok: true,
      backendId: 'markdown',
      chain: [],
      resolved: {},
      snapshot: null,
      backendChain: null,
      fullChain: [],
      fullSnapshot: {
        steps: [{ id: 'md:scratchWritable', status: 'done' }],
        currentIndex: null, doneCount: 1, applicableCount: 1, totalCount: 1, chainState: 'allDone', version: '1', tag: tag,
      },
      chainSource: 'background',
      tag: tag,
    }
  }
  const sandbox: AnyObj = {
    promptLang: function (): string { return 'zh' },
    wsKeyOf: function (cwd: any): string { return String(cwd || '') },
    getChainCacheKey: keyOf,
    // B/C/D 要收调试日志：调试开关打开，并把它记下来。
    isEnabled: function (level: any): boolean { return level === 'debug' ? o.debug !== false : false },
    log: function (level: any, event: any, fields: any): void { logs.push({ level: level, event: event, fields: fields }) },
    dswsLogHash: function (s: any): string { return String(s || '') },
    dswsLogTrunc: function (s: any): string { return String(s || '') },
    userHintOf: function (selection: any): any { return (selection && selection.backendId) || undefined },
    nowStr: function (): string { return '00:00:00' },
    emit: function (): void {},
    host: {
      call: function (method: string, args: AnyObj): any {
        requests.push({ method: method, args: args })
        if (hang.on) {
          return new Promise(function (resolve) { hang.pending.push({ resolve: resolve, index: requests.length }) })
        }
        return Promise.resolve(replyFor('fresh-' + requests.length))
      },
    },
    // 冷却值按仓里规矩从中央配置来：测试也读同一份生成常量，不另写一个 30000。
    STEP_WAIT_MS: (o.cooldown === undefined ? STEP_WAIT_MS : o.cooldown),
    getCachedChain: function (ws: string, bid: string, lang: string): any {
      const e = entries.get(keyOf(ws, bid, lang))
      return e ? e.snapshot : null
    },
    getCachedChainEntry: function (ws: string, bid: string, lang: string): any {
      return entries.get(keyOf(ws, bid, lang)) || null
    },
    setCachedChain: function (ws: string, bid: string, lang: string, snap: any, sessionId?: string): void {
      const ent: AnyObj = { snapshot: snap, ts: 1 }
      if (sessionId !== undefined && sessionId !== null) ent.sessionId = String(sessionId)
      entries.set(keyOf(ws, bid, lang), ent)
      setCalls.push({ ws: ws, bid: bid, lang: lang, snap: snap, sessionId: sessionId })
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(asSnippet(readSource('src/refresh/rooms/client/probe-chain-subscription.ts')) +
    '\nglobalThis.chainPendingOf = chainPendingOf;' +
    '\nglobalThis.maybeAutoRetryChain = maybeAutoRetryChain;' +
    '\nglobalThis._autoRetryState = _autoRetryState;' +
    '\nglobalThis._autoRetryKeyOf = _autoRetryKeyOf;' +
    '\nglobalThis.resetAutoRetryCooldown = resetAutoRetryCooldown;' +
    '\nglobalThis.CHAIN_EVENT_REASONS = CHAIN_EVENT_REASONS;' +
    '\nglobalThis.loadChain = loadChain;', sandbox)
  const world: AnyObj = {
    sandbox: sandbox, entries: entries, requests: requests, logs: logs, setCalls: setCalls, hang: hang,
    keyOf: keyOf, replyFor: replyFor,
    chainPendingOf: sandbox.chainPendingOf,
    maybeAutoRetryChain: sandbox.maybeAutoRetryChain,
    autoRetryState: sandbox._autoRetryState,
    autoRetryKeyOf: sandbox._autoRetryKeyOf,
    resetAutoRetryCooldown: sandbox.resetAutoRetryCooldown,
    loadChain: sandbox.loadChain,
    reasons: sandbox.CHAIN_EVENT_REASONS,
  }
  return world
}

function mkState(sessionId: string, steps?: any[]): AnyObj {
  return {
    cwd: '/ws',
    sessionId: sessionId,
    selection: { backendId: 'markdown' },
    chainSnapshot: { steps: (steps || [{ id: 'gh:authed', status: 'pending' }]) },
  }
}
const doneStep = (id: string): AnyObj => ({ id: id, status: 'done' })
const pendingStep = (id: string): AnyObj => ({ id: id, status: 'pending' })
const chainEventsOf = function (w: AnyObj, reason: string): AnyObj[] {
  return w.logs.filter(function (l: AnyObj): boolean { return l.event === 'chain.event' && l.fields && l.fields.reason === reason })
}

const partA = function (): void {
  console.log('#1474 A. 判据：只认「暂时确认不了」（pending），明确失败与全绿都不归自动复查管')
  const w = makeWorld()
  check(w.chainPendingOf(mkState('s1', [pendingStep('gh:authed')])) === true, '链上有 pending 步 → 判为需要自动复查')
  check(w.chainPendingOf(mkState('s1', [doneStep('gh:installed'), pendingStep('gh:authed')])) === true, '混着 done 与 pending 也认得出')
  check(w.chainPendingOf(mkState('s1', [doneStep('gh:installed'), doneStep('gh:authed')])) === false, '全绿 → 不需要')
  check(w.chainPendingOf(mkState('s1', [{ id: 'gh:authed', status: 'fail' }])) === false, '明确失败（fail）→ 不需要，那是人该处理的事')
  check(w.chainPendingOf(mkState('s1', [{ id: 'gh:remote', status: 'current' }])) === false, '有下一步可点（current）→ 不需要')
  check(w.chainPendingOf(mkState('s1', [{ id: 'gh:authed', status: 'fail' }, pendingStep('gh:remote')])) === false, '明确失败后面被阻塞的 pending 不算（它不是链头，反复求值也解不开）')
  check(w.chainPendingOf(mkState('s1', [{ id: 'gh:authed', status: 'current' }, pendingStep('gh:remote')])) === false, '待操作（current）后面的 pending 也不算（被前一步挡着）')
  check(w.chainPendingOf(mkState('s1', [])) === false, '快照一行都没有 → 不需要（不借机多算）')
  check(w.chainPendingOf(null) === false, '没有会话状态也不抛')
  check(w.chainPendingOf({ cwd: '/ws' }) === false, '没有链快照也不抛')
}

const partB = async function (): Promise<void> {
  console.log('#1474 B. 发起：绕开本地缓存再问一次宿主，触发名是 auto-retry、不带 force')
  const w = makeWorld()
  check(Number.isInteger(STEP_WAIT_MS) && STEP_WAIT_MS > 0, '冷却值取自中央配置 config/timeouts.yaml 的 stepWaitMs（实得 ' + STEP_WAIT_MS + '；具体数值由 verify-time-config 门禁统一核对，这里不锁死）')
  const st = mkState('s1')
  // 本地缓存里放着一份「还是旧状态」的同一会话快照：不绕缓存的话会原样读回来，等于没复查。
  const cachedSnap = { steps: [pendingStep('gh:authed')], tag: 'cached-old' }
  w.entries.set(w.keyOf('/ws', 'markdown', 'zh'), { snapshot: cachedSnap, ts: 1, sessionId: 's1' })
  const p = w.maybeAutoRetryChain(st)
  check(!!p && typeof p.then === 'function', '有 pending 步时返回这一次求值的 Promise')
  const got = await p
  check(w.requests.length === 1, '真发了一次宿主求值（没有被本地缓存挡住，实得 ' + w.requests.length + ' 次）')
  const req = w.requests[0] || { args: {} }
  check(req.method === 'wf.chain', '请求走 wf.chain')
  check(req.args && req.args.trigger === 'auto-retry', '请求带上触发原因 auto-retry（宿主据此按后台档退避，实得 ' + JSON.stringify(req.args && req.args.trigger) + '）')
  check(req.args && req.args.force === undefined, '请求不带 force（force 的另两义——清 gh 解析缓存、绕宿主在途合并——一个都不借）')
  check(got && got.tag === 'fresh-1', '回包照常采纳（拿到的是宿主新算的那一份）')
  check(st.chainSnapshot && st.chainSnapshot.tag === 'fresh-1', '会话状态换成新快照，黄条下次按新判定画')
  check(chainEventsOf(w, 'auto-retry').length === 1, '发起时记一条调试日志 chain.event reason=auto-retry（实得 ' + chainEventsOf(w, 'auto-retry').length + ' 条）')
}

const partC = async function (): Promise<void> {
  console.log('#1474 C. 冷却：一步等待（默认 30 秒）内最多发起一次，冷却内的拍子只记日志不发请求')
  const w = makeWorld()
  const st = mkState('s1')
  const key = w.autoRetryKeyOf(st)
  w.hang.on = true
  const first: any = w.maybeAutoRetryChain(st)
  await sleep(5)
  check(w.requests.length === 1, '第一拍发了一次（挂住没回来）')
  // 立刻再调一次：还在冷却窗内（而且上一轮还挂着，先由单飞挡住）。
  w.maybeAutoRetryChain(st)
  check(w.requests.length === 1, '冷却/在途期间的下一拍没有再发请求（实得 ' + w.requests.length + ' 次）')
  // 放行第一轮，让 inFlight 复位；此时仍在冷却窗内，应看到冷却日志且不发请求。
  w.hang.pending[0].resolve(w.replyFor('fresh-1'))
  await first
  await sleep(5)
  w.hang.on = false
  // 回包把会话快照换成了全绿；把「还有一步 pending」重新摆好，单独量冷却这一条。
  st.chainSnapshot = { steps: [pendingStep('gh:authed')] }
  check(w.autoRetryState.atByKey.get(key) > 0, '发起时把这一把链键的冷却起点记下来（下一拍据此判断）')
  const before = w.requests.length
  w.maybeAutoRetryChain(st)
  check(w.requests.length === before, '冷却窗内（刚过 30 秒不到）不再发请求（实得新增 ' + (w.requests.length - before) + ' 次）')
  const cooldownLogs = w.logs.filter(function (l: AnyObj): boolean { return l.event === 'chain.auto.retry' && l.fields && l.fields.decision === 'cooldown' })
  check(cooldownLogs.length >= 1, '冷却挡下这一拍会记一条 chain.auto.retry decision=cooldown（可追，实得 ' + cooldownLogs.length + ' 条）')
  check(!!cooldownLogs[0] && Number(cooldownLogs[0].fields.waitMs) > 0, '冷却日志带上还剩多少毫秒（waitMs，实得 ' + (cooldownLogs[0] ? String(cooldownLogs[0].fields.waitMs) : '无') + '）')
  // 把上次发起时间往前推过冷却窗：下一次应该再发。
  w.autoRetryState.atByKey.set(key, Date.now() - STEP_WAIT_MS - 1)
  await w.maybeAutoRetryChain(st)
  check(w.requests.length === before + 1, '过完冷却窗后重新发起（实得新增 ' + (w.requests.length - before) + ' 次）')
}

const partD = async function (): Promise<void> {
  console.log('#1474 D. 单飞：上一轮还在路上时不叠第二份；客户端已有在途时搭那趟车')
  const w = makeWorld()
  const st = mkState('s1')
  w.hang.on = true
  const p1: any = w.maybeAutoRetryChain(st)
  await sleep(5)
  check(w.requests.length === 1, '第一轮在途（挂住）')
  const p2 = w.maybeAutoRetryChain(st)
  check(p2 === null, '在途期间再调一次直接返回 null（不排第二份）')
  check(w.requests.length === 1, '在途期间没有第二个请求')
  const busyLogs = w.logs.filter(function (l: AnyObj): boolean { return l.event === 'chain.auto.retry' && l.fields && l.fields.decision === 'busy' })
  check(busyLogs.length >= 1, '在途跳过记一条 chain.auto.retry decision=busy（可追，实得 ' + busyLogs.length + ' 条）')
  w.hang.pending[0].resolve(w.replyFor('fresh-1'))
  await p1
  await sleep(5)
  check(w.autoRetryState.inFlightByKey.get(w.autoRetryKeyOf(st)) === undefined, '回包落地后这一把链键的在途标记摘掉')

  // 客户端同一把键上已经有一趟普通请求在飞时，自动复查绕开本地缓存读取，但仍参与在途合并。
  const w2 = makeWorld()
  w2.hang.on = true
  const st2 = mkState('s1')
  const normal: any = w2.loadChain(st2, false, 'enter-workspace')
  await sleep(5)
  check(w2.requests.length === 1, '先挂一趟普通链求值在途')
  const ar: any = w2.maybeAutoRetryChain(st2)
  check(!!ar && typeof ar.then === 'function', '自动复查照常发起（返回这一趟的 Promise）')
  check(w2.requests.length === 1, '自动复查搭上同会话那趟在途请求，没有另发一份（实得 ' + w2.requests.length + ' 次）')
  w2.hang.pending[0].resolve(w2.replyFor('fresh-1'))
  await normal
  await ar
  check(w2.requests.length === 1, '两路拿到同一份回包，请求数仍是 1')
}

const partE = async function (): Promise<void> {
  console.log('#1474 E. 边界：没有 pending、快照没到、非活跃时不发起')
  const w = makeWorld()
  const allDone = mkState('s1', [doneStep('md:scratchWritable')])
  check(w.maybeAutoRetryChain(allDone) === null, '全绿链 → 不发起')
  check(w.requests.length === 0, '全绿链没有发请求')
  const failed = mkState('s1', [{ id: 'gh:authed', status: 'fail' }])
  check(w.maybeAutoRetryChain(failed) === null, '明确失败的链 → 不发起（那是人该处理的）')
  check(w.requests.length === 0, '明确失败没有发请求')
  check(w.maybeAutoRetryChain({ cwd: '/ws' }) === null, '快照还没到（没有 steps）→ 不发起')
  check(w.requests.length === 0, '快照没到没有发请求')
  check(w.maybeAutoRetryChain(null) === null, '没有会话状态 → 不发起')
  check(w.requests.length === 0, '没有会话状态没有发请求')
}

const partF = async function (): Promise<void> {
  console.log('#1474 F. 宿主：所有求值共用一份在途合并，自动复查不带 force 所以不清 gh 缓存')
  const { createDetectChain } = await import(url('src/refresh/rooms/host/check-chain-evaluation.ts'))
  const makeChain = function (opts?: AnyObj): AnyObj {
    const o = opts || {}
    let detects = 0
    let resets = 0
    let active = 0
    let maxActive = 0
    const chain = createDetectChain({
      canonicalKey: async function (raw: any): Promise<string> { return String(raw || '') },
      DEFAULT_CWD: 'D:/demo',
      resetGhCache: function (): void { resets += 1 },
      getDetectionService: async function (): Promise<AnyObj> {
        return {
          detect: async function (): Promise<AnyObj> {
            detects += 1
            active += 1
            maxActive = Math.max(maxActive, active)
            try {
              if (o.detectMs) await sleep(o.detectMs)
              return { selection: { backendId: 'github', source: 'auto' } }
            } finally { active -= 1 }
          },
        }
      },
      getPlatform: async function (): Promise<AnyObj> { return { os: 'win32', path: path, async getHome(): Promise<string> { return 'C:/Users/fake' } } },
      getTrackerRegistry: async function (): Promise<AnyObj> { return { modules: function (): any[] { return [] } } },
      getRepoKey: async function (): Promise<AnyObj> { return { owner: 'acme', name: 'demo' } },
      timer: { timeout: function (ms: number): Promise<void> { return sleep(ms) } },
      probeSkill: async function (): Promise<AnyObj> { return { ok: true, level: 'ok', detail: 'fake' } },
      mdPredicate: async function (): Promise<AnyObj> { return { status: 'pass', detail: 'fake' } },
      getChainCache: function (): any { return null },
      setChainCache: function (): void {},
      getChainBackoff: async function (): Promise<AnyObj> {
        return {
          verdict: async function (): Promise<AnyObj> { return { needed: true, reason: 'test-always-due', waitMs: 0, cached: null } },
          note: async function (): Promise<AnyObj> { return {} },
        }
      },
      logCtx: null,
      gate: null,
      openSession: null,
      getRepoIdentity: undefined,
    })
    return { chain: chain, detects: function (): number { return detects }, resets: function (): number { return resets }, maxActive: function (): number { return maxActive } }
  }
  const argsOf = function (o: AnyObj): AnyObj {
    return Object.assign({ cwd: 'D:/demo', backendId: 'github', lang: 'zh' }, o)
  }

  // F1 连点两下「重新检查」：都带 force，同一时刻只真算一次。
  {
    const m = makeChain({ detectMs: 20 })
    const p1 = m.chain.handleChain(argsOf({ force: true, trigger: 'user-recheck' }))
    const p2 = m.chain.handleChain(argsOf({ force: true, trigger: 'user-recheck' }))
    const r = await Promise.all([p1, p2])
    check(m.detects() === 1, '连点两下重新检查：同一时刻只真算一次（实得 ' + m.detects() + ' 次）')
    check(m.chain.rideStats().merged >= 1, '第二下搭上第一趟车（合并计数 +1，实得 ' + JSON.stringify(m.chain.rideStats()) + '）')
    check(r[0] && r[0].ok === true && r[1] && r[1].ok === true, '两下都拿到成功回包')
    check(r[0] && r[1] && r[0].backendId === 'github' && r[1].backendId === 'github', '两路回包都带着同一条链的判定（真算次数见上一条，没有各算一份）')
    check(m.resets() === 1, '连点两下只清一次 gh 解析缓存（搭车那一下不再白清，实得 ' + m.resets() + ' 次）')
  }

  // F2 自动复查（不带 force）撞上人手那一次（带 force）：也只真算一次；清 gh 解析缓存只发生在人手那一路。
  {
    const m = makeChain({ detectMs: 20 })
    const pForce = m.chain.handleChain(argsOf({ force: true, trigger: 'user-recheck' }))
    const pAuto = m.chain.handleChain(argsOf({ trigger: 'auto-retry' }))
    const r = await Promise.all([pForce, pAuto])
    check(m.detects() === 1, '自动复查与人在途的那一次共用一份求值（实得 ' + m.detects() + ' 次）')
    check(m.resets() === 1, '清 gh 解析缓存只发生在人手那一次（实得 ' + m.resets() + ' 次；自动复查这一路没有多清）')
    check(m.chain.rideStats().merged >= 1, '自动复查参与在途合并（实得 ' + JSON.stringify(m.chain.rideStats()) + '）')
    check(r[0] && r[0].ok === true && r[1] && r[1].ok === true, '两路都拿到成功回包')
  }

  // F3 自动复查单独跑一次：照常求值，但一个 gh 解析缓存都不清（下一次仍走真实命令）。
  {
    const m = makeChain()
    const r = await m.chain.handleChain(argsOf({ trigger: 'auto-retry' }))
    check(m.detects() === 1 && r && r.ok === true, '自动复查单独跑一次照常求值成功')
    check(m.resets() === 0, '自动复查单独跑一次没有清 gh 解析缓存（实得 ' + m.resets() + ' 次）')
  }

  // F4 人手点「重新检查」照旧：照常求值，并且照旧清一次 gh 解析缓存、永不降档。
  {
    const m = makeChain()
    const r = await m.chain.handleChain(argsOf({ force: true, trigger: 'user-recheck' }))
    check(m.detects() === 1 && r && r.ok === true, '人手重新检查照常求值成功')
    check(m.resets() === 1, '人手重新检查照旧清一次 gh 解析缓存（行为与今天一致，实得 ' + m.resets() + ' 次）')
  }

  // F5 反序：后台那一轮先跑起来，人手点「重新检查」后到 —— 先等后台收尾，再自己顺序算一轮，
  //   不搭后台那一轮的结果（按钮承诺「点完之后真的重问过」），全程不出现两轮求值重叠。
  {
    const m = makeChain({ detectMs: 60 })
    const pAuto = m.chain.handleChain(argsOf({ trigger: 'auto-retry' }))
    await sleep(15)
    check(m.detects() === 1, '后台那一轮已经在路上（实得 ' + m.detects() + ' 次）')
    const pForce = m.chain.handleChain(argsOf({ force: true, trigger: 'user-recheck' }))
    const r = await Promise.all([pAuto, pForce])
    check(m.detects() === 2, '后台收尾之后人手那一下自己又算了一轮（不搭后台车，实得 ' + m.detects() + ' 次）')
    check(m.maxActive() === 1, '两轮严格先后跑，没有重叠（实测最大并发 ' + m.maxActive() + ' 轮）')
    check(m.resets() === 1, '清 gh 解析缓存只发生在人手真正开算之前（实得 ' + m.resets() + ' 次）')
    check(r[0] && r[0].ok === true && r[1] && r[1].ok === true, '两路都拿到成功回包')
  }

  // F6 后台在飞时连点两下「重新检查」：后台一轮 + 人手一轮共两轮，第二下人手搭第一下那轮（合并计数 +1），
  //   两次点击只清一次 gh 解析缓存。
  {
    const m = makeChain({ detectMs: 60 })
    const pAuto = m.chain.handleChain(argsOf({ trigger: 'auto-retry' }))
    await sleep(15)
    const p1 = m.chain.handleChain(argsOf({ force: true, trigger: 'user-recheck' }))
    await sleep(5)
    const p2 = m.chain.handleChain(argsOf({ force: true, trigger: 'user-recheck' }))
    const r = await Promise.all([pAuto, p1, p2])
    check(m.detects() === 2, '后台一轮 + 人手一轮共两轮（第二下人手点击不另算，实得 ' + m.detects() + ' 次）')
    check(m.maxActive() === 1, '任何时刻只有一轮求值（实测最大并发 ' + m.maxActive() + ' 轮）')
    check(m.chain.rideStats().merged >= 1, '第二下人手点击搭上第一下那轮（合并计数 ' + JSON.stringify(m.chain.rideStats()) + '）')
    check(m.resets() === 1, '两次人手点击只清一次 gh 解析缓存（实得 ' + m.resets() + ' 次）')
    check(r.every(function (x: any): boolean { return !!(x && x.ok === true) }), '三路都拿到成功回包')
  }

}

// ---------------------------------------------------------------------------------------------
// G. 活跃探测拍接线：每一拍先看 setup-pending（#891 老路优先），没有再走自动复查；不新增定时器
// ---------------------------------------------------------------------------------------------
const loadSpliced = function (relPath: string, exportNames: string[], scope: AnyObj): any {
  const paramNames = Object.keys(scope)
  const fn = compileFn(paramNames, spliceableJs(relPath) + '\nreturn { ' + exportNames.join(', ') + ' }')
  return fn.apply(null, paramNames.map(function (k) { return scope[k] }))
}

const partG = async function (): Promise<void> {
  console.log('#1474 G. 活跃拍接线：setup-pending 优先，其次才是自动复查；复用这一拍、不新增定时器')
  const noop = function (): void {}
  const makeProbe = function (opts?: AnyObj): AnyObj {
    const o = opts || {}
    const logs: AnyObj[] = []
    const intervals: number[] = []
    const firedSteps: any[] = []
    const triggers: string[] = []
    const autoRuns: number[] = []
    const resets: number[] = []
    const timer: AnyObj = {
      timeout: function (fn: any, ms: number): any { return setTimeout(fn, ms) },
      interval: function (fn: any, ms: number): any { intervals.push(ms); firedSteps.push(fn); return function cancel(): void {} },
      clearTimeout: function (): void {},
    }
    const timerless: AnyObj = { timeout: function (fn: any, ms: number): any { return setTimeout(fn, ms) } }
    const scope: AnyObj = {
      SYNC: null,
      SYNC_FALLBACK_PROBE_MS: 60000, SYNC_FOCUS_PROBE_MIN_MS: 60000,
      SYNC_SNAP_FRESH_MS: 60000, PROBE_AUTO_WAIT_MS: 50,
      host: { call: function (): any { return Promise.resolve({ ok: false }) } },
      _attentionPlan: { intervalMs: 5000, standing: (o.standing === undefined ? 'active' : o.standing) },
      shared: { cwd: 'D:\\ws1474', sessionId: 'sess-1474', snapshot: null },
      stores: {},
      wsKeyOf: function (x: any): string { return String(x || '') },
      keyOf: function (x: any): string { return String(x || '') },
      log: function (level: any, event: any, fields: any): void { logs.push({ level: level, event: event, fields: fields }) },
      isEnabled: function (): boolean { return false },
      dswsLogHash: function (s: any): string { return 'h' + String(s || '').length },
      dswsLogTrunc: function (s: any): string { return String(s || '').slice(0, 120) },
      touchProbeAt: noop,
      emit: noop,
      diffSnapshots: function (): any { return { added: [], changed: [], removed: [], issueFlash: {} } },
      scheduleFlashClear: noop,
      loadSnapshot: function (): any { return Promise.resolve() },
      hydrateFromCache: function (): boolean { return false },
      snapshotWithoutWorkRoute: function (s: any): any { return s },
      ensureOwnWorkRoute: noop,
      loadOwnWorkRoute: noop,
      chainEventRefresh: function (st: any, trigger: any): any { triggers.push(String(trigger)); return Promise.resolve(null) },
      loadChain: function (): any { return Promise.resolve(null) },
      // #891 老路：初始化那一步还挂着；#1474 新路：链上别的步 pending。
      setupPendingOf: function (): boolean { return !!o.setupPending },
      chainPendingOf: function (): boolean { return !!o.chainPending },
      maybeAutoRetryChain: function (): any { autoRuns.push(1); return Promise.resolve(null) },
      // #1474：面板从藏起来回到可见的第一拍会清当前链的冷却窗；这里只记被调了几次。
      resetAutoRetryCooldown: function (): void { resets.push(1) },
      attentionVisible: function (): boolean { return o.visible === undefined ? true : !!o.visible },
      attentionStoreOf: function (): any { return { cwd: 'D:\\ws1474', chainSnapshot: { steps: [{ id: 'gh:authed', status: 'pending' }] } } },
      probeTargetNow: function (): any { return 'D:\\ws1474' },
      noteProbeReply: noop,
      namingGuardianEvent: noop,
      applySnapshotSelection: noop,
      flash: noop,
      tr: function (k: any): string { return String(k) },
      timer: (o.noTimer ? timerless : timer),
      document: undefined, window: undefined,
    }
    const mod = loadSpliced('src/refresh/rooms/client/refresh-timer.js', ['startActiveProbeLoop', '_activeProbeAt'], scope)
    return { mod: mod, scope: scope, logs: logs, intervals: intervals, firedSteps: firedSteps, triggers: triggers, autoRuns: autoRuns, resets: resets, opts: o }
  }
  const fireTick = async function (p: AnyObj): Promise<void> {
    p.mod.startActiveProbeLoop()
    const step = p.firedSteps[p.firedSteps.length - 1]
    check(typeof step === 'function', '活跃拍排上了（否则这一票的自动复查没有落点）')
    step()
    await sleep(10)
  }

  // G1 链上有 pending、初始化那一步没事：这一拍顺带发起自动复查。
  const g1 = makeProbe({ setupPending: false, chainPending: true })
  await fireTick(g1)
  check(g1.autoRuns.length === 1, '链上有 pending 时，这一拍发起了一次自动复查（实得 ' + g1.autoRuns.length + ' 次）')
  check(g1.intervals.length === 1, '没有因为自动复查新排定时器：活跃拍仍只有原来那一档（实得 ' + JSON.stringify(g1.intervals) + '）')

  // G2 初始化那一步还挂着：照 #891 老路走 setup-pending，不重复发起自动复查（同一拍不跑两趟）。
  const g2 = makeProbe({ setupPending: true, chainPending: true })
  await fireTick(g2)
  check(g2.triggers.indexOf('setup-pending') >= 0, '初始化还在等时仍走 setup-pending（#891 回归，实得 ' + JSON.stringify(g2.triggers) + '）')
  check(g2.autoRuns.length === 0, 'setup-pending 已接手时不再重复发起自动复查（实得 ' + g2.autoRuns.length + ' 次）')

  // G3 链上没有 pending：不发起。
  const g3 = makeProbe({ setupPending: false, chainPending: false })
  await fireTick(g3)
  check(g3.autoRuns.length === 0, '链上没有 pending 时不发起自动复查（实得 ' + g3.autoRuns.length + ' 次）')

  // G4 面板不可见 / 不在活跃集合：这一拍本来就不跑，自动复查也不许跑。
  const g4 = makeProbe({ setupPending: false, chainPending: true, visible: false })
  g4.mod.startActiveProbeLoop()
  g4.firedSteps[g4.firedSteps.length - 1]()
  check(g4.autoRuns.length === 0 && g4.triggers.length === 0, '面板不可见时这一拍什么都不做（零新增链求值，实得 auto=' + g4.autoRuns.length + '）')

  // G5 宿主没给定时器出口：如实记 no-timer，不排节拍（与 #891 口径一致）。
  const g5 = makeProbe({ setupPending: false, chainPending: true, noTimer: true })
  g5.mod.startActiveProbeLoop()
  check(g5.intervals.length === 0, '宿主没给定时器出口时不排节拍')
  check(g5.autoRuns.length === 0, '没排上节拍时也不会自动复查')

  // G6 源码口径：整个 refresh-timer 仍然只有兜底探针那一个 setInterval，自动复查没有偷偷起定时器。
  const src = readSource('src/refresh/rooms/client/refresh-timer.ts')
  const intervals2 = (src.match(/setInterval\(/g) || []).length
  check(intervals2 === 1, 'refresh-timer 里只有兜底探针那一个 setInterval（实得 ' + intervals2 + ' 个）')

  // G7 面板从藏起来回到可见：第一拍先清当前链的冷却窗，同一拍就补一次自动复查（验收「回来一拍内补一次」）。
  const g7 = makeProbe({ setupPending: false, chainPending: true, visible: false })
  g7.mod.startActiveProbeLoop()
  g7.firedSteps[g7.firedSteps.length - 1]()
  check(g7.autoRuns.length === 0 && g7.resets.length === 0, '藏起来的那一拍只记「暂停」，不清冷却也不发起（实得 auto=' + g7.autoRuns.length + ' reset=' + g7.resets.length + '）')
  g7.opts.visible = true
  g7.firedSteps[g7.firedSteps.length - 1]()
  check(g7.resets.length === 1, '回到可见的第一拍先清当前链的冷却窗（实得 ' + g7.resets.length + ' 次）')
  check(g7.autoRuns.length === 1, '清完冷却后同一拍补一次自动复查（实得 ' + g7.autoRuns.length + ' 次）')
}

const main = async function (): Promise<void> {
  partA()
  await partB()
  await partC()
  await partD()
  await partE()
  await partF()
  await partG()
  console.log('\n共 ' + total + ' 项，' + (failed ? '有失败' : '全绿'))
  process.exit(failed ? 1 : 0)
}
main().catch(function (e: any): void { console.error(e); process.exit(1) })
