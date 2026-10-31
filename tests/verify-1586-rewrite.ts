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
const { sourceText } = require('./lib/source-text.ts')
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


  await printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) {
  console.log('  FAIL 门禁自身抛错：' + (e && e.stack ? e.stack : String(e)))
  failed += 1
  printGateResult(GATE, total, failed)
  process.exit(1)
})
