// views/versionControl/vcQueryView.ts —— 历史高级查询面板的画法（#1745 T10）
// 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回 src/client/index.ts
//   的 leaf 标记处（源码树里只有这一份真源）。本文件只画：目录、输入、执行与结果都从 vcQuery.ts 的读数来。
//
// 落点（票面写死的两条）：
//   · 能力 3.5 / 3.9 / 3.11 / 3.13 的主入口在「管理 › 诊断」页：那一页这四组额外标「主入口」并高亮，
//     页面正文另有一段说明本页是这四条的主入口；
//   · 其余六条（3.4 / 3.6 / 3.7 / 3.8 / 3.10 / 3.12）落在提交历史页。
//   页面归属不在这里写名单：由 vcQueryEntriesOf(page) 按能力账本的 page 字段筛出来。
//
// 诚实规则（规格第 4 节）：四态各自画自己的样子；空结果按宿主的 reason 说明白；截断显式标出条数，
//   读不全（宿主回 truncated 失败）就显示失败并给重试 —— 任何一档都不拿半份数据冒充成功。
// 四档宽（规格第 9 节）：300 只留标题与结论，380 补短提交号，460 起补作者与时间；入口一个都不删。
//
// 下面这些名字在构建拼好的闭包里由同一份源码提供，这里只声明形状（转译后整块消失）。

declare const host: any
declare function vcQueryEntriesOf(...args: any[]): any
declare function vcQueryEntryOf(...args: any[]): any
declare function vcQueryInputsOf(...args: any[]): any
declare function vcQueryInputValueOf(...args: any[]): any
declare function vcNewQueries(...args: any[]): any
declare function vcMarkQueryLoading(...args: any[]): any
declare function vcReadHistoryQuery(...args: any[]): any
declare function vcApplyQueryReply(...args: any[]): any
declare function vcQueryStateOf(...args: any[]): any
declare function vcQueryEmptyOf(...args: any[]): any
declare function vcQueryTruncatedOf(...args: any[]): any
declare function vcQueryShownOf(...args: any[]): any
declare function vcShortOid(...args: any[]): any
declare function vcWhenText(...args: any[]): any
declare function vcOneLine(...args: any[]): any

// range-diff 的四种对齐记号：只出现在旧组、只出现在新组、两边同形、两边不同。
const VC_QUERY_MARK_KEY: Record<string, string> = {
  '<': 'vc.query.range.onlyOld',
  '>': 'vc.query.range.onlyNew',
  '=': 'vc.query.range.same',
  '!': 'vc.query.range.diff',
}

const vcQueryWidthOf = function (width: any) { const n = Number(width); return !isFinite(n) || n <= 0 ? 460 : Math.round(n) }

/** 字段标签：按 labelKey 从词表取，取不到就印键名（与页面壳同一口径，绝不自己编一句中文）。 */
const vcQueryLabelOf = function (t: any, field: any) { return t(String((field && field.labelKey) || '')) }

/** 一个输入框。静态渲染用 defaultValue（不受控、不会因为缺 onChange 报警告）；
 *  面板组件里传了 onInput 才切成受控 —— 两种用法共用同一份节点，样式与可访问名不会漂。 */
const vcQueryFieldNode = function (h: any, t: any, o: any) {
  const field = o.field
  const kind = o.kind
  const id = 'vcq-' + String(kind) + '-' + String(field.name)
  const value = String(o.value === undefined || o.value === null ? '' : o.value)
  const label = h('label', { key: 'l', className: 'vcs-query-label', htmlFor: id }, vcQueryLabelOf(t, field))
  const own: any = { id: id, className: 'vcs-query-input', 'data-vc-query-input': String(field.name), 'data-vc-query-field-for': String(kind) }
  if (typeof o.onInput === 'function') {
    own.value = value
    own.onChange = function (ev: any) { o.onInput(String(kind), String(field.name), String((ev && ev.target && ev.target.value) || '')) }
  } else {
    own.defaultValue = value
  }
  let control: any
  if (field.type === 'select') {
    const opts = (field.options || []).map(function (op: any) {
      return h('option', { key: String(op.value), value: String(op.value) }, t(String(op.labelKey)))
    })
    control = h('select', own, opts)
  } else {
    own.type = field.type === 'number' ? 'number' : 'text'
    if (field.type === 'number') own.inputMode = 'numeric'
    control = h('input', own)
  }
  return h('div', { key: String(field.name), className: 'vcs-query-field' }, [label, control])
}

/** 结果清单的外框：列表标题与条数是可见读数（读不到条数就不画清单，绝不画空标题）。 */
const vcQueryListNode = function (h: any, o: any) {
  return h('ul', { key: o.listKey, className: 'vcs-query-list', 'data-vc-query-list': o.listKey, role: 'list', 'aria-label': o.label }, o.items)
}

const vcQueryValuesNode = function (h: any, o: any) {
  // 列表标题：条数来自回包（不是猜的），词条负责说清「这是什么清单」。
  const label = o.listLabelKey ? o.t(o.listLabelKey, { n: String(o.n) }) : ''
  const items = (o.items || []).map(function (node: any, i: number) { return h('li', { key: String(i), className: 'vcs-query-item', 'data-vc-query-item': String(i) }, node) })
  return vcQueryListNode(h, { listKey: o.listKey, label: label, items: items })
}

/** 结果区：按 kind 选一种画法。commits / blame / compare / range-diff / reflog 是清单，
 *  describe / notes / show-file 各只有一条读数（原样文本）。 */
const vcQueryResultNode = function (h: any, t: any, o: any) {
  const kind = String(o.entry.kind)
  const reply = o.reply || {}
  const width = o.width
  const readAt = o.nowMs
  const commitItem = function (c: any) {
    const kids = [h('span', { key: 's', className: 'vcs-query-subject' }, vcOneLine(c.subject, width >= 460 ? 120 : 80))]
    if (width >= 380) kids.unshift(h('span', { key: 'o', className: 'vcs-query-oid' }, vcShortOid(c.oid)))
    if (width >= 460) kids.push(h('span', { key: 'a', className: 'vcs-query-author', 'data-vc-query-author': '1' }, String(c.author || '') + ' · ' + vcWhenText(t, readAt, c.commitDateMs)))
    return kids
  }
  if (kind === 'file-history' || kind === 'grep' || kind === 'pickaxe') {
    return vcQueryValuesNode(h, { t: t, listKey: 'commits', listLabelKey: 'vc.query.list.commits', n: vcQueryShownOf(kind, reply), items: (reply.commits || []).map(commitItem) })
  }
  if (kind === 'blame') {
    const items = (reply.lines || []).map(function (l: any) {
      const kids = [
        h('span', { key: 'n', className: 'vcs-query-line', 'data-vc-query-blame-line': String(l.line) }, t('vc.query.blame.line', { n: String(l.line) })),
        h('span', { key: 'f', className: 'vcs-query-from' }, t('vc.query.blame.from', { short: vcShortOid(l.oid), author: String(l.author || '') })),
        h('code', { key: 't', className: 'vcs-query-text' }, String(l.text || '')),
      ]
      return kids
    })
    return vcQueryValuesNode(h, { t: t, listKey: 'blame', listLabelKey: 'vc.query.list.blame', n: vcQueryShownOf(kind, reply), items: items })
  }
  if (kind === 'compare') {
    const items = (reply.files || []).map(function (f: any) {
      const counts = f.added === null || f.deleted === null ? '—' : '+' + String(f.added) + ' −' + String(f.deleted)
      return [
        h('span', { key: 'p', className: 'vcs-query-path', 'data-vc-query-file': String(f.path || '') }, String(f.path || '')),
        h('span', { key: 'c', className: 'vcs-query-counts' }, counts),
      ]
    })
    return vcQueryValuesNode(h, { t: t, listKey: 'files', listLabelKey: 'vc.query.list.files', n: vcQueryShownOf(kind, reply), items: items })
  }
  if (kind === 'range-diff') {
    const items = (reply.pairs || []).map(function (p: any) {
      const mark = VC_QUERY_MARK_KEY[String(p.mark)] ? t(VC_QUERY_MARK_KEY[String(p.mark)]) : String(p.mark)
      const left = p.leftNo === null ? '-' : String(p.leftNo)
      const right = p.rightNo === null ? '-' : String(p.rightNo)
      return [
        h('span', { key: 'm', className: 'vcs-query-mark', 'data-vc-query-mark': String(p.mark || '') }, mark),
        h('span', { key: 'n', className: 'vcs-query-pair' }, left + ' ⇄ ' + right),
        h('span', { key: 's', className: 'vcs-query-subject' }, vcOneLine(p.subject, 100)),
      ]
    })
    const extra = (reply.extraLines || []).length > 0
      ? [h('p', { key: 'x', className: 'vcs-query-extra', 'data-vc-query-range-extra': String((reply.extraLines || []).length) }, t('vc.query.result.rangeExtra', { n: String((reply.extraLines || []).length) }))]
      : []
    return extra.concat([vcQueryValuesNode(h, { t: t, listKey: 'range', listLabelKey: 'vc.query.list.range', n: vcQueryShownOf(kind, reply), items: items })])
  }
  if (kind === 'reflog') {
    const items = (reply.entries || []).map(function (e: any) {
      const kids = [
        h('span', { key: 's', className: 'vcs-query-selector', 'data-vc-query-reflog-entry': String(e.selector || '') }, String(e.selector || '')),
        h('span', { key: 'o', className: 'vcs-query-oid' }, vcShortOid(e.oid)),
        h('span', { key: 't', className: 'vcs-query-subject' }, vcOneLine(e.subject, width >= 460 ? 120 : 80)),
      ]
      if (width >= 460) kids.push(h('span', { key: 'a', className: 'vcs-query-author', 'data-vc-query-author': '1' }, String(e.actor || '')))
      return kids
    })
    return vcQueryValuesNode(h, { t: t, listKey: 'reflog', listLabelKey: 'vc.query.list.reflog', n: vcQueryShownOf(kind, reply), items: items })
  }
  if (kind === 'describe') {
    const dirty = reply.dirty === true
    return h('div', { key: 'd', className: 'vcs-query-describe', 'data-vc-query-describe': '1' }, [
      h('code', { key: 't', className: 'vcs-query-version' }, String(reply.text || '')),
      h('span', { key: 's', className: 'vcs-query-dirty', 'data-vc-query-dirty': dirty ? '1' : '0' }, dirty ? t('vc.query.result.dirty') : t('vc.query.result.clean')),
    ])
  }
  if (kind === 'notes') {
    return h('pre', { key: 'n', className: 'vcs-query-note', 'data-vc-query-note': '1' }, String(reply.note || ''))
  }
  if (kind === 'show-file') {
    if (reply.binary === true) return h('p', { key: 'b', className: 'vcs-query-binary', 'data-vc-query-binary': '1' }, t('vc.query.result.binary'))
    return h('pre', { key: 'c', className: 'vcs-query-content', 'data-vc-query-content': '1' }, String(reply.text || ''))
  }
  return null
}

/** 失败那句话：本地预检失败指到字段，宿主失败给 git 原话（截断失败另有一句「读不全就不给半份」）。 */
const vcQueryFailTextOf = function (t: any, entry: any, error: any) {
  const e = error || {}
  const field = function () {
    const fields = (entry && entry.fields) || []
    for (let i = 0; i < fields.length; i += 1) if (String(fields[i].name) === String(e.field || '')) return vcQueryLabelOf(t, fields[i])
    return String(e.field || '')
  }
  if (e.kind === 'no-cwd') return t('vc.query.invalid.noCwd')
  if (e.kind === 'invalid-input') {
    if (e.reason === 'required-missing') return t('vc.query.invalid.required', { field: field() })
    if (e.reason === 'not-number') return t('vc.query.invalid.number', { field: field() })
    if (e.reason === 'range-order') return t('vc.query.invalid.rangeOrder')
    if (e.reason === 'range-span') return t('vc.query.invalid.rangeSpan', { n: '500' })
    return t('vc.query.failed')
  }
  if (e.kind === 'truncated') return t('vc.query.truncatedFail')
  return t('vc.query.failedDetail', { msg: String(e.message || '') })
}

const vcQueryStateNode = function (h: any, t: any, o: any) {
  const kind = String(o.entry.kind)
  const st = o.state || {}
  const retry = o.onRun ? h('button', { key: 'r', type: 'button', className: 'vcs-query-retry', 'data-vc-query-retry': kind, 'data-press': 'button', 'data-log': 'vc.query.retry.' + kind, 'aria-label': t('vc.query.retry'), onClick: function () { o.onRun(kind) } }, t('vc.query.retry')) : null
  if (st.state === 'loading') return h('div', { className: 'vcs-query-state', 'data-vc-query-state': 'loading', 'data-vc-query-state-kind': kind }, h('p', { className: 'vcs-query-running', 'data-vc-query-running': '1' }, t('vc.query.running')))
  if (st.state === 'err') {
    const err = st.error || {}
    const kids = [
      h('p', { key: 'e', className: 'vcs-query-error', 'data-vc-query-error': String(err.reason || err.kind || '') }, t('vc.query.failed')),
      h('p', { key: 'd', className: 'vcs-query-error-detail' }, vcQueryFailTextOf(t, o.entry, err)),
    ]
    if (retry) kids.push(retry)
    return h('div', { className: 'vcs-query-state', 'data-vc-query-state': 'err', 'data-vc-query-state-kind': kind }, kids)
  }
  if (st.state !== 'ok' || !st.data) return h('div', { className: 'vcs-query-state', 'data-vc-query-state': 'idle', 'data-vc-query-state-kind': kind }, h('p', { className: 'vcs-query-idle' }, t('vc.query.idle')))
  const reply = st.data
  const kids: any[] = []
  const empty = vcQueryEmptyOf(kind, reply)
  if (empty) kids.push(h('p', { key: 'empty', className: 'vcs-query-empty', 'data-vc-query-empty': String(empty) }, t('vc.query.empty.' + String(empty))))
  else kids.push(h('div', { key: 'result', className: 'vcs-query-result' }, vcQueryResultNode(h, t, { entry: o.entry, reply: reply, width: o.width, nowMs: o.nowMs })))
  const cut = vcQueryTruncatedOf(reply)
  if (cut) {
    kids.push(h('p', { key: 'cut', className: 'vcs-query-truncated', 'data-vc-query-truncated': '1' }, t('vc.query.truncated', { shown: String(cut.shown), total: String(cut.total) })))
    kids.push(h('p', { key: 'cuthint', className: 'vcs-query-truncated-hint' }, t('vc.query.truncatedHint')))
  }
  if (retry) kids.push(retry)
  return h('div', { className: 'vcs-query-state', 'data-vc-query-state': 'ok', 'data-vc-query-state-kind': kind }, kids)
}

/** 一组查询：标题（名称、能力编号、命令原文、主入口标记）、上限说明、输入、执行按钮、结果。 */
const vcQueryEntryNode = function (h: any, t: any, o: any) {
  const entry = o.entry
  const kind = String(entry.kind)
  const state = o.state || {}
  const primary = entry.diagnostic === true
  const headKids: any[] = [
    h('h3', { key: 'n', className: 'vcs-query-name' }, String(entry.name || '')),
    h('span', { key: 'c', className: 'vcs-query-cap', 'data-vc-query-cap-id': String(entry.capId || '') }, String(entry.capId || '')),
    h('code', { key: 'cmd', className: 'vcs-query-cmd' }, String(entry.command || '')),
  ]
  if (primary) headKids.push(h('span', { key: 'p', className: 'vcs-query-primary', 'data-vc-query-primary-badge': '1' }, t('vc.query.primaryBadge')))
  const kids: any[] = [h('div', { key: 'head', className: 'vcs-query-head' }, headKids)]
  if (Number(entry.limit) > 0) kids.push(h('p', { key: 'limit', className: 'vcs-query-limit', 'data-vc-query-limit': String(entry.limit) }, t('vc.query.limit', { n: String(entry.limit) })))
  const fields = entry.fields || []
  if (fields.length > 0) {
    kids.push(h('div', { key: 'fields', className: 'vcs-query-fields' }, fields.map(function (f: any) {
      return vcQueryFieldNode(h, t, { field: f, kind: kind, value: vcQueryInputValueOf(o.inputs, kind, f.name), onInput: o.onInput })
    })))
  }
  kids.push(h('div', { key: 'actions', className: 'vcs-query-actions' }, h('button', {
    type: 'button', className: 'vcs-query-run', 'data-vc-query-run': kind, 'data-press': 'button', 'data-log': 'vc.query.run.' + kind,
    'aria-label': t('vc.query.run') + ' ' + String(entry.name || ''),
    onClick: o.onRun ? function () { o.onRun(kind) } : undefined,
  }, t('vc.query.run'))))
  kids.push(vcQueryStateNode(h, t, { entry: entry, state: state, width: o.width, nowMs: o.nowMs, onRun: o.onRun }))
  return h('section', {
    key: kind, className: 'vcs-query-entry',
    'data-vc-query': kind,
    'data-vc-query-cap': String(entry.capId || ''),
    'data-vc-query-page': String(entry.page || ''),
    'data-vc-query-primary': primary ? '1' : '0',
    'data-vc-query-state': String(state.state || 'idle'),
  }, kids)
}

/**
 * 某一页的历史高级查询面板：页面归属照能力账本筛（返回 null 表示这一页没有这十条里的任何一条）。
 * 诊断页多一段「本页是四条只读能力的主入口」的说明 —— 票面要求页面正文里写清落点。
 */
export const vcQueryPageNode = function (h: any, t: any, opts: any) {
  const o = opts || {}
  const page = String(o.page || '')
  const entries = vcQueryEntriesOf(page)
  if (entries.length === 0) return null
  const width = vcQueryWidthOf(o.width)
  const readAt = Number(o.nowMs) || Date.now()
  const inputs = o.inputs || vcQueryInputsOf()
  const queries = o.queries || vcNewQueries()
  const kids: any[] = [
    h('h2', { key: 'title', className: 'vcs-query-title' }, t('vc.query.title')),
    h('p', { key: 'note', className: 'vcs-query-note' }, t('vc.query.note')),
  ]
  if (page === 'diagnostics') kids.push(h('p', { key: 'diag', className: 'vcs-query-diagnostics', 'data-vc-query-diagnostics': '1' }, t('vc.query.diagnosticsNote')))
  entries.forEach(function (entry: any) {
    kids.push(vcQueryEntryNode(h, t, { entry: entry, inputs: inputs, state: vcQueryStateOf(queries, entry.kind), width: width, nowMs: readAt, onInput: o.onInput, onRun: o.onRun }))
  })
  return h('section', { className: 'vcs-query', id: 'vc-query-' + page, 'data-vc-query-panel': page, 'data-vc-query-panel-count': String(entries.length) }, kids)
}

/**
 * 面板组件：自己拿着「每组输入现在填了什么」与「每组查询现在是什么状态」，执行时走宿主那条只读电话。
 * 与页面壳的关系照 #1744 同一口径：页面壳只受控渲染纯节点（vcQueryPageNode）；这个组件是后面接线时
 *   真正挂上去的那一个，本票先把取数与四态跑通并封成可测的叶子。
 */
export const VC_QUERY_PANEL = function (props: any) {
  const p = props || {}
  const t = typeof p.t === 'function' ? p.t : function (k: any) { return String(k) }
  const page = String(p.page || 'commits')
  const call = function (method: any, args: any) {
    if (typeof host === 'undefined' || !host || typeof host.call !== 'function') return Promise.resolve({ ok: false, error: { kind: 'shape', message: '' } })
    return host.call(method, args)
  }
  const seed = p.seed || null
  const [inputs, setInputs] = React.useState(function () { return Object.assign(vcQueryInputsOf(), (seed && seed.inputs) || {}) })
  const [queries, setQueries] = React.useState(function () { return (seed && seed.queries) || vcNewQueries() })
  const queriesRef = React.useRef(queries)
  queriesRef.current = queries
  const inputsRef = React.useRef(inputs)
  inputsRef.current = inputs
  const onInput = function (kind: any, field: any, value: any) {
    setInputs(function (cur: any) {
      const next: any = Object.assign({}, cur)
      const one: any = Object.assign({}, cur[String(kind)] || {})
      one[String(field)] = String(value)
      next[String(kind)] = one
      return next
    })
  }
  const onRun = function (kind: any) {
    const marked = vcMarkQueryLoading(queriesRef.current, kind)
    setQueries(marked)
    Promise.resolve(vcReadHistoryQuery({ queries: marked }, call, String(p.cwd || ''), kind, (inputsRef.current || {})[String(kind)] || {})).then(function (next: any) {
      setQueries(function (cur: any) { return vcApplyQueryReply({ queries: cur }, next, kind).queries })
    })
  }
  return vcQueryPageNode(React.createElement, t, {
    page: page, width: p.width, nowMs: p.nowMs,
    inputs: inputs, queries: queries, onInput: onInput, onRun: onRun,
  })
}
