/**
 * src/client/views/versionControl/vcHooksPage.ts —— 钩子页（#1760 T24，规格 #1586 域 12 的 12.5、12.6）
 *
 * 这一页只做两件事：列出本仓库的钩子（已启用、示例、core.hooksPath 指到哪），
 * 以及手动跑一个钩子（git hook run，git 2.36 以上）。安装与停用不在这里做：
 * 它们要往 .git/hooks 写可执行文件、改可执行位，不是 git 命令，页面只给只读说明与命令。
 * 数据怎么读、回包怎么落状态在 vcConfigOps.ts（配置与钩子共用一套读数电话）。
 */

// 跨叶子与共享层的名字由构建拼进同一个闭包，这里只声明形状（类型检查按单文件跑）。
declare function vcConfigStateNew(): any
declare function vcHookRowsOf(state: any): any[]
declare function vcHooksDirOf(state: any): any
declare function vcHooksReadStateOf(state: any): string
declare function vcHookRunStateOf(state: any): any
declare function vcHookRunVisibleOf(state: any): boolean
declare function vcHookOutputOf(state: any): string
declare function vcConfigFailKeyOf(kind: any): string
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_HOOKS_PAGE_SOURCE = 'src/client/views/versionControl/vcHooksPage.ts'

const vcHooksText = function (t: any, key: string, vars?: any): string {
  if (typeof t !== 'function') return key
  return vars ? t(key, vars) : t(key)
}

/** 一条钩子：名字、是不是示例、能不能跑；能跑的画运行按钮，跑过就画结果。 */
const vcHookRowOf = function (h: any, t: any, row: any, ctx: any): any {
  const name = String((row && row.name) || '')
  const sample = !!(row && row.sample)
  const runnable = !!(row && row.runnable)
  const visible = ctx.runVisible === true
  const children: any[] = [
    h('strong', { key: 'name', className: 'vcs-hook-name' }, name),
    h('span', { key: 'tag', className: 'vcs-hook-tag', 'data-vc-hook-sample': sample ? '1' : '0' }, vcHooksText(t, sample ? 'vc.hooks.sample' : 'vc.hooks.executable', null)),
  ]
  if (!sample && row && row.executable === false) {
    children.push(h('span', { key: 'noexec', className: 'vcs-hook-warn', 'data-vc-hook-executable': '0' }, vcHooksText(t, 'vc.hooks.notExecutable', null)))
  }
  if (runnable && visible) {
    children.push(h('button', {
      key: 'run',
      type: 'button',
      'data-vc-hook-run': name,
      'data-vc-hooks-cap': '12.6',
      disabled: ctx.pending === true,
      onClick: function () { ctx.actRun(name) },
    }, vcHooksText(t, 'vc.hooks.run', null)))
  }
  return h('li', { key: name, className: 'vcs-hook-item', 'data-vc-hook': name }, children)
}

/** 版本门：2.36 以下没有 git hook run，明说需要哪个版本、替代做法是什么，不假装能跑。 */
const vcHooksGateBlockOf = function (h: any, t: any, state: any): any {
  const gate = vcHookRunStateOf(state) || {}
  if (String(gate.state || '') !== 'hidden') return null
  return h('p', { key: 'gate', className: 'vcs-hooks-gate', 'data-vc-hooks-gate': 'hidden', role: 'note' }, [
    h('span', { key: 'needed' }, vcHooksText(t, 'vc.hooks.gate.hidden', { needed: String(gate.needed || '') })),
    h('span', { key: 'alt', 'data-vc-hooks-gate-alternative': '1' }, vcHooksText(t, String(gate.alternativeKey || 'vc.hooks.gate.alternative'), null)),
  ])
}

/** 手动跑钩子的确认卡：钩子会动工作区与文件，跑之前把「会动什么」讲清，默认焦点在取消。 */
const vcHooksConfirmBlockOf = function (h: any, t: any, state: any, ctx: any): any {
  // 确认卡只在预检回包要求确认时出现：目标名从 check.confirm.target 取，与确认卡上的名字同一处来源。
  const check = (state && state.check) || null
  const confirm = check && check.confirmRequired === true ? (check.confirm || null) : null
  if (!confirm) return null
  const name = String(confirm.target || '')
  const verb = vcHooksText(t, 'vc.hooks.confirm.verb', null)
  return h('div', { key: 'confirm', className: 'vcs-hooks-confirm-wrap', 'data-vc-hooks-confirm': name }, [
    vcShellConfirmCardNode(h, t, { verb: verb, target: name }),
    h('div', { key: 'acts', className: 'vcs-hooks-confirm-acts' }, [
      h('button', { key: 'go', type: 'button', className: 'vcs-confirm-go', 'data-vc-hooks-confirm-go': '1', disabled: ctx.pending === true, onClick: function () { ctx.actConfirmed(name) } }, vcHooksText(t, 'vc.hooks.confirm.go', { verb: verb })),
      h('button', { key: 'cancel', type: 'button', 'data-vc-hooks-confirm-cancel': '1', onClick: function () { ctx.actCancel() } }, vcHooksText(t, 'vc.hooks.confirm.cancel', null)),
    ]),
  ])
}

/** 跑钩子的结果：退出码非 0 是钩子自己说的「没通过」，如实印出来，不当电话故障。 */
const vcHooksResultBlockOf = function (h: any, t: any, state: any): any {
  const result = (state && state.hookResult) || null
  if (!result) return null
  if (result.ok !== true) {
    const vars: any = { reason: result.reason || result.kind }
    if (result.message) vars.message = result.message
    return h('div', { key: 'result', className: 'vcs-hooks-result vcs-hooks-result-fail', 'data-vc-hooks-result': 'fail', 'data-vc-hooks-fail-kind': String(result.kind || ''), role: 'alert' }, vcHooksText(t, vcConfigFailKeyOf(result.kind), vars))
  }
  const output = vcHookOutputOf(result)
  const children: any[] = [
    h('p', { key: 'ok', className: 'vcs-hooks-ok' }, vcHooksText(t, 'vc.hooks.result.ok', { code: String(result.exitCode === undefined ? 0 : result.exitCode) })),
  ]
  if (result.hookFailed === true || (typeof result.exitCode === 'number' && result.exitCode !== 0)) {
    children.push(h('p', { key: 'failed', className: 'vcs-hooks-hook-failed', 'data-vc-hooks-hook-failed': '1' }, vcHooksText(t, 'vc.hooks.output.hookFailed', { code: String(result.exitCode === undefined ? '' : result.exitCode) })))
  }
  children.push(h('h5', { key: 'otitle' }, vcHooksText(t, 'vc.hooks.output.title', null)))
  children.push(h('pre', { key: 'output', className: 'vcs-hooks-output', 'data-vc-hooks-output': '1' }, output))
  if (result.truncated === true) {
    children.push(h('p', { key: 'truncated', className: 'vcs-hooks-truncated', 'data-vc-hooks-output-truncated': '1' }, vcHooksText(t, 'vc.hooks.output.truncated', null)))
  }
  return h('div', { key: 'result', className: 'vcs-hooks-result', 'data-vc-hooks-result': 'ok', role: 'status' }, children)
}

/** 钩子页根节点：目录、只读安装说明、钩子清单、版本门、确认卡与结果条。 */
export const vcHooksPageNode = function (h: any, t: any, opts: any): any {
  const o = opts || {}
  const state = o.state || vcConfigStateNew()
  const pending = !!state.pending
  const rows = vcHookRowsOf(state)
  const dir = vcHooksDirOf(state) || {}
  const readState = vcHooksReadStateOf(state)
  const runVisible = vcHookRunVisibleOf(state)
  const act = function (input: any): void {
    if (typeof o.onHooks === 'function' && !pending) o.onHooks(input)
  }
  const edit = function (patch: any): void {
    if (typeof o.onHooksEdit === 'function') o.onHooksEdit(patch || {})
  }
  const ctx: any = {
    pending: pending,
    runVisible: runVisible,
    actRun: function (name: any): void { act({ op: 'hook-run', name: String(name) }) },
    actConfirmed: function (name: any): void {
      const check = state.check || {}
      act({ op: 'confirm-write', ticketId: String((check.ticket && check.ticket.id) || ''), checkOp: String(check.op || ''), name: String(name) })
    },
    actCancel: function (): void { edit({ cancelCheck: true }) },
  }
  const children: any[] = []
  children.push(h('header', { key: 'meta', className: 'vcs-hooks-meta' }, [
    h('h3', { key: 'title' }, vcHooksText(t, 'vc.hooks.title', null)),
    h('span', { key: 'dir', className: 'vcs-hooks-dir', 'data-vc-hooks-dir': '1' }, String(dir.dir || '')),
    h('span', { key: 'ver', className: 'vcs-hooks-version', 'data-vc-hooks-version': '1' }, String(state.gitVersion || '')),
    h('span', { key: 'conf', className: 'vcs-hooks-configured', 'data-vc-hooks-configured': '1' }, dir.configured
      ? vcHooksText(t, 'vc.hooks.configured', { path: String(dir.configured) })
      : vcHooksText(t, 'vc.hooks.notConfigured', null)),
  ]))
  children.push(h('p', { key: 'lede' }, vcHooksText(t, 'vc.hooks.lede', null)))
  children.push(h('p', { key: 'install', className: 'vcs-hooks-install-note', 'data-vc-hooks-install-note': '1' }, vcHooksText(t, 'vc.hooks.install.note', null)))
  if (readState === 'err') {
    children.push(h('p', { key: 'err', className: 'vcs-hooks-list-err', 'data-vc-hooks-list': 'err' }, vcHooksText(t, 'vc.hooks.list.err', { kind: String(state.readError || '') })))
  } else if (rows.length === 0) {
    children.push(h('p', { key: 'empty', className: 'vcs-hooks-list-empty', 'data-vc-hooks-list': 'empty' }, vcHooksText(t, 'vc.hooks.list.empty', null)))
  } else {
    children.push(h('ul', { key: 'list', className: 'vcs-hooks-list', 'data-vc-hooks-list': 'ok', 'data-vc-hooks-count': String(rows.length) }, rows.map(function (row: any) { return vcHookRowOf(h, t, row, ctx) })))
  }
  const gateNode = vcHooksGateBlockOf(h, t, state)
  if (gateNode) children.push(gateNode)
  const confirmNode = vcHooksConfirmBlockOf(h, t, state, ctx)
  if (confirmNode) children.push(confirmNode)
  const resultNode = vcHooksResultBlockOf(h, t, state)
  if (resultNode) children.push(resultNode)
  return h('section', {
    id: 'vc-hooks-page',
    className: 'vcs-hooks-page',
    'data-vc-hooks-page': '1',
    'data-vc-hooks-count': String(rows.length),
    'data-vc-hooks-version': String(state.gitVersion || ''),
    'data-vc-hooks-pending': pending ? '1' : '0',
  }, children)
}
