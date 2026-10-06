/**
 * version-control-core/src/rules.ts —— 四个写操作的能不能开始（纯函数）
 *
 * 单一入口 judge(状态, 操作)，内部按操作分到四个纯函数。结果三态：
 * allow（能做）/ warn（能做但要提醒）/ block（现在做会出错）。
 * 理由是稳定标识符（REASONS 表），中文话术在客户端词表里。
 * 规则只判断能不能开始，不判断做成没做成；“建议不要做”用返回值，不抛异常。
 *
 * 拉取语义（#813 定案 6）：取回加整合；能快进就快进，能干净合并就合并；
 * 会产生冲突就在动手前停住（dirty-tree / conflicts / mid-operation 全是 block）。
 */
import type { Decision, FirstScreen, Operation } from './ports.js'

export const REASONS: Record<string, string> = {
  'ok': 'ok',
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
}

function midReasons(s: FirstScreen): string[] {
  const out: string[] = []
  if (s.repo.merging) out.push('mid-merge')
  if (s.repo.rebasing) out.push('mid-rebase')
  if (s.repo.cherryPicking || s.repo.reverting) out.push('mid-cherry-revert')
  return out
}

function judgeStage(s: FirstScreen): Decision {
  if (s.repo.bare) return { verdict: 'block', reasons: ['bare-repo'] }
  if (s.unstagedCount === 0) return { verdict: 'block', reasons: ['nothing-to-stage'] }
  const mid = midReasons(s)
  if (mid.length > 0) return { verdict: 'warn', reasons: mid }
  return { verdict: 'allow', reasons: ['ok'] }
}

function judgeCommit(s: FirstScreen): Decision {
  if (s.repo.bare) return { verdict: 'block', reasons: ['bare-repo'] }
  if (s.conflictCount > 0) return { verdict: 'block', reasons: ['conflicts-unresolved'] }
  if (s.stagedCount === 0) return { verdict: 'block', reasons: ['nothing-staged'] }
  const mid = midReasons(s)
  // 游离头上提交本身合法（git 允许），但提交完就只剩 reflog 能把它找回来——至少提醒一句（#819 复审 P2-8c）。
  if (s.identity.detached) return { verdict: 'warn', reasons: ['detached-head'].concat(mid) }
  if (mid.length > 0) return { verdict: 'warn', reasons: mid }
  return { verdict: 'allow', reasons: ['ok'] }
}

function judgePull(s: FirstScreen): Decision {
  if (s.repo.bare) return { verdict: 'block', reasons: ['bare-repo'] }
  if (s.identity.detached) return { verdict: 'block', reasons: ['detached-head'] }
  if (s.identity.sync === 'no-upstream') return { verdict: 'block', reasons: ['no-upstream'] }
  if (s.identity.sync === 'upstream-gone') return { verdict: 'block', reasons: ['upstream-gone'] }
  if (s.conflictCount > 0) return { verdict: 'block', reasons: ['conflicts-unresolved'] }
  const mid = midReasons(s)
  if (mid.length > 0) return { verdict: 'block', reasons: mid }
  if (s.stagedCount > 0 || s.unstagedCount > 0) return { verdict: 'block', reasons: ['dirty-tree'] }
  if (s.identity.basisMs === null) return { verdict: 'warn', reasons: ['basis-unknown'] }
  return { verdict: 'allow', reasons: ['ok'] }
}

function judgePush(s: FirstScreen): Decision {
  if (s.repo.bare) return { verdict: 'block', reasons: ['bare-repo'] }
  if (s.identity.detached) return { verdict: 'block', reasons: ['detached-head'] }
  if (s.identity.sync === 'no-upstream') return { verdict: 'block', reasons: ['no-upstream'] }
  if (s.identity.sync === 'upstream-gone') return { verdict: 'block', reasons: ['upstream-gone'] }
  if (s.conflictCount > 0) return { verdict: 'block', reasons: ['conflicts-unresolved'] }
  // 合并/变基/拣选/回退进行中时，推上去的是**动手之前**那次提交，用户却以为推的是这次合并的结果：
  // 与拉取同一条边界，拦住（#819 复审 P2-8a）。提交那条故意不同：合并进行中提交正是收尾那一步，只提醒。
  const mid = midReasons(s)
  if (mid.length > 0) return { verdict: 'block', reasons: mid }
  // 落后远端时推上去会被拒（非快进），与拉取那条边界统一成 block（#819 复审 P2-8b）。
  if (s.identity.behind > 0) return { verdict: 'block', reasons: ['behind-remote'] }
  if (s.identity.basisMs === null) return { verdict: 'warn', reasons: ['basis-unknown'] }
  return { verdict: 'allow', reasons: ['ok'] }
}

/** 更新远方记录：只更新远端跟踪引用，不碰工作树与索引，所以游离头、未暂存、冲突、
 *  进行中、落后远端、依据未知都不挡；落后与依据未知正是要用它来修复的。裸仓库沿用不可用
 *  （与拉取推送一致，面板裸仓不提供写入口）。 */
function judgeFetch(s: FirstScreen): Decision {
  if (s.repo.bare) return { verdict: 'block', reasons: ['bare-repo'] }
  return { verdict: 'allow', reasons: ['ok'] }
}

export function judge(screen: FirstScreen, op: Operation): Decision {
  switch (op) {
    case 'stage': return judgeStage(screen)
    case 'commit': return judgeCommit(screen)
    case 'pull': return judgePull(screen)
    case 'push': return judgePush(screen)
    case 'fetch': return judgeFetch(screen)
    default: return { verdict: 'block', reasons: ['unknown-operation'] }
  }
}

export const RULES_SOURCE = 'version-control-core/src/rules.ts'
