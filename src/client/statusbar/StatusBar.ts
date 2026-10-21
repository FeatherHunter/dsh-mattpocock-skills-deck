/**
 * statusbar/StatusBar.ts — 输入区状态栏（5.2）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回 src/client/index.ts（spliced）。
  * （#1251：本文件由同名 .js 转成 .ts，只补类型标注（形参一律 any）与环境声明，运行时行为一字不动。约束：不许加运行时 import（跨文件名字一律 ambient declare，构建拼闭包时拒收残留 import）；不许 export default；只写可剥离类型。）
 */
/**
 * 闭包环境声明（#1251 转 TS 时补的）：下面这些名字在源码树里没有定义，
 * 它们是别的叶子拼进同一个浏览器闭包时带进来的；类型检查靠这里声明形状。
 * 构建转译时会把 declare 整段抹掉，所以运行时一字不差。
 * 约束：以后新增跨文件引用只许在这里加 declare，不要加运行时 import
 * （构建侧 toSpliceableFragment 会拒收残留的 import，整个片段拼不进去）；
 * 也不要写 export default（构建侧 inlineExportDeclarations 不收 as 改名）。
 */
// 调用的动作函数（同目录叶子：分段、判据、阶梯机、菜单、横幅、胶囊；在办、交接、注入等由 kernel 提供）。
declare function backendColorOf(...args: any[]): any;
declare function capFoldScheduleFold(...args: any[]): any;
declare function checksumsOf(...args: any[]): any;
declare function clearStatusClose(...args: any[]): any;
declare function closeStatusBugMenu(...args: any[]): any;
declare function closeStatusGate(...args: any[]): any;
declare function closeStatusTakeMenu(...args: any[]): any;
declare function confirmStatusGate(...args: any[]): any;
declare function detectCwd(...args: any[]): any;
declare function doHandoff(...args: any[]): any;
declare function doHandoffOpen(...args: any[]): any;
declare function ensureInjectFocusAtEnd(...args: any[]): any;
declare function envLabel(...args: any[]): any;
// #1297：入口浮层本体与它的打开函数住在 kernel/entry-choice.ts，状态栏与面板两处共用同一份拼装。
declare function EntryChooser(props?: any): any;
declare function entryChooserOpen(...args: any[]): any;
declare function envTotal(...args: any[]): any;
declare function guideBannerMeta(...args: any[]): any;
declare function guideBannerParams(...args: any[]): any;
declare function guideBannerStep(...args: any[]): any;
declare function hydrateFromCache(...args: any[]): any;
declare function Ic(props?: any): any;
declare function Icon(...args: any[]): any;
declare function injectFixate(...args: any[]): any;
declare function isBackendUnavailable(...args: any[]): any;
declare function isBannerFolded(...args: any[]): any;
declare function isEnabled(...args: any[]): any;
declare function loadChain(...args: any[]): any;
declare function loadSnapshot(...args: any[]): any;
declare function newBugWayfinderText(...args: any[]): any;
declare function newSessionTitleNew(...args: any[]): any;
declare function newWayfinderText(...args: any[]): any;
declare function num(...args: any[]): any;
declare function openPanel(...args: any[]): any;
declare function openTextInNewSession(...args: any[]): any;
declare function otherFiltered(...args: any[]): any;
declare function PortalOverlay(...args: any[]): any;
declare function probeHandoffReady(...args: any[]): any;
declare function refreshAll(...args: any[]): any;
declare function runCapFold(...args: any[]): any;
declare function runGuideMissing(...args: any[]): any;
declare function scheduleStatusClose(...args: any[]): any;
declare function seg(...args: any[]): any;
declare function setBannerFolded(...args: any[]): any;
declare function showStatusBugMenu(...args: any[]): any;
declare function showStatusTakeMenu(...args: any[]): any;
declare function snapFresh(...args: any[]): any;
declare function splitTimeStr(...args: any[]): any;
declare function togglePanel(...args: any[]): any;
declare function useStatusMenus(...args: any[]): any;
declare function useStore(...args: any[]): any;
declare function withTrailingNewline(...args: any[]): any;
declare function workspaceFileNoteEl(...args: any[]): any;
// 值引用的组件与常量（传给 h 当组件用；绿点开关读字段；RDOM 是渲染目标标记）。
declare const FormModalSeat: any;
declare const logSwitch: any;
declare const RDOM: any;
declare const SessionChainCapsule: any;
declare const SkillFloatList: any;
declare const StatusLogDot: any;
declare const Tip: any;
declare const CONTAINER_ACCENT: any;

// #491 房外埋点：模块级计数（组件外一次，避免每渲染重置；只记枚举与计数，不记路径原文）。
const dswsStatusHydN = { n: 0 }
const dswsStatusFbLast = { reason: '' }
// #776 观测：上一次记过的胶囊与父容器宽度（只在变化时记，避免每次提交刷屏）。
const dswsWidthLinkLast = { cap: -1, parent: -1 }
// #891/#995 复核：上一回记过的横幅（步骤 + 文案）与它出现的钟点；只在变化时落一行 guide.banner。
const dswsBannerLast = { key: '', at: 0 }

/**
 * 状态栏最外层容器的几何（#640）。整条状态栏（横幅那一行 + 胶囊那一行）都住在这个容器里，
 * 所以它的左右边就是这两行的左右边。
 *
 * 为什么要单独写出来：宿主把输入区做成一个纵向列，列里每一项各自声明自己的宽度。宿主输入卡的真实算式是
 * （`dsh-client-ui-conversation/lib/client.js` 第 15757 行的原文）
 *   .p_FcLG_root{padding:0 var(--dsh-composer-side-clearance) 8px}    ← 内层左右各留一个「侧距」
 *   .p_FcLG_card{width:100%; max-width:var(--dsh-composer-card-max-width)}
 * 也就是「卡片外框宽 = min(列宽 − 2×侧距, 卡宽上限)」。本插件原来什么都没写，
 * 于是这个容器横向铺满整列，比输入卡左右各宽出约 90 CSS px——宿主的输入区底色从那块多出来的地方露出来，
 * 就是用户看到的那条横带。
 *
 * 所以这里照抄的是**卡片**那条算式，不是宿主自己那三个输入区商品（待办/目标/队列）用的另一条
 * 「再各内缩 2×内距」的算式：那三家是宿主要给卡片让位的挂件，本来就比卡片窄 32px；
 * 而本插件要的是「横幅/胶囊/输入卡三者左右边对齐」（issue #640 的达成判据），所以取卡片那条。
 *
 * 横向 padding 不放这里：容器带横向 padding 会把胶囊再往里挤 8px，让三者又对不上；
 * 横内边距交给胶囊自己，保证「胶囊外框 = 卡片外框」。
 *
 * 兜底为什么是 0 而不是 16：宿主那两条规则里，`--dsh-composer-side-clearance` 是**没有兜底值**的
 *   （`padding:0 var(--dsh-composer-side-clearance) 8px`）。变量缺失时那条 padding 整条作废，卡片的左右边
 *   就是列的两边、一点内缩都没有。所以这里也只有退回 0（＝不加内缩）才对得上卡片；若退回 16，
 *   在没有这个变量的旧宿主上容器反而会比卡片窄 32px（实测过，浏览器量尺给出左右各差 16）。
 * @returns {Object} 可直接塞进 style 的几何片段
 */
const dswsStatusDockGeom = function () {
  return {
    width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 0px))',
    maxWidth: 'var(--dsh-composer-card-max-width, 100%)',
    marginLeft: 'auto',
    marginRight: 'auto',
    boxSizing: 'border-box',
    padding: '3px 0 0',
  }
}
export const StatusBar = (props: any) => {
  const sid = props && props.sessionId
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const s = cx ? cx.storeSvc.useStore(sid) : useStore(sid)
  const summaryCwd = props.useSessions(function (x: any) {
    return (sid && x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined
  })
  const consumedDraftRef = React.useRef(null)
  React.useEffect(function () {
    if (props && props.inputActions && typeof props.inputActions.setDraft === 'function') {
      s.injector = props.inputActions.setDraft
    }
  }, [props.sessionId, props.inputActions])
  React.useEffect(function () {
    if (!props || !props.sessionId) return
    if (consumedDraftRef.current === props.sessionId) return
    if (!props.inputActions || typeof props.inputActions.setDraft !== 'function') return
    s.injector = props.inputActions.setDraft
    // #787 会话隔离：首条草稿住本会话自己的 store（别的会话交接时由工厂/创建链写入），只读自己、取完清空；
    //   跨会话覆盖与抢消费天然消失，无需目标编号门。
    if (s.incomingDraft) {
      consumedDraftRef.current = props.sessionId
      const text = s.incomingDraft
      s.incomingDraft = null
      var draftText = text
      try { if (typeof withTrailingNewline === 'function') draftText = withTrailingNewline(text) } catch (eNl) {}
      props.inputActions.setDraft(draftText)
      try { if (typeof ensureInjectFocusAtEnd === 'function') ensureInjectFocusAtEnd() } catch (eFocus) {}
    }
  }, [props.sessionId, props.inputActions])
  React.useEffect(function () {
    probeHandoffReady(s)
  }, [])
  React.useEffect(function () {
    const apply = function (cwd: any, src: any) {
      if (cwd && cwd !== s.cwd) {
        try { dswsStatusHydN.n += 1; if (isEnabled('debug') && dswsStatusHydN.n % 100 === 0) log('debug', 'statusbar.hydrate', { cwdSource: String(src || 'unknown') }) } catch (eL) {}
        s.cwd = cwd
        const hydrated = hydrateFromCache(s)
        emit(s)
        loadChain(s, false)
        if (!hydrated || !snapFresh(s)) loadSnapshot(s, false, !!hydrated)
      }
    }
    if (summaryCwd) { apply(summaryCwd, 'summary'); return }
    const cwd0 = detectCwd(props && props.session)
    if (cwd0) { apply(cwd0, 'session'); return }
    if (sid && typeof host !== 'undefined' && typeof host.call === 'function') {
      host.call('wf.cwd', { sessionId: sid }).then(function (res: any) {
        if (res && res.ok && res.cwd) apply(res.cwd, 'wf.cwd')
      }).catch(function () {})
    }
  }, [sid, summaryCwd])
  React.useEffect(function () { loadChain(s, false); if (!snapFresh(s)) loadSnapshot(s, false, true) }, [])
  React.useEffect(function () { try { const r = !s.snapshot ? 'no-snapshot' : (!s.cwd ? 'no-cwd' : (s.snapMode === 'err' ? 'snap-error' : '')); if (r !== dswsStatusFbLast.reason) { dswsStatusFbLast.reason = r; if (r) log('info', 'statusbar.fallback', { reason: r }) } } catch (eL) {} }, [s.snapshot, s.cwd, s.snapMode])
  const csx = checksumsOf(s)
  const { fr, bugN, triageN, n, timeStr } = csx
  // 2026-08-28 优化3：胶囊状态栏任何情况下都不隐藏（#187「未选后端隐藏整条」门控退休，仅留导航引导）。
  // _isOtherSBGate 仍用于 go()：未选后端（backendId=null 且非 pending）时点击面板分段 → 设置页引导。
  // Guard: interval transient with empty cwd should not hide capsule (prevent forced empty)
  const _selSBGate = s.selection || (s.snapshot && s.snapshot.selection) || null
  const _isOtherSBGateRaw = !!(_selSBGate && _selSBGate.backendId===null && !_selSBGate.pending)
  const _isOtherSBGate = _isOtherSBGateRaw && !!s.cwd && s.snapMode==='real' && !!s.snapshot
  const go = function (tab: any) {
    if (_isOtherSBGate && tab!=='settings') { try{ s.tab='settings'; }catch(e){}; return }
    s.tab = tab; openPanel(s)
  }
  const foldRef = React.useRef(null)
  const bugAnchorRef = React.useRef(null)
  const bugCloseRef = React.useRef(null)
  const takeAnchorRef = React.useRef(null)
  const takeCloseRef = React.useRef(null)
  const backendAnchorRef = React.useRef(null)
  const backendCloseRef = React.useRef(null)
  // 状态栏悬浮菜单定位与开关已搬 StatusMenus.js（B1 #460，纯结构；同闭包拼回直调）。
  // 以后改悬浮菜单跟随定位与开关的人改 StatusMenus.js，本处只留转调包装。
  const clearClose = function(ref: any){ clearStatusClose(ref) }
  const scheduleClose = function(ref: any, fn: any){ scheduleStatusClose(ref, fn) }
  const closeBugMenu = function(){ closeStatusBugMenu(s, bugCloseRef) }
  const showBugMenu = function(){ showStatusBugMenu(s, bugAnchorRef, bugCloseRef) }
  const closeTakeMenu = function(){ closeStatusTakeMenu(s, takeCloseRef) }
  const showTakeMenu = function(){ showStatusTakeMenu(s, takeAnchorRef, takeCloseRef) }
  // 菜单重定位副作用已搬 StatusMenus.js 的 useStatusMenus（B1 #460，同闭包拼回），此处单调供装配。
  useStatusMenus(s, { bugAnchorRef: bugAnchorRef, backendAnchorRef: backendAnchorRef, bugCloseRef: bugCloseRef, backendCloseRef: backendCloseRef, takeAnchorRef: takeAnchorRef, takeCloseRef: takeCloseRef })
  // 胶囊阶梯机（#725）：判据在 statusbar/capFold.js，机器在 statusbar/capFoldMachine.js，这里只留接线。
  //   这两张表（每一段完整那串字 / 机器上一次写下的那串字）必须跨调用带着走，所以挂在 ref 上。
  const foldKeep = React.useRef({ full: {}, written: {} })
  // #725 真机回归补的一条：观察器盯的是**元素**，而胶囊这个元素是会换代的（功能区先收起、再展开时
  //   React 会新造一个；旧那个已经被摘下来，它的尺寸从此不会再变、观察器也就再不会响）。于是
  //   「宽度变了」这条信号在换代之后就断了 —— 量错了的档位会一直挂在那儿，直到有人碰窗口尺寸或
  //   恰好来了别的提交。这里记下当前盯着的那个元素，applyFold 每次进场先对一眼：换了就把观察器挪过去。
  const foldWatch = React.useRef(null)
  const scheduleFold = function () { capFoldScheduleFold(foldKeep.current, applyFold) } // 926 同帧合并：四路触发进队列，同帧只真跑一次（实现见机器；挂载首跑仍同步）。
  const applyFold = function () {
    const cap = foldRef.current
    if (cap) runCapFold(cap, foldKeep.current)
    // #776 只加日志不改行为：记下胶囊与父容器的宽度（列宽联动单向收敛的证据）。
    //   按需级，先判开关；只在变化时记，不采样（宽度不变的提交不落行）。
    //   门禁要求调试级调用与是否开启判断同行（先判开关再组装字段，关着不读尺寸），所以下面三行是单行式。
    try { if (cap && isEnabled('debug')) { const capW = Math.round(Number(cap.clientWidth) || 0); const parentW = Math.round(Number((cap.parentElement && cap.parentElement.clientWidth) || 0)); const changed = (capW !== dswsWidthLinkLast.cap || parentW !== dswsWidthLinkLast.parent); if (changed && isEnabled('debug')) log('debug', 'input.observe', { kind: 'width-link', count: capW, latencyMs: parentW, keyHash: dswsLogHash(String((s && s.cwd) || '')) }); if (changed) { dswsWidthLinkLast.cap = capW; dswsWidthLinkLast.parent = parentW } } } catch (eWl) {}
    const w = foldWatch.current
    if (cap && w && w.el !== cap) {
      try { w.roFold.disconnect() } catch (e) {}
      try { w.roParent.disconnect() } catch (e) {}
      try { w.roFold.observe(cap); if (cap.parentElement) w.roParent.observe(cap.parentElement) } catch (e) {}
      w.el = cap
    }
  }
  React.useEffect(function () {
    // 第一性原理方案 B：胶囊宽度不再 JS 设像素，完全由 CSS 变量 --dsh-composer-card-max-width 驱动（与输入卡同源）。
    // 旧方案量具体 textarea 卡死 780 的根因已消除；此处仅负责内容折叠（applyFold）对可用宽度的响应。
    // 可用宽 = 胶囊 clientWidth（已由 CSS 随对话框 --dsh-conversation-column-width 自动伸缩），
    // 因此只需观察胶囊及其父容器的尺寸变化即可触发折叠，无需再监听输入框。
    const roFold = new ResizeObserver(function () { scheduleFold() })
    const roParent = new ResizeObserver(function () { scheduleFold() })
    applyFold()
    if (foldRef.current) {
      roFold.observe(foldRef.current)
      try { if (foldRef.current.parentElement) roParent.observe(foldRef.current.parentElement) } catch(e){}
      foldWatch.current = { roFold: roFold, roParent: roParent, el: foldRef.current }
    }
    window.addEventListener('resize', scheduleFold)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleFold)
    return function () {
      try { roFold.disconnect() } catch (e) {}
      try { roParent.disconnect() } catch(e){}
      window.removeEventListener('resize', scheduleFold)
    }
  }, [])
  // 2026-09-24（#725）：原先这里还挂着一个 2 秒轮询（setInterval → applyFold），本票把它去掉了。
  //   它当时兜的是「字被换掉了、但尺寸没有变，观察器不会响」这一种：React 重渲染时会把收短过的那串字
  //   换回完整的一串（时间串一直在变），那一刻胶囊可能当场溢出。这件事现在由下面这条副作用接管 ——
  //   它在每次提交之后跑一次，不排任何定时器、也不自续：谁把字写回完整的，下一帧就又被收一遍。
  React.useEffect(function () { scheduleFold() })
  // #196 · 状态栏胶囊移除 backend segment 后不再在此处挂 SwitchConfirmModal（仍由 Dock/Overlay 挂载，状态机保留）
  const _isGatePending = !!(_selSBGate && _selSBGate.pending && !!s.cwd)
  const _gateActive = _isOtherSBGate || _isGatePending
  // BUG2 修复（2026-08-28）：后端未确定（无 selection 或 backendId 为空）时只显示门控条——
  //   链快照（wf.chain）常早于选择回填到达，若此刻开放 setup/skills 黄条判定，
  //   全新工作区会「尚未初始化/技能缺失」黄条一闪而过，再跳到正确的 gate 蓝条。
  const _backendUndecided = !(_selSBGate && _selSBGate.backendId)
  // #727（I2 · 「未知 ≠ 否」）：后端还不确定时还要分清「还没读到」与「确实没有设置」——这句判据原先只有
  //   「该工作区还没有设置」一个形态，于是「那条取数正飞着」也被说成「没有设置」。两个在途理由都算：面板取数
  //   那一趟还没回话（s.snapLoading）、那条专用电话还没回话（s.selPending，见 probe-select.js）。只管表达面。
  const _selReading = !!(s.cwd && _backendUndecided && (s.snapLoading === true || s.selPending === true))
  // #663：今天出哪一条横幅改由清单决定（statusbar/bannerChain.js 的 guideBannerStep）——
  //   按 guideStepsFor(当前后端) 的顺序逐个看，第一个没过、且带横幅的那一步就是它；
  //   门控那一档读本地状态（上面那两个判定），其余读链快照。于是「黄条等仓库就绪」是顺序本身的结果：
  //   仓库那一步排在初始化之前，它没过就轮不到黄条（此前这条优先级链里根本没有仓库那一段）。
  const bannerStep = guideBannerStep(s, _gateActive || _backendUndecided)
  // #891/#995/#916/#917 复核：几张口口相传的票子都卡在「黄条该消失时没消失」「本不该出现的黄条出现了」，
  //   而今天没有任何一行日志记「横幅什么时候出现、出现的是哪一条、挂了多久才消失」。这里按边沿触发补一行常驻
  //   info（只在步骤或文案变化时写）：出现记 shown、消失记 cleared，ageMs 是上一条挂了多久。字段只有短枚举与
  //   毫秒数，不记工作区路径、不记标题。放在收起态早返回之前，保证收起/展开两种状态都记得到。
  let _bannerMetaLog: any = null
  try { if (bannerStep) _bannerMetaLog = (typeof guideBannerMeta === 'function') ? guideBannerMeta(s, bannerStep) : (bannerStep.banner || null) } catch (eBm) {}
  const _bannerLogKey = bannerStep ? (String(bannerStep.id || '') + '|' + String((_bannerMetaLog && _bannerMetaLog.text) || '')) : ''
  React.useEffect(function () {
    try {
      const now = Date.now()
      if (dswsBannerLast.key === _bannerLogKey) return
      const prev = dswsBannerLast
      let text = ''
      let tone = ''
      try { if (_bannerMetaLog) { text = String(_bannerMetaLog.text || ''); tone = String(_bannerMetaLog.tone || '') } } catch (eT) {}
      try { log('info', 'guide.banner', { step: String((bannerStep && bannerStep.id) || ''), banner: text, tone: tone, outcome: _bannerLogKey ? 'shown' : 'cleared', ageMs: prev.at ? (now - prev.at) : 0 }) } catch (eL) {}
      dswsBannerLast.key = _bannerLogKey
      dswsBannerLast.at = now
    } catch (e) {}
  }, [_bannerLogKey])
  // #422 · 收起整个功能区：横幅上的叉收起横幅与胶囊状态栏（打破胶囊永不隐藏旧规）；默认展开，按工作区记住。
  const deckFolded = isBannerFolded(s.cwd)
  const foldBanner = function () { try { setBannerFolded(s.cwd, true) } catch (e) {} }
  const expandBanner = function () { try { setBannerFolded(s.cwd, false) } catch (e) {} }
  // 收放按钮：胶囊最右侧的“∨”图标（无文字，技能入口之后）；收起态为带文字的小按钮（悬停与无障碍文案保留全称）。
  const capsuleToggle = h(Tip, { content: tr('banner.foldDeck') }, h('span', { className: 'dsws-fold-toggle', onClick: function (e: any) { e.stopPropagation(); foldBanner() }, 'aria-label': tr('banner.foldDeck'),
    // 接线（#1335 界面反馈）：收起整块功能区的叉是纯图标控件，只接按压压暗，不加悬停类，
    // 免得小图标按下时下沉一像素看着像错位；日志标识与胶囊本体那条分开。
    'data-press': 'icon',
    'data-log': 'status.capsule.fold',
    style: { display: 'inline-flex', alignItems: 'center', padding: '2px 2px', borderRadius: 6, color: 'var(--dsw-alias-label-caption,#8b8b95)', cursor: 'pointer', flex: 'none' } }, [
    Ic({ n: 'chev-down', size: 12 }),
  ]))
  // 弹窗座位（2026-09-21）：从这里渲染，不再挂在右侧面板的检查页上。
  //   为什么搬家：弹窗的**界面**本来就是全屏遮罩（`.dsws-modal` 是 position:fixed 挂到 body，样式见 kernel/styles.js），
  //   但它的 React 生命原来绑在检查页上（`Dock.js` 只在「面板当前页 = 检查」时渲染 ChecksTab），于是
  //     · 右侧面板没打开、或面板不在检查页时，点横幅那颗「创建并发布」按钮**什么都不会发生** ——
  //       状态写进去了（`slotRenderer-queue.js` 里 `m.open = true` 加 emit），却没有组件去渲染它；
  //       用户要等到哪天打开面板切到检查页，弹窗才突然冒出来（用户看到的是「点了没反应」与「出得很慢」两件事）。
  //     · 反方向同样错：在检查页点出来之后切到别的标签页，弹窗跟着消失。
  //   状态栏这一支挂在宿主的输入区 dock 上（panelAssembly.js 注册 conversation.input.dock），
  //   与右侧面板是否存在无关，正是「全应用之上」该有的宿主。三个分支（收起态 / 无横幅 / 有横幅）都要带上它：
  //   漏掉任何一支，那一支下点按钮就又会回到「什么都没有」。
  //   先例：同目录的 StatusLogMenu.js 就是从状态栏弹一张盖住全应用的小窗；组件本身取不到会话状态时自己返回 null。
  //   #698（2026-09-22）：那个「域文档布局」的小卡也搬进了这个座位（渲染在 slotRenderer-modal-view.js 的
  //   SetupLayoutCard），所以本文件里原先挂在黄条下面的那份卡整份删掉 —— 一个座位上只留一处渲染，
  //   卡因此与「当前有没有横幅」「功能区收没收起」都不再相干，而它在「已初始化 + 切后端」那条路上也画得出来。
  const modalSeat = (typeof FormModalSeat === 'function') ? h(FormModalSeat, { st: s }) : null
  if (deckFolded) {
    // 收起态：整个功能区只剩这一颗细小灰字按钮（点即恢复横幅与状态栏；设置页工作区行是另一条恢复路径）。
    // 2026-09-21 按维护者要求还原：2026-09-20 那两轮一度把它画成「有底色、有描边、12px 粗体、带面板图标」的按钮，
    //   维护者看过真机之后不认可那一下改动（收起态原本只有一句 10px 灰字，改完高了一倍多、显眼过头），
    //   要求退回改动前的样子。所以这里照原文写回：10px、无底色、无描边、圆角 99。
    //   收起与展开这条行为一点没动 —— 点它照样把横幅与胶囊一起带回来（下面那道「回来的路」门禁仍然钉着这一点）。
    // #640：收起态是例外 —— 只剩一句小灰字时不再跟卡片等宽，改收成包裹内容居中，
    //   避免一条空旷横带占住输入区上方；maxWidth 仍取卡宽变量兜底超长文案，展开/收起之间不横向跳动。
    return h('div', { style: Object.assign({ display: 'flex', flex: 'none', justifyContent: 'center', alignSelf: 'center' }, dswsStatusDockGeom(), { width: 'auto' }) }, [
      h(Tip, { content: tr('banner.folded') }, h('button', { className: 'dsws-btn ghost dsws-hov', 'aria-label': tr('banner.expandDeck'),
        // 接线（#1335 界面反馈）：收起态这颗「展开」按钮带文字，属于文字类控件，按压与悬停都要有；
        // 日志标识 status.banner.expand 用来认出刚才点的是它。
        'data-press': 'button',
        'data-log': 'status.banner.expand',
        onClick: expandBanner, style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '0 8px', lineHeight: 1.2, border: 'none', borderRadius: 99, color: 'var(--dsws-alias-label-caption,#8b8b95)' } }, [
        Ic({ n: 'chev-up', size: 10 }),
        h('span', null, tr('banner.expandDeck')),
      ])),
      modalSeat,
    ])
  }
  // #522：调试开关关闭时小灰点不挂载（胶囊里不留空位）；开时常驻；开关切换经已有的日志开关广播刷新各会话界面，此处只读开关不另加广播。
  let logDotOn = false
  try { logDotOn = !!(typeof logSwitch !== 'undefined' && logSwitch && logSwitch.enabled === true) } catch (eLogDot) {}
  // 优化3：胶囊恒渲染（任何情况下不隐藏）；未选后端时其上方叠加 gate 蓝条引导入口
  // 接线（#1335 界面反馈）：胶囊整条都能点（点到空白处开面板），所以容器自己接一组 data-press 与 data-log；
  // 里面每颗控件另接自己的一组，两层的标识分开，事后才分得清点到的是胶囊空白还是某一颗按钮。
  const capsule = h('div', { className: 'dsws-capsule dsws-hov', ref: foldRef, onClick: function () { openPanel(s) },
    'data-press': 'row',
    'data-log': 'status.capsule',
    style: { position: 'relative', width: '100%', boxSizing: 'border-box' } }, [
    h('span', { className: 'dsws-capsule-word dsws-hov', onClick: function (e: any) { e.stopPropagation(); togglePanel(s) },
      // 接线（#1335 界面反馈）：品牌字这一颗自己会开合面板，跟胶囊空白处的「开面板」不是同一个动作，
      // 所以另接一组标识（status.capsule.word），日志里才分得出点的是哪一个。
      'data-press': 'button',
      'data-log': 'status.capsule.word' }, [
      Icon({ scheme: s.ui.icon, size: 14 }),
      h('span', { 'data-fold-priority': 1 }, tr('panel.title')),
    ]),
    h(SessionChainCapsule, { st: s, sid: sid }),
    h('span', { ref: takeAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showTakeMenu, onMouseLeave: function () { scheduleClose(takeCloseRef, closeTakeMenu) } }, [
      h(Tip, { content: tr('nav.takeableTitle') }, seg('target', [h('span', { 'data-fold-priority': 9 }, tr('nav.takeable')), num(String(fr), '2ch')], '#4ade80', function () { s.stateFilter = 'frontier'; s.lblFilters = []; go('list') }, undefined, 'status.seg.takeable')),
      s.takeMenuOpen ? PortalOverlay({ className: 'dsws-takemenu', onMouseEnter: function () { clearClose(takeCloseRef) }, onMouseLeave: function () { scheduleClose(takeCloseRef, closeTakeMenu) }, onClick: function (e: any) { e.stopPropagation() }, style: { position: 'fixed', left: s.takeMenuPos ? s.takeMenuPos.left : 0, bottom: s.takeMenuPos ? s.takeMenuPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)' } }, [
        // #1297：悬停菜单里只留一颗「新建需求」——点它弹与面板那一排完全相同的两张卡浮层
        //   （同一份组件、同一套开场白），浮层从下方弹出，位置按这颗菜单项自己的 rect 量。
        h('div', { className: 'dsws-hov', onClick: function (e: any) { e.stopPropagation(); closeTakeMenu(); entryChooserOpen(s, 'statusbar', e && e.currentTarget) },
          // 接线（#1335 界面反馈）：悬停菜单里这颗「新建需求」是行内文字按钮，
          // 按压与悬停都要有；日志标识 status.menu.take.new 与缺陷那条分开认。
          'data-press': 'button',
          'data-log': 'status.menu.take.new',
          onMouseEnter: function () { if (!s.takeMenuHover) { s.takeMenuHover = true; emit(s) } }, onMouseLeave: function () { if (s.takeMenuHover) { s.takeMenuHover = false; emit(s) } }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.takeMenuHover ? ((typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '') : 'var(--dsw-alias-label-primary,#e6edf3)', background: s.takeMenuHover ? 'rgba(192,132,252,.15)' : 'transparent', whiteSpace: 'nowrap' } }, [
          Ic({ n: 'map', size: 12, color: s.takeMenuHover ? '#d8b4fe' : ((typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '') }),
          h('span', null, tr('nav.takeableNew')),
        ]),
      ]) : null,
    ]),
    h('span', { ref: bugAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showBugMenu, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) } }, [
      h(Tip, { content: tr('nav.bugTitle') }, seg('alert', [h('span', { 'data-fold-priority': 10 }, tr('nav.bug')), num(String(bugN), '2ch')], '#f87171', function () { s.stateFilter = 'open'; s.lblFilters = ['bug']; go('list') }, undefined, 'status.seg.bug')),
      s.bugMenuOpen ? PortalOverlay({ className: 'dsws-bugmenu', onMouseEnter: function () { clearClose(bugCloseRef) }, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) }, onClick: function (e: any) { e.stopPropagation() }, style: { position: 'fixed', left: s.bugMenuPos ? s.bugMenuPos.left : 0, bottom: s.bugMenuPos ? s.bugMenuPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)' } }, [
        h('div', { className: 'dsws-hov', onClick: function (e: any) { e.stopPropagation(); closeBugMenu(); openTextInNewSession(s, newBugWayfinderText(s), newSessionTitleNew('bug')) },
          // 接线（#1335 界面反馈）：悬停菜单里这颗「新建缺陷」是行内文字按钮；
          // 日志标识 status.menu.bug.new。
          'data-press': 'button',
          'data-log': 'status.menu.bug.new',
          onMouseEnter: function () { if (!s.bugMenuHover) { s.bugMenuHover = true; emit(s) } }, onMouseLeave: function () { if (s.bugMenuHover) { s.bugMenuHover = false; emit(s) } }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.bugMenuHover ? '#f87171' : 'var(--dsw-alias-label-primary,#e6edf3)', background: s.bugMenuHover ? 'rgba(248,113,113,.15)' : 'transparent', whiteSpace: 'nowrap' } }, [
          Ic({ n: 'bug', size: 12, color: s.bugMenuHover ? '#fca5a5' : '#f87171' }),
          h('span', null, tr('nav.bugNew')),
        ]),
      ]) : null,
    ]),
    h(Tip, { content: tr('nav.triageTitle') }, seg('search', [h('span', { 'data-fold-priority': 11 }, tr('nav.triage')), num(String(triageN), '2ch')], '#f59e0b', function () { s.stateFilter = 'open'; s.lblFilters = ['needs-triage']; go('list') }, undefined, 'status.seg.triage')),
    h(Tip, { content: tr('nav.fixateTitle') }, seg('note', h('span', { 'data-fold-priority': 7 }, tr('nav.word')), (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '', function () { injectFixate(s) }, undefined, 'status.seg.fixate')),
    h('span', { className: 'dsws-split' }, [
      h(Tip, { content: tr('nav.handoffTitle') }, h('span', { className: 'dsws-split-part dsws-hov', onClick: function (e: any) { e.stopPropagation(); doHandoff(s) }, 'aria-label': tr('nav.handoffTitle'),
        // 接线（#1335 界面反馈）：交接这一段有图标也有文字，属于文字类控件，按压与悬停都要有；
        // 日志标识 status.handoff 与右边那颗纯图标的「打开」分开认。
        'data-press': 'button',
        'data-log': 'status.handoff',
        style: { color: '#58a6ff' } }, [
        Ic({ n: 'handoff', size: 12 }),
        h('span', { 'data-fold-priority': 8 }, tr('nav.handoff')),
      ])),
      h('span', { className: 'dsws-split-div' }),
      h(Tip, { content: s.handoffReady ? tr('nav.handoffReadyTitle') : tr('nav.handoffGreyTitle') }, h('span', { className: 'dsws-split-part', onClick: function (e: any) { e.stopPropagation(); doHandoffOpen(s) }, 'aria-label': s.handoffReady ? tr('nav.handoffReadyTitle') : tr('nav.handoffGreyTitle'),
        // 接线（#1335 界面反馈）：这一颗只有图标（就绪前是转圈），所以只接按压压暗，不加悬停类。
        'data-press': 'icon',
        'data-log': 'status.handoff.open',
        style: s.handoffReady ? { color: '#58a6ff' } : { color: '#8b8b95', opacity: 0.55, cursor: 'default' } }, [
        s.handoffSearching ? h('span', { className: 'dsws-spinner', style: { width: 12, height: 12, borderWidth: 2, boxSizing: 'border-box', display: 'inline-block', verticalAlign: '-2px' } }) : Ic({ n: s.handoffReady ? 'handoff-open' : 'handoff-off', size: 12 }),
      ])),
    ]),
    h(Tip, { content: tr('nav.envTitle', { n: n < 0 ? '?' : String(n), t: String(envTotal(s)) }) }, seg(n < 0 ? 'alert' : (n === envTotal(s) ? 'check' : 'dot'), [h('span', { 'data-fold-priority': 4 }, tr('nav.env')), h('span', { className: 'dsws-num', 'data-fold-priority': 5 }, envLabel(s))], n < 0 ? '#f87171' : n === envTotal(s) ? '#4ade80' : '#f59e0b', function () { go('checks') }, 14, 'status.seg.env')),
    h(Tip, { content: tr('nav.refreshTitle') }, h('span', { className: 'dsws-timebtn dsws-hov', onClick: function (e: any) { e.stopPropagation(); refreshAll(s) }, 'aria-label': tr('nav.refreshTitle'),
      // 接线（#1335 界面反馈）：刷新那颗带图标带文字，属于文字类控件；日志标识 status.refresh。
      'data-press': 'button',
      'data-log': 'status.refresh' }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', { 'data-fold-priority': 2 }, tr('nav.refresh')), h('span', { key: 'dd', 'data-fold-priority': 3 }, splitTimeStr(' ' + timeStr).date), h('span', { key: 'tt', 'data-fold-priority': 6 }, splitTimeStr(' ' + timeStr).time)])),
    h(SkillFloatList, { s: s }),
    logDotOn ? h(StatusLogDot, { s: s }) : null,
    capsuleToggle,
    // #1297：入口浮层挂在状态栏这一层（不是悬停菜单里）：菜单随鼠标离开关门时浮层不受影响，
    //   打开后鼠标可以自由移到浮层上选卡。
    h(EntryChooser, { key: 'entryChooser', st: s, from: 'statusbar' }),
  ])
  // 状态栏后端选择与门控动作已搬 StatusBackend.js（B1 #460，纯结构；同闭包拼回直调）。
  // 以后改状态栏后端选择（setup 黄条与 gate 蓝条）的人改 StatusBackend.js，本处只留转调包装。
  // #663：横幅那条链（出哪一条、按钮点下去干什么）搬去 statusbar/bannerChain.js，
  //   所以原先「开选后端窗」与「点初始化」那两个转调包装删了 —— 两条都走 bannerChain 的统一入口。
  const closeGate = function(){ closeStatusGate(s) }
  const confirmGateStatus = function(){ confirmStatusGate(s) }
  // #655：这张卡由注入决策函数打开（黄条那颗按钮走 onStatusSetupInit，检查页红牌那颗「执行初始化」也走同一个函数）。
  // #669 第 4 件（2026-09-21）：这张卡只问「域文档布局」这一问。
  //   它原先还带着一组后端单选（标题也写着「选择希望使用的后端」），那是更早流程的遗留：到这一步后端早已在
  //   门控那一步定完（#663 起门控那个窗只问后端），再问一遍不只是多余 —— 卡上那颗「确认并继续」会把工作区
  //   重新绑一遍（等于从一张「只是答个布局」的卡上换后端）。现在卡上只读地写出这次用哪个后端、去哪儿换，
  //   换后端仍走右侧面板那颗「切换后端」。
  // #698（2026-09-22）：这张卡的**界面**搬去弹窗座位那一层了（slotRenderer-modal-view.js 的 SetupLayoutCard，
  //   渲染入口就是上面那个座位（那个 const））—— 它原先只挂在本文件这条黄条下面，于是工作区一旦初始化过、
  //   黄条不出现，卡就没有地方可画（「切换后端时改布局」这条路上工作区总是初始化过的）。
  //   这里因此不再声明它；两个转调包装留着，卡的界面在那边直接调用它们。
  if (!bannerStep) {
    // 无 banner 时为胶囊 + 常驻收起按钮（#422：收起即整个功能区消失）
    return h('div', { style: Object.assign({ display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 2, overflow: RDOM ? 'hidden' : 'visible' }, dswsStatusDockGeom()) }, [modalSeat, workspaceFileNoteEl(s), capsule])
  }
  const bann = function (text: any, btnLabel: any, onBtn: any, foldable: any) {
    // #669：这颗叉（收起整个功能区）与左边那颗主按钮之间留 12px —— 原来只隔 6px，两颗按钮长得一样高、
    //   一样是描边方块，用户冲黄条那颗主按钮点下去、手一偏就落在叉上，于是「点了黄条，整条状态栏全没了」。
    //   留开距离不能让手不偏，但能让两颗按钮在视觉上分成两组，点之前看得出来是两件事。这一段保留。
    // 2026-09-21 按维护者要求还原：2026-09-20 那次一度把它改成带字的「收起」（怕纯图形叉被读成「关掉这条黄条」），
    //   维护者看过真机之后要求退回改动前的图形叉。叉形字形 11px、悬停与无障碍名仍是全称「收起MattSkillsDeck」。
    return h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, cursor: 'default' } }, [
      Ic({ n: 'alert', size: 13 }),
      h('span', { style: { flex: 1 } }, text),
      h('button', { className: 'dsws-btn dsws-hov', style: { borderColor: 'rgba(245,158,11,.6)' },
        // 接线（#1335 界面反馈）：黄条主按钮有文字，按压与悬停都要有；日志标识 status.banner.action。
        'data-press': 'button',
        'data-log': 'status.banner.action',
        onClick: onBtn }, btnLabel),
      foldable ? h(Tip, { content: tr('banner.foldDeck') }, h('button', { className: 'dsws-btn ghost dsws-banner-fold-x', 'aria-label': tr('banner.foldDeck'),
        // 接线（#1335 界面反馈）：黄条那颗叉是纯图标，只接按压压暗；日志标识 status.banner.fold。
        'data-press': 'icon',
        'data-log': 'status.banner.fold',
        onClick: foldBanner, style: { borderColor: 'rgba(245,158,11,.6)', padding: '1px 6px', marginLeft: 12, display: 'inline-flex', alignItems: 'center' } }, Ic({ n: 'x', size: 11 }))) : null,
    ])
  }
  // #663：横幅就这一条 —— 正文与按钮标签用清单里那对词条键，按钮点下去照清单声明的 missing 走
  //   （注入哪段文案 / 开哪个弹窗 / 开选后端窗，都由 bannerChain.js 执行并落一行常驻日志）。
  const stepBanner = (function () {
    const meta = (typeof guideBannerMeta === 'function') ? guideBannerMeta(s, bannerStep) : (bannerStep.banner || {})
    // 蓝条那一档（后端还没选定）仍是今天这套样式，含「正在探测后端」那个过渡态。
    if (meta.tone === 'info') {
      // #727：这一档原先只有两个形态（正在探测后端 / 还没有设置）。后端还没读到、而理由确实在途时（见上面
      //   _selReading），不许说成「还没有设置」—— 那是把一个「还不知道」当成了结论，用户会去点那颗按钮重新选
      //   一遍后端，而其实只要等这一趟回话。所以这一档多一句「正在读取」，一个动作都不给。最外层那条读的仍是
      //   _isGatePending（探测在后端那件事上的过渡态），一个字没动。
      // 接线（#1335 界面反馈）：蓝条（后端还没选定）上的按钮与那颗叉都是能点到的，各接一组标识：
      //   按钮 status.banner.gate.action 有文字（加悬停反馈），叉 status.banner.gate.fold 是纯图标（只压暗）。
      const infoBar = function (reading: any) { const text = reading ? tr('banner.gateReading') : tr(meta.text); const act = reading ? null : h('button', { className:'dsws-btn dsws-hov', style:{ borderColor:'rgba(56,139,253,.6)', color:'#58a6ff', fontSize:11 }, 'data-press':'button', 'data-log':'status.banner.gate.action', onClick: function(){ runGuideMissing(s, bannerStep) } }, tr(meta.btn)); return h('div', { className: 'dsws-banner', style: { margin: 0, maxWidth: 560, background:'rgba(56,139,253,.10)', border:'1px solid rgba(56,139,253,.35)', color:'#58a6ff', display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:8 } }, [ reading ? h('span', { className:'dsws-spinner', style:{ width:12, height:12, borderWidth:2, display:'inline-block' } }) : Ic({ n:'compass', size:13, color:'#58a6ff' }), h('span', { style:{ flex:1, fontSize:12 } }, text), act, h(Tip, { content: tr('banner.foldDeck') }, h('button', { className:'dsws-btn ghost dsws-banner-fold-x', 'aria-label': tr('banner.foldDeck'), 'data-press':'icon', 'data-log':'status.banner.gate.fold', style:{ borderColor:'rgba(56,139,253,.6)', color:'#58a6ff', padding:'1px 6px', marginLeft:12, display:'inline-flex', alignItems:'center' }, onClick: foldBanner }, Ic({ n:'x', size:11 }))) ]) }
      return _isGatePending
        ? h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.35)', color:'#f59e0b', display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:8 } }, [ h('span', { className:'dsws-spinner', style:{ width:12, height:12, borderWidth:2, display:'inline-block' } }), h('span', { style:{ flex:1, fontSize:12 } }, '正在探测后端'), h('button', { className:'dsws-btn dsws-hov', style:{ borderColor:'rgba(245,158,11,.6)', fontSize:11 }, 'data-press':'button', 'data-log':'status.banner.retry', onClick:function(){ loadSnapshot(s,true,true) } }, '重试'), h(Tip, { content: tr('banner.foldDeck') }, h('button', { className:'dsws-btn ghost dsws-banner-fold-x', 'aria-label': tr('banner.foldDeck'), 'data-press':'icon', 'data-log':'status.banner.pending.fold', style:{ borderColor:'rgba(245,158,11,.6)', color:'#f59e0b', padding:'1px 6px', marginLeft:12, display:'inline-flex', alignItems:'center' }, onClick: foldBanner }, Ic({ n:'x', size:11 }))) ])
        : infoBar(_selReading)
    }
    const node = bann(tr(meta.text, guideBannerParams(s, bannerStep)), tr(meta.btn), function () { runGuideMissing(s, bannerStep) }, true)
    // #698：这一支原先在黄条正文下面挂那张布局小卡；卡已搬去弹窗座位（上面那一处），
    //   所以这里不再拼它 —— 黄条照旧出，卡在哪个分支都画得出来。
    return node
  })()
  return h('div', { style: Object.assign({ display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative' }, dswsStatusDockGeom()) }, [
    stepBanner, workspaceFileNoteEl(s),
    capsule,
    modalSeat,
    (s.gateModalOpen && s.gateModalSource==='status' ? h('div', { onClick:function(e: any){ if(e.target===e.currentTarget) closeGate() },
      // 接线（#1335 界面反馈）：点遮罩空白处会关掉这个窗，遮罩自己也是能点到的，所以接一组标识；
      // 它不是按钮，用 data-press 的 other 档，表示「按下去的是个没有固定形状的东西」。
      'data-press': 'other',
      'data-log': 'status.gate.backdrop',
      style:{ position:'absolute', inset:0, background:'rgba(0,0,0,.65)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:10, borderRadius:8, padding:12 } }, [
      h('div', { style:{ background:'var(--dsw-alias-bg-layer-2,#16181d)', border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:12, padding:14, width:'92%', maxWidth:380, boxShadow:'0 8px 24px rgba(0,0,0,.5)' } }, [
        h('div', { style:{ fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:6, marginBottom:6 } }, [Ic({n:'compass',size:14}), h('span', null, tr('switch.pleaseSelectTracker'))]),
        h('div', { style:{ fontSize:11, color:'#8b8b95', marginBottom:10, lineHeight:1.5 } }, tr('switch.gateIntro')),
        h('div', { style:{ fontSize:11, color:'#f59e0b', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', borderRadius:6, padding:'6px 8px', marginBottom:10 } }, tr('gate.wipNotice')),
        s.gateLoading ? h('div', { style:{ fontSize:11, color:'#8b8b95', padding:'6px 0' } }, tr('panel.loadingShort')) : h('div', { style:{ display:'flex', flexDirection:'column', gap:6 } }, otherFiltered(s.backendModules).map(function(m: any){
          const isSel=s.gateSelected===m.id; const col=(typeof backendColorOf==='function'?backendColorOf(m.id):'#6e7681'); const isRec=(s.backendModules||[])[0] && (s.backendModules||[])[0].id===m.id;
          // #669 第 6 件（ADR 20260921）：能力不全的后端（今天只有 GitLab）在这里也置灰不可选，判据问 isBackendUnavailable 一份
          const locked=(typeof isBackendUnavailable==='function')&&isBackendUnavailable(m.id);
          // 接线（#1335 界面反馈）：这一行是用户点得到的后端单选行，整行都能点，所以用 row 这一档；
          // data-log 放在 label 上而不是行里的 radio：点行上的字时浏览器会再合成一次 radio 的点击，
          // 放 label 上两次点击记的都是同一颗（重复但认得准），放 radio 上那次点击会被记成遮罩（认错人）。
          const row = h('label', { key:m.id, 'data-target-id':m.id, 'data-target-locked': locked?1:0, className:'dsws-hov',
            'data-press':'row', 'data-log':'status.gate.target.' + m.id, style:{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, border:isSel?'1px solid '+col:'1px solid var(--dsw-alias-border-l1,#2a2d35)', background:isSel?'rgba(88,166,255,.08)':'transparent', cursor: locked?'not-allowed':'pointer', opacity: locked?0.45:1 } }, [ h('input',{type:'radio',checked:isSel,disabled:!!locked,onChange:function(){ if(locked) return; s.gateSelected=m.id;emit(s)}}), h('span',{style:{width:8,height:8,borderRadius:'50%',background:col,flex:'none'}}), h('span',{style:{fontSize:12,fontWeight:600}},m.label), h('span',{style:{fontSize:10,color:'#8b8b95'}},m.id), h('span',{style:{flex:1}}), isRec?h('span',{style:{fontSize:10,color:'#4ade80',border:'1px solid #4ade80',borderRadius:4,padding:'0 4px'}},'推荐'):null ])
          return locked ? h(Tip, { key:m.id, content: tr('switch.targetLockedTip') }, row) : row
        })),
        s.gateError ? h('div', { style:{ fontSize:11, color:'#f87171', marginTop:8 } }, s.gateError) : null,
        // #663：这个窗里那组「域文档布局」单选撤掉了 —— 全新工作区打开时还没装 gh、还没建仓库，
        //   问「各部分共用一套用语吗」是超前的问题；布局那一问现在只在初始化那一步出现（黄条弹的小卡），
        //   与之配套的「确认后不注入」一起改在 StatusBackend.js 的 confirmStatusGate（撤单选不撤注入会弹出一张没有座位的卡）。
        // 接线（#1335 界面反馈）：这个窗底下两颗按钮的动作不同（取消 / 确认并继续），
        // 都要按压反馈与点击日志，标识 status.gate.cancel 与 status.gate.confirm 分开认。
        h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 } }, [ h('button',{className:'dsws-btn ghost dsws-hov','data-press':'button','data-log':'status.gate.cancel',onClick:closeGate,style:{fontSize:12}},'取消'), h('button',{className:'dsws-btn dsws-hov','data-press':'button','data-log':'status.gate.confirm',style:{background:'#58a6ff',borderColor:'#58a6ff',color:'#0b1220',fontWeight:700,fontSize:12},onClick:confirmGateStatus},'确认并继续') ])
      ])
    ]) : null),
  ])
}