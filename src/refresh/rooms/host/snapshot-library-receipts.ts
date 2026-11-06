/**
 * src/refresh/rooms/host/snapshot-library-receipts.ts —— 写回执与评论回执落库（#1866 立起，#1935 拆出）
 *
 * 为什么单列：宿主侧快照库门面（snapshot-library.ts）贴着 350 有效行上限，而 #1935 要给两个回执
 * 写口加「有界重试 + 本机库落后」两段逻辑。两个回执本来就共享同一套约定（kind:'receipt'、一批一个
 * 事务、stale 重试一次），拆到一个文件后这些约定只有一份，门面只负责把名字转出去。
 *
 * 三条不能改的约定：
 *  1. 只有 write-failed 才重试、才置「本机库落后」：readonly 是磁盘不可写、legacy-writer 是旧窗口
 *     还占着写权，两种再试一次都不会变好；把它们标成「正在重新同步」是在骗等界面的人。
 *  2. stale 仍然只重读版本再写一次（老口径），不占那两档退避：stale 是「期间有更新的结果先落地」，
 *     等 5 秒再写只会把同一份旧数据再送一遍。
 *  3. 任何一次提交成功都清掉落后状态（write receipt 与 comment receipt 各清一次）。反例：只在
 *     列表写入那条路清 —— 用户发完评论、回执成功之后状态会一直挂着，直到下一次整份刷新。
 */
import type { Comment, Issue } from '../../../tracker/contract/entities.js'
import type {
  GroupCompleteness,
  IssueDetailProjection,
  IssueWrite,
  WorkspaceSnapshotHandle,
} from '../../../workspace-snapshot/contract/types.js'
import { RECEIPT_SOURCE, commentReceiptValueOf, receiptIssueWriteOf } from './snapshot-library-adapter.js'
import { handleOf, supportedBackend, type SnapshotLibraryKey } from './snapshot-library-handles.js'
import { clearLibraryBehind, markLibraryBehind } from './snapshot-library-behind.js'
import { ingestWithRetry } from './write-retry.js'

export interface WriteReceiptInput extends SnapshotLibraryKey {
  /** 写完之后 tracker 交回来的那张票（可能不止一张：一次调用可以改到几张）。 */
  issues: Issue[]
  /** 是哪条写操作交回来的：close / reopen / update / setLabels … 只进日志与组记录，不参与判断。 */
  operation: string
}

export interface WriteReceiptResult {
  ok: boolean
  /** true = 库这会儿开不出来，这次没写进库；调用方按老路继续（这是明示的降级，不是写成功）。 */
  degraded?: boolean
  /** 真正提交进库的票数。 */
  rows: number
  mergeVersion: number | null
  reason?: string
}

export interface CommentReceiptInput extends SnapshotLibraryKey {
  /** 这张票在库里可能用的键（本地 Markdown 补零、GitHub 不补零，两种都试）。 */
  keys: string[]
  effortId?: string
  /** 写完之后 tracker 交回来的那一条评论。 */
  comment: Comment
}

export interface CommentReceiptResult {
  ok: boolean
  degraded?: boolean
  mergeVersion: number | null
  /** 这一条最后落在评论组的第几位（0 起）；库没写成时是 null。 */
  position: number | null
  reason?: string
}

/** 库的身份没给对：这不是「库不可用」，是调用方传错了，如实回失败。 */
function keyProblemOf(input: SnapshotLibraryKey): string | null {
  if (!input || typeof input.workspaceRoot !== 'string' || !input.workspaceRoot) return 'no-workspace'
  if (!supportedBackend(String(input.backend || ''))) return 'unsupported-backend'
  return null
}

/**
 * 把一批写回执写进库（#1866）：改状态、改标签、改标题之后，tracker 交回来的那张票按组并进库。
 *
 * 为什么与列表写入同一套换算：回执表达的组就是「行 + 标签 + 指派 + 父子 + 阻塞」这几样，
 * 换算规则只该有一份（见 snapshot-library-adapter.ts 的 receiptIssueWriteOf）。
 * 一批一个事务：其中一张票写不进去，整批都不提交，不会留下半批。
 *
 * 三种结局：
 *   { ok:true }                 提交成功，界面这时候才该更新；
 *   { ok:true, degraded:true }  库开不出来（没有工作区根、打不开文件），这次没写，按老路继续；
 *   { ok:false, reason }        调用方给的参数不对，或者事务被版本门挡下 / 写失败，库一个字节没改。
 */
export async function recordWriteReceipt(input: WriteReceiptInput): Promise<WriteReceiptResult> {
  const problem = keyProblemOf(input)
  if (problem) return { ok: false, rows: 0, mergeVersion: null, reason: problem }
  const operation = String(input.operation || 'write')
  const writes: IssueWrite[] = (Array.isArray(input.issues) ? input.issues : [])
    .filter((issue) => !!issue && issue.key != null)
    .map((issue) => receiptIssueWriteOf(issue, operation, input.backend))
  if (!writes.length) return { ok: true, rows: 0, mergeVersion: null }
  const handle = await handleOf(input)
  if (!handle) return { ok: true, degraded: true, rows: 0, mergeVersion: null, reason: 'library-unavailable' }
  // kind:'receipt'（#1889）：这一批是「写完之后 tracker 交回来的那张票」，它自己就是刚写完的真状态。
  // 库据此给每一组盖回执时刻，并在随后一个短窗口内挡住迟到的读结果；回执本身不受窗口约束。
  // #1935：每次尝试里仍然先按老口径重试一次 stale（重读版本再写）；两次退避只留给 write-failed。
  const result = await ingestWithRetry(function () {
    let attempt = handle.ingest({ startMergeVersion: handle.getMergeVersion(), kind: 'receipt', writes })
    if (!attempt.committed && attempt.reason === 'stale') {
      attempt = handle.ingest({ startMergeVersion: handle.getMergeVersion(), kind: 'receipt', writes })
    }
    return attempt
  })
  if (!result.committed) {
    // 只有 write-failed（重试也没成的事务失败）才说「本机库落后」：readonly 是磁盘不可写、
    // legacy-writer 是旧窗口还占着写权，两者重同步也写不进去，标落后只会让用户等一件不会发生的事。
    if (result.reason === 'write-failed') markLibraryBehind(input, 'write-failed')
    return { ok: false, rows: 0, mergeVersion: null, reason: result.reason }
  }
  clearLibraryBehind(input)
  return { ok: true, rows: writes.length, mergeVersion: result.mergeVersion }
}

/**
 * 把一条评论写回执写进库（#1866）：发评论成功后，把这一条追加进评论组，一个事务。
 *
 * 位置与完整度怎么定：
 *  - 库里这张票的行组记着票面总数时，新评论的位置就是那个数（它是这条新评论的下标）；
 *    不知道总数时交给库里落到已有条数后面。
 *  - 原来评论组是 complete（我们确实知道这张票的全部评论），加一条之后仍然 complete；
 *    只有一部分或从没取过时写成 truncated —— 中间那几条我们没取过，不许说成知道。
 *
 * 票号两种写法都试：本地 Markdown 存的是补零的键（01），GitHub 是不补零的（1）。写错键会让库里
 * 多出一张只有身份的骨架票，评论挂在那张骨架下面，详情页永远看不到。
 */
export async function recordCommentReceipt(input: CommentReceiptInput): Promise<CommentReceiptResult> {
  const problem = keyProblemOf(input)
  if (problem) return { ok: false, mergeVersion: null, position: null, reason: problem }
  const keys: string[] = (Array.isArray(input.keys) ? input.keys : [])
    .map((key) => String(key || ''))
    .filter((key) => key !== '')
  if (!keys.length) return { ok: false, mergeVersion: null, position: null, reason: 'no-keys' }
  const comment = input.comment
  if (!comment || typeof comment.body !== 'string') {
    return { ok: false, mergeVersion: null, position: null, reason: 'no-comment' }
  }
  const handle = await handleOf(input)
  if (!handle) return { ok: true, degraded: true, mergeVersion: null, position: null, reason: 'library-unavailable' }
  // 闭包里再读一次句柄时编译器收窄不过去（它可能在中途被换掉），这里先固定成一份可用的句柄。
  const db: WorkspaceSnapshotHandle = handle
  const effortId = String(input.effortId || '')

  /** 读一次库里那张票，据此算这条评论该落在第几位、写完还算不算完整。 */
  function planOf(): { key: string, write: IssueWrite, fallbackPosition: number | null } {
    let found: IssueDetailProjection | null = null
    let key = keys[0]
    for (const candidate of keys) {
      const projection = db.readIssueDetail({ key: candidate, effortId })
      if (projection && projection.issue) { found = projection; key = candidate; break }
    }
    const issue = found ? found.issue : null
    const group = issue ? issue.groups.comments : null
    const completeness: GroupCompleteness = (group && group.completeness === 'complete') ? 'complete' : 'truncated'
    const count = issue && typeof issue.row.commentCount === 'number' && Number.isFinite(issue.row.commentCount)
      ? Math.floor(issue.row.commentCount)
      : null
    const write: IssueWrite = {
      effortId,
      key,
      groups: {
        commentReceipt: {
          comment: commentReceiptValueOf(comment),
          position: count,
          completeness,
          source: RECEIPT_SOURCE,
          operation: 'comment',
        },
      },
    }
    return { key, write, fallbackPosition: count }
  }

  // 计划放在一个盒子里而不是单独的 let：TypeScript 的控制流分析看不到「闭包里给 let 赋值」，
  // 用 let 会在下面读 fallbackPosition 时被收窄成 never；盒子里的属性在每次读时按声明类型算。
  const planBox: { plan: { key: string, write: IssueWrite, fallbackPosition: number | null } | null } = { plan: null }
  // kind:'receipt'（#1889）：刚发出去的那一条是真状态，评论组在随后一个短窗口内不被读结果覆盖。
  // #1935：两次退避之间评论组可能已经被别的读结果改过，所以每次尝试都重算一遍位置与完整度。
  const result = await ingestWithRetry(function () {
    planBox.plan = planOf()
    let attempt = handle.ingest({ startMergeVersion: handle.getMergeVersion(), kind: 'receipt', writes: [planBox.plan.write] })
    if (!attempt.committed && attempt.reason === 'stale') {
      planBox.plan = planOf()
      attempt = handle.ingest({ startMergeVersion: handle.getMergeVersion(), kind: 'receipt', writes: [planBox.plan.write] })
    }
    return attempt
  })
  if (!result.committed) {
    // 与写回执同一口径：只有 write-failed 才置「本机库落后」（理由见 recordWriteReceipt）。
    if (result.reason === 'write-failed') markLibraryBehind(input, 'write-failed')
    return { ok: false, mergeVersion: null, position: null, reason: result.reason }
  }
  clearLibraryBehind(input)
  const fallbackPosition = planBox.plan ? planBox.plan.fallbackPosition : null
  const applied = Array.isArray(result.commentPositions) && result.commentPositions.length ? result.commentPositions[0] : fallbackPosition
  return { ok: true, mergeVersion: result.mergeVersion, position: applied }
}
