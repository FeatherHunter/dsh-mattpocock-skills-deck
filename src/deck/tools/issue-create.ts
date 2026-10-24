// src/deck/tools/issue-create.ts —— deck_issue_create（#713 第六批；#1019 换到新树、#1035 转 TypeScript；#1091 加维护者原话）
//
// 建一张票。四件小事由代码保证，不靠 AI 记得：
//   1. 位置值先收口（#1403 的两层词表）：kind 必填六个位置值，地图工单还要 label 四选一；
//      旧的 task / ticket 直接拒绝并给迁移路径，不再悄悄回落成任务票；
//   2. 必备标签（按位置表：地图 wayfinder:map、地图工单是 label 那一枚、规格与实施票 ready-for-agent、
//      缺陷 bug + needs-triage、普通票不补）缺就补，补没补上按结果说 —— 只读仓库上没挂上时不说“补了”，
//      按部分成功回并写清原因（#992）；
//   3. 进度区（地图先补五个区块，所有位置值再补一个「## 进度」）；
//   4. 创建幂等锚（#711 的契约字段 idempotencyKey）：同一个会话、同一个标题、同一批标签在 5 分钟窗口里
//      重复调一次，契约层按锚回查，复用同一张票 —— 重试不会重复花钱，也不会多出票。
//
// #1091：带 originalWords 时把维护者原话一字不改写进正文的「## 维护者原话」区（位置规则在 shared 层），
// 建完再读回核对一遍：建票回包是写动作的自述，不算「已经写好」。
//
// 返回值就是**写后的真状态**（契约 create 回的那张票），AI 不必再读一次确认。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { applyMdScope, mdScopeNote } from './md-scope.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { callDeckSession, openDeckSession } from './tracker-session.js'
import { applyBlockEdges, classifyEdgeLanding, edgeVerdict, unsupportedEvidence, edgeEvidence } from '../shell/edge-landing.js'
import type { EdgeEvidence } from '../shell/edge-landing.js'
import { withCallScope } from '../../refresh/rooms/host/tool-call-budget-enforcement.js'
import { ensureLabels, ensureBody, anchorKeyFor } from '../shell/minimal-spec.js'
// #1403：位置值到契约类型 / 类型标签 / 正文标记 / 父票规则的唯一答案在这张表里（src/deck/rules/object-kind.ts）。
import { resolveCreateKind } from '../rules/object-kind.js'
// #1195：执行层失败（抛错 / 中止 / 超时 / 预算耗尽）的收口从两个写工具里抽出来共用，判据一字未改。
import { numOpt, timeoutMessage, transportMessage, withCap } from '../shell/backend-transport.js'
import type { TransportResult } from '../shell/backend-transport.js'
// #1277：规格与实施票的票面对象类型标记（唯一真源，ADR 2.5）。标记由本工具写进正文最前面；
// 后端建房时再把它挪进文件头，#1403 读侧统一后三个后端都按文件头认这份标记。
import { markerKindAtStart, markerKindInHeader, markerLineFor } from '../../shared/issue-file/src/marker.js'
// #1091：维护者原话的入参收口与「追加 + 写后核对」都住在 shared 层（与 #1090 的进度区同一套形态）。
import { PROGRESS_BODY_LIMIT } from '../../shared/issue-file/src/progress.js'
import type { OriginalWordsEntry } from '../../shared/issue-file/src/original-words.js'
import { originalWordsFromArg } from '../../shared/issue-file/src/original-words-tool.js'
import { bodyWriteFields, bodyWriteReadbackProblem, planBodyWrite } from '../shell/body-write.js'
import type { BodyWritePlan } from '../shell/body-write.js'
import * as budget from '../../refresh/kernel/host-budget.js'
import { estimateToolCost, toolCostInputFrom } from '../../refresh/kernel/tool-call-budget.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { DECK_SANDBOX_TIMEOUT_MS, DECK_HOOK_TIMEOUT_MS } from '../../shared/time-config/src/values.js'
// 工具定义（唯一事实）搬去了同目录的 issue-create-parts.ts：只为把本文件压回 350 行有效行以内，
// 参数表、枚举值与描述文案一字未改（模型看到的工具面与拆之前完全一致）。
import { definition } from './issue-create-parts.js'

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

// 工具定义住在同目录的 issue-create-parts.ts：这里把它原样转出去，
// 所以从本模块取 definition 的调用方（装配层与各道门禁）一个字都不用改。
export { definition }

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
    const est = shell.estimateFor('deck_issue_create', a)
    // #1403：位置值先收口 —— kind 必填、label 只给地图工单、labels 里不许重复表达类型、顶层容器不收父票、
    // 子票必须带父票。收不成就回一句人话，把合法值与迁移路径写清楚；这一步不碰后端、不花请求。
    const argued = resolveCreateKind({ kind: a.kind, label: a.label, labels: a.labels, parentKey: a.parentKey })
    if (!argued.ok) {
      return shell.unsupported('deck_issue_create', REFUSAL_REASONS.BAD_ARGS, String(argued.problem || '建票参数不对。') + '这张票没建。', { cost: { estimated: est } })
    }
    // 收口之后这几个值一定在；写成带缺省的形式只是为了让编译器安静，运行时分支进不来。
    const kind = String(argued.kind || '')
    const contractType = String(argued.contractType || 'issue')
    const markerValue = String(argued.marker || '')
    const parentRule = String(argued.parent || 'optional')
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 在会话壳里是运行时布尔，
    // 那一层还没标类型，见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_issue_create', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })
    if (!title) return shell.unsupported('deck_issue_create', REFUSAL_REASONS.BAD_ARGS, '要建哪一张票：title 不能空。', { cost: { estimated: est } })
    // #1299：建票时顺手把阻塞边一起写掉 —— 拆票那一步最容易漏的就是边，入参一次给全比等 AI 记得再补强。
    // 形状与 deck_map_link 的 blockedBy 一致：元素是票号或 key（'#1298' 也认，去掉 # 再走），去重后按整批替换。
    // 字符集先挡一道：只收本仓库内票号（数字，或本地后端的字母数字 key），别把别的仓库的票号写成原生边。
    const blockedRaw: unknown = (a.blockedBy === undefined || a.blockedBy === null) ? [] : a.blockedBy
    const blockedKeys: string[] = []
    if (!Array.isArray(blockedRaw)) {
      return shell.unsupported('deck_issue_create', REFUSAL_REASONS.BAD_ARGS, 'blockedBy 要写成数组：元素是挡住这张票的票号（例如 ["1298"]）。', { cost: { estimated: est } })
    }
    {
      const seen: Record<string, true> = {}
      for (let i = 0; i < blockedRaw.length; i += 1) {
        const raw = blockedRaw[i]
        if (raw === undefined || raw === null) continue
        if (typeof raw !== 'string' && typeof raw !== 'number') {
          return shell.unsupported('deck_issue_create', REFUSAL_REASONS.BAD_ARGS, 'blockedBy 里的票号要写成字符串或数字（第 ' + (i + 1) + ' 个不是）。', { cost: { estimated: est } })
        }
        const k = String(raw).trim().replace(/^#/, '')
        if (!k) continue
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(k)) {
          return shell.unsupported('deck_issue_create', REFUSAL_REASONS.BAD_ARGS, 'blockedBy 里的「' + k.slice(0, 40) + '」不是本仓库内的票号：只填票号或 key（例如 "1298"）。', { cost: { estimated: est } })
        }
        if (seen[k]) continue
        seen[k] = true
        blockedKeys.push(k)
      }
    }

    const pick = await openDeckSession({ deps: d, exec: exec, session: s, estimate: est, tool: 'deck_issue_create', kind: 'write' })
    if (!pick.ok) return shell.unsupported('deck_issue_create', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const scope = applyMdScope(repo, a)
    if (!scope.ok) return shell.unsupported('deck_issue_create', REFUSAL_REASONS.BAD_ARGS, scope.message, { cost: { estimated: est } })

    // 标签按位置表补：地图工单补的是 label 那一枚，规格与实施票补 ready-for-agent，普通票一枚都不补。
    const ensured = ensureLabels(argued.labels, kind, argued.label)
    const body = ensureBody(a.body, kind)
    // #1091：维护者原话收口要赶在建票之前 —— 收不成、或正文会超过 60KB 时，这张票不建（一个字都不动）。
    let originalWords: OriginalWordsEntry | null = null
    if (a.originalWords !== undefined && a.originalWords !== null) {
      const parsed = originalWordsFromArg(a.originalWords)
      if (parsed.entry === null) {
        return shell.unsupported('deck_issue_create', REFUSAL_REASONS.BAD_ARGS, parsed.problem + '这张票没建。', { cost: { estimated: est } })
      }
      originalWords = parsed.entry
    }
    // #1403：对象类型标记只给 spec 与 spec-ticket 写（标记值来自位置表），落在正文文件头、一级标题之前；
    // map-ticket / bug / issue 一律不写标记。调用方正文里已经带了同一行时不再重复写。
    if (markerValue) {
      const markerLine = markerLineFor(markerValue)
      if (markerLine && markerKindAtStart(body.body) === null) body.body = markerLine + body.body
    }
    // #1091：原话区按「紧跟目的 / 正文最前」的规则追加；正文头部注释与一级标题会被跳过（shared 层判的）。
    let bodyPlan: BodyWritePlan | null = null
    if (originalWords) {
      const planned = planBodyWrite(body.body, null, originalWords, PROGRESS_BODY_LIMIT)
      if (planned.plan === null) {
        return shell.unsupported('deck_issue_create', REFUSAL_REASONS.BAD_ARGS, planned.problem + '这张票没建。', { cost: { estimated: est } })
      }
      bodyPlan = planned.plan
      body.body = bodyPlan.next
    }
    const now = (typeof d.now === 'function') ? d.now() : Date.now()
    const anchor = a.idempotencyKey ? String(a.idempotencyKey) : anchorKeyFor({ tool: 'deck_issue_create', sessionId: s.sessionId, workspaceKey: s.workspaceKey, title: title, labels: ensured.labels, now: now })
    // 沙箱策略的快照：等不到（超时、对方失败、没注入）一律按「没有」往下走，与老口径同形。
    let sandbox: unknown = null
    try {
      if (typeof d.sandboxPolicyFor === 'function') {
        const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), DECK_SANDBOX_TIMEOUT_MS)
        sandbox = (raced && raced.ok === true) ? raced.value : null
      }
    } catch (eS) { sandbox = null }

    return callDeckSession({ deps: d, opened: pick, session: s, repo: repo, estimate: est, tool: 'deck_issue_create', sandbox: sandbox }, async (c: unknown) => {
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), startedAt: toolEntryAt, now: (typeof d.now === 'function') ? d.now : Date.now })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      const rel = (a.parentKey === undefined || a.parentKey === null || a.parentKey === '') ? null : String(a.parentKey)
      // 回执的 notes 要能装「父票只核了存在性」这类降级说明，所以在建票之前就立起来。
      const notes: string[] = []
      // #1403：父票先核一遍再建票。位置表只说「该不该有父票」，父票到底是不是对的容器要读盘才知道：
      //   能读到契约类型（map / spec / issue）就核类型；后端没回类型字段时只核存在性，并在回执如实写降级说明；
      //   读不到（不存在 / 超时 / 额度不够）就拒绝，不建一张挂错位置的票。
      // 这一读是一次出站请求（1 条 2 点），成功路径的点数账在下面 parentCheck 里。
      let parentCheck = { requests: 0, points: 0 }
      if (rel) {
        parentCheck = { requests: 1, points: 2 }
        const refuse = (text: string, claimed: { requests: number, points: number }) => ({
          value: { status: DECK_STATUS.UNSUPPORTED, reason: REFUSAL_REASONS.BAD_ARGS, text: text, data: { error: { kind: 'parent', message: text.slice(0, 300) } }, notes: notes },
          claimed: claimed,
        })
        if (sc.outOfBudget()) return refuse('额度不够，没读父票：这张票没建。先核对父票号，再续。', { requests: 0, points: 0 })
        const parentRead = await t.get(repo, rel, {}, opCtx)
        const parentTimeout = timeoutMessage(parentRead as TransportResult)
        if (parentTimeout) return refuse('父票 ' + rel + ' 没读回来（超时：' + String(parentTimeout).slice(0, 160) + '）：这张票没建。先按票号核对父票，再续。', parentCheck)
        if (!parentRead || parentRead.ok !== true) {
          const why = String((parentRead && parentRead.error && parentRead.error.message) || '后端没给出原因').slice(0, 200)
          return refuse('父票 ' + rel + ' 读不到（后端原话：' + why + '）：这张票没建。父票必须已经存在。', parentCheck)
        }
        const parentData = (parentRead.data || {}) as Record<string, unknown>
        const declaredType = (typeof parentData.type === 'string') ? String(parentData.type) : ''
        const parentBody = (typeof parentData.body === 'string') ? parentData.body : ''
        const declaredMarker = markerKindInHeader(parentBody)
        // 契约类型优先；后端没回类型字段时退回票面标记（T1 的读侧判据），两个都没有才算「读不到类型」。
        const parentKind = declaredType || (declaredMarker === 'map' ? 'map' : declaredMarker === 'spec' ? 'spec' : (declaredMarker ? 'issue' : ''))
        if (!parentKind) {
          notes.push('父票类型读不到，只核了存在性：父票 ' + rel + ' 已经在了，但它是不是该有的容器没法确认。')
        } else if (parentRule === 'map') {
          if (parentKind !== 'map') return refuse('父票 ' + rel + ' 不是探索地图（读到的是 ' + parentKind + '）：地图工单的父必须是探索地图。这张票没建。', parentCheck)
        } else if (parentRule === 'spec') {
          if (parentKind !== 'spec') return refuse('父票 ' + rel + ' 不是规格（读到的是 ' + parentKind + '）：实施票的父必须是规格。这张票没建。', parentCheck)
        } else if (parentKind !== 'map' && parentKind !== 'spec') {
          return refuse('父票 ' + rel + ' 不是探索地图或规格（读到的是 ' + parentKind + '）：普通票的父只能是这两种容器。这张票没建。', parentCheck)
        } else {
          notes.push('父票 ' + rel + ' 已核对：它是' + (parentKind === 'map' ? '探索地图' : '规格') + '。')
        }
      }
      // 建票入参是本文件自己拼的，两个可选字段（parentKey / assignees）下面按条件补：
      // 先声明成一张表，补字段时编译器才不拦（运行时拼出来的形状一字不变）。
      // 调后端传的是契约三值（位置表算好的 contractType），不是位置值本身。
      // typeLine 是本地 markdown 文件头 Type 行该写什么：地图工单写 label 去前缀的那一个，其余位置明确给空串；
      // 远端后端不读它，契约类型仍由 type 走。给空串是为了让「issue 兜底也带了 wayfinder 标签」不会漏成 Type 行。
      const typeLine = kind === 'map-ticket' ? String(argued.label || '').replace(/^wayfinder:/, '') : ''
      const input: Record<string, unknown> = { title: title, body: body.body, type: contractType, typeLine: typeLine, labels: ensured.labels, idempotencyKey: anchor }
      if (rel) input.parentKey = rel
      if (Array.isArray(a.assignees) && a.assignees.length) input.assignees = a.assignees
      const created = await t.create(repo, input, opCtx)
      if (scope.effortId) notes.push(mdScopeNote(scope.scene, scope.effortId))
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
          const raced = await withCap(d.onTicketCreated({ sessionId: s.sessionId, key: String(issue.key), title: title }), DECK_HOOK_TIMEOUT_MS)
          void raced
        }
      } catch (eHook) {}
      const items = []
      // #1091：原话写后核对。建票回包是写动作的自述，不算数；要读回来逐字相同才算写好。
      // 这一段与进度区（#1090）同一套口径：额度不够、读不回来、对不上，都逐项记失败并说「别当成已经写好」。
      let originalProblem = ''
      if (bodyPlan !== null) {
        if (sc.outOfBudget()) originalProblem = '原话写动作回了成功，但剩余额度不够读回核对：别当成已经写好，稍后读一次现状确认。'
        else {
          const rawBack = await t.get(repo, String(issue.key || ''), {}, opCtx)
          const backTimeout = timeoutMessage(rawBack as TransportResult)
          const okBack = (rawBack && rawBack.ok === true) ? rawBack : null
          const backBody = (okBack && okBack.data && typeof okBack.data.body === 'string') ? okBack.data.body : null
          if (backTimeout) originalProblem = '原话写动作回了成功，但读回核对超时（' + String(backTimeout).slice(0, 160) + '）：别当成已经写好，稍后读一次现状确认。'
          else if (backBody === null) originalProblem = '原话写动作回了成功，但写后没读回正文（后端原话：' + String((rawBack && rawBack.error && rawBack.error.message) || '没给出原因').slice(0, 160) + '）：写进去的对不对不知道，别当成已经写好。'
          else originalProblem = bodyWriteReadbackProblem(bodyPlan, backBody)
        }
        if (originalProblem) items.push({ key: issue.key, step: 'text', status: 'failed', reason: originalProblem })
        else items.push({ key: issue.key, step: 'text', status: 'ok', fields: bodyWriteFields(bodyPlan), originalWords: originalWords })
      }
      // 原话写后核对多花的那一次读：一次读 + 2 点，与标签/认领/关闭的写后读回同价。
      const wordCost = bodyPlan ? { requests: 1, points: 2 } : { requests: 0, points: 0 }
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
      // #1299：阻塞边在票建成之后写（create 的入参里没有这一格）。语义与 deck_map_link 的 blockedBy 相同：
      //   整批替换。刚建出来的票上本来没有边，这一趟等价于「加上这批边」；幂等锚复用同一张票时，
      //   调用方给的就是它要的完整集合，重复写同一批不会越写越少。
      //   写不进不回滚票：票照建，边按部分成功逐条报（与父子边同一套口径），别让 AI 以为边已挂上。
      const blockWant = blockedKeys.filter(function (k) { return k !== String(issue.key || '') })
      const blockItems: Array<Record<string, unknown>> = []
      let blockFailed: string | null = null
      let blockAttempted = false
      if (blockWant.length) {
        blockAttempted = true
        if (sc.outOfBudget()) {
          blockFailed = '额度不够，这次没写'
          blockItems.push({ key: issue.key, edge: { op: 'block', target: blockWant.join('、') }, status: 'failed', reason: blockFailed })
        } else {
          const wrote = await applyBlockEdges(t, repo, opCtx, String(issue.key), blockWant, blockWant)
          for (const one of wrote.items) blockItems.push(one as unknown as Record<string, unknown>)
          if (wrote.failed) {
            blockFailed = String(wrote.failed.text || '后端没给出原因').slice(0, 300)
          } else {
            const missed = wrote.items.filter(function (one) { return one.status !== 'ok' })
            if (missed.length) {
              const ev = (missed[0] as unknown as Record<string, unknown>).edge as Record<string, unknown> | undefined
              blockFailed = String((ev && ev.text) || '写后读回里没看到这些阻塞边').slice(0, 300)
            }
          }
        }
        for (const one of blockItems) items.push(one)
      }
      // 这一趟实际多花的出站请求与点数：一次写边 + 写后读回两次（票本身 + 依赖关系），与父子边的读回同价。
      const blockCost = blockAttempted ? { requests: 3, points: 6 } : { requests: 0, points: 0 }
      if (rel && !parentLanded) {
        // 票建成了、边没挂上：按部分成功回，不再报“建好了（父票 X）”。
        const why = String((parentEvidence && parentEvidence.text) || '后端没给出原因').slice(0, 300)
        // 「没挂上」与「没读回来、判不了」是两件事，抬头那句话也要分开说（#790 审查指出：
        // 同一个「父子边没挂上（要 X）」在两种判决下都出现，H 节的正则分不出来）。
        const edgeHead = (parentVerdict === 'unconfirmed')
          ? '父子边没确认（要 ' + rel + '）'
          : '父子边没挂上（要 ' + rel + '）'
        notes.push('父子边没建成，别把它当成已经挂上：逐条原因在上面的 items 里。')
        if (blockFailed) notes.push('阻塞边也没建成，别把它们当成已经挂上：逐条原因也在上面的 items 里。')
        if (labelFailed) items.push({ key: issue.key, step: 'labels', status: 'failed', reason: labelWhy })
        if (originalProblem) notes.push('维护者原话也没核对上：' + originalProblem)
        return {
          value: {
            status: DECK_STATUS.PARTIAL,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '票 ' + (issue.key || '（后端没回票号）') + ' 建好了：' + title + '。' + edgeHead + '：' + why
              + (labelFailed ? '标签也没挂上：' + labelWhy : '')
              + (blockFailed ? '阻塞边也没挂上（要 ' + blockWant.join('、') + '）：' + blockFailed : '')
              + (originalProblem ? '维护者原话也没核对上：' + originalProblem : ''),
            data: { ticket: issue, kind: kind, idempotencyKey: anchor, limits: { maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL } },
            items: items,
            notes: notes,
            touched: issue.key ? [String(issue.key)] : [],
          },
          claimed: { requests: 3 + parentCheck.requests + blockCost.requests + wordCost.requests, points: 6 + parentCheck.points + blockCost.points + wordCost.points },
        }
      }
      if (labelFailed) {
        // 票建成了、标签没挂上：按部分成功回（照父子边没挂上的 PARTIAL 先例），不再报“我替你补了”。
        items.push({ key: issue.key, step: 'labels', status: 'failed', reason: labelWhy })
        if (blockFailed) notes.push('阻塞边也没建成，别把它们当成已经挂上：逐条原因也在上面的 items 里。')
        if (originalProblem) notes.push('维护者原话也没核对上：' + originalProblem)
        return {
          value: {
            status: DECK_STATUS.PARTIAL,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '票 ' + (issue.key || '（后端没回票号）') + ' 建好了：' + title + '。标签没挂上：' + labelWhy
              + (blockFailed ? '阻塞边也没挂上（要 ' + blockWant.join('、') + '）：' + blockFailed : '')
              + (originalProblem ? '维护者原话也没核对上：' + originalProblem : ''),
            data: { ticket: issue, kind: kind, idempotencyKey: anchor, limits: { maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL } },
            items: items,
            notes: notes,
            touched: issue.key ? [String(issue.key)] : [],
          },
          claimed: { requests: 3 + parentCheck.requests + blockCost.requests + wordCost.requests, points: 6 + parentCheck.points + blockCost.points + wordCost.points },
        }
      }
      const claimedBase = { requests: (rel ? 3 + parentCheck.requests : 2) + blockCost.requests + wordCost.requests, points: (rel ? 6 + parentCheck.points : 4) + blockCost.points + wordCost.points }
      if (blockFailed) {
        notes.push('阻塞边没建成，别把它们当成已经挂上：逐条原因在上面的 items 里。')
        if (originalProblem) notes.push('维护者原话也没核对上：' + originalProblem)
        return {
          value: {
            status: DECK_STATUS.PARTIAL,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '票 ' + (issue.key || '（后端没回票号）') + ' 建好了：' + title + '。阻塞边没挂上（要 ' + blockWant.join('、') + '）：' + blockFailed
              + (originalProblem ? '维护者原话也没核对上：' + originalProblem : ''),
            data: { ticket: issue, kind: kind, idempotencyKey: anchor, limits: { maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL } },
            items: items,
            notes: notes,
            touched: issue.key ? [String(issue.key)] : [],
          },
          claimed: claimedBase,
        }
      }
      // #1091：原话没核对上不算建成（票在、但原话对不对不知道）：与标签没挂上同一档，按部分成功回。
      if (originalProblem) {
        notes.push('维护者原话没核对上，别把它当成已经写好：逐条原因在上面的 items 里。')
        return {
          value: {
            status: DECK_STATUS.PARTIAL,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '票 ' + (issue.key || '（后端没回票号）') + ' 建好了：' + title + '。维护者原话没核对上：' + originalProblem,
            data: { ticket: issue, kind: kind, idempotencyKey: anchor, limits: { maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL } },
            items: items,
            notes: notes,
            touched: issue.key ? [String(issue.key)] : [],
          },
          claimed: claimedBase,
        }
      }
      return {
        value: {
          status: DECK_STATUS.OK,
          workRouteDetail: a.workRouteDetail,
          text: '票 ' + (issue.key || '（后端没回票号）') + ' 建好了：' + title + (rel ? '（父票 ' + rel + '）' : '') + '。返回值就是写后的真状态，不必再读一次。'
            + (blockWant.length ? '阻塞边已按写后读回逐条核对（见 items）：' + blockWant.join('、') + '。' : ''),
          data: { ticket: issue, kind: kind, idempotencyKey: anchor, limits: { maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL } },
          items: items,
          notes: notes,
          touched: issue.key ? [String(issue.key)] : [],
        },
        claimed: claimedBase,
      }
    })
  }

  return { definition: definition, run: run }
}
