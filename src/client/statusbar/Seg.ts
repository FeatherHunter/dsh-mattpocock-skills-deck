/**
 * statusbar/Seg.ts — 状态栏分段按钮原语（num 数字区 + seg 分段，5.2）
 * G4 严格一文件：从 StatusBar.js 拆出的独立文件（#97 T4）。
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 `// ==== leaf:... (spliced by build) ====` 标记处（源码树里只有这一份真源）。
  * （#1251：本文件由同名 .js 转成 .ts，只补类型标注（形参一律 any）与环境声明，运行时行为一字不动。约束：不许加运行时 import（跨文件名字一律 ambient declare，构建拼闭包时拒收残留 import）；不许 export default；只写可剥离类型。）
 */
/**
 * 闭包环境声明（#1251 转 TS 时补的）：下面这些名字在源码树里没有定义，
 * 它们是别的叶子拼进同一个浏览器闭包时带进来的；类型检查靠这里声明形状。
 * 构建转译时会把 declare 整段抹掉，所以运行时一字不差。
 * 约束：以后新增跨文件引用只许在这里加 declare，不要加运行时 import
 * （构建侧 toSpliceableFragment 会拒收残留的 import，整个片段拼不进去）；
 * 也不要写 export default（构建侧 inlineExportDeclarations 不收 as 改名）。
 */
// 画界面的基本件 h 与图标 Ic，由别的叶子提供。
declare function h(...args: any[]): any;
declare function Ic(props?: any): any;

export const num = (txt: any, minW: any) => h('span', { className: 'dsws-num', style: minW ? { minWidth: minW } : null }, txt)
// seg 的图标名与尺寸：调用方按状态挑图标（如环境段按好坏挑对勾/圆点/警告三角），尺寸缺省 12。
export const seg = (icon: any, label: any, color: any, onGo: any, sz: any) => h('span', { className: 'dsws-seg', onClick: function (e: any) { e.stopPropagation(); onGo() }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: color } }, [
  Ic({ n: icon, size: sz || 12 }),
  label,
])
