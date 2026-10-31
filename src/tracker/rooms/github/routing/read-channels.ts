/**
 * src/tracker/rooms/github/routing/read-channels.ts —— 这次读放行时允许走哪些渠道（#1765）。
 *
 * 额度闸（src/refresh/kernel/budget-admission.ts）在放行一笔读的时候，会把「这次只能走哪些渠道、
 * 按什么顺序」写进上下文的 readChannels（有序：排在前面的先试，后面的只在前面的失败之后才试）。
 * 这里把那份计划折成读路径要用的两个布尔：
 *  - graphql：这次允许走 GraphQL；
 *  - rest：这次允许走 REST。
 *
 * 约定（与 contexts.ts 的 readChannels 注释同一份）：计划就是这次放行的完整授权 ——
 * 计划里没有的渠道一次都不许试（哪怕它现在看起来还有余额）；计划里有的渠道失败后，
 * 才按计划顺序换下一条，不必再回头问闸。
 *
 * 没有计划（老调用方、宿主直接调房间、测试直接调房间）时两个渠道都放行，行为与本票之前完全一致：
 * 这一层只负责「照计划执行」，不负责在这里自己判断额度 —— 额度判断只有额度闸一处（#1681）。
 */

import type { OpContext } from '../../../contract/contexts.js'

/** 这一次读允许走的渠道：给读路径用的最小形状。 */
export interface ReadChannelAccess {
  /** 这次允许走 GraphQL。 */
  graphql: boolean
  /** 这次允许走 REST。 */
  rest: boolean
  /** 这次是不是真带着额度闸的计划来的。false 表示没有计划，按老行为两渠道都试。 */
  planned: boolean
}

/**
 * 读出这次允许走的渠道。
 *
 * 为什么「空数组」也按没有计划处理：计划只可能由额度闸写入，闸不会写一个空计划；
 * 真出现空数组只可能是别处拼错了上下文，这时按老行为放行两渠道比直接禁掉所有渠道更接近原状。
 *
 * @param ctx 单次调用上下文（可以为空：读路径各处都允许没有上下文）
 */
export function readChannelsOf(ctx: OpContext | null | undefined): ReadChannelAccess {
  const list = ctx && Array.isArray(ctx.readChannels) ? ctx.readChannels : null
  if (!list || !list.length) return { graphql: true, rest: true, planned: false }
  return {
    graphql: list.indexOf('graphql') >= 0,
    rest: list.indexOf('rest') >= 0,
    planned: true,
  }
}

export default { readChannelsOf }
