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

  const removePlan = ops.rewritePlanOf({ form: 'remove-paths', paths: ['a', 'b/c'] })
  eq(ops.rewriteTaskTokensOf('remove-paths', removePlan).tokens.join(' '), '--invert-paths --path a --path b/c', 'A73 删路径的任务参数逐个独立')
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
  has(ops.rewriteDisplayCommandOf('remove-paths', removePlan), 'git filter-repo --force', 'A80 界面上显示完整的 filter-repo 命令')
  has(ops.rewriteDisplayCommandOf('rewrite-authors', authorPlan), '面板生成', 'A81 临时文件位置用可读占位说明而不是编一个路径')

  const scene = { repoRoot: 'C:/repo', repoName: 'repo', freeBytes: 100000000000, repoSizeBytes: 1000000, nowMs: 1700000000000 }
  eq(ops.rewriteBackupPlanOf(scene).kind, 'mirror', 'A82 磁盘足够时用镜像克隆备份')
  eq(ops.rewriteBackupPlanOf({ repoRoot: 'C:/repo', freeBytes: 1000, repoSizeBytes: 1000000 }).kind, 'bundle', 'A83 磁盘不够时降级成整仓打包')
  has(ops.rewriteBackupPlanOf(scene).path, 'repo', 'A84 备份路径里带仓库名')
  eq(ops.rewriteBackupPlanOf(scene).required, true, 'A85 备份是强制前置')
  eq(ops.rewriteBackupPlanOf(scene).estimateBytes, 1000000, 'A86 镜像备份的估算大小就是仓库大小')

  eq(ops.rewriteGuardProblem({ filterRepoAvailable: false, shallow: false, dirty: false, operation: null, commitCount: 3 }, removePlan), 'tool-missing', 'A87 没装 filter-repo 时明确拒绝')
  eq(ops.rewriteGuardProblem({ filterRepoAvailable: true, shallow: true, dirty: false, operation: null, commitCount: 3 }, removePlan), 'shallow-repo', 'A88 浅克隆仓库拒绝')
  eq(ops.rewriteGuardProblem({ filterRepoAvailable: true, shallow: false, dirty: false, operation: 'merge', commitCount: 3 }, removePlan), 'operation-in-progress', 'A89 有进行中操作时拒绝')
  eq(ops.rewriteGuardProblem({ filterRepoAvailable: true, shallow: false, dirty: true, operation: null, commitCount: 3 }, removePlan), 'dirty-worktree', 'A90 工作区不干净时拒绝')
  eq(ops.rewriteGuardProblem({ filterRepoAvailable: true, shallow: false, dirty: false, operation: null, commitCount: 0 }, removePlan), 'nothing-to-do', 'A91 空仓库没有可重写的历史')
  eq(ops.rewriteGuardProblem({ filterRepoAvailable: true, shallow: false, dirty: false, operation: null, commitCount: 3 }, removePlan), null, 'A92 现场干净时放行')
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

  await printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) {
  console.log('  FAIL 门禁自身抛错：' + (e && e.stack ? e.stack : String(e)))
  failed += 1
  printGateResult(GATE, total, failed)
  process.exit(1)
})
