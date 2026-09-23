/**
 * refresh-core/src/delta.ts —— 行级增量刷新的纯逻辑：差分、合并、水印、世代号、派生值
 *
 * 这个文件只回答四个问题，四个都是纯计算，不读盘、不联网、不看时钟（时间由调用方传进来）：
 *   ① 这一次探测回来的变化里，哪些票是「行级补一下」，哪些情况只能整池重建；
 *   ② 把变化真正并进列表之后，水印该不该前进（没并进去就不许前进）；
 *   ③ 这一份回来的结果还算不算数（迟到的整池结果不许覆盖更新的增量结果）；
 *   ④ 并完之后哪些派生值该重算、哪些只能保持旧值并标「待确认」。
 *
 * 依据：定稿第十一章「行级增量刷新：只补变的那几条」（docs/architecture/refresh-budget-architecture.html）。
 * 三条纪律原文照搬，不给解释留余地：
 *   · 行级补丁必须产出新的版本号（否则「内容没变」那条 304 捷径会把新数据当成旧的丢掉）→ nextVersion；
 *   · 派生值必须跟着重算或明确标成「待确认」→ derivedAfter；其中 deck.counts 是整仓口径，
 *     增量路径**不许本地重算**，只许保持旧值并把 deck.partial 置真（这是票面点名的红线）；
 *   · 删票只能靠对账 —— 增量算式只增不减，所以「票号少了」在增量链路上永远观察不到，
 *     一旦发现票号有增减就必须整池（planDelta 的 added / removed）。
 * 水印那一条同样来自定稿第十一章：现在实现里是探测一回来就无条件推进水印，一旦这一笔取数被推迟或丢弃，
 * 那条变化就再也发现不了了；本文件把「能不能推进」变成一条可以单独测的判定（watermarkAfter）。
 *
 * 形状照 refresh-core 前四份（ports / budget / idempotency / policy）：产物落
 * src/shared/refresh/delta.js，逐字由 refresh-core/build.mjs 生成。本文件不 import 任何其他产物 ——
 * src/shared/ 同层互引会被 tests/verify-no-same-layer-import.js 判红，需要用的东西一律由调用方传进来。
 */

// 这里原来有一行 `export const DELTA_SOURCE = 'refresh-core/src/delta.ts'`。#719 把它删掉：
// 全仓没有任何代码读它，而产物第一行的 AUTO-GENERATED 包头（由 refresh-core/build.mjs 按真实文件名
// 生成）已经把「这份 JS 从哪来」写清楚了——手写一份同样的字符串只可能漂移。
// 空壳产物（refresh-core/src/ports.ts）不一样：它的产物里只剩那一行标识，所以 PORTS_SOURCE 留着。

// ---------- 一、索引与差分的形状 ----------

/**
 * 索引里一条票的样子：`'状态|更新时间'` 这样一根字符串（例如 `'OPEN|2026-09-23T01:02:03Z'`）。
 * 口径与 src/shared/tracker/indexWindow.js 完全一致 —— 那边负责「窗口取回来的增量怎么并进基线」，
 * 本文件负责「并完之后的完整索引跟列表手上那份差在哪几条」，两边用的是同一根字符串。
 */
export type IndexEntry = string

/** 编号 → `'状态|更新时间'`。键是字符串形态的票号（各后端统一）。 */
export type IssueIndex = Record<string, IndexEntry>

/**
 * 一次增量最多补几行。超过这个数就整池，不再一条一请求地补过去。
 *
 * 为什么是这个数：一条薄查询 = 1 条出站请求、1~2 点（budget.ts 的 PATCH_COST_REQUESTS 与
 * PATCH_COST_POINTS_MIN / MAX）；一次整池 = 7 条请求、13 点（REBUILD_COST_*）。
 * 6 行顶多 12 点，还在整池的价钱以下；再多就不划算了，而且「一次变化这么多行」本身
 * 说明这不是日常的关一张票、改一个标签，整池拿回来的东西还更全（计数、层级、阻塞边都在）。
 */
export const PATCH_MAX_ROWS = 6

/** 这次该走哪条路。三选一，没有第四种。 */
export type DeltaMode =
  | 'nothing' // 探测回来与列表手上那份一模一样：什么都不用做
  | 'patch' // 只有既有票的内容变了：只取这几条薄的（1~2 点）
  | 'rebuild' // 整池（冷启动、票号增减、读到的旧结构）——这是增量看不见的那几件事

/** 走这条路的原因代号。写进日志与界面，取值只许加、不许改字面。 */
export type DeltaReason =
  | 'no-baseline' // 手上没有可比对的基线（第一次打开这个仓库）
  | 'ticket-set-changed' // 出现了没见过的号，或有号不见了（含删票）
  | 'rows-changed' // 只有既有票的内容变了
  | 'nothing-changed' // 一模一样

/** 一次差分的全部结论。merged 是「并入之后的完整索引」，与 handed-out 的列表该有的状态对齐。 */
export interface DeltaPlan {
  mode: DeltaMode
  reason: DeltaReason
  /** 并入之后的完整索引（新对象，不改动入参）。整池那两种情形下也照样给出来，调用方只在 patch 时用它。 */
  merged: IssueIndex
  /** 变了内容的票号（升序）；这些就是「只取那几条」的名单。 */
  changed: string[]
  /** 新出现的票号（升序）。有任何一条就必须整池 —— 增量看不见新增与删除。 */
  added: string[]
  /** 消失的票号（升序）。同上：删票只能靠对账，这是它唯一能被发现的地方。 */
  removed: string[]
}

/** 差分的两个开关。 */
export interface DeltaOptions {
  /**
   * 这一次回来的是一整扫（没有可用水印时的冷启动、或每 10 分钟那一趟对账），还是只含窗口内变化的增量。
   *
   * 这一位必须由调用方如实交底，因为它决定基线怎么算，而算错了会静默漏报：
   *   · 增量（false）：结果只含「窗口内变动过的票」，所以要把增量**并进**旧基线才能比；
   *   · 整扫（true）：结果本身就是完整的一份，必须**重置**基线 —— 用「并进旧基线」那套算法的话，
   *     它只增不减，删票永远观察不到（定稿第十一章「消失（删票）」）。
   */
  full?: boolean
}

function sortedKeys(o: IssueIndex | null | undefined): string[] {
  const out: string[] = []
  if (o && typeof o === 'object') for (const k of Object.keys(o)) out.push(k)
  out.sort()
  return out
}

/**
 * 行级差分的合并规则 + 该走哪条路，一次算清。
 *
 * @param baseline 列表手上那份票的索引（`indexOfSnapshot` 从快照算出来的），没有就传 null
 * @param incoming 这一次取回来的索引（增量只含窗口内变动过的票；整扫就是完整一份）
 * @param opts.full 这一次是不是整扫（见 DeltaOptions：它决定基线是「并」还是「重置」）
 *
 * 为什么把「合并」和「判该走哪条路」放在同一个函数里：这两件事用的是同一次比较的结果。
 * 分开写就得比两遍，而且两份比较口径迟早会走岔 —— 一处认为变了、另一处认为没变，
 * 于是「探测说变了、补行却按没变处理」这种最难查的静默错就出现了。
 */
export function planDelta(baseline: IssueIndex | null | undefined, incoming: IssueIndex | null | undefined, opts?: DeltaOptions): DeltaPlan {
  const before: IssueIndex = baseline && typeof baseline === 'object' ? baseline : {}
  const delta: IssueIndex = incoming && typeof incoming === 'object' ? incoming : {}
  const full = !!(opts && opts.full)

  // 合并：增量是「以基线为底、把窗口里拿到的逐条盖上去」（与 indexWindow.mergeDelta 同一条规则）；
  // 整扫是「以这一次拿回来的为准」—— 重置，不并（并起来只增不减，删票就再也看不见了）。
  const merged: IssueIndex = {}
  if (full) for (const k of Object.keys(delta)) merged[k] = delta[k]
  else {
    for (const k of Object.keys(before)) merged[k] = before[k]
    for (const k of Object.keys(delta)) merged[k] = delta[k]
  }

  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []

  // 没有基线：无从比对「哪些行变了」，第一次只能整池（定稿第十一章「什么时候仍整池」①冷启动）。
  if (!baseline || typeof baseline !== 'object') {
    return { mode: 'rebuild', reason: 'no-baseline', merged: merged, changed: changed, added: sortedKeys(merged), removed: removed }
  }

  const bk = sortedKeys(before)
  const mk = sortedKeys(merged)
  for (const k of bk) if (!(k in merged)) removed.push(k)
  for (const k of mk) {
    if (!(k in before)) added.push(k)
    else if (before[k] !== merged[k]) changed.push(k)
  }

  // 票号有增减 → 整池。新增的票不只「多一行」：地图容器的子票、阻塞边、层级都要重算，
  // 而那几样正是增量拿不到的东西；删票更是只有整池能看见。
  if (added.length > 0 || removed.length > 0) {
    return { mode: 'rebuild', reason: 'ticket-set-changed', merged: merged, changed: changed, added: added, removed: removed }
  }
  if (changed.length > 0) {
    return { mode: 'patch', reason: 'rows-changed', merged: merged, changed: changed, added: added, removed: removed }
  }
  return { mode: 'nothing', reason: 'nothing-changed', merged: merged, changed: changed, added: added, removed: removed }
}

// ---------- 二、水印推进的判定（只在变化真正并进列表之后才推进） ----------

/** 一次取数最后落在哪一档。前四种都算「没并进去」，水印一律不许前进。 */
export type FetchOutcome =
  | 'merged' // 并进列表了
  | 'deferred' // 被闸推迟（额度不够 / 不在活跃集合里）
  | 'dropped' // 进了推迟队列又过期被丢掉（丢弃只清队列，不动水印）
  | 'failed' // 取数或合并出错
  | 'not-need' // 探测回来说没变化，压根没有取数

/** 水印判定的一条输入。水印本身由调用方持有（每个工作区一份）。 */
export interface WatermarkInput {
  /** 上一次并进列表之后记下的水印；从没有过传 0。 */
  previousMs: number
  /** 本次扫描发起的时刻（不是结束时刻 —— 取发起时刻让下一轮窗口与这一轮重叠，宁可重叠不可漏）。 */
  scanStartedMs: number
  /** 这一次取数的最终去向。 */
  outcome: FetchOutcome
}

/** 水印判定的一条结论。 */
export interface WatermarkVerdict {
  /** 该记下的水印值。没并进去时就是原值（不许前进，也不许后退）。 */
  watermarkMs: number
  /** 这一次水印前进了没有。 */
  advanced: boolean
  /** 要不要把这些变化记进持久化待办（没并进去、且确有变化的那些才记）。 */
  toPending: boolean
  /** 一句话原因代号，直接进日志与界面。 */
  reason: 'merged' | 'deferred-kept-watermark' | 'dropped-kept-watermark' | 'failed-kept-watermark' | 'no-change'
}

/**
 * 水印该不该前进。
 *
 * 唯一一次「有变化要处理」时可以前进的情形是 outcome === 'merged'：变化真的并进列表了，
 * 那条变化从此看得见，于是「上次看到哪」才可以往前走一步。其余情形一律保持原值：
 *   · 被推迟（deferred）：这一次没取，那条变化还在窗口外等着，水印一动它就永远发现不了了；
 *   · 被丢弃（dropped）：丢的是推迟队列里那一条请求，变化本身没处理过 —— 队列清了，水印照旧；
 *   · 失败（failed）：同「被推迟」，只是原因不同。
 * 这三种情形同时要求把这些变化记进持久化待办（toPending）—— 待办是水印不动的前提，
 * 也是「切进工作区看到有待办就整池」那条兜底判据的来源。
 *
 * 唯一另一种可以前进的情形是 outcome === 'not-need'（探测回来说与列表手上一模一样）：
 * 这一次没有「已知但没并进去」的变化，往前走一步不会漏掉任何东西；不推进的话窗口会越拉越宽，
 * 最后退化成每次拉回几乎全量 —— 那正是这个机制要消灭的东西。
 */
export function watermarkAfter(input: WatermarkInput): WatermarkVerdict {
  const prev = Number(input && input.previousMs) || 0
  const started = Number(input && input.scanStartedMs) || 0
  const outcome: FetchOutcome = (input && input.outcome) || 'failed'
  if (outcome === 'merged' || outcome === 'not-need') {
    // 前进到「本次扫描发起之前」：与 indexWindow.nextWatermark 同一条口径（宁可重叠，不可漏）。
    return {
      watermarkMs: started > 0 ? started : prev,
      advanced: started > 0,
      toPending: false,
      reason: outcome === 'merged' ? 'merged' : 'no-change',
    }
  }
  const reason: WatermarkVerdict['reason'] =
    outcome === 'deferred' ? 'deferred-kept-watermark' : outcome === 'dropped' ? 'dropped-kept-watermark' : 'failed-kept-watermark'
  return { watermarkMs: prev, advanced: false, toPending: true, reason: reason }
}

// ---------- 三、世代号：迟到的整池结果不许覆盖更新的增量结果 ----------

/** 一笔取数属于哪一类。整池与增量会并发，回来顺序不保证。 */
export type FetchKind = 'patch' | 'rebuild'

/** 判定结论。 */
export interface GenerationVerdict {
  /** 这份结果还收不收。 */
  accept: boolean
  /** 收下之后这个工作区的世代号该记成几（不收时是原值，一个字节都不动）。 */
  generation: number
  /** 一句话原因代号。 */
  reason: 'fresh' | 'ahead' | 'stale-result'
}

/**
 * 一份回来的结果还算不算数。
 *
 * 用法：一笔取数**发起时**先读一次世代号并记在手里（started），回来时拿它跟当前值比。
 * 相等或更新就收下（收下之后世代号 +1，于是任何比它更早发起、回来更晚的结果都会被判掉）；
 * 比当前值旧就丢弃 —— 这正是「迟到的整池结果不许覆盖更新的增量结果」那一条：
 * 整池在世代 3 发起，回来时增量已经把世代推到 4，这份整池就是过期的，收下它会把新行顶掉。
 *
 * 为什么不按「谁发起得晚谁赢」判：那要看发起时刻的墙钟，而墙钟会被系统对时、休眠、
 * 时钟回拨弄乱；世代号是一个工作区里单调递增的整数，只跟本进程内的先后有关，判起来没有歧义。
 */
export function admitResult(currentGeneration: number, startedGeneration: number): GenerationVerdict {
  const cur = Number(currentGeneration) || 0
  const started = Number(startedGeneration) || 0
  if (started < cur) return { accept: false, generation: cur, reason: 'stale-result' }
  return { accept: true, generation: started + 1, reason: started > cur ? 'ahead' : 'fresh' }
}

// ---------- 四、派生值：该重算还是标「待确认」 ----------

/** 派生值这一次怎么处理。 */
export interface DerivedPlan {
  /** 地图进度环：它只看手上这些行，本地能算准，所以永远重算。 */
  progressAction: 'recompute'
  /**
   * deck.counts：整仓口径（后端给的真数字）。整池重建拿得到，所以重算；
   * 增量路径**不许本地重算** —— 本地数出来的池子数是「这份行数据」的口径，
   * 跟整仓口径本来就不是一个数，硬算一个出来就是 I5 要禁止的假数字。
   */
  countsAction: 'recompute' | 'keep-old-and-mark-pending'
  /** 要不要把 deck.partial 置真（增量之后这份行数据一定有没覆盖到的地方）。 */
  markPartial: boolean
  /** 一句话原因代号。 */
  reason: 'rebuild-has-whole-repo-counts' | 'patch-keeps-whole-repo-counts'
}

/**
 * 补完行之后，派生值各怎么办。
 *
 * patch：进度环重算；计数保持旧值并标「待确认」（界面照 deck.partial 显示成待确认，不显示一个本地硬算的数）；
 * rebuild：整池刚拿回后端计数，照它自己的判定重算，增量这一侧不插手。
 */
export function derivedAfter(mode: FetchKind): DerivedPlan {
  if (mode === 'rebuild') {
    return { progressAction: 'recompute', countsAction: 'recompute', markPartial: false, reason: 'rebuild-has-whole-repo-counts' }
  }
  return { progressAction: 'recompute', countsAction: 'keep-old-and-mark-pending', markPartial: true, reason: 'patch-keeps-whole-repo-counts' }
}

// ---------- 五、把取回来的那几条并进现有列表 ----------

/** 列表里的一行。只要这四样：编号、键、状态、更新时间（其余字段原样带过去）。 */
export interface RowLike {
  number?: number | string
  key?: number | string
  state?: string
  updatedAt?: string
  [k: string]: unknown
}

/** 一行的身份键：优先编号，其次键。找不到就返回空串（调用方按「找不到」处理）。 */
export function rowKey(row: RowLike | null | undefined): string {
  if (!row || typeof row !== 'object') return ''
  const n = (row as RowLike).number
  if (n !== undefined && n !== null && String(n) !== '') return String(n)
  const k = (row as RowLike).key
  if (k !== undefined && k !== null && String(k) !== '') return String(k)
  return ''
}

/** 并入的结果。 */
export interface MergeResult {
  /** 新数组：被换掉的那几行是新对象，其余行是原引用（省一次深拷贝）。 */
  rows: RowLike[]
  /** 真的换掉的行（升序）。 */
  replaced: string[]
  /** 取数回来说变了、可列表里没有这一行（升序）—— 出现它说明基线跟列表对不上，调用方该整池。 */
  missing: string[]
  /** 新版本号，保证与传进来的旧版本号不相等。 */
  version: string
}

/** 32 位 FNV-1a。只用来把「换了哪几行、换成了什么」压成一个短标识，不做安全用途。 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h >>> 0) * 0x01000193
    h = h >>> 0
  }
  return ('00000000' + h.toString(16)).slice(-8)
}

/**
 * 行级补丁的版本号。
 *
 * 必须与旧版本号不同 —— 这是纪律①：客户端拿「内容没变」那条 304 捷径比对版本号，
 * 版本号不变就会被当成「新数据是旧的」丢掉，面板停在上一次的样子。
 * 取法是确定的：把新旧版本号与「换了哪几行、换成了什么」一起散列，输入一样结果就一样
 * （门禁能断言），并且带一条兜底 —— 万一是同一个值，就再加一个后缀，绝不放行一个没变的版本号。
 */
export function nextVersion(prevVersion: string, seeds: readonly string[]): string {
  const prev = String(prevVersion || '')
  const list = (seeds || []).map((s) => String(s)).sort()
  const v = 'p' + fnv1a(list.join('|') + '#' + prev)
  return v === prev ? v + '-1' : v
}

/**
 * 把取回来的那几条并进现有列表。
 *
 * 规则三条，都为了「别动不该动的东西」：
 *   ① 位置不动：列表的排序是用户看着的（按更新时间倒序等），补一行不该让整屏跳位；
 *   ② 不新增行：取回来的编号在列表里找不到，就是 missing（基线跟列表对不上），交给调用方整池 ——
 *      在这里append 一行会绕过「票号增减必须整池」那条判据，地图与层级都会跟着错；
 *   ③ 版本号必变：见 nextVersion。
 */
export function mergeRows(
  rows: readonly RowLike[] | null | undefined,
  patched: readonly RowLike[] | null | undefined,
  prevVersion: string,
): MergeResult {
  const src: RowLike[] = Array.isArray(rows) ? rows : []
  const byKey: Record<string, RowLike> = {}
  for (const p of Array.isArray(patched) ? patched : []) {
    const k = rowKey(p)
    if (k) byKey[k] = p
  }
  const out: RowLike[] = []
  const replaced: string[] = []
  const seen: Record<string, boolean> = {}
  for (const row of src) {
    const k = rowKey(row)
    if (k && Object.prototype.hasOwnProperty.call(byKey, k)) {
      out.push(byKey[k])
      replaced.push(k)
      seen[k] = true
    } else {
      out.push(row)
    }
  }
  const missing: string[] = []
  for (const k of Object.keys(byKey).sort()) if (!seen[k]) missing.push(k)
  const seeds: string[] = []
  for (const k of replaced.sort()) seeds.push(k + '=' + String(byKey[k].state || '') + '|' + String(byKey[k].updatedAt || ''))
  return { rows: out, replaced: replaced, missing: missing, version: nextVersion(prevVersion, seeds) }
}

// ---------- 六、旧结构的兼容：要么迁移，要么整池重建一次 ----------

/** 本机制写出来的快照/索引的结构版本。加字段才加号；加号意味着旧的那些必须先过 checkStructure。 */
export const DELTA_STRUCTURE_VERSION = 1

/** 读到一份快照/索引之后的处理结论。 */
export interface StructureVerdict {
  /** 拿它干什么：直接用 / 先迁移 / 整池重建一次。 */
  action: 'use' | 'migrate' | 'rebuild'
  /** 一句话原因代号。 */
  reason: 'current' | 'legacy-structure' | 'future-structure'
}

/**
 * 磁盘上那份旧快照/索引还能不能当新结构用。
 *
 * 纪律照票面「旧缓存的兼容行为」那一条：旧版本被读到时，要么迁移、要么整池重建一次，
 * **不许静默当新结构用**。这里选的是「整池重建一次」而不是迁移 —— 迁移代码要为一种
 * 谁也不认识的历史形状写一遍，写完了还没法验；而重建一次的价格是明确的（一次整池），
 * 结果一定是对的。将来真出现值得迁移的形状，再在 action 里加一条分支。
 */
export function checkStructure(stamped: { structureVersion?: number } | null | undefined): StructureVerdict {
  const v = stamped && typeof stamped === 'object' ? stamped.structureVersion : undefined
  if (typeof v !== 'number' || !isFinite(v)) return { action: 'rebuild', reason: 'legacy-structure' }
  if (v === DELTA_STRUCTURE_VERSION) return { action: 'use', reason: 'current' }
  if (v > DELTA_STRUCTURE_VERSION) return { action: 'rebuild', reason: 'future-structure' }
  return { action: 'rebuild', reason: 'legacy-structure' }
}
