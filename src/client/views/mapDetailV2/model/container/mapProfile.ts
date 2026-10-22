/**
 * views/mapDetailV2/model/container/mapProfile.ts —— MAP 自身内容的刻画：标题、目的地、完成度与「子票那句」。
 *
 * 为什么单独一份：地图详情页里除了子票卡片，还有一块「这张地图本身是什么」的内容——标题、
 * ## Destination 那句、已关闭占比，以及「子票取回来了几张」的那句说明。以前这些散在
 * views/MapDetail.ts、views/MapDetailHead.ts 里，一半是取值、一半是判断，页面只能整块照着搬。
 * V2 把判断收进这份纯函数，页面只管按结果画。
 *
 * 2026-10-23 维护者定：地图页不再展示正文详情（笔记 / 已定决策 / 战雾 / 范围外 / 规格七段），
 * 点标题进 issue 详情页看这张图自己的完整信息。所以本文件不再解析或整理正文分节，
 * 只留下页面还画的三样：标题、目的地、计数与完成度。身份小签与编号也由顶栏交代，页内不重复。
 *
 * 两类容器（维护者 2026-10-22 定：规格与探索地图没有本质区别，顶多个别标签不一样）：
 * 差别只在「子票那句」的计数词（map.subCount / map.specSubCount）与规格没有目的地时不画空态提示，
 * 页面不写 if (spec)。
 *
 * 数据从哪来：正文由宿主 src/tracker/body-parse.ts 解析好放进快照（MapRowContent 的 destination），
 * 子票取数状态由 ticketFeed.ts 判完交进来。所以这份不发请求、不读 DOM、不认语言，
 * 门禁可以拿夹具把每一种容器、每一种状态都走一遍。
 *
 * 与老页对齐的口径（views/MapDetailHead.ts:37-67）：取数成功用取回那份的 stats，否则退回快照的
 * stats（ticketFeedOf 已合成好，这里直接用 feed.stats）；后端明确回 unsupported 时一个字都不加；
 * 失败原因截到 120 字；被截断（capped）与差额（missing）各补一段。
 */
import type {
  ContainerKind,
  MapProfile,
  MapProfileFeedSegment,
  MapRowContent,
  TicketBoardCounts,
  TicketFeed,
} from '../contracts/mapDetailTypes'

/** 宿主一次最多取回的子票张数；capped 时老页就是按这个数说「只加载了前 1000 张」。 */
export const MAP_PROFILE_CAPPED_LIMIT = 1000

/** 取数中还不知道的总数、已完成数用这个短横占位，与档案区计数行用的是同一个符号。
 *  它让「子票那句」在取数中仍然是一句完整的话（本图 – 张子票（已关闭 – 张）），
 *  不会留出一行空白（维护者 2026-10-23 第三次反馈：原来那句话删掉后那里空了一行）。 */
const FEED_PLACEHOLDER = '–'

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

/**
 * 「子票那句」由哪几段拼成。老页是一句 tr() 拼好的字符串，V2 给段：页面按词条拼，
 * 换语言、改词条都不用来改这份判断。计数词按容器种类选（地图 map.subCount / 规格 map.specSubCount）。
 *  - loading：仍说「本图 N 张子票（已关闭 C 张）」这一句，但数字用短横占位（维护者 2026-10-23：
 *    不要再写「正在取子票」那一行；删掉后那里空了一行，所以保留这句话、只把未知数字换成占位）。
 *    快照 stats 已经说了张数时直接说真数；「正在取数」由页面进度条上的流动斜纹表达；
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
  if (f.state === 'loading') {
    // 快照 stats 已经知道张数时就说真数（取回后不会换字，页面不闪）；不知道才用短横占位。
    // 这里不返回空段：空段会让档案区空出一整行（维护者 2026-10-23 反馈）。
    const stats = f.stats || {}
    const total = integerOf(stats.total)
    const countKey = MAP_PROFILE_COUNT_KEY[kind || 'map']
    if (total !== null && total > 0) {
      const closed = integerOf(stats.closed) !== null ? (integerOf(stats.closed) as number) : 0
      return [{ key: countKey, params: { n: total, c: closed } }]
    }
    return [{ key: countKey, params: { n: FEED_PLACEHOLDER, c: FEED_PLACEHOLDER } }]
  }
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
  return {
    kind,
    title: textOf(row.title),
    destination,
    hasDestination: destination.length > 0,
    counts: counts || { total: 0, closed: 0, ready: 0, doing: 0, blocked: 0 },
    progressPercent: mapProgressPercentOf(counts),
    feedSegments: mapFeedSegmentsOf(feed, kind),
    errorText: mapErrorTextOf(row),
  }
}
