// tests/verify-1586-clone-wizard.ts —— 域 8 克隆向导门禁（规格 #1586 能力 8.16 / 票 #1756 的 T20）
// 门禁归属: src/shared/version-control/src/clone-options.ts
// 门禁归属: src/shared/version-control/src/clone-ticket.ts
// 门禁归属: src/host/versionControlClone.ts
// 门禁归属: src/client/views/versionControl/vcClonePage.ts
//
// 守什么：克隆向导走到「真克隆」这一层，三条票面口径一条都不能少：
//   1) 目标目录必须为空或不存在，非空/是文件/读不出来一律拒绝并给原因；
//   2) 深度、分支、子模块、离线四项可配，离线只接受本机路径与 .bundle，离线下本机路径硬链接只是警告；
//   3) 写动作走三段式（预检 wf.gitCloneCheck 签 120 秒票 → 凭票执行 wf.gitCloneWrite），
//      伪造票 / 过期票 / 换动作 / 目标变了四种情况零进程拒绝；同一 requestId 重放只执行一次；
//      真克隆交给 T05 长任务通道（取消后残留说明与清理入口来自那条通道与本页）。
// 五组断言：A 共享选项口径、B 票据与计划摘要、C 长任务 argv、D 客户端数据层与界面、
//   E 真宿主假路由（预检 → 凭票执行 → 清理），F 反证组（改坏一处必须变红）。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-clone-wizard.ts
const fs = require('fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { compileFn } = require('./lib/eval-probe.ts')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText } = require('./lib/source-text.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-clone-wizard'
const OID = 'a'.repeat(40)
const T0 = 1790000000000
const FAKE_ROOT = 'D:/假工作区/repo'
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const sharedUrl = (f) => pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', f)).href
const settle = () => new Promise((r) => setTimeout(r, 60))
let total = 0
let failed = 0
function check(ok, msg) {
  total += 1
  if (ok) return
  failed += 1
  console.log('  FAIL ' + msg)
}
function mkTmp(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1756-' + tag + '-')) }

// ---------- 客户端闭包：共享选项/票据 + 克隆页叶子 ----------
const CLIENT_FILES = [
  'src/shared/version-control/src/clone-options.ts',
  'src/shared/version-control/src/clone-ticket.ts',
  'src/client/views/versionControl/vcClonePage.ts',
]
const CLIENT_EXPORTS = ['VC_CLONE_PAGE_SOURCE', 'VC_CLONE_PHONES', 'VC_CLONE_FORM_DEFAULT', 'VC_CLONE_STEPS', 'VC_CLONE_REASON_KEYS',
  'vcCloneRequestIdOf', 'vcCloneFormOf', 'vcCloneCheckArgsOf', 'vcCloneWriteArgsOf', 'vcCloneCleanupCheckArgsOf', 'vcCloneCleanupWriteArgsOf',
  'vcCloneCallOf', 'vcCloneTicketOf', 'vcCloneSceneOf', 'vcCloneDecisionOf', 'vcCloneReasonOf', 'vcCloneReplyKindOf', 'vcCloneTaskOf',
  'vcCloneProgressOf', 'vcCloneResidualOf', 'vcCloneTaskEndedOf', 'vcClonePageNode', 'VC_CLONE_PAGE_HINT']
const stripExports = (s) => s.replace(/^(\s*)export\s+/gm, '$1')
const toEvalJs = (code) => require('esbuild').transformSync(code, TRANSPILE_OPTIONS).code
function buildClient(patch, React) {
  const raw = CLIENT_FILES.map(function (f) { return stripExports(sourceText(f)) }).join('\n')
  const patched = patch ? patch(raw) : raw
  const body = toEvalJs(patched) + '\nreturn { ' + CLIENT_EXPORTS.join(', ') + ' }\n'
  const fn = compileFn(['React', 'host'], body)
  return fn(React, { call: function () { return Promise.resolve({ ok: false, error: { kind: 'shape', message: '' } }) } })
}

// ---------- 假 subprocess / 假 git 路由（克隆只用到仓库确认、仓库根、origin、HEAD 与 clone 本体） ----------
const ROUTE = { origin: 'https://example.com/team/repo.git', verifyHead: false }
function afterPrefix(argv) {
  const i = argv.lastIndexOf('i18n.logOutputEncoding=UTF-8')
  return i < 0 ? null : argv.slice(i + 1)
}
function readerOf(text) {
  const all = String(text || '')
  return { readFrom(off) { if (off >= all.length) return { text: '', nextOffset: off, lossy: false }; return { text: all.slice(off), nextOffset: all.length, lossy: false } } }
}
function makeHostDeps(clock) {
  const spawns = []
  const logs = []
  let outbound = 0
  function makeHandle(hit) {
    let resolveDone
    const done = new Promise(function (r) { resolveDone = r })
    if (hit.pending !== true) resolveDone({ exitCode: hit.code === undefined ? 0 : hit.code, signal: null })
    return {
      done: done,
      collected: { stdout: readerOf(hit.stdout || ''), stderr: readerOf(hit.stderr || '') },
      stdin: { write() {}, end() {}, on() {} },
      terminate() { resolveDone({ exitCode: null, signal: 'SIGTERM' }) },
      finish(res) { resolveDone(res || { exitCode: 0, signal: null }) },
    }
  }
  function route(argv) {
    const a = afterPrefix(argv)
    if (!a) return { code: 1, stderr: '缺少固定前缀' }
    if (a[0] === 'rev-parse' && a.indexOf('--absolute-git-dir') >= 0) return { code: 0, stdout: FAKE_ROOT + '/.git\ntrue\nfalse\n' }
    if (a[0] === 'rev-parse' && a.indexOf('--show-toplevel') >= 0) return { code: 0, stdout: FAKE_ROOT + '\n' }
    if (a[0] === 'rev-parse' && a.indexOf('--verify') >= 0) return ROUTE.verifyHead ? { code: 0, stdout: OID + '\n' } : { code: 1, stdout: '', stderr: 'fatal: Needed a single revision\n' }
    if (a[0] === 'config' && a.indexOf('--get') >= 0) return { code: 0, stdout: ROUTE.origin + '\n' }
    if (a[0] === 'clone') return { code: 0, stdout: '', stderr: '', pending: true }
    return { code: 0, stdout: '' }
  }
  const deps = {
    subprocess: {
      spawn(req) {
        const hit = route(req.argv) || { code: 0, stdout: '' }
        const handle = makeHandle(hit)
        spawns.push({ argv: req.argv.slice(), cwd: req.cwd, stdio: req.stdio, handle: handle })
        return { done: handle.done, collected: handle.collected, terminate: handle.terminate }
      },
    },
    timer: { timeout(ms) { return new Promise(function (r) { setTimeout(r, Math.min(Number(ms) || 1, 20)) }) } },
    fs: {
      resolve: async function (p) { return p },
      readText: async function (p) { return fsp.readFile(p, 'utf8') },
      writeText: async function (p, text) { return fsp.writeFile(p, text, 'utf8') },
      mkdir: async function (p) { return fsp.mkdir(p, { recursive: true }) },
      exists: async function (p) { try { await fsp.access(p); return true } catch (e) { return false } },
      stat: async function (p) { return fsp.stat(p) },
      lstat: async function (p) { return fsp.lstat(p) },
      listDir: async function (p) { return fsp.readdir(p) },
    },
    getPlatform: async function () { return { resolveExecutable: async function () { return 'git' } } },
    DEFAULT_CWD: FAKE_ROOT,
    TIMEOUT_MS: 30000,
    gate: { noteOutbound() { outbound += 1 } },
    logCtx: { fire(level, event, fields) { logs.push({ level: level, event: event, fields: fields }) } },
    now: function () { return clock.t },
    getCacheDir: async function () { return clock.cacheDir },
  }
  return { deps: deps, spawns: spawns, logs: logs, outboundOf: function () { return outbound } }
}
// 只数真正起 git clone 的那几次进程（读仓库现状的进程不算）。
function cloneSpawns(spawns) {
  return spawns.filter(function (one) {
    const a = afterPrefix(one.argv)
    return !!a && a[0] === 'clone'
  })
}
// 把还在跑的假进程收尾，免得任务循环的定时器把门禁进程挂住。
function finishAll(spawns) {
  for (const one of spawns) { try { one.handle.finish({ exitCode: 0, signal: null }) } catch (e) {} }
}

async function main() {
  console.log('克隆向导门禁（#1756 T20：共享选项 + 票据与摘要 + 长任务 argv + 客户端 + 真宿主 + 反证）')
  const CO = await import(sharedUrl('clone-options.js'))
  const CT = await import(sharedUrl('clone-ticket.js'))
  const TP = await import(sharedUrl('task-protocol.js'))
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const V = buildClient(null, React)

  // ---- A 组：共享选项口径（clone-options.ts）----
  check(CO.CLONE_OPTIONS_SOURCE === 'src/shared/version-control/src/clone-options.ts', 'A1 选项口径文件报出自己的真源路径')
  check(CO.cloneIsLocalPath('./repo') === true && CO.cloneIsLocalPath('../repo') === true && CO.cloneIsLocalPath('/srv/repo') === true && CO.cloneIsLocalPath('D:\\srv\\repo') === true && CO.cloneIsLocalPath('file:///srv/repo') === true, 'A2 五种本机路径写法都认（相对 / 上级 / POSIX / 盘符 / file://）')
  check(CO.cloneIsLocalPath('https://example.com/a.git') === false && CO.cloneIsLocalPath('git@example.com:a.git') === false && CO.cloneIsLocalPath('ssh://example.com/a.git') === false, 'A3 远端地址不被误判成本机路径（离线模式会因此放行一个连不上的地址）')
  check(CO.cloneSourceKindOf('https://example.com/a.git') === 'remote' && CO.cloneSourceKindOf('/srv/repo') === 'local-path' && CO.cloneSourceKindOf('/srv/a.bundle') === 'bundle', 'A4 地址三种来源：远端 / 本机路径 / 离线包')
  const masked = CO.cloneMaskedUrl('https://user:secret@example.com/team/repo.git?token=abc123&x=1')
  check(masked.indexOf('secret') < 0 && masked.indexOf('abc123') < 0 && masked.indexOf('user:***@') > 0 && masked.indexOf('token=***') > 0, 'A5 地址里的账号口令与 token 一律掩码（实得 ' + masked + '）')
  check(CO.cloneDepthProblem('') === null && CO.cloneDepthProblem('3') === null && CO.cloneDepthProblem(3) === null, 'A6 深度留空或正整数放行')
  check(typeof CO.cloneDepthProblem(0) === 'string' && typeof CO.cloneDepthProblem('3.5') === 'string' && typeof CO.cloneDepthProblem(100001) === 'string', 'A7 深度 0 / 小数 / 超上限都给出人话原因')
  check(CO.cloneBranchProblem('') === null && CO.cloneBranchProblem('feature/x') === null && CO.cloneBranchProblem('-bad') !== null && CO.cloneBranchProblem('a..b') !== null && CO.cloneBranchProblem('a.lock') !== null, 'A8 分支名：空值放行、正常名放行、选项形与 git 禁用形状拒')
  check(CO.clonePathProblem('') !== null && CO.clonePathProblem('-x') !== null && CO.clonePathProblem('a/../b') !== null && CO.clonePathProblem('D:\\work\\clone') === null, 'A9 目标目录：空 / 选项形 / .. 段拒，盘符路径放行')
  const urlProblem = CO.cloneUrlProblem('') !== null && CO.cloneUrlProblem('--upload-pack=evil') !== null
  check(urlProblem && CO.cloneUrlProblem('https://example.com/a.git') === null, 'A10 地址形状：空与以短横线开头拒')
  check(CO.cloneDefaultDirOf('https://example.com/team/repo.git') === 'repo' && CO.cloneDefaultDirOf('/srv/a.bundle') === 'a' && CO.cloneDefaultDirOf('') === '', 'A11 从地址推缺省目录名（去 .git/.bundle 尾巴；推不出给空串）')
  const opt = CO.cloneOptionsOf({ depth: '3', branch: 'dev', recurseSubmodules: 'true', shallowSubmodules: true, offline: true })
  check(opt.ok === true && opt.options.depth === 3 && opt.options.branch === 'dev' && opt.options.recurseSubmodules === false, 'A12 选项收敛：深度数字化、字符串 true 不当真布尔（只认真正的 true）')
  const optNoDepth = CO.cloneOptionsOf({ shallowSubmodules: true })
  check(optNoDepth.ok === true && optNoDepth.options.shallowSubmodules === false, 'A13 浅克隆子模块缺深度时自动关掉（--shallow-submodules 要有 --depth 才有意义）')
  check(CO.cloneOptionsOf({ depth: 'x' }).ok === false && CO.cloneOptionsOf({ depth: 'x' }).reason === 'bad-depth', 'A14 坏深度带 reason bad-depth')
  check(CO.cloneOfflineProblem('https://example.com/a.git') !== null && CO.cloneOfflineProblem('/srv/repo') === null && CO.cloneOfflineProblem('/srv/a.bundle') === null, 'A15 离线模式拦远端地址、放行本机路径与离线包')
  check(typeof CO.cloneHardlinkNote('/srv/repo', { offline: true }) === 'string' && CO.cloneHardlinkNote('/srv/a.bundle', { offline: true }) === null && CO.cloneHardlinkNote('/srv/repo', { offline: false }) === null, 'A16 硬链接提示只在「离线 + 本机仓库」出现（警告不拦人）')

  // ---- B 组：票据与计划摘要（clone-ticket.ts）----
  check(CT.CLONE_TICKET_OPS.join(',') === 'start,cleanup' && CT.CLONE_CHECK_CONTRACT === 'version-control.clone-check' && CT.CLONE_CHECK_VERSION === 1, 'B1 票据动作两个、预检契约带名字与版本')
  check(CT.cloneTargetStateOk({ state: 'absent', entryCount: 0, entries: [] }) === true && CT.cloneTargetStateOk({ state: 'weird', entryCount: 0, entries: [] }) === false && CT.cloneTargetStateOk({ state: 'absent' }) === false, 'B2 目标现场形状：五种状态之一 + 条目数 + 条目清单')
  const plan = CT.clonePlanOf('start', { url: 'https://example.com/a.git', dir: 'repo', depth: '2', branch: 'dev', recurseSubmodules: true, shallowSubmodules: true })
  check(plan.ok === true && plan.plan.depth === 2 && plan.plan.branch === 'dev' && plan.plan.recurseSubmodules === true && plan.plan.shallowSubmodules === true, 'B3 计划规范化：深度数字化、两个子模块开关保持真布尔')
  const planBranch = CT.clonePlanOf('start', { url: 'u', dir: 'd', branch: '  ' })
  check(planBranch.ok === true && planBranch.plan.branch === null && planBranch.plan.depth === null, 'B4 计划规范化：空白分支与空深度统一成 null')
  check(CT.clonePlanOf('nope', {}).ok === false && CT.clonePlanOf('nope', {}).reason === 'bad-op', 'B5 未知动作拒签并给 reason')
  check(CT.cloneStableValue({ b: 1, a: 2 }) === CT.cloneStableValue({ a: 2, b: 1 }) && CT.cloneStableValue(undefined) === 'null', 'B6 稳定串与键顺序无关、undefined 当 null')
  const d1 = CT.clonePlanDigestInput({ op: 'start', url: 'u', dir: 'd' }, { state: 'absent', entryCount: 0, entries: [] })
  const d2 = CT.clonePlanDigestInput({ op: 'start', url: 'u', dir: 'd' }, { state: 'non-empty-dir', entryCount: 1, entries: ['x'] })
  check(d1 !== d2 && d1 === CT.clonePlanDigestInput({ dir: 'd', url: 'u', op: 'start' }, { state: 'absent', entryCount: 0, entries: [] }), 'B7 计划摘要：目标变非空就变、同口径重算不变')
  const summary = CT.cloneTargetSummaryOf({ path: '/x', state: 'non-empty-dir', entryCount: 12, entries: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], sizeBytes: 5 })
  check(summary.entries.length === 8 && summary.truncated === true && summary.entryCount === 12 && summary.sizeBytes === 5, 'B8 目标摘要最多给 8 条文件名并标截断')
  check(CT.cloneTargetProblem({ state: 'absent' }) === null && CT.cloneTargetProblem({ state: 'empty-dir' }) === null && CT.cloneTargetProblem({ state: 'non-empty-dir' }) === 'target-not-empty' && CT.cloneTargetProblem({ state: 'file' }) === 'target-not-directory' && CT.cloneTargetProblem({ state: 'unreadable' }) === 'target-unreadable', 'B9 非空 / 文件 / 读不出来三种都给出原因标识符')
  check(CT.cloneCleanupProblem({ state: 'absent' }) === 'nothing-to-clean' && CT.cloneCleanupProblem({ state: 'non-empty-dir' }) === null && CT.cloneCleanupProblem({ state: 'empty-dir' }) === null && CT.cloneCleanupProblem({ state: 'file' }) === 'target-not-directory', 'B10 清理判据：不存在没什么可清、目录可清、文件不删')
  const taskArgs = CT.cloneTaskArgsOf({ url: 'u', dir: 'd', depth: 2, branch: 'dev', recurseSubmodules: true, shallowSubmodules: true, offline: true })
  check(taskArgs.url === 'u' && taskArgs.dir === 'd' && taskArgs.depth === 2 && taskArgs.branch === 'dev' && taskArgs.recurseSubmodules === true && taskArgs.shallowSubmodules === true && taskArgs.offline === undefined, 'B11 交给长任务通道的参数只挑认识的键（离线留在这个文件里判）')

  // ---- C 组：长任务 argv（克隆复用 T05 通道，三个开关只在不给/假时不出现）----
  const c1 = TP.taskArgsFor('clone', { url: 'https://example.com/a.git', dir: 'target', depth: 3, branch: 'dev', recurseSubmodules: true, shallowSubmodules: true })
  check(c1.ok === true && JSON.stringify(c1.args) === JSON.stringify(['clone', '--progress', '--depth', '3', '--branch', 'dev', '--shallow-submodules', '--recurse-submodules', 'https://example.com/a.git', 'target']), 'C1 克隆 argv 逐项独立、四个选项顺序固定（实得 ' + JSON.stringify(c1.args) + '）')
  const c2 = TP.taskArgsFor('clone', { url: 'https://example.com/a.git', dir: 'target' })
  check(c2.ok === true && JSON.stringify(c2.args) === JSON.stringify(['clone', '--progress', 'https://example.com/a.git', 'target']), 'C2 不给选项时 argv 与老调用方逐字一致（不凭空加开关）')
  check(TP.taskArgsFor('clone', { url: 'u', dir: 'd', shallowSubmodules: true }).ok === false, 'C3 浅克隆子模块缺深度提前给人话，不等 git 报错')
  check(TP.taskArgsFor('clone', { url: '-x', dir: 'd' }).ok === false && TP.taskArgsFor('clone', { url: 'u', dir: '-d' }).ok === false, 'C4 地址与目录以短横线开头被拒（防选项注入）')

  // ---- D 组：客户端数据层与界面 ----
  check(V.VC_CLONE_PAGE_SOURCE === 'src/client/views/versionControl/vcClonePage.ts' && V.VC_CLONE_PAGE_HINT === 'migrate', 'D1 克隆页报出真源路径并挂在迁移页')
  check(V.VC_CLONE_PHONES.check === 'wf.gitCloneCheck' && V.VC_CLONE_PHONES.write === 'wf.gitCloneWrite' && V.VC_CLONE_PHONES.query === 'wf.gitTaskQuery' && V.VC_CLONE_PHONES.cancel === 'wf.gitTaskCancel', 'D2 本页四条电话：预检 / 凭票执行 / 查询 / 取消')
  check(V.VC_CLONE_STEPS.join(',') === 'form,checking,checked,running,done,failed,cancelled,cleanup', 'D3 向导八步齐全（表单→预检→已签票→执行→完成/失败/取消→清理）')
  const form = V.vcCloneFormOf({ url: '  https://x/a.git  ', dir: ' d ', depth: ' 3 ', branch: ' dev ', recurseSubmodules: true, shallowSubmodules: 1, offline: 'yes' })
  check(form.url === 'https://x/a.git' && form.dir === 'd' && form.depth === '3' && form.recurseSubmodules === true && form.shallowSubmodules === false && form.offline === false, 'D4 表单收敛：去空白、只认真正的 true（1 与字符串不算）')
  const checkArgs = V.vcCloneCheckArgsOf('/w', { url: 'https://x/a.git', dir: 'd', depth: '3', branch: 'dev', recurseSubmodules: true, shallowSubmodules: true, offline: false })
  check(checkArgs.cwd === '/w' && checkArgs.op === 'start' && checkArgs.depth === 3 && checkArgs.branch === 'dev' && checkArgs.recurseSubmodules === true && checkArgs.shallowSubmodules === true && checkArgs.offline === undefined, 'D5 预检参数：深度数字化、只有真选项才出现、没有 confirmed/ticketId')
  check(V.vcCloneCheckArgsOf('/w', { url: 'u', dir: 'd', depth: '' }).depth === undefined, 'D6 空深度不出现在预检参数里')
  const writeArgs = V.vcCloneWriteArgsOf('/w', { url: 'u', dir: 'd' }, 't-1', 'rq-1', true)
  check(writeArgs.op === 'start' && writeArgs.ticketId === 't-1' && writeArgs.requestId === 'rq-1' && writeArgs.confirmed === true, 'D7 凭票执行参数：票号、请求号、动作与确认都在')
  check(V.vcCloneWriteArgsOf('/w', { url: 'u', dir: 'd' }, 't-1', 'rq-1', false).confirmed === undefined, 'D8 没确认就不带 confirmed 字段（宿主据它回 need-confirm）')
  const cleanCheck = V.vcCloneCleanupCheckArgsOf('/w', ' d ')
  const cleanWrite = V.vcCloneCleanupWriteArgsOf('/w', 'd', 't-2', 'rq-2', true)
  check(cleanCheck.op === 'cleanup' && cleanCheck.dir === 'd' && cleanWrite.ticketId === 't-2' && cleanWrite.op === 'cleanup', 'D9 清理参数：动作 cleanup、票号与确认照走同一套')
  check(V.vcCloneTicketOf({ ticket: { id: 't', op: 'start', checkedAtMs: T0, expiresAtMs: T0 + 120000 } }).expiresAtMs === T0 + 120000, 'D10 票据四段取出来（含过期时刻）')
  check(V.vcCloneTicketOf({}) === null && V.vcCloneTicketOf({ ticket: {} }) === null, 'D11 没有票据时回 null，绝不用空串冒充')
  check(V.vcCloneReplyKindOf({ ok: true, ticket: { id: 't' } }) === 'checked' && V.vcCloneReplyKindOf({ ok: true, task: { taskId: 'x' } }) === 'done', 'D12 回包分类：签了票是 checked、起了任务是 done')
  check(V.vcCloneReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'target-not-empty' }) === 'blocked' && V.vcCloneReplyKindOf({ ok: false, error: { kind: 'need-confirm' }, reason: 'need-confirm' }) === 'need-confirm', 'D13 回包分类：blocked 与 need-confirm 分开画')
  check(V.vcCloneReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'ticket-expired' }) === 'stale' && V.vcCloneReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'target-changed' }) === 'stale', 'D14 票过期与目标变了都归 stale（重新预检这一档）')
  check(V.vcCloneReplyKindOf({ ok: false, error: { kind: 'env', message: 'x' } }) === 'fail' && V.vcCloneReplyKindOf(null) === 'unknown', 'D15 真失败归 fail、空回包归 unknown')
  check(V.vcCloneReasonOf({ reason: 'a', decision: { reasons: ['b'] }, error: { reason: 'c' } }) === 'a' && V.vcCloneReasonOf({ decision: { reasons: ['b'] }, error: { reason: 'c' } }) === 'b' && V.vcCloneReasonOf({ error: { reason: 'c' } }) === 'c', 'D16 原因标识符优先级：顶层 > 判定 > 错误')
  const prog = V.vcCloneProgressOf({ state: 'running', percent: 55, phase: 'Receiving objects' })
  check(prog.percent === 55 && prog.phase === 'Receiving objects' && prog.uncertain === false, 'D17 进度读真实百分比与阶段')
  check(V.vcCloneProgressOf({ state: 'running' }).uncertain === true && V.vcCloneProgressOf({ state: 'running', percent: 140 }).percent === null, 'D18 在途但报不出百分比时标 uncertain，越界数字不冒充')
  check(V.vcCloneResidualOf({ state: 'running', residual: 'x' }) === '' && V.vcCloneResidualOf({ state: 'done', conclusion: 'cancelled', residual: '目标目录可能只写了一半' }) === '目标目录可能只写了一半', 'D19 残留说明只在结束的任务上出现')
  check(V.vcCloneTaskEndedOf({ state: 'done', conclusion: 'succeeded' }) === true && V.vcCloneTaskEndedOf({ state: 'running' }) === false, 'D20 四种结论之一才算结束（结束了就不再轮询）')
  check(V.vcCloneTaskOf({ tasks: [{ taskId: 'a' }, { taskId: 'b' }] }, 'b').taskId === 'b' && V.vcCloneTaskOf({ tasks: [] }, 'x') === null, 'D21 按 taskId 从查询回包里找那一条')
  const hostSrc = sourceText('src/host/versionControlClone.ts')
  const blockStart = hostSrc.indexOf('const CLONE_REASONS')
  const blockEnd = hostSrc.indexOf('把理由标识符翻成一句人话')
  const hostReasons = []
  const re = /'([a-z][a-z-]+)':/g
  let m
  const reasonBlock = hostSrc.slice(blockStart, blockEnd)
  while ((m = re.exec(reasonBlock)) !== null) hostReasons.push(m[1])
  const uncovered = hostReasons.filter(function (id) { return !Object.prototype.hasOwnProperty.call(V.VC_CLONE_REASON_KEYS, id) })
  check(hostReasons.length >= 20 && uncovered.length === 0, 'D22 宿主每个理由标识符在界面词条表里都有对应词条（缺的：' + uncovered.join('、') + '）')
  const markup = renderToStaticMarkup(React.createElement(V.vcClonePageNode, { t: function (k) { return k }, cwd: '/w', call: function () { return Promise.resolve({}) } }))
  check(markup.indexOf('data-vc-clone="1"') >= 0 && markup.indexOf('data-vc-clone-step="form"') >= 0, 'D23 进入页面先把表单画出来（不自动发电话、不给半份进度）')
  check(['url', 'dir', 'depth', 'branch'].every(function (n) { return markup.indexOf('data-vc-clone-field="' + n + '"') >= 0 }), 'D24 表单四个字段齐全：地址 / 目录 / 深度 / 分支')
  check(['recurseSubmodules', 'shallowSubmodules', 'offline'].every(function (n) { return markup.indexOf('data-vc-clone-checkbox="' + n + '"') >= 0 }), 'D25 三个复选项齐全：递归子模块 / 浅克隆子模块 / 离线')
  check(markup.indexOf('data-vc-clone-action="check"') >= 0 && markup.indexOf('data-vc-clone-action="start"') < 0, 'D26 初态只有「预检」按钮，没有票就不给「开始克隆」')

  // ---- E 组：真宿主（假路由）----
  const cacheDir = mkTmp('cache')
  const clock = { t: T0, cacheDir: cacheDir }
  const run = makeHostDeps(clock)
  const vc = hostMod.createVersionControl(run.deps)
  check(typeof vc.handleGitCloneCheck === 'function' && typeof vc.handleGitCloneWrite === 'function', 'E1 宿主装配出预检与凭票执行两条电话')
  const repo = FAKE_ROOT
  const absent = path.join(mkTmp('absent'), 'not-yet')
  const empty = mkTmp('empty')
  const nonEmpty = mkTmp('nonempty')
  fs.writeFileSync(path.join(nonEmpty, 'leftover.txt'), 'half')
  const fileTarget = path.join(mkTmp('file'), 'a-file')
  fs.writeFileSync(fileTarget, 'x')

  const rAbsent = await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: 'https://example.com/team/repo.git', dir: absent })
  check(rAbsent.ok === true && rAbsent.contract === 'version-control.clone-check' && rAbsent.version === 1, 'E2 目标不存在：预检成功、回包带契约名与版本')
  check(rAbsent.decision && rAbsent.decision.verdict === 'allow' && rAbsent.confirmRequired === false, 'E3 目标不存在判 allow、不需要二次确认')
  check(!!rAbsent.ticket && rAbsent.ticket.op === 'start' && rAbsent.ticket.expiresAtMs - rAbsent.ticket.checkedAtMs === 120000, 'E4 签一张 120 秒的票（过期时刻减签票时刻恰好 120000）')
  check(rAbsent.scene && rAbsent.scene.target && rAbsent.scene.target.state === 'absent' && rAbsent.scene.options && rAbsent.scene.options.url === 'https://example.com/team/repo.git', 'E5 回包里带现场：目标状态与选项，界面才画得出「要克隆到哪里」')
  check(cloneSpawns(run.spawns).length === 0, 'E6 预检只是读现场，一个克隆进程都不起')
  const rEmpty = await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: 'https://example.com/team/repo.git', dir: empty })
  check(rEmpty.ok === true && rEmpty.scene.target.state === 'empty-dir' && !!rEmpty.ticket, 'E7 空目录可以克隆并签票')
  const rNonEmpty = await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: 'https://example.com/team/repo.git', dir: nonEmpty })
  check(rNonEmpty.ok === false && rNonEmpty.reason === 'target-not-empty' && rNonEmpty.error.kind === 'blocked' && !rNonEmpty.ticket, 'E8 非空目录直接拒绝并给原因，不静默往里塞')
  check(rNonEmpty.decision && rNonEmpty.decision.verdict === 'block' && rNonEmpty.scene && rNonEmpty.scene.target.entryCount === 1, 'E9 拒绝也回现场（列出占位文件），界面说得出为什么不能点')
  const rFile = await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: 'https://example.com/team/repo.git', dir: fileTarget })
  check(rFile.ok === false && rFile.reason === 'target-not-directory', 'E10 目标已经是文件时拒绝（不能当目录用）')
  const rBadUrl = await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: '--upload-pack=evil', dir: absent + '2' })
  check(rBadUrl.ok === false && rBadUrl.reason === 'bad-url' && rBadUrl.error.kind === 'args', 'E11 地址以短横线开头被拦（防选项注入）')
  const rBadDepth = await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: 'https://example.com/team/repo.git', dir: absent + '3', depth: 0 })
  check(rBadDepth.ok === false && rBadDepth.reason === 'bad-depth', 'E12 坏深度在预检就拦，不在执行时才报错')
  const rOfflineRemote = await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: 'https://example.com/team/repo.git', dir: absent + '4', offline: true })
  check(rOfflineRemote.ok === false && rOfflineRemote.reason === 'offline-remote', 'E13 离线模式拦远端地址（不装作能连）')
  const localSrc = path.join(mkTmp('localsrc'), 'repo')
  const offlineLocal = await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: localSrc, dir: absent + '5', offline: true })
  check(offlineLocal.ok === true && offlineLocal.decision.verdict === 'warn' && offlineLocal.decision.reasons[0] === 'hardlink-source' && offlineLocal.confirmRequired === true, 'E14 离线克隆本机仓库只警告硬链接风险并要求确认（警告不拦人）')
  check(offlineLocal.decision.notes && offlineLocal.decision.notes[0].indexOf('硬链接') >= 0, 'E15 警告里说清硬链接的后果（源仓库删改后这份可能读不出来）')

  // 凭票执行：成功一次只起一个 clone 进程
  const beforeClone = cloneSpawns(run.spawns).length
  const rStart = await vc.handleGitCloneWrite({ cwd: repo, ticketId: rAbsent.ticket.id, requestId: 'rq-clone-1', op: 'start' })
  const started = cloneSpawns(run.spawns).length === beforeClone + 1
  check(rStart.ok === true && !!rStart.task && rStart.task.state === 'running' && !!rStart.taskId, 'E16 凭票执行把克隆交给长任务通道，回在途任务与任务号')
  check(started, 'E17 成功执行一次只起一个克隆进程')
  const cloneReq = cloneSpawns(run.spawns)[beforeClone]
  const cloneArgv = afterPrefix(cloneReq.argv)
  check(cloneArgv[0] === 'clone' && cloneArgv.indexOf('--progress') > 0 && cloneArgv.indexOf('https://example.com/team/repo.git') > 0 && cloneArgv.indexOf(absent) > 0, 'E18 克隆进程的 argv 含子命令、进度开关、地址与目标目录')
  check(cloneArgv.indexOf('--depth') < 0 && cloneArgv.indexOf('--recurse-submodules') < 0, 'E19 没给选项时 argv 里不凭空出现深度与子模块开关')
  const rReplay = await vc.handleGitCloneWrite({ cwd: repo, ticketId: rAbsent.ticket.id, requestId: 'rq-clone-1', op: 'start' })
  check(rReplay.ok === true && rReplay.reused === true && cloneSpawns(run.spawns).length === beforeClone + 1, 'E20 同一 requestId 重放回上次结果、不重复起进程')
  const pendingHandle = cloneReq.handle
  pendingHandle.finish({ exitCode: 0, signal: null })
  await settle()
  const q1 = await vc.handleGitTaskQuery({})
  const doneTask = q1.ok === true ? q1.tasks.filter(function (one) { return one.taskId === rStart.taskId })[0] : null
  check(doneTask && doneTask.state === 'done' && doneTask.conclusion === 'succeeded', 'E21 进程正常结束后任务记录收尾为成功（四条结论口径来自长任务通道）')

  // 伪造票 / 过期票 / 换动作 / 目标变了：四种都零进程
  const beforeReject = cloneSpawns(run.spawns).length
  const rForged = await vc.handleGitCloneWrite({ cwd: repo, ticketId: 'clone-forged-1', requestId: 'rq-forged', op: 'start' })
  check(rForged.ok === false && rForged.reason === 'ticket-missing', 'E22 伪造票号被拒（ticket-missing）')
  const rMismatch = await vc.handleGitCloneWrite({ cwd: repo, ticketId: rEmpty.ticket.id, requestId: 'rq-mismatch', op: 'cleanup', dir: empty })
  check(rMismatch.ok === false && rMismatch.reason === 'ticket-op-mismatch' && rMismatch.error.kind === 'args', 'E23 拿开始克隆的票去做清理，动作不符被拒')
  const rExpiredCheck = await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: 'https://example.com/team/repo.git', dir: absent + '6' })
  clock.t = T0 + 120001
  const rExpired = await vc.handleGitCloneWrite({ cwd: repo, ticketId: rExpiredCheck.ticket.id, requestId: 'rq-expired', op: 'start' })
  check(rExpired.ok === false && rExpired.reason === 'ticket-expired' && rExpired.error.kind === 'blocked', 'E24 过期票被拒（预检后超过 120 秒）')
  clock.t = T0
  const changedDir = absent + '7'
  const rChangedCheck = await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: 'https://example.com/team/repo.git', dir: changedDir })
  fs.mkdirSync(changedDir)
  fs.writeFileSync(path.join(changedDir, 'raced.txt'), 'x')
  const rChanged = await vc.handleGitCloneWrite({ cwd: repo, ticketId: rChangedCheck.ticket.id, requestId: 'rq-changed', op: 'start' })
  check(rChanged.ok === false && rChanged.reason === 'target-changed' && rChanged.error.kind === 'blocked', 'E25 预检后目标被别人建起来判 target-changed（执行前重算现场）')
  check(cloneSpawns(run.spawns).length === beforeReject, 'E26 四种拒绝路径全是零进程（一个克隆都没起）')

  // 需要确认的票：没确认不动手，确认了才执行
  const beforeConfirm = cloneSpawns(run.spawns).length
  const rNeedConfirm = await vc.handleGitCloneWrite({ cwd: repo, ticketId: offlineLocal.ticket.id, requestId: 'rq-confirm-1', op: 'start' })
  check(rNeedConfirm.ok === false && rNeedConfirm.error.kind === 'need-confirm' && rNeedConfirm.reason === 'need-confirm', 'E27 硬链接警告票没确认时回 need-confirm（界面画确认卡）')
  check(cloneSpawns(run.spawns).length === beforeConfirm, 'E28 需要确认的这一步同样零进程')
  const rConfirmed = await vc.handleGitCloneWrite({ cwd: repo, ticketId: offlineLocal.ticket.id, requestId: 'rq-confirm-2', op: 'start', confirmed: true })
  check(rConfirmed.ok === true && !!rConfirmed.task && cloneSpawns(run.spawns).length === beforeConfirm + 1, 'E29 确认之后才凭票起克隆')
  if (cloneSpawns(run.spawns)[beforeConfirm]) cloneSpawns(run.spawns)[beforeConfirm].handle.finish({ exitCode: 0, signal: null })

  // 取消：取消后残留说明来自长任务通道，清理入口走 cleanup 两段式
  const cancelDir = absent + '8'
  const rCancelCheck = await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: 'https://example.com/team/repo.git', dir: cancelDir })
  const rCancelStart = await vc.handleGitCloneWrite({ cwd: repo, ticketId: rCancelCheck.ticket.id, requestId: 'rq-cancel', op: 'start' })
  check(rCancelStart.ok === true && rCancelStart.task.state === 'running', 'E30 取消场景：克隆任务在途')
  const beforeCancelSpawns = cloneSpawns(run.spawns).length
  const rCancelled = await vc.handleGitTaskCancel({ taskId: rCancelStart.taskId })
  await settle()
  check(rCancelled.ok === true && rCancelled.task && rCancelled.task.conclusion === 'cancelled' && String(rCancelled.task.residual || '').length > 0, 'E31 取消后任务如实收尾并给残留说明')
  check(cloneSpawns(run.spawns).length === beforeCancelSpawns, 'E32 取消不再新起进程')
  const rCleanAbsent = await vc.handleGitCloneCheck({ cwd: repo, op: 'cleanup', dir: absent + '9' })
  check(rCleanAbsent.ok === false && rCleanAbsent.reason === 'nothing-to-clean', 'E33 要清理的目录不存在时明说没什么可清')
  const stray = mkTmp('stray')
  const rCleanUnregistered = await vc.handleGitCloneCheck({ cwd: repo, op: 'cleanup', dir: stray })
  check(rCleanUnregistered.ok === false && rCleanUnregistered.reason === 'cleanup-unregistered', 'E34 只清理本次会话登记过的克隆目标（别的目录不动）')
  const rCleanRegistered = await vc.handleGitCloneCheck({ cwd: repo, op: 'cleanup', dir: empty })
  check(rCleanRegistered.ok === true && rCleanRegistered.confirmRequired === true && !!rCleanRegistered.ticket, 'E35 登记过的残留目录可以清理，删之前要确认')
  const rCleanNoConfirm = await vc.handleGitCloneWrite({ cwd: repo, ticketId: rCleanRegistered.ticket.id, requestId: 'rq-clean-1', op: 'cleanup' })
  check(rCleanNoConfirm.ok === false && rCleanNoConfirm.error.kind === 'need-confirm', 'E36 清理同样要确认，没确认不动手')
  const rCleanDone = await vc.handleGitCloneWrite({ cwd: repo, ticketId: rCleanRegistered.ticket.id, requestId: 'rq-clean-2', op: 'cleanup', confirmed: true })
  check(rCleanDone.ok === true && rCleanDone.op === 'cleanup' && rCleanDone.removed === true, 'E37 确认后删掉残留目录，回包如实说删除完成')
  check(fs.existsSync(empty) === false, 'E38 残留目录真的被删掉了（不是只回了一句「已清理」）')
  ROUTE.verifyHead = true
  const completeDir = mkTmp('complete')
  await vc.handleGitCloneCheck({ cwd: repo, op: 'start', url: 'https://example.com/team/repo.git', dir: completeDir })
  const rLooksComplete = await vc.handleGitCloneCheck({ cwd: repo, op: 'cleanup', dir: completeDir })
  ROUTE.verifyHead = false
  check(rLooksComplete.ok === false && rLooksComplete.reason === 'target-looks-complete', 'E39 目录里已经有能解析出 HEAD 的仓库时不当残留删')
  check(run.logs.some(function (one) { return one.event === 'host.call' && one.fields && one.fields.method === 'wf.gitCloneCheck' }), 'E40 预检电话记 host.call（与其余电话同口径）')
  check(run.logs.some(function (one) { return one.event === 'host.call' && one.fields && one.fields.method === 'wf.gitCloneWrite' }), 'E41 凭票执行电话也记 host.call')
  finishAll(run.spawns)

  // ---- F 组：反证组（把一处改坏，必须变红）----
  const baseKind = V.vcCloneReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'target-not-empty' })
  const badKind = buildClient(function (s) { return s.replace(/if \(kind === 'blocked' \|\|[^\n]*\) return 'blocked'/, "if (false) return 'blocked'") }, React)
  const patchedKind = badKind.vcCloneReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'target-not-empty' })
  check(baseKind === 'blocked' && patchedKind !== 'blocked', 'F1 反证：把 blocked 分支改坏，非空目录的拒绝就不再被识别（基线 ' + baseKind + '，改坏后 ' + patchedKind + '）')
  const baseStale = V.vcCloneReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'ticket-expired' })
  const badStale = buildClient(function (s) { return s.replace(/if \(reason === 'ticket-missing' \|\|[^\n]*\) return 'stale'/, "if (false) return 'stale'") }, React)
  check(baseStale === 'stale' && badStale.vcCloneReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'ticket-expired' }) !== 'stale', 'F2 反证：把过期票的分支改坏，过期回包就不再归 stale')
  const badArgs = buildClient(function (s) { return s.replace('if (o.depth !== null && o.depth !== undefined) args.depth = o.depth', 'if (false && o.depth !== null) args.depth = o.depth') }, React)
  check(V.vcCloneCheckArgsOf('/w', { url: 'u', dir: 'd', depth: '3' }).depth === 3 && badArgs.vcCloneCheckArgsOf('/w', { url: 'u', dir: 'd', depth: '3' }).depth === undefined, 'F3 反证：把深度透传那行改坏，深度就不再进预检参数')
  const badMarkup = renderToStaticMarkup(React.createElement(buildClient(function (s) { return s.replace("'data-vc-clone': '1'", "'data-vc-clone': '0'") }, React).vcClonePageNode, { t: function (k) { return k }, cwd: '/w', call: function () { return Promise.resolve({}) } }))
  check(markup.indexOf('data-vc-clone="1"') >= 0 && badMarkup.indexOf('data-vc-clone="1"') < 0, 'F4 反证：改坏根节点的 data 属性，界面门禁的定位判据立刻发现')

  console.log('克隆向导：' + total + ' 条断言，失败 ' + failed + ' 条')
  printGateResult(GATE, total, failed > 0 ? 1 : 0)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(function (e) {
  console.error('门禁自身抛错：' + ((e && e.stack) || e))
  process.exit(1)
})
