/**
 * src/client/views/versionControl/vcConfigPage.ts —— 配置页（#1760 T24，规格 #1586 域 12 的 12.1–12.4、12.7、12.8）
 *
 * 这个文件只画：四组配置（身份两条可编辑，行尾与大小写、钩子路径、凭据三组只读）、
 * 改键与删键的输入行与确认卡、属性规则与邮件映射两处只读查询。数据怎么读、回包怎么落状态
 * 在 vcConfigOps.ts；哪些键可写、作用域怎么定在共享层 config-rules.ts。
 * 挂载点只有页面壳 vcShellPages.ts 里的一小段（#1760 注释包着），别处不碰。
 *
 * #1842 起按定稿原型（docs/prototype/vc-redesign 第 44 张）重做版式：页头交给页面壳的 vcPageHeadNode，
 * 正文分成「相关配置」与「只读读取」两段；相关配置的每组是一个折叠段，身份组默认展开，
 * 可编辑的输入行留在身份组里，只读三组只画读数。所有 data-vc-config-* 判据照旧保留：
 * 页面根、读数行、身份行、只读行、查询行、确认卡与结果条的位置变了，属性名与含义不变。
 */

// 跨叶子与共享层的名字由构建拼进同一个闭包，这里只声明形状（类型检查按单文件跑）。
// 来自共享层 config-rules.ts：
declare const CONFIG_GROUPS: any[]
// 来自同层叶子 vcConfigOps.ts（本票新增，登记在页面壳之前）：
declare function vcConfigStateNew(): any
declare function vcConfigReadStateOf(state: any): string
declare function vcConfigIdentityRowsOf(state: any): any[]
declare function vcConfigGroupsOf(state: any): any[]
declare function vcConfigGroupRowsOf(group: any): any[]
declare function vcConfigEditOf(state: any, patch: any): any
declare function vcConfigSetInputOf(state: any): any
declare function vcConfigUnsetInputOf(state: any, key: any): any
declare function vcConfigConfirmOf(check: any): any
declare function vcConfigConfirmTargetOf(confirm: any): string
declare function vcConfigFailKeyOf(kind: any): string
// 来自页面壳基础画法 vcShellPrimitives.ts：
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any
// 来自页面骨架原语 vcPageHead.ts（#1829 阶段 4）：
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageFoldNode(h: any, t: any, o: any): any
declare function vcPageFactGridNode(h: any, t: any, o: any): any

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_CONFIG_PAGE_SOURCE = 'src/client/views/versionControl/vcConfigPage.ts'

const vcConfigText = function (t: any, key: string, vars: any): string {
  if (typeof t !== 'function') return key
  return vars ? t(key, vars) : t(key)
}

/** 旧值印法：有值就印出来（界面显示旧值），没有就明说「未配置」，不画空白让人猜。 */
const vcConfigValueTextOf = function (t: any, value: any): string {
  if (value === undefined || value === null || String(value) === '') return vcConfigText(t, 'vc.config.identity.never', null)
  return String(value)
}

/** 作用域的人话：local / global 不直接印给用户，按词条换成「本仓库 / 这台机器」。 */
const vcConfigScopeTextOf = function (t: any, scope: any): string {
  return vcConfigText(t, 'vc.config.scope.' + String(scope || 'other'), null)
}

/** 事实格的小标题：git 配置键 + 这个值来自哪个作用域，两段都是人能读的。 */
const vcConfigFactKeyOf = function (t: any, key: string, scope: any): string {
  return key + ' · ' + vcConfigScopeTextOf(t, scope)
}

/** 身份一条：本地与全局两个旧值、一个值输入框、一个作用域选择，保存与删除两个按钮。 */
const vcConfigIdentityRowOf = function (h: any, t: any, row: any, ctx: any): any {
  const key = String(row.key || '')
  const editing = ctx.edit && String(ctx.edit.key || '') === key
  const scope = editing ? String(ctx.edit.scope || 'local') : 'local'
  const value = editing ? String(ctx.edit.value || '') : ''
  const oldLocal = vcConfigValueTextOf(t, row.local)
  const oldGlobal = vcConfigValueTextOf(t, row.global)
  const scopeNode = h('select', {
    key: 'scope',
    className: 'vcs-config-select',
    'data-vc-config-scope': key,
    value: scope,
    onChange: function (ev: any) { ctx.edit({ key: key, scope: String((ev && ev.target && ev.target.value) || 'local') }) },
  }, [
    h('option', { key: 'local', value: 'local' }, vcConfigText(t, 'vc.config.identity.scope.local', null)),
    h('option', { key: 'global', value: 'global' }, vcConfigText(t, 'vc.config.identity.scope.global', null)),
  ])
  return h('div', { key: key, className: 'vcs-config-id-row', 'data-vc-config-identity': key }, [
    h('div', { key: 'head', className: 'vcs-config-id-head' }, [
      h('span', { key: 'label', className: 'vcs-config-id-key' }, vcConfigText(t, row.labelKey, null) + ' (' + key + ')'),
      h('span', { key: 'old', className: 'vcs-config-old', 'data-vc-config-old': key }, vcConfigText(t, 'vc.config.identity.old', { local: oldLocal, global: oldGlobal })),
    ]),
    h('div', { key: 'controls', className: 'vcs-config-id-controls' }, [
      h('input', {
        key: 'value',
        type: 'text',
        className: 'vcs-config-input',
        'data-vc-config-value': key,
        value: value,
        placeholder: vcConfigText(t, 'vc.config.identity.placeholder', null),
        onInput: function (ev: any) { ctx.edit({ key: key, value: String((ev && ev.target && ev.target.value) || '') }) },
      }),
      scopeNode,
      h('button', {
        key: 'set',
        type: 'button',
        className: 'vcs-config-btn',
        'data-vc-config-op': 'config-set',
        'data-vc-config-cap': '12.2',
        'data-vc-config-key': key,
        disabled: ctx.pending === true,
        'data-press': 'button', 'data-log': 'vc.config.set', onClick: function () { ctx.actSet(key) },
      }, vcConfigText(t, 'vc.config.identity.set', null)),
      h('button', {
        key: 'unset',
        type: 'button',
        className: 'vcs-config-btn vcs-config-danger',
        'data-vc-config-op': 'config-unset',
        'data-vc-config-cap': '12.3',
        'data-vc-config-key': key,
        'data-vc-config-danger': '1',
        disabled: ctx.pending === true,
        'data-press': 'button', 'data-log': 'vc.config.unset', onClick: function () { ctx.actUnset(key) },
      }, vcConfigText(t, 'vc.config.identity.unset', null)),
    ]),
  ])
}

/** 身份组的读数格：本仓库两格在前、这台机器两格在后，值就是旧值（没有就明说未配置）。 */
const vcConfigIdentityFactsOf = function (t: any, rows: any[]): any[] {
  const facts: any[] = []
  const scopes = ['local', 'global']
  scopes.forEach(function (scope: string) {
    rows.forEach(function (row: any) {
      const one = row || {}
      const raw = scope === 'local' ? one.local : one.global
      const value = vcConfigValueTextOf(t, raw)
      const empty = value === vcConfigText(t, 'vc.config.identity.never', null)
      facts.push({ key: vcConfigFactKeyOf(t, String(one.key || ''), scope), value: value, mono: true, tone: empty ? 'muted' : '' })
    })
  })
  return facts
}

/** 只读组的一条读数：键与作用域写在格子的 data-* 上，判据与读屏都按这两项找。 */
const vcConfigReadonlyFactOf = function (t: any, row: any): any {
  const one = row || {}
  const key = String(one.key || '')
  const value = vcConfigValueTextOf(t, one.value)
  return {
    key: vcConfigFactKeyOf(t, key, one.scope),
    value: value,
    mono: true,
    tone: value === vcConfigText(t, 'vc.config.identity.never', null) ? 'muted' : '',
    attrs: { 'data-vc-config-row': key, 'data-vc-config-row-scope': String(one.scope || '') },
  }
}

/** 只读组的正文：有行就逐行画格；一行都没有就明说「用默认值」。另给两组补一条固定说明格。 */
const vcConfigReadonlyBodyOf = function (h: any, t: any, group: any): any[] {
  const rows = vcConfigGroupRowsOf(group)
  if (rows.length === 0) {
    return [h('p', { key: 'empty', className: 'vcs-config-group-empty', 'data-vc-config-group-empty': '1' }, vcConfigText(t, 'vc.config.group.empty', null))]
  }
  const facts = rows.map(function (row: any) { return vcConfigReadonlyFactOf(t, row) })
  if (String(group.id || '') === 'hooksPath') {
    facts.push({ key: 'vc.config.fact.defaultHooksDir', value: 'vc.config.fact.defaultHooksDirValue', tone: 'muted' })
  }
  if (String(group.id || '') === 'credential') {
    facts.push({ key: 'vc.config.fact.panelCredentials', value: 'vc.config.fact.panelCredentialsValue', tone: 'warn' })
  }
  return [vcPageFactGridNode(h, t, { facts: facts })]
}

/** 一组配置：折叠段的标题与说明来自词条，可写组默认展开并给一个能力编号（12.4）。 */
const vcConfigGroupFoldOf = function (h: any, t: any, group: any, identityRows: any[], ctx: any): any {
  const id = String(group.id || '')
  const editable = group.editable === true
  const attrs: any = { 'data-vc-config-group': id, 'data-vc-config-editable': editable ? 'true' : 'false' }
  if (!editable) attrs['data-vc-config-readonly'] = '1'
  if (editable) attrs['data-vc-config-cap'] = '12.4'
  let children: any[]
  if (editable) {
    children = [
      vcPageFactGridNode(h, t, { facts: vcConfigIdentityFactsOf(t, identityRows) }),
      h('div', { key: 'rows', className: 'vcs-config-id-rows' }, identityRows.map(function (row: any) { return vcConfigIdentityRowOf(h, t, row, ctx) })),
    ]
  } else {
    children = vcConfigReadonlyBodyOf(h, t, group)
  }
  return vcPageFoldNode(h, t, {
    key: id,
    title: 'vc.config.group.' + id,
    note: 'vc.config.group.' + id + '.note',
    open: editable,
    attrs: attrs,
    children: children,
  })
}

/** 读数行：重新读取与当前读状态（读成功 / 还没读 / 读失败）。 */
const vcConfigReadRowOf = function (h: any, t: any, state: any, readState: string, ctx: any): any {
  return h('div', { key: 'read', className: 'vcs-config-read-row' }, [
    h('span', { key: 'label', className: 'vcs-config-read-label' }, vcConfigText(t, 'vc.config.read.label', null)),
    h('button', {
      key: 'refresh',
      type: 'button',
      className: 'vcs-config-btn',
      'data-vc-config-refresh': '1',
      disabled: ctx.pending === true,
      'data-press': 'button', 'data-log': 'vc.config.refresh', onClick: function () { ctx.actRead() },
    }, vcConfigText(t, 'vc.config.refresh', null)),
    readState === 'err'
      ? h('span', { key: 'err', className: 'vcs-config-read-err', 'data-vc-config-read': 'err' }, vcConfigText(t, 'vc.config.read.err', { kind: String(state.readError || '') }))
      : h('span', { key: 'state', className: 'vcs-config-read-state', 'data-vc-config-read': readState }, vcConfigText(t, readState === 'ok' ? 'vc.config.read.ok' : 'vc.config.read.idle', null)),
  ])
}

/** 只读查询一行：属性规则（12.7）与邮件映射（12.8）共用同一套输入 + 查询按钮 + 结果。 */
const vcConfigQueryRowOf = function (h: any, t: any, kind: string, ctx: any): any {
  const isAttr = kind === 'attr'
  const state = isAttr ? ctx.attr : ctx.mailmap
  const inputKey = isAttr ? 'data-vc-config-attr-input' : 'data-vc-config-mailmap-input'
  const goKey = isAttr ? 'data-vc-config-attr-go' : 'data-vc-config-mailmap-go'
  const resultKey = isAttr ? 'data-vc-config-attr-result' : 'data-vc-config-mailmap-result'
  const value = isAttr ? String((ctx.edit && ctx.edit.path) || '') : String((ctx.edit && ctx.edit.address) || '')
  const st = state && state.state ? String(state.state) : 'idle'
  let text = ''
  if (st === 'ok') {
    if (isAttr) {
      const entries = Array.isArray(state.entries) ? state.entries : []
      text = entries.map(function (one: any) { return String(one.attr || '') + '=' + String(one.value || '') }).join('；') || vcConfigText(t, 'vc.config.attr.none', null)
    } else {
      text = String(state.mapped || '')
    }
  } else if (st === 'err') {
    text = vcConfigText(t, isAttr ? 'vc.config.attr.err' : 'vc.config.mailmap.err', null)
  }
  const children: any[] = [
    h('span', { key: 'label', className: 'vcs-config-query-label' }, vcConfigText(t, isAttr ? 'vc.config.attr.label' : 'vc.config.mailmap.label', null)),
    h('input', {
      key: 'input',
      type: 'text',
      className: 'vcs-config-input',
      [inputKey]: '1',
      value: value,
      placeholder: vcConfigText(t, isAttr ? 'vc.config.attr.placeholder' : 'vc.config.mailmap.placeholder', null),
      onInput: function (ev: any) { ctx.edit(isAttr ? { path: String((ev && ev.target && ev.target.value) || '') } : { address: String((ev && ev.target && ev.target.value) || '') }) },
    }),
    h('button', {
      key: 'go',
      type: 'button',
      className: 'vcs-config-btn',
      [goKey]: '1',
      'data-vc-config-cap': isAttr ? '12.7' : '12.8',
      disabled: ctx.pending === true,
      'data-press': 'button', 'data-log': 'vc.config.query', onClick: function () { ctx.actQuery(kind) },
    }, vcConfigText(t, isAttr ? 'vc.config.attr.go' : 'vc.config.mailmap.go', null)),
    h('span', { key: 'result', className: 'vcs-config-query-result', [resultKey]: st }, text),
  ]
  return h('div', { key: kind, className: 'vcs-config-query', [isAttr ? 'data-vc-config-attr' : 'data-vc-config-mailmap']: '1' }, children)
}

/** 确认卡：删键要先确认（会动本仓库或这台机器的配置，删了要恢复得重配）。 */
const vcConfigConfirmBlockOf = function (h: any, t: any, state: any, ctx: any): any {
  const confirm = vcConfigConfirmOf(state.check)
  if (!confirm) return null
  const target = vcConfigConfirmTargetOf(confirm)
  const verb = confirm.kind === 'hook-run'
    ? vcConfigText(t, 'vc.config.confirm.verbHook', null)
    : vcConfigText(t, 'vc.config.confirm.verbUnset', null)
  return h('div', { key: 'confirm', className: 'vcs-config-confirm-wrap', 'data-vc-config-confirm': target }, [
    vcShellConfirmCardNode(h, t, { verb: verb, target: target }),
    h('div', { key: 'acts', className: 'vcs-config-confirm-acts' }, [
      h('button', { key: 'go', type: 'button', className: 'vcs-confirm-go vcs-config-btn', 'data-vc-config-confirm-go': '1', disabled: ctx.pending === true, 'data-press': 'button', 'data-log': 'vc.config.confirm-go', onClick: function () { ctx.actConfirmed() } }, vcConfigText(t, 'vc.config.confirm.go', { verb: verb })),
      h('button', { key: 'cancel', type: 'button', className: 'vcs-config-btn', 'data-vc-config-confirm-cancel': '1', 'data-press': 'button', 'data-log': 'vc.config.confirm-cancel', onClick: function () { ctx.edit({ cancelCheck: true }) } }, vcConfigText(t, 'vc.config.confirm.cancel', null)),
    ]),
  ])
}

/** 结果条：失败按原因码查人话，保留 git 原话与环节名，不印裸原因码。 */
const vcConfigResultBlockOf = function (h: any, t: any, state: any): any {
  const result = state && state.result
  if (!result) return null
  if (result.ok === true) {
    return h('div', { key: 'result', className: 'vcs-config-result', 'data-vc-config-result': 'ok', role: 'status' }, vcConfigText(t, 'vc.config.result.ok', null))
  }
  const key = vcConfigFailKeyOf(result.kind)
  const vars: any = { reason: result.reason || result.kind }
  if (result.message) vars.message = result.message
  if (result.needed) vars.needed = result.needed
  return h('div', { key: 'result', className: 'vcs-config-result vcs-config-result-fail', 'data-vc-config-result': 'fail', 'data-vc-config-fail-kind': String(result.kind || ''), role: 'alert' }, vcConfigText(t, key, vars))
}

/** 配置页根节点：页头由页面壳画，这里只画「相关配置」「只读读取」两段与确认卡、结果条。 */
export const vcConfigPageNode = function (h: any, t: any, opts: any): any {
  const o = opts || {}
  const state = o.state || vcConfigStateNew()
  const readState = vcConfigReadStateOf(state)
  const identityRows = vcConfigIdentityRowsOf(state)
  const groups = vcConfigGroupsOf(state)
  const pending = !!state.pending
  const act = function (input: any): void {
    if (typeof o.onConfig === 'function' && !pending) o.onConfig(input)
  }
  const edit = function (patch: any): void {
    if (typeof o.onConfigEdit === 'function') o.onConfigEdit(patch || {})
  }
  const current = state.edit || {}
  const pick = function (key: string): void {
    const scope = String(current.key || '') === key ? String(current.scope || 'local') : 'local'
    edit({ key: key, scope: scope, value: String(current.key || '') === key ? current.value : '' })
  }
  const ctx: any = {
    pending: pending,
    attr: state.attr,
    mailmap: state.mailmap,
    edit: function (patch: any): void { edit(patch) },
    actRead: function (): void { act({ op: 'read' }) },
    actSet: function (key: any): void {
      pick(String(key))
      const next = vcConfigEditOf(state, { key: String(key) })
      act(vcConfigSetInputOf(next))
    },
    actUnset: function (key: any): void {
      pick(String(key))
      act(vcConfigUnsetInputOf(state, key))
    },
    actQuery: function (kind: any): void {
      act(kind === 'attr' ? { op: 'read-attr', path: String(current.path || '') } : { op: 'read-mailmap', address: String(current.address || '') })
    },
    actConfirmed: function (): void {
      if (pending) return
      const check = state.check || {}
      act({ op: 'confirm-write', ticketId: String((check.ticket && check.ticket.id) || ''), checkOp: String(check.op || '') })
    },
  }
  // 「相关配置 8 条键」里的 8 是共享层账本里的键数，不在页面里抄第二份数字。
  const keyCount = CONFIG_GROUPS.reduce(function (sum: number, group: any): number {
    return sum + (group && Array.isArray(group.keys) ? group.keys.length : 0)
  }, 0)
  const children: any[] = []
  children.push(h('p', { key: 'meta', className: 'vcs-config-meta' }, [
    h('span', { key: 'path-label', className: 'vcs-config-meta-key' }, vcConfigText(t, 'vc.config.meta.path', null)),
    h('span', { key: 'path', className: 'vcs-config-meta-value', 'data-vc-config-path': '1' }, String(state.configPath || '')),
    h('span', { key: 'ver-label', className: 'vcs-config-meta-key' }, vcConfigText(t, 'vc.config.meta.version', null)),
    h('span', { key: 'version', className: 'vcs-config-meta-value', 'data-vc-config-git-version': '1' }, String(state.gitVersion || '')),
  ]))
  children.push(vcPageSectionNode(h, t, {
    title: 'vc.config.section.related',
    count: keyCount,
    note: 'vc.config.section.relatedNote',
    children: groups.map(function (group: any) { return vcConfigGroupFoldOf(h, t, group, identityRows, ctx) }),
  }))
  children.push(vcPageSectionNode(h, t, {
    title: 'vc.config.section.readonly',
    count: 3,
    note: 'vc.config.section.readonlyNote',
    children: [
      vcConfigReadRowOf(h, t, state, readState, ctx),
      vcConfigQueryRowOf(h, t, 'attr', ctx),
      vcConfigQueryRowOf(h, t, 'mailmap', ctx),
    ],
  }))
  const confirmNode = vcConfigConfirmBlockOf(h, t, state, ctx)
  if (confirmNode) children.push(confirmNode)
  const resultNode = vcConfigResultBlockOf(h, t, state)
  if (resultNode) children.push(resultNode)
  return h('section', {
    id: 'vc-config-page',
    className: 'vcs-config-page',
    'data-vc-config-page': '1',
    'data-vc-config-read': readState,
    'data-vc-config-version': String(state.gitVersion || ''),
    'data-vc-config-pending': pending ? '1' : '0',
  }, children)
}
