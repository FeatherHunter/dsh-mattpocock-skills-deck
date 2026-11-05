/**
 * src/host/versionControlHistory.ts —— 历史高级查询十条能力的电话处理体：wf.gitHistoryQuery（#1745）。
 *
 * 为什么单独成一个文件：src/host/versionControl.ts 贴着文件粒度门禁的 350 行上限，这个电话体
 * 要装下十条查询（3.4–3.13）的取数与回包，放不进父文件。照同目录 versionControlFiles.ts 的惯例
 * 搬成一个自包含叶子，父文件只留一行动态加载器；起进程的唯一出口 runPinned、失败信封 failPhone、
 * 仓库根解析 resolveRepoRoot 全部由父文件显式传进来，整个仓库仍然只有一条起 git 进程的路。
 *
 * 十条查询的分工（命令口径的真源是共享层 history-query-commands.ts，这里只按 kind 挑解析器）：
 *   3.4 单文件历史 file-history、3.6 按说明搜提交 grep、3.7 按代码变化搜提交 pickaxe
 *     —— 输出都是普通 git log，复用 parse-log.ts；空输出表示没有匹配，回 reason:'empty'。
 *   3.5 行级追溯 blame、3.9 两组提交对照 range-diff、3.10 版本名 describe、
 *   3.11 引用日志 reflog、3.13 取某版本的文件内容 show-file —— 各有自己的解析器（parse-history-query.ts）。
 *   3.8 比较两个引用 compare —— 输出是 numstat，复用 parse-diff-files.ts；空输出表示两个引用没有差异。
 *   3.12 提交备注 notes —— 只有一段原样文本；目标没有备注时 git 退出码是 1，按「没有备注」如实回答，
 *     不当成失败（规格第 4 节：没有就说没有，不猜）。
 *
 * 读不全的口径：blame 与 range-diff 不在规格第 5 节的长任务清单里，所以它们不接长任务通道；
 * 输出超过字节上限时这里直接回失败信封（kind:'truncated'），绝不把半份数据交给界面。
 * 3.9 的对照行数、3.8 的文件条数另有条数上限：超过时裁到上限并显式标 truncated:true，界面上写清「还有多少条没显示」。
 *
 * 为什么参数按 any 收：起进程出口、失败信封与仓库根解析都是父文件注入的能力，形状由接线处决定，
 * 本文件只按约定调用，不拥有它们的完整类型，所以只做最小约束，不替代运行时的能力检测。
 */
import { historyQueryCommandFor } from '../shared/version-control/src/history-query-commands.js'
import { parseBlame, parseDescribe, parseFileContent, parseNotesText, parseRangeDiff, parseReflog } from '../shared/version-control/src/parse-history-query.js'
import { parseDiffFiles } from '../shared/version-control/src/parse-diff-files.js'
import { parseLog } from '../shared/version-control/src/parse-log.js'

/** 父文件注入的依赖：起进程出口、失败信封与仓库根解析都在这里，本文件不自取任何环境。 */
export interface HistoryQueryPhoneDeps {
  failPhone: any
  failureFromExec: any
  runPinned: any
  resolveGitExecutable: any
  resolveRepoRoot: any
  cwdOf: any
}

/** 大输出这一档的上限，与父文件读日志/读差异用的是同一个数值口径（8 MB）。 */
const OUT_LIMIT = 8 * 1024 * 1024
/** 小输出（reflog、notes、describe）用不着 8 MB，各给够用的上限。 */
const SMALL_LIMIT = 1024 * 1024
const DESCRIBE_LIMIT = 4096
/** 3.13 的单个文件上限：超过 1 MB 的整文件内容不往界面上送（读不全就不给半份）。 */
const FILE_LIMIT = 1024 * 1024
/** 3.9 一次最多回 300 对，3.8 一次最多回 2000 个文件；超出的部分裁掉并标 truncated。 */
const RANGE_PAIRS_MAX = 300
const COMPARE_FILES_MAX = 2000

/** 每种查询失败说明里的「在干什么」，用中文短句，界面直接展示，不出现命令名。 */
const WHAT: Record<string, string> = {
  'file-history': '拉这个文件的历史',
  blame: '追溯这个文件的行级来历',
  grep: '按说明搜提交',
  pickaxe: '按代码变化搜提交',
  compare: '比较两个引用',
  'range-diff': '对照两组提交',
  describe: '读版本名',
  reflog: '读引用日志',
  notes: '读提交备注',
  'show-file': '取这个版本的文件内容',
}

/** 取说明用的短句；不认识的 kind 给一句兜底（正常走不到这里，输入校验在共享层）。 */
function whatOf(kind: string): string { return WHAT[kind] || '这次历史查询' }

/** 每种查询的 stdout 字节上限：大输出 8 MB，小输出按需收紧。 */
function limitOf(kind: string): number {
  if (kind === 'describe') return DESCRIBE_LIMIT
  if (kind === 'reflog' || kind === 'notes') return SMALL_LIMIT
  if (kind === 'show-file') return FILE_LIMIT
  return OUT_LIMIT
}

/** 造这条电话的处理体。依赖全部由父文件 createVersionControl 显式传入，本文件不自取任何环境。 */
export function createHistoryQueryPhone(deps: any): (args: any) => Promise<any> {
  const { failPhone, failureFromExec, runPinned, resolveGitExecutable, resolveRepoRoot, cwdOf }: HistoryQueryPhoneDeps = deps

  /** 把一次成功进程的 stdout 按 kind 翻成回包；解析器失败一律给明确失败信封，不猜半个结果。 */
  function payloadOf(kind: string, stdout: string): any {
    if (kind === 'file-history' || kind === 'grep' || kind === 'pickaxe') {
      const parsed: any = parseLog(stdout)
      if (parsed.ok !== true) return failPhone('parse', '提交清单解析失败：' + parsed.detail)
      // 空清单不是错误：说明这一组条件没有匹配到提交，界面照实说「没有匹配」，不猜成「没有历史」。
      return { ok: true, kind: kind, commits: parsed.commits, count: parsed.commits.length, reason: parsed.commits.length > 0 ? 'ok' : 'empty' }
    }
    if (kind === 'blame') {
      const parsed: any = parseBlame(stdout)
      if (parsed.ok !== true) return failPhone('parse', '行级追溯的结果解析失败：' + parsed.detail)
      return { ok: true, kind: kind, lines: parsed.lines, count: parsed.lines.length }
    }
    if (kind === 'compare') {
      const parsed: any = parseDiffFiles(stdout)
      if (parsed.ok !== true) return failPhone('parse', '两个引用的差异清单解析失败：' + parsed.detail)
      const total: number = parsed.files.length
      const truncated: boolean = total > COMPARE_FILES_MAX
      const files: any[] = truncated ? parsed.files.slice(0, COMPARE_FILES_MAX) : parsed.files
      // 空清单是「两边一样」（git diff 没有任何输出），不是失败；reason 让界面能明确写出这一点。
      return { ok: true, kind: kind, files: files, total: total, truncated: truncated, reason: total > 0 ? 'ok' : 'same' }
    }
    if (kind === 'range-diff') {
      const parsed: any = parseRangeDiff(stdout)
      if (parsed.ok !== true) return failPhone('parse', '两组提交对照的结果解析失败：' + parsed.detail)
      const total: number = parsed.pairs.length
      const truncated: boolean = total > RANGE_PAIRS_MAX
      const pairs: any[] = truncated ? parsed.pairs.slice(0, RANGE_PAIRS_MAX) : parsed.pairs
      return { ok: true, kind: kind, pairs: pairs, total: total, extraLines: parsed.extraLines, truncated: truncated, reason: total > 0 ? 'ok' : 'same' }
    }
    if (kind === 'describe') {
      const parsed: any = parseDescribe(stdout)
      if (parsed.ok !== true) return failPhone('parse', '版本名解析失败：' + parsed.detail)
      return { ok: true, kind: kind, text: parsed.describe.text, dirty: parsed.describe.dirty }
    }
    if (kind === 'reflog') {
      const parsed: any = parseReflog(stdout)
      if (parsed.ok !== true) return failPhone('parse', '引用日志解析失败：' + parsed.detail)
      return { ok: true, kind: kind, entries: parsed.entries, count: parsed.entries.length, reason: parsed.entries.length > 0 ? 'ok' : 'empty' }
    }
    if (kind === 'notes') {
      // 备注是作者写给人看的原文，只去行尾换行，不改写内容。
      return { ok: true, kind: kind, note: parseNotesText(stdout), reason: 'ok' }
    }
    if (kind === 'show-file') {
      const parsed: any = parseFileContent(stdout)
      if (parsed.ok !== true) return failPhone('parse', '这个版本的文件内容解析失败：' + parsed.detail)
      return { ok: true, kind: kind, text: parsed.file.text, binary: parsed.file.binary }
    }
    return failPhone('args', '不认识的历史查询：' + kind)
  }

  /** 一条历史查询电话：校验输入 → 找 git 与仓库根 → 起进程 → 失败/截断判断 → 按 kind 解析。 */
  async function handle(args: any): Promise<any> {
    const raw: any = args ? args.kind : ''
    if (typeof raw !== 'string' || raw === '') return failPhone('args', '这次历史查询没有说明是哪一种（缺少 kind）')
    const built: any = historyQueryCommandFor(raw, args && args.params ? args.params : {})
    // 输入不合口径（空关键词、坏提交号、超长路径、行号倒挂……）在这里就拒，绝不起进程，也不猜一个替代值。
    if (built.ok !== true) return failPhone('args', built.detail)
    const kind: string = built.kind
    const exe: any = await resolveGitExecutable()
    if (!exe) return failPhone('env', '找不到 git 命令，历史查询起不了进程')
    const base: any = await resolveRepoRoot(exe, cwdOf(args))
    if (base.ok !== true) return base
    // 3.8 比较两个引用：先分别认一遍两端。认不出的那一端要原样说给用户听（「找不到『nope』这个引用」），
    //   不能让 git 的 fatal 原文或者「当成 HEAD」糊过去 —— 区别在于：含糊的成功比明确的失败更坏。
    //   认出来的完整提交号也带进回包：结果头要写清「比较的是哪两端」，写用户随手打的那几个字不够。
    const ends: any = { leftOid: '', rightOid: '' }
    if (kind === 'compare') {
      const which: string[] = ['left', 'right']
      const revs: string[] = [String((args && args.params && args.params.left) || ''), String((args && args.params && args.params.right) || '')]
      for (let i = 0; i < which.length; i += 1) {
        const check: any = await runPinned(exe, base.root, ['rev-parse', '--verify', '--quiet', revs[i] + '^{commit}'], { stdoutLimit: 4096 })
        if (!check || check.kind !== 'ok') {
          const env: any = failPhone('args', '找不到「' + revs[i] + '」这个引用')
          env.error.reason = 'unknown-rev'
          env.error.which = which[i]
          env.error.rev = revs[i]
          return env
        }
        const oid: string = String(check.stdout || '').trim()
        if (which[i] === 'left') ends.leftOid = oid
        else ends.rightOid = oid
      }
    }
    const res: any = await runPinned(exe, base.root, built.args, { stdoutLimit: limitOf(kind) })
    // 3.12 的特殊口径：目标没有备注时 git 退出码是 1。这不是失败，如实回「没有备注」。
    if (kind === 'notes' && res.kind === 'non-zero' && res.exitCode === 1) return { ok: true, kind: kind, note: null, reason: 'no-note' }
    const bad: any = failureFromExec(res, whatOf(kind))
    if (bad) return bad
    // 读不全就不交半份：blame 与 range-diff 不接长任务通道，超上限一律显式失败并写清上限。
    if (res.truncated) return failPhone('truncated', whatOf(kind) + '的输出超过了 ' + String(limitOf(kind)) + ' 字节上限，读不全就不给半份数据')
    const out: any = payloadOf(kind, res.stdout)
    if (kind === 'compare' && out && out.ok === true) { out.leftOid = ends.leftOid; out.rightOid = ends.rightOid }
    // 回包里带上「问的是哪条提交 / 哪个文件」：界面靠它判断这份读数属不属于正在看的那一条
    //   （单文件历史的列表只认「这份读数的路径就是当前只看的那一个」；备注那一段也只认同一条提交）。
    //   不带回来就等于让界面猜，猜错的症状是「点了没反应，一直停在读取中」。
    if (kind === 'file-history' && out && out.ok === true) out.path = String((args && args.params && args.params.path) || '')
    if (kind === 'notes' && out && out.ok === true) out.rev = String((args && args.params && args.params.rev) || 'HEAD')
    return out
  }

  return handle
}

/** 这个电话处理体所在源文件的路径，供门禁核对登记位置。 */
export const HISTORY_QUERY_PHONE_SOURCE = 'src/host/versionControlHistory.ts'
