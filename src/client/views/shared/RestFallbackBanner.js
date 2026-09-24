/**
 * views/shared/RestFallbackBanner.js — 降级横幅（「这份数据是走 REST 通道取回来的」那一条）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:restFallbackBanner (spliced by build) ====` 标记处（一源两物）。
 *
 * 这个文件是搬出来的，不是新画的：2026-09-24 从 views/ListTab.js 拆到这里（那个文件当时 378 行，
 * 贴着 350 行上限）。搬的只有「画」这一段 —— 判据一个字都没动，仍然是
 * views/shared/truthLines.js 里的纯函数 restFallbackView（它由 tests/verify-rest-fallback-banner.js 逐档钉住）。
 *
 * v1.5 B5：走 REST 通道取回来的那份数据要明说（降级标记由宿主写，界面只读）。
 * 2026-09-24（维护者反馈「这条在某些工作区出现过后就常驻」）：判据就是上面那个纯函数 ——
 *   它按「这次降级发生在什么时候」决定画不画、画哪一句：一小时以内照旧说「已切换 REST 通道」；
 *   超过一小时、或宿主没给时刻，就改口成「上次取数走的 REST 通道（N 分钟前）」，不把一件历史事实说成现在。
 * 关闭只记在本地 sessionStorage（键里带着这次降级的时刻，所以新的一次降级还会再出现）：
 *   **不写快照、不给宿主的标记赋值** —— tests/verify-visible-truth.js 那条静态断言盯着这件事，规矩不动。
 */
export const RestFallbackBanner = ({ st }) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  if (st.snapMode !== 'real' || !st.snapshot || typeof restFallbackView !== 'function') return null
  // 关闭记在哪一把键上：键里带着「哪一次降级」（工作区 + 时刻由判据回包里的 at 决定），
  //   所以关掉的是「这一次」；下一次降级的时刻更晚，横幅会自己回来。
  const kOf = function (snap) { return 'dsws.restFallbackDismissed:' + String((snap && (snap.repoRoot || snap.repo)) || '') }
  const readAt = function (k) { try { return Number((typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(k) : '') || 0) || 0 } catch (e) { return 0 } }
  const writeAt = function (k, v) { try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(k, String(v)) } catch (e) {} }
  const dkey = kOf(st.snapshot)
  const view = restFallbackView(st, Date.now(), readAt(dkey))
  if (!view) return null
  return h('div', { 'data-rest-fallback': view.stale ? 'stale' : 'now', style: { color: '#f59e0b', fontSize: 11, padding: '6px 12px', border: '1px solid rgba(245,158,11,.4)', borderRadius: 6, background: 'rgba(245,158,11,.08)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 } }, [
    Ic({ n: 'alert', size: 11 }),
    h('span', null, tr(view.key, view.params)),
    h('span', { style: { flex: 1 } }),
    h('button', {
      type: 'button', 'data-rest-fallback-dismiss': 1, 'aria-label': tr('list.restFallbackDismiss'),
      onClick: function (e) {
        try { if (e && e.stopPropagation) e.stopPropagation() } catch (_) {}
        writeAt(dkey, view.at > 0 ? view.at : Date.now())
        try { if (typeof emit === 'function') emit(st) } catch (_) {}
      },
      style: { background: 'transparent', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 2px', flex: 'none' },
    }, '×'),
  ])
}
