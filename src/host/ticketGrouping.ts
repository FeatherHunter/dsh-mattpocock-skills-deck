/**
 * src/host/ticketGrouping.ts —— 层内状态分组纯函数（H6 #450 从 host/index.js 149–204 搬出，groupTickets 内调 computeLevels 的归属不变，纯结构）。
 *
 * 来源与零变化：本文件由同目录 ticketGrouping.js 逐行转写而来，只加类型标注与注释，
 * 没有改任何运行时语义。原来的 .js 文件保留不动，引用方继续写 `./ticketGrouping.js`，
 * 由 scripts/ts-hook.mts 在加载时改指到同名 .ts。
 *
 * 以后谁改它：改层级/分组口径（frontier/claimed/blocked 划分）的人。预估约70行，超 350 打回。
 * 接线：由 index.ts 动态 import 加载（5 文件方案用户已定夺，为让 index.js 达标追加）；H2/H4 loader 取值后经显式参数转供给各模块；本文件零依赖、不引用其他新文件。
 *
 * 为什么参数按 `any` 收：票据的形状（number/state/blockedBy/claimedBy）是调用方与远端存储的契约，
 * 本文件只做分组计算，不拥有也不校验那份契约，所以类型不替代运行时的字段读取。
 * 本文件是纯函数，不碰进程、不碰磁盘，类型标注转译时整体剥离，运行时与原来一字不差。
 */

/** 分组结果的形状：总数、开闭数量、三态划分，以及给客户端漏斗用的分层。 */
export interface TicketGroups {
  total: number
  open: number
  closed: number
  frontier: number
  claimed: number
  blocked: number
  levels: any[]
  levelOf: Record<number, number>
}

/** 分层结果的形状：每张票的层号，以及每层的计数。 */
export interface TicketLevels {
  byNumber: Record<number, number>
  levels: any[]
}

export function createTicketGrouping(): { computeLevels: (tickets: any) => TicketLevels; groupTickets: (tickets: any) => TicketGroups } {
    // H2 #446 留守：computeLevels/groupTickets 留入口（H4 三处同步分组；file3 经显式参数复用同一份）。
    function computeLevels(tickets: any): TicketLevels {
      // 票号到票的索引：键是外部给的 number，值是外部给的票对象，本文件不校验它们的形状。
      const byNum: any = {}
      tickets.forEach(function (t: any) { byNum[t.number] = t })
      const memo: any = {}
      const levelOf = function (t: any): number {
        if (memo[t.number] !== undefined) return memo[t.number]
        const blockers: any[] = (t.blockedBy || []).map(function (b: any) { return byNum[b] }).filter(Boolean)
        if (!blockers.length) { memo[t.number] = 0; return 0 }
        let maxL: number = -1
        blockers.forEach(function (b: any) { const l: number = levelOf(b); if (l > maxL) maxL = l })
        memo[t.number] = maxL + 1
        return memo[t.number]
      }
      const byNumber: any = {}
      tickets.forEach(function (t: any) { byNumber[t.number] = levelOf(t) })
      const levels: any[] = []
      tickets.forEach(function (t: any) {
        const lv: number = byNumber[t.number]
        let layer: any = levels[lv]
        if (!layer) { layer = { level: lv, numbers: [], open: 0, closed: 0, total: 0, frontier: 0, claimed: 0, blocked: 0 }; levels[lv] = layer }
        layer.numbers.push(t.number)
        layer.total++
        if (t.state === 'CLOSED') layer.closed++
        else layer.open++
      })
      // 层内状态细分（frontier/claimed/blocked 归层）
      const openBlocker = function (b: any): any { const t: any = byNum[b]; return t !== undefined && t.state === 'OPEN' }
      levels.forEach(function (layer: any) {
        const openT: any[] = tickets.filter(function (t: any) { return byNumber[t.number] === layer.level && t.state === 'OPEN' })
        layer.frontier = openT.filter(function (t: any) { return !t.claimedBy && !t.blockedBy.some(openBlocker) }).length
        layer.claimed = openT.filter(function (t: any) { return t.claimedBy }).length
        layer.blocked = openT.filter(function (t: any) { return !t.claimedBy && t.blockedBy.some(openBlocker) }).length
      })
      // 剔除空洞（levels 数组可能因跳级出现 undefined）
      const compact: any[] = levels.filter(Boolean)
      return { byNumber: byNumber, levels: compact }
    }

    function groupTickets(tickets: any): TicketGroups {
      const byNum: any = {}
      tickets.forEach(function (t: any) { byNum[t.number] = t })
      const openBlocker = function (b: any): any { const t: any = byNum[b]; return t !== undefined && t.state === 'OPEN' }
      const open: any[] = tickets.filter(function (t: any) { return t.state === 'OPEN' })
      const closed: any[] = tickets.filter(function (t: any) { return t.state === 'CLOSED' })
      const frontier: any[] = open.filter(function (t: any) { return !t.claimedBy && !t.blockedBy.some(openBlocker) })
      const claimed: any[] = open.filter(function (t: any) { return t.claimedBy })
      const blocked: any[] = open.filter(function (t: any) { return !t.claimedBy && t.blockedBy.some(openBlocker) })
      // v1.4（T1 #442）：附 DAG 分层（client 渲染漏斗分层用）
      const lv: TicketLevels = computeLevels(tickets)
      return {
        total: tickets.length, open: open.length, closed: closed.length,
        frontier: frontier.length, claimed: claimed.length, blocked: blocked.length,
        levels: lv.levels, levelOf: lv.byNumber,
      }
    }
    return { computeLevels, groupTickets }
}
