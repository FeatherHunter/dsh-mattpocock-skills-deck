/**
 * src/tracker/deck-derive.ts —— deck 投影纯函数（host 与 deck 共用；无 IO、无副作用）。
 *
 * 文件头以前写的是 `tracker/deck-derive.js`：那是「改了后缀、体内还是 JSDoc 写法」的中间状态留下的旧路径，
 * 真源就是这一份 .ts（宿主侧没有第二份副本，deck 的 map-snapshot 直接 import 这里的 deriveDeck/parseProgress）。
 * 这次（#1148）把参数与返回值补齐类型标注，运行时的每一条判据一个字没改——下面逐段把「为什么这么判」写清。
 *
 * 第一性原理（#127/#124 定版）：
 *  - deck 是**派生视图**，不是事实源：`MapStats`（frontier/claimed/blocked/indeterminate）不进后端形状，
 *    由 `state` + `blockedBy`（唯一真源）+ `assignees` 推导；后端绝不存 `deck` 字段。
 *  - 独立计数（claimed/blocked/indeterminate 各算各，可重叠）；「open=sum」为伪不变量（删除）。
 *  - `frontier` 须「assignees **已知且空** + !claimed + !blocked」= 天然排除 indeterminate（assignees:MISSING）。
 *  - **NOT-FOUND（破链依赖）→ 安全 blocked**（绝不误判 frontier），levelOf 按 0 计（占层级，不影响 blocked 判定）。
 *  - 例外：同号票在别的 effort 里存在时（跨 effort 引用），按留白处理，不算阻塞——引用只在同一 effort 内成立（与面板阻断表一致）。
 *  - 环（自环/成环）用 visited 守卫：返回 0 / 跳过该边（保证终止）。
 *  - display 直接用 `key`（`#${key}`），无 getDisplayNumber / 无 number。
 *
 * 输入：整个 Snapshot 的 {maps, issues}；deck 以整个 Snapshot 为单位（**按 (effortId, key) 唯一化**；labels 全量并集）。
 */

import { STATE } from './contract/vocabulary.js'
import { effortOf, idOfParts } from './identity-keys.js'

const OPEN = STATE.OPEN
const CLOSED = STATE.CLOSED

/**
 * 一张票（或 map 节点）在**本文件里**要读的那几格。
 *
 * 为什么每格都是 `unknown` 而不是契约层的 `Issue`：入参是后端回包、老快照、手写数据混在一起的运行时真值，
 * 「字段在但不是这个类型」是必须单独处理的一种情况（`isPullRequest` 的 BAD 分支就是为它留的），
 * 声明成 `string`/`boolean` 会逼着调用方在边界上撒谎。取值处一律现场判形状，判据与老实现逐字一致。
 * 只读声明（readonly）：本文件不改入参，任何一格被写都说明有人在共享对象上做手脚。
 */
export interface DeckTicket {
  /** 票号；只认字符串（后端回来的数字编号由上游转成串，这里不做二次转换）。 */
  readonly key?: unknown
  /** 工作单元标识（单工作单元后端为空串或缺席）。 */
  readonly effortId?: unknown
  /** 生命周期状态；只跟 contract 的 STATE.OPEN / STATE.CLOSED 比。 */
  readonly state?: unknown
  /** 正文；进度解析从这里取。 */
  readonly body?: unknown
  /** 认领人；**缺席**与「已知且空」是两件事（前者 indeterminate）。 */
  readonly assignees?: unknown
  /** 标签；元素可能是对象也可能是裸名字串，形状全靠现场判。 */
  readonly labels?: unknown
  /** 阻塞引用；元素按 {@link DeckRef} 读。 */
  readonly blockedBy?: unknown
  /** 是不是拉取请求；true/false/缺席/坏值四种情况各算各的。 */
  readonly isPullRequest?: unknown
  /** 子票（只有 map 节点有）；形状不对时按没有子票处理。 */
  readonly tickets?: unknown
}

/** 阻塞引用在**本文件里**要读的那两格；裸字符串、数字这类老写法在 `candidatesOf` 里单独回落。 */
export interface DeckRef {
  /** 被引用票的票号。 */
  readonly key?: unknown
  /** 引用自己带的拉取请求身份：带了就精确找，不带就按裸键找同号票。 */
  readonly isPullRequest?: unknown
}

/** 标签项在**本文件里**要读的两格；元素是裸名字串的老写法在这里被跳过（那边由 map-snapshot 单独处理）。 */
export interface DeckLabelRaw {
  readonly name?: unknown
  readonly color?: unknown
}

/** 标签目录里的一项：名称去重、颜色保留首次看到的那个。 */
export interface DeckLabel {
  name: string
  color: string
}

/** 一层的聚合数（`stats.levels` 的元素）。 */
export interface DeckLevelAgg {
  total: number
  open: number
  closed: number
}

/**
 * 分层聚合的**内部账**：比出口的 {@link DeckLevelAgg} 多一格层级号。
 * 层级号只在排序时用（按层级从小到大），排完只把三格计数挑出去，所以它不出这个文件。
 */
interface LevelAgg extends DeckLevelAgg {
  level: number
}

/** 派生出来的统计块；**只载形状声明的字段**，多余的内部账（levelAgg 之类）不出这个门。 */
export interface DeckStats {
  total: number
  open: number
  closed: number
  frontier: number
  claimed: number
  blocked: number
  indeterminate: number
  levels: DeckLevelAgg[]
  levelOf: Record<string, number>
}

/** deriveDeck 的返回：deck 视图需要的四件东西，键都是**池内身份**（见 poolIdOfTicket）。 */
export interface DeckDerivation {
  /** 每票的进度（无进度为 null）。 */
  progressOf: Record<string, number | null>
  /** 全量标签目录（按名称去重）。 */
  labels: DeckLabel[]
  /** 统计块。 */
  stats: DeckStats
  /** 每票的阻塞键数组（无键引用已剔除）。 */
  blockedByKeys: Record<string, string[]>
}

/** deriveDeck 的入参；两格都可能缺席或形状不对，一律按空清单处理（与老写法的 `|| []` 同效）。 */
export interface DeckInput {
  readonly maps?: unknown
  readonly issues?: unknown
}

/**
 * 子票清单：缺席、空串、0 都当没有子票；形状坏成「真值但不是数组」时会当场抛——这与老写法一致。
 *
 * 老实现逐字是 `(m.tickets || [])` 直接 for...of。转类型时保留原样，没有顺手加形状守卫：
 * 这次转换的验收口径是「行为零变化」，`|| []` 对上面每一种输入都和老代码给出同一个结果，
 * 而加 Array.isArray 会在「真值非数组」这一格上从抛异常变成静默当成没有子票——那是行为变化。
 * 真要防坏形状另开一票，别混在类型迁移里。
 *
 * 这里的断言不是「我保证它是数组」：`|| []` 之后仍可能是任何真值，断言只是把「按票数组用」这个
 * 原有的读法写出来（下面的消费点都是按票数组用的），运行时形状与老代码完全一致。
 */
function kidsOf(node: DeckTicket): readonly DeckTicket[] {
  return (node.tickets || []) as readonly DeckTicket[]
}

/** 阻塞引用清单：老实现这里本来就写了 Array.isArray 守卫（缺字段、非数组一律当没有阻塞边），逐字保留。 */
function refsOf(ticket: DeckTicket): readonly DeckRef[] {
  return Array.isArray(ticket.blockedBy) ? (ticket.blockedBy as readonly DeckRef[]) : []
}

/** 标签清单：老实现这里同样是 Array.isArray 守卫（MISSING 字段跳过不崩溃），逐字保留。 */
function labelsOf(ticket: DeckTicket): readonly DeckLabelRaw[] {
  return Array.isArray(ticket.labels) ? (ticket.labels as readonly DeckLabelRaw[]) : []
}

/** 自己人手里的存在性判断；`Object.prototype` 上取，避免被票对象自带的 `hasOwnProperty` 覆盖。 */
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/**
 * 从正文解析进度（与 host/index.js 既有口径一致的三级锚定）：
 *   1) 标题行 `## 进度：90%`（行首 markdown 标题 · 进度区正形）
 *   2) 行首变体 `进度：90%` / `Progress: 90%`（无标题符号）
 *   3) 全文兜底（兼容老票随手格式 · 放最后不劫持前两层）
 * 无进度 → null；非法/超界 → clamp 0..100。
 */
export function parseProgress(body: unknown): number | null {
  if (body == null) return null
  const s = String(body)
  const m = s.match(/^\s*#{1,6}\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
    || s.match(/^\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
    || s.match(/(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (isNaN(n)) return null
  return Math.max(0, Math.min(100, n))
}

/** claimed 三态：true=有认领；false=已知且空（EMPTY []）；null=indeterminate（assignees MISSING）。 */
function claimedOf(ticket: DeckTicket): boolean | null {
  if (!hasOwn(ticket, 'assignees')) return null
  return Array.isArray(ticket.assignees) && ticket.assignees.length > 0
}

/**
 * 是否有未满足的 open 阻塞者。
 * 规则（#124 §5.2）：在 deck 内 lookup(ref.key) 且 state==='open' → true；
 * **NOT-FOUND（破链依赖）→ true（安全 blocked，绝不误判 frontier）**；
 * 跨 effort 引用（同号票在别的 effort 里存在）→ false（留白，引用只在同一 effort 内成立）。
 *
 * @param ticket 被查的票（取 effort 与 blockedBy）
 * @param byPool deck 内全部票（池内身份 → Issue）
 * @param byBase 裸 key → 同号全部票（老引用回落）
 * @param keysAny 裸 key 在任一 effort 出现过即有（区分跨 effort 留白与真破链）
 */
/**
 * 池内身份：**先按 effort 圈定范围**（effort 维度：同号票在不同 effort 里是两张票），再按是否拉取请求区分。
 * 单 effort 后端 effortId 为 ''，退化成老口径（裸 key + 拉取请求后缀）。
 */
function poolIdOfTicket(it: DeckTicket | null | undefined): string {
  const k = idOfParts(effortOf(it), (it && it.key) || '')
  if (!hasOwn(it || {}, 'isPullRequest')) return k // MISSING=无能力后端省略，保持裸键（老快照兼容）
  const pr = it && it.isPullRequest
  if (pr === true) return k + '\0pr'
  if (pr === false) return k + '\0issue' // false 与 MISSING 不再混同，各算各的
  return k + '\0bad' // BAD=字段在但不是布尔值，单独隔离，不吞不混（混合返回不断言一致）
}

/** 同号候选：引用只在**引用方所属 effort**内解析；引用自带拉取请求身份则精确找，老引用按裸键找同号票。 */
function candidatesOf(ref: unknown, byPool: Map<string, DeckTicket>, byBase: Map<string, DeckTicket[]>, effort: string): DeckTicket[] {
  const base = idOfParts(effort, (ref && (ref as DeckRef).key) || '')
  if (ref && hasOwn(ref, 'isPullRequest')) {
    const pr = (ref as DeckRef).isPullRequest
    const pid = pr === true ? base + '\0pr' : (pr === false ? base + '\0issue' : base + '\0bad')
    const exact = byPool.get(pid)
    return exact ? [exact] : []
  }
  const arr = byBase.get(base)
  return arr || []
}

function hasOpenBlocker(ticket: DeckTicket, byPool: Map<string, DeckTicket>, byBase: Map<string, DeckTicket[]>, keysAny: Set<unknown>): boolean {
  const refs = refsOf(ticket)
  if (refs.length === 0) return false
  const effort = effortOf(ticket)
  return refs.some((ref: unknown) => {
    const cands = candidatesOf(ref, byPool, byBase, effort)
    if (!cands.length) {
      // 同号票在别的 effort 里存在 → 跨 effort 引用，按留白处理，不算阻塞；
      // 带拉取请求身份的精确引用缺失，仍按破链处理（身份不同，不留白）；
      // 哪里都没有 → 破链依赖 → blocked（安全，绝不误判 frontier）。
      if (ref && !hasOwn(ref, 'isPullRequest') && keysAny && keysAny.has((ref && (ref as DeckRef).key) || '')) return false
      return true
    }
    return cands.some((c) => c.state === OPEN)
  })
}

/**
 * DAG 最长路径分层（level(root)=0；level(x)=1+max(level(直接阻塞者))）。
 * 环守卫：visited 栈内重入 → 0（跳过该边）；NOT-FOUND 阻塞者 → 按 0 计（占层级）。
 *
 * @param memo 池内身份 → 已算出的层级；命中的直接回（环与重复引用靠它收敛）
 * @param stack 当前递归路径上的池内身份；重入即环
 */
function levelOf(ticket: DeckTicket, byPool: Map<string, DeckTicket>, byBase: Map<string, DeckTicket[]>, memo: Map<string, number>, stack: Set<string>): number {
  const k = poolIdOfTicket(ticket)
  if (memo.has(k)) {
    // memo 里存的只会是本函数自己 set 进去的 number；这里只是把 Map.get 类型上的 undefined 摘掉。
    const hit = memo.get(k)
    if (hit !== undefined) return hit
  }
  if (stack.has(k)) return 0 // 环：返回 0 / 跳过该边
  stack.add(k)
  let maxL = -1
  const effort = effortOf(ticket)
  const refs = refsOf(ticket)
  for (const ref of refs) {
    const cands = candidatesOf(ref, byPool, byBase, effort)
    let l = 0 // NOT-FOUND → 0（占层级）
    for (const target of cands) {
      const cl = levelOf(target, byPool, byBase, memo, stack)
      if (cl > l) l = cl
    }
    if (l > maxL) maxL = l
  }
  stack.delete(k)
  const level = maxL === -1 ? 0 : maxL + 1
  memo.set(k, level)
  return level
}

/**
 * 把一张 deck 切片（maps + issues）投影成 DeckDerivation。
 * - 覆盖单位 = 整个 Snapshot：maps（节点本身 + 各自 tickets）+ issues（孤儿/未挂图票），按 key 唯一化；
 *   deck 负责全部票（全局 key 空间；labels 色板全量并集）。
 * - 输入必须满足：tickets 只挂在 MapNode 上（base Issue 无 tickets）；孤儿含破链票与根票（见 snapshot.ts）。
 */
export function deriveDeck(input: DeckInput = {}): DeckDerivation {
  const maps: readonly DeckTicket[] = Array.isArray(input.maps) ? (input.maps as readonly DeckTicket[]) : []
  const issues: readonly DeckTicket[] = Array.isArray(input.issues) ? (input.issues as readonly DeckTicket[]) : []

  // 按池内身份唯一化（同 key 但是否为拉取请求不同，是两票；map 节点也可能出现在父 map.tickets；lookup 全局一份）。
  // 语义（Q4 裁决）：deck 以整个 Snapshot 为单位——**票池**（stats 计数对象）= 各 map.tickets 并集 + issues（孤儿/未挂图票）；
  // **map 节点本身**是容器（父 map.tickets 里的子 map 仍算其父的票，计入池）；map 节点不因「在 maps[] 里」而重复计数，
  // 但其池内身份参与 lookup（跨 map 依赖可解析）。progressOf/labels/blockedByKeys/levelOf 覆盖全部（含 map 节点）。
  // 口径（#505 小修）：false（确认为普通工单）与 MISSING（无能力后端省略）不再混同；BAD（非布尔）单独隔离；混合返回不断言一致。
  const byPool = new Map<string, DeckTicket>()
  const byBase = new Map<string, DeckTicket[]>() // (effort, 裸 key) → 同号全部票（老引用无身份字段时的回落查找，只在同一 effort 内）
  const add = (t: DeckTicket | null | undefined): void => {
    if (!t || typeof t.key !== 'string') return
    const pid = poolIdOfTicket(t)
    if (!byPool.has(pid)) {
      byPool.set(pid, t)
      const baseKey = idOfParts(effortOf(t), t.key)
      const arr = byBase.get(baseKey) || []
      arr.push(t)
      byBase.set(baseKey, arr)
    }
  }
  for (const m of maps) { add(m); for (const t of kidsOf(m)) add(t) }
  for (const t of issues) add(t)
  const all = Array.from(byPool.values())
  // 裸 key 在任一 effort 里出现过即记一笔，用来区分“跨 effort 引用”（留白）与“哪里都没有”（破链，安全 blocked）。
  // 收成 Set<unknown> 而不是 Set<string>：下面查的是引用里那格原始值（可能不是字符串），
  // 语义就是「原值在不在这个集合里」——不做 String() 转换，转了就与老实现不同（数字引用会被误判成命中）。
  const keysAny = new Set<unknown>()
  for (const t of all) { if (t && typeof t.key === 'string') keysAny.add(t.key) }

  // 票池 = 各 map.tickets 并集 + issues（不含单独出现在 maps[] 的根 map 节点；按池内身份计，同号异类计两票）
  const poolKeys = new Set<string>()
  for (const m of maps) for (const t of kidsOf(m)) if (t && typeof t.key === 'string') poolKeys.add(poolIdOfTicket(t))
  for (const t of issues) if (t && typeof t.key === 'string') poolKeys.add(poolIdOfTicket(t))

  // progressOf（每票基数；无 → null；按池内身份键入，同号异类各记各的）
  const progressOf: Record<string, number | null> = {}
  for (const t of all) progressOf[poolIdOfTicket(t)] = parseProgress(t.body)

  // labels 色板目录（全量并集；名称唯一，保留首个颜色；MISSING 字段跳过不崩溃）
  const labelMap = new Map<string, DeckLabel>()
  for (const t of all) {
    for (const l of labelsOf(t)) {
      if (l && typeof l.name === 'string' && !labelMap.has(l.name)) {
        labelMap.set(l.name, { name: l.name, color: typeof l.color === 'string' ? l.color : '' })
      }
    }
  }
  const labels = Array.from(labelMap.values())

  // levelOf（DAG 全票；环/NFD 规则见 levelOf；按池内身份键入）
  const memo = new Map<string, number>()
  const stack = new Set<string>()
  const levelOfByKey: Record<string, number> = {}
  for (const t of all) levelOfByKey[poolIdOfTicket(t)] = levelOf(t, byPool, byBase, memo, stack)

  // stats（独立计数可重叠；frontier ⊥ claimed/blocked/indeterminate；NOT-FOUND→blocked 安全）。
  // 只统计票池（map.tickets + orphan）；map 节点本身是容器，不重复计数。
  const stats: DeckStats = { total: poolKeys.size, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, indeterminate: 0, levels: [], levelOf: levelOfByKey }
  const levelAgg = new Map<number, LevelAgg>() // level -> {total, open, closed}
  for (const pid of poolKeys) {
    const t = byPool.get(pid)
    if (!t) continue // 孤儿隔离：池键无对应票时跳过，不崩溃
    const isOpen = t.state === OPEN
    if (t.state === CLOSED) stats.closed++
    else if (isOpen) stats.open++
    const claimed = claimedOf(t)
    const isBlocked = isOpen && hasOpenBlocker(t, byPool, byBase, keysAny)
    if (claimed === true) stats.claimed++
    else if (claimed === null) stats.indeterminate++
    if (isBlocked) stats.blocked++
    if (isOpen && claimed === false && !isBlocked) stats.frontier++ // assignees 已知且空 + !claimed + !blocked
    const lv = levelOfByKey[pid]
    let agg = levelAgg.get(lv)
    if (!agg) { agg = { level: lv, total: 0, open: 0, closed: 0 }; levelAgg.set(lv, agg) }
    agg.total++
    if (isOpen) agg.open++
    else agg.closed++
  }
  stats.levels = Array.from(levelAgg.values())
    .sort((a, b) => a.level - b.level)
    .map((v) => ({ total: v.total, open: v.open, closed: v.closed })) // 每层（数组）；只载形状声明的字段

  // 阻塞键数组：每票的阻塞引用按「引用自带的键」取出，空键剔除。
  // 无键引用（断链、形状不全）直接跳过：它当不了键，留空值整包会被外层拒收（有这类边的地图读快照就红）。
  const blockedByKeys: Record<string, string[]> = {}
  for (const t of all) {
    blockedByKeys[poolIdOfTicket(t)] = refsOf(t)
      .map((r) => (r && typeof r.key === 'string' ? r.key : ''))
      .filter((k) => k !== '')
  }

  return { progressOf, labels, stats, blockedByKeys }
}

/**
 * 投影口径的版本标记：随投影**规则**的语义变化往上抬，不随代码改动抬。
 * 老代码就导出着它（`src/tracker/index.ts` 还再导出一次），今天仓里还没有读取点——
 * 它是留给消费方（图快照、UI）认「这份派生结果按哪一版口径算的」用的；谁要先读，先把口径写清。
 */
export const DECK_DERIVE = Object.freeze({ version: 1 })
