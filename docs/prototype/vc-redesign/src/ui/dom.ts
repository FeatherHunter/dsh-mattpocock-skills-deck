/**
 * ui/dom.ts —— 建 DOM 的小工具，全部带类型，视图里不再出现裸 createElement。
 *
 * 两件事只在代码里说一次：
 *   ① 属性、事件、子节点的写法统一成 h(tag, props, ...children)；
 *   ② 焦点跨重渲染的约定：任何可聚焦元素都可以带 data-focus-key，
 *      界面整体重画之后由 ui/app.ts 按这个键把焦点与光标位置放回原处。
 * 原型每 -次交互都整块重画（状态量小、视图最多五十行），换来的好处是
 * 「状态变了界面一定跟着变」不靠手动更新；焦点恢复因此必须做成约定，不能靠碰运气。
 */

export type Child = Node | string | null | undefined | false

export interface ElProps {
  class?: string
  text?: string
  title?: string
  id?: string
  role?: string
  attrs?: Record<string, string | number | boolean | null | undefined>
  dataset?: Record<string, string | number | undefined>
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props !== null) {
    if (props.class !== undefined) node.className = props.class
    if (props.text !== undefined) node.textContent = props.text
    if (props.title !== undefined) node.title = props.title
    if (props.id !== undefined) node.id = props.id
    if (props.role !== undefined) node.setAttribute('role', props.role)
    if (props.attrs !== undefined) {
      for (const [name, value] of Object.entries(props.attrs)) {
        if (value === null || value === undefined || value === false) continue
        node.setAttribute(name, value === true ? '' : String(value))
      }
    }
    if (props.dataset !== undefined) {
      for (const [name, value] of Object.entries(props.dataset)) {
        if (value === undefined) continue
        node.dataset[name] = String(value)
      }
    }
    if (props.on !== undefined) {
      for (const [name, handler] of Object.entries(props.on)) {
        if (handler !== undefined) node.addEventListener(name, handler)
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild)
}

export type IconKind = 'chevron' | 'refresh' | 'copy' | 'check' | 'alert' | 'back' | 'folder' | 'file' | 'commit' | 'branch'

const ICON_PATHS: Record<IconKind, string> = {
  chevron: 'M6 9l6 6 6-6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  copy: 'M8 8h10v12H8zM6 16H4V4h12v2',
  check: 'M4 12l5 5L20 6',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  back: 'M20 12H5M11 6l-6 6 6 6',
  folder: 'M3 6h7l2 3h9v10H3z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  commit: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M3 12h5M16 12h5',
  branch: 'M6 3v18M6 9c0 4 6 4 6 8M12 9h4M16 7a2 2 0 1 0 0 .1M9 5a2 2 0 1 1 0 .1',
}

/** 图标一律内联 SVG：跟文字同色跟随 currentColor，不依赖图标字体或外部文件。 */
export function icon(kind: IconKind, size = 14): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', ICON_PATHS[kind])
  svg.append(path)
  return svg
}

/** 读屏器专用：焦点恢复、结果播报都要它。 */
export function focusKey(key: string): { 'data-focus-key': string } {
  return { 'data-focus-key': key }
}

/** 忙态的小圆环：纯 CSS 动画，不引入加载图片。 */
export function spinner(): HTMLElement {
  return h('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } })
}
