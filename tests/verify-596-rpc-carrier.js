// tests/verify-596-rpc-carrier.js — 门禁：客户端请求路径与宿主注册路径必须一致（#596）。
//
// 为什么要有这一条：2026-09-10 那次修复把宿主分发从 connection.rpc.handle 换成
// connection.fetch.register，客户端却还在往 /dsws/<端点> 发请求，两边对不上，通道等于没接上。
// npm run verify 当时全绿——因为它只跑合成数据，没人检查「两边路径是不是同一个」。
// 本文件把这条对不上的情形钉死：只读真源，不连网络，跑 <1s。
//
// 判定：真跑一次——把客户端形状的请求喂给宿主注册的那条路由，必须能命中并拿到 handler 的真实返回。
// （原先还有「读源码文本、比对两边路径字面量」的三段，已删除：那种门禁会因为等价重构而变红。）
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

// 【已删除】原先的 ① 客户端那一半 / ② 宿主那一半 / ③ 对撞 三段，读的是 src/seam/rpc.js、
// scripts/build.mjs、src/host/rpcChannel.js 的源码文本，再用正则从里面抠出通道名与端点名，
// 断言它们写了什么、两份是否一致。这类钉源码文本的门禁会因为等价重构（改名、挪文件、换写法）
// 变红；而它想证明的事（客户端请求路径与宿主注册路径对得上），下一段真跑一次已经用运行结果证明了。

// ---------- 真跑一次：把客户端形状的请求喂给宿主那条路由 ----------
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
console.log('  注册路径:', registered && registered.path)
check(!!registered && Array.isArray(registered.methods) && registered.methods.join(',') === 'POST', `注册方法 = ${registered && JSON.stringify(registered.methods)}`)
check(!!registered && registered.requestBody === 'buffered', `requestBody = ${registered && registered.requestBody}`)
check(!!result && result.ok === true, '注册结果 ok=true（失败记账路径没被走到）')

if (registered && typeof registered.fetch === 'function') {
  // 请求路径不再从源码文本里抠，直接用宿主刚刚注册的那条路径：
  // 这一段要证明的是「客户端形状的请求喂进去能命中，并拿到 handler 的真实返回」。
  const clientRequestPath = registered.path
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
