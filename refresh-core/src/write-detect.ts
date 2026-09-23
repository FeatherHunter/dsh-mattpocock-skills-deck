/**
 * refresh-core/src/write-detect.ts —— 写事件判定表（纯函数）
 *
 * 这个文件只回答一个问题：一次**已经成功**的工具调用，算不算「有人往工单仓库里写了东西」？
 * 答完还有第二问：如果算，改的是哪一张票？答案只有三种：确定写、可疑、其余。
 *
 * 为什么判定表必须住在纯函数里（票面 #710 硬要求）：判定错了不是崩溃，而是**静默漏刷或误刷**
 * ——漏了「你刚写完的东西五分钟还看不到」，误了「每敲一行命令就整池重建一次、把额度烧光」。
 * 两种坏法都只有把整张表穷举测一遍才看得出来，所以这里没有一行读盘、联网、看时钟、读环境变量的代码：
 * 输入是「事件形态 + 工具名 + 已经解析好的参数」，输出是「三档 + 票号或未知 + 原因代号」。
 * 调它的那一侧在 src/host/refresh/writeEvents.js，负责把真事件翻译成这份输入。
 *
 * 三条判定纪律（出自定稿第十一章与第十三章，逐条落在下面）：
 *   1. **只做首词与子命令匹配**，不拿整条命令行做正则扫描；票号只从结构化出口取（我们自己工具的
 *      具名参数、命令行里第一个位置参数），取不到就记「未知」，绝不从正文、标签名、URL 里回退猜数字
 *      ——仓库里为这两条老错留过记录（`--add-label` 被当流转、从正文回退取任意数字当票号）。
 *   2. **只认成功**。一次失败的 `gh issue close` 什么都没改，不该触发任何取数。
 *   3. **认不出的默认档是「立即探测」，不是「丢弃」**。宁可多探一次（一条 REST），不许漏一次。
 *
 * 隐私红线：入参里有命令原文，返回值里**一个字符都没有**——只有档位、票号与原因代号。
 * 参数只在这一层做瞬时匹配，绝不进日志、不落盘、不回界面。
 *
 * 事件形态（research/dsh-platform-facts-2026-09-23.md 第一节）：`tools/result` 是 Cordis **运行时**
 * 事件（不是会话事件），原生调用与 ptc 内层派发走同一条收尾路径，一次给全工具名、已解析参数、
 * 是否出错与结构化结果（`result.value.exitCode`）；会话事件里与工具有关的四条是 `tool/call`、
 * `tool/result`、`tool/ptc-dispatch-start`、`tool/ptc-dispatch`（磁盘格式 v2→v3 会把 ptc 写成 code，
 * 所以四个 code 旧名也要认）。只有「结果」形态才可能产生前两档；`tool/call` 与 `*-start` 是调用刚开始，
 * 没有成功与否的信息，一律走第三档。Windows 上执行命令的工具名是 `pwsh`。
 */
import type { DetectInput, DetectResult, DetectTier, EventAction, WriteDetectLimits } from './ports.js'

/** 这份文件定义在哪个文件里。产物里留着它，用来证明「产物确实来自这份源码」。 */
export const WRITE_DETECT_SOURCE = 'refresh-core/src/write-detect.ts'

/** 三档（字面就是账本与日志里记的档名，只许加、不许改字面）；数组次序就是「谁更重」。 */
export const TIERS: readonly DetectTier[] = ['write-confirmed', 'probe-now', 'default-tick']

/** 原因代号表：左边代号（会进日志与界面），右边给第一次读的人看的一整句大白话。代号只许加不许改字面。 */
export const DETECT_REASONS: Readonly<Record<string, string>> = {
  'shape.not-a-result': '这不是一次调用的结果（调用刚开始，或认不出的形态）：按兜底节拍走，不据它触发取数',
  'not-succeeded': '这次调用没有成功：失败的命令什么都没改，不触发取数',
  'tool.deck-write': '我们自己的写工具被调用了：参数里直接带票号，立刻补那一行',
  'tool.deck-write-unknown-ticket': '我们自己的写工具成功了，但参数里没有可用的票号：立刻探一次，变了才补行',
  'tool.deck-read': '我们自己的读工具：只看不写，不触发取数',
  'tool.web-fetch': '联网抓取工具（WebFetch 这一类）：可能带着写意图，立刻探一次',
  'tool.local-read': '已知只读的本地工具：不触发取数',
  'tool.unknown': '认不出的工具：默认立刻探一次（宁可多探，不许漏）',
  'cmd.unparsed': '命令工具成功了却拿不到命令行：认不出它做了什么，立刻探一次',
  'cmd.cli-write': 'gh / glab 的写子命令：立刻补那一行',
  'cmd.cli-write-unknown-ticket': 'gh / glab 的写子命令成功了，但命令行里没有票号：立刻探一次，变了才补行',
  'cmd.cli-read': 'gh / glab 的读子命令：只看不写，不触发取数',
  'cmd.cli-help': 'gh 的求助或版本输出：什么都没做，不触发取数',
  'cmd.api-write': 'gh api 带写方法（-X POST/PATCH/PUT/DELETE、-f、--input）：立刻补那一行',
  'cmd.api-graphql-mutation': 'gh api graphql 里出现 mutation：那是写，但票号认不出，立刻探一次',
  'cmd.api-graphql-unknown': 'gh api graphql 里没有 mutation 字样：认不出是读是写，立刻探一次（不丢弃）',
  'cmd.api-read': 'gh api 是 GET 读：不触发取数',
  'cmd.cli-unknown': 'gh / glab 的子命令认不出在读还是写：立刻探一次',
  'cmd.git-push': 'git push：把本地提交送出去了，远端可能刚变，立刻探一次',
  'cmd.git-local': 'git 的本地子命令（不是 push）：不触发取数',
  'cmd.script': '脚本或解释器（node / python / npm run 这一类）：里面干了什么看不出来，立刻探一次',
  'cmd.remote-client': '远端客户端（curl / wget / ssh 这一类）：可能直接打了接口，立刻探一次',
  'cmd.file-write': '这一行里有重定向或写文件（> / >> / Out-File / Set-Content）：可能改到了票文件，立刻探一次',
  'cmd.local-read': '已知只读的本地命令：不触发取数',
  'cmd.unknown': '认不出的命令：默认立刻探一次（宁可多探，不许漏）',
}

/** 长名单一律写成「逗号分隔一串」，不写成数组字面量：产物里的数组会被转译成一行一项，白占几十行。 */
function LIST(s: string): readonly string[] { return s.split(',') }

/** 「调用已经收尾」的形态：只有这些能回答「成功了吗」（四个 code 旧名与 ptc 同义）。 */
const RESULT_SHAPES = LIST('tools/result,tool/result,tool/ptc-dispatch,tool/code-dispatch')
/** 「调用刚开始」的形态：没有结果，不触发取数。 */
const START_SHAPES = LIST('tool/call,tool/ptc-dispatch-start,tool/code-dispatch-start')

/** 这次事件的形态是不是「一次调用的结果」。宿主侧按它决定订哪几条。 */
export function isResultShape(shape: string): boolean {
  return RESULT_SHAPES.indexOf(String(shape)) >= 0
}

// ---------- 工具名表（先看工具名，再看命令） ----------
/** 我们自己的写工具（票 #713 那七个薄壳里会改远端的那四个）。 */
const DECK_WRITE_TOOLS = LIST('deck_issue_create,deck_issue_patch,deck_map_plan_create,deck_map_link')
/** 我们自己的读工具（另三个只看不写）。 */
const DECK_READ_TOOLS = LIST('deck_context,deck_issue_get,deck_map_snapshot')
/** 我们自己的工具参数里可能装着票号的字段名（按顺序取第一个像票号的）。 */
const TICKET_ARG_FIELDS = LIST('issue,number,ticket,key,id,child,parent')
/** 联网抓取类工具：可能带着写意图，按「可疑」处理。 */
const WEB_FETCH_TOOLS = LIST('webfetch,web_fetch,fetch,webfetchtool,fetchurl')
/** 执行命令的工具（Windows 上是 pwsh；bash 只在非 Windows 出现）。 */
const SHELL_TOOLS = LIST('pwsh,powershell,bash,sh,zsh,cmd,shell')
/** 已知只读的本地工具（看、搜、问、算）：它们在本地改不了工单仓库。 */
const LOCAL_READ_TOOLS = LIST('read,readfile,glob,grep,search,ls,list,listfiles,askuserquestion,ask_user_question,todowrite,todo_write,websearch,web_search,skill,vision_describe,vision_ocr,vision_crop')
/** 第三方终端工具（本机 better-sidebar 带来的 terminal_* 一族）参数字段形状不遵循 command 约定，
 * 产品上是否纳入写判定另说；它们不在这几张表里，就会走「认不出的工具 → 立刻探一次」那条最保守的路。 */

// ---------- 命令行表（只做首词与子命令匹配） ----------
/** 段与段的分隔：管道、逻辑连接、分号、换行。一段一段看，绝不把整条命令行当一个字符串扫。 */
const SEGMENT_SPLIT_RE = /&&|\|\||[;|\n\r]|(?<![&>])&(?![&>])/g
/** 认得出「它只会看」的本地命令首词。 */
const LOCAL_READ_HEADS = LIST('ls,dir,pwd,cd,cat,type,get-content,get-childitem,head,tail,wc,grep,rg,select-string,find,test-path,which,get-command,echo,write-output,write-host,date,get-date,whoami,tree,stat,du,df,printenv,get-item,resolve-path')
/** 脚本与解释器：里面干了什么看不出来，一律按「可疑」。注意这些名字也有「只看一眼」的用法（`node -v`），
 * 宁可多探一次，也不去猜它的参数。 */
const SCRIPT_HEADS = LIST('node,deno,bun,npx,npm,pnpm,yarn,python,python3,py,ruby,perl,php,make,just,cargo,go,dotnet,java,mvn,gradle,docker,kubectl,terraform,ansible,pwsh,powershell,bash,sh,zsh,cmd')
/** 远端客户端：可能直接打了接口，一律按「可疑」。 */
const REMOTE_HEADS = LIST('curl,wget,irm,iwr,invoke-restmethod,invoke-webrequest,http,https,httpie,ssh,scp,sftp,rsync,nc,telnet')
/** 写文件的形状：出现这些就当「可能改到了票文件」（本地 Markdown 后端的票就是文件）。 */
const FILE_WRITE_RE = /(^|[\s;|&])(>>?|out-file|set-content|add-content|tee)([\s;|&]|$)/i

/** 子命令词算不算写（w 写 / r 读 / x 是本地动作，既不读也不写远端）。缺失的一律按「认不出」处理。 */
const CLI_SCOPES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  issue: { create: 'w', close: 'w', reopen: 'w', comment: 'w', edit: 'w', delete: 'w', lock: 'w', unlock: 'w', transfer: 'w', pin: 'w', unpin: 'w', develop: 'w', list: 'r', view: 'r', status: 'r' },
  pr: { create: 'w', close: 'w', reopen: 'w', merge: 'w', comment: 'w', edit: 'w', review: 'w', ready: 'w', lock: 'w', unlock: 'w', revert: 'w', list: 'r', view: 'r', status: 'r', diff: 'r', checks: 'r', checkout: 'x' },
  mr: { create: 'w', close: 'w', reopen: 'w', merge: 'w', comment: 'w', note: 'w', edit: 'w', update: 'w', approve: 'w', revoke: 'w', delete: 'w', list: 'r', view: 'r', diff: 'r', checkout: 'x' },
  label: { create: 'w', edit: 'w', delete: 'w', clone: 'w', list: 'r' },
  milestone: { create: 'w', edit: 'w', delete: 'w', close: 'w', reopen: 'w', list: 'r', view: 'r' },
  release: { create: 'w', edit: 'w', delete: 'w', upload: 'w', download: 'r', list: 'r', view: 'r' },
  repo: { create: 'w', edit: 'w', delete: 'w', rename: 'w', archive: 'w', unarchive: 'w', fork: 'w', sync: 'w', list: 'r', view: 'r' },
  gist: { create: 'w', edit: 'w', delete: 'w', list: 'r', view: 'r' },
  project: { create: 'w', edit: 'w', delete: 'w', close: 'w', copy: 'w', link: 'w', unlink: 'w', 'item-add': 'w', 'item-edit': 'w', 'item-archive': 'w', 'field-create': 'w', 'field-delete': 'w', list: 'r', view: 'r' },
  run: { cancel: 'w', rerun: 'w', delete: 'w', list: 'r', view: 'r', watch: 'r' },
  workflow: { enable: 'w', disable: 'w', list: 'r', view: 'r' },
  secret: { set: 'w', delete: 'w', list: 'r' },
  variable: { set: 'w', delete: 'w', list: 'r' },
  'ssh-key': { add: 'w', delete: 'w', list: 'r' },
  config: { set: 'w', unset: 'w', get: 'r', list: 'r' },
  alias: { set: 'w', delete: 'w', list: 'r' },
  auth: { login: 'w', logout: 'w', switch: 'w', refresh: 'w', 'setup-git': 'w', status: 'r', token: 'r' },
  extension: { install: 'w', remove: 'w', upgrade: 'w', list: 'r' },
}
/** 求助与版本：什么都没做。 */
const CLI_HELP_WORDS = LIST('help,version,--help,-h,--version,completion')
/** 认得出「它要带一个值」的选项：它后面那个词是值，不是位置参数（值不可能是票号）。只列常用的。
 * `-C` / `--git-dir` / `--work-tree` 这几个是 git 的全局选项：`git -C <目录> push` 里那个目录不能当子命令。 */
const OPTION_TAKES_VALUE = LIST('-b,--body,-t,--title,-l,--label,--add-label,--remove-label,-m,--message,-F,--body-file,-R,--repo,-q,--jq,--template,-f,--field,--raw-field,--input,-X,--method,-H,--header,-a,--assignee,--add-assignee,--remove-assignee,-r,--reason,-c,--comment,--state,--milestone,--project,--type,-e,--editor,-d,--description,-p,--path,-n,--name,--color,--due-date,--query,--search,--limit,--sort,--order,--json,--interval,--timeout,--closes,--match-head-commit,-C,--git-dir,--work-tree,--namespace,--exec-path')

// ---------- 小工具（纯字符串，不碰环境） ----------
/** 去引号：`"gh"` → `gh`。 */
function unquote(tok: string): string {
  const s = String(tok || '')
  const q = s.charAt(0)
  return (s.length >= 2 && (q === '"' || q === "'" || q === '`') && s.charAt(s.length - 1) === q) ? s.slice(1, -1) : s
}

/** 把一条命令切成记号：引号里的东西连成一块（`--body "见 #34"` 因此不会吐出一个假票号）。 */
function tokenize(segment: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < segment.length; i++) {
    const c = segment.charAt(i)
    if (quote) { if (c === quote) quote = ''; else cur += c; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === ' ' || c === '\t') { if (cur) { out.push(cur); cur = '' } continue }
    if (c === '(' || c === '{' || c === ')' || c === '}') { if (cur) { out.push(cur); cur = '' } continue }
    cur += c
  }
  return cur ? out.concat(cur) : out
}

/** 首词归一：去掉目录与可执行后缀（`D:\x\gh.cmd` → `gh`），再去引号、转小写。 */
function headWord(tok: string): string {
  let s = unquote(tok || '')
  const cut = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (cut >= 0) s = s.slice(cut + 1)
  s = s.toLowerCase()
  for (const ext of ['.exe', '.cmd', '.bat', '.ps1', '.com']) if (s.length > ext.length && s.endsWith(ext)) { s = s.slice(0, -ext.length); break }
  return s
}

/** 位置参数：不以 `-` 开头，且不是「认得出的带值选项」后面那个跟着的值。 */
function positionalsOf(tokens: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.charAt(0) === '-') {
      const eq = t.indexOf('=')
      if (eq < 0 && OPTION_TAKES_VALUE.indexOf(t) >= 0) i += 1
      continue
    }
    if (OPTION_TAKES_VALUE.indexOf(t) >= 0) { i += 1; continue }
    out.push(t)
  }
  return out
}

/** 看起来像票号吗：`12`、`#12`、issue / pull 链接。除此之外一律不算。 */
function ticketLike(tok: string): string | null {
  const s = unquote(String(tok || '')).trim()
  if (/^#?\d{1,10}$/.test(s)) return s.replace(/^#/, '')
  const url = /^https?:\/\/[^\s]+\/(?:issues|pulls|pull|merge_requests)\/(\d{1,10})(?:[/?#].*)?$/i.exec(s)
  return url ? url[1] : null
}

/** 命令行里的票号：只认「动词之后第一个位置参数」，取不到就 null（未知），绝不往下翻。 */
function ticketFromCommand(tokens: string[]): string | null {
  const pos = positionalsOf(tokens)
  return pos.length > 0 ? ticketLike(pos[0]) : null
}

// ---------- 分段判定 ----------
interface SegmentVerdict { tier: DetectTier; ticket: string | null; reason: string }

/** 一段命令行读成三档。 */
function readSegment(segment: string): SegmentVerdict {
  const tokens = tokenize(segment)
  if (tokens.length === 0) return { tier: 'default-tick', ticket: null, reason: 'cmd.local-read' }
  if (FILE_WRITE_RE.test(' ' + segment + ' ')) return { tier: 'probe-now', ticket: null, reason: 'cmd.file-write' }
  const head = headWord(tokens[0])
  const rest = tokens.slice(1)
  if (head === 'gh' || head === 'glab') return readCli(head, rest)
  if (head === 'git') {
    const pos = positionalsOf(rest)
    if (pos.length > 0 && unquote(pos[0]).toLowerCase() === 'push') return { tier: 'probe-now', ticket: null, reason: 'cmd.git-push' }
    return { tier: 'default-tick', ticket: null, reason: 'cmd.git-local' }
  }
  if (SCRIPT_HEADS.indexOf(head) >= 0) return { tier: 'probe-now', ticket: null, reason: 'cmd.script' }
  if (REMOTE_HEADS.indexOf(head) >= 0) return { tier: 'probe-now', ticket: null, reason: 'cmd.remote-client' }
  if (LOCAL_READ_HEADS.indexOf(head) >= 0) return { tier: 'default-tick', ticket: null, reason: 'cmd.local-read' }
  return { tier: 'probe-now', ticket: null, reason: 'cmd.unknown' }
}

/** `gh` / `glab`：看子命令，不看别的。 */
function readCli(head: string, rest: string[]): SegmentVerdict {
  const scopeRaw = rest.length > 0 ? unquote(rest[0]).toLowerCase() : ''
  if (scopeRaw === 'api') return readApi(rest.slice(1))
  if (CLI_HELP_WORDS.indexOf(scopeRaw) >= 0 || rest.some((t) => t === '--help' || t === '-h')) {
    return { tier: 'default-tick', ticket: null, reason: 'cmd.cli-help' }
  }
  const verbRaw = rest.length > 1 ? unquote(rest[1]).toLowerCase() : ''
  const scope = CLI_SCOPES[scopeRaw]
  if (!scope || !verbRaw) return { tier: 'probe-now', ticket: null, reason: 'cmd.cli-unknown' }
  const kind = scope[verbRaw.replace(/^--?/, '')]
  if (kind === 'r') return { tier: 'default-tick', ticket: null, reason: 'cmd.cli-read' }
  if (kind !== 'w') return { tier: 'probe-now', ticket: null, reason: 'cmd.cli-unknown' }
  const ticket = ticketFromCommand(rest.slice(2))
  return { tier: 'write-confirmed', ticket: ticket, reason: ticket ? 'cmd.cli-write' : 'cmd.cli-write-unknown-ticket' }
}

/**
 * `gh api` / `glab api`：判定表里最难的形态——它**没有写动词**，`gh api graphql -f query=...` 是读还是写
 * 只能从正文里有没有 `mutation` 看出来，而命令行里任何位置都可能出现那个词。认不出来时按「可疑」处理。
 */
function readApi(rest: string[]): SegmentVerdict {
  if (rest.some((t) => unquote(t).toLowerCase() === 'graphql')) {
    const text = rest.join(' ').toLowerCase()
    if (/(^|[^a-z])mutation([^a-z]|$)/.test(text)) return { tier: 'write-confirmed', ticket: null, reason: 'cmd.api-graphql-mutation' }
    return { tier: 'probe-now', ticket: null, reason: 'cmd.api-graphql-unknown' }
  }
  const method = methodOf(rest)
  const pos = positionalsOf(rest)
  if (pos.length === 0) return { tier: 'probe-now', ticket: null, reason: 'cmd.cli-unknown' }
  const hit = /(?:issues|pulls|merge_requests)\/(\d{1,10})(?:[/?#]|$)/i.exec(unquote(pos[0]))
  const ticket = hit ? hit[1] : null
  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    return { tier: 'write-confirmed', ticket: ticket, reason: 'cmd.api-write' }
  }
  if (method === '') return { tier: 'probe-now', ticket: null, reason: 'cmd.cli-unknown' }
  return { tier: 'default-tick', ticket: null, reason: 'cmd.api-read' }
}

/** 这一行显式写了什么方法：`-f` / `--field` / `--input` 在 gh 里就等于「带请求体」，那也是写。 */
function methodOf(rest: string[]): string {
  for (let i = 0; i < rest.length; i++) {
    const t = unquote(rest[i])
    const eq = /^--method=(.*)$/.exec(t) || /^-X(.*)$/.exec(t)
    if (eq && eq[1]) return eq[1].toUpperCase()
    if (t === '--method' || t === '-X') return rest[i + 1] ? unquote(rest[i + 1]).toUpperCase() : 'GET'
  }
  if (rest.some((t) => ['-f', '--field', '-F', '--raw-field', '--input'].indexOf(t) >= 0)) return 'POST'
  return 'GET'
}

// ---------- 判定本体 ----------
/**
 * 一次工具调用的判定。入参里的命令行原文只在这一层做瞬时匹配，出参里一个字符都不带。
 * @param input shape 事件形态、tool 工具名、command 已解析出来的命令行、args 结构化参数（
 *   `tools/result` 的 `exec.arguments` 已经是对象）、succeeded 这次调用成功了没有
 */
export function detectWrite(input: DetectInput): DetectResult {
  const shape = String((input && input.shape) || '')
  if (START_SHAPES.indexOf(shape) >= 0 || !isResultShape(shape)) return { tier: 'default-tick', ticket: null, reason: 'shape.not-a-result' }
  // 只认成功：结果没说是成功（undefined / null）也当没成功，由兜底节拍去补。
  if (!input || input.succeeded !== true) return { tier: 'default-tick', ticket: null, reason: 'not-succeeded' }
  const tool = String(input.tool || '')
  const toolKey = tool.toLowerCase()
  if (DECK_WRITE_TOOLS.indexOf(tool) >= 0 || DECK_WRITE_TOOLS.indexOf(toolKey) >= 0) {
    const ticket = ticketFromArgs(input.args)
    return { tier: 'write-confirmed', ticket: ticket, reason: ticket ? 'tool.deck-write' : 'tool.deck-write-unknown-ticket' }
  }
  if (DECK_READ_TOOLS.indexOf(tool) >= 0 || DECK_READ_TOOLS.indexOf(toolKey) >= 0) return { tier: 'default-tick', ticket: null, reason: 'tool.deck-read' }
  if (WEB_FETCH_TOOLS.indexOf(toolKey) >= 0) return { tier: 'probe-now', ticket: null, reason: 'tool.web-fetch' }
  if (LOCAL_READ_TOOLS.indexOf(toolKey) >= 0) return { tier: 'default-tick', ticket: null, reason: 'tool.local-read' }
  const command = (input.command == null) ? '' : String(input.command)
  if (SHELL_TOOLS.indexOf(toolKey) >= 0) {
    if (!command.trim()) return { tier: 'probe-now', ticket: null, reason: 'cmd.unparsed' }
    return readCommand(command)
  }
  // 其它工具（含第三方注册的、带命令行的）：有命令行就照命令判定，没有就按「认不出的工具」立刻探一次。
  if (command.trim()) return readCommand(command)
  return { tier: 'probe-now', ticket: null, reason: 'tool.unknown' }
}

/** 一条命令行判成三档：一段一段看，取最重的一档；票号取第一个认出来的。 */
export function readCommand(command: string): DetectResult {
  const segments = String(command || '').split(SEGMENT_SPLIT_RE)
  let best: SegmentVerdict | null = null
  let ticket: string | null = null
  for (const seg of segments) {
    if (!seg || !seg.trim()) continue
    const v = readSegment(seg)
    if (v.ticket && !ticket) ticket = v.ticket
    if (!best || TIERS.indexOf(v.tier) < TIERS.indexOf(best.tier)) best = v
  }
  if (!best) return { tier: 'default-tick', ticket: null, reason: 'cmd.local-read' }
  return { tier: best.tier, ticket: ticket, reason: best.reason }
}

/** 我们自己的工具：票号只从具名参数取，且必须长得像票号；取不到就是未知。 */
function ticketFromArgs(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const bag = args as Record<string, unknown>
  for (const field of TICKET_ARG_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(bag, field)) continue
    const v = bag[field]
    if (typeof v === 'number' && isFinite(v)) return String(Math.floor(v))
    const t = (typeof v === 'string') ? ticketLike(v) : null
    if (t) return t
  }
  return null
}

/**
 * 三档各自要做什么。数字全部由调用方从 budget.ts 取好传进来（PATCH_MERGE_WINDOW_MS 与
 * PROBE_INTERVAL_MS），本文件一个额度数字都不写——与 policy.ts 同一条纪律。
 * 「确定写但票号未知」要降成「立刻探测」：补行得指名道姓改哪一行，说不出票号就没法只补那一行，
 * 这时先探一次、再看哪几条变了（探一次仍比整池重建便宜得多）。
 */
export function actionFor(result: DetectResult, limits: WriteDetectLimits): EventAction {
  const mergeWindowMs = (limits && isFinite(limits.mergeWindowMs)) ? limits.mergeWindowMs : 0
  const probeIntervalMs = (limits && isFinite(limits.probeIntervalMs)) ? limits.probeIntervalMs : 0
  const tier = (result && result.tier) ? result.tier : 'default-tick'
  if (tier === 'write-confirmed' && result.ticket) return { action: 'patch-now', ticket: result.ticket, waitMs: mergeWindowMs, mergeWindowMs: mergeWindowMs }
  if (tier === 'write-confirmed' || tier === 'probe-now') return { action: 'probe-now', ticket: null, waitMs: mergeWindowMs, mergeWindowMs: mergeWindowMs }
  return { action: 'wait-tick', ticket: null, waitMs: probeIntervalMs, mergeWindowMs: mergeWindowMs }
}
