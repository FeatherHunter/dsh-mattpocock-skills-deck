/**
 * panel/Overlay.js — 主面板悬浮容器（OverlayPanel，5.8；tabs 行改用共享 Tabs.js）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ---- 5.8 主面板（可拖动 · 8 向缩放 · 三视图 · v14 跟随当前会话 + 刷新遮罩）----
export     const OverlayPanel = (props) => {
      const cur = props.useSessions((x) => x.current)
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const s = cx ? cx.storeSvc.useStore(cur) : useStore(cur)
      const panelRef = React.useRef(null)
      const tabsRef = React.useRef(null)
      const headRef = React.useRef(null)
      const tabs = useTabsRow(s, tabsRef)
      React.useEffect(function () {
        const applyFold = function () {
          const t = tabsRef.current
          if (!t) return
          const btns = t.querySelectorAll('[data-priority]')
          const ver = t.querySelector('.dsws-ver')
          // 测量阶段临时禁用 transition（max-width 动画会污染 scrollWidth 测量 → 0/6 抖动）
          t.classList.add('dsws-no-anim')
          // 1) 全展开 + 强制 reflow（拿到"内容真实放得下"的基准）
          for (let i = 0; i < btns.length; i++) btns[i].classList.remove('collapsed')
          if (ver) ver.classList.remove('collapsed')
          void t.offsetWidth
          // 2) 从最不重要（priority 大）逐个折叠，直到放得下（scrollWidth 溢出判定）
          const items = Array.from(btns)
            .map(function (b) { return { el: b, p: Number(b.dataset.priority || 99) } })
            .sort(function (a, b) { return b.p - a.p })
          for (const it of items) {
            if (t.scrollWidth <= t.clientWidth + 1) break
            it.el.classList.add('collapsed')
            void t.offsetWidth
          }
          // 3) 版本号跟随「刷新」(priority=3) 折叠；记录折叠数供 tooltip 门控
          if (ver) {
            const refreshCollapsed = t.querySelector('[data-priority="3"]')?.classList.contains('collapsed')
            ver.classList.toggle('collapsed', !!refreshCollapsed)
          }
          t.dataset.tabsLevel = String(t.querySelectorAll('[data-priority].collapsed').length)
          t.classList.remove('dsws-no-anim')
        }
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { applyFold() }) : null
        let observed = null
        const apply = function () {
          const t = tabsRef.current
          if (!t) return
          if (ro && observed !== t) {
            if (observed) { try { ro.unobserve(observed) } catch (e) { /* noop */ } }
            ro.observe(t)
            observed = t
          }
          applyFold()
        }
        apply()
        if (typeof window !== 'undefined') window.addEventListener('resize', apply)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(apply)
        return function () { if (ro) ro.disconnect(); if (typeof window !== 'undefined') window.removeEventListener('resize', apply) }
      }, [s.open])
      // 头部自适应（Overlay）：同 Dock 逻辑，空间充足完整，挤压先藏标题文字，最后仅留 repo（#28）
      React.useEffect(function () {
        const applyHead = function () {
          const hd = headRef.current
          if (!hd) return
          const titleEl = hd.querySelector('[data-head-title]')
          const chip = hd.querySelector('[data-repo-chip]')
          const txt = chip && chip.querySelector('[data-repo-text]')
          if (!titleEl || !chip || !txt) return
          const repo = s.snapshot && s.snapshot.repo
          const full = repo ? repo.owner + '/' + repo.name : (s.snapMode === 'err' ? tr('panel.snapErr') : s.snapMode === 'loading' ? tr('panel.loading') : '')
          const short = repo ? repo.name : full
          const isRepo = !!(repo && repo.owner && repo.name)
          const naturalFits = function () {
            try { if (typeof measureContentWidth === 'function') return measureContentWidth(hd) <= hd.clientWidth + 1 } catch (e) {}
            return hd.scrollWidth <= hd.clientWidth + 1
          }
          titleEl.style.display = ''
          if (full) txt.textContent = full
          chip.style.flex = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          titleEl.style.display = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          if (isRepo) txt.textContent = short
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          chip.style.flex = '0 1 auto'
        }
        applyHead()
        let ro2 = null
        try { ro2 = new ResizeObserver(function () { applyHead() }); if (headRef.current) ro2.observe(headRef.current) } catch (e) {}
        const onWin = function () { applyHead() }
        if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(applyHead)
        return function () { if (ro2) try { ro2.disconnect() } catch (e) {} ; if (typeof window !== 'undefined') window.removeEventListener('resize', onWin) }
      }, [s.snapshot && s.snapshot.repo && (s.snapshot.repo.owner + '/' + s.snapshot.repo.name), s.snapMode, s.size && s.size.w, s.open])
      // #376：加载由 openPanel 统一分派（未就绪/过期 force，新鲜直接展示）；此处不再重复加载
      if (!s.open) return null
      const groups = compute(s)
      const active = s.activeMap !== null ? groups.find(function (x) { return x.m.number === s.activeMap }) : null
      // v14-19：窄屏阈值（面板宽 <380px 时动作按钮折叠为纯图标）
      const narrow = s.size.w < 380

      const startDrag = function (e) {
        if (typeof document === 'undefined' || typeof window === 'undefined') return
        if (!panelRef.current) return
        e.preventDefault()
        const rect = panelRef.current.getBoundingClientRect()
        const r0 = { x: s.pos ? s.pos.x : rect.left, y: s.pos ? s.pos.y : rect.top, sx: e.clientX, sy: e.clientY }
        const mm = function (ev) { s.pos = { x: r0.x + ev.clientX - r0.sx, y: r0.y + ev.clientY - r0.sy }; emit(s) }
        const mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
        document.addEventListener('mousemove', mm)
        document.addEventListener('mouseup', mu)
      }
      const onBodyDown = function (e) {
        if (e.target === e.currentTarget) startDrag(e)
      }

      const onResizeDown = function (dir) {
        return function (e) {
          e.stopPropagation()
          e.preventDefault()
          if (typeof document === 'undefined' || typeof window === 'undefined' || !panelRef.current) return
          const rect = panelRef.current.getBoundingClientRect()
          const r0 = { x: s.pos ? s.pos.x : rect.left, y: s.pos ? s.pos.y : rect.top, w: s.size.w || rect.width, h: s.size.h || rect.height, sx: e.clientX, sy: e.clientY }
          const mm = function (ev) {
            const dx = ev.clientX - r0.sx, dy = ev.clientY - r0.sy
            let w = r0.w, h = r0.h
            if (dir.indexOf('e') >= 0) w = r0.w + dx
            if (dir.indexOf('s') >= 0) h = r0.h + dy
            if (dir.indexOf('w') >= 0) w = r0.w - dx
            if (dir.indexOf('n') >= 0) h = r0.h - dy
            w = Math.min(900, Math.max(340, w))
            h = Math.min(920, Math.max(240, h))
            let x = r0.x, y = r0.y
            if (dir.indexOf('w') >= 0) x = r0.x + (r0.w - w)
            if (dir.indexOf('n') >= 0) y = r0.y + (r0.h - h)
            s.pos = { x: x, y: y }
            s.size = { w: w, h: h }
            emit(s)
          }
          const mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
          document.addEventListener('mousemove', mm)
          document.addEventListener('mouseup', mu)
        }
      }

      const panelStyle = { width: s.size.w, ...(s.size.h ? { height: s.size.h } : {}), ...(s.pos ? { left: s.pos.x, top: s.pos.y, right: 'auto' } : { left: 16, top: 76, right: 'auto' }) }
      return h('div', { ref: panelRef, className: 'dsws-panel', style: panelStyle }, [
        // #28 自适应头部：minWidth 0 允许收缩，先藏标题文字（留图标），最后仅留 repo
        h('div', { ref: headRef, className: 'dsws-head', onMouseDown: startDrag, style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } }, [
          Icon({ scheme: s.ui.icon, size: 17 }),
          h('span', { 'data-head-title': 1, style: { fontWeight: 600, whiteSpace: 'nowrap', flex: 'none' } }, tr('panel.title')),
          // v19-35：「真数据」→ 显示 repo 名（对未来用户更有意义；异常时红色提示）
          h('span', { 'data-repo-chip': 1, className: 'dsws-chip ' + (s.snapMode === 'err' ? 'dsws-chip-t' : 'dsws-chip-m'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 1 auto', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [
            Ic({ n: s.snapMode === 'err' ? 'alert' : 'info', size: 11 }),
            h('span', { 'data-repo-text': 1, className: 'dsws-ellip', title: repoStr(s), style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, s.snapMode === 'err' ? tr('panel.snapErr') : s.snapMode === 'loading' ? tr('panel.loading') : repoStr(s)),
          ]),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dsws-btn ghost', title: tr('panel.closeTitle'), onClick: function () { s.open = false; emit(s) }, style: { display: 'inline-flex', alignItems: 'center' } }, Ic({ n: 'x', size: 12 })),
        ]),
                h('div', { className: 'dsws-tabs', ref: tabsRef, style: { display: 'flex', alignItems: 'center', gap: 4 } }, tabs.items),
        h('div', { className: 'dsws-body', onMouseDown: onBodyDown }, [
          s.tab === 'list' ? (active ? h(MapDetail, { st: s, g: active }) : h(ListTab, { st: s, narrow: narrow })) : null,
          s.tab === 'skills' ? h(SkillsTab, { st: s }) : null,
          s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
        ]),
        h('div', { className: 'dsws-rz dsws-rz-n', onMouseDown: onResizeDown('n'), title: tr('rz.n') }),
        h('div', { className: 'dsws-rz dsws-rz-s', onMouseDown: onResizeDown('s'), title: tr('rz.s') }),
        h('div', { className: 'dsws-rz dsws-rz-e', onMouseDown: onResizeDown('e'), title: tr('rz.e') }),
        h('div', { className: 'dsws-rz dsws-rz-w', onMouseDown: onResizeDown('w'), title: tr('rz.w') }),
        h('div', { className: 'dsws-rz dsws-rz-ne', onMouseDown: onResizeDown('ne'), title: tr('rz.ne') }),
        h('div', { className: 'dsws-rz dsws-rz-nw', onMouseDown: onResizeDown('nw'), title: tr('rz.nw') }),
        h('div', { className: 'dsws-rz dsws-rz-se', onMouseDown: onResizeDown('se'), title: tr('rz.se') }),
        h('div', { className: 'dsws-rz dsws-rz-sw', onMouseDown: onResizeDown('sw'), title: tr('rz.sw') }),
        // v1.5 T10 R7：刷新遮罩已废除（手动刷新走静默路径，无「刷新中」）
        s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
          h('span', null, s.notice.text),
        ]) : null,
      ])
    }
