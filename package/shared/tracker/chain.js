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

import { BACKEND_KIND as _BACKEND_KIND } from './constants.js' // reserved for catalog validation, not used directly
import { ERROR_KIND as _EK } from './constants.js'
const ERROR_KIND = _EK || { PARSE: 'parse', UNSUPPORTED: 'unsupported' }

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

// ---------- 内部辅助 ----------

function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v) }

function deriveCheckId(item) {
  if (!item) throw new Error('CheckItem 必须为对象')
  if (typeof item.id === 'string' && item.id.trim()) return item.id.trim()
  // 回退用 check 字符串（票面简化形态）
  const c = item.check
  if (typeof c === 'string' && c.trim()) return c.trim()
  if (c && typeof c === 'object' && typeof c.id === 'string' && c.id.trim()) return c.id.trim()
  if (c && typeof c === 'object' && typeof c.kind === 'string') {
    // 对象形态无 id 时，用 kind:id 或 kind:primitive:xxx 拼装
    if (c.id) return String(c.kind) + ':' + String(c.id)
    if (c.primitive) return 'primitive:' + String(c.primitive) + ':' + String(c.command || c.path || c.key || c.skill || '')
  }
  throw new Error('CheckItem 需 id 或 string check 标识（链内唯一键）')
}

function normalizeResult(v) {
  if (v === true || v === 'pass' || v === 'done' || v === 'PASS') return 'pass'
  if (v === false || v === 'fail' || v === 'FAIL') return 'fail'
  if (v == null) return 'pending'
  if (typeof v === 'object' && v !== null) {
    if (v.status === 'pass' || v.status === 'done' || v.ok === true) return 'pass'
    if (v.status === 'fail' || v.ok === false) return 'fail'
    if (v.status === 'pending') return 'pending'
  }
  return String(v)
}

// ---------- 校验（契约层防漂移） ----------

const VALID_ACTION_TYPES = new Set(Object.values(ACTION_TYPE))
const VALID_PRIMITIVES = new Set(Object.values(PRIMITIVE_KIND))

/**
 * 校验单个动作形状（v1）。
 * 未知类型不判形状错，返回 unsupported 语义。
 * @param {Action} action
 * @returns {{ok: boolean, error?: {kind: string, message: string}, unsupported?: boolean}}
 */
export function validateAction(action) {
  if (!action || typeof action !== 'object') return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'action 必须为对象' } }
  const type = String(action.type || '').trim()
  if (!type) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'action.type 必填' } }
  if (!VALID_ACTION_TYPES.has(type)) return { ok: true, unsupported: true }

  // 归一字段兼容：prompt/promptId, method/endpoint, schema/fields, submitAction/submit/form.submit
  const getPrompt = action.prompt || action.promptId
  const getUrl = action.url
  const getMethod = action.method || action.endpoint
  const getSchema = action.schema || action.fields || (action.form && action.form.fields)
  const getSubmit = action.submitAction || action.submit || (action.form && action.form.submit)

  switch (type) {
    case ACTION_TYPE.INJECT_PROMPT: {
      if (!getPrompt || typeof getPrompt !== 'string' || !String(getPrompt).trim()) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'inject-prompt 需 prompt/promptId' } }
      return { ok: true }
    }
    case ACTION_TYPE.OPEN_URL: {
      if (!getUrl || typeof getUrl !== 'string' || !String(getUrl).trim()) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'open-url 需 url' } }
      return { ok: true }
    }
    case ACTION_TYPE.RPC: {
      if (!getMethod || typeof getMethod !== 'string' || !String(getMethod).trim()) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'rpc 需 method/endpoint' } }
      return { ok: true }
    }
    case ACTION_TYPE.FORM: {
      const fields = getSchema
      if (!Array.isArray(fields) || fields.length === 0) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'form 需 schema/fields 非空数组' } }
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i]
        if (!f || typeof f !== 'object' || !f.name || typeof f.name !== 'string' || !String(f.name).trim()) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'form.fields[' + i + '].name 必填' } }
        // label / labelKey 二选一兼容
        const hasLabel = (f.label && typeof f.label === 'string' && String(f.label).trim()) || (f.labelKey && typeof f.labelKey === 'string' && String(f.labelKey).trim())
        if (!hasLabel) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'form.fields[' + i + '].label/labelKey 必填' } }
      }
      if (!getSubmit || typeof getSubmit !== 'object') return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'form 需 submitAction/submit' } }
      // submit 需为合法动作或含 endpoint
      const subType = getSubmit.type
      const subEndpoint = getSubmit.endpoint || getSubmit.method
      if (subType && !VALID_ACTION_TYPES.has(String(subType).trim())) {
        // 未知提交类型按 unsupported 透传，不判错
      } else if (!subType && !subEndpoint) {
        return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'form.submit 需 type 或 endpoint' } }
      }
      return { ok: true }
    }
    case ACTION_TYPE.WIZARD: {
      const steps = action.steps
      if (!Array.isArray(steps) || steps.length === 0) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'wizard 需 steps 非空数组（至少一项）' } }
      for (let si = 0; si < steps.length; si++) {
        const s = steps[si]
        if (!s || typeof s !== 'object') return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'wizard.steps[' + si + '] 必须为对象' } }
        const schema = s.schema || s.fields
        if (!Array.isArray(schema)) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'wizard.steps[' + si + '].schema/fields 必须为数组' } }
        // 允许空 schema（单步空表单的占位校验在门禁层），但若有字段则校验形状复用 FieldSchema
        for (let fi = 0; fi < schema.length; fi++) {
          const f = schema[fi]
          if (!f || typeof f !== 'object' || !f.name || typeof f.name !== 'string' || !String(f.name).trim()) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'wizard.steps[' + si + '].fields[' + fi + '].name 必填' } }
          const hasLabel = (f.label && typeof f.label === 'string' && String(f.label).trim()) || (f.labelKey && typeof f.labelKey === 'string' && String(f.labelKey).trim()) || (f.name && typeof f.name === 'string')
          // 兼容：wizard 复用 FieldSchema 允许仅 name（label 回落 name），但若显式提供则需非空字符串
          if (f.label !== undefined && f.label !== null && typeof f.label !== 'string') return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'wizard.steps[' + si + '].fields[' + fi + '].label 必须为字符串' } }
          if (f.type !== undefined && f.type !== null) {
            const vt = String(f.type).trim()
            if (vt && !['text','number','date','single','multi','directory','file'].includes(vt)) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'wizard.steps[' + si + '].fields[' + fi + '].type 非法：' + vt } }
          }
        }
      }
      if (!getSubmit || typeof getSubmit !== 'object') return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'wizard 需 submitAction/submit' } }
      const subType = getSubmit.type
      const subEndpoint = getSubmit.endpoint || getSubmit.method
      if (subType && !VALID_ACTION_TYPES.has(String(subType).trim())) {
        // 未知提交类型按 unsupported 透传
      } else if (!subType && !subEndpoint) {
        return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'wizard.submit 需 type 或 endpoint' } }
      }
      return { ok: true }
    }
    case ACTION_TYPE.REFRESH: {
      return { ok: true }
    }
    default:
      return { ok: true, unsupported: true }
  }
}

export function validateCheckItem(item) {
  const errors = []
  if (!item || typeof item !== 'object') { errors.push('item must be object'); return errors }
  // id / check 二选一需有
  let idOk = false
  if (typeof item.id === 'string' && item.id.trim()) idOk = true
  const c = item.check
  if (!c) errors.push('check 必须提供（string 或对象）')
  else if (typeof c === 'string') {
    if (!c.trim()) errors.push('check string 需非空')
    else idOk = true
  } else if (typeof c === 'object') {
    if (c.kind !== 'primitive' && c.kind !== 'backend' && c.kind !== 'preflight') errors.push('check.kind must be primitive|backend|preflight（或用 string 简写）')
    if (c.kind === 'primitive') {
      if (!VALID_PRIMITIVES.has(c.primitive)) errors.push('primitive must be one of ' + [...VALID_PRIMITIVES].join(','))
      if (c.primitive === PRIMITIVE_KIND.COMMAND_EXISTS && typeof c.command !== 'string') errors.push('commandExists needs command:string')
      if (c.primitive === PRIMITIVE_KIND.FILE_EXISTS && typeof c.path !== 'string') errors.push('fileExists needs path:string')
      if (c.primitive === PRIMITIVE_KIND.DIR_WRITABLE && typeof c.path !== 'string') errors.push('dirWritable needs path:string')
      if (c.primitive === PRIMITIVE_KIND.ENV && typeof c.key !== 'string') errors.push('env needs key:string')
      if (c.primitive === PRIMITIVE_KIND.SKILL_PROBE && typeof c.skill !== 'string') errors.push('skillProbe needs skill:string')
    }
    if ((c.kind === 'backend' || c.kind === 'preflight') && (typeof c.id !== 'string' || !c.id.trim())) errors.push(c.kind + ' needs id:string')
    // 对象形态若无 id，需有其他可推导键
    if (!idOk && typeof c.id !== 'string') {
      // 允许无显式 id 的对象 check？此时 require 外层 id
    }
    idOk = idOk || (typeof c.id === 'string' && c.id.trim())
  } else {
    errors.push('check 需为 string 或对象')
  }
  if (!idOk) errors.push('需提供 item.id 或 string check（链内唯一键）')

  // onPass / onFail 需为对象，show 可为 null 或含 title/i18nKey
  for (const k of ['onPass','onFail']) {
    const v = item[k]
    if (!v || typeof v !== 'object') { errors.push(k + ' must be object {show, actions}'); continue }
    // show 校验：允许 null，或对象含 title/fallback/i18nKey 之一
    if (v.show !== null && v.show !== undefined) {
      if (typeof v.show !== 'object' || Array.isArray(v.show)) errors.push(k + '.show must be object or null')
      else {
        const hasTitle = (v.show.title && typeof v.show.title === 'string' && String(v.show.title).trim()) || (v.show.fallback && typeof v.show.fallback === 'string' && String(v.show.fallback).trim()) || (v.show.i18nKey && typeof v.show.i18nKey === 'string' && String(v.show.i18nKey).trim())
        // onPass/onFail 的 show 允许为空（链渲染时回落），此处不强校验 title，但若提供需非空
        if (v.show.title !== undefined && v.show.title !== null && typeof v.show.title !== 'string') errors.push(k + '.show.title must be string')
        if (v.show.level !== undefined && v.show.level !== null && typeof v.show.level !== 'string') errors.push(k + '.show.level must be string')
      }
    }
    if (!Array.isArray(v.actions)) errors.push(k + '.actions must be array')
    else {
      for (let i=0;i<v.actions.length;i++) {
        const a = v.actions[i]
        if (!a || typeof a !== 'object' || typeof a.type !== 'string' || !a.type.trim()) { errors.push(k + '.actions['+i+'].type must be non-empty string'); continue }
        if (!VALID_ACTION_TYPES.has(String(a.type).trim())) {
          // 未知类型 = unsupported，跳过形状校验（诚实透传）
          continue
        }
        const va = validateAction(a)
        if (!va.ok && !va.unsupported) errors.push(k + '.actions['+i+']: ' + (va.error && va.error.message ? va.error.message : 'invalid'))
      }
    }
  }
  return errors
}

export function validateChain(chain) {
  const errors = []
  if (!Array.isArray(chain)) { errors.push('chain must be array'); return errors }
  const seen = new Set()
  for (let i=0;i<chain.length;i++) {
    const e = validateCheckItem(chain[i])
    if (e.length) errors.push('['+i+'] ' + e.join('; '))
    try {
      const id = deriveCheckId(chain[i])
      if (seen.has(id)) errors.push('['+i+'] duplicate id/check: ' + id)
      seen.add(id)
    } catch (err) {
      // derive 错误已在 validateCheckItem 报，不重复
    }
  }
  return errors
}

// ---------- 求值器（纯函数，宿主喂「已求值的状态」→ 出步骤快照） ----------

/**
 * 契约层纯函数求值器（2026-08-27 起删 na，四态）。
 * 输入：静态 chain + 已 resolve 的 predicateResults（Record<id|check, 'pass'|'fail'|null>，null=pending）；
 * 输出：每步 StepSnapshot + 链整体 ChainSnapshot。
 * 约束：
 *  - 顺序求值：前步非 done 则后步一律 pending（被前步阻塞），与真实宿主探测一致；
 *  - 推进只来自重求值（调用方需重新 resolve predicateResults 再调本函数，动作回调不直接改 status）；
 *  - 诚实失败：枚举外 action type 在此不拦（留给 UI dispatcher 报 unsupported），求值器只定 status。
 *
 * @param {Chain} chain
 * @param {Record<string, 'pass'|'fail'|null|boolean|Object>|Map<string, any>|Function} predicateResults
 * @param {{backendId?: string}} [opts]
 * @returns {ChainSnapshot}
 */
export function evaluateChain(chain, predicateResults = {}, opts = {}) {
  if (!Array.isArray(chain)) throw new Error('evaluateChain: chain must be array')
  const results = predicateResults

  // 统一取结果：支持 Map、对象、函数；键按 item.id 回退 check 字符串
  const getVal = (item) => {
    try {
      if (typeof results === 'function') {
        const id = deriveCheckId(item)
        try { const v = results(id); if (v !== undefined) return v } catch {}
        // 回退按 check 字符串
        const c = item && item.check
        if (typeof c === 'string') {
          try { const v2 = results(c); if (v2 !== undefined) return v2 } catch {}
        }
        return undefined
      }
      if (results instanceof Map) {
        const id = deriveCheckId(item)
        if (results.has(id)) return results.get(id)
        const c = item && item.check
        if (typeof c === 'string' && results.has(c)) return results.get(c)
        if (c && typeof c === 'object' && c.id && results.has(c.id)) return results.get(c.id)
        return undefined
      }
      if (results && typeof results === 'object') {
        const id = deriveCheckId(item)
        if (Object.prototype.hasOwnProperty.call(results, id)) return results[id]
        const c = item && item.check
        if (typeof c === 'string' && Object.prototype.hasOwnProperty.call(results, c)) return results[c]
        if (c && typeof c === 'object' && c.id && Object.prototype.hasOwnProperty.call(results, c.id)) return results[c.id]
        // 兼容 check 作为键的字符串形态（对象 check 无 id 时）
        if (typeof c === 'string' && results[c] !== undefined) return results[c]
        return undefined
      }
    } catch {}
    return undefined
  }

  const steps = []
  let currentIndex = null
  let doneCount = 0
  let foundHead = false
  let headBlockedBy = null

  for (let i=0;i<chain.length;i++) {
    const item = chain[i]
    let id
    try { id = deriveCheckId(item) } catch (e) {
      // B5 fix: 畸形项不抛崩整链，降级为 pending 单步，detail 透传供日志二分
      const badIdx = i
      steps.push({ id: '__bad_'+badIdx, check: item && item.check || null, status: CHECK_STATE.PENDING, show: null, actions: [], isApplicable: true, blockedBy: foundHead ? headBlockedBy : null, detail: String((e && e.message) || e) })
      // 首个畸形即视为链头（pending），后续一律 pending
      if (!foundHead) { currentIndex = badIdx; foundHead = true; headBlockedBy = '__bad_'+badIdx }
      continue
    }
    const raw = getVal(item)
    // 归一化（2026-08-27 起无 na）
    let norm = raw
    if (raw === true) norm = 'pass'
    else if (raw === false) norm = 'fail'
    else if (raw == null) norm = 'pending'
    else if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase()
      if (s === 'pass' || s === 'done' || s === 'true' || s === 'ok') norm = 'pass'
      else if (s === 'fail' || s === 'false' || s === 'bad') norm = 'fail'
      else if (s === 'pending' || s === '') norm = 'pending'
      else norm = 'pending'
    } else if (isPlainObject(raw)) {
      if (raw.status === 'pass' || raw.status === 'done' || raw.ok === true) norm = 'pass'
      else if (raw.status === 'fail' || raw.ok === false) norm = 'fail'
      else norm = 'pending'
    } else {
      norm = 'pending'
    }

    let status
    let show = null
    let actions = []
    let isApplicable = true
    let blockedBy = foundHead ? headBlockedBy : null
    let isCurrent = false
    let isBlocking = false

    if (!foundHead) {
      if (norm === 'pass') {
        status = CHECK_STATE.DONE
        show = item.onPass && item.onPass.show ? item.onPass.show : null
        actions = item.onPass && Array.isArray(item.onPass.actions) ? item.onPass.actions : []
        doneCount++
      } else if (norm === 'fail') {
        const hasActions = item.onFail && Array.isArray(item.onFail.actions) && item.onFail.actions.length > 0
        status = hasActions ? CHECK_STATE.CURRENT : CHECK_STATE.FAIL
        show = item.onFail && item.onFail.show ? item.onFail.show : null
        actions = item.onFail && Array.isArray(item.onFail.actions) ? item.onFail.actions : []
        currentIndex = i
        foundHead = true
        headBlockedBy = id
        isCurrent = true
        isBlocking = true
      } else { // pending
        status = CHECK_STATE.PENDING
        show = (item.onFail && item.onFail.show) || (item.onPass && item.onPass.show) || null
        actions = (item.onFail && Array.isArray(item.onFail.actions) && item.onFail.actions.length ? item.onFail.actions : (item.onPass && item.onPass.actions) || [])
        currentIndex = i
        foundHead = true
        headBlockedBy = id
        isCurrent = true
        isBlocking = true
      }
    } else {
      status = CHECK_STATE.PENDING
      show = null
      actions = []
      isApplicable = true
      blockedBy = headBlockedBy
      isCurrent = false
      isBlocking = false
    }

    // 兼容票面 SHOW 的 {title,desc,level} 与 i18n 形态的透传：保留原 show 原样，仅归一 level 字段供后续
    steps.push({ id, check: item.check, status, show, actions, isApplicable, blockedBy, isCurrent, isBlocking })
  }

  const totalCount = chain.length
  const applicableCount = totalCount
  let chainState = 'empty'
  if (totalCount === 0) chainState = 'empty'
  else if (currentIndex === null) chainState = 'allDone'
  else {
    const cur = steps[currentIndex]
    if (cur.status === CHECK_STATE.PENDING) chainState = 'pending'
    else chainState = 'hasCurrent'
  }

  const isComplete = chainState === 'allDone'
  const hasBlockingFailure = currentIndex !== null
  const blockingCheck = hasBlockingFailure ? (steps[currentIndex]?.id || (()=>{ try{ return deriveCheckId(chain[currentIndex]) } catch { return '__bad_'+currentIndex } })()) : null

  return {
    steps,
    currentIndex,
    failedIndex: currentIndex,
    doneCount,
    applicableCount,
    totalCount,
    chainState,
    version: String(CHAIN_VERSION),
    // 兼容别名
    isComplete,
    hasBlockingFailure,
    blockingCheck,
  }
}

/**
 * 便捷：判断链是否完成（全部 done，无阻塞，2026-08-27 起无 na）。
 * @param {ChainSnapshot} snap
 * @returns {boolean}
 */
export function isChainComplete(snap) {
  return !!(snap && (snap.isComplete || snap.chainState === 'allDone'))
}

/**
 * 取当前需展示的失败步（首个 isCurrent），无则 null。
 * @param {ChainSnapshot} snap
 * @returns {StepSnapshot|null}
 */
export function currentStepOf(snap) {
  if (!snap || !Array.isArray(snap.steps) || snap.currentIndex == null || snap.currentIndex < 0) return null
  return snap.steps[snap.currentIndex] || null
}

/**
 * 就绪计数口径（契约层统一，供状态栏/胶囊/面板共用，2026-08-27 起无 na）。
 *  - 分子 = doneCount（不计 pending、fail/current）
 *  - 分母 = applicableCount（= total）
 * @param {ChainSnapshot} snap
 * @returns {{done:number, total:number, percent:number|null}}
 */
export function chainProgress(snap) {
  if (!snap || typeof snap.applicableCount !== 'number') return { done:0, total:0, percent:null }
  const done = snap.doneCount || 0
  const total = snap.applicableCount || 0
  if (total === 0) return { done, total, percent: 100 }
  return { done, total, percent: Math.round((done/total)*100) }
}

/**
 * 胶囊汇总口径：返回链状态的人读摘要（供 UI 胶囊/ badge 消费，纯数据）。
 * @param {ChainSnapshot} snap
 * @returns {{kind:'done'|'current'|'fail'|'pending'|'empty', labelKey:string, fallback:string}}
 */
export function capsuleSummary(snap) {
  if (!snap || snap.totalCount===0) return { kind:'empty', labelKey:'chain.empty', fallback:'无检查' }
  if (snap.chainState==='allDone') return { kind:'done', labelKey:'chain.done', fallback:'全部就绪' }
  if (snap.chainState==='pending') return { kind:'pending', labelKey:'chain.pending', fallback:'检测中…'}
  const cur = snap.steps[snap.currentIndex]
  if (!cur) return { kind:'pending', labelKey:'chain.pending', fallback:'检测中…'}
  if (cur.status===CHECK_STATE.CURRENT) return { kind:'current', labelKey:'chain.current', fallback: cur.show && (cur.show.fallback || cur.show.title) ? (cur.show.fallback || cur.show.title) : '待处理' }
  if (cur.status===CHECK_STATE.FAIL) return { kind:'fail', labelKey:'chain.fail', fallback: cur.show && (cur.show.fallback || cur.show.title) ? (cur.show.fallback || cur.show.title) : '未通过' }
  return { kind: cur.status, labelKey:'chain.'+cur.status, fallback: cur.show && (cur.show.fallback || cur.show.title) ? (cur.show.fallback || cur.show.title) : String(cur.status) }
}

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

export default {
  CHAIN_VERSION,
  CHECK_STATE,
  STEP_STATUS: CHECK_STATE,
  ACTION_TYPE,
  ACTION_TYPES: ACTION_TYPE,
  PRIMITIVE_KIND,
  SHOW_LEVELS,
  validateCheckItem,
  validateChain,
  validateAction,
  isKnownActionType,
  normalizeShowLevel,
  evaluateChain,
  chainProgress,
  capsuleSummary,
  isChainComplete,
  currentStepOf,
  normalizeAction,
  CHAIN_CONTRACT,
}