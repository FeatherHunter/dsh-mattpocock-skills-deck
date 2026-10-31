/**
 * src/refresh/kernel/detail-eviction.ts —— 按需细节的淘汰规则（#1692）
 *
 * 磁盘快照里最占地方的是「按需取回来的细节」：正文、评论、评审、子票清单。这些内容
 * 不再是每次刷新都会拿到的东西（#1691 起按需补取），但也不会自己消失，越攒越大。
 * 这个模块定死「攒到多少开始淘汰、淘汰谁、淘汰以后留下什么」，其余代码只调用它。
 *
 * 四条硬规矩（改这里的人先看）：
 * 1. **只淘汰内容，不淘汰骨架。** 可淘汰的只有 body / comments / reviews / subIssues 四个内容字段；
 *    行本身、父子关系（parentKey）、依赖关系（blockedBy）、子票计数（subIssueCounts）、评论计数
 *    （commentCount）永远留下——它们是一张票「在不在、连着谁」的事实，丢了面板就会少行、错边。
 * 2. **淘汰后留「曾取过」的记号。** 删掉内容时在行上写 detailEvicted（什么时候淘汰、淘汰了哪几栏、
 *    上次拿到是什么时候）；界面据此显示「未取（曾在某时）」，而不是把「没内容」说成「没有正文」。
 * 3. **LRU 用行上的 detailTouchedAt 排序。** 它由调用方在写入时打：本轮真拿到的行传进 freshKeys，
 *    其余行沿用上次的戳；从来没有戳的行视为现在拿到（旧数据不带戳，第一次清理时按「刚取到」对待，
 *    之后戳就稳定下来了，不会每轮都被当成刚拿到）。
 * 4. **上限是条数与字节两个，先到先算。** 从最新的往旧的攒，两头上限哪个先撞上就停，剩余全淘汰；
 *    这样淘汰的是「又旧又占地方」的那批，而不是只看条数把大行原样留着。
 *
 * 本模块不读盘、不联网、不看时钟：时钟由调用方传进来，门禁才能用固定时刻复现。
 */
/** 可淘汰的内容字段（骨架字段见约定 1，这里一个都不许加）。 */
export const EVICTABLE_CONTENT_FIELDS: string[] = ['body', 'comments', 'reviews', 'subIssues']
/** 最多留多少行带细节内容（条数上限）。 */
export const DETAIL_EVICTION_MAX_ENTRIES = 200
/** 最多留多少字节的细节内容（字节上限，按 UTF-8 计）。 */
export const DETAIL_EVICTION_MAX_BYTES = 512 * 1024
/** 淘汰留下的记号字段名；界面与门禁都按这个键读。 */
export const DETAIL_EVICTED_FIELD = 'detailEvicted'
/** 最近一次拿到内容的时刻字段名；LRU 排序按它，它本身不占内容预算。 */
export const DETAIL_TOUCH_FIELD = 'detailTouchedAt'

export interface DetailEvictionLimits {
  maxEntries: number
  maxBytes: number
}

/** 默认上限：与票面口径同源（一处定义，调用方也可以注入别的值做门禁）。 */
export const DETAIL_EVICTION_LIMITS: DetailEvictionLimits = {
  maxEntries: DETAIL_EVICTION_MAX_ENTRIES,
  maxBytes: DETAIL_EVICTION_MAX_BYTES,
}

export interface DetailEvictionStats {
  /** 本轮淘汰掉内容的行数。 */
  evicted: number
  /** 本轮淘汰掉的字节数（按内容字段的 UTF-8 字节算）。 */
  evictedBytes: number
  /** 清理后仍带内容、且在预算内的行数。 */
  kept: number
  /** 清理后仍带内容的字节数。 */
  keptBytes: number
  /** 本轮打过新时间戳的行数。 */
  touched: number
}

function isRecord(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function usableMs(v: unknown): number {
  return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0
}

/** UTF-8 字节数：不依赖 Buffer/TextEncoder，两个运行环境（宿主与门禁）算出来一致。 */
export function utf8Bytes(s: unknown): number {
  const text: string = typeof s === 'string' ? s : String(s === undefined || s === null ? '' : s)
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1 }
    else n += 3
  }
  return n
}

/** 这一行身上有哪些可淘汰内容；没有内容返回空数组（骨架行不算候选）。 */
export function contentFieldsOf(row: unknown): string[] {
  const out: string[] = []
  if (!isRecord(row)) return out
  const r: any = row
  for (let i = 0; i < EVICTABLE_CONTENT_FIELDS.length; i++) {
    const f = EVICTABLE_CONTENT_FIELDS[i]
    if (r[f] !== undefined && r[f] !== null) out.push(f)
  }
  return out
}

/** 一行身上内容字段的字节数；已经淘汰过的行没有内容字段，自然回 0。 */
export function contentBytesOf(row: unknown): number {
  const fields = contentFieldsOf(row)
  if (!fields.length) return 0
  const bag: any = {}
  for (let i = 0; i < fields.length; i++) bag[fields[i]] = (row as any)[fields[i]]
  return utf8Bytes(JSON.stringify(bag))
}

interface Candidate {
  row: any
  key: string
  touchedAt: number
  bytes: number
}

/**
 * 淘汰规则认的行键：key 在就用 String(key)，key 缺席才用 number；不 trim、不拆对象包装，空值回 ''。
 *
 * 这是四套行身份口径里刷新内核的一份：只要求「同一轮刷新里、同一种行的键写法前后一致」，
 * 不做跨后端归一（GitHub 的数字键与 Markdown 补零字符串键在这里原样当键）。与宿主装配层
 * 不同的是 key 为空串时不回落 number；与客户端地图卡片不同的是不去前导零。四处暂不合并的
 * 原因见 docs/design/20261030-panel-snapshot-closeout.md 第 9 节第 7 条与 #1769。
 */
function rowKeyOf(row: any): string {
  if (row && row.key !== undefined && row.key !== null) return String(row.key)
  if (row && row.number !== undefined && row.number !== null) return String(row.number)
  return ''
}

/** 把候选行按「从新到旧」排好：时间相同按 key 排，保证门禁与真跑顺序一致。 */
function sortCandidates(list: Candidate[]): void {
  list.sort(function (a, b) {
    if (b.touchedAt !== a.touchedAt) return b.touchedAt - a.touchedAt
    return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0)
  })
}

/** 收集候选行并按 LRU 排好；本轮真拿到的行打新戳，其余沿用旧戳（旧数据没戳时视为现在拿到）。 */
function collectFrom(rows: any[], freshKeys: any, nowMs: number, out: Candidate[], touched: { n: number }): void {
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i]
    if (!isRecord(row)) continue
    if (!contentFieldsOf(row).length) continue
    const key = rowKeyOf(row)
    let touchedAt = usableMs(row[DETAIL_TOUCH_FIELD])
    if ((freshKeys && key && freshKeys[key] === true) || !touchedAt) {
      touchedAt = nowMs
      row[DETAIL_TOUCH_FIELD] = nowMs
      touched.n += 1
    }
    out.push({ row: row, key: key, touchedAt: touchedAt, bytes: contentBytesOf(row) })
  }
}

/** 行去掉内容、留记号（返回新对象，输入行不动；未知字段如 provenance 原样保留）。 */
function evictRow(row: any, nowMs: number, fields: string[], touchedAt: number): any {
  const next: any = Object.assign({}, row)
  for (let i = 0; i < fields.length; i++) delete next[fields[i]]
  next[DETAIL_EVICTED_FIELD] = { atMs: nowMs, fields: fields.slice(), lastKnownAtMs: touchedAt }
  return next
}

export interface EvictSnapshotOptions {
  nowMs: number
  limits?: DetailEvictionLimits
  /** 本轮真拿到的行（key → true）；只给这些行打新时间戳，其余沿用旧戳。 */
  freshKeys?: Record<string, boolean> | null
}

/**
 * 在快照上跑一遍淘汰：只动可淘汰内容字段，返回新快照（容器与受影响行是新对象，
 * 没动到的行保持原引用）。快照不是对象或没有 issues 时原样返回。
 */
export function evictDetailsInSnapshot(snapshot: unknown, opts: EvictSnapshotOptions): { snapshot: any; stats: DetailEvictionStats } {
  const stats: DetailEvictionStats = { evicted: 0, evictedBytes: 0, kept: 0, keptBytes: 0, touched: 0 }
  const empty = { snapshot: snapshot, stats: stats }
  if (!isRecord(snapshot)) return empty
  const snap: any = snapshot
  const limits: DetailEvictionLimits = opts && opts.limits ? opts.limits : DETAIL_EVICTION_LIMITS
  const nowMs: number = usableMs(opts && opts.nowMs) || 0
  const candidates: Candidate[] = []
  const touched = { n: 0 }
  const freshKeys: any = (opts && opts.freshKeys) || null
  const issues: any[] = Array.isArray(snap.issues) ? snap.issues : []
  collectFrom(issues, freshKeys, nowMs, candidates, touched)
  const maps: any[] = Array.isArray(snap.maps) ? snap.maps : []
  for (let i = 0; i < maps.length; i++) {
    const m: any = maps[i]
    if (m && isRecord(m) && Array.isArray(m.tickets)) collectFrom(m.tickets, freshKeys, nowMs, candidates, touched)
  }
  if (candidates.length > 1) sortCandidates(candidates)
  stats.touched = touched.n
  // 从新到旧攒；条数与字节任一撞上限就停，剩下全部淘汰。
  let kept = 0
  let bytes = 0
  let cut = candidates.length
  for (let i = 0; i < candidates.length; i++) {
    if (kept + 1 > limits.maxEntries || bytes + candidates[i].bytes > limits.maxBytes) { cut = i; break }
    kept += 1
    bytes += candidates[i].bytes
  }
  const evictedRows = new Set<any>()
  for (let i = cut; i < candidates.length; i++) {
    evictedRows.add(candidates[i].row)
    stats.evicted += 1
    stats.evictedBytes += candidates[i].bytes
  }
  stats.kept = kept
  stats.keptBytes = bytes
  const rewrite = function (rows: any[]): any[] {
    let changed = false
    const out: any[] = rows.map(function (row: any) {
      if (!evictedRows.has(row)) return row
      changed = true
      return evictRow(row, nowMs, contentFieldsOf(row), usableMs(row[DETAIL_TOUCH_FIELD]))
    })
    return changed ? out : rows
  }
  const nextIssues = rewrite(issues)
  const nextMaps: any[] = maps.map(function (m: any) {
    if (!m || !isRecord(m) || !Array.isArray(m.tickets)) return m
    const tickets = rewrite(m.tickets)
    return tickets === m.tickets ? m : Object.assign({}, m, { tickets: tickets })
  })
  if (nextIssues === issues && nextMaps.every(function (m: any, i: number) { return m === maps[i] })) return empty
  return { snapshot: Object.assign({}, snap, { issues: nextIssues, maps: nextMaps }), stats: stats }
}
