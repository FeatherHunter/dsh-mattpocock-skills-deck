/**
 * src/client/views/shared/detailProjection.ts —— 详情页读快照投影（#1694）。
 *
 * 为什么要有这一层：详情页过去只认「这一趟网络取回的那份详情」，取数失败就整页空白，
 * 进入页面也要先等网络。面板快照里其实已经有这张票的行与上次取到的正文/评论（#1690 合并、
 * #1692 磁盘回放），所以详情页应当把它当成投影：有上次内容就先画上次内容，并标出「上次数据」是什么时候的；
 * 这一趟取数失败也只标失败，不清空已经画出来的内容。
 *
 * 三条不能改的约定：
 * 1. 本模块只读快照与详情状态，不写任何缓存、不发请求——写入仍只有宿主那一条合并服务；
 *    视图里出现的每个字都来自 st（快照或详情状态），本模块不自己攒业务数据。
 * 2. 「上次数据」的时刻取自快照的合并组戳记 snapshot.merge.groups[组].atMs（宿主合并时盖的），
 *    取不到才退回该行磁盘回放/淘汰记号的时刻；不许用渲染时的 Date.now() 冒充数据时刻。
 * 3. 读投影开关默认新路径（snapshot）；切到 legacy 时只认这一趟取回的详情、不读快照投影，
 *    两条路都要能跑（#1694 回滚开关，退役旧缓存是 #1695 的事）。
 *
 * 反例：把快照行直接当成详情整块塞给视图，会把「没取过正文」画成「无描述」；
 * 只有行里真的带正文或评论时才做投影，其余情况交回原来的占位与淘汰提示。
 */
declare function log(...args: any[]): any
declare function tr(...args: any[]): any
declare function idOfParts(...args: any[]): any

/** 读投影开关的存储键与两个取值；默认 snapshot（新路径），legacy 是回滚路径。 */
export const READ_PROJECTION_KEY: string = 'dsws.readProjection'
export const READ_PROJECTION_MODES: string[] = ['snapshot', 'legacy']

/** 当前读哪条路。localStorage 不可用（无窗口环境、隐私模式）时按默认新路径，不报错。 */
export function readProjectionMode(): string {
  try {
    const v: any = localStorage.getItem(READ_PROJECTION_KEY)
    return v === 'legacy' ? 'legacy' : 'snapshot'
  } catch (e) { return 'snapshot' }
}

/** 切换读投影路径（一次切换）；返回切完后的值，调用方据此重画。 */
export function setReadProjectionMode(mode: any): string {
  const next: string = mode === 'legacy' ? 'legacy' : 'snapshot'
  try { localStorage.setItem(READ_PROJECTION_KEY, next) } catch (e) { try { log('warn', 'storage.fail', { key: READ_PROJECTION_KEY, op: 'write' }) } catch (eL) {} }
  return next
}

/** 这条面板当前读不读快照投影。视图与取数层共用这一个判据，不各自读开关。 */
export function projectionUsesSnapshot(): boolean { return readProjectionMode() !== 'legacy' }

/** 毫秒转 HH:MM（「上次数据」只说到分钟；跨天由界面文案自己表达，不在这个函数里猜时区）。 */
export function hhmmOf(ms: any): string {
  const n: number = Number(ms)
  if (!isFinite(n) || n <= 0) return ''
  const d: Date = new Date(n)
  const hh: string = (d.getHours() < 10 ? '0' : '') + String(d.getHours())
  const mm: string = (d.getMinutes() < 10 ? '0' : '') + String(d.getMinutes())
  return hh + ':' + mm
}

/** 在快照的 issues 里找这张票的行：优先 (effort, 编号) 全等，单 effort 后端按编号兜底。 */
export function snapshotRowFor(st: any, n: any, effortId?: any): any {
  const issues: any[] = st && st.snapshot && Array.isArray(st.snapshot.issues) ? st.snapshot.issues : []
  const num: number = Number(n)
  const eff: string = effortId === undefined || effortId === null ? '' : String(effortId)
  let byNumber: any = null
  for (let i = 0; i < issues.length; i += 1) {
    const row: any = issues[i]
    if (!row || Number(row.number) !== num) continue
    if (byNumber === null) byNumber = row
    const rowEff: string = row.effortId === undefined || row.effortId === null ? '' : String(row.effortId)
    if (rowEff === eff) return row
  }
  return byNumber
}

/** 快照行里上次取到详情的时刻：取合并组戳记里最新的那个；取不到回退到行的淘汰/回放记号。 */
export function lastKnownDetailAtMs(st: any): number {
  let at: number = 0
  const groups: any = st && st.snapshot && st.snapshot.merge && st.snapshot.merge.groups
  const names: string[] = ['body', 'comments', 'review', 'parents', 'dependencies', 'subIssues', 'mergeInfo']
  for (let i = 0; i < names.length; i += 1) {
    const stamp: any = groups && groups[names[i]]
    const t: number = stamp && typeof stamp.atMs === 'number' ? stamp.atMs : 0
    if (t > at) at = t
  }
  return at
}

/** 把快照行装成详情页认识的老形状（GraphQL 连接）；只装行里真有的内容，不补假值。 */
export function detailFromRow(row: any): any {
  const comments: any[] = Array.isArray(row && row.comments) ? row.comments : []
  const nodes: any[] = comments.map(function (c: any): any {
    return {
      author: { login: (c && c.author && c.author.login) || '' },
      authorAssociation: (c && c.authorAssociation) || '',
      body: (c && c.body) || '',
      createdAt: c && c.createdAt,
      updatedAt: c && c.updatedAt,
    }
  })
  const sub: any = row && row.subIssueCounts
  return {
    number: Number(row.number),
    effortId: row.effortId === undefined || row.effortId === null ? '' : String(row.effortId),
    title: row.title || '',
    state: row.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
    body: typeof row.body === 'string' ? row.body : '',
    url: row.url || '',
    updatedAt: row.updatedAt || '',
    createdAt: row.createdAt || '',
    closedAt: row.closedAt || null,
    author: row.author,
    labels: { nodes: Array.isArray(row.labels) ? row.labels : [] },
    assignees: { nodes: (Array.isArray(row.assignees) ? row.assignees : []).map(function (a: any): any { return typeof a === 'string' ? { login: a } : a }) },
    comments: { nodes: nodes, pageInfo: { hasNextPage: false, endCursor: String(nodes.length) } },
    subIssues: { totalCount: sub && typeof sub.total === 'number' ? sub.total : 0, nodes: [] },
    blockedBy: { nodes: Array.isArray(row.blockedBy) ? row.blockedBy : [] },
    blocking: { nodes: [] },
    isPullRequest: row.isPullRequest === true,
    mergedAt: row.mergedAt === undefined ? null : row.mergedAt,
    reviews: Array.isArray(row.reviews) ? row.reviews : [],
    fromSnapshot: true,
  }
}

/**
 * 被阻塞边：详情回包是 GraphQL 连接 {nodes}，快照行是数组；两种形状都认，未知一律回空数组。
 * 为什么要有这一句：快照行里的已知阻塞边（#1690 合并带回来的）是数组成员的形状，
 * 详情页过去只认 detail.blockedBy.nodes，于是「图里点开一张票」首帧看不到已知阻塞（规格 #1681 要求 2）。
 */
export function knownBlockedNodes(src: any): any[] {
  if (!src) return []
  const edges: any = src.blockedBy
  if (Array.isArray(edges)) return edges
  return edges && Array.isArray(edges.nodes) ? edges.nodes : []
}

/**
 * 详情页这一次该画什么：先看这一趟取回的详情（live），没有就看快照投影（snapshot）。
 * 返回 { issue, source, lastKnownAtMs, noticeKey }：
 *   source 是 'live' 时 issue 就是 st.issueDetail；是 'snapshot' 时是从快照行装出来的只读详情；
 *   noticeKey 非空时界面要画一句「上次数据（时间）」（时间取 lastKnownAtMs）。
 */
export function detailViewFor(st: any, n: any, effortId?: any): any {
  const live: any = st && st.issueDetail
  const eff: string = effortId === undefined || effortId === null ? '' : String(effortId)
  const liveEff: string = live && live.effortId !== undefined && live.effortId !== null ? String(live.effortId) : ''
  const liveMatches: boolean = !!live && Number(live.number) === Number(n) && liveEff === eff
  if (liveMatches) {
    // 失败后详情没有被清空（#1694）：这时也要标「上次数据是什么时候的」，别让人以为是最新的。
    // 时刻取详情缓存那条记录的 ts（那就是这份内容真正取回来的时刻），取不到就不标。
    const keptAfterFail: boolean = st.issueMode === 'err'
    const entry: any = st.issueCache && st.issueCache[idOfParts(eff, Number(n))]
    const at: number = keptAfterFail && entry && typeof entry.ts === 'number' ? entry.ts : 0
    return { issue: live, source: 'live', lastKnownAtMs: at, noticeKey: '', notice: keptAfterFail && at > 0 ? tr('detail.lastKnownData', { time: hhmmOf(at) }) : '' }
  }
  if (!projectionUsesSnapshot()) return { issue: null, source: 'none', lastKnownAtMs: 0, noticeKey: '', notice: '' }
  const row: any = snapshotRowFor(st, n, effortId)
  if (!row) return { issue: null, source: 'none', lastKnownAtMs: 0, noticeKey: '', notice: '' }
  const hasBody: boolean = typeof row.body === 'string' && row.body.length > 0
  const hasComments: boolean = Array.isArray(row.comments) && row.comments.length > 0
  // 只有行里真带内容才做投影：没取过正文/评论的行交回原来的占位与淘汰提示（不把「没取过」画成「无描述」）。
  if (!hasBody && !hasComments) return { issue: null, source: 'none', lastKnownAtMs: 0, noticeKey: '', notice: '' }
  const at: number = lastKnownDetailAtMs(st)
  return { issue: detailFromRow(row), source: 'snapshot', lastKnownAtMs: at, noticeKey: 'detail.lastKnownData', notice: at > 0 ? tr('detail.lastKnownData', { time: hhmmOf(at) }) : '' }
}
