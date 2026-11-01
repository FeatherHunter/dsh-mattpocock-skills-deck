/**
 * src/shared/version-control/src/rules.ts —— 四个写操作的能不能开始（纯函数）
 *
 * 单一入口 judge(状态, 操作)，内部按操作分到四个纯函数。结果三态：
 * allow（能做）/ warn（能做但要提醒）/ block（现在做会出错）。
 * 理由是稳定标识符（REASONS 表），中文话术在客户端词表里。
 * 规则只判断能不能开始，不判断做成没做成；“建议不要做”用返回值，不抛异常。
 *
 * 拉取语义（#813 定案 6，#976 改为警告）：取回加整合；能快进就快进，能干净合并就合并；
 * 冲突与进行中仍在动手前停住（conflicts / mid-operation 是 block）。工作区不干净是 warn：
 * 只快进的拉取在不相交时本来能成，相交时命令行的只快进会如实拒绝，面板不再用个数一律拦住。
 *
 * #1737 起的公共约定（域票扩展点，改这里之前先读）：
 *   1. 判定结果只能由 decide(三态, 理由标识符数组) 构造，别手写 { verdict, reasons }；
 *      decide 会复制数组，调用方事后改自己手里那份不影响判定结果（纯函数约定）。
 *   2. 新理由只能先加进 REASONS 表（标识符全小写、连字符分隔），再在 judgeXxx 里用；
 *      中文话术在客户端词表里按同一个标识符加，不在这里写句子。
 *   3. 新操作：在 ports.ts 的 Operation 联合里加名字，在 judge 的 switch 里挂一个 judgeXxx，
 *      再在 tests/verify-version-control-rules.ts 的场景表里补正反例；漏挂时 default 会
 *      block + unknown-operation，门禁会替你把这条路径测到。
 *   4. 再加判定分支时先用 tests/verify-version-control-rules.ts 的场景工厂写会失败的场景，
 *      再回来改这里；不要为了过测试改场景。
 */
import type { Decision, FirstScreen, Operation, Verdict } from './ports.js'

/** 判定理由的固定词表：标识符 -> 标识符（键值相同，只为让「有哪些理由」这一处固定下来）。 */
export const REASONS = {
  ok: 'ok',
  'nothing-to-stage': 'nothing-to-stage',
  'nothing-staged': 'nothing-staged',
  'no-upstream': 'no-upstream',
  'upstream-gone': 'upstream-gone',
  'detached-head': 'detached-head',
  'conflicts-unresolved': 'conflicts-unresolved',
  'mid-merge': 'mid-merge',
  'mid-rebase': 'mid-rebase',
  'mid-cherry-revert': 'mid-cherry-revert',
  'dirty-tree': 'dirty-tree',
  'behind-remote': 'behind-remote',
  'basis-unknown': 'basis-unknown',
  'bare-repo': 'bare-repo',
  'unknown-operation': 'unknown-operation',
} as const

/** 能出现在 Decision.reasons 里的全部标识符；域票加理由时类型会逼着你先改 REASONS。 */
export type ReasonId = keyof typeof REASONS

/** 词表键的稳定顺序（门禁与命令面板都用它列全部理由）。 */
export const REASON_IDS: ReasonId[] = Object.keys(REASONS) as ReasonId[]

/**
 * 判定结果的唯一构造器：三态 + 固定词表里的理由标识符。
 * 返回新对象、复制理由数组：判定是纯函数，调用方拿到的结果不与任何内部常量共享可变数组。
 */
export function decide(verdict: Verdict, reasons: ReasonId[]): Decision {
  return { verdict, reasons: reasons.slice() }
}

function midReasons(s: FirstScreen): ReasonId[] {
  const out: ReasonId[] = []
  if (s.repo.merging) out.push('mid-merge')
  if (s.repo.rebasing) out.push('mid-rebase')
  if (s.repo.cherryPicking || s.repo.reverting) out.push('mid-cherry-revert')
  return out
}

function judgeStage(s: FirstScreen): Decision {
  if (s.repo.bare) return decide('block', ['bare-repo'])
  if (s.unstagedCount === 0) return decide('block', ['nothing-to-stage'])
  const mid = midReasons(s)
  if (mid.length > 0) return decide('warn', mid)
  return decide('allow', ['ok'])
}

function judgeCommit(s: FirstScreen): Decision {
  if (s.repo.bare) return decide('block', ['bare-repo'])
  if (s.conflictCount > 0) return decide('block', ['conflicts-unresolved'])
  if (s.stagedCount === 0) return decide('block', ['nothing-staged'])
  const mid = midReasons(s)
  // 游离头上提交本身合法（git 允许），但提交完就只剩 reflog 能把它找回来——至少提醒一句（#819 复审 P2-8c）。
  if (s.identity.detached) return decide('warn', ['detached-head', ...mid])
  if (mid.length > 0) return decide('warn', mid)
  return decide('allow', ['ok'])
}

function judgePull(s: FirstScreen): Decision {
  if (s.repo.bare) return decide('block', ['bare-repo'])
  if (s.identity.detached) return decide('block', ['detached-head'])
  if (s.identity.sync === 'no-upstream') return decide('block', ['no-upstream'])
  if (s.identity.sync === 'upstream-gone') return decide('block', ['upstream-gone'])
  if (s.conflictCount > 0) return decide('block', ['conflicts-unresolved'])
  const mid = midReasons(s)
  if (mid.length > 0) return decide('block', mid)
  // #976：工作区不干净不再直接等于不能拉。只快进的拉取在本地改动与远端新提交不相交时能成，
  // 相交时命令行的只快进会拒绝并点名文件，面板如实透出失败即可，所以这里只提醒不拦住。
  if (s.stagedCount > 0 || s.unstagedCount > 0) return decide('warn', ['dirty-tree'])
  if (s.identity.basisMs === null) return decide('warn', ['basis-unknown'])
  return decide('allow', ['ok'])
}

function judgePush(s: FirstScreen): Decision {
  if (s.repo.bare) return decide('block', ['bare-repo'])
  if (s.identity.detached) return decide('block', ['detached-head'])
  if (s.identity.sync === 'no-upstream') return decide('block', ['no-upstream'])
  if (s.identity.sync === 'upstream-gone') return decide('block', ['upstream-gone'])
  if (s.conflictCount > 0) return decide('block', ['conflicts-unresolved'])
  // 合并/变基/拣选/回退进行中时，推上去的是**动手之前**那次提交，用户却以为推的是这次合并的结果：
  // 与拉取同一条边界，拦住（#819 复审 P2-8a）。提交那条故意不同：合并进行中提交正是收尾那一步，只提醒。
  const mid = midReasons(s)
  if (mid.length > 0) return decide('block', mid)
  // 落后远端时推上去会被拒（非快进），与拉取那条边界统一成 block（#819 复审 P2-8b）。
  if (s.identity.behind > 0) return decide('block', ['behind-remote'])
  if (s.identity.basisMs === null) return decide('warn', ['basis-unknown'])
  return decide('allow', ['ok'])
}

/** 更新远方记录：只更新远端跟踪引用，不碰工作树与索引，所以游离头、未暂存、冲突、
 *  进行中、落后远端、依据未知都不挡；落后与依据未知正是要用它来修复的。裸仓库沿用不可用
 *  （与拉取推送一致，面板裸仓不提供写入口）。 */
function judgeFetch(s: FirstScreen): Decision {
  if (s.repo.bare) return decide('block', ['bare-repo'])
  return decide('allow', ['ok'])
}

export function judge(screen: FirstScreen, op: Operation): Decision {
  switch (op) {
    case 'stage': return judgeStage(screen)
    case 'commit': return judgeCommit(screen)
    case 'pull': return judgePull(screen)
    case 'push': return judgePush(screen)
    case 'fetch': return judgeFetch(screen)
    default: return decide('block', ['unknown-operation'])
  }
}

export const RULES_SOURCE = 'src/shared/version-control/src/rules.ts'
