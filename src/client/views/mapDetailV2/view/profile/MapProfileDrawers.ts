/**
 * views/mapDetailV2/view/profile/MapProfileDrawers.ts —— 地图档案下面那几排可展开的「抽屉」。
 *
 * 抽屉有哪些节、每节叫什么、里面几条，全部由模型算好（MapProfile.sections）；这里只负责画：
 * 一个 <details> + 一句标题 + 逐条内容。为什么要拆出来单独一份：探索地图是四节（正文详情 / 已定决策 /
 * 战雾 / 范围外），规格是另外七节（问题陈述 / 解决方案 / 用户故事 / 实现决策 / 测试决策 / 范围外 /
 * 补充说明），节数会随容器类型变，而画法完全一样——放到档案头里会把「取什么」和「怎么画」搅在一起。
 *
 * 两条画法约定：
 * - 数量为 0 的节不画（空抽屉只是噪音；地图档案「有没有内容」由 header 的 hasSections 那层判断兜住）。
 * - 标题里的数量：词条自己带 {n} 的（如 map.decisions「Decisions so far（{n}）」）就交给词条；
 *   不带 {n} 的（如 map.notesCap「正文详情」）只有多于一条时才在后面补个数字。
 */
import type { MapProfileItem, MapProfileSection } from '../../model/contracts/mapDetailTypes'

/** 抽屉标题：词条带 {n} 用它自己的说法，不带 {n} 的只在多于一条时补数字。
 *  函数名带抽屉前缀，免得拼进客户端闭包时与内核同名小函数撞车。 */
function drawerLabelOf(section: MapProfileSection): string {
  const raw = tr(section.labelKey)
  const withN = tr(section.labelKey, { n: section.count })
  if (withN !== raw) return withN
  return section.count > 1 ? raw + ' ' + section.count : raw
}

/** 一条档案内容：带链接的画成外链，不带的就是一段文字。 */
function itemNode(h: any, item: MapProfileItem, index: number): any {
  if (item && item.url) {
    return h('div', { key: index, className: 'm2v2-drawer-item' },
      h('a', { href: item.url, target: '_blank', rel: 'noreferrer', 'data-press': 'link' }, item.text))
  }
  return h('div', { key: index, className: 'm2v2-drawer-item' }, item ? item.text : '')
}

/**
 * 画整组抽屉。props: { sections: MapProfileSection[] }；没有一节有内容时返回 null（整块不出现）。
 */
export function MapProfileDrawers(props: any): any {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const sections: MapProfileSection[] = (props && props.sections) || []
  const visible = sections.filter(function (section: MapProfileSection) {
    return !!section && section.count > 0
  })
  if (!visible.length) return null

  return h('div', { className: 'm2v2-drawers' }, visible.map(function (section: MapProfileSection) {
    const items = (section.items || []).map(function (item: MapProfileItem, index: number) {
      return itemNode(h, item, index)
    })
    return h('details', {
      key: section.id,
      className: 'm2v2-drawer',
      'data-log': 'mapv2.drawer.' + section.id,
    }, [
      h('summary', { key: 'sum' }, drawerLabelOf(section)),
      h('div', { key: 'body', className: 'm2v2-drawer-body' }, items),
    ])
  }))
}
