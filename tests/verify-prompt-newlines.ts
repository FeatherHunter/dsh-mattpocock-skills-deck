// verify-prompt-newlines.ts —— 提示词模板换行契约校验（#430 根因门禁；#1292 起真源改读 YAML）
//
// 契约（#603 修订、#725 收口）：任何提示词模板文本都不得含字面 \n 序列（两个字符：反斜杠 + n）。
//   #603 曾为「正文格式块要能原样引述写成 \n 是什么样」开过 4 条豁免；#725 把正文格式块整节删掉后，
//   豁免清单已清空，且条数与指纹仍钉死在下面（见 ALLOWED_LITERAL_BSN）—— 不是随手能加的口子。
//   为什么会有这几条：#603 按领导拍板把正文格式块还原成 #567 之前的写法，那份写法里就有
//   点名 \n 的禁止条与一条反例。
// 理由：#430 —— 模板里把换行写成双层转义（源码 \\n），运行时注入的是字面
//   反斜杠+n，提示词没有真实换行；模板必须写单层转义 \n（源码一个反斜杠+n）。
// 防回退：若未来模板再次出现双层转义，本文件按条目报 FAIL；
//   且本文件断言「白名单必须为空」（见 ALLOWED_LITERAL_BSN），防止豁免被悄悄加回来。
//
// 真源在哪、产物怎么扫（2026-10-20 按 #1292 改写）：
//   提示词真源搬到了 config/prompts/ 下的五份模板族 YAML（一个族一份，三处片段按注入时机住在对应族里）。
//   所以真源那一侧改成读 YAML：把每条模板的 zh / en 正文与三处片段的正文逐条取出来判。
//   产物那两侧（client.js 与 package/lib/client.js）按新排版取：只取提示词那一张表里的
//   zh / en 值 —— 闭包里别处也有 zh:（界面文案），一并扫进来会把不相干的文案也判了，判据就变味了。
//   取到后按字符串语义解码（引号里的 \n 是真换行，\\n 才是字面反斜杠+n），再判解码后的文本。
//   另两面不变：src/host/** 的 *_PROMPT 常量、src/tracker/rooms/*/index.{ts,js} 的 zh/en 字面量。
//   src/host 全树另有若干源码级 \\n 在正则字面量与代码注释里（mapBody.js / parseIssueTracker.js /
//   gitlab/graph-blocking.js），它们不是模板文本，不属本门禁扫描面（按全树断言会误红）。
//
// 本文件不写「门禁归属」注释：它同时守着 config/prompts/、client.js、src/host/** 与 src/tracker/rooms/**
//   四处，写一条归属会把其余几处的归属挤掉（归属表按注释优先，其它来源一律不看）。
//
// 一件要说清的事：读产物文本的那几个小工具（skipString / blockEnd / readValue /
//   objectMembers / promptDataRegion / extractTemplateEntries）与 tests/verify-prompt-config.ts
//   里那份是同一套。本票的写入范围只允许改这两个门禁文件，没有第三个地方放共用实现，
//   所以两份各写一份。两边判据必须一致；将来若把共用部分抽到 tests/lib/ 下的模块，
//   两边要同时换，不能只换一边。
//
// 用法: node --import ./scripts/ts-hook.mts tests/verify-prompt-newlines.ts
//   （链上跑不用手写这行 --import：scripts/verify-chain.ts 与 scripts/verify-parallel.mts
//     会自动给 tests/ 下的门禁挂上 scripts/ts-hook.mts 这个装载钩子。）

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { PROMPT_FRAGMENT_IDS } from '../scripts/lib/prompt-config.mts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 三处片段的 id。片段按注入时机住在族文件里，与模板混在同一层顶层键上，数模板条数时要认得出来。 */
const FRAGMENT_IDS: ReadonlySet<string> = new Set(PROMPT_FRAGMENT_IDS.map(function (s) { return s.id }))

/**
 * 真源那五份 YAML：模板族各一份，三处片段按注入时机住在对应族的那份里。
 * 写死文件名的原因是「少扫一份要看得见」：门禁扫的是文件清单，清单少一项就等于少判一族模板。
 */
const PROMPT_YAML_FILES: ReadonlyArray<string> = [
  'config/prompts/workspace-initialization.yaml',
  'config/prompts/repository-alignment.yaml',
  'config/prompts/map-advancement.yaml',
  'config/prompts/ticket-action-templates.yaml',
  'config/prompts/ticket-creation.yaml',
]

/** 构建产物那两份：仓库根与发布包里各一份。 */
const PRODUCT_FILES: ReadonlyArray<string> = ['client.js', 'package/lib/client.js']

let failed = false

// #725：正文格式契约（带「写成 \n 是什么样」那几句教学片段）整节删除，所以这份豁免清单已经空了。
//   清单必须保持为空：条数与内容指纹仍硬编码，谁想加回一条口子都会红。
const ALLOWED_LITERAL_BSN: string[] = []
const EXPECT_ALLOWED_COUNT = 0
// 空清单的指纹 = sha256('') 前 16 位十六进制
const EXPECT_ALLOWED_FINGERPRINT = 'e3b0c44298fc1c14'

const allTexts: string[] = []
const stripAllowed = function (s: string): string {
  let t = String(s)
  ALLOWED_LITERAL_BSN.forEach(function (p) { t = t.split(p).join('') })
  return t
}
const countLiteral = function (s: string): number { return (String(s).match(/\\n/g) || []).length }

/**
 * 忠实求值：把源码字符串字面量按 JS 语义还原为运行时文本。
 * 与 JSON 字符串语义在这几种转义上一致（\n \t \r \\ \" \' \uXXXX），比 JSON.parse 多认一种单引号定界符
 * —— 构建产物的正文两种引号都可能出现（打包器按内容挑引号）。
 * 注意：不能复用 verify-prompts.ts 的 unescapeStr（其把源码 \\n 误还原为 \\+真实换行）
 */
const unescapeLiteral = function (s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') { out += c; continue }
    const n = s[i + 1]
    if (n === undefined) { out += c; continue }
    i++
    if (n === 'n') out += '\n'
    else if (n === 't') out += '\t'
    else if (n === 'r') out += '\r'
    else if (n === '\\') out += '\\'
    else if (n === "'") out += "'"
    else if (n === '"') out += '"'
    else if (n === 'u') { const hex = s.slice(i + 1, i + 5); i += 4; out += String.fromCharCode(parseInt(hex, 16)) }
    else out += n
  }
  return out
}

const checkText = function (where: string, name: string, v: string): boolean {
  allTexts.push(String(v))
  const n = countLiteral(stripAllowed(v))
  if (n > 0) { failed = true; console.log('FAIL ' + where + ' ' + name + ' 含字面 \\n ' + n + ' 处（剥离契约引用后应为 0）') }
  return n === 0
}

// #603：白名单是「钉死的教学片段清单」—— 条数与内容指纹都要对得上，防悄悄加口子
const fingerprint = createHash('sha256').update(ALLOWED_LITERAL_BSN.join('\u0000'), 'utf8').digest('hex').slice(0, 16)
if (ALLOWED_LITERAL_BSN.length !== EXPECT_ALLOWED_COUNT || fingerprint !== EXPECT_ALLOWED_FINGERPRINT) {
  failed = true
  console.log('FAIL ALLOWED_LITERAL_BSN 与钉死的教学片段清单不一致（实际 ' + ALLOWED_LITERAL_BSN.length + ' 条 / 指纹 ' + fingerprint +
    '，期望 ' + EXPECT_ALLOWED_COUNT + ' 条 / 指纹 ' + EXPECT_ALLOWED_FINGERPRINT + '）——要改这份清单就连断言一起改，不许绕过去')
} else {
  console.log('OK   ALLOWED_LITERAL_BSN 与钉死的教学片段清单一致（' + ALLOWED_LITERAL_BSN.length + ' 条 / 指纹 ' + fingerprint + '）')
}

// ---------------------------------------------------------------------------
// 产物文本的小工具：把构建产物里的提示词数据读出来
//
// 为什么自己扫而不用正则一把抓：提示词正文里可能出现带冒号的字样（正文里写 "use:" 这种），
// 正则分不清「键」与「正文里的字样」。下面这几个函数按字符扫、遇到字符串就跳过去，
// 才分得清哪一段是键、哪一段是正文。
// ---------------------------------------------------------------------------

/** 跳过一段字符串字面量（含反斜杠转义），返回它结束后的下标。 */
const skipString = function (text: string, start: number): number {
  const quote = text[start]
  let i = start + 1
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') { i += 2; continue }
    if (c === quote) return i + 1
    i++
  }
  return i
}

/** 从 text[start] 处的 '{' 起做花括号配对，返回配对 '}' 之后的下标；找不到返回 -1。 */
const blockEnd = function (text: string, start: number): number {
  let depth = 0
  let i = start
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i + 1 }
    i++
  }
  return -1
}

/** 读一个成员的值：字符串字面量按引号读到末尾，其余读到第一层逗号为止。 */
const readValue = function (text: string, start: number): { text: string; end: number } {
  const ch = text[start]
  if (ch === '"' || ch === "'" || ch === '`') {
    const end = skipString(text, start)
    return { text: text.slice(start, end), end }
  }
  let depth = 0
  let i = start
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth-- }
    else if (c === ',' && depth === 0) break
    i++
  }
  return { text: text.slice(start, i).trim(), end: i }
}

/** 解析一个对象字面量的第一层成员，返回「键 → 原始值文本」。 */
const objectMembers = function (body: string): Map<string, string> {
  const out = new Map<string, string>()
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(body, i); continue }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < body.length && /[A-Za-z0-9_$]/.test(body[j])) j++
      const key = body.slice(i, j)
      let k = j
      while (k < body.length && /\s/.test(body[k])) k++
      if (body[k] !== ':') { i = j; continue }
      k++
      while (k < body.length && /\s/.test(body[k])) k++
      const value = readValue(body, k)
      out.set(key, value.text)
      i = value.end
      continue
    }
    i++
  }
  return out
}

/**
 * 从构建产物里取出提示词数据区：从第一张模板族表（const TEMPLATES_...）到语言清单那一段结束。
 * 找不到就返回 null —— 宁可判红，也不要在认不出底本的情况下判绿（产物没重建过时这里就是 null）。
 */
const promptDataRegion = function (text: string): string | null {
  const start = /const\s+TEMPLATES_[A-Z_]+\s*=\s*Object\.freeze\(\{/.exec(text)
  if (!start) return null
  const lang = /const\s+LANGUAGES_YAML\s*=/.exec(text)
  if (!lang) return null
  const end = blockEnd(text, lang.index)
  if (end < 0) return null
  return text.slice(start.index, end)
}

/** 产物里的一条提示词条目：id 与中英两条正文（已按字符串语义解码）。 */
interface ProductEntry { id: string; zh: string; en: string }

/**
 * 从提示词数据区里取出模板条目：形如 "id": Object.freeze({ version, placeholders, zh, en })。
 * 片段条目（"id": Object.freeze({ "zh": ..., "en": ... })）没有 placeholders 成员，会被滤掉。
 */
const extractTemplateEntries = function (region: string): ProductEntry[] {
  const out: ProductEntry[] = []
  const re = /"((?:[^"\\]|\\.)*)":\s*Object\.freeze\(\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(region)) !== null) {
    const open = region.indexOf('{', m.index + m[0].length - 1)
    const end = blockEnd(region, open)
    if (end < 0) break
    const members = objectMembers(region.slice(open + 1, end - 1))
    if (members.has('placeholders') && members.has('version')) {
      out.push({
        id: m[1],
        zh: unescapeLiteral((members.get('zh') || '""').slice(1, -1)),
        en: unescapeLiteral((members.get('en') || '""').slice(1, -1)),
      })
    }
    re.lastIndex = end
  }
  return out
}

/** 取产物里片段表（PROMPT_FRAGMENT_DATA）那一段。 */
const fragmentBlock = function (text: string): string | null {
  const m = /const\s+PROMPT_FRAGMENT_DATA\s*=/.exec(text)
  if (!m) return null
  const end = blockEnd(text, m.index)
  if (end < 0) return null
  return text.slice(m.index, end)
}

/** 把 YAML 里所有名为 zh / en 的字符串正文挑出来，附上它在那份文件里的位置（形如 ghAuthLogin.zh）。 */
const collectBilingualTexts = function (value: unknown, where: string, out: Array<{ where: string; text: string }>): void {
  if (Array.isArray(value)) {
    value.forEach(function (v, i) { collectBilingualTexts(v, where ? where + '[' + i + ']' : '[' + i + ']', out) })
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const at = where ? where + '.' + k : k
    if ((k === 'zh' || k === 'en') && typeof v === 'string') {
      out.push({ where: at, text: v })
      continue
    }
    collectBilingualTexts(v, at, out)
  }
}

// ---------------------------------------------------------------------------
// 1) 真源：config/prompts/ 下的六份 YAML
// ---------------------------------------------------------------------------
let yamlTemplateCount = 0
for (const rel of PROMPT_YAML_FILES) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    failed = true
    console.log('FAIL ' + rel + ' 不存在 —— 真源少一份，这一族模板就没人判了')
    continue
  }
  let doc: unknown
  try {
    doc = parseYaml(fs.readFileSync(abs, 'utf8'))
  } catch (e) {
    failed = true
    console.log('FAIL ' + rel + ' 解析失败：' + (e as Error).message)
    continue
  }
  const texts: Array<{ where: string; text: string }> = []
  // where 传空串：位置只写「哪一条」（形如 ghAuthLogin.zh），文件名由下面打印时带上，不重复。
  collectBilingualTexts(doc, '', texts)
  if (texts.length === 0) {
    failed = true
    console.log('FAIL ' + rel + ' 里一条 zh / en 正文都没取到（真源被搬空或改了字段名 —— 少扫要看得见，不能当通过）')
    continue
  }
  for (const t of texts) {
    checkText(rel, t.where, t.text)
  }
  // 模板条数：族文件里的顶层键 = 这一族的模板 + 片段，片段不算模板，扣掉再数。
  //   （族文件里没有文件级的 version 元字段：这一族的版本靠 git 记录，不写在文件里。）
  const table = (doc && typeof doc === 'object' && !Array.isArray(doc)) ? doc as Record<string, unknown> : {}
  const templatesInFile = Object.keys(table).filter(function (k) { return !FRAGMENT_IDS.has(k) })
  const fragmentsInFile = Object.keys(table).filter(function (k) { return FRAGMENT_IDS.has(k) })
  if (Object.keys(table).length !== templatesInFile.length + fragmentsInFile.length) {
    failed = true
    console.log('FAIL ' + rel + ' 的顶层键既不是模板也不是登记过的片段（多出来的条目会让模板条数算错）')
  }
  yamlTemplateCount += templatesInFile.length
  console.log('OK   ' + rel + '（' + texts.length + ' 条 zh/en 正文，' + templatesInFile.length + ' 条模板' +
    (fragmentsInFile.length ? ' + 片段 ' + fragmentsInFile.join(', ') : '') + '）')
}
console.log('OK   真源一共 ' + yamlTemplateCount + ' 条模板（五份 YAML 逐条扫过）')

// ---------------------------------------------------------------------------
// 2) 产物：client.js 与 package/lib/client.js
// ---------------------------------------------------------------------------
for (const rel of PRODUCT_FILES) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    console.log('OK   ' + rel + ' 不在盘上，跳过（构建产物不在盘上时这一侧判不了，不是判绿）')
    continue
  }
  const text = fs.readFileSync(abs, 'utf8')
  const region = promptDataRegion(text)
  if (!region) {
    failed = true
    console.log('FAIL ' + rel + ' 里找不到提示词数据区（应当是 const TEMPLATES_... 到 const LANGUAGES_YAML 那一段）—— 产物是旧的或排版变了，先重建再跑本门禁')
    continue
  }
  const entries = extractTemplateEntries(region)
  if (entries.length === 0) {
    failed = true
    console.log('FAIL ' + rel + ' 的提示词数据区里一条模板都没取到 —— 一条都取不到不许当通过（产物是旧的或排版变了，先重建）')
    continue
  }
  // 条数要与真源对得上：产物比真源少一条，说明扫的是旧产物，扫出来的「没有字面 \n」不算数。
  if (entries.length !== yamlTemplateCount) {
    failed = true
    console.log('FAIL ' + rel + ' 里取到 ' + entries.length + ' 条模板，真源是 ' + yamlTemplateCount + ' 条 —— 产物比真源旧，先跑 node scripts/build.mts 重建再跑本门禁')
    continue
  }
  for (const e of entries) {
    checkText(rel, e.id + '.zh', e.zh)
    checkText(rel, e.id + '.en', e.en)
  }
  // 片段表里的正文也是提示词文本，一并判（片段表在产物里是一张单独的表，键名带引号）。
  const frag = fragmentBlock(text)
  if (!frag) {
    failed = true
    console.log('FAIL ' + rel + ' 里找不到片段表（const PROMPT_FRAGMENT_DATA）—— 产物是旧的或排版变了，先重建再跑本门禁')
    continue
  }
  const fragRe = /"(zh|en)":\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g
  let fm: RegExpExecArray | null
  let fragCount = 0
  while ((fm = fragRe.exec(frag)) !== null) {
    fragCount++
    checkText(rel, '片段.' + fm[1] + '#' + fragCount, unescapeLiteral(fm[2].slice(1, -1)))
  }
  if (fragCount === 0) {
    failed = true
    console.log('FAIL ' + rel + ' 的片段表里一条 zh / en 都没取到 —— 一条都取不到不许当通过')
    continue
  }
  console.log('OK   ' + rel + '（' + entries.length + ' 条模板 × zh/en + ' + fragCount + ' 条片段正文）')
}

// ---------------------------------------------------------------------------
// 3) host 的 *_PROMPT 常量（src/host/**）
// ---------------------------------------------------------------------------
const walk = function (dir: string, acc: string[]): string[] {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) walk(p, acc)
    else if (d.name.endsWith('.js') || d.name.endsWith('.ts')) acc.push(p)
  })
  return acc
}
walk(path.join(ROOT, 'src/host'), []).forEach(function (file) {
  const src = fs.readFileSync(file, 'utf8')
  const re = /const\s+([A-Za-z0-9_$]*PROMPT[A-Za-z0-9_$]*)\s*=\s*'((?:[^'\\]|\\.)*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    if (checkText(file, m[1], unescapeLiteral(m[2]))) console.log('OK   ' + file + ' ' + m[1] + '（真实换行 ' + (unescapeLiteral(m[2]).match(/\n/g) || []).length + ' 处）')
  }
})

// ---------------------------------------------------------------------------
// 4) host 后端模块 prompts 字典的 zh/en 字面量（rooms/*/index.{ts,js} 的 module.prompts 等）
// ---------------------------------------------------------------------------
walk(path.join(ROOT, 'src/tracker/rooms'), []).forEach(function (file) {
  if (!file.endsWith('index.js') && !file.endsWith('index.ts')) return
  const src = fs.readFileSync(file, 'utf8')
  const re = /(?:zh|en): '((?:[^'\\]|\\.)*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const v = unescapeLiteral(m[1])
    if (v.indexOf('\n') >= 0 || v.indexOf('\\n') >= 0) {
      if (checkText(file, m[1].slice(0, 24), v)) console.log('OK   ' + file + ' zh/en 字面量（含换行的 ' + m[1].slice(0, 24) + '…）')
    }
  }
})

// #603：钉死的教学片段必须真的还在文本里 —— 防白名单烂在代码里（文本改了、豁免还留着）
ALLOWED_LITERAL_BSN.forEach(function (frag) {
  if (allTexts.join('\n').indexOf(frag) < 0) {
    failed = true
    console.log('FAIL 白名单里的教学片段已经不在任何提示词文本里（该删掉这条豁免）：' + JSON.stringify(frag))
  }
})
console.log('OK   白名单 ' + ALLOWED_LITERAL_BSN.length + ' 条教学片段都在当前文本里找得到')

console.log(failed ? 'FAIL' : 'PASS')
process.exit(failed ? 1 : 0)
