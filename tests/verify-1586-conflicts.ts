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
const { sourceText, spliceableJs } = require('./lib/source-text.ts')
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
/** 被拒回包的固定形状：kind 在 error 里，reason 与附加字段（line 等）平铺在顶层——failPhone 的约定。 */
function reasonOf(out) {
  if (!out) return undefined
  if (out.reason !== undefined) return out.reason
  return out.error ? out.error.reason : undefined
}
function fieldOf(out, key) {
  if (!out) return undefined
  if (out[key] !== undefined) return out[key]
  return out.error ? out.error[key] : undefined
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
  // 6.15 的两半：只查 --check 会漏掉「冲突已 git add 过、工作区与索引一致但索引内容里还留着标记」的文件，
  // 所以两条命令缺一不可（本条就是对抗审查发现的那处漏洞的回归断言）。
  eq(shared.conflictStepsOf({ op: 'marker-check' }), [['diff', '--check'], ['diff', '--cached', '--check']], 'A61 6.15 残留标记查两半：工作区与已暂存各一条命令')

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


  // ———— C 组：真临时 git 仓库里的冲突现场（预检签票、整份保存、选边、继续/跳过/中止、预演、rerere、标记检查） ————
  const fixedPkg = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/commands.js')).href)
  const fixedPrefix = fixedPkg.fixedPrefix
  const execEnv = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/exec-envelope.js')).href)
  const sceneMod = await import(pathToFileURL(path.join(ROOT, 'src/host/versionControlConflictScene.js')).href)
  const checkMod = await import(pathToFileURL(path.join(ROOT, 'src/host/versionControlConflictCheck.js')).href)
  const writeMod = await import(pathToFileURL(path.join(ROOT, 'src/host/versionControlConflictWrite.js')).href)
  const ticketMod = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/write-ticket.js')).href)
  const GIT_VERSION = (function () {
    // 保留「git version 」前缀原样：scene 的预演用 /git version (\d+)\.(\d+)/ 认版本，截掉前缀会让它以为读不出 git 版本。
    const r = cp.spawnSync('git', ['--version'], { encoding: 'utf8' })
    return String((r && r.stdout) || '').trim()
  })()
  const TMP_ROOT = process.env.TEMP || process.env.TMP || os.tmpdir()
  const tmpDirs = []
  function mkTmp(tag) { const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'dswsc1586-' + tag + '-')); tmpDirs.push(dir); return dir }
  function gitEnv(extra) { return Object.assign({}, process.env, { GIT_EDITOR: 'false' }, extra || {}) }
  function gitRun(cwd, args, env) {
    const res = cp.spawnSync('git', ['-C', cwd].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: gitEnv(env) })
    const code = res.status === null ? -1 : res.status
    return { code: code, stdout: res.stdout || '', stderr: res.stderr || '' }
  }
  function gitMust(cwd, args, env) {
    const res = gitRun(cwd, args, env)
    if (res.code !== 0) throw new Error('夹具 git 失败：git ' + args.join(' ') + '（退出码 ' + res.code + '，' + JSON.stringify(String(res.stderr).slice(0, 300)) + '）')
    return res.stdout
  }
  function initRepo(tag) {
    const dir = mkTmp(tag)
    gitMust(dir, ['init', '-q', '-b', 'main'])
    gitMust(dir, ['config', 'user.name', '门禁夹具'])
    gitMust(dir, ['config', 'user.email', 'gate@example.invalid'])
    gitMust(dir, ['config', 'core.autocrlf', 'false'])
    return dir
  }
  function writeFileIn(dir, rel, data) {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, data)
    return p
  }
  function commitAll(dir, msg) { gitMust(dir, ['add', '-A']); gitMust(dir, ['commit', '-q', '-m', msg || '夹具提交']) }
  /** 双方都改同一个文件：真合并一定冲突（退出码 1），留给选边、整份保存、继续、中止用。 */
  function mergeConflictRepo(tag) {
    const dir = initRepo(tag)
    writeFileIn(dir, 'a.txt', 'base\n'); commitAll(dir, '基线 a')
    gitMust(dir, ['checkout', '-q', '-b', 'other'])
    writeFileIn(dir, 'a.txt', 'theirs\n'); commitAll(dir, '对方改 a')
    gitMust(dir, ['checkout', '-q', 'main'])
    writeFileIn(dir, 'a.txt', 'ours\n'); commitAll(dir, '当前改 a')
    const m = gitRun(dir, ['merge', 'other'])
    if (m.code !== 1) throw new Error('夹具没造出合并冲突（退出码 ' + m.code + '）：' + String(m.stderr).slice(0, 300))
    return dir
  }
  /** 改/删冲突：对方删了而当前改了，索引只有阶段 1 与 2，没有「对方边」可选。 */
  function deleteTheirsRepo(tag) {
    const dir = initRepo(tag)
    writeFileIn(dir, 'c.txt', 'x\n'); commitAll(dir, '基线 c')
    gitMust(dir, ['checkout', '-q', '-b', 'other'])
    gitMust(dir, ['rm', '-q', 'c.txt']); commitAll(dir, '对方删 c')
    gitMust(dir, ['checkout', '-q', 'main'])
    writeFileIn(dir, 'c.txt', 'ours\n'); commitAll(dir, '当前改 c')
    const m = gitRun(dir, ['merge', 'other'])
    if (m.code !== 1) throw new Error('夹具没造出改/删冲突（退出码 ' + m.code + '）：' + String(m.stderr).slice(0, 300))
    return dir
  }
  /** 改名冲突：两边各改名成不同名字，未合并条目的每个路径只剩一个阶段。 */
  function renameConflictRepo(tag) {
    const dir = initRepo(tag)
    writeFileIn(dir, 'r.txt', 'r\n'); writeFileIn(dir, 'keep.txt', 'k\n'); commitAll(dir, '基线 r')
    gitMust(dir, ['checkout', '-q', '-b', 'other'])
    gitMust(dir, ['mv', 'r.txt', 'o.txt']); commitAll(dir, '对方改名 o')
    gitMust(dir, ['checkout', '-q', 'main'])
    gitMust(dir, ['mv', 'r.txt', 't.txt']); commitAll(dir, '当前改名 t')
    const m = gitRun(dir, ['merge', 'other'])
    if (m.code !== 1) throw new Error('夹具没造出改名冲突（退出码 ' + m.code + '）：' + String(m.stderr).slice(0, 300))
    return dir
  }
  /** 二进制冲突：两边改同一个带 NUL 的文件，判二进制靠读阶段内容扫 NUL。 */
  function binaryConflictRepo(tag) {
    const dir = initRepo(tag)
    writeFileIn(dir, 'bin.dat', Buffer.from([0, 1, 2, 3])); commitAll(dir, '基线 bin')
    gitMust(dir, ['checkout', '-q', '-b', 'other'])
    writeFileIn(dir, 'bin.dat', Buffer.from([0, 9, 9, 9])); commitAll(dir, '对方改 bin')
    gitMust(dir, ['checkout', '-q', 'main'])
    writeFileIn(dir, 'bin.dat', Buffer.from([0, 7, 7, 7])); commitAll(dir, '当前改 bin')
    const m = gitRun(dir, ['merge', 'other'])
    if (m.code !== 1) throw new Error('夹具没造出二进制冲突（退出码 ' + m.code + '）：' + String(m.stderr).slice(0, 300))
    return dir
  }
  /** 分支分叉但还没合并：留给 merge-tree 预演与「合并撞上冲突不算失败」两组。 */
  function previewRepo(tag) {
    const dir = initRepo(tag)
    writeFileIn(dir, 'a.txt', 'base\n'); commitAll(dir, '基线 a')
    gitMust(dir, ['checkout', '-q', '-b', 'other'])
    writeFileIn(dir, 'a.txt', 'theirs\n'); commitAll(dir, '对方改 a')
    gitMust(dir, ['checkout', '-q', 'main'])
    writeFileIn(dir, 'a.txt', 'ours\n'); commitAll(dir, '当前改 a')
    return dir
  }
  /** 变基冲突：topic 上那条提交在 main 上撞冲突，留给 --skip 用。 */
  function rebaseConflictRepo(tag) {
    const dir = initRepo(tag)
    writeFileIn(dir, 'a.txt', 'base\n'); commitAll(dir, '基线 a')
    gitMust(dir, ['checkout', '-q', '-b', 'topic'])
    writeFileIn(dir, 'a.txt', 'topic\n'); commitAll(dir, 'topic 改 a')
    gitMust(dir, ['checkout', '-q', 'main'])
    writeFileIn(dir, 'a.txt', 'main\n'); commitAll(dir, 'main 改 a')
    gitMust(dir, ['checkout', '-q', 'topic'])
    const rb = gitRun(dir, ['rebase', 'main'])
    if (rb.code === 0) throw new Error('夹具没造出变基冲突')
    return dir
  }
  /** 工作区里留着冲突标记的普通文件（不是未合并条目），留给 6.15 的两半检查。 */
  function markerRepo(tag) {
    const dir = initRepo(tag)
    writeFileIn(dir, 'd.txt', 'one\ntwo\nthree\n'); commitAll(dir, '基线 d')
    writeFileIn(dir, 'd.txt', 'one\n<<<<<<< HEAD\ntwo\n=======\ntwo2\n>>>>>>> other\nthree\n')
    return dir
  }
  /** 按首屏那份读数造出冲突现场需要的 screen；只取状态机与 HEAD 用到的字段，够本组断言。 */
  function screenOf(cwd) {
    const head = gitRun(cwd, ['rev-parse', 'HEAD'])
    const gitDir = path.join(cwd, '.git')
    return {
      identity: { oid: head.code === 0 ? String(head.stdout).trim() : '' },
      repo: {
        merging: fs.existsSync(path.join(gitDir, 'MERGE_HEAD')),
        rebasing: fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply')),
        cherryPicking: fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD')),
        reverting: fs.existsSync(path.join(gitDir, 'REVERT_HEAD')),
      },
      staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0, files: [],
    }
  }
  /** 一套真现场夹具：读、预检、执行三件接同一份注入依赖，进程走真 git（argv 逐条记下来）。 */
  function makeRig() {
    const spawns = []
    const clock = { t: 1700000000000 }
    const deps = {
      failPhone: function (kind, message, extra) { return Object.assign({ ok: false, error: { kind: kind, message: message } }, extra || {}) },
      firstLine: function (text) { const lines = String(text === undefined || text === null ? '' : text).split(/\r?\n/); return String(lines[0] || '').trim() },
      failureFromExec: execEnv.failureFromExec,
      runPinned: async function (exe, dir, args, opts) {
        spawns.push(args.slice())
        const res = cp.spawnSync('git', ['-C', dir].concat(fixedPrefix(), args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: gitEnv({ GIT_EDITOR: (opts && opts.gitEditor) ? String(opts.gitEditor) : 'false' }) })
        const code = res.status === null ? -1 : res.status
        return { kind: code === 0 ? 'ok' : 'non-zero', exitCode: code, stdout: res.stdout || '', stderr: res.stderr || '', truncated: false }
      },
      resolveGitExecutable: async function () { return 'git' },
      resolveRepoRoot: async function (exe, dir) { return { ok: true, root: String(dir) } },
      readScreenOf: async function (dir) { return { ok: true, screen: screenOf(dir), tier: 'full', gitVersion: GIT_VERSION } },
      fs: { resolve: async function (p) { return p }, readText: async function (p) { return await fsp.readFile(p, 'utf8') }, writeText: async function (p, t) { await fsp.writeFile(p, String(t), 'utf8') } },
      fsAbsence: async function () { return { isAbsenceError: function (e) { return !!e && (e.code === 'ENOENT' || /ENOENT/.test(String((e && e.message) || ''))) } } },
      now: function () { return clock.t },
    }
    const scene = sceneMod.createConflictScene(deps)
    const seq = { n: 0 }
    const check = checkMod.createConflictCheck({ scene: scene, failPhone: deps.failPhone, now: deps.now, randomId: function () { seq.n += 1; return 'tkt' + seq.n } })
    const write = writeMod.createConflictWrite({ failPhone: deps.failPhone, runPinned: deps.runPinned, resolveGitExecutable: deps.resolveGitExecutable, measure: scene.measure, scene: scene, now: deps.now, tickets: check.tickets, results: check.results })
    return { scene: scene, check: check, write: write, spawns: spawns, clock: clock }
  }

  const mergeDir = mergeConflictRepo('merge')
  const rig = makeRig()
  const list = await rig.check.handleConflictRead({ cwd: mergeDir, op: 'conflict-list' })
  check(list && list.ok === true, 'C1 真合并冲突下冲突清单读得回来（实得 ' + JSON.stringify(list && list.error) + '）')
  eq(list && list.state, 'merge', 'C2 进行中操作按 MERGE_HEAD 认成 merge')
  check(list && list.conflictCount === 1, 'C3 冲突文件恰好一个（实得 ' + (list && list.conflictCount) + '）')
  const firstEntry = list && list.conflicts && list.conflicts[0]
  eq(firstEntry && firstEntry.path, 'a.txt', 'C4 冲突路径是 a.txt')
  eq(firstEntry && firstEntry.kind, 'both-changed', 'C5 双方都改的文件归「双方改」一类')
  eq(firstEntry && firstEntry.textKind, 'text', 'C6 文本冲突按文本处理（不误判成二进制）')
  eq(firstEntry && firstEntry.sides, { ours: true, theirs: true, delete: true }, 'C7 双方改的三种边都可用')
  const view = await rig.check.handleConflictRead({ cwd: mergeDir, op: 'conflict-view', path: 'a.txt' })
  check(view && view.ok === true && view.hunkCount === 1, 'C8 面板冲突视图切出一块（实得 ' + (view && view.hunkCount) + '）')
  check(view && String(view.text).indexOf('<<<<<<<') >= 0, 'C9 冲突视图给的是工作区原文，不是自己拼的')
  const noView = await rig.check.handleConflictRead({ cwd: mergeDir, op: 'conflict-view', path: 'b.txt' })
  check(noView && noView.ok === false && reasonOf(noView) === 'path-not-conflicted', 'C10 查一个没冲突的文件被拒（实得 ' + JSON.stringify(reasonOf(noView)) + '）')
  const blockedMark = await rig.check.handleConflictCheck({ cwd: mergeDir, op: 'mark-resolved', payload: { path: 'a.txt' } })
  check(blockedMark && blockedMark.ok === false && reasonOf(blockedMark) === 'conflict-markers', 'C11 带残留标记的文件不许标已解决（实得 ' + JSON.stringify(reasonOf(blockedMark)) + '）')
  const saveBad = await rig.check.handleConflictCheck({ cwd: mergeDir, op: 'save-file', payload: { path: 'a.txt', text: '<<<<<<< HEAD\n' } })
  check(saveBad && saveBad.ok === false && reasonOf(saveBad) === 'conflict-markers' && fieldOf(saveBad, 'line') === 1, 'C12 整份保存前先扫残留标记并给行号（实得 ' + JSON.stringify(saveBad && reasonOf(saveBad)) + '）')
  const saveOk = await rig.check.handleConflictCheck({ cwd: mergeDir, op: 'save-file', payload: { path: 'a.txt', text: 'resolved\n' } })
  check(saveOk && saveOk.ok === true && saveOk.ticket, 'C13 干净文本可预检签票')
  const saveOut = await rig.write.handleConflictWrite({ cwd: mergeDir, op: 'save-file', ticketId: saveOk.ticket.id, requestId: 'sf-1', text: 'resolved\n' })
  check(saveOut && saveOut.ok === true && saveOut.saved === true && saveOut.markerClean === true, 'C14 整份保存写进工作区且写后复查无残留标记（实得 ' + JSON.stringify(saveOut && saveOut.error) + '）')
  eq(fs.readFileSync(path.join(mergeDir, 'a.txt'), 'utf8'), 'resolved\n', 'C15 保存后的文件内容就是面板提交的那份文本')
  const saveAgain = await rig.check.handleConflictCheck({ cwd: mergeDir, op: 'save-file', payload: { path: 'a.txt', text: 'resolved2\n' } })
  const saveDrift = await rig.write.handleConflictWrite({ cwd: mergeDir, op: 'save-file', ticketId: saveAgain.ticket.id, requestId: 'sf-2', text: 'tampered\n' })
  check(saveDrift && saveDrift.ok === false && String(saveDrift.reason || (saveDrift.error && saveDrift.error.reason)) === 'target-changed', 'C16 保存的文本与预检摘要不符时零写入（实得 ' + JSON.stringify(saveDrift && (saveDrift.error || saveDrift.reason)) + '）')
  eq(fs.readFileSync(path.join(mergeDir, 'a.txt'), 'utf8'), 'resolved\n', 'C17 摘要不符那一次没有动文件')
  const markOk = await rig.check.handleConflictCheck({ cwd: mergeDir, op: 'mark-resolved', payload: { path: 'a.txt' } })
  check(markOk && markOk.ok === true, 'C18 标记已解决可预检（实得 ' + JSON.stringify(markOk && markOk.error) + '）')
  const markOut = await rig.write.handleConflictWrite({ cwd: mergeDir, op: 'mark-resolved', ticketId: markOk.ticket.id, requestId: 'mk-1' })
  check(markOut && markOut.ok === true, 'C19 标记已解决执行成功（实得 ' + JSON.stringify(markOut && markOut.error) + '）')
  const stagedStage = String(gitMust(mergeDir, ['ls-files', '--stage', '--', 'a.txt'])).trim()
  check(stagedStage !== '' && stagedStage.indexOf(' 0\t') >= 0, 'C20 标记已解决后索引只剩阶段 0（实得 ' + JSON.stringify(stagedStage) + '）')
  const contCheck = await rig.check.handleConflictCheck({ cwd: mergeDir, op: 'op-continue' })
  check(contCheck && contCheck.ok === true && contCheck.confirmRequired !== true, 'C21 冲突解完可继续合并（非危险动作不要确认卡；实得 ' + JSON.stringify(contCheck && contCheck.error) + '）')
  const contOut = await rig.write.handleConflictWrite({ cwd: mergeDir, op: 'op-continue', ticketId: contCheck.ticket.id, requestId: 'ct-1' })
  check(contOut && contOut.ok === true, 'C22 继续合并执行成功（实得 ' + JSON.stringify(contOut && contOut.error) + '）')
  check(fs.existsSync(path.join(mergeDir, '.git', 'MERGE_HEAD')) === false, 'C23 继续之后 MERGE_HEAD 清掉，合并真的结束了')
  eq(String(gitMust(mergeDir, ['log', '-1', '--format=%P'])).trim().split(/\s+/).length, 2, 'C24 继续之后的提交有两个父提交')

  const abortDir = mergeConflictRepo('abort')
  const abortRig = makeRig()
  const headBefore = String(gitMust(abortDir, ['rev-parse', 'HEAD'])).trim()
  const abortCheck = await abortRig.check.handleConflictCheck({ cwd: abortDir, op: 'op-abort' })
  check(abortCheck && abortCheck.ok === true && abortCheck.confirmRequired === true, 'C25 中止合并要确认卡（危险动作）')
  const abortNo = await abortRig.write.handleConflictWrite({ cwd: abortDir, op: 'op-abort', ticketId: abortCheck.ticket.id, requestId: 'ab-0' })
  check(abortNo && abortNo.ok === false && abortNo.error.kind === 'need-confirm', 'C26 没确认的凭证执行被拒（实得 ' + JSON.stringify(abortNo && abortNo.error) + '）')
  const abortOut = await abortRig.write.handleConflictWrite({ cwd: abortDir, op: 'op-abort', ticketId: abortCheck.ticket.id, requestId: 'ab-1', confirmed: true })
  check(abortOut && abortOut.ok === true, 'C27 确认后中止执行成功（实得 ' + JSON.stringify(abortOut && abortOut.error) + '）')
  check(fs.existsSync(path.join(abortDir, '.git', 'MERGE_HEAD')) === false, 'C28 中止后 MERGE_HEAD 清掉')
  eq(String(gitMust(abortDir, ['rev-parse', 'HEAD'])).trim(), headBefore, 'C29 中止后 HEAD 回到预检时那个提交')

  const oursDir = mergeConflictRepo('ours')
  const oursRig = makeRig()
  const takeCheck = await oursRig.check.handleConflictCheck({ cwd: oursDir, op: 'take-side', payload: { path: 'a.txt', side: 'theirs' } })
  check(takeCheck && takeCheck.ok === true, 'C30 整文件选对方边可预检（实得 ' + JSON.stringify(takeCheck && takeCheck.error) + '）')
  const takeOut = await oursRig.write.handleConflictWrite({ cwd: oursDir, op: 'take-side', ticketId: takeCheck.ticket.id, requestId: 'tk-1' })
  check(takeOut && takeOut.ok === true, 'C31 整文件选边执行成功（实得 ' + JSON.stringify(takeOut && takeOut.error) + '）')
  eq(fs.readFileSync(path.join(oursDir, 'a.txt'), 'utf8'), 'theirs\n', 'C32 选对方边后工作区是对方版本')
  check(String(gitMust(oursDir, ['ls-files', '--stage', '--', 'a.txt'])).indexOf(' 0\t') >= 0, 'C33 选边之后索引登记成阶段 0')

  const delDir = deleteTheirsRepo('del')
  const delRig = makeRig()
  const delTheirs = await delRig.check.handleConflictCheck({ cwd: delDir, op: 'take-side', payload: { path: 'c.txt', side: 'theirs' } })
  check(delTheirs && delTheirs.ok === false && reasonOf(delTheirs) === 'side-missing', 'C34 对方已删的文件不能选「对方边」（实得 ' + JSON.stringify(reasonOf(delTheirs)) + '）')
  const delCheck = await delRig.check.handleConflictCheck({ cwd: delDir, op: 'take-side', payload: { path: 'c.txt', side: 'delete' } })
  check(delCheck && delCheck.ok === true, 'C35 改/删冲突可预检「保留删除」（实得 ' + JSON.stringify(delCheck && delCheck.error) + '）')
  const delOut = await delRig.write.handleConflictWrite({ cwd: delDir, op: 'take-side', ticketId: delCheck.ticket.id, requestId: 'del-1' })
  check(delOut && delOut.ok === true, 'C36 保留删除执行成功（实得 ' + JSON.stringify(delOut && delOut.error) + '）')
  eq(String(gitMust(delDir, ['ls-files', '--stage', '--', 'c.txt'])).trim(), '', 'C37 保留删除后索引里没有这个文件')
  check(fs.existsSync(path.join(delDir, 'c.txt')) === false, 'C38 保留删除后工作区也没有这个文件')

  const renameDir = renameConflictRepo('rename')
  const renameRig = makeRig()
  const rn = await renameRig.check.handleConflictRead({ cwd: renameDir, op: 'conflict-list' })
  check(rn && rn.conflictCount === 3, 'C39 改名冲突的清单是三条未合并条目（实得 ' + (rn && rn.conflictCount) + '）')
  eq((rn && rn.conflicts ? rn.conflicts.map(function (x) { return x.kind }) : []).sort(), ['both-deleted', 'renamed', 'renamed'], 'C40 改名冲突按「只剩单边阶段」认出来')

  const binDir = binaryConflictRepo('binary')
  const binRig = makeRig()
  const binList = await binRig.check.handleConflictRead({ cwd: binDir, op: 'conflict-list' })
  check(binList && binList.conflicts && binList.conflicts[0].textKind === 'binary', 'C41 二进制冲突按二进制处理，不给逐块')
  const binView = await binRig.check.handleConflictRead({ cwd: binDir, op: 'conflict-view', path: 'bin.dat' })
  check(binView && binView.ok === true && binView.kind === 'binary' && binView.hunks === null && binView.text === null, 'C42 二进制冲突视图只回整份、不回冲突块')

  const markerDir = markerRepo('marker')
  const markerRig = makeRig()
  const mc1 = await markerRig.check.handleConflictRead({ cwd: markerDir, op: 'marker-check' })
  check(mc1 && mc1.ok === true && mc1.clean === false && mc1.worktree.length === 3 && mc1.staged.length === 0, 'C43 6.15 工作区半查得出残留标记三行（实得 ' + JSON.stringify(mc1) + '）')
  gitMust(markerDir, ['add', '--', 'd.txt'])
  const mc2 = await markerRig.check.handleConflictRead({ cwd: markerDir, op: 'marker-check' })
  check(mc2 && mc2.ok === true && mc2.worktree.length === 0 && mc2.staged.length === 3, 'C44 6.15 已暂存半查得出残留标记（只查工作区会漏掉这一半）')

  const previewDir = previewRepo('preview')
  const previewRig = makeRig()
  const preview = await previewRig.check.handleConflictRead({ cwd: previewDir, op: 'merge-preview', target: 'other' })
  check(preview && preview.ok === true && preview.clean === false, 'C45 6.10 预演给出「会冲突」而不是命令失败（实得 ' + JSON.stringify(preview && preview.error) + '）')
  eq(preview && preview.paths, ['a.txt'], 'C46 6.10 预演点出会冲突的路径')
  eq(fs.readFileSync(path.join(previewDir, 'a.txt'), 'utf8'), 'ours\n', 'C47 6.10 预演之后工作区仍是当前边内容（预演不动工作区）')
  const rrView = await previewRig.check.handleConflictRead({ cwd: previewDir, op: 'rerere-view' })
  check(rrView && rrView.ok === true && rrView.enabled === false && rrView.paths.length === 0, 'C48 6.14 rerere 未启用时如实说不启用（不假装有解法）')

  const mergeRunDir = previewRepo('merge-run')
  const mergeRunRig = makeRig()
  const mCheck = await mergeRunRig.check.handleConflictCheck({ cwd: mergeRunDir, op: 'merge', payload: { target: 'other' } })
  check(mCheck && mCheck.ok === true, 'C49 合并预检签票成功（实得 ' + JSON.stringify(mCheck && mCheck.error) + '）')
  const mOut = await mergeRunRig.write.handleConflictWrite({ cwd: mergeRunDir, op: 'merge', ticketId: mCheck.ticket.id, requestId: 'mg-1' })
  check(mOut && mOut.ok === true && mOut.conflicted === true, 'C50 合并撞上冲突不算执行失败，回包里明说有冲突（实得 ' + JSON.stringify(mOut && (mOut.error || mOut.conflicted)) + '）')
  eq(mOut && mOut.state, 'merge', 'C51 冲突出现在回包里，界面可以立刻切到冲突视图')
  const missingTarget = await mergeRunRig.check.handleConflictCheck({ cwd: mergeRunDir, op: 'merge', payload: { target: 'nope' } })
  check(missingTarget && missingTarget.ok === false && reasonOf(missingTarget) === 'operation-in-progress', 'C52 合并进行中再点合并被状态机拦住（实得 ' + JSON.stringify(reasonOf(missingTarget)) + '）')

  const ttlDir = mergeConflictRepo('ttl')
  const ttlRig = makeRig()
  const ttlCheck = await ttlRig.check.handleConflictCheck({ cwd: ttlDir, op: 'take-side', payload: { path: 'a.txt', side: 'ours' } })
  ttlRig.clock.t += 130000
  const ttlOut = await ttlRig.write.handleConflictWrite({ cwd: ttlDir, op: 'take-side', ticketId: ttlCheck.ticket.id, requestId: 'ttl-1' })
  check(ttlOut && ttlOut.ok === false && ttlOut.error.reason === 'ticket-expired', 'C53 过了 120 秒票据时限就拒（实得 ' + JSON.stringify(ttlOut && ttlOut.error) + '）')

  const staleDir = mergeConflictRepo('stale')
  const staleRig = makeRig()
  const staleCheck = await staleRig.check.handleConflictCheck({ cwd: staleDir, op: 'take-side', payload: { path: 'a.txt', side: 'ours' } })
  gitMust(staleDir, ['add', '--', 'a.txt'])
  const staleOut = await staleRig.write.handleConflictWrite({ cwd: staleDir, op: 'take-side', ticketId: staleCheck.ticket.id, requestId: 'st-1' })
  check(staleOut && staleOut.ok === false && String(staleOut.reason || (staleOut.error && staleOut.error.reason)) === 'target-changed', 'C54 预检之后现场变了就零进程拒绝（实得 ' + JSON.stringify(staleOut && (staleOut.error || staleOut.reason)) + '）')

  // ———— D 组：凭票执行的拒绝栈（全假依赖；每条拒绝都必须零进程、零预检重算） ————
  const fakeClock = { t: 1700000000000 }
  function fakeFailPhone(kind, message, extra) {
    return Object.assign({ ok: false, error: { kind: kind, message: message } }, extra || {})
  }
  function fakeTicket(id, op, over) {
    const o = over || {}
    const ticket = ticketMod.makeTicket({ id: id, op: op, nowMs: (o.nowMs !== undefined) ? o.nowMs : fakeClock.t, headOid: 'abc123', indexFingerprint: null, indexEntries: null, target: null, repoRoot: 'C:/repo', changes: null, bindings: ticketMod.makeBindings(o.bindings || {}) })
    ticket.plan = o.plan || { op: op, state: 'merge', target: 'other', path: 'a.txt', side: 'ours', textDigest: null, oldDigest: null }
    ticket.confirmRequired = o.confirmRequired === true
    ticket.decision = { verdict: 'allow', reasons: ['ok'] }
    return ticket
  }
  function makeWriteRig() {
    const calls = { measure: 0, run: 0, scene: 0 }
    const tickets = new Map()
    const results = new Map()
    const emptyBindings = ticketMod.makeBindings({})
    const scene = {
      sceneOf: async function () { calls.scene += 1; return { ok: true, state: 'merge', conflictCount: 1, conflicts: [], headOid: 'abc123' } },
      digest16: digest16,
      readTextFile: async function () { return { ok: false, reason: 'missing' } },
      writeTextFile: async function () { return { ok: true } },
      markerCheckPathOf: async function () { return { ok: true, clean: true, markers: [] } },
    }
    const write = writeMod.createConflictWrite({
      failPhone: fakeFailPhone,
      runPinned: async function () { calls.run += 1; return { kind: 'ok', exitCode: 0, stdout: '', stderr: '', truncated: false } },
      resolveGitExecutable: async function () { return 'git' },
      measure: async function () { calls.measure += 1; return { ok: true, repoRoot: 'C:/repo', headOid: 'abc123', state: 'merge', conflictCount: 1, bindings: emptyBindings, scene: {} } },
      scene: scene,
      now: function () { return fakeClock.t },
      tickets: tickets,
      results: results,
    })
    return { write: write, tickets: tickets, results: results, calls: calls }
  }
  const dRig = makeWriteRig()
  const dMissing = await dRig.write.handleConflictWrite({ cwd: 'C:/repo', op: 'merge', ticketId: 'T-no-such-ticket', requestId: 'd-missing' })
  check(dMissing && dMissing.ok === false && reasonOf(dMissing) === 'ticket-missing' && dRig.calls.measure === 0 && dRig.calls.run === 0, 'D1 票不存在零进程拒绝（实得 ' + JSON.stringify(reasonOf(dMissing)) + '）')
  const dRid = await dRig.write.handleConflictWrite({ cwd: 'C:/repo', op: 'merge', ticketId: 'T-rid', requestId: 'bad id!' })
  check(dRid && dRid.ok === false && reasonOf(dRid) === 'bad-target' && dRig.calls.measure === 0 && dRig.calls.run === 0, 'D2 requestId 形状不合法当场拒（实得 ' + JSON.stringify(reasonOf(dRid)) + '）')
  dRig.tickets.set('T-op', fakeTicket('T-op', 'merge'))
  const dOpMismatch = await dRig.write.handleConflictWrite({ cwd: 'C:/repo', op: 'op-abort', ticketId: 'T-op', requestId: 'd-op' })
  check(dOpMismatch && dOpMismatch.ok === false && reasonOf(dOpMismatch) === 'ticket-op-mismatch' && dRig.calls.measure === 0 && dRig.calls.run === 0, 'D3 票不是为这个动作签的零进程拒绝（实得 ' + JSON.stringify(reasonOf(dOpMismatch)) + '）')
  dRig.tickets.set('T-confirm', fakeTicket('T-confirm', 'op-skip', { confirmRequired: true }))
  const dNeedConfirm = await dRig.write.handleConflictWrite({ cwd: 'C:/repo', op: 'op-skip', ticketId: 'T-confirm', requestId: 'd-confirm' })
  check(dNeedConfirm && dNeedConfirm.ok === false && reasonOf(dNeedConfirm) === 'need-confirm' && dRig.calls.measure === 0 && dRig.calls.run === 0, 'D4 危险动作没带确认当场拒（实得 ' + JSON.stringify(reasonOf(dNeedConfirm)) + '）')
  dRig.tickets.set('T-expired', fakeTicket('T-expired', 'op-abort', { confirmRequired: true, nowMs: fakeClock.t - 130000 }))
  const dExpired = await dRig.write.handleConflictWrite({ cwd: 'C:/repo', op: 'op-abort', ticketId: 'T-expired', requestId: 'd-expired', confirmed: true })
  check(dExpired && dExpired.ok === false && reasonOf(dExpired) === 'ticket-expired' && dRig.calls.measure === 0 && dRig.calls.run === 0, 'D5 过了 120 秒票据时限零进程拒绝（实得 ' + JSON.stringify(reasonOf(dExpired)) + '）')
  dRig.tickets.set('T-bogus', fakeTicket('T-bogus', 'bogus-op'))
  const dBogus = await dRig.write.handleConflictWrite({ cwd: 'C:/repo', op: 'bogus-op', ticketId: 'T-bogus', requestId: 'd-bogus' })
  check(dBogus && dBogus.ok === false && reasonOf(dBogus) === 'bad-target' && dRig.calls.measure === 0 && dRig.calls.run === 0, 'D6 动作不在白名单里零进程拒绝（实得 ' + JSON.stringify(reasonOf(dBogus)) + '）')
  dRig.tickets.set('T-replay', fakeTicket('T-replay', 'op-continue'))
  const dFirst = await dRig.write.handleConflictWrite({ cwd: 'C:/repo', op: 'op-continue', ticketId: 'T-replay', requestId: 'd-replay' })
  const dRunAfterFirst = dRig.calls.run
  const dSecond = await dRig.write.handleConflictWrite({ cwd: 'C:/repo', op: 'op-continue', ticketId: 'T-replay', requestId: 'd-replay' })
  check(dFirst && dFirst.ok === true && dRunAfterFirst === 1, 'D7 第一次执行真的跑了一条命令（实得跑 ' + dRunAfterFirst + ' 条）')
  check(dSecond && dSecond.reused === true && dSecond.ok === true && dRig.calls.run === dRunAfterFirst, 'D8 同一个 requestId 重放不重复执行（跑命令次数 ' + dRunAfterFirst + ' → ' + dRig.calls.run + '）')

  // ———— E 组：七个登记点、理由词条、能力账本对账与「写层不自起进程」 ————
  const ledger = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/capability-ledger.js')).href)
  const opsSrc = sourceText('src/shared/version-control/src/conflict-ops.ts')
  const sceneSrc = sourceText('src/host/versionControlConflictScene.ts')
  const checkSrc = sourceText('src/host/versionControlConflictCheck.ts')
  const writeSrc = sourceText('src/host/versionControlConflictWrite.ts')
  const mountSrc = sourceText('src/host/versionControlConflictMount.ts')
  const hostSrc = sourceText('src/host/versionControl.ts')
  const indexSrc = sourceText('src/host/index.ts')
  const timeoutsYaml = sourceText('config/timeouts.yaml')
  const timeGen = sourceText('scripts/generate-time-config.mts')
  const timeGate = sourceText('tests/verify-time-config.ts')
  const reasonSrc = sourceText('src/shared/version-control/src/write-reasons.ts')
  const writeReasonsMod = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/write-reasons.js')).href)
  const settingsGate = sourceText('tests/verify-settings-phones.ts')
  function countOf(text, needle) { return String(text).split(needle).length - 1 }
  eq(shared.CONFLICT_PHONES, { check: 'wf.gitConflictCheck', write: 'wf.gitConflictWrite' }, 'E1 客户端电话表登记两条冲突向导电话')
  check(countOf(mountSrc, "loggedPhone('wf.gitConflictCheck'") === 1 && countOf(mountSrc, "loggedPhone('wf.gitConflictWrite'") === 1, 'E2 装配壳把预检与执行各包一层 host.call 日志')
  has(mountSrc, 'createConflictMount', 'E3 装配壳导出 createConflictMount')
  check(countOf(hostSrc, 'createConflictMount(') === 1 && countOf(hostSrc, 'handleGitConflicts:') === 1 && countOf(hostSrc, 'handleGitConflictCheck:') === 1 && countOf(hostSrc, 'handleGitConflictWrite:') === 1, 'E4 父层装配冲突向导三条电话并接出票表')
  check(countOf(indexSrc, "'wf.gitConflicts'") === 1 && countOf(indexSrc, "'wf.gitConflictCheck'") === 1 && countOf(indexSrc, "'wf.gitConflictWrite'") === 1, 'E5 宿主入口注册三条电话各一次')
  check(indexSrc.indexOf('h.handleGitConflicts(args)') >= 0 && indexSrc.indexOf('h.handleGitConflictCheck(args)') >= 0 && indexSrc.indexOf('h.handleGitConflictWrite(args)') >= 0, 'E6 宿主入口三条注册转调父层对应方法')
  has(timeoutsYaml, 'vcConflictReadTimeoutMs: 15000', 'E7 超时配置登记冲突向导读时限')
  has(timeoutsYaml, 'vcConflictWriteTimeoutMs: 15000', 'E8 超时配置登记冲突向导写时限')
  has(timeGen, "['vcConflictReadTimeoutMs', 'VC_CONFLICT_READ_TIMEOUT_MS'", 'E9 时间常量生成器登记读时限键')
  has(timeGen, "['vcConflictWriteTimeoutMs', 'VC_CONFLICT_WRITE_TIMEOUT_MS'", 'E10 时间常量生成器登记写时限键')
  has(timeGate, "access: 'VC_CONFLICT_READ_TIMEOUT_MS'", 'E11 时间配置门禁登记读数叶子用的常量')
  has(timeGate, "access: 'VC_CONFLICT_WRITE_TIMEOUT_MS'", 'E12 时间配置门禁登记执行叶子用的常量')
  has(sceneSrc, 'VC_CONFLICT_READ_TIMEOUT_MS', 'E13 读数叶子真的从时间常量取超时')
  has(writeSrc, 'VC_CONFLICT_WRITE_TIMEOUT_MS', 'E14 执行叶子真的从时间常量取超时')
  const writeIds = ['merge', 'merge-ff-only', 'merge-no-ff', 'merge-squash', 'take-side', 'save-file', 'mark-resolved', 'op-continue', 'op-skip', 'op-abort']
  const missingInCheck = writeIds.filter(function (id) { return countOf(checkSrc, "'" + id + "'") < 1 })
  eq(missingInCheck, [], 'E15 预检判定分支覆盖十条写动作（缺一条就会永远落 unknown）')
  const missingInWrite = writeIds.filter(function (id) { return countOf(writeSrc, "'" + id + "'") < 1 })
  eq(missingInWrite, ['op-abort'], 'E16 执行叶子按动作拼 argv：只有中止走兜底分支（其余九个都点名）')
  const readIds = ['conflict-list', 'conflict-view', 'merge-preview', 'rerere-view']
  const missingRead = readIds.filter(function (id) { return countOf(checkSrc, "'" + id + "'") < 1 })
  eq(missingRead, [], 'E17 只读四类分发都在预检叶子里（第 5 类标记检查走兜底分支）')
  has(checkSrc, 'scene.markerCheckOf(', 'E18 6.15 标记检查接在预检叶子上')
  has(checkSrc, 'CONFLICT_CHECK_CONTRACT', 'E19 预检回包带契约名（界面据此判版本）')
  has(opsSrc, 'CONFLICT_CHECK_VERSION', 'E20 协议层声明契约版本')
  has(writeSrc, 'gitEditor', 'E21 继续操作把编辑器换成必定成功的 true（第 7 节：其余动作保持必失败编辑器）')
  const reasonIds = ['conflict-markers', 'path-not-conflicted', 'side-missing', 'binary-file', 'target-missing', 'version-unsupported', 'text-too-large', 'wrong-operation', 'no-operation', 'unmerged-files', 'bad-side', 'fast-forward-impossible']
  const missingReason = reasonIds.filter(function (id) { return reasonSrc.indexOf("'" + id + "'") < 0 })
  eq(missingReason, [], 'E22 十二种新理由都进了理由表')
  const hintless = reasonIds.filter(function (id) { const hint = writeReasonsMod.writeHintFor(id); return typeof hint !== 'string' || hint === '' })
  eq(hintless, [], 'E23 每种新理由都有给人看的一句话（失败话术同源，不各写一套）')
  const conflictCaps = ledger.CAPABILITIES.filter(function (c) { return c.page === 'conflicts' })
  eq(conflictCaps.map(function (c) { return c.id }).sort(), writeIds.concat(readIds.concat(['marker-check'])).map(function (id) { return shared.conflictOpMetaOf(id).capId }).sort(), 'E24 能力账本域 6 的十五条与动作表逐条对上')
  check(conflictCaps.length === 15 && conflictCaps.every(function (c) { return c.primaryEntry === '冲突向导' }), 'E25 域 6 十五条的主入口都是冲突向导（实得 ' + conflictCaps.length + ' 条）')
  function conflictGap(caps) {
    const have = caps.map(function (c) { return c.id })
    return shared.CONFLICT_OPS.map(function (o) { return o.capId }).filter(function (id) { return have.indexOf(id) < 0 })
  }
  eq(conflictGap(conflictCaps), [], 'E26 账本与动作表对账零缺口')
  const factBite = conflictGap(conflictCaps.filter(function (c) { return c.id !== '6.8' }))
  eq(factBite, ['6.8'], 'E27 反证：账本里少一条对账必须立刻点名（实得 ' + JSON.stringify(factBite) + '）')
  const ttlTicket = fakeTicket('T-ttl', 'merge')
  eq(ttlTicket.expiresAtMs - ttlTicket.checkedAtMs, 120000, 'E28 票据时限仍是 120 秒（只管预检新鲜度）')
  const leafSources = { scene: sceneSrc, check: checkSrc, write: writeSrc, mount: mountSrc }
  const selfSpawn = Object.keys(leafSources).filter(function (k) { return /child_process|\.spawn\(/.test(leafSources[k]) })
  eq(selfSpawn, [], 'E29 写层与装配壳都不自己起进程（全走父层注入的 runPinned）')
  has(settingsGate, 'nPhones === 85', 'E30 宿主电话总数登记为八十五条（三条冲突向导电话已计入）')
  const writeTag = ['ticket-missing', 'ticket-op-mismatch', 'ticket-expired', 'need-confirm', 'stale-repo', 'target-changed', 'conflict-markers', 'bad-text', 'unknown-write-failure']
  const missingTag = writeTag.filter(function (id) { return writeSrc.indexOf("'" + id + "'") < 0 })
  eq(missingTag, [], 'E31 执行叶子按固定理由标识符拒绝（界面照同一套话术画）')


  // ———— F 组：客户端侧（动作模型、页面渲染、词条、登记点） ————
  // 客户端叶子不能 import 共享层（界面闭包），所以这份动作名单与页面都是「读源码求值」，
  //   对账对象是 A 组已经加载过的共享协议；任何一条登记不上或渲染不出来都判红。
  console.log('F 客户端冲突向导（#1747）')
  function fakeH(tag, props, kids) {
    const children = []
    const push = function (k) {
      if (k === undefined || k === null || k === false || k === true) return
      if (Array.isArray(k)) { k.forEach(push); return }
      children.push(k)
    }
    push(kids)
    return { tag: tag, props: props || {}, children: children }
  }
  function fakeT(key, params) { return params ? 'T:' + key + ':' + JSON.stringify(params) : 'T:' + key }
  function findAll(node, pred, acc) {
    const out = acc || []
    if (!node || typeof node !== 'object') return out
    if (Array.isArray(node)) { node.forEach(function (n) { findAll(n, pred, out) }); return out }
    if (pred(node)) out.push(node)
    ;(node.children || []).forEach(function (n) { findAll(n, pred, out) })
    return out
  }
  function textOf(node) {
    if (node === undefined || node === null || node === false || node === true) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (node.props && node.props['data-vc-conflicts-files-empty'] === '1') return textOf(node.children)
    return textOf(node.children)
  }
  const opsLeaf = await import(pathToFileURL(path.join(ROOT, 'src/client/views/versionControl/vcConflictsOps.js')).href)
  const pickNames = ['VC_CONFLICTS_PHONES', 'VC_CONFLICTS_OPS', 'VC_CONFLICTS_STATES', 'VC_CONFLICTS_KINDS', 'VC_CONFLICTS_OPS_SOURCE',
    'vcConflictsOpMetaOf', 'vcConflictsOpLabelKeyOf', 'vcConflictsOpVerbKeyOf', 'vcConflictsStateLabelKeyOf', 'vcConflictsKindLabelKeyOf',
    'vcConflictsSideLabelKeyOf', 'vcConflictsRequestIdOf', 'vcConflictsVisibleOf', 'vcConflictsPayloadOf', 'vcConflictsCheckArgsOf',
    'vcConflictsWriteArgsOf', 'vcConflictsTargetOf', 'vcConflictsListOf', 'vcConflictsChoicesOf', 'vcConflictsRowNode', 'vcConflictsPageNode']
  const leafBody = spliceableJs('src/client/views/versionControl/vcConflictsOps.ts') + '\n' +
    spliceableJs('src/client/views/versionControl/vcConflictsPage.ts') + '\nreturn { ' + pickNames.join(', ') + ' }'
  const leaf = compileFn(['h', 't', 'vcWriteErrFamilyOf', 'splitConflictHunks', 'applyConflictChoices'], leafBody)(
    fakeH, fakeT, function (reason) { return String(reason) }, textMod.splitConflictHunks, textMod.applyConflictChoices)
  const sharedByCap = {}
  shared.CONFLICT_OPS.forEach(function (o) { sharedByCap[o.capId] = o })
  const opsMismatch = leaf.VC_CONFLICTS_OPS.filter(function (o) {
    const s = sharedByCap[o.capId]
    if (!s) return true
    return s.id !== o.op || (s.kind === 'write') !== (o.write === true) || (s.dangerous === true) !== (o.dangerous === true) || (s.confirm === true) !== (o.confirm === true)
  })
  eq(opsMismatch, [], 'F1 客户端 15 条动作与共享协议逐条对账零缺口（动作名、读写、危险、确认）')
  eq(leaf.VC_CONFLICTS_PHONES, { read: 'wf.gitConflicts', check: 'wf.gitConflictCheck', write: 'wf.gitConflictWrite' }, 'F2 电话表三条与宿主注册的名字一致（界面只拨这三个名字）')
  eq(leaf.VC_CONFLICTS_STATES, shared.CONFLICT_STATES, 'F3 四种进行中状态与共享层同一份口径')
  check(leaf.VC_CONFLICTS_KINDS.length === 8 && leaf.VC_CONFLICTS_KINDS.indexOf('binary') >= 0 && leaf.VC_CONFLICTS_KINDS.indexOf('submodule') >= 0 && leaf.VC_CONFLICTS_KINDS.indexOf('mode') >= 0, 'F4 冲突文件八类分类齐全（含二进制、子模组、模式）')
  eq(leaf.vcConflictsVisibleOf('').filter(function (op) { return ['op-continue', 'op-skip', 'op-abort'].indexOf(op) >= 0 }), [], 'F5 没有进行中操作时不出现继续/跳过/中止（不是灰着）')
  eq(leaf.vcConflictsVisibleOf('merge').indexOf('op-skip'), -1, 'F6 合并中不给「跳过这一步」（git 的合并没有 skip 这一步）')
  eq(leaf.vcConflictsVisibleOf('rebase').length, 15, 'F7 变基中十五条全在（继续、跳过、中止都可点）')
  eq(leaf.vcConflictsPayloadOf('merge', { target: 'side' }), { target: 'side' }, 'F8 合并的载荷只给目标分支')
  eq(leaf.vcConflictsPayloadOf('take-side', { path: 'a.txt' }), { path: 'a.txt', side: 'ours' }, 'F9 选边默认当前边，路径与边各自一格')
  eq(leaf.vcConflictsPayloadOf('save-file', { path: 'a.txt', text: 'x' }), { path: 'a.txt', text: 'x' }, 'F10 整份保存的载荷带路径与全文')
  const checkArgs = leaf.vcConflictsCheckArgsOf('C:/repo', 'merge', { target: 'side' })
  eq([checkArgs.cwd, checkArgs.op, checkArgs.target], ['C:/repo', 'merge', 'side'], 'F11 预检参数是 cwd+动作+载荷，字段名与宿主读的一致')
  const writeArgs = leaf.vcConflictsWriteArgsOf('C:/repo', 'op-continue', {}, 't1', 'r1')
  check(writeArgs.ticketId === 't1' && writeArgs.requestId === 'r1' && writeArgs.confirmed === true, 'F12 执行参数带票号、请求号与显式确认')
  const rid = leaf.vcConflictsRequestIdOf(1700000000000, 'a b!c')
  check(/^[A-Za-z0-9_-]+$/.test(rid) && rid.length <= 64 && leaf.vcConflictsRequestIdOf(1700000000001, 'a b!c') !== rid, 'F13 请求号形状合规且每次不同（重放靠它换回上一次结果）')
  // 词条：真源 yaml 里 93 个键，中英两份同键；页面上出现的每个静态键都必须在这份词表里。
  const yamlText = fs.readFileSync(path.join(ROOT, 'config', 'copy', 'vcconflicts.yaml'), 'utf8')
  const enAt = yamlText.indexOf('\nen:')
  const zhPart = yamlText.slice(0, enAt)
  const enPart = yamlText.slice(enAt)
  const keysOf = function (part) { return part.split('\n').filter(function (l) { return /^  vc\.conflicts\.[A-Za-z0-9.]+:/.test(l) }).map(function (l) { return l.trim().split(':')[0] }) }
  const zhKeys = keysOf(zhPart)
  const enKeys = keysOf(enPart)
  eq([zhKeys.length, enKeys.length], [93, 93], 'F14 词表 93 个键中英各一份（实得 ' + zhKeys.length + '/' + enKeys.length + '）')
  eq(zhKeys.slice().sort().join(','), enKeys.slice().sort().join(','), 'F15 中英两份的键完全同名（缺一门就生成器报错，这里再守一道）')
  const wantedKeys = leaf.VC_CONFLICTS_OPS.map(function (o) { return leaf.vcConflictsOpLabelKeyOf(o.op) }).concat(leaf.VC_CONFLICTS_OPS.map(function (o) { return leaf.vcConflictsOpVerbKeyOf(o.op) }))
  const missingKeys = wantedKeys.filter(function (k) { return zhKeys.indexOf(k) < 0 })
  eq(missingKeys, [], 'F16 15 条动作的名字与动作说法都在词表里')
  const pageSrc = sourceText('src/client/views/versionControl/vcConflictsPage.ts')
  const opsSrcText = sourceText('src/client/views/versionControl/vcConflictsOps.ts')
  const literalKeys = []
  const keyRe = /t\('([^']+)'/g
  let keyHit = keyRe.exec(pageSrc)
  while (keyHit) { if (keyHit[1].indexOf('vc.writeErr.') !== 0) literalKeys.push(keyHit[1]); keyHit = keyRe.exec(pageSrc) }
  const strayKeys = literalKeys.filter(function (k) { return zhKeys.indexOf(k) < 0 })
  eq(strayKeys, [], 'F17 页面里出现的每个静态词条键都在词表里（实得 ' + literalKeys.length + ' 个）')
  const stripComments = function (s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '') }
  const cjk = /[\u4e00-\u9fa5]/.test(stripComments(pageSrc)) || /[\u4e00-\u9fa5]/.test(stripComments(opsSrcText))
  check(cjk === false, 'F18 两片叶子的代码里没有中文字面量（可见文字全走词条，注释不算）')
  // 渲染：进行中状态与冲突清单都从 opts.conflicts 进来；暂停/跳过/中止按状态出现。
  const makeConflicts = function (over) {
    const base = { state: 'merge', reads: {}, rows: {}, values: { target: 'side', path: 'a.txt', side: 'ours' }, handlers: {} }
    return Object.assign(base, over || {})
  }
  const listRead = { ok: true, conflictCount: 2, conflicts: [
    { path: 'a.txt', kind: 'both-changed', textKind: 'text', sides: { ours: true, theirs: true, delete: false } },
    { path: 'c.txt', kind: 'deleted-by-theirs', textKind: 'text', sides: { ours: true, theirs: false, delete: true } },
  ] }
  const page = leaf.vcConflictsPageNode(fakeH, fakeT, { conflicts: makeConflicts({ reads: { 'conflict-list': listRead } }) })
  check(page.tag === 'section' && page.props['data-vc-conflicts-page'] === '1' && page.props['data-vc-conflicts-count'] === '15', 'F19 页面体是一块区域，带 15 条能力的总数标记')
  const rows = findAll(page, function (n) { return !!n.props['data-vc-conflicts-row'] })
  eq(rows.length, 14, 'F20 合并中画 14 行（15 条里跳过这一步不出现）')
  eq(rows.map(function (r) { return r.props['data-vc-conflicts-row'] }).sort(), ['6.1', '6.10', '6.11', '6.13', '6.14', '6.15', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.8', '6.9'], 'F21 画出来的正是那 14 条能力号')
  const noState = leaf.vcConflictsPageNode(fakeH, fakeT, { conflicts: makeConflicts({ state: null }) })
  const noStateRows = findAll(noState, function (n) { return !!n.props['data-vc-conflicts-row'] })
  eq(noStateRows.map(function (r) { return r.props['data-vc-conflicts-row'] }).filter(function (id) { return ['6.11', '6.12', '6.13'].indexOf(id) >= 0 }), [], 'F22 没有进行中操作时继续/跳过/中止三条整行不出现（不是灰着）')
  const fileNodes = findAll(page, function (n) { return !!n.props['data-vc-conflicts-file'] })
  eq(fileNodes.map(function (n) { return n.props['data-vc-conflicts-file-kind'] }), ['both-changed', 'deleted-by-theirs'], 'F23 冲突文件按分类逐条列出（八类标签从词条取）')
  const sideButtons = findAll(page, function (n) { return !!n.props['data-vc-conflicts-file-side'] })
  eq(sideButtons.filter(function (b) { return b.props['data-vc-conflicts-file-path'] === 'c.txt' }).map(function (b) { return b.props['data-vc-conflicts-file-side'] }), ['ours', 'delete'], 'F24 对方删除的文件只给存在的那两条边（对方边不画，不是灰着）')
  const confirmPage = leaf.vcConflictsPageNode(fakeH, fakeT, { conflicts: makeConflicts({ rows: { 'op-abort': { rows: {}, confirm: { ticketId: 't1', requestId: 'r1' } } } }) })
  const confirmNode = findAll(confirmPage, function (n) { return !!n.props['data-vc-conflicts-confirm'] })[0]
  const segs = confirmNode ? findAll(confirmNode, function (n) { return !!n.props['data-vc-conflicts-confirm-seg'] }).map(function (n) { return n.props['data-vc-conflicts-confirm-seg'] }) : []
  eq(segs, ['what', 'wont', 'reversible', 'verb'], 'F25 危险动作的确认卡是固定四段（会动什么/不会动什么/能不能回来/点了执行什么）')
  const markerPage = leaf.vcConflictsPageNode(fakeH, fakeT, { conflicts: makeConflicts({ rows: { 'marker-check': { read: { ok: true, clean: false, worktree: [{}, {}], staged: [] } } } }) })
  const markerNode = findAll(markerPage, function (n) { return n.props['data-vc-conflicts-marker-clean'] !== undefined })[0]
  check(!!markerNode && markerNode.props['data-vc-conflicts-marker-clean'] === '0' && textOf(markerNode).indexOf('T:vc.conflicts.read.markerDirty') >= 0, 'F26 残留标记没清干净时读数画成「脏」并给出两半行数（不报成干净）')
  const failPage = leaf.vcConflictsPageNode(fakeH, fakeT, { conflicts: makeConflicts({ rows: { merge: { result: { ok: false, error: { kind: 'git-failed', reason: 'conflict-markers', message: 'boom' }, values: {} } } } }) })
  const failNode = findAll(failPage, function (n) { return n.props['data-vc-conflicts-result-ok'] === '0' })[0]
  const retryNode = findAll(failPage, function (n) { return !!n.props['data-vc-conflicts-retry'] })[0]
  check(!!failNode && !!retryNode && failNode.props['data-vc-conflicts-result'] === '6.1' && textOf(failNode).indexOf('vc.writeErr.conflict-markers') >= 0, 'F27 失败结果带失败标记、走同源话术，并给「再试一次」按钮')
  // 反证：把 6.14 从动作表里拿掉，对账必须立刻点名这一条。
  const coGap = function (list) { return shared.CONFLICT_OPS.map(function (o) { return o.capId }).filter(function (id) { return list.map(function (o) { return o.capId }).indexOf(id) < 0 }) }
  eq(coGap(leaf.VC_CONFLICTS_OPS.filter(function (o) { return o.capId !== '6.14' })), ['6.14'], 'F28 反证：动作表少一条时对账必须点名（实得 ' + JSON.stringify(coGap(leaf.VC_CONFLICTS_OPS.filter(function (o) { return o.capId !== '6.14' }))) + '）')
  // 登记点：页面壳挂载、构建叶子登记与客户端标记各一处。
  const shellSrc = sourceText('src/client/views/versionControl/vcShellPages.ts')
  has(shellSrc, 'declare function vcConflictsPageNode', 'F29 页面壳声明了冲突页叶子的形状')
  has(shellSrc, "page === 'conflicts'", 'F30 页面壳只在冲突页挂这一块')
  has(shellSrc, 'conflicts: opts.conflicts', 'F31 页面壳把冲突读数与交互态原样传给页面体（不改形状）')
  const buildSrc = sourceText('scripts/build.mts')
  has(buildSrc, "id: 'vcConflictsOps'", 'F32 构建登记了动作模型叶子')
  has(buildSrc, "id: 'vcConflictsPage'", 'F33 构建登记了页面正文叶子')
  has(buildSrc, 'shared:vcConflictText', 'F34 构建把冲突文本共享模块拼进界面闭包')
  const clientIndexSrc = sourceText('src/client/index.ts')
  check((clientIndexSrc.split('leaf:vcConflictsOps').length - 1) === 1 && (clientIndexSrc.split('leaf:vcConflictsPage').length - 1) === 1 && (clientIndexSrc.split('shared:vcConflictText').length - 1) === 1, 'F35 客户端入口三处标记各出现一次（重复或缺失构建都会拒）')
  const localeText = localeDataText()
  const localeMissing = zhKeys.filter(function (k) { return localeText.indexOf("'" + k + "'") < 0 })
  eq(localeMissing, [], 'F36 词表已生成进运行时词条表（缺生成物时这一条会点名）')

  for (let i = 0; i < tmpDirs.length; i += 1) {
    try { fs.rmSync(tmpDirs[i], { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch (e) { console.log('  INFO 临时仓库没删干净（不影响结论）：' + tmpDirs[i]) }
  }

  await printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log('门禁自身抛错：' + ((e && e.stack) || e))
  failed += 1
  printGateResult(GATE, total, failed)
  process.exit(1)
})
