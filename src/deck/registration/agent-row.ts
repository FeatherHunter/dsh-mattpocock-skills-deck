// src/deck/registration/agent-row.ts —— agent 层的行模块（#741）
// （旧 src/host/platform/deckToolsRow.js，#1019 机械搬家只挪位置不改行为。）
//
// 这一行跑在 agent 层（官方教程的正规路：名字、注入工具服务、应用函数），
// 与宿主插件那一行互不干扰。宿主插件里的兼容钩子留着（别的产品可能是同一容器）。
// 住在平台区的原因与装配点一样：行模块要读九个工具文件里的定义，
// 宿主层的文件之间不许互相引用，平台区是被排除的位置。
//
// 九个工具的执行在代执行通道接通前用诚实占位（只回“还没接好”并指去面板），
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
// 测试重心在退路（#1030 Q5）：接线固定给 defineTool 传空，退路即线上实际走的路。
import { definition as deckContextDef } from '../tools/context.js'
import { definition as deckIssueGetDef } from '../tools/issue-get.js'
import { definition as deckMapSnapshotDef } from '../tools/map-snapshot.js'
import { definition as deckIssueListDef } from '../tools/issue-list.js'
import { definition as deckIssueCreateDef } from '../tools/issue-create.js'
import { definition as deckMapPlanCreateDef } from '../tools/map-plan-create.js'
import { definition as deckMapLinkDef } from '../tools/map-link.js'
import { definition as deckIssuePatchDef } from '../tools/issue-patch.js'
import { definition as deckIssueReportDef } from '../tools/issue-report.js'
import { AGENT_TOOL_TIMEOUT_MS, deckAgentOutputSchemaRaw, makePendingExecute, probeDefinition, probeServices } from './register-options.js'
import { awaitDeckTable, peekDeckTable, readDeckGate, noteDeckPath, readDeckPath } from '../shell/table-cell.js'

/** 运行环境里的进程对象（类型-only 声明，不影响运行时；行模块只读环境变量名，不读值）。 */
declare const process: { env: Record<string, string | undefined> } | undefined;
/** 未知形状的对象（调用方上下文、会话、回包都先按这形接住，守卫逐格验，不猜）。 */
type UnknownRecord = Record<string, unknown>;
/** 工具定义：名字、描述、参数三格齐才算可交，缺一格即跳过（行不整体掀翻）。 */
interface DeckToolDefinition { name: unknown; description: unknown; parameters: unknown }
/** 交给注册表的纯数据形状：只交数据对象，不经过创建函数（零框架引用，见文件头）。 */
type RawRegistration = { name: string; description: string; parameters: UnknownRecord; timeoutMs: number; output: UnknownRecord; execute: (args: unknown, exec: unknown) => Promise<unknown> };
/** 会话线索：工作区目录与会话号，只从调用方上下文里取，不从模型参数里取（模型伪造不了别人的目录）。 */
export interface SessionHint { cwd: string; sessionId: string }
/** 三路路由的调用载荷：工具名、参数、会话线索，都不通才回诚实占位。 */
interface DeckRpcPayload { tool: unknown; args: unknown; session: SessionHint }
/** 调用方传进来的中止信号（只读 aborted 与订阅/退订，原生方法必须挂在原对象上调，不许摘下来单调）。 */
type AbortLike = { aborted?: unknown; addEventListener?: (type: string, listener: () => void, opts: { once: boolean }) => void; removeEventListener?: (type: string, listener: () => void) => void };
/** 宿主回来的三态值：成功、部分成功、做不到都在值里表达，不抛。 */
interface HostValue { status: string; text: string; reason?: unknown }

export const name = 'dsh-mattpocock-skills-deck-tools'
export const inject = ['tools']

/** 九个工具定义（顺序与 tool-order.ts 的 DECK_TOOL_ORDER 一致；这里只负责传全，顺序的真源在那一处）。 */
const NINE = [deckContextDef, deckIssueGetDef, deckMapSnapshotDef, deckIssueListDef, deckIssueCreateDef, deckMapPlanCreateDef, deckMapLinkDef, deckIssuePatchDef, deckIssueReportDef] as const
/** 编译期锁死九个：多数少一个这里就报错，不等跑起来才发现（#1030 Q1 按九个验收）。 */
const _assertNineTools: 9 = NINE.length;

function isRecord(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) }

// 探针扩展（只加在行里，不进共享层）：旧的 14 个有无原样保留，
// 新加的只报键名与有无，不报任何值。值里可能有令牌和路径，一律不碰。
// 共享层文件有单文件行数上限，探针细节住在行里，行仍在上限内。
// 通道设计就靠这份清单定，通道接通即退役。
const PROBE_KEY_LIMIT = 100

// 探针干跑等表与代执行等格的两处上限（毫秒）：超时都按无表或无格跳过、走下一路，永不抛。
// 干跑只看一眼不能久等，给 8000；同进程格是宿主装表直达的行内快路，给 25000，超时走直连与同源请求。
// 两处数值与位置全冻（讨论 #1030 Q4）：改数字等于改失败路径证据，另立票才动。
const BRIDGE_DRY_TABLE_WAIT_MS = 8000
const DELEGATED_CELL_WAIT_MS = 25000

function safeKeyList(obj: unknown, limit: unknown): string[] {
  const cap = (typeof limit === 'number' && limit > 0) ? Math.floor(limit) : PROBE_KEY_LIMIT
  try {
    if (obj === null || typeof obj !== 'object') return []
    const keys = Object.keys(obj)
    const out: string[] = []
    for (let i = 0; i < keys.length && out.length < cap; i++) {
      if (typeof keys[i] === 'string' && keys[i]) out.push(keys[i])
    }
    out.sort()
    return out
  } catch (e) { return [] }
}

async function probeDetails(ctx: unknown, exec: unknown): Promise<UnknownRecord> {
  const out: UnknownRecord = probeServices(ctx)
  const ctxObj = ctx as UnknownRecord | null;
  try {
    out.ctxKeys = (ctxObj && typeof ctxObj === 'object') ? safeKeyList(ctxObj, PROBE_KEY_LIMIT) : []
  } catch (e) { out.ctxKeys = [] }
  try {
    let holder: unknown = null
    if (ctxObj && typeof ctxObj === 'object' && ctxObj.profileContext !== undefined && ctxObj.profileContext !== null) holder = ctxObj.profileContext
    else if (ctxObj && typeof (ctxObj as { get?: unknown }).get === 'function') { try { holder = ((ctxObj as { get: (key: string) => unknown }).get)('profileContext') } catch (e2) { holder = null } }
    out.profileContextKeys = (holder && typeof holder === 'object') ? safeKeyList(holder, PROBE_KEY_LIMIT) : []
  } catch (e3) { out.profileContextKeys = [] }
  try {
    const e = (exec || {}) as UnknownRecord;
    const agent = e.agent as UnknownRecord | undefined;
    const session = (agent && agent.session) || e.session || null
    out.sessionKeys = (session && typeof session === 'object') ? safeKeyList(session, PROBE_KEY_LIMIT) : []
  } catch (e4) { out.sessionKeys = [] }
  try {
    let fetchHas = false
    let webSocketHas = false
    let processHas = false
    let windowHas = false
    try { fetchHas = typeof fetch === 'function' } catch (e5) { fetchHas = false }
    try { webSocketHas = typeof WebSocket === 'function' } catch (e6) { webSocketHas = false }
    try { processHas = typeof process !== 'undefined' && process !== null && typeof (process as { execPath?: unknown }).execPath === 'string' } catch (e7) { processHas = false }
    try { windowHas = typeof window !== 'undefined' && window !== null } catch (e8) { windowHas = false }
    out.globalCaps = { fetch: fetchHas, webSocket: webSocketHas, process: processHas, window: windowHas }
  } catch (e9) { out.globalCaps = { fetch: false, webSocket: false, process: false, window: false } }
  try {
    if (typeof process === 'undefined' || !process || !process.env || typeof process.env !== 'object') out.envKeys = []
    else {
      const keys = Object.keys(process.env)
      const kept: string[] = []
      for (let i = 0; i < keys.length; i++) {
        if (typeof keys[i] === 'string' && /DSH|PORT|HOST|ADDRESS|URL/i.test(keys[i])) kept.push(keys[i])
        if (kept.length >= PROBE_KEY_LIMIT) break
      }
      kept.sort()
      out.envKeys = kept
    }
  } catch (e10) { out.envKeys = [] }
  // 同进程共享格一眼：表在不在、是不是同一进程（pid 只在进程内比对，永不外发）。
  try {
    const peek = peekDeckTable() as { sameProcess?: unknown } | null;
    out.bridgeTableReady = !!peek
    out.bridgeSameProcess = peek ? !!peek.sameProcess : false
  } catch (e11) { out.bridgeTableReady = false; out.bridgeSameProcess = false }
  // 干跑：用探针这次调用的上下文走一遍格子里的看工作区工具，只报阶段码与状态码，
  // 正文一律不报（正文里带目录原文）。远程一眼看出卡在哪一段。
  out.bridgeDryHint = false
  out.bridgeDryRun = 'skipped'
  out.bridgeDryStatus = ''
  out.bridgeDryReason = ''
  out.bridgeTools = []
  out.bridgeGateNotes = []
  out.bridgeLastPath = { tool: '', via: '' }
  try {
    try { out.bridgeGateNotes = readDeckGate() as unknown[] } catch (eNotes) { out.bridgeGateNotes = [] }
    try { out.bridgeLastPath = readDeckPath() as { tool: unknown; via: unknown } } catch (ePath) { out.bridgeLastPath = { tool: '', via: '' } }
  } catch (eNotesOuter) { out.bridgeGateNotes = []; out.bridgeLastPath = { tool: '', via: '' } }
  try {
    const hint = sessionHintOf(exec)
    out.bridgeDryHint = !!hint
    const table = hint ? await (awaitDeckTable(BRIDGE_DRY_TABLE_WAIT_MS) as Promise<{ names?: unknown; tools?: UnknownRecord } | null>) : null
    if (!table) { out.bridgeDryRun = hint ? 'no-table' : 'no-hint' }
    else {
      try { out.bridgeTools = Array.isArray(table.names) ? (table.names as unknown[]).slice(0, 16) : [] } catch (eNames) { out.bridgeTools = [] }
      const deckContext = table.tools ? table.tools.deck_context as { run?: unknown } | undefined : undefined;
      const run = deckContext && deckContext.run
      if (typeof run !== 'function') { out.bridgeDryRun = 'no-run' }
      else {
        let back: unknown = null
        try { back = await (run as (exec: unknown, args: unknown) => Promise<unknown>)({ agent: { session: { cwd: (hint as SessionHint).cwd, id: (hint as SessionHint).sessionId } } }, {}) } catch (eRun) { back = null }
        const backObj = back as { value?: unknown } | null;
        const value = (backObj && backObj.value !== undefined ? backObj.value : back) as HostValue | null;
        if (value && typeof value.status === 'string' && typeof value.text === 'string') {
          out.bridgeDryRun = 'ok'
          out.bridgeDryStatus = value.status
          out.bridgeDryReason = typeof value.reason === 'string' ? value.reason : ''
        } else { out.bridgeDryRun = back === null ? 'threw' : 'bad-shape' }
      }
    }
  } catch (e12) { out.bridgeDryRun = 'threw' }
  return out
}

function toRawRegistration(def: unknown, ctx: unknown): RawRegistration | null {
  const d = (def || {}) as DeckToolDefinition;
  if (typeof d.name !== 'string' || !d.name) return null
  if (typeof d.description !== 'string' || !d.description) return null
  if (!isRecord(d.parameters)) return null
  return {
    name: d.name,
    description: d.description,
    parameters: d.parameters,
    timeoutMs: AGENT_TOOL_TIMEOUT_MS,
    output: deckAgentOutputSchemaRaw() as unknown as UnknownRecord,
    execute: makeDelegatedExecute(d.name, ctx),
  }
}

// 代执行调用（第二批 + 定案）：三条路由先同进程共享格、再直连调用面、再同源请求，
// 都不通才回诚实占位（与第一批同一句话）。
// 同进程是上游组合的原文保证（同一份组合、工具注册表全局加作用域分层，
// 预设行经作用域读全局层）：宿主装好的那张表经共享格直达行，不经任何调用面。
// 会话目录只从调用方上下文里取（平台给的元数据），不从模型参数里取，模型伪造不了别人的目录。
// 超时与中止一律收成做不到的三态，不抛。
function sessionHintOf(exec: unknown): SessionHint | null {
  // 取值口径与壳的 sessionContextOf 同源（会话六个位置），另加 header 位：
  // 真机探针证明工具执行上下文里的会话顶层没有目录，目录住在 header 里。
  // 读的永远是平台给的调用方上下文，不是模型参数，模型伪造不了别人的目录。
  try {
    const e = (exec || {}) as UnknownRecord;
    const agent = (e.agent || {}) as UnknownRecord;
    const session = (agent.session || e.session || null) as UnknownRecord | null;
    const cands: unknown[] = []
    try {
      if (session && typeof session === 'object') {
        cands.push(session.cwd)
        cands.push(session.workspaceRoot)
        if (session.workspace && typeof session.workspace === 'object') cands.push((session.workspace as UnknownRecord).cwd)
        const header = session.header as UnknownRecord | null | undefined;
        if (header && typeof header === 'object') { cands.push(header.cwd); cands.push(header.workspaceRoot) }
      }
      cands.push(agent.cwd)
      if (e.session && typeof e.session === 'object') cands.push((e.session as UnknownRecord).cwd)
      cands.push(e.cwd)
    } catch (ePick) {}
    let cwd = ''
    for (let i = 0; i < cands.length; i++) {
      if (typeof cands[i] === 'string' && (cands[i] as string).trim()) { cwd = (cands[i] as string).trim(); break }
    }
    if (!cwd) return null
    let id = ''
    try {
      if (session && typeof session === 'object') {
        if (typeof session.id === 'string' && session.id) id = session.id
        else if (typeof session.sessionId === 'string' && session.sessionId) id = session.sessionId
        else if (session.header && typeof session.header === 'object') {
          const header = session.header as UnknownRecord;
          if (typeof header.id === 'string' && header.id) id = header.id
          else if (typeof header.sessionId === 'string' && header.sessionId) id = header.sessionId
        }
      }
      if (!id && typeof agent.sessionId === 'string') id = agent.sessionId
    } catch (eId) {}
    return { cwd: cwd, sessionId: id }
  } catch (e2) { return null }
}

function nextRpcId(): string {
  try {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
    let out = 'deck-'
    for (let i = 0; i < 16; i++) out += abc[Math.floor(Math.random() * abc.length)]
    return out.slice(0, 32)
  } catch (e) { return 'deck-fallback-id' }
}

function pickHostValue(raw: unknown): HostValue | null {
  try {
    if (raw === null || typeof raw !== 'object') return null
    const rawObj = raw as UnknownRecord;
    const result = (rawObj.result !== undefined ? rawObj.result : raw) as UnknownRecord | null;
    if (!result || typeof result !== 'object') return null
    if (result.ok === true && result.value && typeof (result.value as HostValue).status === 'string' && typeof (result.value as HostValue).text === 'string') return result.value as HostValue
    if (typeof result.status === 'string' && typeof result.text === 'string' && result.ok === undefined) return result as unknown as HostValue
    return null
  } catch (e) { return null }
}

async function callViaConnection(ctx: unknown, payload: DeckRpcPayload): Promise<HostValue | null> {
  const ctxObj = ctx as UnknownRecord & { get?: (key: string) => unknown } | null;
  const cands: { rpc: { call: (path: string, method: string, params: unknown) => Promise<unknown> } }[] = []
  try { const conn = ctxObj && (ctxObj.connection as { rpc?: { call?: unknown } } | undefined); if (conn && conn.rpc && typeof conn.rpc.call === 'function') cands.push(ctxObj.connection as { rpc: { call: (path: string, method: string, params: unknown) => Promise<unknown> } }) } catch (e) {}
  try {
    if (ctxObj && typeof ctxObj.get === 'function') {
      const got = (ctxObj.get('connection')) as { rpc?: { call?: unknown } } | null;
      if (got && got.rpc && typeof got.rpc.call === 'function' && cands.indexOf(got as { rpc: { call: (path: string, method: string, params: unknown) => Promise<unknown> } }) < 0) cands.push(got as { rpc: { call: (path: string, method: string, params: unknown) => Promise<unknown> } })
    }
  } catch (e2) {}
  for (let i = 0; i < cands.length; i++) {
    try {
      const res = await cands[i].rpc.call('/api', 'dsws', { method: 'deckExec', payload: payload })
      const okWrap = res as { ok?: unknown; value?: unknown } | null;
      const value = pickHostValue(okWrap && okWrap.ok === true ? { ok: true, value: okWrap.value } : res)
      if (value) return value
      const direct = pickHostValue(res)
      if (direct) return direct
    } catch (e3) { continue }
  }
  return null
}

async function callViaFetch(payload: DeckRpcPayload, signal: unknown): Promise<HostValue | null> {
  let fetchFn: ((input: string, init: UnknownRecord) => Promise<{ json: () => Promise<unknown> }>) | null = null
  try { fetchFn = typeof fetch === 'function' ? fetch as unknown as (input: string, init: UnknownRecord) => Promise<{ json: () => Promise<unknown> }> : null } catch (e) { fetchFn = null }
  if (!fetchFn) return null
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = setTimeout(function () { try { if (ctrl) ctrl.abort() } catch (e2) {} }, AGENT_TOOL_TIMEOUT_MS)
  const sigRec = signal as AbortLike | null | undefined;
  try { if (sigRec && typeof sigRec.aborted === 'boolean' && sigRec.aborted) return null } catch (e3) { return null }
  let onAbort: (() => void) | null = null
  try {
    if (sigRec && typeof sigRec.addEventListener === 'function' && ctrl) {
      onAbort = function (): void { try { if (ctrl) ctrl.abort() } catch (e4) {} }
      sigRec.addEventListener('abort', onAbort, { once: true })
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
    try { if (sigRec && typeof sigRec.removeEventListener === 'function' && onAbort) sigRec.removeEventListener('abort', onAbort) } catch (e8) {}
  }
}

function makeDelegatedExecute(toolName: unknown, ctx: unknown): (args: unknown, exec: unknown) => Promise<unknown> {
  const pending = makePendingExecute(toolName) as () => Promise<unknown>;
  const name = String(toolName || 'deck');
  function notePath(via: string): void { try { noteDeckPath(name, via) } catch (eN) {} }
  function fallthrough(): Promise<unknown> { notePath('fallback'); return pending() }
  return async function (args: unknown, exec: unknown): Promise<unknown> {
    try {
      const execObj = exec as { signal?: { aborted?: unknown } } | null | undefined;
      const signal = execObj && execObj.signal
      if (signal && typeof signal.aborted === 'boolean' && signal.aborted) {
        return { status: 'unsupported', reason: 'aborted', text: '这次被中止了，没做完：请按需重调一次。' }
      }
    } catch (e) {}
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return { status: 'unsupported', reason: 'bad-args', text: '参数不是一个对象，我没法做：请按这个工具的参数说明重调一次。' }
    }
    const hint = sessionHintOf(exec)
    if (!hint) return fallthrough()
    const payload: DeckRpcPayload = { tool: toolName, args: args, session: hint }
    // 第一路：同进程共享格（宿主装表时放进来；跨进程时格子是空的，直接跳过）。
    try {
      if (peekDeckTable()) {
        const table = await (awaitDeckTable(DELEGATED_CELL_WAIT_MS) as Promise<{ tools?: UnknownRecord } | null>)
        const entry = (table && table.tools ? table.tools[toolName as string] : undefined) as { run?: unknown } | undefined;
        const run = entry && entry.run
        if (typeof run === 'function') {
          const execLike = { agent: { session: { cwd: hint.cwd, id: hint.sessionId } } }
          let back: unknown = null
          try { back = await (run as (exec: unknown, args: unknown) => Promise<unknown>)(execLike, args) } catch (eRun) { back = null }
          const backObj = back as { value?: unknown } | null;
          const value = (backObj && backObj.value !== undefined ? backObj.value : back) as HostValue | null;
          if (value && typeof value.status === 'string' && typeof value.text === 'string') { notePath('cell'); return value }
        }
      }
    } catch (eCell) {}
    try {
      const viaConn = await callViaConnection(ctx, payload)
      if (viaConn) { notePath('connection'); return viaConn }
    } catch (e2) {}
    try {
      const execObj = exec as { signal?: unknown } | null | undefined;
      const viaFetch = await callViaFetch(payload, execObj && execObj.signal)
      if (viaFetch) { notePath('fetch'); return viaFetch }
    } catch (e3) {}
    return fallthrough()
  }
}

export function apply(ctx: unknown): void {
  const toolsSvc = (ctx as { tools?: { register?: (tool: UnknownRecord) => unknown } } | null)?.tools;
  if (!toolsSvc || typeof toolsSvc.register !== 'function') {
    throw new Error('[deckToolsRow] 工具服务不在，行起不来（注入声明了 tools，框架本应保证就绪）。')
  }
  for (const d of NINE) {
    const raw = toRawRegistration(d, ctx)
    if (!raw) continue
    try {
      toolsSvc.register(raw)
    } catch (e) { continue }
  }
  const probeOutput = {
    schema: { type: 'string' },
    render: function (args: unknown, value: unknown): { type: string; text: string }[] { return [{ type: 'text', text: value as string }] },
  };
  toolsSvc.register({
    name: probeDefinition.name,
    description: probeDefinition.description,
    parameters: probeDefinition.parameters as UnknownRecord,
    timeoutMs: AGENT_TOOL_TIMEOUT_MS,
    output: probeOutput as unknown as UnknownRecord,
    execute: async function (args: unknown, exec: unknown): Promise<unknown> { return JSON.stringify(await probeDetails(ctx, exec)) },
  } as UnknownRecord)
}
