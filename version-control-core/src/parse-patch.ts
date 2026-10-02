/**
 * version-control-core/src/parse-patch.ts —— 单文件统一差异逐行分类（只到行，不建分块树）
 *
 * 未跟踪文件不给差异（调用方凭 stable id `untracked-no-diff` 直说，不到这里）。
 * 不归一化换行符（core.autocrlf 的事实带进模型，话术归 #812）。
 */
import type { ParseFailure } from './ports.js'

export type PatchLineKind = 'add' | 'del' | 'context' | 'hunk' | 'filehead' | 'no-newline'

export interface PatchLine {
  kind: PatchLineKind
  text: string
}

export type PatchResult = { ok: true; lines: PatchLine[] } | ParseFailure

export function parsePatch(stdout: string): PatchResult {
  const text = String(stdout)
  const raw = text.split('\n')
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  const out: PatchLine[] = []
  for (const ln of raw) {
    if (ln.startsWith('@@')) out.push({ kind: 'hunk', text: ln })
    else if (ln.startsWith('diff --git ') || ln.startsWith('index ') || ln.startsWith('--- ') || ln.startsWith('+++ ')) {
      out.push({ kind: 'filehead', text: ln })
    } else if (ln.startsWith('\\ ')) out.push({ kind: 'no-newline', text: ln })
    else if (ln.startsWith('+')) out.push({ kind: 'add', text: ln })
    else if (ln.startsWith('-')) out.push({ kind: 'del', text: ln })
    else if (ln.startsWith(' ')) out.push({ kind: 'context', text: ln })
    else if (ln === '') out.push({ kind: 'context', text: ln })
    else return { ok: false, error: 'patch-malformed', detail: '未知差异行首字符' }
  }
  return { ok: true, lines: out }
}

export const PARSE_PATCH_SOURCE = 'version-control-core/src/parse-patch.ts'
