// tests/verify-naming-e2e.js — 命名守护的端到端缝（对抗审查的产物）
//
// 为什么单开这一条：这一轮查出的四个洞（我们自己没写成被判手改、机器写过之后被底座首句名盖掉、
// 零号编号档的半登记态、裸档被盖不修）全都住在「纯函数拼起来」的那道缝里 —— 各自的纯函数测试都是绿的，
// 合起来才错。所以这里搭一套最小的假环境，直接驱动宿主直执行那一段：
//   假会话服务（get / scope / sessionOf + rename 写回标题）、
//   假底面（会按首条用户消息写首句名的那个「底座」）、
//   假命名守护（只收 handleNamingResult 的回报，用来断言让位理由）。
// 断言只看一件事：跑完之后这个会话的标题是什么、以及有没有在不该让位的时候让位。
import { createNamingSummary } from '../src/host/platform/namingSummary.js'
import { classifyDivergence, DIVERGENCE } from '../src/shared/naming-tracking.js'

let failed = false
let total = 0
function check(ok, msg, detail) {
  total++
  if (ok) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + detail : '')) }
}

const FIRST_TEXT = '/wayfinder https://github.com/FeatherHunter/dsh-prompt/issues/779\n\n执行这个 issue'
// 底座写下的首句名 = 首句的截断（这里取到 URL 结束，长度足够，用来验「截断那条路要有下限」）
const CLOBBERED = '/wayfinder https://github.com/FeatherHunter/dsh-prompt/issues/779'

function makeWorld(initialTitle) {
  const world = {
    titles: { s1: initialTitle },
    renamed: [],
    reports: [],
  }
  const sessions = {
    get: function (sid) { return world.titles[sid] === undefined ? null : { title: world.titles[sid] } },
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
  const ctx = {
    get: function (k) {
      if (k === 'sessions') return sessions
      if (k === 'sessionQuery') return { readSession: async function () { return { events: [{ seq: 1, type: 'user/message', data: FIRST_TEXT }] } } }
      return undefined
    },
  }
  const naming = { handleNamingResult: async function (a) { world.reports.push(a); return { ok: true } } }
  world.summary = createNamingSummary({ ctx: ctx, getNaming: async function () { return naming }, logCtx: null })
  return world
}

console.log('\n— 命名守护端到端缝（宿主直执行那一段）—')

// 1) 我们自己的那次改名没落地：平台默认名还在，名字仍归插件 → 直接写成目标名
{
  const w = makeWorld('新会话')
  await w.summary.executeOrdersHost([{
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: null, baselineTitle: '[#779] 原样标题', baselineIsOurs: false, locked: false },
  }])
  check(w.titles.s1 === '[#779] 原样标题', '没写成的那种：直接写成目标名（不再被判手改）', 'got ' + w.titles.s1)
  check(!w.reports.some(function (r) { return r.outcome === 'locked' }), '没写成的那种：不报锁定（名字本来就没被用户碰过）', JSON.stringify(w.reports))
  check(w.reports.length === 1 && w.reports[0].outcome === 'renamed', '没写成的那种：按改名落定回报（台账据此记下我们写过的名）', JSON.stringify(w.reports))
}

// 2) 机器写过之后，底座按首句名把它盖掉：不是手改 → 盖回 [#n] 名
{
  const w = makeWorld(CLOBBERED)
  await w.summary.executeOrdersHost([{
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: '[#779] 原样标题', baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  }])
  check(w.titles.s1 === '[#779] 原样标题', '首句名盖掉之后：盖回 [#n] 名（机器写过也认）', 'got ' + w.titles.s1)
  check(!w.reports.some(function (r) { return r.outcome === 'locked' }), '首句名盖回：不报锁定', JSON.stringify(w.reports))
}

// 3) 真手改：与首句无关 → 一步都不动，并如实回报让位理由
{
  const w = makeWorld('我自己起的名字')
  await w.summary.executeOrdersHost([{
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: '[#779] 原样标题', baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  }])
  check(w.titles.s1 === '我自己起的名字', '真手改：一个字都不动（手改永不被覆盖）', 'got ' + w.titles.s1)
  check(w.renamed.length === 0, '真手改：没有发生任何改名调用')
  check(w.reports.length === 1 && w.reports[0].outcome === 'locked' && w.reports[0].reason === 'hand-edit', '真手改：让位理由如实回报 hand-edit', JSON.stringify(w.reports))
}

// 4) 裸档草稿被首句名盖掉：没有线索也要盖回（对抗审查 C：从前这条被守卫挡下，永远修不回来）
{
  const w = makeWorld(CLOBBERED)
  await w.summary.executeOrdersHost([{
    sessionId: 's1', kind: 'draft', hint: null,
    lock: { lastMachineTitle: '[草稿][新增需求]', baselineTitle: '[New] 新建需求', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  }])
  check(w.titles.s1 === '[草稿][新增需求]', '裸档被盖：照样盖回裸档名（守卫已删）', 'got ' + w.titles.s1)
}

// 3.5) 同一张单跑两遍（宿主直执行先跑，客户端随后拿同一张单再跑一遍）：第二遍必须收敛，不许把刚改好的名判成手改
{
  const w = makeWorld(CLOBBERED)
  const order = {
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: null, baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  }
  await w.summary.executeOrdersHost([order])
  await w.summary.executeOrdersHost([order])
  check(w.titles.s1 === '[#779] 原样标题', '同一张单跑两遍：标题仍是目标名', 'got ' + w.titles.s1)
  check(w.renamed.length === 1, '同一张单跑两遍：第二遍不再调改名（在位收敛）', JSON.stringify(w.renamed))
  check(!w.reports.some(function (r) { return r.outcome === 'locked' }), '同一张单跑两遍：绝不误报锁定（这是「每成功一次就锁死一次」的那个坑）', JSON.stringify(w.reports))
}

// 3.6) 草稿档同样要经得起跑两遍（同一张单：宿主先跑、客户端后跑）
{
  const w = makeWorld(CLOBBERED)
  const order = {
    sessionId: 's1', kind: 'draft', hint: null,
    lock: { lastMachineTitle: null, baselineTitle: '[New] 诊断', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  }
  await w.summary.executeOrdersHost([order])
  await w.summary.executeOrdersHost([order])
  check(w.titles.s1 === '[草稿][诊断]', '草稿档跑两遍：标题仍是草稿档名', 'got ' + w.titles.s1)
  check(w.renamed.length === 1, '草稿档跑两遍：第二遍不再调改名', JSON.stringify(w.renamed))
  check(!w.reports.some(function (r) { return r.outcome === 'locked' }), '草稿档跑两遍：绝不误报锁定', JSON.stringify(w.reports))
}

// 4.5) 本地 Markdown 后端的地图（编号 00）：目标名保持 [#00] 形状，不许被改写成 [0]
{
  const w = makeWorld(CLOBBERED)
  await w.summary.executeOrdersHost([{
    sessionId: 's1', kind: 'numbered', number: 0, numberText: '00', title: '本地地图',
    lock: { lastMachineTitle: null, baselineTitle: '[#00] 本地地图', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  }])
  check(w.titles.s1 === '[#00] 本地地图', '本地地图编号 00：目标名原样（不被改写成 [0]）', 'got ' + w.titles.s1)
}

// 5) 归因函数本身：五类各归各位（含短首句不再算「首句派生」）
{
  check(classifyDivergence({ currentTitle: '新会话', lastMachineTitle: null, baselineIsOurs: false, firstUserText: null }) === DIVERGENCE.NEVER_WROTE, '归因：我们自己没写成 → never-wrote')
  check(classifyDivergence({ currentTitle: CLOBBERED, lastMachineTitle: '[#779] x', baselineIsOurs: true, firstUserText: FIRST_TEXT }) === DIVERGENCE.FIRST_SENTENCE, '归因：首句截断 → first-sentence')
  check(classifyDivergence({ currentTitle: '1', lastMachineTitle: '[#779] x', baselineIsOurs: true, firstUserText: '1 你先看看' }) === DIVERGENCE.HAND_EDIT, '归因：过短的前缀不再算首句派生（判据下限）')
  check(classifyDivergence({ currentTitle: '用户改的', lastMachineTitle: null, baselineIsOurs: true, firstUserText: FIRST_TEXT }) === DIVERGENCE.HAND_EDIT, '归因：与首句无关 → hand-edit')
  check(classifyDivergence({ currentTitle: null, lastMachineTitle: null, baselineIsOurs: true, firstUserText: FIRST_TEXT }) === DIVERGENCE.UNKNOWN_TITLE, '归因：标题读不到 → unknown-title')
}

// 6) 读标题口：快照优先、旧口兼容、两无则跳过（#746 V5：0.1.7 上 Session 无 title，真源是列表行）
function makeWorldWith(listTitle, getTitle) {
  const world = { titles: {}, renamed: [], reports: [] }
  const sessions = {
    list: { getSnapshot: function () { return { byId: listTitle == null ? {} : { s1: { title: listTitle } } } } },
  }
  if (getTitle !== undefined) sessions.get = function () { return getTitle == null ? null : { title: getTitle } }
  sessions.scope = function (sid) { return { sessionId: sid } }
  sessions.sessionOf = function (scope) {
    return { sessionId: scope.sessionId, rename: function (t) { world.renamed.push(t); return Promise.resolve({ ok: true, value: { title: t } }) } }
  }
  const ctx = {
    get: function (k) {
      if (k === 'sessions') return sessions
      if (k === 'sessionQuery') return { readSession: async function () { return { events: [{ seq: 1, type: 'user/message', data: FIRST_TEXT }] } } }
      return undefined
    },
  }
  const naming = { handleNamingResult: async function (a) { world.reports.push(a); return { ok: true } } }
  world.summary = createNamingSummary({ ctx: ctx, getNaming: async function () { return naming }, logCtx: null })
  return world
}
{
  // 快照有、旧口无：只走快照也能改名（旧代码要求旧口存在，直接回 false）
  const w2 = makeWorldWith('[#779] 原样标题', undefined)
  await w2.summary.executeOrdersHost([{
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: null, baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  }])
  check(w2.reports.length === 1 && w2.reports[0].outcome === 'renamed', '读数：快照独有即走通（旧口缺席不拦路）', JSON.stringify(w2.reports))
}
{
  // 两口冲突：快照胜出（旧口是过期照片时不被带偏）
  const w = makeWorldWith('[#779] 原样标题', '底座首句旧照片')
  await w.summary.executeOrdersHost([{
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: null, baselineTitle: '[#779] 原样标题', baselineIsOurs: true, locked: false, firstUserText: FIRST_TEXT },
  }])
  check(w.renamed.length === 0 && w.reports.length === 1 && w.reports[0].outcome === 'renamed', '读数：两口冲突以快照为准（在位收敛不空改）', JSON.stringify({ renamed: w.renamed, reports: w.reports }))
}
{
  // 两口皆无：静默跳过，不改名不锁（下一轮快照到了再跑）
  const w = makeWorldWith(null, null)
  await w.summary.executeOrdersHost([{
    sessionId: 's1', kind: 'numbered', number: 779, title: '原样标题',
    lock: { lastMachineTitle: null, baselineTitle: '[#779] 原样标题', baselineIsOurs: false, locked: false },
  }])
  check(w.renamed.length === 0 && !w.reports.some(function (r) { return r.outcome === 'locked' }), '读数：两口皆无则跳过（不盲写不误锁）', JSON.stringify({ renamed: w.renamed, reports: w.reports }))
}

// 7) 占位必须升草稿：现名是我们写的占位、但还不是草稿目标时，必须真改名而不是收敛
// （#746 交接卡死：收敛只认现名逐字等于目标，有我们经手过不等于已在位）
{
  const w = makeWorld('[New] 诊断')
  await w.summary.executeOrdersHost([{
    sessionId: 's1', kind: 'draft', hint: '诊断',
    lock: { lastMachineTitle: null, baselineTitle: '[New] 诊断', baselineIsOurs: true, locked: false },
  }])
  check(w.titles.s1 === '[草稿][诊断]', '占位升草稿：现名是占位基线也必须写过去', 'got ' + w.titles.s1)
  check(w.renamed.length === 1, '占位升草稿：发生了一次真改名（不是空收敛）', JSON.stringify(w.renamed))
  check(w.reports.length === 1 && w.reports[0].outcome === 'renamed' && w.reports[0].title === '[草稿][诊断]', '占位升草稿：按草稿名落定回报', JSON.stringify(w.reports))
}

if (failed) { console.log('\n命名端到端缝存在失败'); process.exit(1) }
console.log('\n全部通过（' + total + ' 项）')
