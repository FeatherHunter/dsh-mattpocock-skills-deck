// verify-841-write-phones.ts —— 写操作那一族门禁（#841 第二段）：A–G 七组，每组带反证。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-841-write-phones.ts
// 夹具：真 git 临时仓库（每个用例自己造）+ 真 subprocess 形状的垫片（argv 直传、不经 shell），
// 这样「真跑过的 argv」与「真仓库有没有被动过」都能断言；只在纯归类那组不碰 git。
// 本文件是 CommonJS：产品源码靠动态 import 取，说明符一律 .js（靠钩子改指同名 .ts）；
// 只加类型标注，判据、白名单与锚字符串一字不动。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) }
const git = (cwd: string, args: string[]) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() } }
function mkRepo(tag: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws841-' + tag + '-'))
  git(base, ['init', '-q', '-b', 'main']); git(base, ['config', 'user.name', 'x']); git(base, ['config', 'user.email', 'x@y'])
  fs.writeFileSync(path.join(base, 'a.txt'), 'a\n'); git(base, ['add', '-A']); git(base, ['commit', '-q', '-m', '基线'])
  fs.writeFileSync(path.join(base, 'a.txt'), 'a\nb\n'); git(base, ['add', 'a.txt'])
  return base
}
const spawns: string[][] = []
// #1741：既有断言只看 argv；补一份完整请求（cwd/stdio/env），才能断言 GIT_EDITOR 与 stdin 形状。
const requests: Array<{ argv: string[]; cwd: string; stdio: any; env: any }> = []
let lastStdin: any = null
const logs: Array<{ level: string; event: string; fields: Record<string, any> }> = []
const timerCalls: number[] = []
let clock = { t: 1000 }
function makeVc(route?: ((argv: string[]) => any) | null) {
  spawns.length = 0
  requests.length = 0
  lastStdin = null
  logs.length = 0
  timerCalls.length = 0
  const deps = {
    subprocess: { spawn(req) { spawns.push(req.argv.slice()); requests.push({ argv: req.argv.slice(), cwd: req.cwd, stdio: req.stdio, env: req.env }); const hit = route ? route(req.argv, req) : null; if (hit && hit.throwOnSpawn) throw new Error('spawn ENOENT'); if (hit) { const mk = (t, trunc) => ({ finalize: () => ({ text: String(t || ''), truncated: trunc === true }) }); const handle: any = { done: hit.pending ? new Promise(() => {}) : Promise.resolve({ exitCode: hit.code || 0 }), collected: { stdout: mk(hit.stdout, hit.truncated), stderr: mk(hit.stderr) }, terminate() { handle.terminated = true } }; if (req.stdio && req.stdio.stdin === 'pipe') { const chunks: Buffer[] = []; const stdin = { chunks: chunks, write(chunk) { if (hit.stdinMode === 'epipe') { const e: any = new Error('write EPIPE'); e.code = 'EPIPE'; throw e } chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return true }, end() {}, on() {} }; handle.stdin = stdin; lastStdin = stdin } return handle } const r = spawnSync(req.argv[0], req.argv.slice(1), { cwd: req.cwd, encoding: 'buffer', windowsHide: true, maxBuffer: 1 << 26 }); const mk2 = (b) => ({ finalize: () => ({ text: (b || Buffer.alloc(0)).toString('utf8'), truncated: false }) }); return { done: Promise.resolve({ exitCode: r.status }), collected: { stdout: mk2(r.stdout), stderr: mk2(r.stderr) }, terminate() {} } } },
    timer: { timeout: (ms) => { timerCalls.push(ms); return new Promise((r) => setTimeout(r, ms)) } },
    fs: { stat: async (p) => await fs.promises.stat(p), lstat: async (p) => await fs.promises.lstat(p), exists: async (p) => { try { await fs.promises.access(p); return true } catch (e) { return false } } },
    getPlatform: async () => ({ resolveExecutable: async (n) => (n === 'git' ? 'git' : null) }),
    DEFAULT_CWD: ROOT, TIMEOUT_MS: 30000, gate: { noteOutbound() {} }, logCtx: { fire(level, event, fields) { logs.push({ level, event, fields }) } },
    now: () => clock.t,
  }
  return vcMod.createVersionControl(deps)
}
// 固定前缀的最后一项是 i18n.logOutputEncoding=UTF-8：切在它之后才是真正的子命令（照 verify-version-control-host 的同一口径）。
const after = (argv: string[]): string[] => { const i = argv.indexOf('i18n.logOutputEncoding=UTF-8'); return i < 0 ? argv : argv.slice(i + 1) }
const writeSpawns = (): string[][] => spawns.filter((a) => ['add', 'reset', 'commit', 'pull', 'push'].indexOf(after(a)[0]) >= 0)
let vcMod: any = null
async function main(): Promise<void> {
  console.log('写操作那一族门禁（#841：票据门 / argv / 起进程 / 回包 / 话术 / 同一出口 / 日志）')
  vcMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const reasons = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'write-reasons.js')).href)
  const cmds = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'commands.js')).href)

  // A 票据门：四种失效都必须拒绝且零写命令
  console.log('A 票据门（真仓库）')
  const rA = mkRepo('a')
  const vcA = makeVc()
  const pre = await vcA.handleGitWriteCheck({ cwd: rA, op: 'commit', message: '标题' })
  check(pre.ok === true && pre.ticket && pre.ticket.id, 'A0 预检拿到票据')
  const headBefore = git(rA, ['rev-parse', 'HEAD']).out
  const n1 = spawns.length
  const a1 = await vcA.handleGitCommit({ cwd: rA, message: '标题', ticketId: 'NOSUCHTICKET' })
  check(a1.ok === false && a1.error.reason === 'ticket-missing' && spawns.length === n1, 'A1 伪造票：ticket-missing 且一个进程都没起（纯判定先行）')
  clock.t = pre.ticket.expiresAtMs + 1
  const n2 = spawns.length
  const a2 = await vcA.handleGitCommit({ cwd: rA, message: '标题', ticketId: pre.ticket.id })
  check(a2.ok === false && a2.error.reason === 'ticket-expired' && spawns.length === n2, 'A2 过期票：ticket-expired 且一个进程都没起')
  clock.t = 1000
  const preCommitA = await vcA.handleGitWriteCheck({ cwd: rA, op: 'commit', message: '标题' })
  const n5 = spawns.length
  const a5 = await vcA.handleGitPull({ cwd: rA, ticketId: preCommitA.ticket.id })
  check(a5.ok === false && a5.error.reason === 'ticket-op-mismatch' && spawns.length === n5, 'A5 换动作（commit 的票拿去 pull）：ticket-op-mismatch 且零进程')
  const rA6 = mkRepo('a6')
  // 同一个实例、换 cwd（用户换工作区的真实形态）：票在表里，但 repoRoot 对不上 → stale-repo。
  const n6 = spawns.length
  const a6 = await vcA.handleGitCommit({ cwd: rA6, message: '标题', ticketId: preCommitA.ticket.id })
  check(a6.ok === false && a6.error.reason === 'stale-repo' && writeSpawns().length === 0, 'A6 换仓库（A 的票在 B 上用）：stale-repo 且零写命令')
  const expectDeny = (r, reason) => r && r.ok === false && r.error && r.error.reason === reason
  check(expectDeny(a1, 'ticket-missing') === true && expectDeny({ ok: true, committed: true }, 'ticket-missing') === false, 'A7 反证装置自检：把「放行」的坏回包喂给同一套判据必须判红')
  const pre2 = await vcA.handleGitWriteCheck({ cwd: rA, op: 'commit', message: '标题' })
  fs.writeFileSync(path.join(rA, 'b.txt'), 'b\n'); git(rA, ['add', 'b.txt'])
  const a4 = await vcA.handleGitCommit({ cwd: rA, message: '标题', ticketId: pre2.ticket.id })
  check(a4.ok === false && a4.error.reason === 'stale-index' && writeSpawns().length === 0 && git(rA, ['rev-parse', 'HEAD']).out === headBefore, 'A4 确认后索引变了：stale-index 且零写命令、HEAD 不动')
  const pre3 = await vcA.handleGitWriteCheck({ cwd: rA, op: 'commit', message: '标题' })
  git(rA, ['commit', '-q', '--no-verify', '-m', '别的进程提交的'])
  const a3 = await vcA.handleGitCommit({ cwd: rA, message: '标题', ticketId: pre3.ticket.id })
  check(a3.ok === false && a3.error.reason === 'stale-head' && writeSpawns().length === 0, 'A3 确认后 HEAD 漂了：stale-head 且零写命令')

  // B argv
  console.log('B 写路径 argv')
  const rB = mkRepo('b')
  const vcB = makeVc()
  await vcB.handleGitStage({ cwd: rB, paths: ['a.txt'] })
  const addArgv = spawns.filter((a) => after(a)[0] === 'add')[0] || []
  check(addArgv.indexOf('--literal-pathspecs') >= 0, 'B1 暂存带 --literal-pathspecs（在固定前缀里）')
  check(addArgv.indexOf('--') > 0 && addArgv[addArgv.indexOf('--') + 1] === 'a.txt', 'B2 路径排在 -- 之后且是独立元素')
  const rU = mkRepo('u')
  const vcU = makeVc()
  const un = await vcU.handleGitUnstage({ cwd: rU, paths: ['a.txt'] })
  const resetArgv = spawns.filter((a) => after(a)[0] === 'reset')[0] || []
  check(un.ok === true && (un.unstaged || []).join(',') === 'a.txt', 'B2b 撤回暂存成功回 unstaged 清单')
  check(cmds.unstageArgs(['a.txt']).join(' ') === 'reset HEAD -- a.txt', 'B2c 撤回口径是 reset HEAD -- 加路径（版本底线 2.11 用不了 restore）')
  check(resetArgv.indexOf('--literal-pathspecs') >= 0 && resetArgv.indexOf('--') > 0 && resetArgv[resetArgv.indexOf('--') + 1] === 'a.txt', 'B2d 撤回带字面量前缀且路径排在 -- 之后')
  check(git(rU, ['diff', '--cached', '--name-only']).out === '' && git(rU, ['diff', '--name-only']).out === 'a.txt', 'B2e 撤回后暂存区空了、工作区改动还在（真仓库状态变了）')
  const unBad = await vcU.handleGitUnstage({ cwd: rU, paths: [] })
  check(unBad.ok === false && unBad.error.reason === 'bad-paths', 'B2f 空路径当场拒（不起进程）')
  check(cmds.pushArgs({ mode: 'existing', remote: 'origin', branch: 'main', localBranch: 'main' }).join(' ') === 'push --no-follow-tags origin main:main', 'B3 推送是显式 <remote> <local>:<remote> 且关掉跟随标签')
  check(cmds.pushArgs({ mode: 'set-upstream', remote: 'origin', branch: 'main', localBranch: 'main' }).join(' ') === 'push -u --no-follow-tags origin main:main', 'B4 -u 只在 set-upstream 档出现')
  const pp = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'push-plan.js')).href)
  const t1 = pp.pushPlanOf({ branch: 'main', upstream: 'origin/main', upstreamGone: false, remotes: ['origin'] })
  check(t1.ok === true && t1.plan.mode === 'existing' && t1.plan.setUpstream === false, 'B7 一档：有上游且远端在 → existing（不带 -u）')
  const t2 = pp.pushPlanOf({ branch: 'feature/x', upstream: null, upstreamGone: false, remotes: ['origin'] })
  check(t2.ok === true && t2.plan.mode === 'set-upstream' && t2.plan.setUpstream === true, 'B8 二档：没有上游 → set-upstream')
  const t3 = pp.pushPlanOf({ branch: 'main', upstream: 'origin/doomed', upstreamGone: true, remotes: ['origin'] })
  check(t3.ok === true && t3.plan.mode === 'recreate' && t3.plan.remote === 'origin' && t3.plan.branch === 'doomed' && t3.plan.setUpstream === true, 'B9 三档：上游被删 → recreate（目标仍是配置里那个 origin/doomed）')
  const t4 = pp.pushPlanOf({ branch: 'main', upstream: 'my/fork/main', upstreamGone: false, remotes: ['my/fork', 'origin'] })
  check(t4.ok === true && t4.plan.remote === 'my/fork' && t4.plan.branch === 'main', 'B10 斜杠远端：最长前缀匹配（my/fork 不被切成 my）')
  const t5 = pp.pushPlanOf({ branch: 'main', upstream: null, upstreamGone: false, remotes: ['origin', 'upstream'] })
  check(t5.ok === false && t5.reason === 'need-remote-choice' && t5.candidates.length === 2, 'B11 多远端 + 没上游：不替用户挑（need-remote-choice）')
  check(cmds.pushArgs(t3.plan).join(' ') === 'push -u --no-follow-tags origin main:doomed', 'B12 recreate 档 argv：带 -u、显式 refspec（与既有 argv 断言不冲突）')
  let threw = false
  try { cmds.pushArgs({ mode: 'existing', remote: 'origin', branch: '+wip', localBranch: '+wip' }) } catch (e) { threw = true }
  check(threw === true, 'B5 反证：refspec 以 + 开头（会被 git 当强推）必须当场抛错')
  check(cmds.BRANCH_PATTERN.test('+wip') === false && cmds.BRANCH_PATTERN.test('feature/x') === true, 'B6 分支名正则：拒前导 +，允许斜杠')

  // C 起进程纪律
  console.log('C 起进程纪律')
  const rC = mkRepo('c')
  const vcC = makeVc()
  check(writeSpawns().length === 0, 'C1 光装配不起写命令')
  await vcC.handleGitWriteCheck({ cwd: rC, op: 'commit', message: '标题' })
  check(writeSpawns().length === 0, 'C2 预检只跑只读命令')

  // D 回包
  console.log('D 回包带判定依据、写后必重读')
  check(pre.decision && typeof pre.decision.verdict === 'string' && Array.isArray(pre.decision.reasons), 'D1 预检带 decision{verdict,reasons}')
  const rD = mkRepo('d')
  const vcD = makeVc()
  const preD = await vcD.handleGitWriteCheck({ cwd: rD, op: 'commit', message: '标题' })
  const revBefore = spawns.filter((a) => after(a)[0] === 'rev-parse').length
  const cm = await vcD.handleGitCommit({ cwd: rD, message: '标题', ticketId: preD.ticket.id })
  check(cm.ok === true && cm.committed === true && cm.headBefore !== cm.headAfter, 'D2 提交成功：headBefore/headAfter 不同（真提交进去了）', JSON.stringify(cm).slice(0, 160))
  check(spawns.filter((a) => after(a)[0] === 'rev-parse').length > revBefore, 'D3 执行后重量了一次 HEAD')

  // E 话术与归类（纯函数，含 F1 反证）
  console.log('E 失败面话术与归类')
  check(reasons.writeHintFor('non-fast-forward').length > 8 && reasons.writeHintFor('conflict').length > 8 && reasons.writeHintFor('unknown-write-failure').length > 8, 'E1 三条话术都在')
  check(reasons.classifyWriteFailure('pull', 1, 'fatal: Not possible to fast-forward, aborting.') === 'non-fast-forward', 'E2 反证：真「不能快进」文本 → non-fast-forward（F1 那条缺陷的回归）')
  check(reasons.classifyWriteFailure('push', 1, 'remote: error: pre-receive hook declined\n! [remote rejected] main -> main (pre-receive hook declined)') === 'rejected-by-server', 'E3 服务端拒绝 → rejected-by-server（不许说成 non-fast-forward）')
  check(reasons.classifyWriteFailure('push', 1, 'fatal: Authentication failed for https://x/') === 'auth-failed', 'E4 认证失败 → auth-failed')
  check(reasons.classifyWriteFailure('commit', 1, 'pre-commit hook exited with code 1') === 'hooks-failed', 'E5 钩子拒绝 → hooks-failed')
  check(reasons.classifyWriteFailure('commit', 1, 'unrelated text with hook-ish words') === 'unknown-write-failure', 'E6 反证：词表收紧，不是钩子不许说成钩子')
  check(reasons.messageProblem('') === 'empty-message' && reasons.messageProblem('x'.repeat(201)) === 'message-too-long' && reasons.messageProblem('正常标题') === null, 'E7 提交信息轻校验三档')
  check(reasons.pathsProblem(['-x.txt']) === 'bad-paths' && reasons.pathsProblem([':(exclude)*.txt']) === 'bad-paths' && reasons.pathsProblem(['ok.txt']) === null, 'E8 路径形状：前导 - 与 pathspec 魔法都拒')
  check(reasons.idShapeProblem('abc-123') === null && reasons.idShapeProblem('a\u0000b') === 'ticket-missing' && reasons.idShapeProblem('x'.repeat(65)) === 'ticket-missing', 'E9 票据 id 形状')
  // E10/E11 i-t-a 真机字节（2026-10-04 真机采）：i-t-a 是「1 .A … 000000 …」（XY=.A 且索引无 blob），
  // 普通暂存是「1 M. N... 100644 …」。曾经把 sub 字段 N... 当判据 → 每条普通记录都被误判成 i-t-a。
  const ticketMod = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'write-ticket.js')).href)
  const ITA = '1 .A N... 000000 000000 100644 ' + '0'.repeat(40) + ' ' + '0'.repeat(40) + ' n.txt\u0000'
  const NORMAL = '1 M. N... 100644 100644 100644 ' + 'a'.repeat(40) + ' ' + 'a'.repeat(40) + ' a.txt\u0000'
  check(ticketMod.hasIntentToAdd(ITA) === true && ticketMod.hasIntentToAdd(NORMAL) === false, 'E10 i-t-a 真机字节：i-t-a 判真、普通暂存判假（回归）')
  check(ticketMod.hasIntentToAdd(NORMAL + ITA) === true, 'E11 混合清单里只要有 i-t-a 就判真')

  // F 同一进程出口 + 看门狗白名单
  console.log('F 同一出口、请求白名单')
  const wsrc = fs.readFileSync(path.join(ROOT, 'src', 'host', 'versionControlWrite.ts'), 'utf8')
  check(!/child_process|spawnSync|execSync/.test(wsrc), 'F1 写层不自己起进程（走注入的共享出口）')
  const rF = mkRepo('f')
  const vcF = makeVc()
  await vcF.handleGitStage({ cwd: rF, paths: ['a.txt'], stallMs: 2500, junk: 'x', progress: true })
  check(spawns.every((a) => a.indexOf('stallMs') < 0 && a.indexOf('junk') < 0), 'F2 客户端乱传 stallMs/未知字段进不了 argv')
  // 真风险面是 runGit 的 opts.stallMs（看门狗），不是 argv：看门狗每 tick 调 timer.timeout(tickOf(stallMs))，
  // stallMs=2500 → tick = max(200, min(1000, 2500/4)) = 625。这一跑里没有 625 的定时器调用 = 看门狗没开。
  const watchdogTick = 625
  const noWatchdog = (calls) => calls.indexOf(watchdogTick) < 0
  check(noWatchdog(timerCalls), 'F3 反证：请求里带 stallMs=2500 时看门狗仍不开（timer 里没有 tick=625）', JSON.stringify(timerCalls))
  check(noWatchdog([200, watchdogTick, 300]) === false, 'F3b 反证装置自检：喂一份含 625 的定时器序列必须判红')

  // G 日志
  console.log('G 日志落点')
  const rG = mkRepo('g')
  const vcG = makeVc()
  const preG = await vcG.handleGitWriteCheck({ cwd: rG, op: 'commit', message: '标题' })
  check(logs.some((l) => l.event === 'host.call' && l.fields.method === 'wf.gitWriteCheck'), 'G1 预检成功落 host.call')
  const bad = await vcG.handleGitCommit({ cwd: rG, message: '标题', ticketId: 'NOSUCHTICKET' })
  const fl = logs.filter((l) => l.event === 'host.call.fail')[0]
  check(bad.ok === false && fl && fl.fields.method === 'wf.gitCommit' && fl.fields.errorKind === 'args', 'G2 失败落 host.call.fail 且带 errorKind（实得 ' + (fl && fl.fields.errorKind) + '）')
  check(logs.every((l) => ['git.exec', 'git.exec.fail', 'host.call', 'host.call.fail'].indexOf(l.event) >= 0), 'G3 只出现既有四个事件')

  // H 执行层补齐（#1741）：固定前缀、必失败编辑器、子命令扫描、stdin 默认值、日志字段、截断、超时、起进程失败。
  // 断言值都独立取自「要守的那件事」本身（前置开关名、环境变量约定、上限字节数），不复述实现里的常量名。
  console.log('H 执行层补齐（固定前缀 / 编辑器 / stdin / 日志 / 截断 / 超时）')
  const fp = cmds.fixedPrefix()
  check(fp[0] === '--no-pager' && fp.indexOf('--no-pager') >= 0, 'H1 固定前缀第一项是 --no-pager：输出不经过分页器，读命令不会挂住等翻页')
  check(cmds.subcommandOf(['-C', '/x', '--no-pager', '-c', 'a=b', 'commit', '-m', 't']) === 'commit' && cmds.subcommandOf(['-C']) === '', 'H2 子命令扫描跳过带值的全局选项（-C/-c），只认真正的子命令；没有子命令回空串')
  check(cmds.FAILING_EDITOR === 'false', 'H3 GIT_EDITOR 指向必定失败的命令 false（面板没覆盖成功时 git 直接失败，不弹编辑器、不挂住）')
  const rH = mkRepo('h')
  const vcH = makeVc()
  await vcH.handleGitStage({ cwd: rH, paths: ['a.txt'] })
  check(requests.length > 0 && requests.every((q) => q.env && q.env.GIT_EDITOR === 'false'), 'H4 每一次 git 调用都注入 GIT_EDITOR=false（读与写同一条出口）')
  check(requests.every((q) => q.stdio && q.stdio.stdin === 'ignore'), 'H5 stdin 默认 ignore：除 fast-import 那一个窄例外，一律不开管道')
  const addReq = requests.filter((q) => after(q.argv)[0] === 'add')[0] || { argv: [] }
  const addExec = logs.filter((l) => l.event === 'git.exec' && l.fields.cmd === 'add')[0]
  check(!!addExec && addExec.fields.argc === addReq.argv.length - 1 && typeof addExec.fields.stdoutBytes === 'number' && typeof addExec.fields.truncated === 'boolean', 'H6 git.exec 补齐命令名 / 参数个数 / 输出长度 / 截断标记')
  // 截断由传输层 maxBytes 执行、宿主如实透传；这里同时断言上限真的传下去了、截断标记真的上来了。
  const vcTr = makeVc((argv) => argv.indexOf('status') >= 0 ? { code: 0, stdout: 'x'.repeat(20), truncated: true } : null)
  const tr = await vcTr.runGitCommand('git', rH, ['-C', rH, '--no-pager', 'status', '--porcelain=v2'], { stdoutLimit: 8 })
  const trReq = requests[0] || { stdio: {} }
  const trLog = logs.filter((l) => l.event === 'git.exec' && l.fields.cmd === 'status')[0]
  check(tr && tr.kind === 'ok' && tr.truncated === true && trReq.stdio.stdout.maxBytes === 8 && !!trLog && trLog.fields.truncated === true && trLog.fields.stdoutBytes === 20, 'H7 stdout 上限真的传给传输层（maxBytes=8），超限时回包与日志都带 truncated=true')
  // 超时：进程一直不回话 → timer 到点、杀进程、给明确失败（不是挂住）；失败行带 errorKind/timeoutMs/cmd。
  const vcTo = makeVc((argv) => argv.indexOf('status') >= 0 ? { pending: true } : null)
  const to = await vcTo.runGitCommand('git', rH, ['-C', rH, '--no-pager', 'status'], { timeoutMs: 40 })
  const toFail = logs.filter((l) => l.event === 'git.exec.fail')[0]
  check(to && to.kind === 'timeout' && to.timeoutMs === 40 && !!toFail && toFail.fields.errorKind === 'timeout' && toFail.fields.cmd === 'status' && toFail.fields.timeoutMs === 40 && logs.filter((l) => l.event === 'git.exec').length === 0, 'H8 超时回明确失败（kind=timeout），git.exec.fail 带 errorKind/cmd/timeoutMs，且不假装跑成功')
  // 起进程失败：同样落到 git.exec.fail，分类 errorKind=spawn，错误只记散列。
  const vcSp = makeVc(() => ({ throwOnSpawn: true }))
  const sp = await vcSp.runGitCommand('git', rH, ['-C', rH, '--no-pager', 'status'])
  const spFail = logs.filter((l) => l.event === 'git.exec.fail')[0]
  check(sp && sp.kind === 'spawn-failed' && !!spFail && spFail.fields.errorKind === 'spawn' && typeof spFail.fields.errorHash === 'string' && spFail.fields.errorHash.length === 8, 'H9 起进程失败回 spawn-failed，git.exec.fail 带 errorKind=spawn 与 errorHash（只记散列）')
  // 默认 stdout 上限：8MB（本次补齐的既有上限，独立取自「上限应为 8MB」这一口径）。
  const vcCap = makeVc()
  await vcCap.runGitCommand('git', rH, ['-C', rH, '--no-pager', 'status'])
  check((requests[0] || { stdio: {} }).stdio.stdout.maxBytes === 8 * 1024 * 1024, 'H10 不传 stdoutLimit 时默认上限是 8MB')

  // I 提交页域 2（#1743）：八条提交能力共用一份计划真源，危险动作靠 planDigest 绑票，失败分类不落 unknown。
  console.log('I 提交页八条能力（计划绑定 / 危险动作 / 失败分类）')
  const rI = mkRepo('i')
  const vcI = makeVc()
  const iPlan = { mode: 'staged', target: '', skipHooks: false, sign: false, signoff: false }
  const iCheck = await vcI.handleGitWriteCheck({ cwd: rI, op: 'commit', message: '页 2.1 标题', plan: iPlan })
  check(iCheck.ok === true && iCheck.plan && iCheck.plan.mode === 'staged' && iCheck.ticket && iCheck.ticket.op === 'commit', 'I1 预检收下提交计划并回一张 commit 票（计划与票据一起回包）')
  const iTicketFull = (await vcI.writeTickets()).get(iCheck.ok ? iCheck.ticket.id : 'x') || {}
  check(iCheck.ok === true && !!iTicketFull.bindings && !!iTicketFull.bindings.preconditions && /^[0-9a-f]{16}$/.test(String(iTicketFull.bindings.preconditions.planDigest || '')) && !!iTicketFull.target && iTicketFull.target.mode === 'staged', 'I2 提交票绑定计划摘要（planDigest）与计划本体（2.1 的形态写进 target）')
  const iTicket = iCheck.ok ? iCheck.ticket : {}
  // 2.1 正常提交：argv 在固定前缀之后逐元素独立，cwd 钉在票据那个仓库。
  const iWriteSpawns0 = writeSpawns().length
  const iCommit = await vcI.handleGitCommit({ cwd: rI, ticketId: iTicket.id, requestId: 'i-r1', message: '页 2.1 标题', plan: iPlan })
  const iNew = writeSpawns()[iWriteSpawns0] || []
  check(iCommit.ok === true && iCommit.committed === true && iCommit.mode === 'staged', 'I3 2.1 提交成功，回包带形态（staged）与新旧提交号')
  check(after(iNew).join(' ') === 'commit -m 页 2.1 标题' && after(iNew).every((x) => typeof x === 'string'), 'I4 2.1 的 argv 是「commit -m <说明>」三段独立元素（不经 shell 拼接）')
  const iCwdOk = requests.filter((q) => after(q.argv)[0] === 'commit').every((q) => q.cwd === rI)
  check(iCwdOk, 'I5 每一次提交调用的 cwd 都钉在票据那个仓库上')
  // 同一 requestId 重放：不再起第二次 commit 进程，回包还是那一份。
  const iSpawnsBeforeReplay = writeSpawns().length
  const iReplay = await vcI.handleGitCommit({ cwd: rI, ticketId: iTicket.id, requestId: 'i-r1', message: '页 2.1 标题', plan: iPlan })
  check(iReplay.ok === true && iReplay.committed === true && writeSpawns().length === iSpawnsBeforeReplay, 'I6 同一 requestId 重放不重复执行（没有再起 commit 进程，回包与第一次一致）')
  // 预检是 2.1、执行改成 2.3：计划摘要对不上，零写进程、HEAD 不动（绕过确认卡走不通）。
  const rI2 = mkRepo('i2')
  const vcI2 = makeVc()
  const iHead2 = git(rI2, ['rev-parse', 'HEAD']).out
  const iCheck2 = await vcI2.handleGitWriteCheck({ cwd: rI2, op: 'commit', message: '预检 2.1', plan: iPlan })
  const iSwapSpawns0 = writeSpawns().length
  const iSwap = await vcI2.handleGitCommit({ cwd: rI2, ticketId: iCheck2.ok ? iCheck2.ticket.id : 'x', requestId: 'i-r2', message: '执行 2.3', plan: { mode: 'amend', target: '', skipHooks: false, sign: false, signoff: false } })
  check(iSwap.ok === false && iSwap.error && iSwap.error.reason === 'target-changed' && writeSpawns().length === iSwapSpawns0 && git(rI2, ['rev-parse', 'HEAD']).out === iHead2, 'I7 预检 2.1 却按 2.3 执行：planDigest 对不上，拒成 target-changed、零写进程、HEAD 不动（危险动作必须走确认卡）')
  // 危险动作 2.3：仓库没有暂存内容也能提交（只改说明），执行 argv 是 --amend + -m。
  const rI3 = mkRepo('i3')
  git(rI3, ['reset', '-q'])
  const vcI3 = makeVc()
  const iCheck3 = await vcI3.handleGitWriteCheck({ cwd: rI3, op: 'commit', message: '只改说明', plan: { mode: 'amend', target: '', skipHooks: false, sign: false, signoff: false } })
  check(iCheck3.ok === true && iCheck3.decision && iCheck3.decision.verdict === 'allow', 'I8 2.3 修订只需改说明：没有暂存内容也放行预检（普通提交这一态会被 nothing-staged 拦住）')
  const iAmendSpawns0 = writeSpawns().length
  const iAmend = await vcI3.handleGitCommit({ cwd: rI3, ticketId: iCheck3.ok ? iCheck3.ticket.id : 'x', requestId: 'i-r3', message: '只改说明', plan: { mode: 'amend', target: '', skipHooks: false, sign: false, signoff: false } })
  const iAmendArgv = after(writeSpawns()[iAmendSpawns0] || [])
  check(iAmend.ok === true && iAmendArgv.join(' ') === 'commit --amend -m 只改说明', 'I9 2.3 的 argv 是「commit --amend -m <说明>」（修订上一条提交）')
  // 危险动作 2.4：目标不存在时预检直接拒、零写进程；目标存在时 argv 是 --fixup=<oid>。
  const rI4 = mkRepo('i4')
  const vcI4 = makeVc()
  const iFixBad = await vcI4.handleGitWriteCheck({ cwd: rI4, op: 'commit', message: '吸收', plan: { mode: 'fixup', target: 'deadbeef', skipHooks: false, sign: false, signoff: false } })
  check(iFixBad.ok === false && iFixBad.error && iFixBad.error.reason === 'bad-commit-target' && writeSpawns().length === 0, 'I10 2.4 找不到可吸收目标时预检就拒（bad-commit-target），零写进程')
  const iFixMissing = await vcI4.handleGitWriteCheck({ cwd: rI4, op: 'commit', message: '吸收', plan: { mode: 'fixup', target: '', skipHooks: false, sign: false, signoff: false } })
  check(iFixMissing.ok === false && iFixMissing.error && iFixMissing.error.reason === 'need-commit-target', 'I11 2.4 没给目标时拒成 need-commit-target（按钮该禁用的那一档）')
  const iTargetOid = git(rI4, ['rev-parse', 'HEAD']).out
  const iFixPlan = { mode: 'fixup', target: iTargetOid, skipHooks: false, sign: false, signoff: false }
  const iFixCheck = await vcI4.handleGitWriteCheck({ cwd: rI4, op: 'commit', message: '吸收', plan: iFixPlan })
  const iFixSpawns0 = writeSpawns().length
  const iFix = await vcI4.handleGitCommit({ cwd: rI4, ticketId: iFixCheck.ok ? iFixCheck.ticket.id : 'x', requestId: 'i-r4', message: '', plan: iFixPlan })
  const iFixArgv = after(writeSpawns()[iFixSpawns0] || [])
  check(iFix.ok === true && iFixArgv.join(' ') === 'commit --fixup=' + iTargetOid, 'I12 2.4 的 fixup argv 是「commit --fixup=<目标提交>」（说明由 git 抄目标提交）')
  // 2.5 跳过钩子的 argv 是 --no-verify；2.6 追加签名行是 -s（与 -S 签名提交分开）。
  const rI5 = mkRepo('i5')
  const vcI5 = makeVc()
  const iSkipPlan = { mode: 'staged', target: '', skipHooks: true, sign: false, signoff: false }
  const iSkipCheck = await vcI5.handleGitWriteCheck({ cwd: rI5, op: 'commit', message: '跳过钩子', plan: iSkipPlan })
  const iSkipSpawns0 = writeSpawns().length
  const iSkip = await vcI5.handleGitCommit({ cwd: rI5, ticketId: iSkipCheck.ok ? iSkipCheck.ticket.id : 'x', requestId: 'i-r5', message: '跳过钩子', plan: iSkipPlan })
  const iSkipArgv = after(writeSpawns()[iSkipSpawns0] || [])
  check(iSkip.ok === true && iSkip.skipHooks === true && iSkipArgv.join(' ') === 'commit --no-verify -m 跳过钩子', 'I13 2.5 跳过钩子单独勾选：argv 只多 --no-verify，不给别的提交加默认值')
  const rI6 = mkRepo('i6')
  const vcI6 = makeVc()
  const iSignPlan = { mode: 'staged', target: '', skipHooks: false, sign: false, signoff: true }
  const iSignCheck = await vcI6.handleGitWriteCheck({ cwd: rI6, op: 'commit', message: '追加签名行', plan: iSignPlan })
  const iSignSpawns0 = writeSpawns().length
  const iSign = await vcI6.handleGitCommit({ cwd: rI6, ticketId: iSignCheck.ok ? iSignCheck.ticket.id : 'x', requestId: 'i-r6', message: '追加签名行', plan: iSignPlan })
  const iSignArgv = after(writeSpawns()[iSignSpawns0] || [])
  check(iSign.ok === true && iSign.sign === false && iSign.signoff === true && iSignArgv.join(' ') === 'commit -s -m 追加签名行', 'I14 2.6 追加签名行只写尾部行（argv 是 -s），与签名提交（-S）是两个独立开关')
  // 失败分类与信封：签名失败归到 signing-failed（不落 unknown-write-failure），信封固定四键。
  const rI7 = mkRepo('i7')
  const vcI7 = makeVc()
  const iFailPlan = { mode: 'staged', target: '', skipHooks: false, sign: true, signoff: false }
  const iFailCheck = await vcI7.handleGitWriteCheck({ cwd: rI7, op: 'commit', message: '签名提交', plan: iFailPlan })
  const iFail = await vcI7.handleGitCommit({ cwd: rI7, ticketId: iFailCheck.ok ? iFailCheck.ticket.id : 'x', requestId: 'i-r7', message: '签名提交', plan: iFailPlan })
  check(iFail.ok === false && iFail.error && iFail.error.reason === 'signing-failed' && Object.keys(iFail.error).sort().join(',') === 'hint,kind,message,reason', 'I15 2.6 签名失败归到 signing-failed（不是 unknown-write-failure），失败信封固定 {kind,reason,message,hint}')
  console.log(failed ? '\n存在失败 — verify-841-write-phones 未通过' : '\n全部通过 — 写操作那一族门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
