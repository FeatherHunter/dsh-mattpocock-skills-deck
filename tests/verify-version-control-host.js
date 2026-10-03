// verify-version-control-host.js — 版本管理页签宿主取数层门禁（#817 落地）
// 用法：在插件根目录执行 node tests/verify-version-control-host.js，可独立运行。
//
// 断言文字：离线可跑（这台机器上不装 git 也照样跑）——用假适配器喂「真机形状」的输出，断言三条电话的外部行为：
//   1. 起进程的纪律：每条命令都有 -C 钉死目录与固定前缀、stdin 一律 ignore、stdout 有字节上限、
//      起进程之前先向闸报一笔、超时走 timer 服务；
//   2. 读不全就不给半份：任何一块输出被截断时，首屏整体显式失败（kind=truncated），不返回半截模型；
//   3. 三种明确失败：git 找不到（env）、不在仓库里（not-repo）、版本太老（unsupported），都不抛；
//   4. 首屏一次拿全（真机字节样本驱动），逐文件增删行数按路径会合；
//   5. 日志：每条命令一行 git.exec（成功与非零退出各一行）、超时与起进程失败一行 git.exec.fail，
//      字段只取白名单那七个；电话本身一行 host.call / host.call.fail。
//   6. #821 按提交看改动（wf.gitDiff 带 rev）：清单与补丁两种形状、非法提交号一律拒绝且绝不进 argv、
//      合并提交的补丁如实说 merge-commit（真机核到：清单那一路给的是相对第一个父提交的真实行数，不空）。
// 最后带反证：拿「不读 git、直接回一份好看的首屏」「把 rev 当没看见」「合并提交当没有改动」
// 「不校验 rev 就拼进 argv」四种坏实现喂同一套断言，每一种都必须当场判红。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const readJson = (rel) => JSON.parse(readText(rel))

// 真机字节样本（#817 采集，命令原文见样本头）：门禁拿它当「git 到底吐什么」的正源。
const LIVE = readJson('version-control-core/fixtures/live-numstat-shapes.json')
// #821 真机样本：四个提交加一次真合并，命令原文见样本头（show --numstat / show -p / rev-list --parents）。
const LIVE_REV = readJson('version-control-core/fixtures/live-rev-shapes.json')
const LIVE_ROOT = /^worktree ([^\u0000\n]+)/.exec(LIVE.worktrees.out)[1]
const FIXED_PREFIX = ['--no-optional-locks', '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'i18n.logOutputEncoding=UTF-8']
const LOG_WHITELIST = ['argv0', 'cwdHash', 'latencyMs', 'exitCode', 'via', 'timeoutMs', 'errorHash']

// ---------- 假适配器：形状照 DSH subprocess 服务（done / collected.stdout / terminate） ----------
function makeCollector(text, truncated) {
  return {
    readFrom(from) { return { text: String(text).slice(from || 0), nextOffset: String(text).length, lossy: truncated === true } },
    finalize() { return { text: String(text), truncated: truncated === true } },
  }
}

/** 真机样本里一条命令的形状是 {code,out,err}，假适配器对外用 {code,stdout,stderr}，这里转一道。 */
function asRun(fx) { return { code: fx.code, stdout: fx.out, stderr: fx.err } }

/** 假文件服务里「这个标记文件在不在」：markerExists 给 true 算全在、给名字算只有那个在、不给算都不在。 */
function markerHit(opt, p) { const want = opt.markerExists; return want === true || (typeof want === 'string' && String(p).indexOf(want) >= 0) }

/** 按命令分发假输出；route 收到 argv，返回 { code, stdout, stderr, truncated, neverSettle, throwOnSpawn }。 */
function makeDeps(route, opts) {
  const o = opts || {}
  const calls = []
  const logs = []
  const gate = { notes: [], noteOutbound(entry) { this.notes.push(entry) } }
  const timerCalls = []
  const deps = {
    subprocess: {
      spawn(req) {
        calls.push(req)
        const hit = route(req.argv) || { code: 0, stdout: '' }
        if (hit.throwOnSpawn === true) throw new Error('假适配器：起进程失败')
        const done = hit.neverSettle === true ? new Promise(function () {}) : Promise.resolve({ exitCode: hit.code === undefined ? 0 : hit.code, signal: hit.signal })
        return { done: done, collected: { stdout: makeCollector(hit.stdout || '', hit.truncated), stderr: makeCollector(hit.stderr || '', false) }, terminate() {} }
      },
    },
    timer: { timeout(ms) { timerCalls.push(ms); return new Promise(function (resolve) { setTimeout(function () { resolve() }, o.timerFast === true ? 1 : ms) }) } },
    fs: o.fs === null ? null : {
      stat(p) { if (o.fsError) return Promise.reject(Object.assign(new Error('读不了'), { code: o.fsError })); return markerHit(o, p) ? Promise.resolve({}) : Promise.reject(Object.assign(new Error('没有这个文件'), { code: 'ENOENT' })) },
      lstat() { return Promise.resolve(null) },
      exists(p) { return Promise.resolve(markerHit(o, p)) },
    },
    getPlatform: async function () { return { resolveExecutable: async function (name) { return name === 'git' ? (o.gitExe === undefined ? 'git' : o.gitExe) : null } } },
    DEFAULT_CWD: 'D:/假工作区/repo',
    TIMEOUT_MS: o.timeoutMs || 30000,
    gate: gate,
    logCtx: { fire(level, event, fields) { logs.push({ level: level, event: event, fields: fields }) } },
  }
  return { deps: deps, calls: calls, logs: logs, gate: gate, timerCalls: timerCalls }
}

/** 把一条命令的 argv 拆成「固定前缀之后」的部分：前半段是 -C 与固定前缀，后半段是真正的子命令。 */
function afterPrefix(argv) {
  const at = argv.indexOf('i18n.logOutputEncoding=UTF-8')
  return at < 0 ? null : argv.slice(at + 1)
}

/** 默认路由：用真机样本喂首屏与按文件取差异两类命令。 */
function liveRoute(argv) {
  const a = afterPrefix(argv)
  if (a === null) return { code: 1, stderr: '缺少固定前缀' }
  if (argv.indexOf('--version') >= 0) return { code: 0, stdout: LIVE.source.gitVersion + '\n' }
  if (a[0] === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) return asRun(LIVE.step0)
  if (a[0] === 'rev-parse' && a.indexOf('--show-toplevel') >= 0) return { code: 0, stdout: LIVE_ROOT + '\n' }
  if (a[0] === 'rev-parse' && a.indexOf('--verify') >= 0) return { code: 0, stdout: 'a'.repeat(40) + '\n' }
  if (a[0] === 'status') return asRun(LIVE.status)
  if (a[0] === 'worktree') return asRun(LIVE.worktrees)
  if (a[0] === 'for-each-ref') return asRun(LIVE.refs)
  if (a[0] === 'log') return asRun(LIVE.log)
  if (a[0] === 'diff' && a.indexOf('--numstat') >= 0) return asRun(LIVE.diffFiles)
  if (a[0] === 'config') return asRun(LIVE.autocrlf)
  if (a[0] === 'reflog') return { code: 0, stdout: 'refs/remotes/origin/main@{2026-10-01T12:00:00+08:00}\n' }
  return { code: 0, stdout: '' }
}

// ---------- 断言套件：喂一个取数器，返回失败清单（真实现必须空手而归；坏实现必须被逮住） ----------
async function screenChecks(makeVc) {
  const bad = []
  const add = (cond, msg) => { if (!cond) bad.push(msg) }
  const { deps, calls, logs, gate } = makeDeps(liveRoute)
  let r = null
  try { r = await makeVc(deps).handleGitStatus({ cwd: 'D:/假工作区/repo' }) } catch (e) { bad.push('首屏抛异常：' + (e && e.message)); return { bad: bad, r: r } }
  if (!r || r.ok !== true) { bad.push('首屏没成功：' + JSON.stringify(r && r.error)); return { bad: bad, r: r } }

  add(r.tier === 'full', '首屏带上能力档（实得 ' + r.tier + '）')
  add(!!r.gitVersion && r.gitVersion.indexOf('git version') === 0, '首屏带上 git 版本原文')
  add(typeof r.readAtMs === 'number' && r.readAtMs > 0, '首屏带上这次读数的时间')
  const s = r.screen
  add(s.identity.branch === 'main' && s.identity.detached === false, '身份行：分支 main 且不是游离头指针')
  add(s.identity.worktreePath === LIVE_ROOT, '身份行给出工作树路径（取自 rev-parse --show-toplevel）')
  add(s.identity.basisMs === null && s.identity.sync === 'no-upstream', '这份样本没有上游：依据时间如实为 null（不拿现在几点冒充，同步态判 no-upstream）')
  add(s.stagedCount === 1 && s.unstagedCount === 4, '改动计数与真机样本一致（已暂存 1、未暂存 4，实得 ' + s.stagedCount + '/' + s.unstagedCount + '）')
  const renamed = s.staged.concat(s.unstaged).filter(function (f) { return f.origPath === '改名 前.txt' })[0]
  add(!!renamed && renamed.path === '改名 后.txt', '重命名按新路径会合、原路径保留')
  const tracked = s.unstaged.filter(function (f) { return f.path === '已跟踪 文件.txt' })[0]
  const plain = s.unstaged.filter(function (f) { return f.path === '普通.txt' })[0]
  add(!!tracked && tracked.addedLines === 2 && tracked.deletedLines === 1, '逐文件增删行数按路径会合（已跟踪 文件.txt 记 2/1）')
  add(!!plain && plain.addedLines === 1 && plain.deletedLines === 1, '逐文件增删行数按路径会合（普通.txt 记 1/1）')
  const binaryRow = s.unstaged.filter(function (f) { return f.path === '图片.png' })[0]
  add(!!binaryRow && binaryRow.addedLines === null && binaryRow.deletedLines === null, '二进制文件行数记 null（不是 0）')
  add(s.commits.length === 1 && s.commits[0].subject.indexOf('首次提交') === 0, '提交历史一次读全（含中文标题）')
  add(s.branches.length >= 1 && s.branches[0].current === true, '本地分支清单含当前分支')
  add(s.repo.bare === false && s.repo.hasCommits === true, '仓库级状态：非裸仓库、有提交')
  add(s.repo.merging === false && s.repo.rebasing === false && s.repo.cherryPicking === false && s.repo.reverting === false, '五个运行中标记都不在时：四个动作如实判「没在做」（ENOENT 才算不在）')

  // 起进程的纪律：每一条命令都钉死目录、带固定前缀、stdin ignore、stdout 有上限、起进程前报闸
  add(calls.length >= 8, '首屏真的起了若干条进程（实得 ' + calls.length + '）')
  for (const req of calls) {
    const at = req.argv.indexOf('-C')
    add(at >= 0 && typeof req.argv[at + 1] === 'string' && req.argv[at + 1] !== '', '每条命令都用 -C 钉死目录：' + req.argv.slice(0, 6).join(' '))
    add(FIXED_PREFIX.every(function (p) { return req.argv.indexOf(p) >= 0 }), '每条命令都带固定前缀（不抢锁、关转义、关颜色、UTF-8）')
    add(!!req.stdio && req.stdio.stdin === 'ignore', '标准输入一律 ignore')
    add(!!req.stdio && !!req.stdio.stdout && typeof req.stdio.stdout.maxBytes === 'number' && req.stdio.stdout.maxBytes > 0, '标准输出设了字节上限')
    add(typeof req.cwd === 'string' && req.cwd !== '', '子进程有工作目录')
  }
  add(gate.notes.length === calls.length, '起进程之前先向闸报一笔：报账数与进程数一致（实得 ' + gate.notes.length + '/' + calls.length + '）')
  add(gate.notes.every(function (n) { return !!n && n.requests === 1 }), '每笔报账记 1 条请求')

  // 日志：每条命令一行 git.exec；电话一行 host.call；字段只取白名单那七个
  const execLines = logs.filter(function (l) { return l.event === 'git.exec' })
  add(execLines.length === calls.length, '每条命令一行 git.exec（实得 ' + execLines.length + '/' + calls.length + '）')
  add(execLines.every(function (l) { return l.level === 'info' && l.fields.via === 'version-control' && l.fields.argv0 === 'git' }), 'git.exec 是信息级、via 固定、argv0 只记程序名')
  add(execLines.every(function (l) { return typeof l.fields.latencyMs === 'number' && typeof l.fields.exitCode === 'number' }), 'git.exec 带耗时与退出码')
  const callLines = logs.filter(function (l) { return l.event === 'host.call' })
  add(callLines.length === 1 && callLines[0].fields.method === 'wf.gitStatus' && callLines[0].fields.kind === 'git-status' && callLines[0].fields.ok === true, '电话成功落一行 host.call（method/kind/ok）')
  const CALL_WHITELIST = ['method', 'latencyMs', 'ok', 'kind', 'pluginId', 'errorHash', 'errorKind']
  for (const l of logs) {
    const allowed = (l.event === 'git.exec' || l.event === 'git.exec.fail') ? LOG_WHITELIST : CALL_WHITELIST
    for (const k of Object.keys(l.fields || {})) add(allowed.indexOf(k) >= 0, '日志字段在白名单内：' + l.event + '.' + k)
  }
  const loggedJson = JSON.stringify(logs.map(function (l) { return l.fields }))
  add(!/(cwd|path|stdout|stderr|message|args|argv)"/.test(loggedJson), '日志字段里没有原始路径、命令参数或输出正文')
  return { bad: bad, r: r }
}

async function makeVcFromMod(deps) { return deps }

// ---------- 9) #821：按提交看改动（rev 两条读法；非法值绝不进 argv；合并提交如实说明） ----------
/**
 * 按提交取差异那一路的断言套件：喂一个取数器，返回失败清单。
 * 真实现必须空手而归；坏实现必须被逮住（见 main 里的反证甲 / 乙 / 丙）。
 * 数据来源是 #821 的真机样本（live-rev-shapes.json）：四个提交加一次真合并。
 */
async function revChecks(makeVc) {
  const bad = []
  const add = (cond, msg) => { if (!cond) bad.push(msg) }
  const ids = LIVE_REV.ids
  const REV_KEY = {}
  REV_KEY[ids.root] = 'root'; REV_KEY[ids.normal] = 'normal'; REV_KEY[ids.normalShort] = 'normal'
  REV_KEY[ids.third] = 'third'; REV_KEY[ids.empty] = 'empty'; REV_KEY[ids.merge] = 'merge'
  const PATCH_SAMPLES = {}
  PATCH_SAMPLES['normal\u0000一 号文件.txt'] = LIVE_REV.patch.normalHuman
  PATCH_SAMPLES['root\u0000b.txt'] = LIVE_REV.patch.rootB
  PATCH_SAMPLES['third\u0000一 号文件.txt'] = LIVE_REV.patch.thirdHuman
  PATCH_SAMPLES['merge\u0000一 号文件.txt'] = LIVE_REV.patch.mergeHuman
  PATCH_SAMPLES['merge\u0000b.txt'] = LIVE_REV.patch.mergeB
  const keyOf = (rev) => REV_KEY[rev] || null
  /** 按真机样本回答：rev 类命令按提交号取样本；认不出的提交号按 git 的失败样子回。 */
  function revRoute(argv) {
    const a = afterPrefix(argv)
    if (a === null) return { code: 1, stderr: '缺少固定前缀' }
    if (a[0] === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) return asRun(LIVE.step0)
    if (a[0] === 'rev-parse' && a.indexOf('--show-toplevel') >= 0) return { code: 0, stdout: LIVE_ROOT + '\n' }
    if (a[0] === 'rev-list') {
      const k = keyOf(a[a.length - 1]); const hit = k ? LIVE_REV.revList[k] : null
      return hit ? asRun(hit) : { code: 128, stdout: '', stderr: "fatal: ambiguous argument '" + a[a.length - 1] + "': unknown revision or path not in the working tree.\n" }
    }
    if (a[0] === 'show' && a.indexOf('--numstat') >= 0) {
      const k = keyOf(a[a.length - 1]); const hit = k ? LIVE_REV.numstat[k] : null
      return hit ? asRun(hit) : { code: 128, stdout: '', stderr: 'fatal: bad revision\n' }
    }
    if (a[0] === 'show') {
      const k = keyOf(a[a.indexOf('--format=') + 1]); const hit = k ? PATCH_SAMPLES[k + '\u0000' + a[a.indexOf('--') + 1]] : null
      return hit ? asRun(hit) : { code: 128, stdout: '', stderr: 'fatal: bad revision\n' }
    }
    if (a[0] === 'diff' && a.indexOf('--numstat') < 0) return { code: 0, stdout: 'diff --git x y\n--- x\n+++ y\n@@ -1 +1 @@\n-旧\n+新\n' }
    return liveRoute(argv)
  }
  async function call(args) {
    const box = makeDeps(revRoute)
    let r = null
    try { r = await makeVc(box.deps).handleGitDiff(args) } catch (e) { r = { threw: String((e && e.message) || e) } }
    return { r: r, calls: box.calls }
  }
  const CWD = 'D:/假工作区/repo'

  // ① 一次普通提交改了哪些文件（真机 numstat 字节）
  const normal = (await call({ cwd: CWD, rev: ids.normal })).r
  add(normal && normal.ok === true, '一次普通提交：回 ok（实得 ' + JSON.stringify(normal && (normal.error || normal.threw)) + '）')
  add(normal && normal.rev === ids.normal, '清单回包原样带回请求里那个提交号（界面能与请求对齐）')
  add(normal && normal.truncated === false && normal.reason === 'ok', '读全了：truncated=false、reason=ok')
  const nf = (normal && Array.isArray(normal.files)) ? normal.files : []
  add(nf.length === 3, '普通提交改了三个文件（实得 ' + nf.length + '）')
  add(nf.some((f) => f.path === '一 号文件.txt' && f.origPath === null && f.added === 3 && f.deleted === 2), '每个文件带路径、原路径与增删行数（一 号文件.txt 3/2）')
  add(nf.some((f) => f.path === '新 文件.txt' && f.added === 1 && f.deleted === 0), '新增文件按真机行数解出（新 文件.txt 1/0）')

  // ② 根提交：没有父提交也要能取
  const root = (await call({ cwd: CWD, rev: ids.root })).r
  add(root && root.ok === true && Array.isArray(root.files) && root.files.length === 2, '根提交：两个文件都按新增解出（实得 ' + ((root && root.files) || []).length + '）')

  // ③ 空提交：清单为空，但明说是 no-diff 而不是 ok
  const empty = (await call({ cwd: CWD, rev: ids.empty })).r
  add(empty && empty.ok === true && Array.isArray(empty.files) && empty.files.length === 0 && empty.reason === 'no-diff' && empty.truncated === false, '空提交：清单为空但如实说 no-diff（不是 ok、不是 truncated）')

  // ④ 合并提交的清单：真机给的是相对第一个父提交的真实行数，不是空
  const merge = (await call({ cwd: CWD, rev: ids.merge })).r
  add(merge && merge.ok === true && merge.reason === 'ok' && Array.isArray(merge.files) && merge.files.length === 1 && merge.files[0].path === '一 号文件.txt' && merge.files[0].added === 1,
    '合并提交的清单：show --numstat 给的是相对第一个父提交的真实行数（真机核过，不空）')

  // ⑤ 合并提交的补丁：git 默认不展开，必须如实说 merge-commit
  const mergePatch = (await call({ cwd: CWD, rev: ids.merge, path: '一 号文件.txt' })).r
  add(mergePatch && mergePatch.ok === true && mergePatch.reason === 'merge-commit' && Array.isArray(mergePatch.lines) && mergePatch.lines.length === 0 && mergePatch.truncated === false,
    '合并提交的单文件差异：明说 merge-commit，不写成「这个文件没有改动」（实得 ' + (mergePatch && mergePatch.reason) + '）')
  add(mergePatch && mergePatch.rev === ids.merge && mergePatch.path === '一 号文件.txt', '这一路回包也带回 rev 与 path')

  // ⑥ 不是合并提交、这次没碰这个文件 → no-diff：两种空必须分得开
  const third = (await call({ cwd: CWD, rev: ids.third, path: '一 号文件.txt' })).r
  add(third && third.ok === true && third.reason === 'no-diff' && third.rev === ids.third, '非合并提交的空补丁说 no-diff（与 merge-commit 分开）')

  // ⑦ 普通提交的单文件补丁：仍走核心的逐行分类
  const normalPatch = (await call({ cwd: CWD, rev: ids.normal, path: '一 号文件.txt' })).r
  add(normalPatch && normalPatch.ok === true && normalPatch.reason === 'ok' && normalPatch.rev === ids.normal && Array.isArray(normalPatch.lines)
    && normalPatch.lines.some((l) => l.kind === 'add') && normalPatch.lines.some((l) => l.kind === 'del'),
    '普通提交的单文件补丁按核心逐行分类回给界面，且带回 rev')

  // ⑧ 命令形状：提交号只作为独立的 argv 元素出现，绝不拼进任何选项
  const shape = await call({ cwd: CWD, rev: ids.normal })
  const argvs = shape.calls.map((c) => c.argv)
  const numstatCall = argvs.filter((argv) => argv.indexOf('show') >= 0 && argv.indexOf('--numstat') >= 0)[0]
  add(!!numstatCall && afterPrefix(numstatCall).join(' ') === ['show', '--numstat', '-z', '--no-ext-diff', '--find-renames', '--format=', ids.normal].join(' '),
    '带 rev 的清单命令与核心拼的一字不差（实得 ' + (numstatCall ? afterPrefix(numstatCall).join(' ') : '没起进程') + '）')
  const revListCall = argvs.filter((argv) => argv.indexOf('rev-list') >= 0)[0]
  add(!!revListCall && afterPrefix(revListCall).join(' ') === ['rev-list', '--parents', '-n', '1', ids.normal].join(' '),
    '确认这一次提交的命令形状是 rev-list --parents -n 1 <提交号>（实得 ' + (revListCall ? afterPrefix(revListCall).join(' ') : '没起进程') + '）')
  add(argvs.every((argv) => argv.filter((x) => String(x).indexOf(ids.normal) >= 0).every((x) => x === ids.normal)),
    '提交号在 argv 里只作为完整元素出现（没有拼进 --format= 之类的选项里）')
  const shortCall = await call({ cwd: CWD, rev: ids.normalShort, path: '一 号文件.txt' })
  add(shortCall.r && shortCall.r.ok === true && shortCall.r.reason === 'ok' && shortCall.r.rev === ids.normalShort, '短短提交号（8 位十六进制）也照常取补丁，回包原样带回请求里那个值')

  // ⑨ 非法提交号：一律拒绝，而且一个进程都不许起
  for (const badRev of ['--upload-pack=x', '-c', 'HEAD', 'abc', 'zzzz', 'a'.repeat(65), '1 2', 'main']) {
    const out = await call({ cwd: CWD, rev: badRev })
    add(out.r && out.r.ok === false && out.r.error && out.r.error.kind === 'args', '非法提交号被明确拒绝（' + badRev.slice(0, 16) + '）：kind=args')
    add(out.calls.length === 0, '非法提交号不起任何进程（实得 ' + out.calls.length + ' 条）')
  }

  // ⑩ 形状合法但仓库里没有：照样明确拒绝
  const missing = (await call({ cwd: CWD, rev: 'deadbeef' })).r
  add(missing && missing.ok === false && missing.error.kind === 'args' && missing.error.message.indexOf('找不到') >= 0,
    '形状合法但仓库里没有的提交号：明确拒绝 kind=args（实得 ' + JSON.stringify(missing && missing.error) + '）')

  // ⑪ 读不全就不给半份（清单与补丁各一条）
  const truncNumstat = function (argv) { const a = afterPrefix(argv); if (a && a[0] === 'show' && a.indexOf('--numstat') >= 0) return { code: 0, stdout: '半截', truncated: true }; return revRoute(argv) }
  const truncListBox = makeDeps(truncNumstat)
  const truncList = await makeVc(truncListBox.deps).handleGitDiff({ cwd: CWD, rev: ids.normal })
  add(truncList && truncList.ok === true && truncList.truncated === true && Array.isArray(truncList.files) && truncList.files.length === 0 && truncList.reason === 'truncated' && truncList.rev === ids.normal,
    '清单读不全：ok + truncated + 空清单 + reason=truncated')
  const truncPatchRoute = function (argv) { const a = afterPrefix(argv); if (a && a[0] === 'show' && a.indexOf('--numstat') < 0) return { code: 0, stdout: '半截', truncated: true }; return revRoute(argv) }
  const truncPatch = await makeVc(makeDeps(truncPatchRoute).deps).handleGitDiff({ cwd: CWD, rev: ids.normal, path: '一 号文件.txt' })
  add(truncPatch && truncPatch.ok === true && truncPatch.truncated === true && Array.isArray(truncPatch.lines) && truncPatch.lines.length === 0 && truncPatch.reason === 'truncated' && truncPatch.rev === ids.normal,
    '补丁读不全：ok + truncated + 零行 + reason=truncated，且带回 rev')

  // ⑫ 不带 rev 的老路：回包里没有 rev 字段（与从前一字不差）
  const plain = (await call({ cwd: CWD, path: '普通.txt' })).r
  add(plain && plain.ok === true && plain.reason === 'ok' && Array.isArray(plain.lines) && plain.lines.some((l) => l.kind === 'add') && plain.rev === undefined,
    '不带 rev 的回包没有 rev 字段（既有形状一字不差）')

  return { bad: bad }
}

async function main() {
  console.log('版本管理宿主取数层门禁（#817：三条电话 + 起进程纪律 + 读不全就不给 + 反证）')

  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  check(typeof hostMod.createVersionControl === 'function', '宿主取数层导出 createVersionControl')

  // ---- 1) 接线字面量：三条电话名与加载器都在 index.js 里；取数层不碰 child_process、不经 shell ----
  const indexSrc = readText(path.join('src', 'host', 'index.js'))
  for (const phone of ['wf.gitStatus', 'wf.gitDiff', 'wf.gitLog']) {
    check(indexSrc.indexOf("harness.handle('" + phone + "'") >= 0, '入口以字面量注册 ' + phone)
  }
  check(indexSrc.indexOf("import('./versionControl.js')") >= 0, '入口动态加载 ./versionControl.js（同层互引走装配点）')
  const hostSrc = readText(path.join('src', 'host', 'versionControl.js'))
  const hostCode = hostSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
  check(hostCode.indexOf('child_process') < 0 && hostCode.indexOf('execSync') < 0 && hostCode.indexOf('spawnSync') < 0 && hostCode.indexOf('shell') < 0, '宿主取数层不碰 child_process、不经 shell（按去注释后的代码判）')
  for (const phone of ['wf.gitStatus', 'wf.gitDiff', 'wf.gitLog']) {
    check(hostSrc.indexOf("loggedPhone('" + phone + "'") >= 0, '电话体用 loggedPhone 包出日志 ' + phone)
  }
  check(hostSrc.indexOf("'host.call'") >= 0 && hostSrc.indexOf("'host.call.fail'") >= 0, '电话日志沿用既有 host.call / host.call.fail 两个事件')
  check(hostSrc.indexOf("'git.exec'") >= 0 && hostSrc.indexOf("'git.exec.fail'") >= 0, '两条新事件名以字面量出现（git.exec / git.exec.fail）')
  // #821 拆出的差异电话体：它必须仍然只有一条起进程的路（拿父文件传进来的 runPinned），自己不起进程。
  const leafSrc = readText(path.join('src', 'host', 'versionControlFiles.js'))
  const leafCode = leafSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
  check(leafCode.indexOf('child_process') < 0 && leafCode.indexOf('execSync') < 0 && leafCode.indexOf('spawnSync') < 0 && leafCode.indexOf('shell') < 0, '拆出来的差异电话体也不碰 child_process、不经 shell（按去注释后的代码判）')
  check(leafSrc.indexOf('createGitDiffPhone') >= 0 && leafSrc.indexOf("import('./versionControl.js')") < 0, '差异电话体是自包含叶子：导出 createGitDiffPhone，且不反向引用父文件（单向引用）')
  check(hostSrc.indexOf("import('./versionControlFiles.js')") >= 0, '父文件以字面量动态加载差异电话体（同层装配边已记进 tests/same-layer-baseline.json）')
  check(hostSrc.indexOf('parsePatch') < 0, '补丁解析器随电话体搬到叶子里（父文件不再直接持解析器）')

  // ---- 2) 真机样本驱动首屏：同一套断言 ----
  const real = await screenChecks(function (deps) { return hostMod.createVersionControl(deps) })
  check(real.bad.length === 0, '真实现：首屏断言全过' + (real.bad.length ? ' —— 没过：' + real.bad.join('；') : ''))

  // ---- 3) 反证：不读 git、直接回一份好看首屏的坏实现，必须被同一套断言逮住 ----
  const fakeScreen = {
    identity: { worktreeDisplay: 'repo', worktreePath: LIVE_ROOT, branch: 'main', detached: false, oid: 'a'.repeat(40), sync: 'tracked-fresh', ahead: 0, behind: 0, basisMs: Date.parse('2026-10-01T12:00:00+08:00') },
    staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0, otherWorktrees: [], branches: [], commits: [],
    repo: { merging: false, rebasing: false, cherryPicking: false, reverting: false, hasCommits: true, bare: false, tier: 'full', autocrlf: null },
  }
  const badImpl = { createVersionControl: function () { return { handleGitStatus: async function () { return { ok: true, tier: 'full', gitVersion: 'git version 2.49.0.windows.1', readAtMs: Date.now(), screen: fakeScreen } } } } }
  const caught = await screenChecks(function (deps) { return badImpl.createVersionControl(deps) })
  check(caught.bad.length > 0, '反证：不读 git 的假首屏必须被判红（被 ' + caught.bad.length + ' 条逮住：' + caught.bad.slice(0, 3).join('；') + '）')

  // ---- 3.5) 有上游时：依据时间取远端跟踪引用 reflog 的末条（不是现在几点）----
  const upstreamRoute = function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'status') {
      const withUp = LIVE.status.out.replace('# branch.head main\u0000', '# branch.head main\u0000# branch.upstream origin/main\u0000# branch.ab +1 -2\u0000')
      return { code: 0, stdout: withUp }
    }
    if (a && a[0] === 'reflog') return { code: 0, stdout: 'refs/remotes/origin/main@{2026-09-29T08:30:00+08:00}\n' }
    return liveRoute(argv)
  }
  const rUp = await hostMod.createVersionControl(makeDeps(upstreamRoute).deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(rUp.ok === true && rUp.screen.identity.basisMs === Date.parse('2026-09-29T08:30:00+08:00'), '有上游时：依据时间取 reflog 末条时间戳')
  check(rUp.ok === true && rUp.screen.identity.sync === 'tracked-fresh' && rUp.screen.identity.ahead === 1 && rUp.screen.identity.behind === 2, '有上游时：领先落后读 branch.ab，同步态判 tracked-fresh')
  const noReflogRoute = function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'reflog') return { code: 128, stdout: '', stderr: 'fatal: bad revision\n' }
    return upstreamRoute(argv)
  }
  const rNoRef = await hostMod.createVersionControl(makeDeps(noReflogRoute).deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(rNoRef.ok === true && rNoRef.screen.identity.basisMs === null, 'reflog 读不到时：依据时间如实为 null（不猜）')

  // ---- 3.6) 运行中标记的三档：真在 / 明确不在 / 读不了（读不了绝不当成不在）----
  const rMarker = await hostMod.createVersionControl(makeDeps(liveRoute, { markerExists: 'MERGE_HEAD' }).deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(rMarker.ok === true && rMarker.screen.repo.merging === true && rMarker.screen.repo.rebasing === false, '标记文件真在时：如实判出合并进行中（其余三项不动）')
  const rUnreadable = await hostMod.createVersionControl(makeDeps(liveRoute, { fsError: 'EACCES' }).deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(rUnreadable.ok === false && rUnreadable.error.kind === 'env', '标记文件读不了（非 ENOENT）：明说读不到 kind=env，绝不当成「不在」')

  // ---- 4) 三种明确失败：git 找不到 / 不在仓库里 / 版本太老；一律返回值，不抛 ----
  const rNoGit = await hostMod.createVersionControl(makeDeps(liveRoute, { gitExe: null }).deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(rNoGit.ok === false && rNoGit.error.kind === 'env', 'git 找不到：明确失败 kind=env，不抛')

  const notRepoRoute = function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) return { code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' }
    return liveRoute(argv)
  }
  const rNotRepo = await hostMod.createVersionControl(makeDeps(notRepoRoute).deps).handleGitStatus({ cwd: 'D:/不在仓库里' })
  check(rNotRepo.ok === false && rNotRepo.error.kind === 'not-repo', '不在仓库里：明确失败 kind=not-repo（退出码 128 交给核心分类）')
  // .git 文件非法这种情形：非零退出、stderr 里是 git 自己那句话，要带进失败说明，不能只剩「读不懂：exit 128」
  const badGitfileRoute = function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) return { code: 128, stdout: '', stderr: 'fatal: invalid gitfile format: D:/假工作区/repo/.git\n' }
    return liveRoute(argv)
  }
  const rBadGitfile = await hostMod.createVersionControl(makeDeps(badGitfileRoute).deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(rBadGitfile.ok === false && rBadGitfile.error.kind === 'parse' && rBadGitfile.error.message.indexOf('invalid gitfile format') >= 0, '.git 文件非法：把 git 自己那句话带进失败说明（实得「' + (rBadGitfile.error ? rBadGitfile.error.message.slice(0, 60) : '') + '」）')

  const oldGitRoute = function (argv) { return argv.indexOf('--version') >= 0 ? { code: 0, stdout: 'git version 2.10.0.windows.1\n' } : liveRoute(argv) }
  const rOld = await hostMod.createVersionControl(makeDeps(oldGitRoute).deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(rOld.ok === false && rOld.error.kind === 'unsupported' && rOld.tier === 'unsupported', '版本太老：明确失败 kind=unsupported，并带上版本与能力档')

  // ---- 5) 读不全就不给半份：任何一块被截断，首屏整体失败 ----
  const truncatedStatus = function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'status') return { code: 0, stdout: LIVE.status.out, truncated: true }
    return liveRoute(argv)
  }
  const rTrunc = await hostMod.createVersionControl(makeDeps(truncatedStatus).deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(rTrunc.ok === false && rTrunc.error.kind === 'truncated', '工作区改动被截断：整屏显式失败 kind=truncated（不给半份模型）')

  // ---- 6) 超时与起进程失败：各落一行 git.exec.fail，且不抛 ----
  const timeoutRun = makeDeps(function () { return { neverSettle: true } }, { timerFast: true })
  const rTimeout = await hostMod.createVersionControl(timeoutRun.deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(rTimeout.ok === false && rTimeout.error.kind === 'timeout', '超时：明确失败 kind=timeout（走 timer 服务）')
  check(timeoutRun.timerCalls.length >= 1, '超时这条走的是 DSH 的 timer 服务')
  const failLines = timeoutRun.logs.filter(function (l) { return l.event === 'git.exec.fail' })
  check(failLines.length === 1 && failLines[0].level === 'warn' && typeof failLines[0].fields.timeoutMs === 'number', '超时落一行告警级 git.exec.fail（带 timeoutMs）')
  check(timeoutRun.logs.filter(function (l) { return l.event === 'git.exec' }).length === 0, '超时那条不落 git.exec（没有退出码可记）')

  const spawnFailRun = makeDeps(function () { return { throwOnSpawn: true } })
  const rSpawn = await hostMod.createVersionControl(spawnFailRun.deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(rSpawn.ok === false && rSpawn.error.kind === 'spawn', '起进程失败：明确失败 kind=spawn，不抛')
  const spawnFailLines = spawnFailRun.logs.filter(function (l) { return l.event === 'git.exec.fail' })
  check(spawnFailLines.length === 1 && spawnFailLines[0].level === 'warn' && typeof spawnFailLines[0].fields.errorHash === 'string', '起进程失败落一行告警级 git.exec.fail（错误只记散列）')

  // ---- 7) 非零退出：落一行 git.exec（退出码非 0），由调用方判 ----
  const exitRoute = function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'for-each-ref') return { code: 3, stdout: '', stderr: '假适配器：分支清单失败\n' }
    return liveRoute(argv)
  }
  const exitRun = makeDeps(exitRoute)
  const rExit = await hostMod.createVersionControl(exitRun.deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(rExit.ok === false && rExit.error.kind === 'exit' && rExit.error.message.indexOf('3') >= 0, '非零退出：kind=exit 且说明里带退出码')
  const exitLines = exitRun.logs.filter(function (l) { return l.event === 'git.exec' && l.fields.exitCode === 3 })
  check(exitLines.length === 1 && exitLines[0].level === 'info', '非零退出也落一行 git.exec（信息级、带真实退出码）')

  // ---- 8) 按文件取差异与历史按批取：结果形状各一条底线 ----
  const diffRoute = function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'diff' && a.indexOf('--numstat') < 0) return { code: 0, stdout: 'diff --git x y\n--- x\n+++ y\n@@ -1 +1 @@\n-旧\n+新\n' }
    return liveRoute(argv)
  }
  const diffVc = hostMod.createVersionControl(makeDeps(diffRoute).deps)
  const dUntracked = await diffVc.handleGitDiff({ cwd: 'D:/假工作区/repo', path: '新增 未跟踪.txt', untracked: true })
  check(dUntracked.ok === true && dUntracked.reason === 'untracked-no-diff' && dUntracked.lines.length === 0, '未跟踪文件：直说 untracked-no-diff，不拿空差异冒充没改动')
  const dPatch = await diffVc.handleGitDiff({ cwd: 'D:/假工作区/repo', path: '普通.txt' })
  check(dPatch.ok === true && dPatch.reason === 'ok' && dPatch.lines.some(function (l) { return l.kind === 'add' }) && dPatch.lines.some(function (l) { return l.kind === 'del' }), '普通差异：按核心的逐行分类回给界面')
  const binaryRoute = function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'diff' && a.indexOf('--numstat') < 0) return { code: 0, stdout: 'Binary files a.png and b.png differ\n' }
    return liveRoute(argv)
  }
  const dBinary = await hostMod.createVersionControl(makeDeps(binaryRoute).deps).handleGitDiff({ cwd: 'D:/假工作区/repo', path: '图片.png' })
  check(dBinary.ok === true && dBinary.reason === 'binary-diff' && dBinary.lines.length === 0, '二进制差异：直说 binary-diff，不硬套逐行分类')
  const truncRoute = function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'diff' && a.indexOf('--numstat') < 0) return { code: 0, stdout: '半截', truncated: true }
    return liveRoute(argv)
  }
  const dTrunc = await hostMod.createVersionControl(makeDeps(truncRoute).deps).handleGitDiff({ cwd: 'D:/假工作区/repo', path: '很大.txt' })
  check(dTrunc.ok === true && dTrunc.truncated === true && dTrunc.lines.length === 0 && dTrunc.reason === 'truncated', '差异读不全：带截断标记且一片都不给（不给半截补丁）')
  const dNoPath = await diffVc.handleGitDiff({ cwd: 'D:/假工作区/repo' })
  check(dNoPath.ok === false && dNoPath.error.kind === 'args', '取差异没给文件路径：明确失败 kind=args')

  const logRoute = function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'log') {
      const two = LIVE.log.out + LIVE.log.out
      return { code: 0, stdout: two }
    }
    return liveRoute(argv)
  }
  const lVc = hostMod.createVersionControl(makeDeps(logRoute).deps)
  const lBatch = await lVc.handleGitLog({ cwd: 'D:/假工作区/repo', count: 1, skip: 0 })
  check(lBatch.ok === true && lBatch.returned === 1 && lBatch.hasMore === true && lBatch.requested === 1, '历史按批取：多要一条用来判断后面还有没有（hasMore）')
  const lClamp = await lVc.handleGitLog({ cwd: 'D:/假工作区/repo', count: 9999 })
  check(lClamp.ok === true && lClamp.requested === 200, '一批条数夹在上限内（实得 ' + lClamp.requested + '）')
  const noHeadRoute = function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'rev-parse' && a.indexOf('--verify') >= 0) return { code: 1, stdout: '', stderr: 'fatal: Needed a single revision\n' }
    return liveRoute(argv)
  }
  const lEmpty = await hostMod.createVersionControl(makeDeps(noHeadRoute).deps).handleGitLog({ cwd: 'D:/假工作区/repo' })
  check(lEmpty.ok === true && lEmpty.commits.length === 0 && lEmpty.hasMore === false, '零提交仓库：历史回空表（退出码判，不吃本地化文案）')


  // ---- 9) #821 按提交看改动：真实现 + 三种坏实现的反证 ----
  const realRev = await revChecks(function (deps) { return hostMod.createVersionControl(deps) })
  check(realRev.bad.length === 0, '真实现：按提交取差异那一路断言全过' + (realRev.bad.length ? ' —— 没过：' + realRev.bad.slice(0, 3).join('；') : ''))

  // 反证甲：把 rev 当没看见、永远回工作区差异的旧实现
  const badIgnoreRev = { createVersionControl: function () { return { handleGitDiff: async function (args) { return { ok: true, path: String((args && args.path) || ''), lines: [], truncated: false, reason: 'no-diff' } } } } }
  const caughtA = await revChecks(function (deps) { return badIgnoreRev.createVersionControl(deps) })
  check(caughtA.bad.length > 0, '反证甲：把 rev 当没看见的旧实现必须被判红（被 ' + caughtA.bad.length + ' 条逮住：' + caughtA.bad.slice(0, 2).join('；') + '）')

  // 反证乙：把合并提交的补丁说成 no-diff（等于告诉用户「这个文件没有改动」）
  const badMergeNoDiff = {
    createVersionControl: function (deps) {
      const real = hostMod.createVersionControl(deps)
      return { handleGitDiff: async function (args) { const r = await real.handleGitDiff(args); return (r && r.ok === true && r.reason === 'merge-commit') ? Object.assign({}, r, { reason: 'no-diff' }) : r } }
    },
  }
  const caughtB = await revChecks(function (deps) { return badMergeNoDiff.createVersionControl(deps) })
  check(caughtB.bad.length > 0, '反证乙：把合并提交的补丁说成 no-diff 必须被判红（被 ' + caughtB.bad.length + ' 条逮住）')

  // 反证丙：不校验 rev 就拼进 argv（这一条正是「外部值拼成 git 选项」那个坑）
  const badRawRev = {
    createVersionControl: function (deps) {
      return { handleGitDiff: async function (args) {
        const rev = String((args && args.rev) || '')
        const handle = deps.subprocess.spawn({ argv: ['git', 'show', '--format=' + rev], cwd: args.cwd, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, graceMs: 2000 })
        try { await handle.done } catch (e) { /* 坏实现不在乎 */ }
        return { ok: true, rev: rev, files: [], truncated: false, reason: 'ok' }
      } }
    },
  }
  const caughtC = await revChecks(function (deps) { return badRawRev.createVersionControl(deps) })
  check(caughtC.bad.length > 0, '反证丙：不校验 rev 就拼进 argv 的写法必须被判红（被 ' + caughtC.bad.length + ' 条逮住）')

  console.log(failed ? '\n存在失败 — verify-version-control-host 未通过' : '\n全部通过 — 宿主取数层门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
