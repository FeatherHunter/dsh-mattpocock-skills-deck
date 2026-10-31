// tests/verify-1586-branches.ts —— 分支与标签域门禁（规格 #1586 域 4 / 票 #1746 的 T11，返工后）
// 门禁归属: src/shared/version-control/src/branch-decisions.ts
// 门禁归属: src/shared/version-control/src/branch-ticket.ts
// 门禁归属: src/shared/version-control/src/parse-branch.ts
// 门禁归属: src/host/versionControlBranch.ts
// 门禁归属: src/host/versionControlBranchCheck.ts
// 门禁归属: src/host/versionControlBranchWrite.ts
// 门禁归属: src/host/versionControlBranchMount.ts
// 门禁归属: src/client/views/versionControl/vcBranches.ts
//
// 守什么：域 4 十三条能力（4.1–4.13）在面板上各有一条唯一主入口，命令原文与共享层一致；写动作走
// 三段式（预检 wf.gitBranchCheck 签 120 秒票 → block 直接拒 / warn 要确认 → 凭票执行 wf.gitBranchWrite）；
// 4.6 删除与 4.3 切换的未保存改动保护；4.13 分支说明只改本地配置（不推送）；4.12 验签退出码非零照实报。
// 返工后新增：票过期 / 换动作 / 目标变了三种零进程拒绝、同一 requestId 重放只执行一次，
// 以及七处登记点（预检判定分支、执行 argv 分支、宿主注册、电话表、超时配置）逐项断言。
// 五组断言：A 共享判定与取名规则、B 命令 argv、C 解析器、D 客户端数据层与业务面板、
// E 真宿主假路由（预检→执行）、F 反证组、G 七登记点。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-branches.ts
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')
const { compileFn } = require('./lib/eval-probe.ts')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText } = require('./lib/source-text.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-branches'
const OID = 'a'.repeat(40)
const OID2 = 'b'.repeat(40)
const OID3 = 'c'.repeat(40)
const T0 = 1790000000000
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const readJson = (rel) => JSON.parse(read(rel))
const sharedUrl = (f) => pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', f)).href
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const CLIENT_FILES = ['src/shared/version-control/src/branch-decisions.ts', 'src/client/views/versionControl/vcBranches.ts']
const CLIENT_EXPORTS = ['BRANCH_REASONS', 'BRANCH_REASON_IDS', 'BRANCH_OP_IDS', 'BRANCH_WRITE_KINDS', 'branchNameProblem', 'tagNameProblem',
  'upstreamNameProblem', 'descriptionTextProblem', 'decideBranchSwitch', 'decideBranchDelete', 'decideBranchCreate', 'decideTagCreate',
  'decideDescriptionWrite', 'branchReasonText', 'VC_BRANCHES_PHONE', 'VC_BRANCH_CHECK_PHONE', 'VC_BRANCH_WRITE_PHONE', 'VC_BRANCH_BOARD_CONTRACT',
  'VC_BRANCH_BOARD_VERSION', 'VC_BRANCH_CHECK_CONTRACT', 'VC_BRANCH_CHECK_VERSION', 'VC_BRANCH_OP_IDS', 'VC_BRANCH_WRITE_OPS', 'VC_BRANCH_ACTIONS',
  'vcNewBranchRead', 'vcBranchShapeOk', 'vcBranchCheckShapeOk', 'vcReadBranches', 'vcBranchBoardOf', 'vcBranchDegradedOf', 'vcBranchStateOf', 'vcBranchCheckOf',
  'vcBranchWriteResultOf', 'vcBranchTicketOf', 'vcBranchCheckDecisionOf', 'vcBranchRequestOf', 'vcBranchCheck', 'vcBranchWrite',
  'vcBranchCheckKindOf', 'vcBranchReplyKindOf', 'vcBranchReasonsOf', 'vcBranchConfirmOf', 'vcBranchResultOf', 'vcBranchBoardNode', 'VC_BRANCHES_SOURCE']
const stripExports = (s) => s.replace(/^(\s*)export\s+/gm, '$1')
const toEvalJs = (code) => require('esbuild').transformSync(code, TRANSPILE_OPTIONS).code
function buildClient(patch) {
  const raw = CLIENT_FILES.map(function (f) { return stripExports(sourceText(f)) }).join('\n')
  const patched = patch ? patch(raw) : raw
  const body = toEvalJs(patched) + '\nreturn { ' + CLIENT_EXPORTS.join(', ') + ' }\n'
  const logs = []
  const fn = compileFn(['log', 'dswsLogHash', 'dswsLogTrunc', 'vcShellConfirmCardNode', 'vcShellResultNode'], body)
  const v = fn(function (l, e, f) { logs.push({ level: l, event: e, fields: f }) }, function () { return 'h8' }, function (s) { return String(s) },
    function (h, t, o) { return { type: 'confirm', props: o || {}, children: [] } },
    function (h, t, o) { return { type: 'result', props: o || {}, children: [] } })
  return { v: v, logs: logs, changed: patched !== raw }
}

// 假 h：把树画成 { type, props, children }，门禁按 data 属性数入口。
function fakeH(type, props) {
  const p = props || {}
  const kids = []
  for (let i = 2; i < arguments.length; i += 1) { const c = arguments[i]; if (Array.isArray(c)) kids.push.apply(kids, c); else if (c !== null && c !== undefined && c !== false) kids.push(c) }
  return { type: type, props: p, children: kids }
}
function walk(node, out) {
  if (!node || typeof node !== 'object') return out
  out.push(node)
  const kids = node.children || []
  for (let i = 0; i < kids.length; i += 1) walk(kids[i], out)
  return out
}
function attrsOf(tree, name) {
  const all = walk(tree, [])
  const out = []
  for (let i = 0; i < all.length; i += 1) { const v = all[i] && all[i].props ? all[i].props[name] : undefined; if (v !== undefined && v !== null) out.push(String(v)) }
  return out
}
const tZh = function (key) { return String(key) }

// ---------- 快照与假电话 ----------
const BOARD = {
  contract: 'version-control.branch-board', version: 1, readAtMs: T0,
  current: { name: 'main', oid: OID },
  branches: [
    { name: 'main', oid: OID, current: true, upstream: 'origin/main', ahead: 2, behind: 1, commitDateMs: T0 },
    { name: 'feature', oid: OID2, current: false, upstream: '', ahead: 0, behind: 0, commitDateMs: 1780000000000 },
  ],
  tags: [
    { name: 'v1.0.0', oid: OID, objectType: 'commit', annotated: false, atMs: T0, subject: '首个版本' },
    { name: 'v1.1.0', oid: OID2, objectType: 'tag', annotated: true, atMs: 1795000000000, subject: '第二版' },
  ],
  descriptions: { main: '主干；发布从这里切', feature: '' },
  merged: ['main'],
  notMerged: ['feature'],
}
const CHECK_OK = {
  ok: true, contract: 'version-control.branch-check', version: 1, readAtMs: T0, op: 'delete',
  decision: { verdict: 'warn', reasons: ['force-delete'] }, reasons: ['force-delete'], confirmRequired: true,
  confirm: { kind: 'delete', target: 'feature', verb: '删除分支 feature（未并入，会丢提交）' },
  ticket: { id: 't-1', op: 'delete', checkedAtMs: T0, expiresAtMs: T0 + 120000 },
  scene: { current: 'main', dirty: true, conflicts: false, midOperation: false, targetOid: OID2, descriptionOld: null, upstreamOld: null, merged: false },
}
const CHECK_BLOCKED = {
  ok: false, error: { kind: 'blocked', message: '不能删除当前分支（理由：cannot-delete-current）' },
  contract: 'version-control.branch-check', version: 1, readAtMs: T0, op: 'delete', reason: 'cannot-delete-current',
  decision: { verdict: 'block', reasons: ['cannot-delete-current'] }, reasons: ['cannot-delete-current'],
  confirm: { kind: 'delete', target: 'main', verb: '删除分支 main' },
  scene: { current: 'main', dirty: true, conflicts: false, midOperation: false, targetOid: OID, descriptionOld: null, upstreamOld: null, merged: true },
}
function fakeCall(reply) {
  const calls = []
  const call = function (phone, args) { calls.push({ phone: phone, args: args }); return Promise.resolve(typeof reply === 'function' ? reply(calls.length, phone, args) : reply) }
  return { call: call, calls: calls }
}

// ---------- 假 subprocess 适配器 ----------
const LIVE = readJson('tests/fixtures/version-control/live-numstat-shapes.json')
const LIVE_ROOT = /^worktree ([^\u0000\n]+)/.exec(LIVE.worktrees.out)[1]
const TAGS_OUT = ['v1.0.0', OID, 'commit', '1790000000', '首个版本'].join('\u0000') + '\n' + ['v1.1.0', OID2, 'tag', '1795000000', '第二版'].join('\u0000') + '\n'
const MERGED_OUT = '  main\n'
const NOTMERGED_OUT = '  feature\n'
function makeCollector(text, truncated) { return { finalize() { return { text: String(text), truncated: truncated === true } } } }
function afterPrefix(argv) { const at = argv.indexOf('i18n.logOutputEncoding=UTF-8'); return at < 0 ? null : argv.slice(at + 1) }
// 每次造路由给一份可变现场：目标分支 oid、分支说明、已验证与否都能在签票之后改，
//   用来验证「执行前重算现场、变了就零进程拒绝」这一条。
function makeRoute(opts) {
  const o = opts || {}
  const state = { featureOid: OID2, featureDesc: '', mainDesc: '主干；发布从这里切' }
  const seen = []
  function refsOut() {
    return [
      ['refs/heads/main', 'main', OID, 'origin/main', '[ahead 2, behind 1]', '*', '2026-10-04T00:14:04+08:00'].join('\u0000'),
      ['refs/heads/feature', 'feature', state.featureOid, '', '', ' ', '2025-10-04T00:14:04+08:00'].join('\u0000'),
    ].join('\n') + '\n'
  }
  function descriptionsOut() {
    return 'branch.main.description\n' + state.mainDesc + '\u0000' + (state.featureDesc ? 'branch.feature.description\n' + state.featureDesc + '\u0000' : '')
  }
  function route(argv) {
    seen.push(argv.slice())
    const a = afterPrefix(argv)
    if (a === null) return { code: 1, stderr: '缺少固定前缀' }
    if (argv.indexOf('--version') >= 0) return { code: 0, stdout: (o.version || LIVE.source.gitVersion) + '\n' }
    if (a[0] === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) return o.noRepo ? { code: 1, stdout: '', stderr: 'fatal: not a git repository\n' } : { code: LIVE.step0.code, stdout: LIVE.step0.out, stderr: LIVE.step0.err }
    if (a[0] === 'rev-parse' && a.indexOf('--show-toplevel') >= 0) return { code: 0, stdout: LIVE_ROOT + '\n' }
    if (a[0] === 'rev-parse' && a.indexOf('--verify') >= 0) return o.fail && o.fail.rev ? { code: 1, stdout: '', stderr: 'fatal: bad revision\n' } : { code: 0, stdout: (o.revOid || OID) + '\n' }
    if (a[0] === 'status') return o.fail && o.fail.status ? { code: 1, stdout: '', stderr: 'fatal: status 失败\n' } : { code: LIVE.status.code, stdout: LIVE.status.out, stderr: LIVE.status.err }
    if (a[0] === 'worktree') return { code: LIVE.worktrees.code, stdout: LIVE.worktrees.out, stderr: LIVE.worktrees.err }
    if (a[0] === 'for-each-ref') {
      if (a.indexOf('refs/tags/') >= 0) return o.fail && o.fail.tags ? { code: 1, stdout: '', stderr: 'fatal: tags 失败\n' } : { code: 0, stdout: TAGS_OUT }
      return o.fail && o.fail.refs ? { code: 1, stdout: '', stderr: 'fatal: refs 失败\n' } : { code: 0, stdout: refsOut() }
    }
    if (a[0] === 'branch' && a[1] === '--merged') return { code: 0, stdout: MERGED_OUT }
    if (a[0] === 'branch' && a[1] === '--no-merged') return { code: 0, stdout: NOTMERGED_OUT }
    if (a[0] === 'config' && a.indexOf('--get-regexp') >= 0) {
      if (o.fail && o.fail.descriptions) return { code: 2, stdout: '', stderr: 'fatal: bad config\n' }
      return { code: o.noDescriptions ? 1 : 0, stdout: o.noDescriptions ? '' : descriptionsOut(), stderr: '' }
    }
    if (a[0] === 'config' && a.indexOf('--get') >= 0) {
      const key = String(a[a.length - 1] || '')
      const values = o.configValues || {}
      if (Object.prototype.hasOwnProperty.call(values, key)) return { code: 0, stdout: values[key] + '\n' }
      return { code: 1, stdout: '', stderr: '' }
    }
    if (a[0] === 'verify-commit' || a[0] === 'verify-tag') return o.verified ? { code: 0, stdout: 'Good signature\n', stderr: '' } : { code: 1, stdout: '', stderr: 'error: no signature found\n' }
    if (a[0] === 'switch' || a[0] === 'checkout' || a[0] === 'branch' || a[0] === 'tag' || a[0] === 'config') {
      if (o.fail && o.fail.write) return { code: 1, stdout: '', stderr: 'fatal: 写失败（假）\n' }
      return { code: 0, stdout: '', stderr: '' }
    }
    if (a[0] === 'log') return { code: LIVE.log.code, stdout: LIVE.log.out, stderr: LIVE.log.err }
    if (a[0] === 'diff' && a.indexOf('--numstat') >= 0) return { code: LIVE.diffFiles.code, stdout: LIVE.diffFiles.out, stderr: LIVE.diffFiles.err }
    if (a[0] === 'stash') return { code: 0, stdout: '' }
    if (a[0] === 'reflog') return { code: 128, stdout: '', stderr: 'fatal: bad revision\n' }
    return { code: 0, stdout: '' }
  }
  return { route: route, seen: seen, state: state }
}
function makeHostDeps(route, clock) {
  const logs = []
  const deps = {
    subprocess: { spawn(req) { const hit = route(req.argv) || { code: 0, stdout: '' }; return { done: Promise.resolve({ exitCode: hit.code === undefined ? 0 : hit.code, signal: hit.signal }), collected: { stdout: makeCollector(hit.stdout || '', hit.truncated), stderr: makeCollector(hit.stderr || '', false) }, terminate() {} } } },
    timer: { timeout() { return new Promise(function (resolve) { setTimeout(resolve, 1) }) } },
    fs: { stat() { return Promise.reject(Object.assign(new Error('没有这个文件'), { code: 'ENOENT' })) }, lstat() { return Promise.resolve(null) }, exists() { return Promise.resolve(false) } },
    getPlatform: async function () { return { resolveExecutable: async function (name) { return name === 'git' ? 'git' : null } } },
    DEFAULT_CWD: 'D:/假工作区/repo', TIMEOUT_MS: 30000, gate: { noteOutbound() {} },
    logCtx: { fire(level, event, fields) { logs.push({ level: level, event: event, fields: fields }) } },
    now: function () { return clock ? clock.t : T0 },
  }
  return { deps: deps, logs: logs }
}
// 真 git 适配器：形状与宿主注入的 subprocess 一样，但把命令真的交给本机 git。
// 只为一件假路由说不清的事：git config --unset-all 在键不存在时退 5 且无输出，那表示「本来就没有」。
function makeRealDeps() {
  const logs = []
  const deps = {
    subprocess: { spawn(req) {
      const r = spawnSync(req.argv[0], req.argv.slice(1), { cwd: req.cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 })
      const mk = function (t) { return { finalize() { return { text: String(t || ''), truncated: false } } } }
      return { done: Promise.resolve({ exitCode: r.status === null ? 1 : r.status }), collected: { stdout: mk(r.stdout), stderr: mk(r.stderr) }, terminate() {} }
    } },
    timer: { timeout() { return new Promise(function (resolve) { setTimeout(resolve, 1) }) } },
    fs: { stat() { return Promise.reject(Object.assign(new Error('没有这个文件'), { code: 'ENOENT' })) }, lstat() { return Promise.resolve(null) }, exists() { return Promise.resolve(false) } },
    getPlatform: async function () { return { resolveExecutable: async function (name) { return name === 'git' ? 'git' : null } } },
    DEFAULT_CWD: ROOT, TIMEOUT_MS: 30000, gate: { noteOutbound() {} },
    logCtx: { fire(level, event, fields) { logs.push({ level: level, event: event, fields: fields }) } },
    now: function () { return T0 },
  }
  return { deps: deps, logs: logs }
}
// 造一个真临时仓库：一条空提交 + 一个没有说明的分支 no-desc。
function mkGateRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1586b-'))
  const git = function (args) {
    const r = spawnSync('git', args, { cwd: base, encoding: 'utf8', windowsHide: true })
    return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') }
  }
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'x'])
  git(['config', 'user.email', 'x@y'])
  git(['commit', '-q', '--allow-empty', '-m', '基线'])
  git(['branch', 'no-desc'])
  return { dir: base, git: git }
}
// 写命令计数：只数真正改仓库的那几条（读分支名单用的是 branch --merged / --no-merged，不算写）。
function writeCmds(seen) {
  const out = []
  for (let i = 0; i < seen.length; i += 1) {
    const a = afterPrefix(seen[i])
    if (!a) continue
    if (a[0] === 'branch' && (a[1] === '--merged' || a[1] === '--no-merged' || a[1] === '-a')) continue
    // config 的读法（--get / --get-regexp）也以 config 开头，但一个字节都不改仓库，不算写命令。
    if (a[0] === 'config' && a.some(function (t) { return String(t).indexOf('--get') === 0 })) continue
    if (a[0] === 'switch' || a[0] === 'checkout' || a[0] === 'branch' || a[0] === 'tag' || a[0] === 'config') out.push(a.join(' '))
  }
  return out
}
// 签一张票：先预检拿票，返回票与预检回包。
function ticketOf(reply) { return reply && reply.ok === true && reply.ticket ? reply.ticket : null }

async function main() {
  console.log('分支与标签域门禁（#1746 T11 返工：预检签票 + 凭票执行 + 共享判定 + 命令 argv + 客户端面板 + 真宿主 + 七登记点 + 反证）')
  const BD = await import(sharedUrl('branch-decisions.js'))
  const BT = await import(sharedUrl('branch-ticket.js'))
  const PB = await import(sharedUrl('parse-branch.js'))
  const CM = await import(sharedUrl('commands.js'))
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const ledger = await import(sharedUrl('capability-ledger.js'))
  const WR = await import(sharedUrl('write-reasons.js'))

  // A 组：共享判定与取名规则
  check(BD.BRANCH_OP_IDS.join(',') === '4.1,4.2,4.3,4.4,4.5,4.6,4.7,4.8,4.9,4.10,4.11,4.12,4.13', 'A1 域 4 能力号恰好 4.1–4.13（实得 ' + BD.BRANCH_OP_IDS.join(',') + '）')
  check(BD.BRANCH_WRITE_KINDS.length === 10 && BD.BRANCH_WRITE_KINDS.indexOf('tag-create') >= 0, 'A2 十个写动作 kind 齐全')
  check(BD.BRANCH_REASON_IDS.length === Object.keys(BD.BRANCH_REASONS).length && new Set(BD.BRANCH_REASON_IDS).size === BD.BRANCH_REASON_IDS.length, 'A3 理由表标识符唯一')
  check(BD.BRANCH_REASON_IDS.every(function (id) { return typeof BD.BRANCH_REASONS[id] === 'string' && BD.BRANCH_REASONS[id] !== '' }), 'A4 每条理由都有中文句子')
  check(BD.branchReasonText('cannot-delete-current') === BD.BRANCH_REASONS['cannot-delete-current'], 'A5 理由取句子与固定表同源')
  check(BD.branchReasonText('不存在的理由') === BD.BRANCH_REASONS.ok, 'A6 不认识的理由回 ok 句（不编原文）')
  check(BD.branchNameProblem('feature/x') === null && BD.branchNameProblem('-bad') === 'bad-branch-name' && BD.branchNameProblem('a..b') === 'bad-branch-name', 'A7 分支取名规则：正常名放行、以 - 开头与 .. 拒')
  check(BD.branchNameProblem('a b') === 'bad-branch-name' && BD.branchNameProblem('a\u0000b') === 'bad-branch-name' && BD.branchNameProblem('tail.') === 'bad-branch-name', 'A8 分支取名规则：空白 / NUL / 结尾点号拒')
  check(BD.tagNameProblem('-v1') === 'bad-tag-name' && BD.tagNameProblem('v1.0.0') === null, 'A9 标签取名规则与分支同一套（理由标识符换名）')
  check(BD.upstreamNameProblem('origin/main') === null && BD.upstreamNameProblem('main') === 'bad-upstream' && BD.upstreamNameProblem('-x') === 'bad-upstream', 'A10 上游必须写成「远端名/分支名」')
  check(BD.decideBranchSwitch({}).verdict === 'allow' && BD.decideBranchSwitch({ stagedCount: 1 }).reasons[0] === 'unsaved-changes', 'A11 切分支：干净放行，有未提交改动先提醒')
  check(BD.decideBranchSwitch({ merging: true }).verdict === 'block' && BD.decideBranchSwitch({ rebasing: true }).reasons[0] === 'mid-operation', 'A12 切分支：中途操作直接拦')
  check(BD.decideBranchSwitch({ conflictCount: 2 }).reasons[0] === 'conflicts-unresolved', 'A13 切分支：有未解决冲突直接拦')
  check(BD.decideBranchDelete({ current: true }).reasons[0] === 'cannot-delete-current' && BD.decideBranchDelete({ merged: false }).reasons[0] === 'branch-not-merged', 'A14 删分支：当前分支不能删、没并入的不能直接删')
  check(BD.decideBranchDelete({ merged: true }).verdict === 'allow' && BD.decideBranchDelete({ merged: false, force: true }).reasons[0] === 'force-delete', 'A15 删分支：已并入放行；强制删要确认卡写清丢提交')
  check(BD.decideBranchCreate({ nameExists: true }).reasons[0] === 'branch-exists' && BD.decideBranchCreate({}).verdict === 'allow', 'A16 新建分支：同名拦、不重名放行')
  check(BD.decideTagCreate({ exists: true }).reasons[0] === 'tag-exists' && BD.decideTagCreate({ mode: 'annotated', message: '' }).reasons[0] === 'missing-tag-message', 'A17 建标签：同名拦、附注标签缺说明拦')
  check(BD.decideTagCreate({ mode: 'signed', message: '说明' }).verdict === 'warn' && BD.decideTagCreate({ mode: 'light' }).verdict === 'allow', 'A18 建标签：签名依赖本机密钥只提醒，轻量放行')
  check(BD.decideDescriptionWrite({ branchExists: true, text: '说明' }).verdict === 'allow' && BD.decideDescriptionWrite({ branchExists: false }).reasons[0] === 'branch-missing', 'A19 写分支说明：分支要在、文本过形状检查')
  check(BD.descriptionTextProblem('x'.repeat(4097)) === 'description-too-long' && BD.descriptionTextProblem('a\u0000b') === 'bad-description', 'A20 分支说明：超过 4 KB 或含 NUL 拒')
  check(BD.BRANCH_DECISIONS_SOURCE === 'src/shared/version-control/src/branch-decisions.ts', 'A21 判定文件报出自己的真源路径')
  const domain4 = ledger.CAPABILITIES.filter(function (cap) { return String(cap.id).indexOf('4.') === 0 })
  check(domain4.length === 13 && domain4.every(function (cap) { return BD.BRANCH_OP_IDS.indexOf(cap.id) >= 0 }), 'A22 能力账本域 4 恰好 13 条（实得 ' + domain4.length + ' 条）')
  // A23–A25：票据口径（返工新增）
  check(BT.BRANCH_TICKET_OPS.join(',') === 'create,switch,detach,rename,delete,upstream,tag-create,tag-delete,describe' && BT.BRANCH_TICKET_READ_OP === 'verify', 'A23 票据动作表九个写动作，验签是只读动作不在其中')
  const planRes = BT.branchPlanOf('delete', { name: 'feature', force: true })
  check(planRes.ok === true && planRes.plan.force === true && BT.branchPlanOf('delete', {}).plan.force === false, 'A24 计划规范化：force 一律布尔（同一件事只有一种写法）')
  check(BT.branchPlanOf('nope', {}).ok === false && BT.branchPlanDigestInput({ b: 1, a: 2 }) === BT.branchPlanDigestInput({ a: 2, b: 1 }), 'A25 计划摘要输入与键顺序无关、未知动作拒签')

  // B 组：命令 argv（与共享层同一份真源）
  // 完整档与降级档的命令词都从能力账本取：账本写的是 git switch 与「2.23 以下改用 git checkout」，
  // 这里不再抄一遍字面量，账本改口径时这组断言跟着动。
  const capOf = function (id: string) { return domain4.filter(function (cap) { return cap.id === id })[0] }
  const gitWordOf = function (text: string) { const m = String(text || '').match(/git ([a-z-]+)/); return m ? m[1] : '' }
  check(!!capOf('4.2') && capOf('4.2').versionPolicy === 'degrade' && CM.branchCreateArgs('x', 'HEAD')[0] === gitWordOf(capOf('4.2').command) && CM.branchCreateArgs('x', 'HEAD').indexOf('-c') > 0 && CM.branchCreateCheckoutArgs('x')[0] === gitWordOf(capOf('4.2').versionAlternative) && CM.branchCreateCheckoutArgs('x').indexOf('-b') > 0, 'B1 4.2 新建并切换：完整档用账本登记的 switch -c，降级档用替代说明里的 checkout -b')
  check(capOf('4.3').versionPolicy === 'degrade' && CM.branchSwitchArgs('x')[0] === gitWordOf(capOf('4.3').command) && CM.branchSwitchCheckoutArgs('x')[0] === gitWordOf(capOf('4.3').versionAlternative), 'B2 4.3 切换：完整档 switch、降级档 checkout（命令词都从账本取）')
  check(capOf('4.4').versionPolicy === 'degrade' && CM.branchDetachArgs(OID)[0] === gitWordOf(capOf('4.4').command) && CM.branchDetachCheckoutArgs(OID)[0] === gitWordOf(capOf('4.4').versionAlternative), 'B3 4.4 分离头：完整档 switch --detach、降级档 checkout（命令词都从账本取）')
  check(CM.branchRenameArgs('a', 'b').join(' ') === 'branch -m a b', 'B4 4.5 重命名：branch -m')
  check(CM.branchDeleteArgs('x', false).join(' ') === 'branch -d x' && CM.branchDeleteArgs('x', true).join(' ') === 'branch -D x', 'B5 4.6 删除：默认 -d、确认后 -D')
  check(CM.setUpstreamArgs('origin/main', 'main').join(' ') === 'branch -u origin/main main' && CM.unsetUpstreamArgs('main').join(' ') === 'branch --unset-upstream main', 'B6 4.7 上游：设置与取消')
  check(CM.mergedBranchesArgs('merged', 'main').join(' ') === 'branch --merged main' && CM.mergedBranchesArgs('no-merged', 'main').join(' ') === 'branch --no-merged main', 'B7 4.8 已并入/没并入')
  check(CM.tagListArgs().join(' ').indexOf('for-each-ref') === 0 && CM.tagListArgs().join(' ').indexOf('refs/tags/') > 0, 'B8 4.9 标签列表：for-each-ref refs/tags/')
  check(CM.tagCreateArgs('v1', 'annotated', undefined, '说明').join(' ') === 'tag -a -m 说明 v1', 'B9 4.10 附注标签：tag -a -m')
  check(CM.tagCreateArgs('v1', 'signed', undefined, '说明')[1] === '-s' && CM.tagCreateArgs('v1', 'light').join(' ') === 'tag v1', 'B10 4.10 签名用 -s、轻量不带参数')
  check(CM.tagDeleteArgs('v1').join(' ') === 'tag -d v1', 'B11 4.11 删标签')
  check(CM.verifyCommitArgs(OID).join(' ') === 'verify-commit --raw ' + OID && CM.verifyTagArgs('v1').join(' ') === 'verify-tag --raw v1', 'B12 4.12 验签：verify-commit / verify-tag 带 --raw')
  const descArgs = CM.branchDescriptionsArgs()
  check(descArgs[0] === 'config' && descArgs.indexOf('--local') > 0 && descArgs.indexOf('-z') > 0 && String(descArgs[descArgs.length - 1]).indexOf('description') > 0, 'B13 4.13 读分支说明：git config --get-regexp（键名带 branch. 前缀）')
  check(CM.branchDescriptionSetArgs('main', '说明').join(' ') === 'config --local branch.main.description 说明' && CM.branchDescriptionUnsetArgs('main').indexOf('--unset-all') > 0 && CM.branchDescriptionSetArgs('main', 'x').indexOf('--edit') < 0, 'B14 4.13 写/清分支说明：config 直写与 --unset-all（不 --edit）')
  check(CM.commandFor('refs').args.length > 0 && CM.commandFor('refs').args.indexOf('for-each-ref') >= 0, 'B15 4.1 分支列表复用共享层 refs 读法（不另造）')

  // C 组：解析器
  const tags = PB.parseTagList(TAGS_OUT)
  check(tags.ok === true && tags.tags.length === 2 && tags.tags[0].name === 'v1.0.0' && tags.tags[1].annotated === true, 'C1 标签清单解析：轻量与附注都认')
  check(tags.ok === true && /^[0-9a-f]{40}$/.test(tags.tags[0].oid) && tags.tags[0].atMs === 1790000000000, 'C2 标签条目带提交号与时间')
  check(PB.parseTagList('坏行\n').ok === false, 'C3 标签清单坏行整份显式失败（不给半份列表）')
  const names = PB.parseBranchNameList('  main\n* feature\n')
  check(names.ok === true && names.names.join(',') === 'main,feature', 'C4 已并入名单解析：去掉前导标记')
  check(PB.parseBranchNameList('a b\n').ok === false, 'C5 已并入名单带空白判失败')
  const desc = PB.parseBranchDescriptions('branch.main.description\n主干；发布从这里切\u0000')
  check(desc.ok === true && desc.descriptions.main === '主干；发布从这里切', 'C6 分支说明解析：键值成对')
  check(PB.parseBranchDescriptions('branch.main.description\u0000a\u0000not-a-desc\u0000').ok === false, 'C7 分支说明解析：非 description 键判失败')
  check(PB.parseDescriptionText('一行\n').ok === true && PB.parseDescriptionText('一行\n').text === '一行', 'C8 说明文本只去一个行尾换行')
  check(PB.PARSE_BRANCH_SOURCE === 'src/shared/version-control/src/parse-branch.ts', 'C9 解析器文件报出自己的真源路径')

  // D 组：客户端数据层与业务面板（返工后的三段式协议）
  const built = buildClient(null)
  const V = built.v
  check(V.VC_BRANCHES_PHONE === 'wf.gitBranches' && V.VC_BRANCH_CHECK_PHONE === 'wf.gitBranchCheck' && V.VC_BRANCH_WRITE_PHONE === 'wf.gitBranchWrite', 'D1 三条电话名与宿主注册一致')
  const idle = V.vcNewBranchRead()
  check(idle.state === 'idle' && idle.data === null && idle.check === null && idle.write === null, 'D2 新读数：读/预检/执行三块都留空位')
  check(V.VC_BRANCH_WRITE_OPS.length === 9 && V.VC_BRANCH_WRITE_OPS.indexOf('verify') < 0, 'D3 客户端写动作表九个、验签不在凭票执行里')
  check(V.VC_BRANCH_ACTIONS.length === 10 && V.VC_BRANCH_ACTIONS[8].checkOnly === true, 'D4 面板十个动作、验签标成只读（走预检电话）')
  check(V.vcBranchShapeOk(BOARD) === true, 'D5 形状判据：契约/版本/两个清单齐放行')
  check(V.vcBranchShapeOk(Object.assign({}, BOARD, { version: 2 })) === false && V.vcBranchShapeOk(Object.assign({}, BOARD, { branches: null })) === false, 'D6 版本不对或分支清单缺失判红')
  const readReply = Object.assign({ ok: true }, BOARD)
  const readCall = fakeCall(readReply)
  const rRead = await V.vcReadBranches({}, readCall.call, 'D:/假工作区/repo')
  check(readCall.calls.length === 1 && readCall.calls[0].phone === V.VC_BRANCHES_PHONE, 'D7 读面板：只发一次读电话')
  check(V.vcBranchStateOf(rRead) === 'ok' && V.vcBranchBoardOf(rRead).branches.length === 2, 'D8 读成功：整份读数落成 ok')
  const failRead = await V.vcReadBranches(rRead, fakeCall({ ok: false, error: { kind: 'env', message: '找不到 git' } }).call, 'D:/假工作区/repo')
  check(V.vcBranchStateOf(failRead) === 'err' && V.vcBranchBoardOf(failRead) !== null, 'D9 读失败保留旧数据（失败绝不清空）')
  check(V.vcBranchRequestOf('4.6', { name: 'feature' }).op === 'delete' && V.vcBranchRequestOf('4.13', { branch: 'main', text: 'x' }).op === 'describe', 'D10 能力号到写动作 kind 的映射')
  check(V.vcBranchRequestOf('4.1', {}).op === '', 'D11 只读能力号不发写请求（kind 为空）')
  const reqOf = V.vcBranchRequestOf('4.6', { name: 'feature', confirmed: true, ticketId: 't', requestId: 'r', dryRun: true })
  check(reqOf.confirmed === undefined && reqOf.ticketId === undefined && reqOf.requestId === undefined && reqOf.dryRun === undefined, 'D12 预检请求只带动作参数：票号/requestId/confirmed/dryRun 都不混进来')
  const checkCall = fakeCall(Object.assign({ ok: true }, CHECK_OK))
  const rCheck = await V.vcBranchCheck({}, checkCall.call, 'D:/假工作区/repo', '4.6', { name: 'feature', force: true })
  check(checkCall.calls.length === 1 && checkCall.calls[0].phone === V.VC_BRANCH_CHECK_PHONE && checkCall.calls[0].args.op === 'delete' && checkCall.calls[0].args.force === true, 'D13 预检：发一次预检电话并带上动作参数')
  check(V.vcBranchCheckKindOf(Object.assign({ ok: true }, CHECK_OK)) === 'checked' && V.vcBranchCheckKindOf(CHECK_BLOCKED) === 'blocked' && V.vcBranchCheckKindOf({ ok: false, error: { kind: 'env' } }) === 'fail', 'D14 预检回包分类：拿到票 / 不能做 / 读不回现场')
  const t = V.vcBranchTicketOf(rCheck)
  check(!!t && t.id === 't-1' && t.op === 'delete' && t.expiresAtMs - t.checkedAtMs === 120000, 'D15 预检成功：手里有一张 120 秒的票（id/动作/到期时刻齐全）')
  const decision = V.vcBranchCheckDecisionOf(rCheck)
  check(!!decision && decision.verdict === 'warn' && decision.reasons.join(',') === 'force-delete', 'D16 预检判定与理由：warn + 固定理由标识符')
  const rBlocked = await V.vcBranchCheck({}, fakeCall(CHECK_BLOCKED).call, 'D:/假工作区/repo', '4.6', { name: 'main' })
  check(V.vcBranchCheckOf(rBlocked).state === 'err' && !!V.vcBranchCheckOf(rBlocked).data && V.vcBranchCheckDecisionOf(rBlocked).reasons[0] === 'cannot-delete-current', 'D17 block 回包也保留现场：界面能画「为什么不能点」')
  check(V.vcBranchTicketOf({}) === null && V.vcBranchTicketOf(rBlocked) === null, 'D18 没签票时取票返回 null（不冒充有票）')
  const writeCall = fakeCall({ ok: true, op: 'delete', kind: 'delete', command: 'branch -D feature', branch: 'feature' })
  const rWrite = await V.vcBranchWrite({}, writeCall.call, 'D:/假工作区/repo', '4.6', { ticketId: 't-1', requestId: 'req-1', confirmed: true, name: 'feature' })
  check(writeCall.calls.length === 1 && writeCall.calls[0].phone === V.VC_BRANCH_WRITE_PHONE && writeCall.calls[0].args.ticketId === 't-1' && writeCall.calls[0].args.requestId === 'req-1' && writeCall.calls[0].args.confirmed === true, 'D19 执行：凭票 + requestId + confirmed 发一次写电话')
  check(V.vcBranchReplyKindOf(writeCall.calls[0] && { ok: true }) === 'done' && V.vcBranchReplyKindOf({ ok: false, error: { kind: 'need-confirm' }, reason: 'need-confirm' }) === 'need-confirm', 'D20 执行回包：完成与待确认两种')
  check(V.vcBranchReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'ticket-expired' }) === 'stale' && V.vcBranchReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'target-changed' }) === 'stale' && V.vcBranchReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'ticket-op-mismatch' }) === 'stale', 'D21 票过期 / 目标变了 / 换动作都归「要重新预检」')
  check(V.vcBranchReplyKindOf({ ok: false, error: { kind: 'git-failed' } }) === 'fail' && V.vcBranchReplyKindOf({ reused: true, ok: true, result: { ok: true } }) === 'done', 'D22 git 失败按失败显示、requestId 重放按原结论显示')
  check(V.vcBranchReasonsOf({ ok: false, reasons: ['mid-operation'] }).join(',') === 'mid-operation' && V.vcBranchReasonsOf({ ok: false, decision: { reasons: ['unsaved-changes'] } }).join(',') === 'unsaved-changes', 'D23 理由标识符从回包原样带出（界面不造理由）')
  check(V.vcBranchConfirmOf(CHECK_OK).verb.indexOf('删除分支') === 0 && V.vcBranchConfirmOf({}) === null, 'D24 确认卡素材：有就带、没有就不画')
  const resultOk = V.vcBranchResultOf({ ok: true, command: 'branch -D feature' })
  const resultFail = V.vcBranchResultOf({ ok: false, error: { kind: 'git-failed' }, git: 'fatal: 写失败', step: '删除分支这一步', expected: 'e', actual: 'a', cause: 'c' })
  check(resultOk.state === 'ok' && resultOk.cmd === 'branch -D feature' && resultFail.state === 'fail' && resultFail.error === true && resultFail.git === 'fatal: 写失败' && resultFail.step === '删除分支这一步', 'D25 结果贴点：成功贴命令、失败贴 git 原话与环节（附加字段在顶层也认）')
  const tree = V.vcBranchBoardNode(fakeH, tZh, { board: BOARD })
  const ops = attrsOf(tree, 'data-vc-op')
  const uniq = Array.from(new Set(ops)).sort()
  check(uniq.join(',') === '4.10,4.11,4.12,4.13,4.2,4.3,4.4,4.5,4.6,4.7', 'D26 面板十条写动作各有 data-vc-op（实得 ' + uniq.join(',') + '）')
  check(attrsOf(tree, 'data-vc-branch-row').join(',') === 'main,feature' && attrsOf(tree, 'data-vc-tag-row').join(',') === 'v1.0.0,v1.1.0', 'D27 面板逐分支、逐标签画行')
  check(attrsOf(tree, 'data-vc-branch-merged')[0] === '1' && attrsOf(tree, 'data-vc-branch-notmerged')[0] === '1', 'D28 4.8 两张名单一起画')
  check(tree.props['data-vc-branch-ops'] === '13' && tree.props['data-vc-branch-writes'] === '9' && tree.props['data-vc-branch-checks'] === '1', 'D29 面板声明十三能力 / 九个凭票写动作 / 一条预检电话')
  const empty = V.vcBranchBoardNode(fakeH, tZh, { board: null })
  check(attrsOf(empty, 'data-vc-branch2-empty').length === 1 && attrsOf(empty, 'data-vc-branch-row').length === 0, 'D30 没读数时画空态与重试，不画假分支')
  const logsBox = buildClient(null)
  await logsBox.v.vcBranchCheck({}, fakeCall(Object.assign({ ok: true }, CHECK_OK)).call, 'D:/假工作区/repo', '4.6', { name: 'feature' })
  await logsBox.v.vcBranchCheck({}, fakeCall(CHECK_BLOCKED).call, 'D:/假工作区/repo', '4.6', { name: 'main' })
  const evs = logsBox.logs.map(function (l) { return l.event })
  check(evs.indexOf('host.call') >= 0 && evs.indexOf('host.call.fail') >= 0, 'D31 预检成功与 block 都落在既有日志事件上（host.call / host.call.fail）')
  const okLog = logsBox.logs.filter(function (l) { return l.event === 'host.call' })[0]
  check(!!okLog && !!okLog.fields && okLog.fields.kind === 'delete', 'D32 预检成功日志带 kind=动作名（git-branch-check 由宿主那层加）')
  const degradedBoard = Object.assign({}, BOARD, { capabilities: { gitVersion: 'git version 2.20.1', tier: 'degraded', actions: [
    { op: 'create', capId: '4.2', state: 'degraded', needed: '2.23', alternative: '2.23 以下改用 git checkout -b 新建并切换分支' },
    { op: 'switch', capId: '4.3', state: 'full', needed: '2.23', alternative: null },
  ] } })
  const dTree = V.vcBranchBoardNode(fakeH, tZh, { board: degradedBoard })
  check(attrsOf(dTree, 'data-vc-branch-degraded').join(',') === '1' && attrsOf(dTree, 'data-vc-branch-git-version')[0] === 'git version 2.20.1', 'D33 降级现场画一行说明：带 git 版本与降级动作条数')
  check(V.vcBranchDegradedOf(degradedBoard).length === 1 && V.vcBranchDegradedOf(BOARD).length === 0 && attrsOf(tree, 'data-vc-branch-degraded').length === 0, 'D34 只列降级动作；完整档不画这一行')

  // E 组：真宿主假路由（预检签票 → 凭票执行）
  const clock = { t: T0 }
  const happy = makeRoute({})
  const hostDeps = makeHostDeps(happy.route, clock)
  const vc = hostMod.createVersionControl(hostDeps.deps)
  check(typeof vc.handleGitBranches === 'function' && typeof vc.handleGitBranchCheck === 'function' && typeof vc.handleGitBranchWrite === 'function', 'E1 宿主把读 / 预检 / 执行三条电话露出来了')
  const board = await vc.handleGitBranches({ cwd: 'D:/假工作区/repo' })
  check(board.ok === true && board.contract === 'version-control.branch-board' && board.version === 1, 'E2 读回包带契约名与版本号')
  check(Array.isArray(board.branches) && board.branches.length === 2 && board.branches[0].name === 'main' && board.branches[0].current === true, 'E3 分支列表读到 main 并标当前分支')
  check(Array.isArray(board.tags) && board.tags.length === 2 && board.tags[1].annotated === true, 'E4 标签列表读到两个标签并认出附注标签')
  check(board.merged.join(',') === 'main' && board.notMerged.join(',') === 'feature', 'E5 4.8 已并入 / 没并入两张名单')
  check(!!board.descriptions && board.descriptions.main === '主干；发布从这里切', 'E6 4.13 分支说明一次读回')
  // 4.2 新建：预检签票（不执行）→ 凭票执行
  const writesBefore = writeCmds(happy.seen).length
  const createCheck = await vc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'create', name: 'feature2', from: 'HEAD' })
  check(createCheck.ok === true && createCheck.contract === 'version-control.branch-check' && createCheck.version === 1 && createCheck.op === 'create', 'E7 4.2 预检回包带预检契约名/版本/动作')
  check(!!ticketOf(createCheck) && createCheck.ticket.op === 'create' && createCheck.ticket.expiresAtMs - createCheck.ticket.checkedAtMs === 120000, 'E8 预检签的票有效 120 秒（票号/动作/到期时刻齐全）')
  check(createCheck.decision.verdict === 'allow' && createCheck.confirmRequired === false, 'E9 4.2 预检放行且不必再确认')
  check(writeCmds(happy.seen).length === writesBefore, 'E10 预检这一趟没有执行任何写命令（票签完还没动手）')
  const createId = createCheck.ticket.id
  const createNoConfirm = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: createId, requestId: 'req-create-1', op: 'create', name: 'feature2' })
  check(createNoConfirm.ok === true && createNoConfirm.command === gitWordOf(capOf('4.2').command) + ' -c feature2' && writeCmds(happy.seen).length === writesBefore + 1, 'E11 凭票执行：一次写命令，命令原文与账本登记的 switch -c 一致')
  const createReplay = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: createId, requestId: 'req-create-1', op: 'create', name: 'feature2' })
  check(createReplay.reused === true && createReplay.ok === true && createReplay.result.command === createNoConfirm.command && writeCmds(happy.seen).length === writesBefore + 1, 'E12 同一 requestId 重放：回同一份结果，不再起进程')
  // 4.3 切换：工作区有未提交改动 → warn 要确认；未确认拒绝（零进程）
  const switchCheck = await vc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'switch', name: 'feature' })
  check(switchCheck.ok === true && switchCheck.decision.verdict === 'warn' && switchCheck.decision.reasons[0] === 'unsaved-changes' && switchCheck.confirmRequired === true, 'E13 4.3 工作区有改动：预检给 warn 并要确认')
  check(!!switchCheck.confirm && switchCheck.confirm.target === 'feature' && switchCheck.confirm.verb.indexOf('切换') >= 0, 'E14 4.3 警告给确认卡四段素材（动词/目标）')
  const switchId = switchCheck.ticket.id
  const afterConfirm = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: switchId, requestId: 'req-switch-1', op: 'switch', name: 'feature', confirmed: true })
  check(afterConfirm.ok === true && afterConfirm.command === gitWordOf(capOf('4.3').command) + ' feature' && writeCmds(happy.seen).length === writesBefore + 2, 'E15 4.3 确认后凭票执行切换（命令词来自账本）')
  // 伪造票 / 过期票 / 换动作：三种零进程拒绝
  const forgedSpawns = happy.seen.length
  const forged = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: 'forged-ticket-1', requestId: 'req-forged', op: 'switch', name: 'feature', confirmed: true })
  check(forged.ok === false && forged.error.kind === 'blocked' && forged.reason === 'ticket-missing' && happy.seen.length === forgedSpawns, 'E16 伪造票：ticket-missing 零进程拒绝（spawns 不动）')
  const mismatched = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: createId, requestId: 'req-mismatch', op: 'switch', name: 'feature', confirmed: true })
  check(mismatched.ok === false && mismatched.reason === 'ticket-op-mismatch' && happy.seen.length === forgedSpawns, 'E17 换动作的票：ticket-op-mismatch 零进程拒绝（spawns 不动）')
  // 重放表只按 requestId 键是不够的：同一个 requestId 换成别的动作必须拒绝，不能把上一份结果冒充这一次的。
  const reusedOther = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: switchId, requestId: 'req-create-1', op: 'switch', name: 'feature', confirmed: true })
  check(reusedOther.ok === false && reusedOther.reason === 'request-reused' && happy.seen.length === forgedSpawns, 'E17b 同一个 requestId 换动作：明确拒绝（request-reused）且零进程')
  const staleClock = { t: T0 }
  const timed = makeRoute({})
  const timedDeps = makeHostDeps(timed.route, staleClock)
  const timedVc = hostMod.createVersionControl(timedDeps.deps)
  const timedCheck = await timedVc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'create', name: 'feature3' })
  staleClock.t = T0 + 120001
  const timedSpawns = timed.seen.length
  const expired = await timedVc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: timedCheck.ticket.id, requestId: 'req-expired', op: 'create', name: 'feature3' })
  check(expired.ok === false && expired.reason === 'ticket-expired' && timed.seen.length === timedSpawns, 'E18 过期票：ticket-expired 零进程拒绝（spawns 不动）')
  // 目标变了：票签完后分支 oid 变了 → target-changed，且不执行写命令
  const drift = makeRoute({})
  const driftDeps = makeHostDeps(drift.route, { t: T0 })
  const driftVc = hostMod.createVersionControl(driftDeps.deps)
  const driftCheck = await driftVc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'switch', name: 'feature' })
  drift.state.featureOid = OID3
  const driftWrites = writeCmds(drift.seen).length
  const drifted = await driftVc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: driftCheck.ticket.id, requestId: 'req-drift', op: 'switch', name: 'feature', confirmed: true })
  check(drifted.ok === false && drifted.reason === 'target-changed' && writeCmds(drift.seen).length === driftWrites, 'E19 票签完后目标分支 oid 变了：target-changed 零写进程拒绝')
  // 说明旧值变了：describe 票签完后旧说明被改 → target-changed
  const descDrift = makeRoute({})
  const descDriftVc = hostMod.createVersionControl(makeHostDeps(descDrift.route, { t: T0 }).deps)
  const descCheck = await descDriftVc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'describe', branch: 'feature', text: '新说明' })
  descDrift.state.featureDesc = '别人刚改的说明'
  const descWrites = writeCmds(descDrift.seen).length
  const descDrifted = await descDriftVc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: descCheck.ticket.id, requestId: 'req-desc-drift', op: 'describe', branch: 'feature', text: '新说明' })
  check(descDrifted.ok === false && descDrifted.reason === 'target-changed' && writeCmds(descDrift.seen).length === descWrites, 'E20 票签完后分支说明旧值变了：target-changed 零写进程拒绝')
  // 4.6 删除：没并入 + force → warn；确认后 branch -D
  const delCheck = await vc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'delete', name: 'feature', force: true })
  check(delCheck.ok === true && delCheck.decision.verdict === 'warn' && delCheck.decision.reasons[0] === 'force-delete' && delCheck.confirmRequired === true, 'E21 4.6 强制删未并入分支：warn force-delete 要确认')
  const delCurrent = await vc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'delete', name: 'main', force: true })
  check(delCurrent.ok === false && delCurrent.error.kind === 'blocked' && delCurrent.decision.reasons[0] === 'cannot-delete-current' && !!delCurrent.scene && V.vcBranchCheckShapeOk(delCurrent) === true, 'E22 4.6 当前分支不能删：block 带理由与现场，回包形状与成功回包同一套（界面读得到）')
  const delRun = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: delCheck.ticket.id, requestId: 'req-del-1', op: 'delete', name: 'feature', force: true, confirmed: true })
  check(delRun.ok === true && String(delRun.command).indexOf('branch -D') === 0, 'E23 4.6 确认后凭票真用 -D 删')
  // 4.10 建标签 / 4.7 上游 / 4.13 说明 / 4.12 验签（验签走预检电话的只读分支，不签票）
  const tagCheck = await vc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'tag-create', name: 'v2.0.0', mode: 'annotated', message: '说明' })
  check(tagCheck.ok === true && tagCheck.decision.verdict === 'allow', 'E24 4.10 附注标签预检放行')
  const tagRun = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: tagCheck.ticket.id, requestId: 'req-tag-1', op: 'tag-create', name: 'v2.0.0', mode: 'annotated', message: '说明' })
  check(tagRun.ok === true && String(tagRun.command).indexOf('tag -a -m') === 0, 'E25 4.10 凭票建附注标签（tag -a -m）')
  const upCheck = await vc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'upstream', branch: 'feature', upstream: 'origin/feature' })
  check(upCheck.ok === true && upCheck.decision.verdict === 'allow', 'E26 4.7 设置上游预检放行')
  const upRun = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: upCheck.ticket.id, requestId: 'req-up-1', op: 'upstream', branch: 'feature', upstream: 'origin/feature' })
  check(upRun.ok === true && String(upRun.command).indexOf('branch -u origin/feature') === 0, 'E27 4.7 凭票设置上游（branch -u）')
  const badUpstream = await vc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'upstream', branch: 'feature', upstream: 'feature' })
  check(badUpstream.ok === false && badUpstream.reason === 'bad-upstream', 'E28 4.7 上游写法不合法当场拒（不签票）')
  const descCheck2 = await vc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'describe', branch: 'feature', text: '新说明' })
  const descRun = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: descCheck2.ticket.id, requestId: 'req-desc-1', op: 'describe', branch: 'feature', text: '新说明' })
  check(descRun.ok === true && String(descRun.command).indexOf('branch.feature.description') >= 0 && String(descRun.command).indexOf('--edit') < 0, 'E29 4.13 凭票写分支说明（config 直写，不 --edit）')
  const verifyBad = await vc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'verify', objectKind: 'tag', object: 'v1.0.0' })
  check(verifyBad.ok === true && verifyBad.verified === false && verifyBad.exitCode === 1 && String(verifyBad.gitSays).indexOf('no signature') >= 0, 'E30 4.12 没签名照实说没验过（不冒充成功）且带 git 原话')
  check(!!verifyBad.ticket === false, 'E31 4.12 验签是只读动作：不签票、不进凭票执行')
  const verified = await hostMod.createVersionControl(makeHostDeps(makeRoute({ verified: true }).route, { t: T0 }).deps).handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'verify', objectKind: 'commit', object: OID })
  check(verified.ok === true && verified.verified === true, 'E32 4.12 真验过才说 verified:true')
  // 写失败照实回原话；读失败整份失败
  const failRoute = makeRoute({ fail: { write: true } })
  const failVc = hostMod.createVersionControl(makeHostDeps(failRoute.route, { t: T0 }).deps)
  const failCheck = await failVc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'tag-delete', name: 'v1.0.0' })
  const failedWrite = await failVc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: failCheck.ticket.id, requestId: 'req-fail-1', op: 'tag-delete', name: 'v1.0.0', confirmed: true })
  check(failedWrite.ok === false && failedWrite.error.kind === 'git-failed' && String(failedWrite.git).indexOf('写失败') >= 0 && String(failedWrite.step).indexOf('删标签') >= 0, 'E33 写失败回带 git 原话与环节（不冒充完成）')
  const notRepo = makeRoute({ noRepo: true })
  const notRepoCheck = await hostMod.createVersionControl(makeHostDeps(notRepo.route, { t: T0 }).deps).handleGitBranchCheck({ cwd: 'D:/不在仓库里', op: 'create', name: 'x' })
  check(notRepoCheck.ok === false && String(notRepoCheck.error.kind) !== '', 'E34 不在仓库里：预检如实失败（不给假票）')
  const tagFail = makeRoute({ fail: { tags: true } })
  const tagFailBoard = await hostMod.createVersionControl(makeHostDeps(tagFail.route, { t: T0 }).deps).handleGitBranches({ cwd: 'D:/假工作区/repo' })
  check(tagFailBoard.ok === false && !!tagFailBoard.error, 'E35 标签这一路失败：整份读失败（不给半份面板）')
  const descFail = makeRoute({ fail: { descriptions: true } })
  const descFailCheck = await hostMod.createVersionControl(makeHostDeps(descFail.route, { t: T0 }).deps).handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'switch', name: 'feature' })
  check(descFailCheck.ok === false && String(descFailCheck.error.message).indexOf('分支说明') >= 0, 'E36 分支说明这一路失败：预检整份失败且说清是哪一步')
  const noDesc = makeRoute({ noDescriptions: true })
  const noDescBoard = await hostMod.createVersionControl(makeHostDeps(noDesc.route, { t: T0 }).deps).handleGitBranches({ cwd: 'D:/假工作区/repo' })
  check(noDescBoard.ok === true && Object.keys(noDescBoard.descriptions).length === 0, 'E37 一条说明都没配过（config 退出码 1）：不算失败')
  const logDeps = makeHostDeps(makeRoute({}).route, { t: T0 })
  const logVc = hostMod.createVersionControl(logDeps.deps)
  await logVc.handleGitBranches({ cwd: 'D:/假工作区/repo' })
  await logVc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'switch', name: 'feature' })
  const kinds = logDeps.logs.filter(function (l) { return l.event === 'host.call' && l.fields }).map(function (l) { return String(l.fields.kind) })
  check(kinds.indexOf('git-branches') >= 0 && kinds.indexOf('git-branch-check') >= 0, 'E38 读与预检都落在 host.call 日志上（kind 区分两条电话）')
  // 版本门真接线（评审必修 1）：档位由预检按能力账本判定、写进计划摘要，执行时只照计划走。
  const ticketIn = async function (vc2, id) { const m = vc2.branchTickets; const box = typeof m === 'function' ? await m() : m; return box && box.get ? box.get(id) : null }
  const oldVc = hostMod.createVersionControl(makeHostDeps(makeRoute({ version: 'git version 2.20.1' }).route, { t: T0 }).deps)
  const oldCheck = await oldVc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'create', name: 'feature3' })
  const oldTicket = oldCheck.ok === true ? await ticketIn(oldVc, oldCheck.ticket.id) : null
  check(!!oldTicket && oldTicket.plan.tier === 'degraded' && String(oldTicket.plan.gitVersion).indexOf('2.20') >= 0, 'E39 2.20 的现场：预检把 degraded 与 git 版本一起落进计划摘要')
  const oldWrite = await oldVc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: oldCheck.ticket && oldCheck.ticket.id, requestId: 'req-old-git', op: 'create', name: 'feature3' })
  check(oldWrite.ok === true && oldWrite.argv[0] === 'checkout' && oldWrite.command.indexOf('checkout -b') === 0 && String(oldWrite.command).indexOf('switch') < 0, 'E40 2.20 的现场：凭票执行真的走 checkout -b（argv 里没有 switch）')
  const newVc = hostMod.createVersionControl(makeHostDeps(makeRoute({ version: 'git version 2.30.0' }).route, { t: T0 }).deps)
  const newCheck = await newVc.handleGitBranchCheck({ cwd: 'D:/假工作区/repo', op: 'create', name: 'feature4' })
  const newTicket = newCheck.ok === true ? await ticketIn(newVc, newCheck.ticket.id) : null
  check(!!newTicket && newTicket.plan.tier === 'full', 'E41 2.30 的现场：计划档位是 full（不降级）')
  const newWrite = await newVc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', ticketId: newCheck.ticket && newCheck.ticket.id, requestId: 'req-new-git', op: 'create', name: 'feature4' })
  check(newWrite.ok === true && newWrite.argv[0] === 'switch' && newWrite.command.indexOf('switch -c') === 0, 'E42 2.30 的现场：凭票执行走 switch -c（完整档）')
  // 评审必修 5：真临时仓库上，没有说明的分支清说明 / 写说明都要整步走完。
  const real = mkGateRepo()
  const realVc = hostMod.createVersionControl(makeRealDeps().deps)
  const realCheck = await realVc.handleGitBranchCheck({ cwd: real.dir, op: 'describe', branch: 'no-desc', text: '' })
  check(realCheck.ok === true, 'E43 真仓库：没有说明的分支做「清说明」预检能签票')
  const realWrite = await realVc.handleGitBranchWrite({ cwd: real.dir, ticketId: realCheck.ticket && realCheck.ticket.id, requestId: 'req-real-desc', op: 'describe', branch: 'no-desc', text: '' })
  check(realWrite.ok === true && realWrite.alreadyAbsent === true && String(realWrite.summary).indexOf('本来就没有') >= 0, 'E44 真仓库：git 退 5 且无输出视为「本来就没有」——整步成功，不拼空原话')
  const afterClear = real.git(['config', '--local', '--get', 'branch.no-desc.description'])
  check(afterClear.code !== 0 && afterClear.out.trim() === '', 'E45 真仓库：这一步确实没往配置里写任何东西（分支仍然没有说明）')
  const realSetCheck = await realVc.handleGitBranchCheck({ cwd: real.dir, op: 'describe', branch: 'no-desc', text: '说明' })
  const realSet = await realVc.handleGitBranchWrite({ cwd: real.dir, ticketId: realSetCheck.ticket && realSetCheck.ticket.id, requestId: 'req-real-desc2', op: 'describe', branch: 'no-desc', text: '说明' })
  check(realSet.ok === true && String(realSet.command).indexOf('branch.no-desc.description') >= 0 && real.git(['config', '--local', '--get', 'branch.no-desc.description']).out.trim() === '说明', 'E46 真仓库：给没有说明的分支写说明整步成功（config 直写并落进配置）')
  check(!!WR.WRITE_REASONS[failedWrite.reason], 'E47 写失败的理由落在共享理由表里（不出现门禁不认识的自由文本）')
  fs.rmSync(real.dir, { recursive: true, force: true })

  // F 组：反证组（把被守的东西改坏，原判据必须当场判红）
  const antiConfirm = buildClient(function (s) { return s.replace('if (f.confirmed === true) body.confirmed = true', 'if (false) body.confirmed = true') })
  const antiConfirmCall = fakeCall({ ok: true, kind: 'switch' })
  await antiConfirm.v.vcBranchWrite({}, antiConfirmCall.call, 'D:/假工作区/repo', '4.3', { ticketId: 't', requestId: 'r', confirmed: true, name: 'feature' })
  check(antiConfirm.changed === true && antiConfirmCall.calls[0].args.confirmed === undefined, 'F1 反证：确认字段那一行被改坏后，执行请求不再带 confirmed——D19 那条判据当场判红')
  const antiShape = buildClient(function (s) { return s.replace('if (Number(board.version) !== VC_BRANCH_BOARD_VERSION) return false', 'if (false) return false') })
  check(antiShape.changed === true && antiShape.v.vcBranchShapeOk(Object.assign({}, BOARD, { version: 9 })) === true, 'F2 反证：版本判据被改坏后，版本不对的读回包被放行——D6 那条判据当场判红')
  const antiStale = buildClient(function (s) { return s.replace("reason === 'target-changed'", "reason === 'target-changed-x'") })
  check(antiStale.changed === true && antiStale.v.vcBranchReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'target-changed' }) !== 'stale', 'F3 反证：目标变了那条理由被改名后不再归「要重新预检」——D21 那条判据当场判红')
  const falseWithTicket = Object.assign({}, rBlocked, { branch: Object.assign({}, rBlocked.branch, { check: { state: 'ok', data: Object.assign({}, CHECK_OK, { ok: false }), error: null } }) })
  const antiTicket = buildClient(function (s) { return s.replace('if (!d || d.ok !== true', 'if (!d') })
  check(antiTicket.changed === true && V.vcBranchTicketOf(falseWithTicket) === null && antiTicket.v.vcBranchTicketOf(falseWithTicket) !== null, 'F4 反证：票判据被改坏后，ok:false 的回包也被当成有票——D18 那条判据当场判红')

  // G 组：七登记点（预检判定分支 / 执行 argv 分支 / 宿主注册 / 电话表 / 装配壳 / 超时配置 / 票据契约）
  const checkSrc = sourceText('src/host/versionControlBranchCheck.ts')
  const writeSrc = sourceText('src/host/versionControlBranchWrite.ts')
  const mountSrc = sourceText('src/host/versionControlBranchMount.ts')
  const readSrc = sourceText('src/host/versionControlBranch.ts')
  const parentSrc = sourceText('src/host/versionControl.ts')
  const indexSrc = sourceText('src/host/index.ts')
  const clientSrc = sourceText('src/client/views/versionControl/vcBranches.ts')
  check(BT.BRANCH_TICKET_OPS.every(function (op) { return checkSrc.indexOf("'" + op + "'") >= 0 }), 'G1 预检叶子认识全部九个写动作（票据动作表每个 op 都在源码里出现）')
  const decideHits = ['decideBranchCreate', 'decideBranchSwitch', 'decideBranchDelete', 'decideTagCreate', 'decideDescriptionWrite', 'branchPlanOf', 'confirmOf'].every(function (n) { return checkSrc.indexOf(n) >= 0 })
  check(decideHits, 'G2 预检判定走共享层五个判定函数 + 计划规范化 + 确认卡素材（没有第二套判定）')
  const confirmBlock = checkSrc.slice(checkSrc.indexOf('function confirmOf'), checkSrc.indexOf('function sceneSummaryOf'))
  check(['create', 'switch', 'detach', 'rename', 'delete', 'upstream', 'tag-create', 'tag-delete'].every(function (op) { return confirmBlock.indexOf("op === '" + op + "'") >= 0 }), 'G3 确认卡素材覆盖全部八个凭票写动作（describe 走默认分支）')
  const argvBlock = writeSrc.slice(writeSrc.indexOf('function argvOf'), writeSrc.indexOf('function resultFields'))
  check(BT.BRANCH_TICKET_OPS.every(function (op) { return argvBlock.indexOf("op === '" + op + "'") >= 0 }) && argvBlock.indexOf("plan.tier === 'degraded'") >= 0 && argvBlock.indexOf('branchDescriptionSetArgs') >= 0 && argvBlock.indexOf('branchDescriptionUnsetArgs') >= 0 && argvBlock.indexOf("reason: 'bad-target'") >= 0, 'G4 执行叶子九个动作各有显式 argv 分支、未知动作显式拒绝、版本档从计划里取（不再静默兜底当写说明）')
  check(['branchCreateArgs', 'branchSwitchArgs', 'branchDetachArgs', 'branchRenameArgs', 'branchDeleteArgs', 'setUpstreamArgs', 'tagCreateArgs', 'tagDeleteArgs', 'branchDescriptionSetArgs'].every(function (n) { return writeSrc.indexOf(n) >= 0 }), 'G5 执行叶子只从共享层 commands.ts 取 argv（九种动作一个不少）')
  check(parentSrc.indexOf('createBranchMount') >= 0 && parentSrc.indexOf('handleGitBranchCheck') >= 0 && parentSrc.indexOf('handleGitBranchWrite') >= 0 && parentSrc.indexOf('handleGitBranches') >= 0, 'G6 宿主父文件登记了读/预检/执行三条电话（装配走 Mount 一层）')
  check(indexSrc.indexOf("'wf.gitBranches'") >= 0 && indexSrc.indexOf("'wf.gitBranchCheck'") >= 0 && indexSrc.indexOf("'wf.gitBranchWrite'") >= 0, 'G7 宿主入口把三条电话注册成 wf.* 方法')
  check(mountSrc.indexOf('createBranchCheck(host)') >= 0 && mountSrc.indexOf('tickets: check.tickets') >= 0 && mountSrc.indexOf('results: check.results') >= 0, 'G8 装配壳让预检与执行共用同一张票表与同一张 requestId 结果表')
  check(['git-branches', 'git-branch-check', 'git-branch-write'].every(function (k) { return mountSrc.indexOf("'" + k + "'") >= 0 }), 'G9 三条电话都用宿主注入的 loggedPhone 包一层（日志口径与别的域一致）')
  check(clientSrc.indexOf("'wf.gitBranches'") >= 0 && clientSrc.indexOf("'wf.gitBranchCheck'") >= 0 && clientSrc.indexOf("'wf.gitBranchWrite'") >= 0, 'G10 客户端电话表与宿主注册的三个方法名逐字一致')
  const timeoutsYaml = read('config/timeouts.yaml')
  const valuesTs = read('src/shared/time-config/src/values.ts')
  check(timeoutsYaml.indexOf('vcBranchReadTimeoutMs') >= 0 && timeoutsYaml.indexOf('vcBranchWriteTimeoutMs') >= 0 && valuesTs.indexOf('VC_BRANCH_READ_TIMEOUT_MS') >= 0 && valuesTs.indexOf('VC_BRANCH_WRITE_TIMEOUT_MS') >= 0, 'G11 分支域读/写超时进了中央时间配置（YAML 真源与生成物都有）')
  const ttlYaml = read('config/ttl.yaml')
  const ticketSrc = sourceText('src/shared/version-control/src/write-ticket.ts')
  check(ttlYaml.indexOf('ticketTtlMs: 120000') >= 0 && ticketSrc.indexOf('TICKET_TTL_MS') >= 0 && checkSrc.indexOf('makeTicket') >= 0, 'G12 票据 120 秒来自中央配置（预检签票用共享层 makeTicket，不自己写数字）')
  check(BT.BRANCH_CHECK_CONTRACT === 'version-control.branch-check' && BT.BRANCH_CHECK_VERSION === 1 && readSrc.indexOf('BRANCH_BOARD_CONTRACT') >= 0, 'G13 预检契约名/版本只有共享层一份，读面板契约仍由只读叶子导出')
  check(writeSrc.indexOf('ticketPureVerdict') >= 0 && writeSrc.indexOf('bindingsVerdict') >= 0 && writeSrc.indexOf('requestIdProblem') >= 0 && writeSrc.indexOf('results.has(requestId)') >= 0, 'G14 执行叶子凭票执行：票据过期判据、绑定表比对、requestId 去重都走共享层')
  check(checkSrc.indexOf('runPinned') >= 0 && writeSrc.indexOf('runPinned') >= 0, 'G15 预检与执行都不自己起进程（一律走注入的 runPinned 出口）')
  check(checkSrc.indexOf('plan.tier = ver.tier') >= 0 && checkSrc.indexOf('capabilityAvailability(cap, gitVersion)') >= 0 && checkSrc.indexOf("avail.state === 'hidden'") >= 0 && readSrc.indexOf('capabilityAvailability(cap, gitVersion)') >= 0, 'G16 版本门真的接线：预检按账本判档位并写进计划，读面板按同一账本算降级说明')

  console.log(failed ? '有失败 — 分支与标签域门禁未通过' : '全部通过 — 分支与标签域门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed ? 1 : 0)
  if (failed) process.exit(1)
}

main().catch(function (e) {
  console.log('  FAIL 门禁自身抛出异常：' + String((e && e.stack) || e))
  total += 1
  failed = true
  console.log('有失败 — 分支与标签域门禁未通过')
  printGateResult(GATE, total, 1)
  process.exit(1)
})
