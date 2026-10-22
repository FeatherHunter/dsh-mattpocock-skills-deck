/**
 * views/mapDetailV2/view/profile/MapProfileHeader.ts —— 地图档案区：MAP 自己的内容怎么展示（维护者答 Q2=A）。
 *
 * 一块信息卡从上到下：身份（MAP / 规格 小签 + #编号）→ 标题 → 目的地一句话 → 四枚计数
 * （可接 / 已认领 / 被阻塞 / 已关闭）→ 完成度进度条 → 「子票那句」（本图 N 张子票 / 正在取 / 没取到）→
 * 四或七个抽屉 → 地图行自带的错误。它替代老页的 MapDetailHead（老页那句「本图 N 张子票」与
 * 目的地在这里，只是从两行文字变成一块能一眼看全的档案）。
 *
 * 为什么这些值全从 profile 拿：档案里每个数字与每句文案的口径都在 model/container/mapProfile.ts 里定死
 * （与老页 views/MapDetailHead.ts 的取数口径对齐），这一层只做排版。两个容器（探索地图 / 规格）唯一的
 * 差别是小签词与「子票那句」用的词条键，也已经由模型按 kind 选好（chipLabelKey / feedSegments）。
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

/** 「子票那句」：模型给的几段话拼成一行；没取到的时候整行标红（data-state 让样式接）。 */
function feedLine(h: any, profile: MapProfile, feed: TicketFeed | null): any {
  const segments = profile.feedSegments || []
  if (!segments.length) return null
  const text = segments.map(function (segment: any) {
    return tr(segment.key, segment.params || {})
  }).join(' · ')
  return h('div', {
    className: 'm2v2-feed',
    'data-state': feed ? String(feed.state || '') : '',
  }, text)
}

/** 完成度：按已完成张数算的细条；一张子票都没有时不画（0% 的条没有信息量）。 */
function progressNode(h: any, profile: MapProfile): any {
  if (!profile.counts || !(profile.counts.total > 0)) return null
  return h('div', { className: 'm2v2-prog' }, [
    h('span', { key: 'cap', className: 'm2v2-prog-cap' }, tr('map.progressCap')),
    h('div', { key: 'track', className: 'm2v2-track' },
      h('div', { className: 'm2v2-fill', style: { width: profile.progressPercent + '%' } })),
    h('span', { key: 'num', className: 'm2v2-prog-num' }, profile.progressPercent + '%'),
  ])
}

/**
 * 画档案区。props: { st, profile: MapProfile, feed: TicketFeed | null }。
 * st 只为目的地与抽屉里的正文渲染（mdToHtml 需要它认仓库路径与图片）。
 */
export function MapProfileHeader(props: any): any {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = props && props.st
  const profile: MapProfile = props && props.profile
  const feed: TicketFeed | null = (props && props.feed) || null
  if (!profile) return null

  const counts = profile.counts || { total: 0, closed: 0, ready: 0, doing: 0, blocked: 0 }
  const chips = COUNT_CHIPS.map(function (chip: { status: string; labelKey: string }) {
    const n = (counts as any)[chip.status] || 0
    return h('span', {
      key: chip.status,
      className: 'm2v2-count',
      'data-status': chip.status,
    }, tr(chip.labelKey, { n: n }))
  })

  const destination = profile.hasDestination
    ? h('div', { className: 'm2v2-dest' }, [
      h('span', { key: 'ic', className: 'm2v2-dest-ic' }, Ic({ n: 'target', size: 12 })),
      h('div', { key: 'txt', style: { flex: 1, minWidth: 0 } },
        (typeof mdToHtml === 'function' ? mdToHtml(profile.destination, { st: st }) : profile.destination)),
    ])
    // 规格没有「目的地」这一节（规格正文是问题、方案、用户故事、实现决策那些），所以不画「未填写」的样子：
    // 探索地图缺目的地时仍要提示一句，让写图的人知道这格该填。
    : (profile.kind === 'spec'
      ? null
      : h('div', { className: 'm2v2-dest m2v2-dest-empty' }, [
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
    h('div', { key: 'counts', className: 'm2v2-counts' }, chips),
    progressNode(h, profile),
    feedLine(h, profile, feed),
    h(MapProfileDrawers, { key: 'drawers', sections: profile.sections }),
    profile.errorText
      ? h('div', { key: 'err', className: 'm2v2-err' }, [
        h('span', { key: 'ic' }, Ic({ n: 'alert', size: 12 })),
        h('span', { key: 'txt' }, profile.errorText),
      ])
      : null,
  ])
}
