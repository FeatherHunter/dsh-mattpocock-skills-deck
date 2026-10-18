/**
 * panel/NamingFailBanner.ts — 命名链路定败的面板级常驻提醒（#267 · F4）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:namingFailBanner (spliced by build) ====` 标记处
 * （一源两物，与 Dock/Overlay 同模式 · G4 单文件单职责）。
 *
 * 数据面：有限重试耗尽清单（namingFailureInfo）由渲染钩子 kernel/api.js applyNamingFailurePanel
 * 落共享 store；本组件自订阅共享 store —— 面板级可见而非目标会话内闪现（AC1）。
 * 化解 = 值比对锁两路（手改 → locked 终局 / 值一致收敛 renamed），均只读探测绝不盲写，
 * 化解后下一轮拉询 host failures 清单不再包含该会话，横幅自动撤下。
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
// 面板 store 钩子 useStore，由 kernel 提供。
declare function useStore(...args: any[]): any;

    export const NamingFailBanner = () => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const shS = cx ? cx.storeSvc.useStore(null) : useStore(null)
      const fls = ((shS && Array.isArray(shS.namingFailures)) ? shS.namingFailures : []).filter(function (f: any) { return f && f.sessionId })
      if (!fls.length) return null
      const style = { margin: '0 12px 6px', padding: '5px 8px', background: 'rgba(248,113,113,.10)', border: '1px solid rgba(248,113,113,.45)', color: '#f87171', fontSize: 11, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 3, flex: 'none' }
      const rows = fls.slice(0, 3).map(function (f: any) {
        return h('div', { key: f.sessionId, style: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (f.number != null ? '#' + f.number : tr('naming.stageDraft')) + ' · ' + (f._title || String(f.sessionId).slice(0, 10)) + ' — ' + String(f.error || 'rename failed'))
      })
      return h('div', { 'data-naming-fail-banner': '1', style: style }, [
        h('div', { style: { fontWeight: 700 } }, tr('naming.failTitle') + ' ×' + fls.length),
        h('div', { style: { fontSize: 10, opacity: .85 } }, tr('naming.failHint')),
      ].concat(rows))
    }
