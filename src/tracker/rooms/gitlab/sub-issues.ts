/**
 * src/tracker/rooms/gitlab/sub-issues.ts —— 取一张地图上挂着的票（契约第 21 条 `Tracker.listSubIssues` 的 GitLab 实现）。
 *
 * ── 这条能力在 GitLab 上读回来的到底是什么（先读这一段，再读代码）──────────────────
 * 本房走的 REST issue links 接口没有层级类型（`link_type` 只有 `relates_to`、`blocks`、`is_blocked_by`
 * 三种）。GitLab 平台本身有原生的父子层级，但它在 work items 那条路上（入口是界面与 GraphQL），
 * 本房不走那条。本房的 `setParent` 落到远端，是在**子票自己**的链接资源上 POST
 * 一条 `relates_to` 平级链接（`graph-membership.ts:97`：路径是子票的 `/issues/:childIid/links`，
 * 请求里带 `target_issue_iid=<父票>`、`link_type=relates_to`）。所以这条能力读回来的是
 * 「挂在这张地图上的票」，**不是** GitLab 意义上的子票：层级是「本房按写的时候的约定认出来的」，
 * 不是远端给的。文档与实现把它当原生层级用，就会读出一张并不存在的树。
 *
 * 还有一处分不出来，必须一起记住：`relates_to` 是对称的。这个端点回的是一张双向链接表
 * （官方文档原话是 bi-directional：一条链接会同时出现在两张票下面），人在 GitLab 界面上手工加的
 * 「关联」链接，与本房程序写下的链接，在列表行里长得一模一样 —— 列表行里没有任何一格能说明
 * 「哪一头是父」（`link_type` 恒为 `relates_to`；`id`/`iid`/`project_id`/`state` 都是对面那张票的属性，
 * 链接自己的编号在 `issue_link_id`）。所以「哪些行算子票」只能靠下面这套约定判断，
 * 判断不出来的一律记进 `dropped`，绝不猜。
 *
 * ── 哪一头是父：约定的内容与判法 ─────────────────────────────────────────────
 * 约定（本房写路径自己立的，只有一处出处：`graph-membership.ts:97` 的 `setParent`）：挂亲缘永远
 * POST 到**子票**的链接资源，于是子票是这条链接的 `source_issue`，父票是 `target_issue`。
 * 反过来读这句话就是判法：**一条链接的 source 那一头，就是「认父」的那一头。**
 *
 * 落到代码：对列表里的每一行，回读这一条链接的明细
 * （`GET /projects/:id/issues/:iid/links/:issue_link_id`），看对面那张票落在 `source_issue`
 * 还是 `target_issue` 里：
 *   · 对面在 `source_issue` → 这条链接是「它指向地图」，它就是本房认的子票 → 留下；
 *   · 对面在 `target_issue` → 这条链接是「地图指向它」（地图自己是 source），它其实是这张地图
 *     **自己的父票**，不是子票 → 不画，也不算 `dropped`（读到了、也认出来了，只是它不属于
 *     这条读要回答的问题）；
 *   · 两头都像、两头都不像、明细里缺 `source_issue`/`target_issue`、或者另一头不是这次要问的
 *     那张地图 → 分不出来 → 记进 `dropped`，不猜。
 *
 * 这个判法有多可靠：**链接是本房程序写下的那些行，它是准的** —— 写路径只有上面那一处，方向是固定
 * 约定，回读的 `source_issue`/`target_issue` 是 GitLab 自己存的发起方向。不准的地方是人手工加的
 * 「关联」链接：它在远端与程序写下的链接无法区分，这套判法只能按同一套约定去解释它（人从 A 的页面
 * 加「关联到 B」，读起来就是「B 是 A 的父票」）。这条限制同时也是契约决策里写明的那一条。
 * 另注：本房 `normalize.ts:252-274` 另有一处「取最早一条 relates_to 当父票」的按时间猜法，
 * 那条与本条读无关；本条读按明细里的 source/target 判，不按时间猜。
 *
 * 代价说清楚：每有一行 `relates_to` 就多回读一次链接明细（一张地图 N 张子票 = 1 + N 次 glab 调用）。
 * 这不是疏忽 —— 方向只住在链接明细里，列表行里没有。哪天不想要这个代价，把方向回读整段去掉，
 * 这条读就退化成「这张地图的全部关联票」，代价是**地图自己那张父票会被当成子票画出来**；
 * 要退就同时改三处文字：本文件头、能力登记表、本房交接说明。
 *
 * ── 拿不全的几条路（与 GitHub 房同一条纪律：绝不返回半份数据装作拉全了）──────────
 *  · 链接表这一趟没取回来（同一趟重试一次）→ 整体失败；
 *  · 某一行的明细没取回来（同一行重试一次）→ 整体失败，不返回画了一半的地图；
 *  · 关联行超过 1000 张 → 仍回成功，但 `capped=true`，如实说「还有更多，这次没全取回」；
 *  · `total`：这个端点一次把整张链接表交回来，没有「总数」这一格，所以照 GitHub 房拿不到
 *    totalCount 时的同一做法取 `fetched`（`src/tracker/rooms/github/sub-issues.ts:140`），
 *    不假装知道更多；界面要的「还有更多」由 `capped` 单独说；
 *  · `missing`：本后端结构上恒为 0（能与总数对不上的只剩「被 1000 上限截断」，那件事由 `capped`
 *    单独说），如实写 0，不去凑一个差额；`dropped` 与它分开记，理由见 `results.ts:167-170`；
 *  · 关联行一行都没能算进去（有候选行、却一张都画不出来）→ 整体失败，不返回一张空地图：
 *    「读不出来」与「这张地图真的没有子票」必须长得不一样，不然界面会把前者画成后者；
 *  · 同一张票在本张地图上被挂了两条链接时只画一行（界面按编号分组，重复行只会把张数算多）。
 *
 * ── 档位与权限（这条读能不能用）──────────────────────────────────────────────
 * 「关联票」（relates_to）这一项在 Free / Premium / Ultimate 三档都有（官方文档的 Linked issues
 * 一节标的就是三档）；只有 `blocks` / `is_blocked_by` 是 Premium 档。本文件只读 `relates_to`，
 * 那两种阻塞关系属于 `getDependencies` 那条能力的问题，这里既不画成子票、也不算 `dropped`
 * —— 它们没被丢掉，只是不在这条读的问题里。
 *
 * ── 日志 ────────────────────────────────────────────────────────────────────
 * 只落本房已登记的那几条 `read.degraded` 理由（`read-log.ts` 的 READ_DEGRADED_REASONS）：
 * `subIssues:repo-ref`、`subIssues:transport`、`subIssues:json`、`subIssues:shape`、
 * `subIssues:notfound`、`subIssues:page-fail`、`subIssues:truncated`。刻意不新开取值：
 * 要加就回来找 Lead。房内不许直接调 `ctx.logEvent`，所以这里一律走 `emitReadDegraded`。
 *
 * ── 未核实的地方（写下来，免得读的人以为这些是当场核对过的事实）──────────────────
 * 动手时**没有跑过任何 glab 命令**（只写代码与类型检查），所以列表行与明细行的真实回包没有当场
 * 核对过：字段名与「链接创建在哪一头」这两件事，依据是 GitLab 官方文档（Issue links API、
 * Linked issues）与 GitLab 自己的源码（`Issue#related_issues` 把 source 与 target 两个方向都取回，
 * 所以列表是双向的；`POST /links` 把发起的那张票存成 source）。第一次真跑时照这三条对一遍：
 *   1）列表行里 `issue_link_id` 才是链接自己的编号，`id` 是**对面那张票**的编号（拿 `id` 去查明细
 *      会查错或查不到）；
 *   2）明细里 `source_issue` 是当初发起链接的那一头；
 *   3）「看不到的票，链接就不显示」这条是用户文档对界面的说法；接口是否也按可见性过滤，
 *      没有核实过 —— 所以「读回来的行比预期少」也可能来自可见性，而不是我们筛掉了。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { Issue, RepositoryRef } from '../../contract/entities.js'
import type { OpResult, SubIssueList } from '../../contract/results.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import type { GlabClient, GlabRunResult } from './client.js'
import { classifyGlabError, failGlab } from './errors.js'
import { normalizeIssue } from './normalize.js'
import { linksPath } from './queries.js'
import { repoId } from './graph-blocking.js'
import { emitReadDegraded } from './read-log.js'

// 一张地图最多装多少张子票：与 GitHub 房同一个硬上限（契约 operations.ts:244「1000 张硬上限」）。
const MAX_SUB_ISSUES = 1000
// 链接表与链接明细都用这个超时；与房内其它读路径保持一致（issues.ts / graph-blocking.ts 都是 8000）。
const READ_TIMEOUT_MS = 8000

// 本房既有形状：仓库标识只取 partial，缺了按 404 那一档如实回而不是抛（与 issues.ts / labels.ts 同一份写法）。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 第四格两形都收：房间 create 时给的是 BackendContext，单次调用给的是 OpContext。
// 这样装配那一行就能照本房既有十几条那样原样写 `opCtx || ctx`，不必在调用处再加断言。
type CtxLike = Partial<OpContext> & Partial<BackendContext>
// 远端回包先收成袋再读：链接行里每一格都可缺可空，直接按定型读会把缺字段当成错。
type RawBag = Record<string, unknown>

/** 只认「对象」这一种形状：数组、null、字符串都不是袋，读不了就当形状不认识。 */
function asBag(v: unknown): RawBag | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as RawBag
}

/** 任意值转成能比较的字符串：null / undefined 一律给空串（不给 'null' 这种假值）。 */
function text(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/** 报错对象上的 message 取出来切成短串：catch 到的是 unknown，不能直接读成员。 */
function shortMessage(e: unknown): string {
  const eb = e as { message?: unknown } | null
  return text(eb && eb.message ? eb.message : e).slice(0, 200)
}

/** 这一头是不是列表行里那张「对面的票」：编号必须相等；有一边没给项目号时就只比编号。 */
function sameIssue(side: RawBag | null, iid: string, projectId: string): boolean {
  if (!side) return false
  if (text(side['iid']).trim() !== iid) return false
  const pid = text(side['project_id']).trim()
  if (!projectId || !pid) return true
  return pid === projectId
}

/**
 * 一段链接明细读回来之后的三种结论。
 *  · `peer`   ：对面那张票是链接的 source（它认这张地图为父），是本房认的子票 → 留下来；
 *  · `parent` ：对面那张票是链接的 target（地图自己是 source），它是这张地图自己的父票 → 不画；
 *  · `unknown`：分不出来（明细缺 source/target、两头都像或都不像、另一头不是这张地图）→ 记 dropped。
 */
type PeerSide = 'peer' | 'parent' | 'unknown'

/** 明细这一趟的三种结果：direction 是结论；transport / json 是「这一趟没读成」，两种都让整条读失败。 */
type LinkProbe =
  | { kind: 'direction'; direction: PeerSide }
  | { kind: 'transport'; res: GlabRunResult }
  | { kind: 'json'; res: GlabRunResult; message: string }

/**
 * 回读一行链接的方向（文件头「哪一头是父」那套判法的实现）。
 *
 * @param c glab 客户端（超时与工作目录都由它带）
 * @param id 仓库 refId
 * @param mapKey 这张地图的编号（iid 字符串）
 * @param row 列表里那一行；要的是它的 `iid` / `project_id`，用来认出「对面那张票」在哪一头
 * @param linkId 链接自己的编号（列表行的 `issue_link_id`，不是 `id`）
 */
async function probeLinkDirection(
  c: GlabClient,
  id: string,
  mapKey: string,
  row: RawBag,
  linkId: string,
): Promise<LinkProbe> {
  const path = `${linksPath(id, mapKey)}/${encodeURIComponent(linkId)}`
  // 同一行多试一次：这一台机器上 glab api 偶发网络抖动（房内写路径与 GitHub 房的每一页都是这么做的）。
  let res = await c.run(['api', path], { timeout: READ_TIMEOUT_MS })
  if (res.code !== 0) res = await c.run(['api', path], { timeout: READ_TIMEOUT_MS })
  if (res.code !== 0) return { kind: 'transport', res: res }
  let parsed: unknown
  try {
    parsed = JSON.parse(res.stdout || '')
  } catch (e) {
    // 明细回包不是 JSON：这一趟读不成立，交给调用方按 json 那一档记并整体失败（不拿半份数据往下走）。
    return { kind: 'json', res: res, message: shortMessage(e) }
  }
  const detail = asBag(parsed)
  const source = detail ? asBag(detail['source_issue']) : null
  const target = detail ? asBag(detail['target_issue']) : null
  // 明细里没有 source_issue / target_issue（形状不认识）：不猜，交 dropped。
  if (!source || !target) return { kind: 'direction', direction: 'unknown' }
  const peerIid = text(row['iid']).trim()
  const peerProjectId = text(row['project_id']).trim()
  const sourceIsPeer = sameIssue(source, peerIid, peerProjectId)
  const targetIsPeer = sameIssue(target, peerIid, peerProjectId)
  // 两头都像（跨项目同号）或两头都不像：分不出对面在哪一头，交 dropped。
  if (sourceIsPeer === targetIsPeer) return { kind: 'direction', direction: 'unknown' }
  const mapSide = sourceIsPeer ? target : source
  // 另一头必须就是这次要问的那张地图，否则这条明细与这一行对不上（形状不认识，不猜）。
  if (text(mapSide['iid']).trim() !== mapKey) return { kind: 'direction', direction: 'unknown' }
  // 约定（graph-membership.ts:97）：本房的 setParent 永远 POST 到子票那一头，子票是 source、父票是 target。
  // 所以对面在 source 里 ⇒ 它指向地图 ⇒ 它是子票；对面在 target 里 ⇒ 地图指向它 ⇒ 它是地图自己的父票。
  return { kind: 'direction', direction: sourceIsPeer ? 'peer' : 'parent' }
}

/**
 * listSubIssues(repo, mapKey, opts, ctx) -> OpResult<{items, total, fetched, capped, missing, dropped}>
 *
 * 六个字段的含义与读者（契约 `results.ts:161-185` 是唯一真源，这里只写这一房的取法）：
 *  · items  ：归一后的行（契约 `Issue` 形状，交给 `normalizeIssue`）。只装「本房认的子票」，
 *             即链接的 source 那一头是它的那些行；分不出方向的行不装；
 *  · total  ：本后端没有「总数」可读，取 fetched（见文件头）；
 *  · fetched：真正装进 items 的张数；
 *  · capped ：是否撞到 1000 张硬上限（撞到就停，界面据此说「还有更多，没全取回」）；
 *  · missing：恒为 0（见文件头）；
 *  · dropped：拿到了行却没能算进去的张数（形状不认识、编号解析不出来、方向分不出来）。
 *
 * 入参这一格收得比契约宽（`mapKey: unknown`）而运行时按编号校验：宿主电话那一层是 JavaScript，
 * 可能把编号给成数字；GitHub 房的同一条操作也是这么收的。第 4 格收两种上下文形状，理由见 `CtxLike`。
 */
export async function listSubIssues(
  repo: RepoLike,
  mapKey: unknown,
  opts: Record<string, never> | undefined,
  ctx: CtxLike | null | undefined,
): Promise<OpResult<SubIssueList>> {
  // 今天没有可选项；这一格留着是为了与契约的签名逐格对上（将来加选项不改签名）。
  void opts
  // 这一笔的起点：本条读的每一行降级日志都带「从入口到这里花了多久」。
  const t0 = Date.now()
  // 本房 read-log 出口的入参按契约收 OpContext，而第四格是「两形都收」的半份上下文，
  // 所以这里转一次、只用于落日志；运行时 read-log 只读 ctx.logEvent 与 ctx.opId 两格，转与不转一样。
  const logCtx = ctx as OpContext | null | undefined
  // 判档那一格只读 logEvent / isEnabled 两样，null 与 undefined 在这里同义（都是「没有上下文」）。
  const classifyCtx = ctx || undefined
  // 入参两格都没问题才起进程：这之前一个请求都没发，所以原文给空串（本房既有做法，见 graph-membership.ts:60）。
  const id = repoId(repo)
  const key = text(mapKey).trim()
  if (!id || !key) {
    emitReadDegraded(logCtx, 'subIssues', 'subIssues:repo-ref', Date.now() - t0)
    return fail(
      ERROR_KIND.NOTFOUND,
      `子票取数：repo.refId 或地图编号缺失、形状不对（repo=${id || '空'}，地图=${key || '空'}）`,
      '',
    )
  }
  try {
    const c = glabClient(ctx as Partial<OpContext> & Partial<BackendContext>)

    // ── 第一步：这张地图挂着的整张链接表。这个端点一次交回全部行，没有分页，也没有「总数」这一格。
    const listArgs = ['api', linksPath(id, key)]
    let listRes = await c.run(listArgs, { timeout: READ_TIMEOUT_MS })
    if (listRes.code !== 0) listRes = await c.run(listArgs, { timeout: READ_TIMEOUT_MS })
    if (listRes.code !== 0) {
      // 「这张票不在」与「这一趟没跑成」是两件事：日志里用两个不同的理由记，人一眼分得开。
      const verdict = classifyGlabError(listRes, classifyCtx)
      const notfound = verdict.kind === ERROR_KIND.NOTFOUND
      emitReadDegraded(logCtx, 'subIssues', notfound ? 'subIssues:notfound' : 'subIssues:transport', Date.now() - t0)
      return failGlab(
        listRes,
        notfound ? `子票取数：地图 #${key} 没找到（或没有权限看它）` : '子票取数：链接表没取回来',
        listRes,
        classifyCtx,
      )
    }
    let parsedList: unknown
    try {
      parsedList = JSON.parse(listRes.stdout || '')
    } catch (e) {
      emitReadDegraded(logCtx, 'subIssues', 'subIssues:json', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, `子票取数：链接表回包不是合法 JSON：${shortMessage(e)}`, listRes)
    }
    if (!Array.isArray(parsedList)) {
      emitReadDegraded(logCtx, 'subIssues', 'subIssues:shape', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, '子票取数：链接表不是一个数组（形状不对，不猜）', listRes)
    }
    const rows: unknown[] = parsedList

    const items: Issue[] = []
    let dropped = 0
    let capped = false
    // 已经画过的票（项目号 + 编号）：同一张票被挂了两次链接时只画一行 —— 界面按编号分组，
    // 重复行只会把张数算多。远端是否允许同一对票挂两条链接，我没有核实过（没跑过任何 glab 命令），
    // 这里按「画出来的行不重复」处理：这类行既不算 dropped（它没坏），也不会再画一行。
    // 只在真的画进去之后才记，免得「第一行判成父票、第二行判成子票」的正常情形被挡掉。
    const drawn = new Set<string>()
    for (const row of rows) {
      // 硬上限：到顶就停，并把这个事实带回去（界面据此明说只装了前 1000 张）。
      if (items.length >= MAX_SUB_ISSUES) {
        capped = true
        break
      }
      const bag = asBag(row)
      if (!bag) {
        dropped += 1
        continue
      }
      // 只认 relates_to（本房 setParent 写下的就是这一种）。link_type 缺失时按接口自己的默认值办：
      // 官方文档写明不传 link_type 时默认就是 relates_to。blocks / is_blocked_by 是 getDependencies
      // 那条能力的问题，这里跳过：它们既不是子票、也不算 dropped（没被丢掉，只是不在这条读的问题里）。
      const linkType = text(bag['link_type']).toLowerCase()
      if (linkType && linkType !== 'relates_to') continue
      const linkId = text(bag['issue_link_id']).trim()
      const peerKey = text(bag['iid']).trim()
      // `id` 不能拿来查明细：列表行里的 `id` 是**对面那张票**的编号，链接自己的编号在 `issue_link_id`。
      if (!linkId || !peerKey) {
        dropped += 1
        continue
      }
      // 这一行指向的那张票如果已经画过了，就不必再回读一次、也不再画第二行（见上面 drawn 的说明）。
      const drawnKey = `${text(bag['project_id']).trim()}#${peerKey}`
      if (drawn.has(drawnKey)) continue
      const probe = await probeLinkDirection(c, id, key, bag, linkId)
      if (probe.kind === 'transport') {
        // 不返回画了一半的地图：与 GitHub 房「任何一页失败就整体失败」是同一条纪律。
        emitReadDegraded(logCtx, 'subIssues', 'subIssues:page-fail', Date.now() - t0)
        return fail(
          ERROR_KIND.NETWORK,
          `子票取数：地图 #${key} 的一条关联明细没取回来（已重试一次），不拿半份数据往下走；` +
            `若这条一直出现，先核对列表行里哪个字段才是链接编号（这里按 issue_link_id 取，见文件头「未核实的地方」）`,
          probe.res,
        )
      }
      if (probe.kind === 'json') {
        emitReadDegraded(logCtx, 'subIssues', 'subIssues:json', Date.now() - t0)
        return fail(ERROR_KIND.PARSE, `子票取数：链接明细回包不是合法 JSON：${probe.message}`, probe.res)
      }
      if (probe.direction === 'peer') {
        try {
          items.push(normalizeIssue(bag))
          drawn.add(drawnKey)
        } catch {
          dropped += 1
        }
      } else if (probe.direction === 'unknown') {
        dropped += 1
      }
      // 'parent' 落在这里什么也不做：读到了、也认出来了，只是它不是子票（见文件头「哪一头是父」）。
    }

    // 「一行都没能算进去」与「这张地图真的没有子票」不能画成同一个样子：有候选行、却一行都没算进去，
    // 按形状不认识整体失败（理由用已登记的 subIssues:shape —— 回包或明细里缺这条读必须有的东西），
    // 让宿主退回快照那份行，而不是把「读不出来」画成「一张都没有」。
    // 真的没有候选行（例如这张地图自己只有一张父票、没有子票）时 dropped 是 0，照常回空，不误判。
    if (dropped > 0 && items.length === 0) {
      emitReadDegraded(logCtx, 'subIssues', 'subIssues:shape', Date.now() - t0)
      return fail(
        ERROR_KIND.PARSE,
        `子票取数：地图 #${key} 的关联行一行都没能算进去（${dropped} 行缺编号或缺字段、方向分不出来）`,
        listRes,
      )
    }

    const fetched = items.length
    // 总数：这个端点不给（见文件头），所以取 fetched；界面要说的「还有更多」由 capped 单独说。
    const total = fetched
    // missing：本后端结构上恒为 0（唯一能对不上的是被上限截断，那件事归 capped），如实写 0。
    const missing = 0
    // 「拉全了」这一趟不记；被上限截断的那一趟必须记：回的是成功，可这次只装了一部分。
    if (capped) emitReadDegraded(logCtx, 'subIssues', 'subIssues:truncated', Date.now() - t0)
    return { ok: true, data: { items: items, total: total, fetched: fetched, capped: capped, missing: missing, dropped: dropped } }
  } catch (e) {
    // 兜底：判档与话术都走本房唯一的出口（failGlab 内部按规则表判、按兜底规则挑话），原文交抛上来的那个错。
    emitReadDegraded(logCtx, 'subIssues', 'subIssues:transport', Date.now() - t0)
    return failGlab(e, `子票取数：${shortMessage(e)}`, e, classifyCtx)
  }
}

export default { listSubIssues }
