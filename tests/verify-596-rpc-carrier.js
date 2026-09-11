// tests/verify-596-rpc-carrier.js — 门禁：客户端请求路径与宿主注册路径必须一致（#596）。
//
// 为什么要有这一条：2026-09-10 那次修复把宿主分发从 connection.rpc.handle 换成
// connection.fetch.register，客户端却还在往 /dsws/<端点> 发请求，两边对不上，通道等于没接上。
// npm run verify 当时全绿——因为它只跑合成数据，没人检查「两边路径是不是同一个」。
// 本文件把这条对不上的情形钉死：只读真源，不连网络，跑 <1s。
//
// 判定分四段：
//   ① 客户端那一半：请求路径由「通道名 + 端点名」拼出，读 src/seam/rpc.js 与 build.mjs 的 pkg shim，
//      还认出拼请求路径的那次调用到底传了什么。
//   ② 宿主那一半：注册路径读 src/host/rpcChannel.js。
//   ③ 对撞：按 DSH 自己的拼法（channel/endpoint）算出客户端会请求的路径，必须等于宿主注册路径。
//   ④ 真跑一次：把客户端形状的请求喂给宿主注册的那条路由，必须能命中并拿到 handler 的真实返回。
//
// 用法: node tests/verify-596-rpc-carrier.js
import { readFileSync } from 'node:fs'

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

const src = (p) => readFileSync(p, 'utf8')

// 门禁自身必须挂在 npm run verify 链上，否则它只是一份没人跑的说明（沿用 #544 的写法）。
{
  const pkgJson = JSON.parse(src('package.json'))
  check((pkgJson.scripts.verify || '').includes('verify-596-rpc-carrier.js'), 'npm run verify 链已纳入本门禁')
}

// ---------- ① 客户端那一半 ----------
// 真源：src/seam/rpc.js（dev/源码方言）；发布包里跑的那份由 build.mjs 的 PKG_CLIENT_SHIMS 生成，
// 两份都要认，缺一不可——2026-09-10 那次恰恰只改了宿主。
const seamRpc = src('src/seam/rpc.js')
const buildSrc = src('scripts/build.mjs')

const seamChannel = seamRpc.match(/CARRIER_CHANNEL\s*=\s*'([^']+)'/)
const seamEndpoint = seamRpc.match(/CARRIER_ENDPOINT\s*=\s*'([^']+)'/)
check(!!seamChannel, 'seam/rpc.js 声明了载体通道名（CARRIER_CHANNEL）')
check(!!seamEndpoint, 'seam/rpc.js 声明了载体端点名（CARRIER_ENDPOINT）')

// pkg shim 里同样的两个字面量
const pkgChannel = buildSrc.match(/\n\s*const CARRIER_CHANNEL = '([^']+)'/)
const pkgEndpoint = buildSrc.match(/\n\s*const CARRIER_ENDPOINT = '([^']+)'/)
check(!!pkgChannel, 'build.mjs 的 pkg shim 声明了 CARRIER_CHANNEL')
check(!!pkgEndpoint, 'build.mjs 的 pkg shim 声明了 CARRIER_ENDPOINT')

const clientChannel = seamChannel && seamChannel[1]
const clientEndpoint = seamEndpoint && seamEndpoint[1]

// 只读两份真源不够：还要认出「拼请求路径的那次调用」到底把什么传给了 rpc.call。
// 旧写法是 conn.rpc.call('/dsws', endpoint, args)——第一参当通道名用；现在必须是载体通道名。
const seamCall = seamRpc.match(/conn\.rpc\.call\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*,/)
check(!!seamCall, 'seam/rpc.js 里能找到 conn.rpc.call 的通道与端点实参')
if (seamCall) {
  check(seamCall[1] === 'CARRIER_CHANNEL', `seam 的 rpc.call 第一参用 CARRIER_CHANNEL（实得 ${seamCall[1]}）`)
  check(seamCall[2] === 'CARRIER_ENDPOINT', `seam 的 rpc.call 第二参用 CARRIER_ENDPOINT（实得 ${seamCall[2]}）`)
}
const pkgCall = buildSrc.match(/conn\.rpc\.call\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*,/)
check(!!pkgCall, 'build.mjs 的 pkg shim 里能找到 conn.rpc.call 的通道与端点实参')
if (pkgCall) {
  check(pkgCall[1] === 'CARRIER_CHANNEL', `pkg shim 的 rpc.call 第一参用 CARRIER_CHANNEL（实得 ${pkgCall[1]}）`)
  check(pkgCall[2] === 'CARRIER_ENDPOINT', `pkg shim 的 rpc.call 第二参用 CARRIER_ENDPOINT（实得 ${pkgCall[2]}）`)
}

// 旧写法的痕迹不许再出现在真源的调用点上（注释里留历史说明不算，所以只查调用实参）
check(!/conn\.rpc\.call\(\s*'\/dsws'/.test(seamRpc), "seam/rpc.js 不再用 '/dsws' 当通道名")
check(!/conn\.rpc\.call\(\s*'\/dsws'/.test(buildSrc), "build.mjs 的 pkg shim 不再用 '/dsws' 当通道名")
check(`'${clientEndpoint}'` !== "'/dsws'", `载体端点名不是旧的 '/dsws'（实得 '${clientEndpoint}'）`)

// 两份真源的通道名与端点名必须一致（一源两物，不能只有一份被改）
check(clientChannel === (pkgChannel && pkgChannel[1]), `两份真源通道名一致（seam='${clientChannel}' pkg='${pkgChannel && pkgChannel[1]}'）`)
check(clientEndpoint === (pkgEndpoint && pkgEndpoint[1]), `两份真源端点名一致（seam='${clientEndpoint}' pkg='${pkgEndpoint && pkgEndpoint[1]}'）`)

// ---------- ② 宿主那一半 ----------
const hostChannelSrc = src('src/host/rpcChannel.js')
const hostChannelName = hostChannelSrc.match(/DSW_RPC_CHANNEL\s*=\s*'([^']+)'/)
const hostRoute = hostChannelSrc.match(/DSW_RPC_ROUTE\s*=\s*'([^']+)'\s*\+\s*'\/'\s*\+\s*DSW_RPC_CHANNEL/)
check(!!hostChannelName, 'rpcChannel.js 声明了通道名（DSW_RPC_CHANNEL）')
check(!!hostRoute, "rpcChannel.js 里注册路径 = '/api' + '/' + 通道名（与 DSH 拼法同源）")

// ---------- ③ 对撞：客户端会请求的路径 == 宿主注册的路径 ----------
// DSH 自己的拼法（dsh-client-connection/lib/client.js）：new URL(`${channel}/${endpoint}`, origin)
// 通道名本身带前导斜杠，所以拼出来就是通道名 + '/' + 端点名。
const clientRequestPath = `${clientChannel}/${clientEndpoint}`
const hostRegisteredPath = hostRoute ? hostRoute[1] + '/' + (hostChannelName && hostChannelName[1]) : '(未识别)'
check(clientEndpoint === (hostChannelName && hostChannelName[1]),
  `客户端端点名与宿主通道名同为 '${hostChannelName && hostChannelName[1]}'（客户端实得 '${clientEndpoint}'）`)
check(clientRequestPath === hostRegisteredPath,
  `客户端会请求 ${clientRequestPath}，宿主注册 ${hostRegisteredPath} —— 两者必须一致`)

// ---------- ④ 真跑一次：把客户端形状的请求喂给宿主那条路由 ----------
// 宿主注册是异步动态 import（D7 禁止静态 import），构造最小 stub 跑一次真实分发。
let registered = null
const services = {
  connection: {
    rpc: { handle: () => { throw new Error('不该走旧入口 connection.rpc.handle') } },
    fetch: { register: (route) => { registered = route; return () => {} } },
  },
}
const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }
const mod = await import('../src/host/rpcChannel.js')
const result = mod.createRpcChannel({
  ctx,
  handlers: new Map([['probe.echo', async (payload) => ({ ok: true, echoed: payload, tag: 'handler' })]]),
  fireLog: () => {},
  dispatchMeta: async () => ({ shortArgHash: () => '', dispatchErrorKind: () => 'x' }),
})
check(!!registered, 'rpcChannel.createRpcChannel 走 connection.fetch.register 注册了路由')
check(!!registered && registered.path === hostRegisteredPath, `注册路径 = ${registered && registered.path}`)
check(!!registered && Array.isArray(registered.methods) && registered.methods.join(',') === 'POST', `注册方法 = ${registered && JSON.stringify(registered.methods)}`)
check(!!registered && registered.requestBody === 'buffered', `requestBody = ${registered && registered.requestBody}`)
check(!!result && result.ok === true, '注册结果 ok=true（失败记账路径没被走到）')

if (registered && typeof registered.fetch === 'function') {
  const call = async (endpoint, payload) => {
    const res = await registered.fetch({
      method: 'POST',
      url: 'http://dsh.internal' + clientRequestPath,
      json: async () => ({ type: 'client-request', rpcId: 'verify-596', method: 'dsws', payload: { method: endpoint, payload } }),
    })
    return { status: res.status, body: await res.json() }
  }
  const good = await call('probe.echo', { hello: '世界' })
  console.log('  分发回包:', JSON.stringify(good.body).slice(0, 200))
  check(good.body && good.body.type === 'server-response' && good.body.rpcId === 'verify-596', '回包是 server-response 信封且 rpcId 原样回带')
  check(!!(good.body && good.body.result && good.body.result.ok === true), '已注册端点分发成功')
  // 新协议下 handler 收到的是客户端原始入参本身：外层信封的 payload 是 {method, payload}，
  // 分发只把内层 payload 递进端点表，不能让 handler 看见外层包装（否则每个 handler 都要自己拆一层）。
  check(!!(good.body && good.body.result && good.body.result.value && good.body.result.value.echoed && good.body.result.value.echoed.hello === '世界'),
    'handler 收到客户端原始入参（未被外层包装污染）')
  check(!!(good.body && good.body.result && good.body.result.value && good.body.result.value.tag === 'handler'), 'handler 原始返回装在 result.value')

  const unknown = await call('nope', {})
  check(!!(unknown.body && unknown.body.result && unknown.body.result.ok === false), '未知端点返回失败信封')

  const noCall = await registered.fetch({
    method: 'POST', url: 'http://dsh.internal' + clientRequestPath,
    json: async () => ({ type: 'client-request', rpcId: 'x', method: 'dsws', payload: null }),
  })
  const noCallBody = await noCall.json()
  check(!!(noCallBody && noCallBody.result && noCallBody.result.ok === false), '请求体缺 {method,payload} → 拒绝')

  // 路径不落在本通道上必须拒绝：把 URL 换成别的通道，即便信封齐全也不收（#596 就是两边路径对不上）。
  const offChannel = await registered.fetch({
    method: 'POST', url: 'http://dsh.internal/api/other',
    json: async () => ({ type: 'client-request', rpcId: 'x', method: 'dsws', payload: { method: 'probe.echo', payload: {} } }),
  })
  const offChannelBody = await offChannel.json()
  check(!!(offChannelBody && offChannelBody.result && offChannelBody.result.ok === false), '请求路径不在本通道上 → 拒绝')

  const badEndpoint = await call('有中文的端点', {})
  check(!!(badEndpoint.body && badEndpoint.body.result && badEndpoint.body.result.ok === false), '端点名不合规 → 拒绝')

  const wrongMethod = await registered.fetch({ method: 'GET', url: 'http://dsh.internal' + clientRequestPath, json: async () => ({}) })
  check(wrongMethod.status === 405, `非 POST 回 405（实得 ${wrongMethod.status}）`)
}

console.log(failures ? `\n#596 载体门禁失败 ${failures} 项` : '\n#596 载体门禁全部通过')
process.exit(failures ? 1 : 0)
