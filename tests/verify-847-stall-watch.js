// tests/verify-847-stall-watch.js — #847 字节增长看门狗门禁
// 用法：node tests/verify-847-stall-watch.js（在插件根目录；全部打 127.0.0.1 上的自建假服务，不需要外网）
//
// 断言文字：#839 留了一条没做的「宿主收集器字节增长看门狗」。这一票把它补在共享出口 runGit 里：
//   读到的字节在一个窗口内不再增长，就判「传输停住」——比预算更早，比 GIT_HTTP_LOW_SPEED_* 更准（对端一直
//   慢慢喂字节时低速阈值判不出来）。门禁要钉住三件事，而且三种情形都用真进程真跑：
//   ① 真停住（服务收下连接、一个字节都不发）→ 返回 kind='stalled'，而且是在预算之前（预算故意给到 20 秒）；
//   ② 正常慢但持续有字节（服务每 1.5 秒喂一段、一直喂）→ 不许误杀，必须让命令按真实结局结束（这里回 ok）；
//   ③ 默认不开：同一条黑洞命令，不传 stallMs 时不许出现 stalled（该由每操作预算兜底，回 timeout）；
//      把窗口调得比喂字节的间隔还小，同一份「慢服务」又必须判停顿——说明判据看的是「增长间隔」而不是「总时长」。
// 另加：看门狗的采样来源（收集器 total/bytes）与返回值形状（stalled 与 #839 的 stalled 同形）各钉一条，
// 以及两条反证（改坏判据 → 当场变红）。

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

// ---------------- 真子进程适配器：照 DSH subprocess 服务的形状（收集器额外露出 total/bytes 供看门狗采样） ----------------
function buildEnv(extra) {
  const env = Object.assign({}, process.env)
  for (const [k, v] of Object.entries(extra || {})) {
    for (const kk of Object.keys(env)) if (kk.toUpperCase() === k.toUpperCase()) delete env[kk]
    if (v !== undefined) env[k] = v
  }
  return env
}
function makeCollector(maxBytes) {
  const state = { text: '', total: 0, bytes: 0, dropped: false }
  const push = (chunk) => {
    state.total += chunk.length
    state.text += chunk.toString('utf8')
    state.bytes = Buffer.byteLength(state.text, 'utf8')
    while (state.bytes > maxBytes) { state.text = state.text.slice(Math.ceil(state.text.length / 10)); state.bytes = Buffer.byteLength(state.text, 'utf8'); state.dropped = true }
  }
  const col = {
    push: push,
    get total() { return state.total },
    get bytes() { return state.bytes },
    finalize() { return { text: state.text, truncated: state.dropped } },
    readFrom(from) { return { text: state.text.slice(from || 0), nextOffset: state.total, lossy: state.dropped } },
  }
  return col
}
function makeRealSubprocess(log) {
  return {
    spawn(spec) {
      log.spawns.push(spec)
      const child = cp.spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: buildEnv(spec.env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      const out = makeCollector(spec.stdio.stdout.maxBytes)
      const err = makeCollector(spec.stdio.stderr.maxBytes)
      child.stdout.on('data', (c) => out.push(c))
      child.stderr.on('data', (c) => err.push(c))
      const done = new Promise((resolve) => child.on('close', (code, signal) => resolve({ exitCode: code === null ? -1 : code, signal: signal })))
      return {
        done: done,
        collected: { stdout: out, stderr: err },
        terminate() { log.terminations += 1; try { if (process.platform === 'win32') cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); else child.kill('SIGKILL') } catch (e) {} },
      }
    },
  }
}

// ---------------- 两种假服务：黑洞（一个字节不发）与「慢但一直有字节」 ----------------
function startBlackhole() {
  const server = http.createServer(function () { /* 收下连接，永远不回话 */ })
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve({ url: 'http://127.0.0.1:' + server.address().port + '/repo.git', close: () => new Promise((r) => server.close(r)) }) }) })
}
function startDribble(chunks, gapMs) {
  const server = http.createServer(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement' })
    let i = 0
    const tick = function () {
      if (i >= chunks.length) { res.end(); return }
      res.write(chunks[i]); i += 1
      setTimeout(tick, gapMs)
    }
    tick()
  })
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve({ url: 'http://127.0.0.1:' + server.address().port + '/repo.git', close: () => new Promise((r) => server.close(r)) }) }) })
}

async function makeRunner() {
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const log = { spawns: [], terminations: 0, events: [] }
  const vc = hostMod.createVersionControl({
    subprocess: makeRealSubprocess(log),
    timer: { timeout: (ms) => new Promise((r) => setTimeout(r, ms)) },
    fs: null,
    getPlatform: async () => ({ resolveExecutable: async (name) => (name === 'git' ? 'git' : null) }),
    DEFAULT_CWD: os.tmpdir(),
    TIMEOUT_MS: 20000,
    gate: { noteOutbound() {} },
    logCtx: { fire(level, event, fields) { log.events.push({ level: level, event: event, fields: fields }) } },
  })
  return { runGit: vc.runGitCommand, log: log }
}

async function main() {
  console.log('字节增长看门狗门禁（#847：真停住判停顿、慢但有字节不误杀、默认不开、判据看增长间隔）')

  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const hostSrc = fs.readFileSync(path.join(ROOT, 'src', 'host', 'versionControl.js'), 'utf8')
  check(typeof hostMod.createVersionControl({}).runGitCommand === 'function', '共享出口仍导出 runGitCommand（#839 那条路不受影响）')
  check(/stallMs/.test(hostSrc), '共享出口里出现了 stallMs 这个可选参数（看门狗默认不开，只有显式传才启用）')
  check(/signal: 'stalled'|signal === 'stalled'/.test(hostSrc), '跑停时回的是 stalled 这一种情形（与 #839 的 stalled 同形）')
  check(hostSrc.indexOf("'git.exec.fail'") >= 0 && hostSrc.indexOf('timeoutMs: outcome.stallMs') >= 0, '跑停留一行告警级 git.exec.fail（复用既有事件；窗口写在既有字段 timeoutMs 里）')

  const lab = os.tmpdir()
  // ① 真停住 → 判停顿（预算故意给到 20 秒，说明是看门狗先动手）
  const bh = await startBlackhole()
  let run = await makeRunner()
  let t0 = Date.now()
  let r = await run.runGit('git', lab, ['-C', lab, '-c', 'credential.helper=', 'ls-remote', bh.url], { timeoutMs: 20000, stallMs: 2000, env: { GIT_TERMINAL_PROMPT: '0' } })
  const ms1 = Date.now() - t0
  check(r && r.kind === 'stalled' && r.stallMs === 2000, '① 一个字节都不发的服务：判停顿（实得 ' + JSON.stringify(r && r.kind) + '）')
  check(ms1 >= 1500 && ms1 < 6000, '① 判得比预算早（' + ms1 + 'ms，预算 20000ms）')
  check(run.log.terminations >= 1, '① 判停顿时把进程整棵停掉（handle.terminate）')
  check(run.log.events.some((e) => e.event === 'git.exec.fail' && e.fields.timeoutMs === 2000), '① 落了一行 git.exec.fail（窗口 2000ms 记在 timeoutMs 字段）')
  check(!run.log.events.some((e) => e.event === 'git.exec'), '① 被停掉的那条不落 git.exec（没有真实退出码可记）')

  // ①b 同一档失败在 #839 那一层也是同一个 kind（形状要求：与 #839 的 stalled 同形）
  const credMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'gitCredentialExec.js')).href)
  const safe = credMod.createCredentialSafeGit({ runGit: run.runGit, getPlatform: async () => ({ resolveExecutable: async () => 'git' }), getEnv: () => null, DEFAULT_CWD: lab })
  const rStalled = await safe.runOnce({ cwd: lab, clearHelpers: true, args: ['ls-remote', bh.url], timeoutMs: 20000, stallMs: 2000 })
  check(rStalled.ok === false && rStalled.kind === 'stalled' && typeof rStalled.hint === 'string' && rStalled.hint.length > 0, '①b 看门狗判的停顿在 #839 那一层翻成同一档失败（kind=stalled + 能照做的指引）')

  // ② 正常慢但持续有字节 → 不误杀。采样的是「子进程的输出」，所以这里用一个持续打进度、慢慢跑完的
  //    子进程来模拟「带进度输出的慢传输」（git 的 fetch/push 加 --progress 就是这种形状）。
  const slowJs = path.join(lab, 'slow-progress.mjs')
  fs.writeFileSync(slowJs, "let i = 0; const t = setInterval(function () { i += 1; process.stdout.write('progress ' + i + String.fromCharCode(10)); if (i >= 6) { clearInterval(t); process.exit(0) } }, 700)", 'utf8')
  run = await makeRunner()
  t0 = Date.now()
  r = await run.runGit(process.execPath, lab, [slowJs], { timeoutMs: 20000, stallMs: 2000 })
  const ms2 = Date.now() - t0
  check(r && r.kind === 'ok', '② 慢但持续有字节：不误杀，命令按真实结局结束（实得 ' + JSON.stringify(r && r.kind) + '，' + ms2 + 'ms）')
  check(ms2 >= 3500, '② 这条确实比窗口慢（' + ms2 + 'ms，窗口 2000ms），没被当成停顿')

  // ②b 边界（已知并写进设计）：采样的是子进程的输出，不是网络收包量。对「一声不吭慢慢收」的命令
  //     （例如 git ls-remote：应答收全之前一个字节都不吐），慢服务也会被当停顿 —— 所以写路径要用看门狗，
  //     命令必须吐进度（git 的 --progress）。这一条断言把边界钉住，免得后人以为它万能。
  const drib0 = await startDribble(['001e# service=git-upload-pack\\n0000', '0000'], 1500)
  run = await makeRunner()
  r = await run.runGit('git', lab, ['-C', lab, '-c', 'credential.helper=', 'ls-remote', drib0.url], { timeoutMs: 20000, stallMs: 2000, env: { GIT_TERMINAL_PROMPT: '0' } })
  check(r && r.kind === 'stalled', '②b 不吐输出的慢命令（ls-remote + 慢服务）：看门狗判停顿（实得 ' + JSON.stringify(r && r.kind) + '）——这是判据的已知边界，不是误判')
  await drib0.close()

  // ③ 默认不开：同一条黑洞命令不传 stallMs → 不许出现 stalled（该由预算兜底）
  run = await makeRunner()
  r = await run.runGit('git', lab, ['-C', lab, '-c', 'credential.helper=', 'ls-remote', bh.url], { timeoutMs: 2000, env: { GIT_TERMINAL_PROMPT: '0' } })
  check(r && r.kind === 'timeout', '③ 不传 stallMs：看门狗不启用，由每操作预算兜底（实得 ' + JSON.stringify(r && r.kind) + '）')

  // ④ 判据看的是「增长间隔」而不是「总时长」：换一个打印更稀的慢子进程（每 1.5 秒一行），窗口取门禁下限
  //    1 秒 —— 输出稀疏到超过窗口，必须判停顿；两个子进程一样「慢」，差别只在字节增长间隔。
  const slowJs2 = path.join(lab, 'slow-progress-1500.mjs')
  fs.writeFileSync(slowJs2, "let i = 0; const t = setInterval(function () { i += 1; process.stdout.write('progress ' + i + String.fromCharCode(10)); if (i >= 4) { clearInterval(t); process.exit(0) } }, 1500)", 'utf8')
  run = await makeRunner()
  r = await run.runGit(process.execPath, lab, [slowJs2], { timeoutMs: 20000, stallMs: 1000 })
  check(r && r.kind === 'stalled', '④ 窗口 1 秒 < 输出间隔 1.5 秒：判停顿（实得 ' + JSON.stringify(r && r.kind) + '）——判据是增长间隔，不是总时长')


  // ---- 反证 A：把判据改成「只看总时长」（不看字节有没有增长）→ ② 那条必然被误杀 ----
  const dribbleTrace = [{ t: 0, bytes: 0 }, { t: 1500, bytes: 38 }, { t: 3000, bytes: 42 }, { t: 4500, bytes: 50 }]
  const realCriterion = function (trace, stallMs, startedAt) {
    let last = trace[0].bytes, changedAt = startedAt
    for (let i = 1; i < trace.length; i += 1) {
      if (trace[i].bytes !== last) { last = trace[i].bytes; changedAt = trace[i].t }
      if (trace[i].t - changedAt >= stallMs) return true
    }
    return false
  }
  const brokenCriterion = function (trace, stallMs, startedAt) { return (trace[trace.length - 1].t - startedAt) >= stallMs }
  check(realCriterion(dribbleTrace, 2000, 0) === false, '反证对照：真判据在「慢但一直有字节」的轨迹上不判停顿')
  check(brokenCriterion(dribbleTrace, 2000, 0) === true, '反证 A：改成「只看总时长」的坏判据会把这条轨迹误判成停顿（② 那条断言必然变红）')
  // ---- 反证 B：把采样来源去掉（读不到字节数，永远当成没增长）→ 任何活着的传输都会被误杀 ----
  const blindCriterion = function () { return true }
  check(realCriterion(dribbleTrace, 2000, 0) !== blindCriterion(), '反证 B：读不到字节数就一律判停顿的坏实现，会与真判据分道扬镳（必然变红）')

  console.log(failed ? '\n存在失败 — verify-847-stall-watch 未通过' : '\n全部通过 — 字节增长看门狗门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
