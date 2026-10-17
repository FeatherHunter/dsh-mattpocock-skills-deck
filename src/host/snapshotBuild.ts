// src/host/snapshotBuild.ts —— 面板快照组装与地图详情拉取（从 issueDetail.ts 拆出，#599）。
//
// 为什么拆：issueDetail.js 当时 349 行，紧贴「src 文件 ≤350 行」的门禁（tests/verify-file-granularity.ts），
// 而本票要在那张文件里给「已合并」补状态归一，加不进去。按仓库既有做法（拆分管线的先例见
// tests/same-layer-baseline.json：入口 src/host/index.js 引用同层模块共 25 条）把两件事分开：
//   本文件 = 「按工作区组装整份快照」：拉地图详情与子票、拼 maps/issues/labels、报选择与仓库身份；
//   issueDetail.ts = 「单张票的详情读取」：GraphQL 与 REST 两路，含已合并的状态归一。
// 两半的改动理由不同：前者随卡片字段与选择/仓库身份变，后者随单票字段与降级路变。
//
// 接线：同层互引门禁（tests/verify-dependency-rules.ts）不许两个「干活的」文件互相引用 ——
// 组合点放在宿主入口 src/host/index.ts：地图详情拉取与 buildSnapshot 都产自本文件，
// issueDetail.ts 要的那份也由入口转交。
//
// #1115：本文件两处 opCtx（viewer 预取与 select 三级联）的计时器口改用共享层那一份实现；
//   原先各写一遍的全局 clearTimeout 在真句柄上是空操作，撤销不掉那笔等待（详见该文件头注释）。
import { hostTimers } from '../shared/host-timer/host-timers.js'
// #1139：界面描述（发给界面的那份后端数据）的投影只有一处实现，本文件不再自己挑字段。
import { projectUiDescription } from '../tracker/ui-description.js'
// 界面描述的投影要求后端模块是契约里那一份（interface BackendModule）：这里引用同一个类型，
// 而不是另抄一份形状——抄一份的话，契约加字段时这里不会跟着变，投影就会静默少键。
import type { BackendModule } from '../tracker/contract/backend-module.js'

// ── 依赖与回包形状（票 #1155 补类型标注）─────────────────────────────────────────
// 为什么在这里逐条写：本文件的依赖对象是 src/host/index.ts 里现拼出来的那份接线（转制后旧注记里“编译器看不见”已过时，
// 编译器看不见），所以这一组类型就是「本文件按什么形状读它们」的书面约定。只列本文件真正读到的格子：
// 接线对不上时，报错点应当落在这一组类型上，而不是等到运行时才发现某一格是空的。
// 标注只是给编译器看的，运行期形状一个字都没改——产物逐字节比对是这条约定的验收办法。

/** 出站命令回包（runGh 那一支）：成功那支一定带 text，失败那支带 kind/error；code 只有部分路给。 */
type GhReply =
  | { ok: true; text: string; code?: number }
  | { ok: false; kind?: string; error?: string; text?: string; code?: number }

/** 出站命令回包（execProc 那一支）：语义与 runGh 同一套，区别是成功那支也带 code（宿主按退出码给）。 */
type ExecReplyResult =
  | { ok: true; text: string; code: number }
  | { ok: false; error?: string; code?: number; text?: string }

/** 列表路的票（REST 那一路）：labels 是数组；除票号外都按未知值收，谁读谁判。 */
type ListIssue = {
  number: number
  state?: string
  labels?: Array<{ name?: string }> | null
  /** 能力计数按字段名逐格查（见 buildSnapshot 里的 capCount），所以这里留一条索引签名。 */
  [extra: string]: unknown
}

/** 详情路的票（GraphQL 那一路）：labels 是 {nodes}；子票也来自这一路，形状同源。 */
type DetailIssue = {
  number: number
  title?: unknown
  state?: string
  url?: unknown
  body?: unknown
  labels?: { nodes?: Array<{ name?: string }> } | null
  subIssues?: { nodes?: DetailIssue[] } | null
}

/** 面板票（mapTicket 的产物）：分层与分组只读其中几格；level 是本文件组装快照时现挂上去的，不是后端字段。 */
type PanelTicket = {
  number: number
  state?: string
  claimedBy?: unknown
  blockedBy: ReadonlyArray<number | string>
  level?: number
  [extra: string]: unknown
}

/** 分层结果：本文件只用 byNumber（票号 → 深度）这一格，levels 原样透传给界面。 */
type TicketLevels = { byNumber: Record<string, number>; levels: unknown[] }

/** 地图正文解析出来的五段：本文件一格都不读，原样装进快照交给界面。 */
type MapBodySections = { destination: unknown; notes: unknown; decisions: unknown; fog: unknown; outOfScope: unknown }

/**
 * 地图详情回包（GraphQL 一次查全部与 REST 降级路同一形状）：issues 按 aliases 拼出来的 mN 键放票。
 * 写成「成功/失败」两支的联合，理由与 fetchIssues 那格相同：读它的地方是 `detailOk ? d.issues[…] : null`
 * 与 `!detailOk ? d.error : …` 两种，只有联合能让 `d.ok` 为真那一支认定 issues 存在。
 * fallback／fallbackAt（REST 降级标记与降级时刻）两支都留着：成功那支正是降级路写进去的。
 */
type MapsDetail =
  | { ok: true; issues: Record<string, DetailIssue | null>; fallback?: string | null; fallbackAt?: number | null }
  | { ok: false; error?: unknown; fallback?: string | null; fallbackAt?: number | null }

/** 选择结论：本文件只读 backendId 与 source 两格（显式空是权威结论，见 buildSnapshot 里的注释）。 */
type Selection = { backendId?: string | null; source?: string }

/** 仓库身份（describe 的产物）：四格都可缺——兜底形态下只剩 backend 与 refId。 */
type RepositoryRef = { backend?: string; refId?: string; name?: string; url?: string }

/** 后端实例（注册表 get 的产物）：本文件只用 getCurrentUser 一格，取不到就当没有。 */
type TrackerView = {
  getCurrentUser?(repo: unknown, ctx: unknown): Promise<{ ok?: boolean; data?: { login?: unknown } } | null>
}

/**
 * 注册表里的后端模块（本文件只读 id 与 links 两格）。links 在这里写成「必有」：读它的那句守卫
 * 长在 `modsHere[mi]` 这种下标访问上，而下标 mi 是 var（值可变），编译器不把上一次下标访问的判空
 * 结果带到下一次，于是 `.links.repoUrlTemplate` 会被判成可能为空。运行期某个模块真没声明 links，
 * 那句 `&&` 也照旧短路掉，行为一个字不变——这里是把「模块都带意愿位」这条约定写进类型，
 * 而不是为了迁就编译器去改运行表达式。
 */
type SnapshotBackendModule = BackendModule & { links: NonNullable<BackendModule['links']> }

/** 注册表：本文件读的四格——select 定后端、describe 出仓库身份、get 取后端实例、modules 出界面描述。 */
type RegistrySlice = {
  select(handle: unknown, ctx: unknown): Promise<Selection | null>
  describe(handle: unknown, backendId: string): RepositoryRef | null
  get(backendId: string): TrackerView | null | undefined
  modules(): SnapshotBackendModule[]
}

/** 探测句柄：注册表认 cwd 与 refId 两格；这里只填得上 cwd，refId 由注册表自己按目录推。 */
type HostHandle = { cwd?: string; refId?: string }

/** exec 的回包（本文件自己往这一格填）：stdout 与 text 是同一段文本，code 归一到整数。 */
type ExecReply = { stdout: string; text: string; ok: true; code: number }

/** 一次注册表调用的上下文：本文件只填这几格；exec 是后端读仓库用的出站口（与宿主那条同签名）。 */
type RegistryOpCtx = {
  cwd: string
  platform: unknown
  fs: unknown
  caller: string
  timers: unknown
  exec(cmd: unknown, args: string[] | null | undefined, opts: { cwd?: string } | null | undefined): Promise<ExecReply>
}

/** 探测服务：本文件只调 detect，读回包里的 selection 一格（选择三级联的权威那一路）。 */
type DetectionService = {
  detect(input: unknown, opts: unknown): Promise<{ selection?: Selection | null } | null>
}

/** 组装快照要的依赖：接线对象在 src/host/index.ts 里现拼，这里只列本文件用到的那些。 */
type SnapshotDeps = {
  getRepoKey(cwd: string): Promise<{ owner: string; name: string } | null>
  runGh(args: string[], cwd?: string, via?: string): Promise<GhReply>
  execProc(argv: string[], cwd: string, via: string): Promise<ExecReplyResult>
  /**
   * 全量票列表。成功那支一定有 issues、失败那支没有：调用处两种写法都在 `fi.ok` 为真的分支里读它
   * （`fi.ok ? fi.issues : []` 与 `fi.ok ? fi.issues.filter(…) : []`），所以这里的回包必须写成
   * 「成功/失败」两支的联合，编译器才会在 `fi.ok` 为真时认定 issues 存在；写成 `issues?:` 一个可选字段，
   * 后一种写法会被判成「可能为 undefined」。
   */
  fetchIssues(cwd: string): Promise<{ ok: true; issues: ListIssue[] } | { ok: false; error?: unknown }>
  fetchMapsDetailREST(numbers: number[], cwd: string): Promise<MapsDetail>
  mapTicket(raw: DetailIssue): PanelTicket
  parseMapBody(body: unknown): MapBodySections
  computeLevels(tickets: readonly PanelTicket[]): TicketLevels
  /** 分组统计整包透传给界面，本文件不读其中任何一格（渲染侧按 stats 渲染漏斗）。 */
  groupTickets(tickets: readonly PanelTicket[]): unknown
  isRateLimitError(reply: unknown): boolean
  /**
   * 取注册表。写「一定给出注册表」而不是「可能为 null」：这条路取不到时是抛（见 host/platformChannel.js
   * 里那份按注入→自建两步走、失败即 reject 的实现），调用处也用整段 try 兜着；
   * 正文里那两处 `reg &&` 是原有防御写法，跟这里的标注不冲突，保留不动。
   */
  getTrackerRegistry(): Promise<RegistrySlice>
  getPlatform(): Promise<unknown>
  getRepoRoot(cwd: string): Promise<string>
  getGhPath(): unknown
  getGhLastError(): unknown
  getDetectionService?(): Promise<DetectionService>
  ctx: { get(name: string): unknown }
  /** 宿主计时器服务：原样转交给共享层的 hostTimers（那边按「可能缺席」收口）。 */
  timer: unknown
}

/**
 * 组装面板整份快照与多张地图详情拉取器（#599 / #1074 / #1155）。
 *
 * 为什么：面板首页与状态栏需要一次性拿到当前工作区的后端选择、全部关卡地图、子票拓扑层级与普通工单列表；将「多地图别名合并拉取（`fetchMapsDetail`）」与「统一后端快照拼装（`buildSnapshot`）」集中在这里，供会话快照缓存层（`sessionSnapshot.ts`）按需调用。
 * 什么约定不能改：
 *   1. 已选定后端时优先走后端注册表的 `tracker.snapshot()` 新路径，未选定或尚未命中时返回空集合信封 `{ ok: true, maps: [], issues: [], labels: [], selection }`，保证面板在未绑定工作区时也能正常渲染引导页。
 *   2. 每张地图的子票统计（`groupTickets`）与拓扑层级（`computeLevels`）必须由宿主算好塞进快照，面板只读宿主拼好的快照，不得在客户端重算或直连后端房间。
 *   3. `deps.getDetectionService` 可能在测试夹具中缺席，调用前必须保留 `typeof deps.getDetectionService === 'function'` 守卫。
 * 反例：若在 `deps.getDetectionService` 未传入的轻量测试夹具里无条件调用 `await deps.getDetectionService()`，会直接抛出 `TypeError: deps.getDetectionService is not a function`，打崩快照兜底分支。
 */
export function createSnapshotBuilder(deps: SnapshotDeps) {
  const { getRepoKey, runGh, fetchIssues, getTrackerRegistry, getPlatform, execProc } = deps
  const { fetchMapsDetailREST, mapTicket, parseMapBody, computeLevels, groupTickets, isRateLimitError } = deps
  const { getRepoRoot, ctx, timer, getGhPath, getGhLastError } = deps
    // 返回值按「成功那支 issues 存在、失败那支带 error」的联合标注（MapsDetail 的几格都可缺）：
    // 不标的话，编译器会把几个 return 拼成一个松散联合，下面 `d.error`／`d.issues` 的读法就各报各的。
    async function fetchMapsDetail(numbers: number[], cwd: string): Promise<MapsDetail> {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo（git remote 或 gh repo view 失败）' } }
      if (!numbers || !numbers.length) return { ok: true, issues: {} }
      // 构造 aliases 查询：query($owner:String!,$name:String!){repository(...){m0:issue(number:409){...} m1:issue(...){...}}}
      const frag = 'number title state body url author{login avatarUrl ... on User{name} ... on Organization{name}} labels(first:20){nodes{name}} subIssues(first:100){totalCount nodes{number title state body url author{login avatarUrl ... on User{name} ... on Organization{name}} labels(first:10){nodes{name}} assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}}}}'
      const sel = numbers.map(function (n, i) { return 'm' + i + ':issue(number:' + n + '){' + frag + '}' }).join(' ')
      const query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){' + sel + '}}'
      let last = null
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await runGh(['api', 'graphql', '-f', 'query=' + query, '-F', 'owner=' + repo.owner, '-F', 'name=' + repo.name], cwd)
        if (!r.ok) {
          last = r
          // v1.5 B5：GraphQL 配额耗尽（RATE_LIMIT）→ 自动降级 REST 通道（不重试 2 次白烧，直接降级）
          if (isRateLimitError(r)) return fetchMapsDetailREST(numbers, cwd)
          if (r.kind !== 'network') return { ok: false, error: r }
          continue
        }
        try {
          const j = JSON.parse(r.text)
          if (j.errors) {
            // v1.5 B5：GraphQL 返回 errors（含 RATE_LIMIT）→ REST 降级
            if (isRateLimitError({ error: JSON.stringify(j.errors) })) return fetchMapsDetailREST(numbers, cwd)
            return { ok: false, error: { kind: 'graphql', error: JSON.stringify(j.errors).slice(0, 300) } }
          }
          return { ok: true, issues: j.data.repository }
        } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
      }
      return { ok: false, error: last || { kind: 'network', error: 'GraphQL aliases 请求失败（重试后仍失败）' } }
    }


    async function buildSnapshot(cwd: string, hintBackendId: unknown) {
      let viewerLogin = null // 由 Tracker.getCurrentUser 填充（后端接口返回当前用户，UI 仅对比，不直调 gh）
      let viewer = null
      const repo = await getRepoKey(cwd)
      // v1.3.3 提速：map 列表直接从全量 issues 过滤（fetchMaps 单独调用省去 —— 原 11 次 → 9 次 gh 调用）
      const fi = await fetchIssues(cwd)
      const issues = fi.ok ? fi.issues : []
      const mapsMeta = fi.ok ? fi.issues.filter(function (x) {
        return x.state === 'OPEN' && (x.labels || []).some(function (l) { return l.name === 'wayfinder:map' })
      }) : []
      // #375：全量 label 列表（含空 label；获取失败容错置空，不阻塞快照构建，client 降级）
      // name 收成未知值：它直接来自 gh 的 JSON，颜色那一格有兜底、名字没有。
      let labels: Array<{ name: unknown; color: string }> = []
      const fl = await runGh(['label', 'list', '--json', 'name,color'], cwd)
      if (fl.ok) {
        try {
          const ls = JSON.parse(fl.text)
          if (Array.isArray(ls)) labels = ls.map(function (l) { return { name: l.name, color: l.color || '' } })
        } catch (e) { labels = [] }
      }
      // v1.3.3 提速：GraphQL aliases 一次查全部 map 详情（原每 map 一次 GraphQL，8 次串行 ~19s → 1 次 ~4s）
      const d = await fetchMapsDetail(mapsMeta.map(function (m) { return m.number }), cwd)
      const detailOk = d.ok
      const maps = []
      for (let i = 0; i < mapsMeta.length; i++) {
        const m = mapsMeta[i]
        const issue = detailOk ? (d.issues['m' + i] || null) : null
        if (!detailOk || !issue) {
          maps.push({ number: m.number, title: m.title, state: 'OPEN', error: detailOk ? undefined : d.error, tickets: [], stats: { total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0 } })
          continue
        }
        const subs = (issue.subIssues && issue.subIssues.nodes) || []
        const tickets = subs.map(mapTicket)
        const bp = parseMapBody(issue.body)
        // v1.4（T1 #442）：每张票挂 level（DAG 最长路径深度），client 渲染漏斗分层直接取
        const lvInfo = computeLevels(tickets)
        tickets.forEach(function (t) { t.level = lvInfo.byNumber[t.number] })
        const stats = groupTickets(tickets)
        const labels2 = ((issue.labels && issue.labels.nodes) || []).map(function (x) { return x.name })
        maps.push({
          number: issue.number, title: issue.title, state: issue.state, url: issue.url, labels: labels2,
          destination: bp.destination, notes: bp.notes,
          decisions: bp.decisions, fog: bp.fog, outOfScope: bp.outOfScope,
          tickets: tickets, stats: stats,
        })
      }
      // v1.5 R2 + R2-fix-6（#2 MVP E2E 实证 2026-08-18）：probe since 基线**不得**在 buildSnapshot 里初始化/推进。
      //   原实现「buildSnapshot 末尾 lastProbeAtByRepo[rk]=now」有个致命竞态：面板任一 snapshot build（cache-miss/
      //    refresh）若发生在某次编辑**之后**，会把基线推到编辑时刻**之后** → 下次 probe since=基线 查不到该编辑
      //   （count=0 → changed=false），且基线只在 changed=true 时才滑动 → 编辑被**永久吞掉**，UI 永不刷新。
      //   正确语义：基线只能由 probe 自己推进（检测到 change 时置为「本次探测时刻」）；build 完成 ≠ client 已渲染该
      //   快照，无权动基线。首次 probe（since=undefined）自然走全量返回 → 视为 changed → 建立基线（符合原注释意图）。
      // B 方案：viewerLogin 经 Tracker.getCurrentUser（后端接口）获取，UI 仅做 login 对比，不直调 gh，不硬编码 backendId
      // #155：Selection/RepositoryRef 增量（registry.select/describe → wf.snapshot {repository, selection}）
      let selection = null
      let repository = null
      try {
        const reg = await getTrackerRegistry()
        // 预取 viewer（供 UI “本人不显”对比），失败则保持 null（全显）
        try {
          const tmpReg = reg
          const tmpHandle: HostHandle = { cwd: cwd }
          const tmpCtx: RegistryOpCtx = { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), caller: 'issue-detail-viewer', timers: hostTimers(timer), exec: async function(cmd, args, opts){ const argv=[String(cmd)].concat(args||[]); const c=(opts&&opts.cwd)||cwd; const r=await execProc(argv, c, 'viewer-lookup'); if(!r.ok) throw new Error(r.error||String(r.code||'exec failed')); return { stdout:r.text, text:r.text, ok:true, code:(Number.isInteger(r.code) ? r.code : 0) } } }
          const selForViewer = await tmpReg.select(tmpHandle, tmpCtx)
          const vid = selForViewer && selForViewer.backendId
          if (vid) {
            const tr = tmpReg.get(vid)
            if (tr && typeof tr.getCurrentUser === 'function') {
              const vr = await tr.getCurrentUser({ backend: vid, refId: (tmpHandle.refId||''), name: '', url: '' }, tmpCtx)
              if (vr && vr.ok && vr.data && vr.data.login) { viewerLogin = String(vr.data.login).trim(); viewer = vr.data }
            }
          }
        } catch (e) {}
        if (reg && typeof reg.select === 'function') {
          const handle = { cwd: cwd }
          const ctxSel: RegistryOpCtx = { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), caller: 'issue-detail-select', timers: hostTimers(timer), exec: async function(cmd, args, opts){ const argv=[String(cmd)].concat(args||[]); const c=(opts&&opts.cwd)||cwd; const r=await execProc(argv, c, 'snapshot-select'); if(!r.ok) throw new Error(r.error||String(r.code||'exec failed')); return { stdout:r.text, text:r.text, ok:true, code:(Number.isInteger(r.code) ? r.code : 0) } } }
          // 能力诊断计数（G5 仅诊断，不驱动隐藏）——按 host 视角 fill 统计
          const capCount = (function(iss: ListIssue[]){
            let present=0, emptyCnt=0, missing=0
            // 简易：以 labels 为例，其余字段按 shape 能力字段集计数
            const fields=['author','assignees','labels','milestone','customFields','reason','blockedBy','comments','closedAt']
            iss.forEach(function(it){
              fields.forEach(function(f){
                if (it[f] === undefined) missing++
                else if (Array.isArray(it[f]) && it[f].length===0) emptyCnt++
                else if (it[f]===null || it[f]==='') emptyCnt++
                else present++
              })
            })
            return {present, empty: emptyCnt, missing}
          })(issues)
          // select 三级联（2026-08-28 真源统一）：快照 selection 与 wf.chain/wf.detect 同构——
          //   经 detectionService 判定（explicit 主锚 → matches → fallback），主锚是权威。
          //   此前快照裸 registry.select 不读主锚：「GitHub 版锚 + 非 git 目录」在快照侧判 fallback null，
          //   客户端保留旧 markdown 意向 → 头部 chip=Markdown 与环境检查=github（链按锚判定）互相矛盾（用户观察）。
          const selMod = await (typeof deps.getDetectionService === 'function' ? deps.getDetectionService().then(function(svc){ return svc.detect({ cwd }, { skipSkillProbes: true }) }).catch(function(){ return null }) : null) // 接线从没注入过这一口（index.ts 不传），原来同步抛、外层 355 行接住走 selection=null；守卫后同样走 null，行为不变
          let sel = selMod && selMod.selection
          // #297 失效维度：显式空（source explicit + null）是权威“无后端”（空目录 stale），不退回裸 select，否则旧绑定会复活
          if (!sel || (sel.backendId == null && (!sel.source || sel.source !== 'explicit'))) {
            // detect 无结论（fallback null / 服务不可用）：退回裸 select（bind 记忆 → matches）兼容旧行为
            try { sel = await reg.select(handle, ctxSel) } catch (eSel) { sel = null }
          }
          selection = sel
          if (sel && sel.backendId) {
            try { repository = reg.describe(handle, sel.backendId) } catch {}
            // 2026-08-28 加固（Dock「后端名 · 目录名」兜底根因）：describe 以 handle.refId 为准，handle 无 refId 时退化为
            //   「目录名 + 无 url」——正常 GitHub 仓库也会因临时 fs/git 读取差异落入该弱结果，UI 头部只剩兜底形态。
            //   refId/name 是身份真相（url 才受 links.repoUrlTemplate 意愿位约束）：getRepoKey 可解析即无条件补全 owner/name。
            if ((!repository || !repository.refId) && repo && repo.owner) {
              try { repository = reg.describe({ cwd: cwd, refId: repo.owner + '/' + repo.name }, sel.backendId) } catch (eDesc2) {}
            }
            if ((!repository || !repository.refId) && repo && repo.owner) {
              try { repository = { backend: sel.backendId, refId: repo.owner + '/' + repo.name, name: repo.owner + '/' + repo.name, url: '' } } catch (eD2) {}
            }
            // 2026-08-28 契约修正（用户复核）：仓库名一律由后端 describe 经契约层产出，UI 层零派生——
            //   markdown 本地形态（目录即仓库）同样经 describe 给出 name=目录名；describe 异常/弱结果时
            //   host 侧按目录名兜底（数据产生在半，UI 直显），绝不把「前端拼装」当作仓库身份来源。
            if (!repository) {
              try { repository = reg.describe({ cwd: cwd, refId: cwd }, sel.backendId) } catch (eNa) {}
            }
            if (!repository) {
              try {
                const nm = String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || sel.backendId
                repository = { backend: sel.backendId, refId: String(cwd || ''), name: nm, url: '' }
              } catch (eNb) {}
            }
            // #231：后端特判删除 —— 是否补链由该后端 links.repoUrlTemplate 意愿位声明；补全走其自身 describe（单源产出 refId/name/url）
            if (repository && !repository.url && sel.backendId && repo && repo.owner) {
              var wantsUrlSeed = false
              try {
                var modsHere = (reg && typeof reg.modules === 'function') ? reg.modules() : []
                for (var mi = 0; mi < modsHere.length; mi++) {
                  if (modsHere[mi] && modsHere[mi].id === sel.backendId && modsHere[mi].links && modsHere[mi].links.repoUrlTemplate) { wantsUrlSeed = true; break }
                }
              } catch (eSeed) {}
              if (wantsUrlSeed) { try { repository = reg.describe({ cwd: cwd, refId: repo.owner + '/' + repo.name }, sel.backendId) } catch (eDesc) {} }
            }
          } else {
            // fallback（无选择）时诚实占位：不带任何品牌 url，UI 按「无链接」渲染
            if (repo) repository = { backend: '', refId: repo.owner + '/' + repo.name, name: repo.owner + '/' + repo.name, url: '' }
            else repository = null
          }
          // 能力计数挂到 snapshot 供 ChecksTab 诊断卡。
          // `var` 声明在 if 里、取值在 if 外的 return 里（var 提升到函数作用域），选不出后端时这一格本就没算过——
          // 下面取值处那句 `typeof _capDiag !== 'undefined'` 就是为这个写的。类型照实标成「可能是 undefined」，
          // 让编译器认下这句守卫；这不是新缺陷，是原来就按「可能缺席」写好的语义。
          var _capDiag: typeof capCount | undefined = capCount
        }
      } catch (e) { /* 保持 null，不阻塞快照 */ }
      // #191: backendModules 透传（presentation 色板）—— 修复 ReferenceError: backendModules is not defined (#195 遗漏)
      let backendModules = null
      try {
        const regM = await getTrackerRegistry()
        if (regM && typeof regM.modules === 'function') {
          // 2026-08-28 修复：快照 backendModules 必须与 wf.registry 上报同构（含 setupPrompt 键表）——
          //   缺 setupPrompt 时 setupRunParamsFrom 匹配不到该后端 → 注入的 setup 提示词落回默认键组（GitHub 版），
          //   表现为「选了 gitlab/markdown，点初始化按钮注入的却还是默认 GitHub」（用户观察）。
          backendModules = regM.modules().map(projectUiDescription)
        }
      } catch (e2) {}
      return {
        ok: true,
        repo: repo,
        repoRoot: await getRepoRoot(cwd),  // v1.5 T9：git 根路径（供仓库身份组件与 setup 检查）
        updatedAt: new Date().toISOString(),
        generatedMs: Date.now(),
        env: { ghPath: getGhPath(), ghError: getGhLastError() },
        maps: maps,
        issues: issues,
        labels: labels,
        fallback: d.fallback || null,  // v1.5 B5：'rest' = GraphQL 配额耗尽已降级 REST（client 可提示）
        fallbackAt: d.fallbackAt || null,  // 2026-09-24：这次降级发生的时刻（界面据此说“多久以前”，不再冒充现在）
        repository: repository,
        backendModules: backendModules,
        selection: selection,
        capabilities: (typeof _capDiag !== 'undefined' ? _capDiag : null),
        viewer: viewer, // 后端接口返回当前用户（Actor），UI 据此做“本人不显”对比
        viewerLogin: viewerLogin, // 兼容旧 UI（string），与 viewer.login 同步
      }
    }


  return { fetchMapsDetail, buildSnapshot }
}
