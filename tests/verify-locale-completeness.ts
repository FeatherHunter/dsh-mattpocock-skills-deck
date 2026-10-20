// verify-locale-completeness.ts —— locale 完整性门禁（#231 立，2026-10-20 #1294 重写）。
// 门禁归属: config/copy/
// 门禁归属: src/client/kernel/locale-data.ts
// 门禁归属: src/shared/matt-skills.ts
//
// 真源在哪：
//   #1294 起，界面词表的真源是 config/copy/ 下的十份 YAML（一个词族一份，文件名就是族名），
//   语言清单是 config/languages.yaml。旧的一批手写片段 src/client/kernel/locale-<族>.ts 已经全部
//   删掉，运行时读的是 scripts/generate-locale-config.mts 按这些 YAML 生成的
//   src/client/kernel/locale-data.ts（构建期现场生成、不入库）。
//
// 这扇门禁守的是「词表内容本身完整」——生成器的行为、生成物与 YAML 的生成关系由
// tests/verify-locale-config.ts 守，这里不重复它那套生成器细节，但会复核生成物里每条文案
// 的取值确实等于 YAML（含 {{时间参数}} 烘成的字面量），因为下面 A/B/F 这些老判据的产品
// 是「界面上真取得到的词条」，只查 YAML 不够。
//
// 保留的老判据（#231/#458/#621/#690/#818/#879 一路加过来的，一条没丢）：
//   A. 每门语言都齐（旧版是「每个键 zh/en 各出现一次」，新版按语言清单逐门对账）；
//   B. 本票关键键存在（旧版在双语源里查，新版每门语言段里都要有）+ #619 已删键不许复活；
//   C. 类型徽章能收到的每个类型值都有词条（#626 防复发）；
//   D. 双产物（client.js / package/lib/client.js）里关键键齐备；
//   A2. 词条结构：每族 YAML 的顶层语言段恰好是语言清单、各语言键集合相等、值必须是字符串
//       （旧版防的是「值放错层」，YAML 里换成了「值不是字符串」这种写法）；
//   F. 技能描述文案评审（名单从 src/shared/matt-skills.ts 真源取，黑名单与最短长度一起查）。
// 新增的 #1294 判据：
//   G. 词族按目录自动发现（不手写清单 —— #1289 的根因就是手写清单漏了三份片段、65 条键没人管）；
//   H. 旧片段不并存：src/client/kernel/locale-<族>.ts / .js 都已不存在；
//   I. 生成物存在、生成器 --check 通过、配置族数与生成物分段数一致、生成物里每条文案与 YAML 逐字相等。
//
// 原来还有一段 C：遍历 src/client 下的手写源码，逐文件数「字符串级中文」条数并与基线清单比对。
// 那盯的是源码文本的写法与条数（等价重构、搬文件、改引号、改注释都会变红），已按维护者要求整段删除。
//
// 跑法（在插件根目录执行）：
//   node --import ./scripts/ts-hook.mts tests/verify-locale-completeness.ts
//
// 判据强度对照表（旧判据 → 新判据，逐条可对；消失的中间自检为什么可接受）见
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
  resolveTimeTokens,
  validateCopyConfig,
} from '../scripts/lib/copy-config.mts'
import type { CopyConfig, CopyFamily } from '../scripts/lib/copy-config.mts'
import { sourcePath } from './lib/source-text.ts'

const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 词族 YAML 所在目录（按目录自动发现，不手写清单）。 */
const COPY_DIR: string = path.join(ROOT, COPY_DIR_REL)
/** 生成物：构建期现场生成的那一份 TypeScript 源码（不入库）。 */
const GENERATED_FILE: string = path.join(ROOT, LOCALE_DATA_REL)
/** 生成器脚本：G 段 spawn 它跑 --check，证明生成物与 YAML 一致。 */
const GENERATOR_REL: string = 'scripts/generate-locale-config.mts'
/**
 * 每门语言的词条数下限（棘轮）。今天的实际值是 1030；只许增不许减。
 * 旧门禁的门槛是「value-form 出现次数 > 600」（约 300 条键），随词表增长已经明显偏松，
 * 这里按今天的实际条数钉住，删词条必须显式改这个数字并在提交信息里说清理由。
 */
const MIN_KEYS_PER_LANGUAGE: number = 1030
/** 生成物里每族段头的形状（生成器与 tests/lib/locale-data.ts 都认这一行，改格式要三处一起改）。 */
const FAMILY_MARK_RE: RegExp = /^\/\/ ===== family: ([a-z][a-z0-9-]*) \(config\/copy\/([a-z][a-z0-9-]*)\.yaml\) =====$/m

// ---------------------------------------------------------------------------
// 输出与判定的小工具（与 tests/verify-prompt-config.ts / verify-locale-config.ts 同一套口径）
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

/** 两份字符串集合是否逐项相等（重复项算不相等 —— 重复会让后者静默覆盖前者）。 */
const sortedEqual = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean => {
  if (left.length !== right.length) return false
  const a = left.slice().sort()
  const b = right.slice().sort()
  return a.every((v, i) => v === b[i])
}

/** 取前 n 行，给错误信息用（错误信息太长会让人看不到重点）。 */
const firstLines = (text: string, n: number): string => {
  const lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  return lines.slice(0, n).join('；') + (lines.length > n ? '；…（共 ' + lines.length + ' 行）' : '')
}

/** 一门语言的全量词条（跨全部词族合并）；同键跨族重复会在下面单查，这里按先到先得装。 */
const collectTexts = (config: CopyConfig, lang: string): Record<string, string> => {
  const out: Record<string, string> = Object.create(null)
  for (const family of config.families) {
    const dict = family.texts[lang]
    if (!dict) continue
    for (const key of Object.keys(dict)) out[key] = dict[key]
  }
  return out
}

const main = async (): Promise<void> => {
  // =========================================================================
  // G. 真源发现与自校验（新增：#1289 的教训是把清单写死会漏词族）
  // =========================================================================
  console.log('== G. 词族按目录自动发现 + YAML 自校验 ==')
  let config: CopyConfig
  try {
    config = readCopyConfig(ROOT)
  } catch (e) {
    check(false, 'config/copy/ 读不起来：' + ((e && (e as Error).message) || e))
    return finish()
  }
  const langIds: string[] = Object.keys(config.languages.languages)
  const langCount: number = langIds.length
  const families: CopyFamily[] = config.families
  const familyNames: string[] = families.map((f) => f.family)

  let yamlFiles: string[] = []
  try {
    yamlFiles = fs
      .readdirSync(COPY_DIR)
      .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
      .sort()
  } catch (e) {
    check(false, '读不到 ' + COPY_DIR_REL + ' 目录：' + ((e && (e as Error).message) || e))
  }
  check(
    sortedEqual(
      familyNames.map((f) => f + '.yaml'),
      yamlFiles,
    ),
    '词族清单按目录自动发现：读出来的 ' + familyNames.length + ' 族与 ' + COPY_DIR_REL + ' 下的 YAML 份数逐项一致（' + (familyNames.join(' / ') || '空') + '）',
  )
  check(families.length > 0, '至少读得到一个词族（目录为空会让后面全部空过 —— 这条先把它钉住）')
  check(langCount > 0, '语言清单 config/languages.yaml 至少列出一门语言（今天：' + langIds.join(' / ') + '）')

  const timeValues = readTimeValues(ROOT)
  const configProblems: string[] = validateCopyConfig(config, timeValues)
  check(
    configProblems.length === 0,
    'YAML 自校验通过（语言段齐、键集合相等、值都是字符串、同键占位符一致、时间参数都认识、跨族无重复键）' +
      (configProblems.length ? '：' + firstLines(configProblems.join('\n'), 6) : ''),
  )
  info('词族 ' + families.length + ' 个、语言 ' + langCount + ' 门、每门 ' + collectCount(config, langIds[0] || '') + ' 条词条')

  // =========================================================================
  // A. 每门语言都齐（旧：「每个键 zh/en 各出现一次」；新：按语言清单逐门对账）
  // =========================================================================
  console.log('')
  console.log('== A. 每门语言的词条都齐（旧版「键 zh/en 各一次」按语言清单推广） ==')
  const textsByLang: Record<string, Record<string, string>> = Object.create(null)
  for (const lang of langIds) textsByLang[lang] = Object.create(null)
  const familyDiff: string[] = []
  for (const family of families) {
    const sectionLangs = Object.keys(family.texts)
    if (!sortedEqual(sectionLangs, langIds)) {
      familyDiff.push(family.family + ' 的语言段是 ' + sectionLangs.join('/') + '，语言清单是 ' + langIds.join('/'))
      continue
    }
    const keysOfFirst = Object.keys(family.texts[langIds[0]] || {})
    for (const lang of langIds) {
      const dict = family.texts[lang] || {}
      const onlyHere = Object.keys(dict).filter((k) => Object.keys(family.texts[langIds[0]] || {}).indexOf(k) < 0)
      const missingHere = keysOfFirst.filter((k) => !(k in dict))
      if (onlyHere.length || missingHere.length) {
        familyDiff.push(
          family.family + ' 的 ' + lang + ' 段与 ' + langIds[0] + ' 段键集合不等：多 ' + onlyHere.length + ' 条、缺 ' + missingHere.length + ' 条',
        )
      }
      for (const key of Object.keys(dict)) {
        if (!textsByLang[lang]) textsByLang[lang] = Object.create(null)
        if (!(key in textsByLang[lang])) textsByLang[lang][key] = dict[key]
      }
    }
  }
  check(familyDiff.length === 0, '每个词族的语言段恰好是语言清单里的 ' + langCount + ' 门，且同族各语言键集合相等' + (familyDiff.length ? '：' + firstLines(familyDiff.join('\n'), 4) : ''))

  // 每门语言的条数：互相对齐，且不低于棘轮下限。
  const counts: number[] = langIds.map((lang) => Object.keys(textsByLang[lang] || {}).length)
  check(
    new Set(counts).size === 1,
    '每门语言的词条数相同（' + langIds.map((l, i) => l + ' ' + counts[i]).join('，') + '）',
  )
  check(
    langIds.every((_, i) => counts[i] >= MIN_KEYS_PER_LANGUAGE),
    '每门语言的词条数不低于棘轮下限 ' + MIN_KEYS_PER_LANGUAGE + '（' + langIds.map((l, i) => l + ' ' + counts[i]).join('，') + '）',
  )

  // 跨族重复键在旧版是「合并时分不清谁盖了谁」的坑；validateCopyConfig 判过，这里独立复核一次。
  const dupAcrossFamilies: string[] = []
  const seenKey: Record<string, string> = Object.create(null)
  for (const family of families) {
    for (const key of Object.keys(family.texts[langIds[0]] || {})) {
      if (seenKey[key] && seenKey[key] !== family.family) dupAcrossFamilies.push(key + '（' + seenKey[key] + ' 与 ' + family.family + '）')
      else seenKey[key] = family.family
    }
  }
  check(dupAcrossFamilies.length === 0, '跨词族没有重复键（重复会让合并时后写的静默覆盖先写的）' + (dupAcrossFamilies.length ? '：' + firstLines(dupAcrossFamilies.join('\n'), 4) : ''))

  // =========================================================================
  // A2. 词条结构：值必须是字符串、占位符各语言一致（旧版防「值放错层」）
  // =========================================================================
  console.log('')
  console.log('== A2. 词条结构：值必须是字符串、占位符各语言一致、时间参数都认识 ==')
  const structureProblems: string[] = []
  const placeholderProblems: string[] = []
  /** 文案为空的「族/语言/键」：下面按「同键是否有的语言空、有的不空」判漏译。 */
  const emptyValues: string[] = []
  const emptyMismatch: string[] = []
  for (const family of families) {
    for (const lang of langIds) {
      const dict = family.texts[lang] || {}
      for (const key of Object.keys(dict)) {
        const value: unknown = dict[key]
        if (typeof value !== 'string') {
          structureProblems.push(family.family + '/' + lang + '/' + key + ' 的值不是字符串（是 ' + (value === null ? 'null' : typeof value) + '）')
          continue
        }
        if (!value.trim()) {
          // 空串不是错：有些键在某个后端下本来就没有可用文案（例如 setup.markdown.labelReqs
          //   在 Markdown 后端不需要标签要求那一行，真源一直是 ''）。但「同一键有的语言空、
          //   有的语言有字」是漏译的形状 —— 那才判红，见下面 emptyMismatch。
          emptyValues.push(family.family + '/' + lang + '/' + key)
        }
        const resolved = resolveTimeTokens(value, timeValues)
        if (resolved.unknown.length) structureProblems.push(family.family + '/' + lang + '/' + key + ' 用了不认识的时间参数：' + resolved.unknown.join('、'))
        if (resolved.text.indexOf('{{') >= 0) structureProblems.push(family.family + '/' + lang + '/' + key + ' 解析后还留着 {{...}}：' + resolved.text.slice(0, 60))
      }
    }
    // 同键各语言的 {name} 之类占位符必须一致（语言里少写一个占位符 = 那条文案永远填不上值）。
    const firstDict = family.texts[langIds[0]] || {}
    for (const key of Object.keys(firstDict)) {
      const baseline = placeholderNames(firstDict[key])
      for (const lang of langIds.slice(1)) {
        const other = placeholderNames((family.texts[lang] || {})[key])
        if (!sortedEqual(baseline, other)) placeholderProblems.push(family.family + '/' + key + '：' + langIds[0] + ' 是 [' + baseline.join(',') + ']、' + lang + ' 是 [' + other.join(',') + ']')
      }
    }
  }
  check(structureProblems.length === 0, '每条词条都是字符串，时间参数都认识、解析后不残留 {{...}}' + (structureProblems.length ? '：' + firstLines(structureProblems.join('\n'), 5) : ''))
  // 空串可以（那个键在该后端下本来就没文案），但同一键必须各语言一起空 —— 一边有字一边空
  //   就是漏译：界面上会突然少一行提示，而双语门禁的 A 段只看「键在不在」，看不出来。
  for (const family of families) {
    for (const key of Object.keys(family.texts[langIds[0]] || {})) {
      const empties = langIds.filter((lang) => !String(((family.texts[lang] || {})[key]) || '').trim())
      if (empties.length > 0 && empties.length < langIds.length) {
        emptyMismatch.push(family.family + '/' + key + ' 在 ' + empties.join('/') + ' 是空的，其余语言有文案')
      }
    }
  }
  check(
    emptyMismatch.length === 0,
    '空的文案是各语言一起空（有 ' + emptyValues.length + ' 处空串，例如 ' + (emptyValues.slice(0, 3).join('、') || '无') + '；没有「一边有字一边空」的漏译）' + (emptyMismatch.length ? '：' + firstLines(emptyMismatch.join('\n'), 5) : ''),
  )
  check(placeholderProblems.length === 0, '同一条词条在各语言里的 {占位符} 一致' + (placeholderProblems.length ? '：' + firstLines(placeholderProblems.join('\n'), 5) : ''))

  // =========================================================================
  // B. 关键键存在（每门语言都要有）+ #619 已删键不许复活
  // =========================================================================
  console.log('')
  console.log('== B. 本票关键键存在（每门语言段里都要有） ==')
  const REQUIRED: ReadonlyArray<string> = [
    'list.openInTrackerTitle', 'detail.viewOnTracker', 'detail.viewOnTrackerHint',
    'detail.authFailCta', 'detail.readOnlyHint',
    'switch.gateOtherErr', 'switch.pleaseSelectTracker', 'switch.gateIntro',
    'panel.loadingShort',
    'setup.github.trackerLine', 'setup.github.labelReqs',
    'setup.markdown.trackerLine', 'setup.markdown.labelReqs',
    'setup.gitlab.trackerLine', 'setup.gitlab.labelReqs',
    'setup.default.trackerLine', 'setup.default.labelReqs',
    'panel.labelsStepTitle', 'panel.labelsStepDesc',
    'check.selection.pass', 'check.tracker.initialized.pass', 'env.diagTitle', 'env.actRun', 'env.chainDone',
    // #626：普通票的显示名。TypeChip 渲染的是 tr('type.' + 类型值)，缺了这条，
    // 界面上会直接印出 'type.issue' 这串字（#626 实测）。
    'type.issue',
    // #655：初始化小卡上那组单选与两句注入句。缺了卡片会印出键名，注入文案里那句布局结论会空着。
    'setup.layoutQuestion', 'setup.layoutSingle', 'setup.layoutMulti',
    'setup.layout.single', 'setup.layout.multi',
  ]
  for (const key of REQUIRED) {
    const missing = langIds.filter((lang) => !(key in (textsByLang[lang] || {})))
    if (missing.length) check(false, '缺键 ' + key + '（缺在：' + missing.join('/') + '）')
    else check(true, '键在 ' + key)
  }
  // #619：旧的「标签调色盘」注入文案整段删除，那条词条键也随之删掉。
  //   判据由「必须存在」换成「必须不存在」——同一条键，方向相反，强度不变。
  const paletteBack = langIds.filter((lang) => 'setup.markdown.paletteNote' in (textsByLang[lang] || {}))
  check(
    paletteBack.length === 0,
    paletteBack.length
      ? 'setup.markdown.paletteNote 又回来了（在 ' + paletteBack.join('/') + '）：#619 已删掉这条注入文案，词条不该再存在'
      : '已删的 setup.markdown.paletteNote 键没有复活（#619）',
  )

  // =========================================================================
  // C. 类型徽章能收到的每个类型值都必须有词条（#626 防复发）
  // =========================================================================
  console.log('')
  console.log('== C. 类型徽章每个类型值都有词条（#626） ==')
  // TypeChip（views/shared/chips.ts）渲染的是 tr('type.' + 类型值)。类型值有两个来源：
  //   ① 后端归一的票类型：src/tracker/contract/vocabulary.ts 的 ISSUE_TYPE（issue / map）
  //   ② 五个 wayfinder 类型标签：src/tracker/contract/canonical-labels.ts 的 wayfinder:xxx
  // 任何一路冒出新值而词条没跟上，界面上就会印出键名本身 —— 那正是 #626 的毛病。
  const constantsSrc: string = fs.readFileSync(path.join(ROOT, 'src/tracker/contract/vocabulary.ts'), 'utf8')
  const issueTypeBlock: string = (constantsSrc.match(/ISSUE_TYPE\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/) || [])[1] || ''
  const fromBackend: string[] = (issueTypeBlock.match(/:\s*'([a-z]+)'/g) || []).map((s) => s.replace(/[^a-z]/g, ''))
  const labelsSrc: string = fs.readFileSync(path.join(ROOT, 'src/tracker/contract/canonical-labels.ts'), 'utf8')
  const fromLabels: string[] = []
  for (const m of labelsSrc.match(/wayfinder:[a-z]+/g) || []) {
    const v = m.slice('wayfinder:'.length)
    if (fromLabels.indexOf(v) < 0) fromLabels.push(v)
  }
  const typeValues: string[] = []
  for (const v of fromBackend.concat(fromLabels)) if (v && typeValues.indexOf(v) < 0) typeValues.push(v)
  info('从类型真源收到 ' + typeValues.length + ' 个类型值：' + typeValues.join(' / '))
  for (const v of typeValues) {
    const missing = langIds.filter((lang) => !(('type.' + v) in (textsByLang[lang] || {})))
    if (missing.length) check(false, '缺词条 type.' + v + '（缺在：' + missing.join('/') + '）—— 类型徽章会把这串字直接印到界面上')
    else check(true, '有词条 type.' + v)
  }

  // =========================================================================
  // D. 双产物关键键（产物由源码重建后才有这些词条；#1209 起产物里词条是双引号写法）
  // =========================================================================
  console.log('')
  console.log('== D. 双产物里关键键齐备 ==')
  // #1209 起片段真源是 .ts：构建转译把字符串字面量改写成双引号，产物里键的写法是 "键"
  //   而不再是 '键'。判据只认键名本身，单双引号都算命中 —— 只认单引号会把产物误报成缺键。
  for (const artifact of ['client.js', path.join('package', 'lib', 'client.js')]) {
    let buf = ''
    try {
      buf = fs.readFileSync(path.join(ROOT, artifact), 'utf8')
    } catch (e) {
      check(false, '产物缺失 ' + artifact + '：' + ((e && (e as Error).message) || e))
      continue
    }
    const miss = REQUIRED.filter((k) => buf.indexOf("'" + k + "'") < 0 && buf.indexOf('"' + k + '"') < 0)
    if (miss.length) check(false, '产物缺键 ' + artifact + ' -> ' + miss.join(','))
    else check(true, '产物关键键齐备 ' + artifact)
  }

  // =========================================================================
  // F. 技能描述文案评审（名单从 src/shared/matt-skills.ts 真源取）
  // =========================================================================
  console.log('')
  console.log('== F. 技能描述文案评审 ==')
  // 为什么留在这儿：原来那扇门禁（verify-skill-tooltip）93 个判据点里 90 个是「某个字符串
  // 在产物文本里出现」，两次把产品改坏它都照样打印通过；唯一没人接手的就是这段文案评审。
  // 技能名单从 src/shared/matt-skills.ts 的真源读，不硬编码：增减技能只改真源一处，
  // config/copy/skilldesc.yaml 的条数跟不上就会在这里报红。
  const ZH_BAD: ReadonlyArray<string> = ['设计树', '深模块设计词汇', 'task 型 ticket', '本插件服务的对象', '领域术语与统一语言', '巨型项目决策地图', '对齐提问', '硬 bug 与性能回归诊断循环', '红-绿-重构', '讨论固化成规格', '写出优秀技能']
  const EN_BAD: ReadonlyArray<string> = ['design tree', 'Deep module design vocabulary', 'task tickets', 'what this plugin serves', 'Domain terms & ubiquitous language', 'Decision maps for large projects', 'alignment questioning', 'Diagnosis loop for hard bugs & performance regressions', 'Red-green-refactor', 'Turn discussions into specs', 'Write great skills']
  try {
    const matt = (await import(pathToFileURL(path.join(ROOT, sourcePath('src/shared/matt-skills.js'))).href)) as { SKILLS?: ReadonlyArray<{ name: string }> }
    const names: string[] = (matt.SKILLS || []).map((s) => s.name).sort()
    const skillFamily = families.filter((f) => f.family === 'skilldesc')[0]
    check(!!skillFamily, 'config/copy/skilldesc.yaml 词族存在（技能描述词条住在这里）')
    check(names.length > 0, '从 src/shared/matt-skills.ts 读到技能名单（' + names.length + ' 个）')
    if (skillFamily && names.length) {
      const dictByLang: Record<string, Record<string, string>> = Object.create(null)
      for (const lang of langIds) dictByLang[lang] = skillFamily.texts[lang] || {}
      const missing: string[] = []
      const tooShort: string[] = []
      for (const name of names) {
        const key = 'skilldesc.' + name
        const lacking = langIds.filter((lang) => !dictByLang[lang][key])
        if (lacking.length) missing.push(name + '（缺 ' + lacking.join('/') + '）')
        for (const lang of langIds) {
          const text = dictByLang[lang][key]
          if (text && text.length < 8) tooShort.push(lang + '/' + name + '「' + text + '」')
        }
      }
      check(missing.length === 0, '真源里 ' + names.length + ' 个技能的中英词条齐全' + (missing.length ? '：' + missing.slice(0, 6).join('；') : ''))
      const nameSet = new Set(names)
      const extra: string[] = []
      for (const key of Object.keys(dictByLang[langIds[0]] || {})) {
        if (key.indexOf('skilldesc.') !== 0) extra.push(key + '（不是 skilldesc.* 键）')
        else if (!nameSet.has(key.slice('skilldesc.'.length))) extra.push(key)
      }
      check(extra.length === 0, '技能描述没有真源之外的孤儿键' + (extra.length ? '：' + extra.slice(0, 6).join('、') : ''))
      const zhKeys = Object.keys(dictByLang['zh'] || {}).sort()
      const enKeys = Object.keys(dictByLang['en'] || {}).sort()
      if ('zh' in dictByLang && 'en' in dictByLang) check(zhKeys.join(',') === enKeys.join(','), '技能描述中英键集合相等')
      else check(true, '技能描述键集合相等（语言清单里没有 zh/en 时由 A 段按语言清单统一对账）')
      const blackHits: string[] = []
      for (const lang of langIds) {
        const bad = lang === 'zh' ? ZH_BAD : lang === 'en' ? EN_BAD : []
        for (const key of Object.keys(dictByLang[lang] || {})) {
          for (const word of bad) if (dictByLang[lang][key].indexOf(word) >= 0) blackHits.push(lang + ' ' + key + ' 命中「' + word + '」')
        }
      }
      check(blackHits.length === 0, '技能描述没有自指 / jargon-only / 元评论黑名单词' + (blackHits.length ? '：' + blackHits.slice(0, 5).join('；') : ''))
      check(tooShort.length === 0, '技能描述每条都在 8 个字符以上' + (tooShort.length ? '：' + tooShort.slice(0, 5).join('；') : ''))
    }
  } catch (e) {
    check(false, '技能描述评审载入失败：' + ((e && (e as Error).message) || e))
  }

  // =========================================================================
  // H. 旧片段不并存（#1294：真源只有 config/copy/*.yaml 一处）
  // =========================================================================
  console.log('')
  console.log('== H. 旧片段不并存（真源只有 config/copy/*.yaml） ==')
  const legacyLeft: string[] = []
  for (const family of familyNames) {
    for (const ext of ['ts', 'js']) {
      const rel = 'src/client/kernel/locale-' + family + '.' + ext
      if (fs.existsSync(path.join(ROOT, rel))) legacyLeft.push(rel)
    }
  }
  check(
    legacyLeft.length === 0,
    legacyLeft.length
      ? '旧片段还留在树上：' + legacyLeft.join('、') + '（真源已搬去 config/copy/，这些文件留着会让人改错地方）'
      : 'src/client/kernel/ 下不再有 locale-<族>.ts / .js（' + familyNames.length + ' 个词族的旧文件都已删净）',
  )

  // =========================================================================
  // I. 生成物：存在、与 YAML 一致、分段数对得上（新增；生成器细节由 verify-locale-config 守）
  // =========================================================================
  console.log('')
  console.log('== I. 生成物与 config/ 下的 YAML 一致 ==')
  check(fs.existsSync(GENERATED_FILE), '生成物存在：' + LOCALE_DATA_REL)
  // G 段 spawn 生成器 --check：改了 YAML 忘了跑生成器（或手改了生成物），这里判红。
  // 与 verify-locale-config ① 重复是有意的：这扇门禁的 A/B/F 判据都以生成物里的文案为准，
  // 生成物过期时它自己必须先红，而不是拿一份过期产物判断「完整性」。
  const checkRun = spawnSync(process.execPath, [path.join(ROOT, GENERATOR_REL), '--check'], { cwd: ROOT, encoding: 'utf8' })
  const checkOut: string = String(checkRun.stdout || '') + String(checkRun.stderr || '')
  check(checkRun.status === 0 && checkOut.indexOf('PASS') >= 0, '生成器 --check 通过：生成源码与 config/ 下的 YAML 一致' + (checkRun.status === 0 ? '' : '（' + firstLines(checkOut, 4) + '）'))

  let generatedText = ''
  try {
    generatedText = fs.readFileSync(GENERATED_FILE, 'utf8')
  } catch (e) {
    check(false, '读不到生成物 ' + LOCALE_DATA_REL + '：' + ((e && (e as Error).message) || e))
  }
  // 配置族数与生成物分段数一致（#1289 的病根就是目录里多出的词族没人管）。
  const segmentFamilies: string[] = []
  for (const m of generatedText.matchAll(new RegExp(FAMILY_MARK_RE.source, 'gm')) as Iterable<RegExpMatchArray>) {
    segmentFamilies.push(m[1])
  }
  check(
    sortedEqual(segmentFamilies, familyNames),
    '生成物分段数 = 配置族数 = ' + familyNames.length + '（生成物里 ' + segmentFamilies.length + ' 段：' + (segmentFamilies.join(' / ') || '空') + '）',
  )
  // 旧 A 的「每个键在产物里各语言出现一次」：生成物里 key 以 `'键':` 形状出现的次数必须等于语言数
  //   （键联合类型里是 `| '键'`，没有冒号，不计数；合并段只有 L_ 引用，也不计数）。
  const countProblems: string[] = []
  for (const family of families) {
    const union = Object.keys(family.texts[langIds[0]] || {})
    for (const key of union) {
      const occurrences = generatedText.split("'" + key + "':").length - 1
      if (occurrences !== langCount) countProblems.push(family.family + '/' + key + ' 出现 ' + occurrences + ' 次（应为 ' + langCount + ' 次）')
    }
  }
  check(countProblems.length === 0, '每条词条在生成物里按「语言数量」各出现一次（旧 A 判据按语言清单推广）' + (countProblems.length ? '：' + firstLines(countProblems.join('\n'), 5) : ''))
  check(generatedText.indexOf('{{') < 0, '生成物里没有残留的 {{时间参数}}（生成器应把它们烘成字面量）')

  // 逐条比对生成物里的取值与 YAML（含时间参数烘值）。只查 YAML 不够 —— 生成器若把值写错，
  // 上面那些「键在不在」的判据全绿，而界面上显示的是错的文案。
  try {
    const generated = (await import(pathToFileURL(GENERATED_FILE).href)) as Record<string, unknown>
    const valueProblems: string[] = []
    for (const family of families) {
      const constName = 'L_' + family.family.toUpperCase()
      const table = generated[constName] as Record<string, Record<string, string>> | undefined
      if (!table || typeof table !== 'object') {
        valueProblems.push('生成物缺常量 ' + constName)
        continue
      }
      for (const lang of langIds) {
        const dict = family.texts[lang] || {}
        const genLang = table[lang]
        if (!genLang || typeof genLang !== 'object') {
          valueProblems.push(constName + "['" + lang + "'] 缺失")
          continue
        }
        for (const key of Object.keys(dict)) {
          const expected = resolveTimeTokens(dict[key], timeValues).text
          if (genLang[key] !== expected) valueProblems.push(constName + "['" + lang + "']['" + key + "'] 与 YAML 不等")
        }
      }
    }
    check(valueProblems.length === 0, '生成物里每条文案的取值都与 YAML 逐字相等（含 {{时间参数}} 烘值）' + (valueProblems.length ? '：' + firstLines(valueProblems.join('\n'), 5) : ''))
  } catch (e) {
    check(false, '生成物载入失败：' + ((e && (e as Error).message) || e))
  }

  finish()
}

/** 一条词条里 {xxx} 占位符的名字清单（按出现顺序）。 */
function placeholderNames(text: string): string[] {
  const out: string[] = []
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(String(text || ''))) !== null) if (out.indexOf(m[1]) < 0) out.push(m[1])
  return out
}

/** 一门语言的词条总数（跨全部词族；用于 INFO 行）。 */
function collectCount(config: CopyConfig, lang: string): number {
  let n = 0
  for (const family of config.families) n += Object.keys(family.texts[lang] || {}).length
  return n
}

/** 收尾：打印判据计数与总结论，退出码按有没有红。 */
function finish(): void {
  console.log('')
  if (failed) {
    console.log('[locale-completeness] FAIL（' + passCount + '/' + totalCount + ' 条通过）')
    process.exit(1)
  }
  console.log('PASS 全部 ' + totalCount + ' 条判据通过 · locale 完整性门禁生效')
  process.exit(0)
}

main().catch((e) => {
  console.log('  FAIL 门禁自身异常：' + ((e && (e as Error).message) || e))
  console.log('\n[locale-completeness] FAIL')
  process.exit(1)
})
