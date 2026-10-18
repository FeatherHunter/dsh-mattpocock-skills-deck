/**
 * src/host/rpcChannel.ts —— 客户端与宿主之间的 RPC 通道（来源：src/host/rpcChannel.js，issue #1247 转写，本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：通道注册、信封校验与分发异常记账；注册走 fetch 精确路由。
 *
 * 三条不能改的约定（改之前先看原 rpcChannel.js 头注释与调用点 index.ts）：
 * 1. 行为零变化：逻辑逐行对应，只加类型标注与中文注释，不改任何运行时语义；相对导入保留 .js 后缀，由 scripts/ts-hook.mjs 改指同名 .ts。
 * 2. 只写可剥离 TypeScript：不新增运行时语法（禁用 enum 与构造函数参数属性），类型一律 import type 或内联标注，转译后与原 .js 逐行同义。
 * 3. 不新增任何 import 边：只给已有引用加类型，不引入新模块依赖；Node 内建模块的类型缺席由文件内局部声明与 @ts-expect-error 承接，不装 @types/node。
 */

// ---------------------------------------------------------------------------
// 类型（#1247 转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖全部由装配点显式传入，形状按本文件实际用到的成员写成最小；
// 从外面进来的东西（客户端参数、后端行数据、文件里读出的 JSON）一律按 any 或 unknown 收，
// 收窄发生在运行时的 typeof 与 Array.isArray 判断里 —— 类型不替代那些运行时判断。
// ---------------------------------------------------------------------------

/** 本文件组装函数的依赖：全部由调用方显式传入，缺席时按原逻辑默认处理。 */
type Deps = any;

/** 客户端调电话时送进来的参数：JSON 边界，形状由调用方保证，本文件只做运行时判空。 */
type WfArgs = any;

// src/host/rpcChannel.js —— 客户端与宿主之间的 RPC 通道（#596 从 host/index.js 搬出）。
// 以后谁改它：改通道注册方式、信封校验或分发异常记账的人改它。
// 接线：由 index.js 动态 import 加载（D7 禁止静态 import）；handlers 是 index.js 的 __DSW_HANDLERS__ 表，
//   fireLog 是宿主日志发射函数（具名传入——日志埋点门禁按 fireLog/log 这类裸名认埋点落点），
//   dispatchMeta 只在记分发异常行时才去取。本文件不引用其他新文件。
//
// 为什么单独一个文件（#596）：这段协议代码把 index.js 顶过了文件粒度门禁的零增长基线，
//   而门禁要求已冻结的文件只许减不许增——搬出来既过门禁，也让通道的注册与协议自成一页。
// 本域 tsconfig 有意不加载任何类型包（types 为空），Node 内建模块的类型声明随 @types/node 一起被挡在门外；运行时一定是 Node，这些模块必然存在。所以只忽略这一行导入的类型错误（纯类型层面，不影响运行时转译）。
// @ts-expect-error
import { readFileSync } from 'node:fs'

// 通道名与载体（#596）。客户端 src/seam/rpc.ts 调 conn.rpc.call('/api', 'dsws', { method, payload })，
// DSH 据此拼出请求路径 /api/dsws，与本文件注册的精确路径一致；真正的端点名在请求体里。
export const DSW_RPC_CHANNEL = 'dsws'
export const DSW_RPC_ROUTE = '/api' + '/' + DSW_RPC_CHANNEL
// 请求标识的合法形状（与 DSH 连接服务的 rpcId 同规则）。
const DSH_RPC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
// 端点名的合法形状（与 DSH 连接服务的端点段同规则；点号合法，形如 wf.probe.echo 也收）。
export const DSW_ENDPOINT_PATTERN = /^[A-Za-z0-9_$.-]+$/

function replyEnvelope(rpcId?: any, result?: any) {
  return Response.json({ type: 'server-response', rpcId: rpcId, result: result })
}

/** 读版本时只认这几条候选路径（相对本文件）；读到的清单名字对不上就当下一条。 */
const MANIFEST_CANDIDATES = ['../package.json', '../../package/package.json']
const MANIFEST_NAME = 'dsh-mattpocock-skills-deck'
let servingVersion: any = null

/**
 * 「服务这一份」的版本：本文件所在的那一份插件里 package.json 说的版本号。
 * 为什么需要它：真机上出过一次「回话里没有内容」的故障（检查链那条电话 107 次全败，
 * 见 .tmp/map/briefs/调查-环境未知-report.md），当时连「是哪一份在服务」都答不出来 ——
 * 同一台机器上装了好几份副本（profiles 下三份 + 工作区里的源码树），各自都能服务这条通道。
 * 读法：相对本文件的路径解析（发布包里是 lib/rpcChannel.js 旁边的 package.json，
 * 开发形态里是多上一层的 package/package.json），清单名对不上就当没读到；读不到如实回 unknown，
 * 绝不编一个版本号。结果缓存一次（这条电话只在出故障时才走，不构成高频路径）。
 */
function versionOfServingCopy() {
  if (servingVersion !== null) return servingVersion
  servingVersion = 'unknown'
  for (const rel of MANIFEST_CANDIDATES) {
    try {
      const url = new URL(rel, import.meta.url)
      const pkg = JSON.parse(readFileSync(url, 'utf8'))
      const v = pkg && pkg.name === MANIFEST_NAME ? String(pkg.version || '') : ''
      if (v) { servingVersion = 'v' + v; break }
    } catch (e) { /* 读不到就试下一条；全读不到就 keep unknown */ }
  }
  return servingVersion
}

/**
 * 「handler 回话里没有内容」是哪一种形状（回得好好的就回空串）。三档各自点出缺的是哪一个键：
 *   no-value    —— 处理函数什么都没回（回话里 value 那一格是 undefined）；
 *   null-value  —— 回了一个 null（与「什么都没回」分开记，两者的来路不同）；
 *   no-error    —— 回的是 { ok:false } 但没带 error（界面上只能看到一句「失败」，原因一个字都没有）。
 * 为什么要有这一条（#724）：这三种形状从前在宿主日志里**一个字都不留** —— 客户端那侧只能反推散列，
 * 事后查不出「是回话空还是抛错」。业务性的正常回话（{ ok:false, error:'…' } 之类）不在此列，不记。
 */
function emptyReplyShape(value?: any) {
  if (value === undefined) return 'no-value'
  if (value === null) return 'null-value'
  if (typeof value === 'object' && !Array.isArray(value) && value.ok === false && !String(value.error || '').trim()) return 'no-error'
  return ''
}

function rpcIdOf(raw?: any) {
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
export function createRpcChannel(deps?: any): any {
  const ctx = deps.ctx
  const handlers = deps.handlers
  const fireLog = deps.fireLog
  const dispatchMeta = deps.dispatchMeta
  // 记账出口的第二个名字（#724）：本文件里两条自监控错误行沿用 fireLog（tests/verify-log-selfmon.js
  // 按那个形状逐字点名），新加的那条常驻告警走 log(...) —— 日志字段门禁（tests/verify-log-fields.ts）
  // 照 `log('级别', '事件名', {…})` 这个形状扫落点，写成 fireLog 它扫不到，那一条事件就成了没登记的野点。
  const log = deps.fireLog

  // 注册失败的可见性（原来这里是个空 catch，故障才拖了这么久）：
  // 走 #46 自监控事件 host.dispatch.error（错误级直通落盘，字段就是白名单那三键）。
  // 按附录 1.6 的枚举纪律，errorKind 只取 auth/network/notfound/exit，通道注册失败归不上，一律记 internal；
  // 那这次是什么失败写进 method 尾巴（注册是 wf.* 之外的调用，没有电话名可写），这样日志里仍能一眼认出来。
  const reportRegisterFail = function(kind?: any, failMsg?: any) {
    const say = kind + (typeof failMsg === 'string' && failMsg !== '' ? ('：' + failMsg.slice(0, 120)) : '')
    try { fireLog('error', 'host.dispatch.error', { method: DSW_RPC_ROUTE + ' 通道注册', argsHash: '', errorKind: 'internal' }) } catch (eLog) {}
    return say
  }

  // 一次分发：命中端点表，异常归一到 RpcResult 失败信封并留一行错误级日志（#46）。
  const dispatchRpcEndpoint = async function(endpoint?: any, payload?: any) {
    const fn = handlers.get(endpoint)
    if (!fn) {
      // #733：不认识端点名也留一行常驻告警（与 #724 回话空共用 host.dispatch.empty，不新增事件名）。
      // 形状只有一种取值 unknown-endpoint（客户端调的电话名在宿主端点表里不存在，多见于新旧版本错位时
      // 旧宿主继续服务：24 号白天新界面调旧宿主，316 次全回这一句，宿主侧一个字都没留下）。
      // 只记电话名明文、形状与服务版本：不记入参原文、不记路径。失败本身照常回给客户端，不吞掉。
      try { log('warn', 'host.dispatch.empty', { method: 'wf.' + endpoint, shape: 'unknown-endpoint', version: versionOfServingCopy() }) } catch (eL) {}
      return { ok: false, error: { code: 'internal', message: 'unknown endpoint: ' + endpoint, details: {} } }
    }
    try {
      const value = await fn(payload)
      // #724：回话里没有内容的三种形状各留一行常驻告警（方法名、缺了哪个键、服务这一份的版本）。
      // 只记枚举、散列与版本号：不记入参原文、不记路径、不记任何回话内容。
      const shape = emptyReplyShape(value)
      if (shape) { try { log('warn', 'host.dispatch.empty', { method: 'wf.' + endpoint, shape: shape, version: versionOfServingCopy() }) } catch (eL) {} }
      return { ok: true, value: value }
    } catch (e) {
      try { dispatchMeta().then(function(dm?: any) { try { fireLog('error', 'host.dispatch.error', { method: 'wf.' + endpoint, argsHash: dm.shortArgHash(payload), errorKind: dm.dispatchErrorKind(e) }) } catch (eInner) {} }).catch(function() {}) } catch (eLog) {}
      return { ok: false, error: { code: 'internal', message: String((e && (e as any).message) || e), details: {} } }
    }
  }

  const badRequest = function(rpcId?: any, why?: any) {
    return replyEnvelope(rpcId, { ok: false, error: { code: 'gateway/bad-request', message: why, details: {} } })
  }

  // 一次请求：解信封 → 取端点名与入参 → 分发 → 回信封。非 POST / 非 JSON / 信封不合规一律按协议回错，不静默。
  const routeFetch = async function(request?: any) {
    if (!request || request.method !== 'POST') return new Response('method not allowed', { status: 405 })
    let body: any = null
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
      try { ctx.effect(function() { return function() {} }, 'dsh-mattpocock-skills-deck: ' + DSW_RPC_ROUTE) } catch (eEff) {}
    }
    return { ok: true, path: DSW_RPC_ROUTE }
  } catch (eReg) {
    // 重复注册（live patch reload / 回滚重放时同一路由已挂在别的实例名下，DSH 会抛 duplicate 文案）
    // 算让位：那个实例继续服务即可。其余错误一律记账。
    const msg = String((eReg && (eReg as any).message) || eReg)
    const kind = (msg.indexOf('already registered') >= 0 || msg.indexOf('duplicate') >= 0) ? 'fetch-route-duplicate' : 'fetch-route-throw'
    reportRegisterFail(kind, msg)
    return { ok: false, path: DSW_RPC_ROUTE, reason: kind }
  }
}
