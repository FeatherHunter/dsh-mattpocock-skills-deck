// verify-841-write-phones.js —— 写操作那一族门禁（#841 第二段）：A–G 七组，每组带反证。
// 用法：node tests/verify-841-write-phones.js
// 夹具：真 git 临时仓库（每个用例自己造）+ 真 subprocess 形状的垫片（argv 直传、不经 shell），
// 这样「真跑过的 argv」与「真仓库有没有被动过」都能断言；只在纯归类那组不碰 git。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) }
const git = (cwd, args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() } }
function mkRepo(tag) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws841-' + tag + '-'))
  git(base, ['init', '-q', '-b', 'main']); git(base, ['config', 'user.name', 'x']); git(base, ['config', 'user.email', 'x@y'])
  fs.writeFileSync(path.join(base, 'a.txt'), 'a\n'); git(base, ['add', '-A']); git(base, ['commit', '-q', '-m', '基线'])
  fs.writeFileSync(path.join(base, 'a.txt'), 'a\nb\n'); git(base, ['add', 'a.txt'])
  return base
}
const spawns = []
const logs = []
let clock = { t: 1000 }
function makeVc(route) {
  spawns.length = 0
  const deps = {
    subprocess: { spawn(req) { spawns.push(req.argv.slice()); const hit = route ? route(req.argv) : null; if (hit) { const mk = (t) => ({ finalize: () => ({ text: String(t || ''), truncated: false }) }); return { done: Promise.resolve({ exitCode: hit.code || 0 }), collected: { stdout: mk(hit.stdout), stderr: mk(hit.stderr) }, terminate() {} } } const r = spawnSync(req.argv[0], req.argv.slice(1), { cwd: req.cwd, encoding: 'buffer', windowsHide: true, maxBuffer: 1 << 26 }); const mk2 = (b) => ({ finalize: () => ({ text: (b || Buffer.alloc(0)).toString('utf8'), truncated: false }) }); return { done: Promise.resolve({ exitCode: r.status }), collected: { stdout: mk2(r.stdout), stderr: mk2(r.stderr) }, terminate() {} } } },
    timer: { timeout: (ms) => new Promise((r) => setTimeout(r, ms)) },
    fs: { stat: async (p) => await fs.promises.stat(p), lstat: async (p) => await fs.promises.lstat(p), exists: async (p) => { try { await fs.promises.access(p); return true } catch (e) { return false } } },
    getPlatform: async () => ({ resolveExecutable: async (n) => (n === 'git' ? 'git' : null) }),
    DEFAULT_CWD: ROOT, TIMEOUT_MS: 30000, gate: { noteOutbound() {} }, logCtx: { fire(level, event, fields) { logs.push({ level, event, fields }) } },
    now: () => clock.t,
  }
  return vcMod.createVersionControl(deps)
}
// 固定前缀的最后一项是 i18n.logOutputEncoding=UTF-8：切在它之后才是真正的子命令（照 verify-version-control-host 的同一口径）。
const after = (argv) => { const i = argv.indexOf('i18n.logOutputEncoding=UTF-8'); return i < 0 ? argv : argv.slice(i + 1) }
const writeSpawns = () => spawns.filter((a) => ['add', 'commit', 'pull', 'push'].indexOf(after(a)[0]) >= 0)
let vcMod = null
async function main() {
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
  const a1 = await vcA.handleGitCommit({ cwd: rA, message: '标题', ticketId: 'NOSUCHTICKET' })
  check(a1.ok === false && a1.error.reason === 'ticket-missing' && writeSpawns().length === 0, 'A1 伪造票：ticket-missing 且零写命令')
  clock.t = pre.ticket.expiresAtMs + 1
  const a2 = await vcA.handleGitCommit({ cwd: rA, message: '标题', ticketId: pre.ticket.id })
  check(a2.ok === false && a2.error.reason === 'ticket-expired' && writeSpawns().length === 0, 'A2 过期票：ticket-expired 且零写命令')
  clock.t = 1000
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
  check(cmds.pushArgs({ mode: 'existing', remote: 'origin', branch: 'main', localBranch: 'main' }).join(' ') === 'push origin main:main', 'B3 推送是显式 <remote> <local>:<remote>')
  check(cmds.pushArgs({ mode: 'set-upstream', remote: 'origin', branch: 'main', localBranch: 'main' }).join(' ') === 'push -u origin main:main', 'B4 -u 只在 set-upstream 档出现')
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

  // F 同一进程出口 + 看门狗白名单
  console.log('F 同一出口、请求白名单')
  const wsrc = fs.readFileSync(path.join(ROOT, 'src', 'host', 'versionControlWrite.js'), 'utf8')
  check(!/child_process|spawnSync|execSync/.test(wsrc), 'F1 写层不自己起进程（走注入的共享出口）')
  const rF = mkRepo('f')
  const vcF = makeVc()
  await vcF.handleGitStage({ cwd: rF, paths: ['a.txt'], stallMs: 2500, junk: 'x', progress: true })
  check(spawns.every((a) => a.indexOf('stallMs') < 0 && a.indexOf('junk') < 0), 'F2 反证：客户端乱传 stallMs/未知字段进不了 argv（请求按白名单拼）')

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

  console.log(failed ? '\n存在失败 — verify-841-write-phones 未通过' : '\n全部通过 — 写操作那一族门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
