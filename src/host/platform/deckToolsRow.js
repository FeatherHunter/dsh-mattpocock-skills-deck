// src/host/platform/deckToolsRow.js —— agent 层的行模块（#741）
//
// 这一行跑在 agent 层（官方教程的正规路：名字、注入工具服务、应用函数），
// 与宿主插件那一行互不干扰。宿主插件里的兼容钩子留着（别的产品可能是同一容器）。
// 住在平台区的原因与装配点一样：行模块要读七个工具文件里的定义，
// 宿主层的文件之间不许互相引用，平台区是被排除的位置。
//
// 七个工具的执行在代执行通道接通前用诚实占位（只回“还没接好”并指去面板），
// 另加一个探针工具回服务清单——通道设计就靠这份清单定，两个都是通道接通即退役。
//
// 为什么这里不引用工具包（零框架引用）：
// 插件一旦在发布清单里带上工具包依赖，安装时会多装一份工具包；
// 行模块再从那份引用创建工具，注册时用的就不是宿主手里那一份，
// 真机上全部工具调用会一起失败（Cannot read properties of undefined (reading 'prepare')，
// 摘掉本行即恢复，见 2026-09-26 交接记录）。
// 所以这里只交纯数据对象（名字、描述、参数、输出、执行函数），
// 注册表本来就认这种形状，不需要经过创建函数；
// 参数用定义里写好的那份原样交，输出用共享层的原生形状。
import { definition as deckContextDef } from '../tools/deckContext.js'
import { definition as deckIssueGetDef } from '../tools/deckIssueGet.js'
import { definition as deckMapSnapshotDef } from '../tools/deckMapSnapshot.js'
import { definition as deckIssueCreateDef } from '../tools/deckIssueCreate.js'
import { definition as deckMapPlanCreateDef } from '../tools/deckMapPlanCreate.js'
import { definition as deckMapLinkDef } from '../tools/deckMapLink.js'
import { definition as deckIssuePatchDef } from '../tools/deckIssuePatch.js'
import { AGENT_TOOL_TIMEOUT_MS, deckAgentOutputSchemaRaw, makePendingExecute, probeDefinition, probeServices } from '../../shared/deck-tools/agent-register.js'

export const name = 'dsh-mattpocock-skills-deck-tools'
export const inject = ['tools']

const SEVEN = [deckContextDef, deckIssueGetDef, deckMapSnapshotDef, deckIssueCreateDef, deckMapPlanCreateDef, deckMapLinkDef, deckIssuePatchDef]

function isRecord(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

// 探针扩展（只加在行里，不进共享层）：旧的 14 个有无原样保留，
// 新加的只报键名与有无，不报任何值。值里可能有令牌和路径，一律不碰。
// 共享层文件有单文件行数上限，探针细节住在行里，行仍在上限内。
// 通道设计就靠这份清单定，通道接通即退役。
const PROBE_KEY_LIMIT = 100

function safeKeyList(obj, limit) {
  const cap = (typeof limit === 'number' && limit > 0) ? Math.floor(limit) : PROBE_KEY_LIMIT
  try {
    if (obj === null || typeof obj !== 'object') return []
    const keys = Object.keys(obj)
    const out = []
    for (let i = 0; i < keys.length && out.length < cap; i++) {
      if (typeof keys[i] === 'string' && keys[i]) out.push(keys[i])
    }
    out.sort()
    return out
  } catch (e) { return [] }
}

function probeDetails(ctx, exec) {
  const out = probeServices(ctx)
  try {
    out.ctxKeys = (ctx && typeof ctx === 'object') ? safeKeyList(ctx, PROBE_KEY_LIMIT) : []
  } catch (e) { out.ctxKeys = [] }
  try {
    let holder = null
    if (ctx && typeof ctx === 'object' && ctx.profileContext !== undefined && ctx.profileContext !== null) holder = ctx.profileContext
    else if (ctx && typeof ctx.get === 'function') { try { holder = ctx.get('profileContext') } catch (e2) { holder = null } }
    out.profileContextKeys = (holder && typeof holder === 'object') ? safeKeyList(holder, PROBE_KEY_LIMIT) : []
  } catch (e3) { out.profileContextKeys = [] }
  try {
    const e = exec || {}
    const session = (e.agent && e.agent.session) || e.session || null
    out.sessionKeys = (session && typeof session === 'object') ? safeKeyList(session, PROBE_KEY_LIMIT) : []
  } catch (e4) { out.sessionKeys = [] }
  try {
    let fetchHas = false
    let webSocketHas = false
    let processHas = false
    let windowHas = false
    try { fetchHas = typeof fetch === 'function' } catch (e5) { fetchHas = false }
    try { webSocketHas = typeof WebSocket === 'function' } catch (e6) { webSocketHas = false }
    try { processHas = typeof process !== 'undefined' && process !== null && typeof process.execPath === 'string' } catch (e7) { processHas = false }
    try { windowHas = typeof window !== 'undefined' && window !== null } catch (e8) { windowHas = false }
    out.globalCaps = { fetch: fetchHas, webSocket: webSocketHas, process: processHas, window: windowHas }
  } catch (e9) { out.globalCaps = { fetch: false, webSocket: false, process: false, window: false } }
  try {
    if (typeof process === 'undefined' || !process || !process.env || typeof process.env !== 'object') out.envKeys = []
    else {
      const keys = Object.keys(process.env)
      const kept = []
      for (let i = 0; i < keys.length; i++) {
        if (typeof keys[i] === 'string' && /DSH|PORT|HOST|ADDRESS|URL/i.test(keys[i])) kept.push(keys[i])
        if (kept.length >= PROBE_KEY_LIMIT) break
      }
      kept.sort()
      out.envKeys = kept
    }
  } catch (e10) { out.envKeys = [] }
  return out
}

function toRawRegistration(def, ctx) {
  const d = def || {}
  if (typeof d.name !== 'string' || !d.name) return null
  if (typeof d.description !== 'string' || !d.description) return null
  if (!isRecord(d.parameters)) return null
  return {
    name: d.name,
    description: d.description,
    parameters: d.parameters,
    timeoutMs: AGENT_TOOL_TIMEOUT_MS,
    output: deckAgentOutputSchemaRaw(),
    execute: makeDelegatedExecute(d.name, ctx),
  }
}

// 代执行调用（第二批）：行把参数递给宿主那条代执行电话，拿真结果。
// 顺序是先直连调用面、再同源请求，两条都不通才回诚实占位（与第一批同一句话）。
// 会话目录只从调用方上下文里取（平台给的元数据），不从模型参数里取，模型伪造不了别人的目录。
// 超时与中止一律收成做不到的三态，不抛。
function sessionHintOf(exec) {
  try {
    const e = exec || {}
    const session = (e.agent && e.agent.session) || e.session || null
    if (!session || typeof session !== 'object') return null
    const cwd = typeof session.cwd === 'string' ? session.cwd.trim() : ''
    if (!cwd) return null
    const id = typeof session.id === 'string' ? session.id : (typeof session.sessionId === 'string' ? session.sessionId : '')
    return { cwd: cwd, sessionId: id }
  } catch (e2) { return null }
}

function nextRpcId() {
  try {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
    let out = 'deck-'
    for (let i = 0; i < 16; i++) out += abc[Math.floor(Math.random() * abc.length)]
    return out.slice(0, 32)
  } catch (e) { return 'deck-fallback-id' }
}

function pickHostValue(raw) {
  try {
    if (raw === null || typeof raw !== 'object') return null
    const result = raw.result !== undefined ? raw.result : raw
    if (!result || typeof result !== 'object') return null
    if (result.ok === true && result.value && typeof result.value.status === 'string' && typeof result.value.text === 'string') return result.value
    if (typeof result.status === 'string' && typeof result.text === 'string' && result.ok === undefined) return result
    return null
  } catch (e) { return null }
}

async function callViaConnection(ctx, payload) {
  const cands = []
  try { if (ctx && ctx.connection && ctx.connection.rpc && typeof ctx.connection.rpc.call === 'function') cands.push(ctx.connection) } catch (e) {}
  try {
    if (ctx && typeof ctx.get === 'function') {
      const got = ctx.get('connection')
      if (got && got.rpc && typeof got.rpc.call === 'function' && cands.indexOf(got) < 0) cands.push(got)
    }
  } catch (e2) {}
  for (let i = 0; i < cands.length; i++) {
    try {
      const res = await cands[i].rpc.call('/api', 'dsws', { method: 'deckExec', payload: payload })
      const value = pickHostValue(res && res.ok === true ? { ok: true, value: res.value } : res)
      if (value) return value
      const direct = pickHostValue(res)
      if (direct) return direct
    } catch (e3) { continue }
  }
  return null
}

async function callViaFetch(payload, signal) {
  let fetchFn = null
  try { fetchFn = typeof fetch === 'function' ? fetch : null } catch (e) { fetchFn = null }
  if (!fetchFn) return null
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = setTimeout(function () { try { if (ctrl) ctrl.abort() } catch (e2) {} }, AGENT_TOOL_TIMEOUT_MS)
  try { if (signal && typeof signal.aborted === 'boolean' && signal.aborted) return null } catch (e3) { return null }
  let onAbort = null
  try {
    if (signal && typeof signal.addEventListener === 'function' && ctrl) {
      onAbort = function () { try { ctrl.abort() } catch (e4) {} }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  } catch (e5) {}
  try {
    const body = { type: 'client-request', rpcId: nextRpcId(), payload: { method: 'deckExec', payload: payload } }
    const res = await fetchFn('/api/dsws', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    })
    if (!res || typeof res.json !== 'function') return null
    const raw = await res.json()
    return pickHostValue(raw)
  } catch (e6) { return null } finally {
    try { clearTimeout(timer) } catch (e7) {}
    try { if (signal && typeof signal.removeEventListener === 'function' && onAbort) signal.removeEventListener('abort', onAbort) } catch (e8) {}
  }
}

function makeDelegatedExecute(toolName, ctx) {
  const fallback = makePendingExecute(toolName)
  return async function (args, exec) {
    try {
      const signal = exec && exec.signal
      if (signal && typeof signal.aborted === 'boolean' && signal.aborted) {
        return { status: 'unsupported', reason: 'aborted', text: '这次被中止了，没做完：请按需重调一次。' }
      }
    } catch (e) {}
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return { status: 'unsupported', reason: 'bad-args', text: '参数不是一个对象，我没法做：请按这个工具的参数说明重调一次。' }
    }
    const hint = sessionHintOf(exec)
    if (!hint) return fallback()
    const payload = { tool: toolName, args: args, session: hint }
    try {
      const viaConn = await callViaConnection(ctx, payload)
      if (viaConn) return viaConn
    } catch (e2) {}
    try {
      const viaFetch = await callViaFetch(payload, exec && exec.signal)
      if (viaFetch) return viaFetch
    } catch (e3) {}
    return fallback()
  }
}

export function apply(ctx) {
  if (!ctx || !ctx.tools || typeof ctx.tools.register !== 'function') {
    throw new Error('[deckToolsRow] 工具服务不在，行起不来（注入声明了 tools，框架本应保证就绪）。')
  }
  for (const d of SEVEN) {
    const raw = toRawRegistration(d, ctx)
    if (!raw) continue
    try {
      ctx.tools.register(raw)
    } catch (e) { continue }
  }
  ctx.tools.register({
    name: probeDefinition.name,
    description: probeDefinition.description,
    parameters: probeDefinition.parameters,
    timeoutMs: AGENT_TOOL_TIMEOUT_MS,
    output: {
      schema: { type: 'string' },
      render: function (args, value) { return [{ type: 'text', text: value }] },
    },
    execute: async function (args, exec) { return JSON.stringify(probeDetails(ctx, exec)) },
  })
}
