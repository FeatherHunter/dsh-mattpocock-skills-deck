/**
 * 把本仓库真实的历史、工作区、远端、标签、配置、钩子与仓库体量采集成一份固定数据，
 * 供原型渲染使用。
 *
 * 为什么要生成而不是手写：原型要回答的是「这套界面在真实数据上长什么样」，
 * 手写的 50 条提交、3 个远端与 60 个标签很容易编出 git 不会出现的形状（空上游、畸形路径、
 * 两位作者名），那样验收的是想象，不是界面。生成文件带 AUTO-GENERATED 头，不手改。
 *
 * 用法（在仓库根目录执行，需要 git 与 Node 24+）：
 *   node docs/prototype/vc-redesign/tools/capture-git.ts
 *
 * 只读 git，不写仓库；产物路径固定为 ../src/data/repo.generated.ts。
 * 每笔提交的文件清单用 `git show --numstat` 采：合并提交与空提交天然是空清单，
 * 正好覆盖「合并提交没有可展开差异」这条真实边界，不另外造数据。
 * 远端、标签、配置、钩子、体量五项给「管理」下的二级页做数据来源；它们同样只读，
 * 不调网络：远端地址取 `git remote -v`，标签取本地 refs，不跑 `ls-remote`。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
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

/** 一个远端：名字、获取地址、推送地址。三者分开存，因为推送地址可以单独改。 */
interface CapturedRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

/** 一个标签：短名、指向对象的短号、创建时间。原型只显示本地已有的标签。 */
interface CapturedTag {
  name: string
  shortOid: string
  createdAtMs: number
}

/** 仓库体量读数，对应 `git count-objects -v` 的各项。 */
interface CapturedCounts {
  loose: number
  sizeKiB: number
  inPack: number
  packs: number
  sizePackKiB: number
  prunePackable: number
  garbage: number
}

/** 一个钩子：文件名、是否只是 git 自带的 .sample。 */
interface CapturedHook {
  name: string
  sample: boolean
  sizeBytes: number
}

/** 一条配置：键、值、来自哪一层。原型只收与版本管理页直接相关的键，不是整份配置。 */
interface CapturedConfig {
  key: string
  value: string
  scope: 'local' | 'global'
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

/** 远端列表：`git remote -v` 每个远端两行（fetch / push），按名字合并。 */
function captureRemotes(): CapturedRemote[] {
  const raw = git(['remote', '-v'])
  const byName = new Map<string, CapturedRemote>()
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
    if (match === null) continue
    const [, name, url, kind] = match
    const current = byName.get(name) ?? { name, fetchUrl: '', pushUrl: '' }
    if (kind === 'fetch') current.fetchUrl = url
    else current.pushUrl = url
    byName.set(name, current)
  }
  return [...byName.values()]
}

/** 标签列表：按创建时间倒序，只取前 40 条（原型只展示最近的一屏）。 */
function captureTags(): CapturedTag[] {
  const raw = git(['for-each-ref', '--sort=-creatordate', '--count=40', '--format=%(refname:short)%1f%(objectname:short)%1f%(creatordate:unix)', 'refs/tags'])
  return raw.split('\n').filter((line) => line.trim() !== '').map((line) => {
    const [name, shortOid, at] = line.split('\x1f')
    return { name, shortOid, createdAtMs: Number(at) * 1000 }
  })
}

/** 仓库体量：解析 `git count-objects -v` 的键值行。 */
function captureCounts(): CapturedCounts {
  const raw = git(['count-objects', '-v'])
  const values = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const index = line.indexOf(':')
    if (index < 0) continue
    values.set(line.slice(0, index).trim(), line.slice(index + 1).trim())
  }
  const num = (key: string): number => Number(values.get(key) ?? '0')
  return {
    loose: num('count'),
    sizeKiB: num('size'),
    inPack: num('in-pack'),
    packs: num('packs'),
    sizePackKiB: num('size-pack'),
    prunePackable: num('prune-packable'),
    garbage: num('garbage'),
  }
}

/** 钩子清单：读 hooks 目录里的文件名。.sample 是 git init 自带的示例，不算「装了钩子」。 */
function captureHooks(): CapturedHook[] {
  const commonDir = git(['rev-parse', '--git-common-dir']).trim()
  const hooksDir = join(commonDir, 'hooks')
  try {
    return readdirSync(hooksDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        name: entry.name,
        sample: entry.name.endsWith('.sample'),
        sizeBytes: 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** 只取与版本管理页有关的那几个配置键；不是整份配置，读取目的写在 README 的数据说明里。 */
function captureConfig(): CapturedConfig[] {
  const wanted: Array<[string, 'local' | 'global']> = [
    ['user.name', 'local'], ['user.email', 'local'],
    ['core.ignorecase', 'local'], ['core.eol', 'local'], ['core.autocrlf', 'local'],
    ['core.hooksPath', 'local'],
    ['credential.helper', 'local'], ['credential.helper', 'global'],
  ]
  const out: CapturedConfig[] = []
  for (const [key, scope] of wanted) {
    try {
      const args = scope === 'local' ? ['config', '--local', '--get', key] : ['config', '--global', '--get', key]
      const value = git(args).trim()
      if (value !== '') out.push({ key, value, scope })
    } catch {
      // 这个键没配：跳过，不在生成文件里写空值。
    }
  }
  return out
}

const repoRoot = git(['rev-parse', '--show-toplevel']).trim().replace(/\//g, '\\')
const head = git(['rev-parse', 'HEAD']).trim()
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
const commits = captureCommits()
const worktrees = captureWorktrees()
const remotes = captureRemotes()
const tags = captureTags()
const counts = captureCounts()
const hooks = captureHooks()
const config = captureConfig()
const submodules = git(['submodule', 'status']).trim()
const localBranchNames = git(['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads']).split('\n').filter((line) => line !== '')
const localBranches = localBranchNames.length
const refsTotal = git(['for-each-ref', '--format=%(refname)', 'refs/']).split('\n').filter((line) => line !== '').length
const gitVersion = git(['--version']).trim()
const describe = git(['describe', '--tags', '--always', '--dirty']).trim()
const status = git(['status', '--porcelain=v2', '--branch'])

const data = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  head,
  branch,
  commits,
  worktrees,
  remotes,
  tags,
  counts,
  hooks,
  config,
  submodules,
  localBranches,
  refsTotal,
  gitVersion,
  describe,
}

const header = `// AUTO-GENERATED。来源脚本：docs/prototype/vc-redesign/tools/capture-git.ts。
// 采集时间 ${data.generatedAt}；仓库根 ${repoRoot}；分支 ${branch}；提交 ${commits.length} 条；工作区 ${worktrees.length} 个；
// 远端 ${remotes.length} 个；标签 ${tags.length} 个；本地分支 ${localBranches} 条；引用 ${refsTotal} 条；钩子目录 ${hooks.length} 项。
// 不要手改；要刷新就重新跑一次生成脚本。
`

const interfaces = `export interface CapturedFile {
  path: string
  added: number
  deleted: number
}

export interface CapturedCommit {
  oid: string
  short: string
  author: string
  email: string
  authorDateMs: number
  subject: string
  parents: string[]
  files: CapturedFile[]
}

export interface CapturedWorktree {
  path: string
  head: string | null
  branch: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  lockReason: string | null
  prunable: boolean
}

export interface CapturedRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface CapturedTag {
  name: string
  shortOid: string
  createdAtMs: number
}

export interface CapturedCounts {
  loose: number
  sizeKiB: number
  inPack: number
  packs: number
  sizePackKiB: number
  prunePackable: number
  garbage: number
}

export interface CapturedHook {
  name: string
  sample: boolean
  sizeBytes: number
}

export interface CapturedConfig {
  key: string
  value: string
  scope: 'local' | 'global'
}
`

const body = `
export const capturedAtMs = ${Date.now()}
export const capturedRepoRoot = ${JSON.stringify(repoRoot)}
export const capturedHead = ${JSON.stringify(head)}
export const capturedBranch = ${JSON.stringify(branch)}
export const capturedCommits: CapturedCommit[] = ${JSON.stringify(commits, null, 2)}
export const capturedWorktrees: CapturedWorktree[] = ${JSON.stringify(worktrees, null, 2)}
export const capturedRemotes: CapturedRemote[] = ${JSON.stringify(remotes, null, 2)}
export const capturedTags: CapturedTag[] = ${JSON.stringify(tags, null, 2)}
export const capturedCounts: CapturedCounts = ${JSON.stringify(counts, null, 2)}
export const capturedHooks: CapturedHook[] = ${JSON.stringify(hooks, null, 2)}
export const capturedConfig: CapturedConfig[] = ${JSON.stringify(config, null, 2)}
export const capturedSubmodules = ${JSON.stringify(submodules)}
export const capturedLocalBranchNames: string[] = ${JSON.stringify(localBranchNames, null, 2)}
export const capturedLocalBranches = ${localBranches}
export const capturedRefsTotal = ${refsTotal}
export const capturedGitVersion = ${JSON.stringify(gitVersion)}
export const capturedDescribe = ${JSON.stringify(describe)}
export const capturedStatusRaw = ${JSON.stringify(status)}
`

writeFileSync(OUT, header + interfaces + body, 'utf8')
console.log(`captured ${commits.length} commits, ${worktrees.length} worktrees, ${remotes.length} remotes, ${tags.length} tags, ${hooks.length} hooks -> ${OUT}`)
