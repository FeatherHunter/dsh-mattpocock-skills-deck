/**
 * backends/github/fallback-reason.js — 降级原因分类（#504 雾证据补强）。
 *
 * 由 issues.js 拆出（单文件 350 行纪律：房内拆文件不拆房）。
 * 不再恒写 graphql-error，按失败现场给细分原因，只复用现有事件名与字段，附录不动。
 * 超时文案 → timeout；限流文案或 429 → rate-limit；企业版主机 → ghe-host；其余 → graphql-error。
 * 企业版只看主机名是否非 github.com（GH_HOST 环境变量或报错里的主机名），不记地址原文。
 * 合成探针见 tests/verify-504-github-pr.js（企业版主机/限流/timeout 三合成失败各走各的 reason）。
 */

export function readGhHost(ctx) {
  try {
    const env = ctx && ctx.platform && ctx.platform.env && typeof ctx.platform.env.get === 'function' ? ctx.platform.env : null
    const v = env ? String(env.get('GH_HOST') || '') : ''
    if (v) return v
  } catch {}
  try {
    if (ctx && ctx.env && typeof ctx.env.get === 'function') {
      const v2 = String(ctx.env.get('GH_HOST') || '')
      if (v2) return v2
    }
  } catch {}
  try {
    if (typeof process !== 'undefined' && process.env && process.env.GH_HOST) return String(process.env.GH_HOST)
  } catch {}
  return ''
}

export function isGheHostName(h) {
  const s = String(h || '').trim().toLowerCase()
  if (!s) return false
  if (s === 'github.com' || s === 'api.github.com' || s.endsWith('.github.com')) return false
  return true
}

export function pickFallbackReason(err, ctx) {
  try {
    const msg = String((err && (err.stderr || err.message || err.stdout || (err.error && err.error.message))) || err || '')
    const s = msg.toLowerCase()
    if (/timeout|timed out|timedout|etimedout/i.test(msg)) return 'timeout'
    if (/rate limit|429|api rate limit exceeded|secondary rate limit/i.test(s)) return 'rate-limit'
    if (isGheHostName(readGhHost(ctx))) return 'ghe-host'
    if (/github enterprise|ghes|enterprise server/i.test(s)) return 'ghe-host'
    const hm = msg.match(/([A-Za-z0-9-]+\.)+(example\.com|local|internal|corp|enterprise)(:\d+)?/i)
    if (hm) return 'ghe-host'
  } catch {}
  return 'graphql-error'
}

export default { readGhHost, isGheHostName, pickFallbackReason }
