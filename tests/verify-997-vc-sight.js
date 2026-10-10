// tests/verify-997-vc-sight.js — 「滑到那句提示就接着显示」的门禁（#997 落地）
// 用法：在插件根目录执行 node tests/verify-997-vc-sight.js，可独立运行。
//
// 守四件事：
//   1) 纯判定 vcMoreStepOf：什么时候接着显示（draw）、什么时候等上一批落地（wait）、什么时候停（stop，
//      含「没有更多」与「上一次失败了」两档 —— 失败不自动重试，交给那句失败提示与它的重试按钮）。
//   2) vcMoreStateOf：从块清单里取出改动页三个分组、工作树页、提交历史页各自「还有没有没显示的」；
//      视图里没有那个块就没有那个键（也就不会被触发）。
//   3) vcMoreShownOf：再画一批是本地动作（把已取回的行多画一批），用函数式更新，不改传进来的那份状态。
//   4) 接线：三处都挂在同一套观察器上；组件里不再自己建观察器（旧那段「读数一变就重建观察器」就是
//      失败重试环的来源）；叶子不新增任何定时器（#709 的不变量）。
// 反证（仓库既有纪律：每道门禁必须带一条）：把判定、接线、级联重判、词条各改坏一处，同一套断言必须
//   当场变红；而且反证自己也要自证「真的改到了源码」（改不中就等于没证）。
const fs = require('fs')
const path = require('path')
const { compileFn } = require('./lib/eval-probe.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (t) => t.replace(/^(\s*)export\s+/gm, '$1')

const LEAF = 'src/client/views/versionControl/vcInView.js'
const TAB = 'src/client/views/versionControl/VersionControlTab.js'
const FLOW = 'src/client/kernel/locale-flow.js'
const PANEL = 'src/client/kernel/locale-panel.js'

// ---------- 闭包：块模型（常量来源）+ 新叶子，照 scripts/build.mjs 的拼法 ----------
function modOf(patch) {
  let src = [read('src/client/views/versionControl/vcBlocks.js'), read(LEAF)].map(strip).join('\n')
  if (patch) src = patch(src)
  const body = src + '\nreturn { VC_FILE_ROWS_FIRST, VC_FILE_ROWS_BATCH, vcMoreStepOf, vcMoreStateOf, vcMoreShownOf }\n'
  return compileFn(['React'], body)({})
}

// ---------- 1) 纯判定真值表 ----------
const RULE = [
  [{ hasMore: true }, 'draw', '还有没显示的、上一批已经落地 → 接着显示'],
  [{ hasMore: true, pending: true }, 'wait', '上一批还没落地 → 等它落地'],
  [{ hasMore: true, failed: true }, 'stop', '上一次读取失败 → 不自动重试'],
  [{ hasMore: true, pending: true, failed: true }, 'stop', '失败优先于等待'],
  [{ hasMore: false }, 'stop', '没有没显示的了 → 停'],
  [{ hasMore: false, pending: true }, 'stop', '没有更多时连等都不等'],
  [{ hasMore: 'yes' }, 'stop', '只认布尔真：拿字符串来当「还有」不算'],
  [{}, 'stop', '状态里没写「还有没有」→ 停'],
  [null, 'stop', '拿不到状态 → 停（宁可不动，也不反复试）'],
  [undefined, 'stop', '状态是 undefined → 停'],
]
function ruleProblems(mod) {
  const bad = []
  RULE.forEach((row) => {
    const got = mod.vcMoreStepOf(row[0])
    if (got !== row[1]) bad.push(JSON.stringify(row[0]) + ' 应为 ' + row[1] + '，实得 ' + got + '（' + row[2] + '）')
  })
  return bad
}

// ---------- 2) 从块清单里取「还有没有」 ----------
function stateProblems(mod) {
  const bad = []
  const groupsOf = (a) => ([
    { kind: 'changes', groups: [{ key: 'staged', moreCount: a[0] }, { key: 'conflict', moreCount: a[1] }, { key: 'unstaged', moreCount: a[2] }] },
    { kind: 'other', moreCount: a[3] },
    { kind: 'commits', more: { show: true }, collapsed: false },
  ])
  const idle = mod.vcMoreStateOf(groupsOf([10, 0, 0, 3]), { log: { state: 'idle', hasMore: false } })
  if (!idle.staged || idle.staged.hasMore !== true) bad.push('已暂存还有 10 行没画，取出来却是 ' + JSON.stringify(idle.staged))
  if (!idle.conflict || idle.conflict.hasMore !== false) bad.push('冲突组一行都不剩，取出来却是 ' + JSON.stringify(idle.conflict))
  if (!idle.unstaged || idle.unstaged.hasMore !== false) bad.push('未暂存组一行都不剩，取出来却是 ' + JSON.stringify(idle.unstaged))
  if (!idle.other || idle.other.hasMore !== true) bad.push('工作树还有 3 棵没收起，取出来却是 ' + JSON.stringify(idle.other))
  if (!idle.commits || idle.commits.hasMore !== true || idle.commits.failed !== false) bad.push('提交历史第一次读数回来之前按「还有」处理（原来那段就是这样触发的），实得 ' + JSON.stringify(idle.commits))
  const okDone = mod.vcMoreStateOf(groupsOf([0, 0, 0, 0]), { log: { state: 'ok', hasMore: false, commits: [{}] } })
  if (!okDone.commits || okDone.commits.hasMore !== false) bad.push('宿主回过 hasMore:false 之后就不该再自动去读，实得 ' + JSON.stringify(okDone.commits))
  const okMore = mod.vcMoreStateOf(groupsOf([0, 0, 0, 0]), { log: { state: 'ok', hasMore: true, commits: [{}] } })
  if (!okMore.commits || okMore.commits.hasMore !== true) bad.push('宿主说还有更早的提交时应当继续，实得 ' + JSON.stringify(okMore.commits))
  const err = mod.vcMoreStateOf(groupsOf([9, 0, 0, 0]), { log: { state: 'err' } })
  if (!err.commits || err.commits.failed !== true) bad.push('读取失败要标成失败态（判定那边据此停住），实得 ' + JSON.stringify(err.commits))
  if (!err.staged || err.staged.hasMore !== true) bad.push('提交历史读取失败不该牵连改动页的文件分批，实得 ' + JSON.stringify(err.staged))
  const empty = mod.vcMoreStateOf([{ kind: 'hint' }, { kind: 'identity' }, { kind: 'band' }, { kind: 'terminal' }], { log: { state: 'idle' } })
  if (Object.keys(empty).length !== 0) bad.push('没有那几种块时不该凭空造出键，实得 ' + JSON.stringify(empty))
  if (Object.keys(mod.vcMoreStateOf(null, null)).length !== 0) bad.push('块清单拿不到时应当返回空表')
  const summary = mod.vcMoreStateOf([{ kind: 'changes', groups: [{ key: 'staged', moreCount: 1 }, { moreCount: 5 }] }], null)
  if (Object.keys(summary).length !== 1) bad.push('分组没有 key 的那一条不该进表，实得 ' + JSON.stringify(summary))
  return bad
}

// ---------- 3) 再画一批 ----------
function shownProblems(mod) {
  const bad = []
  const calls = []
  const setUi = (updater) => { calls.push(updater) }
  const before = { fileShown: {}, openDiff: 'x.txt', view: 'changes' }
  mod.vcMoreShownOf(setUi, 'unstaged')
  if (calls.length !== 1 || typeof calls[0] !== 'function') return ['setUi 应当收到一个函数式更新（同期别的 setUi 不能被顶掉）']
  const next = calls[0](before)
  const first = mod.VC_FILE_ROWS_FIRST + mod.VC_FILE_ROWS_BATCH
  if (!next || !next.fileShown || next.fileShown.unstaged !== first) bad.push('第一次接着显示应当画到 ' + first + ' 行，实得 ' + JSON.stringify(next && next.fileShown))
  if (before.fileShown.unstaged !== undefined) bad.push('不该改动传进来的那份状态（实得 ' + JSON.stringify(before.fileShown) + '）')
  if (next.openDiff !== 'x.txt' || next.view !== 'changes') bad.push('别的界面状态一个字都不该动，实得 ' + JSON.stringify({ openDiff: next.openDiff, view: next.view }))
  const again = calls[0](next)
  if (again.fileShown.unstaged !== first + mod.VC_FILE_ROWS_BATCH) bad.push('再遇一次应当再画一批（期望 ' + (first + mod.VC_FILE_ROWS_BATCH) + '，实得 ' + JSON.stringify(again.fileShown) + '）')
  const fresh = calls[0]({ fileShown: { staged: 30 } })
  if (fresh.fileShown.staged !== 30 || fresh.fileShown.unstaged !== first) bad.push('只该动点名的那个分组，实得 ' + JSON.stringify(fresh.fileShown))
  return bad
}

// ---------- 4) 接线与词条（源码文本判据） ----------
function wiringProblems(tab, leaf) {
  const bad = []
  if (!/ref: moreSight\.refOf\(g\.key\)/.test(tab)) bad.push('改动页每个文件分组没有挂上观察器（查 ref: moreSight.refOf(g.key)）')
  if (!/ref: moreSight\.refOf\('other'\)/.test(tab)) bad.push('工作树页那句没有挂上观察器（查 ref: moreSight.refOf(\'other\')）')
  if (!/ref: moreSight\.refOf\('commits'\)/.test(tab)) bad.push('提交历史页那句没有挂上观察器（查 ref: moreSight.refOf(\'commits\')）')
  if (!/moreStateRef\.current = vcMoreStateOf\(blocks, reads\)/.test(tab)) bad.push('每帧没有把各处的「还有没有」交给接线（查 moreStateRef.current = vcMoreStateOf(...)）')
  if (tab.indexOf('new IntersectionObserver(') >= 0) bad.push('组件里又自己建观察器了：观察器只该住在 vcInView.js（旧那段就是失败重试环的来源）')
  if (/moreRef/.test(tab)) bad.push('组件里还留着旧的单个 ref（moreRef）')
  if (/moreFiles/.test(tab)) bad.push('组件里还留着旧的「点击展开」函数（moreFiles）：点与自动应当是同一条 draw')
  if (leaf.indexOf('new IntersectionObserver(') < 0) bad.push('vcInView.js 里没有观察器：接线没落在叶子上')
  if (!/io\.unobserve\(el\); io\.observe\(el\)/.test(leaf)) bad.push('画完一批之后没有显式重判一次（级联的写法：重新观察同一句提示）')
  if (/setTimeout|setInterval|requestAnimationFrame/.test(leaf)) bad.push('叶子里出现了定时器或逐帧回调（#709 的不变量：一个都不加）')
  if (!/typeof IntersectionObserver === 'undefined'/.test(leaf)) bad.push('没有观察器时要留退路（那句提示照旧可以点），叶子里少了这道判断')
  return bad
}
function wordingProblems(flow, panel) {
  const bad = []
  const valuesOf = (src, key) => {
    const re = new RegExp("'" + key.replace(/\./g, '\\.') + "': '([^']*)'", 'g')
    const out = []
    let m
    while ((m = re.exec(src))) out.push(m[1])
    return out
  }
  const more = valuesOf(flow, 'vc.more')
  if (more.length !== 2) bad.push('vc.more 应当中英一对，实得 ' + JSON.stringify(more))
  more.forEach((v) => { if (v.indexOf('点击') >= 0) bad.push('vc.more 还在说「点击」：' + v) })
  if (!more.some((v) => v.indexOf('下滑') >= 0)) bad.push('中文那句没有说清「下滑会自动显示」：' + JSON.stringify(more))
  if (!more.some((v) => /scrolling/i.test(v))) bad.push('英文那句没有说清下滑会显示：' + JSON.stringify(more))
  const other = valuesOf(panel, 'vc.other.more')
  if (other.length !== 2) bad.push('vc.other.more 应当中英一对，实得 ' + JSON.stringify(other))
  other.forEach((v) => { if (v.indexOf('点击') >= 0) bad.push('vc.other.more 还在说「点击」：' + v) })
  if (!other.some((v) => v.indexOf('下滑') >= 0)) bad.push('工作树那句中文没有说清下滑会显示：' + JSON.stringify(other))
  if (!other.some((v) => /scrolling/i.test(v))) bad.push('工作树那句英文没有说清下滑会显示：' + JSON.stringify(other))
  return bad
}

// ---------- 跑一遍（原样） ----------
const VIEW = modOf(null)
const original = {
  rule: ruleProblems(VIEW),
  state: stateProblems(VIEW),
  shown: shownProblems(VIEW),
}
check(original.rule.length === 0, '判定真值表全过（10 档）' + (original.rule.length ? '：' + original.rule[0] : ''))
check(original.state.length === 0, '从块清单里取「还有没有」全过（11 档）' + (original.state.length ? '：' + original.state[0] : ''))
check(original.shown.length === 0, '再画一批：函数式更新、不改原状态、只动点名的分组' + (original.shown.length ? '：' + original.shown[0] : ''))
const tabSrc = read(TAB)
const leafSrc = read(LEAF)
const wiring = wiringProblems(tabSrc, leafSrc)
check(wiring.length === 0, '接线：三处挂同一套观察器、组件不自建观察器、叶子无定时器' + (wiring.length ? '：' + wiring[0] : ''))
const wording = wordingProblems(read(FLOW), read(PANEL))
check(wording.length === 0, '词条：这句话说行为、不说点击（中英成对）' + (wording.length ? '：' + wording[0] : ''))

// ---------- 反证：每处都要能改红 ----------
const brokenRule = modOf((s) => s.replace("if (s && s.failed === true) return 'stop'", ''))
const bRule = ruleProblems(brokenRule)
check(bRule.length > 0, '反证：删掉「失败态停止」之后，判定表当场变红（' + (bRule[0] || '没有变红') + '）')
const brokenWait = modOf((s) => s.replace('if (s.pending === true) return \'wait\'', ''))
check(ruleProblems(brokenWait).length > 0, '反证：删掉「等上一批落地」之后，判定表当场变红')
const brokenState = modOf((s) => s.replace("out.commits = { hasMore: log.state === 'ok' ? log.hasMore !== false : true, failed: log.state === 'err' }", 'out.commits = { hasMore: true }'))
check(stateProblems(brokenState).length > 0, '反证：提交历史那处的失败态被抹掉之后，状态判定当场变红')
const brokenShown = modOf((s) => s.replace('next[key] = shown + VC_FILE_ROWS_BATCH', 'next[key] = shown'))
check(shownProblems(brokenShown).length > 0, '反证：把「再画一批」改成「画同样多」之后当场变红')

const noGroupRef = tabSrc.replace('ref: moreSight.refOf(g.key), ', '')
const noOtherRef = tabSrc.replace("ref: moreSight.refOf('other'), ", '')
const noCommitsRef = tabSrc.replace("ref: moreSight.refOf('commits'), ", '')
check(noGroupRef !== tabSrc && wiringProblems(noGroupRef, leafSrc).length > 0, '反证：摘掉改动页那处 ref 之后，接线断言当场变红（且确实改到了源码）')
check(noOtherRef !== tabSrc && wiringProblems(noOtherRef, leafSrc).length > 0, '反证：摘掉工作树页那处 ref 之后当场变红')
check(noCommitsRef !== tabSrc && wiringProblems(noCommitsRef, leafSrc).length > 0, '反证：摘掉提交历史那处 ref 之后当场变红')
const noRearm = leafSrc.replace('io.unobserve(el); io.observe(el)', '')
check(noRearm !== leafSrc && wiringProblems(tabSrc, noRearm).length > 0, '反证：删掉「画完一批显式重判」之后当场变红')
const withTimer = leafSrc.replace('const nodesRef = React.useRef({})', 'const nodesRef = React.useRef({}); setTimeout(function () {}, 1000)')
check(wiringProblems(tabSrc, withTimer).length > 0, '反证：叶子里插一个定时器之后当场变红（#709 那条不变量有牙齿）')
const oldWording = read(FLOW).replace("'vc.more': '另有 {n} 个文件，下滑会自动显示'", "'vc.more': '另有 {n} 个文件，点击展开查看'")
check(oldWording !== read(FLOW) && wordingProblems(oldWording, read(PANEL)).length > 0, '反证：词条改回「点击展开查看」之后当场变红')

console.log('')
if (failed) { console.log('存在失败 — verify-997-vc-sight 未通过（' + total + ' 项断言）'); process.exit(1) }
console.log('全部通过 — 「滑到那句提示就接着显示」门禁生效（' + total + ' 项断言）')
