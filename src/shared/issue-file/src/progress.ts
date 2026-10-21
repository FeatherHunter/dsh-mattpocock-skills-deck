/**
 * src/shared/issue-file/src/progress.ts —— 票正文「## 进度」区的读与写（唯一真源，#1090）
 *
 * 为什么住这里：进度以前散在三处——宿主内联（src/host/mapBody.ts）、面板派生（src/tracker/deck-derive.ts）、
 * deck 工具（src/deck/tools/issue-patch.ts）各留一份正则。写进去的格式与读出来的正则对不上：传一段
 * 自由文字写进正文，读回却是 null（#1089 定稿的起因）。#1090 把读、写、核对统一到这一个文件，另外三处
 * 只调用这里的函数。放在 shared 层是因为 tracker / deck / host 三层都要用它，而这三层之间不能互相 import。
 *
 * 约束：纯函数——不碰 ctx、不碰 DOM、不读文件、不引任何其它模块（shared 层同层互引同样被规则禁止）。
 *
 * 区里的形状（写侧只产出这一种，读侧兼容老票的几种老写法）：
 *
 *   ## 进度
 *
 *   - 进度：90%（2026-10-21T20:15+08:00）：写完了读侧，正在跑门禁
 *   - 进度：40%（时间未记录）：老票第一次被写入时搬过来的旧百分比
 *
 * 一条记录一行，最新在最上，第一条就是当前值；每条都必须带说明（老记录可能没有）。
 * 标题固定写 `## 进度`、不带百分比；老票标题里带的百分比在第一次写入时搬成一条「时间未记录」的记录，
 * 旧自由文字原样保留——不批量迁移、不改老票的位置。
 * 本区只认顶层区块：代码块、引用块、HTML 注释里出现的同名标题不算（今天踩过的坑：正文里贴了一段
 * 示例 `## 进度`，写入时把示例当成真的进度区替换掉了）。
 */

/** 进度区的固定标题：写侧永远只写这一行，不带百分比。
 *
 * 不外传：读、写两侧都在本文件里用它，外面的调用方不需要这个字面量；
 * 共享层的字符串型常量若没有生产侧读者会被 tests/verify-contract-vocabulary.ts 判成「死了的常量」。
 */
const PROGRESS_HEADING = '## 进度'

/**
 * 正文长度硬顶（按字符数算）：GitHub 的票正文上限是 65536 字符，这里留一点余量。
 * 超过就不写进度、也不自动搬走旧记录——搬旧记录是丢信息，得由人来决定。
 */
export const PROGRESS_BODY_LIMIT = 60 * 1024

/** 老记录没有写时间时，时间那一格固定写这四个字，读回来 updatedAt 为 null。 */
const PROGRESS_TIME_UNRECORDED = '时间未记录'

/** 一条进度记录。 */
export interface ProgressEntry {
  /** 0..100 的整数。 */
  percent: number
  /** 做到哪一步的说明。老记录没有说明时是空串。 */
  note: string
  /** 写入时间（ISO 8601，带时区偏移）。老记录时间不知道时是 null。 */
  updatedAt: string | null
}

/** 进度区的读回形状：entries 按「最新在前」排，第一条就是当前值。 */
export interface ProgressDetail {
  /** 当前百分比；没写进度、或只有自由文字时是 null（不是 0）。 */
  percent: number | null
  /** 当前那条记录的说明。 */
  note: string
  /** 当前那条记录的时间（ISO 8601）；老记录不知道时间时是 null。 */
  updatedAt: string | null
  /** 区里所有记录，最新在前（含从老标题百分比搬过来的那条）。 */
  entries: ProgressEntry[]
}

// ——— 内部的按行扫描：保留每行原换行符，写回时除目标区外一个字节都不动 ———

interface BodyLine {
  /** 行内容（不含换行符）。 */
  text: string
  /** 这一行原来的换行符：\n、\r\n，文件末尾没有换行时是空串。 */
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

interface ProgressSection {
  /** 标题所在行号。 */
  heading: number
  /** 区内第一行行号。 */
  contentStart: number
  /** 区结束行号（不含）：下一个顶层二级标题、顶层字段行或正文末尾。 */
  end: number
  /** 老票标题里带的百分比（`## 进度：90%`）；规范标题不带百分比时是 null。 */
  headingPercent: number | null
}

interface ScannedEntry {
  /** 这一行原文（写回时原样保留）。 */
  raw: string
  entry: ProgressEntry
}

interface ScannedSection {
  entries: ScannedEntry[]
  /** 认不出的非空行（看板上的自由文字）；写回时原样放到记录后面。 */
  freeText: string[]
}

/** 按行切开，保留每行的换行符 —— 这样改一个区不会顺手改掉别处的 CRLF 或末尾换行。 */
function splitBodyLines(body: string): BodyLine[] {
  const out: BodyLine[] = []
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i)
    if (ch !== '\n' && ch !== '\r') continue
    let eol = '\r\n'
    let skip = 1
    if (ch === '\r' && body.charAt(i + 1) === '\n') { eol = '\r\n'; skip = 2 } else if (ch === '\r') { eol = '\r' } else { eol = '\n' }
    out.push({ text: body.slice(start, i), eol })
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
    if (line.eol) return line.eol === '\r' ? '\r' : line.eol
  }
  return '\n'
}

/** 把 `90` 这类字符串收成 0..100；不是 1-3 位整数时回 null。 */
function clampPercent(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null
  const n = parseInt(raw, 10)
  if (isNaN(n)) return null
  return Math.max(0, Math.min(100, n))
}

/** 标题行：最多三个前导空格、1-6 个 `#`，后面是标题文字（允许 `##进度` 这种不带空格的写法）。 */
function parseHeading(text: string): { level: number; title: string } | null {
  const m = /^ {0,3}(#{1,6})([\s\S]*)$/.exec(text)
  if (!m) return null
  return { level: m[1].length, title: m[2].replace(/^[ \t]+/, '').trim() }
}

/** 进度标题：`进度` / `Progress`，可带「：90%」这种老写法；`## 进度计划` 不算。 */
function parseProgressTitle(title: string): { percent: number | null } | null {
  const m = /^(?:进度|Progress)(?:\s*[：:]\s*(\d{1,3})\s*%?)?$/.exec(title)
  if (!m) return null
  if (m[1] === undefined) return { percent: null }
  return { percent: clampPercent(m[1]) }
}

/** 顶层字段行：整份文件形态里，进度区到 Status/Type/Blocked by/Labels 为止。 */
function isFieldLine(text: string): boolean {
  return /^\s*(?:Status|Type|Blocked\s+by|Labels)\s*[:：]/.test(text)
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
    marks.push({ fenced, inComment, heading })
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

/** 找出所有顶层二级「## 进度」区（老票可能有重复，写回时只留一个）。 */
function findProgressSections(lines: readonly BodyLine[], marks: readonly LineMark[]): ProgressSection[] {
  const out: ProgressSection[] = []
  for (let i = 0; i < lines.length; i++) {
    const head = marks[i].heading
    if (!head || head.level !== 2) continue
    const title = parseProgressTitle(head.title)
    if (!title) continue
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      if (marks[j].fenced || marks[j].inComment) continue
      const h = marks[j].heading
      if (h && h.level === 2) { end = j; break }
      if (isFieldLine(lines[j].text)) { end = j; break }
    }
    out.push({ heading: i, contentStart: i + 1, end, headingPercent: title.percent })
    i = end - 1
  }
  return out
}

/** 从「90%」后面那段文字里拆出时间与说明：`（ISO 时间）：说明` / `（时间未记录）：说明`。 */
function parseEntryTail(rawPercent: string, restText: string): ProgressEntry | null {
  const percent = clampPercent(rawPercent)
  if (percent === null) return null
  let rest = String(restText || '')
  let updatedAt: string | null = null
  const paren = /^\s*[（(]\s*([^）)]*?)\s*[）)]\s*([\s\S]*)$/.exec(rest)
  if (paren) {
    const inner = paren[1]
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(inner)) {
      updatedAt = inner
      rest = paren[2]
    } else if (inner === PROGRESS_TIME_UNRECORDED) {
      updatedAt = null
      rest = paren[2]
    }
  }
  let note = rest.trim()
  if (note.startsWith('：') || note.startsWith(':')) note = note.slice(1).trim()
  return { percent, note, updatedAt }
}

const ENTRY_BULLET_RE = /^\s*[-*+]\s+(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%([\s\S]*)$/
const ENTRY_LINE_RE = /^\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%([\s\S]*)$/
const ENTRY_BARE_RE = /^\s*(\d{1,3})\s*%\s*$/

/**
 * 扫一个进度区：认记录行，其余行当自由文字留着（写回时原样带过去）。
 *
 * 自由文字连空行一起收：区里可能贴着一整段代码块示例（今天踩过的坑），把它搬一遍时
 * 如果丢掉块内的空行、或者对每行做 trimEnd，示例就跟原样不一样了。写回时只裁掉
 * 这一段两端的空行，中间一个字符都不动。
 */
function scanProgressSection(lines: readonly BodyLine[], marks: readonly LineMark[], section: ProgressSection): ScannedSection {
  const entries: ScannedEntry[] = []
  const freeText: string[] = []
  for (let i = section.contentStart; i < section.end; i++) {
    const text = lines[i].text
    const mark = marks[i]
    if (mark.fenced || mark.inComment || /^\s*>/.test(text)) {
      freeText.push(text)
      continue
    }
    const bullet = ENTRY_BULLET_RE.exec(text) || ENTRY_LINE_RE.exec(text)
    if (bullet) {
      const entry = parseEntryTail(bullet[1], bullet[2])
      if (entry) { entries.push({ raw: text, entry }); continue }
    }
    const bare = ENTRY_BARE_RE.exec(text)
    if (bare) {
      const percent = clampPercent(bare[1])
      if (percent !== null) { entries.push({ raw: text, entry: { percent, note: '', updatedAt: null } }); continue }
    }
    freeText.push(text)
  }
  return { entries, freeText }
}

// ——— 读：parseProgressDetail（结构化）与 parseProgress（只要数字的外壳） ———

/**
 * 从正文里读进度区的结构化内容。
 *
 * 按顺序：
 *   1. 有顶层 `## 进度` 区 → 读区里的记录；标题带百分比的（老格式）补一条「时间未记录」的旧记录。
 *      区里只有自由文字、没有数字 → percent 为 null（「未表达」，不是 0）。
 *   2. 没有进度区 → 兼容老票的两种老写法：① 任意级别标题带百分比；② 行首 `进度：90%`。
 *
 * 不再做「全文任意位置出现进度：N%」的兜底：那一层会把正文里引用的别处进度读成自己的
 * （#1089 明确删掉，测试里钉着「正文提到 进度：7% 而已」必须回 null）。
 *
 * @returns 结构化进度；正文里没写进度时 entries 为空、percent 为 null。
 */
export function parseProgressDetail(body: unknown): ProgressDetail {
  const text = body == null ? '' : String(body)
  const lines = splitBodyLines(text)
  const marks = analyzeLines(lines)
  const sections = findProgressSections(lines, marks)
  if (sections.length > 0) {
    const section = sections[0]
    const scanned = scanProgressSection(lines, marks, section)
    const entries: ProgressEntry[] = scanned.entries.map((item) => item.entry)
    if (section.headingPercent !== null
      && !entries.some((e) => e.percent === section.headingPercent && !e.note && !e.updatedAt)) {
      entries.push({ percent: section.headingPercent, note: '', updatedAt: null })
    }
    if (entries.length === 0) return { percent: null, note: '', updatedAt: null, entries: [] }
    const current = entries[0]
    return { percent: current.percent, note: current.note, updatedAt: current.updatedAt, entries }
  }
  const legacy = readLegacyProgress(lines, marks)
  if (!legacy) return { percent: null, note: '', updatedAt: null, entries: [] }
  return { percent: legacy.percent, note: legacy.note, updatedAt: legacy.updatedAt, entries: [legacy] }
}

/** 老票兼容：先试「标题带百分比」，再试「行首进度：N%」；顺序与老口径一致。 */
function readLegacyProgress(lines: readonly BodyLine[], marks: readonly LineMark[]): ProgressEntry | null {
  for (let i = 0; i < lines.length; i++) {
    const mark = marks[i]
    if (mark.fenced || mark.inComment || !mark.heading) continue
    const title = parseProgressTitle(mark.heading.title)
    if (title && title.percent !== null) return { percent: title.percent, note: '', updatedAt: null }
  }
  for (let i = 0; i < lines.length; i++) {
    if (marks[i].fenced || marks[i].inComment) continue
    const m = ENTRY_LINE_RE.exec(lines[i].text)
    if (!m) continue
    const entry = parseEntryTail(m[1], m[2])
    if (entry) return entry
  }
  return null
}

/**
 * 从正文里读进度百分比：`parseProgressDetail(body).percent` 的数字外壳。
 *
 * 保留这个函数是因为面板派生与宿主行都按「数字或 null」读（客户端直接把数字画成进度条）；
 * 口径与 #1090 之前相同：0..100 的整数，没写进度回 null（不是 0）。
 */
export function parseProgress(body: unknown): number | null {
  return parseProgressDetail(body).percent
}

// ——— 写：把一条新记录放到区首，旧记录与自由文字原样保留 ———

/** 把一条记录拼成固定写法：`- 进度：90%（时间）：说明`；说明为空时省略冒号那一段。 */
export function formatProgressEntry(entry: ProgressEntry): string {
  const raw = Number(entry.percent)
  const percent = Math.max(0, Math.min(100, isNaN(raw) ? 0 : Math.round(raw)))
  const time = entry.updatedAt ? String(entry.updatedAt) : PROGRESS_TIME_UNRECORDED
  const note = entry.note == null ? '' : String(entry.note).trim()
  return note ? `- 进度：${percent}%（${time}）：${note}` : `- 进度：${percent}%（${time}）`
}

/** 没有进度区时，新块插到哪一行之前：第一个顶层字段行 → ## Comments / ## Answer → 文末。 */
function findProgressInsertIndex(lines: readonly BodyLine[], marks: readonly LineMark[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (!marks[i].fenced && !marks[i].inComment && isFieldLine(lines[i].text)) return i
  }
  for (let i = 0; i < lines.length; i++) {
    const head = marks[i].heading
    if (head && head.level === 2 && /^(?:comments|answer|评论|回复)$/i.test(head.title)) return i
  }
  return lines.length
}

/**
 * 把一条进度记录写进正文，返回新正文（纯函数，不读文件、不碰 ctx）。
 *
 * 规则（#1089 定稿）：
 *   · 只动进度区，其余正文按行原样拷过去（换行符也保持原样）；
 *   · 新记录放区首，旧记录原样保留，旧标题里的百分比搬成一条「时间未记录」的记录；
 *   · 区里的自由文字原样保留在记录后面；
 *   · 重复的进度区清掉，只留一个；
 *   · 没有进度区时插在字段行/## Comments/## Answer 之前，否则放文末；
 *   · 代码块、引用块、HTML 注释里的同名标题不当成进度区（示例不会被改掉）。
 */
export function replaceProgressSection(body: unknown, entry: ProgressEntry): string {
  const source = body == null ? '' : String(body)
  const lines = splitBodyLines(source)
  if (lines.length === 0) {
    return `${PROGRESS_HEADING}\n\n${formatProgressEntry(entry)}\n`
  }
  const marks = analyzeLines(lines)
  const sections = findProgressSections(lines, marks)
  const eol = detectEol(lines)
  const tailEol = lines[lines.length - 1].eol
  const newEntry = formatProgressEntry(entry)
  if (sections.length > 0) {
    const first = sections[0]
    // 老票可能留着重复的进度区（以前写坏留下的）：按出现顺序把每一段的记录与自由文字都收进来，
    // 合成一个区。只删重复的标题，不删里面的历史记录——清脏数据不能顺手丢进度。
    const collectedEntries: ScannedEntry[] = []
    const freeLines: string[] = []
    sections.forEach((section) => {
      const scanned = scanProgressSection(lines, marks, section)
      scanned.entries.forEach((item) => collectedEntries.push(item))
      if (section.headingPercent !== null
        && !collectedEntries.some((item) => item.entry.percent === section.headingPercent && !item.entry.note && !item.entry.updatedAt)) {
        collectedEntries.push({ raw: formatProgressEntry({ percent: section.headingPercent, note: '', updatedAt: null }), entry: { percent: section.headingPercent, note: '', updatedAt: null } })
      }
      scanned.freeText.forEach((line) => freeLines.push(line))
    })
    const block: BodyLine[] = [
      { text: PROGRESS_HEADING, eol },
      { text: '', eol },
      { text: newEntry, eol },
    ]
    collectedEntries.forEach((item) => block.push({ text: item.raw.trimEnd(), eol }))
    while (freeLines.length && freeLines[0].trim() === '') freeLines.shift()
    while (freeLines.length && freeLines[freeLines.length - 1].trim() === '') freeLines.pop()
    if (freeLines.length) {
      block.push({ text: '', eol })
      freeLines.forEach((line) => block.push({ text: line, eol }))
    }
    if (first.end < lines.length) block.push({ text: '', eol })
    const byHeading: Record<number, ProgressSection> = {}
    sections.forEach((section) => { byHeading[section.heading] = section })
    const out: BodyLine[] = []
    for (let i = 0; i < lines.length; i++) {
      const section = byHeading[i]
      if (section) {
        if (i === first.heading) block.forEach((line) => out.push(line))
        i = section.end - 1
        continue
      }
      out.push(lines[i])
    }
    out[out.length - 1].eol = tailEol
    return joinBodyLines(out)
  }
  const target = findProgressInsertIndex(lines, marks)
  const before = lines.slice(0, target)
  const after = lines.slice(target)
  const block: BodyLine[] = []
  if (before.length && before[before.length - 1].text.trim() !== '') block.push({ text: '', eol })
  block.push({ text: PROGRESS_HEADING, eol })
  block.push({ text: '', eol })
  block.push({ text: newEntry, eol })
  if (after.length) block.push({ text: '', eol })
  const out = before.concat(block, after)
  out[out.length - 1].eol = tailEol
  return joinBodyLines(out)
}

/**
 * 去掉正文里所有顶层进度区，返回剩下的正文。
 *
 * 用途只有一个：工具写完进度后核对「除进度区外一个字没动」——先把写前、写后的正文
 * 各自剥掉进度区再逐字比较。这样比较不会被新记录本身干扰，也不用猜后端会怎么处理空白。
 */
export function stripProgressSections(body: unknown): string {
  const source = body == null ? '' : String(body)
  const lines = splitBodyLines(source)
  const marks = analyzeLines(lines)
  const sections = findProgressSections(lines, marks)
  if (sections.length === 0) return source
  const drop: Record<number, true> = {}
  sections.forEach((section) => {
    for (let i = section.heading; i < section.end; i++) drop[i] = true
  })
  return joinBodyLines(lines.filter((line, index) => !drop[index]))
}

// ——— 写工具用的两个纯函数：写进正文并判长度硬顶、写后核对（#1090） ———
//
// 这两件都只对「一段正文 + 一条记录」做判断，不碰后端；放在这里是因为它们要用本文件的解析与写入，
// 而 shared 层内部不许互相 import，放到别的 shared 文件里反而要为拿这两个函数再加一条同层边。

/**
 * 把一条记录写进正文，并在写前、写后各判一次长度硬顶（#1089 定稿：超过 60KB 拒绝写入，不自动搬旧记录）。
 *
 * @returns next 是新正文；超限时 next 为 null、problem 说明为什么没写（调用方据此拒绝，正文一个字不动）。
 */
export function applyProgressEntry(body: string, entry: ProgressEntry, limit: number = PROGRESS_BODY_LIMIT): { next: string | null; problem: string } {
  if (body.length > limit) {
    return { next: null, problem: '正文已经 ' + body.length + ' 个字符，超过进度写入的硬顶 ' + limit + ' 个字符（GitHub 正文上限 65536，留了余量）：这次进度没写、正文一个字没动。要写请先把旧记录或正文缩短——工具不会自动搬走旧记录。' }
  }
  const next = replaceProgressSection(body, entry)
  if (next.length > limit) {
    return { next: null, problem: '写进这条进度后正文会到 ' + next.length + ' 个字符，超过硬顶 ' + limit + '：这次进度没写、正文一个字没动。要写请先缩短正文——工具不会自动搬走旧记录。' }
  }
  return { next: next, problem: '' }
}

/**
 * 写后核对：读回来的第一条记录与这次写入逐项相同（percent / note / updatedAt），
 * 且进度区以外的正文与写前逐字相同（两端空白不计：本地 Markdown 后端会重排正文两端）。
 *
 * @returns 全部对上回空串；任何一条不成立回一句说清差在哪、并提醒「别当成已经写好」的话。
 */
export function progressReadbackProblem(want: ProgressEntry, body: string, before: string | null): string {
  const got = parseProgressDetail(body)
  const first = got.entries.length > 0 ? got.entries[0] : null
  const sameProgress = !!first && first.percent === want.percent && first.note === want.note && first.updatedAt === want.updatedAt
  if (!sameProgress) return '写了进度，但读回来对不上：想写 ' + JSON.stringify(want) + '，读回第一条是 ' + JSON.stringify(first) + '：别当成已经写好。'
  if (before !== null && stripProgressSections(before).trim() !== stripProgressSections(body).trim()) {
    return '进度写进去了，但进度区以外的正文跟写前对不上：这次可能顺手动到了别的区块，别当成已经写好，先读一次复核。'
  }
  return ''
}
