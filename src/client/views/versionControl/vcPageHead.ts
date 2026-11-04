// views/versionControl/vcPageHead.ts —— 页头与页面骨架原语（#1829 阶段 4；#1840 按定稿原型对齐）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶用 declare。
//
// 页头照定稿原型 docs/prototype/vc-redesign/src/ui/views/page-shell.ts 的 pageShell 画两段：
// 标题行（返回键 + 页面标题 + 能力计数）与导语。原型页头没有「种类 / 第 N 层」这一行——那是 #1829
// 阶段 4 早先自造的信息；#1840 起删掉，页头只保留读者真正需要的两段，管理索引这类不在能力账本里
// 的屏幕因此也不需要再传 hideSub 把空行藏起来。
// 文字形参一律收词条键：叶子内部统一过 t，调用方不自己拼文案，也不把中文写进组件。
// 能力计数只在账本给出正数时出现；任务页与索引屏不在 16 页能力账本里，页头因此不画计数。
//
// 图标：原型用内联 SVG（back / chevron），插件这边不再拿字符拼箭头——字符在不同字体下大小与基线
// 都不一样，且读屏会把它念出来。vcPageIconOf 只给页头与骨架原语用，路径直接照抄原型 dom.ts。

declare const PAGE_COUNTS: Record<string, number>

// 子节点允许数组、单个节点或空；这里统一成数组，原语就不必各写一份判空。
// 注意空数组也要原样交回 h：React 对空数组与不传子节点的结果一致，不会多出空壳。
// 调用方常常直接把页面自己的节点数组塞进来（section 的正文、obj-row 的两侧），这些节点大多没写 key；
// 原语把它们摊进自己的 kids 数组时会触发 React「列表子节点缺唯一 key」的告警。这里统一补一个稳定的
// 位置 key（只补缺的，已有 key 的不动），同一份子数组每次渲染顺序不变，key 也就不跳。
const vcPageKidsOf = function (children: any): any[] {
  if (children === undefined || children === null || children === false) return []
  const flat: any[] = []
  const walk = function (one: any): void {
    if (Array.isArray(one)) { one.forEach(walk); return }
    flat.push(one)
  }
  walk(children)
  return flat.map(function (node: any, i: number) {
    if (node && typeof node === 'object' && !Array.isArray(node) && node.key === undefined) return Object.assign({}, node, { key: 'kid-' + i })
    return node
  })
}

// 原型里的两条图标路径（24×24 viewBox，描边 1.8、圆头圆角）。
const VC_PAGE_ICON_PATHS: Record<string, string> = {
  back: 'M20 12H5M11 6l-6 6 6 6',
  chevron: 'M6 9l6 6 6-6',
}

// 画一枚内联 SVG 图标。kind 不认识时画一条空路径，调用方不会拿到 undefined 节点。
// svg 属性按 React 的驼峰写法给：viewBox / strokeWidth 这些在 React DOM 里有白名单，
// 写成连字符形式会在开发构建里报未知属性警告。
export const vcPageIconOf = function (h: any, kind: string, size: number) {
  const px = Number(size || 14)
  return h('svg', {
    viewBox: '0 0 24 24', width: px, height: px, fill: 'none', stroke: 'currentColor',
    strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true', focusable: 'false',
  }, [h('path', { key: 'path', d: VC_PAGE_ICON_PATHS[kind] || '' })])
}

// 页头：div.vcs-page-meta.vcs-page-head 带着 data-vc-page-head=页面 id，容器的事件委托据此认页。
// 第一段是标题行：返回键只在 opts.back === true 时出现（它是导航，不是写动作），标题用
// vc.shell.page.<页面>，计数用 vc.shell.page.caps 且只在账本正数时画；第二段是导语。
// #1840 两处补充：① 顶栏返回键退役后，页头返回键是唯一一颗，data-log 由调用方按来源页给
//   （opts.backLog），缺省不挂——独立渲染页头的门禁不需要日志词条；② 返回键按原型画成
//   图标 +「返回」，标题属性与 aria-label 都把「回上一页」说全。
export const vcPageHeadNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const page = String(opts.page || 'changes')
  const titleRow: any[] = []
  if (opts.back === true) {
    titleRow.push(h('button', {
      key: 'back', className: 'vcs-page-back', type: 'button',
      title: t('vc.shell.page.backTitle'), 'aria-label': t('vc.shell.page.backTitle'),
      'data-vc-back': '1', 'data-press': 'button',
      // 缺省 undefined 时 h 不会写这个属性；真机上 vcRealTab 按返回目标给 vc.changes.back 或 vc.commit.back。
      'data-log': opts.backLog,
    }, vcPageIconOf(h, 'back', 14), h('span', { key: 'label', className: 'vcs-page-back-label' }, t('vc.shell.page.back'))))
  }
  titleRow.push(h('h2', { key: 'title', className: 'vcs-page-title' }, t('vc.shell.page.' + page)))
  const count = Number(PAGE_COUNTS[page] || 0)
  // 任务页与未知页没有账本条目（undefined 经 Number 得 NaN），一律按 0 处理，不画空计数。
  if (count > 0) titleRow.push(h('span', { key: 'count', className: 'vcs-page-count' }, t('vc.shell.page.caps', { n: count })))
  return h('div', { className: 'vcs-page-meta vcs-page-head', 'data-vc-page-head': page }, [
    h('div', { key: 'title-row', className: 'vcs-page-title-row' }, titleRow),
    h('p', { key: 'lede', className: 'vcs-page-lede' }, t('vc.shell.page.note.' + page)),
  ])
}

// 分区：section.page-section 是「一段有标题的内容」，标题行可以带条数；危险区在类名上加 is-danger，
// 并给 data-vc-danger-section=1，同时把 vc.shell.page.danger 写在标题旁——读者在展开之前就知道这段不安全。
// 条数有两种给法，画在同一个位置：
//   ① count：只给数字（原型里的 section-count 是纯数字时用它），0 与负数不画；
//   ② countText：给已经带量词的一整句（例如「3 条本地分支」「2 个标签」），#1858 按原型 38 需要量词就用这一种。
//      两种都传时以 countText 为准——它已经是读者要看到的那句话，数字不再拼一遍。
export const vcPageSectionNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const danger = opts.danger === true
  const head: any[] = [h('h3', { key: 'title', className: 'section-title' }, t(String(opts.title || '')))]
  const countText = opts.countText === undefined || opts.countText === null ? '' : String(opts.countText)
  const count = Number(opts.count || 0)
  if (countText !== '') head.push(h('span', { key: 'count', className: 'section-count' }, t(countText)))
  else if (count > 0) head.push(h('span', { key: 'count', className: 'section-count' }, String(count)))
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
// 标题行按原型先画一枚 chevron 图标（收起时朝右、展开时朝下，方向由样式表按 [open] 转），
// 再是标题与条数；说明写在 summary 之后、正文之前，收起时也看得见这一段的用途。
// opts.attrs 是给调用方的透传口：页面要在折叠段上挂自己的 data-*（例如配置页的组 id、可写/只读与能力编号）时
// 从这里传，attr 会合到 details 上；注意不要再传 className 与 data-vc-page-fold，那两项由原语自己给。
export const vcPageFoldNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const attrs: any = { className: 'fold', 'data-vc-page-fold': String(opts.key || '') }
  if (opts.attrs) Object.assign(attrs, opts.attrs)
  if (opts.open === true) attrs.open = 'open'
  const head: any[] = [
    h('span', { key: 'chevron', className: 'fold-chevron' }, vcPageIconOf(h, 'chevron', 12)),
    h('span', { key: 'title', className: 'fold-title' }, t(String(opts.title || ''))),
  ]
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
// 每格可选 attrs：页面要把 data-* 挂在具体一格上（例如配置页的 data-vc-config-row 与作用域）时从这里传，
// 会合到 div.fact-cell 上；这两项只加属性，不改变网格与色板的既有行为。
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
    const cellAttrs: any = { key: 'fact-' + i, className: 'fact-cell' }
    if (fact.attrs) Object.assign(cellAttrs, fact.attrs)
    return h('div', cellAttrs, [
      h('dt', { key: 'key', className: 'fact-key' }, t(String(fact.key || ''))),
      h('dd', { key: 'value', className: cls }, t(value)),
    ])
  }))
}

// 对象行：div.obj-row 左边是主体（obj-main）、右边是次要事实或入口（obj-side）；危险行整体加 is-danger。
// 两侧都归一成数组，调用方给单个节点也能画；右侧为空时仍保留 obj-side，样式表据此让它不占宽度。
// opts.attrs 同样透传到行容器（钩子页用它挂 data-vc-hook=<钩子名> 与 data-vc-hook-sample）。
export const vcPageObjRowNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const danger = opts.danger === true
  const attrs: any = { className: 'obj-row' + (danger ? ' is-danger' : '') }
  if (opts.attrs) Object.assign(attrs, opts.attrs)
  return h('div', attrs, [
    h('div', { key: 'main', className: 'obj-main' }, vcPageKidsOf(opts.main)),
    h('div', { key: 'side', className: 'obj-side' }, vcPageKidsOf(opts.side)),
  ])
}
