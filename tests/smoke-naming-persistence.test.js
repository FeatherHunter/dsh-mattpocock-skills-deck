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
const sleep = (ms) => new Promise(function (res) { setTimeout(res, ms) })
// #266：gh api 索引快照由 stub 返回（测试可控；新号出现模拟「面板关闭期间会话内建号」）
const GH_BASE = '{"number":1,"title":"既有一","state":"OPEN","updatedAt":"u1"}\n{"number":2,"title":"既有二","state":"CLOSED","updatedAt":"u2"}\n'
let ghIndexText = GH_BASE

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
  resolveExecutable: async () => 'gh',
  env: { get: () => undefined },
}

function makeCtx(capture) {
  const subprocess = { async resolveExecutable() { return 'gh' }, spawn() { return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, terminate: () => {}, done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { readFrom: () => ({ text: ghIndexText }) }, stderr: { readFrom: () => ({ text: '' }) } } } } }
  // host 的真实 timer 服务双签名：timeout(fn, ms) 节流 / timeout(ms) → Promise（runGh 超时竞速用）
  const timer = { timeout: (a, b) => (typeof a === 'function' ? setTimeout(a, b) : new Promise(function (res) { setTimeout(res, a) })) }
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
  // ---- #266：索引差值底座跨重启（面板关闭期间建号 → 重启后 attributed）----
  // 实例一内：注册 io-s4（repoKey acme/demo）+ 基线建档（GH_BASE，无归属，索引落盘）
  const reg4 = await callHandler(d1.fn, 'registerNewSessionWatcher', { sessionId: 'io-s4', baselineTitle: '[New] New Bug', cwd: '', repoKey: 'acme/demo', hint: '关闭期间建的需求' })
  check(reg4.ok === true, 'registerNewSessionWatcher 受理（#266 实例一）')
  await callHandler(d1.fn, 'awaitCreatedIssue', { sessionId: 'io-s4' })
  await sleep(2600)  // 注册 nudge 结算（基线，800ms 窗）+ 1.2s 防抖落盘窗口
  {
    const jIdx = JSON.parse(readFileSync(stateFile, 'utf8'))
    check(jIdx.indexes && jIdx.indexes['acme/demo'] && jIdx.indexes['acme/demo']['2'], '索引快照随账目落盘（差值底座持久化）')
  }
  // 模拟「面板关闭（DSH 进程被重启）期间会话内建号」：新实例加载盘上账 → 索引含新号 77
  ghIndexText = GH_BASE + '{"number":77,"title":"关闭期间建的需求","state":"OPEN","updatedAt":"u77"}\n'
  const mod4Raw = await import('../package/lib/index.js?restart=266')
  const m4 = mod4Raw.default ?? mod4Raw
  let d4 = {}
  ;((m4.apply ?? m4.default?.apply))(makeCtx(d4))
  const await4 = await callHandler(d4.fn, 'awaitCreatedIssue', { sessionId: 'io-s4' })
  check(!!await4 && await4.ok === true && await4.watching === true, '重启后 io-s4 仍在等待建号')
  await sleep(600)
  const plan4 = await callHandler(d4.fn, 'namingPlan', {})
  const order4 = (plan4 && Array.isArray(plan4.orders)) ? plan4.orders.find(function (o) { return o.sessionId === 'io-s4' }) : null
  check(!!order4 && order4.kind === 'numbered' && order4.number === 77 && order4.title === '关闭期间建的需求', '重启后差值结算 → numbered 订单（#266 跨重启归属）')
  const res4 = await callHandler(d4.fn, 'namingResult', { sessionId: 'io-s4', outcome: 'renamed', title: '[#77] 关闭期间建的需求' })
  check(!!res4 && res4.ok === true, '重启后 numbered renamed 回报受理')
  const plan4Done = await callHandler(d4.fn, 'namingPlan', {})
  check(!!plan4Done && Array.isArray(plan4Done.orders) && plan4Done.orders.every(function (o) { return o.sessionId !== 'io-s4' }), '重启后落定收敛不再出单')
  await callHandler(d4.fn, 'cancelNewSessionWatcher', { sessionId: 'io-s4' })
  const plan4Prune = await callHandler(d4.fn, 'namingPlan', {})
  check(!!plan4Prune && Array.isArray(plan4Prune.orders) && plan4Prune.orders.every(function (o) { return o.sessionId !== 'io-s4' }), '取消监视后清账（终局清理通道可用）')
  // ---- #267：有限重试 + 面板级定败可见性（真实磁盘跨重启的预算持久化 · 值比对化解收尾）----
  // 剧本：连败三次达上限 → 定败出面板级清单（不再出单）→ 跨重启清单仍在 → 用户手改 → 值比对
  // 锁终局化解，提醒撤下。全程零 sleep 依赖（冷却窗以「不出单」断言，不等待墙上时钟）。
  const regS = await callHandler(d4.fn, 'namingRegister', { sessionId: 'io-s5', baselineTitle: '[New] 新建需求', cwd: '', hint: '定败样例' })
  check(regS.ok === true, '#267 注册受踪（io-s5）')
  const fA = await callHandler(d4.fn, 'namingResult', { sessionId: 'io-s5', outcome: 'failed', error: 'face 拒绝 #1' })
  check(!!fA && fA.ok === true && fA.exhausted === false, '#267 fail#1 受理且回执未达上限')
  const jF1 = JSON.parse(readFileSync(stateFile, 'utf8'))
  check(jF1.sessions['io-s5'] && jF1.sessions['io-s5'].failCount === 1 && typeof jF1.sessions['io-s5'].lastFailAt === 'number' && jF1.sessions['io-s5'].lastError === 'face 拒绝 #1', '#267 失败入账即时落盘（计数/时刻/摘要 · 预算跨重启底座）')
  const planC = await callHandler(d4.fn, 'namingPlan', {})
  check(!!planC && Array.isArray(planC.orders) && planC.orders.every(function (o) { return o.sessionId !== 'io-s5' }), '#267 冷却窗内不重复出单（瞬时故障自愈窗口生效）')
  // 重启一（实例 267a）：预算与冷却随盘恢复 —— 不因 DSH 重启归零、不重复出单
  const mod6Raw = await import('../package/lib/index.js?restart=267a')
  const m6 = mod6Raw.default ?? mod6Raw
  let d6 = {}
  ;((m6.apply ?? m6.default?.apply))(makeCtx(d6))
  const planCR = await callHandler(d6.fn, 'namingPlan', {})
  check(!!planCR && Array.isArray(planCR.orders) && planCR.orders.every(function (o) { return o.sessionId !== 'io-s5' }), '#267 重启后冷却窗依旧生效（预算从盘恢复，未归零）')
  await callHandler(d6.fn, 'namingResult', { sessionId: 'io-s5', outcome: 'failed', error: 'face 拒绝 #2' })
  const fB = await callHandler(d6.fn, 'namingResult', { sessionId: 'io-s5', outcome: 'failed', error: 'face 拒绝 #3' })
  check(!!fB && fB.ok === true && fB.exhausted === true, '#267 连败第三次回执标注定败')
  const planX = await callHandler(d6.fn, 'namingPlan', {})
  check(!!planX && Array.isArray(planX.orders) && planX.orders.every(function (o) { return o.sessionId !== 'io-s5' }), '#267 定败后永不再出单（有限重试耗尽即收敛）')
  const fx5 = (planX && Array.isArray(planX.failures)) ? planX.failures.find(function (f) { return f.sessionId === 'io-s5' }) : null
  check(!!fx5 && fx5.count === 3 && fx5.error === 'face 拒绝 #3' && fx5.kind === 'draft' && fx5.hint === '定败样例', '#267 面板级定败清单携完整画像（次数/末次错误/档位形态/线索）')
  check(!!fx5 && !!fx5.lock && fx5.lock.baselineTitle === '[New] 新建需求', '#267 定败画像附值比对锁信息（协商化解依据随清单下发）')
  // 重启二（实例 267b）：定败清单仍在 —— 面板提醒跨重启不丢；依旧零出单
  const mod7Raw = await import('../package/lib/index.js?restart=267b')
  const m7 = mod7Raw.default ?? mod7Raw
  let d7 = {}
  ;((m7.apply ?? m7.default?.apply))(makeCtx(d7))
  const planXR = await callHandler(d7.fn, 'namingPlan', {})
  const fx5r = (planXR && Array.isArray(planXR.failures)) ? planXR.failures.find(function (f) { return f.sessionId === 'io-s5' }) : null
  check(!!fx5r && fx5r.count === 3, '#267 重启后定败清单仍在（面板级提醒跨重启不丢账）')
  check(!!planXR && Array.isArray(planXR.orders) && planXR.orders.every(function (o) { return o.sessionId !== 'io-s5' }), '#267 重启后定败目标仍永不出单')
  // 化解路 A（主路）：用户手改 → 界面半值比对判锁回报 locked → 终局并撤下提醒
  const man = await callHandler(d7.fn, 'namingResult', { sessionId: 'io-s5', outcome: 'locked' })
  check(!!man && man.ok === true, '#267 手改锁定回报受理（值比对锁真检测由界面半执行）')
  const planM = await callHandler(d7.fn, 'namingPlan', {})
  check(!!planM && Array.isArray(planM.failures) && !planM.failures.some(function (f) { return f.sessionId === 'io-s5' }), '#267 化解后定败清单撤下（横幅自动消失语义）')
  check(!!planM && Array.isArray(planM.orders) && planM.orders.every(function (o) { return o.sessionId !== 'io-s5' }), '#267 锁定终局后永不出单（手改永不被覆盖闭环）')
  const jFM = JSON.parse(readFileSync(stateFile, 'utf8'))
  check(jFM.sessions['io-s5'] && jFM.sessions['io-s5'].locked === true, '#267 锁定终局即时落盘')
} catch (e) {
  check(false, 'IO 冒烟异常: ' + String((e && e.stack || e)).split('\n').slice(0, 4).join(' | '))
} finally {
  try { process.chdir(origCwd) } catch (e) {}
  try { rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

console.log(failures ? '\nnaming 持久化冒烟失败 ' + failures + ' 项' : '\nnaming 持久化冒烟全部通过')
process.exit(failures ? 1 : 0)