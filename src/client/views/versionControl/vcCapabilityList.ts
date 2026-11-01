// views/versionControl/vcCapabilityList.ts —— 「本页负责的能力」列表（#1586 T03 起在壳里，T26 拆出来控行数）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 这一块是页面注册表与能力账本在界面上的落点：每个页面底部按 vcPageCapabilitiesOf(page) 列出本页负责的
// 全部能力，每行恰好一个 data-cap-primary（主入口唯一性由 818 的 Z 组判据守）。全库搜索页的命令面板也画在
// 这一行里；身份行放大镜的 aria-controls 与它用同一个 id（前缀 + -palette），两边不各起各的名字。

declare function vcPageCapabilitiesOf(page: any): any[]
declare function vcPagePrefixOf(prefix: any): string
declare function vcCapabilitySurfaceKindOf(cap: any): string
declare function vcPaletteNode(h: any, t: any, o: any): any
declare function vcShellCapabilityRowNode(h: any, t: any, o: any): any

/** 画「本页负责的能力」：每行一个主入口标记；按种子决定是否打开操作面、确认卡、结果。 */
export const vcCapabilityListOf = function (h: any, t: any, o: any) {
  const opts = o || {}
  const caps = vcPageCapabilitiesOf(opts.page)
  // 全库搜索页的命令面板画在这一行里，但身份行那个放大镜的 aria-controls 照样要指得到它：
  //   两边用同一个 id（前缀 + -palette），不各起各的名字。
  const paletteId = vcPagePrefixOf(opts.pagePrefix || '') + '-palette'
  const rows = caps.map(function (cap: any) {
    const open = opts.openSurface === cap.id
    const surfaceKind = vcCapabilitySurfaceKindOf(cap)
    const paletteNode = surfaceKind === 'palette' ? vcPaletteNode(h, t, {
      id: paletteId, query: opts.query, highlight: opts.highlight, limit: opts.paletteLimit,
      // 版本说明跟着读数走：页面壳把首屏读数原样传进来（reads.screen.data.gitVersion）。
      reads: opts.reads,
    }) : null
    return vcShellCapabilityRowNode(h, t, {
      cap: cap,
      surface: open,
      paletteNode: paletteNode,
      confirm: opts.confirm && opts.confirm.capId === cap.id ? opts.confirm : null,
      result: opts.result && opts.result.capId === cap.id ? opts.result : null,
    })
  })
  return h('section', { className: 'vcs-caps', 'data-vc-cap-list': String(opts.page) }, [
    h('h3', { key: 'title', className: 'vcs-caps-title' }, t('vc.shell.page.lede', { n: rows.length })),
    rows.length ? h('ul', { key: 'rows', className: 'vcs-cap-rows' }, rows) : h('p', { key: 'none', className: 'vcs-caps-none' }, t('vc.shell.page.empty')),
  ])
}
