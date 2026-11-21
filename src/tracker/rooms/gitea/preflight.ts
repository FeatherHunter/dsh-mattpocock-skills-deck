/**
 * src/tracker/rooms/gitea/preflight.ts — 探测/登录/仓库可达（三判据骨架，#2 起步）。
 *
 * 契约与 GitLab 房同一条：preflight 只判环境（工具在/登录/可达），不预判能力；
 * 能力由操作/字段零推断。失败形状统一走 `fail()` 的三段式 `{kind, message, raw}`，
 * 有外部原文的那几步原文一律带上，界面/日志才有统一的兜底可展开。
 *
 * 三步的口径：
 *   1. `platform.resolveExecutable('tea')` → 不在归 ENV（这一步没有外部原文可看）；
 *   2. `tea login list` → 非零退出或没有任何登录项归 AUTH（按原文判档，走 classifyGiteaError）；
 *   3. `tea issues ls --limit 1`（在有 cwd 或仓库身份时）→ 仓库可达性，失败按原文判档。
 * 第三步没有仓库身份可问时直接算通过：前两关已经回答了「环境通不通」。
 *
 * 超时先用本文件常量起步：等本房接入 `config/timeouts.yaml` 那条中央超时线时再搬
 * （GitLab 房的两个超时都住在 `shared/time-config`，那是接入中央线之后的事，不在本票范围）。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { PreflightResult } from '../../contract/results.js'
import { fail } from '../../kernel/preflight.js'
import { classifyGiteaError } from './errors.js'
import { setSelectedExecutor } from './room/prompts.js'

/** 探针超时（毫秒）。起步值与 GitHub/GitLab 房的识别探针同量级；#16 拍板钉死在这，不入中央 YAML。 */
const TEA_PROBE_TIMEOUT_MS = 3000
// gt 版本探针的超时（毫秒，票 #21）：与 tea 探针同量级、同样不接中央 YAML——
// 它只跑 `gt api /version` 一条本地命令，探不上就落回 tea，不值得为它单独调参。
const GT_PROBE_TIMEOUT_MS = 3000
// gt 的服务器版本下限（票 #21，规格 Q3 拍板）：gt 1.x 只支持 Gitea 28 及以上，
// gt 自己对低版本服务器不拦（#20 真机实测），插件必须自己判这一档。
// Gitea 自报版本是 `1.27.2` 这种三段式，「28」指 `1.28` 那一档，所以下限折成
// 主版本*10000 + 次版本*100 的可比数（1.28.0 = 12800），未来升到 2.x 也比得出来。
const GITEA_GT_MIN_VERSION_NUM = 1 * 10000 + 28 * 100
// gt 版本探测认不出来的兜底句（票 #21）：出现这句说明 gt 装了但输出不像版本应答。
const GT_REASON_UNRECOGNIZED = 'unrecognized version output'
// gt 未安装的兜底句（票 #21）：giteaPreflight 用它识别「双缺」场景换组合文案。
const GT_REASON_NOT_FOUND = 'gt not found'
// 探测只要一条：这里取 1 不是分页契约的页大小（那条契约住在 src/tracker/contract/pagination.ts，
// 各后端同一套口径），只是「能列出一条就说明仓库可达」的最小请求，所以用本文件常量起步；
// 常量名不带 PAGE_SIZE 这类后缀，避免被当成页大小额度（那是共享表的管辖范围）。
const TEA_PROBE_FETCH_ONE = 1

// 预检入参两形都收，是因为调用方有时拿仓库身份、有时拿句柄，直接收窄会把另一路挡在门外。
type PreflightHandle = Partial<OpContext> & Partial<BackendContext> & {
  refId?: string
  cwd?: string
  repository?: { refId?: string }
} & Partial<RepositoryRef>

// 上下文缺字段就按本地失败回，是因为预检问的正是环境通不通，抛异常反而让调用方无原文可看。
type PreflightCtx = Partial<OpContext> & Partial<BackendContext>

/** 取抛上来的错误里那句可读的话：tea 进程的 stdout/stderr 挂在错误值身上，没有 message 就整段转字符串。 */
function messageOf(e: unknown): string {
  return e !== null && typeof e === 'object' && 'message' in (e as Record<string, unknown>)
    ? String((e as Record<string, unknown>)['message'] || e)
    : String(e)
}

/**
 * 三步探活：工具在不在、登录了没有、仓库连不连得上，每步失败都带原文回以便界面展开。
 *
 * @param handle 仓库身份或句柄（两种形状都收，只取其中的 refId 与 cwd）
 * @param opCtx 本次调用的上下文（平台与执行器从这里取）
 */
export async function teaPreflight(
  handle: PreflightHandle | null | undefined,
  opCtx: PreflightCtx | null | undefined,
): Promise<PreflightResult> {
  const ctx = (opCtx || handle) as PreflightCtx | null | undefined
  const platform = ctx && ctx.platform
  const exec = ctx && ctx.exec
  const cwd =
    (handle && typeof handle.cwd === 'string' ? (handle.cwd as string) : undefined) ||
    (ctx && typeof ctx.cwd === 'string' ? (ctx.cwd as string) : undefined) ||
    undefined
  // 空信号统一成 undefined，是因为执行器只收 undefined，null 会被当成非法值拦掉。
  const signal = ctx?.signal || undefined

  // 1) resolveExecutable('tea') → ENV
  if (!platform || typeof platform.resolveExecutable !== 'function') {
    // 原文给空串：这条结论来自「本机平台对象缺能力」，没有外部来源的原文可取。
    return fail(ERROR_KIND.ENV as ErrorKind, 'platform unavailable', '')
  }
  const exe = await platform.resolveExecutable('tea')
  if (!exe) {
    // 原文给空串：`resolveExecutable` 回答的是「没有」，没有一个原文可以抄给它。
    return fail(ERROR_KIND.ENV as ErrorKind, 'tea not found', '')
  }

  // 2) tea login list → 登录判据（非零退出按原文判档；列出的登录项为空也归 AUTH）
  if (!exec || typeof exec !== 'function') {
    // 原文给空串：本机没有可用的执行器，这条失败没有任何命令跑过。
    return fail(ERROR_KIND.ENV as ErrorKind, 'exec unavailable', '')
  }
  try {
    const loginRes = await exec('tea', ['login', 'list'], { cwd, signal, timeout: TEA_PROBE_TIMEOUT_MS })
    if (loginRes.code !== 0) {
      const out = String(loginRes.stdout || '') + '\n' + String(loginRes.stderr || '')
      const verdict = classifyGiteaError(loginRes, ctx || undefined)
      const message = out.trim().slice(0, 500) || 'tea login list failed'
      return fail(verdict.kind, message, out)
    }
    // tea 的 login list 没有登录项时退出码是 0：早期版本输出为空，新版打印一张只有表头
    //   边框的空表格（┌─┬...└─┘，trim 后非空，不能只看 trim）。两条路都归 AUTH 而不是算通过：
    //   去掉纯框线行后第一行是表头，表头之后一行都没有才算「零登录」。
    const rows = String(loginRes.stdout || '')
      .split(/\r?\n/)
      .filter(function (line) { return /\S/.test(line) && !/^[\s─│┌└├┤┬┴┼]*$/.test(line) })
    if (rows.length <= 1) {
      return fail(ERROR_KIND.AUTH as ErrorKind, 'tea has no login configured (run: tea login add)', '')
    }
  } catch (e: unknown) {
    const verdict = classifyGiteaError(e, ctx || undefined)
    return fail(verdict.kind, messageOf(e).slice(0, 500), e)
  }

  // 3) 仓库可达：`tea issues ls --limit 1`（tea 自己按 cwd 的 git remote 找仓库）；
  //    没有 cwd 也没有仓库身份可问时，前两关已经回答了环境问题，直接算通过。
  const hbag = (handle || {}) as Record<string, unknown>
  const repoBag = hbag['repository'] && typeof hbag['repository'] === 'object' ? (hbag['repository'] as Record<string, unknown>) : null
  const probeId =
    (typeof hbag['refId'] === 'string' && hbag['refId']) ||
    (repoBag && typeof repoBag['refId'] === 'string' && repoBag['refId']) ||
    ''
  if (probeId || cwd) {
    try {
      const probe = await exec('tea', ['issues', 'ls', '--limit', String(TEA_PROBE_FETCH_ONE)], { cwd, signal, timeout: TEA_PROBE_TIMEOUT_MS })
      const out = String(probe.stdout || '') + '\n' + String(probe.stderr || '')
      if (probe.code !== 0) {
        const verdict = classifyGiteaError(probe, ctx || undefined)
        return fail(verdict.kind, out.trim().slice(0, 500) || 'tea issues ls failed', out)
      }
    } catch (e: unknown) {
      return fail(ERROR_KIND.NETWORK as ErrorKind, messageOf(e).slice(0, 500), e)
    }
  }

  return { ok: true }
}

export default teaPreflight

/**
 * 从 `gt api /version` 的输出里解析 Gitea 服务器版本（票 #21）。
 *
 * #20 真机实测：这条命令的 stdout 是单键 JSON `{"version":"1.27.2"}`，优先按 JSON 解析
 * 取 `version` 字段；万一某个 gt 版本换了输出形状，兜底用正则在原文里找
 * `主.次.补丁` 三段式版本号。两路都认不出来回 null，由调用方按「输出不认识」落回 tea。
 * 返回值是 `主*10000 + 次*100 + 补` 的可比数（1.27.2 = 12702），让「≥ 1.28」
 * 能用一次数值比较判出来；2.x 的版本也照同一折法比，不需要另立分支。
 */
function parseGiteaVersionNum(text: string): number | null {
  const raw = (function (): string {
    try {
      const j: unknown = JSON.parse(text)
      if (j && typeof j === 'object' && 'version' in (j as Record<string, unknown>)) {
        return String((j as Record<string, unknown>)['version'] ?? '')
      }
    } catch {
      // 输出不是 JSON 就走下面的正则兜底，不需要额外动作。
    }
    return text
  })()
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null
}

/** gt 执行器现场探测的结论：available 为 false 时 reason 说明为什么落回 tea。 */
type GtProbe = { available: boolean; reason: string }

/**
 * gt 执行器现场探测（票 #21，规格 Q2/Q3 的判定顺序）：
 *   1. `platform.resolveExecutable('gt')` → 没装（'gt not found'）；
 *   2. `gt api /version` → 非零退出或抛异常 = 探测失败（带一句话原因）；
 *   3. 解析服务器主版本 → 低于 28（'server version below 28'）或认不出输出（'unrecognized version output'）。
 *
 * 每次调用都现场探测、不落任何持久缓存（规格明文）。这里只判「gt 能不能当执行器」；
 * gt 侧的登录与仓库可达探活、错误判档归后续票（#22/#23），本函数不碰。
 */
async function probeGtExecutor(
  platform: { resolveExecutable(name: string): Promise<string | null> | string | null },
  exec: ((cmd: string, args: string[], opts?: { cwd?: string; timeout?: number; signal?: AbortSignal; opId?: string }) => Promise<{ code?: number; stdout?: string; stderr?: string }>) | null | undefined,
  cwd: string | undefined,
  signal: AbortSignal | undefined,
): Promise<GtProbe> {
  let exe: string | null = null
  try {
    exe = await platform.resolveExecutable('gt')
  } catch (e: unknown) {
    return { available: false, reason: 'gt not found (' + messageOf(e).slice(0, 200) + ')' }
  }
  if (!exe) return { available: false, reason: GT_REASON_NOT_FOUND }
  if (!exec || typeof exec !== 'function') {
    return { available: false, reason: 'exec unavailable' }
  }
  let res: { code?: number; stdout?: string; stderr?: string }
  try {
    res = await exec('gt', ['api', '/version'], { cwd, signal, timeout: GT_PROBE_TIMEOUT_MS })
  } catch (e: unknown) {
    return { available: false, reason: 'gt api /version failed: ' + messageOf(e).slice(0, 200) }
  }
  if (res.code !== 0) {
    const out = (String(res.stdout || '') + '\n' + String(res.stderr || '')).trim().slice(0, 200)
    return { available: false, reason: 'gt api /version failed (exit ' + String(res.code) + ')' + (out ? ': ' + out : '') }
  }
  const versionNum = parseGiteaVersionNum(String(res.stdout || ''))
  if (versionNum === null) return { available: false, reason: GT_REASON_UNRECOGNIZED }
  if (versionNum < GITEA_GT_MIN_VERSION_NUM) return { available: false, reason: 'server version below 28' }
  return { available: true, reason: '' }
}

/**
 * Gitea 房的 preflight 入口（票 #21）：先探 gt 能不能当执行器，探不上统一落回 tea。
 *
 * 判定顺序与文案口径全部来自规格（父票 #19 Q2/Q3）：
 *   - gt 已装且 `gt api /version` 确认服务器 ≥ 28 → 选中 gt，结果带 `executor: 'gt'`；
 *   - gt 未装 / 探测失败 / 服务器 < 28 → 落回 tea，沿用 `teaPreflight` 的三步探活，
 *     结果带 `executor: 'tea'` 与 `fallbackReason`；tea 探活失败时把落回原因写进失败
 *     message 前缀（kind 与原文不变，判档不受影响）；
 *   - gt 与 tea 都没装 → ENV 失败，message 换成规格定的组合文案：指引装 gt，
 *     并说明仅当服务器低于 Gitea 28 时才需要 tea。
 *
 * 同时把选中结果写进提示词状态（`setSelectedExecutor`），契约注入读
 * `prompts.commandVocabulary.cli` 时就会跟着变成 'gt' 或 'tea'。
 */
export async function giteaPreflight(
  handle: PreflightHandle | null | undefined,
  opCtx: PreflightCtx | null | undefined,
): Promise<PreflightResult> {
  const ctx = (opCtx || handle) as PreflightCtx | null | undefined
  const platform = ctx && ctx.platform
  const exec = ctx && ctx.exec
  const cwd =
    (handle && typeof handle.cwd === 'string' ? (handle.cwd as string) : undefined) ||
    (ctx && typeof ctx.cwd === 'string' ? (ctx.cwd as string) : undefined) ||
    undefined
  const signal = ctx?.signal || undefined

  // 平台对象缺能力：gt/tea 都探不了，与旧口径同一句话、同一档 ENV。
  if (!platform || typeof platform.resolveExecutable !== 'function') {
    return fail(ERROR_KIND.ENV as ErrorKind, 'platform unavailable', '')
  }

  // 0) gt 现场探测 → 可用就选 gt（gt 侧的登录/可达探活与错误判档是后续票的范围）。
  const gt = await probeGtExecutor(platform, exec, cwd, signal)
  if (gt.available) {
    setSelectedExecutor('gt')
    return { ok: true, executor: 'gt' }
  }

  // 落回 tea：先写提示词状态，再跑原有的三步探活（行为与票 #21 之前完全一致）。
  setSelectedExecutor('tea')
  const tea = await teaPreflight(handle, opCtx)
  if (tea.ok) {
    return { ok: true, executor: 'tea', fallbackReason: gt.reason }
  }
  // 失败结果按契约 error 可缺省：真缺这一格时给一条兜底话，不往下解引用。
  const teaErr = tea.error || { kind: ERROR_KIND.ENV as ErrorKind, message: 'tea preflight failed without error details', raw: '' }

  // 双缺（gt 没装且 tea 也没装）：换成规格定的组合文案，指引装 gt 并说明 tea 的适用边界。
  if (gt.reason === GT_REASON_NOT_FOUND && teaErr.message === 'tea not found') {
    return {
      ok: false,
      error: {
        kind: teaErr.kind,
        message:
          'gt 与 tea 都未安装。请安装 gt（官方安装说明：https://gitea.com/gitea/cli）；仅当 Gitea 服务器版本低于 28 时才需要 tea（https://gitea.com/gitea/tea）。',
        raw: teaErr.raw,
      },
    }
  }

  // tea 探活失败：档位与原文原样保留，只在 message 前面写清为什么走了 tea，
  // 让人拿着一条失败也能回答「为什么没走 gt」。
  const prefix = 'gt 不可用（' + gt.reason + '），已落回 tea；'
  return {
    ok: false,
    error: {
      kind: teaErr.kind,
      message: prefix + teaErr.message,
      raw: teaErr.raw,
    },
  }
}
