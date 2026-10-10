/**
 * backends/github/client.js — gh CLI 封装（契约对齐版）。
 *
 * 定版依据：#138 §1.3 + #129 平台三底座（BackendContext.platform 已解析实例注入）。
 * - gh 可执行经 `platform.resolveExecutable('gh')`（null → env fail，不抛）
 * - 命令执行经 `ctx.exec('gh', args, {cwd, timeout, signal})`（timeout 30s，signal abort）
 * - 超时/signal 与 timers 竞速由 ctx.exec 内部托管（此处只透传 opts）
 * - stdout 解析在调用方（issues/comments 等）；此处只做 exec+错误归一化，不产 parse kind（parse 由 JSON 层）
 * - 返回 OpResult，不 throw；错误经 classifyGhError 归一（env/auth/rate-limit/not-found/network）
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { classifyGhError } from './errors.js'
import { timeoutForGhArgs, isWriteGhArgs } from '../../../../shared/tracker/outbound-tiers.js'
import { getGhLane, isAdmissionCancelled } from '../../../../shared/tracker/outbound-admission.js'
import { getChainRide } from '../../../../shared/refresh/chain-ride.js'

// 房内埋点（#494 O1）：gh.exec（#5 常驻）/ gh.timeout（#6 告警）/ gh.resolve.fail（#7 告警），字段按 #489 附录 1.4。
// gh.exec 高频：外层先判 isEnabled（信息），关闭时不组装字段；告警两项常驻直发；参数只记命令名，不记完整参数（避免令牌落盘）。
function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch { return '00000000' } }

function roomLogEvent(ctx, level, event, fields) {
  try {
    const f = ctx && typeof ctx.logEvent === 'function' ? ctx.logEvent : null
    if (!f) return
    f(level, event, fields)
  } catch {}
}

function roomInfoEnabled(ctx) {
  try {
    if (ctx && typeof ctx.isEnabled === 'function') return ctx.isEnabled('info') === true
    return true
  } catch { return true }
}

/**
 * 这一层起 gh 命令时用的默认超时（毫秒）。#723（T19）把它交出去：`src/host/detectChain.js` 里
 * 那条链要按「命令 + 工作目录 + 超时」认「是不是同一件事」，从前它在自己文件里又写了一遍
 * 30000 —— 两处各写一份，改一处就会静默对不上（实测踩过：一边带 30000、一边不带，白问两遍）。
 * 现在那个文件从宿主接线接这一个数（`src/host/registerPhones.js` 转发），全仓只有这一处字面量。
 */
export const TIMEOUT_MS = 30000

function getExec(ctx) {
  if (ctx && typeof ctx.exec === 'function') return ctx.exec.bind(ctx)
  // 兼容：BackendContext.platform + fs/timers 注入时，exec 可能在 ctx 上或 ctx.platform 上
  if (ctx && ctx.platform && typeof ctx.platform.exec === 'function') return ctx.platform.exec.bind(ctx.platform)
  return null
}

/**
 * #723（T19）：这一笔真实出站报给闸（I1）。闸由接线处注入（`ctx.gate`，production 里是
 * `src/host/refresh/gate.js` 的产物），本房不 import 它（跨房间/同层引用都不许）。
 * 房内不报的后果是账对不上（漏网计数会露出来），所以没接上时这里什么都不做 —— 不允许
 * 「没接上就自己发出去还不说」。
 */
function reportOutbound(ctx, args) {
  try {
    const gate = ctx && ctx.gate
    if (!gate || typeof gate.noteOutbound !== 'function') return
    const isGraphql = String(args && args[0] || '').indexOf('graphql') >= 0
    gate.noteOutbound({ requests: 1, points: isGraphql ? 1 : 0 })
  } catch { /* 报账失败不许影响已经起来的这一条命令 */ }
}

function getPlatform(ctx) {
  if (ctx && ctx.platform && typeof ctx.platform.resolveExecutable === 'function') return ctx.platform
  if (ctx && typeof ctx.resolveExecutable === 'function') return ctx
  return null
}

function getCwd(ctx, explicitCwd) {
  if (explicitCwd) return explicitCwd
  if (ctx && typeof ctx.cwd === 'string' && ctx.cwd) return ctx.cwd
  return undefined
}

export function ghClient(ctx) {
  const platform = getPlatform(ctx)
  const exec = getExec(ctx)

  // #7 gh.resolve.fail（告警，常驻）：只记是否配备用路径与错误散列，不记路径原文。
  function emitResolveFail(message) {
    try {
      let hasGhPath = false
      try {
        const env = ctx && ctx.platform && ctx.platform.env ? ctx.platform.env : (platform && platform.env ? platform.env : null)
        hasGhPath = !!(env && typeof env.get === 'function' && env.get('DSH_GH_PATH'))
      } catch {}
      roomLogEvent(ctx, 'warn', 'gh.resolve.fail', { hasDSH_GH_PATH: hasGhPath, errorHash: hash8(message) })
    } catch {}
  }

  async function resolveGh(cwd) {
    if (!platform) {
      // platform 缺失 → env（按 contract §2，capability-by-fill 不可静默成功）
      emitResolveFail('gh not found: platform.resolveExecutable unavailable')
      return { ok: false, error: fail(ERROR_KIND.ENV, 'gh not found: platform.resolveExecutable unavailable').error }
    }
    try {
      const p = await platform.resolveExecutable('gh')
      if (p) return { ok: true, ghPath: p }
      // 回退：platform 未找到时，尝试直接通过 ctx.exec 探测 gh 是否在 PATH 可执行（Windows 上 where/直接 spawn）
      // 避免因为 subprocess.resolveExecutable 的 PATH 与 pwsh 的 PATH 不一致导致 414 这类外部建票永远拉不到
      if (exec) {
        try {
          reportOutbound(ctx, ['--version'])
          const probe = await exec('gh', ['--version'], { cwd: cwd || getCwd(ctx, undefined), timeout: 3000 })
          if (probe && probe.stdout && String(probe.stdout).includes('gh version')) {
            return { ok: true, ghPath: 'gh' }
          }
          if (probe && probe.code === 0) return { ok: true, ghPath: 'gh' }
        } catch {}
      }
      emitResolveFail('gh not found: platform.resolveExecutable returned null and gh --version probe failed')
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'gh not found: platform.resolveExecutable returned null and gh --version probe failed' } }
    } catch (e) {
      emitResolveFail(String((e && e.message) || e || 'gh not found'))
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: String((e && e.message) || e || 'gh not found') } }
    }
  }

  // #5 gh.exec（信息，常驻）：高频路径，外层先判开关，关闭时不组装字段。
  // #1007 起多记一格 waitedMs：这一笔在名额队列里等了多久（没等就是 0）。
  // 有了这一格，「名额到底有没有挡过路、挡了多久」以后由日志回答，不用再靠猜着调数字。
  function emitGhExec(kind, exitCode, t0, cwd, waitedMs) {
    try {
      if (!roomInfoEnabled(ctx)) return
      roomLogEvent(ctx, 'info', 'gh.exec', { argv0: 'gh', cwdHash: hash8(cwd || ''), latencyMs: Date.now() - t0, waitedMs: (typeof waitedMs === 'number' && isFinite(waitedMs) && waitedMs > 0) ? Math.floor(waitedMs) : 0, kind: String(kind || 'unknown'), exitCode: typeof exitCode === 'number' ? exitCode : -1 })
    } catch {}
  }

  // #6 gh.timeout（告警，常驻）：只记命令名与超时毫秒。
  function emitGhTimeout(timeoutMs) {
    try {
      roomLogEvent(ctx, 'warn', 'gh.timeout', { argv0: 'gh', timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : TIMEOUT_MS })
    } catch {}
  }

  function isTimeoutText(t) { return /timeout/i.test(String(t || '')) }

  /**
   * 执行 gh 命令，返回 OpResult<{ stdout: string, stderr: string, code: number }>
   * 不做 JSON 解析；调用方自行 runJson / 解析 .out
   * 失败时 error 的形状是 {kind, message, code}：code 是 gh 的退出码（拿不到时为 -1，例如命令根本没起来）。
   */
  async function execGh(args, opts = {}) {
    const cwd = getCwd(ctx, opts.cwd)
    const t0 = Date.now()
    // #969：默认超时按读写探活分档（调用方显式 timeout 优先）；#965 读写分桶拿名额。
    const bucket = isWriteGhArgs(args) ? 'write' : 'read'
    const signal = opts.signal || (ctx && ctx.signal) || undefined
    const timeout = opts.timeout != null ? opts.timeout : timeoutForGhArgs(args)
    // #1007：房内自己掐表，而且计时从「拿名额」那一刻就开始。
    // 为什么必须盖住排队段：名额被卡住的调用占满时，新调用会在队列里一直等到外层调用钳制（30 秒）才结束，
    // 既没有上限也没有名字（日志里只看到「30 秒被取消」）。计时器盖住排队段之后，这一笔最多赔本档超时
    // （读 12 秒 / 写 30 秒 / 探活 3 秒），而且如实归到「超时」，不再混进「被取消」。
    // 两种中止要分得开：房内到点 = 超时（算失败，归网络档）；调用方取消 = 取消（不算失败，照旧可重试）。
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null
    const laneSignal = ctrl ? ctrl.signal : signal
    let selfTimedOut = false
    let deadlineTimer = null
    let deadlineResolve = null
    // 这一笔在名额队列里等了多久（#1007：gh.exec 多记这一格，answer「名额有没有挡过路」）。
    let slotWaitedMs = 0
    // 到点这件事要能「掀桌子」：光是把信号中止还不够 —— 执行器要是不理中止、那个 promise 就一直不落地，
    // 所以另备一个只用来宣告到点的 promise，把它与每一步真正在等的东西赛跑（见 raceDeadline）。
    const deadlineHit = ctrl ? new Promise(function (res) { deadlineResolve = res }) : null
    if (ctrl && typeof setTimeout === 'function') {
      deadlineTimer = setTimeout(function () {
        selfTimedOut = true
        try { ctrl.abort() } catch (eT) {}
        try { if (deadlineResolve) deadlineResolve('deadline') } catch (eD) {}
      }, timeout)
    }
    /** 让「真正在等的那件事」与「到点」赛跑；到点先落地时回一个哨兵对象。 */
    function raceDeadline(p) {
      if (!deadlineHit) return Promise.resolve(p)
      return Promise.race([
        Promise.resolve(p),
        deadlineHit.then(function () { return { __deadlineHit: true } }),
      ])
    }
    let onCallerAbort = null
    if (signal && ctrl && typeof signal.addEventListener === 'function') {
      onCallerAbort = function () { try { ctrl.abort() } catch (eC) {} }
      try { signal.addEventListener('abort', onCallerAbort, { once: true }) } catch (eA) {}
    }
    function clearDeadline() {
      try { if (deadlineTimer !== null && typeof clearTimeout === 'function') clearTimeout(deadlineTimer) } catch (e1) {}
      try { if (onCallerAbort && signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onCallerAbort) } catch (e2) {}
    }
    /** 房内到点的统一回执：横幅按超时记，内容说清等了多久、是哪一档。 */
    function selfTimeoutOutcome() {
      emitGhExec('network', -1, t0, cwd, slotWaitedMs)
      emitGhTimeout(timeout)
      return { ok: false, error: { kind: ERROR_KIND.NETWORK, message: 'gh 在 ' + timeout + ' 毫秒内没有回话（房内分档超时：读 12 秒 / 写 30 秒 / 探活 3 秒），这一笔已经中止', code: -1, timedOut: true } }
    }
    // #965：先拿名额再起进程，满了就排队等（等不是失败）；排队中被调用方取消则按取消返回，不算失败。
    let release = null
    try {
      const acquired = await raceDeadline(getGhLane().acquire({ bucket: bucket, signal: laneSignal || undefined }))
      if (acquired && acquired.__deadlineHit === true) { clearDeadline(); return selfTimeoutOutcome() }
      release = acquired
      // #1007：这一笔在名额队列里等了多久（给 gh.exec 那一格记，答「名额到底有没有挡过路」）。
      slotWaitedMs = Date.now() - t0
    } catch (eAcquire) {
      if (selfTimedOut) { clearDeadline(); return selfTimeoutOutcome() }
      clearDeadline()
      emitGhExec('cancelled', -1, t0, cwd, slotWaitedMs)
      return { ok: false, error: { kind: ERROR_KIND.NETWORK, message: '已取消排队（出站准入等待中被取消），没有发出请求，可重试', code: -1, cancelled: true } }
    }
    try {
    const resolved = await raceDeadline(resolveGh(cwd))
    if (resolved && resolved.__deadlineHit === true) return selfTimeoutOutcome()
    if (!resolved.ok) {
      emitGhExec(resolved.error && resolved.error.kind ? resolved.error.kind : 'env', -1, t0, cwd)
      // 补上 code: -1，让「失败时 error 里一定有 code」这条形状对所有失败成立（命令根本没跑起来）
      return { ok: false, error: Object.assign({ code: -1 }, resolved.error) }
    }

    if (!exec) {
      emitGhExec('env', -1, t0, cwd)
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'ctx.exec unavailable', code: -1 } }
    }

    try {
      // #723（T19）：这一笔真实出站先报给闸（I1）。报在拿名额之后 —— 排队等待不算这一笔，
      // 真要起进程了才报，取消排队的不进账，账与真实出站一一对应。
      reportOutbound(ctx, args)
      // #1007：起进程这一段同样与「到点」赛跑 —— 执行器要是不落地，房内的表到点就掀桌子。
      const raced = await raceDeadline(exec('gh', args, { cwd, timeout, signal: laneSignal }))
      if (raced && raced.__deadlineHit === true) return selfTimeoutOutcome()
      const result = raced
      // DSH ctx.exec 契约：{stdout, stderr, code}
      // #620 整改（D2）：拿不到**整数**退出码时按失败处理（-1），不再当成 0。
      //   为什么：执行器原样回传底层进程的退出码，而被信号杀掉、或还没跑完就没有退出码时它是
      //   undefined/null —— 当成 0 会把「命令根本没成功」记成改色成功（仓库其实没变）。同一条路上
      //   的日志侧本来就按 -1 处理（见上面 emitGhExec 的兜底），这里与它对齐。
      const rawCode = result && result.code
      const code = Number.isInteger(rawCode) ? rawCode : -1
      const stdout = result && typeof result.stdout === 'string' ? result.stdout : (result && result.text ? result.text : '')
      const stderr = result && typeof result.stderr === 'string' ? result.stderr : ''
      if (code !== 0) {
        const note = code === -1 ? 'gh 这一次没拿到退出码（命令可能被中断，或者根本没起来）' : `gh exit ${code}`
        const err = { message: stderr || stdout || note, stderr: stderr || stdout, code, stdout }
        // #969：超时（等满分档才放弃、且没有输出）归网络档，不归环境档，更不归登录档 ——
        // 慢网下用户看到的是“未知、稍后”，不会被误导去重登。判据两条满足一条即超时：
        // 文案含超时特征，或耗时已经达到本档超时（执行器杀掉时未必留文案）。
        const elapsedMs = Date.now() - t0
        const looksTimeout = isTimeoutText(stderr) || isTimeoutText(stdout) || (code === -1 && elapsedMs >= timeout - 50)
        const kind = looksTimeout ? ERROR_KIND.NETWORK : ((code === -1 && !stderr && !stdout) ? ERROR_KIND.ENV : classifyGhError(err, ctx))
        emitGhExec(kind, code, t0, cwd, slotWaitedMs)
        if (looksTimeout) emitGhTimeout(timeout)
        // #620：退出码要一起交回调用方。gh 自己的约定是「需要登录 = 退出码 4」（gh help exit-codes），
        // 只靠错误文案里的词去猜「是不是没登录」是巧合匹配；这里把 code 带上，分类才站得住。
        return { ok: false, error: { kind, message: String(stderr || stdout || err.message).slice(0, 800), code } }
      }
      emitGhExec('ok', 0, t0, cwd, slotWaitedMs)
      // #966 收口：写成功记一笔搭车账，写过东西之后来的探测不搭旧车。
      try { if (bucket === 'write') getChainRide().markWrite() } catch {}
      return { ok: true, data: { stdout, stderr, code } }
    } catch (e) {
      // exec 抛的错误（timeout/network 等）→ 归一化
      const elapsedMs = Date.now() - t0
      // #1007：先认房内自己那只表（它到点中止的按超时返回），再认调用方取消（那个不算失败）。
      if (selfTimedOut) return selfTimeoutOutcome()
      // #969：调用方取消（排队/在飞中被杀）按取消返回，不算失败；其余照旧归一。
      if (isAdmissionCancelled(e) || (signal && signal.aborted === true)) {
        emitGhExec('cancelled', -1, t0, cwd, slotWaitedMs)
        return { ok: false, error: { kind: ERROR_KIND.NETWORK, message: '已取消（没有发出有效请求，可重试）', code: -1, cancelled: true } }
      }
      const kind = classifyGhError(e, ctx)
      emitGhExec(kind, -1, t0, cwd, slotWaitedMs)
      const looksTimeout = isTimeoutText((e && (e.message || e.stderr)) || e) || elapsedMs >= timeout - 50
      if (looksTimeout) emitGhTimeout(timeout)
      const message = String((e && (e.message || e.stderr)) || e || 'gh exec failed').slice(0, 800)
      // code: -1 = 这次调用连退出码都没有（超时、spawn 失败之类），调用方据此知道「不是命令自己报的错」
      return { ok: false, error: { kind: looksTimeout ? ERROR_KIND.NETWORK : kind, message, code: -1 } }
    } finally {
      try { if (release) release() } catch {}
    }
    } finally {
      // 拿了名额但在 resolveGh / exec 不可用分支提前返回时，在这里放回。
      try { if (release) release() } catch {}
      // #1007：房内那只表无论走哪条路都要收掉（成功、失败、提前返回都不能留着它）。
      clearDeadline()
    }
  }

  /**
   * 执行 gh 并解析 JSON（gh --json / gh api --jq . 场景）。
   * 若 --json 输出，需 GH 输出纯 JSON；若 gh api 场景，需 stdout 为 JSON
   */
  async function execJson(args, opts = {}) {
    const r = await execGh(args, opts)
    if (!r.ok) return r
    const text = (r.data.stdout || '').trim()
    if (!text) return { ok: true, data: null }
    try {
      const parsed = JSON.parse(text)
      return { ok: true, data: parsed }
    } catch (e) {
      return { ok: false, error: { kind: ERROR_KIND.PARSE, message: `invalid json from gh: ${String(e.message).slice(0, 200)}` } }
    }
  }

  // 兼容旧签名 run / runJson（供 labels.js 等旧调用方过渡；新代码优先 execGh/execJson）
  async function run(args, cwdOrId) {
    // 旧 labels.js 调用：c.run(['issue','view',...], repoId) → repoId 此时作 cwd 兼容（若为 owner/repo 则忽略，用 ctx.cwd）
    // 为兼容，将 cwdOrId 仅在为路径（含 / 或 \ 或 :）时透传，否则忽略
    const cwd = typeof cwdOrId === 'string' && /[/\\]/.test(cwdOrId) ? cwdOrId : getCwd(ctx, undefined)
    return execGh(args, { cwd })
  }

  return {
    execGh,
    execJson,
    run, // 兼容旧调用
    // 便捷：gh api --paginate 模拟（简单封装，调用方传 --paginate 时由 execGh 直接交 gh 处理）
  }
}

export default ghClient
