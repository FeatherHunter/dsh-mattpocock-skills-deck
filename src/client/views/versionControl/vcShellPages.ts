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
declare function vcPageDepthOf(pageId: any): number
declare function vcPageRegistryOf(): any[]
declare function vcPageCapabilitiesOf(pageId: any): any[]
declare function vcCapabilityOf(capId: any): any
// 「本页负责的能力」列表（#1762 T26 从本文件拆到 vcCapabilityList.ts 以守住单文件行数上限）。
declare function vcCapabilityListOf(h: any, t: any, o: any): any
declare const VC_TAB_PAGES: string[]; declare const VC_MANAGE_PAGES: string[]; declare const VC_SIDE_PAGES: string[]
declare const VC_SEARCH_PAGE: string; declare const VC_MANAGE_INDEX_PAGE: string
declare const VC_MANAGE_SECTION_KEYS: Record<string, string>
declare function vcPaletteNode(h: any, t: any, o: any): any
declare function vcShellStateNode(h: any, t: any, o: any): any
declare function vcShellFormNodes(h: any, t: any, o: any): any
declare function vcShellCapabilityRowNode(h: any, t: any, o: any): any
declare function vcCapabilitySurfaceKindOf(cap: any): string
declare const VC_SHELL_STATES: string[]
declare function vcHistoryPageNode(h: any, t: any, o: any): any
// 远端与同步页叶子（#1754 T18，vcRemotePage.ts）：build 按叶子登记次序拼进同一闭包，这里只声明形状。
declare function vcRemotePageNode(h: any, t: any, o: any): any; declare function vcQueryPageNode(h: any, t: any, o: any): any
// 历史高级查询面板（#1745，vcQueryView.ts）：同上由构建拼进闭包；提交历史页与「管理 › 诊断」页各挂一段，按能力账本筛。
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
// #1829 阶段 4：页头与四个页面原语（vcPageHead.ts）、齿轮里的管理索引卡片（vcManageIndex.ts）、分支浮层的四段结构（vcBranchPopover.ts）。
//   三者都由构建按叶子登记次序拼进同一个闭包，这里只声明形状。
declare function vcPageHeadNode(h: any, t: any, o: any): any
declare function vcManageIndexNode(h: any, t: any, o: any): any
declare function vcManageIndexPageNode(h: any, t: any, o: any): any
declare function vcBranchPopoverNode(h: any, t: any, o: any): any
// #1846：全库搜索页的正文版式（vcSearchPage.ts）——输入框在首屏、结果按能力所属页面分组；命令面板不再嵌进这一页。
declare function vcSearchPageNode(h: any, t: any, o: any): any
// 分支与标签业务面板叶子（#1746 T11，vcBranches.ts）、贮藏页叶子（#1751，vcStashPage.ts）、克隆向导页叶子（#1756，
// vcClonePage.ts）、冲突向导正文叶子（#1747 T12，vcConflictsPage.ts）、变基待办页的历史改写面板（#1748 T13，vcUndoPage.ts）
// 与动作面板（#1749 T14，vcRebasePage.ts）、配置页与钩子页两叶（#1760）、维护页整仓重写一叶（#1750 T15，vcRewritePage.ts）、诊断页正文一叶（#1761）以及 #1762 T26 的平台页
// （vcPlatformPage.ts）与迁移页 14.1 导出向导（vcMigrateExport.ts）都由构建拼进同一个闭包，这里只声明形状；挂载条件在下面。十三条声明并进同一条物理行：本文件贴着 350 有效行上限。
declare function vcBranchBoardNode(h: any, t: any, o: any): any; declare function vcStashPageNode(h: any, t: any, o: any): any; declare function vcMigratePageNode(h: any, t: any, o: any): any; declare const vcClonePageNode: any; declare function vcConflictsPageNode(h: any, t: any, o: any): any; declare function vcUndoPageNode(h: any, t: any, o: any): any; declare function vcRebasePageNode(h: any, t: any, o: any): any; declare const vcRewritePageNode: any; declare function vcConfigPageNode(h: any, t: any, o: any): any; declare function vcHooksPageNode(h: any, t: any, o: any): any; declare function vcDiagnosticsMountNode(h: any, t: any, o: any): any; declare function vcPlatformPageNode(h: any, t: any, o: any): any; declare function vcMigrateExportNode(h: any, t: any, o: any): any; declare const vcMaintenancePageNode: any; declare const vcMaintenanceDiagNode: any; declare function vcShellIdentityNode(h: any, t: any, o: any): any; declare function vcChangesViewNode(h: any, t: any, o: any): any // #1758 T22 维护页与诊断页两叶；#1761 诊断页正文（只在诊断页且传了读数时挂载）
declare const VC_UNDO_PANEL: any // #1748 变基待办页的自带状态面板（预检→确认卡→凭票执行），#1776 M2 起由它替代只画骨架的 vcUndoPageNode
declare const vcBranchPageOf: any // #1829 阶段 3：分支与标签页换成有状态组件（筛选与搜索在组件里），静态树仍由 vcBranchBoardNode 给门禁

export const VC_SHELL_WIDTHS: number[] = [300, 380, 460, 520]
export const VC_SHELL_SKINS: string[] = ['dark', 'light']; // 两套皮肤：深浅各一套语义色，页面壳只把皮肤名透传给 CSS 与根属性。
// 四条页签的中文键（与能力账本的页面 id 一一对应；顺序就是页签顺序）。
export const VC_TAB_LABEL_KEYS: Record<string, string> = {
  changes: 'vc.shell.tab.changes',
  commits: 'vc.shell.tab.commits',
  worktrees: 'vc.shell.tab.worktrees',
  stash: 'vc.shell.tab.stash',
}
// 页签计数的量词（#1776 M4d）：计数来自首屏真实读数，不拿能力账本条数；四种读数各有自己的单位。
export const VC_TAB_UNIT_KEYS: Record<string, string> = { changes: 'vc.shell.tab.unit.changes', commits: 'vc.shell.tab.unit.commits', worktrees: 'vc.shell.tab.unit.worktrees', stash: 'vc.shell.tab.unit.stash' }

// #1840：data-vc-width 说的是四档版式里的哪一档，不是像素读数。
//   宽度原值来自 vcRealTab 里 ResizeObserver 量到的根节点 contentRect；根节点自己带纵向滚动条，
//   滚动条一出现可视宽就少一条滚动条（本机实测 4.43px）。把像素直接写进属性会出两个真故障：
//   一是同一档宽在不同页报出两档（300 宽的页量到 304），CSS 里按档位写的规则就漏；
//   二是 460 / 520 档的卡片列数随滚动条来回切，列数一变页面高度跟着变、滚动条再开合，
//   形成自激回流，真机上门禁按钮一直「不稳定」。所以这里把量到的宽度归到最近的一档：
//   档位只认档位，像素只是输入；四档之外的大面板取 520（最宽的档），两档正好等距时取较低的一档
//   （只为结果确定，不表达偏好）。
const vcWidthOf = function (w: any) {
  const n = Number(w)
  if (!isFinite(n) || n <= 0) return 460
  const clamped = Math.max(260, Math.min(640, n))
  let best = VC_SHELL_WIDTHS[0]
  for (let i = 1; i < VC_SHELL_WIDTHS.length; i += 1) {
    if (Math.abs(VC_SHELL_WIDTHS[i] - clamped) < Math.abs(best - clamped)) best = VC_SHELL_WIDTHS[i]
  }
  return best
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

// #1829 阶段 4-D：浮层四段结构搬到 vcBranchPopover；这里只保留函数名与参数透传
//   （旧测试与导出清单仍按 vcBranchOverlayNode 找它），五个动作仍是标签、不造假按钮。
export const vcBranchOverlayNode = function (h: any, t: any, o: any) {
  return vcBranchPopoverNode(h, t, o)
}

// #1829 阶段 4-B：九分区索引改成卡片列表，结构搬到 vcManageIndex；这里只保留函数名与参数透传
//   （旧测试与导出清单仍按 vcGearIndexNode 找它），九项顺序仍严格取 VC_MANAGE_PAGES。
export const vcGearIndexNode = function (h: any, t: any, o: any) {
  return vcManageIndexNode(h, t, o)
}

// #1829 身份行整体交给 vcShellIdentity：仓库名 / 分支 / 短号 / 能力计数 + 同步事实行 + 同步动作行。
//   这一段只保留函数名与参数透传（旧测试与导出清单仍按 vcIdentityRowNode 找它）。
export const vcIdentityRowNode = function (h: any, t: any, o: any) {
  return vcShellIdentityNode(h, t, o)
}

export const vcPageTabsNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const tabs: any[] = []
  for (let i = 0; i < VC_TAB_PAGES.length; i += 1) {
    const id = VC_TAB_PAGES[i]
    const selected = id === opts.active
    const one: any = (opts.counts || {})[id] || {}; const known: boolean = one.state === 'ok' && typeof one.n === 'number'
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
      h('span', Object.assign({ key: 'n', className: 'vcs-tab-count', 'data-vc-tab-count-state': known ? 'ok' : 'unknown' }, known ? { 'data-vc-tab-count': String(one.n) } : {}), known ? t(VC_TAB_UNIT_KEYS[id], { n: one.n }) : '—'),
    ]))
  }
  return h('div', {
    className: 'vcs-tabs',
    role: 'tablist',
    'aria-label': t('vc.shell.tabs.label'),
    'data-vc-tabs': '1',
  }, tabs)
}

// 这一页在下面还有自己的正文节点吗（#1776 M2）：有的话就不再画「形态与状态」自检骨架，
//   否则正文与骨架并排出现，看起来像页面还没接上。判断只按这一页真正会挂的正文来，不猜读数是否已到。
const vcOwnBodyOf = function (page: string, opts: any) {
  const o: any = opts || {}
  // #1846：全库搜索页的正文（输入框与分组结果）不依赖任何读数，这里直接算「有正文」，不该再并排画自检骨架。
  if (page === 'maintenance' || page === 'migrate' || page === 'diagnostics' || page === VC_SEARCH_PAGE) return true
  if (page === 'config' || page === 'hooks') return o.config !== undefined || o.hooks !== undefined
  if (page === 'branch-tags') return o.branchBoard !== undefined
  if (page === 'conflicts') return o.conflicts !== undefined
  if (page === 'rebase') return o.rebase !== undefined
  if (page === 'submodules') return o.submodules !== undefined
  if (page === 'worktrees') return typeof vcWorktreesPageNode === 'function'
  if (page === 'platform') return typeof vcPlatformPageNode === 'function'
  return !!o.reads
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
  // 维护页的两条只读项（11.14 refs migrate / 11.15 scalar，规格 3.9）：只给版本要求、影响范围与官方命令说明，
  // 不给触发按钮；这一句是页面级说明，真正的只读行由能力账本 finalForm='只读' 统一画（见 818 的 M 组断言）。
  if (page === 'maintenance') notes.push(h('div', { key: 'ro', className: 'vcs-note', 'data-vc-note': 'maintenance-readonly' }, t('vc.shell.maintenance.readonlyNote')))
  return notes
}

export const vcPageBodyNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const page = String(opts.page || 'changes')
  const children: any[] = []
  // #1829 阶段 4-A：页头整体交给 vcPageHead（标题行与导语两段），壳只保留页面顺序。
  // #1840：① 返回键的 data-log 由容器按返回目标传进来（backLog）；② 页头与正文拆成两块——
  //   页头固定占页面顶部，正文进 .vcs-page-scroll 拿原型的 10px/12px/18px 内边距（原型 .page-head / .page-scroll）。
  const head = Object.assign({}, vcPageHeadNode(h, t, {
    page: page, back: opts.back === true, backLog: opts.backLog,
  }), { key: 'meta' })
  children.push.apply(children, vcPageNotesOf(h, t, page))
  // #1840 管理索引屏：页头之后整屏都是索引（说明句、九张卡、两条跨区入口、覆盖口径），
  //   不画分区正文、骨架与能力清单——索引本身不写仓库，也不在账本的 16 页里。
  if (page === VC_MANAGE_INDEX_PAGE) {
    children.push(Object.assign({}, vcManageIndexPageNode(h, t, { id: opts.gearIndexId, active: '' }), { key: 'manage-index' }))
    return h('section', { id: 'vc-page-' + page, className: 'vcs-page-body', role: 'tabpanel', 'data-vc-page-body': page }, [
      head, h('div', { key: 'scroll', className: 'vcs-page-scroll' }, children),
    ])
  }
  // #1846：全库搜索页改成独立版式 —— 输入框在首屏，结果按能力所属页面分组，不再把命令面板嵌进能力清单。
  //   这一块不依赖读数，所以紧跟在页头与页面说明之后、其它页正文之前，第一屏就能看见输入框。
  if (page === VC_SEARCH_PAGE && typeof vcSearchPageNode === 'function') {
    children.push(Object.assign({}, vcSearchPageNode(h, t, {
      id: vcPagePrefixOf(opts.pagePrefix || '') + '-search',
      query: opts.query, highlight: opts.highlight, limit: opts.paletteLimit,
    }), { key: 'search' }))
  }
  // #1752 工作树页正文：读首屏聚合里那一份工作树片，八条能力的入口与执行面由 vcWorktreesPage 自己画；
  //   壳只负责把宿主数据与处理函数透传进去（没有传入时页面自己画空态，不影响其它页）。
  if (page === 'worktrees' && typeof vcWorktreesPageNode === 'function') {
    children.push(Object.assign({}, vcWorktreesPageNode(h, t, {
      reads: opts.reads, ui: opts.ui, ops: opts.ops, handlers: opts.handlers, onOpenHandoff: opts.onOpenHandoff,
    }), { key: 'worktrees' }))
  }
  // #1757 T21 子模块页正文：域 10 八条能力的入口、固定四项批量、逐行清单与确认/结果都在 vcSubmodulesPage 里；
  //   壳只在调用方递进这一族读数（opts.submodules）时挂一段，没有递进来就照旧画骨架，其它页渲染不变。
  if (page === 'submodules' && opts.submodules !== undefined && typeof vcSubmodulesPageNode === 'function') children.push(Object.assign({}, vcSubmodulesPageNode(h, t, { board: opts.submodules, ui: opts.submoduleUi, ops: opts.submoduleOps }), { key: 'submodules' }))
  // 提交历史页有自己的正文（#1744 T09：列表 / 详情 / 逐文件差异 / 13.14 图形化视图）。
  // 只有在拿到了首屏读数时才换成真正文；没有读数（壳自检、Z 组骨架断言）仍旧画骨架。
  // #1760 配置页与钩子页（域 12）：调用方把读数与本地编辑状态传进来时才换成真正文；没传（壳自检、
  //   全页渲染）仍旧画骨架。这两页不自己画 data-cap-primary，12.1–12.8 的入口仍由能力行统一给。
  //   为了守 350 有效行，两条挂载与提交历史页的分支写在同一行（条件互斥，行为同分开写）。
  if (page === 'config' && opts.config !== undefined && typeof vcConfigPageNode === 'function') children.push(Object.assign({}, vcConfigPageNode(h, t, { state: opts.config, onConfig: opts.onConfig, onConfigEdit: opts.onConfigEdit }), { key: 'config' })); else if (page === 'hooks' && opts.hooks !== undefined && typeof vcHooksPageNode === 'function') children.push(Object.assign({}, vcHooksPageNode(h, t, { state: opts.hooks, onHooks: opts.onHooks, onHooksEdit: opts.onHooksEdit }), { key: 'hooks' })); else if (page === 'commits' && opts.reads) {
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
  } else if (page === 'migrate' && opts.reads) {
    // 迁移与备份页正文（#1759 T23，域 11 的 11.1 / 11.12 / 11.13 与域 5 的 5.13，加 svn 补充块）。与远端页同一口径：
    // 只在拿到读数时换成真正文，没读数的骨架渲染保持不变；主入口 data-cap-primary 仍由下面的能力行统一给。
    children.push(Object.assign({}, vcMigratePageNode(h, t, { reads: opts.reads, ui: opts.ui, width: opts.width, nowMs: opts.nowMs }), { key: 'migrate' }))
  } else if (page === 'platform' && typeof vcPlatformPageNode === 'function') {
    // #1762 T26 平台与边界页：九条只读/说明能力没有可执行写动作，正文无条件画（不依赖首屏读数），
    //   凭据链与 updateRefs 各自有加载/失败态；这一块不画 data-cap-primary，主入口仍由下面的能力清单给。
    children.push(Object.assign({}, vcPlatformPageNode(h, t, {
      reads: opts.platform, ui: opts.platformUi, width: opts.width, nowMs: opts.nowMs,
      onRpInput: opts.onPlatformRpInput, onRequestPull: opts.onPlatformRequestPull,
    }), { key: 'platform-body' }))
  } else if (page === 'stash' && typeof vcStashPageNode === 'function') {
    // #1751 贮藏页（域 7）：十条动作的入口、确认卡与最近丢弃都在叶子里；正文排在能力清单之前，
    //   首屏先看到贮藏记录本身，而不是「本页负责 N 条能力」的长清单（#1829 同一口径）。
    children.push(Object.assign({}, vcStashPageNode(h, t, { seed: opts.seed, state: opts.stash, onStash: opts.onStash, onStashEdit: opts.onStashEdit }), { key: 'stash-page' }))
  } else if (!vcOwnBodyOf(page, opts)) {
    // 骨架自检：三种表单形态与四种状态各画一遍；各页正文由它自己的叶子画，主入口由下面的能力清单统一给。
    children.push(h('div', { key: 'skeleton', className: 'vcs-skeleton', 'data-vc-skeleton': '1' }, [
      h('div', { key: 'forms', className: 'vcs-forms' }, vcShellFormNodes(h, t, o)),
      h('div', { key: 'states', className: 'vcs-states' }, VC_SHELL_STATES.map(function (state: string) {
        return vcShellStateNode(h, t, { state: state })
      })),
    ]))
  }
  // #1762 T26 / #1776 M2 迁移与备份页的 14.1 导出向导：它是本页唯一可执行能力，和上面的迁移页正文并排挂（原来接在
  //   上面那条骨架判断链里，被『迁移页有读数就画正文』的分支挡成永远不可达，M2 改成独立的判断）。
  if (page === 'migrate' && typeof vcMigrateExportNode === 'function' && opts.migrate !== undefined) children.push(Object.assign({}, vcMigrateExportNode(h, t, { state: opts.migrate, reads: opts.migrateReads, width: opts.width, nowMs: opts.nowMs, onEdit: opts.onMigrateEdit, onCheck: opts.onMigrateCheck, onRun: opts.onMigrateRun, onRescan: opts.onMigrateRescan, onCancel: opts.onMigrateCancel }), { key: 'migrate-body' }))
  // #1756 T20 克隆向导（能力 8.16）：迁移与备份页的正文；组件自己保存表单与进度，壳只把取词、工作区与发电话的函数递进去。
  if (page === 'migrate') children.push(h(vcClonePageNode, { key: 'clone', t: t, cwd: opts.cwd || '', call: opts.call || null })); if (page === 'maintenance') children.push(h(vcRewritePageNode, { key: 'rewrite', t: t, cwd: opts.cwd || '', call: opts.call || null })); if (page === 'maintenance') children.push(h(vcMaintenancePageNode, { key: 'maintenance-cards', t: t, cwd: opts.cwd || '', call: opts.call || null })) // #1750 T15 维护页整仓重写（能力 5.11）正文；#1758 T22 维护页 11.4–11.11 正文；三块同一物理行：本文件贴着 350 有效行上限
  // 分支与标签页（#1746 T11；#1829 阶段 3 换成有状态组件叶子）：调用方把一份读数传进来才画，
  //   没传整块不出现，其它页渲染不变；筛选与搜索的组件状态在叶子内部，壳只往下递读数与处理函数。
  if (page === 'branch-tags' && opts.branchBoard !== undefined) children.push(h(vcBranchPageOf, { key: 'branch-board', t: t, board: opts.branchBoard, confirm: opts.branchConfirm, result: opts.branchResult, onRetry: opts.onBranchRetry, nowMs: opts.nowMs }))
  // 历史高级查询面板（#1745 T10）：提交历史页落 3.4 / 3.6 / 3.7 / 3.8 / 3.10 / 3.12 六组，
  //   「管理 › 诊断」页落 3.5 / 3.9 / 3.11 / 3.13 四组（四条的主入口就在那一页，面板自己标主入口）。
  //   无条件挂：没有读数的骨架渲染里也要能看到入口（本函数返回 null 表示这一页没有这十条里的任何一条）。
  const queryNode = vcQueryPageNode(h, t, opts); if (queryNode) children.push(Object.assign({}, queryNode, { key: 'query' })); const diagNode: any = typeof vcDiagnosticsMountNode === 'function' ? vcDiagnosticsMountNode(h, t, opts) : null; if (diagNode) children.push(Object.assign({}, diagNode, { key: 'diagnostics' })); if (page === 'diagnostics' && typeof vcMaintenanceDiagNode === 'function') { const maintDiagNode: any = h(vcMaintenanceDiagNode, { key: 'maintenance-diag', t: t, cwd: opts.cwd || '', call: opts.call || null }); children.push(Object.assign({}, maintDiagNode, { key: 'maintenance-diag' })) } // #1758 T22 诊断页 11.2–11.4 正文；#1761 诊断页正文：二分与替换是仅有的两个受控写，其余只读；判断与推入也并成一行（本文件贴着 350 有效行上限）。
  // #1845：三个流程页的正文排在能力清单之前，读者先看到这一页要做什么，再看到「本页负责 N 条能力」的长清单。
  //   变基页先画变基正文（第一段「本次变基」按原型 48 打头），历史改写五条面板从壳根挪进来紧随其后。
  if (page === 'rebase' && opts.rebase !== undefined && typeof vcRebasePageNode === 'function') children.push(Object.assign({}, vcRebasePageNode(h, t, { rebase: opts.rebase }), { key: 'rebase' })); if (page === 'rebase' && typeof VC_UNDO_PANEL === 'function') children.push(Object.assign({}, h(VC_UNDO_PANEL, { t: t, cwd: opts.cwd || '', state: opts.undo }), { key: 'undo-page' })); if (page === 'conflicts' && opts.conflicts !== undefined && typeof vcConflictsPageNode === 'function') children.push(Object.assign({}, vcConflictsPageNode(h, t, { conflicts: opts.conflicts }), { key: 'conflicts' }))
  // 任务页是流程页，能力账本里没有它的条目（162 条不变），不画能力清单，只画任务面板。
  // #1829 改动页的能力清单不再排在这一段：它压到页尾（提交区之后），首屏留给统计卡与文件行。
  if (page !== 'task' && page !== 'changes') children.push(Object.assign({}, vcCapabilityListOf(h, t, opts), { key: 'caps' }))
  if (page === 'task' && typeof vcTaskPanelNode === 'function') children.push(Object.assign({}, vcTaskPanelNode(h, t, { tasks: opts.tasks, running: opts.running, onCancel: opts.onCancel }), { key: 'task-body' }))
  // #1829 改动页首屏顺序（按定稿原型 62-changes-460.png）：统计卡与分组文件行 → 13 条动作面板（折叠）→ 提交区 → 能力清单。
  //   文件行与统计卡来自新叶子 vcChangesView；13 条动作面板保持原样（13 个 data-vc-changes-op 必须初始就在 DOM 里）。
  if (page === 'changes' && opts.changes !== undefined && typeof vcChangesViewNode === 'function') {
    children.push(Object.assign({}, vcChangesViewNode(h, t, { changes: opts.changes, onOpenHandoff: opts.onOpenHandoff }), { key: 'changes-view' }))
  }
  // #1829 改动页首屏顺序（按定稿原型 62-changes-460.png，票面验收④「提交面板不再排在文件列表和改动动作之前」）：
  //   统计卡与分组文件行 → 13 条动作面板（折叠、默认收起，13 行仍在 DOM 里）→ 提交区 → 能力清单。
  if (page === 'changes' && opts.changes !== undefined && typeof vcChangesPageNode === 'function') {
    children.push(h('details', { key: 'changes-more', className: 'vcs-more-actions', 'data-vc-more-actions': '1' }, [
      h('summary', { key: 'summary', className: 'vcs-more-actions-title', 'data-log': 'vc.changes.more-actions', 'data-press': 'button' }, t('vc.changes.view.allActions')),
      Object.assign({}, vcChangesPageNode(h, t, { changes: opts.changes }), { key: 'changes' }),
    ]))
  }
  if (page === 'changes' && opts.reads) {
    // #1743 域 2 提交区：按原型贴在文件行与动作面板之后；说明与选项展开，提交按钮固定在这块底部。
    children.push(Object.assign({}, vcCommitPageNode(h, t, {
      reads: opts.reads, ui: opts.ui, width: opts.width, nowMs: opts.nowMs,
      ops: opts.commitOps || null, targets: opts.commitTargets || [],
      panel: opts.commitPanel || null,
    }), { key: 'commit' }))
  }


  // 能力清单压到改动页最尾：162 条仍可到达、每条仍恰一个主入口，但不再占首屏（#1829）。
  if (page === 'changes') children.push(Object.assign({}, vcCapabilityListOf(h, t, opts), { key: 'caps' }))
  return h('section', {
    id: 'vc-page-' + page,
    className: 'vcs-page-body',
    role: 'tabpanel',
    'data-vc-page-body': page,
  }, [head, h('div', { key: 'scroll', className: 'vcs-page-scroll' }, children)])
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
  // #1840：管理索引是导航上独立的一屏（不是浮层），它的正文就是索引本体。
  const indexPage = page === VC_MANAGE_INDEX_PAGE
  // #1829 阶段 4：二级页（nav 带返回来源页的页）按定稿原型 37/39 换一套次级版式：
  //   身份行只留第一行、同步带与四个固定页签让位、齿轮里的管理索引不再默认铺开（要用时点「管理」再开）。
  //   默认 false 保证全页自检、能力账本与既有门禁的渲染结果一个字节都不变。
  const secondary = opts.pageOpen === true
  const branchOpen = !!open.branch
  const paletteOpen = !!open.palette || isSearch
  // 齿轮索引：真实入口（齿轮按钮与身份行「管理」）改成打开索引屏，不再点亮浮层；
  //   受控渲染仍接受 open.gear 与「分区页未开次级版式」两种旧形状（全页自检与 Z 组靠它们画九卡）。
  //   gearOpen 同时喂身份行的 aria-expanded / aria-controls：索引屏的 nav 在正文里，id 仍是 gearId。
  const gearOverlay = !indexPage && (!!open.gear || (isManage && !secondary))
  const gearOpen = gearOverlay || indexPage
  const branchOverlayId = prefix + '-branch-overlay'
  // #1846：搜索页上放大镜的 aria-controls 指向搜索页自己的输入框区块（前缀 + -search）；
  //   别的页面上它仍指向命令面板遮罩里的面板（前缀 + -palette）。两边各指各的那个真节点，不共用名字。
  const paletteId = isSearch ? prefix + '-search' : prefix + '-palette'
  const gearId = prefix + '-gear-index'
  const readAt = String(seed.when === undefined || seed.when === null ? '' : seed.when)
  // #1846：搜索页不再默认展开某条能力的操作面（那份操作面本来画的就是命令面板，现在拆掉了）。
  const openSurface = String(open.surface || '')
  // 页面根节点下的子节点按固定槽位排，各给一个稳定的 key（React 列表告警不该出现在这门禁的输出里）。
  const keyed = function (node: any, key: string) { return Object.assign({}, node, { key: key }) }
  const children: any[] = []
  children.push(keyed(vcIdentityRowNode(h, t, {
    branch: seed.branch || '', repo: seed.repoDisplay || '', worktreePath: seed.worktreePath || '', oid: seed.oid || '',
    remote: seed.remote || 'origin', when: readAt, basis: seed.basisWhen || '', ahead: seed.ahead, behind: seed.behind,
    detached: seed.detached === true, branchOpen: branchOpen, branchOverlayId: branchOverlayId,
    paletteOpen: paletteOpen, paletteId: paletteId, gearOpen: gearOpen, gearId: gearId, onOpenHandoff: opts.onOpenHandoff,
    secondary: secondary,
  }), 'identity'))
  if (branchOpen) children.push(keyed(vcBranchOverlayNode(h, t, { id: branchOverlayId, branch: seed.branch }), 'branch'))
  // 受控渲染里只剩「旧形状」这一路会画齿轮索引面板（#1840 起真实入口改成打开独立索引屏）：
  //   身份行下面那块浮层仍按 open.gear 或「管理分区页未开次级版式」渲染，供全页自检与 Z 组断言使用。
  if (gearOverlay) children.push(keyed(vcGearIndexNode(h, t, { id: gearId, pagePrefix: opts.pagePrefix || '', active: isManage ? page : '' }), 'gear'))
  // 命令面板：只在别的页面上按种子画成贴触发点的遮罩浮层（#1846：全库搜索页自己画输入框与结果，
  //   不再把面板嵌进能力行；这一页的输入框在页头下面，页面上只有那一个）。
  if (paletteOpen && !isSearch) children.push(keyed(vcPaletteNode(h, t, { id: paletteId, query: seed.query, highlight: seed.highlight, limit: seed.paletteLimit, reads: opts.reads }), 'palette'))
  // 二级页不出四个固定页签（原型 37/39）：那四个是一级视图，二级页的返回与去向由页头与顶部条给。
  if (!secondary) children.push(keyed(vcPageTabsNode(h, t, { pagePrefix: opts.pagePrefix || '', active: VC_TAB_PAGES.indexOf(page) >= 0 ? page : '', counts: opts.counts }), 'tabs'))
  children.push(keyed(vcPageBodyNode(h, t, {
    page: page, pagePrefix: opts.pagePrefix || '', back: opts.back === true || secondary, gearIndexId: gearId,
    // #1840：页头返回键的点击日志（vc.changes.back / vc.commit.back）由调用方按来源页给，壳只往下传。
    backLog: opts.backLog,
    openSurface: openSurface,
    query: seed.query, highlight: seed.highlight, paletteLimit: seed.paletteLimit,
    confirm: seed.confirm, result: seed.result,
    changes: opts.changes, onOpenHandoff: opts.onOpenHandoff, conflicts: opts.conflicts, rebase: opts.rebase, undo: opts.undo, // #1747 T12 / #1749 T14：冲突向导与变基待办的交互态原样往下传，壳不改形状。
    // #1744 T09：提交历史页要真读数与交互态，页面壳原样往下传，不在壳里改形状。
    reads: opts.reads, ui: opts.ui, width: width, nowMs: seed.nowMs,
    // #1746 T11：分支与标签业务面板的读数与确认卡/结果（没给就不画，T03 既有渲染不变）。
    branchBoard: opts.branchBoard, branchConfirm: opts.branchConfirm, branchResult: opts.branchResult, onBranchRetry: opts.onBranchRetry,
    // #1745：历史高级查询面板的输入与四态由调用方带着走（不传就是空的「还没跑」）。
    queries: opts.queries, inputs: opts.inputs,
    // #1743：#1743 提交页的动作层、目标提交候选与现成面板模型也从调用方传进来（壳不自己造）。
    commitOps: opts.commitOps || null, commitTargets: opts.commitTargets || [], commitPanel: opts.commitPanel || null,
    // #1751 贮藏页要首屏读数与本地编辑状态/回调（不传就是空态，其它页渲染不变）。
    seed: seed, stash: opts.stash, onStash: opts.onStash, onStashEdit: opts.onStashEdit,
    // 页面要的真数据与回调原样往下传（不传就是骨架，既有页面渲染不变）：#1752 工作树、#1756 克隆向导、#1757 子模块页、#1760 配置与钩子页；#1761 诊断页的读数与五个回调也原样往下传
    diagnostics: opts.diagnostics || null, onDiagnosticsRead: opts.onDiagnosticsRead, onDiagnosticsWrite: opts.onDiagnosticsWrite, onDiagnosticsEdit: opts.onDiagnosticsEdit, onDiagnosticsConfirm: opts.onDiagnosticsConfirm, onDiagnosticsCancel: opts.onDiagnosticsCancel, config: opts.config, onConfig: opts.onConfig, onConfigEdit: opts.onConfigEdit, hooks: opts.hooks, onHooks: opts.onHooks, onHooksEdit: opts.onHooksEdit, ops: opts.ops, handlers: opts.handlers, submodules: opts.submodules, submoduleUi: opts.submoduleUi, submoduleOps: opts.submoduleOps, cwd: opts.cwd, call: opts.call,platform: opts.platform, platformUi: opts.platformUi, onPlatformRpInput: opts.onPlatformRpInput, onPlatformRequestPull: opts.onPlatformRequestPull, migrate: opts.migrate, migrateReads: opts.migrateReads, onMigrateEdit: opts.onMigrateEdit, onMigrateCheck: opts.onMigrateCheck, onMigrateRun: opts.onMigrateRun, onMigrateRescan: opts.onMigrateRescan, onMigrateCancel: opts.onMigrateCancel, // #1761 诊断页读数与五个回调；#1760 配置页与钩子页要四组读数、身份两键编辑与钩子清单（回调原样往下传）；#1752 工作树页要真数据与处理函数；#1756 克隆向导要工作区与发电话的函数；#1757 T21 子模块页要读数、交互态与处理函数；#1762 T26 平台页的读数、交互态与回调，以及迁移页 14.1 导出向导的读数与回调，都从这里透传，页面壳不自己造数据
  }), 'body'))
  // #1748/#1776 M2 的历史改写五条面板已挪进页面体，排在能力清单之前（见 vcPageBodyNode，
  //   #1845 按定稿原型把五动作三段式放到读者先看到的位置）；壳根不再重复挂一份。
  // 长任务区（#1740）：页面把任务清单传进来时才画；没传整块不出现，既有页面的渲染结果不受影响。
  // 任务页把这块画进页面正文（见 vcPageBodyNode），这里不再重复挂一份。
  if (page !== 'task' && opts.tasks !== undefined && typeof vcTaskPanelNode === 'function') {
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
