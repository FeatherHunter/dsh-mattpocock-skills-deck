// views/versionControl/vcManageIndex.ts —— 齿轮九分区的管理索引卡片（#1829 阶段 4-B）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
//
// 齿轮里的九分区索引从「一行一个链接」改成「一张一张卡片」：每张卡三块文字 —— 分区名、
// 本分区能力条数、打开提示。整块仍是导航地标 nav.vcs-gear-index，所以外壳类名与每一项的
// data-vc-gear-item 都不换：事件委托按 data-vc-gear-item 认目标（vcRealDelegate），
// 读屏与键盘靠 aria-controls 指回 vc-page-<页面> 那块面板。
//
// 三件事不能顺手改：
//   1. 九项的 id 与顺序严格取 VC_MANAGE_PAGES——verify-818 的 Z11 按这个顺序逐项对，顺序一变它先红；
//   2. 每张卡仍是真按钮（type="button"）：点击走 data-vc-gear-item 委托，这里不挂 onClick、
//      也不写 data-action——那是假按钮的路子，键盘与读屏都会跟着坏；
//   3. 样式不在这片叶子：卡片的颜色、间距与悬停都写在 vcPageStyles 那一片里，
//      这里只给类名与结构（.vcs-gear-index / .vcs-manage-index / .vcs-gear-li /
//      .vcs-gear-item / .vcs-manage-card 与三块文字各自的类名）。

declare const VC_MANAGE_PAGES: string[]
declare const VC_MANAGE_SECTION_KEYS: Record<string, string>
declare const PAGE_COUNTS: Record<string, number>

export const vcManageIndexNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  // 当前页那张卡标 aria-current="page"：读屏据此说「当前页」，视觉上的强调由样式按这个属性画。
  const active = opts.active
  const cards: any[] = []
  for (let i = 0; i < VC_MANAGE_PAGES.length; i += 1) {
    const id = VC_MANAGE_PAGES[i]
    // 三块文字就是卡片上从上到下的阅读顺序：先名字，再「本分区几条能力」，最后一句打开提示。
    // 计数的键与参数跟页面头共用一条（vc.shell.page.caps + 账本 PAGE_COUNTS），不在这里另写一份文案。
    const text = [
      h('span', { key: 'title', className: 'vcs-manage-card-title' }, t(VC_MANAGE_SECTION_KEYS[id])),
      h('span', { key: 'count', className: 'vcs-manage-card-count' }, t('vc.shell.page.caps', { n: PAGE_COUNTS[id] })),
      h('span', { key: 'go', className: 'vcs-manage-card-go' }, t('vc.shell.gear.open')),
    ]
    cards.push(h('li', { key: id, className: 'vcs-gear-li' }, h('button', {
      type: 'button',
      className: 'vcs-gear-item vcs-manage-card',
      'data-vc-gear-item': id,
      // 九分区的目标面板 id 是全局面唯一的（vc-page-<页面>）：单页渲染时别的分区还没画，
      // 一次渲染全部页面时全部指得到（verify-818 的 Z8d 按后者验它是否落在真实 id 上）。
      'aria-controls': 'vc-page-' + id,
      'aria-current': id === active ? 'page' : undefined,
    }, text)))
  }
  return h('nav', {
    id: opts.id,
    className: 'vcs-gear-index vcs-manage-index',
    'data-vc-gear-index': '1',
    'data-vc-manage-index': '1',
    'aria-label': t('vc.shell.gear.title'),
  }, [
    h('p', { key: 'title', className: 'vcs-gear-title' }, t('vc.shell.gear.title')),
    h('ul', { key: 'items', className: 'vcs-gear-list' }, cards),
  ])
}
