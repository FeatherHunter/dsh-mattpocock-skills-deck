// views/versionControl/vcQuery.ts —— 历史高级查询的数据层：十条能力的目录、输入校验与一次读取（#1745 T10）
// 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回 src/client/index.ts
//   的 leaf 标记处（源码树里只有这一份真源）。本文件不画界面：只算「该给界面一份什么读数」。
//
// 这一页要落的是规格 #1586 的能力 3.4–3.13（十条）：单文件历史、行级追溯、按说明搜提交、
//   按代码变化搜提交、比较两个引用、两组提交对照、版本名、引用日志、提交备注、取某版本的文件内容。
//   十条各占一组输入，共用宿主那一条只读电话 VC_QUERY_PHONE（宿主侧 src/host/versionControlHistory.ts）。
//
// 目录只记「这条能力要哪些输入框」与「最多显示多少条」；能力名称、命令原文、主入口页面一律
//   运行期从能力账本读（vcCapabilityOf），不在这里抄第二份 —— 账本改了本页跟着变。
//
// 读不全怎么办（规格第 4 节「错误诚实」、第 5 节长任务边界）：
//   · blame 与 range-diff 不在第 5 节长任务清单里，宿主按显式字节上限一次读完，超限就是失败（truncated），
//     界面显示「读不全」并给重试，绝不拿半份数据冒充成功；
//   · compare / range-diff 另有条数上限，宿主回包带 truncated 标记，界面按标记显式标出截断条数。
// 输入校验分两层：本地先判「必填空着、整数写歪、行号区间颠倒或超跨度」，当场说清哪一个字段不对；
//   宿主按同一份口径再判一次（两边都不猜用户的意图）。
//
// 下面这些名字在构建拼好的闭包里由同一份源码提供，这里只声明形状（转译后整块消失）。

declare function vcCapabilityOf(...args: any[]): any
declare function vcFailureOf(...args: any[]): any
declare function vcShouldRead(...args: any[]): any

/** 宿主那条历史查询电话的名字（调用点与门禁都读这一份）。 */
export const VC_QUERY_PHONE = 'wf.gitHistoryQuery'

// 上限数字（界面要显式写出「最多显示多少」，所以这些数字得有一份可读的来源）。
//   它们必须与共享层 history-query-commands.ts 的常量逐条相等：本页是客户端半边，仓库纪律不许
//   客户端运行时 import src/shared（那是宿主侧），所以照同一份数字写在这里，由本票门禁逐条比对。
export const VC_QUERY_COUNT_MAX = 200
export const VC_QUERY_BLAME_SPAN_MAX = 500
export const VC_QUERY_COMPARE_MAX = 2000
export const VC_QUERY_RANGE_MAX = 300

/** 字段类型：text 文本 / number 整数 / select 下拉。下拉的 value 就是送给命令拼装器的那个值。 */
const F = {
  path: { name: 'path', type: 'text', required: true, labelKey: 'vc.query.field.path' },
  revOptional: { name: 'rev', type: 'text', required: false, labelKey: 'vc.query.field.rev' },
  revRequired: { name: 'rev', type: 'text', required: true, labelKey: 'vc.query.field.rev' },
  pattern: { name: 'pattern', type: 'text', required: true, labelKey: 'vc.query.field.pattern' },
  text: { name: 'text', type: 'text', required: true, labelKey: 'vc.query.field.text' },
  lineStart: { name: 'lineStart', type: 'number', required: true, labelKey: 'vc.query.field.lineStart' },
  lineEnd: { name: 'lineEnd', type: 'number', required: true, labelKey: 'vc.query.field.lineEnd' },
  left: { name: 'left', type: 'text', required: true, labelKey: 'vc.query.field.left' },
  right: { name: 'right', type: 'text', required: true, labelKey: 'vc.query.field.right' },
  base: { name: 'base', type: 'text', required: true, labelKey: 'vc.query.field.base' },
  ref: { name: 'ref', type: 'text', required: false, labelKey: 'vc.query.field.ref' },
  // 条数默认 50：与宿主 countOf 缺省值同一个数（写死在输入框初值里，用户看得见也能改）。
  count: { name: 'count', type: 'number', required: false, value: '50', labelKey: 'vc.query.field.count' },
  mode: {
    name: 'mode', type: 'select', required: false, value: 'occurrence', labelKey: 'vc.query.field.mode',
    options: [
      { value: 'occurrence', labelKey: 'vc.query.mode.occurrence' },
      { value: 'change', labelKey: 'vc.query.mode.change' },
    ],
  },
  compareMode: {
    name: 'mode', type: 'select', required: false, value: 'two-dot', labelKey: 'vc.query.field.compareMode',
    options: [
      { value: 'two-dot', labelKey: 'vc.query.compareMode.twoDot' },
      { value: 'three-dot', labelKey: 'vc.query.compareMode.threeDot' },
    ],
  },
}

/**
 * 十条能力的目录（次序与能力编号同序 3.4 → 3.13）。
 * limit 是「本组最多显示多少条」：0 表示这条能力没有条数上限（describe / notes / show-file 各只有一条读数）。
 */
export const VC_QUERY_CATALOG = [
  { kind: 'file-history', capId: '3.4', limit: VC_QUERY_COUNT_MAX, fields: [F.path, F.count] },
  { kind: 'blame', capId: '3.5', limit: VC_QUERY_BLAME_SPAN_MAX, fields: [F.path, F.lineStart, F.lineEnd, F.revOptional] },
  { kind: 'grep', capId: '3.6', limit: VC_QUERY_COUNT_MAX, fields: [F.pattern, F.count] },
  { kind: 'pickaxe', capId: '3.7', limit: VC_QUERY_COUNT_MAX, fields: [F.text, F.mode, F.count] },
  { kind: 'compare', capId: '3.8', limit: VC_QUERY_COMPARE_MAX, fields: [F.left, F.right, F.compareMode] },
  { kind: 'range-diff', capId: '3.9', limit: VC_QUERY_RANGE_MAX, fields: [F.base, F.left, F.right] },
  { kind: 'describe', capId: '3.10', limit: 0, fields: [] },
  { kind: 'reflog', capId: '3.11', limit: VC_QUERY_COUNT_MAX, fields: [F.ref, F.count] },
  { kind: 'notes', capId: '3.12', limit: 0, fields: [F.revOptional] },
  { kind: 'show-file', capId: '3.13', limit: 0, fields: [F.revRequired, F.path] },
]

/** 目录里的一条按能力编号补上账本事实（页面、名称、命令、主入口）：账本是唯一数据源。 */
export const vcQueryCatalogOf = function () {
  return VC_QUERY_CATALOG.map(function (e: any) {
    const cap: any = vcCapabilityOf(e.capId) || {}
    const page = String(cap.page || '')
    return {
      kind: e.kind, capId: e.capId, limit: e.limit, fields: e.fields,
      page: page,
      name: String(cap.name || e.capId),
      command: String(cap.command || ''),
      primaryEntry: String(cap.primaryEntry || ''),
      // 主入口落在「管理 › 诊断」的四条（3.5 / 3.9 / 3.11 / 3.13）由账本的页面归属判出来，
      //   本页不另写一份名单；诊断页上这四条要额外标「主入口」并高亮。
      diagnostic: page === 'diagnostics',
    }
  })
}
/** 某一页要画哪几组（页面归属照账本，不照本文件的书写次序）。 */
export const vcQueryEntriesOf = function (page: any) {
  const want = String(page || '')
  return vcQueryCatalogOf().filter(function (e: any) { return e.page === want })
}
/** 目录里的一条（找不到回 null，不造一个空壳当成功）。 */
export const vcQueryEntryOf = function (kind: any) {
  const want = String(kind || '')
  const found = VC_QUERY_CATALOG.filter(function (e: any) { return e.kind === want })
  return found.length === 1 ? vcQueryCatalogOf().filter(function (e: any) { return e.kind === want })[0] : null
}
/** 一份全新的输入状态：每组只放带初值的字段（条数与两种下拉）。 */
export const vcQueryDefaultsOf = function (kind: any) {
  const out: any = {}
  VC_QUERY_CATALOG.forEach(function (e: any) {
    if (e.kind !== String(kind || '')) return
    e.fields.forEach(function (f: any) { if (f.value !== undefined) out[f.name] = String(f.value) })
  })
  return out
}
export const vcQueryInputsOf = function () {
  const out: any = {}
  VC_QUERY_CATALOG.forEach(function (e: any) { out[e.kind] = vcQueryDefaultsOf(e.kind) })
  return out
}
/** 某一组某个输入框现在的值（没填过就是空串；初值由 vcQueryInputsOf 放好）。 */
export const vcQueryInputValueOf = function (inputs: any, kind: any, field: any) {
  const one = (inputs && inputs[String(kind)]) || {}
  const v = one[String(field)]
  return v === undefined || v === null ? '' : String(v)
}
/** 一份全新的查询状态（还没跑过任何一条）：'idle' 三态之外多一个「还没跑」。 */
export const vcNewQueries = function () { return {} }
export const vcQueryStateOf = function (queries: any, kind: any) {
  const one = queries && queries[String(kind)]
  return one && typeof one === 'object' ? one : { state: 'idle', seq: 0, data: null, error: null }
}
/** 把某组标成「正在读」，代际号加一：晚到的旧回包不许盖掉新一次读取。 */
export const vcMarkQueryLoading = function (queries: any, kind: any) {
  const next: any = Object.assign({}, queries || {})
  const cur = vcQueryStateOf(queries, kind)
  next[String(kind)] = { state: 'loading', seq: Number(cur.seq || 0) + 1, data: cur.data, error: null }
  return next
}
/** 迟到回包怎么处理：当前代际比刚回来的大，就丢掉刚回来的那一份（与 #864 的提交读取同一条纪律）。 */
export const vcApplyQueryReply = function (current: any, next: any, kind: any) {
  const cur = vcQueryStateOf(current && current.queries, kind)
  const nxt = vcQueryStateOf(next && next.queries, kind)
  if (Number(cur.seq || 0) > Number(nxt.seq || 0)) return current
  return next
}

/**
 * 本地预检 + 参数拼装：判「必填没填、整数写歪、行号区间颠倒、跨度超上限」，说清哪一个字段不对。
 * 为什么本地也要判一遍：宿主的错误信封说的是整条命令失败，用户看不出是哪个框填错了；
 *   这里当场指到字段名，重填一次就行，不用等一次网络往返。
 */
export const vcQueryParamsOf = function (kind: any, values: any) {
  const entry: any = vcQueryEntryOf(kind)
  if (!entry) return { ok: false, field: '', reason: 'unknown-kind' }
  const v = values || {}
  const pick = function (name: any) { const x = v[String(name)]; return x === undefined || x === null ? '' : String(x).trim() }
  const bad = function (field: any, reason: any) { return { ok: false, field: String(field), reason: String(reason) } }
  for (let i = 0; i < entry.fields.length; i += 1) {
    const f = entry.fields[i]
    const text = pick(f.name)
    if (f.required && text === '') return bad(f.name, 'required-missing')
    if (f.type === 'number' && text !== '' && !/^[0-9]+$/.test(text)) return bad(f.name, 'not-number')
  }
  if (kind === 'blame') {
    const a = Number(pick('lineStart'))
    const b = Number(pick('lineEnd'))
    if (b < a) return bad('lineEnd', 'range-order')
    if (b - a + 1 > VC_QUERY_BLAME_SPAN_MAX) return bad('lineEnd', 'range-span')
  }
  const params: any = {}
  entry.fields.forEach(function (f: any) {
    const text = pick(f.name)
    if (text === '') return
    params[f.name] = f.type === 'number' ? Number(text) : text
  })
  return { ok: true, params: params }
}

/** 回包形状对不对：给人看的读数必须逐类核到，缺一项就按 shape 失败（不拿半份数据冒充成功）。 */
export const vcQueryShapeOk = function (kind: any, reply: any) {
  if (!reply || reply.ok !== true || String(reply.kind || '') !== String(kind || '')) return false
  if (kind === 'file-history' || kind === 'grep' || kind === 'pickaxe') return Array.isArray(reply.commits) && typeof reply.count === 'number'
  if (kind === 'blame') return Array.isArray(reply.lines) && typeof reply.count === 'number'
  if (kind === 'compare') return Array.isArray(reply.files) && typeof reply.total === 'number' && typeof reply.truncated === 'boolean'
  if (kind === 'range-diff') return Array.isArray(reply.pairs) && Array.isArray(reply.extraLines) && typeof reply.truncated === 'boolean'
  if (kind === 'describe') return typeof reply.text === 'string' && typeof reply.dirty === 'boolean'
  if (kind === 'reflog') return Array.isArray(reply.entries) && typeof reply.count === 'number'
  if (kind === 'notes') return (reply.note === null || typeof reply.note === 'string') && typeof reply.reason === 'string'
  if (kind === 'show-file') return typeof reply.text === 'string' && typeof reply.binary === 'boolean'
  return false
}

// 日志：event 名沿用既有的 host.call / host.call.fail（不新增事件），字段只记电话名、耗时、
//   成功与否与错误散列 —— 错误原文截断后散列，绝不落全文。
const vcQueryOkLog = function (kind: any, t0: any) {
  try { log('info', 'host.call', { method: VC_QUERY_PHONE, latencyMs: Date.now() - t0, ok: true, kind: 'git-history-query' }) } catch (e) { /* 日志坏了不影响读数 */ }
}
const vcQueryFailLog = function (kind: any, t0: any, error: any) {
  try { log('warn', 'host.call.fail', { method: VC_QUERY_PHONE, kind: 'git-history-query', errorHash: dswsLogHash(dswsLogTrunc(String(kind) + ' ' + String((error && error.message) || error || ''), 120, 'error')) }) } catch (e) { /* 日志坏了不影响读数 */ }
}
const vcQuerySettle = function (reads: any, kind: any, patch: any) {
  const base = reads && typeof reads === 'object' ? reads : {}
  const cur = vcQueryStateOf(base.queries, kind)
  const next: any = Object.assign({}, base)
  next.queries = Object.assign({}, base.queries || {})
  next.queries[String(kind)] = Object.assign({ state: 'idle', seq: cur.seq, data: cur.data, error: null }, patch)
  return next
}

/**
 * 跑一组查询：先本地预检，再打电话，回包按形状核过才落成 OK；失败保留上一次读到的数据。
 * 返回一份新的 reads（与 vcData 的读取同一套约定：不原地改传进来的那份）。
 */
export const vcReadHistoryQuery = function (reads: any, call: any, cwd: any, kind: any, values: any) {
  const key = String(kind || '')
  const fail = function (error: any) { return Promise.resolve(vcQuerySettle(reads, key, { state: 'err', error: error })) }
  if (!vcShouldRead(cwd)) return fail({ kind: 'no-cwd', field: '', reason: 'no-cwd', message: '' })
  const built: any = vcQueryParamsOf(key, values)
  if (!built.ok) return fail({ kind: 'invalid-input', field: built.field, reason: built.reason, message: '' })
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_QUERY_PHONE, { cwd: String(cwd), kind: key, params: built.params }) })
    .then(function (reply: any) {
      // 先认成功：ok:true 且形状逐类核过才落 OK；ok:true 却缺字段按 shape 失败（不拿半份数据冒充成功）。
      //   顺序与 vcData 的读取一致 —— 反过来问 vcFailureOf 会把一切 ok:true 都判成 shape。
      if (reply && reply.ok === true && vcQueryShapeOk(key, reply)) {
        vcQueryOkLog(key, t0)
        return vcQuerySettle(reads, key, { state: 'ok', data: reply, error: null })
      }
      const bad = vcFailureOf(reply)
      vcQueryFailLog(key, t0, bad)
      return vcQuerySettle(reads, key, { state: 'err', error: { kind: bad.kind, field: '', reason: bad.kind === 'shape' ? 'shape' : 'git', message: bad.message } })
    })
    .catch(function (err: any) {
      const thrown = { kind: 'throw', message: String((err && err.message) || err || '') }
      vcQueryFailLog(key, t0, thrown)
      return vcQuerySettle(reads, key, { state: 'err', error: { kind: 'throw', field: '', reason: 'git', message: thrown.message } })
    })
}

/** 空结果是什么情形（'' 表示不是空结果）：按宿主的 reason 说，不猜。 */
export const vcQueryEmptyOf = function (kind: any, reply: any) {
  if (!reply) return ''
  if (kind === 'notes') return reply.note === null ? 'no-note' : ''
  const reason = String(reply.reason || '')
  if (reason === 'empty') return 'commits'
  if (reason === 'same') return kind === 'range-diff' ? 'rangeSame' : 'same'
  if (kind === 'show-file' && reply.binary !== true && String(reply.text || '') === '') return 'content'
  return ''
}
/** 截断读数（没截断回 null）：界面必须把截断显式写出来，不能悄悄少画几条。 */
export const vcQueryTruncatedOf = function (reply: any) {
  if (!reply || reply.truncated !== true) return null
  const total = Number(reply.total)
  if (Array.isArray(reply.files)) return { shown: reply.files.length, total: isFinite(total) ? total : reply.files.length }
  if (Array.isArray(reply.pairs)) return { shown: reply.pairs.length, total: isFinite(total) ? total : reply.pairs.length }
  return null
}
/** 一条结果清单现在有几条（列表标题上的数字；读不到就给 0，界面据此不画空标题）。 */
export const vcQueryShownOf = function (kind: any, reply: any) {
  if (!reply) return 0
  if (Array.isArray(reply.commits)) return reply.commits.length
  if (Array.isArray(reply.lines)) return reply.lines.length
  if (Array.isArray(reply.files)) return reply.files.length
  if (Array.isArray(reply.pairs)) return reply.pairs.length
  if (Array.isArray(reply.entries)) return reply.entries.length
  return 0
}
