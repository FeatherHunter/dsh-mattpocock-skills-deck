// scripts/lib/checklist-consistency.mts —— 清单票记录一致性判据：正文「场景总览」表 vs 评论里的场景块与批次结果。
//
// 为什么要有这个文件：#1647 之前，发布前检查只看两件事（本版清单票恰好一张、那张票已关闭），
// 票里的记录自不自洽全靠人读。真机验证时真出过「正文总览缺行」「场景计数 17/18/20 三处对不上」
// 这类问题，人得来回翻十几条评论才发现。这里把「同一份记录内部要一致」做成机器能查的判据：
//   - 正文场景总览表里的每个场景编号，评论里要有来源：场景块登记过（豁免行允许只在正文豁免表登记）；
//     评论登记过的场景，正文表里也要有一行；
//   - 每个场景两边写的最终结果要一致；通过、失败这两种结果必须在评论里有明确说法；
//   - 正文自称的总数、按结果分组的计数、发布计数，要和总览表的实际统计一致，收口评论里的计数也一样。
//
// 判据的边界（和票面写的一致）：只做结构解析与计数。证据有不有决定性、豁免该不该被主持人接受、
// 场景是不是已经验完，仍旧由人判断；这里只要求「记录自己说自己」的时候前后一致，不额外新增
// 「清单票已关闭就不能有待验证行」这类发布就绪判断。
//
// 为什么「豁免」行不强制场景块、也不强制评论里的一条明确结果：豁免的接受与否由主持人判断。
// #1628 的 995-01 由 1474-01 覆盖，正文总览里有这一行、豁免表登记了 #995，但没有独立场景块。
// 判据容忍这种写法；真正要拦的是「评论登记了、正文却漏行」「正文有行、评论里连编号都没出现过」，
// 以及「通过/失败的结果只写在正文、评论里找不到」。
//
// 为什么「作废」行同样放宽：规则文档允许把场景标「作废」并说明原因（编号不复用），作废是主持人
// 后来的决定，批次评论里留下的「未测」「阻塞」是作废前的旧结论，不能反过来说明两边不一致。
// 作废行不计入发布计数（通过/豁免/失败），也不要求有独立场景块或评论结果。
//
// 解析口径是给人看的记录，不是任意自然语言：只认模板里约定的写法——
//   场景块标题「## 场景块：<来源票号> …」、子场景「### 场景 <来源票号>-<序号>：…」、
//   批次结果「场景 <编号>（仓库 #…）：<结果>」/ Markdown 表 / 「**<编号> <结果>**」/
//   收口评论里的「通过 N / 失败 M / 豁免 K」与「N 条已登记场景 = …」；斜杠计数只读带「计数」或
//   「[发布就绪]」的计数行，分批叙述里的小计不拿来和发布总数比。
// 同一条评论里同一场景出现多个结果时（收口评论既写分批判述又写最终计数），按 RESULT_PRIORITY 取最终结论；
// 这套写法与优先级在 docs/agents/real-machine-verification.md 第二节对写票的人说明。
// 记录里用了别的写法而没被认出来时，报告会以「找不到明确结果」出现，不会静默放过。

/**
 * 一条场景的状态。取值与清单票总览表「状态」一列一致；带括号补充的写法（如「通过（条件）」）在解析时归一成本值。
 * 「作废」是规则文档允许的终态（场景不再验证，编号不复用），不计入发布计数，也不参与结果一致性判断。
 */
export type ScenarioStatus = '待验证' | '已验证' | '通过' | '失败' | '豁免' | '未测' | '阻塞' | '作废'

/** 判据能报出的问题种类；每种在 checkChecklistConsistency 里对应一处 push，code 稳定，改含义时换新值。 */
export type ConsistencyFindingCode =
  | 'missing-overview'
  | 'empty-overview'
  | 'malformed-row'
  | 'missing-scenario-block'
  | 'scenario-not-in-body'
  | 'scenario-not-registered'
  | 'missing-result'
  | 'result-mismatch'
  | 'count-mismatch'
  | 'release-count-mismatch'

/** 正文「## 场景总览」里的一行：编号、来源票、归一后的状态，以及报告里用来指位置的行号。 */
export type ScenarioRow = {
  /** 场景编号，形如 1600-01。 */
  id: string
  /** 来源票格原文，例如 #1600。 */
  source: string
  /** 归一后的状态；状态格写成「通过（条件）」「豁免（先发后验）」也算通过/豁免。 */
  status: ScenarioStatus
  /** 状态格原文，报告里引用给人看。 */
  statusText: string
  /** 正文行号（从 1 开始），报告里指位置。 */
  line: number
}

/** 判据的一条输入评论：正文，以及创建时间（用来判断哪条是同一场景的最新结论）。 */
export type ChecklistCommentInput = {
  body: string
  createdAt: string
}

/** 一处对不上：说清是哪一处、两边分别是什么、具体怎么改。 */
export type ConsistencyFinding = {
  code: ConsistencyFindingCode
  /** 一句话说清哪一处、两边分别是什么。 */
  message: string
  /** 具体怎么改，读票的人照着做就能改对。 */
  fix: string
}

/** 按状态分组的条数：每种状态各占一项，没有的记 0，避免调用方每次自己补键。 */
export type StatusCounts = Record<ScenarioStatus, number>

/** 发布口径：已验证并入「通过」（#1628 的收口评论就是这么写的），豁免、失败各算各的。 */
export type PublishCounts = {
  passed: number
  exempted: number
  failed: number
}

/** 一张清单票的核对结果：ok 为 false 时 findings 逐条列出问题，其余字段供调用方打一行摘要。 */
export type ConsistencyReport = {
  ok: boolean
  findings: ConsistencyFinding[]
  rows: ScenarioRow[]
  /** 评论里的场景块登记过的场景编号（每张来源票一条场景块，单场景块隐含 <票号>-01）。 */
  registeredIds: string[]
  publishCounts: PublishCounts
}

/** 状态的判断顺序：同一段文字里出现多个状态词时，取最先出现的那个（「判定为附条件通过」算通过）。 */
const STATUS_WORDS: ScenarioStatus[] = ['待验证', '已验证', '通过', '失败', '豁免', '未测', '阻塞', '作废']

/**
 * 必须在评论里有明确结果的状态：通过、失败是批次执行出来的结论，正文写了就得说得出是哪条评论给的。
 * 已验证（登记前验过，证据在来源票）、豁免（主持人接受，登记在正文豁免表）不强制评论结果——
 * 那是证据与接受判断，不属于「记录内部一致性」。
 */
const NEEDS_COMMENT_RESULT: ScenarioStatus[] = ['通过', '失败']

/**
 * 同一条评论里同一个场景出现多个结果时按这个优先级取一个：收口评论常把分批过程（「未测」）和最终结论
 * （「豁免」）写在一起，最终结论要压过过程；这条口径在 docs/agents/real-machine-verification.md 第二节也有写。
 */
const RESULT_PRIORITY: Record<ScenarioStatus, number> = {
  作废: 0,
  待验证: 1,
  阻塞: 2,
  未测: 3,
  已验证: 4,
  通过: 5,
  豁免: 6,
  失败: 7,
}

/** 状态词的正则写法：几处正则都从同一份列表生成，改状态集合时不会漏掉某一处。 */
const STATUS_ALTERNATION = STATUS_WORDS.join('|')

/**
 * 场景编号的形状只在这里定义一次：来源票号 3~5 位、连字符、两位序号；前后不能紧挨数字或连字符，
 * 免得把日期（2026-10-29）或更长的编号认成场景号。下面几处正则都从这三段拼出来，改形状只改这里。
 */
const SCENARIO_ID_SOURCE = '(\\d{3,5})-(\\d{2})'
const SCENARIO_ID_BEFORE = '(?<![\\d-])'
const SCENARIO_ID_AFTER = '(?![\\d-])'
/** 从一段文字里找出所有完整场景编号及其位置。 */
const ID_PATTERN = new RegExp(SCENARIO_ID_BEFORE + SCENARIO_ID_SOURCE + SCENARIO_ID_AFTER, 'g')
/** 整格恰好是一个场景编号（总览表的编号列）。 */
const EXACT_ID_PATTERN = new RegExp('^' + SCENARIO_ID_SOURCE + '$')
/** 单元格以场景编号开头（结果表首格可能跟着一句话）。 */
const ID_PREFIX_PATTERN = new RegExp('^' + SCENARIO_ID_SOURCE + SCENARIO_ID_AFTER)
/** 编号列表之间允许出现的连接物：收口评论里「…、1600-01、1599-01 为登记前已验证」这种写法。 */
const CONNECTOR_PATTERN = /^(?:[\s、，,和与及/]|为|均|都|已|全部|登记前|本版|真机)*$/u
const CLOSING_COMMENT_PATTERN = /发布就绪|验证收口|收口关闭|已登记场景/u

/** 去 Markdown 加粗与行内代码标记，只留人读的文字；编号本身不含这些字符，不会误伤。 */
function stripMarkup(text: string): string {
  return String(text || '').replace(/[*`]/g, '').trim()
}

/** 一段文字里的状态词：取最早出现的那个，一个都没有时返回 null。 */
function classifyStatus(text: string): ScenarioStatus | null {
  const source = stripMarkup(text)
  let best: { status: ScenarioStatus; at: number } | null = null
  for (const status of STATUS_WORDS) {
    const at = source.indexOf(status)
    if (at < 0) continue
    if (!best || at < best.at) best = { status, at }
  }
  return best ? best.status : null
}

/**
 * 把简写编号展开成完整编号：「1612-01/02/03」→「1612-01、1612-02、1612-03」。
 * 先展开再解析，后面的位置判断才不用为简写单独写一套。
 */
function expandShorthand(text: string): string {
  return String(text || '').replace(
    new RegExp(SCENARIO_ID_BEFORE + SCENARIO_ID_SOURCE + '((?:\\s*/\\s*\\d{2}' + SCENARIO_ID_AFTER + ')+)', 'g'),
    (_all, ticket: string, first: string, rest: string) => {
      const sequence = [first, ...rest.split('/').map((part) => part.trim())]
      return sequence.map((number) => ticket + '-' + number).join('、')
    },
  )
}

type FoundId = { id: string; start: number; end: number }

/** 找出一段文字里所有完整编号及其位置。日期（2026-10-29）与版本号不会被当成编号。 */
function findIds(text: string): FoundId[] {
  const found: FoundId[] = []
  const pattern = new RegExp(ID_PATTERN.source, 'g')
  let matched: RegExpExecArray | null
  while ((matched = pattern.exec(text)) !== null) {
    found.push({ id: matched[1] + '-' + matched[2], start: matched.index, end: matched.index + matched[0].length })
  }
  return found
}

function uniqueIds(text: string): string[] {
  return [...new Set(findIds(text).map((item) => item.id))]
}

type BodySection = { lines: string[]; startLine: number }

/** 取正文里某个二级标题下的内容，到下一个二级标题为止；找不到返回 null。 */
function findSection(body: string, headingPattern: RegExp): BodySection | null {
  const lines = String(body || '').split(/\r?\n/)
  const start = lines.findIndex((line) => headingPattern.test(line.trim()))
  if (start < 0) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index].trim())) {
      end = index
      break
    }
  }
  return { lines: lines.slice(start, end), startLine: start + 1 }
}

function splitTableRow(raw: string): string[] {
  let text = raw.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)
  return text.split('|').map((cell) => cell.trim())
}

function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')))
}

type OverviewResult = {
  rows: ScenarioRow[]
  malformed: { line: number; text: string }[]
  hasTable: boolean
}

type OverviewColumns = { id: number; source: number; status: number }

/** 表头读不出来时用的列序，与 docs/agents/checklist-issue-template.md 的模板一致。 */
const DEFAULT_OVERVIEW_COLUMNS: OverviewColumns = { id: 0, source: 1, status: 3 }

/**
 * 从表头一行认出「场景编号」「来源票」「状态」各在第几列；认不出场景编号就当这一行不是表头。
 * 不写死列号是因为模板的列序可能调整，写死会在列序改动后静默读错列、把别的单元格当状态。
 */
function overviewColumnsFrom(header: string[]): OverviewColumns | null {
  const labels = header.map((cell) => stripMarkup(cell))
  const id = labels.findIndex((label) => label.includes('场景编号'))
  if (id < 0) return null
  const source = labels.findIndex((label) => label.includes('来源票'))
  const status = labels.findIndex((label) => label.includes('状态'))
  return {
    id,
    source: source >= 0 ? source : DEFAULT_OVERVIEW_COLUMNS.source,
    status: status >= 0 ? status : DEFAULT_OVERVIEW_COLUMNS.status,
  }
}

/** 解析正文「## 场景总览」里的 Markdown 表；状态不认识的行的行号带回去，报告里指得出是哪一行。 */
function parseOverview(section: BodySection): OverviewResult {
  const result: OverviewResult = { rows: [], malformed: [], hasTable: false }
  let columns = DEFAULT_OVERVIEW_COLUMNS
  for (let index = 0; index < section.lines.length; index += 1) {
    const raw = section.lines[index].trim()
    if (!raw.startsWith('|')) continue
    result.hasTable = true
    const cells = splitTableRow(raw)
    if (cells.length < 2 || isTableSeparator(cells)) continue
    const header = overviewColumnsFrom(cells)
    if (header) {
      columns = header
      continue
    }
    const first = stripMarkup(cells[columns.id] || '')
    if (!first || first.includes('暂无')) continue
    const line = section.startLine + index
    if (!EXACT_ID_PATTERN.test(first)) {
      result.malformed.push({ line, text: first })
      continue
    }
    const statusText = stripMarkup(cells[columns.status] || '')
    const status = classifyStatus(statusText)
    if (!status) {
      result.malformed.push({ line, text: statusText || '（空）' })
      continue
    }
    result.rows.push({ id: first, source: stripMarkup(cells[columns.source] || ''), status, statusText, line })
  }
  return result
}

type ParsedComment = {
  registered: string[]
  mentioned: string[]
  results: Map<string, ScenarioStatus>
}

/** 从一段评论里取结果：支持模板里出现过的五类写法，只认明确格式，不猜散文。 */
function extractResults(commentText: string): Map<string, ScenarioStatus> {
  const results = new Map<string, ScenarioStatus>()
  const add = (ids: string[], status: ScenarioStatus): void => {
    for (const id of ids) {
      const previous = results.get(id)
      if (!previous || RESULT_PRIORITY[status] > RESULT_PRIORITY[previous]) results.set(id, status)
    }
  }
  const lines = commentText.split(/\r?\n/)

  for (const line of lines) {
    // 第一类：批次结果段落「场景 1600-02（仓库 #1600 评论 5）：通过。」
    const named = /^\s*(?:[-*]\s*)?场景\s+(.+?)\s*[:：]\s*(.+)$/u.exec(line)
    if (named) {
      const idPart = named[1].replace(/（[^）]*）/g, '')
      const status = classifyStatus(named[2])
      if (status) add(uniqueIds(idPart), status)
    }

    // 第二类：Markdown 表行，首格以编号开头、第二格是结果。
    if (line.trim().startsWith('|')) {
      const cells = splitTableRow(line)
      if (cells.length >= 2) {
        const first = stripMarkup(cells[0])
        if (ID_PREFIX_PATTERN.test(first)) {
          const status = classifyStatus(cells[1])
          if (status) add(uniqueIds(first), status)
        }
      }
    }

    // 第三类：加粗要点「- **1630-01 通过**：…」。
    const bold = /^\s*[-*]\s*\*\*([^*]+)\*\*/u.exec(line)
    if (bold) {
      const ids = uniqueIds(bold[1])
      const status = classifyStatus(bold[1])
      if (ids.length > 0 && status) add(ids, status)
    }
  }

  // 第四类：收口评论里的「通过 17 / 失败 0 / 豁免 3（场景级：995-01、1627-01、1627-02）」。
  // 括号里必须只剩编号与分隔符、编号个数与前面的数字相符，才认为这是「给这些场景的结论」；
  // 括号里夹着散文的（例如「豁免 3（995-01 由 1474-01 覆盖；…）」）不在这里认，避免把被覆盖的票算成豁免。
  const counted = new RegExp('(' + STATUS_ALTERNATION + ')\\s*(\\d+)\\s*[（(]([^）)]{0,200})[）)]', 'gu')
  let countedMatch: RegExpExecArray | null
  while ((countedMatch = counted.exec(commentText)) !== null) {
    const content = countedMatch[3]
    const ids = uniqueIds(content)
    if (ids.length === 0) continue
    const rest = content
      .replace(new RegExp(ID_PATTERN.source, 'g'), '')
      .replace(/[、，,\/\s]/g, '')
    if (!/^(?:场景级|场景编号|场景|编号)?[:：]?$/.test(rest)) continue
    if (Number(countedMatch[2]) !== ids.length) continue
    add(ids, countedMatch[1] as ScenarioStatus)
  }

  // 第五类：编号列表后面紧跟结果词，覆盖收口评论的分批判述与「…为登记前已验证」。
  // 只认「编号 + 连接物 + 结果词」：两个编号之间只能是顿号这类分隔，编号与结果词之间也只能是
  // 「为 / 登记前 / 本版 / 真机」这类连接词；中间夹了正文的（例如「…：证据在 #1474 …」）不认。
  for (const line of lines) {
    for (const segment of line.split(/[；;]/u)) {
      const ids = findIds(segment)
      if (ids.length === 0) continue
      const runs: FoundId[][] = []
      for (const item of ids) {
        const lastRun = runs[runs.length - 1]
        if (lastRun && CONNECTOR_PATTERN.test(segment.slice(lastRun[lastRun.length - 1].end, item.start))) {
          lastRun.push(item)
        } else {
          runs.push([item])
        }
      }
      for (const status of STATUS_WORDS) {
        let from = 0
        while (true) {
          const at = segment.indexOf(status, from)
          if (at < 0) break
          from = at + status.length
          for (const run of runs) {
            if (run[run.length - 1].end > at) continue
            if (CONNECTOR_PATTERN.test(segment.slice(run[run.length - 1].end, at))) {
              add(run.map((item) => item.id), status)
            }
          }
        }
      }
    }
  }

  return results
}

/** 解析评论：场景块登记了哪些编号、整段评论提到过哪些编号、每条评论给出的结果。 */
function parseComment(comment: ChecklistCommentInput): ParsedComment {
  const text = expandShorthand(String(comment.body || ''))
  const lines = text.split(/\r?\n/)
  const tickets: string[] = []
  // 场景块标题里写的是来源票号（不是场景编号），单独一个三位到五位数字，所以不复用场景编号的常量。
  for (const line of lines) {
    const heading = /^#{2,6}\s*场景块[:：]\s*#?(\d{3,5})(?!\d)/.exec(line.trim())
    if (heading) tickets.push(heading[1])
  }
  const registered: string[] = []
  if (tickets.length > 0) {
    const explicit = [...text.matchAll(new RegExp('^#{2,6}\\s*场景\\s+(' + SCENARIO_ID_SOURCE + ')' + SCENARIO_ID_AFTER, 'gm'))].map((matched) => matched[1])
    if (explicit.length > 0) registered.push(...explicit)
    else for (const ticket of tickets) registered.push(ticket + '-01')
  }
  return { registered, mentioned: uniqueIds(text), results: extractResults(text) }
}

type CommentAnalysis = {
  registeredIds: string[]
  mentionedIds: string[]
  latestResults: Map<string, ScenarioStatus>
  closing: ChecklistCommentInput[]
}

function analyzeComments(comments: ChecklistCommentInput[]): CommentAnalysis {
  const sorted = [...comments].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
  const registeredIds = new Set<string>()
  const mentionedIds = new Set<string>()
  const latestResults = new Map<string, ScenarioStatus>()
  const closing: ChecklistCommentInput[] = []
  for (const comment of sorted) {
    const parsed = parseComment(comment)
    for (const id of parsed.registered) registeredIds.add(id)
    for (const id of parsed.mentioned) mentionedIds.add(id)
    for (const [id, status] of parsed.results) latestResults.set(id, status)
    const text = String(comment.body || '')
    if (CLOSING_COMMENT_PATTERN.test(text)) closing.push({ body: text, createdAt: String(comment.createdAt) })
  }
  return {
    registeredIds: [...registeredIds].sort(),
    mentionedIds: [...mentionedIds].sort(),
    latestResults,
    closing,
  }
}

function countStatuses(rows: ScenarioRow[]): StatusCounts {
  const counts = {} as StatusCounts
  for (const status of STATUS_WORDS) counts[status] = 0
  for (const row of rows) counts[row.status] += 1
  return counts
}

/** 正文里写出的自称计数：总数、来源票数、按结果分组的条数。只收明确写法，找不到就不查这一条。 */
type BodyClaims = {
  total: number[]
  sources: number[]
  groups: { status: ScenarioStatus; count: number }[]
}

function readBodyClaims(body: string): BodyClaims {
  const total: number[] = []
  for (const matched of body.matchAll(/(\d+)\s*条场景/g)) total.push(Number(matched[1]))
  const sources: number[] = []
  for (const matched of body.matchAll(/(\d+)\s*张来源票/g)) sources.push(Number(matched[1]))
  const groups: { status: ScenarioStatus; count: number }[] = []
  for (const matched of body.matchAll(new RegExp('(\\d+)\\s*条「(' + STATUS_ALTERNATION + ')」', 'g'))) {
    groups.push({ status: matched[2] as ScenarioStatus, count: Number(matched[1]) })
  }
  return { total, sources, groups }
}

/** 带「通过 N / 失败 M / 豁免 K」这种斜杠分隔计数的段落，返回每一段里的状态与数字。 */
function readSlashCounts(text: string): { status: string; count: number }[] {
  const found: { status: string; count: number }[] = []
  const runPattern = new RegExp('(?:' + STATUS_ALTERNATION + ')\\s*\\d+(?:\\s*/\\s*(?:' + STATUS_ALTERNATION + ')\\s*\\d+)+', 'g')
  for (const run of text.matchAll(runPattern)) {
    for (const pair of run[0].matchAll(new RegExp('(' + STATUS_ALTERNATION + ')\\s*(\\d+)', 'g'))) {
      found.push({ status: pair[1], count: Number(pair[2]) })
    }
  }
  return found
}

function expectedPublishCount(status: string, counts: StatusCounts): number | null {
  if (status === '通过') return counts.通过 + counts.已验证
  if (status === '豁免') return counts.豁免
  if (status === '失败') return counts.失败
  if (status === '未测') return counts.未测
  if (status === '已验证') return counts.已验证
  // 作废不计入发布计数；待验证、阻塞本身还没结论。这几种状态没有可比的发布总数。
  return null
}

function sourceTicketOf(source: string): string {
  return stripMarkup(source).replace(/^#/, '')
}

/** 一段要核对发布计数的文字：来自正文哪一节或哪条评论，以及改法里怎么指回它。 */
type CountSource = { where: string; text: string; fixTail: string }

/**
 * 收口评论里参与发布计数核对的文字：只取带「计数」或「[发布就绪]」的计数行。
 * 收口评论常把分批小计写在同一段里（如「第 1 批：通过 1 / 失败 0」），那是批次口径，
 * 拿来和发布总数比会把正确记录误报成不一致；正文「## 发布前对账」本来就是整节对账，不经过这层过滤。
 */
function closingCountLines(body: string): string {
  return String(body || '')
    .split(/\r?\n/)
    .filter((line) => line.includes('计数') || line.includes('[发布就绪]'))
    .join('\n')
}

/**
 * 核对一段文字里的「通过 N / 失败 M / 豁免 K」计数。正文「## 发布前对账」与收口评论各是一段来源，
 * 用同一个函数比对，避免两边各写一遍、日后改一处漏一处。
 */
function collectSlashCountFindings(sources: CountSource[], counts: StatusCounts): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = []
  for (const source of sources) {
    for (const pair of readSlashCounts(source.text)) {
      const expected = expectedPublishCount(pair.status, counts)
      if (expected === null || expected === pair.count) continue
      findings.push({
        code: 'release-count-mismatch',
        message: '发布计数对不上：' + source.where + '写「' + pair.status + ' ' + pair.count + '」，按场景总览表统计应为 ' + expected + '。',
        fix: '按总览表重新统计通过/失败/豁免（已验证并入通过），' + source.fixTail,
      })
    }
  }
  return findings
}

/** 核对收口评论「依据」一段里的四句自称计数：N 条已登记场景 / 登记前已验证 / 本版真机通过 / 豁免。 */
function collectSealClaimFindings(closing: ChecklistCommentInput[], rows: ScenarioRow[], counts: StatusCounts): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = []
  const claimPatterns: { pattern: RegExp; label: string; expected: number }[] = [
    { pattern: /(\d+)\s*条已登记场景/g, label: '已登记场景', expected: rows.length },
    { pattern: /(\d+)\s*条登记前已验证/g, label: '已验证', expected: counts.已验证 },
    { pattern: /(\d+)\s*条本版真机通过/g, label: '通过', expected: counts.通过 },
    { pattern: /(\d+)\s*条豁免/g, label: '豁免', expected: counts.豁免 },
  ]
  for (const comment of closing) {
    for (const claim of claimPatterns) {
      for (const matched of comment.body.matchAll(claim.pattern)) {
        const claimed = Number(matched[1])
        if (claimed === claim.expected) continue
        findings.push({
          code: 'release-count-mismatch',
          message: '发布计数对不上：收口评论写「' + claimed + ' 条' + claim.label + '」，按场景总览表统计应为 ' + claim.expected + ' 条。',
          fix: '按总览表重新统计，改正收口评论里的「依据」一段，并同步正文「## 发布前对账」。',
        })
      }
    }
  }
  return findings
}

/**
 * 核对一张清单票正文与评论是否自洽。报告里的 finding 按固定顺序排列：结构问题、编号集合问题、
 * 状态问题、计数问题；同一条问题只报一次，消息里写清两边分别是什么。
 */
export function checkChecklistConsistency(input: { body: string; comments: ChecklistCommentInput[] }): ConsistencyReport {
  const body = String(input.body || '')
  const findings: ConsistencyFinding[] = []
  const overview = findSection(body, /^##\s*场景总览/)
  const emptyReport = (): ConsistencyReport => ({
    ok: false,
    findings,
    rows: [],
    registeredIds: [],
    publishCounts: { passed: 0, exempted: 0, failed: 0 },
  })

  if (!overview) {
    findings.push({
      code: 'missing-overview',
      message: '清单票正文里找不到「## 场景总览」这一节，没法核对场景记录。',
      fix: '按 docs/agents/checklist-issue-template.md 的模板，在正文「## 规则」与「## 豁免」之间加回「## 场景总览」表，逐条登记本版场景。',
    })
    return emptyReport()
  }

  const parsed = parseOverview(overview)
  for (const bad of parsed.malformed) {
    findings.push({
      code: 'malformed-row',
      message: '「## 场景总览」第 ' + bad.line + ' 行的场景编号或状态看不懂：「' + bad.text + '」。',
      fix: '场景编号写成「来源票号-两位序号」（例如 1600-01），状态只能是 ' + STATUS_WORDS.join(' / ') + '。',
    })
  }
  if (!parsed.hasTable || parsed.rows.length === 0) {
    findings.push({
      code: 'empty-overview',
      message: '「## 场景总览」表里没有任何场景行（还是「（暂无）」占位）。',
      fix: '把本版需要真机验证的场景逐条填进总览表；没有场景的版本也要在正文里说明为什么没有。',
    })
    return emptyReport()
  }

  const rows = parsed.rows
  const counts = countStatuses(rows)
  const publishCounts: PublishCounts = { passed: counts.通过 + counts.已验证, exempted: counts.豁免, failed: counts.失败 }
  const rowIds = new Set(rows.map((row) => row.id))
  const comments = analyzeComments(input.comments || [])
  const mentioned = new Set(comments.mentionedIds)
  const registered = new Set(comments.registeredIds)

  if (registered.size === 0) {
    findings.push({
      code: 'missing-scenario-block',
      message: '所有评论里都没有「场景块」：找不到标题为「场景块：<来源票号>」的评论。',
      fix: '按 docs/agents/real-machine-verification.md 的规则，在每张来源票下用「## 场景块：<来源票号> …」评论写场景明细，正文总览表再按评论登记。',
    })
  } else {
    // 有场景块时逐行核对来源：正文这一行必须由某条场景块登记过，只有批次结果提过编号不算。
    // 豁免行跳过：豁免可能由另一条场景覆盖（995-01），主持人接受登记在正文豁免表，不要求独立场景块。
    // 作废行跳过：作废是事后决定，不要求当初登记过独立场景块。
    for (const row of rows) {
      if (row.status === '豁免' || row.status === '作废' || registered.has(row.id)) continue
      findings.push({
        code: 'missing-scenario-block',
        message: '场景 ' + row.id + ' 在正文总览里有（第 ' + row.line + ' 行），但评论里没有登记它的场景块（只在别处提过编号）。',
        fix: '在来源票 #' + row.id.split('-')[0] + ' 下补一条「## 场景块：<来源票号> …」评论，写明 ' + row.id + ' 的步骤、预期与结果；总览这一行要有场景块做来源。',
      })
    }
  }

  // 编号集合：评论登记/给出结果、正文却没有行 → 正文缺行；正文有行、评论从没出现过 → 正文这一行无来源。
  // 用「评论里出现过」而不是「只在场景块里登记过」判断后者，是为了容忍 995-01 这种由别的场景覆盖的豁免。
  const resultIds = new Set([...comments.latestResults.keys()])
  const missingFromBody = [...new Set([...registered, ...resultIds])].filter((id) => !rowIds.has(id)).sort()
  for (const id of missingFromBody) {
    const source = id.split('-')[0]
    findings.push({
      code: 'scenario-not-in-body',
      message: '评论里登记了场景 ' + id + '（来源票 #' + source + '），但正文「## 场景总览」没有这一行。',
      fix: '在总览表补上 ' + id + '，来源票写 #' + source + '，状态与评论里最新批次结果一致。',
    })
  }
  // 豁免行不要求评论里出现编号：豁免的登记与接受在正文「## 豁免」表，评论里可以没有独立场景块（995-01）。
  // 作废行同样不要求：作废记录可以只留在正文总览里。
  const notMentioned = rows.filter((row) => row.status !== '豁免' && row.status !== '作废' && !mentioned.has(row.id))
  for (const row of notMentioned) {
    findings.push({
      code: 'scenario-not-registered',
      message: '正文总览表有场景 ' + row.id + '（第 ' + row.line + ' 行），但所有评论里都没出现过这个编号。',
      fix: '在来源票 #' + row.id.split('-')[0] + ' 的评论里补「场景块」，写明 ' + row.id + ' 的步骤与结果；总览表里的编号必须能在评论里找到。',
    })
  }

  for (const row of rows) {
    const latest = comments.latestResults.get(row.id)
    if (!latest) {
      // 只有通过/失败必须有评论结果；已验证与豁免的证据、接受由人判断，不在这里拦。
      if (NEEDS_COMMENT_RESULT.includes(row.status)) {
        findings.push({
          code: 'missing-result',
          message: '场景 ' + row.id + ' 在正文总览表里是「' + row.status + '」，但所有评论里都找不到关于它的明确结果。',
          fix: '在批次结果评论里用「场景 ' + row.id + '：<结果>」这类明确格式写出结果，或把正文状态改回「待验证」。',
        })
      }
      continue
    }
    // 作废是事后决定，评论里留下的旧结论（未测、阻塞等）与正文作废不构成不一致。
    if (row.status === '作废') continue
    // 豁免被主持人接受之前，批次评论常写「未测」「阻塞」；这些是接受前的过程结论，不当作两边不一致。
    // 真正要一致的只有「评论说通过/失败/已验证、正文也这么写」这类有验收结论的状态。
    if (row.status === '豁免' && ['待验证', '阻塞', '未测'].includes(latest)) continue
    if (latest !== row.status) {
      findings.push({
        code: 'result-mismatch',
        message: '场景 ' + row.id + ' 两边结果不一致：正文总览表写「' + row.statusText + '」，评论里最新结果写「' + latest + '」。',
        fix: '核对真机结果后把两边改成一致：先改（或补一条）评论里的结论，再改正文总览表；两边都改完再重跑发布检查。',
      })
    }
  }

  // 正文自称计数：只看「## 场景总览」这一节——「## 进度」里的数字是历史快照（例如「场景总数改为 17 条」），
  // 不能拿来和当前总览表比，否则会把已经走过的阶段当成现在的错误。
  const claims = readBodyClaims(overview.lines.join('\n'))
  const sourceCount = new Set(rows.map((row) => sourceTicketOf(row.source))).size
  for (const claimed of claims.total) {
    if (claimed !== rows.length) {
      findings.push({
        code: 'count-mismatch',
        message: '正文写「' + claimed + ' 条场景」，但「## 场景总览」表实际有 ' + rows.length + ' 行。',
        fix: '先补齐或删掉总览表的行，再按实际行数改正正文里这句总数（两处要一致）。',
      })
    }
  }
  for (const claimed of claims.sources) {
    if (claimed !== sourceCount) {
      findings.push({
        code: 'count-mismatch',
        message: '正文写「' + claimed + ' 张来源票」，但总览表实际来自 ' + sourceCount + ' 张来源票。',
        fix: '按总览表「来源票」一列去重后的数量改正正文里这句总数。',
      })
    }
  }
  for (const group of claims.groups) {
    if (group.count !== counts[group.status]) {
      findings.push({
        code: 'count-mismatch',
        message: '正文写「' + group.count + ' 条「' + group.status + '」」，但总览表实际有 ' + counts[group.status] + ' 条。',
        fix: '按总览表的实际状态统计改正这句分组计数；改完顺手检查下面发布计数有没有跟着改。',
      })
    }
  }

  // 发布计数：正文「## 发布前对账」与收口评论里的「通过 N / 失败 M / 豁免 K」都要等于总览表导出的值。
  const reconcile = findSection(body, /^##\s*发布前对账/)
  const countSources: CountSource[] = []
  if (reconcile) {
    countSources.push({
      where: '正文「## 发布前对账」',
      text: reconcile.lines.join('\n'),
      fixTail: '先统一收口评论里的计数，再改正文「## 发布前对账」。',
    })
  }
  for (const comment of comments.closing) {
    countSources.push({
      where: '收口评论',
      text: closingCountLines(comment.body),
      fixTail: '改正收口评论里的计数，并同步正文「## 发布前对账」。',
    })
  }
  findings.push(...collectSlashCountFindings(countSources, counts), ...collectSealClaimFindings(comments.closing, rows, counts))

  return {
    ok: findings.length === 0,
    findings,
    rows,
    registeredIds: comments.registeredIds,
    publishCounts,
  }
}

/** 把判据结果变成给人读的行：每条先说哪一处两边不一致，再给「改法：」。预检脚本直接逐行打印。 */
export function formatConsistencyFindings(report: ConsistencyReport): string[] {
  return report.findings.map((finding) => finding.message + ' 改法：' + finding.fix)
}
