/**
 * refresh-core/src/chain.ts —— 会话↔票 处理链（纯逻辑）
 *
 * 这张链回答一个问题：**每个会话正在处理哪些票**。界面怎么画是另一张票（#721），这里只定数据侧：
 * 一条记录长什么样、键怎么拼、同一个会话留几张、哪些调用算「在处理」、落盘时哪些字必须被挡在外面。
 *
 * 为什么这些事必须住在纯函数里（票面 #714 硬要求）：留存的条数错了、去重的口径错了、判读写的线画错了，
 * 都不会当场崩，而是**静默地把界面变成谎话**——链上显示十张其实没在处理的票（第十三章点名要避免的
 * 「链被噪音灌满」），或者把两个会话的票混成一条（同根多会话互相覆盖）。这两件事只有把规则穷举测一遍
 * 才看得出来，所以本文件没有一行读盘、联网、看时钟、取环境变量的代码：时间由调用方传进来。
 *
 * 三条纪律，逐条落在下面的实现里：
 *   1. **键要带会话 id**：键 =（工作区根散列，后端，票 key）再显式带上会话 id。只按根分桶会在
 *      「同一个仓库开着两个会话」时互相覆盖（票面硬要求里点名的失败现场）。
 *   2. **只记写与明确的处理动作**：读不进链。判据不是「有没有票号」，而是「这次动作是不是写」
 *      —— 所以本文件的入口收的是判定表（write-detect.ts）给的那一档，读工具、只读子命令、
 *      没成功的调用一律不记（第十三章那张表里「处理链把看了一眼也记成在处理」的处置）。
 *   3. **落盘只存散列与票键**：会话 id 只以散列形态出现，工作区根只以短指纹出现；命令原文、
 *      路径原文、令牌一个字符都不许进链（隐私红线，与仓库日志纪律同口径）。落盘前用
 *      chainPrivacyViolations 自检一遍，宁可这一次不落盘，也不许把原文写出去。
 *
 * 事件形态、判定表、三个来源的取数方式都写在票 #714 与定稿第十二章；本文件只做「拿到判定之后怎么记」。
 * 取数（订阅会话事件、读回会话、真正落盘）留在 src/host/refresh/sessionTickets.js。
 */

// 这里原来有一行 `export const CHAIN_SOURCE = 'refresh-core/src/chain.ts'`。#719 把它删掉：
// 全仓没有任何代码读它，而产物第一行的 AUTO-GENERATED 包头（由 refresh-core/build.mjs 按真实文件名
// 生成）已经把「这份 JS 从哪来」写清楚了——手写一份同样的字符串只可能漂移。
// 空壳产物（refresh-core/src/ports.ts）不一样：它的产物里只剩那一行标识，所以 PORTS_SOURCE 留着。

/** 每个会话留最近多少张（票面硬要求：20 张，去重、按时间倒序，超过就丢最旧的）。 */
export const CHAIN_SESSION_CAP = 20

/** 三个后端的字面（判据里要按后端分开：不同后端的票 key 不通用）。 */
export const CHAIN_BACKENDS: readonly string[] = ['github', 'gitlab', 'markdown']

/**
 * 动作类别（闭集合）。只回答「他在对这张票做什么」，一格一个词，不许出现自由文本
 * —— 类别会落盘、会显示，一旦混进命令原文或票标题，链就成了隐私泄漏面。
 */
export const CHAIN_ACTIONS: readonly string[] = ['create', 'plan', 'comment', 'edit', 'state', 'link', 'file-write', 'other-write']

/** 原因代号表：左边是代号（会被写进日志），右边是给第一次读的人看的一整句大白话。 */
export const CHAIN_REASONS: Readonly<Record<string, string>> = {
  'chain.record': '这是一次写（或明确的处理动作），且说的是哪一张票：记进链',
  'chain.read-excluded': '这是一次读（顺手看一眼）：不进链，链上只留写与明确的处理动作',
  'chain.no-ticket': '这次动作是写，但说不出是哪一张票：不记（记了也没法在界面上点名是哪张）',
  'chain.not-succeeded': '这次调用没有成功：什么都没改，不记',
  'chain.not-a-result': '这不是一次调用的结果（调用刚开始或认不出的形态）：不记',
  'chain.unknown-source': '说不清这条线索是从哪来的（不是工具参数、命令行或票文件路径）：不记',
  'chain.bad-shard': '这个会话的散列算不出来（会话 id 是空的）：不记，免得把不同会话的票记进同一格',
  'chain.bad-root': '工作区根散列不像散列（长度或字符不对）：不记，宁可漏一次也不把原文写进键里',
  'chain.bad-backend': '后端名不在三个后端里：不记，不同后端的票 key 不通用',
}

/** 一句话解释一个原因代号；认不出就原样退回。 */
export function chainReasonText(code: string): string {
  const key = String(code || '')
  return Object.prototype.hasOwnProperty.call(CHAIN_REASONS, key) ? CHAIN_REASONS[key] : key
}

// ─────────────────────────────────────────────────────────────────────────────
// 一、散列：根与会话都只以短指纹进链
// ─────────────────────────────────────────────────────────────────────────────

/** 32 位累加器一：djb2，与 src/host/workspaceKey.js 的 hash8 同一个算法（同一个根算出来的前 8 位与日志里一致）。 */
function hashDjb2(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (((h << 5) + h + text.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

/** 32 位累加器二：FNV-1a。两路拼起来 16 位十六进制，用来把「两个不同的根撞成同一条链」的概率压下去。 */
function hashFnv(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return ('0000000' + h.toString(16)).slice(-8)
}

/**
 * 工作区根的短指纹：16 位十六进制，前 8 位与日志里的 rootHash（H_CWD 那套短散列）逐字相同。
 * 为什么是 16 位而不是 8 位：链键要拿它当分桶，两个不同的根撞进同一格是静默串台；多跑一路累加不要钱。
 *
 * 输入必须已经是归一化过的根（大小写、尾斜杠、联接点都由 src/host/workspaceKey.js 按 canonicalKey
 * 的口径处理好了）——本文件不碰文件系统，也没有平台的路径概念。
 */
export function chainRootHash(rootKey: unknown): string {
  const text = rootKey === null || rootKey === undefined ? '' : String(rootKey)
  if (!text) return ''
  return hashDjb2(text) + hashFnv(text)
}

/** 会话分格的标识：同一个会话每次算出来都一样，换个会话就不同；原始会话 id 不落盘，只留这个。 */
export function chainSessionShardId(sessionId: unknown): string {
  const text = sessionId === null || sessionId === undefined ? '' : String(sessionId).trim()
  if (!text) return ''
  return hashDjb2(text) + hashFnv(text)
}

/** 16 位十六进制的短指纹长这样（根指纹与会话分格都用这个形状）。 */
function isFingerprintLike(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v)
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、键与票号
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 后端名归一：小写、去空白，只认三个后端。
 * 为什么认不出就不记：票 key 不跨后端通用（github 是数字串、markdown 是编号、gitlab 是 iid），
 * 把后端名写成别的字面就会让同一个键在两张表里指两张不同的票。
 */
export function chainBackendId(raw: unknown): string {
  const text = raw === null || raw === undefined ? '' : String(raw).trim().toLowerCase()
  return CHAIN_BACKENDS.indexOf(text) >= 0 ? text : ''
}

/**
 * 票 key 归一：`12`、`#12`、`0012` 都收成 `12`（去掉井号与前导零）。
 * markdown 后端的票文件名是 `0012-标题.md`，github 的票号是 `12` —— 它们在后端不同时不会撞，
 * 但同一个后端里两种写法必须收成同一个键，否则同一张票会在链上出现两次。
 */
export function chainTicketKey(raw: unknown): string {
  if (typeof raw === 'number' && isFinite(raw)) raw = String(Math.floor(raw))
  if (typeof raw !== 'string') return ''
  const text = raw.trim().replace(/^#/, '')
  if (!/^\d{1,10}$/.test(text)) return ''
  const noZeros = text.replace(/^0+(?=\d)/, '')
  return noZeros
}

/**
 * 从票文件路径里解析编号（markdown 后端那条来源：AI 直接读写票文件时，编号在文件名里）。
 * 认两处：文件名开头的编号（`0012-标题.md`、`0012.md`），以及路径里 `issues/0012-...` 那一段。
 * 路径原文只在这一层做瞬时匹配，返回的只有编号。
 */
export function chainTicketKeyFromPath(path: unknown): string {
  const text = path === null || path === undefined ? '' : String(path).replace(/\\/g, '/')
  if (!text) return ''
  const base = text.slice(text.lastIndexOf('/') + 1)
  const direct = /^(\d{1,10})(?:[-._][^/]*)?\.(?:md|markdown)$/i.exec(base)
  if (direct) return chainTicketKey(direct[1])
  const inDir = /(?:^|\/)(?:issues?|tickets?)\/(\d{1,10})(?:[-._/]|$)/i.exec(text)
  return inDir ? chainTicketKey(inDir[1]) : ''
}

/** 票文件路径长什么样（本文件只用它来判断「这条线索是不是 path 那条来源」）。 */
export function looksLikeTicketFilePath(path: unknown): boolean {
  return chainTicketKeyFromPath(path) !== ''
}

/**
 * 链上一条记录的键 =（工作区根散列，后端，票键，会话分格）。
 * 四段都在键里，缺一段就返回空串（调用方据此不记）：少一段就等于把两张不相干的票当成同一张。
 */
export function chainEntryKey(input: {
  rootHash?: unknown
  backend?: unknown
  ticketKey?: unknown
  shardId?: unknown
}): string {
  const rootHash = input ? input.rootHash : ''
  const backend = chainBackendId(input ? input.backend : '')
  const ticketKey = chainTicketKey(input ? input.ticketKey : '')
  const shardId = input ? input.shardId : ''
  if (!isFingerprintLike(rootHash) || !backend || !ticketKey || !isFingerprintLike(shardId)) return ''
  return 'r:' + rootHash + '|b:' + backend + '|t:' + ticketKey + '|s:' + shardId
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、只记写不记读：这次动作算不算「在处理」
// ─────────────────────────────────────────────────────────────────────────────

/** 三个来源（票面硬要求）。 */
export type ChainSource = 'tool-args' | 'cli' | 'markdown-file'

/** 我们自己的写工具（#713 的七个薄壳里会改远端的那四个）。 */
const DECK_WRITE_ACTIONS: Readonly<Record<string, string>> = {
  deck_issue_create: 'create', deck_issue_patch: 'edit', deck_map_plan_create: 'plan', deck_map_link: 'link',
}
/** 我们自己的读工具（另三个只看不写）——命中就明确不记。 */
const DECK_READ_TOOLS: readonly string[] = ['deck_context', 'deck_issue_get', 'deck_map_snapshot']
/** 会写文件的工具（markdown 后端那条来源要靠它区分「在写票文件」还是「在看票文件」）。 */
const FILE_WRITE_TOOLS: readonly string[] = ['write', 'edit', 'multiedit', 'multi_edit', 'apply_patch', 'create_file', 'notebookedit', 'notebook_edit', 'str_replace_editor']
/** 只看文件的工具：命中就明确不记（顺手看一眼）。 */
const FILE_READ_TOOLS: readonly string[] = ['read', 'readfile', 'read_file', 'grep', 'glob', 'search', 'ls', 'list', 'listfiles', 'list_files']

/** 子命令词（或我们工具的具名动作）→ 动作类别。表里没有的写动词归 other-write，绝不猜。 */
const VERB_ACTIONS: Readonly<Record<string, string>> = {
  create: 'create', comment: 'comment', note: 'comment', edit: 'edit', update: 'edit', rename: 'edit',
  close: 'state', reopen: 'state', link: 'link', plan: 'plan',
}

/** 判定表里「这次是写」的那一档（write-detect.ts 的 DetectTier 字面，只抄字面不抄规则）。 */
const WRITE_TIER = 'write-confirmed'

export interface ChainDecisionInput {
  /** 这条线索是从哪来的：工具参数最准，其次是命令行，markdown 后端从票文件路径来。 */
  source: ChainSource | string
  /** 工具名（我们自己的工具用得上；Windows 上执行命令的那个叫 `pwsh`）。 */
  tool?: string
  /** 判定表给的档位（write-detect.ts 的 tier）。没给就按「认不出」处理，不记。 */
  tier?: string | null
  /** 判定表给的原因代号（DETECT_REASONS 的键）。 */
  reason?: string | null
  /** 已经认出来的票键（有就直接用；没有就由本函数再试参数与路径）。 */
  ticketKey?: string | null
  /** markdown 那条来源的票文件路径原文：只在这一层瞬时匹配，不进返回值。 */
  path?: string | null
  /** 我们工具的具名参数（可能装着票键）。 */
  args?: Record<string, unknown> | null
  /** 更细的动词（例如 `close`）：命令行那条来源由调用方解析好传进来。 */
  verb?: string | null
}

export interface ChainDecision {
  /** 记不记进链。 */
  record: boolean
  /** 记的话是哪一类动作；不记时是空串。 */
  action: string
  /** 记的话是哪一张票（归一后的键）；不记时是空串。 */
  ticketKey: string
  /** 为什么记 / 为什么不记（代号，见 CHAIN_REASONS）。 */
  reason: string
}

/** 我们工具的具名参数里，可能装着票键的字段名（按顺序取第一个像票号的）。 */
const TICKET_ARG_FIELDS: readonly string[] = ['issue', 'number', 'ticket', 'key', 'id', 'child', 'parent']

function ticketFromArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const bag = args as Record<string, unknown>
  for (const field of TICKET_ARG_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(bag, field)) continue
    const t = chainTicketKey(bag[field])
    if (t) return t
  }
  return ''
}

function no(reason: string): ChainDecision {
  return { record: false, action: '', ticketKey: '', reason: reason }
}

function yes(action: string, ticketKey: string): ChainDecision {
  return { record: true, action: CHAIN_ACTIONS.indexOf(action) >= 0 ? action : 'other-write', ticketKey: ticketKey, reason: 'chain.record' }
}

/**
 * 这次动作要不要记进链（本文件里唯一的判定，三处调用方共用，不许各自实现一遍）。
 *
 * 判据按顺序四条，任何一条不成立就不记 —— 不记的四种理由各自有代号，写进日志能直接回答
 * 「为什么界面上没有这张票」：
 *   1. 来源说不清 → 不记（不是工具参数、命令行、票文件路径三者的任何一条）。
 *   2. 不是写 → 不记。这是「只记写与明确的处理动作」那条纪律的落点：读工具、只看文件的工具、
 *      只读子命令、没成功的调用、认不出的形态，全都不进链。为什么不把「认不出」按可疑记进去：
 *      链的用途是「说清在处理哪些票」，可疑项说不出票号也说不清动作，记进去只会让界面显示假任务。
 *   3. 说不出是哪一张票 → 不记（链上的每一条都要能在界面上点名，点名不出来的不记）。
 *   4. 后端名不在三个后端里 → 不记（不同后端的票 key 不通用）。
 *
 * markdown 那条来源放宽一处：`write`/`edit` 这类写文件的工具改票文件时，判定表给的是
 * 「已知只读的本地工具」（它只看工具名，不知道那个路径就是一张票的正文），所以这一条来源
 * 的写证据取自工具名本身；反过来 `read`/`grep` 看票文件照样不记。
 */
export function chainVerdictOf(input: ChainDecisionInput | null | undefined): ChainDecision {
  if (!input || typeof input !== 'object') return no('chain.unknown-source')
  const source = String(input.source || '')
  if (source !== 'tool-args' && source !== 'cli' && source !== 'markdown-file') return no('chain.unknown-source')
  const tool = String(input.tool || '')
  const toolKey = tool.toLowerCase()
  const tier = String(input.tier == null ? '' : input.tier)
  const reason = String(input.reason || '')

  // 二、是不是写：先看明确只读的，再看明确写工具的，最后看判定表那一档。
  if (DECK_READ_TOOLS.indexOf(tool) >= 0 || DECK_READ_TOOLS.indexOf(toolKey) >= 0) return no('chain.read-excluded')
  if (FILE_READ_TOOLS.indexOf(toolKey) >= 0 && source === 'markdown-file') return no('chain.read-excluded')
  if (reason === 'tool.deck-read' || reason === 'tool.local-read' || reason === 'cmd.gh-read' || reason === 'cmd.glab-read' || reason === 'cmd.gh-help') {
    return no('chain.read-excluded')
  }
  if (reason === 'not-succeeded') return no('chain.not-succeeded')
  if (reason === 'shape.not-a-result') return no('chain.not-a-result')

  // 写证据分三条来源各取一次；取不到就是不记。
  const fromFile = chainTicketKeyFromPath(input.path)
  const isFileWriter = FILE_WRITE_TOOLS.indexOf(toolKey) >= 0
  const isDeckWriter = Object.prototype.hasOwnProperty.call(DECK_WRITE_ACTIONS, tool)
  let wrote = false
  let action = ''
  if (source === 'markdown-file') {
    if (!isFileWriter && !isDeckWriter) return no('chain.read-excluded')
    wrote = true
    action = 'file-write'
  } else if (source === 'tool-args') {
    if (!isDeckWriter && tier !== WRITE_TIER) return no('chain.read-excluded')
    wrote = true
    action = isDeckWriter ? DECK_WRITE_ACTIONS[tool] : 'other-write'
  } else {
    // 命令行那条来源：写了票文件的形状（重定向、Set-Content 这些）也算写，票号从路径里取。
    if (reason === 'cmd.file-write' && fromFile) {
      wrote = true
      action = 'file-write'
    } else if (tier === WRITE_TIER) {
      wrote = true
      const verb = String(input.verb || '').toLowerCase().replace(/^--?/, '')
      action = Object.prototype.hasOwnProperty.call(VERB_ACTIONS, verb) ? VERB_ACTIONS[verb] : 'other-write'
    } else {
      return no('chain.read-excluded')
    }
  }
  if (!wrote) return no('chain.read-excluded')

  // 三、说的是哪一张票：参数与路径都试，都没有就不记。
  const ticketKey = chainTicketKey(input.ticketKey) || ticketFromArgs(input.args) || fromFile
  if (!ticketKey) return no('chain.no-ticket')
  return yes(action, ticketKey)
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、链路状态：按会话分格、去重、留最近 20 张
// ─────────────────────────────────────────────────────────────────────────────

/** 链上的一条：票键、时间、动作类别 —— 就这三个字段（落盘也只会写这三个）。 */
export interface ChainEntry {
  ticketKey: string
  /** 这次写动作发生的时间（毫秒）。时间由调用方传进来，本文件不看时钟。 */
  at: number
  action: string
}

/** 一个会话的一格链。会话 id 原文只留在内存里；落盘时只写它的散列。 */
export interface ChainShard {
  shardId: string
  /** 会话 id 原文：只在内存里，落盘时会被挡掉（隐私红线）。 */
  sessionId: string
  rootHash: string
  backend: string
  /** 时间倒序、键唯一、最多 CHAIN_SESSION_CAP 条。 */
  entries: ChainEntry[]
}

export interface ChainState {
  shards: Record<string, ChainShard>
}

export function createChainState(): ChainState {
  return { shards: {} }
}

/**
 * 往一格链里合并一条记录（纯函数：返回新的状态，不改传进来的那一份）。
 *
 * 三条规则：
 *   - **按会话分格**：键是会话分格散列，所以同一个仓库的两个会话各有一条链，谁也不会盖掉谁。
 *   - **格内去重**：同一张票再写一次不新增一条，而是把那一条挪到最前、刷新时间与动作类别
 *     ——「最近处理过」看的是最后一次动作。
 *   - **留最近 20 张**：超过就把最旧的丢掉（票面硬要求），丢的是整条记录，不是只丢时间。
 */
export function chainRecord(state: ChainState, input: {
  sessionId?: unknown
  rootHash?: unknown
  backend?: unknown
  ticketKey?: unknown
  action?: unknown
  at?: unknown
}): { state: ChainState; recorded: boolean; shardId: string; reason: string } {
  const shardId = chainSessionShardId(input ? input.sessionId : '')
  if (!shardId) return { state: state, recorded: false, shardId: '', reason: 'chain.bad-shard' }
  if (!isFingerprintLike(input ? input.rootHash : '')) return { state: state, recorded: false, shardId: shardId, reason: 'chain.bad-root' }
  const backend = chainBackendId(input ? input.backend : '')
  if (!backend) return { state: state, recorded: false, shardId: shardId, reason: 'chain.bad-backend' }
  const ticketKey = chainTicketKey(input ? input.ticketKey : '')
  if (!ticketKey) return { state: state, recorded: false, shardId: shardId, reason: 'chain.no-ticket' }
  const rawAction = String(input && input.action ? input.action : '')
  const action = CHAIN_ACTIONS.indexOf(rawAction) >= 0 ? rawAction : 'other-write'
  const at = typeof input.at === 'number' && isFinite(input.at) ? input.at : 0

  const src = state && state.shards ? state.shards : {}
  const key = chainEntryKey({ rootHash: input.rootHash, backend: backend, ticketKey: ticketKey, shardId: shardId })
  if (!key) return { state: state, recorded: false, shardId: shardId, reason: 'chain.bad-root' }
  const before = src[shardId]
  const entries = mergeEntries(before ? before.entries : [], { ticketKey: ticketKey, at: at, action: action })
  const shard: ChainShard = {
    shardId: shardId,
    sessionId: String(input.sessionId == null ? '' : input.sessionId).trim(),
    rootHash: String(input.rootHash),
    backend: backend,
    entries: entries,
  }
  const shards: Record<string, ChainShard> = {}
  for (const k of Object.keys(src)) shards[k] = src[k]
  shards[shardId] = shard
  return { state: { shards: shards }, recorded: true, shardId: shardId, reason: 'chain.record' }
}

/** 去重 + 时间倒序 + 留最近 20 条（链上留存的唯一算法，合并与恢复都走它）。 */
export function mergeEntries(entries: ChainEntry[], incoming: ChainEntry): ChainEntry[] {
  const out: ChainEntry[] = []
  const seen: Record<string, boolean> = {}
  const push = (e: ChainEntry) => {
    const key = chainTicketKey(e ? e.ticketKey : '')
    if (!key || seen[key]) return
    seen[key] = true
    out.push({ ticketKey: key, at: typeof e.at === 'number' && isFinite(e.at) ? e.at : 0, action: CHAIN_ACTIONS.indexOf(String(e.action)) >= 0 ? String(e.action) : 'other-write' })
  }
  if (incoming) push(incoming)
  const list = Array.isArray(entries) ? entries : []
  for (const e of list) push(e)
  out.sort((a, b) => b.at - a.at)
  return out.slice(0, CHAIN_SESSION_CAP)
}

/** 某个会话的那一格链（没有就是空数组）。界面要用时按它取，别自己去翻 shards。 */
export function chainEntriesOf(state: ChainState | null | undefined, sessionId: unknown): ChainEntry[] {
  const shardId = chainSessionShardId(sessionId)
  const shard = shardId && state && state.shards ? state.shards[shardId] : null
  if (!shard || !Array.isArray(shard.entries)) return []
  return shard.entries.map((e) => ({ ticketKey: e.ticketKey, at: e.at, action: e.action }))
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、落盘与恢复：只存散列、票键、时间、动作类别
// ─────────────────────────────────────────────────────────────────────────────

/** 落盘格式的版本号。改了形状就加一，读端认不出就整份丢掉（宁可空着，不许读半份）。 */
export const CHAIN_DISK_VERSION = 1

/**
 * 这一份要落盘的东西里，有没有不该出去的字。返回每一条现场的一句话（空数组 = 干净）。
 *
 * 为什么要有这个自检：链的入口收的是事件参数，里面有命令原文、别的会话的路径、客户数据
 * （docs/reviews/deck-tools-adversarial-review.md 记着这件事）。形状检查（只认散列与数字键）
 * 是第一道，这里是第二道：落盘之前把整份结构逐个字符串看一遍，见到路径或命令的形状就判不干净。
 */
export function chainPrivacyViolations(value: unknown): string[] {
  const out: string[] = []
  const walk = (v: unknown, at: string) => {
    if (typeof v === 'string') {
      if (/[A-Za-z]:[\\/]|(^|[\s"'])~[\\/]|\.{1,2}[\\/]|\\\\[^\\]/.test(v)) out.push(at + '：像路径原文')
      else if (/\s/.test(v) || /(^|\s)(gh|glab|git|pwsh|bash|node|Set-Content|Out-File)(\s|$)/.test(v)) out.push(at + '：像命令原文')
      return
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, at + '[' + i + ']')); return }
    if (v && typeof v === 'object') { for (const k of Object.keys(v as Record<string, unknown>)) walk((v as Record<string, unknown>)[k], at + '.' + k) }
  }
  walk(value, '$')
  return out
}

/** 落盘的那份形状：只有散列、票键、时间、动作类别。会话 id 原文与路径原文都不在里面。 */
export function chainToDisk(state: ChainState, opts?: { at?: number }): { v: number; at: number; shards: Array<Record<string, unknown>> } {
  const shards: Array<Record<string, unknown>> = []
  const src = state && state.shards ? state.shards : {}
  for (const k of Object.keys(src)) {
    const shard = src[k]
    if (!shard || !isFingerprintLike(shard.shardId) || !isFingerprintLike(shard.rootHash) || !chainBackendId(shard.backend)) continue
    const entries: Array<[string, number, string]> = []
    for (const e of Array.isArray(shard.entries) ? shard.entries : []) {
      const key = chainTicketKey(e ? e.ticketKey : '')
      if (!key) continue
      const action = String(e.action || '')
      entries.push([key, typeof e.at === 'number' && isFinite(e.at) ? Math.floor(e.at) : 0, CHAIN_ACTIONS.indexOf(action) >= 0 ? action : 'other-write'])
    }
    if (entries.length === 0) continue
    shards.push({ s: shard.shardId, r: shard.rootHash, b: shard.backend, e: entries.slice(0, CHAIN_SESSION_CAP) })
  }
  return { v: CHAIN_DISK_VERSION, at: opts && typeof opts.at === 'number' && isFinite(opts.at) ? Math.floor(opts.at) : 0, shards: shards }
}

/**
 * 从落盘的那份读回状态（重启后恢复用）。
 *
 * 读端比写端严格：版本不对、某一格形状不对、某一条长得不像票键，一律丢掉那一份/那一格/那一条，
 * 绝不「尽力而为」地收下 —— 链是一份可以重建的缓存，读回半份比空着更坏（会显示不存在的处理动作）。
 * 恢复出来的格子里 `sessionId` 是空的（原文本来就没落盘），调用方拿的是散列；要按会话取用
 * chainEntriesOf(state, 会话 id) —— 散列算法一致，取得到。
 */
export function chainFromDisk(payload: unknown): { state: ChainState; shards: number; entries: number; dropped: number; reason: string } {
  const state = createChainState()
  const raw = payload as { v?: unknown; shards?: unknown } | null
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.shards)) return { state: state, shards: 0, entries: 0, dropped: 0, reason: 'chain.disk-shape' }
  if (Number(raw.v) !== CHAIN_DISK_VERSION) return { state: state, shards: 0, entries: 0, dropped: 0, reason: 'chain.disk-version' }
  let kept = 0
  let entries = 0
  let dropped = 0
  for (const s of raw.shards as Array<Record<string, unknown>>) {
    if (!s || typeof s !== 'object' || !isFingerprintLike(s.s) || !isFingerprintLike(s.r) || !chainBackendId(s.b) || !Array.isArray(s.e)) { dropped += 1; continue }
    let acc: ChainEntry[] = []
    for (const row of s.e as unknown[]) {
      const arr = Array.isArray(row) ? row : []
      const key = chainTicketKey(arr[0])
      const action = String(arr[2] || '')
      if (!key || CHAIN_ACTIONS.indexOf(action) < 0) { dropped += 1; continue }
      const at = typeof arr[1] === 'number' && isFinite(arr[1]) ? Math.floor(arr[1]) : 0
      acc = mergeEntries(acc, { ticketKey: key, at: at, action: action })
    }
    if (acc.length === 0) { dropped += 1; continue }
    state.shards[String(s.s)] = { shardId: String(s.s), sessionId: '', rootHash: String(s.r), backend: chainBackendId(s.b), entries: acc }
    kept += 1
    entries += acc.length
  }
  return { state: state, shards: kept, entries: entries, dropped: dropped, reason: kept > 0 ? 'chain.disk-ok' : 'chain.disk-empty' }
}
