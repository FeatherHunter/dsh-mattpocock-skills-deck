// src/shared/tracker/chain-types.js —— S1（#451）从 chain.js 拆出之枚举与形状，纯结构、行为零变化。
// 以后谁改它：改枚举、形状、展示等级、归一函数、契约常量的人。预估约230行，超 350 打回。
// 接线：纯定义，零运行时引用；不引用校验与求值文件（墙要求）；调用方按名字改路径（见 #443 接线图）。

/**
 * tracker/chain.js — 契约层「检查项 / 检查链条 / 动作词汇表」一等公民定义（host + client 共用，纯类型 + 纯函数，无 IO）。
 *
 * 生效日期：2026-08-26 18:00
 * 效力规则：本文件以 #217（2026-08-26 18:00）规约为基线；与更早方案冲突以本规约为准；
 *           未来任何定版方案若改动本规约，以未来版本为准；落盘文件须携带此头（见 CONTEXT.md「版本与效力」）。
 *
 * 第一性原理（#217 定版，承接 #215 地图与 #198 五票结论；2026-08-27 修订 #219/#245 #246 落地删 na）：
 *  - 声明式 UI 语言：{check, onPass:{show,actions}, onFail:{show,actions}} 只驱动展示与动作入口，**永不进入数据路径**。
 *  - 操作能力（capability）= 运行时调用结果（G5：无能力表、无分支、调用即知、unsupported 诚实失败）——与检查项正交。
 *  - 检查链条 = 有序检查项序列；前步通过才进入下一步；**推进只来自重求值**（重新问谓词、探测真实状态），不来自动作回调。
 *  - 动作词汇表跨层协议：形状定义与类型枚举在契约层（本文件），执行器 dispatcher 在 UI 层（client/kernel/actions.js），动作声明在后端模块/通用目录。
 *  - 2026-08-27 修订：删 'na'，通用恒脱离后端可检测、后端物理隔离、N 动态，跨后端误导靠行不存在根治。
 *
 * G5 双名制（D4）落地：
 *  - 动作/检查项数据**永不被数据路径读取**（不得进入任何 Tracker op 的实现分支，不得作为能力判据）；
 *    本文件为 UI 检查项的唯一形状真源，与操作能力严格分离。
 *
 * 动作不承诺修复，检查才判定状态（D5 原则）：
 *  - 动作只声明意图，不宣称已修复；链条推进只来自重求值（宿主重探谓词 + 求值器重跑）。
 *
 * 版本与效力：2026-08-27 修订（承接 CONTEXT.md 2026-08-27 基线，以更新日期者为准，删 na）。
 *  - 本文件为契约层唯一真源；后端与 UI 共读同一形状，防漂移；遇枚举外类型 = 诚实 unsupported。
 *  - 变更须在对应子图内先明确推翻本契约（第一性原理：先定契约，再谈子图内部决定）。
 */

/** 契约形状版本（供日志/审计）。 */
export const CHAIN_VERSION = 1

/** 检查项状态集（链条求值输出）。枚举值小写短横线，契约层稳定。2026-08-27 起删 NA，四态。 */
export const CHECK_STATE = Object.freeze({
  DONE: 'done',       // 检查通过，链条前进
  CURRENT: 'current', // 链头未通过且有可执行动作（需用户/ AI 立即处理）—— 高亮态
  FAIL: 'fail',       // 链头未通过且无可执行动作（ terminal 失败，需人工介入）—— 红态
  PENDING: 'pending', // 探测中（输入为 null/缺位）或被前步阻塞—— 灰态/ spinner
})

/** 别名：步骤状态（done/current/fail/pending 四态；与 CHECK_STATE 同值，2026-08-27 起无 na）。 */
export const STEP_STATUS = CHECK_STATE

/** 动作类型枚举（v1 六种，契约层唯一真源；2026-08-28 新增 wizard 向导）。 */
export const ACTION_TYPE = Object.freeze({
  INJECT_PROMPT: 'inject-prompt', // 推进型：注入提示词，配合重求值推进（例：gh auth login 引导）
  OPEN_URL: 'open-url',           // 信息型：打开链接，不宣称修复、不推进链
  RPC: 'rpc',                     // 执行型：host.call（例：wf.openFolder）
  FORM: 'form',                   // 执行型：内嵌字段表单，提交后走 submitAction
  REFRESH: 'refresh',             // 执行型：触发重求值（例：重探）
  WIZARD: 'wizard',               // 执行型：多步向导（单弹窗内分页，Q5 定版：按步校验、最后一起提交、可返回、取消丢弃）
})

/** 别名：动作词汇表枚举（兼容票面命名 ACTION_TYPES）。 */
export const ACTION_TYPES = ACTION_TYPE
export const KNOWN_ACTION_TYPES = Object.freeze(Object.values(ACTION_TYPE))

/** 检测原语枚举（通用目录可用；后端目录可用 backend/preflight 种类）。 */
export const PRIMITIVE_KIND = Object.freeze({
  COMMAND_EXISTS: 'commandExists', // 例：{command:'gh'} / {command:'glab'}
  FILE_EXISTS: 'fileExists',       // 例：{path:'.git/config'} / {path:'docs/agents/issue-tracker.md'}
  ENV: 'env',                      // 例：{key:'HOME'}
  SKILL_PROBE: 'skillProbe',       // 例：{skill:'wayfinder'}
  HOME_DIR: 'homeDir',             // 例：{} — 用户主目录可解析：一律问平台层（#171：win32 不读 HOME，走 os.homedir→USERPROFILE；linux/mac 走 os.homedir），
                                   //   不再直接读 process.env.HOME（Windows 从不设置该变量，会误报 HOME not set）
  DIR_WRITABLE: 'dirWritable',     // 例：{path:'.scratch'} — 目录「存在且可写」：写探测（往目录写临时探针并清理），
                                   //   跨 OS 唯一可靠的「可写」判据（stat/lstat 的权限位在 Windows 不可靠）；谓词只读纪律的唯一例外
})

/** 展示等级（蓝/黄/红条；与 SHOW_LEVELS 同义，小写）。 */
export const SHOW_LEVELS = Object.freeze({
  INFO: 'info',
  WARN: 'warn',
  BAD: 'bad',
})

/** 归一展示等级（容 ok→info, error→bad）。 */
export function normalizeShowLevel(level) {
  const s = String(level || '').trim().toLowerCase()
  if (s === 'info' || s === 'warn' || s === 'bad') return s
  if (s === 'ok') return SHOW_LEVELS.INFO
  if (s === 'error') return SHOW_LEVELS.BAD
  return SHOW_LEVELS.INFO
}

/** 是否为已知动作类型。 */
export function isKnownActionType(type) {
  return KNOWN_ACTION_TYPES.includes(String(type || '').trim())
}

/**
 * Check — 检查谓词的声明式描述（可序列化，可落盘，不含函数）。
 * 三种 kind，正交覆盖 88 条盘点中的 14 项必迁 + 通用探测：
 *  - primitive：通用原语（commandExists/fileExists/env/skillProbe），由宿主 predicateRegistry 解析执行
 *  - backend：后端专属谓词（id 由后端模块定义，如 'gh:installed' / 'gitlab:repoAccess'），宿主注册表按 backendId 分发
 *  - preflight：复用现有 preflight 能力（id 如 'ghCli' / 'ghAuth'），宿主透传
 *  - 兼容简化形态：check 为 string 标识（如 'git.repo'），视为 backend kind 的简写
 *
 * @typedef {Object} Check
 * @property {'primitive'|'backend'|'preflight'} [kind]
 * // 兼容：string 形态直接视为谓词标识
 */

/**
 * Show — 检查项的展示数据（i18n 单信源，UI 透传渲染；兼容票面 {title,desc,level} 直写形态）。
 * @typedef {Object} Show
 * @property {string} [i18nKey]  locale 键（例：'check.ghCli.title'），缺省时用 fallback/title
 * @property {string} [title]  直写标题（票面 D3 形状；与 i18nKey 二选一）
 * @property {string} [desc]  直写描述
 * @property {string} [level]  仅 onFail：'info'|'warn'|'bad'
 * @property {Record<string,string>} [params] 插值参数
 * @property {string} [fallback] 回落文案（无 i18n 时展示）
 * @property {string} [hint] 辅助提示（可含多态 prompt 透传）
 */

/**
 * FieldSchema — form 动作的字段模式（v1 完整，含校验元数据）。
 * @typedef {Object} FieldSchema
 * @property {string} name 字段名（提交时 key）
 * @property {'text'|'number'|'date'|'single'|'multi'|'directory'|'file'} [type]
 * @property {string} [label] 人读标签（兼容 labelKey）
 * @property {string} [labelKey] i18n 键
 * @property {boolean} [required]
 * @property {string[]} [options] single/multi 候选
 * @property {string} [placeholderKey]
 * @property {string} [placeholder]
 * @property {string} [defaultValue]
 * @property {string} [pattern]
 */

/**
 * Action — 动作词汇表的判别联合（契约层只定义形状，执行在 UI 层）。
 * @typedef {Object} Action
 * @property {string} type ACTION_TYPE 之一
 * // inject-prompt
 * @property {string} [prompt] prompt 名（type=inject-prompt 时，如 'setupRun' / 'installSkills' / 'ghAuthLogin'；兼容 promptId）
 * @property {string} [promptId] 别名
 * @property {Record<string,string>} [args] prompt 参数（兼容 params）
 * @property {Record<string,unknown>} [params]
 * // open-url
 * @property {string} [url]
 * // rpc
 * @property {string} [method] host.call 方法名（type=rpc 时；兼容 endpoint）
 * @property {string} [endpoint]
 * @property {unknown} [params] 方法参数（rpc 时）
 * @property {Record<string,unknown>} [args]
 * // form
 * @property {FieldSchema[]} [schema] 字段模式（type=form 时必有；兼容 fields）
 * @property {FieldSchema[]} [fields]
 * @property {Action} [submitAction] 提交动作（type=form 时必有，通常为 rpc 或 inject-prompt；兼容 submit）
 * // wizard（2026-08-28 Q5 定版：单弹窗内分页，按步校验、最后一起提交、可返回、取消丢弃）
 * @property {Array<{title?: string, schema: FieldSchema[]}>} [steps] 向导步骤（type=wizard 时必有，每步 schema 复用 FieldSchema，title 无则回落“步骤 n/总数”）
 * @property {Action} [submitAction] 提交动作（type=wizard 时必有，合并全步 values 后触发）
 * @property {Object} [form] 兼容票面 form:{title,desc,fields,submit:{endpoint}}
 * @property {Object} [submit]
 * // refresh
 * @property {'chain'|'snapshot'} [target] 刷新目标（type=refresh 时）
 */

/**
 * CheckItem — 检查项一等公民。
 * @typedef {Object} CheckItem
 * @property {string} [id] 检查项唯一 id（链内唯一，供 predicateResults 索引；未提供时回退用 check 字符串）
 * @property {string|Check} check 谓词描述（string 标识或对象；票面给 string，精细化给对象）
 * @property {{show: Show|null, actions: Action[]}} onPass 通过时的展示与动作
 * @property {{show: Show|null, actions: Action[]}} onFail 未通过时的展示与动作
 * @property {string} [label] 人读标签（可选，仅调试/日志）
 * @property {string} [group] 可选分组（'gate'|'env' 等，供编排链分段用；不驱动求值）
 */

/**
 * Chain — 有序检查项序列（前步通过才进入下一步）。
 * @typedef {CheckItem[]} Chain
 */

/**
 * StepSnapshot — 链条求值后单步快照（UI 直接消费渲染）。
 * @typedef {Object} StepSnapshot
 * @property {string} id 对应 CheckItem.id（或回退 check 串）
 * @property {string|Check} check 原检查描述（透传）
 * @property {import('./constants.js').CHECK_STATE} status CHECK_STATE 之一
 * @property {Show|null} show 当前应展示的 show（按 status 选 onPass/onFail）
 * @property {Action[]} actions 当前应展示的 actions（同上）
 * @property {boolean} isApplicable 是否适用（2026-08-27 起恒 true，删 na）
 * @property {string|null} blockedBy 前序未通过项 id（若被阻塞）
 * @property {boolean} isCurrent 是否为链头当前步（仅一处 true）
 * @property {boolean} isBlocking 是否阻塞后续
 */

/**
 * ChainSnapshot — 整条链的求值快照（纯函数产出，宿主计算一次，UI 无脑渲染）。
 * @typedef {Object} ChainSnapshot
 * @property {StepSnapshot[]} steps 每步快照（与输入 chain 等长，顺序一致）
 * @property {number|null} currentIndex 链头索引（首个非 done 的索引；全 done 时 null，2026-08-27 起无 na）
 * @property {number} doneCount 已通过数
 * @property {number} applicableCount 适用项总数（= total，2026-08-27 起删 na）
 * @property {number} totalCount 总长
 * @property {'allDone'|'hasCurrent'|'pending'|'empty'} chainState 链整体态
 * @property {string} version CHAIN_VERSION 字符串化
 * // 兼容票面别名
 * @property {number} currentIndex
 * @property {number} failedIndex
 * @property {boolean} isComplete
 * @property {boolean} hasBlockingFailure
 * @property {string|null} blockingCheck
 */

// 与校验文件内的同名集合同源（墙要求不互相引用；改动时两处同改）。
const VALID_ACTION_TYPES = new Set(Object.values(ACTION_TYPE))

/**
 * 归一动作展示（诚实 unsupported：未知类型原样透传，由 UI 层判 unsupported 展示）。
 * @param {Action} action
 * @returns {{supported: boolean, action: Action}}
 */
export function normalizeAction(action) {
  if (!action || typeof action !== 'object' || !action.type) return { supported: false, action }
  const t = String(action.type).trim()
  if (!VALID_ACTION_TYPES.has(t)) return { supported: false, action }
  return { supported: true, action }
}

// ---------- 契约层常量导出（供后端/UI 单信源） ----------

export const CHAIN_CONTRACT = Object.freeze({
  version: CHAIN_VERSION,
  states: CHECK_STATE,
  actions: ACTION_TYPE,
  primitives: PRIMITIVE_KIND,
  stepStatus: CHECK_STATE,
  showLevels: SHOW_LEVELS,
})
