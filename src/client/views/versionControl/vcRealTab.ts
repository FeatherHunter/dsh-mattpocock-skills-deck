// views/versionControl/vcRealTab.ts —— 真实页签的容器组件（#1776 M1）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 职责：把 VersionControlTab 的入口委托接成一块真正的页面壳 —— 首屏七片读数、四个固定页签、九个管理分区、
// 搜索页、两个侧页的导航，以及三时机刷新与片级重试。导航用根节点事件委托（壳只输出 data-* 属性），
// 数据装载与动作分派在 vcRealActions.ts，纯状态换算在 vcRealModel.ts，事件翻译在 vcRealDelegate.ts。
// 这一层自己不碰宿主读数的形状：所有电话都走动作层，所有文案都走 tr，皮肤只认宿主的主题开关。

declare const React: any
declare const DswsCtx: any
declare const host: any
declare const tr: any
declare function vcShellPageNode(h: any, t: any, opts: any): any
declare function vcRealReadsNew(cwd: any): any
declare function vcRealInitialUi(): any
declare function vcRealInitialNav(): any
declare function vcRealCwdOf(props: any): string
declare function vcRealCwdEmptyOf(cwd: any): boolean
declare function vcRealNavOf(nav: any): any
declare function vcRealNavTo(nav: any, page: any): any
declare function vcRealNavBack(nav: any): any
declare function vcRealNavToggle(nav: any, key: any): any
declare function vcRealNavCloseAll(nav: any): any
declare function vcRealNavQuery(nav: any, query: any): any
declare function vcRealNavSelect(nav: any, capId: any): any
declare function vcRealTabStepOf(nav: any, key: any): any
declare function vcRealSeedOf(reads: any, nav: any, nowMs: any): any
declare function vcRealFailuresOf(reads: any): any[]
declare function vcRealWholeFailOf(reads: any): any
declare function vcRealSliceNameKeyOf(id: any): string
declare function vcRealSkinOf(bodyEl: any): string
declare function vcRealCommitTargetsOf(reads: any): any[]
declare function vcRealChangesSeedOf(reads: any): any
declare const VC_REAL_EXTRA_LINKS: string[]
declare function vcRealActionsOf(deps: any): any
declare function vcRealChangesHandlersOf(state: any, setState: any, call: any, cwd: any): any
declare function vcRealDelegateOf(callbacks: any): any
declare function vcStashStateNew(): any
declare function vcFirstScreenStateOf(reads: any): string
declare function vcFirstScreenSliceStateOf(reads: any, id: any): string
declare function vcFirstScreenSliceErrorOf(reads: any, id: any): any
declare function vcPageDepthOf(page: any): number

// #842 与 ui-feedback 要求入口带这几枚 data-log 词条：刷新用 vc.reload，返回按来源页分 vc.changes.back /
// vc.commit.back，提交历史的行点开走 vc.row.open.<oid>。前两枚真实铺在按钮上，行那一枚在委托注释里说清用途。
const VC_REAL_LOG_RELOAD = 'vc.reload'
const VC_REAL_LOG_BACK_CHANGES = 'vc.changes.back'
const VC_REAL_LOG_BACK_COMMIT = 'vc.commit.back'
const VC_REAL_LOG_ROW_PREFIX = 'vc.row.open.'

export const VcRealTab = function (props: any) {
  const cx: any = React.useContext(DswsCtx)
  const h: any = cx && cx.h ? cx.h : React.createElement
  const cwd: string = vcRealCwdOf(props)
  const [reads, setReadsState] = React.useState(function () { return vcRealReadsNew(cwd) })
  const [ui, setUiState] = React.useState(vcRealInitialUi)
  const [nav, setNavState] = React.useState(vcRealInitialNav)
  const [changes, setChangesState] = React.useState(function () { return { values: vcRealChangesSeedOf(reads).values, rows: {} } })
  const [width, setWidthState] = React.useState(460)
  const [skin, setSkinState] = React.useState('dark')
  const rootRef: any = React.useRef(null)
  const readsRef: any = React.useRef(reads)
  const uiRef: any = React.useRef(ui)
  const navRef: any = React.useRef(nav)
  const actionsRef: any = React.useRef(null)
  const cwdRef: any = React.useRef(null)
  readsRef.current = reads
  uiRef.current = ui
  navRef.current = nav
  const setReads = function (next: any): void {
    if (typeof next === 'function') setReadsState(function (cur: any) { return next(cur) })
    else setReadsState(next)
  }
  const setUi = function (next: any): void {
    if (typeof next === 'function') setUiState(function (cur: any) { return next(cur) })
    else setUiState(next)
  }
  const setNav = function (next: any): void {
    if (typeof next === 'function') setNavState(function (cur: any) { return next(cur) })
    else setNavState(next)
  }
  // 宿主电话的唯一出口：没有 host.call 时回一条形状错误，与旧入口同一兜底（界面照常画，只是动作报错）。
  const callHost = function (phone: any, args: any): any {
    if (typeof host === 'undefined' || !host || typeof host.call !== 'function') return Promise.resolve({ ok: false, error: { kind: 'shape', message: '' } })
    return host.call(phone, args)
  }
  const nowMs = function (): number { return Date.now() }
  const actions: any = vcRealActionsOf({
    getReads: function () { return readsRef.current },
    getUi: function () { return uiRef.current },
    getNav: function () { return navRef.current },
    setReads: setReads,
    setUi: setUi,
    callHost: callHost,
    cwd: cwd,
    nowMs: nowMs,
  })
  actionsRef.current = actions
  const goPage = function (page: any, keepBack: any): void {
    const next: any = vcRealNavTo(navRef.current, page)
    if (keepBack !== true) next.back = null
    if (keepBack !== true) next.highlight = ''
    setNav(next)
  }
  // 齿轮九分区、三个深链与同步带跳的都是二级页：vcRealNavTo 已把来源页记在 back 上，这里要保住它，
  //   二级页才会画「返回来源页」；四个固定页签是同一层，切换时把 back 清掉。
  const callbacks: any = {
    page: function (intent: any) { goPage(intent && intent.page, true) },
    tab: function (intent: any) { goPage(intent && intent.page, false) },
    gearToggle: function () { setNav(vcRealNavToggle(navRef.current, 'gear')) },
    searchEntry: function () { setNav(vcRealNavToggle(navRef.current, 'palette')) },
    branchToggle: function () { setNav(vcRealNavToggle(navRef.current, 'branch')) },
    branchClose: function () { setNav(vcRealNavCloseAll(navRef.current)) },
    sync: function () { goPage('remote', true) },
    palettePick: function (intent: any) { setNav(vcRealNavSelect(navRef.current, intent && intent.capId)) },
    paletteInput: function (intent: any) { setNav(vcRealNavQuery(navRef.current, intent && intent.value)) },
    refresh: function () { actionsRef.current.refresh('manual') },
    sliceRetry: function (intent: any) { actionsRef.current.retrySlice(intent && intent.sliceId) },
    retryAll: function () { actionsRef.current.refresh('slice') },
    back: function () { setNav(vcRealNavBack(navRef.current)) },
    tabKey: function (intent: any) {
      const step: any = vcRealTabStepOf(navRef.current, intent && intent.key)
      if (!step || !step.page) return
      setNav(step.nav)
      if (rootRef.current && typeof rootRef.current.querySelector === 'function') {
        const btn: any = rootRef.current.querySelector('[data-vc-tab="' + step.page + '"]')
        if (btn && typeof btn.focus === 'function') btn.focus()
      }
    },
    escape: function () { setNav(vcRealNavCloseAll(navRef.current)) },
    historyOpen: function (intent: any) { actionsRef.current.openCommit(intent && intent.oid) },
    historyBack: function () { actionsRef.current.closeCommit() },
    loadMore: function () { actionsRef.current.loadMore() },
    historyRetry: function () { actionsRef.current.retrySlice('history') },
    filesRetry: function () { actionsRef.current.retryFiles() },
    fileDiffRetry: function () { actionsRef.current.retryFileDiff() },
    historyFile: function (intent: any) { actionsRef.current.openHistoryFile(intent && intent.path) },
  }
  const events: any = vcRealDelegateOf(callbacks)
  // 换工作区与首次进入：复位读数、界面状态与导航，然后按「进入页面」时机读一次首屏。
  React.useEffect(function () {
    if (cwdRef.current === cwd) return
    cwdRef.current = cwd
    setReadsState(vcRealReadsNew(cwd))
    setUiState(vcRealInitialUi())
    setNavState(vcRealInitialNav())
    setChangesState({ values: vcRealChangesSeedOf(vcRealReadsNew(cwd)).values, rows: {} })
    if (!vcRealCwdEmptyOf(cwd)) actionsRef.current.refresh('enter')
  }, [cwd])
  // 提交页的只读动作：打开改动页时读一次提交表单（wf.gitCommitForm），表单里带身份、钩子与模板信息；
  //   读到之后一直留着，重复进页不重复发电话；换工作区时 cwd 变了会再读一次。
  const commitFormCwdRef: any = React.useRef('')
  React.useEffect(function () {
    if (nav.page !== 'changes') return
    if (commitFormCwdRef.current === cwd) return
    const commit: any = (uiRef.current && uiRef.current.commit) || {}
    if (commit.form || commit.state === 'loading') { commitFormCwdRef.current = cwd; return }
    commitFormCwdRef.current = cwd
    actionsRef.current.commitOps().loadForm()
  }, [nav.page, cwd])
  // 宽度跟四档与皮肤：宽度量根节点（ResizeObserver），皮肤读宿主的 body 主题开关。
  React.useEffect(function () {
    if (typeof document !== 'undefined' && document.body) setSkinState(vcRealSkinOf(document.body))
    const el: any = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro: any = new ResizeObserver(function (entries: any) {
      const box: any = entries && entries[0] && entries[0].contentRect
      if (box && isFinite(box.width) && box.width > 0) setWidthState(Math.round(box.width))
    })
    ro.observe(el)
    return function () { ro.disconnect() }
  }, [])
  if (vcRealCwdEmptyOf(cwd)) {
    return h('div', { id: 'vc-real-root', className: 'vcs-live', 'data-vc-live': '1', 'data-vc-live-empty': '1' },
      h('p', { className: 'vcs-live-empty', role: 'status' }, tr('vc.shell.live.emptyCwd')))
  }
  const nowTick: number = nowMs()
  const seed: any = vcRealSeedOf(reads, nav, nowTick)
  const failures: any[] = vcRealFailuresOf(reads)
  const whole: any = vcRealWholeFailOf(reads)
  const failless: boolean = failures.length === 0 && !whole
  const barKids: any[] = [
    h('span', { key: 'at', className: 'vcs-live-at', 'data-vc-live-at': '1' }, seed.when ? tr('vc.shell.live.readAt', { when: seed.when }) : tr('vc.shell.live.loading')),
  ]
  if (nav.back) {
    barKids.push(h('button', { key: 'back', type: 'button', className: 'vcs-live-back', 'data-vc-back': '1', 'data-press': 'button', 'data-log': nav.back.page === 'commits' ? VC_REAL_LOG_BACK_COMMIT : VC_REAL_LOG_BACK_CHANGES }, tr('vc.shell.live.back', { page: tr('vc.shell.page.' + nav.back.page) })))
  }
  barKids.push(h('button', { key: 'refresh', type: 'button', className: 'vcs-live-refresh', 'data-vc-refresh': '1', 'data-press': 'button', 'data-log': VC_REAL_LOG_RELOAD, disabled: vcFirstScreenStateOf(reads) === 'loading' }, tr('vc.shell.live.refresh')))
  VC_REAL_EXTRA_LINKS.forEach(function (key: string) {
    const target: string = key === 'palette' ? 'search' : key
    barKids.push(h('button', { key: 'link-' + key, type: 'button', className: 'vcs-live-link', 'data-vc-extra-link': target, 'data-press': 'button', 'data-log': 'vc.live.link.' + key }, tr('vc.shell.live.link.' + key)))
  })
  const failKids: any[] = []
  if (whole) {
    failKids.push(h('p', { key: 'whole', className: 'vcs-live-fail', role: 'alert', 'data-vc-live-whole-fail': '1' }, tr('vc.shell.live.fail.whole', { message: whole.message })))
    failKids.push(h('button', { key: 'retry-all', type: 'button', className: 'vcs-live-retry', 'data-vc-retry-all': '1' }, tr('vc.shell.live.retryAll')))
  }
  failures.forEach(function (one: any) {
    failKids.push(h('p', { key: 'fail-' + one.id, className: 'vcs-live-fail', role: 'alert', 'data-vc-slice-fail': one.id },
      tr('vc.shell.live.fail.slice', { slice: tr(vcRealSliceNameKeyOf(one.id)), message: one.message || one.kind }),
      ' ',
      h('button', { key: 'retry', type: 'button', className: 'vcs-live-retry', 'data-vc-slice-retry': one.id }, tr('vc.shell.live.retry'))))
  })
  const stash: any = Object.assign({}, vcStashStateNew(), ui.stash || {})
  const changesSeed: any = vcRealChangesSeedOf(reads)
  const changeHandlers: any = vcRealChangesHandlersOf({ values: changes.values, rows: changes.rows }, setChangesState, callHost, cwd)
  changeHandlers.onDone = function () { actionsRef.current.refresh('task-done') }
  const changeSliceState: string = vcFirstScreenSliceStateOf(reads, 'changes')
  const changesModel: any = {
    counts: changesSeed.counts,
    values: changes.values,
    rows: changes.rows,
    handlers: changeHandlers,
  }
  if (changeSliceState === 'err') {
    changesModel.state = 'error'
    const err: any = vcFirstScreenSliceErrorOf(reads, 'changes') || {}
    changesModel.errorText = String(err.message || '')
  }
  const shellOpts: any = {
    page: nav.page,
    pagePrefix: nav.page,
    width: width,
    skin: skin,
    seed: seed,
    open: { branch: nav.open.branch === true, palette: nav.open.palette === true, gear: nav.open.gear === true, surface: nav.open.surface || '' },
    reads: reads,
    ui: ui,
    nowMs: nowTick,
    changes: changesModel,
    commitOps: actions.commitOps(),
    commitTargets: vcRealCommitTargetsOf(reads),
    stash: stash,
    onStash: function (payload: any) { actionsRef.current.stashAct(payload) },
    onStashEdit: function (patch: any) { actionsRef.current.stashEdit(patch) },
    ops: actions.worktreeOps(),
    handlers: {},
    cwd: cwd,
    call: callHost,
  }
  const kids: any[] = [
    h('div', { key: 'bar', className: 'vcs-live-bar', 'data-vc-live-bar': '1' }, barKids),
  ]
  if (!failless) kids.push(h('div', { key: 'fails', className: 'vcs-live-fails', 'data-vc-live-fails': '1' }, failKids))
  kids.push(h('div', { key: 'shell', className: 'vcs-live-shell' }, vcShellPageNode(h, tr, shellOpts)))
  return h('div', Object.assign({ id: 'vc-real-root', ref: rootRef, className: 'vcs-live', 'data-vc-live': '1', 'data-vc-live-page': nav.page, 'data-vc-live-depth': String(vcPageDepthOf(nav.page)) }, events), kids)
}

export const VC_REAL_TAB_SOURCE = 'src/client/views/versionControl/vcRealTab.ts'
