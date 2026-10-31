// src/shared/tracker/check-catalog-dirs.ts —— S3（#453）从 check-catalog.js 拆出之四个目录与范围判定、目录过滤、迁移映射，纯结构、行为零变化。
// 以后谁改它：改目录分类、后端目录、迁移映射的人。预估约210行，超 350 打回。
// 接线：不引用类型、校验、求值与视图文件（墙要求）；检测原语与 chain-types.ts 同源，改动时一起改；拼接标记不新设；调用方改路径（generic.js、detectChain.js）。

// 与 chain-types.ts 同源（墙要求不互相引用，类型也不引；改动时两处同改）：
// 谓词描述的静态形态，与 chain-types.Check 逐字对齐（kind 三种 + 开放字段）。
// 约定：目录项只描述谓词形状，执行永远由 predicateRegistry 与后端 preflight 完成。
type CatalogCheck = {
  kind?: 'primitive' | 'backend' | 'preflight'
  [key: string]: unknown
}
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
 * tracker/check-catalog-dirs.js — 通用检查目录与后端检查目录边界（#217 定版，2026-08-28 修订 #219/#245/#226 删 na，通用链视图）。
 *
 * S3（#453）：本文件为原 check-catalog.js 的目录半（四个目录与范围判定、目录过滤、迁移映射）；视图半见 check-catalog-views.js。
 *
 * 生效日期：2026-08-28
 * 效力规则：本文件以 #226 规约为基线；与更早方案冲突以本规约为准；未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 第一性原理：
 *  - 通用 = 真值不随 backendId 改变（所有后端都要问，恒脱离后端可检测）；后端 = 真值随 backendId 改变（仅该后端需要，物理隔离）。
 *  - 判据形式化：若把 backendId 从 'github' 切到 'markdown' / 'gitlab'，该检查的期望结果不变 → 通用；否则 → 后端。
 *  - 2026-08-27 起删 na：通用恒适用，无不适用场景；后端按物理隔离，行不存在而非标 na（本文件无 na 承载字段，见 #246）。
 *  - 本文件为目录边界的唯一真源，供编排链票（开门链 / 前置环境检测链）直接消费；后续新增检查必须先在此分类。
 *  - 目录产物进入检查链视图：视图半额外导出 GENERIC_CHECK_ITEMS / GENERIC_GATE_CHAIN / GENERIC_ENV_CHAIN 供 UI 链渲染器直接消费（#226）。
 *
 * 依据：.scratch/research/ui-hardcode-inventory-20260826.md 类别 8（host 检查链 14 项必迁）+ #198 五票结论 + #219 定版 + #224 v2 2026-08-28。
 */

/**
 * 目录项形态（目录只描述，不执行；执行由 predicateRegistry 与后端 preflight 完成）。
 * @typedef {Object} CatalogItem
 * @property {string} id チェック唯一 id（与 chain CheckItem.id 对齐）
 * @property {string} label 人读标签
 * @property {'generic'|'backend'} scope 通用或后端
 * @property {string[]} backends 适用后端（generic 为 ['github','markdown','gitlab']，backend 为子集）
 * @property {CatalogCheck} check 谓词描述（primitive/backend/preflight）
 * @property {string} origin 盘点来源（文件:行号或 inventory 类别）
 * @property {boolean} [sessionScoped] 结果是否取决于当前会话的沙箱许可（例：md:scratchWritable 的写探测）；#1483
 */

// 目录项的静态形态：与上面的 @typedef 同口径，类型注解用，运行时不存在。
// 约定：目录项只描述不执行，执行永远由 predicateRegistry 与后端 preflight 完成；反例是在目录里直接写可执行谓词，会绕过谓词只读与超时的统一管控。
type CatalogItem = {
  id: string
  label: string
  scope: 'generic' | 'backend'
  backends: string[]
  check: CatalogCheck
  origin: string
  sessionScoped?: boolean
}

/** 通用检查目录（与后端无关，所有后端都要问，恒适用，无 na）。 */
export const GENERIC_CATALOG: readonly CatalogItem[] = Object.freeze([
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
 * #227 D7：仓库定位(c1 backend) / gh CLI(c4) / gh 登录(c5) / API 可达(c6) 4 项迁移，语义与 9 项一致。
 * 2026-10-27（#1223）：删掉一项已退役的旧标签检查。它当时只在这份目录里、不在 GitHub 房的模块检查表里，
 *   靠运行期一条过滤把多出来的行藏住；删掉之后目录与模块检查表一致。
 * 2026-10-27 当天稍晚：GitHub 房的模块检查表（src/tracker/rooms/github/room/checks.ts）改成直接由这份目录派生，
 *   不再手抄第二份——「目录与检查表各说各话」从此在结构上不可能出现
 *   （tests/verify-1223-catalog-runtime-parity.ts 里的逐项断言保留作回归锁）。
 */
export const GITHUB_CATALOG: readonly CatalogItem[] = Object.freeze([
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
])

/** GitLab 后端检查目录（仅 gitlab 适用）。 */
export const GITLAB_CATALOG: readonly CatalogItem[] = Object.freeze([
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

/** Markdown 后端检查目录（仅 markdown 适用）。
 *
 * #1513 起固定三项、顺序固定（workspace → scratchWritable → containersReadable）：
 *   1. md:workspace —— 有工作单元或空工作区算通过，.scratch 读不出来算失败；
 *   2. md:scratchWritable —— .scratch 可写（或没有 .scratch 但仓库根可写）算通过；沙箱拦写探测算 pending；
 *   3. md:containersReadable —— 没有容器文件，或容器都读得动且版本 md-v1 算通过。
 * 三项都是后端谓词：判据本体在 src/tracker/rooms/markdown/workspace-checks.ts，房间 preflight 与宿主检查链
 *   共用同一份实现（票面硬条件：不许各写一套）。从前那条「只找 map.md」的判据已经拆掉（#1513），
 *   它的职责并进了上面三项：空工作区与容器文件由第一、三项分别量，不再单独判「有没有地图文件」。
 * 历史：2026-08-29 曾把 md:scratchWritable 从「只判存在」改成写探测；写探测行为保留，只是位置从 primitive
 *   搬到了房间的共用判据里（沙箱拦截的判定口径不变）。
 */
export const MARKDOWN_CATALOG: readonly CatalogItem[] = Object.freeze([
  {
    id: 'md:workspace',
    label: '本地工作区可读取',
    scope: 'backend',
    backends: ['markdown'],
    check: { kind: 'backend', id: 'workspace', backendId: 'markdown' },
    origin: 'backends/markdown/preflight.js / research 2026-08-29 / #1513',
  },
  {
    id: 'md:scratchWritable',
    label: '本地数据目录可读写',
    scope: 'backend',
    backends: ['markdown'],
    check: { kind: 'backend', id: 'scratchWritable', backendId: 'markdown' },
    origin: 'backends/markdown/preflight.js / inventory 类别 8 / research 2026-08-29',
    // #1483：这一项量的是「当前会话能不能往写」——同一工作区的只读会话与可写会话答案不同，
    //   所以链快照缓存命中时要按当前会话重算，不能沿用别的会话量出的结论（#1513 改成后端谓词后仍保留）。
    sessionScoped: true,
  },
  {
    id: 'md:containersReadable',
    label: '本地地图与规格可读取',
    scope: 'backend',
    backends: ['markdown'],
    check: { kind: 'backend', id: 'containersReadable', backendId: 'markdown' },
    origin: 'backends/markdown/parse.js / #1488 容器发现 / #1513',
  },
])

// 冻结目录项本身（不只是数组）：GitHub 房的模块检查表现在直接引用这些对象、不再各持一份副本；
// 元素如果可变，谁都能通过模块表改掉目录里的字，唯一真源就被绕过了。
for (const list of [GENERIC_CATALOG, GITHUB_CATALOG, GITLAB_CATALOG, MARKDOWN_CATALOG]) {
  for (const item of list) Object.freeze(item)
}

/** 全量目录（按 scope 分组，供编排链票直接合并）。 */
export const ALL_CATALOGS = Object.freeze({
  generic: GENERIC_CATALOG,
  github: GITHUB_CATALOG,
  gitlab: GITLAB_CATALOG,
  markdown: MARKDOWN_CATALOG,
})

/**
 * 判定某检查项是否通用（形式化判据）。
 *
 * 约定：只认本文件四个目录里的 id，目录里没有的一律返回 null 而不是猜一个归属；反例是把未知 id 默认当通用，拼错 id 的检查会在所有后端下静默通过。
 *
 * @param {string} checkId
 * @returns {'generic'|'backend'|null}
 */
export function scopeOf(checkId: string): 'generic' | 'backend' | null {
  if (GENERIC_CATALOG.some(c => c.id === checkId)) return 'generic'
  if (GITHUB_CATALOG.some(c => c.id === checkId) || GITLAB_CATALOG.some(c => c.id === checkId) || MARKDOWN_CATALOG.some(c => c.id === checkId)) return 'backend'
  return null
}

/**
 * 按 backendId 过滤出适用目录（通用 + 该后端），2026-08-27 起无 na，行不存在而非标 na。
 *
 * 约定：未知后端只给通用目录，不抛错也不补后端目录；反例是抛错，后端尚未选定时调用方会直接中断整条链。
 *
 * @param {'github'|'markdown'|'gitlab'|null} backendId
 * @returns {CatalogItem[]}
 */
export function catalogFor(backendId: 'github' | 'markdown' | 'gitlab' | null | undefined): CatalogItem[] {
  const base = [...GENERIC_CATALOG]
  if (backendId === 'github') base.push(...GITHUB_CATALOG)
  else if (backendId === 'gitlab') base.push(...GITLAB_CATALOG)
  else if (backendId === 'markdown') base.push(...MARKDOWN_CATALOG)
  return base
}

/**
 * 取某个后端的后端段（该后端链上真正要做检查的行，按目录顺序；通用项不在此列）。
 *
 * 约定：先按 catalogFor 取「通用 + 该后端」，再只留 scope==='backend'；未知后端得到空数组，不抛错。
 * 反例是各调用方各写一遍 `scope === 'backend'` 过滤——今天写法一样，明天就可能有一处漏改。
 *
 * @param {'github'|'markdown'|'gitlab'|null|undefined} backendId
 * @returns {CatalogItem[]}
 */
export function backendItemsOf(backendId: 'github' | 'markdown' | 'gitlab' | null | undefined): CatalogItem[] {
  return catalogFor(backendId).filter((item) => item.scope === 'backend')
}

/**
 * 必迁映射（inventory 类别 8 → 本目录 id），供下游 227-231 直接消费。
 */
export const MIGRATION_MAP = Object.freeze({
  'skill:wayfinder': 'GENERIC_CATALOG[0]',
  'skill:setup-matt-pocock-skills': 'GENERIC_CATALOG[1]',
  'skill:ask-matt': 'GENERIC_CATALOG[2]',
  'env:home': 'GENERIC_CATALOG[3]',
  'tracker:initialized': 'GENERIC_CATALOG[4]',
  'gh:installed': 'GITHUB_CATALOG[1]',
  'gh:authed': 'GITHUB_CATALOG[2]',
  'gh:repoAccess': 'GITHUB_CATALOG[3]',
  'glab:installed': 'GITLAB_CATALOG[0]',
  'glab:authed': 'GITLAB_CATALOG[1]',
  'glab:repoAccess': 'GITLAB_CATALOG[2]',
  'md:workspace': 'MARKDOWN_CATALOG[0]',
  'md:scratchWritable': 'MARKDOWN_CATALOG[1]',
  'md:containersReadable': 'MARKDOWN_CATALOG[2]',
})

export const CATALOG_VERSION = 1
