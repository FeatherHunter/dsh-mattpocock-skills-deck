/**
 * version-control-core/src/parse-patch.ts —— 统一差异逐行分类（只到行，不建分块树）
 *
 * 已知的结构行（真机实测，原始字节见 fixtures/live-patch-shapes.json）：
 *   `diff --git `、`index `、`--- `、`+++ `（普通修改、新增、删除都用这四种开头），
 *   `new file mode `、`deleted file mode `（新增与删除）、`old mode `、`new mode `（改权限），
 *   `similarity index `、`rename from `、`rename to `（重命名），`Binary files `（二进制，
 *   不带 --binary 时 git 用这一行代替内容）；
 *   再加上 `@@`（块头）、`\ `（末尾无换行）、`+` / `-` / 空格三种内容行。
 * 这之外的行首字符一律显式失败——形状严格，不许「认不出就放过」。
 *
 * 修正来历（#817，2026-10-04）：#816 交付时只认了普通修改那几种头行，于是「已暂存新增 / 未暂存删除 /
 * 模式变更 / 重命名 / 二进制」这五种在真机上都回 patch-malformed；当时的手写样本（live:false）只有一条
 * 普通修改，覆盖不到这些头行。真机样本补进来之后这条口径才被守住。
 * 行首歧义（#819 复审 P1-4）：`--- ` 与 `+++ ` 只在一个文件段还没进第一个 @@ 之前算文件头；
 * 进了 hunk 之后它们就是内容行（删除行内容以 `-- ` 开头、新增行内容以 `++ ` 开头），
 * 否则用户会看到「注释行被当成文件头」——那两行既没按增删归类，也画错了位置。
 * 未跟踪文件不给差异（调用方凭稳定 id `untracked-no-diff` 直说，不到这里）。
 * 不归一化换行符（core.autocrlf 的事实带进模型，话术归 #812）。
 */
import type { ParseFailure } from './ports.js'

export type PatchLineKind = 'add' | 'del' | 'context' | 'hunk' | 'filehead' | 'no-newline'

export interface PatchLine {
  kind: PatchLineKind
  text: string
}

export type PatchResult = { ok: true; lines: PatchLine[] } | ParseFailure

/** 结构行（文件头）的前缀表：命中就是 filehead；全部未命中又不是内容行，就显式失败。 */
const HEADER_PREFIXES = [
  'diff --git ', 'index ',
  'new file mode ', 'deleted file mode ', 'old mode ', 'new mode ',
  'similarity index ', 'rename from ', 'rename to ', 'Binary files ',
]
/** 有歧义的两个文件头前缀：删除行的内容以 `-- ` 开头时补丁行就是 `--- …`，新增行的内容以 `++ ` 开头时
 *  就是 `+++ …`（#819 复审 P1-4 真机复现）。只在一个文件段还没进第一个 @@ 之前算文件头；进了 hunk 之后
 *  一律按内容行判（`-` / `+`）。 */
const AMBIGUOUS_HEAD_PREFIXES = ['--- ', '+++ ']

export function parsePatch(stdout: string): PatchResult {
  const text = String(stdout)
  const raw = text.split('\n')
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  const out: PatchLine[] = []
  let inHunk = false
  for (const ln of raw) {
    // 同一次补丁里可能有多个文件段：见到 diff --git 就是新的一段，`--- / +++` 的歧义从这一段重新算。
    if (ln.startsWith('diff --git ')) { inHunk = false; out.push({ kind: 'filehead', text: ln }) }
    else if (!inHunk && AMBIGUOUS_HEAD_PREFIXES.some((p) => ln.startsWith(p))) out.push({ kind: 'filehead', text: ln })
    else if (HEADER_PREFIXES.some((p) => ln.startsWith(p))) out.push({ kind: 'filehead', text: ln })
    else if (ln.startsWith('@@')) { inHunk = true; out.push({ kind: 'hunk', text: ln }) }
    else if (ln.startsWith('\\ ')) out.push({ kind: 'no-newline', text: ln })
    else if (ln.startsWith('+')) out.push({ kind: 'add', text: ln })
    else if (ln.startsWith('-')) out.push({ kind: 'del', text: ln })
    else if (ln.startsWith(' ') || ln === '') out.push({ kind: 'context', text: ln })
    else return { ok: false, error: 'patch-malformed', detail: '未知差异行首字符' }
  }
  return { ok: true, lines: out }
}

export const PARSE_PATCH_SOURCE = 'version-control-core/src/parse-patch.ts'
