/**
 * views/useIssueDetailFold.ts — ISSUE 详情页顶栏折叠机（#763）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物）。
 * 判据在 views/issueDetailFold.ts；这里只读写顶栏那一段 DOM。
 * 返回优先收到图标，一次只折一个控件，不放省略号。
 *
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与下面这些说明，逻辑、分支条件、
 * 字符串、数字、对象键与次序、函数名与导出名一字未动。契约照旧不能改：本文件是模块真源
 * （ESM 导出），构建时剥行首 export 拼进客户端闭包（一源两物）；模块说明符保持 .js 后缀，
 * 由 scripts/ts-hook.mjs 改指同名 .ts。
 * 定时器约定没动：这里只挂一个 ResizeObserver 加一个窗口 resize 监听，卸载时按原样断开、
 *   摘监听（不新增也不遗留任何监听）。
 */
/**
 * 闭包环境声明（类型检查时才看，转译时整段抹掉，真机上有值）：
 * 下面这两个名字不在本文件里定义，是构建按 build.mjs 的次序把 issueDetailFold.ts 拼进同一个
 * 函数作用域带进来的（判据住在那一份里），这里只声明形状、不参与转译。React 由
 * src/client/ts-pixel-ambient.d.ts 统一声明，这里不重复声明。
 */
/** 排一条折叠阶梯（issueDetailFold.ts 导出）。 */
declare function issueDetailFoldLadderOf(...args: any[]): any;
/** 第 tier 档每个元素画什么（issueDetailFold.ts 导出）。 */
declare function issueDetailFoldStateAt(...args: any[]): any;

export const useIssueDetailFold = function (st: any, issueNumber: any, issueEffort: any) {
  const topBarRef = React.useRef(null)
  React.useEffect(function () {
    const applyDetailFold = function () {
      const bar = topBarRef.current
      if (!bar || typeof document === 'undefined') return
      const q = function (sel: any) { try { return bar.querySelector(sel) } catch (e) { return null } }
      const backEl = q('[data-detail-back-text]')
      const crumbEl = q('[data-detail-crumb]')
      const snapEl = q('[data-detail-snapshot]')
      const primEl = q('[data-detail-primary-text]')
      const newEl = q('[data-detail-new-text]')
      const items = [backEl, crumbEl, snapEl, primEl, newEl].filter(function (x: any) { return !!x })
      if (!items.length) return
      items.forEach(function (el: any) {
        try {
          const full = el.getAttribute('data-full')
          if (full !== null && full !== undefined) el.textContent = full
        } catch (e) {}
      })
      let ladder = null
      try {
        if (typeof issueDetailFoldLadderOf === 'function') {
          ladder = issueDetailFoldLadderOf({
            back: backEl ? (backEl.getAttribute('data-full') || '') : '',
            crumb: crumbEl ? (crumbEl.getAttribute('data-full') || '') : '',
            snapshot: snapEl ? (snapEl.getAttribute('data-full') || '') : '',
            primary: primEl ? (primEl.getAttribute('data-full') || '') : '',
            newSession: newEl ? (newEl.getAttribute('data-full') || '') : '',
          })
        }
      } catch (e) { ladder = null }
      const fits = function () { try { return bar.scrollWidth <= bar.clientWidth + 1 } catch (e) { return true } }
      if (fits()) return
      if (ladder && typeof issueDetailFoldStateAt === 'function') {
        for (let t = 1; t <= ladder.steps.length; t++) {
          let cur = null
          try { cur = issueDetailFoldStateAt(ladder, t) } catch (e) { break }
          try {
            if (backEl) backEl.textContent = cur.back
            if (crumbEl) crumbEl.textContent = cur.crumb
            if (snapEl) snapEl.textContent = cur.snapshot
            if (primEl) primEl.textContent = cur.primary
            if (newEl) newEl.textContent = cur.newSession
          } catch (e2) { break }
          try { void bar.offsetWidth } catch (e3) {}
          if (fits()) return
        }
        return
      }
      const els = [backEl, crumbEl, snapEl, primEl, newEl].filter(function (x: any) { return !!x })
      for (let i = 0; i < els.length; i++) {
        while (els[i] && els[i].textContent && !fits()) {
          try { els[i].textContent = els[i].textContent.slice(0, -1) } catch (e) { break }
        }
        if (fits()) return
      }
    }
    applyDetailFold()
    let ro = null
    try {
      ro = new ResizeObserver(function () { applyDetailFold() })
      if (topBarRef.current) ro.observe(topBarRef.current)
    } catch (e) {}
    const onWin = function () { applyDetailFold() }
    if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(function () { applyDetailFold() })
    return function () { if (ro) try { ro.disconnect() } catch (e) {} ; if (typeof window !== 'undefined') window.removeEventListener('resize', onWin) }
  }, [issueNumber, issueEffort, st.cwd, st.snapshot, st.issueDetail, st.issueMode, st.navStack])
  return topBarRef
}
