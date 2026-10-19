/**
 * views/shared/RestFallbackBanner.ts — 降级横幅（「这份数据是走 REST 通道取回来的」那一条）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 `// ==== leaf:restFallbackBanner (spliced by build) ====` 标记处（源码树里只有这一份真源）。
 *
 * 这个文件是搬出来的，不是新画的：2026-09-24 从 views/ListTab.js 拆到这里（那个文件当时 378 行，
 * 贴着 350 行上限）。搬的只有「画」这一段 —— 判据一个字都没动，仍然是
 * views/shared/truthLines.ts 里的纯函数 restFallbackView（它由 tests/verify-rest-fallback-banner.ts 逐档钉住）。
 *
 * v1.5 B5：走 REST 通道取回来的那份数据要明说（降级标记由宿主写，界面只读）。
 * 2026-09-24（维护者反馈「这条在某些工作区出现过后就常驻」）：判据就是上面那个纯函数 ——
 *   它按「这次降级发生在什么时候」决定画不画、画哪一句：一小时以内照旧说「已切换 REST 通道」；
 *   超过一小时、或宿主没给时刻，就改口成「上次取数走的 REST 通道（N 分钟前）」，不把一件历史事实说成现在。
 * 关闭只记在本地 sessionStorage（键里带着这次降级的时刻，所以新的一次降级还会再出现）：
 *   **不写快照、不给宿主的标记赋值** —— tests/verify-visible-truth.ts 那条静态断言盯着这件事，规矩不动。
 *
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与下面这些说明，逻辑、字符串、数字、
 * 对象键与次序、函数名与导出名一字未动。契约照旧不能改：本文件是模块真源（ESM 导出），
 * scripts/build.mts 构建时剥掉行首 export 后把声明体拼进 src/client/index.ts 的客户端闭包
 * （源码树里只有这一份真源）；模块说明符保持 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 */
/**
 * 闭包环境声明（类型检查时才看，转译时整段抹掉，真机上有值）：
 * 下面这些名字不在本文件里定义，由构建按 build.mjs 的次序把别的叶子拼进同一个函数作用域带进来
 * （React 与上下文对象来自闭包入口，restFallbackView 是 truthLines 的纯函数判据，Ic / tr 是图标与
 * 词条，emit 是重渲染口），这里只声明形状、不参与转译。为什么不写 import：拼进闭包的片段里留着
 * 运行时 import，运行时就是语法错。声明成 any / (...args: any[]): any 而不是精确签名，是为了保证
 * 「只加类型、不加约束」——转译后一字不差。
 */
declare const React: any;
declare const DswsCtx: any;
declare const restFallbackView: any;
declare const Ic: any;
declare const tr: any;
declare const emit: any;
declare function h(...args: any[]): any;
export const RestFallbackBanner = ({ st }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  if (st.snapMode !== 'real' || !st.snapshot || typeof restFallbackView !== 'function') return null
  // 关闭记在哪一把键上：键里带着「哪一次降级」（工作区 + 时刻由判据回包里的 at 决定），
  //   所以关掉的是「这一次」；下一次降级的时刻更晚，横幅会自己回来。
  const kOf = function (snap: any) { return 'dsws.restFallbackDismissed:' + String((snap && (snap.repoRoot || snap.repo)) || '') }
  const readAt = function (k: any) { try { return Number((typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(k) : '') || 0) || 0 } catch (e) { return 0 } }
  const writeAt = function (k: any, v: any) { try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(k, String(v)) } catch (e) {} }
  const dkey = kOf(st.snapshot)
  const view = restFallbackView(st, Date.now(), readAt(dkey))
  if (!view) return null
  return h('div', { 'data-rest-fallback': view.stale ? 'stale' : 'now', style: { color: '#f59e0b', fontSize: 11, padding: '6px 12px', border: '1px solid rgba(245,158,11,.4)', borderRadius: 6, background: 'rgba(245,158,11,.08)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 } }, [
    Ic({ n: 'alert', size: 11 }),
    h('span', null, tr(view.key, view.params)),
    h('span', { style: { flex: 1 } }),
    h('button', {
      type: 'button', 'data-rest-fallback-dismiss': 1, 'aria-label': tr('list.restFallbackDismiss'),
      onClick: function (e: any) {
        try { if (e && e.stopPropagation) e.stopPropagation() } catch (_) {}
        writeAt(dkey, view.at > 0 ? view.at : Date.now())
        try { if (typeof emit === 'function') emit(st) } catch (_) {}
      },
      style: { background: 'transparent', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 2px', flex: 'none' },
    }, '×'),
  ])
}
