/**
 * views/primitives/Tip.ts — 悬停提示薄预设（规格 1651，第二张实施票 1653 起锚定在触发控件上方）
 * 契约：调用方只给内容与触发节点，提示方位一律由 HoverTip 内部经方位纯函数算出，调用方不再决定提示落在上下左右。
 * 用法：Tip({content, children}) 或 h(Tip, {content: '提示'}, triggerNode)
 * 形态：单文件单控件、零横向 import（时间常量那一行由构建剥掉后拼进闭包，不算横向依赖），样式复用 HoverTip 的挂顶与气泡样式。
 * 真源经 scripts/build.mts LEAF_MODULES -> src/client/index.ts // ==== leaf:tip (spliced by build) ==== 源码树里只有这一份真源。
 *
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与下面这些说明，逻辑、字符串、
 * 数字、对象键与次序、函数名与导出名按本票要求演进。契约照旧不能改：本文件是模块真源（ESM 导出），
 * scripts/build.mts 构建时剥掉行首 export 后把声明体拼进 src/client/index.ts 的客户端闭包
 * （源码树里只有这一份真源）；顶部那行时间配置 import 的 .js 后缀也不许改成 .ts，由 scripts/ts-hook.mts
 * 把它改指同名 .ts。
 */
/**
 * 闭包环境声明（类型检查时才看，转译时整段抹掉，真机上有值）：
 * 下面这两个名字不在本文件里定义，是客户端闭包里更早拼进来的环境与叶子（React 由闭包入口提供，
 * HoverTip 是 primitives 里的另一份叶子），由构建按 build.mjs 的次序拼进同一个函数作用域带进来，
 * 这里只声明形状、不参与转译。为什么不写 import：拼进闭包的片段里留着运行时 import，运行时就是
 * 语法错。声明成 any 而不是精确签名，是为了保证「只加类型、不加约束」——转译后一字不差。
 */
declare const React: any;
declare const HoverTip: any;
import { TIP_SHOW_DELAY_MS, TIP_HIDE_DELAY_MS } from '../../../shared/time-config/values.js'
export const Tip = function(props: any){
  const p = props || {}
  const content = p.content
  const children = p.children
  // 预设里的两个延时（显示、隐藏）住在 config/intervals.yaml 的 tipShowDelayMs / tipHideDelayMs，
  // 值由 tests/verify-time-config.ts 锁住引用关系；本文件顶部 import 真引用，构建拼闭包时剥掉那一行 import，
  // 名字由闭包里的时间片段提供。改时间只改那一份 YAML，本文件不写数字。
  // 提示默认锚定在触发控件上方：方位由 HoverTip 内部按屏幕边界让位，调用方不再传方位参数。
  // 默认宽度上限是 320，窄屏下按屏幕可用宽度收窄，调用方可覆盖。
  const preset = { delay: { show: TIP_SHOW_DELAY_MS, hide: TIP_HIDE_DELAY_MS }, maxWidth: 320, zIndex: 2147483000, padding: '7px 12px' }
  // merged 后面要按调用点给的键逐个往上挂，空对象字面量推不出这些键，所以标 any（只加类型、不改代码）。
  const merged: any = {}
  merged.delay = p.delay !== undefined ? p.delay : preset.delay
  merged.maxWidth = p.maxWidth !== undefined ? p.maxWidth : preset.maxWidth
  merged.zIndex = p.zIndex !== undefined ? p.zIndex : preset.zIndex
  // T2 a11y：若 content 为字符串且触发元素无 aria-label，自动补 aria-label（不覆盖显式值）。
  let effChildren = children
  if (typeof content === 'string' && content && children && typeof children === 'object' && children.props && !children.props['aria-label'] && !children.props['aria-labelledby']) {
    try { if (typeof React !== 'undefined' && typeof React.cloneElement === 'function') effChildren = React.cloneElement(children, { 'aria-label': content }); } catch (e) {}
  }
  if (content !== undefined) merged.content = content
  if (effChildren !== undefined) merged.children = effChildren
  else if (children !== undefined) merged.children = children
  if (p.targetRef !== undefined) merged.targetRef = p.targetRef
  if (p.visible !== undefined) merged.visible = p.visible
  if (p.onVisibleChange !== undefined) merged.onVisibleChange = p.onVisibleChange
  if (p.onShow !== undefined) merged.onShow = p.onShow
  if (p.onHide !== undefined) merged.onHide = p.onHide
  merged.padding = p.padding !== undefined ? p.padding : preset.padding
  if (p.style !== undefined) merged.style = p.style
  if (p.className !== undefined) merged.className = p.className
  if (p.background !== undefined) merged.background = p.background
  if (p.border !== undefined) merged.border = p.border
  return HoverTip(merged)
}
