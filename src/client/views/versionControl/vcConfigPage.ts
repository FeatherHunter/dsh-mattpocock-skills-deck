/**
 * src/client/views/versionControl/vcConfigPage.ts —— 配置页（#1760 T24，规格 #1586 域 12 的 12.1–12.4、12.7、12.8）
 *
 * 这个文件只画：四组配置（身份两条可编辑，行尾与大小写、钩子路径、凭据三组只读）、
 * 改键与删键的输入行与确认卡、属性规则与邮件映射两处只读查询。数据怎么读、回包怎么落状态
 * 在 vcConfigOps.ts；哪些键可写、作用域怎么定在共享层 config-rules.ts。
 * 挂载点只有页面壳 vcShellPages.ts 里的一小段（#1760 注释包着），别处不碰。
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
    'data-vc-config-scope': key,
    value: scope,
    onChange: function (ev: any) { ctx.edit({ key: key, scope: String((ev && ev.target && ev.target.value) || 'local') }) },
  }, [
    h('option', { key: 'local', value: 'local' }, vcConfigText(t, 'vc.config.identity.scope.local', null)),
    h('option', { key: 'global', value: 'global' }, vcConfigText(t, 'vc.config.identity.scope.global', null)),
  ])
  return h('li', { key: key, className: 'vcs-config-identity', 'data-vc-config-identity': key }, [
    h('span', { key: 'label', className: 'vcs-config-key' }, vcConfigText(t, row.labelKey, null) + ' (' + key + ')'),
    h('span', { key: 'old', className: 'vcs-config-old', 'data-vc-config-old': key }, vcConfigText(t, 'vc.config.identity.old', { local: oldLocal, global: oldGlobal })),
    h('input', {
      key: 'value',
      type: 'text',
      'data-vc-config-value': key,
      value: value,
      placeholder: vcConfigText(t, 'vc.config.identity.placeholder', null),
      onInput: function (ev: any) { ctx.edit({ key: key, value: String((ev && ev.target && ev.target.value) || '') }) },
    }),
    scopeNode,
    h('button', {
      key: 'set',
      type: 'button',
      'data-vc-config-op': 'config-set',
      'data-vc-config-cap': '12.2',
      'data-vc-config-key': key,
      disabled: ctx.pending === true,
      onClick: function () { ctx.actSet(key) },
    }, vcConfigText(t, 'vc.config.identity.set', null)),
    h('button', {
      key: 'unset',
      type: 'button',
      className: 'vcs-config-danger',
      'data-vc-config-op': 'config-unset',
      'data-vc-config-cap': '12.3',
      'data-vc-config-key': key,
      'data-vc-config-danger': '1',
      disabled: ctx.pending === true,
      onClick: function () { ctx.actUnset(key) },
    }, vcConfigText(t, 'vc.config.identity.unset', null)),
  ])
}

/** 一组只读配置：行按「键 = 值（来源作用域）」印；一组一条都没有时明说未配置。 */
const vcConfigGroupNodeOf = function (h: any, t: any, group: any): any {
  const rows = vcConfigGroupRowsOf(group)
  const items = rows.map(function (row: any) {
    const one = row || {}
    const key = String(one.key || '')
    return h('li', { key: key, 'data-vc-config-row': key }, [
      h('code', { key: 'key', className: 'vcs-config-row-key' }, key),
      h('span', { key: 'value', className: 'vcs-config-row-value' }, vcConfigValueTextOf(t, one.value)),
      h('span', { key: 'scope', className: 'vcs-config-row-scope', 'data-vc-config-row-scope': String(one.scope || '') }, vcConfigText(t, 'vc.config.scope.' + String(one.scope || 'other'), null)),
    ])
  })
  return h('section', { key: String(group.id || ''), className: 'vcs-config-group', 'data-vc-config-group': String(group.id || ''), 'data-vc-config-editable': group.editable === true ? 'true' : 'false' }, [
    h('h4', { key: 'title' }, vcConfigText(t, String(group.titleKey || ''), null)),
    h('span', { key: 'ro', className: 'vcs-config-ro', 'data-vc-config-readonly': '1' }, vcConfigText(t, 'vc.config.readonly', null)),
    items.length === 0
      ? h('p', { key: 'empty', 'data-vc-config-group-empty': '1' }, vcConfigText(t, 'vc.config.group.empty', null))
      : h('ul', { key: 'rows' }, items),
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
      text = entries.map(function (one: any) { return String(one.attr || '') + '=' + String(one.value || '') }).join('；') || vcConfigText(t, isAttr ? 'vc.config.attr.none' : 'vc.config.mailmap.none', null)
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
      [inputKey]: '1',
      value: value,
      placeholder: vcConfigText(t, isAttr ? 'vc.config.attr.placeholder' : 'vc.config.mailmap.placeholder', null),
      onInput: function (ev: any) { ctx.edit(isAttr ? { path: String((ev && ev.target && ev.target.value) || '') } : { address: String((ev && ev.target && ev.target.value) || '') }) },
    }),
    h('button', {
      key: 'go',
      type: 'button',
      [goKey]: '1',
      'data-vc-config-cap': isAttr ? '12.7' : '12.8',
      disabled: ctx.pending === true,
      onClick: function () { ctx.actQuery(kind) },
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
      h('button', { key: 'go', type: 'button', className: 'vcs-confirm-go', 'data-vc-config-confirm-go': '1', disabled: ctx.pending === true, onClick: function () { ctx.actConfirmed() } }, vcConfigText(t, 'vc.config.confirm.go', { verb: verb })),
      h('button', { key: 'cancel', type: 'button', 'data-vc-config-confirm-cancel': '1', onClick: function () { ctx.edit({ cancelCheck: true }) } }, vcConfigText(t, 'vc.config.confirm.cancel', null)),
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

/** 配置页根节点：四组配置、只读查询、确认卡与结果条都在这一块里。 */
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
  // 身份组：两条可编辑键单独画，按钮上带 12.2 / 12.3 的能力编号。
  const identityGroup = {
    id: 'identity', editable: true, titleKey: 'vc.config.group.identity',
    rows: [],
  }
  const readonly = groups.filter(function (group: any): boolean { return group.editable !== true })
  const children: any[] = []
  children.push(h('header', { key: 'meta', className: 'vcs-config-meta' }, [
    h('h3', { key: 'title' }, vcConfigText(t, 'vc.config.title', null)),
    h('span', { key: 'path', className: 'vcs-config-path', 'data-vc-config-path': '1' }, String(state.configPath || '')),
    h('span', { key: 'version', className: 'vcs-config-version', 'data-vc-config-git-version': '1' }, String(state.gitVersion || '')),
  ]))
  children.push(h('p', { key: 'lede' }, vcConfigText(t, 'vc.config.lede', null)))
  children.push(h('div', { key: 'readbar', className: 'vcs-config-readbar' }, [
    h('button', { key: 'refresh', type: 'button', 'data-vc-config-refresh': '1', disabled: pending, onClick: function () { act({ op: 'read' }) } }, vcConfigText(t, 'vc.config.refresh', null)),
    readState === 'err'
      ? h('span', { key: 'err', className: 'vcs-config-read-err', 'data-vc-config-read': 'err' }, vcConfigText(t, 'vc.config.read.err', { kind: String(state.readError || '') }))
      : h('span', { key: 'state', 'data-vc-config-read': readState }, vcConfigText(t, readState === 'ok' ? 'vc.config.read.ok' : 'vc.config.read.idle', null)),
  ]))
  children.push(h('section', { key: 'identity', className: 'vcs-config-group', 'data-vc-config-group': 'identity', 'data-vc-config-editable': 'true', 'data-vc-config-cap': '12.4' }, [
    h('h4', { key: 'title' }, vcConfigText(t, identityGroup.titleKey, null)),
    h('ul', { key: 'rows' }, identityRows.map(function (row: any) { return vcConfigIdentityRowOf(h, t, row, ctx) })),
  ]))
  readonly.forEach(function (group: any) { children.push(vcConfigGroupNodeOf(h, t, group)) })
  children.push(vcConfigQueryRowOf(h, t, 'attr', ctx))
  children.push(vcConfigQueryRowOf(h, t, 'mailmap', ctx))
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
