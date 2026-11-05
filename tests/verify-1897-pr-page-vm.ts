/**
 * tests/verify-1897-pr-page-vm.ts —— 拉取请求页接到视图模型（#1897，规格 #1885 S6）
 *
 * 守什么（票面四条验收逐条落在这里）：
 *   A 列表与三态都来自视图模型：纯选择器 deckPrListOf 把投影里的拉取请求行收成切片，每行带
 *     stateKind（打开 / 已关闭 / 已合并），判据仍是全仓唯一那份 prStateKind（views/shared/stateKind.ts）；
 *     排序、四个数、版本、空投影的「不知道」都在这一层定下来，视图只照着画。
 *   B 生产接线：deckViewOf 给出的 prList 切片来自同一份投影帧；同一版本再取一次连对象引用都不换，
 *     换版本才重算；没有投影时如实说「不知道」，不编一份空列表。
 *   C 点开一行只更新选中态：一次「选中」命令之后宿主电话调用次数为 0，reading 切片变、prList /
 *     projection / rows / counts 的引用不变；选中结果同时镜像回会话存储并交给导航入口。
 *   D 同一版本下页签与详情一致：同一份投影同时喂页签切片与详情切片，三张 PR（打开 / 已关闭 / 已合并）
 *     逐项比对完全一致；详情里还写着旧状态时也以投影行为准。
 *   E 视图层不再直接调宿主电话：本票迁移过的两个视图文件（PrTab / IssueDetail）静态判据 + 一条反证；
 *     并用真 React 渲染页签，确认三态是从切片画出来的（不是页面自己判的）。
 *
 * 为什么能这么测：视图模型与选择器都是纯数据层（不挂浏览器、不发电话）；C/D 两组的宿主电话用假宿主
 * 驱动，页面那一组用 react-dom/server 静态渲染。这就是规格「视图状态」那条接缝。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1897-pr-page-vm.ts
 */
// 门禁归属: src/client/kernel/deck-pr-list.ts
// 门禁归属: src/client/kernel/deck-view-model.ts
// 门禁归属: src/client/kernel/deck-view-binding.ts
// 门禁归属: src/client/kernel/deck-issue-detail.ts
// 门禁归属: src/client/views/PrTab.ts
// 门禁归属: src/client/views/IssueDetail.ts

import { printGateResult } from './lib/gate-result.ts'
import { sourceText } from './lib/source-text.ts'

const GATE = 'verify-1897-pr-page-vm'

let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

/** 去掉注释：注释里提到旧写法不算数。 */
function codeNoComments(source: string): string {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 再去掉字符串内容：只按代码形状判「这句还在不在」，文案里的名字不算调用。 */
function codeOnly(source: string): string {
  return codeNoComments(source)
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

/** 视图层自己发取数或直接动宿主、动导航的形状：host.call( / rpcCall( / .call('wf.…) / loadSnapshot( / setActiveIssue(。 */
function judgeDirectFetch(source: string): string[] {
  const code = codeOnly(source)
  const bare = codeNoComments(source)
  const hits: string[] = []
  if (/\bhost\s*\.\s*call\s*\(/.test(code)) hits.push('host.call(')
  if (/\brpcCall\s*\(/.test(code)) hits.push('rpcCall(')
  // 这一条要留着字符串里的 wf. 前缀才认得出（代码判据把那一段换成了空串），所以在只去注释的文本上判一次。
  if (/\.\s*call\s*\(\s*['"]wf\./.test(bare)) hits.push(".call('wf.…)")
  if (/\bloadSnapshot\s*\(/.test(code)) hits.push('loadSnapshot(')
  if (/\bsetActiveIssue\s*\(/.test(code)) hits.push('setActiveIssue(')
  return hits
}

/** 一张拉取请求的投影行（界面形状：state 小写，合并时间 ISO 串）。 */
function prRow(n: number, extra?: any): any {
  return Object.assign({
    key: String(n), number: n, effortId: 'default', type: 'issue', title: 'PR #' + n,
    state: 'open', mergedAt: undefined, isPullRequest: true, labels: [], assignees: [],
    author: { login: 'alice' }, updatedAt: '2026-11-01T00:00:00.000Z',
  }, extra || {})
}

/** 一份投影（宿主组装器给的形状；这里只留视图模型真正读的几格）。 */
function projectionOf(rows: any[], extra?: any): any {
  return Object.assign({ generatedMs: 1761900000000, issues: rows, maps: [], labels: [], thinTickets: [], workRouteTable: null }, extra || {})
}

function frameOf(version: number, projection: any): any {
  return { key: 'ws|' + version, version: version, projection: projection, counts: { total: 3 }, readout: { version: version } }
}

/** 详情回包形状：三张 PR 的详情都带同样的状态与合并时间，模拟库投影出来的那一份。 */
function detailOf(n: number, extra?: any): any {
  return Object.assign({
    number: n, effortId: 'default', title: 'PR #' + n, state: 'OPEN',
    body: 'PR ' + n + ' 的正文',
    comments: { nodes: [], pageInfo: { hasNextPage: false }, totalCount: 0 },
    labels: { nodes: [] }, assignees: { nodes: [] }, blockedBy: { nodes: [] },
    updatedAt: '2026-11-01T00:00:00Z',
  }, extra || {})
}

async function main(): Promise<void> {
  const modelModule: any = await import('../src/client/kernel/deck-view-model.ts')
  const { createDeckView, deckReadingOf } = modelModule
  const stateKind: any = await import('../src/client/views/shared/stateKind.ts')
  const prStateKind = stateKind.prStateKind

  // ------------------------------------------------------------------ A 纯选择器：列表与三态都由它给
  {
    const { deckPrListOf } = await import('../src/client/kernel/deck-pr-list.ts')
    const rows = [
      prRow(12, { title: '较旧的一行', updatedAt: '2026-11-01T00:00:00.000Z' }),
      prRow(9, { title: '新的一行', updatedAt: '2026-11-03T00:00:00.000Z' }),
      prRow(5, { title: '同一时间的另一行', updatedAt: '2026-11-01T00:00:00.000Z' }),
      { key: '30', number: 30, effortId: 'default', title: '不是 PR', state: 'open', isPullRequest: false },
      { key: '31', number: 31, effortId: 'default', title: '不知道是不是 PR', state: 'open' },
    ]
    const slice: any = deckPrListOf({ projection: projectionOf(rows), version: 7, rows: rows, stateKindOf: prStateKind })
    check(!!slice && slice.rows.length === 3 && slice.rows.every(function (r: any): boolean { return r.isPullRequest === true }),
      'A1 切片只收投影里 isPullRequest 为真的行（「不是 PR」「不知道是不是 PR」都不进这一页）', slice && slice.rows.map(function (r: any): any { return r.key }))
    const closed = prRow(13, { state: 'closed' })
    const merged = prRow(14, { state: 'closed', mergedAt: '2026-11-02T00:00:00.000Z' })
    const three: any = deckPrListOf({ projection: projectionOf([prRow(12), closed, merged]), version: 7, rows: [prRow(12), closed, merged], stateKindOf: prStateKind })
    const kinds = three.rows.map(function (r: any): string { return r.stateKind })
    check(kinds.indexOf('open') >= 0 && kinds.indexOf('closed') >= 0 && kinds.indexOf('merged') >= 0,
      'A2 打开 / 已关闭 / 已合并三种状态各带在行上（判据是全仓唯一那份 prStateKind）', kinds)
    const ordered: any = deckPrListOf({
      projection: projectionOf([prRow(12, { updatedAt: '2026-11-01T00:00:00.000Z' }), prRow(13, { updatedAt: '2026-11-03T00:00:00.000Z' }), prRow(14, { updatedAt: '2026-11-01T00:00:00.000Z' })]),
      version: 8,
      rows: [prRow(12, { updatedAt: '2026-11-01T00:00:00.000Z' }), prRow(13, { updatedAt: '2026-11-03T00:00:00.000Z' }), prRow(14, { updatedAt: '2026-11-01T00:00:00.000Z' })],
      stateKindOf: prStateKind,
    })
    const order = ordered.rows.map(function (r: any): string { return String(r.number) })
    check(JSON.stringify(order) === JSON.stringify(['13', '12', '14']),
      'A3 行按更新时间倒序、同一时间按票号升序（与改造前的页签顺序一致）', order)
    check(three.total === 3 && three.open === 1 && three.closed === 1 && three.merged === 1,
      'A4 四个数（总数 / 打开 / 已关闭 / 已合并）逐项对得上', { total: three.total, open: three.open, closed: three.closed, merged: three.merged })
    const frozen = JSON.stringify(deckPrListOf({ projection: projectionOf([prRow(1), closed]), version: 3, rows: [prRow(1), closed], stateKindOf: prStateKind }))
    const again = JSON.stringify(deckPrListOf({ projection: projectionOf([prRow(1), closed]), version: 3, rows: [prRow(1), closed], stateKindOf: prStateKind }))
    check(frozen === again, 'A5 同一份输入连续两次结果逐字相同（纯选择器，不读时钟）')
    const candidate: any = prRow(99)
    deckPrListOf({ projection: projectionOf([candidate]), version: 1, rows: [candidate], stateKindOf: prStateKind })
    check(!Object.prototype.hasOwnProperty.call(candidate, 'stateKind'),
      'A6 选择器不改调用方交进来的行（stateKind 是切片行上的，不写回投影）')
    const none: any = deckPrListOf({ projection: null, version: null, rows: [], stateKindOf: prStateKind })
    check(!!none && none.source === 'none' && none.rows.length === 0 && none.version === null,
      'A7 没有投影时说「不知道」（source=none、没有版本），不编一个空版本', none && { source: none.source, version: none.version })
    const empty: any = deckPrListOf({ projection: projectionOf([]), version: 4, rows: [], stateKindOf: prStateKind })
    check(!!empty && empty.source === 'projection' && empty.total === 0 && empty.version === 4,
      'A8 投影在、一张 PR 都没有时是「确认没有」（source=projection、总数 0），与「不知道」分得开', empty && { source: empty.source, total: empty.total })
    check(three.version === 7 && three.source === 'projection',
      'A9 切片带出投影的库版本（同一版本才能比状态）', { version: three.version, source: three.source })
    const multi: any = deckPrListOf({ projection: projectionOf([prRow(7, { effortId: 'ui' }), prRow(7, { effortId: 'api' })]), version: 2, rows: [prRow(7, { effortId: 'ui' }), prRow(7, { effortId: 'api' })], stateKindOf: prStateKind })
    check(multi.rows.length === 2 && multi.rows[0].effortId !== multi.rows[1].effortId,
      'A10 行保留工作单元（同号的两种票各留一行，不被同号吃成一行）', multi.rows.map(function (r: any): string { return r.effortId }))
  }

  // ------------------------------------------------------------------ 生产接线的世界（B/C/D 共用）
  const storeMap: Record<string, string> = {}
  ;(globalThis as any).localStorage = {
    getItem: function (k: string) { return Object.prototype.hasOwnProperty.call(storeMap, k) ? storeMap[k] : null },
    setItem: function (k: string, v: string) { storeMap[k] = String(v) },
    removeItem: function (k: string) { delete storeMap[k] },
  }
  ;(globalThis as any).tr = function (key: any): string { return String(key) }
  ;(globalThis as any).log = function (): void {}
  ;(globalThis as any).idOfParts = function (a: any, b: any): string { return String(a) + '\u0000' + String(b) }
  ;(globalThis as any).createDeckView = createDeckView
  ;(globalThis as any).deckFiltersOf = modelModule.deckFiltersOf
  ;(globalThis as any).deckReadingOf = deckReadingOf
  ;(globalThis as any).prStateKind = prStateKind
  ;(globalThis as any).prIssuesOf = function (st: any): any[] {
    const snap: any = (st && st.snapshot) || null
    const out: any[] = []
    if (!snap) return out
    if (Array.isArray(snap.issues)) for (const x of snap.issues) { if (x && x.isPullRequest === true) out.push(x) }
    if (Array.isArray(snap.maps)) for (const m of snap.maps) { if (m && Array.isArray(m.tickets)) for (const x of m.tickets) { if (x && x.isPullRequest === true) out.push(x) } }
    return out
  }
  const detailProjection: any = await import('../src/client/views/shared/detailProjection.ts')
  const { detailViewFor, snapshotRowFor } = detailProjection
  ;(globalThis as any).detailViewFor = detailViewFor
  ;(globalThis as any).snapshotRowFor = snapshotRowFor
  ;(globalThis as any).projectionUsesSnapshot = function (): boolean { return true }
  const prListModule: any = await import('../src/client/kernel/deck-pr-list.ts')
  ;(globalThis as any).deckPrPortOf = prListModule.deckPrPortOf
  const { deckIssueDetailOf } = await import('../src/client/kernel/deck-issue-detail.ts')
  ;(globalThis as any).deckIssueDetailOf = deckIssueDetailOf

  const rowOpen = prRow(12, { state: 'open', updatedAt: '2026-11-03T00:00:00.000Z' })
  const rowClosed = prRow(13, { state: 'closed', updatedAt: '2026-11-02T00:00:00.000Z' })
  const rowMerged = prRow(14, { state: 'closed', mergedAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' })
  const projection = projectionOf([rowOpen, rowClosed, rowMerged])
  let version: number | null = 21
  const phones: any[] = []
  const host = { call: function (method: string, args: any): any { phones.push({ method: method, args: args }); return Promise.resolve({ ok: true }) } }
  const navs: any[] = []
  ;(globalThis as any).setActiveIssue = function (st: any, n: any, eff: any): void {
    navs.push({ n: n, eff: eff })
    st.activeIssue = n
    st.activeEffortId = (eff === undefined || eff === null) ? '' : String(eff)
  }
  let reloads = 0
  ;(globalThis as any).loadSnapshot = function (): void { reloads += 1 }
  ;(globalThis as any).host = host
  const binding: any = await import('../src/client/kernel/deck-view-binding.ts')
  const scope: any = {
    host: host,
    peekNav: function (): any { return null },
    detailViewFor: detailViewFor,
    snapshotRowFor: snapshotRowFor,
    projectionUsesSnapshot: function (): boolean { return true },
    fetchIssueComments: null,
    idOfParts: (globalThis as any).idOfParts,
    ticketRowsOf: function (a: any): any[] { return a || [] },
    issuePageRowsOf: function (): any[] { return [] },
    isOccupied: function (): boolean { return false },
    effortOf: function (r: any): string { return String((r && r.effortId) || '') },
    occCount: function (): number { return 0 },
    deckCountsOf: function (): any { return null },
    bugCount: function (): number { return 0 },
    triageCount: function (): number { return 0 },
    kpiCountsOf: function (): any { return { takeable: 0, closed: 0, unknown: false, pending: false, atMs: 0, source: 'local-enumeration' } },
    listPrefs: { stateFilter: 'all', sortKey: 'number', sortDir: 'asc' },
    saveListPrefs: function (): void {},
    wsKeyOf: function (k: any): string { return String(k || '') },
    snapshotVersionBookOf: function (): any { return { version: version, seenAtMs: 0 } },
  }
  const st: any = {
    cwd: 'D:/ws/pr', snapshot: projection, sessionId: 's1', detailSeenAt: {}, issueCache: {},
    stateFilter: 'all', lblFilters: [], effFilters: [], sortKey: 'number', sortDir: 'asc', expLabels: false,
    activeIssue: null, activeEffortId: '', navStack: [], cmtDraft: '',
    issueDetail: null, issueMode: 'idle', issueError: null,
  }
  binding.deckViewForgetFrames()
  const view: any = binding.deckViewOf(st, scope)

  // ------------------------------------------------------------------ B 生产接线
  {
    const slice: any = view.slice('prList')
    check(!!slice && slice.rows.length === 3 && slice.version === 21,
      'B1 生产接线按投影帧给出拉取请求切片（三张 PR、版本就是库版本）', slice && { n: slice.rows.length, version: slice.version })
    const kinds = slice.rows.map(function (r: any): string { return r.stateKind })
    check(JSON.stringify(kinds) === JSON.stringify(['open', 'closed', 'merged']),
      'B2 三态逐张对得上（打开 / 已关闭 / 已合并），顺序与更新时间一致', kinds)
    const before = slice
    view.adopt({ frame: binding.deckViewOf(st, scope).frame(), filters: st, reading: { activeIssue: null } })
    binding.deckViewOf(st, scope)
    check(view.slice('prList') === before && view.versionOf('prList') === 1,
      'B3 同一版本再取一次：prList 连对象引用都不换、切片版本不动', { same: view.slice('prList') === before, ver: view.versionOf('prList') })
    version = 22
    st.snapshot = projectionOf([rowOpen, prRow(15, { state: 'closed' })])
    binding.deckViewOf(st, scope)
    const next: any = view.slice('prList')
    check(next !== before && next.rows.length === 2 && next.version === 22,
      'B4 换到新版本才重算：切片换成新投影里的两行', next && { n: next.rows.length, version: next.version })
    version = 23
    st.snapshot = null
    binding.deckViewForgetFrames()
    const emptyWorld: any = binding.deckViewOf(st, scope)
    const none: any = emptyWorld.slice('prList')
    check(!!none && none.source === 'none' && none.rows.length === 0,
      'B5 没有投影时切片说「不知道」（不拿一份空列表冒充「确认没有」）', none && { source: none.source })
    st.snapshot = projection
    version = 21
    binding.deckViewForgetFrames()
  }

  // ------------------------------------------------------------------ C 点开一行只更新选中态
  {
    binding.deckViewForgetFrames()
    st.activeIssue = null
    st.activeEffortId = ''
    st.issueDetail = null
    st.issueMode = 'idle'
    phones.length = 0
    navs.length = 0
    reloads = 0
    const v: any = binding.deckViewOf(st, scope)
    const listBefore = v.slice('prList')
    const projBefore = v.slice('projection')
    const rowsBefore = v.slice('rows')
    const countsBefore = v.slice('counts')
    const readingBefore = v.slice('reading')
    const prVer = v.versionOf('prList')
    const readingVer = v.versionOf('reading')
    const result: any = binding.deckViewCommand(st, 'openIssue', { number: 14, effortId: 'default' }, scope)
    check(phones.length === 0,
      'C1 一次选中命令之后宿主电话调用次数为 0（点开一行不取数）', phones.map(function (p: any): string { return p.method }))
    const reading: any = v.slice('reading')
    check(result.reading.activeIssue === 14 && result.reading.activeIssueEffort === 'default' && reading.activeIssue === 14 && reading.activeIssueEffort === 'default',
      'C2 选中切片变化：阅读态里的当前票就是点的那一行（连同工作单元）', reading && { n: reading.activeIssue, eff: reading.activeIssueEffort })
    check(v.slice('prList') === listBefore && v.slice('projection') === projBefore && v.slice('rows') === rowsBefore && v.slice('counts') === countsBefore,
      'C3 数据切片引用不变（prList / projection / rows / counts 一个都不重算）', {
        prList: v.slice('prList') === listBefore, projection: v.slice('projection') === projBefore,
        rows: v.slice('rows') === rowsBefore, counts: v.slice('counts') === countsBefore,
      })
    check(v.slice('reading') !== readingBefore && v.versionOf('reading') === readingVer + 1 && v.versionOf('prList') === prVer,
      'C4 只有阅读态这一片变了（prList 的切片版本一格都没动）', { reading: v.versionOf('reading'), prList: v.versionOf('prList') })
    check(navs.length === 1 && Number(navs[0].n) === 14 && String(navs[0].eff) === 'default',
      'C5 选中命令把票号与工作单元交给导航入口（点开一行才进详情）', navs)
    check(st.activeIssue === 14 && st.activeEffortId === 'default',
      'C6 会话存储上的镜像跟着改（Dock 按它换屏，不需要再取一次数）', { n: st.activeIssue, eff: st.activeEffortId })
    binding.deckViewCommand(st, 'openIssue', { number: 14, effortId: 'default' }, scope)
    check(v.versionOf('reading') === readingVer + 1 && v.slice('prList') === listBefore,
      'C7 再点同一行：选中态没变就不重算、不再通知（阅读态版本不动、列表也不重画）', { ver: v.versionOf('reading'), prList: v.versionOf('prList') })
    binding.deckViewCommand(st, 'retrySnapshot', null, scope)
    check(reloads === 1 && phones.length === 0,
      'C8 「重试」是一条视图模型命令：恰好喊一次重取，视图自己一条宿主电话都不打', { reloads: reloads, phones: phones.length })
    check(v.slice('prList') === listBefore && v.slice('counts') === countsBefore,
      'C9 重试与选中都不动列表与全局读数（要等新版本回来才换数据）')
  }

  // ------------------------------------------------------------------ D 同一版本下页签与详情一致
  {
    binding.deckViewForgetFrames()
    st.snapshot = projection
    version = 21
    st.activeIssue = null
    ;(globalThis as any).peekNav = function (): any { return null }
    const v: any = binding.deckViewOf(st, scope)
    const slice: any = v.slice('prList')
    const detailSt: any = {
      snapshot: projection, issueDetail: null, issueMode: 'idle', issueError: null,
      detailSeenAt: {}, issueCache: {},
    }
    function detailKindOf(row: any, issue: any): string {
      const dv: any = detailViewFor(Object.assign({}, detailSt, { issueDetail: issue, issueMode: 'real' }), Number(row.number), String(row.effortId || ''))
      const ds: any = deckIssueDetailOf({
        number: Number(row.number), effortId: String(row.effortId || ''),
        view: dv, row: row, comments: { loading: false, failCount: 0 },
      })
      return prStateKind({ state: ds.state, mergedAt: ds.mergedAt })
    }
    const tabKinds = slice.rows.map(function (r: any): string { return r.stateKind })
    const detailKinds = slice.rows.map(function (r: any): string { return detailKindOf(r, detailOf(Number(r.number), { mergedAt: r.mergedAt })) })
    check(JSON.stringify(tabKinds) === JSON.stringify(['open', 'closed', 'merged']) && JSON.stringify(detailKinds) === JSON.stringify(tabKinds),
      'D1 同一份投影下，三张 PR 的页签状态与详情页状态逐项相同（打开 / 已关闭 / 已合并）', { tab: tabKinds, detail: detailKinds })
    const staleKinds = slice.rows.map(function (r: any): string { return detailKindOf(r, detailOf(Number(r.number), { state: 'OPEN', mergedAt: r.mergedAt })) })
    check(JSON.stringify(staleKinds) === JSON.stringify(tabKinds),
      'D2 详情还写着 OPEN（旧数据）时三个状态照样与页签一致（状态只问投影行）', { tab: tabKinds, detail: staleKinds })
    const rowOfSlice = slice.rows[2]
    const sameRow = projection.issues.filter(function (r: any): boolean { return Number(r.number) === 14 })[0]
    check(rowOfSlice && sameRow && rowOfSlice.state === sameRow.state && rowOfSlice.mergedAt === sameRow.mergedAt,
      'D3 页签切片与详情切片读的是同一份投影行（状态与合并时间同源）', rowOfSlice && { state: rowOfSlice.state, mergedAt: rowOfSlice.mergedAt })
    const mergedDetail: any = deckIssueDetailOf({
      number: 14, effortId: 'default', row: rowMerged,
      view: detailViewFor(Object.assign({}, detailSt, { issueDetail: detailOf(14, { mergedAt: '2026-11-02T00:00:00.000Z' }), issueMode: 'real' }), 14, 'default'),
      comments: {},
    })
    check(!!mergedDetail && mergedDetail.mergedAt === rowMerged.mergedAt && mergedDetail.state === rowMerged.state,
      'D4 详情切片带出投影行上的合并时间（#1897 起详情与页签共用这一格）', mergedDetail && { mergedAt: mergedDetail.mergedAt, state: mergedDetail.state })
  }

  // ------------------------------------------------------------------ E 视图层静态 + 渲染
  {
    const prTab = sourceText('src/client/views/PrTab.ts')
    const issueDetail = sourceText('src/client/views/IssueDetail.ts')
    check(prTab.indexOf("useDeckViewSlice(st, 'prList')") >= 0,
      'E1 拉取请求页从视图模型的 prList 切片取列表与三态')
    check(prTab.indexOf("deckViewCommand(st, 'openIssue'") >= 0,
      'E2 点开一行走「选中」命令（openIssue），不再自己动列表或取数')
    check(prTab.indexOf("deckViewCommand(st, 'retrySnapshot'") >= 0 && codeOnly(prTab).indexOf('loadSnapshot') < 0,
      'E3 重试也走视图模型命令（retrySnapshot），页面代码里不再出现 loadSnapshot')
    check(prTab.indexOf('x.stateKind') >= 0 && issueDetail.indexOf('proj.mergedAt') >= 0,
      'E4 页签的三态读切片行上的 stateKind，详情的三态读切片带来的 mergedAt')
    const direct: any = {}
    for (const [rel, text] of [['src/client/views/PrTab.ts', prTab], ['src/client/views/IssueDetail.ts', issueDetail]]) {
      const hits = judgeDirectFetch(text)
      if (hits.length) direct[rel] = hits
    }
    check(Object.keys(direct).length === 0,
      'E5 两个迁移过的视图文件都不直连宿主、不自己发取数、不自己动导航（host.call( / rpcCall( / .call(wf.…) / loadSnapshot( / setActiveIssue(）', direct)
    const probes = [
      "export const x = function () { return host.call('wf.snapshot', {}) }",
      "const p = rpcCall('wf.copy', {})",
      "const q = bridge.call('wf.refresh', {})",
      'const r = function () { loadSnapshot(st, true) }',
      'const s = function () { setActiveIssue(st, 7) }',
    ]
    const caught = probes.map(function (p: string): number { return judgeDirectFetch(p).length })
    check(caught.every(function (n: number): boolean { return n >= 1 }),
      'E6 反证：五种「视图自己取数 / 自己动导航」的写法都会被这道静态判据当场抓住', caught)
    check(judgeDirectFetch("// 以前这里调过 loadSnapshot(st) 与 setActiveIssue(st, 7)").length === 0,
      'E7 注释里提到旧写法不算（判据只看代码形状）')
  }

  // ------------------------------------------------------------------ E8 真渲染：三态从切片画出来
  {
    const React: any = (await import('react')).default
    const { renderToStaticMarkup } = await import('react-dom/server')
    ;(globalThis as any).React = React
    ;(globalThis as any).Ic = function (props: any): any { return '[' + ((props && props.n) || '?') + ']' }
    ;(globalThis as any).prFilterForList = function (): any { return { isPullRequest: true } }
    ;(globalThis as any).buildColorOf = function (): any { return {} }
    ;(globalThis as any).hexA = function (): any { return null }
    ;(globalThis as any).darken = function (): any { return null }
    ;(globalThis as any).CONTAINER_ACCENT = { map: '#bc8cff' }
    ;(globalThis as any).MOTION = { inlineSpinnerMs: 700 }
    const { DswsCtx, createCx } = await import('../src/client/kernel/ctx.ts')
    ;(globalThis as any).DswsCtx = DswsCtx
    const services: any = {
      slots: { register: function (): any { return function (): void {} }, inject: function (_n: string, fn: any): void { try { fn() } catch (e) {} } },
      locale: { register: function (): any { return function (): void {} }, bind: function (): any { return (globalThis as any).tr } },
      timer: { timeout: function (fn: any, ms: any): any { return setTimeout(fn, ms) } },
    }
    const fakeStore: any = { snapshot: null, sessionId: 'test', tab: 'pr', cwd: 'D:/ws', issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false } }
    const fakeCx: any = createCx({
      ctx: { get: function (k: any): any { return services[k] }, effect: function (fn: any): any { const r = fn(); return typeof r === 'function' ? r : function (): void {} }, inject: function (_d: any, cb: any): any { cb({ get: function (k: any): any { return services[k] } }); return { dispose: function (): void {} } } },
      h: React.createElement,
      rdom: {},
      storeSvc: { shared: fakeStore, stores: {}, makeStore: function (): any { return fakeStore }, storeOf: function (): any { return fakeStore }, emit: function (): void {}, sub: function (): any { return function (): void {} }, useStore: function (): any { return fakeStore } },
      localeSvc: { register: function (): any { return function (): void {} }, bind: function (): any { return (globalThis as any).tr } },
      timer: services.timer,
      api: { call: async function (): Promise<any> { return { ok: true } }, inject: function (): void {}, copyText: async function (): Promise<void> {} },
      router: { open: function (): void {}, toggle: function (): void {} },
    } as any)
    const fakeSlice: any = {
      rows: [
        Object.assign({}, prRow(12, { title: 'PR #12（打开）' }), { stateKind: 'open' }),
        Object.assign({}, prRow(13, { title: 'PR #13（已关闭）', state: 'closed' }), { stateKind: 'closed' }),
        Object.assign({}, prRow(14, { title: 'PR #14（已合并）', state: 'closed', mergedAt: '2026-11-02T00:00:00.000Z' }), { stateKind: 'merged' }),
      ],
      total: 3, open: 1, closed: 1, merged: 1, version: 21, source: 'projection',
    }
    ;(globalThis as any).useDeckViewSlice = function (_st: any, name: string): any { return name === 'prList' ? fakeSlice : null }
    const { PrTab } = await import('../src/client/views/PrTab.ts')
    const html: string = renderToStaticMarkup(React.createElement(DswsCtx.Provider as any, { value: fakeCx }, React.createElement(PrTab as any, { st: { snapshot: null, selection: null, backendModules: [], snapMode: 'real' } })))
    check(html.indexOf('PR #12（打开）') >= 0 && html.indexOf('PR #13（已关闭）') >= 0 && html.indexOf('PR #14（已合并）') >= 0,
      'E8 页面把切片里的三行画出来（列表来自视图模型，哪怕 st.snapshot 是空的）', html.slice(0, 120))
    check((html.match(/>list\.state\.merged</g) || []).length === 1 && (html.match(/>list\.state\.closed</g) || []).length === 1 && (html.match(/>list\.state\.open</g) || []).length === 1,
      'E9 页面的三态就是切片行上的 stateKind（已合并 / 已关闭 / 打开 各一条）', html.slice(0, 200))
    check(html.indexOf("data-state=\"open\"") >= 0 && html.indexOf("data-state=\"closed\"") >= 0 && html.indexOf("data-state=\"merged\"") >= 0,
      'E10 行上的 data-state 也跟着切片的三态走（浅色层按它换色）', html)
  }

  binding.deckViewForgetFrames()
}

main().then(function (): void {
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}, function (err: any): void {
  console.error('门禁脚本自身出错：', err)
  printGateResult(GATE, total, failed + 1)
  process.exit(1)
})
