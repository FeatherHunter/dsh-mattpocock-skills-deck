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
declare var openTextInNewSession: any
declare const tr: any
declare function vcShellPageNode(h: any, t: any, opts: any): any
// #1840：页头返回键沿用旧顶栏的两枚点击日志词条（本叶只在渲染时读，常量在 vcRealShell 叶里定义）。
declare const VC_REAL_LOG_BACK_CHANGES: string
declare const VC_REAL_LOG_BACK_COMMIT: string
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
declare function vcRealChangesHandlersOf(state: any, setState: any, call: any, cwd: any, translate: any, gate: any): any
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
declare function vcRealAiNodesOf(h: any, tr: any, reads: any, nav: any, st: any): any
declare function vcRealAiOpenOf(tr: any, reads: any, st: any, ai: any, opener: any): boolean
declare function vcRealDeepLinkOf(props: any): string
declare function vcRealDeepLinkNavOf(key: any): any
declare function vcRealTabCountsOf(reads: any): any
declare function vcRealFocusStepOf(root: any, nav: any, state: any): any

export const VcRealTab = function (props: any) {
  const cx: any = React.useContext(DswsCtx)
  const h: any = cx && cx.h ? cx.h : React.createElement
  const cwd: string = vcRealCwdOf(props)
  const [reads, setReadsState] = React.useState(function () { return vcRealReadsNew(cwd) })
  const [ui, setUiState] = React.useState(function () { return Object.assign({}, vcRealInitialUi(), vcRealManageUiNew()) })
  // 深链（规格 349 行）：props.deeplink 或地址栏 ?vc=... 只决定打开的位置，不做任何写动作；认不出就回首页。
  const [nav, setNavState] = React.useState(function () { return vcRealDeepLinkNavOf(vcRealDeepLinkOf(props)) || vcRealInitialNav() })
  const [changes, setChangesState] = React.useState(function () { return { values: vcRealChangesSeedOf(reads).values, rows: {} } })
  const [manage, setManageState] = React.useState(vcRealManageNew)
  // 初始宽度按壳层给的 narrow 提示取档（窄面板 380，否则 460）；进入后由下面的 ResizeObserver 按真实宽度覆写。
  const [width, setWidthState] = React.useState(function () { return props && props.narrow === true ? 380 : 460 })
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
    setNavState(vcRealDeepLinkNavOf(vcRealDeepLinkOf(props)) || vcRealInitialNav())
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
  // 任务区轮询（规格 399-403、#1776 M4a 第 4 条）：只在有任务在跑或正看着任务页时按间隔问；空闲时进入只问一次、
  //   不常驻计时器。运行中的任务从有到无时按「任务完成后」时机重读首屏。依赖里带页名与运行数，状态一变就换计时器。
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
    const running: number = Number((manage.tasks && manage.tasks.running) || 0)
    if (running <= 0 && nav.page !== 'task') return
    const interval: number = poller.intervalMs > 0 ? poller.intervalMs : 5000
    const timer: any = typeof setInterval === 'function' ? setInterval(function () { poller.tick() }, interval) : null
    return function () { if (timer !== null && typeof clearInterval === 'function') clearInterval(timer) }
  }, [cwd, nav.page, manage.tasks && manage.tasks.running])
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
  // 滚动位置按页各存一份（规格第 343 行）：回来源页时还原那一页的纵向位置；筛选词与高亮由导航快照 pages 负责。
  const scrollRef: any = React.useRef({})
  React.useEffect(function () {
    const el: any = rootRef.current
    if (!el || typeof el.addEventListener !== 'function') return
    const remember = function () { scrollRef.current[String(navRef.current.page || '')] = el.scrollTop }
    el.addEventListener('scroll', remember)
    return function () { if (typeof el.removeEventListener === 'function') el.removeEventListener('scroll', remember) }
  }, [cwd])
  React.useEffect(function () {
    const el: any = rootRef.current
    if (!el) return
    const saved: number = Number(scrollRef.current[String(nav.page || '')])
    if (isFinite(saved)) el.scrollTop = saved
  }, [nav.page, cwd])
  // 焦点接管（规格第 391 行）：浮层与确认卡打开时把焦点送进第一个可操作控件，关掉后送回触发它的按钮。
  //   状态放 ref，effect 每次渲染后跑一遍，只移动 DOM 焦点、不触发重渲染。
  const focusRef: any = React.useRef({ overlay: '', confirm: false, returnEl: null, confirmReturn: null })
  React.useEffect(function () {
    focusRef.current = vcRealFocusStepOf(rootRef.current, nav, focusRef.current)
  })
  if (vcRealCwdEmptyOf(cwd)) {
    return h('div', { id: 'vc-real-root', className: 'vcs-live', 'data-vc-live': '1', 'data-vc-live-empty': '1' },
      h('p', { className: 'vcs-live-empty', role: 'status' }, tr('vc.shell.live.emptyCwd')))
  }
  const nowTick: number = nowMs()
  const seed: any = vcRealSeedOf(reads, nav, nowTick)
  const stash: any = Object.assign({}, vcStashStateNew(), ui.stash || {})
  const changesSeed: any = vcRealChangesSeedOf(reads)
  const changeHandlers: any = vcRealChangesHandlersOf({ values: changes.values, rows: changes.rows }, setChangesState, callHost, cwd, tr, actions.gate)
  changeHandlers.onDone = function () { actionsRef.current.refresh('task-done') }
  const changesModel: any = {
    counts: changesSeed.counts,
    values: changes.values,
    rows: changes.rows,
    handlers: changeHandlers,
    // #1829 首屏文件行读的是首屏 changes 片里归一后的两组 FileEntry；筛选值住在 values.filter（默认 all）。
    files: changesSeed.files,
    // 空仓态（#1829 验收④）：工作区与改动两片都读到了，但仓库还没有任何提交（身份行没有 HEAD 短号）时给专属空态。
    //   读数没到或某片失败时不判空仓，免得把「正在读」画成「还没有提交」。
    repoEmpty: vcFirstScreenSliceStateOf(reads, 'changes') === 'ok' && vcFirstScreenSliceStateOf(reads, 'workspace') === 'ok' && String(seed.oid || '') === '',
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
    // #1829 阶段 4：带返回来源页的二级页换次级版式（身份行只剩第一行、同步带与四页签让位、管理索引不默认铺开）。
    pageOpen: !!(nav.back && nav.back.page),
    // #1840：页头返回键按来源页挂 data-log——从提交历史返回是 vc.commit.back，其余（含索引回页签）是 vc.changes.back。
    backLog: nav.back && nav.back.page === 'commits' ? VC_REAL_LOG_BACK_COMMIT : VC_REAL_LOG_BACK_CHANGES,
    width: width,
    skin: skin,
    seed: seed,
    // 四个页签的计数用首屏真实读数（规格第 22/335 行）：读数没到时画「—」，不拿 0 冒充。
    counts: vcRealTabCountsOf(reads),
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
    // 两处「交给 AI」（#1829 改动页提交区、身份行右侧、工作树页底部）：只开新会话并预填 prompt，不发 git 写电话。
    //   调用方可以传自己那件事的形状；不传时按「拿不准怎么拆提交」这一件算，与改动页的文案一致。
    onOpenHandoff: function (ai: any) {
      const handoff: any = ai && ai.kind ? ai : { kind: 'commit-split', summary: tr('vc.changes.view.aiSplit') }
      vcRealAiOpenOf(tr, reads, props && props.st, handoff,
        typeof openTextInNewSession === 'function' ? openTextInNewSession : null)
    },
  })
  const failNodes: any[] = vcRealFailNodesOf(h, tr, reads)
  const kids: any[] = [h('div', { key: 'bar', className: 'vcs-live-bar', 'data-vc-live-bar': '1' }, vcRealBarNodesOf(h, tr, reads, nav, seed))]
  // AI 兜底入口只在有「面板解决不了的事」时出现（冲突、进行中的操作、读失败五档、工作树边界），
  //   与旧块一样贴在顶栏下方；没有候选时整块不画。
  const aiNode: any = vcRealAiNodesOf(h, tr, reads, nav, props && props.st)
  if (aiNode) kids.push(aiNode)
  if (failNodes.length > 0) kids.push(h('div', { key: 'fails', className: 'vcs-live-fails', 'data-vc-live-fails': '1' }, failNodes))
  kids.push(h('div', { key: 'shell', className: 'vcs-live-shell' }, vcShellPageNode(h, tr, shellOpts)))
  return h('div', Object.assign({ id: 'vc-real-root', ref: rootRef, className: 'vcs-live', 'data-vc-live': '1', 'data-vc-live-page': nav.page, 'data-vc-live-depth': String(vcPageDepthOf(nav.page)) }, events), kids)
}

export const VC_REAL_TAB_SOURCE = 'src/client/views/versionControl/vcRealTab.ts'
