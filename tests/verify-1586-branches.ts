// tests/verify-1586-branches.ts —— 分支与标签域门禁（规格 #1586 域 4 / 票 #1746 的 T11）
// 门禁归属: src/shared/version-control/src/branch-decisions.ts
// 门禁归属: src/shared/version-control/src/parse-branch.ts
// 门禁归属: src/host/versionControlBranch.ts
// 门禁归属: src/client/views/versionControl/vcBranches.ts
//
// 守什么：域 4 十三条能力（4.1–4.13）在面板上各有一条唯一主入口，命令原文与共享层一致；写动作三段式
// （dryRun 判定 → block 直接拒 / warn 要确认 → confirmed 才执行）；4.6 删除与 4.3 切换的未保存改动保护；
// 4.13 分支说明只改本地配置（不推送）；4.12 验签退出码非零照实报「没验过」。
// 四组断言：A 共享判定与取名规则、B 命令 argv、C 客户端数据层与业务面板、D 真宿主假路由 + 反证。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-branches.ts
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { compileFn } = require('./lib/eval-probe.ts')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText } = require('./lib/source-text.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-branches'
const OID = 'a'.repeat(40)
const OID2 = 'b'.repeat(40)
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const readJson = (rel) => JSON.parse(read(rel))
const sharedUrl = (f) => pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', f)).href
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const CLIENT_FILES = ['src/shared/version-control/src/branch-decisions.ts', 'src/client/views/versionControl/vcBranches.ts']
const CLIENT_EXPORTS = ['BRANCH_REASONS', 'BRANCH_REASON_IDS', 'BRANCH_OP_IDS', 'BRANCH_WRITE_KINDS', 'branchNameProblem', 'tagNameProblem', 'upstreamNameProblem', 'descriptionTextProblem', 'decideBranchSwitch', 'decideBranchDelete', 'decideBranchCreate', 'decideTagCreate', 'decideDescriptionWrite', 'branchReasonText', 'VC_BRANCHES_PHONE', 'VC_BRANCH_WRITE_PHONE', 'VC_BRANCH_OP_IDS', 'VC_BRANCH_ACTIONS', 'vcNewBranchRead', 'vcBranchShapeOk', 'vcReadBranches', 'vcBranchBoardOf', 'vcBranchStateOf', 'vcBranchWriteResultOf', 'vcBranchRequestOf', 'vcBranchDryRun', 'vcBranchWrite', 'vcBranchReplyKindOf', 'vcBranchReasonsOf', 'vcBranchConfirmOf', 'vcBranchResultOf', 'vcBranchBoardNode']
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
  contract: 'version-control.branch-board', version: 1, readAtMs: 1790000000000,
  current: { name: 'main', oid: OID },
  branches: [
    { name: 'main', oid: OID, current: true, upstream: 'origin/main', ahead: 2, behind: 1, commitDateMs: 1790000000000 },
    { name: 'feature', oid: OID2, current: false, upstream: '', ahead: 0, behind: 0, commitDateMs: 1780000000000 },
  ],
  tags: [
    { name: 'v1.0.0', oid: OID, objectType: 'commit', annotated: false, atMs: 1790000000000, subject: '首个版本' },
    { name: 'v1.1.0', oid: OID2, objectType: 'tag', annotated: true, atMs: 1795000000000, subject: '第二版' },
  ],
  descriptions: { main: '主干；发布从这里切', feature: '' },
  merged: ['main'],
  notMerged: ['feature'],
}
function fakeCall(reply) {
  const calls = []
  const call = function (phone, args) { calls.push({ phone: phone, args: args }); return Promise.resolve(typeof reply === 'function' ? reply(calls.length, phone, args) : reply) }
  return { call: call, calls: calls }
}

// ---------- 假 subprocess 适配器 ----------
const LIVE = readJson('tests/fixtures/version-control/live-numstat-shapes.json')
const LIVE_ROOT = /^worktree ([^\u0000\n]+)/.exec(LIVE.worktrees.out)[1]
const REFS_OUT = [
  ['refs/heads/main', 'main', OID, 'origin/main', '[ahead 2, behind 1]', '*', '2026-10-04T00:14:04+08:00'].join('\u0000'),
  ['refs/heads/feature', 'feature', OID2, '', '', ' ', '2025-10-04T00:14:04+08:00'].join('\u0000'),
].join('\n') + '\n'
const TAGS_OUT = ['v1.0.0', OID, 'commit', '1790000000', '首个版本'].join('\u0000') + '\n' + ['v1.1.0', OID2, 'tag', '1795000000', '第二版'].join('\u0000') + '\n'
const MERGED_OUT = '  main\n'
const NOTMERGED_OUT = '  feature\n'
const DESCRIPTIONS_OUT = 'branch.main.description\n主干；发布从这里切\u0000'
function makeCollector(text, truncated) { return { finalize() { return { text: String(text), truncated: truncated === true } } } }
function afterPrefix(argv) { const at = argv.indexOf('i18n.logOutputEncoding=UTF-8'); return at < 0 ? null : argv.slice(at + 1) }
function makeRoute(opts) {
  const o = opts || {}
  const seen = []
  function route(argv) {
    seen.push(argv.slice())
    const a = afterPrefix(argv)
    if (a === null) return { code: 1, stderr: '缺少固定前缀' }
    if (argv.indexOf('--version') >= 0) return { code: 0, stdout: (o.version || LIVE.source.gitVersion) + '\n' }
    if (a[0] === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) return o.noRepo ? { code: 1, stdout: '', stderr: 'fatal: not a git repository\n' } : { code: LIVE.step0.code, stdout: LIVE.step0.out, stderr: LIVE.step0.err }
    if (a[0] === 'rev-parse' && a.indexOf('--show-toplevel') >= 0) return { code: 0, stdout: LIVE_ROOT + '\n' }
    if (a[0] === 'rev-parse' && a.indexOf('--verify') >= 0) return o.fail && o.fail.rev ? { code: 1, stdout: '', stderr: 'fatal: bad revision\n' } : { code: 0, stdout: OID + '\n' }
    if (a[0] === 'status') return o.fail && o.fail.status ? { code: 1, stdout: '', stderr: 'fatal: status 失败\n' } : { code: LIVE.status.code, stdout: o.status || LIVE.status.out, stderr: LIVE.status.err }
    if (a[0] === 'worktree') return { code: LIVE.worktrees.code, stdout: LIVE.worktrees.out, stderr: LIVE.worktrees.err }
    if (a[0] === 'for-each-ref') {
      if (a.indexOf('refs/tags/') >= 0) return o.fail && o.fail.tags ? { code: 1, stdout: '', stderr: 'fatal: tags 失败\n' } : { code: 0, stdout: TAGS_OUT }
      return o.fail && o.fail.refs ? { code: 1, stdout: '', stderr: 'fatal: refs 失败\n' } : { code: 0, stdout: REFS_OUT }
    }
    if (a[0] === 'branch' && a[1] === '--merged') return { code: 0, stdout: MERGED_OUT }
    if (a[0] === 'branch' && a[1] === '--no-merged') return { code: 0, stdout: NOTMERGED_OUT }
    if (a[0] === 'config' && a.indexOf('--get-regexp') >= 0) {
      if (o.fail && o.fail.descriptions) return { code: 2, stdout: '', stderr: 'fatal: bad config\n' }
      return { code: o.noDescriptions ? 1 : 0, stdout: o.noDescriptions ? '' : DESCRIPTIONS_OUT, stderr: '' }
    }
    if (a[0] === 'switch' || a[0] === 'checkout' || a[0] === 'branch' || a[0] === 'tag' || a[0] === 'config' || a[0] === 'verify-commit' || a[0] === 'verify-tag') {
      if (o.fail && o.fail.write) return { code: 1, stdout: '', stderr: 'fatal: 写失败（假）\n' }
      if (a[0] === 'verify-commit' || a[0] === 'verify-tag') return o.verified ? { code: 0, stdout: 'Good signature\n', stderr: '' } : { code: 1, stdout: '', stderr: 'error: no signature found\n' }
      return { code: 0, stdout: '', stderr: '' }
    }
    if (a[0] === 'log') return { code: LIVE.log.code, stdout: LIVE.log.out, stderr: LIVE.log.err }
    if (a[0] === 'diff' && a.indexOf('--numstat') >= 0) return { code: LIVE.diffFiles.code, stdout: LIVE.diffFiles.out, stderr: LIVE.diffFiles.err }
    if (a[0] === 'stash') return { code: 0, stdout: '' }
    if (a[0] === 'reflog') return { code: 128, stdout: '', stderr: 'fatal: bad revision\n' }
    return { code: 0, stdout: '' }
  }
  return { route: route, seen: seen }
}
function makeHostDeps(route) {
  const logs = []
  const deps = {
    subprocess: { spawn(req) { const hit = route(req.argv) || { code: 0, stdout: '' }; return { done: Promise.resolve({ exitCode: hit.code === undefined ? 0 : hit.code, signal: hit.signal }), collected: { stdout: makeCollector(hit.stdout || '', hit.truncated), stderr: makeCollector(hit.stderr || '', false) }, terminate() {} } } },
    timer: { timeout() { return new Promise(function (resolve) { setTimeout(resolve, 1) }) } },
    fs: { stat() { return Promise.reject(Object.assign(new Error('没有这个文件'), { code: 'ENOENT' })) }, lstat() { return Promise.resolve(null) }, exists() { return Promise.resolve(false) } },
    getPlatform: async function () { return { resolveExecutable: async function (name) { return name === 'git' ? 'git' : null } } },
    DEFAULT_CWD: 'D:/假工作区/repo', TIMEOUT_MS: 30000, gate: { noteOutbound() {} },
    logCtx: { fire(level, event, fields) { logs.push({ level: level, event: event, fields: fields }) } },
  }
  return { deps: deps, logs: logs }
}

async function main() {
  console.log('分支与标签域门禁（#1746 T11：共享判定 + 命令 argv + 客户端面板 + 真宿主 + 反证）')
  const BD = await import(sharedUrl('branch-decisions.js'))
  const PB = await import(sharedUrl('parse-branch.js'))
  const CM = await import(sharedUrl('commands.js'))
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const ledger = await import(sharedUrl('capability-ledger.js'))

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

  // B 组：命令 argv（与共享层同一份真源）
  check(CM.branchCreateArgs('x', 'HEAD').join(' ') === 'switch -c x HEAD' && CM.branchCreateCheckoutArgs('x').join(' ') === 'checkout -b x', 'B1 4.2 新建并切换：switch -c（2.23 以下降级 checkout -b）')
  check(CM.branchSwitchArgs('x').join(' ') === 'switch x' && CM.branchSwitchCheckoutArgs('x').join(' ') === 'checkout x', 'B2 4.3 切换：switch（降级 checkout）')
  check(CM.branchDetachArgs(OID).join(' ') === 'switch --detach ' + OID && CM.branchDetachCheckoutArgs(OID).join(' ') === 'checkout ' + OID, 'B3 4.4 分离头：switch --detach（降级 checkout）')
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
  const desc = PB.parseBranchDescriptions(DESCRIPTIONS_OUT)
  check(desc.ok === true && desc.descriptions.main === '主干；发布从这里切', 'C6 分支说明解析：键值成对')
  check(PB.parseBranchDescriptions('branch.main.description\0a\0not-a-desc\0').ok === false, 'C7 分支说明解析：非 description 键判失败')
  check(PB.parseDescriptionText('一行\n').ok === true && PB.parseDescriptionText('一行\n').text === '一行', 'C8 说明文本只去一个行尾换行')
  check(PB.PARSE_BRANCH_SOURCE === 'src/shared/version-control/src/parse-branch.ts', 'C9 解析器文件报出自己的真源路径')

  // D 组：客户端数据层与业务面板
  const built = buildClient(null)
  const V = built.v
  check(V.VC_BRANCHES_PHONE === 'wf.gitBranches' && V.VC_BRANCH_WRITE_PHONE === 'wf.gitBranchWrite', 'D1 两条电话名与宿主注册一致')
  check(V.vcNewBranchRead().state === 'idle' && V.vcNewBranchRead().data === null, 'D2 新读数是 idle')
  check(V.vcBranchShapeOk(BOARD) === true, 'D3 形状判据：契约/版本/两个清单齐放行')
  check(V.vcBranchShapeOk(Object.assign({}, BOARD, { version: 2 })) === false && V.vcBranchShapeOk(Object.assign({}, BOARD, { branches: null })) === false, 'D4 版本不对或分支清单缺失判红')
  const readReply = Object.assign({ ok: true }, BOARD)
  const readCall = fakeCall(readReply)
  const rRead = await V.vcReadBranches({}, readCall.call, 'D:/假工作区/repo')
  check(readCall.calls.length === 1 && readCall.calls[0].phone === V.VC_BRANCHES_PHONE, 'D5 读面板：只发一次读电话')
  check(V.vcBranchStateOf(rRead) === 'ok' && V.vcBranchBoardOf(rRead).branches.length === 2, 'D6 读成功：整份读数落成 ok')
  const failRead = await V.vcReadBranches(rRead, fakeCall({ ok: false, error: { kind: 'env', message: '找不到 git' } }).call, 'D:/假工作区/repo')
  check(V.vcBranchStateOf(failRead) === 'err' && V.vcBranchBoardOf(failRead) !== null, 'D7 读失败保留旧数据（失败绝不清空）')
  check(V.vcBranchRequestOf('4.6', { name: 'feature' }).kind === 'delete' && V.vcBranchRequestOf('4.13', { branch: 'main', text: 'x' }).kind === 'describe', 'D8 能力号到写动作 kind 的映射')
  check(V.vcBranchRequestOf('4.1', {}) .kind === '', 'D9 只读能力号不发写请求（kind 为空）')
  check(V.vcBranchRequestOf('4.6', { name: 'x', confirmed: false }).confirmed === false, 'D10 写请求原样带 confirmed 字段')
  const dryCall = fakeCall({ ok: true, dryRun: true, decision: { verdict: 'allow', reasons: ['ok'] }, confirm: { kind: 'delete', target: 'feature', verb: '删除分支 feature' } })
  await V.vcBranchDryRun({}, dryCall.call, 'D:/假工作区/repo', '4.6', { name: 'feature' })
  check(dryCall.calls.length === 1 && dryCall.calls[0].phone === V.VC_BRANCH_WRITE_PHONE && dryCall.calls[0].args.dryRun === true, 'D11 预检：发写电话但带 dryRun，不执行')
  check(V.vcBranchReplyKindOf({ ok: true, dryRun: true }) === 'dry-run' && V.vcBranchReplyKindOf({ ok: false, error: { kind: 'need-confirm' } }) === 'need-confirm' && V.vcBranchReplyKindOf({ ok: true, kind: 'delete' }) === 'done', 'D12 回包分类：预检 / 待确认 / 已完成')
  check(V.vcBranchReplyKindOf({ ok: false, error: { kind: 'blocked' } }) === 'fail' && V.vcBranchReplyKindOf({ ok: false, error: { kind: 'git-failed' } }) === 'fail', 'D13 block 与 git 失败都按失败显示')
  check(V.vcBranchReasonsOf({ ok: false, reasons: ['mid-operation'] }).join(',') === 'mid-operation' && V.vcBranchReasonsOf({ ok: false, decision: { reasons: ['unsaved-changes'] } }).join(',') === 'unsaved-changes', 'D14 理由标识符从回包原样带出（界面不造理由）')
  check(V.vcBranchConfirmOf({ confirm: { verb: 'v', target: 't', kind: 'k' } }).verb === 'v' && V.vcBranchConfirmOf({}) === null, 'D15 确认卡素材：有就带、没有就不画')
  check(V.vcBranchResultOf({ ok: true, command: 'branch -d feature' }).state === 'ok' && V.vcBranchResultOf({ ok: false, error: { kind: 'git-failed', git: 'fatal', step: '删除分支这一步', expected: 'e', actual: 'a', cause: 'c' } }).state === 'fail', 'D16 结果贴点：成功与失败两种读数')
  const tree = V.vcBranchBoardNode(fakeH, tZh, { board: BOARD })
  const ops = attrsOf(tree, 'data-vc-op')
  const uniq = Array.from(new Set(ops)).sort()
  check(uniq.join(',') === '4.10,4.11,4.12,4.13,4.2,4.3,4.4,4.5,4.6,4.7', 'D17 面板十条写动作各有 data-vc-op（实得 ' + uniq.join(',') + '）')
  check(attrsOf(tree, 'data-vc-branch-row').join(',') === 'main,feature', 'D18 面板逐分支画行')
  check(attrsOf(tree, 'data-vc-tag-row').join(',') === 'v1.0.0,v1.1.0', 'D19 面板逐标签画行')
  check(attrsOf(tree, 'data-vc-branch-merged') [0] === '1' && attrsOf(tree, 'data-vc-branch-notmerged')[0] === '1', 'D20 4.8 两张名单一起画')
  check(tree.props['data-vc-branch-writes'] === '10' && tree.props['data-vc-branch-ops'] === '13', 'D21 面板声明十条写动作与十三条能力入口')
  const empty = V.vcBranchBoardNode(fakeH, tZh, { board: null })
  check(attrsOf(empty, 'data-vc-branch2-empty').length === 1 && attrsOf(empty, 'data-vc-branch-row').length === 0, 'D22 没读数时画空态与重试，不画假分支')
  const logsBox = buildClient(null)
  await logsBox.v.vcReadBranches({}, fakeCall(readReply).call, 'D:/假工作区/repo')
  await logsBox.v.vcReadBranches({}, fakeCall({ ok: false, error: { kind: 'env', message: '坏了' } }).call, 'D:/假工作区/repo')
  const evs = logsBox.logs.map(function (l) { return l.event })
  check(evs.indexOf('host.call') >= 0 && evs.indexOf('host.call.fail') >= 0, 'D23 成功与失败落在既有日志事件上（host.call / host.call.fail）')
  const okLog = logsBox.logs.filter(function (l) { return l.event === 'host.call' })[0]
  check(!!okLog && !!okLog.fields && okLog.fields.kind === 'git-branches', 'D24 成功日志带 kind=git-branches')

  // E 组：真宿主假路由
  const happy = makeRoute({})
  const vc = hostMod.createVersionControl(makeHostDeps(happy.route).deps)
  check(typeof vc.handleGitBranches === 'function' && typeof vc.handleGitBranchWrite === 'function', 'E1 宿主把读/写两条电话露出来了')
  const board = await vc.handleGitBranches({ cwd: 'D:/假工作区/repo' })
  check(board.ok === true && board.contract === 'version-control.branch-board' && board.version === 1, 'E2 读回包带契约名与版本号')
  check(Array.isArray(board.branches) && board.branches.length === 2 && board.branches[0].name === 'main' && board.branches[0].current === true, 'E3 分支列表读到 main 并标当前分支')
  check(Array.isArray(board.branches) && board.branches.length === 2 && board.branches[1].name === 'feature' && board.branches[1].current === false, 'E4 非当前分支照常列出')
  check(Array.isArray(board.tags) && board.tags.length === 2 && board.tags[1].annotated === true, 'E5 标签列表读到两个标签并认出附注标签')
  check(Array.isArray(board.merged) && board.merged.join(',') === 'main' && Array.isArray(board.notMerged) && board.notMerged.join(',') === 'feature', 'E6 4.8 已并入 / 没并入两张名单')
  check(!!board.descriptions && board.descriptions.main === '主干；发布从这里切' && board.descriptions.feature === undefined, 'E7 4.13 分支说明一次读回')
  check(board.current && board.current.name === 'main', 'E8 当前分支单独给出')
  const createDry = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'create', name: 'feature2', from: 'HEAD', dryRun: true })
  check(createDry.ok === true && createDry.dryRun === true && createDry.decision.verdict === 'allow', 'E9 4.2 预检放行：只回判定，不执行')
  check(createDry.confirm && createDry.confirm.target === 'feature2', 'E10 预检给确认卡素材')
  check(happy.seen.filter(function (argv) { return argv.indexOf('switch') >= 0 || argv.indexOf('checkout') >= 0 }).length === 0, 'E11 预检那一趟没有真执行写命令')
  const createBlocked = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'create', name: 'main', dryRun: true })
  check(createBlocked.ok === false && createBlocked.error.kind === 'blocked' && !!createBlocked.decision && createBlocked.decision.reasons[0] === 'branch-exists', 'E12 4.2 同名分支：block 并带固定理由')
  const createCheckout = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'switch', name: 'feature' })
  check(createCheckout.ok === false && createCheckout.error.kind === 'need-confirm', 'E13 4.3 有未提交改动：warn 回 need-confirm，等确认卡')
  const afterConfirm = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'switch', name: 'feature', confirmed: true })
  check(afterConfirm.ok === true && afterConfirm.kind === 'switch', 'E14 4.3 确认后才执行切换')
  const switchArgv = happy.seen.filter(function (argv) { return argv.indexOf('switch') >= 0 })[0]
  check(!!switchArgv && switchArgv.indexOf('feature') > 0, 'E15 4.3 真执行时用 switch feature（固定前缀包着）')
  const delCurrent = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'delete', name: 'main', dryRun: true })
  check(delCurrent.ok === false && !!delCurrent.decision && delCurrent.decision.reasons[0] === 'cannot-delete-current', 'E16 4.6 当前分支不能删')
  const delNotMerged = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'delete', name: 'feature', dryRun: true })
  check(delNotMerged.ok === false && !!delNotMerged.decision && delNotMerged.decision.reasons[0] === 'branch-not-merged', 'E17 4.6 没并入的分支默认不能删')
  const delForce = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'delete', name: 'feature', force: true, dryRun: true })
  check(delForce.ok === true && delForce.decision.verdict === 'warn' && delForce.decision.reasons[0] === 'force-delete', 'E18 4.6 强制删除先提醒再确认')
  const delRun = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'delete', name: 'feature', force: true, confirmed: true })
  check(delRun.ok === true && String(delRun.command || '').indexOf('branch -D') === 0, 'E19 4.6 确认后真用 -D 删')
  const tagBlocked = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'tag-create', name: 'v1.0.0', mode: 'light', dryRun: true })
  check(tagBlocked.ok === false && !!tagBlocked.decision && tagBlocked.decision.reasons[0] === 'tag-exists', 'E20 4.10 同名标签不能建')
  const tagAnnotated = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'tag-create', name: 'v2.0.0', mode: 'annotated', message: '', dryRun: true })
  check(tagAnnotated.ok === false && !!tagAnnotated.decision && tagAnnotated.decision.reasons[0] === 'missing-tag-message', 'E21 4.10 附注标签缺说明不能建')
  const tagSignedDry = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'tag-create', name: 'v2.0.0', mode: 'signed', message: '说明', dryRun: true })
  check(tagSignedDry.ok === true && tagSignedDry.decision.reasons[0] === 'signing-needs-key', 'E22 4.10 签名标签提醒密钥依赖')
  const describe = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'describe', branch: 'feature', text: '新说明', confirmed: true })
  check(describe.ok === true && describe.description === '新说明', 'E23 4.13 写分支说明成功（只改本地配置）')
  const describeArgv = happy.seen.filter(function (argv) { return argv.indexOf('branch.feature.description') >= 0 })[0]
  check(!!describeArgv && describeArgv.indexOf('--edit') < 0, 'E24 4.13 写说明不调用 --edit（GIT_EDITOR 已设必失败命令）')
  const verifyBad = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'verify', objectKind: 'tag', object: 'v1.0.0' })
  check(verifyBad.ok === true && verifyBad.verified === false && verifyBad.exitCode === 1, 'E25 4.12 没签名照实说没验过（不冒充成功）')
  check(typeof verifyBad.gitSays === 'string' && verifyBad.gitSays.indexOf('no signature') >= 0, 'E26 4.12 验签回带 git 原话')
  const verifiedRoute = makeRoute({ verified: true })
  const verified = await hostMod.createVersionControl(makeHostDeps(verifiedRoute.route).deps).handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'verify', objectKind: 'commit', object: OID })
  check(verified.ok === true && verified.verified === true, 'E27 4.12 真验过才说 verified:true')
  const upstreamDry = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'upstream', branch: 'feature', upstream: 'origin/feature', dryRun: true })
  check(upstreamDry.ok === true && upstreamDry.dryRun === true, 'E28 4.7 设置上游预检放行')
  const badUpstream = await vc.handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'upstream', branch: 'feature', upstream: 'feature', dryRun: true })
  check(badUpstream.ok === false && ((!!badUpstream.decision && badUpstream.decision.reasons[0] === 'bad-upstream') || badUpstream.error.message.indexOf('上游') >= 0), 'E29 4.7 上游写法不合法当场拒')
  const failWriteRoute = makeRoute({ fail: { write: true } })
  const failedWrite = await hostMod.createVersionControl(makeHostDeps(failWriteRoute.route).deps).handleGitBranchWrite({ cwd: 'D:/假工作区/repo', kind: 'tag-delete', name: 'v1.0.0', confirmed: true })
  check(failedWrite.ok === false && failedWrite.error.kind === 'git-failed' && String(failedWrite.git || '').indexOf('写失败') >= 0, 'E30 写失败回带 git 原话（不冒充完成）')
  const notRepo = makeRoute({ noRepo: true })
  const notRepoBoard = await hostMod.createVersionControl(makeHostDeps(notRepo.route).deps).handleGitBranches({ cwd: 'D:/不在仓库里' })
  check(notRepoBoard.ok === false && notRepoBoard.error.kind !== '', 'E31 不在仓库里：读面板如实失败')
  const tagFail = makeRoute({ fail: { tags: true } })
  const tagFailBoard = await hostMod.createVersionControl(makeHostDeps(tagFail.route).deps).handleGitBranches({ cwd: 'D:/假工作区/repo' })
  check(tagFailBoard.ok === false && !!tagFailBoard.error && String(tagFailBoard.error.kind) !== '', 'E32 标签这一路失败：整份读失败（不给半份面板）')
  const descFail = makeRoute({ fail: { descriptions: true } })
  const descFailBoard = await hostMod.createVersionControl(makeHostDeps(descFail.route).deps).handleGitBranches({ cwd: 'D:/假工作区/repo' })
  check(descFailBoard.ok === false && !!descFailBoard.error && String(descFailBoard.error.message).indexOf('分支说明') >= 0, 'E33 分支说明这一路失败：整份读失败且说清是哪一步')
  const noDesc = makeRoute({ noDescriptions: true })
  const noDescBoard = await hostMod.createVersionControl(makeHostDeps(noDesc.route).deps).handleGitBranches({ cwd: 'D:/假工作区/repo' })
  check(noDescBoard.ok === true && Object.keys(noDescBoard.descriptions).length === 0, 'E34 一条说明都没配过（config 退出码 1）：不算失败')
  const callLog = makeHostDeps(happy.route)
  await hostMod.createVersionControl(callLog.deps).handleGitBranches({ cwd: 'D:/假工作区/repo' })
  check(callLog.logs.filter(function (l) { return l.event === 'host.call' && l.fields && l.fields.kind === 'git-branches' }).length >= 1, 'E35 读这趟落在 host.call 日志上（kind=git-branches）')

  // F 组：反证组（把被守的东西改坏，原判据必须当场判红）
  const antiConfirm = buildClient(function (s) { return s.replace('req.confirmed = true', 'req.confirmed = false') })
  check(antiConfirm.changed === true, 'F1 反证：改坏「确认后带 confirmed」那行——替换真的改到了原文')
  const antiConfirmCall = fakeCall({ ok: true, kind: 'switch' })
  await antiConfirm.v.vcBranchWrite({}, antiConfirmCall.call, 'D:/假工作区/repo', '4.3', { name: 'feature' })
  check(antiConfirmCall.calls.length === 1 && antiConfirmCall.calls[0].args.confirmed === false, 'F2 反证：确认后不带 confirmed 时，E14 那条「确认后才执行」判据当场判红')
  // 反证：把 4.6 的能力号从动作表里改掉，D17 那条「十条写动作各有 data-vc-op」必须当场看出少一条。
  const antiOps = buildClient(function (s) { return s.replace("{ op: '4.6', kind: 'delete'", "{ op: '4.99', kind: 'delete'") })
  check(antiOps.changed === true && Array.from(new Set(attrsOf(antiOps.v.vcBranchBoardNode(fakeH, tZh, { board: BOARD }), 'data-vc-op'))).sort().join(',') !== uniq.join(','), 'F5 反证：动作表里 4.6 被改成 4.99 后，D17 的十条写动作判据当场判红')
  const antiShape = buildClient(function (s) { return s.replace('if (Number(board.version) !== VC_BRANCH_BOARD_VERSION) return false', 'if (false) return false') })
  check(antiShape.changed === true && antiShape.v.vcBranchShapeOk(Object.assign({}, BOARD, { version: 9 })) === true, 'F3 反证：版本判据被改坏后，版本不对的回包被放行——D4 那条断言当场判红')
  const antiBadge = buildClient(function (s) { return s.replace("if (b.current === true) badges.push", "if (false) badges.push") })
  const antiTree = antiBadge.v.vcBranchBoardNode(fakeH, tZh, { board: BOARD })
  const badgeNodes = walk(antiTree, []).filter(function (n) { return n && n.props && n.props.className === 'vcs-branch2-badge' })
  check(antiBadge.changed === true && badgeNodes.length === 1, 'F4 反证：当前分支徽标那一行被改坏后，本应两枚的徽标只剩上游那枚（D18 起的分支行判据能看出来）')

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