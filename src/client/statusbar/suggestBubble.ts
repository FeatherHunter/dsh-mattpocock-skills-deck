// src/client/statusbar/suggestBubble.ts —— 「下一步建议」气泡的渲染与交互薄壳（#1411）
//
// 职责：把取数层（#1409 的 suggestStream）交来的 items = {intro, prompt, reason}[] 画成状态胶囊
// 上方的一组气泡：每颗选项是一颗按钮，按钮上只印简介（#1451 后续：原来印「简介 + 提示词」两段，
// 用户要求只留简介）；完整提示词不进按钮，点一下才把它交给既有的「填进输入框」口子（kernel 的
// inject，自带补尾换行、注入提示与光标落末尾），随后关闭按钮立刻消失、每颗胶囊化作小泡向上飘走，
// 飘完整组收起（#1451 用户拍板）；
// 点关闭按钮同样整组消失（等于一条都不选），走的是更短的整组淡出。
//
// 一行排满：每颗按钮的最大宽度按当前条数均分整组宽度（见下面 pillCapPx），条数越多每颗越窄，
// 三条、四条都排得进一行；只有窄到每颗连一个字都放不下时，才靠选项行的 flex-wrap 换行。
//
// 为什么挂页面浮层而不是就地渲染：状态栏那一层有 overflow 裁剪，就地渲染会把气泡切掉。
// 挂 body 的做法与胶囊弹菜单同一招（kernel:portal 的 PortalOverlay 直接调用，第二个参数是子节点），
// 层级用 suggestAppearance 里的具名常量 SUGGEST_Z（与胶囊同层，宿主设置面板能盖住它，#1665）；
// 悬停理由用框正上方的浮层（.dsws-sugg-pop，样式叶子画、位置固定在框顶边、不跟鼠标走），读屏照旧从按钮的 aria-label 念。
//
// 硬约束（票面 #1411）：
//   - 只读借用：界面绝不碰会话服务里那几个保活接口（#1409 已设守卫，本文件连 sessions 都不提）；
//   - 不新增常驻定时器：只用一次性 DOM 监听（resize / scroll / keydown），卸载即摘；
//   - 数据防御：缺字段、空数组、条数越界都不许崩，也不假设 item 形状合法；
//   - 不新增日志事件：#1409 已有 suggest.bind/call/ready，本票只挂既有交互标识（data-log / data-press）。
//
// 契约（与仓库其它叶子文件同一套，见 scripts/build.mts 里的叶子清单）：
//   模块真源是 ESM 导出，构建时剥掉行首 export 拼进 apply 闭包；运行时不许跨文件 import；
//   不许 export default；只写可剥离的 TypeScript（不用 enum、不用构造函数参数属性）。
declare const PortalOverlay: any;
declare function inject(...args: any[]): any;
declare const SUGGEST_Z: any;
declare const SUGGEST_APPEARANCE: any;
declare function createSuggestEngine(...args: any[]): any;

/** 一组建议最多显示多少颗按钮：与工具/取数层同一组上下限，界面这层只防越界，不重复校验内容。 */
const SUGGEST_VIEW_MAX_ITEMS = 4

/**
 * 清洗 items：只留 prompt 是非空字符串的条目，条数截到上限；reason 不是字符串就当没有理由；
 * priority 不是有效数字就当没打分（null），排序与浮层都不认它。
 * 为什么要再洗一遍：取数层保证的是「工具参数校验过」，但界面侧不假设数据一定合法（票面⑥）。
 */
export const suggestViewItemsOf = function (items: any) {
  const out: any[] = []
  try {
    if (!Array.isArray(items)) return out
    for (let i = 0; i < items.length && out.length < SUGGEST_VIEW_MAX_ITEMS; i++) {
      const item = items[i]
      if (!item || typeof item !== 'object') continue
      const prompt = item.prompt
      if (typeof prompt !== 'string' || !prompt) continue
      const intro = (typeof item.intro === 'string') ? item.intro : ''
      const reason = (typeof item.reason === 'string') ? item.reason : ''
      const priority = (typeof item.priority === 'number' && Number.isFinite(item.priority)) ? item.priority : null
      out.push({ intro: intro, prompt: prompt, reason: reason, priority: priority })
    }
  } catch (eItems) {}
  return out
}

/** 找输入框：textarea 或 contenteditable 里量得到宽高、宽度最大的那个（界面上可能还有小的
 *  搜索框与隐藏输入域，输入框是最宽的那个；量不到宽高的一律跳过）。
 *  #1665 起它只是锚点的兜底：胶囊量不到时才用它，平时锚点跟胶囊走。 */
export const suggestInputOf = function () {
  try {
    if (typeof document === 'undefined' || !document.querySelectorAll) return null
    const nodes = document.querySelectorAll('textarea, [contenteditable="true"]')
    let widest: any = null
    let widestPx = 0
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i] as any
      if (!el || typeof el.getBoundingClientRect !== 'function') continue
      if (el.disabled) continue
      if (typeof el.getAttribute === 'function' && el.getAttribute('aria-hidden') === 'true') continue
      const rect = el.getBoundingClientRect()
      const width = Number(rect && rect.width) || 0
      const height = Number(rect && rect.height) || 0
      if (!width || !height) continue
      if (width > widestPx) { widestPx = width; widest = el }
    }
    return widest
  } catch (eInput) { return null }
}

/** 把一个元素的屏幕矩形换成整组落点：横向取中心，纵向取「顶边到视口底边」再加间距。
 *  量不到宽高（隐藏、jsdom 没布局）返回 null，由调用方换下一种锚点。 */
function anchorOfRect(rect: any) {
  const width = Number(rect && rect.width) || 0
  const height = Number(rect && rect.height) || 0
  if (!width && !height) return null
  const viewHeight = (typeof window !== 'undefined' && Number(window.innerHeight)) || 0
  const gap = Number(SUGGEST_APPEARANCE && SUGGEST_APPEARANCE.gapAboveCapsule) || 0
  return { left: Math.round((Number(rect.left) || 0) + width / 2), bottom: Math.round(viewHeight - (Number(rect.top) || 0)) + gap }
}

/**
 * 量气泡锚点：优先状态胶囊（探针节点最近的 .dsws-capsule，横向取胶囊中心）。
 * 为什么跟胶囊不跟输入框：输入框的高度随对话框内容增减，内容一多顶边上移，
 * 按输入框算整组会被顶到内容区顶部（#1665 现象二）；胶囊外框不受内容多少影响，
 * 折叠只显隐里面的文字、不改外框，所以跟胶囊走最稳。
 * 胶囊量不到（老宿主没有探针）才退回最宽的输入框，都量不到才用视口中央靠下的一点。
 * 返回 { left, bottom }，单位是 CSS 像素。
 *
 * 这个函数先定下整组选项框的位置，动效再按定好的布局量小泡的起落点（位置 effect 排在动效
 * effect 之前）。胶囊尺寸变化时由 ResizeObserver 重新量，整组跟着胶囊走。
 */
export const suggestAnchorOf = function (probeEl: any) {
  const viewWidth = (typeof window !== 'undefined' && Number(window.innerWidth)) || 0
  const fallback = { left: Math.round(viewWidth / 2), bottom: 120 }
  try {
    if (probeEl && typeof probeEl.closest === 'function') {
      const capsule = probeEl.closest('.dsws-capsule')
      const fromCapsule = (capsule && typeof capsule.getBoundingClientRect === 'function') ? anchorOfRect(capsule.getBoundingClientRect()) : null
      if (fromCapsule) return fromCapsule
    }
  } catch (eAnchorCapsule) {}
  try {
    const input = suggestInputOf()
    const fromInput = (input && typeof input.getBoundingClientRect === 'function') ? anchorOfRect(input.getBoundingClientRect()) : null
    if (fromInput) return fromInput
  } catch (eAnchorInput) {}
  return fallback
}

/** 浮层内容：打了分的在理由第一行开头先放一颗分数泡（例如 9.5），理由正文紧跟其后排在同一行，
 *  折行后的文字从分数泡下方接着排；没打分的只有理由。
 *  印数字不画进度条：模型给的是「谁更该先做」的相对判断，画条会让人以为它是可校准的刻度。 */
export const popBodyOf = function (item: any, index: number) {
  const reason = (item && typeof item.reason === 'string') ? item.reason : ''
  const priority = (item && typeof item.priority === 'number' && Number.isFinite(item.priority)) ? item.priority : null
  const nodes: any[] = []
  if (priority !== null) nodes.push(React.createElement('span', { key: 'suggest-score-' + index, className: 'dsws-sugg-score' }, String(priority)))
  nodes.push(React.createElement('span', { key: 'suggest-reason-' + index, className: 'dsws-sugg-reason' }, reason))
  return nodes
}

/**
 * 挂载组件：props = { st, sid, group, onDismiss }。group = { id, items }，id 变更即换一组
 * （第二组覆盖第一组）。S sid 只用于调试定位，本组件不读会话。
 */
export const SuggestBubble = function (props: any) {
  const safeProps = (props && typeof props === 'object') ? props : {}
  const group = safeProps.group
  const st = safeProps.st
  const onDismiss = (typeof safeProps.onDismiss === 'function') ? safeProps.onDismiss : null
  const items = suggestViewItemsOf(group && group.items)
  const groupKey = (group && group.id !== undefined && group.id !== null) ? String(group.id) : '0'
  const probeRef = React.useRef(null)
  const layerRef = React.useRef(null)
  const engineRef = React.useRef(null)
  // 已经进入退场：点选与关闭只认第一次，免得退出途中再点一下重复注入、重复关整组。
  const leavingRef = React.useRef(false)
  const posState = React.useState(function () {
    const viewWidth = (typeof window !== 'undefined' && Number(window.innerWidth)) || 0
    return { left: Math.round(viewWidth / 2), bottom: 120 }
  })
  const pos = posState[0]
  const setPos = posState[1]

  // 一次一行排满的宽度预算：整组最大宽度减去按钮之间的间隙，再按当前条数均分；每颗不超过单颗
  // 上限。为什么这么算：三条各取 360 像素时一行要 720 多，只能一颗一行，正好是 #1451 报的
  // 「三个选项竖着排」；均分后三条各约 236 像素，一条就排得下。四条时每颗约 175 像素，仍在
  // 可读范围里；真窄到放不下时才换行。
  const pillGapPx = Number(SUGGEST_APPEARANCE && SUGGEST_APPEARANCE.pillGapPx) || 0
  const groupMaxWidthPx = Number(SUGGEST_APPEARANCE && SUGGEST_APPEARANCE.maxWidthPx) || 0
  const singleMaxWidthPx = Number(SUGGEST_APPEARANCE && SUGGEST_APPEARANCE.pillMaxWidthPx) || 0
  const evenSharePx = items.length ? Math.floor((groupMaxWidthPx - pillGapPx * (items.length - 1)) / items.length) : 0
  const pillCapPx = (evenSharePx > 0 ? Math.min(singleMaxWidthPx, evenSharePx) : singleMaxWidthPx) || singleMaxWidthPx

  // 位置：先定框位（挂载量一次，视口变化与胶囊尺寸变化再量，#1665）。本 effect 排在动效 effect 之前。
  React.useEffect(function () {
    if (!items.length) return undefined
    function measure() {
      try { setPos(suggestAnchorOf(probeRef.current)) } catch (eMeasure) {}
    }
    measure()
    let ro: any = null
    try {
      const probe = probeRef.current
      const anchorEl = (probe && typeof probe.closest === 'function') ? probe.closest('.dsws-capsule') : null
      if (anchorEl && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(function () { measure() })
        if (ro && typeof ro.observe === 'function') ro.observe(anchorEl)
      }
    } catch (eRO) {}
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', measure)
      window.addEventListener('scroll', measure, true)
    }
    return function () {
      try { if (ro && typeof ro.disconnect === 'function') ro.disconnect() } catch (eROD) {}
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('resize', measure)
        window.removeEventListener('scroll', measure, true)
      }
    }
  }, [groupKey])

  // 动效：整组挂上页面浮层以后建一次执行器（量布局、生成小泡、逐帧抬高透明度）；
  // 换了组或卸载时把它关掉。jsdom 里量不到布局，run 直接返回 false，整组按最终态显示。
  React.useEffect(function () {
    if (!items.length) return undefined
    let engine: any = null
    try {
      const layerEl = layerRef.current
      if (layerEl) {
        engine = createSuggestEngine(layerEl)
        try { engine.run() } catch (eRun) {}
        engineRef.current = engine
      }
    } catch (eEngine) { engine = null }
    return function () {
      if (engineRef.current === engine) engineRef.current = null
      if (engine) { try { engine.dispose() } catch (eDispose) {} }
    }
  }, [groupKey])

  /** 关掉整组：一条不选也走这里。 */
  function dismiss() {
    if (!onDismiss) return
    try { onDismiss() } catch (eDismiss) {}
  }
  /**
   * 退场：能演就交给动效执行器，演不了立刻整组消失。
   * kind 是 'pick'（选中一条：胶囊化作小泡上飘，整体约半秒）或 'fade'（关闭整组：约 170 毫秒淡出）。
   * 只认第一次调用，重复点击不会重复触发。
   */
  function playOut(kind: string) {
    if (leavingRef.current) return
    leavingRef.current = true
    let animated = false
    try {
      const engine = engineRef.current
      animated = engine ? engine.playOut(kind, dismiss) : false
    } catch (ePlay) { animated = false }
    if (!animated) dismiss()
  }

  // 键盘：Esc 关整组（焦点不管在哪都能关）；回车/空格落在按钮上时由下面的 onPillKey 处理。
  React.useEffect(function () {
    if (!items.length) return undefined
    function onKey(ev: any) {
      if (!ev || ev.key !== 'Escape') return
      dismiss()
    }
    document.addEventListener('keydown', onKey)
    return function () { document.removeEventListener('keydown', onKey) }
  }, [groupKey, items.length])

  /** 选中一条：先交给既有注入口子，再让整组消失（注入失败也消失，界面不卡着）。 */
  function pick(prompt: string) {
    try { inject(st, prompt) } catch (eInject) {}
    playOut('pick')
  }
  /** 键盘回车/空格 = 点这一颗；preventDefault 掉浏览器的默认激活，避免同一次按键触发两次。 */
  function onPillKey(ev: any, prompt: string) {
    if (!ev) return
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar' || ev.key === 'Space') {
      try { ev.preventDefault() } catch (ePrevent) {}
      try { if (ev.stopPropagation) ev.stopPropagation() } catch (eStop) {}
      pick(prompt)
    }
  }
  function onPillClick(ev: any, prompt: string) {
    try { if (ev && ev.stopPropagation) ev.stopPropagation() } catch (eStop) {}
    pick(prompt)
  }
  function onCloseClick(ev: any) {
    try { if (ev && ev.stopPropagation) ev.stopPropagation() } catch (eStop) {}
    playOut('fade')
  }
  function pillNodeOf(item: any, index: number) {
    const intro = (typeof item.intro === 'string') ? item.intro : ''
    const prompt = item.prompt
    const reason = item.reason
    // 读屏念「简介 提示词」；没有简介的旧事件只念提示词。
    const spoken = intro ? intro + ' ' + prompt : prompt
    // 选项框上只印简介（#1451 后续拍板）：提示词不进按钮，点选时才原样填进输入框；
    // 没有简介的旧事件退回只印提示词。理由收进框正上方的浮层，打了分的在理由第一行开头
    // 加一颗分数泡（例如 9.5），让人一眼看出这条有多优先；进出由外层负责显隐。
    const label = intro
      ? React.createElement('span', { key: 'suggest-intro-' + index, className: 'dsws-sugg-intro' }, intro)
      : prompt
    const popId = 'suggest-pop-' + groupKey + '-' + index
    const button = React.createElement('button', {
      key: 'suggest-pill-' + index,
      type: 'button',
      className: 'dsws-sugg-pill',
      'data-press': 'button',
      'data-log': 'suggest.pill',
      style: { maxWidth: pillCapPx + 'px' },
      'aria-label': reason ? tr('suggest.ariaPill', { prompt: spoken, reason: reason }) : spoken,
      'aria-describedby': reason ? popId : undefined,
      onClick: function (ev: any) { onPillClick(ev, prompt) },
      onKeyDown: function (ev: any) { onPillKey(ev, prompt) },
    }, label)
    // 没有理由也不裸奔：照样包进定位壳（只是里面不放浮层），有理由没理由 DOM 形状一致。
    function showPop(ev: any) {
      try { if (ev && ev.currentTarget && ev.currentTarget.classList) ev.currentTarget.classList.add('dsws-sugg-show-pop') } catch (eShow) {}
    }
    function hidePop(ev: any) {
      try { if (ev && ev.currentTarget && ev.currentTarget.classList) ev.currentTarget.classList.remove('dsws-sugg-show-pop') } catch (eHide) {}
    }
    return React.createElement('span', {
      key: 'suggest-wrap-' + index,
      className: 'dsws-sugg-pill-wrap',
      onMouseEnter: showPop,
      onMouseLeave: hidePop,
      onFocus: showPop,
      onBlur: hidePop,
    }, reason ? [button, React.createElement('div', {
      key: 'suggest-pop-' + index,
      id: popId,
      className: 'dsws-sugg-pop',
      role: 'tooltip',
    }, popBodyOf(item, index))] : button)
  }

  if (!items.length) return null

  const layerProps = {
    ref: layerRef,
    className: 'dsws-sugg-layer',
    role: 'group',
    'aria-label': tr('suggest.group'),
    'data-log': 'suggest.group',
    style: {
      position: 'fixed',
      left: pos.left,
      bottom: pos.bottom,
      transform: 'translateX(-50%)',
      zIndex: SUGGEST_Z,
      pointerEvents: 'none',
      maxWidth: 'min(calc(100vw - 32px), ' + SUGGEST_APPEARANCE.maxWidthPx + 'px)',
      width: 'max-content',
    },
  }
  const nodes: any[] = []
  for (let i = 0; i < items.length; i++) nodes.push(pillNodeOf(items[i], i))
  const closeProps = {
    type: 'button',
    className: 'dsws-sugg-close dsws-hov',
    title: tr('suggest.close'),
    'aria-label': tr('suggest.close'),
    'data-press': 'button',
    'data-log': 'suggest.close',
    onClick: onCloseClick,
  }
  return React.createElement(React.Fragment, null,
    React.createElement('span', { ref: probeRef, style: { display: 'none' }, 'aria-hidden': 'true' }),
    PortalOverlay(layerProps, [
      React.createElement('div', { className: 'dsws-sugg-row', key: 'suggest-row' }, nodes),
      React.createElement('div', { className: 'dsws-sugg-xrow', key: 'suggest-close-row' },
        React.createElement('button', closeProps, '×')),
      // 读屏播报：有几条建议可读（不参与视觉布局）。
      React.createElement('div', { className: 'dsws-sugg-sr', key: 'suggest-sr', role: 'status', 'aria-live': 'polite' },
        tr('suggest.live', { n: items.length })),
    ])
  )
}
