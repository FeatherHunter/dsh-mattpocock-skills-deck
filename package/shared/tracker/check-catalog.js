/**
 * tracker/check-catalog.js — 通用检查目录与后端检查目录边界（#217 定版，2026-08-28 修订 #219/#245/#226 删 na，通用链视图）。
 *
 * 生效日期：2026-08-28
 * 效力规则：本文件以 #226 规约为基线；与更早方案冲突以本规约为准；未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 第一性原理：
 *  - 通用 = 真值不随 backendId 改变（所有后端都要问，恒脱离后端可检测）；后端 = 真值随 backendId 改变（仅该后端需要，物理隔离）。
 *  - 判据形式化：若把 backendId 从 'github' 切到 'markdown' / 'gitlab'，该检查的期望结果不变 → 通用；否则 → 后端。
 *  - 2026-08-27 起删 na：通用恒适用，无不适用场景；后端按物理隔离，行不存在而非标 na（本文件无 na 承载字段，见 #246）。
 *  - 本文件为目录边界的唯一真源，供编排链票（开门链 / 前置环境检测链）直接消费；后续新增检查必须先在此分类。
 *  - 目录产物进入检查链视图：本文件额外导出 GENERIC_CHECK_ITEMS / GENERIC_GATE_CHAIN / GENERIC_ENV_CHAIN 供 UI 链渲染器直接消费（#226）。
 *
 * 依据：.scratch/research/ui-hardcode-inventory-20260826.md 类别 8（host 检查链 14 项必迁）+ #198 五票结论 + #219 定版 + #224 v2 2026-08-28。
 */

import { PRIMITIVE_KIND, ACTION_TYPE } from './chain.js'

/**
 * 目录项形态（目录只描述，不执行；执行由 predicateRegistry + 后端 preflight 完成）。
 * @typedef {Object} CatalogItem
 * @property {string} id チェック唯一 id（与 chain CheckItem.id 对齐）
 * @property {string} label 人读标签
 * @property {'generic'|'backend'} scope 通用或后端
 * @property {string[]} backends 适用后端（generic 为 ['github','markdown','gitlab']，backend 为子集）
 * @property {import('./chain.js').Check} check 谓词描述（primitive/backend/preflight）
 * @property {string} origin 盘点来源（文件:行号或 inventory 类别）
 */

/** 通用检查目录（与后端无关，所有后端都要问，恒适用，无 na）。 */
export const GENERIC_CATALOG = Object.freeze([
  {
    id: 'skill:wayfinder',
    label: '技能 wayfinder 已安装',
    scope: 'generic',
    backends: ['github','markdown','gitlab'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.SKILL_PROBE, skill: 'wayfinder' },
    origin: 'host/index.js:SKILL_PROBE_NAMES (inventory 类别 8)',
  },
  {
    id: 'skill:setup-matt-pocock-skills',
    label: '技能 setup-matt-pocock-skills 已安装',
    scope: 'generic',
    backends: ['github','markdown','gitlab'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.SKILL_PROBE, skill: 'setup-matt-pocock-skills' },
    origin: 'host/index.js:SKILL_PROBE_NAMES',
  },
  {
    id: 'skill:ask-matt',
    label: '技能 ask-matt 已安装',
    scope: 'generic',
    backends: ['github','markdown','gitlab'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.SKILL_PROBE, skill: 'ask-matt' },
    origin: 'host/index.js:SKILL_PROBE_NAMES',
  },
  {
    id: 'env:home',
    label: '用户主目录可解析',
    scope: 'generic',
    backends: ['github','markdown','gitlab'],
    // /homeDir（2026-08-28 修复）：主目录判定只问平台层（#171：win32 不读 HOME，走 os.homedir→USERPROFILE；linux/mac 走 os.homedir）。
    //   原 ENV(HOME) 在 Windows 必然误报「HOME not set」（Windows 从不设置该环境变量）。
    //   为什么是通用检查：技能判装的单一根 ~/.agents/skills（#276/#281）由此解析，三后端共用同一用户级根，
    //   换后端期望结果不变 → 按 #217 形式化判据归入通用；失败 = 环境级异常（daemon/容器/服务账户），应诚实红牌而非把技能误判为未安装。
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.HOME_DIR },
    origin: 'platform/getHome (inventory 类别 8) — #171 平台层统一',
  },
  {
    id: 'tracker:initialized',
    label: '工作区已初始化（docs/agents/issue-tracker.md 存在）',
    scope: 'generic',
    backends: ['github','markdown','gitlab'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.FILE_EXISTS, path: 'docs/agents/issue-tracker.md' },
    origin: 'host/checkTracker (inventory 类别 8)',
  },
])

/** GitHub 后端检查目录（仅 github 适用，物理隔离，其他后端该行不存在）。
 * #227 D7：仓库定位(c1 backend) / gh CLI(c4) / gh 登录(c5) / API 可达(c6) 4 项迁移，语义与 9 项一致；gh:labels 保留作仓库就绪链标签引导。
 */
export const GITHUB_CATALOG = Object.freeze([
  {
    // 2026-08-29 人话化（对抗式审查 S1）：标题 = 用户的任务语言（"已关联/已登录/可访问"），
    //   技术名（gh）只括注一次；原黑话（远端可解析 / origin / repoAccess）移入本注释存档。
    id: 'gh:remote',
    label: '已关联 GitHub 仓库',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'backend', id: 'repoRemote', backendId: 'github' },
    origin: 'host/checkRepo→backends/github/index.js:parseGithubRepo (inventory 类别 8 c1)',
  },
  {
    id: 'gh:installed',
    label: 'GitHub 助手（gh cli）已安装',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.COMMAND_EXISTS, command: 'gh' },
    origin: 'host/index.js:checkGhCli / backends/github/preflight.js:1 (inventory 类别 8 c4)',
  },
  {
    id: 'gh:authed',
    label: '已登录 GitHub',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'preflight', id: 'ghAuth' },
    origin: 'host/index.js:checkGhAuth / backends/github/preflight.js:2 (c5)',
  },
  {
    id: 'gh:repoAccess',
    label: '仓库在 GitHub 上可访问',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'backend', id: 'repoAccess', backendId: 'github' },
    origin: 'backends/github/preflight.js:3 / inventory 类别 8 c6',
  },
  {
    id: 'gh:labels',
    label: '标签已齐（10 核心标签）',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'backend', id: 'labels', backendId: 'github' },
    origin: 'host/checkLabels / inventory 类别 4/6',
  },
])

/** GitLab 后端检查目录（仅 gitlab 适用）。 */
export const GITLAB_CATALOG = Object.freeze([
  {
    id: 'glab:installed',
    label: 'GitLab CLI (glab) 已安装',
    scope: 'backend',
    backends: ['gitlab'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.COMMAND_EXISTS, command: 'glab' },
    origin: 'backends/gitlab/preflight.js:1 (inventory 类别 8 推导)',
  },
  {
    id: 'glab:authed',
    label: 'glab 已登录',
    scope: 'backend',
    backends: ['gitlab'],
    check: { kind: 'preflight', id: 'glabAuth' },
    origin: 'backends/gitlab/preflight.js:2',
  },
  {
    id: 'glab:repoAccess',
    label: 'GitLab 仓库可达',
    scope: 'backend',
    backends: ['gitlab'],
    check: { kind: 'backend', id: 'repoAccess', backendId: 'gitlab' },
    origin: 'backends/gitlab/preflight.js:3',
  },
])

/** Markdown 后端检查目录（仅 markdown 适用）。 */
// 2026-08-29 修正（research 实锤）：md:scratchWritable 原用 FILE_EXISTS 只判「存在」、从不测「可写」，
//   标签与检测条件不符；改为 DIR_WRITABLE（写探测原语，谓词只读纪律的唯一例外——验证性写、写完清理）。
export const MARKDOWN_CATALOG = Object.freeze([
  {
    id: 'md:scratchWritable',
    label: '本地数据目录可读写',
    scope: 'backend',
    backends: ['markdown'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.DIR_WRITABLE, path: '.scratch' },
    origin: 'backends/markdown/preflight.js / inventory 类别 8 / research 2026-08-29',
  },
  {
    id: 'md:parseOk',
    label: '本地关卡地图可读取',
    scope: 'backend',
    backends: ['markdown'],
    check: { kind: 'backend', id: 'parseOk', backendId: 'markdown' },
    origin: 'backends/markdown/parse.js',
  },
])

/** 全量目录（按 scope 分组，供编排链票直接合并）。 */
export const ALL_CATALOGS = Object.freeze({
  generic: GENERIC_CATALOG,
  github: GITHUB_CATALOG,
  gitlab: GITLAB_CATALOG,
  markdown: MARKDOWN_CATALOG,
})

/**
 * 判定某检查项是否通用（形式化判据）。
 * @param {string} checkId
 * @returns {'generic'|'backend'|null}
 */
export function scopeOf(checkId) {
  if (GENERIC_CATALOG.some(c => c.id === checkId)) return 'generic'
  if (GITHUB_CATALOG.some(c => c.id === checkId) || GITLAB_CATALOG.some(c => c.id === checkId) || MARKDOWN_CATALOG.some(c => c.id === checkId)) return 'backend'
  return null
}

/**
 * 按 backendId 过滤出适用目录（通用 + 该后端），2026-08-27 起无 na，行不存在而非标 na。
 * @param {'github'|'markdown'|'gitlab'|null} backendId
 * @returns {CatalogItem[]}
 */
export function catalogFor(backendId) {
  const base = [...GENERIC_CATALOG]
  if (backendId === 'github') base.push(...GITHUB_CATALOG)
  else if (backendId === 'gitlab') base.push(...GITLAB_CATALOG)
  else if (backendId === 'markdown') base.push(...MARKDOWN_CATALOG)
  return base
}

/**
 * 14 项必迁映射（inventory 类别 8 → 本目录 id），供下游 227-231 直接消费。
 */
export const MIGRATION_MAP = Object.freeze({
  'skill:wayfinder': 'GENERIC_CATALOG[0]',
  'skill:setup-matt-pocock-skills': 'GENERIC_CATALOG[1]',
  'skill:ask-matt': 'GENERIC_CATALOG[2]',
  'env:home': 'GENERIC_CATALOG[3]',
  'tracker:initialized': 'GENERIC_CATALOG[4]',
  'gh:installed': 'GITHUB_CATALOG[0]',
  'gh:authed': 'GITHUB_CATALOG[1]',
  'gh:repoAccess': 'GITHUB_CATALOG[2]',
  'gh:labels': 'GITHUB_CATALOG[3]',
  'glab:installed': 'GITLAB_CATALOG[0]',
  'glab:authed': 'GITLAB_CATALOG[1]',
  'glab:repoAccess': 'GITLAB_CATALOG[2]',
  'md:scratchWritable': 'MARKDOWN_CATALOG[0]',
  'md:parseOk': 'MARKDOWN_CATALOG[1]',
})


/**
 * 通用目录 → 检查链视图（#226）。
 * 每个 CatalogItem 转为契约层 CheckItem（带 Show/Action），可直接喂 evaluateChain。
 * 通用检查只读探测，失败返回而非抛；注册表验形状不验内容（与 tracker registry 哲学一致）。
 */

// CatalogItem → CheckItem 的映射（Show/Action 的契约级文案，i18nKey 单源）
function showFor(id, passTitle, failTitle, failLevel, failHint) {
  return {
    pass: { show: { i18nKey: 'check.' + id + '.pass', fallback: passTitle }, actions: [] },
    fail: { show: { i18nKey: 'check.' + id + '.fail', fallback: failTitle, level: failLevel, hint: failHint || undefined }, actions: [] },
  }
}

// 通用检查项的链视图（契约层形态，含展示与动作；全部只读探测，无写操作）
// 动作词汇表：inject-prompt（推进型，配合重求值）/ open-url（信息型）/ rpc / form / refresh（执行型）
// 原则：动作不承诺修复，检查才判定状态；未知类型 = 诚实 unsupported。
export const GENERIC_CHECK_ITEMS = Object.freeze([
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
].filter(Boolean))

/** 环境链通用分区（c7-c9 等后端无关环境就绪度，全部只读探测）。 */
export const GENERIC_ENV_CHAIN = Object.freeze(GENERIC_CHECK_ITEMS.filter(c => c.group === 'env'))

/** 通用链全量（gate + env），任意后端下输出一致（#226 验收）。 */
export const GENERIC_CHAIN = Object.freeze([...GENERIC_GATE_CHAIN, ...GENERIC_ENV_CHAIN])

/**
 * CatalogItem → CheckItem 转换（供后端目录复用，验形状不验内容）。
 * @param {import('./chain.js').Check} catalogItem
 * @returns {import('./chain.js').CheckItem}
 */
export function catalogItemToCheckItem(catalogItem) {
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
 * @param {import('./chain.js').CheckItem} item
 * @returns {string[]} errors 为空即形状合法
 */
export function validateGenericShape(item) {
  if (!item || typeof item !== 'object') return ['item must be object']
  if (typeof item.id !== 'string' || !item.id) return ['id must be non-empty string']
  if (!item.check || typeof item.check !== 'object') return ['check must be object']
  if (!item.onPass || typeof item.onPass !== 'object') return ['onPass must be object']
  if (!item.onFail || typeof item.onFail !== 'object') return ['onFail must be object']
  // 形状不验内容：不查 skill 是否真实存在、不查文件是否真在；只验字段存在性
  return []
}

export const CATALOG_VERSION = 1