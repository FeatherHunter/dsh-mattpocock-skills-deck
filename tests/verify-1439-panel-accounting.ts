// tests/verify-1439-panel-accounting.ts —— 门禁：面板取数经 Tracker 会话、面板用量经闸进唯一账本（#1439 A2 + #1454）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1439-panel-accounting.ts，可独立运行。
//
// 为什么要有这一扇：规格 #1439 的 A2 要求刷新后台的「快照」也迁到 Tracker 操作（选后端只读本地证据，
// 需要出站的取数在会话建立之后作为操作过闸），#1454 又要求账本只有操作管线 account 一处写入口。
// 两件事单独看都有别处绿，合起来最容易出漏：面板取数从注册表拿实例（绕开会话与闸、房间实现外泄），
// 或者迁移之后用量反而没人记。本门禁钉住三件事：
//   ① 静态：面板两处电话（wf.snapshot 与 wf.refresh）把 openSession 交给快照编排器，自己不再向注册表取实例；
//      编排器接了会话口就走会话操作，这一层用不上时回落注册表实例（门禁单测与老调用点保持原形状）；宿主把会话口交给两处；
//      deck 补仓库身份改问会话能力；刷新运行时把 createAccountPort 接进闸。
//   ② 行为：编排器拿到会话口时，list / counts / getDependencies 都经 opened.call 调会话操作，
//      cwd 用调用方给的、write 固定 false；会话打不开、后端对不上时回落注册表实例，两边都取不到才如实报「不可达」；
//      不接会话口、或接了会话口但这一层开不起来时，都按注册表实例把快照组出来（老调用方不掉、面板不整份失败）。
//   ③ 行为：面板与强制刷新的真实用量由闸交给唯一记账口（createAccountPort），按后端预算口径分桶：
//      两桶后端按请求 / 点数分桶、人的动作记 user-action、后台记 plugin、失败那一步也记、
//      离网后端一笔不记也不建桶、模型未知仍按请求口径记；没接记账口时账本一分不动（钉住「不接就不记」）。
//
// 本门禁只做静态扫描与装配层的行为断言（假会话、真账本 + 真闸），不连远端、不起子进程。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSnapshotComposer } from '../src/host/tracker/snapshot.js'
import { createLedger } from '../src/refresh/rooms/host/quota-ledger.js'
import { createAccountPort, normalizeBudgetDeclaration } from '../src/refresh/kernel/backend-accounting.js'
import { createGate } from '../src/refresh/rooms/host/refresh-gate.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
let failed = false
let total = 0
function check(ok: any, msg: string): void {
  total += 1
  if (!ok) failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}
function countOf(hay: string, needle: string): number {
  return hay.split(needle).length - 1
}
/** 去掉注释再扫：文件头注释与行尾注释里写代码片段不该被当成实现。 */
function stripComments(text: string): string {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map(function (l: string): string { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l }).join('\n')
}
function srcOf(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
}

// ---------- ① 静态：面板取数经会话、宿主把会话口交出去、闸接上唯一记账口 ----------
console.log('面板取数与记账接线（#1439 A2 / #1454：面板经会话取数，用量经闸进唯一账本）')
{
  const cache = srcOf('src/refresh/rooms/host/session-snapshot-cache.ts')
  check(countOf(cache, '{ openSession: openSession }') === 2, 'wf.snapshot 的主路径与回退路径都把会话口交给快照编排器（实得 ' + countOf(cache, '{ openSession: openSession }') + ' 处）')
  check(cache.indexOf('const tracker = reg.get(') < 0 && cache.indexOf('const tracker2 = reg2.get(') < 0,
    '面板快照不再向注册表取实例（两处 composer 前面都没有 reg.get / reg2.get 的实例存在性检查）')
  check(cache.indexOf('openSession?:') >= 0, '面板快照的依赖类型里有 openSession 这一格（接不上时留空、按老形状走）')

  const schedule = srcOf('src/refresh/rooms/host/session-refresh-schedule.ts')
  check(schedule.indexOf('composerOpts.openSession = openSession') >= 0 && schedule.indexOf('composer2Opts2.openSession = openSession') >= 0,
    'wf.refresh（强制刷新）的主路径与回退路径也把会话口交给编排器')
  check(schedule.indexOf('const tracker = reg.get(') < 0 && schedule.indexOf('const tracker2 = reg2.get(') < 0,
    '强制刷新不再向注册表取实例（后端不认识时由编排器的会话门面报不可达）')

  const host = srcOf('src/host/index.ts')
  check(countOf(host, 'openSession: function (cwd') === 2,
    '宿主把 refresh wiring 的会话口分别交给 wf.snapshot 与 wf.refresh 两处电话（实得 ' + countOf(host, 'openSession: function (cwd') + ' 处）')

  const snap = srcOf('src/host/tracker/snapshot.ts')
  check(snap.indexOf('const trackerFor') >= 0 && snap.indexOf('opened.call(') >= 0, '编排器有取数门面 trackerFor，并经 opened.call 调会话操作')
  check(countOf(snap, 'registry.get(') === 1, '编排器只在会话这一层用不上时回落注册表取实例（全文件 registry.get 恰好一处，实得 ' + countOf(snap, 'registry.get(') + ' 处）')
  check(snap.indexOf("not reachable (composition aborted)") >= 0, '会话与注册表都取不到实例时才如实说不可达，不假装组出来')

  const deck = srcOf('src/deck/tools/tracker-session.ts')
  check(deck.indexOf('registry.get(') < 0 && deck.indexOf('sessionAny.getRepoKey') >= 0,
    'deck 补仓库身份改问已开会话的 getRepoKey 能力（不再向注册表取实例）')

  const runtime = srcOf('src/refresh/rooms/host/refresh-runtime.ts')
  check(runtime.indexOf('createAccountPort') >= 0 && runtime.indexOf('accountFor: accountFor') >= 0,
    '刷新运行时把 createAccountPort 造好接进闸（面板与强制刷新的用量交给唯一写入口）')
  const gate = srcOf('src/refresh/rooms/host/refresh-gate.ts')
  check(gate.indexOf('.spend(') < 0 && gate.indexOf('accountFor') >= 0,
    '闸自己仍不写账本（没有 .spend），只把用量交给 accountFor 记账口')
}

// ---------- ② 行为：编排器的会话门面 ----------
// 假会话只答三件事：list 空池、counts 三个 0（票池 0 ≤ 总数 0，deck.partial 为假）、依赖边为空。
// 记下每次调用的名字，用来证明取数确实走的会话操作，而不是注册表里的房间实例。
const REF = { backend: 'fake', refId: 'acme/demo', name: 'demo', url: '' }
function makeFakeSession(): any {
  return {
    list: async function (): Promise<any> { return { ok: true, data: [] } },
    counts: async function (): Promise<any> { return { ok: true, data: { open: 0, closed: 0, total: 0 } } },
    getDependencies: async function (): Promise<any> { return { ok: true, data: { blockedBy: [], blocking: [] } } },
  }
}
function makeOpened(backendId: string, calls: string[], cwdSeen: string[], writeSeen: any[]): any {
  const session = makeFakeSession()
  return {
    ok: true,
    backendId: backendId,
    call: async function (fn: any): Promise<any> {
      const wrapped: any = {}
      for (const name of ['list', 'counts', 'getDependencies']) {
        wrapped[name] = async function (...args: any[]): Promise<any> { calls.push(name); return session[name].apply(session, args) }
      }
      return fn(wrapped, {})
    },
  }
}
async function checkComposerSessionFacade(): Promise<void> {
  // 真·会话路径：注册表的 get 一旦被调用就抛错 —— 走会话时它不该被碰。
  const calls: string[] = []
  const cwdSeen: string[] = []
  const writeSeen: any[] = []
  const registryTrap = { get: function (id: string): any { throw new Error('不该向注册表取实例：' + id) } }
  const composer = createSnapshotComposer(registryTrap as any, {
    snapshotTtl: 1,
    depsTtl: 1,
    openSession: async function (cwd: string, o: any): Promise<any> { cwdSeen.push(cwd); writeSeen.push(o && o.write); return makeOpened(REF.backend, calls, cwdSeen, writeSeen) },
  })
  const composed = await composer.composeSnapshot(REF.backend, REF, { cwd: 'D:/tmp/panel-ws' }, { force: true })
  check(composed.ok === true && !!composed.snapshot, '接上会话口时快照照常组出来（ok=' + composed.ok + '）')
  check(calls.indexOf('list') >= 0 && calls.indexOf('counts') >= 0, '取数经会话操作 list / counts（实得 ' + calls.join('、') + '）')
  check(cwdSeen[0] === 'D:/tmp/panel-ws' && writeSeen[0] === false, '开会话用调用方给的 cwd、固定只读（cwd=' + cwdSeen[0] + '，write=' + writeSeen[0] + '）')

  const depsCalls: string[] = []
  const depsComposer = createSnapshotComposer(registryTrap as any, {
    depsTtl: 1,
    openSession: async function (): Promise<any> { return makeOpened(REF.backend, depsCalls, [], []) },
  })
  const depsRes = await depsComposer.getDependencies(REF.backend, REF, 'acme#1', { cwd: 'D:/tmp/panel-ws' })
  check(depsRes.ok === true && depsCalls.indexOf('getDependencies') >= 0, '依赖边也经会话操作取（' + depsCalls.join('、') + '）')

  // 反证一：会话打不开、注册表也取不到实例时，如实报不可达。
  const closed = createSnapshotComposer(registryTrap as any, { openSession: async function (): Promise<any> { return { ok: false, reason: 'no-backend' } } })
  const r1 = await closed.composeSnapshot(REF.backend, REF, {}, { force: true })
  check(r1.ok === false && String(r1.error && r1.error.message).indexOf('not reachable') >= 0,
    '会话打不开且注册表也取不到实例时回不可达（' + String(r1.error && r1.error.message) + '）')
  // 反证二：会话开成了别的后端，不能拿错后端的会话顶账。
  const wrong = createSnapshotComposer(registryTrap as any, { openSession: async function (): Promise<any> { return makeOpened('other', [], [], []) } })
  const r2 = await wrong.composeSnapshot(REF.backend, REF, {}, { force: true })
  check(r2.ok === false && String(r2.error && r2.error.message).indexOf('not reachable') >= 0, '会话的后端对不上且注册表也取不到实例时回不可达（' + String(r2.error && r2.error.message) + '）')
  // 反证三：开会话抛错不能把面板带崩。
  const thrown = createSnapshotComposer(registryTrap as any, { openSession: async function (): Promise<any> { throw new Error('boom') } })
  const r3 = await thrown.composeSnapshot(REF.backend, REF, {}, { force: true })
  check(r3.ok === false && String(r3.error && r3.error.message).indexOf('not reachable') >= 0, '开会话抛错且注册表也取不到实例时回不可达、不抛给面板（' + String(r3.error && r3.error.message) + '）')

  // 回落一：没接会话口的老调用方仍按注册表取实例（门禁单测与老调用点形状不变）。
  let gotIds: string[] = []
  const oldComposer = createSnapshotComposer({ get: function (id: string): any { gotIds.push(id); return makeFakeSession() } } as any, { snapshotTtl: 1 })
  const r4 = await oldComposer.composeSnapshot(REF.backend, REF, {}, { force: true })
  check(r4.ok === true && gotIds.indexOf(REF.backend) >= 0, '没接会话口时仍回落注册表取实例（实得 ' + gotIds.join('、') + '）')
  // 回落二：接了会话口但会话这一层开不起来（宿主装配还没就绪）时，按实例把快照组出来，不整份失败。
  let fallbackIds: string[] = []
  const fallbackComposer = createSnapshotComposer({ get: function (id: string): any { fallbackIds.push(id); return makeFakeSession() } } as any, {
    snapshotTtl: 1,
    openSession: async function (): Promise<any> { return { ok: false, reason: 'no-backend' } },
  })
  const r5 = await fallbackComposer.composeSnapshot(REF.backend, REF, {}, { force: true })
  check(r5.ok === true && fallbackIds.indexOf(REF.backend) >= 0, '会话开不起来时回落注册表实例把快照组出来（实得 ' + fallbackIds.join('、') + '）')
}

// ---------- ③ 行为：面板用量经闸进唯一账本 ----------
const GITHUB_TWO = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }
const MARKDOWN_OFF = { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }
// 模型未知、但后端如实声明「我能报请求条数」：这一类要按请求口径记，不能因为口径名字不认识就丢账。
const UNKNOWN_MODEL = { kind: 'unknown', countsRequests: true, countsPoints: false, independentBuckets: false }
function makeLedger() {
  let clock = 1700000000000
  const ledger: any = createLedger({ now: function (): number { return clock } })
  ledger.ensureBackend('github', GITHUB_TWO)
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  return ledger
}
// 与 src/refresh/rooms/host/refresh-runtime.ts 的接线同形：每个类别一个记账口，闸只报四个量，
// 预算口径在这里补齐（normalizeBudgetDeclaration 与分桶规则住同一份文件，避免两边默认值不一致）。
function makeAccountingGate(ledger: any, budgetModelOf: (id: string) => any, withAccount: boolean): any {
  const ports: Record<string, any> = {}
  const accountFor = function (category: string): any {
    const name = (category === 'user-action' || category === 'ai-tool') ? category : 'plugin'
    if (!ports[name]) ports[name] = createAccountPort({ ledger: ledger, account: name })
    const port = ports[name]
    return function (op: string, backendId: string, requests: number, points: number): any {
      return port({ op: op, backendId: backendId, budget: normalizeBudgetDeclaration(budgetModelOf(backendId)), result: { ok: true, usage: { requests: requests, points: points } } })
    }
  }
  return createGate({ ledger: ledger, now: function (): number { return 1700000000000 }, budgetModelOf: budgetModelOf, accountFor: withAccount ? accountFor : undefined })
}
async function checkGateAccounting(): Promise<void> {
  const ledger = makeLedger()
  const gate = makeAccountingGate(ledger, function (id: string): any { return id === 'github' ? GITHUB_TWO : UNKNOWN_MODEL }, true)
  gate.setWorkspace('ws-panel', { active: true })
  // 人的动作（面板刷新）：REST 桶记请求条数。
  await gate.send({ source: 'panel.refresh', kind: 'detail', bucket: 'rest', workspaceKey: 'ws-panel', backendId: 'github' }, async function (): Promise<any> {
    gate.noteOutbound({ requests: 1 })
    return { requests: 1 }
  })
  check(ledger.hour('user-action', 'github/rest').requests === 1, '面板刷新这一笔记进 user-action 档的 REST 桶（实得 ' + JSON.stringify(ledger.hour('user-action', 'github/rest')) + '）')
  check(ledger.hour('user-action', 'github/graphql').points === 0, 'REST 那一笔没有顺手记进 GraphQL 桶（两桶不互串）')
  // 点开一张票翻页走 GraphQL：请求进 REST 桶、点数进 GraphQL 桶，按这一次的真实用量各记一笔。
  await gate.send({ source: 'panel.detail', kind: 'patch', bucket: 'graphql', workspaceKey: 'ws-panel', backendId: 'github' }, async function (): Promise<any> {
    gate.noteOutbound({ requests: 1, points: 2 })
    return { requests: 1, points: 2 }
  })
  check(ledger.hour('user-action', 'github/graphql').points === 2, 'GraphQL 那一笔按点数记进 graphql 桶（实得 ' + ledger.hour('user-action', 'github/graphql').points + ' 点）')
  check(ledger.hour('user-action', 'github/rest').requests === 2, '同一笔里的请求条数记进 rest 桶（实得 ' + ledger.hour('user-action', 'github/rest').requests + ' 条）')
  // 后台档（探测）记 plugin，不混进人的动作。
  await gate.send({ source: 'probe.tick', kind: 'probe', bucket: 'rest', workspaceKey: 'ws-panel', backendId: 'github' }, async function (): Promise<any> {
    gate.noteOutbound({ requests: 1 })
    return { requests: 1 }
  })
  check(ledger.hour('plugin', 'github/rest').requests === 1, '后台探测记 plugin 档（实得 ' + JSON.stringify(ledger.hour('plugin', 'github/rest')) + '）')
  check(ledger.hour('user-action', 'github/rest').requests === 2, '后台那笔没有混进 user-action 档（仍是 2 条）')
  // 失败那一步也记：请求发出去就是已经花掉的额度（I6）。
  let rejected = false
  try {
    await gate.send({ source: 'panel.refresh', kind: 'detail', bucket: 'rest', workspaceKey: 'ws-fail', backendId: 'github' }, async function (): Promise<any> {
      gate.noteOutbound({ requests: 1 })
      throw new Error('network down')
    })
  } catch (e) { rejected = true }
  check(rejected && ledger.hour('user-action', 'github/rest').requests === 3, '失败那一步也把真发出去的条数记进账本（实得 ' + ledger.hour('user-action', 'github/rest').requests + ' 条）')
  // 离网后端：不建桶、一笔不记，也不抛错。
  const offLedger = makeLedger()
  const offGate = makeAccountingGate(offLedger, function (): any { return MARKDOWN_OFF }, true)
  offGate.setWorkspace('ws-md', { active: true })
  const offRes = await offGate.send({ source: 'panel.refresh', kind: 'detail', bucket: 'rest', workspaceKey: 'ws-md', backendId: 'markdown' }, async function (): Promise<any> {
    offGate.noteOutbound({ requests: 1 })
    return { requests: 1 }
  })
  check(offRes.sent === true, '离网后端照常放行（不需要额度）')
  check(offLedger.bucketsOf('markdown').length === 0, '离网后端一笔不记、也不建桶（实得桶：' + JSON.stringify(offLedger.bucketsOf('markdown')) + '）')
  // 模型未知：仍按请求口径记进 requests 桶（不猜成两桶，也不丢账）。
  const unknownLedger = makeLedger()
  const unknownGate = makeAccountingGate(unknownLedger, function (): any { return UNKNOWN_MODEL }, true)
  unknownGate.setWorkspace('ws-new', { active: true })
  await unknownGate.send({ source: 'panel.refresh', kind: 'detail', bucket: 'rest', workspaceKey: 'ws-new', backendId: 'mystery' }, async function (): Promise<any> {
    unknownGate.noteOutbound({ requests: 1 })
    return { requests: 1 }
  })
  check(unknownLedger.bucketsOf('mystery').indexOf('requests') >= 0, '模型未知时按请求口径建 requests 桶（实得 ' + JSON.stringify(unknownLedger.bucketsOf('mystery')) + '）')
  check(unknownLedger.hour('user-action', 'mystery/requests').requests === 1, '模型未知时用量仍记进 requests 桶、不丢账（实得 ' + unknownLedger.hour('user-action', 'mystery/requests').requests + ' 条）')
  // 口径名字这一层就不认识（第三方声明了本版没有的 kind）：闸按未知口径收，请求数照记。
  const oddLedger = makeLedger()
  const oddGate = makeAccountingGate(oddLedger, function (): any { return { kind: 'something-new', countsRequests: true, countsPoints: true, independentBuckets: true } }, true)
  oddGate.setWorkspace('ws-odd', { active: true })
  await oddGate.send({ source: 'panel.refresh', kind: 'detail', bucket: 'rest', workspaceKey: 'ws-odd', backendId: 'odd' }, async function (): Promise<any> {
    oddGate.noteOutbound({ requests: 1, points: 3 })
    return { requests: 1, points: 3 }
  })
  check(oddLedger.bucketsOf('odd').indexOf('requests') >= 0 && oddLedger.hour('user-action', 'odd/requests').requests === 1,
    '不认识的口径按未知口径记请求数，不丢账、也不凭空建两桶（实得桶 ' + JSON.stringify(oddLedger.bucketsOf('odd')) + '，请求 ' + oddLedger.hour('user-action', 'odd/requests').requests + ' 条）')
  // 不接记账口：行为与 #1454 之后一致——账本一分不动（钉住「不接就不记」，防止悄悄恢复闸里写账）。
  const plainLedger = makeLedger()
  const plainGate = makeAccountingGate(plainLedger, function (): any { return GITHUB_TWO }, false)
  plainGate.setWorkspace('ws-plain', { active: true })
  const before = { requests: plainLedger.snapshot().total.requests, points: plainLedger.snapshot().total.points }
  await plainGate.send({ source: 'panel.refresh', kind: 'detail', bucket: 'rest', workspaceKey: 'ws-plain', backendId: 'github' }, async function (): Promise<any> {
    plainGate.noteOutbound({ requests: 1 })
    return { requests: 1 }
  })
  const after = plainLedger.snapshot().total
  check(after.requests === before.requests && after.points === before.points,
    '没接记账口时闸不写账本（总量 ' + JSON.stringify(before) + ' → ' + JSON.stringify(after) + '）')
  check(plainGate.stats().accounted.requests === 1, '闸自己仍把真发条数记进 stats.accounted 对账（实得 ' + plainGate.stats().accounted.requests + '）')
}

async function main(): Promise<void> {
  await checkComposerSessionFacade()
  await checkGateAccounting()
  console.log(failed ? ('\n' + total + ' 条断言，失败') : ('\n' + total + ' 条断言，全部通过'))
  process.exit(failed ? 1 : 0)
}
main().catch(function (e: any) { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) })
