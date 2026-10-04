// tests/verify-839-credential-exec.js — #839 宿主执行层门禁（安全地跑可能弹凭据提示的 git 命令）
// 用法：node tests/verify-839-credential-exec.js（在插件根目录；全部打 127.0.0.1 上的自建假服务，不需要外网）
//
// 断言文字：把「非交互环境 + 预算 + 分类 + 照做的话」四件事各钉一条底线，并且用真进程真跑三类环境：
//   ① 有可用凭据（假助手把凭据喂进 git 的凭据链）→ 命令成功，服务端收到合法 Basic 凭据；
//   ② 没有凭据（助手链空；以及这台机器上真实的 Git Credential Manager）→ 快速失败，归类 need-credentials，
//      并且耗时必须远小于预算（不许挂在等输入上）；
//   ③ 凭据不对 / 有凭据但没权限 → 分别归类 auth-rejected 与 no-permission；
//   ④ 对端收下连接却不回话（黑洞）→ git 自己按低速阈值放弃（stalled）；阈值关掉时由每操作预算强杀（timeout）；
//      调用的总预算到点后，下一步直接 budget-exhausted；被强杀时连孙进程（假 ssh）一起清掉。
// 另加：环境契约（那几个开关与墓碑一个都不许少）、分类纯函数的分档、预算表、以及两条反证（改坏必须变红）。
//
// 三环境真跑结论（2026-10-04，本机 Windows / git 2.49.0.windows.1；全部打 127.0.0.1 上的自建假服务，不需要外网）：
//   ① 已配凭据助手（正常路径）：git -c credential.helper='!f() { echo username=u839; echo password=p839; }; f' \
//        ls-remote http://127.0.0.1:<port>/repo.git → exit 0（87ms），服务端收到合法 Basic 凭据。
//   ② 需要交互登录：同一条命令去掉助手 → exit 128（55ms）fatal: unable to get password from user → need-credentials；
//      这台机器上真实的 GCM（credential.helper=manager）同一条命令 → exit 128（535ms）
//      fatal: Cannot prompt because user interactivity has been disabled. → need-credentials，说明里点名 manager。
//   ③ 只读/无权限：助手回错凭据 → fatal: Authentication failed → auth-rejected；
//      助手回对凭据而服务端 403 → fatal: ... returned error: 403 → no-permission。
//   ④ 停顿（对抗式报告里未实测的那条）：黑洞服务 + GIT_HTTP_LOW_SPEED_LIMIT=1000 / TIME=2 →
//      exit 128（2059ms）Operation too slow. Less than 1000 bytes/sec transferred the last 2 seconds → stalled（git 自己放弃）；
//      把这两个开关拿掉，同一条命令由每操作预算在 2275ms 强杀 → timeout，并留下 handle.terminate() 的痕迹。
//   ⑤ 调用级总预算 3000ms：单步被压到总预算内（3247ms 回 timeout），下一步直接 budget-exhausted。
//   ⑥ 进程树：假 ssh（睡 30 秒）被 git 起来之后，预算到点连它一起清掉（断言孙进程 PID 不再存活）。
// 本票没有实测的（照实写，别当成已知）：GCM 的 GUI 弹窗本身没触发过（只测到「非交互开关下 0.4-0.5 秒快失败」）；
// 没有真 SSH 服务器（ssh 只验到「GIT_SSH_COMMAND 把假 ssh 起起来并被整棵清掉」+ OpenSSH 文档行为）；
// 代理只覆盖「黑洞」一种，407 认证那条没测；宿主收集器的字节增长看门狗没做（要改共享出口的竞速逻辑，列后续票）。
//
// 复用的三件东西（#839 第 3 条：不许另起一套）：同一份 src/host/versionControl.js 出口（runGitCommand）、
// 同一条 git.exec / git.exec.fail 日志、同一个报闸。门禁里的「真子进程适配器」只是照 DSH subprocess 服务
// 的形状把子进程跑起来（测试专用；插件代码里没有 child_process）。

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const cp = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const info = (msg) => console.log('  INFO ' + msg)
const slash = (p) => String(p).replace(/\\/g, '/')

// ---------------- 真子进程适配器：照 DSH subprocess 服务的形状 ----------------
/** 环境合并：显式值覆盖继承值；显式 undefined 是墓碑（把这一项从继承环境里删掉）——与 DSH 同义。 */
function buildEnv(extra) {
  const env = Object.assign({}, process.env)
  for (const [k, v] of Object.entries(extra || {})) {
    for (const kk of Object.keys(env)) if (kk.toUpperCase() === k.toUpperCase()) delete env[kk]
    if (v !== undefined) env[k] = v
  }
  return env
}
/** 有界尾部收集器：形状照 DSH 的 OutputCollector（finalize / readFrom / lossy）。 */
function makeCollector(maxBytes) {
  const state = { text: '', bytes: 0, total: 0, dropped: false }
  return {
    push(chunk) {
      state.total += chunk.length
      state.text += chunk.toString('utf8')
      while (Buffer.byteLength(state.text, 'utf8') > maxBytes) { state.text = state.text.slice(Math.ceil(state.text.length / 10)); state.dropped = true }
    },
    finalize() { return { text: state.text, truncated: state.dropped } },
    readFrom(from) { return { text: state.text.slice(from || 0), nextOffset: state.text.length, lossy: state.dropped } },
  }
}
/** 进程还在不在（用于验证「整棵被清掉」）。 */
function isAlive(pid) { try { process.kill(pid, 0); return true } catch (e) { return e && e.code === 'EPERM' } }

function makeRealSubprocess(log) {
  return {
    spawn(spec) {
      log.spawns.push(spec)
      const child = cp.spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd, env: buildEnv(spec.env), windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const out = makeCollector(spec.stdio.stdout.maxBytes)
      const err = makeCollector(spec.stdio.stderr.maxBytes)
      child.stdout.on('data', (c) => out.push(c))
      child.stderr.on('data', (c) => err.push(c))
      const done = new Promise((resolve) => child.on('close', (code, signal) => resolve({ exitCode: code === null ? -1 : code, signal: signal })))
      return {
        done,
        collected: { stdout: out, stderr: err },
        terminate() {
          log.terminations += 1
          try {
            if (process.platform === 'win32') cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
            else child.kill('SIGKILL')
          } catch (e) {}
        },
      }
    },
  }
}

// ---------------- 本地假服务（只打 127.0.0.1） ----------------
const GOOD = 'Basic ' + Buffer.from('u839:p839').toString('base64')
function startServer(behavior) {
  const seen = []
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization || ''
    seen.push({ auth: auth === GOOD, path: req.url })
    if (behavior === 'blackhole') return
    if (behavior === 'noauth' || !auth) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fake"' }); res.end('need auth'); return }
    if (auth !== GOOD) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fake"' }); res.end('bad creds'); return }
    if (behavior === 'forbidden') { res.writeHead(403); res.end('forbidden'); return }
    res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement' })
    res.end('001e# service=git-upload-pack\n00000000')
  })
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      const port = server.address().port
      resolve({ url: 'http://127.0.0.1:' + port + '/repo.git', seen: seen, close: () => new Promise((r) => server.close(r)) })
    })
  })
}

// ---------------- 实验室与执行器 ----------------
function makeLab() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-839-'))
  const sshJs = path.join(dir, 'fake-ssh.mjs')
  const pidFile = path.join(dir, 'fake-ssh.pid')
  fs.writeFileSync(sshJs, "import { writeFileSync } from 'node:fs'\nwriteFileSync(" + JSON.stringify(pidFile) + ", String(process.pid))\nsetTimeout(function () { process.exit(1) }, 30000)\n", 'utf8')
  const sshCmd = path.join(dir, 'fake-ssh.cmd')
  fs.writeFileSync(sshCmd, '@echo off\r\n"' + process.execPath + '" "' + sshJs + '" %*\r\n', 'utf8')
  return { dir: dir, sshCmd: slash(sshCmd), sshPidFile: pidFile, helperSnippet: '!f() { echo username=u839; echo password=p839; }; f' }
}

async function makeRunner(lab, opts) {
  const o = opts || {}
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const credMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'gitCredentialExec.js')).href)
  const log = { spawns: [], terminations: 0, events: [], outbound: 0 }
  const vc = hostMod.createVersionControl({
    subprocess: makeRealSubprocess(log),
    timer: { timeout: (ms) => new Promise((r) => setTimeout(r, ms)) },
    fs: null,
    getPlatform: async () => ({ resolveExecutable: async (name) => (name === 'git' ? 'git' : null) }),
    DEFAULT_CWD: lab.dir,
    TIMEOUT_MS: 20000,
    gate: { noteOutbound() { log.outbound += 1 } },
    logCtx: { fire(level, event, fields) { log.events.push({ level: level, event: event, fields: fields }) } },
  })
  let runGit = vc.runGitCommand
  if (o.stripEnvKeys) {
    const strip = o.stripEnvKeys
    const inner = runGit
    runGit = function (exe, dir, args, ropts) {
      const r2 = Object.assign({}, ropts)
      if (r2.env) { r2.env = Object.assign({}, r2.env); for (const k of strip) delete r2.env[k] }
      return inner(exe, dir, args, r2)
    }
  }
  const safe = credMod.createCredentialSafeGit({
    runGit: runGit,
    getPlatform: async () => ({ resolveExecutable: async (name) => (name === 'git' ? 'git' : null) }),
    getEnv: (name) => (name === 'GIT_SSH_COMMAND' ? lab.sshCmd : null),
    DEFAULT_CWD: lab.dir,
    lowSpeedSeconds: o.lowSpeedSeconds,
  })
  return { safe: safe, credMod: credMod, log: log, lab: lab }
}

/** 隔离系统与用户 gitconfig 的环境变量（只影响门禁这个进程起的 git 子进程）。 */
const ISOLATE = { GIT_CONFIG_SYSTEM: '', GIT_CONFIG_GLOBAL: '' }
function withIsolation(fn) {
  const before = {}
  for (const k of Object.keys(ISOLATE)) { before[k] = process.env[k]; process.env[k] = ISOLATE[k] }
  const restore = () => { for (const k of Object.keys(ISOLATE)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k] } }
  return Promise.resolve().then(fn).then((r) => { restore(); return r }, (e) => { restore(); throw e })
}

async function main() {
  console.log('宿主执行层门禁（#839：非交互环境 + 预算 + 分类 + 三环境真跑 + 反证）')

  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const credMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'gitCredentialExec.js')).href)
  const hostSrc = fs.readFileSync(path.join(ROOT, 'src', 'host', 'gitCredentialExec.js'), 'utf8')
  const hostCode = hostSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

  // ---- A) 静态契约：这一族命令的安全开关一个都不许少 ----
  check(typeof credMod.createCredentialSafeGit === 'function' && typeof credMod.classifyGitFailure === 'function' && typeof credMod.hintFor === 'function', '模块导出：工厂 + 分类 + 话术')
  check(typeof hostMod.createVersionControl({}).runGitCommand === 'function', '共享出口把 runGitCommand 露出来了（新模块复用的就是它）')
  const lab0 = makeLab()
  const inst = await makeRunner(lab0)
  const args0 = inst.safe.nonInteractiveArgs(false)
  const env0 = inst.safe.nonInteractiveEnv(60000)
  check(args0.join(' ').indexOf('credential.interactive=false') >= 0, '非交互 argv 前缀含 credential.interactive=false')
  check(args0.indexOf('credential.helper=') < 0, '默认档不摘用户的凭据助手（摘了就永远认证不上；这是有意选择）')
  check(inst.safe.nonInteractiveArgs(true).indexOf('credential.helper=') >= 0, 'clearHelpers:true 时才额外摘掉一切助手')
  check(env0.GIT_TERMINAL_PROMPT === '0', '环境含 GIT_TERMINAL_PROMPT=0（终端提示变快失败，实测 56ms）')
  check(env0.GCM_INTERACTIVE === 'never', '环境含 GCM_INTERACTIVE=never（GCM 不许弹窗）')
  check(env0.GIT_ASKPASS === undefined && env0.SSH_ASKPASS === undefined && env0.DISPLAY === undefined, 'GIT_ASKPASS / SSH_ASKPASS / DISPLAY 都是墓碑（继承来的 GUI askpass 是隐藏地雷）')
  check(env0.SSH_ASKPASS_REQUIRE === 'never', 'SSH_ASKPASS_REQUIRE=never（再压一道 ssh 的 GUI askpass）')
  check(/BatchMode=yes/.test(env0.GIT_SSH_COMMAND) && /StrictHostKeyChecking=accept-new/.test(env0.GIT_SSH_COMMAND) && /ConnectTimeout=\d+/.test(env0.GIT_SSH_COMMAND), 'ssh 走 BatchMode + accept-new + ConnectTimeout')
  check(String(env0.GIT_SSH_COMMAND).indexOf(lab0.sshCmd) === 0, '继承的 GIT_SSH_COMMAND 做基底往后追加，不整个换掉（自定义身份/端口不丢）')
  check(env0.GIT_HTTP_LOW_SPEED_LIMIT === '1000' && Number(env0.GIT_HTTP_LOW_SPEED_TIME) > 0, 'http 低速放弃阈值已设（停顿判据之一）')
  check(credMod.OPERATION_BUDGETS.fetch > 0 && credMod.OPERATION_BUDGETS.push >= credMod.OPERATION_BUDGETS['ls-remote'] && credMod.CALL_BUDGET_MS >= credMod.OPERATION_BUDGETS.pull, '每操作预算与调用级总预算都在，且写操作给得比只读宽')
  check(inst.safe.budgetFor(['ls-remote', 'x']) === credMod.OPERATION_BUDGETS['ls-remote'] && inst.safe.budgetFor(['status']) === credMod.OPERATION_BUDGETS.default, '按子命令取预算，认不出的落 default')
  check(hostCode.indexOf('child_process') < 0 && !/\bspawn\s*\(/.test(hostCode), '本模块自己不起进程（去注释后既没有 child_process 也没有 spawn）')
  check(!/config['"],\s*['"](--set|--unset|--global|--system)/.test(hostCode), '本模块不改用户 git 配置（只读取 config --get）')
  check(!/credential\s+fill|credential\s+approve/.test(hostCode), '本模块不落任何凭据（不调 credential fill/approve）')

  // ---- B) 分类纯函数：用真机话术逐条认档 ----
  const cases = [
    ['fatal: Could not read from remote repository.', 'terminal prompts disabled', 'need-credentials'],
    ['fatal: Cannot prompt because user interactivity has been disabled.', 'unable to get password from user', 'need-credentials'],
    ['remote: Invalid username or password.', 'fatal: Authentication failed for x', 'auth-rejected'],
    ['fatal: unable to access x: The requested URL returned error: 401', '', 'auth-rejected'],
    ['remote: Permission to a/b.git denied to u.', 'fatal: unable to access x: The requested URL returned error: 403', 'no-permission'],
    ['remote: Repository not found.', 'fatal: repository x not found', 'no-permission'],
    ['fatal: unable to access x: Could not resolve host: example.invalid', '', 'network'],
    ['fatal: unable to access x: Operation too slow. Less than 1000 bytes/sec transferred the last 2 seconds', '', 'stalled'],
    ['fatal: something we have never seen', '', 'other'],
  ]
  for (const [a, b, want] of cases) {
    const got = credMod.classifyGitFailure(128, a + '\n' + b)
    check(got === want, '分类：' + want + '（实得 ' + got + '）')
  }
  check(['need-credentials', 'auth-rejected', 'no-permission', 'network', 'stalled', 'timeout', 'budget-exhausted', 'spawn-failed'].every((k) => typeof credMod.hintFor(k) === 'string' && credMod.hintFor(k).length > 10), '每一档都有能照做的话术')
  check(credMod.hintFor('need-credentials').indexOf('命令行') >= 0 && credMod.hintFor('need-credentials').indexOf('侧栏终端') < 0, 'need-credentials 的话术指去命令行自己解决、不再提侧栏终端（不代替用户登录）')

  // ---- C) 真跑三环境（全部打 127.0.0.1，离线可跑） ----
  const lab = makeLab()
  await withIsolation(async function () {
    // ① 已配凭据助手：假助手把凭据喂进凭据链 → 成功
    let srv = await startServer('auth')
    let run = await makeRunner(lab)
    let r = await run.safe.runOnce({ cwd: lab.dir, clearHelpers: true, args: ['-c', 'credential.helper=' + lab.helperSnippet, 'ls-remote', srv.url] })
    check(r.ok === true && r.kind === 'ok', '① 有可用凭据：命令成功（实得 ' + r.kind + '）')
    check(srv.seen.some((s) => s.auth === true), '① 服务端收到了合法 Basic 凭据（说明凭据链真的把凭据送到了远端）')
    check(r.elapsedMs < 5000, '① 正常路径没有额外拖时间（' + r.elapsedMs + 'ms）')
    check(run.log.events.some((e) => e.event === 'git.exec' && e.fields.exitCode === 0), '① 走的是共享出口的那条 git.exec 日志（via 与字段不变）')
    check(run.log.outbound >= 1, '① 起进程之前报过闸（gate.noteOutbound）')
    await srv.close()

    // ② 需要交互登录：助手链空 → 快速失败并给出照做的指引
    srv = await startServer('auth')
    r = await run.safe.runOnce({ cwd: lab.dir, clearHelpers: true, args: ['ls-remote', srv.url] })
    check(r.ok === false && r.kind === 'need-credentials', '② 没有凭据：归类 need-credentials（实得 ' + r.kind + '）')
    check(r.elapsedMs < 5000, '② 快速失败，不挂在等输入上（' + r.elapsedMs + 'ms）')
    check(typeof r.hint === 'string' && r.hint.indexOf('命令行') >= 0 && r.hint.indexOf('侧栏终端') < 0, '② 失败说明里带能照做的话（指去命令行自己解决，不提侧栏终端）')
    await srv.close()

    // ③ 凭据不对 → auth-rejected；凭据对但服务端 403 → no-permission
    srv = await startServer('noauth')
    const wrong = '!f() { echo username=u839; echo password=wrong; }; f'
    r = await run.safe.runOnce({ cwd: lab.dir, clearHelpers: true, args: ['-c', 'credential.helper=' + wrong, 'ls-remote', srv.url] })
    check(r.ok === false && (r.kind === 'auth-rejected' || r.kind === 'no-permission'), '③ 凭据不对：归类 auth-rejected（实得 ' + r.kind + '）')
    await srv.close()
    srv = await startServer('forbidden')
    r = await run.safe.runOnce({ cwd: lab.dir, clearHelpers: true, args: ['-c', 'credential.helper=' + lab.helperSnippet, 'ls-remote', srv.url] })
    check(r.ok === false && r.kind === 'no-permission', '③ 有凭据但没权限：归类 no-permission（实得 ' + r.kind + '）')
    check(r.exitCode !== 0, '③ 失败信封里带 git 的退出码')
    await srv.close()

    // ③b 失败信封的两处补强（#841 地基探针 F1/F2）：message 取真原因、detail 给截断后的 stderr 尾巴
    const longStderr = 'warning: use of unencrypted HTTP remote URLs is not recommended\n' + 'x'.repeat(3000) + '\nfatal: the real reason we came for\n'
    const fakeRun = credMod.createCredentialSafeGit({ runGit: async () => ({ kind: 'non-zero', exitCode: 128, stderr: longStderr }), getPlatform: async () => ({ resolveExecutable: async () => 'git' }), getEnv: () => null, DEFAULT_CWD: lab.dir })
    const rFake = await fakeRun.runOnce({ cwd: lab.dir, args: ['ls-remote', 'https://example.invalid/x.git'] })
    check(rFake.ok === false && /^fatal: the real reason/.test(rFake.message), '③b F2：失败说明取最后一条 fatal: 行，不吃前面的警告横幅（实得「' + String(rFake.message).slice(0, 60) + '」）')
    check(typeof rFake.detail === 'string' && rFake.detail.indexOf('已截断') >= 0 && rFake.detail.length < 1700, '③b F1：信封带截断后的 stderr 尾巴并标注已截断（长度 ' + String(rFake.detail).length + '）')
    check(rFake.detail.indexOf('the real reason') >= 0, '③b F1：尾巴保留真原因那一行（写层读不到 stderr 时靠它）')

    // ④ 停顿判据：黑洞 + 低速阈值 → git 自己放弃（stalled）
    srv = await startServer('blackhole')
    const runStall = await makeRunner(lab, { lowSpeedSeconds: 2 })
    r = await runStall.safe.runOnce({ cwd: lab.dir, clearHelpers: true, args: ['ls-remote', srv.url], timeoutMs: 15000 })
    check(r.ok === false && r.kind === 'stalled', '④ 黑洞：git 按低速阈值自己放弃（实得 ' + r.kind + '，' + r.elapsedMs + 'ms）')
    check(r.elapsedMs < 10000, '④ 放弃得比预算早（' + r.elapsedMs + 'ms）')

    // ⑤ 预算兜底：把低速阈值关掉，同一条黑洞命令必须由每操作预算强杀
    const runNoStall = await makeRunner(lab, { stripEnvKeys: ['GIT_HTTP_LOW_SPEED_LIMIT', 'GIT_HTTP_LOW_SPEED_TIME'] })
    r = await runNoStall.safe.runOnce({ cwd: lab.dir, clearHelpers: true, args: ['ls-remote', srv.url], timeoutMs: 2000 })
    check(r.ok === false && r.kind === 'timeout', '⑤ 没有低速阈值时：每操作预算到点强杀（实得 ' + r.kind + '，' + r.elapsedMs + 'ms）')
    check(r.elapsedMs >= 1500 && r.elapsedMs < 6000, '⑤ 强杀发生在预算附近（' + r.elapsedMs + 'ms）')
    check(runNoStall.log.terminations >= 1, '⑤ 强杀走的是共享出口的 handle.terminate()')

    // ⑥ 调用级总预算：一次调用里的每一步共用它；用完下一步直接拒绝
    const call = runNoStall.safe.startCall({ totalBudgetMs: 3000 })
    r = await call.run({ cwd: lab.dir, clearHelpers: true, args: ['ls-remote', srv.url] })
    check(r.ok === false && r.kind === 'timeout' && r.elapsedMs < 6000, '⑥ 调用级总预算把这一步压到总预算之内（实得 ' + r.kind + '，' + r.elapsedMs + 'ms）')
    r = await call.run({ cwd: lab.dir, clearHelpers: true, args: ['ls-remote', srv.url] })
    check(r.ok === false && r.kind === 'budget-exhausted', '⑥ 总预算用完：下一步直接 budget-exhausted（实得 ' + r.kind + '）')
    await srv.close()

    // ⑦ 进程树：假 ssh 睡 30 秒 → 预算到点，连孙进程一起清掉
    const runSsh = await makeRunner(lab, {})
    r = await runSsh.safe.runOnce({ cwd: lab.dir, args: ['ls-remote', 'ssh://git@127.0.0.1:2222/x.git'], timeoutMs: 2500 })
    check(r.ok === false && r.kind === 'timeout', '⑦ 假 ssh 卡住：预算到点强杀（实得 ' + r.kind + '）')
    check(typeof r.suspect === 'string' && r.suspect.indexOf('ssh') >= 0, '⑦ 失败说明里点名「疑似卡在 ssh 通道」')
    const sshPid = fs.existsSync(lab.sshPidFile) ? Number(fs.readFileSync(lab.sshPidFile, 'utf8').trim()) : 0
    check(sshPid > 0, '⑦ 假 ssh 真的被 git 起来了（说明 GIT_SSH_COMMAND 那一道被走）')
    if (sshPid > 0) {
      let gone = false
      for (let i = 0; i < 20 && !gone; i += 1) { if (!isAlive(sshPid)) gone = true; else cp.spawnSync(process.execPath, ['-e', 'setTimeout(function(){},50)'], { windowsHide: true }) }
      check(gone, '⑦ 孙进程也清掉了（适配器按 DSH 的受管范围语义拆整棵树）')
    }
  })

  // ---- C2) 这台机器上真实的凭据助手（不隔离配置）：非交互开关必须把它按成快失败 ----
  const helperName = cp.spawnSync('git', ['config', '--get', 'credential.helper'], { encoding: 'utf8' }).stdout.trim()
  if (helperName) {
    const srvReal = await startServer('auth')
    const runReal = await makeRunner(lab)
    const rReal = await runReal.safe.runOnce({ cwd: lab.dir, args: ['ls-remote', srvReal.url], timeoutMs: 8000 })
    check(rReal.ok === false && rReal.kind === 'need-credentials' && rReal.elapsedMs < 8000, '②b 真机凭据助手 ' + helperName + '：被按成快失败（' + rReal.kind + '，' + rReal.elapsedMs + 'ms）')
    check(typeof rReal.suspect === 'string' && rReal.suspect.indexOf(helperName) >= 0, '②b 失败说明里报出「疑似卡在」的助手名（' + rReal.suspect + '）')
    await srvReal.close()
  } else info('这台机器没配凭据助手，②b 跳过（不算失败）')

  // ---- D) 反证：把被守的东西改坏，同一套断言必须当场判红 ----
  const envViolations = (env) => {
    const bad = []
    if (!env || env.GIT_TERMINAL_PROMPT !== '0') bad.push('GIT_TERMINAL_PROMPT')
    if (!env || env.GCM_INTERACTIVE !== 'never') bad.push('GCM_INTERACTIVE')
    if (!env || !('GIT_ASKPASS' in env) || env.GIT_ASKPASS !== undefined) bad.push('GIT_ASKPASS 墓碑')
    if (!env || !('DISPLAY' in env) || env.DISPLAY !== undefined) bad.push('DISPLAY 墓碑')
    if (!env || !/BatchMode=yes/.test(String(env.GIT_SSH_COMMAND))) bad.push('ssh BatchMode')
    return bad
  }
  const budgetViolations = (B, callBudget) => {
    const bad = []
    if (!(B.fetch > 0)) bad.push('fetch 预算为正')
    if (!(B.push >= B['ls-remote'])) bad.push('写操作预算不窄于只读')
    if (!(callBudget >= B.pull)) bad.push('调用级总预算不小于单操作')
    return bad
  }
  check(envViolations(env0).length === 0, '反证对照：真实现的环境契约零违规')
  check(envViolations({}).length >= 4, '反证：环境契约被掏空时必须判红（被逮住 ' + envViolations({}).length + ' 条）')
  const brokenClassify = () => 'other'
  check(['need-credentials', 'auth-rejected', 'no-permission', 'stalled'].every((k) => brokenClassify() !== k), '反证：把分类器改成「全归 other」，上面那批分档断言必然判红')
  check(budgetViolations(credMod.OPERATION_BUDGETS, credMod.CALL_BUDGET_MS).length === 0, '反证对照：真预算表零违规')
  const brokenBudgets = Object.assign({}, credMod.OPERATION_BUDGETS, { fetch: 1, pull: 1, push: 1 })
  check(budgetViolations(brokenBudgets, credMod.CALL_BUDGET_MS).length > 0, '反证：写操作预算被压到比只读还窄时必须判红（被逮住 ' + budgetViolations(brokenBudgets, credMod.CALL_BUDGET_MS).join('、') + '）')

  console.log(failed ? '\n存在失败 — verify-839-credential-exec 未通过' : '\n全部通过 — 宿主执行层门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
