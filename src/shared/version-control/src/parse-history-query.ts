/**
 * src/shared/version-control/src/parse-history-query.ts —— 历史高级查询的回包解析（纯函数）
 *
 * 与 history-query-commands.ts 成对：那边拼的是这边解析的那一套。十条查询里五条要自己的解析器
 * （3.5 blame 的 porcelain、3.9 range-diff、3.10 describe、3.11 reflog、3.13 show-file），
 * 3.4/3.6/3.7 直接复用 parse-log.ts，3.8 直接复用 parse-diff-files.ts，3.12（notes show）只有一段原样文本。
 *
 * 口径（规格第 9 节）：解析器是纯函数、读不全显式失败、绝不猜。任何一处形状不对都返回
 * { ok:false, error:'<kind>-malformed', detail }，宿主把它转成失败信封 —— 不给半份数据。
 * 每一种都拿本机真 git（2.49.0.windows.1）的输出采过样，样本在
 * tests/fixtures/version-control/live-history-query-shapes.json。
 *
 * 为什么这些解析器不共用一个大文件：每条命令的输出形状完全不同（blame 是块、reflog 是行、
 * range-diff 是有对齐列的表格），硬凑在一起只会让每条都难读；这一份按「历史查询」这一个能力域收口，
 * 行数仍在粒度上限之内。
 */
import type { ParseFailure } from './ports.js'

/** 3.5 行级追溯的一行。 */
export interface BlameLine {
  oid: string
  author: string
  authorTimeMs: number | null
  summary: string
  filename: string
  /** 这一行在目标文件里的行号（最终行号）。 */
  line: number
  /** 这一行在它最初被引入的那一版里的行号（git 的原行号）。 */
  origLine: number
  text: string
  boundary: boolean
  previous: string | null
}

export type BlameResult = { ok: true; lines: BlameLine[] } | ParseFailure

function fail(kind: string, detail: string): ParseFailure {
  return { ok: false, error: kind + '-malformed', detail: detail }
}

const OID_RE = /^[0-9a-f]{40}$/
const OID64_RE = /^[0-9a-f]{64}$/
function isOid(v: string): boolean { return OID_RE.test(v) || OID64_RE.test(v) }

/** blame 的组头：<提交号> <原行号> <最终行号> [<同组行数>]。 */
const BLAME_HEAD_RE = /^([0-9a-f]{40}|[0-9a-f]{64}) ([0-9]+) ([0-9]+)(?: ([0-9]+))?$/

/** --line-porcelain：每一行被追溯的行都带一整组头，最后一行以 TAB 开头是这一行的原文。
 *  头的字段名与 git 文档一致（author / author-time / summary / filename / previous / boundary 等）；
 *  其余头字段（author-mail、committer-* 等）按原样忽略 —— 不认识的额外头不许让整次解析失败，
 *  因为 git 新版本可能加字段；但「既不是头、又不是原文」的行是明确的坏形状，必须失败。 */
export function parseBlame(stdout: string): BlameResult {
  const text: string = String(stdout)
  if (text === '') return { ok: true, lines: [] }
  const raw: string[] = text.replace(/\r\n/g, '\n').split('\n')
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  const out: BlameLine[] = []
  let cur: any = null
  for (let i = 0; i < raw.length; i++) {
    const line: string = raw[i]
    if (line.length > 0 && line.charAt(0) === '\t') {
      if (!cur) return fail('blame', '第 ' + String(i + 1) + ' 行是内容行，但前面没有这段的行头')
      cur.text = line.slice(1)
      out.push(cur as BlameLine)
      cur = null
      continue
    }
    const head = BLAME_HEAD_RE.exec(line)
    if (head) {
      if (cur) return fail('blame', '第 ' + String(i + 1) + ' 行开了新的一行，但上一行没有原文行')
      cur = { oid: head[1], author: '', authorTimeMs: null, summary: '', filename: '', line: Number(head[3]), origLine: Number(head[2]), text: '', boundary: false, previous: null }
      continue
    }
    if (!cur) return fail('blame', '第 ' + String(i + 1) + ' 行不是行头也不是原文行')
    // boundary 是 --line-porcelain 里唯一没有值的头：git 用单独一行表示「这一行是最早的边界」。
    // 2026-10-31 真机采样确认（2.49.0.windows.1）它确实不带值；把它当带值头会误判坏形状。
    if (line === 'boundary') { cur.boundary = true; continue }
    const sp: number = line.indexOf(' ')
    if (sp < 0) return fail('blame', '第 ' + String(i + 1) + ' 行的头字段没有值：' + line.slice(0, 40))
    const key: string = line.slice(0, sp)
    const val: string = line.slice(sp + 1)
    if (key === 'author') cur.author = val
    else if (key === 'summary') cur.summary = val
    else if (key === 'filename') cur.filename = val
    else if (key === 'boundary') cur.boundary = true
    else if (key === 'previous') { const pv: string = String(val).split(' ')[0]; if (!isOid(pv)) return fail('blame', 'previous 不是提交号'); cur.previous = pv }
    else if (key === 'author-time') { const ms: number = Number(val) * 1000; if (!isFinite(ms)) return fail('blame', 'author-time 不是数字'); cur.authorTimeMs = ms }
    else if (key === 'author-tz' || key === 'committer' || key === 'committer-mail' || key === 'committer-time' || key === 'committer-tz' || key === 'author-mail') { /* 界面上用不到的字段，原样略过 */ }
  }
  if (cur) return fail('blame', '最后一行没有原文行')
  return { ok: true, lines: out }
}

/** 3.9 两组提交对照的一对（'<' 只在旧组、'>' 只在新组、'=' 两边同形、'!' 两边不同）。 */
export interface RangeDiffPair {
  leftNo: number | null
  leftOid: string | null
  mark: string
  rightNo: number | null
  rightOid: string | null
  subject: string
}

export type RangeDiffResult = { ok: true; pairs: RangeDiffPair[]; extraLines: string[] } | ParseFailure

/** range-diff 的一行：第 1 对 < ... 或 缺的那一边是七个短横线（git 的占位）；标题可能为空。 */
const RANGE_DIFF_RE = /^([0-9]+|-):\s+([0-9a-f]{4,64}|-+)\s+([<>=!])\s+([0-9]+|-):\s+([0-9a-f]{4,64}|-+)\s?(.*)$/

export function parseRangeDiff(stdout: string): RangeDiffResult {
  const text: string = String(stdout)
  if (text === '') return { ok: true, pairs: [], extraLines: [] }
  const raw: string[] = text.replace(/\r\n/g, '\n').split('\n')
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  const pairs: RangeDiffPair[] = []
  const extra: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const line: string = raw[i]
    if (line === '') continue
    const m = RANGE_DIFF_RE.exec(line)
    if (!m) {
      // 续行（多行提交说明的第二行起）以空格开头；其余不认识的行按原样收进 extraLines，
      // 但不让整次解析失败 —— git 在大段对照里会画分隔用的空行与提示行，那些不是数据。
      if (line.charAt(0) === ' ') { extra.push(line); continue }
      return fail('range-diff', '第 ' + String(i + 1) + ' 行不是 range-diff 的对照行：' + line.slice(0, 60))
    }
    pairs.push({
      leftNo: m[1] === '-' ? null : Number(m[1]),
      leftOid: m[2].charAt(0) === '-' ? null : m[2],
      mark: m[3],
      rightNo: m[4] === '-' ? null : Number(m[4]),
      rightOid: m[5].charAt(0) === '-' ? null : m[5],
      subject: m[6] || '',
    })
  }
  return { ok: true, pairs: pairs, extraLines: extra }
}

/** 3.11 引用日志的一条（5 个字段，NUL 分隔）。 */
export interface ReflogEntry {
  oid: string
  short: string
  selector: string
  actor: string
  subject: string
}

export type ReflogResult = { ok: true; entries: ReflogEntry[] } | ParseFailure

/** reflog show --format= 的输出是「一条一行、行内 NUL 分 5 段」。2026-10-31 真机采样确认：
 *  --date=iso-strict 让第 3 段（%gd）变成 HEAD@{2026-10-31T23:48:42+08:00} 这种带时间的选择器。
 *  旧样本里曾多出第 6 段（当时格式串多写了 %gI），那种 6 段行是坏形状，必须显式失败：
 *  「字段数比格式串多」意味着我们解析的不是我们拼的那条命令。 */
export function parseReflog(stdout: string): ReflogResult {
  const text: string = String(stdout)
  if (text === '') return { ok: true, entries: [] }
  const raw: string[] = text.replace(/\r\n/g, '\n').split('\n')
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  const out: ReflogEntry[] = []
  for (let i = 0; i < raw.length; i++) {
    const line: string = raw[i]
    if (line === '') continue
    const f: string[] = line.split('\0')
    // 格式串以 %gs%x00 结尾，行尾换行又会补一段空串：真机输出是 6 段、末段为空。
    // 先把末尾空段去掉再要求恰好 5 段 —— 这样「5 段 + 尾空」通过，多出来的真实字段（6 段 + 尾空）仍然显式失败。
    const real: string[] = f.length > 0 && f[f.length - 1] === '' ? f.slice(0, f.length - 1) : f
    if (real.length !== 5) return fail('reflog', '第 ' + String(i + 1) + ' 行有 ' + String(real.length) + ' 个字段，格式串是 5 段')
    if (!isOid(real[0])) return fail('reflog', '第 ' + String(i + 1) + ' 行的提交号不是哈希')
    if (real[1] === '') return fail('reflog', '第 ' + String(i + 1) + ' 行的短提交号是空的')
    if (real[2] === '') return fail('reflog', '第 ' + String(i + 1) + ' 行的选择器是空的')
    if (real[4] === '') return fail('reflog', '第 ' + String(i + 1) + ' 行的动作说明是空的')
    out.push({ oid: real[0], short: real[1], selector: real[2], actor: real[3], subject: real[4] })
  }
  return { ok: true, entries: out }
}

/** 3.10 git describe 的输出：单行；成功后一定有内容（--always 兜底成短提交号）。 */
export interface DescribeShape {
  text: string
  dirty: boolean
}

export type DescribeResult = { ok: true; describe: DescribeShape } | ParseFailure

export function parseDescribe(stdout: string): DescribeResult {
  const text: string = String(stdout).replace(/\r\n/g, '\n').trim()
  if (text === '') return fail('describe', 'git describe 成功了却没有输出')
  if (text.indexOf('\n') >= 0) return fail('describe', 'git describe 输出了多行')
  return { ok: true, describe: { text: text, dirty: text.slice(-6) === '-dirty' } }
}

/** 3.13 取某版本的文件内容：原样文本；含 NUL 就当二进制（只在回包里标出来，不把 NUL 送到界面）。 */
export interface FileContentShape {
  text: string
  binary: boolean
}

export type FileContentResult = { ok: true; file: FileContentShape } | ParseFailure

export function parseFileContent(stdout: string): FileContentResult {
  const text: string = String(stdout)
  if (text.indexOf('\u0000') >= 0) return { ok: true, file: { text: '', binary: true } }
  return { ok: true, file: { text: text, binary: false } }
}

/** 3.12 git notes show 的输出：去掉行尾换行原样保留（备注是作者写给人看的文本，不改写内容）。 */
export function parseNotesText(stdout: string): string {
  return String(stdout).replace(/\r\n/g, '\n').replace(/\n+$/, '')
}

export const PARSE_HISTORY_QUERY_SOURCE = 'src/shared/version-control/src/parse-history-query.ts'