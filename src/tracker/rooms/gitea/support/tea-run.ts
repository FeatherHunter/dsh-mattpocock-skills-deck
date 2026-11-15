/**
 * src/tracker/rooms/gitea/support/tea-run.ts —— gitea 房读路径共用的 tea 进程收尾与命令词汇表。
 *
 * 为什么住在 support/：capability-register.ts 是纯数据（G5 红线），读路径的共用助手另立一个文件，
 * 不往登记数据里掺函数。八个读操作（票 #11）全部经由这里发起 tea 调用：
 *   · 命令词汇表只有一处出处（本文件），各操作文件只挑词汇、不再自己拼参数——同一含义的命令
 *     写两遍就会漂移（例：一处带 --output json 一处不带，解析就分叉）；
 *   · 执行器从上下文取（opCtx 优先，缺了按 127 如实回，与 GitLab 房 glabClient 同一口径）；
 *   · JSON 解析失败不算崩溃：回包先按 unknown 收，形状不对回 null，由调用方挑错误档位。
 *
 * tea 命令面（本房词汇，票 #3 的口径，真机上以实测修正；写路径的参数形状按本机 tea 0.16.0
 *   的 --help 逐条核对过，票 #12）：
 *   · gt/tea 分派（票 #22）：list / 单票 / comments 三条读路径的词汇按 preflight 选中的执行器
 *     分派——gt 的拼法与回包形状以票 #20 真机核对（及 2026-11-15 gt 1.2.0 本机实测）为准；
 *     gt 的执行与回包适配住在同目录 gt-run.ts。tea 分支的词汇与改动前一致（Q6 长期共存）。
 *   写路径（票 #23）：全部写操作的词汇同样按选中执行器分派——gt 的拼法以 2026-11-15 本机
 *     gt 1.2.0 --help 与真机核对为准（票 #20 结论 + 本次复核）：
 *   列表页：tea issues ls --repo <refId> --state open|closed|all [--labels a,b] --output json --limit N --page P
 *   单票：  tea issues <编号> --repo <refId> --output json
 *   评论：  tea issues <编号> comments --repo <refId> --output json --limit N --page P
 *   标签：  tea labels ls --repo <refId> --output json --limit N --page P
 *   gt 写路径（票 #23；全部经 2026-11-15 真机/本机 --help 逐条核对）：
 *   建票：  gt issue create -R <refId> --title T [--body D] [--label 名 …] [--assignee 登录名 …] --json
 *           （gt 的 create 认 --json，回包是含 number 的单对象——建票编号从这读，
 *           替换 tea 路径 parseCreatedIssueKey 抠 #编号 的做法；tea 分支零改动）
 *   关/开： gt issue close|reopen <编号> -R <refId> --json
 *   改票：  gt issue edit <编号> -R <refId> [--title T] [--body D] [--add-label 名 …]
 *           [--remove-label 名 …] [--set-labels a,b] [--set-assignees a,b]
 *           [--milestone 名|--remove-milestone] --json
 *           （gt 增删与整集替换两种旗标都有——票 #20 真机结论；gt 侧整集替换直接用
 *           --set-labels，不再算差集；tea 分支维持差集增删，语义两边一致；
 *           清里程碑走 --remove-milestone——2026-11-16 真机实测票 #27：gt 的 --milestone ''
 *           是退出码 2 的用法错，契约层「清空给空串」由本词汇表在 gt 分支转译成清空旗标）
 *   评注：  gt issue comment <编号> -R <refId> --body <正文> --json
 *   标签：  gt label list -R <refId> --json --limit N --page P（ensureLabels 与改色的对照表共用）
 *   建标签：gt label create <名字> --color <六位十六进制> -R <refId> --json
 *   改色：  gt label edit <数字id> --color <六位十六进制> -R <refId> --json（认 id，不认名字）
 *   tea 写路径（票 #12 口径不变；gt 接入后这些拼法逐字未动）：
 *   建票：  tea issues create --repo <refId> --title T --description D [--labels a,b] [--assignees a,b]
 *           （create 不认 --output，回包是含 #编号 的一行文本，用 parseCreatedIssueKey 抠编号）
 *   关/开： tea issues close|reopen <编号> --repo <refId> --output json
 *   改票：  tea issues edit <编号> --repo <refId> [--title T] [--description D] [--add-labels a,b]
 *           [--remove-labels a,b] [--set-assignees a,b] [--milestone M|''] --output json
 *           （tea 没有 --labels 整集替换，setLabels 先读现标签再算 add/remove 差集）
 *   评注：  tea comments add <编号> --repo <refId> --description <正文> --output json
 *   改色：  tea labels update --id <数字id> --color <六位十六进制> --repo <refId> --output json
 *   建标签：tea labels create --name <名字> --color <六位十六进制> --repo <refId> --output json
 *           （写路径遇仓库里没有的标签先建再挂，理由见 argsLabelCreate）
 *           （update 只认标签的数字 id，不认名字：改色前先翻页拉一遍「名字→id」对照）
 *   登录：  tea logins ls --output json（default 标默认登录，user 字段是登录名；tea whoami 不出 JSON）
 *   扫仓：  tea repos ls --output json --fields owner,name,permission --limit N --page P（权限读用）
 */

import type { BackendContext, ExecResult, OpContext } from '../../../contract/contexts.js'
import type { ListFilter } from '../../../contract/inputs.js'
import type { RepositoryRef } from '../../../contract/entities.js'
import { runGt, adaptGtRow, stripGtHint, gtFailureError, createdIssueNumberOf, type GtCtxLike } from './gt-run.js'
// 执行器选择状态住在 room/prompts.ts（#21 preflight 探测完写进来）；词汇表按它分派 gt/tea。
// prompts 不回读本文件，这条依赖是单向的，没有环。
import { selectedExecutor, type GiteaExecutorCli } from '../room/prompts.js'

/** 上下文两形都收：调用方有时把执行器放在 ctx、有时放在 opCtx（GitLab 房同一套形状）。 */
export type CtxLike = Partial<OpContext> & Partial<BackendContext>

/** tea 回包先收成键值袋再逐格判：远端字段可缺可空，直接按定型读会把缺字段当成错。 */
export type RawBag = Record<string, unknown>

/**
 * 一趟读等 tea 的时限（毫秒）。探活那趟用 preflight.ts 的短档（3 秒）；真正的读可能要翻页，
 * 给 10 秒整档。#16 拍板写死在这里并钉住，不搬进中央超时线（config/timeouts.yaml）：
 * 这是对外部 CLI 的稳态兜底超时，不走可调通道。
 */
export const TEA_READ_TIMEOUT_MS = 10000

/**
 * 发一趟 tea 命令：执行器从上下文取，cwd 用调用上下文里的那一格。
 * 缺执行器不是崩溃：按退出码 127、stderr 说明原因如实回，让上层走统一的错误判档。
 */
export async function runTea(effective: CtxLike | null | undefined, args: string[]): Promise<ExecResult> {
  const exec = effective && effective.exec
  if (!exec) return { code: 127, stderr: 'tea-run: 上下文里没有执行器（exec），读操作发不出去' }
  return exec('tea', args, { cwd: (effective && effective.cwd) || '', timeout: TEA_READ_TIMEOUT_MS })
}

/** 把 stdout 解析成数组：不是合法 JSON、或不是数组，都回 null（调用方按「回包形状不对」挑档位）。 */
export function parseJsonRows(text: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 把 stdout 解析成单个对象：同理，形状不对回 null。 */
export function parseJsonBag(text: string): RawBag | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as RawBag
  } catch {
    return null
  }
}

/** 异常对象上的 message；不是 Error 的东西就 String() 一下，消息里要有原话。 */
export function errMsg(e: unknown): string {
  const m = (e as { message?: unknown } | null | undefined)?.message
  return typeof m === 'string' && m ? m : String(e)
}

/** 仓库标识只取 refId：tea 的 --repo 认 owner/name；缺了回空串，由调用方按「没有可用目标」如实失败。 */
export function refIdOf(repo: Partial<RepositoryRef> | null | undefined): string {
  const raw = repo && typeof repo.refId === 'string' ? repo.refId.trim() : ''
  return raw
}

/**
 * filter.labels 归一：去掉空白项与重复项，保持原顺序。契约口径 labels 是 AND：
 * 空数组等于不过滤；tea 的 --labels 逗号分隔多个标签，语义正好是「同时命中」。
 */
export function labelsOf(filter: ListFilter | null | undefined): string[] {
  const labels = filter && Array.isArray(filter.labels) ? filter.labels : []
  const out: string[] = []
  for (const label of labels) {
    const name = typeof label === 'string' ? label.trim() : ''
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * filter.state 归一（票 #14 评审收编：原先 issues/pages.ts 与 issues/counts.ts 各私有一份
 * 同语义的实现，收进这一处）：只有 open / closed 两种收窄，其余（含缺失、含契约外的值）
 * 都是「两种都要」（空串）。调用方拿空串自己换成 all——tea 不带 --state 默认只回 open，
 * 会静默少一半，不许把「没给」直接透传给远端。
 */
export function narrowStateOf(filter: Partial<ListFilter> | null | undefined): 'open' | 'closed' | '' {
  const state = filter && typeof filter.state === 'string' ? filter.state.trim().toLowerCase() : ''
  return state === 'open' || state === 'closed' ? state : ''
}

/**
 * 当前选中的执行器（票 #22）：preflight（#21）探测完经 setSelectedExecutor 写进 room/prompts.ts，
 * 词汇表、读路径与写路径（票 #23 起读写共用）都按这里返回的值分派 gt / tea。
 * 什么都没探测过时是 'tea'，与旧行为一致。
 */
export function selectedCli(): GiteaExecutorCli {
  return selectedExecutor()
}

/**
 * 读路径统一的执行入口（票 #22）：按选中执行器把同一份参数发给 gt 或 tea。
 * tea 分支原样走 runTea——把三个读操作文件里的 runTea 调用换成这一入口后，
 * tea 选中的行为与改动前逐字节一致（#22 验收判据）。
 */
/**
 * gt / tea 的同一份分派（票 #23 评审收编）：读写共用这一条表达式，分派逻辑只写一处——
 * 以后执行器选择变化（比如加第三家）只改这里。
 */
function dispatchCli(effective: CtxLike | null | undefined, args: string[]): Promise<ExecResult> {
  return selectedCli() === 'gt' ? runGt(effective, args) : runTea(effective, args)
}

export async function runRead(effective: CtxLike | null | undefined, args: string[]): Promise<ExecResult> {
  return dispatchCli(effective, args)
}

/**
 * 写路径统一的执行入口（票 #23）：与 runRead 同一条分派——按选中执行器把同一份参数发给
 * gt 或 tea。tea 分支原样走 runTea，写路径各操作文件把 runTea 调用换成这一入口后，
 * tea 选中的行为与改动前逐字节一致（#23 验收判据「tea 写路径零改动」）。
 */
export async function runWrite(effective: CtxLike | null | undefined, args: string[]): Promise<ExecResult> {
  return dispatchCli(effective, args)
}

/**
 * 写路径失败收口的 Error 构造（票 #23）：gt 选中时走 gt-run 的结构化判档（退出码 4/2 直接
 * 带档位、JSON 错误行解 message），tea 选中时维持改动前「stderr 优先」的原话收法——
 * 两边各自如实，调用方拿这一个函数替掉手拼 new Error 那一行即可。
 */
export function writeFailureError(res: ExecResult, effective: CtxLike | null | undefined, fallbackText: string): Error {
  if (selectedCli() === 'gt') return gtFailureError(res)
  return new Error(res.stderr || res.stdout || fallbackText)
}

/**
 * 写路径失败文案（票 #23 评审收编）：按选中执行器给命令原文——同一处写操作在 tea 与 gt 下
 * 命令不同，报错里写错执行器会误导排障的人（Human-first wording；读路径的
 * readListCommandLabel 同一条先例）。tea 分支的字面量与票 #12 改动前逐字一致。
 * fallback 进 Error 原文（stderr/stdout 都空时才可见），human 是 failGitea 给人看的结论行。
 */
const WRITE_FAILURE_TEXTS: Record<string, { teaCmd: string; gtCmd: string; human: string }> = {
  create: { teaCmd: 'tea issues create', gtCmd: 'gt issue create', human: '建票失败' },
  close: { teaCmd: 'tea issues close', gtCmd: 'gt issue close', human: '关票失败' },
  reopen: { teaCmd: 'tea issues reopen', gtCmd: 'gt issue reopen', human: '重开失败' },
  update: { teaCmd: 'tea issues edit', gtCmd: 'gt issue edit', human: '改票失败' },
  comment: { teaCmd: 'tea comments add', gtCmd: 'gt issue comment', human: '写评论失败' },
  setParent: { teaCmd: 'tea issues edit', gtCmd: 'gt issue edit', human: '改归属失败' },
  setBlockedBy: { teaCmd: 'tea issues edit', gtCmd: 'gt issue edit', human: '改阻塞关系失败' },
  setLabels: { teaCmd: 'tea issues edit', gtCmd: 'gt issue edit', human: '改标签失败' },
  setAssignees: { teaCmd: 'tea issues edit', gtCmd: 'gt issue edit', human: '改认领人失败' },
  setLabelColors: { teaCmd: 'tea labels update', gtCmd: 'gt label edit', human: '改标签颜色失败' },
}

export function writeFailureTexts(op: keyof typeof WRITE_FAILURE_TEXTS): { fallback: string; human: string } {
  const row = WRITE_FAILURE_TEXTS[op]
  const cmd = selectedCli() === 'gt' ? row.gtCmd : row.teaCmd
  return { fallback: op + ': ' + cmd + ' 失败', human: row.human + '：' + cmd + ' 没有跑成。请稍后重试。' }
}

/** 从建票回包里取新票编号（票 #23）：gt 走 --json 回读的 number 格；tea 仍是抠 #编号 文本。 */
export function createdKeyFrom(stdoutText: string): string | null {
  return selectedCli() === 'gt' ? createdIssueNumberOf(stdoutText) : parseCreatedIssueKey(stdoutText)
}

/**
 * 读回包的行数组解析（票 #22）：tea 分支与 parseJsonRows 完全一致；gt 分支先剥掉 list 命令
 * 尾部提示行后走行适配（adaptGtRow 对 tea 形状的行是恒等，共用同一入口不改变 tea 行为）
 * 追加在尾部的 `more results available` 提示行（gt-run.ts 有实测记录），再把 author/assignees
 * 的登录名字符串适配成归一层认的 `{login}` 形状。形状不对（含剥完仍不是合法 JSON）都回 null，
 * 由调用方按「回包形状不对」挑档位——与 parseJsonRows 同一口径。
 */
export function parseReadRows(text: string): unknown[] | null {
  const rows = selectedCli() === 'gt' ? parseJsonRows(stripGtHint(text)) : parseJsonRows(text)
  if (!rows) return null
  return rows.map(adaptGtRow)
}

/**
 * 读回包的单对象解析（票 #22）：tea 分支与 parseJsonBag 完全一致；gt 分支同样先剥提示行
 * （单票 view 不带提示行，剥了也无害）再做 author/assignees 适配。
 */
export function parseReadBag(text: string): RawBag | null {
  const bag = selectedCli() === 'gt' ? parseJsonBag(stripGtHint(text)) : parseJsonBag(text)
  if (!bag) return null
  return adaptGtRow(bag) as RawBag
}

/**
 * 读路径失败文案里的命令名（票 #22 评审收编）：按选中执行器给真实命令原文——gt 是
 * `gt issue list` / `gt issue view`，tea 是 `tea issues ls` / `tea issues`。文案写错执行器
 * 会让拿报错排障的人得出错误结论（Human-first wording），所以 tea 分支的字面量保持与改动前一致。
 */
export function readListCommandLabel(): string {
  return selectedCli() === 'gt' ? 'gt issue list' : 'tea issues ls'
}

/** 单票读失败文案里的命令名：同 readListCommandLabel 的口径。 */
export function readIssueCommandLabel(): string {
  return selectedCli() === 'gt' ? 'gt issue view' : 'tea issues'
}

/** 列表页的参数（本房词汇表的唯一出处）：state 收窄由调用方给好（open / closed / all）。 */
export function argsIssueListPage(refId: string, state: 'open' | 'closed' | 'all', labels: string[], limitRows: number, page: number): string[] {
  // gt 分支（票 #22，拼法按票 #20 真机核对与 2026-11-15 本机 gt 1.2.0 实测）：`gt issue list`
  // 的 -L 范围 1..1000（调用方的每页上限 ≤200，不会越界）、--page 1 起始、默认只回 open
  // 所以 state 必须显式带（与 tea 同一条防线）；标签过滤用可重复的 --label，一标签一项，
  // 语义正好是 AND。gt 的 --json 默认字段表已含 url / body / number / comments 等全部字段，
  // 不需要 tea 那一步 --fields 点名。
  if (selectedCli() === 'gt') {
    const args = ['issue', 'list', '-R', refId, '--state', state, '--json', '--limit', String(limitRows), '--page', String(page)] // --limit 与票 20 记录的 -L 是同义别名（真机 --help 核实）
    for (const label of labels) args.push('--label', label)
    return args
  }
  const args = ['issues', 'ls', '--repo', refId, '--state', state, '--output', 'json', '--limit', String(limitRows), '--page', String(page)] // --limit 与票 20 记录的 -L 是同义别名（真机 --help 核实）
  // tea ls 的默认字段表里没有 url（真机实测 tea 0.16：默认回 index/title/state/author/milestone/labels/owner/repo），
  // 行地址就一直是空串，面板上「复制链接」「在跟踪器打开」两个按钮全废。显式点名字段表＝默认表 + url，
  // 不多要 body 等大字段（列表行的正文口径不变，正文只在单票 get 里取）。
  args.push('--fields', 'index,title,state,author,milestone,labels,owner,repo,url')
  if (labels.length) args.push('--labels', labels.join(','))
  return args
}

/** 单票的参数。 */
export function argsIssueGet(refId: string, key: string | number): string[] {
  // gt 分支（票 #22）：gt issue view <编号>，--json 回单键对象（票号叫 number，归一层回退认）。
  if (selectedCli() === 'gt') return ['issue', 'view', String(key), '-R', refId, '--json']
  return ['issues', String(key), '--repo', refId, '--output', 'json']
}

/** 评论一页的参数。 */
export function argsCommentsPage(refId: string, key: string | number, limitRows: number, page: number): string[] {
  // gt 分支（票 #22）：gt issue comment list <编号>，-L/--page 与 tea 的 limit/page 语义对应
  // （真机实测 2026-11-15：-L 1..1000、--page 1 起始）；回包里 author 是字符串、id 是数字。
  if (selectedCli() === 'gt') {
    return ['issue', 'comment', 'list', String(key), '-R', refId, '--json', '--limit', String(limitRows), '--page', String(page)] // --limit 与票 20 记录的 -L 是同义别名（真机 --help 核实）
  }
  return ['issues', String(key), 'comments', '--repo', refId, '--output', 'json', '--limit', String(limitRows), '--page', String(page)] // --limit 与票 20 记录的 -L 是同义别名（真机 --help 核实）
}

/** 标签一页的参数。 */
export function argsLabelsPage(refId: string, limitRows: number, page: number): string[] {
  // gt 分支（票 #23，2026-11-15 本机 gt 1.2.0 实测）：gt label list，-L 范围 1..1000、--page 1 起始，
  // 回包数组行含 name/color/id/description（写路径的 ensureLabels 与改色对照表共用这一口）。
  if (selectedCli() === 'gt') {
    return ['label', 'list', '-R', refId, '--json', '--limit', String(limitRows), '--page', String(page)] // --limit 与票 20 记录的 -L 是同义别名（真机 --help 核实）
  }
  return ['labels', 'ls', '--repo', refId, '--output', 'json', '--limit', String(limitRows), '--page', String(page)] // --limit 与票 20 记录的 -L 是同义别名（真机 --help 核实）
}

// ── 管理与杂项的参数（票 #14）：同样只在这一处拼 ──────────────────────────

/**
 * 改一条标签颜色的参数：tea labels update 认标签的数字 id（不认名字），颜色给归一后的
 * 六位十六进制（不带井号）。调用方先用 argsLabelsPage 建好「名字→id」对照再发这条。
 */
/**
 * 建一条标签的参数：setLabels / create 遇到仓库里还没有的标签时先建再挂——tea 的
 * --add-labels 与建票的 --labels 对不存在的标签是静默跳过且回退出码 0（2026-11-11 真机实测），
 * 不先建就会「报成功、实际没写上」。颜色给一个中性缺省；要改颜色走 setLabelColors 那条路。
 */
export function argsLabelCreate(refId: string, name: string): string[] {
  // gt 分支（票 #23，2026-11-15 本机 --help 核对）：名字是位置参数，颜色 --color/-c。
  if (selectedCli() === 'gt') return ['label', 'create', name, '--color', '00aabb', '-R', refId, '--json']
  return ['labels', 'create', '--name', name, '--color', '00aabb', '--repo', refId, '--output', 'json']
}

export function argsLabelUpdate(refId: string, id: number | string, color: string): string[] {
  // gt 分支（票 #23，2026-11-15 本机 --help 核对）：gt label edit <id> --color 色（认 id 不认名字）。
  if (selectedCli() === 'gt') return ['label', 'edit', String(id), '--color', color, '-R', refId, '--json']
  return ['labels', 'update', '--id', String(id), '--color', color, '--repo', refId, '--output', 'json']
}

/** 登录清单的参数：回包数组里 default 标了默认登录，user 字段就是登录名（tea 实测 0.16.0）。 */
export function argsLoginList(): string[] {
  return ['logins', 'ls', '--output', 'json']
}

/** 权限扫仓一页的参数：只要 owner/name/permission 三个字段，按 refId 匹配找当前仓库。 */
export function argsRepoScanPage(limitRows: number, page: number): string[] {
  return ['repos', 'ls', '--output', 'json', '--fields', 'owner,name,permission', '--limit', String(limitRows), '--page', String(page)] // --limit 与票 20 记录的 -L 是同义别名（真机 --help 核实）
}

// ── 写路径的参数（票 #12）：同样只在这一处拼，操作文件只挑词汇 ──────────────────

/** 建票的参数。labels 与 assignees 是已归一的名字列表（空数组就不带这一项）。 */
export function argsIssueCreate(refId: string, title: string, description: string, labels: string[], assignees: string[]): string[] {
  // gt 分支（票 #23，2026-11-15 本机 gt 1.2.0 --help 核对）：--title/-t、--body/-b、可重复的
  // --label/-l 与 --assignee/-a；带 --json 回单个对象（含 number），建票编号从回包读。
  if (selectedCli() === 'gt') {
    const args = ['issue', 'create', '-R', refId, '--title', title]
    if (description) args.push('--body', description)
    for (const label of labels) args.push('--label', label)
    for (const login of assignees) args.push('--assignee', login)
    args.push('--json')
    return args
  }
  const args = ['issues', 'create', '--repo', refId, '--title', title]
  if (description) args.push('--description', description)
  if (labels.length) args.push('--labels', labels.join(','))
  if (assignees.length) args.push('--assignees', assignees.join(','))
  return args
}

/** 关票的参数（tea 的 close 认 --output json，回包就是关完之后的票面）。 */
export function argsIssueClose(refId: string, key: string | number): string[] {
  // gt 分支（票 #23，真机核对）：gt issue close <编号> -R <ref> --json → {"number":…,"state":"closed"}。
  if (selectedCli() === 'gt') return ['issue', 'close', String(key), '-R', refId, '--json']
  return ['issues', 'close', String(key), '--repo', refId, '--output', 'json']
}

/** 重开的参数（tea 0.16.0 的命令面里 reopen 是独立子命令，不是 edit 的一个开关）。 */
export function argsIssueReopen(refId: string, key: string | number): string[] {
  // gt 分支（票 #23，真机核对）：独立子命令，与 close 同形。
  if (selectedCli() === 'gt') return ['issue', 'reopen', String(key), '-R', refId, '--json']
  return ['issues', 'reopen', String(key), '--repo', refId, '--output', 'json']
}

/** 改票的编辑项：只把给了的字段拼进命令，没给的不出现（空操作由调用方先判掉，不发命令）。 */
export interface IssueEditFields {
  title?: string
  description?: string
  addLabels?: string[]
  removeLabels?: string[]
  /** 整集替换认领人（tea 的 --set-assignees）；空串表示清空。 */
  setAssignees?: string
  /**
   * 整集替换标签（票 #23）：只有 gt 分支认这一格——gt issue edit 有 --set-labels 整集替换
   * （空值清空，票 #20 真机结论），gt 侧 setLabels 直接用它、不再算差集。tea 分支见到这一格
   * 忽略（tea 没有 --labels 整集替换，差集增删在调用方 assign.ts 里做）。给空数组表示清空。
   */
  setLabels?: string[]
  /**
   * 里程碑按名字给；空串表示清空。契约层口径两边统一：tea 分支照值直传 --milestone ""；
   * gt 分支由词汇表把空串转译成 --remove-milestone（2026-11-16 真机实测票 #27：
   * gt 1.2.0 直传 --milestone '' 退出码 2，--remove-milestone 清空后回读 milestone 为 null）。
   */
  milestone?: string
}

/** 改票的参数：按编辑项拼一条 tea issues edit。 */
export function argsIssueEdit(refId: string, key: string | number, fields: IssueEditFields): string[] {
  // gt 分支（票 #23，2026-11-15 本机 --help 核对）：--title/-t、--body/-b；标签增删用可重复的
  // --add-label/--remove-label（一标签一项），整集替换用 --set-labels（逗号连接，空串清空）；
  // 认领人整集替换 --set-assignees（与 tea 同名同义）。里程碑清空走 --remove-milestone
  // （票 #27，2026-11-16 真机实测：gt 1.2.0 直传 --milestone '' 退出码 2，--remove-milestone
  // 清空后回读 milestone 为 null，与 tea 的 --milestone "" 清空语义完全对齐），非空串仍按名字照值直传。
  if (selectedCli() === 'gt') {
    const args = ['issue', 'edit', String(key), '-R', refId]
    if (typeof fields.title === 'string') args.push('--title', fields.title)
    if (typeof fields.description === 'string') args.push('--body', fields.description)
    if (fields.addLabels && fields.addLabels.length) {
      for (const label of fields.addLabels) args.push('--add-label', label)
    }
    if (fields.removeLabels && fields.removeLabels.length) {
      for (const label of fields.removeLabels) args.push('--remove-label', label)
    }
    if (Array.isArray(fields.setLabels)) args.push('--set-labels', fields.setLabels.join(','))
    if (typeof fields.setAssignees === 'string') args.push('--set-assignees', fields.setAssignees)
    if (typeof fields.milestone === 'string') {
      if (fields.milestone === '') args.push('--remove-milestone')
      else args.push('--milestone', fields.milestone)
    }
    args.push('--json')
    return args
  }
  const args = ['issues', 'edit', String(key), '--repo', refId]
  if (typeof fields.title === 'string') args.push('--title', fields.title)
  if (typeof fields.description === 'string') args.push('--description', fields.description)
  if (fields.addLabels && fields.addLabels.length) args.push('--add-labels', fields.addLabels.join(','))
  if (fields.removeLabels && fields.removeLabels.length) args.push('--remove-labels', fields.removeLabels.join(','))
  if (typeof fields.setAssignees === 'string') args.push('--set-assignees', fields.setAssignees)
  if (typeof fields.milestone === 'string') args.push('--milestone', fields.milestone)
  args.push('--output', 'json')
  return args
}

/** 写一条评论的参数（tea 的评论写入挂在 comments 命名空间下，不是 issues <编号> comments）。 */
export function argsCommentAdd(refId: string, key: string | number, body: string): string[] {
  // gt 分支（票 #23，真机核对）：gt issue comment <编号> --body 正文 --json → {"body":…,"id":…}。
  if (selectedCli() === 'gt') return ['issue', 'comment', String(key), '-R', refId, '--body', body, '--json']
  return ['comments', 'add', String(key), '--repo', refId, '--description', body, '--output', 'json']
}

/**
 * 从建票的文本回包里抠出新票编号：tea issues create 不认 --output，回包是含井号编号的一行
 * 说明文字（真机 0.16.0 实测）。抠不出来回 null——调用方拿不到编号时如实失败，
 * 不许拿「可能已建出去」的票猜一个编号。
 */
export function parseCreatedIssueKey(stdout: string): string | null {
  const m = /#(\d+)/.exec(typeof stdout === 'string' ? stdout : '')
  return m ? m[1] : null
}
