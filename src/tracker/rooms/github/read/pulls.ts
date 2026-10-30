/**
 * src/tracker/rooms/github/read/pulls.ts — 拉取请求读路径的 REST 帮手（列表富化 + 单票明细）。
 * #1686 阶段 1：从房间根迁入 read/，房间根的同名转发文件已在 #1687 末批删除，行为零变化。
 *
 * 由 #504 从 issues.ts 拆出（单文件 350 行纪律：房内拆文件不拆房）。
 * GraphQL 主路仍在 issues.ts（与工单同池合并）；本文件只装 REST 兜底件：
 * 列表 /pulls 富化合并时间、单票 /pulls 补合并时间与 /reviews 评审明细。
 * 全部尽力而为：失败保持空值（null/[]），不抛错，不吞工单。
 *
 * 日志（#1052）：本文件三笔都起 gh 进程，各带 via 标签（`pulls.rest` 列表富化翻页、
 * `pulls.detail` 单票补合并时间、`pulls.reviews` 单票拉评审明细），于是它们与读路径上
 * 别的 gh.exec 在日志里分得开。三笔都是「尽力而为」，失败只留空值不报错——所以本文件
 * 不另记降级行（没有「这一趟读不成立」可交代，调用方照旧拿到能用的数据）。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js';
import type { OpResult } from '../../../contract/results.js';
import { fail } from '../../../kernel/preflight.js'
import { ghClient } from '../transport/client.js'
import { PAGINATION } from '../../../contract/pagination.js'
// REST 读走 30 秒档（中央 githubRestReadMs，与读档 12 秒分开）：慢网下备路不被房内到点砍断。
import { GITHUB_REST_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'

/** 仓库坐标：拥有者与仓库名，由调用方（issues 的 REST 兜底）保证形状。 */
interface ParsedRepo {
  owner: string;
  name: string;
}

// 拉取请求 REST 列表（与 issues 同构；/issues 已含拉取请求条目，此处只为补合并时间做富化）。
export async function fetchAllPullsREST(parsed: ParsedRepo, ctx: OpContext): Promise<OpResult<unknown[]>> {
  const c = ghClient(ctx)
  // 为什么标成未知数组：回包是 GitHub 的原始行，本函数只负责翻页搬运、不解读形状，解读是调用方的事。
  const out: unknown[] = []
  const MAX_PAGES = PAGINATION.github.restMaxPages
  const PAGE = PAGINATION.github.restPageSize
  for (let p = 1; p <= MAX_PAGES; p++) {
    // 这一笔是列表富化的 REST 翻页：标签写 pulls.rest，跟同一次读里的 list.rest 分得开。
    const r = await c.execGh(['api', 'repos/' + parsed.owner + '/' + parsed.name + '/pulls?state=all&per_page=' + PAGE + '&page=' + p], { cwd: ctx && ctx.cwd, via: 'pulls.rest', timeout: GITHUB_REST_READ_TIMEOUT_MS })
    if (!r.ok) {
      if (!out.length) return { ok: false, error: r.error }
      return { ok: true, data: out }
    }
    let j: unknown
    try { j = JSON.parse(r.data.stdout || '') } catch (e) {
      // 为什么转一下再读：catch 出来是 unknown，直接读 message 会报缺成员；转成最小形状后读法与原来一致，运行时不变。
      const eb = e as { message?: unknown } | null;
      // 原文交这次 gh 的完整产出：人自己就能看出回包里到底是什么。
      if (!out.length) return fail(ERROR_KIND.PARSE, 'rest pulls: invalid json ' + String((eb && eb.message) || e).slice(0, 200), r.data)
      return { ok: true, data: out }
    }
    if (!Array.isArray(j)) {
      if (!out.length) return fail(ERROR_KIND.PARSE, 'rest pulls: non-array response', r.data)
      return { ok: true, data: out }
    }
    for (const n of j) out.push(n)
    if (j.length < PAGE) break
  }
  return { ok: true, data: out }
}

// REST 同口径（与 queries.js 缺边说明一致）：列表只补合并时间，不补树边与评审明细。
// /issues 条目里的拉取请求只有标记没有合并时间，按号补上（找不到就保持 null）。
// 状态不在这里改：#599 真仓核过，/issues?state=all 对已合并的拉取请求本来就给 state=closed
// （合并时间也填在 pull_request.merged_at 里），两条接口的说法一致，多补一道只会多一处要维护的规则。
// 树边不补是因为 sub_issues 树接口只有工单条目可用，拉取请求条目没有 parent 来源；
// 评审明细不补是因为列表逐票拉 /reviews 太费配额，列表评审恒给空数组，单票 enrichSinglePR 才拉真值。
export function enrichRestPRs(issueRaws: unknown, pullRaws: unknown): unknown {
  // 为什么键值都标成未知：两份输入都是 GitHub 原始行，本函数只按号配对搬合并时间、不解读形状，解读是调用方的事。
  const byNum = new Map<string, unknown>()
  // 为什么断言一下：或出空数组的表达式与原来一字不差（不断言编译器不让迭代），断言只为过编译，运行时不变。
  for (const p of ((pullRaws || []) as unknown[])) {
    // 为什么转成键值袋再读：原始行可能是任意值，直接读 number 会报缺成员；是对象时袋与原值是同一份引用，读法与原来一致。
    const pb = (p && typeof p === 'object' ? p : null) as Record<string, unknown> | null;
    if (pb && pb.number != null && !byNum.has(String(pb.number))) byNum.set(String(pb.number), p)
  }
  for (const x of ((issueRaws || []) as unknown[])) {
    const xb = (x && typeof x === 'object' ? x : null) as Record<string, unknown> | null;
    if (xb && xb.pull_request != null) {
      const p = byNum.get(String(xb.number))
      const qb = (p && typeof p === 'object' ? p : null) as Record<string, unknown> | null;
      if (qb && typeof qb.merged_at === 'string' && typeof xb.merged_at !== 'string') xb.merged_at = qb.merged_at
    }
  }
  return issueRaws
}

// 单票富化：拉取请求条目补合并时间与评审明细（列表页不拉，单票页才拉真值；失败保持空值）。
export async function enrichSinglePR(jr: unknown, parsed: ParsedRepo, ctx: OpContext): Promise<unknown> {
  // 为什么转成键值袋再读写：单票原始行是 GitHub 给的形状，本函数只补 merged_at/reviews 两格；
  // 是对象时袋与原值是同一份引用，读写与原来一字不差（改的还是原来那份行），返回的也是原来那个引用。
  const jb = (jr && typeof jr === 'object' ? jr : null) as Record<string, unknown> | null;
  try {
    const c = ghClient(ctx)
    if (jb && typeof jb.merged_at !== 'string') {
      try {
        const pr = await c.execGh(['api', 'repos/' + parsed.owner + '/' + parsed.name + '/pulls/' + (jb.number as unknown)], { cwd: ctx && ctx.cwd, via: 'pulls.detail', timeout: GITHUB_REST_READ_TIMEOUT_MS })
        if (pr.ok) {
          const pj: unknown = JSON.parse(pr.data.stdout || 'null')
          const pjb = (pj && typeof pj === 'object' ? pj : null) as Record<string, unknown> | null;
          if (pjb && typeof pjb.merged_at === 'string') jb.merged_at = pjb.merged_at
        }
      } catch {}
    }
    if (jb && !Array.isArray(jb.reviews)) {
      try {
        const rv = await c.execGh(['api', 'repos/' + parsed.owner + '/' + parsed.name + '/pulls/' + (jb.number as unknown) + '/reviews?per_page=' + PAGINATION.github.restPageSize], { cwd: ctx && ctx.cwd, via: 'pulls.reviews', timeout: GITHUB_REST_READ_TIMEOUT_MS })
        if (rv.ok) {
          const arr: unknown = JSON.parse(rv.data.stdout || 'null')
          if (Array.isArray(arr)) jb.reviews = arr
        }
      } catch {}
    }
  } catch {}
  return jr
}

export default { fetchAllPullsREST, enrichRestPRs, enrichSinglePR }
