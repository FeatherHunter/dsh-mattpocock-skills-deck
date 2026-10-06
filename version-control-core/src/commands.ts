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
 *
 * 看某一次提交改了什么（#821 规格故事 32）：diffFiles 与 patch 各多一个 rev 选项，给 rev 时把
 * 「git diff ... HEAD」换成「git show ... <提交号>」，参数形状与解析口径一字不改。真机核到的两条事实
 * （样本见 fixtures/live-rev-shapes.json）：show --numstat 对合并提交给的是「相对第一个父提交」的行数；
 * show -p 对合并提交走组合差异、默认不展开（空）——后一种空要由宿主如实说明，不能当成「没有改动」。
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
    // 路径参数一律按字面量解释，不许当通配（#819 复审 P0-1 真机复现）：默认口径下 `方括号[1].txt`
    // 会把 `[1]` 当字符组、连 `方括号1.txt` 一起匹配，补丁里就混进没被点名那个文件的内容。
    // 这一族命令没有哪一条需要 git 展开路径通配，所以放进固定前缀对所有命令一视同仁——
    // 只挂在 patch 那一条上，将来再加带路径的命令时没人会记得补这个开关。
    '--literal-pathspecs',
    // 推送三道保险（总工 2026-10-04 最终口径）：① 显式 refspec（见 pushArgs，主保证）；
    // ② followTags 关掉——配成 true 时即使显式 refspec 也会把标签顺带推上去（实测）；
    // ③ default=nothing 作为第二道（它单独挡不住裸 push，有 remote.<name>.push 时会被当成 refspec 来源）。
    '-c', 'push.followTags=false',
    '-c', 'push.default=nothing',
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

/** 提交号的唯一形状：4 到 64 位十六进制字符（短哈希到完整 SHA-256 都在内）。
 *  宿主在拼命令之前用它挡住外部给的值；放在这里导出，是为了让「什么算合法提交号」只有一处真源。 */
export const REV_PATTERN = /^[0-9a-fA-F]{4,64}$/

/** 拼一条采集命令。opts.rev 给的是「看这一次提交改了什么」的提交号：
 *  只许传已经过 REV_PATTERN 校验的十六进制字符串（路径、分支名、选项一律不许从这里进 argv），
 *  校验由唯一的调用方（宿主 wf.gitDiff 电话）在拼之前完成。 */
export function commandFor(key: CollectionKey, opts: { logCount?: number; logSkip?: number; useNulWorktrees?: boolean; patchPath?: string; rev?: string }): CommandSpec {
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
      // 带 rev 时看的是「那一次提交改了什么」：改用 git show 一次给一份 numstat（与 git diff 同一套解析，--format= 空掉提交头）。
      if (opts.rev !== undefined) return { key, subcommand: 'show', args: ['show', '--numstat', '-z', '--no-ext-diff', '--find-renames', '--format=', opts.rev] }
      return { key, subcommand: 'diff', args: ['diff', '--numstat', '-z', '--no-ext-diff', '--find-renames', 'HEAD'] }
    case 'patch': {
      const p = opts.patchPath === undefined ? '' : opts.patchPath
      if (opts.rev !== undefined) return { key, subcommand: 'show', args: ['show', '--unified=3', '--no-color', '--no-ext-diff', '--no-prefix', '--find-renames', '--format=', opts.rev, '--', p] }
      return { key, subcommand: 'diff', args: ['diff', '--unified=3', '--no-color', '--no-ext-diff', '--no-prefix', '--find-renames', 'HEAD', '--', p] }
    }
  }
}

/** 写命令的子命令清单（#841）：门禁拿它断言「面板会发出什么」。 */
export const WRITE_SUBCOMMANDS: string[] = ['add', 'reset', 'commit', 'pull', 'push', 'fetch', 'ls-files', 'remote']

/** 远端名与分支名的形状：只挡「会被当成选项」与「会破坏 argv」的形状，不重造 git 自己的取名规则。
 *  分支名允许斜杠（feature/x）；两者都不许以 - 开头、不许空白与 NUL。 */
export const REMOTE_PATTERN = /^(?!-)[A-Za-z0-9._/-]+$/
// 前导 - 会被当选项；前导 + 更危险：refspec 首字符 + 是 git 的强推标记，`+wip:+wip` 会被解析成
// 「强推 wip 到 wip」——源引用被吃掉、远端被覆盖（#841 第三批·安全级）。两者都拒。
export const BRANCH_PATTERN = /^(?![-+])[^\s\u0000:\\]+$/

/**
 * 写命令的参数口径（#841 附录第 4 节）。本文件只描述「子命令与它自己的参数」：
 * -C <仓库根>、固定前缀（含 --literal-pathspecs）与非交互环境都由宿主的同一个出口补上，这里不写第二份。
 * 每条都写清为什么是这几个参数：
 *   · add：整文件暂存（D1），路径一律排在 -- 之后（写路径更输不起通配）；
 *   · commit：只带 -m；永不带 --amend / --allow-empty / --no-verify（D4）；
 *   · pull：只认 --ff-only（D2），不能快进就失败；
 *   · push：**一律显式写 <remote> <branch>，不裸 push**（总工 2026-10-04 更正：裸 push 会被
 *     push.default=matching / remote.<name>.push / push.followTags 改道或带出别的东西）；
 *     -u 只在 set-upstream 那一档出现（D3）。
 */
export function stageArgs(paths: string[]): string[] {
  return ['add', '--'].concat(paths)
}
/** 撤回暂存：只动索引不动工作区。故意用 reset 而不用 restore --staged —— 版本底线是 2.11，
 *  restore 是 2.23 才引入的，底线以下的 git 会直接报 unknown subcommand；reset <HEAD> -- <路径> 从旧版
 *  起就是整文件撤回暂存的写法（只重写索引里这几个路径的条目，工作区一个字节都不碰）。 */
export function unstageArgs(paths: string[]): string[] {
  return ['reset', 'HEAD', '--'].concat(paths)
}
export function commitArgs(message: string): string[] {
  return ['commit', '-m', message]
}
export function pullArgs(): string[] {
  return ['pull', '--ff-only']
}
/** 推送：永远显式 <remote> <local>:<remote>（总工 2026-10-04 订正 1）；-u 只在 set-upstream 档出现。 */
export function pushArgs(plan: { mode: 'existing' | 'set-upstream' | 'recreate'; remote: string; branch: string; localBranch: string }): string[] {
  const spec = plan.localBranch + ':' + plan.branch
  // 自检（#841 第三批·安全级）：refspec 首字符 + 是强推标记。分支名正则已经拒前导 +，这里再兜一道，
  // 免得将来有人从别的路径拼 refspec 时把「普通推送」变成「覆盖远端」。
  if (spec.charAt(0) === '+' || plan.localBranch.charAt(0) === '+' || plan.branch.charAt(0) === '+') {
    throw new Error('[version-control] refspec 不许以 + 开头（会被 git 当强推）：' + spec)
  }
  // --no-follow-tags：用户配置里若开着 push.followTags=true，显式 refspec 仍会把可达的标注标签一起推出去；
  // 面板只推这一个分支，标签不替用户推（真机场景②的验收点：推完远端标签仍为空）。
  // -u 出现在两档：set-upstream（第一次推送）与 recreate（上游被删后重建）——两者都要重新设上游。
  return plan.mode === 'existing' ? ['push', '--no-follow-tags', plan.remote, spec] : ['push', '-u', '--no-follow-tags', plan.remote, spec]
}
/** 更新远方记录：只取回远端跟踪引用，不合并、不碰工作树。带远端名时只取该远端
 *  （多远端由调用方先选好）；远端名与分支名沿用本文件的形状正则，拼之前由宿主复核。 */
export function fetchArgs(remote?: string): string[] {
  if (remote !== undefined && remote !== '') return ['fetch', remote]
  return ['fetch']
}
/** 索引指纹的输入（只读；总工裁决 2：不用 write-tree，不往用户对象库写东西）。 */
export function lsFilesStageArgs(): string[] {
  return ['ls-files', '--stage', '-z']
}
/** 远端清单（只读，D3 要用它列远端让用户选）。 */
export function remoteListArgs(): string[] {
  return ['remote']
}
/** 分支名的最终复核（只读，不碰仓库）：拼 refspec 之前让 git 自己判一次这个名字合不合法。
 *  形状正则挡的是「会被当选项」与「会破坏 argv」，git 的取名规则比正则细（.. ~ ^ : 等），
 *  所以推送到动手前再问一次 git（#841 第二段②；威胁面 T1/T2/T7）。 */
export function checkRefArgs(branch: string): string[] {
  return ['check-ref-format', '--branch', branch]
}

/** 换行配置的事实来源（宿主在第 0 步阶段顺带取，不计入六个采集项）。 */
export function autocrlfArgs(): string[] {
  return ['config', '--get', 'core.autocrlf']
}

export const COMMANDS_SOURCE = 'version-control-core/src/commands.ts'
