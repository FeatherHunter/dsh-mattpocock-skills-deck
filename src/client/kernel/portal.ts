/**
 * src/client/kernel/portal.ts — 挂顶底座（T1 底座抽离 · #380，承接 G1/G2）。
 *
 * 为什么挂顶要单独一层：悬浮与弹窗一旦被面板布局的裁剪吃掉，逐处修 z-index 永远修不完，
 * 所以挂到 body 的入口只收在这里一处，别处只调 portalTop 与 PortalOverlay。
 * 契约：本文件为模块真源（行首 export 形态由构建拼回 index.js apply 闭包内原位）；
 * RDOM 取不到时退化为原地渲染，不许抛。依赖闭包内 h / React / ReactDOM / window / document / require。
 * 本文件由 portal.js 转写而来，只加类型标注，运行行为一字不改。
 * 反例：不要在这里放业务状态，不要在这里决定哪个弹窗该出现。
 */
declare const React: any;
declare const ReactDOM: any;
declare const window: any;
declare const document: any;
declare function require(...args: any[]): any;
declare function h(...args: any[]): any;
// issue #3：浮层挂顶层 —— createPortal 到 document.body，让 position:fixed 的视口坐标与
//   z-index 真正全局生效。宿主输入区祖先若带 transform / filter / backdrop-filter /
//   will-change / contain，fixed 的包含块会降级为该祖先（坐标偏移 + 被 overflow 裁剪），
//   这正是技能 tooltip 被遮挡/截断的根因。取不到 react-dom 时退化为原地渲染（不劣于现状）。
export const RDOM: any = (function (): any {
  try { if (typeof ReactDOM !== 'undefined' && ReactDOM && ReactDOM.createPortal) return ReactDOM } catch (e) { /* noop */ }
  try { if (typeof window !== 'undefined' && window.ReactDOM && window.ReactDOM.createPortal) return window.ReactDOM } catch (e) { /* noop */ }
  try { if (typeof require === 'function') { const m: any = require('react-dom'); if (m && m.createPortal) return m } } catch (e) { /* noop */ }
  return null
})()
export const portalTop = function (node: any): any {
  if (RDOM && typeof document !== 'undefined' && document.body) return RDOM.createPortal(node, document.body)
  return node
}
// issue #22：交互弹层统一挂到 body，避免被状态栏布局 wrapper 裁剪。
export const PortalOverlay = function (props: any, children: any): any {
  return portalTop(h('div', props || {}, children))
}
