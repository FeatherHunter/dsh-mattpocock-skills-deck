/**
 * src/shared/version-control/src/changes-protocol.ts —— 改动页（规格域 1）的纯协议层（#1742）
 *
 * 这个文件回答三个问题，全部是纯函数，不起进程、不碰磁盘：
 *   1. 改动页这 13 条能力（1.1–1.13）分别对应哪个动作、要不要二次确认、命令是什么；
 *   2. 传进来的路径、移动目标、忽略行、补丁块，形状对不对（不对就给一个稳定理由，宿主照它拒）；
 *   3. 一次动作的 argv 怎么拼（每个参数独立成数组元素）、这次动作的计划摘要怎么算（票据绑定到具体块）。
 *
 * 口径提醒（规格 §8 宿主执行纪律）：宿主自己起 git 进程时，stdin 除 fast-import 那个窄例外一律 ignore。
 * 逐块暂存要 `git apply --cached` 一个补丁，补丁不能走标准输入，所以由宿主把选中块写成普通临时文件，
 * 再把文件路径作为 argv 的一个独立元素传给 git —— 本文件只描述「补丁怎么写」与「argv 长什么样」，
 * 写临时文件与校验由宿主那一层做。
 */
import type { ChangesOp, ChangesPlan, ChangesWriteOp } from './ports.js'
import { canonicalJson } from './write-ticket.js'
import {
  stageArgs,
  stageAllArgs,
  unstageArgs,
  applyCachedArgs,
  discardFileArgs,
  discardAllArgs,
  cleanArgs,
  rmArgs,
  rmCachedArgs,
  mvArgs,
} from './commands.js'

/** 改动页动作的静态元数据：界面、宿主预检与门禁都从这里读同一份名单。 */
export interface ChangesOpMeta {
  op: ChangesOp
  /** 对应能力账本里的编号（1.1–1.13）。 */
  capId: string
  /** 改不改仓库（只读的两条为 false，其余 true）。 */
  write: boolean
  /** 危险动作（丢弃、删除）：界面必须画二次确认卡。 */
  dangerous: boolean
  /** 是否需要二次确认（当前与 dangerous 同值；分开写是为了将来有「危险但有一个撤销键」的动作）。 */
  confirm: boolean
  /** 能不能原样撤回（确认卡「还能不能回来」那一段的判据）：true 表示有明确的反向动作。 */
  reversible: boolean
  /** 命令形状的简短说明（只用于界面提示与文档，不参与拼 argv）。 */
  command: string
}

/**
 * 11 条写动作。顺序按能力编号排（1.2–1.12），门禁按这份顺序逐条断言「每条都有唯一主入口」。
 * 危险动作的口径（规格 3.1）：丢弃未暂存改动、删除未跟踪文件、删除已跟踪文件都要二次确认；
 * 撤回暂存与只停止跟踪不算危险（一个 add 就回来，一个 add 也回来）。
 */
export const CHANGES_WRITE_OPS: ChangesOpMeta[] = [
  { op: 'stage-hunks', capId: '1.2', write: true, dangerous: false, confirm: false, reversible: true, command: 'git apply --cached <第 N 块补丁>' },
  { op: 'stage-file', capId: '1.3', write: true, dangerous: false, confirm: false, reversible: true, command: 'git add -- <path>' },
  { op: 'stage-all', capId: '1.4', write: true, dangerous: false, confirm: false, reversible: true, command: 'git add -A' },
  { op: 'unstage', capId: '1.5', write: true, dangerous: false, confirm: false, reversible: true, command: 'git reset HEAD -- <path>' },
  { op: 'discard-file', capId: '1.6', write: true, dangerous: true, confirm: true, reversible: true, command: 'git restore -- <path>（低于 2.23 用 git checkout -- <path>）' },
  { op: 'discard-all', capId: '1.7', write: true, dangerous: true, confirm: true, reversible: true, command: 'git restore -- .（低于 2.23 用 git checkout -- .）' },
  { op: 'clean-untracked', capId: '1.8', write: true, dangerous: true, confirm: true, reversible: false, command: 'git clean -fd -- <path>' },
  { op: 'rm-tracked', capId: '1.9', write: true, dangerous: true, confirm: true, reversible: true, command: 'git rm -- <path>' },
  { op: 'rm-cached', capId: '1.10', write: true, dangerous: false, confirm: false, reversible: true, command: 'git rm --cached -- <path>' },
  { op: 'mv', capId: '1.11', write: true, dangerous: false, confirm: false, reversible: true, command: 'git mv -- <from> <to>' },
  { op: 'ignore', capId: '1.12', write: true, dangerous: false, confirm: false, reversible: true, command: '追加仓库根 .gitignore（不是 git 命令）' },
]

/** 2 条只读动作：看工作区状态走既有首屏读数，查为什么被忽略走 `git check-ignore -v`。 */
export const CHANGES_READ_OPS: ChangesOpMeta[] = [
  { op: 'status', capId: '1.1', write: false, dangerous: false, confirm: false, reversible: false, command: 'git status --porcelain=v2 --branch -z' },
  { op: 'explain-ignored', capId: '1.13', write: false, dangerous: false, confirm: false, reversible: false, command: 'git check-ignore -v -- <path>' },
]

/** 13 条能力的完整名单（写动作在前、只读在后；界面按 capId 排，不按这个顺序）。 */
export const CHANGES_OPS: ChangesOpMeta[] = CHANGES_WRITE_OPS.concat(CHANGES_READ_OPS)

/** 动作标识符 → 静态元数据；认不出回 null（宿主按 unknown-op 拒，绝不猜）。 */
export function changesOpMetaOf(op: any): ChangesOpMeta | null {
  const s: string = String(op === undefined || op === null ? '' : op)
  for (const m of CHANGES_OPS) if (m.op === s) return m
  return null
}

/** 空计划：makeChangesPlan 的底稿；每次调用都返回新对象，调用方改它不会污染别人。 */
export function emptyChangesPlan(): ChangesPlan {
  return {
    op: 'stage-file',
    paths: [],
    hunkIndex: null,
    patchDigest: null,
    mode: null,
    to: null,
    ignoreLines: [],
    ignoreOldDigest: null,
    removeList: [],
  }
}

/** 把宿主组装出来的计划归一成契约里的形状（数组复制、数字与字符串归一、不认识的 op 抛错）。 */
export function makeChangesPlan(partial?: any): ChangesPlan {
  const p: any = partial || {}
  const meta: ChangesOpMeta | null = changesOpMetaOf(p.op)
  if (!meta || meta.write !== true) throw new Error('[version-control] 改动页计划里的动作名不在写动作名单里：' + String(p.op))
  const plan: ChangesPlan = emptyChangesPlan()
  plan.op = meta.op as ChangesWriteOp
  plan.paths = Array.isArray(p.paths) ? p.paths.map(function (x: any) { return String(x) }) : []
  plan.hunkIndex = (typeof p.hunkIndex === 'number' && isFinite(p.hunkIndex)) ? Math.floor(p.hunkIndex) : null
  plan.patchDigest = (p.patchDigest === null || p.patchDigest === undefined) ? null : String(p.patchDigest)
  plan.mode = (p.mode === 'restore' || p.mode === 'checkout') ? p.mode : null
  plan.to = (p.to === null || p.to === undefined) ? null : String(p.to)
  plan.ignoreLines = Array.isArray(p.ignoreLines) ? p.ignoreLines.map(function (x: any) { return String(x) }) : []
  plan.ignoreOldDigest = (p.ignoreOldDigest === null || p.ignoreOldDigest === undefined) ? null : String(p.ignoreOldDigest)
  plan.removeList = Array.isArray(p.removeList) ? p.removeList.map(function (x: any) { return String(x) }) : []
  return plan
}

/**
 * 路径守卫（能力 1.3–1.12 共用）：只接受「仓库内、正斜杠、普通相对路径」。
 * 返回 null 表示可以；否则返回一个稳定代号，宿主把它翻成 bad-paths 一类的理由。
 * 为什么这么严：写侧输不起 —— 前导短横线会被 git 当开关，前导冒号是 pathspec 魔法，
 * 绝对路径与 .. 会跑到仓库外，反斜杠在 Windows 上会被 git 归一成另一种写法从而绕过绑定比较。
 */
export function pathArgProblem(path: any): string | null {
  if (typeof path !== 'string') return 'not-string'
  const s: string = path
  if (s === '') return 'empty'
  if (/[\u0000-\u001f\u007f]/.test(s)) return 'control-char'
  if (s.indexOf('\\') >= 0) return 'backslash'
  if (s.charAt(0) === '/' || /^[A-Za-z]:/.test(s)) return 'absolute'
  if (s.charAt(s.length - 1) === '/') return 'trailing-slash'
  if (s.charAt(0) === '-' || s.charAt(0) === ':') return 'option-like'
  const segs: string[] = s.split('/')
  for (const seg of segs) {
    if (seg === '') return 'empty-segment'
    if (seg === '.') return 'dot-segment'
    if (seg === '..') return 'dotdot-segment'
  }
  if (s === '.git') return 'git-metadata'
  if (s.indexOf('.git/') === 0) return 'git-metadata'
  return null
}

/** 两条路径（重命名）：from / to 各自过路径守卫，且不许相等。 */
export function twoPathProblem(from: any, to: any): string | null {
  const a: string | null = pathArgProblem(from)
  if (a) return a
  const b: string | null = pathArgProblem(to)
  if (b) return b
  return String(from) === String(to) ? 'same-path' : null
}

/** 一组路径的去重与计数（界面与门禁共用）：保持原顺序、去掉重复项。 */
export function uniquePaths(list: any): string[] {
  const out: string[] = []
  if (!Array.isArray(list)) return out
  for (const x of list) {
    const s: string = String(x === undefined || x === null ? '' : x)
    if (out.indexOf(s) < 0) out.push(s)
  }
  return out
}

/** 忽略清单里为这个路径追加的那一行：仓库根锚定写法（开头斜杠只匹配仓库根，不误伤别的目录）。 */
export function ignoreLineOf(path: any): string {
  return '/' + String(path === undefined || path === null ? '' : path)
}

/** 忽略行守卫：非空、不含换行/制表/控制字符、不以叹号开头（反向规则在面板里不提供）。 */
export function ignoreLineProblem(line: any): string | null {
  if (typeof line !== 'string') return 'not-string'
  if (line === '') return 'empty'
  if (/[\u0000-\u001f\u007f]/.test(line)) return 'control-char'
  if (line.charAt(0) === '!') return 'negation'
  if (line.length > 4096) return 'too-long'
  return null
}

/** git 版本是否够用 restore（能力 1.5/1.6/1.7 要求 2.23；原子矩阵里写明了降级做法）。 */
export function versionUsesRestore(gitVersion: any): boolean {
  const m: any = /(\d+)\.(\d+)/.exec(String(gitVersion === undefined || gitVersion === null ? '' : gitVersion))
  if (!m) return false
  const major: number = Number(m[1])
  const minor: number = Number(m[2])
  if (major !== 2) return major > 2
  return minor >= 23
}

/**
 * 统一 diff 的块拆分（能力 1.2）：只把 git 能拆开的整块当一个可勾选单位。
 * 二进制、纯重命名、只有模式变化（没有任何 @@ 块）一律不算「能拆开」，由调用方按整份文件处理。
 * 返回的 header 是第一个 @@ 之前的文件头（diff --git / index / --- / +++ 等），补丁还原时要原样带上。
 */
export interface DiffHunk {
  /** 从 0 起的块序号（票据里记的就是它）。 */
  index: number
  /** 这一块的 @@ 头（含原始行号，还原补丁时必须原样保留）。 */
  header: string
  startOld: number
  oldLines: number
  startNew: number
  newLines: number
  /** 这一块的正文行（含前缀空格/+/-，以及 \ No newline at end of file 这种特殊行）。 */
  lines: string[]
}

export interface ParsedDiff {
  ok: true
  header: string[]
  hunks: DiffHunk[]
}

export interface DiffParseFailure {
  ok: false
  /** binary / rename / no-diff / bad-patch / empty / multi-file：前五个都会被宿主翻成 hunks-unavailable 一类的理由。 */
  reason: string
}

/** 解析一段针对单个文件的统一 diff。不是「能拆块」的输入一律回可读理由，不猜。 */
export function splitUnifiedDiff(text: any): ParsedDiff | DiffParseFailure {
  const raw: string = String(text === undefined || text === null ? '' : text)
  if (raw.trim() === '') return { ok: false, reason: 'empty' }
  const lines: string[] = raw.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const header: string[] = []
  const hunks: DiffHunk[] = []
  let files: number = 0
  let i: number = 0
  while (i < lines.length) {
    const line: string = lines[i]
    if (line.indexOf('diff --git ') === 0) {
      files += 1
      if (files > 1) return { ok: false, reason: 'multi-file' }
      header.push(line)
      i += 1
      continue
    }
    if (/^Binary files /.test(line) || line === 'GIT binary patch') return { ok: false, reason: 'binary' }
    if (/^rename from /.test(line) || /^rename to /.test(line)) return { ok: false, reason: 'rename' }
    if (line.indexOf('@@ ') === 0) {
      const m: any = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (!m) return { ok: false, reason: 'bad-patch' }
      const hunk: DiffHunk = {
        index: hunks.length,
        header: line,
        startOld: Number(m[1]),
        oldLines: (m[2] === undefined) ? 1 : Number(m[2]),
        startNew: Number(m[3]),
        newLines: (m[4] === undefined) ? 1 : Number(m[4]),
        lines: [],
      }
      i += 1
      while (i < lines.length && lines[i].indexOf('@@ ') !== 0 && lines[i].indexOf('diff --git ') !== 0) {
        hunk.lines.push(lines[i])
        i += 1
      }
      hunks.push(hunk)
      continue
    }
    if (hunks.length === 0) header.push(line)
    i += 1
  }
  if (hunks.length === 0) return { ok: false, reason: 'no-diff' }
  return { ok: true, header: header, hunks: hunks }
}

/**
 * 还原「只暂存第 hunkIndex 块」的补丁：文件头 + 那一块的 @@ 头与正文。
 * git apply 接受只含部分块的补丁（行号按原文保留，与 git add -p 的做法一致）。
 */
export function patchForHunk(text: any, hunkIndex: any): any {
  const parsed: any = splitUnifiedDiff(text)
  if (parsed.ok !== true) return { ok: false, reason: parsed.reason }
  const idx: number = (typeof hunkIndex === 'number' && isFinite(hunkIndex)) ? Math.floor(hunkIndex) : -1
  if (idx < 0 || idx >= parsed.hunks.length) return { ok: false, reason: 'hunk-out-of-range' }
  const hunk: DiffHunk = parsed.hunks[idx]
  const body: string[] = parsed.header.concat([hunk.header]).concat(hunk.lines)
  return { ok: true, text: body.join('\n') + '\n', hunk: hunk, hunkCount: parsed.hunks.length }
}

/**
 * 计划摘要要哈希的那份字节（票据绑定到具体块的关键）：
 * 规范化 JSON —— 同样的动作、同样的路径顺序、同样的块与补丁摘要，算出来必须逐字符相同。
 */
export function changesPlanInput(plan: any): string {
  const p: any = plan || {}
  return canonicalJson({
    op: p.op,
    paths: Array.isArray(p.paths) ? p.paths : [],
    hunkIndex: p.hunkIndex === undefined ? null : p.hunkIndex,
    patchDigest: p.patchDigest === undefined ? null : p.patchDigest,
    mode: p.mode === undefined ? null : p.mode,
    to: p.to === undefined ? null : p.to,
    ignoreLines: Array.isArray(p.ignoreLines) ? p.ignoreLines : [],
    ignoreOldDigest: p.ignoreOldDigest === undefined ? null : p.ignoreOldDigest,
    removeList: Array.isArray(p.removeList) ? p.removeList : [],
  })
}

/**
 * 一次改动页写动作的 argv（每项独立成元素，不拼 shell 字符串）。
 * 返回 null 表示这条动作不是 git 命令（能力 1.12 直接改 .gitignore）。
 * patchPath 只有逐块暂存用：宿主把选中块写成普通临时文件后，把文件路径传进来。
 */
export function changesArgvOf(plan: any, patchPath?: any): string[] | null {
  const p: any = plan || {}
  const paths: string[] = Array.isArray(p.paths) ? p.paths.map(function (x: any) { return String(x) }) : []
  if (p.op === 'stage-hunks') return applyCachedArgs(String(patchPath === undefined || patchPath === null ? '' : patchPath))
  if (p.op === 'stage-file') return stageArgs(paths)
  if (p.op === 'stage-all') return stageAllArgs()
  if (p.op === 'unstage') return unstageArgs(paths)
  if (p.op === 'discard-file') return discardFileArgs(String(p.mode || ''), paths)
  if (p.op === 'discard-all') return discardAllArgs(String(p.mode || ''))
  if (p.op === 'clean-untracked') return cleanArgs(paths)
  if (p.op === 'rm-tracked') return rmArgs(paths)
  if (p.op === 'rm-cached') return rmCachedArgs(paths)
  if (p.op === 'mv') return mvArgs(String(paths[0] || ''), String(p.to || ''))
  if (p.op === 'ignore') return null
  return null
}

/** 改 .gitignore 的那条动作要写的完整文本：旧内容 + 缺的那几行（保证以换行结尾，已有行不重复追加）。 */
export function gitignoreAppendOf(oldText: any, lines: any): { text: string; added: string[] } {
  const old: string = String(oldText === undefined || oldText === null ? '' : oldText)
  const have: string[] = old.split(/\r?\n/)
  const added: string[] = []
  for (const x of (Array.isArray(lines) ? lines : [])) {
    const line: string = String(x)
    if (have.indexOf(line) >= 0 || added.indexOf(line) >= 0) continue
    added.push(line)
  }
  if (added.length === 0) return { text: old, added: added }
  const base: string = (old === '' || old.charAt(old.length - 1) === '\n') ? old : old + '\n'
  return { text: base + added.join('\n') + '\n', added: added }
}

export const CHANGES_PROTOCOL_SOURCE = 'src/shared/version-control/src/changes-protocol.ts'
