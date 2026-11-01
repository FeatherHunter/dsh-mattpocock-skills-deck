// views/versionControl/vcPlatformPage.ts —— 「平台与边界」页正文（#1762 T26，规格 #1586 域 14 与 5.9 / 8.15）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这一页五块，全部只读或说明，没有一条可执行写动作：
//   ① 凭据助手链（8.15）：只展示本机配置的 credential.helper 链与「面板持有的凭据=不持有」；
//      命中 store 时只读标红并建议换 credential manager / cache；没有输入框，不读、不写、不落盘令牌。
//   ② rebase.updateRefs 说明（5.9）：显示当前值与「面板不做 --update-refs」的理由；开着时写明
//      交互变基的预检会拒绝，并指出替代路径（终端明确执行）。
//   ③ request-pull 生成（14.3）：三个输入 + 一个按钮，只读调用 git request-pull 生成一段可粘贴的说明；
//      不推送、不联网、不改仓库。
//   ④ 逐条平台说明（14.2、14.4–14.8）：每条讲清是什么、为什么面板不做、去哪里做、被拒绝时看什么。
//   ⑤ 13.14 的指回说明由页面壳画（平台与边界只放说明，历史页才是图形视图的主入口）。
//
// 本页不画 data-cap-primary、也不画 data-surface：那 9 条能力的主入口行由页面壳的能力清单统一给，
//   这里再画一个就成了「一个能力两个主入口」，门禁 Z1d 会当场判红。
// 宽度只影响排版：300 宽收起说明的次要字段，任何档位都不删入口。

declare function vcCapabilityOf(capId: any): any
declare function vcPlatformStateOf(reads: any): string
declare function vcPlatformDataOf(reads: any): any
declare function vcPlatformErrorOf(reads: any): any
declare function vcPlatformCredentialOf(reads: any): any
declare function vcPlatformUpdateRefsOf(reads: any): any
declare function vcPlatformRequestPullStateOf(reads: any): string
declare function vcPlatformRequestPullOf(reads: any): any
declare function vcPlatformRequestPullErrorOf(reads: any): any
declare const VC_PLATFORM_PHONES: Record<string, string>

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_PLATFORM_PAGE_SOURCE = 'src/client/views/versionControl/vcPlatformPage.ts'
/** 这一页承载的九条能力编号（14.2 / 14.3 / 14.4–14.8 / 5.9 / 8.15）；顺序就是说明区从上到下。 */
export const VC_PLATFORM_NOTE_IDS: string[] = ['8.15', '5.9', '14.2', '14.3', '14.4', '14.5', '14.6', '14.7', '14.8']

const vcPlatformText = function (t: any, key: string, vars: any): string {
  if (typeof t !== 'function') return key
  return vars ? t(key, vars) : t(key)
}

/** 把读数与交互态归一成画法要用的模型；渲染函数只读这一份，不自己猜状态。 */
export const vcPlatformModelOf = function (reads: any, ui: any, width: any) {
  const u = ui || {}
  const n = Number(width)
  const w = isFinite(n) && n > 0 ? n : 460
  const rpState = vcPlatformRequestPullStateOf(reads)
  return {
    width: w,
    narrow: w <= 300,
    state: vcPlatformStateOf(reads),
    error: vcPlatformErrorOf(reads),
    credential: vcPlatformCredentialOf(reads),
    updateRefs: vcPlatformUpdateRefsOf(reads),
    requestPull: {
      state: rpState,
      data: vcPlatformRequestPullOf(reads),
      error: vcPlatformRequestPullErrorOf(reads),
      form: { start: String(u.rpStart || ''), url: String(u.rpUrl || ''), end: String(u.rpEnd || '') },
    },
  }
}

/** 凭据助手链一块：只读展示，store 命中时标红并给替代建议。 */
const vcPlatformCredentialNode = function (h: any, t: any, model: any) {
  const c = model.credential || {}
  const kids: any[] = [
    h('h3', { key: 'title', className: 'vcs-sec-title' }, vcPlatformText(t, 'vc.platform.cred.title', null)),
    h('p', { key: 'note', className: 'vcs-platform-note-line', 'data-vc-platform-cred-note': 'no-credentials-held' }, vcPlatformText(t, 'vc.platform.cred.note', null)),
  ]
  if (c.state === 'error') {
    kids.push(h('p', { key: 'fail', role: 'alert', className: 'vcs-platform-fail', 'data-vc-platform-cred-error': '1' }, vcPlatformText(t, 'vc.platform.cred.loadFail', null)))
  } else if (c.state !== 'ok') {
    kids.push(h('p', { key: 'loading', className: 'vcs-platform-loading', 'data-vc-platform-cred-loading': '1' }, vcPlatformText(t, 'vc.shell.state.loading', null)))
  } else if (c.helpers.length === 0) {
    kids.push(h('p', { key: 'empty', className: 'vcs-platform-empty', 'data-vc-platform-cred-empty': '1' }, vcPlatformText(t, 'vc.platform.cred.empty', null)))
  } else {
    kids.push(h('p', { key: 'list-title', className: 'vcs-platform-line' }, vcPlatformText(t, 'vc.platform.cred.list', { n: String(c.helpers.length) })))
    kids.push(h('ul', { key: 'list', className: 'vcs-platform-helpers', 'data-vc-platform-cred-helpers': String(c.helpers.length) }, c.helpers.map(function (helper: any, i: number) {
      return h('li', { key: 'h' + i, className: 'vcs-platform-helper', 'data-vc-platform-cred-helper': String(helper) }, String(helper))
    })))
    if (c.risk === 'store' || c.store !== '') {
      kids.push(h('p', {
        key: 'store',
        role: 'alert',
        className: 'vcs-platform-danger',
        'data-vc-platform-cred-risk': 'replace-store',
        'data-vc-platform-cred-store': String(c.store || ''),
      }, vcPlatformText(t, 'vc.platform.cred.store', { helper: String(c.store || '') })))
    } else {
      kids.push(h('p', { key: 'ok', className: 'vcs-platform-ok', 'data-vc-platform-cred-ok': '1' }, vcPlatformText(t, 'vc.platform.cred.ok', null)))
    }
  }
  return h('section', { key: 'cred', className: 'vcs-platform-sec', 'data-vc-platform-cred': '1' }, kids)
}

/** rebase.updateRefs 一块：显示当前值、为什么不提供、开着时预检会拒绝与替代路径。 */
const vcPlatformUpdateRefsNode = function (h: any, t: any, model: any) {
  const u = model.updateRefs || {}
  const cap = vcCapabilityOf('5.9') || {}
  const mark = u.state !== 'ok' ? 'unknown' : (u.enabled ? 'on' : 'off')
  const kids: any[] = [
    h('h3', { key: 'title', className: 'vcs-sec-title' }, vcPlatformText(t, 'vc.platform.updateRefs.title', null)),
    h('p', {
      key: 'value',
      className: 'vcs-platform-line',
      'data-vc-platform-update-refs': mark,
      'data-vc-platform-update-refs-value': String(u.value || ''),
    }, mark === 'on'
      ? vcPlatformText(t, 'vc.platform.updateRefs.valueOn', { value: String(u.value || 'true') })
      : vcPlatformText(t, 'vc.platform.updateRefs.valueOff', null)),
    h('p', { key: 'why', className: 'vcs-platform-line' }, vcPlatformText(t, 'vc.platform.updateRefs.why', null)),
  ]
  if (mark === 'on') kids.push(h('p', { key: 'refuse', role: 'alert', className: 'vcs-platform-danger', 'data-vc-platform-update-refs-refuse': '1' }, vcPlatformText(t, 'vc.platform.updateRefs.refuse', null)))
  kids.push(h('p', { key: 'min', className: 'vcs-platform-caption', 'data-vc-platform-update-refs-min': '1' }, vcPlatformText(t, 'vc.platform.updateRefs.min', { v: String(cap.minVersion || '2.38') })))
  return h('section', { key: 'update-refs', className: 'vcs-platform-sec', 'data-vc-platform-update-refs-block': '1' }, kids)
}

/** request-pull 一块：三个输入与一个只读按钮；结果贴在这一块里，截断时如实说只显示了前一段。 */
const vcPlatformRequestPullNode = function (h: any, t: any, model: any, ctx: any) {
  const rp = model.requestPull || {}
  const form = rp.form || { start: '', url: '', end: '' }
  const busy = rp.state === 'loading'
  const field = function (key: string, labelKey: string, attr: string, value: string) {
    return h('label', { key: key, className: 'vcs-platform-field' }, [
      h('span', { key: 'l' }, vcPlatformText(t, labelKey, null)),
      h('input', {
        key: 'i',
        type: 'text',
        'data-vc-platform-rp-field': attr,
        value: value,
        disabled: busy,
        onInput: function (ev: any) { ctx.edit(attr, String((ev && ev.target && ev.target.value) || '')) },
      }),
    ])
  }
  const kids: any[] = [
    h('h3', { key: 'title', className: 'vcs-sec-title' }, vcPlatformText(t, 'vc.platform.rp.title', null)),
    h('p', { key: 'note', className: 'vcs-platform-note-line' }, vcPlatformText(t, 'vc.platform.rp.note', null)),
    field('start', 'vc.platform.rp.start', 'start', form.start),
    field('url', 'vc.platform.rp.url', 'url', form.url),
    field('end', 'vc.platform.rp.end', 'end', form.end),
    h('button', {
      key: 'run',
      type: 'button',
      className: 'vcs-platform-btn',
      'data-vc-platform-rp-run': '1',
      'data-press': 'button',
      disabled: busy,
      'data-log': 'vc.platform.rp-run', onClick: function () { ctx.run() },
    }, busy ? vcPlatformText(t, 'vc.platform.rp.loading', null) : vcPlatformText(t, 'vc.platform.rp.run', null)),
  ]
  // 数据层的失败态叫 err（与 vcRemoteData 等同一套约定），这里两者都认，免得多写一层映射。
  if (rp.state === 'err' || rp.state === 'error') {
    const e = rp.error || {}
    kids.push(h('div', { key: 'err', role: 'alert', className: 'vcs-platform-fail', 'data-vc-platform-rp-error': '1' }, [
      h('p', { key: 'h' }, vcPlatformText(t, 'vc.platform.rp.error', null)),
      h('p', { key: 'm', className: 'vcs-platform-caption' }, String(e.message || e.kind || '')),
    ]))
  } else if (rp.data) {
    kids.push(h('p', { key: 'res-title', className: 'vcs-platform-line' }, vcPlatformText(t, 'vc.platform.rp.result', null)))
    kids.push(h('pre', { key: 'res', className: 'vcs-platform-pre', 'data-vc-platform-rp-result': '1' }, rp.data.text))
    if (rp.data.truncated === true) kids.push(h('p', { key: 'trunc', className: 'vcs-platform-caption', 'data-vc-platform-rp-truncated': '1' }, vcPlatformText(t, 'vc.platform.rp.truncated', null)))
  } else if (rp.state !== 'loading') {
    kids.push(h('p', { key: 'empty', className: 'vcs-platform-empty', 'data-vc-platform-rp-empty': '1' }, vcPlatformText(t, 'vc.platform.rp.empty', null)))
  }
  return h('section', { key: 'rp', className: 'vcs-platform-sec', 'data-vc-platform-rp': '1' }, kids)
}

/** 逐条说明：九条能力各一段，编号与账本对齐；说明项没有执行按钮。 */
const vcPlatformNotesNode = function (h: any, t: any, model: any) {
  const rows = VC_PLATFORM_NOTE_IDS.map(function (capId: string) {
    const cap = vcCapabilityOf(capId) || { id: capId, name: capId, minVersion: '' }
    const body = vcPlatformText(t, 'vc.platform.note.' + capId, null)
    return h('li', { key: capId, className: 'vcs-platform-note', 'data-vc-platform-note': capId }, [
      h('h4', { key: 't', className: 'vcs-platform-note-title' }, String(cap.id || capId) + ' ' + String(cap.name || '')),
      h('p', { key: 'b', className: 'vcs-platform-note-body' }, body),
      cap.minVersion ? h('p', { key: 'v', className: 'vcs-platform-caption', 'data-vc-platform-note-min': String(cap.minVersion) }, vcPlatformText(t, 'vc.platform.note.min', { v: String(cap.minVersion) })) : null,
    ])
  })
  return h('section', { key: 'notes', className: 'vcs-platform-sec', 'data-vc-platform-notes': '1' }, [
    h('h3', { key: 'title', className: 'vcs-sec-title' }, vcPlatformText(t, 'vc.platform.notes.title', { n: String(rows.length) })),
    h('ul', { key: 'rows', className: 'vcs-platform-note-rows' }, rows),
  ])
}

/**
 * 平台与边界页的正文。入参：
 *   reads（平台读数，见 vcPlatformData.ts）、ui（request-pull 表单里已输入的值）、
 *   width、nowMs，以及三个回调 onEdit / onRunRequestPull（缺省时按钮不做事，静态渲染照常出 DOM）。
 */
export const vcPlatformPageNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const model = vcPlatformModelOf(opts.reads, opts.ui, opts.width)
  const ctx = {
    edit: function (key: string, value: string) {
      if (typeof opts.onRpInput === 'function') opts.onRpInput(key, value)
    },
    run: function () {
      if (typeof opts.onRequestPull === 'function') opts.onRequestPull(model.requestPull.form)
    },
  }
  const children: any[] = [
    h('p', { key: 'lede', className: 'vcs-platform-lede', 'data-vc-platform-lede': '1' }, vcPlatformText(t, 'vc.platform.lede', null)),
    vcPlatformCredentialNode(h, t, model),
    vcPlatformUpdateRefsNode(h, t, model),
    vcPlatformRequestPullNode(h, t, model, ctx),
    vcPlatformNotesNode(h, t, model),
  ]
  return h('section', {
    key: 'platform',
    className: 'vcs-platform' + (model.narrow ? ' is-narrow' : ''),
    'data-vc-platform': '1',
    'data-vc-platform-state': model.state,
    'data-vc-platform-width': String(model.width),
  }, children)
}
