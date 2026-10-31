/**
 * src/refresh/rooms/host/detail-snapshot-merge.ts —— 单票详情读结果并进快照的唯一入口（#1694）。
 *
 * 为什么要有这一层：详情页过去是「一次 get、一份内存缓存、失败就空白」的另一条数据通路，
 * 它取到的正文、评论、评审、父边、依赖边与子票计数从来没有进过面板快照。于是进入详情只能等这一趟网络，
 * 失败一次整页就空；列表与地图看到的行也不会因为详情读到了更多内容而更新。这一票让详情读结果也走
 * #1690 的合并服务快照唯一写入口：按字段组掩码合并、按版本门丢过期、只有完整来源才能删改已知关系。
 *
 * 三条不能破的约定：
 * 1. 合并只走 kernel/snapshot-merge.ts 的 mergeSnapshot，不在别处写快照字段；
 *    这里只负责「开始取数时记下合并版本」与「取回后合并、写回宿主内存与磁盘」两件事。
 * 2. 没有基线快照时不凭空造一份：详情结果只补到已有快照上，快照本身由列表/刷新那条主路建立。
 * 3. 版本门用取数开始时的合并版本，不是合并时的版本；过期结果整份丢弃并交回调用方记日志，
 *    与 #1690 的行补丁、写回执同一个判据。
 *
 * 反例：把详情结果整块 Object.assign 进 st.issueDetail 或把行整行替换，会抹掉上一次详情已取到的
 * 评论与关系边（降级来源尤其明显）；本模块的合并掩码就是为这件事存在的。
 */
import * as merger from '../../kernel/snapshot-merge.js'
import { rowOf } from './thin-row-fetch.js'

/** 一次详情取数的起点凭证：合并版本与开始时刻。取数前拿、取回后交回，中间不许改。 */
export interface DetailMergeToken {
  startVersion: number
  startedMs: number
}

/** 合并结果：accepted 为假表示过期整份丢弃（stale），快照原引用不动。 */
export interface DetailMergeOutcome {
  accepted: boolean
  stale: boolean
  reason: string
  snapshot: any
  version: any
  mergeVersion: number
  counts: any
  /** 这次详情结果对应的时刻（毫秒）；界面说「上次数据（时间）」用它。 */
  atMs: number
}

/**
 * 造一份详情合并器。deps 由宿主入口注入（全部是可缺省的宿主能力）：
 * getCache/setCache 是内存快照桶，writeDiskCache/getRepoKey 让合并后的快照随盘持久化。
 */
export function createDetailSnapshotMerge(deps: any): any {
  const nowOf: any = deps && typeof deps.now === 'function' ? deps.now : Date.now
  const getCache: any = deps && typeof deps.getCache === 'function' ? deps.getCache : null
  const setCache: any = deps && typeof deps.setCache === 'function' ? deps.setCache : null

  /** 取数前记起点：只读缓存里的合并版本，不触发任何 IO。 */
  function begin(cwd: any): DetailMergeToken {
    let snapshot: any = null
    try {
      const entry: any = getCache ? getCache(cwd) : null
      snapshot = entry && entry.snapshot ? entry.snapshot : null
    } catch (e) { snapshot = null }
    return { startVersion: snapshot ? merger.mergeVersionOf(snapshot) : 0, startedMs: nowOf() }
  }

  /**
   * 取回后合并：把这一次详情读结果（契约票 + 来源声明）按字段组并进当前快照。
   * 返回 null 表示这一趟不值得合并（没有详情数据、或宿主没给缓存能力）；
   * 返回 accepted:false 表示版本门判过期（调用方据此记 staleDropped，不得重试写入）。
   */
  async function merge(cwd: any, token: DetailMergeToken, detail: any): Promise<DetailMergeOutcome | null> {
    const issue: any = detail && detail.issue
    if (!issue || !setCache || !getCache) return null
    let snapshot: any = null
    try {
      const entry: any = getCache(cwd)
      snapshot = entry && entry.snapshot ? entry.snapshot : null
    } catch (e) { snapshot = null }
    // 没有基线快照：不凭空造。详情结果仍按旧形状交回调用方，等主刷新建立快照后再合并。
    if (!snapshot || !Array.isArray(snapshot.issues)) return null
    const atMs = nowOf()
    const started: DetailMergeToken = token && typeof token.startVersion === 'number' ? token : { startVersion: merger.mergeVersionOf(snapshot), startedMs: atMs }
    const out: any = merger.mergeSnapshot(snapshot, {
      kind: 'read',
      startVersion: started.startVersion,
      startedMs: started.startedMs,
      // 详情可能取到列表里被筛掉/未收录的票（例如已关闭容器），它是完整行来源，允许补行。
      rows: [rowOf(issue, detail.provenance)],
      allowNewRows: true,
    })
    if (out.verdict !== 'merged') {
      return { accepted: false, stale: true, reason: out.reason, snapshot: snapshot, version: snapshot.version, mergeVersion: merger.mergeVersionOf(snapshot), counts: out.counts, atMs: atMs }
    }
    // generatedMs/updatedAt 只用于显示「这份快照什么时候更新过」，不参与合并版本与 etag。
    const next: any = Object.assign({}, out.snapshot, { generatedMs: atMs, updatedAt: new Date(atMs).toISOString() })
    try { setCache({ ts: atMs, snapshot: next, error: null, cwd: cwd }) } catch (e) {}
    try {
      if (typeof deps.writeDiskCache === 'function' && typeof deps.getRepoKey === 'function') {
        const repo: any = await deps.getRepoKey(cwd)
        if (repo) await deps.writeDiskCache(repo, next)
      }
    } catch (e) {}
    return { accepted: true, stale: false, reason: out.reason, snapshot: next, version: out.version, mergeVersion: out.merge.version, counts: out.counts, atMs: atMs }
  }

  return { begin: begin, merge: merge }
}

/** 详情结果在哪一段合并里表达过（给上层日志/门禁判断这次到底补了哪些组）。 */
export function detailGroupsOf(outcome: any): any {
  const merge = outcome && outcome.snapshot && outcome.snapshot.merge
  return merge && merge.groups ? merge.groups : {}
}
