/**
 * statusbar/bannerChain.js — 状态栏那条横幅：按首开引导链的步骤清单决定今天出哪一条，以及那条的按钮点了做什么（#663）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
 * 里那条 leaf:bannerChain 拼接标记处（一源两物，标记 id 与本文件名一致）。
 * 顺序与「这一步没过时给什么」只有一份真源：src/shared/tracker/guide-steps.js 的 GUIDE_STEPS
 *   （宿主按它给链快照排序，见 src/host/detectChain.js；本文件与检查页一样只读它，不自己再排一份）。
 * 界面只分发、后端只声明：动作词表见 src/client/kernel/actions.js，清单里的 missing 只说用哪一种。
 * 以后谁改它：改「状态栏什么时候出哪条横幅、那颗按钮点下去干什么」的人。预估约 190 行，超 350 打回。
 */

// 当前后端：与内核那份同口径（会话 → 快照 → 按工作区缓存）。闭包里已有 currentBackendId 就直接用它。
const backendIdOf = function (st) {
  try { if (typeof currentBackendId === 'function') return currentBackendId(st) } catch (e) {}
  try { if (st && st.selection && st.selection.backendId != null) return st.selection.backendId } catch (e2) {}
  return null
}

// 链快照里的步骤（界面这一侧唯一的读数来源；链是宿主发的，界面不自己算状态）。
const chainStepsOf = function (st) {
  try { if (typeof chainSteps === 'function') return chainSteps(st) } catch (e) {}
  try { return (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : [] } catch (e2) { return [] }
}

// 链上某一步（按检查项 id 取）。
const chainStepOf = function (st, id) {
  try { if (typeof chainStep === 'function') return chainStep(st, id) } catch (e) {}
  const list = chainStepsOf(st)
  for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(id)) return list[i] }
  return null
}

// 这个后端的那份清单。后端还没定下来时（全新工作区的第一步）拿 GitHub 那份兜底 ——
//   清单第 1 步「已选择后端」三个后端都有，取它只为把蓝条那一档判出来。
const guideListOf = function (st) {
  if (typeof guideStepsFor !== 'function') return []
  const mine = guideStepsFor(backendIdOf(st))
  if (mine && mine.length) return mine
  return guideStepsFor('github')
}

// 这一步在链快照里有没有落脚（清单上的步骤都是检查目录里的项，正常都会在；链快照还没到时一个都没有）。
// 为什么要它：链快照常常晚于界面到达 —— 没到的时候不能把「还没查到」当成「没过」，否则全新工作区
//   一见面就闪一条黄条（BUG2 那类毛病）。宿主算「第一个没过的下标」也是只在快照里有的那几步里数，
//   两处同一个口径：快照里还没有的那一步，先当作还没轮到。
const stepPresent = function (st, step) {
  const ids = (step && Array.isArray(step.checks)) ? step.checks : []
  for (let i = 0; i < ids.length; i++) { if (chainStepOf(st, ids[i])) return true }
  return false
}

/**
 * 今天该出的那一条横幅是哪一步：按清单顺序逐个看，第一个没过、且带横幅的那一步就是它。
 * 「没过」的口径与宿主算「第一个没过的下标」那处一致（那几项检查全 done 才算过，读链快照）；
 *   唯一例外是清单里 ready 为 'gate' 的那一步 —— 它读界面自己的门控状态（gateOpen），不读链快照
 *   （链快照常比后端选择先到，照快照判会让全新工作区闪一下黄条再跳回蓝条）。
 * @param {Object} st 会话状态（读链快照与当前后端）
 * @param {boolean} gateOpen 门控还开着（后端没选定或还在探测；由界面传入）
 * @returns {Object|null} 清单里的一步（冻结对象）；没有该出的横幅时返回 null
 */
export const guideBannerStep = function (st, gateOpen) {
  try {
    const list = guideListOf(st)
    const steps = chainStepsOf(st)
    for (let i = 0; i < list.length; i++) {
      const step = list[i]
      // 挡着初始化的那一步（清单里标着 blocksSetup 的「已关联 GitHub 仓库」）还没在链快照里露出行来：
      //   到此为止，不许再往前走到黄条。理由是「行不在快照里」与「这一步这个后端用不上」（本地 Markdown
      //   没有仓库那一步）是两件事，分不清时必须停下来等读数 —— 往前跳一步会把「该工作区尚未初始化」黄条
      //   提前给出去（#661 第④条要的就是它不早出）。真机现场 2026-09-21：全新空目录里，探测把「空目录」
      //   当成过期工作区、把用户刚选的后端也一并作废，后端链整段没组装，快照里连仓库那一行都没有，
      //   黄条就是这样提前出来的。这一步的行在快照里时，下面那套通用逻辑照常判它过没过。
      if (step && step.blocksSetup === true && !stepPresent(st, step)) return null
      if (!step || !step.banner) continue
      if (step.ready === 'gate') { if (gateOpen) return step; continue }
      if (!stepPresent(st, step)) continue
      if (!guideStepDone(step, steps)) return step
    }
    return null
  } catch (e) { return null }
}

/**
 * 横幅正文的占位符取值。只有「一条横幅管多项检查」的那一步要它（技能那一步的正文里有 {list}）：
 * 取这几项里最差的那一项的标题，与今天这条横幅的取法一字不差。
 * @returns {Object|null} 例如 { list: '技能 wayfinder 未安装' }
 */
export const guideBannerParams = function (st, step) {
  try {
    const ids = (step && Array.isArray(step.checks)) ? step.checks : []
    if (ids.length < 2) return null
    const rank = { done: 0, current: 1, fail: 2, pending: 3 }
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
const promptFor = function (st, key) {
  if (!key) return ''
  if (key === 'installSkills' && typeof installSkillsParams === 'function' && typeof promptText === 'function') {
    try { return promptText('installSkills', installSkillsParams()) } catch (eI) {}
  }
  try {
    const bid = backendIdOf(st)
    const meta = (typeof moduleMetaOf === 'function' && bid != null) ? moduleMetaOf(st, bid) : null
    const declared = meta && meta.prompts && meta.prompts[key]
    if (declared) {
      const lang = (typeof promptLang === 'function') ? promptLang() : 'zh'
      const text = (lang === 'en' && declared.en) ? declared.en : (declared.zh || '')
      if (text) return String(text)
    }
  } catch (eD) {}
  try { return (typeof promptTextFor === 'function') ? promptTextFor(st, key) : '' } catch (e) { return '' }
}

// 初始化那一步的按钮：走既有的那条决定函数（StatusBackend.js 的 onStatusSetupInit，布局没答过时它只开小卡、
//   一个字都不注入）。本文件不自己弹卡、也不自己注入，只把它给的结果翻成日志要的那一类。
const setupInit = function (st) {
  try { if (typeof onStatusSetupInit === 'function') return onStatusSetupInit(st) } catch (e) {}
  return ''
}

// 用当前后端为这一步声明的修复动作（今天那个两步建仓弹窗挂在「已关联仓库」这一项的 actions[0] 上）。
//   清单里只写「用后端的修复动作」，弹窗载荷仍住在后端声明里，界面不抄第二份；
//   取法与检查页那颗主按钮一致：有弹窗类动作（form / wizard）先用它。
const firstFixesActionOf = function (st, stepId) {
  try {
    const it = chainStepOf(st, stepId)
    const actions = (it && Array.isArray(it.actions)) ? it.actions : []
    for (let i = 0; i < actions.length; i++) { const a = actions[i]; if (a && (a.type === 'form' || a.type === 'wizard')) return a }
    for (let i = 0; i < actions.length; i++) { const a = actions[i]; if (a && (a.type === 'inject-prompt' || a.type === 'rpc')) return a }
  } catch (e) {}
  return null
}

// 把后端声明的动作交给动作分发器跑（UI 只分发、后端只声明；与检查页那条路同形）。
const runAction = function (st, action) {
  try {
    if (typeof createActionDispatcher !== 'function') return
    const dispatcher = createActionDispatcher({
      inject: function (text) { try { inject(st, text) } catch (e) {} },
      openUrl: function (url) { try { openUrl(url) } catch (e) {} },
      hostCall: function (method, params) {
        if (typeof host !== 'undefined' && host && host.call) return host.call(method, params)
        return Promise.reject(new Error('hostCall unavailable'))
      },
      renderForm: function (payload, onSubmit) {
        try { if (typeof openFormModal === 'function') openFormModal(st, payload, onSubmit) } catch (e) {}
      },
      refresh: async function () {
        try {
          if (typeof host !== 'undefined' && host && host.call) await host.call('wf.detect', { cwd: st.cwd || '', force: true, backendId: (st.selection && st.selection.backendId) || undefined })
        } catch (e) {}
        try { if (typeof loadChain === 'function') loadChain(st, true) } catch (e2) {}
        try { if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true) } catch (e3) {}
      },
      resolvePrompt: function (id) { return promptFor(st, id) },
    })
    const running = dispatcher.dispatch(action)
    if (running && typeof running.catch === 'function') {
      running.catch(function (e) {
        try { if (typeof flash === 'function') flash(st, String((e && e.message) || e).slice(0, 200), 'warn') } catch (e2) {}
      })
    }
  } catch (e) {}
}

/**
 * 横幅那颗按钮点下去：照这一步的 missing 走（清单只声明用哪一种）。
 * 三种去向：注入一段文案（text）/ 没有文案可注入（none）/ 交给弹窗那类端点动作（action：建仓弹窗、选后端窗、初始化小卡）。
 * 无论哪一种都在这里落一行常驻日志，见下面 logGuideInject。
 * @returns {'text'|'none'|'action'} 这次给出去的是哪一类（同时写进日志）
 */
export const runGuideMissing = function (st, step) {
  const stepId = (step && step.id) ? String(step.id) : ''
  const missing = (step && step.missing) || null
  if (!missing || !missing.type) { logGuideInject(stepId, 'none'); return 'none' }
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
    // 'setup' = 真注入了全文；'setup-card' = 只开了那张小卡；'blocked'（仓库那一步还没过）与空值 = 一个字都没给出去。
    const out = (kind === 'setup-card') ? 'action' : (kind === 'setup' ? 'text' : 'none')
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
const logGuideInject = function (stepId, outcome) {
  try { log('info', 'guide.inject', { step: String(stepId || ''), outcome: String(outcome || '') }) } catch (e) {}
}
