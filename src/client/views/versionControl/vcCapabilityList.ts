// views/versionControl/vcCapabilityList.ts —— 「本页负责的能力」列表（#1586 T03 起在壳里，T26 拆出来控行数）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 这一块是页面注册表与能力账本在界面上的落点：每个页面底部按 vcPageCapabilitiesOf(page) 列出本页负责的
// 全部能力，每行恰好一个 data-cap-primary（主入口唯一性由 818 的 Z 组判据守）。
// #1846：命令面板不再画在这张清单里 —— 全库搜索页自己画输入框与按页面分组的结果，命令面板只作为
//   遮罩浮层挂在别的页面上。因此这里不再需要「前缀 + -palette」那个 id，也不再接 paletteNode。

declare function vcPageCapabilitiesOf(page: any): any[]
declare function vcShellCapabilityRowNode(h: any, t: any, o: any): any

/** 画「本页负责的能力」：每行一个主入口标记；按种子决定是否打开操作面、确认卡、结果。 */
export const vcCapabilityListOf = function (h: any, t: any, o: any) {
  const opts = o || {}
  const caps = vcPageCapabilitiesOf(opts.page)
  const rows = caps.map(function (cap: any) {
    return vcShellCapabilityRowNode(h, t, {
      cap: cap,
      surface: opts.openSurface === cap.id,
      confirm: opts.confirm && opts.confirm.capId === cap.id ? opts.confirm : null,
      result: opts.result && opts.result.capId === cap.id ? opts.result : null,
      // #1776：命令面板选中一条后落到目标页，那一行要能被一眼认出来（落点高亮，不自动执行）。
      hit: opts.highlight === cap.id,
    })
  })
  // #1829 阶段 4：这棵长清单默认折叠。定稿原型里页面正文不再铺「本页负责 N 条能力」的一长串行，
  //   但 162 条能力仍要能从页面里打开、每条仍恰好一个 data-cap-primary（818 的 Z 组判据守）——
  //   所以改成 details：summary 一行写清条数，展开才见行；节点结构与行本身一个不动，只加折叠外壳。
  //   data-press / data-log 与其它 summary 一致，既有的可点未接线判据才认它。
  return h('details', { className: 'vcs-caps', 'data-vc-cap-list': String(opts.page), 'data-vc-caps-fold': '1' }, [
    h('summary', { key: 'title', className: 'vcs-caps-title', 'data-press': 'button', 'data-log': 'vc.shell.caps.toggle' }, t('vc.shell.page.lede', { n: rows.length })),
    rows.length ? h('ul', { key: 'rows', className: 'vcs-cap-rows' }, rows) : h('p', { key: 'none', className: 'vcs-caps-none' }, t('vc.shell.page.empty')),
  ])
}
