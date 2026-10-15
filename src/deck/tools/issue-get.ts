// src/deck/tools/issue-get.ts —— deck_issue_get（#713 第六批；#1019 换到新树、#1035 转 TypeScript）
//
// 一次把一张票的完整关系读回来：正文、评论、标签、认领、父子、阻塞边。
// 「优先读宿主已有快照」落在实现上是：宿主把快照缓存（snapshot.js 的 get/getDependencies）通过
// deps.readThrough 注进来时先用它，没注入就现读；两条路的返回值形状一样，调用方看不出区别。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { EDGE_LANDING, relationsOf } from '../shell/edge-landing.js'
import { withCallScope } from '../shell/call-budget.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

/** 数字型参数的统一收口：正的有限数才要（取整），其余一律当「没给」，由调用方退自己的默认。 */
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
// 执行层失败与后端诚实失败的分界（见 issue-create.ts 同名注释）：前者抛给壳走
// backend-threw（可重试），后者走逐项的 BACKEND_UNSUPPORTED。钳制只管超时，不改判。
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
/** 超时回执：状态与失败那一支同形（unsupported + 独立原因码 + 原话进 data），不抛。 */
function timeoutValue(text: string, data: Record<string, unknown>, claimed: { requests: number; points: number }) {
  return {
    value: {
      status: DECK_STATUS.UNSUPPORTED,
      reason: REFUSAL_REASONS.BACKEND_TIMEOUT,
      text: text,
      data: data,
    },
    claimed: claimed,
  }
}

/**
 * 装配层注入的依赖袋。壳要用的键原样透传（没列的键也一律接受：壳自己还没标类型，这一层不替它把关）；
 * 列出来的是本工具自己会读的那几个，缺席时各自退默认：没有沙箱策略就跳过那一步等待，没有时钟就用 Date.now。
 */
export interface DeckIssueGetDeps {
  readonly [key: string]: unknown
  /** 沙箱许可策略：给工作区与会话，回这一轮的策略快照；等不到就当没有（不拦事）。
   *  两个值都按会话壳给的原样传（工作区没定下来时可能还没有），不许在这里补空串或假目录。 */
  sandboxPolicyFor?: (arg: { cwd: string | undefined; sessionId: string | undefined }) => Promise<unknown>
  /** 会话短键归一：宿主把票号缩成工作区内的短键。 */
  canonicalKey?: (key: string) => string | null
  /** 工作区短指纹：宿主按工作区目录加会话算出来，用来把同一处的几趟调用串起来。 */
  workspaceKeyOf?: (cwd: string, sessionId: string) => string | null
  /** 单次后端调用的超时预算（毫秒）；缺省由预算壳自己定。 */
  toolTimeoutMs?: number
  /** 预算壳留给收尾的余量（毫秒）。 */
  toolMarginMs?: number
  /** 时钟旁路：测试里换成假时钟用，缺省 Date.now。 */
  now?: () => number
}

/** 工具定义（唯一事实）：路由、参数名与给 AI 看的那句话都从这里出，别在别处再抄一份。 */
export const definition = {
  name: 'deck_issue_get',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。读一个 ISSUE 的完整关系：正文、评论、label、assignee 与 parent 和 blockedBy 边，每条边标出落点。blocking=false 跳过反向边全仓扫描（快，见 blocking 参数）。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '票号，例如 713' },
      comments: { type: 'number', description: '最多带回几条评论，缺省 50' },
      section: { type: 'string', description: '只回正文里这一节（## 标题子串），缺省回全文前 2000 字' },
      blocking: { type: 'boolean', description: '要不要反向阻塞边（谁被这张票阻塞）。缺省要：读全量关系。关掉只读单票本身，跳过一次全仓扫描，快一个数量级；反向边记空并注记，要就再调一次。' },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    required: ['key'],
    additionalProperties: false,
  },
}

/**
 * 列表行里挑出要给 AI 看的那几项。读的是后端回来的运行时真值（形状未在契约层建模的房内字段也在），
 * 所以先当未知收口：不是对象就回 null，字段缺了用空串/null 补，不猜。
 */
function issueBrief(issue: Record<string, unknown> | null | undefined) {
  if (!issue || typeof issue !== 'object') return null
  return {
    key: issue.key, title: issue.title, state: issue.state, type: issue.type,
    labels: Array.isArray(issue.labels) ? issue.labels.map((l) => (l && l.name) || String(l)) : [],
    assignees: Array.isArray(issue.assignees) ? issue.assignees.map((a) => (a && a.login) || String(a)) : [],
    updatedAt: issue.updatedAt || '', closedAt: issue.closedAt || '', url: issue.url || '', body: issue.body !== undefined ? issue.body : null,
  }
}

/** 按 ## 标题子串取正文节：找到就回节内文本，找不到回空（调用方如实注记，不猜）。 */
function sectionOf(body: unknown, want: unknown): { found: boolean; name: string; text: string } {
  const src = typeof body === 'string' ? body : ''
  const q = String(want === undefined || want === null ? '' : want).trim().toLowerCase()
  if (!q) return { found: false, name: '', text: '' }
  const lines = src.split('\n')
  let start = -1
  let name = ''
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*##\s*(.+?)\s*$/.exec(lines[i])
    if (m && String(m[1]).toLowerCase().indexOf(q) >= 0) { start = i; name = String(m[1]).trim(); break }
  }
  if (start < 0) return { found: false, name: '', text: '' }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*##\s*.+\s*$/.test(lines[i])) { end = i; break }
  }
  return { found: true, name: name, text: lines.slice(start + 1, end).join('\n').replace(/^\n+|\s+$/g, '') }
}

/**
 * 装配层调一次，拿到这对 { definition, run }。deps 是宿主注入的依赖袋（见 DeckIssueGetDeps），
 * 什么都不给也能跑：壳与这里的每一处都各自退默认。
 */
export function createDeckIssueGet(deps?: DeckIssueGetDeps) {
  const d: DeckIssueGetDeps = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  /**
   * 跑一次：exec 是 DSH 给的执行上下文（会话与沙箱都从它取），args 是模型填的参数。
   * 参数先当「未知」再逐项收口（key / effortId / comments 下面各收一次），回执形状由壳统一渲染。
   */
  async function run(exec: unknown, args: Record<string, unknown>): Promise<unknown> {
    // 预算起算点：入口前耗时（会话归一、选后端、探沙箱）也要算进预算（#1195）。
    const toolEntryAt = (typeof d.now === 'function') ? d.now() : Date.now()
    const a: Record<string, unknown> = args || {}
    const key = String(a.key === undefined || a.key === null ? '' : a.key).trim()
    const est = shell.estimateFor('deck_issue_get', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 在会话壳里是运行时布尔，
    // 那一层还没标类型，见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_issue_get', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })
    if (!key) return shell.unsupported('deck_issue_get', REFUSAL_REASONS.BAD_ARGS, '要读哪一张票：把票号写在 key 里（例如 713）。', { cost: { estimated: est } })

    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_issue_get', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const effortId = (a.effortId === undefined || a.effortId === null) ? '' : String(a.effortId).trim()
    if (effortId) repo.effortId = effortId
    const first = Math.max(0, Math.min(200, Number(a.comments) > 0 ? Math.floor(Number(a.comments)) : 50))
    // 反向边缺省要：只有显式传 false 才跳过。缺席、true、其它值一律全量，老调用方形状不动。
    const wantBlocking = a.blocking !== false
    // 沙箱策略的快照：等不到（超时、对方失败、没注入）一律按「没有」往下走，与老口径同形。
    let sandbox: unknown = null
    try {
      if (typeof d.sandboxPolicyFor === 'function') {
        const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), SANDBOX_TIMEOUT_MS)
        sandbox = (raced && raced.ok === true) ? raced.value : null
      }
    } catch (eS) { sandbox = null }

    return shell.call({ tool: 'deck_issue_get', kind: 'read', session: s, pick: pick, repo: repo, estimate: est, sandbox: sandbox }, async (c: unknown) => {
      // 进预算壳：两次远端各有 30 秒单次钳制、可中止，超时只坏自己那一项；
      // 名册随上下文走，后端内部的定向重读能用上。成功路径的形状一字不动。
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), startedAt: toolEntryAt, now: (typeof d.now === 'function') ? d.now : Date.now })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      const got = await t.get(repo, key, { comments: { first: first } }, opCtx)
      const gotTimeout = timeoutMessage(got as TransportResult)
      if (gotTimeout) return timeoutValue('这张票这次没读回来（超时了：在限时内没等到后端回话，这次读没动手，重调一次就行）。', { key: key, backendId: pick.backendId, error: { kind: 'timeout', message: gotTimeout.slice(0, 300) } }, { requests: 1, points: 3 })
      const gotTransport = transportMessage(got as TransportResult)
      if (gotTransport) throw new Error(gotTransport)
      if (!got || got.ok !== true) {
        const msg = String((got && got.error && got.error.message) || '后端没给出原因').slice(0, 300)
        return {
          value: {
            status: DECK_STATUS.UNSUPPORTED,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '这张票没读回来（后端原话：' + msg + '）。',
            data: { key: key, backendId: pick.backendId, error: { kind: String((got && got.error && got.error.kind) || ''), message: msg } },
          },
          claimed: { requests: 1, points: 3 },
        }
      }
      const issue = got.data || {}
      // 反向边是整笔调用里最贵的一段（算“谁被阻塞”要扫全仓）：关掉就整段跳过，
      // 只读单票本身；反向边记空并注记，不假装 0 条。
      const dep = (wantBlocking && typeof t.getDependencies === 'function') ? await t.getDependencies(repo, key, {}, opCtx) : null
      const depTimeout = wantBlocking ? timeoutMessage(dep as TransportResult) : null
      if (depTimeout) return timeoutValue('这张票读到一半（阻塞边超时了：在限时内没等到后端回话；票本身已读回，阻塞边重调一次就行）。', { key: key, backendId: pick.backendId, error: { kind: 'timeout', message: depTimeout.slice(0, 300) } }, { requests: 1, points: 3 })
      const depTransport = wantBlocking ? transportMessage(dep as TransportResult) : null
      if (depTransport) throw new Error(depTransport)
      const dependencies = (dep && dep.ok === true) ? dep.data : null
      const rel = relationsOf(issue, dependencies)
      if (!wantBlocking) rel.blocking = []
      const notes = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
      if (!wantBlocking) notes.push('反向阻塞边这次没取（blocking=false，跳过一次全仓扫描）：上面“阻塞别人”记空不是 0 条，要就带 blocking=true 再调一次。')
      if (dep && dep.ok !== true) notes.push('阻塞边这次没读到（后端原话：' + String((dep.error && dep.error.message) || '').slice(0, 200) + '）：上面只列了票自己带的那些。')
      const bodyText = typeof issue.body === 'string' ? issue.body : ''
      const sec = sectionOf(bodyText, a.section)
      if (typeof a.section === 'string' && a.section.trim() !== '' && !sec.found) notes.push('正文里没找到标题含「' + String(a.section).trim().slice(0, 60) + '」的节，回的是全文前 2000 字。')
      const excerpt = (sec.found ? sec.text : bodyText).slice(0, sec.found ? 2000 : 2000)
      const stateText = String(issue.state || '未知状态')
      const closedText = issue.closedAt ? '（关闭于 ' + String(issue.closedAt).slice(0, 10) + '）' : ''
      const blockingText = wantBlocking ? ('阻塞别人 ' + rel.blocking.length + ' 条。') : '阻塞别人未取（blocking=false）。'
      return {
        value: {
          status: DECK_STATUS.OK,
          text: '票 ' + key + ' 读回来了：状态 ' + stateText + closedText + '，父票 ' + (rel.parentKey || '（没有）') + '，被阻塞 ' + rel.blockedBy.length + ' 条，' + blockingText,
          data: {
            ticket: issueBrief(issue),
            excerpt: excerpt,
            section: sec.found ? { name: sec.name, text: excerpt } : null,
            relations: rel,
            landings: {
              // 读路径只知道「契约的字段里有这条关系」，分不出原生层级与平级链接，如实降一档（判据见 shell.js）。
              parent: rel.parentKey ? EDGE_LANDING.CONTRACT_PARENT_FIELD : EDGE_LANDING.UNKNOWN,
              blockedBy: rel.blockedBy.length ? EDGE_LANDING.CONTRACT_BLOCK_FIELD : EDGE_LANDING.UNKNOWN,
              caveat: '这两个落点是从契约返回的字段读出来的；要精确知道这个后端把父子放在原生层级还是平级链接，看返回里本次写操作留下的 evidence（deck_map_link 会写）。',
            },
            comments: Array.isArray(issue.comments) ? issue.comments.slice(0, first) : [],
            dependenciesRaw: dependencies,
          },
          notes: notes,
          touched: [],
        },
        // 按实际读数报账：跳过反向边就是一次读，与取失败那条路同数，闸对账不报“对不上”。
        claimed: wantBlocking ? { requests: 2, points: 6 } : { requests: 1, points: 3 },
      }
    })
  }

  return { definition: definition, run: run }
}
