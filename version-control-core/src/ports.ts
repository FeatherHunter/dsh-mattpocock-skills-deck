/**
 * version-control-core/src/ports.ts —— 版本管理核心的插口形状（只放形状，不放运行时代码）
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

/** 端口返回的四种情形（#813 定案 5：成功含截断标志；拿不到截断标志就按可能截断处理）。 */
export type ExecResult =
  | { kind: 'ok'; stdout: string; truncated: boolean }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'spawn-failed'; message: string }
  | { kind: 'non-zero'; exitCode: number; stderr: string }

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
export type Operation = 'stage' | 'commit' | 'pull' | 'push'

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

export const PORTS_SOURCE = 'version-control-core/src/ports.ts'
