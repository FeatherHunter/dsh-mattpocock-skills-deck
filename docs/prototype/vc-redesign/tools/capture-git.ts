/**
 * 把本仓库真实的历史、工作树与 HEAD 采集成一份固定数据，供原型渲染使用。
 *
 * 为什么要生成而不是手写：原型要回答的是「这套界面在真实数据上长什么样」，
 * 手写的 50 条提交与 13 棵工作树很容易编出 git 不会出现的形状（空上游、畸形路径、
 * 两位作者名），那样验收的是想象，不是界面。生成文件带 AUTO-GENERATED 头，不手改。
 *
 * 用法（在仓库根目录执行，需要 git 与 Node 24+）：
 *   node docs/prototype/vc-redesign/tools/capture-git.ts
 *
 * 只读 git，不写仓库；产物路径固定为 ../src/data/repo.generated.ts。
 * 每笔提交的文件清单用 `git show --numstat` 采：合并提交与空提交天然是空清单，
 * 正好覆盖「合并提交没有可展开差异」这条真实边界，不另外造数据。
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'src', 'data', 'repo.generated.ts')
const COMMIT_LIMIT = 50

interface CapturedFile {
  path: string
  added: number
  deleted: number
}

interface CapturedCommit {
  oid: string
  short: string
  author: string
  email: string
  authorDateMs: number
  subject: string
  parents: string[]
  files: CapturedFile[]
}

interface CapturedWorktree {
  path: string
  head: string | null
  branch: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  lockReason: string | null
  prunable: boolean
}

/** 调用 git：统一关掉 quotepath，中文路径才不会被转成八进制转义。 */
function git(args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

/** 一行 numstat 的形状：新增、删除、路径（重命名在 --no-renames 下会拆成两行）。 */
function parseNumstat(raw: string): CapturedFile[] {
  const out: CapturedFile[] = []
  for (const line of raw.split('\n')) {
    if (line === '') continue
    const [added, deleted, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (!path) continue
    out.push({
      path,
      added: added === '-' ? 0 : Number(added),
      deleted: deleted === '-' ? 0 : Number(deleted),
    })
  }
  return out
}

function captureCommits(): CapturedCommit[] {
  const format = '%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%P%x1e'
  const raw = git(['log', `-n${COMMIT_LIMIT}`, `--format=${format}`, '--no-renames'])
  return raw.split('\x1e').map((record) => record.trim()).filter((record) => record !== '').map((record) => {
    const [oid, short, author, email, at, subject, parents] = record.split('\x1f')
    const files = parseNumstat(git(['show', '--numstat', '--format=', '--no-renames', oid]))
    return {
      oid, short, author, email,
      authorDateMs: Number(at) * 1000,
      subject,
      parents: parents === '' ? [] : parents.split(' '),
      files,
    }
  })
}

function captureWorktrees(): CapturedWorktree[] {
  const raw = git(['worktree', 'list', '--porcelain'])
  const trees: CapturedWorktree[] = []
  let cur: CapturedWorktree | null = null
  for (const line of raw.split('\n')) {
    if (line === '') continue
    if (line.startsWith('worktree ')) {
      if (cur) trees.push(cur)
      cur = { path: line.slice('worktree '.length), head: null, branch: null, bare: false, detached: false, locked: false, lockReason: null, prunable: false }
      continue
    }
    if (!cur) continue
    if (line.startsWith('HEAD ')) cur.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch ')) cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    else if (line === 'bare') cur.bare = true
    else if (line === 'detached') cur.detached = true
    else if (line === 'locked') cur.locked = true
    else if (line.startsWith('locked ')) { cur.locked = true; cur.lockReason = line.slice('locked '.length) }
    else if (line === 'prunable') cur.prunable = true
  }
  if (cur) trees.push(cur)
  return trees
}

const repoRoot = git(['rev-parse', '--show-toplevel']).trim().replace(/\//g, '\\')
const head = git(['rev-parse', 'HEAD']).trim()
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
const commits = captureCommits()
const worktrees = captureWorktrees()

const data = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  head,
  branch,
  commits,
  worktrees,
}

const header = `// AUTO-GENERATED。来源脚本：docs/prototype/vc-redesign/tools/capture-git.ts。
// 采集时间 ${data.generatedAt}；仓库根 ${repoRoot}；分支 ${branch}；提交 ${commits.length} 条；工作树 ${worktrees.length} 棵。
// 不要手改；要刷新就重新跑一次生成脚本。
`
const body = `export interface CapturedFile {\n  path: string\n  added: number\n  deleted: number\n}\n\nexport interface CapturedCommit {\n  oid: string\n  short: string\n  author: string\n  email: string\n  authorDateMs: number\n  subject: string\n  parents: string[]\n  files: CapturedFile[]\n}\n\nexport interface CapturedWorktree {\n  path: string\n  head: string | null\n  branch: string | null\n  bare: boolean\n  detached: boolean\n  locked: boolean\n  lockReason: string | null\n  prunable: boolean\n}\n\nexport const capturedAtMs = ${Date.now()}\nexport const capturedRepoRoot = ${JSON.stringify(repoRoot)}\nexport const capturedHead = ${JSON.stringify(head)}\nexport const capturedBranch = ${JSON.stringify(branch)}\nexport const capturedCommits: CapturedCommit[] = ${JSON.stringify(commits, null, 2)}\nexport const capturedWorktrees: CapturedWorktree[] = ${JSON.stringify(worktrees, null, 2)}\n`

writeFileSync(OUT, header + body, 'utf8')
console.log(`captured ${commits.length} commits, ${worktrees.length} worktrees -> ${OUT}`)
