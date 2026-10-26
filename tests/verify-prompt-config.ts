// verify-prompt-config.ts —— 提示词配置门禁（票 #1292 立，父规格 #1290 Seam 3a）。
// 门禁归属: config/prompts/
// 门禁归属: config/languages.yaml
//
// 真源在哪、产物怎么来的（先把这三句话说清楚，后面的判据才有人看得懂）：
//   提示词模板的真源是 config/prompts/ 下的五份 YAML（一个族一份：工作区初始化、仓库对齐、
//   地图推进、票面动作模板、建票入口）。三处片段（newBugFields、newWayfinderWiring、
//   vocabularyDefaults）不是完整模板，是模板里替换进去的一段话，按同一把尺子——
//   「什么时候注入」——归到对应族的那份文件里，与模板混在同一层顶层键上。
//   语言清单是 config/languages.yaml。scripts/lib/prompt-config.mts 是共享读取核：
//   它按 PROMPT_TEMPLATE_IDS / PROMPT_FRAGMENT_IDS 两张硬编码清单校验这些 YAML，
//   并给出 readPromptConfig / validatePromptData / validateLanguageData。
//   scripts/generate-prompt-config.mts 按这些 YAML 生成 src/client/kernel/prompt-data.ts
//   （构建期现场生成、不入库），构建再把它拼进客户端闭包，得到 client.js 与 package/lib/client.js。
//
// 这扇门禁守六件事（父规格 #1290 Seam 3a 的四条验收 + 两条用户故事）：
//   ① 生成新鲜度：生成器 --check 必须是绿的（改了 YAML 忘了跑生成器，在这里红）。
//   ② YAML 自校验：validatePromptData 与 validateLanguageData 都不许报问题。
//   ③ 注册表键名不变：27 条模板 id 与 3 处片段 id 与清单逐条相等，一个不多一个不少；
//      这 28 个键名在本文件里还硬编码了一份 —— 键名悄悄改了就红。
//   ④ use 不进客户端产物：use 是「这条模板什么时候用」的一句人话，只给读代码的人看，
//      不是发给用户的文案，父规格明说它不许出现在客户端产物里。
//   ⑤ 占位符声明与实际使用一一对应：正文里出现的 {名字} 必须都在 placeholders 里声明过，
//      声明了却没用也算红（那说明声明写错了，运行时填不进去）。
//   ⑥ 一字不差：生成物里每条模板的中英正文必须与 YAML 完全相等（相等，不是包含）。
//
// 跑法（在插件根目录执行）：
//   node --import ./scripts/ts-hook.mts tests/verify-prompt-config.ts
//   链上跑不用手写这行 --import：scripts/verify-chain.ts 与 scripts/verify-parallel.mts
//   会自动给 tests/ 下的门禁挂上 scripts/ts-hook.mts 这个装载钩子。
//
// 一件要说清的事：读产物文本的那几个小工具（skipString / blockEnd / readValue /
//   objectMembers / promptDataRegion / extractTemplateEntries）在 tests/verify-prompts.ts 里还有一份。
//   #1293 把 tests/verify-prompt-newlines.ts 整条并进那份门禁之后，那一份接过了「第二份实现」的角色；
//   两份判据必须一致，将来若把共用部分抽到 tests/lib/ 下的模块，两边要同时换，不能只换一边。

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  PROMPT_FAMILIES,
  PROMPT_FRAGMENT_IDS,
  PROMPT_TEMPLATE_IDS,
  readPromptConfig,
  validateLanguageData,
  validatePromptData,
} from '../scripts/lib/prompt-config.mts'
import type { FragmentShape, LanguageConfig, PromptConfig, TemplateShape } from '../scripts/lib/prompt-config.mts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 生成物：构建期现场生成的那一份 TypeScript 源码（不入库）。 */
const GENERATED_FILE = path.join(ROOT, 'src', 'client', 'kernel', 'prompt-data.ts')
/** 构建产物：仓库根那一份与发布包内那一份（发布包那一份不在盘上时跳过，并在输出里说明）。 */
const PRODUCT_FILES = [
  { rel: 'client.js', abs: path.join(ROOT, 'client.js') },
  { rel: 'package/lib/client.js', abs: path.join(ROOT, 'package', 'lib', 'client.js') },
]

// ---------------------------------------------------------------------------
// 硬编码的键名清单：id 是注册表的键，改名是一次有意的动作
// ---------------------------------------------------------------------------

/**
 * 27 条模板 id 的硬编码清单。
 *
 * 为什么要在门禁里再写一份（清单本身在 scripts/lib/prompt-config.mts 里已经有一份）：
 *   那一份是「今天打算有哪些模板」，这一份是「对外承诺的键名」。两份不是一回事：
 *   前者可以随功能增减，后者的键名是客户端的对外接口 —— 界面与工具都按 promptText('id') 取模板，
 *   悄悄改一个字母，症状是界面上某个按钮点了没反应，而不是任何一处报错。
 *   所以这一份只许在有意的动作里改（改 id 时要连着改 PROMPT_TEMPLATE_IDS、YAML 与所有调用方），
 *   而且改完必须说得出为什么。
 */
const PROTECTED_TEMPLATE_IDS: ReadonlyArray<string> = [
  'complete', 'fixate', 'healthCheck', 'installSkills', 'installSkillsFix',
  'mapExecute', 'mapInspect', 'newBugWayfinder', 'newSpec', 'newWayfinder', 'setupRun',
  'specComplete', 'specExecute', 'specSplit', 'switchAlign', 'switchLayout',
  'tpl.diagnose', 'tpl.discuss', 'tpl.execute', 'tpl.fix', 'tpl.handoff1', 'tpl.handoff2',
  'tpl.implement', 'tpl.prototype', 'tpl.research', 'tpl.supplement', 'tpl.takeover',
]

/** 3 处片段 id 的硬编码清单。理由与上面那份相同。 */
const PROTECTED_FRAGMENT_IDS: ReadonlyArray<string> = ['newBugFields', 'newWayfinderWiring', 'vocabularyDefaults']

/** 模板条数与片段条数的下限：少一条就是少了一条模板，多一条就是多了一条。 */
const EXPECTED_TEMPLATE_COUNT = 27
const EXPECTED_FRAGMENT_COUNT = 3

/**
 * 正文里占位符的写法，与 tests/verify-prompts.ts 的 RE_LEFT_PLACEHOLDER 同一个口径：
 * 大括号里是一个以字母开头、后面可以跟字母数字下划线与点的名字。
 * 为什么同一个口径：两边扫的是同一批正文，占位符认法不一样的话，两扇门禁会给出互相矛盾的结论。
 */
const RE_PLACEHOLDER = /\{[a-zA-Z][a-zA-Z0-9_.]*\}/g

// ---------------------------------------------------------------------------
// 输出与判定的小工具
// ---------------------------------------------------------------------------

let failed = false
let passCount = 0
let totalCount = 0

/** 判一条：绿了记一次，红了把整门禁判红。 */
const check = (ok: boolean, msg: string): void => {
  totalCount++
  if (ok) passCount++
  else failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

/** 只给人看的一句话，不参与判定。 */
const info = (msg: string): void => {
  console.log('  INFO ' + msg)
}

/** 取前 n 行，给错误信息用（错误信息太长会让人看不到重点）。 */
const firstLines = (text: string, n: number): string => {
  const lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  return lines.slice(0, n).join('\n      ') + (lines.length > n ? '\n      …（共 ' + lines.length + ' 行）' : '')
}

/**
 * 比两份 id 清单，返回「哪些只在左边、哪些只在右边」；两份一样就返回空串。
 * 报差异时不只说「对不上」，要说清是哪几条 —— 改名的症状是「少一条、多一条」，
 * 人看到「少 setupRun、多 setupRuns」才知道是改名而不是漏写。
 */
const diffIds = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): string => {
  const l = new Set(left)
  const r = new Set(right)
  const onlyLeft = left.filter((x) => !r.has(x))
  const onlyRight = right.filter((x) => !l.has(x))
  const parts: string[] = []
  if (onlyLeft.length) parts.push('只在左边有：' + onlyLeft.join('、'))
  if (onlyRight.length) parts.push('只在右边有：' + onlyRight.join('、'))
  return parts.length ? '（' + parts.join('；') + '）' : ''
}

/** 两份 id 清单是不是逐条相等（重复的 id 也算不相等 —— 重复会让后者覆盖前者）。 */
const sameIds = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean => {
  if (left.length !== right.length) return false
  const r = new Set(right)
  return left.every((x) => r.has(x)) && new Set(left).size === left.length
}

/**
 * 找出两段文字第一个不同的位置，给「一字不差」那条断言用。
 * 只报「第几个字不一样」不够 —— 人得看到那一段才知道错在哪，所以连着前后各十个字一起给。
 */
const firstDiff = (a: string, b: string): { index: number; left: string; right: string } | null => {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      const from = Math.max(0, i - 10)
      return { index: i, left: a.slice(from, i + 10), right: b.slice(from, i + 10) }
    }
  }
  if (a.length === b.length) return null
  const i = n
  const from = Math.max(0, i - 10)
  return { index: i, left: a.slice(from, i + 10), right: b.slice(from, i + 10) }
}

// ---------------------------------------------------------------------------
// 产物文本的小工具：把构建产物里的提示词数据读出来
//
// 为什么自己扫而不用正则一把抓：提示词正文里可能出现带冒号的字样（正文里写 "use:" 这种），
// 正则分不清「键」与「正文里的字样」。下面这几个函数按字符扫、遇到字符串就跳过去，
// 才分得清哪一段是键、哪一段是正文。
// ---------------------------------------------------------------------------

/** 跳过一段字符串字面量（含反斜杠转义），返回它结束后的下标。 */
const skipString = (text: string, start: number): number => {
  const quote = text[start]
  let i = start + 1
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === quote) return i + 1
    i++
  }
  return i
}

/** 从 text[start] 处的 '{' 起做花括号配对，返回配对 '}' 之后的下标；找不到返回 -1。 */
const blockEnd = (text: string, start: number): number => {
  let depth = 0
  let i = start
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(text, i)
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i + 1
    }
    i++
  }
  return -1
}

/** 读一个成员的值：字符串字面量按引号读到末尾，其余读到第一层逗号为止。 */
const readValue = (text: string, start: number): { text: string; end: number } => {
  const ch = text[start]
  if (ch === '"' || ch === "'" || ch === '`') {
    const end = skipString(text, start)
    return { text: text.slice(start, end), end }
  }
  let depth = 0
  let i = start
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(text, i)
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break
      depth--
    } else if (c === ',' && depth === 0) break
    i++
  }
  return { text: text.slice(start, i).trim(), end: i }
}

/** 解析一个对象字面量的第一层成员，返回「键 → 原始值文本」。 */
const objectMembers = (body: string): Map<string, string> => {
  const out = new Map<string, string>()
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(body, i)
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < body.length && /[A-Za-z0-9_$]/.test(body[j])) j++
      const key = body.slice(i, j)
      let k = j
      while (k < body.length && /\s/.test(body[k])) k++
      if (body[k] !== ':') {
        i = j
        continue
      }
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
 * 把一段字符串字面量（连引号）按 JavaScript 字符串语义还原成运行时文本。
 * 与 JSON 字符串语义在这几种转义上一致（\n \t \r \\ \" \uXXXX），
 * 比 JSON.parse 多认一种单引号定界符 —— 构建产物里两种引号都可能出现（打包器按内容挑引号）。
 */
const decodeStringLiteral = (literal: string): string => {
  if (literal.length < 2) return ''
  const s = literal.slice(1, -1)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const n = s[i + 1]
    if (n === undefined) {
      out += c
      continue
    }
    i++
    if (n === 'n') out += '\n'
    else if (n === 't') out += '\t'
    else if (n === 'r') out += '\r'
    else if (n === 'b') out += '\b'
    else if (n === 'f') out += '\f'
    else if (n === '\\') out += '\\'
    else if (n === "'") out += "'"
    else if (n === '"') out += '"'
    else if (n === '/') out += '/'
    else if (n === 'u') {
      const hex = s.slice(i + 1, i + 5)
      i += 4
      out += String.fromCharCode(parseInt(hex, 16))
    } else out += n
  }
  return out
}

/** 产物里的一条提示词条目：id、成员键名表、中英两条正文。 */
interface ProductEntry {
  id: string
  keys: string[]
  zh: string
  en: string
}

/**
 * 从构建产物里取出提示词数据区：从第一张模板族表（const TEMPLATES_...）到语言清单那一段结束。
 *
 * 为什么只取这一段：客户端闭包里别处也有 use 这个键（界面上的技能卡片就在用它），
 * 整文件找 use 会把那些与提示词无关的键也算进来，判据就变味了。
 * 找不到这段就返回 null —— 宁可判红，也不要在认不出底本的情况下判绿。
 */
const promptDataRegion = (text: string): string | null => {
  const start = /const\s+TEMPLATES_[A-Z_]+\s*=\s*Object\.freeze\(\{/.exec(text)
  if (!start) return null
  const lang = /const\s+LANGUAGES_YAML\s*=/.exec(text)
  if (!lang) return null
  const end = blockEnd(text, lang.index)
  if (end < 0) return null
  return text.slice(start.index, end)
}

/**
 * 从提示词数据区里取出模板条目：形如 "id": Object.freeze({ version, placeholders, zh, en })。
 * 片段条目（"id": Object.freeze({ "zh": ..., "en": ... })）没有 placeholders 成员，会被滤掉。
 */
const extractTemplateEntries = (region: string): ProductEntry[] => {
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
        keys: Array.from(members.keys()),
        zh: decodeStringLiteral(members.get('zh') || '""'),
        en: decodeStringLiteral(members.get('en') || '""'),
      })
    }
    re.lastIndex = end
  }
  return out
}

// ---------------------------------------------------------------------------
// 生成物模块的形状（按 scripts/generate-prompt-config.mts 写出来的那份类型抄的）
// ---------------------------------------------------------------------------

interface GeneratedTemplate {
  version: number
  placeholders: ReadonlyArray<string>
  zh: string
  en: string
}
interface GeneratedFragment {
  zh?: string
  en?: string
  cli?: { zh: string; en: string }
  cliBrand?: { zh: string; en: string }
}
interface GeneratedLanguageEntry {
  label: { zh: string; en: string }
  fallback: ReadonlyArray<string>
}
interface GeneratedModule {
  PROMPT_TEMPLATE_DATA: Record<string, GeneratedTemplate>
  PROMPT_FRAGMENT_DATA: Record<string, GeneratedFragment>
  LANGUAGES_YAML: { default: string; languages: Record<string, GeneratedLanguageEntry> }
}

// ---------------------------------------------------------------------------
// 开跑
// ---------------------------------------------------------------------------

console.log('提示词配置门禁（真源 config/prompts/ 与 config/languages.yaml，产物 src/client/kernel/prompt-data.ts 与 client.js）')

// —— ① 生成新鲜度 ——
// 为什么先跑这一条：后面几条都要拿生成物来比。生成物不在时，生成器会现场生成一份（这也是通过），
// 但 YAML 本身有问题时它会红 —— 那时候真正的错误信息在它的输出里，所以要把原文带出来。
{
  const gen = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-prompt-config.mts'), '--check'], {
    encoding: 'utf8',
    cwd: ROOT,
  })
  const out = String(gen.stdout || '') + String(gen.stderr || '')
  check(
    gen.status === 0,
    '生成器 --check 通过：生成物与 config/ 下的 YAML 对得上' +
      (gen.status === 0 ? '（' + out.trim().split('\n')[0] + '）' : '（退出码 ' + gen.status + '）\n      ' + firstLines(out.trim(), 20)),
  )
}

// —— 读 YAML 与生成物 ——
let config: PromptConfig | null = null
try {
  config = readPromptConfig(ROOT)
  check(true, '读得到 config/prompts/ 下的五份族 YAML（模板与片段同住）、公共小节 YAML（shared-sections.yaml，读取时展开）与 config/languages.yaml')
} catch (e) {
  check(false, '读不到 config/ 下的提示词 YAML：' + (e as Error).message + ' —— 真源缺文件时先看 config/prompts/ 下那几份还在不在')
}

// 生成物当模块载入：用它逐字比 YAML 正文。
// 为什么用 import() 而不是解析文本：生成物里正文是 JSON 字符串字面量（含转义），
// 把它当模块载入，拿到的是运行时的真实文本，比较时一个字都不用自己解码。
let generated: GeneratedModule | null = null
try {
  generated = (await import(pathToFileURL(GENERATED_FILE).href)) as GeneratedModule
  check(true, '生成物 src/client/kernel/prompt-data.ts 能当模块载入（用它逐字比 YAML 正文）')
} catch (e) {
  check(false, '生成物 src/client/kernel/prompt-data.ts 载不进来：' + (e as Error).message + ' —— 先跑 node scripts/generate-prompt-config.mts 生成它')
}

// —— ② YAML 自校验 ——
if (config) {
  const promptIssues = validatePromptData(config)
  check(
    promptIssues.length === 0,
    '提示词 YAML 自校验通过：validatePromptData 没有报问题' +
      (promptIssues.length ? '：\n      ' + promptIssues.join('\n      ') : '（27 条模板 + 3 处片段逐条核过）'),
  )
  const languageIssues = validateLanguageData(config.languages)
  check(
    languageIssues.length === 0,
    '语言清单自校验通过：validateLanguageData 没有报问题' +
      (languageIssues.length ? '：\n      ' + languageIssues.join('\n      ') : '（default 落在 languages 里、fallback 链不成环）'),
  )
}

// —— ③ 注册表键名不变 ——
if (config) {
  const yamlTemplateIds: string[] = []
  for (const fam of PROMPT_FAMILIES) {
    for (const id of Object.keys(config.templates[fam] || {})) yamlTemplateIds.push(id)
  }
  const registryTemplateIds = PROMPT_TEMPLATE_IDS.map((s) => s.id)
  check(
    yamlTemplateIds.length === EXPECTED_TEMPLATE_COUNT && registryTemplateIds.length === EXPECTED_TEMPLATE_COUNT,
    '模板条数是 ' + EXPECTED_TEMPLATE_COUNT + ' 条（YAML ' + yamlTemplateIds.length + ' 条 / 清单 ' + registryTemplateIds.length + ' 条）',
  )
  check(
    sameIds(yamlTemplateIds, registryTemplateIds),
    'YAML 里的模板 id 与 PROMPT_TEMPLATE_IDS 逐条相等' + diffIds(yamlTemplateIds, registryTemplateIds),
  )
  check(
    sameIds(PROTECTED_TEMPLATE_IDS, registryTemplateIds),
    'PROMPT_TEMPLATE_IDS 里的 id 与本门禁硬编码的那份逐条相等（键名不许悄悄改）' + diffIds(PROTECTED_TEMPLATE_IDS, registryTemplateIds),
  )
  check(
    sameIds(PROTECTED_TEMPLATE_IDS, yamlTemplateIds),
    'YAML 里的 id 与本门禁硬编码的那份逐条相等（键名不许悄悄改）' + diffIds(PROTECTED_TEMPLATE_IDS, yamlTemplateIds),
  )

  const yamlFragmentIds = Object.keys(config.fragments || {})
  const registryFragmentIds = PROMPT_FRAGMENT_IDS.map((s) => s.id)
  check(
    yamlFragmentIds.length === EXPECTED_FRAGMENT_COUNT && registryFragmentIds.length === EXPECTED_FRAGMENT_COUNT,
    '片段条数是 ' + EXPECTED_FRAGMENT_COUNT + ' 处（YAML ' + yamlFragmentIds.length + ' 处 / 清单 ' + registryFragmentIds.length + ' 处）',
  )
  check(
    sameIds(yamlFragmentIds, registryFragmentIds),
    'YAML 里的片段 id 与 PROMPT_FRAGMENT_IDS 逐条相等' + diffIds(yamlFragmentIds, registryFragmentIds),
  )
  check(
    sameIds(PROTECTED_FRAGMENT_IDS, registryFragmentIds),
    'PROMPT_FRAGMENT_IDS 里的 id 与本门禁硬编码的那份逐条相等（键名不许悄悄改）' + diffIds(PROTECTED_FRAGMENT_IDS, registryFragmentIds),
  )

  if (generated) {
    const generatedIds = Object.keys(generated.PROMPT_TEMPLATE_DATA)
    check(
      sameIds(PROTECTED_TEMPLATE_IDS, generatedIds),
      '生成物里的模板键与本门禁硬编码的那份逐条相等' + diffIds(PROTECTED_TEMPLATE_IDS, generatedIds),
    )
  }
}

// —— ④ use 不出现在客户端产物 ——
// 两条判据一起看，缺一条都会漏：
//   (a) 产物里没有 use 这个键 —— 键名是结构，光看正文原文认不出来；
//   (b) 产物里没有 YAML 里 use 的原文 —— 有人把 use 的内容改个名字塞进别的字段，这条能抓住。
// 为什么 (a) 要限定在「提示词数据区」：客户端闭包里别处也有 use 这个键（界面上的技能卡片就在用），
// 整文件找 use 会把那些与提示词无关的键也算进来，判据就变味了。
if (config) {
  const useTexts: Array<{ id: string; text: string }> = []
  for (const spec of PROMPT_TEMPLATE_IDS) {
    const entry = config.templates[spec.family]?.[spec.id]
    if (entry && typeof entry.use === 'string' && entry.use.trim()) useTexts.push({ id: spec.id, text: entry.use })
  }
  check(
    useTexts.length === EXPECTED_TEMPLATE_COUNT,
    'YAML 里读到 ' + useTexts.length + ' 条 use 原文（每条模板一条，用来查产物里有没有漏出去）',
  )

  if (generated) {
    const withUse: string[] = []
    for (const [id, entry] of Object.entries(generated.PROMPT_TEMPLATE_DATA)) {
      if (Object.prototype.hasOwnProperty.call(entry, 'use')) withUse.push(id)
    }
    for (const [id, entry] of Object.entries(generated.PROMPT_FRAGMENT_DATA)) {
      if (entry && Object.prototype.hasOwnProperty.call(entry, 'use')) withUse.push('片段 ' + id)
    }
    check(
      withUse.length === 0,
      '生成物 src/client/kernel/prompt-data.ts 里没有 use 字段' +
        (withUse.length ? '（出现了 use 的条目：' + withUse.join('、') + '）—— use 只给读代码的人看，不许进客户端产物' : '（模板与片段逐条看过）'),
    )
    // 「use 原文有没有漏出去」这一条查的是生成物的原始文本：
    // 查运行时对象只能看见值，查文本才能看见「use 的内容被塞进了别的字段」这种写法。
    const generatedText = fs.existsSync(GENERATED_FILE) ? fs.readFileSync(GENERATED_FILE, 'utf8') : ''
    const leaked = useTexts.filter((u) => generatedText.indexOf(u.text) >= 0)
    check(
      leaked.length === 0,
      '生成物里不含 YAML 里 use 的原文' +
        (leaked.length ? '（漏出去的有：' + leaked.map((u) => u.id).join('、') + '）' : '（' + useTexts.length + ' 条 use 原文逐条查过）'),
    )
  }

  for (const product of PRODUCT_FILES) {
    if (!fs.existsSync(product.abs)) {
      info(product.rel + ' 不在盘上，跳过这一侧的检查（构建产物不在盘上时这一条判不了，不是判绿）')
      continue
    }
    const text = fs.readFileSync(product.abs, 'utf8')
    const region = promptDataRegion(text)
    if (!region) {
      check(false, product.rel + ' 里找不到提示词数据区（应当是 const TEMPLATES_... 到 const LANGUAGES_YAML 那一段）—— 产物排版变了，先确认构建产物是不是最新的')
      continue
    }
    const entries = extractTemplateEntries(region)
    const withUse = entries.filter((e) => e.keys.indexOf('use') >= 0)
    check(
      withUse.length === 0,
      product.rel + ' 的提示词数据区里没有 use 字段' +
        (withUse.length ? '（出现了 use 的条目：' + withUse.map((e) => e.id).join('、') + '）' : '（' + entries.length + ' 条模板逐条看过）'),
    )
    const leaked = useTexts.filter((u) => text.indexOf(u.text) >= 0)
    check(
      leaked.length === 0,
      product.rel + ' 里不含 YAML 里 use 的原文' +
        (leaked.length ? '（漏出去的有：' + leaked.map((u) => u.id).join('、') + '）' : '（' + useTexts.length + ' 条 use 原文逐条查过）'),
    )
  }
}

// —— ⑤ 占位符声明与实际使用一一对应 ——
// 两条方向都要判：正文里用了却没声明（运行时会把 {名字} 原样塞进会话），
// 声明了却没用（声明写错了，多半是模板改过之后忘了同步）。
if (config) {
  const problems: string[] = []
  for (const spec of PROMPT_TEMPLATE_IDS) {
    const entry = config.templates[spec.family]?.[spec.id] as TemplateShape | undefined
    if (!entry) continue
    const declared = (entry.placeholders || []).map(String)
    for (const lang of ['zh', 'en'] as const) {
      const body = entry[lang]
      if (typeof body !== 'string') continue
      const used: string[] = []
      for (const hit of body.match(RE_PLACEHOLDER) || []) {
        const name = hit.slice(1, -1)
        if (used.indexOf(name) < 0) used.push(name)
      }
      for (const name of used) {
        if (declared.indexOf(name) < 0) {
          problems.push(spec.id + ' 的 ' + lang + ' 正文里用了 {' + name + '}，但 placeholders 没声明它 —— 运行时它会原样进会话，请把它补进 placeholders（或把正文里的 {名字} 去掉）')
        }
      }
      for (const name of declared) {
        if (used.indexOf(name) < 0) {
          problems.push(spec.id + ' 的 placeholders 声明了 {' + name + '}，但 ' + lang + ' 正文里没有用它 —— 声明与正文对不上，请改 YAML 让两边一致')
        }
      }
    }
  }
  check(
    problems.length === 0,
    '占位符声明与正文一一对应（27 条模板 × 中英各一份正文逐条核过）' +
      (problems.length ? '：\n      ' + problems.join('\n      ') : ''),
  )
}

// —— ⑥ 一字不差：生成物 vs YAML ——
// 判的是「完全相等」，不是「包含」：包含只能证明生成物里有这份文字，证明不了生成物没被别的东西改过。
if (config && generated) {
  const templateProblems: string[] = []
  for (const spec of PROMPT_TEMPLATE_IDS) {
    const want = config.templates[spec.family]?.[spec.id] as TemplateShape | undefined
    const got = generated.PROMPT_TEMPLATE_DATA[spec.id]
    if (!want) continue
    if (!got) {
      templateProblems.push(spec.id + ' 在生成物里没有（YAML 里有这条）—— 跑 node scripts/generate-prompt-config.mts 重算')
      continue
    }
    for (const lang of ['zh', 'en'] as const) {
      if (got[lang] === want[lang]) continue
      const d = firstDiff(want[lang], got[lang])
      templateProblems.push(
        spec.id + '.' + lang + ' 与 YAML 不相等：' +
          (d
            ? '第 ' + (d.index + 1) + ' 个字起不一样（YAML 是「' + d.left + '」，生成物是「' + d.right + '」）'
            : '两边长度不同') +
          ' —— 跑 node scripts/generate-prompt-config.mts 按 YAML 重算',
      )
    }
  }
  check(
    templateProblems.length === 0,
    '生成物里每条模板的中英正文与 YAML 完全相等' +
      (templateProblems.length ? '：\n      ' + templateProblems.join('\n      ') : '（27 条模板 × 中英各一份逐字比过）'),
  )

  const fragmentProblems: string[] = []
  for (const spec of PROMPT_FRAGMENT_IDS) {
    const want = config.fragments[spec.id] as FragmentShape | undefined
    const got = generated.PROMPT_FRAGMENT_DATA[spec.id]
    if (!want) continue
    if (!got) {
      fragmentProblems.push(spec.id + ' 在生成物里没有 —— 跑 node scripts/generate-prompt-config.mts 重算')
      continue
    }
    if (spec.shape === 'bilingual-text') {
      const w = want as { zh: string; en: string }
      if (got.zh !== w.zh) fragmentProblems.push(spec.id + '.zh 与 YAML 不相等')
      if (got.en !== w.en) fragmentProblems.push(spec.id + '.en 与 YAML 不相等')
    } else {
      const w = want as { cli: { zh: string; en: string }; cliBrand: { zh: string; en: string } }
      for (const key of ['cli', 'cliBrand'] as const) {
        const g = got[key]
        if (!g) {
          fragmentProblems.push(spec.id + '.' + key + ' 在生成物里没有')
          continue
        }
        if (g.zh !== w[key].zh) fragmentProblems.push(spec.id + '.' + key + '.zh 与 YAML 不相等')
        if (g.en !== w[key].en) fragmentProblems.push(spec.id + '.' + key + '.en 与 YAML 不相等')
      }
    }
  }
  check(
    fragmentProblems.length === 0,
    '生成物里三处片段与 YAML 完全相等' +
      (fragmentProblems.length ? '：\n      ' + fragmentProblems.join('\n      ') : '（逐字比过）'),
  )

  const languageProblems: string[] = []
  const wantLang = config.languages as LanguageConfig
  if (generated.LANGUAGES_YAML.default !== wantLang.default) {
    languageProblems.push('default 不相等：YAML 是「' + wantLang.default + '」，生成物是「' + generated.LANGUAGES_YAML.default + '」')
  }
  const wantLangIds = Object.keys(wantLang.languages || {}).sort()
  const gotLangIds = Object.keys(generated.LANGUAGES_YAML.languages || {}).sort()
  if (wantLangIds.join(',') !== gotLangIds.join(',')) {
    languageProblems.push('语言清单的条目对不上：YAML 有 [' + wantLangIds.join('、') + ']，生成物有 [' + gotLangIds.join('、') + ']')
  }
  for (const id of wantLangIds) {
    const w = wantLang.languages[id]
    const g = generated.LANGUAGES_YAML.languages[id]
    if (!g) continue
    if (g.label?.zh !== w.label.zh) languageProblems.push(id + '.label.zh 与 YAML 不相等')
    if (g.label?.en !== w.label.en) languageProblems.push(id + '.label.en 与 YAML 不相等')
    if (g.fallback.join(',') !== (w.fallback || []).join(',')) {
      languageProblems.push(id + '.fallback 与 YAML 不相等：YAML 是 [' + (w.fallback || []).join('、') + ']，生成物是 [' + g.fallback.join('、') + ']')
    }
  }
  check(
    languageProblems.length === 0,
    '生成物里的语言清单与 YAML 完全相等' +
      (languageProblems.length ? '：\n      ' + languageProblems.join('\n      ') : '（default、每门语言的 label 与 fallback 逐条比过）'),
  )
}

// ---------------------------------------------------------------------------
// 收尾
// ---------------------------------------------------------------------------

console.log('')
console.log('  INFO 断言 ' + totalCount + ' 条里过了 ' + passCount + ' 条')
console.log(failed ? 'FAIL' : 'PASS')
process.exit(failed ? 1 : 0)
