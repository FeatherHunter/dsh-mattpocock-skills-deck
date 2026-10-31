/**
 * src/refresh/kernel/notification-events.ts —— 通知事件库的纯逻辑（票 #1693，规格 #1681 阶段 2）
 *
 * 通知事件库只记历史：降级开始、降级恢复、刷新失败、写失败四类事件。当前是否处于降级永远从快照的
 * fallback 标记派生（复用 fallback-fetch-budget 的 fallbackStandingOf），不从事件库读——进程重启后
 * 事件库里可能还留着一条旧历史，拿它判当前状态就会把「已经好了」说成「还在降级」。
 *
 * 四条不能改的口径（改之前先读 docs/adr/20261030-panel-snapshot-single-source.md 第 2.6 节）：
 * 1. 事件身份 =（仓库、类型、开始时刻）。恢复只配「未闭合且开始时刻最晚」的那一条；未闭合靠
 *    endedAt === null 表达，所以重启后读到同一份文件仍能配对，不会配到别人身上。
 * 2. 去重只合并瞬时事件（刷新失败、写失败）：同仓库同类型在去重窗内的重复出现并入上一条，
 *    只把次数加一、更新最后时刻；降级开始不走去重，它靠「已有一条未闭合」判重。
 * 3. 清理只清历史：按保留期删已闭合事件，再按条数上限从最旧的已闭合事件删；未闭合的降级开始
 *    永远不删——它是恢复配对的唯一依据，删了当前状态没变，历史却断成两截。
 * 4. 文件版本只在本文件定义（NOTIFICATION_EVENT_SCHEMA）；读到不认识的结构就当空历史，下一笔写入
 *    整份重写，不把损坏内容当事实。语义与 disk-snapshot-format 的版本口径一致。
 * 5. 事件正文只存结构化内容（type、code、params），不存界面文案：界面文案在客户端按 code 走本地化
 *    词条渲染（ADR 20261020-ui-copy-data-driven）。summary/detail 是旧版本落过的文案，只为读回旧
 *    文件保留，新写入不再产生，也不作为界面文案来源。
 *
 * 本文件不读盘、不看时钟、不读环境变量：now 一律由调用方传入；落盘 IO 在
 * src/refresh/rooms/host/notification-store.ts。
 */
import { fallbackStandingOf } from './fallback-fetch-budget.js'

/** 事件文件的版本。与快照信封同一种语义：只在一处定，读到更旧或不认识的版本按空历史处理。 */
export const NOTIFICATION_EVENT_SCHEMA = 1
/** 四类事件。顺序固定，门禁按这个顺序断言。 */
export const NOTIFICATION_EVENT_TYPES = ['degraded-start', 'degraded-recovery', 'refresh-failed', 'write-failed'] as const
/** 事件类型。 */
export type NotificationEventType = typeof NOTIFICATION_EVENT_TYPES[number]
/** 条数上限：票面要求「条数上限用代码常量」，不进时间配置。 */
export const NOTIFICATION_EVENT_MAX_EVENTS = 500
/** 摘要与详情的文本上限：日志纪律规定长原文不落盘，事件只留能定位的短句。 */
export const NOTIFICATION_EVENT_MAX_TEXT = 200

/**
 * 一条通知事件。startedAt 与 endedAt 都是毫秒时间戳；未闭合的事件 endedAt 是 null。
 * 正文只存结构化内容：code 是稳定的机器码（默认与事件类型同名），params 是界面拼词条用的短参数
 * （只留标量）。界面文案不落盘：渲染时按 code 与 params 走本地化词条。
 */
export interface NotificationEvent {
  id: string
  type: NotificationEventType
  repo: string
  startedAt: number
  endedAt: number | null
  count: number
  code: string
  params: Record<string, string>
  updatedAt: number
  /** 旧版本字段：只在读回旧文件时出现，不作为界面文案。 */
  summary?: string
  /** 旧版本字段：只在读回旧文件时出现，不作为界面文案。 */
  detail?: string
}

/** 落盘文件：一个仓库一份，与快照信封同目录；writtenAtMs 只用于排查，不参与逻辑。 */
export interface NotificationEventFile {
  schema: number
  repo: string
  events: NotificationEvent[]
  writtenAtMs: number
}

/** 追加一条事件要的输入（now 由调用方给，纯逻辑不读钟）。code/params 是结构化正文，不是界面文案。 */
export interface EventInput {
  repo: string
  now: number
  code?: unknown
  params?: unknown
}

/** 瞬时事件的输入：多一个去重窗。 */
export interface InstantInput extends EventInput {
  type: NotificationEventType
  dedupeMs: number
}

/** 当前降级的派生结果：degraded 只来自快照；historyMismatch 单独说「历史与快照对不上」。 */
export interface CurrentDegradedView {
  degraded: boolean
  openStartedAt: number | null
  historyMismatch: boolean
}

/** 这次事件类型认不认识。 */
export function isNotificationEventType(v: unknown): v is NotificationEventType {
  return (NOTIFICATION_EVENT_TYPES as readonly unknown[]).indexOf(v) >= 0
}

/** 仓库键归一成 owner/name；拿不到（空、没有斜杠、形状不对）就回空串——空仓库不产事件。 */
export function normalizeRepoKey(v: unknown): string {
  let owner = ''
  let name = ''
  if (v && typeof v === 'object') {
    const bag = v as Record<string, unknown>
    owner = typeof bag.owner === 'string' ? bag.owner : ''
    name = typeof bag.name === 'string' ? bag.name : ''
  } else if (typeof v === 'string') {
    const parts = v.trim().split('/')
    owner = parts[0] || ''
    name = parts[1] || ''
  }
  const clean = (x: string): string => x.trim().replace(/[\s/]+/g, '')
  owner = clean(owner)
  name = clean(name)
  return owner && name ? owner + '/' + name : ''
}

/** 事件身份：三要素拼成稳定字符串。恢复配对不靠相邻顺序，靠这个身份与 endedAt。 */
export function eventIdOf(repo: string, type: NotificationEventType, startedAt: number): string {
  return String(repo) + '|' + String(type) + '|' + String(startedAt)
}

/** 文本收成一行、去首尾空白、按上限截断；空值回空串。 */
export function clipNotificationText(v: unknown, max?: number): string {
  const limit = typeof max === 'number' && max > 0 ? Math.floor(max) : NOTIFICATION_EVENT_MAX_TEXT
  const text = v == null ? '' : String(v)
  return text.replace(/\s+/g, ' ').trim().slice(0, limit)
}

/** 历史里「未闭合且开始时刻最晚」的降级开始；没有就 null。 */
export function openDegradedStartOf(events: readonly NotificationEvent[]): NotificationEvent | null {
  let found: NotificationEvent | null = null
  for (const ev of events) {
    if (ev.type !== 'degraded-start' || ev.endedAt !== null) continue
    if (!found || ev.startedAt > found.startedAt) found = ev
  }
  return found
}

/** 只看这个仓库自己的事件：恢复不能配到别人仓库的降级开始（身份含仓库，跨仓库不配）。 */
function eventsInRepo(events: readonly NotificationEvent[], repo: string): NotificationEvent[] {
  return events.filter((ev) => ev.repo === repo)
}

/** 事件代码：机器码（默认与类型同名），只留 ASCII 安全字符、截到 60 字；界面按它选词条。 */
export function notificationCodeOf(v: unknown, type: NotificationEventType): string {
  const text = clipNotificationText(v, 60).replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '')
  return text || String(type)
}

/** 事件参数只留标量：字符串裁到 80 字、数字与布尔转字符串，其余丢弃；最多 6 个键（不落长原文）。 */
export function sanitizeNotificationParams(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object') return out
  const bag = v as Record<string, unknown>
  for (const key of Object.keys(bag)) {
    if (Object.keys(out).length >= 6) break
    const raw = bag[key]
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue
    const text = clipNotificationText(raw, 80)
    if (text) out[key] = text
  }
  return out
}

/** 造一条新事件。id 由身份三要素算出来，不另起随机数（重启后同一段降级仍是同一个身份）。 */
function newEvent(input: EventInput, type: NotificationEventType): NotificationEvent {
  const now = Math.floor(input.now)
  return {
    id: eventIdOf(input.repo, type, now),
    type: type,
    repo: input.repo,
    startedAt: now,
    endedAt: type === 'degraded-start' ? null : now,
    count: 1,
    code: notificationCodeOf(input.code, type),
    params: sanitizeNotificationParams(input.params),
    updatedAt: now,
  }
}

/** 降级开始：已有一条未闭合的就原地不动（同一段降级只有一个开始）。 */
export function appendDegradedStart(events: readonly NotificationEvent[], input: EventInput): NotificationEvent[] {
  if (openDegradedStartOf(eventsInRepo(events, input.repo))) return events.slice()
  return events.concat([newEvent(input, 'degraded-start')])
}

/**
 * 降级恢复：只配「未闭合且开始时刻最晚」的那一条；把它的 endedAt 写成恢复时刻，再另记一条恢复事件
 * （恢复事件自己的 startedAt 与那条开始的 endedAt 相等，这就是配对证据）。没有未闭合的开始就不伪造。
 */
export function appendDegradedRecovery(events: readonly NotificationEvent[], input: EventInput): NotificationEvent[] {
  const open = openDegradedStartOf(eventsInRepo(events, input.repo))
  if (!open) return events.slice()
  const now = Math.floor(input.now)
  const closed = events.map((ev) => (ev.id === open.id ? Object.assign({}, ev, { endedAt: now, updatedAt: now }) : ev))
  const recovery = newEvent(input, 'degraded-recovery')
  recovery.startedAt = now
  recovery.endedAt = now
  return closed.concat([recovery])
}

/**
 * 瞬时事件（刷新失败、写失败）：去重窗内同仓库同类型的重复出现并入上一条——次数加一、更新
 * 最后时刻，开始时刻保留首次的（身份不变）。窗外的记为一条新事件。
 */
export function appendInstant(events: readonly NotificationEvent[], input: InstantInput): NotificationEvent[] {
  const now = Math.floor(input.now)
  const windowMs = Math.max(0, Math.floor(input.dedupeMs || 0))
  const last = events.filter((ev) => ev.type === input.type && ev.repo === input.repo).slice(-1)[0]
  if (last && now - last.updatedAt < windowMs) {
    const merged = Object.assign({}, last, { count: last.count + 1, updatedAt: now })
    return events.map((ev) => (ev.id === last.id ? merged : ev))
  }
  return events.concat([newEvent(input, input.type)])
}

/**
 * 清理只清历史：先按保留期删已闭合事件（按最后时刻算年龄），再按条数上限从最旧的已闭合事件删，
 * 让未闭合的降级开始永远留下来。全部是未闭合事件时宁肯超上限也不删——恢复配对比条数上限重要。
 */
export function pruneNotificationEvents(
  events: readonly NotificationEvent[],
  opts: { now: number; retentionMs: number; maxEvents: number },
): NotificationEvent[] {
  const now = Math.floor(opts.now)
  const keep = events.filter((ev) => ev.endedAt === null || now - ev.updatedAt <= Math.max(0, Math.floor(opts.retentionMs)))
  const cap = Math.max(0, Math.floor(opts.maxEvents))
  const out = keep.slice()
  while (out.length > cap) {
    let oldest = -1
    for (let i = 0; i < out.length; i += 1) {
      if (out[i].endedAt === null) continue
      if (oldest < 0 || out[i].updatedAt < out[oldest].updatedAt) oldest = i
    }
    if (oldest < 0) break
    out.splice(oldest, 1)
  }
  return out
}

/** 一条读回来的事件是不是本仓库的合法事件；不合法整条丢弃，不让坏数据污染历史。 */
function isFileEvent(v: unknown, repo: string): v is Record<string, unknown> {
  if (!v || typeof v !== 'object') return false
  const ev = v as Record<string, unknown>
  if (!isNotificationEventType(ev.type)) return false
  if (normalizeRepoKey(ev.repo) !== repo) return false
  if (typeof ev.startedAt !== 'number' || !isFinite(ev.startedAt)) return false
  if (ev.endedAt !== null && (typeof ev.endedAt !== 'number' || !isFinite(ev.endedAt))) return false
  if (typeof ev.count !== 'number' || !isFinite(ev.count) || ev.count < 1) return false
  if (typeof ev.updatedAt !== 'number' || !isFinite(ev.updatedAt)) return false
  return true
}

/** 读回一份事件文件：版本不认识、结构不对、坏条目一律当空历史或丢弃，绝不崩。 */
export function parseNotificationEventFile(raw: unknown, repo: string): NotificationEvent[] {
  if (!raw || typeof raw !== 'object') return []
  const file = raw as Record<string, unknown>
  if (file.schema !== NOTIFICATION_EVENT_SCHEMA) return []
  if (normalizeRepoKey(file.repo) !== repo) return []
  if (!Array.isArray(file.events)) return []
  const out: NotificationEvent[] = []
  for (const rawItem of file.events) {
    if (!isFileEvent(rawItem, repo)) continue
    const item = rawItem as Record<string, unknown>
    const type = item.type as NotificationEventType
    const kept: NotificationEvent = {
      id: typeof item.id === 'string' && item.id ? item.id : eventIdOf(repo, type, Number(item.startedAt)),
      type: type,
      repo: repo,
      startedAt: Math.floor(Number(item.startedAt)),
      endedAt: item.endedAt === null ? null : Math.floor(Number(item.endedAt)),
      count: Math.max(1, Math.floor(Number(item.count))),
      code: notificationCodeOf(item.code, type),
      params: sanitizeNotificationParams(item.params),
      updatedAt: Math.floor(Number(item.updatedAt)),
    }
    // 旧文件里的 summary/detail 是当年落下的界面文案：读回来兼容，但不作为新事件的正文形状。
    if (typeof item.summary === 'string') kept.summary = clipNotificationText(item.summary)
    if (typeof item.detail === 'string') kept.detail = clipNotificationText(item.detail)
    out.push(kept)
  }
  return out
}

/** 组装落盘文件（版本、仓库、事件、写入时刻）。 */
export function buildNotificationEventFile(repo: string, events: readonly NotificationEvent[], writtenAtMs: number): NotificationEventFile {
  return { schema: NOTIFICATION_EVENT_SCHEMA, repo: repo, events: events.slice(), writtenAtMs: Math.floor(writtenAtMs) }
}

/**
 * 当前是否降级：只从快照派生（与探测、面板同一个判据）。事件库只提供「历史里有没有未闭合的开始」，
 * 两者对不上时如实标 historyMismatch，让读取方按快照走、并把不一致当成诊断信号。
 */
export function currentDegradedOf(snapshot: unknown, events: readonly NotificationEvent[]): CurrentDegradedView {
  const open = openDegradedStartOf(events)
  const degraded = fallbackStandingOf(snapshot)
  return { degraded: degraded, openStartedAt: open ? open.startedAt : null, historyMismatch: degraded !== (open !== null) }
}
