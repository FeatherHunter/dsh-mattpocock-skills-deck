/**
 * version-control-core/src/commands.ts —— 命令口径与采集项清单（纯函数）
 *
 * 参数与解析同处一个被测试的单元（#813 定案 1）：“我发的正是我解析的那套”有人验。
 * 核心既拼命令又解析，宿主只起进程。核心不知道只读和写的区别。
 * 写命令的参数口径不在这一批，但读写同表，将来加行即可。
 *
 * 固定前缀挡掉用户改过的全局配置（调研第六节）：--no-optional-locks（后台不抢锁）、
 * core.quotepath=false（双保险，主力是 -z）、color.ui=false（管道下本已无色）、
 * i18n.logOutputEncoding=UTF-8（提交标题中文不乱码）。status.relativePaths 不在此——
 * 全量命令带 -z，-z 输出恒为仓库根相对（调研 7.1）。
 * 重命名显式开 --find-renames（用户配 diff.renames=false 也能看到重命名，故事 19 需要）。
 */
import type { CollectionKey } from './ports.js'

export const COLLECTION_KEYS: CollectionKey[] = ['status', 'worktrees', 'refs', 'log', 'diffFiles', 'patch']

/** 首屏一次读全的五个（patch 按需，不在首屏内）。 */
export const FIRST_SCREEN_KEYS: CollectionKey[] = ['status', 'worktrees', 'refs', 'log', 'diffFiles']

/** 运行中标记：核心给五个路径名，宿主查存在（#822：没有它最该拦的规则就没有输入）。 */
export const RUNNING_MARKER_PATHS: string[] = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'rebase-merge',
  'rebase-apply',
]

export function fixedPrefix(): string[] {
  return [
    '--no-optional-locks',
    '-c', 'core.quotepath=false',
    '-c', 'color.ui=false',
    '-c', 'i18n.logOutputEncoding=UTF-8',
  ]
}

/** 第 0 步：确认是不是仓库（不进采集清单；失败直接返回，不白起后续进程）。 */
export function stepZeroArgs(): string[] {
  return ['rev-parse', '--absolute-git-dir', '--is-inside-work-tree', '--is-bare-repository']
}

export interface CommandSpec {
  key: CollectionKey
  subcommand: string
  args: string[]
}

export function commandFor(key: CollectionKey, opts: { logCount?: number; logSkip?: number; useNulWorktrees?: boolean; patchPath?: string }): CommandSpec {
  switch (key) {
    case 'status':
      // 注意：status 没有 --no-ext-diff（porcelain 输出不走外部 diff）；重命名显式开。
      return { key, subcommand: 'status', args: ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--find-renames'] }
    case 'worktrees':
      if (opts.useNulWorktrees === false) return { key, subcommand: 'worktree', args: ['worktree', 'list', '--porcelain'] }
      return { key, subcommand: 'worktree', args: ['worktree', 'list', '--porcelain', '-z'] }
    case 'refs':
      return { key, subcommand: 'for-each-ref', args: ['for-each-ref', '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(committerdate:iso-strict)', 'refs/heads/'] }
    case 'log': {
      const n = opts.logCount === undefined ? 50 : opts.logCount
      const skip = opts.logSkip === undefined ? 0 : opts.logSkip
      return { key, subcommand: 'log', args: ['log', '--no-decorate', '-z', '--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%P%x00', '-n', String(n), '--skip=' + String(skip)] }
    }
    case 'diffFiles':
      return { key, subcommand: 'diff', args: ['diff', '--numstat', '-z', '--no-ext-diff', '--find-renames', 'HEAD'] }
    case 'patch': {
      const p = opts.patchPath === undefined ? '' : opts.patchPath
      return { key, subcommand: 'diff', args: ['diff', '--unified=3', '--no-color', '--no-ext-diff', '--no-prefix', '--find-renames', 'HEAD', '--', p] }
    }
  }
}

/** 换行配置的事实来源（宿主在第 0 步阶段顺带取，不计入六个采集项）。 */
export function autocrlfArgs(): string[] {
  return ['config', '--get', 'core.autocrlf']
}

export const COMMANDS_SOURCE = 'version-control-core/src/commands.ts'
