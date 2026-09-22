/**
 * tests/verify-691-map-subissues.js — 「地图子票拉全 · 已关闭地图不进首屏」门禁（#691 阶段 3）。
 *
 * 这张票要的是三件事，这一段逐件断：
 *   一、**拉全**：GitHub 的 listSubIssues 按页翻到底，用连接上的 totalCount 核对「拉到的张数 == 总数」，
 *       对不上就把差额（missing）带回来；撞到 1000 张硬上限时 capped 为真、也带回来。
 *       全程用脚本化的 gh（不打真网、不碰真仓库），只断「它答应了什么就做到什么」，不锁查询语句怎么写。
 *   二、**已关闭地图不进首屏**：宿主编排 composeSnapshot 组装出来的快照里，已关闭的地图只有容器行、
 *       不带子票；而那些子票**也不许**从「未挂图的票」那条路漏回首屏。开放地图的子票一行不少。
 *   三、**界面把该说的话说出来**：地图详情头部那一行（取数中／取不到／本图 N 张（已关闭 M 张）／
 *       只加载了前 1000 张／还差 x 张）与中英词条都在；列表里已关闭的地图行不画进度环。
 *
 * 运行：node tests/verify-691-map-subissues.js
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { listSubIssues } from '../src/host/tracker/backends/github/sub-issues.js'
import { createSnapshotComposer } from '../src/host/tracker/snapshot.js'
import { createMapTickets } from '../src/host/mapTickets.js'
import { createMapBody } from '../src/host/mapBody.js'
import { createTicketGrouping } from '../src/host/ticketGrouping.js'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// ── 一、GitHub 侧：翻页拉到底 + 总数核对 + 硬上限 ──────────────────────────────
function mkCtx(pages, opts = {}) {
  let page = 0
  const asked = []
  const exec = async (cmd, args) => {
    const a = (args || []).join(' ')
    asked.push(a)
    if (opts.failFirst && page === 0) { page++; return { code: 1, stdout: '', stderr: 'HTTP 502' } }
    const p = pages[Math.min(page, pages.length - 1)]
    page++
    if (typeof p === 'string') return { code: 0, stdout: p, stderr: '' }
    return { code: 0, stdout: JSON.stringify(p), stderr: '' }
  }
  return { asked, ctx: { cwd: '/ws/fake', platform: { resolveExecutable: async (n) => (n === 'gh' ? 'gh' : null) }, exec, isEnabled: () => false, logEvent: () => {} } }
}
const row = (n) => ({ number: n, title: 't' + n, state: 'OPEN', body: '', url: 'u', createdAt: 'c', updatedAt: 'u', closedAt: null, author: null, assignees: { nodes: [] }, labels: { nodes: [] }, parent: { number: 692 }, blockedBy: { nodes: [] } })
const pageOf = (from, count, total, hasNext, endCursor) => ({ data: { repository: { issue: { number: 692, subIssues: { totalCount: total, nodes: Array.from({ length: count }, (_, i) => row(from + i)), pageInfo: { hasNextPage: hasNext, endCursor: endCursor || null } } } } } })
const REPO = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }

{
  // 两页：第一页 100 张还要下一页，第二页 50 张到底；总数 150 —— 拉到的张数应与总数一致、差额为 0。
  const h = mkCtx([pageOf(1, 100, 150, true, 'CUR1'), pageOf(101, 50, 150, false)])
  const r = await listSubIssues(REPO, '692', {}, h.ctx)
  check(r.ok === true && r.data.items.length === 150 && r.data.total === 150 && r.data.missing === 0 && r.data.capped === false,
    '一.1 两页拉到底：拉到的张数等于总数（实得 ' + JSON.stringify({ ok: r.ok, n: r.data && r.data.items.length, total: r.data && r.data.total, missing: r.data && r.data.missing, capped: r.data && r.data.capped }) + '）')
  check(h.asked.length === 2 && /after=CUR1/.test(h.asked[1]), '一.2 第二页带上了第一页给的游标（实得 ' + h.asked.length + ' 次调用）')
}
{
  // 总数说 160，实际只拉回 150 —— 差额必须被说出来（不许静默少几条）。
  const h = mkCtx([pageOf(1, 100, 160, true, 'CUR1'), pageOf(101, 50, 160, false)])
  const r = await listSubIssues(REPO, '692', {}, h.ctx)
  check(r.ok === true && r.data.missing === 10, '一.3 与 totalCount 对不上：差额 10 张被带回来（实得 missing=' + (r.data && r.data.missing) + '）')
}
{
  // 永远还有下一页 —— 到 1000 张硬上限就停，并把「被截断过」这个事实带回来。
  const endless = pageOf(1, 100, 5000, true, 'CUR')
  const h = mkCtx([endless])
  const r = await listSubIssues(REPO, '692', {}, h.ctx)
  check(r.ok === true && r.data.capped === true && r.data.items.length === 1000 && h.asked.length === 10,
    '一.4 撞到 1000 张硬上限就停（实得 ' + JSON.stringify({ capped: r.data && r.data.capped, n: r.data && r.data.items.length, 调用: h.asked.length }) + '）')
  check(r.data.missing === 0, '一.5 被上限截断时不算「差额」（两件事分开说：capped 说截断，missing 说对不上）')
}
{
  // 坏响应：整条路必须诚实失败，不许把半份数据当成拉全了。
  const h1 = mkCtx([{ errors: [{ message: 'Something went wrong' }] }])
  const r1 = await listSubIssues(REPO, '692', {}, h1.ctx)
  check(r1.ok === false && r1.error && r1.error.kind, '一.6 回包带 errors → 整体失败（实得 ' + JSON.stringify(r1) + '）')
  const h2 = mkCtx(['{ not json'])
  const r2 = await listSubIssues(REPO, '692', {}, h2.ctx)
  check(r2.ok === false && r2.error.kind === 'parse', '一.7 坏 JSON → 解析档失败（实得 ' + JSON.stringify(r2.error) + '）')
  const h3 = mkCtx([{ data: { repository: { issue: null } } }])
  const r3 = await listSubIssues(REPO, '692', {}, h3.ctx)
  check(r3.ok === false && r3.error.kind === 'not-found', '一.8 地图没找到 → 找不到档失败（实得 ' + JSON.stringify(r3.error) + '）')
  const h4 = mkCtx([], { failFirst: true })
  const r4 = await listSubIssues(REPO, '692', {}, h4.ctx)
  check(r4.ok === false, '一.9 第一页请求失败 → 整体失败（不许回半份）')
  const r5 = await listSubIssues(REPO, 'not-a-number', {}, mkCtx([pageOf(1, 1, 1, false)]).ctx)
  check(r5.ok === false && r5.error.kind === 'parse', '一.10 地图编号不是数字 → 解析档失败（GitHub 侧只认数字）')
}

// ── 二、宿主编排：已关闭地图不带子票，且它的子票不从 issues 漏回首屏 ──────────────
{
  const mkIssue = (key, state, parentKey, type) => ({ key: String(key), type: type || 'issue', state: state, title: 't' + key, body: '', url: '', parentKey: parentKey === undefined ? null : parentKey, updatedAt: '2026-01-01', isPullRequest: false })
  const all = [
    mkIssue(600, 'CLOSED', null, 'map'), // 已关闭的地图（容器行）
    mkIssue(601, 'CLOSED', '600'), mkIssue(602, 'CLOSED', '600'), mkIssue(603, 'OPEN', '600'), // 它的三张子票
    mkIssue(700, 'OPEN', null, 'map'), // 开放的地图
    mkIssue(701, 'OPEN', '700'), mkIssue(702, 'CLOSED', '700'), // 它的两张子票
    mkIssue(800, 'OPEN', null), // 一张没挂图的票
  ]
  const fakeTracker = { list: async () => ({ ok: true, data: all }), counts: async () => ({ ok: true, data: { open: 4, closed: 4, total: 8 } }) }
  const composer = createSnapshotComposer({ get: (id) => (id === 'fake' ? fakeTracker : undefined) }, { snapshotTtl: 1 })
  const res = await composer.composeSnapshot('fake', { backend: 'fake', refId: 'r', name: 'r', url: '' }, {}, { force: true })
  const snap = res.snapshot
  const closedMap = snap.maps.find((m) => m.key === '600')
  const openMap = snap.maps.find((m) => m.key === '700')
  check(closedMap && Array.isArray(closedMap.tickets) && closedMap.tickets.length === 0, '二.1 已关闭的地图在快照里只有容器行、不带子票（实得 ' + (closedMap && closedMap.tickets && closedMap.tickets.length) + ' 张）')
  const leaked = snap.issues.filter((i) => ['601', '602', '603'].includes(i.key))
  check(leaked.length === 0, '二.2 被挡在外面的那三张子票没有从「未挂图的票」漏回首屏（实得 ' + leaked.length + ' 张）')
  check(openMap && openMap.tickets.length === 2, '二.3 开放地图的子票一行不少（实得 ' + (openMap && openMap.tickets.length) + ' 张）')
  check(snap.issues.length === 1 && snap.issues[0].key === '800', '二.4 真正没挂图的票照旧在 issues 里（实得 ' + JSON.stringify(snap.issues.map((i) => i.key)) + '）')
}

// ── 三、宿主电话：正文只用来解析进度，剥掉；编号与状态补齐给界面 ─────────────────
{
  const mb = createMapBody()
  const grp = createTicketGrouping()
  const fakeTracker = {
    listSubIssues: async () => ({ ok: true, data: { items: [
      { key: '611', state: 'open', body: '## 进度：60%\n\n正文不该发给界面', url: '', assignees: [{ login: 'alice' }], blockedBy: [] },
      { key: '612', state: 'closed', body: '没有进度块', url: '', assignees: [], blockedBy: [{ key: '611' }] },
    ], total: 2, fetched: 2, capped: false, missing: 0 } }),
  }
  const phone = createMapTickets({
    canonicalKey: async (c) => c || '/ws/fake', selectEarly: async () => ({ backendId: 'fake' }), isComposerSelection: () => true,
    getTrackerRegistry: async () => ({ get: () => fakeTracker, describe: () => ({ backend: 'fake', refId: 'r', name: 'r', url: '' }) }),
    getPlatform: async () => ({}), ctx: { get: () => undefined }, DEFAULT_CWD: '/ws/fake', logCtx: null,
    groupTickets: grp.groupTickets, getMapBody: async () => mb, detectionExec: () => {},
  })
  const r = await phone.handleMapTickets({ cwd: '/ws/fake', key: '692' })
  check(r.ok === true && r.items.length === 2, '三.1 电话把后端那两行交回界面（实得 ' + JSON.stringify(r.ok) + '）')
  check(r.items[0].progress === 60 && r.items[0].body === undefined, '三.2 正文里的进度解析成数字、正文本身剥掉（实得 progress=' + JSON.stringify(r.items[0].progress) + ' body=' + JSON.stringify(r.items[0].body) + '）')
  check(r.items[1].progress === null, '三.3 没有进度块 → null（界面画「—」，不假装 0%）')
  check(r.items[0].number === 611 && r.items[0].key === '611' && r.items[0].state === 'OPEN', '三.4 编号补上、状态转大写（客户端多处按大写比较）')
  check(r.items[0].claimedBy === 'alice' && r.items[1].claimedBy === '', '三.5 认领人从指派人里取第一位（没有就空串）')
  check(r.stats && r.stats.total === 2 && r.stats.closed === 1, '三.5b 分层与统计由宿主算好带回（实得 ' + JSON.stringify(r.stats && { total: r.stats.total, closed: r.stats.closed }) + '）')
  const unsupportedTracker = {}
  const phone2 = createMapTickets({
    canonicalKey: async (c) => c || '/ws/fake', selectEarly: async () => ({ backendId: 'fake' }), isComposerSelection: () => true,
    getTrackerRegistry: async () => ({ get: () => unsupportedTracker, describe: () => ({ backend: 'fake', refId: 'r', name: 'r', url: '' }) }),
    getPlatform: async () => ({}), ctx: { get: () => undefined }, DEFAULT_CWD: '/ws/fake', logCtx: null,
    groupTickets: grp.groupTickets, getMapBody: async () => mb, detectionExec: () => {},
  })
  const r2 = await phone2.handleMapTickets({ cwd: '/ws/fake', key: '692' })
  check(r2.ok === false && r2.error.kind === 'unsupported', '三.6 后端没实现这条读路径 → unsupported（界面据此照旧画快照那份）')
}

// ── 四、界面：那一行话都在，已关闭的地图行不画环；中英词条成对 ────────────────────
{
  const head = src('src/client/views/MapDetailHead.js')
  for (const key of ['map.subCount', 'map.subCountLoading', 'map.subCountFail', 'map.subCountRetry', 'map.subCountCapped', 'map.subCountShort']) {
    check(head.indexOf("tr('" + key + "'") >= 0, '四.1 地图详情头部用了词条 ' + key)
  }
  check(head.indexOf('mt.capped') >= 0 && head.indexOf('mt.missing') >= 0, '四.2 上限截断与差额都各自说了一句')
  check(head.indexOf("'unsupported'") >= 0, '四.3 后端说「做不到」时不多说话（按真实返回退化，不做能力表）')
  const detail = src('src/client/views/MapDetail.js')
  check(detail.indexOf('fetchMapTickets') >= 0 && detail.indexOf('MapDetailHead') >= 0, '四.4 地图详情打开时触发按需取数，并用上了拆出来的头部')
  const listRow = src('src/client/views/ListTabRow.js')
  check(/mapClosed\s*=\s*!!\(isMap&&mapObj&&String\(mapObj\.state\|\|''\)\.toUpperCase\(\)==='CLOSED'\)/.test(listRow.replace(/\r/g, '')), '四.5 列表行先判「这张地图是不是已关闭」')
  check(listRow.indexOf('&& !mapClosed) ? ringOf(') >= 0, '四.6 已关闭的地图行不画进度环')
  const locale = src('src/client/kernel/locale-flow.js')
  for (const key of ['map.subCount', 'map.subCountLoading', 'map.subCountFail', 'map.subCountRetry', 'map.subCountCapped', 'map.subCountShort']) {
    const hits = (locale.match(new RegExp("'" + key.replace('.', '\\.') + "'", 'g')) || []).length
    check(hits >= 2, '四.7 词条 ' + key + ' 中英各一份（实得 ' + hits + ' 处）')
  }
  const apiIo = src('src/client/kernel/api-io.js')
  check(apiIo.indexOf("host.call('wf.mapTickets'") >= 0 && apiIo.indexOf("method: 'wf.mapTickets'") >= 0, '四.8 客户端包装：调用点与日志点都在（电话名写在 method）')
  const hostIdx = src('src/host/index.js')
  check(hostIdx.indexOf("harness.handle('wf.mapTickets'") >= 0, '四.9 宿主注册了这条电话')
  const hostPhone = src('src/host/mapTickets.js')
  check(hostPhone.indexOf("phoneLog('wf.mapTickets'") >= 0 && hostPhone.indexOf("'host.call'") >= 0 && hostPhone.indexOf("'host.call.fail'") >= 0, '四.10 电话体沿用既有两个日志事件（不新增事件名）')
}

console.log(failed ? '\n存在失败 — verify-691-map-subissues 未通过' : '\n全部通过 — 地图子票拉全与已关闭地图不进首屏的判据都在')
process.exit(failed ? 1 : 0)
