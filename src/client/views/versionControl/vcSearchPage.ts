// views/versionControl/vcSearchPage.ts —— 全库搜索页的版式（#1846 阶段 4 收口）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 这一页按定稿原型第 51 张做：输入框在首屏，结果按能力所属页面分组，选中一条只跳到那条能力的入口。
// 数据仍然只来自能力账本与 vcPaletteMatchOf（#1846 的边界：不改搜索匹配与命令面板的数据来源），
// 这里只负责「怎么摆」——所以它不画版本说明、不画主入口标记，也不执行任何动作。
// 命令面板那一套（遮罩、Esc、焦点回入口）在 vcPalette.ts / vcRealShell.ts，不在这份文件里。

declare function vcPaletteMatchOf(query: any, version: any): any[]

// 一次最多画几行：这是渲染上限，不是命中上限；命中总数另外写在计数行里。
// 原型搜索结果按 40 条截断，这里沿用同一个数，超过时末尾提示「再输入几个字缩小范围」。
export const VC_SEARCH_RENDER_MAX = 40

// 空查询与无命中是两种状态，分别有各自的说明文字；不能把空查询的「命中全部 162 条」画成结果。
const vcSearchStateOf = function (query: string, matches: any[]) {
  if (!query.trim()) return 'query'
  if (!matches.length) return 'hit'
  return 'rows'
}

export const vcSearchGroupsOf = function (rows: any[]) {
  const groups: any[] = []
  const index: any = {}
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {}
    const page = String(row.page || '')
    if (!index[page]) {
      index[page] = { page: page, pageName: String(row.pageName || ''), rows: [] }
      groups.push(index[page])
    }
    index[page].rows.push(row)
  }
  return groups
}

// 一行结果：能力编号、名称、去哪个页面、命令原文；需要对象上下文的动作额外提示「只跳到入口」。
// 这一行是搜索页自己的第二入口（data-vc-search-row），不带 data-cap-primary，不抢能力账本的主入口标记。
export const vcSearchRowNode = function (h: any, t: any, row: any, hit: boolean) {
  const attrs: any = {
    key: String(row.id || ''),
    type: 'button',
    className: 'vcs-search-row',
    'data-vc-search-row': String(row.id || ''),
  }
  if (hit === true) attrs['data-vc-search-hit'] = '1'
  const kids: any[] = [
    h('span', { key: 'id', className: 'vcs-search-id' }, String(row.id || '')),
    h('span', { key: 'name', className: 'vcs-search-name' }, String(row.name || '')),
    h('span', { key: 'where', className: 'vcs-search-where' }, t('vc.shell.search.jump') + ' ' + String(row.pageName || '')),
  ]
  if (row.command) kids.push(h('code', { key: 'cmd', className: 'vcs-search-cmd' }, String(row.command)))
  if (row.needsObject === true) kids.push(h('span', { key: 'need', className: 'vcs-search-need' }, t('vc.shell.search.needsObject')))
  return h('li', { key: String(row.id || ''), className: 'vcs-search-li' }, [h('button', attrs, kids)])
}

export const vcSearchPageNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const query = String(opts.query === undefined || opts.query === null ? '' : opts.query)
  // 版本说明留空：搜索页不画「当前 git 版本不支持」那一行（原型第 51 张没有它，版本说明仍由命令面板负责）。
  const matches = vcPaletteMatchOf(query, '')
  const limit = Number(opts.limit) > 0 ? Math.min(Number(opts.limit), VC_SEARCH_RENDER_MAX) : VC_SEARCH_RENDER_MAX
  const rows = matches.slice(0, limit)
  const state = vcSearchStateOf(query, matches)
  const kids: any[] = [
    h('p', { key: 'note', className: 'vcs-search-note', 'data-vc-search-note': '1' }, t('vc.shell.search.note')),
    h('div', { key: 'box', className: 'vcs-search-box' }, [
      h('input', {
        key: 'input',
        type: 'search',
        className: 'vcs-search-input',
        'data-vc-search-input': '1',
        placeholder: t('vc.shell.search.placeholder'),
        'aria-label': t('vc.shell.search.placeholder'),
        defaultValue: query,
      }),
    ]),
  ]
  if (state === 'query') kids.push(h('p', { key: 'empty', className: 'vcs-search-empty', 'data-vc-search-empty': 'query' }, t('vc.shell.search.emptyQuery')))
  if (state === 'hit') kids.push(h('p', { key: 'empty', className: 'vcs-search-empty', 'data-vc-search-empty': 'hit' }, t('vc.shell.search.emptyHit')))
  if (state === 'rows') {
    kids.push(h('p', { key: 'count', className: 'vcs-search-count', 'data-vc-search-count': String(matches.length) }, t('vc.shell.search.count', { n: matches.length })))
    const groups = vcSearchGroupsOf(rows)
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i]
      kids.push(h('section', { key: 'group-' + group.page, className: 'vcs-search-group', 'data-vc-search-group': group.page }, [
        h('div', { key: 'head', className: 'vcs-search-group-head' }, [
          h('h4', { key: 'title', className: 'vcs-search-group-title' }, group.pageName),
          h('span', { key: 'count', className: 'vcs-search-group-count' }, t('vc.shell.search.groupCount', { n: group.rows.length })),
        ]),
        h('ul', { key: 'rows', className: 'vcs-search-rows' }, group.rows.map(function (row: any) {
          return vcSearchRowNode(h, t, row, opts.highlight === row.id)
        })),
      ]))
    }
    if (rows.length < matches.length) kids.push(h('p', { key: 'more', className: 'vcs-search-more', 'data-vc-search-more': '1' }, t('vc.shell.search.more', { n: rows.length })))
  }
  const attrs: any = { key: 'search', className: 'vcs-search', 'data-vc-search-page': '1' }
  if (opts.id) attrs.id = String(opts.id)
  return h('section', attrs, kids)
}
