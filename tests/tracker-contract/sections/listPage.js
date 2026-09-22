/**
 * tests/tracker-contract/sections/listPage.js — 分页契约段（#690）。
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
 * 另有两条不是对着假身自说自话，而是对着真实的东西断言：
 *   真实 GitLab 与本地 Markdown 后端模块：走到哪一步算哪一步 —— 要么实现了并给出合规的一页，
 *     要么经注册表自动补桩、落到「做不到」（这一轮它们是否实现由各自的落地票决定，本段两种都收）。
 *   真实 GitHub 后端模块：给一个脚本化的 gh，逐条验上面那四件事（含「薄片段不带正文与评论」）。
 *
 * 每段自带反例（✗ probe）：检查器是纯函数，把故意写错的样本喂给它必须逮住；逮不住这一段就形同虚设。
 */

import { createRegistry } from '../../../src/host/tracker/registryCore.js'
import { ERROR_KIND } from '../../../src/shared/tracker/constants.js'
import { gitlabBackend } from '../../../src/host/tracker/backends/gitlab/index.js'
import { githubModule } from '../../../src/host/tracker/backends/github/index.js'
import { markdownModule } from '../../../src/host/tracker/backends/markdown/index.js'
import { unsupportedAnswerCheck } from './labels.js'

const KNOWN_KINDS = Object.values(ERROR_KIND)

/** 一页的形状检查器：返回违规清单（空 = 合规）。 */
export function pageShapeCheck(res) {
  const bad = []
  if (!res || typeof res !== 'object') return ['分页要返回 {ok:true, data:{items,nextCursor,total}} 或 {ok:false, error:{kind,message}}']
  if (res.ok !== true) return ['这一份是成功样本，ok 应为 true，实得 ' + JSON.stringify(res.ok)]
  const d = res.data
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['data 要是对象 {items,nextCursor,total}']
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
export function pageFailureCheck(res, needStaleMsg) {
  const bad = []
  if (!res || typeof res !== 'object') return ['拿不全时要以 {ok:false, error:{kind,message}} 整体失败，实得 ' + JSON.stringify(res)]
  if (res.ok !== false) return ['拿不全时必须整体失败（不许返回半页、也不许猜一个总数），实得 ok=' + JSON.stringify(res.ok) + ' data=' + JSON.stringify(res.data)]
  const err = res.error
  if (!err || typeof err !== 'object') return ['失败要给 error 对象说清为什么', JSON.stringify(res)]
  if (!KNOWN_KINDS.includes(err.kind)) bad.push('error.kind 必须是既有错误分类之一，实得 ' + JSON.stringify(err.kind))
  if (typeof err.message !== 'string' || !err.message.trim()) bad.push('error.message 要是能看懂的一句话')
  if (needStaleMsg && typeof err.message === 'string' && err.message.indexOf('游标已失效') < 0) bad.push('游标失效这一种要在 message 里点名「游标已失效」，实得 ' + JSON.stringify(err.message))
  return bad
}

/** 真实后端探针的判据：要么诚实地说做不到（unsupported 桩），要么给出一页合规的数据。 */
export function pageProbeCheck(res) {
  if (res && typeof res === 'object' && res.ok === false) return unsupportedAnswerCheck('listPage', res)
  return pageShapeCheck(res)
}

// ── 三个假身（只活在测试里）──────────────────────────────────────────────────

/** 做不到的假身：create() 只给 list，分页这条由注册表按 OPERATIONS 自动补桩。 */
export function createUnsupportedFake(id) {
  return {
    id: id || 'page-unsupported-fake',
    label: '做不到的假身',
    create: () => ({ list: async () => ({ ok: true, data: [] }) }),
    matches: async () => false,
  }
}

/** 能翻页的假身：按创建时间倒序切页；游标就是「下一张的下标」编码成的字符串（对调用方不透明）。 */
export function createPagingFake(seed) {
  const s = seed || {}
  const rows = Array.isArray(s.rows) ? s.rows : []
  const calls = { n: 0, lastOpts: null, lastFilter: null }
  return {
    id: s.id || 'page-fake',
    label: '能翻页的假身',
    create: () => ({
      list: async () => ({ ok: true, data: [] }),
      listPage: async (repo, filter, opts) => {
        calls.n++
        calls.lastOpts = opts
        calls.lastFilter = filter
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
  }
}

/** 数不全却照样回一个总数的假身：只装了第一页，却把这一页的条数当成总数交出去。 */
export function createGuessingFake() {
  return {
    id: 'page-guessing-fake',
    label: '数不全却回总数的假身',
    create: () => ({
      list: async () => ({ ok: true, data: [] }),
      listPage: async () => ({ ok: true, data: { items: [{ key: '1', state: 'closed' }], nextCursor: null, total: 1 } }),
    }),
    matches: async () => false,
  }
}

export async function run() {
  const out = []
  const P = 'listPage · '
  const assert = async (name, cond, detail) => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }
  const reg = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  const ref = (backend) => ({ backend: backend, refId: backend === 'markdown' ? '/ws/fake' : 'acme/demo', name: 'demo', url: '' })
  const ctx = { cwd: '/ws/fake' }

  // ── 一、做不到的假身：注册表自动补桩，它必须诚实地说做不到 ──
  {
    const d = reg.register(createUnsupportedFake())
    const tracker = reg.get('page-unsupported-fake')
    await assert('注册表包桩后 listPage 可调（不抛）', typeof tracker.listPage === 'function', 'Proxy 没按 OPERATIONS 补桩')
    const r = await tracker.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 50 }, ctx)
    await assert('做不到的假身：listPage 诚实说做不到', unsupportedAnswerCheck('listPage', r).length === 0, unsupportedAnswerCheck('listPage', r).join('；') || JSON.stringify(r))
    await assert('✗ probe: 假装能用的回答被逮（回一个空页）', unsupportedAnswerCheck('listPage', { ok: true, data: { items: [], nextCursor: null, total: 0 } }).length > 0, '检查器放过了「假装能」')
    await assert('✗ probe: 说错了错误档也被逮', unsupportedAnswerCheck('listPage', { ok: false, error: { kind: 'network', message: 'page-unsupported-fake does not implement op listPage' } }).length > 0, '检查器放过了错误的 error.kind')
    d.dispose()
  }

  // ── 二、能翻页的假身：一页的形状、游标原样回传、翻到底就是 null ──
  {
    const rows = []
    for (let i = 10; i >= 1; i--) rows.push({ key: String(i), state: 'closed' })
    const fake = createPagingFake({ rows: rows })
    const d = reg.register(fake)
    const tracker = reg.get('page-fake')
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
    await assert('filter 原样交给后端（state 收窄到已关闭）', fake._calls.lastFilter && fake._calls.lastFilter.state === 'closed', JSON.stringify(fake._calls.lastFilter))
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
    const r = await reg.get('page-failing-fake').listPage(ref('github'), { state: 'closed' }, { cursor: 'zz', limit: 50 }, ctx)
    await assert('取不到 → 整体失败，档位与消息都合规（界面据此只给「在网页上看全部」或提示重试）', pageFailureCheck(r, false).length === 0, pageFailureCheck(r, false).join('；') || JSON.stringify(r))
    await assert('✗ probe: 失败却回半页被逮', pageFailureCheck({ ok: true, data: { items: [{ key: '1', state: 'closed' }], nextCursor: null, total: 1 } }, false).length > 0, '检查器放过了「失败时给半页」')
    await assert('✗ probe: 失败却不说是哪一档被逮', pageFailureCheck({ ok: false, error: { kind: 'whatever', message: 'x' } }, false).length > 0, '检查器放过了自造的错误档')
    d.dispose()

    const d2 = reg.register(createPagingFake({ id: 'page-stale-fake', failure: { kind: 'not-found', message: 'listPage: 游标已失效，请重新加载（after cursor is invalid）' } }))
    const rStale = await reg.get('page-stale-fake').listPage(ref('github'), { state: 'closed' }, { cursor: 'stale', limit: 50 }, ctx)
    await assert('游标失效：整体失败且消息点名「游标已失效」（界面据此丢游标重取第一页）', pageFailureCheck(rStale, true).length === 0, pageFailureCheck(rStale, true).join('；') || JSON.stringify(rStale))
    await assert('✗ probe: 游标失效却没说清是哪一种被逮', pageFailureCheck({ ok: false, error: { kind: 'parse', message: 'listPage: bad cursor' } }, true).length > 0, '检查器放过了不点名的失效消息')
    d2.dispose()
  }

  // ── 四、真实后端模块探针：GitLab / 本地 Markdown 走到哪一步算哪一步 ──
  {
    for (const rb of [{ id: 'gitlab', mod: gitlabBackend }, { id: 'markdown', mod: markdownModule }]) {
      const regReal = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
      const d = regReal.register(rb.mod)
      const r = await regReal.get(rb.id).listPage(ref(rb.id), { state: 'closed' }, { cursor: '', limit: 50 }, ctx)
      await assert('真实 ' + rb.id + ' 后端：要么给一页合规数据、要么诚实说做不到', pageProbeCheck(r).length === 0, pageProbeCheck(r).join('；') || JSON.stringify(r).slice(0, 200))
      d.dispose()
    }
  }

  // ── 五、真实 GitHub 后端：给一个脚本化的 gh，逐条验那四件事 ──
  {
    const thinNode = { number: 42, title: '一张已关闭的票', state: 'CLOSED', url: 'https://example/42', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-02-03T00:00:00Z', labels: { nodes: [{ name: 'bug', color: 'ff0000' }] }, assignees: { nodes: [{ login: 'someone' }] }, author: { login: 'author' } }
    const goodPage = (pageInfo, total) => ({ data: { repository: { issues: { totalCount: total, nodes: [thinNode], pageInfo: pageInfo } } } })
    let lastArgs = null
    const mkScriptedGh = (payload, opts) => async (cmd, args) => {
      lastArgs = (args || []).join(' ')
      if (opts && opts.fail) return { code: 1, stdout: '', stderr: opts.fail }
      return { code: 0, stdout: typeof payload === 'string' ? payload : JSON.stringify(payload), stderr: '' }
    }
    const probeCtx = (ghPayload, opts) => ({ cwd: '/ws/fake', platform: { resolveExecutable: async (n) => (n === 'gh' ? 'gh' : null) }, exec: mkScriptedGh(ghPayload, opts), isEnabled: () => false, logEvent: () => {} })
    const regGh = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
    const dGh = regGh.register(githubModule)
    const gh = regGh.get('github')

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

    await gh.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 999 }, probeCtx(goodPage({ hasNextPage: false, endCursor: null }, 649)))
    await assert('limit 超上限按上限处理（999 → 200，不报错）', /first=200/.test(lastArgs), lastArgs.slice(0, 160))
    await gh.listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 0 }, probeCtx(goodPage({ hasNextPage: false, endCursor: null }, 649)))
    await assert('limit 不合法按缺省 50 处理', /first=50/.test(lastArgs), lastArgs.slice(0, 160))

    const withLabels = await gh.listPage(ref('github'), { state: 'closed', labels: ['bug', 'bug', ' '] }, { cursor: '', limit: 50 }, probeCtx(goodPage({ hasNextPage: false, endCursor: null }, 649)))
    await assert('labels 去重去空白后原样交给后端（filterBy）', withLabels.ok && /labels\[\]=bug/.test(lastArgs) && (lastArgs.match(/labels\[\]=/g) || []).length === 1, lastArgs.slice(0, 220))

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
    const r = await reg.get('page-guessing-fake').listPage(ref('github'), { state: 'closed' }, { cursor: '', limit: 50 }, ctx)
    await assert('已知边界：形状合规的「猜出来的总数」靠形状检查器逮不住（所以责任在后端自报失败）', pageShapeCheck(r).length === 0, pageShapeCheck(r).join('；'))
    d.dispose()
  }

  return out
}

export default { name: 'listPage', run }
