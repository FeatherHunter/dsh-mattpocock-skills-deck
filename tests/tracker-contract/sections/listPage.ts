/**
 * tests/tracker-contract/sections/listPage.ts — 分页契约段（#690）。
 *
 * 第一性原理：这一条操作（listPage）是「界面上那些已关闭票怎么按需翻出来」在契约层的接缝。在那之前，
 *   历史是把整个池子一次拉全拿到的，而池子会被后端悄悄截断（缺陷票 #677）；翻页这条路的隐藏陷阱是
 *   「页与页之间漏掉一张」与「拿不全却当成翻到底了」—— 所以这一段盯的不是「有没有翻页」，而是四件事：
 *   一、排序键固定创建时间倒序（翻页期间有人改票也不会让票在页与页之间挪位置而漏掉）；
 *   二、游标是**不透明**的：调用方只负责原样回传，后端不该要求调用方拼它；
 *   三、总数与页内的行是同一口径的（界面上「已加载 x / 共 N」的 N 就靠它），数不全一律整体失败；
 *   四、翻到底就是翻到底：说「还有下一页」却给不出游标，必须整体失败，不许假装历史到头了。
 * 不锁实现细节：断言里不出现「用了哪条命令、查询怎么拼」以外的实现选择（换查询形状、换游标编码，
 *   这一段都不该红）。
 *
 * 三方假身各代表一种位置：
 *   unsupported-fake —— 没实现这条操作的后端：注册表按 OPERATIONS 自动补桩（走真注册表包一层）。
 *   paging-fake      —— 能翻页的后端：游标与总数是它自己给的（GitLab 的页码、本地 Markdown 的下标都是这个位置）。
 *   guessing-fake    —— 数不全却照样回一个总数的后端：形状挑不出毛病，所以责任写在后端自报失败那一侧
 *                       （第 6 段把这个已知边界写下来，免得以后有人以为已经守住了）。
 *
 * 另有几条不是对着假身自说自话，而是对着真实的东西断言：
 *   真实本地 Markdown 后端模块：走到哪一步算哪一步 —— 要么实现出并给出合规的一页，要么经注册表自动补桩、
 *     落到「做不到」（它是否实现由自己的落地票决定，本段两种都收）。
 *   真实 GitLab 后端模块：这一条 2026-10-14 起真实现（地图 10 / #1062），所以这一段改成**正向行为断言** ——
 *     给一个脚本化的 glab，逐条核对 URL 实参、游标语义、总数与「总数拿不到就整条失败」。
 *   真实 GitHub 后端模块：给一个脚本化的 gh，逐条验上面那四件事（含「薄片段不带正文与评论」）。
 *
 * 2026-10-15 返工（对抗式审查报告 research/1063-adversarial-review.md 的发现 1）：GitLab 那一段原来与
 * markdown 共用 `pageProbeCheck`，而那个判据把「ok:false 且形状齐全」也算合规 —— 把真实现换成一律
 * fail(env, '还没做') 的空壳，它照样绿。现在 GitLab 那一路改用 `pageAnswerCheck`（必须真给出一页，
 * 且条数、游标、总数与脚本化的回话对得上），每条新判据自带「空壳必须被逮住」的 ✗ probe。
 *
 * 每段自带反例（✗ probe）：检查器是纯函数，把故意写错的样本喂给它必须逮住；逮不住这一段就形同虚设。
 */

import { createRegistry } from '../../../src/tracker/registry/core.js'
import { ERROR_KIND } from '../../../src/tracker/contract/vocabulary.js'
import { gitlabBackend } from '../../../src/tracker/rooms/gitlab/index.js'
import { githubModule } from '../../../src/tracker/rooms/github/index.js'
import { markdownModule } from '../../../src/tracker/rooms/markdown/index.js'
import { unsupportedAnswerCheck } from './labels.js'
import { createOutboundControl } from '../../../src/refresh/rooms/host/outbound-control.js'
import type { BackendContext, OpContext } from '../../../src/tracker/contract/contexts.js'
import type { BackendModule } from '../../../src/tracker/contract/backend-module.js'
import type { RepositoryRef } from '../../../src/tracker/contract/entities.js'

/** 单条 listPage 断言的结果：ok 为判定，detail 留现场。 */
export interface PageAssertResult {
  name: string
  ok: boolean
  detail: string
}

/** 分页回答的宽形状：测试只关心 ok/data/error 三格，不展开房间内部类型。 */
export interface PageResponse {
  ok?: unknown
  data?: unknown
  error?: unknown
}

/** 一页数据的宽形状：✗ probe 会喂错形状，键值都按未知收。 */
export interface PageData {
  items?: unknown
  nextCursor?: unknown
  total?: unknown
}

/**
 * 房间一次分页的返回（测试消费视角）：检查器先验形状，验过之后调用方按「合规页」消费。
 * 失败分支运行时没有 data——本文件碰 data 的地方，形状检查器都在同一条 && 里先验过。
 */
export interface PageResult {
  ok?: unknown
  data: PageData
  error?: unknown
}

/** pageAnswerCheck 的期望：测试自己脚本化了远端回话，所以测试知道该是多少。 */
export interface PageWant {
  items?: unknown
  nextCursor?: unknown
  total?: unknown
}

/** 翻页选项的宽形状：游标对调用方不透明，只原样回传。 */
export interface PageOpts {
  cursor?: unknown
  limit?: unknown
}

/** 能翻页假身的种子：行、整体失败、写坏的形状三选一。 */
export interface PagingFakeSeed {
  id?: string
  rows?: Array<{ key: string; state: string }>
  failure?: { kind: string; message: string }
  broken?: unknown
}

/** 能翻页假身的调用记录：游标与筛条件是不是原样交下去，就看这两格。 */
export interface PagingCalls {
  n: number
  lastOpts: PageOpts | null
  lastFilter: unknown
}

const KNOWN_KINDS: readonly unknown[] = Object.values(ERROR_KIND)

/** 一页的形状检查器：返回违规清单（空 = 合规）。 */
export function pageShapeCheck(res: PageResponse): string[] {
  const bad: string[] = []
  if (!res || typeof res !== 'object') return ['分页要返回 {ok:true, data:{items,nextCursor,total}} 或 {ok:false, error:{kind,message}}']
  if (res.ok !== true) return ['这一份是成功样本，ok 应为 true，实得 ' + JSON.stringify(res.ok)]
  const raw: unknown = res.data
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['data 要是对象 {items,nextCursor,total}']
  // 形状已验过是对象，这里只把键值按未知收：下面每处都用守卫收窄，不直接断言。
  const d = raw as PageData
  const keys = Object.keys(d).sort().join(',')
  if (keys !== 'items,nextCursor,total') bad.push('data 只许有 items、nextCursor、total 三个键，实得 ' + keys)
  if (!Array.isArray(d.items)) bad.push('items 要是数组（一页的行数据）')
  else {
    for (let i = 0; i < d.items.length; i++) {
      const it = d.items[i]
      if (!it || typeof it !== 'object') { bad.push('items[' + i + '] 要是对象'); continue }
      if (typeof it.key !== 'string') bad.push('items[' + i + '] 的 key 要是字符串（契约身份字段）')
      if ('number' in it) bad.push('items[' + i + '] 不许带 number（那是宿主补的，后端只给 key）')
      if (it.state !== 'open' && it.state !== 'closed') bad.push('items[' + i + '] 的 state 只许 open 或 closed，实得 ' + JSON.stringify(it.state))
    }
  }
  if (d.nextCursor !== null && typeof d.nextCursor !== 'string') bad.push('nextCursor 要么是字符串（下一页游标）要么是 null（翻到底了），实得 ' + JSON.stringify(d.nextCursor))
  if (typeof d.total !== 'number' || !isFinite(d.total) || d.total < 0 || Math.floor(d.total) !== d.total) bad.push('total 要是不小于 0 的整数（同一口径的总数），实得 ' + JSON.stringify(d.total))
  return bad
}

/** 「拿不全就该失败」检查器：整条操作必须失败，档位是契约里列的那几种，且消息里说得清为什么。
 *  needStaleMsg = true 时还要点名「游标已失效」（界面据此丢游标、重取第一页）。 */
export function pageFailureCheck(res: PageResponse, needStaleMsg: boolean): string[] {
  const bad: string[] = []
  if (!res || typeof res !== 'object') return ['拿不全时要以 {ok:false, error:{kind,message}} 整体失败，实得 ' + JSON.stringify(res)]
  if (res.ok !== false) return ['拿不全时必须整体失败（不许返回半页、也不许猜一个总数），实得 ok=' + JSON.stringify(res.ok) + ' data=' + JSON.stringify(res.data)]
  const rawErr: unknown = res.error
  if (!rawErr || typeof rawErr !== 'object') return ['失败要给 error 对象说清为什么', JSON.stringify(res)]
  // 形状已验过是对象，kind 与 message 按未知收，下面逐格守卫。
  const err = rawErr as { kind?: unknown; message?: unknown }
  if (!KNOWN_KINDS.includes(err.kind)) bad.push('error.kind 必须是既有错误分类之一，实得 ' + JSON.stringify(err.kind))
  if (typeof err.message !== 'string' || !err.message.trim()) bad.push('error.message 要是能看懂的一句话')
  if (needStaleMsg && typeof err.message === 'string' && err.message.indexOf('游标已失效') < 0) bad.push('游标失效这一种要在 message 里点名「游标已失效」，实得 ' + JSON.stringify(err.message))
  return bad
}

/**
 * 真实后端探针的判据：要么给出一页合规的数据，要么诚实地回报失败。
 *
 * 2026-10-14 改动（地图 10 / #1062）：失败也分两种合规 —— 注册表按名录补的「做不到」桩，与真实现
 * 撞上「这一趟没有可用的运行环境」而如实失败。改动之前只认前一种，因为那时探针里的两个真实后端
 * （GitLab 与本地 Markdown）在分页这条上都是桩；GitLab 这一轮真实现了它，于是后一种也成了合规答案。
 * **判据没有放宽成「随便失败都算过」**：仍然要求 error 形状齐全（能看懂的 kind 与一句 message），
 * 而且两种之间必须落进其中一种。
 */
export function pageProbeCheck(res: PageResponse): string[] {
  if (res && typeof res === 'object' && res.ok === false) {
    const stub = unsupportedAnswerCheck('listPage', res)
    const honest = pageFailureCheck(res, false)
    if (stub.length === 0 || honest.length === 0) return []
    return stub.concat(honest)
  }
  return pageShapeCheck(res)
}

/**
 * 对着**真实现**的分页探针判据（2026-10-15 返工新增）：必须真给出一页合规数据，而且这一页要与测试
 * 脚本化的远端回话对得上（条数、下一页游标、总数）。
 *
 * 为什么要有它：`pageProbeCheck` 把「ok:false 且形状齐全」也算合规 —— 那是给「这一条还是注册表补的桩」
 * 那个阶段写的。GitLab 这一条真实现之后，拿它来验真实现就等于没验：一律 `fail(env, '还没做')` 的空壳
 * 照样过（对抗式审查的发现 1）。凡是对着真实现的探针，都要要求它做到契约要求的那件事。
 *
 * @param res 真实后端模块的返回
 * @param want 期望的 `{items, nextCursor, total}` —— 测试自己脚本化了远端回话，所以测试知道该是多少
 */
export function pageAnswerCheck(res: PageResult, want: PageWant): string[] {
  const bad = pageShapeCheck(res)
  if (bad.length) return bad
  // 形状检查器刚验过三格齐全，这里只把「合规页」抠出来做值比对，不放宽任何形状。
  const d = res.data as { items: Array<Record<string, unknown>>; nextCursor: unknown; total: unknown }
  const w = want || {}
  if (typeof w.items === 'number' && d.items.length !== w.items) {
    bad.push('这一页应有 ' + w.items + ' 行（脚本化的回话给了这么多），实得 ' + d.items.length)
  }
  if ('nextCursor' in w && d.nextCursor !== w.nextCursor) {
    bad.push('nextCursor 应为 ' + JSON.stringify(w.nextCursor) + '，实得 ' + JSON.stringify(d.nextCursor))
  }
  if (typeof w.total === 'number' && d.total !== w.total) {
    bad.push('total 应为 ' + w.total + '（脚本化的回话给的就是这个数），实得 ' + JSON.stringify(d.total))
  }
  return bad
}

// ── 三个假身（只活在测试里）──────────────────────────────────────────────────

/** 做不到的假身：create() 只给 list，分页这条由注册表按 OPERATIONS 自动补桩。 */
export function createUnsupportedFake(id?: string): BackendModule {
  return {
    id: id || 'page-unsupported-fake',
    label: '做不到的假身',
    // 做不到的假身只验自动补桩行为，不断言额度，所以按离网口径声明。
    budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
    create: () => ({ list: async () => ({ ok: true, data: [] }) }),
    matches: async () => false,
  } as unknown as BackendModule
}

/** 能翻页的假身：按创建时间倒序切页；游标就是「下一张的下标」编码成的字符串（对调用方不透明）。 */
export function createPagingFake(seed?: PagingFakeSeed): BackendModule & { _calls: PagingCalls } {
  const s: PagingFakeSeed = seed || {}
  const rows = Array.isArray(s.rows) ? s.rows : []
  const calls: PagingCalls = { n: 0, lastOpts: null, lastFilter: null }
  return {
    id: s.id || 'page-fake',
    label: '能翻页的假身',
    // 能翻页的假身只验分页语义，不断言额度，所以按离网口径声明。
    budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
    create: () => ({
      list: async () => ({ ok: true, data: [] }),
      listPage: async (_repo: unknown, filter?: unknown, opts?: PageOpts) => {
        calls.n++
        calls.lastOpts = opts || null
        // filter 对调用方是透传的测试输入，这里只记下来不断言形状；
        // unknown 到记录形状的断言只影响编译期，运行时还是原来那个对象。
        calls.lastFilter = (filter || null) as unknown
        if (s.failure) return { ok: false, error: s.failure }
        if (s.broken) return { ok: true, data: s.broken }
        const limit = (opts && typeof opts.limit === 'number' && opts.limit > 0) ? opts.limit : 50
        const from = (opts && opts.cursor) ? parseInt(String(opts.cursor), 10) : 0
        const slice = rows.slice(from, from + limit)
        const next = (from + limit) < rows.length ? String(from + limit) : null
        return { ok: true, data: { items: slice, nextCursor: next, total: rows.length } }
      },
    }),
    matches: async () => false,
    _calls: calls,
  } as unknown as BackendModule & { _calls: PagingCalls }
}

/** 数不全却照样回一个总数的假身：只装了第一页，却把这一页的条数当成总数交出去。 */
export function createGuessingFake(): BackendModule {
  return {
    id: 'page-guessing-fake',
    label: '数不全却回总数的假身',
    // 反例假身只验残缺必败，不断言额度，所以按离网口径声明。
    budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
    create: () => ({
      list: async () => ({ ok: true, data: [] }),
      listPage: async () => ({ ok: true, data: { items: [{ key: '1', state: 'closed' }], nextCursor: null, total: 1 } }),
    }),
    matches: async () => false,
  } as unknown as BackendModule
}

export async function run(): Promise<PageAssertResult[]> {
  const out: PageAssertResult[] = []
  const P = 'listPage · '
  const assert = async (name: string, cond: unknown, detail?: string): Promise<void> => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }
  // 注册表上下文只给日志两格就够了：本段的 matches 都不摸上下文，真后端的 listPage 走各自探针的 ctx。
  // 类型上按完整 BackendContext 断言一次，运行时还是这个两格对象。
  const regCtx = { logEvent: () => {}, isEnabled: () => false } as unknown as BackendContext
  const reg = createRegistry(regCtx, { matchesTimeout: 200 })
  const ref = (backend: string): RepositoryRef => ({ backend: backend, refId: backend === 'markdown' ? '/ws/fake' : 'acme/demo', name: 'demo', url: '' })
  // 顶层探针上下文只给工作区一格：假身的 listPage 不摸上下文，真后端的走各自探针的 ctx。
  const ctx = { cwd: '/ws/fake' } as unknown as OpContext

  // ── 一、做不到的假身：注册表自动补桩，它必须诚实地说做不到 ──
  {
    const d = reg.register(createUnsupportedFake())
    const tracker = reg.get('page-unsupported-fake')!
    await assert('注册表包桩后 listPage 可调（不抛）', typeof tracker.listPage === 'function', 'Proxy 没按 OPERATIONS 补桩')
    const r = await tracker.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 50 }, ctx)
    await assert('做不到的假身：listPage 诚实说做不到', unsupportedAnswerCheck('listPage', r).length === 0, unsupportedAnswerCheck('listPage', r).join('；') || JSON.stringify(r))
    await assert('✗ probe: 假装能用的回答被逮（回一个空页）', unsupportedAnswerCheck('listPage', { ok: true, data: { items: [], nextCursor: null, total: 0 } }).length > 0, '检查器放过了「假装能」')
    await assert('✗ probe: 说错了错误档也被逮', unsupportedAnswerCheck('listPage', { ok: false, error: { kind: 'network', message: 'page-unsupported-fake does not implement op listPage' } }).length > 0, '检查器放过了错误的 error.kind')
    d.dispose()
  }

  // ── 二、能翻页的假身：一页的形状、游标原样回传、翻到底就是 null ──
  {
    const rows: Array<{ key: string; state: string }> = []
    for (let i = 10; i >= 1; i--) rows.push({ key: String(i), state: 'closed' })
    const fake = createPagingFake({ rows: rows })
    const d = reg.register(fake)
    const tracker = reg.get('page-fake')!
    const env = { state: 'closed' }
    const p1 = await tracker.listPage(ref('github'), env, { limit: 4 }, ctx)
    await assert('能翻页的假身：第一页形状合规', pageShapeCheck(p1).length === 0, pageShapeCheck(p1).join('；') || JSON.stringify(p1).slice(0, 200))
    await assert('第一页取回 limit 张、还有下一页', p1.ok && p1.data.items.length === 4 && typeof p1.data.nextCursor === 'string', JSON.stringify(p1.data && { n: p1.data.items.length, next: p1.data.nextCursor, total: p1.data.total }))
    await assert('total 是同一口径的总数（10 张都在）', p1.ok && p1.data.total === 10, String(p1.ok && p1.data.total))
    const c1 = p1.data.nextCursor
    const p2 = await tracker.listPage(ref('github'), env, { cursor: c1, limit: 4 }, ctx)
    await assert('游标原样回传即可翻下一页（后端不许要求调用方解析它）', p2.ok && fake._calls.lastOpts && fake._calls.lastOpts.cursor === c1 && p2.data.items.length === 4, JSON.stringify(fake._calls.lastOpts))
    await assert('页与页之间不重不漏（按创建时间倒序推下去，没有回头张）', p2.ok && p2.data.items[0].key !== p1.data.items[0].key, '第二页与第一页首行相同（挪位或重复）')
    const p3 = await tracker.listPage(ref('github'), env, { cursor: p2.data.nextCursor, limit: 4 }, ctx)
    await assert('翻到底：nextCursor 给 null（不是空串、也不是省略）', p3.ok && p3.data.nextCursor === null && p3.data.items.length === 2, JSON.stringify(p3.data && { n: p3.data.items.length, next: p3.data.nextCursor }))
    await assert('filter 原样交给后端（state 收窄到已关闭）', fake._calls.lastFilter && (fake._calls.lastFilter as { state?: unknown }).state === 'closed', JSON.stringify(fake._calls.lastFilter))
    d.dispose()

    // ✗ probe：检查器必须逮得住形状写错的回答
    await assert('✗ probe: 少了 total 被逮', pageShapeCheck({ ok: true, data: { items: [], nextCursor: null } }).length > 0, '检查器放过了缺键')
    await assert('✗ probe: nextCursor 写成 undefined 被逮', pageShapeCheck({ ok: true, data: { items: [], nextCursor: undefined, total: 0 } }).length > 0, '检查器放过了 undefined 游标')
    await assert('✗ probe: total 写成字符串被逮', pageShapeCheck({ ok: true, data: { items: [], nextCursor: null, total: '10' } }).length > 0, '检查器放过了字符串总数')
    await assert('✗ probe: 行上多带 number 被逮', pageShapeCheck({ ok: true, data: { items: [{ key: '1', number: 1, state: 'closed' }], nextCursor: null, total: 1 } }).length > 0, '检查器放过了后端自己补的 number')
    await assert('✗ probe: 行上 state 写成大写被逮（契约是小写两态）', pageShapeCheck({ ok: true, data: { items: [{ key: '1', state: 'CLOSED' }], nextCursor: null, total: 1 } }).length > 0, '检查器放过了大写 state')
    await assert('✗ probe: 多带了一个键被逮', pageShapeCheck({ ok: true, data: { items: [], nextCursor: null, total: 0, partial: true } }).length > 0, '检查器放过了多余字段')
  }

  // ── 三、翻不动时整体失败（假身演配额耗尽），游标失效单独认得出 ──
  {
    const d = reg.register(createPagingFake({ id: 'page-failing-fake', failure: { kind: 'rate-limit', message: '配额用完了，等一会儿再试' } }))
    const r = await reg.get('page-failing-fake')!.listPage(ref('github'), { state: 'closed' }, { cursor: 'zz', limit: 50 }, ctx)
    await assert('取不到 → 整体失败，档位与消息都合规（界面据此只给「在网页上看全部」或提示重试）', pageFailureCheck(r, false).length === 0, pageFailureCheck(r, false).join('；') || JSON.stringify(r))
    await assert('✗ probe: 失败却回半页被逮', pageFailureCheck({ ok: true, data: { items: [{ key: '1', state: 'closed' }], nextCursor: null, total: 1 } }, false).length > 0, '检查器放过了「失败时给半页」')
    await assert('✗ probe: 失败却不说是哪一档被逮', pageFailureCheck({ ok: false, error: { kind: 'whatever', message: 'x' } }, false).length > 0, '检查器放过了自造的错误档')
    d.dispose()

    const d2 = reg.register(createPagingFake({ id: 'page-stale-fake', failure: { kind: 'not-found', message: 'listPage: 游标已失效，请重新加载（after cursor is invalid）' } }))
    const rStale = await reg.get('page-stale-fake')!.listPage(ref('github'), { state: 'closed' }, { cursor: 'stale', limit: 50 }, ctx)
    await assert('游标失效：整体失败且消息点名「游标已失效」（界面据此丢游标重取第一页）', pageFailureCheck(rStale, true).length === 0, pageFailureCheck(rStale, false).join('；') || JSON.stringify(rStale))
    await assert('✗ probe: 游标失效却没说清是哪一种被逮', pageFailureCheck({ ok: false, error: { kind: 'parse', message: 'listPage: bad cursor' } }, true).length > 0, '检查器放过了不点名的失效消息')
    d2.dispose()
  }

  // ── 四、真实本地 Markdown 后端探针：走到哪一步算哪一步（判据与原来一字不差）──
  {
    const regMd = createRegistry(regCtx, { matchesTimeout: 200 })
    const dMd = regMd.register(markdownModule)
    const rMd = await regMd.get('markdown')!.listPage(ref('markdown'), { state: 'closed' }, { cursor: '', limit: 50 }, ctx)
    await assert('真实 markdown 后端：要么给一页合规数据、要么诚实说做不到', pageProbeCheck(rMd).length === 0, pageProbeCheck(rMd).join('；') || JSON.stringify(rMd).slice(0, 200))
    dMd.dispose()
  }

  // ── 四之二、真实 GitLab 后端：给一个脚本化的 glab，逐条钉住它拿到回话之后做对 ──
  //   2026-10-14（地图 10 / #1062）这一房真实现了 listPage；2026-10-15 返工（对抗式审查发现 1）把这一段
  //   从「失败得好看也算过」改成正向行为断言。
  //   这一段的 ctx 与下面 github 探针同一个形状：cwd、platform（resolveExecutable 认得 glab）、
  //   exec（脚本化的桩）、isEnabled 与 logEvent —— 有 exec 有 platform，glabClient 才走「真去做」那条路。
  {
    // 脚本化的 glab：一个 exec 同时伺候两个端点（issues 与 issues_statistics），按路径分派。
    // rows 按创建时间倒序排好 —— URL 里写着 order_by=created_at&sort=desc，远端就该这么回；
    // 桩只按 page / per_page 切片，不做任何别的加工。
    const mkScriptedGlab = (opts?: { total?: number; statFail?: string; issuesFail?: string }) => {
      const o = opts || {}
      const calls: string[] = []
      const total = typeof o.total === 'number' ? o.total : 5
      const allRows: Array<Record<string, unknown>> = []
      for (let i = total; i >= 1; i--) {
        allRows.push({
          iid: i,
          title: '第 ' + i + ' 张票',
          state: 'closed',
          description: '',
          web_url: 'https://gitlab.example/acme/demo/-/issues/' + i,
          created_at: '2026-01-0' + ((i % 9) + 1) + 'T00:00:00Z',
          updated_at: '2026-02-01T00:00:00Z',
          labels: [{ name: 'bug', color: '#d73a4a' }],
          assignees: [{ username: 'someone' }],
          author: { username: 'author' },
        })
      }
      const exec = async (cmd: string, args?: string[]) => {
        const line = (args || []).join(' ')
        calls.push(line)
        if (cmd !== 'glab') return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + cmd }
        const path = String((args && args[1]) || '')
        const q = path.indexOf('?') >= 0 ? new URLSearchParams(path.slice(path.indexOf('?') + 1)) : new URLSearchParams()
        if (path.indexOf('/issues_statistics?') >= 0) {
          if (o.statFail) return { code: 1, stdout: '', stderr: o.statFail }
          return { code: 0, stdout: JSON.stringify({ statistics: { counts: { all: total, closed: total, opened: total } } }), stderr: '' }
        }
        if (path.indexOf('/issues?') >= 0) {
          if (o.issuesFail) return { code: 1, stdout: '', stderr: o.issuesFail }
          const page = Number(q.get('page') || '1')
          const perPage = Number(q.get('per_page') || '20')
          const from = (page - 1) * perPage
          return { code: 0, stdout: JSON.stringify(allRows.slice(from, from + perPage)), stderr: '' }
        }
        return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + line }
      }
      return { exec: exec, calls: calls, issuesCalls: () => calls.filter((c) => c.indexOf('/issues?') >= 0) }
    }
    const glProbeCtx = (s: ReturnType<typeof mkScriptedGlab>): OpContext => ({ cwd: '/ws/fake', platform: { resolveExecutable: async (n: string) => (n === 'glab' ? 'glab' : null) }, exec: s.exec, isEnabled: () => false, logEvent: () => {} }) as unknown as OpContext

    const regGl = createRegistry(regCtx, { matchesTimeout: 200 })
    const dGl = regGl.register(gitlabBackend)
    const gl = regGl.get('gitlab')!

    // ① 基本一页：URL 实参、行、游标、总数（5 张票、每页 2 张）
    const s1 = mkScriptedGlab({ total: 5 })
    const p1 = await gl.listPage(ref('gitlab'), { state: 'closed' }, { cursor: '', limit: 2 }, glProbeCtx(s1))
    await assert('真实 gitlab 后端：一页合规数据（2 行、还有下一页、总数 5）', pageAnswerCheck(p1, { items: 2, nextCursor: '2', total: 5 }).length === 0, pageAnswerCheck(p1, { items: 2, nextCursor: '2', total: 5 }).join('；') || JSON.stringify(p1).slice(0, 240))
    await assert('真实 gitlab 后端：行按回包顺序原样交出（回包是创建时间倒序，所以头两行是最后建的那两张）', p1.ok === true && p1.data.items.map((it) => it.key).join(',') === '5,4', JSON.stringify(p1.ok === true ? p1.data.items.map((it) => it.key) : p1))
    await assert('真实 gitlab 后端：URL 里 page、per_page、创建时间倒序、with_labels_details、scope=all 都对（cursor 与 limit 确实传下去了）', /[?&]page=1(&|$)/.test(s1.calls[0]) && /[?&]per_page=2(&|$)/.test(s1.calls[0]) && /[?&]order_by=created_at(&|$)/.test(s1.calls[0]) && /[?&]sort=desc(&|$)/.test(s1.calls[0]) && /[?&]with_labels_details=true(&|$)/.test(s1.calls[0]) && /[?&]scope=all(&|$)/.test(s1.calls[0]), s1.calls[0])
    await assert('真实 gitlab 后端：filter.state 下推到远端（state=closed），不是先取一页再内存过滤', /[?&]state=closed(&|$)/.test(s1.calls[0]), s1.calls[0])
    await assert('真实 gitlab 后端：总数来自同房的 counts（每条读多问一次 issues_statistics，这是本房的设计代价）', s1.calls.length === 2 && s1.calls[1].indexOf('/issues_statistics?') >= 0, JSON.stringify(s1.calls))

    // ② 游标原样回传 → 下一页；取不满 → 翻到底
    //   先钉一句「上一页真的成功了」：下面几处都要读 p1.data.nextCursor。少了这句守卫，换成一个
    //   一律返回失败的空壳时整段会抛 TypeError（读 undefined 的 nextCursor），这一段 59 条断言一条都
    //   不跑——那样门禁虽然照红，红的是崩溃而不是判据，等于空壳被「摔死」而不是被「逮住」。
    await assert('真实 gitlab 后端：第一页确实成功了（后面几处都要读它的游标，这里先把它钉住）', p1.ok === true, JSON.stringify(p1).slice(0, 240))
    const p2 = p1.ok === true ? await gl.listPage(ref('gitlab'), { state: 'closed' }, { cursor: p1.data.nextCursor, limit: 2 }, glProbeCtx(s1)) : p1
    await assert('真实 gitlab 后端：游标原样回传就翻到下一页（页码编在游标里，调用方不解析它）', pageAnswerCheck(p2, { items: 2, nextCursor: '3', total: 5 }).length === 0 && s1.issuesCalls()[1].indexOf('page=2') >= 0, pageAnswerCheck(p2, { items: 2, nextCursor: '3', total: 5 }).join('；') || s1.issuesCalls()[1])
    const p3 = p2.ok === true ? await gl.listPage(ref('gitlab'), { state: 'closed' }, { cursor: p2.data.nextCursor, limit: 2 }, glProbeCtx(s1)) : p2
    await assert('真实 gitlab 后端：这一页取不满 → nextCursor 给 null（翻到底了）', pageAnswerCheck(p3, { items: 1, nextCursor: null, total: 5 }).length === 0, pageAnswerCheck(p3, { items: 1, nextCursor: null, total: 5 }).join('；') || JSON.stringify(p3).slice(0, 200))

    // ③ 特别钉住「总数正好是每页条数的整数倍」这一格 —— 写的是**实际行为**，不是做不到的期望：
    //   本房在 glab 这条缝上拿不到响应头（见 ./counts.ts 文件头），「还有下一页」只能靠「这一页的行数
    //   够不够 per_page」判；于是总数正好是整数倍时，最后一页仍会给一个游标，调用方要多取一次才拿回
    //   空表。这是设计代价，不是错误：想少取一次就得读响应头，而响应头本身不可靠 —— 官方
    //   「Pagination response headers」一节写明，结果超过 10000 条时远端不再返回 x-total、
    //   x-total-pages 与 rel="last" 这几个格子（那份清单里没有 rel="next"；本机没有真机可核它在
    //   那种情况下的行为，所以不把它当依据）。
    const s2 = mkScriptedGlab({ total: 4 })
    const e1 = await gl.listPage(ref('gitlab'), { state: 'closed' }, { cursor: '', limit: 2 }, glProbeCtx(s2))
    const e2 = e1.ok === true ? await gl.listPage(ref('gitlab'), { state: 'closed' }, { cursor: e1.data.nextCursor, limit: 2 }, glProbeCtx(s2)) : e1
    const e3 = e2.ok === true ? await gl.listPage(ref('gitlab'), { state: 'closed' }, { cursor: e2.data.nextCursor, limit: 2 }, glProbeCtx(s2)) : e2
    await assert('真实 gitlab 后端：总数是每页条数的整数倍时，取满的第二页仍给游标「3」（拿不到响应头总数，这是设计代价）', pageAnswerCheck(e2, { items: 2, nextCursor: '3', total: 4 }).length === 0, pageAnswerCheck(e2, { items: 2, nextCursor: '3', total: 4 }).join('；') || JSON.stringify(e2).slice(0, 200))
    await assert('真实 gitlab 后端：多取一次才拿到空表与 null 游标（整数倍这一格的收尾方式，不是漏行）', pageAnswerCheck(e3, { items: 0, nextCursor: null, total: 4 }).length === 0 && s2.issuesCalls().length === 3, pageAnswerCheck(e3, { items: 0, nextCursor: null, total: 4 }).join('；') || JSON.stringify(e3).slice(0, 200))

    // ④ limit 要多了按 GitLab 的 per_page 上限收（远端会把超出的自己截到 100，那时「比 per_page 少」
    //   就成了假信号，历史会从这儿少一段 —— 所以本房先把它收到 100）
    const s3 = mkScriptedGlab({ total: 5 })
    await gl.listPage(ref('gitlab'), { state: 'closed' }, { cursor: '', limit: 999 }, glProbeCtx(s3))
    await assert('真实 gitlab 后端：limit 要多了按远端 per_page 上限收（999 → 100，不报错）', /[?&]per_page=100(&|$)/.test(s3.calls[0]), s3.calls[0])

    // ⑤ 拿不到总数 / 拿不到行 / 游标认不出来 → 整条失败，不许返回半成品
    const s4 = mkScriptedGlab({ total: 5, statFail: 'glab: HTTP 401: Bad credentials' })
    const noTotal = await gl.listPage(ref('gitlab'), { state: 'closed' }, { cursor: '', limit: 2 }, glProbeCtx(s4))
    await assert('真实 gitlab 后端：行取到了、总数没取到 → 整条失败（不许返回「有行、没总数」的半成品）', pageFailureCheck(noTotal, false).length === 0 && noTotal.data === undefined && s4.issuesCalls().length === 1, pageFailureCheck(noTotal, false).join('；') || JSON.stringify(noTotal))
    const s5 = mkScriptedGlab({ total: 5, issuesFail: 'glab: HTTP 404: Not Found' })
    const noRows = await gl.listPage(ref('gitlab'), { state: 'closed' }, { cursor: '', limit: 2 }, glProbeCtx(s5))
    await assert('真实 gitlab 后端：列票这一趟报错 → 整条失败（档位来自既有分类，不退化成空页）', pageFailureCheck(noRows, false).length === 0 && noRows.error.kind === 'not-found', pageFailureCheck(noRows, false).join('；') || JSON.stringify(noRows))
    const s6 = mkScriptedGlab({ total: 5 })
    const badCursor = await gl.listPage(ref('gitlab'), { state: 'closed' }, { cursor: 'abc', limit: 2 }, glProbeCtx(s6))
    await assert('真实 gitlab 后端：游标认不出来 → 整条失败且点名「游标已失效」，一个请求都不发', pageFailureCheck(badCursor, true).length === 0 && s6.calls.length === 0, pageFailureCheck(badCursor, true).join('；') || JSON.stringify(badCursor))

    // ⑥ labels 空数组与省略同结果（#1183 定：都是不过滤）。桩不看筛条件，一页 2 行之外，还要看
    //   取行的那条请求里没有 labels 这一格 —— 空数组进了 URL 才是真的走样。
    const s7 = mkScriptedGlab({ total: 5 })
    const pEmpty = await gl.listPage(ref('gitlab'), { state: 'closed', labels: [] }, { cursor: '', limit: 2 }, glProbeCtx(s7))
    await assert('真实 gitlab 后端：labels 空数组与省略同结果（一页 2 行、还有下一页、总数 5）', pageAnswerCheck(pEmpty, { items: 2, nextCursor: '2', total: 5 }).length === 0, pageAnswerCheck(pEmpty, { items: 2, nextCursor: '2', total: 5 }).join('；') || JSON.stringify(pEmpty).slice(0, 240))
    await assert('真实 gitlab 后端：空数组不进 URL（取行的那条请求里没有 labels 这一格）', s7.issuesCalls().length >= 1 && !/[?&]labels=/.test(s7.issuesCalls()[0]), JSON.stringify(s7.issuesCalls()))

    // ✗ probe：这一段的新判据必须逮得住「一律返回失败」的空壳 —— 这正是 2026-10-15 返工要堵的洞。
    //   为什么要专门写这几条：原来 GitLab 这一路与 markdown 共用 `pageProbeCheck`，那个判据把
    //   「ok:false 且形状齐全」也算合规，把真实现换成 `fail(env, '还没做')` 的空壳照样绿。
    //   判据放不放空壳过去，只能靠喂空壳来证明。
    const SHELL = { ok: false, error: { kind: 'env', message: 'listPage 还没做' } }
    await assert('✗ probe: 「一律返回失败」的空壳回答过不了新判据', pageAnswerCheck(SHELL, { items: 2, nextCursor: '2', total: 5 }).length > 0, '判据给出的违规清单：' + JSON.stringify(pageAnswerCheck(SHELL, { items: 2, nextCursor: '2', total: 5 })))
    await assert('✗ probe: 空壳改回一个合规的空页也过不了（条数、游标、总数要与脚本化的回话对得上）', pageAnswerCheck({ ok: true, data: { items: [], nextCursor: null, total: 0 } }, { items: 2, nextCursor: '2', total: 5 }).length > 0, '判据给出的违规清单：' + JSON.stringify(pageAnswerCheck({ ok: true, data: { items: [], nextCursor: null, total: 0 } }, { items: 2, nextCursor: '2', total: 5 })))
    dGl.dispose()
  }

  // ── 五、真实 GitHub 后端：给一个脚本化的 gh，逐条验那四件事 ──
  {
    const thinNode = { number: 42, title: '一张已关闭的票', state: 'CLOSED', url: 'https://example/42', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-02-03T00:00:00Z', labels: { nodes: [{ name: 'bug', color: 'ff0000' }] }, assignees: { nodes: [{ login: 'someone' }] }, author: { login: 'author' } }
    const goodPage = (pageInfo: unknown, total: number) => ({ data: { repository: { issues: { totalCount: total, nodes: [thinNode], pageInfo: pageInfo } } } })
    let lastArgs = ''
    const mkScriptedGh = (payload: unknown, opts?: { fail?: string }) => async (cmd: string, args?: string[]) => {
      lastArgs = (args || []).join(' ')
      if (opts && opts.fail) return { code: 1, stdout: '', stderr: opts.fail }
      return { code: 0, stdout: typeof payload === 'string' ? payload : JSON.stringify(payload), stderr: '' }
    }
    const probeCtx = (ghPayload: unknown, opts?: { fail?: string }): OpContext => ({ cwd: '/ws/fake', outbound: createOutboundControl(), platform: { resolveExecutable: async (n: string) => (n === 'gh' ? 'gh' : null) }, exec: mkScriptedGh(ghPayload, opts), isEnabled: () => false, logEvent: () => {} }) as unknown as OpContext
    const regGh = createRegistry(regCtx, { matchesTimeout: 200 })
    const dGh = regGh.register(githubModule)
    const gh = regGh.get('github')!

    const r1 = await gh.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 50 }, probeCtx(goodPage({ hasNextPage: true, endCursor: 'CUR2' }, 649)))
    await assert('真实 github 后端：一页合规数据（形状与总数都对）', pageShapeCheck(r1).length === 0 && r1.data.total === 649 && r1.data.nextCursor === 'CUR2', pageShapeCheck(r1).join('；') || JSON.stringify(r1).slice(0, 200))
    await assert('排序键固定创建时间倒序（写死在查询里，调用方没有别的选择）', /CREATED_AT/.test(lastArgs) && /direction:DESC/.test(lastArgs), lastArgs.slice(0, 200))
    await assert('filter.state 下推到后端（states[]=CLOSED，不是先取一页再内存过滤）', /states\[\]=CLOSED/.test(lastArgs), lastArgs.slice(0, 200))
    await assert('薄片段不带正文与评论（画一行用不到的两大块不取）', !/\bbody\b/.test(lastArgs) && !/\bcomments\b/.test(lastArgs), lastArgs.slice(0, 260))
    await assert('薄片段带上了画一行要的那些字段', /number/.test(lastArgs) && /title/.test(lastArgs) && /labels\(/.test(lastArgs) && /assignees\(/.test(lastArgs) && /author\{/.test(lastArgs), lastArgs.slice(0, 260))
    await assert('行数据是契约形状（key 字符串、没有 number、state 小写），正文与评论给空值不是省略', r1.ok && r1.data.items[0].key === '42' && !('number' in r1.data.items[0]) && r1.data.items[0].state === 'closed' && r1.data.items[0].body === '' && Array.isArray(r1.data.items[0].comments) && r1.data.items[0].comments.length === 0, JSON.stringify(r1.data && r1.data.items[0]).slice(0, 260))

    const rCursor = await gh.listPage(ref('github'), { state: 'closed' }, { cursor: 'CUR2', limit: 50 }, probeCtx(goodPage({ hasNextPage: false, endCursor: null }, 649)))
    await assert('游标原样回传给后端（after=CUR2）', /after=CUR2/.test(lastArgs), lastArgs.slice(0, 200))
    await assert('后端说没有下一页时，nextCursor 给 null', rCursor.ok && rCursor.data.nextCursor === null, JSON.stringify(rCursor.data && rCursor.data.nextCursor))

    // #1418：契约的上限 200 是「界面一次最多要多少行」；GitHub 的 issues / pullRequests 两条连接
    //   自己只肯给 100 条一页，问多了整页拒绝（EXCESSIVE_PAGINATION）—— 所以发给远端的 first 按连接上限收。
    //   这与 GitLab 房「999 → per_page 100」是同一个处置：契约上限归契约，远端硬上限归房间。
    await gh.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 999 }, probeCtx(goodPage({ hasNextPage: false, endCursor: null }, 649)))
    await assert('limit 超上限按连线上限处理（999 → 100，不报错）', /first=100/.test(lastArgs), lastArgs.slice(0, 160))
    await gh.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 0 }, probeCtx(goodPage({ hasNextPage: false, endCursor: null }, 649)))
    await assert('limit 不合法按缺省 50 处理', /first=50/.test(lastArgs), lastArgs.slice(0, 160))

    const withLabels = await gh.listPage(ref('github'), { state: 'closed', labels: ['bug', 'bug', ' '] }, { cursor: '', limit: 50 }, probeCtx(goodPage({ hasNextPage: false, endCursor: null }, 649)))
    await assert('labels 去重去空白后原样交给后端（filterBy）', withLabels.ok && /labels\[\]=bug/.test(lastArgs) && (lastArgs.match(/labels\[\]=/g) || []).length === 1, lastArgs.slice(0, 220))
    // #1183：空数组与省略同结果（都是不过滤）。桩不看筛条件，总数相等之外，还要看走的是不带
    //   filterBy 的那一版查询、且一个 labels[] 都没传 —— 空数组进了查询才是真的走样。
    const emptyLabels = await gh.listPage(ref('github'), { state: 'closed', labels: [] }, { cursor: '', limit: 50 }, probeCtx(goodPage({ hasNextPage: false, endCursor: null }, 649)))
    await assert('labels 空数组与省略同结果（总数与不筛时一样，都是 649）', emptyLabels.ok && emptyLabels.data.total === 649, JSON.stringify(emptyLabels.data && emptyLabels.data.total))
    // #1418：不带标签的那条查询现在自己也带 filterBy（since 增量窗口用它），所以判据改成
    //   「没有 labels[]= 参数、也没走带 labels:$labels 的那一版」，而不是「不含 filterBy 三个字」。
    await assert('labels 空数组不进远端查询（走不带 labels:$labels 的那一版，一个 labels[] 都不传）', !/labels\[\]=/.test(lastArgs || '') && !/labels:\$labels/.test(lastArgs || ''), String(lastArgs).slice(0, 220))

    const stale = await gh.listPage(ref('github'), { state: 'closed' }, { cursor: 'OLD', limit: 50 }, probeCtx({ data: null, errors: [{ type: 'INVALID_CURSOR', message: 'The `after` cursor is invalid.' }] }))
    await assert('真实 github 后端：游标失效 → 整体失败且点名「游标已失效」', pageFailureCheck(stale, true).length === 0, pageFailureCheck(stale, true).join('；') || JSON.stringify(stale))

    const noCursor = await gh.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 50 }, probeCtx(goodPage({ hasNextPage: true, endCursor: null }, 649)))
    await assert('说「还有下一页」却给不出游标 → 整体失败（拒绝假装翻到底）', pageFailureCheck(noCursor, false).length === 0, pageFailureCheck(noCursor, false).join('；') || JSON.stringify(noCursor))

    const withErrors = await gh.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 50 }, probeCtx({ data: { repository: { issues: { totalCount: 649, nodes: [thinNode], pageInfo: { hasNextPage: false, endCursor: null } } } }, errors: [{ message: 'Something went wrong while executing your query' }] }))
    await assert('真实 github 后端：响应里带 errors → 整体失败（不许猜一个总数出来）', pageFailureCheck(withErrors, false).length === 0, pageFailureCheck(withErrors, false).join('；') || JSON.stringify(withErrors))

    const missingTotal = await gh.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 50 }, probeCtx({ data: { repository: { issues: { nodes: [thinNode], pageInfo: { hasNextPage: false, endCursor: null } } } } }))
    await assert('真实 github 后端：缺 totalCount → 整体失败（不许把缺的那个当 0）', pageFailureCheck(missingTotal, false).length === 0, pageFailureCheck(missingTotal, false).join('；') || JSON.stringify(missingTotal))

    const badJson = await gh.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 50 }, probeCtx('{not json'))
    await assert('真实 github 后端：坏 JSON → 解析档', badJson.ok === false && badJson.error && badJson.error.kind === 'parse', JSON.stringify(badJson))

    const ghDown = await gh.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 50 }, probeCtx(goodPage({ hasNextPage: false, endCursor: null }, 1), { fail: 'gh: Not logged in' }))
    await assert('真实 github 后端：gh 报错 → 如实失败（档位来自既有分类，不退化成空页）', pageFailureCheck(ghDown, false).length === 0 && ghDown.error.kind !== undefined, pageFailureCheck(ghDown, false).join('；') || JSON.stringify(ghDown))

    const badRef = await gh.listPage({ backend: 'github', refId: 'no-slash', name: 'x', url: '' }, { state: 'closed' }, { cursor: '', limit: 50 }, probeCtx(goodPage({ hasNextPage: false, endCursor: null }, 1)))
    await assert('真实 github 后端：仓库地址不合法 → 找不到档', badRef.ok === false && badRef.error && badRef.error.kind === 'not-found', JSON.stringify(badRef))
    dGh.dispose()

    // ✗ probe：探针判据本身要逮得住「既不诚实、也没做到契约」的回答
    await assert('✗ probe: 真实后端把 total 写成字符串被逮', pageProbeCheck({ ok: true, data: { items: [], nextCursor: null, total: '649' } }).length > 0, '探针放过了字符串总数')
    await assert('✗ probe: 真实后端失败却用了自造的档被逮', pageProbeCheck({ ok: false, error: { kind: 'unsupported-ish', message: 'backend github does not implement op listPage' } }).length > 0, '探针放过了自造错误档')
  }

  // ── 六、这一段故意不判的东西（写下来免得以后有人以为已经守住了）──
  //   一个形状完全合规、总数却是猜出来的回包（只装了第一页就把这一页的条数当总数），光看回包形状挑不出毛病。
  //   契约因此把责任放在后端自己身上：数不全时必须整体失败。编排层另有一道判据可加：手上已加载的行数
  //   多于 total 时说明这个数字不可信（界面「已加载 x / 共 N」那句会当场露出来）。
  {
    const d = reg.register(createGuessingFake())
    const r = await reg.get('page-guessing-fake')!.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 50 }, ctx)
    await assert('已知边界：形状合规的「猜出来的总数」靠形状检查器逮不住（所以责任在后端自报失败）', pageShapeCheck(r).length === 0, pageShapeCheck(r).join('；'))
    d.dispose()
  }

  return out
}

export default { name: 'listPage', run }
