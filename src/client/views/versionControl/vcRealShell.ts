// views/versionControl/vcRealShell.ts —— 真实页签的导航动作与顶部条（#1776 M1/M2）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 职责：把「点到了什么」翻成导航与动作 —— 齿轮/深链跳页、命令面板选一条跳页并高亮、四个固定页签的键盘循环、
// 浮层开合，以及顶部那一行（读数时刻、返回来源页、手动刷新、三个额外入口）与首屏失败条（整次失败、片级失败与重试）。
// 这里只有纯函数与 h 调用，不持有状态：导航状态由容器给，动作由容器的动作层执行。
// 为什么单独一叶：容器已经装了九页的接线，再塞事件表会越过每文件 350 有效行的门禁。

declare const React: any
declare function vcRealNavTo(nav: any, page: any): any
declare function vcRealNavBack(nav: any): any
declare function vcRealNavToggle(nav: any, key: any): any
declare function vcRealNavCloseAll(nav: any): any
declare function vcRealNavQuery(nav: any, query: any): any
declare function vcRealTabStepOf(nav: any, key: any): any
declare function vcRealFailuresOf(reads: any): any[]
declare function vcRealWholeFailOf(reads: any): any
declare function vcRealSliceNameKeyOf(id: any): string
declare function vcFirstScreenStateOf(reads: any): string
declare function vcPaletteTargetOf(capId: any): any
declare function vcRealRemoteValuesOf(el: any): any
declare function vcRealMigrateFieldsOf(rootEl: any, action: any): any
declare function vcRealBranchFieldsOf(intent: any, current: any): any
declare const VC_REAL_EXTRA_LINKS: string[]
// #1860：四个一级页签的页 id 名单（vcShellPages 叶里定义），这里用它判断落点要不要保留来源页。
declare const VC_TAB_PAGES: string[]
// #1840：管理索引屏的页面 id。齿轮与身份行「管理」都跳到这一页，它是导航上的一站，不是浮层。
declare const VC_MANAGE_INDEX_PAGE: string
// #1846：全库搜索页的页面 id。在这一页上放大镜不弹命令面板，而是把焦点送回页面里那个输入框。
declare const VC_SEARCH_PAGE: string
declare function vcRealAiEntriesOf(reads: any, nav: any, t: any): any[]
declare function vcAiHandoffOf(o: any): any
declare function vcAiButtonNode(h: any, o: any): any
declare function vcOpenAiHandoff(o: any): boolean
declare function vcFirstScreenScreenOf(reads: any): any
declare var openTextInNewSession: any

// #842 与 ui-feedback 要求入口带这几枚 data-log 词条：刷新用 vc.reload，返回按来源页分 vc.changes.back /
// vc.commit.back，提交历史的行点开走 vc.row.open.<oid>。前两枚真实铺在按钮上，行那一枚由宿主的提交历史叶子挂。
export const VC_REAL_LOG_RELOAD = 'vc.reload'
export const VC_REAL_LOG_BACK_CHANGES = 'vc.changes.back'
export const VC_REAL_LOG_BACK_COMMIT = 'vc.commit.back'
export const VC_REAL_LOG_ROW_PREFIX = 'vc.row.open.'
// 顶部三个额外入口（命令面板搜索页、变基、冲突）的名单在 vcRealModel.ts 里定义，这一叶直接用。

// 跳页：导航状态由容器持有。keepBack 为真时保留来源页（齿轮九分区与深链进二级页，back 上记着从哪来）；
// 四个固定页签是同一层，切换时把 back 与高亮都清掉，免得二级页的返回按钮指向已经离开的页签。
export const vcRealGoPageOf = function (getNav: any, setNav: any): any {
  return function (page: any, keepBack: any): void {
    const next: any = vcRealNavTo(getNav(), page)
    if (keepBack !== true) next.back = null
    if (keepBack !== true) next.highlight = ''
    setNav(next)
  }
}

// 能力行与命令面板选一条：跳到该能力的页并高亮那一行；浮层无条件收起，同页落点也不会出现「点了没反应」。
export const vcRealSelectCapOf = function (getNav: any, setNav: any): any {
  return function (capId: any): void {
    const id: string = String(capId || '')
    if (id === '') return
    const target: any = vcPaletteTargetOf(id) || {}
    const page: string = String(target.page || getNav().page)
    const next: any = Object.assign({}, vcRealNavTo(getNav(), page), {
      highlight: id,
      open: { branch: false, palette: false, gear: false, surface: '' },
    })
    // #1860：落到四个一级页签上就按切页签处理——清掉来源页，一级页签不画返回键、也不进二级版式；
    //   落到二级页（管理九分区、分支页等）时才保留来源，页头返回键才回得去。
    if ((VC_TAB_PAGES || []).indexOf(page) >= 0) next.back = null
    setNav(next)
  }
}

// #1846：分支浮层的五个动作各自落到「真正做这件事的那一页的入口」。
//   分支与标签页只拥有 4.1–4.13：列表、新建、删除、重命名、上游、标签都在它这里；
//   合并属于域 6（冲突向导页的 6.1），变基属于域 6 的换基座（变基待办页）——账本没把这两条能力放在分支页，
//   所以这里跳到那两页的入口，而不是在分支页硬造两颗按钮（#1846 的边界：浮层动作只导航或打开对应入口）。
const VC_REAL_BRANCH_LANDING: any = {
  list: { page: 'branch-tags', sel: '[data-vc-branch-query]' },
  create: { page: 'branch-tags', sel: '[data-vc-branch-forms] [data-vc-branch-action="create"]' },
  delete: { page: 'branch-tags', sel: '[data-vc-branch-forms] [data-vc-branch-action="delete"]' },
  merge: { page: 'conflicts', sel: '[data-vc-conflicts-op="merge"]' },
  rebase: { page: 'rebase', sel: '[data-vc-rebase-op="rebase-onto"]' },
}
// 目标页的读数还没到时入口按钮还不存在：退到这一页页根里的第一个可操作控件（页根本身不是可聚焦元素，直接 focus 没有效果），
//   焦点至少落在目标页里，不留在已经关掉的浮层上。
const VC_REAL_LANDING_FALLBACK: any = {
  'branch-tags': '[data-vc-branch2]',
  conflicts: '[data-vc-conflicts-page]',
  rebase: '[data-vc-rebase-page]',
}
export const vcRealBranchLandingOf = function (action: any) {
  const key: string = String(action || '')
  return VC_REAL_BRANCH_LANDING[key] || VC_REAL_BRANCH_LANDING.list
}
// 跳页之后读数异步到位，入口按钮要等：每 100ms 找一次、最多 2 秒；找到就展开它所在的折叠区、滚进视野、聚焦。
//   只在找不到时才重试，找到就停——不轮询界面，也不改任何数据。
const VC_REAL_LANDING_TRIES = 20
export const vcRealFocusLandingOf = function (rootRef: any, target: any, attempt: any): void {
  if (typeof setTimeout !== 'function') return
  const left: number = Number(attempt) || 0
  setTimeout(function () {
    const root: any = rootRef && rootRef.current
    const findOf = function (sel: string) {
      if (!root || !sel || typeof root.querySelector !== 'function') return null
      return root.querySelector(sel)
    }
    const el: any = findOf(String((target && target.sel) || ''))
    if (!el) {
      if (left + 1 < VC_REAL_LANDING_TRIES) { vcRealFocusLandingOf(rootRef, target, left + 1); return }
      const pageEl: any = findOf(String(VC_REAL_LANDING_FALLBACK[String((target && target.page) || '')] || ''))
      const first: any = pageEl && typeof pageEl.querySelector === 'function' ? pageEl.querySelector(VC_REAL_FOCUSABLE) : null
      const aim: any = first || pageEl
      if (aim && typeof aim.focus === 'function') aim.focus({ preventScroll: true })
      return
    }
    // 入口在折叠区里时先展开，否则聚焦了也看不见它。
    const fold: any = el.closest ? el.closest('details') : null
    if (fold && fold.open !== true) fold.open = true
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
    if (typeof el.focus === 'function') el.focus({ preventScroll: true })
  }, left === 0 ? 0 : 100)
}
// 全库搜索页上放大镜的作用是把焦点送到页面里那个唯一的输入框（#1846）。
const vcRealFocusSearchInputOf = function (root: any): void {
  const box: any = root && typeof root.querySelector === 'function' ? root.querySelector('[data-vc-search-input]') : null
  if (box && typeof box.focus === 'function') box.focus({ preventScroll: true })
}

// 全部事件回调的名字（与 vcRealDelegate 的意图名一一对应）。容器把它们交给委托层，自己不逐颗按钮接 onClick。
// deps：getNav/getManage 读当前导航与管理页状态；setNav 落导航；rootRef 用来在跳转后把焦点送到目标按钮；
//   actionsRef 是首屏/提交/贮藏/工作树动作；manageActions 是分支/远端/同步动作；readsDispatchRef/configRef/
//   migrateRef 是管理页读数与迁移导出；goPage/selectCap 是上面两个导航函数。
export const vcRealCallbacksOf = function (deps: any): any {
  const getNav = deps.getNav
  const setNav = deps.setNav
  const rootRef = deps.rootRef
  const manageRef = deps.getManage
  const readsDispatchRef = deps.readsDispatchRef
  const migrateRef = deps.migrateRef
  const actionsRef = deps.actionsRef
  const manageActions = deps.manageActions
  const goPage = deps.goPage
  const selectCap = deps.selectCap
  return {
    page: function (intent: any) { goPage(intent && intent.page, true) },
    tab: function (intent: any) { goPage(intent && intent.page, false) },
    // 齿轮与身份行「管理」都打开管理索引屏（#1840）：索引是导航上的一站，不再当浮层开合；
    //   keepBack=true 让索引记下来源页，页头的返回键再把来源页带回来。
    manageOpen: function () { goPage(VC_MANAGE_INDEX_PAGE, true) },
    // #1846：全库搜索页上放大镜不弹面板（那一页页头下面就是唯一的输入框），只把焦点送回去；
    //   别的页面上它照旧切换命令面板遮罩。
    searchEntry: function () {
      const cur: any = getNav()
      if (cur && String(cur.page) === String(VC_SEARCH_PAGE)) { vcRealFocusSearchInputOf(rootRef.current); return }
      setNav(vcRealNavToggle(cur, 'palette'))
    },
    branchToggle: function () { setNav(vcRealNavToggle(getNav(), 'branch')) },
    branchClose: function () { setNav(vcRealNavCloseAll(getNav())) },
    sync: function () { goPage('remote', true) },
    palettePick: function (intent: any) { selectCap(intent && intent.capId) },
    capRow: function (intent: any) { selectCap(intent && intent.capId) },
    // #1846：点命令面板遮罩本身也关闭面板（Esc 另走 escape）；全库搜索页的结果行与输入框各有自己的意图，
    //   选中结果与命令面板选中同一条规则：只跳到那条能力的入口并高亮。
    paletteBackdrop: function () { setNav(vcRealNavCloseAll(getNav())) },
    searchPick: function (intent: any) { selectCap(intent && intent.capId) },
    searchInput: function (intent: any) { setNav(vcRealNavQuery(getNav(), intent && intent.value)) },
    paletteInput: function (intent: any) { setNav(vcRealNavQuery(getNav(), intent && intent.value)) },
    refresh: function () { actionsRef.current.refresh('manual') },
    sliceRetry: function (intent: any) { actionsRef.current.retrySlice(intent && intent.sliceId) },
    retryAll: function () { actionsRef.current.refresh('slice') },
    back: function () { setNav(vcRealNavBack(getNav())) },
    tabKey: function (intent: any) {
      const step: any = vcRealTabStepOf(getNav(), intent && intent.key)
      if (!step || !step.page) return
      setNav(step.nav)
      const root: any = rootRef.current
      if (root && typeof root.querySelector === 'function') {
        const btn: any = root.querySelector('[data-vc-tab="' + step.page + '"]')
        if (btn && typeof btn.focus === 'function') btn.focus()
      }
    },
    // Esc（规格第 343 行）：浮层开着先只关浮层；没有浮层而当前页有来源页时按 Esc 回来源页。
    //   回来源页后的滚动位置与筛选词由导航快照负责（vcRealNavBack 会把 pages 里存的那份带回来）。
    //   #1860 D6：提交选项菜单也是浮层的一种，虽然它不在 nav.open 里（状态在 ui.commit.menuOpen），
    //   所以先让提交动作层收一次菜单；菜单本来没开时它什么都不做。
    escape: function () {
      if (actionsRef.current && typeof actionsRef.current.commitOps === 'function') actionsRef.current.commitOps().closeMenu()
      const cur: any = getNav()
      const open: any = (cur && cur.open) || {}
      if (open.branch === true || open.palette === true || open.gear === true) { setNav(vcRealNavCloseAll(cur)); return }
      if (cur && cur.back) setNav(vcRealNavBack(cur))
    },
    historyOpen: function (intent: any) { actionsRef.current.openCommit(intent && intent.oid) },
    historyBack: function () { actionsRef.current.closeCommit() },
    loadMore: function () { actionsRef.current.loadMore() },
    historyRetry: function () { actionsRef.current.retrySlice('history') },
    filesRetry: function () { actionsRef.current.retryFiles() },
    fileDiffRetry: function () { actionsRef.current.retryFileDiff() },
    historyFile: function (intent: any) { actionsRef.current.openHistoryFile(intent && intent.path) },
    // 历史列表的筛选、只看合并、行尾菜单；菜单里的能力项只跳主入口并高亮，不在这里执行 git。
    historyQuery: function (intent: any) { actionsRef.current.historyQuery(intent && intent.value) },
    historyMerge: function () { actionsRef.current.historyMerge() },
    historyMenu: function (intent: any) { actionsRef.current.historyMenu(intent && intent.oid) },
    historyMenuClose: function () { actionsRef.current.historyMenu('') },
    historyMenuCap: function (intent: any) {
      actionsRef.current.historyMenu('')
      selectCap(intent && intent.capId)
    },
    historyMenuCopy: function (intent: any) {
      actionsRef.current.historyCopy(intent && intent.oid)
      actionsRef.current.historyMenu('')
    },
    // ———— 管理页 ————
    // 分支浮层的五个动作项只是 span（壳里没给按钮），点它跳到分支板并把焦点送到对应动作按钮。
    branchOverlay: function (intent: any) {
      const action: string = String((intent && intent.action) || '')
      const target: any = vcRealBranchLandingOf(action)
      // 分支页自己的三个动作仍走管理动作层（它顺带刷新分支板读数）；合并与变基只导航到真页面的入口，
      //   不在这里执行任何 git 写（#1846 的边界）。
      if (String(target.page) === 'branch-tags') manageActions.branch.overlay(action)
      else goPage(target.page, true)
      vcRealFocusLandingOf(rootRef, target, 0)
    },
    remoteTrigger: function (intent: any) { manageActions.remote.trigger(intent && intent.form, intent && intent.name) },
    remoteSubmit: function (intent: any) { manageActions.remote.submit(intent && intent.form, vcRealRemoteValuesOf(intent && intent.el)) },
    remoteCancel: function () { manageActions.remote.cancel() },
    remoteOnline: function (intent: any) { manageActions.remote.online(intent && intent.name) },
    remoteBack: function () { manageActions.remote.onlineBack() },
    remoteOnlineRetry: function () { manageActions.remote.onlineRetry() },
    remoteRetry: function () { manageActions.remote.retry() },
    remoteConfirmGo: function () { manageActions.remote.confirmGo() },
    remoteConfirmCancel: function () { manageActions.remote.cancel() },
    branchBtn: function (intent: any) {
      const it: any = intent || {}
      const board: any = ((manageRef() || {}).branch || {}).data || {}
      const current: string = String(((board.current || {}).name) || '')
      manageActions.branch.action(it.op, vcRealBranchFieldsOf(it, current))
    },
    branchTagBtn: function (intent: any) {
      const it: any = intent || {}
      const name: string = String(it.name || '')
      if (String(it.action) === 'verify') manageActions.branch.action(it.op, { object: name, objectKind: 'tag' })
      else manageActions.branch.action(it.op, { name: name })
    },
    branchConfirmGo: function () { manageActions.branch.confirmGo() },
    branchConfirmCancel: function () { manageActions.branch.confirmCancel() },
    branchRetry: function () { readsDispatchRef.current.readPage('branch-tags', true) },
    syncAct: function (intent: any) { manageActions.sync.expand(intent && intent.id) },
    syncCheck: function (intent: any) { manageActions.sync.check(intent && intent.id) },
    syncConfirmGo: function () { manageActions.sync.confirmGo() },
    syncConfirmCancel: function () { manageActions.sync.confirmCancel() },
    syncKind: function (intent: any) { manageActions.sync.kind(intent && intent.value) },
    syncCancel: function () { manageActions.sync.taskCancel() },
    syncRetry: function () { manageActions.sync.retry() },
    migrateAct: function (intent: any) { migrateRef.current.open(intent && intent.action) },
    migrateCheck: function (intent: any) { migrateRef.current.check(intent && intent.action) },
    migrateGo: function (intent: any) { migrateRef.current.go(intent && intent.action) },
    migrateCancel: function () { migrateRef.current.cancel() },
  }
}

// 顶部条：读数时刻、手动刷新、三个额外入口。刷新按钮在首屏读取中禁用。
//   #1840 起不再画顶栏返回键：二级页的返回只留页头那一颗，免得同一屏出现两颗作用相同的按钮。
//   两枚返回日志词条（vc.changes.back / vc.commit.back）仍由本叶导出，由 vcRealTab 按返回目标传给页头返回键。
export const vcRealBarNodesOf = function (h: any, tr: any, reads: any, nav: any, seed: any): any[] {
  const kids: any[] = [
    h('span', { key: 'at', className: 'vcs-live-at', 'data-vc-live-at': '1' }, seed.when ? tr('vc.shell.live.readAt', { when: seed.when }) : tr('vc.shell.live.loading')),
  ]
  kids.push(h('button', { key: 'refresh', type: 'button', className: 'vcs-live-refresh', 'data-vc-refresh': '1', 'data-press': 'button', 'data-log': VC_REAL_LOG_RELOAD, disabled: vcFirstScreenStateOf(reads) === 'loading' }, tr('vc.shell.live.refresh')))
  VC_REAL_EXTRA_LINKS.forEach(function (key: string) {
    const target: string = key === 'palette' ? 'search' : key
    kids.push(h('button', { key: 'link-' + key, type: 'button', className: 'vcs-live-link', 'data-vc-extra-link': target, 'data-press': 'button', 'data-log': 'vc.live.link.' + key }, tr('vc.shell.live.link.' + key)))
  })
  return kids
}

// 首屏失败条：整次失败给原因与一次重读；单片失败逐片给原因与片级重试，其它片照常画。
export const vcRealFailNodesOf = function (h: any, tr: any, reads: any): any[] {
  const nodes: any[] = []
  const whole: any = vcRealWholeFailOf(reads)
  if (whole) {
    nodes.push(h('p', { key: 'whole', className: 'vcs-live-fail', role: 'alert', 'data-vc-live-whole-fail': '1' }, tr('vc.shell.live.fail.whole', { message: whole.message })))
    nodes.push(h('button', { key: 'retry-all', type: 'button', className: 'vcs-live-retry', 'data-vc-retry-all': '1' }, tr('vc.shell.live.retryAll')))
  }
  const failures: any[] = vcRealFailuresOf(reads)
  failures.forEach(function (one: any) {
    nodes.push(h('p', { key: 'fail-' + one.id, className: 'vcs-live-fail', role: 'alert', 'data-vc-slice-fail': one.id },
      tr('vc.shell.live.fail.slice', { slice: tr(vcRealSliceNameKeyOf(one.id)), message: one.message || one.kind }),
      ' ',
      h('button', { key: 'retry', type: 'button', className: 'vcs-live-retry', 'data-vc-slice-retry': one.id }, tr('vc.shell.live.retry'))))
  })
  return nodes
}

// 「让 AI 帮我解决」入口（规格 48-50、79、387、440）：只在候选非空时画；点开时才把面板已读到的事实写成
//   prompt 交给既有新会话通路（openTextInNewSession），现象/目标/补充三节由 vcAiHandoffOf 留空给人补。
//   300/380 窄宽也不删入口，按钮在条里自己换行。
export const vcRealAiNodesOf = function (h: any, tr: any, reads: any, nav: any, st: any): any {
  const entries: any[] = vcRealAiEntriesOf(reads, nav, tr)
  if (!entries.length) return null
  const onOpen = function (ai: any): void {
    const handoff: any = vcAiHandoffOf({ ai: ai, t: tr, screen: vcFirstScreenScreenOf(reads) })
    vcOpenAiHandoff({ opener: typeof openTextInNewSession === 'function' ? openTextInNewSession : null, st: st || {}, handoff: handoff })
  }
  const nodes: any[] = entries.map(function (ai: any) {
    return Object.assign({}, vcAiButtonNode(h, { ai: ai, tr: tr, onOpen: onOpen, logId: ai.kind }), { key: 'ai-' + ai.kind })
  })
  // 外层 div 带固定 key：它会被拼进容器组件的 kids 数组，不带 key 时 React 每次渲染都要打一条警告。
  return h('div', { key: 'ai', className: 'vcs-live-ai', 'data-vc-live-ai': '1' }, nodes)
}
// 页面内「交给 AI」入口（定稿原型 62 的 composer-foot）：把一处具体难处交出去。参数与 vcRealAiNodesOf 同源，
//   ai 由调用点给（这里是「拿不准怎么拆提交」）；opener 走既有 openTextInNewSession，预填但不自动发送。
export const vcRealAiOpenOf = function (tr: any, reads: any, st: any, ai: any, opener: any): boolean {
  const handoff: any = vcAiHandoffOf({ ai: ai, t: tr, screen: vcFirstScreenScreenOf(reads) })
  return vcOpenAiHandoff({ opener: typeof opener === 'function' ? opener : null, st: st || {}, handoff: handoff })
}


// 可聚焦控件的选择器（规格第 391 行的焦点接管用）：禁用的与 tabindex=-1 的不算，第一个命中的就是落点。
const VC_REAL_FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
// 浮层打开时的落点：命令面板是搜索框，齿轮是索引第一项，分支浮层是第一个可聚焦控件（关闭键）。
const VC_REAL_FOCUS_OPEN: any = { palette: '[data-vc-palette-input]', gear: '[data-vc-gear-index]', branch: '[data-vc-branch-overlay]' }
// 浮层关掉后焦点回哪颗固定触发钮：键盘打开时浏览器没把焦点给按钮，靠这一条兜底。
const VC_REAL_FOCUS_TRIGGER: any = { palette: '[data-vc-search-entry]', gear: '[data-vc-gear-btn]', branch: '[data-vc-branch-btn]' }
// 确认卡外层标记：各页自己的卡都算（壳原语卡带 data-vc-confirm，其余页各带自己的标记）。
const VC_REAL_CONFIRM_CARD = '[data-vc-confirm], [data-vc-file-confirm], [data-vc-changes-confirm], [data-vc-conflicts-confirm], [data-vc-stash-confirm], [data-vc-sync-confirm], [data-vc-commit-confirm], [data-vc-sub-confirm], [data-vc-undo-confirm], [data-vc-rebase-confirm], [data-vc-rewrite-confirm], [data-vc-maint-confirm], [data-vc-migrate-confirm], [data-vc-diag-confirm], [data-vc-config-confirm], [data-vc-hooks-confirm], [data-vc-clone-confirm], [data-vc-remote-confirm]'

const vcRealFocusIn = function (node: any): void {
  if (node && typeof node.focus === 'function') node.focus({ preventScroll: true })
}
const vcRealFirstFocusableOf = function (root: any, sel: string): any {
  const box: any = root && typeof root.querySelector === 'function' ? root.querySelector(sel) : null
  if (!box) return null
  if (typeof box.matches === 'function' && box.matches(VC_REAL_FOCUSABLE)) return box
  const list: any = typeof box.querySelectorAll === 'function' ? box.querySelectorAll(VC_REAL_FOCUSABLE) : []
  return list && list.length > 0 ? list[0] : null
}
// 焦点接管的「浮层种类」：三种浮层之外，管理索引屏也算一种（#1840）——
//   它虽然是一个页面，但打开与返回时同样要把焦点送进索引第一项、离开时送回齿轮按钮，
//   所以沿用同一套进出规则；键盘用户打开索引后按键即可直接落卡。
const vcRealOverlayKindOf = function (nav: any): string {
  const open: any = (nav && nav.open) || {}
  if (open.palette === true) return 'palette'
  if (open.gear === true) return 'gear'
  if (open.branch === true) return 'branch'
  if (String((nav && nav.page) || '') === VC_MANAGE_INDEX_PAGE) return 'gear'
  return ''
}

// 焦点接管（规格第 391 行）：浮层或确认卡打开时把焦点送进第一个可操作控件，关掉后送回触发它的那颗按钮。
//   state 由容器用 useRef 持有（{ overlay, confirm, returnEl, confirmReturn }）：本函数只读 DOM 与导航，
//   返回下一份 state、不产生别的副作用，所以放在「每次渲染后跑一遍」的 effect 里也安全。
export const vcRealFocusStepOf = function (root: any, nav: any, state: any): any {
  const s: any = state || {}
  const next: any = { overlay: String(s.overlay || ''), confirm: s.confirm === true, returnEl: s.returnEl || null, confirmReturn: s.confirmReturn || null }
  if (!root || typeof root.querySelector !== 'function' || typeof document === 'undefined') return next
  const active: any = document.activeElement
  const inside: any = active && active !== root && typeof root.contains === 'function' && root.contains(active) ? active : null
  const kind: string = vcRealOverlayKindOf(nav)
  if (kind !== next.overlay) {
    if (kind !== '') {
      next.returnEl = inside
      vcRealFocusIn(vcRealFirstFocusableOf(root, VC_REAL_FOCUS_OPEN[kind]))
    } else if (next.overlay !== '') {
      // 关掉后按规格回那颗固定的触发钮：打开时记下的活动元素可能是上一颗浮层的按钮，不能拿它顶替。
      const trigger: any = root.querySelector(VC_REAL_FOCUS_TRIGGER[next.overlay])
      const back: any = trigger || (next.returnEl && next.returnEl.isConnected === true ? next.returnEl : null)
      vcRealFocusIn(back)
      next.returnEl = null
    }
    next.overlay = kind
  }
  const card: any = root.querySelector(VC_REAL_CONFIRM_CARD)
  if (card && next.confirm !== true) {
    next.confirmReturn = inside
    const list: any = typeof card.querySelectorAll === 'function' ? card.querySelectorAll(VC_REAL_FOCUSABLE) : []
    const cancel: any = typeof card.querySelector === 'function' ? card.querySelector('[data-focus-default="cancel"]') : null
    vcRealFocusIn(cancel || (list && list.length > 0 ? list[0] : null))
  }
  if (!card && next.confirm === true) {
    vcRealFocusIn(next.confirmReturn && next.confirmReturn.isConnected === true ? next.confirmReturn : null)
    next.confirmReturn = null
  }
  next.confirm = !!card
  return next
}

export const VC_REAL_SHELL_SOURCE = 'src/client/views/versionControl/vcRealShell.ts'
