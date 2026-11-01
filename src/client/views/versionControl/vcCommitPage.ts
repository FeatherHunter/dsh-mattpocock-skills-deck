// views/versionControl/vcCommitPage.ts —— 提交页正文（#1743，规格 #1586 域 2）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
//
// 这一页要同时装下八条提交能力，每条恰好一个主入口：
//   2.1 / 2.2 / 2.3 / 2.4 四颗形态按钮（data-vc-commit-mode，data-cap-control 指到各自那条能力）；
//   2.5 跳过钩子、2.6 签名提交与追加签名行各一颗勾选框（两件事分开，各自能单勾）；
//   2.7 说明输入是多行 textarea（面板内写，不弹外部编辑器）；2.8 套用 commit.template 的按钮。
// 结果节点画在这个面板里（= 触发点），确认卡也贴在这里，不做居中模态。
declare const commitPlanOf: any
declare const commitPlanProblem: any
declare const commitTrailerOf: any
declare const VC_COMMIT_MODES: any
declare const VC_COMMIT_MODE_KEYS: any
declare const VC_COMMIT_MODE_CAPS: any
// 悬停提示统一走 Tip 叶子（verify-no-title 门禁要求 3 处及以上 title: 抽成组件）。
declare const Tip: any

/** 预检与执行的理由标识 → 界面词条键。词表在 config/copy/vcwrite.yaml，源码里不写中文字面量。 */
const VC_COMMIT_BLOCK_KEYS: any = {
  'need-commit-target': 'vc.block.needCommitTarget',
  'bad-commit-target': 'vc.block.badCommitTarget',
  'nothing-to-amend': 'vc.block.nothingToAmend',
  'signing-failed': 'vc.block.signingFailed',
  'nothing-staged': 'vc.block.nothingStaged',
  'conflicts-unresolved': 'vc.block.conflicts',
  'bare-repo': 'vc.block.bareRepo',
  'detached-head': 'vc.block.detachedHead',
  'mid-merge': 'vc.block.midOperation',
  'mid-rebase': 'vc.block.midOperation',
  'mid-cherry-revert': 'vc.block.midOperation',
}

/** 理由标识 → 词条键；认不出的理由统一落到「这一步现在做不了」，不把标识直接显示给人。 */
export function commitBlockKeyOf(reason: any): string {
  const key = String(reason === undefined || reason === null ? '' : reason)
  return VC_COMMIT_BLOCK_KEYS[key] || 'vc.block.unknown'
}

/** 提交形态的界面词条后缀：确认卡四段按形态取不同原文。 */
function commitModeSuffix(mode: any): string {
  if (mode === 'amend') return 'Amend'
  if (mode === 'fixup' || mode === 'squash') return 'Fixup'
  return ''
}

/** 把界面状态算成一份可直接画的模型：面板节点只做渲染，判定、禁用原因、确认原文都在这里定。 */
export function vcCommitPanelOf(o: any): any {
  const opts = o || {}
  const t = opts.t
  const ui = opts.ui || {}
  const commit = ui.commit || {}
  const plan = commitPlanOf(commit.plan)
  const form = commit.form || null
  const decision = commit.decision || null
  const message = String(commit.message === undefined || commit.message === null ? '' : commit.message)
  const trailer = form ? commitTrailerOf(form.identity || {}) : ''
  const targets = Array.isArray(opts.targets) ? opts.targets : []
  const running = commit.state === 'running'
  const amendReady = !!(form && form.amend && form.amend.available === true)
  const noHead = !!(form && form.amend && form.amend.available === false)
  const modeLabel = function (mode: any): string { return t(VC_COMMIT_MODE_KEYS[mode] || 'vc.commit.mode.staged') }
  const blockedReason = commitPlanProblem(commit.plan)
    || (decision && decision.verdict === 'block'
      ? String((decision.reasons || []).filter(function (r: any) { return r !== 'ok' })[0] || '')
      : '')
  const blockedKey = blockedReason ? commitBlockKeyOf(blockedReason) : ''
  const needsMessage = message.trim() === '' && plan.mode !== 'amend' && plan.mode !== 'fixup'
  const msgProblemKey = needsMessage ? 'vc.commitArea.needMessage' : ''
  const modes = VC_COMMIT_MODES.map(function (mode: any) {
    const disabled = (mode === 'amend' || mode === 'fixup' || mode === 'squash') && noHead
    return {
      mode: mode, cap: VC_COMMIT_MODE_CAPS[mode], selected: plan.mode === mode, disabled: disabled,
      label: modeLabel(mode), hint: t('vc.commit.mode.hint.' + mode),
      reasonKey: disabled ? 'vc.block.nothingToAmend' : '',
      tip: disabled ? t('vc.block.nothingToAmend') : '',
    }
  })
  const target = targets.filter(function (c: any) { return c && c.oid === plan.target })[0] || null
  const targetRow = (plan.mode === 'fixup' || plan.mode === 'squash')
    ? {
      show: true, label: t('vc.commit.targetLabel'), value: plan.target,
      placeholder: t('vc.commit.targetPlaceholder'),
      problem: plan.target === '' ? t('vc.block.needCommitTarget') : '',
      options: targets.map(function (c: any) {
        return { oid: String(c.oid || ''), label: String(c.short || '') + ' ' + String(c.subject || '') }
      }),
    }
    : { show: false }
  const template = (form && form.template) || null
  const templateDisabled = running || !template || template.configured !== true || !!template.problem || !String(template.text || '')
  let templateNote = ''
  if (!form) templateNote = ''
  else if (!template || template.configured !== true) templateNote = t('vc.commit.templateNone')
  else if (template.problem) templateNote = t('vc.commit.templateMissing', { path: String(template.path || '') })
  else templateNote = t('vc.commit.templateHint', { path: String(template.path || '') })
  const signing = (form && form.signing) || null
  const signNoKey = !!signing && String(signing.key || '') === ''
  const preview = message + (plan.signoff && trailer ? (message === '' ? '' : '\n\n') + trailer : '')
  const options = [
    { key: 'skipHooks', cap: '2.5', label: t('vc.commit.opt.skipHooks'), hint: t('vc.commit.opt.skipHooksHint'), checked: plan.skipHooks === true, disabled: running },
    { key: 'sign', cap: '2.6', label: t('vc.commit.opt.sign'), hint: signNoKey ? t('vc.commit.opt.signNoKey') : (signing ? t('vc.commit.opt.signHint', { format: String(signing.format || 'openpgp'), key: String(signing.key || '') }) : t('vc.commit.opt.signHint', { format: 'openpgp', key: '' })), checked: plan.sign === true, disabled: running || signNoKey },
    { key: 'signoff', cap: '2.6', label: t('vc.commit.opt.signoff'), hint: trailer ? t('vc.commit.opt.signoffHint', { trailer: trailer }) : t('vc.commit.opt.signoffNoIdentity'), checked: plan.signoff === true, disabled: running || trailer === '' },
  ]
  const submitDisabled = running || !!blockedKey || !!msgProblemKey
  const submitTip = blockedKey ? t(blockedKey) : (msgProblemKey ? t(msgProblemKey) : '')
  let amendNote = ''
  if (form && form.amend) {
    if (plan.mode === 'amend' && form.amend.available === true) amendNote = t('vc.commit.amendPrefill', { oid: String(form.amend.short || ''), subject: String(form.amend.subject || '') })
    else if (noHead && plan.mode === 'amend') amendNote = t('vc.commit.amendNoHead')
  }
  const confirm = commit.confirm
    ? (function () {
      const suffix = commitModeSuffix(plan.mode)
      const params: any = { mode: modeLabel(plan.mode), oid: String((form && form.amend && form.amend.short) || ''), target: target ? String(target.short || '') : plan.target }
      return {
        segments: [
          { seg: 'what', text: t('vc.commit.confirm.what' + suffix, params) },
          { seg: 'wont', text: t('vc.commit.confirm.wont' + suffix, params) },
          { seg: 'reversible', text: t('vc.commit.confirm.reversible', params) },
          { seg: 'verb', text: t('vc.commit.confirm.verb' + suffix, params) },
        ],
        trailerText: trailer ? t('vc.commit.confirm.trailer', { trailer: trailer }) : '',
        messageText: t('vc.commit.confirm.commitMsg', { message: message === '' ? t('vc.commit.confirm.emptyMsg') : message }),
        cancelText: t('vc.commit.confirm.cancel'),
        goText: t('vc.commit.confirm.go', { mode: modeLabel(plan.mode) }),
      }
    })()
    : null
  let result: any = null
  if (commit.result) {
    const r = commit.result
    if (r.state === 'ok') {
      result = { state: 'ok', retry: false, tip: '', text: t(plan.mode === 'amend' ? 'vc.commit.result.okAmend' : 'vc.commit.result.ok', { mode: modeLabel(plan.mode), ms: Number(r.ms || 0), cmd: String(r.cmd || 'commit') }) }
    } else {
      const reasonKey = r.reason ? commitBlockKeyOf(r.reason) : ''
      const extra = [String(r.message || ''), reasonKey ? t(reasonKey) : ''].filter(function (s: string) { return s !== '' }).join(': ')
      result = { state: 'fail', retry: true, tip: String(r.hint || ''), text: t('vc.commit.result.fail', { mode: modeLabel(plan.mode), ms: Number(r.ms || 0) }) + (extra ? ': ' + extra : '') }
    }
  }
  return {
    mode: plan.mode, modeLabel: modeLabel(plan.mode), modeHint: t('vc.commit.mode.hint.' + plan.mode),
    modes: modes, targetRow: targetRow, message: message, preview: preview,
    templateDisabled: templateDisabled, templateNote: templateNote,
    templateText: (!templateDisabled && template) ? String(template.text || '').slice(0, 2000) : '',
    options: options, trailer: trailer, trailerText: trailer ? t('vc.commit.confirm.trailer', { trailer: trailer }) : '',
    submitDisabled: submitDisabled, submitTip: submitTip, running: running,
    confirm: confirm, amendNote: amendNote, amendOid: String((form && form.amend && form.amend.short) || ''),
    formProblem: String(commit.formProblem || ''), result: result,
  }
}

/** 确认卡（贴触发点，不做居中模态）：固定四段 + 将写入的原文 + 默认焦点在取消。 */
export function vcCommitConfirmNode(h: any, t: any, o: any): any {
  const c = o.confirm || {}
  const click = function (name: any) {
    const fn = o.ops && typeof o.ops[name] === 'function' ? o.ops[name] : null
    return function () { if (fn) fn() }
  }
  const kids: any[] = [{ key: 'title', className: 'vcs-confirm-title' }, h('div', { key: 'segments', className: 'vcs-confirm-segments' }, (c.segments || []).map(function (seg: any) {
    return h('div', { key: seg.seg, className: 'vcs-confirm-seg', 'data-vc-commit-seg': seg.seg }, seg.text)
  }))]
  kids[0] = h('div', { key: 'title', className: 'vcs-confirm-title' }, t('vc.commit.panelTitle'))
  if (c.trailerText) kids.push(h('div', { key: 'trailer', className: 'vcs-note', 'data-vc-commit-confirm-trailer': 1 }, c.trailerText))
  if (c.messageText) kids.push(h('pre', { key: 'message', className: 'vcs-confirm-msg', 'data-vc-commit-confirm-msg': 1 }, c.messageText))
  kids.push(h('div', { key: 'actions', className: 'vcs-confirm-actions' }, [
    h('button', { key: 'cancel', type: 'button', className: 'vcs-btn', 'data-vc-confirm-cancel': 1, 'data-focus-default': 'cancel', 'data-press': 'button', 'data-log': 'vc.commit.confirm.cancel', onClick: click('cancelConfirm') }, c.cancelText || ''),
    h('button', { key: 'go', type: 'button', className: 'vcs-btn is-danger', 'data-vc-confirm-go': 1, 'data-press': 'button', 'data-log': 'vc.commit.confirm.go', onClick: click('confirmNow') }, c.goText || ''),
  ]))
  return h('div', { key: 'confirm', className: 'vcs-confirm', role: 'dialog', 'aria-modal': 'false', 'data-vc-confirm': '1', 'data-vc-commit-confirm': 1 }, kids)
}

/** 提交页正文：形态 → 参数 → 多行说明 → 模板 → 三个开关 → 提交按钮 → 确认卡 → 结果。 */
export function vcCommitPageNode(h: any, t: any, o: any): any {
  const opts = o || {}
  const p = opts.panel || vcCommitPanelOf({ t: t, ui: opts.ui, reads: opts.reads, width: opts.width, nowMs: opts.nowMs, targets: opts.targets })
  const ops = opts.ops || null
  const handler = function (name: any) {
    const fn = ops && typeof ops[name] === 'function' ? ops[name] : null
    return fn
  }
  const click = function (name: any, arg?: any) {
    return function () { const fn = handler(name); if (fn) fn(arg) }
  }
  const children: any[] = []
  children.push(h('div', { key: 'head', className: 'vcs-page-meta' }, [
    h('span', { key: 'title', className: 'vcs-page-title', 'data-vc-commit-title': 1 }, t('vc.commit.panelTitle')),
    h('span', { key: 'hint', className: 'vcs-note', 'data-vc-commit-mode-hint': 1 }, p.modeHint),
  ]))
  if (p.amendNote) children.push(h('div', { key: 'amend', className: 'vcs-note', 'data-vc-commit-amend-note': 1 }, p.amendNote))
  children.push(h('div', { key: 'modes', className: 'vcs-commit-modes', role: 'radiogroup', 'aria-label': t('vc.commit.modeLabel') }, p.modes.map(function (m: any) {
    const kids: any[] = [h('span', { key: 'label' }, m.label)]
    if (m.disabled && m.tip) kids.push(h('span', { key: 'why', className: 'vcs-commit-why', 'data-cap-why': m.reasonKey }, m.tip))
    return h('button', {
      key: m.mode, type: 'button', className: 'vcs-commit-mode' + (m.selected ? ' is-on' : ''),
      'data-vc-commit-mode': m.mode, 'data-cap-control': m.cap, 'aria-pressed': m.selected === true, 'data-press': 'button', 'data-log': 'vc.commit.mode.' + String(m.mode),
      disabled: m.disabled === true, title: m.hint, onClick: click('selectMode', m.mode),
    }, kids)
  })))
  if (p.targetRow && p.targetRow.show) {
    children.push(h('div', { key: 'target', className: 'vcs-commit-target' }, [
      h('label', { key: 'label', 'data-vc-commit-target-label': 1 }, p.targetRow.label),
      h('select', {
        key: 'select', className: 'vcs-commit-target-select', value: p.targetRow.value,
        'data-vc-commit-target': 1, 'aria-label': p.targetRow.label,
        onChange: function (e: any) { const fn = handler('selectTarget'); if (fn) fn(e && e.target ? e.target.value : '') },
      }, [{ key: '', value: '' }, p.targetRow.options].flat().map(function (opt: any) {
        return h('option', { key: String(opt.oid || ''), value: String(opt.oid || '') }, String(opt.label || p.targetRow.placeholder))
      })),
      p.targetRow.problem ? h('span', { key: 'problem', className: 'vcs-commit-why', 'data-vc-commit-target-tip': 1 }, p.targetRow.problem) : null,
    ]))
  }
  children.push(h('div', { key: 'msg', className: 'vcs-commit-msg' }, [
    h('label', { key: 'label', 'data-vc-commit-msg-label': 1 }, t('vc.commit.msgLabel')),
    h('textarea', {
      key: 'area', rows: 6, className: 'vcs-commit-area', value: p.message,
      placeholder: t('vc.commit.msgPlaceholder'), 'data-vc-commit-msg': 1, 'data-cap-control': '2.7',
      'aria-label': t('vc.commit.msgLabel'), onChange: function (e: any) { const fn = handler('setMessage'); if (fn) fn(e && e.target ? e.target.value : '') },
    }),
    h('span', { key: 'hint', className: 'vcs-note' }, t('vc.commit.msgHint')),
  ]))
  children.push(h('pre', { key: 'preview', className: 'vcs-commit-preview', 'data-vc-commit-preview': 1, 'aria-label': t('vc.commit.msgPreview') }, p.preview))
  const templateKids: any[] = [
    h('button', { key: 'apply', type: 'button', className: 'vcs-btn', 'data-vc-commit-template': 1, 'data-cap-control': '2.8', disabled: p.templateDisabled === true, 'data-press': 'button', 'data-log': 'vc.commit.template.apply', onClick: click('applyTemplate') }, t('vc.commit.action.applyTemplate')),
    h('span', { key: 'note', className: 'vcs-note', 'data-vc-commit-template-note': 1 }, p.templateNote),
  ]
  if (p.templateText) templateKids.push(h('pre', { key: 'text', className: 'vcs-commit-template-text', 'data-vc-template-text': 1 }, p.templateText))
  children.push(h('div', { key: 'template', className: 'vcs-commit-template' }, templateKids))
  children.push(h('div', { key: 'options', className: 'vcs-commit-options' }, p.options.map(function (opt: any) {
    return h('label', { key: opt.key, className: 'vcs-commit-opt' }, [
      h('input', { type: 'checkbox', checked: opt.checked === true, disabled: opt.disabled === true, 'data-vc-commit-opt': opt.key, 'data-cap-control': opt.cap, onChange: click('toggleOption', opt.key) }),
      h('span', { key: 'label' }, opt.label),
      h('span', { key: 'hint', className: 'vcs-note', 'data-vc-commit-opt-hint': opt.key }, opt.hint),
    ])
  })))
  if (p.trailerText) children.push(h('div', { key: 'trailer', className: 'vcs-note', 'data-vc-commit-trailer': 1 }, p.trailerText))
  children.push(h('div', { key: 'submit', className: 'vcs-commit-actions' }, [
    h(Tip, { key: 'go', content: String(p.submitTip || '') }, h('button', { key: 'go', type: 'button', className: 'vcs-btn is-primary', 'data-vc-commit-submit': 1, disabled: p.submitDisabled === true, 'aria-disabled': p.submitDisabled === true, 'data-press': 'button', 'data-log': 'vc.commit.panel.submit', onClick: click('submit') }, p.running ? t('vc.commit.running') : t('vc.commit.action.submit'))),
    p.submitTip ? h('span', { key: 'tip', className: 'vcs-commit-why', 'data-vc-commit-submit-tip': 1 }, p.submitTip) : null,
  ]))
  if (p.confirm) children.push(vcCommitConfirmNode(h, t, { confirm: p.confirm, ops: ops }))
  if (p.result) {
    const rel: any[] = [h('span', { key: 'text', 'data-vc-commit-result-text': 1 }, p.result.text)]
    if (p.result.tip) rel.push(h('span', { key: 'tip', className: 'vcs-note' }, p.result.tip))
    if (p.result.retry) rel.push(h('button', { key: 'retry', type: 'button', className: 'vcs-btn', 'data-vc-commit-retry': 1, 'data-press': 'button', 'data-log': 'vc.commit.retry', onClick: click('retry') }, t('vc.commit.result.retry')))
    children.push(h('div', { key: 'result', className: 'vcs-commit-result', role: p.result.state === 'ok' ? 'status' : 'alert', 'data-vc-commit-result': p.result.state }, rel))
  }
  if (p.formProblem) children.push(h('div', { key: 'formProblem', className: 'vcs-note', 'data-vc-commit-form-problem': 1 }, p.formProblem))
  return h('section', { className: 'vcs-commit-panel', 'data-vc-commit-panel': 1, 'data-vc-page': 'changes', 'aria-label': t('vc.commit.panelTitle') }, children)
}
