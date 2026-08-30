// smoke-host-dispatch.test.js — host seam dispatch 端到端验证
// 验证 harness.handle 注册的 handler 能经 connection.rpc.handle('/dsws') 通道被调用：
//   wf.ping → ping 端点 → { ok: true, value: 'pong' }
import { readFileSync } from 'node:fs'

const modRaw = await import('../package/lib/index.js')
const mod = modRaw.default ?? modRaw

let registered = null
// #266 建号感知冒烟：gh api 索引快照由 stub 返回（测试可控 JSON Lines；按调用序切换新旧快照）
const GH_BASE = '{"number":1,"title":"既有一","state":"OPEN","updatedAt":"u1"}\n{"number":2,"title":"既有二","state":"CLOSED","updatedAt":"u2"}\n'
let ghIndexText = GH_BASE
const subprocess = {
  async resolveExecutable() { return 'gh' },
  spawn() {
    return {
      stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, terminate: () => {},
      done: Promise.resolve({ exitCode: 0 }),
      collected: { stdout: { readFrom: () => ({ text: ghIndexText }) }, stderr: { readFrom: () => ({ text: '' }) } },
    }
  },
}
// host 的真实 timer 服务双签名：timeout(fn, ms) 节流 / timeout(ms) → Promise（runGh 超时竞速用）
const timer = {
  timeout: (a, b) => (typeof a === 'function' ? setTimeout(a, b) : new Promise(function (res) { setTimeout(res, a) })),
}
const fsSvc = { readFileSync: () => '', writeFileSync: () => {}, existsSync: () => false, mkdirSync: () => {}, readdirSync: () => [], statSync: () => ({ isDirectory: () => false }) }
const sleep = (ms) => new Promise(function (res) { setTimeout(res, ms) })
const platformSvc = { getHome: async () => '', path: { join: (...a) => a.join('/') }, fs: { mkdir: async () => {}, resolve: async (k) => String(k) }, resolveExecutable: async () => 'gh', env: { get: () => undefined } }
const services = {
  subprocess, timer, fs: fsSvc, platform: platformSvc,
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
  // loopback dispatch 返回 RpcResult 信封 { ok, value }：处理器原始返回在 .value（ping 断言即信封层）
  const callHandler = async function (endpoint, args) {
    const env = await registered.fn(endpoint, args)
    return (env && typeof env.value === 'object' && env.value !== null && ('ok' in env.value)) ? env.value : env
  }
  try {
    const plan0 = await callHandler('namingPlan', {})
    check(!!plan0 && plan0.ok === true && Array.isArray(plan0.orders), 'namingPlan 空态返回 ok+orders[]')

    const regBad = await callHandler('namingRegister', { sessionId: 'smoke-s2', baselineTitle: '随意标题' })
    check(!!regBad && regBad.ok === false, 'namingRegister 拒绝非占位基准（占位四式校验在注册表操作内）')
    const regOk = await callHandler('namingRegister', { sessionId: 'smoke-s1', baselineTitle: '[New] 新建需求', cwd: '', hint: '草稿档线索样例' })
    check(!!regOk && regOk.ok === true, 'namingRegister 接受占位会话注册')

    const planHint = await callHandler('namingPlan', {})
    check(!!planHint && planHint.ok === true && Array.isArray(planHint.orders) && planHint.orders.length === 1 && planHint.orders[0].kind === 'draft' && planHint.orders[0].hint === '草稿档线索样例', 'namingPlan 为带线索占位会话产出 draft 订单')
    check(planHint.orders && planHint.orders[0] && planHint.orders[0].lock && planHint.orders[0].lock.baselineTitle === '[New] 新建需求', '订单携带值比对锁基准信息')

    await callHandler('namingSignal', { sessionId: 'smoke-s1', hint: '更新的线索' })
    const planSig = await callHandler('namingPlan', {})
    check(!!planSig && Array.isArray(planSig.orders) && planSig.orders.length === 1 && planSig.orders[0].hint === '更新的线索', 'namingSignal 更新语义线索并反映到订单')

    const resRename = await callHandler('namingResult', { sessionId: 'smoke-s1', outcome: 'renamed', title: '[草稿] 更新的线索' })
    check(!!resRename && resRename.ok === true, 'namingResult renamed 回报接受')
    const planDone = await callHandler('namingPlan', {})
    check(!!planDone && Array.isArray(planDone.orders) && planDone.orders.length === 0, '草稿档升级后计划单清空（每会话 P1 至多一次）')

    const lockReg = await callHandler('namingRegister', { sessionId: 'smoke-s3', baselineTitle: '[New] New Bug' })
    await callHandler('namingResult', { sessionId: 'smoke-s3', outcome: 'locked' })
    const planLock = await callHandler('namingPlan', {})
    check(lockReg.ok === true && planLock.ok === true && Array.isArray(planLock.orders) && planLock.orders.every(function (o) { return o.sessionId !== 'smoke-s3' }), 'locked 会话永不出单（手改保护）')
  } catch (eNaming) {
    check(false, '命名守护分发路径异常: ' + String((eNaming && eNaming.message) || eNaming))
  }
}

// ---- #266 建号感知：三操作复原（注册/取消/等待）＋ 索引差值结算 → numbered 订单 ----
if (registered && typeof registered.fn === 'function') {
  const callHandler = async function (endpoint, args) {
    const env = await registered.fn(endpoint, args)
    return (env && typeof env.value === 'object' && env.value !== null && ('ok' in env.value)) ? env.value : env
  }
  try {
    // 注册监视（#211 复原名）：占位基准 + repoKey；注册后 800ms 内打索引基线（GH_BASE）
    const regWatch = await callHandler('registerNewSessionWatcher', { sessionId: 'smoke-266', baselineTitle: '[New] 新建需求', cwd: '', repoKey: 'acme/demo', hint: '新建的修复需求' })
    check(!!regWatch && regWatch.ok === true, 'registerNewSessionWatcher 受理（注册监视复原）')
    await sleep(1100)  // 等待基线建档（无归属）
    const planBase = await callHandler('namingPlan', {})
    check(!!planBase && Array.isArray(planBase.orders) && planBase.orders.length === 1 && planBase.orders[0].kind === 'draft', '首轮基线仅 draft（存量不当编号）')

    // 等待建号：状态查询 + nudge 结算 —— stub 切到含新号 42 的快照
    ghIndexText = GH_BASE + '{"number":42,"title":"新建的修复需求","state":"OPEN","updatedAt":"u42"}\n'
    const awaitA = await callHandler('awaitCreatedIssue', { sessionId: 'smoke-266' })
    check(!!awaitA && awaitA.ok === true && awaitA.watching === true, 'awaitCreatedIssue 等待中=true（等待建号复原）')
    await sleep(600)  // nudge 120ms 短窗结算
    const planNum = await callHandler('namingPlan', {})
    const numOrder = (planNum && Array.isArray(planNum.orders)) ? planNum.orders.find(function (o) { return o.sessionId === 'smoke-266' }) : null
    check(!!numOrder && numOrder.kind === 'numbered' && numOrder.number === 42 && numOrder.title === '新建的修复需求', '索引差值 → numbered 订单（新号 42 归属最早候选取样）')
    const awaitB = await callHandler('awaitCreatedIssue', { sessionId: 'smoke-266' })
    check(!!awaitB && awaitB.ok === true && awaitB.watching === false, '获号后 awaitCreatedIssue watching=false（不再等待）')

    // numbered 单执行回报 → 落定收敛 → 计划单清空
    const resR = await callHandler('namingResult', { sessionId: 'smoke-266', outcome: 'renamed', title: '[#42] 新建的修复需求' })
    check(!!resR && resR.ok === true, 'numbered renamed 回报受理')
    const planDone = await callHandler('namingPlan', {})
    check(!!planDone && Array.isArray(planDone.orders) && planDone.orders.every(function (o) { return o.sessionId !== 'smoke-266' }), 'numbered 落定后不再出单')

    // 取消监视：未知 sid 幂等；已注册 sid 移除
    const cancelNone = await callHandler('cancelNewSessionWatcher', { sessionId: 'smoke-unknown' })
    check(!!cancelNone && cancelNone.ok === true && cancelNone.cancelled === false, 'cancelNewSessionWatcher 未知 sid 幂等')
    const regX = await callHandler('registerNewSessionWatcher', { sessionId: 'smoke-prune', baselineTitle: '[New] New Bug', cwd: '', repoKey: 'acme/demo' })
    const cancelX = await callHandler('cancelNewSessionWatcher', { sessionId: 'smoke-prune' })
    check(!!regX && regX.ok === true && !!cancelX && cancelX.ok === true && cancelX.cancelled === true, 'cancelNewSessionWatcher 移除受踪账目')
    const planPrune = await callHandler('namingPlan', {})
    check(!!planPrune && Array.isArray(planPrune.orders) && planPrune.orders.every(function (o) { return o.sessionId !== 'smoke-prune' }), '取消后不再出单')
  } catch (eNum) {
    check(false, '#266 建号感知分发路径异常: ' + String((eNum && eNum.message) || eNum))
  }
}

console.log(failures ? `\ndispatch 冒烟失败 ${failures} 项` : '\ndispatch 冒烟全部通过')
process.exit(failures ? 1 : 0)