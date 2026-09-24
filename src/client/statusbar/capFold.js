// statusbar/capFold.js — 状态栏胶囊这条横条「随宽度一格一格变短」的阶梯（#725，维护者 2026-09-24 定）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。
//
// 维护者这一轮的真意（2026-09-24 晚，真机反馈后回改）：「有位置就显示，宽度不够时它第一个让位」。
//   这话是他上一轮那句原话「品牌字默认折叠；内容平铺在这一条里；变窄时字一个一个减少（先消失非核心的），
//   直到只剩图标」的完整读法。他又把「默认折叠」那半句说清了一次（原话）：
//   「默认收成折叠是出来的一瞬间是折叠的，但是因为空间足够所以一定能看到，除非宽度不够。」
//   于是这条横条上关于品牌那串字的三件事是：
//     ① **首帧的起始态**：胶囊第一次画出来、还没有过任何一次有效测量时，品牌那串字是**收起的**
//        （只留罗盘图标），其余各段照原样 —— 见 CAP_FOLD_START_FOLDED。它只是起始态，用来避免
//        「先展开、再收回去」那种跳一下；它不是「任何宽度都不显示」。
//     ② **量到可用宽之后照阶梯从第 0 档重走一遍**：够宽就把品牌那串字显示出来（第 0 档 = 九段全可见），
//        不够才按优先级往下收。所以宽面板上它**一定看得见**。
//     ③ **窄下去时它是第一个让位的**：一次少一个字，它收完了才轮到 2..9；收到极窄只剩图标与数字。
//   上一版把「默认折叠」照字面落成了「起手就折叠、任何宽度都不显示」（让位表里 pinned: true），
//   真机上那串字一个宽度都看不见、只剩一枚罗盘图标 —— 与上面的 ② 正好相反，所以回改成现在这样。
//   落到本文档上就是下面三条读法：
//
//   ① 品牌那一段（priority 1）照常参与让位，而且是第一个让位的：第 0 档它整串字都在，
//      往下第一段台阶就是它少一个字。那枚品牌图标不在本文件的台阶里（它不是「一串字」，谁也收不走它）。
//   ② 其余每一段的让位单位按 CAP_FOLD_POLICY 的 cut 定：'char' 一次少一个字
//      （按优先级从小到大一段一段来），'word' 一次少一整段词 —— 中文那几段本来就没有空格，
//      「一整段词」就是整段：一次收完，这正是「先消失非核心的」。两种单位都算「一个单位」，
//      所以相邻两档之间永远只差一个单位。
//   ③ 计数器与图标（数字那几枚、每一段的图标、最右那颗收起按钮）不是这条阶梯里的东西：
//      它们是载荷，不是「可让位的字」。所有词都收完之后本文件不再产生档位 ——
//      再窄也只剩图标与数字，那时候该由外层的 overflow 去处理，而不是把它们也撤掉。
//
// 本文件只有判据（纯函数，不画界面也不量宽度）：阶梯怎么排、第几档每一段画什么。
//   画（statusbar/StatusBar.js 的渲染）与量（同一处的阶梯机）都读下面这几个函数，两边不会各说各话。
//   判据的自动检查在 tests/verify-cap-fold.js：不开浏览器逐档核对「每步只少一个单位」「收到底不再撤」，
//   再在真 Chromium 里按宽度扫一遍，量「任何宽度都不溢出（或已经收到底）」「计数器数字从不消失」。
//   照真机几何（列的宽 → 宿主 dock → 插件 wrapper）量同一件事的门禁是 tests/verify-cap-fold-browser.js：
//   它盯的是「载荷（图标与数字）任何时候都不许撤」与「量不到有效可用宽的那一趟不许推进档位」。
//
// 这一份是「谁先让位、一次让多少」的唯一真源；它进不了界面的字面量，所以本文件里不许出现任何
//   待显示的文字（会显示的字都在 kernel/locale-*.js 的词条里，界面用 tr() 取）。
// priority 号码的含义与 kernel/styles.js 那条 data-fold-priority 注释、以及 StatusBar.js 里
//   九个 'data-fold-priority' 的挂点一一对应：1=品牌 2=沉淀 3=交接 4=更新 5=可接 6=BUG 7=诊断 8=环境 9=时间。
//
// 2..8 那七段用 'word'（这一段字整段一起让位，所以「先消失非核心的」是一次消失一整段）；
//   第 1 段（品牌）与第 9 段（时间串）用 'char'（一个字一个字地减少）。
// 品牌那段为什么去掉早先的 pinned: true（那一版是「起手就折叠、任何宽度都不显示」）：维护者的真意是
//   「有位置就显示、宽度不够时它第一个让位」—— pinned 会让它在最宽那一档也就是空的，等于这串字
//   任何宽度都看不见（2026-09-24 晚真机反馈：胶囊左边只剩一枚罗盘图标）。去掉之后它照常参与让位，
//   优先级 1 保证「第一个让位」，cut: 'char' 保证「一次只少一个字」。谁再想让某一段在任何宽度都不出现，
//   加 pinned 之前先想清楚这是不是真意（tests/verify-cap-fold.js 的 A1/A2/A12 三条就是拦这件事的）。
// 其余几段照旧没有 pinned。
export const CAP_FOLD_POLICY = {
  1: { cut: 'char' },
  2: { cut: 'word' },
  3: { cut: 'word' },
  4: { cut: 'word' },
  5: { cut: 'word' },
  6: { cut: 'word' },
  7: { cut: 'word' },
  8: { cut: 'word' },
  9: { cut: 'char' },
}
// 哪一号那一段在**还没量到可用宽的那一帧**是收起的（＝「默认折叠」）。
//
// 维护者 2026-09-24 晚把这句话说清了（原话）：「默认收成折叠是出来的一瞬间是折叠的，但是因为空间足够
//   所以一定能看到，除非宽度不够。」——也就是说「默认折叠」不是「任何宽度都不显示」（上一版按那样做，
//   结果真机上那串字一个宽度都看不见），它只是**首帧的起始态**，作用是别让胶囊先以展开的样子跳一下、
//   再收回去。只要量到了可用宽（哪怕很窄），这一档就让位给「照阶梯从第 0 档重走一遍」：
//   够宽就从第 0 档显示出来（品牌那串字看得见），不够才按优先级往下收，而品牌是第一个让位的。
// 这个常量与 CAP_FOLD_POLICY[1] 是两件事：一个是「首帧长什么样」，一个是「让位时谁先让、一次让多少」。
export const CAP_FOLD_START_FOLDED = ['1']
/**
 * 还没量到可用宽的那一帧，每一段画什么（号码串 → 那串字）。
 *   被 CAP_FOLD_START_FOLDED 点到的几段是空的（界面上连 .dsws-folded 一起加，display:none），其余照原样。
 * 这不是阶梯里的某一档：阶梯第 0 档是「九段全展开」，首帧是它在动之前的样子。
 */
export const capFoldStartWordsOf = function (items) {
  const out = {}
  const list = (Array.isArray(items) ? items : []).slice()
  list.sort(function (a, b) { return (Number(a && a.priority) || 99) - (Number(b && b.priority) || 99) })
  list.forEach(function (it) {
    const p = String(it && it.priority)
    if (CAP_FOLD_START_FOLDED.indexOf(p) >= 0) { out[p] = ''; return }
    out[p] = String((it && it.word) === undefined || (it && it.word) === null ? '' : it.word)
  })
  return out
}
/**
 * 首帧要加 .dsws-folded 的那几段号码（现在只有品牌那一段 = 优先级 1）。
 * 界面与机器都读它，免得两边各写一份「哪一段默认折叠」。
 */
export const capFoldStartFoldedOf = function () {
  return CAP_FOLD_START_FOLDED.slice()
}
// 少掉一个单位之后这一串字剩什么：'char' 去掉末尾一个字；'word' 去掉末尾一整段词
//   （没有空格可分的时候，整段就是一段词，于是直接变成空串）。
const capCutOnce = function (text, cut) {
  const s = String(text === undefined || text === null ? '' : text)
  if (s === '') return ''
  if (cut !== 'word') return s.slice(0, -1)
  const parts = s.split(/\s+/)
  if (parts.length <= 1) return ''
  parts.pop()
  return parts.join(' ')
}
/**
 * 排一条阶梯。data = { items: [{ priority, word }] }：priority 就是那枚元素的 data-fold-priority 号码
 *   （小号先让位），word 是它现在挂着的那一串字（界面上渲染出来的完整那串，不是收短过的）。
 * 返回 { steps, ids }：
 *   · ids  = 参与这条阶梯的号码串（按让位次序）；
 *   · steps[0] 是第 0 档（最宽那一档）—— 每一段画的都是完整的那串字（品牌那串在这里就看得见）；
 *     之后每一档都是把上一档里「下一个该让位的单位」再去掉一个，所以相邻两档之间恰好差一个单位，
 *     而第一个让位的就是优先级最小的那一段（今天就是品牌：第一段台阶 = 它少一个字）。
 *   所有词都空之后就停：后面不再有档位。
 */
export const capFoldLadderOf = function (data) {
  const d = data || {}
  const items = (Array.isArray(d.items) ? d.items : []).slice()
  items.sort(function (a, b) { return (Number(a && a.priority) || 99) - (Number(b && b.priority) || 99) })
  const ids = items.map(function (it) { return String(it && it.priority) })
  // 每一段此刻画什么（下面一边排档位一边改这个表，每档存一份快照）。
  //   走到这里每一段都是**完整的**那串字：这几段里今天没有任何一段是「任何宽度都不显示」的
  //   （pinned 这个开关留着不删，是因为它表达的是「这段字不参与让位」，将来真要再冒出这样一段时
  //   还照老规矩读它；但它今天在 CAP_FOLD_POLICY 里一个都没有 —— 品牌那段 2026-09-24 晚已去掉）。
  const cur = {}
  items.forEach(function (it) {
    const p = String(it && it.priority)
    const pol = CAP_FOLD_POLICY[p] || { cut: 'word' }
    cur[p] = (pol.pinned === true) ? '' : String((it && it.word) === undefined || (it && it.word) === null ? '' : it.word)
  })
  const steps = [Object.assign({}, cur)]
  items.forEach(function (it) {
    const p = String(it && it.priority)
    const pol = CAP_FOLD_POLICY[p] || { cut: 'word' }
    while (cur[p] !== '') {
      cur[p] = capCutOnce(cur[p], pol.cut)
      steps.push(Object.assign({}, cur))
    }
  })
  return { steps: steps, ids: ids }
}
/** 这条阶梯一共几档（第 0 档也算一档）。 */
export const capFoldStepCount = function (ladder) {
  const steps = (ladder && Array.isArray(ladder.steps)) ? ladder.steps : []
  return steps.length
}
/**
 * 第 tier 档每一段画什么：返回 { tier, ids, words }，words 的键是号码串（'1'…'9'）。
 * 超界的档号停在最后一档（负号停在最宽的第 0 档）—— 收到底之后再窄也没有下一档，
 *   界面照最后一档画，不会因为档号算大了就把计数器或图标也撤掉。
 */
export const capFoldStateAt = function (ladder, tier) {
  const steps = (ladder && Array.isArray(ladder.steps)) ? ladder.steps : []
  if (!steps.length) return { tier: 0, ids: [], words: {} }
  const n = Math.max(0, Math.min(Math.floor(Number(tier) || 0), steps.length - 1))
  return { tier: n, ids: (ladder.ids || []).slice(), words: Object.assign({}, steps[n]) }
}
