// tests/verify-997-vc-sight.ts — 「滑到那句提示就接着显示」的门禁（#997 落地）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mjs tests/verify-997-vc-sight.ts，可独立运行。（2026-10-17 从 .js 转成 TypeScript：只改名与加类型标注，判据一条没动）
//
// 守三件事：
//   1) 纯判定 vcMoreStepOf：什么时候接着显示（draw）、什么时候等上一批落地（wait）、什么时候停（stop，
//      含「没有更多」与「上一次失败了」两档 —— 失败不自动重试，交给那句失败提示与它的重试按钮）。
//   2) vcMoreStateOf：从块清单里取出改动页三个分组、工作树页、提交历史页各自「还有没有没显示的」；
//      视图里没有那个块就没有那个键（也就不会被触发）。
//   3) vcMoreShownOf：再画一批是本地动作（把已取回的行多画一批），用函数式更新，不改传进来的那份状态。
// 反证（仓库既有纪律：每道门禁必须带一条）：把判定与「再画一批」各改坏一处，同一套断言必须当场变红；
//   而且反证自己也要自证「真的改到了源码」（改不中就等于没证）。
// 原来还守着「接线」与「词条」两段：接线那一段是把组件源码当文本、用正则要求它长成某种写法
//   （ref: moreSight.refOf(...) 必须原样出现、moreRef 不许出现…），等价重构就会变红，已按维护者的
//   要求整段删除；「接线对不对」改由真 Chromium 里跑的 tests/verify-997-vc-sight-browser.js 量。
const fs = require('fs')
const path = require('path')
const { compileFn } = require('./lib/eval-probe.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// 取源走共用入口（#1207 立的 tests/lib/source-text.ts）：locale-panel 已从 .js 转成 .ts，
// 按旧路径直接读会读到构建产物（字符串改双引号），下面 wordingProblems 只认单引号会误报。
// FLOW 仍是 .js 也走同一条（入口对没转的文件原样返回），省得下次转它时再改一次。
const { sourceText } = require('./lib/source-text.ts')
const strip = (t: string): string => t.replace(/^(\s*)export\s+/gm, '$1')

const LEAF = 'src/client/views/versionControl/vcInView.js'
const FLOW = 'src/client/kernel/locale-flow.js'
const PANEL = 'src/client/kernel/locale-panel.js'

// ---------- 闭包：块模型（常量来源）+ 新叶子，照 scripts/build.mjs 的拼法 ----------
function modOf(patch: ((s: string) => string) | null) {
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
function ruleProblems(mod: any): string[] {
  const bad = []
  RULE.forEach((row) => {
    const got = mod.vcMoreStepOf(row[0])
    if (got !== row[1]) bad.push(JSON.stringify(row[0]) + ' 应为 ' + row[1] + '，实得 ' + got + '（' + row[2] + '）')
  })
  return bad
}

// ---------- 2) 从块清单里取「还有没有」 ----------
function stateProblems(mod: any): string[] {
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
function shownProblems(mod: any): string[] {
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

// ---------- 4) 词条（这句话说行为、不说点击） ----------
function wordingProblems(flow: string, panel: string): string[] {
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
const wording = wordingProblems(sourceText(FLOW), sourceText(PANEL))
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

const oldWording = sourceText(FLOW).replace("'vc.more': '另有 {n} 个文件，下滑会自动显示'", "'vc.more': '另有 {n} 个文件，点击展开查看'")
check(oldWording !== sourceText(FLOW) && wordingProblems(oldWording, sourceText(PANEL)).length > 0, '反证：词条改回「点击展开查看」之后当场变红')

console.log('')
if (failed) { console.log('存在失败 — verify-997-vc-sight 未通过（' + total + ' 项断言）'); process.exit(1) }
console.log('全部通过 — 「滑到那句提示就接着显示」门禁生效（' + total + ' 项断言）')
