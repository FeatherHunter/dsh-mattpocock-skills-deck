// smoke-host.test.js — T0 阶段 0 验收·host 半冒烟
// 加载 package/lib/index.js（ESM），用宿主 stub ctx 调用 apply，断言：
//   1) name / inject 正确（只声明 connection；不再声明 webServer）
//   2) apply 经 connection.fetch.register 注册精确路由 /api/dsws（POST，buffered）
//   3) 该路由的 fetch 说 DSH 信封：client-request → server-response，命中 harness.handle 注册的 handler
// 用法: node tests/smoke-host.test.js
import { readFileSync } from 'node:fs'
import * as esbuild from 'esbuild'

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// ---- esbuild 语法门禁（可解析 ESM）----
const code = readFileSync('package/lib/index.js', 'utf8')
try {
  await esbuild.transform(code, { loader: 'js', format: 'esm' })
  check(true, 'ESM 语法编译 OK')
} catch (e) {
  check(false, 'ESM 语法编译: ' + e.message)
}

// ---- 宿主 stub：subprocess/timer/fs 真实最小实现；connection.fetch.register 捕获注册 ----
let registered = null
let rpcHandleCalled = false
const subprocess = {
  async resolveExecutable() { return 'gh' },
  spawn() { return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, terminate: () => {} } },
}
const timer = { timeout: (fn, ms) => setTimeout(fn, ms) }
const fsSvc = { readFileSync: () => '', writeFileSync: () => {}, existsSync: () => false, mkdirSync: () => {}, readdirSync: () => [], statSync: () => ({ isDirectory: () => false }) }
const services = {
  subprocess, timer, fs: fsSvc,
  connection: {
    // 旧入口保留只为证明「不再被调用」：一旦被调用即留痕，断言立刻失败（#596 回归钉）。
    rpc: { handle: () => { rpcHandleCalled = true } },
    fetch: { register: (route) => { registered = route; return () => {} } },
  },
}
const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }

const modRaw = await import('../package/lib/index.js')
const mod = modRaw.default ?? modRaw
check((modRaw.name ?? mod.name) === 'dsh-mattpocock-skills-deck' || modRaw.default !== undefined, `name = ${modRaw.name ?? mod.name ?? '(default)'}`)
// #596 回归守卫：通道必须经 connection.fetch.register 注册（精确路由 /api/dsws）。
// 旧写法 connection.rpc.handle('/dsws', ...) 会拿 connection 服务自己的上下文去调 webServer.register，
// 那个上下文没有 webServer 注入 → 装配期抛 cannot get property "webServer" without inject。
// 抛错的 Context 不是本插件的 ctx，所以往 inject 里补 webServer 治不好——只声明 connection 才对。
const injectList = Array.isArray(mod.inject) ? mod.inject : []
check(injectList.includes('connection'), `inject 含 connection（实际 ${JSON.stringify(injectList)}）`)
check(!injectList.includes('webServer'), `inject 不含 webServer（实际 ${JSON.stringify(injectList)}）`)
check(typeof mod.apply === 'function', 'apply 为函数')

mod.apply(ctx)
// 注册经 ./rpcChannel.js 动态加载完成（宿主禁止静态 import 的既有约定），等它落地再断言。
await new Promise(function (resolve) {
  const t0 = Date.now()
  const tick = function () {
    if (registered || Date.now() - t0 > 3000) return resolve()
    setTimeout(tick, 20)
  }
  tick()
})
check(!rpcHandleCalled, '旧入口 connection.rpc.handle 未被调用')
check(!!registered, 'connection.fetch.register 被调用')
check(!!registered && registered.path === '/api/dsws', `路由路径 = ${registered && registered.path}`)
check(!!registered && Array.isArray(registered.methods) && registered.methods.join(',') === 'POST', `路由方法 = ${registered && JSON.stringify(registered.methods)}`)
check(!!registered && registered.requestBody === 'buffered', `requestBody = ${registered && registered.requestBody}`)
check(!!registered && typeof registered.fetch === 'function', '路由 fetch 为函数')

// ---- 走一次真实信封：client-request → 分发 → server-response ----
// #596：注册路径是精确路径 /api/dsws（单条），端点名与入参装在请求体里（{method, payload}），
// 与 src/seam/rpc.js 的调用形状一致；路径不能再带端点尾巴。
if (registered && typeof registered.fetch === 'function') {
  const call = async function (endpoint, payload) {
    const res = await registered.fetch({
      method: 'POST',
      url: 'http://127.0.0.1:1/api/dsws',
      json: async () => ({ type: 'client-request', rpcId: 'smoke-1', method: endpoint, payload: { method: endpoint, payload } }),
    })
    return res.json()
  }
  const env = await call('logGetSwitch', {})
  console.log('  logGetSwitch 信封:', JSON.stringify(env).slice(0, 160))
  check(!!env && env.type === 'server-response' && env.rpcId === 'smoke-1', '回包是 server-response 信封且 rpcId 原样回带')
  check(!!env && env.result && env.result.ok === true, 'logGetSwitch 分发 ok=true')
  check(!!env && env.result && env.result.value && env.result.value.ok === true, 'handler 原始返回装在 result.value（seam 解包口径不变）')

  const bad = await call('nonexistent', {})
  check(!!bad && bad.result && bad.result.ok === false, '未知端点 result.ok=false（错误信封）')

  // 非 POST、请求体不合规、端点名不合规都要按协议拒绝，不静默
  const wrongMethod = await registered.fetch({ method: 'GET', url: 'http://127.0.0.1:1/api/dsws', json: async () => ({}) })
  check(wrongMethod.status === 405, `非 POST 回 405（实得 ${wrongMethod.status}）`)
  const noCall = await registered.fetch({
    method: 'POST', url: 'http://127.0.0.1:1/api/dsws',
    json: async () => ({ type: 'client-request', rpcId: 'x', method: 'logGetSwitch', payload: null }),
  })
  const noCallBody = await noCall.json()
  check(!!noCallBody && noCallBody.result && noCallBody.result.ok === false && /gateway\/bad-request/.test(noCallBody.result.error.code), '请求体缺 {method,payload} → bad-request 信封')
  const badName = await registered.fetch({
    method: 'POST', url: 'http://127.0.0.1:1/api/dsws',
    json: async () => ({ type: 'client-request', rpcId: 'x', method: '有中文', payload: { method: '有中文', payload: {} } }),
  })
  const badNameBody = await badName.json()
  check(!!badNameBody && badNameBody.result && badNameBody.result.ok === false, '端点名不合规 → 拒绝')
}

console.log(failures ? `\nhost 冒烟失败 ${failures} 项` : '\nhost 冒烟全部通过')
process.exit(failures ? 1 : 0)
