/**
 * version-control-core/src/write-reasons.ts —— 写操作的失败种类与中文句子（#841，纯函数）
 *
 * 单一真源：宿主只透传 reason 与 hint，不在宿主里另造措辞（#841 硬要求）。
 * 两张表分工：
 *   · 票据类（ticket-missing / ticket-op-mismatch / ticket-expired / stale-head / stale-index /
 *     fingerprint-unavailable / target-changed）由宿主判定，**不看 git 文本**；
 *   · git 文本类由本文件的 classifyWriteFailure 按 op 归类（同一个词在不同 op 下意思不同）。
 * 传输档（need-credentials / auth-rejected / no-permission / network / stalled / timeout /
 * budget-exhausted / spawn-failed / env / args）归 #839 的 hintFor，本文件一个字不重写。
 */
import type { WriteOp } from './ports.js'

/** 写层稳定标识符 → 一句能照着做的中文话。 */
export const WRITE_REASONS: Record<string, string> = {
  'ticket-missing': '这次确认已经失效（可能已经点过、或页面重开过）。请重新看一眼再点。',
  'ticket-op-mismatch': '这次确认不是给这个动作的。请重新看一眼再点。',
  'ticket-expired': '确认超过 2 分钟没点，已经作废。请重新看一眼再点。',
  'stale-head': '仓库在你确认之后又变了（当前提交已经不是你看的那一个）。请重新看一眼再点。',
  'stale-index': '你确认之后暂存区又变了，提交进去的会和你看到的不一样。请重新看一眼再点。',
  'fingerprint-unavailable': '这次读不到暂存区的完整清单（输出太大或被截断），提交这一步做不了。请分开暂存后再试。',
  'target-changed': '推送目标在你确认之后变了。请重新确认一次。',
  'empty-message': '提交信息不能为空。',
  'message-too-long': '提交信息太长了（标题最多 200 字、整体最多 5000 字）。',
  'bad-paths': '这次没有给出要暂存的文件，或路径形状不对。',
  'bad-target': '这次没有解析出可用的推送目标。请重新确认一次。',
  'need-remote-choice': '这个仓库有多个远端，面板不替你挑。请选一个远端再确认。',
  'no-remote': '这个仓库还没有配置任何远端。请先在侧栏终端里加一个远端（git remote add）再回来推送。',
  'nothing-to-stage': '没有可暂存的东西。',
  'nothing-staged': '暂存区是空的，没有可提交的内容。',
  'intent-to-add': '暂存区里有「只标记了要加、内容还没定」的条目（git add -N）。这种条目提交进去的会是工作区此刻的内容，面板不替你赌。请到侧栏终端处理这个文件。',
  // 拉取被拒时 fetch 那一半已经成功（远端的新提交已经取回来了）——话术要说清这一点，别让用户以为白跑一趟。
  'non-fast-forward': '远端的新提交已经取回来了，但本地和它分开了，不能快进。面板只做快进，请到侧栏终端合并或变基。',
  'conflict': '本地和远端都有新提交，直接拉会打架。面板不替你合并——去侧栏终端跑 git pull，处理完冲突再回来。',
  'hooks-failed': '仓库的提交钩子没有通过，提交没有发生。请到侧栏终端跑一次 git commit 看钩子的输出。',
  'head-moved': '仓库的 HEAD 已经变了（可能这次提交成功了，也可能是别的程序提交的）。请看一眼提交历史再决定。',
  'unknown-write-failure': 'git 报了一个我们没归类的失败；上面那行是它的原话。',
}

/** 取一句话；表里没有的按兜底那句（照 Rules 的同一风格，绝不返回空串）。 */
export function writeHintFor(reason: string): string {
  return WRITE_REASONS[String(reason || '')] || WRITE_REASONS['unknown-write-failure']
}

/** 提交信息的两条轻校验（D4）：标题 ≤200、整体 ≤5000；空一律拒绝。 */
export function messageProblem(message: string): string | null {
  const s = String(message === undefined || message === null ? '' : message)
  if (s.trim() === '') return 'empty-message'
  if (s.length > 5000) return 'message-too-long'
  const firstLine = s.split('\n')[0]
  if (firstLine.length > 200) return 'message-too-long'
  return null
}

/** 暂存路径的形状：至少一条、非空、不含 NUL。返回 null 表示没问题。 */
export function pathsProblem(paths: unknown): string | null {
  if (!Array.isArray(paths) || paths.length === 0) return 'bad-paths'
  for (const p of paths) {
    if (typeof p !== 'string' || p === '' || p.indexOf('\u0000') >= 0) return 'bad-paths'
    // 再挡两类会被 git 当别的东西解释的形状（写侧输不起）：'-x.txt' 会被当未知开关，
    // ':(exclude)*.txt' 是 pathspec 魔法（--literal-pathspecs 已关掉魔法与通配，这里补一道）。
    if (p.charAt(0) === '-' || p.charAt(0) === ':') return 'bad-paths'
  }
  return null
}

/** git 文本 → 写层 reason；按 op 分（同一个词在不同 op 下意思不同），认不出回兜底。 */
export function classifyWriteFailure(op: WriteOp, exitCode: number, stderrText: string): string {
  if (exitCode === 0) return 'unknown-write-failure'
  const t = String(stderrText || '').toLowerCase()
  if (op === 'commit') {
    if (/nothing to commit|no changes added to commit|nothing added to commit/.test(t)) return 'nothing-staged'
    if (/hook|husky|lint-staged|commit-msg|pre-commit/.test(t)) return 'hooks-failed'
    return 'unknown-write-failure'
  }
  if (op === 'pull') {
    if (/not possible to fast-forward|fatal: not possible to fast-forward/.test(t)) return 'non-fast-forward'
    if (/conflict|automatic merge failed|fix conflicts/.test(t)) return 'conflict'
    return 'unknown-write-failure'
  }
  if (op === 'push') {
    if (/non-fast-forward|fetch first|updates were rejected|rejected.*non-fast-forward/.test(t)) return 'non-fast-forward'
    if (/\[rejected\]|failed to push some refs/.test(t)) return 'non-fast-forward'
    return 'unknown-write-failure'
  }
  return 'unknown-write-failure'
}

export const WRITE_REASONS_SOURCE = 'version-control-core/src/write-reasons.ts'
