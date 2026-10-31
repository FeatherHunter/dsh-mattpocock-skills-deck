// views/versionControl/vcDiagnostics.ts —— 诊断页的数据与动作层（#1761 T25，规格 #1586 域 13 + 5.12）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，所以这里不 import 任何东西。
//
// 这一片只做三件事，不画界面：
//   1. 把一条能力的操作翻成宿主三条电话之一要的参数（只读读 / 预检签票 / 凭票执行）；
//   2. 把回包落成页面状态（每条能力各自一格结果，结果就画在触发它的那一块里）；
//   3. 失败只翻成词条键，不在这里写任何人话 —— 话术全部走 config/copy/vcdiagnostics.yaml。
//
// 口径：13.3 与 13.14 的主入口不在本页（全库搜索 / 提交历史页），本页只放指针；
// 13.13 不单独给按钮，尾部签名行由提交页的「追加签名行」写入，本页只读展示；
// 13.12 只做 apply --check 预演，绝不真实应用补丁。

export const VC_DIAG_PHONES = { read: 'wf.gitDiagnosticsRead', check: 'wf.gitDiagnosticsCheck', write: 'wf.gitDiagnosticsWrite' }

// 只读查询的界面表：一行一条能力，输入格子的键与服务端参数名一致，避免界面自己再翻译一遍。
export const VC_DIAG_QUERY_ROWS: any[] = [
  { cap: '13.4', kind: 'ls-files', fields: ['paths'] },
  { cap: '13.5', kind: 'cat-file', fields: ['object', 'mode'] },
  { cap: '13.6', kind: 'ls-tree', fields: ['rev'] },
  { cap: '13.7', kind: 'rev-parse', fields: ['rev'] },
  { cap: '13.8', kind: 'for-each-ref', fields: ['prefix'] },
  { cap: '13.9', kind: 'is-ancestor', fields: ['ancestor', 'descendant'] },
  { cap: '13.10', kind: 'cherry', fields: ['upstream', 'head'] },
  { cap: '13.11', kind: 'rev-list', fields: ['mode', 'left', 'right'] },
]

// 13.1 二分的五颗按钮：开始与重置会改仓库状态（要确认卡），标坏 / 标好 / 跳过只改二分记录（一步一下）。
export const VC_DIAG_BISECT_ACTIONS: any[] = [
  { key: 'start', op: 'bisect-start', needs: ['bad', 'good'] },
  { key: 'bad', op: 'bisect-bad' },
  { key: 'good', op: 'bisect-good' },
  { key: 'skip', op: 'bisect-skip' },
  { key: 'reset', op: 'bisect-reset' },
]

export const VC_DIAG_POINTERS: any[] = [
  { cap: '13.3', page: 'search' },
  { cap: '13.14', page: 'commits' },
]

export const VC_DIAG_BISECT_CAP = '13.2'
export const VC_DIAG_PATCH_CAP = '13.12'
export const VC_DIAG_TRAILER_CAP = '13.13'
export const VC_DIAG_REPLACE_CAP = '5.12'

const DANGEROUS_OPS: string[] = ['bisect-start', 'bisect-reset', 'replace-create', 'replace-delete']

export function vcDiagnosticsStateNew(): any {
  return { running: '', confirm: null, reads: {}, results: {}, inputs: {} }
}

// 输入值统一按字符串存：界面不猜类型，校验交给共享层的诊断参数规划函数。
export function vcDiagnosticsInputOf(inputs: any, cap: string, key: string): string {
  const holder = inputs && inputs[cap]
  const value = holder ? holder[key] : ''
  return value === undefined || value === null ? '' : String(value)
}

// 不属于「一行可填空格子」的只读查询：13.2 的二分状态与 5.12 的替换清单都是整页刷新式读数。
const FIXED_READS: any = {
  '13.2': { kind: 'bisect-status', params: {} },
  '5.12': { kind: 'replace-list', params: {} },
}

export function vcDiagnosticsReadPayloadOf(cap: string, inputs: any): any {
  if (FIXED_READS[String(cap)]) return { phone: 'read', args: { kind: FIXED_READS[String(cap)].kind, params: {} } }
  const rows = VC_DIAG_QUERY_ROWS.filter(function (row: any) { return row.cap === String(cap) })
  if (rows.length === 0) return null
  const row = rows[0]
  const params: any = {}
  for (let i = 0; i < row.fields.length; i += 1) {
    const key: string = row.fields[i]
    const raw: string = vcDiagnosticsInputOf(inputs, cap, key)
    // 路径表按逗号、空白或换行分开；空表表示不带路径过滤（git 自己会列全部）。
    if (key === 'paths') {
      params.paths = raw.split(/[\s,]+/).filter(function (s: string) { return s !== '' })
    } else {
      params[key] = raw
    }
  }
  return { phone: 'read', args: { kind: row.kind, params: params } }
}

export function vcDiagnosticsPatchPayloadOf(inputs: any): any {
  const patch: string = vcDiagnosticsInputOf(inputs, VC_DIAG_PATCH_CAP, 'patch')
  return { phone: 'read', args: { kind: 'apply-check', params: { patch: patch } } }
}

export function vcDiagnosticsTrailerPayloadOf(inputs: any): any {
  const object: string = vcDiagnosticsInputOf(inputs, VC_DIAG_TRAILER_CAP, 'object')
  return { phone: 'read', args: { kind: 'trailers', params: { object: object === '' ? 'HEAD' : object } } }
}

export function vcDiagnosticsReplaceListPayloadOf(): any {
  return { phone: 'read', args: { kind: 'replace-list', params: {} } }
}

// 13.1 与 5.12 的写动作：只带这个动作真正要的字段，服务端规划函数会再校验一遍。
export function vcDiagnosticsWritePayloadOf(op: string, values: any): any {
  const v = values || {}
  const args: any = { op: String(op) }
  if (args.op === 'bisect-start') {
    args.bad = String(v.bad === undefined ? '' : v.bad)
    args.good = String(v.good === undefined ? '' : v.good)
  } else if (args.op === 'replace-create') {
    args.from = String(v.from === undefined ? '' : v.from)
    args.to = String(v.to === undefined ? '' : v.to)
  } else if (args.op === 'replace-delete') {
    args.object = String(v.object === undefined ? '' : v.object)
  }
  return { phone: 'check', args: args }
}

export function vcDiagnosticsDangerousOf(op: string): boolean {
  return DANGEROUS_OPS.indexOf(String(op)) >= 0
}

// 拼电话参数只此一处：界面与动作层都不许自己往 call 里塞别的键。
export function vcDiagnosticsCallOf(call: any, cwd: any, payload: any): any {
  const p = payload || {}
  const name: string = (VC_DIAG_PHONES as any)[p.phone] || p.phone
  return call(name, Object.assign({ cwd: cwd }, p.args || {}))
}

// 失败分类到词条键：宿主给的 kind / reason 都落进固定一族，不在界面现编说明。
export function vcDiagnosticsFailKeyOf(kind: any, reason: any): string {
  const k: string = String(kind || '')
  const r: string = String(reason || '')
  const reasonKeys: any = {
    'not-a-commit': 'vc.diag.reason.notACommit',
    'already-bisecting': 'vc.diag.reason.alreadyBisecting',
    'not-bisecting': 'vc.diag.reason.notBisecting',
    'same-object': 'vc.diag.reason.sameObject',
    'already-replaced': 'vc.diag.reason.alreadyReplaced',
    'no-replace': 'vc.diag.reason.noReplace',
    'bad-target': 'vc.diag.reason.badTarget',
    'need-confirm': 'vc.diag.reason.needConfirm',
  }
  if (reasonKeys[r]) return reasonKeys[r]
  const kindKeys: any = {
    args: 'vc.diag.fail.args',
    blocked: 'vc.diag.fail.blocked',
    timeout: 'vc.diag.fail.timeout',
    truncated: 'vc.diag.fail.truncated',
    exit: 'vc.diag.fail.exit',
    'git-failed': 'vc.diag.fail.git',
    env: 'vc.diag.fail.env',
    parse: 'vc.diag.fail.parse',
  }
  return kindKeys[k] || 'vc.diag.fail.unknown'
}

export function vcDiagnosticsShortOidOf(oid: any): string {
  const s: string = String(oid === undefined || oid === null ? '' : oid)
  return s.length > 8 ? s.slice(0, 8) : s
}

// 宿主回包统一成页面结果：成功留命令与对象数，失败留 git 原话、环节与原因词条。
export function vcDiagnosticsResultOf(cap: string, phone: string, reply: any): any {
  const r = reply || {}
  const error = r.error || null
  const base: any = { cap: cap, phone: phone, atMs: r.atMs || null, ok: error === null }
  if (error) {
    base.failKey = vcDiagnosticsFailKeyOf(error.kind, r.reason)
    base.message = String(error.message || '')
    base.git = String(r.git || '')
    base.step = String(r.step || '')
    base.expected = String(r.expected || '')
    base.actual = String(r.actual || '')
    base.cause = String(r.cause || '')
  } else {
    base.command = String(r.command || '')
    base.kind = String(r.kind || '')
    base.op = String(r.op || '')
    base.rows = vcDiagnosticsRowsOf(String(r.kind || r.op || cap), r)
  }
  return base
}

// 只读回包的各种形状摊平成一行行文字：路径、行号与原文都原样保留，方便直接读。
export function vcDiagnosticsRowsOf(kind: string, payload: any): string[] {
  const p = payload || {}
  const out: string[] = []
  if (kind === 'grep') {
    const matches: any[] = Array.isArray(p.matches) ? p.matches : []
    for (let i = 0; i < matches.length; i += 1) out.push(String(matches[i].path) + ':' + String(matches[i].line) + ': ' + String(matches[i].text))
  } else if (kind === 'ls-files') {
    const paths: any[] = Array.isArray(p.paths) ? p.paths : []
    for (let i = 0; i < paths.length; i += 1) out.push(String(paths[i]))
  } else if (kind === 'cat-file') {
    if (p.objectType) out.push(String(p.objectType))
    if (p.text !== undefined && p.text !== null) out.push(String(p.text))
  } else if (kind === 'ls-tree') {
    const rows: any[] = Array.isArray(p.rows) ? p.rows : []
    for (let i = 0; i < rows.length; i += 1) out.push(String(rows[i].mode) + ' ' + String(rows[i].type) + ' ' + vcDiagnosticsShortOidOf(rows[i].oid) + ' ' + String(rows[i].path))
  } else if (kind === 'rev-parse') {
    out.push(p.missing === true ? '' : String(p.oid || ''))
  } else if (kind === 'for-each-ref') {
    const rows: any[] = Array.isArray(p.rows) ? p.rows : []
    for (let i = 0; i < rows.length; i += 1) out.push(String(rows[i].ref) + ' ' + vcDiagnosticsShortOidOf(rows[i].oid) + ' ' + String(rows[i].subject || ''))
  } else if (kind === 'is-ancestor') {
    out.push(String(p.isAncestor === true))
  } else if (kind === 'cherry') {
    const rows: any[] = Array.isArray(p.rows) ? p.rows : []
    for (let i = 0; i < rows.length; i += 1) out.push(String(rows[i].marker) + ' ' + vcDiagnosticsShortOidOf(rows[i].oid) + ' ' + String(rows[i].subject || ''))
  } else if (kind === 'rev-list') {
    if (p.count !== undefined) out.push(String(p.count))
    else out.push(String(p.left) + ' / ' + String(p.right))
  } else if (kind === 'trailers') {
    const trailers: any[] = Array.isArray(p.trailers) ? p.trailers : []
    for (let i = 0; i < trailers.length; i += 1) out.push(String(trailers[i].token) + ': ' + String(trailers[i].value))
  } else if (kind === 'replace-list') {
    const replaces: any[] = Array.isArray(p.replaces) ? p.replaces : []
    for (let i = 0; i < replaces.length; i += 1) out.push(String(replaces[i]))
  } else if (kind === 'bisect-status') {
    if (p.active === true) {
      const bad: any[] = Array.isArray(p.bad) ? p.bad : []
      const good: any[] = Array.isArray(p.good) ? p.good : []
      out.push('bad: ' + bad.map(vcDiagnosticsShortOidOf).join(' '))
      out.push('good: ' + good.map(vcDiagnosticsShortOidOf).join(' '))
      if (p.firstBad) out.push('first-bad: ' + vcDiagnosticsShortOidOf(p.firstBad))
    } else out.push('0')
  } else if (kind === 'apply-check') {
    out.push(p.clean === true ? 'clean' : 'blocked')
    if (p.gitSays) out.push(String(p.gitSays))
  }
  return out
}

// 只读回包落状态：这条能力自己的结果格换成新读数，跑动标记清掉。
export function vcDiagnosticsApplyReadReply(state: any, cap: string, reply: any): any {
  const next = Object.assign({}, state)
  next.running = ''
  const reads = Object.assign({}, state.reads || {})
  const results = Object.assign({}, state.results || {})
  const result = vcDiagnosticsResultOf(cap, 'read', reply)
  results[cap] = result
  if (result.ok) reads[cap] = { kind: reply.kind, atMs: reply.atMs || null, rows: result.rows }
  next.reads = reads
  next.results = results
  return next
}

// 凭票执行回包落状态：确认卡收起，结果回到触发动作的那一块。
export function vcDiagnosticsApplyWriteReply(state: any, cap: string, reply: any): any {
  const next = Object.assign({}, state)
  next.running = ''
  next.confirm = null
  const results = Object.assign({}, state.results || {})
  results[cap] = vcDiagnosticsResultOf(cap, 'write', reply)
  next.results = results
  return next
}

// 动作层：只负责把一次点击变成「读 / 预检 / 凭票执行」三步，不判断业务规则（规则在共享层与宿主）。
export function vcDiagnosticsActionsOf(deps: any): any {
  const d = deps || {}
  let seq = 0
  // 动作层自己留一份最近状态：一次点击里可能连投两次（预检 → 凭票执行），
  // 只靠外面传进来的 ui 会在第二次读回旧值（外面还没重新渲染），确认卡就会错过。
  let localUi: any = d.ui || {}
  const uiOf = function () { return localUi.diagnostics || vcDiagnosticsStateNew() }
  const set = function (next: any) {
    localUi = Object.assign({}, localUi, { diagnostics: next })
    d.setUi(function () { return localUi })
  }
  const state = function () { return uiOf() }
  const run = function (payload: any): Promise<any> {
    return Promise.resolve(vcDiagnosticsCallOf(d.callHost, d.cwd, payload))
  }
  const requestId = function (): string {
    seq += 1
    return 'd' + String(Number(d.nowMs ? d.nowMs() : 0)).slice(-6) + '-' + String(seq)
  }
  const setInput = function (cap: string, key: string, value: any): void {
    const cur = state()
    const holder = Object.assign({}, (cur.inputs || {})[cap] || {})
    holder[key] = String(value === undefined || value === null ? '' : value)
    const inputs = Object.assign({}, cur.inputs || {})
    inputs[cap] = holder
    set(Object.assign({}, cur, { inputs: inputs }))
  }
  const read = function (cap: string, payload: any): Promise<any> {
    const cur = state()
    if (cur.running) return Promise.resolve(cur)
    set(Object.assign({}, cur, { running: String(cap) }))
    return run(payload || vcDiagnosticsReadPayloadOf(cap, cur.inputs)).then(function (reply: any) {
      const next = vcDiagnosticsApplyReadReply(state(), cap, reply)
      set(next)
      return next
    })
  }
  const write = function (cap: string, op: string, ticketId: any, plan: any): Promise<any> {
    const cur = state()
    const args: any = { ticketId: String(ticketId), requestId: requestId(), op: String(op), confirmed: true }
    return run({ phone: 'write', args: args }).then(function (reply: any) {
      const next = vcDiagnosticsApplyWriteReply(state(), cap, reply)
      set(next)
      return next
    })
  }
  const submit = function (cap: string, op: string, values: any): Promise<any> {
    const cur = state()
    if (cur.running) return Promise.resolve(cur)
    set(Object.assign({}, cur, { running: String(op) }))
    const payload = vcDiagnosticsWritePayloadOf(op, values)
    return run(payload).then(function (reply: any) {
      const r = reply || {}
      if (r.ok !== true) {
        const next = vcDiagnosticsApplyWriteReply(state(), cap, r)
        set(next)
        return next
      }
      const confirm = r.confirm || null
      if (r.confirmRequired === true && confirm) {
        const next = Object.assign({}, state(), { running: '', confirm: { cap: String(cap), op: String(op), ticketId: String((r.ticket || {}).id || ''), verb: String(confirm.verb || ''), target: String(confirm.target || '') } })
        set(next)
        return next
      }
      return write(cap, op, (r.ticket || {}).id, null)
    })
  }
  const confirmNow = function (): Promise<any> {
    const cur = state()
    const c = cur.confirm
    if (!c || cur.running) return Promise.resolve(cur)
    set(Object.assign({}, cur, { running: String(c.op) }))
    return write(String(c.cap), String(c.op), c.ticketId, null)
  }
  const cancelConfirm = function (): void {
    const cur = state()
    set(Object.assign({}, cur, { confirm: null }))
  }
  const clearResult = function (cap: string): void {
    const cur = state()
    const results = Object.assign({}, cur.results || {})
    delete results[String(cap)]
    set(Object.assign({}, cur, { results: results }))
  }
  return {
    state: state, setInput: setInput, read: read, submit: submit, confirmNow: confirmNow,
    cancelConfirm: cancelConfirm, clearResult: clearResult,
  }
}

export const VC_DIAGNOSTICS_SOURCE = 'src/client/views/versionControl/vcDiagnostics.ts'
