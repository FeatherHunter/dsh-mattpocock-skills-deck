// src/refresh/rooms/host/snapshot-build.ts —— 面板快照组装（从 issueDetail.ts 拆出，#599）。
//
// 为什么拆：issueDetail.js 当时 349 行，紧贴「src 文件 ≤350 行」的门禁（tests/verify-file-granularity.ts），
// 而那张文件要装单票详情、这张文件要装整份快照，两者随不同字段变，混在一起谁也长不动。
//
// #1444（规格 1439 的 A2 第一批）：快照的读路径从「本文件直调 gh」改成「经 Tracker 只读会话调能力」——
//   整仓票走 list、每张地图的子票走 listSubIssues（items 自带 blockedBy）、标签走 listLabels、
//   本人走 getCurrentUser。原来那条 GraphQL aliases 多图查询与它的 REST 降级路整段删掉：
//   开会话失败或整仓列表失败时，本文件回 { ok:false, error } 旧包形状，让上层照旧降级回缓存；
//   单张地图取不到子票只降级那一张，标签与本人取不到退回 [] 与 null —— 三条都与迁移前同口径。
//   读操作在会话里不花额度（裁决 reason read-path），所以本文件不记任何账。
//
// 接线：同层互引门禁（tests/verify-dependency-rules.ts）不许两个「干活的」文件互相引用 ——
// 组合点放在宿主入口 src/host/index.ts：buildSnapshot 产自本文件，单票详情那一份由入口转交。
//
// #1115：选后端那一段的计时器口改用共享层那一份实现（原先各写一遍的全局 clearTimeout 在真句柄上是空操作）。
import type { HostTimerService } from '../../contract/host-timer-ports.js'
import { hostTimers } from '../../contract/host-timer-ports.js'
// #1139：界面描述（发给界面的那份后端数据）的投影只有一处实现，本文件不再自己挑字段。
import { projectUiDescription } from '../../../tracker/ui-description.js'
// 界面描述的投影要求后端模块是契约里那一份（interface BackendModule）：这里引用同一个类型，
// 而不是另抄一份形状——抄一份的话，契约加字段时这里不会跟着变，投影就会静默少键。
import type { BackendModule } from '../../../tracker/contract/backend-module.js'

// ── 依赖与回包形状（票 #1155 补类型标注，#1444 收窄）───────────────────────────
// 为什么在这里逐条写：本文件的依赖对象是 src/host/index.ts 里现拼出来的那份接线，
// 编译器看不见，所以这一组类型就是「本文件按什么形状读它们」的书面约定。只列本文件真正读到的格子：
// 接线对不上时，报错点应当落在这一组类型上，而不是等到运行时才发现某一格是空的。
// #1444 起本文件只读下面列出的这些格子；旧路的 runGh / fetchIssues / fetchMapsDetailREST / isRateLimitError
// 已随迁移一起从接线与依赖声明里删掉（本票收口）。

/** 出站命令回包（execProc 那一支）：成功那支带 text 与 code，失败那支带 error；选后端时后端读仓库要用它。 */
type ExecReplyResult =
  | { ok: true; text: string; code: number }
  | { ok: false; error?: string; code?: number; text?: string }

/** 列表行：整仓票经会话 list 取到后，按迁移前 gh 输出那一套形状摊平（大写状态、assignees 是 login 数组）。 */
type ListRow = {
  number: number | string
  title?: unknown
  state?: string
  assignees?: unknown[]
  labels?: Array<{ name?: unknown; color: string }>
  author?: { login: unknown; name: string; avatarUrl: string }
  updatedAt?: unknown
  createdAt?: unknown
  /** 能力计数按字段名逐格查（见 capCount），所以这里留一条索引签名。 */
  [extra: string]: unknown
}

/**
 * 子票的 GraphQL 形状（mapTicket 认识的输入）：labels/assignees 是 {nodes}，
 * blockedBy/blocking 也是 {nodes}。会话交回来的是契约 Issue（数组字段 + key），
 * 由 subRaw 逐格翻译成这一份——mapTicket 与下文分层/分组一行都没改。
 */
type DetailIssue = {
  number: number
  title?: unknown
  state?: string
  url?: unknown
  body?: unknown
  labels?: { nodes?: Array<{ name?: string }> } | null
  assignees?: { nodes?: Array<{ login?: unknown }> } | null
  blockedBy?: { nodes?: Array<{ number?: number | string }> } | null
  blocking?: { nodes?: Array<number | string> } | null
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

/** 选择结论：本文件只读 backendId 与 source 两格（显式空是权威结论，见 pickBackend 里的注释）。 */
type Selection = { backendId?: string | null; source?: string }

/** 仓库身份（describe 的产物）：四格都可缺——兜底形态下只剩 backend 与 refId。 */
type RepositoryRef = { backend?: string; refId?: string; name?: string; url?: string }

/**
 * 注册表里的后端模块（本文件只读 id 与 links 两格）。links 在这里写成「必有」：读它的那句守卫
 * 长在 mods[i] 这种下标访问上，而下标是 var（值可变），编译器不把上一次下标访问的判空结果
 * 带到下一次，于是 links.repoUrlTemplate 会被判成可能为空。运行期某个模块真没声明 links，
 * 那句 && 也照旧短路掉，行为一个字不变——这里是把「模块都带意愿位」这条约定写进类型。
 */
type SnapshotBackendModule = BackendModule & { links: NonNullable<BackendModule['links']> }

/** 注册表：本文件读的三格——select 定后端、describe 出仓库身份、modules 出界面描述。 */
type RegistrySlice = {
  select(handle: unknown, ctx: unknown): Promise<Selection | null>
  describe(handle: unknown, backendId: string): RepositoryRef | null
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
  /** #1444：拿只读会话的装配口（宿主接线注入；缺省时本文件如实回失败，不再退回直调 gh 的旧路）。 */
  openSession?: any
  getRepoKey(cwd: string): Promise<{ owner: string; name: string } | null>
  execProc(argv: string[], cwd: string, via: string): Promise<ExecReplyResult>
  mapTicket(raw: DetailIssue): PanelTicket
  parseMapBody(body: unknown): MapBodySections
  computeLevels(tickets: readonly PanelTicket[]): TicketLevels
  /** 分组统计整包透传给界面，本文件不读其中任何一格（渲染侧按 stats 渲染漏斗）。 */
  groupTickets(tickets: readonly PanelTicket[]): unknown
  /**
   * 取注册表。写「一定给出注册表」而不是「可能为 null」：这条路取不到时是抛（见 host/platformChannel.js
   * 里那份按注入→自建两步走、失败即 reject 的实现），调用处也用整段 try 兜着。
   */
  getTrackerRegistry(): Promise<RegistrySlice>
  getPlatform(): Promise<unknown>
  getRepoRoot(cwd: string): Promise<string>
  getGhPath(): unknown
  getGhLastError(): unknown
  getDetectionService?(): Promise<DetectionService>
  ctx: { get(name: string): unknown }
  /** 宿主计时器服务：原样转交给共享层的 hostTimers（那边按「可能缺席」收口）。 */
  timer: HostTimerService
}

/**
 * 组装面板整份快照（#599 / #1074 / #1155 / #1444）。
 *
 * 为什么：面板首页与状态栏需要一次性拿到当前工作区的后端选择、全部关卡地图、子票拓扑层级与普通工单列表；
 * 读路径已统一到 Tracker 只读会话（#1439 规格），本文件负责把会话能力的结果拼成迁移前那一份快照。
 * 什么约定不能改：
 *   1. 已选定后端时优先沿用调用方传进来的选择结论（resolveSelection），未选定或显式空时返回空集合信封
 *      { ok: true, maps: [], issues: [], labels: [], selection }，保证面板在未绑定工作区时也能渲染引导页。
 *   2. 每张地图的子票统计（groupTickets）与拓扑层级（computeLevels）必须由宿主算好塞进快照，
 *      面板只读宿主拼好的快照，不得在客户端重算或直连后端房间。
 *   3. deps.getDetectionService 可能在测试夹具中缺席，调用前必须保留 typeof 守卫。
 *   4. 失败一律回 { ok:false, error } 旧包或降级后的空集合，绝不抛、绝不假装成功——上层据此降级回缓存。
 * 反例：若在这里把 TrackerError 原样 throw 出去，快照缓存层接不住，界面会白屏而不是显示旧缓存。
 */
export function createSnapshotBuilder(deps: SnapshotDeps) {
  const { getRepoKey, mapTicket, parseMapBody, computeLevels, groupTickets } = deps
  const { getTrackerRegistry, getPlatform, execProc, getRepoRoot, getGhPath, getGhLastError, openSession, ctx, timer } = deps

  // 票号：契约里的 key 是字符串，面板一路用数字（层级、blockedBy、地图子票查询都按数字比）。
  function numOf(key: unknown): number | string {
    const n = Number(key)
    return Number.isFinite(n) ? n : String(key == null ? '' : key)
  }
  // 状态：契约里是小写 open/closed，旧快照一直是大写 OPEN/CLOSED（面板与分组按大写判）。
  function upper(state: unknown): string {
    return String(state).toLowerCase() === 'closed' ? 'CLOSED' : 'OPEN'
  }
  function errText(e: unknown): string {
    try { return String((e && (e as any).message) || e || '') } catch (e2) { return '' }
  }
  // 失败一律归一到旧包：界面只认 {kind,error}，TrackerError 的 message/raw 不往外冒。
  function oldError(err: unknown, kind: string): { kind: string; error: string } {
    const e: any = (err && typeof err === 'object') ? err : null
    const m = e ? (e.message || e.error) : err
    return { kind: String((e && e.kind) || kind), error: String(m == null ? kind : m) }
  }

  /** 列表行：把契约 Issue 摊成旧 gh 输出的那一套（assignees 只留 login，labels 带颜色，author 带名字）。 */
  function listRow(it: any): ListRow {
    return {
      number: numOf(it && it.key),
      title: it && it.title,
      state: upper(it && it.state),
      assignees: ((it && it.assignees) || []).map(function (a: any) { return a && a.login }),
      labels: ((it && it.labels) || []).map(function (l: any) { return { name: l && l.name, color: (l && l.color) || '' } }),
      author: (it && it.author && it.author.login) ? { login: it.author.login, name: it.author.name || '', avatarUrl: it.author.avatarUrl || '' } : undefined,
      updatedAt: it && it.updatedAt,
      createdAt: it && it.createdAt,
    }
  }

  /** 会话子票 → mapTicket 认识的 GraphQL 形状（key→number、数组字段→{nodes}）；语义逐格对齐旧查询。 */
  function subRaw(it: any, blocks: Record<string, Array<number | string>>): any {
    const self = numOf(it && it.key)
    return {
      number: self,
      title: it && it.title,
      state: upper(it && it.state),
      body: it && it.body,
      url: it && it.url,
      labels: { nodes: ((it && it.labels) || []).map(function (l: any) { return { name: l && l.name } }) },
      assignees: { nodes: ((it && it.assignees) || []).map(function (a: any) { return { login: a && a.login } }) },
      blockedBy: { nodes: ((it && it.blockedBy) || []).map(function (b: any) { return { number: numOf(b && b.key) } }) },
      blocking: { nodes: (blocks[String(self)] || []).map(function (b) { return { number: b } }) },
      author: (it && it.author) ? { login: it.author.login, name: it.author.name || '', avatarUrl: it.author.avatarUrl || '' } : undefined,
    }
  }
  // 谁挡着谁：子票 A 的 blockedBy 里有 B，就是 B 挡着 A；反过来把 A 记到 B 的 blocks 上。
  // 迁移前这份 blocks 来自 GraphQL 片段的 blocking 字段，而那段查询从没请求过 blocking，
  // 所以面板上「我挡着谁」一直是空的；现在从同一批 items 的 blockedBy 反推，不额外发请求。
  function blocksOf(items: any[]): Record<string, Array<number | string>> {
    const out: Record<string, Array<number | string>> = {}
    ;(items || []).forEach(function (it: any) {
      const self = numOf(it && it.key)
      ;((it && it.blockedBy) || []).forEach(function (b: any) {
        const k = String(numOf(b && b.key))
        out[k] = out[k] || []
        out[k].push(self)
      })
    })
    return out
  }

  /** 开会话失败与插件没接线都归一到旧包；上层据此降级回缓存，不抛。 */
  async function openRead(cwd: string, resolveSelection?: any): Promise<any> {
    if (typeof openSession !== 'function') return { ok: false, error: { kind: 'env', error: 'open-session:not-wired（刷新接线没给出只读会话口）' } }
    try {
      const opened = await openSession(cwd, resolveSelection ? { resolveSelection: resolveSelection } : undefined)
      if (!opened || opened.ok !== true) return { ok: false, error: { kind: 'env', error: 'open-session:' + String((opened && opened.reason) || 'open-failed') } }
      return { ok: true, opened: opened }
    } catch (e) {
      return { ok: false, error: { kind: 'env', error: 'open-session:threw ' + errText(e) } }
    }
  }
  /** 会话里的整段读取：call 里抛的也一起兜住，回旧包而不是把 TrackerError 漏给上层。 */
  async function runRead(opened: any, fn: (session: any, opCtx: any) => Promise<any>): Promise<any> {
    try { return { ok: true, data: await opened.call(fn) } } catch (e) { return { ok: false, error: { kind: 'network', error: 'session-call:' + errText(e) } } }
  }
  /** 调一条会话能力：失败分支与抛异常都归一成 {ok:false,error}，成功只交出 data。 */
  async function readOne(session: any, opCtx: any, name: string, args: any[]): Promise<any> {
    try {
      const reply = await session[name].apply(session, args.concat([opCtx]))
      if (!reply || reply.ok !== true) return { ok: false, error: oldError(reply && reply.error, 'network') }
      return { ok: true, data: reply.data }
    } catch (e) {
      return { ok: false, error: oldError({ message: errText(e) }, 'network') }
    }
  }

  /** 选后端那一小段 opCtx：caller 与 exec 的 via 都沿用旧值，后端口径不变。 */
  async function selectionCtx(cwd: string): Promise<RegistryOpCtx> {
    return {
      cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), caller: 'issue-detail-select', timers: hostTimers(timer),
      exec: async function (cmd, args, opts) {
        const argv = [String(cmd)].concat(args || [])
        const r = await execProc(argv, (opts && opts.cwd) || cwd, 'snapshot-select')
        if (!r.ok) throw new Error(r.error || String(r.code || 'exec failed'))
        return { stdout: r.text, text: r.text, ok: true, code: (Number.isInteger(r.code) ? r.code : 0) }
      },
    }
  }

  /**
   * 仓库身份一律由后端 describe 产出（UI 零派生）：describe 弱结果/失败时按 owner/name、目录名逐级兜底，
   * 最后才用字面量占位。逐级顺序与迁移前一字不差（#155 与 2026-08-28 那条契约修正）。
   */
  function describeRepo(reg: RegistrySlice, handle: HostHandle, backendId: string, repo: any, cwd: string): RepositoryRef | null {
    let out: RepositoryRef | null = null
    try { out = reg.describe(handle, backendId) } catch (e) {}
    const ownerName = (repo && repo.owner) ? repo.owner + '/' + repo.name : ''
    if ((!out || !out.refId) && ownerName) { try { out = reg.describe({ cwd: cwd, refId: ownerName }, backendId) } catch (e) {} }
    if ((!out || !out.refId) && ownerName) { try { out = { backend: backendId, refId: ownerName, name: ownerName, url: '' } } catch (e) {} }
    if (!out) { try { out = reg.describe({ cwd: cwd, refId: cwd }, backendId) } catch (e) {} }
    if (!out) {
      try {
        const nm = String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || backendId
        out = { backend: backendId, refId: String(cwd || ''), name: nm, url: '' }
      } catch (e) {}
    }
    // #231：是否补链由该后端 links.repoUrlTemplate 意愿位声明；补全仍走它自己的 describe（单源产出 refId/name/url）。
    if (out && !out.url && ownerName) {
      let wants = false
      try {
        const mods = reg.modules()
        for (let i = 0; i < mods.length; i++) if (mods[i] && mods[i].id === backendId && mods[i].links && mods[i].links.repoUrlTemplate) { wants = true; break }
      } catch (e) {}
      if (wants) { try { out = reg.describe({ cwd: cwd, refId: ownerName }, backendId) } catch (e) {} }
    }
    return out
  }

  /**
   * 选择三级联（2026-08-28 真源统一）：快照 selection 与 wf.chain/wf.detect 同构——
   * 经 detectionService 判定（explicit 主锚 → matches → fallback），主锚是权威。
   * 此前快照裸 registry.select 不读主锚：「GitHub 版锚 + 非 git 目录」在快照侧判 fallback null，
   * 客户端保留旧 markdown 意向 → 头部 chip=Markdown 与环境检查=github 互相矛盾（用户观察）。
   */
  async function pickBackend(cwd: string, repo: any): Promise<{ selection: Selection | null; repository: RepositoryRef | null }> {
    let selection: Selection | null = null
    let repository: RepositoryRef | null = null
    try {
      const reg = await getTrackerRegistry()
      if (reg && typeof reg.select === 'function') {
        const handle: HostHandle = { cwd: cwd }
        const opCtx = await selectionCtx(cwd)
        let sel: Selection | null = null
        if (typeof deps.getDetectionService === 'function') {
          try {
            const out = await (await deps.getDetectionService()).detect({ cwd: cwd }, { skipSkillProbes: true })
            sel = (out && out.selection) || null
          } catch (eDet) { sel = null }
        }
        // #297 失效维度：显式空（source explicit + null）是权威「无后端」（空目录 stale），
        // 不退回裸 select，否则旧绑定会复活。
        if (!sel || (sel.backendId == null && (!sel.source || sel.source !== 'explicit'))) {
          try { sel = await reg.select(handle, opCtx) } catch (eSel) { sel = null }
        }
        selection = sel
        if (sel && sel.backendId) repository = describeRepo(reg, handle, sel.backendId, repo, cwd)
        else if (repo && repo.owner) repository = { backend: '', refId: repo.owner + '/' + repo.name, name: repo.owner + '/' + repo.name, url: '' }
      }
    } catch (e) { /* 保持 null，不阻塞快照 */ }
    return { selection: selection, repository: repository }
  }

  /** backendModules 透传（presentation 色板）：必须与 wf.registry 同构（含 setupPrompt 键表），取不到给 null。 */
  async function backendModulesOf(): Promise<any[] | null> {
    try {
      const reg = await getTrackerRegistry()
      if (reg && typeof reg.modules === 'function') return reg.modules().map(projectUiDescription)
    } catch (e) {}
    return null
  }

  /** 能力诊断计数（G5 仅诊断，不驱动隐藏）：按字段名逐格数「有值/空/缺」，口径迁移前一字未改。 */
  function capCount(rows: ListRow[]): { present: number; empty: number; missing: number } {
    const fields = ['author', 'assignees', 'labels', 'milestone', 'customFields', 'reason', 'blockedBy', 'comments', 'closedAt']
    let present = 0, empty = 0, missing = 0
    rows.forEach(function (it: any) {
      fields.forEach(function (f) {
        if (it[f] === undefined) missing++
        else if (Array.isArray(it[f]) && it[f].length === 0) empty++
        else if (it[f] === null || it[f] === '') empty++
        else present++
      })
    })
    return { present: present, empty: empty, missing: missing }
  }

  /**
   * 逐张地图取子票并组装：单张失败只降级这一张，票数与层级照写。
   * 入参是契约 Issue（不是摊平后的列表行）：地图正文、url、标签名字只在原始票上，摊平行照旧不带宽字段。
   */
  async function mapsOf(issues: any[], repoRef: any, session: any, opCtx: any): Promise<any[]> {
    const maps: any[] = []
    const metas = issues.filter(function (it: any) {
      return String(it && it.state).toLowerCase() === 'open' && ((it && it.labels) || []).some(function (l: any) { return l && l.name === 'wayfinder:map' })
    })
    for (let i = 0; i < metas.length; i++) {
      const m: any = metas[i]
      const num = numOf(m.key)
      const got = await readOne(session, opCtx, 'listSubIssues', [repoRef, String(num), undefined])
      if (!got.ok) {
        // 迁移前 GraphQL 单个别名拿不到详情时就是这一格降级形状（tickets 空、stats 全零），照旧。
        maps.push({ number: num, title: m.title, state: 'OPEN', error: got.error, tickets: [], stats: { total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0 } })
        continue
      }
      const items = (got.data && got.data.items) || []
      const blocks = blocksOf(items)
      const tickets = items.map(function (it: any) { return mapTicket(subRaw(it, blocks)) })
      const bp = parseMapBody(m.body)
      // v1.4（T1 #442）：每张票挂 level（DAG 最长路径深度），client 渲染漏斗分层直接取。
      const lv = computeLevels(tickets)
      tickets.forEach(function (t: any) { t.level = lv.byNumber[t.number] })
      maps.push({
        number: num, title: m.title, state: upper(m.state), url: m.url,
        labels: (m.labels || []).map(function (l: any) { return l.name }),
        destination: bp.destination, notes: bp.notes, decisions: bp.decisions, fog: bp.fog, outOfScope: bp.outOfScope,
        tickets: tickets, stats: groupTickets(tickets),
      })
    }
    return maps
  }

  /** 仓库根：取不到时退回工作区目录（迁移前这里会抛，但快照不该因为一个展示字段整份失败）。 */
  async function repoRootOf(cwd: string): Promise<string> {
    try { return await getRepoRoot(cwd) } catch (e) { return String(cwd || '') }
  }

  async function buildSnapshot(cwd: string, hintBackendId: unknown) {
    const repo = await getRepoKey(cwd).catch(function () { return null })
    const picked = await pickBackend(cwd, repo)
    const selection = picked.selection
    const repository = picked.repository
    const backendModules = await backendModulesOf()
    const repoRoot = await repoRootOf(cwd)
    const envelope: any = {
      ok: true, repo: repo, repoRoot: repoRoot, generatedMs: Date.now(),
      env: { ghPath: getGhPath(), ghError: getGhLastError() },
      maps: [], issues: [], labels: [], fallback: null, fallbackAt: null,
      repository: repository, backendModules: backendModules, selection: selection,
      capabilities: null, viewer: null, viewerLogin: null,
    }
    // 显式空选择／没选后端：面板要靠这份空信封渲染引导页（文档约定，迁移前同口径）。
    if (!selection || !selection.backendId) return Object.assign(envelope, { updatedAt: new Date().toISOString() })

    // 已有选择结论才传 resolveSelection：让会话沿用同一份裁决，不二次探测。
    const opened = await openRead(cwd, function () { return Promise.resolve(selection) })
    if (!opened.ok) return { ok: false, error: opened.error }
    const reads = await runRead(opened.opened, async function (session: any, opCtx: any) {
      // list 的第二个参数是筛选：不筛就是 undefined，别把 opCtx 顶到那个位置上。
      const list = await readOne(session, opCtx, 'list', [repository, undefined])
      if (!list.ok) return list
      // 拉取请求不是票：迁移前 fetchIssues 的 select(.pull_request == null) 同口径，剔掉后再按更新时间倒序。
      // 排序先做在契约票上，列表行与地图都照这个顺序走（迁移前 mapsMeta 也是从排好序的那份列表里筛的）。
      const issues = (list.data || []).filter(function (it: any) { return !it || it.isPullRequest !== true })
      issues.sort(function (a: any, b: any) { return String(b && b.updatedAt).localeCompare(String(a && a.updatedAt)) })
      const rows = issues.map(listRow)
      // 标签与本人都是次信息：取不到就退回 [] 与 null，不拖垮整份快照（迁移前 gh label list 失败同口径）。
      const labelsGot = await readOne(session, opCtx, 'listLabels', [repository])
      const labels = (labelsGot.ok && Array.isArray(labelsGot.data))
        ? labelsGot.data.map(function (l: any) { return { name: l.name, color: l.color || '' } })
        : []
      let viewer = null, viewerLogin = null
      const userGot = await readOne(session, opCtx, 'getCurrentUser', [repository])
      if (userGot.ok && userGot.data && userGot.data.login) {
        viewer = userGot.data
        viewerLogin = String(userGot.data.login).trim()
      }
      const maps = await mapsOf(issues, repository, session, opCtx)
      return { ok: true, rows: rows, labels: labels, maps: maps, viewer: viewer, viewerLogin: viewerLogin }
    })
    if (!reads.ok) return { ok: false, error: reads.error }
    const got = reads.data
    if (!got || got.ok !== true) return { ok: false, error: got ? got.error : oldError(null, 'network') }
    return Object.assign(envelope, {
      updatedAt: new Date().toISOString(),
      maps: got.maps, issues: got.rows, labels: got.labels,
      capabilities: capCount(got.rows), viewer: got.viewer, viewerLogin: got.viewerLogin,
    })
  }

  return { buildSnapshot }
}