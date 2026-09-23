/**
 * refresh-core/src/tool-cost.ts —— AI 工具的「调用前算账」（#713 第六批）
 *
 * 解决的是什么问题：AI 一次 `deck_map_plan_create` 可以一口气建几十张票，每张票都要花掉
 * 真实的 GitHub 配额。事后记账只能告诉人「刚才花了多少」；这一份要回答的是**动手之前**的四句话：
 * 这笔要花多少点、要发多少条出站请求、会不会超插件给 AI 工具设的那道单次硬顶、超了该分成几片。
 * 依据：docs/architecture/refresh-budget-architecture.html 第四章与维护者 2026-09-23 定的
 * 「单次 ≤600 点且 ≤400 次请求、每小时 ≤2000 点且 ≤1500 次请求、一次最多建 60 张子票」。
 *
 * 为什么本文件一个数字都不写、全部从参数进来：刷新核心的产物（src/shared/refresh/*.js）之间
 * 不许互相 import（tests/verify-no-same-layer-import.js 与 tests/verify-refresh-freshness.js 的
 * 「产物零相对引用」两条门禁一起守这件事）。同一个仓库里 policy.ts 与 backoff.ts 也是这个做法：
 * 数字由宿主侧从 budget.js 现取现传（见 src/host/tools/ 里各工具构造 limits 的那一行），
 * 这里只留形状与算式。额度常量因此仍然只有一处物理真源：refresh-core/src/budget.ts。
 *
 * 单价怎么定的（这里是「最坏情况估算」，不是精算，理由与实测校正见票面「实测校正」一句）：
 *   - 建一张票：4 点、2 条请求（一条建票 mutation，一条把父票/标签接上）。
 *   - 一条边（父子或阻塞）：2 点、1 条请求。
 *   - 改一张票（评论/标签/认领/关闭/标题正文）：2 点、1 条请求。
 *   - 读回一张票：3 点、1 条请求（读回是工具自己为了给出「写后真状态」而发的，不是让 AI 再读一次）。
 *   - 每笔工具调用还有一份固定开销：3 点、2 条请求（选后端那一次探测 + 收尾的计数校验）。
 * 一张地图骨架（12 张子票 12 条边）按这套价算出来是 3 + 12×4 + 12×2 = 75 点、2 + 24 + 12 = 38 条请求，
 * 远在单次硬顶之内，所以旗舰工具能一次把整张地图建成——这正是票面说「不要把数字压得太小」的原因。
 * 本地 Markdown 后端实际花 0 点（写的是本机文件），这里仍按最贵的后端估算，宁可多报不少报。
 *
 * 三种调用形态共用这一个算式：只给票数、只给边数、或两者都给都行；没给的按 0 算。
 */

/** 额度与硬顶：字段名与 refresh-core/src/budget.ts 的导出同名，调用方对照着取即可。 */
export interface ToolCostLimits {
  /** 一次调用最多花多少点（budget.AI_TOOL_MAX_POINTS_PER_CALL）。 */
  maxPointsPerCall: number
  /** 一次调用最多发多少条出站请求（budget.AI_TOOL_MAX_REQUESTS_PER_CALL）。 */
  maxRequestsPerCall: number
  /** 一次调用最多建多少张子票（budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL）。 */
  maxChildTicketsPerCall: number
  /** 这一小时 AI 工具已经花掉多少点（不传按 0 算；只影响建议，不影响单次裁决）。 */
  usedPointsThisHour?: number
  /** 这一小时 AI 工具已经发掉多少条请求（不传按 0 算）。 */
  usedRequestsThisHour?: number
  /** 这一小时最多花多少点（budget.AI_TOOL_MAX_POINTS_PER_HOUR）。 */
  maxPointsPerHour: number
  /** 这一小时最多发多少条请求（budget.AI_TOOL_MAX_REQUESTS_PER_HOUR）。 */
  maxRequestsPerHour: number
}

/** 这一笔工具调用要做的活（工具名 + 参数里数得出来的几件事）。 */
export interface ToolCostInput {
  /** 工具名，例如 deck_map_plan_create。只用来写进报告与文案，不参与定价。 */
  tool: string
  /** 要建几张新票（含地图票本身）。 */
  tickets?: number
  /** 要建几条边（父子 + 阻塞）。 */
  edges?: number
  /** 要改几张已存在的票（评论、标签、认领、关闭、标题正文）。 */
  patches?: number
  /** 要读回几张票（含为了给出落点而自己发的读回）。 */
  reads?: number
}

/** 一笔调用要做的活折算出来的账。 */
export interface ToolCostEstimate {
  tool: string
  tickets: number
  edges: number
  patches: number
  reads: number
  /** 预估点数（最坏情况）。 */
  points: number
  /** 预估出站请求条数（最坏情况）。 */
  requests: number
  /** 这笔会不会超单次硬顶（点数与请求数都在顶内才算不超）。 */
  withinCallCap: boolean
  /** 超在哪一项：空串 = 没超；'points' / 'requests' / 'both' / 'unknown'。 */
  overCallCap: string
  /** 加上本小时已用之后会不会超每小时硬顶。 */
  withinHourCap: boolean
  /** 建议分几片（不用分片时是 1）。片数由「一次最多建多少张子票」推出来，不是另写一个数。 */
  shards: number
  /** 分片后每片最多建几张子票（永远不会大于 limits.maxChildTicketsPerCall）。 */
  perShard: number
  /** 一句给 AI 看的话：花多少、超没超、要不要分片。 */
  text: string
}

/** 单价表：本文件里唯一允许出现这些数的地方（导出是给门禁与测试对账用，调用方不必读它）。 */
export const TOOL_COST_PRICES = Object.freeze({
  /** 固定开销：选后端那一次探测 + 收尾的计数校验。 */
  fixedPoints: 3,
  fixedRequests: 2,
  /** 建一张票。 */
  ticketPoints: 4,
  ticketRequests: 2,
  /** 一条边。 */
  edgePoints: 2,
  edgeRequests: 1,
  /** 改一张票。 */
  patchPoints: 2,
  patchRequests: 1,
  /** 读回一张票。 */
  readPoints: 3,
  readRequests: 1,
})

function count(v: number | undefined): number {
  const n = typeof v === 'number' && isFinite(v) ? Math.floor(v) : 0
  return n > 0 ? n : 0
}

/**
 * 算一笔账。inputs 里没给的那几项按 0 算；票数与边数都不为 0 时两笔都算进去。
 * 这里不做任何「这个工具只能建票」的假设——工具名不参与定价，只写进报告。
 */
export function estimateToolCost(input: ToolCostInput, limits: ToolCostLimits): ToolCostEstimate {
  const p = TOOL_COST_PRICES
  const tickets = count(input.tickets)
  const edges = count(input.edges)
  const patches = count(input.patches)
  const reads = count(input.reads)
  const points = p.fixedPoints + tickets * p.ticketPoints + edges * p.edgePoints + patches * p.patchPoints + reads * p.readPoints
  const requests = p.fixedRequests + tickets * p.ticketRequests + edges * p.edgeRequests + patches * p.patchRequests + reads * p.readRequests

  const overPoints = points > limits.maxPointsPerCall
  const overRequests = requests > limits.maxRequestsPerCall
  const overCallCap = overPoints && overRequests ? 'both' : overPoints ? 'points' : overRequests ? 'requests' : ''
  const withinCallCap = overCallCap === ''

  // 分片只按「一次最多建多少张子票」这一条规则算（与 budget.shardPlan 同一套算式，门禁逐值比对）。
  const cap = count(limits.maxChildTicketsPerCall) || 1
  const shards = Math.max(1, Math.ceil(tickets / cap))
  const perShard = Math.max(1, Math.ceil(tickets / shards))

  const usedPoints = count(limits.usedPointsThisHour)
  const usedRequests = count(limits.usedRequestsThisHour)
  const withinHourCap = (usedPoints + points) <= limits.maxPointsPerHour && (usedRequests + requests) <= limits.maxRequestsPerHour

  return {
    tool: String(input.tool || ''),
    tickets: tickets,
    edges: edges,
    patches: patches,
    reads: reads,
    points: points,
    requests: requests,
    withinCallCap: withinCallCap && withinHourCap,
    overCallCap: withinCallCap ? (withinHourCap ? '' : 'hour') : overCallCap,
    withinHourCap: withinHourCap,
    shards: shards,
    perShard: perShard,
    text: estimateText(input.tool, points, requests, withinCallCap && withinHourCap, overCallCap, withinHourCap, shards, perShard, tickets),
  }
}

/** 那一句给 AI 看的话。超顶时把「超的是哪一项、顶在哪」说明白，不笼统说「额度不够」。 */
function estimateText(tool: string, points: number, requests: number, ok: boolean, over: string, hourOk: boolean, shards: number, perShard: number, tickets: number): string {
  const head = '这次 ' + tool + ' 预计花 ' + points + ' 点、' + requests + ' 条出站请求'
  if (!ok) {
    const which = over === 'points' ? '点数超了单次硬顶' : over === 'requests' ? '出站请求条数超了单次硬顶' : over === 'hour' ? '加上本小时已用，超了每小时硬顶' : '同时超了点数与请求数两条单次硬顶'
    const tail = tickets > 0 ? '。建议分 ' + shards + ' 次调用，每片不超过 ' + perShard + ' 张票' : '。请把这一笔拆小之后再调'
    return head + '，' + which + tail + '。'
  }
  if (tickets > 0 && shards > 1) return head + '，在硬顶之内；不过这次要建 ' + tickets + ' 张票，建议分 ' + shards + ' 片、每片 ' + perShard + ' 张。'
  if (!hourOk) return head + '，单次没超顶，但本小时 AI 工具已经快用满了（每小时硬顶见 deck_context 的返回值）。'
  return head + '，在硬顶之内。'
}

/**
 * 从工具名 + 原始参数折出要做的活。参数形状由各自的工具定义（见 src/host/tools/*.js），
 * 这里只认与「要建多少张票、几条边」有关的那几个字段，多出来的字段一律忽略，绝不因为
 * 参数里有别的东西就把它算成工作量大。
 */
export function toolCostInputFrom(tool: string, args: Record<string, unknown> | null | undefined): ToolCostInput {
  const a = (args || {}) as Record<string, unknown>
  const list = (v: unknown): number => (Array.isArray(v) ? v.length : 0)
  const one = (v: unknown): number => (v === undefined || v === null || v === '' ? 0 : 1)
  const base: ToolCostInput = { tool: String(tool || '') }
  switch (tool) {
    case 'deck_context':
      return Object.assign(base, { reads: 1 })
    case 'deck_issue_get':
      return Object.assign(base, { reads: 1 })
    case 'deck_map_snapshot':
      return Object.assign(base, { reads: 1 })
    case 'deck_issue_create':
      return Object.assign(base, { tickets: 1, edges: one(a.parentKey) + list(a.blockedBy) })
    case 'deck_map_plan_create':
      return Object.assign(base, { tickets: list(a.children) + (a.title ? 1 : 0), edges: list(a.edges) + list(a.children) })
    case 'deck_map_link':
      return Object.assign(base, { edges: list(a.edges) + (a.parentKey ? 1 : 0), reads: 1 })
    case 'deck_issue_patch':
      return Object.assign(base, { patches: 1, reads: 1, edges: one(a.parentKey) })
    default:
      return Object.assign(base, {
        tickets: count(a.tickets as number),
        edges: count(a.edges as number),
        patches: count(a.patches as number),
        reads: count(a.reads as number),
      })
  }
}
