/**
 * version-control-core/src/parse-diff-files.ts —— diff --numstat -z 解析（每文件行数）
 *
 * 形状两种（2026-10-04 用 git 2.49.0.windows.1 真机核对，原始字节见
 * fixtures/live-numstat-shapes.json）：
 *   普通（含二进制与类型变化）：计数与路径在同一个 NUL 字段里 —— `增<TAB>删<TAB>路径`；
 *   重命名与复制：计数头独占一个字段（`增<TAB>删<TAB>`，末尾 TAB 后直接是 NUL），
 *   随后两个字段依次是原路径、新路径（-z 下顺序与不带 -z 相反：原在前、新在后）。
 * `-` 是二进制（行数记 null）。变化类型不在这里（类型来自 status，行数在这里，
 * 两表按新路径在 state.ts 会合）。
 *
 * 修正来历（#817，2026-10-04）：#816 交付时只认了「计数头独占字段」一种形状，而真机普通文件是
 * 「计数与路径同一个字段」，于是只要仓库里有已跟踪改动，整屏就解析失败。当时的手写样本
 * （fixtures/dirty-rename-chinese.json，live:false）恰好只写了重命名那一种形状，门禁因此一直是绿的；
 * 真机样本补进来之后这条口径才被守住。
 * 路径里含制表符的极端情形：普通形状的分割点在头两个 TAB，后面的 TAB 原样属于路径，不再误判。
 */
import type { ParseFailure } from './ports.js'

export interface DiffFileRecord {
  path: string
  origPath: string | null
  added: number | null
  deleted: number | null
}

export type DiffFilesResult = { ok: true; files: DiffFileRecord[] } | ParseFailure

function fail(detail: string): ParseFailure {
  return { ok: false, error: 'diff-files-malformed', detail }
}

function parseCount(v: string): number | null | undefined {
  if (v === '-') return null
  if (!/^\d+$/.test(v)) return undefined
  return Number(v)
}

/** 计数头独占字段（重命名与复制）：形态是「两个计数 + 末尾 TAB（可以没有）+ 到此为止」。 */
const COUNTS_ONLY_RE = /^(\S+)\t(\S+)\t?$/
/** 计数与路径同一个字段（普通文件）：头两个 TAB 之后的全部内容都是路径，路径里允许再有 TAB。 */
const INLINE_RE = /^(\S+)\t(\S+)\t(.*)$/

export function parseDiffFiles(stdout: string): DiffFilesResult {
  const text = String(stdout)
  if (text === '') return { ok: true, files: [] }
  const fields = text.split('\0')
  if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()
  const out: DiffFileRecord[] = []
  let i = 0
  while (i < fields.length) {
    const head = fields[i]
    i += 1
    // 先认「计数头独占」这一形：它带 $ 锚，普通条目的字段因为后面还跟着路径而不会命中。
    const countsOnly = COUNTS_ONLY_RE.exec(head)
    if (countsOnly) {
      const added = parseCount(countsOnly[1])
      const deleted = parseCount(countsOnly[2])
      if (added === undefined || deleted === undefined) return fail('计数非数字')
      if (i >= fields.length) return fail('重命名缺原路径字段')
      const orig = fields[i]
      i += 1
      if (orig === '') return fail('原路径为空')
      if (i >= fields.length) return fail('重命名缺新路径字段')
      const path = fields[i]
      i += 1
      if (path === '') return fail('新路径为空')
      out.push({ path, origPath: orig, added, deleted })
      continue
    }
    const inline = INLINE_RE.exec(head)
    if (!inline) return fail('计数头不是 两数+TAB')
    const added = parseCount(inline[1])
    const deleted = parseCount(inline[2])
    if (added === undefined || deleted === undefined) return fail('计数非数字')
    if (inline[3] === '') return fail('路径为空')
    out.push({ path: inline[3], origPath: null, added, deleted })
  }
  return { ok: true, files: out }
}

export const PARSE_DIFF_FILES_SOURCE = 'version-control-core/src/parse-diff-files.ts'
