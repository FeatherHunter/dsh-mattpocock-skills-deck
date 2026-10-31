/**
 * src/shared/version-control/src/history-query-commands.ts —— 历史高级查询十条能力的参数口径（纯函数）
 *
 * 规格 #1586 能力 3.4–3.13（T10 #1745）：单文件历史、行级追溯、按说明搜提交、按代码变化搜提交、
 * 比较两个引用、两组提交对照、版本名、引用日志、提交备注、取某版本的文件内容。
 * 与 commands.ts 同一纪律（#813 定案 1）：参数与解析同处一个被测试的单元 —— 这里拼的正是
 * parse-history-query.ts 解析的那一套，宿主只负责起进程。
 *
 * 十条都是只读命令：不写仓库、不发网络、不开编辑器。固定前缀（--no-pager 等）与 -C 钉仓库
 * 由宿主那唯一出口补上，本文件只描述「子命令与它自己的参数」，不写第二份。
 *
 * 输入校验只挡「会破坏 argv / 会被当成选项」的形状，不重造 git 自己的取名规则：
 *   · 用户输入一律作为单个 argv 元素直传，绝不经 shell 拼接；
 *   · 以 - 开头的输入会被 git 当成选项：提交号/引用名/搜索词按各自规则挡住；
 *   · 换行与 NUL 不许进 argv（会截断或损坏参数）；
 *   · 搜索词、路径、引用名都有长度上限，超了显式拒绝，不悄悄截断后当成功。
 * 校验失败返回 { ok:false, error:'invalid-input', detail }，宿主原样转成失败信封，界面贴触发点显示。
 */
import { commandFor } from './commands.js'

/** 十条能力的稳定标识符（ASCII，界面话术在词表；门禁断言标识符，不断言句子）。 */
export type HistoryQueryKind =
  | 'file-history'
  | 'blame'
  | 'grep'
  | 'pickaxe'
  | 'compare'
  | 'range-diff'
  | 'describe'
  | 'reflog'
  | 'notes'
  | 'show-file'

export const HISTORY_QUERY_KINDS: HistoryQueryKind[] = [
  'file-history', 'blame', 'grep', 'pickaxe', 'compare',
  'range-diff', 'describe', 'reflog', 'notes', 'show-file',
]

/** 一次查询最多取多少条提交 / 引用日志条目。与 #1744 的提交历史页同一量级，翻页不在这里（只读查询不做长任务）。 */
export const HISTORY_QUERY_COUNT_DEFAULT: number = 50
export const HISTORY_QUERY_COUNT_MAX: number = 200
/** 行级追溯一次最多几行（git blame 每行一组头，输出大；超了显式拒绝，让用户缩小范围）。 */
export const HISTORY_QUERY_BLAME_LINES_MAX: number = 500
/** 两组提交对照最多画几对：超了回包带 truncated 标记，界面显式说「只画到第 N 对」。 */
export const HISTORY_QUERY_RANGE_PAIRS_MAX: number = 300
/** 比较两个引用最多列多少个文件：超了同样带 truncated 标记。 */
export const HISTORY_QUERY_COMPARE_FILES_MAX: number = 2000
/** 搜索词与路径的长度上限：再长就不是人手输入的东西了，显式拒绝。 */
export const HISTORY_QUERY_TEXT_MAX: number = 200
export const HISTORY_QUERY_PATH_MAX: number = 1024
/** 引用名（分支、标签、HEAD@{n} 这类）长度上限。 */
export const HISTORY_QUERY_REV_MAX: number = 200
/** 取某版本文件内容的字节上限：内容是按原样显示给人看的，超了显式失败，不截半份。 */
export const HISTORY_QUERY_FILE_BYTES_MAX: number = 1024 * 1024

export interface HistoryQuerySpec {
  kind: HistoryQueryKind
  subcommand: string
  args: string[]
}

export type HistoryQueryCommand =
  | ({ ok: true } & HistoryQuerySpec)
  | { ok: false; error: 'invalid-input' | 'unknown-kind'; detail: string }

function bad(detail: string): HistoryQueryCommand {
  return { ok: false, error: 'invalid-input', detail: detail }
}

/** 普通用户输入（搜索词、路径）：非空、有长度上限、不含换行与 NUL。
 *  为什么允许以 - 开头：它们要么排在 -- 之后、要么拼成 --grep= / -S 的同一个 argv 元素，
 *  不会被当成选项；真正危险的是「单独一个 argv 元素且以 - 开头」的引用名，那条在 revOk 里挡。 */
function textOk(v: any, max: number, what: string): { ok: true; text: string } | { ok: false; detail: string } {
  if (typeof v !== 'string') return { ok: false, detail: what + '必须是字符串' }
  const text: string = v
  if (text === '') return { ok: false, detail: what + '不能为空' }
  if (text.length > max) return { ok: false, detail: what + '太长（最多 ' + String(max) + ' 个字符）' }
  if (/[\n\r\u0000]/.test(text)) return { ok: false, detail: what + '里不许有换行或 NUL' }
  return { ok: true, text: text }
}

/** 引用名与提交号的形状校验（3.4/3.5/3.8/3.9/3.11/3.12/3.13 共用）。
 *  允许分支名、标签名、短/长哈希、HEAD@{n}、v1.0.0、HEAD~2 这类常见写法；
 *  挡掉前导 -（会被当选项）、空白与 NUL（会破坏 argv）、.. 与 ...（比较与对照的区间由本文件自己拼，
 *  不许用户塞进来一段区间把「两个引用」变成别的命令）、以及冒号（3.13 用 rev:path 拼接，冒号会造成歧义）。 */
function revOk(v: any, what: string): { ok: true; rev: string } | { ok: false; detail: string } {
  if (typeof v !== 'string') return { ok: false, detail: what + '必须是字符串' }
  const rev: string = v
  if (rev === '') return { ok: false, detail: what + '不能为空' }
  if (rev.length > HISTORY_QUERY_REV_MAX) return { ok: false, detail: what + '太长（最多 ' + String(HISTORY_QUERY_REV_MAX) + ' 个字符）' }
  if (rev.charAt(0) === '-') return { ok: false, detail: what + '不能以 - 开头（会被 git 当成选项）' }
  if (/[\s\u0000]/.test(rev)) return { ok: false, detail: what + '里不许有空白或 NUL' }
  if (rev.indexOf('..') >= 0) return { ok: false, detail: what + '里不许写区间（.. 或 ...），区间由面板自己拼' }
  if (rev.indexOf(':') >= 0) return { ok: false, detail: what + '里不许有冒号' }
  return { ok: true, rev: rev }
}

/** 「路径」这一类的输入：非空、有上限、不含换行与 NUL。路径里允许空格与中文（literal-pathspecs 挡住通配）。 */
function pathOk(v: any): { ok: true; path: string } | { ok: false; detail: string } {
  const t = textOk(v, HISTORY_QUERY_PATH_MAX, '路径')
  return t.ok ? { ok: true, path: t.text } : t
}

/** 条数：认数字与纯数字字符串；给了看不懂的值就用默认值（与宿主既有 clampInt 同口径），不失败。 */
function countOf(v: any, fallback: number): number {
  const n: any = (typeof v === 'number' && isFinite(v)) ? Math.floor(v) : ((typeof v === 'string' && /^[0-9]+$/.test(v)) ? Number(v) : NaN)
  if (!isFinite(n)) return fallback
  return Math.min(HISTORY_QUERY_COUNT_MAX, Math.max(1, n))
}

/** 行号范围（3.5）：两个正整数且 end >= start，跨度不超过上限。字符串形态（界面输入框给的是字符串）也认。 */
function lineRangeOf(start: any, end: any): { ok: true; start: number; end: number } | { ok: false; detail: string } {
  const a: any = (typeof start === 'number' && isFinite(start)) ? Math.floor(start) : ((typeof start === 'string' && /^[0-9]+$/.test(start)) ? Number(start) : NaN)
  const b: any = (typeof end === 'number' && isFinite(end)) ? Math.floor(end) : ((typeof end === 'string' && /^[0-9]+$/.test(end)) ? Number(end) : NaN)
  if (!isFinite(a) || !isFinite(b)) return { ok: false, detail: '行号必须是正整数' }
  if (a < 1 || b < 1) return { ok: false, detail: '行号从 1 起算' }
  if (b < a) return { ok: false, detail: '结束行不能小于起始行' }
  if (b - a + 1 > HISTORY_QUERY_BLAME_LINES_MAX) return { ok: false, detail: '一次最多追溯 ' + String(HISTORY_QUERY_BLAME_LINES_MAX) + ' 行，请缩小范围' }
  return { ok: true, start: a, end: b }
}

/** 提交历史类查询（3.4/3.6/3.7）共用的日志参数：直接取 commands.ts 的唯一口径，
 *  再在后面挂选择条件（--follow / --grep / -S）。日志格式、-z、--no-decorate 一个字都不另写。 */
function logArgsOf(count: number): string[] {
  return (commandFor('log', { logCount: count }) as any).args.slice()
}

/**
 * 拼一条历史查询命令。params 是界面传上来的原始值（可能缺、可能是字符串），本函数负责校验与归一：
 * 返回 ok:false 时宿主一个进程都不起，错误原因原样带给界面（贴触发点，不猜）。
 *
 * 每种查询的参数与为什么这么拼：
 *   3.4 file-history  git log --follow -n N -- <path>
 *       --follow 让重命名前后的提交都算这条路径的历史；单路径是它的前提，所以必须正好一条。
 *   3.6 grep          git log -i --grep=<说明> -n N      说明按 git 的正则口径搜提交说明。
 *   3.7 pickaxe       git log -S<文本> -n N（增删过这段文本）/ -G<文本>（补丁里出现过这段文本）。
 *   3.8 compare       git diff --numstat -z ... <左>..<右>（two-dot，默认）或 <左>...<右>（three-dot）。
 *   3.9 range-diff    git range-diff <base>..<旧> <base>..<新>：两组提交按同一基线对照。
 *   3.10 describe     git describe --tags --dirty --always。带 --dirty 时不许再给提交号（git 会拒），
 *       所以这条永远读当前 HEAD；回包里如实标出「当前工作区有未提交改动」。
 *   3.11 reflog       git reflog show --date=iso-strict --format=<5 字段> -n N [<引用>]。
 *   3.12 notes        git notes show <提交>（缺省 HEAD）。没有备注是 git 退出码 1，由宿主按「没有」处理。
 *   3.13 show-file    git show <版本>:<路径>。版本允许标签与分支名；路径里不许有冒号（拼接会歧义）。
 *   3.5 blame         git blame --line-porcelain -L <起>,<止> [<提交>] -- <路径>。
 *        --line-porcelain 每行都带完整头（作者、时间、摘要），按行追溯时不必再回头查提交。
 */
export function historyQueryCommandFor(kind: any, params: any): HistoryQueryCommand {
  const p: any = params || {}
  const k: string = String(kind || '')
  if (HISTORY_QUERY_KINDS.indexOf(k as HistoryQueryKind) < 0) return { ok: false, error: 'unknown-kind', detail: '不认识的历史查询：' + k }
  const count: number = countOf(p.count, HISTORY_QUERY_COUNT_DEFAULT)
  switch (k as HistoryQueryKind) {
    case 'file-history': {
      const path = pathOk(p.path)
      if (!path.ok) return bad(path.detail)
      const args: string[] = logArgsOf(count)
      args.push('--follow', '--', path.path)
      return { ok: true, kind: 'file-history', subcommand: 'log', args: args }
    }
    case 'grep': {
      const q = textOk(p.pattern, HISTORY_QUERY_TEXT_MAX, '搜索词')
      if (!q.ok) return bad(q.detail)
      const args: string[] = logArgsOf(count)
      args.push('-i', '--grep=' + q.text)
      return { ok: true, kind: 'grep', subcommand: 'log', args: args }
    }
    case 'pickaxe': {
      const q = textOk(p.text, HISTORY_QUERY_TEXT_MAX, '搜索文本')
      if (!q.ok) return bad(q.detail)
      const mode: string = String(p.mode === 'change' ? 'change' : 'occurrence')
      const flag: string = (mode === 'change' ? '-G' : '-S') + q.text
      const args: string[] = logArgsOf(count)
      args.push(flag)
      return { ok: true, kind: 'pickaxe', subcommand: 'log', args: args }
    }
    case 'compare': {
      const left = revOk(p.left, '左边的引用')
      if (!left.ok) return bad(left.detail)
      const right = revOk(p.right, '右边的引用')
      if (!right.ok) return bad(right.detail)
      const mode: string = String(p.mode === 'three-dot' ? 'three-dot' : 'two-dot')
      const range: string = left.rev + (mode === 'three-dot' ? '...' : '..') + right.rev
      const args: string[] = ['diff', '--numstat', '-z', '--no-ext-diff', '--find-renames', range]
      return { ok: true, kind: 'compare', subcommand: 'diff', args: args }
    }
    case 'range-diff': {
      const base = revOk(p.base, '基线')
      if (!base.ok) return bad(base.detail)
      const left = revOk(p.left, '旧的一组端点')
      if (!left.ok) return bad(left.detail)
      const right = revOk(p.right, '新的一组端点')
      if (!right.ok) return bad(right.detail)
      const args: string[] = ['range-diff', base.rev + '..' + left.rev, base.rev + '..' + right.rev]
      return { ok: true, kind: 'range-diff', subcommand: 'range-diff', args: args }
    }
    case 'describe':
      return { ok: true, kind: 'describe', subcommand: 'describe', args: ['describe', '--tags', '--dirty', '--always'] }
    case 'reflog': {
      const args: string[] = ['reflog', 'show', '--date=iso-strict', '--format=%H%x00%h%x00%gd%x00%gn%x00%gs%x00', '-n', String(count)]
      if (p.ref !== undefined && p.ref !== null && p.ref !== '') {
        const ref = revOk(p.ref, '引用')
        if (!ref.ok) return bad(ref.detail)
        args.push(ref.rev)
      }
      return { ok: true, kind: 'reflog', subcommand: 'reflog', args: args }
    }
    case 'notes': {
      let rev: string = 'HEAD'
      if (p.rev !== undefined && p.rev !== null && p.rev !== '') {
        const r = revOk(p.rev, '提交')
        if (!r.ok) return bad(r.detail)
        rev = r.rev
      }
      return { ok: true, kind: 'notes', subcommand: 'notes', args: ['notes', 'show', rev] }
    }
    case 'show-file': {
      const rev = revOk(p.rev, '版本')
      if (!rev.ok) return bad(rev.detail)
      const path = pathOk(p.path)
      if (!path.ok) return bad(path.detail)
      if (path.path.indexOf(':') >= 0) return bad('路径里不许有冒号（版本与路径用冒号拼接，会有歧义）')
      if (path.path.charAt(0) === ':') return bad('路径不能以冒号开头')
      return { ok: true, kind: 'show-file', subcommand: 'show', args: ['show', rev.rev + ':' + path.path] }
    }
    case 'blame': {
      const path = pathOk(p.path)
      if (!path.ok) return bad(path.detail)
      const range = lineRangeOf(p.lineStart, p.lineEnd)
      if (!range.ok) return bad(range.detail)
      const args: string[] = ['blame', '--line-porcelain', '-L', String(range.start) + ',' + String(range.end)]
      if (p.rev !== undefined && p.rev !== null && p.rev !== '') {
        const r = revOk(p.rev, '提交')
        if (!r.ok) return bad(r.detail)
        args.push(r.rev)
      }
      args.push('--', path.path)
      return { ok: true, kind: 'blame', subcommand: 'blame', args: args }
    }
  }
  return { ok: false, error: 'unknown-kind', detail: '不认识的历史查询：' + k }
}

export const HISTORY_QUERY_COMMANDS_SOURCE = 'src/shared/version-control/src/history-query-commands.ts'
