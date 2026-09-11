/**
 * views/shared/stateKind.js — 一条票在界面上该显示成什么状态（三种，判据单源）
 *
 * 为什么要有这个文件（#599）：GitHub 的拉取请求有三种状态（打开 / 已关闭 / 已合并），
 * 而契约层只认两态 —— 后端归一与单票详情都把「已合并」收成「已关闭」，把合并时间留在 mergedAt。
 * 于是「是不是已合并」只能由界面按合并时间判断，而拉取请求页与单票详情页两处都要判；
 * 判据写两遍就会各写各的，所以收在这一个文件里。
 *
 * 边界（#599 审查后收紧）：这里只认契约形状（state 是 open / closed，合并时间在 mergedAt）。
 * 谁把 GitHub 原生节点直接递给界面，谁就先把状态收成契约形状 —— 界面不认后端的私有字段
 * （契约见 docs/architecture/tracker-backend-design-contract.md 第 1、2 节：UI 不知道后端是谁）。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物）。本文件不新增跨边界调用、不新增缓存、
 * 不新增定时触发的活，所以没有新增日志点。
 */

/**
 * @param {Object} x 一张票（契约形状：state 为 open / closed，合并时间在 mergedAt）
 * @returns {'open'|'closed'|'merged'} 界面该显示的状态
 *
 * 判据顺序（第一性）：已合并也是「关闭」的一种，所以先看合并时间再看关闭状态 ——
 * 顺序反过来会把已合并的判成已关闭。
 */
export const prStateKind = function (x) {
  try {
    const raw = x && x.state != null ? String(x.state).trim().toLowerCase() : ''
    // 契约只有两态，但来源自己直接写「已合并」时也认（不同后端或旧缓存，不必强求它改写形状）
    if (raw === 'merged') return 'merged'
    if (x && x.mergedAt) return 'merged'
    if (raw === 'closed') return 'closed'
    return 'open'
  } catch (e) {
    return 'closed'
  }
}
