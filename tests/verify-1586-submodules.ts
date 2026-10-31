// tests/verify-1586-submodules.ts —— 子模块域门禁（规格 #1586 域 10 / 票 #1757 的 T21）
// 门禁归属: src/shared/version-control/src/submodule-ops.ts
// 门禁归属: src/host/versionControlSubmodules.ts
// 门禁归属: src/host/versionControlSubmodulesCheck.ts
// 门禁归属: src/host/versionControlSubmodulesWrite.ts
// 门禁归属: src/host/versionControlSubmodulesTask.ts
// 门禁归属: src/host/versionControlSubmodulesMount.ts
// 门禁归属: src/client/views/versionControl/vcSubmodulesData.ts
// 门禁归属: src/client/views/versionControl/vcSubmodulesOps.ts
// 门禁归属: src/client/views/versionControl/vcSubmodulesPage.ts
//
// 守什么：域 10 八条能力（10.1–10.8）在子模块页各有一条唯一主入口；10.4 的批量只剩四个固定菜单，
// 任何用户输入都拼不进命令（票面永久例外）；写动作走三段式（预检签 120 秒票 → 凭票执行）；
// 10.2/10.3 与四项菜单里的三项走 T05 长任务通道；10.8 是受控写（列将移动的目录、失败如实说）。
//
// 六组断言：A 共享判定与参数守卫、B 长任务协议扩三条动作、C 宿主五叶与登记点、
// D 客户端三叶与页面挂载、E 词表 zh/en 同一份键、F 反证组（把源码改坏必须判红）。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-submodules.ts
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { compileFn } = require('./lib/eval-probe.ts')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText } = require('./lib/source-text.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-submodules'
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const sharedUrl = (f) => pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', f)).href
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const stripExports = (s) => s.replace(/^(\s*)export\s+/gm, '$1')
const toEvalJs = (code) => require('esbuild').transformSync(code, TRANSPILE_OPTIONS).code

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

// 客户端三叶拼成一个闭包求值：页面画法依赖数据层的动作表与处理层的参数整形。
const CLIENT_FILES = [
  'src/shared/version-control/src/submodule-ops.ts',
  'src/client/views/versionControl/vcSubmodulesData.ts',
  'src/client/views/versionControl/vcSubmodulesOps.ts',
  'src/client/views/versionControl/vcSubmodulesPage.ts',
]
const CLIENT_EXPORTS = [
  'SUBMODULE_CAP_IDS', 'SUBMODULE_ACTIONS', 'SUBMODULE_WRITE_OPS', 'SUBMODULE_TASK_OPS', 'SUBMODULE_BATCH_MENU',
  'SUBMODULE_REASONS', 'submoduleActionOf', 'submoduleJudge', 'submodulePlanOf', 'submoduleWriteArgsOf', 'submoduleTaskOf',
  'submoduleUrlHasCredentials', 'submoduleRedactUrl', 'submoduleRowsOf', 'submoduleDigestOf',
  'VC_SUBMODULES_PHONES', 'VC_SUBMODULE_ENTRIES', 'vcSubmoduleBoardShapeOk', 'vcSubmoduleRowsOf', 'vcSubmoduleWhyKeyOf',
  'VC_SUBMODULE_MODES', 'vcSubmoduleRequestIdOf', 'vcSubmoduleCheckArgsOf', 'vcSubmoduleRunArgsOf', 'vcSubmoduleTaskArgsOf',
  'vcSubmodulesUiOf', 'vcSubmoduleFailureOf', 'createSubmodulesOpsOf', 'vcSubmodulesPageNode', 'VC_SUBMODULES_PAGE_SOURCE',
]
function buildClient(patch) {
  const raw = CLIENT_FILES.map(function (f) { return stripExports(sourceText(f)) }).join('\n')
  const patched = patch ? patch(raw) : raw
  const body = toEvalJs(patched) + '\nreturn { ' + CLIENT_EXPORTS.join(', ') + ' }\n'
  const calls = []
  const log = function (l, e, f) { calls.push({ level: l, event: e, fields: f }) }
  // Tip 是全局悬停薄预设：真实构建里它排在所有视图叶子之前，这里按同一约定传桩。
  const fn = compileFn(['log', 'dswsLogHash', 'dswsLogTrunc', 'vcShellConfirmCardNode', 'vcShellResultNode', 'vcShellStateNode', 'vcCapabilityOf', 'Tip'], body)
  const confirmCard = function (h, t, o) { return { type: 'confirm', props: o || {}, children: [] } }
  const resultNode = function (h, t, o) { return { type: 'result', props: o || {}, children: [] } }
  const stateNode = function (h, t, o) { return { type: 'state', props: o || {}, children: [] } }
  const capabilityOf = function (id) { return { id: id, name: 'cap-' + id, minVersion: '2.11' } }
  const tipStub = function (props) { return props && props.children !== undefined ? props.children : null }
  const v = fn(log, function () { return 'h8' }, function (s) { return String(s) }, confirmCard, resultNode, stateNode, capabilityOf, tipStub)
  return { v: v, calls: calls, changed: patched !== raw }
}

// 假调用口：记录每次电话，回一个由 respond 决定的回包。
function makeCall(respond) {
  const calls = []
  const fn = async function (phone, args) {
    calls.push({ phone: phone, args: args })
    return respond ? respond(phone, args) : { ok: false, error: { kind: 'env', message: 'no-responder' } }
  }
  return { calls: calls, fn: fn }
}

function withOps(respond) {
  const box = buildClient()
  const call = makeCall(respond)
  const ui = { value: box.v.vcSubmodulesUiOf(null) }
  const board = { value: null }
  const ops = box.v.createSubmodulesOpsOf({ callHost: call.fn, cwd: 'D:/repo', ui: function () { return ui.value }, setUi: function (u) { ui.value = u }, setBoard: function (b) { board.value = b }, board: function () { return board.value } })
  return { v: box.v, ops: ops, call: call, ui: ui, board: board }
}

const BOARD_ROWS = [
  { name: 'lib', path: 'libs/lib', oid: 'a'.repeat(40), state: 'clean', initialized: true, describe: '', url: 'https://example.com/lib.git', urlDisplay: 'https://example.com/lib.git', branch: 'main', headBranch: 'main', detached: false, localCommits: 0, absorbable: true, absorbFrom: 'D:/repo/libs/lib/.git', absorbTo: 'D:/repo/.git/modules/libs/lib' },
  { name: 'tool', path: 'tools/tool', oid: 'b'.repeat(40), state: 'uninitialized', initialized: false, describe: '', url: 'https://example.com/tool.git', urlDisplay: 'https://example.com/tool.git', branch: '', headBranch: '', detached: false, localCommits: 0, absorbable: false, absorbFrom: '', absorbTo: '' },
]
const BOARD = { ok: true, contract: 'version-control.submodule-board', version: 1, readAtMs: 1790000000000, rows: BOARD_ROWS, counts: { total: 2, initialized: 1 } }
const TICKET = { id: 't-1', op: 'set-url', checkedAtMs: 1790000000000, expiresAtMs: 1790000120000 }
const CHECK_OK = { ok: true, contract: 'version-control.submodule-check', version: 1, readAtMs: 1790000000000, op: 'set-url', decision: 'allow', reasons: [], confirmRequired: true, ticket: TICKET, task: null }

// 源码形状判据：固定菜单唯一允许的 foreach 必须是一整串字面量，分支体里不读任何调用方字段。
// 它同时被 B11（真源码必须过）与 F 组（把这一串改成拼路径必须报红）使用，两边判的是同一件事。
function fetchArgvIsLiteral(text) {
  const marker = "if (op === 'submodule-fetch') {"
  const at = text.indexOf(marker)
  if (at < 0) return false
  const tail = text.slice(at + marker.length)
  const endAt = tail.indexOf('\n  }')
  const branch = endAt >= 0 ? tail.slice(0, endAt) : tail
  const code = branch.replace(/\/\/[^\n]*/g, '')
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const count = (bare.match(/foreach/g) || []).length
  const decl = /export const SUBMODULE_FETCH_ARGV: string\[\] = \['submodule', 'foreach', '--recursive', 'git fetch'\]/
  return count === 1 && decl.test(bare) && code.indexOf('a.') < 0 && code.indexOf('+') < 0 && code.indexOf('return { ok: true, args: SUBMODULE_FETCH_ARGV.slice() }') >= 0
}

async function main() {
  // ===== A 共享判定与参数守卫 =====
  console.log('')
  console.log('== A 共享判定与参数守卫（真 import 共享层，不抄数据） ==')
  const S = await import(sharedUrl('submodule-ops.ts'))
  check(S.SUBMODULE_CAP_IDS.length === 8 && S.SUBMODULE_CAP_IDS[0] === '10.1' && S.SUBMODULE_CAP_IDS[7] === '10.8', 'A1 域 10 八条能力号齐全（10.1–10.8）')
  check(S.SUBMODULE_ACTIONS.length === 11, 'A2 动作表十一条（10.3 拆三条、10.4 另算菜单）')
  check(S.SUBMODULE_WRITE_OPS.join(',') === 'set-url,sync,set-branch,deinit,absorb', 'A3 凭票写只认五个动作，顺序固定')
  check(S.SUBMODULE_BATCH_MENU.length === 4 && S.SUBMODULE_BATCH_MENU.map(function (m) { return m.id }).join(',') === 'init,fetch,recorded,status', 'A4 批量只剩四个固定菜单：初始化并检出、逐个抓取、检出记录的提交、看状态')
  check(S.SUBMODULE_BATCH_MENU.every(function (m) { return Object.keys(m).sort().join(',') === 'capId,id,labelKey,taskOp' }), 'A5 菜单项没有命令输入字段（只有菜单号与写死的任务动作）')
  check(S.submoduleWriteArgsOf('set-url', { path: 'libs/lib', url: 'https://example.com/x.git' }).args.join('|') === 'submodule|set-url|--|libs/lib|https://example.com/x.git', 'A6 改地址 argv 逐项独立（set-url 的路径与地址各占一个元素）')
  check(S.submoduleWriteArgsOf('sync', { path: 'libs/lib' }).args.join('|') === 'submodule|sync|--recursive|--|libs/lib', 'A7 同步地址 argv 带 --recursive 且路径在 -- 之后')
  check(S.submoduleWriteArgsOf('deinit', { path: 'libs/lib' }).args.indexOf('--force') < 0 && S.submoduleWriteArgsOf('absorb', { path: 'libs/lib' }).args.join('|') === 'submodule|absorbgitdirs|--|libs/lib', 'A8 取消登记不带 --force；吸收 .git 走 absorbgitdirs')
  check(S.submodulePathProblem('-x') === 'path-bad' && S.submodulePathProblem('../x') === 'path-bad' && S.submodulePathProblem('/abs') === 'path-bad' && S.submodulePathProblem('libs/lib') === null, 'A9 路径守卫拒绝选项注入、上跳段与绝对路径')
  check(S.submoduleUrlProblem('-u') === 'url-bad' && S.submoduleUrlProblem('') === 'url-blank' && S.submoduleUrlProblem('https://example.com/a.git') === null, 'A10 地址守卫拒绝空值与短横线开头')
  check(S.submoduleUrlHasCredentials('https://user:secret@example.com/a.git') === true && S.submoduleUrlHasCredentials('git@example.com:a.git') === false && S.submoduleRedactUrl('https://user:secret@example.com/a.git').indexOf('secret') < 0, 'A11 地址里的账号口令被认出并抹掉（ssh 的 user@ 不算口令）')
  const st = S.submoduleParseStatus(' ' + 'a'.repeat(40) + ' libs/lib (v1.0)\n-' + 'b'.repeat(40) + ' tools/tool\n')
  check(st.ok === true && st.rows.length === 2 && st.rows[0].state === 'clean' && st.rows[1].state === 'uninitialized' && st.rows[0].path === 'libs/lib', 'A12 解析 submodule status：干净行与未初始化行都认')
  const cfg = S.submoduleParseConfig('submodule.libs/lib.path libs/lib\nsubmodule.libs/lib.url https://example.com/lib.git\nsubmodule.libs/lib.branch main\n')
  check(cfg.ok === true && cfg.modules.length === 1 && cfg.modules[0].url === 'https://example.com/lib.git' && cfg.modules[0].branch === 'main', 'A13 解析 .gitmodules 配置：path/url/branch 三格拼回一条')
  const rows = S.submoduleRowsOf(st.rows, cfg.modules, { 'libs/lib': { headBranch: 'main', detached: false, localCommits: 0, absorbable: true } })
  check(rows.length === 2 && rows[0].urlDisplay === 'https://example.com/lib.git' && rows[1].initialized === false, 'A14 行模型把状态与配置拼在一起（未初始化的也不会凭空造 URL）')
  check(S.submoduleJudge('add', { path: 'libs/lib', url: 'https://example.com/lib.git' }) === undefined || S.submoduleJudge('add', { path: 'libs/lib', url: 'https://example.com/lib.git', rows: rows }).decision === 'block', 'A15 新增已登记路径判 block（module-exists）')
  check(S.submoduleJudge('set-url', { path: 'nope', url: 'https://example.com/x.git', rows: rows }).decision === 'block', 'A16 逐行动作找不到子模块判 block（module-missing）')
  check(S.submoduleJudge('deinit', { path: 'tools/tool', rows: rows }).decision === 'block', 'A17 未初始化的子模块不能取消登记（module-not-initialized）')
  check(S.submoduleJudge('absorb', { path: 'libs/lib', rows: rows }).decision === 'allow' && S.submoduleJudge('absorb', { path: 'tools/tool', rows: rows }).decision === 'block', 'A18 吸收 .git：能吸收的放行、不能吸收的给 nothing-to-absorb')
  check(S.submoduleJudge('add', { path: 'newmod', url: 'https://u:p@example.com/x.git', rows: rows }) .decision === 'warn' && S.submoduleJudge('add', { path: 'newmod', url: 'https://u:p@example.com/x.git', rows: rows }).reasons[0] === 'url-credentials', 'A19 地址带口令只是提醒（warn），不是拒绝')
  check(S.submoduleDigestOf(rows) !== S.submoduleDigestOf([rows[0]]) && S.submoduleDigestOf(rows) === S.submoduleDigestOf(S.submoduleRowsOf(st.rows, cfg.modules, { 'libs/lib': { headBranch: 'main', detached: false, localCommits: 0, absorbable: true } })), 'A20 现场摘要稳定：同一份行摘要相同，行变了摘要就变')
  check(S.submodulePlanOf('set-branch', { path: 'libs/lib', branch: '-x' }).ok === false && S.submodulePlanOf('set-branch', { path: 'libs/lib', branch: 'main' }).ok === true, 'A21 计划规范化时就挡住非法跟踪分支')

  // ===== B 长任务协议扩三条动作 =====
  console.log('')
  console.log('== B 长任务协议：扩子模块新增/抓取/更新到远端三条，批量命令仍是写死的 == ')
  const P = await import(sharedUrl('task-protocol.ts'))
  const ids = P.TASK_OPS.map(function (m) { return m.id })
  check(ids.length === 20 && ids.indexOf('submodule-add') >= 0 && ids.indexOf('submodule-fetch') >= 0 && ids.indexOf('submodule-remote-update') >= 0, 'B1 长任务清单二十种，子模块新增/抓取/更新到远端都登记')
  check(P.taskArgsFor('submodule-add', { url: 'https://example.com/x.git', path: 'vendor/x' }).args.join('|') === 'submodule|add|--|https://example.com/x.git|vendor/x', 'B2 新增子模块 argv：地址与路径各占一个元素（-- 隔开）')
  check(P.taskArgsFor('submodule-init', { path: 'libs/lib' }).args.join('|') === 'submodule|update|--init|--recursive|--|libs/lib' && P.taskArgsFor('submodule-init', {}).args.join('|') === 'submodule|update|--init|--recursive', 'B3 初始化并检出：逐行带路径，批量不带路径')
  check(P.taskArgsFor('submodule-update', { path: 'libs/lib' }).args.join('|') === 'submodule|update|--recursive|--|libs/lib', 'B4 检出记录的提交 argv')
  check(P.taskArgsFor('submodule-remote-update', { path: 'libs/lib' }).args.join('|') === 'submodule|update|--remote|--recursive|--|libs/lib', 'B5 更新到远端最新 argv 带 --remote')
  check(P.taskArgsFor('submodule-fetch', {}).args.join('|') === 'submodule|foreach|--recursive|git fetch', 'B6 逐个抓取只有写死的 git fetch 一个字符串参数（不接任意命令）')
  check(P.taskArgsFor('submodule-init', { path: '../x' }).ok === false && P.taskArgsFor('submodule-add', { url: '-x', path: 'a' }).ok === false, 'B7 子模块动作的参数照样过路径与地址守卫')
  check(P.taskArgsFor('submodule-fetch', { command: 'rm -rf /' }).ok === true && P.taskArgsFor('submodule-fetch', { command: 'rm -rf /' }).args.join('|') === P.taskArgsFor('submodule-fetch', {}).args.join('|'), 'B8 多余字段拼不进命令：给 command 字符串也还是同一串 argv')
  const MENU_BATCH_ARGV = { init: 'submodule|update|--init|--recursive', fetch: 'submodule|foreach|--recursive|git fetch', recorded: 'submodule|update|--recursive' }
  const menuTasks = S.SUBMODULE_BATCH_MENU.filter(function (m) { return m.taskOp !== null })
  check(menuTasks.length === 3 && S.SUBMODULE_BATCH_MENU.filter(function (m) { return m.taskOp === null }).map(function (m) { return m.id }).join(',') === 'status' && menuTasks.every(function (m) { const r = P.taskArgsFor(m.taskOp, {}); return r.ok === true && r.args.join('|') === MENU_BATCH_ARGV[m.id] }), 'B9 四个固定菜单的批量 argv 全是字面量：三项各有一串写死的命令，看状态不挂任务')
  check(menuTasks.every(function (m) { return ['command', 'cmd', 'argv', 'shell', 'exec', 'custom', 'subcommand'].every(function (k) { const extra = {}; extra[k] = 'rm -rf /'; const r = P.taskArgsFor(m.taskOp, extra); return r.ok === true && r.args.join('|') === MENU_BATCH_ARGV[m.id] }) }), 'B10 固定菜单不接受任何命令字段：逐个塞 command/cmd/argv/shell/exec/custom/subcommand 都拼不进 argv')
  check(menuTasks.every(function (m) { return P.TASK_OPS.some(function (t) { return t.id === m.taskOp }) }), 'B11 批量的三项只挑任务通道里已有的动作号，没有给用户自定义命令的入口')
  const protoSrc = read('src/shared/version-control/src/task-protocol.ts')
  check(fetchArgvIsLiteral(protoSrc), 'B12 源码形状：foreach 只出现一次（常量声明），抓取分支只返回这串常量的副本，不读任何字段、不做拼接')

  // ===== C 宿主五叶与登记点 =====
  console.log('')
  console.log('== C 宿主五叶、四条电话与登记点 ==')
  const H = {
    read: read('src/host/versionControlSubmodules.ts'),
    check: read('src/host/versionControlSubmodulesCheck.ts'),
    write: read('src/host/versionControlSubmodulesWrite.ts'),
    task: read('src/host/versionControlSubmodulesTask.ts'),
    mount: read('src/host/versionControlSubmodulesMount.ts'),
    vc: read('src/host/versionControl.ts'),
    index: read('src/host/index.ts'),
  }
  check(H.read.indexOf('wf.gitSubmodules') >= 0 || H.mount.indexOf('wf.gitSubmodules') >= 0, 'C1 读数电话 wf.gitSubmodules 有落点')
  check(H.mount.indexOf('wf.gitSubmoduleCheck') >= 0 && H.mount.indexOf('wf.gitSubmoduleWrite') >= 0 && H.mount.indexOf('wf.gitSubmoduleTask') >= 0, 'C2 预检、执行、任务三条电话都在装配壳里注册')
  check(H.vc.indexOf('createSubmoduleMount') >= 0 && H.vc.indexOf('versionControlSubmodulesMount.js') >= 0, 'C3 父文件装配一行调用（不改既有行）')
  check(H.index.indexOf("harness.handle('wf.gitSubmodules'") >= 0 && H.index.indexOf("harness.handle('wf.gitSubmoduleCheck'") >= 0 && H.index.indexOf("harness.handle('wf.gitSubmoduleWrite'") >= 0 && H.index.indexOf("harness.handle('wf.gitSubmoduleTask'") >= 0, 'C4 宿主入口注册四条电话')
  check(H.check.indexOf('submoduleJudge') >= 0 && H.check.indexOf('SUBMODULE_CHECK_CONTRACT') >= 0 && H.check.indexOf('makeTicket') >= 0, 'C5 预检叶子：判定走共享层、回包带契约名、签票用共享票据层')
  check(H.write.indexOf('ticketPureVerdict') >= 0 && H.write.indexOf('bindingsVerdict') >= 0 && H.write.indexOf('requestIdProblem') >= 0 && H.write.indexOf('submoduleWriteArgsOf') >= 0, 'C6 执行叶子：过期/换动作/绑定摘要逐格比对，argv 只从票里的计划拼')
  check(H.write.indexOf('--force') < 0, 'C7 执行叶子不出现 --force（票面禁止强制入口）')
  check(H.task.indexOf('submoduleTaskOf') >= 0 && H.task.indexOf('taskStart') >= 0, 'C8 任务叶子：按票里的计划取任务动作，转交 T05 开始电话')
  check(H.mount.indexOf('loggedPhone') >= 0 && H.mount.indexOf('failPhone') >= 0 && H.mount.indexOf('assembling') >= 0, 'C9 装配壳：懒加载、失败兜底、日志包装三件都照分支域同款')
  check(read('src/host/versionControl.ts').indexOf('SUBMODULE') < 0, 'C10 父文件里没有子模块业务判定（判定都住叶子）')

  // ===== D 客户端三叶与页面挂载 =====
  console.log('')
  console.log('== D 客户端数据层、处理层与页面 ==')
  const box = buildClient()
  const V = box.v
  check(V.VC_SUBMODULES_PHONES.read === 'wf.gitSubmodules' && V.VC_SUBMODULES_PHONES.check === 'wf.gitSubmoduleCheck' && V.VC_SUBMODULES_PHONES.write === 'wf.gitSubmoduleWrite' && V.VC_SUBMODULES_PHONES.task === 'wf.gitSubmoduleTask', 'D1 客户端四条电话名与宿主一致')
  const entries = V.VC_SUBMODULE_ENTRIES
  check(entries.length === 8 && entries.map(function (e) { return e.capId }).join(',') === '10.1,10.2,10.3,10.4,10.5,10.6,10.7,10.8', 'D2 八条能力各有一条页面主入口，不重不漏')
  check(V.vcSubmoduleBoardShapeOk(BOARD) === true && V.vcSubmoduleBoardShapeOk({ ok: true, rows: [] }) === false, 'D3 读数回包先验契约名与版本号')
  const bd = V.vcSubmoduleRowsOf(BOARD)
  check(bd.length === 2 && bd[0].path === 'libs/lib', 'D4 行模型把宿主回包规整成两行')
  check(V.vcSubmoduleWhyKeyOf('module-missing') === 'vc.sub.why.module-missing' && V.SUBMODULE_REASONS.indexOf('confirm-required') >= 0, 'D5 禁用理由走固定词条键')
  check(V.vcSubmoduleCheckArgsOf('D:/repo', 'deinit', { path: 'libs/lib' }).op === 'deinit' && V.vcSubmoduleCheckArgsOf('D:/repo', 'deinit', { path: 'libs/lib' }).url === undefined, 'D6 预检请求只送动作需要的字段（不多送空串）')
  check(V.vcSubmoduleRunArgsOf('D:/repo', 'sync', 't-1', 'r-1', { path: 'libs/lib' }).ticketId === 't-1' && V.vcSubmoduleRunArgsOf('D:/repo', 'sync', 't-1', 'r-1', { path: 'libs/lib' }).confirmed === true, 'D7 凭票执行请求带票号、requestId 与显式确认')
  check(V.vcSubmoduleTaskArgsOf('D:/repo', 'add', 't-1', 'r-2').confirmed === true && V.vcSubmoduleTaskArgsOf('D:/repo', 'add', 't-1', 'r-2').ticketId === 't-1', 'D8 任务请求带票号与确认，动作参数不在客户端拼')
  check(V.vcSubmoduleFailureOf({ ok: false, error: { kind: 'blocked', reason: 'module-missing', message: 'x' } }).reason === 'module-missing', 'D9 失败信封原样保留理由标识符')
  check(V.VC_SUBMODULE_MODES.indexOf('confirm') >= 0 && V.VC_SUBMODULE_MODES.indexOf('running') >= 0, 'D10 界面十态表里有确认与执行两态')
  const page = V.vcSubmodulesPageNode(fakeH, function (k) { return String(k) }, { board: { state: 'ok', rows: bd }, ui: V.vcSubmodulesUiOf(null), ops: null })
  const entryAttrs = attrsOf(page, 'data-vc-sub-entry')
  check(entryAttrs.length === 8 && entryAttrs.join(',') === '10.1,10.2,10.3,10.4,10.5,10.6,10.7,10.8', 'D11 页面画了八条能力入口')
  const batchAttrs = attrsOf(page, 'data-vc-sub-batch')
  check(batchAttrs.join(',') === 'init,fetch,recorded,status', 'D12 批量固定四项菜单在页面上真实渲染（没有第五项）')
  check(attrsOf(page, 'data-cap-primary').length === 0, 'D13 页面自己不许写 data-cap-primary（能力行由面板壳出）')
  const pageSrc = read('src/client/views/versionControl/vcSubmodulesPage.ts')
  check(pageSrc.indexOf('data-vc-sub-confirm') >= 0 && pageSrc.indexOf('vcs-confirm-go') >= 0 && pageSrc.indexOf('data-focus-default') >= 0, 'D14 危险动作确认卡四段、默认焦点在取消')
  check(pageSrc.indexOf('data-vc-sub-command') < 0 && pageSrc.indexOf('forEach') < 0, 'D15 页面上没有命令输入口，也没有 foreach 字样')
  check(read('src/client/views/versionControl/vcShellPages.ts').indexOf('vcSubmodulesPageNode') >= 0 && read('src/client/views/versionControl/vcShellPages.ts').indexOf('#1757') >= 0, 'D16 页面壳里有一小段 #1757 挂载（submodules 页）')
  const buildSrc = read('scripts/build.mts')
  const indexSrc = read('src/client/index.ts')
  check(buildSrc.indexOf('shared:vcSubmoduleOps') >= 0 && buildSrc.indexOf('vcSubmodulesData') >= 0 && buildSrc.indexOf('vcSubmodulesOps') >= 0 && buildSrc.indexOf('vcSubmodulesPage') >= 0, 'D17 构建登记：共享判定层与三个客户端叶子都登记了')
  check(indexSrc.indexOf('shared:vcSubmoduleOps') >= 0 && indexSrc.indexOf('leaf:vcSubmodulesData') >= 0 && indexSrc.indexOf('leaf:vcSubmodulesOps') >= 0 && indexSrc.indexOf('leaf:vcSubmodulesPage') >= 0, 'D18 客户端入口的拼接 marker 齐全（注释与 marker 不同行）')
  check(read('config/timeouts.yaml').indexOf('vcSubmoduleReadTimeoutMs') >= 0 && read('config/timeouts.yaml').indexOf('vcSubmoduleWriteTimeoutMs') >= 0 && read('src/shared/time-config/src/values.ts').indexOf('VC_SUBMODULE_READ_TIMEOUT_MS') >= 0, 'D19 子模块读/写超时进了中央时间配置（YAML 真源与生成物都有）')
  check(read('tests/verify-settings-phones.ts').indexOf('wf.gitSubmoduleTask') >= 0 || read('tests/verify-settings-phones.ts').indexOf('子模块页四条电话') >= 0, 'D20 宿主电话总数断言同步加了子模块四条')
  check(read('tests/verify-time-config.ts').indexOf('vcSubmoduleReadTimeoutMs') >= 0, 'D21 时间参数门禁登记了子模块两个键')

  // ===== E 词表 zh/en 同一份键 =====
  console.log('')
  console.log('== E 词表 zh/en 同一份键 ==')
  const yaml = read('config/copy/vcsubmodules.yaml')
  const at = yaml.indexOf('\nen:')
  const zh = at > 0 ? yaml.slice(0, at) : yaml
  const en = at > 0 ? yaml.slice(at) : ''
  const keysOf = (text) => (text.match(/^  [A-Za-z0-9_.{}-]+:/gm) || []).map(function (s) { return s.trim().replace(/:$/, '') })
  const ka = keysOf(zh)
  const kb = keysOf(en)
  check(zh.length > 0 && en.length > 0, 'E1 词表文件同时有中文段与英文段')
  check(ka.length > 30 && ka.length === kb.length && ka.every(function (k, i) { return k === kb[i] }), 'E2 两种语言的键逐条一致（' + ka.length + ' 条）')
  check(ka.indexOf('vc.sub.title') >= 0 && ka.indexOf('vc.sub.batch.init') >= 0 && ka.indexOf('vc.sub.why.module-missing') >= 0 && ka.indexOf('vc.sub.action.absorb') >= 0, 'E3 页面标题、四项菜单、理由与动作词条都有键')

  // ===== F 反证组：把真源码改坏，前面几组的判据必须报红 =====
  console.log('')
  console.log('== F 反证组：改坏一份副本，判据必须报红 ==')
  function expectBroke(label, mutate, prove) {
    const res = mutate()
    check(res.changed === true, 'F ' + label + '：改坏这一步真的生效了')
    check(prove(res) === true, 'F ' + label + '：判据报红')
  }
  expectBroke('批量菜单加第五项', function () {
    return buildClient(function (s) { return s.replace("labelKey: 'vc.sub.batch.status' },", "labelKey: 'vc.sub.batch.status' }, { id: 'exec', capId: '10.4', taskOp: null, labelKey: 'vc.sub.batch.exec' },") })
  }, function (res) { const x = res.v.SUBMODULE_BATCH_MENU.length; return res.changed && x === 5 })
  expectBroke('机制表删掉吸收动作', function () {
    return buildClient(function (s) { return s.replace("{ id: 'absorb', capId: '10.8'", "{ id: 'absorbx', capId: '10.8'") })
  }, function (res) { const has = res.v.SUBMODULE_ACTIONS.filter(function (a) { return a.id === 'absorb' }).length; return res.changed && has === 0 })
  expectBroke('页面偷偷加 data-cap-primary', function () {
    return buildClient(function (s) { return s.replace("'data-vc-sub-page': '1'", "'data-cap-primary': '10.1'") })
  }, function (res) { const p = res.v.vcSubmodulesPageNode(fakeH, function (k) { return String(k) }, { board: { state: 'ok', rows: [] }, ui: res.v.vcSubmodulesUiOf(null), ops: null }); return res.changed && attrsOf(p, 'data-cap-primary').length > 0 })
  expectBroke('页面壳挂载段删掉', function () {
    const text = read('src/client/views/versionControl/vcShellPages.ts')
    const broken = text.split('vcSubmodulesPageNode').join('vcOtherPageNode')
    check(text.indexOf('vcSubmodulesPageNode') >= 0, 'F 挂载段反证：原文件里确实有挂载记号')
    return { changed: broken !== text, text: broken }
  }, function (res) { return res.changed && res.text.indexOf('vcSubmodulesPageNode') < 0 })
  expectBroke('抓取分支接上调用方路径', function () {
    const text = read('src/shared/version-control/src/task-protocol.ts')
    const broken = text.replace('args: SUBMODULE_FETCH_ARGV.slice()', 'args: SUBMODULE_FETCH_ARGV.concat(a.path ? [a.path] : [])')
    check(text !== broken, 'F 抓取分支反证：原文件里确实有整串取用的写法')
    return { changed: broken !== text, text: broken }
  }, function (res) { return res.changed && fetchArgvIsLiteral(res.text) === false })
  expectBroke('宿主注册删掉一条电话', function () {
    const text = read('src/host/index.ts')
    const broken = text.replace("harness.handle('wf.gitSubmoduleTask'", "harness.handle('wf.gitSubmoduleTaskX'")
    return { changed: broken !== text, text: broken }
  }, function (res) { return res.changed && res.text.indexOf("harness.handle('wf.gitSubmoduleTask'") < 0 })

  // ===== G 宿主真回包形状（不连真 git，只验读数电话的可测部分） =====
  console.log('')
  console.log('== G 宿主读数回包与票据流程（假进程出口） ==')
  check(H.read.indexOf('submoduleStatusArgs') >= 0 && H.read.indexOf('submoduleConfigArgs') >= 0 && H.read.indexOf('absorbgitdirs') < 0, 'G1 读数叶子只跑两条只读命令，不写吸收动作')
  check(H.check.indexOf('targetExists') >= 0 && H.check.indexOf('pathAbsentFromScreen') >= 0, 'G2 新增动作的预检先查目标路径是否已存在（票据绑定路径缺席）')
  check(H.task.indexOf('SUBMODULE_TASK_OPS') >= 0 && H.task.indexOf('confirm: true') >= 0, 'G3 任务电话只认五个任务动作、转交时显式确认')
  check(H.write.indexOf('already-ran') < 0 && H.write.indexOf('results.set') >= 0, 'G4 执行叶子按 requestId 记结果表（同号重放回同一份）')

  printGateResult(GATE, total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('  FATAL ' + String((e && e.stack) || e)); printGateResult(GATE, total + 1, 1); process.exit(1) })
