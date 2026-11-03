/**
 * src/client/views/versionControl/vcHooksPage.ts —— 钩子页（#1760 T24，规格 #1586 域 12 的 12.5、12.6）
 *
 * 这一页只做两件事：列出本仓库的钩子（已启用、示例、core.hooksPath 指到哪），
 * 以及手动跑一个钩子（git hook run，git 2.36 以上）。安装与停用不在这里做：
 * 它们要往 .git/hooks 写可执行文件、改可执行位，不是 git 命令，页面只给只读说明与命令。
 * 数据怎么读、回包怎么落状态在 vcConfigOps.ts（配置与钩子共用一套读数电话）。
 *
 * #1842 起按定稿原型（docs/prototype/vc-redesign 第 45 张）重做版式：页头交给页面壳的 vcPageHeadNode，
 * 正文分成「钩子目录」「钩子清单」「手动运行」三段；目录段是事实格，清单段每个文件一行
 * （名字 + 示例/已启用标记 + 一句说明 + 右侧运行入口），版本门挪到手动运行段里。
 * 所有 data-vc-hook-* / data-vc-hooks-* 判据照旧保留：清单行、示例标记、可执行标记、运行按钮的位置变了，属性名与含义不变。
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
// 来自页面骨架原语 vcPageHead.ts（#1829 阶段 4）：
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageFactGridNode(h: any, t: any, o: any): any
declare function vcPageObjRowNode(h: any, t: any, o: any): any

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_HOOKS_PAGE_SOURCE = 'src/client/views/versionControl/vcHooksPage.ts'

const vcHooksText = function (t: any, key: string, vars?: any): string {
  if (typeof t !== 'function') return key
  return vars ? t(key, vars) : t(key)
}

/** 一条钩子：名字、示例/已启用标记、一句说明；右侧是运行入口（版本门收起时不给）。 */
const vcHookRowOf = function (h: any, t: any, row: any, ctx: any): any {
  const name = String((row && row.name) || '')
  const sample = !!(row && row.sample)
  const executable = !!(row && row.executable)
  const runnable = !!(row && row.runnable)
  const visible = ctx.runVisible === true
  const chipKey = sample ? 'vc.hooks.sample' : (executable ? 'vc.hooks.enabled' : 'vc.hooks.executable')
  const main: any[] = [
    h('div', { key: 'name-row', className: 'vcs-hook-name-row' }, [
      h('strong', { key: 'name', className: 'vcs-hook-name' }, name),
      h('span', { key: 'chip', className: 'vcs-hook-chip ' + (sample ? 'is-sample' : 'is-enabled'), 'data-vc-hook-sample': sample ? '1' : '0' }, vcHooksText(t, chipKey, null)),
    ]),
    h('p', { key: 'note', className: 'vcs-hook-note' }, vcHooksText(t, sample ? 'vc.hooks.sample.note' : 'vc.hooks.executable.note', null)),
  ]
  if (!sample && row && row.executable === false) {
    main.push(h('span', { key: 'noexec', className: 'vcs-hook-warn', 'data-vc-hook-executable': '0' }, vcHooksText(t, 'vc.hooks.notExecutable', null)))
  }
  const side: any[] = []
  if (runnable && visible) {
    side.push(h('button', {
      key: 'run',
      type: 'button',
      className: 'vcs-hook-run-btn',
      'data-vc-hook-run': name,
      'data-vc-hooks-cap': '12.6',
      disabled: ctx.pending === true,
      'data-press': 'button', 'data-log': 'vc.hooks.run', onClick: function () { ctx.actRun(name) },
    }, vcHooksText(t, 'vc.hooks.run', null)))
  }
  return vcPageObjRowNode(h, t, { main: main, side: side, attrs: { 'data-vc-hook': name } })
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
      h('button', { key: 'go', type: 'button', className: 'vcs-confirm-go vcs-hook-run-btn', 'data-vc-hooks-confirm-go': '1', disabled: ctx.pending === true, 'data-press': 'button', 'data-log': 'vc.hooks.confirm-go', onClick: function () { ctx.actConfirmed(name) } }, vcHooksText(t, 'vc.hooks.confirm.go', { verb: verb })),
      h('button', { key: 'cancel', type: 'button', className: 'vcs-hook-run-btn', 'data-vc-hooks-confirm-cancel': '1', 'data-press': 'button', 'data-log': 'vc.hooks.confirm-cancel', onClick: function () { ctx.actCancel() } }, vcHooksText(t, 'vc.hooks.confirm.cancel', null)),
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
  const output = vcHookOutputOf(state)
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

/** 钩子目录段：安装说明在前，六个事实格在后（目录、hooksPath、已启用数、示例数、编辑方式、git 版本）。 */
const vcHooksDirSectionOf = function (h: any, t: any, state: any, rows: any[], dir: any): any {
  const enabledCount = rows.filter(function (row: any) { return row && row.sample !== true }).length
  const sampleCount = rows.filter(function (row: any) { return row && row.sample === true }).length
  const facts: any[] = [
    { key: 'vc.hooks.fact.dir', value: String(dir.dir || ''), mono: true, attrs: { 'data-vc-hooks-dir': '1' } },
    {
      key: 'core.hooksPath',
      value: dir.configured
        ? vcHooksText(t, 'vc.hooks.configured', { path: String(dir.configured) })
        : 'vc.hooks.notConfigured',
      mono: dir.configured !== undefined && dir.configured !== null && String(dir.configured) !== '',
      tone: dir.configured ? '' : 'muted',
    },
    { key: 'vc.hooks.fact.enabled', value: vcHooksText(t, 'vc.hooks.countValue', { n: enabledCount }), mono: true },
    { key: 'vc.hooks.fact.samples', value: vcHooksText(t, 'vc.hooks.countValue', { n: sampleCount }), mono: true },
    { key: 'vc.hooks.fact.editor', value: 'vc.hooks.fact.editorValue' },
    { key: 'vc.hooks.fact.version', value: String(state.gitVersion || ''), mono: true, attrs: { 'data-vc-hooks-version': '1' } },
  ]
  return vcPageSectionNode(h, t, {
    title: 'vc.hooks.section.dir',
    note: 'vc.hooks.section.dirNote',
    children: [
      h('p', { key: 'install', className: 'vcs-hooks-install-note', 'data-vc-hooks-install-note': '1' }, vcHooksText(t, 'vc.hooks.install.note', null)),
      vcPageFactGridNode(h, t, { facts: facts }),
    ],
  })
}

/** 钩子清单段：读失败、空目录、正常三态；正常时每个文件一行。 */
const vcHooksListSectionOf = function (h: any, t: any, state: any, rows: any[], readState: string, ctx: any): any {
  let children: any[]
  if (readState === 'err') {
    children = [h('p', { key: 'err', className: 'vcs-hooks-list-err', 'data-vc-hooks-list': 'err' }, vcHooksText(t, 'vc.hooks.list.err', { kind: String(state.readError || '') }))]
  } else if (rows.length === 0) {
    children = [h('p', { key: 'empty', className: 'vcs-hooks-list-empty', 'data-vc-hooks-list': 'empty' }, vcHooksText(t, 'vc.hooks.list.empty', null))]
  } else {
    children = [h('div', { key: 'list', className: 'vcs-hooks-list', 'data-vc-hooks-list': 'ok', 'data-vc-hooks-count': String(rows.length) }, rows.map(function (row: any) { return vcHookRowOf(h, t, row, ctx) }))]
  }
  return vcPageSectionNode(h, t, {
    title: 'vc.hooks.section.list',
    count: rows.length,
    note: 'vc.hooks.section.listNote',
    children: children,
  })
}

/** 手动运行段：这里只放说明与版本门；运行入口在清单每一行上，13 个文件不会挤 13 个按钮到同一段。 */
const vcHooksRunSectionOf = function (h: any, t: any, state: any): any {
  const children: any[] = [h('p', { key: 'note', className: 'vcs-hooks-run-note' }, vcHooksText(t, 'vc.hooks.section.runNote', null))]
  const gateNode = vcHooksGateBlockOf(h, t, state)
  if (gateNode) children.push(gateNode)
  return vcPageSectionNode(h, t, {
    title: 'vc.hooks.section.run',
    count: 1,
    note: null,
    children: children,
  })
}

/** 钩子页根节点：页头由页面壳画，这里只画目录段、清单段、手动运行段与确认卡、结果条。 */
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
  children.push(vcHooksDirSectionOf(h, t, state, rows, dir))
  children.push(vcHooksListSectionOf(h, t, state, rows, readState, ctx))
  children.push(vcHooksRunSectionOf(h, t, state))
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
