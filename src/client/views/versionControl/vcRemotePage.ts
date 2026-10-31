// views/versionControl/vcRemotePage.ts —— 「远端与同步」页的画法（#1754 T18，域 8 的 8.1–8.4）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这一页把两种读数分开画（数据层见 vcRemoteData.ts）：
//   ① 本地读数：远端列表、地址展示值、凭据标记、本地跟踪分支数与分支名，外加读取时刻与
//      「这是本地记录」；打开页面只读这一份，不会联网。
//   ② 联网读数：每条远端一个「联网查看」按钮（按钮写明需要联网），用户点过之后才画结果面板；
//      结果标来源 network 与这一次读取时刻，失败按分类给下一步，截断按失败处理，绝不画半份。
// 写动作（登记 / 改名 / 删除 / 改地址）按三步画：入口在触发点上、形态按需要选（行内 / 浮层 / 整页），
//   删除画贴触发点的确认卡（四段、默认焦点在取消），结果与确认卡都留在触发点那一段里（结果贴触发点）。
// 四档宽按宽度收放：300 只留名字与状态、其余动作进「更多」菜单、地址收起；460 起补地址与分支名；
//   任何档位都不删入口（300 宽下三个动作仍在 details 里可点）。两套皮肤都只换颜色，不靠颜色单独传达。
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
export const vcRemoteModelOf = function (reads: any, ui: any, width: any, nowMs: any) {
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
    nowMs: typeof nowMs === 'number' ? nowMs : Date.now(),
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

/** 一个远端一行：名字、凭据标记、联网入口、地址与分支（按档宽收放）、三个写动作与按需出现的表单/确认卡。 */
const vcRemoteRowNode = function (h: any, t: any, model: any, remote: any) {
  const name = String(remote.name || '')
  const onlineOpen = model.online.openName === name
  const kids: any[] = []
  const head: any[] = [h('strong', { key: 'name', className: 'vcs-remote-name' }, name)]
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
  if (model.form === 'remove' && model.target === name) {
    // 删除的确认卡永远贴在这一行里：固定四段、默认焦点取消、带对象名的读屏名称（不做居中模态）。
    kids.push(h('div', {
      key: 'confirm',
      className: 'vcs-remote-confirm',
      'data-vc-remote-confirm': name,
      'aria-label': t('vc.remote.confirmLabel', { target: name }),
    }, [Object.assign({}, vcShellConfirmCardNode(h, t, { verb: t('vc.remote.removeVerb'), target: name }), { key: 'card' })]))
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

/**
 * 远端与同步页的正文。
 * o = { reads, ui, width, nowMs }：读数是数据层给的、ui 是当前打开的表单与结果（都为可空）。
 */
export const vcRemotePageNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const model = vcRemoteModelOf(opts.reads, opts.ui, opts.width, opts.nowMs)
  const kids: any[] = []
  kids.push(h('p', { key: 'note', className: 'vcs-remote-note', 'data-vc-remote-local-note': '1' }, t('vc.remote.localNote')))
  if (model.readAtMs !== null) {
    kids.push(h('p', { key: 'readAt', className: 'vcs-remote-read-at', 'data-vc-remote-local-read': String(model.readAtMs) }, t('vc.remote.readAt', { when: vcWhenText(t, model.nowMs, model.readAtMs) })))
  }
  kids.push(h('p', { key: 'hint', className: 'vcs-remote-hint', 'data-vc-remote-online-hint': '1' }, t('vc.remote.onlineHint')))
  const stateNode = vcRemoteStateNode(h, t, model)
  if (stateNode) kids.push(stateNode)
  kids.push(h('div', { key: 'toolbar', className: 'vcs-remote-toolbar' }, [
    h('button', {
      key: 'add',
      className: 'vcs-remote-add-btn',
      type: 'button',
      'data-vc-remote-trigger': 'add',
      'data-vc-remote-add': '1',
      'data-press': 'button',
      'data-log': 'vc.remote.add',
      'aria-expanded': model.form === 'add' ? 'true' : 'false',
    }, t('vc.remote.form.add')),
  ]))
  if (model.form === 'add') {
    const addKids: any[] = [vcRemoteFormNode(h, t, { form: 'add', title: 'add', fields: [{ name: 'name', labelKey: 'vc.remote.field.name', value: '' }, { name: 'url', labelKey: 'vc.remote.field.url', value: '' }] })]
    const resultNode = vcRemoteResultNode(h, t, model.result)
    if (resultNode) addKids.push(resultNode)
    kids.push(h('div', { key: 'addForm', className: 'vcs-remote-add' }, addKids))
  }
  if (model.remotes.length > 0) {
    kids.push(h('ul', { key: 'list', className: 'vcs-remote-list', role: 'list', 'aria-label': t('vc.remote.listLabel') }, model.remotes.map(function (remote: any) { return vcRemoteRowNode(h, t, model, remote) })))
  }
  kids.push(vcRemoteOnlineNode(h, t, model))
  return h('section', { className: 'vcs-remote', 'data-vc-remote-page': '1', 'data-vc-remote-state': model.state }, kids)
}
