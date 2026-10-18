// src/host/platform/namingSummary.ts —— 从同目录 namingSummary.js 逐行转写而来，只加类型标注与注释，运行时逻辑一个字未动。
//
// 为什么要转写这一份：首轮全文摘要与建票直达归属的编排，转成 TypeScript 后接线形状可见，
//   状态读写仍一律走命名守护的公开方法，触发口径仍与原来逐行一致。
// 什么约定不能改：
//   1. 两件事都由已有事件触发，不起任何自续定时器：首轮摘要只调一次，失败永不补调，未遂可再试。
//   2. 全文一律不记原文、不记标题、不记错误原文，只记新事件 naming.summary 的散列与结果枚举。
//   3. 相对导入一律保留 .js 后缀，运行时由 scripts/ts-hook.mjs 改指同名 .ts，本文件不改说明符。
//   4. 只写可剥离类型：类型一律经 import type 引入或就地声明，不新增任何运行时边。
//   5. 住在平台装配扇出区、不引用任何宿主层文件的格局不变：只引用共享层，状态走命名守护公开方法。
import { hash8 } from '../../shared/refresh-workspace-key.js'
import { NAMING_STAGES } from '../../shared/naming-tracking.js'
// 摘要超时住中央 YAML（config/timeouts.yaml 的 namingSummaryTimeoutMs 键）：这里直接引用中央常量，调时间改 YAML。
// 路径走域构建产物写法，值由 tests/verify-time-config.ts 看守一致。
import { NAMING_SUMMARY_TIMEOUT_MS as SUMMARY_TIMEOUT_MS } from '../../shared/time-config/values.js'
import { textOfMessage, pickFirstExchange, latestRoute, cleanSummaryText } from './namingSummaryText.js'

// 纯文本四件事已搬至 ./namingSummaryText.js（#1255）：取文本、选首轮、取路由、洗标题都是纯的，
// 本文件只做编排。门禁单测原来从这里取纯函数，取法不变（下面原样再导出）；
// 跨文件边只有这一条（本文件 → namingSummaryText.js，被依赖方），反向不依赖。
export { textOfMessage, pickFirstExchange, latestRoute, cleanSummaryText }

// 本域 types 为空，Node 的 Buffer 声明随 @types/node 一起缺席；运行时一定是 Node，进程内必然存在。
// 按存在声明只为过编译器，不产生运行时代码，取值失败仍走下面的 catch 回退，行为与原来一致。
declare const Buffer: { byteLength(s: string, encoding: string): number }

// 溢出 guard：用户拍板传全文，两段自然有界；超过此字节才截助手侧尾部（用户侧意图优先保留）。
const SUMMARY_INPUT_MAX_BYTES = 48 * 1024
// 调模型出摘要的超时：挂成那次模型调用的中止信号（AbortSignal.timeout，两段全文一次发出去、
// 模型侧慢起来会一直挂着，到点就中止这次调用，按本文件上面的失败口径入账 —— 失败永不补调，
// 连续失败到阈值才记 summaryFailed（见下面编排里「模型瞬败退避」那段注释）。
// 值住 config/timeouts.yaml 的 namingSummaryTimeoutMs 键，直接引用上面的中央常量。
const SUMMARY_MAX_TOKENS = 40

function utf8Bytes(s: unknown): number {
  try { return Buffer.byteLength(String(s || ''), 'utf8') } catch (e) { return String(s || '').length }
}

// 读某会话首条用户消息纯文本（读而不激活；失败一律 null；截 120 字只供派生比对，不记日志）。
export async function readFirstUserText(ctx: any, sid: string): Promise<string | null> {
  try {
    if (!ctx || typeof ctx.get !== 'function' || !sid) return null
    const sq = ctx.get('sessionQuery')
    if (!sq) return null
    let events: any = null
    try {
      const r = await sq.readSession(sid)
      events = (r && r.events) || (r && r.log) || (Array.isArray(r) ? r : null)
    } catch (e) {
      try {
        const l = await sq.listEvents(sid)
        events = (l && l.events) || (Array.isArray(l) ? l : null)
      } catch (e2) { return null }
    }
    if (!Array.isArray(events)) return null
    const ordered = events.slice().sort(function (a: any, b: any) { return (Number(a && a.seq) || 0) - (Number(b && b.seq) || 0) })
    for (let i = 0; i < ordered.length; i++) {
      const ev = ordered[i]
      if (ev && ev.type === 'user/message') { const t = textOfMessage(ev.data); return t ? String(t).slice(0, 120) : null }
    }
    return null
  } catch (e) { return null }
}

export function createNamingSummary(deps: any): {
  maybeSummarize: (sid: string) => Promise<any>
  onDeckWrite: (info: any) => Promise<any>
} {
  const d = deps || {}
  const ctx = d.ctx || null
  const getNaming = typeof d.getNaming === 'function' ? d.getNaming : null
  const logCtx = d.logCtx || null
  const inFlight: Record<string, boolean> = {}
  // 终局去重（第一性：终局结论不变，重记就是刷屏）。命中后连状态都不读直接回，
  // 上限 500 个会话、先来先淘汰（无定时器，#709 口径）；瞬态（未遂）不记、可再试。
  const terminalOf = new Map<string, string>()
  const TERMINAL_MAX = 500
  function terminalGet(sid: string): string | null { try { return terminalOf.get(sid) || null } catch (e) { return null } }
  function terminalPut(sid: string, reason: string): void {
    try {
      terminalOf.set(sid, reason)
      while (terminalOf.size > TERMINAL_MAX) { const k = terminalOf.keys().next(); if (k.done) break; terminalOf.delete(k.value) }
    } catch (e) {}
  }
  const TERMINAL_REASONS: Record<string, number> = { ok: 1, 'llm-fail': 1, 'skip-locked': 1, 'skip-done': 1, 'skip-failed': 1, 'skip-stage': 1 }
  // #746 Knife3：unregistered 不进终局 —— 注册可能晚到（先直达后注册），记死就永久失去首轮摘要。
  // 模型瞬败退避：同一会话连续 3 次才记 summaryFailed，前两次只记行不记旗（#746 V10）。
  const summaryAttempts: Record<string, number> = {}
  function noteTransient(sid: string): number {
    let n = 1
    try {
      summaryAttempts[sid] = (summaryAttempts[sid] || 0) + 1
      n = summaryAttempts[sid]
      // 与终局表同口径：上限 500，淘汰最旧，无定时器
      const keys = Object.keys(summaryAttempts)
      for (let ki = 0; ki < keys.length - 500; ki++) { try { delete summaryAttempts[keys[ki]] } catch (eD) {} }
    } catch (e) {}
    return n
  }
  function clearTransient(sid: string): void { try { delete summaryAttempts[sid] } catch (e) {} try { terminalOf.delete(sid) } catch (e2) {} }

  function service(name: string): any {
    try { return (ctx && typeof ctx.get === 'function') ? ctx.get(name) : undefined } catch (e) { return undefined }
  }
  function logSummary(sid: string, outcome: string): void {
    try { if (logCtx) logCtx.fire('info', 'naming.summary', { sidHash: hash8(sid), outcome: outcome }) } catch (e) {}
  }
  async function naming(): Promise<any> {
    try { return getNaming ? await getNaming() : null } catch (e) { return null }
  }

  async function readFirstExchange(sid: string): Promise<any> {
    const sq = service('sessionQuery')
    if (!sq) return { ok: false, reason: 'no-query' }
    let events: any = null
    try {
      const r = await sq.readSession(sid)
      events = (r && r.events) || (r && r.log) || (Array.isArray(r) ? r : null)
    } catch (e) {
      try {
        const l = await sq.listEvents(sid)
        events = (l && l.events) || (Array.isArray(l) ? l : null)
      } catch (e2) { return { ok: false, reason: 'read-fail' } }
    }
    if (!events) return { ok: false, reason: 'read-fail' }
    const pair = pickFirstExchange(events)
    if (!pair || !pair.user) return { ok: false, reason: 'no-exchange' }
    return { ok: true, pair: pair, events: events }
  }

  async function summarizeLlm(llm: any, route: { provider: string; model: string }, sid: string, userText: string, asstText: string): Promise<string> {
    let a = String(userText || ''), b = String(asstText || '')
    if (utf8Bytes(a) + utf8Bytes(b) > SUMMARY_INPUT_MAX_BYTES) {
      const keepA = utf8Bytes(a)
      const room = Math.max(0, SUMMARY_INPUT_MAX_BYTES - keepA)
      let acc = 0, out = ''
      for (const ch of b) { const n = utf8Bytes(ch); if (acc + n > room) break; acc += n; out += ch }
      b = out
    }
    const framed = 'Generate the session title from this JSON array of human messages:\n' +
      JSON.stringify([{ role: 'user', text: a }, { role: 'assistant', text: b }])
    const system = '你是会话标题助手。只看用户第一段与助手第一段，总结成十字以内的标题。用消息的语言，只回标题一行，不要引号、解释与 Markdown。'
    let signal: any = null
    try { signal = AbortSignal.timeout(SUMMARY_TIMEOUT_MS) } catch (e) { signal = undefined }
    const options: any = {
      provider: route.provider, model: route.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: framed }] }],
      system: system, maxTokens: SUMMARY_MAX_TOKENS, sessionId: sid,
      purpose: 'session-title',
    }
    if (signal) options.signal = signal
    let text = ''
    try {
      const stream = llm.stream(options)
      for await (const chunk of stream) {
        if (!chunk || typeof chunk !== 'object') continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        else if (chunk.type === 'finish' && chunk.reason) {
          const k = chunk.reason.kind || chunk.reason
          if (k !== 'stop') throw new Error('summary finish: ' + String(k))
        }
      }
    } catch (e) { throw e }
    return cleanSummaryText(text)
  }

  // 首轮摘要主入口（幂等：每会话只成功一次；失败永不补调；未遂可再试；每个终局记一行）。
  function maybeSummarize(sid: string): Promise<any> {
    if (!sid || inFlight[sid]) return Promise.resolve({ ok: false, reason: 'busy' })
    const cached = terminalGet(sid)
    if (cached) return Promise.resolve({ ok: cached === 'ok', reason: cached })
    inFlight[sid] = true
    const done = function (r: any): any { try { delete inFlight[sid] } catch (e) {} return r }
    const finish = async function (outcome: string, reason: string): Promise<any> {
      if ((TERMINAL_REASONS as Record<string, number>)[outcome]) terminalPut(sid, outcome)
      logSummary(sid, outcome)
      return { ok: outcome === 'ok', reason: reason }
    }
    return (async function (): Promise<any> {
      const h = await naming()
      let entry: any = null
      try { entry = h && typeof h.getEntry === 'function' ? await h.getEntry(sid) : null } catch (e) { entry = null }
      if (!entry) return finish('unregistered', 'unregistered')
      if (entry.locked) return finish('skip-locked', 'skip-locked')
      if (entry.summaryOnce) return finish('skip-done', 'skip-done')
      if (entry.summaryFailed) return finish('skip-failed', 'skip-failed')
      if (entry.stage !== (NAMING_STAGES as any).PLACEHOLDER && entry.stage !== (NAMING_STAGES as any).DRAFT) return finish('skip-stage', 'skip-stage')
      const read = await readFirstExchange(sid)
      if (!read.ok) return finish(read.reason === 'read-fail' ? 'read-fail' : 'no-query', read.reason)
      if (!read.pair.asst) return finish('no-exchange', 'no-exchange')
      const llm = service('llm')
      if (!llm || typeof llm.stream !== 'function') return finish('no-llm', 'no-llm')
      const route = latestRoute(read.events)
      if (!route) return finish('no-route', 'no-route')
      let summary = ''
      try {
        summary = await summarizeLlm(llm, route, sid, read.pair.user, read.pair.asst)
      } catch (e) {
        const n = noteTransient(sid)
        if (n >= 3) {
          clearTransient(sid)
          try { await h.applySummaryResult({ sessionId: sid, ok: false }) } catch (e2) {}
          return finish('llm-fail', 'llm-fail')
        }
        logSummary(sid, 'llm-fail')
        return done({ ok: false, reason: 'llm-retry' })
      }
      if (!summary) {
        const n = noteTransient(sid)
        if (n >= 3) {
          clearTransient(sid)
          try { await h.applySummaryResult({ sessionId: sid, ok: false }) } catch (e3) {}
          return finish('llm-fail', 'llm-fail')
        }
        logSummary(sid, 'llm-fail')
        return done({ ok: false, reason: 'llm-empty-retry' })
      }
      clearTransient(sid)
      try { await h.applySummaryResult({ sessionId: sid, ok: true, hint: summary }) } catch (e4) {}
      return finish('ok', 'ok')
    })().then(done, function (e: any) {
      try { delete inFlight[sid] } catch (e2) {}
      return { ok: false, reason: 'error' }
    })
  }

  // deck 写成功直达：先直达编号，再顺手看首轮是否可摘要（两者都永不抛错）。直达成则清终局缓存（防先直达后注册被记死）。
  function onDeckWrite(info: any): Promise<any> {
    const sid = info && info.sessionId, key = info && info.key, title = info && info.title
    return (async function (): Promise<any> {
      try {
        const h = await naming()
        if (h && typeof h.handleDirectCreated === 'function' && sid && key) {
          const r = await h.handleDirectCreated({ sessionId: sid, key: key, title: title })
          if (r && r.attributed) clearTransient(sid)
        }
      } catch (e) {}
      try { await maybeSummarize(sid) } catch (e2) {}
      return { ok: true }
    })().catch(function () { return { ok: true } })
  }

  return { maybeSummarize: maybeSummarize, onDeckWrite: onDeckWrite }
}
