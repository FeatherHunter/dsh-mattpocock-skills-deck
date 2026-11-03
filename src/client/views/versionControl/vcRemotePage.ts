// views/versionControl/vcRemotePage.ts —— 「远端与同步」页的画法（#1754 T18，域 8 的 8.1–8.4）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这一页把两种读数分开画（数据层见 vcRemoteData.ts）：
//   ① 本地读数：远端列表、地址展示值、凭据标记、本地跟踪分支数与分支名，外加读取时刻与
//      「这是本地记录」；打开页面只读这一份，不会联网。
//   ② 联网读数：每条远端一个「联网查看」按钮（按钮写明需要联网），用户点过之后才画结果面板；
//      结果标来源 network 与这一次读取时刻，失败按分类给下一步，截断按失败处理，绝不画半份。
// 写动作（登记 / 改名 / 删除 / 改地址）按三步画（#1776 M4b，与贮藏写动作同一套）：
//   ① 提交表单先发预检电话签一张 120 秒的票；② 拿到票才在触发点画确认卡（动作、目标、票据有效期，
//   四段、默认焦点在取消）；③ 确认之后才凭票发执行电话。预检失败只贴失败结果，不画确认卡、不发写电话；
//   结果与确认卡都留在触发点那一段里（登记动作在登记入口那一段，行内动作贴对应那一行）。
// 四档宽按宽度收放：300 只留名字与状态、其余动作进「更多」菜单、地址收起；460 起补地址与分支名；
//   任何档位都不删入口（300 宽下三个动作仍在 details 里可点）。两套皮肤都只换颜色，不靠颜色单独传达。
//
// #1841 按定稿原型第 39 张重排正文的信息层级（只动版式，不改读数与写动作流程）：页头之后依次是
//   ① 远端清单（已有远端、空态/失败态、联网面板、登记入口都在这一段里）② 同步（五条同步事实 +
//   按用途分组的十个动作）③ 远端依据（这些数字来自哪一次读取，以及联网边界）。
//   确认卡与结果始终贴在触发点那一段里：行内动作贴对应行，登记动作贴登记入口，同步动作贴各自的展开面板。
//
// 本文件只画界面，不发任何请求：所有读取与写动作都由数据层入口（vcReadRemoteList / vcReadRemoteOnline /
//   vcRunRemoteWrite）在用户操作时发起，渲染函数本身保证「打开页面不联网」。

declare function vcWhenText(t: any, nowMs: any, ms: any): string
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any
declare function vcShellResultNode(h: any, t: any, o: any): any
declare const VC_REMOTE_PHONES: Record<string, string>
declare function vcRemoteStateOf(reads: any): string
declare function vcRemoteReadAtOf(reads: any): number
declare function vcRemoteRemotesOf(reads: any): any[]
declare function vcRemoteErrorOf(reads: any): any
declare function vcRemoteOnlineStateOf(reads: any): string
declare function vcRemoteOnlineNameOf(reads: any): string
declare function vcRemoteOnlineOf(reads: any): any
declare function vcRemoteOnlineErrorOf(reads: any): any
// 悬停统一走 Tip 薄预设（标题属性一律经它挂，不在控件上直接写 title）。
declare const Tip: any
// 同步段（域 8 的 8.5–8.14）画在正文末尾，见 vcSyncPage.ts；没有同步读数时它回 null，这里就少一段。
declare function vcSyncPageNode(h: any, t: any, o: any): any
// #1841：五条同步事实由 vcRemoteFacts 折成（缺读数写占位、不写 0），分区与事实格用页头原语画。
declare function vcRemoteFactsOf(t: any, seed: any, changes: any): any[]
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageFactGridNode(h: any, t: any, o: any): any

/** 联网失败分类 → 词条键；不认识的分类落到 other（不把没见过的失败装进已知分类）。 */
const VC_REMOTE_FAIL_KEYS: Record<string, string> = {
  timeout: 'vc.remote.fail.timeout',
  'needs-credential': 'vc.remote.fail.needsCredential',
  'no-network': 'vc.remote.fail.noNetwork',
  'remote-missing': 'vc.remote.fail.remoteMissing',
  truncated: 'vc.remote.fail.truncated',
  other: 'vc.remote.fail.other',
}
const VC_REMOTE_HINT_KEYS: Record<string, string> = {
  timeout: 'vc.remote.hint.timeout',
  'needs-credential': 'vc.remote.hint.needsCredential',
  'no-network': 'vc.remote.hint.noNetwork',
  'remote-missing': 'vc.remote.hint.remoteMissing',
  truncated: 'vc.remote.hint.truncated',
  other: 'vc.remote.hint.other',
}
/** 地址/名字校验原因的键（与共享层给的判据标识同一套；界面只按族取话术，不另造理由）。 */
const vcRemoteFieldErrorKeyOf = function (problem: any) {
  const p = String(problem || '')
  if (p.indexOf('url') >= 0) return 'vc.remote.fieldError.remoteUrl'
  return 'vc.remote.fieldError.remoteName'
}

/**
 * 把读数归一成画法要用的模型：状态、列表、旧读数标记、联网槽、当前表单与结果。
 * 状态映射：本地读数 ok 且没有远端 → empty；idle / loading → loading（刚打开不冒充「没有远端」）；
 *   err → error。旧读数标记只在「加载/失败但手上还有上一份列表」时给。
 */
export const vcRemoteModelOf = function (reads: any, ui: any, width: any, nowMs: any, seed: any, changes: any) {
  const u = ui || {}
  const n = Number(width)
  const w = isFinite(n) && n > 0 ? n : 460
  const localState = vcRemoteStateOf(reads)
  const remotes = vcRemoteRemotesOf(reads) || []
  const state = localState === 'ok' ? (remotes.length ? 'ok' : 'empty') : (localState === 'err' ? 'error' : 'loading')
  const onlineState = vcRemoteOnlineStateOf(reads)
  const onlineName = vcRemoteOnlineNameOf(reads)
  return {
    width: w,
    narrow: w <= 300,
    wide: w >= 460,
    state: state,
    remotes: remotes,
    readAtMs: vcRemoteReadAtOf(reads),
    localError: vcRemoteErrorOf(reads),
    oldLocal: (localState === 'loading' || localState === 'err') && remotes.length > 0,
    online: {
      state: onlineState,
      name: onlineName,
      openName: onlineState === 'idle' ? '' : onlineName,
      data: vcRemoteOnlineOf(reads),
      error: vcRemoteOnlineErrorOf(reads),
    },
    form: u.form ? String(u.form) : '',
    target: u.target ? String(u.target) : '',
    problem: u.problem ? String(u.problem) : '',
    result: u.result || null,
    // 确认卡素材：预检成功时由动作层折成这一份（动作、目标、票号、票据有效期）；没有票时是 null。
    confirm: u.confirm || null,
    nowMs: typeof nowMs === 'number' ? nowMs : Date.now(),
    // #1841：页面壳的首屏种子与工作区计数（事实格与「默认」标记用）；两样都可缺，缺了就不画那一部分。
    seed: seed || {},
    changes: changes || null,
    defaultName: String((seed && seed.remote) || ''),
  }
}

/** 一条表单（行内 / 浮层两种形态共用）：每个字段都有读屏名称，提交与取消都是真按钮。 */
const vcRemoteFormNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const form = String(opts.form || '')
  const kids: any[] = []
  for (const field of (opts.fields || [])) {
    kids.push(h('label', { key: 'l-' + field.name, className: 'vcs-remote-field' }, [
      h('span', { key: 's', className: 'vcs-remote-field-label' }, t(field.labelKey)),
      h('input', { key: 'i', className: 'vcs-remote-input', type: 'text', 'aria-label': t(field.labelKey), 'data-vc-remote-field': field.name, defaultValue: String(field.value || '') }),
    ]))
  }
  if (opts.problem) {
    kids.push(h('p', { key: 'problem', className: 'vcs-remote-field-error', 'data-vc-remote-field-error': String(opts.problem) }, t(vcRemoteFieldErrorKeyOf(opts.problem))))
  }
  kids.push(h('div', { key: 'acts', className: 'vcs-remote-form-acts' }, [
    h('button', { key: 'submit', className: 'vcs-remote-submit', type: 'button', 'data-vc-remote-submit': form, 'data-press': 'button', 'data-log': 'vc.remote.submit' }, t('vc.remote.submit')),
    h('button', { key: 'cancel', className: 'vcs-remote-cancel', type: 'button', 'data-vc-remote-cancel': '1', 'data-press': 'button', 'data-log': 'vc.remote.cancel' }, t('vc.remote.cancel')),
  ]))
  return h('div', { className: 'vcs-remote-form vcs-remote-form-' + form, 'data-vc-form': opts.shape || 'inline', 'data-vc-remote-form': form, role: 'group', 'aria-label': t('vc.remote.form.' + (opts.title || form)) }, kids)
}

/** 结果信息一律用页面壳那一套（成功给命令名/耗时/数，失败给原话/环节/期望与实际/上游原因）。 */
const vcRemoteResultNode = function (h: any, t: any, result: any) {
  if (!result) return null
  const o = result.ok === false
    ? { error: true, git: result.git, step: result.step, expected: result.expected, actual: result.actual, cause: result.cause }
    : { cmd: result.cmd, ms: result.ms, n: result.n, next: result.next }
  return Object.assign({}, vcShellResultNode(h, t, o), { key: 'result' })
}

/**
 * 确认卡：画在触发点上，写清这一次要做的动作、目标与票据有效期；确认与取消都是真按钮。
 * 只有预检签到票之后才会被调用——没有票时失败结果贴在原处，不出现这张卡。
 * 外层 data-vc-remote-confirm 是点击委派的认人标记（go/cancel 由页面壳原语画）；
 * anchor 是这个确认卡贴在哪一段（行内用远端名，登记动作用空串）。
 */
const vcRemoteConfirmNode = function (h: any, t: any, model: any, confirm: any, anchor: any) {
  const action = String(confirm.action || '')
  const verb = t('vc.remote.act.' + action)
  const targetText = t('vc.remote.confirmTarget.' + action, {
    name: String(confirm.name || confirm.from || ''),
    to: String(confirm.to || ''),
    url: String(confirm.url || ''),
  })
  return h('div', {
    key: 'confirm',
    className: 'vcs-remote-confirm',
    'data-vc-remote-confirm': String(anchor || ''),
    'data-vc-remote-confirm-action': action,
    'data-vc-remote-confirm-expires': String(confirm.expiresAtMs || ''),
    'aria-label': t('vc.remote.confirmLabel', { verb: verb, target: targetText }),
  }, [
    Object.assign({}, vcShellConfirmCardNode(h, t, { verb: verb, target: targetText }), { key: 'card' }),
    h('p', { key: 'expires', className: 'vcs-remote-confirm-expires', 'data-vc-remote-confirm-note': '1' }, t('vc.remote.confirmExpires', { when: vcWhenText(t, model.nowMs, confirm.expiresAtMs) })),
  ])
}

/** 一个远端一行：名字、凭据标记、联网入口、地址与分支（按档宽收放）、三个写动作与按需出现的表单/确认卡。 */
const vcRemoteRowNode = function (h: any, t: any, model: any, remote: any) {
  const name = String(remote.name || '')
  const onlineOpen = model.online.openName === name
  const kids: any[] = []
  const head: any[] = [h('strong', { key: 'name', className: 'vcs-remote-name' }, name)]
  // 定稿原型第 39 张给取数用的那个远端标一枚「默认」：同步带上的领先与落后就是与它比出来的。
  if (model.defaultName && name === model.defaultName) {
    head.push(h('span', { key: 'default', className: 'vcs-remote-default', 'data-vc-remote-default': name }, t('vc.remote.defaultMark')))
  }
  if (remote.hasCredential) {
    head.push(h('span', { key: 'cred', className: 'vcs-remote-credential', 'data-vc-remote-credential': name }, t('vc.remote.credential')))
  }
  head.push(h('button', {
    className: 'vcs-remote-online-btn',
    type: 'button',
    'data-vc-remote-online-btn': String(remote.name),
    'data-press': 'button',
    'data-log': 'vc.remote.online',
    'aria-expanded': onlineOpen ? 'true' : 'false',
    'aria-controls': 'vc-remote-online',
    key: 'online',
  }, t('vc.remote.online')))
  kids.push(h('div', { key: 'head', className: 'vcs-remote-head' }, head))
  if (model.wide) {
    kids.push(h(Tip, { key: 'url', content: String(remote.fetchUrl || '') }, h('span', { key: 'url', className: 'vcs-remote-url', 'data-vc-remote-url': String(remote.fetchUrl || '') }, String(remote.fetchUrl || ''))))
    if (remote.pushUrl && remote.pushUrl !== remote.fetchUrl) {
      kids.push(h('span', { key: 'pushUrl', className: 'vcs-remote-push-url', 'data-vc-remote-push-url': String(remote.pushUrl) }, String(remote.pushUrl)))
    }
  }
  const count = typeof remote.branchCount === 'number' ? remote.branchCount : 0
  const branchKids: any[] = [h('span', { key: 'n', className: 'vcs-remote-branch-count', 'data-vc-remote-branch-count': String(count) }, t('vc.remote.branchCount', { n: String(count) }))]
  if (model.wide) {
    for (const br of (remote.branches || [])) {
      branchKids.push(h('span', { key: 'b-' + String(br.short), className: 'vcs-remote-branch', 'data-vc-remote-branch': String(br.short) }, String(br.short)))
    }
  }
  kids.push(h('div', { key: 'branches', className: 'vcs-remote-branches' }, branchKids))
  const acts = [
    h('button', { key: 'rename', className: 'vcs-remote-act', type: 'button', 'data-vc-remote-act': 'rename', 'data-vc-remote-trigger': 'rename', 'data-press': 'button', 'data-log': 'vc.remote.act.rename' }, t('vc.remote.act.rename')),
    h('button', { key: 'setUrl', className: 'vcs-remote-act', type: 'button', 'data-vc-remote-act': 'setUrl', 'data-vc-remote-trigger': 'setUrl', 'data-press': 'button', 'data-log': 'vc.remote.act.set-url' }, t('vc.remote.act.setUrl')),
    h('button', { key: 'remove', className: 'vcs-remote-act', type: 'button', 'data-vc-remote-act': 'remove', 'data-vc-remote-trigger': 'remove', 'data-press': 'button', 'data-log': 'vc.remote.act.remove' }, t('vc.remote.act.remove')),
  ]
  if (model.narrow) {
    // 300 宽：三个动作收进「更多」，但一个都不删（任何档位都能到同一个动作）。
    kids.push(h('details', { key: 'more', className: 'vcs-remote-more', 'data-vc-remote-more': '1' }, [
      h('summary', { key: 's', className: 'vcs-remote-more-summary', 'data-press': 'button', 'data-log': 'vc.remote.more' }, t('vc.remote.more')),
      h('div', { key: 'acts', className: 'vcs-remote-acts' }, acts),
    ]))
  } else {
    kids.push(h('div', { key: 'acts', className: 'vcs-remote-acts' }, acts))
  }
  if (model.form === 'rename' && model.target === name) {
    kids.push(Object.assign({}, vcRemoteFormNode(h, t, { form: 'rename', title: 'rename', shape: 'float', fields: [{ name: 'from', labelKey: 'vc.remote.field.name', value: name }, { name: 'to', labelKey: 'vc.remote.field.to', value: '' }] }), { key: 'form' }))
  }
  if (model.form === 'setUrl' && model.target === name) {
    kids.push(Object.assign({}, vcRemoteFormNode(h, t, { form: 'setUrl', title: 'setUrl', shape: 'float', problem: model.problem, fields: [{ name: 'url', labelKey: 'vc.remote.field.url', value: String(remote.fetchUrl || '') }] }), { key: 'form' }))
  }
  // 改名 / 删除 / 改地址的确认卡贴在这一行里：预检成功、拿到票之后才出现（没有票不画卡）。
  const confirm = model.confirm && String(model.confirm.action || '') !== 'add' && model.target === name ? model.confirm : null
  if (confirm) {
    kids.push(Object.assign({}, vcRemoteConfirmNode(h, t, model, confirm, name), { key: 'confirm' }))
  }
  if (model.form !== 'add' && model.target === name) {
    const resultNode = vcRemoteResultNode(h, t, model.result)
    if (resultNode) kids.push(resultNode)
  }
  return h('li', { key: 'row-' + name, className: 'vcs-remote-row', 'data-vc-remote': name, 'data-vc-remote-row': '1' }, kids)
}

/** 联网结果面板：只有用户点过联网入口之后才有内容；id 常驻，按钮的 aria-controls 指得清。 */
const vcRemoteOnlineNode = function (h: any, t: any, model: any) {
  const online = model.online
  const state = online.state === 'ok' && online.data ? 'ok' : (online.state === 'err' ? 'err' : (online.state === 'loading' ? 'loading' : 'idle'))
  const kids: any[] = []
  if (state === 'ok') {
    const data = online.data
    const refKids: any[] = []
    for (const ref of (data.refs || [])) {
      refKids.push(h('li', { key: 'ref-' + String(ref.ref), className: 'vcs-remote-ref', 'data-vc-remote-ref': String(ref.ref) }, [
        h('span', { key: 'kind', className: 'vcs-remote-ref-kind' }, t(ref.kind === 'tag' ? 'vc.remote.refTag' : 'vc.remote.refBranch')),
        h('code', { key: 'name', className: 'vcs-remote-ref-name' }, String(ref.ref)),
        h('span', { key: 'oid', className: 'vcs-remote-ref-oid' }, String(ref.oid || '').slice(0, 7)),
      ]))
    }
    kids.push(h('div', {
      key: 'page',
      className: 'vcs-remote-online-page',
      'data-vc-form': 'page',
      'data-vc-remote-online-source': 'network',
      'data-vc-remote-online-read-at': String(data.readAtMs),
      'data-vc-remote-online-count': String(typeof data.count === 'number' ? data.count : (data.refs || []).length),
    }, [
      h('div', { key: 'head', className: 'vcs-remote-online-head' }, [
        h('button', { key: 'back', className: 'vcs-remote-back', type: 'button', 'data-vc-remote-back': '1', 'data-press': 'button', 'data-log': 'vc.remote.back' }, t('vc.remote.pageBack')),
        h('span', { key: 'readAt', className: 'vcs-remote-online-read-at' }, t('vc.remote.onlineReadAt', { when: vcWhenText(t, model.nowMs, data.readAtMs) })),
        h('span', { key: 'source', className: 'vcs-remote-online-source' }, t('vc.remote.onlineSource')),
        h('span', { key: 'count', className: 'vcs-remote-online-count' }, t('vc.remote.onlineCount', { n: String(typeof data.count === 'number' ? data.count : (data.refs || []).length) })),
      ]),
      h('ul', { key: 'refs', className: 'vcs-remote-refs', role: 'list', 'aria-label': t('vc.remote.refsLabel') }, refKids),
    ]))
  } else if (state === 'err') {
    const err = online.error || {}
    const kind = VC_REMOTE_FAIL_KEYS[String(err.kind)] ? String(err.kind) : 'other'
    kids.push(h('p', { key: 'title', className: 'vcs-remote-online-title' }, t(VC_REMOTE_FAIL_KEYS[kind])))
    if (err.message) kids.push(h('p', { key: 'msg', className: 'vcs-remote-online-msg' }, String(err.message)))
    kids.push(h('p', { key: 'hint', className: 'vcs-remote-online-hint', 'data-vc-remote-online-error': kind }, t(VC_REMOTE_HINT_KEYS[kind])))
    kids.push(h('button', { key: 'retry', className: 'vcs-remote-online-retry', type: 'button', 'data-vc-remote-online-retry': '1', 'data-press': 'button', 'data-log': 'vc.remote.online-retry' }, t('vc.remote.onlineRetry')))
  } else if (state === 'loading') {
    kids.push(h('p', { key: 'loading', className: 'vcs-remote-online-loading' }, t('vc.remote.onlineLoading')))
  }
  return h('div', { key: 'online', id: 'vc-remote-online', className: 'vcs-remote-online', 'data-vc-remote-online': state, 'aria-live': 'polite' }, kids)
}

/** 本地读数的状态块：空态给判断与下一步、加载态标旧读数、失败态给重试；ok 由列表自己画。 */
const vcRemoteStateNode = function (h: any, t: any, model: any) {
  if (model.state === 'empty') {
    return h('div', { key: 'state', className: 'vcs-state vcs-state-empty', 'data-vc-state': 'empty' }, [
      h('span', { key: 'empty', 'data-vc-remote-empty': '1' }, t('vc.remote.empty')),
      h('span', { key: 'next', 'data-vc-remote-empty-next': '1' }, t('vc.remote.emptyNext')),
    ])
  }
  if (model.state === 'loading') {
    const kids: any[] = []
    if (model.oldLocal) kids.push(h('span', { key: 'old', 'data-vc-old-read': '1' }, t('vc.remote.loadingOld')))
    else kids.push(h('span', { key: 'load' }, t('vc.remote.loading')))
    return h('div', { key: 'state', className: 'vcs-state vcs-state-loading', 'data-vc-state': 'loading' }, kids)
  }
  if (model.state === 'error') {
    const err = model.localError || {}
    const kids: any[] = [h('span', { key: 'title' }, t('vc.remote.localFail'))]
    if (err.message) kids.push(h('span', { key: 'msg' }, String(err.message)))
    kids.push(h('button', { key: 'retry', className: 'vcs-state-retry', type: 'button', 'data-vc-remote-retry': '1', 'data-press': 'button', 'data-log': 'vc.remote.retry' }, t('vc.remote.retry')))
    return h('div', { key: 'state', className: 'vcs-state vcs-state-error', role: 'alert', 'data-vc-state': 'error' }, kids)
  }
  return null
}

/** 登记入口那一段：按钮 + 就地展开的表单/确认卡/结果。入口在远端清单段末尾，不是页面级工具栏。 */
const vcRemoteAddNode = function (h: any, t: any, model: any) {
  const kids: any[] = []
  kids.push(h('div', { key: 'toolbar', className: 'vcs-remote-toolbar' }, [
    h('button', {
      key: 'add',
      className: 'vcs-remote-add-btn',
      type: 'button',
      'data-vc-remote-trigger': 'add',
      'data-vc-remote-add': '1',
      'data-press': 'button',
      'data-log': 'vc.remote.add',
      'aria-expanded': model.form === 'add' || (model.confirm && String(model.confirm.action || '') === 'add') ? 'true' : 'false',
    }, t('vc.remote.form.add')),
  ]))
  // 登记动作的确认卡与失败结果都贴在这个入口下面；执行成功之后表单已经收起，结果仍留在原处。
  const addConfirm = model.confirm && String(model.confirm.action || '') === 'add' ? model.confirm : null
  if (model.form === 'add' || addConfirm) {
    const addKids: any[] = []
    if (addConfirm) addKids.push(vcRemoteConfirmNode(h, t, model, addConfirm, ''))
    else addKids.push(vcRemoteFormNode(h, t, { form: 'add', title: 'add', fields: [{ name: 'name', labelKey: 'vc.remote.field.name', value: '' }, { name: 'url', labelKey: 'vc.remote.field.url', value: '' }] }))
    const resultNode = vcRemoteResultNode(h, t, model.result)
    if (resultNode) addKids.push(resultNode)
    kids.push(h('div', { key: 'addForm', className: 'vcs-remote-add' }, addKids))
  } else if (model.result && model.target === '') {
    const resultNode = vcRemoteResultNode(h, t, model.result)
    if (resultNode) kids.push(h('div', { key: 'addForm', className: 'vcs-remote-add' }, [resultNode]))
  }
  return kids
}

/**
 * 远端与同步页的正文（#1841 按定稿原型第 39 张重排）。
 * 页头之后三段固定顺序：
 *   ① 远端清单：状态块（空/加载/失败）+ 各远端行 + 联网结果面板 + 登记入口，一段交代完「有哪些远端、怎么加」；
 *   ② 同步：先五条同步事实（当前分支、领先落后、读取于、远端依据、工作区改动），再十个动作按用途分四组；
 *   ③ 远端依据：这些数字来自哪一次读取，以及「本地记录 / 联网查看」的边界说明。
 * 三种空态与失败（没有远端、读取失败、动作被拒）分别落在清单段与触发点，页面不会只剩空白。
 * o = { reads, ui, width, nowMs, seed, changes }：读数是数据层给的，seed/changes 是页面壳的首屏事实。
 */
export const vcRemotePageNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const model = vcRemoteModelOf(opts.reads, opts.ui, opts.width, opts.nowMs, opts.seed, opts.changes)
  const sections: any[] = []
  // ① 远端清单：已有远端与状态块、联网面板、登记入口都收在同一段里；列表为空时由状态块给出判断与下一步。
  const listKids: any[] = []
  const stateNode = vcRemoteStateNode(h, t, model)
  if (stateNode) listKids.push(stateNode)
  if (model.remotes.length > 0) {
    listKids.push(h('ul', { key: 'list', className: 'vcs-remote-list', role: 'list', 'aria-label': t('vc.remote.listLabel') }, model.remotes.map(function (remote: any) { return vcRemoteRowNode(h, t, model, remote) })))
  }
  // 联网结果面板挂在它自己的入口下面一行：点过「联网查看」才有内容，打开页面时是空壳。
  listKids.push(vcRemoteOnlineNode(h, t, model))
  listKids.push.apply(listKids, vcRemoteAddNode(h, t, model))
  sections.push(vcPageSectionNode(h, t, { title: 'vc.remote.section.list', count: model.remotes.length, note: 'vc.remote.section.listNote', children: listKids }))
  // ② 同步：事实格先交代仓库现在在哪，再给按用途分组的十个动作；动作面板里的确认卡与结果贴各自触发点。
  const syncKids: any[] = [vcPageFactGridNode(h, t, { facts: vcRemoteFactsOf(t, model.seed, model.changes) })]
  const syncNode = vcSyncPageNode(h, t, { reads: opts.reads, ui: opts.ui, width: opts.width, nowMs: opts.nowMs })
  if (syncNode) syncKids.push(syncNode)
  sections.push(vcPageSectionNode(h, t, { title: 'vc.remote.section.sync', note: 'vc.remote.section.syncNote', children: syncKids }))
  // ③ 远端依据：先把「这是哪一次读数、为什么打开页面不联网」说明白，再让人决定要不要联网核对。
  const basisKids: any[] = []
  basisKids.push(h('p', { key: 'note', className: 'vcs-remote-note', 'data-vc-remote-local-note': '1' }, t('vc.remote.localNote')))
  if (model.readAtMs !== null) {
    basisKids.push(h('p', { key: 'readAt', className: 'vcs-remote-read-at', 'data-vc-remote-local-read': String(model.readAtMs) }, t('vc.remote.readAt', { when: vcWhenText(t, model.nowMs, model.readAtMs) })))
  }
  basisKids.push(h('p', { key: 'hint', className: 'vcs-remote-hint', 'data-vc-remote-online-hint': '1' }, t('vc.remote.onlineHint')))
  sections.push(vcPageSectionNode(h, t, { title: 'vc.remote.section.basis', note: 'vc.remote.section.basisNote', children: basisKids }))
  return h('section', { className: 'vcs-remote', 'data-vc-remote-page': '1', 'data-vc-remote-state': model.state }, sections)
}
