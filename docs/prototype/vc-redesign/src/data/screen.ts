/**
 * data/screen.ts —— 原型的数据来源。
 *
 * 历史、工作树、HEAD 三项来自 tools/capture-git.ts 对本仓库的真实采集；
 * 未提交改动一项用评审时的 11 个文件做固定样本（真实工作区此刻只有一处改动，
 * 样本才有足够多的行状态可看：已跟踪修改、未跟踪文档、未跟踪脚本、中文路径）。
 *
 * 组装走真实的 assemble()，不在这里手写 FirstScreen：
 * 已暂存/未暂存/冲突的分组、计数口径、当前工作树的判定、同步状态，
 * 都应该由真实代码决定，否则原型会把界面问题误当成数据问题。
 */
import { assemble } from './core'
import type { AssembleInput, DiffFileRecord, FirstScreen, RefRecord, StatusEntry, WorktreeRecord } from './core'
import {
  capturedBranch,
  capturedCommits,
  capturedHead,
  capturedRepoRoot,
  capturedWorktrees,
  capturedAtMs,
  type CapturedCommit,
  type CapturedFile,
} from './repo.generated'

export interface PrototypeData {
  screen: FirstScreen
  /** 采集到的 50 条提交及各自的文件清单（合并提交与空提交自然是空清单）。 */
  commits: CapturedCommit[]
  /** 按提交号索引文件清单，提交详情页用。 */
  commitFiles: Map<string, CapturedFile[]>
  repoRoot: string
  branch: string
  /** 页面打开的时刻：读取时间与「远端依据」的基准。 */
  nowMs: number
}

/** 工作区固定样本：两处已跟踪修改，九处未跟踪文件，合计 11 个文件。 */
const WORKING_CHANGES: Array<{ path: string; kind: StatusEntry['kind']; x: string; y: string; added: number | null; deleted: number | null }> = [
  { path: 'src/client/views/shared/workRouteTable.ts', kind: 'ordinary', x: '.', y: 'M', added: 2, deleted: 2 },
  { path: 'src/refresh/rooms/host/outbound-admission.ts', kind: 'ordinary', x: '.', y: 'M', added: 23, deleted: 1 },
  { path: 'docs/review/20261025-spec-complete-prompt-review.html', kind: 'untracked', x: '?', y: '?', added: null, deleted: null },
  { path: 'docs/design/md-env-check-chain.png', kind: 'untracked', x: '?', y: '?', added: null, deleted: null },
  { path: 'docs/design/md-env-check-chain.svg', kind: 'untracked', x: '?', y: '?', added: null, deleted: null },
  { path: 'tests/verify-1545-workroute-row-nav.ts', kind: 'untracked', x: '?', y: '?', added: null, deleted: null },
  { path: 'undefined/issue1518-body.md', kind: 'untracked', x: '?', y: '?', added: null, deleted: null },
  { path: 'undefined/issue1518-original-body.md', kind: 'untracked', x: '?', y: '?', added: null, deleted: null },
  { path: 'undefined/probe-spec-capsule.mjs', kind: 'untracked', x: '?', y: '?', added: null, deleted: null },
  { path: 'undefined/probe2.mjs', kind: 'untracked', x: '?', y: '?', added: null, deleted: null },
  { path: 'undefined/temp/pr-1475-body.md', kind: 'untracked', x: '?', y: '?', added: null, deleted: null },
]

function worktreeRecords(): WorktreeRecord[] {
  return capturedWorktrees.map((w) => ({
    path: w.path,
    head: w.head,
    branch: w.branch,
    bare: w.bare,
    detached: w.detached,
    locked: w.locked,
    lockReason: w.lockReason,
    prunable: w.prunable,
    prunableReason: null,
  }))
}

function refRecords(basisMs: number): RefRecord[] {
  return [
    {
      ref: `refs/heads/${capturedBranch}`,
      short: capturedBranch,
      oid: capturedHead,
      upstream: `origin/${capturedBranch}`,
      upstreamGone: false,
      ahead: 2,
      behind: 0,
      current: true,
      commitDateMs: basisMs,
    },
  ]
}

export function buildPrototypeData(): PrototypeData {
  const nowMs = Date.now()
  // 「远端依据」固定按 12 分钟前展示：模拟截图里的两次读取时间，让两个时钟的差别看得见。
  const basisMs = nowMs - 12 * 60 * 1000

  const statusEntries: StatusEntry[] = WORKING_CHANGES.map((c) => ({
    kind: c.kind, x: c.x, y: c.y, path: c.path, origPath: null,
  }))
  const diffFiles: DiffFileRecord[] = WORKING_CHANGES
    .filter((c) => c.added !== null && c.deleted !== null)
    .map((c) => ({ path: c.path, origPath: null, added: c.added as number, deleted: c.deleted as number }))

  const input: AssembleInput = {
    repoRoot: capturedRepoRoot,
    bare: false,
    statusHead: capturedBranch,
    statusDetached: false,
    statusOid: capturedHead,
    statusUpstream: `origin/${capturedBranch}`,
    statusAhead: 2,
    statusBehind: 0,
    statusEntries,
    worktrees: worktreeRecords(),
    refs: refRecords(basisMs),
    commits: capturedCommits.map((c) => ({
      oid: c.oid, short: c.short, author: c.author, email: c.email,
      authorDateMs: c.authorDateMs, commitDateMs: c.authorDateMs,
      subject: c.subject, parents: c.parents,
    })),
    diffFiles,
    merging: false,
    rebasing: false,
    cherryPicking: false,
    reverting: false,
    tier: 'full',
    autocrlf: null,
    nowMs,
    basisMs,
  }

  const result = assemble(input)
  if (!result.ok) throw new Error(`真实组装器拒绝了原型数据：${result.detail}`)

  const commitFiles = new Map<string, CapturedFile[]>()
  for (const c of capturedCommits) commitFiles.set(c.oid, c.files)

  return {
    screen: result.screen,
    commits: capturedCommits,
    commitFiles,
    repoRoot: capturedRepoRoot,
    branch: capturedBranch,
    nowMs,
  }
}

/** 采集时刻（生成文件里记录的），页脚用来说明原型数据不是实时读取的。 */
export const CAPTURED_AT_MS = capturedAtMs
