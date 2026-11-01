/**
 * src/shared/version-control/src/parse-stash.ts —— 贮藏列表的解析器（#1739 T04）
 *
 * 为什么本票新建：首屏七片里的「贮藏」以前没有只读读数，规格 #1586 第 9 节要求首屏一次拿全，
 * 而变动页 7.4（T16 的票）也要用贮藏列表，所以这一条读法与解析放在共享层，两处共用一份。
 *
 * 纪律（测试决策里「解析器读不全返回显式截断失败」）：宁可显式失败，也不返回半份列表。
 * 行格式由 commands.ts 的 stashListArgs() 决定：每条一行，四个字段用 NUL 分隔 ——
 *   %gd 选择器（stash@{n}）  %H 完整 oid  %ct 提交时间（秒）  %gs reflog 主题
 * 任何一条不满足（字段数不对、选择器形状不对、oid 不是 16 进制、时间不是数字）就整份失败，
 * 让宿主把「贮藏」这一片标成失败态；绝不猜、绝不跳过坏行当它不存在（那会把「读坏了」
 * 画成「没有贮藏」，正好是规格最怕的假装完整）。
 *
 * 本文件不 import 任何文件（共享层禁层内互引，same-layer-import-shared 只许减不许增）。
 */

/** 一条贮藏：选择器、完整 oid、时间（毫秒，和界面其他时间同一个口径）、reflog 主题原文。 */
export interface StashRecord {
  selector: string
  oid: string
  atMs: number
  subject: string
}

/** 解析结果：要么整份条目，要么显式失败（error 是稳定标识符，detail 给人看）。 */
export interface StashParseResult {
  ok: boolean
  entries?: StashRecord[]
  error?: string
  detail?: string
}

const SELECTOR_RE = /^stash@\{[0-9]+\}$/
const OID_RE = /^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/

function fail(detail: string): StashParseResult {
  return { ok: false, error: 'stash-malformed', detail: detail }
}

/**
 * 解析 `git stash list` 的 stdout（行 + NUL 字段交错）。
 * 空输出是合法的（真没有贮藏），回空数组；末尾多余空行忽略；其余任何形状问题整份失败。
 */
export function parseStashList(stdout: string): StashParseResult {
  if (typeof stdout !== 'string') return fail('stdout 不是字符串')
  const text = stdout.replace(/\r\n/g, '\n')
  const entries: StashRecord[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === '') continue
    const fields = line.split('\u0000')
    if (fields.length !== 4) {
      return fail('第 ' + String(i + 1) + ' 行字段数是 ' + String(fields.length) + '，应为 4（选择器/oid/时间/主题）')
    }
    const selector = fields[0]
    const oid = fields[1]
    const ct = fields[2]
    const subject = fields[3]
    if (!SELECTOR_RE.test(selector)) return fail('第 ' + String(i + 1) + ' 行的选择器不是 stash@{n}：' + selector)
    if (!OID_RE.test(oid)) return fail('第 ' + String(i + 1) + ' 行的 oid 不是 40 或 64 位十六进制：' + oid)
    if (!/^[0-9]+$/.test(ct)) return fail('第 ' + String(i + 1) + ' 行的时间不是秒数：' + ct)
    const seconds = Number(ct)
    if (!isFinite(seconds)) return fail('第 ' + String(i + 1) + ' 行的时间不是有限数：' + ct)
    entries.push({ selector: selector, oid: oid, atMs: seconds * 1000, subject: subject })
  }
  return { ok: true, entries: entries }
}

/** 门禁按这一行找真源。 */
export const PARSE_STASH_SOURCE = 'src/shared/version-control/src/parse-stash.ts'
