// 门禁归属: src/shared/version-control/src/rewrite-ops.ts
// verify-1586-rewrite —— 规格 #1586 域 5 的 5.11（全库重写与强制备份，#1750 T15）：
// 五张 filter-repo 表单的共享协议、宿主预检与凭票执行、客户端维护页与备份装置。
// 本文件只做观察：读真源码文本、真 import 共享纯模块、在真临时 git 仓库里跑真命令；
// 每一组末尾都不依赖被测代码自证，反证组会故意改坏一份副本并断言对账必然报错。
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const cp = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText, spliceableJs } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.ts')
const { localeDataText } = require('./lib/locale-data.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-rewrite'
let total = 0
let failed = 0
function check(ok, msg) { total += 1; if (!ok) { failed += 1; console.log('  FAIL ' + msg) } }
function eq(actual, expected, msg) { check(actual === expected, msg + '（实测 ' + String(actual) + '，期望 ' + String(expected) + '）') }
function has(haystack, needle, msg) { check(String(haystack).indexOf(needle) >= 0, msg) }
function digest16(text) { return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16) }

function loadModule(rel) { return import(pathToFileURL(path.join(ROOT, rel)).href) }

function stripComments(text) { return String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '') }

async function main() {
  // ---------- A 组：共享协议（五表单、输入守卫、计划、argv 与备份点） ----------
  const ops = await loadModule('src/shared/version-control/src/rewrite-ops.js')
  const rec = await loadModule('src/shared/version-control/src/recovery-point.js')

  eq(ops.REWRITE_FORMS.length, 5, 'A1 五张表单一个不多一个不少')
  eq(ops.REWRITE_FORMS.map(function (f) { return f.id }).join(','), 'remove-paths,rename-paths,rewrite-authors,remove-large,replace-text', 'A2 表单顺序固定')
  check(ops.REWRITE_FORMS.every(function (f) { return f.capId === '5.11' }), 'A3 五张表单都挂在规格 5.11')
  check(ops.REWRITE_FORMS.every(function (f) { return f.dangerous === true && f.confirm === true }), 'A4 五张表单都是危险动作且要确认')
  check(ops.REWRITE_FORMS.every(function (f) { return f.reversible === false }), 'A5 五张表单都不可自动恢复')
  eq(ops.REWRITE_FORMS.map(function (f) { return f.needs }).join(','), 'paths,renames,authors,threshold,replacements', 'A6 每张表单的输入形状各不相同')
  check(ops.REWRITE_FORMS.every(function (f) { return f.labelKey.indexOf('vc.rewrite.form.') === 0 }), 'A7 文案键统一前缀')
  check(ops.REWRITE_FORMS.every(function (f) { return typeof f.command === 'string' && f.command.indexOf('filter-repo') >= 0 }), 'A8 每张表单给出 filter-repo 命令原文')
  eq(ops.REWRITE_LIMIT, 50, 'A9 单张表单一次最多五十项')
  eq(ops.rewriteFormOf('remove-paths').id, 'remove-paths', 'A10 按 id 取表单')
  eq(ops.rewriteFormOf('nope'), null, 'A11 不认识的表单回 null')
  eq(ops.rewriteFormLabelKeyOf('rename-paths'), 'vc.rewrite.form.renamePaths', 'A12 表单文案键按驼峰拼')
  eq(ops.rewriteCamelOf('rewrite-authors'), 'rewriteAuthors', 'A13 短横线转驼峰')

  eq(ops.rewritePathProblem('a.txt'), null, 'A14 普通相对路径通过')
  eq(ops.rewritePathProblem('dir/sub/file.md'), null, 'A15 多级相对路径通过')
  eq(ops.rewritePathProblem(''), 'bad-path', 'A16 空路径被拒')
  eq(ops.rewritePathProblem('../x'), 'bad-path', 'A17 上跳段被拒')
  eq(ops.rewritePathProblem('/etc/passwd'), 'bad-path', 'A18 绝对路径被拒')
  eq(ops.rewritePathProblem('C:/x'), 'bad-path', 'A19 盘符路径被拒')
  eq(ops.rewritePathProblem('-x'), 'bad-path', 'A20 短横线开头的路径被拒')
  eq(ops.rewritePathProblem('a\\b'), 'bad-path', 'A21 反斜杠路径被拒')
  eq(ops.rewritePathProblem('a\u0000b'), 'bad-path', 'A22 NUL 被拒')
  eq(ops.rewritePathProblem('dir/'), 'bad-path', 'A23 结尾斜杠被拒')
  eq(ops.rewritePathProblem('a'.repeat(1025)), 'bad-path', 'A24 超长路径被拒')

  eq(ops.rewritePathsProblem([]), 'nothing-to-do', 'A25 空清单没有可做的事')
  eq(ops.rewritePathsProblem(null), 'bad-form', 'A26 非数组直接拒')
  eq(ops.rewritePathsProblem(['a']), null, 'A27 单路径清单通过')
  eq(ops.rewritePathsProblem(['a', 'a']), 'bad-path', 'A28 重复路径被拒')
  eq(ops.rewritePathsProblem(['a', '../b']), 'bad-path', 'A29 清单里任一坏路径整张拒')
  const manyPaths = []; for (let i = 0; i < 51; i += 1) manyPaths.push('p' + i)
  eq(ops.rewritePathsProblem(manyPaths), 'too-many-items', 'A30 超过五十项被拒')

  eq(ops.rewriteRenamesProblem([{ from: 'a', to: 'b' }]), null, 'A31 单条重命名通过')
  eq(ops.rewriteRenamesProblem([]), 'nothing-to-do', 'A32 空重命名没有可做的事')
  eq(ops.rewriteRenamesProblem([{ from: 'a', to: 'a' }]), 'bad-rename', 'A33 改到同一个名字被拒')
  eq(ops.rewriteRenamesProblem([{ from: 'a' }]), 'bad-rename', 'A34 缺新名字被拒')
  eq(ops.rewriteRenamesProblem([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }]), 'bad-rename', 'A35 同一旧名字出现两次被拒')
  eq(ops.rewriteRenamesProblem([{ from: '../a', to: 'b' }]), 'bad-path', 'A36 重命名两侧都过路径守卫')

  eq(ops.rewriteIdentityTextOf('张三', 'zhang@example.com'), '张三 <zhang@example.com>', 'A37 身份写成邮件映射的一段')
  eq(ops.rewriteIdentityTextOf('', 'a@b.cn'), null, 'A38 空名字被拒')
  eq(ops.rewriteIdentityTextOf('张三', ''), null, 'A39 空邮箱被拒')
  eq(ops.rewriteIdentityTextOf('张<三', 'a@b.cn'), null, 'A40 名字里的尖括号被拒')
  eq(ops.rewriteIdentityTextOf('张三', 'not-an-email'), null, 'A41 没有 @ 的邮箱被拒')
  eq(ops.rewriteAuthorsProblem([{ name: '张三', email: 'a@b.cn' }]), null, 'A42 单条作者改写通过')
  eq(ops.rewriteAuthorsProblem([]), 'nothing-to-do', 'A43 空作者清单没有可做的事')
  eq(ops.rewriteAuthorsProblem([{ name: '张三' }]), 'bad-identity', 'A44 缺邮箱被拒')
  eq(ops.rewriteMailmapTextOf([{ oldName: '旧名', oldEmail: 'old@x.cn', name: '新名', email: 'new@x.cn' }]), '新名 <new@x.cn> 旧名 <old@x.cn>', 'A45 邮件映射文件逐行格式')

  eq(ops.rewriteThresholdProblem('10M'), null, 'A46 十兆阈值通过')
  eq(ops.rewriteThresholdProblem('1k'), null, 'A47 小写单位通过')
  eq(ops.rewriteThresholdProblem('2G'), null, 'A48 吉单位通过')
  eq(ops.rewriteThresholdProblem('0M'), 'bad-threshold', 'A49 零阈值被拒')
  eq(ops.rewriteThresholdProblem('M'), 'bad-threshold', 'A50 只有单位被拒')
  eq(ops.rewriteThresholdProblem('-1M'), 'bad-threshold', 'A51 负阈值被拒')
  eq(ops.rewriteThresholdBytesOf('10M'), 10485760, 'A52 十兆换字节')
  eq(ops.rewriteThresholdBytesOf('5k'), 5120, 'A53 五 k 换字节')

  eq(ops.rewriteReplacementsProblem([{ from: 'secret', to: '***' }]), null, 'A54 单条字面量替换通过')
  eq(ops.rewriteReplacementsProblem([]), 'nothing-to-do', 'A55 空替换清单没有可做的事')
  eq(ops.rewriteReplacementsProblem([{ from: '', to: 'x' }]), 'bad-replacement', 'A56 空字面量被拒')
  eq(ops.rewriteReplacementsProblem([{ from: 'a\nb', to: 'x' }]), 'bad-replacement', 'A57 换行字面量被拒')
  eq(ops.rewriteReplacementsProblem([{ from: 'a==>b', to: 'x' }]), 'bad-replacement', 'A58 字面量里不许带分隔符')
  eq(ops.rewriteReplacementsProblem([{ from: 'a', to: 'x\ny' }]), 'bad-replacement', 'A59 替换结果里不许换行')
  eq(ops.rewriteReplaceTextOf([{ from: 'a', to: 'b' }, { from: 'c', to: '' }]), 'literal:a==>b\nliteral:c==>', 'A60 替换说明文件逐行格式')

  const plan = ops.rewritePlanOf({ form: 'remove-paths', paths: ['a.txt'] })
  eq(Object.keys(plan).join(','), 'op,form,paths,renames,authors,threshold,replacements', 'A61 计划键序固定')
  eq(plan.op, 'rewrite', 'A62 计划动作名固定')
  eq(ops.rewritePlanOf({}).form, '', 'A63 未给表单时留空串')
  eq(ops.rewritePlanInput(ops.rewritePlanOf({ form: 'remove-paths', paths: ['a'] })), ops.rewritePlanInput(ops.rewritePlanOf({ paths: ['a'], form: 'remove-paths' })), 'A64 输入键序不影响摘要输入')
  check(ops.rewritePlanInput(ops.rewritePlanOf({ form: 'remove-paths', paths: ['a'] })) !== ops.rewritePlanInput(ops.rewritePlanOf({ form: 'remove-paths', paths: ['b'] })), 'A65 不同计划摘要输入不同')
  eq(ops.rewriteFormProblem('nope', plan), 'bad-form', 'A66 不认识的表单被拒')
  eq(ops.rewriteFormProblem('remove-paths', ops.rewritePlanOf({ form: 'remove-paths', paths: ['a'] })), null, 'A67 删路径表单合法')
  eq(ops.rewriteFormProblem('remove-paths', ops.rewritePlanOf({ form: 'remove-paths' })), 'nothing-to-do', 'A68 删路径缺清单被拒')
  eq(ops.rewriteFormProblem('rename-paths', ops.rewritePlanOf({ form: 'rename-paths' })), 'nothing-to-do', 'A69 重命名缺清单被拒')
  eq(ops.rewriteFormProblem('rewrite-authors', ops.rewritePlanOf({ form: 'rewrite-authors', authors: [{ name: 'a', email: 'b@c.cn' }] })), null, 'A70 作者表单合法')
  eq(ops.rewriteFormProblem('remove-large', ops.rewritePlanOf({ form: 'remove-large', threshold: '10M' })), null, 'A71 大文件表单合法')
  eq(ops.rewriteFormProblem('replace-text', ops.rewritePlanOf({ form: 'replace-text', replacements: [{ from: 'a', to: 'b' }] })), null, 'A72 替换表单合法')

  const removePlanB = ops.rewritePlanOf({ form: 'remove-paths', paths: ['a', 'b/c'] })
  eq(ops.rewriteTaskTokensOf('remove-paths', removePlanB).tokens.join(' '), '--invert-paths --path a --path b/c', 'A73 删路径的任务参数逐个独立')
  const renamePlan = ops.rewritePlanOf({ form: 'rename-paths', renames: [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }] })
  eq(ops.rewriteTaskTokensOf('rename-paths', renamePlan).tokens.join(' '), '--path-rename a:b --path-rename c:d', 'A74 重命名的任务参数带冒号')
  const authorPlan = ops.rewritePlanOf({ form: 'rewrite-authors', authors: [{ oldName: '旧', oldEmail: 'o@x.cn', name: '新', email: 'n@x.cn' }] })
  eq(ops.rewriteTaskTokensOf('rewrite-authors', authorPlan, { mailmapPath: 'C:/tmp/m.txt' }).tokens.join(' '), '--mailmap C:/tmp/m.txt', 'A75 作者改写用临时映射文件')
  eq(ops.rewriteTaskTokensOf('rewrite-authors', authorPlan).ok, false, 'A76 缺临时文件时不猜路径')
  eq(ops.rewriteTaskTokensOf('rewrite-authors', authorPlan).reason, 'temp-unavailable', 'A77 缺临时文件的理由')
  const largePlan = ops.rewritePlanOf({ form: 'remove-large', threshold: '10M' })
  eq(ops.rewriteTaskTokensOf('remove-large', largePlan).tokens.join(' '), '--strip-blobs-bigger-than 10M', 'A78 大文件阈值的任务参数')
  const replacePlan = ops.rewritePlanOf({ form: 'replace-text', replacements: [{ from: 'a', to: 'b' }] })
  eq(ops.rewriteTaskTokensOf('replace-text', replacePlan, { replacePath: 'C:/tmp/r.txt' }).tokens.join(' '), '--replace-text C:/tmp/r.txt', 'A79 替换用临时说明文件')
  has(ops.rewriteDisplayCommandOf('remove-paths', removePlanB), 'git filter-repo --force', 'A80 界面上显示完整的 filter-repo 命令')
  has(ops.rewriteDisplayCommandOf('rewrite-authors', authorPlan), '面板生成', 'A81 临时文件位置用可读占位说明而不是编一个路径')

  const scene = { repoRoot: 'C:/repo', repoName: 'repo', freeBytes: 100000000000, repoSizeBytes: 1000000, nowMs: 1700000000000 }
  eq(ops.rewriteBackupPlanOf(scene).kind, 'mirror', 'A82 磁盘足够时用镜像克隆备份')
  eq(ops.rewriteBackupPlanOf({ repoRoot: 'C:/repo', freeBytes: 1000, repoSizeBytes: 1000000 }).kind, 'bundle', 'A83 磁盘不够时降级成整仓打包')
  has(ops.rewriteBackupPlanOf(scene).path, 'repo', 'A84 备份路径里带仓库名')
  eq(ops.rewriteBackupPlanOf(scene).required, true, 'A85 备份是强制前置')
  eq(ops.rewriteBackupPlanOf(scene).estimateBytes, 1000000, 'A86 镜像备份的估算大小就是仓库大小')

  eq(ops.rewriteGuardProblem({ filterRepoAvailable: false, shallow: false, dirty: false, operation: null, commitCount: 3 }, removePlanB), 'tool-missing', 'A87 没装 filter-repo 时明确拒绝')
  eq(ops.rewriteGuardProblem({ filterRepoAvailable: true, shallow: true, dirty: false, operation: null, commitCount: 3 }, removePlanB), 'shallow-repo', 'A88 浅克隆仓库拒绝')
  eq(ops.rewriteGuardProblem({ filterRepoAvailable: true, shallow: false, dirty: false, operation: 'merge', commitCount: 3 }, removePlanB), 'operation-in-progress', 'A89 有进行中操作时拒绝')
  eq(ops.rewriteGuardProblem({ filterRepoAvailable: true, shallow: false, dirty: true, operation: null, commitCount: 3 }, removePlanB), 'dirty-worktree', 'A90 工作区不干净时拒绝')
  eq(ops.rewriteGuardProblem({ filterRepoAvailable: true, shallow: false, dirty: false, operation: null, commitCount: 0 }, removePlanB), 'nothing-to-do', 'A91 空仓库没有可重写的历史')
  eq(ops.rewriteGuardProblem({ filterRepoAvailable: true, shallow: false, dirty: false, operation: null, commitCount: 3 }, removePlanB), null, 'A92 现场干净时放行')
  eq(ops.REWRITE_CHECK_CONTRACT, 'vc-rewrite-check', 'A93 契约名固定')
  eq(ops.REWRITE_CHECK_VERSION, 1, 'A94 契约版本从一算起')
  eq(ops.REWRITE_PHONES.preview + ',' + ops.REWRITE_PHONES.check + ',' + ops.REWRITE_PHONES.run, 'wf.gitRewritePreview,wf.gitRewriteCheck,wf.gitRewriteRun', 'A95 三条电话名固定')
  has(ops.REWRITE_OPS_SOURCE, 'remove-paths', 'A96 源码常量含五张表单标识')

  eq(rec.backupPointOf({ kind: 'mirror', path: 'C:/backup/repo', bytes: 1024, elapsedMs: 12, atMs: 100 }).ok, true, 'A97 备份点读全时成功')
  eq(rec.backupPointOf({ kind: 'bundle', path: 'x' }).ok, false, 'A98 备份点缺字节数时显式失败')
  eq(rec.backupPointOf({ kind: 'bundle', path: 'x' }).reason, 'backup-unreadable', 'A99 读不全的理由是 backup-unreadable')
  eq(rec.backupPointOf({ kind: 'nowhere', path: 'x', bytes: 1, elapsedMs: 1, atMs: 1 }).reason, 'backup-unreadable', 'A100 不认识的方式也显式失败')
  const bp = rec.backupPointOf({ kind: 'mirror', path: 'C:/backup/repo', bytes: 1048576, elapsedMs: 1234, atMs: 1700000000000 }).point
  eq(rec.backupPointDigestInput(bp), rec.backupPointDigestInput(Object.assign({}, bp, { path: bp.path })), 'A101 备份点摘要输入稳定')
  has(rec.backupSummaryOf(bp), 'C:/backup/repo', 'A102 备份摘要点名路径')
  has(rec.backupSummaryOf(bp), '1.0 MB', 'A103 备份摘要给人读的大小')
  check(rec.backupRestoreStepsOf(bp).length >= 1, 'A104 备份点给出还原步骤')
  has(rec.backupRestoreStepsOf(bp).join('\n'), 'clone', 'A105 还原步骤用 clone 从备份重建')

  const opsSrc = sourceText('src/shared/version-control/src/rewrite-ops.ts')
  const recSrc = sourceText('src/shared/version-control/src/recovery-point.ts')
  check(opsSrc.indexOf('import ') < 0, 'A106 共享表单协议零 import（要拼进界面闭包）')
  check(recSrc.indexOf('import ') < 0, 'A107 恢复点模块保持零 import')

  console.log('  A 组完成：' + total + ' 条')
  // ---------- B 组：宿主三片的拒绝栈（全假依赖，断言零进程 / 零长任务） ----------
  const env = await loadModule('src/shared/version-control/exec-envelope.js')
  const sceneMod = await loadModule('src/host/versionControlRewriteScene.js')
  const checkMod = await loadModule('src/host/versionControlRewriteCheck.js')
  const writeMod = await loadModule('src/host/versionControlRewriteWrite.js')

  function mkScreen(over) {
    const base = { identity: { oid: 'a'.repeat(40) }, repo: { merging: false, rebasing: false, cherryPicking: false, reverting: false }, staged: [], unstaged: [], conflictCount: 0 }
    return Object.assign(base, over || {})
  }

  function fakeRig(spec) {
    const s = spec || {}
    const state = { calls: [], taskStarts: [], nowMs: 1000, ordered: 0, toolMissing: s.toolMissing === true, backupFails: s.backupFails === true, screen: s.screen || mkScreen() }
    const deps = {
      runPinned: async function (exe, dir, args) {
        state.calls.push(args.slice())
        const a = args
        if (a[0] === 'filter-repo') return state.toolMissing ? { kind: 'non-zero', exitCode: 1, stdout: '', stderr: "git: 'filter-repo' is not a git command" } : { kind: 'ok', exitCode: 0, stdout: 'git-filter-repo 2.38.0\n', stderr: '' }
        if (a[0] === 'clone' && state.backupFails) return { kind: 'non-zero', exitCode: 128, stdout: '', stderr: 'fatal: could not create work tree dir' }
        if (a[0] === 'bundle' && state.backupFails) return { kind: 'non-zero', exitCode: 128, stdout: '', stderr: 'fatal: could not create output file' }
        if (a[0] === 'count-objects') return { kind: 'ok', stdout: 'count: 1\nsize: 100\nin-pack: 0\nsize-pack: 50\n', stderr: '' }
        if (a[0] === 'rev-list' && a.indexOf('--all') >= 0 && a[a.length - 1] === '--all') return { kind: 'ok', stdout: String(s.commitCount === undefined ? 3 : s.commitCount) + '\n', stderr: '' }
        if (a[0] === 'rev-list' && a.indexOf('--count') >= 0) return { kind: 'ok', stdout: String(s.pathCommits === undefined ? 2 : s.pathCommits) + '\n', stderr: '' }
        if (a[0] === 'rev-parse' && a[1] === '--abbrev-ref') return { kind: 'ok', stdout: 'main\n', stderr: '' }
        if (a[0] === 'rev-parse' && a[1] === '--is-shallow-repository') return { kind: 'ok', stdout: (s.shallow === true ? 'true' : 'false') + '\n', stderr: '' }
        if (a[0] === 'ls-files') return { kind: 'ok', stdout: 'a.txt\u0000b.txt\u0000dir/c.txt\u0000', stderr: '' }
        if (a[0] === 'log' && a.indexOf('--format=%H') >= 0) return { kind: 'ok', stdout: 'h1\nh2\n', stderr: '' }
        if (a[0] === 'log') return { kind: 'ok', stdout: 'old@example.com\na@b.cn\nold@example.com\n', stderr: '' }
        return { kind: 'ok', stdout: '', stderr: '' }
      },
      resolveGitExecutable: async function () { return 'git' },
      resolveRepoRoot: async function () { return s.notRepo ? { ok: false, error: { message: 'not a repo' } } : { ok: true, root: 'C:/repo' } },
      readScreenOf: async function () { return { ok: true, screen: state.screen } },
      fs: { statfs: async function () { return s.noSpace ? { bsize: 4096, bavail: 0 } : { bsize: 4096, bavail: 1000000 } } },
      now: function () { return state.nowMs },
    }
    const clock = { t: 1000 }
    const scene = sceneMod.createRewriteScene(Object.assign({}, deps, { now: function () { return clock.t } }))
    const check = checkMod.createRewriteCheck({ scene: scene, failPhone: env.failPhone, now: function () { return clock.t }, randomId: function () { state.ordered += 1; return 'rw-' + state.ordered } })
    const write = writeMod.createRewriteWrite({
      scene: scene,
      failPhone: env.failPhone,
      runPinned: deps.runPinned,
      taskStart: async function (a) { state.taskStarts.push(a); return { ok: true, task: { id: 'task-' + state.taskStarts.length } } },
      now: function () { return clock.t },
      tickets: check.tickets,
      results: check.results,
      fs: deps.fs,
    })
    return { state: state, clock: clock, scene: scene, check: check, write: write, screen: state.screen }
  }

  const removePlanB2 = { form: 'remove-paths', paths: ['a.txt'] }
  const removeArgsB2 = { cwd: 'C:/repo', plan: removePlanB2 }

  const pv0 = await fakeRig().check.handleRewritePreview({ plan: removePlanB2 })
  eq(pv0.reason, 'bad-target', 'B1 预览缺仓库目录时拒绝')
  const pv1 = await fakeRig().check.handleRewritePreview({ cwd: 'C:/repo', plan: { form: 'nope' } })
  eq(pv1.reason, 'bad-form', 'B2 预览不认识表单时拒绝')
  const pv2 = await fakeRig().check.handleRewritePreview({ cwd: 'C:/repo', plan: { form: 'remove-paths', paths: ['../x'] } })
  eq(pv2.ok, false, 'B3 预览里坏路径被拒')
  eq(pv2.reason, 'bad-path', 'B4 坏路径的理由是 bad-path')
  const rigPv = fakeRig()
  const pv3 = await rigPv.check.handleRewritePreview(removeArgsB2)
  eq(pv3.ok, true, 'B5 预览成功回 ok')
  eq(pv3.preview.counts.commits, 3, 'B6 预览给全库提交数')
  eq(pv3.preview.counts.matchedPaths, 1, 'B7 预览数出被删路径命中的文件数')
  eq(pv3.preview.counts.matchedCommits, 2, 'B8 预览数出被触及的提交数')
  has(pv3.preview.command, '--invert-paths', 'B9 预览给命令原文')
  check(rigPv.state.taskStarts.length === 0, 'B10 预览不签票也不起任务')
  const pvAuthors = await fakeRig().check.handleRewritePreview({ cwd: 'C:/repo', plan: { form: 'rewrite-authors', authors: [{ name: '张三', email: 'zhang@example.com', oldName: '旧名', oldEmail: 'old@example.com' }] } })
  eq(pvAuthors.preview.counts.matchedCommits, 2, 'B11 改写作者按旧邮箱数提交')
  const pvLarge = await fakeRig().check.handleRewritePreview({ cwd: 'C:/repo', plan: { form: 'remove-large', threshold: '10M' } })
  eq(pvLarge.preview.counts.thresholdBytes, 10485760, 'B12 删大文件预览换算出阈值字节')
  eq(pvLarge.preview.counts.matchedCommits, null, 'B13 删大文件预览不假装知道提交数')
  const pvReplace = await fakeRig().check.handleRewritePreview({ cwd: 'C:/repo', plan: { form: 'replace-text', replacements: [{ from: 'SECRET', to: '' }] } })
  eq(pvReplace.preview.counts.replacementHits[0].commits, 2, 'B14 字面量替换预览逐条数命中提交')

  const ckTool = await fakeRig({ toolMissing: true }).check.handleRewriteCheck(removeArgsB2)
  eq(ckTool.ok, false, 'B15 没装 filter-repo 时预检拒绝')
  eq(ckTool.reason, 'tool-missing', 'B16 没装工具的理由是 tool-missing')
  check(ckTool.ticket === undefined, 'B17 被拒时不签票')
  const ckDirty = await fakeRig({ screen: mkScreen({ staged: ['x'], unstaged: [] }) }).check.handleRewriteCheck(removeArgsB2)
  eq(ckDirty.reason, 'dirty-worktree', 'B18 工作区不干净时预检拒绝')
  const ckOp = await fakeRig({ screen: mkScreen({ repo: { merging: true, rebasing: false, cherryPicking: false, reverting: false } }) }).check.handleRewriteCheck(removeArgsB2)
  eq(ckOp.reason, 'operation-in-progress', 'B19 有进行中操作时预检拒绝')
  const ckShallow = await fakeRig({ shallow: true }).check.handleRewriteCheck(removeArgsB2)
  eq(ckShallow.reason, 'shallow-repo', 'B20 浅克隆仓库预检拒绝')
  const ckEmpty = await fakeRig({ screen: mkScreen({ identity: { oid: '' } }) }).check.handleRewriteCheck(removeArgsB2)
  eq(ckEmpty.ok, false, 'B21 空仓库预检拒绝')

  const rigOk = fakeRig()
  const ckOk = await rigOk.check.handleRewriteCheck(removeArgsB2)
  eq(ckOk.ok, true, 'B22 现场干净且装了工具时预检签票')
  eq(ckOk.confirmRequired, true, 'B23 预检要求显式确认')
  eq(ckOk.confirm.what.length >= 4, true, 'B24 确认卡四段齐全')
  has(ckOk.confirm.what.join('\n'), '提交号都会变', 'B25 确认卡写清全部提交号会变')
  has(ckOk.confirm.what.join('\n'), '强推', 'B26 确认卡写清远端要强推')
  has(ckOk.confirm.what.join('\n'), '重新克隆', 'B27 确认卡写清协作者要重新克隆')
  eq(ckOk.backup.kind, 'mirror', 'B28 磁盘够时用镜像克隆备份')
  eq(ckOk.ticket.expiresAtMs - ckOk.ticket.checkedAtMs, 120000, 'B29 票据时限一百二十秒')
  eq(ckOk.ticket.op, 'rewrite', 'B30 票上记着重写动作')
  check(rigOk.state.taskStarts.length === 0, 'B31 预检只签票不起任务')
  const rigNoSpace = fakeRig({ noSpace: true })
  const ckSpace = await rigNoSpace.check.handleRewriteCheck(removeArgsB2)
  eq(ckSpace.backup.kind, 'bundle', 'B32 磁盘不够时降级整仓打包')
  has(ckSpace.backup.path, '.bundle', 'B33 降级备份路径带 .bundle 后缀')

  const wMissing = await fakeRig().write.handleRewriteRun({ cwd: 'C:/repo', ticketId: 'nope', requestId: 'r1', confirmed: true })
  eq(wMissing.reason, 'ticket-missing', 'B34 伪造票被拒')
  const wBadReq = await fakeRig().write.handleRewriteRun({ cwd: 'C:/repo', ticketId: 'x', requestId: 'bad id!', confirmed: true })
  eq(wBadReq.reason, 'bad-target', 'B35 请求号形状不对时拒绝')
  const rigJudge = fakeRig()
  const ckJudge = await rigJudge.check.handleRewriteCheck(removeArgsB2)
  const tkJudge = rigJudge.check.tickets.get(ckJudge.ticket.id)
  tkJudge.op = 'merge'
  const wMismatch = await rigJudge.write.handleRewriteRun({ cwd: 'C:/repo', ticketId: ckJudge.ticket.id, requestId: 'r2', confirmed: true })
  eq(wMismatch.reason, 'ticket-op-mismatch', 'B36 票被换成别的动作时拒绝')

  const rigConfirm = fakeRig()
  const ckConfirm = await rigConfirm.check.handleRewriteCheck(removeArgsB2)
  const wNeed = await rigConfirm.write.handleRewriteRun({ cwd: 'C:/repo', ticketId: ckConfirm.ticket.id, requestId: 'r3' })
  eq(wNeed.reason, 'need-confirm', 'B37 没确认时拒绝执行')
  check(rigConfirm.state.taskStarts.length === 0, 'B38 没确认时零长任务')

  const rigExpire = fakeRig()
  const ckExpire = await rigExpire.check.handleRewriteCheck(removeArgsB2)
  rigExpire.clock.t = 1000 + 120001
  const wExpired = await rigExpire.write.handleRewriteRun({ cwd: 'C:/repo', ticketId: ckExpire.ticket.id, requestId: 'r4', confirmed: true })
  eq(wExpired.reason, 'ticket-expired', 'B39 过期票被拒')
  check(rigExpire.state.taskStarts.length === 0, 'B40 过期票零长任务')

  const rigDrift = fakeRig()
  const ckDrift = await rigDrift.check.handleRewriteCheck(removeArgsB2)
  rigDrift.state.screen.identity.oid = 'b'.repeat(40)
  const wDrift = await rigDrift.write.handleRewriteRun({ cwd: 'C:/repo', ticketId: ckDrift.ticket.id, requestId: 'r5', confirmed: true })
  eq(wDrift.reason, 'target-changed', 'B41 预检后 HEAD 变了零进程拒绝')
  const rigTree = fakeRig()
  const ckTree = await rigTree.check.handleRewriteCheck(removeArgsB2)
  rigTree.state.screen.staged = ['late.txt']
  const wTree = await rigTree.write.handleRewriteRun({ cwd: 'C:/repo', ticketId: ckTree.ticket.id, requestId: 'r6', confirmed: true })
  eq(wTree.reason, 'target-changed', 'B42 预检后工作区变了零进程拒绝')
  const rigTool2 = fakeRig()
  const ckTool2 = await rigTool2.check.handleRewriteCheck(removeArgsB2)
  rigTool2.state.toolMissing = true
  const wTool2 = await rigTool2.write.handleRewriteRun({ cwd: 'C:/repo', ticketId: ckTool2.ticket.id, requestId: 'r7', confirmed: true })
  eq(wTool2.reason, 'tool-missing', 'B43 执行前工具没了也拒绝')
  check(rigTool2.state.taskStarts.length === 0, 'B44 工具缺失时零长任务')

  const rigRun = fakeRig()
  const ckRun = await rigRun.check.handleRewriteCheck(removeArgsB2)
  const wRun = await rigRun.write.handleRewriteRun({ cwd: 'C:/repo', ticketId: ckRun.ticket.id, requestId: 'run-1', confirmed: true })
  eq(wRun.ok, true, 'B45 凭票执行成功')
  eq(wRun.steps.join(','), 'backup,task', 'B46 执行顺序是先备份再起任务')
  eq(rigRun.state.taskStarts.length, 1, 'B47 起了且只起一次长任务')
  has(JSON.stringify(rigRun.state.taskStarts[0].args), '"--invert-paths"', 'B48 长任务参数含删路径开关')
  eq(rigRun.state.taskStarts[0].args[1], '--path', 'B49 长任务参数逐项独立')
  eq(rigRun.state.taskStarts[0].args[2], 'a.txt', 'B50 路径作为独立参数传入')
  has(wRun.backupSummary, '镜像克隆', 'B51 回包给出备份摘要')
  check(wRun.backupRestoreSteps.length >= 1, 'B52 回包给出还原步骤但不自动恢复')
  check(rigRun.state.calls.some(function (a) { return a[0] === 'clone' && a.indexOf('--mirror') >= 0 }), 'B53 备份真的执行了镜像克隆')
  const wReplay = await rigRun.write.handleRewriteRun({ cwd: 'C:/repo', ticketId: ckRun.ticket.id, requestId: 'run-1', confirmed: true })
  eq(wReplay.reused, true, 'B54 同一请求号重放回上次结果')
  eq(rigRun.state.taskStarts.length, 1, 'B55 重放不重复起任务')

  const rigBackupFail = fakeRig({ backupFails: true })
  const ckFail = await rigBackupFail.check.handleRewriteCheck(removeArgsB2)
  const wFail = await rigBackupFail.write.handleRewriteRun({ cwd: 'C:/repo', ticketId: ckFail.ticket.id, requestId: 'run-2', confirmed: true })
  eq(wFail.ok, false, 'B56 备份失败时执行失败')
  eq(wFail.reason, 'backup-failed', 'B57 备份失败的明确理由是 backup-failed')
  eq(rigBackupFail.state.taskStarts.length, 0, 'B58 备份失败绝不开始重写')

  console.log('  B 组完成：' + total + ' 条')

  // ---------- C 组：真临时 git 仓库（真读现场、真做备份，长任务用假入口） ----------
  const cmds = await loadModule('src/shared/version-control/src/commands.js')
  const gitEnv = Object.assign({}, process.env, { GIT_EDITOR: 'false', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' })
  function gitRun(dir, args) {
    return cp.spawnSync('git', ['-C', dir].concat(args), { env: gitEnv, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 })
  }
  function gitMust(dir, args) {
    const r = gitRun(dir, args)
    if (r.status !== 0) throw new Error('夹具 git ' + args.join(' ') + ' 失败：' + String(r.stderr || '').slice(0, 300))
    return r
  }
  function writeIn(dir, rel, text) {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, text, 'utf8')
  }
  function mkRepo(tag) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws-rewrite-' + tag + '-'))
    gitMust(dir, ['init', '-q', '-b', 'main'])
    gitMust(dir, ['config', 'user.name', '测试'])
    gitMust(dir, ['config', 'user.email', 'old@example.com'])
    writeIn(dir, 'a.txt', 'one\n')
    gitMust(dir, ['add', '-A'])
    gitMust(dir, ['commit', '-q', '-m', 'first'])
    writeIn(dir, 'secret/token.txt', 'SECRET-ONE\n')
    gitMust(dir, ['add', '-A'])
    gitMust(dir, ['commit', '-q', '-m', 'second SECRET'])
    writeIn(dir, 'b.txt', 'three\n')
    gitMust(dir, ['add', '-A'])
    gitMust(dir, ['commit', '-q', '-m', 'third'])
    return dir
  }
  function realScreenOf(cwd) {
    const top = gitRun(cwd, ['rev-parse', '--show-toplevel'])
    if (top.status !== 0) return { ok: false, error: { message: String(top.stderr || '') } }
    const root = String(top.stdout || '').trim()
    const head = String(gitMust(root, ['rev-parse', 'HEAD']).stdout || '').trim()
    const stagedLines = String(gitRun(root, ['diff', '--cached', '--name-only']).stdout || '').split('\n').filter(function (l) { return l !== '' })
    const unstagedLines = String(gitRun(root, ['diff', '--name-only']).stdout || '').split('\n').filter(function (l) { return l !== '' })
    const conflictLines = String(gitRun(root, ['diff', '--name-only', '--diff-filter=U']).stdout || '').split('\n').filter(function (l) { return l !== '' })
    const gitDir = path.join(root, '.git')
    const repo = {
      merging: fs.existsSync(path.join(gitDir, 'MERGE_HEAD')),
      rebasing: fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply')),
      cherryPicking: fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD')),
      reverting: fs.existsSync(path.join(gitDir, 'REVERT_HEAD')),
    }
    return { ok: true, screen: { identity: { oid: head }, repo: repo, staged: stagedLines, unstaged: unstagedLines, conflictCount: conflictLines.length } }
  }
  function makeRealRig(cwd, spec) {
    const s = spec || {}
    const state = { calls: [], taskStarts: [], backups: [] }
    const runPinned = async function (exe, dir, args) {
      state.calls.push({ dir: dir, args: args.slice() })
      if (args[0] === 'filter-repo') return s.toolMissing ? { kind: 'non-zero', exitCode: 1, stdout: '', stderr: "git: 'filter-repo' is not a git command" } : { kind: 'ok', exitCode: 0, stdout: 'git-filter-repo 2.38.0\n', stderr: '' }
      const r = cp.spawnSync('git', ['-C', dir].concat(cmds.fixedPrefix()).concat(args), { env: gitEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 })
      return r.status === 0 ? { kind: 'ok', exitCode: 0, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') } : { kind: 'non-zero', exitCode: r.status === null ? 1 : r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') }
    }
    const scene = sceneMod.createRewriteScene({
      runPinned: runPinned,
      resolveGitExecutable: async function () { return 'git' },
      resolveRepoRoot: async function (exe, c) {
        const r = cp.spawnSync('git', ['-C', c, 'rev-parse', '--show-toplevel'], { env: gitEnv, encoding: 'utf8' })
        if (r.status !== 0) return { ok: false, error: { message: String(r.stderr || '') } }
        return { ok: true, root: String(r.stdout || '').trim() }
      },
      readScreenOf: async function (c) { return realScreenOf(c) },
      now: function () { return Date.now() },
      failPhone: env.failPhone,
    })
    const check = checkMod.createRewriteCheck({ scene: scene, failPhone: env.failPhone, now: function () { return Date.now() }, randomId: function () { return 'rr-' + Math.random().toString(36).slice(2) } })
    const write = writeMod.createRewriteWrite({
      scene: scene,
      failPhone: env.failPhone,
      runPinned: runPinned,
      taskStart: async function (a) { state.taskStarts.push(a); return { ok: true, task: { id: 'task-real-' + state.taskStarts.length } } },
      now: function () { return Date.now() },
      tickets: check.tickets,
      results: check.results,
      fs: { statfs: async function (p) { const st = fs.statfsSync(p); return { bsize: st.bsize, bavail: st.bavail } } },
    })
    return { state: state, scene: scene, check: check, write: write }
  }

  const repo = mkRepo('c')
  const rigReal = makeRealRig(repo)
  const realScene = await rigReal.scene.sceneOf(repo)
  eq(realScene.ok, true, 'C1 真仓库能读出完整现场')
  eq(realScene.scene.commitCount, 3, 'C2 现场读出提交数')
  eq(realScene.scene.shallow, false, 'C3 普通克隆不是浅克隆')
  eq(realScene.scene.dirty, false, 'C4 刚提交完的仓库是干净的')
  const pvReal = await rigReal.scene.previewOf(realScene, { form: 'remove-paths', paths: ['secret'] })
  eq(pvReal.ok, true, 'C5 真仓库预览成功')
  eq(pvReal.counts.matchedPaths, 1, 'C6 真仓库数出被删路径命中的文件')
  eq(pvReal.counts.matchedCommits, 1, 'C7 真仓库数出触及的提交数')
  has(pvReal.command, '--invert-paths', 'C8 真仓库预览给命令原文')
  const pvAuthorsReal = await rigReal.scene.previewOf(realScene, { form: 'rewrite-authors', authors: [{ name: '张三', email: 'new@example.com', oldName: '旧名', oldEmail: 'old@example.com' }] })
  eq(pvAuthorsReal.counts.matchedCommits, 3, 'C9 真仓库按作者邮箱数出全部提交')
  const pvReplaceReal = await rigReal.scene.previewOf(realScene, { form: 'replace-text', replacements: [{ from: 'SECRET', to: '' }] })
  eq(pvReplaceReal.counts.replacementHits[0].commits, 1, 'C10 真仓库数出字面量命中的提交')
  const pvLargeReal = await rigReal.scene.previewOf(realScene, { form: 'remove-large', threshold: '1k' })
  eq(pvLargeReal.counts.thresholdBytes, 1024, 'C11 真仓库预览换算出阈值字节')

  const ckToolReal = await makeRealRig(repo, { toolMissing: true }).check.handleRewriteCheck({ cwd: repo, plan: { form: 'remove-paths', paths: ['secret'] } })
  eq(ckToolReal.reason, 'tool-missing', 'C12 真机上没装 filter-repo 时预检明确拒绝')
  check(ckToolReal.ticket === undefined, 'C13 没装工具时不签票')

  const dirtyRepo = mkRepo('dirty')
  writeIn(dirtyRepo, 'a.txt', 'changed\n')
  const ckDirtyReal = await makeRealRig(dirtyRepo).check.handleRewriteCheck({ cwd: dirtyRepo, plan: { form: 'remove-paths', paths: ['secret'] } })
  eq(ckDirtyReal.reason, 'dirty-worktree', 'C14 真仓库有未提交改动时拒绝')

  const shallowParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws-rewrite-shallow-'))
  const shallowDir = path.join(shallowParent, 'clone')
  const cloneRes = cp.spawnSync('git', ['clone', '-q', '--depth', '1', 'file:///' + repo.replace(/\\/g, '/'), shallowDir], { env: gitEnv, encoding: 'utf8', timeout: 120000 })
  if (cloneRes.status !== 0) throw new Error('夹具浅克隆失败：' + String(cloneRes.stderr || '').slice(0, 300))
  const shallowScene = await makeRealRig(shallowDir).scene.sceneOf(shallowDir)
  eq(shallowScene.ok, true, 'C15 浅克隆仓库也能读出场景')
  eq(shallowScene.scene.shallow, true, 'C16 浅克隆被识别出来')
  const ckShallowReal = await makeRealRig(shallowDir).check.handleRewriteCheck({ cwd: shallowDir, plan: { form: 'remove-paths', paths: ['a.txt'] } })
  eq(ckShallowReal.reason, 'shallow-repo', 'C17 浅克隆仓库预检拒绝')

  const rigHappy = makeRealRig(repo)
  const ckHappy = await rigHappy.check.handleRewriteCheck({ cwd: repo, plan: { form: 'remove-paths', paths: ['secret'] } })
  eq(ckHappy.ok, true, 'C18 真仓库预检签票成功')
  eq(ckHappy.confirm.what.length >= 4, true, 'C19 真仓库确认卡四段齐全')
  eq(ckHappy.backup.kind, 'mirror', 'C20 真仓库磁盘够用镜像克隆')
  const backupPath = ckHappy.backup.path
  check(backupPath.indexOf('-backup-') >= 0, 'C21 备份路径带时间戳与 backup 标记')
  check(fs.existsSync(backupPath) === false, 'C22 预检只算备份计划，不提前创建备份目录')
  const wHappy = await rigHappy.write.handleRewriteRun({ cwd: repo, ticketId: ckHappy.ticket.id, requestId: 'real-1', confirmed: true })
  eq(wHappy.ok, true, 'C23 真仓库凭票执行成功')
  check(fs.existsSync(backupPath), 'C24 备份目录真的被创建出来')
  check(wHappy.backup.bytes > 0, 'C25 备份字节数大于零')
  eq(rigHappy.state.taskStarts.length, 1, 'C26 备份成功后才起长任务')
  eq(rigHappy.state.taskStarts[0].args[0], '--invert-paths', 'C27 长任务参数以删路径开关开头')
  eq(rigHappy.state.taskStarts[0].args[1], '--path', 'C28 长任务参数逐项独立')
  eq(rigHappy.state.taskStarts[0].args[2], 'secret', 'C29 路径作为独立参数传入')
  const headAfter = String(gitMust(repo, ['rev-parse', 'HEAD']).stdout || '').trim()
  eq(headAfter, realScene.scene.headOid, 'C30 假长任务没有改动仓库历史')
  const wReplayReal = await rigHappy.write.handleRewriteRun({ cwd: repo, ticketId: ckHappy.ticket.id, requestId: 'real-1', confirmed: true })
  eq(wReplayReal.reused, true, 'C31 真仓库同一请求号重放回上次结果')
  eq(rigHappy.state.taskStarts.length, 1, 'C32 重放不重复起长任务')

  const rigDriftReal = makeRealRig(repo)
  const ckDriftReal = await rigDriftReal.check.handleRewriteCheck({ cwd: repo, plan: { form: 'remove-paths', paths: ['secret'] } })
  writeIn(repo, 'c.txt', 'late\n')
  gitMust(repo, ['add', 'c.txt'])
  gitMust(repo, ['commit', '-q', '-m', 'late commit'])
  const backupsBefore = fs.readdirSync(path.dirname(repo)).filter(function (n) { return n.indexOf('-backup-') >= 0 })
  const wDriftReal = await rigDriftReal.write.handleRewriteRun({ cwd: repo, ticketId: ckDriftReal.ticket.id, requestId: 'real-2', confirmed: true })
  eq(wDriftReal.reason, 'target-changed', 'C33 真仓库预检后新提交导致零进程拒绝')
  const backupsAfter = fs.readdirSync(path.dirname(repo)).filter(function (n) { return n.indexOf('-backup-') >= 0 })
  eq(backupsAfter.length, backupsBefore.length, 'C34 被拒时没有偷偷做备份')
  eq(rigDriftReal.state.taskStarts.length, 0, 'C35 被拒时零长任务')

  const rigBackupFailReal = makeRealRig(repo)
  const ckBackupFailReal = await rigBackupFailReal.check.handleRewriteCheck({ cwd: repo, plan: { form: 'remove-paths', paths: ['secret'] } })
  const failTicket = rigBackupFailReal.check.tickets.get(ckBackupFailReal.ticket.id)
  failTicket.backup = Object.assign({}, failTicket.backup, { path: path.join(os.tmpdir(), 'no-such-dir-1750', 'backup-target') })
  const wBackupFailReal = await rigBackupFailReal.write.handleRewriteRun({ cwd: repo, ticketId: ckBackupFailReal.ticket.id, requestId: 'real-3', confirmed: true })
  eq(wBackupFailReal.ok, false, 'C36 备份目标写不进去时执行失败')
  eq(wBackupFailReal.reason, 'backup-failed', 'C37 真机备份失败的明确理由是 backup-failed')
  eq(rigBackupFailReal.state.taskStarts.length, 0, 'C38 备份失败绝不开始重写')

  for (const d of [repo, dirtyRepo, shallowParent]) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) { /* 临时目录删不掉不影响结论 */ } }


  // ---------- D 组：客户端维护页两叶（五表单、多行文本解析、回包分类与真渲染） ----------
  const rwPageSrc = sourceText('src/client/views/versionControl/vcRewritePage.ts')
  const rwOpsSrc = sourceText('src/client/views/versionControl/vcRewriteOps.ts')
  const rwYamlSrc = sourceText('config/copy/vcrewrite.yaml')
  const rwLocaleText = localeDataText()
  const rwClientBody = [
    spliceableJs('src/shared/version-control/src/rewrite-ops.ts'),
    spliceableJs('src/shared/version-control/src/recovery-point.ts'),
    spliceableJs('src/client/views/versionControl/vcRewriteOps.ts'),
    spliceableJs('src/client/views/versionControl/vcRewritePage.ts'),
    'return {',
    '  VC_REWRITE_PHONES: VC_REWRITE_PHONES, VC_REWRITE_FORM_IDS: VC_REWRITE_FORM_IDS,',
    '  VC_REWRITE_FIELDS: VC_REWRITE_FIELDS, VC_REWRITE_FORM_DEFAULT: VC_REWRITE_FORM_DEFAULT,',
    '  VC_REWRITE_REASON_KEYS: VC_REWRITE_REASON_KEYS, vcRewriteFieldOf: vcRewriteFieldOf,',
    '  vcRewriteFieldLabelKeyOf: vcRewriteFieldLabelKeyOf, vcRewriteFieldHintKeyOf: vcRewriteFieldHintKeyOf,',
    '  vcRewriteLinesOf: vcRewriteLinesOf, vcRewriteRenamesOf: vcRewriteRenamesOf, vcRewriteReplacementsOf: vcRewriteReplacementsOf,',
    '  vcRewriteAuthorsOf: vcRewriteAuthorsOf, vcRewritePlanOf: vcRewritePlanOf, vcRewritePreviewArgsOf: vcRewritePreviewArgsOf,',
    '  vcRewriteCheckArgsOf: vcRewriteCheckArgsOf, vcRewriteRunArgsOf: vcRewriteRunArgsOf, vcRewriteRequestIdOf: vcRewriteRequestIdOf,',
    '  vcRewriteReplyKindOf: vcRewriteReplyKindOf, vcRewriteReasonOf: vcRewriteReasonOf, vcRewriteTicketOf: vcRewriteTicketOf,',
    '  vcRewriteCountRowsOf: vcRewriteCountRowsOf, vcRewriteBackupOf: vcRewriteBackupOf,',
    '  vcRewriteBackupSummaryOf: vcRewriteBackupSummaryOf, vcRewriteRestoreStepsOf: vcRewriteRestoreStepsOf,',
    '  vcRewriteTaskOf: vcRewriteTaskOf, vcRewriteTaskEndedOf: vcRewriteTaskEndedOf, vcRewriteProgressOf: vcRewriteProgressOf,',
    '  vcRewriteFailTextOf: vcRewriteFailTextOf, vcRewritePageNode: vcRewritePageNode,',
    '  REWRITE_FORMS: REWRITE_FORMS, REWRITE_PHONES: REWRITE_PHONES, rewritePlanOf: rewritePlanOf,',
    '  rewriteBackupPlanOf: rewriteBackupPlanOf, backupPointOf: backupPointOf, backupSummaryOf: backupSummaryOf,',
    '  backupRestoreStepsOf: backupRestoreStepsOf, humanBytesOf: humanBytesOf,',
    '  __nodes: { tabs: vcRewriteFormTabsNode, field: vcRewriteFieldNode, preview: vcRewritePreviewNode,',
    '    verdict: vcRewriteVerdictNode, confirm: vcRewriteConfirmNode, task: vcRewriteTaskNode, result: vcRewriteResultNode },',
    '};',
  ].join('\n')
  const rwFakeT = function (key, params) { return params ? String(key) + '(' + JSON.stringify(params) + ')' : String(key) }
  const rwFakeH = function (tag, props) {
    const bag = []
    for (let i = 2; i < arguments.length; i += 1) {
      const v = arguments[i]
      if (Array.isArray(v)) { for (let k = 0; k < v.length; k += 1) { if (v[k] !== null && v[k] !== undefined) bag.push(v[k]) } }
      else if (v !== null && v !== undefined) bag.push(v)
    }
    return { tag: tag, props: props || {}, children: bag }
  }
  const rwTipTag = function () { return null }
  const rwFakeReact = {
    createElement: rwFakeH,
    useState: function (init) { return [typeof init === 'function' ? init() : init, function () {}] },
    useEffect: function () {},
    useRef: function (v) { return { current: v } },
  }
  const rwLeaf = compileFn(['h', 't', 'React', 'Tip', 'setInterval', 'clearInterval'], rwClientBody)(rwFakeH, rwFakeT, rwFakeReact, rwTipTag, function () {}, function () {})
  const rwWalk = function (node, visit) {
    if (node === null || node === undefined) return
    if (typeof node !== 'object') { visit(node); return }
    visit(node)
    const kids = Array.isArray(node.children) ? node.children : []
    for (let i = 0; i < kids.length; i += 1) rwWalk(kids[i], visit)
  }
  const rwFind = function (root, pred) {
    const out = []
    rwWalk(root, function (n) { if (n && typeof n === 'object' && pred(n)) out.push(n) })
    return out
  }
  const rwText = function (root) { let s = ''; rwWalk(root, function (n) { if (typeof n === 'string') s += n }); return s }
  const rwProp = function (node, name) { return node && node.props ? node.props[name] : undefined }
  const rwAllNodes = function (root) { return rwFind(root, function () { return true }) }

  eq(JSON.stringify(rwLeaf.VC_REWRITE_PHONES), JSON.stringify({ preview: 'wf.gitRewritePreview', check: 'wf.gitRewriteCheck', run: 'wf.gitRewriteRun', query: 'wf.gitTaskQuery', cancel: 'wf.gitTaskCancel' }), 'D1 维护页五条电话逐条对上')
  eq(rwLeaf.VC_REWRITE_PHONES.preview, rwLeaf.REWRITE_PHONES.preview, 'D2 预览电话与共享协议同一份名字')
  eq(rwLeaf.VC_REWRITE_PHONES.check, rwLeaf.REWRITE_PHONES.check, 'D3 预检电话与共享协议同一份名字')
  eq(rwLeaf.VC_REWRITE_PHONES.run, rwLeaf.REWRITE_PHONES.run, 'D4 执行电话与共享协议同一份名字')
  eq(rwLeaf.VC_REWRITE_FORM_IDS.join(','), rwLeaf.REWRITE_FORMS.map(function (f) { return f.id }).join(','), 'D5 五张表单顺序与共享层逐条一致')
  eq(rwLeaf.VC_REWRITE_FORM_IDS.length, 5, 'D6 表单数正好五张')
  const rwFieldPairs = rwLeaf.REWRITE_FORMS.map(function (f) { return f.id + '=' + rwLeaf.VC_REWRITE_FIELDS[f.id] }).join(',')
  eq(rwFieldPairs, 'remove-paths=paths,rename-paths=renames,rewrite-authors=authors,remove-large=threshold,replace-text=replacements', 'D7 每张表单只开自己那一格')
  eq(rwLeaf.vcRewriteFieldOf('remove-large'), 'threshold', 'D8 按表单取字段名')
  eq(rwLeaf.vcRewriteFieldOf('nope'), 'paths', 'D9 认不出的表单退回第一个字段')
  eq(rwLeaf.vcRewriteFieldLabelKeyOf('paths'), 'vc.rewrite.field.paths', 'D10 字段标签词条键')
  eq(rwLeaf.vcRewriteFieldHintKeyOf('paths'), 'vc.rewrite.field.pathsHint', 'D11 字段填写提示词条键')
  eq(rwLeaf.vcRewriteLinesOf(' a \n\n b\r\nc ').join(','), 'a,b,c', 'D12 多行文本去空行去两端空白')
  eq(JSON.stringify(rwLeaf.vcRewriteRenamesOf('a.txt => b.txt\nold/x => new/x')), JSON.stringify([{ from: 'a.txt', to: 'b.txt' }, { from: 'old/x', to: 'new/x' }]), 'D13 重命名逐行解析')
  eq(rwLeaf.vcRewriteRenamesOf('a.txt'), null, 'D14 缺箭头的重命名整张不提交')
  eq(rwLeaf.vcRewriteRenamesOf('a.txt => '), null, 'D15 缺新名字的重命名整张不提交')
  eq(JSON.stringify(rwLeaf.vcRewriteReplacementsOf('secret => ***\ntoken =>')), JSON.stringify([{ from: 'secret', to: '***' }, { from: 'token', to: '' }]), 'D16 字面量替换允许把右侧留空')
  eq(rwLeaf.vcRewriteReplacementsOf('=> x'), null, 'D17 空原文的替换整张不提交')
  eq(JSON.stringify(rwLeaf.vcRewriteAuthorsOf('张三 <new@example.com>\n李四 <li@example.com> | 李四 <old@example.com>')), JSON.stringify([{ name: '张三', email: 'new@example.com' }, { name: '李四', email: 'li@example.com', oldName: '李四', oldEmail: 'old@example.com' }]), 'D18 作者改写两种写法都解析')
  eq(rwLeaf.vcRewriteAuthorsOf('只有名字'), null, 'D19 缺邮箱的作者行整张不提交')
  const rwDefaultPlan = rwLeaf.vcRewritePlanOf(rwLeaf.VC_REWRITE_FORM_DEFAULT)
  eq(Object.keys(rwDefaultPlan).join(','), 'op,form,paths,renames,authors,threshold,replacements', 'D20 表单初值能直接出计划且键序固定')
  const rwRenamePlan = rwLeaf.vcRewritePlanOf({ form: 'rename-paths', renamesText: 'a => b' })
  eq(JSON.stringify(rwRenamePlan.renames), JSON.stringify([{ from: 'a', to: 'b' }]), 'D21 重命名表单的值进了计划')
  eq(rwLeaf.vcRewritePlanOf({ form: 'rename-paths', renamesText: 'a' }), null, 'D22 坏文本回 null 且不发电话')
  eq(JSON.stringify(rwLeaf.vcRewritePreviewArgsOf('C:/repo', { form: 'remove-paths', pathsText: 'secret' }).plan.paths), JSON.stringify(['secret']), 'D23 预览参数带工作区与计划')
  eq(rwLeaf.vcRewriteCheckArgsOf('C:/repo', { form: 'remove-paths', pathsText: 'secret' }).cwd, 'C:/repo', 'D24 预检参数带工作区')
  const rwRunArgs = rwLeaf.vcRewriteRunArgsOf('C:/repo', 'tk1', 'req1')
  eq(rwRunArgs.confirmed, true, 'D25 执行参数带显式确认')
  eq(rwRunArgs.ticketId + '/' + rwRunArgs.requestId, 'tk1/req1', 'D26 执行参数带票号与请求号')
  const rwReqId = rwLeaf.vcRewriteRequestIdOf(1700000000000, 'C:/repo')
  check(/^[A-Za-z0-9_-]{1,64}$/.test(rwReqId) && rwReqId.charAt(0) === 'w', 'D27 请求号形状能被宿主接受')
  check(rwLeaf.vcRewriteRequestIdOf(1700000000000, 'C:/repo !').slice(-5) === 'Crepo', 'D28 请求号把盐里不合法字符清掉')
  eq(rwLeaf.vcRewriteReplyKindOf({ ok: true, preview: { counts: {} } }), 'previewed', 'D29 预览成功分类')
  eq(rwLeaf.vcRewriteReplyKindOf({ ok: true, confirm: { what: [] }, ticket: { id: 't' } }), 'checked', 'D30 预检签票分类')
  eq(rwLeaf.vcRewriteReplyKindOf({ ok: true, task: { taskId: 't1' } }), 'running', 'D31 任务已起分类')
  eq(rwLeaf.vcRewriteReplyKindOf({ ok: true, reused: true, result: {} }), 'done', 'D32 重放回上次结果分类')
  eq(rwLeaf.vcRewriteReplyKindOf({ ok: false, reason: 'ticket-expired' }), 'stale', 'D33 票据过期归刷新那一档')
  eq(rwLeaf.vcRewriteReplyKindOf({ ok: false, reason: 'need-confirm' }), 'need-confirm', 'D34 需要确认单独一档')
  eq(rwLeaf.vcRewriteReplyKindOf({ ok: false, error: { kind: 'blocked', reason: 'dirty-worktree' }, decision: { verdict: 'block' } }), 'blocked', 'D35 现场不放行归 blocked')
  eq(rwLeaf.vcRewriteReplyKindOf({ ok: false, error: { kind: 'git-failed', reason: 'backup-failed' } }), 'fail', 'D36 执行失败归 fail')
  eq(rwLeaf.vcRewriteReasonOf({ error: { reason: 'tool-missing', kind: 'blocked' } }), 'tool-missing', 'D37 失败理由先读 error.reason')
  eq(rwLeaf.vcRewriteReasonOf({ ok: false, error: { kind: 'args' } }), 'args', 'D38 没有 reason 时退回 error.kind')
  eq(rwLeaf.vcRewriteTicketOf({ ticket: { id: 'tk' } }).id, 'tk', 'D39 票号从回包取出')
  const rwRows = rwLeaf.vcRewriteCountRowsOf({ commits: 3, matchedCommits: null, matchedPaths: 2, thresholdBytes: null, replacementHits: [{ from: 'secret', commits: 1 }] })
  eq(rwRows.map(function (r) { return r.key + '=' + r.value }).join(','), 'vc.rewrite.counts.commits=3,vc.rewrite.counts.matchedPaths=2,vc.rewrite.counts.replacementHit=1', 'D40 预览计数空值不画、命中逐条画')
  const rwPoint = { kind: 'mirror', required: true, path: 'C:/backup-x', bytes: 1048576, estimateBytes: 1048576, repoSizeBytes: 1048576, elapsedMs: 12, atMs: 5 }
  check(rwLeaf.vcRewriteBackupSummaryOf({ backup: rwPoint }).indexOf('C:/backup-x') >= 0, 'D41 备份摘要带路径')
  check(rwLeaf.vcRewriteBackupSummaryOf({ backup: rwPoint }).indexOf('1.0 MB') >= 0, 'D42 备份摘要用人读的大小')
  eq(rwLeaf.vcRewriteRestoreStepsOf({ backup: rwPoint }).length, 3, 'D43 还原步骤三条')
  check(rwLeaf.vcRewriteRestoreStepsOf({ backup: rwPoint })[0].indexOf('git clone C:/backup-x') === 0, 'D44 还原第一步是真命令')
  eq(rwLeaf.vcRewriteBackupOf({ backupPoint: rwPoint }).path, 'C:/backup-x', 'D45 备份点两种字段名都认')
  const rwTask = { taskId: 't-1', state: 'running', phase: 'Receiving objects', percent: 42 }
  eq(rwLeaf.vcRewriteTaskOf({ tasks: [{ taskId: 'x' }, rwTask] }, 't-1').taskId, 't-1', 'D46 按任务号从清单里找')
  eq(rwLeaf.vcRewriteTaskEndedOf(rwTask), false, 'D47 在途任务没结束')
  eq(rwLeaf.vcRewriteTaskEndedOf({ state: 'done', conclusion: 'succeeded' }), true, 'D48 有结论才算结束')
  const rwProgress = rwLeaf.vcRewriteProgressOf(rwTask)
  eq(rwProgress.percent + '/' + rwProgress.uncertain, '42/false', 'D49 真实百分比原样显示')
  const rwUncertain = rwLeaf.vcRewriteProgressOf({ state: 'running' })
  eq(rwUncertain.percent + '/' + rwUncertain.uncertain, 'null/true', 'D50 报不出百分比时标不确定')
  check(rwLeaf.vcRewriteFailTextOf(rwFakeT, { ok: false, reason: 'backup-failed' }).indexOf('vc.rewrite.reason.backupFailed') >= 0, 'D51 失败话术走固定词条而不是标识符')
  check(rwLeaf.vcRewriteFailTextOf(rwFakeT, { ok: false, error: { kind: 'noise' } }).indexOf('vc.rewrite.reason.unknown') >= 0, 'D52 认不出的失败退回 unknown 词条')

  // 真渲染：默认状态的维护页（表单、只读说明、预览按钮、输入格）
  const rwPageNode = rwLeaf.vcRewritePageNode({ t: rwFakeT, cwd: 'C:/repo', call: function () { return Promise.reject(new Error('no-call')) } })
  eq(rwProp(rwPageNode, 'data-vc-rewrite-page'), '1', 'D53 页面根节点带页标记')
  eq(rwProp(rwPageNode, 'data-vc-rewrite-form'), 'remove-paths', 'D54 默认停第一张表单')
  eq(rwProp(rwPageNode, 'data-vc-rewrite-plan'), '1', 'D55 初值能出计划（预览按钮可点）')
  const rwTabs = rwFind(rwPageNode, function (n) { return rwProp(n, 'data-vc-rewrite-form') !== undefined && n.tag === 'button' })
  eq(rwTabs.length, 5, 'D56 五张表单各一个入口')
  eq(rwTabs.filter(function (n) { return rwProp(n, 'data-vc-rewrite-form-current') === '1' }).length, 1, 'D57 当前表单只标一个')
  const rwFilterBranch = rwFind(rwPageNode, function (n) { return rwProp(n, 'data-vc-rewrite-filter-branch') === 'readonly' })[0]
  check(!!rwFilterBranch, 'D58 filter-branch 只读说明块在')
  eq(rwFind(rwFilterBranch, function (n) { return n.tag === 'button' }).length, 0, 'D59 只读说明块里没有任何按钮')
  eq(rwProp(rwFind(rwFilterBranch, function (n) { return rwProp(n, 'data-vc-rewrite-filter-branch-command') !== undefined })[0], 'data-vc-rewrite-filter-branch-command'), 'git filter-branch', 'D60 只读块给出命令原文')
  const rwFieldNodes = rwFind(rwPageNode, function (n) { return rwProp(n, 'data-vc-rewrite-field') !== undefined })
  eq(rwFieldNodes.length, 1, 'D61 一张表单只显示一格输入')
  eq(rwFieldNodes[0].tag, 'textarea', 'D62 路径表单用多行输入框')
  eq(rwProp(rwFieldNodes[0], 'data-vc-rewrite-field'), 'paths', 'D63 输入格标着字段名')
  check(rwFind(rwPageNode, function (n) { return rwProp(n, 'data-vc-rewrite-preview') === '1' && n.tag === 'button' }).length === 1, 'D64 影响预览按钮在')
  const rwPreviewBtn = rwFind(rwPageNode, function (n) { return rwProp(n, 'data-vc-rewrite-preview') === '1' })[0]
  eq(rwProp(rwPreviewBtn, 'disabled'), false, 'D65 计划有效时预览按钮可用')
  eq(rwFind(rwPageNode, function (n) { return rwProp(n, 'data-vc-rewrite-confirm') === '1' }).length, 0, 'D66 还没签票时确认卡不出现')

  // 直接画各个状态块：预览、判定、四段确认卡、任务、结果
  eq(rwLeaf.__nodes.preview(rwFakeH, rwFakeT, { preview: null }), null, 'D67 没有预览时整块不出现')
  const rwPreviewNode = rwLeaf.__nodes.preview(rwFakeH, rwFakeT, { preview: { ok: true, preview: { counts: { commits: 3, matchedPaths: 2 }, command: 'git filter-repo --force --path x' } } })
  eq(rwFind(rwPreviewNode, function (n) { return rwProp(n, 'data-vc-rewrite-count') !== undefined }).length, 2, 'D68 预览计数逐行画')
  check(rwText(rwFind(rwPreviewNode, function (n) { return rwProp(n, 'data-vc-rewrite-command') === '1' })[0]).indexOf('git filter-repo') >= 0, 'D69 预览给命令原文')
  const rwVerdictNode = rwLeaf.__nodes.verdict(rwFakeH, rwFakeT, { ok: false, error: { kind: 'blocked', reason: 'dirty-worktree' }, decision: { verdict: 'block' } })
  eq(rwProp(rwVerdictNode, 'data-vc-rewrite-check'), 'blocked', 'D70 判定形状挂在块上')
  check(rwText(rwVerdictNode).indexOf('vc.rewrite.verdict.blocked') >= 0, 'D71 判定说人话不是标识符')
  const rwConfirmCheck = { ok: true, confirm: { what: ['全部提交号会变'], wont: ['不自动恢复'], reversible: true, verb: ['点确认后先备份'] }, backup: { kind: 'mirror', path: 'C:/backup-x', estimateBytes: 1048576, repoSizeBytes: 1048576 } }
  const rwConfirmNode = rwLeaf.__nodes.confirm(rwFakeH, rwFakeT, { check: rwConfirmCheck, onConfirm: function () {}, onCancel: function () {} })
  const rwSegs = rwFind(rwConfirmNode, function (n) { return rwProp(n, 'data-vc-rewrite-confirm-seg') !== undefined }).map(function (n) { return rwProp(n, 'data-vc-rewrite-confirm-seg') })
  eq(rwSegs.join(','), 'what,wont,reversible,verb', 'D72 确认卡四段齐全')
  const rwBackupNode = rwFind(rwConfirmNode, function (n) { return rwProp(n, 'data-vc-rewrite-backup') !== undefined })[0]
  eq(rwProp(rwBackupNode, 'data-vc-rewrite-backup-path'), 'C:/backup-x', 'D73 确认卡写明备份在哪')
  eq(rwProp(rwBackupNode, 'data-vc-rewrite-backup-size'), '1048576', 'D74 确认卡写明备份预计多大')
  eq(rwProp(rwFind(rwConfirmNode, function (n) { return rwProp(n, 'data-vc-rewrite-restore') !== undefined })[0], 'data-vc-rewrite-restore'), '3', 'D75 确认卡列出三条还原步骤')
  const rwCancel = rwFind(rwConfirmNode, function (n) { return rwProp(n, 'data-vc-rewrite-confirm-cancel') === '1' })
  const rwGo = rwFind(rwConfirmNode, function (n) { return rwProp(n, 'data-vc-rewrite-confirm-go') === '1' })
  eq(rwCancel.length + rwGo.length, 2, 'D76 确认卡有取消与确认两颗按钮')
  eq(rwProp(rwCancel[0], 'data-focus-default'), 'cancel', 'D77 取消是默认落点')
  check(rwFind(rwConfirmNode, function (n) { return n.tag === rwTipTag }).length >= 1, 'D78 危险确认按钮包了悬停提示')
  const rwTaskRun = rwLeaf.__nodes.task(rwFakeH, rwFakeT, { task: { taskId: 't-1', state: 'running', phase: 'Receiving', percent: null }, onCancel: function () {} })
  eq(rwProp(rwFind(rwTaskRun, function (n) { return rwProp(n, 'data-vc-rewrite-task') !== undefined })[0], 'data-vc-rewrite-task'), 't-1', 'D79 任务块带任务号')
  eq(rwProp(rwFind(rwTaskRun, function (n) { return rwProp(n, 'data-vc-rewrite-task') !== undefined })[0], 'data-vc-rewrite-task-percent'), '', 'D80 报不出百分比时进度留空')
  eq(rwFind(rwTaskRun, function (n) { return rwProp(n, 'data-vc-rewrite-task-cancel') === '1' }).length, 1, 'D81 在途任务有取消按钮')
  const rwTaskDone = rwLeaf.__nodes.task(rwFakeH, rwFakeT, { task: { taskId: 't-2', state: 'failed', conclusion: 'failed', residual: '一半历史已被改写' }, onCancel: function () {} })
  check(rwText(rwTaskDone).indexOf('vc.rewrite.conclusion.failed') >= 0, 'D82 结束任务画结论')
  eq(rwFind(rwTaskDone, function (n) { return rwProp(n, 'data-vc-rewrite-task-cancel') === '1' }).length, 0, 'D83 结束任务不再给取消')
  check(rwText(rwTaskDone).indexOf('一半历史已被改写') >= 0, 'D84 取消残留如实转述')
  const rwResultOk = rwLeaf.__nodes.result(rwFakeH, rwFakeT, { result: { ok: true, backup: rwPoint }, onRetry: function () {} })
  eq(rwProp(rwResultOk, 'data-vc-rewrite-result'), '1', 'D85 成功结果标成功')
  check(rwText(rwResultOk).indexOf('C:/backup-x') >= 0, 'D86 成功结果给出备份摘要')
  const rwResultFail = rwLeaf.__nodes.result(rwFakeH, rwFakeT, { result: { ok: false, reason: 'backup-failed' }, onRetry: function () {} })
  eq(rwProp(rwResultFail, 'data-vc-rewrite-result'), '0', 'D87 失败结果标失败')
  eq(rwFind(rwResultFail, function (n) { return rwProp(n, 'data-vc-rewrite-retry') === '1' }).length, 1, 'D88 失败给重试按钮')
  check(rwText(rwResultFail).indexOf('vc.rewrite.reason.backupFailed') >= 0, 'D89 失败话术走固定词条')

  // 点击日志纪律：所有可点控件都有 data-press 与唯一的 data-log（小写字母数字点横线）
  const rwClickables = []
  const rwCollectAttrs = function (root) {
    rwWalk(root, function (n) {
      if (!n || typeof n !== 'object') return
      const p = n.props || {}
      if (typeof p.onclick === 'function' || typeof p.onClick === 'function') rwClickables.push(p)
    })
  }
  ;[rwPageNode, rwConfirmNode, rwTaskRun, rwResultFail, rwResultOk].forEach(rwCollectAttrs)
  check(rwClickables.length >= 5, 'D90 渲染里确实有可点控件（实得 ' + String(rwClickables.length) + ' 个）')
  check(rwClickables.every(function (p) { return typeof p['data-press'] === 'string' && p['data-press'] !== '' }), 'D91 每个可点控件都有 data-press')
  const rwLogs = rwClickables.map(function (p) { return String(p['data-log'] || '') })
  check(rwLogs.every(function (x) { return /^[a-z0-9._-]+$/.test(x) }), 'D92 每个 data-log 都是小写字母数字点横线下划线（实得 ' + rwLogs.join(',') + '）')
  check(new Set(rwLogs).size >= 5, 'D93 这套渲染里至少五条不同的点击日志（实得 ' + String(new Set(rwLogs).size) + '）')

  // 源码纪律：两叶除注释外不许有中文字面量
  check(!/[\u4e00-\u9fff]/.test(stripComments(rwPageSrc)), 'D94 页面叶子除注释外没有中文字面量')
  check(!/[\u4e00-\u9fff]/.test(stripComments(rwOpsSrc)), 'D95 动作叶子除注释外没有中文字面量')

  // 词条真源：88 键、中英同键、都进生成物、页面静态键全在真源里
  const rwYamlLines = rwYamlSrc.split(/\r?\n/)
  const rwEnAt = rwYamlLines.findIndex(function (line) { return line === 'en:' })
  check(rwEnAt > 0, 'D96 词表分中英两段')
  const rwKeyOf = function (line) { const m = /^  ([A-Za-z0-9_.-]+):/.exec(line); return m ? m[1] : '' }
  const rwZhKeys = rwYamlLines.slice(0, rwEnAt).map(rwKeyOf).filter(function (k) { return k !== '' })
  const rwEnKeys = rwYamlLines.slice(rwEnAt + 1).map(rwKeyOf).filter(function (k) { return k !== '' })
  eq(rwZhKeys.length >= 88, true, 'D97 中文词条至少八十八条（实得 ' + String(rwZhKeys.length) + '）')
  eq(rwZhKeys.join(','), rwEnKeys.join(','), 'D98 中英两份键集合与顺序一字不差')
  const rwMissingLocale = rwZhKeys.filter(function (k) { return rwLocaleText.indexOf("'" + k + "'") < 0 })
  eq(rwMissingLocale.length, 0, 'D99 每一条词条都进了生成物（缺 ' + rwMissingLocale.join(',') + '）')
  const rwFiveForms = rwLeaf.REWRITE_FORMS.map(function (f) { return f.labelKey })
  eq(rwFiveForms.filter(function (k) { return rwZhKeys.indexOf(k) < 0 }).length, 0, 'D100 五张表单的标题都有词条')
  const rwFiveFields = ['paths', 'renames', 'authors', 'threshold', 'replacements']
  eq(rwFiveFields.filter(function (f) { return rwZhKeys.indexOf('vc.rewrite.field.' + f) < 0 || rwZhKeys.indexOf('vc.rewrite.field.' + f + 'Hint') < 0 }).length, 0, 'D101 五个字段的标签与提示都有词条')
  eq(Object.keys(rwLeaf.VC_REWRITE_REASON_KEYS).filter(function (r) { return rwZhKeys.indexOf(rwLeaf.VC_REWRITE_REASON_KEYS[r]) < 0 }).length, 0, 'D102 二十五条失败理由都有词条')
  const rwStaticKeys = []
  const rwCatch = function (src, re) { let m = re.exec(src); while (m) { rwStaticKeys.push(m[1]); m = re.exec(src) } }
  rwCatch(rwPageSrc + '\n' + rwOpsSrc, /'(vc\.rewrite\.[A-Za-z0-9_.]+)'/g)
  // 这两条是点击日志（data-log），不是词条键；它们也被正则捕获，从词条对账里排掉。
  const rwLogKeys = ['vc.rewrite.form', 'vc.rewrite.retry']
  const rwStaticNow = rwStaticKeys.filter(function (k) { return k.charAt(k.length - 1) !== '.' && rwLogKeys.indexOf(k) < 0 })
  const rwStaticMissing = rwStaticNow.filter(function (k) { return rwZhKeys.indexOf(k) < 0 })
  eq(rwStaticMissing.join(','), '', 'D103 两叶写死的词条键全在真源里（缺 ' + rwStaticMissing.join(',') + '）')
  check(rwZhKeys.indexOf('vc.rewrite.verdict.allow') >= 0 && rwZhKeys.indexOf('vc.rewrite.conclusion.interrupted') >= 0, 'D104 判定与四类结论的词条都在')

  // 与能力账本对账：5.11 一条，主入口管理·维护，页面 maintenance；5.12/5.13 不归本页
  const rwLedger = await loadModule('src/shared/version-control/src/capability-ledger.js')
  const rwReconcile = function (forms, caps) {
    const problems = []
    const target = caps.filter(function (c) { return c.id === '5.11' })[0]
    if (!target) problems.push('missing-5.11')
    forms.forEach(function (f) {
      if (f.capId !== '5.11') problems.push('cap:' + f.id)
      if (!target) return
      if (target.page !== 'maintenance') problems.push('page:' + f.id)
      if (target.primaryEntry !== '管理·维护') problems.push('entry:' + f.id)
    })
    return problems
  }
  eq(rwReconcile(rwLeaf.REWRITE_FORMS, rwLedger.CAPABILITIES).length, 0, 'D105 五张表单与账本 5.11 对账零缺口')
  const rwCap511 = rwLedger.CAPABILITIES.filter(function (c) { return c.id === '5.11' })[0]
  eq(rwCap511.command, 'git filter-branch', 'D106 账本 5.11 的命令原文是 filter-branch')
  check(String(rwCap511.panelPath).indexOf('filter-repo') >= 0, 'D107 账本写明面板改用 filter-repo 五张表单')
  check(String(rwCap511.panelPath).indexOf('只读') >= 0, 'D108 账本写明 filter-branch 本体只读')
  eq(rwLedger.CAPABILITIES.filter(function (c) { return c.id === '5.12' || c.id === '5.13' }).filter(function (c) { return c.page === 'maintenance' }).length, 0, 'D109 5.12/5.13 不归维护页（本票不吸收别的票）')
  const rwCorrupted = rwLeaf.REWRITE_FORMS.map(function (f) { return Object.assign({}, f, { capId: '5.9' }) })
  check(rwReconcile(rwCorrupted, rwLedger.CAPABILITIES).indexOf('cap:remove-paths') >= 0, 'D110 反证：把一条表单挂到别的能力上，对账当场报错')
  const rwNoEntry = rwLedger.CAPABILITIES.map(function (c) { return c.id === '5.11' ? Object.assign({}, c, { page: 'diagnostics' }) : c })
  check(rwReconcile(rwLeaf.REWRITE_FORMS, rwNoEntry).indexOf('page:remove-paths') >= 0, 'D111 反证：账本页面被改走，对账当场报错')

  // ---------- E 组：七个登记点、装配扇入与源码断言（含反证） ----------
  const mountSrc = sourceText('src/host/versionControlRewriteMount.ts')
  const parentSrc = sourceText('src/host/versionControl.ts')
  const entrySrc = sourceText('src/host/index.ts')
  const sceneSrc = sourceText('src/host/versionControlRewriteScene.ts')
  const checkSrc = sourceText('src/host/versionControlRewriteCheck.ts')
  const writeSrc = sourceText('src/host/versionControlRewriteWrite.ts')
  const shellSrc = sourceText('src/client/views/versionControl/vcShellPages.ts')
  const buildSrc = sourceText('scripts/build.mts')
  const indexSrc = sourceText('src/client/index.ts')
  const settingsSrc = sourceText('tests/verify-settings-phones.ts')
  const timeoutsSrc = sourceText('config/timeouts.yaml')
  const genSrc = sourceText('scripts/generate-time-config.mts')
  const verifyTimeSrc = sourceText('tests/verify-time-config.ts')
  const portsSrc = sourceText('src/shared/version-control/src/ports.ts')

  function countOf(text: any, needle: any): number { return String(text).split(String(needle)).length - 1 }

  check(mountSrc.indexOf('export function createRewriteMount') >= 0, 'E1 装配壳导出 createRewriteMount')
  eq(['versionControlRewriteScene.js', 'versionControlRewriteCheck.js', 'versionControlRewriteWrite.js'].filter(function (x) { return mountSrc.indexOf(x) >= 0 }).length, 3, 'E2 装配壳把现场、预检、执行三片都装起来')
  const mountPhones = ['wf.gitRewritePreview', 'wf.gitRewriteCheck', 'wf.gitRewriteRun']
  eq(mountPhones.filter(function (x) { return mountSrc.indexOf(x) >= 0 }).length, 3, 'E3 装配壳注册三条电话')
  check(mountSrc.indexOf('loggedPhone') >= 0 && mountSrc.indexOf('装配失败') >= 0, 'E4 装配失败时有明确失败电话而不是静默')
  eq(['createRewriteMount(', 'handleGitRewritePreview: rewrites.preview', 'handleGitRewriteCheck: rewrites.check', 'handleGitRewriteRun: rewrites.run', 'rewriteTickets: rewrites.tickets'].filter(function (x) { return parentSrc.indexOf(x) >= 0 }).length, 5, 'E5 父层把装配壳接进宿主对象（含只给门禁的票表读数口）')
  eq(['wf.gitRewritePreview', 'wf.gitRewriteCheck', 'wf.gitRewriteRun'].filter(function (x) { return countOf(entrySrc, "'" + x + "'") === 1 }).length, 3, 'E6 宿主入口三条注册各一次')
  eq(countOf(parentSrc, 'createRewriteMount('), 1, 'E7 装配壳在父层只创建一次')
  check(entrySrc.split('\n').length - 1 <= 400, 'E8 宿主入口物理行不超过四百（实测 ' + String(entrySrc.split('\n').length - 1) + '）')
  has(settingsSrc, 'check(nPhones === 110', 'E9 宿主电话总数登记到一百一十条（合并集成分支后随并行票一起涨）')
  has(settingsSrc, '#1750', 'E10 电话计数的历史注释记下本票这次加三条')
  has(timeoutsSrc, 'vcRewriteReadTimeoutMs: 15000', 'E11 时间配置有读命令超时键')
  has(timeoutsSrc, 'vcRewriteWriteTimeoutMs: 600000', 'E12 时间配置有备份命令超时键（单条十分钟）')
  eq(countOf(genSrc, "'vcRewriteReadTimeoutMs'") + countOf(genSrc, "'vcRewriteWriteTimeoutMs'"), 2, 'E13 时间常量生成器登记两键')
  check(verifyTimeSrc.indexOf('versionControlRewriteScene.ts') >= 0 && verifyTimeSrc.indexOf('versionControlRewriteWrite.ts') >= 0, 'E14 时间配置门禁登记两处使用点')
  has(sceneSrc, 'VC_REWRITE_READ_TIMEOUT_MS', 'E15 现场读数层用读命令超时常量')
  has(writeSrc, 'VC_REWRITE_WRITE_TIMEOUT_MS', 'E16 执行层用备份命令超时常量')
  const reasonsMod = await loadModule('src/shared/version-control/src/write-reasons.js')
  const rwNewReasons = ['tool-missing', 'shallow-repo', 'dirty-worktree', 'bad-form', 'bad-rename', 'bad-identity', 'bad-threshold', 'bad-replacement', 'too-many-items', 'backup-failed', 'backup-unreadable', 'temp-unavailable', 'task-start-failed']
  const rwUnknownHint = String(reasonsMod.writeHintFor('unknown-write-failure'))
  eq(rwNewReasons.filter(function (r) { return String(reasonsMod.writeHintFor(r)) === rwUnknownHint }).length, 0, 'E17 十三条新理由都有各自的失败话术（不是兜底那句）')
  eq(rwNewReasons.filter(function (r) { return String(reasonsMod.WRITE_REASONS[r] || '').length > 8 }).length, 13, 'E18 十三条新理由都在理由表里且写得能照着做')
  eq(['child_process', '.spawn('].filter(function (x) { return [sceneSrc, checkSrc, writeSrc, mountSrc].some(function (s) { return s.indexOf(x) >= 0 }) }).length, 0, 'E19 四片宿主叶子都不自己起进程（只经注入的 runPinned）')
  check(writeSrc.indexOf('.taskStart(') > writeSrc.indexOf('runBackup('), 'E20 执行层先备份、备份成功之后才起重写任务')
  check(writeSrc.indexOf('backup-failed') >= 0 && writeSrc.indexOf('task-start-failed') >= 0, 'E21 备份失败与任务起不来是两种明确失败')
  has(writeSrc, 'ticket.backup', 'E22 执行层用票里的备份路径（预检时定下、执行时不再自己换路径）')
  const fr = await loadModule('src/shared/version-control/src/filter-repo-args.js')
  const frOk = fr.filterRepoArgs(['--invert-paths', '--path', 'secret'])
  eq(frOk.ok, true, 'E23 filter-repo 语法接受带值选项')
  eq(String(frOk.args && frOk.args.join('|')), '--invert-paths|--path|secret', 'E24 filter-repo 语法保留独立参数（不拼成一条 shell 字符串）')
  eq(fr.filterRepoArgs(['--exec', 'rm -rf']).ok, false, 'E25 未登记的破坏性开关被拒')
  eq(fr.filterRepoArgs(['--path', 'C:/repo/x']).reason, 'bad-path', 'E26 绝对路径被拒')
  eq(fr.filterRepoArgs(['--strip-blobs-bigger-than', '10M']).ok, true, 'E27 大小阈值放行')
  eq(fr.filterRepoArgs(['--strip-blobs-bigger-than', '10MB']).ok, false, 'E28 坏阈值被拒')
  has(sourceText('src/shared/version-control/src/task-protocol.ts'), "from './filter-repo-args.js'", 'E29 长任务协议层用这份语法（不自己另写一套）')
  const proto = await loadModule('src/shared/version-control/src/task-protocol.js')
  check(proto.TASK_OPS.some(function (o: any) { return o.id === 'filter-repo' }), 'E30 长任务清单里 filter-repo 仍在（本票没删别的票的东西）')
  const baseline = JSON.parse(sourceText('tests/same-layer-baseline.json'))
  const baselineText = (baseline.entries || []).map(function (e: any) { return String(e.file) + '|' + String(e.spec) + '|' + String(e.resolved) }).join('\n')
  eq(['versionControlRewriteMount', 'versionControlRewriteScene', 'versionControlRewriteCheck', 'versionControlRewriteWrite', 'filter-repo-args'].filter(function (f) { return baselineText.indexOf(f) >= 0 }).length, 5, 'E31 同层引用基线登记了本票五处新引用')
  check(shellSrc.indexOf("page === 'maintenance'") >= 0 && countOf(shellSrc, 'vcRewritePageNode') >= 2, 'E32 维护页把重写面板挂进页面壳（声明一次、挂载一次）')
  check(buildSrc.indexOf("id: 'vcRewriteOps'") >= 0 && buildSrc.indexOf("id: 'vcRewritePage'") >= 0, 'E33 构建登记两片客户端叶子')
  check(buildSrc.indexOf('shared:vcRewriteOps') >= 0 && buildSrc.indexOf('shared:vcRecoveryPoint') >= 0, 'E34 构建把共享协议与备份点拼进界面闭包')
  eq(['leaf:vcRewriteOps', 'leaf:vcRewritePage', 'shared:vcRewriteOps', 'shared:vcRecoveryPoint'].filter(function (m) { return countOf(indexSrc, m) === 1 }).length, 4, 'E35 界面入口四个拼装标记各出现一次')
  has(portsSrc, "export type WriteOp = 'commit' | 'pull' | 'push' | 'fetch' | ChangesWriteOp", 'E36 本票没有扩共享 WriteOp 联合类型（七登记点门禁按精确记号断言）')
  has(fs.readFileSync(__filename, 'utf8').split('\n')[0], '// 门禁归属: src/shared/version-control/src/rewrite-ops.ts', 'E37 门禁文件头写明归属源码')
  function rwMountProblems(text: any): string[] {
    const problems: string[] = []
    if (String(text).indexOf('export function createRewriteMount') < 0) problems.push('no-export')
    mountPhones.forEach(function (name) { if (String(text).indexOf(name) < 0) problems.push('missing-phone:' + name) })
    return problems
  }
  eq(rwMountProblems(mountSrc).length, 0, 'E38 装配壳对账零缺口')
  eq(rwMountProblems(mountSrc.replace('wf.gitRewriteRun', 'wf.gitRewriteExecute')).join(','), 'missing-phone:wf.gitRewriteRun', 'E39 反证：把一条电话名改错，对账当场报错')
  console.log('  E 组完成：' + total + ' 条')

  await printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) {
  console.log('  FAIL 门禁自身抛错：' + (e && e.stack ? e.stack : String(e)))
  failed += 1
  printGateResult(GATE, total, failed)
  process.exit(1)
})
