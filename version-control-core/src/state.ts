/**
 * version-control-core/src/state.ts —— 首屏读数组装（纯函数）+ 显示判据
 *
 * 顶层是“首屏读数”：身份、未提交改动（已暂存/未暂存两组）、其他工作树、仓库级状态、提交历史。
 * 首屏三块同一次读取、成败一起：任一解析失败就整体显式失败，不做每块各自降级（#821）。
 * 判“哪个工作树是当前的”用分支名比对，不比较路径（Windows 大小写与斜杠坑，调研 7.3）。
 * 冲突是叠加状态：解析层不去重，合成一行是这里的事（故事 26）。
 */
import type { BranchInfo, BranchSync, CommitInfo, FileChange, FileEntry, FirstScreen, Identity, ParseFailure, RepoFlags, WorktreeInfo } from './ports.js'
import type { StatusEntry } from './parse-status.js'
import type { WorktreeRecord } from './parse-worktrees.js'
import type { RefRecord } from './parse-refs.js'
import type { LogRecord } from './parse-log.js'
import type { DiffFileRecord } from './parse-diff-files.js'

export interface AssembleInput {
  repoRoot: string
  bare: boolean
  statusHead: string
  statusDetached: boolean
  statusOid: string | null
  statusUpstream: string | null
  statusAhead: number
  statusBehind: number
  statusEntries: StatusEntry[]
  worktrees: WorktreeRecord[]
  refs: RefRecord[]
  commits: LogRecord[]
  diffFiles: DiffFileRecord[]
  merging: boolean
  rebasing: boolean
  cherryPicking: boolean
  reverting: boolean
  tier: 'unsupported' | 'degraded' | 'full'
  autocrlf: string | null
  nowMs: number
  basisMs: number | null
}

export type AssembleResult = { ok: true; screen: FirstScreen } | ParseFailure

function fail(detail: string): ParseFailure {
  return { ok: false, error: 'state-assemble-failed', detail }
}

/** 最短唯一后缀：同仓全部工作树里从末段往左数到可区分的最少段数（#812 定案）。 */
export function shortestUniqueSuffix(paths: string[]): number[] {
  const segs = paths.map((p) => String(p).replace(/\\/g, '/').split('/').filter((s) => s !== ''))
  return segs.map((s, i) => {
    for (let n = 1; n <= s.length; n += 1) {
      const tail = s.slice(-n).join('/').toLowerCase()
      let clash = false
      for (let j = 0; j < segs.length; j += 1) {
        if (j === i) continue
        if (segs[j].slice(-n).join('/').toLowerCase() === tail) { clash = true; break }
      }
      if (!clash) return n
    }
    return s.length
  })
}

/**
 * 工作树路径比对用的归一化：反斜杠与正斜杠统一、去掉结尾的斜杠、Windows 盘符只折大小写
 * （盘符大小写不敏感是 Windows 的事实）；其余部分原样保留，POSIX 上路径是大小写敏感的。
 */
function sameWorktreePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const s = String(p).replace(/\\/g, '/').replace(/\/+$/, '')
    const drive = /^([a-zA-Z]):/.exec(s)
    return drive ? s.charAt(0).toLowerCase() + s.slice(1) : s
  }
  return norm(a) === norm(b)
}

export function displayFor(path: string, keep: number): string {
  const segs = String(path).replace(/\\/g, '/').split('/').filter((s) => s !== '')
  return segs.slice(-Math.max(1, keep)).join('/')
}

/** 文件路径中段折叠：砍中段、文件名端完整保留（与工作树名砍尾是两套规则，不许合并）。 */
export function foldMiddle(path: string, maxLen: number): string {
  const p = String(path)
  if (p.length <= maxLen || maxLen < 10) return p
  const keep = maxLen - 1
  const headLen = Math.ceil(keep * 0.4)
  return p.slice(0, headLen) + '…' + p.slice(p.length - (keep - headLen))
}

/** 提交时间：近一周相对、更早绝对（返回结构化值，中文说法在客户端词表）。 */
export function describeTime(nowMs: number, tMs: number): { style: 'relative'; minutes: number } | { style: 'absolute'; ms: number } {
  const diff = nowMs - tMs
  if (diff >= 0 && diff < 7 * 24 * 3600 * 1000) return { style: 'relative', minutes: Math.max(0, Math.floor(diff / 60000)) }
  return { style: 'absolute', ms: tMs }
}

function toChange(e: StatusEntry): { change: FileChange; conflict: boolean } {
  if (e.kind === 'untracked') return { change: 'untracked', conflict: false }
  if (e.kind === 'unmerged') return { change: 'modified', conflict: true }
  if (e.kind === 'renamed') return { change: 'renamed', conflict: false }
  if (e.kind === 'ignored') return { change: 'modified', conflict: false }
  if (e.x === 'A' || e.y === 'A') return { change: 'added', conflict: false }
  if (e.x === 'D' || e.y === 'D') return { change: 'deleted', conflict: false }
  if (e.x === 'T' || e.y === 'T') return { change: 'typechange', conflict: false }
  return { change: 'modified', conflict: false }
}

function rankFor(f: FileEntry): number {
  if (f.staged) return 0
  if (f.conflict) return 1
  return 2
}

export function assemble(input: AssembleInput): AssembleResult {
  if (input.bare) {
    const repo: RepoFlags = { merging: false, rebasing: false, cherryPicking: false, reverting: false, hasCommits: input.commits.length > 0, bare: true, tier: input.tier, autocrlf: input.autocrlf }
    const identity: Identity = { worktreeDisplay: '', worktreePath: input.repoRoot, branch: null, detached: false, oid: null, sync: 'detached', ahead: 0, behind: 0, basisMs: null }
    return { ok: true, screen: { identity, staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0, otherWorktrees: [], branches: [], commits: [], repo } }
  }
  const counts = new Map<string, DiffFileRecord>()
  for (const d of input.diffFiles) counts.set(d.path, d)
  const files: FileEntry[] = []
  for (const e of input.statusEntries) {
    if (e.kind === 'ignored') continue
    const { change, conflict } = toChange(e)
    const c = counts.get(e.path)
    files.push({
      path: e.path, origPath: e.origPath,
      staged: e.x !== '.' && e.x !== '?' && e.x !== '!',
      unstaged: e.y !== '.' && e.y !== '?' && e.y !== '!',
      change, conflict,
      addedLines: c ? c.added : null, deletedLines: c ? c.deleted : null,
    })
  }
  files.sort((a, b) => rankFor(a) - rankFor(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const staged = files.filter((f) => f.staged)
  const unstaged = files.filter((f) => f.unstaged || f.change === 'untracked')
  const allPaths = input.worktrees.map((w) => w.path)
  const keeps = shortestUniqueSuffix(allPaths.length > 0 ? allPaths : [input.repoRoot])
  // 哪一个工作树是当前的：先用路径比对（宿主已经把 rev-parse --show-toplevel 的结果当 repoRoot 传进来）。
  // 游离头下同一个提交可能挂在多棵工作树上，只按 oid 找会命中列表里第一棵（通常是主工作树）——
  // 那正是用户最怕的「明明站在游离头上，界面说我在另一棵树上」。
  let currentPath = input.repoRoot
  const byPath = input.worktrees.find((w) => sameWorktreePath(w.path, input.repoRoot))
  if (byPath) currentPath = byPath.path
  else if (!input.statusDetached && input.statusHead) {
    const hit = input.worktrees.find((w) => w.branch === input.statusHead)
    if (hit) currentPath = hit.path
  } else if (input.statusDetached && input.statusOid) {
    const hit = input.worktrees.find((w) => w.head === input.statusOid)
    if (hit) currentPath = hit.path
  }
  let sync: BranchSync = 'no-upstream'
  if (input.statusDetached) sync = 'detached'
  else if (!input.statusUpstream) sync = 'no-upstream'
  else {
    const ref = input.refs.find((r) => r.short === input.statusHead)
    if (ref && ref.upstreamGone) sync = 'upstream-gone'
    else if (input.basisMs === null) sync = 'tracked-stale'
    else sync = 'tracked-fresh'
  }
  const identity: Identity = {
    worktreeDisplay: displayFor(currentPath, keeps[Math.max(0, allPaths.indexOf(currentPath))] || 1),
    worktreePath: currentPath, branch: input.statusDetached ? null : input.statusHead,
    detached: input.statusDetached, oid: input.statusOid, sync,
    ahead: input.statusAhead, behind: input.statusBehind, basisMs: input.basisMs,
  }
  const others: WorktreeInfo[] = input.worktrees
    .filter((w) => w.path !== currentPath)
    .map((w) => ({
      path: w.path, display: displayFor(w.path, keeps[Math.max(0, allPaths.indexOf(w.path))] || 1),
      head: w.head || '', branch: w.branch, bare: w.bare, current: false,
      locked: w.locked, lockReason: w.lockReason,
      lockUnknown: input.tier !== 'full' && !w.locked,
      prunable: w.prunable,
    }))
  const commits: CommitInfo[] = input.commits.map((c) => ({
    oid: c.oid, short: c.short, author: c.author, email: c.email,
    authorDateMs: c.authorDateMs, commitDateMs: c.commitDateMs, subject: c.subject, parents: c.parents,
  }))
  const branches: BranchInfo[] = input.refs.map((r) => ({
    short: r.short, oid: r.oid, upstream: r.upstream, upstreamGone: r.upstreamGone,
    ahead: r.ahead, behind: r.behind, current: r.short === input.statusHead && !input.statusDetached,
  }))
  const repo: RepoFlags = {
    merging: input.merging, rebasing: input.rebasing, cherryPicking: input.cherryPicking,
    reverting: input.reverting, hasCommits: input.statusOid !== null || commits.length > 0,
    bare: false, tier: input.tier, autocrlf: input.autocrlf,
  }
  return {
    ok: true,
    screen: {
      identity, staged, unstaged, stagedCount: staged.length, unstagedCount: unstaged.length,
      conflictCount: files.filter((f) => f.conflict).length, otherWorktrees: others, branches, commits, repo,
    },
  }
}

export type StepZero = { ok: true; kind: 'worktree' | 'bare'; gitDir: string } | { ok: true; kind: 'not-repo' } | ParseFailure

/** 第 0 步分类（核心按命令加退出码判，端口不做业务分类）：三行输出 gitDir/inside/bare。 */
export function classifyStepZero(exitCode: number, stdout: string, stderr: string): StepZero {
  if (exitCode !== 0) {
    if (/not a git repository/.test(stderr)) return { ok: true, kind: 'not-repo' }
    return { ok: false, error: 'step-zero-failed', detail: 'exit ' + exitCode }
  }
  const lines = String(stdout).split('\n').filter((l) => l !== '')
  if (lines.length < 3) return { ok: false, error: 'step-zero-failed', detail: '行数不足 3' }
  const gitDir = lines[0]
  const inside = lines[1]
  const bare = lines[2]
  if ((inside !== 'true' && inside !== 'false') || (bare !== 'true' && bare !== 'false')) {
    return { ok: false, error: 'step-zero-failed', detail: '布尔行非法' }
  }
  if (bare === 'true') return { ok: true, kind: 'bare', gitDir }
  if (inside === 'true') return { ok: true, kind: 'worktree', gitDir }
  return { ok: false, error: 'step-zero-failed', detail: '既不在工作树也不是裸仓库' }
}

export const STATE_SOURCE = 'version-control-core/src/state.ts'
