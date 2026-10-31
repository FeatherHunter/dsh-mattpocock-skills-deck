// tests/verify-1586-first-screen.ts —— 首屏一次取全门禁（规格 #1586 第 9 节 / 票 #1739 的 T04）
// 门禁归属: src/host/versionControlFirstScreen.ts
// 门禁归属: src/shared/version-control/src/first-screen.ts
// 门禁归属: src/shared/version-control/src/parse-stash.ts
// 门禁归属: src/client/views/versionControl/vcFirstScreen.ts
//
// 守什么：规格原句「首屏取数一次拿全（工作区状态、改动、提交历史首页、工作树、贮藏、同步带、版本与
// 能力开关），各自失败互不影响，失败项单独显示失败态；不做『先给半份再慢慢补』」。这份门禁盯四件事：
//   一 共享契约（first-screen.ts）：契约名与版本号、七片名单与中文名、刷新三时机、形状判据与逐片判据。
//   二 客户端数据层（vcFirstScreen.ts）：一次刷新只发一次聚合一电话；七片各带自己的成败；单片失败
//      不阻塞别的片；片级重试也是再发一次聚合一电话；坏回包不冒充成功、失败保留旧快照；刷新三时机
//      各一条入口且各只发一次。
//   三 宿主聚合（versionControlFirstScreen.ts，经真 createVersionControl + 假 subprocess 适配器）：
//      一次回包正好七片、每片自带成败；状态/历史/工作树/贮藏/同步带/版本六路的真实读数；一条 git
//      命令失败只坏它自己那一片；版本低于 2.11 时其余六片统一显式失败；贮藏列表用共享层命令原文。
//   四 反证组（test-the-test）：把契约版本、形状判据、调用次数、片键集合四处分别改坏，同一套判据必须
//      当场判红——证明这些断言不是摆设。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-first-screen.ts
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { compileFn } = require('./lib/eval-probe.ts')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText } = require('./lib/source-text.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-first-screen'
const NOW = Date.parse('2026-10-31T20:00:00+08:00')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const readJson = (rel) => JSON.parse(read(rel))
const sharedUrl = (f) => pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', f)).href

let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// ---------- 客户端闭包：按构建同序拼共享契约 + 客户端数据层，再求值 ----------
const CLIENT_FILES = [
  'src/shared/version-control/src/first-screen.ts',
  'src/client/views/versionControl/vcFirstScreen.ts',
]
const CLIENT_EXPORTS = [
  'FIRST_SCREEN_CONTRACT', 'FIRST_SCREEN_VERSION', 'FIRST_SCREEN_SLICES', 'FIRST_SCREEN_SLICE_LABELS',
  'FIRST_SCREEN_REFRESH_MOMENTS', 'FIRST_SCREEN_SOURCE', 'firstScreenVersionOk', 'firstScreenShapeOk',
  'firstScreenSliceOf', 'firstScreenFailedSlices', 'firstScreenOkSlices', 'firstScreenIsComplete',
  'firstScreenIsPartial', 'firstScreenRefreshNoteOf', 'firstScreenSliceErrorOf',
  'VC_FIRST_SCREEN_PHONE', 'VC_FIRST_SCREEN_REFRESH', 'vcNewFirstScreenRead', 'vcFirstScreenShapeOk',
  'vcFirstScreenOf', 'vcFirstScreenStateOf', 'vcFirstScreenReadAtOf', 'vcFirstScreenSliceOf',
  'vcFirstScreenSliceStateOf', 'vcFirstScreenSliceErrorOf', 'vcFirstScreenFailedSlicesOf',
  'vcFirstScreenSliceRetryableOf', 'vcReadFirstScreen', 'vcReadFirstScreenOnEnter',
  'vcReadFirstScreenAfterTask', 'vcReadFirstScreenOnManual', 'vcRetryFirstScreen',
  'vcRetryFirstScreenSlice', 'vcFirstScreenScreenOf',
]
const stripExports = (s) => s.replace(/^(\s*)export\s+/gm, '$1')
const toEvalJs = (code) => require('esbuild').transformSync(code, TRANSPILE_OPTIONS).code
function buildClient(patch) {
  const raw = CLIENT_FILES.map(function (f) { return stripExports(sourceText(f)) }).join('\n')
  const patched = patch ? patch(raw) : raw
  let src = toEvalJs(patched)
  const body = src + '\nreturn { ' + CLIENT_EXPORTS.join(', ') + ' }\n'
  const logs = []
  const fn = compileFn(['log', 'dswsLogHash', 'dswsLogTrunc'], body)
  const v = fn(function (level, event, fields) { logs.push({ level: level, event: event, fields: fields }) },
    function () { return 'h8' }, function (s) { return String(s) })
  return { v: v, logs: logs, changed: patched !== raw }
}

// ---------- 快照与假电话的现成件 ----------
function okSlice(data) { return { state: 'ok', data: data, error: null } }
function errSlice(kind, message) { return { state: 'err', data: null, error: { kind: kind, message: message } } }
function snapshotOf(over) {
  const fundamental = {
    workspace: okSlice({ identity: { branch: 'main' }, repo: { bare: false }, branches: [] }),
    changes: okSlice({ staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0 }),
    history: okSlice({ commits: [], hasMore: false }),
    worktrees: okSlice({ others: [], bare: false }),
    stashes: okSlice({ entries: [] }),
    sync: okSlice({ sync: 'no-upstream', ahead: 0, behind: 0, basisMs: null, upstream: null, remote: null, branch: 'main' }),
    version: okSlice({ gitVersion: 'git version 2.49.0', tier: 'full', switches: [] }),
  }
  const slices = Object.assign({}, fundamental, over || {})
  return { contract: 'version-control.first-screen', version: 2, readAtMs: NOW, slices: slices }
}
function fakeCall(reply) {
  const calls = []
  const call = function (phone, args) {
    calls.push({ phone: phone, args: args })
    return Promise.resolve(typeof reply === 'function' ? reply(calls.length) : reply)
  }
  return { call: call, calls: calls }
}

// ---------- 假 subprocess 适配器（形状照 DSH subprocess 服务，同 verify-818 与 verify-version-control-host） ----------
const LIVE = readJson('tests/fixtures/version-control/live-numstat-shapes.json')
const LIVE_ROOT = /^worktree ([^\u0000\n]+)/.exec(LIVE.worktrees.out)[1]
const STASH_LINE = 'stash@{0}' + '\u0000' + 'b'.repeat(40) + '\u00001790000000\u0000WIP on main: 991f0ee 首次提交\n'
function makeCollector(text, truncated) { return { finalize() { return { text: String(text), truncated: truncated === true } } } }
function afterPrefix(argv) {
  const at = argv.indexOf('i18n.logOutputEncoding=UTF-8')
  return at < 0 ? null : argv.slice(at + 1)
}
// 路线：happy 用真机样本；opts 里逐路改坏（fail: 命令名 → 失败回包；version: 换版本串；noRepo: 假工作区不在仓库里）。
function makeRoute(opts) {
  const o = opts || {}
  const seen = []
  function route(argv) {
    seen.push(argv.slice())
    const a = afterPrefix(argv)
    if (a === null) return { code: 1, stderr: '缺少固定前缀' }
    if (argv.indexOf('--version') >= 0) {
      if (o.fail && o.fail.version) return { code: 1, stdout: '', stderr: 'fatal: 读版本失败\n' }
      return { code: 0, stdout: (o.version || LIVE.source.gitVersion) + '\n' }
    }
    if (a[0] === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) {
      if (o.noRepo) return { code: 1, stdout: '', stderr: 'fatal: not a git repository\n' }
      return { code: LIVE.step0.code, stdout: LIVE.step0.out, stderr: LIVE.step0.err }
    }
    if (a[0] === 'rev-parse' && a.indexOf('--show-toplevel') >= 0) return { code: 0, stdout: LIVE_ROOT + '\n' }
    if (a[0] === 'rev-parse' && a.indexOf('--verify') >= 0) return { code: 0, stdout: 'a'.repeat(40) + '\n' }
    if (a[0] === 'status') return o.fail && o.fail.status ? { code: 1, stdout: '', stderr: 'fatal: status 失败\n' } : { code: LIVE.status.code, stdout: LIVE.status.out, stderr: LIVE.status.err }
    if (a[0] === 'worktree') return o.fail && o.fail.worktree ? { code: 1, stdout: '', stderr: 'fatal: worktree 失败\n' } : { code: LIVE.worktrees.code, stdout: LIVE.worktrees.out, stderr: LIVE.worktrees.err }
    if (a[0] === 'for-each-ref') return o.fail && o.fail.refs ? { code: 1, stdout: '', stderr: 'fatal: refs 失败\n' } : { code: LIVE.refs.code, stdout: LIVE.refs.out, stderr: LIVE.refs.err }
    if (a[0] === 'log') return o.fail && o.fail.log ? { code: 1, stdout: '', stderr: 'fatal: log 失败\n' } : { code: LIVE.log.code, stdout: LIVE.log.out, stderr: LIVE.log.err }
    if (a[0] === 'diff' && a.indexOf('--numstat') >= 0) return o.fail && o.fail.diff ? { code: 1, stdout: '', stderr: 'fatal: diff 失败\n' } : { code: LIVE.diffFiles.code, stdout: LIVE.diffFiles.out, stderr: LIVE.diffFiles.err }
    if (a[0] === 'config') return { code: LIVE.autocrlf.code, stdout: LIVE.autocrlf.out, stderr: LIVE.autocrlf.err }
    if (a[0] === 'stash' && a[1] === 'list') return o.fail && o.fail.stash ? { code: 1, stdout: '', stderr: 'fatal: stash 失败\n' } : { code: 0, stdout: STASH_LINE }
    if (a[0] === 'reflog') return { code: 128, stdout: '', stderr: 'fatal: bad revision\n' }
    return { code: 0, stdout: '' }
  }
  return { route: route, seen: seen }
}
function makeHostDeps(route, opts) {
  const o = opts || {}
  const logs = []
  const deps = {
    subprocess: {
      spawn(req) {
        const hit = route(req.argv) || { code: 0, stdout: '' }
        return {
          done: Promise.resolve({ exitCode: hit.code === undefined ? 0 : hit.code, signal: hit.signal }),
          collected: { stdout: makeCollector(hit.stdout || '', hit.truncated), stderr: makeCollector(hit.stderr || '', false) },
          terminate() {},
        }
      },
    },
    timer: { timeout() { return new Promise(function (resolve) { setTimeout(resolve, 1) }) } },
    fs: {
      stat() { return Promise.reject(Object.assign(new Error('没有这个文件'), { code: 'ENOENT' })) },
      lstat() { return Promise.resolve(null) },
      exists() { return Promise.resolve(false) },
    },
    getPlatform: async function () {
      return { resolveExecutable: async function (name) { return name === 'git' ? (o.gitExe === null ? null : 'git') : null } }
    },
    DEFAULT_CWD: 'D:/假工作区/repo', TIMEOUT_MS: 30000,
    gate: { noteOutbound() {} },
    logCtx: { fire(level, event, fields) { logs.push({ level: level, event: event, fields: fields }) } },
  }
  return { deps: deps, logs: logs }
}

// ============================================================
async function main() {
  console.log('首屏一次取全门禁（#1739 T04：共享契约 + 客户端数据层 + 宿主聚合 + 反证）')
  const FS = await import(sharedUrl('first-screen.js'))
  const PS = await import(sharedUrl('parse-stash.js'))
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)

  // ---- A 组：共享契约与判据 ----
  check(FS.FIRST_SCREEN_CONTRACT === 'version-control.first-screen', 'A1 契约名是 version-control.first-screen')
  check(FS.FIRST_SCREEN_VERSION === 2 && typeof FS.FIRST_SCREEN_VERSION === 'number', 'A2 契约带版本号（当前为 2）')
  check(FS.FIRST_SCREEN_SLICES.join(',') === 'workspace,changes,history,worktrees,stashes,sync,version', 'A3 七片名单与规格原句同序（实得 ' + FS.FIRST_SCREEN_SLICES.join(',') + '）')
  const labelBad = FS.FIRST_SCREEN_SLICES.filter(function (id) { const t = FS.FIRST_SCREEN_SLICE_LABELS[id]; return typeof t !== 'string' || t === '' })
  check(labelBad.length === 0, 'A4 每片都有中文名（缺 ' + labelBad.length + ' 个）')
  check(FS.FIRST_SCREEN_REFRESH_MOMENTS.join(',') === 'enter,task-done,manual', 'A5 刷新三时机恰好是进入页面 / 任务完成后 / 手动刷新（实得 ' + FS.FIRST_SCREEN_REFRESH_MOMENTS.join(',') + '）')
  check(FS.FIRST_SCREEN_SOURCE === 'src/shared/version-control/src/first-screen.ts', 'A6 共享契约文件报出自己的真源路径')
  check(FS.firstScreenVersionOk(snapshotOf()) === true, 'A7 版本判据：契约与版本都对时放行')
  check(FS.firstScreenVersionOk(Object.assign({}, snapshotOf(), { version: 1 })) === false, 'A8 版本判据：旧版本快照判红')
  check(FS.firstScreenVersionOk(Object.assign({}, snapshotOf(), { contract: '别的契约' })) === false, 'A9 版本判据：契约名不对判红')
  check(FS.firstScreenShapeOk(snapshotOf()) === true, 'A10 形状判据：七片整齐的快照放行')
  const missing = snapshotOf(); delete missing.slices.stashes
  check(FS.firstScreenShapeOk(missing) === false, 'A11 形状判据：少一片判红（不拿六片冒充七片）')
  const extra = snapshotOf(); extra.slices.extra = okSlice({})
  check(FS.firstScreenShapeOk(extra) === false, 'A12 形状判据：多塞一片判红（加片先升版本）')
  const okNull = snapshotOf(); okNull.slices.changes = { state: 'ok', data: null, error: null }
  check(FS.firstScreenShapeOk(okNull) === false, 'A13 形状判据：ok 片没数据判红')
  const errNoErr = snapshotOf(); errNoErr.slices.history = { state: 'err', data: null, error: null }
  check(FS.firstScreenShapeOk(errNoErr) === false, 'A14 形状判据：err 片没有失败原因判红')
  const nanTime = snapshotOf(); nanTime.readAtMs = NaN
  check(FS.firstScreenShapeOk(nanTime) === false, 'A15 形状判据：读取时间不是有限数判红')
  const mixed = snapshotOf({ history: errSlice('non-zero', '读提交历史这一步失败') })
  check(FS.firstScreenShapeOk(mixed) === true, 'A16 单片失败不影响整份快照的形状判据')
  check(FS.firstScreenSliceOf(mixed, 'history').state === 'err' && FS.firstScreenSliceOf(mixed, 'changes').state === 'ok', 'A17 取片：各片自己的成败互不串')
  check(FS.firstScreenSliceOf(mixed, '没有这一片') === null, 'A18 取片：不认识的片名回 null（不造片）')
  check(FS.firstScreenFailedSlices(mixed).join(',') === 'history', 'A19 失败片清单只说失败的那一片（实得 ' + FS.firstScreenFailedSlices(mixed).join(',') + '）')
  check(FS.firstScreenOkSlices(mixed).length === 6, 'A20 成功片清单是另外六片')
  check(FS.firstScreenIsComplete(mixed) === false && FS.firstScreenIsPartial(mixed) === true, 'A21 部分可用：既不是全好也不是全坏')
  check(FS.firstScreenIsComplete(snapshotOf()) === true && FS.firstScreenIsPartial(snapshotOf()) === false, 'A22 七片全 ok 才算完整')
  check(FS.firstScreenRefreshNoteOf('enter') !== '' && FS.firstScreenRefreshNoteOf('task-done') !== '' && FS.firstScreenRefreshNoteOf('manual') !== '', 'A23 三个刷新时机各有说明句')
  check(FS.firstScreenRefreshNoteOf('第四种') === '', 'A24 不认识的刷新时机回空串（不编第四种）')
  check(FS.firstScreenSliceErrorOf(undefined, undefined).kind === 'unknown', 'A25 失败原因：kind 缺省归一成 unknown，不把 undefined 画出去')

  // ---- B 组：客户端数据层（一次刷新一次调用、逐片成败、重试、失败保留旧数据） ----
  const built = buildClient(null)
  const V = built.v
  check(V.VC_FIRST_SCREEN_PHONE === 'wf.gitFirstScreen', 'B1 聚合一电话名是 wf.gitFirstScreen')
  check(Object.keys(V.VC_FIRST_SCREEN_REFRESH).sort().join(',') === 'enter,manual,task-done', 'B2 客户端的刷新三时机与共享层同一份（实得 ' + Object.keys(V.VC_FIRST_SCREEN_REFRESH).sort().join(',') + '）')
  check(V.vcNewFirstScreenRead().state === 'idle' && V.vcNewFirstScreenRead().data === null, 'B3 新读数是 idle（刚打开面板不装已有数据）')
  const enter = fakeCall({ ok: true, firstScreen: snapshotOf() })
  const rEnter = await V.vcReadFirstScreenOnEnter({}, enter.call, 'D:/假工作区/repo')
  check(enter.calls.length === 1 && enter.calls[0].phone === V.VC_FIRST_SCREEN_PHONE, 'B4 进入页面：只发一次聚合一电话（实发 ' + enter.calls.length + ' 次）')
  check(enter.calls[0].args && enter.calls[0].args.cwd === 'D:/假工作区/repo', 'B5 聚合电话带上当前工作区（cwd）')
  check(rEnter.firstScreen.state === 'ok' && V.vcFirstScreenStateOf(rEnter) === 'ok', 'B6 进页面读成功：整次读记 ok')
  check(V.vcFirstScreenOf(rEnter).contract === 'version-control.first-screen' && V.vcFirstScreenOf(rEnter).version === 2, 'B7 界面只读这一份版本化快照（契约名与版本号都在）')
  check(V.vcFirstScreenReadAtOf(rEnter) === NOW, 'B8 快照带读取时间（刷新提示用）')
  const afterTask = fakeCall({ ok: true, firstScreen: snapshotOf() })
  await V.vcReadFirstScreenAfterTask({}, afterTask.call, 'D:/假工作区/repo')
  check(afterTask.calls.length === 1, 'B9 任务完成后：只发一次聚合一电话（实发 ' + afterTask.calls.length + ' 次）')
  const manual = fakeCall({ ok: true, firstScreen: snapshotOf() })
  await V.vcReadFirstScreenOnManual({}, manual.call, 'D:/假工作区/repo')
  check(manual.calls.length === 1, 'B10 手动刷新：只发一次聚合一电话（实发 ' + manual.calls.length + ' 次）')
  const mixedSnap = snapshotOf({ history: errSlice('non-zero', '读提交历史这一步失败') })
  const mixedCall = fakeCall({ ok: true, firstScreen: mixedSnap })
  const rMixed = await V.vcReadFirstScreen({}, mixedCall.call, 'D:/假工作区/repo')
  check(V.vcFirstScreenStateOf(rMixed) === 'ok', 'B11 单片失败不阻塞整页：整次读仍是 ok')
  check(V.vcFirstScreenSliceStateOf(rMixed, 'history') === 'err' && V.vcFirstScreenSliceStateOf(rMixed, 'changes') === 'ok', 'B12 逐片状态：失败的片记 err，其余片照常 ok')
  check(V.vcFirstScreenSliceErrorOf(rMixed, 'history').kind === 'non-zero', 'B13 逐片失败原因原样带出（不丢错误种类）')
  check(V.vcFirstScreenFailedSlicesOf(rMixed).join(',') === 'history', 'B14 失败片清单给界面逐片画失败态')
  check(V.vcFirstScreenSliceRetryableOf(rMixed, 'history') === true && V.vcFirstScreenSliceRetryableOf(rMixed, 'changes') === false, 'B15 只有失败的片给重试入口')
  const retry = fakeCall({ ok: true, firstScreen: snapshotOf() })
  const rRetry = await V.vcRetryFirstScreenSlice(rMixed, retry.call, 'D:/假工作区/repo', 'history')
  check(retry.calls.length === 1 && V.vcFirstScreenSliceStateOf(rRetry, 'history') === 'ok', 'B16 片级重试：再发一次聚合一电话并换成新快照')
  const retryBad = fakeCall({ ok: true, firstScreen: snapshotOf() })
  await V.vcRetryFirstScreenSlice(rMixed, retryBad.call, 'D:/假工作区/repo', '不存在的片')
  check(retryBad.calls.length === 0, 'B17 片名不在七片名单里：不发电话（界面传错片名不许多打一枪）')
  const badShape = snapshotOf(); badShape.version = 3
  const badShapeCall = fakeCall({ ok: true, firstScreen: badShape })
  const rBad = await V.vcReadFirstScreen(rMixed, badShapeCall.call, 'D:/假工作区/repo')
  check(V.vcFirstScreenStateOf(rBad) === 'err' && V.vcFirstScreenSliceOf(rBad, 'changes') === null, 'B18 版本对不上的回包不冒充成功（按读不到给重试）')
  check(V.vcFirstScreenOf(rBad) === null && rBad.firstScreen.data === mixedSnap, 'B19 坏回包不覆盖旧快照：上一份数据还留着')
  check(V.vcFirstScreenSliceStateOf(rBad, 'changes') === 'load-fail', 'B20 整次读失败：逐片状态记 load-fail（与刚打开面板的 idle 分开）')
  const failEnv = fakeCall({ ok: false, error: { kind: 'env', message: '找不到 git 命令' } })
  const rEnv = await V.vcReadFirstScreen({}, failEnv.call, 'D:/假工作区/repo')
  check(V.vcFirstScreenStateOf(rEnv) === 'err' && rEnv.firstScreen.error.kind === 'env', 'B21 失败信封原样落成整次读的失败原因')
  const throwCall = fakeCall(function () { throw new Error('电话断了') })
  const rThrow = await V.vcReadFirstScreen({}, throwCall.call, 'D:/假工作区/repo')
  check(V.vcFirstScreenStateOf(rThrow) === 'err' && rThrow.firstScreen.error.kind === 'throw', 'B22 调用抛异常：记 throw，不炸界面')
  const okFour = fakeCall({ ok: true, firstScreen: snapshotOf() })
  const rFour = await V.vcReadFirstScreen({}, okFour.call, 'D:/假工作区/repo')
  const screen = V.vcFirstScreenScreenOf(rFour)
  check(!!screen && screen.identity && screen.repo && Array.isArray(screen.commits), 'B23 四片齐时能派生既有 FirstScreen（界面只读快照也能画老块）')
  const rNull = await V.vcReadFirstScreen({}, fakeCall({ ok: true, firstScreen: mixedSnap }).call, 'D:/假工作区/repo')
  check(V.vcFirstScreenScreenOf(rNull) === null, 'B24 四片缺一片就回 null（绝不拿残缺数据拼假 FirstScreen）')
  const logsOk = fakeCall({ ok: true, firstScreen: snapshotOf() })
  const logsBox = buildClient(null)
  await logsBox.v.vcReadFirstScreen({}, logsOk.call, 'D:/假工作区/repo')
  await logsBox.v.vcReadFirstScreen({}, fakeCall({ ok: false, error: { kind: 'env', message: '坏了' } }).call, 'D:/假工作区/repo')
  const evs = logsBox.logs.map(function (l) { return l.event })
  check(evs.indexOf('host.call') >= 0 && evs.indexOf('host.call.fail') >= 0, 'B25 成功与失败都落在既有日志事件上（host.call / host.call.fail）')
  check(logsBox.logs.filter(function (l) { return l.event === 'host.call' })[0].fields.kind === 'git-first-screen', 'B26 成功日志带 kind=git-first-screen（能按事件查到这一路）')

  // ---- C 组：宿主聚合（真 createVersionControl + 假 subprocess） ----
  const happyRoute = makeRoute({})
  const happyRun = makeHostDeps(happyRoute.route)
  const vc = hostMod.createVersionControl(happyRun.deps)
  check(typeof vc.handleGitFirstScreen === 'function', 'C1 宿主取数层把首屏聚合一电话露出来了（wf.gitFirstScreen）')
  const reply = await vc.handleGitFirstScreen({ cwd: 'D:/假工作区/repo' })
  check(reply.ok === true && !!reply.firstScreen, 'C2 聚合电话成功：回包是约定的信封形状（ok / firstScreen）')
  check(FS.firstScreenShapeOk(reply.firstScreen) === true, 'C3 回包就是版本化快照：契约、版本、七片、逐片形状全对')
  check(reply.firstScreen.contract === FS.FIRST_SCREEN_CONTRACT && reply.firstScreen.version === FS.FIRST_SCREEN_VERSION, 'C4 快照带契约名与版本号（界面据此认版本）')
  check(typeof reply.firstScreen.readAtMs === 'number', 'C5 快照带读取时间')
  const happyBad = FS.FIRST_SCREEN_SLICES.filter(function (id) { return reply.firstScreen.slices[id].state !== 'ok' })
  check(happyBad.length === 0, 'C6 七片全数读到（失败片 ' + happyBad.length + ' 个：' + happyBad.join(',') + '）')
  const ws = reply.firstScreen.slices.workspace.data
  check(ws.identity.branch === 'main' && ws.identity.worktreePath.indexOf('.tmp-817-numstat') >= 0, 'C7 工作区状态片：分支与路径来自真机样本')
  const ch = reply.firstScreen.slices.changes.data
  check(ch.stagedCount === 1 && ch.unstagedCount === 4 && ch.conflictCount === 0, 'C8 改动片：已暂存 1 / 未暂存 4 / 冲突 0（实得 ' + ch.stagedCount + '/' + ch.unstagedCount + '/' + ch.conflictCount + '）')
  check(ch.staged.length === 1 && ch.unstaged.length === 4, 'C9 改动片带两组文件清单')
  const hi = reply.firstScreen.slices.history.data
  check(hi.commits.length >= 1 && hi.hasMore === false, 'C10 提交历史首页片：有提交、没有更多（实得 ' + hi.commits.length + ' 条）')
  const wt = reply.firstScreen.slices.worktrees.data
  check(Array.isArray(wt.others) && wt.others.length === 0 && wt.bare === false, 'C11 工作树片：其他工作树清单为空、不是裸仓库')
  const st = reply.firstScreen.slices.stashes.data
  check(st.entries.length === 1 && st.entries[0].selector === 'stash@{0}', 'C12 贮藏片：本票新建的读数读到了 stash@{0}')
  check(/^[0-9a-f]{40}$/.test(st.entries[0].oid) && st.entries[0].subject.indexOf('WIP on main') === 0, 'C13 贮藏片条目带提交号与说明（解析走 parse-stash，不给半份列表）')
  const sy = reply.firstScreen.slices.sync.data
  check(sy.sync === 'no-upstream' && sy.upstream === null && sy.remote === null, 'C14 同步带片：没设上游时如实说尚未设置（不写超前 0）')
  const vr = reply.firstScreen.slices.version.data
  check(vr.tier === 'full' && vr.floor === '2.11', 'C15 版本片：能力档 full、硬底线 2.11')
  check(vr.fullCount + vr.hiddenCount + vr.degradedCount === 162 && vr.switches.length === 0, 'C16 版本片按 162 条能力逐条算可用性（2.49 上 162 条全部可用）')
  const stashArgv = happyRoute.seen.filter(function (argv) { return argv.indexOf('stash') >= 0 })[0]
  check(!!stashArgv && stashArgv.indexOf('list') >= 0 && stashArgv.indexOf('--format=%gd%x00%H%x00%ct%x00%gs') >= 0, 'C17 贮藏列表用共享层命令原文（stash list --format=…）')
  const logFailRoute = makeRoute({ fail: { log: true } })
  const logFailReply = await hostMod.createVersionControl(makeHostDeps(logFailRoute.route).deps).handleGitFirstScreen({ cwd: 'D:/假工作区/repo' })
  check(logFailReply.ok === true && logFailReply.firstScreen.slices.history.state === 'err', 'C18 历史这一路失败：只把历史片标 err，整份快照照样回来')
  const notHist = FS.FIRST_SCREEN_SLICES.filter(function (id) { return id !== 'history' })
  const othersStillOk = notHist.filter(function (id) { return logFailReply.firstScreen.slices[id].state !== 'ok' })
  check(othersStillOk.length === 0, 'C19 单片失败不阻塞整页：其余六片照常 ok（坏 ' + othersStillOk.join(',') + '）')
  check(typeof logFailReply.firstScreen.slices.history.error.kind === 'string' && logFailReply.firstScreen.slices.history.error.kind !== '', 'C20 失败片带错误种类（界面据此画失败态）')
  const stashFailRoute = makeRoute({ fail: { stash: true } })
  const stashFailReply = await hostMod.createVersionControl(makeHostDeps(stashFailRoute.route).deps).handleGitFirstScreen({ cwd: 'D:/假工作区/repo' })
  check(stashFailReply.firstScreen.slices.stashes.state === 'err' && stashFailReply.firstScreen.slices.history.state === 'ok', 'C21 贮藏这一路失败：只坏贮藏片，历史片不受影响')
  const oldRoute = makeRoute({ version: 'git version 2.10.0.windows.1' })
  const oldReply = await hostMod.createVersionControl(makeHostDeps(oldRoute.route).deps).handleGitFirstScreen({ cwd: 'D:/假工作区/repo' })
  const oldVersion = oldReply.firstScreen.slices.version
  check(oldReply.ok === true && oldVersion.state === 'ok' && oldVersion.data.tier === 'unsupported', 'C22 git 低于 2.11：版本片如实说 unsupported（不是假装读到）')
  const oldOthers = FS.FIRST_SCREEN_SLICES.filter(function (id) { return id !== 'version' })
  const oldAllUnsupported = oldOthers.filter(function (id) { const s = oldReply.firstScreen.slices[id]; return s.state === 'err' && s.error.kind === 'unsupported' })
  check(oldAllUnsupported.length === 6, 'C23 git 低于 2.11：其余六片统一显式失败（实得 ' + oldAllUnsupported.length + '/6）')
  check(oldReply.firstScreen.slices.workspace.error.message.indexOf('2.11') >= 0, 'C24 失败原因说清硬底线是 2.11（不沉默地藏起来）')
  const notRepoRoute = makeRoute({ noRepo: true })
  const notRepoReply = await hostMod.createVersionControl(makeHostDeps(notRepoRoute.route).deps).handleGitFirstScreen({ cwd: 'D:/不在仓库里' })
  check(notRepoReply.ok === true && FS.firstScreenShapeOk(notRepoReply.firstScreen) === true, 'C25 不在仓库里：回包仍是七片完整的快照（失败信息落在各片里）')
  const notRepoFailed = FS.FIRST_SCREEN_SLICES.filter(function (id) { return notRepoReply.firstScreen.slices[id].state === 'err' })
  check(notRepoFailed.length === 7, 'C26 不在仓库里：七片都记失败（实得 ' + notRepoFailed.length + '/7）')
  const noGitReply = await hostMod.createVersionControl(makeHostDeps(happyRoute.route, { gitExe: null }).deps).handleGitFirstScreen({ cwd: 'D:/假工作区/repo' })
  check(noGitReply.ok === true && noGitReply.firstScreen.slices.workspace.error.kind === 'env', 'C27 找不到 git：七片整体记 env 失败，回包仍是 ok 信封')
  const verFailRoute = makeRoute({ fail: { version: true } })
  const verFailReply = await hostMod.createVersionControl(makeHostDeps(verFailRoute.route).deps).handleGitFirstScreen({ cwd: 'D:/假工作区/repo' })
  check(verFailReply.firstScreen.slices.version.state === 'err' && verFailReply.firstScreen.slices.history.state === 'err', 'C28 读版本这一步失败：版本片与其余六片都显式失败（不拿未知版本硬读）')
  const callLog = happyRun.logs.filter(function (l) { return l.event === 'host.call' && l.fields && l.fields.kind === 'git-first-screen' })
  check(callLog.length >= 1, 'C29 宿主这趟聚合落在 host.call 日志上（kind=git-first-screen）')
  const parseStash = PS.parseStashList(STASH_LINE)
  check(parseStash.ok === true && parseStash.entries.length === 1, 'C30 贮藏解析器与宿主读法同一份数据源（parse-stash 单测在解析器门禁，这里验真回包用的是它）')

  // ---- D 组：反证组（把被守的东西改坏，同一套判据必须当场判红） ----
  // 反证的写法（与 #818 反证组同一口径）：把源码改坏之后，跑「原判据」看它是不是当场判红。
  // 每条都先确认「这次替换真的改到了原文」，否则改不中就等于没证（#1253 栽过这个坑）。
  const antiVersion = buildClient(function (s) { return s.replace(/FIRST_SCREEN_VERSION = 2/, 'FIRST_SCREEN_VERSION = 9') })
  check(antiVersion.changed === true && antiVersion.v.firstScreenVersionOk(snapshotOf()) === false, 'D1 反证：契约版本被改坏后，「版本对得上的快照」判据当场判红')
  const antiShape = buildClient(function (s) { return s.replace('if (slice.data === null || slice.data === undefined) return false', 'if (false) return false') })
  check(antiShape.changed === true && antiShape.v.firstScreenShapeOk(okNull) === true, 'D2 反证：ok 片「必须有数据」那行被改坏后，没数据的片被放行——A13 那条断言当场判红')
  const antiCall = buildClient(function (s) { return s.replace('return call(VC_FIRST_SCREEN_PHONE, { cwd: String(cwd || \'\') })', 'return Promise.resolve({ ok: false, error: { kind: \'refused\', message: \'不发电话\' } })') })
  const antiCallBox = fakeCall({ ok: true, firstScreen: snapshotOf() })
  await antiCall.v.vcReadFirstScreenOnEnter({}, antiCallBox.call, 'D:/假工作区/repo')
  check(antiCall.changed === true && antiCallBox.calls.length === 0, 'D3 反证：调用那一行被改掉后，「一次刷新一次调用」判据当场判红（实发 ' + antiCallBox.calls.length + ' 次）')
  const antiSlice = buildClient(function (s) { return s.replace("if (snapshot.slices[id].state === 'err') out.push(id)", 'if (false) out.push(id)') })
  check(antiSlice.changed === true && antiSlice.v.firstScreenFailedSlices(rMixed.firstScreen.data).length === 0, 'D4 反证：失败片清单的收录行被删掉后，单片失败不再被逐片报出来——B14 那条断言当场判红')

  console.log(failed ? '有失败 — 首屏一次取全门禁未通过' : '全部通过 — 首屏一次取全门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed ? 1 : 0)
  if (failed) process.exit(1)
}

main().catch(function (e) {
  console.log('  FAIL 门禁自身抛出异常：' + String((e && e.stack) || e))
  total += 1
  failed = true
  console.log('有失败 — 首屏一次取全门禁未通过')
  printGateResult(GATE, total, 1)
  process.exit(1)
})
