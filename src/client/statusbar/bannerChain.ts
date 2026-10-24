/**
 * statusbar/bannerChain.ts — 状态栏那条横幅：按首开引导链的步骤清单决定今天出哪一条，以及那条的按钮点了做什么（#663）。
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export，拼回 src/client/index.ts
 * 里那条 leaf:bannerChain 拼接标记处（源码树里只有这一份真源，标记 id 与本文件名一致）。
 * 顺序与「这一步没过时给什么」只有一份真源：src/shared/tracker/guide-steps.ts 的 GUIDE_STEPS
 *   （宿主按它给链快照排序，见 src/refresh/rooms/host/check-chain-evaluation.ts；本文件与检查页一样只读它，不自己再排一份）。
 * 界面只分发、后端只声明：动作词表见 src/client/kernel/actions.ts，清单里的 missing 只说用哪一种。
 * 以后谁改它：改「状态栏什么时候出哪条横幅、那颗按钮点下去干什么」的人。预估约 190 行，超 350 打回。
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
// 引导链一族（#663）：步骤清单、动作分发、文案、后端门控，由共享层与 kernel 提供。
declare function chainEventRefresh(...args: any[]): any;
declare function chainStep(...args: any[]): any;
declare function chainSteps(...args: any[]): any;
declare function checkShowTitle(...args: any[]): any;
declare function createActionDispatcher(...args: any[]): any;
declare function currentBackendId(...args: any[]): any;
declare function emit(...args: any[]): any;
declare function flash(...args: any[]): any;
declare function dswsLogHash(...args: any[]): any;
declare const wsKeyOf: any;
declare function guideBannerOf(...args: any[]): any;
declare function guideMissingOf(...args: any[]): any;
declare function guideStepDone(...args: any[]): any;
declare function guideStepsFor(...args: any[]): any;
declare function inject(...args: any[]): any;
declare function installSkillsParams(...args: any[]): any;
declare function loadChain(...args: any[]): any;
declare function loadSnapshot(...args: any[]): any;
declare function moduleMetaOf(...args: any[]): any;
declare function onStatusSetupInit(...args: any[]): any;
declare function openFormModal(...args: any[]): any;
declare function openStatusGate(...args: any[]): any;
declare function openUrl(...args: any[]): any;
declare function promptText(...args: any[]): any;
declare function promptTextFor(...args: any[]): any;
declare function refreshAll(...args: any[]): any;
declare function userHintOf(...args: any[]): any;


// 当前后端：与内核那份同口径（会话 → 快照 → 按工作区缓存）。闭包里已有 currentBackendId 就直接用它。
const backendIdOf = function (st: any) {
  try { if (typeof currentBackendId === 'function') return currentBackendId(st) } catch (e) {}
  try { if (st && st.selection && st.selection.backendId != null) return st.selection.backendId } catch (e2) {}
  return null
}

// 链快照里的步骤（界面这一侧唯一的读数来源；链是宿主发的，界面不自己算状态）。
const chainStepsOf = function (st: any) {
  try { if (typeof chainSteps === 'function') return chainSteps(st) } catch (e) {}
  try { return (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : [] } catch (e2) { return [] }
}

// 链上某一步（按检查项 id 取）。
const chainStepOf = function (st: any, id: any) {
  try { if (typeof chainStep === 'function') return chainStep(st, id) } catch (e) {}
  const list = chainStepsOf(st)
  for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(id)) return list[i] }
  return null
}

// 这个后端的那份清单。后端还没定下来时（全新工作区的第一步）拿 GitHub 那份兜底 ——
//   清单第 1 步「已选择后端」三个后端都有，取它只为把蓝条那一档判出来。
const guideListOf = function (st: any) {
  if (typeof guideStepsFor !== 'function') return []
  const mine = guideStepsFor(backendIdOf(st))
  if (mine && mine.length) return mine
  return guideStepsFor('github')
}

// 这一步在链快照里有没有落脚（清单上的步骤都是检查目录里的项，正常都会在；链快照还没到时一个都没有）。
// 为什么要它：链快照常常晚于界面到达 —— 没到的时候不能把「还没查到」当成「没过」，否则全新工作区
//   一见面就闪一条黄条（BUG2 那类毛病）。宿主算「第一个没过的下标」也是只在快照里有的那几步里数，
//   两处同一个口径：快照里还没有的那一步，先当作还没轮到。
const stepPresent = function (st: any, step: any) {
  const ids = (step && Array.isArray(step.checks)) ? step.checks : []
  for (let i = 0; i < ids.length; i++) { if (chainStepOf(st, ids[i])) return true }
  return false
}

// #1363 场景一：挡着初始化的那一步（清单里 blocksSetup 的「已关联仓库」）在链快照里没有落脚时，
//   显示层从前什么都不出（guideBannerStep 直接 return null）。于是真机上「选完后端、状态栏一条提示都没有、
//   右侧面板还写着未识别仓库」，人不知道下一步该做什么，也分不清「还没查到」与「确实没有」。
//   这里给显示层一条诚实的兜底：快照里已经有别的行、偏偏缺这条挡路的行时，出一条中性提示
//   「环境状态没取到，点此重新检查」——按钮复用既有的 recheck 那一路（人亲手点的那一次永不降档）。
//   为什么不是条常驻刷新按钮：每条横幅各长一颗刷新按钮会跟主按钮抢注意力，而这条只在「缺数据」时出现。
//   这一条不是清单里的一步，不登记进 GUIDE_STEPS（那里仍是单一真源，门禁 verify-668 会量）；
//   id 用 chain:unread，运行日志里一眼能认出它不是任何后端声明的步骤。
const CHAIN_UNREAD_STEP: any = Object.freeze({
  id: 'chain:unread',
  checks: [],
  banner: Object.freeze({ text: 'banner.chainUnread', btn: 'banner.chainUnreadBtn', tone: 'warn' }),
  missing: Object.freeze({ type: 'recheck' }),
});

/**
 * 今天该出的那一条横幅的判定结果：比 guideBannerStep 多带一个「为什么是这一条（或为什么一条都没有）」的代号。
 * 代号只给日志用（StatusBar 的 guide.banner 那一行）：排查「该出的没出」时，光看 step 为空分不清是快照没到、
 *   缺挡路那一步的行、还是已经全绿。
 * @returns {{step: Object|null, reason: string, stepId: string}} step 为横幅那一步（冻结对象），stepId 是判定停在哪一步（缺行时就是缺的那一步）
 */
export const guideBannerDecision = function (st: any, gateOpen: any) {
  try {
    const list = guideListOf(st)
    const steps = chainStepsOf(st)
    for (let i = 0; i < list.length; i++) {
      const step = list[i]
      const sid = String((step && step.id) || '')
      // 挡着初始化的那一步还没在链快照里露出行来：到此为止。快照里一行都没有 = 读数还没到，先安静等着（#661 第④条）；
      //   快照里已有别的行、偏偏缺这一行 = 读到了但这条没组装出来（#1363 场景一），出一行中性提示，不再静默。
      if (step && step.blocksSetup === true && !stepPresent(st, step)) {
        if (!steps.length) return { step: null, reason: 'waiting-snapshot', stepId: sid }
        return { step: CHAIN_UNREAD_STEP, reason: 'missing-blocks-setup', stepId: sid }
      }
      if (!step || !step.banner) continue
      if (step.ready === 'gate') {
        if (gateOpen) return { step: step, reason: 'gate-open', stepId: sid }
        continue
      }
      if (!stepPresent(st, step)) continue
      if (!guideStepDone(step, steps)) return { step: step, reason: 'step-not-done', stepId: sid }
    }
    if (!steps.length) return { step: null, reason: 'waiting-snapshot', stepId: '' }
    return { step: null, reason: 'all-done', stepId: '' }
  } catch (e) { return { step: null, reason: 'error', stepId: '' } }
}

/**
 * 今天该出的那一条横幅是哪一步：按清单顺序逐个看，第一个没过、且带横幅的那一步就是它。
 * 「没过」的口径与宿主算「第一个没过的下标」那处一致（那几项检查全 done 才算过，读链快照）；
 *   唯一例外是清单里 ready 为 'gate' 的那一步 —— 它读界面自己的门控状态（gateOpen），不读链快照
 *   （链快照常比后端选择先到，照快照判会让全新工作区闪一下黄条再跳回蓝条）。
 * 判定与原因代号都在 guideBannerDecision 里，这里只把那一步交出去（兼容既有的调用方）。
 * @param {Object} st 会话状态（读链快照与当前后端）
 * @param {boolean} gateOpen 门控还开着（后端没选定或还在探测；由界面传入）
 * @returns {Object|null} 清单里的一步（冻结对象）；没有该出的横幅时返回 null
 */
export const guideBannerStep = function (st: any, gateOpen: any) {
  return guideBannerDecision(st, gateOpen).step
}

/**
 * 状态栏那一行 guide.banner 需要的判据与标识一次算齐（#1363）：判定结论、判定停在哪一步、当时选定的后端、
 *   链快照里实际有几行、工作区与会话的短哈希，以及上一条横幅的文案与边沿触发用的 key。
 * 为什么单独收一处：状态栏那个文件有 350 有效行上限（verify-file-granularity），判定与散列的细节放在这里，
 *   那边只拿结果、只负责写日志；两处读的判定又是同一份 guideBannerDecision，不会各算一套。
 * @returns {{step: Object|null, reason: string, stepId: string, backendId: string, steps: number, wsHash: string, sidHash: string, meta: Object|null, key: string}}
 */
export const guideBannerDiagnosis = function (st: any, gateOpen: any) {
  const d: any = guideBannerDecision(st, gateOpen)
  const step = d.step
  let meta: any = null
  try { if (step) meta = (typeof guideBannerMeta === 'function') ? guideBannerMeta(st, step) : (step.banner || null) } catch (eM) {}
  let wsHash = ''
  let sidHash = ''
  try { wsHash = dswsLogHash(String((typeof wsKeyOf === 'function' ? wsKeyOf((st && st.cwd) || '') : (st && st.cwd)) || '')) } catch (eH1) {}
  try { sidHash = dswsLogHash(String((st && st.sessionId) || '')) } catch (eH2) {}
  return {
    step: step, reason: d.reason, stepId: d.stepId,
    backendId: String((st && st.selection && st.selection.backendId) || ''),
    steps: chainStepsOf(st).length, wsHash: wsHash, sidHash: sidHash, meta: meta,
    key: step ? (String((step && step.id) || '') + '|' + String((meta && meta.text) || '')) : ('cleared|' + String(d.reason || '')),
  }
}

/**
 * 横幅正文的占位符取值。只有「一条横幅管多项检查」的那一步要它（技能那一步的正文里有 {list}）：
 * 取这几项里最差的那一项的标题，与今天这条横幅的取法一字不差。
 * @returns {Object|null} 例如 { list: '技能 wayfinder 未安装' }
 */
export const guideBannerParams = function (st: any, step: any) {
  try {
    const ids = (step && Array.isArray(step.checks)) ? step.checks : []
    if (ids.length < 2) return null
    const rank: any = { done: 0, current: 1, fail: 2, pending: 3 }
    let worst = null
    for (let i = 0; i < ids.length; i++) {
      const it = chainStepOf(st, ids[i])
      if (!it) continue
      if (!worst) { worst = it; continue }
      if ((rank[String(it.status || '')] || 0) > (rank[String(worst.status || '')] || 0)) worst = it
    }
    if (!worst) return { list: '' }
    const title = (typeof checkShowTitle === 'function') ? checkShowTitle(worst.show, '') : ''
    const desc = (worst.show && worst.show.desc) ? String(worst.show.desc) : ''
    return { list: title || desc }
  } catch (e) { return null }
}

/**
 * 按当前后端解析一段要注入的文案：先取这个后端自己声明的那一份（今天状态栏那条登录按钮就是这个口径），
 * 后端没声明时才落回提示词表。技能那一条要现算技能清单，所以单独走带占位符的那条路。
 */
const promptFor = function (st: any, key: any) {
  if (!key) return ''
  if (key === 'installSkills' && typeof installSkillsParams === 'function' && typeof promptText === 'function') {
    try { return promptText('installSkills', installSkillsParams()) } catch (eI) {}
  }
  try {
    const bid = backendIdOf(st)
    const meta = (typeof moduleMetaOf === 'function' && bid != null) ? moduleMetaOf(st, bid) : null
    const declared = meta && meta.prompts && meta.prompts[key]
    if (declared) {
      // #1294：后端声明的 {zh,en} 交给按语言链取词（不再「是不是 en」二选一），
      //   链上缺这一门时 pickLangText 会自动落到下一门（今天 en 活动的链是 ['en','zh']）。
      const text = (typeof pickLangText === 'function') ? pickLangText(declared) : (declared.zh || '')
      if (text) return String(text)
    }
  } catch (eD) {}
  try { return (typeof promptTextFor === 'function') ? promptTextFor(st, key) : '' } catch (e) { return '' }
}

// 初始化那一步的按钮：走既有的那条决定函数（StatusBackend.js 的 onStatusSetupInit，布局没答过时它只开小卡、
//   一个字都不注入）。本文件不自己弹卡、也不自己注入，只把它给的结果翻成日志要的那一类。
const setupInit = function (st: any) {
  try { if (typeof onStatusSetupInit === 'function') return onStatusSetupInit(st) } catch (e) {}
  return ''
}

// 用当前后端为这一步声明的修复动作（今天那个两步建仓弹窗挂在「已关联仓库」这一项的 actions[0] 上）。
//   清单里只写「用后端的修复动作」，弹窗载荷仍住在后端声明里，界面不抄第二份；
//   取法与检查页那颗主按钮一致：有弹窗类动作（form / wizard）先用它。
const firstFixesActionOf = function (st: any, stepId: any) {
  try {
    const it = chainStepOf(st, stepId)
    const actions = (it && Array.isArray(it.actions)) ? it.actions : []
    for (let i = 0; i < actions.length; i++) { const a = actions[i]; if (a && (a.type === 'form' || a.type === 'wizard')) return a }
    for (let i = 0; i < actions.length; i++) { const a = actions[i]; if (a && (a.type === 'inject-prompt' || a.type === 'rpc')) return a }
  } catch (e) {}
  return null
}

// 把后端声明的动作交给动作分发器跑（UI 只分发、后端只声明；与检查页那条路同形）。
const runAction = function (st: any, action: any) {
  try {
    if (typeof createActionDispatcher !== 'function') return
    const dispatcher = createActionDispatcher({
      inject: function (text: any) { try { inject(st, text) } catch (e) {} },
      openUrl: function (url: any) { try { openUrl(url) } catch (e) {} },
      hostCall: function (method: any, params: any) {
        if (typeof host !== 'undefined' && host && host.call) return host.call(method, params)
        return Promise.reject(new Error('hostCall unavailable'))
      },
      renderForm: function (payload: any, onSubmit: any) {
        try { if (typeof openFormModal === 'function') openFormModal(st, payload, onSubmit) } catch (e) {}
      },
      refresh: async function () {
        try {
          // #669 第 6 件（ADR 20260921）：hint 只报「用户亲手选过的那条」（派生值不许冒充意图）
          if (typeof host !== 'undefined' && host && host.call) await host.call('wf.detect', { cwd: st.cwd || '', force: true, backendId: (typeof userHintOf === 'function' ? userHintOf(st.selection) : undefined) || undefined })
        } catch (e) {}
        // #1363：这一下是后端声明的动作跑完之后的重取（人动手点出来的），带 'user-recheck' 才不会被退避挡回旧快照。
        try { if (typeof loadChain === 'function') loadChain(st, true, 'user-recheck') } catch (e2) {}
        try { if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true) } catch (e3) {}
      },
      resolvePrompt: function (id: any) { return promptFor(st, id) },
    })
    const running = dispatcher.dispatch(action)
    if (running && typeof running.catch === 'function') {
      running.catch(function (e: any) {
        try { if (typeof flash === 'function') flash(st, String((e && e.message) || e).slice(0, 200), 'warn') } catch (e2) {}
      })
    }
  } catch (e) {}
}

/**
 * 今天该出的那一条横幅的文案（哪一句、哪颗按钮、什么颜色）：默认就是清单里配的那条；
 * 只有登录那一步在查不到时换成中性那一条（#916）。选哪一步仍由 guideBannerStep 定。
 */
export const guideBannerMeta = function (st: any, step: any) {
  try {
    if (typeof guideBannerOf === 'function') {
      const meta = guideBannerOf(step, chainStepsOf(st))
      if (meta) return meta
    }
  } catch (e) {}
  return (step && step.banner) || {}
}

// 人亲手点出来的那一次重查（#916 的中性条与 #1438 的第二颗按钮共用；写法与检查页那颗「重新检查」同形）。
// 两条不变量：① 退避窗口里也照跑 —— 必须带 'user-recheck' 上报（见 chain-backoff），否则宿主会按后台档退避、
//   用缓存的旧快照直接回包，人点了等于没点；② 链与快照各重取一次 —— 只重取链不重取快照，界面会停在旧读数上。
const recheckNow = function (st: any) {
  // 点下去立刻给转圈的依据（StatusBar 胶囊那颗刷新图标看 s.refreshing）：#1463 的主诉之一是「点了完全没反应」——
  //   从前这里三个后台请求全是静默的，失败吞掉、成功与否界面都不先吱一声。落定后一定收掉，不卡转圈。
  try { st.refreshing = true; emit(st); } catch (e) {}
  const settle = function () { try { st.refreshing = false; emit(st); } catch (eD) {} };
  // 三路只收「落定了」这个事实，值不重要：链与快照各自落盘与重渲染（adopt/emit 在它们自己里面），
  //   这里只负责把转圈收掉。全部包一层兜底，任何一路抛错都不把转圈卡住、不向调用方抛错
  //   （runGuideMissing 点完就要回 'action'，不能等网络）。
  const landed = function (p: any) { try { return (p && typeof p.then === 'function') ? p.then(function () { return null }, function () { return null }) : Promise.resolve(null) } catch (eP) { return Promise.resolve(null) } };
  let p1: any = null, p2: any = null, p3: any = null;
  try {
    if (typeof host !== 'undefined' && host && host.call) {
      // 与链那一路同令：handleDetect 今天不看退避，但本文件头上那条不变量说的是「重查必须带令牌」——
      //   以后它若也接退避，这一行缺令牌就会被人当后台档挡回旧快照。宿主多收一个字段直接忽略，不影响今天。
      const r = host.call('wf.detect', { cwd: st.cwd || '', force: true, backendId: (typeof userHintOf === 'function' ? userHintOf(st.selection) : undefined) || undefined, trigger: 'user-recheck' })
      if (r && typeof r.catch === 'function') {
        p1 = landed(r)
        // #724 同例：异常留一行再吞 —— 从前这里是空 catch，真机查「点了没反应」时日志里一笔都没有。
        r.catch(function () { try { log('warn', 'host.call.fail', { method: 'wf.detect', kind: 'user-recheck' }) } catch (eL) {} })
      }
    }
  } catch (e) {}
  try {
    if (typeof chainEventRefresh === 'function') { const r2 = chainEventRefresh(st, 'user-recheck'); p2 = landed(r2); if (r2 && typeof r2.catch === 'function') r2.catch(function () {}) }
    else if (typeof loadChain === 'function') { const r3 = loadChain(st, true, 'user-recheck'); p2 = landed(r3); if (r3 && typeof r3.catch === 'function') r3.catch(function () {}) }
  } catch (e2) {}
  try { if (typeof loadSnapshot === 'function') { const r4 = loadSnapshot(st, true, true); p3 = landed(r4); if (r4 && typeof r4.catch === 'function') r4.catch(function () {}) } } catch (e3) {}
  try {
    const all = (typeof Promise !== 'undefined' && Promise.all) ? Promise.all([p1, p2, p3]) : null
    if (all && typeof all.then === 'function') { all.then(settle, settle); return all }
  } catch (eA) {}
  try { settle(); } catch (eS) {}
  return null
}

/**
 * 横幅上那颗「重新检查」按钮点下去（#1438）：先走环境检查页那颗同一条路（refreshAll —— 它自己带 'user-recheck'
 *   上报、自己管「重取中」的界面态与取完后的面板刷新）；那条路不在时退回 recheckNow（链与快照各重取一次）。
 * 为什么不在本文件另起一套重取：那条路已经管着进度态与取完后的刷新，这里再造一份会出现两条进度各报各的。
 * 日志与 runGuideMissing 同一个落点（guide.inject / action）：排查时「点了有没有真的动」不靠猜。
 * @returns {'action'} 这条链只记「动了一次」这一类
 */
export const runGuideRecheck = function (st: any, stepId: any) {
  try {
    if (typeof refreshAll === 'function') refreshAll(st)
    else recheckNow(st)
  } catch (e) { try { recheckNow(st) } catch (e2) {} }
  logGuideInject(stepId ? String(stepId) : '', 'action')
  return 'action'
}

/**
 * 横幅那颗按钮点下去：照这一步的有效 missing 走（查不到那一路已换成重查，见上面）。
 * 去向：注入一段文案（text）/ 没有文案可注入（none）/ 弹窗类端点动作或强制重查（action）。
 * 无论哪一种都在这里落一行常驻日志，见下面 logGuideInject。
 * @returns {'text'|'none'|'action'} 这次给出去的是哪一类（同时写进日志）
 */
export const runGuideMissing = function (st: any, step: any) {
  const stepId = (step && step.id) ? String(step.id) : ''
  let missing = (step && step.missing) || null
  try {
    if (typeof guideMissingOf === 'function') {
      const eff = guideMissingOf(step, chainStepsOf(st))
      if (eff) missing = eff
    }
  } catch (e) {}
  if (!missing || !missing.type) { logGuideInject(stepId, 'none'); return 'none' }
  if (missing.type === 'recheck') {
    // 人亲手点的这一次永不降档（#916）：recheckNow 带 'user-recheck' 上报，退避窗口里也照跑。
    recheckNow(st)
    logGuideInject(stepId, 'action'); return 'action'
  }
  if (missing.type === 'open-backend-picker') {
    try { if (typeof openStatusGate === 'function') openStatusGate(st) } catch (e) {}
    logGuideInject(stepId, 'action'); return 'action'
  }
  if (missing.type === 'fixes-action') {
    const action = firstFixesActionOf(st, stepId)
    if (!action) { logGuideInject(stepId, 'none'); return 'none' }
    runAction(st, action)
    logGuideInject(stepId, 'action'); return 'action'
  }
  if (missing.prompt === 'setupRun') {
    const kind = setupInit(st)
    // 'setup' = 真注入了全文；'askLayout' = 只开了那张小卡（#698 起这个名字替代 'setup-card'）；'blocked'（仓库那一步还没过）与空值 = 一个字都没给出去。
    const out = (kind === 'askLayout') ? 'action' : (kind === 'setup' ? 'text' : 'none')
    logGuideInject(stepId, out); return out
  }
  const text = missing.text ? String(missing.text) : promptFor(st, missing.prompt)
  if (!text) { logGuideInject(stepId, 'none'); return 'none' }
  try { inject(st, text) } catch (e) {}
  logGuideInject(stepId, 'text'); return 'text'
}

/**
 * 横幅那颗按钮给出去的是什么 —— 这条链唯一的日志落点（#663；维护者 2026-09-19 拍板记常驻）。
 * 为什么常驻：这条链上一次的毛病就是「点一下给错了东西，日志里一笔都没有」，所以默认落盘、不等人先开调试开关。
 * 字段只有两个短枚举：哪一步（步骤 id）与给出去的是哪一类（text 注入了一段文案 / none 没有文案可注入 /
 *   action 交给弹窗那类端点动作）；不记注入的正文，也不记任何路径。
 */
const logGuideInject = function (stepId: any, outcome: any) {
  try { log('info', 'guide.inject', { step: String(stepId || ''), outcome: String(outcome || '') }) } catch (e) {}
}
