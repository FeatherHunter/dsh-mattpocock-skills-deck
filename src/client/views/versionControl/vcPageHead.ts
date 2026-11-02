// views/versionControl/vcPageHead.ts —— 页头与页面骨架原语（#1829 阶段 4）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶用 declare。
//
// 页头（vcPageHeadNode）照定稿原型 docs/prototype/vc-redesign/src/ui/views/page-shell.ts 的顺序画三段：
// 标题行（可选返回键、页面标题、能力计数）、种类与层级、导语。原来的页面壳只画一行标题、种类与层级，
// #1829 起换成这一段，页面壳调用它之后不再自己拼页头。
// 四个原语（section / fold / factGrid / objRow）本轮还没有调用方，先把结构钉下来供后续页面接手。
// 文字形参一律收词条键：叶子内部统一过 t，调用方不自己拼文案，也不把中文写进组件。
// 能力计数只在账本给出正数时出现；任务页是流程页，不在 16 页能力账本里，页头因此不画计数。

declare const PAGE_COUNTS: Record<string, number>
declare const PAGE_SURFACES: any[]
declare function vcPageDepthOf(pageId: any): number

// 子节点允许数组、单个节点或空；这里统一成数组，四个原语就不必各写一份判空。
// 注意空数组也要原样交回 h：React 对空数组与不传子节点的结果一致，不会多出空壳。
const vcPageKidsOf = function (children: any): any[] {
  if (children === undefined || children === null || children === false) return []
  return Array.isArray(children) ? children : [children]
}

// 页头：div.vcs-page-meta.vcs-page-head 带着 data-vc-page-head=页面 id，容器的事件委托据此认页。
// 第一段是标题行：返回键只在 opts.back === true 时出现（它是导航，不是写动作），标题用 vc.shell.page.<页面>，
// 计数用 vc.shell.page.caps 且只在账本正数时画；第二段是种类与层级；第三段是导语（vc.shell.page.note.<页面>）。
export const vcPageHeadNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const page = String(opts.page || 'changes')
  const titleRow: any[] = []
  if (opts.back === true) {
    titleRow.push(h('button', { key: 'back', className: 'vcs-page-back', type: 'button', 'data-vc-back': '1' }, t('vc.shell.page.back')))
  }
  titleRow.push(h('h2', { key: 'title', className: 'vcs-page-title' }, t('vc.shell.page.' + page)))
  const count = Number(PAGE_COUNTS[page] || 0)
  // 任务页与未知页没有账本条目（undefined 经 Number 得 NaN），一律按 0 处理，不画空计数。
  if (count > 0) titleRow.push(h('span', { key: 'count', className: 'vcs-page-count' }, t('vc.shell.page.caps', { n: count })))
  const surface = PAGE_SURFACES.filter(function (p: any) { return p && p.id === page })[0]
  const sub = [
    h('span', { key: 'kind', className: 'vcs-page-kind' }, surface ? String(surface.kind) : ''),
    h('span', { key: 'depth', className: 'vcs-page-depth' }, t('vc.shell.depth', { n: vcPageDepthOf(page) })),
  ]
  return h('div', { className: 'vcs-page-meta vcs-page-head', 'data-vc-page-head': page }, [
    h('div', { key: 'title-row', className: 'vcs-page-title-row' }, titleRow),
    h('p', { key: 'sub', className: 'vcs-page-sub' }, sub),
    h('p', { key: 'lede', className: 'vcs-page-lede' }, t('vc.shell.page.note.' + page)),
  ])
}

// 分区：section.page-section 是「一段有标题的内容」，标题行可以带条数；危险区在类名上加 is-danger，
// 并给 data-vc-danger-section=1，同时把 vc.shell.page.danger 写在标题旁——读者在展开之前就知道这段不安全。
export const vcPageSectionNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const danger = opts.danger === true
  const head: any[] = [h('h3', { key: 'title', className: 'section-title' }, t(String(opts.title || '')))]
  const count = Number(opts.count || 0)
  if (count > 0) head.push(h('span', { key: 'count', className: 'section-count' }, String(count)))
  if (danger) head.push(h('span', { key: 'danger', className: 'section-danger' }, t('vc.shell.page.danger')))
  const kids: any[] = [h('div', { key: 'head', className: 'section-head' }, head)]
  if (opts.note) kids.push(h('p', { key: 'note', className: 'section-note' }, t(String(opts.note))))
  const body = vcPageKidsOf(opts.children)
  if (body.length > 0) kids.push.apply(kids, body)
  const attrs: any = { className: 'page-section' + (danger ? ' is-danger' : '') }
  if (danger) attrs['data-vc-danger-section'] = '1'
  return h('section', attrs, kids)
}

// 折叠段：details.fold 带 data-vc-page-fold=<key>，opts.open === true 时才写 open 属性（默认收起）。
// 标题行给标题与条数；说明写在 summary 之后、正文之前，收起时也看得见这一段的用途。
export const vcPageFoldNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const attrs: any = { className: 'fold', 'data-vc-page-fold': String(opts.key || '') }
  if (opts.open === true) attrs.open = 'open'
  const head: any[] = [h('span', { key: 'title', className: 'fold-title' }, t(String(opts.title || '')))]
  const count = Number(opts.count || 0)
  if (count > 0) head.push(h('span', { key: 'count', className: 'fold-count' }, String(count)))
  // 原生的 details/summary 也是可点控件：按全仓纪律挂 data-press（按压形状）与 data-log（点开/收起能定位到是哪一段折叠），
  //   data-log 按折叠键拼出来，页内多段折叠不会撞同一个名字。
  const kids: any[] = [h('summary', { key: 'head', className: 'fold-head', 'data-press': 'button', 'data-log': 'vc.page.fold.' + String(o.key || '') }, head)]
  if (opts.note) kids.push(h('p', { key: 'note', className: 'fold-note' }, t(String(opts.note))))
  kids.push(h('div', { key: 'body', className: 'fold-body' }, vcPageKidsOf(opts.children)))
  return h('details', attrs, kids)
}

// 事实网格：dl.fact-grid 里一格一项（div.fact-cell 包 dt.fact-key 与 dd.fact-value，HTML 允许 dl 下用 div 分组）。
// 值按三件事加类：等宽（is-mono）、弱化（is-muted）、警示与失败（is-warn / is-error）；颜色只由样式表按令牌给。
export const vcPageFactGridNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const facts = Array.isArray(opts.facts) ? opts.facts : []
  return h('dl', { className: 'fact-grid' }, facts.map(function (f: any, i: number) {
    const fact = f || {}
    const tone = String(fact.tone || '')
    let cls = 'fact-value'
    if (fact.mono === true) cls += ' is-mono'
    if (tone === 'muted') cls += ' is-muted'
    else if (tone === 'warn') cls += ' is-warn'
    else if (tone === 'error') cls += ' is-error'
    const value = fact.value === undefined || fact.value === null ? '' : String(fact.value)
    return h('div', { key: 'fact-' + i, className: 'fact-cell' }, [
      h('dt', { key: 'key', className: 'fact-key' }, t(String(fact.key || ''))),
      h('dd', { key: 'value', className: cls }, t(value)),
    ])
  }))
}

// 对象行：div.obj-row 左边是主体（obj-main）、右边是次要事实或入口（obj-side）；危险行整体加 is-danger。
// 两侧都归一成数组，调用方给单个节点也能画；右侧为空时仍保留 obj-side，样式表据此让它不占宽度。
export const vcPageObjRowNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const danger = opts.danger === true
  return h('div', { className: 'obj-row' + (danger ? ' is-danger' : '') }, [
    h('div', { key: 'main', className: 'obj-main' }, vcPageKidsOf(opts.main)),
    h('div', { key: 'side', className: 'obj-side' }, vcPageKidsOf(opts.side)),
  ])
}
