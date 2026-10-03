// tests/verify-naming-e2e.js — 命名守护的端到端缝（对抗审查的产物）
//
// 为什么单开这一条：历次查出的洞（我们那次改名没写成被判手改、机器写过之后被底座首句名盖掉、
// 零号编号档的半登记态、裸档被盖不修、底座自动取的名被判成手改）全都住在「纯函数拼起来」的那道缝里 ——
// 各自的纯函数测试都是绿的，合起来才错。
//
// 2026-10-03 改造：从前这里驱动的是宿主直执行那一段，而那段在真实底座上进不去（宿主会话服务没有
// scope/sessionOf），等于在测一条永远走不到的路。现在改成驱动**真实在跑**的客户端执行器
// （src/client/kernel/api-naming.js 的 executeNamingOrder）：闭包自由变量按名字挂在 globalThis 上当桩，
// 假会话服务提供当前标题与改名面。断言只看两件事：跑完之后标题是什么、有没有在不该让位的时候让位。
import * as titles from '../src/shared/naming-titles.js'
import * as tracking from '../src/shared/naming-tracking.js'

let failed = false
let total = 0
function check(ok, msg, detail) {
  total++
  if (ok) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + detail : '')) }
}

// ---- 闭包桩：客户端执行器引用的名字都从 globalThis 取（生产里由构建拼进闭包）----
const G = globalThis
G.composeDraftTitle = titles.composeDraftTitle
G.newSessionTitle = titles.newSessionTitle
G.parseNumberedTitle = titles.parseNumberedTitle
G.classifyDivergence = tracking.classifyDivergence
G.DIVERGENCE = tracking.DIVERGENCE
G.NAMING_STAGES = tracking.NAMING_STAGES
G.promptLang = function () { return 'zh' }        // 桩：本机语言固定中文（草稿档用词由它决定）
G.isEnabled = function () { return false }        // 桩：调试开关关
G.log = function () {}                            // 桩：不落盘
G.dswsLogHash = function (s) { return 'h' + String(s == null ? '' : s).length }
G.dswsLogTrunc = function (s) { return String(s == null ? '' : s).slice(0, 40) }

const FIRST_TEXT = '/wayfinder https://github.com/FeatherHunter/dsh-prompt/issues/779\n\n执行这个 issue'
// 底座写下的首句名 = 首句的截断（这里取到 URL 结束，长度足够，用来验「截断那条路要有下限」）
const CLOBBERED = '/wayfinder https://github.com/FeatherHunter/dsh-prompt/issues/779'

function makeWorld(initialTitle) {
  const world = { titles: { s1: initialTitle }, renamed: [], reports: [] }
  const sessions = {
    // 客户端唯一真源：会话列表快照（客户端 sessions 服务没有 get，2026-10-03 核查后那条分支已删）
    list: { getSnapshot: function () { return { byId: world.titles.s1 === undefined ? {} : { s1: { title: world.titles.s1 } } } } },
    scope: function (sid) { return { sessionId: sid } },
    sessionOf: function (scope) {
      return {
        sessionId: scope.sessionId,
        rename: function (t) {
          world.renamed.push(t)
          world.titles[scope.sessionId] = t
          return Promise.resolve({ ok: true, value: { title: t } })
        },
      }
    },
  }
  G.ctx = { get: function (k) { return k === 'sessions' ? sessions : undefined } }
  G.host = { call: function (m, a) { world.reports.push(Object.assign({}, a)); return Promise.resolve({ ok: true }) } }
  return world
}
const api = await import('../src/client/kernel/api-naming.js')
const settle = function () { return new Promise(function (r) { setTimeout(r, 30) }) }
const locked = function (w) { return w.reports.some(function (r) { return r.outcome === 'locked' }) }

console.log('\n— 命名守护端到端缝（真实客户端执行器）—')

// 1) 我们自己的那次改名没落地：平台默认名还在，名字仍归插件 → 直接写成目标名
{
  const w = makeWorld('[#779] 原样标题')
  api.executeNamingOrder({
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: null, baselineTitle: '[#779] 原样标题', baselineIsOurs: false, locked: false },
  })
  await settle()
  check(w.titles.s1 === '[#779] 原样标题', '没写成的那种：直接写成目标名（不再被判手改）', 'got ' + w.titles.s1)
  check(!locked(w), '没写成的那种：不报锁定（名字本来就没被用户碰过）', JSON.stringify(w.reports))
  check(w.reports.length === 1 && w.reports[0].outcome === 'renamed', '没写成的那种：按改名落定回报（台账据此记下我们写过的名）', JSON.stringify(w.reports))
}

// 2) 机器写过之后，底座按首句名把它盖掉：不是手改 → 盖回 [#n] 名
{
  const w = makeWorld(CLOBBERED)
  api.executeNamingOrder({
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: '[#779] 原样标题', baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  })
  await settle()
  check(w.titles.s1 === '[#779] 原样标题', '首句名盖掉之后：盖回 [#n] 名（机器写过也认）', 'got ' + w.titles.s1)
  check(!locked(w), '首句名盖回：不报锁定', JSON.stringify(w.reports))
}

// 3) 真手改：与首句无关 → 一步都不动，并如实回报让位理由
{
  const w = makeWorld('我自己起的名字')
  api.executeNamingOrder({
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: '[#779] 原样标题', baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  })
  await settle()
  check(w.titles.s1 === '我自己起的名字', '真手改：一个字都不动（手改永不被覆盖）', 'got ' + w.titles.s1)
  check(w.renamed.length === 0, '真手改：没有发生任何改名调用')
  check(w.reports.length === 1 && w.reports[0].outcome === 'locked' && w.reports[0].reason === 'hand-edit', '真手改：让位理由如实回报 hand-edit', JSON.stringify(w.reports))
}

// 4) 裸档草稿被首句名盖掉：没有线索也要盖回（对抗审查 C：从前这条被守卫挡下，永远修不回来）
{
  const w = makeWorld(CLOBBERED)
  api.executeNamingOrder({
    sessionId: 's1', kind: 'draft', hint: null,
    lock: { lastMachineTitle: '[草稿][新增需求]', baselineTitle: '[New] 新建需求', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  })
  await settle()
  check(w.titles.s1 === '[草稿][新增需求]', '裸档被盖：照样盖回裸档名', 'got ' + w.titles.s1)
}

// 5) 标题来源事实（2026-10-03）：底座自动取的名不再被误判成手改；人写的名照旧让位
{
  const w = makeWorld('修复登录闪退的完整方案')
  api.executeNamingOrder({
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: {
      lastMachineTitle: '[#779] 原样标题', baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false,
      firstUserText: '帮我看看登录闪退', titleSource: { kind: 'provider', title: '修复登录闪退的完整方案' },
    },
  })
  await settle()
  check(w.titles.s1 === '[#779] 原样标题', '底座模型取的名（provider）：盖回 [#n]，不再永久锁定', 'got ' + w.titles.s1)
  check(!locked(w), '底座模型取的名：不报锁定', JSON.stringify(w.reports))
}
{
  const w = makeWorld('某个模型取的名')
  api.executeNamingOrder({
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: {
      lastMachineTitle: '[#779] 原样标题', baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false,
      firstUserText: '帮我看看登录闪退', titleSource: { kind: 'user', title: '某个模型取的名' },
    },
  })
  await settle()
  check(w.titles.s1 === '某个模型取的名' && w.renamed.length === 0, '事实说这条名是人写的：一个字都不动', 'got ' + w.titles.s1)
  check(locked(w) && w.reports[0].reason === 'hand-edit', '事实说人写的：回报让位 reason=hand-edit', JSON.stringify(w.reports))
}
{
  const w = makeWorld('帮我看看登录闪退')
  api.executeNamingOrder({
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: {
      lastMachineTitle: '[#779] 原样标题', baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false,
      firstUserText: '帮我看看登录闪退', titleSource: { kind: 'fallback', title: '早先的另一个名字' },
    },
  })
  await settle()
  check(w.titles.s1 === '[#779] 原样标题', '事实与现名对不上（标题已变）：退回旧判据，仍能盖回', 'got ' + w.titles.s1)
}

// 6) 同一张单跑两遍：第二遍必须收敛，不许把刚改好的名判成手改
{
  const w = makeWorld(CLOBBERED)
  const order = {
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: null, baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  }
  api.executeNamingOrder(order)
  await settle()
  api.executeNamingOrder(order)
  await settle()
  check(w.titles.s1 === '[#779] 原样标题', '同一张单跑两遍：标题仍是目标名', 'got ' + w.titles.s1)
  check(w.renamed.length === 1, '同一张单跑两遍：第二遍不再调改名（在位收敛）', JSON.stringify(w.renamed))
  check(!locked(w), '同一张单跑两遍：绝不误报锁定（这是「每成功一次就锁死一次」的那个坑）', JSON.stringify(w.reports))
}

// 7) 草稿档同样要经得起跑两遍
{
  const w = makeWorld(CLOBBERED)
  const order = {
    sessionId: 's1', kind: 'draft', hint: null,
    lock: { lastMachineTitle: null, baselineTitle: '[New] 诊断', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  }
  api.executeNamingOrder(order)
  await settle()
  api.executeNamingOrder(order)
  await settle()
  check(w.titles.s1 === '[草稿][诊断]', '草稿档跑两遍：标题仍是草稿档名', 'got ' + w.titles.s1)
  check(w.renamed.length === 1, '草稿档跑两遍：第二遍不再调改名', JSON.stringify(w.renamed))
  check(!locked(w), '草稿档跑两遍：绝不误报锁定', JSON.stringify(w.reports))
}

// 8) 本地 Markdown 后端的地图（编号 00）：目标名保持 [#00] 形状，不许被改写成 [0]
{
  const w = makeWorld(CLOBBERED)
  api.executeNamingOrder({
    sessionId: 's1', kind: 'numbered', number: 0, numberText: '00', title: '本地地图',
    lock: { lastMachineTitle: null, baselineTitle: '[#00] 本地地图', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  })
  await settle()
  check(w.titles.s1 === '[#00] 本地地图', '本地地图编号 00：目标名原样（不被改写成 [0]）', 'got ' + w.titles.s1)
}

// 9) 读标题口：快照读不到就静默跳过（不盲写、不误锁）
{
  const w = makeWorld(undefined)
  api.executeNamingOrder({
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: null, baselineTitle: '[#779] 原样标题', baselineIsOurs: false, locked: false },
  })
  await settle()
  check(w.renamed.length === 0 && !locked(w), '当前标题读不到：跳过（不盲写不误锁）', JSON.stringify({ renamed: w.renamed, reports: w.reports }))
}

// 10) 占位必须升草稿：现名是我们写的占位、但还不是草稿目标时，必须真改名而不是收敛
// （#746 交接卡死：收敛只认现名逐字等于目标，有我们经手过不等于已在位）
{
  const w = makeWorld('[New] 诊断')
  api.executeNamingOrder({
    sessionId: 's1', kind: 'draft', hint: '诊断',
    lock: { lastMachineTitle: null, baselineTitle: '[New] 诊断', baselineIsOurs: true, locked: false },
  })
  await settle()
  check(w.titles.s1 === '[草稿][诊断]', '占位升草稿：现名是占位基线也必须写过去', 'got ' + w.titles.s1)
  check(w.renamed.length === 1, '占位升草稿：发生了一次真改名（不是空收敛）', JSON.stringify(w.renamed))
  check(w.reports.length === 1 && w.reports[0].outcome === 'renamed' && w.reports[0].title === '[草稿][诊断]', '占位升草稿：按草稿名落定回报', JSON.stringify(w.reports))
}

// 10.5) 对抗场景：并发改名（读到的名在写之前被改掉）、改名被拒、改名面缺失
{
  // 第一次读给旧名（判据据此决定写），第二次读给新名 → 写前二次确认必须拦下，且一次都不改
  let reads = 0
  const w = makeWorld(CLOBBERED)
  const sessions = {
    list: { getSnapshot: function () { reads++; return { byId: { s1: { title: reads === 1 ? CLOBBERED : '写之前被改掉了' } } } } },
    scope: function (sid) { return { sessionId: sid } },
    sessionOf: function (scope) { return { sessionId: scope.sessionId, rename: function (t) { w.renamed.push(t); return Promise.resolve({ ok: true, value: { title: t } }) } } },
  }
  G.ctx = { get: function (k) { return k === 'sessions' ? sessions : undefined } }
  api.executeNamingOrder({
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: '[#779] 原样标题', baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  })
  await settle()
  check(w.renamed.length === 0, '并发改名：标题在写之前变了 → 一次都不改', JSON.stringify(w.renamed))
  check(w.reports.length === 1 && w.reports[0].outcome === 'failed' && w.reports[0].error === 'title changed before rename', '并发改名：如实回报 failed（不静默吞掉）', JSON.stringify(w.reports))
}
{
  // 改名被底座拒（例如标题非法）：回报 failed，入口进有限重试，不得误报成功
  const w = makeWorld(CLOBBERED)
  const sessions = {
    list: { getSnapshot: function () { return { byId: { s1: { title: CLOBBERED } } } } },
    scope: function (sid) { return { sessionId: sid } },
    sessionOf: function (scope) { return { sessionId: scope.sessionId, rename: function () { return Promise.resolve({ ok: false, error: { code: 'session/title-invalid', message: '标题非法' } }) } } },
  }
  G.ctx = { get: function (k) { return k === 'sessions' ? sessions : undefined } }
  api.executeNamingOrder({
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: '[#779] 原样标题', baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  })
  await settle()
  check(w.reports.length === 1 && w.reports[0].outcome === 'failed', '改名被拒：回报 failed（进有限重试，不误报成功）', JSON.stringify(w.reports))
}
{
  // 改名面缺失（会话没被 retain 住）：静默跳过，不报错也不误锁
  const w = makeWorld(CLOBBERED)
  const sessions = {
    list: { getSnapshot: function () { return { byId: { s1: { title: CLOBBERED } } } } },
    scope: function () { return undefined },
    sessionOf: function () { return null },
  }
  G.ctx = { get: function (k) { return k === 'sessions' ? sessions : undefined } }
  api.executeNamingOrder({
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: '[#779] 原样标题', baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  })
  await settle()
  check(!locked(w) && w.reports.length === 0, '改名面缺失：静默跳过（不报锁定、不误报失败）', JSON.stringify(w.reports))
}

// 11) 归因函数本身：六类各归各位（含来源事实优先与短首句的下限）
{
  const c = tracking.classifyDivergence
  const D = tracking.DIVERGENCE
  check(c({ currentTitle: '新会话', lastMachineTitle: null, baselineIsOurs: false, firstUserText: null }) === D.NEVER_WROTE, '归因：我们自己没写成 → never-wrote')
  check(c({ currentTitle: CLOBBERED, lastMachineTitle: '[#779] x', baselineIsOurs: true, firstUserText: FIRST_TEXT }) === D.FIRST_SENTENCE, '归因：首句截断 → first-sentence')
  check(c({ currentTitle: '1', lastMachineTitle: '[#779] x', baselineIsOurs: true, firstUserText: '1 你先看看' }) === D.HAND_EDIT, '归因：过短的前缀不再算首句派生（判据下限）')
  check(c({ currentTitle: '用户改的', lastMachineTitle: null, baselineIsOurs: true, firstUserText: FIRST_TEXT }) === D.HAND_EDIT, '归因：与首句无关 → hand-edit')
  check(c({ currentTitle: null, lastMachineTitle: null, baselineIsOurs: true, firstUserText: FIRST_TEXT }) === D.UNKNOWN_TITLE, '归因：标题读不到 → unknown-title')
  check(c({ currentTitle: '模型取的名', lastMachineTitle: '[#779] x', baselineIsOurs: true, firstUserText: FIRST_TEXT, titleSource: { kind: 'provider', title: '模型取的名' } }) === D.AUTO_TITLE, '归因：事实说底座取的（provider）→ auto-title')
  check(c({ currentTitle: '首句名', lastMachineTitle: '[#779] x', baselineIsOurs: true, firstUserText: FIRST_TEXT, titleSource: { kind: 'fallback', title: '首句名' } }) === D.AUTO_TITLE, '归因：事实说底座首句兜底 → auto-title')
  check(c({ currentTitle: '人写的', lastMachineTitle: '[#779] x', baselineIsOurs: true, firstUserText: FIRST_TEXT, titleSource: { kind: 'user', title: '人写的' } }) === D.HAND_EDIT, '归因：事实说人写的 → hand-edit（哪怕长得像首句名）')
  check(c({ currentTitle: '新来源', lastMachineTitle: null, baselineIsOurs: true, firstUserText: FIRST_TEXT, titleSource: { kind: 'future', title: '新来源' } }) === D.HAND_EDIT, '归因：事实来源未知 → 让位（宁可不改也不错配）')
  const noFact = { currentTitle: '模型取的名', lastMachineTitle: '[#779] x', baselineIsOurs: true, firstUserText: FIRST_TEXT }
  check(c(Object.assign({}, noFact, { titleSource: { kind: 'provider', title: '对不上的旧名' } })) === c(noFact), '归因：事实与现名对不上 → 与没有事实完全一致（退回旧判据）')
  check(c({ currentTitle: '[#779] x', lastMachineTitle: '[#779] x', baselineIsOurs: true, firstUserText: FIRST_TEXT, titleSource: { kind: 'user', title: '[#779] x' } }) === D.IN_PLACE, '归因：我们的名还在位 → in-place（事实不抢戏）')
}

if (failed) { console.log('\n命名端到端缝存在失败'); process.exit(1) }
console.log('\n全部通过（' + total + ' 项）')
