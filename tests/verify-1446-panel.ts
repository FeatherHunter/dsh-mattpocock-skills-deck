// tests/verify-1446-panel.ts — #1446（A3 账本换轨到后端模型）G4：面板按后端显示额度状态（验收第 4 条）
//
// 这一条门禁盯的是「面板说不说得清这个后端还剩多少额度」这件事，分三段验：
//   一、budgetNoticeLines 纯函数：四种后端（两桶 / 只计请求 / 离网 / 读数未知）各说什么。
//      最容易做假的几条也在这里量：读数未知时**不许冒出 0**、**不许上红档**；只有真耗尽才说
//      truth.failQuota；离网后端说的是「不需要额度」而不是「还没同步」。
//   二、快照编排器：带 budgetReadout 时 refresh.backend 字段齐全（只增不改旧四格）；
//      不带、回 null、抛错时 refresh 保持今天那份四格形状（不写 backend）。
//   三、快照信封：refresh 整块透传到 wf.snapshot 的回包，backend 跟着走。
//
// 判据不是「字符串出现过」，而是把界面那一半的真代码加载起来喂输入、看它吐出什么话
// （与 scripts/build.mts 拼接时同一套做法：剥行首 export，把闭包邻居按参数塞进去）。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1446-panel.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createSnapshotComposer } from '../src/host/tracker/snapshot.js'
import { createSnapshotEnvelope } from '../src/host/snapshotEnvelope.js'
import { freshnessLevel, lagPromiseFor, tierFor } from '../src/refresh/kernel/host-budget.js'
import { L_PAGES } from '../src/client/kernel/locale-data.ts'

const require = createRequire(import.meta.url)
// 两个中央刻度（探测间隔 / 写入合并窗口）住在时间配置里，不在 host-budget（与 verify-visible-truth 同一套取法）。
const centralTime = require('../src/shared/time-config/values.js')
const { PROBE_INTERVAL_MS, PATCH_MERGE_WINDOW_MS } = centralTime
const { compileFn } = require('./lib/eval-probe.js')
const { sourcePath } = require('./lib/source-text.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
let failed = false
let total = 0
const check = function (ok: any, msg: string): void {
  total += 1
  if (!ok) failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

/** 把一份「一源两物」的源文件当模块跑起来：剥行首 export，作用域里塞进它在拼接闭包里的邻居。 */
function loadModule(relPath: string, deps: Record<string, any>): any {
  const resolved = sourcePath(relPath)
  let src = fs.readFileSync(path.join(ROOT, resolved), 'utf8')
  // 中央时间 import 在 compileFn 的函数体里非法，求值前整行剥掉（闭包里由时间片段提供，这里由 deps 预埋）。
  src = src.split('\n').filter(function (l: string): boolean { return !/^\s*import\s.*time-config\/values\.js/.test(l) }).join('\n')
  if (resolved.endsWith('.ts')) src = require('esbuild').transformSync(src, TRANSPILE_OPTIONS).code
  const names: string[] = []
  const re = /^[ \t]*export[ \t]+(?:const|let|var|function|class)[ \t]+([A-Za-z_$][\w$]*)/gm
  let m
  while ((m = re.exec(src)) !== null) names.push(m[1])
  const trailing = /\nexport \{([^}]*)\};?\s*$/.exec(src)
  if (trailing) {
    for (const piece of trailing[1].split(',')) {
      const entry = piece.trim()
      if (!entry) continue
      const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(entry)
      names.push(asMatch ? asMatch[2] + ': ' + asMatch[1] : entry)
    }
    src = src.slice(0, trailing.index)
  }
  if (!names.length) throw new Error(relPath + ' 里没有找到 export 声明')
  const body = src.replace(/^[ \t]*export[ \t]+/gm, '')
  const keys = Object.keys(deps)
  const fn = compileFn(keys, body + '\nreturn { ' + names.join(', ') + ' }')
  return fn.apply(null, keys.map(function (k: string): any { return deps[k] }))
}

const truth = loadModule('src/client/views/shared/truthLines.js', {
  freshnessLevel: freshnessLevel,
  lagPromiseFor: lagPromiseFor,
  tierFor: tierFor,
  PROBE_INTERVAL_MS: PROBE_INTERVAL_MS,
  PATCH_MERGE_WINDOW_MS: PATCH_MERGE_WINDOW_MS,
  idOfParts: function (effort: any, key: any): string { return String(effort || '') + '\0' + String(key == null ? '' : key) },
})
const zh = L_PAGES.zh as Record<string, string>
const en = L_PAGES.en as Record<string, string>
const say = function (key: string, params?: Record<string, any>): string {
  let s = zh[key]
  if (s === undefined) { check(false, '词条缺失：' + key + '（locale-data 的 zh）'); return '' }
  Object.keys(params || {}).forEach(function (k: string): void { s = s.split('{' + k + '}').join(String((params as any)[k])) })
  return s
}
const keysOf = function (lines: any[]): string {
  return (lines || []).map(function (ln: any): string { return String(ln && ln.key) }).join(',')
}
const linesWith = function (lines: any[], key: string): any[] {
  return (lines || []).filter(function (ln: any): boolean { return ln && ln.key === key })
}

// ---------- 一、budgetNoticeLines：四种后端各说什么 ----------
console.log('#1446 面板额度读数（纯函数 / 快照编排器 / 信封透传）')
;(function checkBudgetLines() {
  const twoBuckets = function (graphqlRemaining: number, restRemaining: number): any {
    return { budgetKind: 'two-buckets', readKnown: true, offNetwork: false, buckets: { graphql: { remaining: graphqlRemaining, limit: 5000 }, rest: { remaining: restRemaining, limit: 5000 } } }
  }
  check(truth.budgetNoticeLines(null).length === 0, '没有 refresh 读数时一句话都不说（不凭空报额度）')
  check(truth.budgetNoticeLines({ tier: null, deferred: false }).length === 0, 'refresh 上没有 backend 这一格时，面板保持今天的样子（不新增一行）')

  const both = truth.budgetNoticeLines({ backend: twoBuckets(4200, 4500) })
  check(both.length === 2 && keysOf(both) === 'truth.budgetGraphql,truth.budgetRest', '两桶后端：先说 GraphQL、再说 REST（实得 ' + keysOf(both) + '）')
  check(both[0] && both[0].params.remaining === 4200 && both[0].params.limit === 5000, 'GraphQL 那一行带着剩余量与总额（渲染成「GraphQL 剩 4200/5000」）')
  check(both[0] && both[0].tone === 'fresh' && both[1] && both[1].tone === 'fresh', '两桶都还很宽裕时是绿档（tone=fresh），不提前吓人')

  const nearRed = truth.budgetNoticeLines({ backend: twoBuckets(500, 4500) })
  check(nearRed[0] && nearRed[0].tone === 'red', 'GraphQL 只剩一成（used 0.9）时是红档，档位沿用 host-budget 的 tierFor')
  const nearYellow = truth.budgetNoticeLines({ backend: twoBuckets(1000, 4500) })
  check(nearYellow[0] && nearYellow[0].tone === 'yellow', 'GraphQL 用掉八成（used 0.8）时是黄档，不新造档位词')

  const req = truth.budgetNoticeLines({ backend: { budgetKind: 'requests', readKnown: true, offNetwork: false, requests: { remaining: 3000, limit: 5000 } } })
  check(req.length === 1 && req[0].key === 'truth.budgetRequests', '只计请求的后端说「请求额度剩 N/M」（实得 ' + keysOf(req) + '）')
  check(req[0] && req[0].params.remaining === 3000 && req[0].params.limit === 5000 && req[0].tone === 'fresh', '请求额度那一行带着剩余量与总额，宽裕时绿档')
  check(say('truth.budgetRequests', { remaining: 3000, limit: 5000 }).indexOf('3000/5000') >= 0, '词条真的把数字填进句子：' + say('truth.budgetRequests', { remaining: 3000, limit: 5000 }))

  const exhaustedReq = truth.budgetNoticeLines({ backend: { budgetKind: 'requests', readKnown: true, offNetwork: false, requests: { remaining: 0, limit: 5000 } } })
  check(exhaustedReq.length === 1 && exhaustedReq[0].key === 'truth.failQuota' && exhaustedReq[0].tone === 'red', '请求额度真的见底（剩 0）才说 truth.failQuota，红档')

  const unknown = truth.budgetNoticeLines({ backend: { budgetKind: 'two-buckets', readKnown: false, offNetwork: false } })
  check(unknown.length === 1 && unknown[0].key === 'truth.budgetUnknown', '读数未知时说「额度读数还没同步上来」（实得 ' + keysOf(unknown) + '）')
  check(unknown[0] && unknown[0].tone !== 'red' && unknown[0].tone !== 'yellow', '读数未知时不许上红/黄档：不知道不等于紧张')
  check(unknown[0] && Object.keys(unknown[0].params).length === 0 && !/[0-9]/.test(JSON.stringify(unknown[0])), '读数未知时整行一个数字都没有（尤其不许出现 0）')
  const unknownWithNumbers = truth.budgetNoticeLines({ backend: { budgetKind: 'two-buckets', readKnown: false, offNetwork: false, buckets: { graphql: { remaining: 0, limit: 5000 } } } })
  check(unknownWithNumbers[0] && unknownWithNumbers[0].key === 'truth.budgetUnknown' && !/[0-9]/.test(JSON.stringify(unknownWithNumbers[0])), 'readKnown 不为真时就算带了数字也不许念出来（0 会被读成已耗尽）')

  const offline = truth.budgetNoticeLines({ backend: { budgetKind: 'none', readKnown: false, offNetwork: true } })
  check(offline.length === 1 && offline[0].key === 'truth.budgetOffNetwork' && offline[0].tone === 'fresh', '离网后端说「本后端不出站，不需要额度」，不说「还没同步」')
  check(say('truth.budgetOffNetwork') === '本后端不出站，不需要额度', '离网那句词条就是「不需要额度」，不是「读数未知」的同义词')

  const oneBucket = truth.budgetNoticeLines({ backend: { budgetKind: 'two-buckets', readKnown: true, offNetwork: false, buckets: { graphql: { remaining: 4100, limit: 5000 } } } })
  check(oneBucket.length === 1 && oneBucket[0].key === 'truth.budgetGraphql', '只有一桶有读数时只念那一桶（缺的那桶不说，不编一个 0）')

  const gqlDead = truth.budgetNoticeLines({ backend: twoBuckets(0, 4000) })
  check(gqlDead.length === 2 && gqlDead[0].tone === 'red' && gqlDead[0].params.remaining === 0 && !keysOf(gqlDead).includes('truth.failQuota'), 'GraphQL 见底但 REST 还能走：如实说 0，但不说整块配额耗尽')

  const bothDead = truth.budgetNoticeLines({ backend: twoBuckets(0, 0) })
  check(bothDead.length === 1 && bothDead[0].key === 'truth.failQuota' && bothDead[0].tone === 'red', '两个桶都见底才算真耗尽，说 truth.failQuota')

  const missingRequests = truth.budgetNoticeLines({ backend: { budgetKind: 'requests', readKnown: true, offNetwork: false } })
  check(missingRequests.length === 1 && missingRequests[0].key === 'truth.budgetUnknown', '声称读数已知却没有请求额度数字：退回「还没同步」，不许补 0')

  const malformed = truth.budgetNoticeLines({ backend: { budgetKind: 'requests', readKnown: true, offNetwork: false, requests: { remaining: '3', limit: 5000 } } })
  check(malformed.length === 1 && malformed[0].key === 'truth.budgetUnknown', '读数形状不对（数字不是数字）时按未知处理，不硬拼一句话')

  check(truth.budgetNoticeLines({ backend: { budgetKind: 'none', readKnown: true, offNetwork: false } }).length === 0, 'budgetKind=none 且不出站也不离网：没有额度可念，就一个字都不说')
  check(truth.budgetNoticeLines({ backend: { budgetKind: 'something-new', readKnown: true, offNetwork: false } }).length === 0, '没见过的 budgetKind 不猜格式（面板按后端声明读，不按名字推算）')

  ;['truth.budgetGraphql', 'truth.budgetRest', 'truth.budgetRequests', 'truth.budgetOffNetwork', 'truth.budgetUnknown'].forEach(function (k: string): void {
    check(!!zh[k] && !!en[k], '词条中英两面都在：' + k + '（zh=' + JSON.stringify(zh[k]) + '）')
  })
})()

// ---------- 一之二、并进面板那一行：truthNoticeLines 读得到额度那句 ----------
;(function checkPanelMerge() {
  const stWith = function (backend: any, extra?: any): any {
    return Object.assign({ snapshot: { generatedMs: 1, refresh: { tier: null, deferred: false, paused: false, notRefreshing: false, backend: backend } }, snapMode: 'real', snapError: null }, extra || {})
  }
  const merged = truth.truthNoticeLines(stWith({ budgetKind: 'two-buckets', readKnown: true, offNetwork: false, buckets: { graphql: { remaining: 4200, limit: 5000 }, rest: { remaining: 4500, limit: 5000 } } }), 1)
  check(keysOf(merged).indexOf('truth.budgetGraphql') >= 0 && keysOf(merged).indexOf('truth.budgetRest') >= 0, '面板那一行（truthNoticeLines）里并进了额度两句（实得 ' + keysOf(merged) + '）')
  const unknownMerged = truth.truthNoticeLines(stWith({ budgetKind: 'two-buckets', readKnown: false, offNetwork: false }), 1)
  check(keysOf(unknownMerged) === 'truth.budgetUnknown' && unknownMerged[0].tone === 'fresh', '读数未知时面板只说一句「还没同步」，不叠红档')
  const noBudget = truth.truthNoticeLines({ snapshot: { generatedMs: 1, refresh: { tier: null, deferred: false, paused: false, notRefreshing: false } }, snapMode: 'real', snapError: null }, 1)
  check(noBudget.length === 0, '没有额度读数时不新增任何一行（老快照的回包行为不变）')
  const dup = truth.truthNoticeLines(stWith({ budgetKind: 'requests', readKnown: true, offNetwork: false, requests: { remaining: 0, limit: 5000 } }, { snapMode: 'err', snapError: 'boom', snapFail: { kind: 'quota-exhausted' } }), 1)
  check(linesWith(dup, 'truth.failQuota').length === 1, '取数失败那句与额度耗尽那句是同一个事实：去重后只说一遍（实得 ' + keysOf(dup) + '）')
})()

// ---------- 二、快照编排器：拿到就写 backend，拿不到保持四格 ----------
const REF = { backend: 'fake', refId: 'acme/demo', name: 'demo', url: '' }
const makeTracker = function (): any {
  return { list: async function (): Promise<any> { return { ok: true, data: [] } } }
}
const makeComposer = function (opts?: any): any {
  return createSnapshotComposer({ get: function (bid: string): any { return bid === REF.backend ? makeTracker() : undefined } }, Object.assign({ snapshotTtl: 1, depsTtl: 1 }, opts || {}))
}
const REFRESH_KEYS = 'deferred,notRefreshing,paused,tier'
await (async function checkComposer() {
  const budget = { budgetKind: 'two-buckets', readKnown: true, offNetwork: false, buckets: { graphql: { remaining: 4200, limit: 5000 }, rest: { remaining: 60, limit: 60 } } }
  const withReadout = await makeComposer({ budgetReadout: function (): any { return budget } }).composeSnapshot(REF.backend, REF, {}, { force: true })
  const ref1 = withReadout.ok === true && withReadout.snapshot && withReadout.snapshot.refresh
  check(!!ref1 && !!ref1.backend, '带 budgetReadout 时 refresh 上多了 backend 这一格')
  check(!!ref1 && ref1.backend.id === REF.backend && ref1.backend.budgetKind === 'two-buckets' && ref1.backend.readKnown === true && ref1.backend.offNetwork === false, 'backend 的四个基本字段齐全且原样（id / budgetKind / readKnown / offNetwork）')
  check(!!ref1 && ref1.backend.buckets && ref1.backend.buckets.graphql.remaining === 4200 && ref1.backend.buckets.graphql.limit === 5000, '两桶读数原样带过来（GraphQL 4200/5000）')
  check(!!ref1 && ref1.backend.buckets.rest.remaining === 60 && ref1.backend.buckets.rest.limit === 60, '两桶读数原样带过来（REST 60/60）')
  check(!!ref1 && ref1.backend.requests === undefined, '两桶后端身上不塞一个空的 requests（只写真的有的那一格）')
  check(!!ref1 && ref1.tier === null && ref1.deferred === false && ref1.paused === false && ref1.notRefreshing === false, '旧四格的语义一字不变（tier 仍是 null、其余仍是 false）')

  const requestsReadout = await makeComposer({ budgetReadout: async function (): Promise<any> { return { budgetKind: 'requests', readKnown: true, offNetwork: false, requests: { remaining: 3000, limit: 5000 } } } }).composeSnapshot(REF.backend, REF, {}, { force: true })
  check(!!requestsReadout.snapshot.refresh.backend && requestsReadout.snapshot.refresh.backend.requests.remaining === 3000, '异步读数的只计请求形态也原样带过来')

  const wrapped = await makeComposer({ budgetReadout: function (): any { return { ok: true, readout: { budgetKind: 'two-buckets', readKnown: false, offNetwork: false } } } }).composeSnapshot(REF.backend, REF, {}, { force: true })
  check(!!wrapped.snapshot.refresh.backend && wrapped.snapshot.refresh.backend.readKnown === false, '生产者回 {ok, readout} 包装时也能解开（与 workRouteTableReadout 同一种口子）')

  const noReadout = await makeComposer({}).composeSnapshot(REF.backend, REF, {}, { force: true })
  check(noReadout.ok === true && noReadout.snapshot.refresh && Object.keys(noReadout.snapshot.refresh).sort().join(',') === REFRESH_KEYS, '没接 budgetReadout 时 refresh 保持今天那份四格形状（实得 ' + Object.keys(noReadout.snapshot.refresh).sort().join(',') + '）')

  const nullReadout = await makeComposer({ budgetReadout: function (): any { return null } }).composeSnapshot(REF.backend, REF, {}, { force: true })
  check(nullReadout.ok === true && Object.keys(nullReadout.snapshot.refresh).sort().join(',') === REFRESH_KEYS, '读数口回 null（这一趟拿不到）时同样不写 backend')

  const thrownReadout = await makeComposer({ budgetReadout: function (): any { throw new Error('budget down') } }).composeSnapshot(REF.backend, REF, {}, { force: true })
  check(thrownReadout.ok === true && Object.keys(thrownReadout.snapshot.refresh).sort().join(',') === REFRESH_KEYS, '读数口抛错不能连累快照：快照照旧成功，refresh 保持四格')

  let askedId = ''
  await makeComposer({ budgetReadout: function (id: string): any { askedId = id; return null } }).composeSnapshot(REF.backend, REF, {}, { force: true })
  check(askedId === REF.backend, '读数口按后端 id 取（拿到的是 composeSnapshot 的那个 backendId）')

  const badShape = await makeComposer({ budgetReadout: function (): any { return { budgetKind: 'two-buckets', readKnown: true, offNetwork: false, buckets: { graphql: { remaining: 'many', limit: 5000 } }, reason: 'unavailable' } } }).composeSnapshot(REF.backend, REF, {}, { force: true })
  const badBackend = badShape.snapshot.refresh.backend
  check(!!badBackend && badBackend.buckets === undefined && badBackend.reason === 'unavailable', '形状不对的桶被丢掉（不把字符串剩余量当数字），但 reason 照带')

  const noReason = await makeComposer({ budgetReadout: function (): any { return { budgetKind: 'two-buckets', readKnown: true, offNetwork: false, reason: 'whatever' } } }).composeSnapshot(REF.backend, REF, {}, { force: true })
  check(noReason.snapshot.refresh.backend.reason === undefined, '不认识的 reason 不硬塞（枚举之外的词不往下传）')
})()

// ---------- 三、快照信封：refresh 整块透传，backend 跟着走 ----------
;(function checkEnvelope() {
  const env = createSnapshotEnvelope({ getGhPath: function (): null { return null }, getGhLastError: function (): null { return null } })
  const backend = { id: 'fake', budgetKind: 'requests', readKnown: true, offNetwork: false, requests: { remaining: 3000, limit: 5000 } }
  const refresh = { tier: null, deferred: false, paused: false, notRefreshing: false, backend: backend }
  const snap = env.buildSnap({ deck: null, refresh: refresh } as any)
  check(!!snap.refresh && snap.refresh.backend && snap.refresh.backend.id === 'fake', 'wf.snapshot 回包把 refresh.backend 带出去了（宿主写了、界面读得到）')
  check(!!snap.refresh && JSON.stringify(snap.refresh.backend) === JSON.stringify(backend), 'backend 整块原样透传（这一层不拆字段、不补默认值）')
  check(!!snap.refresh && snap.refresh.tier === null && snap.refresh.deferred === false && snap.refresh.paused === false && snap.refresh.notRefreshing === false, '信封透传不改变旧四格的值')
  const snapNoBackend = env.buildSnap({ deck: null, refresh: { tier: null, deferred: false, paused: false, notRefreshing: false } } as any)
  check(!!snapNoBackend.refresh && !('backend' in snapNoBackend.refresh), '老形状的 refresh 过信封之后仍然没有 backend（不凭空补一格）')
  const snapNone = env.buildSnap({ deck: null } as any)
  check(snapNone.refresh === null, '上游没给 refresh 时回包仍是 null（与今天一致）')
})()

// ---------- 输出 ----------
console.log('#1446 面板额度读数门禁：共 ' + total + ' 条断言')
if (failed) {
  console.log('\n存在失败')
  process.exit(1)
}
console.log('\n全部通过')
