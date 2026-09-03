// src/shared/tracker/chain-validate.js —— S1（#451）从 chain.js 拆出之三个校验函数，纯结构、行为零变化。
// 以后谁改它：改校验规则的人。预估约250行，超 350 打回。
// 接线：不引用类型与求值文件（墙要求）；动作类型、检测原语、小助手与类型、求值文件同源，改动时一起改；错误分类后备值与常量文件同源。

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

/** 别名：动作词汇表枚举（兼容票面命名 ACTION_TYPES）。 */
export const ACTION_TYPES = ACTION_TYPE
export const KNOWN_ACTION_TYPES = Object.freeze(Object.values(ACTION_TYPE))


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

// 与 src/shared/tracker/constants.js 同源（实测全文件 18 处仅用 PARSE 且与真值一致；改动时两处同改）。
const ERROR_KIND = Object.freeze({ PARSE: 'parse', UNSUPPORTED: 'unsupported' })

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
