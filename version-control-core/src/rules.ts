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
  if (s.identity.behind > 0) return { verdict: 'warn', reasons: ['behind-remote'] }
  if (s.identity.basisMs === null) return { verdict: 'warn', reasons: ['basis-unknown'] }
  return { verdict: 'allow', reasons: ['ok'] }
}

export function judge(screen: FirstScreen, op: Operation): Decision {
  switch (op) {
    case 'stage': return judgeStage(screen)
    case 'commit': return judgeCommit(screen)
    case 'pull': return judgePull(screen)
    case 'push': return judgePush(screen)
    default: return { verdict: 'block', reasons: ['unknown-operation'] }
  }
}

export const RULES_SOURCE = 'version-control-core/src/rules.ts'
