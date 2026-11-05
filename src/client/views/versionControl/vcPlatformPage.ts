// views/versionControl/vcPlatformPage.ts —— 「平台与边界」页正文（#1762 T26；#1844 按定稿原型 47 重排）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 正文的分区顺序照定稿原型 47（docs/prototype/vc-redesign/src/ui/views/pages-system.ts 的 renderPlatform）：
//   交出去的六条能力（14.2、14.4–14.8）→ 四条边界。
// 原型没有、但本产品必须有的三段排在原型分区之后：凭据链（8.15）→ 其他分支指针（5.9，四种状态）→
//   请求拉取说明（14.3）→ 指回提交历史页的 13.14 说明。这条顺序是验收口径：首屏与原型一致，额外区块只许往后加。
// 页头（标题、导语、「含不可逆动作」以外的页级标记）由页面壳的 vcPageHeadNode 画，本文件不再画标题与导语。
//
// 全部只读或说明，没有一条写动作：凭据链与 updateRefs 各自有加载 / 失败态，不拿「没读到」冒充「没开」。
// 六条「交出去的能力」右侧只有只读徽章：平台读数只有 credential / updateRefs / repoRoot，没有远端地址，
//   画「在网页打开」得先新增一次远端读取或改读数协议；票面明令不改协议，所以「去哪里做」由文字承担。
//
// 本页不画 data-cap-primary、也不画 data-surface：那九条能力的主入口在命令面板，
//   这里再画一个就成了「一个能力两个主入口」，门禁 Z1d 会当场判红。

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
// 页面骨架原语在同一个构建闭包里（vcPageHead 排在页面壳之前），这里只声明形状，不 import。
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageObjRowNode(h: any, t: any, o: any): any
declare function vcPageCapSummaryNode(h: any, t: any, capId: any, label?: any): any

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_PLATFORM_PAGE_SOURCE = 'src/client/views/versionControl/vcPlatformPage.ts'
/** 这一页承载的九条能力编号（8.15 / 5.9 / 14.2 / 14.3 / 14.4–14.8），顺序与账本无关，只用于门禁对账。 */
export const VC_PLATFORM_PAGE_CAP_IDS: string[] = ['8.15', '5.9', '14.2', '14.3', '14.4', '14.5', '14.6', '14.7', '14.8']
/** 交出去的六条能力：14.2 是外部邮件，14.4–14.8 是托管平台网页端能力。顺序按编号，门禁按行核对。 */
export const VC_PLATFORM_OUTBOUND_IDS: string[] = ['14.2', '14.4', '14.5', '14.6', '14.7', '14.8']
/** 四条边界：值同时用作 data-vc-platform-boundary 的取值与词条键中段；顺序写死，门禁按行核对。 */
export const VC_PLATFORM_BOUNDARY_KEYS: string[] = ['editor', 'token', 'longtask', 'rewrite']

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

/**
 * 交出去的六条能力（原型 47 的第一段）：每行一条只读说明。
 * 行里三行字：能力摘要（编号 / 名称 / 动作强度，都来自账本）→ 去哪里做 → 这条能力是什么；
 * 右侧只有只读徽章。没有可点控件——这一页本来就不替人做平台动作。
 */
const vcPlatformOutboundRows = function (h: any, t: any) {
  return VC_PLATFORM_OUTBOUND_IDS.map(function (capId: string) {
    const cap: any = vcCapabilityOf(capId) || {}
    const main: any[] = [
      vcPageCapSummaryNode(h, t, capId),
      h('span', { key: 'where', className: 'obj-meta' }, vcPlatformText(t, 'vc.platform.outbound.where.' + capId, null)),
      h('span', { key: 'note', className: 'obj-sub' }, vcPlatformText(t, 'vc.platform.note.' + capId, null)),
    ]
    const command: string = String(cap.command || '')
    if (command !== '') main.push(h('span', { key: 'cmd', className: 'obj-meta is-mono' }, command))
    return vcPageObjRowNode(h, t, {
      main: main,
      side: [h('span', { key: 'chip', className: 'page-chip is-read' }, vcPlatformText(t, 'vc.platform.outbound.chip', null))],
      attrs: { 'data-vc-platform-outbound': capId },
    })
  })
}

/** 四条边界（原型 47 的第二段）：每行「不做什么 + 为什么」，只解释责任边界，没有动作。 */
const vcPlatformBoundaryRows = function (h: any, t: any) {
  return VC_PLATFORM_BOUNDARY_KEYS.map(function (key: string) {
    return vcPageObjRowNode(h, t, {
      main: [
        h('span', { key: 'title', className: 'obj-title' }, vcPlatformText(t, 'vc.platform.boundaries.' + key + '.title', null)),
        h('span', { key: 'sub', className: 'obj-sub' }, vcPlatformText(t, 'vc.platform.boundaries.' + key + '.sub', null)),
      ],
      side: null,
      attrs: { 'data-vc-platform-boundary': key },
    })
  })
}

/**
 * 凭据链（8.15，额外区块）：只读展示本机配置的 credential.helper 链与「面板不持有凭据」，
 * store 命中时只读标红并建议换 credential manager / cache；没有输入框，不读、不写、不落盘令牌。
 */
const vcPlatformCredentialKids = function (h: any, t: any, model: any) {
  const c = model.credential || {}
  const kids: any[] = [
    h('p', { key: 'note', className: 'page-note', 'data-vc-platform-cred-note': 'no-credentials-held' }, vcPlatformText(t, 'vc.platform.cred.note', null)),
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
  // 旧版挂在外层 section 上的 data-vc-platform-cred 挪到本块根节点：语义仍在，门禁与老断言照旧按名字定位。
  return h('div', { key: 'cred', className: 'vcs-platform-block', 'data-vc-platform-cred': '1' }, kids)
}

/**
 * 其他分支指针（5.9，额外区块）：四种状态都要有呈现——off 画「没开」、on 画当前值与「预检会拒绝」、
 * 读不到（unknown）画「没有读到值」，min 说明这条能力要 git 2.38 以上。
 */
const vcPlatformUpdateRefsKids = function (h: any, t: any, model: any) {
  const u = model.updateRefs || {}
  const cap = vcCapabilityOf('5.9') || {}
  const mark = u.state !== 'ok' ? 'unknown' : (u.enabled ? 'on' : 'off')
  const kids: any[] = [
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
  return h('div', { key: 'update-refs', className: 'vcs-platform-block', 'data-vc-platform-update-refs-block': '1' }, kids)
}

/** 请求拉取（14.3，额外区块）：三个输入 + 一个只读按钮；结果贴在这一块里，截断时如实说只显示了前一段。 */
const vcPlatformRequestPullKids = function (h: any, t: any, model: any, ctx: any) {
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
    h('div', { key: 'fields', className: 'vcs-platform-fields' }, [
      field('start', 'vc.platform.rp.start', 'start', form.start),
      field('url', 'vc.platform.rp.url', 'url', form.url),
      field('end', 'vc.platform.rp.end', 'end', form.end),
    ]),
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
  return h('div', { key: 'rp', className: 'vcs-platform-block', 'data-vc-platform-rp': '1' }, kids)
}

/**
 * 平台与边界页的正文。入参：
 *   reads（平台读数，见 vcPlatformData.ts）、ui（request-pull 表单里已输入的值）、
 *   width、nowMs，以及两个回调 onRpInput / onRequestPull（缺省时按钮不做事，静态渲染照常出 DOM）。
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
    vcPageSectionNode(h, t, {
      sectionKey: 'outbound',
      title: 'vc.platform.section.outbound.title',
      countText: 'vc.platform.section.outbound.count',
      note: 'vc.platform.section.outbound.note',
      children: vcPlatformOutboundRows(h, t),
    }),
    vcPageSectionNode(h, t, {
      sectionKey: 'boundaries',
      title: 'vc.platform.section.boundaries.title',
      note: 'vc.platform.section.boundaries.note',
      children: vcPlatformBoundaryRows(h, t),
    }),
    // 以下四段原型没有，按「额外区块排在原型之后」接在后面。
    vcPageSectionNode(h, t, {
      sectionKey: 'credentials',
      title: 'vc.platform.section.credentials.title',
      countText: 'vc.platform.section.credentials.count',
      note: 'vc.platform.section.credentials.note',
      children: [vcPageObjRowNode(h, t, { main: [vcPageCapSummaryNode(h, t, '8.15')], side: null }), vcPlatformCredentialKids(h, t, model)],
    }),
    vcPageSectionNode(h, t, {
      sectionKey: 'update-refs',
      title: 'vc.platform.section.updateRefs.title',
      countText: 'vc.platform.section.updateRefs.count',
      note: 'vc.platform.section.updateRefs.note',
      children: [vcPageObjRowNode(h, t, { main: [vcPageCapSummaryNode(h, t, '5.9')], side: null }), vcPlatformUpdateRefsKids(h, t, model)],
    }),
    vcPageSectionNode(h, t, {
      sectionKey: 'request-pull',
      title: 'vc.platform.section.requestPull.title',
      countText: 'vc.platform.section.requestPull.count',
      note: 'vc.platform.section.requestPull.note',
      children: [vcPageObjRowNode(h, t, { main: [vcPageCapSummaryNode(h, t, '14.3')], side: null }), vcPlatformRequestPullKids(h, t, model, ctx)],
    }),
    // 13.14 的主入口在提交历史页：这一页只留一句指回说明（旧版这句由页面壳画在页头之前，
    //   #1844 按原型把页头放回第一屏，说明挪到正文最后一段，记号 data-vc-note 保持原样）。
    vcPageSectionNode(h, t, {
      sectionKey: 'pointer',
      title: 'vc.platform.section.pointer.title',
      children: [h('div', { key: 'pointer', className: 'vcs-note', 'data-vc-note': 'platform-pointer' }, vcPlatformText(t, 'vc.shell.platform.pointer', null))],
    }),
  ]
  return h('section', {
    className: 'vcs-platform page-stack' + (model.narrow ? ' is-narrow' : ''),
    'data-vc-platform': '1',
    'data-vc-platform-state': model.state,
    'data-vc-platform-width': String(model.width),
  }, children)
}
