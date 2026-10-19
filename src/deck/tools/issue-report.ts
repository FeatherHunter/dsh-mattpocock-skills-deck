// src/deck/tools/issue-report.ts —— deck_issue_report（#775 落地；#1019 换到新树、#1035 转 TypeScript）
//
// AI 主动上报自己在办哪张票：票号必填、可选带一句备注；上报成功后在回执 data.workRoute
// 里能看到工作路线（界面面板的读数待 #1263 重接新读出口）；三后端诚实失败。
//
// 薄壳四条照旧（shell.js）：过闸、走注册表选后端、只从会话取工作区、永不抛。
// 工作路线由工具壳在成功收口处统一记（#1261 起步、#1262 铺满五个写工具：动作 report、
// 来源 reported；去重键是 (会话, 票)，同一会话同一票后来居上）。本工具自己不再记。
// 票存在性经 tracker.get 校验一遍：读不到就诚实失败，不记路线。
// 本地后端多工作单元时用 effortId 指到那一个目录（根目录的不填）；远端后端忽略它。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { withCallScope } from '../shell/call-budget.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { DECK_SANDBOX_TIMEOUT_MS } from '../../shared/time-config/values.js'

/** 数字型参数的统一收口：正的有限数才要（取整），其余一律当「没给」，调用方退自己的默认。 */
function numOpt(v: unknown): number | undefined { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined }
/** 钳制等待的结果：等到了给值；超时或对方自己失败都算「没等到」，调用方一律退老路。 */
type CapResult<T> = { ok: true; value: T } | { ok: false; timedOut?: true }
// 沙箱许可等待上限：对手是挂住的会话服务。超时按缺席走老路（不限权），与既有 catch null 同形。
function withCap<T>(promise: Promise<T> | T, ms: number): Promise<CapResult<T>> {
  return Promise.race([
    Promise.resolve(promise).then(function (v): CapResult<T> { return { ok: true, value: v } }, function (): CapResult<T> { return { ok: false } }),
    new Promise<CapResult<T>>(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) }),
  ])
}
// 执行层失败与后端诚实失败的分界（见 issue-create.ts 同名注释）：前者抛给壳走
// backend-threw（可重试），后者走 BACKEND_UNSUPPORTED。钳制只管超时，不改判。
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
 * 列出来的是本工具自己会调到的那几个，缺席时各自退默认：没有沙箱策略就跳过那一步等待，没有时钟就用 Date.now。
 */
export interface DeckIssueReportDeps {
  readonly [key: string]: unknown
  /** 沙箱许可策略：给工作区与会话，回这一轮的策略快照；等不到就当没有（不拦事）。
   *  两个值都按会话壳给的原样传（工作区没定下来时可能还没有），不许在这里补空串或假目录。 */
  sandboxPolicyFor?: (arg: { cwd: string | undefined; sessionId: string | undefined }) => Promise<unknown>
  /** 时钟旁路：测试里换成假时钟用，缺省 Date.now。 */
  now?: () => number
}

/** 工具定义（唯一事实）：路由、参数名与给 AI 看的那句话都从这里出，别在别处再抄一份。 */
export const definition = {
  name: 'deck_issue_report',
  description: '同属插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；先调 deck_context 确认 workspace 与 backend。开始处理、切换或完成一个 ISSUE 时都必须调用：开始前报一次，关闭时再报一次，这条是必选。职责划分：deck_issue_patch 负责变更 issue 内容，deck_issue_report 负责上报处理关系；用前者关闭 issue 不等价于已完成上报。key 填你要上报的 ISSUE 编号；只有本地后端需要填 effortId，填票所在目录名，根目录不填。有没有记上、记在哪里，看返回里的结果。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '你要上报的那个 ISSUE 的编号' },
      note: { type: 'string', description: '可选带一句备注（只回显，不进链）' },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    required: ['key'],
    additionalProperties: false,
  },
}

/** 票号归一：去掉开头的 #、丢掉前导零，只认 1 到 10 位数字，别的（含没给）一律当空。 */
function normKey(raw: unknown): string {
  const t = String(raw === undefined || raw === null ? '' : raw).trim().replace(/^#/, '')
  if (!/^\d{1,10}$/.test(t)) return ''
  return t.replace(/^0+(?=\d)/, '')
}

/** 工作单元的目录名归一：没给就当空串（空串表示根目录，不是「根目录」这三个字）。 */
function normEffort(raw: unknown): string {
  if (raw === undefined || raw === null) return ''
  return String(raw).trim()
}

/**
 * 装配层调一次，拿到这对 { definition, run }。deps 是宿主注入的依赖袋（见 DeckIssueReportDeps），
 * 什么都不给也能跑：壳与这里的每一处都各自退默认。
 */
export function createDeckIssueReport(deps?: DeckIssueReportDeps) {
  const d: DeckIssueReportDeps = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  /**
   * 跑一次：exec 是 DSH 给的执行上下文（会话与沙箱都从它取），args 是模型填的参数。
   * 参数先当「未知」再逐项收口（key / effortId / note 下面各收一次），回执形状由壳统一渲染。
   */
  async function run(exec: unknown, args: Record<string, unknown>): Promise<unknown> {
    // 预算起算点：入口前耗时（会话归一、选后端、探沙箱）也要算进预算（#1195）。
    const toolEntryAt = (typeof d.now === 'function') ? d.now() : Date.now()
    const a: Record<string, unknown> = args || {}
    const key = normKey(a.key)
    const est = shell.estimateFor('deck_issue_report', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 在会话壳里是运行时布尔，
    // 那一层还没标类型，见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_issue_report', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })
    if (!key) return shell.unsupported('deck_issue_report', REFUSAL_REASONS.BAD_ARGS, '要上报哪一张票：把票号写在 key 里（例如 775）。', { cost: { estimated: est } })
    const effortId = normEffort(a.effortId)
    const note = typeof a.note === 'string' ? a.note.trim().slice(0, 200) : ''

    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_issue_report', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    if (effortId) repo.effortId = effortId
    // 沙箱策略的快照：等不到（超时、对方失败、没注入）一律按「没有」往下走，与老口径同形。
    let sandbox: unknown = null
    try {
      if (typeof d.sandboxPolicyFor === 'function') {
        const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), DECK_SANDBOX_TIMEOUT_MS)
        sandbox = (raced && raced.ok === true) ? raced.value : null
      }
    } catch (eS) { sandbox = null }

    return shell.call({ tool: 'deck_issue_report', kind: 'write', session: s, pick: pick, repo: repo, estimate: est, sandbox: sandbox }, async (c: unknown) => {
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), startedAt: toolEntryAt, now: (typeof d.now === 'function') ? d.now : Date.now })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      const notes = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
      if (note) notes.push('备注只回显，不记进工作路线（路线上每条只留票键、时间与动作类别）。')
      const got = typeof t.get === 'function' ? await t.get(repo, key, { comments: { first: 0 } }, opCtx) : null
      const gotTimeout = timeoutMessage(got as TransportResult)
      if (gotTimeout) return {
        value: {
          status: DECK_STATUS.UNSUPPORTED,
          reason: REFUSAL_REASONS.BACKEND_TIMEOUT,
          text: '这张票这次没上报（超时了：在限时内没等到后端回话，票有没有记上说不清，重调一次就行）。',
          data: { key: key, backendId: pick.backendId, effortId: effortId, error: { kind: 'timeout', message: gotTimeout.slice(0, 300) } },
          notes: notes,
        },
        claimed: { requests: 1, points: 3 },
      }
      const gotTransport = transportMessage(got as TransportResult)
      if (gotTransport) throw new Error(gotTransport)
      if (!got || got.ok !== true) {
        const msg = String((got && got.error && got.error.message) || '后端没给出原因').slice(0, 300)
        return {
          value: {
            status: DECK_STATUS.UNSUPPORTED,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '这张票没上报（票 ' + key + ' 没读回来，后端原话：' + msg + '）。',
            data: { key: key, backendId: pick.backendId, effortId: effortId, error: { kind: String((got && got.error && got.error.kind) || ''), message: msg } },
            notes: notes,
          },
          claimed: { requests: 1, points: 3 },
        }
      }
      const issue = got.data || {}
      // 工作路线由工具壳在成功收口处统一记（#1262：五个写工具都记；本工具的动作 report、来源 reported），本工具不再显式记。
      const title = typeof issue.title === 'string' ? issue.title.slice(0, 80) : ''
      return {
        value: {
          status: DECK_STATUS.OK,
          text: '票 ' + key + ' 已上报（' + (title || '没取到标题') + '）' + (note ? '：' + note.slice(0, 80) : '') + '。在办表见回执 data.workRoute。',
          data: {
            key: key, title: title, state: issue.state || '', url: issue.url || '',
            backendId: pick.backendId, effortId: effortId || (issue.effortId !== undefined ? issue.effortId : ''),
            note: note,
          },
          notes: notes,
          touched: [],
        },
        claimed: { requests: 1, points: 3 },
      }
    })
  }

  return { definition: definition, run: run }
}
