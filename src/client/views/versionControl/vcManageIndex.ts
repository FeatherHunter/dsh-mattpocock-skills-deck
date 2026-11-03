// views/versionControl/vcManageIndex.ts —— 管理索引：九张分区卡与独立的索引屏（#1829 阶段 4-B / #1840）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
//
// 管理索引是「九个分区」的一屏目录：说明句、九张分区卡、两条跨区入口（命令面板与全库搜索）、
// 覆盖口径。它有两种摆法，共用同一份卡片结构：真实运行时它自己占一屏（#1840），受控渲染
// （open.gear，门禁的全页自检与 Z 组）仍把它挂在身份行下面。两种摆法拆两片叶子会让「卡片上写什么」
// 出现两份真源，所以放在同一叶里。
//
// 结构照定稿原型 docs/prototype/vc-redesign/src/ui/views/pages-manage.ts 的 manage 屏：
//   每张卡是「标题行（名字 + 危险区 + 右上角范围摘要）→ 一句覆盖口径 → 底部（本区能力条数 + 打开）」，
//   卡之间 7px、索引屏各块之间 12px；打开提示后面跟一枚 chevron，和原型一致。
//
// 三件事不能顺手改：
//   1. 九项的 id 与顺序严格取 VC_MANAGE_PAGES——verify-818 的 Z11 按这个顺序逐项对，顺序一变它先红；
//   2. 每张卡仍是真按钮（type="button"）：点击走 data-vc-gear-item 委托，这里不挂 onClick、
//      也不写 data-action——那是假按钮的路子，键盘与读屏都会跟着坏；
//   3. 样式不在这片叶子：卡片与索引屏的颜色、间距、四档宽的网格都写在 vcPageStyles 那一片里，
//      这里只给类名与结构（.vcs-gear-index / .vcs-manage-index / .vcs-manage-card / .vcs-manage-page 等）。

declare const VC_MANAGE_PAGES: string[]
declare const VC_MANAGE_SECTION_KEYS: Record<string, string>
declare const PAGE_COUNTS: Record<string, number>
declare const CAPABILITIES: any[]
declare const VC_MANAGE_DANGER_PAGES: string[]
// 账本在构建期就按 placement 归好四类落点的总数（直/折/诊/外，来自 capability-ledger.ts 的 PLACEMENT_COUNTS）。
// 覆盖口径那一行直接读这四个数，不再遍历 162 条能力自己重算一遍——同一件事实只留一处真源（ADR 20261021）。
declare const PLACEMENT_COUNTS: Record<string, number>

// 覆盖口径的键由分区名那条键派生（vc.shell.gear.<分区> → vc.shell.gear.card.<分区>）。
// 派生函数单独导出：门禁直接用它算期望，不在测试里再抄一遍 replace 的字符串手术。
export const vcManageCardKeyOf = function (id: string) {
  return String(VC_MANAGE_SECTION_KEYS[id] || '').replace('vc.shell.gear.', 'vc.shell.gear.card.')
}

// 卡头右上角那句范围摘要的键：vc.shell.gear.summary.<分区>。
// 原型这里放的是实时读数（「112 条分支 · 48 个标签」）；插件这一屏不主动发宿主读（索引不该因为
// 打开就多打一轮容器调用），所以先写诚实的范围短语。将来有读数时由调用方传实时文本，结构不变。
const vcManageSummaryKeyOf = function (id: string) {
  return 'vc.shell.gear.summary.' + id
}

// 一张分区卡：名字（危险分区再跟一枚「危险区」）、范围摘要、覆盖口径一句话、条数与打开提示。
//   覆盖口径的键由分区名那条键派生（vc.shell.gear.<分区> → vc.shell.gear.card.<分区>），
//   不另建一张映射表——多一张表就多一处会漏更新的地方。
const vcManageCardNodeOf = function (h: any, t: any, id: string, active: any) {
  const danger = (VC_MANAGE_DANGER_PAGES || []).indexOf(id) >= 0
  const head: any[] = [
    h('span', { key: 'title', className: 'vcs-manage-card-title' }, t('vc.shell.page.' + id)),
  ]
  if (danger) head.push(h('span', { key: 'danger', className: 'vcs-manage-card-danger' }, t('vc.shell.gear.danger')))
  head.push(h('span', { key: 'summary', className: 'vcs-manage-card-count' }, t(vcManageSummaryKeyOf(id))))
  const cardKey: string = vcManageCardKeyOf(id)
  return h('button', {
    type: 'button',
    className: 'vcs-gear-item vcs-manage-card' + (danger ? ' is-danger' : ''),
    'data-vc-gear-item': id,
    // 九分区的目标面板 id 是全局面唯一的（vc-page-<页面>）：单页渲染时别的分区还没画，
    // 一次渲染全部页面时全部指得到（verify-818 的 Z8d 按后者验它是否落在真实 id 上）。
    'aria-controls': 'vc-page-' + id,
    'aria-current': id === active ? 'page' : undefined,
  }, [
    h('span', { key: 'head', className: 'vcs-manage-card-head' }, head),
    h('span', { key: 'text', className: 'vcs-manage-card-text' }, t(cardKey)),
    h('span', { key: 'foot', className: 'vcs-manage-card-foot' }, [
      h('span', { key: 'caps', className: 'vcs-manage-card-caps' }, t('vc.shell.page.caps', { n: PAGE_COUNTS[id] })),
      h('span', { key: 'go', className: 'vcs-manage-card-go' },
        t('vc.shell.gear.cardOpen'),
        h('span', { key: 'chevron', className: 'vcs-manage-card-chevron' }, vcPageIconOf(h, 'chevron', 11))),
    ]),
  ])
}

// 九张卡的列表本体：nav 地标 + 有序列表。active 只有受控渲染（开在某个分区页上）才给，
//   索引屏自己做的那一屏没有「当前分区」，所以不标 aria-current。
export const vcManageIndexNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const cards: any[] = []
  for (let i = 0; i < VC_MANAGE_PAGES.length; i += 1) {
    const id: string = VC_MANAGE_PAGES[i]
    cards.push(h('li', { key: id, className: 'vcs-gear-li' }, vcManageCardNodeOf(h, t, id, opts.active)))
  }
  return h('nav', {
    key: opts.key,
    id: opts.id,
    className: 'vcs-gear-index vcs-manage-index',
    'data-vc-gear-index': '1',
    'data-vc-manage-index': '1',
    'aria-label': t('vc.shell.gear.title'),
  }, [h('ul', { key: 'items', className: 'vcs-gear-list' }, cards)])
}

// 覆盖口径的四个计数（直 / 折 / 诊 / 外）读账本构建期算好的 PLACEMENT_COUNTS：
//   账本每条能力的 placement 就是这件事实，总数已在生成物里归好桶；这里只把中文桶名映成词表占位符
//   （{direct}/{fold}/{diag}/{out}），不再逐条重算——重算就是第二份账本，账本挪条目时两边会悄悄对不上。
const vcCoverageCountsOf = function () {
  const totals: any = PLACEMENT_COUNTS || {}
  return {
    direct: Number(totals['直'] || 0),
    fold: Number(totals['折'] || 0),
    diag: Number(totals['诊'] || 0),
    out: Number(totals['外'] || 0),
  }
}

// 独立的管理索引屏（#1840）：说明句 → 九张卡 → 两条跨区入口 → 覆盖口径。
//   它不画分区正文、骨架与能力清单：索引本身不写仓库，也不占能力账本的 16 页。
//   两条入口复用既有事件属性（data-vc-search-entry 开命令面板、data-vc-extra-link 跳搜索页），
//   委托层不为索引屏新增一类点击意图。
export const vcManageIndexPageNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const list: any[] = CAPABILITIES || []
  const counts: any = vcCoverageCountsOf()
  return h('div', { className: 'vcs-manage-page', 'data-vc-manage-page': '1' }, [
    h('p', { key: 'note', className: 'vcs-manage-note', 'data-vc-note': 'manage-index' }, t('vc.shell.gear.indexNote')),
    vcManageIndexNode(h, t, { id: opts.id, active: '', key: 'index' }),
    h('div', { key: 'shortcuts', className: 'vcs-manage-shortcuts' }, [
      h('button', { key: 'palette', type: 'button', className: 'vcs-manage-shortcut', 'data-vc-search-entry': '1' },
        h('span', { key: 'chevron', className: 'vcs-manage-shortcut-chevron' }, vcPageIconOf(h, 'chevron', 12)),
        h('span', { key: 'label', className: 'vcs-manage-shortcut-label' }, t('vc.shell.gear.shortcutPalette', { n: list.length }))),
      h('button', { key: 'search', type: 'button', className: 'vcs-manage-shortcut', 'data-vc-extra-link': 'search' },
        h('span', { key: 'chevron', className: 'vcs-manage-shortcut-chevron' }, vcPageIconOf(h, 'chevron', 12)),
        h('span', { key: 'label', className: 'vcs-manage-shortcut-label' }, t('vc.shell.gear.shortcutSearch'))),
    ]),
    h('p', { key: 'coverage', className: 'vcs-coverage-note', 'data-vc-note': 'coverage' }, [
      h('span', { key: 'chip', className: 'vcs-coverage-chip' }, t('vc.shell.gear.coverageChip')),
      h('span', { key: 'text', className: 'vcs-coverage-text' }, t('vc.shell.gear.coverageText', { n: list.length })),
      h('span', { key: 'count', className: 'vcs-coverage-count' }, t('vc.shell.gear.coverageCount', counts)),
    ]),
  ])
}
