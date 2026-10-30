#!/usr/bin/env node
/**
 * tests/verify-1533-git-remote-claim.ts —— #1533：认领只看远端地址，分支名里的词不算数。
 *
 * 真机事故：GitHub 仓库里建了一个叫 `ticket/1187-gitlab-chain-predicates` 的分支，
 * `.git/config` 因此多出一段 `[branch "..."]`。GitLab 后端当时在整份 `.git/config`
 * 文本里找 `gitlab` 字样，于是它和 GitHub 后端同时认领这个仓库；注册表判 multi-match，
 * 读会话失败，状态栏的黄条「登录状态暂时确认不了」一直挂着，点重新检查也走同一条死路。
 *
 * 本门禁钉两件事：
 *   ① 两个后端的 matches 都只看 `[remote ...]` 段里的 `url`：分支名里带 gitlab / github
 *      不构成认领依据（下面的夹具在旧代码上会误认领，所以本门禁能拦住回退）；
 *   ② 远端地址真的指向哪一家，就还认哪一家（GitHub 仓库仍认给 GitHub，GitLab 仓库仍认给 GitLab）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1533-git-remote-claim.ts
 *
 * 门禁归属: src/tracker/kernel/git-remote.ts
 * 门禁归属: src/tracker/rooms/gitlab
 * 门禁归属: src/tracker/rooms/github
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)

let passed = 0
let failed = 0
const check = (ok: boolean, msg: string) => {
  if (ok) {
    console.log('  PASS ' + msg)
    passed++
  } else {
    console.log('  FAIL ' + msg)
    failed++
  }
}

const { remoteUrlsOfGitConfig } = await imp('src/tracker/kernel/git-remote.js')
const { gitlabBackend } = await imp('src/tracker/rooms/gitlab/index.js')
const { githubMatches } = await imp('src/tracker/rooms/github/room/backend.js')

// ── 夹具：每个用例一个真目录，按需要往里写 .git/config 之类的文件 ──
function newWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claim-1533-'))
}
function put(ws: string, rel: string, text: string): void {
  const full = path.join(ws, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text, 'utf8')
}

/** 假文件服务：照真服务的规矩，readText 只认 resolve 交出来的那个 target。 */
function makeFs() {
  const TARGET_PREFIX = 'dsh-target:'
  return {
    async resolve(rel: unknown, opts?: { cwd?: string }) {
      return TARGET_PREFIX + path.join((opts && opts.cwd) || '', String(rel))
    },
    async readText(target: unknown) {
      if (typeof target !== 'string' || target.indexOf(TARGET_PREFIX) !== 0) {
        throw new TypeError('readText 要的是 resolve() 给出的 target')
      }
      return fs.readFileSync(target.slice(TARGET_PREFIX.length), 'utf8')
    },
  }
}

/** 递给人一家的 matches：文件服务走假的那一个，exec 兜底给一个「什么都没说」的执行器。 */
function ctxOf(ws: string) {
  const fsLike = makeFs()
  return {
    cwd: ws,
    fs: fsLike,
    platform: { fs: fsLike },
    exec: async () => ({ stdout: '', stderr: '', code: 0 }),
  }
}

// ── 夹具配置：GitHub 远端 + 一个名字里带 gitlab 的分支（事故现场的缩小版）──
const GITHUB_CONFIG_WITH_GITLAB_BRANCH =
  '[core]\n' +
  '\trepositoryformatversion = 0\n' +
  '[branch "ticket/1187-gitlab-chain-predicates"]\n' +
  '\tremote = origin\n' +
  '\tmerge = refs/heads/ticket/1187-gitlab-chain-predicates\n' +
  '[remote "origin"]\n' +
  '\turl = https://github.com/acme/demo.git\n' +
  '\tfetch = +refs/heads/*:refs/remotes/origin/*\n'

// ── 夹具配置：GitLab 远端 + 一个名字里带 github.com 的分支（反向的同一类陷阱）──
const GITLAB_CONFIG_WITH_GITHUB_BRANCH =
  '[branch "work/github.com-migration"]\n' +
  '\tremote = origin\n' +
  '[remote "origin"]\n' +
  '\turl = git@gitlab.com:acme/demo.git\n'

const GITHUB_CONFIG = '[remote "origin"]\n\turl = git@github.com:acme/demo.git\n'
const GITLAB_CONFIG = '[remote "upstream"]\n\turl = https://gitlab.com/acme/demo.git\n'

// ══════════════════════════════════════════════════════════════════════════
console.log('== ① 纯解析：只把 [remote ...] 段里的 url 拿出来 ==')

{
  const urls = remoteUrlsOfGitConfig(GITHUB_CONFIG_WITH_GITLAB_BRANCH)
  check(urls.length === 1, '事故夹具里只有一个远端地址')
  check(urls[0] === 'https://github.com/acme/demo.git', '取到的正是那个 GitHub 远端地址')
  check(
    !urls.some((u: string) => /gitlab/i.test(u)),
    '分支名里的 gitlab 没有混进远端地址（这正是旧代码误认领的来源）',
  )
}

{
  const urls = remoteUrlsOfGitConfig(
    '[remote "origin"]\n\turl = https://github.com/acme/demo.git\n' +
      '[remote "mirror"]\n\turl = git@gitlab.com:acme/demo.git\n',
  )
  check(urls.length === 2, '两个 remote 段各收一条')
  check(urls[1].indexOf('gitlab.com') >= 0, '第二条是 GitLab 镜像地址（远端名字不限 origin）')
}

{
  check(remoteUrlsOfGitConfig(null).length === 0, 'null 回空数组')
  check(remoteUrlsOfGitConfig('').length === 0, '空串回空数组')
  check(remoteUrlsOfGitConfig('[branch "x"]\n\tremote = origin\n').length === 0, '没有 remote 段就回空数组')
  check(
    remoteUrlsOfGitConfig('[remote.origin]\n\turl = git@github.com:acme/demo.git\n')[0].indexOf('github.com') >= 0,
    '旧的 [remote.origin] 写法也能取到地址',
  )
}

// ══════════════════════════════════════════════════════════════════════════
console.log('== ② GitLab 后端的认领：GitHub 仓库不会因为分支名被它抢走 ==')

{
  const ws = newWorkspace()
  put(ws, '.git/config', GITHUB_CONFIG_WITH_GITLAB_BRANCH)
  put(ws, 'docs/agents/issue-tracker.md', '# Issue tracker: GitHub\n')
  const hit = await gitlabBackend.matches({ cwd: ws } as never, ctxOf(ws) as never)
  check(hit === false, 'GitHub 仓库 + 名字带 gitlab 的分支 → GitLab 不认领（事故现场）')
  check(/gitlab/i.test(GITHUB_CONFIG_WITH_GITLAB_BRANCH) === true, '同一份文本里确实出现过 gitlab 这个词（旧代码因此会认领）')
}

{
  const ws = newWorkspace()
  put(ws, '.git/config', GITLAB_CONFIG)
  const hit = await gitlabBackend.matches({ cwd: ws } as never, ctxOf(ws) as never)
  check(hit === true, '远端确实指向 GitLab → 照旧认领')
}

// ══════════════════════════════════════════════════════════════════════════
console.log('== ③ GitHub 后端的认领：GitLab 仓库不会因为分支名被它抢走 ==')

{
  const ws = newWorkspace()
  put(ws, '.git/config', GITLAB_CONFIG_WITH_GITHUB_BRANCH)
  const hit = await githubMatches({ cwd: ws } as never, ctxOf(ws) as never)
  check(hit === false, 'GitLab 仓库 + 名字带 github.com 的分支 → GitHub 不认领（反向同一类陷阱）')
  check(/github\.com/i.test(GITLAB_CONFIG_WITH_GITHUB_BRANCH) === true, '同一份文本里确实出现过 github.com 这个词（旧代码因此会认领）')
}

{
  const ws = newWorkspace()
  put(ws, '.git/config', GITHUB_CONFIG)
  const hit = await githubMatches({ cwd: ws } as never, ctxOf(ws) as never)
  check(hit === true, '远端确实指向 github.com → 照旧认领')
}

// ══════════════════════════════════════════════════════════════════════════
console.log('')
console.log('通过 ' + passed + ' 条，失败 ' + failed + ' 条')
process.exitCode = failed === 0 ? 0 : 1
