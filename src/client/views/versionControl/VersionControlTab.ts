// views/versionControl/VersionControlTab.ts —— 「版本管理」页签的入口组件（#1776 M1 改成真实页签）
// 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
// 壳层（panel/Dock.ts）按 h(VersionControlTab, { st, narrow }) 调它；这里只做入口委托——把入参原样交给
//   vcRealTab.ts 的真实页签容器，旧版「改动 / 提交历史 / 工作树」三块画法与它的折叠阶梯已经由页面壳取代，
//   这条路径上不再保留第二套渲染器（规格 #1586 与 #1776 的边界：旧块里被页面壳取代的部分直接删）。
// 保留 VC_TONE：六个变化色档改指本页皮肤令牌（--vc-*），是这一页自己的配色真源，与画法无关；
//   容器配色门禁（tests/verify-container-colors.ts）按本文件找警告色令牌的兜底那一行，别把这段色表搬走。

declare const React: any
declare const VcRealTab: any

// #853：颜色只走本页的皮肤令牌（--vc-*，由 vcStyles.js 按宿主主题开关分深浅两套：
//   深色 = A 工程台账，浅色 = C 纸质便签）。六种变化色由下面的 VC_TONE 映射到这些令牌。
export const VC_TONE: Record<string, string> = {
  success: 'var(--vc-accent,#22c55e)',
  warning: 'var(--vc-warn,#f59e0b)',
  error: 'var(--vc-danger,#ef4444)',
  accent: 'var(--vc-info,#38bdf8)',
  caption: 'var(--vc-mut,#94a3b8)',
  primary: 'var(--vc-ink,#e6edf3)',
}

// 入参原样转交：st 给容器取工作区，narrow 给容器取初始宽度档（进入后仍以根节点实测宽度为准）。
export const VersionControlTab = function (props: any) {
  return React.createElement(VcRealTab, props)
}
