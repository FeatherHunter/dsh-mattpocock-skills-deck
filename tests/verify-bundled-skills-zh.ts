#!/usr/bin/env node
/**
 * tests/verify-bundled-skills-zh.ts —— 随包技能中文译文的完整性与结构门禁（#1521）
 *
 * 守的是什么：package/bundled-skills/ 下每一篇英文 Markdown 都有一份中文译文，
 * 放在兄弟目录 package/bundled-skills-zh/ 的同一相对路径上；译文只能改叙述文字，
 * 不能改动机器依赖的结构——frontmatter 的键、标题层级、代码块、行内代码、链接目标、
 * 数字都要和英文对得上。少一篇、结构对不上、锚点指不到中文标题，都判红。
 *
 * 为什么放在兄弟目录：package/bundled-skills/ 由 scripts/sync-matt-skills.mts 整目录重建，
 * 上游没有中文文件，译文本放在原文目录里会被下一次同步删掉。本门禁第 11 段会静态核对
 * 同步脚本只重建 package/bundled-skills（不碰 bundled-skills-zh），防止哪天有人把删除范围改大。
 *
 * 检查分两类：
 *  逐篇对照（--partial 时只查已经写好的篇目，缺的只列出来不算失败）：
 *   1) 完整性：每篇英文在中文树同一相对路径存在；中文树没有多余的 Markdown。
 *   2) frontmatter：键顺序与英文一致；name 原样；description 译成中文且与英文不同；
 *      argument-hint 译成中文；disable-model-invocation、metadata 等机器字段逐字相同。
 *   3) 标题：层级序列完全一致；代码块外的标题要含中文，只有两处例外（见 HEADING_EXEMPT）。
 *   4) 代码块：数量、类型标记、内部内容逐字相同。
 *   5) 行内代码：英文里出现的每个片段，在中文里不能少（允许额外）。
 *   6) 链接：指向文件或网页的目标集合一致；同一页 # 锚点要能解析到中文标题算出的锚点。
 *   7) 数字：代码外的阿拉伯数字（行首列表序号除外）英文里有的，中文里也必须有。
 *   8) 中英比例：去掉代码块与行内代码后，汉字占「汉字 + 拉丁字母」比例不低于 50%。
 *  整树检查（只在全量模式跑）：
 *   9) 结构安全：原文目录里不再残留 SKILL.zh.md；中文目录是原文目录的兄弟目录。
 *  10) package/package.json 的 files 含 bundled-skills-zh。
 *  11) 同步脚本的 DEST_DIR 仍是 package/bundled-skills，且脚本里不出现 bundled-skills-zh。
 *  12) 术语表与说明文件在；译文里没有明令禁用的「智能体」说法。
 *  13) 宿主读取：skill.readDoc 能读到 wayfinder 的中文译文，路径指向 bundled-skills-zh。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-bundled-skills-zh.ts
 *       node --import ./scripts/ts-hook.mts tests/verify-bundled-skills-zh.ts --partial
 * 退出码 0 = 通过；1 = 失败
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT: string = path.resolve(__dirname, '..')
const EN_ROOT: string = path.join(ROOT, 'package/bundled-skills')
const ZH_ROOT: string = path.join(ROOT, 'package/bundled-skills-zh')
const PKG_JSON: string = path.join(ROOT, 'package/package.json')
const SYNC_SCRIPT: string = path.join(ROOT, 'scripts/sync-matt-skills.mts')
const PARTIAL: boolean = process.argv.includes('--partial')

// 随包英文目录根下不属于「50 篇」的 md；中文目录根下允许的说明文件。
const EN_ROOT_SKIP: Set<string> = new Set(['README.md'])
const ZH_ROOT_ALLOW: Set<string> = new Set(['README.md', 'GLOSSARY.md'])

// 标题不译的例外：只有文件名与地图机器字面量这两处（与 GLOSSARY.md 格式硬规则第 4 条一致）。
const HEADING_EXEMPT: Array<{ rel: string; text: string }> = [
  { rel: 'teach/SKILL.md', text: '`NOTES.md`' },
  { rel: 'wayfinder/SKILL.md', text: 'Out of scope' },
]

// 明令禁用的说法：术语表把 agent 定为「代理」，「智能体」是旧译文的混用写法。
const BANNED_TERMS: string[] = ['智能体']

// 规格七段的中文标题是代码里的字面量契约（src/tracker/body-parse.ts 的 SPEC_SECTION_TITLES）：
// 本地 Markdown 后端按这几个中文字面量切块，译文换一种说法中文规格正文就读不出区块。旧译文这七个
// 标题是对的，重译必须逐字沿用；门禁在这里单独卡一遍，光靠「标题含中文」拦不住近义改写。
const TO_SPEC_SECTION_TITLES: string[] = ['问题陈述', '解决方案', '用户故事', '实现决策', '测试决策', '不在范围内', '补充说明']

// 上游原文的围栏缺陷修复（只在本门禁解析英文原文那一侧生效，磁盘上的原文一个字不改）。
// triage/OUT-OF-SCOPE.md 第 23 行用三个反引号开了一个 markdown 示例块，块里第 41 行又套了一个
// 三个反引号的 ts 块。按 CommonMark，第 47 行那行三反引号会提前闭合外层示例块，于是第 55 行往后
// 的正文全被当成代码块，渲染出来是一段英文源码；上游作者的本意是让整个示例（到第 54 行）包在
// 一个块里。中文译文按作者意图用四个反引号把示例包对，所以比对结构前先把英文这处围栏按同样的
// 意图修好，否则两种都正确的写法永远对不上。修复用的字符串必须与原文逐字一致（含引号）。
const SOURCE_FENCE_REPAIRS: Array<{ rel: string; fixes: Array<{ from: string; to: string }> }> = [
  {
    rel: 'triage/OUT-OF-SCOPE.md',
    fixes: [
      { from: '```markdown\n# Dark Mode', to: '````markdown\n# Dark Mode' },
      { from: '- #134: "Dark theme option"\n```', to: '- #134: "Dark theme option"\n````' },
    ],
  },
]

/** 把英文原文里已知的上游围栏缺陷按作者意图修好，再交给解析器。 */
function applySourceFixes(rel: string, raw: string): string {
  const rule = SOURCE_FENCE_REPAIRS.find((r) => r.rel === rel)
  if (!rule) return raw
  let out: string = raw
  for (const fix of rule.fixes) {
    if (!out.includes(fix.from)) {
      console.log('[note] ' + rel + '：上游围栏缺陷修复点没找到，可能是上游原文又变了，请复核 SOURCE_FENCE_REPAIRS')
    }
    out = out.replace(fix.from, fix.to)
  }
  return out
}

const MIN_CJK_RATIO: number = 0.5
// 比例检查只对「正文本身有内容」的英文文件生效。像 grill-me、grill-with-docs 这种
// 整篇正文就是一句「调用 Skill 工具，传入 "grilling"」的指针文件，专有名词占大头，
// 汉字比例天然到不了 50%，拿同一条尺子量它们只会制造噪音。判据挂在英文原文上，
// 不挂在译文上，这样译者无法靠少写字绕开检查。
const MIN_CJK_PROSE_LEN: number = 120

let problemCount: number = 0

function pass(msg: string): void {
  console.log('[PASS]', msg)
}

function fail(msg: string): void {
  console.log('[FAIL]', msg)
  problemCount++
}

// 按 UTF-8 读成 LF 归一化的字符串：Windows 检出可能是 CRLF，比较前统一。
function readText(absPath: string): string {
  return fs.readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
}

// 相对路径一律用 /，与仓库其它门禁一致，报错信息在三个平台上长得一样。
function relOf(absPath: string, base: string): string {
  return path.relative(base, absPath).split(path.sep).join('/')
}

function walkMarkdown(dir: string, base: string, out: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walkMarkdown(p, base, out)
    else if (ent.name.endsWith('.md')) out.push(relOf(p, base))
  }
}

type Heading = { level: number; text: string }
type Fence = { info: string; content: string }

type ParsedDoc = {
  frontLines: string[]
  headings: Heading[]
  fences: Fence[]
  inlineCodes: string[]
  linkTargets: string[]
  anchorTargets: string[]
  prose: string
  numberText: string
  slugIds: Set<string>
}

// 标题正文算成 GitHub 同款锚点：小写、去标点、空格转连字符；汉字原样保留。
// 同一页重复的标题按 GitHub 规则加 -1、-2 后缀，这样锚点校验和真实渲染一致。
function slugify(text: string): string {
  let s = text.trim().toLowerCase()
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/`/g, '')
  s = s.replace(/[^\p{L}\p{N}\s_-]/gu, '')
  s = s.replace(/\s+/g, '-')
  return s
}

function buildSlugIds(headings: Heading[]): Set<string> {
  const ids: Set<string> = new Set()
  const seen: Map<string, number> = new Map()
  for (const h of headings) {
    const base = slugify(h.text)
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    ids.add(n === 0 ? base : base + '-' + n)
  }
  return ids
}

// 把一份 Markdown 拆成门禁要看的部分。只做结构性解析，不做完整 Markdown 实现：
// 这批文件里没有多反引号行内代码、没有引用式链接，所以按行处理足够且更可预测。
function parseDoc(raw: string): ParsedDoc {
  const lines: string[] = raw.split('\n')
  let frontLines: string[] = []
  let bodyStart: number = 0
  if (lines.length > 1 && lines[0] === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') {
        frontLines = lines.slice(1, i)
        bodyStart = i + 1
        break
      }
    }
  }
  const headings: Heading[] = []
  const fences: Fence[] = []
  const inlineCodes: string[] = []
  const linkTargets: string[] = []
  const anchorTargets: string[] = []
  const proseParts: string[] = []
  const numberParts: string[] = []

  let fenceOpen: string | null = null
  let fenceInfo: string = ''
  let fenceBuf: string[] = []

  for (let i = bodyStart; i < lines.length; i++) {
    const line: string = lines[i]
    const openMatch: RegExpMatchArray | null = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fenceOpen === null && openMatch) {
      fenceOpen = openMatch[1][0] + String(openMatch[1].length)
      fenceInfo = openMatch[2].trim()
      fenceBuf = []
      continue
    }
    if (fenceOpen !== null) {
      const closeMatch: RegExpMatchArray | null = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
      if (closeMatch && (closeMatch[1][0] + String(closeMatch[1].length)) === fenceOpen) {
        fences.push({ info: fenceInfo, content: fenceBuf.join('\n') })
        fenceOpen = null
        fenceInfo = ''
        fenceBuf = []
      } else {
        fenceBuf.push(line)
      }
      continue
    }

    const headingMatch: RegExpMatchArray | null = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      headings.push({ level: headingMatch[1].length, text: headingMatch[2].replace(/\s+#+\s*$/, '').trim() })
    }

    const codeRe: RegExp = /`([^`]+)`/g
    let cm: RegExpExecArray | null
    while ((cm = codeRe.exec(line)) !== null) inlineCodes.push(cm[1])

    const linkRe: RegExp = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g
    let lm: RegExpExecArray | null
    while ((lm = linkRe.exec(line)) !== null) {
      const target: string = lm[3]
      if (target.startsWith('#')) anchorTargets.push(target.slice(1))
      else linkTargets.push(target)
    }
    const autoRe: RegExp = /<(https?:\/\/[^>\s]+)>/g
    let am: RegExpExecArray | null
    while ((am = autoRe.exec(line)) !== null) linkTargets.push(am[1])

    // 中英比例用：去掉行内代码、链接目标、网址与 HTML 注释/简单标签，只留叙述文字。
    let prose: string = line
      .replace(new RegExp('`([^`]+)`', 'g'), ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<https?:\/\/[^>\s]+>/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[A-Za-z][A-Za-z0-9_-]*>/g, ' ')
      .replace(/^#{1,6}\s+/, '')
    proseParts.push(prose)

    // 数字校验用：再去掉行首列表序号（列表编号由 Markdown 渲染，不是要被保留的内容）。
    let numberLine: string = line
      .replace(new RegExp('`([^`]+)`', 'g'), ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<https?:\/\/[^>\s]+>/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/^\s{0,3}(?:[-*+]\s+)?\d+[.)]\s+/, '')
    numberParts.push(numberLine)
  }
  if (fenceOpen !== null) fences.push({ info: fenceInfo, content: fenceBuf.join('\n') })

  return {
    frontLines: frontLines,
    headings: headings,
    fences: fences,
    inlineCodes: inlineCodes,
    linkTargets: linkTargets,
    anchorTargets: anchorTargets,
    prose: proseParts.join('\n'),
    numberText: numberParts.join('\n'),
    slugIds: buildSlugIds(headings),
  }
}

function countCjk(text: string): number {
  const m = text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g)
  return m ? m.length : 0
}

function countLatin(text: string): number {
  const m = text.match(/[A-Za-z]/g)
  return m ? m.length : 0
}

function cjkRatio(text: string): number {
  const cjk = countCjk(text)
  const latin = countLatin(text)
  if (cjk + latin === 0) return 1
  return cjk / (cjk + latin)
}

function topLevelKey(line: string): string | null {
  const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
  return m ? m[1] : null
}

function unquote(v: string): string {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}

function addCounts(map: Map<string, number>, items: string[]): void {
  for (const it of items) map.set(it, (map.get(it) || 0) + 1)
}

function compareCounts(problems: string[], label: string, enItems: string[], zhItems: string[], allowExtra: boolean): void {
  const en: Map<string, number> = new Map()
  const zh: Map<string, number> = new Map()
  addCounts(en, enItems)
  addCounts(zh, zhItems)
  for (const [item, n] of en) {
    const got = zh.get(item) || 0
    if (got < n) problems.push(label + '少了一处：' + JSON.stringify(item) + '（英文 ' + n + ' 处，中文 ' + got + ' 处）')
  }
  if (!allowExtra) {
    for (const [item, n] of zh) {
      if ((en.get(item) || 0) < n) problems.push(label + '多了一处：' + JSON.stringify(item) + '（英文 ' + (en.get(item) || 0) + ' 处，中文 ' + n + ' 处）')
    }
  }
}

// 取出「纯数字」片段：字母数字混排的标识（e2e、v1.3.1、A4 纸之类）整段跳过，
// 因为这些是标识符而不是数量，译文里通常原样保留英文或整个改写，强求数字相等只会误报。
// 连字符不参与拼词，所以「30-second」里的 30 仍算数。
function numbersOf(text: string): string[] {
  const out: string[] = []
  const tokenRe = /[A-Za-z0-9]+(?:[._][A-Za-z0-9]+)*/g
  let m: RegExpExecArray | null = tokenRe.exec(text)
  while (m !== null) {
    const token: string = m[0]
    if (/^\d+(?:[._]\d+)*$/.test(token)) {
      const nums = token.match(/\d+/g)
      if (nums) for (const n of nums) out.push(n)
    }
    m = tokenRe.exec(text)
  }
  return out
}

function isHeadingExempt(rel: string, enText: string): boolean {
  return HEADING_EXEMPT.some((e) => e.rel === rel && e.text === enText)
}

// 对照一篇英文与它的中文译文，把所有问题收进 problems（空数组代表这一篇通过）。
function checkPair(rel: string, enRaw: string, zhRaw: string): string[] {
  const problems: string[] = []
  const en: ParsedDoc = parseDoc(enRaw)
  const zh: ParsedDoc = parseDoc(zhRaw)

  // 2) frontmatter
  if (en.frontLines.length === 0) {
    if (zh.frontLines.length !== 0) problems.push('frontmatter：英文没有 frontmatter，中文却多出来了')
  } else if (zh.frontLines.length !== en.frontLines.length) {
    problems.push('frontmatter：行数不同（英文 ' + en.frontLines.length + ' 行，中文 ' + zh.frontLines.length + ' 行）')
  } else {
    for (let i = 0; i < en.frontLines.length; i++) {
      const enLine: string = en.frontLines[i]
      const zhLine: string = zh.frontLines[i]
      const key: string | null = topLevelKey(enLine)
      if (key === null) {
        if (enLine !== zhLine) problems.push('frontmatter 第 ' + (i + 2) + ' 行（机器字段的续行）应与英文逐字相同：' + JSON.stringify(zhLine))
        continue
      }
      if (key === 'name') {
        if (enLine !== zhLine) problems.push('frontmatter：name 必须与英文完全相同（英文 ' + JSON.stringify(enLine) + '，中文 ' + JSON.stringify(zhLine) + '）')
      } else if (key === 'description') {
        const enVal: string = unquote(enLine.slice('description:'.length))
        const zhVal: string = unquote(zhLine.slice('description:'.length))
        if (zhVal === enVal) problems.push('frontmatter：description 没有翻译')
        else if (countCjk(zhVal) === 0) problems.push('frontmatter：description 里没有中文：' + JSON.stringify(zhVal))
      } else if (key === 'argument-hint') {
        const zhVal: string = unquote(zhLine.slice('argument-hint:'.length))
        if (countCjk(zhVal) === 0) problems.push('frontmatter：argument-hint 应译成中文：' + JSON.stringify(zhVal))
      } else if (enLine !== zhLine) {
        problems.push('frontmatter：机器字段 ' + key + ' 应与英文逐字相同（英文 ' + JSON.stringify(enLine) + '，中文 ' + JSON.stringify(zhLine) + '）')
      }
    }
  }

  // 3) 标题：层级序列一致，代码块外标题含中文（两处例外）
  if (en.headings.length !== zh.headings.length) {
    problems.push('标题：数量不同（英文 ' + en.headings.length + ' 个，中文 ' + zh.headings.length + ' 个）')
  } else {
    for (let i = 0; i < en.headings.length; i++) {
      const eh: Heading = en.headings[i]
      const zhText: string = zh.headings[i].text
      if (eh.level !== zh.headings[i].level) {
        problems.push('标题：第 ' + (i + 1) + ' 个标题层级不同（英文 ' + eh.level + ' 级 ' + JSON.stringify(eh.text) + '，中文 ' + zh.headings[i].level + ' 级 ' + JSON.stringify(zhText) + '）')
      } else if (!isHeadingExempt(rel, eh.text) && countCjk(zhText) === 0) {
        problems.push('标题：第 ' + (i + 1) + ' 个标题没有译成中文（英文 ' + JSON.stringify(eh.text) + '，中文 ' + JSON.stringify(zhText) + '）')
      }
    }
  }

  // 4) 代码块：数量、类型标记、内容逐字相同
  if (en.fences.length !== zh.fences.length) {
    problems.push('代码块：数量不同（英文 ' + en.fences.length + ' 块，中文 ' + zh.fences.length + ' 块）')
  } else {
    for (let i = 0; i < en.fences.length; i++) {
      if (en.fences[i].info !== zh.fences[i].info) {
        problems.push('代码块：第 ' + (i + 1) + ' 块的类型标记不同（英文 ' + JSON.stringify(en.fences[i].info) + '，中文 ' + JSON.stringify(zh.fences[i].info) + '）')
      }
      if (en.fences[i].content !== zh.fences[i].content) {
        problems.push('代码块：第 ' + (i + 1) + ' 块的内部内容与英文不一致（' + (en.fences[i].info || '无类型标记') + '）')
      }
    }
  }

  // 5) 行内代码：一个不能少（允许额外）
  compareCounts(problems, '行内代码', en.inlineCodes, zh.inlineCodes, true)

  // 6) 链接：跨文件目标集合一致；同页锚点必须在中文标题上解析得到。
  // 锚点的名字允许随中文标题变化（#ticket-types → #工单类型），所以不比名字，只比数量：
  // 英文里有几个同页锚点，中文里就得有几个，防止旧译文那样把整条括号链接悄悄删掉。
  compareCounts(problems, '链接目标', en.linkTargets, zh.linkTargets, false)
  if (en.anchorTargets.length !== zh.anchorTargets.length) {
    problems.push('同页锚点数量不一致：英文 ' + en.anchorTargets.length + ' 个，中文 ' + zh.anchorTargets.length + ' 个')
  }
  for (const anchor of zh.anchorTargets) {
    if (!zh.slugIds.has(anchor) && !zh.slugIds.has(anchor.toLowerCase())) {
      problems.push('同页锚点 #' + anchor + ' 在中文标题里找不到对应标题（请按中文标题重算锚点）')
    }
  }

  // 7) 数字：代码外、行首列表序号除外的阿拉伯数字一个不能少
  compareCounts(problems, '数字', numbersOf(en.numberText), numbersOf(zh.numberText), true)

  // 7.5) 规格七段中文标题逐字固定（契约在 src/tracker/body-parse.ts，理由见常量注释）
  if (rel === 'to-spec/SKILL.md') {
    for (const title of TO_SPEC_SECTION_TITLES) {
      if (!zh.headings.some((h) => h.text === title)) {
        problems.push('规格区块标题必须逐字写成「' + title + '」（识别器按中文字面量切块）')
      }
    }
  }

  // 8) 中英比例（英文原文正文太短时跳过，理由见 MIN_CJK_PROSE_LEN 的注释）
  const enProseLen: number = countCjk(en.prose) + countLatin(en.prose)
  if (enProseLen >= MIN_CJK_PROSE_LEN) {
    const ratio = cjkRatio(zh.prose)
    if (ratio < MIN_CJK_RATIO) {
      problems.push('中英比例：汉字占比 ' + (ratio * 100).toFixed(1) + '%，低于 ' + (MIN_CJK_RATIO * 100) + '%（去掉代码与行内代码后）')
    }
  }

  return problems
}

// ---------------------------------------------------------------------------
// 驱动
// ---------------------------------------------------------------------------
// 整段放进 async 函数里：文件用 require 加载 CommonJS 依赖（与仓库其它门禁一致），
// 顶层 await 与 require 混在一起会让 Node 判不出模块格式；放进函数里就同时成立。

async function main(): Promise<void> {
if (!fs.existsSync(EN_ROOT)) {
  console.log('[FAIL] package/bundled-skills 不存在：本门禁对照的英文原文目录缺失')
  process.exit(1)
}

const enRelPaths: string[] = []
walkMarkdown(EN_ROOT, EN_ROOT, enRelPaths)
const enDocs: string[] = enRelPaths
  .filter((r) => (r.includes('/') ? true : !EN_ROOT_SKIP.has(r)))
  .filter((r) => !r.endsWith('.zh.md'))
  .sort()

if (enDocs.length === 0) {
  console.log('[FAIL] package/bundled-skills 下没有找到英文 Markdown')
  process.exit(1)
}

const missing: string[] = []
const checkedFiles: string[] = []
for (const rel of enDocs) {
  const enAbs: string = path.join(EN_ROOT, rel)
  const zhAbs: string = path.join(ZH_ROOT, rel)
  if (!fs.existsSync(zhAbs)) {
    missing.push(rel)
    continue
  }
  checkedFiles.push(rel)
  const problems: string[] = checkPair(rel, applySourceFixes(rel, readText(enAbs)), readText(zhAbs))
  if (problems.length === 0) {
    pass(rel)
  } else {
    fail(rel)
    for (const p of problems) console.log('        -', p)
  }
}

if (PARTIAL) {
  if (missing.length > 0) {
    console.log('[note] 还有 ' + missing.length + ' 篇没译（--partial 下不算失败）：')
    for (const rel of missing) console.log('        -', rel)
  }
  console.log('[PASS] 已存在的 ' + checkedFiles.length + ' 篇结构检查完成')
} else {
  if (missing.length > 0) {
    fail('完整性：中文树缺 ' + missing.length + ' 篇译文（' + enDocs.length + ' 篇英文应有 ' + enDocs.length + ' 篇中文）')
    for (const rel of missing) console.log('        - 缺', rel)
  } else {
    pass('完整性：' + enDocs.length + ' 篇英文都有同路径的中文译文')
  }

  // 中文树的目录与文件不多不少
  if (!fs.existsSync(ZH_ROOT)) {
    fail('中文目录 package/bundled-skills-zh 不存在')
  } else {
    const zhMds: string[] = []
    walkMarkdown(ZH_ROOT, ZH_ROOT, zhMds)
    const enSet: Set<string> = new Set(enDocs)
    const extra: string[] = zhMds.filter((r) => !enSet.has(r) && !ZH_ROOT_ALLOW.has(r)).sort()
    if (extra.length > 0) {
      fail('中文树有多余的 Markdown（只允许根目录的 README.md 与 GLOSSARY.md）：' + extra.join('、'))
    } else {
      pass('中文树没有多余的 Markdown')
    }
    const zhSkillDirs: string[] = fs
      .readdirSync(ZH_ROOT, { withFileTypes: true })
      .filter((d: any) => d.isDirectory())
      .map((d: any) => d.name)
      .sort()
    const enSkillDirs: string[] = fs
      .readdirSync(EN_ROOT, { withFileTypes: true })
      .filter((d: any) => d.isDirectory())
      .map((d: any) => d.name)
      .sort()
    const dirGap: string[] = enSkillDirs.filter((n) => !zhSkillDirs.includes(n)).concat(zhSkillDirs.filter((n) => !enSkillDirs.includes(n)))
    if (dirGap.length > 0) fail('技能目录与英文目录不一致：' + dirGap.join('、'))
    else pass('27 个技能目录与英文目录一一对应')

    if (fs.existsSync(path.join(ZH_ROOT, 'GLOSSARY.md'))) pass('术语表 package/bundled-skills-zh/GLOSSARY.md 在')
    else fail('术语表 package/bundled-skills-zh/GLOSSARY.md 缺失')
    if (fs.existsSync(path.join(ZH_ROOT, 'README.md'))) pass('说明文件 package/bundled-skills-zh/README.md 在')
    else fail('说明文件 package/bundled-skills-zh/README.md 缺失')
  }

  // 9) 结构安全：原文目录里不残留旧译文；中文目录是原文目录的兄弟目录
  const leftovers: string[] = []
  for (const rel of enRelPaths) if (rel.endsWith('.zh.md')) leftovers.push(rel)
  if (leftovers.length > 0) {
    fail('原文目录里还残留着 ' + leftovers.length + ' 个旧译文（' + leftovers.join('、') + '）；旧译文已搬进 bundled-skills-zh，原文目录只放上游原文')
  } else {
    pass('原文目录里没有残留 SKILL.zh.md')
  }
  const enParent: string = path.dirname(EN_ROOT)
  const zhParent: string = path.dirname(ZH_ROOT)
  if (path.resolve(zhParent) === path.resolve(enParent) && path.basename(ZH_ROOT) === 'bundled-skills-zh') {
    pass('中文目录是原文目录的兄弟目录（同步脚本整目录重建原文时删不到它）')
  } else {
    fail('中文目录必须是 package/bundled-skills 的兄弟目录，实际是 ' + ZH_ROOT)
  }

  // 10) package/package.json 的 files
  if (fs.existsSync(PKG_JSON)) {
    try {
      const pkg: any = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
      const files: any[] = Array.isArray(pkg.files) ? pkg.files : []
      if (files.includes('bundled-skills-zh')) pass('package/package.json:files 含 bundled-skills-zh')
      else fail('package/package.json:files 缺 bundled-skills-zh（漏发时安装包里没有中文译文）')
    } catch (e: any) {
      fail('package/package.json 解析失败：' + e.message)
    }
  } else {
    fail('package/package.json 缺失')
  }

  // 11) 同步脚本只重建原文目录
  if (fs.existsSync(SYNC_SCRIPT)) {
    const syncText: string = readText(SYNC_SCRIPT)
    const destRe: RegExp = /DEST_DIR[^=]*=\s*join\(\s*ROOT\s*,\s*'package'\s*,\s*'bundled-skills'\s*\)/
    if (!destRe.test(syncText)) {
      fail("scripts/sync-matt-skills.mts 的 DEST_DIR 不再是 join(ROOT, 'package', 'bundled-skills')：请确认同步的删除范围仍是原文目录")
    } else if (syncText.includes('bundled-skills-zh')) {
      fail('scripts/sync-matt-skills.mts 里出现了 bundled-skills-zh：同步脚本不应知道中文目录的存在')
    } else {
      pass('同步脚本只重建 package/bundled-skills，不碰 bundled-skills-zh')
    }
  } else {
    fail('scripts/sync-matt-skills.mts 缺失')
  }

  // 12) 禁用说法：译文里不许出现「智能体」
  const bannedHits: string[] = []
  for (const rel of enDocs) {
    const zhAbs: string = path.join(ZH_ROOT, rel)
    if (!fs.existsSync(zhAbs)) continue
    const zhText: string = readText(zhAbs)
    for (const term of BANNED_TERMS) {
      if (zhText.includes(term)) bannedHits.push(rel + '（' + term + '）')
    }
  }
  if (bannedHits.length > 0) fail('译文用了术语表禁用的说法：' + bannedHits.join('、'))
  else pass('译文里没有术语表禁用的说法（' + BANNED_TERMS.join('、') + '）')

  // 13) 宿主读取：skill.readDoc 能一起读到中文译文
  try {
    const docMod: any = require('../src/host/skillDoc.js')
    const doc: any = docMod.createSkillDoc({})
    const zhProbe: any = await doc.readDoc({ name: 'wayfinder' })
    if (!zhProbe || zhProbe.ok !== true) {
      fail('skill.readDoc 读不到 wayfinder 的英文原文：' + JSON.stringify(zhProbe))
    } else if (!zhProbe.mdZh) {
      fail('skill.readDoc 没有返回 wayfinder 的中文译文（mdZh 为空）')
    } else if (countCjk(zhProbe.mdZh) === 0) {
      fail('skill.readDoc 返回的 wayfinder 中文译文里没有汉字')
    } else if (!zhProbe.pathZh || !String(zhProbe.pathZh).includes('bundled-skills-zh')) {
      fail('skill.readDoc 返回的中文译文路径不在 bundled-skills-zh 下：' + JSON.stringify(zhProbe.pathZh))
    } else {
      pass('skill.readDoc 能读到 wayfinder 的中文译文，路径指向 bundled-skills-zh')
    }
    const missingProbe: any = await doc.readDoc({ name: '__no_such_skill__' })
    if (!missingProbe || missingProbe.ok !== false || missingProbe.missing !== true) {
      fail('skill.readDoc 对不存在的技能应回 { ok:false, missing:true }，实为 ' + JSON.stringify(missingProbe))
    } else {
      pass('skill.readDoc 对不存在的技能仍回 missing')
    }
  } catch (e: any) {
    fail('无法加载 src/host/skillDoc.ts 验证宿主读取：' + e.message)
  }
}

console.log('\n=== verify-bundled-skills-zh ===')
if (problemCount === 0) {
  console.log('ALL CHECKS PASS')
  if (PARTIAL) console.log('（--partial：只查了已写好的 ' + checkedFiles.length + ' 篇，缺的 ' + missing.length + ' 篇未判失败）')
  process.exit(0)
} else {
  console.log(problemCount + ' FAILURE(S)')
  process.exit(1)
}
}

main().catch((e: any) => {
  console.error('[verify-bundled-skills-zh] 异常', e)
  process.exit(1)
})
