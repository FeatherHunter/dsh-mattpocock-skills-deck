// scripts/lib/release-checklist.mts —— 版本真机验证清单票的读写小工具，发布前检查与发布后收尾共用。
//
// 为什么单独放一个文件：清单票靠标题「[真机验证] <版本号>」识别，前缀、占位票写法、模板位置这三件事
// 一旦两边各写一份，早晚对不上——一边按「下一版」找、一边按「下个版本」找，发布检查就会误报缺票。
// 规则正文在 docs/agents/real-machine-verification.md，这里只认标题与 gh 的调用方式。
//
// 本文件只做两件事：读（列清单票、读版本号、取正文模板）与拼标题。所有 gh 调用都走子进程，不改任何东西。
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 清单票标题前缀。改这里等于改全仓的识别方式，先改规则文档。 */
export const TITLE_PREFIX = '[真机验证]'
/** 版本号还没定时占位票用的词：标题写成「[真机验证] 下一版（自 v1.9.0-beta.29 之后）」。 */
export const PLACEHOLDER_WORD = '下一版'

const ISSUE_LIST_LIMIT = '400'
const TEMPLATE_REL = path.join('docs', 'agents', 'checklist-issue-template.md')
const TEMPLATE_START = '<!-- checklist-template:start -->'
const TEMPLATE_END = '<!-- checklist-template:end -->'

/** 本文件在 <仓根>/scripts/lib 下，往上两级就是仓根。 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export type ChecklistIssue = {
  number: number
  title: string
  state: string
  url: string
  body: string
}

/** gh 缺失、未登录、网络失败这类环境问题：调用方按「环境错误」处理（发布路径上应停下并说明原因）。 */
export class ReleaseEnvError extends Error {
  exitCode: number
  constructor(message: string, exitCode: number) {
    super(message)
    this.exitCode = exitCode
  }
}

/** 把标题里的连续空白压成一个空格，人工核对与机器比较用同一口径。 */
export function normalizeTitle(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

/** 版本号比较时去掉开头的 v：票面写 v1.9.0-beta.31 与 package.json 的 1.9.0-beta.31 是同一版。 */
export function normalizeVersion(version: string): string {
  return String(version || '').trim().replace(/^[vV]/, '')
}

export function isChecklistTitle(title: string): boolean {
  return normalizeTitle(title).startsWith(TITLE_PREFIX)
}

/** 从「[真机验证] 1.9.0-beta.31」里取出 1.9.0-beta.31；不是清单票时返回空串。 */
export function checklistVersionOf(title: string): string {
  const matched = /^\[真机验证\]\s*(\S+)/.exec(normalizeTitle(title))
  return matched ? normalizeVersion(matched[1]) : ''
}

export function isExactChecklistTitle(title: string, version: string): boolean {
  return isChecklistTitle(title) && checklistVersionOf(title) === normalizeVersion(version)
}

/** 占位票：「[真机验证] 下一版（自 <上一发布版本> 之后）」。 */
export function isPlaceholderTitle(title: string): boolean {
  return new RegExp('^\\[真机验证\\]\\s*' + PLACEHOLDER_WORD).test(normalizeTitle(title))
}

/** 跑一次 gh 并回读 stdout；失败时抛 ReleaseEnvError，让调用方用一句话说清是环境问题还是票面问题。 */
export function ghText(args: string[]): string {
  const result = spawnSync('gh', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.error) {
    throw new ReleaseEnvError('起不来 gh 命令（' + result.error.message + '）。发布检查需要 GitHub CLI，先确认 gh 已安装并在 PATH 上。', 2)
  }
  if (result.status !== 0) {
    const tail = String(result.stderr || result.stdout || '').trim()
    throw new ReleaseEnvError('gh ' + args.join(' ') + ' 失败（exit ' + result.status + '）：' + tail, 2)
  }
  return String(result.stdout || '')
}

/** 列出仓里所有带「[真机验证]」标题前缀的票（含已关闭）。gh 的搜索不区分中英文，这里再按标题本地过滤。 */
export function listChecklistIssues(): ChecklistIssue[] {
  const raw = ghText([
    'issue',
    'list',
    '--state',
    'all',
    '--limit',
    ISSUE_LIST_LIMIT,
    '--search',
    'in:title ' + TITLE_PREFIX,
    '--json',
    'number,title,state,url,body',
  ])
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new ReleaseEnvError('gh 返回的清单票列表不是合法 JSON：' + String(error), 2)
  }
  if (!Array.isArray(parsed)) {
    throw new ReleaseEnvError('gh 返回的清单票列表不是数组，无法判断清单票状态。', 2)
  }
  const issues: ChecklistIssue[] = []
  for (const item of parsed) {
    const row = item as Record<string, unknown>
    const title = String(row.title || '')
    if (!isChecklistTitle(title)) continue
    issues.push({
      number: Number(row.number),
      title,
      state: String(row.state || ''),
      url: String(row.url || ''),
      body: String(row.body || ''),
    })
  }
  return issues
}

/** 读仓根 package.json 的 version。发布脚本都从这里取本版版本号，不重复传参。 */
export function readPackageVersion(): string {
  const pkgPath = path.join(REPO_ROOT, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new ReleaseEnvError('找不到 ' + pkgPath + '，无法确定本版版本号。', 2)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (error) {
    throw new ReleaseEnvError('读不懂 ' + pkgPath + '：' + String(error), 2)
  }
  const version = normalizeVersion(String((parsed as Record<string, unknown>).version || ''))
  if (!version) {
    throw new ReleaseEnvError(pkgPath + ' 里没有 version 字段，无法确定本版版本号。', 2)
  }
  return version
}

/** 取 docs/agents/checklist-issue-template.md 里两枚标记之间的正文模板；标记被删时明确报错，不要静默用空正文。 */
export function extractChecklistTemplateBody(): string {
  const templatePath = path.join(REPO_ROOT, TEMPLATE_REL)
  if (!existsSync(templatePath)) {
    throw new ReleaseEnvError('找不到清单票正文模板 ' + templatePath + '。', 2)
  }
  const text = readFileSync(templatePath, 'utf8')
  const start = text.indexOf(TEMPLATE_START)
  const end = text.indexOf(TEMPLATE_END)
  if (start < 0 || end < 0 || end <= start) {
    throw new ReleaseEnvError('模板 ' + templatePath + ' 里找不到 ' + TEMPLATE_START + ' / ' + TEMPLATE_END + ' 两枚标记。', 2)
  }
  return text.slice(start + TEMPLATE_START.length, end).trim()
}

/** 把模板里的尖括号占位换成实际值。只换这三处，别处不动。 */
export function fillChecklistTemplate(body: string, versionLabel: string, previousVersion: string): string {
  return body
    .replaceAll('<版本号>', versionLabel)
    .replaceAll('<上一发布版本>', 'v' + normalizeVersion(previousVersion))
}

/** 本地时间写成带时区的 ISO 8601，票面时间与日志时间都是人读的，不写成 UTC。 */
export function localIso(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const offsetMinutes = -now.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return (
    now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    'T' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()) +
    sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60)
  )
}
