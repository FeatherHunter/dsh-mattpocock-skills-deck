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

if (failed) { console.log('\n命名端到端缝存在失败'); process.exit(1) }
console.log('\n全部通过（' + total + ' 项）')
