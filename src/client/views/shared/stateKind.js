/**
 * views/shared/stateKind.js — 一条票在界面上该显示成什么状态（三种，单源判据）
 *
 * 为什么要有这个文件：#599。GitHub 的拉取请求有三种状态（打开 / 已关闭 / 已合并），
 * 而契约层与后端归一都只认「打开 / 已关闭」两种（已合并归到已关闭，把合并时间留在
 * mergedAt 字段里）。于是「是不是已合并」这件事只能由界面按合并时间判断，
 * 而拉取请求页、单票详情页两处都要判 —— 判据写两遍就会各写各的，所以收在这一个文件里。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物）。本文件不新增跨边界调用、不新增缓存、
 * 不新增定时触发的活，所以没有新增日志点。
 */

/**
 * @param {Object} x 一张票（快照形状或详情形状都认）
 * @returns {'open'|'closed'|'merged'} 界面该显示的状态
 *
 * 判据顺序（第一性）：已合并是「关闭」的一种，所以先看合并时间再看关闭 ——
 * 顺序反过来会把已合并的判成已关闭。
 * 拉取请求与普通工单共用这个函数，所以要先确认是拉取请求，免得普通工单上出现「已合并」。
 */
export const prStateKind = function (x) {
  try {
    const raw = x && x.state != null ? String(x.state).trim().toLowerCase() : ''
    const mergedAt = x && (x.mergedAt || (x.pull_request && x.pull_request.merged_at))
    // 来源自己就直接写「已合并」的（不同后端或旧缓存）：直接认，不要求它同时给出合并时间
    if (raw === 'merged') return 'merged'
    // 有合并时间且确实是拉取请求 → 已合并；isPullRequest 字段缺失时不据它否定（旧缓存兼容）
    if (mergedAt && !(x && x.isPullRequest === false)) return 'merged'
    if (raw === 'closed') return 'closed'
    return 'open'
  } catch (e) {
    return 'closed'
  }
}
