// src/shared/tracker/check-catalog-views.ts —— S3（#453）从 check-catalog.js 拆出之链视图与目录转检查项、形状校验，纯结构、行为零变化。
// 以后谁改它：改链视图、展示文案、转换与形状校验的人。预估约150行，超 350 打回。
// 接线：不引用类型、校验、求值与目录文件（墙要求）；动作类型、检测原语与 chain-types.js 同源，改动时一起改；拼接标记不新设。

// 与 chain-types.js 同源（墙要求不互相引用；改动时两处同改）。
/** 动作类型枚举（v1 六种，契约层唯一真源；2026-08-28 新增 wizard 向导）。 */
const ACTION_TYPE = Object.freeze({
  INJECT_PROMPT: 'inject-prompt', // 推进型：注入提示词，配合重求值推进（例：gh auth login 引导）
  OPEN_URL: 'open-url',           // 信息型：打开链接，不宣称修复、不推进链
  RPC: 'rpc',                     // 执行型：host.call（例：wf.openFolder）
  FORM: 'form',                   // 执行型：内嵌字段表单，提交后走 submitAction
  REFRESH: 'refresh',             // 执行型：触发重求值（例：重探）
  WIZARD: 'wizard',               // 执行型：多步向导（单弹窗内分页，Q5 定版：按步校验、最后一起提交、可返回、取消丢弃）
})

// 与 chain-types.js 同源（墙要求不互相引用；改动时两处同改）。
/** 检测原语枚举（通用目录可用；后端目录可用 backend/preflight 种类）。 */
const PRIMITIVE_KIND = Object.freeze({
  COMMAND_EXISTS: 'commandExists', // 例：{command:'gh'} / {command:'glab'}
  FILE_EXISTS: 'fileExists',       // 例：{path:'.git/config'} / {path:'docs/agents/issue-tracker.md'}
  ENV: 'env',                      // 例：{key:'HOME'}
  SKILL_PROBE: 'skillProbe',       // 例：{skill:'wayfinder'}
  HOME_DIR: 'homeDir',             // 例：{} — 用户主目录可解析：一律问平台层（#171：win32 不读 HOME，走 os.homedir→USERPROFILE；linux/mac 走 os.homedir），
                                   //   不再直接读 process.env.HOME（Windows 从不设置该变量，会误报 HOME not set）
  DIR_WRITABLE: 'dirWritable',     // 例：{path:'.scratch'} — 目录「存在且可写」：写探测（往目录写临时探针并清理），
                                   //   跨 OS 唯一可靠的「可写」判据（stat/lstat 的权限位在 Windows 不可靠）；谓词只读纪律的唯一例外
})

/**
 * 通用目录 → 检查链视图（#226）。
 * 每个 CatalogItem 转为契约层 CheckItem（带 Show/Action），可直接喂 evaluateChain。
 * 通用检查只读探测，失败返回而非抛；注册表验形状不验内容（与 tracker registry 哲学一致）。
 */

// Show/Action 文案对的静态形态：pass 与 fail 各一套展示，动作为空数组或动作表。
// 约定：文案只描述状态，不承诺修复，推进靠 actions 里的动作；反例是在 fallback 里写“点击即可修复”，动作词汇表里并没有承诺修复的动作。
type ShowPair = {
  pass: { show: { i18nKey: string, fallback: string, level?: string }, actions: unknown[] }
  fail: { show: { i18nKey: string, fallback: string, level: string, hint?: string | undefined }, actions: unknown[] }
}

// CatalogItem → CheckItem 的映射（Show/Action 的契约级文案，i18nKey 单源）
function showFor(id: string, passTitle: string, failTitle: string, failLevel: string, failHint?: string): ShowPair {
  return {
    pass: { show: { i18nKey: 'check.' + id + '.pass', fallback: passTitle }, actions: [] },
    fail: { show: { i18nKey: 'check.' + id + '.fail', fallback: failTitle, level: failLevel, hint: failHint || undefined }, actions: [] },
  }
}

// 通用检查项的链视图（契约层形态，含展示与动作；全部只读探测，无写操作）
// 动作词汇表：inject-prompt（推进型，配合重求值）/ open-url（信息型）/ rpc / form / refresh（执行型）
// 原则：动作不承诺修复，检查才判定状态；未知类型 = 诚实 unsupported。
export const GENERIC_CHECK_ITEMS: readonly import('./chain-types.js').CheckItem[] = Object.freeze([
  {
    id: 'skill:wayfinder',
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.SKILL_PROBE, skill: 'wayfinder' },
    onPass: { show: { i18nKey: 'check.skill.wayfinder.pass', fallback: '技能 wayfinder 已安装', level: 'info' }, actions: [] },
    onFail: { show: { i18nKey: 'check.skill.wayfinder.fail', fallback: '技能 wayfinder 未安装', level: 'bad', hint: 'prompt:installSkillsFix' }, actions: [
      { type: ACTION_TYPE.FORM, label: '帮我安装', schema: [{ name: 'mode', type: 'single', label: '安装方式', options: ['让 AI 一步步引导安装（推荐）', '让 AI 直接执行安装命令'], defaultValue: '让 AI 一步步引导安装（推荐）' }], submitAction: { type: ACTION_TYPE.INJECT_PROMPT, prompt: 'installSkills', args: {} } },
      { type: ACTION_TYPE.INJECT_PROMPT, prompt: 'installSkills', label: '安装指引' },
      { type: ACTION_TYPE.REFRESH, target: 'chain' },
    ] },
    label: '技能 wayfinder 已安装',
    group: 'env',
  },
  {
    id: 'skill:setup-matt-pocock-skills',
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.SKILL_PROBE, skill: 'setup-matt-pocock-skills' },
    onPass: { show: { i18nKey: 'check.skill.setup-matt-pocock-skills.pass', fallback: '技能 setup-matt-pocock-skills 已安装', level: 'info' }, actions: [] },
    onFail: { show: { i18nKey: 'check.skill.setup-matt-pocock-skills.fail', fallback: '技能 setup-matt-pocock-skills 未安装', level: 'bad', hint: 'prompt:installSkillsFix' }, actions: [
      { type: ACTION_TYPE.FORM, label: '帮我安装', schema: [{ name: 'mode', type: 'single', label: '安装方式', options: ['让 AI 一步步引导安装（推荐）', '让 AI 直接执行安装命令'], defaultValue: '让 AI 一步步引导安装（推荐）' }], submitAction: { type: ACTION_TYPE.INJECT_PROMPT, prompt: 'installSkills', args: {} } },
      { type: ACTION_TYPE.INJECT_PROMPT, prompt: 'installSkills', label: '安装指引' },
      { type: ACTION_TYPE.REFRESH, target: 'chain' },
    ] },
    label: '技能 setup-matt-pocock-skills 已安装',
    group: 'env',
  },
  {
    id: 'skill:ask-matt',
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.SKILL_PROBE, skill: 'ask-matt' },
    onPass: { show: { i18nKey: 'check.skill.ask-matt.pass', fallback: '技能 ask-matt 已安装', level: 'info' }, actions: [] },
    onFail: { show: { i18nKey: 'check.skill.ask-matt.fail', fallback: '技能 ask-matt 未安装', level: 'bad', hint: 'prompt:installSkillsFix' }, actions: [
      { type: ACTION_TYPE.FORM, label: '帮我安装', schema: [{ name: 'mode', type: 'single', label: '安装方式', options: ['让 AI 一步步引导安装（推荐）', '让 AI 直接执行安装命令'], defaultValue: '让 AI 一步步引导安装（推荐）' }], submitAction: { type: ACTION_TYPE.INJECT_PROMPT, prompt: 'installSkills', args: {} } },
      { type: ACTION_TYPE.INJECT_PROMPT, prompt: 'installSkills', label: '安装指引' },
      { type: ACTION_TYPE.REFRESH, target: 'chain' },
    ] },
    label: '技能 ask-matt 已安装',
    group: 'env',
  },
  {
    id: 'env:home',
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.HOME_DIR },
    onPass: { show: { i18nKey: 'check.env.home.pass', fallback: '用户主目录可解析', level: 'info' }, actions: [] },
    onFail: { show: { i18nKey: 'check.env.home.fail', fallback: '用户主目录不可解析', level: 'warn' }, actions: [{ type: ACTION_TYPE.REFRESH, target: 'chain' }] },
    label: '用户主目录可解析',
    group: 'env',
  },
  {
    id: 'tracker:initialized',
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.FILE_EXISTS, path: 'docs/agents/issue-tracker.md' },
    onPass: { show: { i18nKey: 'check.tracker.initialized.pass', fallback: '工作区已初始化', level: 'info' }, actions: [] },
    onFail: { show: { i18nKey: 'check.tracker.initialized.fail', fallback: '工作区未初始化', level: 'warn', hint: 'prompt:setupRun' }, actions: [{ type: ACTION_TYPE.INJECT_PROMPT, prompt: 'setupRun', label: '执行初始化' }] },
    label: '工作区已初始化（docs/agents/issue-tracker.md 存在）',
    group: 'gate',
  },
])

/** 开门链门槛（通用链，两步：已选后端 → 已初始化）。#224 D6 三段式开门链前两步，通用恒脱离后端。 */
export const GENERIC_GATE_CHAIN = Object.freeze([
  {
    id: 'selection:backendSelected',
    check: { kind: 'backend', id: 'backendSelected' },
    onPass: { show: { i18nKey: 'check.selection.pass', fallback: '已选择后端', level: 'info' }, actions: [] },
    onFail: { show: { i18nKey: 'check.selection.fail', fallback: '请选择后端', level: 'warn' }, actions: [{ type: ACTION_TYPE.REFRESH, target: 'chain' }] },
    label: '已选择后端',
    group: 'gate',
  },
  GENERIC_CHECK_ITEMS.find(c => c.id === 'tracker:initialized'),
  // find 可能找不到（类型是 CheckItem|undefined）：过滤必须写类型谓词，
  // 否则链里会混进 undefined，后面 .find(c => c.id) 在严格模式下直接红。
  // Boolean 直传不收窄数组元素类型，这里只能手写。
].filter((c): c is import('./chain-types.js').CheckItem => c !== undefined))

/** 环境链通用分区（c7-c9 等后端无关环境就绪度，全部只读探测）。 */
export const GENERIC_ENV_CHAIN = Object.freeze(GENERIC_CHECK_ITEMS.filter(c => c.group === 'env'))

/** 通用链全量（gate + env），任意后端下输出一致（#226 验收）。 */
export const GENERIC_CHAIN = Object.freeze([...GENERIC_GATE_CHAIN, ...GENERIC_ENV_CHAIN])

// 目录项输入的静态形态：转换函数只读这四个字段，其余字段原样不看。
// 约定：后端目录项复用时只补默认展示，不改原 check 描述；反例是重写 check，会把目录里定好的谓词口径换掉。
type CatalogItemInput = {
  id: string
  label: string
  scope: string
  check: import('./chain-types.js').Check
}

/**
 * CatalogItem → CheckItem 转换（供后端目录复用，验形状不验内容）。
 *
 * 约定：通用目录里能找到的直接复用原项，不重建，后端目录项才补默认展示；反例是给通用项也重建，通用项上写好的安装引导动作会被默认动作覆盖掉。
 *
 * @param {import('./chain-types.js').Check} catalogItem
 * @returns {import('./chain-types.js').CheckItem}
 */
export function catalogItemToCheckItem(catalogItem: CatalogItemInput): import('./chain-types.js').CheckItem {
  if (!catalogItem || typeof catalogItem !== 'object') throw new Error('catalogItem must be object')
  const found = GENERIC_CHECK_ITEMS.find(c => c.id === catalogItem.id) || GENERIC_GATE_CHAIN.find(c => c.id === catalogItem.id)
  if (found) return found
  // 后端目录项（github/gitlab/markdown）复用 catalogItem 的 check，补默认 Show/Action。
  // 2026-08-29（审查 S1）：fallback = 纯标题——状态由行首圆点（✓/✗）与红卡表达，不再拼英文 OK/FAIL 后缀（中英混排）。
  return {
    id: catalogItem.id,
    check: catalogItem.check,
    onPass: { show: { i18nKey: 'check.' + catalogItem.id + '.pass', fallback: catalogItem.label, level: 'info' }, actions: [] },
    onFail: { show: { i18nKey: 'check.' + catalogItem.id + '.fail', fallback: catalogItem.label, level: 'bad' }, actions: [{ type: ACTION_TYPE.REFRESH, target: 'chain' }] },
    label: catalogItem.label,
    group: catalogItem.scope === 'generic' ? 'env' : 'backend',
  }
}

/**
 * 验形状（目录项形状校验，供 predicateRegistry 与 tracker registry 同哲学）。
 *
 * 约定：只查字段在不在，不查技能名与文件路径是真是假，真假是谓词运行时的事；反例是在这里查 skill 是否存在，会把形状校验变成需要文件系统的重操作。
 *
 * @param {import('./chain-types.js').CheckItem} item
 * @returns {string[]} errors 为空即形状合法
 */
export function validateGenericShape(item: import('./chain-types.js').CheckItem | null | undefined): string[] {
  if (!item || typeof item !== 'object') return ['item must be object']
  if (typeof item.id !== 'string' || !item.id) return ['id must be non-empty string']
  if (!item.check || typeof item.check !== 'object') return ['check must be object']
  if (!item.onPass || typeof item.onPass !== 'object') return ['onPass must be object']
  if (!item.onFail || typeof item.onFail !== 'object') return ['onFail must be object']
  // 形状不验内容：不查 skill 是否真实存在、不查文件是否真在；只验字段存在性
  return []
}
