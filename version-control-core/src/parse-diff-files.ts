/**
 * version-control-core/src/parse-diff-files.ts —— diff --numstat -z 解析（每文件行数）
 *
 * 形状：`增<TAB>删<TAB>[NUL]路径[NUL][新路径[NUL]]`。重命名在 -z 下占两个路径字段，
 * 顺序反转（原在前、新在后，调研实测）；数字头尾随 TAB 先剥掉。`-` 是二进制（行数记 null）。
 * 变化类型不在这里（类型来自 status，行数在这里，两表按新路径在 state.ts 会合）。
 * 已知限制：文件名里含制表符的极端情形会被误判（路径含 TAB 长得像计数头），git 允许建这种文件，
 * 但实采与文档样本里从未出现；真撞上时解析显式失败或错配行数，不会静默覆盖状态里的变化类型。
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

const HEAD_RE = /^(\S+)\t(\S+)\t?$/

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
    const m = HEAD_RE.exec(head)
    if (!m) return fail('计数头不是 两数+TAB')
    const added = parseCount(m[1])
    const deleted = parseCount(m[2])
    if (added === undefined || deleted === undefined) return fail('计数非数字')
    if (i >= fields.length) return fail('缺路径字段')
    const p1 = fields[i]
    i += 1
    if (p1 === '') return fail('路径为空')
    let path = p1
    let orig: string | null = null
    if (i < fields.length && !HEAD_RE.test(fields[i])) {
      orig = p1
      path = fields[i]
      i += 1
      if (path === '') return fail('新路径为空')
    }
    out.push({ path, origPath: orig, added, deleted })
  }
  return { ok: true, files: out }
}

export const PARSE_DIFF_FILES_SOURCE = 'version-control-core/src/parse-diff-files.ts'
