/**
 * version-control-core/src/parse-status.ts —— status --porcelain=v2 --branch -z 解析
 *
 * 记录行严格校验（字段数、行首字符、结尾残留），对不上显式失败；只有 `#` 头部行按官方说法忽略。
 * 形状严格，顺序与重复宽容：三类已跟踪记录不保证顺序（官方原话），冲突时同一路径出现一次 `u` 记录。
 * `2` 记录在 -z 下占两个 NUL 字段（新路径 + 原路径），顺序是新在前、原在后（-z 反转，调研实测）。
 */
import type { ParseFailure } from './ports.js'

export interface StatusBranch {
  head: string
  detached: boolean
  oid: string | null
  upstream: string | null
  ahead: number
  behind: number
}

export interface StatusEntry {
  kind: 'ordinary' | 'renamed' | 'unmerged' | 'untracked' | 'ignored'
  x: string
  y: string
  path: string
  origPath: string | null
}

export type StatusResult = { ok: true; branch: StatusBranch; entries: StatusEntry[] } | ParseFailure

const HEX = /^[0-9a-f]+$/

function fail(detail: string): ParseFailure {
  return { ok: false, error: 'status-malformed', detail }
}

export function parseStatus(stdout: string): StatusResult {
  const fields = String(stdout).split('\0')
  if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()
  const branch: StatusBranch = { head: '', detached: false, oid: null, upstream: null, ahead: 0, behind: 0 }
  let sawHead = false
  const entries: StatusEntry[] = []
  let i = 0
  while (i < fields.length) {
    const f = fields[i]
    i += 1
    if (f === '') return fail('空记录')
    if (f.charAt(0) === '#') {
      const line = f
      if (line.startsWith('# branch.head ')) {
        sawHead = true
        const v = line.slice('# branch.head '.length)
        if (v === '(detached)') { branch.head = '(detached)'; branch.detached = true } else { branch.head = v }
      } else if (line.startsWith('# branch.oid ')) {
        const v = line.slice('# branch.oid '.length)
        branch.oid = v === '(initial)' ? null : v
        if (branch.oid !== null && !HEX.test(branch.oid)) return fail('branch.oid 非十六进制')
      } else if (line.startsWith('# branch.upstream ')) {
        branch.upstream = line.slice('# branch.upstream '.length) || null
      } else if (line.startsWith('# branch.ab ')) {
        const m = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line)
        if (!m) return fail('branch.ab 形状不对')
        branch.ahead = Number(m[1]); branch.behind = Number(m[2])
      }
      continue
    }
    const tag = f.charAt(0)
    if (tag === '1') {
      const parts = f.split(' ')
      if (parts.length !== 9) return fail('1 记录字段数不是 9')
      const xy = parts[1]
      if (!/^[.MTAUDRC]{2}$/.test(xy)) return fail('1 记录 XY 非法')
      entries.push({ kind: 'ordinary', x: xy.charAt(0), y: xy.charAt(1), path: parts[8], origPath: null })
    } else if (tag === '2') {
      const parts = f.split(' ')
      if (parts.length !== 10) return fail('2 记录字段数不是 10')
      const xy = parts[1]
      if (!/^[.MTAUDRC]{2}$/.test(xy)) return fail('2 记录 XY 非法')
      if (i >= fields.length) return fail('2 记录缺原路径字段')
      const orig = fields[i]
      i += 1
      entries.push({ kind: 'renamed', x: xy.charAt(0), y: xy.charAt(1), path: parts[9], origPath: orig })
    } else if (tag === 'u') {
      const parts = f.split(' ')
      if (parts.length !== 11) return fail('u 记录字段数不是 11')
      const xy = parts[1]
      if (xy.length !== 2) return fail('u 记录 XY 非法')
      entries.push({ kind: 'unmerged', x: xy.charAt(0), y: xy.charAt(1), path: parts[10], origPath: null })
    } else if (tag === '?') {
      if (f.charAt(1) !== ' ') return fail('? 记录缺少空格')
      entries.push({ kind: 'untracked', x: '?', y: '?', path: f.slice(2), origPath: null })
    } else if (tag === '!') {
      if (f.charAt(1) !== ' ') return fail('! 记录缺少空格')
      entries.push({ kind: 'ignored', x: '!', y: '!', path: f.slice(2), origPath: null })
    } else {
      return fail('未知行首字符 ' + JSON.stringify(tag))
    }
  }
  if (!sawHead) return fail('缺 # branch.head 行')
  return { ok: true, branch, entries }
}

export const PARSE_STATUS_SOURCE = 'version-control-core/src/parse-status.ts'
