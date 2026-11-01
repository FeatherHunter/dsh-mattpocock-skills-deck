/**
 * src/refresh/rooms/host/probe-handler.ts —— 面板增量探针处理器（wf.probe 的处理体）。
 *
 * 为什么要有它（一句话）：增量探针原来是评论读写电话里的第六个电话，探针水印、窗口索引、
 * 行级增量的逻辑自成一体，留在一起改探针要读完整文件的上下文，拆出来之后探针只改这一个文件。
 *
 * 来源：src/refresh/rooms/host/comment-thread-fetch.ts 的 handleProbe（#1429 C3 拆分，只移动代码、
 * 行为零变化；D4 起宿主入口与门禁夹具都直连这里，comment-thread-fetch 不再暴露探针）。
 *
 * 不能改的约定（与原来完全一致）：
 * 1. 探针水印只在变化真的并进列表之后才推进（commitIssueIndex），没并进去时一个字节都不动，
 *    否则那条变化会被挤出下一次的扫描窗口，此后再也发现不了（原来文件头第 3 条）。
 * 2. since 语义：窗口索引返回 changed=true 才视为变化；GitHub 与 composer 两条路各走各的取数，
 *    配额仍走 REST 池，不烧穿。
 */
import { idOfParts } from '../../../tracker/kernel/identity-keys.js'
// #1584 F4：探针的 composer 分支原来也用注册表 describe 自己造身份，空 refId 会被当成「答出来了」；
// 给不出 refId 时改问会话（身份真源），拿不到再走原兜底。
import { resolveRepoRefForCwd } from '../../../tracker/session/repo-ref.js'
// #1689 降级取数的预算与节流：降级常驻时整仓探测从 5 秒放宽到 60 秒、自动校准至少隔 10 分钟。
// 两件事都挂在这条现有探测拍上判（下面用两个按 cwd 记的毫秒时刻），本文件不新建任何定时器。
import { calibrationDue, createFallbackRoundBudget, fallbackStandingOf, probeDue } from '../../kernel/fallback-fetch-budget.js'
import { FALLBACK_FETCH_LIMITS } from '../../kernel/host-budget.js'
// #1770：房间报「列表只取了第一页」用的事件名与原因值住在契约层（房间与宿主同一份），
// 探针这边不抄房间的内部字面量，也不依赖房间文件。
import { LIST_TRUNCATED_REASON, READ_DEGRADED_EVENT } from '../../../tracker/contract/results.js'

/** 探针处理器收到的依赖：目录归一、后端选择、注册表、平台、索引与缓存等，全由调用点显式传入。 */
export interface ProbeHandlerDeps {
  canonicalKey: any
  selectEarly: any
  isComposerSelection: any
  getTrackerRegistry: any
  getPlatform: any
  ctx: any
  // #1753：宿主侧「执行一条命令」的出口（检测与探针共用）。composer 分支建出来的上下文必须把它带进房间，
  //   否则 glabClient 见到空 exec 会直接按 127 回，外面再把 127 归成 network，界面就一直重试。
  //   这一格故意必填：宿主漏接线时由编译器在接线处拦住，不用等到真机上看见横幅才发现。
  detectionExec: any
  fetchIssueIndexWindowed: any
  issueIndexChanged: any
  rememberIssueIndex: any
  commitIssueIndex: any
  getCache: any
  setCache: any
  lastIssueIndexByRepo: any
  lastProbeAtByRepo: any
  deltaRefresh: any
  // #1472：写事件刚补好的快照（取走即删）。宿主入口与门禁调用方都必传；内部自己兜住异常与过期（回 null）。
  takeWritePatch: any
  errText: any
  /** #1584 F4：宿主注入的只读会话口；身份真源，注册表 describe 给不出 refId 时问它。 */
  openSession?: any
  // #1770：探针侧的日志口（与宿主其它接线同一份 `{ fire, isEnabled }`）。只用来把房间报的
  //   「列表只取了第一页」转成一行边沿日志；缺席时探针照旧工作，只是不记这一行。
  logCtx?: any
}

/** 造出探针电话：目前只有一个 handleProbe（wf.probe 的处理体）。 */
export function createProbeHandler(deps: ProbeHandlerDeps): { handleProbe: (args: any) => Promise<any> } {
  const { canonicalKey, selectEarly, isComposerSelection, getTrackerRegistry, getPlatform, ctx, detectionExec, fetchIssueIndexWindowed, issueIndexChanged, rememberIssueIndex, commitIssueIndex, getCache, setCache, lastIssueIndexByRepo, lastProbeAtByRepo, deltaRefresh, takeWritePatch, errText, openSession, logCtx } = deps
  // #1689：降级常驻时的两个节流时刻（毫秒），按 cwd 记。与 lastProbeAtByRepo 分开记，是因为后者
  //   的键要等取数回来才知道（owner/name），而节流必须在发出请求之前判；createProbeHandler 的实例
  //   由宿主入口 _probe() 记忆化，这份状态跨刷新拍安全。
  const fallbackProbeAtByCwd: Record<string, number> = {}
  const fallbackCalibrationAtByCwd: Record<string, number> = {}
  // #1770：按仓库记「截断日志已经记过一行」。房间每拍都会报「只取了第一页」，探针这一路
  //   只在状态从「没记过」变成「记过」时落一行；恢复（下一次不截断）时清掉，下次再截断还能看见。
  const truncationLoggedByRepo: Record<string, boolean> = {}
  // #1772：按仓库记增量游标（上一趟见过的最大 updated_at）。进程内状态，不落盘：进程重启后
  //   游标为空，下一拍会先用一次有界全量读重建索引与游标，之后才走 updated_after 增量。
  //   键与 lastIssueIndexByRepo 同一个（backendId + ':' + cwd），两处状态不会串。
  const incrementalCursorByRepo: Record<string, string> = {}
  // #1418：失败回包里带上判档（network / unsupported / env / exception…），客户端日志据此一眼看出「这一拍
  //   为什么没探成」。只回短枚举、不回原文 —— 原文仍在 error 字段里给界面看，日志那边一个字都不记。
  const kindOf = function (e: any): string {
    if (!e || typeof e !== 'object') return ''
    try { return String((e as any).kind || '') } catch (eK) { return '' }
  }
  // #1772：探针索引的票号键。effort 维度不能丢：两个 effort 的同号票会互相覆盖，第二个 effort
  //   的变更就永远探测不到。
  const issueKeyOf = function (it: any): string {
    if (!it) return ''
    if (it.key != null) return idOfParts(it.effortId, String(it.key).padStart(2, '0'))
    if (it.number != null) return idOfParts(it.effortId, String(it.number).padStart(2, '0'))
    return ''
  }
  // #1772：索引值从「只有 state」改成「state|updatedAt」。只记状态时，标题/标签/指派这类
  //   「状态没变但票面变了」的修改永远看不出变化；updated_at 一动就说明这张票值得重建。
  const issueIndexValueOf = function (it: any): string {
    const state = String((it && it.state) || 'OPEN').toUpperCase()
    const updated = it && it.updatedAt != null ? String(it.updatedAt) : ''
    return state + '|' + updated
  }
  // #1772：增量游标取这一趟见过的最大 updated_at；全是空或非法时间时回空串，
  //   下一拍继续走全量读 —— 宁可比原来多翻几页，也不许把变化挤出窗口。
  const maxUpdatedAtOf = function (rows: any[]): string {
    let best = ''
    let bestTs = -Infinity
    rows.forEach(function (it: any) {
      const raw = it && it.updatedAt != null ? String(it.updatedAt) : ''
      if (!raw) return
      const ts = Date.parse(raw)
      if (Number.isNaN(ts) || ts <= bestTs) return
      bestTs = ts
      best = raw
    })
    return best
  }
  // v1.5 R2（#2 MVP）：probe 改用 `since` 时间戳探测全 issue 增量（地图 + 子票 + 其他），
  //   1 次 REST 调用覆盖全仓库变化。原实现 `labels=wayfinder:map` 仅匹配地图本身，
  //   **漏检所有子票变化**——面板可接/阻塞/已认领/已关闭分组（docs/archive/DESIGN.md §5.2）都是子票，
  //   故"列表不更新状态"。since 语义：返回数组非空 = 自上次快照以来有变化 → 视为 changed。
  //   配额仍走 REST 5000/h 池（独立于 GraphQL 5000 点/h），不烧穿。
  async function handleProbe(args: any): Promise<any> {
    // #1003 空目录闸：同上。
    const _rawProbeCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawProbeCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。', errorKind: 'env' }
    const cwd: any = await canonicalKey(_rawProbeCwd)
    // #1472：写事件刚补好的快照优先 —— deck_* 写工具成功之后行级增量已经补过那一行，
    // 下一次探针直接把这份交出去，一次窗口探测都不用发（真机以前要等下一次整份重建才算数）。
    // 只交一次（取走即删，语义在 src/refresh/rooms/host/write-event-fetch.ts）；没有就回 null，照旧往下走。
    // 放在后端分发之前：补丁那一侧已经按后端取过数，这份结果与「这一次该问哪个后端」无关。
    // takeWritePatch 自己已兜住补丁侧的异常与过期（回 null 并记日志）；这里包一层是因为宿主注入的
    // 那个函数还套着「异步取接线」的一层，那一层本身可能失败 —— 失败就按没有补丁处理，照旧走窗口探测。
    let _wp: any = null
    try { _wp = await takeWritePatch(cwd) } catch (eWP: any) { _wp = null }
    if (_wp && _wp.snapshot) {
      return {
        ok: true, changed: true, mode: 'patch', rows: _wp.rows || [], version: _wp.version,
        queries: _wp.queries || 0, partial: _wp.partial === true, snapshot: _wp.snapshot,
        // since 用补丁自己记下的时刻（客户端拿它当下一拍的水印），不是此刻：此刻会越过补丁覆盖的那段窗口。
        since: (typeof _wp.at === 'number' && _wp.at > 0) ? new Date(_wp.at).toISOString() : '',
      }
    }
    // 第一性原理分发：经 index 从会话启停模块转供给共享判据（H4 同例），不各留一份拷贝。
    // markdown 等走轻量 list 探针，github 仍走 gh issue index
    const _selProbe: any = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
    const useProbeTracker: any = isComposerSelection(_selProbe)
    if (useProbeTracker) {
      try {
        const reg: any = await getTrackerRegistry()
        const tracker: any = reg.get(_selProbe.backendId)
        if (tracker && typeof tracker.list === 'function') {
          // #1753：装配缺件要如实说成 env。没有这根线时房间会因空 exec 回 127，外面再把 127 归成网络故障，
          //   界面于是每 5 秒重试并常驻「刷新失败」——错的是接线，不是网络，报错必须指到接线这一层。
          if (typeof detectionExec !== 'function') return { ok: false, error: '探针缺少执行器装配：宿主没有把「执行命令」的能力传给探针，这是插件内部接线问题，不是网络故障。', errorKind: 'env' }
          let repoRef: any = null
          try { repoRef = reg.describe({ cwd }, _selProbe.backendId) } catch {}
          // #1584 F4：空 refId 的壳不算身份；先问会话，拿不到再走原兜底（不改变无会话时的旧行为）。
          if (!repoRef || !repoRef.refId) {
            const identified = await resolveRepoRefForCwd({ cwd, backendId: _selProbe.backendId, describe: reg.describe, openSession })
            if (identified) repoRef = identified
          }
          if (!repoRef) repoRef = { backend: _selProbe.backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || _selProbe.backendId, url: '' }
          // #1770 起，探针这一路只接「名单没读全」这一条降级线。房间的 list 没读全时会调
          //   opCtx.logEvent('warn','read.degraded',{op:'list',reason:'list:truncated',...})；探针把它
          //   转给宿主日志口，并按仓库边沿式去重 —— 5 秒一拍每拍都记会把警告日志刷成心跳。
          //   其它降级原因不在探针这一路记（取数失败本身已由 ok:false 报给界面），桥里直接丢弃。
          const rk1: string = _selProbe.backendId + ':' + cwd
          const logTruncation = function (level: any, event: any, fields: any): void {
            if (!logCtx || typeof logCtx.fire !== 'function') return
            if (event !== READ_DEGRADED_EVENT || !fields || String(fields.reason || '') !== LIST_TRUNCATED_REASON) return
            if (truncationLoggedByRepo[rk1]) return
            truncationLoggedByRepo[rk1] = true
            try { logCtx.fire(level, event, fields) } catch (eL) {}
          }
          const opCtx: any = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: function (c: any, ar: any, o: any): any { return detectionExec(c, ar, o, 'probe') }, logEvent: logTruncation }
          // #1772：每一拍最多发一个列表请求。第一次没有游标时先做一次有界全量读（房间自己最多翻
          //   5 页）建索引与游标；之后每拍用 updated_after=<上一趟见过的最大 updated_at> 读增量。
          //   增量那页取满说明还有积压，下一拍从新游标继续 —— 不在一拍里翻多页，节拍仍是 5/15/60 秒。
          const cursor: string = typeof incrementalCursorByRepo[rk1] === 'string' ? incrementalCursorByRepo[rk1] : ''
          const r: any = await tracker.list(repoRef, cursor ? { since: cursor } : {}, opCtx)
          if (!r || !r.ok) return { ok: false, error: errText((r && r.error) || 'probe list 失败'), errorKind: kindOf(r && r.error) }
          // 这一拍不截断了：清掉「已记过」标记，下次再截断还能落一行。
          if (r.truncated !== true) delete truncationLoggedByRepo[rk1]
          const all: any[] = Array.isArray(r.data) ? r.data : []
          const known: any = lastIssueIndexByRepo[rk1] || {}
          // 索引：票号 -> state|updated_at。全量读重建一份；增量读在上一份上合并，绝不清空 ——
          //   增量只回窗口里变过的票，清空会把没变的票从索引里抹掉，下一拍就会误报「全变了」。
          const idx: Record<string, string> = {}
          // count 是这一拍按票号去重后见到的票数：全量读=全部票，增量读=去重后的新票
          //   （旧代码是读回的行数，只在同一页里出现重复票时两者不同，这里按「重复票按票号去重」算）。
          let count: number = 0
          let nextCursor: string = cursor
          // 首拍全量若撞到 500 张上限，游标仍按见过的最大 updated_at 前进；500 之外没进索引的票
          //   这一轮探测不到，这是全量读上限的已知代价（快照重建那条路同样是 500 张）。
          if (!cursor) {
            all.forEach(function (it: any) { const k = issueKeyOf(it); if (k) idx[k] = issueIndexValueOf(it) })
            nextCursor = maxUpdatedAtOf(all)
            count = all.length
          } else {
            // 只并旧键、不删键：增量窗口里看不见删票，删掉的票会留在索引里；下一次有界全量
            //   重建（例如进程重启）才会清掉。这是增量读换来的局限，别在别处假设索引是全集。
            Object.keys(known).forEach(function (k: string) { idx[k] = known[k] })
            const seen: Record<string, boolean> = {}
            all.forEach(function (it: any) {
              const k = issueKeyOf(it)
              // updated_after 含边界：上一趟最后一刻的票会被重新取回，按票号去重只并一次。
              if (!k || seen[k]) return
              seen[k] = true
              count += 1
              idx[k] = issueIndexValueOf(it)
            })
            nextCursor = maxUpdatedAtOf(all) || cursor
          }
          // 变化判定：索引值里带 updatedAt，所以状态没变、只是标题/标签/指派改过的票也能发现。
          const changed: any = issueIndexChanged(known, idx)
          rememberIssueIndex({ owner: _selProbe.backendId, name: cwd }, idx)
          // 兼容 remember 的 repoKey 形态：用 backendId+cwd 作 key，避免与 github 的 owner/name 串
          lastIssueIndexByRepo[rk1] = idx
          incrementalCursorByRepo[rk1] = nextCursor
          lastProbeAtByRepo[rk1] = new Date().toISOString()
          if (changed) setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
          return { ok: true, changed: changed, repo: { owner: _selProbe.backendId, name: String(cwd).split(/[\\/]/).pop()||'' }, count: count, since: lastProbeAtByRepo[rk1] }
        }
      } catch (e: any) { return { ok: false, error: errText(e), errorKind: 'exception' } }
    }
    try {
      // 增量索引（本轮新增）：改走 fetchIssueIndexWindowed —— 它只回答「自上次以来有没有变」，
      //   并把增量并进完整基线后给出 changed。这里不再自己维护一份基线、也不再自行比对：
      //   两份状态会各自漂移，而漂移的后果是面板长期显示旧数据且不报错（静默漏报，最难查）。
      // #723（T19c）第 E 件：探测说变了之后，**先把变的那几条补进列表**（src/refresh/rooms/host/row-patch.js 的
      //   行级增量：一张票一条薄查询），再回给客户端那一份补好的结果 —— 从前这一步没人做，
      //   客户端只能整池重建，于是「只补变的那几条」那条窄路白写了。
      //   水印只在这一步真的并进列表之后才推进（commitIssueIndex），被推迟 / 被丢弃 / 失败时
      //   一个字节都不动 —— 否则那条变化会被挤出下一次的扫描窗口，此后再也发现不了。
      // #1689 降级常驻的节流与预算：快照明确写着走 REST 兜底通道（fallback:'rest'）时，
      //   整仓探测从 5 秒放宽到 60 秒、自动校准至少隔 10 分钟，两件事都在这条现有探测拍上判。
      //   主路正常时 degraded 恒假，这一段一条请求都不多发，行为与改造前一致。
      const _cacheNow: any = (typeof getCache === 'function') ? getCache(cwd) : null
      const degraded: boolean = fallbackStandingOf(_cacheNow && _cacheNow.snapshot)
      const nowMs: number = Date.now()
      if (degraded) {
        if (calibrationDue(nowMs, fallbackCalibrationAtByCwd[cwd], FALLBACK_FETCH_LIMITS)) {
          // 到点校准：把缓存清脏后如实告诉客户端「这一拍得整仓重取」。客户端收到 changed+mode 就走了
          //   既有的 loadSnapshot(primary,true,true) 那一支，也就是一次完整枚举（上限 16 条请求，常量在
          //   host-budget.ts）；下一次校准至少 10 分钟后才可能再来。
          fallbackCalibrationAtByCwd[cwd] = nowMs
          fallbackProbeAtByCwd[cwd] = nowMs
          setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
          return { ok: true, changed: true, mode: 'calibrate', reason: 'fallback-calibration-due', count: 0, since: new Date(nowMs).toISOString() }
        }
        if (!probeDue(nowMs, fallbackProbeAtByCwd[cwd], degraded, FALLBACK_FETCH_LIMITS)) {
          // 60 秒窗口内：这一拍不发任何请求，如实回「没变」（客户端对 changed:false 直接原地不动）。
          return { ok: true, changed: false, mode: 'throttled', reason: 'fallback-probe-window', count: 0, since: new Date(fallbackProbeAtByCwd[cwd]).toISOString() }
        }
      }
      // #1689 增量轮预算：降级时这一轮开一本增量账本（上限 3 条）。窗口探测的真实请求在取数层
      //   （issue-list-fetch 的 fetchIssueIndex）逐页预扣、收到校正、失败回填，这里只把同一本账传下去；
      //   探针这一层不再自己预扣一条（否则一页只记一笔，多页就账实不符）。
      //   整仓枚举（重启后第一拍没有窗口）不拿这本增量账去卡：取数层见「无 since」会自己开「完整枚举 16 条」那本。
      const roundBudget: any = degraded ? createFallbackRoundBudget({ kind: 'increment', limits: FALLBACK_FETCH_LIMITS }) : null
      const remote: any = await fetchIssueIndexWindowed(cwd, roundBudget ? { budget: roundBudget } : undefined)
      // 窗口探测被本轮预算拦住时，取数层回 truncated 并带账本读数；这里翻译成「这一拍先不探」，
      //   而不是当网络失败往上抛。出站请求一条都没多出去（预扣不到时取数层根本没发）。
      if (roundBudget && remote && remote.ok === false && remote.budget && remote.budget.refused > 0) {
        return { ok: true, changed: false, mode: 'throttled', reason: 'fallback-budget-exhausted', count: 0, since: '' }
      }
      if (!remote || remote.ok !== true) return { ok: false, error: errText((remote && remote.error) || 'probe 失败'), errorKind: kindOf(remote && remote.error) }
      const repo: any = remote.repo
      const rk1: string = repo.owner + '/' + repo.name
      const changed: boolean = remote.changed === true
      // 这一拍真的探过了：降级窗口从这里重新起算（失败的探不推窗口，下一拍仍会重试）。
      if (degraded) fallbackProbeAtByCwd[cwd] = nowMs
      lastProbeAtByRepo[rk1] = new Date().toISOString()
      const commit: any = function (): any { try { return commitIssueIndex(cwd, remote.nextWatermarkMs, remote.index) } catch (eC: any) { return null } }
      if (!changed) {
        // 没变 = 列表与远端一致，推水印（与基线）是安全的（不推就要每拍重扫同一个窗口）。
        commit()
        return { ok: true, changed: false, repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
      }
      let delta: any = null
      // #1689：降级常驻时把这一轮的预算本子一起交下去 —— 薄行补取（row-patch → thin-row-fetch）
      //   每发一条都从这里预扣、校正、失败回填，与窗口探测的翻页记在同一本账上（一轮 ≤3 条）。
      const deltaOpts: any = degraded ? { fallbackBudget: roundBudget } : {}
      try { delta = (typeof deltaRefresh === 'function') ? await deltaRefresh(cwd, deltaOpts) : null } catch (eD: any) { delta = null }
      if (delta && delta.mode === 'patch' && delta.rows && delta.rows.length) {
        // 并进列表了：水印与基线跟着走，客户端直接用这一份（不再发整池大查询）。
        commit()
        const cur: any = (typeof getCache === 'function') ? getCache(cwd) : null
        return {
          ok: true, changed: true, mode: 'patch', repo: repo, count: remote.count,
          rows: delta.rows, version: delta.version, queries: delta.queries, partial: delta.partial === true,
          snapshot: (cur && cur.snapshot) ? cur.snapshot : null, since: lastProbeAtByRepo[rk1],
        }
      }
      if (delta && delta.mode === 'nothing') {
        commit()
        return { ok: true, changed: false, mode: 'nothing', repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
      }
      if (delta && (delta.mode === 'deferred' || delta.mode === 'failed' || delta.mode === 'stale-dropped')) {
        // 没并进去：水印与基线一个字节都不动 —— 那条变化下一次仍然在窗口里、仍然会被发现；
        // 客户端这一拍什么都不用做（它就靠这个「没并进去」的回报原地不动）。
        return { ok: true, changed: true, mode: delta.mode, reason: String(delta.reason || ''), pending: delta.pending || 0, repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
      }
      // 该整池的那几档（冷启动 / 票号增减 / 条数过多 / 旧结构）：如实告诉客户端「这一次得整池」。
      // 这一档推水印与基线：客户端收到之后就会整池重建，那一次会把整仓重拿一遍，变化是被并进列表的
      // （不推的话每一拍都要从很旧的水印重扫，白烧额度）。
      if (changed) setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
      commit()
      return { ok: true, changed: true, mode: 'rebuild', reason: String((delta && delta.reason) || 'no-delta'), repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
    } catch (e: any) { return { ok: false, error: errText(e), errorKind: 'exception' } }
  }
  return { handleProbe }
}
