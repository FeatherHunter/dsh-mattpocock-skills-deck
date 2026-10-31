// verify-841-write-phones.ts —— 写操作那一族门禁（#841 第二段）：A–N 十四组，每组带反证；J 组是 #1752 工作树页的写通道，K 组是 #1755 同步域、L 组是 #1743 提交页、M 组是 #1747 冲突向导，N 组是 #1757 子模块页的写与任务通道。
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
    subprocess: { spawn(req) { spawns.push(req.argv.slice()); requests.push({ argv: req.argv.slice(), cwd: req.cwd, stdio: req.stdio, env: req.env }); const hit = route ? route(req.argv, req) : null; if (hit && hit.throwOnSpawn) throw new Error('spawn ENOENT'); if (hit) { const mk = (t, trunc) => ({ finalize: () => ({ text: String(t || ''), truncated: trunc === true }) }); const handle: any = { done: hit.pending ? new Promise(() => {}) : Promise.resolve({ exitCode: hit.code || 0 }), collected: { stdout: mk(hit.stdout, hit.truncated), stderr: mk(hit.stderr) }, terminate() { handle.terminated = true } }; if (req.stdio && req.stdio.stdin === 'pipe') { const chunks: Buffer[] = []; const stdin = { chunks: chunks, write(chunk) { if (hit.stdinMode === 'epipe') { const e: any = new Error('write EPIPE'); e.code = 'EPIPE'; throw e } chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return true }, end() {}, on() {} }; handle.stdin = stdin; lastStdin = stdin } return handle } // #1747：真跑那条路也必须把请求带的环境变量交给子进程 —— 生产里每次 git 调用都注入 GIT_EDITOR（默认必失败命令，
    //   继续合并那一类显式覆盖成 true）；夹具如果只记请求、不真传 env，子进程会拿进程自己的环境去开编辑器，
    //   在无终端的门禁里就挂住。undefined 是墓碑（从继承环境删掉），spawnSync 不收 undefined，先清掉。
    const childEnv: any = {}
    const merged: any = Object.assign({}, process.env, req.env || {})
    Object.keys(merged).forEach((k) => { if (merged[k] !== undefined) childEnv[k] = String(merged[k]) })
    const r = spawnSync(req.argv[0], req.argv.slice(1), { cwd: req.cwd, env: childEnv, encoding: 'buffer', windowsHide: true, maxBuffer: 1 << 26 }); const mk2 = (b) => ({ finalize: () => ({ text: (b || Buffer.alloc(0)).toString('utf8'), truncated: false }) }); return { done: Promise.resolve({ exitCode: r.status }), collected: { stdout: mk2(r.stdout), stderr: mk2(r.stderr) }, terminate() {} } } },
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
// #1752：工作树写通道的「真正动东西」子命令白名单；预检与重验读出来的 list / status / rev-parse 不算写。
const WT_WRITE_SUBS = ['add', 'remove', 'prune', 'lock', 'unlock', 'move']
const worktreeWrites = (): string[][] => spawns.filter((a) => {
  const c = after(a)
  return (c[0] === 'worktree' && WT_WRITE_SUBS.indexOf(c[1]) >= 0) || (c[0] === 'sparse-checkout' && c[1] === 'set')
})
// #1752：失败判据只认失败信封的 error.kind；拿它去判一份放行回包必须为假（反证装置自检用）。
const denyIs = (r: any, kind: string): boolean => !!(r && r.ok === false && r.error && r.error.kind === kind)
// #1752：造一棵真工作树（真 git，不经垫片，所以不计入 spawns），供写通道断言用。
// 返回值取 git 清单里报的路径，而不是 mkdtemp 给的路径：本机 git 会把 D:\Temp 规范成 D:/temp，
// 而共享层判等只归一盘符大小写（其余按原样比，免得把两棵不同的树认成一棵），两边必须用同一份写法。
function mkWorktree(base: string, tag: string, branch: string): string {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws841-wt-' + tag + '-'))
  const w = git(base, ['worktree', 'add', '-q', '-b', branch, wt])
  if (w.code !== 0) throw new Error('造工作树失败：' + w.err)
  const paths = git(base, ['worktree', 'list', '--porcelain']).out.split('\n')
    .filter((l) => l.indexOf('worktree ') === 0).map((l) => l.slice('worktree '.length).trim())
  return paths[paths.length - 1] || wt
}
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

  // J 远端写动作（#1754 T18，域 8 的 8.2 / 8.3）：同一族出口、固定 argv、真仓库读得回、日志不新开事件名
  console.log('J 远端写动作（真仓库）')
  const jRepo = mkRepo('j')
  const vcJRemote = makeVc()
  const j1 = await vcJRemote.handleGitRemoteAdd({ cwd: jRepo, name: 'origin', url: 'https://example.com/acme/repo.git' })
  const jRemoteLines = git(jRepo, ['remote', '-v']).out
  check(j1 && j1.ok === true && jRemoteLines.indexOf('origin') >= 0, 'J1 登记远端走宿主电话：真仓库里读得回这个远端（不是只把回包说成成功）')
  const jAddSpawn = spawns.filter((q) => after(q).slice(0, 2).join(',') === 'remote,add')[0] || []
  check(after(jAddSpawn).slice(0, 5).join(',') === 'remote,add,--,origin,https://example.com/acme/repo.git', 'J2 登记远端的 argv 固定为 remote add -- <名字> <地址>，名字与地址各自独立一项')
  const jAddExec = logs.filter((l) => l.event === 'git.exec' && l.fields.cmd === 'remote')[0]
  check(!!jAddExec && typeof jAddExec.fields.argc === 'number' && logs.every((l) => ['git.exec', 'git.exec.fail', 'host.call'].indexOf(l.event) >= 0), 'J3 远端写动作只落既有的 git.exec（cmd=remote），不新开事件名')
  const j2 = await vcJRemote.handleGitRemoteRename({ cwd: jRepo, from: 'origin', to: 'upstream' })
  const jRenSpawn = spawns.filter((q) => after(q).slice(0, 2).join(',') === 'remote,rename')[0] || []
  check(j2 && j2.ok === true && git(jRepo, ['remote']).out === 'upstream' && after(jRenSpawn).slice(2).join(',') === '--,origin,upstream', 'J4 改名远端：argv 为 remote rename <旧名> <新名>，真仓库里的名字跟着变')
  const j3 = await vcJRemote.handleGitRemoteSetUrl({ cwd: jRepo, name: 'upstream', url: 'git@example.com:acme/other.git' })
  const jUrlSpawn = spawns.filter((q) => after(q).slice(0, 2).join(',') === 'remote,set-url')[0] || []
  check(j3 && j3.ok === true && git(jRepo, ['remote', 'get-url', 'upstream']).out === 'git@example.com:acme/other.git' && after(jUrlSpawn).slice(2).join(',') === '--,upstream,git@example.com:acme/other.git', 'J5 改地址：argv 为 remote set-url <名字> <地址>，真仓库里的地址跟着变')
  const j4 = await vcJRemote.handleGitRemoteRemove({ cwd: jRepo, name: 'upstream' })
  const jDelSpawn = spawns.filter((q) => after(q).slice(0, 2).join(',') === 'remote,remove')[0] || []
  check(j4 && j4.ok === true && git(jRepo, ['remote']).out === '' && after(jDelSpawn).slice(2).join(',') === '--,upstream', 'J6 删除远端：argv 为 remote remove <名字>，真仓库里这条远端没了')
  const jBad = await vcJRemote.handleGitRemoteAdd({ cwd: jRepo, name: '--upload-pack=evil', url: 'https://example.com/x.git' })
  check(jBad && jBad.ok === false && jBad.error && jBad.error.kind === 'args' && spawns.filter((q) => after(q).slice(0, 2).join(',') === 'remote,add').length === 1, 'J7 名字非法（前导减号）：零进程直接拒绝，注入串进不了 argv')
  const jBadUrl = await vcJRemote.handleGitRemoteSetUrl({ cwd: jRepo, name: 'origin', url: ' https://example.com/x.git ' })
  check(jBadUrl && jBadUrl.ok === false && jBadUrl.error && jBadUrl.error.kind === 'args', 'J8 地址带空白：零进程直接拒绝（不做 trim 之后照跑）')
  const jJudged = (r) => !!(r && r.ok === true && r.action && typeof r.ms === 'number' && typeof r.n === 'number')
  check(jJudged(j1) === true && jJudged(jBad) === false && jJudged({ ok: false, action: 'add', ms: 1, n: 1 }) === false, 'J9 反证装置自检：把失败回包喂给「写动作成功」判据必须判红')
  // I 改动页两条电话（#1742）：13 条动作走同一条「预检发票 → 执行复核」通道，票表只给门禁与测试读。
  console.log('I 改动页电话（#1742）')
  const vcI = makeVc()
  check(typeof vcI.handleGitChangesCheck === 'function' && typeof vcI.handleGitChangesWrite === 'function', 'I1 改动页预检与执行两条电话都挂在同一个宿主对象上')
  check(typeof vcI.changesTickets === 'function', 'I2 票表读取口只给门禁与测试，不注册成电话')
  const zeroBefore = spawns.length
  const iBad = await vcI.handleGitChangesCheck({ cwd: '', op: 'stage-file' })
  check(iBad.ok === false && iBad.error && iBad.error.reason === 'bad-target' && spawns.length === zeroBefore, 'I3 预检入口先判参数形状：缺 cwd 直接拒绝且零进程')
  const iWriteBad = await vcI.handleGitChangesWrite({ cwd: '', op: 'stage-file', ticketId: 'nope' })
  check(iWriteBad.ok === false && iWriteBad.error && iWriteBad.error.reason === 'ticket-missing' && spawns.length === zeroBefore, 'I4 执行入口先查票：没有票就零进程拒绝')
  const iTickets = await vcI.changesTickets()
  check(iTickets instanceof Map && iTickets.size === 0, 'I5 还没预检过时改动页票表是空表')

  // J 分支与标签域两条电话（#1746 返工）：预检签 120 秒票 → 凭票执行；三种失效零进程；requestId 去重；目标变了拒做。
  // 这一组守的是「写动作一律先预检、再凭票执行」这条通道在真仓库上的行为；判定与 argv 细节由 verify-1586-branches 守。
  console.log('J 分支与标签电话（#1746）')
  clock.t = 1000
  const branchWriteSpawns = () => spawns.filter((a) => {
    const c = after(a)[0]
    if (c === 'branch' && (after(a)[1] === '--merged' || after(a)[1] === '--no-merged' || after(a)[1] === '-a')) return false
    if (c === 'config' && after(a).some((t) => String(t).indexOf('--get') === 0)) return false
    return ['switch', 'checkout', 'branch', 'tag', 'config'].indexOf(c) >= 0
  })
  const rJB = mkRepo('j')
  git(rJB, ['reset', '-q'])
  const vcJB = makeVc()
  check(typeof vcJB.handleGitBranches === 'function' && typeof vcJB.handleGitBranchCheck === 'function' && typeof vcJB.handleGitBranchWrite === 'function', 'JB1 分支域读 / 预检 / 执行三条电话都挂在同一个宿主对象上')
  const jCheck = await vcJB.handleGitBranchCheck({ cwd: rJB, op: 'create', name: 'feature2' })
  check(jCheck.ok === true && !!jCheck.ticket && jCheck.ticket.expiresAtMs - jCheck.ticket.checkedAtMs === 120000 && branchWriteSpawns().length === 0, 'JB2 预检签票：票有效期 120 秒，签票这一趟不起任何写进程')
  const jBefore = branchWriteSpawns().length
  const jRun = await vcJB.handleGitBranchWrite({ cwd: rJB, ticketId: jCheck.ticket.id, requestId: 'req-j1', op: 'create', name: 'feature2' })
  const jNew = branchWriteSpawns()
  check(jRun.ok === true && jNew.length === jBefore + 1 && jNew[jNew.length - 1].indexOf('feature2') >= 0 && git(rJB, ['branch', '--list', 'feature2']).out !== '', 'JB3 凭票执行：一次写进程，命令里带新分支名，仓库里真的建出了分支')
  const nReplay = spawns.length
  const jbReplay = await vcJB.handleGitBranchWrite({ cwd: rJB, ticketId: jCheck.ticket.id, requestId: 'req-j1', op: 'create', name: 'feature2' })
  check(jbReplay.reused === true && jbReplay.result && jbReplay.result.ok === true && jbReplay.result.command === jRun.command && spawns.length === nReplay, 'JB4 同一 requestId 重放：回同一份结果，不再起进程')
  const nForged = spawns.length
  const jbForged = await vcJB.handleGitBranchWrite({ cwd: rJB, ticketId: 'NOSUCHTICKET', requestId: 'req-j2', op: 'switch', name: 'feature2', confirmed: true })
  check(jbForged.ok === false && jbForged.reason === 'ticket-missing' && spawns.length === nForged, 'JB5 伪造票：ticket-missing 且一个进程都没起（纯判定先行）')
  const tick = await vcJB.handleGitBranchCheck({ cwd: rJB, op: 'switch', name: 'feature2' })
  clock.t = tick.ticket.expiresAtMs + 1
  const nExpired = spawns.length
  const jbExpired = await vcJB.handleGitBranchWrite({ cwd: rJB, ticketId: tick.ticket.id, requestId: 'req-j3', op: 'switch', name: 'feature2', confirmed: true })
  clock.t = 1000
  check(jbExpired.ok === false && jbExpired.reason === 'ticket-expired' && spawns.length === nExpired, 'JB6 过期票：ticket-expired 且一个进程都没起')
  const tick2 = await vcJB.handleGitBranchCheck({ cwd: rJB, op: 'create', name: 'feature3' })
  const nMismatch = spawns.length
  const jMismatch = await vcJB.handleGitBranchWrite({ cwd: rJB, ticketId: tick2.ticket.id, requestId: 'req-j4', op: 'delete', name: 'feature2', force: true, confirmed: true })
  check(jMismatch.ok === false && jMismatch.reason === 'ticket-op-mismatch' && spawns.length === nMismatch, 'JB7 换动作的票（新建的票拿去删分支）：ticket-op-mismatch 且一个进程都没起')
  const nDrift = branchWriteSpawns().length
  const driftTick = await vcJB.handleGitBranchCheck({ cwd: rJB, op: 'switch', name: 'feature2' })
  // 当前就在 feature2 上（JB3 新建并切过去）；再提交一次就把这条分支的 tip 挪了，票里绑的 oid 随之失效。
  fs.writeFileSync(path.join(rJB, 'c.txt'), 'c\n'); git(rJB, ['add', 'c.txt']); git(rJB, ['commit', '-q', '-m', '移动目标'])
  const jDrift = await vcJB.handleGitBranchWrite({ cwd: rJB, ticketId: driftTick.ticket.id, requestId: 'req-j5', op: 'switch', name: 'feature2', confirmed: true })
  check(jDrift.ok === false && jDrift.reason === 'target-changed' && branchWriteSpawns().length === nDrift && git(rJB, ['rev-parse', '--abbrev-ref', 'HEAD']).out === 'feature2', 'JB8 票签完后目标分支被移动：target-changed 零写进程，当前分支没被切走')

  // J 贮藏页两条电话（#1751）：写动作先预检签票、再凭票执行；读动作不签票直接放行。
  // 判据只看「拒绝发生在起进程之前」与「重放不再起进程」，不复述实现里的票据表结构。
  console.log('J 贮藏页电话（#1751）')
  const vcJStash = makeVc()
  check(typeof vcJStash.handleGitStashCheck === 'function' && typeof vcJStash.handleGitStash === 'function', 'J1 贮藏页预检与执行两条电话都挂在同一个宿主对象上')
  const rJStash = mkRepo('j')
  const stashSpawns = (): string[][] => spawns.filter((a) => after(a)[0] === 'stash')
  const stashWrites = (): string[][] => stashSpawns().filter((a) => ['push', 'apply', 'pop', 'drop', 'clear', 'branch', 'store'].indexOf(after(a)[1]) >= 0)
  const jPre = await vcJStash.handleGitStashCheck({ cwd: rJStash, op: 'push', message: '门禁用贮藏' })
  check(jPre.ok === true && !!jPre.ticket && !!jPre.ticket.id && jPre.ticket.expiresAtMs - jPre.ticket.checkedAtMs === 120000, 'J2 预检签票，有效期 120 秒（与改动页同一份中央配置）')
  check(stashWrites().length === 0, 'J3 预检只读：起过的 git 命令里一条写动作都没有')
  const nJStash = spawns.length
  const jNoTicket = await vcJStash.handleGitStash({ cwd: rJStash, op: 'push', message: '门禁用贮藏' })
  const jFake = await vcJStash.handleGitStash({ cwd: rJStash, op: 'push', message: '门禁用贮藏', ticketId: 'NOSUCHTICKET' })
  check(jNoTicket.ok === false && jNoTicket.error.reason === 'ticket-missing' && spawns.length === nJStash, 'J4 不带票：ticket-missing 且一个进程都没起')
  check(jFake.ok === false && jFake.error.reason === 'ticket-missing' && spawns.length === nJStash, 'J5 伪造票：同样 ticket-missing 且零进程')
  const jPre2 = await vcJStash.handleGitStashCheck({ cwd: rJStash, op: 'push', message: '换动作的票' })
  const nJStash2 = spawns.length
  const jWrongOp = await vcJStash.handleGitStash({ cwd: rJStash, op: 'apply', selector: 'stash@{0}', ticketId: jPre2.ticket.id })
  check(jWrongOp.ok === false && jWrongOp.error.reason === 'ticket-op-mismatch' && spawns.length === nJStash2, 'J6 换动作（push 的票拿去 apply）：ticket-op-mismatch 且零进程')
  clock.t = jPre2.ticket.expiresAtMs + 1
  const nJStash3 = spawns.length
  const jExpiredStash = await vcJStash.handleGitStash({ cwd: rJStash, op: 'push', message: '换动作的票', ticketId: jPre2.ticket.id })
  clock.t = 1000
  check(jExpiredStash.ok === false && jExpiredStash.error.reason === 'ticket-expired' && spawns.length === nJStash3, 'J7 过期票：ticket-expired 且零进程')
  const jPre3 = await vcJStash.handleGitStashCheck({ cwd: rJStash, op: 'push', message: '重放一次' })
  const jFirst = await vcJStash.handleGitStash({ cwd: rJStash, op: 'push', message: '重放一次', ticketId: jPre3.ticket.id, requestId: 'req-841-stash-1' })
  const writesAfterFirst = stashWrites().length
  const jReplayStash = await vcJStash.handleGitStash({ cwd: rJStash, op: 'push', message: '重放一次', ticketId: jPre3.ticket.id, requestId: 'req-841-stash-1' })
  check(jFirst.ok === true && jReplayStash.ok === true && JSON.stringify(jReplayStash.entries) === JSON.stringify(jFirst.entries) && stashWrites().length === writesAfterFirst, 'J8 同一个 requestId 重放：回同一份结果且不再起第二条写命令（第一次写了 ' + writesAfterFirst + ' 条）')
  const jPre4 = await vcJStash.handleGitStashCheck({ cwd: rJStash, op: 'drop', selector: jFirst.entries[0].selector })
  git(rJStash, ['stash', 'drop', 'stash@{0}'])
  const jChanged = await vcJStash.handleGitStash({ cwd: rJStash, op: 'drop', selector: jFirst.entries[0].selector, ticketId: jPre4.ticket.id })
  check(jChanged.ok === false && jChanged.error.reason === 'target-changed' && stashWrites().length === writesAfterFirst, 'J9 确认之后目标被别处删掉：target-changed 且零写命令（不猜着删下一条）')
  const jList = await vcJStash.handleGitStash({ cwd: rJStash, op: 'list' })
  check(jList.ok === true && Array.isArray(jList.entries) && jList.entries.length === 0, 'J10 读动作（list）不签票直接放行，界面刷新不被票据流程误伤')
  // J 工作树页两条电话（#1752）：预检开票 → 执行前逐条重验；伪造 / 过期 / 换动作 / 现场变了都必须零写命令。
  console.log('J 工作树页两条电话（#1752）')
  const rJ = mkRepo('j')
  const wtA = mkWorktree(rJ, 'a', 'wt-a')
  const vcJ = makeVc()
  check(typeof vcJ.handleGitWorktreeCheck === 'function' && typeof vcJ.handleGitWorktreeRun === 'function', 'J1 工作树预检与执行两条电话都挂在同一个宿主对象上（本族不占长任务通道）')
  const jLeaf = fs.readFileSync(path.join(ROOT, 'src', 'host', 'versionControlWorktrees.ts'), 'utf8')
  check(jLeaf.indexOf('handleGitTask') < 0 && jLeaf.indexOf('spawnSync') < 0 && jLeaf.indexOf('child_process') < 0, 'J2 工作树叶子不碰长任务电话、不自己起进程（八条都是本地短写，走注入的同一出口）')
  const preLockJ = await vcJ.handleGitWorktreeCheck({ cwd: rJ, op: 'lock', path: wtA, reason: '演示' })
  check(preLockJ.ok === true && preLockJ.decision.decision === 'allow' && preLockJ.ticket && preLockJ.ticket.id && worktreeWrites().length === 0, 'J3 预检锁一棵树：放行、开票，且一条写命令都没起（只跑读命令）')
  const nJ = spawns.length
  const jForged = await vcJ.handleGitWorktreeRun({ cwd: rJ, op: 'lock', path: wtA, reason: '演示', ticketId: 'NOSUCHTICKET', requestId: 'j-req-forged', confirm: true })
  check(denyIs(jForged, 'ticket-missing') && spawns.length === nJ, 'J4 伪造票：ticket-missing 且一个进程都没起（纯判定先行）')
  clock.t = preLockJ.ticket.expiresAtMs + 1
  const nJ2 = spawns.length
  const jExpired = await vcJ.handleGitWorktreeRun({ cwd: rJ, op: 'lock', path: wtA, reason: '演示', ticketId: preLockJ.ticket.id, requestId: 'j-req-expired', confirm: true })
  clock.t = 1000
  check(jExpired.ok === false && (jExpired.error.kind === 'ticket-expired' || jExpired.error.kind === 'ticket-missing') && spawns.length === nJ2, 'J5 过期票：拒绝且零进程（入口先清过期票，实测回 ticket-missing 也算拒绝）')
  const preRemoveJ = await vcJ.handleGitWorktreeCheck({ cwd: rJ, op: 'remove', path: wtA })
  const nJ3 = spawns.length
  const jSwap = await vcJ.handleGitWorktreeRun({ cwd: rJ, op: 'lock', path: wtA, reason: '演示', ticketId: preRemoveJ.ticket.id, requestId: 'j-req-swap', confirm: true })
  check(denyIs(jSwap, 'ticket-op-mismatch') && spawns.length === nJ3, 'J6 换动作（remove 的票拿去 lock）：ticket-op-mismatch 且零进程')
  const preLockJ2 = await vcJ.handleGitWorktreeCheck({ cwd: rJ, op: 'lock', path: wtA, reason: '演示' })
  const nJ4 = spawns.length
  const jNoConfirm = await vcJ.handleGitWorktreeRun({ cwd: rJ, op: 'lock', path: wtA, reason: '演示', ticketId: preLockJ2.ticket.id, requestId: 'j-req-noconfirm' })
  check(denyIs(jNoConfirm, 'confirm-required') && spawns.length === nJ4, 'J7 没带显式确认：confirm-required 且零进程')
  const jLock = await vcJ.handleGitWorktreeRun({ cwd: rJ, op: 'lock', path: wtA, reason: '演示', ticketId: preLockJ2.ticket.id, requestId: 'j-req-lock-ok', confirm: true })
  const lockArgv = worktreeWrites()[0] || []
  check(jLock.ok === true && jLock.result && jLock.result.state === 'done' && jLock.result.n === 1 && worktreeWrites().length === 1 && git(rJ, ['worktree', 'list', '--porcelain']).out.indexOf('locked') >= 0, 'J8 锁一棵树：成功一次只起一条写命令、清单里真出现 locked（结果卡记 1 个对象）')
  check(after(lockArgv)[1] === 'lock' && after(lockArgv).indexOf('--reason') >= 0 && after(lockArgv).indexOf('演示') >= 0 && after(lockArgv).indexOf(wtA) >= 0, 'J9 锁的 argv 是 worktree lock --reason <原因> <路径>（原因是独立参数，不拼字符串）')
  const jReplay = await vcJ.handleGitWorktreeRun({ cwd: rJ, op: 'remove', path: 'NO-SUCH', ticketId: 'NOSUCH', requestId: 'j-req-lock-ok', confirm: true })
  check(JSON.stringify(jReplay) === JSON.stringify(jLock) && worktreeWrites().length === 1, 'J10 同一个请求号重放：回同一份结果、不再起第二条写命令（重复点按钮不会重复动工作树）')
  const preUnlockJ = await vcJ.handleGitWorktreeCheck({ cwd: rJ, op: 'unlock', path: wtA })
  const wtB = mkWorktree(rJ, 'b', 'wt-b')
  const writesJ = worktreeWrites().length
  const jDigest = await vcJ.handleGitWorktreeRun({ cwd: rJ, op: 'unlock', path: wtA, ticketId: preUnlockJ.ticket.id, requestId: 'j-req-digest', confirm: true })
  check(denyIs(jDigest, 'worktrees-changed') && worktreeWrites().length === writesJ, 'J11 票据签完后清单多了一棵树：worktrees-changed 且零写命令（不把旧判断套到新现场）')
  const addPath = path.join(os.tmpdir(), 'dsws841-add-' + process.pid + '-' + Date.now())
  const preAddJ = await vcJ.handleGitWorktreeCheck({ cwd: rJ, op: 'add', path: addPath })
  fs.mkdirSync(addPath)
  const writesJ2 = worktreeWrites().length
  const jTarget = await vcJ.handleGitWorktreeRun({ cwd: rJ, op: 'add', path: addPath, ticketId: preAddJ.ticket.id, requestId: 'j-req-target', confirm: true })
  check(denyIs(jTarget, 'target-changed') && worktreeWrites().length === writesJ2, 'J12 票据签完后目标路径被占：target-changed 且零写命令')
  const preUnlockJ2 = await vcJ.handleGitWorktreeCheck({ cwd: rJ, op: 'unlock', path: wtA })
  const beforeUnlock = worktreeWrites().length
  const jUnlock = await vcJ.handleGitWorktreeRun({ cwd: rJ, op: 'unlock', path: wtA, ticketId: preUnlockJ2.ticket.id, requestId: 'j-req-unlock-ok', confirm: true })
  const unlockArgv = worktreeWrites()[beforeUnlock] || []
  check(jUnlock.ok === true && jUnlock.result.state === 'done' && worktreeWrites().length === beforeUnlock + 1 && after(unlockArgv)[1] === 'unlock' && after(unlockArgv).indexOf(wtA) >= 0 && git(rJ, ['worktree', 'list', '--porcelain']).out.indexOf('locked') < 0, 'J13 解锁同一棵树：成功一次只起预期那一条命令、锁定标记真被摘掉')
  const forceFree = worktreeWrites().every((a) => a.indexOf('--force') < 0 && a.indexOf('-f') < 0 && a.indexOf('-ff') < 0)
  check(forceFree, 'J14 本组所有写命令都不带 --force / -f / -ff（边界：删除脏树与锁定树走先处理再重来的正常路径）')
  check(denyIs({ ok: true, requestId: 'x' }, 'ticket-missing') === false, 'J15 反证装置自检：把放行的回包喂给「拒绝」判据必须判假')


  // M 冲突向导三条电话（#1747 T12）：读 / 预检签票 / 凭票执行。这一组守「合并冲突不误判成失败」、
  //   「选边与继续都要票」以及「没有票、换动作、没确认时零进程」；判定细节与六类冲突分类由 verify-1586-conflicts 守。
  console.log('M 冲突向导电话（#1747）')
  const vcM = makeVc()
  check(typeof vcM.handleGitConflicts === 'function' && typeof vcM.handleGitConflictCheck === 'function' && typeof vcM.handleGitConflictWrite === 'function', 'M1 冲突向导读 / 预检 / 执行三条电话都挂在同一个宿主对象上')
  check(typeof vcM.conflictTickets === 'function', 'M2 冲突票表读取口只给门禁与测试，不注册成电话')
  const rM = mkRepo('k')
  git(rM, ['commit', '-q', '-m', '基线二'])
  git(rM, ['checkout', '-q', '-b', 'side'])
  fs.writeFileSync(path.join(rM, 'a.txt'), 'side\n'); git(rM, ['add', 'a.txt']); git(rM, ['commit', '-q', '-m', 'side 改'])
  git(rM, ['checkout', '-q', 'main'])
  fs.writeFileSync(path.join(rM, 'a.txt'), 'main\n'); git(rM, ['add', 'a.txt']); git(rM, ['commit', '-q', '-m', 'main 改'])
  const mPreview = await vcM.handleGitConflicts({ cwd: rM, op: 'merge-preview', target: 'side' })
  check(mPreview.ok === true && mPreview.clean === false && mPreview.paths.indexOf('a.txt') >= 0, 'M3 预演合并（6.10）：2.38 以上用 merge-tree 真算，干净地报出会冲突且点名 a.txt（有冲突不是命令失败）')
  const conflictWritesM = () => spawns.filter((a) => {
    const c = after(a)
    if (c[0] === 'merge') return true
    if (c[0] === 'checkout' && (c[1] === '--ours' || c[1] === '--theirs')) return true
    if (c[0] === 'add' || c[0] === 'rm') return true
    if (c[0] === 'rebase' || c[0] === 'cherry-pick' || c[0] === 'revert') return false
    return false
  })
  const mPre = await vcM.handleGitConflictCheck({ cwd: rM, op: 'merge', target: 'side' })
  check(mPre.ok === true && !!mPre.ticket && mPre.ticket.expiresAtMs - mPre.ticket.checkedAtMs === 120000 && conflictWritesM().length === 0, 'M4 预检合并：签 120 秒票，签票这一趟一条写命令都没起')
  const mMerge = await vcM.handleGitConflictWrite({ cwd: rM, op: 'merge', target: 'side', ticketId: mPre.ticket.id, requestId: 'req-841-m1', confirmed: true })
  check(mMerge.ok === true && mMerge.conflicted === true && mMerge.state === 'merge' && mMerge.conflictCount === 1, 'M5 合并撞上冲突：回包如实说「有冲突、现在在合并中、1 个冲突文件」，不把它报成 git-failed（Windows 上冲突说明在 stdout）')
  const mList = await vcM.handleGitConflicts({ cwd: rM, op: 'conflict-list' })
  check(mList.ok === true && mList.conflictCount === 1 && mList.conflicts[0].path === 'a.txt' && mList.conflicts[0].kind === 'both-changed', 'M6 冲突清单（6.5）：真仓库里读出 a.txt，分类是双方都改')
  const mMarkers = await vcM.handleGitConflicts({ cwd: rM, op: 'marker-check' })
  check(mMarkers.ok === true && mMarkers.clean === false && mMarkers.worktree.length > 0, 'M7 提交前查残留标记（6.15）：工作区那一半读出残留，没解决的冲突不会被当成干净')
  const nM1 = spawns.length
  const mNoTicket = await vcM.handleGitConflictWrite({ cwd: rM, op: 'take-side', path: 'a.txt', side: 'ours', ticketId: 'NOSUCHTICKET', requestId: 'req-841-m2', confirmed: true })
  check(mNoTicket.ok === false && mNoTicket.error.reason === 'ticket-missing' && spawns.length === nM1, 'M8 伪造票：ticket-missing 且一个进程都没起')
  const mPreSide = await vcM.handleGitConflictCheck({ cwd: rM, op: 'take-side', path: 'a.txt', side: 'ours' })
  const nM2 = spawns.length
  const mSwap = await vcM.handleGitConflictWrite({ cwd: rM, op: 'mark-resolved', path: 'a.txt', ticketId: mPreSide.ticket.id, requestId: 'req-841-m3', confirmed: true })
  check(mSwap.ok === false && mSwap.error.reason === 'ticket-op-mismatch' && spawns.length === nM2, 'M9 换动作（选边的票拿去标记已解决）：ticket-op-mismatch 且零进程')
  const mPreAbort = await vcM.handleGitConflictCheck({ cwd: rM, op: 'op-abort' })
  const nM3 = spawns.length
  const mNoConfirm = await vcM.handleGitConflictWrite({ cwd: rM, op: 'op-abort', ticketId: mPreAbort.ticket.id, requestId: 'req-841-m4' })
  check(mPreAbort.confirmRequired === true && mNoConfirm.ok === false && mNoConfirm.error.reason === 'need-confirm' && spawns.length === nM3, 'M10 中止这类危险动作：预检标出必须确认，没带显式确认就零进程拒绝')
  const mSide = await vcM.handleGitConflictWrite({ cwd: rM, op: 'take-side', path: 'a.txt', side: 'ours', ticketId: mPreSide.ticket.id, requestId: 'req-841-m5', confirmed: true })
  const mList2 = await vcM.handleGitConflicts({ cwd: rM, op: 'conflict-list' })
  check(mSide.ok === true && mList2.ok === true && mList2.conflictCount === 0 && git(rM, ['status', '--porcelain']).out.indexOf('UU') < 0, 'M11 选当前边：真仓库里这个文件不再处于未合并状态（冲突清单跟着变 0）')
  // 继续合并那一条命令必须带 per-call 的编辑器覆盖（GIT_EDITOR=true），否则本机 GIT_EDITOR 必失败会让继续失败。
  const mEditorOf = (): boolean => {
    const q = requests.filter((r) => after(r.argv).slice(0, 2).join(',') === 'merge,--continue')[0]
    return !!(q && q.env && q.env.GIT_EDITOR === 'true')
  }
  const mPreCont = await vcM.handleGitConflictCheck({ cwd: rM, op: 'op-continue' })
  const parentsBefore = git(rM, ['rev-list', '--parents', '-n', '1', 'HEAD']).out.split(' ').length
  const mCont = await vcM.handleGitConflictWrite({ cwd: rM, op: 'op-continue', ticketId: mPreCont.ticket.id, requestId: 'req-841-m6', confirmed: true })
  const parentsAfter = git(rM, ['rev-list', '--parents', '-n', '1', 'HEAD']).out.split(' ').length
  check(mCont.ok === true && mCont.state === null && parentsAfter > parentsBefore && mEditorOf() === true, 'M12 继续合并：冲突解决后凭票继续，真生成一条合并提交（GIT_EDITOR 走 per-call 覆盖，不弹编辑器）')
  const mClean = await vcM.handleGitConflicts({ cwd: rM, op: 'marker-check' })
  check(mClean.ok === true && mClean.clean === true, 'M13 合并完成后残留标记检查变干净（两半都没残留）')
  check(denyIs({ ok: true, conflictCount: 0 }, 'ticket-missing') === false, 'M14 反证装置自检：把放行的读回包喂给「拒绝」判据必须判假')


  // K 组：#1755 同步十个动作（域 8 的 8.5–8.14）—— 预检签票与凭票执行走真仓库，写动作仍只经长任务通道。
  console.log('K 同步十动作（真仓库）')
  const rK = mkRepo('k')
  const vcK = makeVc()
  check(typeof vcK.handleGitSyncCheck === 'function' && typeof vcK.handleGitSyncWrite === 'function', 'K1 同步预检与执行两条电话挂在同一个宿主对象上')
  check(typeof vcK.handleGitTaskStart === 'function', 'K2 执行走长任务通道的电话就绪（同步自己不另起进程）')
  const kBefore = spawns.length
  const kNoRemote = await vcK.handleGitSyncCheck({ cwd: rK, action: 'fetch' })
  check(kNoRemote.ok === false && kNoRemote.error.kind === 'blocked' && kNoRemote.reason === 'no-remote', 'K3 仓库没有远端时获取被预检拦下，理由常驻（no-remote）')
  check(spawns.slice(kBefore).indexOf(kNoRemote) < 0 && writeSpawns().length === 0 && spawns.slice(kBefore).every((a) => after(a)[0] !== 'fetch' && after(a)[0] !== 'push' && after(a)[0] !== 'pull'), 'K4 预检只跑读命令：一条写命令与 fetch 都没起')
  const kBadBefore = spawns.length
  const kBad = await vcK.handleGitSyncCheck({ cwd: rK, action: 'nope' })
  check(kBad.ok === false && kBad.error.kind === 'bad-target' && spawns.length === kBadBefore, 'K5 不认识的动作当场拒绝，一个进程都不起（不落到默认推送）')
  git(rK, ['remote', 'add', 'origin', 'https://example.com/acme/repo.git'])
  const kPre = await vcK.handleGitSyncCheck({ cwd: rK, action: 'fetch' })
  check(kPre.ok === true && !!kPre.ticket && kPre.ticket.op === 'fetch' && kPre.confirmRequired === true, 'K6 预检获取成功：签票、票上记动作、确认卡要求确认')
  const kArgvBefore = spawns.length
  const kForged = await vcK.handleGitSyncWrite({ cwd: rK, action: 'fetch', ticketId: 'NOSUCHTICKET', requestId: 'k-req-forged', confirmed: true })
  check(kForged.ok === false && kForged.reason === 'ticket-missing' && spawns.length === kArgvBefore, 'K7 伪造票：ticket-missing 且零进程（执行前不读现场也不起 fetch）')
  const kNoConfirm = await vcK.handleGitSyncWrite({ cwd: rK, action: 'fetch', ticketId: kPre.ticket.id, requestId: 'k-req-noconfirm' })
  check(kNoConfirm.ok === false && kNoConfirm.reason === 'need-confirm' && spawns.slice(kArgvBefore).every((a) => after(a)[0] !== 'fetch' && after(a)[0] !== 'push'), 'K8 没带显式确认：need-confirm 且零写进程（确认卡四段先给用户看）')
  const kWrongRepo = await vcK.handleGitSyncWrite({ cwd: rA, action: 'fetch', ticketId: kPre.ticket.id, requestId: 'k-req-repo', confirmed: true })
  check(kWrongRepo.ok === false && kWrongRepo.reason === 'stale-repo' && spawns.slice(kArgvBefore).every((a) => after(a)[0] !== 'fetch'), 'K9 换仓库用票：stale-repo 且没有起 fetch（票绑定签发时那个仓库）')
  const kLogs = logs.filter((l) => l.fields && l.fields.method === 'wf.gitSyncCheck')
  check(kLogs.length > 0 && logs.every((l) => ['git.exec', 'git.exec.fail', 'host.call', 'host.call.fail'].indexOf(l.event) >= 0), 'K10 同步预检走既有日志事件：host.call 记下电话名，没有新事件名')
  check(denyIs({ ok: true, ticketId: 'x' }, 'ticket-missing') === false, 'K11 反证装置自检：把放行的回包喂给「拒绝」判据必须判假')

  // N 子模块页（#1757）：预检签票 → 写通道凭票执行 / 任务通道凭票转任务；伪造、过期、缺确认、现场不符都必须零进程。
  console.log('N 子模块页写与任务两条电话（#1757）')
  const subSrcN = mkRepo('ks')
  const rN = mkRepo('k')
  // 真子模块才验得出「配置真的变了、目录真的可能被移动」；本机 file 协议默认关闭，只在这一次命令上放开。
  const subAddN = git(rN, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subSrcN, 'libs/lib'])
  if (subAddN.code !== 0) throw new Error('造真子模块失败：' + subAddN.err)
  git(rN, ['commit', '-q', '-m', '加入子模块'])
  const vcN = makeVc()
  // 只有真正动配置/目录的子命令算写；预检读的 status / config / rev-parse 不算。
  const SUB_WRITE_SUBS = ['set-url', 'sync', 'set-branch', 'deinit', 'absorbgitdirs']
  const submoduleWrites = (): string[][] => spawns.filter((a) => { const c = after(a); return c[0] === 'submodule' && SUB_WRITE_SUBS.indexOf(c[1]) >= 0 })
  const taskSpawnsN = (): string[][] => spawns.filter((a) => { const c = after(a); return c[0] === 'submodule' && c[1] === 'update' })
  check(typeof vcN.handleGitSubmodules === 'function' && typeof vcN.handleGitSubmoduleCheck === 'function' && typeof vcN.handleGitSubmoduleWrite === 'function' && typeof vcN.handleGitSubmoduleTask === 'function', 'N1 子模块四条电话都挂在同一个宿主对象上（读数 / 预检 / 凭票执行 / 凭票转任务）')
  const nBoard = await vcN.handleGitSubmodules({ cwd: rN })
  check(nBoard.ok === true && nBoard.contract === 'version-control.submodule-board' && nBoard.version === 1 && Array.isArray(nBoard.rows) && nBoard.rows.length === 1 && nBoard.rows[0].path === 'libs/lib' && nBoard.counts.total === 1 && submoduleWrites().length === 0, 'N2 读数电话回契约 version-control.submodule-board / 版本 1，真子模块出现在行里，且一条写命令都没起')
  const nPre = await vcN.handleGitSubmoduleCheck({ cwd: rN, op: 'set-url', path: 'libs/lib', url: 'https://example.com/lib2.git' })
  check(nPre.ok === true && nPre.ticket && nPre.ticket.op === 'set-url' && nPre.confirmRequired === true && nPre.decision === 'allow' && submoduleWrites().length === 0, 'N3 预检改地址：放行 + 签票（需要确认），一条写命令都没起')
  const nCount1 = spawns.length
  const subForged = await vcN.handleGitSubmoduleWrite({ cwd: rN, op: 'set-url', path: 'libs/lib', url: 'https://example.com/lib2.git', ticketId: 'NOSUCHTICKET', requestId: 'k-req-forged', confirmed: true })
  check(denyIs(subForged, 'ticket-missing') && spawns.length === nCount1, 'N4 伪造票：ticket-missing 且零进程（纯判定先行）')
  const nCount2 = spawns.length
  const nNoConfirm = await vcN.handleGitSubmoduleWrite({ cwd: rN, op: 'set-url', path: 'libs/lib', url: 'https://example.com/lib2.git', ticketId: nPre.ticket.id, requestId: 'k-req-noconfirm' })
  check(nNoConfirm.ok === false && nNoConfirm.error.reason === 'confirm-required' && spawns.length === nCount2, 'N5 没带显式确认：confirm-required 且零进程')
  clock.t = nPre.ticket.expiresAtMs + 1
  const nCount3 = spawns.length
  const subExpired = await vcN.handleGitSubmoduleWrite({ cwd: rN, op: 'set-url', path: 'libs/lib', url: 'https://example.com/lib2.git', ticketId: nPre.ticket.id, requestId: 'k-req-expired', confirmed: true })
  clock.t = 1000
  check(subExpired.ok === false && subExpired.error.reason === 'ticket-expired' && spawns.length === nCount3, 'N6 过期票：ticket-expired 且零进程（不自动重签、不重放）')
  const nPre2 = await vcN.handleGitSubmoduleCheck({ cwd: rN, op: 'set-url', path: 'libs/lib', url: 'https://example.com/lib2.git' })
  const nBefore = submoduleWrites().length
  const nSet = await vcN.handleGitSubmoduleWrite({ cwd: rN, op: 'set-url', path: 'libs/lib', url: 'https://example.com/lib2.git', ticketId: nPre2.ticket.id, requestId: 'k-req-set-url', confirmed: true })
  const nSetArgv = after(submoduleWrites()[nBefore] || [])
  check(nSet.ok === true && nSet.kind === 'git-submodule-write' && nSet.n === 1 && submoduleWrites().length === nBefore + 1 && nSetArgv.join(' ') === 'submodule set-url -- libs/lib https://example.com/lib2.git', 'N7 凭票改地址：成功一次只起一条写命令，argv 逐元素（submodule set-url -- <路径> <地址>）')
  check(git(rN, ['config', '-f', '.gitmodules', '--get', 'submodule.libs/lib.url']).out === 'https://example.com/lib2.git', 'N8 改地址真的落到 .gitmodules（真仓库状态变了，不是只回了成功包）')
  // 仓库根由宿主从 git rev-parse 读回来（斜杠方向与大小写都可能与 mkdtemp 的写法不同），比对前先归成真实路径。
  const sameRealPath = (a: string, b: string): boolean => { try { return fs.realpathSync(a).replace(/\\/g, '/').toLowerCase() === fs.realpathSync(b).replace(/\\/g, '/').toLowerCase() } catch (e) { return false } }
  const nCwdOk = requests.filter((q) => { const c = after(q.argv); return c[0] === 'submodule' && SUB_WRITE_SUBS.indexOf(c[1]) >= 0 }).every((q) => sameRealPath(q.cwd, rN))
  check(nCwdOk, 'N9 每一条子模块写命令的 cwd 都钉在票据那个仓库上')
  const subReplay = await vcN.handleGitSubmoduleWrite({ cwd: rN, op: 'set-url', path: 'libs/lib', url: 'https://example.com/lib2.git', ticketId: 'NOSUCH', requestId: 'k-req-set-url', confirmed: true })
  check(JSON.stringify(subReplay) === JSON.stringify(nSet) && submoduleWrites().length === nBefore + 1, 'N10 同一个请求号重放：回同一份结果、不再起第二条写命令（重复点按钮不会重复写配置）')
  const nAbsorb = await vcN.handleGitSubmoduleCheck({ cwd: rN, op: 'absorb', path: 'libs/lib' })
  check(nAbsorb.ok === false && nAbsorb.error.kind === 'blocked' && nAbsorb.error.reason === 'nothing-to-absorb' && submoduleWrites().length === nBefore + 1, 'N11 吸收 .git 受控：真子模块的 .git 已经吸收过，预检如实拦成 nothing-to-absorb、零写命令（不无脑动目录）')
  const nTaskPre = await vcN.handleGitSubmoduleCheck({ cwd: rN, op: 'init', path: 'libs/lib' })
  check(nTaskPre.ok === true && nTaskPre.plan && nTaskPre.plan.kind === 'task' && nTaskPre.task && nTaskPre.task.op === 'submodule-init' && nTaskPre.confirmRequired === true, 'N12 预检「初始化并检出」：计划是长任务、任务动作 submodule-init，需要确认（10.2/10.3 走任务通道）')
  const nTaskCount = taskSpawnsN().length
  const nTaskForged = await vcN.handleGitSubmoduleTask({ cwd: rN, op: 'init', ticketId: 'NOSUCHTICKET', requestId: 'k-task-forged', confirmed: true })
  check(denyIs(nTaskForged, 'ticket-missing') && taskSpawnsN().length === nTaskCount, 'N13 任务电话伪造票：ticket-missing 且零任务进程')
  const nTaskPre2 = await vcN.handleGitSubmoduleCheck({ cwd: rN, op: 'init', path: 'libs/lib' })
  const nTask = await vcN.handleGitSubmoduleTask({ cwd: rN, op: 'init', ticketId: nTaskPre2.ticket.id, requestId: 'k-req-task-init', confirmed: true })
  const nInitArgv = after(taskSpawnsN().pop() || [])
  check(nTask.ok === true && nTask.task && nTask.task.op === 'submodule-init' && nInitArgv.join(' ') === 'submodule update --init --recursive -- libs/lib', 'N14 凭票「初始化并检出」：真起长任务 submodule update --init --recursive -- <路径>（客户端参数不采信）')
  check(submoduleWrites().every((a) => a.indexOf('--force') < 0 && a.indexOf('-f') < 0), 'N15 本组所有子模块写命令都不带 --force / -f（边界：面板不提供强制开关）')
  check(denyIs({ ok: true, kind: 'git-submodule-write' }, 'ticket-missing') === false, 'N16 反证装置自检：把放行的回包喂给「拒绝」判据必须判假')

  // L 提交页域 2（#1743）：八条提交能力共用一份计划真源，危险动作靠 planDigest 绑票，失败分类不落 unknown。
  console.log('L 提交页八条能力（计划绑定 / 危险动作 / 失败分类）')
  const rL = mkRepo('i')
  const vcL = makeVc()
  const lPlan = { mode: 'staged', target: '', skipHooks: false, sign: false, signoff: false }
  const lCheck = await vcL.handleGitWriteCheck({ cwd: rL, op: 'commit', message: '页 2.1 标题', plan: lPlan })
  check(lCheck.ok === true && lCheck.plan && lCheck.plan.mode === 'staged' && lCheck.ticket && lCheck.ticket.op === 'commit', 'L1 预检收下提交计划并回一张 commit 票（计划与票据一起回包）')
  const lTicketFull = (await vcL.writeTickets()).get(lCheck.ok ? lCheck.ticket.id : 'x') || {}
  check(lCheck.ok === true && !!lTicketFull.bindings && !!lTicketFull.bindings.preconditions && /^[0-9a-f]{16}$/.test(String(lTicketFull.bindings.preconditions.planDigest || '')) && !!lTicketFull.target && lTicketFull.target.mode === 'staged', 'L2 提交票绑定计划摘要（planDigest）与计划本体（2.1 的形态写进 target）')
  const lTicket = lCheck.ok ? lCheck.ticket : {}
  // 2.1 正常提交：argv 在固定前缀之后逐元素独立，cwd 钉在票据那个仓库。
  const lWriteSpawns0 = writeSpawns().length
  const lCommit = await vcL.handleGitCommit({ cwd: rL, ticketId: lTicket.id, requestId: 'i-r1', message: '页 2.1 标题', plan: lPlan })
  const lNew = writeSpawns()[lWriteSpawns0] || []
  check(lCommit.ok === true && lCommit.committed === true && lCommit.mode === 'staged', 'L3 2.1 提交成功，回包带形态（staged）与新旧提交号')
  check(after(lNew).join(' ') === 'commit -m 页 2.1 标题' && after(lNew).every((x) => typeof x === 'string'), 'L4 2.1 的 argv 是「commit -m <说明>」三段独立元素（不经 shell 拼接）')
  const lCwdOk = requests.filter((q) => after(q.argv)[0] === 'commit').every((q) => q.cwd === rL)
  check(lCwdOk, 'L5 每一次提交调用的 cwd 都钉在票据那个仓库上')
  // 同一 requestId 重放：不再起第二次 commit 进程，回包还是那一份。
  const lSpawnsBeforeReplay = writeSpawns().length
  const lReplay = await vcL.handleGitCommit({ cwd: rL, ticketId: lTicket.id, requestId: 'i-r1', message: '页 2.1 标题', plan: lPlan })
  check(lReplay.ok === true && lReplay.committed === true && writeSpawns().length === lSpawnsBeforeReplay, 'L6 同一 requestId 重放不重复执行（没有再起 commit 进程，回包与第一次一致）')
  // 预检是 2.1、执行改成 2.3：计划摘要对不上，零写进程、HEAD 不动（绕过确认卡走不通）。
  const rL2 = mkRepo('i2')
  const vcL2 = makeVc()
  const lHead2 = git(rL2, ['rev-parse', 'HEAD']).out
  const lCheck2 = await vcL2.handleGitWriteCheck({ cwd: rL2, op: 'commit', message: '预检 2.1', plan: lPlan })
  const lSwapSpawns0 = writeSpawns().length
  const lSwap = await vcL2.handleGitCommit({ cwd: rL2, ticketId: lCheck2.ok ? lCheck2.ticket.id : 'x', requestId: 'i-r2', message: '执行 2.3', plan: { mode: 'amend', target: '', skipHooks: false, sign: false, signoff: false } })
  check(lSwap.ok === false && lSwap.error && lSwap.error.reason === 'target-changed' && writeSpawns().length === lSwapSpawns0 && git(rL2, ['rev-parse', 'HEAD']).out === lHead2, 'L7 预检 2.1 却按 2.3 执行：planDigest 对不上，拒成 target-changed、零写进程、HEAD 不动（危险动作必须走确认卡）')
  // 危险动作 2.3：仓库没有暂存内容也能提交（只改说明），执行 argv 是 --amend + -m。
  const rL3 = mkRepo('i3')
  git(rL3, ['reset', '-q'])
  const vcL3 = makeVc()
  const lCheck3 = await vcL3.handleGitWriteCheck({ cwd: rL3, op: 'commit', message: '只改说明', plan: { mode: 'amend', target: '', skipHooks: false, sign: false, signoff: false } })
  check(lCheck3.ok === true && lCheck3.decision && lCheck3.decision.verdict === 'allow', 'L8 2.3 修订只需改说明：没有暂存内容也放行预检（普通提交这一态会被 nothing-staged 拦住）')
  const lAmendSpawns0 = writeSpawns().length
  const lAmend = await vcL3.handleGitCommit({ cwd: rL3, ticketId: lCheck3.ok ? lCheck3.ticket.id : 'x', requestId: 'i-r3', message: '只改说明', plan: { mode: 'amend', target: '', skipHooks: false, sign: false, signoff: false } })
  const lAmendArgv = after(writeSpawns()[lAmendSpawns0] || [])
  check(lAmend.ok === true && lAmendArgv.join(' ') === 'commit --amend -m 只改说明', 'L9 2.3 的 argv 是「commit --amend -m <说明>」（修订上一条提交）')
  // 危险动作 2.4：目标不存在时预检直接拒、零写进程；目标存在时 argv 是 --fixup=<oid>。
  const rL4 = mkRepo('i4')
  const vcL4 = makeVc()
  const lFixBad = await vcL4.handleGitWriteCheck({ cwd: rL4, op: 'commit', message: '吸收', plan: { mode: 'fixup', target: 'deadbeef', skipHooks: false, sign: false, signoff: false } })
  check(lFixBad.ok === false && lFixBad.error && lFixBad.error.reason === 'bad-commit-target' && writeSpawns().length === 0, 'L10 2.4 找不到可吸收目标时预检就拒（bad-commit-target），零写进程')
  const lFixMissing = await vcL4.handleGitWriteCheck({ cwd: rL4, op: 'commit', message: '吸收', plan: { mode: 'fixup', target: '', skipHooks: false, sign: false, signoff: false } })
  check(lFixMissing.ok === false && lFixMissing.error && lFixMissing.error.reason === 'need-commit-target', 'L11 2.4 没给目标时拒成 need-commit-target（按钮该禁用的那一档）')
  const lTargetOid = git(rL4, ['rev-parse', 'HEAD']).out
  const lFixPlan = { mode: 'fixup', target: lTargetOid, skipHooks: false, sign: false, signoff: false }
  const lFixCheck = await vcL4.handleGitWriteCheck({ cwd: rL4, op: 'commit', message: '吸收', plan: lFixPlan })
  const lFixSpawns0 = writeSpawns().length
  const lFix = await vcL4.handleGitCommit({ cwd: rL4, ticketId: lFixCheck.ok ? lFixCheck.ticket.id : 'x', requestId: 'i-r4', message: '', plan: lFixPlan })
  const lFixArgv = after(writeSpawns()[lFixSpawns0] || [])
  check(lFix.ok === true && lFixArgv.join(' ') === 'commit --fixup=' + lTargetOid, 'L12 2.4 的 fixup argv 是「commit --fixup=<目标提交>」（说明由 git 抄目标提交）')
  // 2.5 跳过钩子的 argv 是 --no-verify；2.6 追加签名行是 -s（与 -S 签名提交分开）。
  const rL5 = mkRepo('i5')
  const vcL5 = makeVc()
  const lSkipPlan = { mode: 'staged', target: '', skipHooks: true, sign: false, signoff: false }
  const lSkipCheck = await vcL5.handleGitWriteCheck({ cwd: rL5, op: 'commit', message: '跳过钩子', plan: lSkipPlan })
  const lSkipSpawns0 = writeSpawns().length
  const lSkip = await vcL5.handleGitCommit({ cwd: rL5, ticketId: lSkipCheck.ok ? lSkipCheck.ticket.id : 'x', requestId: 'i-r5', message: '跳过钩子', plan: lSkipPlan })
  const lSkipArgv = after(writeSpawns()[lSkipSpawns0] || [])
  check(lSkip.ok === true && lSkip.skipHooks === true && lSkipArgv.join(' ') === 'commit --no-verify -m 跳过钩子', 'L13 2.5 跳过钩子单独勾选：argv 只多 --no-verify，不给别的提交加默认值')
  const rL6 = mkRepo('i6')
  const vcL6 = makeVc()
  const lSignPlan = { mode: 'staged', target: '', skipHooks: false, sign: false, signoff: true }
  const lSignCheck = await vcL6.handleGitWriteCheck({ cwd: rL6, op: 'commit', message: '追加签名行', plan: lSignPlan })
  const lSignSpawns0 = writeSpawns().length
  const lSign = await vcL6.handleGitCommit({ cwd: rL6, ticketId: lSignCheck.ok ? lSignCheck.ticket.id : 'x', requestId: 'i-r6', message: '追加签名行', plan: lSignPlan })
  const lSignArgv = after(writeSpawns()[lSignSpawns0] || [])
  check(lSign.ok === true && lSign.sign === false && lSign.signoff === true && lSignArgv.join(' ') === 'commit -s -m 追加签名行', 'L14 2.6 追加签名行只写尾部行（argv 是 -s），与签名提交（-S）是两个独立开关')
  // 失败分类与信封：签名失败归到 signing-failed（不落 unknown-write-failure），信封固定四键。
  const rL7 = mkRepo('i7')
  const vcL7 = makeVc()
  const lFailPlan = { mode: 'staged', target: '', skipHooks: false, sign: true, signoff: false }
  const lFailCheck = await vcL7.handleGitWriteCheck({ cwd: rL7, op: 'commit', message: '签名提交', plan: lFailPlan })
  const lFail = await vcL7.handleGitCommit({ cwd: rL7, ticketId: lFailCheck.ok ? lFailCheck.ticket.id : 'x', requestId: 'i-r7', message: '签名提交', plan: lFailPlan })
  check(lFail.ok === false && lFail.error && lFail.error.reason === 'signing-failed' && Object.keys(lFail.error).sort().join(',') === 'hint,kind,message,reason', 'L15 2.6 签名失败归到 signing-failed（不是 unknown-write-failure），失败信封固定 {kind,reason,message,hint}')
  console.log(failed ? '\n存在失败 — verify-841-write-phones 未通过' : '\n全部通过 — 写操作那一族门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })