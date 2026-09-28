/**
 * statusbar/Seg.js — 状态栏分段按钮原语（num 数字区 + seg 分段，5.2）
 * G4 严格一文件：从 StatusBar.js 拆出的独立文件（#97 T4）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
export const num = (txt, minW) => h('span', { className: 'dsws-num', style: minW ? { minWidth: minW } : null }, txt)
// seg 的图标名与尺寸：调用方按状态挑图标（如环境段按好坏挑对勾/圆点/警告三角），尺寸缺省 12。
export const seg = (icon, label, color, onGo, sz) => h('span', { className: 'dsws-seg', onClick: function (e) { e.stopPropagation(); onGo() }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: color } }, [
  Ic({ n: icon, size: sz || 12 }),
  label,
])
