// src/host/platform/deckAgentTools.js —— 七个 deck_* 工具向 agent 注册的那一步（#741）
//
// 背景一句话：七个工具的实现与宿主装配都在，agent 的工具列表里却一个都看不见，
// 因为从来没有一处调用过工具注册。这个文件就是缺的那一步：把已装好的那张表，
// 按工具注册表认的形状交出去。执行只是转发（调那张表、回它的 value），不添业务。
//
// 住在这里的原因：同层互引门禁不许宿主层的文件互相引用，七个工具文件都在宿主层，
// 所以“替它们办注册”这件事只能落在被排除的位置（本目录与后端房间二选一；
// 房间归另一条门禁管），与装配点 deckToolsAssembly.js 同一个理由。
//
// 本文件零导入：defineTool 由调用方传进来（生产是工具包的，门禁用桩；
// 传不进来就走退路，直接按注册表认的形状交，见 registerDeckAgentTools），
// 七个工具的定义由调用方从装好的那张表里拿来，本文件只做形状转换与注册循环。
// 工具调用的日志沿用既有事件（成功失败各一行，kind 为 deck-tool），这里不新增事件。

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

function deckAgentRender(args, value) {
  const text = value && typeof value.text === 'string' ? value.text : ''
  return [{ type: 'text', text: text }]
}

/**
 * 输出的固定形状（官方写法用）：每次调用都带状态与一句话（壳里保证这两格永远是字符串），
 * 其余原样透出。渲染只取那一句话，避免把整张地图的子票清单铺进历史。
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
 * 执行入口共用：先看调用是不是已经被中止（是就直接回“没做成”，不等后端），
 * 参数再看是不是对象（不是直接回“没做成”，不进表），
 * 再调表里同名工具的 run，只回它的 value；run 抛错或回包不合形状时，
 * 包成“没做成”的信封。工具永不把异常抛给 agent。
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
    const value = back && back.value
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
 * 自举钩子：接线装好表之后调一次，把七个工具交到 agent 手上（#741 缺的就是这一步）。
 * ctx 是宿主上下文（工具服务从它身上取，取不到会等几轮）；
 * getTable 取已装好的那张表；loadDefineTool 拿工具包的定义函数（拿不到就走退路）。
 * 防御式防火即发：任何一步走不通都只吞掉，宿主绝不因此起不来。
 * 工具服务可能比我们晚就绪（行顺序不保证），取不到就等两秒再取，最多五次；
 * 五次都没有就认了——这种环境本来就没有 agent 工具可交。
 */
export function hookDeckAgentTools(ctx, getTable, loadDefineTool) {
  function toolsSvcOf() {
    try { return (ctx && (ctx.tools || (typeof ctx.get === 'function' && ctx.get('tools')))) || null } catch (eS) { return null }
  }
  function later(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }
  try {
    Promise.resolve().then(function () { return getTable() }).then(function (built) {
      function attempt(left) {
        const svc = toolsSvcOf()
        if (!svc || typeof svc.register !== 'function') {
          if (left > 0) return later(2000).then(function () { return attempt(left - 1) })
          return null
        }
        return Promise.resolve(typeof loadDefineTool === 'function' ? loadDefineTool() : null).then(function (m) {
          const defineTool = m && typeof m.defineTool === 'function' ? m.defineTool : null
          try { return registerDeckAgentTools(svc, built, defineTool) } catch (eR) { return null }
        }).catch(function () { return null })
      }
      return attempt(5)
    }).catch(function () {})
  } catch (e0) {}
}
