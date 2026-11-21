// verify-gitea-repo-identity.ts —— Gitea 房仓库身份（refId 与自托管实例宿主）贯通门禁。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-gitea-repo-identity.ts（verify 链按命名约定自动发现）。
// 归属票：#15。背景：宿主刷新链的列表取数在会话不可用时按后端手拼仓库地址，旧实现把 gitea 也拼成
// github.com；同时 gitea 房 describe 只信调用方给的 refId/host，自托管实例的宿主（真机
// gitea.vvmath.com:8443）与 owner/name 都带不出来，describe 回 { refId:'', url:'' }。
// 修法与 GitLab 房同款形状：认仓库（matches / getRepoKey）那一趟顺手把身份学进进程内缓存，
// describe 同步取；宿主 repoUrlOf 给 gitea 一条不撒谎的退路（gitea.com，绝不拼 github.com）。
// 断言六件事：
//   1. 解析器：https（含端口）/ scp / ssh 三类远端地址都解析得出宿主与 owner/name，非 gitea 地址不认；
//   2. describe：学过的（cwd）回真机 refId 与 https://gitea.vvmath.com:8443/ 开头的 url；没学过的诚实回空；
//   3. describe：调用方显式给的 refId 是第一真源，学到的只补缺，不覆盖；
//   4. getRepoKey 与 matches 认出仓库的同一趟真的把身份学了（桩执行器真跑这条链）；
//   5. #17：没有 fs、只给 exec 时，matches 的 git remote 兜底要真走得到（修复前是死代码），
//      认出的远端地址同样要学成身份；无 fs 且 exec 认不出 / 干脆没有 exec 时回 false、不抛错；
//   6. 宿主 repoUrlOf：gitea 有自己的退路宿主，且源码里不再有 gitea → github.com 的拼接。
import { parseGiteaOrigin, learnGiteaIdentity, giteaIdentityOf, refIdOfRemoteUrl } from '../src/tracker/rooms/gitea/repo/identity.js'
import { describe, createGiteaBackend } from '../src/tracker/rooms/gitea/index.js'

let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

console.log('Gitea 房仓库身份贯通门禁（describe 的 refId/url 与宿主手拼退路）')

// 真机形状（#15 复现用的自托管实例）。
const REAL_URL = 'https://gitea.vvmath.com:8443/zhaolj/dsh-mattpocockskill-test.git'
const REAL_ORIGIN = 'https://gitea.vvmath.com:8443'
const REAL_REF = 'zhaolj/dsh-mattpocockskill-test'

// 1. 解析器
check(parseGiteaOrigin(REAL_URL) === REAL_ORIGIN, 'https 带端口：' + parseGiteaOrigin(REAL_URL))
check(parseGiteaOrigin('https://gitea.com/zhaolj/demo') === 'https://gitea.com', '官方站也解析')
check(parseGiteaOrigin('git@gitea.vvmath.com:8443:zhaolj/demo.git') === 'https://gitea.vvmath.com:8443', 'scp 写法补 https：' + parseGiteaOrigin('git@gitea.vvmath.com:8443:zhaolj/demo.git'))
check(parseGiteaOrigin('git@gitea.vvmath.com:zhaolj/demo.git') === 'https://gitea.vvmath.com', 'scp 无端口')
check(parseGiteaOrigin('ssh://git@gitea.vvmath.com:2222/zhaolj/demo.git') === 'https://gitea.vvmath.com', 'ssh 写法补 https')
check(parseGiteaOrigin('https://github.com/zhaolj/demo.git') === '', 'github 地址不认（学错比不学更糟）')
check(parseGiteaOrigin('https://gitlab.com/zhaolj/demo.git') === '', 'gitlab 地址不认')
check(parseGiteaOrigin('') === '' && parseGiteaOrigin(null) === '', '空值不抛错')
check(refIdOfRemoteUrl(REAL_URL) === REAL_REF, 'refId 解析：' + refIdOfRemoteUrl(REAL_URL))
check(refIdOfRemoteUrl('git@gitea.example:zhaolj/demo') === 'zhaolj/demo', 'scp 写法的 refId')
check(refIdOfRemoteUrl('ssh://git@gitea.example:2222/zhaolj/demo.git') === 'zhaolj/demo', 'ssh 带端口的 refId')
check(refIdOfRemoteUrl('https://gitea.example:8443/zhaolj/demo') === 'zhaolj/demo', 'https 带端口的 refId')
check(refIdOfRemoteUrl('https://gitea.example/zhaolj') === '', '路径不到两段不给 refId')

// 2. describe：学过的回真机形状，没学过的诚实回空
learnGiteaIdentity('/ws/real', REAL_URL)
const learnedRef = describe({ cwd: '/ws/real', refId: '' } as never, 'gitea')
check(learnedRef.refId === REAL_REF, 'describe.refId 用学到的 owner/name：' + learnedRef.refId)
check(learnedRef.url === REAL_ORIGIN + '/' + REAL_REF, 'describe.url 指向自托管实例：' + learnedRef.url)
check((learnedRef as { host?: string }).host === REAL_ORIGIN, 'describe.host 记实例宿主')
const blankRef = describe({ cwd: '/ws/never-seen', refId: '' } as never, 'gitea')
check(blankRef.refId === '' && blankRef.url === '', '没学过时诚实回空（不编地址）：' + JSON.stringify(blankRef))
check(giteaIdentityOf('') === null, 'cwd 非法时取不到身份')

// 3. 显式 refId 是第一真源
learnGiteaIdentity('/ws/declared', 'https://gitea.example/owner/from-remote.git')
const declaredRef = describe({ cwd: '/ws/declared', refId: 'owner/declared' } as never, 'gitea')
check(declaredRef.refId === 'owner/declared', '显式 refId 不被学到的覆盖')
check(declaredRef.url === 'https://gitea.example/owner/declared', 'url 用显式 refId + 学到的宿主')

// 4. getRepoKey / matches 认出的同一趟学了身份
const backend = createGiteaBackend({} as never)
const execGitea = async () => ({ code: 0, stdout: REAL_URL + '\n', stderr: '' })
const key = await backend.getRepoKey('/ws/getkey', { exec: execGitea } as never)
check(!!key && key.owner === 'zhaolj' && key.name === 'dsh-mattpocockskill-test', 'getRepoKey 解析 owner/name：' + JSON.stringify(key))
const afterGetKey = describe({ cwd: '/ws/getkey', refId: '' } as never, 'gitea')
check(afterGetKey.url === REAL_ORIGIN + '/' + REAL_REF, 'getRepoKey 这一趟把身份学了，describe 同步取到：' + afterGetKey.url)

// matches：.git/config 那一路（fs.resolve + fs.readText 桩）
const gitConfig = [
  '[core]',
  '\trepositoryformatversion = 0',
  '[remote "origin"]',
  '\turl = ' + REAL_URL,
  '\tfetch = +refs/heads/*:refs/remotes/origin/*',
].join('\n')
const fsStub = {
  resolve: async () => '/fake/.git/config',
  readText: async () => gitConfig,
}
const matchedViaModule = await import('../src/tracker/rooms/gitea/index.js')
// matches 不是契约成员，模块对象上只看得见「回布尔」这一格：三处判据共用这一次收窄，别各写一份。
const matchesWith = async (handle: unknown, ctx: unknown): Promise<boolean> =>
  (matchedViaModule.giteaBackend as unknown as { matches: (h: unknown, c: unknown) => Promise<boolean> }).matches(handle, ctx)
const matchedOk = await matchesWith({ cwd: '/ws/matches', refId: '' }, { fs: fsStub })
check(matchedOk === true, 'matches 靠 .git/config 认出 Gitea')
const afterMatches = describe({ cwd: '/ws/matches', refId: '' } as never, 'gitea')
check(afterMatches.url === REAL_ORIGIN + '/' + REAL_REF, 'matches 这一趟也把身份学了：' + afterMatches.url)

// 5. #17：没有 fs、只给 exec 时，兜底必须真的走得到
// 修复前 canRead 为假就 return false，下面这些桩里的 exec 一次都不会被调到（execCalls 恒为 0）。
const execCalls: string[] = []
const execStub = async (cmd: string, args: string[]) => {
  execCalls.push([cmd, ...args].join(' '))
  return { code: 0, stdout: REAL_URL + '\n', stderr: '' }
}
const matchedNoFs = await matchesWith({ cwd: '/ws/no-fs', refId: '' }, { exec: execStub })
check(matchedNoFs === true, '无 fs、只有 exec：靠 git remote 兜底认出 Gitea')
check(execCalls.length === 1 && execCalls[0] === 'git remote get-url origin', '兜底真被调用一次：' + JSON.stringify(execCalls))
const afterNoFs = describe({ cwd: '/ws/no-fs', refId: '' } as never, 'gitea')
check(afterNoFs.url === REAL_ORIGIN + '/' + REAL_REF, '兜底这一趟也把身份学了：' + afterNoFs.url)

// fs 只长了一半（有 resolve、缺 readText）：同一分支，也要跳过两条 fs 线索落到兜底
const halfFsCalls: string[] = []
const matchedHalfFs = await matchesWith(
  { cwd: '/ws/half-fs', refId: '' },
  {
    fs: { resolve: async () => '/fake/.git/config' },
    exec: async (cmd: string, args: string[]) => {
      halfFsCalls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: REAL_URL + '\n', stderr: '' }
    },
  },
)
check(matchedHalfFs === true, 'fs 缺 readText：同样落到 exec 兜底')
check(halfFsCalls.length === 1, 'fs 缺 readText 时兜底也只跑一次：' + JSON.stringify(halfFsCalls))

// 无 fs、exec 回的是别的平台地址：回 false，不抛错
const matchedNoFsOther = await matchesWith(
  { cwd: '/ws/no-fs-other', refId: '' },
  { exec: async () => ({ code: 0, stdout: 'https://github.com/zhaolj/demo.git\n', stderr: '' }) },
)
check(matchedNoFsOther === false, '无 fs、兜底地址不指向 gitea：回 false')

// 无 fs 且没有 exec：回 false，不抛错
const matchedNoFsNoExec = await matchesWith({ cwd: '/ws/no-fs-no-exec', refId: '' }, {})
check(matchedNoFsNoExec === false, '无 fs 且无 exec：回 false，不抛错')

// 6. 宿主 repoUrlOf 的退路：源码断言（该函数不导出，按门禁既有口径读源码）
const { readFileSync } = await import('node:fs')
const hostSrc = readFileSync(new URL('../src/refresh/rooms/host/issue-list-fetch.ts', import.meta.url), 'utf8')
check(hostSrc.includes("'https://gitea.com/'"), '宿主退路里 gitea 有自己的官方站宿主')
check(hostSrc.includes("backendId === 'gitea' ? 'https://gitea.com/'"), 'repoUrlOf 的 gitea 分支指向 gitea.com（不再落回 github.com）')
check(/\bbackendId === 'gitea'/.test(hostSrc), 'repoUrlOf 按后端分流到 gitea 一支')

console.log((failed ? 'FAIL: ' : 'OK: ') + total + ' 判据')
process.exit(failed ? 1 : 0)
