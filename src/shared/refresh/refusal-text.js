// src/shared/refresh/refusal-text.js —— AI 工具被拒时回给 AI 的那句话（#998 从宿主闸搬出）
//
// 为什么搬出来：src/host/refresh/gate.js 贴着 350 行单文件上限（tests/verify-file-granularity.js），
// #998 给「连续失败」留出口那件事要往闸里加十几行，就得先搬走同等量的东西。搬出来的只挑纯的：
// 给同样的输入永远同样的输出，不读时钟、不碰账本、不看工作区状态。
//
// 住共享层而不是宿主层：宿主层文件之间不许互相引用（tests/verify-no-same-layer-import.js），
// 宿主引用共享层是允许的方向，所以只能放这里。本文件零 import。
//
// 两种拒绝必须分得开（票面硬要求）：
//   ①「我花超了」——超过插件自己给工具设的单次或每小时硬顶，是自限，不是别人抢了额度；
//   ②「额度被别人用掉了」——剩余额度已到保底线，会话里别的 GitHub 调用把额度吃掉了，
//     这时先拒 AI 工具写入，绝不挤掉插件刷新与人的动作。

/**
 * @param {{reason: string, points: number, requests: number}} a 准入结论
 * @param {{remaining: number}} q 这一桶现在的账（只用剩下多少点）
 * @param {{points: number, requests: number}} hour 本小时 AI 工具已经花掉多少
 * @param {{shards: number, perShard: number}} plan 建议分几片、每片最多几张票
 * @param {{aiToolMaxPointsPerCall: number, aiToolMaxRequestsPerCall: number, aiToolMaxPointsPerHour: number, aiToolMaxRequestsPerHour: number}} limits 两道硬顶的数字（由调用方从 budget.js 取好传进来）
 * @returns {string}
 */
export function refusalTextRef(a, q, hour, plan, limits) {
  const cap = (a.reason === 'ai-tool-over-call-cap' || a.reason === 'ai-tool-over-hour-cap')
  const head = cap
    ? '这次调用超过了插件给 AI 工具设的自己那道硬顶（额度没被别人用掉，是这一笔太大或这一小时攒太多了）'
    : '剩余额度已经到保底线，额度是被别人用掉的（会话里别的 GitHub 调用先花了）：先拒 AI 工具写入'
  return head + '。这次预计花 ' + a.points + ' 点、' + a.requests + ' 条出站请求；本小时 AI 工具已用 ' +
    hour.points + ' 点、' + hour.requests + ' 条；这一桶现在还剩 ' + q.remaining + ' 点。建议分 ' +
    plan.shards + ' 次调用，每片不超过 ' + plan.perShard + ' 张票（单次硬顶 ' + limits.aiToolMaxPointsPerCall + ' 点 / ' +
    limits.aiToolMaxRequestsPerCall + ' 条，每小时 ' + limits.aiToolMaxPointsPerHour + ' 点 / ' +
    limits.aiToolMaxRequestsPerHour + ' 条）。'
}
