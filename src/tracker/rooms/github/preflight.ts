/**
 * src/tracker/rooms/github/preflight.ts — 探测/登录/API 可达（三项门禁，只判环境，不预判能力）。
 *
 * 文件头原写 `backends/github/preflight.js`，是 #1019 目录归位前的旧路径；#1052 按读路径这一片改成今天的真名。
 *
 * 定版依据：#138 §1.5 + 契约 preflight 签名 + #129 平台三底座
 * - 签名：(handle: RepoHandle, ctx: OpContext) => Promise<PreflightResult>
 *   handle: {cwd?, refId?}；ctx: BackendContext（含 platform/exec/timers/fs/log）+ cwd/signal/refId
 * - 三项检查顺序：1) gh 可执行 → env；2) 登录态 → auth；3) 仓库可达 → not-found/auth/network/rate-limit
 * - 不检查：labels/subIssue/depGraph 等能力；不返回 capabilities 布尔表（旧 BackendStatus 已删）
 * - 错误归一全经 ghVerdictOf（判档表在 src/tracker/kernel/error-rules.ts）
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext, RepoHandle } from '../../contract/contexts.js';
import type { PreflightResult } from '../../contract/results.js';
import { rawText } from '../../kernel/preflight.js'
import { ghClient } from './client.js'
import { ghFailureMessage, ghVerdictOf } from './errors.js'
import { emitPreflightGatePass, emitReadDegraded } from './read-log.js'

// 为什么 catch 里的错误要先转这层再读：catch 出来是 unknown，短路后的真值分支会被收成空对象形状、
// 直接读 message 报缺成员；转成最小形状后读法与原来一致，运行时不变。
type CaughtMsg = { message?: unknown } | null;
function caughtMessage(e: unknown): string {
  const eb = e as CaughtMsg;
  return String((eb && eb.message) || e).slice(0, 400)
}

function parseRepoRef(handle: RepoHandle | null | undefined, ctx: OpContext): string | null {
  // 优先 handle.refId，其次 ctx.refId，再尝试从 cwd 的 git remote 解析（简化：若 refId 无则用 gh repo view）
  if (handle && typeof handle.refId === 'string' && handle.refId) return handle.refId
  if (ctx && typeof ctx.refId === 'string' && ctx.refId) return ctx.refId
  return null
}

function repoFromRefId(refId: string | null): { owner: string; name: string } | null {
  if (!refId || typeof refId !== 'string') return null
  const idx = refId.indexOf('/')
  if (idx <= 0) return null
  return { owner: refId.slice(0, idx), name: refId.slice(idx + 1) }
}

// #195 曾经在这里挂着一整段「怎么装 gh」的长文（按系统分平台列命令），交给界面直接注入。
// #664（首开引导链定版 #661 第③条）：缺 gh 时注入的文案收成一句原话（「/wizard 帮用户安装gh cli 官方地址：
//   https://cli.github.com/」），唯一一份住在共享清单 src/shared/tracker/guide-steps.js 的 gh:installed
//   那一步里，界面从那一步取它。那段长文与预检结果里的 prompt 字段随之退役 —— 一个缺失状态不许有两份说明。

/**
 * @param {import('../../contract/index.js').RepoHandle} handle
 * @param {import('../../contract/index.js').OpContext} ctx
 * @returns {Promise<import('../../contract/index.js').PreflightResult>}
 */
export async function ghPreflight(handle: RepoHandle, ctx: OpContext): Promise<PreflightResult> {
  const cwd = (handle && handle.cwd) || (ctx && ctx.cwd) || undefined
  // 2026-10-14 收口改法（#1052 的收尾）：这里原先写 Object.assign({}, ctx || {}, cwd ? { cwd } : {})，
  // 推出来的类型只有 { cwd: string } | { cwd?: undefined } —— OpContext 的成员一个不剩，
  // 于是每一处把它当 OpContext / ClassifyCtx 传下去的地方都报 TS2345（探针门禁里从 4 条涨到 16 条）。
  // 写成带类型标注的对象展开后形状由标注钉住；运行时仍是同一份浅拷贝（自有的可枚举属性逐个搬过去），
  // ctx 若是 null/undefined，展开与原来的 ctx || {} 等价（都得到没有自有属性的空对象）。
  const opCtx: OpContext = { ...ctx, ...(cwd ? { cwd } : {}) }

  // 这一笔的起点：三项门禁的每一行日志都要带「从探测入口到这里花了多久」。
  const t0 = Date.now()

  // 1) gh 可执行
  try {
    const platform = opCtx.platform
    if (!platform || typeof platform.resolveExecutable !== 'function') {
      // 这一条没有「上游原文」可言：宿主根本没交上来解析可执行文件的能力，是房内自己发现的事实。
      // 原文段留空串是如实表示「手里没有原文」，比编一句话强（要查就照 message 与这行日志查）。
      emitReadDegraded(opCtx, 'preflight', 'preflight:gh', Date.now() - t0)
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'gh not found: platform.resolveExecutable unavailable', raw: '' } }
    }
    const ghPath = await platform.resolveExecutable('gh')
    if (!ghPath) {
      // 同上：解析结果是 null，手里没有能当原文的文字。
      emitReadDegraded(opCtx, 'preflight', 'preflight:gh', Date.now() - t0)
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'gh not found: platform.resolveExecutable returned null (install https://cli.github.com/)', raw: '' } }
    }
  } catch (e) {
    // 抛出来这一路手里有原文：错误值原样交出去；档位与话术走本房唯一的出口。
    const verdict = ghVerdictOf(e, opCtx)
    emitReadDegraded(opCtx, 'preflight', 'preflight:gh', Date.now() - t0)
    return { ok: false, error: { kind: verdict.kind, message: ghFailureMessage(verdict, caughtMessage(e)), raw: rawText(e) } }
  }
  // 过了第一关（找得到 gh 可执行）：记一行，好让「探测走到第几关」在日志里是看得见的。
  emitPreflightGatePass(opCtx, 1, Date.now() - t0)

  // 2) 登录态：gh auth status
  const t1 = Date.now()
  try {
    const c = ghClient(opCtx)
    const r = await c.execGh(['auth', 'status'], { cwd, via: 'preflight.auth' })
    if (!r.ok) {
      // 非 0 就把 client 层归一好的那一份失败原样交出去：档位、话术与原文都在里面，
      // 这里不再自己判第二遍（原来那三个分支最后返回的都是同一份 r.error）。
      emitReadDegraded(opCtx, 'preflight', 'preflight:auth', Date.now() - t1)
      return { ok: false, error: r.error }
    }
  } catch (e) {
    const verdict = ghVerdictOf(e, opCtx)
    emitReadDegraded(opCtx, 'preflight', 'preflight:auth', Date.now() - t1)
    return { ok: false, error: { kind: verdict.kind, message: ghFailureMessage(verdict, caughtMessage(e)), raw: rawText(e) } }
  }
  emitPreflightGatePass(opCtx, 2, Date.now() - t1)

  // 3) 仓库可达（含权限）：gh api repos/{owner}/{name}
  const t2 = Date.now()
  try {
    let refId = parseRepoRef(handle, opCtx)
    // 若无 refId，尝试 gh repo view 取当前仓库（与 host/index.js getRepoKey 同源）
    if (!refId) {
      const c = ghClient(opCtx)
      const rr = await c.execGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd, via: 'preflight.repo-view' })
      if (rr.ok) {
        const s = (rr.data.stdout || '').trim()
        if (s && s.includes('/')) refId = s
      }
    }
    if (!refId) {
      // 无仓库上下文 → 视为 not-found（无法判定仓库可达）。这条是房内自己推出来的结论：
      // 上面那条 `gh repo view` 真失败时，它的原文在它自己的失败结果里，这里手里没有原文，留空串。
      emitReadDegraded(opCtx, 'preflight', 'preflight:repo-view', Date.now() - t2)
      return { ok: false, error: { kind: ERROR_KIND.NOTFOUND, message: 'repo not found: cannot resolve owner/name (no refId and gh repo view failed)', raw: '' } }
    }
    const repo = repoFromRefId(refId)
    // 说「refId 形状不对」的原文就是这个 refId 本身：人一眼能看出错在哪。
    if (!repo) {
      emitReadDegraded(opCtx, 'preflight', 'preflight:repo-view', Date.now() - t2)
      return { ok: false, error: { kind: ERROR_KIND.NOTFOUND, message: `repo refId malformed: ${refId}`, raw: String(refId) } }
    }
    const c = ghClient(opCtx)
    // 这是三项门禁里的第三项（能连上接口）：这一笔的成败在日志里由 via 认领。
    const r = await c.execGh(['api', `repos/${repo.owner}/${repo.name}`], { cwd, via: 'preflight.api' })
    if (!r.ok) {
      // 分类已在 client 层归一，此处直接返回
      emitReadDegraded(opCtx, 'preflight', 'preflight:api', Date.now() - t2)
      return { ok: false, error: r.error }
    }
    // 三关全过也记一行：不然「探测走到底了」在日志里只是三行长得一样的 gh.exec，读的人看不出走到哪。
    emitPreflightGatePass(opCtx, 3, Date.now() - t2)
    return { ok: true }
  } catch (e) {
    const verdict = ghVerdictOf(e, opCtx)
    emitReadDegraded(opCtx, 'preflight', 'preflight:api', Date.now() - t2)
    return { ok: false, error: { kind: verdict.kind, message: ghFailureMessage(verdict, caughtMessage(e)), raw: rawText(e) } }
  }
}

export default ghPreflight
