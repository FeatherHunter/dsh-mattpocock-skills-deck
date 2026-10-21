/**
 * views/shared/chips.ts — 通用小徽章（Dot / TypeChip）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 `// ==== leaf:... (spliced by build) ====` 标记处（源码树里只有这一份真源）。
 *
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与下面这些说明，逻辑、字符串、
 * 数字、对象键与次序、函数名与导出名一字未动。契约照旧不能改：本文件是模块真源（ESM 导出），
 * scripts/build.mts 构建时剥掉行首 export 后把声明体拼进 src/client/index.ts 的客户端闭包
 * （源码树里只有这一份真源）；模块说明符保持 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 */
/**
 * 闭包环境声明（类型检查时才看，转译时整段抹掉，真机上有值）：
 * 下面这些名字不在本文件里定义，是客户端闭包里更早拼进来的环境与叶子（React 与上下文对象由
 * 闭包入口提供，TYPE_ICON 与 Ic、tr 由别的叶子文件提供），由构建按 build.mjs 的次序拼进同一个
 * 函数作用域带进来，这里只声明形状、不参与转译。为什么不写 import：拼进闭包的片段里留着运行时
 * import，运行时就是语法错。声明成 (...args: any[]): any 而不是精确签名，是为了保证「只加类型、
 * 不加约束」——转译后一字不差。
 */
declare const React: any;
declare const DswsCtx: any;
declare const TYPE_ICON: any;
declare function Ic(...args: any[]): any;
declare function tr(...args: any[]): any;
export     const Dot = ({ level }: any) => { const cx = React.useContext(DswsCtx); const h = cx ? cx.h : React.createElement; return h('span', { className: 'dsws-dot', style: { background: level === 'ok' ? '#4ade80' : level === 'warn' ? '#f59e0b' : level === 'bad' ? '#f87171' : '#52525b' } }) }
export     const TypeChip = ({ type }: any) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      // 样式类按类型分发；issue（普通票）走中性灰，其余五种是 wayfinder 自己的类型色。
      // 文字一律来自词条 type.<类型>，没有词条时 tr 会退回键名（那正是 #626 修的那个毛病）。
      // 标 any：下面这个字面量是按「类型名 → 样式类」查表，键从入参来（any），不标就是「用 any 索引
      // 对象字面量」的隐式 any 报错；标注只落在这个字面量上（`as any` 只给类型检查看，转译时整段
      // 抹掉，产物与原文一字不差），表里的键、值、先后顺序一个字没动。
      const cls = ({ research: 'dsws-chip-r', prototype: 'dsws-chip-p', grilling: 'dsws-chip-g', task: 'dsws-chip-t', map: 'dsws-chip-m', spec: 'dsws-chip-s', issue: 'dsws-chip-i' } as any)[type] || ''
      // 有图标才画图标：普通票（issue）没有自己的图标，只出文字 —— 前面挂一个灰点像多出来的
      // 项目符号，去掉之后文字左右留白对称（#626）
      // #1286：规格（实施地图）还没有自己的图标名，先借地图那只；TYPE_ICON 里以后补了 spec 就用它自己的。
      const icon = TYPE_ICON[type] || (type === 'spec' ? 'map' : undefined)
      return h('span', { className: 'dsws-chip ' + cls }, [
        icon ? Ic({ n: icon, size: 11 }) : null,
        h('span', null, tr('type.' + type)),
      ])
    }
    // #949 瞬间底座（收敛：从 ListTab.js 搬出，列表文件守 350 行）：可点小药丸的键盘可达三件套。
    //   Tab 停留靠 tabIndex: 0，焦点环走样式叶子的统一 :focus-visible 规则（DSH 焦点 token，往内画），不占布局；
    //   回车与空格沿用鼠标同一条路（调起 DOM click，不另写分支），布局文案都不动。
export     const chipKeyDown = function (e: any) {
      const k = e && e.key
      if (k === 'Enter' || k === ' ') { try { if (e.preventDefault) e.preventDefault() } catch (_) {} try { if (e.currentTarget) e.currentTarget.click() } catch (_) {} }
    }
    // 同一三件套的打包写法：返回一个新对象（带上调用点给的那些 props），不去改调用方传进来的那个对象 ——
    //   传共享对象时不会被顺手带上三件套（评审 2026-10-09 指出的坑）。行为与逐个写那三行完全一致。
// 药丸定位名的兜底序号：调用点自己给了定位名时用不上，兜底名只在没有定位名时兜底。
let chipLogSeq = 0
export     const chipProps = function (p: any) {
      // 接线（#1335 界面反馈）：形状是 chip（按下压暗、悬停提亮）。
      //   定位名优先用调用点给的；调用点没给时用带序号的兜底名，保证同一屏里两颗药丸不会共用一个名字。
      return Object.assign({ tabIndex: 0, role: 'button', onKeyDown: chipKeyDown, 'data-press': 'chip', 'data-log': 'chip.fallback.' + (++chipLogSeq) }, p || {})
    }
