/**
 * refresh-core/src/create-write.ts —— 建票那一次写请求的结果判据（纯函数，#722）
 *
 * 这个文件只回答两个问题，别的都不管：
 *   ① 这一次建票请求的回包，说明「票建出来了没有」？
 *   ② 拿不准的时候，还许不许再发一次写请求？
 *
 * 为什么这两问必须住在纯函数里（票面 #722 的硬要求）：它们判错不是崩溃，而是**远端多出一张票**
 * ——一次调用里先后发两次可能都成功的写，第一次其实建成了、只是回包没拿到（超时、EOF、回包形状不对），
 * 回落那条会再建一张，而两次调用都回成功。这种错在界面上看不出来，只有把每种回包形态穷举测一遍才拦得住。
 * 所以这里没有一行读盘、联网、看时钟、读环境变量的代码：输入是「一次 glab 调用的退出码与两路输出」，
 * 输出是「四档结论 + 一句给人看的原因」与「许不许再发一次」。
 * 调它的那一侧在 src/host/tracker/backends/gitlab/create-write.js，负责真的起进程、真的记次数。
 *
 * 四档结论（每一档都对应一句大白话，见 reason）：
 *   created          回包是一个带 iid 的票面 —— 票建出来了，这一趟结束。
 *   never-sent       **这台机器上 glab 根本没跑起来**（找不到可执行文件、起进程就失败了）：
 *                    请求一个字节都没发出去，远端不可能有这张票。只有这一档才允许再发一次。
 *   endpoint-absent  远端明确回答「这个端点不存在」（404 / 405 这类）：确定没有建出票，
 *                    但同一条请求再发一次也是同样的回答，所以不发。
 *   maybe-written    其余全部（超时、连接中断、回包丢了、5xx、回包不是票面……）：
 *                    **票有可能已经建出来了**。这一档绝不再发写请求，如实把不确定交回去。
 *
 * 判「没发出去」为什么卡得这么死：这一档是唯一允许再发一次写请求的档，判宽的代价就是重复建票。
 * 所以每一条证据都必须直接指向「程序没启动起来」（命令找不到、起进程失败），而**不是**泛泛的
 * 「有文件不存在」——后者完全可能是 glab 已经把票建好了、收尾时写本地缓存失败的报错，
 * 把它当成「没发出去」正是本票要堵的那个洞。
 */

// 这里原来有一行 `export const CREATE_WRITE_SOURCE = 'refresh-core/src/create-write.ts'`。#719 把它删掉：
// 全仓没有任何代码读它，而产物第一行的 AUTO-GENERATED 包头（由 refresh-core/build.mjs 按真实文件名
// 生成）已经把「这份 JS 从哪来」写清楚了——手写一份同样的字符串只可能漂移。
// 空壳产物（refresh-core/src/ports.ts）不一样：它的产物里只剩那一行标识，所以 PORTS_SOURCE 留着。

/** 四档结论。字面会被门禁与报告引用，只许加、不许改字面。 */
export type CreateWriteVerdict = 'created' | 'never-sent' | 'endpoint-absent' | 'maybe-written'

/** 一次 glab 调用的结果（形状与 src/host/tracker/backends/gitlab/client.js 的返回值一致）。 */
export interface CreateWriteResponse {
  code?: number
  stdout?: string
  stderr?: string
}

/** 一次建票回包的判据结果。created 时 issue 就是从回包里解出来的那张票（原始形状，未归一化）。 */
export interface CreateWriteJudgement {
  verdict: CreateWriteVerdict
  issue: Record<string, unknown> | null
  reason: string
}

/** 「还许不许再发一次写请求」的结论。 */
export interface CreateWriteRetryDecision {
  retry: boolean
  reason: string
}

/**
 * 「程序没启动起来」的证据。每一条都点名 glab，或者是本插件客户端自己写的「平台/执行器不可用」，
 * 不用泛泛的「文件不存在」——理由见文件头。
 */
const NEVER_STARTED_RE = /['"]?glab['"]? (?:command not found|is not recognized as an internal or external command)|command not found: glab|which: no glab|glab not found in path|cannot find glab|spawn (?:[^\s]*[\\/])?glab(?:\.exe|\.cmd|\.bat)? (?:enoent|eacces|eperm)|platform unavailable|exec unavailable/i

/** 「远端说这个端点不存在」的证据：404 / 405 两种回答，或它们的英文原话。 */
const ENDPOINT_ABSENT_RE = /\b40[45]\b|method not allowed|404 not found/i

/** 一句话里的空白压成一个空格，太长只留前 200 个字（给读日志与读界面的人看，不进白名单日志）。 */
function firstLine(text: string): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > 200 ? s.slice(0, 200) + '（已截断）' : s
}

/** 回包里那张票：必须是一个对象、且带着 iid；除此之外一律当成「不是一个票面」。 */
function issueOf(stdout: string): Record<string, unknown> | null {
  const t = String(stdout || '').trim()
  if (!t) return null
  try {
    const parsed: unknown = JSON.parse(t)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const bag = parsed as Record<string, unknown>
    const iid = bag.iid
    if (iid === undefined || iid === null || iid === '') return null
    return bag
  } catch {
    return null
  }
}

/**
 * 判一次建票写请求的结果。入参就是那次 glab 调用的退出码与两路输出，别的一概不看。
 * @param res 一次 glab 调用的结果
 */
export function classifyCreateWriteAttempt(res: CreateWriteResponse): CreateWriteJudgement {
  const code = res && typeof res.code === 'number' && isFinite(res.code) ? res.code : 1
  const stdout = res && typeof res.stdout === 'string' ? res.stdout : ''
  const stderr = res && typeof res.stderr === 'string' ? res.stderr : ''
  const issue = issueOf(stdout)
  if (code === 0 && issue) {
    return { verdict: 'created', issue, reason: '回包里带着这张票的 iid，票确实建出来了' }
  }
  // 退出码 127 是本插件客户端在「平台不可用 / 执行器不可用 / 找不到 glab」三种情况下自己写的，
  // 与「命令找不到」同义；其余情况一律看输出里有没有直接指向「程序没启动起来」的原话。
  const text = firstLine((stdout ? stdout + ' ' : '') + stderr)
  if (code === 127 || NEVER_STARTED_RE.test(text)) {
    return { verdict: 'never-sent', issue: null, reason: '这台机器上 glab 没能跑起来（' + text + '），这一次请求一个字节都没发出去' }
  }
  if (ENDPOINT_ABSENT_RE.test(text)) {
    return { verdict: 'endpoint-absent', issue: null, reason: '远端回的是「这个端点不存在」（' + text + '），这一次确定没有建出票' }
  }
  const head = code === 0 ? '回包不是一个带 iid 的票面（' : '这一次没有拿到确定的回答（'
  return { verdict: 'maybe-written', issue: null, reason: head + text + '），票有可能已经建出来了' }
}

/**
 * 还许不许再发一次写请求。
 *
 * 规则只有一条：**只有「这一次请求确定一个字节都没发出去」才许再发一次，而且整个调用最多再发一次。**
 * 其余任何情况（含超时、EOF、回包丢了、回包形状不对、5xx、404/405）一律不发 ——
 * 那些情形里第一次写都有可能已经落到远端了，再发就是第二张票。
 *
 * @param verdict 上一次建票请求的判据结论
 * @param writeAttemptsMade 这个调用到目前为止已经发了几次建票写请求（含刚刚那一次）
 */
export function decideCreateWriteRetry(verdict: CreateWriteVerdict, writeAttemptsMade: number): CreateWriteRetryDecision {
  const made = typeof writeAttemptsMade === 'number' && isFinite(writeAttemptsMade) ? writeAttemptsMade : 0
  if (verdict === 'never-sent') {
    if (made <= 1) return { retry: true, reason: '上一次请求确定一个字节都没发出去（glab 没跑起来），远端不可能有这张票，再发一次是同一条请求的第一次真正出站' }
    return { retry: false, reason: '这个调用已经重发过一次了，不论再试几次都不会有第三次' }
  }
  if (verdict === 'maybe-written') return { retry: false, reason: '这一次写有可能已经落到远端了：再发一次就可能多出一张重复的票，所以不发' }
  if (verdict === 'endpoint-absent') return { retry: false, reason: '远端明确说这个端点不存在：同一条请求再发一次也是同样的回答，把这个信号原样交给调用方' }
  return { retry: false, reason: '票已经建出来了，没有要重发的东西' }
}
