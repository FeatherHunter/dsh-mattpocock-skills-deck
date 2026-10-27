/**
 * src/host/issuePage.ts —— 「按页取历史票」这条电话的宿主实现（来源：src/host/issuePage.js，#690 新加；本次只加类型标注与注释，逻辑一行未动）。
 *
 * 它干的事只有三件（第一性原理：这一层是「界面要那一页」到「后端怎么取那一页」之间的接线）：
 *   一、认清楚是哪个工作区、哪个后端、哪个工作单元（与单票详情那条电话同一套前奏）；
 *   二、把契约那条操作（listPage）叫一次，错误原样透传 —— **不做能力表**，后端回「做不到」就回
 *       「做不到」，界面据此显示「在网页上看全部」（G5 红线，见 contract.js 文件头）；
 *   三、把行数据补成客户端认识的那一份：`number` 与大写的 `state`。这两样是宿主在快照那条链上
 *       现算补上去的（见 sessionSnapshot.js 里那段 forEach 与 index.js 的 upcaseSnapStates），
 *       客户端好几处直接读 `x.number`、按大写 `state` 比较，页数据这条路必须照补，
 *       否则点一行会压进 undefined、已关闭的票会被当成未关闭（研究底稿 research/677-field-consumption.md 第 6.3 节）。
 *
 * 在途去重：同一个「仓库 + 工作单元 + 筛选 + 游标 + 页大小」的并发请求只发一次，其余的等同一份结果
 *   （与快照重建那条 #696 的在途合并同例）。界面三个触发点可能同时开火（展开折叠行、切筛选、滚到底），
 *   没有这一层就会对着同一页发三四条命令，白白吃配额。
 *
 * 不做的两件：
 *   - 不做缓存。历史随时可再取，多留一份真源只会带来「哪份对」的问题（规格第 7.2 节：客户端那份页数据
 *     也不落磁盘）。要省，由客户端留最近若干页，不在宿主留。
 *   - 不猜数。拿不到就让错误原样回去，界面照实说「没拿到」。
 */

// #1584 F3：GitHub / GitLab 的 describe 只给目录时回的是空 refId 的壳；
// 这里复用 tracker 层那一把「工作区→仓库身份」的共享尺子，不再自己拼 GitHub 形状。
import { resolveRepoRefForCwd } from '../tracker/session/repo-ref.js'

// ---------------------------------------------------------------------------
// 类型（本次转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖全是函数与服务（目录归一、后端选择、注册表、平台、执行口等），
// 形状按本文件实际用到的成员写成最小，全部用 any 接住；归一后的请求、行数据与回包都沿用
// 原来的运行时形状，类型只描述不约束，运行时行为一字不变。
// ---------------------------------------------------------------------------

/** 组装函数收到的依赖：目录归一、后端选择、注册表、平台、仓库键、执行口与日志口，全由调用点显式传入。 */
interface IssuePageDeps {
  normCwd: any
  selectEarly: any
  getTrackerRegistry: any
  getPlatform: any
  getRepoKey: any
  ctx: any
  DEFAULT_CWD: any
  detectionExec: any
  logCtx: any
  /** #1584 F3：宿主注入的只读会话口；身份真源，注册表 describe 给不出 refId 时问它。 */
  openSession: any
}

/**
 * 组装按页取票电话（依赖全显式传入）。
 *
 * 为什么：在途去重表活在闭包里，同一组装实例共享同一张表，并发取同一页时只发一次。
 * 什么约定不能改：返回对象的两个字段名（handleIssuesPage 给调用点按名取，clientRowOf 给测试按名取），改名就拿不到。
 */
export function createIssuePage(deps: IssuePageDeps): any {
  const { normCwd, selectEarly, getTrackerRegistry, getPlatform, getRepoKey, ctx, DEFAULT_CWD, detectionExec, logCtx, openSession } = deps as any

  // 在途去重表：key → Promise<回包>。settle 之后立即清掉（同一页翻第二次是要重新取的）。
  const inflight: Map<any, any> = new Map()

  /** 页大小归一：缺省 50、上限 200（与契约「分页契约」同一条规则；后端还会再夹一次）。 */
  function limitOf(v: any): number {
    if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v <= 0) return 50
    return v > 200 ? 200 : v
  }

  /** 标签筛归一：字符串数组、去掉空白与重复（保持原顺序，大小写不动）。 */
  function labelsOf(v: any): string[] {
    if (!Array.isArray(v)) return []
    const out: string[] = []
    const seen: Record<string, boolean> = {}
    for (const x of (v as any[])) {
      const nm: string = typeof x === 'string' ? x.trim() : ''
      if (!nm || seen[nm]) continue
      seen[nm] = true
      out.push(nm)
    }
    return out
  }

  /**
   * 把契约的行数据补成客户端认识的那一份。
   * 补两样（见文件头第三件）+ 把 key 归一为字符串、blockedBy 压成键字符串数组（与快照那条链同形状：
   * sessionSnapshot.js 里也是这么压的）。其余字段原样带过去。
   */
  function clientRowOf(iss: any): any {
    const row: any = Object.assign({}, iss)
    if (row.key !== undefined && row.key !== null) row.key = String(row.key)
    if (row.number === undefined || row.number === null) {
      const k: string = row.key !== undefined && row.key !== null ? String(row.key) : ''
      const n: number = parseInt(k, 10)
      if (!isNaN(n)) row.number = n
    }
    row.state = String(row.state || '').toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN'
    if (Array.isArray(row.blockedBy)) {
      row.blockedBy = row.blockedBy.map(function (b: any) {
        if (typeof b === 'number' || typeof b === 'string') return String(b)
        if (b && typeof b === 'object') {
          if (b.key !== undefined && b.key !== null && b.key !== '') return String(b.key)
          if (b.number !== undefined && b.number !== null) return String(b.number)
        }
        return ''
      }).filter(function (k: any) { return !!k })
    }
    return row
  }

  async function pageOnce(a: any): Promise<any> {
    const cwd: any = await normCwd(a.cwd || DEFAULT_CWD)
    const sel: any = await selectEarly({ cwd, backendId: a.backendId || undefined })
    if (!sel || !sel.backendId) return { ok: false, error: { kind: 'unsupported', message: '这个工作区还没有可用的后端，按页取票用不了' } }
    const reg: any = await getTrackerRegistry()
    if (!reg || typeof reg.get !== 'function') return { ok: false, error: { kind: 'unsupported', message: '后端注册表不可用，按页取票用不了' } }
    const backendId: any = sel.backendId
    const tracker: any = reg.get(backendId)
    if (!tracker || typeof tracker.listPage !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + backendId + "' 未实现 listPage" } }
    let repoRef: any = null
    try { repoRef = reg.describe({ cwd }, backendId) } catch {}
    if (!repoRef || !repoRef.refId) {
      // #1584 F3：GitHub / GitLab 只给目录时 describe 只回显示名，空 refId 不算身份；
      // 先问会话（身份真源），会话也答不上时再按工作区问一次 owner/name（那道只认 GitHub）。
      const identified: any = await resolveRepoRefForCwd({ cwd, backendId, describe: reg.describe, openSession })
      if (identified) repoRef = identified
    }
    if (!repoRef || !repoRef.refId) {
      // 与快照那条链同样的兜底：注册表 describe 给不出 refId 时，按工作区问一次 owner/name。
      try {
        const rk: any = await getRepoKey(cwd)
        if (rk && rk.owner && rk.name) repoRef = { backend: backendId, refId: rk.owner + '/' + rk.name, name: rk.owner + '/' + rk.name, url: 'https://github.com/' + rk.owner + '/' + rk.name }
      } catch (e: any) { /* 拿不到就按下面如实失败 */ }
    }
    if (!repoRef || !repoRef.refId) return { ok: false, error: { kind: 'env', message: '认不出这个工作区对应的仓库（缺远端信息），按页取票用不了' } }
    // 工作单元（effort）是寻址范围：带上就放进 ref（不带 = 全仓库，单工作单元的后端行为不变）。
    if (a.effortId !== undefined && a.effortId !== null && a.effortId !== '') repoRef.effortId = String(a.effortId)
    const opCtx: any = {
      cwd,
      platform: await getPlatform(),
      fs: ctx.get('fs'),
      exec: function (c: any, ar: any, o: any): any { return detectionExec(c, ar, o, 'issuesPage') },
      logEvent: backendLogEvent,
      isEnabled: backendLogEnabled,
    }
    const filter: any = { state: a.state || undefined, labels: a.labels && a.labels.length ? a.labels : undefined }
    const r: any = await tracker.listPage(repoRef, filter, { cursor: a.cursor || '', limit: a.limit }, opCtx)
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || { kind: 'network', message: 'listPage 没有回包' } }
    const d: any = r.data || {}
    const items: any = Array.isArray(d.items) ? d.items.map(clientRowOf) : []
    return { ok: true, items: items, nextCursor: (typeof d.nextCursor === 'string' && d.nextCursor) ? d.nextCursor : null, total: d.total }
  }

  // 房内埋点：与 platformChannel.js 给各后端房间的那两个函数同一形状（没有 logEvent 时静默）。
  function backendLogEvent(level: any, event: any, fields: any): void {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire(level, event, fields) } catch (e: any) {}
  }
  function backendLogEnabled(level: any): boolean {
    try { return logCtx ? logCtx.isEnabled(level) : (level === 'error' || level === 'warn') } catch (e: any) { return level === 'error' || level === 'warn' }
  }

  /**
   * 电话本体：入参 {cwd, backendId?, effortId?, state, labels, cursor, limit}；
   * 回参 {ok:true, items, nextCursor, total} 或 {ok:false, error:{kind,message}}（错误原样透传）。
   */
  async function handleIssuesPage(args: any): Promise<any> {
    const a: any = {
      cwd: args && args.cwd,
      backendId: args && args.backendId,
      effortId: args && args.effortId,
      state: args && args.state,
      labels: labelsOf(args && args.labels),
      cursor: (args && typeof args.cursor === 'string') ? args.cursor.trim() : '',
      limit: limitOf(args && args.limit),
    }
    // 在途去重键：仓库（工作区 + 后端 + 工作单元）+ 筛选（状态 + 标签）+ 游标 + 页大小。
    // 刻意不含任何随时间变的量：同一把钥匙就是同一页数据。
    let rkHash: string = ''
    try { const rk: any = await getRepoKey(a.cwd || DEFAULT_CWD); if (rk && rk.owner && rk.name) rkHash = rk.owner + '/' + rk.name } catch (e: any) {}
    const key: string = [String(a.cwd || DEFAULT_CWD), String(a.backendId || ''), String(a.effortId || ''), String(a.state || ''), a.labels.join(','), a.cursor, String(a.limit), rkHash].join('|')
    const ongoing: any = inflight.get(key)
    if (ongoing) return await ongoing
    const p: Promise<any> = (async function (): Promise<any> {
      try { return await pageOnce(a) } catch (e: any) {
        return { ok: false, error: { kind: 'network', message: String((e && e.message) || e).slice(0, 400) } }
      } finally { inflight.delete(key) }
    })()
    inflight.set(key, p)
    return await p
  }

  return { handleIssuesPage: handleIssuesPage, clientRowOf: clientRowOf }
}

export default { createIssuePage }
