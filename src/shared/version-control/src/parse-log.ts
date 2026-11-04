/**
 * src/shared/version-control/src/parse-log.ts —— log --format NUL 分隔解析
 *
 * 每提交八字段背靠背（H/h/an/ae/aI/cI/s/P），NUL 切分后按下标取——绝不按行切
 * （正文不用 %b，但标题 %s 本身也可能含特殊字符；NUL 切分不受影响）。
 * %D 装饰不用（--no-decorate）；哈希 40/64 位；日期严格 ISO（%aI/%cI，不吃 log.date 配置）。
 */
import type { ParseFailure } from './ports.js'

export interface LogRecord {
  oid: string
  short: string
  author: string
  email: string
  authorDateMs: number
  commitDateMs: number
  subject: string
  parents: string[]
}

export type LogResult = { ok: true; commits: LogRecord[] } | ParseFailure

function fail(detail: string): ParseFailure {
  return { ok: false, error: 'log-malformed', detail }
}

export function parseLog(stdout: string): LogResult {
  const text = String(stdout)
  if (text === '') return { ok: true, commits: [] }
  const fields = text.split('\0')
  if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()
  // -z 在格式串末尾的 %x00 之外再加一个记录分隔 NUL（实测：每提交 9 槽，第 9 槽为空）。
  // 两种形状都认（9 槽带分隔 / 8 槽无分隔），其余一律失败。
  let stride = 8
  if (fields.length % 9 === 0 && fields.every((f, idx) => idx % 9 !== 8 || f === '')) {
    stride = 9
  } else if (fields.length % 8 !== 0) {
    return fail('字段总数不是 8 或 9 的倍数')
  }
  const out: LogRecord[] = []
  for (let i = 0; i < fields.length; i += stride) {
    const [oid, short, author, email, aI, cI, subject, parentsRaw] = fields.slice(i, i + 8)
    if (!/^[0-9a-f]{40}$/.test(oid) && !/^[0-9a-f]{64}$/.test(oid)) return fail('H 非哈希')
    if (!short) return fail('h 为空')
    const aMs = Date.parse(aI)
    const cMs = Date.parse(cI)
    if (Number.isNaN(aMs) || Number.isNaN(cMs)) return fail('日期非 ISO')
    const parents = parentsRaw === '' ? [] : parentsRaw.split(' ')
    for (const p of parents) {
      if (!/^[0-9a-f]{40}$/.test(p) && !/^[0-9a-f]{64}$/.test(p)) return fail('父提交非哈希')
    }
    out.push({ oid, short, author, email, authorDateMs: aMs, commitDateMs: cMs, subject, parents })
  }
  return { ok: true, commits: out }
}

/** 一个提交改了几个文件；列表行上的「N 个文件」用的就是它。 */
export interface LogStatRecord {
  oid: string
  files: number
}

export type LogStatsResult = { ok: true; stats: LogStatRecord[] } | ParseFailure

/**
 * 解析 `git log --format=%H --shortstat`：每条提交先是一行完整哈希，随后（有改动时）一行
 * 「 N file changed, …」或「 N files changed, …」。
 *
 * 两个必须照实说的边界：
 *   · 合并提交默认不打 shortstat（git 不展开合并差异），这类提交在结果里没有记录，界面就不显示文件数；
 *   · 空提交（--allow-empty）同样没有这一行，按「没有文件数」处理，不补 0——0 与「不知道」不是一回事。
 */
export function parseLogStats(stdout: string): LogStatsResult {
  const lines = String(stdout).split('\n')
  const out: LogStatRecord[] = []
  let current = ''
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (line === '') continue
    if (/^[0-9a-f]{40}$/.test(line) || /^[0-9a-f]{64}$/.test(line)) {
      current = line
      continue
    }
    const m = /^(\d+) files? changed/.exec(line)
    if (!m) return fail('shortstat 行不是「N files changed」的形状')
    if (current === '') return fail('shortstat 之前没有提交号')
    out.push({ oid: current, files: Number(m[1]) })
    current = ''
  }
  return { ok: true, stats: out }
}

export const PARSE_LOG_SOURCE = 'src/shared/version-control/src/parse-log.ts'
