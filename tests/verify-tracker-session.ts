/**
 * tests/verify-tracker-session.ts —— 会话装配与预算管线门禁（规格 1439，票 1441）。
 *
 * 为什么要这一条：会话是上层唯一能拿到的后端入口，预算三态分流（未知放行、离网放行、
 * 已知耗尽推迟）一旦写错，要么把还有额度的请求拦在门外，要么把已经耗尽的请求放出去花
 * 真额度。这一条用假后端与可控读数把六条验收逐条钉住，真实现以后改坏任何一条都会红。
 *
 * 六条验收（票 1441）：
 *   一、名录只新增读预算：操作 23 条（末尾是读预算）、能力 26 条，其余名字一个不动。
 *   二、预算必填：三间房的声明各在其位，缺预算的模块在注册时就被拒绝，理由点名缺哪格。
 *   三、会话形状：公开入口只交会话，会上带后端编号、预算模型、写权限与 26 条能力。
 *   四、管线分流：分发原样透传；离网放行且记零账；未知读数不被当成耗尽；已知耗尽推迟
 *       且房间与记账都不被碰；写权限这道硬顶在读数充足时照样拦。
 *   五、读预算特权：它只读缓存不花额度，所以不走裁决也不记账，直达房间。
 *   六、选后端只看本地：无后端、多命中、未决、工作区没就绪各回各的可区分结果，全程不抛异常。
 *
 * 票 1457 补的两条端到端断言（规格 #1439 核对时发现原来只断了弱形状）：
 *   · 缺预算声明的模块经 createRegistry().register 注册时真的当场抛错，理由点名预算；
 *   · 离网后端经会话调用后，真账本上这一笔的金额是 0，而且一条条目都没有——断的是钱，不是记账口被叫了几次。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-tracker-session.ts
 */
import { OPERATIONS, CAPABILITIES } from '../src/tracker/contract/operations-catalog.ts'
import type { BackendBudgetModel } from '../src/tracker/session/budget.ts'
import type { BudgetReading } from '../src/tracker/session/budget-reading.ts'
import type { AdmitInput } from '../src/tracker/session/interceptors.ts'
import { openTracker } from '../src/tracker/session/open-tracker.ts'
import type { OpenTrackerOptions } from '../src/tracker/session/open-tracker.ts'
import { createRegistry } from '../src/tracker/registry/core.ts'
import { validateMod } from '../src/tracker/registry/shape.ts'
import { createLedger } from '../src/refresh/rooms/host/quota-ledger.ts'
import { createAccountPort } from '../src/refresh/kernel/backend-accounting.ts'
import type { BackendModule } from '../src/tracker/contract/backend-module.ts'
import type { OpContext, RepoHandle } from '../src/tracker/contract/contexts.ts'
import type { Selection } from '../src/tracker/contract/results.ts'

let failed = false
let passed = 0
const check = (ok: boolean, msg: string): void => {
  if (ok) { passed += 1; console.log('  PASS ' + msg) } else { failed = true; console.log('  FAIL ' + msg) }
}

// —— 可控读数：假后端的读预算每次都回这一格当前的值，测哪一态就先把它拨到哪一态 ——
let currentReading: BudgetReading = { known: false, reason: 'not-measured' }
const fullBuckets: BudgetReading = {
  known: true, kind: 'two-buckets',
  buckets: { rest: { remaining: 100, limit: 100 }, graphql: { remaining: 100, limit: 100 } },
}
const exhaustedBuckets: BudgetReading = {
  known: true, kind: 'two-buckets',
  buckets: { rest: { remaining: 0, limit: 100 }, graphql: { remaining: 50, limit: 100 } },
}
const offNetworkReading: BudgetReading = { known: true, kind: 'off-network' }
const unknownReading: BudgetReading = { known: false, reason: 'not-measured' }

// —— 假后端丁：只实现测管线要的那三条，其余缺席（缺席的由注册表补桩，不影响本门禁） ——
const roomCalls: string[] = []
const fakeBudget: BackendBudgetModel = {
  kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true,
}
const fakeModule = {
  id: 'fake-d',
  label: 'Fake D',
  budget: fakeBudget,
  create: () => ({
    list: async () => { roomCalls.push('list'); return { ok: true, data: { tag: 'room-list' } } },
    close: async () => { roomCalls.push('close'); return { ok: true, data: { tag: 'room-close' } } },
    readBudget: async () => { roomCalls.push('readBudget'); return { ok: true, data: currentReading } },
  }),
  matches: () => true,
} satisfies BackendModule

// —— 假后端离网：声明里就没有额度这回事；房间却在回包里自报了用量（4 条 / 3 点）。
// 自报用量是故意的：离网这一笔账面必须是 0，但「0」不能是因为房间里根本没花，得是记账口径认了离网才记 0。
const offBudget: BackendBudgetModel = {
  kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false,
}
const offModule = {
  id: 'fake-off',
  label: 'Fake Off',
  budget: offBudget,
  create: () => ({
    list: async () => { roomCalls.push('off-list'); return { ok: true, data: { tag: 'off-list' }, usage: { requests: 4, points: 3 } } },
    close: async () => { roomCalls.push('off-close'); return { ok: true, data: { tag: 'off-close' } } },
    readBudget: async () => { roomCalls.push('off-readBudget'); return { ok: true, data: offNetworkReading } },
  }),
  matches: () => true,
} satisfies BackendModule

// —— 参考裁决：把规格定的三态分流逐字实现，未知与离网放行、已知耗尽推迟、硬顶始终生效 ——
const WRITE_OPS = ['create', 'close', 'reopen', 'comment', 'update', 'setLabels', 'setAssignees',
  'setParent', 'setBlockedBy', 'setLabelColors', 'ensureLabelColorsFile', 'initProject']
const admitCalls: AdmitInput[] = []
const referenceAdmit = (input: AdmitInput) => {
  admitCalls.push(input)
  // 硬顶先行：写权限这道闸不看读数，读数再充足也照样拦。
  if (!input.canWrite && WRITE_OPS.indexOf(input.op) >= 0) {
    return { allowed: false as const, kind: 'rate-limit' as const, reason: 'hard-cap:no-write', message: '写权限未就绪，写操作一律推迟' }
  }
  const reading = input.reading
  // 未知不等于耗尽：没量出来就按「没证据说耗尽」放行。
  if (reading.known === false) return { allowed: true as const, reason: 'unknown-reading' }
  // 离网本来就不花额度：放行，记账那一侧记零。
  if (reading.kind === 'off-network') return { allowed: true as const, reason: 'off-network' }
  const levels = reading.kind === 'two-buckets'
    ? [reading.buckets.rest, reading.buckets.graphql]
    : [reading.requests]
  if (levels.some((l) => l.remaining <= 0)) {
    return { allowed: false as const, kind: 'rate-limit' as const, reason: 'exhausted', message: '预算已耗尽，本次调用推迟' }
  }
  return { allowed: true as const, reason: 'sufficient' }
}
const accountCalls: { op: string; result: unknown }[] = []
const referenceAccount = async (input: { op: string; result: unknown }) => {
  accountCalls.push({ op: input.op, result: input.result })
}

const HANDLE: RepoHandle = { cwd: 'D:/fake-workspace' }
function openWith(over: Partial<OpenTrackerOptions> & { canWrite?: boolean },
  mod: BackendModule = fakeModule): ReturnType<typeof openTracker> {
  const registry = createRegistry()
  registry.register(mod)
  return openTracker(HANDLE, {
    registry,
    getCachedReading: () => currentReading,
    admit: referenceAdmit,
    account: referenceAccount,
    canWrite: true,
    ...over,
  })
}

async function main(): Promise<void> {
  console.log('== 一、名录只新增读预算 ==')
  const known22 = ['preflight', 'list', 'get', 'getDependencies', 'create', 'close', 'reopen',
    'comment', 'update', 'setLabels', 'setAssignees', 'setParent', 'setBlockedBy', 'getCurrentUser',
    'initProject', 'listLabels', 'setLabelColors', 'counts', 'listPage', 'getRepoPermissions',
    'listSubIssues', 'ensureLabelColorsFile']
  check(OPERATIONS.length === 23, '操作 23 条 → 实得 ' + OPERATIONS.length + ' 条')
  check(OPERATIONS[OPERATIONS.length - 1] === 'readBudget', '新增的在末尾（读预算）→ 实得 ' + OPERATIONS[OPERATIONS.length - 1])
  check(OPERATIONS.filter((op) => op !== 'readBudget').every((op) => known22.indexOf(op) >= 0),
    '除读预算外没有第二张新面孔（已有名字一个没动）')
  check(CAPABILITIES.length === 26, '能力 26 条 → 实得 ' + CAPABILITIES.length + ' 条')

  console.log('== 二、预算必填：三间房声明 + 缺预算当场拒绝 ==')
  const github = await import('../src/tracker/rooms/github/index.ts')
  const markdown = await import('../src/tracker/rooms/markdown/index.ts')
  const gitlab = await import('../src/tracker/rooms/gitlab/index.ts')
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
  check(same(github.githubModule.budget,
    { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }),
    'GitHub 声明双桶（两种限额各自独立、都计数）')
  check(same(gitlab.gitlabBackend.budget,
    { kind: 'requests-only', countsRequests: true, countsPoints: false, independentBuckets: false }),
    'GitLab 声明只计请求（没有点数那一桶）')
  check(same(markdown.markdownModule.budget,
    { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }),
    '本地 Markdown 声明离网（本来就不花额度）')
  // 缺预算的模块在注册时就被拒绝：理由必须点名缺的是预算这一格，而不是一句含糊的形状不对。
  let missingReason = ''
  try { validateMod({ id: 'neg', label: 'neg', create: () => ({}), matches: () => false }) } catch (e) {
    missingReason = String((e as Error).message || '')
  }
  check(missingReason.indexOf('budget') >= 0, '缺预算的模块被拒绝且理由点名预算 → ' + JSON.stringify(missingReason))
  let badKindReason = ''
  try {
    validateMod({ id: 'neg', label: 'neg', create: () => ({}), matches: () => false, budget: { kind: 'points-only', countsRequests: true, countsPoints: true, independentBuckets: false } })
  } catch (e) { badKindReason = String((e as Error).message || '') }
  check(badKindReason.indexOf('kind') >= 0, '预算种类写错被拒绝且理由点名种类 → ' + JSON.stringify(badKindReason))
  let badFlagReason = ''
  try {
    validateMod({ id: 'neg', label: 'neg', create: () => ({}), matches: () => false, budget: { kind: 'two-buckets', countsRequests: 'yes' as unknown as boolean, countsPoints: true, independentBuckets: true } })
  } catch (e) { badFlagReason = String((e as Error).message || '') }
  check(badFlagReason.indexOf('countsRequests') >= 0, '预算开关写错被拒绝且理由点名那一格 → ' + JSON.stringify(badFlagReason))
  // 端到端：不是只调校验函数，而是走注册表真正注册一次——拒绝必须发生在进注册表之前，
  // 理由带 budget 这两个字，方便装配方一眼看出缺的是口径声明而不是 id / create 之类。
  const registryNeg = createRegistry()
  let registerReason = ''
  try {
    registryNeg.register({ id: 'neg', label: 'neg', create: () => ({}), matches: () => false } as never)
  } catch (e) { registerReason = String((e as Error).message || '') }
  check(registerReason.indexOf('budget') >= 0,
    '缺预算的模块经注册表注册时当场抛错且理由点名预算 → ' + JSON.stringify(registerReason))
  check(registryNeg.modules().length === 0, '注册失败的模块没有留在注册表里（不留半截）')

  console.log('== 三、会话形状：编号预算写权限与 26 条能力 ==')
  currentReading = fullBuckets
  const opened = await openWith({})
  check(opened.ok === true, '公开入口交出会话（ok:true）')
  if (opened.ok) {
    check(opened.session.backendId === 'fake-d', '会话带后端编号 → ' + opened.session.backendId)
    check(same(opened.session.budget, fakeBudget), '会话带预算模型（与注册的那一份是同一份）')
    check(opened.session.canWrite === true, '会话带写权限')
    check(CAPABILITIES.every((name) => typeof (opened.session as unknown as Record<string, unknown>)[name] === 'function'),
      '26 条能力在会话上都叫得到（少一条都不行）')
    check(opened.session.id === 'fake-d', '会话编号与后端编号一致（注册表那条不许说谎的规矩同样适用）')
  }

  console.log('== 四、管线分流：分发、离网、未知、耗尽、硬顶 ==')
  // 分发：房间回什么，会话就原样交什么，不加料不改形。
  roomCalls.length = 0; accountCalls.length = 0; admitCalls.length = 0
  currentReading = fullBuckets
  const s1 = await openWith({})
  if (!s1.ok) { check(false, '分发用例的会话没打开'); return }
  const listed = await s1.session.list({} as never, {} as OpContext)
  check((listed as { ok: boolean; data?: { tag?: string } }).ok === true &&
    (listed as { ok: boolean; data?: { tag?: string } }).data?.tag === 'room-list',
    '分发原样透传（房间的结果原样回到调用方）')
  check(accountCalls.length === 1 && accountCalls[0].op === 'list', '成功调用记一笔账（记的是这一条操作）')
  // 离网后端：放行；房间自报的用量（4 条 / 3 点）也不许进账本。这里把真账本与真记账口接进会话，
  // 断的是「账本上这一笔的金额是 0」，而不是「记账口被叫了一次」。
  roomCalls.length = 0; accountCalls.length = 0; admitCalls.length = 0
  currentReading = offNetworkReading
  const offLedger = createLedger({ now: () => 1700000000000 })
  // 账本里先给这个后端留着两个桶（换口径前的遗留）：记账口若没有在「离网」这一支提前返回，
  // 这笔 4 条 / 3 点就会落进桶里，下面的 0 立刻变红。没有桶时记账会当场抛、被管线收成诊断，
  // 账面仍然看着是 0，断不出这个错。
  offLedger.ensureBackend('fake-off', { kind: 'two-buckets' })
  const offAccount = createAccountPort({ ledger: offLedger, account: 'ai-tool' })
  const sOff = await openWith({
    account: async (input) => { accountCalls.push({ op: input.op, result: input.result }); await offAccount(input) },
  }, offModule)
  if (!sOff.ok) { check(false, '离网后端的会话没打开'); return }
  const listedOff = await sOff.session.list({} as never, {} as OpContext)
  check((listedOff as { ok: boolean }).ok === true, '离网放行（不花额度的后端不拦读操作）')
  check(accountCalls.length === 1, '离网调用也记一笔（账本不断档，只是零花费）')
  const offUsage = (listedOff as { usage?: { requests?: number; points?: number } }).usage
  check(!!offUsage && offUsage.requests === 4 && offUsage.points === 3,
    '离网房间确实自报了用量（账面为 0 不是因为没用量）→ ' + JSON.stringify(offUsage))
  const offSpent = offLedger.hourOf('ai-tool', 'fake-off')
  check(offSpent.requests === 0 && offSpent.points === 0,
    '离网后端调用后账本金额为 0（实得 ' + JSON.stringify(offSpent) + '）')
  const offSnap = offLedger.snapshot()
  const offRows = Object.keys(offSnap.byAccount['ai-tool'])
    .filter((k) => k.indexOf('fake-off') >= 0)
    .map((k) => offSnap.byAccount['ai-tool'][k] as { requests: number; points: number })
  check(offRows.length > 0 && offRows.every((row) => row.requests === 0 && row.points === 0),
    '离网后端在账本里每个已有的桶都记 0（实得 ' + JSON.stringify(offRows) + '）')
  check(offSnap.total.requests === 0 && offSnap.total.points === 0,
    '账本总量没有被这笔离网调用推动（实得 ' + JSON.stringify(offSnap.total) + '）')
  // 未知：没量出来不等于耗尽，照样放行。
  roomCalls.length = 0; accountCalls.length = 0
  currentReading = unknownReading
  const listedUnknown = await s1.session.list({} as never, {} as OpContext)
  check((listedUnknown as { ok: boolean }).ok === true, '未知读数放行（没证据说耗尽，就不许当耗尽拦）')
  // 已知耗尽：推迟，房间一次都不被碰，账上也不多一笔。
  roomCalls.length = 0; accountCalls.length = 0
  currentReading = exhaustedBuckets
  const listedOut = await s1.session.list({} as never, {} as OpContext)
  const outErr = (listedOut as { ok: boolean; error?: { kind?: string } }).error
  check((listedOut as { ok: boolean }).ok === false && outErr?.kind === 'rate-limit',
    '已知耗尽推迟（限流档，可区分）→ ' + JSON.stringify(outErr))
  check(roomCalls.length === 0, '推迟的调用碰不到房间（额度已经空了，不许再花）')
  check(accountCalls.length === 0, '没发生的调用不记账（账上不许有多出来的一笔）')
  // 硬顶：读数再充足，写权限没就绪时写操作照样被拦。
  roomCalls.length = 0
  currentReading = fullBuckets
  const sNoWrite = await openWith({ canWrite: false })
  if (!sNoWrite.ok) { check(false, '硬顶用例的会话没打开'); return }
  const closed = await sNoWrite.session.close({} as never, {} as never, undefined, {} as OpContext)
  const closedErr = (closed as { ok: boolean; error?: { reason?: string } }).error
  check((closed as { ok: boolean }).ok === false, '硬顶始终生效（读数充足也拦写操作）')

  console.log('== 五、读预算直达：不裁决不记账 ==')
  roomCalls.length = 0; accountCalls.length = 0; admitCalls.length = 0
  currentReading = fullBuckets
  const readBack = await s1.session.readBudget({} as OpContext)
  check((readBack as { ok: boolean }).ok === true, '读预算本身永远放行（读数就是用来看的，不能自己先被拦）')
  check(admitCalls.length === 0, '读预算不走裁决（自己量自己，不设下一道闸）')
  check(accountCalls.length === 0, '读预算不记账（看额度这件事本身不花额度）')

  console.log('== 六、选后端只看本地：四种结局可区分且不抛 ==')
  const fakeSelection = (sel: Selection): OpenTrackerOptions['resolveSelection'] => async () => sel
  const rNoBackend = await openWith({ resolveSelection: fakeSelection({ backendId: null, source: 'fallback' }) })
  check(rNoBackend.ok === false && !rNoBackend.ok && rNoBackend.reason === 'no-backend', '无后端可区分（no-backend）')
  const rMulti = await openWith({ resolveSelection: fakeSelection({ backendId: 'fake-d', source: 'matches', multiHit: ['fake-d', 'fake-e'] }) })
  check(rMulti.ok === false && !rMulti.ok && rMulti.reason === 'multi-match', '多命中可区分（multi-match，不擅自替人选）')
  const rPending = await openWith({ resolveSelection: fakeSelection({ backendId: null, source: 'fallback', pending: true }) })
  check(rPending.ok === false && !rPending.ok && rPending.reason === 'pending', '未决可区分（pending，不报成无后端）')
  const registry6 = createRegistry()
  registry6.register(fakeModule)
  const rNotReady = await openTracker({} as RepoHandle, {
    registry: registry6, getCachedReading: () => currentReading, admit: referenceAdmit, account: referenceAccount,
  })
  check(rNotReady.ok === false && !rNotReady.ok && rNotReady.reason === 'workspace-not-ready', '工作区没就绪可区分（workspace-not-ready，不出站）')
  const rThrow = await openWith({ resolveSelection: async () => { throw new Error('boom') } })
  check(rThrow.ok === false && !rThrow.ok && rThrow.reason === 'pending', '判定出口炸了也不抛（收成未决，理由写清）')
  // 默认走注册表：只问本地认领就把假后端选出来，不出站。
  const registry7 = createRegistry()
  registry7.register(fakeModule)
  const rDefault = await openTracker(HANDLE, {
    registry: registry7, getCachedReading: () => currentReading, admit: referenceAdmit, account: referenceAccount,
  })
  check(rDefault.ok === true && rDefault.ok && rDefault.session.backendId === 'fake-d', '默认选后端走注册表本地认领（假后端被认出来）')

  console.log(failed ? `\n存在失败 — verify-tracker-session 未通过（通过 ${passed} 条）` : `\n全部通过 — verify-tracker-session 通过（${passed} 条）`)
}

main().then(
  () => process.exit(failed ? 1 : 0),
  (e) => { console.error('门禁执行异常：' + ((e as Error)?.stack || String(e))); process.exit(1) },
)
