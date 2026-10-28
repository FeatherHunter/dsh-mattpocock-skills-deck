/**
 * scripts/lib/prompt-config.mts —— 提示词 YAML 配置的共享加载与校验核（#1292 立）。
 *
 * 提示词的真源搬到 config/prompts/ 下的五份族 YAML、一份跨族公共小节 YAML（shared-sections.yaml）
 * 与 config/languages.yaml（语言清单）之后，
 * 生成器（scripts/generate-prompt-config.mts）与门禁（tests/verify-prompt-config.ts）都要读同一份 YAML、
 * 按同一份清单核键。把加载与校验口集中到这一处，两边不会再各写一份 ——
 * 写两份就是「改了 YAML 的键名、忘了同步更新某一边」这种悄悄失效的温床。
 *
 * 这份模块只放纯函数：不读盘以外的副作用、不拼路径、不抽路径（路径由调用方负责解析）。
 * 调用方一般是脚本入口（已知仓库根）或门禁（已知 __dirname），调用起来一样简单。
 *
 * 机制为什么要这样（五段）：
 *   · PROMPT_TEMPLATE_IDS —— 模板 id 的硬编码清单。
 *     每条模板的 id、所需占位符、所属族、是否含 use 元数据都列在这一处。
 *     新增 / 删除 / 改名时改这一处；生成器与门禁都拿这一份去对 YAML。
 *     这是「YAML 漏键少占位符」这类故障的唯一发现点。
 *   · PROMPT_FRAGMENT_IDS —— 三处片段 id（newBugFields / newWayfinderWiring / vocabularyDefaults）。
 *     模板一份字面量有版本号与 placeholders 两类元字段，片段只装 zh/en 两份 —— 不是模板，
 *     分类不同。门禁与生成器都按片段口径核（zh/en 必含，占位符用法单独看）。
 *   · PROMPT_SHARED_SECTION_IDS —— 跨族公共小节（今天两节：sharedTools「## 工具」三条、
 *     investigation「## 调查（建议先查后问）」四条）。
 *     它们不属于任何一族，单独住在 config/prompts/shared-sections.yaml；模板正文里写
 *     {{shared:<id>}}，readPromptConfig 展开时把对应语言的正文整段换进去。
 *     这样一节正文只写一遍、引用它的模板只写标记，不会再出现改一处漏其余的情况。
 *   · readPromptYamls —— 读五份提示词 YAML 与一份语言清单，返回结构化对象。
 *     YAML 真读不到 / 解析失败 / 顶层形状不对一律报错（不静默返回空）。
 *   · readSharedSections + expandSharedSections —— 读公共小节 YAML，并在读配置时把模板里的
 *     {{shared:<id>}} 标记展开成正文；标记不展开就进提示词比缺一段更难查，所以两处都当场抛错。
 *   · validatePromptData —— 照 PROMPT_TEMPLATE_IDS / PROMPT_FRAGMENT_IDS 核 YAML 字段：
 *     zh/en 必含且非空、占位符声明必须用全（声明但未用、用但未声明都红）、
 *     use 字段只许在模板条目上出现、元字段齐全。
 *   · validateLanguageData —— 照 config/languages.yaml 核：default 必须存在且是 languages 一员、
 *     每门的 fallback 必须终止在某门上、不许循环。
 *
 * 与 docs/adr/20261016-time-config-yaml.md 是同款先例（见 §2.2）：门禁「值从哪来」由这一处说了算。
 * 与 docs/adr/20261020-ui-copy-data-driven.md §2.5 的「提示词侧机制先落地」对齐：
 * 这一份是「提示词侧机制」的核心实现，门禁与生成器两边都从这里借口径。
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'yaml'

// ---------------------------------------------------------------------------
// 类型与硬编码清单
// ---------------------------------------------------------------------------

/** 一条模板条目应当具备的全部字段。YAML 缺任意一个字段，门禁直接红。 */
export interface PromptTemplateSpec {
  /** 模板 id（与调用方 promptText(id) 的 id 一致）。 */
  readonly id: string
  /** 所属族，决定它在 config/prompts/ 下住哪一份 YAML 文件。 */
  readonly family: PromptFamily
  /** 占位符声明：模板正文里所有 {x} 的名字，缺 / 多都对不上。 */
  readonly placeholders: ReadonlyArray<string>
}

/** 一处片段条目应当具备的全部字段。片段与模板共用 id 命名空间，但不放 placeholders。 */
export interface PromptFragmentSpec {
  readonly id: string
  readonly family: PromptFamily
  /**
   * 片段的形状类型：
   *   'bilingual-text' —— 单纯一对字符串（zh/en），例如 newBugFields / newWayfinderWiring
   *   'vocabulary'     —— 「占位符默认值表」，按占位符名字分层、每层 zh/en，
   *                     例如 vocabularyDefaults 装 { cli: {zh,en}, cliBrand: {zh,en} }
   *                      —— 决定不同形状用同一个片段条目类型抽象，
   *                        因为片段类型本就只有这两份，将来再加也按这个口子出，
   *                        不直接接 unknown。
   */
  readonly shape: 'bilingual-text' | 'vocabulary'
}

/**
 * 五份 YAML 的分类 —— 与「这条提示词在什么时候被注入」一一对应：
 *   workspace-initialization 工作区初始化（setupRun / switchAlign / switchLayout）
 *   repository-alignment  仓库与凭据对齐（installSkillsFix / installSkills）
 *   map-advancement        地图推进（mapExecute / complete / fixate / mapInspect /
 *                          healthCheck / specExecute / specComplete / specSplit）
 *   ticket-action-templates 票面动作模板（tpl.* 一族）
 *   ticket-creation        建票入口（newWayfinder / newSpec / newBugWayfinder）
 * 此外有三处片段 —— 它们不是一条完整模板，是模板里替换进去的一段话，
 *   但同样按注入时机归族，住在对应族的那份 YAML 里：
 *   vocabularyDefaults（{cli} / {cliBrand} 的兜底说法）住在 repository-alignment，
 *   newBugFields（bug 建单的四项引导语）与 newWayfinderWiring（建单时的父子议题接线）
 *   住在 ticket-creation。
 * 哪一条属于哪一族，由 PROMPT_FRAGMENT_IDS 的 family 字段写着，读的时候照表分流。
 */
export type PromptFamily =
  | 'workspace-initialization'
  | 'repository-alignment'
  | 'map-advancement'
  | 'ticket-action-templates'
  | 'ticket-creation'

/** 一个片段条目在 YAML 里的形状：只装 zh/en 两份正文（双语文本）。 */
export interface BilingualTextFragment {
  zh: string
  en: string
}

/** 「占位符默认值表」型片段 —— 按占位符名字分层、每层 zh/en，运行时整份 lookup。 */
export interface VocabularyFragment {
  cli: { zh: string; en: string }
  cliBrand: { zh: string; en: string }
}

/** 一种联合体：bilingual-text | vocabulary 两种形态。 */
export type FragmentShape = BilingualTextFragment | VocabularyFragment

/** 一份模板条目在 YAML 里的形状：版本号、占位符、用途、中英正文。 */
export interface TemplateShape {
  version: number
  placeholders: string[]
  use: string
  zh: string
  en: string
}

/** 加载后的全套结构：五份模板族（三处片段按注入时机住在对应族里）+ 跨族公共小节 + 一份语言清单。
 *  templates 里的正文是展开后的：模板里写 {{shared:sharedTools}} 的地方，读出来已经是那一节的中英正文。 */
export interface PromptConfig {
  templates: Record<PromptFamily, Record<string, TemplateShape>>
  fragments: Record<string, FragmentShape>
  sharedSections: Record<string, SharedSectionShape>
  languages: LanguageConfig
}

/** 语言清单 config/languages.yaml 的形状。 */
export interface LanguageConfig {
  /** 缺省语言 id，必须是 languages 里的某一项。 */
  default: string
  /** 支持的全部语言。键是语言 id，值是它的元数据。 */
  languages: Record<string, LanguageEntry>
}

/** 一门语言的元数据。 */
export interface LanguageEntry {
  /** 显示给用户看的那一份人话说法（zh 名与 en 名各一份，给界面渲染）。 */
  label: { zh: string; en: string }
  /**
   * 回退链 —— 这门语言缺了正文时接着找哪一门。
   * 今天最多写一条（运行时只认第一项），多写的项会在 validateLanguageData 里判红；
   * 空数组表示「没有上一级可退」，是链的终点。链不许绕回自己。
   */
  fallback: string[]
}

// ---------------------------------------------------------------------------
// 27 条模板 id（按注入时机分族）：改动这条表请连同 PROMPT_FRAGMENT_IDS 一起改 ——
// 它们是真值表，不是字面量举例（见 AGENTS.md 「TypeScript 优先」节）。
// ---------------------------------------------------------------------------

export const PROMPT_FAMILIES: ReadonlyArray<PromptFamily> = [
  'workspace-initialization',
  'repository-alignment',
  'map-advancement',
  'ticket-action-templates',
  'ticket-creation',
]

/** 模板 id 与所属族。id 是单源；新增模板只动这一处。 */
export const PROMPT_TEMPLATE_IDS: ReadonlyArray<PromptTemplateSpec> = [
  // workspace-initialization（工作区初始化）
  { id: 'setupRun', family: 'workspace-initialization', placeholders: ['trackerLine', 'trackerChoice', 'backendNote', 'labelReqs', 'contextLayout'] },
  { id: 'switchAlign', family: 'workspace-initialization', placeholders: ['trackerLine', 'trackerChoice', 'backendNote', 'labelReqs', 'contextLayout', 'from', 'to'] },
  { id: 'switchLayout', family: 'workspace-initialization', placeholders: ['from', 'to'] },
  // repository-alignment（仓库与凭据对齐）
  { id: 'installSkillsFix', family: 'repository-alignment', placeholders: [] },
  { id: 'installSkills', family: 'repository-alignment', placeholders: ['probeList', 'probeCount'] },
  // map-advancement（地图推进）
  { id: 'mapExecute', family: 'map-advancement', placeholders: [] },
  { id: 'complete', family: 'map-advancement', placeholders: ['url', 'closed', 'total'] },
  { id: 'fixate', family: 'map-advancement', placeholders: [] },
  { id: 'mapInspect', family: 'map-advancement', placeholders: ['n', 'title', 'url', 'subIssue'] },
  { id: 'healthCheck', family: 'map-advancement', placeholders: ['subject'] },
  { id: 'specExecute', family: 'map-advancement', placeholders: ['url'] },
  { id: 'specComplete', family: 'map-advancement', placeholders: ['url', 'closed', 'total'] },
  { id: 'specSplit', family: 'map-advancement', placeholders: ['url'] },
  // ticket-action-templates（票面动作模板）
  { id: 'tpl.diagnose', family: 'ticket-action-templates', placeholders: ['url'] },
  { id: 'tpl.fix', family: 'ticket-action-templates', placeholders: ['url'] },
  { id: 'tpl.implement', family: 'ticket-action-templates', placeholders: ['url'] },
  { id: 'tpl.discuss', family: 'ticket-action-templates', placeholders: ['url'] },
  { id: 'tpl.research', family: 'ticket-action-templates', placeholders: ['url'] },
  { id: 'tpl.prototype', family: 'ticket-action-templates', placeholders: ['url'] },
  { id: 'tpl.execute', family: 'ticket-action-templates', placeholders: ['url'] },
  { id: 'tpl.takeover', family: 'ticket-action-templates', placeholders: ['url'] },
  { id: 'tpl.supplement', family: 'ticket-action-templates', placeholders: ['url'] },
  { id: 'tpl.handoff1', family: 'ticket-action-templates', placeholders: ['ts'] },
  { id: 'tpl.handoff2', family: 'ticket-action-templates', placeholders: ['path'] },
  // ticket-creation（建票入口）
  { id: 'newWayfinder', family: 'ticket-creation', placeholders: ['repo'] },
  { id: 'newSpec', family: 'ticket-creation', placeholders: ['repo'] },
  { id: 'newBugWayfinder', family: 'ticket-creation', placeholders: ['repo'] },
]

/** 三处片段 id —— 片段不是一条完整模板，是模板里替换进去的一段话。
 *  它们同样按注入时机分族，住在对应族的那份 YAML 里（family 字段写着住在哪一族）。 */
export const PROMPT_FRAGMENT_IDS: ReadonlyArray<PromptFragmentSpec> = [
  // newBugFields 是 NEW_BUG_FIELDS_BODY 与 NEW_BUG_FIELDS_BODY_EN 的真源 —— bug 建单引导语的中英各一份。
  { id: 'newBugFields', family: 'ticket-creation', shape: 'bilingual-text' },
  // newWayfinderWiring 是 NEW_WAYFINDER_DEFAULT_WIRING 的真源 ——「按当前后端填写的子议题关联方式」。
  { id: 'newWayfinderWiring', family: 'ticket-creation', shape: 'bilingual-text' },
  // vocabularyDefaults 是 VOCABULARY_DEFAULT 的真源 ——「{cli} / {cliBrand}」的中性兜底说法；
  // 形状按 vocabulary 类型处理（按占位符名字分层、每层 zh/en）。
  { id: 'vocabularyDefaults', family: 'repository-alignment', shape: 'vocabulary' },
]

/** config/ 下的所有 YAML 路径（以 repoRoot 为根的相对路径）。 */
export const PROMPT_YAML_PATHS: ReadonlyArray<string> = [
  ...PROMPT_FAMILIES.map((f) => 'config/prompts/' + f + '.yaml'),
  'config/languages.yaml',
]

// ---------------------------------------------------------------------------
// 跨族公共小节
// ---------------------------------------------------------------------------

/** 跨族公共小节 YAML 的路径（以 repoRoot 为根的相对路径）。
 *  它不在 PROMPT_YAML_PATHS 里：那份清单是「五份族文件 + 语言清单」，族按注入时机分；
 *  公共小节不属于任何时机，只属于「多处共用」，所以单独一份、单独一条读取路径。 */
export const PROMPT_SHARED_SECTIONS_REL = 'config/prompts/shared-sections.yaml'

/** 公共小节 id 清单。新增一节时改这一处，YAML 顶层键必须与它逐项相等。 */
export const PROMPT_SHARED_SECTION_IDS: ReadonlyArray<string> = ['sharedTools', 'investigation']

/** 一个公共小节的形状：只装 zh/en 两份正文，没有版本号与占位符（它不是一条模板）。 */
export interface SharedSectionShape {
  zh: string
  en: string
}

/** 模板正文里引用公共小节的标记：`{{shared:<id>}}`。
 *  写成双花括号加冒号是故意的——占位符校验认的是 `{x}`（`/\{(\w+)\}/`），
 *  两者不同形，标记不会被误当成占位符，也不会因为占位符双向校验而红。 */
const SHARED_MARKER_RE = /\{\{shared:([A-Za-z0-9_-]+)\}\}/g

/**
 * 读公共小节 YAML：顶层键必须与 PROMPT_SHARED_SECTION_IDS 逐项相等，每节 zh/en 非空。
 * 读不到 / 解析错 / 多键少键 / 空正文一律抛错——公共小节缺一节，20 个模板会同时缺一段话，
 * 这种故障不能静默放行。
 */
export function readSharedSections(repoRoot: string): Record<string, SharedSectionShape> {
  const abs = path.join(repoRoot, PROMPT_SHARED_SECTIONS_REL)
  let text: string
  try {
    text = fs.readFileSync(abs, 'utf8')
  } catch {
    throw new Error('读不到 ' + PROMPT_SHARED_SECTIONS_REL + '：跨族公共小节缺一不可')
  }
  const doc = yaml.parse(text) as unknown
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(PROMPT_SHARED_SECTIONS_REL + ' 顶层必须是对象（顶层键 = 公共小节 id）')
  }
  const table = doc as Record<string, unknown>
  const known = new Set(PROMPT_SHARED_SECTION_IDS)
  for (const id of Object.keys(table)) {
    if (!known.has(id)) {
      throw new Error(
        PROMPT_SHARED_SECTIONS_REL + ' 里有登记外的公共小节：' + id + '（清单在 PROMPT_SHARED_SECTION_IDS；想加就把那张表也补上）',
      )
    }
  }
  const out: Record<string, SharedSectionShape> = {}
  for (const id of PROMPT_SHARED_SECTION_IDS) {
    const entry = table[id] as Record<string, unknown> | undefined
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(PROMPT_SHARED_SECTIONS_REL + ' 缺公共小节：' + id + '（清单与 YAML 必须逐项相等）')
    }
    const zh = String(entry.zh ?? '')
    const en = String(entry.en ?? '')
    if (!zh.trim()) throw new Error('公共小节 ' + id + ' 缺 zh 正文（' + PROMPT_SHARED_SECTIONS_REL + '）')
    if (!en.trim()) throw new Error('公共小节 ' + id + ' 缺 en 正文（' + PROMPT_SHARED_SECTIONS_REL + '）')
    out[id] = { zh, en }
  }
  return out
}

/**
 * 把模板正文里的 `{{shared:<id>}}` 展开成对应语言的公共小节正文。
 *
 * 展开放在读取这一层（readPromptConfig 里）：生成物、门禁、单文件探针拿到的都是展开后的完整正文，
 * 不需要各自再实现一遍替换；生成器的产物形状也就不用变。
 * 引用未登记的 id、或展开后仍残留标记，都当场抛错——半截正文进了提示词，比缺一段更难查。
 */
export function expandSharedSections(
  templates: Record<PromptFamily, Record<string, TemplateShape>>,
  sharedSections: Record<string, SharedSectionShape>,
): Record<PromptFamily, Record<string, TemplateShape>> {
  const expandOne = (templateId: string, body: string, lang: 'zh' | 'en'): string => {
    // 全局正则有 lastIndex 状态，每次展开前复位，免得跨模板、跨语言互相影响。
    SHARED_MARKER_RE.lastIndex = 0
    const replaced = body.replace(SHARED_MARKER_RE, function (_whole: string, sectionId: string): string {
      const section = sharedSections[sectionId]
      if (!section) {
        throw new Error(
          '模板 ' + templateId + ' 引用了未登记的公共小节：' + sectionId + '（见 PROMPT_SHARED_SECTION_IDS 与 ' + PROMPT_SHARED_SECTIONS_REL + '）',
        )
      }
      return section[lang]
    })
    if (replaced.indexOf('{{shared:') >= 0) {
      throw new Error('模板 ' + templateId + ' 的 ' + lang + ' 正文里还有没展开完的公共小节标记（形状应是 {{shared:名字}}）')
    }
    return replaced
  }
  const out = {} as Record<PromptFamily, Record<string, TemplateShape>>
  for (const fam of PROMPT_FAMILIES) {
    out[fam] = {}
    for (const [id, tpl] of Object.entries(templates[fam])) {
      out[fam][id] = { ...tpl, zh: expandOne(id, tpl.zh, 'zh'), en: expandOne(id, tpl.en, 'en') }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 读 YAML
// ---------------------------------------------------------------------------

/**
 * 读五份族文件，按族归并到 templates / fragments。
 *
 * 一个族文件里可以同时住模板与片段 —— 两者都由「注入时机」决定归哪一族：
 * 片段不是一条完整模板，是模板里替换进去的一段话（形状见 PROMPT_FRAGMENT_IDS）。
 * 归类不靠猜形状，靠 PROMPT_TEMPLATE_IDS / PROMPT_FRAGMENT_IDS 两张登记表：
 * id 在哪张表里、属于哪一族，都写着；读的时候照表分流，放错族文件当场报错。
 *
 * 任何一步错都直接抛错：少读一份会让人以为「这条模板没生效」，写错字段会让人以为「这条没占位符」，
 * 两类故障都不能静默放行。
 */
export function readPromptYamls(repoRoot: string): { templates: Record<PromptFamily, Record<string, TemplateShape>>; fragments: Record<string, FragmentShape> } {
  // 族的清单只认 PROMPT_FAMILIES 一处：这里照它建空表，不再手抄第二份族名（漏抄一族会被类型断言悄悄掩住）。
  const templates = Object.fromEntries(PROMPT_FAMILIES.map((fam) => [fam, {}])) as Record<PromptFamily, Record<string, TemplateShape>>
  const fragments: Record<string, FragmentShape> = {}
  const templateById = new Map(PROMPT_TEMPLATE_IDS.map((s) => [s.id, s] as const))
  const fragmentById = new Map(PROMPT_FRAGMENT_IDS.map((s) => [s.id, s] as const))
  for (const fam of PROMPT_FAMILIES) {
    const rel = 'config/prompts/' + fam + '.yaml'
    const abs = path.join(repoRoot, rel)
    let text: string
    try {
      text = fs.readFileSync(abs, 'utf8')
    } catch {
      throw new Error('读不到 ' + rel + '：五份提示词 YAML 缺一不可')
    }
    const doc = yaml.parse(text) as unknown
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error(rel + ' 顶层必须是对象（顶层键 = 这一族用到的模板 id 与片段 id）')
    }
    // 顶层键就是这一族的 id（模板与片段混在一起，按下面两张登记表分流）：
    const table = doc as Record<string, unknown>
    for (const id of Object.keys(table)) {
      const tpl = templateById.get(id)
      if (tpl) {
        if (tpl.family !== fam) {
          throw new Error(rel + ' 里的模板 ' + id + ' 登记在 ' + tpl.family + ' 族（见 PROMPT_TEMPLATE_IDS）；放错族文件会让「按注入时机分族」这条规矩失效')
        }
        templates[fam][id] = table[id] as TemplateShape
        continue
      }
      const frag = fragmentById.get(id)
      if (frag) {
        if (frag.family !== fam) {
          throw new Error(rel + ' 里的片段 ' + id + ' 登记在 ' + frag.family + ' 族（见 PROMPT_FRAGMENT_IDS）；放错族文件会让「按注入时机分族」这条规矩失效')
        }
        fragments[id] = table[id] as FragmentShape
        continue
      }
      throw new Error(rel + ' 里有登记外的条目：' + id + '（模板与片段的清单在 PROMPT_TEMPLATE_IDS / PROMPT_FRAGMENT_IDS；想加就把那两张表也补上）')
    }
  }
  return { templates, fragments }
}

/** 读 config/languages.yaml 并解析成 LanguageConfig。读不到 / 解析错直接抛。 */
export function readLanguageYaml(repoRoot: string): LanguageConfig {
  const rel = 'config/languages.yaml'
  const abs = path.join(repoRoot, rel)
  let text: string
  try {
    text = fs.readFileSync(abs, 'utf8')
  } catch {
    throw new Error('读不到 ' + rel + '：语言清单缺一不可')
  }
  const doc = yaml.parse(text) as unknown
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(rel + ' 顶层必须是对象')
  }
  return doc as unknown as LanguageConfig
}

/**
 * 一次性读全部：五份模板族 YAML（片段与模板同住）+ 一份公共小节 YAML + 一份语言清单。任一缺失都抛。
 * 这条是生成器与门禁的共用入口 —— 不各写一份。
 * 模板里的 {{shared:<id>}} 在这里展开：调用方拿到的 templates 一律是展开后的完整正文。
 */
export function readPromptConfig(repoRoot: string): PromptConfig {
  const { templates, fragments } = readPromptYamls(repoRoot)
  const sharedSections = readSharedSections(repoRoot)
  const languages = readLanguageYaml(repoRoot)
  return { templates: expandSharedSections(templates, sharedSections), fragments, sharedSections, languages }
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/**
 * 校验读出来的模板与片段：照 PROMPT_TEMPLATE_IDS / PROMPT_FRAGMENT_IDS 逐项核。
 * 返回一个错误列表（空数组 = 通过），不抛 —— 校验阶段一字面上的「红」由调用方决定怎么报。
 * 生成器在写之前跑一遍，门禁在 --check 时跑一遍，命令、退出码、UI 都按各自宿主的方式呈现。
 */
export function validatePromptData(data: PromptConfig): string[] {
  const out: string[] = []
  // —— 模板：逐族、逐 id 核
  for (const spec of PROMPT_TEMPLATE_IDS) {
    const famTable = data.templates[spec.family]
    const entry = famTable ? famTable[spec.id] : undefined
    if (!entry || typeof entry !== 'object') {
      out.push('模板缺失：' + spec.family + '/' + spec.id + '（PROMPT_TEMPLATE_IDS 登记了这条，YAML 里没有）')
      continue
    }
    out.push(...checkTemplateFields(spec, entry))
  }
  // —— 模板：核「某族里有登记外的条目」（YAML 多写了条目，门禁要红）
  for (const fam of PROMPT_FAMILIES) {
    const table = data.templates[fam] || {}
    const known = new Set(PROMPT_TEMPLATE_IDS.filter((s) => s.family === fam).map((s) => s.id))
    for (const id of Object.keys(table)) {
      if (!known.has(id)) out.push('模板多写：' + fam + '/' + id + '（YAML 里有这条，PROMPT_TEMPLATE_IDS 没登记；想加就把 PROMPT_TEMPLATE_IDS 也补上）')
    }
  }
  // —— 片段：逐 id 核
  for (const spec of PROMPT_FRAGMENT_IDS) {
    const entry = data.fragments[spec.id]
    if (!entry || typeof entry !== 'object') {
      out.push('片段缺失：' + spec.id + '（三处片段的真源缺这条）')
      continue
    }
    out.push(...checkFragmentFields(spec, entry))
  }
  // —— 片段：核「YAML 多写了条目」
  {
    const table = data.fragments || {}
    const known = new Set(PROMPT_FRAGMENT_IDS.map((s) => s.id))
    for (const id of Object.keys(table)) {
      if (!known.has(id)) out.push('片段多写：' + id + '（YAML 里有这条，PROMPT_FRAGMENT_IDS 没登记）')
    }
  }
  // —— 语言清单
  out.push(...validateLanguageData(data.languages))
  return out
}

/** 一条模板条目的字段核（zh/en 必含、占位符与 use 元字段、用与声明对得上）。 */
function checkTemplateFields(spec: PromptTemplateSpec, entry: TemplateShape): string[] {
  const out: string[] = []
  // 版本号必为正整数
  if (typeof entry.version !== 'number' || !Number.isInteger(entry.version) || entry.version <= 0) {
    out.push(spec.family + '/' + spec.id + '.version 必须是正整数')
  }
  // 占位符声明：数组、且与硬编码清单逐项相等 —— 顺序无所谓，元素要齐
  if (!Array.isArray(entry.placeholders)) {
    out.push(spec.family + '/' + spec.id + '.placeholders 必须是字符串数组')
  } else {
    const declared = entry.placeholders.map(String).slice().sort().join(',')
    const known = spec.placeholders.slice().sort().join(',')
    if (declared !== known) {
      out.push(spec.family + '/' + spec.id + '.placeholders 与登记不符：声明 [' + entry.placeholders.join(',') + '] vs 期望 [' + spec.placeholders.join(',') + ']')
    }
  }
  // use 字段：非空字符串
  if (typeof entry.use !== 'string' || !entry.use.trim()) {
    out.push(spec.family + '/' + spec.id + '.use 必须是非空字符串（这条模板什么时候用、给谁看）')
  }
  // zh / en 必含且非空
  for (const lang of ['zh', 'en'] as const) {
    const text = entry[lang]
    if (typeof text !== 'string' || !text.trim()) {
      out.push(spec.family + '/' + spec.id + '.' + lang + ' 必须是非空字符串')
      continue
    }
    // 模板正文里 {x} 占位符必须与 placeholders 声明一一对应：
    //   · 声明里有但正文没出现 → 报「声明未用」（声明没意义）
    //   · 正文里有但声明没列 → 报「未声明」（运行时会原样注入会话）
    const used = collectPlaceholderNames(text)
    const usedSet = new Set(used)
    for (const p of spec.placeholders) {
      if (!usedSet.has(p)) out.push(spec.family + '/' + spec.id + ' 在 ' + lang + ' 里占位符 {' + p + '} 声明了但未用')
    }
    const declaredSet = new Set(entry.placeholders || [])
    for (const p of used) {
      if (!declaredSet.has(p)) out.push(spec.family + '/' + spec.id + ' 在 ' + lang + ' 里占位符 {' + p + '} 用了但未声明')
    }
  }
  return out
}

/** 一条片段条目的字段核 —— 按 spec.shape 决定核 zh/en 两份还是核占位符字典。 */
function checkFragmentFields(spec: PromptFragmentSpec, entry: unknown): string[] {
  const out: string[] = []
  if (spec.shape === 'bilingual-text') {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      out.push('片段 ' + spec.id + ' 必须是对象（zh/en 两份正文）')
      return out
    }
    const e = entry as BilingualTextFragment
    for (const lang of ['zh', 'en'] as const) {
      const text = e[lang]
      if (typeof text !== 'string' || !text.trim()) {
        out.push('片段 ' + spec.id + '.' + lang + ' 必须是非空字符串')
      }
    }
    return out
  }
  // vocabulary 形状：按占位符名字分层、每层 zh/en —— 现在只有 cli / cliBrand 两把。
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    out.push('片段 ' + spec.id + ' 必须是对象（按占位符名字分层、每层 zh/en）')
    return out
  }
  const e = entry as Record<string, unknown>
  for (const key of ['cli', 'cliBrand'] as const) {
    const sub = e[key]
    if (!sub || typeof sub !== 'object' || Array.isArray(sub)) {
      out.push('片段 ' + spec.id + '.' + key + ' 必须是对象（zh/en 两份）')
      continue
    }
    const s = sub as Record<string, unknown>
    for (const lang of ['zh', 'en'] as const) {
      const text = s[lang]
      if (typeof text !== 'string' || !text.trim()) {
        out.push('片段 ' + spec.id + '.' + key + '.' + lang + ' 必须是非空字符串')
      }
    }
  }
  return out
}

/** 从一段文本里抽出所有 {name} 占位符的名字（去重、按出现顺序）。 */
export function collectPlaceholderNames(text: string): string[] {
  const out: string[] = []
  String(text || '').replace(/\{(\w+)\}/g, function (_m: string, n: string): string {
    if (out.indexOf(n) < 0) out.push(n)
    return _m
  })
  return out
}

/** 校验语言清单：default 必落在 languages、fallback 链必终止在 languages 一员、不许循环。 */
export function validateLanguageData(data: LanguageConfig): string[] {
  const out: string[] = []
  if (!data || typeof data !== 'object') {
    out.push('config/languages.yaml 顶层必须是对象')
    return out
  }
  const languages = data.languages
  if (!languages || typeof languages !== 'object' || Array.isArray(languages)) {
    out.push('config/languages.yaml.languages 必须是对象')
    return out
  }
  const ids = Object.keys(languages)
  if (ids.length === 0) {
    out.push('config/languages.yaml.languages 不能为空')
    return out
  }
  // default 必在 languages 里
  if (!data.default || !languages[data.default]) {
    out.push('config/languages.yaml.default = ' + JSON.stringify(data.default) + ' 必须在 languages 里有同名条目')
  }
  // fallback 链合法性：每门必须声明 fallback 数组、每档必须出现在 languages 里、链必须能走到头、不许绕回自己。
  for (const id of ids) {
    const entry = languages[id]
    if (!entry || typeof entry !== 'object') {
      out.push('config/languages.yaml.languages.' + id + ' 必须是对象')
      continue
    }
    if (!entry.label || typeof entry.label.zh !== 'string' || typeof entry.label.en !== 'string') {
      out.push('config/languages.yaml.languages.' + id + '.label 必须含 zh/en 两份人话说法')
    }
    // 空数组是合法的：它表示这门语言没有上一级可退，是回退链的终点（缺省语言通常就是这种情况）。
    if (!Array.isArray(entry.fallback)) {
      out.push('config/languages.yaml.languages.' + id + '.fallback 必须是数组；没有上一级可退时写空数组 []')
      continue
    }
    for (const f of entry.fallback) {
      if (!languages[f]) out.push('config/languages.yaml.languages.' + id + '.fallback 引用了未知语言 ' + JSON.stringify(f))
    }
    // 今天运行时只认第一项（客户端那边沿 fallback[0] 往下走），多写的项会被静默忽略 —— 这种「写在纸上不生效」
    //   最容易在下一个人补第二门退路时咬人，所以当场判红，而不是等有人发现它没起作用。
    if (entry.fallback.length > 1) {
      out.push('config/languages.yaml.languages.' + id + '.fallback 今天只支持一条（运行时只认第一项）：要一次退多门，先让客户端沿列表逐项尝试')
    }
  }
  // 链必须走到头：从每门语言出发沿 fallback[0] 往下走，同一门语言在一条链上出现两次就是环（包括自己指自己）。
  //   为什么不允许自指：#1292 的清单里有一版把 zh 写成 fallback: [zh]、en 写成 fallback: [en]，
  //   看着像「永久兜底」，其实是把「没有上一级」这件事写成了绕回自己 —— 下游按链找语言时会原地打转，
  //   真出现这种写法要当场说清楚，而不是靠读的人自己猜。
  //   为什么这里不另判「有没有终点」：语言是有限集合，若没有一门是终点，等于每门都指向别人，
  //   顺着链走必然重复 —— 下面这条环检测就会抓到，不必再写一条永远走不到的检查。
  for (const id of ids) {
    const trail: string[] = []
    let cur: string | null = id
    while (cur) {
      if (trail.indexOf(cur) >= 0) {
        out.push('config/languages.yaml.languages.' + id + ' 的 fallback 链绕回自己：' + trail.concat(cur).join(' -> ')
          + '（没有上一级可退时请把 fallback 写成空数组 []，不要写自己）')
        break
      }
      trail.push(cur)
      // 类型标注是必需的：cur 的类型由这条链自己决定，不标注时 TS 判成循环推断（TS7022）。
      const entry: LanguageEntry | undefined = languages[cur]
      const next: string | null = entry && Array.isArray(entry.fallback) && entry.fallback.length ? entry.fallback[0] : null
      cur = next && languages[next] ? next : null
    }
  }
  return out
}
