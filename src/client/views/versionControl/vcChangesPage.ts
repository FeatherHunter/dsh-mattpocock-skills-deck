// views/versionControl/vcChangesPage.ts —— 改动页 13 条动作的操作面板（#1742 T07）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
// 职责四条：
//   1. 把能力 1.1–1.13 逐条画成可点的一行（每行恰一个主入口，行内带输入框与触发按钮）；
//   2. 危险动作（丢弃、删除、删除未跟踪文件）先出确认卡，确认卡的四段与「能不能回来」都按动作算；
//   3. 结果与确认卡都画在触发它的那一行里面 —— 结果贴触发点，不另起一块结果区；
//   4. 失败话术与写页同源：reason/kind 交给 vcWriteErrFamilyOf 翻成 vc.writeErr.<族> 词条，界面不另写一份理由文案。
// 界面一个中文字面量都没有：可见文字全走 t(词条)，词条真源 config/copy/vcchanges.yaml；
//   h 与 t 从参数传入，本文件不读闭包全局，门禁可以直接求值后再断言。
// 操作名单为什么在这里有一份：客户端闭包不能运行时 import 共享层（改动页协议依赖 git 参数拼装）。
//   这份视图名单由 tests/verify-1586-changes-page.ts 与 src/shared/version-control/src/changes-protocol.ts
//   的 CHANGES_OPS 逐条对账：ops/capId/dangerous/reversible 任何一格不一致就判红，避免两处漂移。

declare function vcWriteErrFamilyOf(reason: any, kind: any): string

export const VC_CHANGES_PHONES: Record<string, string> = {
  check: 'wf.gitChangesCheck',
  write: 'wf.gitChangesWrite',
}

// 视图名单：ordering 按能力编号；needs 说明要哪些输入（none/path/two-paths/hunks）。
export const VC_CHANGES_OPS: any[] = [
  { op: 'status', capId: '1.1', write: false, dangerous: false, reversible: false, needs: 'none' },
  { op: 'stage-hunks', capId: '1.2', write: true, dangerous: false, reversible: true, needs: 'hunks' },
  { op: 'stage-file', capId: '1.3', write: true, dangerous: false, reversible: true, needs: 'path' },
  { op: 'stage-all', capId: '1.4', write: true, dangerous: false, reversible: true, needs: 'none' },
  { op: 'unstage', capId: '1.5', write: true, dangerous: false, reversible: true, needs: 'path' },
  { op: 'discard-file', capId: '1.6', write: true, dangerous: true, reversible: true, needs: 'path' },
  { op: 'discard-all', capId: '1.7', write: true, dangerous: true, reversible: true, needs: 'none' },
  { op: 'clean-untracked', capId: '1.8', write: true, dangerous: true, reversible: false, needs: 'path' },
  { op: 'rm-tracked', capId: '1.9', write: true, dangerous: true, reversible: true, needs: 'path' },
  { op: 'rm-cached', capId: '1.10', write: true, dangerous: false, reversible: true, needs: 'path' },
  { op: 'mv', capId: '1.11', write: true, dangerous: false, reversible: true, needs: 'two-paths' },
  { op: 'ignore', capId: '1.12', write: true, dangerous: false, reversible: true, needs: 'path' },
  { op: 'explain-ignored', capId: '1.13', write: false, dangerous: false, reversible: false, needs: 'path' },
]

const vcChangesCamelOf = function (op: any) {
  return String(op === undefined || op === null ? '' : op).replace(/-([a-z])/g, function (m: string, c: string) { return c.toUpperCase() })
}

export const vcChangesOpMetaOf = function (op: any) {
  const s: string = String(op === undefined || op === null ? '' : op)
  for (let i = 0; i < VC_CHANGES_OPS.length; i += 1) if (VC_CHANGES_OPS[i].op === s) return VC_CHANGES_OPS[i]
  return null
}

export const vcChangesOpLabelKeyOf = function (op: any) { return 'vc.changes.op.' + vcChangesCamelOf(op) }
export const vcChangesOpVerbKeyOf = function (op: any) { return 'vc.changes.op.verb.' + vcChangesCamelOf(op) }

// 请求号：重放靠它换回上一次结果，所以同一轮操作里不能撞；界面只拼形状，真值由宿主回包确认。
export const vcChangesRequestIdOf = function (nowMs: any, salt: any) {
  const ms: number = typeof nowMs === 'number' && isFinite(nowMs) ? Math.floor(nowMs) : Date.now()
  const tail: string = String(salt === undefined || salt === null ? '' : salt).replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  return 'c' + ms.toString(36) + (tail === '' ? '' : '-' + tail)
}

// 由当前输入值拼出这次动作的载荷：字段名与宿主的预检读取一致（path/to/hunkIndex），不拼命令。
export const vcChangesPayloadOf = function (op: any, values: any) {
  const meta: any = vcChangesOpMetaOf(op)
  const v: any = values || {}
  if (!meta) return {}
  if (meta.needs === 'hunks') return { path: String(v.path === undefined || v.path === null ? '' : v.path), hunkIndex: (typeof v.hunkIndex === 'number' && isFinite(v.hunkIndex)) ? Math.floor(v.hunkIndex) : 0 }
  if (meta.needs === 'path') return { path: String(v.path === undefined || v.path === null ? '' : v.path) }
  if (meta.needs === 'two-paths') return { path: String(v.from === undefined || v.from === null ? '' : v.from), to: String(v.to === undefined || v.to === null ? '' : v.to) }
  return {}
}

// 检查电话的参数（票据由宿主预检发；界面只给动作与载荷，不自己算判定）。
export const vcChangesCheckArgsOf = function (cwd: any, op: any, values: any) {
  const args: any = { cwd: String(cwd === undefined || cwd === null ? '' : cwd), op: String(op === undefined || op === null ? '' : op) }
  const payload: any = vcChangesPayloadOf(op, values)
  Object.keys(payload).forEach(function (k: string) { args[k] = payload[k] })
  return args
}

// 写电话的参数：票据 id、请求号、confirm 一定带上；载荷原样展开（宿主按 op 读同一个字段名）。
export const vcChangesWriteArgsOf = function (cwd: any, op: any, values: any, ticketId: any, requestId: any) {
  const args: any = vcChangesCheckArgsOf(cwd, op, values)
  args.ticketId = String(ticketId === undefined || ticketId === null ? '' : ticketId)
  args.requestId = String(requestId === undefined || requestId === null ? '' : requestId)
  args.confirm = true
  return args
}

// 确认卡「会动什么」那一段的读数：路径类给路径，两路径给「旧 → 新」，选块类走词条（界面不写中文字面量）。
// t 只在拼「第几块」这一句时用；不传 t 时给纯路径，调用方自己补那一句。
export const vcChangesTargetOf = function (op: any, values: any, t: any) {
  const payload: any = vcChangesPayloadOf(op, values)
  if (payload.to !== undefined) return String(payload.path || '') + ' → ' + String(payload.to || '')
  if (payload.hunkIndex !== undefined) return (typeof t === 'function') ? t('vc.changes.target.hunk', { path: String(payload.path || ''), n: String(payload.hunkIndex) }) : String(payload.path || '')
  if (payload.path !== undefined) return String(payload.path || '')
  return ''
}

// 输入控件：形状随动作需要变（路径 / 两路径 / 选块），每个控件都带 data-vc-changes-field 供门禁与读屏定位。
const vcChangesInputsOf = function (h: any, t: any, meta: any, values: any, handlers: any) {
  const v: any = values || {}
  const on: any = handlers || {}
  const out: any[] = []
  const changeOf = function (field: string) {
    return function (ev: any) { if (typeof on.onValue === 'function') on.onValue(field, ev && ev.target ? ev.target.value : '') }
  }
  const inputOf = function (field: string, key: string, labelKey: string, initial: any) {
    out.push(h('label', { key: 'lab-' + key, className: 'vcs-changes-label' }, t(labelKey)))
    out.push(h('input', { key: key, type: 'text', className: 'vcs-changes-input', 'data-vc-changes-field': field, value: String(initial === undefined || initial === null ? '' : initial), onChange: changeOf(field) }))
  }
  if (meta.needs === 'path') inputOf('path', 'path', 'vc.changes.field.path', v.path)
  if (meta.needs === 'two-paths') {
    inputOf('from', 'from', 'vc.changes.field.from', v.from)
    inputOf('to', 'to', 'vc.changes.field.to', v.to)
  }
  if (meta.needs === 'hunks') {
    out.push(h('label', { key: 'lab-hunk', className: 'vcs-changes-label' }, t('vc.changes.field.hunk')))
    const hunks: any[] = Array.isArray(v.hunks) ? v.hunks : []
    if (hunks.length === 0) {
      out.push(h('p', { key: 'no-hunk', className: 'vcs-changes-note', 'data-vc-changes-no-hunk': '1' }, t('vc.changes.hunks.none')))
    } else {
      out.push(h('select', { key: 'hunk', className: 'vcs-changes-select', 'data-vc-changes-field': 'hunkIndex', value: String(v.hunkIndex === undefined ? 0 : v.hunkIndex), onChange: function (ev: any) { if (typeof on.onValue === 'function') on.onValue('hunkIndex', Number(ev && ev.target ? ev.target.value : 0)) } }, hunks.map(function (hk: any) {
        return h('option', { key: String(hk.index), value: String(hk.index) }, t('vc.changes.hunks.pick', { n: String(hk.index), header: String(hk.header || '') }))
      })))
    }
  }
  return out
}

// 结果块：成功给命令/耗时/对象数，失败给同源话术加 git 原话；都挂在触发这一行里面。
const vcChangesResultNode = function (h: any, t: any, meta: any, result: any, handlers: any) {
  const r: any = result || {}
  const fail: boolean = r.ok === false
  const attrs: any = { key: 'result', className: 'vcs-changes-result vcs-changes-result-' + (fail ? 'fail' : 'ok'), 'data-vc-changes-result': String(meta.capId), 'data-vc-changes-result-ok': fail ? '0' : '1' }
  attrs.role = fail ? 'alert' : 'status'
  const kids: any[] = []
  if (fail) {
    kids.push(h('p', { key: 'title', className: 'vcs-changes-result-title' }, t('vc.changes.result.failTitle')))
    const err: any = r.error || {}
    const family: string = String(vcWriteErrFamilyOf(err.reason, err.kind) || 'unknown')
    kids.push(h('p', { key: 'text', className: 'vcs-changes-result-text' }, t('vc.changes.result.fail', { hint: t('vc.writeErr.' + family), git: String(err.message || '') })))
    kids.push(h('button', { key: 'retry', type: 'button', className: 'vcs-changes-retry', 'data-vc-changes-retry': '1', 'data-press': 'button', 'data-log': 'vc.changes.retry', onClick: function () { if (handlers && typeof handlers.begin === 'function') handlers.begin(meta.op, vcChangesPayloadOf(meta.op, r.values)) } }, t('vc.changes.result.retry')))
  } else {
    kids.push(h('p', { key: 'title', className: 'vcs-changes-result-title' }, t('vc.changes.result.okTitle')))
    kids.push(h('p', { key: 'text', className: 'vcs-changes-result-text' }, t('vc.changes.result.ok', { cmd: String(r.cmd || meta.op), ms: String(r.ms === undefined ? '' : r.ms), n: String(r.n === undefined ? 0 : r.n) })))
  }
  return h('div', attrs, kids)
}

// 确认卡：固定四段（会动什么、不会动什么、能不能回来、点了执行什么），默认焦点在取消上。
const vcChangesConfirmNode = function (h: any, t: any, meta: any, confirm: any, values: any, handlers: any) {
  const c: any = confirm || {}
  const target: string = vcChangesTargetOf(meta.op, values, t) || t('vc.changes.confirm.allChanges')
  const answer: string = meta.reversible ? t('vc.changes.confirm.reversibleYes') : t('vc.changes.confirm.reversibleNo')
  return h('div', { key: 'confirm', className: 'vcs-changes-confirm', 'data-vc-changes-confirm': String(meta.capId), role: 'dialog', 'aria-modal': 'false' }, [
    h('h4', { key: 'title', className: 'vcs-changes-confirm-title' }, t('vc.changes.confirm.title', { verb: t(vcChangesOpVerbKeyOf(meta.op)) })),
    h('p', { key: 'what', className: 'vcs-changes-confirm-seg', 'data-vc-changes-confirm-seg': 'what' }, t('vc.changes.confirm.what', { target: target })),
    h('p', { key: 'wont', className: 'vcs-changes-confirm-seg', 'data-vc-changes-confirm-seg': 'wont' }, t('vc.changes.confirm.wont')),
    h('p', { key: 'reversible', className: 'vcs-changes-confirm-seg', 'data-vc-changes-confirm-seg': 'reversible' }, t('vc.changes.confirm.reversible', { answer: answer })),
    h('p', { key: 'verb', className: 'vcs-changes-confirm-seg', 'data-vc-changes-confirm-seg': 'verb' }, t('vc.changes.confirm.verb', { verb: t(vcChangesOpVerbKeyOf(meta.op)) })),
    h('div', { key: 'acts', className: 'vcs-changes-confirm-acts' }, [
      h('button', { key: 'cancel', type: 'button', className: 'vcs-changes-confirm-cancel', 'data-vc-changes-confirm-cancel': '1', 'data-focus-default': 'cancel', 'data-press': 'button', 'data-log': 'vc.changes.confirm.cancel', onClick: function () { if (handlers && typeof handlers.cancel === 'function') handlers.cancel(meta.op) } }, t('vc.changes.confirm.cancel')),
      h('button', { key: 'go', type: 'button', className: 'vcs-changes-confirm-go', 'data-vc-changes-confirm-go': '1', 'data-press': 'button', 'data-log': 'vc.changes.confirm.go', onClick: function () { if (handlers && typeof handlers.run === 'function') handlers.run(meta.op, vcChangesPayloadOf(meta.op, values), { ticketId: String(c.ticketId || ''), requestId: String(c.requestId || '') }) } }, t('vc.changes.confirm.go')),
    ]),
  ])
}

// 只读动作的结果：一行文字，贴在那一行里；explain-ignored 命中时给判定链原文。
const vcChangesReadNode = function (h: any, t: any, meta: any, read: any) {
  const r: any = read || {}
  const text: string = r.ok === false ? String(r.message || '') : String(r.text || '')
  return h('div', { key: 'read', className: 'vcs-changes-read', 'data-vc-changes-read': String(meta.capId) }, [
    h('p', { key: 'text', className: 'vcs-changes-read-text' }, t('vc.changes.result.read', { text: text })),
  ])
}

// 一行：能力编号与名字、动作徽标、输入、主入口按钮，以及确认卡 / 结果 / 只读结果（都在这行里）。
export const vcChangesRowNode = function (h: any, t: any, meta: any, opts: any) {
  const o: any = opts || {}
  const values: any = o.values || {}
  const handlers: any = o.handlers || {}
  const state: any = (o.rows && o.rows[meta.op]) || {}
  const kids: any[] = [
    h('div', { key: 'head', className: 'vcs-changes-head' }, [
      h('span', { key: 'cap', className: 'vcs-changes-cap', 'data-vc-changes-cap': String(meta.capId) }, String(meta.capId) + ' ' + t(vcChangesOpLabelKeyOf(meta.op))),
      h('span', { key: 'badge', className: 'vcs-changes-badge', 'data-vc-changes-danger': meta.dangerous ? '1' : '0' }, meta.dangerous ? t('vc.changes.badge.danger') : (meta.write ? '' : t('vc.changes.badge.read'))),
      meta.reversible ? null : h('span', { key: 'irr', className: 'vcs-changes-badge vcs-changes-badge-hard', 'data-vc-changes-irreversible': '1' }, t('vc.changes.badge.irreversible')),
    ]),
  ]
  const inputs: any[] = vcChangesInputsOf(h, t, meta, values, handlers)
  if (inputs.length > 0) kids.push(h('div', { key: 'inputs', className: 'vcs-changes-inputs' }, inputs))
  const primaryAttrs: any = { key: 'primary', type: 'button', className: 'vcs-changes-go', 'data-vc-changes-primary': String(meta.capId), 'data-vc-changes-op': String(meta.op), disabled: state.busy === true, 'data-press': 'button', 'data-log': 'vc.changes.run' }
  primaryAttrs.onClick = function () {
    const payload: any = vcChangesPayloadOf(meta.op, values)
    if (meta.write !== true) { if (typeof handlers.read === 'function') handlers.read(meta.op, payload) }
    else if (typeof handlers.begin === 'function') handlers.begin(meta.op, payload)
  }
  kids.push(h('button', primaryAttrs, t(vcChangesOpLabelKeyOf(meta.op))))
  if (state.confirm) kids.push(vcChangesConfirmNode(h, t, meta, state.confirm, values, handlers))
  if (state.result) kids.push(vcChangesResultNode(h, t, meta, state.result, handlers))
  if (state.read) kids.push(vcChangesReadNode(h, t, meta, state.read))
  if (state.noteKey) kids.push(h('p', { key: 'note', className: 'vcs-changes-note', 'data-vc-changes-note': String(meta.capId) }, t(String(state.noteKey))))
  return h('li', { key: String(meta.capId), className: 'vcs-changes-row', 'data-vc-changes-row': String(meta.capId), 'data-vc-changes-row-op': String(meta.op) }, kids)
}

// 整页：一行动作清单 + 顶部读数；页面壳只在 changes 页把这块挂进页面体，别的页不出现。
export const vcChangesPageNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const changes: any = opts.changes || {}
  const counts: any = changes.counts || {}
  const kids: any[] = [
    h('h3', { key: 'title', className: 'vcs-changes-title' }, t('vc.changes.pageTitle')),
    h('p', { key: 'hint', className: 'vcs-changes-hint', 'data-vc-changes-hint': '1' }, t('vc.changes.hint')),
    h('p', { key: 'counts', className: 'vcs-changes-counts', 'data-vc-changes-counts': '1' }, t('vc.changes.counts', { staged: String(counts.staged || 0), unstaged: String(counts.unstaged || 0), untracked: String(counts.untracked || 0), conflicts: String(counts.conflicts || 0) })),
  ]
  const total: number = Number(counts.staged || 0) + Number(counts.unstaged || 0) + Number(counts.untracked || 0) + Number(counts.conflicts || 0)
  if (changes.state === 'error') kids.push(h('p', { key: 'err', className: 'vcs-changes-error', role: 'alert', 'data-vc-changes-error': '1' }, String(changes.errorText || t('vc.changes.result.failTitle'))))
  if (total === 0) kids.push(h('p', { key: 'empty', className: 'vcs-changes-empty', 'data-vc-changes-empty': '1' }, t('vc.changes.empty')))
  kids.push(h('ul', { key: 'rows', className: 'vcs-changes-rows' }, VC_CHANGES_OPS.map(function (meta: any) {
    return vcChangesRowNode(h, t, meta, { values: changes.values, rows: changes.rows, handlers: changes.handlers })
  })))
  return h('section', { id: 'vc-changes-page', className: 'vcs-changes', role: 'region', 'data-vc-changes-page': '1', 'data-vc-changes-count': String(VC_CHANGES_OPS.length) }, kids)
}
