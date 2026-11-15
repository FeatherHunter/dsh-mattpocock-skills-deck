/**
 * src/tracker/rooms/gitea/support/gt-run.ts —— gitea 房读路径的 gt 进程收尾与 gt 回包形状处理（票 #22）。
 *
 * 与 tea-run.ts 同构的执行薄层：超时整档、缺执行器回 127 都对齐 tea-run 的现行结构，
 * 区别只在三件 gt 特有的事：
 *   · gt 的 list 命令在还有下一页时，会在 JSON 之后往 stdout 追加一行人类提示
 *     `more results available; use --page N`（真机 gt 1.2.0 实测；真末页不带这一行）。
 *     解析前必须把这类提示行剥掉，否则 JSON.parse 直接失败；
 *   · gt 的 `--json` 回包里 author / assignees 是登录名字符串（不是对象，票 #20 实测），
 *     而归一层 normalizeIssue / normalizeComments 认的是 `{login}` 形状——这里补一层
 *     字符串 → 对象的适配，tea 分支不经这一层、行为零变化；
 *   · 票号字段叫 `number`（tea 叫 `index`），归一层 deriveKey 本来就回退认 number，不用改。
 *
 * 命令词汇（怎么拼参数）仍住在 tea-run.ts 一处：本文件只管「跑」与「收」，不管「拼」。
 *
 * 写路径（票 #23）也经同一个 runGt 收发。gt 的失败收尾比 tea 多两层结构（票 #23）：
 *   · 退出码判档：gt 文档化退出码（gt help exit-codes 实测）——0 成功、1 命令失败、
 *     2 用法错误（未知命令或旗标、参数不合法）、4 认证缺失或被拒。前两档之外这两档
 *     不用猜文字：4 直接归认证档，2 直接归输入档（我们拼错了词汇表，不是网络问题）；
 *   · JSON 错误消息：用户设了 GITEA_CLI_ERROR_FORMAT=json 时，gt 把错误以一行 JSON 打到
 *     stderr（真机 1.2.0 实测：{"error":{"code":1,"kind":"failure","message":"…","status":404}}）。
 *     设了就解析 message 交给本家判档表（not found / repository does not exist 这些原话都在
 *     消息里），没设或解析不出仍按文本兜底——两条路汇到同一个 classifyGiteaError。
 */

import type { BackendContext, ExecResult, OpContext } from '../../../contract/contexts.js'

/**
 * 上下文两形都收：与 tea-run.ts 的 CtxLike 同一形状（Partial<OpContext> & Partial<BackendContext>）。
 * 为什么不直接 import tea-run 的那份：gt-run 与 tea-run 是平级薄层，tea-run 要引本文件的 runGt
 * （词汇表分派），这条再回来引就成环（same-layer 门禁 2026-11-15 实抓）——各自用契约类型
 * 拼出同形结构，TS 结构化类型保证两边调用互通；改形状时两处要一起改。
 */
export type GtCtxLike = Partial<OpContext> & Partial<BackendContext>

/** gt 回包先收成键值袋再逐格判：与 tea-run.ts 的 RawBag 同一形状（同环理由，不互相 import）。 */
export type GtRawBag = Record<string, unknown>

/**
 * 一趟读等 gt 的时限（毫秒）。与 tea-run.ts 的 TEA_READ_TIMEOUT_MS 同一整档（10 秒）：
 * 同样是对外部 CLI 的稳态兜底超时，不走可调通道，口径与 #16 拍板一致。
 */
export const GT_READ_TIMEOUT_MS = 10000

/**
 * 发一趟 gt 命令：执行器从上下文取，cwd 用调用上下文里的那一格。
 * 缺执行器不是崩溃：按退出码 127、stderr 说明原因如实回，与 runTea 同一口径。
 * 读与写共用这一口（票 #23）：超时同为一趟对外部 CLI 的稳态兜底整档。
 */
export async function runGt(effective: GtCtxLike | null | undefined, args: string[]): Promise<ExecResult> {
  const exec = effective && effective.exec
  if (!exec) return { code: 127, stderr: 'gt-run: 上下文里没有执行器（exec），读操作发不出去' }
  return exec('gt', args, { cwd: (effective && effective.cwd) || '', timeout: GT_READ_TIMEOUT_MS })
}

/**
 * gt 的 JSON 错误行解析（票 #23）：设了 GITEA_CLI_ERROR_FORMAT=json 时，gt 把错误以一行 JSON
 * 打到 stderr，形状是 {"error":{"code":…,"kind":"…","message":"…","status":…}}（真机实测）。
 * 解析出 message 就回它（status 给了就带上）；不是合法 JSON、形状不对、message 不是非空串，
 * 都回 null——调用方按「没设或解析不出」走文本兜底，不猜。
 */
export function parseGtJsonError(stderrText: string): { message: string; status?: number } | null {
  if (typeof stderrText !== 'string' || stderrText.trim() === '') return null
  // 只认第一行：gt 的 JSON 错误占一行，后面的行（如果有）不参与解析。
  const firstLine = stderrText.split('\n')[0].trim()
  try {
    const parsed: unknown = JSON.parse(firstLine)
    const bag = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as GtRawBag) : null
    const inner = bag && bag['error'] && typeof bag['error'] === 'object' && !Array.isArray(bag['error'])
      ? (bag['error'] as GtRawBag)
      : null
    if (!inner) return null
    const message = inner['message']
    if (typeof message !== 'string' || message.trim() === '') return null
    const status = inner['status']
    return { message: message, status: typeof status === 'number' ? status : undefined }
  } catch {
    return null
  }
}

/**
 * 把一次非零退出的 gt 进程结果收成带给判档表的 Error（票 #23）：
 *   · 退出码 4（认证缺失或被拒）：Error 直接带 kind=auth——判档表见 top-level kind 就透传
 *     （errors.ts 的 carriedKind 同一口径），不用再猜 stderr 文字；
 *   · 退出码 2（用法错误）：Error 带 kind=parse——这是插件词汇表拼错了旗标，不是远端或网络问题；
 *   · 其余非零退出：消息优先取 JSON 错误行的 message（设了 GITEA_CLI_ERROR_FORMAT=json 才会有），
 *     没有就退回 stderr/stdout 原文，交给本家判档表按文字判，认不出落网络兜底。
 * 调用方把这个 Error 交给 failGitea 即可，原文（进程结果）照旧单独传。
 */
export function gtFailureError(res: ExecResult, envGet: ((name: string) => string | undefined) | null | undefined): Error {
  const code = typeof res.code === 'number' ? res.code : -1
  if (code === 4) {
    const e = new Error(res.stderr || res.stdout || 'gt: 认证缺失或被拒（退出码 4）')
    ;(e as unknown as Record<string, unknown>)['kind'] = 'auth'
    return e
  }
  if (code === 2) {
    const e = new Error(res.stderr || res.stdout || 'gt: 用法错误（退出码 2）')
    ;(e as unknown as Record<string, unknown>)['kind'] = 'parse'
    return e
  }
  // JSON 错误消息优先：只在用户设了 GITEA_CLI_ERROR_FORMAT=json 时 gt 才会产出这种行，
  // 所以这里不用再问环境变量——没设时 stderr 是纯文本，解析必然回 null，走文本兜底。
  const json = parseGtJsonError(typeof res.stderr === 'string' ? res.stderr : '')
  const text = json
    ? json.message
    : (typeof res.stderr === 'string' && res.stderr ? res.stderr : (typeof res.stdout === 'string' ? res.stdout : ''))
  const e = new Error(text || 'gt: 命令失败（退出码 ' + String(code) + '，无输出）')
  // status 是远端 HTTP 状态码（如 404）：带上让本家判档表的事实层看得见。
  if (json && json.status !== undefined) (e as unknown as Record<string, unknown>)['status'] = json.status
  // envGet 留着入参位：万一以后要按环境变量判「该不该期待 JSON 行」，口子开在这。
  void envGet
  return e
}

/**
 * 从建票的 --json 回读里取新票编号（票 #23，替换抠 #编号 文本的做法）：gt issue create 带
 * --json 时回包是单个 JSON 对象，票号在 number 格（数字或数字串都收）。取不到回 null——
 * 调用方拿不到编号时如实失败，绝不猜编号。
 */
export function createdIssueNumberOf(stdoutText: string): string | null {
  const raw = parseJsonBagText(typeof stdoutText === 'string' ? stdoutText : '')
  if (!raw) return null
  const n = raw['number']
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return String(n)
  if (typeof n === 'string' && /^\d+$/.test(n.trim())) return n.trim()
  return null
}

/** 本文件私有的单对象 JSON 解析（与 tea-run 的 parseJsonBag 同形状；不互引，避免环）。 */
function parseJsonBagText(text: string): GtRawBag | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as GtRawBag
  } catch {
    return null
  }
}

/**
 * 剥掉 gt 追加在 stdout 尾部的人类提示行（`more results available; use --page N`）。
 * 逐行从尾往前丢：JSON 主体之后的每一行都按提示行处理，遇到非空行即停——
 * 万一未来 gt 改了提示措辞，最坏结果是解析失败按「回包形状不对」如实报，不会吞数据。
 */
export function stripGtHint(text: string): string {
  const lines = (typeof text === 'string' ? text : '').split('\n')
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim()
    if (last === '' || /^more results available;/.test(last)) lines.pop()
    else break
  }
  return lines.join('\n')
}

/**
 * 把 gt 回包里的登录名字符串适配成归一层认的 `{login}` 形状：
 * author / assignees 两处（票 #20：`"author":"zhaolj"`、`"assignees":["zhaolj"]`）。
 * 本来就是对象的格子原样放行（面向未来的形状变化不做第二次猜测）。
 */
export function adaptGtRow(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const bag = raw as GtRawBag
  const out: GtRawBag = { ...bag }
  const a = bag['author']
  if (typeof a === 'string' && a.trim() !== '') out['author'] = { login: a.trim() }
  if (Array.isArray(bag['assignees'])) {
    out['assignees'] = bag['assignees'].map((x: unknown) =>
      typeof x === 'string' && x.trim() !== '' ? { login: x.trim() } : x,
    )
  }
  return out
}
