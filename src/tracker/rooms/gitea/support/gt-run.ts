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
 */
export async function runGt(effective: GtCtxLike | null | undefined, args: string[]): Promise<ExecResult> {
  const exec = effective && effective.exec
  if (!exec) return { code: 127, stderr: 'gt-run: 上下文里没有执行器（exec），读操作发不出去' }
  return exec('gt', args, { cwd: (effective && effective.cwd) || '', timeout: GT_READ_TIMEOUT_MS })
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
