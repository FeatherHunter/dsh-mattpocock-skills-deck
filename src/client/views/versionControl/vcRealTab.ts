// views/versionControl/vcRealTab.ts —— 真实页签的容器组件（#1776 M1/M2）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 职责：把 VersionControlTab 的入口委托接成一块真正的页面壳 —— 首屏七片读数、四个固定页签、九个管理分区、
// 搜索页、两个侧页与撤销面板的导航，三时机刷新与片级重试，以及九个管理页、两个侧页的真实读数与动作。
// 导航用根节点事件委托（壳只输出 data-* 属性）；导航动作与顶部条在 vcRealShell.ts；首屏与小动作在
// vcRealActions.ts；管理页状态在 vcRealManage.ts，动作在 vcRealManageActions/2/3 与 vcRealManageSide，
// 事件翻译在 vcRealDelegate.ts。这一层只负责组装与持有状态，不碰宿主读数形状，也不写文案（都走 tr）。

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
declare function vcRealSeedOf(reads: any, nav: any, nowMs: any): any
declare function vcRealSkinOf(bodyEl: any): string
declare function vcRealCommitTargetsOf(reads: any): any[]
declare function vcRealChangesSeedOf(reads: any): any
declare function vcRealActionsOf(deps: any): any
declare function vcRealChangesHandlersOf(state: any, setState: any, call: any, cwd: any): any
declare function vcRealDelegateOf(callbacks: any): any
declare function vcRealMigrateFieldsOf(rootEl: any, action: any): any
declare function vcStashStateNew(): any
declare function vcFirstScreenSliceStateOf(reads: any, id: any): string
declare function vcFirstScreenSliceErrorOf(reads: any, id: any): any
declare function vcPageDepthOf(page: any): number
declare function vcRealManageNew(): any
declare function vcRealManageUiNew(): any
declare function vcRealManageNeedReadOf(page: any): string
declare function vcRealManagePropsOf(reads: any, ui: any, m: any): any
declare function vcRealReadsDispatchOf(deps: any): any
declare function vcRealManageActionsOf(deps: any): any
declare function vcRealConfigHandlersOf(deps: any): any
declare function vcRealDiagnosticsHandlersOf(deps: any): any
declare function vcRealSubmoduleOpsOf(deps: any): any
declare function vcRealPlatformHandlersOf(deps: any): any
declare function vcRealMigrateHandlersOf(deps: any): any
declare function vcRealTaskPollerOf(deps: any): any
declare function vcRealConflictsHandlersOf(deps: any): any
declare function vcRealRebaseHandlersOf(deps: any): any
declare function vcRealConflictsModelOf(c: any): any
declare function vcRealRebaseModelOf(r: any): any
declare function vcRealGoPageOf(getNav: any, setNav: any): any
declare function vcRealSelectCapOf(getNav: any, setNav: any): any
declare function vcRealCallbacksOf(deps: any): any
declare function vcRealBarNodesOf(h: any, tr: any, reads: any, nav: any, seed: any): any[]
declare function vcRealFailNodesOf(h: any, tr: any, reads: any): any[]

export const VcRealTab = function (props: any) {
  const cx: any = React.useContext(DswsCtx)
  const h: any = cx && cx.h ? cx.h : React.createElement
  const cwd: string = vcRealCwdOf(props)
  const [reads, setReadsState] = React.useState(function () { return vcRealReadsNew(cwd) })
  const [ui, setUiState] = React.useState(function () { return Object.assign({}, vcRealInitialUi(), vcRealManageUiNew()) })
  const [nav, setNavState] = React.useState(vcRealInitialNav)
  const [changes, setChangesState] = React.useState(function () { return { values: vcRealChangesSeedOf(reads).values, rows: {} } })
  const [manage, setManageState] = React.useState(vcRealManageNew)
  const [width, setWidthState] = React.useState(460)
  const [skin, setSkinState] = React.useState('dark')
  const rootRef: any = React.useRef(null)
  const readsRef: any = React.useRef(reads)
  const uiRef: any = React.useRef(ui)
  const navRef: any = React.useRef(nav)
  const manageRef: any = React.useRef(manage)
  const actionsRef: any = React.useRef(null)
  const readsDispatchRef: any = React.useRef(null)
  const configRef: any = React.useRef(null)
  const migrateRef: any = React.useRef(null)
  const sideRef: any = React.useRef(null)
  const pollerRef: any = React.useRef(null)
  const cwdRef: any = React.useRef(null)
  readsRef.current = reads
  uiRef.current = ui
  navRef.current = nav
  manageRef.current = manage
  // 四个 setState 都接受函数式更新：动作层（诊断、提交、首屏重读）按「拿当前态算出下一态」回写。
  const lift = function (setter: any): any {
    return function (next: any): void {
      if (typeof next === 'function') setter(function (cur: any) { return next(cur) })
      else setter(next)
    }
  }
  const setReads: any = lift(setReadsState)
  const setUi: any = lift(setUiState)
  const setNav: any = lift(setNavState)
  const setManage: any = lift(setManageState)
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
  // 管理页的读数分发 + 各域动作：都闭在 ref 上，换工作区后读到的仍是当前那一份状态。
  const diag: any = vcRealDiagnosticsHandlersOf({ ui: ui, setUi: setUi, callHost: callHost, cwd: cwd, nowMs: nowMs })
  const readsDispatch: any = vcRealReadsDispatchOf({
    getManage: function () { return manageRef.current },
    setManage: setManage,
    callHost: callHost,
    cwd: cwd,
    diagOf: function () { return diag },
  })
  readsDispatchRef.current = readsDispatch
  const configFns: any = vcRealConfigHandlersOf({
    getManage: function () { return manageRef.current }, setManage: setManage,
    callHost: callHost, cwd: cwd, nowMs: nowMs,
    onRefresh: function (page: any) { return readsDispatch.readPage(page, true) },
  })
  configRef.current = configFns
  const platformFns: any = vcRealPlatformHandlersOf({
    getManage: function () { return manageRef.current }, setManage: setManage,
    getUi: function () { return uiRef.current }, setUi: setUi, callHost: callHost, cwd: cwd,
  })
  const migrateFns: any = vcRealMigrateHandlersOf({
    getManage: function () { return manageRef.current }, setManage: setManage,
    getUi: function () { return uiRef.current }, setUi: setUi, callHost: callHost, cwd: cwd, nowMs: nowMs,
    readFields: function (action: any) { return vcRealMigrateFieldsOf(rootRef.current, action) },
  })
  migrateRef.current = migrateFns
  const subOps: any = vcRealSubmoduleOpsOf({
    getManage: function () { return manageRef.current }, setManage: setManage, callHost: callHost, cwd: cwd,
  })
  const conflictsHandlers: any = vcRealConflictsHandlersOf({
    callHost: callHost, cwd: cwd, nowMs: nowMs,
    getConflicts: function () { return (manageRef.current || {}).conflicts },
    patchConflicts: function (next: any) { setManage(function (cur: any) { return Object.assign({}, cur, { conflicts: next }) }) },
  })
  const rebaseHandlers: any = vcRealRebaseHandlersOf({
    callHost: callHost, cwd: cwd, nowMs: nowMs,
    getRebase: function () { return (manageRef.current || {}).rebase },
    patchRebase: function (next: any) { setManage(function (cur: any) { return Object.assign({}, cur, { rebase: next }) }) },
  })
  sideRef.current = { conflicts: conflictsHandlers, rebase: rebaseHandlers }
  // 导航动作：跳页与能力行落点。二级页保留来源页（顶部会画「返回来源页」），页签切换则清掉。
  const goPage: any = vcRealGoPageOf(function () { return navRef.current }, setNav)
  const selectCap: any = vcRealSelectCapOf(function () { return navRef.current }, setNav)
  const manageActions: any = vcRealManageActionsOf({
    getManage: function () { return manageRef.current }, setManage: setManage,
    getUi: function () { return uiRef.current }, setUi: setUi, callHost: callHost, cwd: cwd, nowMs: nowMs,
    onRefresh: function (page: any) { return readsDispatch.readPage(page, true) },
    onJump: function (page: any) { goPage(page, true) },
  })
  const callbacks: any = vcRealCallbacksOf({
    getNav: function () { return navRef.current }, setNav: setNav, rootRef: rootRef, getManage: function () { return manageRef.current },
    readsDispatchRef: readsDispatchRef, migrateRef: migrateRef, actionsRef: actionsRef,
    manageActions: manageActions, goPage: goPage, selectCap: selectCap,
  })
  const events: any = vcRealDelegateOf(callbacks)
  // 换工作区与首次进入：复位全部读数（含管理页各域）、界面状态、导航与改动行，然后按「进入页面」时机读一次首屏。
  React.useEffect(function () {
    if (cwdRef.current === cwd) return
    cwdRef.current = cwd
    setReadsState(vcRealReadsNew(cwd))
    setUiState(Object.assign({}, vcRealInitialUi(), vcRealManageUiNew()))
    setNavState(vcRealInitialNav())
    setChangesState({ values: vcRealChangesSeedOf(vcRealReadsNew(cwd)).values, rows: {} })
    setManageState(vcRealManageNew())
    pollerRef.current = null
    if (!vcRealCwdEmptyOf(cwd)) actionsRef.current.refresh('enter')
  }, [cwd])
  // 进入某一页按页读一次该域读数（分支板 / 远端 / 子模块 / 配置 / 诊断 / 平台 / 冲突 / 变基 / 迁移）；
  //   失败不清旧读数，页面按各自状态画失败与重试。
  React.useEffect(function () {
    if (vcRealCwdEmptyOf(cwd) || cwdRef.current !== cwd) return
    const page: string = String(nav.page || '')
    // 三个侧页不走读数分发器：冲突与变基各有自己的读数电话，迁移页的进入读是预检电话（action=init）。
    //   这三页的读数必须在这里分派，不能只看 vcRealManageNeedReadOf：那三个页名虽然认得，
    //   但读数分发器里没有对应的读法，先走 readPage 会直接返回，页面上就一条电话都不发。
    const side: any = sideRef.current || {}
    if (page === 'conflicts') { side.conflicts.read('conflict-list'); return }
    if (page === 'rebase') { side.rebase.read('rebase-state'); side.rebase.read('rebase-window'); return }
    if (page === 'migrate') { migrateRef.current.check('init'); return }
    const need: string = vcRealManageNeedReadOf(page)
    if (need !== '') readsDispatchRef.current.readPage(page)
  }, [nav.page, cwd])
  // 任务区轮询：每 cwd 一份计时器，进入即问一次；运行中的任务从有到无时按「任务完成后」重读首屏。
  React.useEffect(function () {
    if (vcRealCwdEmptyOf(cwd)) return
    const poller: any = vcRealTaskPollerOf({
      callHost: callHost,
      getManage: function () { return manageRef.current },
      setManage: setManage,
      onIdleDone: function () { actionsRef.current.refresh('task-done') },
    })
    pollerRef.current = poller
    poller.tick()
    const interval: number = poller.intervalMs > 0 ? poller.intervalMs : 5000
    const timer: any = typeof setInterval === 'function' ? setInterval(function () { poller.tick() }, interval) : null
    return function () { if (timer !== null && typeof clearInterval === 'function') clearInterval(timer) }
  }, [cwd])
  // 提交页的只读动作：打开改动页时读一次提交表单（wf.gitCommitForm）；换工作区后 cwd 变了会再读一次。
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
  const stash: any = Object.assign({}, vcStashStateNew(), ui.stash || {})
  const changesSeed: any = vcRealChangesSeedOf(reads)
  const changeHandlers: any = vcRealChangesHandlersOf({ values: changes.values, rows: changes.rows }, setChangesState, callHost, cwd)
  changeHandlers.onDone = function () { actionsRef.current.refresh('task-done') }
  const changesModel: any = {
    counts: changesSeed.counts,
    values: changes.values,
    rows: changes.rows,
    handlers: changeHandlers,
  }
  if (vcFirstScreenSliceStateOf(reads, 'changes') === 'err') {
    changesModel.state = 'error'
    const err: any = vcFirstScreenSliceErrorOf(reads, 'changes') || {}
    changesModel.errorText = String(err.message || '')
  }
  const manageProps: any = vcRealManagePropsOf(reads, ui, manage)
  const conflictsModel: any = vcRealConflictsModelOf(manage.conflicts)
  conflictsModel.handlers = conflictsHandlers
  const rebaseModel: any = vcRealRebaseModelOf(manage.rebase)
  rebaseModel.handlers = rebaseHandlers
  // 壳的 opts：M1 的首屏与四页签字段在前，管理页各域的字段由 vcRealManagePropsOf 合并进来（等价于逐个装配）。
  //   管理页里 migrate 的任务槽要单独取（它的任务不落首屏 sync 片），其余 reads 槽原样透传。
  const shellOpts: any = Object.assign({}, manageProps, {
    page: nav.page,
    pagePrefix: nav.page,
    width: width,
    skin: skin,
    seed: seed,
    open: { branch: nav.open.branch === true, palette: nav.open.palette === true, gear: nav.open.gear === true, surface: nav.open.surface || '' },
    reads: Object.assign({}, manageProps.reads, {
      task: nav.page === 'migrate' && manage.migrate ? manage.migrate.task : manageProps.reads.task,
    }),
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
    conflicts: conflictsModel,
    rebase: rebaseModel,
    onBranchRetry: function () { readsDispatch.readPage('branch-tags', true) },
    config: manage.config,
    onConfig: function (input: any) { configRef.current.onConfig(input) },
    onConfigEdit: function (patch: any) { configRef.current.onConfigEdit(patch) },
    hooks: manage.config,
    onHooks: function (input: any) { configRef.current.onHooks(input) },
    onHooksEdit: function (patch: any) { configRef.current.onHooksEdit(patch) },
    diagnostics: diag.state(),
    onDiagnosticsRead: function (cap: any) { diag.onRead(cap) },
    onDiagnosticsWrite: function (op: any, values: any) { diag.onWrite(op, values) },
    onDiagnosticsEdit: function (cap: any, key: any, value: any) { diag.onEdit(cap, key, value) },
    onDiagnosticsConfirm: function () { diag.onConfirm() },
    onDiagnosticsCancel: function () { diag.onCancel() },
    platform: manage.platform,
    platformUi: ui,
    onPlatformRpInput: function (key: any, value: any) { platformFns.onRpInput(key, value) },
    onPlatformRequestPull: function (form: any) { platformFns.onRequestPull(form) },
    submodules: manage.submodules ? manage.submodules.board : null,
    submoduleUi: manage.submodules ? manage.submodules.ui : null,
    submoduleOps: subOps,
    migrate: manage.migrateExport,
    migrateReads: manage.migratePatches,
    onMigrateEdit: function (key: any, value: any) { migrateRef.current.exportEdit(key, value) },
    onMigrateCheck: function (range: any, dir: any) { migrateRef.current.exportCheck(range, dir) },
    onMigrateRun: function () { migrateRef.current.exportRun() },
    onMigrateRescan: function (dir: any) { migrateRef.current.exportRescan(dir) },
    onMigrateCancel: function () { migrateRef.current.exportCancel() },
    tasks: manage.tasks && Array.isArray(manage.tasks.items) ? manage.tasks.items : [],
    running: manage.tasks && typeof manage.tasks.running === 'number' ? manage.tasks.running : 0,
    onCancel: function (taskId: any) { if (pollerRef.current) pollerRef.current.cancel(taskId) },
  })
  const failNodes: any[] = vcRealFailNodesOf(h, tr, reads)
  const kids: any[] = [h('div', { key: 'bar', className: 'vcs-live-bar', 'data-vc-live-bar': '1' }, vcRealBarNodesOf(h, tr, reads, nav, seed))]
  if (failNodes.length > 0) kids.push(h('div', { key: 'fails', className: 'vcs-live-fails', 'data-vc-live-fails': '1' }, failNodes))
  kids.push(h('div', { key: 'shell', className: 'vcs-live-shell' }, vcShellPageNode(h, tr, shellOpts)))
  return h('div', Object.assign({ id: 'vc-real-root', ref: rootRef, className: 'vcs-live', 'data-vc-live': '1', 'data-vc-live-page': nav.page, 'data-vc-live-depth': String(vcPageDepthOf(nav.page)) }, events), kids)
}

export const VC_REAL_TAB_SOURCE = 'src/client/views/versionControl/vcRealTab.ts'
