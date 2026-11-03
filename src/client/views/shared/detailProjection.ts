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
// 正文格要用的三样全局（与 IssueDetail.ts 里那几行同源）：Markdown 渲染、容器强调色、动效令牌。
declare function mdToHtml(...args: any[]): any
declare const CONTAINER_ACCENT: any
declare const MOTION: any

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
  // 评论已知与未知要分开：#1783 的根因就是「行上有正文、评论是空数组」被当成「这张票没有评论」。
  // 列表接口为了省请求不取评论（数组天然是空），票面总数 commentCount 才是「有没有评论」的真凭据：
  //   - 行里带了评论（数组非空）→ 已知（快照里的数组就是那个时刻取到的全部，总数就取它的长度）；
  //   - 票面总数明确是 0 → 已知，就是没有评论；
  //   - 票面总数 > 0 → 知道有评论，但这一趟没取正文，属于「未知」；
  //   - 票面总数缺失 → 不知道，同样属于「未知」，不能造一个空连接说「无评论」。
  // 注意「总数缺失」不能算已知：GitHub GraphQL 列表行（LIST_ISSUE_FRAGMENT）带正文、不带
  // comments 也不带票面总数，把缺失当已知就会把「没取过」画成「评论 (0)」（#1783 的残留缺陷）。
  // 未知时 comments 整个不写（界面据此说「评论加载中」）。commentCount 只有真知道总数时才写：
  // 票面总数缺失时，即使评论正文已经取到几条，也不拿已取条数冒充总数——那会把「只取到前几条」
  // 说成「一共就这几条」（与 src/tracker/rooms/github/model/field-states.ts 的评论总数口径一致）。
  const countRaw: any = row && row.commentCount
  const commentCount: any = typeof countRaw === 'number' && isFinite(countRaw) && countRaw >= 0 ? Math.floor(countRaw) : null
  const commentsKnown: boolean = comments.length > 0 || commentCount === 0
  const sub: any = row && row.subIssueCounts
  const out: any = {
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
    subIssues: { totalCount: sub && typeof sub.total === 'number' ? sub.total : 0, nodes: [] },
    blockedBy: { nodes: Array.isArray(row.blockedBy) ? row.blockedBy : [] },
    blocking: { nodes: [] },
    isPullRequest: row.isPullRequest === true,
    mergedAt: row.mergedAt === undefined ? null : row.mergedAt,
    reviews: Array.isArray(row.reviews) ? row.reviews : [],
    fromSnapshot: true,
  }
  if (commentsKnown) {
    out.comments = {
      nodes: nodes,
      pageInfo: {
        // 快照行里的评论数组是那个时刻取到的全部（不是一页），所以「已知有更多」只能靠票面总数判断。
        hasNextPage: commentCount !== null && commentCount > nodes.length,
        endCursor: String(nodes.length),
      },
      totalCount: commentCount !== null ? commentCount : nodes.length,
    }
  }
  // 票面总数（#1783）：只有真知道才写——即便评论这一趟没取到，总数本身仍是有用的已知事实（A4）。
  // 缺失时整个字段不写：GitHub 常规列表行正是「有正文、没有 comments、没有 commentCount」，
  // 拿 0 或已取条数填进去，界面就会把「没取过」或「只取到几条」说成确定的评论总数。
  if (commentCount !== null) out.commentCount = commentCount
  return out
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

/** 行里有没有取到过详情内容：正文或评论至少一样。没有就不能做投影（没取过 ≠ 无描述）。 */
function rowHasDetail(row: any): boolean {
  if (!row) return false
  if (typeof row.body === 'string' && row.body.length > 0) return true
  return Array.isArray(row.comments) && row.comments.length > 0
}

/**
 * 详情页这一次该画什么：快照投影优先（#1695 起这是唯一业务数据来源），
 * 快照行里没有内容时才回退到这一趟取回的详情（live，进入页面到宿主合并回来之间的短暂过渡）。
 * 返回 { issue, source, lastKnownAtMs, noticeKey }：
 *   source 是 'snapshot' 时 issue 是从快照行装出来的只读详情；是 'live' 时 issue 就是 st.issueDetail；
 *   noticeKey 非空时界面要画一句「上次数据（时间）」（时间取 lastKnownAtMs）。
 *
 * 为什么快照优先：旧详情缓存（st.issueCache）已经退役为投影（#1695），这一趟取回的详情会由宿主
 * 经合并服务写进快照；如果这里还先认 live，取数失败或另一个会话改了数据时就会看到第二份业务数据。
 */
export function detailViewFor(st: any, n: any, effortId?: any): any {
  const eff: string = effortId === undefined || effortId === null ? '' : String(effortId)
  // 这一趟真取回来的详情，只要拿到了（issueMode === 'real'）就优先于快照投影（#1783）。
  // 为什么不能反过来：快照行是列表接口给的薄行，GitLab 列表只带票面字段、评论是空数组，
  // 把薄行投影顶在 live 详情前面，详情页就永远显示「评论 (0)」并置灰输入框——宿主明明取回了评论却没人用。
  // 失败（err）与取数中（loading）仍走下面的快照投影：那正是「先画上次内容」要起作用的时刻。
  const liveNow: any = st && st.issueDetail
  const liveNowEff: string = liveNow && liveNow.effortId !== undefined && liveNow.effortId !== null ? String(liveNow.effortId) : ''
  const liveNowMatches: boolean = !!liveNow && Number(liveNow.number) === Number(n) && liveNowEff === eff
  if (liveNowMatches && st.issueMode === 'real') {
    // #1864：从本地快照库读回来的详情（fromSnapshot）算「上次已知」：要标出时刻，
    // 并让评论区按「还没取过」处理——评论是 #1865 才落库的，不能把「没进库」说成「只读」。
    if (liveNow.fromSnapshot === true) {
      const at: number = typeof liveNow.lastKnownAtMs === 'number' ? liveNow.lastKnownAtMs : 0
      return withSlots({
        issue: liveNow,
        source: 'snapshot',
        lastKnownAtMs: at,
        noticeKey: at > 0 ? 'detail.lastKnownData' : '',
        notice: at > 0 ? tr('detail.lastKnownData', { time: hhmmOf(at) }) : '',
      }, liveNow, null, st.issueMode)
    }
    return withSlots({ issue: liveNow, source: 'live', lastKnownAtMs: 0, noticeKey: '', notice: '' }, liveNow, null, st.issueMode)
  }
  if (projectionUsesSnapshot()) {
    const row: any = snapshotRowFor(st, n, effortId)
    if (rowHasDetail(row)) {
      // 上次数据时刻：先取合并组戳记；本会话刚取回、宿主还没合并回来时用 detailSeenAt 补新。
      let at: number = lastKnownDetailAtMs(st)
      const seen: any = st && st.detailSeenAt && st.detailSeenAt[idOfParts(eff, Number(n))]
      if (typeof seen === 'number' && seen > at) at = seen
      const rowDetail: any = detailFromRow(row)
      // 列表行的关系边来自列表读结果，不在 snapshotGroups 里；这一条路照旧不画「关系不知道」那句。
      return withSlots({ issue: rowDetail, source: 'snapshot', lastKnownAtMs: at, noticeKey: 'detail.lastKnownData', notice: at > 0 ? tr('detail.lastKnownData', { time: hhmmOf(at) }) : '' }, rowDetail, null, st.issueMode, null)
    }
  }
  const live: any = st && st.issueDetail
  const liveEff: string = live && live.effortId !== undefined && live.effortId !== null ? String(live.effortId) : ''
  const liveMatches: boolean = !!live && Number(live.number) === Number(n) && liveEff === eff
  if (liveMatches) {
    // 失败后详情没有被清空（#1694）：这时也要标「上次数据是什么时候的」，别让人以为是最新的。
    // 时刻取 detailSeenAt（#1695 起的新记录），旧状态退回详情缓存那条记录的 ts，取不到就不标。
    const keptAfterFail: boolean = st.issueMode === 'err'
    const seen: any = st && st.detailSeenAt && st.detailSeenAt[idOfParts(eff, Number(n))]
    const entry: any = st.issueCache && st.issueCache[idOfParts(eff, Number(n))]
    const at: number = keptAfterFail ? (typeof seen === 'number' && seen > 0 ? seen : (entry && typeof entry.ts === 'number' ? entry.ts : 0)) : 0
    return withSlots({ issue: live, source: 'live', lastKnownAtMs: at, noticeKey: '', notice: keptAfterFail && at > 0 ? tr('detail.lastKnownData', { time: hhmmOf(at) }) : '' }, live, null, st.issueMode)
  }
  return withSlots({ issue: null, source: 'none', lastKnownAtMs: 0, noticeKey: '', notice: '' }, null, null, st.issueMode)
}

/**
 * 把「正文格该画什么」与「关系区那句说明」挂到视图结果上。
 *
 * 为什么在这里一次算完：视图只认 proj.bodySlot 与 proj.relationsNotice，不再认识新的全局名字；
 * 判据（三态、上次已知时刻）只有本模块一处，老门禁渲染 IssueDetail 时不用跟着加替身。
 */
function withSlots(view: any, detail: any, snapIssue: any, mode: any, relationsDetail?: any): any {
  view.bodySlot = bodySlotOf(detail, view, snapIssue, mode)
  view.relationsNotice = relationsNoticeOf(relationsDetail === undefined ? detail : relationsDetail, view)
  return view
}

// ── #1864：正文格与关系区怎么区分「确认没有」与「不知道」 ─────────────────────────
//
// 详情从库出之后，「取过、确认没有」与「还没取过」在界面上必须是两句话：
//   · 正文：确认没有画「无描述」；不知道画「正文还没拿到」并带上上次已知时刻。
//   · 被阻塞关系：确认没有就不画那一段；不知道画一行「被阻塞关系还没拿到」并带上时刻。
// 判据全部来自详情回包里的 snapshotGroups（每组的三态）与 lastKnownAtMs，视图不自己猜。
//
// 为什么把「该说哪句话」也放在这里：视图只负责把 caption 画出来，判据只有这一处；
// 视图那边不用再认识任何新的全局名字（老门禁照旧渲染 IssueDetail）。

/** 正文格该画什么。unknown 与 none 是两件事，前者带上次已知时刻。 */
export type BodySlot =
  | { kind: 'text', text: string }
  | { kind: 'none', caption: string }
  | { kind: 'unknown', atMs: number, caption: string }
  | { kind: 'evicted', atMs: number, caption: string }
  | { kind: 'loading', caption: string }

/**
 * 算出正文格该画什么。
 *
 * detail 是这一趟要画的详情（可能来自库、也可能是这次取回来的）：
 *  - body 是字符串：有内容就画，空串就是「确认没有」（完整来源说没有正文）；
 *  - 没有 body 字段：库里不知道正文，画「还没拿到」并带上次已知时刻；
 *  - 没有 detail：先看按需细节有没有被淘汰过，再看是不是取数失败，否则就是加载中。
 */
export function bodySlotOf(detail: any, proj: any, snapIssue: any, mode: any): BodySlot {
  const at: number = proj && typeof proj.lastKnownAtMs === 'number' ? proj.lastKnownAtMs : 0
  const tail: string = at > 0 ? (' · ' + tr('detail.lastKnownData', { time: hhmmOf(at) })) : ''
  if (detail) {
    if (typeof detail.body === 'string') {
      return detail.body.trim() ? { kind: 'text', text: detail.body } : { kind: 'none', caption: tr('detail.noBody') }
    }
    return { kind: 'unknown', atMs: at, caption: tr('detail.bodyNotYet') + tail }
  }
  const evicted: any = snapIssue && snapIssue.detailEvicted
  const evictedAtMs: number = evicted && typeof evicted.lastKnownAtMs === 'number' && evicted.lastKnownAtMs > 0 ? evicted.lastKnownAtMs : 0
  if (evictedAtMs > 0) return { kind: 'evicted', atMs: evictedAtMs, caption: tr('detail.evictedAt', { time: hhmmOf(evictedAtMs) }) }
  if (mode === 'err') return { kind: 'unknown', atMs: at, caption: tr('detail.bodyNotYet') + tail }
  return { kind: 'loading', caption: tr('list.loading') }
}

/**
 * 被阻塞关系这一组知不知道：只有从库读回来的详情才谈得上「不知道」。
 * complete / truncated 都算知道（truncated 是「有一部分」，画已有部分即可）；其余都算不知道。
 */
export function relationsUnknownOf(detail: any, proj: any): any {
  if (!detail || !proj || proj.source !== 'snapshot') return { unknown: false, atMs: 0 }
  const group: any = detail.snapshotGroups && detail.snapshotGroups.blockedBy
  if (group && (group.completeness === 'complete' || group.completeness === 'truncated')) return { unknown: false, atMs: 0 }
  return { unknown: true, atMs: typeof proj.lastKnownAtMs === 'number' ? proj.lastKnownAtMs : 0 }
}

/** 关系区那句「还没拿到」的文案。不知道时给一句，知道时给空串（视图不占地方）。 */
export function relationsNoticeOf(detail: any, proj: any): string {
  const info: any = relationsUnknownOf(detail, proj)
  if (!info.unknown) return ''
  const tail: string = info.atMs > 0 ? (' · ' + tr('detail.lastKnownData', { time: hhmmOf(info.atMs) })) : ''
  return tr('detail.relationsNotYet') + tail
}
