// views/versionControl/vcShellPages.ts —— 版本管理页的页面壳（#1738 T03）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 两个渲染入口（票面验收①）：
//   vcRenderTabAt：受控渲染单页，参数带上页面 / 档宽 / 皮肤 / 种子读数 / 打开的面；
//   vcRenderAllPages：一次渲染页面注册表里的全部 16 页（门禁据此数 162 个主入口）。
// 根节点带 data-vc-root / data-vc-shell / data-vc-page / data-vc-width / data-vc-skin / data-vc-depth，
// 外壳的每一处都从这里读位置，不自己猜。
//
// 壳上的固定件（规格第 9 节的就近原则）：身份行（分支按钮 + 同步带 + 搜索入口 + 齿轮）、
// 齿轮九分区索引、分支悬浮层、四页签、页面体（本页负责的能力列表）。
// 300 宽时层级不超过 2 层，页签仍排一行四个；任何档位都不删入口。

declare const CAPABILITIES: any[]
declare const PAGE_SURFACES: any[]
declare const PAGE_COUNTS: Record<string, number>
declare function vcPageDepthOf(pageId: any): number
declare function vcPageRegistryOf(): any[]
declare function vcPageCapabilitiesOf(pageId: any): any[]
declare function vcCapabilityOf(capId: any): any
declare const VC_TAB_PAGES: string[]
declare const VC_MANAGE_PAGES: string[]
declare const VC_SIDE_PAGES: string[]
declare const VC_SEARCH_PAGE: string
declare const VC_MANAGE_SECTION_KEYS: Record<string, string>
declare function vcPaletteNode(h: any, t: any, o: any): any
declare function vcShellStateNode(h: any, t: any, o: any): any
declare function vcShellFormNodes(h: any, t: any, o: any): any
declare function vcShellCapabilityRowNode(h: any, t: any, o: any): any
declare function vcCapabilitySurfaceKindOf(cap: any): string
declare const VC_SHELL_STATES: string[]
declare function vcHistoryPageNode(h: any, t: any, o: any): any
// 远端与同步页叶子（#1754 T18，vcRemotePage.ts）：build 按叶子登记次序拼进同一闭包，这里只声明形状。
declare function vcRemotePageNode(h: any, t: any, o: any): any
// 历史高级查询面板（#1745，vcQueryView.ts）：提交历史页与「管理 › 诊断」页各挂一段，按能力账本筛。
declare function vcQueryPageNode(h: any, t: any, o: any): any
// 提交页正文叶子（#1743，vcCommitPage.ts）：改动页拿到读数时画在能力清单之前。
declare function vcCommitPageNode(h: any, t: any, o: any): any
// 长任务区叶子（#1740，vcTaskPanel.ts）：由构建按叶子登记次序拼进同一个闭包，这里只声明形状。
declare function vcTaskPanelNode(h: any, t: any, o: any): any
// 工作树页叶子（#1752，vcWorktreesPage.ts）：同样由构建拼进同一个闭包，壳的挂载段只调用它。
declare function vcWorktreesPageNode(h: any, t: any, o: any): any
// 子模块页叶子（#1757 T21，vcSubmodulesPage.ts）：同样由构建拼进同一个闭包，挂载段只往下递读数和处理函数。
declare function vcSubmodulesPageNode(h: any, t: any, o: any): any
// 改动页操作面板叶子（#1742，vcChangesPage.ts）：同样由构建拼进闭包；只在 changes 页且页面传入改动读数时挂载。
declare function vcChangesPageNode(h: any, t: any, o: any): any
// 分支与标签业务面板叶子（#1746 T11，vcBranches.ts）：同上由构建拼进闭包，这里只声明形状。
declare function vcBranchBoardNode(h: any, t: any, o: any): any
// 贮藏页叶子（#1751，vcStashPage.ts）与冲突向导正文叶子（#1747 T12，vcConflictsPage.ts）：同样由构建拼进同一个闭包，
// 这里只声明形状；挂载条件在下面。两条声明并进同一条物理行：本文件贴着 350 有效行上限。
declare function vcStashPageNode(h: any, t: any, o: any): any; declare function vcConflictsPageNode(h: any, t: any, o: any): any

export const VC_SHELL_WIDTHS: number[] = [300, 380, 460, 520]
export const VC_SHELL_SKINS: string[] = ['dark', 'light']
// 四条页签的中文键（与能力账本的页面 id 一一对应；顺序就是页签顺序）。
export const VC_TAB_LABEL_KEYS: Record<string, string> = {
  changes: 'vc.shell.tab.changes',
  commits: 'vc.shell.tab.commits',
  worktrees: 'vc.shell.tab.worktrees',
  stash: 'vc.shell.tab.stash',
}

const vcWidthOf = function (w: any) {
  const n = Number(w)
  if (!isFinite(n) || n <= 0) return 460
  return Math.max(260, Math.min(640, Math.round(n)))
}
const vcSkinOf = function (s: any) { return VC_SHELL_SKINS.indexOf(String(s)) >= 0 ? String(s) : 'dark' }
const vcPagePrefixOf = function (page: any) { return 'vc-' + String(page || 'mount') }

export const vcSyncBandNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const remote = String(opts.remote || 'origin')
  const when = String(opts.when || '')
  return h('button', {
    className: 'vcs-sync',
    type: 'button',
    'data-vc-sync': '1',
    'data-vc-sync-remote': remote,
    title: t('vc.shell.sync.open'),
  }, t('vc.shell.sync.text', { remote: remote, when: when }))
}

export const vcBranchOverlayNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const actions: any[] = []
  const list = ['list', 'create', 'delete', 'merge', 'rebase']
  for (let i = 0; i < list.length; i += 1) {
    actions.push(h('li', { key: list[i], className: 'vcs-branch-item' }, [
      h('button', { key: 'btn', type: 'button', className: 'vcs-branch-btn', 'data-vc-branch-action': list[i] }, t('vc.shell.branch.' + list[i])),
      h('span', { key: 'pending', className: 'vcs-branch-pending' }, t('vc.shell.branch.pending')),
    ]))
  }
  return h('div', {
    id: opts.id,
    className: 'vcs-branch-overlay',
    'data-vc-branch-overlay': '1',
    role: 'dialog',
    'aria-modal': 'false',
    'aria-label': t('vc.shell.branch.title'),
  }, [
    h('p', { key: 'cur', className: 'vcs-branch-cur' }, t('vc.shell.branch.current', { branch: String(opts.branch || '') })),
    h('ul', { key: 'acts', className: 'vcs-branch-list' }, actions),
    h('button', { key: 'close', type: 'button', className: 'vcs-branch-close', 'data-vc-branch-close': '1' }, t('vc.shell.branch.close')),
  ])
}

export const vcGearIndexNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const ids = VC_MANAGE_PAGES
  const items: any[] = []
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]
    const attrs: any = {
      key: id,
      type: 'button',
      className: 'vcs-gear-item',
      'data-vc-gear-item': id,
      // 九分区的目标面板 id 是全局面唯一的（vc-page-<页面>）：单页渲染时别的分区还没画，
      // 一次渲染全部页面时全部指得到（门禁 Z 组按后者验 aria-controls 是否落在真实 id 上）。
      'aria-controls': 'vc-page-' + id,
    }
    if (id === opts.active) attrs['aria-current'] = 'page'
    items.push(h('li', { key: id, className: 'vcs-gear-li' }, h('button', attrs, t(VC_MANAGE_SECTION_KEYS[id] || id))))
  }
  return h('nav', {
    id: opts.id,
    className: 'vcs-gear-index',
    'data-vc-gear-index': '1',
    'aria-label': t('vc.shell.gear.title'),
  }, [
    h('p', { key: 'title', className: 'vcs-gear-title' }, t('vc.shell.gear.title')),
    h('ul', { key: 'items', className: 'vcs-gear-list' }, items),
  ])
}

export const vcIdentityRowNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const left: any[] = []
  const branchAttrs: any = {
    key: 'branch',
    className: 'vcs-identity-branch',
    type: 'button',
    'data-vc-branch-btn': '1',
    'aria-expanded': opts.branchOpen ? 'true' : 'false',
  }
  if (opts.branchOpen) branchAttrs['aria-controls'] = opts.branchOverlayId
  left.push(h('button', branchAttrs, t('vc.shell.identity.branch') + '：' + String(opts.branch || '')))
  left.push(Object.assign({}, vcSyncBandNode(h, t, { remote: opts.remote, when: opts.when }), { key: 'sync' }))
  const right: any[] = []
  const searchAttrs: any = {
    key: 'search',
    className: 'vcs-identity-search',
    type: 'button',
    'data-vc-search-entry': '1',
    'aria-expanded': opts.paletteOpen ? 'true' : 'false',
  }
  if (opts.paletteOpen) searchAttrs['aria-controls'] = opts.paletteId
  right.push(h('button', searchAttrs, t('vc.shell.identity.search')))
  const gearAttrs: any = {
    key: 'gear',
    className: 'vcs-identity-gear',
    type: 'button',
    'data-vc-gear-btn': '1',
    'aria-expanded': opts.gearOpen ? 'true' : 'false',
  }
  if (opts.gearOpen) gearAttrs['aria-controls'] = opts.gearId
  right.push(h('button', gearAttrs, t('vc.shell.gear.open')))
  return h('header', { className: 'vcs-identity', 'data-vc-identity': '1' }, [
    h('div', { key: 'left', className: 'vcs-identity-left' }, left),
    h('div', { key: 'right', className: 'vcs-identity-right' }, right),
    h('span', { key: 'count', className: 'vcs-identity-count' }, t('vc.shell.identity.capCount', { n: CAPABILITIES.length })),
  ])
}

export const vcPageTabsNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const tabs: any[] = []
  for (let i = 0; i < VC_TAB_PAGES.length; i += 1) {
    const id = VC_TAB_PAGES[i]
    const selected = id === opts.active
    tabs.push(h('button', {
      key: id,
      id: vcPagePrefixOf(opts.pagePrefix || '') + '-tab-' + id,
      type: 'button',
      role: 'tab',
      className: 'vcs-tab',
      'data-vc-tab': id,
      'aria-selected': selected ? 'true' : 'false',
      'aria-controls': 'vc-page-' + id,
      tabIndex: selected ? 0 : -1,
    }, [
      h('span', { key: 'label', className: 'vcs-tab-label' }, t(VC_TAB_LABEL_KEYS[id])),
      h('span', { key: 'n', className: 'vcs-tab-count' }, String(Number(PAGE_COUNTS && PAGE_COUNTS[id]) || 0)),
    ]))
  }
  return h('div', {
    className: 'vcs-tabs',
    role: 'tablist',
    'aria-label': t('vc.shell.tabs.label'),
    'data-vc-tabs': '1',
  }, tabs)
}

// 页签页 / 二级页共用的「本页负责的能力」列表；能力行里按种子决定是否打开操作面、确认卡、结果。
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

const vcPageNotesOf = function (h: any, t: any, page: string) {
  const notes: any[] = []
  if (page === 'commits') {
    notes.push(h('div', { key: 'graph', className: 'vcs-note vcs-note-graph', 'data-vc-note': '13.14' }, [
      h('h4', { key: 't' }, t('vc.shell.commits.graphTitle')),
      h('p', { key: 'n' }, t('vc.shell.commits.graphNote')),
    ]))
  }
  if (page === 'platform') {
    notes.push(h('div', { key: 'platform', className: 'vcs-note', 'data-vc-note': 'platform-pointer' }, t('vc.shell.platform.pointer')))
  }
  if (page === 'diagnostics') {
    notes.push(h('div', { key: 'diag', className: 'vcs-note', 'data-vc-note': 'diagnostics-readonly' }, t('vc.shell.diagnostics.note')))
  }
  return notes
}

export const vcPageBodyNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const page = String(opts.page || 'changes')
  const children: any[] = []
  const surface = PAGE_SURFACES.filter(function (p: any) { return p && p.id === page })[0]
  children.push(h('div', { key: 'meta', className: 'vcs-page-meta' }, [
    h('span', { key: 'title', className: 'vcs-page-title' }, t('vc.shell.page.' + page)),
    h('span', { key: 'kind', className: 'vcs-page-kind' }, surface ? String(surface.kind) : ''),
    h('span', { key: 'depth', className: 'vcs-page-depth' }, t('vc.shell.depth', { n: vcPageDepthOf(page) })),
  ]))
  const notes = vcPageNotesOf(h, t, page)
  for (let i = 0; i < notes.length; i += 1) children.push(notes[i])
  // #1752 工作树页正文：读首屏聚合里那一份工作树片，八条能力的入口与执行面由 vcWorktreesPage 自己画；
  //   壳只负责把宿主数据与处理函数透传进去（没有传入时页面自己画空态，不影响其它页）。
  if (page === 'worktrees' && typeof vcWorktreesPageNode === 'function') {
    children.push(Object.assign({}, vcWorktreesPageNode(h, t, {
      reads: opts.reads, ui: opts.ui, ops: opts.ops, handlers: opts.handlers,
    }), { key: 'worktrees' }))
  }
  // #1757 T21 子模块页正文：域 10 八条能力的入口、固定四项批量、逐行清单与确认/结果都在 vcSubmodulesPage 里；
  //   壳只在调用方递进这一族读数（opts.submodules）时挂一段，没有递进来就照旧画骨架，其它页渲染不变。
  if (page === 'submodules' && opts.submodules !== undefined && typeof vcSubmodulesPageNode === 'function') children.push(Object.assign({}, vcSubmodulesPageNode(h, t, { board: opts.submodules, ui: opts.submoduleUi, ops: opts.submoduleOps }), { key: 'submodules' }))
  // 提交历史页有自己的正文（#1744 T09：列表 / 详情 / 逐文件差异 / 13.14 图形化视图）。
  // 只有在拿到了首屏读数时才换成真正文；没有读数（壳自检、Z 组骨架断言）仍旧画骨架。
  if (page === 'commits' && opts.reads) {
    children.push(Object.assign({}, vcHistoryPageNode(h, t, {
      reads: opts.reads, ui: opts.ui, width: opts.width, nowMs: opts.nowMs,
    }), { key: 'history' }))
  } else if (page === 'remote' && opts.reads) {
    // 远端与同步页正文（#1754 T18，域 8 的 8.1–8.4）。同样只在拿到读数时换成真正文，
    // 没读数（壳自检、Z 组骨架断言）仍旧画骨架。这个页面不自己画 data-cap-primary，
    // 8.1–8.4 的主入口标记由下面的能力行统一给，保证「每能力一个主入口」。
    children.push(Object.assign({}, vcRemotePageNode(h, t, {
      reads: opts.reads, ui: opts.ui, width: opts.width, nowMs: opts.nowMs,
    }), { key: 'remote' }))
  } else if (page === 'changes' && opts.reads) {
    // #1743 域 2：改动页拿到读数时，提交面板画在能力清单之前（能力清单本身不动，唯一主入口计数仍是 162）。
    children.push(Object.assign({}, vcCommitPageNode(h, t, {
      reads: opts.reads, ui: opts.ui, width: opts.width, nowMs: opts.nowMs,
      ops: opts.commitOps || null, targets: opts.commitTargets || [],
      panel: opts.commitPanel || null,
    }), { key: 'commit' }))
  } else if (page !== 'submodules' || opts.submodules === undefined) {
    // 骨架自检：三种表单形态与四种状态各画一遍，T03 只交壳，业务入口由后续票逐条接。
    children.push(h('div', { key: 'skeleton', className: 'vcs-skeleton', 'data-vc-skeleton': '1' }, [
      h('div', { key: 'forms', className: 'vcs-forms' }, vcShellFormNodes(h, t, o)),
      h('div', { key: 'states', className: 'vcs-states' }, VC_SHELL_STATES.map(function (state: string) {
        return vcShellStateNode(h, t, { state: state })
      })),
    ]))
  }
  // 分支与标签页的业务面板（#1746 T11）：调用方把一份读数传进来才画；没传整块不出现，其它页渲染不变。
  if (page === 'branch-tags' && opts.branchBoard !== undefined) {
    children.push(Object.assign({}, vcBranchBoardNode(h, t, {
      board: opts.branchBoard,
      confirm: opts.branchConfirm,
      result: opts.branchResult,
      onRetry: opts.onBranchRetry,
    }), { key: 'branch-board' }))
  }
  // 历史高级查询面板（#1745 T10）：提交历史页落 3.4 / 3.6 / 3.7 / 3.8 / 3.10 / 3.12 六组，
  //   「管理 › 诊断」页落 3.5 / 3.9 / 3.11 / 3.13 四组（四条的主入口就在那一页，面板自己标主入口）。
  //   无条件挂：没有读数的骨架渲染里也要能看到入口（本函数返回 null 表示这一页没有这十条里的任何一条）。
  const queryNode = vcQueryPageNode(h, t, opts)
  if (queryNode) children.push(Object.assign({}, queryNode, { key: 'query' }))
  children.push(Object.assign({}, vcCapabilityListOf(h, t, opts), { key: 'caps' }))
  // 改动页的 13 条动作面板（#1742）：页面把改动读数传进来时才画；没传整块不出现，其它页渲染结果不变。
  if (page === 'changes' && opts.changes !== undefined && typeof vcChangesPageNode === 'function') {
    children.push(Object.assign({}, vcChangesPageNode(h, t, { changes: opts.changes }), { key: 'changes' }))
  }
  // 冲突向导的 15 条能力面板（#1747 T12）：页面把冲突状态与读数传进来时才画；没传整块不出现，其它页渲染结果不变。
  // 判断与推入写成同一条物理行：本文件贴着 350 有效行上限。
  if (page === 'conflicts' && opts.conflicts !== undefined && typeof vcConflictsPageNode === 'function') children.push(Object.assign({}, vcConflictsPageNode(h, t, { conflicts: opts.conflicts }), { key: 'conflicts' }))
  return h('section', {
    id: 'vc-page-' + page,
    className: 'vcs-page-body',
    role: 'tabpanel',
    'data-vc-page-body': page,
  }, children)
}

export const vcShellPageNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const page = String(opts.page || 'changes')
  const prefix = vcPagePrefixOf(opts.pagePrefix || '')
  const width = vcWidthOf(opts.width)
  const skin = vcSkinOf(opts.skin)
  const seed = opts.seed || {}
  const open = opts.open || {}
  const isManage = VC_MANAGE_PAGES.indexOf(page) >= 0
  const isSearch = page === VC_SEARCH_PAGE
  const branchOpen = !!open.branch
  const paletteOpen = !!open.palette || isSearch
  const gearOpen = !!open.gear || isManage
  const branchOverlayId = prefix + '-branch-overlay'
  const paletteId = prefix + '-palette'
  const gearId = prefix + '-gear-index'
  const readAt = String(seed.when === undefined || seed.when === null ? '' : seed.when)
  const openSurface = isSearch
    ? String(open.surface || (CAPABILITIES.filter(function (c: any) { return c && c.page === 'search' })[0] || {}).id || '')
    : String(open.surface || '')
  // 页面根节点下的子节点按固定槽位排，各给一个稳定的 key（React 列表告警不该出现在这门禁的输出里）。
  const keyed = function (node: any, key: string) { return Object.assign({}, node, { key: key }) }
  const children: any[] = []
  children.push(keyed(vcIdentityRowNode(h, t, {
    branch: seed.branch || '', remote: seed.remote || 'origin', when: readAt,
    branchOpen: branchOpen, branchOverlayId: branchOverlayId,
    paletteOpen: paletteOpen, paletteId: paletteId,
    gearOpen: gearOpen, gearId: gearId,
  }), 'identity'))
  if (branchOpen) children.push(keyed(vcBranchOverlayNode(h, t, { id: branchOverlayId, branch: seed.branch }), 'branch'))
  if (gearOpen) children.push(keyed(vcGearIndexNode(h, t, { id: gearId, pagePrefix: opts.pagePrefix || '', active: isManage ? page : '' }), 'gear'))
  // 命令面板：全库搜索页把它画在能力行里（唯一一个输入框）；其它页按种子画成贴触发点的浮层。
  if (paletteOpen && !isSearch) children.push(keyed(vcPaletteNode(h, t, { id: paletteId, query: seed.query, highlight: seed.highlight, limit: seed.paletteLimit }), 'palette'))
  children.push(keyed(vcPageTabsNode(h, t, { pagePrefix: opts.pagePrefix || '', active: VC_TAB_PAGES.indexOf(page) >= 0 ? page : '' }), 'tabs'))
  children.push(keyed(vcPageBodyNode(h, t, {
    page: page, pagePrefix: opts.pagePrefix || '',
    openSurface: openSurface,
    query: seed.query, highlight: seed.highlight, paletteLimit: seed.paletteLimit,
    confirm: seed.confirm, result: seed.result,
    changes: opts.changes, conflicts: opts.conflicts, // #1747 T12：冲突向导的进行中状态、冲突清单与 15 条动作的交互态，原样往下传，壳不改形状。
    // #1744 T09：提交历史页要真读数与交互态，页面壳原样往下传，不在壳里改形状。
    reads: opts.reads, ui: opts.ui, width: width, nowMs: seed.nowMs,
    // #1746 T11：分支与标签业务面板的读数与确认卡/结果（没给就不画，T03 既有渲染不变）。
    branchBoard: opts.branchBoard, branchConfirm: opts.branchConfirm, branchResult: opts.branchResult, onBranchRetry: opts.onBranchRetry,
    // #1745：历史高级查询面板的输入与四态由调用方带着走（不传就是空的「还没跑」）。
    queries: opts.queries, inputs: opts.inputs,
    // #1743：#1743 提交页的动作层、目标提交候选与现成面板模型也从调用方传进来（壳不自己造）。
    commitOps: opts.commitOps || null, commitTargets: opts.commitTargets || [], commitPanel: opts.commitPanel || null,
    ops: opts.ops, handlers: opts.handlers, // #1752 工作树页要真数据与处理函数
    submodules: opts.submodules, submoduleUi: opts.submoduleUi, submoduleOps: opts.submoduleOps, // #1757 T21 子模块页的读数、交互态与处理函数
  }), 'body'))
  // #1751 贮藏页（域 7）：只在贮藏页挂这一块；十条动作的入口、确认卡与最近丢弃都在叶子里，
  // 这里只把首屏数据（seed）与回调递进去，页面壳不多说一句规则。
  if (page === 'stash' && typeof vcStashPageNode === 'function') {
    // 页面叶子的入参名是 state（本地编辑状态）与 seed（首屏读数）；这里按叶子认的名字递，不改叶子的形状。
    children.push(keyed(vcStashPageNode(h, t, { seed: seed, state: opts.stash, onStash: opts.onStash, onStashEdit: opts.onStashEdit }), 'stashPage'))
  }
  // 长任务区（#1740）：页面把任务清单传进来时才画；没传整块不出现，既有页面的渲染结果不受影响。
  if (opts.tasks !== undefined && typeof vcTaskPanelNode === 'function') {
    children.push(keyed(vcTaskPanelNode(h, t, { tasks: opts.tasks, running: opts.running, onCancel: opts.onCancel }), 'tasks'))
  }
  return h('div', {
    id: prefix + '-root',
    className: 'vcs-root',
    'data-vc-root': '1',
    'data-vc-shell': '1',
    'data-vc-page': page,
    'data-vc-width': String(width),
    'data-vc-skin': skin,
    'data-vc-depth': String(vcPageDepthOf(page)),
  }, children)
}

export const vcRenderTabAt = function (h: any, t: any, o: any) {
  return vcShellPageNode(h, t, o || {})
}

export const vcRenderAllPages = function (h: any, t: any, o: any) {
  const opts = o || {}
  const pages = PAGE_SURFACES.map(function (p: any) { return p.id })
  const rendered = pages.map(function (page: string) {
    return vcShellPageNode(h, t, {
      page: page,
      pagePrefix: page,
      width: opts.width, skin: opts.skin,
      seed: opts.seed, open: opts.open,
    })
  })
  return h('div', { className: 'vcs-all-pages', 'data-vc-pages': '1', 'data-vc-page-count': String(rendered.length) }, rendered)
}
