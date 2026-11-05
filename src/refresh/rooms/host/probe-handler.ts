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
 * 3. #1891（规格 #1885 S4）：wf.probe 回包不再带整份快照 —— 读契约把它定成「版本 + 是否变化 + 变化的
 *    行号（或该整份了）」，数据由客户端按库版本经 wf.snapshotChanges 取走。1000 张票的整份快照约 411 KB，
 *    每五秒跨进程传一次正是这一期要消掉的东西；本文件两处 patch 返回点因此都不再拼 snapshot 字段，
 *    其余字段（ok / changed / mode / rows / version / queries / partial / since / reason / pending / count）
 *    与改造前逐字相同。
 */
import { idOfParts } from '../../../tracker/kernel/identity-keys.js'
// #1584 F4：探针的 composer 分支原来也用注册表 describe 自己造身份，空 refId 会被当成「答出来了」；
// 给不出 refId 时改问会话（身份真源），拿不到再走原兜底。
import { resolveRepoRefForCwd } from '../../../tracker/session/repo-ref.js'
// #1689 降级取数的预算与节流：降级常驻时整仓探测从 5 秒放宽到 60 秒、自动校准至少隔 10 分钟。
// 两件事都挂在这条现有探测拍上判（下面用两个按 cwd 记的毫秒时刻），本文件不新建任何定时器。
import { calibrationDue, createFallbackRoundBudget, probeDue } from '../../kernel/fallback-fetch-budget.js'
import { FALLBACK_FETCH_LIMITS } from '../../kernel/host-budget.js'
// #1770：房间报「列表只取了第一页」用的事件名与原因值住在契约层（房间与宿主同一份），
// 探针这边不抄房间的内部字面量，也不依赖房间文件。
import { LIST_TRUNCATED_REASON, READ_DEGRADED_EVENT } from '../../../tracker/contract/results.js'
// #1835：探测失败的「同一段只记一条」判重与写历史的兜错，与快照取数那一路共用一份实现。
import { createFailureSegmentNotes } from './failure-segment-notes.js'

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
  /**
   * #1893：这个工作区当前是不是「降级常驻」（REST 兜底通道）——由采纳快照那一步记下来的一个小布尔，
   * 不是整份快照。探针拿它判 60 秒探测窗口与 10 分钟校准窗口（#1689）。缺席时按「没降级」处理。
   */
  degradedStandingOf?: any
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
  // #1835：失败历史的口（与宿主刷新失败共用同一个事件库）。探测失败以前只有界面上的失败标识、
  //   没有历史，事后查不到「哪个环节、什么时候、为什么」。这里只在「这一段失败」的第一次失败记
  //   一条；恢复（真的探成功一次）后清标记，下一段再失败才又记。缺席时探针照旧工作，只是没有历史。
  noteRefreshFailure?: any
  /**
   * #1898：已关闭/已合并拉取请求的补取（实现住 issue-list-fetch.ts，自带 10 分钟节拍与一页上限）。
   * 探针这一拍探成之后顺手调它一次；缺席时探针照旧工作，只是不补这一页（老装配与门禁不受影响）。
   */
  refreshClosedPulls?: any
  /**
   * #1885 评审修复（规格 I2）：读回包要带库版本。门面缺席时这一格不挂（老装配与门禁照旧工作）。
   * 只读版本，不写任何库内容。
   */
  getSnapshotLibrary?: (() => Promise<any> | any) | null
}

/** 造出探针电话：目前只有一个 handleProbe（wf.probe 的处理体）。 */
export function createProbeHandler(deps: ProbeHandlerDeps): { handleProbe: (args: any) => Promise<any> } {
  const { canonicalKey, selectEarly, isComposerSelection, getTrackerRegistry, getPlatform, ctx, detectionExec, fetchIssueIndexWindowed, issueIndexChanged, rememberIssueIndex, commitIssueIndex, degradedStandingOf, lastIssueIndexByRepo, lastProbeAtByRepo, deltaRefresh, takeWritePatch, errText, openSession, logCtx, noteRefreshFailure, refreshClosedPulls, getSnapshotLibrary } = deps
  // #1689：降级常驻时的两个节流时刻（毫秒），按 cwd 记。与 lastProbeAtByRepo 分开记，是因为后者
  //   的键要等取数回来才知道（owner/name），而节流必须在发出请求之前判；createProbeHandler 的实例
  //   由宿主入口 _probe() 记忆化，这份状态跨刷新拍安全。
  const fallbackProbeAtByCwd: Record<string, number> = {}
  const fallbackCalibrationAtByCwd: Record<string, number> = {}
  // #1770：按仓库记「截断日志已经记过一行」。房间每拍都会报「只取了第一页」，探针这一路
  //   只在状态从「没记过」变成「记过」时落一行；恢复（下一次不截断）时清掉，下次再截断还能看见。
  const truncationLoggedByRepo: Record<string, boolean> = {}
  // #1835：失败段记历史（同一段探测失败只记一条）。5 秒一拍连续失败不会刷历史；段内记过就不再写，
  // 真的探成功一次才清标记。这里只判「这一趟算不算真的探成功」，判重与兜错在 failure-segment-notes。
  const failureNotes = createFailureSegmentNotes(noteRefreshFailure)
  // #1418：失败回包里带上判档（network / unsupported / env / exception…），客户端日志据此一眼看出「这一拍
  //   为什么没探成」。只回短枚举、不回原文 —— 原文仍在 error 字段里给界面看，日志那边一个字都不记。
  const kindOf = function (e: any): string {
    if (!e || typeof e !== 'object') return ''
    try { return String((e as any).kind || '') } catch (eK) { return '' }
  }
  // v1.5 R2（#2 MVP）：probe 改用 `since` 时间戳探测全 issue 增量（地图 + 子票 + 其他），
  //   1 次 REST 调用覆盖全仓库变化。原实现 `labels=wayfinder:map` 仅匹配地图本身，
  //   **漏检所有子票变化**——面板可接/阻塞/已认领/已关闭分组（docs/archive/DESIGN.md §5.2）都是子票，
  //   故"列表不更新状态"。since 语义：返回数组非空 = 自上次快照以来有变化 → 视为 changed。
  //   配额仍走 REST 5000/h 池（独立于 GraphQL 5000 点/h），不烧穿。
  /**
   * 这一拍对应的库版本（#1885 评审修复，规格 I2）。身份优先用调用方已经算出来的那两格；
   * 没有时（写事件补丁、降级节流那几档）再走同一条身份补齐链问一次，问不到就不挂版本。
   * 这条只在探测成功、真正要交回包时调一次，不是每拍都问。
   */
  async function libraryVersionFor(reply: any, cwdRef: { cwd?: string, backendId?: string, repoIdentity?: string }): Promise<any> {
    if (!reply || reply.ok !== true || typeof getSnapshotLibrary !== 'function') return reply
    const cwd = String(cwdRef.cwd || '')
    if (!cwd) return reply
    let backendId = String(cwdRef.backendId || '')
    let repoIdentity = String(cwdRef.repoIdentity || '')
    if (!backendId) {
      try { const sel: any = await selectEarly({ cwd }) ; backendId = String((sel && sel.backendId) || '') } catch (e) { backendId = '' }
    }
    if (!backendId) return reply
    if (!repoIdentity) {
      try {
        const reg: any = await getTrackerRegistry()
        const ref: any = await resolveRepoRefForCwd({
          cwd,
          backendId,
          describe: (reg && typeof reg.describe === 'function') ? reg.describe : null,
          openSession,
        })
        repoIdentity = String((ref && ref.refId) || '')
      } catch (e) { repoIdentity = '' }
    }
    if (!repoIdentity) return reply
    try {
      const lib: any = await Promise.resolve(getSnapshotLibrary())
      if (!lib || typeof lib.readLibraryVersion !== 'function') return reply
      const version = await Promise.resolve(lib.readLibraryVersion({ workspaceRoot: cwd, backend: backendId, repoIdentity }))
      if (typeof version === 'number' && Number.isInteger(version) && version >= 0) reply.version = version
    } catch (e) { /* 版本读不到就不挂：不拿 0 冒充版本 */ }
    return reply
  }
  async function handleProbeOnce(args: any, cwdRef: { cwd: string, backendId?: string, repoIdentity?: string }): Promise<any> {
    // #1003 空目录闸：同上。
    const _rawProbeCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawProbeCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。', errorKind: 'env' }
    const cwd: any = await canonicalKey(_rawProbeCwd)
    // #1835：外层包装要知道这一趟落在哪个工作区；空 cwd 在上面已经早退，走不到这里。
    const _probeCwd = String(cwd == null ? '' : cwd)
    if (_probeCwd) cwdRef.cwd = _probeCwd
    // #1472：写事件刚补好的补丁优先 —— deck_* 写工具成功之后行级增量已经补过那一行，
    // 下一次探针直接把这份交出去，一次窗口探测都不用发（真机以前要等下一次整份重建才算数）。
    // 只交一次（取走即删，语义在 src/refresh/rooms/host/write-event-fetch.ts）；没有就回 null，照旧往下走。
    // 放在后端分发之前：补丁那一侧已经按后端取过数，这份结果与「这一次该问哪个后端」无关。
    // takeWritePatch 自己已兜住补丁侧的异常与过期（回 null 并记日志）；这里包一层是因为宿主注入的
    // 那个函数还套着「异步取接线」的一层，那一层本身可能失败 —— 失败就按没有补丁处理，照旧走窗口探测。
    let _wp: any = null
    try { _wp = await takeWritePatch(cwd) } catch (eWP: any) { _wp = null }
    // #1891：判定标准从「补丁里带着快照」换成「有补丁」—— 快照不再随探针回包走（客户端按库版本取变化），
    //   而 takeWritePatch 只在真的补成、没过期、还没被取走时才回值，所以它本身就是要不要走这一支的凭据。
    if (_wp) {
      return {
        ok: true, changed: true, mode: 'patch', rows: _wp.rows || [], version: _wp.version,
        queries: _wp.queries || 0, partial: _wp.partial === true,
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
          // #1885 评审修复：这一支的身份已经算出来了，回包版本直接用它，不再开会话问一遍。
          cwdRef.backendId = String(_selProbe.backendId || '')
          cwdRef.repoIdentity = String((repoRef && repoRef.refId) || '')
          // #1770：探针这一路只接「名单被页上限截断」这一条降级线。房间的 list 取满一页会调
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
          const r: any = await tracker.list(repoRef, {}, opCtx)
          if (!r || !r.ok) return { ok: false, error: errText((r && r.error) || 'probe list 失败'), errorKind: kindOf(r && r.error) }
          // 这一拍不截断了：清掉「已记过」标记，下次再截断还能落一行。
          if (r.truncated !== true) delete truncationLoggedByRepo[rk1]
          const all: any[] = Array.isArray(r.data) ? r.data : []
          // 轻量索引：key -> state
          const idx: Record<string, string> = {}
          // effort 维度：探针索引按 (effort, 编号) 键入，否则两个 effort 的同号票会互相覆盖、第二个 effort 的变更探测不到
          all.forEach(function(it: any){ const k: any = it && (it.key != null ? idOfParts(it.effortId, String(it.key).padStart(2,'0')) : (it.number != null ? idOfParts(it.effortId, String(it.number).padStart(2,'0')) : '')); if(k) idx[k] = String(it.state||'OPEN').toUpperCase() })
          const known: any = lastIssueIndexByRepo[rk1] || {}
          const changed: any = issueIndexChanged(known, idx)
          rememberIssueIndex({ owner: _selProbe.backendId, name: cwd }, idx)
          // 兼容 remember 的 repoKey 形态：用 backendId+cwd 作 key，避免与 github 的 owner/name 串
          lastIssueIndexByRepo[rk1] = idx
          lastProbeAtByRepo[rk1] = new Date().toISOString()
          // #1893：内存副本已删，这一拍不再需要「标脏」——客户端按库版本取变化，探针只回「变了哪几行」。
          return { ok: true, changed: changed, repo: { owner: _selProbe.backendId, name: String(cwd).split(/[\\/]/).pop()||'' }, count: all.length, since: lastProbeAtByRepo[rk1] }
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
      // #1893：降级事实由「采纳快照」那一步记下来的小布尔提供，不再从宿主内存里的整份快照读。
      // 没接这一格时按「没降级」处理：探针照常 5 秒一拍，不因为接线缺席而自己放宽或收紧窗口。
      const degraded: boolean = (typeof degradedStandingOf === 'function') ? degradedStandingOf(cwd) === true : false
      const nowMs: number = Date.now()
      if (degraded) {
        cwdRef.backendId = String((_selProbe && _selProbe.backendId) || '')
        if (calibrationDue(nowMs, fallbackCalibrationAtByCwd[cwd], FALLBACK_FETCH_LIMITS)) {
          // 到点校准：把缓存清脏后如实告诉客户端「这一拍得整仓重取」。客户端收到 changed+mode 就走了
          //   既有的 loadSnapshot(primary,true,true) 那一支，也就是一次完整枚举（上限 16 条请求，常量在
          //   host-budget.ts）；下一次校准至少 10 分钟后才可能再来。
          fallbackCalibrationAtByCwd[cwd] = nowMs
          fallbackProbeAtByCwd[cwd] = nowMs
          // #1893：不再有内存副本可标脏；客户端收到 changed + mode 就走了既有的整份重取分支。
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
      // #1870：把这一轮的后端编号一并交下去——重启后第一次扫描要靠它去开对的那个快照库文件取起点，
      // 在这一层点名比让取数层自己开会话去问便宜（开会话会走远端定位，可能花一条出站额度）。
      const probeOpts: any = roundBudget ? { budget: roundBudget } : {}
      probeOpts.backendId = String((_selProbe && _selProbe.backendId) || '')
      const remote: any = await fetchIssueIndexWindowed(cwd, probeOpts)
      // 窗口探测被本轮预算拦住时，取数层回 truncated 并带账本读数；这里翻译成「这一拍先不探」，
      //   而不是当网络失败往上抛。出站请求一条都没多出去（预扣不到时取数层根本没发）。
      if (roundBudget && remote && remote.ok === false && remote.budget && remote.budget.refused > 0) {
        return { ok: true, changed: false, mode: 'throttled', reason: 'fallback-budget-exhausted', count: 0, since: '' }
      }
      if (!remote || remote.ok !== true) return { ok: false, error: errText((remote && remote.error) || 'probe 失败'), errorKind: kindOf(remote && remote.error) }
      const repo: any = remote.repo
      // #1885 评审修复：这一支的库身份就在 remote 上（窗口扫描的同一份），回包版本读它。
      cwdRef.backendId = String(probeOpts.backendId || '')
      cwdRef.repoIdentity = String(remote.repoIdentity || (repo.owner + '/' + repo.name))
      const rk1: string = repo.owner + '/' + repo.name
      const changed: boolean = remote.changed === true
      // 这一拍真的探过了：降级窗口从这里重新起算（失败的探不推窗口，下一拍仍会重试）。
      if (degraded) fallbackProbeAtByCwd[cwd] = nowMs
      lastProbeAtByRepo[rk1] = new Date().toISOString()
      // #1887：完整枚举（没有窗口起点）且这一趟的行真的写进库，才在采用之后把「上一次完整枚举时刻」写库。
      // 窗口扫描、被页上限或预算截断（那几趟到不了这里）、被推迟/丢弃的都不满足，完整度保持「已知」。
      const commit: any = async function (): Promise<any> {
        try {
          return await commitIssueIndex(cwd, remote.nextWatermarkMs, remote.index, {
            fullEnumeration: remote.full === true && remote.persisted !== false,
            backendId: String((_selProbe && _selProbe.backendId) || ''),
            repoIdentity: String(remote.repoIdentity || ''),
          })
        } catch (eC: any) { return null }
      }
      if (!changed) {
        // 没变 = 列表与远端一致，推水印（与基线）是安全的（不推就要每拍重扫同一个窗口）。
        await commit()
        return { ok: true, changed: false, repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
      }
      let delta: any = null
      // #1689：降级常驻时把这一轮的预算本子一起交下去 —— 薄行补取（row-patch → thin-row-fetch）
      //   每发一条都从这里预扣、校正、失败回填，与窗口探测的翻页记在同一本账上（一轮 ≤3 条）。
      const deltaOpts: any = degraded ? { fallbackBudget: roundBudget } : {}
      try { delta = (typeof deltaRefresh === 'function') ? await deltaRefresh(cwd, deltaOpts) : null } catch (eD: any) { delta = null }
      if (delta && delta.mode === 'patch' && delta.rows && delta.rows.length) {
        // 并进列表了：水印与基线跟着走。客户端按库版本取变化，不再等这一份整份快照（#1891）：
        //   回包只带变化的行号与版本，数据本身走 wf.snapshotChanges。
        await commit()
        return {
          ok: true, changed: true, mode: 'patch', repo: repo, count: remote.count,
          rows: delta.rows, version: delta.version, queries: delta.queries, partial: delta.partial === true,
          since: lastProbeAtByRepo[rk1],
        }
      }
      if (delta && delta.mode === 'nothing') {
        await commit()
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
      // #1893：不再标脏内存副本；客户端收到 changed / rebuild 后按库版本取整份或变化集。
      await commit()
      return { ok: true, changed: true, mode: 'rebuild', reason: String((delta && delta.reason) || 'no-delta'), repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
    } catch (e: any) { return { ok: false, error: errText(e), errorKind: 'exception' } }
  }

  /**
   * #1835：探测失败补一条可回看的历史。
   *
   * 为什么在这一层做：handleProbeOnce 的失败出口有六处，逐个加记事件容易漏；这里统一看回包，
   * 只认「这次失败、这个工作区这一段还没记过」。失败段判重放这里，是因为宿主每 5 秒探一次，
   * 连续失败若按拍记会把事件库刷满（500 条上限、7 天保留）；而房间侧本来就有「同一失败不重复
   * emit」的判据，这条历史只需回答「这一段什么时候开始的、哪个环节、什么原因」。
   *
   * throttled / calibrate / patch 是「这一拍没发请求」的档：前两个是降级常驻时的节流，patch 是
   * 写事件刚补好快照的直接交付（根本没探），都不能当成恢复。失败段继续挂着，等真的一次请求成功再清。
   */
  async function handleProbe(args: any): Promise<any> {
    const cwdRef: { cwd: string, backendId?: string, repoIdentity?: string } = { cwd: '' }
    const res: any = await handleProbeOnce(args, cwdRef)
    // #1885 评审修复（规格 I2）：探测回包也带库版本（与 wf.snapshotVersion 同一把尺子）。
    await libraryVersionFor(res, cwdRef)
    // #1898：这一拍探成了，顺手补一眼已关闭/已合并的拉取请求（合并之后页签要从「打开」翻成「已合并」）。
    // 不 await：它自己带 10 分钟节拍与一页请求上限，这一拍最多多发一条请求，不该把探针的往返拉长；
    // 补进去的行落库之后客户端按库版本就能看见。探测失败 / 到点校准那两拍不调 —— 那时网络或额度正不正常，
    // 多花一条请求没有意义。
    if (cwdRef.cwd && res && res.ok === true && res.mode !== 'calibrate' && typeof refreshClosedPulls === 'function') {
      try { Promise.resolve(refreshClosedPulls(cwdRef.cwd)).catch(function (): void {}) } catch (ePR: any) {}
    }
    if (cwdRef.cwd) {
      if (res && res.ok === false) failureNotes.fail(cwdRef.cwd, 'probe', res && res.errorKind)
      else if (res && res.ok === true && res.mode !== 'throttled' && res.mode !== 'calibrate' && res.mode !== 'patch') failureNotes.clear(cwdRef.cwd)
    }
    return res
  }
  return { handleProbe }
}
