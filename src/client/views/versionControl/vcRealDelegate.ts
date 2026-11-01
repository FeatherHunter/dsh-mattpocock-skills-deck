// views/versionControl/vcRealDelegate.ts —— 真实页签的事件委托（#1776 M1）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 页面壳只输出 data-* 属性、不收回调（vcShellPages.ts 的既定契约）。容器把 onClick/onInput/onChange/onKeyDown
// 挂在根节点上，事件冒泡到这里后按「离得最近的目标属性」翻译成一条意图，交给容器分派。
// 这层不碰 React 状态：只做 DOM 读取与意图翻译，纯函数式的 vcRealClickIntentOf / vcRealInputIntentOf 可以单独测。

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

// 点击意图：顺序有意义——齿轮浮层里的分区按钮要先于外壳的齿轮按钮命中；页签、刷新、片级重试、返回、
//   历史详情这些第二层目标放后面，越具体的越靠前。返回 null 表示这次点击不归容器管（叶子自己处理）。
export const vcRealClickIntentOf = function (el: any): any {
  let hit: any = vcRealClosestOf(el, 'data-vc-gear-item')
  if (hit) return { kind: 'gear', page: vcRealAttrOf(hit, 'data-vc-gear-item') }
  if (vcRealClosestOf(el, 'data-vc-gear-btn')) return { kind: 'gearToggle' }
  if (vcRealClosestOf(el, 'data-vc-search-entry')) return { kind: 'searchEntry' }
  if (vcRealClosestOf(el, 'data-vc-branch-btn')) return { kind: 'branchToggle' }
  if (vcRealClosestOf(el, 'data-vc-branch-close')) return { kind: 'branchClose' }
  if (vcRealClosestOf(el, 'data-vc-sync')) return { kind: 'sync' }
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
  return null
}

// 输入意图：命令面板的搜索框是唯一需要容器的输入（壳里的 input 不带 onChange）。
export const vcRealInputIntentOf = function (el: any): any {
  if (vcRealClosestOf(el, 'data-vc-palette-input')) {
    return { kind: 'paletteInput', value: String(el && el.value !== undefined ? el.value : '') }
  }
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

// 把意图翻译成回调名：容器只实现一张动作表，这里决定点哪一项。
export const vcRealActionOf = function (intent: any): string {
  if (!intent) return ''
  const kind: string = String(intent.kind || '')
  if (kind === 'gear') return 'page'
  if (kind === 'gearToggle') return 'gearToggle'
  if (kind === 'searchEntry') return 'searchEntry'
  if (kind === 'branchToggle') return 'branchToggle'
  if (kind === 'branchClose') return 'branchClose'
  if (kind === 'sync') return 'sync'
  if (kind === 'palettePick') return 'palettePick'
  if (kind === 'tab') return 'tab'
  if (kind === 'refresh') return 'refresh'
  if (kind === 'sliceRetry') return 'sliceRetry'
  if (kind === 'retryAll') return 'retryAll'
  if (kind === 'back') return 'back'
  if (kind === 'page') return 'page'
  if (kind === 'historyOpen') return 'historyOpen'
  if (kind === 'historyBack') return 'historyBack'
  if (kind === 'loadMore') return 'loadMore'
  if (kind === 'historyRetry') return 'historyRetry'
  if (kind === 'filesRetry') return 'filesRetry'
  if (kind === 'fileDiffRetry') return 'fileDiffRetry'
  if (kind === 'historyFile') return 'historyFile'
  if (kind === 'paletteInput') return 'paletteInput'
  if (kind === 'tabKey') return 'tabKey'
  if (kind === 'escape') return 'escape'
  return ''
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

export const VC_REAL_DELEGATE_SOURCE = 'src/client/views/versionControl/vcRealDelegate.ts'
