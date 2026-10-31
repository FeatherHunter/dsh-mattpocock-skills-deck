/**
 * src/refresh/kernel/disk-snapshot-format.ts —— 磁盘快照的格式与来源（#1692）
 *
 * 为什么单独一层：磁盘上放的是**整份快照**，不是一次接口回包。整份快照由多次读结果攒成，
 * 每块的来源与完整度不一样；回放时若只认一个「文件在不在」，界面与日志就说不清
 * 「这份数据是什么时候、从哪些来源、信到什么程度」。落盘与回放两边都要用同一套判据，
 * 所以规则放在核里，磁盘读写那两个函数只负责搬运字节。
 *
 * 约定（改这里的人先看）：
 * 1. **格式版本只在本文件一处定。** 读到更旧的版本（升级前写下的文件）不拒绝，按「来源未知」回放，
 *    快照里已有的字段一个都不删——旧文件没有来源信息，删字段等于把上次已知的数据丢给人看。
 * 2. **来源只记到「整仓级」。** 逐组来源从快照合并的组戳（snapshot.merge.groups）里读；
 *    不同来源超过 DISK_SOURCE_MAX_KINDS 种时不再逐条列，塌成 'mixed' 与 collapsed 标记，
 *    避免把来源清单塞进每一行。
 * 3. **回放要留时间。** 落盘时刻写进 meta.writtenAtMs，回放方据此说「上次已知（时间）」；
 *    没写过的旧文件退回快照自己的 generatedMs（它本来就是那份数据的取数时刻）。
 * 4. **本模块不读盘、不联网、不看时钟。** 时钟由调用方传进来，门禁才能用固定时刻复现。
 */
export const DISK_SNAPSHOT_SCHEMA = 4
/** 升级前（#1692 之前）写下的格式：没有来源与完整度，但快照字段是完整的。 */
export const DISK_SNAPSHOT_SCHEMA_LEGACY = 3
/** 整仓级来源最多列几种；超过就塌成 'mixed'（见约定 2）。 */
export const DISK_SOURCE_MAX_KINDS = 3
export const DISK_SOURCE_UNKNOWN = 'unknown'
export const DISK_SOURCE_LEGACY = 'legacy-unknown'
export const DISK_SOURCE_MIXED = 'mixed'

export interface DiskSnapshotMeta {
  schema: number
  source: string
  completeness: string
  sources: string[]
  collapsed: boolean
  writtenAtMs: number
  groups: number
}

export interface DiskSnapshotRead {
  ok: boolean
  reason?: string
  snapshot?: any
  meta?: DiskSnapshotMeta
  legacy?: boolean
}

function isRecord(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function usableMs(v: unknown): number {
  return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0
}

function textOf(v: unknown): string {
  return (typeof v === 'string' && v.trim()) ? v.trim() : ''
}

/**
 * 从快照的合并组戳里读出整仓级来源。groups 缺了或不是对象时一律回 unknown：
 * 「不知道」要如实说成不知道，不能猜成 complete。
 */
export function diskSourceOf(snapshot: unknown): { source: string; sources: string[]; completeness: string; groups: number; collapsed: boolean } {
  const merge: any = isRecord(snapshot) && isRecord((snapshot as any).merge) ? (snapshot as any).merge : null
  const groups: any = (merge && isRecord(merge.groups)) ? merge.groups : null
  let names: string[] = []
  const sources: string[] = []
  let truncated = false
  let partial = false
  let complete = 0
  if (groups) {
    names = Object.keys(groups)
    for (let i = 0; i < names.length; i++) {
      const stamp: any = groups[names[i]]
      if (!isRecord(stamp)) continue
      const src: string = textOf(stamp.source) || DISK_SOURCE_UNKNOWN
      if (sources.indexOf(src) < 0) sources.push(src)
      if (stamp.completeness === 'truncated') truncated = true
      else if (stamp.completeness === 'partial') partial = true
      else if (stamp.completeness === 'complete') complete += 1
    }
  }
  sources.sort()
  let collapsed = false
  let source = DISK_SOURCE_UNKNOWN
  if (sources.length === 1) source = sources[0]
  else if (sources.length > 1) {
    source = DISK_SOURCE_MIXED
    if (sources.length > DISK_SOURCE_MAX_KINDS) {
      collapsed = true
      sources.length = 0
      sources.push(DISK_SOURCE_MIXED)
    }
  }
  const completeness: string = truncated ? 'truncated' : (partial ? 'partial' : (complete > 0 ? 'complete' : 'unknown'))
  return { source: source, sources: sources, completeness: completeness, groups: names.length, collapsed: collapsed }
}

/** 落盘时随快照一起写的来源信息：整仓级来源、完整度、写入时刻，以及格式版本。 */
export function buildDiskMeta(snapshot: unknown, writtenAtMs: unknown): DiskSnapshotMeta {
  const src = diskSourceOf(snapshot)
  return {
    schema: DISK_SNAPSHOT_SCHEMA,
    source: src.source,
    completeness: src.completeness,
    sources: src.sources,
    collapsed: src.collapsed,
    writtenAtMs: usableMs(writtenAtMs),
    groups: src.groups,
  }
}

/**
 * 把快照包成落盘形状。只加信封两个键（cacheFormat、diskMeta），快照内容一个字节都不动：
 * 这份返回值会被 JSON.stringify 直接写出，写盘的人不需要再拼一次。
 */
export function buildDiskSnapshot(snapshot: unknown, writtenAtMs: unknown): any {
  if (!isRecord(snapshot)) return snapshot
  return Object.assign({}, snapshot, { cacheFormat: DISK_SNAPSHOT_SCHEMA, diskMeta: buildDiskMeta(snapshot, writtenAtMs) })
}

/** 旧格式回放的来源信息：文件里没有来源，只能如实说「不知道」。 */
export function legacyDiskMeta(raw: any): DiskSnapshotMeta {
  return {
    schema: DISK_SNAPSHOT_SCHEMA_LEGACY,
    source: DISK_SOURCE_LEGACY,
    completeness: 'unknown',
    sources: [DISK_SOURCE_LEGACY],
    collapsed: false,
    writtenAtMs: usableMs(raw && raw.generatedMs),
    groups: 0,
  }
}

function normalizeDiskMeta(raw: any, fallbackMs: unknown): DiskSnapshotMeta {
  if (!isRecord(raw)) return buildDiskMeta({}, fallbackMs)
  const sources: string[] = Array.isArray(raw.sources) ? raw.sources.filter(function (s: unknown) { return typeof s === 'string' && s }) : []
  return {
    schema: (typeof raw.schema === 'number' && isFinite(raw.schema)) ? raw.schema : DISK_SNAPSHOT_SCHEMA,
    source: textOf(raw.source) || DISK_SOURCE_UNKNOWN,
    completeness: textOf(raw.completeness) || 'unknown',
    sources: sources.length ? sources : [DISK_SOURCE_UNKNOWN],
    collapsed: raw.collapsed === true,
    writtenAtMs: usableMs(raw.writtenAtMs) || usableMs(fallbackMs),
    groups: (typeof raw.groups === 'number' && isFinite(raw.groups)) ? raw.groups : 0,
  }
}

/**
 * 解析一块磁盘内容。判据与升级前那条一致（ok、maps 数组、generatedMs 是数、格式版本可读），
 * 只把版本从「必须是 3」放宽到「3 或 4」：3 按来源未知回放，4 按文件里的 meta 回放。
 * 回放的快照只摘掉信封两个键，其余字段原样交出——这就是「旧格式不删字段」的落点。
 */
export function readDiskSnapshot(raw: unknown): DiskSnapshotRead {
  if (!isRecord(raw)) return { ok: false, reason: 'not-object' }
  const obj: any = raw
  if (obj.ok !== true) return { ok: false, reason: 'not-ok' }
  if (!Array.isArray(obj.maps)) return { ok: false, reason: 'maps-not-array' }
  if (typeof obj.generatedMs !== 'number' || !isFinite(obj.generatedMs)) return { ok: false, reason: 'generatedMs-not-number' }
  const schema: any = obj.cacheFormat
  if (schema !== DISK_SNAPSHOT_SCHEMA_LEGACY && schema !== DISK_SNAPSHOT_SCHEMA) return { ok: false, reason: 'schema-unreadable' }
  const snapshot: any = Object.assign({}, obj)
  delete snapshot.cacheFormat
  delete snapshot.diskMeta
  const legacy: boolean = schema === DISK_SNAPSHOT_SCHEMA_LEGACY
  const meta: DiskSnapshotMeta = legacy ? legacyDiskMeta(obj) : normalizeDiskMeta(obj.diskMeta, obj.generatedMs)
  return { ok: true, snapshot: snapshot, meta: meta, legacy: legacy }
}

/**
 * 回放时挂到快照上的那一小格（客户端界面读它说「上次已知（时间）」）。
 * 为什么挂在快照对象上：客户端装快照时整份回包就是 st.snapshot，另开一条通路要改通信协议，
 * 而这里的信息本来就是这份数据的属性。
 */
export function diskReplayFields(meta: DiskSnapshotMeta | null | undefined): any {
  if (!meta) return null
  return {
    diskReplay: {
      schema: meta.schema,
      source: meta.source,
      completeness: meta.completeness,
      legacy: meta.schema === DISK_SNAPSHOT_SCHEMA_LEGACY,
      lastKnownAtMs: meta.writtenAtMs,
    },
  }
}
