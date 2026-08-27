// smoke-naming-persistence.test.js — #265 命名守护跟踪态真实磁盘 IO 冒烟（重启续跑语义 · 崩溃窗口补强验证）
// 与 dispatch 冒烟同法装载 package/lib/index.js，但 fs 服务桥接 node:fs 真实文件：
//   注册 → 落盘立即存在（即时持久化，非防抖）→ 二次加载模块实例模拟 DSH 重启 → 计划单仍在
//   → renamed 回报后盘上账目更新（lastMachineTitle/stage）→ 单次预算跨重启成立
//   → locked 跨重启永不出单（手改保护不依赖内存）
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import pathMod from 'node:path'

const origCwd = process.cwd()
const tmp = mkdtempSync(pathMod.join(tmpdir(), 'dsws-naming-io-'))
process.chdir(tmp)

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// fs 服务适配器：resolve 直通路径 + readText/writeText 走真实文件系统
const fsSvc = {
  resolve: async (key) => String(key),
  readText: async (p) => readFileSync(String(p), 'utf8'),
  writeText: async (t, content) => { mkdirSync(pathMod.dirname(String(t)), { recursive: true }); writeFileSync(String(t), content, 'utf8') },
  mkdir: async () => {},
}
// 注入 platform 命中 getPlatform 的注入分支（原样返回注入对象），path 用真实 node:path
const platformSvc = {
  getHome: async () => tmp,
  path: pathMod,
  fs: fsSvc,
  resolveExecutable: async () => null,
  env: { get: () => undefined },
}

function makeCtx(capture) {
  const subprocess = { async resolveExecutable() { return null }, spawn() { return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, terminate: () => {}, done: Promise.resolve({ exitCode: 0 }), collected: {} } } }
  const timer = { timeout: (fn, ms) => setTimeout(fn, ms) }
  const services = { subprocess, timer, fs: fsSvc, platform: platformSvc, connection: { rpc: { handle: (p, fn) => { capture.fn = fn } } } }
  return { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }
}

async function callHandler(fn, endpoint, args) {
  const env = await fn(endpoint, args)
  return (env && typeof env.value === 'object' && env.value !== null && ('ok' in env.value)) ? env.value : env
}

try {
  // ---- 实例一：注册 + 即时落盘 ----
  const m1 = (await import('../package/lib/index.js')).default ?? (await import('../package/lib/index.js'))
  let d1 = {}
  ;((m1.apply ?? m1.default?.apply))(makeCtx(d1))
  check(typeof d1.fn === 'function', '实例一 dispatch 就绪')

  const reg = await callHandler(d1.fn, 'namingRegister', { sessionId: 'io-s1', baselineTitle: '[New] 新建需求', cwd: '', hint: '续跑线索样例' })
  check(reg.ok === true, 'namingRegister 受理')

  const stateFile = pathMod.join(process.cwd(), '.dsh-mattskillsdeck-cache', 'naming-guardian.json')
  check(existsSync(stateFile), '注册后账目文件立即存在于既有缓存目录（即时持久化，无防抖窗口）')
  if (existsSync(stateFile)) {
    const j = JSON.parse(readFileSync(stateFile, 'utf8'))
    check(j.version === 1 && j.sessions && !!j.sessions['io-s1'], '盘上结构含受踪会话')
    check(j.sessions['io-s1'] && j.sessions['io-s1'].baselineTitle === '[New] 新建需求' && j.sessions['io-s1'].hint === '续跑线索样例', '盘上账目携带基准占位与面包屑线索')
    check(j.sessions['io-s1'] && j.sessions['io-s1'].stage === 'placeholder' && j.sessions['io-s1'].locked === false, '初账档位=placeholder 且未锁')
  }

  // ---- 实例二（模拟 DSH 重启）：全新模块加载，内存为空，必须从盘恢复 ----
  const url2 = '../package/lib/index.js?restart=1'
  const mod2Raw = await import(url2)
  const m2 = mod2Raw.default ?? mod2Raw
  let d2 = {}
  ;((m2.apply ?? m2.default?.apply))(makeCtx(d2))
  check(typeof d2.fn === 'function' && d2.fn !== d1.fn, '实例二 dispatch 就绪（新模块实例，模拟重启）')

  const plan = await callHandler(d2.fn, 'namingPlan', {})
  check(plan.ok === true && Array.isArray(plan.orders) && plan.orders.length === 1 && plan.orders[0].sessionId === 'io-s1' && plan.orders[0].kind === 'draft' && plan.orders[0].hint === '续跑线索样例', '重启后计划单从盘恢复且携线索（续跑语义）')
  check(plan.orders[0] && plan.orders[0].lock && plan.orders[0].lock.baselineTitle === '[New] 新建需求', '重启后值比对锁基准随单恢复')

  // ---- 实例二内完成草稿升级 → 盘上账目即时更新 ----
  const resRen = await callHandler(d2.fn, 'namingResult', { sessionId: 'io-s1', outcome: 'renamed', title: '[草稿] 续跑线索样例' })
  check(resRen.ok === true, 'renamed 回报受理')
  const j2 = JSON.parse(readFileSync(stateFile, 'utf8'))
  check(j2.sessions['io-s1'].stage === 'draft' && j2.sessions['io-s1'].lastMachineTitle === '[草稿] 续跑线索样例', '盘上账目记录档位跃迁与机器最后写入值')
  const planDone = await callHandler(d2.fn, 'namingPlan', {})
  check(planDone.ok === true && planDone.orders.every(function (o) { return o.sessionId !== 'io-s1' }), '草稿档完成后不再出 P1 单（P1 至多一次跨重启成立）')

  // ---- 锁定跨重启：手改保护不依赖内存 ----
  await callHandler(d2.fn, 'namingRegister', { sessionId: 'io-s3', baselineTitle: '[New] New Bug', cwd: '' })
  await callHandler(d2.fn, 'namingResult', { sessionId: 'io-s3', outcome: 'locked' })
  const j3 = JSON.parse(readFileSync(stateFile, 'utf8'))
  check(j3.sessions['io-s3'] && j3.sessions['io-s3'].locked === true, '锁定即时落盘')

  const url3 = '../package/lib/index.js?restart=2'
  const mod3Raw = await import(url3)
  const m3 = mod3Raw.default ?? mod3Raw
  let d3 = {}
  ;((m3.apply ?? m3.default?.apply))(makeCtx(d3))
  const planLock = await callHandler(d3.fn, 'namingPlan', {})
  check(planLock.ok === true && Array.isArray(planLock.orders) && planLock.orders.every(function (o) { return o.sessionId !== 'io-s3' }), '再次重启后 locked 会话仍永不出单（值比对锁持久化成立）')
} catch (e) {
  check(false, 'IO 冒烟异常: ' + String((e && e.stack || e)).split('\n').slice(0, 4).join(' | '))
} finally {
  try { process.chdir(origCwd) } catch (e) {}
  try { rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

console.log(failures ? '\nnaming 持久化冒烟失败 ' + failures + ' 项' : '\nnaming 持久化冒烟全部通过')
process.exit(failures ? 1 : 0)
