/**
 * src/client/kernel/portal.js — 挂顶底座（T1 底座抽离 · #380，承接 G1/G2）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首 export 关键字，
 * 把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内原位），与 ctx.js / styles.js
 * 同模式，一源两物，src 零复制。
 * 接口：RDOM 取法 + portalTop(node) + PortalOverlay(props, children)
 *   — RDOM 为 react-dom 的三路探测（全局 ReactDOM / window.ReactDOM / require），取不到为 null；
 *   — portalTop 挂顶到 document.body，取不到 RDOM 或 body 时原地渲染不抛；
 *   — PortalOverlay 为经 portalTop 挂顶的 div 覆盖层统一入口。
 * 依赖：闭包内 h / React / ReactDOM / window / document / require（零 import，同层禁互 import）。
 * 约 15 行，仅依赖闭包变量与文档顶层容器，不含业务状态，供所有悬浮与弹窗统一经此底座挂载。
 */
// issue #3：浮层挂顶层 —— createPortal 到 document.body，让 position:fixed 的视口坐标与
//   z-index 真正全局生效。宿主输入区祖先若带 transform / filter / backdrop-filter /
//   will-change / contain，fixed 的包含块会降级为该祖先（坐标偏移 + 被 overflow 裁剪），
//   这正是技能 tooltip 被遮挡/截断的根因。取不到 react-dom 时退化为原地渲染（不劣于现状）。
export const RDOM = (function () {
  try { if (typeof ReactDOM !== 'undefined' && ReactDOM && ReactDOM.createPortal) return ReactDOM } catch (e) { /* noop */ }
  try { if (typeof window !== 'undefined' && window.ReactDOM && window.ReactDOM.createPortal) return window.ReactDOM } catch (e) { /* noop */ }
  try { if (typeof require === 'function') { const m = require('react-dom'); if (m && m.createPortal) return m } } catch (e) { /* noop */ }
  return null
})()

export const portalTop = function (node) {
  if (RDOM && typeof document !== 'undefined' && document.body) return RDOM.createPortal(node, document.body)
  return node
}

// issue #22：交互弹层统一挂到 body，避免被状态栏布局 wrapper 裁剪。
export const PortalOverlay = function (props, children) {
  return portalTop(h('div', props || {}, children))
}
