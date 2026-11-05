// views/versionControl/vcRealDelegate.ts —— 真实页签的事件委托（#1776 M1/M2）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 页面壳只输出 data-* 属性、不收回调（vcShellPages.ts 的既定契约）。容器把 onClick/onInput/onChange/onKeyDown
// 挂在根节点上，事件冒泡到这里后按「离得最近的目标属性」翻译成一条意图，交给容器分派。
// 这层不碰 React 状态，也不发电话：只做 DOM 读取与意图翻译，纯函数可以单独测。
// 管理页（远端、分支板、同步、迁移）的按钮同样不带回调，都靠这里翻译；配置/钩子/诊断/子模块/
// 平台/冲突/变基/撤销这些页面自己带 onClick 的，走到这里会因找不到目标属性而返回 null。

declare const React: any

// 委托层本身不是可点控件，但全仓「能点的地方必须同时挂 data-log 与 data-press」这条判据是按源码里
// 出现 onClick 来认控件的；这里把两个属性名写成常量，明说这层知道接线契约。真正把属性挂到节点上的
// 地方是 vcRealTab 顶部那排按钮与各页面叶子。
export const VC_REAL_DELEGATE_LOG_ATTR = 'data-log'
export const VC_REAL_DELEGATE_PRESS_ATTR = 'data-press'

export const vcRealClosestOf = function (el: any, attr: string): any {
  if (!el || typeof el.closest !== 'function') return null
  return el.closest('[' + attr + ']')
}

export const vcRealAttrOf = function (el: any, attr: string): string {
  if (!el || typeof el.getAttribute !== 'function') return ''
  const v: any = el.getAttribute(attr)
  return v === null || v === undefined ? '' : String(v)
}

// 确认卡上的「确认」是 class 不是属性（vcShellConfirmCardNode 的既定形状），取消是属性。
const vcRealConfirmGoOf = function (el: any, scopeAttr: string): any {
  if (!el || typeof el.closest !== 'function') return null
  const go: any = el.closest('.vcs-confirm-go')
  if (!go) return null
  return vcRealClosestOf(go, scopeAttr) ? go : null
}

// 点击意图：顺序有意义——越具体的越靠前。管理页确认卡按所在容器（远端/分支板/同步）分开认，
//   因为三张卡共用同一套 class 与取消属性，只看 class 分不清该归哪一页。
export const vcRealClickIntentOf = function (el: any): any {
  let hit: any = vcRealClosestOf(el, 'data-vc-gear-item')
  if (hit) return { kind: 'gear', page: vcRealAttrOf(hit, 'data-vc-gear-item') }
  // 齿轮与身份行「管理」都打开管理索引屏（#1840）：索引是导航上的一站，不是浮层开合。
  if (vcRealClosestOf(el, 'data-vc-gear-btn')) return { kind: 'manageOpen' }
  if (vcRealClosestOf(el, 'data-vc-search-entry')) return { kind: 'searchEntry' }
  if (vcRealClosestOf(el, 'data-vc-branch-btn')) return { kind: 'branchToggle' }
  if (vcRealClosestOf(el, 'data-vc-branch-close')) return { kind: 'branchClose' }
  if (vcRealClosestOf(el, 'data-vc-sync')) return { kind: 'sync' }
  // 分支浮层里的五项动作：跳分支页并聚焦，不在这里执行；分支板行里的同名属性要先按浮层辨别。
  hit = vcRealClosestOf(el, 'data-vc-branch-overlay')
  if (hit) {
    const act: any = vcRealClosestOf(el, 'data-vc-branch-action')
    if (act) return { kind: 'branchOverlay', action: vcRealAttrOf(act, 'data-vc-branch-action') }
  }
  // #1846 命令面板遮罩：只有点在遮罩本身（而不是面板内部）才算关闭。判据用「最近带该属性的节点就是我」，
  //   光用 closest 会把面板里的每次点击都算到遮罩头上，点输入框也会把面板关掉。
  if (el && vcRealClosestOf(el, 'data-vc-palette-backdrop') === el) return { kind: 'paletteBackdrop' }
  // #1846 全库搜索页的结果行：选中只跳到那条能力的入口，落点与命令面板选中同一条规则。
  hit = vcRealClosestOf(el, 'data-vc-search-row')
  if (hit) return { kind: 'searchPick', capId: vcRealAttrOf(hit, 'data-vc-search-row') }
  hit = vcRealClosestOf(el, 'data-vc-palette-row')
  if (hit) return { kind: 'palettePick', capId: vcRealAttrOf(hit, 'data-vc-palette-row') }
  hit = vcRealClosestOf(el, 'data-vc-tab')
  if (hit) return { kind: 'tab', page: vcRealAttrOf(hit, 'data-vc-tab') }
  if (vcRealClosestOf(el, 'data-vc-refresh')) return { kind: 'refresh' }
  hit = vcRealClosestOf(el, 'data-vc-slice-retry')
  if (hit) return { kind: 'sliceRetry', sliceId: vcRealAttrOf(hit, 'data-vc-slice-retry') }
  if (vcRealClosestOf(el, 'data-vc-retry-all')) return { kind: 'retryAll' }
  if (vcRealClosestOf(el, 'data-vc-back')) return { kind: 'back' }
  hit = vcRealClosestOf(el, 'data-vc-extra-link')
  if (hit) return { kind: 'page', page: vcRealAttrOf(hit, 'data-vc-extra-link') }
  // 远端页：四条写动作、四个表单、联网查看与两条重试。
  if (vcRealClosestOf(el, 'data-vc-remote-confirm')) {
    if (vcRealConfirmGoOf(el, 'data-vc-remote-confirm')) return { kind: 'remoteConfirmGo', name: vcRealAttrOf(vcRealClosestOf(el, 'data-vc-remote-confirm'), 'data-vc-remote-confirm') }
    if (vcRealClosestOf(el, 'data-vc-confirm-cancel')) return { kind: 'remoteConfirmCancel' }
  }
  hit = vcRealClosestOf(el, 'data-vc-remote-trigger')
  if (hit) return { kind: 'remoteTrigger', form: vcRealAttrOf(hit, 'data-vc-remote-trigger') }
  hit = vcRealClosestOf(el, 'data-vc-remote-submit')
  if (hit) return { kind: 'remoteSubmit', form: vcRealAttrOf(hit, 'data-vc-remote-submit'), el: hit }
  if (vcRealClosestOf(el, 'data-vc-remote-cancel')) return { kind: 'remoteCancel' }
  hit = vcRealClosestOf(el, 'data-vc-remote-online-btn')
  if (hit) return { kind: 'remoteOnline', name: vcRealAttrOf(hit, 'data-vc-remote-online-btn') }
  if (vcRealClosestOf(el, 'data-vc-remote-back')) return { kind: 'remoteBack' }
  if (vcRealClosestOf(el, 'data-vc-remote-online-retry')) return { kind: 'remoteOnlineRetry' }
  if (vcRealClosestOf(el, 'data-vc-remote-retry')) return { kind: 'remoteRetry' }
  // 分支板：行内六种动作、标签两种、表单行提交、确认卡、板面重试。
  if (vcRealClosestOf(el, 'data-vc-branch2')) {
    if (vcRealConfirmGoOf(el, 'data-vc-branch2')) return { kind: 'branchConfirmGo' }
    if (vcRealClosestOf(el, 'data-vc-confirm-cancel')) return { kind: 'branchConfirmCancel' }
    hit = vcRealClosestOf(el, 'data-vc-branch-row') || vcRealClosestOf(el, 'data-vc-op-row')
    if (hit && vcRealClosestOf(el, 'data-vc-branch-action')) {
      const btn: any = vcRealClosestOf(el, 'data-vc-branch-action')
      return { kind: 'branchBtn', action: vcRealAttrOf(btn, 'data-vc-branch-action'), op: vcRealAttrOf(btn, 'data-vc-op'), name: vcRealAttrOf(hit, 'data-vc-branch-row'), form: vcRealAttrOf(btn, 'data-vc-branch-form') === '1', el: btn }
    }
    // #1881 新增 A：标签行的「检出」是页面内的预填动作（起点进页尾表单），不是写动作；
    //   它由组件自己的 onClick 接住，这里明确回 null，免得被当成 4.11 / 4.12 那样发一次预检电话。
    if (vcRealClosestOf(el, 'data-vc-tag-action="checkout"')) return null
    hit = vcRealClosestOf(el, 'data-vc-tag-row')
    if (hit && vcRealClosestOf(el, 'data-vc-tag-action')) {
      const btn: any = vcRealClosestOf(el, 'data-vc-tag-action')
      return { kind: 'branchTagBtn', action: vcRealAttrOf(btn, 'data-vc-tag-action'), op: vcRealAttrOf(btn, 'data-vc-op'), name: vcRealAttrOf(hit, 'data-vc-tag-name') }
    }
    if (vcRealClosestOf(el, 'data-vc-branch2-retry')) return { kind: 'branchRetry' }
  }
  // 同步页：十行动作、预检、确认卡、删引用时选分支还是标签、任务取消。
  hit = vcRealClosestOf(el, 'data-vc-sync-page')
  if (hit) {
    if (vcRealClosestOf(el, 'data-vc-sync-confirm')) {
      if (vcRealConfirmGoOf(el, 'data-vc-sync-confirm')) return { kind: 'syncConfirmGo' }
      if (vcRealClosestOf(el, 'data-vc-confirm-cancel')) return { kind: 'syncConfirmCancel' }
    }
    let sub: any = vcRealClosestOf(el, 'data-vc-sync-check')
    if (sub) return { kind: 'syncCheck', id: vcRealAttrOf(sub, 'data-vc-sync-check') }
    sub = vcRealClosestOf(el, 'data-vc-sync-act')
    if (sub) return { kind: 'syncAct', id: vcRealAttrOf(sub, 'data-vc-sync-act') }
    sub = vcRealClosestOf(el, 'data-vc-sync-kind')
    if (sub) return { kind: 'syncKind', value: vcRealAttrOf(sub, 'data-vc-sync-kind') }
    if (vcRealClosestOf(el, 'data-vc-sync-cancel')) return { kind: 'syncCancel' }
    if (vcRealClosestOf(el, 'data-vc-sync-retry')) return { kind: 'syncRetry' }
  }
  // 迁移页：展开面板、预检（只读动作也走这里）、凭票执行、收面板。
  hit = vcRealClosestOf(el, 'data-vc-migrate-page')
  if (hit) {
    let sub: any = vcRealClosestOf(el, 'data-vc-migrate-check')
    if (sub) return { kind: 'migrateCheck', action: vcRealAttrOf(sub, 'data-vc-migrate-check'), el: sub }
    sub = vcRealClosestOf(el, 'data-vc-migrate-go')
    if (sub) return { kind: 'migrateGo', action: vcRealAttrOf(sub, 'data-vc-migrate-go') }
    sub = vcRealClosestOf(el, 'data-vc-migrate-act')
    if (sub) return { kind: 'migrateAct', action: vcRealAttrOf(sub, 'data-vc-migrate-act') }
    if (vcRealClosestOf(el, 'data-vc-migrate-cancel')) return { kind: 'migrateCancel' }
  }
  // #1903 提交历史页四条能力：搜索范围、只看某个文件、比较两个引用、提交备注。
  //   顺序讲究：详情里文件行的「⋯」与菜单项都要先于整行打开认掉，否则点「看这个文件的历史」会连带展开那一行。
  hit = vcRealClosestOf(el, 'data-vc-history-scope-btn')
  if (hit) return { kind: 'historyScope', value: vcRealAttrOf(hit, 'data-vc-history-scope-btn') }
  hit = vcRealClosestOf(el, 'data-vc-history-file-history')
  if (hit) return { kind: 'historyFileOnly', path: vcRealAttrOf(hit, 'data-vc-history-file-history') }
  if (vcRealClosestOf(el, 'data-vc-history-file-menu-close')) return { kind: 'historyFileMenuClose' }
  hit = vcRealClosestOf(el, 'data-vc-history-file-more')
  if (hit) return { kind: 'historyFileMenu', path: vcRealAttrOf(hit, 'data-vc-history-file-more') }
  if (vcRealClosestOf(el, 'data-vc-history-file-only-clear')) return { kind: 'historyFileOnlyClear' }
  hit = vcRealClosestOf(el, 'data-vc-history-file-retry')
  if (hit) return { kind: 'historyFileRetry', path: vcRealAttrOf(hit, 'data-vc-history-file-retry') }
  if (vcRealClosestOf(el, 'data-vc-history-compare-open')) return { kind: 'historyCompareOpen' }
  if (vcRealClosestOf(el, 'data-vc-history-compare-apply')) return { kind: 'historyCompareApply' }
  if (vcRealClosestOf(el, 'data-vc-history-compare-cancel')) return { kind: 'historyCompareCancel' }
  if (vcRealClosestOf(el, 'data-vc-history-compare-end')) return { kind: 'historyCompareEnd' }
  if (vcRealClosestOf(el, 'data-vc-history-note-save')) return { kind: 'historyNoteSave' }
  // 历史行的菜单贴在行尾，按钮本身带 data-vc-history-more；先认菜单与开关，再认整行打开。
  hit = vcRealClosestOf(el, 'data-vc-history-menu-cap')
  if (hit) return { kind: 'historyMenuCap', capId: vcRealAttrOf(hit, 'data-vc-history-menu-cap') }
  hit = vcRealClosestOf(el, 'data-vc-history-menu-copy')
  if (hit) return { kind: 'historyMenuCopy', oid: vcRealAttrOf(hit, 'data-vc-history-menu-copy') }
  if (vcRealClosestOf(el, 'data-vc-history-menu-close')) return { kind: 'historyMenuClose' }
  hit = vcRealClosestOf(el, 'data-vc-history-more')
  if (hit) return { kind: 'historyMenu', oid: vcRealAttrOf(hit, 'data-vc-history-more') }
  if (vcRealClosestOf(el, 'data-vc-history-merge-only')) return { kind: 'historyMerge' }
  hit = vcRealClosestOf(el, 'data-vc-history-open')
  if (hit) return { kind: 'historyOpen', oid: vcRealAttrOf(hit, 'data-vc-history-open') }
  if (vcRealClosestOf(el, 'data-vc-history-back')) return { kind: 'historyBack' }
  if (vcRealClosestOf(el, 'data-vc-load-more')) return { kind: 'loadMore' }
  if (vcRealClosestOf(el, 'data-vc-history-more-retry')) return { kind: 'historyRetry' }
  hit = vcRealClosestOf(el, 'data-vc-history-retry')
  if (hit) return { kind: 'historyRetry' }
  if (vcRealClosestOf(el, 'data-vc-history-files-retry')) return { kind: 'filesRetry' }
  if (vcRealClosestOf(el, 'data-vc-file-diff-retry')) return { kind: 'fileDiffRetry' }
  hit = vcRealClosestOf(el, 'data-vc-history-file')
  if (hit) return { kind: 'historyFile', path: vcRealAttrOf(hit, 'data-vc-history-file') }
  // 能力行整行可点：点了跳该页并高亮，不自动执行。行内还有按钮/输入（命令面板）时不抢那些控件。
  if (!vcRealClosestOf(el, 'button') && !vcRealClosestOf(el, 'input') && !vcRealClosestOf(el, 'select')) {
    hit = vcRealClosestOf(el, 'data-cap-row')
    if (hit) return { kind: 'capRow', capId: vcRealAttrOf(hit, 'data-cap-primary') }
  }
  return null
}

// 输入意图：除了命令面板的搜索框，两个管理页的输入框也要把值送回容器（远端表单、迁移字段、同步输入、分支表单）。
export const vcRealInputIntentOf = function (el: any): any {
  // #1846 全库搜索页自己的输入框：与命令面板共用 nav.query 这一份，切页回来还能看见上次搜的词。
  if (vcRealClosestOf(el, 'data-vc-search-input')) {
    return { kind: 'searchInput', value: String(el && el.value !== undefined ? el.value : '') }
  }
  if (vcRealClosestOf(el, 'data-vc-palette-input')) {
    return { kind: 'paletteInput', value: String(el && el.value !== undefined ? el.value : '') }
  }
  let hit: any = vcRealClosestOf(el, 'data-vc-remote-field')
  if (hit) return { kind: 'remoteField', field: vcRealAttrOf(hit, 'data-vc-remote-field'), value: String(el && el.value !== undefined ? el.value : '') }
  hit = vcRealClosestOf(el, 'data-vc-sync-input')
  if (hit) return { kind: 'syncField', field: vcRealAttrOf(hit, 'data-vc-sync-input'), value: String(el && el.value !== undefined ? el.value : '') }
  hit = vcRealClosestOf(el, 'data-vc-history-query')
  if (hit) return { kind: 'historyQuery', value: String(el && el.value !== undefined ? el.value : '') }
  // 比较表单的两个输入框与详情里那段备注：值回容器，容器只改本地界面状态，不直接发电话。
  hit = vcRealClosestOf(el, 'data-vc-history-compare-field')
  if (hit) return { kind: 'historyCompareField', which: vcRealAttrOf(hit, 'data-vc-history-compare-field'), value: String(el && el.value !== undefined ? el.value : '') }
  hit = vcRealClosestOf(el, 'data-vc-history-note-input')
  if (hit) return { kind: 'historyNoteInput', value: String(el && el.value !== undefined ? el.value : '') }
  hit = vcRealClosestOf(el, 'data-vc-branch-input')
  if (hit) return { kind: 'branchField', field: vcRealAttrOf(hit, 'data-vc-branch-input'), value: String(el && el.value !== undefined ? el.value : '') }
  return null
}

// 键盘意图：Esc 关浮层；左右方向键/Home/End 在四个固定页签之间走。只有焦点在页签上才拦方向键，
//   否则留给页内滚动与其它控件。
export const vcRealKeyIntentOf = function (el: any, key: any): any {
  const k: string = String(key || '')
  if (k === 'Escape') return { kind: 'escape' }
  if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return null
  const tab: any = vcRealClosestOf(el, 'data-vc-tab')
  if (!tab) return null
  return { kind: 'tabKey', key: k, page: vcRealAttrOf(tab, 'data-vc-tab') }
}

// 意图 → 回调名的一张表：容器只实现这些回调，这里决定点哪一项。
//   表放在模块级只建一次；键是意图的 kind，值是容器回调表里的名字。
const VC_REAL_ACTION_OF: any = {
    gear: 'page', manageOpen: 'manageOpen', searchEntry: 'searchEntry', branchToggle: 'branchToggle',
    branchClose: 'branchClose', sync: 'sync', branchOverlay: 'branchOverlay', palettePick: 'palettePick',
    tab: 'tab', refresh: 'refresh', sliceRetry: 'sliceRetry', retryAll: 'retryAll', back: 'back', page: 'page',
    remoteTrigger: 'remoteTrigger', remoteSubmit: 'remoteSubmit', remoteCancel: 'remoteCancel',
    remoteOnline: 'remoteOnline', remoteBack: 'remoteBack', remoteOnlineRetry: 'remoteOnlineRetry',
    remoteRetry: 'remoteRetry', remoteConfirmGo: 'remoteConfirmGo', remoteConfirmCancel: 'remoteConfirmCancel',
    branchBtn: 'branchBtn', branchTagBtn: 'branchTagBtn', branchConfirmGo: 'branchConfirmGo',
    branchConfirmCancel: 'branchConfirmCancel', branchRetry: 'branchRetry',
    syncAct: 'syncAct', syncCheck: 'syncCheck', syncConfirmGo: 'syncConfirmGo', syncConfirmCancel: 'syncConfirmCancel',
    syncKind: 'syncKind', syncCancel: 'syncCancel', syncRetry: 'syncRetry',
    migrateAct: 'migrateAct', migrateCheck: 'migrateCheck', migrateGo: 'migrateGo', migrateCancel: 'migrateCancel',
    historyOpen: 'historyOpen', historyBack: 'historyBack', loadMore: 'loadMore', historyRetry: 'historyRetry',
    filesRetry: 'filesRetry', fileDiffRetry: 'fileDiffRetry', historyFile: 'historyFile',
    historyQuery: 'historyQuery', historyMerge: 'historyMerge', historyMenu: 'historyMenu',
    historyScope: 'historyScope', historyFileOnly: 'historyFileOnly', historyFileOnlyClear: 'historyFileOnlyClear',
    historyFileMenu: 'historyFileMenu', historyFileMenuClose: 'historyFileMenuClose', historyFileRetry: 'historyFileRetry',
    historyCompareOpen: 'historyCompareOpen', historyCompareApply: 'historyCompareApply', historyCompareCancel: 'historyCompareCancel',
    historyCompareEnd: 'historyCompareEnd', historyCompareField: 'historyCompareField',
    historyNoteSave: 'historyNoteSave', historyNoteInput: 'historyNoteInput',
    historyMenuClose: 'historyMenuClose', historyMenuCap: 'historyMenuCap', historyMenuCopy: 'historyMenuCopy',
    paletteBackdrop: 'paletteBackdrop', searchPick: 'searchPick', searchInput: 'searchInput',
    paletteInput: 'paletteInput', tabKey: 'tabKey', escape: 'escape',
    remoteField: 'remoteField', syncField: 'syncField', branchField: 'branchField', capRow: 'capRow',
}

export const vcRealActionOf = function (intent: any): any {
  if (!intent) return ''
  const kind: string = String(intent.kind || '')
  return VC_REAL_ACTION_OF[kind] || ''
}

// React 侧的绑定器：每个容器实例持有一份回调表（放在 useRef 里，不随重画丢），返回可直接铺在根节点上的
//   四个事件属性。事件处理里先取意图、命中才 preventDefault，最后按动作表调回调。
export const vcRealDelegateOf = function (callbacks: any): any {
  const table: any = callbacks || {}
  const fire = function (intent: any): any {
    const name: string = vcRealActionOf(intent)
    if (!name || typeof table[name] !== 'function') return
    table[name](intent)
  }
  return {
    onClick: function (ev: any) {
      const intent: any = vcRealClickIntentOf(ev && ev.target)
      if (!intent) return
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault()
      fire(intent)
    },
    onInput: function (ev: any) {
      const intent: any = vcRealInputIntentOf(ev && ev.target)
      if (!intent) return
      fire(intent)
    },
    onChange: function (ev: any) {
      const intent: any = vcRealInputIntentOf(ev && ev.target)
      if (!intent) return
      fire(intent)
    },
    onKeyDown: function (ev: any) {
      const intent: any = vcRealKeyIntentOf(ev && ev.target, ev && ev.key)
      if (!intent) return
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault()
      fire(intent)
    },
  }
}

// ———— 表单取值 ————
// 远端表单、迁移面板与分行动作的输入都是非受控的（页面只给 defaultValue），值只在 DOM 里；
// 提交时当场读一次，读完就把值交给动作层，容器不另存一份表单草稿。
export const vcRealFieldValuesOf = function (scopeEl: any, fieldAttr: string): any {
  const out: any = {}
  if (!scopeEl || typeof scopeEl.querySelectorAll !== 'function') return out
  const list: any = scopeEl.querySelectorAll('[' + fieldAttr + ']')
  for (let i = 0; i < list.length; i += 1) {
    const input: any = list[i]
    const name: string = vcRealAttrOf(input, fieldAttr)
    if (name === '') continue
    out[name] = input && input.type === 'checkbox' ? input.checked === true : String(input && input.value !== undefined ? input.value : '')
  }
  return out
}

// 远端表单：从提交按钮往上找表单容器，读出 name/url/from/to 四格。
export const vcRealRemoteValuesOf = function (el: any): any {
  if (!el || typeof el.closest !== 'function') return {}
  const form: any = el.closest('[data-vc-remote-form]')
  return form ? vcRealFieldValuesOf(form, 'data-vc-remote-field') : {}
}

// 迁移面板：按动作名找那一格面板，读它的输入框（含 init 的 bare 勾选框）。
export const vcRealMigrateFieldsOf = function (rootEl: any, action: any): any {
  if (!rootEl || typeof rootEl.querySelector !== 'function') return {}
  const panel: any = rootEl.querySelector('[data-vc-migrate-panel="' + String(action || '') + '"]')
  return panel ? vcRealFieldValuesOf(panel, 'data-vc-migrate-field') : {}
}

// 分行动作的一个输入口：表单行只有一格文本框，不同 kind 的字段不同，这里按 kind 拆开成宿主认的字段。
// 行内按钮（切分支/删分支/标签动作）不需要输入框，字段来自按钮上的 data-* 与当前分支名。
export const vcRealBranchFieldsOf = function (intent: any, current: any): any {
  const it: any = intent || {}
  const kind: string = String(it.action || '')
  const name: string = String(it.name || '')
  const btn: any = it.el
  const row: any = btn && typeof btn.closest === 'function' ? btn.closest('[data-vc-op-row]') : null
  const input: any = row && typeof row.querySelector === 'function' ? row.querySelector('[data-vc-branch-input]') : null
  const raw: string = String(input && input.value !== undefined ? input.value : '').trim()
  const parts: string[] = raw === '' ? [] : raw.split(/\s+/)
  if (kind === 'switch' || kind === 'delete') return { name: name || raw }
  if (kind === 'detach') return { rev: raw }
  if (kind === 'rename') return { from: parts[0] || name, to: parts[1] || '' }
  if (kind === 'upstream') return parts.length > 1 ? { branch: parts[0], upstream: parts[1] } : { branch: parts[0] || String(current || '') }
  if (kind === 'describe') return { branch: parts[0] || String(current || ''), text: parts[1] || parts[0] || '' }
  if (kind === 'verify') return name !== '' ? { object: name, objectKind: 'tag' } : { object: raw, objectKind: 'commit' }
  if (kind === 'create') {
    // #1881 新增 A：标签行「检出」预填过起点时，这一行带 data-vc-branch-from，输入框第一段就是那个标签；
    //   读者在后面写新分支名。这时把起点当 from、剩下的当 name，不按默认的「名字在前」拆。
    const pinned: string = row && typeof row.getAttribute === 'function' ? String(row.getAttribute('data-vc-branch-from') || '') : ''
    if (pinned !== '' && parts[0] === pinned) return { name: parts.slice(1).join(' '), from: pinned }
    return parts.length > 1 ? { name: parts[0], from: parts[1] } : { name: parts[0] || '' }
  }
  if (kind === 'tag-create') return { name: raw }
  if (kind === 'tag-delete') return { name: name || raw }
  return {}
}

export const VC_REAL_DELEGATE_SOURCE = 'src/client/views/versionControl/vcRealDelegate.ts'