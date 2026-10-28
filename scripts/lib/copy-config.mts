// scripts/lib/copy-config.mts —— 界面词表配置的读取与校验（#1294 立）。
//
// #1294 把界面词表的真源从 src/client/kernel/ 下的十份 locale-*.ts 片段搬到了 config/copy/ 下的
// 十份 YAML（每个「词族」一份），并让语言清单 config/languages.yaml 成为提示词与界面共用的唯一一份
// 语言表。本文件是生成器（scripts/generate-locale-config.mts）与门禁共用的读取 + 校验入口，
// 两处不各写一份规则 —— 否则生成器放过去的东西，门禁可能判红，反过来也一样。
//
// 目录约定（新增一类界面文案时只加一份 YAML，不改这个文件、也不改生成器）：
//   config/copy/<词族>.yaml     每份 YAML 的顶层是语言 id（今天 zh / en，加语言先改 config/languages.yaml），
//                               语言段下面是「词条键 → 文案」的平铺映射，键名沿用组件里 tr('键名') 的写法。
//   词族名就是文件名（不含扩展名），例如 panel / cards / vcwrite；生成物里每族一段，段头标着来源文件。
//
// 三件事必须由这里统一判（生成器写文件前跑一遍，门禁 --check 时也跑一遍）：
//   1. 语言完备：config/languages.yaml 列了几门语言，每份 YAML 就必须有这几门语言的段，段里键集合一致。
//      #1289 的教训是「门禁自己手写文件清单」，漏了两份片段，65 条键没人管；这里改成按目录自动发现。
//   2. 占位符一致：同一个键在各语言里出现的 {name} 占位符必须同名同数，否则一种语言能替换、另一种替换不了。
//   3. 时间参数引用可解析：YAML 里允许写 {{时间参数名}} 或 {{时间参数名/1000}}（后者把毫秒换成秒），
//      生成时替换成烘死的字面量。写错名字当场判红，不静默留一个占位符给用户看。
//
// 为什么不在运行时读 YAML：插件安装后拿不到仓库里的 config 目录（也可能被用户改坏），
//   而界面文案要跟着构建产物走；所以生成物随客户端闭包一起发出去，YAML 只作开发期真源。
//   这条取舍见 docs/adr/20261020-ui-copy-data-driven.md §2.1。

import * as fs from 'node:fs'
import * as path from 'node:path'
import yaml from 'yaml'
import {
  readLanguageYaml,
  validateLanguageData,
  collectPlaceholderNames,
  type LanguageConfig,
} from './prompt-config.mts'

/** 界面词表的真源目录（仓库相对路径）。 */
export const COPY_DIR_REL = 'config/copy'

/** 生成物路径（仓库相对路径）—— 不入库，构建时现场生成。 */
export const LOCALE_DATA_REL = 'src/client/kernel/locale-data.ts'

/** 中央时间参数的生成物路径（仓库相对路径）—— 词表里的 {{...}} 引用从它取数。 */
export const TIME_VALUES_REL = 'src/shared/time-config/src/values.ts'

/**
 * 词表里引用中央时间参数的写法：{{名字}} 取原值，{{名字/1000}} 取「原值除以 1000」。
 * 只允许整数字面量与一个整数除数，够今天「毫秒参数在文案里要说成秒」这一种用法，
 * 不在这里做通用表达式求值 —— 那是又一处只有本文件知道怎么读的隐藏语法。
 */
const TOKEN_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*)(?:\/(\d+))?\}\}/g

/** 一份词族 YAML：族名、来源相对路径、每种语言一份「键 → 文案」。 */
export interface CopyFamily {
  /** 词族名，等于文件名去掉扩展名，例如 panel / cards。 */
  family: string
  /** 仓库相对路径，例如 config/copy/panel.yaml。 */
  rel: string
  /** 语言 id → 该语言的词条表。键集合在 validateCopyConfig 里逐语言对账。 */
  texts: Record<string, Record<string, string>>
}

/** 读出来的全套界面词表：语言清单 + 按目录发现的所有词族。 */
export interface CopyConfig {
  languages: LanguageConfig
  /** 按文件名字典序排列（生成物顺序因此稳定，同一次输入永远产出同一份字节）。 */
  families: CopyFamily[]
}

/** 一份生成好的词条：生成时已经把 {{时间参数}} 换成了烘死的字面量，运行时只当普通字符串用。 */
export type ResolvedText = string

/** 按文件名字典序读 config/copy/ 下的全部 YAML；读不到目录或一份都没有时直接抛错。 */
export function readCopyYamls(repoRoot: string): CopyFamily[] {
  const dir: string = path.join(repoRoot, COPY_DIR_REL)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    throw new Error('读不到界面词表目录 ' + COPY_DIR_REL + '/：界面文案的真源缺一不可（#1294）')
  }
  // 只收 .yaml：生成物段标记与 tests/lib/locale-data.ts 都按 `<族>.yaml` 拼（#1294 的目录约定）。
  //   放开 .yml 会让「目录里能放、段标记却找不到」两套口径打架，宁可这里直接不收。
  const files: string[] = names
    .filter((n) => n.endsWith('.yaml'))
    .sort()
  if (files.length === 0) {
    throw new Error(COPY_DIR_REL + '/ 下没有任何 YAML：界面文案的真源缺一不可（#1294）')
  }
  const out: CopyFamily[] = []
  for (const name of files) {
    const rel: string = COPY_DIR_REL + '/' + name
    const family: string = name.replace(/\.yaml$/i, '')
    let doc: unknown
    try {
      doc = yaml.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8')) as unknown
    } catch (err) {
      throw new Error('读不了或解析不了 ' + rel + '：' + (err instanceof Error ? err.message : String(err)))
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error(rel + ' 顶层必须是对象：键是语言 id（zh / en ...），值是「词条键 → 文案」的映射')
    }
    const texts: Record<string, Record<string, string>> = {}
    for (const lang of Object.keys(doc as Record<string, unknown>)) {
      const section: unknown = (doc as Record<string, unknown>)[lang]
      if (!section || typeof section !== 'object' || Array.isArray(section)) {
        throw new Error(rel + ' 的语言段「' + lang + '」必须是对象：键是词条键、值是文案字符串')
      }
      const table: Record<string, string> = {}
      for (const key of Object.keys(section as Record<string, unknown>)) {
        const value: unknown = (section as Record<string, unknown>)[key]
        // 读盘这一层就判类型：非字符串值不许先塞进 string 表、指望下游 validate 再兜
        // （renderLocaleData 是导出的，调用方跳过 validate 时会把 undefined 写成字面量）。
        if (typeof value !== 'string') {
          throw new Error(rel + ' 的语言段「' + lang + '」里词条「' + key + '」不是字符串：界面文案只能是字符串')
        }
        table[key] = value
      }
      texts[lang] = table
    }
    out.push({ family, rel, texts })
  }
  return out
}

/**
 * 一次性读全套：语言清单 + 按目录发现的全部词族。
 * 与 readPromptConfig 同款：这是生成器与门禁共用的入口，不各写一份读盘逻辑。
 */
export function readCopyConfig(repoRoot: string): CopyConfig {
  return { languages: readLanguageYaml(repoRoot), families: readCopyYamls(repoRoot) }
}

/** 读中央时间参数的生成物，得到「参数名 → 数值」；读不到文件时抛错并让人先跑时间生成器。 */
export function readTimeValues(repoRoot: string): Record<string, number> {
  const abs: string = path.join(repoRoot, TIME_VALUES_REL)
  let text: string
  try {
    text = fs.readFileSync(abs, 'utf8')
  } catch {
    throw new Error('读不到 ' + TIME_VALUES_REL + '：词表里的 {{时间参数}} 引用要先有一份时间参数生成物，'
      + '请先跑 node scripts/generate-time-config.mts')
  }
  const out: Record<string, number> = {}
  const re: RegExp = /^export const ([A-Za-z_][A-Za-z0-9_]*): number = (-?\d+(?:\.\d+)?);/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out[m[1]] = Number(m[2])
  }
  if (Object.keys(out).length === 0) {
    throw new Error(TIME_VALUES_REL + ' 里没解析出任何 export const 数字常量：这个文件可能换了生成格式，'
      + '请同步改 scripts/lib/copy-config.mts 的 readTimeValues')
  }
  return out
}

/**
 * 把一段词条里的 {{时间参数}} / {{时间参数/1000}} 换成烘死的字面量。
 * 返回替换后的文本与遇到的未知参数名（未知时不抛，交给 validateCopyConfig 汇总成一份错误清单）。
 */
export function resolveTimeTokens(text: string, timeValues: Record<string, number>): { text: string; unknown: string[] } {
  const unknown: string[] = []
  const resolved: string = String(text).replace(TOKEN_RE, (_whole: string, name: string, divide: string | undefined): string => {
    const raw: number | undefined = timeValues[name]
    if (typeof raw !== 'number') {
      if (unknown.indexOf(name) < 0) unknown.push(name)
      return _whole
    }
    const divisor: number = divide ? Number(divide) : 1
    if (!Number.isInteger(divisor) || divisor <= 0) {
      if (unknown.indexOf(name + '/' + divide) < 0) unknown.push(name + '/' + divide)
      return _whole
    }
    return String(raw / divisor)
  })
  return { text: resolved, unknown }
}

/**
 * 界面文案里的「裸时长」判据：写死的数字后面直接跟时间单位。
 *
 * 为什么要查：文案里的时长必须写成 {{参数名}} 或 {{参数名/1000}} 引用中央时间参数，
 * 否则参数一调文案就开始撒谎。#1160 修过的两处真实事故就是这样来的——调试开关的
 * 「宿主超过 5 秒没有回应」在等待提到 10 秒之后还在说 5 秒；技能详情的「正在排版…（超过
 * 2 秒）」与排版骨架阈值各写各的。这里只看「数字 + 单位」的写法；「半秒」「一天」
 * 「a day」这类文字化时长不在机械检查范围内，靠评审（边界写进
 * src/shared/time-config/README.md 的约定一节）。
 */
const CN_DURATION_RE = /(\d[\d_]*(?:\.\d+)?)\s*(毫秒|秒钟|秒|分钟|小时|天|周)/g
// 末尾的 s 是英文缩写（旧文案里的「over 2s」）：只认数字后面紧跟单位这一种形态，
// 「1980s」这类年代写法在界面词表里不出现，真出现时人为改成不写时长的说法即可。
const EN_DURATION_RE = /(\d[\d_]*(?:\.\d+)?)\s*(ms|msec|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks|s)\b/gi

/** 在一段文案里找出写死的时长片段；已写成 {{...}} 占位符的部分不参与匹配。 */
export function findHardcodedDurations(text: string): string[] {
  const stripped: string = String(text).replace(TOKEN_RE, ' ')
  const hits: string[] = []
  for (const m of stripped.matchAll(CN_DURATION_RE)) hits.push(m[0].trim())
  for (const m of stripped.matchAll(EN_DURATION_RE)) hits.push(m[0].trim())
  return hits
}

/**
 * 校验读出来的界面词表。返回错误清单（空数组 = 通过），不抛 —— 生成器在写之前跑一遍、
 * 门禁在 --check 时跑一遍，怎么报红由调用方决定。
 */
export function validateCopyConfig(config: CopyConfig, timeValues: Record<string, number>): string[] {
  const out: string[] = []
  out.push(...validateLanguageData(config.languages))
  const langIds: string[] = Object.keys(config.languages && config.languages.languages ? config.languages.languages : {})
  if (langIds.length === 0) {
    // validateLanguageData 已经判红并说明原因；这里不再叠一条。
    return out
  }
  if (!Array.isArray(config.families) || config.families.length === 0) {
    out.push(COPY_DIR_REL + '/ 下没有任何词族 YAML：界面文案的真源缺一不可（#1294）')
    return out
  }
  // 跨族重复键：同一个键在两张 YAML 里都写，合并词表时后写的会静默覆盖前写的 —— 这种「写了不生效」
  //   要当场判红，而不是等有人发现某条文案改了没反应。
  const keyOwner: Map<string, string> = new Map()
  for (const fam of config.families) {
    if (!fam.family || !/^[a-z][a-z0-9-]*$/.test(fam.family)) {
      out.push(fam.rel + ' 的文件名（词族名）必须是「小写字母开头、只含小写字母数字连字符」')
      continue
    }
    const present: string[] = Object.keys(fam.texts)
    for (const lang of present) {
      if (langIds.indexOf(lang) < 0) {
        out.push(fam.rel + ' 里出现了语言清单之外的语言段「' + lang + '」：要加语言先改 config/languages.yaml，再给每份词表补这一段')
      }
    }
    for (const lang of langIds) {
      if (present.indexOf(lang) < 0) {
        out.push(fam.rel + ' 缺语言段「' + lang + '」：语言清单里有 ' + langIds.join(' / ') + ' 门语言，每份词表都必须齐（缺一门就是漏译）')
      }
    }
    if (present.length === 0) continue
    // 每族的键集合以「语言清单里的第一门语言」为准逐门对账。
    const reference: string = present.indexOf(langIds[0]) >= 0 ? langIds[0] : present[0]
    const referenceKeys: string[] = Object.keys(fam.texts[reference] || {})
    if (referenceKeys.length === 0) {
      out.push(fam.rel + ' 的「' + reference + '」段没有任何词条：空词族没有存在意义')
    }
    for (const key of referenceKeys) {
      const owner: string | undefined = keyOwner.get(key)
      if (owner) {
        out.push('词条键「' + key + '」在 ' + owner + ' 和 ' + fam.rel + ' 里重复出现：合并词表时后写的会静默覆盖前写的')
      } else {
        keyOwner.set(key, fam.rel)
      }
      if (!key.trim() || /\s/.test(key)) {
        out.push(fam.rel + ' 的词条键「' + key + '」不能含空白字符（键名要能在 tr(\'...\') 里原样写出来）')
      }
    }
    // 逐语言：键集合一致、值是字符串、时间参数引用可解析、占位符一致。
    for (const lang of present) {
      const table: Record<string, string> = fam.texts[lang] || {}
      for (const key of Object.keys(table)) {
        if (referenceKeys.indexOf(key) < 0) {
          out.push(fam.rel + ' 的「' + lang + '」段多写了键「' + key + '」：「' + reference + '」段里没有它（两边键集合必须一致）')
        }
      }
      for (const key of referenceKeys) {
        if (!(key in table)) {
          out.push(fam.rel + ' 的「' + lang + '」段缺键「' + key + '」：「' + reference + '」段里有它（缺一门语言就是漏译）')
        }
      }
    }
    for (const lang of present) {
      const table: Record<string, string> = fam.texts[lang] || {}
      const byKey: Map<string, string[]> = new Map()
      for (const key of referenceKeys) {
        const raw: unknown = table[key]
        if (typeof raw !== 'string') {
          out.push(fam.rel + ' 的「' + lang + '」段「' + key + '」必须是字符串（实际是 ' + (raw === null ? 'null' : typeof raw) + '）')
          continue
        }
        for (const hit of findHardcodedDurations(raw)) {
          out.push(fam.rel + ' 的「' + lang + '」段「' + key + '」手写了时长「' + hit
            + '」：界面文案里的时间数字只能引用中央参数占位符（例如 {{NAME}} 或 {{NAME/1000}}），'
            + '或改成不写时长的说法；确需固定时长，先把键加进 config/ 下三份时间参数 YAML 再引用')
        }
        const resolved = resolveTimeTokens(raw, timeValues)
        for (const name of resolved.unknown) {
          out.push(fam.rel + ' 的「' + lang + '」段「' + key + '」引用了未知的时间参数「' + name
            + '」：名字必须与 ' + TIME_VALUES_REL + ' 里的 export const 一致')
        }
        byKey.set(key, collectPlaceholderNames(resolved.text))
      }
      // 占位符同名同数：同一族的各语言共用一个「键 → 占位符名单」的参照，参照取自参照语言。
      if (lang === reference) continue
      const referenceByKey: Map<string, string[]> = new Map()
      const referenceTable: Record<string, string> = fam.texts[reference] || {}
      for (const key of referenceKeys) {
        const rawRef: unknown = referenceTable[key]
        if (typeof rawRef !== 'string') continue
        referenceByKey.set(key, collectPlaceholderNames(resolveTimeTokens(rawRef, timeValues).text))
      }
      for (const key of referenceKeys) {
        const mine: string[] = byKey.get(key) || []
        const theirs: string[] = referenceByKey.get(key) || []
        if (mine.slice().sort().join(',') !== theirs.slice().sort().join(',')) {
          out.push(fam.rel + ' 的「' + key + '」占位符两边不一致：「' + reference + '」有 ['
            + theirs.join(', ') + ']，「' + lang + '」有 [' + mine.join(', ') + ']')
        }
      }
    }
  }
  return out
}

/**
 * 把一份字符串写成 TypeScript 单引号字面量。
 *
 * 为什么不用 JSON.stringify（双引号）：旧词表片段里的键值都是单引号写法，仓里有一批门禁按
 * `'键': '值'` 的文本形状扫描（例如检查某条文案在不在产物里）。生成物保持同一种文本形状，
 * 这些判据经 tests/lib/source-text.ts 的旧路径映射就能继续工作，不必重写。
 */
export function quoteTs(text: string): string {
  return '\'' + String(text)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n') + '\''
}

/** 词族名 → 生成物里的类型名后缀：panel → Panel，vcwrite → Vcwrite。 */
function pascal(family: string): string {
  return family.charAt(0).toUpperCase() + family.slice(1)
}

/**
 * 把全套界面词表渲染成生成物源码文本（src/client/kernel/locale-data.ts）。
 *
 * 生成物形状（生成器、构建、门禁三方都依赖，改形状要三处一起改）：
 *   · 语言清单段：LANG_CONFIG（与 config/languages.yaml 逐字对应）、LocaleLang 联合、LOCALE_LANGS
 *   · 每族一段：段头固定是 `// ===== family: <族> (config/copy/<族>.yaml) =====`，
 *     段里是 LocaleKey<族> 键联合类型 + 旧名常量 L_<族大写>（L_PANEL / L_CARDS ...）
 *   · 合并段：LocaleKey 总联合 + LOCALE_COPY（每门语言一份合并词表）
 *
 * 生成物里键是字面量键的联合类型，值要求「每门语言都有一份」：漏译一个键，编译期当场红。
 */
export function renderLocaleData(config: CopyConfig, timeValues: Record<string, number>): string {
  const lines: string[] = []
  const langIds: string[] = Object.keys(config.languages.languages || {})
  const families: CopyFamily[] = config.families.slice().sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0))

  lines.push('// locale-data.ts —— 界面词表的生成源码（#1294 立；构建时现场生成、不入库）。')
  lines.push('//')
  lines.push('// 人手不改：本文件由 scripts/generate-locale-config.mts 按 config/languages.yaml 与 config/copy/ 下的')
  lines.push('// 每族 YAML 写出。想改界面文案请改 YAML 再跑生成器；漏改 YAML 直接手改这里的话，下一次生成会被覆盖，')
  lines.push('// typecheck 头一步的生成器 --check 也会判红，所以不要在源码里手工改这一段。')
  lines.push('//')
  lines.push('// 为什么生成物里带着语言清单（LANG_CONFIG）：客户端注册 dsws 命名空间时按这份清单逐门语言调用')
  lines.push('// 宿主的 addLanguage / register（#1290 的实施决定），代码里不写死有哪些语言；加语言只改')
  lines.push('// config/languages.yaml 与每份词表 YAML，再跑生成器。')
  lines.push('')
  lines.push('/* eslint-disable */')
  lines.push('/* tslint:disable */')
  lines.push('')

  // —— 语言清单段
  lines.push('// ===== 语言清单（config/languages.yaml）=====')
  lines.push('export interface LocaleLanguageEntry {')
  lines.push('  /** 显示给用户看的语言名，zh / en 各一份（今天界面语言只有这两门已知，第三门语言按清单补）。 */')
  lines.push('  label: { readonly zh: string; readonly en: string }')
  lines.push('  /** 回退链：这门语言缺译文时接着找哪一门；空数组表示没有上一级可退（链的终点）。 */')
  lines.push('  fallback: ReadonlyArray<string>')
  lines.push('}')
  lines.push('')
  lines.push('export interface LocaleLanguageConfig {')
  lines.push('  /** 缺省语言 id，必须是 languages 里的某一项。 */')
  lines.push('  default: string')
  lines.push('  languages: Readonly<Record<string, LocaleLanguageEntry>>')
  lines.push('}')
  lines.push('')
  lines.push('export type LocaleLang = ' + langIds.map((id) => quoteTs(id)).join(' | '))
  lines.push('')
  lines.push('export const LOCALE_LANGS: ReadonlyArray<LocaleLang> = Object.freeze([' + langIds.map((id) => quoteTs(id)).join(', ') + '])')
  lines.push('')
  lines.push('export const LANG_CONFIG: LocaleLanguageConfig = Object.freeze({')
  lines.push('  default: ' + quoteTs(config.languages.default) + ',')
  lines.push('  languages: Object.freeze({')
  for (const id of langIds) {
    const entry = config.languages.languages[id]
    lines.push('    ' + quoteTs(id) + ': Object.freeze({')
    lines.push('      label: Object.freeze({ zh: ' + quoteTs(entry.label.zh) + ', en: ' + quoteTs(entry.label.en) + ' }),')
    lines.push('      fallback: Object.freeze(' + JSON.stringify(entry.fallback) + ') as ReadonlyArray<string>,')
    lines.push('    }),')
  }
  lines.push('  }) as Readonly<Record<string, LocaleLanguageEntry>>,')
  lines.push('})')
  lines.push('')

  // —— 每族一段
  for (const fam of families) {
    const typeName: string = 'LocaleKey' + pascal(fam.family)
    const constName: string = 'L_' + fam.family.toUpperCase()
    const keys: string[] = Object.keys(fam.texts[langIds[0]] || {}).slice().sort()
    lines.push('// ===== family: ' + fam.family + ' (' + fam.rel + ') =====')
    lines.push('export type ' + typeName + ' =')
    for (const key of keys) {
      lines.push('  | ' + quoteTs(key))
    }
    lines.push('')
    lines.push('export const ' + constName + ': Readonly<Record<LocaleLang, Readonly<Record<' + typeName + ', string>>>> = Object.freeze({')
    for (const lang of langIds) {
      lines.push('  ' + quoteTs(lang) + ': {')
      for (const key of keys) {
        const raw: string = String((fam.texts[lang] || {})[key])
        const resolved = resolveTimeTokens(raw, timeValues)
        lines.push('    ' + quoteTs(key) + ': ' + quoteTs(resolved.text) + ',')
      }
      lines.push('  },')
    }
    lines.push('})')
    lines.push('')
  }

  // —— 合并段
  lines.push('// ===== 合并词表 =====')
  lines.push('// 每门语言一份「全部词族并起来」的字典：运行时按语言 id 直接取，不再逐族拼。')
  lines.push('export type LocaleKey = ' + families.map((fam) => 'LocaleKey' + pascal(fam.family)).join(' | '))
  lines.push('')
  lines.push('export const LOCALE_COPY: Readonly<Record<LocaleLang, Readonly<Record<LocaleKey, string>>>> = Object.freeze({')
  for (const lang of langIds) {
    const parts: string[] = families.map((fam) => 'L_' + fam.family.toUpperCase() + '[' + quoteTs(lang) + ']')
    lines.push('  ' + quoteTs(lang) + ': Object.assign({}, ' + parts.join(', ') + '),')
  }
  lines.push('})')
  lines.push('')
  return lines.join('\n')
}
