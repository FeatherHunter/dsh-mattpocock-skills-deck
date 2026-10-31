// tests/verify-1586-diagnostics.ts —— 诊断与底层命令（域 13 十三条 + 5.12 替换对象）的门禁（#1761 T25）
//
// 这扇门禁按票面「做完」逐条验：
//   A 组：共享层 diagnostics-commands.ts —— 十三条只读查询与七个写动作各自唯一的 argv 拼法、
//         参数白名单（危险字符与以 - 开头的值一律拒），以及五个写动作的确认口径。
//   B 组：判定与计划摘要 —— 二分开始/标记/重置、替换对象的 allow / warn / block 三档与理由标识符，
//         同一份计划算同一个摘要、换了对象摘要必变（票据绑定靠它）。
//   C–E 组：宿主只读电话、预检签票、凭票执行（argv 切片、票据与现场逐格比对、重放、失败分类、登记点）。
//   F 组：反证（篡改源文本必须判红）。
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


// ---------------------------------------------------------------------------
// 宿主侧装置：真宿主（createVersionControl）+ 假进程路由。
// 为什么走真宿主：门禁要判的是「电话被调用时到底跑没跑 git、跑的是哪条 argv、钉的是哪个目录」，
// 这些只有装配完之后才看得见；假路由只替换进程出口，其余（前缀、-C、日志、票据表）都是真的。
// ---------------------------------------------------------------------------
const REPO = 'D:/假工作区/repo'
const GITDIR = REPO + '/.git'
const T0 = 1790000000000
const HEAD_OID = 'a'.repeat(40)
const BAD_OID = 'b'.repeat(40)
const GOOD_OID = 'c'.repeat(40)
const FROM_OID = 'd'.repeat(40)
const TO_OID = 'e'.repeat(40)
const WRITE_SOURCE = 'src/host/versionControlDiagnosticsWrite.ts'
const READ_SOURCE = 'src/host/versionControlDiagnosticsRead.ts'
const CHECK_SOURCE = 'src/host/versionControlDiagnosticsCheck.ts'
const MOUNT_SOURCE = 'src/host/versionControlDiagnosticsMount.ts'
const INDEX_HOST_SOURCE = 'src/host/index.ts'
const TIMEOUTS_SOURCE = 'config/timeouts.yaml'

function readText(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }
function makeCollector(text, truncated) { return { finalize() { return { text: String(text), truncated: truncated === true } } } }
function afterPrefix(argv) { const at = argv.indexOf('i18n.logOutputEncoding=UTF-8'); return at < 0 ? null : argv.slice(at + 1) }

// 每造一份路由就给一份可变现场：二分日志、替换清单、几个 oid 都能在签票之后改，
// 用来验证「执行前重算现场、变了就零进程拒绝」这一条。
function makeDiagRoute() {
  const st = { log: '', replaces: [], revFail: false, applyFail: false, ancestor: true, writeFail: '', head: HEAD_OID }
  const seen = []
  const byName = { HEAD: HEAD_OID, main: GOOD_OID, nope: null, '': null }
  byName[BAD_OID] = BAD_OID; byName[GOOD_OID] = GOOD_OID; byName[FROM_OID] = FROM_OID; byName[TO_OID] = TO_OID
  function route(argv) {
    seen.push(argv.slice())
    const a = afterPrefix(argv)
    if (a === null) return { code: 1, stdout: '', stderr: '缺少固定前缀' }
    if (a[0] === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) return { code: 0, stdout: GITDIR + '\ntrue\nfalse\n', stderr: '' }
    if (a[0] === 'rev-parse' && a.indexOf('--show-toplevel') >= 0) return { code: 0, stdout: REPO + '\n', stderr: '' }
    if (a[0] === 'rev-parse' && a.indexOf('--verify') >= 0) {
      if (st.revFail) return { code: 1, stdout: '', stderr: 'fatal: bad revision\n' }
      const name = String(a[a.length - 1])
      const oid = Object.prototype.hasOwnProperty.call(byName, name) ? byName[name] : null
      if (oid === null) return { code: 1, stdout: '', stderr: 'fatal: Needed a single revision\n' }
      return { code: 0, stdout: oid + '\n', stderr: '' }
    }
    if (a[0] === 'rev-parse') return { code: 0, stdout: GOOD_OID + '\n', stderr: '' }
    if (a[0] === 'bisect' && a[1] === 'log') return st.log === '' ? { code: 128, stdout: '', stderr: 'error: We are not bisecting.\n' } : { code: 0, stdout: st.log, stderr: '' }
    if (a[0] === 'bisect') return st.writeFail !== '' ? { code: 1, stdout: '', stderr: st.writeFail } : { code: 0, stdout: '', stderr: '' }
    if (a[0] === 'replace' && a[1] === '-l') return { code: 0, stdout: st.replaces.length === 0 ? '' : st.replaces.join('\n') + '\n', stderr: '' }
    if (a[0] === 'replace') return st.writeFail !== '' ? { code: 1, stdout: '', stderr: st.writeFail } : { code: 0, stdout: '', stderr: '' }
    if (a[0] === 'grep') return { code: 0, stdout: 'src/a.ts:3:TODO 收口\n', stderr: '' }
    if (a[0] === 'ls-files') return { code: 0, stdout: 'a.txt\u0000b.txt\u0000', stderr: '' }
    if (a[0] === 'cat-file') return a.indexOf('-t') >= 0 ? { code: 0, stdout: 'blob\n', stderr: '' } : { code: 0, stdout: '对象内容\n', stderr: '' }
    if (a[0] === 'ls-tree') return { code: 0, stdout: '100644 blob ' + HEAD_OID + ' 12\ta.txt\n', stderr: '' }
    if (a[0] === 'for-each-ref') return { code: 0, stdout: ['refs/heads/main', HEAD_OID, '首个提交'].join('\u0000') + '\n', stderr: '' }
    if (a[0] === 'merge-base') return { code: st.ancestor ? 0 : 1, stdout: '', stderr: '' }
    if (a[0] === 'cherry') return { code: 0, stdout: '- ' + HEAD_OID + ' 补丁等价\n', stderr: '' }
    if (a[0] === 'rev-list') return a.indexOf('--left-right') >= 0 ? { code: 0, stdout: '3\t2\n', stderr: '' } : { code: 0, stdout: '5\n', stderr: '' }
    if (a[0] === 'apply') return st.applyFail ? { code: 1, stdout: '', stderr: 'error: patch failed: a.txt:1\n' } : { code: 0, stdout: '', stderr: '' }
    if (a[0] === 'log') return { code: 0, stdout: '改动说明标题\n\n正文一段\n\nSigned-off-by: 张三 <z@example.com>\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { route: route, seen: seen, state: st }
}

function writeCmds(seen) {
  const out = []
  for (let i = 0; i < seen.length; i += 1) {
    const a = afterPrefix(seen[i])
    if (!a) continue
    if (a[0] === 'bisect' && a[1] !== 'log') out.push(a.join(' '))
    if (a[0] === 'replace' && a[1] !== '-l') out.push(a.join(' '))
  }
  return out
}

function makeHostDeps(route, clock) {
  const logs = []
  const deps = {
    subprocess: { spawn(req) { const hit = route(req.argv) || { code: 0, stdout: '' }; return { done: Promise.resolve({ exitCode: hit.code === undefined ? 0 : hit.code, signal: hit.signal }), collected: { stdout: makeCollector(hit.stdout || '', hit.truncated), stderr: makeCollector(hit.stderr || '', false) }, terminate() {} } } },
    timer: { timeout() { return new Promise(function (resolve) { setTimeout(resolve, 1) }) } },
    fs: { stat() { return Promise.reject(Object.assign(new Error('没有这个文件'), { code: 'ENOENT' })) }, lstat() { return Promise.resolve(null) }, exists() { return Promise.resolve(false) } },
    getPlatform: async function () { return { resolveExecutable: async function (name) { return name === 'git' ? 'git' : null } } },
    DEFAULT_CWD: REPO, TIMEOUT_MS: 30000, gate: { noteOutbound() {} },
    logCtx: { fire(level, event, fields) { logs.push({ level: level, event: event, fields: fields }) } },
    now: function () { return clock ? clock.t : T0 },
  }
  return { deps: deps, logs: logs }
}

// C 组：十三条只读查询走真宿主，断言四件事——真的起了一条 git、argv 与共享层计划一致、
// 输出被翻成界面要的形状、失败走统一信封（允许非零的那几个按结论回，不当失败）。
async function readGroup() {
  console.log('C 组：诊断页只读电话（真宿主 + 假路由，十三条查询各自一条 argv）')
  const mod = await loadShared()
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const clock = { t: T0 }
  const r = makeDiagRoute()
  const vc = hostMod.createVersionControl(makeHostDeps(r.route, clock).deps)

  function planArgs(kind, params) { const p = mod.diagnosticsReadPlanOf(kind, params); return p && p.ok === true ? p.plan.args : null }

  const grep = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'grep', params: { pattern: 'TODO', paths: ['src'] } })
  const grepPlan = planArgs('grep', { pattern: 'TODO', paths: ['src'] })
  const grepSeen = r.seen.length > 0 ? afterPrefix(r.seen[r.seen.length - 1]) : null
  check(grep && grep.ok === true && grep.kind === 'grep', 'C1 13.3 按内容搜：电话回成功，并如实带上查询类型', JSON.stringify(grep).slice(0, 200))
  check(grep && grep.matchCount === 1 && grep.matches[0].path === 'src/a.ts' && grep.matches[0].line === 3, 'C2 13.3 搜到的行被拆成 路径 / 行号 / 文字 三段，界面不用自己解析文本')
  check(grepSeen && sameList(grepSeen, grepPlan), 'C3 13.3 真跑的那条 argv 与共享层计划逐元素一致（每个参数各自独立，参数在 -e 与 -- 之后）')

  const notBisecting = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'bisect-status', params: {} })
  check(notBisecting && notBisecting.ok === true && notBisecting.active === false, 'C4 13.2 不在二分中：git 退出码 128 是结论不是失败，电话回 active:false')

  r.state.log = '# bad: [' + BAD_OID + ']\n# good: [' + GOOD_OID + ']\n'
  const bisecting = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'bisect-status', params: {} })
  check(bisecting && bisecting.ok === true && bisecting.active === true && bisecting.bad[0] === BAD_OID && bisecting.good[0] === GOOD_OID, 'C5 13.2 二分日志被解析成好提交、坏提交与已标记名单（界面按它画二分进度）')
  r.state.log = ''

  const applyOk = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'apply-check', params: { patch: '--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n' } })
  const applySeen = afterPrefix(r.seen[r.seen.length - 1])
  const patchFile = applySeen && applySeen[2]
  check(applyOk && applyOk.ok === true && applyOk.clean === true && applyOk.mode === 'check', 'C6 13.12 应用补丁只做预演：干净补丁回 clean:true（没有真实应用这一步）')
  check(applySeen && sameList(applySeen.slice(0, 2), ['apply', '--check']) && typeof patchFile === 'string' && patchFile.indexOf('.patch') > 0 && patchFile.charAt(0) !== '-', 'C7 13.12 预演把补丁写进一个临时文件再交给 apply --check（标准输入一律不用，路径不以 - 开头）')
  check(applyOk && sameList(applyOk.args, ['apply', '--check', '<临时补丁文件>']), 'C8 13.12 回包里的 argv 把临时路径遮成占位符（临时路径不进票据、不进日志）')

  r.state.applyFail = true
  const applyBad = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'apply-check', params: { patch: '--- a/a.txt\n+++ b/a.txt\n' } })
  check(applyBad && applyBad.ok === true && applyBad.clean === false && applyBad.gitSays.indexOf('error: patch failed') === 0, 'C9 13.12 干净不干净也是结论：补丁预演失败回 clean:false 与 git 原话第一行，不当执行失败')
  r.state.applyFail = false

  const revMissing = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'rev-parse', params: { rev: 'nope' } })
  check(revMissing && revMissing.ok === true && revMissing.missing === true, 'C10 13.7 解析引用：解析不出来回 missing:true（这是读到的结论，不让整条查询判失败）')

  const files = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'ls-files', params: { paths: ['a.txt'] } })
  check(files && files.ok === true && sameList(files.paths, ['a.txt', 'b.txt']), 'C11 13.4 按条件列文件：NUL 分隔的输出被拆成路径清单')
  const tree = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'ls-tree', params: {} })
  check(tree && tree.ok === true && tree.rows.length === 1 && tree.rows[0].path === 'a.txt' && tree.rows[0].mode === '100644', 'C12 13.6 看树：模式 / 类型 / 对象 / 大小 / 路径 五格都被拆出来')
  const refs = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'for-each-ref', params: { prefix: 'refs/heads/' } })
  check(refs && refs.ok === true && refs.rows[0].ref === 'refs/heads/main' && refs.rows[0].oid === HEAD_OID, 'C13 13.8 枚举引用：NUL 分隔的三段被分成引用名 / 对象 / 说明')
  const catType = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'cat-file', params: { object: 'HEAD', mode: 'type' } })
  const catText = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'cat-file', params: { object: 'HEAD', mode: 'pretty' } })
  check(catType && catType.ok === true && catType.objectType === 'blob' && catText && catText.ok === true && catText.text.indexOf('对象内容') >= 0, 'C14 13.5 看对象内容：看类型与看内容各走一条 argv，回包形状分开')
  const anc = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'is-ancestor', params: { ancestor: 'HEAD~1', descendant: 'HEAD' } })
  check(anc && anc.ok === true && anc.isAncestor === true, 'C15 13.9 包含关系：退出码 0 被翻成 isAncestor:true（退出码非零的那一档在 C16 另判）')
  r.state.ancestor = false
  const notAnc = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'is-ancestor', params: { ancestor: 'HEAD', descendant: 'HEAD~1' } })
  check(notAnc && notAnc.ok === true && notAnc.isAncestor === false, 'C16 13.9 不包含也是结论：非零退出码回 isAncestor:false，不判成执行失败')
  r.state.ancestor = true
  const cherry = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'cherry', params: { upstream: 'origin/main', head: 'main' } })
  check(cherry && cherry.ok === true && cherry.rows[0].marker === '-' && cherry.rows[0].oid === HEAD_OID, 'C17 13.10 补丁等价：cherry 的标记位与对象被拆成两格')
  const count = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'rev-list', params: { mode: 'count', left: 'main', right: 'origin/main' } })
  const lr = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'rev-list', params: { mode: 'left-right', left: 'main', right: 'origin/main' } })
  check(count && count.ok === true && count.count === 5 && lr && lr.ok === true && lr.left === 3 && lr.right === 2, 'C18 13.11 计数与左右差：两种形态各自解析成数字，界面不用再算')
  const trailers = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'trailers', params: { object: 'HEAD' } })
  check(trailers && trailers.ok === true && trailers.trailers.length === 1 && trailers.trailers[0].token === 'Signed-off-by', 'C19 13.13 尾部行：只认最后一段连续的 键: 值 行（Signed-off-by 由提交时写入，这里是只读展示）')
  const repl = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'replace-list', params: {} })
  check(repl && repl.ok === true && repl.replaces.length === 0, 'C20 5.12 读侧：替换清单为空时回空数组（有替换的那一档在 E 组执行后另判）')

  const before = r.seen.length
  const badArgs = await vc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'grep', params: { pattern: '' } })
  check(badArgs && badArgs.ok === false && badArgs.error && badArgs.error.kind === 'args', 'C21 参数不合法的查询当场拒，归参数这一类（不冒充环境或执行失败）')
  check(r.seen.length === before, 'C22 参数不合法时一个 git 进程都不起：白名单校验发生在起进程之前')

  r.state.revFail = true
  const lsFail = makeDiagRoute()
  lsFail.route = function (argv) { const a = afterPrefix(argv); if (a && a[0] === 'ls-files') return { code: 1, stdout: '', stderr: 'fatal: 读不了索引\n' }; return r.route(argv) }
  const failVc = hostMod.createVersionControl(makeHostDeps(lsFail.route, clock).deps)
  const lsBad = await failVc.handleGitDiagnosticsRead({ cwd: REPO, kind: 'ls-files', params: {} })
  check(lsBad && lsBad.ok === false && lsBad.error && lsBad.error.kind === 'exit' && lsBad.error.message.indexOf('读不了索引') >= 0, 'C23 不在允许非零清单里的命令失败：走统一失败信封，带上 git 原话与环节名')
  r.state.revFail = false
}

// D 组：预检（签票）。判三段式第一段：能不能做、为什么不能、做了要确认什么；
// 四种拒绝（已在二分 / 不在二分 / 对象解析不出 / 参数不合法）都必须在起进程之前或只读阶段结束。
async function checkGroup() {
  console.log('D 组：诊断写动作的预检（签票 + 判定 + 确认口径）')
  const mod = await loadShared()
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const clock = { t: T0 }
  const r = makeDiagRoute()
  const vc = hostMod.createVersionControl(makeHostDeps(r.route, clock).deps)

  const allowStart = await vc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-start', bad: BAD_OID, good: GOOD_OID })
  check(allowStart && allowStart.ok === true, 'D1 开始二分：空闲仓库上预检放行（先把能做的这一档备好）', JSON.stringify(allowStart).slice(0, 200))
  check(allowStart && allowStart.contract === mod.DIAGNOSTICS_CHECK_CONTRACT && allowStart.version === mod.DIAGNOSTICS_CHECK_VERSION && allowStart.decision === 'allow' && sameList(allowStart.reasons, ['ok']), 'D2 预检回包带固定契约名与版本、判定与理由标识符（界面据它画预检结论）')
  check(allowStart && allowStart.confirmRequired === true && allowStart.confirm && allowStart.confirm.kind === 'bisect-start' && allowStart.confirm.verb.indexOf('二分') >= 0, 'D3 改仓库状态的动作要确认卡：回包里带确认口径与一句人话动词（界面四段从它来）')
  check(allowStart && allowStart.ticket && typeof allowStart.ticket.id === 'string' && allowStart.ticket.expiresAtMs === T0 + 120000, 'D4 放行就签一张票：票据号在、有效期一百二十秒（时钟取注入的读钟）')
  check(allowStart && allowStart.scene && allowStart.scene.active === false && sameList(allowStart.scene.replaces, []), 'D5 预检回包里带现场摘要（在不在二分、有哪些替换），界面不用再单独读一次')

  const tickets = await vc.diagnosticsTickets()
  const signed = tickets && tickets.get(allowStart.ticket.id)
  check(signed && signed.target && signed.target.op === 'bisect-start' && signed.target.bad === BAD_OID && signed.target.good === GOOD_OID, 'D6 票里记的是规范化过的计划：动作与两个目标各自一格')
  check(signed && signed.bindings && signed.bindings.preconditions && /^[0-9a-f]{16}$/.test(String(signed.bindings.preconditions.planDigest)) && /^[0-9a-f]{16}$/.test(String(signed.bindings.preconditions.worktreeDigest)), 'D7 票绑定两份摘要：计划摘要（换目标就变）与现场摘要（二分状态或替换清单变了就变）')

  const blockBisecting = await vc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-start', bad: BAD_OID, good: GOOD_OID })
  const writesBefore = writeCmds(r.seen).length
  r.state.log = '# bad: [' + BAD_OID + ']\n'
  const again = await vc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-start', bad: BAD_OID, good: GOOD_OID })
  check(blockBisecting && blockBisecting.ok === true, 'D8 对照：同样请求在开始二分之前是放行的（下面那一条才有对照意义）')
  check(again && again.ok === false && again.error.kind === 'blocked' && again.reason === 'already-bisecting' && again.decision.verdict === 'block', 'D9 已经在二分中：再开始一趟被当场挡住，理由是固定标识符')
  check(writeCmds(r.seen).length === writesBefore, 'D10 挡住时零写进程：预检只读，绝不在判定之前动仓库')
  r.state.log = ''

  const notCommit = await vc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-start', bad: 'nope', good: GOOD_OID })
  check(notCommit && notCommit.ok === false && notCommit.reason === 'not-a-commit', 'D11 目标提交解析不出：预检挡住，理由是 not-a-commit（不签票）')

  const badArgs = await vc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-start', bad: '-x', good: GOOD_OID })
  check(badArgs && badArgs.ok === false && badArgs.error.kind === 'args', 'D12 参数不合法（以 - 开头会被当选项）：预检当场拒，归参数这一类')

  r.state.log = '# bad: [' + BAD_OID + ']\n# good: [' + GOOD_OID + ']\n'
  const markOk = await vc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-bad' })
  check(markOk && markOk.ok === true && markOk.confirmRequired === false, 'D13 标坏提交：在二分中放行，且不要确认卡（随手标记就该一步一下）')
  r.state.log = ''
}

// E 组：凭票执行。判三段式第三段：真的只跑那一条 argv、票据与现场逐格比对、同一请求只执行一次、
// 失败按固定类别归族并给出信封四件（kind/reason/message/hint）。
async function writeGroup() {
  console.log('E 组：诊断写动作的凭票执行（argv、票据比对、重放、失败分类）')
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const mod = await loadShared()
  const clock = { t: T0 }
  const r = makeDiagRoute()
  const vc = hostMod.createVersionControl(makeHostDeps(r.route, clock).deps)

  const signedStart = await vc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-start', bad: BAD_OID, good: GOOD_OID })
  const ticketStart = signedStart.ticket.id
  const markBad = await vc.handleGitDiagnosticsWrite({ cwd: REPO, ticketId: ticketStart, requestId: 'r-e1', op: 'bisect-start', confirmed: true })
  const argvStart = afterPrefix(r.seen[r.seen.length - 1])
  check(markBad && markBad.ok === true && markBad.op === 'bisect-start', 'E1 开始二分：凭票执行成功，回包写明动作', JSON.stringify(markBad).slice(0, 200))
  check(argvStart && sameList(argvStart, ['bisect', 'start', BAD_OID, GOOD_OID]), 'E2 2.13/13.1 开始二分只跑这一条 argv：两个提交各自一个元素，不带任何额外开关')
  check(markBad && markBad.bad === BAD_OID && markBad.good === GOOD_OID && markBad.command === 'bisect start', 'E3 回包带作用对象与命令来源（界面只显示 git 子命令名与对象）')

  const reqs = r.seen.filter(function (argv) { const a = afterPrefix(argv); return a && a[0] === 'rev-parse' && a.indexOf('--show-toplevel') >= 0 })
  const lastWrite = (function () {
    for (let i = r.seen.length - 1; i >= 0; i -= 1) { const a = afterPrefix(r.seen[i]); if (a && a[0] === 'bisect' && a[1] !== 'log') return r.seen[i] }
    return null
  })()
  check(lastWrite && lastWrite.indexOf('-C') > 0 && lastWrite.indexOf(REPO) > 0 && lastWrite.indexOf('--no-pager') > 0, 'E4 执行时 -C 钉在仓库根、固定前缀在子命令之前（不继承用户 shell 的别名与配置注入）')
  check(reqs.length > 0, 'E5 预检与执行都先确认仓库根（同一个仓库，不会偷偷换到别的目录）')

  const replay = await vc.handleGitDiagnosticsWrite({ cwd: REPO, ticketId: ticketStart, requestId: 'r-e1', op: 'bisect-start', confirmed: true })
  const writesAfterReplay = writeCmds(r.seen).length
  check(replay && replay.ok === true && replay.reused === true && replay.result && replay.result.atMs === markBad.atMs, 'E6 同一个 requestId 重放：回同一份结果，不再执行第二次')
  check(writesAfterReplay === 1, 'E7 重放没有起第二个写进程（网络重发不会把仓库改两遍）')
  r.state.log = '# bad: [' + BAD_OID + ']\n# good: [' + GOOD_OID + ']\n'

  const noConfirm = await vc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-reset' })
  const ticketReset = noConfirm.ticket.id
  const beforeNeed = writeCmds(r.seen).length
  const needConfirm = await vc.handleGitDiagnosticsWrite({ cwd: REPO, ticketId: ticketReset, requestId: 'r-e8' })
  check(needConfirm && needConfirm.ok === false && needConfirm.reason === 'need-confirm' && writeCmds(r.seen).length === beforeNeed, 'E8 改仓库状态的动作没点确认：拒绝，且零写进程')

  const staleTicket = await vc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-reset' })
  clock.t = T0 + 120001
  const beforeExpired = writeCmds(r.seen).length
  const expired = await vc.handleGitDiagnosticsWrite({ cwd: REPO, ticketId: staleTicket.ticket.id, requestId: 'r-e9', confirmed: true })
  check(expired && expired.ok === false && expired.reason === 'ticket-expired' && writeCmds(r.seen).length === beforeExpired, 'E9 票过期（超过一百二十秒）：零写进程拒绝，让用户重新预检')
  clock.t = T0

  const opMismatch = await vc.handleGitDiagnosticsWrite({ cwd: REPO, ticketId: ticketStart, requestId: 'r-e10', op: 'bisect-reset', confirmed: true })
  const beforeMismatch = writeCmds(r.seen).length
  check(opMismatch && opMismatch.ok === false && opMismatch.reason === 'ticket-op-mismatch' && writeCmds(r.seen).length === beforeMismatch, 'E10 拿开始二分的票去结束二分：零写进程拒绝（一张票只配一个动作）')

  const beforeScene = await vc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-bad' })
  r.state.log = '# bad: [' + BAD_OID + ']\n# good: [' + GOOD_OID + ']\n# skip: [' + HEAD_OID + ']\n'
  const beforeDrift = writeCmds(r.seen).length
  const drift = await vc.handleGitDiagnosticsWrite({ cwd: REPO, ticketId: beforeScene.ticket.id, requestId: 'r-e11' })
  check(drift && drift.ok === false && drift.reason === 'target-changed' && writeCmds(r.seen).length === beforeDrift, 'E11 预检之后有人在终端里改了二分记录：现场摘要不一致，零写进程拒绝')
  r.state.log = ''
  clock.t = T0

  const replScene = makeDiagRoute()
  const replVc = hostMod.createVersionControl(makeHostDeps(replScene.route, clock).deps)
  const signedRepl = await replVc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'replace-create', from: FROM_OID, to: TO_OID })
  const replDone = await replVc.handleGitDiagnosticsWrite({ cwd: REPO, ticketId: signedRepl.ticket.id, requestId: 'r-e12', confirmed: true })
  const argvRepl = afterPrefix(replScene.seen[replScene.seen.length - 1])
  check(replDone && replDone.ok === true && replDone.from === FROM_OID && replDone.to === TO_OID, 'E12 5.12 建立替换：凭票执行成功，回包写明被替换对象与被指向对象')
  check(argvRepl && sameList(argvRepl, ['replace', FROM_OID, TO_OID]), 'E13 5.12 建立替换只跑这一条 argv：两个对象各自一个元素（不做字符串拼接）')

  const markScene = makeDiagRoute()
  markScene.state.log = '# bad: [' + BAD_OID + ']\n'
  const markVc = hostMod.createVersionControl(makeHostDeps(markScene.route, clock).deps)
  const signedBad = await markVc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-bad' })
  const markedBad = await markVc.handleGitDiagnosticsWrite({ cwd: REPO, ticketId: signedBad.ticket.id, requestId: 'r-e14' })
  check(markedBad && markedBad.ok === true && markedBad.active === true && sameList(afterPrefix(markScene.seen[markScene.seen.length - 1]), ['bisect', 'bad']), 'E14 标坏提交不需要确认卡：一步一下就落下，只跑 bisect bad')

  markScene.state.writeFail = 'error: We are not bisecting.\n'
  const signedBad2 = await markVc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-bad' })
  const failedClass = await markVc.handleGitDiagnosticsWrite({ cwd: REPO, ticketId: signedBad2.ticket.id, requestId: 'r-e15' })
  check(failedClass && failedClass.ok === false && failedClass.error.kind === 'git-failed' && failedClass.error.reason === 'not-bisecting' && failedClass.error.hint.indexOf('二分') >= 0, 'E15 执行失败按固定类别归族：git 说不在二分中，归 not-bisecting 并给人话提示（不落 unknown）')
  check(failedClass && failedClass.step && failedClass.git && failedClass.exitCode === 1 && failedClass.cause, 'E16 失败回执写清环节名、git 原话、退出码与上游原因（界面四件套从它来）')

  markScene.state.writeFail = 'fatal: 仓库自己闹脾气了\n'
  const signedBad3 = await markVc.handleGitDiagnosticsCheck({ cwd: REPO, op: 'bisect-bad' })
  const unknown = await markVc.handleGitDiagnosticsWrite({ cwd: REPO, ticketId: signedBad3.ticket.id, requestId: 'r-e17' })
  check(unknown && unknown.ok === false && unknown.error.reason === 'unknown-write-failure', 'E17 认不出的 git 原话如实记成 unknown-write-failure（不冒充已知类别）')
  const errKeys = unknown && unknown.error ? Object.keys(unknown.error).sort().join(',') : ''
  check(errKeys === 'hint,kind,message,reason', 'E18 失败信封固定四件：kind / reason / message / hint，形状不随失败种类改')

  // E19–E22：登记点与源码纪律（静态断言，防「实现好了但没接上」）
  const writeSrc = readText(WRITE_SOURCE)
  const mountSrc = readText(MOUNT_SOURCE)
  const indexSrc = readText(INDEX_HOST_SOURCE)
  const timeoutsSrc = readText(TIMEOUTS_SOURCE)
  check(!/child_process|spawnSync|execSync/.test(writeSrc) && !/child_process|spawnSync|execSync/.test(readText(READ_SOURCE)), 'E19 三条执行叶子都不自己起进程：进程出口只有注入的那一条（同一套前缀、报闸与日志）')
  check(mod.DIAGNOSTICS_WRITE_OPS.every(function (op) { return writeSrc.indexOf("'" + op + "'") >= 0 }) && /DIAGNOSTICS_WRITE_OPS/.test(writeSrc), 'E20 七个写动作在执行层都有分支（动作枚举与执行 argv 表同一份真源）')
  check(mountSrc.indexOf("loggedPhone('wf.gitDiagnosticsRead'") > 0 && mountSrc.indexOf("loggedPhone('wf.gitDiagnosticsCheck'") > 0 && mountSrc.indexOf("loggedPhone('wf.gitDiagnosticsWrite'") > 0, 'E21 三条电话都经 loggedPhone 包装：成功落 host.call、失败落 host.call.fail（界面侧统一走 host.call）')
  check(indexSrc.indexOf("wf.gitDiagnosticsRead") > 0 && indexSrc.indexOf("wf.gitDiagnosticsCheck") > 0 && indexSrc.indexOf("wf.gitDiagnosticsWrite") > 0 && /vcDiagnosticsReadTimeoutMs:\s*15000/.test(timeoutsSrc) && /vcDiagnosticsWriteTimeoutMs:\s*15000/.test(timeoutsSrc), 'E22 宿主注册与中央时间配置都接上了：三条电话各注册一次，两条超时键各一个值')
}

// F 组：反证（test-the-test）。改坏实现之后，前面 A/E 组用的那几条判据必须判红；
// 判据本身不会红，这扇门禁就只是把源码重抄了一遍。
function buildSharedFrom(text) {
  // 与构建同一套转译参数：先剥掉 export（这里不求模块语义），再用新的函数作用域取回要判的那几个。
  const body = text.replace(/^(\s*)export\s+/gm, '$1')
  const code = require('esbuild').transformSync(body, require('../scripts/lib/transpile-unit.mts').TRANSPILE_OPTIONS).code
  return new Function(code + '\nreturn { diagnosticsWriteArgvOf: diagnosticsWriteArgvOf, diagnosticsWritePlanOf: diagnosticsWritePlanOf }\n')()
}

async function antiGroup() {
  console.log('F 组：反证（篡改源文本必须判红）')
  const src = readText(DIAG_SOURCE)
  const real = buildSharedFrom(src)
  const planStart = { op: 'bisect-start', bad: BAD_OID, good: GOOD_OID }
  const wantStart = ['bisect', 'start', BAD_OID, GOOD_OID]
  const realArgvOk = sameList(real.diagnosticsWriteArgvOf(planStart), wantStart)
  const planPatched = src.replace("return ['bisect', 'start', text(p.bad), text(p.good)]", "return ['bisect', 'start', '--force', text(p.bad), text(p.good)]")
  const badPlanMod = buildSharedFrom(planPatched)
  check(realArgvOk && planPatched !== src && sameList(badPlanMod.diagnosticsWriteArgvOf(planStart), wantStart) === false, 'F1 反证：把开始二分的 argv 塞进一个多余开关，E2 那条判据立刻判红')

  const realGuardOk = real.diagnosticsWritePlanOf('bisect-start', { bad: '-x', good: GOOD_OID }).ok === false
  const guardPatched = src.replace('if (!isRev(b) || !isRev(g))', 'if (false)')
  const badGuardMod = buildSharedFrom(guardPatched)
  check(realGuardOk && guardPatched !== src && badGuardMod.diagnosticsWritePlanOf('bisect-start', { bad: '-x', good: GOOD_OID }).ok === true, 'F2 反证：去掉「版本名不许以 - 开头」的白名单校验，D12 那条判据立刻判红')

  const writeSrc = readText(WRITE_SOURCE)
  const guardText = 'ticket.confirmRequired === true && a.confirmed !== true'
  const confirmGuardHolds = function (s) { return s.indexOf(guardText) >= 0 && s.indexOf("'need-confirm'") >= 0 }
  check(confirmGuardHolds(writeSrc) && !confirmGuardHolds(writeSrc.replace(guardText, 'false')), 'F3 反证：把确认闸从执行层删掉（改成 false），E8 那条判据依赖的源码记号立刻被判红')

  const mountSrc = readText(MOUNT_SOURCE)
  const wrapHolds = function (s) { return s.indexOf("loggedPhone('wf.gitDiagnosticsWrite'") > 0 }
  check(wrapHolds(mountSrc) && !wrapHolds(mountSrc.replace("loggedPhone('wf.gitDiagnosticsWrite'", 'WRAPPED_OUT')), 'F4 反证：把执行电话从 loggedPhone 包装里拿出来，E21 那条判据立刻判红')
}

async function main() {
  console.log('')
  console.log('=== ' + GATE + '：域 13 十三条 + 5.12 替换对象 ===')
  console.log('')
  await sharedGroup()
  await decisionGroup()
  await readGroup()
  await checkGroup()
  await writeGroup()
  await antiGroup()
  console.log('')
  console.log('汇总：' + total + ' 条断言，' + failed + ' 条失败')
  printGateResult(GATE, total, failed)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(function (e) {
  console.error('门禁执行异常：' + String((e && e.stack) || e))
  process.exit(1)
})
