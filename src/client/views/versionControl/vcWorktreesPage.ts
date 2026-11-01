// views/versionControl/vcWorktreesPage.ts —— 工作树页的页面体（#1752 T17）
//
// 这一块画规格第 9 节「工作树」那一页：清单（含当前这一棵）、八条能力的入口、预检后的确认卡或计划面、
// 拦截原因、执行结果。数据与动作都不在这里实现：读数来自 vcWorktreesData（首屏快照两片），
// 动作来自 vcWorktreesOps（预检/确认/执行三段），本文件只把它们画成节点。
//
// 三条硬约束，改代码前先看：
//   1. 只用 data-wt-* 标记，绝不用 data-cap-primary —— 每条能力的唯一主入口标记由能力行负责（818 门禁逐条数），
//      这一页是「页内第二落点」，多画一个主入口标记会让账本上的入口数翻倍；
//   2. 可见文字全部走 t(词条)：词条真源 config/copy/vcworktrees.yaml，界面里不写中文字面量；
//   3. 危险动作（删 / 清理 / 移动 / 写稀疏规则）先预检再确认：确认卡借 vcShellConfirmCardNode 的四段固定画法，
//      卡本身不带事件，本页在卡外一层做事件委托（取消看 data-vc-confirm-cancel，确认看 vcs-confirm-go 类名）。
//
// 页面怎么拿到读数与处理函数：页面壳（vcShellPages.ts）的挂载段把 opts.reads / opts.ui / opts.ops 传下来；
// 缺读数时数据层回「还没读」，页面画空态与八条入口；缺处理函数时按钮不绑事件，商用的空壳也不报错。

// 下面这些名字在本文件单独过 tsc --noEmit 时看不到：构建按叶子登记次序把数据层、动作层与页面壳基础画法
// 拼在前面，运行期真实存在；这里只声明形状，节点构造函数与取词函数都从参数传进来。
declare function vcWorktreeDecisionReasonsOf(decision: any): string[]
declare function vcWorktreeDecisionStateOf(decision: any): string
declare function vcWorktreeWhyKeyOf(reason: any): string
declare function vcWorktreeActionOf(op: any): any
declare function vcWorktreeCapOf(capId: any): any
declare function vcWorktreeAvailabilityOf(version: any, capId: any): any
declare function vcWorktreesVersionHintOf(t: any, capId: any): string
declare function vcWorktreesRowActionsOf(model: any, row: any): any[]
declare function vcWorktreesModelOf(reads: any): any
declare function vcWorktreesActionDecisionOf(model: any, op: any, input: any): any
declare function vcWorktreesUiOf(ui: any): any
declare function vcShellStateNode(h: any, t: any, o: any): any
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any
declare function vcShellResultNode(h: any, t: any, o: any): any
declare function vcWorktreeCall(ops: any, name: string, args?: any[]): any
declare function vcWorktreeAttrOf(ev: any, name: string): string
declare function vcWorktreeClassOf(ev: any): string

/** 这份文件的出处：排查时凭它找到这份文件。 */
export const VC_WORKTREES_PAGE_SOURCE: string = 'src/client/views/versionControl/vcWorktreesPage.ts'

/** 八条能力在页面上的落点：哪一条画成整页动作、哪一条画成清单行内动作。 */
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

/** 一条动作的理由说明：判定给的第一个理由标识符翻成人话；没有判定就不画。 */
const vcWtWhyNode = function (h: any, t: any, decision: any, keyName: string): any {
  const rs: string[] = decision ? vcWorktreeDecisionReasonsOf(decision) : []
  if (rs.length === 0) return null
  const k: string = vcWorktreeWhyKeyOf(rs[0])
  return h('p', { key: keyName, className: 'vc-wt-why', 'data-wt-why': k }, t(k))
}

/** 版本门说明：这条能力在版本上不是 full 时，把「需要哪个版本 + 替代做法」常驻画出来。 */
const vcWtVersionNode = function (h: any, t: any, model: any, capId: string): any {
  const version: any = vcWorktreeAvailabilityOf(model && model.version, capId)
  if (!version || version.state === 'full') return null
  const text: string = version.state === 'hidden' || version.state === 'degraded' ? vcWorktreesVersionHintOf(t, capId) : String(t('vc.wt.versionUnknown'))
  return h('p', { key: 'version', className: 'vc-wt-version', 'data-wt-version': String(version.state) }, text)

}

/**
 * 一条动作的按钮。判为 block 时禁用并把理由标识符写在 data-wt-why 上（读屏与门禁都能看到）；
 * 判为 warn 时仍可点，但理由常驻在旁边（比如「这棵有未提交改动」）。
 */
const vcWtButtonNode = function (h: any, t: any, o: any): any {
  const opts: any = o || {}
  const decision: any = opts.decision || null
  const blocked: boolean = decision ? vcWorktreeDecisionStateOf(decision) === 'block' : false
  const attrs: any = {
    key: opts.key || opts.op,
    type: 'button',
    className: 'vc-wt-btn vc-wt-btn-' + String(opts.op),
    'data-wt-action': String(opts.op),
    'data-wt-cap': String(opts.capId),
    'data-press': 'button',
    'data-log': 'vc.wt.' + String(opts.op),
    onClick: function (ev: any) {
      const opName: string = String(opts.op)
      if (opName === 'list') return vcWorktreeCall(opts.ops, 'refresh')
      const preset: any = {}
      if (opts.path) preset.path = String(opts.path)
      if (opts.dirs) preset.dirs = opts.dirs
      return vcWorktreeCall(opts.ops, 'start', [opName, preset])
    },
  }
  if (blocked) {
    const rs: string[] = vcWorktreeDecisionReasonsOf(decision)
    const k: string = vcWorktreeWhyKeyOf(rs.length ? rs[0] : 'ok')
    attrs.disabled = true
    attrs['data-wt-why'] = k
    attrs.title = t(k)
  } else if (decision && vcWorktreeDecisionStateOf(decision) === 'warn') {
    const rs: string[] = vcWorktreeDecisionReasonsOf(decision)
    attrs['data-wt-warn'] = vcWorktreeWhyKeyOf(rs.length ? rs[0] : 'ok')
  }
  return h('button', attrs, String(opts.label === undefined ? t('vc.wt.action.' + String(opts.op)) : opts.label))
}

/** 一个输入框（标签 + input）；改动交给处理层的 field，页面不自己存值。 */
const vcWtFieldNode = function (h: any, t: any, o: any): any {
  const opts: any = o || {}
  const name: string = String(opts.name)
  return h('label', { key: 'field-' + name, className: 'vc-wt-field' }, [
    h('span', { key: 'label', className: 'vc-wt-field-label' }, t(String(opts.labelKey))),
    h('input', {
      key: 'input',
      type: 'text',
      className: 'vc-wt-input',
      'data-wt-field': name,
      value: String(opts.value || ''),
      onChange: function (ev: any) { vcWorktreeCall(opts.ops, 'field', [name, ev && ev.target ? ev.target.value : '']) },
    }),
  ])
}

/** 徽标：当前 / 已锁定 / 锁定状态读不出 / 待清理，各一枚，画在行首那一行里。 */
const vcWtBadgesOf = function (h: any, t: any, row: any): any[] {
  const out: any[] = []
  if (row.current === true) out.push(h('span', { key: 'current', className: 'vc-wt-badge', 'data-wt-badge': 'current' }, t('vc.wt.current')))
  if (row.locked === true) out.push(h('span', { key: 'locked', className: 'vc-wt-badge', 'data-wt-badge': 'locked' }, t('vc.wt.locked')))
  if (row.lockUnknown === true) out.push(h('span', { key: 'lockUnknown', className: 'vc-wt-badge', 'data-wt-badge': 'lock-unknown' }, t('vc.wt.lockUnknown')))
  if (row.prunable === true) out.push(h('span', { key: 'prunable', className: 'vc-wt-badge', 'data-wt-badge': 'prunable' }, t('vc.wt.prunable')))
  return out
}

/** 清单一行：路径、提交、分支（或游离说明）、徽标、锁定/待清理原因、行内四个动作按钮。 */
export const vcWorktreesRowNode = function (h: any, t: any, o: any): any {
  const opts: any = o || {}
  const row: any = opts.row || {}
  const model: any = opts.model || {}
  const actions: any[] = Array.isArray(opts.actions) ? opts.actions : vcWorktreesRowActionsOf(model, row)
  const branchNode: any = row.detached === true
    ? h('span', { key: 'branch', className: 'vc-wt-branch' }, t('vc.wt.detached'))
    : h('span', { key: 'branch', className: 'vc-wt-branch' }, t('vc.wt.branch') + ' ' + String(row.branch || ''))
  const head: any[] = [
    h('span', { key: 'path', className: 'vc-wt-path' }, String(row.display || row.path || '')),
    h('span', { key: 'head', className: 'vc-wt-head' }, t('vc.wt.head') + ' ' + String(row.head || '').slice(0, 12)),
    branchNode,
  ]
  const kids: any[] = [h('div', { key: 'main', className: 'vc-wt-row-main' }, head.concat(vcWtBadgesOf(h, t, row)))]
  if (row.locked === true && String(row.lockReason || '') !== '') kids.push(h('p', { key: 'lockReason', className: 'vc-wt-detail', 'data-wt-detail': 'locked' }, t('vc.wt.detailLocked', { reason: String(row.lockReason) })))
  if (row.prunable === true) kids.push(h('p', { key: 'prunable', className: 'vc-wt-detail', 'data-wt-detail': 'prunable' }, t('vc.wt.detailPrunable', { reason: String(row.prunableReason || '') })))
  const btns: any[] = actions.map(function (a: any): any {
    return vcWtButtonNode(h, t, { op: a.op, capId: a.action.capId, label: t('vc.wt.action.' + a.op), path: row.path, decision: a.decision, ops: opts.ops })
  })
  kids.push(h('div', { key: 'acts', className: 'vc-wt-row-acts', 'data-wt-row-actions': '1' }, btns))
  return h('li', {
    key: String(row.path || ''),
    className: 'vc-wt-row' + (row.current === true ? ' vc-wt-row-current' : ''),
    'data-wt-row': '1',
    'data-wt-path': String(row.path || ''),
    'data-wt-current': row.current === true ? '1' : '0',
    'data-wt-locked': row.locked === true ? '1' : '0',
    'data-wt-prunable': row.prunable === true ? '1' : '0',
  }, kids)
}

/** prune 清单：预检之前就先列出「将清理的登记项」（票面要求先列后清），没有就说不必执行。 */
const vcWtPrunePreviewNode = function (h: any, t: any, model: any): any {
  const entries: any[] = Array.isArray(model.pruneEntries) ? model.pruneEntries : []
  if (entries.length === 0) {
    return h('p', { key: 'pruneNone', className: 'vc-wt-prune-none', 'data-wt-prune-empty': '1' }, t('vc.wt.plan.pruneEmpty'))
  }
  // key 不能与 9.5 那个 prune 按钮重名（同一层子节点里重复 key，React 会告警）。
  return h('div', { key: 'prune-preview', className: 'vc-wt-prune', 'data-wt-prune': '1' }, [
    h('p', { key: 'title', className: 'vc-wt-prune-title' }, t('vc.wt.plan.pruneTitle', { n: entries.length })),
    h('ul', { key: 'items', className: 'vc-wt-prune-items' }, entries.map(function (r: any): any {
      return h('li', { key: String(r.path || ''), className: 'vc-wt-prune-item', 'data-wt-prune-item': String(r.path || '') }, String(r.path || '') + (r.prunableReason ? ' · ' + String(r.prunableReason) : ''))
    })),
  ])
}

/** 八条能力里的一条入口节点：能力号、名字、命令、输入框、按钮、理由与版本门说明。 */
export const vcWorktreesEntryNode = function (h: any, t: any, o: any): any {
  const opts: any = o || {}
  const model: any = opts.model || {}
  const ui: any = opts.ui || {}
  const ops: any = opts.ops
  const def: any = opts.def || {}
  const capId: string = String(def.capId)
  const cap: any = opts.cap || vcWorktreeCapOf(capId) || {}
  const input: any = ui.input || {}
  const opsList: string[] = capId === '9.6' ? ['lock', 'unlock'] : [String(def.op)]
  const kids: any[] = [h('div', { key: 'head', className: 'vc-wt-entry-head' }, [
    h('span', { key: 'id', className: 'vc-wt-cap-id', 'data-wt-cap-id': capId }, capId),
    h('span', { key: 'name', className: 'vc-wt-cap-name' }, String(cap.name || '')),
    h('code', { key: 'cmd', className: 'vc-wt-cap-cmd' }, String(cap.command || '')),
  ])]
  if (def.row === true) kids.push(h('p', { key: 'hint', className: 'vc-wt-entry-hint' }, t('vc.wt.entryHint')))
  else if (capId === '9.1') {
    kids.push(vcWtButtonNode(h, t, { op: 'list', capId: capId, label: t('vc.wt.listRefresh'), decision: vcWorktreesActionDecisionOf(model, 'list', {}), ops: ops }))
  } else if (capId === '9.5') {
    kids.push(vcWtButtonNode(h, t, { op: 'prune', capId: capId, decision: vcWorktreesActionDecisionOf(model, 'prune', input), ops: ops }))
    kids.push(vcWtPrunePreviewNode(h, t, model))
  } else if (capId === '9.2' || capId === '9.3') {
    kids.push(vcWtFieldNode(h, t, { name: 'path', labelKey: 'vc.wt.pathLabel', value: input.path, ops: ops }))
    if (capId === '9.3') kids.push(vcWtFieldNode(h, t, { name: 'branch', labelKey: 'vc.wt.branchLabel', value: input.branch, ops: ops }))
    kids.push(vcWtButtonNode(h, t, { op: String(def.op), capId: capId, decision: vcWorktreesActionDecisionOf(model, def.op, input), ops: ops }))
  }
  // 锁要原因（解锁可空）：原因输入框画在 9.6 这一行，锁/解锁两个按钮都列出来。
  if (capId === '9.6') {
    kids.push(vcWtFieldNode(h, t, { name: 'reason', labelKey: 'vc.wt.reasonLabel', value: input.reason, ops: ops }))
    for (let i = 0; i < opsList.length; i += 1) {
      kids.push(vcWtButtonNode(h, t, { op: opsList[i], capId: capId, decision: vcWorktreesActionDecisionOf(model, opsList[i], input), ops: ops }))
    }
  }
  // 移动：目的地输入框画在 9.7 这一行（行内按钮执行时带上当前路径）。
  if (capId === '9.7') kids.push(vcWtFieldNode(h, t, { name: 'dest', labelKey: 'vc.wt.destLabel', value: input.dest, ops: ops }))
  const why: any = capId === '9.6' ? vcWtWhyNode(h, t, vcWorktreesActionDecisionOf(model, 'lock', input), 'why-lock')
    : (def.row === true ? null : vcWtWhyNode(h, t, vcWorktreesActionDecisionOf(model, def.op, input), 'why'))
  if (why) kids.push(why)
  const version: any = vcWtVersionNode(h, t, model, capId)
  if (version) kids.push(version)
  return h('li', { key: capId, className: 'vc-wt-entry', 'data-wt-entry': capId }, kids)
}

/** 八条入口清单：整页动作画成一行；清单行内动作画成「先选一棵」的说明，真正按钮在每行里。 */
const vcWtEntriesNode = function (h: any, t: any, model: any, ui: any, ops: any): any {
  const byId: any = {}
  const caps: any[] = Array.isArray(model.caps) ? model.caps : []
  for (let i = 0; i < caps.length; i += 1) byId[String(caps[i].capId)] = caps[i]
  const rows: any[] = VC_WORKTREES_ENTRY_DEFS.map(function (def: any): any {
    return vcWorktreesEntryNode(h, t, { def: def, model: model, ui: ui, ops: ops, cap: byId[String(def.capId)] && byId[String(def.capId)].cap })
  })
  return h('section', { key: 'entries', className: 'vc-wt-entries', 'data-wt-entries': '1' }, [
    h('h4', { key: 'title', className: 'vc-wt-entries-title' }, t('vc.wt.actionsTitle')),
    h('ul', { key: 'list', className: 'vc-wt-entry-list' }, rows),
  ])
}

/** 稀疏检出计划面：现在的规则、将更新的规则文件、顶层目录勾选、写入按钮。 */
const vcWtSparsePlanNode = function (h: any, t: any, model: any, ui: any, ops: any): any {
  const plan: any = ui.plan || {}
  const sparse: any = plan.sparse || {}
  const rules: string[] = Array.isArray(sparse.rules) ? sparse.rules : []
  const candidates: string[] = Array.isArray(sparse.candidates) ? sparse.candidates : []
  const chosen: string[] = Array.isArray(ui.input && ui.input.dirs) ? ui.input.dirs : []
  const dirs: any[] = candidates.map(function (dir: string): any {
    return h('label', { key: 'dir-' + dir, className: 'vc-wt-dir' }, [
      h('input', {
        key: 'box', type: 'checkbox', 'data-wt-dir': dir, checked: chosen.indexOf(dir) >= 0,
        onChange: function (ev: any) { vcWorktreeCall(ops, 'pickDir', [dir, !!(ev && ev.target && ev.target.checked)]) },
      }),
      h('span', { key: 'name' }, dir),
    ])
  })
  const ruleItems: any[] = rules.length === 0
    ? [h('li', { key: 'none', className: 'vc-wt-rule-none', 'data-wt-rule-empty': '1' }, t('vc.wt.plan.rulesEmpty'))]
    : rules.map(function (r: string): any { return h('li', { key: 'rule-' + r, className: 'vc-wt-rule', 'data-wt-rule': r }, r) })
  const kids: any[] = [
    h('h4', { key: 'title', className: 'vc-wt-plan-title' }, t('vc.wt.dirsLabel')),
    h('p', { key: 'ruleFile', className: 'vc-wt-plan-file', 'data-wt-rule-file': String(sparse.ruleFile || '') }, t('vc.wt.plan.ruleFile', { file: String(sparse.ruleFile || '') })),
    h('p', { key: 'rulesTitle' }, t('vc.wt.plan.rulesTitle')),
    h('ul', { key: 'rules', className: 'vc-wt-rules' }, ruleItems),
    h('p', { key: 'candsTitle' }, t('vc.wt.plan.candidatesTitle')),
    h('div', { key: 'dirs', className: 'vc-wt-dirs' }, dirs),
    h('p', { key: 'cmd', className: 'vc-wt-plan-cmd', 'data-wt-plan-cmd': String(plan.cmd || '') }, t('vc.wt.plan.cmd', { cmd: String(plan.cmd || '') })),
    vcWtButtonNode(h, t, { op: 'sparse-set', capId: '9.8', label: t('vc.wt.writeDirs'), decision: vcWorktreesActionDecisionOf(model, 'sparse-set', ui.input), ops: ops }),
  ]
  return h('div', { key: 'sparsePlan', className: 'vc-wt-plan', 'data-wt-plan': 'sparse-list' }, kids)
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

/** 拦截面：判定理由逐条常驻 + 版本门说明 + 「处理完再预检」的下一步。 */
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
    h('p', { key: 'next', className: 'vc-wt-blocked-next' }, t('vc.wt.blockedNext')),
    h('button', {
      key: 'back', type: 'button', className: 'vc-wt-btn vc-wt-btn-back', 'data-wt-action': 'back', 'data-press': 'button', 'data-log': 'vc.wt.back',
      onClick: function () { vcWorktreeCall(ops, 'retry') },
    }, t('vc.wt.blockedNext')),
  ]
  if (version) kids.push(version)
  return h('div', { key: 'blocked', className: 'vc-wt-blocked', 'data-wt-blocked': '1' }, kids)
}

/** 执行中 / 结果面：在途画加载态；结束用壳里的结果画法（成功报子命令名/耗时/对象数，失败报 git 原话与环节）。 */
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

/** 清单区：四态（空/加载/失败/有数据）。失败态给「重试读数」的点击委托，不把旧读数当新读数。 */
const vcWtListSectionNode = function (h: any, t: any, model: any, ui: any, ops: any): any {
  const kids: any[] = [h('h4', { key: 'title', className: 'vc-wt-list-title' }, t('vc.wt.title') + ' · ' + t('vc.wt.count', { n: model.count }))]
  if (model.state === 'loading') kids.push(vcShellStateNode(h, t, { state: 'loading' }))
  else if (model.state === 'idle') {
    kids.push(vcShellStateNode(h, t, { state: 'empty' }))
    if (model.bare === true) kids.push(h('p', { key: 'bare', className: 'vc-wt-bare', 'data-wt-bare': '1' }, t('vc.wt.bare')))
  } else if (model.state === 'error') {
    const err: any = model.error || {}
    kids.push(h('div', {
      key: 'error', className: 'vc-wt-error', 'data-wt-error': String(err.kind || ''),
      onClick: function (ev: any) { if (vcWorktreeAttrOf(ev, 'data-vc-state-action') === 'retry') vcWorktreeCall(ops, 'refresh') },
    }, [vcShellStateNode(h, t, { state: 'error' })]))
  } else if (model.count === 0) {
    kids.push(vcShellStateNode(h, t, { state: 'empty' }))
  } else {
    kids.push(h('ul', { key: 'rows', className: 'vc-wt-rows', 'data-wt-list': '1' }, model.rows.map(function (row: any): any {
      return vcWorktreesRowNode(h, t, { row: row, model: model, ops: ops })
    })))
  }
  return h('section', { key: 'list', className: 'vc-wt-list', 'data-wt-list-section': '1' }, kids)
}

/**
 * 工作树页根节点。只读这一处：模型（或用 reads 现算）、ui 读数、处理函数。
 * 页面壳挂载时只传 opts.reads / opts.ui / opts.ops；门禁可以直接传模型，省掉首屏快照的构造。
 */
export const vcWorktreesPageNode = function (h: any, t: any, o: any): any {
  const opts: any = o || {}
  const model: any = opts.worktrees || vcWorktreesModelOf(opts.reads || {})
  const ui: any = vcWorktreesUiOf(opts.ui || {})
  const ops: any = opts.ops || opts.handlers || {}
  const kids: any[] = [
    h('header', { key: 'header', className: 'vc-wt-header', 'data-wt-header': '1' }, [
      h('h3', { key: 'title', className: 'vc-wt-title' }, t('vc.wt.title')),
      h('span', { key: 'count', className: 'vc-wt-count', 'data-wt-count': String(model.count) }, t('vc.wt.count', { n: model.count })),
      vcWtButtonNode(h, t, { op: 'list', capId: '9.1', label: t('vc.wt.listRefresh'), decision: vcWorktreesActionDecisionOf(model, 'list', {}), ops: ops }),
    ]),
    vcWtEntriesNode(h, t, model, ui, ops),
    vcWtListSectionNode(h, t, model, ui, ops),
  ]
  if (ui.mode === 'blocked') kids.push(vcWtBlockedNode(h, t, model, ui, ops))
  if (ui.mode === 'plan' && ui.op === 'sparse-list') kids.push(vcWtSparsePlanNode(h, t, model, ui, ops))
  if (ui.mode === 'confirm') kids.push(vcWtConfirmNode(h, t, ui, ops))
  if (ui.mode === 'running' || ui.mode === 'failed' || ui.mode === 'done') {
    const result: any = vcWtResultNode(h, t, ui, ops)
    if (result) kids.push(result)
  }
  return h('section', {
    className: 'vc-wt-page',
    'data-vc-wt-page': '1',
    'data-vc-wt-mode': ui.mode,
    'data-vc-wt-state': model.state,
  }, kids)
}