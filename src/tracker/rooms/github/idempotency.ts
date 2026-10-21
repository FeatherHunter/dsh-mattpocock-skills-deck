/**
 * backends/github/idempotency.js — 创建幂等锚在这间房里的落地（#711）。
 *
 * 契约层答应的事只有一条：同一个锚提交两次，只多出一张票、返回同一个 key（语义见
 * src/host/tracker/contract-idempotency.js）。锚的构造与「找到的票算不算命中」的判据在
 * 刷新核心的产物（src/shared/refresh/idempotency.js），这里只做两件 GitHub 专属的事：
 *   ① 把锚那一行写进 issue 正文（由 issues-write.js 拼正文时加上，本文件提供 helper）；
 *   ② **建后按锚回查**：先从 GitHub 上把「可能已经建过的那张票」找出来。
 *
 * 回查为什么这么写（这是本文件最要紧的一段）：
 *  - 唯一的证据是**票面正文里的那一行锚**。搜索接口说「找到了」不算数、内存里记着谁建过也不算数 ——
 *    进程重启、插件重载、换个会话回来之后内存里什么都没有，而票还在远端。所以每条候选都要把正文
 *    拿回来，交给 matchAnchor 按票面原文判。
 *  - 两条路，按可靠程度排：
 *    ① 搜索接口（`gh search issues --match body`）。便宜（一次出站），但 GitHub 的正文搜索索引是
 *       **异步建的、有滞后**：票刚建好的那几十秒里搜索常常还搜不到它。所以它只能当快路。
 *    ② 搜索没找到时，退一步：列出这个仓库里**最近更新过**的开票行，逐张把正文读回来比对，
 *       只看创建时间落在回看窗口（默认 30 分钟）之内的候选。这条路不依赖任何索引，但它要多发
 *       几次出站请求，所以两条一起用：快路命中就省掉慢路，快路没命中也不会因此重复建票。
 *    GitHub 没有「按创建时间过滤列表」的参数（issues 接口的 `since` 是按更新时间过滤的全文时间），
 *    所以慢路只能先按更新时间粗筛、再拿创建时间收窄 —— 这不是省事，是这个接口能给的全部。
 *  - 两条路都**没找到**才算「这张票确实还没建过」；任何一条路上出岔子拿不准（搜索报错、列表翻不完、
 *    某一张正文读不出来）时，绝不当成「没找到」，一律如实失败（错误档沿用既有分类，消息说清是回查出的问题）——
 *    「拿不准」当成「没找到」正是重复建票的来路，而且是看起来成功了的那种。
 */

import { anchorLineFor, matchAnchor, isAnchorHit, describeAnchorFailure, anchorUnsupported } from '../../../shared/refresh/src/idempotency.js'
import type { AnchorMatch } from '../../../shared/refresh/src/idempotency.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js';
import type { Issue, RepositoryRef } from '../../contract/entities.js';
import type { ErrorKind } from '../../contract/identity.js';
import type { TrackerError } from '../../contract/results.js';
import { ghClient } from './client.js'
import { ghVerdictOf } from './errors.js'
import { parseRepo } from './issues.js'
// 回看窗口住中央 YAML，调时间改 config/ttl.yaml。
import { IDEMPOTENCY_LOOKBACK_MS } from '../../../shared/time-config/src/values.js'
import { PAGINATION } from '../pagination.js'

/** 按锚回查的返回：没找到照常建、找到了复用旧票、没做成如实失败（绝不把拿不准当没找到）。 */
export type AnchorLookupOutcome =
  | { ok: true; hit: true; issue: Issue }
  | { ok: true; hit: false; reason?: unknown }
  | { ok: false; error: TrackerError };

// 为什么 catch 里的错误要先转这层再读：catch 出来是 unknown，直接读 message/stderr 会报缺成员；
// 转成最小形状后读法与原来一致，运行时不变。
type CaughtMsg = { message?: unknown; stderr?: unknown } | null;
function caughtBag(e: unknown): { message?: unknown; stderr?: unknown } {
  return ((e && typeof e === 'object' ? e : {}) as { message?: unknown; stderr?: unknown })
}
function caughtMessage(e: unknown, len: number): string {
  const eb = caughtBag(e) as CaughtMsg;
  return String((eb && eb.message) || e).slice(0, len)
}
// 为什么另起这层不截断：回查两条路的报错原文后面还要进消息与 JSON，截断会丢证据；这里不断言、只转袋读，原样交出去。
function caughtText(e: unknown): string {
  const eb = caughtBag(e) as CaughtMsg;
  return String((eb && eb.message) || e)
}

/** 慢路只回看这么久以内创建的票：比正常重试窗口宽得多，又不会去翻历史票。 */

/** 慢路最多把几张候选的正文读回来。到了这个数还没找到就如实说「拿不准」，绝不当成没找到。 */
const MAX_BODY_FETCHES = PAGINATION.github.anchorLookupBodyFetches

/** 一次回查要找的几个字段。搜索接口与 issue 列表接口给的是同一套名字（number/body/state/createdAt/updatedAt）。 */
const CANDIDATE_FIELDS = 'number,body,state,createdAt,updatedAt'

/**
 * 把锚那一行拼到正文前面。不带锚时原样返回（一个字节都不改）。
 * 带锚时锚是正文第一行：渲染后看不见，读回来还在，重试时能凭它找回这张票。
 */
export function withAnchor(body: string, key: unknown): string {
  if (!key) return body
  return anchorLineFor(String(key)) + (body || '')
}

/** 把一张原始行（gh 回的 JSON）变成回查判据要的候选。读不出关键字段就返回 null（由调用方按「这一条不可用」处理）。 */
function toCandidate(raw: unknown): { key: string; body: string; state?: string } | null {
  if (!raw || typeof raw !== 'object') return null
  // 为什么转成袋再读：原始行是 gh 回的任意形状，直接读 number/body/state 报缺成员；对象检查通过后袋与原值是同一份引用，读法与原来一致。
  const bag = raw as Record<string, unknown>;
  const key = bag.number === undefined || bag.number === null ? '' : String(bag.number)
  if (!key) return null
  const body = typeof bag.body === 'string' ? bag.body : ''
  const state = bag.state === 'closed' || bag.state === 'CLOSED' ? 'closed' : (bag.state ? 'open' : undefined)
  // 为什么先定死形状再补可选键：字面量起手类型里没有 state，后面再补会报缺成员；先标形状，可选键自然有位置。
  const out: { key: string; body: string; state?: string } = { key, body }
  if (state) out.state = state
  return out
}

function parseLines(text: unknown): unknown[] {
  const t = String(text || '').trim()
  if (!t) return []
  try {
    const j: unknown = JSON.parse(t)
    return Array.isArray(j) ? j : [j]
  } catch (e) {
    throw Object.assign(new Error('gh 回的 JSON 读不出来：' + caughtMessage(e, 200)), { kind: ERROR_KIND.PARSE })
  }
}

/** 这一行的创建时间（毫秒）。读不出来时给 null —— 由调用方决定「时间读不出来就不参与慢路」。 */
function createdMs(raw: unknown): number | null {
  const bag = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  const v = bag && (bag.createdAt || bag.created_at)
  if (!v) return null
  const t = Date.parse(String(v))
  return isNaN(t) ? null : t
}

/** 回查失败时的一句话（原因沿用既有分类，说得清是哪条路出的问题）。
 *  档位由调用方给：这几处「回查没做成」的原因是房内当场就知道的事实（地址不合法、翻不完、
 *  正文读不出来），不是从文本猜出来的；原文段一律带上手里那个值，人才能自己核对。 */
function lookupFailure(kind: ErrorKind, message: unknown, raw: unknown): { ok: false; error: TrackerError } {
  return { ok: false, error: { kind: kind || ERROR_KIND.UNSUPPORTED, message: '带锚创建的回查没能做成：' + String(message || '原因不明').slice(0, 500) + '。这一次没有建票 —— 请先修好回查，或者换用不带锚的创建。', raw: String(raw == null ? '' : raw).slice(0, 2000) } }
}

/** 回查最大的一个隐患，写在最显眼的地方：列表接口默认按更新时间倒序（这是 GitHub 的接口约定），
 *  而这里靠「创建时间落在回看窗口内」收窄候选 —— 所以只要这个仓库在回看窗口内新建的票不超过
 *  列表取回的条数，刚建好那张就一定在候选里。取回条数越少，越可能出现「候选被别的更新票挤出榜单」，
 *  于是这里直接取 100（接口允许的最大值），把这种可能压到最小。 */
const LIST_LIMIT = PAGINATION.github.anchorLookupListLimit

/**
 * 建后按锚回查（本间房的实现）。返回四态之一：
 *   { ok:true, hit:false }             —— 确实没找到，照常建票
 *   { ok:true, hit:true, issue }       —— 找到了，复用它（issue 是已经归一化好的那张票）
 *   { ok:false, error }                —— 回查没做成，如实失败，绝不建票
 *
 * @param {object} repo  目标仓库（refId 形如 owner/name）
 * @param {string} key   幂等键（已经过 checkIdempotencyKey 检查）
 * @param {object} ctx   本次调用的上下文
 * @param {(raw:object)=>object} normalizeIssue 归一化函数（由调用方注入，避免这份文件再引一圈）
 */
export async function lookupByAnchor(repo: RepositoryRef, key: string, ctx: OpContext, normalizeIssue: (raw: unknown) => Issue): Promise<AnchorLookupOutcome> {
  const parsed = parseRepo(repo)
  if (!parsed) return lookupFailure(ERROR_KIND.NOTFOUND, '这个仓库的地址不合法，回查无从做起', String((repo && repo.refId) || repo || ''))
  const c = ghClient(ctx)
  const slug = parsed.owner + '/' + parsed.name
  const nowMs = Date.now()

  // ① 快路：搜索接口。命中就到此为止（省掉慢路）。
  let searchError = null
  try {
    const r = await c.execGh(['search', 'issues', '--repo', slug, '--match', 'body', '--json', CANDIDATE_FIELDS, '--limit', String(PAGINATION.github.anchorLookupSearchLimit), key], { cwd: ctx && ctx.cwd })
    if (!r.ok) searchError = (r.error && r.error.message) || '搜索接口报错'
    else {
      const rows = parseLines(r.data.stdout || '')
      const cands = rows.map(toCandidate).filter(Boolean)
      const m = matchAnchor(cands, repo && repo.refId, key)
      // 为什么断言一下：共享的结论形状只在命中那一格带 key（isAnchorHit 只回布尔、带不出收窄），断言只为读到那一格；
      // 命中分支里 key 一定有（anchorHit 写死的），读法与原来一致，运行时不变。
      if (isAnchorHit(m)) return { ok: true, hit: true, issue: normalizeIssue(rows.find((x: unknown) => String((x as Record<string, unknown>).number) === String((m as { key?: unknown }).key)) || {}) }
    }
  } catch (e) {
    searchError = caughtText(e)
  }

  // ② 慢路：列出最近更新过的开票行，逐张读回正文比对。不依赖搜索索引，所以**刚建完马上重试**这个窗口靠它。
  let listError = null
  // 为什么显式标成未知数组：回包行是 gh 回的任意形状，判据函数只按 unknown 收；标 any[] 会一路把下游全染成 any。
  let rows: unknown[] = []
  try {
    const r = await c.execGh(['issue', 'list', '--repo', slug, '--state', 'open', '--limit', String(LIST_LIMIT), '--json', CANDIDATE_FIELDS], { cwd: ctx && ctx.cwd })
    if (!r.ok) listError = (r.error && r.error.message) || '列出最近更新的票时报错'
    else rows = parseLines(r.data.stdout || '')
  } catch (e) {
    listError = caughtText(e)
  }
  if (!listError) {
    // ① 粗筛：只看创建时间落在回看窗口内的候选，并且先按「列表里带回来的正文」判一次。
    const inWindow = rows.filter((raw) => { const t = createdMs(raw); return t !== null && t >= nowMs - IDEMPOTENCY_LOOKBACK_MS })
    for (const raw of inWindow) {
      const cand = toCandidate(raw)
      if (!cand || typeof cand.body !== 'string' || !cand.body) continue
      const m = matchAnchor([cand], repo && repo.refId, key)
      if (isAnchorHit(m)) return { ok: true, hit: true, issue: normalizeIssue(raw) }
    }
    // ② 列表接口不保证带正文（有的版本只回元数据）：逐张把正文读回来再判。
    // 为什么断言：行是 gh 回的任意形状，直接读 body 报缺成员；断言只为过编译，读的还是原来那一格（空行本就会在这里抛，与原来一致）。
    const needBody = inWindow.filter((raw: unknown) => typeof (raw as Record<string, unknown>).body !== 'string' || !(raw as Record<string, unknown>).body)
    let fetched = 0
    for (const raw of needBody) {
      if (fetched >= MAX_BODY_FETCHES) {
        return lookupFailure(ERROR_KIND.UNSUPPORTED, '最近更新的票超过 ' + MAX_BODY_FETCHES + ' 张、还没逐张读回正文比对完（列到了 ' + rows.length + ' 张），这次不敢断定「还没建过」', JSON.stringify({ 列到的票数: rows.length, 最多逐张读回: MAX_BODY_FETCHES }))
      }
      fetched++
      // 为什么不断言判空：沿用原来的短路读法——空行时 num 就是空值本身、直接跳过；有值时读的还是原来那一格，行为一字不差。
      const num = raw && (raw as Record<string, unknown>).number
      if (num === undefined || num === null) continue
      try {
        const b = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${num}`], { cwd: ctx && ctx.cwd })
        if (!b.ok) return lookupFailure((b.error && b.error.kind) || ERROR_KIND.NETWORK, '读第 ' + num + ' 张票的正文时失败：' + ((b.error && b.error.message) || ''), (b.error && b.error.raw) || (b.error && b.error.message) || '')
        const one = parseLines(b.data.stdout || '')[0]
        const cand = toCandidate(one)
        if (!cand) continue
        const m = matchAnchor([cand], repo && repo.refId, key)
        if (isAnchorHit(m)) return { ok: true, hit: true, issue: normalizeIssue(one) }
      } catch (e) {
        const eb = caughtBag(e);
        return lookupFailure(ghVerdictOf(e, ctx).kind, '读第 ' + num + ' 张票的正文时出错：' + caughtText(e), (eb && (eb.message || eb.stderr)) || e || '')
      }
    }
  }

  // 两条路都没找到：只有在**两条路都真跑通了、都确认没有**时才算「确实还没建过」。
  if (searchError && listError) {
    return lookupFailure(ERROR_KIND.UNSUPPORTED, '搜索接口与列表接口都没跑通（搜索：' + searchError + '；列表：' + listError + '）', JSON.stringify({ 搜索接口的报错: String(searchError), 列表接口的报错: String(listError) }))
  }
  if (listError) {
    // 搜索通了、列表没通：搜索这条路的「没找到」不足以断定没建过（索引滞后）。
    return lookupFailure(ERROR_KIND.UNSUPPORTED, '列表这条回查路没跑通（' + listError + '），而搜索接口没搜到不能算数（GitHub 的正文搜索索引是异步建的，刚建好的票常常还搜不到）', String(listError))
  }
  const miss = matchAnchor([], repo && repo.refId, key)
  return { ok: true, hit: false, reason: miss.reason }
}

/** 回查没做成时给调用方看的那句话（句式由核心里那一处给，本文件不自己拼）。 */
export function describeLookupFailure(match?: AnchorMatch | null): string {
  return describeAnchorFailure(match || anchorUnsupported('回查没有做成'))
}

export default { withAnchor, lookupByAnchor, describeLookupFailure }
