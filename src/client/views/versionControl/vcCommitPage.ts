// views/versionControl/vcCommitPage.ts —— 提交页正文（#1743，规格 #1586 域 2；#1877 按原型补齐提交选项）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
//
// 这一页要同时装下八条提交能力，每条恰好一个主入口：
//   2.1 提交按钮本身（提交 N 个文件）；2.2–2.6、2.8 收在提交按钮右侧箭头打开的「提交选项」里
//   （内容来源、提交形态、提交说明模板、三个记录方式）；2.7 是多行说明 textarea（面板内写，不弹外部编辑器）。
// 为什么 2.2 从「形态」挪成「内容来源」开关：它决定这次提交收哪些改动，和「这次提交以什么形态记下来」
//   是两件事；原型把两者画成两组，共享计划里也必须是两个字段（见 commit-plan.ts 的 all）。#1877 之前
//   界面把 -a 冒充成第五种形态，读者要在五颗互斥按钮里理解一件可以同时成立的事。
// 结果节点画在这个面板里（= 触发点），确认卡也贴在这里，不做居中模态。
declare const commitPlanOf: any
declare const commitPlanProblem: any
declare const commitTrailerOf: any
// #1877：自动说明与修订预填的口径与动作层共用一份（拿掉重复拼前缀的地方）。
declare const commitAutoMessageOf: any
declare const commitAmendMessageOf: any
declare const VC_COMMIT_MODES: any
declare const VC_COMMIT_MODE_KEYS: any
declare const VC_COMMIT_MODE_CAPS: any
// 提交选项展开区（形态、内容来源、说明模板、记录方式）住在独立叶子里；本文件只备数据与提交区骨架。
declare const vcCommitOptionsNode: any
// #1905：提交区储藏拆分按钮的渲染在 vcCommitOptions 叶里（构建时拼进同一个闭包，这里只声明形状）。
declare const vcComposerStashSplitOf: any
// #1905：储藏拆分按钮里「只储藏已暂存的改动」（7.3）要 git 2.35 以上。版本读数与版本门口径
// 与储藏页共用同一份（vcStashOps 的这两个函数），这里只拿来决定画按钮还是画版本门说明——
// 「藏起来不等于沉默」是既有产品规矩：低于 2.35 时按钮不画，但要写清为什么与替代做法。
declare function vcStashVersionTextOf(reads: any): string
declare function vcStashStagedStateOf(versionText: any): any
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

/** 主按钮上的字：原型让它跟着形态变，读者不点开提交选项也知道这一下会做什么。 */
function commitPrimaryKeyOf(mode: any): string {
  if (mode === 'amend') return 'vc.commit.primary.amend'
  if (mode === 'fixup') return 'vc.commit.primary.fixup'
  if (mode === 'squash') return 'vc.commit.primary.squash'
  return ''
}

/** 只暂存了一部分的文件：同时出现在两组里，提交只会带上它已进索引的那几块。
 *  这个数只用来写提交区那一句提示——计数本身仍按 git 的已暂存文件数（它才是这次提交会带上的文件）。 */
function commitPartialCountOf(changes: any): number {
  const files = (changes && changes.files) || {}
  const staged: any[] = Array.isArray(files.staged) ? files.staged : []
  const unstaged: any[] = Array.isArray(files.unstaged) ? files.unstaged : []
  const both: any = {}
  for (let i = 0; i < unstaged.length; i += 1) both[String((unstaged[i] || {}).path || '')] = true
  let n = 0
  for (let i = 0; i < staged.length; i += 1) if (both[String((staged[i] || {}).path || '')] === true) n += 1
  return n
}

/** 2.2 的「一起提交」会额外收进多少个文件：只数已跟踪、非冲突的未暂存行。
 *  未跟踪的新文件不在 git commit -a 的范围里，数进来会让人以为它们也会被提交。 */
function commitTrackedCountOf(changes: any): number {
  const files = (changes && changes.files) || {}
  const rows: any[] = Array.isArray(files.unstaged) ? files.unstaged : []
  let n = 0
  for (let i = 0; i < rows.length; i += 1) {
    const row: any = rows[i] || {}
    const untracked = row.untracked === true || String(row.change || '') === 'untracked'
    if (!untracked && row.conflict !== true) n += 1
  }
  return n
}

/** 把界面状态算成一份可直接画的模型：面板节点只做渲染，判定、禁用原因、确认原文都在这里定。 */
export function vcCommitPanelOf(o: any): any {
  const opts = o || {}
  const t = opts.t
  const ui = opts.ui || {}
  const commit = ui.commit || {}
  const plan = commitPlanOf(commit.plan)
  const formRead = commit.form || null
  const head = formRead && formRead.amend && formRead.amend.available === true ? formRead.amend : null
  const noHead = !!formRead && !head
  const headOid = head ? String(head.oid || '') : ''
  const headSubject = head ? String(head.subject || '') : ''
  const stagedCount = Number(((opts.changes || {}).counts || {}).staged || 0)
  const partialCount = commitPartialCountOf(opts.changes)
  const trackedCount = commitTrackedCountOf(opts.changes)
  const allTracked = plan.all === true
  const effectiveCount = stagedCount + (allTracked ? trackedCount : 0)
  const message = String(commit.message === undefined || commit.message === null ? '' : commit.message)
  // fixup 与 squash 的说明由面板按前缀自动写成：原型把输入框换成一行只读说明，读者不用再手写一句。
  const autoMessage = commitAutoMessageOf(plan, head)
  const effectiveMessage = autoMessage !== '' ? autoMessage : message
  const editable = plan.mode === 'staged' || plan.mode === 'amend'
  const trailer = formRead ? commitTrailerOf(formRead.identity || {}) : ''
  const running = commit.state === 'running'
  const modeLabel = function (mode: any): string { return t(VC_COMMIT_MODE_KEYS[mode] || 'vc.commit.mode.staged') }
  const decision = commit.decision || null
  // 面板判定用的计划：fixup / squash 的吸收目标按原型固定为「上一条提交」，所以先补上目标再校验；
  // 表单还没读回来时不知道有没有上一条，这一条先不判（否则会把「还没读到」说成「没选目标」）。
  const fixupish = plan.mode === 'fixup' || plan.mode === 'squash'
  const planForCheck = Object.assign({}, commit.plan, fixupish ? { target: headOid } : {})
  const planProblem = (!formRead && fixupish) ? '' : (commitPlanProblem(planForCheck) || '')
  const decisionReason = decision && decision.verdict === 'block'
    ? String((decision.reasons || []).filter(function (r: any) { return r !== 'ok' })[0] || '')
    : ''
  const blockedKey = planProblem ? commitBlockKeyOf(planProblem) : (decisionReason ? commitBlockKeyOf(decisionReason) : '')
  // 禁用原因按原型次序判定：没有可修订的提交 → 计划本身不成立 → 预检拦住 → 没有可提交的内容 →
  // 没写说明 → 修订既没新内容也没改说明。每条都说出「为什么现在点不了」，不让人去猜。
  let reasonKey = ''
  // 没有上一条提交只影响需要它的三种形态；「新提交」在空仓库里照样能提交（第一条提交不能因此被挡住）。
  if (noHead && plan.mode !== 'staged') reasonKey = 'vc.block.nothingToAmend'
  else if (blockedKey) reasonKey = blockedKey
  else if (plan.mode !== 'amend' && effectiveCount === 0) reasonKey = 'vc.changes.view.commitNoStaged'
  else if (effectiveMessage.trim() === '') reasonKey = 'vc.commitArea.needMessage'
  else if (plan.mode === 'amend' && head && effectiveCount === 0 && message.trim() === commitAmendMessageOf(head).trim()) reasonKey = 'vc.commit.reason.amendUnchanged'
  const reasonText = reasonKey ? t(reasonKey) : ''
  // 底部那一行：能提交时说的是「这次提交会怎么做」，不能提交时说的是「为什么不能」。
  let hintText = ''
  if (plan.mode === 'amend') hintText = effectiveCount === 0 ? t('vc.commit.hint.amendEditOnly') : t('vc.commit.hint.amendWithContent')
  else if (plan.mode === 'fixup') hintText = t('vc.commit.hint.fixup')
  else if (plan.mode === 'squash') hintText = t('vc.commit.hint.squash')
  else if (allTracked) hintText = t('vc.commit.hint.allTracked', { n: String(trackedCount) })
  // 只暂存了一部分的文件：提交会带上它已进索引的那几块。这句话要写在提交区，因为顶部「已暂存」按整份文件数，
  //   不把部分暂存算进去；不说清楚，读者会以为底部说「1 个文件已暂存」和顶部「已暂存 0」是两回事。
  else if (partialCount > 0) hintText = t('vc.changes.view.partialHint', { n: String(partialCount) })
  else hintText = t('vc.changes.view.composerHint')
  const submitDisabled = running || reasonKey !== ''
  const formNoteKey = function (mode: any): string { return 'vc.commit.formNote.' + mode }
  const forms = VC_COMMIT_MODES.map(function (mode: any) {
    const formDisabled = (mode === 'amend' || mode === 'fixup' || mode === 'squash') && noHead
    return {
      form: mode, cap: VC_COMMIT_MODE_CAPS[mode], selected: plan.mode === mode, disabled: formDisabled,
      label: modeLabel(mode),
      reasonKey: formDisabled ? 'vc.block.nothingToAmend' : '',
      tip: formDisabled ? t('vc.block.nothingToAmend') : t(formNoteKey(mode)),
    }
  })
  // 形态那一组的说明：原型在选中的形态下面写「这种形态是什么」，修订与吸收提交再补一句作用对象；
  // 没有上一条提交时那句话换成「还没有可以修订的提交」。
  const formNote = plan.mode === 'staged'
    ? t(formNoteKey(plan.mode))
    : (head
      ? t('vc.commit.formNoteWithTarget', { note: t(formNoteKey(plan.mode)), short: String(head.short || ''), subject: headSubject })
      : t('vc.commit.formNoteNoTarget', { note: t(formNoteKey(plan.mode)), none: t('vc.commit.targetNone') }))
  const template = (formRead && formRead.template) || null
  const templateDisabled = running || !template || template.configured !== true || !!template.problem || !String(template.text || '')
  let templateNote = ''
  if (!formRead) templateNote = ''
  else if (!template || template.configured !== true) templateNote = t('vc.commit.templateNone')
  else if (template.problem) templateNote = t('vc.commit.templateMissing', { path: String(template.path || '') })
  else templateNote = t('vc.commit.templateHint', { path: String(template.path || '') })
  const templatePath = String((template && template.path) || '')
  const templateName = templatePath.indexOf('/') >= 0 ? templatePath.slice(templatePath.lastIndexOf('/') + 1) : templatePath
  const templateApplied = commit.templateApplied === true
  const templateLabel = templateApplied
    ? t('vc.commit.templateAppliedUndo')
    : (templateName !== '' ? t('vc.commit.templateApplyPath', { name: templateName }) : t('vc.commit.templateApplyNone'))
  const signing = (formRead && formRead.signing) || null
  const signNoKey = !!signing && String(signing.key || '') === ''
  const options = [
    { key: 'skipHooks', cap: '2.5', label: t('vc.commit.opt.skipHooks'), hint: t('vc.commit.opt.skipHooksHint'), checked: plan.skipHooks === true, disabled: running },
    { key: 'sign', cap: '2.6', label: t('vc.commit.opt.sign'), hint: signNoKey ? t('vc.commit.opt.signNoKey') : (signing ? t('vc.commit.opt.signHint', { format: String(signing.format || 'openpgp'), key: String(signing.key || '') }) : t('vc.commit.opt.signHint', { format: 'openpgp', key: '' })), checked: plan.sign === true, disabled: running || signNoKey },
    { key: 'signoff', cap: '2.6', label: t('vc.commit.opt.signoff'), hint: trailer ? t('vc.commit.opt.signoffHint', { trailer: trailer }) : t('vc.commit.opt.signoffNoIdentity'), checked: plan.signoff === true, disabled: running || trailer === '' },
  ]
  // 收起展开区之后，三个记录方式在别处看不出来：名字与后果一起做成贴着提交按钮的小标签，
  // 触发器自己的说明里也写着「已开启：…」，读者不用重新点开就知道这一次提交会跳检查、带签名行。
  const flags = options.filter(function (one: any) { return one.checked === true }).map(function (one: any) {
    return { key: one.key, label: one.label, hint: one.hint, tone: one.key === 'skipHooks' ? 'chip-warn' : 'chip-info' }
  })
  const flagNames = flags.map(function (one: any) { return one.label }).join(t('vc.commit.listSeparator'))
  const confirm = commit.confirm
    ? (function () {
      const suffix = commitModeSuffix(plan.mode)
      const params: any = { mode: modeLabel(plan.mode), oid: String((formRead && formRead.amend && formRead.amend.short) || ''), target: headOid || plan.target }
      return {
        segments: [
          { seg: 'what', text: t('vc.commit.confirm.what' + suffix, params) },
          { seg: 'wont', text: t('vc.commit.confirm.wont' + suffix, params) },
          { seg: 'reversible', text: t('vc.commit.confirm.reversible', params) },
          { seg: 'verb', text: t('vc.commit.confirm.verb' + suffix, params) },
        ],
        trailerText: trailer ? t('vc.commit.confirm.trailer', { trailer: trailer }) : '',
        messageText: t('vc.commit.confirm.commitMsg', { message: effectiveMessage === '' ? t('vc.commit.confirm.emptyMsg') : effectiveMessage }),
        cancelText: t('vc.commit.confirm.cancel'),
        goText: t('vc.commit.confirm.go', { mode: modeLabel(plan.mode) }),
      }
    })()
    : null
  let result: any = null
  if (commit.result) {
    const r = commit.result
    // 结果说的必须是「刚才那一下是什么形态」：提交成功后界面会把形态归零成「新提交」，
    //   再按当前形态读，修订的回执就会被写成「提交完成（新提交）」。形态跟着这条结果走，不跟界面状态走。
    const resultMode = r.mode || plan.mode
    if (r.state === 'ok') {
      const headShort = String(r.headAfter || '').slice(0, 7)
      const base = t(resultMode === 'amend' ? 'vc.commit.result.okAmend' : 'vc.commit.result.ok', { mode: modeLabel(resultMode), ms: Number(r.ms || 0), cmd: String(r.cmd || 'commit') })
      result = { state: 'ok', retry: false, tip: '', text: base + (headShort !== '' ? '；' + t('vc.commit.result.headShort', { oid: headShort }) : '') }
    } else {
      const reasonTextOf = r.reason ? t(commitBlockKeyOf(r.reason)) : ''
      const extra = [String(r.message || ''), reasonTextOf].filter(function (s: string) { return s !== '' }).join(': ')
      result = { state: 'fail', retry: true, tip: String(r.hint || ''), text: t('vc.commit.result.fail', { mode: modeLabel(resultMode), ms: Number(r.ms || 0) }) + (extra ? ': ' + extra : '') }
    }
  }
  // #1905：储藏拆分按钮里「只储藏已暂存的改动」（7.3）要 git 2.35 以上。版本读数与储藏页共用
  // 同一份口径（vcStashOps）；低于 2.35 时这一行不画按钮、改画版本门说明——「藏起来不等于沉默」。
  const stashVersionText = typeof vcStashVersionTextOf === 'function' ? vcStashVersionTextOf(opts.reads || {}) : ''
  const stashStaged = typeof vcStashStagedStateOf === 'function' ? vcStashStagedStateOf(stashVersionText) : { state: 'ok' }
  return {
    form: plan.mode, formNote: formNote,
    stashStaged: stashStaged,
    forms: forms,
    allTracked: allTracked, allTrackedCount: trackedCount,
    optionsOpen: commit.menuOpen === true,
    triggerLabel: flags.length > 0 ? t('vc.commit.optionsOn', { list: flagNames }) : t('vc.commit.options'),
    triggerHint: flags.length > 0 ? t('vc.commit.optionsHintOn', { list: flagNames }) : t('vc.commit.optionsHint'),
    flags: flags, message: message, messageEditable: editable, autoMessage: autoMessage,
    autoLead: t('vc.commit.auto.lead'), autoNote: t('vc.commit.auto.note'),
    templateDisabled: templateDisabled, templateNote: templateNote, templateLabel: templateLabel, templateApplied: templateApplied,
    options: options, optionsNote: t('vc.commit.record.note'),
    contentNote: trackedCount === 0
      ? t('vc.commit.content.allTrackedEmpty')
      : (allTracked ? t('vc.commit.content.allTrackedNote', { n: String(trackedCount) }) : t('vc.commit.content.note')),
    submitDisabled: submitDisabled, submitTip: reasonText, reasonText: reasonText, hintText: hintText, running: running,
    primaryLabel: commitPrimaryKeyOf(plan.mode) !== ''
      ? t(commitPrimaryKeyOf(plan.mode))
      : t('vc.changes.view.commitLabel', { n: String(effectiveCount) }),
    confirm: confirm, formProblem: String(commit.formProblem || ''), result: result,
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

/** 提交页正文：定稿原型 62 / 69–80 的底部提交区（composer）。
 * 首屏只有三块：已暂存计数与两个快捷入口、说明输入、底行提示与提交按钮；提交按钮右侧多一枚箭头，
 *   点开才是「提交选项」浮层（形态 / 内容来源 / 说明模板 / 记录方式），默认首屏高度不变。
 * fixup 与 squash 时说明框换成一行只读的自动说明；三个记录方式打开时，提交按钮上方单独一行标签。 */
export function vcCommitPageNode(h: any, t: any, o: any): any {
  const opts = o || {}
  const p = opts.panel || vcCommitPanelOf({ t: t, ui: opts.ui, reads: opts.reads, width: opts.width, nowMs: opts.nowMs, changes: opts.changes })
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
  // 结果条贴在提交区顶部（原型把「这次提交的结果」放在最上面）：它说的是刚刚发生的事，
  //   下面三块是下一次提交的输入，先结论后输入。
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
    // #1905：储藏改成拆分按钮（原型 98）。渲染在 vcCommitOptions 叶里（与提交选项同一族），
    // 这里只把回调与 7.3 的版本门交过去；菜单开合、三种收法的文案都在那一叶。
    links.push(vcComposerStashSplitOf(h, t, { onStash: opts.onStash, stagedGate: p.stashStaged, pending: opts.stashPending === true }))
  }
  children.push(h('div', { key: 'head', className: 'composer-head' }, [
    h('span', { key: 'count', className: 'composer-count', 'data-vc-staged-count': String(stagedCount) }, t('vc.changes.view.composerCount', { n: String(stagedCount) })),
    links.length > 0 ? h('span', { key: 'links', className: 'composer-links' }, links) : null,
  ]))
  // 说明：能写的形态给多行输入框；fixup / squash 换成一行只读的自动说明（git 按前缀自己写，人不该手打）。
  if (p.messageEditable) {
    children.push(h('textarea', {
      key: 'msg', rows: 2, className: 'commit-input', value: p.message,
      placeholder: t('vc.changes.view.composerPlaceholder'), 'data-vc-commit-msg': 1, 'data-cap-control': '2.7',
      'aria-label': t('vc.commit.msgLabel'), 'aria-describedby': 'commit-hint',
      onChange: function (e: any) { const fn = handler('setMessage'); if (fn) fn(e && e.target ? e.target.value : '') },
    }))
  } else {
    children.push(h('div', { key: 'auto', className: 'commit-auto', 'data-vc-commit-auto': p.form }, [
      h('span', { key: 'lead', className: 'commit-auto-lead' }, p.autoLead),
      h('span', { key: 'text', className: 'commit-auto-text mono', 'data-vc-commit-auto-text': 1 }, p.autoMessage),
      h('span', { key: 'note', className: 'commit-auto-note' }, p.autoNote),
    ]))
  }
  // 记录方式一开着就单独占一行，贴在提交按钮上方：跳过钩子会改变提交前检查，
  // 只活在收起后的浮层里就等于没开过。塞进脚注那一行会和禁用原因抢宽度，窄档两边都读不成句。
  if (p.flags.length > 0) {
    children.push(h('div', { key: 'flags', className: 'composer-flags', role: 'status', 'aria-label': t('vc.commit.flagsLabel'), 'data-vc-commit-flags': 1 },
      p.flags.map(function (flag: any) {
        return h(Tip, { key: flag.key, content: flag.hint }, h('span', { className: 'chip chip-sm ' + flag.tone, 'data-vc-commit-flag': flag.key }, flag.label))
      })))
  }
  // 最后一行：左边禁用原因或提示、中间交给 AI、右边提交按钮与它右边的箭头，同一行、同一基线。
  // 原因与按钮说的是同一件事（为什么现在点不了），各占一行只会把提交区撑高、把列表压矮。
  const foot: any[] = []
  if (p.reasonText) {
    foot.push(h('span', { key: 'reason', className: 'composer-reason', 'data-vc-commit-submit-tip': 1 }, [
      h('svg', { key: 'icon', viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M12 4l9 16H3zM12 10v4M12 17v.5' })),
      h('span', { key: 'text' }, p.reasonText),
    ]))
  } else {
    foot.push(h('span', { key: 'hint', className: 'hint-text' }, p.hintText))
  }
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
    key: 'go', type: 'button', className: 'btn btn-primary btn-md', 'data-vc-commit-submit': 1, 'data-cap-control': '2.1',
    disabled: p.submitDisabled === true, 'aria-disabled': p.submitDisabled === true,
    'data-press': 'button', 'data-log': 'vc.commit.panel.submit', onClick: click('submit'),
  }, p.running ? t('vc.commit.running') : p.primaryLabel)
  // 悬停提示统一走 Tip 叶子：原因已经写在左下角，这里只是补悬停。
  const submitWithTip = submitTip ? h(Tip, { key: 'submit', content: submitTip }, submitNode) : submitNode
  // 提交按钮右侧的箭头是「提交选项」的入口：它属于这颗按钮，不新增一行、也不改首屏高度。
  const toggleLabel = String(p.triggerLabel || '')
  const toggleNode = h('button', {
    key: 'options', type: 'button', className: 'commit-options-toggle' + (p.optionsOpen ? ' is-on' : ''),
    'data-vc-commit-options': 1, 'aria-haspopup': 'dialog', 'aria-expanded': p.optionsOpen ? 'true' : 'false',
    'aria-label': toggleLabel, 'data-press': 'button', 'data-log': 'vc.commit.options',
    onClick: click('toggleMenu'),
  }, [h('span', { key: 'caret', className: 'commit-options-caret', 'aria-hidden': 'true' }, '⌄')])
  foot.push(h('div', { key: 'split', className: 'commit-split' }, [submitWithTip, h(Tip, { key: 'tip', content: String(p.triggerHint || '') }, toggleNode)]))
  children.push(h('div', { key: 'foot', id: 'commit-hint', className: 'composer-foot' }, foot))
  // 提交选项浮在提交区上方，底边贴着提交区上沿；收起时留在 DOM 里但 hidden（控件与 data-vc-commit-* 钩子
  //   一个不少，读屏与 Tab 也不会进 hidden 的子树），展开时不挤小说明框与文件列表。
  children.push(vcCommitOptionsNode(h, t, { panel: p, ops: ops }))
  if (p.confirm) children.push(vcCommitConfirmNode(h, t, { confirm: p.confirm, ops: ops }))
  if (p.formProblem) children.push(h('div', { key: 'formProblem', className: 'note', 'data-vc-commit-form-problem': 1 }, p.formProblem))
  return h('div', { className: 'composer', 'data-vc-commit-panel': 1, 'data-vc-page': 'changes', 'aria-label': t('vc.commit.panelTitle') }, children)
}
