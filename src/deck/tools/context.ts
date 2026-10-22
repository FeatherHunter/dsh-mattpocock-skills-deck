// src/deck/tools/context.ts —— deck_context（#713 第六批；#1019 换到新树、#1035 转 TypeScript）
//
// 这个工具回答一句话：我这是站在哪个工作区、哪个后端、哪个仓库上，初始化好了没有，
// 这个仓库现在有哪些地图。它同时也是「查重起点」——AI 要建票之前先看这里有哪些地图与票。
// 详细语义故意放在它的返回值里，别的六个工具的 description 只留一句话（描述会进所有会话的系统提示）。
//
// 拿不到的东西一律如实说：没有会话工作区、没有后端、后端不认这条路，都在返回值里写明。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { withCallScope } from '../shell/call-budget.js'
import * as budget from '../../shared/refresh/src/budget.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/src/tool-cost.js'
import { knownWritePermissions } from '../../shared/tracker/backendWritePermissions.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { DECK_SANDBOX_TIMEOUT_MS } from '../../shared/time-config/src/values.js'

/** 数字型参数的统一收口：正的有限数才要（取整），其余一律当「没给」，由调用方退自己的默认。 */
function numOpt(v: unknown): number | undefined { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined }
/** 钳制等待的结果：等到了给值；超时或对方自己失败都算「没等到」，调用方一律退老路。 */
type CapResult<T> = { ok: true; value: T } | { ok: false; timedOut?: true }
function withCap<T>(promise: Promise<T> | T, ms: number): Promise<CapResult<T>> {
  return Promise.race([
    Promise.resolve(promise).then(function (v): CapResult<T> { return { ok: true, value: v } }, function (): CapResult<T> { return { ok: false } }),
    new Promise<CapResult<T>>(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) }),
  ])
}
// 执行层失败与后端诚实失败的分界（见 issue-create.ts 同名注释）：前者抛给壳走
// backend-threw（可重试），后者走 PARTIAL/notes。钳制只管超时，不改判。
// 超时单列一支（kind 'timeout'）：它也是执行层失败，但机器可读的原因码走独立的
// backend-timeout（#1195），不再与真正的抛错共用 backend-threw。
const TRANSPORT_KINDS: readonly string[] = ['backend-threw', 'aborted', 'over-budget']
/** 后端回包在契约层还没建模：这里只按本工具真正会读的那一个字段收口，调用处拿断言喂进来（断言不产码）。 */
type TransportResult = { error?: { kind?: string; message?: unknown } } | null | undefined
/** 后端回包里「执行层失败」的原话；不是执行层失败（后端诚实地说做不到）就回 null，一个字不改判。 */
function transportMessage(result: TransportResult): string | null {
  const e = result && result.error
  if (e && TRANSPORT_KINDS.indexOf(e.kind as string) >= 0) return String(e.message || '执行层没回来')
  return null
}
/** 超时那一支的原话（kind 'timeout'）：调用处直接回独立原因码，不抛给壳。 */
function timeoutMessage(result: TransportResult): string | null {
  const e = result && result.error
  if (e && e.kind === 'timeout') return String(e.message || '执行层没回来')
  return null
}

/**
 * 装配层注入的依赖袋。壳要用的键原样透传（没列的键也一律接受：壳自己还没标类型，这一层不替它把关）；
 * 列出来的是本工具自己会读的那几个，缺席时各自退默认。
 */
export interface DeckContextDeps {
  readonly [key: string]: unknown
  /** 沙箱许可策略：给工作区与会话，回这一轮的策略快照；等不到就当没有（不拦事）。两个值原样传，可能还没有。 */
  sandboxPolicyFor?: (arg: { cwd: string | undefined; sessionId: string | undefined }) => Promise<unknown>
  /** 时钟旁路：测试里换假时钟用，缺省 Date.now。 */
  now?: () => number
}

/** 工具定义（唯一事实）：路由、参数名与给 AI 看的那句话都从这里出，别在别处再抄一份。 */
export const definition = {
  name: 'deck_context',
  description: '这是 dsh-mattpocock-skills-deck 插件提供的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo。你要创建、查看、更新 ISSUE，查看 map 与 progress 时，先调用 deck_context 一次，确认 workspace 与 backend；如果 repo 里的说法和这里写的不一样，以这里写的为准。如果 deck_context 返回这个 workspace 还没有选 backend，或拿不到 workspace，就说明本插件不适用这个 workspace，直接停下，不再调用其余 deck 开头的工具，后续怎么做由用户决定。',
  // 参数说明不进描述（描述会进所有会话的系统提示）：本工具不要参数，语义全在返回值里。
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}

/** 给人看的用法说明里所有后端共用的那 381 字：改一个字就是行为变更，非本地后端原样回这一句。 */
const BASE_HOWTO = '写票之前先用本工具确认工作区与后端；建票用 deck_issue_create，建整张地图骨架用 deck_map_plan_create，补边用 deck_map_link，改票用 deck_issue_patch，上报当前在办哪张票用 deck_issue_report，读一张票用 deck_issue_get，看一张地图的全部子票用 deck_map_snapshot，按状态与 label 和 assignee 列薄行用 deck_issue_list。要快数：扫数先用 deck_issue_list 薄行；单票反向边不急就 deck_issue_get 传 blocking=false（跳过一次全仓扫描）；子票清单要全不断就 deck_map_snapshot 传 detail=thin（统计不变）。工作区与仓库不接受参数：它们只从当前会话取。'

/** 本地后端才追加的那一段建票契约：票就是工作区里的文件，规格与实施票都走 deck 工具，不手写票文件。 */
const LOCAL_HOWTO_SUFFIX = '本地后端补一条建票契约：票就是工作区里的文件；规格就是票（kind=spec，顶层容器，不挂地图、不传 parentKey）；实施票用 deck_issue_create 建（kind=spec-ticket，parentKey 填规格票号，blockedBy 填依赖）；地图下的工单用 kind=map-ticket 并给一枚 label（wayfinder:research / wayfinder:prototype / wayfinder:grilling / wayfinder:task），parentKey 填探索地图；普通票用 kind=issue（万能兜底），缺陷用 kind=bug；补边用 deck_map_link，改票用 deck_issue_patch，认领会写 Assignees 行；不要手写票文件（不要自己写 .scratch 下的文件），技能原文若让你手写，以上面这段用法说明为准。'

/**
 * 按后端 id 算出用法说明（纯函数：同一个后端 id 永远回同样的话）。
 *
 * 取舍：后端专属的用法说明本应住在每个后端自己的声明里，由后端自己报出 prompts 数据，deck 层只负责透出。
 * 但 deck 层现在拿不到后端的 prompts 数据（装配层没有把那份数据递进来），所以这次先在 context.ts 里按后端分叉：
 * 票就存在工作区文件里的那一种后端（本地文件后端）追加建票契约，其它后端原样回改前的那句话。
 * 将来装配层能把后端声明递进来时，把这段本地契约搬到后端声明里，context.ts 只做透出，不再自己看后端是谁。
 * 本地文件后端的判断复用共享层的具名判断（不用在这里写后端 id 的等值比较，门禁也不许写）。
 */
export function howtoFor(backendId: string | null | undefined): string {
  const id = (typeof backendId === 'string') ? backendId : ''
  if (knownWritePermissions(id) !== null) return BASE_HOWTO + LOCAL_HOWTO_SUFFIX
  return BASE_HOWTO
}

/** 一张地图在清单里长什么样（只放人需要的那几格，正文不进清单；票本身没有层级格，不带它——带空值整包会被外层拒收）。 */
function mapRow(issue: Record<string, unknown>) {
  return { key: issue.key, title: issue.title, state: issue.state, url: issue.url || '' }
}

/**
 * 装配层调一次，拿到这对 { definition, run }。deps 是宿主注入的依赖袋（见 DeckContextDeps），
 * 什么都不给也能跑：壳与这里的每一处都各自退默认。
 */
export function createDeckContext(deps?: DeckContextDeps) {
  const d: DeckContextDeps = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  /**
   * 跑一次：exec 是 DSH 给的执行上下文（会话与沙箱都从它取），args 是模型填的参数。
   * 本工具不收参数（见上面的 parameters），args 只原样交给成本估算。
   */
  async function run(exec: unknown, args: Record<string, unknown>): Promise<unknown> {
    // 预算起算点：入口前耗时（会话归一、选后端、探沙箱）也要算进预算（#1195）。
    const toolEntryAt = (typeof d.now === 'function') ? d.now() : Date.now()
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    const est = shell.estimateFor('deck_context', args)
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 在会话壳里是运行时布尔，
    // 那一层还没标类型，见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_context', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })

    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) {
      // 没有后端也不是一次失败：工作区解析结果照样回给 AI（它要靠这个知道该在面板上选什么）。
      return shell.unsupported('deck_context', pick.reason, pick.text, {
        workspace: { root: s.cwd, key: s.workspaceKey, sessionId: s.sessionId, source: s.source },
        backend: { id: null, source: '' },
        repo: null,
        cost: { estimated: est },
      })
    }
    const repo = shell.repoOf(pick, s)
    // 沙箱策略的快照：等不到（超时、对方失败、没注入）一律按「没有」往下走，与老口径同形。
    let sandbox: unknown = null
    try {
      if (typeof d.sandboxPolicyFor === 'function') {
        const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), DECK_SANDBOX_TIMEOUT_MS)
        sandbox = (raced && raced.ok === true) ? raced.value : null
      }
    } catch (eS) { sandbox = null }

    return shell.call({ tool: 'deck_context', kind: 'read', session: s, pick: pick, repo: repo, estimate: est, sandbox: sandbox }, async (c: unknown) => {
      // 进预算壳 + 两路并行：预检与清单互相独立，之前串行要等两份慢调用，
      // 并行后只等较慢的那一份。回包的字段与 notes 顺序与之前一致。
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), startedAt: toolEntryAt, now: (typeof d.now === 'function') ? d.now : Date.now })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      const preP = (typeof t.preflight === 'function') ? t.preflight({ cwd: s.cwd }, opCtx) : Promise.resolve(null)
      const listP = t.list(repo, { type: 'map' }, opCtx)
      // #992：仓库写权限能力位（只读旁路，与预检/清单并行）。本地文件后端没有远端权限模型，
      //   由共享判断直接给「可写」（见 shared/tracker/backendWritePermissions.js）；其余后端问一遍
      //   写权限旁路，问不出来不拦事、按未知处理（GitLab 不实现这条旁路，诚实未知）。
      const knownPerm = knownWritePermissions(pick.backendId)
      const wantPerms = !knownPerm && typeof t.getRepoPermissions === 'function' && !sc.outOfBudget()
      const permP = wantPerms ? t.getRepoPermissions(repo, opCtx) : Promise.resolve(null)
      const pre = await preP
      const listed = await listP
      const perm = await permP
      const preTimeout = timeoutMessage(pre as TransportResult)
      if (preTimeout) return {
        value: {
          status: DECK_STATUS.UNSUPPORTED,
          reason: REFUSAL_REASONS.BACKEND_TIMEOUT,
          text: '工作区这次没确认下来（超时了：在限时内没等到后端回话，这次读没动手，重调一次就行）。',
          data: { backendId: pick.backendId, error: { kind: 'timeout', message: preTimeout.slice(0, 300) } },
        },
        claimed: { requests: 3, points: 2 },
      }
      const preTransport = transportMessage(pre as TransportResult)
      if (preTransport) throw new Error(preTransport)
      const listedTimeout = timeoutMessage(listed as TransportResult)
      if (listedTimeout) return {
        value: {
          status: DECK_STATUS.UNSUPPORTED,
          reason: REFUSAL_REASONS.BACKEND_TIMEOUT,
          text: '地图清单这次没取到（超时了：在限时内没等到后端回话，这次读没动手，重调一次就行）。',
          data: { backendId: pick.backendId, error: { kind: 'timeout', message: listedTimeout.slice(0, 300) } },
        },
        claimed: { requests: 3, points: 2 },
      }
      const listedTransport = transportMessage(listed as TransportResult)
      if (listedTransport) throw new Error(listedTransport)
      const permTimeout = timeoutMessage(perm as TransportResult)
      if (permTimeout) return {
        value: {
          status: DECK_STATUS.UNSUPPORTED,
          reason: REFUSAL_REASONS.BACKEND_TIMEOUT,
          text: '写权限那一问超时了：在限时内没等到后端回话，这次读没动手，重调一次就行。',
          data: { backendId: pick.backendId, error: { kind: 'timeout', message: permTimeout.slice(0, 300) } },
        },
        claimed: { requests: 3, points: 2 },
      }
      const permTransport = transportMessage(perm as TransportResult)
      if (permTransport) throw new Error(permTransport)
      const maps = (listed.ok && Array.isArray(listed.data)) ? listed.data.map(mapRow) : []
      // 能力位：本地文件后端恒可写（本地文件可写性归 md:scratchWritable 管，这里不重复判）；
      //   其余后端问到了用真值，问不到按未知（不捏造）。
      let permissions = null
      if (knownPerm) permissions = knownPerm
      else if (perm && perm.ok === true && perm.data && typeof perm.data.push === 'boolean' && typeof perm.data.triage === 'boolean') {
        permissions = { push: perm.data.push, triage: perm.data.triage }
      } else permissions = { unknown: true }
      const notes = []
      if (!listed.ok) notes.push('地图清单这次没取到（后端原话：' + String((listed.error && listed.error.message) || '').slice(0, 200) + '）。')
      if (pre && pre.ok === false) notes.push('环境预检没过（' + String((pre.error && pre.error.message) || '').slice(0, 200) + '）：票还是能读，写操作可能失败。')
      if (permissions && permissions.push === false) {
        notes.push('这个仓库只读：标签与写操作不可用。')
        notes.push('要在只读库上长期协作，建议先 fork 到自己名下，再把工作区 origin 指向 fork（插件只认 origin，不代改配置）。')
      }
      const status = listed.ok ? DECK_STATUS.OK : DECK_STATUS.PARTIAL
      return {
        value: {
          status: status,
          reason: listed.ok ? '' : REFUSAL_REASONS.BACKEND_UNSUPPORTED,
          text: '这里是 ' + s.cwd + '，后端 ' + pick.backendId + '（' + pick.source + '，用户手动选择 > 锚文件 > 自动识别），仓库 ' + (repo.refId || '（这个后端没有仓库标识）') + '，地图 ' + maps.length + ' 张。',
          data: {
            workspace: { root: s.cwd, key: s.workspaceKey, sessionId: s.sessionId, source: s.source },
            backend: { id: pick.backendId, source: pick.source, label: '' },
            repo: { backend: repo.backend, refId: repo.refId, name: repo.name, url: repo.url, permissions: permissions },
            initialized: pre ? pre.ok === true : null,
            preflight: pre ? { ok: pre.ok === true, message: String((pre.error && pre.error.message) || '').slice(0, 300) } : null,
            maps: maps,
            // 这一句是给 AI 的用法说明（描述只有路由，语义放这里；本地后端追加建票契约，见上面 howtoFor）。
            howto: howtoFor(pick.backendId),
            quota: { perCallPoints: budget.AI_TOOL_MAX_POINTS_PER_CALL, perCallRequests: budget.AI_TOOL_MAX_REQUESTS_PER_CALL, perHourPoints: budget.AI_TOOL_MAX_POINTS_PER_HOUR, perHourRequests: budget.AI_TOOL_MAX_REQUESTS_PER_HOUR, maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL },
          },
          notes: notes,
          touched: [],
        },
        claimed: { requests: 3, points: 2 },
      }
    })
  }

  return { definition: definition, run: run }
}
