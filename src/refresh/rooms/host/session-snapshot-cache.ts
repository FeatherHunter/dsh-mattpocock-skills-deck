// src/refresh/rooms/host/session-snapshot-cache.ts —— 会话快照电话（H4 #448 从 host/index.js 310–658 搬出电话体，早选前奏改调共享判据，纯结构、行为零变化）。
// 以后谁改它：改快照缓存短路或快照组装的人。预估约340行，超 350 打回。
// 接线：由 index.ts 动态 import 加载；早选判据由 index 从启停模块转供给。
// #723（T19）：信封组装（字段清单与落盘那一步的日志）搬到了同目录的 ./snapshotEnvelope.ts —— 这个文件
// 贴着 350 行上限，要让出位置把「每个会话在处理哪些票」的读数挂到快照回包上（票面 3e）。搬的时候只搬不改。
import { createSnapshotEnvelope } from '../../../host/snapshotEnvelope.js'
// #1139：界面描述（发给界面的那份后端数据）的投影只有一处实现，本文件不再自己挑字段。
import { projectUiDescription } from '../../../tracker/ui-description.js'
// #1433/#1449：布局的唯一真源是工作区文件；读法已搬去 ./snapshot-decoration.js（#1835 让本文件回到 350 行以内）。
// 有效期住中央 YAML，调时间改 config/ttl.yaml。
import { SNAPSHOT_TTL_MS } from '../../../shared/time-config/src/values.js'
// #1584 F1：面板首屏原来用注册表 describe 自己造仓库身份，空 refId 被当成「答出来了」；
// 这里改成「describe 给不出 refId 时问会话」，共享补齐入口放在 tracker 层（宿主与刷新两侧都能引用）。
import { resolveRepoRefForCwd } from '../../../tracker/session/repo-ref.js'
// #1835：取数失败的「同一段只记一条」判重与写历史的兜错，与探测失败那一路共用一份实现。
import { createFailureSegmentNotes } from './failure-segment-notes.js'
// #1835：快照回包的三处装饰（布局答案、后端模块声明、跨会话在办表）搬去了 ./snapshot-decoration.js，本文件回到 350 行以内。
import { createSnapshotDecoration } from './snapshot-decoration.js'
// #1867：首屏先读本地快照库这件事收在 ./snapshot-library-first-screen.ts（GitHub 与 GitLab 两支路共用）。
import { firstScreenFromLibrary, type FirstScreenLibrary } from './snapshot-library-first-screen.js'

// ===== 类型契约（#1155）：下面这些声明只给类型检查看，编译后一行都不剩，运行时不引用任何名字 =====
// 为什么都堆在文件顶部：本文件的依赖全部由接线处 index.js 那份对象注入（JS 不查编译错误），
// 所以每份类型只描述「本文件实际读写的字段」，字段名与注入方一一对应；注入方多给的字段这里不管。
// 标签的 name 是它的身份（后端给的标签一定有名字）；读的地方仍有 `l && l.name` 兜底，那道兜底不动。
type Args = { cwd?: unknown; backendId?: unknown; lang?: unknown; ifNoneMatch?: string | null; version?: string | null; force?: unknown; [k: string]: unknown }
type Label = { name: string; color?: string }
type BlockedRef = number | string | { key?: unknown }
type Row = { state?: string; key?: string; number?: number | null; labels?: Label[]; tickets?: Row[]; blockedBy?: BlockedRef[]; claimedBy?: string | null; assignees?: { login?: string }[]; level?: unknown; stats?: unknown }
type Inner = { maps?: Row[]; issues?: Row[]; labels?: Label[]; thinTickets?: unknown[]; deck?: unknown; fallback?: string; fallbackAt?: unknown; fallbackReason?: unknown; refresh?: unknown }
// 早选结果，以及收窄后的那份：isComposerSelection 为真就意味着 backendId 一定在。
type Sel = { backendId?: string; rev?: unknown }
type RepoRef = { refId?: string; backend?: string; name?: string; url?: string } | null
type BackendLike = { getCurrentUser?(repo: RepoRef, ctx: unknown): Promise<{ ok?: unknown; data?: { login?: string } | null }>; [k: string]: unknown }
type Reg = { get(id: string): BackendLike; describe(o: { cwd: string }, id: string): RepoRef; modules(): BackendModule[]; [k: string]: unknown }
// 注册表交出来的是还没投影过的后端模块，正是 projectUiDescription 的入参；投影之后的才是发给界面的那份。
type BackendModule = Parameters<typeof projectUiDescription>[0]
type UiDescription = ReturnType<typeof projectUiDescription>
/**
 * #1774：previousSnapshot 是上一趟已知的快照（房间内存缓存里那份），来源不完整时交给编排层
 * 补回上次的容器与子票。为什么由这里传：编排器是每次请求新建的实例，它自己的进程内缓存永远是空的。
 */
type ComposerOpts = { ifNoneMatch?: string; force?: boolean; previousSnapshot?: unknown; onRows?: (rows: unknown[]) => void }
// #1863/#1867：宿主侧快照库门面与「首屏先读库」的读写口径住 ./snapshot-library-first-screen.ts（两支路共用）。
type Composed = { ok: boolean; error?: { message?: string } | null; snapshot?: unknown; fail?: unknown; notModified?: unknown; status?: unknown; version?: unknown; cached?: unknown }
type Composer = { composeSnapshot(id: string, repo: RepoRef, ctx: unknown, o: ComposerOpts): Promise<Composed> }
type Levels = { byNumber?: Record<string, unknown>; byKey?: Record<string, unknown> }
type Envelope = ReturnType<typeof createSnapshotEnvelope>
// 工作副本里那份快照：selection 是权威选择，setupLayout 是记住的布局答案。
type CachedSnap = { selection?: Sel | null; setupLayout?: Layout | null; generatedMs?: number; fromCache?: boolean; backendModules?: unknown }
// 在途表取回的那份回包：两条电话路各自组装，形状不同，取回时只能按「是对象、可能带 ok」这一层还原。
type Reply = { ok?: unknown; [k: string]: unknown }
// 记住的布局答案（#683）：layout 是选的哪一种，pickedAt 是什么时候选的。
type Layout = { layout: unknown; pickedAt: unknown }
type LogCtx = { fire(level: string, event: string, payload?: unknown): void; isEnabled(name: string): boolean }
type Platform = { ident?: unknown }
// 接线处注入的依赖：字段名与 index.js 里那份对象一一对应（少一个就在启动时炸）。
type SnapshotDeps = {
  canonicalKey(cwd: unknown): Promise<string> | string; selectEarly(o: { cwd: string; backendId?: unknown }): Promise<Sel | null> | Sel | null; isComposerSelection(sel: Sel | null): sel is Sel & { backendId: string }; getTrackerRegistry(): Promise<Reg> | Reg; getPlatform(): Promise<Platform> | Platform
  ctx: { get(name: string): unknown }; logCtx?: LogCtx | null; DEFAULT_CWD?: string; envelope?: Envelope | null
  // #1870：工作副本的读写口（行级增量与库为空时的兜底用；面板数据本身只从库回放）。
  getCache(cwd: string): { ts: number; snapshot: CachedSnap | null }; setCache(v: { ts: number; snapshot: unknown; error: unknown; cwd: string }): void; CACHE_MS: number; cacheSnapshotIsCurrent(snap: unknown, cwd: string): Promise<unknown> | unknown
  upcaseSnapStates(snap: unknown): Inner; computeLevels(tickets: Row[]): Levels; groupTickets(tickets: Row[]): unknown
  getRepoRoot(cwd: string): Promise<string> | string; getRepoKey(cwd: string): Promise<{ owner?: string; name?: string } | null> | { owner?: string; name?: string } | null
  adoptSnapshot(snap: unknown, c: unknown): unknown; detectionExec(cmd: string, args: unknown[], opts: unknown, phase: string): unknown; getGhPath(): string | null; getGhLastError(): unknown; errText(e: unknown): string
  send?: ((scope: unknown, run: () => unknown) => Promise<{ result: unknown }>) | null
  // #1446：接线处注入的额度读数口（按后端 id 取）；没接就照旧不传，快照形状与今天一致。
  budgetReadout?: ((backendId: string) => any) | null
  // #1439 A2：接线处注入的会话口。接了之后快照经 Tracker 会话取数（操作过闸、记账）；没接由 composer 回落注册表。
  openSession?: ((cwd: string, o?: { write?: boolean }) => Promise<any>) | null
  // #1835：失败历史的口（与宿主刷新失败共用同一个事件库）。快照取数以前只在界面留失败态、没有历史，
  //   事后查不到「什么时候、哪个环节、为什么」。只在这一段失败的第一次记一条，恢复后清标记。
  noteRefreshFailure?: any
  // #1863：首屏读本地快照库的口。没接时行为与今天一致（磁盘缓存 + 在线重建）。
  getSnapshotLibrary?: (() => Promise<FirstScreenLibrary | null> | FirstScreenLibrary | null) | null
}

// 以后谁改它：改快照缓存短路或快照组装的人。预估约340行，超 350 打回。
// 接线：由 index.ts 动态 import 加载；早选判据由 index 从启停模块转供给；#1835 起失败段判重、回包装饰各有一份同目录的共用实现。
export function createSessionSnapshot(deps: SnapshotDeps) {
  const { canonicalKey, selectEarly, isComposerSelection, getTrackerRegistry, getPlatform, ctx, getCache, setCache, CACHE_MS, cacheSnapshotIsCurrent, upcaseSnapStates, computeLevels, groupTickets, getRepoRoot, getRepoKey, adoptSnapshot, detectionExec, getGhPath, getGhLastError, errText, DEFAULT_CWD, logCtx, envelope, send, budgetReadout, openSession, noteRefreshFailure, getSnapshotLibrary } = deps
  // #723（T19）：快照信封（字段清单 + 落盘那一步的 snapshot.built 日志）搬到了 ./snapshotEnvelope.js
  // （这个文件贴着 350 行上限，要让出位置挂「每个会话在处理哪些票」的读数）。没注入时现造一个，
  // 行为与搬前逐字一致 —— 单测里手工拼实例的那几处就靠这条兜底。
  const env = envelope || createSnapshotEnvelope({ getGhPath: getGhPath, getGhLastError: getGhLastError, adoptSnapshot: adoptSnapshot, logCtx: logCtx })
  const buildSnap = env.buildSnap
  const adoptSnapLog = env.adoptSnapLog
  // #1835：布局答案、后端模块声明、跨会话在办表这三处装饰搬去了 ./snapshot-decoration.js（本文件回到 350 行以内）。
  const decoration = createSnapshotDecoration({ getPlatform: getPlatform, ctx: ctx, getTrackerRegistry: getTrackerRegistry, env: env })
  // #589 去重加载器（D7 禁止静态 import，动态接线；与 _dispatchMetaP 同模式）
  let _dedupeP: Promise<typeof import('../../../shared/tracker/list-dedupe.js')> | null = null
  function _dedupe() { if (!_dedupeP) _dedupeP = import('../../../shared/tracker/list-dedupe.js'); return _dedupeP }
  const { readSetupLayoutOf, attachWorkRouteTable } = decoration
  // #491 房外埋点 helpers：hash8 只记散列；P1 外层先判开关+采样，字段函数只在守卫内求值。
  // #653 快照多带 workspaceRoot（即开头算出的 cwd，已锚到工作区根）；客户端靠它按根分桶并渲染归属提示，自己算不出根故由宿主带过去。
  function hash8(s: unknown) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  // #1867：GitLab 的 composer 支路原来不补「认领人」这格，而 GitHub 的统一支路补；同一份快照要同一种
  // 形状，客户端才不用按后端各判一次。口径与统一支路逐字相同：第一个指派人；没有指派就是空串。
  function fillClaimedBy(t: Row): void { if (t && t.claimedBy == null) { const owners = t.assignees; t.claimedBy = Array.isArray(owners) && owners.length ? ((owners[0] && owners[0].login) || '') : '' } }
  let snapSampleN = 0
  let _sharedInflightP: Promise<typeof import('../../../host/snapshotInflight.js')> | null = null // #729：本地表已撤，改用与刷新路共用的在途表（./snapshotInflight.js；D7 禁止静态 import，动态接线）
  function _loadSharedInflight() { if (!_sharedInflightP) _sharedInflightP = import('../../../host/snapshotInflight.js'); return _sharedInflightP }
  // #1835：快照取数失败的失败段记历史（同一段只记一条，任何一次成功回包都算这一段结束）。
  const failureNotes = createFailureSegmentNotes(noteRefreshFailure)
  /**
   * #1835：快照取数失败补一条可回看的历史。
   *
   * 为什么包在外层：snapshotOf 的失败出口只有末尾一个 catch，但成功回包有好几种形状（快照对象、
   * ok:true 的 304、缓存命中）；在末尾看「这条回包是不是失败」最不容易漏。判重与兜错在
   * failure-segment-notes，这里只判「这条回包算不算成功」。
   */
  async function handleSnapshot(args: Args) {
    const cwdRef: { cwd: string } = { cwd: '' } // 路径归一见下面 snapshotOf 里的 canonicalKey（#1835）
    const reply: any = await snapshotOf(args, cwdRef)
    if (cwdRef.cwd) {
      if (reply && reply.ok === false) failureNotes.fail(cwdRef.cwd, 'snapshot', reply && reply.failKind)
      else failureNotes.clear(cwdRef.cwd)
    }
    return await attachWorkRouteTable(reply, args)
  }
  async function snapshotOf(args: Args, cwdRef: { cwd: string }) {
      const _rawSnapCwd = (args && args.cwd) || ''; if (!String(_rawSnapCwd).trim()) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }; const cwd = await canonicalKey(_rawSnapCwd); if (String(cwd == null ? '' : cwd)) cwdRef.cwd = String(cwd) // #1003 空目录闸：没目录不冒充取快照；#1835 外层要按这个工作区记失败段
      const now = Date.now()
      // 第一性原理分发前置：先算 selection，再决定数据链路（避免旧判断遮住 Markdown）
      const _selEarly = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
      const _layEarly = await readSetupLayoutOf(cwd) // #683（F1 · R6）：记住的布局答案随每条回包一起回去（同 R4 那条路）
      const useComposerEarly = isComposerSelection(_selEarly)
      const isForce = !!(args && args.force)
      // #683（F1 · ADR 的 R4）：每一条回包都要带权威 {selection, rev}。库回放与兜底缓存这两条短路路此前
      // 回的是那份**旧** selection —— 只换了后端时快照内容一个字没变、版本号也没变，客户端就收到「没变」，
      // 于是面板头与状态栏继续显示旧后端，而同屏的链与横幅（走 wf.detect）已经按新值答了。
      //   只在「那份选择与这一轮算出来的不是同一个后端、或修订号变了」时才换一份浅拷贝带上新值；
      // 选择没变时照旧返回同一个对象（这一步不重新拼数据，也不联网核对）。
      const shortCircuit = function () {
        const c = getCache(cwd)
        const s = c && c.snapshot
        if (!s || !_selEarly || !_selEarly.backendId) return s
        // 走到真分支就说明 s.selection 是个带整数 rev 的对象；断言只是把这句交给类型检查，编译后不剩。
        const prevRev = Number.isInteger(s.selection && s.selection.rev) ? (s.selection as Sel).rev : 0
        const nowRev = Number.isInteger(_selEarly.rev) ? _selEarly.rev : 0
        const sameBackend = String((s.selection && s.selection.backendId) || '') === String(_selEarly.backendId)
        const sameLayout = String((s.setupLayout && s.setupLayout.layout) || '') === String((_layEarly && _layEarly.layout) || '')
        if (sameBackend && prevRev === nowRev && sameLayout) return s
        const cp = Object.assign({}, s, { selection: _selEarly, rev: nowRev }); cp.setupLayout = _layEarly; return cp // #1433：布局以这一轮为准（含空：文件里没有时不留缓存里那份旧答案）
      }
      try { if (logCtx) logCtx.fire('info', 'snapshot.request', { cwdHash: hash8(cwd), backend: String((_selEarly && _selEarly.backendId) || ''), force: isForce }) } catch (eL) {}
      // #1870：面板数据的主来源是本地快照库（两条支路各自的 firstScreenFromLibrary）；下面这份工作副本
      // 只在库里还没有这一轮数据时兜底（库刚被清掉、库打不开、第一次进工作区），不再抢在库前面交付。
      const cachedEntry = getCache(cwd)
      const missReason = (function () { try { if (isForce) return 'force'; const c = getCache(cwd); if (!c.snapshot) return 'empty'; const cb = c.snapshot.selection && c.snapshot.selection.backendId; const nb = _selEarly && _selEarly.backendId; if (cb !== nb) return 'backend-changed'; return 'expired' } catch (e) { return 'expired' } })()
      try { if (logCtx) logCtx.fire('info', 'snapshot.cache.miss', { reason: missReason }) } catch (eL) {}
      // #729：在途合并与刷新路共用一张表（键不带强制标记；强制只搭强制的车，非强制搭任何车）
      const _sharedInflight = await _loadSharedInflight()
      const snapshotDedupKey = _sharedInflight.snapshotDedupKeyOf({ cwd: cwd, backendId: (_selEarly && _selEarly.backendId), lang: (args && args.lang), version: (args && (args.ifNoneMatch || args.version)) })
      { const _ride = _sharedInflight.snapshotInflightTake<Reply>(snapshotDedupKey, isForce, function () { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'dedup.hit', function () { return { scope: 'snapshot', keyHash: hash8(snapshotDedupKey) } }) } catch (eL) {} }); if (_ride) return await _ride }
      const snapshotPending = (async function () {
      try {
        // 复用已算的 selection，避免二次探测
        let _sel = _selEarly
        if (!_sel) _sel = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
        const useComposer = isComposerSelection(_sel)
        // _sel 是 let（_selEarly 为空时被重新赋值），别名收窄对这种写法不生效；进这段的前提
        // 已经是上面那两句「有 selection、有 backendId」，两个 ! 就是把这道前提翻过函数边界。
        if (useComposer) {
          const reg = await getTrackerRegistry()
          const backendId = _sel!.backendId!
          let repoRef: RepoRef = null
          try { repoRef = reg.describe({ cwd }, backendId) } catch {}
          // #1584 F1：GitHub / GitLab 的 describe 只给目录时回的是「refId 为空的壳」；
          // 空 refId 不能当身份（composer 会用它当缓存键、后端操作也认不出仓库），
          // 这时改问会话（身份真源，含远端定位），拿不到再走原来那条兜底。
          if (!repoRef || !repoRef.refId) {
            const identified = await resolveRepoRefForCwd({ cwd, backendId, describe: reg.describe, openSession })
            if (identified) repoRef = identified
          }
          // #1867/#1868：GitLab 与本地 Markdown 也走同一套库——先读库铺首屏，库里没数据才去后端取，
          // 取回来的行按批写库。开库要求「真的答出了仓库身份」：describe 或会话给的都算，下面那句拿
          // cwd 拼的兜底不算。两家的身份长什么样不同，所以判法不同：GitLab 的 refId 是 owner/project，
          // 与工作目录不同；本地 Markdown 的身份就是工作区目录本身，refId 等于 cwd 正是它的正确身份。
          // 拿 cwd 冒充身份开库才会出事——那样开出来的键不对，下一次真正身份到达时会因身份不符整库重建。
          const identityResolved = !!(repoRef && repoRef.refId && (backendId !== 'gitlab' || String(repoRef.refId) !== String(cwd)))
          if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
          const libraryBackend = backendId === 'gitlab' || backendId === 'markdown'
          const first = (libraryBackend && identityResolved) ? await firstScreenFromLibrary({ getSnapshotLibrary: getSnapshotLibrary, workspaceRoot: cwd, backend: backendId, repoIdentity: String((repoRef && repoRef.refId) || ''), repo: repoRef, force: !!(args && args.force) }) : null
          // #1870：库里有数据就只读库；库为空时才用工作副本兜底（再没有才联网重建）。
          if (!(first && first.replay) && !isForce && cachedEntry.snapshot) {
            const cachedBackend = cachedEntry.snapshot.selection && cachedEntry.snapshot.selection.backendId
            if (String(cachedBackend || '') === String((_selEarly && _selEarly.backendId) || '') && now - cachedEntry.ts < CACHE_MS) return shortCircuit()
          }
          // #927：面板取数这一路的每条命令都过闸（分类是「人的动作」那一档：只记账、不降档）；没给 send 时照旧直发。
          const ctx2 = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: function (c: string, a: unknown[], o: unknown) { if (typeof send !== 'function') return detectionExec(c, a, o, 'snapshot'); const isGql = String((a && a[0]) || '') === 'api' && String((a && a[1]) || '').indexOf('graphql') >= 0; return send({ source: 'panel.refresh', kind: 'detail', bucket: isGql ? 'graphql' : 'rest', workspaceKey: cwd }, function () { return detectionExec(c, a, o, 'snapshot') }).then(function (r) { return r.result }) } }
          const { createSnapshotComposer } = await import('../../../host/tracker/snapshot.js')
          // 本地（JSDoc）那份 composeSnapshot 把第四个参数写窄成了 { force?: boolean }，而这里确实还传了
          // ifNoneMatch；composer 只按本地类型标注，不碰它的实现。
          // #1446：额度读数口接上了才传；#1439 A2：会话口接上了就经会话取数（没接的两种口 composer 各自保持老形状）。
          const composer: Composer = createSnapshotComposer(reg, Object.assign({ snapshotTtl: SNAPSHOT_TTL_MS, logCtx: logCtx || undefined }, typeof budgetReadout === 'function' ? { budgetReadout: budgetReadout } : null, typeof openSession === 'function' ? { openSession: openSession } : null))
          const res: Composed = (first && first.replay) ? { ok: true, snapshot: first.replay.snapshot } : await composer.composeSnapshot(backendId, repoRef, ctx2, { ifNoneMatch: (args && (args.ifNoneMatch || args.version)) || '', force: !!(args && args.force), previousSnapshot: (first && first.replay) ? first.replay.snapshot : ((cachedEntry && cachedEntry.snapshot) || null), onRows: first ? first.writeRows : undefined })
          if (!res.ok) { const _e1: Error & { fail?: unknown } = new Error((res.error && res.error.message) || 'composeSnapshot failed'); if (res.fail) _e1.fail = res.fail; throw _e1 }
          // #683（F1 · ADR 的 R4）：后端说「没变」（304）时也要把权威选择带上 —— 那正是「只换了后端、 快照内容一个字没变」这个现场：不带的话客户端收到 304 就什么都不做，面板头继续显示旧后端。
          // #1440：304 回包必须带上工作区根（与下面重建分支的 workspaceRoot: cwd 同一个值）。
          //   后面挂工作路线表那一步（withWorkRouteTable → work-route-readout）只认 reply.workspaceRoot，
          //   拿不到根就挂一张 {ok:false, reason:'host.work-route.no-workspace'} 的坏表；客户端在本地
          //   没表时又会照收，于是面板一直显示「读不出来」、自己不会好。304 是「内容没变」的合法结果，
          //   不是失败，回包照样要自含解释这张表所需的全部信息，不能指望调用现场再补根。
          if (res.notModified === true || res.status === 304) {
            const _pair: { selection?: Sel | null; rev?: unknown; setupLayout?: Layout | null } = (_selEarly && _selEarly.backendId) ? { selection: _selEarly, rev: (Number.isInteger(_selEarly.rev) ? _selEarly.rev : 0) } : {}
            // #1449：布局无条件带上（含 null）—— 客户端删掉浏览器那份布局表以后，只能靠这条回包清空旧答案。
            _pair.setupLayout = _layEarly
            return Object.assign({ ok: true, workspaceRoot: cwd, notModified: true, status: 304, version: res.version || '', cached: true, generatedMs: Date.now() }, _pair)
          }
          // #1869：首屏取回来的行先收在内存里，等编排器成功返回后整批一个事务写库；
          // 进程在这之前被杀，库仍是上一轮完整数据（不会留下半批）。
          if (first) { try { await first.commitRows() } catch (e) {} }; const inner = upcaseSnapStates(res.snapshot)
          const flatTickets = (inner.maps || []).flatMap(function(m){ return (m.tickets || []); })
          let allForList: Row[] = []
          ;(inner.maps || []).forEach(function(m){
            if (m.key != null && m.number == null) {
              const n = parseInt(m.key, 10)
              if (!isNaN(n)) m.number = n
            }
            if (m.key != null) m.key = String(m.key)
            // #1431 首屏也要算分组计数（与刷新路同口径）：没这段，首屏地图行就没有 0/4，必须多点一次刷新才出来。
            try {
              const tickets = m.tickets || []
              const lvInfo: Levels = (typeof computeLevels === 'function') ? computeLevels(tickets) : { byNumber: {} }
              tickets.forEach(function(t){
                if (t.number != null && lvInfo.byNumber && lvInfo.byNumber[t.number] != null) t.level = lvInfo.byNumber[t.number]
                else if (t.key != null && lvInfo.byKey && lvInfo.byKey[t.key] != null) t.level = lvInfo.byKey[t.key]
              })
              const stats = (typeof groupTickets === 'function') ? groupTickets(tickets) : { total: tickets.length, open: tickets.filter(function(x){return x.state!=='CLOSED'}).length, closed: tickets.filter(function(x){return x.state==='CLOSED'}).length, frontier:0, claimed:0, blocked:0, levels:[], levelOf:{} }
              m.stats = stats
            } catch {}
            allForList.push(m)
          })
          flatTickets.forEach(function(t){
            fillClaimedBy(t)
            if (t.key != null && t.number == null) {
              const n = parseInt(t.key, 10)
              if (!isNaN(n)) t.number = n
            }
            if (t.key != null) t.key = String(t.key)
            if (Array.isArray(t.blockedBy)) {
              // #1431 阻塞边压成数字（与刷新路同形）：服务端分组按数字索引（byNum）、详情行按数字严格相等，
              // 都只认数字；纯数字串（本地补零键 '02'、前后带空格）折成数字，非数字原样保留。
              // 列表按身份查的那边已做规范键兼容（store-derived.ts 的 normIdentityKey），两边都通。
              t.blockedBy = t.blockedBy.map(function(ref: BlockedRef){
                if (typeof ref === 'number') return ref
                if (typeof ref === 'string') {
                  const s = ref.trim()
                  if (/^0*\d+$/.test(s)) { const nn = parseInt(s, 10); if (!isNaN(nn)) return nn }
                  return ref
                }
                if (ref && typeof ref === 'object' && ref.key != null) {
                  const nk = String(ref.key)
                  const nn = parseInt(nk, 10)
                  if (!isNaN(nn)) return nn
                  return nk
                }
                return ref
              })
            }
            allForList.push(t)
          })
          ;(inner.issues || []).forEach(function(it){
            if (it.key != null && it.number == null) {
              const n = parseInt(it.key, 10)
              if (!isNaN(n)) it.number = n
            }
            if (it.key != null) it.key = String(it.key)
            allForList.push(it)
          })
          // #589：三段拼接会让身兼两职的票出现两次，这里按身份收成一行（地图容器优先）
          allForList = (await _dedupe()).dedupeListByPool(allForList)
          const labels = inner.labels || (function(){
            const mm: Record<string, unknown> = {}
            ;(([] as Row[]).concat(inner.maps || []) as Row[]).concat(flatTickets).forEach(function(x){ (x.labels||[]).forEach(function(l){ if(l.color && !mm[l.name]) mm[l.name]=l.color }) })
            return Object.entries(mm).map(function(e){ return {name:e[0], color:e[1]} })
          })()
          let backendModules: UiDescription[] | null = null
          try {
            const regM = await getTrackerRegistry()
            if (regM && typeof regM.modules === 'function') {
              backendModules = regM.modules().map(projectUiDescription)
            }
          } catch {}
          // B: 补全标签全量（只有本地 Markdown 后端这一段）：没用过的标签也常驻，色取后端自报的内置默认色表 labelPalette（即 backends/markdown/index.js 的 defaultLabelPalette 那 11 枚）；已用标签的颜色已是宿主按工作区配色文件 docs/agents/label-colors.json 算好的票面最终色，这里只补缺、不覆盖（#618：旧的 docs/agents/triage-labels.md 调色盘表不再参与）
          try {
            if(backendId==='markdown' && Array.isArray(labels) && backendModules){
              const mdMod = backendModules.find(function(m){ return m && m.id==='markdown' && Array.isArray(m.labelPalette) })
              const palette = mdMod && mdMod.labelPalette
              if(Array.isArray(palette) && palette.length){
                const have: Record<string, boolean> = {}
                labels.forEach(function(l){ if(l && l.name) have[String(l.name).trim()] = true })
                palette.forEach(function(p){
                  const nm = p && p.name ? String(p.name).trim() : ''
                  if(!nm || have[nm]) return
                  labels.push({name: nm, color: String(p.color||'cccccc').replace(/^#/,'')})
                })
              }
            }
          } catch {}
          // 这里原来有一段「markdown 的票 url 为空就按后端现算」的兜底（Q7），已按 #1142 删掉：
          // 它读的是投影之后的模块对象，而投影只带数据字段、把函数挡在门外（见 tracker/ui-description.ts），
          // 所以 typeof …==='function' 恒为假、整段永远进不去。票的地址现在由房间在读写这个文件时自己填好
          // （markdown 房 parse.ts 的 url），宿主不再替任何后端算地址——这正是注册表「只转发后端自己给的值」那条方向。
          const repoRoot = await getRepoRoot(cwd)
          const snap = buildSnap({
            repoRoot, workspaceRoot: cwd,
            maps: inner.maps, issues: allForList, thinTickets: inner.thinTickets, labels: labels,
            repository: repoRef, backendModules: backendModules, selection: _sel, setupLayout: _layEarly, deck: inner.deck, fallback: inner.fallback, fallbackAt: inner.fallbackAt, fallbackReason: inner.fallbackReason, refresh: inner.refresh,
          })
          // #1867：有回放时盖上「来自库」的注记；没有回放时 snap 保持在线组装的形状，不冒充缓存。
          if (first) first.decorate(snap)
          return adoptSnapLog(snap, cwd)
        }
        // 统一契约：所有后端均走 composeSnapshot，不再硬走 buildSnapshot 直调 gh
        if (!_sel || !_sel.backendId) {
          const repoRoot = await getRepoRoot(cwd)
          let backendModules: UiDescription[] | null = null
          try {
            const regM = await getTrackerRegistry()
            if (regM && typeof regM.modules === 'function') {
              backendModules = regM.modules().map(projectUiDescription)
            }
          } catch {}
          const snap = buildSnap({
            repoRoot, workspaceRoot: cwd,
            maps: [], issues: [], thinTickets: [], labels: [],
            backendModules, selection: _sel, setupLayout: _layEarly,
            deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
          })
          return adoptSnapLog(snap, cwd)
        }
        // GitHub 同样走编排器（经 registry.get('github').list），不再直调 buildSnapshot 硬走 gh
        const reg2 = await getTrackerRegistry()
        const backendId2 = _sel.backendId
        let repoRef2: RepoRef = null
        try { repoRef2 = reg2.describe({ cwd }, backendId2) } catch {}
        if (!repoRef2 || !repoRef2.refId) {
          const rk = await getRepoKey(cwd)
          if (rk && rk.owner && rk.name) {
            repoRef2 = { backend: backendId2, refId: rk.owner + '/' + rk.name, name: rk.owner + '/' + rk.name, url: 'https://github.com/' + rk.owner + '/' + rk.name }
          } else {
            const repoRootNoRepo = await getRepoRoot(cwd)
            let backendModulesNoRepo: UiDescription[] | null = null
            try {
              const regMNo = await getTrackerRegistry()
              if (regMNo && typeof regMNo.modules === 'function') {
                backendModulesNoRepo = regMNo.modules().map(projectUiDescription)
              }
            } catch {}
            const _selNoRepo = (typeof _sel !== 'undefined' ? _sel : (typeof _selEarly !== 'undefined' ? _selEarly : null))
            const snapNoRepo = buildSnap({
              repoRoot: repoRootNoRepo, workspaceRoot: cwd,
              maps: [], issues: [], thinTickets: [], labels: [],
              backendModules: backendModulesNoRepo, selection: _selNoRepo, setupLayout: _layEarly,
              deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
            })
            return adoptSnapLog(snapNoRepo, cwd)
          }
        }
        const repo0b = await getRepoKey(cwd)
        // #1863：首屏先无条件读本地快照库——不探测远端、不等整份重建。有数据就直接回放；
        // 库坏/为空才落到下面的在线重建（首屏不许因库不可用而空）。
        // #1870：旧的整份磁盘快照文件已退役，这里不再有「磁盘回放」这一档。
        const first = await firstScreenFromLibrary({ getSnapshotLibrary: getSnapshotLibrary, workspaceRoot: cwd, backend: backendId2, repoIdentity: String((repoRef2 && repoRef2.refId) || ''), repo: repoRef2, force: isForce })
        // #1870：库里有数据就只读库；库为空时才用工作副本兜底（再没有才联网重建）。
        if (!(first && first.replay) && !isForce && cachedEntry.snapshot) return shortCircuit()
        const ctx2b = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: function (c: string, a: unknown[], o: unknown) { return detectionExec(c, a, o, 'snapshot') } }
        const { createSnapshotComposer: createComposer2 } = await import('../../../host/tracker/snapshot.js')
        // #1446：回退路径也把额度读数带上；#1439 A2：会话口同主路径（见上方的 composer）。
        const composer2: Composer = createComposer2(reg2, Object.assign({ snapshotTtl: SNAPSHOT_TTL_MS, logCtx: logCtx || undefined }, typeof budgetReadout === 'function' ? { budgetReadout: budgetReadout } : null, typeof openSession === 'function' ? { openSession: openSession } : null))
        const res2: Composed = (first && first.replay) ? { ok: true, snapshot: first.replay.snapshot } : await composer2.composeSnapshot(backendId2, repoRef2, ctx2b, { ifNoneMatch: (args && (args.ifNoneMatch || args.version)) || '', force: !!(args && args.force), previousSnapshot: (first && first.replay) ? first.replay.snapshot : ((cachedEntry && cachedEntry.snapshot) || null), onRows: first ? first.writeRows : undefined })
        if (!res2.ok) { const _e2: Error & { fail?: unknown } = new Error((res2.error && res2.error.message) || 'composeSnapshot failed'); if (res2.fail) _e2.fail = res2.fail; throw _e2 }
        // 同主路径：回退支路也等编排器成功后再整批写库。
        if (first) { try { await first.commitRows() } catch (e) {} }; const inner2 = upcaseSnapStates(res2.snapshot)
        ;(inner2.maps || []).forEach(function(m){ 
          if (m.number == null && m.key != null) { const nn = parseInt(m.key,10); if(!isNaN(nn)) m.number = nn; }
          try {
            const tickets = m.tickets || []
            // 补 number（GitHub 仅有 key，旧的地图列表和地图详情用 number 展示）
            // 把新形状的阻塞边压成旧视图要的数字数组，把认领人数组派生为旧视图要的认领名字符串，再算层级和统计
            tickets.forEach(function(t){
              if(t && t.key != null && t.number == null){ const nn=parseInt(t.key,10); if(!isNaN(nn)) t.number=nn; if(t.key!=null) t.key=String(t.key) }
              if (t && Array.isArray(t.blockedBy)) {
                // 与主路径同口径：阻塞引用保留原键字符串，面板按“工作单元 + 键”查找。
                t.blockedBy = t.blockedBy.map(function(ref: BlockedRef){
                  if (typeof ref === 'number' || typeof ref === 'string') return ref
                  if (ref && typeof ref === 'object' && ref.key != null) return String(ref.key)
                  return ref
                })
              }
              if (t && t.claimedBy == null) {
                const owners = t.assignees
                if (Array.isArray(owners) && owners.length) t.claimedBy = (owners[0] && owners[0].login) || ''
                else t.claimedBy = ''
              }
            })
            const lvInfo: Levels = (typeof computeLevels === 'function') ? computeLevels(tickets) : { byNumber: {} }
            tickets.forEach(function(t){ 
              if (t.number != null && lvInfo.byNumber && lvInfo.byNumber[t.number] != null) t.level = lvInfo.byNumber[t.number]
              else if (t.key != null && lvInfo.byKey && lvInfo.byKey[t.key] != null) t.level = lvInfo.byKey[t.key]
            })
            const stats: unknown = (typeof groupTickets === 'function') ? groupTickets(tickets) : { total: tickets.length, open: tickets.filter(function(x){return x.state!=='CLOSED'}).length, closed: tickets.filter(function(x){return x.state==='CLOSED'}).length, frontier:0, claimed:0, blocked:0, levels:[], levelOf:{} }
            m.stats = stats
          } catch {}
        })
        ;(inner2.issues || []).forEach(function(it){ if (it.number == null && it.key != null) { const nn = parseInt(it.key,10); if(!isNaN(nn)) it.number = nn; } })
        let allForList2: Row[] = (([] as Row[]).concat(inner2.maps || []) as Row[]).concat((inner2.maps||[]).flatMap(function(m){ return m.tickets||[]; })).concat(inner2.issues||[])
        // #589：三段拼接会让身兼两职的票出现两次，这里按身份收成一行（地图容器优先）
        allForList2 = (await _dedupe()).dedupeListByPool(allForList2)
        const labels2 = inner2.labels || (function(){
          const mm: Record<string, unknown> = {}
          ;(([] as Row[]).concat(inner2.maps||[]) as Row[]).concat(inner2.issues||[]).forEach(function(x){ (x.labels||[]).forEach(function(l){ if(l.color && !mm[l.name]) mm[l.name]=l.color }) })
          return Object.entries(mm).map(function(e){ return {name:e[0], color:e[1]} })
        })()
        let backendModules2: UiDescription[] | null = null
        try {
          const regM2 = await getTrackerRegistry()
          if (regM2 && typeof regM2.modules === 'function') {
            backendModules2 = regM2.modules().map(projectUiDescription)
          }
        } catch {}
        const repoRoot2 = await getRepoRoot(cwd)
        let viewer2: unknown = null, viewerLogin2: string | null = null
        try {
          const tr = reg2.get(backendId2)
          // #1863：库回放这一趟不联网问当前用户；viewer 留给下一次在线刷新补。
          if ((!first || !first.replay) && tr && typeof tr.getCurrentUser === 'function') {
            const vr = await tr.getCurrentUser(repoRef2, ctx2b)
            if (vr && vr.ok && vr.data) { viewer2 = vr.data; viewerLogin2 = vr.data.login || null }
          }
        } catch {}
        const snap2 = buildSnap({
          repo: repo0b, repoRoot: repoRoot2, workspaceRoot: cwd,
          maps: inner2.maps, issues: allForList2, thinTickets: inner2.thinTickets, labels: labels2,
          repository: repoRef2, backendModules: backendModules2, selection: _sel, setupLayout: _layEarly,
          viewer: viewer2, viewerLogin: viewerLogin2, deck: inner2.deck, fallback: inner2.fallback, fallbackAt: inner2.fallbackAt, fallbackReason: inner2.fallbackReason, refresh: inner2.refresh,
        })
        if (first) first.decorate(snap2)
        return adoptSnapLog(snap2, cwd)
      } catch (e) {
        setCache({ ts: Date.now(), snapshot: null, error: errText(e), cwd: cwd }) // #715 失败也把种类一起回给界面（见下一行）：配额被别人耗尽 / 插件自己的取数失败 = 两句不同的话；没带种类的一律按后者说，拿不准时不许说「等整点恢复」。
        return { ok: false, error: errText(e), failKind: ((e as any) && (e as any).fail && (e as any).fail.kind) ? (e as any).fail.kind : 'fetch-failed', env: { ghError: getGhLastError() } }
      }
      })()
      const _entry = _sharedInflight.snapshotInflightPark(snapshotDedupKey, isForce, snapshotPending); try { return await snapshotPending } finally { _sharedInflight.snapshotInflightLeave(snapshotDedupKey, _entry) }
  }
  return { handleSnapshot }
}
