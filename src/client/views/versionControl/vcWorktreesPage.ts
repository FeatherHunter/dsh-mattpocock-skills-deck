// views/versionControl/vcWorktreesPage.ts —— 工作树页的页面体（#1752 T17；#1904 拆掉旧计划面）
//
// 这一块画规格第 9 节「工作树」那一页剩下的状态面：拦截原因、确认卡、执行结果。
// 版式（说明条 / 当前工作区卡 / 筛选 / 清单 / 新建表单 / 页脚）在 vcWorktreesView；
// 数据来自 vcWorktreesData（首屏快照两片），动作来自 vcWorktreesOps（预检/确认/执行三段）。
//
// #1904 起四条入口按原型 93–97 换了位置，旧计划面拆除：
//   · 新建工作区在页脚一颗链接，点开是页底浮出的一张表单（vcWorktreesView 画，本文件不再画输入框）；
//   · 移动与稀疏检出在每一行的动作行里，表单贴在展开行里；
//   · 旧的「八条能力入口清单」与「稀疏检出计划面」整块删除，界面不留第二条通往同一件事的路。
// 本文件只保留仍然需要的拦截卡（从行里点的删除 / 锁定 / 清理）、没有行可贴的确认卡（清理登记项）、
// 旧动作的执行结果（删除 / 锁定 / 清理仍按原三联式走）。
//
// 三条硬约束，改代码前先看：
//   1. 只用 data-wt-* 标记，绝不用 data-cap-primary —— 每条能力的唯一主入口标记由能力行负责（818 门禁逐条数），
//      这一页是「页内第二落点」，多画一个主入口标记会让账本上的入口数翻倍；
//   2. 可见文字全部走 t(词条)：词条真源 config/copy/vcworktrees.yaml，界面里不写中文字面量；
//   3. 行里点的危险动作（删 / 锁 / 清）先预检再确认：确认卡借 vcShellConfirmCardNode 的四段固定画法，
//      卡本身不带事件，本页在卡外一层做事件委托（取消看 data-vc-confirm-cancel，确认看 vcs-confirm-go 类名）。

// 下面这些名字在本文件单独过 tsc --noEmit 时看不到：构建按叶子登记次序把数据层、动作层与页面壳基础画法
// 拼在前面，运行期真实存在；这里只声明形状，节点构造函数与取词函数都从参数传进来。
declare function vcWorktreeDecisionReasonsOf(decision: any): string[]
declare function vcWorktreeDecisionStateOf(decision: any): string
declare function vcWorktreeWhyKeyOf(reason: any): string
declare function vcWorktreeActionOf(op: any): any
declare function vcWorktreesVersionHintOf(t: any, capId: any): string
declare function vcWorktreesModelOf(reads: any): any
declare function vcWorktreesUiOf(ui: any): any
declare function vcShellStateNode(h: any, t: any, o: any): any
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any
declare function vcShellResultNode(h: any, t: any, o: any): any
declare function vcWorktreesLayoutNodesOf(h: any, t: any, o: any): any[]
declare function vcWorktreeCall(ops: any, name: string, args?: any[]): any
declare function vcWorktreeAttrOf(ev: any, name: string): string
declare function vcWorktreeClassOf(ev: any): string

/** 这份文件的出处：排查时凭它找到这份文件。 */
export const VC_WORKTREES_PAGE_SOURCE: string = 'src/client/views/versionControl/vcWorktreesPage.ts'

/**
 * 八条能力与动作的对照表（能力号 → 动作）。它只是一份数据表，不再画成页面上的入口清单；
 * 新建 / 移动 / 稀疏检出三条的入口位置见 vcWorktreesView（页脚与展开行），
 * 命令面板与管理索引仍按这张表认每一条能力落到哪个动作。
 */
export const VC_WORKTREES_ENTRY_DEFS: any[] = [
  { capId: '9.1', op: 'list', row: false },
  { capId: '9.2', op: 'add', row: false },
  { capId: '9.3', op: 'add-branch', row: false },
  { capId: '9.4', op: 'remove', row: true },
  { capId: '9.5', op: 'prune', row: false },
  { capId: '9.6', op: 'lock', row: true },
  { capId: '9.7', op: 'move', row: true },
  { capId: '9.8', op: 'sparse-list', row: true },
]

/** 版本门说明：这条能力在版本上不是 full 时，把「需要哪个版本 + 替代做法」常驻画出来。 */
const vcWtVersionNode = function (h: any, t: any, model: any, capId: string): any {
  const version: any = vcWorktreesVersionNodeOf(model, capId)
  if (!version || version.state === 'full') return null
  const text: string = version.state === 'hidden' || version.state === 'degraded' ? vcWorktreesVersionHintOf(t, capId) : String(t('vc.wt.versionUnknown'))
  return h('p', { key: 'version', className: 'vc-wt-version', 'data-wt-version': String(version.state) }, text)
}

/** 版本片里的可用性；这里只读模型，不另读一份版本（数据层已经把片换算成模型里的 version）。 */
const vcWorktreesVersionNodeOf = function (model: any, capId: string): any {
  const version: any = model && model.version
  if (!version || version.state !== 'ok' || !version.byId) return null
  const hit: any = version.byId[capId]
  if (!hit) return { state: 'full' }
  return hit
}

/** 确认面：四段确认卡 + 外层的取消/确认事件委托；删除脏工作树时额外说清「先贮藏再移除」。 */
const vcWtConfirmNode = function (h: any, t: any, ui: any, ops: any): any {
  const plan: any = ui.plan || {}
  const input: any = ui.input || {}
  let target: string = String(plan.targetPath || input.path || '')
  if (ui.op === 'move') target = String(input.path || '') + ' → ' + String(input.dest || '')
  if (ui.op === 'prune') target = t('vc.wt.plan.pruneTitle', { n: Array.isArray(plan.pruneEntries) ? plan.pruneEntries.length : 0 })
  const card: any = vcShellConfirmCardNode(h, t, {
    verb: String(t('vc.wt.action.' + String(ui.op))),
    target: String(t('vc.wt.confirmTarget', { cmd: String(plan.cmd || ''), target: target })),
  })
  const kids: any[] = [card]
  if (ui.op === 'remove' && typeof plan.dirtyCount === 'number' && plan.dirtyCount > 0) {
    kids.push(h('p', { key: 'dirty', className: 'vc-wt-dirty', 'data-wt-dirty': String(plan.dirtyCount) }, t('vc.wt.plan.dirtyWarn')))
    kids.push(h('p', { key: 'stash', className: 'vc-wt-stash' }, t('vc.wt.plan.stashPath')))
  }
  return h('div', {
    key: 'confirm', className: 'vc-wt-confirm', 'data-wt-confirm': '1',
    onClick: function (ev: any) {
      if (vcWorktreeAttrOf(ev, 'data-vc-confirm-cancel') !== '') { vcWorktreeCall(ops, 'cancelConfirm'); return }
      if (vcWorktreeClassOf(ev).indexOf('vcs-confirm-go') >= 0) vcWorktreeCall(ops, 'confirmNow')
    },
  }, kids)
}

/** 拦截面：判定理由逐条常驻 + 版本门说明 + 「处理完再预检」的下一步（只给从行里点的删除 / 锁定 / 清理）。 */
const vcWtBlockedNode = function (h: any, t: any, model: any, ui: any, ops: any): any {
  const rs: string[] = vcWorktreeDecisionReasonsOf(ui.decision)
  const items: any[] = rs.length === 0
    ? [h('li', { key: 'none', className: 'vc-wt-why', 'data-wt-why': 'ok' }, t('vc.wt.why.ok'))]
    : rs.map(function (r: string, i: number): any {
      const k: string = vcWorktreeWhyKeyOf(r)
      return h('li', { key: 'why-' + i, className: 'vc-wt-why', 'data-wt-why': k }, t(k))
    })
  const version: any = vcWtVersionNode(h, t, model, ui.op === 'lock' || ui.op === 'unlock' ? '9.6' : String((vcWorktreeActionOf(ui.op) || {}).capId || ''))
  const kids: any[] = [
    h('h4', { key: 'title', className: 'vc-wt-blocked-title' }, t('vc.wt.blockedTitle')),
    h('ul', { key: 'reasons', className: 'vc-wt-why-list' }, items),
    h('button', {
      key: 'back', type: 'button', className: 'vc-wt-btn vc-wt-btn-back', 'data-wt-action': 'back', 'data-press': 'button', 'data-log': 'vc.wt.back',
      onClick: function () { vcWorktreeCall(ops, 'retry') },
    }, t('vc.wt.blockedNext')),
  ]
  if (version) kids.push(version)
  return h('div', { key: 'blocked', className: 'vc-wt-blocked', 'data-wt-blocked': '1' }, kids)
}

/** 旧动作的执行面（删除 / 锁定 / 清理）：在途画加载态；结束用壳里的结果画法。 */
const vcWtResultNode = function (h: any, t: any, ui: any, ops: any): any {
  if (ui.mode === 'running') return h('div', { key: 'running', className: 'vc-wt-running', 'data-wt-running': '1' }, [vcShellStateNode(h, t, { state: 'loading' })])
  if (ui.mode === 'failed') {
    const err: any = ui.error || {}
    return h('div', { key: 'failed', className: 'vc-wt-failed', 'data-wt-failed': '1' }, [
      vcShellResultNode(h, t, {
        error: err.kind || 'unknown',
        git: String(err.gitText || err.message || ''),
        step: String(err.step || ''), expected: String(err.expected || ''), actual: String(err.actual || ''), cause: String(err.cause || ''),
        message: String(t('vc.wt.action.' + String(ui.op))),
      }),
      h('button', {
        key: 'retry', type: 'button', className: 'vc-wt-btn vc-wt-btn-retry', 'data-wt-action': 'retry', 'data-press': 'button', 'data-log': 'vc.wt.retry',
        onClick: function () { vcWorktreeCall(ops, 'retry') },
      }, t('vc.wt.blockedNext')),
    ])
  }
  if (ui.mode === 'done') {
    const r: any = ui.result || {}
    return h('div', { key: 'done', className: 'vc-wt-done', 'data-wt-done': '1' }, [
      vcShellResultNode(h, t, {
        error: null, cmd: String(r.cmd || ''), ms: r.ms === null ? '' : r.ms, n: r.n === null ? 0 : r.n,
        next: String(t('vc.wt.resultNext')),
      }),
      h('button', {
        key: 'close', type: 'button', className: 'vc-wt-btn vc-wt-btn-close', 'data-wt-action': 'close', 'data-press': 'button', 'data-log': 'vc.wt.close',
        onClick: function () { vcWorktreeCall(ops, 'cancelConfirm') },
      }, t('vc.wt.listRefresh')),
    ])
  }
  return null
}

/**
 * 工作树页根节点。只读这一处：模型（或用 reads 现算）、ui 读数、处理函数。
 * 版式在 vcWorktreesView（说明条 → 当前工作区 → 头与筛选 → 清单 → 新建表单 → 页脚 → 结果条），
 * 本函数只负责把拦截/确认/旧结果这些按状态出现的面接在版式之后。
 */
export const vcWorktreesPageNode = function (h: any, t: any, o: any): any {
  const opts: any = o || {}
  const model: any = opts.worktrees || vcWorktreesModelOf(opts.reads || {})
  const ui: any = vcWorktreesUiOf(opts.ui || {})
  const ops: any = opts.ops || opts.handlers || {}
  const kids: any[] = vcWorktreesLayoutNodesOf(h, t, { model: model, ui: ui, ops: ops, onOpenHandoff: opts.onOpenHandoff })
  if (ui.mode === 'blocked') kids.push(vcWtBlockedNode(h, t, model, ui, ops))
  // 按路径定位的确认卡已经由版式贴进目标行（vcWorktreesView），这里只补「没有行可贴」的那一种（清理登记项）。
  const confirmPath: string = String((ui.plan || {}).targetPath || (ui.input || {}).path || '')
  const rowPaths: string[] = (Array.isArray(model.rows) ? model.rows : []).map(function (r: any): string { return String(r.path || '') })
  const confirmInline: boolean = ui.mode === 'confirm' && ui.op !== 'prune' && confirmPath !== '' && rowPaths.indexOf(confirmPath) >= 0
  if (ui.mode === 'confirm' && !confirmInline) kids.push(vcWtConfirmNode(h, t, ui, ops))
  // 三张表单的进行中状态由表单自己表现（结果条在页脚之后）：它们不走旧的三段式结果卡，
  //   否则页底会同时出现一张加载卡与一张结果条。删除 / 锁定 / 清理仍按旧画法出卡。
  const formOp: boolean = ['add', 'add-branch', 'move', 'sparse-set'].indexOf(ui.op) >= 0
  if (!(ui.mode === 'running' && formOp) && (ui.mode === 'running' || ui.mode === 'failed' || ui.mode === 'done')) {
    const result: any = vcWtResultNode(h, t, ui, ops)
    if (result) kids.push(result)
  }
  return h('section', {
    className: 'vc-wt-page view view-worktrees',
    'data-vc-wt-page': '1',
    'data-vc-wt-mode': ui.mode,
    'data-vc-wt-state': model.state,
  }, kids)
}
