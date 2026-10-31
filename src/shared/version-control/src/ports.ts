/**
 * src/shared/version-control/src/ports.ts —— 版本管理核心的插口形状（只放形状，不放运行时代码）
 *
 * 回答「核心与外面之间传的是什么东西」。先写这份形状，再写实现（ADR §2.2 第一条）。
 * 核心是纯函数：不碰进程、不碰磁盘、不碰网络；取数与落盘在宿主那一侧（#817/#818）。
 *
 * 字符串约定：核心返回的输出一律是 UTF-8 解码后的文本（调研实测 git 在 Windows 上输出 UTF-8）。
 * 这是给 #817 的前置假设 —— 若 DSH 进程服务不是按 UTF-8 解码，端口必须改回字节、核心自己解码。
 * 换行符不在核心归一化（只按 LF 与 NUL 切分，不做 CRLF 转换）。
 *
 * 用户话术不在这里：判定理由一律用稳定标识符（ASCII），中文说法在客户端词表里；
 * 测试断言的是标识符，不是句子（#821 测试缝）。
 */

export type CapabilityTier = 'unsupported' | 'degraded' | 'full'

export interface GitVersion {
  major: number
  minor: number
  patch: number
}

/** 端口返回的几种情形（#813 定案 5：成功含截断标志；拿不到截断标志就按可能截断处理）。
 *  #1741 补 stdin-failed：只有 fast-import 那一个只读文件流窄例外会把输入送进 git，
 *  送不进去（命令不许配、路径/大小/摘要不符、传输层没有管道、EPIPE）一律显式失败，不能静默忽略；
 *  ok 上的 stdinBytes 是这次真正送进管道的字节数（没送 stdin 的命令为 0 或不带）。 */
export type ExecResult =
  | { kind: 'ok'; stdout: string; truncated: boolean; stdinBytes?: number }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'spawn-failed'; message: string }
  | { kind: 'non-zero'; exitCode: number; stderr: string }
  | { kind: 'stdin-failed'; reason: string; message: string; stdinBytes?: number }

/** 首屏一次读全的五个采集项（patch 是按需的第六个，不在首屏内，见 commands.ts）。 */
export type CollectionKey = 'status' | 'worktrees' | 'refs' | 'log' | 'diffFiles' | 'patch'

/** 文件变化的六种类型（冲突是叠加状态，不是第七种，见 FileEntry.conflict）。 */
export type FileChange = 'added' | 'modified' | 'deleted' | 'renamed' | 'typechange' | 'untracked'

export interface FileEntry {
  path: string
  origPath: string | null
  staged: boolean
  unstaged: boolean
  change: FileChange
  conflict: boolean
  addedLines: number | null
  deletedLines: number | null
}

/** 分支同步状态五值枚举（#821：合并成布尔就会对用户说错话）。#819 收口把前两个名字改成它真正的含义
 *  （纯内部标识符，用户可见话术一个字没变）：tracked-known = 有上游、依据时间读得到；
 *  tracked-unknown = 有上游、依据时间读不到（判据 basisMs === null）。名字里不许出现「新 / 旧」——
 *  ADR 第 3 条不设阈值，代码根本没有办法判「旧」，叫 fresh/stale 就是名字在说谎。 */
export type BranchSync =
  | 'tracked-known'
  | 'tracked-unknown'
  | 'upstream-gone'
  | 'no-upstream'
  | 'detached'

export interface Identity {
  worktreeDisplay: string
  worktreePath: string
  branch: string | null
  detached: boolean
  oid: string | null
  sync: BranchSync
  ahead: number
  behind: number
  basisMs: number | null
}

export interface WorktreeInfo {
  path: string
  display: string
  head: string
  branch: string | null
  bare: boolean
  current: boolean
  locked: boolean
  lockReason: string | null
  lockUnknown: boolean
  prunable: boolean
  /** 这个 git 版本答不出「目录还在不在」时为真：答不出不等于还在（与 lockUnknown 同一形状）。 */
  prunableUnknown: boolean
}

export interface BranchInfo {
  short: string
  oid: string
  upstream: string | null
  upstreamGone: boolean
  ahead: number
  behind: number
  current: boolean
}

export interface CommitInfo {
  oid: string
  short: string
  author: string
  email: string
  authorDateMs: number
  commitDateMs: number
  subject: string
  parents: string[]
}

export interface RepoFlags {
  merging: boolean
  rebasing: boolean
  cherryPicking: boolean
  reverting: boolean
  hasCommits: boolean
  bare: boolean
  tier: CapabilityTier
  autocrlf: string | null
}

export interface FirstScreen {
  identity: Identity
  staged: FileEntry[]
  unstaged: FileEntry[]
  stagedCount: number
  unstagedCount: number
  conflictCount: number
  otherWorktrees: WorktreeInfo[]
  branches: BranchInfo[]
  commits: CommitInfo[]
  repo: RepoFlags
}

/** 四个未来写操作的判定对象（本版只读，规则先行为后面的票备好）。 */
export type Operation = 'stage' | 'commit' | 'pull' | 'push' | 'fetch'

export type Verdict = 'allow' | 'warn' | 'block'

export interface Decision {
  verdict: Verdict
  reasons: string[]
}

/** 解析失败是返回值，不是抛异常（调用方按 error 标识符处理）。 */
export interface ParseFailure {
  ok: false
  error: string
  detail: string
}

/** 写操作四档（暂存不走票据，所以不在这里；更新远方记录是只读远端的网络读，不碰工作树）。 */
export type WriteOp = 'commit' | 'pull' | 'push' | 'fetch'

/** 预检解析出来的推送目标；localBranch 是 refspec 左边那一段（本地分支）。 */
export interface WritePlan {
  mode: 'existing' | 'set-upstream' | 'recreate' | 'fetch'
  /** mode 的布尔派生（界面与反证脚本按它读）：true = 这次推送会建立/重建上游（带 -u）。 */
  setUpstream?: boolean
  remote: string
  branch: string
  localBranch: string
  /** pull 用：预检时这个分支的上游短名（执行前要重量一次比对，防「预检后改上游/切分支」绕过）。 */
  upstream?: string | null
}

/**
 * 写操作的绑定表（#1741）：预检那一刻把「执行前必须还没变的状态」量一遍记进票里，动手前重新量一遍逐格比对。
 * 两个语义要点：
 *   1. 只有票里记了值（非 null）的格子才比对——还没接线的动作留 null，别假装绑上了；
 *   2. 绑定失配沿用既有理由标识符（索引条数 → stale-index，其余 → target-changed），不新增词表项，
 *      所以客户端那张理由对照表不用改。
 */
export interface WritePreconditions {
  /** 预检定下来的目标（推送计划 / 拉取目标 / 更新远方记录的远端选择）规范化后的摘要。 */
  planDigest: string | null
  /** 工作树此刻的形状（暂存与未暂存的路径清单）规范化后的摘要；拉取要它，因为拉取会不会冲突取决于它。 */
  worktreeDigest: string | null
  /** 会决定这次写操作往哪去的旧配置原值（branch.<名>.remote 与 branch.<名>.merge），对不上就说明上游被改过。 */
  configOldValue: string | null
  /** 远端跟踪引用此刻指向哪一提交；没有（或被删）时留 null。 */
  remoteOid: string | null
  /** 本轮四条写命令都不绑定这个格子，字段留给后续 prune/fsck 一类动作；注释写明是为了让「留空」看起来是有意的。 */
  unreachableDigest: string | null
  /** 预检时确认不存在的运行中操作标记文件（MERGE_HEAD 等）；执行前这些文件要是冒出来了就拒绝。 */
  pathAbsent: string[]
}

export interface WriteCounters {
  /** 索引条数（ls-files --stage 的 NUL 记录数）：索引里多一条少一条都算状态变过。 */
  indexEntries: number | null
}

export interface WriteBindings {
  preconditions: WritePreconditions
  counters: WriteCounters
}

/**
 * 一次性票据（形制照 src/host/updatePkg/service.js 的 receipt：checkId + 过期时刻；重放保护靠 requestId 去重，
 * 不自创第三种语义）。客户端只拿得到 id / checkedAtMs / expiresAtMs / op，其余留在宿主内存里。
 */
export interface WriteTicket {
  id: string
  op: WriteOp
  /** 票绑仓库（#841 第三批）：两个不同目录的仓库可以有完全相同的 HEAD 与索引指纹，所以票据必须记住
   *  自己是给哪个工作树发的，执行前比对；对不上按 stale-repo 拒。 */
  repoRoot: string
  checkedAtMs: number
  expiresAtMs: number
  headOid: string
  indexFingerprint: string | null
  indexEntries: number | null
  target: WritePlan | null
  /** 绑定表（#1741）：旧票据可能没有这个字段，执行前按「票里记了值才比对」处理，存量票据照样能用。 */
  bindings?: WriteBindings
}

export const PORTS_SOURCE = 'src/shared/version-control/src/ports.ts'
