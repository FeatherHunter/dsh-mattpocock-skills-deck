/**
 * kernel/ui-feedback.ts —— 界面反馈与点击日志的总入口：一个按压类、一个点击日志口。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥掉行首 export，
 * 把声明体拼回 src/client/index.ts 的 `// ==== kernel:uiFeedback (spliced by build) ====`
 * 标记处（源码树里只有这一份真源）。拼接次序在 kernel:log 之后、页面组件之前，
 * installUiFeedback() 在启动段调用一次。
 *
 * 为什么要在内核里统一挂：需求要求「清单内每个可点控件」都有按压反馈，并且点完之后
 * 能凭一条调试日志还原「点的是页面上的哪一颗按钮」。如果每个组件各写一遍 pointerdown /
 * pointerup / log 调用，一是会漏（新增控件忘了写），二是日志字段会各写各的、只能看出
 * 「点了一个按钮」看不出是哪一个。所以收成一处：
 *   - 按压：任何带 `data-press` 的元素，按下时由本片挂 `dsws-pressing` 类，抬起/取消时摘掉。
 *     不用 CSS 的 :active，是因为 :active 按下后把指针拖走会一直粘住（浏览器实测移开 300px
 *     仍然匹配），而且祖先元素也会一起匹配，按压态会顺着 DOM 往上串。
 *   - 点击日志：任何带 `data-log` 的元素被点中（捕获阶段，不受 stopPropagation 影响），
 *     写一条 debug 级 `ui.action`。data-log 的值是稳定英文枚举，形如 `list.filter.state.open`，
 *     同屏唯一，用来唯一定位到被点的那一颗按钮；kind 取 `data-press` 的值（缺省 other）。
 *     调试开关关着时 isEnabled('debug') 第一行就早退，不拼字段、不产生任何日志开销。
 *
 * 日志字段纪律（见 src/client/kernel/log.ts 与 research/489-appendix.md）：
 *   - target：稳定英文枚举，最长 96 字符；只写枚举，不写按钮上的文字、不写标题、不写路径。
 *   - kind：按压形状枚举（button / chip / tab / row / icon），最长 16 字符。
 *   两件都是用户主动点击的低频动作，定按需（调试级）。
 */

declare const document: any
declare const window: any
declare const log: (...args: any[]) => void
declare const isEnabled: (...args: any[]) => boolean

/** 按压态类名：由本片挂到带 data-press 的元素上，样式在 feedback-styles.ts 里统一给。 */
export const UI_PRESS_CLASS = 'dsws-pressing'
/** 按压形状属性：button / chip / tab / row / icon，日志的 kind 直接取它。 */
export const UI_PRESS_ATTR = 'data-press'
/** 点击日志标识属性：值必须同屏唯一，形如 list.filter.state.open。 */
export const UI_LOG_ATTR = 'data-log'

const PRESS_SELECTOR = '[' + UI_PRESS_ATTR + ']'
const LOG_SELECTOR = '[' + UI_LOG_ATTR + ']'
const TARGET_MAX = 96
const KIND_MAX = 16
const KIND_FALLBACK = 'other'

let installed = false

/** 从事件目标往上找到最近一颗带 data-press 的元素；找不到就按不到底。 */
function pressTargetOf(ev: any): any {
  const t = ev && ev.target ? ev.target : null
  for (let node = t; node && node.nodeType === 1; node = node.parentNode) {
    if (node.getAttribute && node.getAttribute(UI_PRESS_ATTR) !== null) return node
  }
  return null
}
function logTargetOf(ev: any): any {
  const t = ev && ev.target ? ev.target : null
  for (let node = t; node && node.nodeType === 1; node = node.parentNode) {
    if (node.getAttribute && node.getAttribute(UI_LOG_ATTR) !== null) return node
  }
  return null
}

/** 只保留稳定枚举字符：小写字母、数字、点、横线、下划线；其它字符一律丢掉，避免自由文本混进日志。
 *  先统一转小写：调用方写的是 camelCase 枚举（例如 list.row.newSession.1324），
 *  若直接丢大写字母会记成 list.row.newsession 这种缺一段的残缺值；转小写后仍是稳定枚举，人能按原样找到按钮。 */
function cleanToken(raw: any, max: number): string {
  if (raw === null || raw === undefined) return ''
  const s = String(raw).trim().toLowerCase()
  if (!s) return ''
  let out = ''
  for (let i = 0; i < s.length && out.length < max; i++) {
    const ch = s.charAt(i)
    const c = ch.charCodeAt(0)
    const ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || ch === '.' || ch === '-' || ch === '_'
    if (ok) out += ch
  }
  return out
}

let pressedEl: any = null
function setPressed(el: any): void {
  if (pressedEl === el) return
  clearPressed()
  if (!el || !el.classList) return
  try { el.classList.add(UI_PRESS_CLASS) } catch (e) {}
  pressedEl = el
}
function clearPressed(): void {
  if (pressedEl && pressedEl.classList) {
    try { pressedEl.classList.remove(UI_PRESS_CLASS) } catch (e) {}
  }
  pressedEl = null
}

/**
 * 挂上全客户端唯一的按压委托与点击日志口。幂等：重复调用只生效一次。
 * 只在 document 上挂捕获阶段的监听，任何面板卸载都不会丢掉这两个口。
 */
export function installUiFeedback(): void {
  if (installed) return
  if (typeof document === 'undefined' || !document || !document.addEventListener) return
  installed = true

  document.addEventListener('pointerdown', function (ev: any) {
    try {
      if (ev && ev.button !== undefined && ev.button !== 0) return
      setPressed(pressTargetOf(ev))
    } catch (e) {}
  }, true)
  document.addEventListener('pointerup', function () { clearPressed() }, true)
  document.addEventListener('pointercancel', function () { clearPressed() }, true)
  // 指针在按下后被系统抢走（切窗口、拖拽）时不会有 pointerup，用 blur 兜底，避免按压态粘住。
  if (typeof window !== 'undefined' && window && window.addEventListener) {
    window.addEventListener('blur', function () { clearPressed() })
  }

  document.addEventListener('click', function (ev: any) {
    try {
      // 调试开关关着：第一行早退，不读属性、不组装字段、不排队。
      if (!isEnabled || !isEnabled('debug')) return
      const el = logTargetOf(ev)
      if (!el) return
      const target = cleanToken(el.getAttribute(UI_LOG_ATTR), TARGET_MAX)
      if (!target) return
      const kind = cleanToken(el.getAttribute(UI_PRESS_ATTR), KIND_MAX) || KIND_FALLBACK
      log('debug', 'ui.action', { target: target, kind: kind })
    } catch (e) {}
  }, true)
}
