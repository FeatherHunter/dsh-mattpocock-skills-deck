// src/host/platform/namingSummary.js —— 首轮全文摘要与建票直达归属的编排（#746）
//
// 住在这里的理由与 deckToolsAssembly.js 相同：平台装配扇出区，不在同层互引门禁的宿主层内，
// 因此宿主接线引用它不新增同层边；它自己只引用 src/shared（跨层放行），不引用任何宿主层文件，
// 状态读写一律走命名守护的公开方法（getEntry / applySummaryResult / handleDirectCreated）。
//
// 两件事都由已有事件触发，不起任何自续定时器（#709 口径）：
//   1. 首轮摘要 —— 写事件订阅在门后看到第一条 assistant/message，或 deck 写工具成功，调
//      maybeSummarize(sessionId)。全文版口径（用户拍板）：完整用户第一段加完整助手第一段都传给
//      模型，输出十字以内；整个会话只调一次，锁了不调，调模型失败永不补调；读不到两段、
//      没路由等未遂不记旗，后续触发可再试（触发本身只来自真实事件，不轮询）。
//   2. 建票直达 —— deck_issue_create / deck_map_plan_create 成功回调调 onDeckWrite，
//      创建上下文自带会话归属（调用会话即建号会话），直达编号，无需等索引轮询；
//      归属判定仍走共享核心（等号状态、锁、幂等收敛），在命名守护内执行。
//
// 日志：只记新事件 naming.summary（info 常驻：sidHash 会话散列、outcome 结果枚举），
//   全文一律不记原文、不记标题、不记错误原文（#489 白名单口径）；直达归属沿用调试级
//   naming.sweep（trigger direct-created），不新增事件。
import { hash8 } from '../../shared/refresh-workspace-key.js'
import { NAMING_STAGES, classifyDivergence, shouldWriteOnDivergence, DIVERGENCE } from '../../shared/naming-tracking.js'
import { newSessionTitle, composeDraftTitle } from '../../shared/naming-titles.js'

// 溢出 guard：用户拍板传全文，两段自然有界；超过此字节才截助手侧尾部（用户侧意图优先保留）。
const SUMMARY_INPUT_MAX_BYTES = 48 * 1024
const SUMMARY_TIMEOUT_MS = 30000
const SUMMARY_MAX_TOKENS = 40

function utf8Bytes(s) {
  try { return Buffer.byteLength(String(s || ''), 'utf8') } catch (e) { return String(s || '').length }
}

function cleanSummaryText(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim()
  t = t.replace(/^["'「『“‘（(\[«‹]+/, '').replace(/["'」』”’）)\]»›]+$/, '').trim()
  if (t.length > 10) t = t.slice(0, 10).trim()
  return t
}

/** 从一条消息记录里取纯文本（形状按底座三态容错：字符串 / content 块数组 / text 字段）。 */
function textOfMessage(m) {
  try {
    if (typeof m === 'string') return m
    if (!m || typeof m !== 'object') return ''
    if (Array.isArray(m.content)) {
      let out = ''
      for (let i = 0; i < m.content.length; i++) {
        const b = m.content[i]
        if (b && b.type === 'text' && typeof b.text === 'string') out += b.text
      }
      return out
    }
    if (typeof m.text === 'string') return m.text
    return ''
  } catch (e) { return '' }
}

/** 按 seq 取首个用户段与首个助手段全文（assistant/attempt 是过程态，不算第一段）。 */
function pickFirstExchange(events) {
  if (!Array.isArray(events)) return null
  const ordered = events.slice().sort(function (a, b) { return (Number(a && a.seq) || 0) - (Number(b && b.seq) || 0) })
  let user = '', asst = ''
  for (let i = 0; i < ordered.length; i++) {
    const ev = ordered[i]
    if (!ev || typeof ev.type !== 'string') continue
    if (!user && ev.type === 'user/message') user = textOfMessage(ev.data)
    else if (!asst && ev.type === 'assistant/message' && ev.data && typeof ev.data === 'object') asst = textOfMessage(ev.data.message)
    if (user && asst) break
  }
  return { user: user, asst: asst }
}

/** 取该会话最新请求头里的路由（provider/model），与底座标题包同口径（无则返回 null）。 */
function latestRoute(events) {
  if (!Array.isArray(events)) return null
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (!ev || ev.type !== 'request/header' || !ev.data || typeof ev.data !== 'object') continue
    const h = ev.data.header && typeof ev.data.header === 'object' ? ev.data.header : ev.data
    const provider = h.provider, model = h.model
    if (typeof provider === 'string' && provider && typeof model === 'string' && model) {
      return { provider: provider, model: model }
    }
  }
  return null
}

/** 纯函数导出（门禁单测用；生产只走 createNamingSummary）。 */
export { textOfMessage, pickFirstExchange, latestRoute, cleanSummaryText }

/** 读某会话首条用户消息纯文本（读而不激活；失败一律 null；截 120 字只供派生比对，不记日志）。 */
export async function readFirstUserText(ctx, sid) {
  try {
    if (!ctx || typeof ctx.get !== 'function' || !sid) return null
    const sq = ctx.get('sessionQuery')
    if (!sq) return null
    let events = null
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
    const ordered = events.slice().sort(function (a, b) { return (Number(a && a.seq) || 0) - (Number(b && b.seq) || 0) })
    for (let i = 0; i < ordered.length; i++) {
      const ev = ordered[i]
      if (ev && ev.type === 'user/message') { const t = textOfMessage(ev.data); return t ? String(t).slice(0, 120) : null }
    }
    return null
  } catch (e) { return null }
}

export function createNamingSummary(deps) {
  const d = deps || {}
  const ctx = d.ctx || null
  const getNaming = typeof d.getNaming === 'function' ? d.getNaming : null
  const logCtx = d.logCtx || null
  const inFlight = {}
  // 终局去重（第一性：终局结论不变，重记就是刷屏）。命中后连状态都不读直接回，
  // 上限 500 个会话、先来先淘汰（无定时器，#709 口径）；瞬态（未遂）不记、可再试。
  const terminalOf = new Map()
  const TERMINAL_MAX = 500
  function terminalGet(sid) { try { return terminalOf.get(sid) || null } catch (e) { return null } }
  function terminalPut(sid, reason) {
    try {
      terminalOf.set(sid, reason)
      while (terminalOf.size > TERMINAL_MAX) { const k = terminalOf.keys().next(); if (k.done) break; terminalOf.delete(k.value) }
    } catch (e) {}
  }
  const TERMINAL_REASONS = { ok: 1, 'llm-fail': 1, 'skip-locked': 1, 'skip-done': 1, 'skip-failed': 1, 'skip-stage': 1, unregistered: 1 }

  function service(name) {
    try { return (ctx && typeof ctx.get === 'function') ? ctx.get(name) : undefined } catch (e) { return undefined }
  }
  function logSummary(sid, outcome) {
    try { if (logCtx) logCtx.fire('info', 'naming.summary', { sidHash: hash8(sid), outcome: outcome }) } catch (e) {}
  }
  async function naming() {
    try { return getNaming ? await getNaming() : null } catch (e) { return null }
  }

  async function readFirstExchange(sid) {
    const sq = service('sessionQuery')
    if (!sq) return { ok: false, reason: 'no-query' }
    let events = null
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

  async function summarizeLlm(llm, route, sid, userText, asstText) {
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
    let signal = null
    try { signal = AbortSignal.timeout(SUMMARY_TIMEOUT_MS) } catch (e) { signal = undefined }
    const options = {
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

  /** 首轮摘要主入口（幂等：每会话只成功一次；失败永不补调；未遂可再试；每个终局记一行）。 */
  function maybeSummarize(sid) {
    if (!sid || inFlight[sid]) return Promise.resolve({ ok: false, reason: 'busy' })
    const cached = terminalGet(sid)
    if (cached) return Promise.resolve({ ok: cached === 'ok', reason: cached })
    inFlight[sid] = true
    const done = function (r) { try { delete inFlight[sid] } catch (e) {} return r }
    const finish = async function (outcome, reason) {
      if (TERMINAL_REASONS[outcome]) terminalPut(sid, outcome)
      logSummary(sid, outcome)
      return { ok: outcome === 'ok', reason: reason }
    }
    return (async function () {
      const h = await naming()
      let entry = null
      try { entry = h && typeof h.getEntry === 'function' ? await h.getEntry(sid) : null } catch (e) { entry = null }
      if (!entry) return finish('unregistered', 'unregistered')
      if (entry.locked) return finish('skip-locked', 'skip-locked')
      if (entry.summaryOnce) return finish('skip-done', 'skip-done')
      if (entry.summaryFailed) return finish('skip-failed', 'skip-failed')
      if (entry.stage !== NAMING_STAGES.PLACEHOLDER && entry.stage !== NAMING_STAGES.DRAFT) return finish('skip-stage', 'skip-stage')
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
        try { await h.applySummaryResult({ sessionId: sid, ok: false }) } catch (e2) {}
        return finish('llm-fail', 'llm-fail')
      }
      if (!summary) {
        try { await h.applySummaryResult({ sessionId: sid, ok: false }) } catch (e3) {}
        return finish('llm-fail', 'llm-fail')
      }
      try { await h.applySummaryResult({ sessionId: sid, ok: true, hint: summary }) } catch (e4) {}
      return finish('ok', 'ok')
    })().then(done, function (e) {
      try { delete inFlight[sid] } catch (e2) {}
      return { ok: false, reason: 'error' }
    })
  }

  /** deck 写成功直达：先直达编号，再顺手看首轮是否可摘要（两者都永不抛错）。 */
  function onDeckWrite(info) {
    const sid = info && info.sessionId, key = info && info.key, title = info && info.title
    return (async function () {
      try {
        const h = await naming()
        if (h && typeof h.handleDirectCreated === 'function' && sid && key) {
          await h.handleDirectCreated({ sessionId: sid, key: key, title: title })
        }
      } catch (e) {}
      try { await maybeSummarize(sid) } catch (e2) {}
      return { ok: true }
    })().catch(function () { return { ok: true } })
  }

  /** 宿主直执行排队单（#746：拿号改名同一刻，不等客户端拉取）。改名面缺任一样即回落（false），客户端老路照旧。 */
  async function executeOrdersHost(orders) {
    try {
      if (!Array.isArray(orders) || !orders.length) return false
      const sessions = (ctx && typeof ctx.get === 'function') ? ctx.get('sessions') : null
      if (!sessions || typeof sessions.scope !== 'function' || typeof sessions.sessionOf !== 'function' || typeof sessions.get !== 'function') return false
      const h = await naming()
      if (!h) return false
      let done = false
      for (let i = 0; i < orders.length; i++) {
        try {
          const o = orders[i]
          if (!o || !o.sessionId) continue
          const sid = o.sessionId, lock = o.lock || {}
          if (lock.locked) continue
          const scope = sessions.scope(sid)
          const face = scope ? sessions.sessionOf(scope) : null
          if (!face || typeof face.rename !== 'function') continue
          let faceSid = null
          try { faceSid = (face && (face.sessionId || face.id || face.sid)) || (scope && (scope.sessionId || scope.id || scope.sid)) } catch (eF) {}
          if (faceSid && String(faceSid) !== String(sid)) continue
          let cur = null
          try { const s = sessions.get(sid); if (s && typeof s.title === 'string' && s.title) cur = s.title } catch (eG) {}
          if (cur === null) continue
          let first = (typeof lock.firstUserText === 'string' && lock.firstUserText) ? lock.firstUserText : null
          if (!first) { try { first = await readFirstUserText(ctx, sid) } catch (eR) {} }
          // 分歧归因只问共享核心一处：让位就记账并把理由带走（日志别再一律写「用户改的」）。
          const code = classifyDivergence({ currentTitle: cur, lastMachineTitle: lock.lastMachineTitle, baselineIsOurs: lock.baselineIsOurs, firstUserText: first })
          if (code === DIVERGENCE.UNKNOWN_TITLE) continue
          if (!shouldWriteOnDivergence(code)) { if (code === DIVERGENCE.HAND_EDIT) { try { await h.handleNamingResult({ sessionId: sid, outcome: 'locked', reason: code }) } catch (eLk) {} } continue }
          let target = null
          if (o.kind === 'numbered') {
            const num = Number(o.number)
            if (!isFinite(num) || num <= 0) continue
            try { target = newSessionTitle({ number: num, title: o.title || '' }) } catch (eT) { continue }
          } else if (o.kind === 'draft') {
            const probe = String((lock.baselineTitle || '') + ' ' + (o.hint || ''))
            const lang = /[\u4e00-\u9fff]/.test(probe) ? 'zh' : 'en'
            try { target = composeDraftTitle({ hint: o.hint, lang: lang, baselineTitle: lock.baselineTitle || '' }) } catch (eD) { continue }
          } else continue
          if (!target) continue
          // 写前二次确认标题未变（title changed before rename 则跳过，TOCTOU 关口；与客户端同源判据）。
          let cur2 = null
          try { const s2 = sessions.get(sid); if (s2 && typeof s2.title === 'string' && s2.title) cur2 = s2.title } catch (eG2) {}
          if (cur2 !== cur) continue
          const r = await face.rename(target)
          if (r && r.ok) {
            try { await h.handleNamingResult({ sessionId: sid, outcome: 'renamed', title: (r.value && r.value.title) || target }) } catch (eH) {}
            try { if (logCtx) logCtx.fire('info', 'naming.guard', { sidHash: hash8(sid), outcome: 'renamed', hintHash: hash8(o.hint || '') }) } catch (eL) {}
            done = true
          }
        } catch (eO) {}
      }
      return done
    } catch (e) { return false }
  }

  return { maybeSummarize: maybeSummarize, onDeckWrite: onDeckWrite, executeOrdersHost: executeOrdersHost }
}
