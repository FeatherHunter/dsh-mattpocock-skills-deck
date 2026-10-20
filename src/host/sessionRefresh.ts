// src/host/sessionRefresh.ts —— 会话刷新电话（H4 #448 从 host/index.js 660–982 搬出电话体，早选前奏改调共享判据，纯结构、行为零变化）。
// 以后谁改它：改强制刷新或磁盘缓存的人。预估约330行，超 350 打回。
// 接线：由 index.ts 动态 import 加载；早选判据由 index 从启停模块转供给；本文件不引用其他新文件。
// #652 改动：入口 cwd 由「原样入参」改成与 wf.snapshot 同一把规整钥匙（含工作区根），两条路的宿主单槽快照才同桶。
// 2026-09-24（真机反馈「读不到处理记录」从来不消失）：本文件从前**自己手写四份信封字面量**，
//   wf.snapshot 有的 setupLayout / fallback / fallbackAt / refresh / 工作路线读数它一概没有——
//   界面是 `force ? wf.refresh : wf.snapshot`，回来都装进同一个 st.snapshot，于是强制刷新一次就永久显示读不到。
//   现在信封与「挂读数」那一步都改用接线处传进来的 snapshotEnvelope（与 wf.snapshot 同一个实例、同一份 buildSnap），
//   两条路的字段集合由构造保证相等；tests/verify-reply-envelope-parity.js 每次运行都比一遍。
// #1139：界面描述（发给界面的那份后端数据）的投影只有一处实现，本文件不再自己挑字段。
import { projectUiDescription } from '../tracker/ui-description.js'
// 有效期住中央 YAML，调时间改 config/ttl.yaml。
import { SNAPSHOT_TTL_MS } from '../shared/time-config/src/values.js'

// ===== 类型契约（#1155）：下面这些声明只给类型检查看，编译后一行都不剩，运行时不引用任何名字 =====
// 为什么都收在文件顶部：本文件的依赖全部由接线处 index.js 注入（那份是 JS，不检查编译错误），
// 所以每份类型只描述「本文件实际读写的字段」，字段名与注入方一一对应；多传的字段这里不管。
// 信封也在这里就地声明形状（而不是 import type 同层文件）：本文件不静态引用同层文件（同层互引门禁），
// 形状照 snapshotEnvelope.ts 的 buildSnap / withWorkRouteTable 两口写，那边改签名这里要跟着改。
type Fail = { ok: false; error: string }
type Args = { cwd?: unknown; backendId?: unknown; lang?: unknown; ifNoneMatch?: string | null; version?: string | null; [k: string]: unknown }
// 标签的 name 是它的身份（后端给的每个标签都有名字）；读的地方还有 `l && l.name` 的兜底，那道兜底不动。
type Label = { name: string; color?: string }
type BlockedRef = number | string | { key?: unknown }
// 票与地图的公共形状：编号、标题、统计由各后端填好，本文件只读它会读的、只写它会写的（number/key/level/stats/blockedBy/claimedBy）。
type Row = { state?: string; key?: string; number?: number | null; labels?: Label[]; tickets?: Row[]; blockedBy?: BlockedRef[]; claimedBy?: string | null; assignees?: { login?: string }[]; level?: unknown; stats?: unknown; [k: string]: unknown }
// 后端原始回包经 upcaseSnapStates 收形之后的形状：本文件只用这五样。
type Inner = { maps?: Row[]; issues?: Row[]; labels?: Label[]; thinTickets?: unknown[]; deck?: unknown }
// 早选结果：只有 backendId 与 rev 是判据，其余字段原样透传给信封。
type Sel = { backendId?: string; rev?: unknown; [k: string]: unknown }
// isComposerSelection 为真意味着「这份选择里有后端」——那条共享谓词判的就是它。
type SelReady = Sel & { backendId: string }
type RepoRef = { refId?: string; backend?: string; name?: string; url?: string } | null
type RepoKey = { owner?: string; name?: string } | null
type BackendLike = { getCurrentUser?(repo: RepoRef, ctx: unknown): Promise<{ ok?: unknown; data?: { login?: string } | null }>; [k: string]: unknown }
type Reg = { get(id: string): BackendLike; describe(o: { cwd: string }, id: string): RepoRef; modules(): BackendModule[]; [k: string]: unknown }
// 注册表交出来的后端模块（还没投影过），正是 projectUiDescription 的入参。
type BackendModule = Parameters<typeof projectUiDescription>[0]
type UiDescription = ReturnType<typeof projectUiDescription>
type ComposerOpts = { ifNoneMatch?: string; force?: boolean }
// 编排回包：snapshot 是后端原始快照（交给 upcaseSnapStates 收形）；error.message 是给人看的那句话。
type Composed = { ok: boolean; error?: { message?: string } | null; snapshot?: unknown; fail?: unknown; notModified?: unknown; status?: unknown; version?: unknown; cached?: unknown }
type Composer = { composeSnapshot(id: string, repo: RepoRef, ctx: unknown, o: ComposerOpts): Promise<Composed> }
type Levels = { byNumber?: Record<string, unknown>; byKey?: Record<string, unknown>; [k: string]: unknown }
type Deck = { counts?: { open?: unknown; closed?: unknown } | null; partial?: boolean; [k: string]: unknown }
// 信封（与 wf.snapshot 同一个实例）：这里只声明本文件用到的两口。
type Envelope = { buildSnap(o: SnapInput): SnapOut; withWorkRouteTable<T>(reply: T, args?: Args): Promise<T> }
type SnapInput = { repo?: unknown; repoRoot?: unknown; workspaceRoot?: unknown; maps?: unknown[]; issues?: unknown[]; thinTickets?: unknown[]; labels?: unknown[]; repository?: unknown; backendModules?: unknown; selection?: unknown; viewer?: unknown; viewerLogin?: unknown; deck?: unknown }
// 组装出来的快照：本文件读 fromCache / generatedMs / deck / maps / issues / labels，落盘时整份交回去。
type SnapOut = { [k: string]: unknown; fromCache?: boolean; generatedMs?: number; maps?: unknown[]; issues?: unknown[]; labels?: unknown[]; deck?: Deck | null }
type LogCtx = { fire(level: string, event: string, payload?: unknown): void; isEnabled(name: string): boolean }
type Platform = { ident?: unknown }
// 接线处注入的依赖：字段名与 index.js 里那份对象一一对应（少一个就在启动时炸）。
type RefreshDeps = {
  canonicalKey(cwd: unknown): Promise<string> | string; selectEarly(o: { cwd: string; backendId?: unknown }): Promise<Sel | null> | Sel | null; isComposerSelection(sel: Sel | null): sel is SelReady; getTrackerRegistry(): Promise<Reg> | Reg; getPlatform(): Promise<Platform> | Platform
  ctx: { get(name: string): unknown }; logCtx?: LogCtx | null; DEFAULT_CWD?: string; envelope?: Envelope | null
  getCache(cwd: string): { ts: number; snapshot?: unknown } | null | undefined; setCache(v: { ts: number; snapshot: unknown; error: unknown; cwd: string }): void
  upcaseSnapStates(snap: unknown): Inner; computeLevels(tickets: Row[]): Levels; groupTickets(tickets: Row[]): unknown
  getRepoRoot(cwd: string): Promise<string> | string; getRepoKey(cwd: string): Promise<RepoKey> | RepoKey; readDiskCache(repo: unknown): unknown; writeDiskCache(repo: unknown, snap: unknown): unknown
  adoptSnapshot(snap: unknown, c: unknown): unknown; detectionExec(cmd: string, args: unknown[], opts: unknown, phase: string): unknown; resetGhCache(): unknown; getGhPath(): string | null; getGhLastError(): unknown; errText(e: unknown): string
  send?: ((scope: unknown, run: () => unknown) => Promise<{ result: unknown }>) | null
}
export function createSessionRefresh(deps: RefreshDeps) {
  const { canonicalKey, selectEarly, isComposerSelection, resetGhCache, getTrackerRegistry, getPlatform, ctx, getCache, setCache, upcaseSnapStates, computeLevels, groupTickets, getRepoRoot, getRepoKey, readDiskCache, writeDiskCache, adoptSnapshot, detectionExec, getGhPath, getGhLastError, errText, DEFAULT_CWD, logCtx, envelope, send } = deps
  // 共用的那份信封（接线处 index.js 传进来，与 wf.snapshot 同一个实例）。
  // 没传就没法组装出与 wf.snapshot 同形的回包 —— 那种情况下宁可如实回一次失败，
  // 也不退回本文件自己拼一份（那正是这次故障的来路：两份信封各自漂）。
  const env: Envelope | null = (envelope && typeof envelope.buildSnap === 'function' && typeof envelope.withWorkRouteTable === 'function') ? envelope : null
  // 信封没接上就整条路如实失败（见上面三行），所以真去组装的那两只函数只会在 env 非空时被调用；
  // 但它们是各自独立的函数，收窄不会翻过函数边界，下面四处 env!.buildSnap 就是把这件事写出来。
  // #491 房外埋点 helpers：hash8 只记散列；脏回执与组装返回均为低频常驻，直接落盘（库体内兜底）。
  function hash8(s: unknown) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  // #689：snapshot.built 多了三个字段（open / closed 是后端计数给的真值、拿不到记 -1；partial 说这份行数据全不全）—— 加在既有事件里不新增一条（每次重建都会走到这里），字段表见 research/489-appendix.md 第 1 章。
  // #1295：再加一个 specs（这一轮认出几张「实施地图」= 规格容器；maps 是容器总数，maps 减 specs 即探索地图张数）。
  //   老直连快照路（src/host/snapshotBuild.ts）只认 wayfinder:map 标签、不产规格容器，那条路 specs 恒 0 属正常。
  //   这里与 src/host/snapshotEnvelope.ts 的 adoptSnapLog 是同一个事件的两份实现，字段必须一起改，否则
  //   「快照路」与「强制刷新路」记出来的字段不一样，拿日志对账时会被误导。
  async function adoptSnapLog(snap: SnapOut, c: string) { try { if (logCtx && snap && snap.fromCache !== true) { const _d: Deck = (snap.deck && typeof snap.deck === 'object') ? snap.deck : {}; const _ct = (_d.counts && typeof _d.counts === 'object') ? _d.counts : null; logCtx.fire('info', 'snapshot.built', { maps: (snap.maps || []).length, specs: ((snap.maps || []) as any[]).filter(function (m: any) { return !!m && m.type === 'spec' }).length, issues: (snap.issues || []).length, labels: (snap.labels || []).length, open: _ct ? _ct.open : -1, closed: _ct ? _ct.closed : -1, partial: _d.partial === true, latencyMs: Date.now() - (snap.generatedMs || Date.now()) }) } } catch (e) {} return adoptSnapshot(snap, c) as SnapOut }
  // #589 去重加载器（D7 禁止静态 import，动态接线；与 _dispatchMetaP 同模式）
  let _dedupeP: Promise<typeof import('../shared/tracker/list-dedupe.js')> | null = null
  function _dedupe() { if (!_dedupeP) _dedupeP = import('../shared/tracker/list-dedupe.js'); return _dedupeP }
  /** 回包交给界面之前，把「跨会话在办表」的读数挂上（与 wf.snapshot 同一个挂载口；#1271 起唯一的读数口）。 */
  async function handleRefresh(args: Args) {
    if (!env) return { ok: false, error: 'snapshot-envelope-not-wired' }
    const reply: unknown = await refreshOf(args)
    return await env.withWorkRouteTable(reply, args)
  }
  // #729 一次性方案：强制刷新也进与快照路共用的在途表（./snapshotInflight.js；D7 禁止静态 import，动态接线）。
  let _sharedInflightP: Promise<typeof import('./snapshotInflight.js')> | null = null
  function _loadSharedInflight() { if (!_sharedInflightP) _sharedInflightP = import('./snapshotInflight.js'); return _sharedInflightP }
  async function refreshOf(args: Args) {
      // #1003 空目录闸：同快照，不拿进程目录冒充去重建，诚实失败等就绪。
      const _rawRefCwd = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
      if (!_rawRefCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
      // #652 与快照同钥匙（规整键+工作区根）；#696 起宿主内存按根分表，强制刷新只重写自己根那条。
      const cwd = await canonicalKey(_rawRefCwd)
      const refT0 = Date.now()
      try { if (logCtx) logCtx.fire('info', 'panelSync.dirty', { cwdHash: hash8(cwd), ageMs: (function () { try { const c = getCache(cwd); return (c && c.ts) ? Math.max(0, refT0 - c.ts) : 0 } catch (e) { return 0 } })() }) } catch (eL) {}
      let _sel = null
      try { _sel = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined }) }
      catch (eSel) { setCache({ ts: Date.now(), snapshot: null, error: errText(eSel), cwd: cwd }); return { ok: false, error: errText(eSel) } }
      // #729：在途键与快照路同一把；强制只搭强制的车（在途是非强制就另起一趟，#366），搭上记现成的 dedup.hit。
      const _sharedInflight = await _loadSharedInflight()
      const refreshDedupKey = _sharedInflight.snapshotDedupKeyOf({ cwd: cwd, backendId: (_sel && _sel.backendId), lang: (args && args.lang), version: (args && (args.ifNoneMatch || args.version)) })
      { const _ride = _sharedInflight.snapshotInflightTake<SnapOut | Fail>(refreshDedupKey, true, function () { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'dedup.hit', function () { return { scope: 'snapshot', keyHash: hash8(refreshDedupKey) } }) } catch (eL) {} }); if (_ride) return _ride }
      const _rebuild = refreshBuild(args, cwd, _sel)
      const _entry = _sharedInflight.snapshotInflightPark(refreshDedupKey, true, _rebuild)
      try { return await _rebuild } finally { _sharedInflight.snapshotInflightLeave(refreshDedupKey, _entry) }
  }
  // #729：刷新真正的组装（被在途表包住，一趟只跑一次；#195 的 resetGhCache 从入口搬进这里——
  // 搭车的不再重复清：那一清里带一次异步落盘清空，在途那趟的脚下不能再扫一次）。
  async function refreshBuild(args: Args, cwd: string, _sel: Sel | null) {
      // #195 修复：用户主动刷新时清空 gh 解析缓存，强制重探
      resetGhCache()
      try {
        // 第一性原理分发：与 wf.snapshot 同构
        const useComposer = isComposerSelection(_sel)
        if (useComposer) {
          const reg = await getTrackerRegistry()
          const backendId = _sel.backendId
          const tracker = reg.get(backendId)
          if (!tracker) throw new Error('unknown backend ' + backendId)
          let repoRef: RepoRef = null
          try { repoRef = reg.describe({ cwd }, backendId) } catch {}
          if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
          // #927：刷新这一路的每条命令也过闸（分类同上：人的动作那一档，只记账、不降档）；没给 send 时照旧直发。
          const ctx2 = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: function (c: string, a: unknown[], o?: unknown) { if (typeof send !== 'function') return detectionExec(c, a, o, 'refresh'); const isGql = String((a && a[0]) || '') === 'api' && String((a && a[1]) || '').indexOf('graphql') >= 0; return send({ source: 'panel.refresh', kind: 'detail', bucket: isGql ? 'graphql' : 'rest', workspaceKey: cwd }, function () { return detectionExec(c, a, o, 'refresh') }).then(function (r) { return r.result }) } }
          const { createSnapshotComposer } = await import('./tracker/snapshot.js')
          const composer: Composer = createSnapshotComposer(reg, { snapshotTtl: SNAPSHOT_TTL_MS })
          const res = await composer.composeSnapshot(backendId, repoRef, ctx2, { ifNoneMatch: (args && (args.ifNoneMatch || args.version)) || '', force: true })
          if (!res.ok) throw new Error((res.error && res.error.message) || 'composeSnapshot failed')
                    const inner = upcaseSnapStates(res.snapshot)
          const flatTickets = (inner.maps || []).flatMap(function(m){ return (m.tickets || []); })
          let allForList: Row[] = []
          ;(inner.maps || []).forEach(function(m){
            if (m.key != null && m.number == null) {
              const n = parseInt(m.key, 10)
              if (!isNaN(n)) m.number = n
            }
            if (m.key != null) m.key = String(m.key)
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
            if (t.key != null && t.number == null) {
              const n = parseInt(t.key, 10)
              if (!isNaN(n)) t.number = n
            }
            if (t.key != null) t.key = String(t.key)
            if (Array.isArray(t.blockedBy)) {
              t.blockedBy = t.blockedBy.map(function(ref){
                if (typeof ref === 'number') return ref
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
            ;([] as Row[]).concat(inner.maps || []).concat(flatTickets).forEach(function(x){ (x.labels||[]).forEach(function(l){ if(l.color && !mm[l.name]) mm[l.name]=l.color }) })
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
          // 共用信封（与 wf.snapshot 同一份 buildSnap）：字段清单只有一处说了算。
          const snap = env!.buildSnap({
            repo: null, repoRoot: repoRoot, workspaceRoot: cwd,
            maps: inner.maps, issues: allForList, thinTickets: inner.thinTickets, labels: labels,
            repository: repoRef, backendModules: backendModules, selection: _sel,
            deck: inner.deck,
          })
          return adoptSnapLog(snap, cwd)
        }
        // 统一走编排器（所有后端）
        if (!_sel || !_sel.backendId) {
          const repoRoot = await getRepoRoot(cwd)
          let backendModules: UiDescription[] | null = null
          try {
            const regM = await getTrackerRegistry()
            if (regM && typeof regM.modules === 'function') {
              backendModules = regM.modules().map(projectUiDescription)
            }
          } catch {}
          // 共用信封：没有后端时那份空快照与 wf.snapshot 同形。
          const snap = env!.buildSnap({
            repo: null, repoRoot, workspaceRoot: cwd,
            maps: [], issues: [], thinTickets: [], labels: [],
            repository: null, backendModules, selection: _sel,
            deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
          })
          return adoptSnapLog(snap, cwd)
        }
        const reg2 = await getTrackerRegistry()
        const backendId2 = _sel.backendId
        const tracker2 = reg2.get(backendId2)
        if (!tracker2) throw new Error('unknown backend ' + backendId2)
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
            // #1155：这一行保留原文，只加一条 @ts-expect-error —— 两个原因都写在下面。
            // 原式是 `typeof _sel !== 'undefined' ? _sel : typeof _selEarly !== 'undefined' ? _selEarly : null`。
            // 为什么取值与只写 `_sel` 完全相同：走到这里时，上面那道 `if (!_sel || !_sel.backendId) { … return … }`
            // 的闸已经把「没有后端」的输入返回掉了，`_sel` 一定是对象，所以第一个分支恒成立；后面那截
            // `_selEarly` 在本文件里从来没有声明过（是从快照那条路抄过来的，那边它真声明过），而 `typeof`
            // 读一个未声明的名字不抛错、求值为 'undefined'，所以那一截永远取不到。
            // 保留原文而不是删掉死分支，有两个原因：一是它是「疑似缺陷」的现场，按票面该单独验证、不该在
            // 补标注的票里顺手改掉（真缺陷另开票）；二是原文保留下来，转译产物才与标注前逐字节一致
            // （#1155 验收第 3 条）。
            // @ts-expect-error `_selEarly` 这个名字在本文件不存在（TS2304）；运行期那条 typeof 守卫不会抛。
            const _selNoRepo = typeof _sel !== 'undefined' ? _sel : typeof _selEarly !== 'undefined' ? _selEarly : null
            // 共用信封：仓库都认不出来时那份空快照与 wf.snapshot 同形。
            const snapNoRepo = env!.buildSnap({
              repo: null, repoRoot: repoRootNoRepo, workspaceRoot: cwd,
              maps: [], issues: [], thinTickets: [], labels: [],
              repository: null, backendModules: backendModulesNoRepo, selection: _selNoRepo,
              deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
            })
            return adoptSnapLog(snapNoRepo, cwd)
          }
        }
        const repo0b = await getRepoKey(cwd)
        // #366 fix: wf.refresh must bypass disk cache short-circuit (force rebuild with fresh generatedMs)
        void 0;
        const ctx2b = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: function (c: string, a: unknown[], o?: unknown) { if (typeof send !== 'function') return detectionExec(c, a, o, 'refresh'); const isGql = String((a && a[0]) || '') === 'api' && String((a && a[1]) || '').indexOf('graphql') >= 0; return send({ source: 'panel.refresh', kind: 'detail', bucket: isGql ? 'graphql' : 'rest', workspaceKey: cwd }, function () { return detectionExec(c, a, o, 'refresh') }).then(function (r) { return r.result }) } }
        const { createSnapshotComposer: createComposer2 } = await import('./tracker/snapshot.js')
        const composer2: Composer = createComposer2(reg2, { snapshotTtl: SNAPSHOT_TTL_MS })
        const res2 = await composer2.composeSnapshot(backendId2, repoRef2, ctx2b, { ifNoneMatch: (args && (args.ifNoneMatch || args.version)) || '', force: true })
        if (!res2.ok) throw new Error((res2.error && res2.error.message) || 'composeSnapshot failed')
                  const inner2 = upcaseSnapStates(res2.snapshot)
        ;(inner2.maps || []).forEach(function(m){ 
          if (m.number == null && m.key != null) { const nn = parseInt(m.key,10); if(!isNaN(nn)) m.number = nn; }
          try {
            const tickets = m.tickets || []
            // 补 number（GitHub 仅有 key，旧的地图列表和地图详情用 number 展示）
            // 把新形状的阻塞边压成旧视图要的数字数组，把认领人数组派生为旧视图要的认领名字符串，再算层级和统计
            tickets.forEach(function(t){
              if(t && t.key != null && t.number == null){ const nn=parseInt(t.key,10); if(!isNaN(nn)) t.number=nn; if(t.key!=null) t.key=String(t.key) }
              if (t && Array.isArray(t.blockedBy)) {
                t.blockedBy = t.blockedBy.map(function(ref){
                  if (typeof ref === 'number') return ref
                  if (ref && typeof ref === 'object' && ref.key != null) {
                    const nk = String(ref.key)
                    const nn = parseInt(nk, 10)
                    if (!isNaN(nn)) return nn
                    return nk
                  }
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
            const stats = (typeof groupTickets === 'function') ? groupTickets(tickets) : { total: tickets.length, open: tickets.filter(function(x){return x.state!=='CLOSED'}).length, closed: tickets.filter(function(x){return x.state==='CLOSED'}).length, frontier:0, claimed:0, blocked:0, levels:[], levelOf:{} }
            m.stats = stats
          } catch {}
        })
        ;(inner2.issues || []).forEach(function(it){ if (it.number == null && it.key != null) { const nn = parseInt(it.key,10); if(!isNaN(nn)) it.number = nn; } })
        let allForList2: Row[] = ([] as Row[]).concat(inner2.maps || []).concat((inner2.maps||[]).flatMap(function(m){ return m.tickets||[]; })).concat(inner2.issues||[])
        // #589：三段拼接会让身兼两职的票出现两次，这里按身份收成一行（地图容器优先）
        allForList2 = (await _dedupe()).dedupeListByPool(allForList2)
        const labels2 = inner2.labels || (function(){
          const mm: Record<string, unknown> = {}
          ;([] as Row[]).concat(inner2.maps||[]).concat(inner2.issues||[]).forEach(function(x){ (x.labels||[]).forEach(function(l){ if(l.color && !mm[l.name]) mm[l.name]=l.color }) })
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
          if (tr && typeof tr.getCurrentUser === 'function') {
            const vr = await tr.getCurrentUser(repoRef2, ctx2b)
            if (vr && vr.ok && vr.data) { viewer2 = vr.data; viewerLogin2 = vr.data.login || null }
          }
        } catch {}
        // 共用信封：这条路与 wf.snapshot 的 GitHub 分支同形（含 viewer / viewerLogin）。
        const snap2 = env!.buildSnap({
          repo: repo0b, repoRoot: repoRoot2, workspaceRoot: cwd,
          maps: inner2.maps, issues: allForList2, thinTickets: inner2.thinTickets, labels: labels2,
          repository: repoRef2, backendModules: backendModules2, selection: _sel,
          viewer: viewer2, viewerLogin: viewerLogin2, deck: inner2.deck,
        })
        await writeDiskCache(snap2.repo, snap2)
        return adoptSnapLog(snap2, cwd)
      } catch (e) {
        setCache({ ts: Date.now(), snapshot: null, error: errText(e), cwd: cwd })
        return { ok: false, error: errText(e) }
      }
  }
  return { handleRefresh }
}
