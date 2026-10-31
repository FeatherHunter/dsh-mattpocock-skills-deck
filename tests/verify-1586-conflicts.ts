// 门禁归属: src/host/versionControlConflictMount.ts
// 冲突向导（#1747 T12，规格域 6 十五条）契约门禁：先锁共享协议与冲突文本解析，再锁宿主预检/执行与登记点。
// 全篇用真实临时 git 仓库与假进程夹具：真冲突由本机 git 造出来，argv 走夹具观测，不联网。
'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.ts')
const { localeDataText } = require('./lib/locale-data.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-conflicts'
let total = 0
let failed = 0
function check(ok, msg) {
  total += 1
  if (!ok) {
    failed += 1
    console.log('  FAIL ' + msg)
  }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(a === e, msg + '（期望 ' + e + '，实得 ' + a + '）')
}
function has(text, needle, msg) {
  check(String(text).indexOf(needle) >= 0, msg + '（源码里找不到 ' + needle + '）')
}
const { createHash } = require('node:crypto')

function digest16(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 16)
}

async function main() {
  const shared = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/conflict-ops.js')).href)
  const textMod = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/conflict-text.js')).href)

  // ———— A 组：共享协议（动作枚举、argv、守卫、状态机、分类） ————
  const WRITE_IDS = ['merge', 'merge-ff-only', 'merge-no-ff', 'merge-squash', 'take-side', 'save-file', 'mark-resolved', 'op-continue', 'op-skip', 'op-abort']
  const WRITE_CAPS = ['6.1', '6.2', '6.3', '6.4', '6.6', '6.7', '6.8', '6.11', '6.12', '6.13']
  const READ_IDS = ['conflict-list', 'conflict-view', 'merge-preview', 'rerere-view', 'marker-check']
  const READ_CAPS = ['6.5', '6.9', '6.10', '6.14', '6.15']
  eq(shared.CONFLICT_WRITE_OPS.map((o) => o.id), WRITE_IDS, 'A1 十条写动作按规格顺序登记')
  eq(shared.CONFLICT_WRITE_OPS.map((o) => o.capId), WRITE_CAPS, 'A2 写动作能力号 6.1/6.2/6.3/6.4/6.6/6.7/6.8/6.11/6.12/6.13')
  eq(shared.CONFLICT_READ_OPS.map((o) => o.id), READ_IDS, 'A3 五条只读动作登记（冲突清单/视图/预演/rerere/标记检查）')
  eq(shared.CONFLICT_READ_OPS.map((o) => o.capId), READ_CAPS, 'A4 只读动作能力号 6.5/6.9/6.10/6.14/6.15')
  eq(shared.CONFLICT_OPS.map((o) => o.capId).sort(), ['6.1', '6.10', '6.11', '6.12', '6.13', '6.14', '6.15', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.8', '6.9'], 'A5 十五条能力一条不少')
  check(shared.CONFLICT_OPS.length === 15, 'A6 动作表恰好 15 条（实得 ' + shared.CONFLICT_OPS.length + '）')
  check(shared.CONFLICT_OPS.every((o) => typeof o.command === 'string' && o.command !== ''), 'A7 每条动作都带命令原文列（界面与门禁都从表里读）')
  check(shared.CONFLICT_OPS.every((o) => String(o.labelKey).indexOf('vc.conflicts.op.') === 0), 'A8 每条动作的文案键都在 vc.conflicts.op. 族下')
  check(shared.CONFLICT_WRITE_OPS.every((o) => o.kind === 'write') && shared.CONFLICT_READ_OPS.every((o) => o.kind === 'read'), 'A9 读写动作的 kind 字段与所在表一致')
  eq(shared.CONFLICT_WRITE_OPS.filter((o) => o.dangerous === true).map((o) => o.id), ['op-skip', 'op-abort'], 'A10 只有跳过与中止算危险动作（要二次确认）')
  check(shared.CONFLICT_WRITE_OPS.filter((o) => o.dangerous === true).every((o) => o.confirm === true), 'A11 危险动作必须要求确认卡')
  check(shared.CONFLICT_WRITE_OPS.filter((o) => o.dangerous !== true).every((o) => o.confirm !== true), 'A12 非危险动作不要求确认卡')
  eq(shared.conflictStepsOf({ op: 'merge', target: 'other' }), [['merge', 'other']], 'A13 6.1 普通合并不带多余旗标')
  eq(shared.conflictStepsOf({ op: 'merge-ff-only', target: 'other' }), [['merge', '--ff-only', 'other']], 'A14 6.2 只允许快进')
  eq(shared.conflictStepsOf({ op: 'merge-no-ff', target: 'other' }), [['merge', '--no-ff', 'other']], 'A15 6.3 禁止快进')
  eq(shared.conflictStepsOf({ op: 'merge-squash', target: 'other' }), [['merge', '--squash', 'other']], 'A16 6.4 挤压合并')
  eq(shared.conflictStepsOf({ op: 'take-side', side: 'ours', path: 'a.txt' }), [['checkout', '--ours', '--', 'a.txt'], ['add', '--', 'a.txt']], 'A17 6.6 选当前边：先 checkout 再登记')
  eq(shared.conflictStepsOf({ op: 'take-side', side: 'theirs', path: 'a.txt' }), [['checkout', '--theirs', '--', 'a.txt'], ['add', '--', 'a.txt']], 'A18 6.6 选对方边：先 checkout 再登记')
  eq(shared.conflictStepsOf({ op: 'take-side', side: 'delete', path: 'a.txt' }), [['rm', '--', 'a.txt']], 'A19 6.6 保留删除：git rm 一条命令')
  eq(shared.conflictStepsOf({ op: 'mark-resolved', path: 'a.txt' }), [['add', '--', 'a.txt']], 'A20 6.8 标记已解决就是 git add')
  eq(shared.conflictStepsOf({ op: 'save-file', path: 'a.txt' }), [], 'A21 6.7 面板内整份编辑不拼 argv（由宿主写文件）')
  check(shared.conflictOpMetaOf('save-file').fs === true, 'A22 整份编辑动作在表里标着 fs=true（写文件不是 git 命令）')
  eq(shared.conflictStepsOf({ op: 'op-continue', state: 'merge' }), [['merge', '--continue']], 'A23 6.11 合并继续')
  eq(shared.conflictStepsOf({ op: 'op-continue', state: 'rebase' }), [['rebase', '--continue']], 'A24 6.11 变基继续')
  eq(shared.conflictStepsOf({ op: 'op-skip', state: 'cherry-pick' }), [['cherry-pick', '--skip']], 'A25 6.12 拣选跳过')
  eq(shared.conflictStepsOf({ op: 'op-abort', state: 'revert' }), [['revert', '--abort']], 'A26 6.13 回退中止')
  check(shared.CONFLICT_OPS.every((o) => shared.conflictStepsOf({ op: o.id, target: 'x', path: 'a.txt', side: 'ours', state: 'merge' }).every((argv) => argv.every((a) => typeof a === 'string' && a.indexOf(' ') < 0))), 'A27 每条 argv 的每个元素都是独立字符串、没有拼空格的一整串')
  check(shared.CONFLICT_OPS.every((o) => shared.conflictStepsOf({ op: o.id, target: 'x', path: 'a.txt', side: 'ours', state: 'merge' }).every((argv) => argv.indexOf('git') < 0)), 'A28 argv 里不出现 git 可执行名（固定前缀与可执行文件由宿主拼）')
  check(shared.conflictTargetProblem('main') === null && shared.conflictTargetProblem('origin/main') === null && shared.conflictTargetProblem('feature/x-1') === null && shared.conflictTargetProblem('abc1234') === null, 'A29 合并目标接受分支名、远端分支与完整提交号')
  check(shared.conflictTargetProblem('') === 'bad-target' && shared.conflictTargetProblem('-x') === 'bad-target' && shared.conflictTargetProblem('a b') === 'bad-target' && shared.conflictTargetProblem('a..b') === 'bad-target' && shared.conflictTargetProblem('a:b') === 'bad-target' && shared.conflictTargetProblem('a\\b') === 'bad-target', 'A30 合并目标拒绝空、前导短横线、空白、..、冒号与反斜杠')
  check(shared.conflictPathProblem('a.txt') === null && shared.conflictPathProblem('dir/b.txt') === null, 'A31 冲突路径接受普通仓库内路径')
  check(shared.conflictPathProblem('') === 'bad-path' && shared.conflictPathProblem('-x') === 'bad-path' && shared.conflictPathProblem('/abs') === 'bad-path' && shared.conflictPathProblem('C:/x') === 'bad-path' && shared.conflictPathProblem('a\\b') === 'bad-path' && shared.conflictPathProblem('../x') === 'bad-path' && shared.conflictPathProblem('.git') === 'bad-path' && shared.conflictPathProblem('.git/config') === 'bad-path' && shared.conflictPathProblem('a//b') === 'bad-path', 'A32 冲突路径拒绝空、选项样、绝对、盘符、反斜杠、上跳与 .git')
  check(shared.conflictSideProblem('ours') === null && shared.conflictSideProblem('theirs') === null && shared.conflictSideProblem('delete') === null && shared.conflictSideProblem('both') === 'bad-side', 'A33 选边只认当前/对方/保留删除三档')
  eq(shared.CONFLICT_STATES, ['merge', 'rebase', 'cherry-pick', 'revert'], 'A34 四种进行中操作的固定顺序')
  eq(shared.conflictStateOfScreen({ repo: { merging: true, rebasing: false, cherryPicking: false, reverting: false } }), 'merge', 'A35 状态机：MERGE_HEAD 在就是合并中')
  eq(shared.conflictStateOfScreen({ repo: { merging: false, rebasing: true, cherryPicking: false, reverting: false } }), 'rebase', 'A36 状态机：变基目录在就是变基中')
  eq(shared.conflictStateOfScreen({ repo: { merging: false, rebasing: false, cherryPicking: true, reverting: false } }), 'cherry-pick', 'A37 状态机：CHERRY_PICK_HEAD 在就是拣选中')
  eq(shared.conflictStateOfScreen({ repo: { merging: false, rebasing: false, cherryPicking: false, reverting: true } }), 'revert', 'A38 状态机：REVERT_HEAD 在就是回退中')
  eq(shared.conflictStateOfScreen({ repo: {} }), null, 'A39 状态机：什么都没有就是没有进行中操作')
  eq(shared.conflictStateLabelKeyOf('cherry-pick'), 'vc.conflicts.state.cherryPick', 'A40 状态文案键走驼峰族名')
  check(shared.conflictOpAllowedIn('merge', null) === null && shared.conflictOpAllowedIn('merge', 'merge') === 'operation-in-progress', 'A41 合并动作只在没有进行中操作时允许')
  check(shared.conflictOpAllowedIn('op-continue', null) === 'no-operation' && shared.conflictOpAllowedIn('op-continue', 'merge', true) === 'unmerged-files' && shared.conflictOpAllowedIn('op-continue', 'merge') === null, 'A42 继续要求有进行中操作且冲突全解决')
  check(shared.conflictOpAllowedIn('op-skip', 'merge') === 'wrong-operation' && shared.conflictOpAllowedIn('op-skip', 'rebase') === null && shared.conflictOpAllowedIn('op-skip', null) === 'no-operation', 'A43 跳步只适用于变基/拣选/回退，合并没有跳步')
  check(shared.conflictOpAllowedIn('op-abort', null) === 'no-operation' && shared.conflictOpAllowedIn('op-abort', 'merge') === null, 'A44 中止要求有进行中操作')
  check(shared.conflictOpAllowedIn('take-side', null, false) === 'nothing-to-do' && shared.conflictOpAllowedIn('take-side', 'merge', true) === null, 'A45 选边只在有冲突文件时允许')
  check(shared.conflictOpAllowedIn('merge-preview', 'merge') === 'operation-in-progress', 'A46 预演合并不能在有进行中操作时做')
  eq(shared.conflictSidesOf([1, 2, 3]), { ours: true, theirs: true, delete: true }, 'A47 双方都改：两条边加保留删除')
  eq(shared.conflictSidesOf([1, 2]), { ours: true, theirs: false, delete: true }, 'A48 对方删了自己改了：只有当前边与保留删除')
  eq(shared.conflictSidesOf([1, 3]), { ours: false, theirs: true, delete: true }, 'A49 自己删了对方改了：只有对方边与保留删除')
  eq(shared.conflictSidesOf([1]), { ours: false, theirs: false, delete: true }, 'A50 双方都删了：只能保留删除')
  eq(shared.conflictKindOf({ stages: [1, 2, 3], modes: ['100644', '100644', '100644'] }), 'both-changed', 'A51 分类：三阶段齐是双方修改')
  eq(shared.conflictKindOf({ stages: [1, 2], modes: ['100644', '100644'] }), 'deleted-by-theirs', 'A52 分类：只有当前阶段是对方删除')
  eq(shared.conflictKindOf({ stages: [1, 3], modes: ['100644', '100644'] }), 'deleted-by-ours', 'A53 分类：只有对方阶段是自己删除')
  eq(shared.conflictKindOf({ stages: [2, 3], modes: ['100644', '100644'] }), 'both-changed', 'A54 分类：没有基准阶段（双方新增）也算双方修改')
  eq(shared.conflictKindOf({ stages: [2], modes: ['100644'] }), 'renamed', 'A55 分类：单阶段无基准是改名冲突')
  eq(shared.conflictKindOf({ stages: [1], modes: ['100644'] }), 'both-deleted', 'A56 分类：只有基准阶段是双方都删')
  eq(shared.conflictKindOf({ stages: [1, 2, 3], modes: ['100644', '100644', '100755'] }), 'mode', 'A57 分类：模式差异单独成一类（不显示逐块）')
  eq(shared.conflictKindOf({ stages: [1, 2, 3], modes: ['160000', '160000', '160000'] }), 'submodule', 'A58 分类：子模组冲突单独成一类')
  const planA = shared.conflictPlanOf({ op: 'save-file', path: 'a.txt', textDigest: 'abc', oldDigest: 'def' })
  eq(Object.keys(planA).sort(), ['oldDigest', 'op', 'path', 'side', 'state', 'target', 'textDigest'], 'A59 计划字段固定为七格（执行层与门禁按同一份形状读）')
  eq(shared.conflictPlanOf({ op: 'merge', target: 'other' }).state, null, 'A60 计划未给的格子落 null 而不是 undefined')

  // ———— B 组：冲突文本解析与整份编辑 ————
  eq(textMod.conflictMarkerLineOf('ok\n<<<<<<< HEAD\n'),
    { line: 2, marker: '<<<<<<<' }, 'B1 残留标记扫描给出首个标记行号与种类')
  eq(textMod.conflictMarkerLineOf('a\n=======\nb\n'), { line: 2, marker: '=======' }, 'B2 分隔线本身也算残留标记（与 git diff --check 同口径）')
  eq(textMod.conflictMarkerLineOf('plain text\n'), null, 'B3 没有标记回 null')
  const one = textMod.splitConflictHunks('head\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\ntail\n')
  check(one.ok === true && one.hunks.length === 1, 'B4 单块冲突解析成功（实得 ' + JSON.stringify(one.ok) + '）')
  if (one.ok === true) {
    eq(one.hunks[0].oursLines, ['ours\n'], 'B5 当前边内容逐行取出')
    eq(one.hunks[0].theirsLines, ['theirs\n'], 'B6 对方边内容逐行取出')
    eq(one.hunks[0].baseLines, null, 'B7 没有基准段时 baseLines 是 null')
    check(one.hunks[0].startLine === 2, 'B8 块起始行号按 1 起数（实得 ' + one.hunks[0].startLine + '）')
  }
  const withBase = textMod.splitConflictHunks('<<<<<<< HEAD\na\n||||||| base\nb\n=======\nc\n>>>>>>> x\n')
  check(withBase.ok === true && withBase.hunks[0].baseLines !== null && withBase.hunks[0].baseLines.join('') === 'b\n', 'B9 带基准段的冲突逐段解析')
  const multi = textMod.splitConflictHunks('x\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> y\nmid\n<<<<<<< HEAD\nc\n=======\nd\n>>>>>>> y\nz\n')
  check(multi.ok === true && multi.hunks.length === 2, 'B10 多个冲突块逐块编号（实得 ' + (multi.hunks ? multi.hunks.length : 'err') + '）')
  if (multi.ok === true) { check(multi.hunks[0].index === 0 && multi.hunks[1].index === 1, 'B11 块号从 0 起连着排') }
  check(textMod.splitConflictHunks('<<<<<<< HEAD\na\n=======\nb\n').ok === false, 'B12 没有结束标记判解析失败')
  check(textMod.splitConflictHunks('<<<<<<< HEAD\na\n>>>>>>> x\n').ok === false, 'B13 没有分隔线判解析失败')
  const appOurs = textMod.applyConflictChoices('head\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\ntail\n', ['ours'])
  check(appOurs.ok === true && appOurs.text === 'head\nours\ntail\n', 'B14 逐块选当前边后拼出整份文本（实得 ' + JSON.stringify(appOurs.text) + '）')
  const appTheirs = textMod.applyConflictChoices('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n', ['theirs'])
  check(appTheirs.ok === true && appTheirs.text === 'theirs\n', 'B15 逐块选对方边')
  const appBoth = textMod.applyConflictChoices('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n', ['both'])
  check(appBoth.ok === true && appBoth.text === 'ours\ntheirs\n', 'B16 逐块两边都要（当前在前）')
  const appMiss = textMod.applyConflictChoices('<<<<<<< HEAD\na\n=======\nb\n>>>>>>> y\n', [])
  check(appMiss.ok === false, 'B17 有块没给选择时整份不拼（不许悄悄用默认边）')
  const crlf = textMod.applyConflictChoices('a\r\n<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> z\r\n', ['ours'])
  check(crlf.ok === true && crlf.text === 'a\r\nx\r\n', 'B18 拼装保留原有 CRLF 行尾（实得 ' + JSON.stringify(crlf.text) + '）')
  eq(textMod.conflictTextKindOf('plain\n'), 'text', 'B19 可解码且无 NUL 的文本按文本冲突')
  eq(textMod.conflictTextKindOf('bin\u0000ary'), 'binary', 'B20 含 NUL 的二进制按二进制冲突（不显示逐块）')
  const tProb = textMod.conflictTextProblem('ok\n<<<<<<< HEAD\n', 1024)
  check(tProb && tProb.reason === 'conflict-markers' && tProb.line === 2, 'B21 保存前先扫残留标记并给出行号（实得 ' + JSON.stringify(tProb) + '）')
  eq(textMod.conflictTextProblem('clean\n', 1024), null, 'B22 没有残留标记的整份文本可保存')
  const tBig = textMod.conflictTextProblem('x'.repeat(64), 32)
  check(tBig && tBig.reason === 'text-too-large', 'B23 超过上限的整份文本拒绝保存（实得 ' + JSON.stringify(tBig) + '）')

  await printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log('门禁自身抛错：' + ((e && e.stack) || e))
  failed += 1
  printGateResult(GATE, total, failed)
  process.exit(1)
})
