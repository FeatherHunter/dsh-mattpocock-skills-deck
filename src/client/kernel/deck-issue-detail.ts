/**
 * src/client/kernel/deck-issue-detail.ts —— 票详情这一屏的数据（#1896，规格 #1885 S6）
 *
 * 为什么要有这一份：票详情页过去自己决定画哪一份详情（这一趟取回的、还是快照投影出来的），
 * 自己从会话存储里挑正文、评论、评审与状态，同一个状态在列表页与详情页各读各的：列表读投影里那一行，
 * 详情读这一趟取回的那一份，两处就可能对同一张票说出两个状态。这一份把「详情这一屏要看的东西」
 * 一次交给视图模型，页面只照着画；状态与列表用同一行、同一把尺子。
 *
 * 一个切片的形状（字段名是公开契约，页面与门禁都按它读）：
 *   number / effortId  当前打开的票（视图模型阅读态里的那一张）；
 *   issue              要画的那份详情（与投影结果里的 issue 是同一个对象，不是拷贝）；
 *   source             'live'（这一趟取回的）/ 'snapshot'（从本地快照库读回的）/ 'none'（什么都没有）；
 *   state              状态：**优先取投影里同一张票的那一行**（与列表同一个来源）；行不在时才退回详情自己的；
 *   stateKnown         状态是不是真的知道（两边都没有时是 false，不编一个 OPEN）；
 *   reviews            评审数组（详情带的那一份；没有就是空数组，不补假值）；
 *   comments           评论：nodes（详情连接里那一个数组）、known / unknown（知道有几条 vs 还没取过）、
 *                      hasMore（pageInfo.hasNextPage）、total（票面总数，缺失时 null）、
 *                      loading / failCount（按需加载的会话状态，来自视图模型的输入）；
 *   其余字段（bodySlot / notice / lastKnownAtMs / relationsNotice / commentsAvailable）原样透传投影结果，
 *   页面照旧按它们画，不必再认识新的判据。
 *
 * 三条不能改的约定：
 *  1. 纯函数：不打电话、不读时钟、不改入参；同一份输入连续两次调用结果逐字相同。
 *  2. 三态纪律：评论没取过时说 unknown，不说「没有」；状态两边都不知道时 stateKnown 为 false，不补 OPEN；
 *     评审没有就是空数组，不拿别的数据冒充。
 *  3. 状态只问投影行：同一版本下列表与详情必须说同一个状态，所以行在时一律用行的 state，
 *     不因为这一趟取回的详情更新就改口径。
 *
 * 反例：不要在这里调 fetchIssueComments 或任何宿主电话（「加载更多」是视图模型的一条命令，不是选择器的活）；
 * 不要在这里把评论分页拼成第二份数组（节点数组就是详情里那一个，页面按它画）。
 */

/** 评论这一块（字段含义见文件头）。 */
export interface DeckIssueComments {
  nodes: any[]
  known: boolean
  unknown: boolean
  hasMore: boolean
  total: number | null
  loading: boolean
  failCount: number
}

/** 票详情这一屏要用的东西；字段含义见文件头。 */
export interface DeckIssueDetail {
  number: any
  effortId: string
  issue: any
  source: string
  lastKnownAtMs: number
  noticeKey: string
  notice: string
  bodySlot: any
  relationsNotice: string
  commentsAvailable: boolean
  state: string
  stateKnown: boolean
  reviews: any[]
  comments: DeckIssueComments
}

/** 票面总数：详情带的那一份优先，其次连接自己的 totalCount；都没有就是不知道（null，不拿已取条数顶替）。 */
function knownTotalOf(issue: any, raw: any): number | null {
  const face: any = issue && issue.commentCount
  if (typeof face === 'number' && isFinite(face) && face >= 0) return Math.floor(face)
  const conn: any = raw && raw.totalCount
  if (typeof conn === 'number' && isFinite(conn) && conn >= 0) return Math.floor(conn)
  return null
}

/** 没有打开任何票时的稳定形状：各字段都老实说「不知道」，数组每次新建，调用方改了也不会串。 */
function emptyDetail(): DeckIssueDetail {
  return {
    number: null,
    effortId: '',
    issue: null,
    source: 'none',
    lastKnownAtMs: 0,
    noticeKey: '',
    notice: '',
    bodySlot: { kind: 'loading', caption: '' },
    relationsNotice: '',
    commentsAvailable: false,
    state: '',
    stateKnown: false,
    reviews: [],
    comments: { nodes: [], known: false, unknown: false, hasMore: false, total: null, loading: false, failCount: 0 },
  }
}

/**
 * 从一份详情投影、同一张票在投影里的行、以及评论加载态算出票详情切片。
 *
 * input.number   当前打开的票号；缺席（没有打开任何票）时给出「不知道」的空形状，不拿上一张票冒充。
 * input.view     detailViewFor 的结果（页面原来直接读的那一份）；有票号却没有它时返回 null，
 *                调用方自己退回旧投影（那说明投影函数这一片没接上，不该编一份详情出来）。
 * input.row      投影 issues 里同一张票的那一行（按 (effort, 编号) 找，与列表同一个来源）；没有就传 null。
 * input.comments 评论按需加载的会话状态 {loading, failCount}；缺席按「没在加载、没失败过」处理。
 */
export function deckIssueDetailOf(input: any): DeckIssueDetail | null {
  const number: any = (input && input.number !== undefined) ? input.number : null
  if (number === null) return emptyDetail()
  const view: any = (input && input.view && typeof input.view === 'object') ? input.view : null
  if (!view) return null
  const issue: any = view.issue || null
  const raw: any = issue && issue.comments
  const nodes: any[] = (raw && Array.isArray(raw.nodes)) ? raw.nodes : []
  const row: any = (input && input.row) ? input.row : null
  const rowState: string = (row && row.state !== undefined && row.state !== null) ? String(row.state) : ''
  const issueState: string = (issue && issue.state !== undefined && issue.state !== null) ? String(issue.state) : ''
  const state: string = rowState || issueState
  const loading: boolean = !!(input && input.comments && input.comments.loading === true)
  const failCount: number = Number((input && input.comments && input.comments.failCount) || 0)
  const comments: DeckIssueComments = {
    nodes: nodes,
    known: !!(raw && Array.isArray(raw.nodes)),
    // 从库读回来、评论组还没进库时是「未知」，不是「没有」（#1783 的同一条口径）。
    unknown: !!(issue && view.source === 'snapshot' && !(raw && Array.isArray(raw.nodes))),
    hasMore: !!(raw && raw.pageInfo && raw.pageInfo.hasNextPage === true),
    total: knownTotalOf(issue, raw),
    loading: loading,
    failCount: isFinite(failCount) && failCount > 0 ? failCount : 0,
  }
  return {
    number: number,
    effortId: (input && input.effortId !== undefined && input.effortId !== null) ? String(input.effortId) : '',
    issue: issue,
    source: String(view.source || 'none'),
    lastKnownAtMs: typeof view.lastKnownAtMs === 'number' ? view.lastKnownAtMs : 0,
    noticeKey: String(view.noticeKey || ''),
    notice: String(view.notice || ''),
    bodySlot: view.bodySlot,
    relationsNotice: String(view.relationsNotice || ''),
    commentsAvailable: view.commentsAvailable === true,
    state: state,
    stateKnown: !!state,
    reviews: (issue && Array.isArray(issue.reviews)) ? issue.reviews : [],
    comments: comments,
  }
}