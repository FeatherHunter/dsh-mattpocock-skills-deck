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
  // #1860 D6：选项收进菜单之后，非默认计划要在提交区留一句话 —— 否则收起菜单就不知道自己已经切成
  //   修订 / fixup / squash 或勾了跳过钩子。默认（只提交已暂存、三个开关全关）时这一句整块不画。
  const switched = options.filter(function (o: any) { return o.checked === true }).map(function (o: any) { return o.label })
  let planNote = ''
  if (plan.mode === 'all') planNote = t('vc.commit.planAll')
  else if (plan.mode === 'fixup' || plan.mode === 'squash') {
    const aim = target ? String(target.short || '') : ''
    planNote = aim === ''
      ? t('vc.commit.planFixupNoTarget', { mode: modeLabel(plan.mode) })
      : t('vc.commit.planFixup', { mode: modeLabel(plan.mode), target: aim })
  }
  if (switched.length > 0) planNote = [planNote, t('vc.commit.planSwitches', { list: switched.join(' / ') })].filter(function (s: string) { return s !== '' }).join('；')
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
    planNote: planNote, menuOpen: commit.menuOpen === true,
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

/** 提交页正文：定稿原型 62 的底部提交区（composer）。
 * 首屏只留四样东西：已暂存文件数与两个快捷入口、说明输入、底行提示与提交按钮。
 * 形态 / 目标 / 模板 / 三个开关收进「更多提交选项」折叠：它们在原型首屏没有位置，
 *   但每条都对应一条提交能力（2.5–2.8 等），不能在界面上消失，所以保留全部控件与 data-vc-commit-* 钩子；
 *   「原型提交区没有这块折叠」已写进 #1860 的偏差表。 */
export function vcCommitPageNode(h: any, t: any, o: any): any {
  const opts = o || {}
  const p = opts.panel || vcCommitPanelOf({ t: t, ui: opts.ui, reads: opts.reads, width: opts.width, nowMs: opts.nowMs, targets: opts.targets })
  const ops = opts.ops || null
  const changes: any = opts.changes || {}
  const counts: any = changes.counts || {}
  const files: any = changes.files || {}
  const handlers: any = changes.handlers || {}
  const stagedCount = Number(counts.staged || 0)
  const stagedRows: any[] = Array.isArray(files.staged) ? files.staged : []
  const handler = function (name: any) {
    const fn = ops && typeof ops[name] === 'function' ? ops[name] : null
    return fn
  }
  const click = function (name: any, arg?: any) {
    return function () { const fn = handler(name); if (fn) fn(arg) }
  }
  const children: any[] = []
  // 第一行：左边「N 个文件已暂存」，右边两个轻链接（取消全部暂存 / 储藏）。两者都只在真做得到时出现。
  const links: any[] = []
  if (stagedCount > 0) {
    links.push(h('button', {
      key: 'unstage-all', type: 'button', className: 'link-btn', 'data-vc-commit-unstage-all': 1,
      'data-press': 'button', 'data-log': 'vc.commit.unstage-all',
      onClick: function () { stagedRows.forEach(function (row: any) { if (handlers && typeof handlers.begin === 'function') handlers.begin('unstage', { path: String(row && row.path || '') }) }) },
    }, t('vc.changes.view.composerUnstageAll')))
  }
  if (typeof opts.onStash === 'function') {
    links.push(h('button', {
      key: 'stash', type: 'button', className: 'link-btn', 'data-vc-stash-op': 'push',
      title: t('vc.changes.view.composerStashHint'), 'data-press': 'button', 'data-log': 'vc.changes.composer.stash',
      onClick: function () { opts.onStash({ op: 'push' }) },
    }, t('vc.changes.view.composerStash')))
  }
  children.push(h('div', { key: 'head', className: 'composer-head' }, [
    h('span', { key: 'count', className: 'composer-count', 'data-vc-staged-count': String(stagedCount) }, t('vc.changes.view.composerCount', { n: String(stagedCount) })),
    links.length > 0 ? h('span', { key: 'links', className: 'composer-links' }, links) : null,
  ]))
  if (p.amendNote) children.push(h('div', { key: 'amend', className: 'note', 'data-vc-commit-amend-note': 1 }, p.amendNote))
  // 非默认计划的那一句话（#1860 D6）：收起菜单之后仍看得出这次提交的是什么。
  if (p.planNote) children.push(h('div', { key: 'planNote', className: 'composer-plan-note', 'data-vc-commit-plan-note': 1 }, p.planNote))
  // 多行说明：原型 62 的占位文字与说明都一样，换行原样写进提交；预览留在「更多提交选项」里。
  children.push(h('textarea', {
    key: 'msg', rows: 2, className: 'commit-input', value: p.message,
    placeholder: t('vc.changes.view.composerPlaceholder'), 'data-vc-commit-msg': 1, 'data-cap-control': '2.7',
    'aria-label': t('vc.commit.msgLabel'), 'aria-describedby': 'commit-hint',
    onChange: function (e: any) { const fn = handler('setMessage'); if (fn) fn(e && e.target ? e.target.value : '') },
  }))
  // 形态 / 目标 / 模板 / 三个开关 / 说明预览：原型首屏没有这些，收进折叠；控件与 data-vc-commit-* 钩子一个不少。
  const advanced: any[] = []
  advanced.push(h('div', { key: 'modes', className: 'vcs-commit-modes', role: 'radiogroup', 'aria-label': t('vc.commit.modeLabel') }, p.modes.map(function (m: any) {
    const kids: any[] = [h('span', { key: 'label' }, m.label)]
    if (m.disabled && m.tip) kids.push(h('span', { key: 'why', className: 'vcs-commit-why', 'data-cap-why': m.reasonKey }, m.tip))
    return h('button', {
      key: m.mode, type: 'button', className: 'vcs-commit-mode' + (m.selected ? ' is-on' : ''),
      'data-vc-commit-mode': m.mode, 'data-cap-control': m.cap, 'aria-pressed': m.selected === true, 'data-press': 'button', 'data-log': 'vc.commit.mode.' + String(m.mode),
      disabled: m.disabled === true, title: m.hint, onClick: click('selectMode', m.mode),
    }, kids)
  })))
  advanced.push(h('div', { key: 'hint', className: 'vcs-note', 'data-vc-commit-mode-hint': 1 }, p.modeHint))
  if (p.targetRow && p.targetRow.show) {
    advanced.push(h('div', { key: 'target', className: 'vcs-commit-target' }, [
      h('label', { key: 'label', 'data-vc-commit-target-label': 1 }, p.targetRow.label),
      h('select', {
        key: 'select', className: 'vcs-commit-target-select', value: p.targetRow.value,
        'data-vc-commit-target': 1, 'aria-label': p.targetRow.label,
        onChange: function (e: any) { const fn = handler('selectTarget'); if (fn) fn(e && e.target ? e.target.value : '') },
      }, [{ key: '', value: '' }].concat(p.targetRow.options).map(function (opt: any) {
        return h('option', { key: String(opt.oid || ''), value: String(opt.oid || '') }, String(opt.label || p.targetRow.placeholder))
      })),
      p.targetRow.problem ? h('span', { key: 'problem', className: 'vcs-commit-why', 'data-vc-commit-target-tip': 1 }, p.targetRow.problem) : null,
    ]))
  }
  advanced.push(h('pre', { key: 'preview', className: 'vcs-commit-preview', 'data-vc-commit-preview': 1, 'aria-label': t('vc.commit.msgPreview') }, p.preview))
  advanced.push(h('span', { key: 'msgHint', className: 'vcs-note', 'data-vc-commit-msg-hint': 1 }, t('vc.commit.msgHint')))
  const templateKids: any[] = [
    h('button', { key: 'apply', type: 'button', className: 'vcs-btn', 'data-vc-commit-template': 1, 'data-cap-control': '2.8', disabled: p.templateDisabled === true, 'data-press': 'button', 'data-log': 'vc.commit.template.apply', onClick: click('applyTemplate') }, t('vc.commit.action.applyTemplate')),
    h('span', { key: 'note', className: 'vcs-note', 'data-vc-commit-template-note': 1 }, p.templateNote),
  ]
  if (p.templateText) templateKids.push(h('pre', { key: 'text', className: 'vcs-commit-template-text', 'data-vc-template-text': 1 }, p.templateText))
  advanced.push(h('div', { key: 'template', className: 'vcs-commit-template' }, templateKids))
  advanced.push(h('div', { key: 'options', className: 'vcs-commit-options' }, p.options.map(function (opt: any) {
    return h('label', { key: opt.key, className: 'vcs-commit-opt' }, [
      h('input', { type: 'checkbox', checked: opt.checked === true, disabled: opt.disabled === true, 'data-vc-commit-opt': opt.key, 'data-cap-control': opt.cap, onChange: click('toggleOption', opt.key) }),
      h('span', { key: 'label' }, opt.label),
      h('span', { key: 'hint', className: 'vcs-note', 'data-vc-commit-opt-hint': opt.key }, opt.hint),
    ])
  })))
  if (p.trailerText) advanced.push(h('div', { key: 'trailer', className: 'vcs-note', 'data-vc-commit-trailer': 1 }, p.trailerText))

  // 最后一行：左边禁用原因或提示、中间交给 AI、右边提交按钮；原因与按钮说的是同一件事，不各占一行。
  // 定稿原型 62 在 0 个文件已暂存时左下角写的是「还没有暂存的文件」、按钮仍写「提交 0 个文件」；
  // 所以「什么都没暂存」优先于「说明还没填」，按钮文案始终带数量（只在执行中换成「提交中…」）。
  const foot: any[] = []
  const emptyReason: string = stagedCount === 0 ? t('vc.changes.view.commitNoStaged') : ''
  const footReason: string = emptyReason || (p.submitDisabled ? String(p.submitTip || '') : '')
  if (footReason) foot.push(h('span', { key: 'reason', className: 'composer-reason', 'data-vc-commit-submit-tip': 1 }, [
    h('svg', { key: 'icon', viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M12 4l9 16H3zM12 10v4M12 17v.5' })),
    h('span', { key: 'text' }, footReason),
  ]))
  else foot.push(h('span', { key: 'hint', className: 'hint-text' }, t('vc.changes.view.composerHint')))
  // 提交选项（#1860 D6）：原型提交区只有「已暂存计数 + 两个链接 / 说明框 / 底行」三块，
  //   所以提交形态、吸收目标、模板与三个开关不再占一行折叠，收进这颗小按钮的菜单里。
  foot.push(h('button', {
    key: 'options', type: 'button', className: 'composer-opt-btn' + (p.menuOpen ? ' is-open' : ''),
    'data-vc-commit-options': 1, 'aria-haspopup': 'menu', 'aria-expanded': p.menuOpen ? 'true' : 'false',
    'aria-label': t('vc.commit.options'), title: t('vc.commit.optionsHint'),
    'data-press': 'button', 'data-log': 'vc.commit.options',
    onClick: click('toggleMenu'),
  }, [h('span', { key: 'dots', className: 'row-more-dots', 'aria-hidden': 'true' }, '⋯')]))
  if (typeof opts.onOpenHandoff === 'function') {
    foot.push(h('button', {
      key: 'ai', type: 'button', className: 'ai-entry ai-entry-inline', 'data-vc-changes-handoff': 1, 'data-log': 'vc.ai.commit-split',
      title: t('vc.changes.view.aiSplit'), 'aria-label': t('vc.changes.view.aiSplit'), onClick: function () { opts.onOpenHandoff() },
    }, [
      h('svg', { key: 'icon', viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z' })),
      h('span', { key: 'label', className: 'ai-entry-label' }, t('vc.changes.view.aiSplit')),
    ]))
  }
  const submitTip = String(p.submitTip || '')
  const submitNode = h('button', {
    key: 'go', type: 'button', className: 'btn btn-primary btn-md', 'data-vc-commit-submit': 1,
    disabled: p.submitDisabled === true, 'aria-disabled': p.submitDisabled === true,
    'data-press': 'button', 'data-log': 'vc.commit.panel.submit', onClick: click('submit'),
  }, p.running ? t('vc.commit.running') : t('vc.changes.view.commitLabel', { n: String(stagedCount) }))
  // 悬停提示统一走 Tip 叶子（verify-no-title 门禁要求三处以上 title 抽组件）：原因已经写在左下角，这里只是补悬停。
  foot.push(submitTip ? h(Tip, { key: 'submit', content: submitTip }, submitNode) : submitNode)
  // 菜单挂在底行里、绝对定位浮在底行上方：它不占行高，展开也不把说明框与列表挤小。
  //   收起时用 hidden 留在 DOM 里（不是不画）：控件与 data-vc-commit-* 钩子一个不少，「每条能力恰有一个
  //   主入口」那几条门禁仍读得到；读屏与 Tab 不会进 hidden 的子树。
  foot.push(h('div', {
    key: 'optionsMenu', className: 'composer-opt-menu', role: 'menu', 'aria-label': t('vc.commit.options'),
    'data-vc-commit-menu': p.menuOpen ? 'open' : 'closed', hidden: p.menuOpen !== true,
  }, advanced))
  children.push(h('div', { key: 'foot', id: 'commit-hint', className: 'composer-foot' }, foot))
  // 结果条贴在提交按钮之后（= 触发点）：成功给命令与耗时，失败给原因与重试。
  //   位置跟着触发控件走，而不是浮到面板顶部（就近原则：结果贴着按下去的那颗按钮）。
  if (p.result) {
    const fail = p.result.state !== 'ok'
    const rel: any[] = [
      h('span', { key: 'tag', className: 'result-tag' }, t('vc.commit.panelTitle')),
      h('span', { key: 'text', className: 'result-text', 'data-vc-commit-result-text': 1 }, p.result.text),
    ]
    if (p.result.tip) rel.push(h('span', { key: 'tip', className: 'result-detail' }, p.result.tip))
    if (p.result.retry) rel.push(h('button', { key: 'retry', type: 'button', className: 'link-btn', 'data-vc-commit-retry': 1, 'data-press': 'button', 'data-log': 'vc.commit.retry', onClick: click('retry') }, t('vc.commit.result.retry')))
    children.push(h('div', { key: 'result', className: 'result ' + (fail ? 'result-error' : 'result-ok'), role: fail ? 'alert' : 'status', 'data-vc-commit-result': p.result.state }, rel))
  }
  if (p.confirm) children.push(vcCommitConfirmNode(h, t, { confirm: p.confirm, ops: ops }))
  if (p.formProblem) children.push(h('div', { key: 'formProblem', className: 'note', 'data-vc-commit-form-problem': 1 }, p.formProblem))
  return h('div', { className: 'composer', 'data-vc-commit-panel': 1, 'data-vc-page': 'changes', 'aria-label': t('vc.commit.panelTitle') }, children)
}