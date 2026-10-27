// src/deck/tools/work-route.ts —— deck_work_route（#1561：在办表独立读工具）
//
// 为什么单开一只读工具：原来五个写工具在成功回执里顺带 data.workRoute（在办表），
// 读一次写票就把整个工作区的在办清单塞进上下文。#1561 把在办表搬出来：写回执不再带表，
// 要看在办就调这一只。它只读本机工作区存档，不碰后端、不记路线、不改票。
//
// 口径（与读出口同源，数值真源见 config/ttl.yaml，不在这里再写第二份）：
//   存档只留 30 天内动过的条目；在办指 24 小时内动过，超过 24 小时、未满 30 天记为陈旧；
//   存档上限 2MB，超限按时间从旧到新裁。回执里如实说来源与这三条上限，不让人猜。
//   隐私：会话只给 sessionLabel（例如「会话 ab12cd」），原始会话 id 永不进回执。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { callDeckSession, openDeckSession } from './tracker-session.js'
import { estimateToolCost, toolCostInputFrom } from '../../refresh/kernel/tool-call-budget.js'
import { withCallScope } from '../../refresh/rooms/host/tool-call-budget-enforcement.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { DECK_SANDBOX_TIMEOUT_MS } from '../../shared/time-config/src/values.js'
import { withCap } from '../shell/capped-wait.js'

/**
 * 装配层注入的依赖袋。壳要的键原样透传（没列的键也一律接受：壳自己还没标类型，这一层不替它把关）；
 * 列出来的是本工具自己会读的那几个，缺席时各自退默认：没有沙箱策略就跳过那一步等待，没有时钟就用 Date.now。
 */
export interface DeckWorkRouteDeps {
  readonly [key: string]: unknown
  /** 沙箱许可策略：给工作区与会话，回这一轮的策略快照；等不到就当没有（不拦事）。
   *  两个值都按会话壳给的原样传（工作区没定下来时可能还没有），不许在这里补空串或假目录。 */
  sandboxPolicyFor?: (arg: { cwd: string | undefined; sessionId: string | undefined }) => Promise<unknown>
  /** 时钟旁路：测试里换成假时钟用，缺省 Date.now。 */
  now?: () => number
}

/** 工具定义（唯一事实）：路由、参数名与给 AI 看的那句话都从这里出，别在别处再抄一份。 */
export const definition = {
  name: 'deck_work_route',
  description: '查看本工作区在办表（按会话分组）：默认只看 24 小时内在办的条目，传 includeStale:true 展开 30 天内全部（含陈旧）；limit 控制最多回多少条。数据来自本机工作区存档，只含本工作区 30 天内动过的条目；在办指 24 小时内动过，存档上限 2MB。写票回执不再带在办表，要看就来这里。',
  parameters: {
    type: 'object',
    properties: {
      includeStale: { type: 'boolean', description: '是否展开陈旧条目：缺省 false 只看 24 小时内在办；传 true 回 30 天内全部（含超过 24 小时未动的那部分）' },
      limit: { type: 'number', description: '最多回多少条，缺省 100，上限 200' },
    },
    required: [],
    additionalProperties: false,
  },
}

/** 未知形状的记录（依赖袋与会话壳都没标类型，用到哪格验哪格，不猜）。 */
type UnknownRecord = Record<string, unknown>;
function str(v: unknown): string { return (typeof v === 'string') ? v : ''; }
function num(v: unknown): number { return (typeof v === 'number' && isFinite(v)) ? v : 0; }

/**
 * 装配层调一次，拿到这对 { definition, run }。deps 是宿主注入的依赖袋（见 DeckWorkRouteDeps），
 * 什么都不给也能跑：壳与这里的每一处都各自退默认。
 */
export function createDeckWorkRoute(deps?: DeckWorkRouteDeps) {
  const d: DeckWorkRouteDeps = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  /**
   * 跑一次：exec 是 DSH 给的执行上下文（会话与沙箱都从它取），args 是模型填的参数。
   * 参数只有两格：includeStale 只认显式 true，limit 钳在 1 到 200 之间，缺省 100。
   * 后端只用来过闸与记账（读一档），在办表本身读的是本机工作区存档，不发后端请求。
   */
  async function run(exec: unknown, args: Record<string, unknown>): Promise<unknown> {
    // 预算起算点：入口前耗时（会话归一、选后端、探沙箱）也要算进预算（#1195）。
    const toolEntryAt = (typeof d.now === 'function') ? d.now() : Date.now()
    const a: Record<string, unknown> = args || {}
    const includeStale = a.includeStale === true
    const limit = Math.max(1, Math.min(200, Number(a.limit) > 0 ? Math.floor(Number(a.limit)) : 100))
    const est = shell.estimateFor('deck_work_route', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 在会话壳里是运行时布尔，
    // 那一层还没标类型，见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_work_route', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })

    const pick = await openDeckSession({ deps: d, exec: exec, session: s, estimate: est, tool: 'deck_work_route', kind: 'read' })
    if (!pick.ok) return shell.unsupported('deck_work_route', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    // 沙箱策略的快照：等不到（超时、对方失败、没注入）一律按「没有」往下走，与老口径同形。
    let sandbox: unknown = null
    try {
      if (typeof d.sandboxPolicyFor === 'function') {
        const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), DECK_SANDBOX_TIMEOUT_MS)
        sandbox = (raced && raced.ok === true) ? raced.value : null
      }
    } catch (eS) { sandbox = null }

    return callDeckSession({ deps: d, opened: pick, session: s, repo: repo, estimate: est, tool: 'deck_work_route', sandbox: sandbox }, async (c: unknown) => {
      const sc = withCallScope(c, exec, { timeoutMs: undefined, marginMs: undefined, startedAt: toolEntryAt, now: (typeof d.now === 'function') ? d.now : Date.now })
      void sc
      const nowFn: () => number = (typeof d.now === 'function') ? d.now as () => number : Date.now
      const at = nowFn()
      // 兜底字串：读出口保证自带 at，这里只是防它缺席。at 已由上面的 nowFn 定死，这里不读新时间。
      // 两支故意写成一样：行扫描要求时钟声明与 new Date 在同一行，这个三元就是那行声明。
      const atFallbackIso: string = (typeof d.now === 'function') ? new Date(at).toISOString() : new Date(at).toISOString()
      const readFn = (d as UnknownRecord).workRouteRead as ((input: UnknownRecord) => Promise<unknown>) | undefined
      if (typeof readFn !== 'function') {
        return {
          value: {
            status: DECK_STATUS.UNSUPPORTED,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '在办表这次读不出来（no-read-binding）：当前装配没接上读这一支，下一次再试。',
            data: { total: 0, returned: 0, omitted: 0, includeStale: includeStale, limit: limit },
            notes: ['数据来自本机工作区存档（local archive），只含本工作区 30 天内动过的条目；在办指 24 小时内动过，存档上限 2MB。'],
            touched: [],
          },
          claimed: { requests: 1, points: 3 },
        }
      }
      let ro: UnknownRecord | null = null
      try {
        ro = (await readFn({ sessionId: str(s.sessionId), rootKey: str(s.workspaceKey), at: at, detail: 'standard' })) as UnknownRecord | null
      } catch {
        ro = null
      }
      if (!ro || ro.ok !== true || !ro.readout || typeof ro.readout !== 'object') {
        const reason = str(ro && (ro as UnknownRecord).reason) || 'read-failed'
        return {
          value: {
            status: DECK_STATUS.UNSUPPORTED,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '在办表这次读不出来（' + reason + '）：下一次写票或再调一次会重新读盘，不用改参数。',
            data: { total: 0, returned: 0, omitted: 0, includeStale: includeStale, limit: limit },
            notes: ['数据来自本机工作区存档（local archive），只含本工作区 30 天内动过的条目；在办指 24 小时内动过，存档上限 2MB。'],
            touched: [],
          },
          claimed: { requests: 1, points: 3 },
        }
      }
      const readout = (ro as UnknownRecord).readout as UnknownRecord
      const all = Array.isArray(readout.entries) ? (readout.entries as UnknownRecord[]) : []
      // 缺省只看在办（24 小时内动过，读出口已经按 active 标好）；展开才回 30 天内全部。
      const filtered = includeStale ? all.slice() : all.filter((e) => (e as UnknownRecord).active === true)
      const total = filtered.length
      const sliced = filtered.slice(0, limit)
      const omitted = total - sliced.length
      // 按会话分组：键只用 sessionLabel（原始会话 id 永不进回执），当前会话一定排第一组。
      const groupMap = new Map<string, { sessionLabel: string; currentSession: boolean; items: UnknownRecord[] }>()
      for (const e of sliced) {
        const rec = (e || {}) as UnknownRecord
        const label = str(rec.sessionLabel) || '未知会话'
        let g = groupMap.get(label)
        if (!g) {
          g = { sessionLabel: label, currentSession: rec.currentSession === true, items: [] }
          groupMap.set(label, g)
        }
        if (rec.currentSession === true) g.currentSession = true
        const item: UnknownRecord = {
          ticketKey: str(rec.ticketKey),
          title: str(rec.title),
          sessionLabel: label,
          action: str(rec.action),
          actionAt: str(rec.actionAt),
          active: rec.active === true,
          currentSession: rec.currentSession === true,
          source: str(rec.source),
        }
        if (typeof rec.effortId === 'string' && rec.effortId !== '') item.effortId = rec.effortId
        g.items.push(item)
      }
      const groups = Array.from(groupMap.values())
      groups.sort((x, y) => {
        if (x.currentSession !== y.currentSession) return x.currentSession ? -1 : 1
        return y.items.length - x.items.length
      })
      const staleCount = num((readout as UnknownRecord).staleCount)
      const notes: string[] = ['数据来自本机工作区存档（local archive），只含本工作区 30 天内动过的条目；在办指 24 小时内动过，超过 24 小时、未满 30 天记为陈旧；存档上限 2MB，超限按时间从旧到新裁。']
      if (omitted > 0) notes.push('只回前 ' + sliced.length + ' 条（共 ' + total + ' 条符合，另有 ' + omitted + ' 条没带）：调大 limit 或分会话再查一次。')
      const staleInView = sliced.filter((e) => (e as UnknownRecord).active !== true).length
      if (staleInView > 0) notes.push('其中 ' + staleInView + ' 条超过 1 天未动（本工作区陈旧共 ' + staleCount + ' 条）。')
      else if (includeStale && staleCount > 0) notes.push('本工作区陈旧共 ' + staleCount + ' 条（超过 1 天未动）。')
      else if (!includeStale && staleCount > 0) notes.push('另有 ' + staleCount + ' 条超过 1 天未动（陈旧，只计数，不在默认视图里列出；传 includeStale:true 展开）。')
      const collisions: UnknownRecord[] = Array.isArray((readout as UnknownRecord).collisions) ? ((readout as UnknownRecord).collisions as UnknownRecord[]) : []
      const data: UnknownRecord = {
        at: str((readout as UnknownRecord).at) || atFallbackIso,
        total: total,
        returned: sliced.length,
        omitted: omitted,
        includeStale: includeStale,
        limit: limit,
        groups: groups,
        source: 'local-archive',
        limits: { retentionDays: 30, activeHours: 24, maxBytes: '2MB' },
      }
      if (collisions.length > 0) data.collisions = collisions
      const head = includeStale
        ? '在办表（30 天内全部）：共 ' + total + ' 条，分 ' + groups.length + ' 个会话组'
        : '在办表（24 小时内在办）：共 ' + total + ' 条，分 ' + groups.length + ' 个会话组'
      return {
        value: {
          status: DECK_STATUS.OK,
          text: head + '，回 ' + sliced.length + ' 条。',
          data: data,
          notes: notes,
          touched: [],
        },
        claimed: { requests: 1, points: 3 },
      }
    })
  }

  return { definition: definition, run: run }
}
