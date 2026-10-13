/**
 * backends/github/preflight.js — 探测/登录/API 可达（三项门禁，只判环境，不预判能力）。
 *
 * 定版依据：#138 §1.5 + contract.js preflight 签名 + #129 平台三底座
 * - 签名：(handle: RepoHandle, ctx: OpContext) => Promise<PreflightResult>
 *   handle: {cwd?, refId?}；ctx: BackendContext（含 platform/exec/timers/fs/log）+ cwd/signal/refId
 * - 三项检查顺序：1) gh 可执行 → env；2) 登录态 → auth；3) 仓库可达 → not-found/auth/network/rate-limit
 * - 不检查：labels/subIssue/depGraph 等能力；不返回 capabilities 布尔表（旧 BackendStatus 已删）
 * - 错误归一全经 ghVerdictOf（判档表在 src/tracker/error-rules.ts）
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import { rawText } from '../../preflight.js'
import { ghClient } from './client.js'
import { ghFailureMessage, ghVerdictOf } from './errors.js'

// #195 曾经在这里挂着一整段「怎么装 gh」的长文（按系统分平台列命令），交给界面直接注入。
// #664（首开引导链定版 #661 第③条）：缺 gh 时注入的文案收成一句原话（「/wizard 帮用户安装gh cli 官方地址：
//   https://cli.github.com/」），唯一一份住在共享清单 src/shared/tracker/guide-steps.js 的 gh:installed
//   那一步里，界面从那一步取它。那段长文与预检结果里的 prompt 字段随之退役 —— 一个缺失状态不许有两份说明。

function parseRepoRef(handle, ctx) {
  // 优先 handle.refId，其次 ctx.refId，再尝试从 cwd 的 git remote 解析（简化：若 refId 无则用 gh repo view）
  if (handle && typeof handle.refId === 'string' && handle.refId) return handle.refId
  if (ctx && typeof ctx.refId === 'string' && ctx.refId) return ctx.refId
  return null
}

function repoFromRefId(refId) {
  if (!refId || typeof refId !== 'string') return null
  const idx = refId.indexOf('/')
  if (idx <= 0) return null
  return { owner: refId.slice(0, idx), name: refId.slice(idx + 1) }
}

/**
 * @param {import('../../contract/index.js').RepoHandle} handle
 * @param {import('../../contract/index.js').OpContext} ctx
 * @returns {Promise<import('../../contract/index.js').PreflightResult>}
 */
export async function ghPreflight(handle, ctx) {
  const cwd = (handle && handle.cwd) || (ctx && ctx.cwd) || undefined
  const opCtx = Object.assign({}, ctx || {}, cwd ? { cwd } : {})

  // 1) gh 可执行
  try {
    const platform = opCtx.platform
    if (!platform || typeof platform.resolveExecutable !== 'function') {
      // 这一条没有「上游原文」可言：宿主根本没交上来解析可执行文件的能力，是房内自己发现的事实。
      // 原文段留空串是如实表示「手里没有原文」，比编一句话强（要查就照 message 与这行日志查）。
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'gh not found: platform.resolveExecutable unavailable', raw: '' } }
    }
    const ghPath = await platform.resolveExecutable('gh')
    if (!ghPath) {
      // 同上：解析结果是 null，手里没有能当原文的文字。
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'gh not found: platform.resolveExecutable returned null (install https://cli.github.com/)', raw: '' } }
    }
  } catch (e) {
    // 抛出来这一路手里有原文：错误值原样交出去；档位与话术走本房唯一的出口。
    const verdict = ghVerdictOf(e, opCtx)
    return { ok: false, error: { kind: verdict.kind, message: ghFailureMessage(verdict, String((e && e.message) || e).slice(0, 400)), raw: rawText(e) } }
  }

  // 2) 登录态：gh auth status
  try {
    const c = ghClient(opCtx)
    const r = await c.execGh(['auth', 'status'], { cwd })
    if (!r.ok) {
      // 非 0 就把 client 层归一好的那一份失败原样交出去：档位、话术与原文都在里面，
      // 这里不再自己判第二遍（原来那三个分支最后返回的都是同一份 r.error）。
      return { ok: false, error: r.error }
    }
  } catch (e) {
    const verdict = ghVerdictOf(e, opCtx)
    return { ok: false, error: { kind: verdict.kind, message: ghFailureMessage(verdict, String((e && e.message) || e).slice(0, 400)), raw: rawText(e) } }
  }

  // 3) 仓库可达（含权限）：gh api repos/{owner}/{name}
  try {
    let refId = parseRepoRef(handle, opCtx)
    // 若无 refId，尝试 gh repo view 取当前仓库（与 host/index.js getRepoKey 同源）
    if (!refId) {
      const c = ghClient(opCtx)
      const rr = await c.execGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd })
      if (rr.ok) {
        const s = (rr.data.stdout || '').trim()
        if (s && s.includes('/')) refId = s
      }
    }
    if (!refId) {
      // 无仓库上下文 → 视为 not-found（无法判定仓库可达）。这条是房内自己推出来的结论：
      // 上面那条 `gh repo view` 真失败时，它的原文在它自己的失败结果里，这里手里没有原文，留空串。
      return { ok: false, error: { kind: ERROR_KIND.NOTFOUND, message: 'repo not found: cannot resolve owner/name (no refId and gh repo view failed)', raw: '' } }
    }
    const repo = repoFromRefId(refId)
    // 说「refId 形状不对」的原文就是这个 refId 本身：人一眼能看出错在哪。
    if (!repo) return { ok: false, error: { kind: ERROR_KIND.NOTFOUND, message: `repo refId malformed: ${refId}`, raw: String(refId) } }
    const c = ghClient(opCtx)
    const r = await c.execGh(['api', `repos/${repo.owner}/${repo.name}`], { cwd })
    if (!r.ok) {
      // 分类已在 client 层归一，此处直接返回
      return { ok: false, error: r.error }
    }
    return { ok: true }
  } catch (e) {
    const verdict = ghVerdictOf(e, opCtx)
    return { ok: false, error: { kind: verdict.kind, message: ghFailureMessage(verdict, String((e && e.message) || e).slice(0, 400)), raw: rawText(e) } }
  }
}

export default ghPreflight
