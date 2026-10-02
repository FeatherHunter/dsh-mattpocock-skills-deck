/**
 * version-control-core/src/parse-worktrees.ts —— worktree list --porcelain 解析
 *
 * -z 与非 -z 双形：-z 下记录间以空 NUL 分隔、行以 NUL 结尾；非 -z 下记录间以空行分隔。
 * locked 可裸标签或带原因（原因可能含空格）；bare/detached 是裸标签；未知属性名忽略（向前兼容）。
 * 第一条属性恒为 worktree；prunable 同 locked。顺序宽容，主工作树官方保证排第一。
 */
import type { ParseFailure } from './ports.js'

export interface WorktreeRecord {
  path: string
  head: string | null
  branch: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  lockReason: string | null
  prunable: boolean
  prunableReason: string | null
}

export type WorktreesResult = { ok: true; worktrees: WorktreeRecord[] } | ParseFailure

function fail(detail: string): ParseFailure {
  return { ok: false, error: 'worktrees-malformed', detail }
}

function parseRecord(lines: string[]): WorktreeRecord | ParseFailure {
  if (lines.length === 0 || !lines[0].startsWith('worktree ')) return fail('记录首行不是 worktree')
  const rec: WorktreeRecord = {
    path: lines[0].slice('worktree '.length), head: null, branch: null,
    bare: false, detached: false, locked: false, lockReason: null, prunable: false, prunableReason: null,
  }
  if (!rec.path) return fail('worktree 路径为空')
  for (const ln of lines.slice(1)) {
    if (ln.startsWith('HEAD ')) rec.head = ln.slice(5) || null
    else if (ln.startsWith('branch ')) rec.branch = ln.slice(7).replace(/^refs\/heads\//, '') || null
    else if (ln === 'bare') rec.bare = true
    else if (ln === 'detached') rec.detached = true
    else if (ln === 'locked') { rec.locked = true }
    else if (ln.startsWith('locked ')) { rec.locked = true; rec.lockReason = ln.slice(7) }
    else if (ln === 'prunable') { rec.prunable = true }
    else if (ln.startsWith('prunable ')) { rec.prunable = true; rec.prunableReason = ln.slice(9) }
  }
  return rec
}

export function parseWorktrees(stdout: string, useNul: boolean): WorktreesResult {
  const text = String(stdout)
  const records: string[][] = []
  if (useNul) {
    const fields = text.split('\0')
    if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()
    let cur: string[] = []
    for (const f of fields) {
      if (f === '') {
        if (cur.length > 0) { records.push(cur); cur = [] }
        continue
      }
      cur.push(f)
    }
    if (cur.length > 0) records.push(cur)
  } else {
    const lines = text.split('\n')
    let cur: string[] = []
    for (const ln of lines) {
      const line = ln.replace(/\r$/, '')
      if (line === '') {
        if (cur.length > 0) { records.push(cur); cur = [] }
        continue
      }
      cur.push(line)
    }
    if (cur.length > 0) records.push(cur)
  }
  const out: WorktreeRecord[] = []
  for (const r of records) {
    const parsed = parseRecord(r)
    if ((parsed as ParseFailure).ok === false) return parsed as ParseFailure
    out.push(parsed as WorktreeRecord)
  }
  return { ok: true, worktrees: out }
}

export const PARSE_WORKTREES_SOURCE = 'version-control-core/src/parse-worktrees.ts'
