// smoke-host-dispatch.test.js — host seam dispatch 端到端验证
// 验证 harness.handle 注册的 handler 能经 connection.rpc.handle('/dsws') 通道被调用：
//   wf.ping → ping 端点 → { ok: true, value: 'pong' }
import { readFileSync } from 'node:fs'

const modRaw = await import('../package/lib/index.js')
const mod = modRaw.default ?? modRaw

let registered = null
const subprocess = {
  async resolveExecutable() { return 'gh' },
  spawn() { return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, terminate: () => {} } },
}
const timer = { timeout: (fn, ms) => setTimeout(fn, ms) }
const fsSvc = { readFileSync: () => '', writeFileSync: () => {}, existsSync: () => false, mkdirSync: () => {}, readdirSync: () => [], statSync: () => ({ isDirectory: () => false }) }
const services = {
  subprocess, timer, fs: fsSvc,
  connection: { rpc: { handle: (path, fn, opts) => { registered = { path, fn, opts } } } },
}
const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }

;(mod.apply ?? mod.default?.apply)(ctx)

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }
check(!!registered && typeof registered.fn === 'function', 'connection.rpc.handle 收到 dispatch fn')

// 调 dispatch：endpoint 'ping'（动态 host 注册的是 wf.ping → seam 去掉 wf. 前缀）
if (registered && typeof registered.fn === 'function') {
  const res = await registered.fn('ping', {})
  console.log('  ping 结果:', JSON.stringify(res))
  check(!!res && res.ok === true, 'ping dispatch ok=true')
  const bad = await registered.fn('nonexistent', {})
  check(!!bad && bad.ok === false, '未知端点 ok=false（RpcResult 错误信封）')
}

// ---- #265 命名守护新增操作路径（注册/信号/计划单/回报）----
if (registered && typeof registered.fn === 'function') {
  try {
    const plan0 = await registered.fn('namingPlan', {})
    check(!!plan0 && plan0.ok === true && Array.isArray(plan0.orders), 'namingPlan 空态返回 ok+orders[]')

    const regBad = await registered.fn('namingRegister', { sessionId: 'smoke-s2', baselineTitle: '随意标题' })
    check(!!regBad && regBad.ok === false, 'namingRegister 拒绝非占位基准（占位四式校验在注册表操作内）')
    const regOk = await registered.fn('namingRegister', { sessionId: 'smoke-s1', baselineTitle: '[New] 新建需求', cwd: '', hint: '草稿档线索样例' })
    check(!!regOk && regOk.ok === true, 'namingRegister 接受占位会话注册')

    const planHint = await registered.fn('namingPlan', {})
    check(!!planHint && planHint.ok === true && planHint.orders.length === 1 && planHint.orders[0].kind === 'draft' && planHint.orders[0].hint === '草稿档线索样例', 'namingPlan 为带线索占位会话产出 draft 订单')
    check(planHint.orders[0].lock && planHint.orders[0].lock.baselineTitle === '[New] 新建需求', '订单携带值比对锁基准信息')

    await registered.fn('namingSignal', { sessionId: 'smoke-s1', hint: '更新的线索' })
    const planSig = await registered.fn('namingPlan', {})
    check(!!planSig && planSig.orders.length === 1 && planSig.orders[0].hint === '更新的线索', 'namingSignal 更新语义线索并反映到订单')

    const resRename = await registered.fn('namingResult', { sessionId: 'smoke-s1', outcome: 'renamed', title: '[草稿] 更新的线索' })
    check(!!resRename && resRename.ok === true, 'namingResult renamed 回报接受')
    const planDone = await registered.fn('namingPlan', {})
    check(!!planDone && planDone.orders.length === 0, '草稿档升级后计划单清空（每会话 P1 至多一次）')

    const lockReg = await registered.fn('namingRegister', { sessionId: 'smoke-s3', baselineTitle: '[New] New Bug' })
    await registered.fn('namingResult', { sessionId: 'smoke-s3', outcome: 'locked' })
    const planLock = await registered.fn('namingPlan', {})
    check(lockReg.ok === true && planLock.ok === true && planLock.orders.every(function (o) { return o.sessionId !== 'smoke-s3' }), 'locked 会话永不出单（手改保护）')
  } catch (eNaming) {
    check(false, '命名守护分发路径异常: ' + String((eNaming && eNaming.message) || eNaming))
  }
}

console.log(failures ? `\ndispatch 冒烟失败 ${failures} 项` : '\ndispatch 冒烟全部通过')
process.exit(failures ? 1 : 0)
