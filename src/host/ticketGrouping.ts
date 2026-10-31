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
 *
 * #1768：阻塞者不在本批票里时不再默认「不算挡」。本文件与 src/tracker/body-parse.ts 的
 * computeLevels/groupTickets 是两份副本（一份给宿主、一份给 tracker 层与门禁），判定必须逐字同口径；
 * tests/verify-map-first-frame.ts 有交叉核对用例，改一处必须同步改另一处。
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
    /**
     * 编号规范键：补零、带前后空白的写法折成同一个键（' 01 ' / '01' / 1 都折成 '1'）。
     * 与 src/tracker/body-parse.ts、客户端 numberKeyOf 同一套折法——跨容器引用比对时不能各认各的写法。
     */
    function refKeyOf(value: any): string {
      if (value === null || value === undefined) return ''
      if (typeof value === 'object') {
        const inner = value.key !== null && value.key !== undefined ? value.key : value.number
        return inner === null || inner === undefined ? '' : refKeyOf(inner)
      }
      const raw = String(value).trim()
      if (!raw) return ''
      const digits = /^0*(\d+)$/.exec(raw)
      return digits ? String(Number(digits[1])) : raw
    }
    /**
     * 这张票是不是被 blocker 挡住（#1768）。逻辑与 src/tracker/body-parse.ts 的 blockerBlocks 逐条相同：
     * 阻塞者在本批 → 只有 OPEN 挡；不在本批 → 明确 CLOSED 才放行，OPEN / 未知 / 没有引用旁表都按挡着收口。
     */
    function blockerBlocks(ticket: any, blocker: any, byNum: any): boolean {
      const key = refKeyOf(blocker)
      const local = byNum[key]
      if (local !== undefined) return local.state === 'OPEN'
      const refs: any[] = Array.isArray(ticket.blockedByRefs) ? ticket.blockedByRefs : []
      let seen = false
      for (let i = 0; i < refs.length; i += 1) {
        const ref = refs[i]
        if (refKeyOf(ref) !== key) continue
        seen = true
        const state = ref && ref.state != null ? String(ref.state).trim().toUpperCase() : ''
        if (state !== 'CLOSED') return true
      }
      if (!seen) return true
      return false
    }
    // H2 #446 留守：computeLevels/groupTickets 留入口（H4 三处同步分组；file3 经显式参数复用同一份）。
    function computeLevels(tickets: any): TicketLevels {
      // 票号到票的索引：键走 refKeyOf（'01'、1、' 1 ' 同一格），值是外部给的票对象，本文件不校验它们的形状。
      const byNum: any = {}
      tickets.forEach(function (t: any) { byNum[refKeyOf(t.number)] = t })
      const memo: any = {}
      const levelOf = function (t: any): number {
        if (memo[t.number] !== undefined) return memo[t.number]
        // 深度只由本批内的阻塞关系决定；图外引用按叶子算（不改变分层，只影响 frontier 的判定）。
        const blockers: any[] = (t.blockedBy || []).map(function (b: any) { return byNum[refKeyOf(b)] }).filter(Boolean)
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
      // 层内状态细分（frontier/claimed/blocked 归层）：判定走 blockerBlocks，与 src/tracker/kernel/grouping.ts
      // 同一口径（tracker 那份由 src/tracker/body-parse.ts 转出名字）。
      levels.forEach(function (layer: any) {
        const openT: any[] = tickets.filter(function (t: any) { return byNumber[t.number] === layer.level && t.state === 'OPEN' })
        const isBlocked = function (t: any): boolean { return t.blockedBy.some(function (b: any) { return blockerBlocks(t, b, byNum) }) }
        layer.frontier = openT.filter(function (t: any) { return !t.claimedBy && !isBlocked(t) }).length
        layer.claimed = openT.filter(function (t: any) { return t.claimedBy }).length
        layer.blocked = openT.filter(function (t: any) { return !t.claimedBy && isBlocked(t) }).length
      })
      // 剔除空洞（levels 数组可能因跳级出现 undefined）
      const compact: any[] = levels.filter(Boolean)
      return { byNumber: byNumber, levels: compact }
    }

    function groupTickets(tickets: any): TicketGroups {
      const byNum: any = {}
      tickets.forEach(function (t: any) { byNum[refKeyOf(t.number)] = t })
      // #1768：跨容器引用按引用态收口（明确 CLOSED 才算关掉），不再默认「不在本批就不挡」。
      // 认领与阻塞互斥：认领掉的票进 claimed，不再进 frontier / blocked（body-parse 同一写法）。
      const isBlocked = function (t: any): boolean { return t.blockedBy.some(function (b: any) { return blockerBlocks(t, b, byNum) }) }
      const open: any[] = tickets.filter(function (t: any) { return t.state === 'OPEN' })
      const closed: any[] = tickets.filter(function (t: any) { return t.state === 'CLOSED' })
      const frontier: any[] = open.filter(function (t: any) { return !t.claimedBy && !isBlocked(t) })
      const claimed: any[] = open.filter(function (t: any) { return t.claimedBy })
      const blocked: any[] = open.filter(function (t: any) { return !t.claimedBy && isBlocked(t) })
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
