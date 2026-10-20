// verify-locale-config.ts —— 界面词表配置门禁（票 #1294 立，父规格 #1290 Seam 3b）。
// 门禁归属: config/copy/
// 门禁归属: config/languages.yaml
// 门禁归属: src/client/kernel/locale-data.ts
// 门禁归属: src/client/kernel/locale.ts
// 门禁归属: src/client/index.ts
// 门禁归属: src/
//
// 真源在哪、产物怎么来的（先把这三句话说清楚，后面的判据才有人看得懂）：
//   界面词表的真源是 config/copy/ 下的十份 YAML（一个「词族」一份，文件名就是族名）。每份 YAML
//   的顶层是语言 id（今天 zh / en），语言段下面平铺「词条键 → 文案」。语言清单是 config/languages.yaml
//   （提示词与界面共用的一份，见 #1292/#1290）。scripts/lib/copy-config.mts 是共享读取核：
//   readCopyConfig 按目录发现词族（不读任何手写清单）、readTimeValues 读中央时间参数、
//   validateCopyConfig 判语言完备/键集合对账/占位符/时间参数引用。scripts/generate-locale-config.mts
//   按这些 YAML 生成 src/client/kernel/locale-data.ts（构建期现场生成、不入库），构建再把它拼进
//   客户端闭包（kernel:localeData 段，排在 kernel:locale 之前）。
//
// 这扇门禁守九件事（父规格 #1290 Seam 3b 的三条验收 + #1294 的搬迁收口）：
//   ① 生成新鲜度：生成器 --check 必须是绿的（改了 YAML 忘了跑生成器，在这里红）。
//   ② YAML 自校验：validateCopyConfig 与 validateLanguageData 都不许报问题。
//   ③ 校验器对坏数据真会红：在内存里造十一类坏配置逐条演练（不写盘，跑完就丢），
//      确认「语言段缺失 / 语言段越界 / 键缺失 / 键多写 / 值非字符串 / 占位符不一致 /
//      跨族重复键 / 时间参数名写错 / 空词族 / 族名不合法 / 语言清单 default 指向不存在的语言」
//      每一项都有对应报错 ——
//      校验器变哑了，②的绿就没有意义。
//   ③b 加一门语言的正向演练（AC ⑧ 的另一半）：在内存里加一门 ja（不写盘），断言校验器放行、
//      渲染器自动产出 ja 词表（语言联合 / LOCALE_LANGS / LANG_CONFIG / 每族常量 / LOCALE_COPY
//      都多出一份），并做正反对照（漏写某族的 ja 段必须报红）—— 加语言只改 YAML，不改代码。
//   ④ 生成物与真源一致：内存渲染结果与盘上生成物逐字相等；生成物当模块载入后，
//      每门语言、每个键的取值都与 YAML 解析值（含 {{时间参数}} 烘成的字面量）完全相等（相等，不是包含）。
//   ⑤ 生成物结构契约：语言清单段、每族段头（`// ===== family: <族> (config/copy/<族>.yaml) =====`）、
//      `LocaleKey<族 Pascal>` 键联合类型、`L_<族大写>` 常量、合并段 `LocaleKey`/`LOCALE_COPY` 逐项在位；
//      每族段内每个键以 `'键': '值'` 的文本形状出现「语言数」次 —— 仓里还有一批门禁按这个文本形状
//      扫产物（#1294 特意让生成物保持单引号字面量），这条判据替它们把形状钉住。
//   ⑥ 词族清单按目录自动发现：段数 = config/copy/ 下 YAML 份数 = 读出来的族数；不手写清单
//      （#1289 的教训：手写清单漏掉三份片段、65 条键没人管）。
//   ⑦ 语言清单驱动：生成物 LANG_CONFIG 与 config/languages.yaml 逐字段相等；客户端注册处
//      （src/client/index.ts 与 src/client/kernel/locale.ts）按清单逐门注册，代码里不写死
//      'zh' / 'en' 字面量（加一门语言只改 YAML，不改代码）。
//   ⑧ 写死清零：src/ 下手写 TypeScript 里 0 处 `promptLang() === 'en' / 'zh'` 形状的语言判断
//      （#1294 之前散在 9 处；加第三门语言时这类二元判断会露馅）。
//   ⑨ 旧片段不并存：src/client/kernel/ 下不再有 locale-<族>.ts —— 真源只有 config/copy/*.yaml 一处。
//
// 跑法（在插件根目录执行）：
//   node --import ./scripts/ts-hook.mts tests/verify-locale-config.ts
//   链上跑不用手写这行 --import：scripts/verify-chain.ts 与 scripts/verify-parallel.mts
//   会自动给 tests/ 下的门禁挂上 scripts/ts-hook.mts 这个装载钩子。
//
// 判据强度对照表（旧门禁 → 本门禁，逐条可对、消失的判据为什么可接受）见
//   docs/design/1294-locale-gate-strength.md。

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  COPY_DIR_REL,
  LOCALE_DATA_REL,
  readCopyConfig,
  readTimeValues,
  renderLocaleData,
  resolveTimeTokens,
  quoteTs,
  validateCopyConfig,
} from '../scripts/lib/copy-config.mts'
import type { CopyConfig } from '../scripts/lib/copy-config.mts'

const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 生成物：构建期现场生成的那一份 TypeScript 源码（不入库）。 */
const GENERATED_FILE: string = path.join(ROOT, LOCALE_DATA_REL)
/** 语言清单（提示词与界面共用）。 */
const LANGUAGES_REL: string = 'config/languages.yaml'
/** 生成器脚本（① 要 spawn 它跑 --check）。 */
const GENERATOR_REL: string = 'scripts/generate-locale-config.mts'
/** 每门语言的词条数下限（棘轮：今天是 1030 条，只许增不许减；真要删词条，改这个数字并在提交信息里说清理由）。 */
const MIN_KEYS_PER_LANGUAGE: number = 1030
/** 生成物里三种段标记的前缀（生成器与 tests/lib/locale-data.ts 都认这几种，改格式要三处一起改）。 */
const FAMILY_MARK_PREFIX: string = '// ===== family: '
const LANG_SECTION_MARK: string = '// ===== 语言清单（config/languages.yaml）====='
const MERGE_SECTION_MARK: string = '// ===== 合并词表 ====='
/** 不是手写源码的生成物：清零扫描要跳过它们（生成物里的语言字面量是数据，不是判断）。 */
const GENERATED_SKIP: ReadonlyArray<string> = [
  'src/client/kernel/locale-data.ts',
  'src/client/kernel/prompt-data.ts',
  'src/shared/time-config/src/values.ts',
]

// ---------------------------------------------------------------------------
// 输出与判定的小工具（与 tests/verify-prompt-config.ts 同一套口径）
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

/** 两份字符串集合是否逐项相等（重复项算不相等 —— 重复会让后者静默覆盖前者）。 */
const sortedEqual = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean => {
  if (left.length !== right.length) return false
  const a = left.slice().sort()
  const b = right.slice().sort()
  return a.every((v, i) => v === b[i])
}

/** 词族名 → 生成物里的类型名后缀：panel → Panel，vcwrite → Vcwrite（与生成器同一规则）。 */
const pascal = (family: string): string => family.charAt(0).toUpperCase() + family.slice(1)

/**
 * 把注释换成等长空格，字符串与模板原文保留。
 *
 * 为什么需要：⑧ 要判断「代码里还写着 promptLang() === 'en'」。直接对全文做正则，会把注释里
 * 举例说明的写法当成真代码判红（旧门禁的注释里就有这种例子）；换成「注释被抹成空格」的文本
 * 再扫，才只认代码。等长替换是为了报错时还能按偏移量算出原始行号。
 */
const maskComments = (text: string): string => {
  const out: string[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '/' && next === '/') {
      while (i < n && text[i] !== '\n') {
        out.push(' ')
        i++
      }
      continue
    }
    if (ch === '/' && next === '*') {
      out.push(' ', ' ')
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        out.push(text[i] === '\n' ? '\n' : ' ')
        i++
      }
      if (i < n) {
        out.push(' ', ' ')
        i += 2
      }
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote: string = ch
      out.push(ch)
      i++
      while (i < n) {
        const c: string = text[i]
        if (c === '\\') {
          out.push(c)
          if (i + 1 < n) out.push(text[i + 1])
          i += 2
          continue
        }
        out.push(c)
        i++
        if (c === quote) break
      }
      continue
    }
    out.push(ch)
    i++
  }
  return out.join('')
}

/** 偏移量 → 行号（1 起），给 ⑧ 的报错指位置。 */
const lineOf = (text: string, offset: number): number => text.slice(0, offset).split('\n').length

/** 递归列出 src/ 下手写 TypeScript 源码；跳过 .d.ts 与生成物（理由见 GENERATED_SKIP）。 */
const listHandwrittenSources = (): string[] => {
  const out: string[] = []
  const walk = (rel: string): void => {
    const abs: string = path.join(ROOT, rel)
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel: string = rel + '/' + entry.name
      if (entry.isDirectory()) {
        walk(childRel)
        continue
      }
      if (!entry.isFile()) continue
      if (!/\.(ts|mts)$/.test(entry.name)) continue
      if (/\.d\.ts$/.test(entry.name)) continue
      if (GENERATED_SKIP.indexOf(childRel) >= 0) continue
      out.push(childRel)
    }
  }
  walk('src')
  return out.sort()
}

/**
 * 取生成物里某一族的源码段：从段标记行首到下一个 `// ===== ` 标记之前。
 * 段标记都是行首，所以按行首找下一个标记，不会误伤正文里的 `// =====` 字符串。
 */
const familySection = (text: string, family: string): string => {
  const want: string = FAMILY_MARK_PREFIX + family + ' (' + COPY_DIR_REL + '/' + family + '.yaml) ====='
  const at: number = text.indexOf(want)
  if (at < 0) return ''
  const lineStart: number = text.lastIndexOf('\n', at) + 1
  const rest: string = text.slice(at + want.length)
  const nextRel: number = rest.search(/\n\/\/ ===== /)
  return nextRel < 0 ? text.slice(lineStart) : text.slice(lineStart, at + want.length + nextRel + 1)
}

/** 解析一族段里的键联合类型（`export type LocaleKey<族> =` 后面每行一个 `  | '键'`），直到第一条非键行。 */
const typeUnionKeys = (section: string, typeName: string): string[] => {
  const lines: string[] = section.split('\n')
  const at: number = lines.findIndex((l) => l.startsWith('export type ' + typeName + ' ='))
  if (at < 0) return []
  const keys: string[] = []
  for (let i = at + 1; i < lines.length; i++) {
    const m: RegExpExecArray | null = /^ {2}\| '((?:[^'\\]|\\.)*)'$/.exec(lines[i])
    if (!m) break
    keys.push(unescapeTs(m[1]))
  }
  return keys
}

/** 把生成器写的单引号字面量还原成运行时字符串（只认生成器自己用到的转义，见 copy-config.mts 的 quoteTs）。 */
const unescapeTs = (body: string): string => {
  let out: string = ''
  let i = 0
  while (i < body.length) {
    const ch: string = body[i]
    if (ch !== '\\') {
      out += ch
      i++
      continue
    }
    const next: string = body[i + 1] || ''
    if (next === 'n') out += '\n'
    else if (next === 'r') out += '\r'
    else if (next === '\'') out += '\''
    else if (next === '\\') out += '\\'
    else out += next
    i += 2
  }
  return out
}

/** 子串出现次数。 */
const countOf = (hay: string, needle: string): number => hay.split(needle).length - 1

/** 在给定文本里找「promptLang() 与语言字面量比较」的全部位置（注释已抹掉；字符串原样保留）。 */
const PROMPT_LANG_CMP = /promptLang\s*\(\s*\)\s*(?:===|!==|==|!=)\s*['"](?:en|zh)['"]|['"](?:en|zh)['"]\s*(?:===|!==|==|!=)\s*promptLang\s*\(\s*\)/g

// ---------------------------------------------------------------------------
// 开跑
// ---------------------------------------------------------------------------

console.log('界面词表配置门禁（真源 ' + COPY_DIR_REL + '/ 与 ' + LANGUAGES_REL + '，生成物 ' + LOCALE_DATA_REL + '）')

// —— ① 生成新鲜度 ——
// 为什么先跑这一条：后面几条都要拿生成物来比。生成物不在时，生成器会现场生成一份（这也是通过，
// 与另外两个生成器同款）；YAML 本身有问题时它会红，那时候真正的错误信息在它的输出里，要原样带出来。
{
  const gen = spawnSync(process.execPath, [path.join(ROOT, GENERATOR_REL), '--check'], {
    encoding: 'utf8',
    cwd: ROOT,
  })
  const out: string = String(gen.stdout || '') + String(gen.stderr || '')
  check(
    gen.status === 0,
    '生成器 --check 通过：生成物与 config/ 下的 YAML 对得上' +
      (gen.status === 0
        ? '（' + out.trim().split('\n')[0] + '）'
        : '（退出码 ' + gen.status + '）\n      ' + firstLines(out.trim(), 20)),
  )
}

// —— ② 读真源与自校验 ——
let config: CopyConfig | null = null
try {
  config = readCopyConfig(ROOT)
  check(
    true,
    '读得到 ' + COPY_DIR_REL + '/ 下的词族 YAML 与 ' + LANGUAGES_REL + '：'
      + config.families.length + ' 个词族、' + Object.keys(config.languages.languages || {}).length + ' 门语言',
  )
} catch (e) {
  check(false, '读不到界面词表真源：' + (e as Error).message + ' —— 先看 ' + COPY_DIR_REL + '/ 与 ' + LANGUAGES_REL + ' 还在不在')
}

let timeValues: Record<string, number> | null = null
try {
  timeValues = readTimeValues(ROOT)
} catch (e) {
  check(false, '读不到中央时间参数：' + (e as Error).message + ' —— 词表里的 {{参数名}} 要有它才能校验')
}

if (config && timeValues) {
  const issues: string[] = validateCopyConfig(config, timeValues)
  check(
    issues.length === 0,
    '界面词表 YAML 自校验通过：validateCopyConfig 没有报问题' +
      (issues.length ? '：\n      ' + firstLines(issues.join('\n'), 20) : ''),
  )

  const langIds: string[] = Object.keys(config.languages.languages || {})
  const allKeysByLang: Record<string, string[]> = {}
  for (const lang of langIds) {
    const keys: string[] = []
    for (const fam of config.families) for (const key of Object.keys(fam.texts[lang] || {})) keys.push(key)
    allKeysByLang[lang] = keys
  }
  let floorOk: boolean = true
  const floorDetail: string[] = []
  for (const lang of langIds) {
    if (allKeysByLang[lang].length < MIN_KEYS_PER_LANGUAGE) {
      floorOk = false
      floorDetail.push(lang + ' 只有 ' + allKeysByLang[lang].length + ' 条')
    }
  }
  check(
    floorOk,
    '每门语言的词条数不低于棘轮下限 ' + MIN_KEYS_PER_LANGUAGE + '（' +
      langIds.map((l) => l + ' ' + allKeysByLang[l].length + ' 条').join(' / ') +
      (floorOk ? '）' : '；' + floorDetail.join('、')),
  )

  // —— ③ 校验器对坏数据真会红（内存演练，不写盘）——
  // 为什么要有这一段：②绿只能说明「今天的 YAML 没毛病」，说明不了「YAML 写坏了校验器会红」。
  // 一个只会返回空数组的 validateCopyConfig 会让②永远绿、门禁变成摆设。这段对每类坏数据造一份
  // 配置副本、调同一个校验器、断言它确实报了对应的错 —— 副本用完就丢，盘上一个字都不改。
  //
  // 坏配置一律从真配置深拷贝：只改要演练的那一处，别的都保持合法，免得一次触发多条错误、
  // 分不清是哪个判据在起作用。
  const cloneConfig = (): CopyConfig => JSON.parse(JSON.stringify(config)) as CopyConfig
  const expectIssue = (label: string, mutate: (c: CopyConfig) => void, expected: string): void => {
    const c: CopyConfig = cloneConfig()
    try {
      mutate(c)
    } catch (e) {
      check(false, '演练「' + label + '」时构造坏配置自己抛了错：' + (e as Error).message)
      return
    }
    const found: string[] = validateCopyConfig(c, timeValues as Record<string, number>)
    const hit: boolean = found.some((s) => s.includes(expected))
    check(
      hit,
      '演练「' + label + '」：校验器' + (hit ? '按预期报文红' : '没有报到预期的那一条（期望含「' + expected + '」）') +
        (hit ? '' : (found.length ? '；实际报了：' + firstLines(found.join('\n'), 5) : '；实际一条都没报 —— 校验器对这类坏数据是哑的')),
    )
  }
  if (config.families.length >= 2 && langIds.length >= 2) {
    const fam0 = config.families[0]
    const fam1 = config.families[1]
    const refLang: string = langIds[0]
    const otherLang: string = langIds[1]
    const firstKey: string = Object.keys(fam0.texts[refLang] || {})[0]
    expectIssue('语言段越界（多写了语言清单之外的 ja）', (c) => {
      c.families[0].texts.ja = Object.assign({}, c.families[0].texts[refLang])
    }, '语言清单之外的语言段')
    expectIssue('缺语言段（en 段整段没了）', (c) => {
      delete c.families[0].texts[otherLang]
    }, '缺语言段')
    expectIssue('缺键（另一门语言少一条）', (c) => {
      delete c.families[0].texts[otherLang][firstKey]
    }, '缺键')
    expectIssue('键多写（另一门语言多一条）', (c) => {
      c.families[0].texts[otherLang]['__extra_key__'] = '多写的'
    }, '多写了键')
    expectIssue('值不是字符串', (c) => {
      ;(c.families[0].texts[otherLang] as Record<string, unknown>)[firstKey] = 123
    }, '必须是字符串')
    expectIssue('同键占位符不一致', (c) => {
      c.families[0].texts[refLang][firstKey] = '带 {count} 个占位符'
      c.families[0].texts[otherLang][firstKey] = '没有占位符'
    }, '占位符两边不一致')
    expectIssue('跨族重复键', (c) => {
      const dupKey: string = Object.keys(c.families[1].texts[refLang] || {})[0]
      for (const lang of langIds) c.families[0].texts[lang][dupKey] = '重复的键'
    }, '重复出现')
    expectIssue('时间参数名写错', (c) => {
      c.families[0].texts[refLang][firstKey] = '{{NO_SUCH_TIME_PARAM}}'
    }, '未知的时间参数')
    expectIssue('空词族（一族一条词都没有）', (c) => {
      for (const lang of langIds) c.families[0].texts[lang] = {}
    }, '空词族没有存在意义')
    expectIssue('族名不合法（大写与下划线）', (c) => {
      c.families[0].family = 'Bad_Family'
    }, '文件名（词族名）必须是')
    expectIssue('语言清单 default 指向不存在的语言', (c) => {
      c.languages.default = 'ja'
    }, '必须在 languages 里有同名条目')
  } else {
    check(false, '词族或语言不足两份，无法演练校验器：真源读出来 ' + config.families.length + ' 个词族、' + langIds.length + ' 门语言')
  }

  // —— ③b 加一门语言的正向演练（AC ⑧ 的另一半：#1294 要求「加一门语言只改 YAML，不改 .ts」）——
  // ③ 只证明「代码里不写死 zh / en」（反向）；这里在内存里真加一门 ja（不写盘、不碰任何源码），
  // 断言两件事：校验器放行、渲染器自动产出 ja 词表。若哪天校验器或渲染器把语言清单写死成 zh/en，
  // 这一段会红 —— 这正是 AC ⑧ 要钉住的「加语言不用改代码」。
  {
    const thirdId: string = 'ja'
    const c3: CopyConfig = cloneConfig()
    c3.languages.languages[thirdId] = { label: { zh: '日本語', en: 'Japanese' }, fallback: ['en'] }
    for (const fam of c3.families) fam.texts[thirdId] = Object.assign({}, fam.texts[langIds[0]])
    const countOccurrences = (hay: string, needle: string): number => hay.split(needle).length - 1

    const thirdProblems: string[] = validateCopyConfig(c3, timeValues)
    check(
      thirdProblems.length === 0,
      '演练「内存里加第三门语言 ja」：校验器放行（加语言只改语言清单与词表 YAML，校验逻辑不用动）' +
        (thirdProblems.length ? '；实际报了：' + firstLines(thirdProblems.join('\n'), 5) : ''),
    )

    // 正反对照：加语言时漏写某一族的 ja 段 → 必须报「缺语言段」，证明上面那条绿是真被校验过的。
    const missingOne: CopyConfig = JSON.parse(JSON.stringify(c3)) as CopyConfig
    delete missingOne.families[0].texts[thirdId]
    const missingProblems: string[] = validateCopyConfig(missingOne, timeValues)
    const missingHit: boolean = missingProblems.some((s) => s.includes('缺语言段'))
    check(
      missingHit,
      '演练「加语言时漏写某族的 ja 段」：校验器按预期报「缺语言段」' +
        (missingHit ? '' : '；实际报了：' + (missingProblems.length ? firstLines(missingProblems.join('\n'), 5) : '一条都没报 —— 校验器对漏语言段是哑的')),
    )

    const rendered3: string = renderLocaleData(c3, timeValues)
    const langIds3: string[] = Object.keys(c3.languages.languages)
    const wantLangUnion: string = 'export type LocaleLang = ' + langIds3.map((id) => quoteTs(id)).join(' | ')
    check(
      rendered3.split('\n').indexOf(wantLangUnion) >= 0,
      '演练「加语言」：生成物的 LocaleLang 联合按清单顺序补上 ja（期望 `' + wantLangUnion + '`）',
    )
    const langsLine: string = (rendered3.match(/^export const LOCALE_LANGS: .*$/m) || [''])[0]
    check(langsLine.indexOf(quoteTs(thirdId)) >= 0, '演练「加语言」：生成物 LOCALE_LANGS 自动含 ja')

    // 语言清单里的 label / fallback 要逐字进生成物（否则「显示名」这类信息就断在生成器里了）。
    const langBlockLines: string[] = [
      '    ' + quoteTs(thirdId) + ': Object.freeze({',
      '      label: Object.freeze({ zh: ' + quoteTs('日本語') + ', en: ' + quoteTs('Japanese') + ' }),',
      '      fallback: Object.freeze(' + JSON.stringify(['en']) + ') as ReadonlyArray<string>,',
    ]
    check(
      langBlockLines.every((line) => rendered3.indexOf(line) >= 0),
      '演练「加语言」：生成物 LANG_CONFIG 里 ja 的 label / fallback 逐字来自语言清单',
    )
    const familySegCount: number = (rendered3.match(/^\/\/ ===== family: /gm) || []).length
    check(
      familySegCount === c3.families.length,
      '演练「加语言」：生成物仍是每族一段（' + familySegCount + ' 段 = ' + c3.families.length + ' 族）',
    )
    // 每族常量与合并词表都自动多出 ja 一份：族数 × 语言数，不用改任何渲染分支。
    const jaDictCount: number = countOccurrences(rendered3, '  ' + quoteTs(thirdId) + ': {\n')
    check(
      jaDictCount === c3.families.length,
      '演练「加语言」：每个族常量里都有 ja 段（' + jaDictCount + ' 段 = ' + c3.families.length + ' 族）',
    )
    check(
      rendered3.indexOf('  ' + quoteTs(thirdId) + ': Object.assign({}, ') >= 0,
      '演练「加语言」：合并词表 LOCALE_COPY 自动多出 ja 一份',
    )
    const firstKey: string = Object.keys(c3.families[0].texts[langIds3[0]] || {})[0]
    const firstKeyCount: number = countOccurrences(rendered3, quoteTs(firstKey) + ':')
    check(
      firstKeyCount === langIds3.length,
      '演练「加语言」：每族每个键在生成物里出现次数 = 语言数（' + quoteTs(firstKey) + ' 出现 ' + firstKeyCount + ' 次）',
    )
    info('演练「加语言」的产出只来自 config/：渲染只读了配置对象与中央时间参数，没有任何 .ts 源码参与 —— 这就是「加语言不用改代码」的依据')
  }

  // —— ④ 生成物与真源一致 ——
  let generatedText: string = ''
  try {
    generatedText = fs.readFileSync(GENERATED_FILE, 'utf8')
    check(true, '读得到生成物 ' + LOCALE_DATA_REL + '（' + generatedText.length + ' 字节）')
  } catch (e) {
    check(false, '读不到生成物 ' + LOCALE_DATA_REL + '：' + (e as Error).message + ' —— 先跑 node ' + GENERATOR_REL)
  }
  if (generatedText) {
    const expected: string = renderLocaleData(config, timeValues) + '\n'
    check(
      generatedText === expected,
      '生成物与内存渲染逐字相等（同一份真源、同一份渲染；对不上说明盘上的生成物不是现在这份 YAML 的产物）',
    )
    check(generatedText.indexOf('{{') < 0, '生成物里没有残留的 {{时间参数}} 占位符（生成时已烘成字面量）')

    // 当模块载入：拿到的是运行时真正会读到的数据，比较时一个字都不用自己解码。
    let generated: Record<string, unknown> | null = null
    try {
      generated = (await import(pathToFileURL(GENERATED_FILE).href)) as Record<string, unknown>
      check(true, '生成物能当模块载入（用它逐语言逐键比 YAML 解析值）')
    } catch (e) {
      check(false, '生成物载不进来：' + (e as Error).message)
    }

    if (generated) {
      // 语言清单：LOCALE_LANGS / LocaleLang / LANG_CONFIG 三样都要与 config/languages.yaml 对得上。
      const genLangs: unknown = generated.LOCALE_LANGS
      check(
        Array.isArray(genLangs) && sortedEqual(genLangs.map(String), langIds),
        '生成物 LOCALE_LANGS 与 ' + LANGUAGES_REL + ' 的语言清单逐项相等（' + langIds.join(' / ') + '）',
      )
      const langLine: string = (generatedText.match(/^export type LocaleLang = .*$/m) || [''])[0]
      const langLineIds: string[] = []
      {
        const re = /'([^']+)'/g
        let m: RegExpExecArray | null
        while ((m = re.exec(langLine)) !== null) langLineIds.push(m[1])
      }
      check(
        sortedEqual(langLineIds, langIds),
        '生成物 LocaleLang 联合类型与语言清单逐项相等（' + (langLine || '没找到这一行') + '）',
      )

      const langConfig: Record<string, unknown> = (generated.LANG_CONFIG || {}) as Record<string, unknown>
      const problems: string[] = []
      if (langConfig.default !== config.languages.default) {
        problems.push('default 是 ' + JSON.stringify(langConfig.default) + '，清单写的是 ' + JSON.stringify(config.languages.default))
      }
      const table: Record<string, unknown> = (langConfig.languages || {}) as Record<string, unknown>
      if (!sortedEqual(Object.keys(table), langIds)) {
        problems.push('语言 id 集合对不上：生成物 [' + Object.keys(table).join(', ') + ']，清单 [' + langIds.join(', ') + ']')
      }
      for (const id of langIds) {
        const want = config.languages.languages[id]
        const got = (table[id] || {}) as { label?: Record<string, string>; fallback?: unknown }
        if (!got.label || got.label.zh !== want.label.zh || got.label.en !== want.label.en) {
          problems.push(id + ' 的 label 对不上（生成物 ' + JSON.stringify(got.label) + '，清单 ' + JSON.stringify(want.label) + '）')
        }
        const gotFallback: unknown[] = Array.isArray(got.fallback) ? (got.fallback as unknown[]) : []
        if (gotFallback.map(String).join('|') !== want.fallback.join('|')) {
          problems.push(id + ' 的 fallback 对不上（生成物 ' + JSON.stringify(gotFallback) + '，清单 ' + JSON.stringify(want.fallback) + '）')
        }
      }
      check(problems.length === 0, '生成物 LANG_CONFIG（default / 语言 id / label / fallback）与 ' + LANGUAGES_REL + ' 逐字段相等' +
        (problems.length ? '：' + problems.join('；') : ''))

      // 每族：段头、类型联合、L_ 常量、每门语言的每个键值。
      const familyProblems: string[] = []
      const constantProblems: string[] = []
      for (const fam of config.families) {
        const section: string = familySection(generatedText, fam.family)
        if (!section) {
          familyProblems.push('生成物里没有词族「' + fam.family + '」的段头（期望 `' + FAMILY_MARK_PREFIX + fam.family + ' (' + fam.rel + ') =====`）')
          continue
        }
        const typeName: string = 'LocaleKey' + pascal(fam.family)
        const constName: string = 'L_' + fam.family.toUpperCase()
        const expectedKeys: string[] = Object.keys(fam.texts[langIds[0]] || {}).slice().sort()
        const unionKeys: string[] = typeUnionKeys(section, typeName)
        if (!sortedEqual(unionKeys, expectedKeys)) {
          familyProblems.push(fam.family + ' 的 ' + typeName + ' 键联合与 YAML 对不上（生成物 ' + unionKeys.length + ' 条，YAML ' + expectedKeys.length + ' 条）')
        }
        const annotationRe = new RegExp(
          '^export const ' + constName + ': Readonly<Record<LocaleLang, Readonly<Record<' + typeName + ', string>>>> = Object\\.freeze\\(\\{$',
          'm',
        )
        if (!annotationRe.test(section)) {
          familyProblems.push(fam.family + ' 的常量声明不是约定形状（期望 `export const ' + constName + ': Readonly<Record<LocaleLang, Readonly<Record<' + typeName + ', string>>>>`）')
        }
        // 每个键在段内以 `'键': '值'` 的形状出现「语言数」次：既核文本形状，也核每门语言的值。
        for (const key of expectedKeys) {
          const wantCount: number = langIds.length
          const gotCount: number = countOf(section, quoteTs(key) + ':')
          if (gotCount !== wantCount) {
            familyProblems.push(fam.family + ' 的键「' + key + '」在段内出现 ' + gotCount + ' 次（期望 ' + wantCount + ' 次：每门语言各一次）')
            continue
          }
          for (const lang of langIds) {
            const raw: string = String((fam.texts[lang] || {})[key])
            const resolved: string = resolveTimeTokens(raw, timeValues as Record<string, number>).text
            const wantLine: string = '    ' + quoteTs(key) + ': ' + quoteTs(resolved) + ','
            if (section.indexOf(wantLine) < 0) {
              familyProblems.push(fam.family + ' 的「' + lang + '」段「' + key + '」文本与 YAML 解析值不相等（期望 ' + wantLine + '）')
            }
          }
        }
        // 模块载入后的真实数据：每门语言的键集合与每个值都要与 YAML 解析值完全相等。
        const exported = (generated as Record<string, unknown>)[constName]
        if (!exported || typeof exported !== 'object') {
          constantProblems.push('生成物没有导出常量 ' + constName + '（族 ' + fam.family + '）')
          continue
        }
        const langTable: Record<string, unknown> = exported as Record<string, unknown>
        if (!sortedEqual(Object.keys(langTable), langIds)) {
          constantProblems.push(constName + ' 的语言键与清单对不上：[' + Object.keys(langTable).join(', ') + ']')
        }
        for (const lang of langIds) {
          const dict: Record<string, unknown> = (langTable[lang] || {}) as Record<string, unknown>
          if (!sortedEqual(Object.keys(dict), expectedKeys)) {
            constantProblems.push(constName + '[' + lang + '] 的键集合与 YAML 对不上')
            continue
          }
          for (const key of expectedKeys) {
            const raw: string = String((fam.texts[lang] || {})[key])
            const resolved: string = resolveTimeTokens(raw, timeValues as Record<string, number>).text
            if (dict[key] !== resolved) {
              constantProblems.push(constName + '[' + lang + ']「' + key + '」的值与 YAML 不相等')
            }
          }
        }
      }
      check(familyProblems.length === 0, '每族段头 / 每族 LocaleKey<族> 键联合 / L_ 常量声明与文本形状逐项在位' +
        (familyProblems.length ? '：\n      ' + firstLines(familyProblems.join('\n'), 15) : ''))
      check(constantProblems.length === 0, '每族 L_<族大写> 导出值与 YAML 解析值逐语言逐键完全相等' +
        (constantProblems.length ? '：\n      ' + firstLines(constantProblems.join('\n'), 15) : ''))

      // 合并段：LocaleKey 联合覆盖全部族；LOCALE_COPY 每门语言一份、键集合与每族并集相等、值逐条相等。
      const mergeProblems: string[] = []
      const unionLine: string = (generatedText.match(/^export type LocaleKey = .*$/m) || [''])[0]
      const unionNames: string[] = []
      {
        const re = /LocaleKey[A-Za-z0-9]+/g
        let m: RegExpExecArray | null
        while ((m = re.exec(unionLine)) !== null) unionNames.push(m[0])
      }
      const wantUnion: string[] = config.families.map((f) => 'LocaleKey' + pascal(f.family)).sort()
      if (!sortedEqual(unionNames, wantUnion)) {
        mergeProblems.push('LocaleKey 联合类型与词族对不上（生成物 [' + unionNames.join(', ') + ']，期望 [' + wantUnion.join(', ') + ']）')
      }
      const merged: Record<string, unknown> = (generated.LOCALE_COPY || {}) as Record<string, unknown>
      if (!sortedEqual(Object.keys(merged), langIds)) {
        mergeProblems.push('LOCALE_COPY 的语言键与清单对不上：[' + Object.keys(merged).join(', ') + ']')
      }
      for (const lang of langIds) {
        const dict: Record<string, unknown> = (merged[lang] || {}) as Record<string, unknown>
        const wantKeys: string[] = []
        for (const fam of config.families) wantKeys.push(...Object.keys(fam.texts[lang] || {}))
        if (!sortedEqual(Object.keys(dict), wantKeys)) {
          mergeProblems.push('LOCALE_COPY[' + lang + '] 的键集合与全部词族并集对不上')
          continue
        }
        for (const fam of config.families) {
          for (const key of Object.keys(fam.texts[lang] || {})) {
            const resolved: string = resolveTimeTokens(String(fam.texts[lang][key]), timeValues as Record<string, number>).text
            if (dict[key] !== resolved) mergeProblems.push('LOCALE_COPY[' + lang + ']「' + key + '」与 YAML 不相等')
          }
        }
      }
      check(mergeProblems.length === 0, '合并段：LocaleKey 联合覆盖全部族、LOCALE_COPY 每门语言键值齐全且与 YAML 逐条相等' +
        (mergeProblems.length ? '：\n      ' + firstLines(mergeProblems.join('\n'), 15) : ''))
    }
  }

  // —— ⑥ 词族清单按目录自动发现 ——
  // 不手写名单：#1289 的教训是手写清单漏掉三份片段、65 条键没人管。这里直接数磁盘上的 YAML：
  // 「目录里有几份 = 读出来几个族 = 生成物里有几个段」，任一处对不上就红（漏读整份 YAML 最危险，
  // 生成物少了它，界面会印键名，而别的判据都还是绿的）。
  {
    const dirAbs: string = path.join(ROOT, COPY_DIR_REL)
    let yamlNames: string[] = []
    try {
      yamlNames = fs.readdirSync(dirAbs).filter((n) => /\.ya?ml$/i.test(n)).map((n) => n.replace(/\.ya?ml$/i, '')).sort()
    } catch (e) {
      check(false, '读不到真源目录 ' + COPY_DIR_REL + '/：' + (e as Error).message)
    }
    const familyNames: string[] = config.families.map((f) => f.family)
    check(
      sortedEqual(yamlNames, familyNames),
      '词族清单按目录发现：' + yamlNames.length + ' 份 YAML = ' + familyNames.length + ' 个读出来的族（不读手写清单）' +
        (sortedEqual(yamlNames, familyNames) ? '' : '；磁盘 [' + yamlNames.join(', ') + ']，读出来 [' + familyNames.join(', ') + ']'),
    )
    const sectionCount: number = countOf(generatedText, FAMILY_MARK_PREFIX)
    check(
      sectionCount === familyNames.length,
      '生成物里的族段数 = 词族数（' + sectionCount + ' = ' + familyNames.length + '；段头 `' + FAMILY_MARK_PREFIX + '<族> (' + COPY_DIR_REL + '/<族>.yaml) =====`）',
    )
    check(generatedText.indexOf(LANG_SECTION_MARK) >= 0 && generatedText.indexOf(MERGE_SECTION_MARK) >= 0,
      '生成物里有语言清单段与合并词表段（加语言只改 YAML，这两段由生成器产出）')
  }

  // —— ⑦ 语言清单驱动注册 ——
  // 「加一门语言只改 YAML，不改代码」的可判部分：
  //   · 注册处按生成物里的清单逐门注册，代码里不出现 'zh' / 'en' 字面量分支（注释已抹掉，只认代码）；
  //   · index.ts 先拼 localeData 再拼 locale（合并词表得在取词助手之前到位）。
  {
    const indexRel: string = 'src/client/index.ts'
    const localeRel: string = 'src/client/kernel/locale.ts'
    let indexMasked: string = ''
    let localeMasked: string = ''
    try {
      indexMasked = maskComments(fs.readFileSync(path.join(ROOT, indexRel), 'utf8'))
      localeMasked = maskComments(fs.readFileSync(path.join(ROOT, localeRel), 'utf8'))
    } catch (e) {
      check(false, '读不到注册处源码：' + (e as Error).message)
    }
    if (indexMasked && localeMasked) {
      check(indexMasked.indexOf('localeAdopt(') >= 0,
        indexRel + ' 的 locale 注册走 localeAdopt（按语言清单逐门 addLanguage + register，见 #1290 的实施决定）')
      check(localeMasked.indexOf('LANG_CONFIG.languages') >= 0 && localeMasked.indexOf('languageIds()') >= 0,
        localeRel + ' 从生成物 LANG_CONFIG.languages 算语言清单（languageIds/languageLabelOf/localeAdopt 都按它走）')

      const hardLangRe = /['"](?:zh|en)['"]/g
      const hardSites: string[] = []
      for (const [rel, text] of [[indexRel, indexMasked], [localeRel, localeMasked]] as Array<[string, string]>) {
        let m: RegExpExecArray | null
        hardLangRe.lastIndex = 0
        while ((m = hardLangRe.exec(text)) !== null) hardSites.push(rel + ':' + lineOf(text, m.index))
      }
      check(hardSites.length === 0,
        '注册处代码里没有写死的 \'zh\' / \'en\' 字面量（加语言只改 ' + LANGUAGES_REL + '）' +
          (hardSites.length ? '：' + hardSites.slice(0, 8).join('、') : ''))

      const addLangRe = /addLanguage\s*\(\s*['"]/g
      const addLangSites: string[] = []
      let am: RegExpExecArray | null
      while ((am = addLangRe.exec(localeMasked)) !== null) addLangSites.push(localeRel + ':' + lineOf(localeMasked, am.index))
      check(addLangSites.length === 0,
        'addLanguage 的入参来自语言清单而不是写死的 id（代码里 0 处 addLanguage(\'<语言 id>\')）' +
          (addLangSites.length ? '：' + addLangSites.join('、') : ''))

      // 两个拼接标记本身就是注释行，所以这一条要在原文里找，不能用抹掉注释的文本。
      const rawIndex: string = fs.readFileSync(path.join(ROOT, indexRel), 'utf8')
      const dataMark: number = rawIndex.indexOf('// ==== kernel:localeData (spliced by build) ====')
      const localeMark: number = rawIndex.indexOf('// ==== kernel:locale (spliced by build) ====')
      check(dataMark >= 0 && localeMark >= 0 && dataMark < localeMark,
        indexRel + ' 先拼 kernel:localeData 再拼 kernel:locale（合并词表 LOCALE_COPY 要先于取词助手到位）')
    }
  }

  // —— ⑧ 语言写死清零 ——
  // 口径按 Lead 定的 (a)：只拦字面形状 `promptLang()` 与语言字面量的比较，不扩大到
  // `lg === 'en'` 这类通用二元判断（那是内容表取词，运行时的链式取词另有判据）。
  // 扫的是 src/ 下手写 TypeScript（.d.ts 与三份生成物跳过；.js 是构建产物、判据不读产物）。
  {
    const files: string[] = listHandwrittenSources()
    const sites: string[] = []
    for (const rel of files) {
      let masked: string
      try {
        masked = maskComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
      } catch (e) {
        check(false, '清零扫描读不到 ' + rel + '：' + (e as Error).message)
        continue
      }
      let m: RegExpExecArray | null
      PROMPT_LANG_CMP.lastIndex = 0
      while ((m = PROMPT_LANG_CMP.exec(masked)) !== null) {
        sites.push(rel + ':' + lineOf(masked, m.index) + '（' + m[0].replace(/\s+/g, ' ') + '）')
      }
    }
    check(
      sites.length === 0,
      'src/ 下手写 TypeScript 里 0 处 promptLang() 与语言字面量的比较（扫了 ' + files.length + ' 个文件；加第三门语言时这类判断会露馅）' +
        (sites.length ? '：\n      ' + firstLines(sites.join('\n'), 15) : ''),
    )
  }

  // —— ⑨ 旧片段不并存 ——
  // 真源只有 config/copy/*.yaml 一处。旧片段要是哪天被谁「顺手」恢复回来，就是两份真源并存，
  // 改哪边都不生效 —— 这种文件本地不会报错，只能靠门禁当场点名。
  {
    const kernelAbs: string = path.join(ROOT, 'src/client/kernel')
    let leftovers: string[] = []
    try {
      leftovers = fs.readdirSync(kernelAbs).filter((n) => /^locale-.*\.(ts|js)$/.test(n) && n !== 'locale-data.ts' && n !== 'locale-data.d.ts')
    } catch (e) {
      check(false, '读不到 src/client/kernel/：' + (e as Error).message)
    }
    check(
      leftovers.length === 0,
      '旧界面词表片段已全部删掉（src/client/kernel/ 下不再有 locale-<族>.ts，真源只剩 ' + COPY_DIR_REL + '/）' +
        (leftovers.length ? '：' + leftovers.join('、') : ''),
    )
  }
}

console.log(failed ? '\n存在失败（' + passCount + '/' + totalCount + ' 通过）' : '\n全部通过（' + passCount + '/' + totalCount + '）')
process.exit(failed ? 1 : 0)
