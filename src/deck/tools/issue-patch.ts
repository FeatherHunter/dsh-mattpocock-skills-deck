// src/deck/tools/issue-patch.ts —— deck_issue_patch（#713 第六批；#1019 换到新树、#1035 转 TypeScript）
//
// 一次调用改一张票：评论 / 标签流转 / 认领 / 关闭重开 / 标题正文 / 进度区。
// 只做调用方点名的那几件事，没点名的字段一个字都不碰（改票最怕「顺手改了别的东西」）。
// 做完的每一步都单独记一条 item：哪一步成、哪一步没成、后端原话是什么。
// 返回值就是写后的真状态（能读回就读回一次），AI 不必再读一次确认。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { statusOfItems } from '../shell/edge-landing.js'
import { withCallScope } from '../shell/call-budget.js'
import { withKeyLock } from '../shell/write-mutex.js'
import { ensureBody } from '../shell/minimal-spec.js'
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
// backend-threw（可重试），后者走逐项 fail（partial）。must() 包住每一次远端调用。
const TRANSPORT_KINDS: readonly string[] = ['backend-threw', 'timeout', 'aborted', 'over-budget']
/** 后端回包在契约层还没建模：这里只按本工具真正会读的那一个字段收口，调用处拿断言喂进来（断言不产码）。 */
type TransportResult = { error?: { kind?: string; message?: unknown } } | null | undefined
/** 后端回包里「执行层失败」的原话；不是执行层失败（后端诚实地说做不到）就回 null，一个字不改判。 */
function transportMessage(result: TransportResult): string | null {
  const e = result && result.error
  if (e && TRANSPORT_KINDS.indexOf(e.kind as string) >= 0) return String(e.message || '执行层没回来')
  return null
}
/** 执行层失败原样抛给壳（走 backend-threw，可重试）；不是执行层失败就把结果原样交回调用方。 */
function must<T>(result: T): T {
  const m = transportMessage(result as unknown as TransportResult)
  if (m) throw new Error(m)
  return result
}

/**
 * 装配层注入的依赖袋。壳要用的键原样透传（没列的键也一律接受：壳自己还没标类型，这一层不替它把关）；
 * 列出来的是本工具自己会读的那几个，缺席时各自退默认：没有沙箱策略就跳过那一步等待，没有时钟就用 Date.now。
 */
export interface DeckIssuePatchDeps {
  readonly [key: string]: unknown
  /** 沙箱许可策略：给工作区与会话，回这一轮的策略快照；等不到就当没有（不拦事）。两个值原样传，可能还没有。 */
  sandboxPolicyFor?: (arg: { cwd: string | undefined; sessionId: string | undefined }) => Promise<unknown>
  /** 时钟旁路：测试里换假时钟用，缺省 Date.now。 */
  now?: () => number
}

/** 工具定义（唯一事实）：路由、参数名与给 AI 看的那句话都从这里出，别在别处再抄一份。 */
export const definition = {
  name: 'deck_issue_patch',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。改一个 ISSUE：评论、label、assignee、开关、标题正文、progress 区，一次只动点名的那些。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '要改的那张票' },
      comment: { type: 'string', description: '要发的评论正文' },
      addLabels: { type: 'array', items: { type: 'string' }, description: '要加的标签' },
      removeLabels: { type: 'array', items: { type: 'string' }, description: '要摘掉的标签' },
      assignees: { type: 'array', items: { type: 'string' }, description: '认领人（整批替换；给空数组就是取掉认领）' },
      title: { type: 'string', description: '新的标题' },
      body: { type: 'string', description: '新的正文' },
      progress: { type: 'string', description: '只改「## 进度」那一段的内容' },
      close: { type: 'boolean', description: 'true 关闭这张票，false 重新打开' },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    required: ['key'],
    additionalProperties: false,
  },
}

/** 从参数里收一束名字：字符串直接用，对象取它的 name，其余一律当空串丢掉（不猜）。 */
function names(list: unknown) {
  return Array.isArray(list) ? list.map((l) => (typeof l === 'string' ? l : (l && l.name) || '')).map((s) => String(s).trim()).filter(Boolean) : []
}

/** 只替换「## 进度」那一段：前面的正文与后面的其它区块原样保留。 */
export function replaceProgressSection(body: unknown, text: unknown) {
  const src = typeof body === 'string' ? body : ''
  const clean = String(text === undefined || text === null ? '' : text).replace(/\s*$/, '')
  const blockBase = '## 进度\n\n' + clean + '\n\n'
  // 标题认「## 进度」与「## 进度：80% / ## Progress: 40%」：后者是读进度的人认的写法，写进度的人也要认，否则会再插一段重复的进度区。
  // 结尾认「真正的文末」：多行模式下行尾的 $ 在每一行尾都成立，惰性匹配会停在标题行尾，只换掉标题五个字，旧内容原地不动。
  // $(?![\s\S]) 只在整个字符串的末尾成立，后面再没有字符，才是兜底分支要等的那个位置。
  // #1002：右边界加字段行终点：进度区后面是字段行（Status/Type/Blocked by/Labels）时停在字段行之前，
  // 否则字段行会被吞进进度段、再由改正文的整份分支补到文件末尾（C7）。没有进度区时插在字段行之前，不落到文末。
  const fieldAhead = '^\\s*(?:Status|Type|Blocked\\s+by|Labels)\\s*[:\\uFF1A]'
  const single = new RegExp('^##\\s*(?:进度|Progress)(?:\\s*[：:]\\s*\\d{1,3}\\s*%?)?\\s*$[\\s\\S]*?(?=^##\\s|' + fieldAhead + '|$(?![\\s\\S]))', 'mi')
  if (!single.test(src)) {
    const block = blockBase
    const fieldRe = new RegExp(fieldAhead, 'im')
    const fieldMatch = fieldRe.exec(src)
    if (fieldMatch) {
      const idx = fieldMatch.index
      const before = src.slice(0, idx).replace(/\s*$/, '')
      const after = src.slice(idx).replace(/^\s*/, '')
      return (before + '\n\n' + block + after).replace(/^\n+/, '').replace(/(?:\r?\n){3,}/g, '\n\n')
    }
    const skelRe = /^##\s*(?:Comments|Answer)\s*$/im
    const skelMatch = skelRe.exec(src)
    if (skelMatch) {
      const idx = skelMatch.index
      const before = src.slice(0, idx).replace(/\s*$/, '')
      const after = src.slice(idx).replace(/^\s*/, '')
      return (before + '\n\n' + block + after).replace(/^\n+/, '').replace(/(?:\r?\n){3,}/g, '\n\n')
    }
    return (src.replace(/\s*$/, '') + '\n\n' + block).replace(/^\n+/, '').replace(/(?:\r?\n){3,}/g, '\n\n')
  }
  const reAll = new RegExp('^##\\s*(?:进度|Progress)(?:\\s*[：:]\\s*\\d{1,3}\\s*%?)?\\s*$[\\s\\S]*?(?=^##\\s|' + fieldAhead + '|$(?![\\s\\S]))', 'gmi')
  let first = true
  const out = src.replace(reAll, function () {
    if (!first) return ''
    first = false
    return blockBase
  })
  // 新块后面若直接粘着下一个标题，补一个空行；历史脏数据（之前写坏留下的第二个进度区）已在上面清空，顺手把三连以上的空行压成一段。
  return out.replace(/([^\n])\n## /g, '$1\n\n## ').replace(/(?:\r?\n){3,}/g, '\n\n')
}

/**
 * 装配层调一次，拿到这对 { definition, run }。deps 是宿主注入的依赖袋（见 DeckIssuePatchDeps），
 * 什么都不给也能跑：壳与这里的每一处都各自退默认。
 */
export function createDeckIssuePatch(deps?: DeckIssuePatchDeps) {
  const d: DeckIssuePatchDeps = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  /**
   * 跑一次：exec 是 DSH 给的执行上下文（会话与沙箱都从它取），args 是模型填的参数。
   * 参数先当「未知」再逐项收口（key / effortId 与下面那几件要改的事各收一次），回执形状由壳统一渲染。
   */
  async function run(exec: unknown, args: Record<string, unknown>): Promise<unknown> {
    const a: Record<string, unknown> = args || {}
    const key = String(a.key === undefined || a.key === null ? '' : a.key).trim()
    const est = shell.estimateFor('deck_issue_patch', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 在会话壳里是运行时布尔，
    // 那一层还没标类型，见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_issue_patch', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })
    if (!key) return shell.unsupported('deck_issue_patch', REFUSAL_REASONS.BAD_ARGS, '要改哪一张票：把票号写在 key 里。', { cost: { estimated: est } })
    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_issue_patch', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const effortId = (a.effortId === undefined || a.effortId === null) ? '' : String(a.effortId).trim()
    if (effortId) repo.effortId = effortId

    const addLabels = names(a.addLabels)
    const removeLabels = names(a.removeLabels)
    // 索引签名只为让下面按 key 过滤时能取用；键名、值的算法与个数一个字没改。
    const wants: Record<string, boolean> = {
      comment: typeof a.comment === 'string' && a.comment.trim() !== '',
      labels: addLabels.length > 0 || removeLabels.length > 0,
      assignees: Array.isArray(a.assignees),
      text: typeof a.title === 'string' || typeof a.body === 'string' || typeof a.progress === 'string',
      state: typeof a.close === 'boolean',
    }
    if (!wants.comment && !wants.labels && !wants.assignees && !wants.text && !wants.state) {
      return shell.unsupported('deck_issue_patch', REFUSAL_REASONS.BAD_ARGS, '这次没说清要改什么：至少点名一件（comment / addLabels / removeLabels / assignees / title / body / progress / close）。', { cost: { estimated: est } })
    }

    // exec 的形状由 DSH 给（会话壳那批还没标类型，见 #1040），三处 exec.signal 各按纯类型断言收口：
    // 取值表达式一字不动，所以转译出来的 JS 与转换前逐字节一致。
    return shell.call({ tool: 'deck_issue_patch', kind: 'write', session: s, pick: pick, repo: repo, estimate: est, sandbox: (await (async function () { try { if (typeof d.sandboxPolicyFor !== 'function') return null; const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), SANDBOX_TIMEOUT_MS); return (raced && raced.ok === true) ? raced.value : null } catch (eS) { return null } })()), signal: (exec && (exec as { signal?: unknown }).signal && typeof (exec as { signal?: unknown }).signal === 'object') ? (exec as { signal?: unknown }).signal : undefined }, async (c: unknown) => {
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), now: (typeof d.now === 'function') ? d.now : Date.now })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      const items = []
      const notes = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
      const touched = [key]
      // result 是后端回包（形状是运行时真值，契约层还没建模）：参数就地收窄成「只读 error.message」，
      // 下面那句读的还是原来那个 result，字段名与默认值一个字没改。
      const fail = (step: string, result: { error?: { message?: unknown } } | null | undefined) => {
        const msg = String((result && result.error && result.error.message) || '后端没给出原因').slice(0, 200)
        items.push({ key: key, step: step, status: 'failed', reason: msg })
      }
      // 剩余额度不够时停发新调用：与 deck_map_link 同一句话，逐项诚实报失败，不硬撑。
      const over = (step: string) => {
        items.push({ key: key, step: step, status: 'failed', reason: '剩余额度不够发这一次调用了，这一步这次没动：带同样参数再调一次即可。' })
      }
      // 同票并发写互斥：等不到锁就诚实记一笔，不硬挤（单次原子写不拿锁，只有读改写序列拿）。
      const lockOpts = { timeoutMs: numOpt(d.keyLockTimeoutMs) }
      const lockedOut = (step: string) => {
        items.push({ key: key, step: step, status: 'failed', reason: '这张票正被另一次调用改着，这次没动：稍后带同样参数再调一次即可。' })
      }

      if (wants.comment) {
        if (sc.outOfBudget()) over('comment')
        else {
          const r = must(await t.comment(repo, key, a.comment, opCtx))
          if (r && r.ok === true) items.push({ key: key, step: 'comment', status: 'ok' })
          else fail('comment', r)
        }
      }

      if (wants.labels) {
        // 标签是整批替换：先读回当前标签，再加上去/摘下来 —— 只有读到了才敢整批替换。
        // 读改写序列持同票锁：同票并发改标签不再丢一次改动；不同票照旧并行。
        if (sc.outOfBudget()) over('labels')
        else {
          const held = await withKeyLock(repo, key, async () => {
            const cur = must(await t.get(repo, key, {}, opCtx))
            if (!cur || cur.ok !== true) { fail('labels', cur); return }
            const have = names(cur.data && cur.data.labels)
            const want = have.concat(addLabels).filter((n) => removeLabels.indexOf(n) < 0)
            const uniq = want.filter((n, i) => want.indexOf(n) === i)
            if (sc.outOfBudget()) { over('labels'); return }
            const r = must(await t.setLabels(repo, key, uniq, {}, opCtx))
            if (r && r.ok === true) items.push({ key: key, step: 'labels', status: 'ok', labels: uniq })
            else fail('labels', r)
          }, lockOpts)
          if (held && held.ok === false && held.timedOut) lockedOut('labels')
        }
      }

      if (wants.assignees) {
        const want = Array.isArray(a.assignees) ? a.assignees.map((x) => String(x)) : []
        if (sc.outOfBudget()) over('assignees')
        else {
          const r = must(await t.setAssignees(repo, key, want, {}, opCtx))
          if (r && r.ok === true) {
            // 「回了 ok」不等于「认领人记上了」：本地 Markdown 只会把状态改成 claimed，认领人的名字不记。
            // 判据是读回来的票（后端的回答本身），不是后端是谁 —— 名字没出现在票上就如实说没记上。
            // 索引签名只为让下面按字段名读认领人能过编译（读法与默认值一字未改）。
            const back: Record<string, unknown> = (r.data && r.data.assignees) ? r.data : (typeof t.get === 'function' && !sc.outOfBudget() ? ((must(await t.get(repo, key, {}, opCtx)).data || {})) : {})
            const got = Array.isArray(back.assignees) ? back.assignees.map((x) => (x && x.login) || String(x)) : []
            const missing = want.filter((w) => got.indexOf(w) < 0)
            if (want.length && missing.length) {
              items.push({ key: key, step: 'assignees', status: 'failed', reason: '后端回了 ok，但读回来的票上没有这些认领人（' + missing.join('、') + '）：它可能只改了状态、没记认领人，别当成认领已经记上。' })
            } else items.push({ key: key, step: 'assignees', status: 'ok', assignees: want })
          } else if (r && r.error && r.error.kind === 'unsupported') {
            items.push({ key: key, step: 'assignees', status: 'failed', reason: '这个后端做不到记认领人（后端原话：' + String(r.error.message || '').slice(0, 160) + '）。' })
          } else fail('assignees', r)
        }
      }

      if (wants.text) {
        // 正文读改写序列持同票锁（单次标题直写也一起 serial，保证与进度回写不交错）。
        if (sc.outOfBudget()) over('text')
        else {
          const held = await withKeyLock(repo, key, async () => {
            // 索引签名只为让下面按字段名赋值、delete 与取键名能过编译；写进去的键与值一个字没改。
            const patch: Record<string, unknown> = {}
            let progressBlocked = false
            if (typeof a.title === 'string') patch.title = a.title
            if (typeof a.body === 'string') patch.body = a.body
            if (typeof a.progress === 'string') {
              if (typeof a.body === 'string') patch.body = replaceProgressSection(a.body, a.progress)
              else if (sc.outOfBudget()) { progressBlocked = true; over('text') }
              else {
                const cur = must(await t.get(repo, key, {}, opCtx))
                const base = (cur && cur.ok === true && cur.data && typeof cur.data.body === 'string') ? cur.data.body : null
                // 旧正文没读回来时不敢拿空正文覆盖：空写一次就会把整张票冲成只剩进度段（#908 亲历）。这次宁可报失败，让调用方等能读回再写，或改传整段 body。
                if (base === null) { progressBlocked = true; fail('text', { error: { message: '旧正文没读回来，不敢拿半截正文覆盖：这次进度没写，等能读回旧正文再写（若急用，改传整段 body）。' } }) }
                else patch.body = replaceProgressSection(ensureBody(base, 'task').body, a.progress)
              }
            }
            // 进度因读不到旧正文被拦下时：body 不写（免得把整票冲掉），但同批点的标题照写；如果只点了进度，这次文字一个字不动，失败原因已在上面记好。
            if (progressBlocked) delete patch.body
            if (!progressBlocked || Object.keys(patch).length > 0) {
              if (sc.outOfBudget()) over('text')
              else {
                const r = must(await t.update(repo, key, patch, opCtx))
                if (r && r.ok === true) items.push({ key: key, step: 'text', status: 'ok', fields: Object.keys(patch) })
                else fail('text', r)
              }
            }
          }, lockOpts)
          if (held && held.ok === false && held.timedOut) lockedOut('text')
        }
      }

      if (wants.state) {
        if (sc.outOfBudget()) over(a.close === true ? 'close' : 'reopen')
        else {
          const r = a.close === true ? must(await t.close(repo, key, {}, opCtx)) : must(await t.reopen(repo, key, opCtx))
          if (r && r.ok === true) items.push({ key: key, step: a.close === true ? 'close' : 'reopen', status: 'ok' })
          else fail(a.close === true ? 'close' : 'reopen', r)
        }
      }

      // 写后真状态：能读回就读回一次，读不回来也如实说（别让 AI 以为已经确认过了）。
      // 诚实性由后端保证（本地后端在落盘前核对单例、坏了就返回失败，本层按逐项原样记失败）：本层不判后端，
      // 后端做不到的那一步在上面已经记成失败，顶层按逐项自然非成功。
      const back = (typeof t.get === 'function' && !sc.outOfBudget()) ? await t.get(repo, key, {}, opCtx) : null
      const readBack = (back && back.ok === true) ? back.data : null
      if (!readBack) notes.push('写后没读回来（后端原话：' + String((back && back.error && back.error.message) || '没给出原因').slice(0, 160) + '）：上面每步是照后端的回答记的。')
      const status = statusOfItems(items)
      if (status !== DECK_STATUS.OK) notes.push('有的步骤没成，逐条原因在上面：别把没成的那一步当成已经改好。')
      return {
        value: {
          status: status,
          reason: status === DECK_STATUS.OK ? '' : REFUSAL_REASONS.BACKEND_UNSUPPORTED,
          text: '票 ' + key + '：这次点了 ' + items.length + ' 步，成了 ' + items.filter((i) => i.status === 'ok').length + ' 步。',
          data: { requested: Object.keys(wants).filter((k) => wants[k]), ticket: readBack },
          items: items,
          readBack: readBack,
          notes: notes,
          touched: touched,
        },
        claimed: { requests: est.requests, points: est.points },
      }
    })
  }

  return { definition: definition, run: run }
}
