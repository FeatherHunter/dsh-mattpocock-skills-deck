// src/shared/deck-tools/agent-register.js —— 七个 deck_* 工具向 agent 注册的那一步（#741）
// 七个工具的实现与宿主装配都在，agent 列表却看不见，因为从没人调过注册。
// 住共享层因为两边都要用（宿主接线与 agent 行模块），四层各自内部禁互引，零导入是唯一的住法。
// defineTool 由调用方传（生产是工具包，门禁用仓库开发依赖里的真实现）；传不进来走退路。
// 日志沿用既有事件不新增（调用走 host.call，注册结果见 makeDeckRegisterReport）。

/** 短散列（错误原因只记指纹，不记原文；与共享壳里那把同算法，零导入所以自带一份）。 */
function hash8(text) {
  let h = 5381
  const t = String(text || '')
  for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

/** 单次执行允许的最长时间（毫秒）：盖住批量建票在正常网络下的最坏情况；超预算的调用壳里已经提前拦下。 */
export const AGENT_TOOL_TIMEOUT_MS = 120000

/** 注册表参数写法里允许的键（超出的一律不透出，宁可缺件也不让注册表报错）。 */
const ANNOTATION_KEYS = ['description', 'title', 'default', 'examples']
const SCALAR_TYPES = ['string', 'number', 'integer', 'boolean']

function isRecord(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

/**
 * 把一段参数模式译成注册表认的写法。译不出来回 null（调用方记缺件，不硬上）。
 * 规则只有三条：必填数组转成按属性的必填标记；对象节点必带显式的 additionalProperties
 * （原文没写就按“开”处理，和今天不校验时的行为一致）；注册表不认的键直接丢掉。
 */
function toAgentProperty(node) {
  if (!isRecord(node)) return null
  const out = {}
  for (const k of ANNOTATION_KEYS) if (node[k] !== undefined) out[k] = node[k]
  const t = node.type
  if (t === 'array') {
    const items = toAgentProperty(node.items || {})
    if (!items) return null
    out.type = 'array'
    out.items = items
    return out
  }
  if (t === 'object') {
    const props = isRecord(node.properties) ? node.properties : {}
    const required = Array.isArray(node.required) ? node.required : []
    const converted = {}
    for (const key of Object.keys(props)) {
      const child = toAgentProperty(props[key])
      if (!child) return null
      if (required.indexOf(key) >= 0) child.required = true
      converted[key] = child
    }
    out.type = 'object'
    out.properties = converted
    out.additionalProperties = (typeof node.additionalProperties === 'boolean') ? node.additionalProperties : true
    return out
  }
  if (SCALAR_TYPES.indexOf(t) >= 0) {
    out.type = t
    if (node.enum !== undefined) out.enum = node.enum
    if (node.const !== undefined) out.const = node.const
    return out
  }
  return null
}

/**
 * 把整个参数表译成注册表要的那种“属性清单”写法。顶层是 {type:'object', properties}
 * 的形状；空属性就是不要参数的工具（如看工作区的那个）。
 */
export function toAgentParameterSpec(parameters) {
  if (!isRecord(parameters) || !isRecord(parameters.properties)) return null
  const required = Array.isArray(parameters.required) ? parameters.required : []
  const spec = {}
  for (const key of Object.keys(parameters.properties)) {
    const child = toAgentProperty(parameters.properties[key])
    if (!child) return null
    if (required.indexOf(key) >= 0) child.required = true
    spec[key] = child
  }
  return spec
}

// 明细交给模型时要守的两个上限（#809）。各工具自己的参数（comments / limit / frontierOnly）
// 才是日常旋钮，这两个是兜底：单个长段最多给多少字符、整份明细最多给多少字符。
// 8000 按「一段票正文或一条评论正文」的常见长度取；60000 约两万 token 量级，够放满一屏明细，
// 又不至于把对话历史冲爆。压掉的地方一律原地写明，不让人误以为拿全了。
const DETAIL_STRING_CAP = 8000
const DETAIL_TOTAL_CAP = 60000

// 往下传余量的投影：字符串超了按余量截；数组装不下时整项不送并说清丢了几项；对象装不下时把
// 装不下的字段名列出来。输出的形状始终是合法 JSON，模型能直接解析，不必从半截 JSON 里猜。
// 嵌套深到 12 层就停并说明，不再往里钻——回包里不会有比这更深的结构，钻下去只会栈溢出。
//
// 余量必须放在一个共享对象里往下传，不能按值传：按值传的话，子级花掉的额度不会归还给父级，
// 父级仍拿原额度去量子级，于是「正好填满预算」的子级会被误判成超了而整块丢掉——
// 一张带五十条评论的票就会只得到一句「comments 未带回」。
// 括号、逗号、引号、键名这些结构开销是估算着扣的，不是精确值；单个字符串还有 8000 的上限
// 兜着，误差有界。
function projectDetail(v, budget, depth) {
  if (depth > 12) return '（这里嵌套太深，没有展开）'
  if (typeof v === 'string') {
    const cap = Math.min(budget.left, DETAIL_STRING_CAP)
    const s = v.length <= cap ? v : v.slice(0, cap) + '……（本段已截断，原长 ' + v.length + ' 字符）'
    budget.left -= s.length
    return s
  }
  if (Array.isArray(v)) {
    budget.left -= 2
    const out = []
    let cut = 0
    for (let i = 0; i < v.length; i++) {
      if (out.length) budget.left -= 1
      if (budget.left <= 0) { cut += v.length - i; break }
      out.push(projectDetail(v[i], budget, depth + 1))
    }
    if (cut) out.push('……（此处还有 ' + cut + ' 项未带回）')
    return out
  }
  if (v !== null && typeof v === 'object') {
    budget.left -= 2
    const out = {}
    const cut = []
    for (const k of Object.keys(v)) {
      if (Object.keys(out).length) budget.left -= 1
      budget.left -= k.length + 3
      if (budget.left <= 0) { cut.push(k); continue }
      out[k] = projectDetail(v[k], budget, depth + 1)
    }
    if (cut.length) out.__未带回 = '未带回的字段：' + cut.join('、') + '（超出总量上限）'
    return out
  }
  return v
}

// 挑出值得交给模型的那几格：data 是各工具的明细；items 装着建票与补边逐条的落点证据
// （deck_map_link 的说明承诺「如实回报这条边落在哪一列」就靠它）；readBack 是写后回读核对，
// 但 deck_issue_patch 已经把同一份放进 data.ticket（deckIssuePatch.js:159/161），两处都送会让
// 同一份内容进历史两遍、白吃预算，所以认得出同一份就只送一次。顶层的 cost / touched 是运行
// 元数据（touched 恒为空数组）不送；deck_context 的 data 里那几格 workspace / backend / repo /
// quota / howto 本来就是它要给 AI 看的内容，照送不误。
function detailBlock(v) {
  const pick = {}
  if (v.data !== undefined && v.data !== null) pick.data = v.data
  if (Array.isArray(v.items) && v.items.length) pick.items = v.items
  const d = pick.data
  const sameTicket = d !== null && typeof d === 'object' && !Array.isArray(d) && d.ticket === v.readBack
  if (v.readBack !== undefined && v.readBack !== null && !sameTicket) pick.readBack = v.readBack
  if (typeof v.reason === 'string' && v.reason) pick.reason = v.reason
  if (!Object.keys(pick).length) return ''
  let s = ''
  try { s = JSON.stringify(projectDetail(pick, { left: DETAIL_TOTAL_CAP }, 0)) || '' } catch (e) {
    return '明细（取不出来）：里面有循环引用或不可序列化的值，本次只给了上面那一句摘要。'
  }
  return '明细（JSON）：\n' + s
}

// 交给模型的全部内容：一句摘要 + 工具的如实提示 + 明细。#809 之前只回那一句摘要，正文、评论、
// 标签、子票清单、地图五区块、逐条边的落点证据，连同 notes 里的降级警告全被丢掉——工具说明
// 与代理文档都承诺这些明细，模型却一样拿不到，还会把残缺结果当完整结果用。
function deckAgentRender(args, value) {
  const v = (value && typeof value === 'object') ? value : {}
  const out = []
  const text = typeof v.text === 'string' ? v.text : ''
  if (text) out.push({ type: 'text', text: text })
  // 提示排在明细前面：它是工具对「这次拿到的不一定全」的如实警告，丢了才最危险。
  if (Array.isArray(v.notes) && v.notes.length) {
    out.push({ type: 'text', text: '本次调用的提示：\n' + v.notes.map(function (n) { return '- ' + String(n) }).join('\n') })
  }
  const detail = detailBlock(v)
  if (detail) out.push({ type: 'text', text: detail })
  return out.length ? out : [{ type: 'text', text: text || '' }]
}

/**
 * 输出的固定形状（官方写法用）：每次调用都带状态与一句话（壳里保证这两格永远是字符串），
 * 其余原样透出；渲染把摘要、提示与明细一起交给模型（见上面 deckAgentRender 与 #809）。
 * 注意这是定义函数的写法（必填按属性标）；退路另有一份原生写法，见下。
 */
export function deckAgentOutputSpec() {
  return {
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', required: true },
        text: { type: 'string', required: true },
      },
      additionalProperties: true,
    },
    render: deckAgentRender,
  }
}

/**
 * 输出的固定形状（退路用，直接交注册表）：内容与上面同一份，但写成原生模式——
 * 必填写成字符串数组挂在对象节点上。退路不经过定义函数的编译，
 * 上面那种按属性标必填的写法交过去会被注册表当场拒绝（七个一个都交不出去），
 * 2026-09-26 真机验证时就是栽在这里。
 */
export function deckAgentOutputSchemaRaw() {
  return {
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['status', 'text'],
      additionalProperties: true,
    },
    render: deckAgentRender,
  }
}

/**
 * 由一张工具定义拼出注册选项（名字、描述、参数、输出都在这里定死）。
 * 拼不出来回 null，调用方记缺件。
 */
export function buildAgentToolOptions(definition) {
  const d = definition || {}
  if (typeof d.name !== 'string' || !d.name) return null
  if (typeof d.description !== 'string' || !d.description) return null
  const parameters = toAgentParameterSpec(d.parameters)
  if (!parameters) return null
  return { name: d.name, description: d.description, parameters: parameters, output: deckAgentOutputSpec() }
}

/**
 * 通道未通时的诚实执行（行模块在代执行通道接通前用它）：不碰后端，
 * 直接回“没做成”的信封并指去面板，绝不谎报成功。通道接通即退役。
 */
export function makePendingExecute(toolName) {
  const name = String(toolName || '这个工具')
  return async function () {
    return { status: 'unsupported', reason: 'not-wired', text: name + ' 的执行通道还没接通（列表可见是第一步）：请先用面板操作，进展见仓库的 BUG 单。' }
  }
}

/** 探针要看的服务清单（只记有无，不记值；通道设计就靠这份清单定）。 */
export const PROBE_SERVICES = ['tools', 'connection', 'subprocess', 'timer', 'fs', 'sessions', 'agents', 'llm', 'systemPrompt', 'sandboxPolicy', 'jobs', 'approval', 'shell', 'profileContext']

/** 探针定义：不要参数，回服务清单的 JSON 文本（诊断口，通道接通即退役）。 */
export const probeDefinition = {
  name: 'deck_probe',
  description: '诊断探针：返回 agent 上下文里有哪些服务。查 deck 工具执行通道设计时用，通道接通即退役。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}

/** 对上下文做一次服务点名，有就记有、没有就记没有（值一律不碰）。 */
export function probeServices(ctx) {
  const out = {}
  for (const name of PROBE_SERVICES) {
    let has = false
    try { const svc = ctx ? (ctx[name] !== undefined ? ctx[name] : (typeof ctx.get === 'function' ? ctx.get(name) : undefined)) : undefined; has = svc !== undefined && svc !== null } catch (e) { has = false }
    out[name] = has
  }
  return out
}

function tableNames(table) {
  const t = table || {}
  if (Array.isArray(t.names) && t.names.length) return t.names.slice()
  if (t.tools && isRecord(t.tools)) return Object.keys(t.tools)
  return []
}

function tableDefinitions(table) {
  const t = table || {}
  if (Array.isArray(t.definitions) && t.definitions.length) return t.definitions
  return []
}

/**
 * 执行入口共用：中止与坏参直接回“没做成”，再调表里同名 run，只回其 value；
 * run 认包一层 {value} 与裸信封两种形状，抛错或形状不对包成“没做成”。永不抛。
 */
function makeExecute(run) {
  return async function (args, exec) {
    const signal = exec && exec.signal
    if (signal && typeof signal.aborted === 'boolean' && signal.aborted) {
      return { status: 'unsupported', reason: 'aborted', text: '这次被中止了，没做完：请按需重调一次。' }
    }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return { status: 'unsupported', reason: 'bad-args', text: '参数不是一个对象，我没法做：请按这个工具的参数说明重调一次。' }
    }
    let back = null
    try {
      back = await run(exec, args)
    } catch (e) {
      return { status: 'unsupported', reason: 'backend-threw', text: '这次没做成（内部执行抛错，已拦下）：' + String((e && e.message) || e).slice(0, 200) }
    }
    const value = (back && back.value !== undefined) ? back.value : back
    if (value && typeof value.status === 'string' && typeof value.text === 'string') return value
    return { status: 'unsupported', reason: 'backend-threw', text: '这次没做成（工具内部没按约定回包，已拦下），请重试或走面板操作。' }
  }
}

/**
 * 批量注册。toolsSvc 是工具服务（调它的 register），table 是宿主已装好的那张表，
 * defineTool 是工具包里的定义函数（有就用它走官方写法；没有就直接按注册表认的
 * 形状交——参数本来就是编好的模式，不用现编，行为一致，只是少了调前的参数预检，
 * 而参数不是对象这一档执行入口自己拦）。
 *
 * 返回 {registered:[这次交出去的名字], missing:[{name, reason}], reason}：
 * reason 空串表示全交出去了，非空说明哪一步没走通（服务不在、表不在、
 * 注册表拒绝），调用方只记录不抛，宿主绝不因此起不来。重复调安全。
 */
export async function registerDeckAgentTools(toolsSvc, table, defineTool) {
  const names = tableNames(table)
  const defs = tableDefinitions(table)
  const defsByName = {}
  for (const d of defs) if (d && typeof d.name === 'string') defsByName[d.name] = d
  const missing = []
  if (!names.length) return { registered: [], missing: [], reason: 'empty-table' }
  if (!toolsSvc || typeof toolsSvc.register !== 'function') {
    return { registered: [], missing: names.map((n) => ({ name: n, reason: 'no-tools-service' })), reason: 'no-tools-service' }
  }
  const viaDefineTool = (typeof defineTool === 'function')
  const registered = []
  for (const name of names) {
    const def = defsByName[name]
    const run = table && table.tools && table.tools[name] && table.tools[name].run
    if (typeof run !== 'function') { missing.push({ name: name, reason: 'no-table-run' }); continue }
    const execute = makeExecute(run)
    let toRegister = null
    if (viaDefineTool) {
      const options = buildAgentToolOptions(def)
      if (!options) { missing.push({ name: name, reason: 'unsupported-definition' }); continue }
      toRegister = {
        name: options.name,
        description: options.description,
        parameters: options.parameters,
        timeoutMs: AGENT_TOOL_TIMEOUT_MS,
        output: options.output,
        execute: execute,
      }
    } else {
      // 工具包没装好时的退路：直接按注册表认的形状交。参数用定义里编好的那份
      // （它本来就是编好的模式），输出与执行和官方写法同一份。
      if (!def || typeof def.name !== 'string' || !def.name) { missing.push({ name: name, reason: 'unsupported-definition' }); continue }
      if (typeof def.description !== 'string' || !def.description) { missing.push({ name: name, reason: 'unsupported-definition' }); continue }
      if (!isRecord(def.parameters)) { missing.push({ name: name, reason: 'unsupported-definition' }); continue }
      toRegister = {
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        timeoutMs: AGENT_TOOL_TIMEOUT_MS,
        output: deckAgentOutputSchemaRaw(),
        execute: execute,
      }
    }
    try {
      toolsSvc.register(viaDefineTool ? defineTool(toRegister) : toRegister)
    } catch (e) {
      missing.push({ name: name, reason: String((e && e.message) || e).slice(0, 200) })
      continue
    }
    registered.push(name)
  }
  const reason = missing.length
    ? 'register-failed:' + missing.map((m) => m.name).join(',')
    : (registered.length ? '' : 'already-registered')
  return { registered: registered, missing: missing, reason: reason }
}

/**
 * 注册结果的报告函数（接线传给钩子）：只落在既有的两个事件上，不新增事件名。
 * 交出去至少一个记 info 的 host.call；一个没交出去记 warn 的 host.call.fail，
 * 原因只记散列不记原文，缺哪种依赖（服务不在、表不在）与跑起来失败分开标。
 * logCtx 没有或报告抛错都只吞掉——报告绝不能把宿主带崩。
 */
export function makeDeckRegisterReport(logCtx) {
  return function report(info) {
    try {
      if (!logCtx || typeof logCtx.fire !== 'function') return
      const at = info || {}
      if (at.ok === true) {
        logCtx.fire('info', 'host.call', { method: 'deck.agentRegister', latencyMs: typeof at.ms === 'number' ? at.ms : 0, ok: true, kind: 'deck-tool' })
        return
      }
      const reason = String(at.reason || 'unknown')
      logCtx.fire('warn', 'host.call.fail', { method: 'deck.agentRegister', kind: 'deck-tool', errorHash: hash8(reason), errorKind: (/no-tools-service|no-table|empty-table/.test(reason) ? 'missing-dep' : 'throw') })
    } catch (e) {}
  }
}
/**
 * 自举钩子：接线装好表之后调一次，把七个工具交到 agent 手上（#741 缺的就是这一步）。
 * ctx 是宿主上下文（工具服务从它身上取，取不到会等几轮）；
 * getTable 取已装好的那张表；loadDefineTool 拿工具包的定义函数（拿不到就走退路）。
 * report 可选：每到一个终点调一次（交出去/没交出去），接线拿它落日志。
 * 防御式防火即发：任何一步走不通都只吞掉，宿主绝不因此起不来。
 * 工具服务可能比我们晚就绪（行顺序不保证），取不到就等几轮再取；
 * 轮数与间隔可配，缺省五轮、每轮两秒，都用完就认了。
 */
export function hookDeckAgentTools(ctx, getTable, loadDefineTool, report, opts) {
  const o = opts || {}
  const retries = (typeof o.retries === 'number' && o.retries >= 0) ? Math.floor(o.retries) : 5
  const waitMs = (typeof o.waitMs === 'number' && o.waitMs >= 0) ? Math.floor(o.waitMs) : 2000
  const t0 = Date.now()
  function tell(info) { try { if (typeof report === 'function') report(info) } catch (eR) {} }
  function toolsSvcOf() {
    try { return (ctx && (ctx.tools || (typeof ctx.get === 'function' && ctx.get('tools')))) || null } catch (eS) { return null }
  }
  function later(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }
  // 取表也重试（2026-09-26）：启动时后端注册表/平台可能还没就绪，旧代码取一次失败就认了，
  // deck 工具永不注册。表就绪后再进服务等待。
  function table(left) {
    return Promise.resolve().then(function () { return getTable() }).then(function (built) {
      if (built && built.tools) return built
      if (left > 0) return later(waitMs).then(function () { return table(left - 1) })
      return null
    }).catch(function () { return null })
  }
  try {
    table(retries).then(function (built) {
      if (!built || !built.tools) { tell({ ok: false, reason: 'no-table' }); return null }
      function attempt(left) {
        const svc = toolsSvcOf()
        if (!svc || typeof svc.register !== 'function') {
          if (left > 0) return later(waitMs).then(function () { return attempt(left - 1) })
          tell({ ok: false, reason: 'no-tools-service' })
          return null
        }
        return Promise.resolve(typeof loadDefineTool === 'function' ? loadDefineTool() : null).then(function (m) {
          const defineTool = m && typeof m.defineTool === 'function' ? m.defineTool : null
          let res = null
          try { res = registerDeckAgentTools(svc, built, defineTool) } catch (eR) { res = null }
          return Promise.resolve(res).then(function (r) {
            if (!r) { tell({ ok: false, reason: 'register-threw' }); return null }
            if (r.missing && r.missing.length) { tell({ ok: false, reason: String(r.reason || 'register-failed') }); return r }
            if (r.registered && r.registered.length) { tell({ ok: true, ms: Date.now() - t0 }); return r }
            return null
          })
        }).catch(function () { return null })
      }
      return attempt(retries)
    }).catch(function () {})
  } catch (e0) {}
}
