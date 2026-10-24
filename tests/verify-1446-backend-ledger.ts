// verify-1446-backend-ledger.ts —— 门禁：账本按「后端 + 桶」分键（#1446）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1446-backend-ledger.ts，可独立运行。
//
// 这条门禁只验账本本体（src/refresh/rooms/host/quota-ledger.ts），不经过闸、不经过刷新运行时：
// 换轨之后账本的每一条口径都在这里单独钉一遍，闸与装配那边改坏了也不会把这里带红。
//
// 钉住的是这些行为（按正文的八节顺序；票面验收逐条对应）：
//   ① 键是「后端/桶」：同一轮里 GitHub 的 rest 与 GitLab 的 requests 各记各的，互不污染；
//      空账如实说「还没量」——没读数时 remaining/tier 是 null，不拿 0 冒充；
//   ② ensureBackend：按口径建桶（双桶两个、只计请求一个、离网不建），同一口径再调是幂等的；
//      口径变了清旧桶重建，旧读数不许留在新账里；模型自报的后端与形参不一致时当场抛；
//   ③ 读数不许跨后端落账（把 GitHub 的两桶读数交给 GitLab 必须抛）；
//   ④ 额度换算：双桶按 35% 规则打折、写保底按份额算；requests 桶直接用读数 limit、不打折、写保底恒 0；
//   ⑤ spend 按口径划范围：双桶的请求记 rest、点数记 graphql；只计请求只认条数；离网没有桶、当场抛；
//      未知只有一个 requests 桶（能记条数，读数视图仍是「还没量」），按额度形状分的桶没有、当场抛；
//      quota-read 只进 free，不扣 used（读剩余额度服务端不收费）；
//   ⑥ 限流信号：撞上限流降红档，Retry-After 秒数过去自己回来；缺秒数或记到不存在的桶当场抛；
//   ⑦ rollHour：清本小时用量与 free，但不动读数与「同步之后已花」；
//   ⑧ 总览与 hour 的键：总览按档位分账、每一档按桶键给计数；hour 认桶键，也认后端名（不分桶）。
//
// 本门禁不硬编码额度数字：35% 与写保底都从 host-budget.js 取，账本里写死一个数时这里立刻能看出来。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT: string = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const show = (v: any): string => JSON.stringify(v)

/** 断言「抛错」，并把错因写进说明里，方便红了直接看到是哪种装配错。 */
function throws(fn: () => void): string {
  try { fn() } catch (e: any) { return String((e && e.message) || e) }
  return ''
}

async function main() {
  console.log('账本按后端分键门禁（#1446：键 = 后端/桶，口径决定建哪些桶）')
  const budget = await import(pathToFileURL(path.join(ROOT, 'src', 'refresh', 'kernel', 'host-budget.js')).href)
  const ledgerMod = await import(pathToFileURL(path.join(ROOT, 'src', 'refresh', 'rooms', 'host', 'quota-ledger.ts')).href)

  let clock = 1700000000000
  const newLedger = () => ledgerMod.createLedger({ now: () => clock })
  // 口径声明自 #1439 起住在各后端模块（旧静态表已随 #1448 退役）；这里直接写三份声明，形状与契约一致。
  // backendId 是「模型自报的后端」：装配方拿错口径时账本要靠它当场抛（② 段那条反例要用）。
  const gh = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true, backendId: 'github' }
  const gl = { kind: 'requests-only', countsRequests: true, countsPoints: false, independentBuckets: false, backendId: 'gitlab' }
  const md = { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false, backendId: 'markdown' }
  const unknown = { kind: 'unknown', countsRequests: true, countsPoints: false, independentBuckets: false }

  // ---------- ① 键与空账 ----------
  const l1 = newLedger()
  check(ledgerMod.bucketKey('GitHub', 'rest') === 'github/rest', '桶键是「后端/桶」，后端标识不分大小写（' + ledgerMod.bucketKey('GitHub', 'rest') + '）')
  check(ledgerMod.bucketKey(' github ', 'graphql') === 'github/graphql', '桶键归一首尾空白（' + ledgerMod.bucketKey(' github ', 'graphql') + '）')
  const empty = l1.view('github', 'rest')
  check(empty.allowance === 0 && empty.used === 0 && empty.reserve === 0, '还没有这个桶时回全零的额度、用量与写保底（' + show(empty) + '）')
  check(empty.remaining === null, '没读数时 remaining 是 null，不是 0（0 会被当成「真的一滴都没有」，实得 ' + show(empty.remaining) + '）')
  check(empty.tier === null && empty.rateLimited === false, '没读数时不给档位、不编一个限流信号（tier=' + show(empty.tier) + '，rateLimited=' + show(empty.rateLimited) + '）')
  check(empty.synced === false && empty.syncedAt === 0, '没读数时 synced 为假、syncedAt 为 0（' + empty.synced + ' / ' + empty.syncedAt + '）')
  check(Object.keys(l1.snapshot().buckets).length === 0, 'createLedger 不再预建固定两桶：空账的总览里一个桶键都没有（实得 ' + Object.keys(l1.snapshot().buckets).length + '）')
  check(ledgerMod.LEDGER_BUCKETS === undefined, '旧的模块级 LEDGER_BUCKETS 已删除（账本不再假装所有后端都长两个桶）')

  // ---------- ② ensureBackend：建桶、幂等、口径变更 ----------
  const l2 = newLedger()
  const ghEnsured = l2.ensureBackend('github', gh)
  check(ghEnsured.buckets.length === 2 && ghEnsured.created.join(',') === 'rest,graphql' && ghEnsured.rebuilt === false,
    '双桶后端建 rest + graphql 两个桶（实得 ' + ghEnsured.created.join(',') + '）')
  check(l2.bucketsOf('github').join(',') === 'rest,graphql', 'bucketsOf 如实报出这个后端的桶（' + l2.bucketsOf('github').join(',') + '）')
  check(Object.keys(l2.snapshot().buckets).join(',') === 'github/rest,github/graphql', '总览的键换成桶键（后端/桶名）（' + Object.keys(l2.snapshot().buckets).join(',') + '）')
  l2.syncServer('github', { rest: { limit: 5000, remaining: 1000, reset: clock + budget.HOUR_MS } }, clock)
  const again = l2.ensureBackend('github', gh)
  check(again.created.length === 0 && again.rebuilt === false && again.kind === 'two-buckets', '同一个后端同一口径再调一次是幂等的（created=' + again.created.length + '，rebuilt=' + again.rebuilt + '）')
  check(l2.view('github', 'rest').synced === true && l2.view('github', 'rest').allowance === budget.hourlyAllowance(1000),
    '幂等调用不会把已经落下的读数冲掉（allowance=' + l2.view('github', 'rest').allowance + '）')
  const glEnsured = l2.ensureBackend('gitlab', gl)
  check(glEnsured.created.join(',') === 'requests', '只计请求的后端只建 requests 一桶（实得 ' + glEnsured.created.join(',') + '）')
  check(l2.ensureBackend('markdown', md).created.length === 0 && l2.bucketsOf('markdown').length === 0, '离网后端不建桶（没有额度这回事，不摆一本空账）')
  const unkEnsured = l2.ensureBackend('bitbucket', unknown)
  check(unkEnsured.created.join(',') === 'requests' && l2.bucketsOf('bitbucket').join(',') === 'requests',
    '未知后端只建 requests 一桶，专门记请求数（实得 ' + unkEnsured.created.join(',') + '）')
  check(l2.view('bitbucket', 'requests').remaining === null && l2.view('bitbucket', 'requests').tier === null && l2.view('bitbucket', 'requests').synced === false,
    '未知后端的 requests 桶不接读数：剩余量与档位恒空，不拿 0 冒充（实得 ' + JSON.stringify({ remaining: l2.view('bitbucket', 'requests').remaining, tier: l2.view('bitbucket', 'requests').tier }) + '）')
  // 口径变更：先按双桶建、落读数，再改成只计请求 —— 旧桶连同旧读数必须清掉。
  // 这里用只带 kind 的模型：switchy 不是内置后端，拿 GitHub 那份（backendId 写着 github）来建会被上面的核对挡住。
  l2.ensureBackend('switchy', { kind: 'two-buckets' })
  l2.syncServer('switchy', { rest: { limit: 4000, remaining: 4000 }, graphql: { limit: 4000, remaining: 4000 } }, clock)
  const changed = l2.ensureBackend('switchy', { kind: 'requests-only' })
  check(changed.rebuilt === true && changed.created.join(',') === 'requests' && changed.buckets.join(',') === 'requests',
    '口径从双桶改成只计请求时清旧桶、按新口径重建（rebuilt=' + changed.rebuilt + '，created=' + changed.created.join(',') + '）')
  check(l2.view('switchy', 'rest').synced === false && l2.view('switchy', 'graphql').synced === false, '旧口径的读数没有留在新账里（两个旧桶都读不到读数）')
  check(Object.keys(l2.snapshot().buckets).indexOf('switchy/rest') < 0, '旧桶键从总览里消失（总览：' + Object.keys(l2.snapshot().buckets).join(',') + '）')
  // 装配错当场抛：没后端标识、口径不认识、模型自报的后端与形参对不上。
  const eNoId = throws(() => l2.ensureBackend('', gh))
  check(eNoId.indexOf('后端标识') >= 0, '没有后端标识时建桶当场抛（' + eNoId + '）')
  const eKind = throws(() => l2.ensureBackend('weird', { kind: 'not-a-kind' }))
  check(eKind.indexOf('kind') >= 0, '口径不认识时当场抛，不静默当成未知后端（' + eKind + '）')
  const eMismatch = throws(() => l2.ensureBackend('gitlab', gh))
  check(eMismatch.indexOf('github') >= 0 && eMismatch.indexOf('gitlab') >= 0, '模型自报的后端与形参不一致时当场抛（' + eMismatch + '）')

  // ---------- ③ 读数不许跨后端落账 ----------
  const l3 = newLedger()
  l3.ensureBackend('github', gh)
  l3.ensureBackend('gitlab', gl)
  const cross1 = throws(() => l3.syncServer('gitlab', { rest: { limit: 5000, remaining: 5000 } }, clock))
  check(cross1.indexOf('不属于') >= 0, 'GitHub 的 rest 读数交给 GitLab 时抛错（' + cross1 + '）')
  const cross2 = throws(() => l3.syncServer('github', { requests: { limit: 600, remaining: 600 } }, clock))
  check(cross2.indexOf('不属于') >= 0, 'GitLab 的 requests 读数交给 GitHub 时同样抛错（' + cross2 + '）')
  const cross3 = throws(() => l3.syncServer('markdown', { rest: { limit: 1, remaining: 1 } }, clock))
  check(cross3.indexOf('ensureBackend') >= 0, '还没建桶的后端收到读数时抛错，并指路 ensureBackend（' + cross3 + '）')
  const cross4 = throws(() => l3.syncServer('github', { points: { limit: 1, remaining: 1 } }, clock))
  check(cross4.indexOf('不认识') >= 0, '不认识的桶名直接抛，不静默跳过（' + cross4 + '）')
  const partial = l3.syncServer('github', { rest: { limit: 5000, remaining: 1000 } }, clock)
  check(partial.applied.join(',') === 'rest', '只给一个桶的读数时只落那一个桶（applied=' + partial.applied.join(',') + '）')
  check(l3.view('github', 'graphql').synced === false && l3.view('gitlab', 'requests').synced === false, '没给读数的桶仍是「还没量」（不拿别人的读数顶上）')

  // ---------- ④ 额度换算：两桶 35% 规则，requests 桶不打折 ----------
  const l4 = newLedger()
  l4.ensureBackend('github', gh)
  l4.ensureBackend('gitlab', gl)
  l4.syncServer('github', { rest: { limit: 5000, remaining: 1000 }, graphql: { limit: 5000, remaining: 1000 } }, clock)
  const restView = l4.view('github', 'rest')
  check(restView.allowance === budget.hourlyAllowance(1000) && restView.allowance < 1000,
    '两桶的额度沿用 35% 规则换算（reads ' + restView.allowance + ' ＜ 读数 1000，且 == hourlyAllowance(1000)）')
  check(restView.remaining === restView.allowance && restView.synced === true, '刚同步还没花时，剩余就是这一份额度（' + restView.remaining + '）')
  check(restView.tier === budget.tierFor(0) && restView.tier === 'green', '额度够用时从绿档起步（' + restView.tier + '）')
  check(restView.reserve === budget.writeReserve(restView.allowance) && restView.reserve > 0,
    '两桶的写保底按 host-budget 的算式算（' + restView.reserve + '）')
  l4.syncServer('gitlab', { requests: { limit: 600, remaining: 321 } }, clock)
  const reqView = l4.view('gitlab', 'requests')
  check(reqView.allowance === 600, 'requests 桶的额度直接用读数 limit、不打折（实得 ' + reqView.allowance + '）')
  check(reqView.remaining === 321, 'requests 桶的剩余仍取保守下界（读数 remaining，实得 ' + reqView.remaining + '）')
  check(reqView.reserve === 0, 'requests 桶没有「留给写操作」这回事，写保底恒 0（实得 ' + reqView.reserve + '）')
  // 额度为 0 时不算档位：读数 limit 是 0，allowance 为 0，tier 必须是 null 而不是红档。
  l4.syncServer('github', { rest: { limit: 0, remaining: 0 } }, clock)
  check(l4.view('github', 'rest').allowance === 0 && l4.view('github', 'rest').tier === null,
    '额度还没量出来（allowance 为 0）时不算档位（tier=' + show(l4.view('github', 'rest').tier) + '）')

  // ---------- ⑤ spend：四种口径的记账范围 ----------
  const l5 = newLedger()
  l5.ensureBackend('github', gh)
  l5.ensureBackend('gitlab', gl)
  l5.ensureBackend('markdown', md)
  l5.ensureBackend('bitbucket', unknown)
  l5.syncServer('github', { rest: { limit: 5000, remaining: 1000 }, graphql: { limit: 5000, remaining: 1000 } }, clock)
  l5.syncServer('gitlab', { requests: { limit: 600, remaining: 600 } }, clock)
  // 双桶：rest 按请求条数记，points 不折进来。
  l5.spend({ account: 'plugin', backendId: 'github', bucket: 'rest', requests: 3, points: 9 })
  check(l5.view('github', 'rest').used === 3, '双桶后端的 rest 桶按请求条数记（实得 ' + l5.view('github', 'rest').used + '）')
  check(l5.view('github', 'graphql').used === 0, 'rest 桶的 9 点一点都没折进 graphql 桶（实得 ' + l5.view('github', 'graphql').used + '）')
  check(l5.hour('plugin', 'github/rest').requests === 3 && l5.hour('plugin', 'github/rest').points === 9,
    '分档计数把条数与点数都记下来，供对账用（' + show(l5.hour('plugin', 'github/rest')) + '）')
  // 双桶：graphql 按点数记。
  l5.spend({ account: 'plugin', backendId: 'github', bucket: 'graphql', requests: 2, points: 5 })
  check(l5.view('github', 'graphql').used === 5, 'graphql 桶按点数记（实得 ' + l5.view('github', 'graphql').used + '）')
  check(l5.view('github', 'rest').used === 3, 'graphql 那一笔没有把请求条数算进 rest 桶（实得 ' + l5.view('github', 'rest').used + '）')
  check(l5.hourOf('plugin', 'github').requests === 5 && l5.hourOf('plugin', 'github').points === 14,
    'hourOf 合计该后端各桶（条数 5、点数 14，实得 ' + show(l5.hourOf('plugin', 'github')) + '）')
  // 只计请求：requests 桶按条数记，点数一律不折。
  l5.spend({ account: 'plugin', backendId: 'gitlab', bucket: 'requests', requests: 4, points: 100 })
  check(l5.view('gitlab', 'requests').used === 4, '只计请求的后端按条数记（实得 ' + l5.view('gitlab', 'requests').used + '）')
  check(l5.view('gitlab', 'requests').used !== 100, '只计请求的后端不把点数折算成用量（实得 ' + l5.view('gitlab', 'requests').used + '）')
  check(l5.hourOf('plugin', 'gitlab').requests === 4 && l5.hourOf('plugin', 'gitlab').points === 100,
    '只计请求的后端仍然把点数记进分档计数（账面对得上，用量不折）')
  // 离网：没有桶，spend 必须当场抛（装配错不许静默丢账）。
  const eMarkdown = throws(() => l5.spend({ account: 'plugin', backendId: 'markdown', bucket: 'rest', requests: 1, points: 0 }))
  check(eMarkdown.indexOf('没有这个桶') >= 0, '离网后端没有桶，记账当场抛（' + eMarkdown + '）')
  // 未知：只有一个 requests 桶，能记请求数（规格第 8 节「未知模型只记请求数」），
  // 而 rest / graphql 这类按额度形状分的桶它一个都没有，拿它们记账要当场抛。
  l5.spend({ account: 'plugin', backendId: 'bitbucket', bucket: 'requests', requests: 1, points: 0 })
  const unkCount = l5.snapshot().byAccount.plugin['bitbucket/requests'] || { requests: 0, points: 0 }
  check(unkCount.requests === 1, '未知后端的请求数照实落进分档计数（实得 ' + unkCount.requests + '）')
  check(l5.view('bitbucket', 'requests').remaining === null && l5.view('bitbucket', 'requests').used === 0,
    '未知后端没有读数，所以读数视图保持全空、不拿记下的条数冒充剩余量（实得 ' + JSON.stringify({ remaining: l5.view('bitbucket', 'requests').remaining, used: l5.view('bitbucket', 'requests').used }) + '）')
  const eUnknownShape = throws(() => l5.spend({ account: 'plugin', backendId: 'bitbucket', bucket: 'graphql', requests: 1 }))
  check(eUnknownShape.indexOf('没有这个桶') >= 0, '未知后端没有按额度形状分的桶，拿 graphql 记账当场抛（' + eUnknownShape + '）')
  const eWrong = throws(() => l5.spend({ account: 'plugin', backendId: 'github', bucket: 'requests', requests: 1 }))
  check(eWrong.indexOf('没有这个桶') >= 0, '桶不属于这个后端时当场抛，不把账记到别人的桶上（' + eWrong + '）')
  const eAccount = throws(() => l5.spend({ account: 'nobody', backendId: 'github', bucket: 'rest', requests: 1 }))
  check(eAccount.indexOf('这一档') >= 0, '档位不认识时当场抛（' + eAccount + '）')
  // quota-read：服务端不扣配额，只进 free。
  const beforeQuota = { used: l5.view('github', 'rest').used, free: l5.snapshot().free.requests }
  l5.spend({ account: 'plugin', backendId: 'github', bucket: 'rest', kind: 'quota-read', requests: 1, points: 0 })
  check(l5.view('github', 'rest').used === beforeQuota.used, 'quota-read 不扣 used（前 ' + beforeQuota.used + '，后 ' + l5.view('github', 'rest').used + '）')
  check(l5.snapshot().free.requests === beforeQuota.free + 1, 'quota-read 单独记进 free（+' + (l5.snapshot().free.requests - beforeQuota.free) + '）')
  check(l5.hour('plugin', 'github/rest').requests === 4, 'quota-read 仍算一次真实出站，记进分档计数（实得 ' + l5.hour('plugin', 'github/rest').requests + '）')

  // ---------- ⑥ 限流信号 ----------
  const l6 = newLedger()
  l6.ensureBackend('github', gh)
  l6.syncServer('github', { rest: { limit: 5000, remaining: 5000 } }, clock)
  l6.noteRateLimited('github', 'rest', 60, clock)
  check(l6.view('github', 'rest').tier === 'red' && l6.view('github', 'rest').rateLimited === true,
    '撞上限流后即使额度没用完也降到红档（tier=' + l6.view('github', 'rest').tier + '）')
  clock += 61000
  check(l6.view('github', 'rest').tier === 'green' && l6.view('github', 'rest').rateLimited === false,
    'Retry-After 的秒数过去之后档位自己回来（' + l6.view('github', 'rest').tier + '）')
  check(throws(() => l6.noteRateLimited('github', 'rest', 0, clock)).indexOf('秒数') >= 0, '降档信号没有秒数时抛错（账本不替服务端编一个时长）')
  check(throws(() => l6.noteRateLimited('github', 'requests', 30, clock)).indexOf('没有这个桶') >= 0, '降档信号记到不存在的桶上时抛错')

  // ---------- ⑦ rollHour：清本小时用量，不动读数与「同步之后已花」 ----------
  const l7 = newLedger()
  l7.ensureBackend('gitlab', gl)
  l7.syncServer('gitlab', { requests: { limit: 1000, remaining: 1000 } }, clock)
  l7.spend({ account: 'plugin', backendId: 'gitlab', bucket: 'requests', requests: 9 })
  l7.spend({ account: 'ai-tool', backendId: 'gitlab', bucket: 'requests', requests: 2 })
  check(l7.view('gitlab', 'requests').used === 11, '过点之前本小时用量记着（9 + 2 = 11，实得 ' + l7.view('gitlab', 'requests').used + '）')
  const beforeRoll = l7.snapshot()
  clock += budget.HOUR_MS
  const afterRoll = l7.snapshot()
  check(afterRoll.hourKey === beforeRoll.hourKey + 1, '跨过整点后 hourKey 进一格（' + beforeRoll.hourKey + ' → ' + afterRoll.hourKey + '）')
  check(afterRoll.buckets['gitlab/requests'].used === 0, '跨点清掉所有桶的本小时用量（实得 ' + afterRoll.buckets['gitlab/requests'].used + '）')
  check(afterRoll.byAccount['plugin']['gitlab/requests'].requests === 0 && afterRoll.byAccount['ai-tool']['gitlab/requests'].requests === 0,
    '跨点清掉各档的分桶计数（plugin=' + afterRoll.byAccount['plugin']['gitlab/requests'].requests + '，ai-tool=' + afterRoll.byAccount['ai-tool']['gitlab/requests'].requests + '）')
  check(afterRoll.free.requests === 0, '跨点也清掉 free（实得 ' + afterRoll.free.requests + '）')
  check(afterRoll.buckets['gitlab/requests'].synced === true && afterRoll.buckets['gitlab/requests'].allowance === 1000,
    '跨点不动读数与额度（synced=' + afterRoll.buckets['gitlab/requests'].synced + '，allowance=' + afterRoll.buckets['gitlab/requests'].allowance + '）')
  check(afterRoll.buckets['gitlab/requests'].remaining === 989,
    '跨点不动「同步之后已花」：剩余仍是 1000 − 11 = 989，不是 1000（实得 ' + afterRoll.buckets['gitlab/requests'].remaining + '）')
  check(afterRoll.total.requests === 11, '跨点不清累计总量（total 仍记着 11 条，实得 ' + afterRoll.total.requests + '）')

  // ---------- ⑧ 总览与 hour 的键 ----------
  const l8 = newLedger()
  l8.ensureBackend('github', gh)
  l8.syncServer('github', { rest: { limit: 5000, remaining: 1000 } }, clock)
  l8.spend({ account: 'user-action', backendId: 'github', bucket: 'rest', requests: 1 })
  const snap = l8.snapshot()
  check(snap.byAccount['plugin'].hour.requests === 0 && snap.byAccount['user-action'].hour.requests === 1,
    '总览按档位分开记，谁花的记在谁头上（plugin=' + snap.byAccount['plugin'].hour.requests + '，user-action=' + snap.byAccount['user-action'].hour.requests + '）')
  check(snap.byAccount['user-action']['github/rest'].requests === 1, '总览里每一档按桶键给一份计数（' + show(snap.byAccount['user-action']['github/rest']) + '）')
  check(throws(() => l8.hour('plugin', 'rest')).indexOf('后端/桶名') >= 0, 'hour 只认桶键，旧的裸桶名当场抛（键是「后端/桶名」）')
  check(l8.hourOf('plugin', 'markdown').requests === 0 && l8.hourOf('plugin', 'markdown').points === 0,
    '没有桶的后端合计是零，不是抛错（离网后端本来就不花）')

  console.log(failed ? '\n存在失败 — verify-1446-backend-ledger 未通过' : '\n全部通过 — 账本按后端分键门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e: any) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})