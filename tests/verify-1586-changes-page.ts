// 门禁归属: src/host/versionControlChangesMount.ts
// 改动页（#1742，规格域 1 的 1.1–1.13）门禁：协议与视图名单逐条对账、路径守卫、宿主预检与执行、
// 票据绑定、七个登记点与词条齐全。夹具全是注入的假依赖（读屏、跑命令、文件读写），不碰真 git。
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText, spliceableJs } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.ts')
const { localeDataText } = require('./lib/locale-data.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-changes-page'
let total = 0
let failed = 0
function check(ok: any, msg: string) { total += 1; if (!ok) { failed += 1; console.log('  FAIL ' + msg) } }

const digest16 = function (s: any) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16) }
const clock = { t: 1000 }
let idSeq = 0
const REPO = 'C:/repo'

/** 编译后的界面叶子：与 818 一样用 spliceableJs + compileFn 求值，不引入构建产物。 */
function makeLeaf() {
  const body = spliceableJs('src/client/views/versionControl/vcChangesPage.ts') + '\nreturn { VC_CHANGES_PHONES: VC_CHANGES_PHONES, VC_CHANGES_OPS: VC_CHANGES_OPS, vcChangesPageNode: vcChangesPageNode, vcChangesRowNode: vcChangesRowNode, vcChangesCheckArgsOf: vcChangesCheckArgsOf, vcChangesWriteArgsOf: vcChangesWriteArgsOf, vcChangesRequestIdOf: vcChangesRequestIdOf, vcChangesTargetOf: vcChangesTargetOf, vcChangesOpLabelKeyOf: vcChangesOpLabelKeyOf, vcChangesOpVerbKeyOf: vcChangesOpVerbKeyOf };'
  const fakeH = function (tag: any, props: any, children: any) { return { tag: tag, props: props || {}, children: children } }
  const fakeT = function (key: any, params: any) { return String(key) + (params ? '|' + JSON.stringify(params) : '') }
  return compileFn(['h', 't', 'vcWriteErrFamilyOf'], body)(fakeH, fakeT, function () { return 'notReady' })
}
function findAll(node: any, pred: any, out?: any[]) {
  const acc: any[] = out || []
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) { for (const x of node) findAll(x, pred, acc); return acc }
  if (pred(node)) acc.push(node)
  if (node.children !== undefined) findAll(node.children, pred, acc)
  return acc
}
function textOf(node: any): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') return textOf(node.children)
  return ''
}
function nodeWith(root: any, key: string, value: any) { return findAll(root, function (n: any) { return n.props && n.props[key] === value }) }

function makeScreen(over?: any) {
  return Object.assign({
    repo: { bare: false, merging: false, rebasing: false, cherryPicking: false, reverting: false },
    identity: { oid: 'a'.repeat(40), worktreePath: REPO },
    staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0,
  }, over || {})
}
const INDEX_ONE = '100644 ' + 'a'.repeat(40) + ' 0\t' + 'a.txt' + '\u0000'
const DIFF_ONE = ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1,2 +1,3 @@', ' a', '+b', ' c', ''].join('\n')

/** 预检夹具：读屏、只读命令、文件读取都是注入的；写命令一条都不许起。 */
function makeCheck(screen: any, over?: any) {
  const o: any = over || {}
  const tickets = o.tickets || new Map()
  const calls: any[] = []
  const deps: any = {
    readScreenOf: async function () { return { ok: true, screen: screen, gitVersion: o.gitVersion || '2.40.0' } },
    runRead: async function (cwd: any, args: any) {
      calls.push(args.slice())
      if (typeof o.runRead === 'function') { const hit = o.runRead(args); if (hit) return hit }
      if (args[0] === 'ls-files') return { kind: 'ok', stdout: (args.indexOf('--') >= 0) ? String(o.pathIndexText === undefined ? (o.indexText || '') : o.pathIndexText) : String(o.indexText || '') }
      if (args[0] === 'diff') return { kind: 'ok', stdout: o.diffText || '' }
      if (args[0] === 'clean') return { kind: 'ok', stdout: o.cleanText || '' }
      if (args[0] === 'check-ignore') return { kind: 'ok', stdout: o.checkIgnoreText || '' }
      return { kind: 'ok', stdout: '' }
    },
    readTextFile: async function () { return (o.gitignore === undefined) ? { ok: false, reason: 'missing' } : { ok: true, text: o.gitignore } },
    pathExists: async function () { return (o.pathExists === undefined) ? false : o.pathExists },
    failPhone: function (kind: any, reason: any, message: any) { return { ok: false, error: { kind: kind, reason: reason, message: message } } },
    nowMs: function () { return clock.t },
    randomId: function () { idSeq += 1; return 'tkt-' + idSeq },
    digest16: digest16,
    tickets: tickets,
    results: new Map(),
  }
  return { check: { handleChangesCheck: null }, deps: deps, tickets: tickets, calls: calls, impl: null }
}

/** 执行夹具：记录每一条写命令 argv 与文件写入，成功失败都按注入路线回。 */
function makeWrite(screen: any, over?: any, tickets?: any) {
  const o: any = over || {}
  const calls: any[] = []
  const tempPatches: any[] = []
  const deleted: any[] = []
  const wrote: any[] = []
  const deps: any = {
    readScreenOf: async function () { return { ok: true, screen: screen } },
    runCommand: async function (cwd: any, argv: any) {
      calls.push(argv.slice())
      if (typeof o.runCommand === 'function') { const hit = o.runCommand(argv); if (hit) return hit }
      if (argv[0] === 'ls-files') return { kind: 'ok', stdout: String(o.indexText || '') }
      if (argv[0] === 'diff') return { kind: 'ok', stdout: String(o.diffText || '') }
      if (argv[0] === 'clean') return { kind: 'ok', stdout: String(o.cleanText || '') }
      return { kind: 'ok', stdout: '' }
    },
    readTextFile: async function () { return (o.gitignore === undefined) ? { ok: false, reason: 'missing' } : { ok: true, text: o.gitignore } },
    writeTextFile: async function (cwd: any, rel: any, text: any) { wrote.push({ rel: rel, text: text }); return { ok: true } },
    writeTempPatch: async function (text: any) { tempPatches.push(text); return { ok: true, path: 'C:/tmp/p.patch' } },
    deleteFile: async function (p: any) { deleted.push(p) },
    nowMs: function () { return clock.t },
    digest16: digest16,
    tickets: tickets || new Map(),
    results: new Map(),
  }
  return { deps: deps, calls: calls, tempPatches: tempPatches, deleted: deleted, wrote: wrote }
}

function envelopeShape(e: any) {
  return e && e.ok === false && e.error && typeof e.error.kind === 'string' && typeof e.error.reason === 'string' && typeof e.error.message === 'string' && typeof e.error.hint === 'string' && Object.keys(e.error).length === 4
}

function reconcileViews(viewOps: any[], protoOps: any[]) {
  const problems: string[] = []
  if (viewOps.length !== protoOps.length + 2) problems.push('件数：视图 ' + viewOps.length + '，协议写 ' + protoOps.length + '（另两条只读）')
  const writes = viewOps.filter(function (x: any) { return x.write === true })
  if (writes.length !== protoOps.length) problems.push('写动作件数不一致')
  for (let i = 0; i < Math.min(writes.length, protoOps.length); i += 1) {
    const a: any = writes[i]
    const b: any = protoOps[i]
    if (a.op !== b.op || a.capId !== b.capId || a.write !== b.write || a.dangerous !== b.dangerous || a.reversible !== b.reversible) problems.push('第 ' + i + ' 条对不上：' + String(a.op) + '/' + String(b.op))
  }
  return problems
}

async function main() {
  const proto: any = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/changes-protocol.js')).href)
  const ledger: any = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/capability-ledger.js')).href)
  const checkMod: any = await import(pathToFileURL(path.join(ROOT, 'src/host/versionControlChangesCheck.js')).href)
  const writeMod: any = await import(pathToFileURL(path.join(ROOT, 'src/host/versionControlChangesWrite.js')).href)
  const leaf: any = makeLeaf()

  // ===== A 协议与视图名单对账 =====
  check(proto.CHANGES_WRITE_OPS.length === 11, 'A1 改动页写动作应为 11 条')
  check(proto.CHANGES_READ_OPS.length === 2, 'A2 改动页只读动作应为 2 条')
  const protoOps = proto.CHANGES_WRITE_OPS.concat(proto.CHANGES_READ_OPS)
  check(protoOps.length === 13, 'A3 改动页动作合计应为 13 条（能力 1.1–1.13）')
  const capIds = protoOps.map(function (x: any) { return x.capId }).sort()
  check(JSON.stringify(capIds) === JSON.stringify(['1.1', '1.10', '1.11', '1.12', '1.13', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9']), 'A4 13 条动作的 capId 必须正好盖住 1.1–1.13')
  check(protoOps.every(function (x: any) { return x.write === true ? (x.op !== undefined && x.command !== '') : (x.op !== undefined && x.command !== '') }), 'A5 每条动作都要有 op 与 command 说明')
  check(proto.CHANGES_WRITE_OPS.filter(function (x: any) { return x.dangerous === true }).length === 4, 'A6 危险写动作应为 4 条（丢弃单文件/整批/删未跟踪/删已跟踪）')
  check(proto.CHANGES_READ_OPS.every(function (x: any) { return x.write === false && x.dangerous === false }), 'A7 只读动作不许标成写或危险')
  check(proto.changesOpMetaOf('stage-file') !== null && proto.changesOpMetaOf('no-such-op') === null, 'A8 动作查表：认识的回元数据，不认识的回 null')
  const ledgerCaps = ledger.CAPABILITIES.filter(function (c: any) { return /^1\./.test(String(c.id)) })
  check(ledgerCaps.length === 13, 'A9 能力账本里 page=changes 的条目应为 13 条')
  check(ledgerCaps.every(function (c: any) { return c.primaryEntry === '改动页' }), 'A10 改动页 13 条能力的主入口都必须是「改动页」')
  check(ledgerCaps.every(function (c: any) { return protoOps.some(function (r: any) { return r.capId === c.id }) }), 'A11 能力账本 1.1–1.13 每条都要在协议里有对应动作')
  check(leaf.VC_CHANGES_OPS.length === 13, 'A12 界面视图名单必须有 13 条动作')
  check(reconcileViews(leaf.VC_CHANGES_OPS, proto.CHANGES_WRITE_OPS).length === 0, 'A13 视图名单与协议逐条同序：' + reconcileViews(leaf.VC_CHANGES_OPS, proto.CHANGES_WRITE_OPS).join('；'))
  check(leaf.VC_CHANGES_PHONES.check === 'wf.gitChangesCheck' && leaf.VC_CHANGES_PHONES.write === 'wf.gitChangesWrite', 'A14 改动页电话只能走 host.call 的两条登记电话')
  const planA: any = proto.makeChangesPlan({ op: 'stage-hunks', paths: ['a.txt'], hunkIndex: 0, patchDigest: 'x' })
  const planB: any = proto.makeChangesPlan({ op: 'stage-hunks', paths: ['a.txt'], hunkIndex: 1, patchDigest: 'x' })
  check(proto.changesPlanInput(planA) !== proto.changesPlanInput(planB), 'A15 逐块暂存换一块，票据绑定输入必须跟着变')

  // ===== B 路径守卫与参数形状 =====
  check(proto.pathArgProblem('dir/a.txt') === null, 'B1 普通相对路径必须放行')
  check(proto.pathArgProblem('--force') === 'option-like', 'B2 以短横线开头的路径必须拒（会被 git 当选项）')
  check(proto.pathArgProblem('C:/repo/a.txt') === 'absolute', 'B3 绝对路径必须拒')
  check(proto.pathArgProblem('..\\a.txt') === 'backslash', 'B4 反斜杠路径必须拒')
  check(proto.pathArgProblem('a/../b.txt') === 'dotdot-segment', 'B5 带 .. 段的路径必须拒')
  check(proto.pathArgProblem('a\u0001b') === 'control-char', 'B6 含控制字符的路径必须拒')
  check(proto.pathArgProblem('.git/config') === 'git-metadata', 'B7 命中 git 元数据目录的路径必须拒')
  check(proto.twoPathProblem('a.txt', 'a.txt') === 'same-path' || proto.twoPathProblem('a.txt', 'a.txt') !== null, 'B8 重命名两端相同必须拒')
  check(proto.ignoreLineOf('a.txt') === '/a.txt', 'B9 追加忽略写的行必须钉死在仓库根（前导斜杠）')
  const checkArgs = leaf.vcChangesCheckArgsOf('/repo', 'stage-file', { path: 'a.txt' })
  check(checkArgs.cwd === '/repo' && checkArgs.op === 'stage-file' && checkArgs.path === 'a.txt', 'B10 预检参数整形状：cwd/op/path 各自独立')
  const writeArgs = leaf.vcChangesWriteArgsOf('/repo', 'stage-file', { path: 'a.txt' }, 't1', 'r1')
  check(writeArgs.ticketId === 't1' && writeArgs.requestId === 'r1' && writeArgs.confirm === true && writeArgs.path === 'a.txt', 'B11 执行参数带票号、请求号与确认标记')
  check(leaf.vcChangesRequestIdOf(1000, 'a') !== leaf.vcChangesRequestIdOf(1000, 'b'), 'B12 请求号含盐：同一毫秒两次点击不会撞号')
  check(leaf.vcChangesTargetOf('stage-file', { path: 'a.txt' }, null) === 'a.txt', 'B13 单路径动作的确认目标就是路径')
  check(leaf.vcChangesTargetOf('mv', { from: 'a.txt', to: 'b.txt' }, null) === 'a.txt → b.txt', 'B14 重命名的确认目标写成「旧 → 新」')
  check(String(leaf.vcChangesTargetOf('stage-hunks', { path: 'a.txt', hunkIndex: 2 }, function (k: any) { return 'K:' + k })).indexOf('vc.changes.target.hunk') >= 0, 'B15 选块的确认目标走词条，不在界面写中文字面量')

  // ===== C 宿主预检 =====
  const mkCheck = function (screen: any, over?: any) { const box: any = makeCheck(screen, over); box.impl = checkMod.createChangesCheck(box.deps); return box }
  const cBad: any = mkCheck(makeScreen(), {})
  const rBad: any = await cBad.impl.handleChangesCheck({ cwd: REPO, op: 'no-such-op' })
  check(envelopeShape(rBad) && rBad.error.reason === 'bad-target', 'C1 不认识的动作回固定失败信封 bad-target')
  const screenStage = makeScreen({ unstaged: [{ path: 'a.txt', change: 'M' }], unstagedCount: 1 })
  const cStage: any = mkCheck(screenStage, { indexText: INDEX_ONE })
  const rStage: any = await cStage.impl.handleChangesCheck({ cwd: REPO, op: 'stage-file', path: 'a.txt' })
  check(rStage.ok === true && rStage.decision.verdict === 'allow', 'C2 单文件暂存预检：有未暂存改动就发允许票')
  check(rStage.ticket.expiresAtMs - rStage.ticket.checkedAtMs === 120000, 'C3 票据时限仍是 120 秒（只管预检新鲜度）')
  const tStage: any = cStage.tickets.get(rStage.ticket.id)
  check(tStage && tStage.bindings && typeof tStage.bindings.preconditions.planDigest === 'string' && tStage.bindings.preconditions.planDigest.length === 16 && typeof tStage.bindings.preconditions.worktreeDigest === 'string' && Array.isArray(tStage.bindings.preconditions.pathAbsent) && tStage.bindings.counters.indexEntries === 1, 'C4 票据绑定表落地：计划摘要/工作树摘要/缺失标记/索引条数')
  check(rStage.confirmRequired === false, 'C5 普通暂存不需要二次确认')
  const cDanger: any = mkCheck(makeScreen({ unstaged: [{ path: 'a.txt', change: 'M' }], unstagedCount: 1 }), { indexText: INDEX_ONE })
  const rDanger: any = await cDanger.impl.handleChangesCheck({ cwd: REPO, op: 'discard-all' })
  check(rDanger.ok === true && rDanger.confirmRequired === true, 'C6 危险动作的票必须要求二次确认')
  const rBadPath: any = await cStage.impl.handleChangesCheck({ cwd: REPO, op: 'stage-file', path: '--force' })
  check(envelopeShape(rBadPath) && rBadPath.error.reason === 'bad-path' && rBadPath.pathProblem === 'option-like', 'C7 路径守卫在预检就拦住选项注入')
  const cMerge: any = mkCheck(makeScreen({ repo: { bare: false, merging: true, rebasing: false, cherryPicking: false, reverting: false } }), {})
  check((await cMerge.impl.handleChangesCheck({ cwd: REPO, op: 'stage-all' })).error.reason === 'operation-in-progress', 'C8 合并进行中整组改动页动作先不接')
  const cBare: any = mkCheck(makeScreen({ repo: { bare: true, merging: false, rebasing: false, cherryPicking: false, reverting: false } }), {})
  check((await cBare.impl.handleChangesCheck({ cwd: REPO, op: 'stage-all' })).error.reason === 'repo-bare', 'C9 裸仓不能走改动页写动作')
  const cClean: any = mkCheck(makeScreen(), {})
  check((await cClean.impl.handleChangesCheck({ cwd: REPO, op: 'stage-all' })).error.reason === 'nothing-to-do', 'C10 工作区干净时暂存全部必须回 nothing-to-do')
  const cHunk: any = mkCheck(screenStage, { diffText: DIFF_ONE })
  check((await cHunk.impl.handleChangesCheck({ cwd: REPO, op: 'stage-hunks', path: 'a.txt', hunkIndex: 9 })).error.reason === 'hunk-out-of-range', 'C11 选块序号越界必须拒，不能随意挑一块')
  const cHunkOk: any = mkCheck(screenStage, { diffText: DIFF_ONE })
  const rHunkOk: any = await cHunkOk.impl.handleChangesCheck({ cwd: REPO, op: 'stage-hunks', path: 'a.txt', hunkIndex: 0 })
  check(rHunkOk.ok === true && typeof rHunkOk.plan.patchDigest === 'string' && rHunkOk.plan.patchDigest.length === 16, 'C12 逐块暂存的票据绑定到那一块补丁的摘要')
  const cIgn: any = mkCheck(makeScreen(), { checkIgnoreText: '.gitignore:3:*.log\tx.log\n' })
  const rIgn: any = await cIgn.impl.handleChangesCheck({ cwd: REPO, op: 'explain-ignored', path: 'x.log' })
  check(rIgn.ok === true && rIgn.ignored === true && rIgn.match && rIgn.match.line === 3 && rIgn.match.pattern === '*.log', 'C13 查为什么被忽略：命中时回规则来源与行号')
  const cIgnNo: any = mkCheck(makeScreen(), { runRead: function (args: any) { return args[0] === 'check-ignore' ? { kind: 'non-zero', exitCode: 1, stderr: '' } : null } })
  const rIgnNo: any = await cIgnNo.impl.handleChangesCheck({ cwd: REPO, op: 'explain-ignored', path: 'x.log' })
  check(rIgnNo.ok === true && rIgnNo.ignored === false, 'C14 查为什么被忽略：没命中回「没有规则命中」而不是失败')

  // ===== D 宿主执行 =====
  const ticketFor = async function (op: string, values: any, cOver?: any, screen?: any) {
    const sc = screen || screenStage
    const box: any = mkCheck(sc, Object.assign({ indexText: INDEX_ONE }, cOver || {}))
    const r: any = await box.impl.handleChangesCheck(Object.assign({ cwd: REPO, op: op }, values || {}))
    return { pre: r, tickets: box.tickets }
  }
  const wNoTicket: any = makeWrite(screenStage, {}, new Map())
  const wImpl0: any = writeMod.createChangesWrite(wNoTicket.deps)
  const rNoTicket: any = await wImpl0.handleChangesWrite({ cwd: REPO, op: 'stage-file', ticketId: 'none', requestId: 'r0' })
  check(envelopeShape(rNoTicket) && rNoTicket.error.reason === 'ticket-missing' && wNoTicket.calls.length === 0, 'D1 没有票据时零命令拒绝')
  const preStage: any = await ticketFor('stage-file', { path: 'a.txt' })
  clock.t = preStage.pre.ticket.expiresAtMs
  const wExpired: any = makeWrite(screenStage, {}, preStage.tickets)
  const wImplE: any = writeMod.createChangesWrite(wExpired.deps)
  check((await wImplE.handleChangesWrite({ cwd: REPO, op: 'stage-file', ticketId: preStage.pre.ticket.id, requestId: 'r-exp' })).error.reason === 'ticket-expired', 'D2 过期票据拒绝')
  check(wExpired.calls.length === 0, 'D3 过期票据零命令')
  clock.t = 1000
  const preStage2: any = await ticketFor('stage-file', { path: 'a.txt' })
  const wMiss: any = makeWrite(screenStage, {}, preStage2.tickets)
  const wImplM: any = writeMod.createChangesWrite(wMiss.deps)
  check((await wImplM.handleChangesWrite({ cwd: REPO, op: 'unstage', ticketId: preStage2.pre.ticket.id, requestId: 'r-miss' })).error.reason === 'ticket-op-mismatch', 'D4 换动作拿同一张票必须拒')
  const preStage3: any = await ticketFor('stage-file', { path: 'a.txt' })
  const wOk: any = makeWrite(screenStage, { indexText: INDEX_ONE }, preStage3.tickets)
  const wImpl: any = writeMod.createChangesWrite(wOk.deps)
  const rOk: any = await wImpl.handleChangesWrite({ cwd: REPO, op: 'stage-file', ticketId: preStage3.pre.ticket.id, requestId: 'r-ok' })
  const addCalls = wOk.calls.filter(function (a: any) { return a[0] === 'add' })
  check(rOk.ok === true && addCalls.length === 1 && JSON.stringify(addCalls[0]) === JSON.stringify(['add', '--', 'a.txt']), 'D5 执行 argv 每个参数独立且路径在 -- 之后')
  check(rOk.changed && rOk.changed.op === 'stage-file' && rOk.changed.paths[0] === 'a.txt' && rOk.ticketId === preStage3.pre.ticket.id, 'D6 成功回包里带动作、路径与票号（结果贴回触发点）')
  const rReplay: any = await wImpl.handleChangesWrite({ cwd: REPO, op: 'stage-file', ticketId: preStage3.pre.ticket.id, requestId: 'r-ok' })
  check(rReplay.ok === true && rReplay.reused === true && wOk.calls.filter(function (a: any) { return a[0] === 'add' }).length === 1, 'D7 同一请求号重放回上次结果，不重复执行写命令')
  const preStale: any = await ticketFor('stage-file', { path: 'a.txt' })
  const wStale: any = makeWrite(screenStage, { indexText: INDEX_ONE + INDEX_ONE.replace('a.txt', 'b.txt') }, preStale.tickets)
  const wImplS: any = writeMod.createChangesWrite(wStale.deps)
  check((await wImplS.handleChangesWrite({ cwd: REPO, op: 'stage-file', ticketId: preStale.pre.ticket.id, requestId: 'r-stale' })).error.reason === 'stale-index', 'D8 预检之后索引条数变了必须拒 stale-index')
  check(wStale.calls.filter(function (a: any) { return a[0] === 'add' }).length === 0, 'D9 索引变了绝不执行写命令')
  const preTree: any = await ticketFor('stage-file', { path: 'a.txt' })
  const wTree: any = makeWrite(makeScreen({ unstaged: [{ path: 'a.txt', change: 'D' }], unstagedCount: 1 }), { indexText: INDEX_ONE }, preTree.tickets)
  const wImplT: any = writeMod.createChangesWrite(wTree.deps)
  check((await wImplT.handleChangesWrite({ cwd: REPO, op: 'stage-file', ticketId: preTree.pre.ticket.id, requestId: 'r-tree' })).error.reason === 'target-changed', 'D10 工作树在这一步之前变了必须拒 target-changed')
  const preFail: any = await ticketFor('stage-file', { path: 'a.txt' })
  const wFail: any = makeWrite(screenStage, { indexText: INDEX_ONE, runCommand: function (argv: any) { if (argv[0] === 'add') return { kind: 'non-zero', exitCode: 128, stderr: 'fatal: something bad' } } }, preFail.tickets)
  const wImplF: any = writeMod.createChangesWrite(wFail.deps)
  const rFail: any = await wImplF.handleChangesWrite({ cwd: REPO, op: 'stage-file', ticketId: preFail.pre.ticket.id, requestId: 'r-fail' })
  check(envelopeShape(rFail) && rFail.error.kind === 'other' && rFail.error.message.indexOf('fatal: something bad') >= 0, 'D11 非零退出翻成固定失败信封并保留 git 原话')
  const preTo: any = await ticketFor('stage-file', { path: 'a.txt' })
  const wTo: any = makeWrite(screenStage, { indexText: INDEX_ONE, runCommand: function (argv: any) { if (argv[0] === 'add') return { kind: 'timeout' } } }, preTo.tickets)
  const wImplTo: any = writeMod.createChangesWrite(wTo.deps)
  const rTo: any = await wImplTo.handleChangesWrite({ cwd: REPO, op: 'stage-file', ticketId: preTo.pre.ticket.id, requestId: 'r-to' })
  check(envelopeShape(rTo) && rTo.error.kind === 'timeout', 'D12 超时给出明确失败，不挂起')
  const preHunk: any = await ticketFor('stage-hunks', { path: 'a.txt', hunkIndex: 0 }, { diffText: DIFF_ONE })
  const wHunk: any = makeWrite(screenStage, { indexText: INDEX_ONE, diffText: DIFF_ONE }, preHunk.tickets)
  const wImplH: any = writeMod.createChangesWrite(wHunk.deps)
  const rHunk: any = await wImplH.handleChangesWrite({ cwd: REPO, op: 'stage-hunks', ticketId: preHunk.pre.ticket.id, requestId: 'r-hunk' })
  const applyCalls = wHunk.calls.filter(function (a: any) { return a[0] === 'apply' })
  check(rHunk.ok === true && applyCalls.length === 1 && applyCalls[0].indexOf('--cached') >= 0 && applyCalls[0][applyCalls[0].length - 1] === 'C:/tmp/p.patch', 'D13 逐块暂存：临时补丁路径是一个独立参数')
  check(wHunk.tempPatches.length === 1 && wHunk.deleted.length === 1 && wHunk.deleted[0] === 'C:/tmp/p.patch', 'D14 临时补丁用完就删，失败也不留垃圾')
  const screenClean = makeScreen({ unstaged: [{ path: 'x.txt', change: 'untracked' }], unstagedCount: 1 })
  const preClean: any = await ticketFor('clean-untracked', { path: 'x.txt' }, { cleanText: 'Would remove x.txt\n' }, screenClean)
  const wClean: any = makeWrite(screenClean, { indexText: INDEX_ONE, cleanText: 'Would remove x.txt\n' }, preClean.tickets)
  const wImplC: any = writeMod.createChangesWrite(wClean.deps)
  const rClean: any = await wImplC.handleChangesWrite({ cwd: REPO, op: 'clean-untracked', ticketId: preClean.pre.ticket.id, requestId: 'r-clean' })
  const cleanCalls = wClean.calls.filter(function (a: any) { return a[0] === 'clean' })
  check(rClean.ok === true && cleanCalls.length === 2 && JSON.stringify(cleanCalls[1]) === JSON.stringify(['clean', '-fd', '--', 'x.txt']), 'D15 删未跟踪文件：先重列清单复核一致，再按独立参数执行删除')
  const preIgn: any = await ticketFor('ignore', { path: 'x.log' }, {}, makeScreen())
  const wIgn: any = makeWrite(makeScreen(), { indexText: INDEX_ONE, gitignore: undefined }, preIgn.tickets)
  const wImplI: any = writeMod.createChangesWrite(wIgn.deps)
  const rIgnWrite: any = await wImplI.handleChangesWrite({ cwd: REPO, op: 'ignore', ticketId: preIgn.pre.ticket.id, requestId: 'r-ign' })
  check(rIgnWrite.ok === true && wIgn.wrote.length === 1 && wIgn.wrote[0].rel === '.gitignore' && wIgn.wrote[0].text.indexOf('/x.log') >= 0, 'D16 追加忽略：改写仓库根 .gitignore 的完整新文本')
  const screenMv = makeScreen()
  const preMv: any = await ticketFor('mv', { path: 'x.txt', to: 'y.txt' }, { indexText: INDEX_ONE.replace('a.txt', 'x.txt'), pathIndexText: INDEX_ONE.replace('a.txt', 'x.txt') }, screenMv)
  check(preMv.pre.ok === true, 'D17 重命名预检：已跟踪且目标不存在时发允许票')
  const wMv: any = makeWrite(screenMv, { indexText: INDEX_ONE.replace('a.txt', 'x.txt') }, preMv.tickets)
  const wImplMv: any = writeMod.createChangesWrite(wMv.deps)
  const rMv: any = await wImplMv.handleChangesWrite({ cwd: REPO, op: 'mv', ticketId: preMv.pre.ticket.id, requestId: 'r-mv' })
  const mvCalls = wMv.calls.filter(function (a: any) { return a[0] === 'mv' })
  check(rMv.ok === true && mvCalls.length === 1 && JSON.stringify(mvCalls[0]) === JSON.stringify(['mv', '--', 'x.txt', 'y.txt']), 'D18 重命名 argv：两端各自独立参数')

  // ===== E 登记点与词条 =====
  const leafSrcForOps = sourceText('src/client/views/versionControl/vcChangesPage.ts')
  const mountSrc = sourceText('src/host/versionControlChangesMount.ts')
  check(mountSrc.indexOf('export function createChangesMount') >= 0 && mountSrc.indexOf('createChangesPhone') >= 0, 'E1 装配外壳在册：导出 createChangesMount 并懒加载执行叶子')
  const parentSrc = sourceText('src/host/versionControl.ts')
  check(parentSrc.indexOf('createChangesMount') >= 0 && parentSrc.indexOf('handleGitChangesCheck') >= 0 && parentSrc.indexOf('handleGitChangesWrite') >= 0 && parentSrc.indexOf('changesTickets') >= 0, 'E2 父装配文件转出两条电话与只读票表')
  const indexSrc = sourceText('src/host/index.ts')
  check(indexSrc.indexOf("harness.handle('wf.gitChangesCheck'") >= 0 && indexSrc.indexOf('h.handleGitChangesCheck') >= 0 && indexSrc.indexOf("harness.handle('wf.gitChangesWrite'") >= 0 && indexSrc.indexOf('h.handleGitChangesWrite') >= 0, 'E3 宿主注册：两条电话各有注册行与转调')
  check(indexSrc.indexOf("harness.handle('wf.gitChangesCheck'") >= 0 && (indexSrc.split("harness.handle('wf.gitChangesCheck'").length - 1) === 1, 'E4 宿主注册不重复登记')
  const buildSrc = sourceText('scripts/build.mts')
  check(buildSrc.indexOf("id: 'vcChangesPage'") >= 0 && buildSrc.indexOf('vcChangesPage.ts') >= 0, 'E5 构建叶子清单登记了改动页')
  const clientSrc = sourceText('src/client/index.ts')
  check(clientSrc.indexOf('leaf:vcChangesPage') >= 0, 'E6 客户端入口有 leaf:vcChangesPage 拼接标记')
  const timeoutsSrc = sourceText('config/timeouts.yaml')
  check(timeoutsSrc.indexOf('vcChangesReadTimeoutMs') >= 0 && timeoutsSrc.indexOf('vcChangesWriteTimeoutMs') >= 0, 'E7 超时配置登记了改动页读、写两条')
  const checkSrc = sourceText('src/host/versionControlChangesCheck.ts')
  const writeSrc = sourceText('src/host/versionControlChangesWrite.ts')
  check(checkSrc.indexOf('VC_CHANGES_READ_TIMEOUT_MS') >= 0 && writeSrc.indexOf('VC_CHANGES_WRITE_TIMEOUT_MS') >= 0, 'E8 两个叶子各自使用登记过的超时常量')
  const shellSrc = sourceText('src/client/views/versionControl/vcShellPages.ts')
  check(shellSrc.indexOf('vcChangesPageNode') >= 0 && shellSrc.indexOf("page === 'changes'") >= 0 && shellSrc.indexOf("opts.changes !== undefined") >= 0 && shellSrc.indexOf('changes: opts.changes') >= 0, 'E9 页面壳只在传了改动页数据时挂载，旧渲染不受影响')
  check(proto.CHANGES_WRITE_OPS.every(function (m: any) { return checkSrc.indexOf("'" + m.op + "'") >= 0 }), 'E10 七个登记点之一：预检判定分支覆盖 11 个写动作')
  check(proto.CHANGES_WRITE_OPS.every(function (m: any) { return writeSrc.indexOf("'" + m.op + "'") >= 0 }), 'E11 七个登记点之二：执行叶子覆盖 11 个写动作')
  check(proto.CHANGES_WRITE_OPS.every(function (m: any) { return leafSrcForOps.indexOf("'" + m.op + "'") >= 0 }), 'E12 界面视图名单逐条列出 11 个写动作（不靠协议运行时求值）')
  const opNames = proto.CHANGES_WRITE_OPS.map(function (m: any) { return "op === '" + m.op + "'" })
  check(opNames.every(function (s: any) { return checkSrc.indexOf(s) >= 0 }), 'E13 判定分支按 op 逐条分叉，不落进 unknown-operation')
  const localeText = localeDataText()
  const yamlText = fs.readFileSync(path.join(ROOT, 'config/copy/vcchanges.yaml'), 'utf8')
  const yamlKeys: string[] = []
  const keyRe = /^\s{2}(vc\.[A-Za-z0-9.]+):/gm
  let km: any
  while ((km = keyRe.exec(yamlText)) !== null) yamlKeys.push(km[1])
  check(yamlKeys.length >= 60, 'E14 改动页词条族至少 60 条')
  check(yamlKeys.every(function (k: string) { return localeText.indexOf("'" + k + "'") >= 0 }), 'E15 词条都进了生成的常量表')
  const leafKeys: string[] = []
  const leafSrc = sourceText('src/client/views/versionControl/vcChangesPage.ts')
  const leafKeyRe = /t\('(vc\.[A-Za-z0-9.]+)'/g
  let lm: any
  while ((lm = leafKeyRe.exec(leafSrc)) !== null) leafKeys.push(lm[1])
  check(leafKeys.length >= 10 && leafKeys.filter(function (k: string) { return k.charAt(k.length - 1) !== '.' }).every(function (k: string) { return yamlKeys.indexOf(k) >= 0 }), 'E16 界面里直接写的词条键都能在词条族里找到（动态前缀 vc.writeErr. 不算静态键）')
  const expectOps = proto.CHANGES_WRITE_OPS.concat(proto.CHANGES_READ_OPS)
  check(expectOps.every(function (m: any) {
    const camel = String(m.op).split('-').map(function (s: string, i: number) { return i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1) }).join('')
    return yamlKeys.indexOf('vc.changes.op.' + camel) >= 0 && yamlKeys.indexOf('vc.changes.op.verb.' + camel) >= 0
  }), 'E17 13 条动作各有名称与动词两条词条')
  check(['vc.changes.confirm.what', 'vc.changes.confirm.wont', 'vc.changes.confirm.reversible', 'vc.changes.confirm.verb', 'vc.changes.badge.danger', 'vc.changes.badge.irreversible', 'vc.changes.result.fail', 'vc.changes.result.retry', 'vc.writeErr.notReady', 'vc.writeErr.stale'].every(function (k: string) { return localeText.indexOf("'" + k + "'") >= 0 }), 'E18 确认卡、徽标、失败重试与失败话术族的词条齐全')
  const noChinese = leafSrc.split(/\r?\n/).filter(function (line: string) { return !/^\s*\/\//.test(line) }).join('\n').replace(/\/\/[^\n]*/g, '')
  check(!/[\u4e00-\u9fa5]/.test(noChinese), 'E19 界面叶子除注释外没有中文字面量（可见文字全走词条）')
  check(noChinese.indexOf("'vc.changes.target.hunk'") >= 0, 'E20 选块确认目标那句走词条而不是拼中文')
  const brokenA = proto.CHANGES_WRITE_OPS.slice(0, 10)
  check(reconcileViews(leaf.VC_CHANGES_OPS, brokenA).length > 0, 'E21 反证自检：协议少登记一条时对账必须报错')
  const brokenB = leaf.VC_CHANGES_OPS.map(function (x: any) { return Object.assign({}, x, { dangerous: false }) })
  check(reconcileViews(brokenB, proto.CHANGES_WRITE_OPS).length > 0, 'E22 反证自检：危险标记被改掉时对账必须报错')
  check(reconcileViews(leaf.VC_CHANGES_OPS.slice(0, 12), proto.CHANGES_WRITE_OPS).length > 0, 'E23 反证自检：视图少一条时对账必须报错')

  await printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e: any) { console.log('  FAIL 门禁自身异常：' + String((e && e.stack) || e)); process.exit(1) })
