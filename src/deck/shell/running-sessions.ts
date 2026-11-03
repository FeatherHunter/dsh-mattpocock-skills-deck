// src/deck/shell/running-sessions.ts —— #1793：按宿主现报的即时状态算出「此刻真有一轮开着的会话」标签。
//
// 为什么单开一份：在办表（deck_work_route）要在会话组上标 running，但「跑没在跑」只有宿主知道，
//   deck 层拿不到；装配层把宿主那两服务（agents / sessions）递进来，这里只做筛与换算，
//   装配层与门禁走的是同一份实现，不各写一套（#1793 的 B3）。
//
// 口径（三条，都是「宁可少标也不标错」）：
//   1. 只认 agent.status === 'running'：等审批、等回答的回合也算在跑（宿主 README 的口径）。
//   2. 只认与本工作区同一个根：先按路径同根粗筛，子目录会话再经 canonicalKey 归一到工作区根、
//      用与在办表同一把短散列（workspaceKeyOf）比键；拿不到归一出口就不标。
//   3. 跳过当前会话自己（它发起这次工具调用时必然 running）与子代理会话（不占会话一栏，标签没有落点）。
//   一个都算不出来就回空数组；调用方只能把「空」读成「不知道」，不能读成「没人在跑」。
//
// 来源全是宿主进程里的活状态：不读存档、不落盘、没有历史。
import { withCap } from './capped-wait.js'

/** 宿主递给本层的两份服务的最小形状（用不到别的口，不要求全量接口）。 */
export interface RunningSessionServices {
  /** agent 注册表：list() 回所有活 agent，每个至少带 id 与 status。 */
  agents?: { list?: () => unknown } | null
  /** 会话仓库：get(id) 回活着的会话，header 里至少有 cwd 与 origin。 */
  sessions?: { get?: (id: string) => unknown } | null
}

/** 算标签所需的注入口：键、标题、标签、归一出口与等待上限都由调用方给（门禁可全用假的）。 */
export interface RunningSessionDeps {
  /** 工作区键的计算口（与在办表同一把短散列）。 */
  workspaceKeyOf?: (root: unknown) => unknown
  /** 会话目录 → 工作区根 的归一出口（宿主 canonicalKey；缺席时只认路径完全相同的会话）。 */
  canonicalKey?: (cwd: string) => unknown
  /** 会话标题快照（宿主 sessionTitleSnapshotOf；取不到就空串）。 */
  sessionTitleSnapshotOf?: (id: string) => unknown
  /** 标题 + 会话 id → 回执里的会话标签（与在办表存档里的 sessionLabel 同一实现）。 */
  labelOf: (title: string, id: string) => string
  /** 归一那一步的等待上限（毫秒）；缺省不给时限（由调用方的壳兜住整趟）。 */
  canonicalTimeoutMs?: number
  /** 最多看多少个 agent（防大机器上这一趟扫太久）；缺省 24。 */
  maxAgents?: number
}

/** 路径只做「比得动」的规整：反斜杠统一、去尾斜杠、Windows 折小写（与宿主既有的路径键同口径）。 */
function normalizedPathOf(value: unknown): string {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 筛出「此刻真有一轮开着」的会话标签。
 * @param input.services 宿主服务（agents / sessions），可缺席
 * @param input.deps 键、标题、标签与归一出口
 * @param input.selfSessionId 发起这次调用的会话（它自己必然 running，要排除）
 * @param input.workspaceKey 这次调用落在哪个工作区（在办表同一个键）
 * @param input.cwd 这次调用的工作区根（路径同根粗筛用）
 */
export async function runningSessionLabels(input: {
  services?: RunningSessionServices
  deps: RunningSessionDeps
  selfSessionId: string
  workspaceKey: string
  cwd: string
}): Promise<string[]> {
  try {
    const services = input.services || {}
    const deps = input.deps
    const selfId = String(input.selfSessionId || '')
    const wantKey = String(input.workspaceKey || '')
    const root = normalizedPathOf(input.cwd)
    if (!wantKey || !root) return []
    const agentsSvc = services.agents
    const sessionsSvc = services.sessions
    if (!agentsSvc || typeof agentsSvc.list !== 'function' || !sessionsSvc || typeof sessionsSvc.get !== 'function') return []
    let listed: unknown = null
    try { listed = agentsSvc.list() } catch (eList) { listed = null }
    const all: unknown[] = Array.isArray(listed) ? listed : []
    const cap = Math.max(1, Number(deps.maxAgents) || 24)
    const labels: string[] = []
    for (const raw of all.slice(0, cap)) {
      try {
        const agent = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : null
        if (!agent || agent.status !== 'running') continue
        const id = String(agent.id || '')
        if (!id || id === selfId) continue
        let session: unknown = null
        try { session = sessionsSvc.get(id) } catch (eGet) { session = null }
        const header = ((session && typeof session === 'object') ? (session as Record<string, unknown>).header : null) as Record<string, unknown> | null
        if (!header) continue
        if (header.origin === 'subagent') continue
        const rawCwd = String(header.cwd || '')
        if (!rawCwd) continue
        const cwd = normalizedPathOf(rawCwd)
        if (!cwd) continue
        // 先按路径同根筛一道：与当前工作区根同一条目录就是同一处；开在它下面的子目录才需要归一。
        let same = (cwd === root)
        if (!same) {
          if (cwd.indexOf(root + '/') !== 0) continue
          if (typeof deps.canonicalKey !== 'function' || typeof deps.workspaceKeyOf !== 'function') continue
          let canon: unknown = null
          try {
            const pending = Promise.resolve().then(function () { return (deps.canonicalKey as (cwd: string) => unknown)(rawCwd) })
            const timeoutMs = Number(deps.canonicalTimeoutMs)
            canon = (timeoutMs > 0) ? await withCap(pending, timeoutMs) : await pending
          } catch (eCanon) { canon = null }
          // withCap 成功时回 { ok: true, value }；没收进壳时就是原值本身。
          const value = (canon && typeof canon === 'object' && 'ok' in (canon as Record<string, unknown>))
            ? ((canon as Record<string, unknown>).ok === true ? (canon as Record<string, unknown>).value : null)
            : canon
          if (typeof value !== 'string' || !value) continue
          same = String(deps.workspaceKeyOf(value)) === wantKey
        }
        if (!same) continue
        let title = ''
        try { title = (typeof deps.sessionTitleSnapshotOf === 'function') ? String(deps.sessionTitleSnapshotOf(id) || '') : '' } catch (eTitle) { title = '' }
        const label = deps.labelOf(title, id)
        if (label) labels.push(label)
      } catch (eOne) { continue }
    }
    return labels
  } catch (e) { return [] }
}
