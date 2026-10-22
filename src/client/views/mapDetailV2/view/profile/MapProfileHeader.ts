/**
 * views/mapDetailV2/view/profile/MapProfileHeader.ts —— 地图档案区：MAP 自己的内容怎么展示。
 *
 * 维护者 2026-10-23 定的两件事：
 *   1) 地图页不再展示「正文详情 / 已定决策 / 战雾 / 范围外」这些长内容，点标题进 issue 详情页，
 *      看这张地图自己的完整 issue 正文与评论（以后打磨 issue 详情页即可，地图页保持紧凑）；
 *   2) 页内不再重复「地图 / 规格 + 编号」这一行：顶栏的面包屑与身份小签已经写着同一个编号。
 *
 * 所以这一块从上到下只剩四样：标题（可点进档案）→ 目的地一句话 → 四枚计数 →
 * 「进度条 + 子票那句」同一行 → 地图行自带的错误。它替代老页的 MapDetailHead 与三块正文折叠。
 *
 * 为什么这些值全从 profile 拿：档案里每个数字与每句文案的口径都在 model/container/mapProfile.ts 里定死
 * （与老页 views/MapDetailHead.ts 的取数口径对齐），这一层只做排版。
 *
 * 取数中的样子（维护者 2026-10-23 四次反馈后定）：不写「正在取子票」、不空出一行，计数与百分比写短横占位，
 * 进度条轨道上画流动斜纹（页面对 busy 打 data-busy，样式负责动画，尊重 prefers-reduced-motion 时停掉动画）；
 * 「子票那句」仍说同一句话、未知数字用占位，取到后原地换数字。没有子票时整块 visibility:hidden，位置留着。
 */
import type { MapProfile, TicketFeed } from '../../model/contracts/mapDetailTypes'

declare function Ic(props?: any): any
declare function mdToHtml(...args: any[]): any

/** 四枚计数：顺序固定为 可接 → 已认领 → 被阻塞 → 已关闭（与卡片流「在办 → 可接 → 被挡 → 已完成」不是一回事，
 *  这里是「现在各有多少张」，按票的三个活状态加一个终态排，好扫）。 */
const COUNT_CHIPS: { status: string; labelKey: string }[] = [
  { status: 'ready', labelKey: 'map.grpTakeable' },
  { status: 'doing', labelKey: 'map.grpClaimed' },
  { status: 'blocked', labelKey: 'map.grpBlocked' },
  { status: 'closed', labelKey: 'map.grpClosed' },
]

/** 取数占位用的短横：中文词条里是「可接 {n}」「地图进度 {n}%」这样的句子，填进去不会变成空白。 */
const PLACEHOLDER = '–'

/**
 * 完成度一行：左边「地图进度」，中间细条，右边百分比；「子票那句」挂在百分比后面，同排。
 * 维护者 2026-10-23 第三次反馈：不要再给那句话单独留一行，所以它现在是这一行里的一个 span。
 * 取数中总张数还不知道时，轨道留空、百分比写「–」、整行打 data-busy——「正在取数」由轨道上的
 * 流动斜纹表达；那句仍是同一句话、数字换成短横占位，宽度与取到后接近，不会因为换字而突然折行。
 */
function progressNode(h: any, profile: MapProfile, feed: TicketFeed | null, busy: boolean): any {
  const total = profile.counts ? profile.counts.total : 0
  const known = total > 0
  const percent = known ? profile.progressPercent : 0
  const segments = profile.feedSegments || []
  const feedText = segments.map(function (segment: any) {
    return tr(segment.key, segment.params || {})
  }).join(' · ')
  return h('div', {
    key: 'prog',
    className: 'm2v2-prog',
    'data-busy': busy && !known ? '1' : '0',
  }, [
    h('span', { key: 'cap', className: 'm2v2-prog-cap' }, tr('map.progressCap')),
    h('div', { key: 'track', className: 'm2v2-track' },
      h('div', { className: 'm2v2-fill', style: { width: percent + '%' } })),
    h('span', { key: 'num', className: 'm2v2-prog-num' }, known ? (percent + '%') : (busy ? PLACEHOLDER : '0%')),
    h('span', {
      key: 'feed',
      className: 'm2v2-feed',
      'data-state': feed ? String(feed.state || '') : '',
      title: feedText,
    }, feedText),
  ])
}

/**
 * 标题：页面上唯一进入「地图档案」的入口。
 * 为什么整块标题都能点：维护者 2026-10-23 定「点 card 直接进 issue 详情页，只不过是这个 map 的信息」，
 * 页面上没有别的地图身份卡，标题就是这张图自己的名片；再放一颗独立按钮会多占一行。
 * 末尾那个「档案」小签是可见线索，免得用户不知道标题能点。键盘 Enter / 空格与点击同效。
 */
function titleNode(h: any, profile: MapProfile, onOpenArchive: (() => void) | null): any {
  const title = profile.title || ''
  if (!onOpenArchive) return h('h1', { key: 'title', className: 'm2v2-title' }, title)
  const activate = function () { onOpenArchive() }
  return h('h1', {
    key: 'title',
    className: 'm2v2-title m2v2-title-link',
    role: 'button',
    tabIndex: 0,
    title: tr('map.archive'),
    'data-press': 'row',
    'data-log': 'mapv2.archive.open',
    onClick: activate,
    onKeyDown: function (e: any) {
      if (!e || e.target !== e.currentTarget) return
      const k = e && e.key
      if (k === 'Enter' || k === ' ') {
        try { if (e.preventDefault) e.preventDefault() } catch (err) {}
        activate()
      }
    },
  }, [
    h('span', { key: 'txt', className: 'm2v2-title-txt' }, title),
    h('span', { key: 'go', className: 'm2v2-title-go', 'aria-hidden': '1' }, tr('map.archive') + ' ›'),
  ])
}

/**
 * 画档案区。props: { st, profile: MapProfile, feed: TicketFeed | null, busy: boolean, onOpenArchive }。
 * st 只为目的地的 markdown 渲染（mdToHtml 需要它认仓库路径与图片）；
 * busy 表示「正在按需取子票」（页面传进来，取数敲门与回来之间为真）；
 * onOpenArchive 是点标题后的动作（页面压入这张地图自己的 issue 详情页）。
 */
export function MapProfileHeader(props: any): any {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = props && props.st
  const profile: MapProfile = props && props.profile
  const feed: TicketFeed | null = (props && props.feed) || null
  const busy: boolean = !!(props && props.busy)
  const onOpenArchive = (props && typeof props.onOpenArchive === 'function') ? props.onOpenArchive : null
  if (!profile) return null

  const counts = profile.counts || { total: 0, closed: 0, ready: 0, doing: 0, blocked: 0 }
  const unknownCounts = busy && !(counts.total > 0)
  // 计数行永远画出来（取数中写占位短横）：它出现/消失会改变档案区高度，卡片就会跟着上下跳。
  const countsNode = h('div', { key: 'counts', className: 'm2v2-counts' }, COUNT_CHIPS.map(function (chip: { status: string; labelKey: string }) {
    const n = (counts as any)[chip.status] || 0
    return h('span', {
      key: chip.status,
      className: 'm2v2-count',
      'data-status': chip.status,
    }, tr(chip.labelKey, { n: unknownCounts ? PLACEHOLDER : n }))
  }))
  // 取数成功且确实一张子票都没有时，这两行一起用 visibility 藏起来：文字不重复出现（「本图 0 张子票」
  // 交给卡片流的空态说一次），但位置留着，卡片不会因为这块消失而往上跳。
  const quietEmpty = !busy && !!(feed && feed.state === 'ready' && counts.total === 0)
  const metaNode = h('div', {
    key: 'meta',
    className: 'm2v2-meta',
    'data-empty': quietEmpty ? '1' : '0',
    'aria-busy': busy ? 'true' : 'false',
  }, [
    countsNode,
    progressNode(h, profile, feed, busy),
  ])

  const destination = profile.hasDestination
    ? h('div', { key: 'dest', className: 'm2v2-dest' }, [
      h('span', { key: 'ic', className: 'm2v2-dest-ic' }, Ic({ n: 'target', size: 12 })),
      h('div', { key: 'txt', style: { flex: 1, minWidth: 0 } },
        (typeof mdToHtml === 'function' ? mdToHtml(profile.destination, { st: st }) : profile.destination)),
    ])
    // 规格没有「目的地」这一节（规格正文是问题、方案、用户故事、实现决策那些），所以不画「未填写」的样子：
    // 探索地图缺目的地时仍要提示一句，让写图的人知道这格该填。
    : (profile.kind === 'spec'
      ? null
      : h('div', { key: 'dest', className: 'm2v2-dest m2v2-dest-empty' }, [
        h('span', { key: 'ic', className: 'm2v2-dest-ic' }, Ic({ n: 'target', size: 12 })),
        h('span', { key: 'txt' }, tr('list.noDest')),
      ]))

  return h('section', { className: 'm2v2-profile' }, [
    titleNode(h, profile, onOpenArchive),
    destination,
    metaNode,
    profile.errorText
      ? h('div', { key: 'err', className: 'm2v2-err' }, [
        h('span', { key: 'ic' }, Ic({ n: 'alert', size: 12 })),
        h('span', { key: 'txt' }, profile.errorText),
      ])
      : null,
  ])
}
