// src/deck/tools/issue-patch.ts —— deck_issue_patch（#713 第六批；#1019 换到新树、#1035 转 TypeScript；#1091 加维护者原话）
//
// 一次调用改一张票：评论 / 标签流转 / 认领 / 关闭重开 / 标题正文 / 进度区 / 维护者原话区。
// 只做调用方点名的那几件事，没点名的字段一个字都不碰（改票最怕「顺手改了别的东西」）。
// 做完的每一步都单独记一条 item：哪一步成、哪一步没成、后端原话是什么。
// 返回值就是写后的真状态（能读回就读回一次），AI 不必再读一次确认。
//
// #1298 T7 的口径（规格容器的自动关闭权限）：这个工具只允许「关」，不允许「重开」——重开只由人在后端做。
// 关规格之前有三道闸，全在同一次调用里判，判不过就一个字都不动地拒绝：实施票必须全部关闭；
// 必须带一条收口核对评论（逐张核对结论）；规格下面连实施票都没有时不算核对通过。
// 没有「看到子票都关了顺手关」的旁路：唯一的触发条件就是收口核对通过，而这条评论本身就是核对通过的证据。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { MD_SCOPE_LOCATE, applyMdScope, mdScopeNote } from './md-scope.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { callDeckSession, openDeckSession } from './tracker-session.js'
import { statusOfItems } from '../shell/edge-landing.js'
import { specCloseGuard } from '../shell/spec-close-guard.js'
import { withCallScope } from '../../refresh/rooms/host/tool-call-budget-enforcement.js'
import { withKeyLock } from '../shell/write-mutex.js'
import { ensureBody } from '../shell/minimal-spec.js'
// #1195：执行层失败（抛错 / 中止 / 超时 / 预算耗尽）的收口从两个写工具里抽出来共用，判据一字未改。
import { must, numOpt, timeoutMessage, withCap } from '../shell/backend-transport.js'
import type { TransportResult } from '../shell/backend-transport.js'
// #1090：进度区的读、写、核对统一走 shared 层的那一份口径（读与写共用同一份写法，不再各留一份正则）。
// #1091：维护者原话区同理；两块一起写时的组合与写后核对住在 body-write。
import { PROGRESS_BODY_LIMIT } from '../../shared/issue-file/src/progress.js'
import type { ProgressEntry } from '../../shared/issue-file/src/progress.js'
import { progressEntryFromArg, stampNow } from '../../shared/issue-file/src/progress-tool.js'
import type { OriginalWordsEntry } from '../../shared/issue-file/src/original-words.js'
import { originalWordsFromArg } from '../../shared/issue-file/src/original-words-tool.js'
import { planBodyWrite } from '../shell/body-write.js'
import type { BodyWritePlan } from '../shell/body-write.js'
import { textWriteVerify } from '../shell/text-write-verify.js'
import { estimateToolCost, toolCostInputFrom } from '../../refresh/kernel/tool-call-budget.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { DECK_SANDBOX_TIMEOUT_MS } from '../../shared/time-config/src/values.js'

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
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。改一个 ISSUE：评论、label、assignee、关闭、标题正文、progress 区、维护者原话区，一次只动点名的那些；重开不在这个工具上（只由人在后端做），关规格要先在这一次调用里带收口核对评论、且实施票已全关。本地后端认领会写进票里的 Assignees 行。',
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
      originalWords: {
        type: 'object',
        description: '追加一条维护者原话到正文的「## 维护者原话」区（紧跟「## 目的」，没有目的区就放正文最前）：{text, source}，source 必填。原话一字不改（不润色、不改标点、不翻译、不摘要），只追加、不编辑不删除不排序；同一段原话 + 同一出处已经写过时幂等跳过。三个后端都写进票的正文，不进评论。正文超过 60KB 时拒绝写入、一个字节不动。',
        properties: {
          text: { type: 'string', description: '维护者的原话正文，一字不改；可以多行，空行原样保留' },
          source: { type: 'string', description: '出处，必填：票面写完整链接，本会话答复写「本会话（时间）」，文件写「路径:行号」，提交写短哈希' },
        },
        required: ['text', 'source'],
        additionalProperties: false,
      },
      progress: {
        type: 'object',
        description: '写一条进度记录：{percent, note}（#1090 起不再收一段自由文字）。工具自动盖当前时间、把这条加到「## 进度」区最上面，旧记录原样保留；正文超过 60KB 时拒绝写入、一个字节不动。',
        properties: {
          percent: { type: 'integer', description: '进度百分比，0..100 的整数' },
          note: { type: 'string', description: '做到哪一步了的说明，必填，一句话（不能换行）' },
        },
        required: ['percent', 'note'],
        additionalProperties: false,
      },
      close: { type: 'boolean', description: 'true 关闭这张票；关规格时必须在同一次调用里带 comment（逐张核对结论），且实施票全关，否则关闭会被拒绝。重开只能由人在后端做，这个工具不支持 false' },
      workRouteDetail: { type: 'string', enum: ['core', 'standard'], description: '成功后回执里在办表（data.workRoute）带多细：core 只带票号、会话、时间（缺省，最多 20 条），standard 再加标题与动作（全部条目）' },
      ...MD_SCOPE_LOCATE,
    },
    required: ['key'],
    additionalProperties: false,
  },
}

/** 从参数里收一束名字：字符串直接用，对象取它的 name，其余一律当空串丢掉（不猜）。 */
function names(list: unknown) {
  return Array.isArray(list) ? list.map((l) => (typeof l === 'string' ? l : (l && l.name) || '')).map((s) => String(s).trim()).filter(Boolean) : []
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
   * 参数先当「未知」再逐项收口（key / effort / feature 与下面那几件要改的事各收一次），回执形状由壳统一渲染。
   * exec 上只声明本文件真正会读的那个字段（取消信号），其余字段一律不碰、照旧整只交给壳，
   * 所以下面取 signal 的地方不必写一串断言。
   */
  async function run(exec: { signal?: unknown } | null | undefined, args: Record<string, unknown>): Promise<unknown> {
    // 预算起算点：入口前耗时（会话归一、选后端、探沙箱）也要算进预算（#1195）。
    const toolEntryAt = (typeof d.now === 'function') ? d.now() : Date.now()
    const a: Record<string, unknown> = args || {}
    const key = String(a.key === undefined || a.key === null ? '' : a.key).trim()
    const est = shell.estimateFor('deck_issue_patch', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 在会话壳里是运行时布尔，
    // 那一层还没标类型，见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_issue_patch', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })
    if (!key) return shell.unsupported('deck_issue_patch', REFUSAL_REASONS.BAD_ARGS, '要改哪一张票：把票号写在 key 里。', { cost: { estimated: est } })
    // #1298 ⑧：AI 工具面上只允许关、不允许重开。重开是「人才能做的动作」，不属于这个工具的权限，
    // 所以这一支在选后端之前就拒掉，连后端都不连、一个字都不动。机器可读的原因码沿用 ai-tool-refused
    // （与额度用尽同一个码：两种都是「AI 这一侧不许做这件事」，文案里说清是哪一种）。
    if (a.close === false) {
      return shell.unsupported('deck_issue_patch', REFUSAL_REASONS.OVER_CAP, '重开不在这个 AI 工具面上：这个工具只允许关闭，不允许重新打开；要重开请人回到后端（GitHub 的票页面，或本地 .scratch 目录下的票文件）手动做。这次一个字都没动。', { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    }
    const pick = await openDeckSession({ deps: d, exec: exec, session: s, estimate: est, tool: 'deck_issue_patch', kind: 'write' })
    if (!pick.ok) return shell.unsupported('deck_issue_patch', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const scope = applyMdScope(repo, a)
    if (!scope.ok) return shell.unsupported('deck_issue_patch', REFUSAL_REASONS.BAD_ARGS, scope.message, { cost: { estimated: est } })

    const addLabels = names(a.addLabels)
    const removeLabels = names(a.removeLabels)
    // 索引签名只为让下面按 key 过滤时能取用；键名、值的算法与个数一个字没改。
    const wants: Record<string, boolean> = {
      comment: typeof a.comment === 'string' && a.comment.trim() !== '',
      labels: addLabels.length > 0 || removeLabels.length > 0,
      assignees: Array.isArray(a.assignees),
      text: typeof a.title === 'string' || typeof a.body === 'string' || (a.progress !== undefined && a.progress !== null) || (a.originalWords !== undefined && a.originalWords !== null),
      state: typeof a.close === 'boolean',
    }
    if (!wants.comment && !wants.labels && !wants.assignees && !wants.text && !wants.state) {
      return shell.unsupported('deck_issue_patch', REFUSAL_REASONS.BAD_ARGS, '这次没说清要改什么：至少点名一件（comment / addLabels / removeLabels / assignees / title / body / progress / originalWords / close）。', { cost: { estimated: est } })
    }
    // #1090：进度参数按结构化收口，时间由这里盖（测试用 deps.now 的假时钟）。收不成时整笔拒绝，
    // 不把一段自由文字塞进正文让读的人再猜一遍写法。
    let progressEntry: ProgressEntry | null = null
    if (a.progress !== undefined && a.progress !== null) {
      const parsed = progressEntryFromArg(a.progress)
      if (parsed.entry === null) {
        return shell.unsupported('deck_issue_patch', REFUSAL_REASONS.BAD_ARGS, parsed.problem + '这次一个字都没动。', { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
      }
      progressEntry = { percent: parsed.entry.percent, note: parsed.entry.note, updatedAt: stampNow(toolEntryAt) }
    }
    // #1091：维护者原话按 {text, source} 收口，收不成一样整笔拒绝——原话是一字不改的东西，
    // 宁可不写，也不替调用方补一个猜出来的出处。
    let originalWords: OriginalWordsEntry | null = null
    if (a.originalWords !== undefined && a.originalWords !== null) {
      const parsed = originalWordsFromArg(a.originalWords)
      if (parsed.entry === null) {
        return shell.unsupported('deck_issue_patch', REFUSAL_REASONS.BAD_ARGS, parsed.problem + '这次一个字都没动。', { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
      }
      originalWords = parsed.entry
    }

    // exec 的形状由 DSH 给（会话壳那批还没标类型，见 #1040），三处 exec.signal 各按纯类型断言收口：
    // 取值表达式一字不动，所以转译出来的 JS 与转换前逐字节一致。
    return callDeckSession({ deps: d, opened: pick, session: s, repo: repo, estimate: est, tool: 'deck_issue_patch', sandbox: (await (async function () { try { if (typeof d.sandboxPolicyFor !== 'function') return null; const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), DECK_SANDBOX_TIMEOUT_MS); return (raced && raced.ok === true) ? raced.value : null } catch (eS) { return null } })()), signal: (exec && exec.signal && typeof exec.signal === 'object') ? exec.signal : undefined }, async (c: unknown) => {
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), startedAt: toolEntryAt, now: (typeof d.now === 'function') ? d.now : Date.now })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      const items = []
      const notes = []
      if (scope.effortId) notes.push(mdScopeNote(scope.scene, scope.effortId))
      const touched = [key]
      // 锁内超时的传话格：锁回调里不能直接回整笔回执（那只会结束锁回调），超时原话先记在这里，
      // 锁出来以后统一回 timeoutReply；每次进锁前清零。
      let lockTimeout: string | null = null
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
      // 超时整笔回：执行层超时不是某一项没做成，整笔直接回独立原因码（可重试），不抛给壳。
      const timeoutReply = (msg: string) => ({
        value: {
          status: DECK_STATUS.UNSUPPORTED,
          reason: REFUSAL_REASONS.BACKEND_TIMEOUT,
          text: '这次没改成（超时了：在限时内没等到后端回话，改上没有说不清；先读一次现状再续，不要直接重放）。',
          data: { key: key, backendId: pick.backendId, error: { kind: 'timeout', message: String(msg || '').slice(0, 300) } },
        },
        claimed: { requests: est.requests, points: est.points },
      })
      // 同票并发写互斥：等不到锁就诚实记一笔，不硬挤（单次原子写不拿锁，只有读改写序列拿）。
      const lockOpts = { timeoutMs: numOpt(d.keyLockTimeoutMs) }
      const lockedOut = (step: string) => {
        items.push({ key: key, step: step, status: 'failed', reason: '这张票正被另一次调用改着，这次没动：稍后带同样参数再调一次即可。' })
      }

      // #1298 ⑤⑥⑦：关规格的前置闸。规格不是普通票：它只有在「收口核对通过」之后才允许自动关闭，
      // 而核对通过的证据就是同一次调用里那条评论（逐张核对结论）；实施票没全关时，关规格必须失败并说清缺哪几张。
      // 三道闸的判定与读取都住在 spec-close-guard（一个深模块），这里只把结果翻成回执。
      // 这道闸放在所有写动作之前：宁可一个字都不动地拒绝，也不要先发一条评论、再把关闭拦下来。
      let specClose = false
      if (wants.state && a.close === true) {
        // 拒绝回执：判不过就整笔停下，所有写动作都没开始，所以 items 是空的（一步都没走）。
        // reads 只用于记账：这次读了几次（读这张票 1 次，读了子票清单再加 1 次）。
        const refuseSpecClose = (rule: string, text: string, extra: Record<string, unknown>, reads: number) => ({
          value: {
            status: DECK_STATUS.UNSUPPORTED,
            reason: REFUSAL_REASONS.OVER_CAP,
            text: text,
            data: Object.assign({ key: key, rule: rule }, extra),
          },
          claimed: { requests: reads, points: 3 },
        })
        const gate = await specCloseGuard({ tracker: t, repo: repo, key: key, opCtx: opCtx, hasComment: wants.comment })
        if (gate.kind === 'timeout') return timeoutReply(gate.message)
        if (gate.kind === 'refuse') return refuseSpecClose(gate.rule, gate.text, gate.data, gate.reads)
        specClose = gate.kind === 'ok'
      }

      if (wants.comment) {
        if (sc.outOfBudget()) over('comment')
        else {
          const rawComment = await t.comment(repo, key, a.comment, opCtx)
          const commentTimeout = timeoutMessage(rawComment as unknown as TransportResult)
          if (commentTimeout) return timeoutReply(commentTimeout)
          const r = must(rawComment)
          if (r && r.ok === true) items.push({ key: key, step: 'comment', status: 'ok' })
          else fail('comment', r)
        }
      }

      if (wants.labels) {
        // 标签是整批替换：先读回当前标签，再加上去/摘下来 —— 只有读到了才敢整批替换。
        // 读改写序列持同票锁：同票并发改标签不再丢一次改动；不同票照旧并行。
        if (sc.outOfBudget()) over('labels')
        else {
          lockTimeout = null
          const held = await withKeyLock(repo, key, async () => {
            const rawCur = await t.get(repo, key, {}, opCtx)
            const currentTimeout = timeoutMessage(rawCur as unknown as TransportResult)
            if (currentTimeout) { lockTimeout = currentTimeout; return }
            const cur = must(rawCur)
            if (!cur || cur.ok !== true) { fail('labels', cur); return }
            const have = names(cur.data && cur.data.labels)
            const want = have.concat(addLabels).filter((n) => removeLabels.indexOf(n) < 0)
            const uniq = want.filter((n, i) => want.indexOf(n) === i)
            if (sc.outOfBudget()) { over('labels'); return }
            const rawLabels = await t.setLabels(repo, key, uniq, {}, opCtx)
            const labelsTimeout = timeoutMessage(rawLabels as unknown as TransportResult)
            if (labelsTimeout) { lockTimeout = labelsTimeout; return }
            const r = must(rawLabels)
            if (r && r.ok === true) {
              // 「回了 ok」不等于「标签改成了」：判据只取写后读回这一次（后端的回答本身），
              // 不取写动作自己的回包 —— 后端把回包里的标签写成刚提交的那一份时，拿它当证据等于自问自答，
              // 「写命令成功、盘上没落全」会被报成 ok（#790 同一类：回执只许说读回来的事）。
              const canRead = typeof t.get === 'function' && !sc.outOfBudget()
              const after = canRead ? await t.get(repo, key, {}, opCtx) : null
              const readOk = !!(after && after.ok === true)
              const gotLabels = readOk ? names((after.data || {}).labels) : []
              const missing = uniq.filter((n) => gotLabels.indexOf(n) < 0)
              if (!readOk) {
                items.push({ key: key, step: 'labels', status: 'failed', reason: '写动作回了成功，但写后没读回来（' + (canRead ? '后端原话：' + String((after && after.error && after.error.message) || '没给出原因').slice(0, 160) : '剩余额度不够读回这一次的结果') + '）：标签改成没改成不知道，别当成已经改好。' })
              } else if (missing.length) {
                items.push({ key: key, step: 'labels', status: 'failed', reason: '写动作回了成功，但写后读回来的标签里没有这些（' + missing.join('、') + '）：整批替换没落全，别当成已经改好。' })
              } else items.push({ key: key, step: 'labels', status: 'ok', labels: uniq })
            } else fail('labels', r)
          }, lockOpts)
          if (lockTimeout) return timeoutReply(lockTimeout)
          if (held && held.ok === false && held.timedOut) lockedOut('labels')
        }
      }

      if (wants.assignees) {
        const want = Array.isArray(a.assignees) ? a.assignees.map((x) => String(x)) : []
        if (sc.outOfBudget()) over('assignees')
        else {
          const rawAssign = await t.setAssignees(repo, key, want, {}, opCtx)
          const assigneesTimeout = timeoutMessage(rawAssign as unknown as TransportResult)
          if (assigneesTimeout) return timeoutReply(assigneesTimeout)
          const r = must(rawAssign)
          if (r && r.ok === true) {
            // 「回了 ok」不等于「认领人记上了」：本地 Markdown 只会把状态改成 claimed，认领人的名字不记。
            // 判据只取写后读回这一次（后端的回答本身），不取写动作自己的回包 —— GitHub 房会把回包里的
            // 认领人覆盖成刚提交的那一份（issues-write.ts 的 setAssignees），拿它当证据等于自问自答，
            // 于是「写命令成功、认领人没记上」会被报成 ok（#790 同一类）。
            const canRead = typeof t.get === 'function' && !sc.outOfBudget()
            const after = canRead ? await t.get(repo, key, {}, opCtx) : null
            const readOk = !!(after && after.ok === true)
            // 索引签名只为让下面按字段名读认领人能过编译（读法与默认值一字未改）。
            const back: Record<string, unknown> = readOk ? (after.data || {}) : {}
            const got = Array.isArray(back.assignees) ? back.assignees.map((x) => (x && x.login) || String(x)) : []
            const missing = want.filter((w) => got.indexOf(w) < 0)
            if (!readOk) {
              items.push({ key: key, step: 'assignees', status: 'failed', reason: '写动作回了成功，但写后没读回来（' + (canRead ? '后端原话：' + String((after && after.error && after.error.message) || '没给出原因').slice(0, 160) : '剩余额度不够读回这一次的结果') + '）：认领人记上没记上不知道，别当成已经记上。' })
            } else if (want.length && missing.length) {
              items.push({ key: key, step: 'assignees', status: 'failed', reason: '后端回了 ok，但读回来的票上没有这些认领人（' + missing.join('、') + '）：它可能只改了状态、没记认领人，别当成认领已经记上。' })
            } else items.push({ key: key, step: 'assignees', status: 'ok', assignees: want })
          } else if (r && r.error && r.error.kind === 'unsupported') {
            items.push({ key: key, step: 'assignees', status: 'failed', reason: '这个后端做不到记认领人（后端原话：' + String(r.error.message || '').slice(0, 160) + '）。' })
          } else fail('assignees', r)
        }
      }

      // #1090 / #1091：正文写后核对。写动作回了 ok 不算数，要能读回才算写好：
      // 进度区第一条逐项相同、去掉进度区后其余正文逐字不变；原话逐字读得到、整份正文与计划的新正文逐字相同。
      // 比对与记账住在 shared 层与 body-write / text-write-verify，这里只给「怎么读回」。
      const verifyTextWrite = (plan: BodyWritePlan) => textWriteVerify({ key: key, plan: plan, outOfBudget: sc.outOfBudget(), read: () => t.get(repo, key, {}, opCtx) })

      if (wants.text) {
        // 正文读改写序列持同票锁（单次标题直写也一起 serial，保证与进度/原话回写不交错）。
        if (sc.outOfBudget()) over('text')
        else {
          lockTimeout = null
          const held = await withKeyLock(repo, key, async () => {
            // 索引签名只为让下面按字段名赋值、delete 与取键名能过编译；写进去的键与值一个字没改。
            const patch: Record<string, unknown> = {}
            let bodyProblem: string | null = null
            let beforeBase: string | null = null
            let bodyPlan: BodyWritePlan | null = null
            const explicitBody = typeof a.body === 'string'
            if (typeof a.title === 'string') patch.title = a.title
            if (explicitBody) patch.body = a.body
            // 点到了进度或原话时先拿到写前正文：传了整段 body 就用它，否则读回旧正文。
            if (progressEntry || originalWords) {
              if (explicitBody) beforeBase = a.body as string
              else if (sc.outOfBudget()) bodyProblem = '剩余额度不够读回旧正文：这次正文一个字没动。'
              else {
                const rawCur = await t.get(repo, key, {}, opCtx)
                const currentTimeout = timeoutMessage(rawCur as unknown as TransportResult)
                if (currentTimeout) { lockTimeout = currentTimeout; return }
                const cur = must(rawCur)
                const base = (cur && cur.ok === true && cur.data && typeof cur.data.body === 'string') ? cur.data.body : null
                // 旧正文没读回来时不敢拿空正文覆盖：空写一次就会把整张票冲成只剩进度段（#908 亲历）。
                // 这次宁可报失败，让调用方等能读回再写，或改传整段 body。
                if (base === null) bodyProblem = '旧正文没读回来，不敢拿半截正文覆盖：这次正文没写，等能读回旧正文再写（若急用，改传整段 body）。'
                // 进度区要追加到正文里，先按最小骨架补出「## 进度」；原话区不补（它的位置规则自己管）。
                else beforeBase = progressEntry ? ensureBody(base, 'issue').body : base
              }
              // #1091：两块一起点时按「先进度、再原话」组合（组合规则住在 body-write）。
              // strictRoundTrip 只在「不是整份替换」那一路打开：传了整段 body 时后端会套标题、
              // 补文件头与字段行，读回来的整份正文本来就跟计划不一样，逐字比整份会误报。
              if (beforeBase !== null && bodyProblem === null) {
                const planned = planBodyWrite(beforeBase, progressEntry, originalWords, PROGRESS_BODY_LIMIT, !explicitBody)
                if (planned.plan === null) bodyProblem = planned.problem
                else bodyPlan = planned.plan
              }
              // 幂等：同一段原话 + 同一出处已经在正文里，且这次没有别的正文改动，就不重写正文（只记账）。
              if (bodyProblem === null && bodyPlan !== null && bodyPlan.skipped && !explicitBody && typeof a.title !== 'string') {
                items.push({ key: key, step: 'text', status: 'ok', fields: ['originalWords'], originalWords: originalWords, skipped: true })
                return
              }
              // 计划出来的正文与自己一样时（幂等跳过、又传了整段 body）就别重复写：已经点过 body 的照样写它自己。
              if (bodyProblem === null && bodyPlan !== null) {
                if (explicitBody || bodyPlan.next !== beforeBase) patch.body = bodyPlan.next
                else delete patch.body
              }
            }
            if (bodyProblem !== null) {
              // 正文没写时标题照写；如果只点了正文，这次文字一个字不动，失败原因在这里记好。
              delete patch.body
              fail('text', { error: { message: bodyProblem } })
            }
            if (Object.keys(patch).length > 0) {
              if (sc.outOfBudget()) over('text')
              else {
                const rawText = await t.update(repo, key, patch, opCtx)
                const textTimeout = timeoutMessage(rawText as unknown as TransportResult)
                if (textTimeout) { lockTimeout = textTimeout; return }
                const r = must(rawText)
                if (r && r.ok === true) {
                  if (bodyPlan !== null && Object.prototype.hasOwnProperty.call(patch, 'body')) items.push(await verifyTextWrite(bodyPlan))
                  else items.push({ key: key, step: 'text', status: 'ok', fields: Object.keys(patch) })
                } else fail('text', r)
              }
            }
          }, lockOpts)
          if (lockTimeout) return timeoutReply(lockTimeout)
          if (held && held.ok === false && held.timedOut) lockedOut('text')
        }
      }

      if (wants.state) {
        // #1298 ⑤⑦：规格的关闭必须带着同一次调用里的收口核对评论。评论那一步在上面已经跑了：
        // 它没成（被额度挡下、后端拒了）时，这里不许再调关闭 —— 没有核对评论的关闭算不合规。
        const commentOk = items.some((i) => i.step === 'comment' && i.status === 'ok')
        if (a.close === true && specClose && !commentOk) {
          items.push({ key: key, step: 'close', status: 'failed', reason: '收口核对评论没发出去：按规矩规格不能在没有这条评论的情况下关闭，这一步这次没做。先补发评论（同一次调用里带上 comment）再关。' })
        } else if (sc.outOfBudget()) over(a.close === true ? 'close' : 'reopen')
        else {
          const rawState = a.close === true ? await t.close(repo, key, {}, opCtx) : await t.reopen(repo, key, opCtx)
          const stateTimeout = timeoutMessage(rawState as unknown as TransportResult)
          if (stateTimeout) return timeoutReply(stateTimeout)
          const r = must(rawState)
          const stateStep = a.close === true ? 'close' : 'reopen'
          const wantState = a.close === true ? 'closed' : 'open'
          if (r && r.ok === true) {
            // 「回了 ok」不等于「这张票真的关/开了」：判据只取写后读回这一次（#790 同一类）。
            // 读回来的状态按契约是两态（三房都在归一里落成 open / closed），读不回来就不敢说已经改好。
            const canRead = typeof t.get === 'function' && !sc.outOfBudget()
            const after = canRead ? await t.get(repo, key, {}, opCtx) : null
            const readOk = !!(after && after.ok === true)
            const gotState = readOk ? String(((after.data || {}) as Record<string, unknown>).state || '').toLowerCase() : ''
            if (!readOk) {
              items.push({ key: key, step: stateStep, status: 'failed', reason: '写动作回了成功，但写后没读回来（' + (canRead ? '后端原话：' + String((after && after.error && after.error.message) || '没给出原因').slice(0, 160) : '剩余额度不够读回这一次的结果') + '）：这张票现在是不是 ' + wantState + ' 不知道，别当成已经改好。' })
            } else if (!gotState) {
              items.push({ key: key, step: stateStep, status: 'failed', reason: '写动作回了成功，但写后读回来的票没带状态字段，判不了这张票现在是不是 ' + wantState + '：别当成已经改好。' })
            } else if (gotState !== wantState) {
              items.push({ key: key, step: stateStep, status: 'failed', reason: '写动作回了成功，但写后读回来的状态是 ' + gotState + '，不是 ' + wantState + '：别当成已经改好。' })
            } else items.push({ key: key, step: stateStep, status: 'ok' })
          } else fail(stateStep, r)
        }
      }

      // 写后真状态：能读回就读回一次，读不回来也如实说（别让 AI 以为已经确认过了）。
      // 诚实性由后端保证（本地后端在落盘前核对单例、坏了就返回失败，本层按逐项原样记失败）：本层不判后端，
      // 后端做不到的那一步在上面已经记成失败，顶层按逐项自然非成功。
      const back = (typeof t.get === 'function' && !sc.outOfBudget()) ? await t.get(repo, key, {}, opCtx) : null
      const readBack = (back && back.ok === true) ? back.data : null
      if (!readBack) notes.push('写后没读回来（后端原话：' + String((back && back.error && back.error.message) || '没给出原因').slice(0, 160) + '）：上面每步是照后端的回答记的。')
      // #1273：整票只装一份，放在 data.ticket（api 文档承诺「返回值就是写后的真状态」，工作路线也按它记账）；
      // 顶层 readBack 只放核对用的三格。以前顶层也塞整票，渲染层靠对象引用相等去重只在同进程成立，
      // 一旦经过连接、fetch 或 PTC 会话的 JSON 边界，同一张票就连正文带评论整份进上下文两遍。
      // 三格与 data.ticket 出自同一次写后回读，所以「readBack 说改成什么了」和「data.ticket 里是什么」始终一致。
      const readBackRecord = (readBack || {}) as Record<string, unknown>
      const readBackDigest = readBack ? { key: String(readBackRecord.key ?? key), state: readBackRecord.state == null ? null : String(readBackRecord.state), updatedAt: readBackRecord.updatedAt ?? null } : null
      const status = statusOfItems(items)
      if (status !== DECK_STATUS.OK) notes.push('有的步骤没成，逐条原因在上面：别把没成的那一步当成已经改好。')
      return {
        value: {
          status: status,
          reason: status === DECK_STATUS.OK ? '' : REFUSAL_REASONS.BACKEND_UNSUPPORTED,
          text: '票 ' + key + '：这次点了 ' + items.length + ' 步，成了 ' + items.filter((i) => i.status === 'ok').length + ' 步。',
          workRouteDetail: a.workRouteDetail,
          data: { requested: Object.keys(wants).filter((k) => wants[k]), ticket: readBack },
          items: items,
          readBack: readBackDigest,
          notes: notes,
          touched: touched,
        },
        claimed: { requests: est.requests, points: est.points },
      }
    })
  }

  return { definition: definition, run: run }
}
