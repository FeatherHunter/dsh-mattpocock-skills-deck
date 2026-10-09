// tests/verify-976-pull-dirty-warn.js — #976 拉取在工作区不干净时只提醒不拦住，且理由常驻
// 用法：在插件根目录执行 node tests/verify-976-pull-dirty-warn.js，可独立运行。
//
// 守三件事：判定上脏树拉取是 warn（不是 block），真正的安全由命令行的只快进兜底；
// 界面上禁用与警告的理由一定有常驻文字（data-vc-action-hint），确认框里有警告行（data-vc-confirm-warn）；
// 同一份首屏下落后时推送仍是 block（顶部笔数与按钮状态一致）。每项带反证。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

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

  // 4. 界面模型层：警告进常驻提示，不只放悬停。
  const ui = read('src/client/views/versionControl/vcWriteUi.js')
  check(ui.includes('warnTip') && ui.includes('hint: blockedTip'), '模型层有警告转常驻提示（warnTip/hint）')
  check(ui.includes('warnText'), '确认框模型带警告行（warnText）')
  check(!ui.includes('tip: state === \'blocked\' ? vcBlockedTipOf(d, t) : \'\'') || ui.includes('warnTip'), '反证：只在 blocked 才给理由的旧写法已不在（悬停是子集，常驻是全集）')

  // 5. 视图层：常驻提示与确认框警告真实画出来。
  const view = read('src/client/views/versionControl/vcWriteView.js')
  check(view.includes('data-vc-action-hint'), '视图层画出常驻提示钩子（data-vc-action-hint）')
  check(view.includes('data-vc-confirm-warn'), '确认框画出警告行钩子（data-vc-confirm-warn）')
  check(view.includes('tabIndex: 0'), '常驻提示可聚焦（键盘与触屏可达）')

  // 6. 冲突与进行中仍是 block（放宽只针对脏树，不动安全边界）。
  const conflict = rules.judge(base({ conflictCount: 1 }), 'pull')
  check(conflict.verdict === 'block', '冲突时拉取仍拦住（实得 ' + conflict.verdict + '）')

  console.log(failed ? ('\n未通过 — ' + total + ' 项断言') : ('\n全部通过 — 976 门禁生效（' + total + ' 项断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行失败：' + ((e && e.message) || e)); process.exit(1) })
