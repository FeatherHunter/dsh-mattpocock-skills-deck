/**
 * panel/Dock.js — 右侧停靠容器（DetailsDock，5.8b；tabs 行改用共享 Tabs.js）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ---- 5.8b 右侧停靠（details 槽位 · 三视图完整内容；开合/拖拽/宽度记忆由壳管理）----
    // 契约：details 槽 = 壳右侧第三列（AppFrame grid），scope session；关闭 = ctx.layout.closeDetails()
    //   （占位者 props 亦注入 closeDetails）；宽度 300-520px 可拖拽；关闭时子树不卸载（状态保留）。
    // issue #15：tabs 行内容放不下时折叠为纯图标（内容自适应 + 滞回防抖）
export     const DetailsDock = (props) => {
      // #45 回归（2026-08-20 续）：切绘画/工作区后右面板串台
      // 根因：原 DetailsDock 仅在挂载时跑一次副作用（deps []），且直接取 props.sessionId（details 槽位在宿主里常为空 → 退回 shared 单例），
      //   导致：① 切绘画（sessionId 变化）不重跑水合/加载，旧绘画的 polluted snapshot 常驻；② 非 current 工作区的 snapshot 经 shared 广播后，details 常显 shared.cwd（首工作区）快照。
      // 修复：① 用 props.useSessions 权威信号跟随当前会话（hookCurrent）与精确 cwd（summaryCwd），props.sessionId / scope.sessionId 优先；② 副作用 deps 改为 [sid]/[sid,summaryCwd]，切绘画即触发 cwd 同步 + 水合；③ 空 deps 根除。
      const hookCurrent = (props && typeof props.useSessions === 'function') ? props.useSessions(function (x) { return x.current }) : undefined
      const propSid = props && (props.sessionId || (props.scope && props.scope.sessionId) || (props.session && props.session.id))
      const sid = propSid || hookCurrent
      const cx = React.useContext(DswsCtx)
      if (!cx) return null
      const h = cx.h
      const summaryCwd = (props && typeof props.useSessions === 'function' && sid) ? props.useSessions(function (x) { return (x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined }) : undefined
      const s = cx.storeSvc.useStore(sid)
      const layoutSvc = ctx.get('layout')
      const dockRef = React.useRef(null)
      const [dw, setDw] = React.useState(460)
      // 列宽感知：details 列 300-520px；窄于 380 时动作按钮折叠为纯图标（与悬浮面板同阈值）
      React.useEffect(function () {
        if (!dockRef.current) return
        const el = dockRef.current
        const ro = new ResizeObserver(function (entries) {
          try { setDw(entries[0].contentRect.width) } catch (e) { /* 忽略 */ }
        })
        ro.observe(el)
        return function () { try { ro.disconnect() } catch (e) { /* 忽略 */ } }
      }, [])
      // 响应式工作区同步（对齐 StatusBar）：当 host 权威的 summaryCwd / session 变化，立即把 s.cwd 切到正确工作区并水合 per-cwd 缓存
      React.useEffect(function () {
        const apply = function (cwd) {
          if (cwd && cwd !== s.cwd) {
            s.cwd = cwd
            const hydrated = hydrateFromCache(s)
            emit(s)
            loadChecks(s, false)
            if (!hydrated || !snapFresh(s)) loadSnapshot(s, false)
          }
        }
        if (summaryCwd) { apply(summaryCwd); return }
        const cwd0 = detectCwd(props && props.session)
        if (cwd0) { apply(cwd0); return }
        if (sid && typeof host !== 'undefined' && typeof host.call === 'function') {
          host.call('wf.cwd', { sessionId: sid }).then(function (res) {
            if (res && res.ok && res.cwd) apply(res.cwd)
          }).catch(function () { /* 保持现有 cwd */ })
        }
      }, [sid, summaryCwd])
      // 初始数据：随 sid 变化重跑（修复空 deps 导致切绘画不刷新；含 per-cwd 水合秒开 + 污染残留自愈）
      React.useEffect(function () {
        if (!s.cwd) {
          const sync = getCwdSync(sid)
          if (sync) { s.cwd = sync; hydrateFromCache(s) }
        } else { hydrateFromCache(s) }
        // 污染自愈：若当前 store 的 snapshot 仍是之前工作区串台残留（repoRoot 与 cwd 前缀不匹配，或 repo 名与 cwd 尾段不一致），强制后台刷新
        const isPolluted = (function(){
          if (!s.snapshot || !s.cwd) return false
          const snap = s.snapshot
          if (snap.repoRoot) {
            const rr = String(snap.repoRoot).replace(/\\/g,'/').replace(/\/+$/,'')
            const cw = String(s.cwd).replace(/\\/g,'/').replace(/\/+$/,'')
            if (cw === rr) return false
            if (cw.startsWith(rr + '/')) return false
            if (rr.startsWith(cw + '/')) return false
            return true
          }
          if (snap.repo && snap.repo.name) {
            const base = cwdBasename(s.cwd)
            if (base && snap.repo.name !== base) {
              // 仅当 repoRoot 缺失时用 basename 辅助判断，避免子目录 repo 名与目录名不一致误判；此处放宽：不同名且不同 cwd 即视为可疑
              // 保守：若 cwdBasename 与 repo.name 完全不同且 snapshot 非空，视为污染
              return true
            }
          }
          return false
        })()
        if (isPolluted) { loadSnapshot(s, false); loadChecks(s, false); return }
        if (!snapFresh(s)) loadSnapshot(s, false); loadChecks(s, false)
      }, [sid])
      const closeDock = function () {
        if (props && typeof props.closeDetails === 'function') props.closeDetails()
        else if (layoutSvc && typeof layoutSvc.closeDetails === 'function') layoutSvc.closeDetails()
      }
      const groups = compute(s)
      const active = s.activeMap !== null ? groups.find(function (x) { return x.m.number === s.activeMap }) : null
      const narrow = dw < 380
      const tabsRef = React.useRef(null)
      const tabs = useTabsRow(s, tabsRef)
      const headRef = React.useRef(null)
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
      }, [])
      // 头部自适应：空间充足时完整，挤压时先隐藏 MATT skills 文字（保留图标），最后仅留 repo（#28）
      React.useEffect(function () {
        const applyHead = function () {
          const hd = headRef.current
          if (!hd) return
          const titleEl = hd.querySelector('[data-head-title]')
          const chip = hd.querySelector('[data-repo-chip]')
          const txt = chip && chip.querySelector('[data-repo-text]')
          if (!titleEl || !chip || !txt) return
          const repo = s.snapshot && s.snapshot.repo
          const full = repo ? repo.owner + '/' + repo.name : ''
          const short = repo ? repo.name : ''
          const naturalFits = function () {
            try { if (typeof measureContentWidth === 'function') return measureContentWidth(hd) <= hd.clientWidth + 1 } catch (e) {}
            return hd.scrollWidth <= hd.clientWidth + 1
          }
          // 基准：标题可见 + 完整仓库名（固宽测自然宽）
          titleEl.style.display = ''
          if (full) txt.textContent = full
          chip.style.flex = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 阶段1：隐藏标题，优先保仓库名
          titleEl.style.display = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 阶段2：极窄时仅留 repo
          if (full && short) txt.textContent = short
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 仍放不下：允许 chip 弹性 ellipsis 收缩
          chip.style.flex = '0 1 auto'
        }
        applyHead()
        let ro2 = null
        try {
          ro2 = new ResizeObserver(function () { applyHead() })
          if (headRef.current) ro2.observe(headRef.current)
        } catch (e) {}
        const onWin = function () { applyHead() }
        if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(applyHead)
        return function () { if (ro2) try { ro2.disconnect() } catch (e) {} ; if (typeof window !== 'undefined') window.removeEventListener('resize', onWin) }
      }, [s.snapshot && s.snapshot.repo && (s.snapshot.repo.owner + '/' + s.snapshot.repo.name), dw])
      return h('div', { ref: dockRef, 'data-dsws-host': '1', className: narrow ? 'dsws-narrow' : undefined, style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--dsw-font-family)', fontSize: 12, color: 'var(--dsw-alias-label-primary,#e6edf3)', background: 'var(--dsw-alias-bg-layer-1,#10131a)' } }, [
        // 头部（标题 + 关闭）：横线不放在这行，下移到标签行下方与对话/轨迹对齐
        // #28 自适应：flex 容器 minWidth 0 + 芯片 flex 自适应，标题优先隐藏，极窄仅留 repo
        h('div', { ref: headRef, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 6px', flex: 'none', minWidth: 0 } }, [
          Icon({ scheme: 'compass', size: 15 }),
          h('span', { 'data-head-title': 1, style: { fontWeight: 600, fontSize: 13, flex: 'none', whiteSpace: 'nowrap' } }, tr('panel.title')),
          // v1.5 T7：仓库身份组件 —— 当前检测到的 git 仓库（owner/name），点击打开 GitHub
          (s.snapshot && s.snapshot.repo) ? h('a', { href: 'https://github.com/' + s.snapshot.repo.owner + '/' + s.snapshot.repo.name, target: '_blank', rel: 'noreferrer', title: tr('panel.repoTitle'), 'data-repo-chip': 1, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#58a6ff', background: 'rgba(88,166,255,.1)', border: '1px solid rgba(88,166,255,.45)', borderRadius: 6, padding: '1px 8px', flex: '0 1 auto', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Consolas,Menlo,monospace' } }, [
            h('svg', { viewBox: '0 0 16 16', width: 11, height: 11, fill: 'currentColor', style: { flex: 'none' } }, [h('path', { d: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 8h8.5V1.5z' })]),
            h('span', { 'data-repo-text': 1, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, s.snapshot.repo.owner + '/' + s.snapshot.repo.name),
          ]) : h('span', { title: tr('panel.noRepoTitle'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#f87171', background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.5)', borderRadius: 6, padding: '1px 8px', flex: 'none', whiteSpace: 'nowrap' } }, [
            Ic({ n: 'alert', size: 11 }),
            h('span', null, tr('panel.noRepo')),
          ]),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dsws-btn ghost', title: tr('panel.closeTitle'), onClick: closeDock, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 6px', fontSize: 11 } }, Ic({ n: 'x', size: 12 })),
        ]),
        // 标签行下沿 = 与对话/轨迹一致的横线；右侧：刷新按钮 + 版本号（v1.3.3）
        h('div', { className: 'dsws-tabs', ref: tabsRef, style: { padding: '0 12px 7px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)', flex: 'none', display: 'flex', alignItems: 'center', gap: 4 } }, tabs.items),
        h('div', { className: 'dsws-body', style: { flex: 1, overflowY: 'auto', padding: '10px 12px' } }, [
          s.tab === 'list' ? (active ? h(MapDetail, { st: s, g: active }) : h(ListTab, { st: s, narrow: narrow })) : null,
          s.tab === 'skills' ? h(SkillsTab, { st: s }) : null,
          s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
        ]),
        // v1.5 T10 R7：刷新遮罩已废除（手动刷新走静默路径，无「刷新中」）
        s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
          h('span', null, s.notice.text),
        ]) : null,
      ])
    }
