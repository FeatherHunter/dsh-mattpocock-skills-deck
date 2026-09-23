/**
 * refresh/refreshSource.js — 这一次检查链求值是什么身份：人亲手点的，还是插件自己的动作（#709 · T5 补）
 *
 * 为什么要有这一段：链求值这个入口有两种人按。一种是人在界面上亲手点的「重新检查」，
 * 客户端会带 trigger='user-recheck' 上来；另一种是插件自己按的（面板挂载、快照回包、
 * 动作做完之后再补一次），那一种客户端**不带** trigger。
 *
 * 这两种在账本上完全不一样（账本与闸在 src/host/refresh/gate.js 与 ledger.js）：
 * 人的动作有两件特权 —— 永不降档（额度再紧、撞了限流也照做），也不吃后台那一档的自限；
 * 插件自己的动作则要按后台档算。不把这两种分开的话，插件每次挂载都会被记成「人手动过」，
 * 于是「到底是谁在花这笔钱」在账上就再也看不出来了。
 *
 * 判据只有这一处，闸那边按 source 分类（gate.js 的 CALL_SITE_CATEGORIES 里这两个名字都有）：
 *   - 'panel.refresh' → 人的动作；
 *   - 'chain.eval'    → 后台档（挂载时那一次强制刷新走的正是这一档）。
 * 本文件是纯字符串判定：不读盘、不联网、不起定时器。
 */

/** 人亲手点的「重新检查」带上来的那个触发名。 */
export const USER_RECHECK_TRIGGER = 'user-recheck'

/** 账本/闸认的那个调用点名：人的动作。 */
export const REFRESH_SOURCE_USER = 'panel.refresh'

/** 账本/闸认的那个调用点名：插件自己的动作（归后台档）。 */
export const REFRESH_SOURCE_PLUGIN = 'chain.eval'

/**
 * 这一次链求值的身份。
 * @param {string} [trigger] 客户端带上来的触发名；插件自己发起的那种不带（空串）
 * @returns {string} 'panel.refresh' 或 'chain.eval'
 */
export function refreshSourceOf(trigger) {
  return String(trigger || '') === USER_RECHECK_TRIGGER ? REFRESH_SOURCE_USER : REFRESH_SOURCE_PLUGIN
}

/**
 * 这一次是不是「人亲手点的」。
 * 与 refreshSourceOf 同源：只有带对触发名的那一次算数，其余（含挂载时那一次强制刷新）都不算。
 */
export function isUserRefresh(trigger) {
  return refreshSourceOf(trigger) === REFRESH_SOURCE_USER
}

export default refreshSourceOf
