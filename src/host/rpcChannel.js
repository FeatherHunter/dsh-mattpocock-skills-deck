// src/host/rpcChannel.js —— 客户端与宿主之间的 RPC 通道（#596 从 host/index.js 搬出）。
// 以后谁改它：改通道注册方式、信封校验或分发异常记账的人改它。
// 接线：由 index.js 动态 import 加载（D7 禁止静态 import）；handlers 是 index.js 的 __DSW_HANDLERS__ 表，
//   fireLog 是宿主日志发射函数（具名传入——日志埋点门禁按 fireLog/log 这类裸名认埋点落点），
//   dispatchMeta 只在记分发异常行时才去取。本文件不引用其他新文件。
//
// 为什么单独一个文件（#596）：这段协议代码把 index.js 顶过了文件粒度门禁的零增长基线，
//   而门禁要求已冻结的文件只许减不许增——搬出来既过门禁，也让通道的注册与协议自成一页。

// 通道名与载体（#596）。客户端 src/seam/rpc.js 调 conn.rpc.call('/api', 'dsws', { method, payload })，
// DSH 据此拼出请求路径 /api/dsws，与本文件注册的精确路径一致；真正的端点名在请求体里。
export const DSW_RPC_CHANNEL = 'dsws'
export const DSW_RPC_ROUTE = '/api' + '/' + DSW_RPC_CHANNEL
// 请求标识的合法形状（与 DSH 连接服务的 rpcId 同规则）。
const DSH_RPC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
// 端点名的合法形状（与 DSH 连接服务的端点段同规则；点号合法，形如 wf.probe.echo 也收）。
export const DSW_ENDPOINT_PATTERN = /^[A-Za-z0-9_$.-]+$/

function replyEnvelope(rpcId, result) {
  return Response.json({ type: 'server-response', rpcId: rpcId, result: result })
}

function rpcIdOf(raw) {
  return (typeof raw === 'string' && DSH_RPC_ID_PATTERN.test(raw)) ? raw : 'invalid-request'
}

/**
 * 建立并注册客户端 RPC 通道。
 * @param {object} deps 依赖（全部显式传入，本文件不读闭包外部名）
 * @param {object} deps.ctx 宿主插件上下文（取 connection 服务、挂 effect）
 * @param {Map<string, Function>} deps.handlers 端点表：端点名 → 处理函数
 * @param {Function} deps.fireLog 宿主日志发射：fireLog(级别, 事件名, 字段)
 * @param {() => Promise<object>} deps.dispatchMeta 分发异常行用的纯函数加载器
 * @returns {{ok:boolean, path:string, reason?:string}} 注册结果（失败原因供调用方记账，绝不静默）
 */
export function createRpcChannel(deps) {
  const ctx = deps.ctx
  const handlers = deps.handlers
  const fireLog = deps.fireLog
  const dispatchMeta = deps.dispatchMeta

  // 注册失败的可见性（原来这里是个空 catch，故障才拖了这么久）：
  // 走 #46 自监控事件 host.dispatch.error（错误级直通落盘，字段就是白名单那三键）。
  // method 写通道名而不是 wf.* 端点，errorKind 给出失败类别——一眼能分清是「通道没注册」还是「某次调用炸了」。
  const reportRegisterFail = function (kind) {
    try { fireLog('error', 'host.dispatch.error', { method: DSW_RPC_ROUTE + ' 通道注册', argsHash: '', errorKind: kind }) } catch (eLog) {}
  }

  // 一次分发：命中端点表，异常归一到 RpcResult 失败信封并留一行错误级日志（#46）。
  const dispatchRpcEndpoint = async function (endpoint, payload) {
    const fn = handlers.get(endpoint)
    if (!fn) return { ok: false, error: { code: 'internal', message: 'unknown endpoint: ' + endpoint, details: {} } }
    try {
      const value = await fn(payload)
      return { ok: true, value: value }
    } catch (e) {
      try { dispatchMeta().then(function (dm) { try { fireLog('error', 'host.dispatch.error', { method: 'wf.' + endpoint, argsHash: dm.shortArgHash(payload), errorKind: dm.dispatchErrorKind(e) }) } catch (eInner) {} }).catch(function () {}) } catch (eLog) {}
      return { ok: false, error: { code: 'internal', message: String((e && e.message) || e), details: {} } }
    }
  }

  const badRequest = function (rpcId, why) {
    return replyEnvelope(rpcId, { ok: false, error: { code: 'gateway/bad-request', message: why, details: {} } })
  }

  // 一次请求：解信封 → 取端点名与入参 → 分发 → 回信封。非 POST / 非 JSON / 信封不合规一律按协议回错，不静默。
  const routeFetch = async function (request) {
    if (!request || request.method !== 'POST') return new Response('method not allowed', { status: 405 })
    let body = null
    try { body = await request.json() } catch (eBody) { return new Response('body is not JSON', { status: 400 }) }
    const rpcId = rpcIdOf(body && body.rpcId)
    const message = body && typeof body === 'object' ? body : {}
    // 端点名与入参装在请求体里（#596）：外层是 DSH 的 client-request 信封（method 为通道名，
    // 与 DSH 自己的 api-gateway 同形），内层 payload 是 { method: 端点名, payload: 入参 }。
    const call = message.payload
    if (call === null || typeof call !== 'object') return badRequest(rpcId, 'missing call payload')
    if (message.type !== 'client-request') return badRequest(rpcId, 'invalid client-request message')
    if (typeof message.rpcId !== 'string' || !DSH_RPC_ID_PATTERN.test(message.rpcId)) return badRequest(rpcId, 'invalid rpcId')
    const endpoint = call.method
    if (typeof endpoint !== 'string' || !DSW_ENDPOINT_PATTERN.test(endpoint)) return badRequest(rpcId, 'invalid endpoint name')
    // 路径仍须落在本通道上：外层的 method 与请求路径要能相互印证，改坏了立刻拒绝（#596 正是路径对不上）。
    const pathname = String((request.url && (request.url.split('?')[0])) || '')
    if (!pathname.endsWith(DSW_RPC_ROUTE)) return badRequest(rpcId, 'request path is not on channel ' + DSW_RPC_ROUTE)
    return replyEnvelope(rpcId, await dispatchRpcEndpoint(endpoint, call.payload))
  }

  // 注册方式（#596 的关键一处）：走 connection.fetch.register 这条精确路由，不用 connection.rpc.handle。
  // 旧写法内部是 owner.effect(() => owner.webServer.register({kind:'prefix', ...}))，而那个 owner 是
  // connection 服务自己的上下文、没有 webServer 注入 → 装配期直接抛
  //   cannot get property "webServer" without inject
  // 整条通道随之消失。fetch.register 只碰同一份注册表里的精确路由分支，不需要 webServer。
  // 同款改法可参照 dsh-im-companion（它的 src/index.ts 记着同一条实测结论：往 inject 里补 webServer 无效）。
  try {
    const connection = ctx.get('connection')
    const fetchRegistry = connection !== undefined && connection !== null ? connection.fetch : undefined
    if (fetchRegistry === undefined || typeof fetchRegistry.register !== 'function') {
      reportRegisterFail('connection.fetch.register-missing')
      return { ok: false, path: DSW_RPC_ROUTE, reason: 'connection.fetch.register-missing' }
    }
    const disposed = fetchRegistry.register({
      path: DSW_RPC_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: routeFetch,
    })
    // 注册是同步生效的；返回的销毁函数交给注册表自己管，有些版本同时想挂 ctx.effect 才多挂一次，挂不上不影响路由本身。
    if (typeof disposed !== 'function' && typeof ctx.effect === 'function') {
      try { ctx.effect(function () { return function () {} }, 'dsh-mattpocock-skills-deck: ' + DSW_RPC_ROUTE) } catch (eEff) {}
    }
    return { ok: true, path: DSW_RPC_ROUTE }
  } catch (eReg) {
    // 重复注册（live patch reload / 回滚重放时同一路由已挂在别的实例名下，DSH 会抛 duplicate 文案）
    // 算让位：那个实例继续服务即可。其余错误一律记账。
    const msg = String((eReg && eReg.message) || eReg)
    const kind = (msg.indexOf('already registered') >= 0 || msg.indexOf('duplicate') >= 0) ? 'fetch-route-duplicate' : 'fetch-route-throw'
    reportRegisterFail(kind)
    return { ok: false, path: DSW_RPC_ROUTE, reason: kind }
  }
}
