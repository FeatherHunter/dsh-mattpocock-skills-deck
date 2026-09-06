/**
 * backends/github/pulls.js — 拉取请求读路径的 REST 帮手（列表富化 + 单票明细）。
 *
 * 由 #504 从 issues.js 拆出（单文件 350 行纪律：房内拆文件不拆房）。
 * GraphQL 主路仍在 issues.js（与工单同池合并）；本文件只装 REST 兜底件：
 * 列表 /pulls 富化合并时间、单票 /pulls 补合并时间与 /reviews 评审明细。
 * 全部尽力而为：失败保持空值（null/[]），不抛错，不吞工单。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { ghClient } from './client.js'

// 拉取请求 REST 列表（与 issues 同构；/issues 已含拉取请求条目，此处只为补合并时间做富化）。
export async function fetchAllPullsREST(parsed, ctx) {
  const c = ghClient(ctx)
  const out = []
  const MAX_PAGES = 10
  const PAGE = 100
  for (let p = 1; p <= MAX_PAGES; p++) {
    const r = await c.execGh(['api', 'repos/' + parsed.owner + '/' + parsed.name + '/pulls?state=all&per_page=' + PAGE + '&page=' + p], { cwd: ctx && ctx.cwd })
    if (!r.ok) {
      if (!out.length) return { ok: false, error: r.error }
      return { ok: true, data: out }
    }
    let j
    try { j = JSON.parse(r.data.stdout || '') } catch (e) {
      if (!out.length) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'rest pulls: invalid json ' + String(e.message).slice(0, 200) } }
      return { ok: true, data: out }
    }
    if (!Array.isArray(j)) {
      if (!out.length) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'rest pulls: non-array response' } }
      return { ok: true, data: out }
    }
    for (const n of j) out.push(n)
    if (j.length < PAGE) break
  }
  return { ok: true, data: out }
}

// REST 同口径（与 queries.js 缺边说明一致）：列表只补合并时间，不补树边与评审明细。
// /issues 条目里的拉取请求只有标记没有合并时间，按号补上（找不到就保持 null）；
// 树边不补是因为 sub_issues 树接口只有工单条目可用，拉取请求条目没有 parent 来源；
// 评审明细不补是因为列表逐票拉 /reviews 太费配额，列表评审恒给空数组，单票 enrichSinglePR 才拉真值。
export function enrichRestPRs(issueRaws, pullRaws) {
  const byNum = new Map()
  for (const p of (pullRaws || [])) {
    if (p && p.number != null && !byNum.has(String(p.number))) byNum.set(String(p.number), p)
  }
  for (const x of (issueRaws || [])) {
    if (x && x.pull_request != null) {
      const p = byNum.get(String(x.number))
      if (p && typeof p.merged_at === 'string' && typeof x.merged_at !== 'string') x.merged_at = p.merged_at
    }
  }
  return issueRaws
}

// 单票富化：拉取请求条目补合并时间与评审明细（列表页不拉，单票页才拉真值；失败保持空值）。
export async function enrichSinglePR(jr, parsed, ctx) {
  try {
    const c = ghClient(ctx)
    if (jr && typeof jr.merged_at !== 'string') {
      try {
        const pr = await c.execGh(['api', 'repos/' + parsed.owner + '/' + parsed.name + '/pulls/' + jr.number], { cwd: ctx && ctx.cwd })
        if (pr.ok) {
          const pj = JSON.parse(pr.data.stdout || 'null')
          if (pj && typeof pj.merged_at === 'string') jr.merged_at = pj.merged_at
        }
      } catch {}
    }
    if (jr && !Array.isArray(jr.reviews)) {
      try {
        const rv = await c.execGh(['api', 'repos/' + parsed.owner + '/' + parsed.name + '/pulls/' + jr.number + '/reviews?per_page=100'], { cwd: ctx && ctx.cwd })
        if (rv.ok) {
          const arr = JSON.parse(rv.data.stdout || 'null')
          if (Array.isArray(arr)) jr.reviews = arr
        }
      } catch {}
    }
  } catch {}
  return jr
}

export default { fetchAllPullsREST, enrichRestPRs, enrichSinglePR }
