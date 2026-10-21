/**
 * src/shared/issue-file/src/original-words.ts —— 票正文「## 维护者原话」区的读与写（唯一真源，#1091）
 *
 * 为什么住这里：维护者原话要一字不改地写进票的正文，三个后端（GitHub 的 issue body、GitLab 的
 * description、本地 Markdown 的票文件正文）共用同一个写入口；deck 工具与本地房要读同一份区，
 * 不能各留一份正则。放在 shared 层是因为 deck 与 tracker 两层都要用它，而这两层之间不能互相 import。
 *
 * 约束：纯函数——不碰 ctx、不读文件、不读钟、不引任何其它模块（shared 层同层互引同样被规则禁止）。
 * #1090 的进度区实现就在同目录另一份文件里，所以这里只复刻本区真正要用的那几件按行扫描：
 * 两份口径要一起改（tests/verify-1090 与 tests/verify-1091 都盯着各自的形状）。
 *
 * 区里的形状（写侧只产出这一种；读侧只认这一种）：
 *
 *   ## 维护者原话
 *
 *   出处：https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1088
 *   > 原话第一行
 *   > 原话第二行
 *   >
 *   > 空行照原样保留
 *
 * 每条 = 一行出处 + 紧跟的引用块；引用块的每一行以 `>` 开头，原话里的空行写成单独一行 `>`。
 * 只追加，不编辑、不删除、不排序；同一段原话 + 同一出处重复写时幂等跳过（#1089 定稿、#1091 评论）。
 * 标题固定写 `## 维护者原话`，位置紧跟 `## 目的`；没有目的区时放正文最前（跳过文件头注释与一级标题，
 * 免得把「文件头」或标题挤到区后面）。代码块、HTML 注释里的同名标题不算真的区（正文里贴一段示例时
 * 不会被改写，与进度区同一口径）。
 *
 * #1092 起这里同时是读一侧的唯一入口（`parseOriginalWords`）：deck_issue_get 与 deck_map_snapshot
 * 都把正文交给它，读回来的原话逐字不变（引用块逐行去掉一个 `>` 前缀，单独一行 `>` 还原成空行，
 * 不做 trim、不改行内空白），出处与记录时间随条目一起返回。读的规则和写侧共用同一份按行扫描，
 * 不另写一套正则——这正是这张票要的「写入与读回逐字相同」。
 */

/** 维护者原话区的标题文字（拼上 `## ` 才是完整标题行）。不导出：读写都在这份文件里，外面不需要这个字面量。 */
const ORIGINAL_WORDS_TITLE = '维护者原话'
/** 目的区的标题文字：新原话区要紧跟在它后面。 */
const PURPOSE_TITLE = '目的'
/** 写新原话区时固定写这一行标题。 */
const SECTION_HEADING = '## ' + ORIGINAL_WORDS_TITLE
/** 出处行的前缀：写侧固定用全角冒号，读侧两种冒号都认（老票可能写半角）。 */
const SOURCE_LINE_RE = /^\s*出处\s*[:：]\s*(.*)$/
/** 引用块的一行：`>` 后面最多去掉一个空格才是原话本身（写侧正是加了一个空格）。 */
const QUOTE_LINE_RE = /^\s*>(.*)$/
/** 文件头注释行：写正文最前时跳过它们（幂等锚、类型标记、父票与建票时间）。 */
const FILE_HEADER_COMMENT_RE = /^[ \t]*<!--[ \t]*(DSH-IDEMPOTENCY-KEY|DSH-ISSUE-KIND|parentKey|created)[ \t]*:/

/** 一条维护者原话：原话正文与出处。 */
export interface OriginalWordsEntry {
  /** 维护者的原话正文，一字不改（多行按换行切开后逐行写进引用块）。 */
  text: string
  /** 出处：票面完整链接、`本会话（时间）`、`路径:行号` 或提交短哈希，由调用方收口。 */
  source: string
}

/**
 * 读回来的一条维护者原话：在写入形状上多一个记录时间。
 *
 * recordedAt 只能从出处的文字里认：这张票的边界是「只加读回、不改写入」，而写入格式（出处行 + 引用块）
 * 里没有单独的时间字段，所以不能凭空多出一个来源。出处惯例里只有「本会话（2026-10-21T20:05+08:00）」
 * 这一族带时间；认不出来时是 null，不拿票的修改时间顶替——那是「票什么时候被改过」，不是「这句话什么时候说的」。
 */
export interface OriginalWordsDetailEntry extends OriginalWordsEntry {
  /** 出处里带 `T` 的 ISO 8601 时间片段，原样返回；出处没写时间时是 null。 */
  recordedAt: string | null
}

/**
 * 出处里的 ISO 8601 时间片段：只认带 `T` 的日期时间。
 *
 * 为什么日期-only 的写法（`2026-10-21`）不算：链接、路径、版本号里到处是这种日期，认了容易把
 * 「这个文件是哪天的」当成「这句话是哪天说的」，反而给了读的人一个看似确定的错答案。
 * 带不带秒、带不带时区都认；认出的片段原样返回，不重排成别的格式（这里是读出，不是改写）。
 */
const SOURCE_TIME_RE = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/

/** 从出处文字里认出记录时间；认不出返回 null（不猜、不拿别的时间顶替）。 */
function recordedAtFromSource(source: string): string | null {
  const m = SOURCE_TIME_RE.exec(source)
  return m ? m[1] : null
}

// ——— 内部的按行扫描：保留每行原换行符，写回时除目标区外一个字节都不动 ———

interface BodyLine {
  /** 行内容（不含换行符）。 */
  text: string
  /** 这一行原来的换行符：`\n`、`\r\n`、`\r`，文件末尾没有换行时是空串。 */
  eol: string
}

interface LineMark {
  /** 这一行是否落在代码围栏（``` / ~~~）里。 */
  fenced: boolean
  /** 这一行是否落在 HTML 注释里。 */
  inComment: boolean
  /** 顶层标题（围栏、注释里的不算）；不是标题时是 null。 */
  heading: { level: number; title: string } | null
}

interface Section {
  /** 标题所在行号。 */
  heading: number
  /** 区内第一行行号。 */
  contentStart: number
  /** 区结束行号（不含）：下一个顶层二级标题、顶层字段行或正文末尾。 */
  end: number
}

/** 按行切开，保留每行的换行符 —— 这样改一个区不会顺手改掉别处的 CRLF 或末尾换行。 */
function splitBodyLines(body: string): BodyLine[] {
  const out: BodyLine[] = []
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i)
    if (ch !== '\n' && ch !== '\r') continue
    let eol = '\n'
    let skip = 1
    if (ch === '\r' && body.charAt(i + 1) === '\n') { eol = '\r\n'; skip = 2 } else if (ch === '\r') { eol = '\r' }
    out.push({ text: body.slice(start, i), eol: eol })
    start = i + skip
    i = start - 1
  }
  if (start < body.length) out.push({ text: body.slice(start), eol: '' })
  return out
}

function joinBodyLines(lines: readonly BodyLine[]): string {
  let out = ''
  lines.forEach((line) => { out += line.text + line.eol })
  return out
}

/** 写回时优先沿用正文自己的换行符；空正文用 `\n`。 */
function detectEol(lines: readonly BodyLine[]): string {
  for (const line of lines) {
    if (line.eol) return line.eol
  }
  return '\n'
}

/** 标题行：最多三个前导空格、1-6 个 `#`，后面是标题文字（允许 `##维护者原话` 这种不带空格的写法）。 */
function parseHeading(text: string): { level: number; title: string } | null {
  const m = /^ {0,3}(#{1,6})([\s\S]*)$/.exec(text)
  if (!m) return null
  return { level: m[1].length, title: m[2].replace(/^[ \t]+/, '').trim() }
}

/** 顶层字段行：整份文件形态里，正文区到 Status/Type/Blocked by/Labels 为止（与进度区同一把尺子）。 */
function isFieldLine(text: string): boolean {
  return /^\s*(?:Status|Type|Blocked\s+by|Labels)\s*[:：]/.test(text)
}

/** 文件头注释行（幂等锚、类型标记、父票、建票时间）：放「正文最前」时跳过它们。 */
function isFileHeaderCommentLine(text: string): boolean {
  return FILE_HEADER_COMMENT_RE.test(text)
}

/** 逐行标出「在不在代码块/注释里」，以及能不能当顶层标题看。 */
function analyzeLines(lines: readonly BodyLine[]): LineMark[] {
  const marks: LineMark[] = []
  let fenceChar = ''
  let fenceLen = 0
  let inComment = false
  for (const line of lines) {
    const fenced = fenceLen > 0
    const heading = (!fenced && !inComment) ? parseHeading(line.text) : null
    marks.push({ fenced: fenced, inComment: inComment, heading: heading })
    if (fenced) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line.text)
      if (close && close[1].charAt(0) === fenceChar && close[1].length >= fenceLen) {
        fenceChar = ''
        fenceLen = 0
      }
      continue
    }
    if (inComment) {
      if (line.text.indexOf('-->') >= 0) inComment = false
      continue
    }
    const openComment = line.text.indexOf('<!--')
    if (openComment >= 0) {
      if (line.text.indexOf('-->', openComment + 4) < 0) inComment = true
      continue
    }
    const openFence = /^ {0,3}(`{3,}|~{3,})/.exec(line.text)
    if (openFence) { fenceChar = openFence[1].charAt(0); fenceLen = openFence[1].length }
  }
  return marks
}

/**
 * 找出所有顶层二级区块：标题文字逐字等于 target；区结束于下一个顶层标题（一、二级都算）、
 * 顶层字段行或正文末尾。三处读者（读回核对、追加、整份替换搬回）共用这一份边界判定。
 */
function findSections(lines: readonly BodyLine[], marks: readonly LineMark[], target: string): Section[] {
  const out: Section[] = []
  for (let i = 0; i < lines.length; i++) {
    const head = marks[i].heading
    if (!head || head.level !== 2 || head.title !== target) continue
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      if (marks[j].fenced || marks[j].inComment) continue
      const h = marks[j].heading
      if (h && h.level <= 2) { end = j; break }
      if (isFieldLine(lines[j].text)) { end = j; break }
    }
    out.push({ heading: i, contentStart: i + 1, end: end })
    i = end - 1
  }
  return out
}

/** 原话正文的行尾统一成 `\n`：引用块是逐行的，两种换行混在一起没法稳定切行。 */
function normalizeText(text: unknown): string {
  return String(text == null ? '' : text).replace(/\r\n?/g, '\n')
}

/** 出处收成一行（去两端空白）；出处本来就要求写成一行，多行在参数层已经被拒。 */
function normalizeSource(source: unknown): string {
  return String(source == null ? '' : source).trim()
}

/** 把一段原话正文切成引用块的各行：普通行写 `> 内容`，空行写单独一个 `>`。 */
function quoteLines(text: string): string[] {
  return normalizeText(text).split('\n').map((line) => (line === '' ? '>' : '> ' + line))
}

/**
 * 一条原话的固定写法：`出处：…` 一行，紧跟引用块。写侧只产出这一种，读侧只认这一种。
 * 不导出：写入口是 replaceOriginalWordsSection / applyOriginalWordsEntry，外面不需要自己拼。
 */
function formatOriginalWordsEntry(entry: OriginalWordsEntry): string {
  return '出处：' + normalizeSource(entry.source) + '\n' + quoteLines(entry.text).join('\n')
}

/** 把读到的出处与引用块行收成一条读侧条目：正文逐字保留，记录时间从出处里认。 */
function detailEntryOf(source: string, contentLines: readonly string[]): OriginalWordsDetailEntry {
  return { text: normalizeText(contentLines.join('\n')), source: source, recordedAt: recordedAtFromSource(source) }
}

/**
 * 从正文里读出所有维护者原话条目（按出现顺序）。代码块、注释里的示例不算。
 *
 * 这是读一侧的唯一入口（#1092）：deck_issue_get 与 deck_map_snapshot 都调它，别在工具里另写正则。
 * 读的规矩与写侧一一对应：每行引用只去掉 `>` 和紧随的一个空格（不做 trim、不改行内空格），
 * 单独一行 `>` 还原成空行；原话正文里的换行统一是 `\n`（写侧入库时就归一成这个）。
 * 出处与记录时间随条目一起返回；记录时间只从出处文字里认（见 recordedAtFromSource 的说明）。
 */
export function parseOriginalWords(body: unknown): OriginalWordsDetailEntry[] {
  const lines = splitBodyLines(body == null ? '' : String(body))
  const marks = analyzeLines(lines)
  const sections = findSections(lines, marks, ORIGINAL_WORDS_TITLE)
  const out: OriginalWordsDetailEntry[] = []
  sections.forEach((section) => {
    let current: { source: string; lines: string[] } | null = null
    for (let i = section.contentStart; i < section.end; i++) {
      if (marks[i].fenced || marks[i].inComment) continue
      const text = lines[i].text
      const sourceMatch = SOURCE_LINE_RE.exec(text)
      if (sourceMatch) {
        if (current) out.push(detailEntryOf(current.source, current.lines))
        current = { source: normalizeSource(sourceMatch[1]), lines: [] }
        continue
      }
      if (!current) continue
      const quoteMatch = QUOTE_LINE_RE.exec(text)
      if (quoteMatch) {
        let content = quoteMatch[1]
        if (content.charAt(0) === ' ') content = content.slice(1)
        current.lines.push(content)
        continue
      }
      if (text.trim() === '') continue
      // 区里出现既不是出处、也不是引用块的非空行：这条原话到这里结束，后面的行不算它的内容。
      out.push(detailEntryOf(current.source, current.lines))
      current = null
    }
    if (current) out.push(detailEntryOf(current.source, current.lines))
  })
  return out
}

/**
 * 没有维护者原话区时，新区块插到哪一行之前：
 *   1. 有 `## 目的` 区 → 紧跟它（落在它后面、下一个标题之前）；
 *   2. 否则放正文最前，但跳过文件头注释与一级标题（Markdown 票文件里那是标题，不是正文）；
 *   3. 都没有 → 正文第 0 行。
 */
function originalWordsInsertIndex(lines: readonly BodyLine[], marks: readonly LineMark[]): number {
  const purpose = findSections(lines, marks, PURPOSE_TITLE)[0]
  if (purpose) {
    let at = purpose.end
    while (at > purpose.contentStart && lines[at - 1].text.trim() === '') at--
    return at
  }
  let at = 0
  while (at < lines.length && isFileHeaderCommentLine(lines[at].text)) at++
  while (at < lines.length && lines[at].text.trim() === '') at++
  const heading = at < lines.length ? marks[at].heading : null
  if (heading && heading.level === 1) {
    at++
    while (at < lines.length && lines[at].text.trim() === '') at++
  }
  return at
}

/** 在 at 处插一段按行给的文本，并补齐与前后内容的空行分隔；末尾换行沿用原正文。 */
function insertBlock(lines: readonly BodyLine[], at: number, blockTexts: readonly string[], eol: string, tailEol: string): string {
  const block: BodyLine[] = []
  if (at > 0 && lines[at - 1].text.trim() !== '') block.push({ text: '', eol: eol })
  blockTexts.forEach((text) => block.push({ text: text, eol: eol }))
  if (at < lines.length && lines[at].text.trim() !== '') block.push({ text: '', eol: eol })
  const out = lines.slice(0, at).concat(block, lines.slice(at))
  out[out.length - 1].eol = tailEol
  return joinBodyLines(out)
}

/**
 * 把一条原话追加进正文，返回新正文（纯函数，不读文件、不碰 ctx）。
 *
 * 规则（#1089 定稿、#1091 评论）：
 *   · 有 `## 维护者原话` 区 → 追加到区末，原有条目一个字不动；
 *   · 没有 → 新建区，位置紧跟 `## 目的`；没有目的区时放正文最前（跳过文件头注释与一级标题）；
 *   · 除目标区外，其余正文按行原样拷过去（换行符也保持原样）；
 *   · 重复的原话区不合并、不重排：只往第一个区里追加（「只追加、不编辑」的边界）。
 */
export function replaceOriginalWordsSection(body: unknown, entry: OriginalWordsEntry): string {
  const source = body == null ? '' : String(body)
  const lines = splitBodyLines(source)
  const eol = lines.length ? detectEol(lines) : '\n'
  const tailEol = lines.length ? lines[lines.length - 1].eol : '\n'
  const marks = analyzeLines(lines)
  const entryLines = formatOriginalWordsEntry(entry).split('\n')
  const sections = findSections(lines, marks, ORIGINAL_WORDS_TITLE)
  if (sections.length > 0) {
    const section = sections[0]
    let at = section.end
    while (at > section.contentStart && lines[at - 1].text.trim() === '') at--
    return insertBlock(lines, at, entryLines, eol, tailEol)
  }
  const at = originalWordsInsertIndex(lines, marks)
  return insertBlock(lines, at, [SECTION_HEADING, ''].concat(entryLines), eol, tailEol)
}

/**
 * 追加一条原话，并在写前、写后各判一次长度硬顶（与进度区共用正文 60KB 硬顶，数值由调用方传入：
 * 硬顶只有一份定义，住在 progress.ts 的 PROGRESS_BODY_LIMIT；shared 层同层互引被规则禁止，
 * 所以这里不写死数字，由调用方把同一个值传进来——测试也照传，避免两处数字悄悄漂移）。
 *
 * 幂等：正文里已经有「同一段原话 + 同一出处」时回 skipped=true、next 就是原正文（调用方不要重写）。
 *
 * @returns next 是新正文；超限时 next 为 null、problem 说明为什么没写（正文一个字不动）。
 */
export function applyOriginalWordsEntry(body: string, entry: OriginalWordsEntry, limit: number): { next: string | null; problem: string; skipped: boolean } {
  const want: OriginalWordsEntry = { text: normalizeText(entry.text), source: normalizeSource(entry.source) }
  if (body.length > limit) {
    return { next: null, skipped: false, problem: '正文已经 ' + body.length + ' 个字符，超过原话写入的硬顶 ' + limit + ' 个字符（GitHub 正文上限 65536，留了余量）：这次原话没写、正文一个字没动。要写请先把正文缩短。' }
  }
  const have = parseOriginalWords(body)
  const duplicated = have.some((one) => one.source === want.source && one.text === want.text)
  if (duplicated) return { next: body, skipped: true, problem: '' }
  const next = replaceOriginalWordsSection(body, want)
  if (next.length > limit) {
    return { next: null, skipped: false, problem: '写进这条原话后正文会到 ' + next.length + ' 个字符，超过硬顶 ' + limit + ' 个字符：这次原话没写、正文一个字没动。要写请先缩短正文。' }
  }
  return { next: next, skipped: false, problem: '' }
}

/**
 * 写后核对的第一道：读回来的正文里要有这一条（原话与出处逐字相同，含空行与标点）。
 *
 * 为什么要单独一层：建票时后端会给正文套上标题、文件头与字段行（整份文件形态变了），
 * 所以「整份正文逐字相同」在建票那一路没法当判据；但当事人要的是「原话本身一字不改」，
 * 这一道在哪一路都成立，也是 #1091 验收里「写入后读回，逐字相同」的落点。
 *
 * @returns 对上了回空串；否则回一句说清差在哪、并提醒「别当成已经写好」的话。
 */
export function originalWordsPresenceProblem(want: OriginalWordsEntry, body: string): string {
  const text = normalizeText(want.text)
  const source = normalizeSource(want.source)
  const have = parseOriginalWords(body)
  const got = have.some((one) => one.source === source && one.text === text)
  if (got) return ''
  return '写了原话，但读回来的正文里找不到这一条（出处：' + (source || '空') + '）：别当成已经写好，先读一次现状复核。'
}

/**
 * 写后核对（改票那一路的严格版）：先要这一条逐字在，再要整份正文与 expected 逐字相同
 * （两端空白不计：本地 Markdown 后端会重排正文两端）。
 *
 * 为什么还要比整份：原话区只许追加，别处一个字都不该动；只查「区里有这条」的话，
 * 写动作顺手把别的区块改了也会被放行。expected 由调用方按同一条规则算出来。
 *
 * @returns 全部对上回空串；任何一条不成立回一句说清差在哪、并提醒「别当成已经写好」的话。
 */
export function originalWordsReadbackProblem(want: OriginalWordsEntry, body: string, expected: string): string {
  const presence = originalWordsPresenceProblem(want, body)
  if (presence) return presence
  if (body.trim() !== String(expected == null ? '' : expected).trim()) {
    return '原话写进去了，但读回来的整份正文与「写前正文 + 这一条」不逐字相同：这次可能顺手动到了别的区块，或后端改写了格式，别当成已经写好，先读一次现状复核。'
  }
  return ''
}

/**
 * 整份正文改写时把盘上的维护者原话区搬回来（#1091：Markdown 房整份替换只搬 Comments 与 Answer，
 * 不搬这一区就会把原话整段丢掉）。位置按同一套规则放：紧跟 `## 目的`、没有目的区就放正文最前。
 *
 * incoming 里已经有维护者原话区时原样返回（不合并、不改写已有内容）；盘上也没有这一区时也原样返回。
 */
export function restoreOriginalWordsSection(incoming: unknown, diskText: unknown): string {
  const body = incoming == null ? '' : String(incoming)
  const disk = diskText == null ? '' : String(diskText)
  if (!disk) return body
  const lines = splitBodyLines(body)
  const marks = analyzeLines(lines)
  if (findSections(lines, marks, ORIGINAL_WORDS_TITLE).length > 0) return body
  const diskLines = splitBodyLines(disk)
  const diskMarks = analyzeLines(diskLines)
  const section = findSections(diskLines, diskMarks, ORIGINAL_WORDS_TITLE)[0]
  if (!section) return body
  const blockTexts = diskLines.slice(section.heading, section.end).map((line) => line.text)
  while (blockTexts.length > 1 && blockTexts[blockTexts.length - 1].trim() === '') blockTexts.pop()
  const at = originalWordsInsertIndex(lines, marks)
  const eol = lines.length ? detectEol(lines) : '\n'
  const tailEol = lines.length ? lines[lines.length - 1].eol : '\n'
  return insertBlock(lines, at, blockTexts, eol, tailEol)
}
