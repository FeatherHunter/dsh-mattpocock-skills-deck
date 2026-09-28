/**
 * views/useIssueDetailFold.js — ISSUE 详情页顶栏折叠机（#763）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物）。
 * 判据在 views/issueDetailFold.js；这里只读写顶栏那一段 DOM。
 * 返回优先收到图标，一次只折一个控件，不放省略号。
 */
export const useIssueDetailFold = function (st, issueNumber, issueEffort) {
  const topBarRef = React.useRef(null)
  React.useEffect(function () {
    const applyDetailFold = function () {
      const bar = topBarRef.current
      if (!bar || typeof document === 'undefined') return
      const q = function (sel) { try { return bar.querySelector(sel) } catch (e) { return null } }
      const backEl = q('[data-detail-back-text]')
      const crumbEl = q('[data-detail-crumb]')
      const snapEl = q('[data-detail-snapshot]')
      const primEl = q('[data-detail-primary-text]')
      const newEl = q('[data-detail-new-text]')
      const items = [backEl, crumbEl, snapEl, primEl, newEl].filter(function (x) { return !!x })
      if (!items.length) return
      items.forEach(function (el) {
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
      const els = [backEl, crumbEl, snapEl, primEl, newEl].filter(function (x) { return !!x })
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
