// tests/verify-976-pull-dirty-warn.js — #976 拉取在工作区不干净时只提醒不拦住
// 用法：在插件根目录执行 node tests/verify-976-pull-dirty-warn.js，可独立运行。
//
// 只留行为断言：把共享判定 src/shared/version-control/rules.js 加载起来，拿几份现造的
// 首屏喂给 judge，看脏树拉取判 warn（不是 block）、干净拉取仍放行、同一份首屏下落后推送
// 仍是 block、冲突时仍 block。真正的安全由命令行的只快进兜底。
//
// 原来那两条「读界面源码文本、断言 data-vc-action-hint / warnText 字样在不在」的检查已删：
// 断言对象是手写源码文件的文本，等价重构（换写法、搬文件、改注释）就会误报。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const file = (over = {}) => Object.assign({
  path: 'a.txt', origPath: null, staged: false, unstaged: true,
  change: 'modified', conflict: false, addedLines: 1, deletedLines: 0,
}, over)

const base = (over = {}) => Object.assign({
  identity: {
    worktreeDisplay: 'repo', worktreePath: 'D:/repo', branch: 'main', detached: false,
    oid: 'a'.repeat(40), sync: 'tracked-known', ahead: 0, behind: 2, basisMs: 1000,
  },
  staged: [], unstaged: [file()], stagedCount: 0, unstagedCount: 15, conflictCount: 0,
  otherWorktrees: [], branches: [], commits: [],
  repo: {
    merging: false, rebasing: false, cherryPicking: false, reverting: false,
    hasCommits: true, bare: false, tier: 'full', autocrlf: 'false',
  },
}, over)

async function main() {
  console.log('976 拉取脏树警告与常驻理由门禁')
  const rules = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'rules.js')).href)

  // 1. 脏树拉取是 warn，不是 block（截图状态：未暂存 15、落后 2）。
  const dirty = rules.judge(base(), 'pull')
  check(dirty.verdict === 'warn' && dirty.reasons.includes('dirty-tree'), '脏树拉取只提醒不拦住（实得 ' + dirty.verdict + '/' + dirty.reasons.join(',') + '）')
  // 反证：回到 block 的旧实现必须判红。
  const oldBlock = { verdict: 'block', reasons: ['dirty-tree'] }
  check(!(oldBlock.verdict === 'warn'), '反证：旧方向（block）在这条新断言下不成立')

  // 2. 干净拉取仍放行，无警告。
  const clean = rules.judge(base({ unstaged: [], unstagedCount: 0 }), 'pull')
  check(clean.verdict === 'allow', '干净拉取仍放行（实得 ' + clean.verdict + '）')

  // 3. 同一份首屏下，落后时推送仍是 block（一致性：顶部说落后，推送就不能可点）。
  const push = rules.judge(base({ unstaged: [], unstagedCount: 0 }), 'push')
  check(push.verdict === 'block' && push.reasons.includes('behind-remote'), '同一份首屏下落后推送仍拦住（实得 ' + push.verdict + '/' + push.reasons.join(',') + '）')

  // 4. 冲突与进行中仍是 block（放宽只针对脏树，不动安全边界）。
  const conflict = rules.judge(base({ conflictCount: 1 }), 'pull')
  check(conflict.verdict === 'block', '冲突时拉取仍拦住（实得 ' + conflict.verdict + '）')

  console.log(failed ? ('\n未通过 — ' + total + ' 项断言') : ('\n全部通过 — 976 门禁生效（' + total + ' 项断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行失败：' + ((e && e.message) || e)); process.exit(1) })
