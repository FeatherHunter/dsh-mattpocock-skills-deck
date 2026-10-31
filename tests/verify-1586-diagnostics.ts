// tests/verify-1586-diagnostics.ts —— 诊断与底层命令（域 13 十三条 + 5.12 替换对象）的门禁（#1761 T25）
//
// 这扇门禁按票面「做完」逐条验：
//   A 组：共享层 diagnostics-commands.ts —— 十三条只读查询与七个写动作各自唯一的 argv 拼法、
//         参数白名单（危险字符与以 - 开头的值一律拒），以及五个写动作的确认口径。
//   B 组：判定与计划摘要 —— 二分开始/标记/重置、替换对象的 allow / warn / block 三档与理由标识符，
//         同一份计划算同一个摘要、换了对象摘要必变（票据绑定靠它）。
//   C 组（后续追加）：宿主只读电话的真 git 行为、预检票据、凭票执行、失败分类与登记点。
//
// 门禁只判外部行为：读的是共享层导出的函数与源码文本，不测私有函数名；反证组会篡改源文本，
// 改坏实现必须判红（见 F 组），否则这扇门禁只是把源码重抄一遍。
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-diagnostics'
const DIAG_SOURCE = 'src/shared/version-control/src/diagnostics-commands.ts'

let total = 0
let failed = 0
function check(ok, msg) {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed += 1
  return ok
}

function loadShared() {
  return import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/diagnostics-commands.js')).href)
}

// 能力账本里域 13 的十三条只读 + 5.12 替换对象的写动作，是本票要接的两组能力。
const READ_KINDS = ['bisect-status', 'grep', 'ls-files', 'cat-file', 'ls-tree', 'rev-parse', 'for-each-ref', 'is-ancestor', 'cherry', 'rev-list', 'apply-check', 'trailers', 'replace-list']
const WRITE_OPS = ['bisect-start', 'bisect-bad', 'bisect-good', 'bisect-skip', 'bisect-reset', 'replace-create', 'replace-delete']
const DANGEROUS = ['bisect-start', 'bisect-reset', 'replace-create', 'replace-delete']

function sameList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

async function sharedGroup() {
  console.log('A 组：共享层十三条只读查询与七个写动作的 argv 与参数白名单')
  const mod = await loadShared()
  const kinds = mod.DIAGNOSTICS_READ_KINDS
  check(Array.isArray(kinds) && kinds.length === READ_KINDS.length && READ_KINDS.every(function (k) { return kinds.indexOf(k) >= 0 }), 'A1 十三条只读查询的名字与能力账本一一对应（' + READ_KINDS.length + ' 条）')
  const ops = mod.DIAGNOSTICS_WRITE_OPS
  check(Array.isArray(ops) && ops.length === WRITE_OPS.length && WRITE_OPS.every(function (k) { return ops.indexOf(k) >= 0 }), 'A2 七个写动作一一对应（二分五步 + 替换对象两条）')
  check(mod.DIAGNOSTICS_CHECK_CONTRACT === 'version-control.diagnostics-check' && mod.DIAGNOSTICS_CHECK_VERSION === 1, 'A3 预检回包契约名与版本固定，界面据它认新协议')

  function planOf(kind, params) {
    const r = mod.diagnosticsReadPlanOf(kind, params)
    return r && r.ok === true ? r.plan : r
  }
  const grep = planOf('grep', { pattern: 'TODO', paths: ['src'] })
  check(grep && sameList(grep.args, ['grep', '-n', '-I', '--no-color', '-e', 'TODO', '--', 'src']), 'A4 13.3 按内容搜工作区的 argv：关键词用 -e 传入、路径在 -- 之后（元素各自独立）')
  const lsFiles = planOf('ls-files', { paths: ['a.txt'] })
  check(lsFiles && sameList(lsFiles.args, ['ls-files', '-z', '--', 'a.txt']), 'A5 13.4 按条件列文件的 argv 带 -z 与 -- 分隔')
  const catP = planOf('cat-file', { object: 'HEAD', mode: 'pretty' })
  const catT = planOf('cat-file', { object: 'HEAD', mode: 'type' })
  check(catP && sameList(catP.args, ['cat-file', '-p', 'HEAD']) && catT && sameList(catT.args, ['cat-file', '-t', 'HEAD']), 'A6 13.5 看对象内容按形态分 -p / -t 两条 argv')
  const tree = planOf('ls-tree', {})
  check(tree && sameList(tree.args, ['ls-tree', '-l', 'HEAD']), 'A7 13.6 看树：不给版本时看 HEAD，不让空值变成第二个参数')
  const rp = planOf('rev-parse', { rev: 'main' })
  check(rp && sameList(rp.args, ['rev-parse', '--verify', 'main']), 'A8 13.7 解析引用用 --verify，解析不出来按读到的结论回而不是当成命令失败')
  const fer = planOf('for-each-ref', { prefix: 'refs/heads/' })
  check(fer && fer.args[0] === 'for-each-ref' && fer.args[1].indexOf('--format=') === 0 && fer.args[2] === 'refs/heads/', 'A9 13.8 枚举引用：格式串与命名空间各自独立成参数')
  const anc = planOf('is-ancestor', { ancestor: 'HEAD~1', descendant: 'HEAD' })
  check(anc && sameList(anc.args, ['merge-base', '--is-ancestor', 'HEAD~1', 'HEAD']), 'A10 13.9 包含关系用 merge-base --is-ancestor，两个版本各占一个元素')
  const cherry = planOf('cherry', { upstream: 'origin/main', head: 'main' })
  check(cherry && sameList(cherry.args, ['cherry', '-v', 'origin/main', 'main']), 'A11 13.10 补丁等价用 cherry -v（patch-id 要吃标准输入，宿主标准输入一律 ignore，不用它）')
  const count = planOf('rev-list', { mode: 'count', left: 'main', right: 'origin/main' })
  const lr = planOf('rev-list', { mode: 'left-right', left: 'main', right: 'origin/main' })
  check(count && sameList(count.args, ['rev-list', '--count', 'main..origin/main']) && lr && sameList(lr.args, ['rev-list', '--left-right', '--count', 'main...origin/main']), 'A12 13.11 计数与左右差：两种形态各自一条 argv，区间写法只有一个元素')
  const applyPlan = planOf('apply-check', { patch: '--- a/a.txt\n+++ b/a.txt\n' })
  check(applyPlan && typeof applyPlan.patch === 'string' && applyPlan.patch.indexOf('--- a/a.txt') === 0 && applyPlan.args === undefined, 'A13 13.12 应用补丁只做预演：计划里只有补丁原文与输出上限，没有 argv（宿主把补丁落临时文件再跑 apply --check）')
  const tr = planOf('trailers', { object: 'HEAD' })
  check(tr && sameList(tr.args, ['log', '-1', '--format=%B', 'HEAD']), 'A14 13.13 尾部签名：读提交说明原文，尾部行由纯函数解析（不让 git 等标准输入）')
  const rl = planOf('replace-list', {})
  check(rl && sameList(rl.args, ['replace', '-l']), 'A15 5.12 替换对象：列出现有替换用 replace -l')
  const badGrep = mod.diagnosticsReadPlanOf('grep', { pattern: '' })
  const badObj = mod.diagnosticsReadPlanOf('cat-file', { object: '--force' })
  const badRev = mod.diagnosticsReadPlanOf('ls-tree', { rev: 'a b' })
  check(badGrep && badGrep.ok === false && badGrep.reason === 'bad-target', 'A16 反证：关键词为空的搜索当场拒，不起进程')
  check(badObj && badObj.ok === false && badObj.reason === 'bad-target', 'A17 反证：以 - 开头的对象名被当成选项注入，必须拒')
  check(badRev && badRev.ok === false && badRev.reason === 'bad-target', 'A18 反证：带空格/空白的版本名必须拒')
  const unknown = mod.diagnosticsReadPlanOf('rm-rf', {})
  check(unknown && unknown.ok === false && unknown.reason === 'bad-target', 'A19 反证：不在只读清单里的名字一律拒（不按未知种类去猜命令）')

  // 写动作：七个动作各自唯一的 argv 拼法、参数白名单。
  function wplanOf(op, args) {
    const r = mod.diagnosticsWritePlanOf(op, args)
    return r && r.ok === true ? r.plan : r
  }
  const start = wplanOf('bisect-start', { bad: 'badoid', good: 'goodoid' })
  check(start && sameList(mod.diagnosticsWriteArgvOf(start), ['bisect', 'start', 'badoid', 'goodoid']), 'A20 13.1 开始二分：git bisect start <坏> <好>，两个提交各占一个元素')
  const marks = ['bisect-bad', 'bisect-good', 'bisect-skip'].map(function (op) { return mod.diagnosticsWriteArgvOf(wplanOf(op, {})) })
  check(marks[0] && sameList(marks[0], ['bisect', 'bad']) && marks[1] && sameList(marks[1], ['bisect', 'good']) && marks[2] && sameList(marks[2], ['bisect', 'skip']), 'A21 13.1 标坏 / 标好 / 跳过三条各拼各的 argv')
  check(sameList(mod.diagnosticsWriteArgvOf(wplanOf('bisect-reset', {})), ['bisect', 'reset']), 'A22 13.1 重置二分：bisect reset')
  const repCreate = wplanOf('replace-create', { from: 'aaaa', to: 'bbbb' })
  check(sameList(mod.diagnosticsWriteArgvOf(repCreate), ['replace', 'aaaa', 'bbbb']), 'A23 5.12 建立替换：git replace <被替换> <被指向>，两个对象各占一个元素')
  const repDelete = wplanOf('replace-delete', { object: 'aaaa' })
  check(sameList(mod.diagnosticsWriteArgvOf(repDelete), ['replace', '-d', 'aaaa']), 'A24 5.12 撤销替换：git replace -d <对象>，一键撤销')
  const badStart = mod.diagnosticsWritePlanOf('bisect-start', { bad: '-x', good: 'bbbb' })
  const missingStart = mod.diagnosticsWritePlanOf('bisect-start', { bad: 'aaaa' })
  const badReplace = mod.diagnosticsWritePlanOf('replace-create', { from: 'aaaa', to: '' })
  check(badStart && badStart.ok === false && badStart.reason === 'bad-target', 'A25 反证：以 - 开头的提交号不能进 argv')
  check(missingStart && missingStart.ok === false && missingStart.reason === 'bad-target', 'A26 反证：二分开始必须同时给坏提交与好提交')
  check(badReplace && badReplace.ok === false && badReplace.reason === 'bad-target', 'A27 反证：替换对象必须同时给被替换与被指向两个对象')
  const unknownOp = mod.diagnosticsWritePlanOf('bisect-evil', {})
  check(unknownOp && unknownOp.ok === false && unknownOp.reason === 'bad-target', 'A28 反证：不在写动作清单里的名字一律拒')
}

async function decisionGroup() {
  console.log('B 组：判定三档、确认口径与计划摘要')
  const mod = await loadShared()
  function wplanOf(op, args) {
    const r = mod.diagnosticsWritePlanOf(op, args)
    return r && r.ok === true ? r.plan : r
  }
  const start = wplanOf('bisect-start', { bad: 'badoid', good: 'goodoid' })
  const reset = wplanOf('bisect-reset', {})
  const bad = wplanOf('bisect-bad', {})
  const repCreate = wplanOf('replace-create', { from: 'aaaa', to: 'bbbb' })
  const repDelete = wplanOf('replace-delete', { object: 'aaaa' })
  const factsIdle = { active: false, replaces: [], badOid: null, goodOid: null, fromOid: null, toOid: null, objectOid: null }
  const factsBisecting = { active: true, replaces: [], badOid: 'b1', goodOid: 'g1', fromOid: null, toOid: null, objectOid: null }
  const factsReplaced = { active: false, replaces: ['aaaa'], badOid: null, goodOid: null, fromOid: 'aaaa', toOid: 'bbbb', objectOid: 'aaaa' }
  function verdictOf(op, plan, facts) {
    const d = mod.diagnosticsDecisionOf(op, plan, facts)
    return d && d.verdict === 'block' ? 'block:' + d.reasons[0] : (d && d.verdict)
  }
  check(verdictOf('bisect-start', start, Object.assign({}, factsIdle, { badOid: 'b1', goodOid: 'g1' })) === 'allow', 'B1 开始二分：有坏提交与好提交、当前没在二分时放行')
  check(verdictOf('bisect-start', start, factsIdle) === 'block:not-a-commit', 'B2 开始二分：两个提交都解析不出来时挡住，理由是固定标识符')
  check(verdictOf('bisect-start', start, factsBisecting) === 'block:already-bisecting', 'B3 开始二分：当前已经在二分时挡住（不覆盖手上那趟）')
  check(verdictOf('bisect-start', start, Object.assign({}, factsIdle, { badOid: 'x', goodOid: 'x' })) === 'block:same-object', 'B4 开始二分：坏提交与好提交是同一个对象时挡住（没得二分）')
  check(verdictOf('bisect-bad', bad, factsBisecting) === 'allow' && verdictOf('bisect-good', wplanOf('bisect-good', {}), factsBisecting) === 'allow', 'B5 标坏 / 标好：在二分中放行')
  check(verdictOf('bisect-bad', bad, factsIdle) === 'block:not-bisecting' && verdictOf('bisect-reset', reset, factsIdle) === 'block:not-bisecting', 'B6 标记与重置：不在二分中时挡住（git 会报 We are not bisecting）')
  check(verdictOf('replace-create', repCreate, factsReplaced) === 'block:already-replaced', 'B7 建立替换：这个对象已经有替换时挡住（先撤销再建，不能悄悄叠一层）')
  check(verdictOf('replace-create', repCreate, Object.assign({}, factsReplaced, { replaces: [], fromOid: 'aaaa', toOid: 'aaaa' })) === 'block:same-object', 'B8 建立替换：两个对象相同时挡住')
  check(verdictOf('replace-delete', repDelete, factsReplaced) === 'allow' && verdictOf('replace-delete', repDelete, Object.assign({}, factsReplaced, { replaces: [] })) === 'block:no-replace', 'B9 撤销替换：列表里有就放行，没有就挡住')
  const confirmStart = mod.diagnosticsConfirmOf('bisect-start', start, Object.assign({}, factsIdle, { badOid: 'b1', goodOid: 'g1' }))
  check(confirmStart && typeof confirmStart.verb === 'string' && confirmStart.verb.indexOf('二分') >= 0, 'B10 确认卡文案：开始二分说清动作动词与后果（界面四段从它来）')
  check(mod.diagnosticsConfirmRequiredOf('bisect-start') === true && mod.diagnosticsConfirmRequiredOf('bisect-reset') === true && mod.diagnosticsConfirmRequiredOf('replace-create') === true && mod.diagnosticsConfirmRequiredOf('replace-delete') === true, 'B11 四个改仓库的动作都要确认卡')
  check(mod.diagnosticsConfirmRequiredOf('bisect-bad') === false && mod.diagnosticsConfirmRequiredOf('bisect-good') === false && mod.diagnosticsConfirmRequiredOf('bisect-skip') === false, 'B12 标坏 / 标好 / 跳过只是随手标记，不弹确认卡（工具就该一步一下）')
  const digestA = mod.diagnosticsPlanDigestInput(start)
  const digestB = mod.diagnosticsPlanDigestInput(wplanOf('bisect-start', { bad: 'badoid', good: 'goodoid' }))
  const digestC = mod.diagnosticsPlanDigestInput(wplanOf('bisect-start', { bad: 'badoid', good: 'other' }))
  check(digestA === digestB && digestA !== digestC, 'B13 计划摘要：同一份计划同一个输出，换了目标提交就变（票据绑定靠它挡住偷换）')
  const sceneA = mod.diagnosticsSceneDigestInput({ active: true, log: 'git bisect start a b', replaces: [] })
  const sceneB = mod.diagnosticsSceneDigestInput({ active: true, log: 'git bisect start a b', replaces: [] })
  const sceneC = mod.diagnosticsSceneDigestInput({ active: true, log: 'git bisect start a c', replaces: [] })
  check(sceneA === sceneB && sceneA !== sceneC, 'B14 现场摘要：二分日志或替换清单变了摘要就变（执行前重算比对用）')
}

async function main() {
  console.log('')
  console.log('=== ' + GATE + '：域 13 十三条 + 5.12 替换对象 ===')
  console.log('')
  await sharedGroup()
  await decisionGroup()
  console.log('')
  console.log('汇总：' + total + ' 条断言，' + failed + ' 条失败')
  printGateResult(GATE, total, failed)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(function (e) {
  console.error('门禁执行异常：' + String((e && e.stack) || e))
  process.exit(1)
})
