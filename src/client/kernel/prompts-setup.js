/**
 * kernel/prompts-setup.js — 「初始化那段文案该不该注入、先问还是先给」的决策（#698 由 prompts.js 拆出）。
 *
 * 为什么拆：这段决策在 #698 之后长到了 55 行，prompts.js 被顶到 373 行、超了 350 行上限
 *   （门禁 tests/verify-file-granularity.js 是零增长基线，不许留超标文件）。它与「提示词模板表」
 *   本来就是两件事：prompts.js 管模板文本，本文件管「什么时候把哪一段给出去」。
 *
 * 这一份判据是整个注入路径的唯一入口，四个出口都汇聚在它上面：
 *   状态栏黄条那颗「初始化」按钮、检查页红牌那颗「执行初始化」按钮、面板「切换后端」那条路，
 *   以及建仓向导成功后的补发。谁都不要自己再判一遍「该不该问」「该不该注入」。
 *
 * 契约：内核模块（scripts/build.mjs 的 KERNEL_MODULES 登记，marker kernel:promptsSetup 拼回
 *   src/client/index.js 的 apply 闭包内原位）；同闭包内直调 readSetupLayout / setupOrRepoPrompt /
 *   setupBlockedByGuide / setupRunPrompt / emit / inject / log 等，不 import 任何东西。
 * 以后谁改它：改「初始化这条路上什么条件下开那张布局小卡、什么条件下注入全文」的人。
 */
export const layoutCardShouldOpen = function (st, opts) {
  // 传了 askLayout（黄条那颗按钮 / 切换后端那条路）→ 问，布局答过也照旧问（卡上预选着上次那一项）；
  //   没传（检查页那颗「执行初始化」按钮）→ 只在还没答过时问。
  try { return !!(opts && opts.askLayout === true) || !readSetupLayout(st) } catch (e) { return true }
}
export const injectSetupDecision = function (st, backendId, opts) {
  let guideBlocked = false
  try { guideBlocked = setupBlockedByGuide(st, backendId) } catch (eB) { guideBlocked = false }
  // source:'switch' 只在「切换后端」那条路上传。两条路开的是同一张卡（界面上是一模一样的一问），
  //   分开的只是「谁在等这一问的答案」：黄条那条答完就注入初始化全文；切换那条要先判
  //   「这个工作区**现在**初始化了没有」（开卡到点确认之间，刚注入的对齐指令可能已经把仓库初始化完了），
  //   再决定注全文还是注对齐。所以这一档单独给一个返回值，调用处用它把「答完归谁办」记进会话状态。
  const cardKind = (opts && opts.source === 'switch') ? 'setup-card-switch' : 'setup-card'
  // 顺序上「仓库那一步没过」先判（返回 blocked）：这一步没过时连卡都不开 —— 那一步没过时按顺序
  //   还轮不到「该工作区尚未初始化」，此刻先弹卡会让用户选完布局才发现什么都没注入
  //   （#655 修过的同一类毛病）。
  if (!guideBlocked && opts && opts.allowCard === true && layoutCardShouldOpen(st, opts)) {
    try { st.setupLayoutCardOpen = true } catch (e) {}
    try { if (opts && opts.source === 'switch') st.setupCardOwner = 'switch'; else delete st.setupCardOwner } catch (eOw) {}
    try { if (typeof emit === 'function') emit(st) } catch (e) {}
    // 按需日志（#655，附录 1.5 的 #64 inject.decision）：这一步是用户点击触发的、一次一条，
    //   只记三个枚举（哪段文案 / 决定了哪一种 / 按哪种布局），不记仓库、路径与文案原文；
    //   调试开关关着时只读一次开关就返回，不组装字段对象（按需埋点的守卫纪律）。
    try { if (isEnabled('debug')) log('debug', 'inject.decision', { prompt: 'setupRun', kind: cardKind, layout: 'unset' }) } catch (eL) {}
    return cardKind
  }
  let dec = null
  try { dec = (typeof setupOrRepoPrompt === 'function') ? setupOrRepoPrompt(st, backendId) : null } catch (e) { dec = null }
  if (!dec) { try { const lay = readSetupLayout(st) || SETUP_LAYOUT_DEFAULT; dec = { kind: 'setup', text: ((typeof setupRunPrompt === 'function') ? setupRunPrompt(st, backendId, lay) : ''), layout: lay } } catch (e) { dec = { kind: 'setup', text: '', layout: SETUP_LAYOUT_DEFAULT } } }
  const kind = (dec && dec.kind) || 'setup'
  const usedLayout = (dec && dec.layout) || SETUP_LAYOUT_DEFAULT
  try { st.setupLayoutCardOpen = false } catch (e) {}
  // #664：「建仓成功后补发一次」那对标记（pendingSetupAfterPublish / pendingSetupCwd）原本只有缺仓那一档
  //   （kind === 'repo'）会置真，那一档已按新流程退役，所以这里不再置真 —— 两个字段照留，是因为它们的
  //   消费方（旧建仓卡 NoRepoCard 与建仓向导成功那两处）本票不碰（#662 的「不做什么」点名不动 NoRepoCard）。
  //   要不要连这套补发机制一起退役，属另一次清理，已记在 #664 的落地记录里。
  try { st.pendingSetupAfterPublish = false; st.pendingSetupCwd = '' } catch (e) {}
  try { console.log('[MattSkillsDeck] setup-inject applied kind=' + kind) } catch (e) {}
  try { if (isEnabled('debug')) log('debug', 'inject.decision', { prompt: 'setupRun', kind: kind, layout: String(usedLayout) }) } catch (eL) {}
  if (dec && dec.text && !(opts && opts.injectNow === false)) { try { inject(st, dec.text) } catch (e) {} }
  return kind
}
