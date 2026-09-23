/**
 * backends/gitlab/idempotency.js — 创建幂等锚在这间房里的落地（#711）。
 *
 * 契约层答应的事只有一条：同一个锚提交两次，只多出一张票、返回同一个 key（语义见
 * src/host/tracker/contract-idempotency.js）。锚的构造与「找到的票算不算命中」的判据在
 * 刷新核心的产物（src/shared/refresh/idempotency.js），这里只做 GitLab 专属的两件事：
 *   ① 把锚那一行写进 issue 的 description（由 issues.js 拼 description 时加上，本文件提供 helper）；
 *   ② **建后按锚回查**：先从 GitLab 上把「可能已经建过的那张票」找出来。
 *
 * 回查为什么这么写：
 *  - 唯一的证据是**票面 description 里的那一行锚**。接口说「找到了」不算数、内存里记着谁建过也不算数 ——
 *    进程重启、插件重载、换个会话回来之后内存里什么都没有，而票还在远端。所以每条候选都要把
 *    description 拿回来，交给 matchAnchor 按票面原文判。
 *  - 两条路：① `issues?search=<锚>&in=description`（服务端搜索，一次出站，最快）；
 *    ② 按创建时间倒序列出开着的票，逐张看 description（不依赖搜索服务，也顺带挡住「搜索服务
 *    对刚建好的票有延迟」这种情形）。
 *  - 两条路都**没找到**才算「这张票确实还没建过」；任何一条路上出岔子拿不准（接口报错、返回的不是数组）
 *    时，绝不当成「没找到」，一律如实失败（错误档沿用既有分类，消息说清是回查出的问题）——
 *    「拿不准」当成「没找到」正是重复建票的来路，而且是看起来成功了的那种。
 */

import { anchorLineFor, matchAnchor, isAnchorHit, describeAnchorFailure, anchorUnsupported } from '../../../../shared/refresh/idempotency.js'
import { glabClient } from './client.js'
import { classifyGlabError } from './errors.js'
import { normalizeIssue } from './normalize.js'
import { projectPath, issuesPath } from './queries.js'

/** 慢路最多看几张候选（按创建时间倒序的第一页）。到了这个数还没找到就如实说「拿不准」。 */
const SCAN_LIMIT = 100

/** 一次回查要找的几个字段（REST 返回里本来就有这些，写出来是为了让读代码的人知道用了什么）。 */
const DETAIL_QUERY = 'with_labels_details=true'

/**
 * 把锚那一行拼到 description 前面。不带锚时原样返回（一个字节都不改）。
 * 带锚时锚是 description 的第一行：渲染后看不见，读回来还在，重试时能凭它找回这张票。
 */
export function withAnchor(description, key) {
  if (!key) return description
  return anchorLineFor(String(key)) + (description || '')
}

function repoId(repo) {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

function parseRows(text) {
  const t = String(text || '').trim()
  if (!t) return []
  const j = JSON.parse(t)
  if (!Array.isArray(j)) throw new Error('返回的不是一个列表')
  return j
}

/** 把一行原始数据变成回查判据要的候选（读不出 iid 就返回 null）。 */
function toCandidate(raw) {
  if (!raw || typeof raw !== 'object') return null
  const key = raw.iid === undefined || raw.iid === null ? '' : String(raw.iid)
  if (!key) return null
  const body = typeof raw.description === 'string' ? raw.description : ''
  const out = { key, body }
  out.state = raw.state === 'closed' ? 'closed' : (raw.state ? 'open' : undefined)
  if (out.state === undefined) delete out.state
  return out
}

/** 回查失败时的一句话（原因沿用既有分类，说得清是哪条路出的问题）。 */
function lookupFailure(kind, message) {
  return { ok: false, error: { kind: kind || 'unsupported', message: '带锚创建的回查没能做成：' + String(message || '原因不明').slice(0, 500) + '。这一次没有建票 —— 请先修好回查，或者换用不带锚的创建。' } }
}

/**
 * 建后按锚回查（本间房的实现）。返回三种结果：
 *   { ok:true, hit:false }             —— 确实没找到，照常建票
 *   { ok:true, hit:true, issue }       —— 找到了，复用它（issue 是已经归一化好的那张票）
 *   { ok:false, error }                —— 回查没做成，如实失败，绝不建票
 *
 * @param {object} repo  目标仓库（refId 形如 group/project）
 * @param {string} key   幂等键（已经过 checkIdempotencyKey 检查）
 * @param {object} opCtx 本次调用的上下文（房内约定：glabClient 吃这个 ctx）
 */
export async function lookupByAnchor(repo, key, opCtx) {
  const id = repoId(repo)
  if (!id) return lookupFailure('not-found', '这个仓库的 refId 是空的，回查无从做起')
  const c = glabClient(opCtx)

  // ① 快路：服务端搜索（只搜 description）。
  let searchError = null
  try {
    const q = 'search=' + encodeURIComponent(key) + '&in=description&state=opened'
    const res = await c.run(['api', issuesPath(id, q)], { timeout: 8000 })
    if (res.code !== 0) searchError = res.stderr || res.stdout || '搜索接口报错'
    else {
      const rows = parseRows(res.stdout)
      const cands = rows.map(toCandidate).filter(Boolean)
      const m = matchAnchor(cands, repo && repo.refId, key)
      if (isAnchorHit(m)) return { ok: true, hit: true, issue: normalizeIssue(rows.find((x) => String(x.iid) === String(m.key)) || {}) }
    }
  } catch (e) {
    searchError = String((e && e.message) || e)
  }

  // ② 慢路：按创建时间倒序列出开着的票，逐张看票面（不依赖搜索服务）。
  let listError = null
  try {
    const q = 'state=opened&order_by=created_at&sort=desc&per_page=' + SCAN_LIMIT + '&' + DETAIL_QUERY
    const res = await c.run(['api', issuesPath(id, q)], { timeout: 10000 })
    if (res.code !== 0) listError = res.stderr || res.stdout || '列出票时报错'
    else {
      const rows = parseRows(res.stdout)
      for (const raw of rows) {
        const cand = toCandidate(raw)
        if (!cand) continue
        const m = matchAnchor([cand], repo && repo.refId, key)
        if (isAnchorHit(m)) return { ok: true, hit: true, issue: normalizeIssue(raw) }
      }
      if (rows.length >= SCAN_LIMIT) {
        return lookupFailure('unsupported', '按创建时间倒序看完了前 ' + SCAN_LIMIT + ' 张还没找到这个锚，这个仓库比这更大，这次不敢断定「还没建过」')
      }
    }
  } catch (e) {
    listError = String((e && e.message) || e)
  }

  // 两条路都没找到：只有在**两条路都真跑通了、都确认没有**时才算「确实还没建过」。
  if (searchError && listError) {
    return lookupFailure(classifyGlabError({ message: listError }), '搜索接口与列表接口都没跑通（搜索：' + searchError + '；列表：' + listError + '）')
  }
  if (listError) {
    return lookupFailure(classifyGlabError({ message: listError }), '列表这条回查路没跑通（' + listError + '），而搜索接口没搜到不能算数（服务端搜索对刚建好的票可能有延迟）')
  }
  const miss = matchAnchor([], repo && repo.refId, key)
  return { ok: true, hit: false, reason: miss.reason }
}

/** 回查没做成时给调用方看的那句话（句式由核心里那一处给，本文件不自己拼）。 */
export function describeLookupFailure(match) {
  return describeAnchorFailure(match || anchorUnsupported('回查没有做成'))
}

export default { withAnchor, lookupByAnchor, describeLookupFailure }
