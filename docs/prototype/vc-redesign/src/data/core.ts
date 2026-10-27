/**
 * data/core.ts —— 原型与真实实现之间的唯一接口。
 *
 * 这个原型不是照着截图另外画一套：状态组装、同步判据、写操作能不能点、
 * 相对时间与路径折叠，全部调用 src/shared/version-control 里已经上线的纯函数。
 * 原型独有的只有「数据从哪来」（真实 git 采集 + 一段固定的工作区改动样本）
 * 与「画成什么样」（ui/ 目录）。
 *
 * 为什么集中转出一层：原型里 20 多处要引用这些函数与类型，散着写相对路径
 * 会既难读又难改；集中到这一个文件后，真实实现的路径只出现一次，
 * 以后把原型接回宿主时，替换的也只是这一层。
 *
 * 相对路径说明：本文件在 docs/prototype/vc-redesign/src/data/，
 * 上五级到仓库根，再进 src/shared/version-control/src/。
 */
export { assemble, describeTime, displayFor, foldMiddle } from '../../../../../src/shared/version-control/src/state'
export { judge } from '../../../../../src/shared/version-control/src/rules'

export type { AssembleInput } from '../../../../../src/shared/version-control/src/state'
export type {
  BranchInfo,
  BranchSync,
  CommitInfo,
  Decision,
  FileChange,
  FileEntry,
  FirstScreen,
  Identity,
  Operation,
  RepoFlags,
  Verdict,
  WorktreeInfo,
} from '../../../../../src/shared/version-control/src/ports'
export type { StatusEntry } from '../../../../../src/shared/version-control/src/parse-status'
export type { WorktreeRecord } from '../../../../../src/shared/version-control/src/parse-worktrees'
export type { RefRecord } from '../../../../../src/shared/version-control/src/parse-refs'
export type { LogRecord } from '../../../../../src/shared/version-control/src/parse-log'
export type { DiffFileRecord } from '../../../../../src/shared/version-control/src/parse-diff-files'
export type { PatchLine, PatchLineKind } from '../../../../../src/shared/version-control/src/parse-patch'
