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
    setNav(next)
  }
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
    gearToggle: function () { setNav(vcRealNavToggle(getNav(), 'gear')) },
    searchEntry: function () { setNav(vcRealNavToggle(getNav(), 'palette')) },
    branchToggle: function () { setNav(vcRealNavToggle(getNav(), 'branch')) },
    branchClose: function () { setNav(vcRealNavCloseAll(getNav())) },
    sync: function () { goPage('remote', true) },
    palettePick: function (intent: any) { selectCap(intent && intent.capId) },
    capRow: function (intent: any) { selectCap(intent && intent.capId) },
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
    escape: function () { setNav(vcRealNavCloseAll(getNav())) },
    historyOpen: function (intent: any) { actionsRef.current.openCommit(intent && intent.oid) },
    historyBack: function () { actionsRef.current.closeCommit() },
    loadMore: function () { actionsRef.current.loadMore() },
    historyRetry: function () { actionsRef.current.retrySlice('history') },
    filesRetry: function () { actionsRef.current.retryFiles() },
    fileDiffRetry: function () { actionsRef.current.retryFileDiff() },
    historyFile: function (intent: any) { actionsRef.current.openHistoryFile(intent && intent.path) },
    // ———— 管理页 ————
    // 分支浮层的五个动作项只是 span（壳里没给按钮），点它跳到分支板并把焦点送到对应动作按钮。
    branchOverlay: function (intent: any) {
      const action: string = String((intent && intent.action) || '')
      manageActions.branch.overlay(action)
      if (typeof setTimeout === 'function') setTimeout(function () {
        const root: any = rootRef.current
        if (!root || typeof root.querySelector !== 'function') return
        const btn: any = root.querySelector('[data-vc-branch-action="' + action + '"]')
        if (btn && typeof btn.focus === 'function') btn.focus()
      }, 0)
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

// 顶部条：读数时刻、返回来源页（二级页才有）、手动刷新、三个额外入口。刷新按钮在首屏读取中禁用。
export const vcRealBarNodesOf = function (h: any, tr: any, reads: any, nav: any, seed: any): any[] {
  const kids: any[] = [
    h('span', { key: 'at', className: 'vcs-live-at', 'data-vc-live-at': '1' }, seed.when ? tr('vc.shell.live.readAt', { when: seed.when }) : tr('vc.shell.live.loading')),
  ]
  if (nav.back) {
    const backPage: string = String(nav.back.page || '')
    kids.push(h('button', { key: 'back', type: 'button', className: 'vcs-live-back', 'data-vc-back': '1', 'data-press': 'button', 'data-log': backPage === 'commits' ? VC_REAL_LOG_BACK_COMMIT : VC_REAL_LOG_BACK_CHANGES }, tr('vc.shell.live.back', { page: tr('vc.shell.page.' + backPage) })))
  }
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

export const VC_REAL_SHELL_SOURCE = 'src/client/views/versionControl/vcRealShell.ts'
