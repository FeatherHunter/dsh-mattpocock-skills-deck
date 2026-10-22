/**
 * views/mapDetailV2/model/container/mapProfile.ts —— MAP 自身内容的刻画：身份、目的地、档案区、完成度与「子票那句」。
 *
 * 为什么单独一份：地图详情页里除了子票卡片，还有一块「这张地图本身是什么」的内容——
 * 标题、## Destination 那句、档案区（探索地图是笔记 / 已定决策 / 战雾 / 范围外四节，
 * 规格是问题陈述 / 解决方案 / 用户故事 / 实现决策 / 测试决策 / 范围外 / 补充说明七节）、
 * 已关闭占比，以及「子票取回来了几张」的那句说明。这些东西以前散在 views/MapDetail.ts、
 * views/MapDetailHead.ts、views/MapDetailSpecBody.ts 里，一半是取值、一半是判断，页面只能整块照着搬。
 * V2 把判断收进这份纯函数，页面只管按结果画。
 *
 * 两类容器（维护者 2026-10-22 定：规格与探索地图没有本质区别，顶多个别标签不一样）：
 *   - 探索地图（map）：身份小签 list.mapChip、计数词 map.subCount、档案四节；
 *   - 规格/实施地图（spec）：身份小签 list.specChip、计数词 map.specSubCount、档案七节。
 *   页面上是同一副骨架，所以这一份用 kind 把差别收在两个常量表里，页面不写 if (spec)。
 *
 * 数据从哪来：正文区由宿主 src/tracker/body-parse.ts 解析好放进快照（MapRowContent 的
 * destination / notes / decisions / fog / outOfScope 与 sections），客户端不重复解析正文；
 * 子票取数状态由 ticketFeed.ts 判完交进来。所以这份不发请求、不读 DOM、不认语言，
 * 门禁可以拿夹具把每一种容器、每一种状态都走一遍。
 *
 * 与老页对齐的口径（views/MapDetailHead.ts:37-67）：取数成功用取回那份的 stats，否则退回快照的
 * stats（ticketFeedOf 已合成好，这里直接用 feed.stats）；后端明确回 unsupported 时一个字都不加；
 * 失败原因截到 120 字；被截断（capped）与差额（missing）各补一段。
 */
import type {
  ContainerKind,
  MapDecision,
  MapProfile,
  MapProfileFeedSegment,
  MapProfileItem,
  MapProfileSection,
  MapProfileSectionId,
  MapRowContent,
  SpecSections,
  TicketBoardCounts,
  TicketFeed,
} from '../contracts/mapDetailTypes'

/** 宿主一次最多取回的子票张数；capped 时老页就是按这个数说「只加载了前 1000 张」。 */
export const MAP_PROFILE_CAPPED_LIMIT = 1000

/** 探索地图的档案四节：顺序即页面上的顺序，词条沿用老页 map.decisions 等键（zh/en 都在 config/copy/flow.yaml）。 */
export const MAP_PROFILE_SECTIONS: ReadonlyArray<{ id: MapProfileSectionId; labelKey: string }> = [
  { id: 'notes', labelKey: 'map.notesCap' },
  { id: 'decisions', labelKey: 'map.decisions' },
  { id: 'fog', labelKey: 'map.fog' },
  { id: 'outOfScope', labelKey: 'map.outOfScope' },
]

/** 规格的档案七节：段名与宿主 parseSpecBody 的七个字段一一对应（词条在 config/copy/spec.yaml）。 */
export const SPEC_PROFILE_SECTIONS: ReadonlyArray<{ id: MapProfileSectionId; labelKey: string }> = [
  { id: 'problem', labelKey: 'spec.section.problem' },
  { id: 'solution', labelKey: 'spec.section.solution' },
  { id: 'userStories', labelKey: 'spec.section.userStories' },
  { id: 'implDecisions', labelKey: 'spec.section.implDecisions' },
  { id: 'testDecisions', labelKey: 'spec.section.testDecisions' },
  { id: 'outOfScope', labelKey: 'spec.section.outOfScope' },
  { id: 'notes', labelKey: 'spec.section.notes' },
]

/** 两种容器的身份小签词条键（与 src/client/kernel/container-view.ts 的 CONTAINER_CHIP_LABEL_KEY 同值）。
 *  名字前面加 MAP_PROFILE_ 是为了拼进客户端闭包时不给内核同名常量撞车（闭包里所有片段同处一个函数作用域）。 */
const MAP_PROFILE_CHIP_LABEL_KEY: Record<ContainerKind, string> = {
  map: 'list.mapChip',
  spec: 'list.specChip',
}

/** 两种容器的「子票那句」开头用的词条键（与 containerCountKey 同值）。 */
const MAP_PROFILE_COUNT_KEY: Record<ContainerKind, string> = {
  map: 'map.subCount',
  spec: 'map.specSubCount',
}

/** 读成一段干净的文字：给的不是字符串就当空串（不做类型猜测）。 */
function textOf(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 读成整数：给的不是有限数字就是 null，不把 '12abc' 这种脏值猜成 12。 */
function integerOf(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

/**
 * 这是哪一种容器：以快照行的 type 为准（宿主 snapshotAssemble 已把两种容器归一并放进同一个 maps 数组）。
 * 认不出的一律当探索地图——V2 页面的老入口本来就是地图详情页，宁可按地图画也不要把地图画成规格。
 */
export function containerKindOfRow(m: MapRowContent | null | undefined): ContainerKind {
  return m && String(m.type || '') === 'spec' ? 'spec' : 'map'
}

/**
 * 地图编号：快照行的 number 优先，其次看 key（工作区里 key 可能就是编号字符串）。
 * 两处都取不到就是 null——此时身份文本是空串，页面不该编一个编号出来。
 */
export function mapNumberOf(m: MapRowContent | null | undefined): number | null {
  if (!m) return null
  const fromNumber = integerOf(m.number)
  if (fromNumber !== null) return fromNumber
  return integerOf(m.key as number | string | null | undefined)
}

/** 身份文本，形如 '#1314'；编号取不到时是空串。 */
export function mapNoTextOf(m: MapRowContent | null | undefined): string {
  const n = mapNumberOf(m)
  return n === null ? '' : '#' + n
}

/**
 * 完成度百分比：按已完成的张数算（不按层、不按可接数），四舍五入取整。
 * 一张子票都没有时是 0——空地图画满一条进度条会骗人。
 */
export function mapProgressPercentOf(counts: TicketBoardCounts | null | undefined): number {
  const c = counts || { total: 0, closed: 0, ready: 0, doing: 0, blocked: 0 }
  if (!(c.total > 0)) return 0
  const pct = Math.round((c.closed / c.total) * 100)
  if (pct < 0) return 0
  return pct > 100 ? 100 : pct
}

/** 一条决策当成一行字：标题 + 破折号 + 那句话；有链接就带上（链接不给页面拼，原样带）。 */
function decisionItemOf(d: MapDecision | null | undefined): MapProfileItem | null {
  if (!d) return null
  const title = textOf(d.title)
  const gist = textOf(d.gist)
  if (!title && !gist) return null
  const text = title && gist ? title + ' — ' + gist : title || gist
  const url = textOf(d.url)
  return url ? { text, url } : { text }
}

/** 一串文字条目：空行、非字符串一律丢掉，不画空条目。 */
function textItemsOf(list: Array<string | null | undefined> | null | undefined): MapProfileItem[] {
  if (!Array.isArray(list)) return []
  const items: MapProfileItem[] = []
  for (let i = 0; i < list.length; i++) {
    const t = textOf(list[i])
    if (t) items.push({ text: t })
  }
  return items
}

/** 一整段话算一条：空段（只有空白）当没有这一条，页面据此不画空小节。 */
function paragraphItemsOf(value: string | null | undefined): MapProfileItem[] {
  const t = textOf(value)
  return t ? [{ text: t }] : []
}

/** 规格七段里的「清单型」字段：问题陈述与解决方案是整段话，其余四段是字符串数组。 */
function specItemsOf(sections: SpecSections, id: MapProfileSectionId): MapProfileItem[] {
  if (id === 'problem') return paragraphItemsOf(sections.problem)
  if (id === 'solution') return paragraphItemsOf(sections.solution)
  if (id === 'userStories') return textItemsOf(sections.userStories)
  if (id === 'implDecisions') return textItemsOf(sections.implDecisions)
  if (id === 'testDecisions') return textItemsOf(sections.testDecisions)
  if (id === 'notes') return textItemsOf(sections.furtherNotes)
  return textItemsOf(sections.outOfScope)
}

/**
 * 档案区：探索地图四节、规格七节，每节都给出 id / 词条键 / 条数 / 条目。
 * 页面按 id 决定怎么画（笔记与问题陈述是段落、决策带链接、其余是清单）。
 * 没有内容的节也保留（count 为 0），由页面决定收起还是画空态。
 */
export function mapProfileSectionsOf(
  m: MapRowContent | null | undefined,
  kind?: ContainerKind,
): MapProfileSection[] {
  const row = m || {}
  const which: ContainerKind = kind || containerKindOfRow(row)
  const sections: MapProfileSection[] = []

  if (which === 'spec') {
    const spec: SpecSections = (row.sections && typeof row.sections === 'object') ? row.sections : {}
    for (let i = 0; i < SPEC_PROFILE_SECTIONS.length; i++) {
      const def = SPEC_PROFILE_SECTIONS[i]
      const items = specItemsOf(spec, def.id)
      sections.push({ id: def.id, labelKey: def.labelKey, count: items.length, items })
    }
    return sections
  }

  const notes = textOf(row.notes)
  for (let i = 0; i < MAP_PROFILE_SECTIONS.length; i++) {
    const def = MAP_PROFILE_SECTIONS[i]
    let items: MapProfileItem[]
    if (def.id === 'notes') {
      items = notes ? [{ text: notes }] : []
    } else if (def.id === 'decisions') {
      items = []
      const list = Array.isArray(row.decisions) ? row.decisions : []
      for (let j = 0; j < list.length; j++) {
        const item = decisionItemOf(list[j])
        if (item) items.push(item)
      }
    } else if (def.id === 'fog') {
      items = textItemsOf(row.fog)
    } else {
      items = textItemsOf(row.outOfScope)
    }
    sections.push({ id: def.id, labelKey: def.labelKey, count: items.length, items })
  }
  return sections
}

/**
 * 「子票那句」由哪几段拼成。老页是一句 tr() 拼好的字符串，V2 给段：页面按词条拼，
 * 换语言、改词条都不用来改这份判断。计数词按容器种类选（地图 map.subCount / 规格 map.specSubCount）。
 *  - loading：只说正在取（不说 0 张）；
 *  - unsupported：一个字都不加；
 *  - failed：说原因（已截 120 字）；
 *  - 其它：本图 N 张子票（已关闭 C 张）＋ capped / missing 两段补充。
 */
export function mapFeedSegmentsOf(
  feed: TicketFeed | null | undefined,
  kind?: ContainerKind,
): MapProfileFeedSegment[] {
  const f = feed || null
  if (!f) return []
  if (f.state === 'loading') return [{ key: 'map.subCountLoading' }]
  if (f.state === 'unsupported') return []
  if (f.state === 'failed') return [{ key: 'map.subCountFail', params: { msg: f.failedMessage || '' } }]

  const stats = f.stats || {}
  const n = integerOf(stats.total) !== null ? (integerOf(stats.total) as number) : f.rows.length
  const c = integerOf(stats.closed) !== null ? (integerOf(stats.closed) as number) : 0
  const countKey = MAP_PROFILE_COUNT_KEY[kind || 'map']
  const segments: MapProfileFeedSegment[] = [{ key: countKey, params: { n, c } }]
  if (f.capped) segments.push({ key: 'map.subCountCapped', params: { n: MAP_PROFILE_CAPPED_LIMIT } })
  if (f.missing > 0) segments.push({ key: 'map.subCountShort', params: { n: f.missing } })
  return segments
}

/**
 * 快照错误的一句话（页面画成红字）。截到 160 字：这类错误常带后端原始回包，
 * 全画出来会把页面撑成一堵墙，只留够定位的那一截。
 */
export function mapErrorTextOf(m: MapRowContent | null | undefined): string {
  if (!m || !m.error) return ''
  const raw = typeof m.error === 'string' ? m.error : m.error.error
  return textOf(raw as string | null | undefined).slice(0, 160)
}

/**
 * 合成 MAP 自身内容。m 是快照里的地图行（或规格行），feed 是子票取数结果，
 * counts 是看板计数（由 ticketBoard.boardCountsOf 算，页面已有一份，所以传进来而不是在这里重算）。
 */
export function mapProfileOf(
  m: MapRowContent | null | undefined,
  feed: TicketFeed | null | undefined,
  counts: TicketBoardCounts | null | undefined,
): MapProfile {
  const row = m || {}
  const kind = containerKindOfRow(row)
  const destination = textOf(row.destination)
  const sections = mapProfileSectionsOf(row, kind)
  return {
    kind,
    chipLabelKey: MAP_PROFILE_CHIP_LABEL_KEY[kind],
    noText: mapNoTextOf(row),
    title: textOf(row.title),
    destination,
    hasDestination: destination.length > 0,
    counts: counts || { total: 0, closed: 0, ready: 0, doing: 0, blocked: 0 },
    progressPercent: mapProgressPercentOf(counts),
    feedSegments: mapFeedSegmentsOf(feed, kind),
    sections,
    hasSections: sections.some(function (s) { return s.count > 0 }),
    errorText: mapErrorTextOf(row),
  }
}