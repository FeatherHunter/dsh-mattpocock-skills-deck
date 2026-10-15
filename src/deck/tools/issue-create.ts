// src/deck/tools/issue-create.ts —— deck_issue_create（#713 第六批；#1019 换到新树、#1035 转 TypeScript）
//
// 建一张票。三件小事由代码保证，不靠 AI 记得：
//   1. 必备标签（按种类：地图 wayfinder:map、任务 wayfinder:task、缺陷 bug + needs-triage）缺就补，
//      补没补上按结果说 —— 只读仓库上没挂上时不说“补了”，按部分成功回并写清原因（#992）；
//   2. 进度区（地图补五个区块，别的票补一个「## 进度」）；
//   3. 创建幂等锚（#711 的契约字段 idempotencyKey）：同一个会话、同一个标题、同一批标签在 5 分钟窗口里
//      重复调一次，契约层按锚回查，复用同一张票 —— 重试不会重复花钱，也不会多出票。
//
// 返回值就是**写后的真状态**（契约 create 回的那张票），AI 不必再读一次确认。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { classifyEdgeLanding, edgeVerdict, unsupportedEvidence, edgeEvidence } from '../shell/edge-landing.js'
import type { EdgeEvidence } from '../shell/edge-landing.js'
import { withCallScope } from '../shell/call-budget.js'
import { ensureLabels, ensureBody, anchorKeyFor } from '../shell/minimal-spec.js'
import * as budget from '../../shared/refresh/budget.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

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
const SANDBOX_TIMEOUT_MS = 5000
const HOOK_TIMEOUT_MS = 5000
// 执行层失败（抛错/中止/预算耗尽）与后端诚实失败的分界：前者在进壳之前会直接抛到
// 壳的统一出口（reason=backend-threw，可重试），后者走逐项的 BACKEND_UNSUPPORTED（能力缺失，
// 不当成 transient 重试）。壳外新加的钳制不能把前者改判成后者，否则 AI 会放弃重试。
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

/** 落点证据函数的收口形状：第四个形参（额外字段）按可选算，其余与调用处传的三个实参一致。 */
type EdgeEvidenceFn = (op: unknown, target: unknown, evidence: unknown, extra?: unknown) => Record<string, unknown>

/**
 * 装配层注入的依赖袋。壳要用的键原样透传（没列的键也一律接受：壳自己还没标类型，这一层不替它把关）；
 * 列出来的是本工具自己会调到的那几个，缺席时各自退默认：没有沙箱策略就跳过那一步等待，没有时钟就用 Date.now。
 */
export interface DeckIssueCreateDeps {
  readonly [key: string]: unknown
  /** 沙箱许可策略：给工作区与会话，回这一轮的策略快照；等不到就当没有（不拦事）。
   *  两个值都按会话壳给的原样传（工作区没定下来时可能还没有），不许在这里补空串或假目录。 */
  sandboxPolicyFor?: (arg: { cwd: string | undefined; sessionId: string | undefined }) => Promise<unknown>
  /** 时钟旁路：测试里换成假时钟用，缺省 Date.now。 */
  now?: () => number
  /** 建票直达命名守护（#746）：拿会话、票号与标题去落一次「这趟建的是哪张票」；
   *  钩子缺失、失败或超时都不影响已建成的返回，所以等它只是尽力而为。 */
  onTicketCreated?: (arg: { sessionId: string | undefined; key: string; title: string }) => Promise<unknown>
}

/** 工具定义（唯一事实）：路由、参数名与给 AI 看的那句话都从这里出，别在别处再抄一份。 */
export const definition = {
  name: 'deck_issue_create',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。建一个 ISSUE（map / task / bug），自动补必备 label 与 progress 区，重复调用按锚复用同一张。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '票的标题' },
      body: { type: 'string', description: '正文；缺省时按种类补最小骨架' },
      kind: { type: 'string', enum: ['task', 'bug', 'map'], description: '票的种类，缺省 task' },
      parentKey: { type: 'string', description: '父票（一般是地图那张票）的票号' },
      labels: { type: 'array', items: { type: 'string' }, description: '要带的标签，会在必备标签之外追加' },
      assignees: { type: 'array', items: { type: 'string' }, description: '认领人' },
      idempotencyKey: { type: 'string', description: '这一批写的幂等锚，重试时带同一个值' },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    required: ['title'],
    additionalProperties: false,
  },
}

/** 票的种类收口：只认 map 与 bug，其余（没给、给了别的词）一律当 task，与契约层的三种词一致。 */
function kindOf(a: Record<string, unknown>): string {
  const k = String((a && a.kind) || 'task').trim()
  return (k === 'map' || k === 'bug') ? k : 'task'
}

/**
 * 装配层调一次，拿到这对 { definition, run }。deps 是宿主注入的依赖袋（见 DeckIssueCreateDeps），
 * 什么都不给也能跑：壳与这里的每一处都各自退默认。
 */
export function createDeckIssueCreate(deps?: DeckIssueCreateDeps) {
  const d: DeckIssueCreateDeps = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  /**
   * 跑一次：exec 是 DSH 给的执行上下文（会话与沙箱都从它取），args 是模型填的参数。
   * 参数先当「未知」再逐项收口（title / kind / labels 下面各收一次），回执形状由壳统一渲染。
   */
  async function run(exec: unknown, args: Record<string, unknown>): Promise<unknown> {
    // 预算起算点：入口前耗时（会话归一、选后端、探沙箱）也要算进预算（#1195）。
    const toolEntryAt = (typeof d.now === 'function') ? d.now() : Date.now()
    const a: Record<string, unknown> = args || {}
    const title = String(a.title === undefined || a.title === null ? '' : a.title).trim()
    const kind = kindOf(a)
    const est = shell.estimateFor('deck_issue_create', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 在会话壳里是运行时布尔，
    // 那一层还没标类型，见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_issue_create', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })
    if (!title) return shell.unsupported('deck_issue_create', REFUSAL_REASONS.BAD_ARGS, '要建哪一张票：title 不能空。', { cost: { estimated: est } })

    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_issue_create', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const effortId = (a.effortId === undefined || a.effortId === null) ? '' : String(a.effortId).trim()
    if (effortId) repo.effortId = effortId

    const ensured = ensureLabels(a.labels, kind)
    const body = ensureBody(a.body, kind)
    const now = (typeof d.now === 'function') ? d.now() : Date.now()
    const anchor = a.idempotencyKey ? String(a.idempotencyKey) : anchorKeyFor({ tool: 'deck_issue_create', sessionId: s.sessionId, workspaceKey: s.workspaceKey, title: title, labels: ensured.labels, now: now })
    // 沙箱策略的快照：等不到（超时、对方失败、没注入）一律按「没有」往下走，与老口径同形。
    let sandbox: unknown = null
    try {
      if (typeof d.sandboxPolicyFor === 'function') {
        const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), SANDBOX_TIMEOUT_MS)
        sandbox = (raced && raced.ok === true) ? raced.value : null
      }
    } catch (eS) { sandbox = null }

    return shell.call({ tool: 'deck_issue_create', kind: 'write', session: s, pick: pick, repo: repo, estimate: est, sandbox: sandbox }, async (c: unknown) => {
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), startedAt: toolEntryAt, now: (typeof d.now === 'function') ? d.now : Date.now })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      const rel = (a.parentKey === undefined || a.parentKey === null || a.parentKey === '') ? null : String(a.parentKey)
      // 建票入参是本文件自己拼的，两个可选字段（parentKey / assignees）下面按条件补：
      // 先声明成一张表，补字段时编译器才不拦（运行时拼出来的形状一字不变）。
      const input: Record<string, unknown> = { title: title, body: body.body, type: kind, labels: ensured.labels, idempotencyKey: anchor }
      if (rel) input.parentKey = rel
      if (Array.isArray(a.assignees) && a.assignees.length) input.assignees = a.assignees
      const created = await t.create(repo, input, opCtx)
      const notes = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
      if (body.added.length) notes.push('我替你补了正文区块：' + body.added.join('、'))
      if (!a.idempotencyKey) notes.push('这次用的是自动幂等锚（同会话 + 同标题 + 同标签，5 分钟窗口内重复调用复用同一张票）。')
      // 执行层失败原样抛给壳（走 backend-threw，可重试）；后端诚实失败才走下面的部分成功。
      // 只有超时单列：直接回独立原因码 backend-timeout（是否生效说不清，重试前先核对）。
      const createdTimeout = timeoutMessage(created as TransportResult)
      if (createdTimeout) return {
        value: { status: DECK_STATUS.UNSUPPORTED, reason: REFUSAL_REASONS.BACKEND_TIMEOUT, text: '这张票这次没建成（超时了：在限时内没等到后端回话，票建上没有说不清；先按标题查一次再续，不要直接重建）。', data: { error: { kind: 'timeout', message: createdTimeout.slice(0, 300) } }, notes: notes },
        claimed: { requests: 1, points: 4 },
      }
      const createdTransport = transportMessage(created as TransportResult)
      if (createdTransport) throw new Error(createdTransport)
      if (!created || created.ok !== true) {
        const msg = String((created && created.error && created.error.message) || '后端没给出原因').slice(0, 300)
        return {
          value: { status: DECK_STATUS.UNSUPPORTED, reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED, text: '这张票没建成（后端原话：' + msg + '）。', data: { error: { kind: String((created && created.error && created.error.kind) || ''), message: msg } }, notes: notes },
          claimed: { requests: 1, points: 4 },
        }
      }
      const issue = created.data || {}
      // #992：标签没挂上（后端在票上记了 labelError）不再报“补了”——按结果说话。
      //   幂等锚的取值保持不动（改它会动去重语义，另议）。
      const labelFailed = !!(issue && issue.labelError)
      const labelWhy = labelFailed ? String((issue.labelError && issue.labelError.message) || '后端没给出原因').slice(0, 300) : ''
      if (ensured.added.length && !labelFailed) notes.push('我替你补了必备标签：' + ensured.added.join('、'))
      if (labelFailed) notes.push('标签没挂上，别把它当成已经打上：逐条原因在同包的 items 里。')
      // #746：建票直达命名守护（调用会话即建号会话；hook 缺失、失败或超时都不影响已建成的返回）。
      try {
        if (typeof d.onTicketCreated === 'function' && issue.key) {
          const raced = await withCap(d.onTicketCreated({ sessionId: s.sessionId, key: String(issue.key), title: title }), HOOK_TIMEOUT_MS)
          void raced
        }
      } catch (eHook) {}
      const items = []
      let parentLanded = true
      let parentEvidence = null
      // 父子边的判决（landed / not-landed / unconfirmed）要留到下面的回执抬头用，所以在块外先立一格。
      let parentVerdict = 'unconfirmed'
      if (rel) {
        // 父子边：写入已在 create 里做过（contract 的 parentKey 输入），这里只判它落上了没有。
        // #790 的教训：判据只有一条 —— 写后读回的结构字段里能看到这条父子（纯侧的 edgeVerdict）。
        //   建票回包里的 parentKey 是「这次写动作自称写了什么」，正文里出现票号是「作者写了这行字」，
        //   两者都不是「盘上有这条边」的证据；它们与读回不一致时按没挂上算，并把不一致写进证据里。
        const readBack = (typeof t.get === 'function' && !sc.outOfBudget()) ? await t.get(repo, issue.key, {}, opCtx) : null
        const after = (readBack && readBack.ok === true) ? { issue: readBack.data } : null
        let ev: EdgeEvidence = after ? classifyEdgeLanding('parent', rel, after) : unsupportedEvidence('写后没读回来，判不了这条父子落点')
        const verdict = edgeVerdict('parent', rel, after)
        parentVerdict = verdict
        parentLanded = verdict === 'landed'
        const landedKey = (after && after.issue && after.issue.parentKey !== undefined && after.issue.parentKey !== null) ? String(after.issue.parentKey) : ''
        const createdKey = (issue && issue.parentKey !== undefined && issue.parentKey !== null) ? String(issue.parentKey) : ''
        const createdError = (issue && issue.parentError && issue.parentError.message) ? String(issue.parentError.message).slice(0, 200) : ''
        if (!parentLanded) {
          const echo = (createdKey === String(rel))
            ? '；建票回包里写着父票 ' + createdKey + '，但写后读回里没有这条父子 —— 回包是写动作的自述，不算落上'
            : ''
          const roomWords = createdError ? '；房自己记下的原话：' + createdError : ''
          const base = (verdict === 'unconfirmed')
            ? '写后没读回来，判不了这条父子落上了没有'
            : ('写后读回：票的 parentKey 读到的是 ' + (landedKey || '空') + '，要的是 ' + rel)
          ev = { kind: verdict === 'unconfirmed' ? 'unknown' : 'missing', ok: false, text: base + echo + roomWords + '。' + String(ev.text || '') }
        }
        parentEvidence = ev
        // 落点证据那一支：壳那层还没标类型（见 #1040），第四个形参（额外字段）本文件本来就没传，
        // 断言只为把「可选」告诉编译器，编译后这条语句与老写法逐字相同。
        items.push(Object.assign({ key: issue.key, edge: { op: 'parent', target: rel }, status: parentLanded ? 'ok' : 'failed' }, (edgeEvidence as EdgeEvidenceFn)('parent', rel, ev)))
      }
      if (rel && !parentLanded) {
        // 票建成了、边没挂上：按部分成功回，不再报“建好了（父票 X）”。
        const why = String((parentEvidence && parentEvidence.text) || '后端没给出原因').slice(0, 300)
        // 「没挂上」与「没读回来、判不了」是两件事，抬头那句话也要分开说（#790 审查指出：
        // 同一个「父子边没挂上（要 X）」在两种判决下都出现，H 节的正则分不出来）。
        const edgeHead = (parentVerdict === 'unconfirmed')
          ? '父子边没确认（要 ' + rel + '）'
          : '父子边没挂上（要 ' + rel + '）'
        notes.push('父子边没建成，别把它当成已经挂上：逐条原因在上面的 items 里。')
        if (labelFailed) items.push({ key: issue.key, step: 'labels', status: 'failed', reason: labelWhy })
        return {
          value: {
            status: DECK_STATUS.PARTIAL,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '票 ' + (issue.key || '（后端没回票号）') + ' 建好了：' + title + '。' + edgeHead + '：' + why
              + (labelFailed ? '标签也没挂上：' + labelWhy : ''),
            data: { ticket: issue, kind: kind, idempotencyKey: anchor, limits: { maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL } },
            items: items,
            notes: notes,
            touched: issue.key ? [String(issue.key)] : [],
          },
          claimed: { requests: 3, points: 6 },
        }
      }
      if (labelFailed) {
        // 票建成了、标签没挂上：按部分成功回（照父子边没挂上的 PARTIAL 先例），不再报“我替你补了”。
        items.push({ key: issue.key, step: 'labels', status: 'failed', reason: labelWhy })
        return {
          value: {
            status: DECK_STATUS.PARTIAL,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '票 ' + (issue.key || '（后端没回票号）') + ' 建好了：' + title + '。标签没挂上：' + labelWhy,
            data: { ticket: issue, kind: kind, idempotencyKey: anchor, limits: { maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL } },
            items: items,
            notes: notes,
            touched: issue.key ? [String(issue.key)] : [],
          },
          claimed: { requests: 3, points: 6 },
        }
      }
      return {
        value: {
          status: DECK_STATUS.OK,
          text: '票 ' + (issue.key || '（后端没回票号）') + ' 建好了：' + title + (rel ? '（父票 ' + rel + '）' : '') + '。返回值就是写后的真状态，不必再读一次。',
          data: { ticket: issue, kind: kind, idempotencyKey: anchor, limits: { maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL } },
          items: items,
          notes: notes,
          touched: issue.key ? [String(issue.key)] : [],
        },
        claimed: { requests: rel ? 3 : 2, points: rel ? 6 : 4 },
      }
    })
  }

  return { definition: definition, run: run }
}
