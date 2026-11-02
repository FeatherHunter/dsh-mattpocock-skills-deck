// src/deck/tools/issue-patch-labels.ts —— deck_issue_patch 的「改标签」一步（#1790 缺陷 A 抽出）。
//
// 为什么单独成一份：issue-patch.ts 的有效行贴着每文件 350 行的上限，而这一步自带一段完整的
// 「锁内读改写 + 写后读回核对 + 状态归一合并写」序列，搬出来以后主文件只剩调度，这一步也能单独读。
//
// 这一步同时承担 #1790 的状态归一：调用方给了 resolveStatus 时，chosen 是选定的状态，
// 冲突两侧里没被选中的名字要先从整批标签里去掉，再连同 {status: chosen} 一起交给后端 ——
// 后端会按这一个状态写可见 Status 行、只把非 triage 写进隐藏名单，并记下被舍弃的那一侧。
// 归一与改标签合在同一次 setLabels 里，盘上要么是旧样子、要么是新样子，不会停在中间。
import { withKeyLock } from '../shell/write-mutex.js'
import type { KeyLockOpts } from '../shell/write-mutex.js'
import { must, timeoutMessage } from '../shell/backend-transport.js'
import type { TransportResult } from '../shell/backend-transport.js'
import { REFUSAL_REASONS } from '../shell/call-shell.js'
import type { StatusConflict } from '../../tracker/contract/entities.js'
import { namesOf, refusalReply } from './issue-patch-status.js'
// #1832：triage 状态是替换而不是叠加；「哪几枚算状态」的判断住 deck 纯规则侧。
import { isTriageStateLabel, triageStatesIn } from '../rules/triage-state.js'

/** 后端回包形状（运行时真值，契约层还没建模）：这里只读到 error.message / error.kind 与 data.labels。 */
type UnknownRecord = Record<string, unknown>
type CallResult = { ok?: boolean; data?: UnknownRecord; error?: { kind?: unknown; message?: unknown } } | null | undefined
/** 本步真正用到的两个后端操作：读当前票、整批换标签。 */
type LabelsTracker = {
  get: (repo: unknown, key: string, opts: UnknownRecord, opCtx: unknown) => Promise<unknown>
  setLabels: (repo: unknown, key: string, labels: string[], opts: UnknownRecord, opCtx: unknown) => Promise<unknown>
}

/** 主文件递进来的运行时袋子：预算、回执与失败记录都留在调用方，这里只管改这一批标签。 */
export interface LabelsStepInput {
  key: string
  repo: unknown
  tracker: unknown
  opCtx: unknown
  items: UnknownRecord[]
  notes: string[]
  addLabels: string[]
  removeLabels: string[]
  /** resolveStatus 选定的状态（没冲突或没给 resolveStatus 时为空）。 */
  chosen: string | null
  /** 读侧报的那一份状态冲突（没有就是空）。 */
  conflict: StatusConflict | null
  /** 这次读回来的当前状态；后端不用可见状态行模型时为空串。 */
  statusValue: string
  /** 读回里带了「状态从哪来」才说明后端用可见状态行模型（决定下面那句提示加不加）。 */
  statusModel: boolean
  estimate: { requests?: unknown; points?: unknown }
  lockOpts: KeyLockOpts
  outOfBudget: () => boolean
  timeoutReply: (message: string) => unknown
  fail: (step: string, result: CallResult) => void
  over: (step: string) => void
  lockedOut: (step: string) => void
}

/** 结局：继续跑后面的步骤，或者整笔回一个拒绝回执（此时别的步骤一步都还没写）。 */
export type LabelsStepResult = { kind: 'done' } | { kind: 'reply'; reply: unknown }

/** 比标签名用的统一拼写：GitHub 的标签名不分大小写，判「是不是同一枚」一律按小写比。 */
function lower(name: string): string {
  return String(name).trim().toLowerCase()
}

/**
 * 跑「改标签」这一步。锁内先读回当前标签再整批替换：只有读到了才敢整批写，
 * 读改写序列持同票锁，同票并发改标签不会丢一次改动；不同票照旧并行。
 */
export async function runLabelsStep(input: LabelsStepInput): Promise<LabelsStepResult> {
  const t = input.tracker as LabelsTracker
  const items = input.items
  const key = input.key
  const chosen = input.chosen
  const conflict = input.conflict
  // 锁内超时的传话格：锁回调里不能直接回整笔回执（那只会结束锁回调），超时原话先记在这里，锁出来再统一回。
  let lockTimeout: string | null = null
  // 带状态归一写的标签被后端驳回时的回执格：它不为空时别的步骤一步都还没开始，锁外整笔回。
  let refused: unknown = null

  // removeLabels 里点名的若是当前状态（读回来的可见 Status 值），摘标签不会清掉状态，
  // 回执必须把这一点说清，否则调用方会以为票已经变回「未分流」。状态词表在后端，这里只比读回来的值。
  if (input.statusModel && input.statusValue && input.removeLabels.indexOf(input.statusValue) >= 0) {
    input.notes.push('removeLabels 里的 ' + input.statusValue + ' 是状态而不是普通标签：本地 Markdown 的状态住在可见 Status 行，摘标签不会清掉状态；要改状态请用 addLabels 带一枚 triage，或关闭这张票。')
  }

  const held = await withKeyLock(input.repo, key, async () => {
    const rawCur = await t.get(input.repo, key, {}, input.opCtx)
    const currentTimeout = timeoutMessage(rawCur as unknown as TransportResult)
    if (currentTimeout) { lockTimeout = currentTimeout; return }
    const cur = must(rawCur) as CallResult
    if (!cur || cur.ok !== true) { input.fail('labels', cur); return }
    // 读回来的标签是全量（本地 Markdown 读侧会把状态合成一枚 triage）：整批替换先原样收下，
    // 由后端的 setLabels 自己把 triage 写进可见 Status 行、只把非 triage 写进隐藏名单。
    // 规格 / 地图这类容器的非状态标签原样保留，不会因为下面的过滤而丢掉。
    const currentNames = namesOf(cur.data && cur.data.labels)
    // #1832：triage 状态是替换而不是叠加。addLabels 里恰有一枚状态时，先把读回来的旧状态全部摘掉，
    // 再把要切到的那一枚并进来；摘了哪几枚写进回执（notes），否则调用方只知道「加了」，不知道旧状态不在了。
    // 一次给两枚以上状态在 issue-patch 入口就整笔拒绝了，不会走到这里；真走到了也按「一枚都不摘」原样并。
    const addStates = triageStatesIn(input.addLabels)
    const addState = addStates.length === 1 ? addStates[0] : ''
    const keepState = lower(addState)
    const removeLower = input.removeLabels.map(lower)
    const oldStates = triageStatesIn(currentNames)
    const droppedStates = addState ? oldStates.filter((n) => lower(n) !== keepState) : []
    let wanted = currentNames.concat(input.addLabels).filter((n) => removeLower.indexOf(lower(n)) < 0)
    if (addState) wanted = wanted.filter((n) => !isTriageStateLabel(n) || lower(n) === keepState)
    // 去重按小写比（GitHub 的标签名不分大小写），但保留第一次出现的原拼写：
    // `Ready-For-Agent` 与 `ready-for-agent` 是同一枚，票上只留一枚。
    const seen: string[] = []
    for (const n of wanted) {
      if (seen.map(lower).indexOf(lower(n)) < 0) seen.push(n)
    }
    let uniq = seen
    // 真冲突且这次选了 resolveStatus：冲突两侧里没被选中的名字一起从整批里去掉，
    // 归一与改标签在同一次 setLabels 里写完（后端会按 status 选项写可见行并记历史）。
    if (chosen !== null && conflict !== null) {
      const drop = [lower(conflict.visible)].concat(conflict.hidden.map(lower))
      uniq = uniq.filter((n) => drop.indexOf(lower(n)) < 0)
    }
    if (input.outOfBudget()) { input.over('labels'); return }
    const labelStatusOpt = chosen !== null ? { status: chosen } : {}
    const rawLabels = await t.setLabels(input.repo, key, uniq, labelStatusOpt, input.opCtx)
    const labelsTimeout = timeoutMessage(rawLabels as unknown as TransportResult)
    if (labelsTimeout) { lockTimeout = labelsTimeout; return }
    const r = must(rawLabels) as CallResult
    if (r && r.ok === true) {
      // 「回了 ok」不等于「标签改成了」：判据只取写后读回这一次（后端的回答本身），
      // 不取写动作自己的回包 —— 后端把回包里的标签写成刚提交的那一份时，拿它当证据等于自问自答，
      // 「写命令成功、盘上没落全」会被报成 ok（#790 同一类：回执只许说读回来的事）。
      const canRead = typeof t.get === 'function' && !input.outOfBudget()
      const after = (canRead ? await t.get(input.repo, key, {}, input.opCtx) : null) as CallResult
      const readOk = !!(after && after.ok === true)
      const afterData: UnknownRecord = (after && after.data) || {}
      const gotLabels = readOk ? namesOf(afterData.labels) : []
      // 读回来的拼写可能被后端归一过（本地 Markdown 房统一写小写），比对同样按小写来，否则
      // `Ready-For-Agent` 写进去、读回 `ready-for-agent` 会被误报成「整批替换没落全」（#1832 审查）。
      const gotLower = gotLabels.map(lower)
      const missing = uniq.filter((n) => gotLower.indexOf(lower(n)) < 0)
      if (!readOk) {
        const afterMsg = String((after && after.error && after.error.message) || '没给出原因').slice(0, 160)
        items.push({ key: key, step: 'labels', status: 'failed', reason: '写动作回了成功，但写后没读回来（' + (canRead ? '后端原话：' + afterMsg : '剩余额度不够读回这一次的结果') + '）：标签改成没改成不知道，别当成已经改好。' })
      } else if (missing.length) {
        items.push({ key: key, step: 'labels', status: 'failed', reason: '写动作回了成功，但写后读回来的标签里没有这些（' + missing.join('、') + '）：整批替换没落全，别当成已经改好。' })
      } else {
        if (droppedStates.length) input.notes.push('这张票（' + key + '）：这次把 triage 状态换成「' + addState + '」，旧状态标签已从票上摘掉：' + droppedStates.join('、') + '（状态是替换，不会两枚并存）。')
        items.push({ key: key, step: 'labels', status: 'ok', labels: uniq })
      }
    } else if (chosen !== null && r && r.error && String(r.error.kind) === 'parse') {
      // 带着状态归一写的标签被后端驳回，且驳回原因是「状态与标签两处对不上」：
      // 标签与状态都还一个字没动，别的步骤一次都没开始，整笔回拒绝，让调用方先统一口径。
      const msg = String((r.error && r.error.message) || '后端没给出原因').slice(0, 300)
      refused = refusalReply(key, REFUSAL_REASONS.BAD_ARGS, '这次给的标签里的状态与 resolveStatus 选的那一侧对不上（后端原话：' + msg + '）：标签与状态都还一个字没动，别的步骤也没做。', { statusConflict: conflict }, [{ key: key, step: 'status', status: 'failed', reason: msg }], input.estimate, 1)
    } else input.fail('labels', r)
  }, input.lockOpts)

  if (lockTimeout) return { kind: 'reply', reply: input.timeoutReply(lockTimeout) }
  if (refused !== null) return { kind: 'reply', reply: refused }
  if (held && (held as { ok?: boolean; timedOut?: boolean }).ok === false && (held as { timedOut?: boolean }).timedOut) input.lockedOut('labels')
  return { kind: 'done' }
}
