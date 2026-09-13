/**
 * backends/github/errors.js — gh/API 错误 → 契约 ERROR_KIND。
 *
 * 定版依据：#138 不变量 II（错误分类顺序纪律）+#124 错误枚举。
 * - 顺序：已规范 TrackerError 透传 → env（gh not found/ENOENT/resolveExecutable null）先于 not-found
 *           → auth（not logged in/401/403）先于 rate-limit（429/rate limit）→ not-found（404）→ network 兜底
 * - conflict 仅由 set* 显式产生，不在此 regex 派生（透传分支放行）
 * - parse 仅 JSON 解析失败
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { classifyError, fail } from '../../preflight.js'

const KIND_VALUES = new Set(Object.values(ERROR_KIND))

function isTrackerError(err) {
  if (!err || typeof err !== 'object') return false
  if (KIND_VALUES.has(err.kind)) return true
  if (err.error && KIND_VALUES.has(err.error.kind)) return true
  return false
}

// 房内归一埋点（#494 O1 · #43 error.normalize）：只记归一前后类别与状态码，不记错误原文。
// 按需事件：调用方传 ctx 时才可能记，且调试开关关闭时零组装零调用（守卫在外层）。
let lastNormalizeKind = null

function pickHttpCode(msg) {
  const m = /\b(401|403|404|429)\b/.exec(String(msg || ''))
  return m ? Number(m[1]) : 0
}

function pickRawKind(err, msg, httpCode) {
  if (httpCode) return 'http:' + httpCode
  if (err && typeof err.code === 'number') return 'exit:' + err.code
  if (/timeout/i.test(String(msg || ''))) return 'timeout'
  return 'unknown'
}

/** 限速文案（主限速与次限速都回 403 或 429，文案里带 rate limit）。 */
function isRateLimitText(s) { return /rate limit|429|api rate limit exceeded/i.test(String(s || '')) }

/** 网络特征：#620 整改新增，判据照本房间既有的 init-project.js 里那组特征（同一件事只有一套叫法）。
 *  为什么要有它：这些原文里常常根本没有 HTTP 状态码，落到通用分类就会被别的词条抢走
 *  （实测 `getaddrinfo ENOTFOUND …` 被通用分类的 `not ?found` 判成了 not-found）。 */
function isNetworkText(s) {
  return /network|econn|econnrefused|econnreset|etimedout|timed out|timeout|enotfound|getaddrinfo|eai_again|no such host|could not resolve host|dial tcp|unable to access|failed to connect|connection (refused|reset|closed)|socket hang up|fetch failed|proxy|tls handshake|\beof\b/i.test(String(s || ''))
}

function emitNormalize(err, mapped, ctx) {
  try {
    const f = ctx && typeof ctx.logEvent === 'function' ? ctx.logEvent : null
    if (!f) return
    if (!ctx || typeof ctx.isEnabled !== 'function' || !ctx.isEnabled('debug')) return
    if (mapped === lastNormalizeKind) return
    lastNormalizeKind = mapped
    const msg = String((err && (err.stderr || err.message || err.stdout || (err.error && err.error.message))) || err || '')
    const httpCode = pickHttpCode(msg)
    const fields = { rawKind: pickRawKind(err, msg, httpCode), mappedKind: mapped }
    if (httpCode) fields.httpCode = httpCode
    f('debug', 'error.normalize', fields)
  } catch {}
}

export function classifyGhError(err, ctx) {
  // 已是规范的 TrackerError（含顶层 kind 或 error.kind）→ 直接透传（conflict/unsupported 保留）
  if (isTrackerError(err)) {
    const mapped = err.kind ? err.kind : err.error.kind
    emitNormalize(err, mapped, ctx)
    return mapped
  }
  // 若 err 是 OpResult 形状 {ok:false,error:{kind,...}} → 透传
  if (err && err.error && KIND_VALUES.has(err.error.kind)) {
    emitNormalize(err, err.error.kind, ctx)
    return err.error.kind
  }

  const msg = String((err && (err.stderr || err.message || err.stdout || (err.error && err.error.message))) || err || '')
  const s = msg.toLowerCase()

  // env：gh 可执行缺失（resolveExecutable null 时 msg 含 gh not found / Cannot find / ENOENT）
  //   #620 整改收紧的那一条：`resolveexecutable` 原来是裸词，凡含这个词的文本都被判「本机没工具」；
  //   现在要求它跟 `platform.` 连写，并把我们自己用的原句 `gh not found` 显式写上。
  let mapped
  if (/cannot find.*gh|gh not found|not found.*gh|which:.*gh|platform\.resolveexecutable|ENOENT|is not recognized|command not found|no such file/i.test(msg)) {
    mapped = ERROR_KIND.ENV
  } else if (/not logged in|authentication|bad credentials|unauthorized|permission denied|credential/i.test(s) || /\b401\b|\b403\b/.test(s)) {
    // auth 必须在 rate-limit 之前（401/403 优先于 429 文案可能共存时的优先级由 contract 固定）
    // 403 且含 rate limit 文案 → 归 rate-limit（API rate limit exceeded 含 403）
    if (isRateLimitText(s)) mapped = ERROR_KIND.RATELIMIT
    else mapped = ERROR_KIND.AUTH
  } else if (isRateLimitText(s)) mapped = ERROR_KIND.RATELIMIT
  // 网络特征必须**排在 not-found 与兜底分类之前**：#620 整改实测复现过一起误判 ——
  //   DNS 失败的原文 `… getaddrinfo ENOTFOUND api.github.com` 落到通用分类时被判成 not-found
  //   （通用分类那条 `not ?found` 的空格是可省的，ENOTFOUND 里的 NOTFOUND 正好命中），
  //   于是界面把「网络不通」说成「标签不存在」，让用户去核对标签名。
  else if (isNetworkText(s)) mapped = ERROR_KIND.NETWORK
  else if (/\b404\b|not found.*repo|not found.*issue|no such issue|issue not found|could not resolve to a repositor/i.test(s)) mapped = ERROR_KIND.NOTFOUND
  else if (/invalid json|parse|syntax/i.test(s) && /json/i.test(s)) mapped = ERROR_KIND.PARSE
  // 兜底委托通用分类（network 兜底，不在此造 conflict）
  else mapped = classifyError(err)
  emitNormalize(err, mapped, ctx)
  return mapped
}

export function toOpResultError(err) {
  const kind = classifyGhError(err)
  const message = String((err && (err.message || err.stderr || err.stdout)) || err || 'unknown error').slice(0, 800)
  return fail(kind, message)
}

export default classifyGhError
