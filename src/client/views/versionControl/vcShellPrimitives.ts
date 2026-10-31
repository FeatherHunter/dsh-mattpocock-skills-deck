// views/versionControl/vcShellPrimitives.ts —— 页面骨架的基础画法（#1738 T03）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这里只画壳子层面的公共零件，不实现任何业务按钮：
//   1. 四种状态：空 / 加载 / 失败 / 禁用，各有自己的画法与读屏语义；
//   2. 三种表单形态：行内展开 / 贴触发点的浮层 / 整页替换（data-vc-form）；
//   3. 危险动作确认卡：固定四段（会动什么、不会动什么、可逆性与恢复路径、动词写后果），
//      默认焦点在「取消」上，永远贴在触发点，不做居中模态；
//   4. 结果信息：成功 / 失败两形，始终挂在触发它的那条能力行里（结果贴触发点）；
//   5. 能力行：每条能力恰有一个 data-cap-primary 主入口标记；打开操作面时行内出现 data-surface。
//
// 未实现的能力不画假按钮：主入口行里画的是「入口由后续票实现」的说明，并标 data-cap-pending；
// 但能力仍可从命令面板搜到、跳到这个位置（第二入口 data-cap-secondary）。

declare function vcBlockKeyOf(reason: any): string
declare function vcPageDepthOf(pageId: any): number

export const VC_SHELL_STATES: string[] = ['empty', 'loading', 'error', 'disabled']
export const VC_SHELL_FORMS: string[] = ['inline', 'float', 'page']
export const VC_CONFIRM_SEGMENTS: string[] = ['what', 'wont', 'reversible', 'verb']

export const vcShellStateNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const state = VC_SHELL_STATES.indexOf(String(opts.state)) >= 0 ? String(opts.state) : 'empty'
  const kids: any[] = []
  const attrs: any = { className: 'vcs-state vcs-state-' + state, 'data-vc-state': state }
  if (state === 'error') attrs.role = 'alert'
  if (state === 'disabled') {
    // 禁用原因常驻：词条键来自写操作那层的同一张表（vcBlockKeyOf），不在这里另写一份理由文案。
    const reasonKey = opts.reasonKey ? String(opts.reasonKey) : vcBlockKeyOf(opts.reason)
    kids.push(h('span', { key: 'why', className: 'vcs-state-why', 'data-cap-why': reasonKey }, t(reasonKey)))
  } else if (state === 'loading') {
    // 加载态不把旧读数当新读数：显式标出读数是旧的，等新读数到了才替换。
    kids.push(h('span', { key: 'skel', className: 'vcs-state-skel', 'data-vc-old-read': '1' }, t('vc.shell.state.loading')))
  } else if (state === 'empty') {
    kids.push(h('span', { key: 'empty', className: 'vcs-state-empty' }, t('vc.shell.state.empty')))
    kids.push(h('span', { key: 'next', className: 'vcs-state-next' }, t('vc.shell.state.emptyNext')))
  } else {
    kids.push(h('span', { key: 'err', className: 'vcs-state-err' }, t('vc.shell.state.error')))
    kids.push(h('button', { key: 'retry', className: 'vcs-state-retry', type: 'button', 'data-vc-state-action': 'retry' }, t('vc.shell.state.retry')))
  }
  return h('div', attrs, kids)
}

export const vcShellFormNodes = function (h: any, t: any) {
  return VC_SHELL_FORMS.map(function (form: string) {
    return h('div', { key: form, className: 'vcs-form vcs-form-' + form, 'data-vc-form': form }, t('vc.shell.form.' + form))
  })
}

export const vcShellConfirmCardNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const verb = String(opts.verb || '')
  const target = String(opts.target || '')
  const segs = VC_CONFIRM_SEGMENTS.map(function (seg: string) {
    return h('p', { key: seg, className: 'vcs-confirm-seg', 'data-vc-confirm-seg': seg }, t('vc.shell.confirm.' + seg, { target: target }))
  })
  return h('div', {
    className: 'vcs-confirm',
    'data-vc-confirm': '1',
    role: 'dialog',
    'aria-modal': 'false',
    'aria-label': t('vc.shell.confirm.title', { verb: verb }),
  }, [
    h('h4', { key: 'title', className: 'vcs-confirm-title' }, t('vc.shell.confirm.title', { verb: verb })),
  ].concat(segs).concat([
    h('div', { key: 'acts', className: 'vcs-confirm-acts' }, [
      // 默认焦点在取消：危险动作不许一进来就停在确认键上。
      h('button', { key: 'cancel', type: 'button', className: 'vcs-confirm-cancel', 'data-vc-confirm-cancel': '1', 'data-focus-default': 'cancel' }, t('vc.shell.confirm.cancel')),
      h('button', { key: 'go', type: 'button', className: 'vcs-confirm-go' }, t('vc.shell.confirm.go', { verb: verb })),
    ]),
  ]))
}

export const vcShellResultNode = function (h: any, t: any, o: any) {
  const r = o || {}
  const fail = !!r.error
  const attrs: any = { className: 'vcs-result vcs-result-' + (fail ? 'fail' : 'ok'), 'data-vc-result': fail ? 'fail' : 'ok' }
  attrs.role = fail ? 'alert' : 'status'
  const kids: any[] = []
  if (fail) {
    // 失败：git 原话、环节名、期望与实际、上游原因，一样都不省。
    kids.push(h('p', { key: 'title', className: 'vcs-result-title' }, t('vc.shell.result.failTitle')))
    kids.push(h('p', { key: 'text', className: 'vcs-result-text' }, t('vc.shell.result.fail', {
      git: String(r.git || r.message || ''), step: String(r.step || ''),
      expected: String(r.expected || ''), actual: String(r.actual || ''), cause: String(r.cause || ''),
    })))
    kids.push(h('button', { key: 'retry', type: 'button', className: 'vcs-result-retry', 'data-vc-result-action': 'retry' }, t('vc.shell.result.retry')))
  } else {
    // 成功：git 子命令名、耗时、作用对象数，再加一句能接着做什么。
    kids.push(h('p', { key: 'title', className: 'vcs-result-title' }, t('vc.shell.result.okTitle')))
    kids.push(h('p', { key: 'text', className: 'vcs-result-text' }, t('vc.shell.result.ok', {
      cmd: String(r.cmd || ''), ms: String(r.ms || ''), n: String(r.n === undefined ? 0 : r.n),
    })))
    kids.push(h('p', { key: 'detail', className: 'vcs-result-detail' }, t('vc.shell.result.detail', { next: String(r.next || '') })))
  }
  return h('div', attrs, kids)
}

// 一条能力的主入口判定：终局形态决定画什么，没实现的不画假按钮。
export const vcCapabilitySurfaceKindOf = function (cap: any) {
  if (!cap) return 'note'
  if (cap.page === 'search') return 'palette'
  if (cap.finalForm === '说明') return 'note'
  if (cap.finalForm === '只读') return 'readonly'
  return 'pending'
}

export const vcShellSurfaceNode = function (h: any, t: any, o: any) {
  const cap = o && o.cap
  const kind = vcCapabilitySurfaceKindOf(cap)
  const kids: any[] = []
  if (cap) {
    kids.push(h('div', { key: 'head', className: 'vcs-surface-head' }, [
      h('span', { key: 'id', className: 'vcs-surface-id' }, String(cap.id)),
      h('span', { key: 'name', className: 'vcs-surface-name' }, String(cap.name || '')),
      h('span', { key: 'level', className: 'vcs-surface-level' }, t('vc.shell.cap.level') + ' ' + String(cap.level || '')),
      h('span', { key: 'form', className: 'vcs-surface-form' }, t('vc.shell.cap.form') + ' ' + String(cap.finalForm || '')),
    ]))
    if (cap.command) kids.push(h('code', { key: 'cmd', className: 'vcs-surface-cmd' }, String(cap.command)))
  }
  if (kind === 'palette') {
    kids.push(Object.assign({}, o.paletteNode, { key: 'palette' }))
  } else if (kind === 'note') {
    const note = String((cap && cap.panelPath) || t('vc.shell.cap.note'))
    kids.push(h('p', { key: 'note', className: 'vcs-surface-note', 'data-cap-main': 'note' }, note))
  } else if (kind === 'readonly') {
    kids.push(h('p', { key: 'ro', className: 'vcs-surface-note', 'data-cap-main': 'readonly' }, t('vc.shell.cap.readonly')))
  } else {
    kids.push(h('p', { key: 'pending', className: 'vcs-surface-pending', 'data-cap-pending': '1', 'data-cap-main': 'pending' }, t('vc.shell.cap.pending')))
  }
  return h('div', { className: 'vcs-surface', 'data-surface': cap ? String(cap.id) : '' }, kids)
}

// 能力行：整个行是主入口标记（data-cap-primary 每条能力恰好一处）。打开操作面 / 确认卡 / 结果
// 都画在这一行里 —— 结果因此永远是触发控件的后代（结果贴触发点）。
export const vcShellCapabilityRowNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const cap = opts.cap || {}
  const kids: any[] = [
    h('div', { key: 'head', className: 'vcs-cap-head' }, [
      h('span', { key: 'id', className: 'vcs-cap-id' }, String(cap.id || '')),
      h('span', { key: 'name', className: 'vcs-cap-name' }, String(cap.name || '')),
      h('span', { key: 'badges', className: 'vcs-cap-badges' }, String(cap.level || '') + ' · ' + String(cap.finalForm || '')),
    ]),
  ]
  if (cap.command) kids.push(h('code', { key: 'cmd', className: 'vcs-cap-cmd' }, String(cap.command)))
  if (!opts.surface) {
    kids.push(h('p', {
      key: 'pending',
      className: 'vcs-cap-pending',
      'data-cap-pending': '1',
    }, t('vc.shell.cap.pending')))
  } else {
    kids.push(Object.assign({}, vcShellSurfaceNode(h, t, { cap: cap, paletteNode: opts.paletteNode }), { key: 'surface' }))
  }
  if (opts.confirm) kids.push(Object.assign({}, vcShellConfirmCardNode(h, t, opts.confirm), { key: 'confirm' }))
  if (opts.result) kids.push(Object.assign({}, vcShellResultNode(h, t, opts.result), { key: 'result' }))
  return h('li', {
    key: String(cap.id || ''),
    className: 'vcs-cap',
    'data-cap-primary': String(cap.id || ''),
    'data-cap-row': String(cap.id || ''),
    'data-cap-form': String(cap.finalForm || ''),
  }, kids)
}
