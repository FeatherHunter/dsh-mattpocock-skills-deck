/**
 * statusbar/StatusBar.js — 输入区状态栏（5.2；Seg/checksums/技能悬浮列表已拆出）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ---- 5.2 输入区状态栏（定稿 1A 居中胶囊 · 反馈不进状态栏 · cwd 关联 · v14 数字区等宽 + 交接段）----
export     const StatusBar = (props) => {
      const sid = props && props.sessionId
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const s = cx ? cx.storeSvc.useStore(sid) : useStore(sid)
      // v15-27：宿主权威 cwd —— SessionSummary.cwd（会话列表工作区标题同源），替换字段名猜测链
      const summaryCwd = props.useSessions(function (x) {
        return (sid && x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined
      })
      // v14-20 → r3：跨会话预填（交接开新会话后，新 dock 挂载即消费）。
      // issue #12 BUG4 r3 终极修复（最简形式）：
      //   关键改动：effect deps 从 [props] 改为 [props.sessionId]。
      //   旧实现 [props] 依赖会因 ws.startSession 触发父级重渲染 → 当前会话的 props 引用变 → 当前会话 effect 重跑 → 抢先消费 pendingDraft。
      //   新实现 [props.sessionId] 只在 sid 变化时跑（即每个会话只在初次 mount 跑一次），
      //     · 当前会话：sid 长期不变 → effect 不重跑 → 不抢先消费
      //     · 新会话：sid 初次设置 → effect 跑一次 → 消费 pendingDraft
      //   consumedDraftRef 守卫保留作为 belt-and-suspenders：即使组件 remount（同 sid 字符串），
      //     ref 仍能防止 effect 重入。
      // r4：consumedDraftRef 按 sid 存储 + pendingDraftTargetSid 锚定新会话，防止 boolean 常驻阻断后续注入
      const consumedDraftRef = React.useRef(null)
      // 注入器常驻：只要 inputActions 就位就挂到 s.injector（不依赖 pendingDraft）
      React.useEffect(function () {
        if (props && props.inputActions && typeof props.inputActions.setDraft === 'function') {
          s.injector = props.inputActions.setDraft
        }
      }, [props.sessionId, props.inputActions])
      React.useEffect(function () {
        if (!props || !props.sessionId) return
        if (consumedDraftRef.current === props.sessionId) return
        if (!props.inputActions || typeof props.inputActions.setDraft !== 'function') return
        s.injector = props.inputActions.setDraft
        if (pendingDraft) {
          // 若有目标 sid 锚定，则仅目标会话消费；无锚定（handoff 兼容）则任意新会话可消费
          if (pendingDraftTargetSid && pendingDraftTargetSid !== props.sessionId) return
          consumedDraftRef.current = props.sessionId
          const text = pendingDraft
          pendingDraft = null
          pendingDraftTargetSid = null
          props.inputActions.setDraft(text)
        }
      }, [props.sessionId, props.inputActions])
      React.useEffect(function () {
        probeHandoffReady(s)  // 需求1·二阶段 rev：挂载即探测 .scratch/handoff/，以真实文档有无决定右半灰/亮
        ensureIssuePath(s); startIssuePathPoll(s)
      }, [])
      // v13：会话工作目录探测 —— 依赖 sessionId 变化重跑（切换对话必触发）。
      // v15-27：优先 SessionSummary.cwd（宿主权威）；次选 props.session 直取；最后 host wf.cwd 兜底。
      // cwd 变化后主动重拉快照与检查（否则面板/状态栏仍显示旧仓库数据）。
      React.useEffect(function () {
        const apply = function (cwd) {
          if (cwd && cwd !== s.cwd) {
            s.cwd = cwd
            // #58 缓存优先：同步水合 per-cwd 内存快照，秒开
            const hydrated = hydrateFromCache(s)
            emit(s)
            loadChecks(s, false)
            // #58 已水合且新鲜则无需再 load，保持秒开；过期则后台静默刷新
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
      // v1.5：挂载时新鲜数据（≤60s，含新会话继承的快照）跳过重载，避免冷缓存全量重建卡顿
      React.useEffect(function () { loadChecks(s, false); if (!snapFresh(s)) loadSnapshot(s, false) }, [])
      // v18-30：可接/占用 = 列表 open issue 口径（与面板列表一致）
      const csx = checksumsOf(s)
      const { fr, bugN, triageN, n, timeStr, setup, amber, skillsCheck, skillsBad, ghCliBad, ghAuthBad } = csx
      const go = function (tab) { s.tab = tab; openPanel(s) }
      // #16 V2（2026-08-18 复现后重设计）：dn/dw 阈值体系废弃——dn 信号源 R5 起改为输入区（wrapper）宽，
      //   默认 1280 视口下输入区仅 812px，dn=0 永不出现 → 宽屏默认缺品牌字。
      //   改为内容自适应渐进收缩（仿 #15 tabs）：applyFold 全展开后按 data-fold-priority 升序
      //   逐个折叠文字 span（.dsws-folded → display:none），直到 scrollWidth ≤ clientWidth。
      //   优先级 = 信息价值：品牌(1) → 沉淀(2)/交接(3)/刷新字(4) → 可接(5)/BUG(6)/诊断(7)/环境(8) → 时间(9)。
      //   折叠由 React 外部 DOM class 驱动（React 重渲染时 className prop 不变 → classList 手动变化保留）。
      const inputRef = React.useRef(null)
      const foldRef = React.useRef(null)
      const bugAnchorRef = React.useRef(null)
      const bugCloseRef = React.useRef(null)
      const issuePathAnchorRef = React.useRef(null)
      const issuePathCloseRef = React.useRef(null)
      const [iw, setIw] = React.useState(780)
      // issue #22：布局 wrapper 保持裁剪职责；浮层位置以锚点 viewport rect 表示。
      const placeOverlay = function (el, align) {
        if (!el || typeof window === 'undefined') return null
        const r = el.getBoundingClientRect()
        if (!r || (!r.width && !r.height)) return null
        const p = { bottom: Math.max(0, Math.round(window.innerHeight - r.top)) }
        if (align === 'right') p.right = Math.max(0, Math.round(window.innerWidth - r.right))
        else p.left = Math.max(0, Math.round(r.left))
        return p
      }
      const placeBugMenu = function () {
        const p = placeOverlay(bugAnchorRef.current, 'left')
        if (!p) return false
        const old = s.bugMenuPos
        if (old && old.left === p.left && old.bottom === p.bottom) return false
        s.bugMenuPos = p
        return true
      }
      const placeIssuePathPop = function () {
        const p = placeOverlay(issuePathAnchorRef.current, 'left')
        if (!p) return false
        // G1 Q3 定版：保持 left 加右溢 clamp（v1.7.x 右移版，防弹层超出视口右缘）
        if (p.left !== undefined && typeof window !== 'undefined' && window.innerWidth) {
          const maxLeft = Math.max(8, window.innerWidth - 320)
          if (p.left > maxLeft) p.left = maxLeft
        }
        const old = s.issuePathPos
        if (old && old.left === p.left && old.bottom === p.bottom) return false
        s.issuePathPos = p
        return true
      }
      const clearClose = function (ref) {
        if (ref.current !== null) { clearTimeout(ref.current); ref.current = null }
      }
      const closeBugMenu = function () {
        clearClose(bugCloseRef)
        if (!s.bugMenuOpen && !s.bugMenuPos && !s.bugMenuHover) return
        s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; emit(s)
      }
      const closeIssuePath = function () {
        clearClose(issuePathCloseRef)
        if (!s.issuePathHover && !s.issuePathPos) return
        s.issuePathHover = false; s.issuePathPos = null; emit(s)
      }
      const scheduleClose = function (ref, fn) {
        clearClose(ref)
        ref.current = setTimeout(function () { ref.current = null; fn() }, 160)
      }
      const showBugMenu = function () {
        clearClose(bugCloseRef)
        let changed = false
        if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
        if (!s.bugMenuOpen) { s.bugMenuOpen = true; changed = true }
        if (placeBugMenu()) changed = true
        if (changed) emit(s)
      }
      const showIssuePath = function () {
        clearClose(issuePathCloseRef); clearClose(bugCloseRef)
        let changed = false
        if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
        if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
        if (!s.issuePathHover) { s.issuePathHover = true; changed = true }
        if (placeIssuePathPop()) changed = true
        if (changed) emit(s)
      }
      React.useEffect(function () {
        if (!s.bugMenuOpen && !s.issuePathHover) return undefined
        let raf = null
        let disposed = false
        const reposition = function () {
          if (disposed || raf !== null) return
          const run = function () {
            raf = null
            if (disposed) return
            let changed = false
            if (s.bugMenuOpen && placeBugMenu()) changed = true
            if (s.issuePathHover && placeIssuePathPop()) changed = true
            if (changed) emit(s)
          }
          if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(run)
          else raf = setTimeout(run, 0)
        }
        document.addEventListener('scroll', reposition, { capture: true, passive: true })
        window.addEventListener('resize', reposition)
        const ro = new ResizeObserver(reposition)
        if (bugAnchorRef.current) ro.observe(bugAnchorRef.current)
        if (issuePathAnchorRef.current) ro.observe(issuePathAnchorRef.current)
        reposition()
        return function () {
          disposed = true
          ro.disconnect()
          if (raf !== null) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
            else clearTimeout(raf)
          }
          document.removeEventListener('scroll', reposition, true)
          window.removeEventListener('resize', reposition)
          clearClose(bugCloseRef); clearClose(issuePathCloseRef)
        }
      }, [s.bugMenuOpen, s.issuePathHover])
      const applyFold = function () {
        const cap = foldRef.current
        if (!cap) return
        const targets = Array.from(cap.querySelectorAll('[data-fold-priority]'))
        if (!targets.length) return
        cap.classList.add('dsws-no-anim')
        targets.forEach(function (el) { el.classList.remove('dsws-folded') })
        void cap.offsetWidth
        const items = targets.map(function (el) {
          return { el: el, p: Number(el.getAttribute('data-fold-priority') || 99) }
        }).sort(function (a, b) { return a.p - b.p })
        for (const it of items) {
          if (cap.scrollWidth <= cap.clientWidth + 1) break
          it.el.classList.add('dsws-folded')
          void cap.offsetWidth
        }
        cap.dataset.fold = String(targets.filter(function (el) {
          return el.classList.contains('dsws-folded')
        }).length)
        cap.classList.remove('dsws-no-anim')
      }
      React.useEffect(function () {
        const ta = document.querySelector('textarea.uV2eYG_input')
        if (ta) inputRef.current = ta
        const applyInput = function () {
          if (!inputRef.current) return
          try { setIw(inputRef.current.getBoundingClientRect().width) } catch (e) { /* 忽略 */ }
        }
        applyInput()
        const roInput = new ResizeObserver(applyInput)
        if (inputRef.current) roInput.observe(inputRef.current)
        // 折叠重算：capsule 宽（=iw）变化 / 窗口 resize / 字体加载后（防字体宽差误判）
        const roFold = new ResizeObserver(function () { applyFold() })
        const applyAll = function () { applyInput(); applyFold() }
        applyFold()
        if (foldRef.current) roFold.observe(foldRef.current)
        window.addEventListener('resize', applyAll)
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyFold)
        // DSH shell 偶尔会在对话切换时重新挂载 textarea，轮询兜底重读
        const poll = setInterval(applyAll, 2000)
        return function () {
          try { roInput.disconnect() } catch (e) { /* 忽略 */ }
          try { roFold.disconnect() } catch (e) { /* 忽略 */ }
          window.removeEventListener('resize', applyAll)
          clearInterval(poll)
        }
      }, [])
      const capsule = h('div', { className: 'dsws-capsule', ref: foldRef, onClick: function () { openPanel(s) }, style: { position: 'relative', width: iw + 'px', maxWidth: iw + 'px' } }, [
        h('span', { className: 'dsws-capsule-word', onClick: function (e) { e.stopPropagation(); togglePanel(s) } }, [
          Icon({ scheme: s.ui.icon, size: 14 }),
          h('span', { 'data-fold-priority': 1 }, tr('panel.title')),
        ]),
        seg('target', [h('span', { 'data-fold-priority': 5 }, tr('nav.takeable')), num(String(fr), '2ch')], '#4ade80', function () { s.stateFilter = 'frontier'; go('list') }, tr('nav.takeableTitle')),
        // issue #4：BUG 计数段 —— 点击仍开 bug 过滤列表；悬停弹「新增」菜单（新会话预填 /wayfinder 新增 BUG 单 prompt）
        h('span', { ref: bugAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showBugMenu, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) } }, [
          seg('alert', [h('span', { 'data-fold-priority': 6 }, tr('nav.bug')), num(String(bugN), '2ch')], '#f87171', function () { s.stateFilter = 'open'; s.lblFilters = ['bug']; go('list') }, tr('nav.bugTitle')),
          s.bugMenuOpen ? PortalOverlay({ className: 'dsws-bugmenu', onMouseEnter: function () { clearClose(bugCloseRef) }, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.bugMenuPos ? s.bugMenuPos.left : 0, bottom: s.bugMenuPos ? s.bugMenuPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)' } }, [
            h('div', { onClick: function (e) { e.stopPropagation(); closeBugMenu(); openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, onMouseEnter: function () { if (!s.bugMenuHover) { s.bugMenuHover = true; emit(s) } }, onMouseLeave: function () { if (s.bugMenuHover) { s.bugMenuHover = false; emit(s) } }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.bugMenuHover ? '#f87171' : 'var(--dsw-alias-label-primary,#e6edf3)', background: s.bugMenuHover ? 'rgba(248,113,113,.15)' : 'transparent', whiteSpace: 'nowrap' } }, [
              Ic({ n: 'bug', size: 12, color: s.bugMenuHover ? '#fca5a5' : '#f87171' }),
              h('span', null, tr('nav.bugNew')),
            ]),
          ]) : null,
        ]),
        seg('search', [h('span', { 'data-fold-priority': 7 }, tr('nav.triage')), num(String(triageN), '2ch')], '#f59e0b', function () { s.stateFilter = 'open'; s.lblFilters = ['needs-triage']; go('list') }, tr('nav.triageTitle')),
        // #16 V2：note 段（沉淀 / Consolidate）文字 span 打 data-fold-priority=2（无数字操作段，信息价值低，早收）
        seg('note', h('span', { 'data-fold-priority': 2 }, tr('nav.word')), '#c084fc', function () { injectFixate(s) }, tr('nav.fixateTitle')),
        // 需求1·二阶段（2026-08-18）：交接分割按钮 —— 共外框 + 细分隔线；左半「交接」= 第一击生成、
        //   右半「交接出去」= 原第二击（探测磁盘最新文档 → 预填 + 开新会话）。各自点击区/tooltip 保留，hover 沿用 seg 背景。
        //   右半灰/亮双态：handoffReady → 亮蓝 #58a6ff（tooltip nav.handoffReadyTitle）；未 ready → 半透明灰（tooltip nav.handoffGreyTitle）
        // #16 V2：split-part 左半「交接」文字 span 打 data-fold-priority=3（无数字操作段）
        h('span', { className: 'dsws-split' }, [
          h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoff(s) }, title: tr('nav.handoffTitle'), style: { color: '#58a6ff' } }, [
            Ic({ n: 'handoff', size: 12 }),
            h('span', { 'data-fold-priority': 3 }, tr('nav.handoff')),
          ]),
          h('span', { className: 'dsws-split-div' }),
          h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoffOpen(s) }, title: s.handoffReady ? tr('nav.handoffReadyTitle') : tr('nav.handoffGreyTitle'), style: s.handoffReady ? { color: '#58a6ff' } : { color: '#8b8b95', opacity: 0.55, cursor: 'default' } }, [
            s.handoffSearching ? h('span', { className: 'dsws-spinner', style: { width: 12, height: 12, borderWidth: 2, boxSizing: 'border-box', display: 'inline-block', verticalAlign: '-2px' } }) : Ic({ n: s.handoffReady ? 'handoff-open' : 'handoff-off', size: 12 }),
          ]),
        ]),
        // issuePath · 状态栏当前 Issue 胶囊（v1.7.x 右移版 · G1 定版移至 env 左侧）—— 常驻显示当前 #N，hover 向上弹层
        h('span', { ref: issuePathAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showIssuePath, onMouseLeave: function () { scheduleClose(issuePathCloseRef, closeIssuePath) } }, [
          h('span', { className: 'dsws-seg' + (s.issuePathHover ? ' on' : ''), onClick: function (e) { e.stopPropagation(); if (s.issuePath && s.issuePath.current) { s.tab='list'; openPanel(s) } }, title: s.issuePath && s.issuePath.current ? '当前处理 #' + s.issuePath.current + ' · hover 查看路径 · 点击打开列表' : '尚未选择当前 Issue · 点击操作会自动记录', style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: s.issuePath && s.issuePath.current ? '#4ade80' : '#6b7280', border: s.issuePathHover ? '1px solid rgba(74,222,128,.45)' : '1px solid transparent', background: s.issuePathHover ? 'rgba(74,222,128,.12)' : 'transparent', borderRadius: 99, padding: '2px 7px' } }, [
            Ic({ n: 'pin', size: 12 }),
            h('span', { 'data-fold-priority': 10 }, s.issuePath && s.issuePath.current ? '#' + s.issuePath.current : '--'),
          ]),
          s.issuePathHover ? PortalOverlay({ className: 'dsws-issuepath-pop', onMouseEnter: function () { clearClose(issuePathCloseRef) }, onMouseLeave: function () { scheduleClose(issuePathCloseRef, closeIssuePath) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.issuePathPos ? s.issuePathPos.left : 0, bottom: s.issuePathPos ? s.issuePathPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.45)', minWidth: 260, maxWidth: 380 } }, [
            h('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--dsw-alias-label-primary,#e6edf3)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 } }, [
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'pin', size: 12 }), h('span', null, '当前路径')]),
              h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', fontWeight: 400 } }, s.issuePath && s.issuePath.nodes && s.issuePath.nodes.length ? 'anchor #' + s.issuePath.anchor + ' · ' + s.issuePath.nodes.length + ' 节点' : '空'),
              h('span', { style: { marginLeft: 'auto', display: 'inline-flex', gap: 4 } }, [
                h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); clearIssuePath(s); closeIssuePath() }, style: { fontSize: 10, padding: '2px 6px' } }, '清空'),
              ]),
            ]),
            (s.issuePath && s.issuePath.nodes && s.issuePath.nodes.length) ? h('div', { style: { maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 } }, s.issuePath.nodes.slice(-20).reverse().map(function (nd) {
              const isCur = nd.ref === s.issuePath.current
              const isAnchor = nd.ref === s.issuePath.anchor
              const t = new Date(nd.ts || Date.now()); const tm = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0')
              const srcColor = nd.source === 'claim' ? '#4ade80' : nd.source === 'gh-edit' ? '#58a6ff' : nd.source === 'mention' ? '#f59e0b' : '#8b8b95'
              const srcLabel = nd.source === 'claim' ? 'claim' : nd.source === 'gh-edit' ? 'gh-edit' : nd.source === 'mention' ? 'mention' : nd.source
              return h('div', { key: nd.ts + '-' + nd.ref, onClick: function (e) { e.stopPropagation(); reanchorIssuePath(s, nd.ref) }, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, background: isCur ? 'rgba(74,222,128,.14)' : 'transparent', border: isCur ? '1px solid rgba(74,222,128,.35)' : '1px solid transparent', cursor: 'pointer' } }, [
                h('span', { style: { fontSize: 11, fontFamily: 'Consolas,Menlo,monospace', color: isCur ? '#4ade80' : 'var(--dsw-alias-label-primary,#e6edf3)', fontWeight: isCur ? 700 : 500 } }, '#' + nd.ref + (isAnchor ? ' ⚓' : '')),
                h('span', { style: { fontSize: 10, color: srcColor, border: '1px solid ' + srcColor, borderRadius: 4, padding: '0 4px', lineHeight: 1.6 } }, srcLabel),
                h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tm),
                nd.title ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, nd.title) : null,
                isCur ? h('span', { style: { fontSize: 10, color: '#4ade80', fontWeight: 700 } }, '← 当前') : null,
              ])
            })) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '6px 0' } }, '暂无路径 · 点击任意 issue 行的“执行/诊断/修复”或在新会话中打开 issue 会自动记录'),
            h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', marginTop: 6, paddingTop: 4, display: 'flex', alignItems: 'center', gap: 4 } }, [
              h('span', null, '点击节点可重锚起点'),
              h('span', { style: { marginLeft: 'auto' } }, '上限 100 · 本地持久'),
            ]),
          ]) : null,
        ]),
        // v19-36：环境段移至末尾（更新左侧），用户少点
        seg('dot', [h('span', { 'data-fold-priority': 8 }, tr('nav.env')), num(envLabel(s))], n < 0 ? '#f87171' : n === envTotal(s) ? '#4ade80' : '#f59e0b', function () { go('checks') }, tr('nav.envTitle', { n: n < 0 ? '?' : String(n), t: String(envTotal(s)) })),
        // v1.5 T10：刷新反馈 = 图标转圈（文字恒定不换 · 控件宽度零变化）
        // #16 V2：timebtn 两段文字各打 priority（刷新字=4 无数字操作段 / 时间=9 纯参考时间戳最后收）
        h('span', { className: 'dsws-timebtn', onClick: function (e) { e.stopPropagation(); refreshAll(s) }, title: tr('nav.refreshTitle') }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', { 'data-fold-priority': 4 }, tr('nav.refresh')), h('span', { 'data-fold-priority': 9 }, ' ' + timeStr)]),
        // 需求2（2026-08-18）：状态栏末尾技能列表按钮 —— 悬浮列表组件（floating/SkillFloatList.js · #97 T4 拆出）
        h(SkillFloatList, { s: s }),
      ])
      // 用户拍板 2026-08-16 + 2026-08-17：横幅移到状态栏上方；依赖链 gh → 登录 → setup → 技能，显示第一个缺失项
      const firstBlock = ghCliBad ? 'ghcli' : ghAuthBad ? 'ghauth' : amber ? 'setup' : skillsBad ? 'skills' : null
      // #16 v1.6.4 R4：wrapper 加 overflow:hidden 截掉 capsule 溢出 wrapper 部分（dn=0..3 中间状态时 children 居中后左右可能溢出 wrapper）
      // #16 R6b：去掉 alignItems:'stretch'（之前为了拉伸 capsule 撑满 wrapper 高度，反而让父级
//   composerHero 297px 高传给 wrapper 后，capsule 被拉成与 wrapper 同高 ≈9.5px，文字被截掉）
      // #16 R12（本次）：宿主 conversation.input.dock 插槽 = composerStack（column flex），wrapper 是 flex item，
//   默认 flex-shrink:1 → 输入区高度被压缩时 wrapper 被压扁（wrapper 11px → capsule 8px → overflow:hidden 裁文字）。
//   R6b 只防了「被拉高」，没防「被压矮」；故加 flex:'none'（flex:0 0 auto）双保险。
// #22：正常路径由 portal 脱离裁剪；若 ReactDOM 不可用，退化节点必须不再被本 wrapper 立即裁掉。
      if (!firstBlock) return h('div', { style: { display: 'flex', flex: 'none', justifyContent: 'center', width: '100%', boxSizing: 'border-box', padding: '3px 8px 0', overflow: RDOM ? 'hidden' : 'visible' } }, [capsule])
      const bann = function (text, btnLabel, onBtn) {
        return h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, cursor: 'default' } }, [
          Ic({ n: 'alert', size: 13 }),
          h('span', { style: { flex: 1 } }, text),
          h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: onBtn }, btnLabel),
        ])
      }
      return h('div', { style: { display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '3px 8px 0' } }, [
        firstBlock === 'ghcli'
          ? bann(tr('banner.ghcli'), tr('banner.ghcliBtn'), function () { openUrl('https://cli.github.com/') })
          : firstBlock === 'ghauth'
            ? bann(tr('banner.ghauth'), tr('banner.ghauthBtn'), function () { openUrl('https://cli.github.com/manual/gh_auth_login') })
            : firstBlock === 'setup'
              ? bann(tr('banner.setup'), tr('banner.setupBtn'), function () { inject(s, promptText('setupRun')) })
              : bann(tr('banner.skills', { list: (skillsCheck && skillsCheck.detail) || '' }), tr('banner.skillsBtn'), function () { inject(s, promptText('installSkills')) }),
        capsule,
      ])
    }
