/**
 * src/tracker/rooms/github/read/preflight.ts — 探测/登录/API 可达（三项门禁，只判环境，不预判能力）。
 * #1686 阶段 1：从房间根迁入 read/，旧路径 src/tracker/rooms/github/preflight.ts 保留纯转发，行为零变化。
 *
 * 文件头原写 `backends/github/preflight.js`，是 #1019 目录归位前的旧路径；#1052 按读路径这一片改成今天的真名。
 *
 * 定版依据：#138 §1.5 + 契约 preflight 签名 + #129 平台三底座
 * - 签名：(handle: RepoHandle, ctx: OpContext) => Promise<PreflightResult>
 *   handle: {cwd?, refId?}；ctx: BackendContext（含 platform/exec/timers/fs/log）+ cwd/signal/refId
 * - 三项检查顺序：1) gh 可执行 → env；2) 登录态 → auth（auth status 判成 auth 时再用 gh api user 核对一次，
 *   免得把「连不上」认成「没登录」）；3) 仓库可达 → not-found/auth/network/rate-limit
 * - 不检查：labels/subIssue/depGraph 等能力；不返回 capabilities 布尔表（旧 BackendStatus 已删）
 * - 错误归一全经 ghVerdictOf（判档表在 src/tracker/kernel/error-rules.ts）
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext, RepoHandle } from '../../../contract/contexts.js';
import type { PreflightResult } from '../../../contract/results.js';
import { rawText } from '../../../kernel/preflight.js'
import { ghClient } from '../transport/client.js'
import type { GhExecResult } from '../transport/client.js'
import { ghFailureMessage, ghVerdictOf } from '../support/errors.js'
import { emitPreflightGatePass, emitReadDegraded } from '../support/read-log.js'
import { timeoutForGhArgs } from '../../../kernel/outbound-tiers.js'

// —— #1475：检测链外层等待预算里「内层串行最坏」那一段的算式 ——
// 为什么这份表住在 preflight 自己文件里：它是「一次环境预检会串行问哪几条命令」的唯一真源，
// 调用方（检测链）只读算出来的结果，不抄第二份数字。
// argv 只在预算这边用来从中央出站档位（探活 15 秒 / 读 12 秒）取这一条的等待上限；
// 与下面 ghPreflight 真实调用共用同一批常量，不另抄一份字面量 —— 命令参数一改，两边一起改。
const GH_AUTH_STATUS_ARGV: ReadonlyArray<string> = ['auth', 'status']
const GH_API_USER_ARGV: ReadonlyArray<string> = ['api', 'user']
const GH_REPO_VIEW_ARGV: ReadonlyArray<string> = ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']
// 仓库可达那一条的接口路径要带 owner/name，只能按真实仓库现拼；预算这边用占位名字同一个构造函数拼一份，
// 占位只用来判档位（api 读档），真实调用时换成真名。
function ghRepoApiArgv(owner: string, name: string): string[] {
  return ['api', 'repos/' + owner + '/' + name]
}

type GhPreflightStep = { via: string; argv: ReadonlyArray<string> };
export const GH_PREFLIGHT_SERIAL_STEPS: ReadonlyArray<GhPreflightStep> = [
  { via: 'preflight.auth', argv: GH_AUTH_STATUS_ARGV },
  { via: 'preflight.auth-crosscheck', argv: GH_API_USER_ARGV },
  { via: 'preflight.repo-view', argv: GH_REPO_VIEW_ARGV },
  { via: 'preflight.api', argv: ghRepoApiArgv('<owner>', '<name>') },
];

// 一次预检会串行问哪几条命令：下面五条路径彼此互斥（不是四条命令依次都跑），一次预检只走其中一条：
// - 登录不通过、核对也不通过：查登录 → 核对登录，然后带着失败结论返回；
// - 登录不通过、核对通过：查登录 → 核对登录 → 再走第 3 关（核对通过只说明登录可用，仓库可达还没查）；
//   缺仓库短名时要先读一次仓库短名，所以这条岔成下面第 2、4、5 条两个变体；
// - 登录通过、已有仓库短名：查登录 → 读仓库可达；
// - 登录通过、缺仓库短名：查登录 → 先读仓库短名 → 再读仓库可达。
// 内层最坏 = 这五条路径里超时和最大的一条，不是四条相加；最宽的是「核对通过 + 缺仓库短名」那条
// （15 + 15 + 12 + 12 秒），门禁 tests/verify-1475-predicate-budget.ts 会盯着它。
export const GH_PREFLIGHT_SERIAL_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ['preflight.auth', 'preflight.api'],
  ['preflight.auth', 'preflight.repo-view', 'preflight.api'],
  ['preflight.auth', 'preflight.auth-crosscheck'],
  ['preflight.auth', 'preflight.auth-crosscheck', 'preflight.api'],
  ['preflight.auth', 'preflight.auth-crosscheck', 'preflight.repo-view', 'preflight.api'],
];

// 内层一次环境预检的串行最坏耗时（毫秒）：按中央出站档位现算，不在任何地方手写数字。
// 外层等待预算必须 ≥ 这个值 + 余量，否则慢网下会出现「外层先到点、内层还在跑、这次求值的结论被丢掉」；
// 这条算式由门禁 tests/verify-1475-predicate-budget.ts 断言。
export function ghPreflightWorstCaseMs(): number {
  let worst = 0
  for (const path of GH_PREFLIGHT_SERIAL_PATHS) {
    let sum = 0
    for (const via of path) {
      const step = GH_PREFLIGHT_SERIAL_STEPS.find(function (s) { return s.via === via })
      if (!step) throw new Error('ghPreflightWorstCaseMs: 未登记的预检步骤 ' + via)
      sum += timeoutForGhArgs(step.argv)
    }
    if (sum > worst) worst = sum
  }
  return worst
}

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

/**
 * #916：拿一次 `gh api user` 核对「到底是不是真的没登录」。
 *
 * 只在 `gh auth status` 判成 auth 时才调。为什么非核对不可：auth status 会先读本地 hosts.yml、再拿令牌
 * 去问接口，连不上时它把「问不到」写成「令牌无效」—— 2026-10-25 在本机把 HTTPS_PROXY 指到一个没人听的
 * 端口，它照样打印「Failed to log in … the token … is invalid … To re-authenticate, run: gh auth refresh」，
 * 与凭据真失效时一字不差，原文里一个网络字样都没有（样本见门禁 tests/verify-916-ghauth-crosscheck.ts）。
 * 只看这些字样，网络抖动就会被判成「确定没登录」，界面随之弹出登录指引、要人重走一遍浏览器授权。
 *
 * `gh api user` 必须真的走到接口：成功即登录可用；失败时原文要么是连接错误、要么是 401 / 退出码 4，
 * 前者归网络档、后者归 auth 档，两种情形就此分开。
 *
 * 这里只负责发那一笔并原样交回，不自己判档：判档出口只有 ghVerdictOf 一处（client 层归一），
 * 调用方拿着同一份结果决定第 2 关过不过。execGh 抛出来的异常也不在这里吞 —— 调用方的 catch 会按
 * 同一套判档表归一。
 */
async function crosscheckGhAuth(c: ReturnType<typeof ghClient>, cwd: string | undefined): Promise<GhExecResult> {
  return c.execGh([...GH_API_USER_ARGV], { cwd, via: 'preflight.auth-crosscheck' })
}

// #195 曾经在这里挂着一整段「怎么装 gh」的长文（按系统分平台列命令），交给界面直接注入。
// #664（首开引导链定版 #661 第③条）：缺 gh 时注入的文案收成一条提示词，唯一一份住在 GitHub 后端声明的
//   prompts.cliInstall（清单 gh:installed 那一步只声明键名），界面按清单声明的键名去取。那段长文与预检
//   结果里的 prompt 字段随之退役 —— 一个缺失状态不许有两份说明。
// #1621：那条提示词改成「先确认装没装、再按结果分流」的说法；本文件只负责判定与分类，不产出提示词正文。

/**
 * @param {import('../../../contract/index.js').RepoHandle} handle
 * @param {import('../../../contract/index.js').OpContext} ctx
 * @returns {Promise<import('../../../contract/index.js').PreflightResult>}
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
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'gh not found: platform.resolveExecutable returned null — DSH resolves gh only from the PATH inherited at process startup; if gh is installed in a directory absent from that PATH, add it to PATH or set DSH_GH_PATH to the absolute path of the gh executable before restarting DSH (install only if gh is not installed: https://cli.github.com/)', raw: '' } }
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
    const r = await c.execGh([...GH_AUTH_STATUS_ARGV], { cwd, via: 'preflight.auth' })
    if (!r.ok) {
      // 非 0 先别急着交出去：判成 auth 的那一路可能是「连不上」冒充的（见 crosscheckGhAuth 上面的说明）。
      // 再拿 gh api user 核对一次，核对成功就说明登录可用，第 2 关照过；核对失败则交出核对那一份 ——
      // 它若仍是 auth（401 / 退出码 4）就是真的没登录，若是网络/超时等档位，链上会判「暂时确认不了」。
      // 只在 auth 档核对：网络/超时本来就直接判 pending，离线时不该再多白等一个读档超时。
      let error = r.error
      let confirmedUsable = false
      if (r.error.kind === ERROR_KIND.AUTH) {
        const verified = await crosscheckGhAuth(c, cwd)
        confirmedUsable = verified.ok
        if (!verified.ok) error = verified.error
      }
      if (!confirmedUsable) {
        emitReadDegraded(opCtx, 'preflight', 'preflight:auth', Date.now() - t1)
        return { ok: false, error }
      }
      // 核对通过：auth status 那一笔只是网络带来的假象，登录态按已确认处理，继续第 3 关。
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
      const rr = await c.execGh([...GH_REPO_VIEW_ARGV], { cwd, via: 'preflight.repo-view' })
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
    const r = await c.execGh(ghRepoApiArgv(repo.owner, repo.name), { cwd, via: 'preflight.api' })
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
