/**
 * views/mapDetailV2/view/profile/MapProfileHeader.ts —— 地图档案区：MAP 自己的内容怎么展示。
 *
 * 维护者 2026-10-23 定的两件事：
 *   1) 地图页不再展示「正文详情 / 已定决策 / 战雾 / 范围外」这些长内容，点标题进 issue 详情页，
 *      看这张地图自己的完整 issue 正文与评论（以后打磨 issue 详情页即可，地图页保持紧凑）；
 *   2) 页内不再重复「地图 / 规格 + 编号」这一行：顶栏的面包屑与身份小签已经写着同一个编号。
 *
 * 所以这一块从上到下只剩四样：标题（整块档案都能点进 issue 详情页）→ 目的地一句话 → 四枚计数 →
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
 * 标题：整块档案里最显眼的一行，但它自己不再单独接点按——入口是整块档案（见下面的 section），
 * 这样鼠标不用精确落在这一行字上，档案区里任何空白处都能点进 issue 详情页。末尾那枚「档案」小签
 * 仍然只画在标题里，作为「这里能点」的可见线索。
 */
function titleNode(h: any, profile: MapProfile, openable: boolean): any {
  const title = profile.title || ''
  return h('h1', { key: 'title', className: 'm2v2-title' }, [
    h('span', { key: 'txt', className: 'm2v2-title-txt' }, title),
    openable
      ? h('span', { key: 'go', className: 'm2v2-title-go', 'aria-hidden': '1' }, tr('map.archive') + ' ›')
      : null,
  ])
}

/**
 * 档案区内部的链接与图片有自己的动作（仓库路径、附件图），点它们时不能顺带把整块档案也打开。
 * 只在事件路上判断，不改这些元素本身：有 closest 就用它，没有就按「不是链接」处理。
 */
function insideOwnControl(e: any): boolean {
  const target = e && e.target
  if (!target || typeof target.closest !== 'function') return false
  try { return !!target.closest('a,button,img') } catch (err) { return false }
}

/**
 * 画档案区。props: { st, profile: MapProfile, feed: TicketFeed | null, busy: boolean, onOpenArchive }。
 * st 只为目的地的 markdown 渲染（mdToHtml 需要它认仓库路径与图片）；
 * busy 表示「正在按需取子票」（页面传进来，取数敲门与回来之间为真）；
 * onOpenArchive 是点整块档案后的动作（页面压入这张地图自己的 issue 详情页）；
 * 整块可点时键盘 Enter / 空格与点击同效，档案区里的链接与图片仍然各管各的。
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

  // 维护者 2026-10-23：能点进详情页的区域太小（只有标题一行），改成整块档案都能点。
  // 档案区里没有别的按钮，四个计数与进度条只是文字与色块，所以整块做成一个可点区域不会抢谁的交互；
  // 唯一要躲开的是目的地里可能出现的链接与附件图（它们自己带动作），见 insideOwnControl。
  const openable = !!onOpenArchive
  const sectionProps: any = {
    className: 'm2v2-profile' + (openable ? ' m2v2-profile-link' : ''),
  }
  if (openable) {
    Object.assign(sectionProps, {
      role: 'button',
      tabIndex: 0,
      title: tr('map.archive'),
      'data-press': 'row',
      'data-log': 'mapv2.archive.open',
      onClick: function (e: any) {
        if (insideOwnControl(e)) return
        onOpenArchive()
      },
      onKeyDown: function (e: any) {
        if (!e || e.target !== e.currentTarget) return
        const k = e && e.key
        if (k === 'Enter' || k === ' ') {
          try { if (e.preventDefault) e.preventDefault() } catch (err) {}
          onOpenArchive()
        }
      },
    })
  }

  return h('section', sectionProps, [
    titleNode(h, profile, openable),
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
