/**
 * views/mapDetailV2/view/profile/MapProfileHeader.ts —— 地图档案区：MAP 自己的内容怎么展示（维护者答 Q2=A）。
 *
 * 一块信息卡从上到下：身份（MAP / 规格 小签 + #编号）→ 标题 → 目的地一句话 → 四枚计数
 * （可接 / 已认领 / 被阻塞 / 已关闭）→ 完成度进度条 → 「子票那句」（本图 N 张子票 / 没取到）→
 * 四或七个抽屉 → 地图行自带的错误。它替代老页的 MapDetailHead（老页那句「本图 N 张子票」与
 * 目的地在这里，只是从两行文字变成一块能一眼看全的档案）。
 *
 * 为什么这些值全从 profile 拿：档案里每个数字与每句文案的口径都在 model/container/mapProfile.ts 里定死
 * （与老页 views/MapDetailHead.ts 的取数口径对齐），这一层只做排版。两个容器（探索地图 / 规格）唯一的
 * 差别是小签词与「子票那句」用的词条键，也已经由模型按 kind 选好（chipLabelKey / feedSegments）。
 *
 * 2026-10-23 维护者两次反馈取数中的样子：先说「正在取子票…」独占一行、随后消失让卡片上下抖；
 * 随后又说这一行干脆别要（删掉、或并到别的行、或做成 toast）。现在按「删掉」处理，并把「正在取数」
 * 这个信息并进已有的进度条：轨道上画流动斜纹（页面对 busy 打 data-busy，样式负责动画，
 * 尊重 prefers-reduced-motion 时停掉动画），不再多写一行字。
 * 三行仍然固定成一块 m2v2-meta：计数写占位短横、进度条留空轨道并带斜纹、子票那句说一句带占位的
 * 完整话（「本图 – 张子票（已关闭 – 张）」）——删掉那句话后这一行空着不好看（维护者第三次反馈），
 * 所以保留句子、只把未知数字换成短横。取到后原地换成真数字，高度不变；确实一张子票都没有时
 * 整块用 visibility 隐藏，位置仍然留着，不把卡片往上拽。
 */
import type { MapProfile, TicketFeed } from '../../model/contracts/mapDetailTypes'

declare function Ic(props?: any): any
declare function mdToHtml(...args: any[]): any
declare function MapProfileDrawers(props?: any): any

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
 * 「子票那句」：模型给的几段话拼成一行。取数中模型给的是带占位短横的同一句话
 * （「本图 – 张子票（已关闭 – 张）」），不再写「正在取子票」，也不会空出一整行
 * （维护者 2026-10-23 的两次反馈：「正在取子票」那行不要；删掉后空一行也不行）。
 * 「正在取数」由进度条上的斜纹表达。这一行永远占一行的高度（样式里给了 min-height）：
 * 取到数以后只是把短横换成数字，不会把下面的内容顶走。
 */
function feedLine(h: any, profile: MapProfile, feed: TicketFeed | null): any {
  const segments = profile.feedSegments || []
  const text = segments.map(function (segment: any) {
    return tr(segment.key, segment.params || {})
  }).join(' · ')
  return h('div', {
    key: 'feed',
    className: 'm2v2-feed',
    'data-state': feed ? String(feed.state || '') : '',
  }, text)
}

/**
 * 完成度：按已完成张数算的细条。取数中总张数还不知道，就先画一条空轨道、右边写「–」，
 * 并给整行打 data-busy：「正在取数」就靠轨道上的流动斜纹表达，不再多占一行文字。
 * 取到以后原位置换成真实百分比（一张子票都没有时这块最终会被 meta 整块隐藏，只占位不显示）。
 */
function progressNode(h: any, profile: MapProfile, busy: boolean): any {
  const total = profile.counts ? profile.counts.total : 0
  const known = total > 0
  const percent = known ? profile.progressPercent : 0
  return h('div', {
    key: 'prog',
    className: 'm2v2-prog',
    'data-busy': busy && !known ? '1' : '0',
  }, [
    h('span', { key: 'cap', className: 'm2v2-prog-cap' }, tr('map.progressCap')),
    h('div', { key: 'track', className: 'm2v2-track' },
      h('div', { className: 'm2v2-fill', style: { width: percent + '%' } })),
    h('span', { key: 'num', className: 'm2v2-prog-num' }, known ? (percent + '%') : (busy ? PLACEHOLDER : '0%')),
  ])
}

/**
 * 画档案区。props: { st, profile: MapProfile, feed: TicketFeed | null, busy: boolean }。
 * st 只为目的地与抽屉里的正文渲染（mdToHtml 需要它认仓库路径与图片）；
 * busy 表示「正在按需取子票」（页面传进来，取数敲门与回来之间为真）。
 */
export function MapProfileHeader(props: any): any {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = props && props.st
  const profile: MapProfile = props && props.profile
  const feed: TicketFeed | null = (props && props.feed) || null
  const busy: boolean = !!(props && props.busy)
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
  // 取数成功且确实一张子票都没有时，这三行一起用 visibility 藏起来：文字不重复出现（「本图 0 张子票」
  // 交给卡片流的空态说一次），但位置留着，卡片不会因为这块消失而往上跳。
  const quietEmpty = !busy && !!(feed && feed.state === 'ready' && counts.total === 0)
  const metaNode = h('div', {
    key: 'meta',
    className: 'm2v2-meta',
    'data-empty': quietEmpty ? '1' : '0',
    'aria-busy': busy ? 'true' : 'false',
  }, [
    countsNode,
    progressNode(h, profile, busy),
    feedLine(h, profile, feed),
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
    h('div', { key: 'id', className: 'm2v2-id' }, [
      h('span', { key: 'chip', className: 'm2v2-chip' }, tr(profile.chipLabelKey || 'card.map')),
      h('span', { key: 'no', className: 'm2v2-no' }, profile.noText || ''),
    ]),
    h('h1', { key: 'title', className: 'm2v2-title' }, profile.title || ''),
    destination,
    metaNode,
    h(MapProfileDrawers, { key: 'drawers', sections: profile.sections }),
    profile.errorText
      ? h('div', { key: 'err', className: 'm2v2-err' }, [
        h('span', { key: 'ic' }, Ic({ n: 'alert', size: 12 })),
        h('span', { key: 'txt' }, profile.errorText),
      ])
      : null,
  ])
}