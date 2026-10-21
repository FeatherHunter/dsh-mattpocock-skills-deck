/**
 * shared/liquidInk.ts —— 液态页签/筛选药丸的选中块（墨块）：一块跟着选中项滑过去的底色。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥掉行首 export，
 * 把声明体拼回 src/client/index.ts 的 `// ==== leaf:liquidInk (spliced by build) ====`
 * 标记处。拼接次序在 leaf:tabs 之前（面板页签与列表筛选都调这里的 hook）。
 *
 * 为什么是一块单独的绝对定位元素，而不是把选中样式直接画在按钮上：需求要的是「液态」——
 * 选中块从上一个选项滑到下一个选项、中途略微拉伸、落定回弹。只有独立的一块元素能这样移动；
 * 直接改按钮背景只能整块瞬间切换，看不到「从哪来」。移动只写 transform（不碰 left/top，
 * 不触发重排），宽度只在真的变了的时候改一次，符合 docs/adr/20260911-zero-layout-jitter.md
 * 的「测量相只读、变更相只写」。
 *
 * 多选组（标签筛选）也有一块：它跟着「最近一次点中的那颗」走，其余仍选中的药丸保留自己的
 * 选中描边。这样点哪颗墨块就滑到哪颗，不会因为一颗药丸取消选中就整组闪一下。
 *
 * 颜色不新增：墨块的底色与描边从被选中元素的 data-ink-bg / data-ink-bd 读（单选组由调用方
 * 给出既有选中色；标签组每颗颜色本就不同），读不到时用 CSS 变量兜底。
 *
 * 降级：减少动态的人看到同一块底色，只是不做滑动（transition 由 feedback-styles.ts 里的
 * prefers-reduced-motion 段关掉），不是整块消失。
 */

declare const React: any
declare const h: any
declare const window: any
declare const document: any

/** 墨块本身的类名（一块绝对定位的底色）。 */
export const LIQUID_INK_CLASS = 'dsws-ink'
/** 容纳墨块与选项的容器类名；带这个类的容器会被本片补上 position:relative。 */
export const LIQUID_INK_HOST_CLASS = 'dsws-ink-host'
/** 非页签的选中项要加的类名（页签用既有的 .on，不必加）。 */
export const LIQUID_INK_ON_CLASS = 'dsws-ink-on'
/** 第一次定位时先禁过渡，避免墨块从左上角飞过来。 */
const INK_INSTANT_CLASS = 'dsws-ink-instant'

const DEFAULT_BG = 'rgba(255,255,255,.14)'
const DEFAULT_RADIUS = '6px'

function ensureHost(host: any): void {
  if (!host || !host.classList) return
  try {
    // 这个类已经存在时绝不能再 add。浏览器对「加一个已经有的类」照样记一条 class 属性变更，
    // 而 useLiquidInk 的 MutationObserver 正盯着这个容器的 class（attributeFilter 里有 'class'）；
    // 回调里又会 place → ensureHost，于是自己触发自己、永远停不下来，渲染进程连一帧都回不去。
    // 2026-10-21 桌面窗口整窗卡死就是这条环路：先判一下，类在就直接返回。
    if (host.classList.contains(LIQUID_INK_HOST_CLASS)) return
    host.classList.add(LIQUID_INK_HOST_CLASS)
  } catch (e) {}
}

/**
 * 记住「这一组里最近一次点中的是哪一颗」。调用方在 chip / tab 的 onClick 里把事件对象传进来，
 * 本函数沿 DOM 往上找到最近的墨块容器，把 key 记在它的 data-ink-key 上。
 * 只写一个属性，不触发 React 重渲染；下一次 place 会优先找这颗还处于选中态的药丸。
 */
export function liquidInkRemember(el: any, key: any, group?: any): void {
  try {
    const k = key === null || key === undefined ? '' : String(key)
    const g = group === null || group === undefined ? '' : String(group)
    // 多选组要知道「最近一次点中的是哪一颗」：在点击的那颗药丸上记 data-ink-pick，
    // 同组其余药丸先摘掉。取消选中后这一颗不再带 dsws-ink-on，墨块会自动退回同组第一个选中项。
    if (g && el && el.setAttribute) {
      let host = null
      for (let node = el; node && node.nodeType === 1; node = node.parentNode) {
        if (node.classList && node.classList.contains(LIQUID_INK_HOST_CLASS)) { host = node; break }
      }
      const scope = host || el.ownerDocument
      try {
        const olds = scope.querySelectorAll('[data-ink-pick="1"][data-ink-group="' + g + '"]')
        for (let i = 0; i < olds.length; i++) { try { olds[i].removeAttribute('data-ink-pick') } catch (eO) {} }
      } catch (eQ) {}
      try { el.setAttribute('data-ink-pick', '1') } catch (eP) {}
    }
    for (let node = el; node && node.nodeType === 1; node = node.parentNode) {
      if (node.classList && node.classList.contains(LIQUID_INK_HOST_CLASS)) {
        node.setAttribute('data-ink-key', k)
        return
      }
    }
  } catch (e) {}
}

/** 找这一组当前的选中项：先认「最近点中且仍在选中态」的那颗，再退回第一个选中的（页签用 .on）。 */
function inkTargetOf(host: any, group: any): any {
  if (!host || !host.querySelector) return null
  const g = group === null || group === undefined ? '' : String(group)
  if (g) {
    // 多选组：先认「最近点中且仍在选中态」的那颗；它若已取消选中，退回同组第一个选中项。
    const escapedG = g.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    let picked: any = null
    try { picked = host.querySelector('.' + LIQUID_INK_ON_CLASS + '[data-ink-group="' + escapedG + '"][data-ink-pick="1"]') } catch (eG) { picked = null }
    if (picked) return picked
    try { picked = host.querySelector('.' + LIQUID_INK_ON_CLASS + '[data-ink-group="' + escapedG + '"]') } catch (eG2) { picked = null }
    return picked || null
  }
  const key = host.getAttribute('data-ink-key')
  if (key) {
    let picked: any = null
    try {
      const escaped = String(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      picked = host.querySelector('.' + LIQUID_INK_ON_CLASS + '[data-ink-key="' + escaped + '"]')
      if (!picked) picked = host.querySelector('.dsws-tab.on[data-ink-key="' + escaped + '"]')
    } catch (e) { picked = null }
    if (picked) return picked
  }
  const on = host.querySelector('.' + LIQUID_INK_ON_CLASS) || host.querySelector('.dsws-tab.on')
  return on || null
}

function readPx(el: any, name: string): number {
  try {
    const v = el[name]
    return typeof v === 'number' && isFinite(v) ? v : 0
  } catch (e) { return 0 }
}

/**
 * 把墨块移到这一组当前选中项的位置。返回有没有选中项（没有就把墨块藏起来）。
 * 只读一次目标元素的四个尺寸量，随后只写墨块自己的 CSS 变量，不动其它节点。
 */
export function liquidInkPlace(host: any, ink: any): boolean {
  if (!host || !ink || !ink.style) return false
  ensureHost(host)
  // 一块墨块盯一组：分组键写在墨块自己身上，同一容器里可以并排住三块（状态/排序/标签）。
  const group = (ink.getAttribute && ink.getAttribute('data-ink-group')) || ''
  const target = inkTargetOf(host, group)
  if (!target) {
    try {
      ink.style.opacity = '0'
      ink.style.pointerEvents = 'none'
    } catch (e) {}
    return false
  }
  const x = readPx(target, 'offsetLeft')
  const y = readPx(target, 'offsetTop')
  const w = readPx(target, 'offsetWidth')
  const h = readPx(target, 'offsetHeight')
  const first = !ink.__dswsInkPlaced
  try {
    if (first) ink.classList.add(INK_INSTANT_CLASS)
    ink.style.setProperty('--dsws-ink-x', x + 'px')
    ink.style.setProperty('--dsws-ink-y', y + 'px')
    ink.style.setProperty('--dsws-ink-w', w + 'px')
    ink.style.setProperty('--dsws-ink-h', h + 'px')
    const bg = target.getAttribute && target.getAttribute('data-ink-bg')
    const bd = target.getAttribute && target.getAttribute('data-ink-bd')
    ink.style.setProperty('--dsws-ink-bg', bg || DEFAULT_BG)
    ink.style.setProperty('--dsws-ink-bd', bd || 'transparent')
    const radius = (host.getAttribute && host.getAttribute('data-ink-radius')) || DEFAULT_RADIUS
    ink.style.setProperty('--dsws-ink-radius', radius)
    ink.style.opacity = '1'
    ink.style.pointerEvents = 'none'
  } catch (e) {}
  if (first) {
    ink.__dswsInkPlaced = true
    const raf = (typeof window !== 'undefined' && window && window.requestAnimationFrame) ? window.requestAnimationFrame : null
    const drop = function () { try { ink.classList.remove(INK_INSTANT_CLASS) } catch (e) {} }
    if (raf) raf(drop); else setTimeout(drop, 0)
  }
  return true
}

/**
 * 组件侧入口：把返回的元素放进这一组的容器里（容器自己带 LIQUID_INK_HOST_CLASS 或由本 hook 补上），
 * 把 hostRef 指向同一个容器。选中态变化时组件照常重渲染，墨块在每次渲染后的布局阶段重新对位。
 */
export function useLiquidInk(hostRef: any, group?: any): any {
  const inkRef = React.useRef(null)
  const place = function () {
    try { liquidInkPlace(hostRef && hostRef.current, inkRef.current) } catch (e) {}
  }
  if (typeof React.useLayoutEffect === 'function') {
    React.useLayoutEffect(function () { place() })
  } else {
    React.useEffect(function () { place() })
  }
  React.useEffect(function () {
    const onResize = function () { place() }
    let cancelled = false
    try { if (window && window.addEventListener) window.addEventListener('resize', onResize) } catch (e) {}
    // 字体晚到、页签折叠、标签展开都会让选项宽度变一次；这些都发生在宿主容器自己的属性/子树上，
    // 只盯这一小片，不用全局轮询。观察回调里只读一次布局再写墨块，和渲染后的对位是同一条路。
    let mo: any = null
    try {
      const host = hostRef && hostRef.current
      if (host && typeof MutationObserver !== 'undefined') {
        mo = new MutationObserver(function (records: any) {
          if (cancelled) return
          // 墨块自己的 style/class 也在被观察范围里（它是容器的子节点），对位时一改就会再收到一条记录。
          //   只认「容器里除墨块以外」的变动，否则就会自己触发自己、把渲染进程占满（2026-10-21 整窗卡死那条环路）。
          const ink = inkRef.current
          for (let i = 0; i < (records ? records.length : 0); i++) {
            const t = records[i] && records[i].target
            if (t && ink && (t === ink || (t.nodeType === 1 && ink.contains && ink.contains(t)))) continue
            place()
            return
          }
        })
        mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
      }
    } catch (e) {}
    try {
      if (document && document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(function () { if (!cancelled) place() })
      }
    } catch (e) {}
    return function () {
      cancelled = true
      try { if (window && window.removeEventListener) window.removeEventListener('resize', onResize) } catch (e) {}
      try { if (mo) mo.disconnect() } catch (e) {}
    }
  }, [])
  const inkProps: any = { className: LIQUID_INK_CLASS, ref: inkRef, 'aria-hidden': 'true' }
  if (group !== null && group !== undefined && group !== '') inkProps['data-ink-group'] = String(group)
  return h('span', inkProps)
}
