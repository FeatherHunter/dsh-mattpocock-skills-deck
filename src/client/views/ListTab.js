/**
 * views/ListTab.js — 主列表（排序/过滤/chips/行动作，5.5）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
export     const MAP_ROW_GUARD_NARROW = 320
export     const MAP_ROW_GUARD_WIDE = 440
export     const authorColor = function(l){let h=0;for(let i=0;i<l.length;i++)h=(h*31+l.charCodeAt(i))%360;h=(h*137.508)%360;let s=0.72,ll=0.5,c=(1-Math.abs(2*ll-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=ll-c/2,r=0,g=0,b=0;if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}r=Math.round((r+m)*255);g=Math.round((g+m)*255);b=Math.round((b+m)*255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
export     const fitMapRows = function () {
      if (typeof document === 'undefined') return
      const rows = document.querySelectorAll('.dsws-aggrow')
      rows.forEach(function (rowEl) {
        const idcol = rowEl.querySelector('.dsws-idcol')
        const title = rowEl.querySelector('.dsws-tt-wrap')
        if (!idcol || !title) return
        const isMap = !!idcol.querySelector('.dsws-chip-m')
        if (!isMap) { idcol.classList.remove('h'); return }
        const avail = rowEl.clientWidth
        if (avail < MAP_ROW_GUARD_NARROW) { idcol.classList.remove('h'); return }
        if (avail >= MAP_ROW_GUARD_WIDE) { idcol.classList.add('h'); return }
        idcol.classList.add('h')
        title.classList.add('dsws-measure')
        const fits = title.scrollWidth <= title.clientWidth + 1
        title.classList.remove('dsws-measure')
        title.classList.remove('measure')
        if (!fits) idcol.classList.remove('h')
      })
    }
export     const ListTab = ({ st, narrow }) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      // v1.3.3 UI：每次渲染后执行贪心折叠（含窗口/列宽变化后的重渲染）
      // v1.5 T10 提速：按内容指纹跳过 —— 仅快照内容/tab/过滤变化才重排（refreshing 态等无关渲染不触发布局测量）
      React.useLayoutEffect(function () {
        const fp = String((st.snapshot && st.snapshot.generatedMs) || '') + '|' + st.tab + '|' + st.stateFilter + '|' + (st.lblFilters || []).join(',')
        if (_tagsFpOf.get(st) === fp) return
        _tagsFpOf.set(st, fp)
        fitAllTags()
        try { fitMapRows() } catch (e) {}
      })
      // Map #120 T1：标题适配 + 宽度护栏 的容器尺寸监听（面板拖拽 / 字体加载 / window resize）
      React.useLayoutEffect(function () {
        const doFit = function () { try { fitMapRows() } catch (e) {} }
        doFit()
        let ro = null
        try {
          if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(function () { doFit() })
            const panel = document.querySelector('.dsws-panel')
            const body = document.querySelector('.dsws-body')
            if (panel) try { ro.observe(panel) } catch (e) {}
            if (body) try { ro.observe(body) } catch (e) {}
            document.querySelectorAll('.dsws-aggrow').forEach(function (el) { try { ro.observe(el) } catch (e) {} })
          }
        } catch (e) {}
        const onWin = function () { doFit() }
        if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
        let fontsDone = false
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () { if (!fontsDone) { fontsDone = true; doFit() } })
        }
        return function () {
          try { if (ro) ro.disconnect() } catch (e) {}
          if (typeof window !== 'undefined') window.removeEventListener('resize', onWin)
        }
      }, [])
      const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
      const openIssues = issues.filter(function (x) { return x.state !== 'CLOSED' })
      const closedIssues = issues.filter(function (x) { return x.state === 'CLOSED' })
      // #374：多维排序 —— map 行恒置顶，map 组与普通组各自按所选维度排序；默认 更新时间↓（与现状一致）
      const sortIssues = function (arr) {
        const dir = st.sortDir === 'asc' ? 1 : -1
        return arr.slice().sort(function (a, b) {
          let c
          if (st.sortKey === 'number') { c = a.number - b.number; if (c !== 0) return dir * c }
          else if (st.sortKey === 'title') {
            c = String(a.title).toLowerCase().localeCompare(String(b.title).toLowerCase())
            if (c !== 0) return dir * c
          } else {
            c = String(a[st.sortKey] || '').localeCompare(String(b[st.sortKey] || ''))
            if (c !== 0) return dir * c
          }
          return a.number - b.number  // 同键兜底：编号升序（稳定）
        })
      }
      const isMapIssue = function (x) { return x.type === 'map' || ((x.labels || []).some(function (l) { return l.name === 'wayfinder:map' })) }
      const sortedMaps = sortIssues(openIssues.filter(isMapIssue))
      const sortedOpen = sortIssues(openIssues.filter(function (x) { return !isMapIssue(x) }))
      const closedSorted = sortIssues(closedIssues)
      const groups = compute(st)
      const occ = groups.reduce(function (n, g) { return n + g.blocked.length + g.claimed.length }, 0)
      // #284：环境坏项计数改从链快照步骤派生（fail/current 均为需处理项）
      const nBad = chainSteps(st).filter(function (s) { return s.status === 'fail' || s.status === 'current' }).length
      // 标签统计（含地图子票）与配色：票面最终色（工作区改色已在票面），不直读 palette
      const stat = {}, colorOf = {}
      const snapLabels = (st.snapshot && Array.isArray(st.snapshot.labels)) ? st.snapshot.labels : null
      if (snapLabels) snapLabels.forEach(function (l) { if (l && l.name && l.color) colorOf[String(l.name).trim()] = String(l.color).trim().replace(/^#/, '') })
      const allForColor = issues.slice()
      ;(st.snapshot && Array.isArray(st.snapshot.maps) ? st.snapshot.maps : []).forEach(function(m){(m.tickets||[]).forEach(function(t){allForColor.push(t)})})
      allForColor.forEach(function (x) {(x.labels||[]).forEach(function(l){const nm=l&&l.name?String(l.name).trim():'';if(!nm)return;stat[nm]=(stat[nm]||0)+1;if(l.color)colorOf[nm]=String(l.color).trim().replace(/^#/, '')})})
      const tagNames = Object.keys(stat).sort(function (a, b) { return stat[b] - stat[a] })
      // #375：全量 label（快照 labels 字段优先；旧快照无该字段降级 issue 统计）；配色按票面最终色已覆盖，缺失才用快照表
      const labelNames = snapLabels ? snapLabels.map(function (l) { return l.name }) : tagNames.slice()
      // 点击记忆双键排序：次数降序 → 最近点击降序 → 出现频次降序 → 名称序
      const sortedLabels = labelNames.slice().sort(function (a, b) {
        const ca = labelClicks[a], cb = labelClicks[b]
        const na = ca ? ca.n : 0, nb = cb ? cb.n : 0
        if (na !== nb) return nb - na
        const ta = ca ? ca.ts : 0, tb = cb ? cb.ts : 0
        if (ta !== tb) return tb - ta
        const fa = stat[a] || 0, fb = stat[b] || 0
        if (fa !== fb) return fb - fa
        return String(a).localeCompare(String(b))
      })
      // v15-26：主列表关联 map 子票阻塞信息（open 阻塞者才算阻塞；数据来自快照 maps.tickets.blockedBy，无需额外请求）
      const blockOf = {}
      ;(st.snapshot && st.snapshot.maps || []).forEach(function (m) {
        const byNum = {}
        m.tickets.forEach(function (t) { byNum[t.number] = t })
        m.tickets.forEach(function (t) {
          if (!t.blockedBy || !t.blockedBy.length) return
          const openBlockers = t.blockedBy.filter(function (b) { const bt = byNum[b]; return bt && bt.state === 'OPEN' })
          if (openBlockers.length) blockOf[t.number] = { map: m.number, mapTitle: m.title, by: openBlockers }
        })
      })
      // #374：状态过滤（全部/Open/阻塞/已关闭）与 label 过滤叠加
      // v1.3.3 T3：blocked 过滤真正实现 —— open 且存在 open 阻塞者（blockOf 命中）
      const showOpen = st.stateFilter !== 'closed'
      const showClosedList = st.stateFilter === 'closed'
      // v1.5：多选标签过滤（OR 语义：命中任一选中标签即显示）
      const byLabel = function (x) {
        const ls = st.lblFilters || []
        if (!ls.length) return true
        const labs = x.labels || []
        if (!labs.length) return ls.indexOf('needs-triage') >= 0
        return labs.some(function (l) { return ls.indexOf(l.name) >= 0 })
      }
      const openRows = sortedMaps.concat(sortedOpen)
      const openFiltered = (st.lblFilters && st.lblFilters.length) ? openRows.filter(byLabel) : openRows
      // v1.3.3 #6：阻塞 = 被占用口径（isOccupied：有 assignee 或存在 open 阻塞者）——与 KPI「占用 N」一致，
      //   用户点「阻塞」应筛出全部被占用项（此前 blockOf 只覆盖 map 子票的 blockedBy，漏掉 assignee 占用的）
      const filteredOpen = showOpen ? (st.stateFilter === 'blocked' ? openFiltered.filter(function (x) { return isOccupied(st, x) })
        : (st.stateFilter === 'frontier' ? openFiltered.filter(function (x) { return !isOccupied(st, x) }) : openFiltered)) : []
      const filteredClosed = showClosedList ? ((st.lblFilters && st.lblFilters.length) ? closedSorted.filter(byLabel) : closedSorted) : []
      // v14-18：chips 常显深一档边框（边框色 = label 色 HSL 亮度 -16%）
      const chip = (nm, withCount, on, isAll) => {
        const c = colorOf[nm]
        const borderColor = isAll ? 'rgba(255,255,255,.35)' : (darken(c, 0.16) || 'rgba(188,140,255,.6)')
        const selColor = isAll ? 'rgba(255,255,255,.65)' : (c ? '#' + c : '#bc8cff')
        return h('span', {
          key: nm,
          className: 'dsws-chip',
          // v14-1：「全部」恒清空过滤并保持选中，与普通标签 toggle 语义分离
          // #375：点选即记点击记忆（次数 + 最近点击时间，双键排序）
          onClick: function (e) {
            e.stopPropagation()
            // v1.5：多选 toggle —— 选中/取消单个标签，互不覆盖
            const cur = st.lblFilters || []
            st.lblFilters = isAll ? [] : (cur.indexOf(nm) >= 0 ? cur.filter(function (x) { return x !== nm }) : cur.concat([nm]))
            if (!isAll) {
              const c = labelClicks[nm] || { n: 0, ts: 0 }
              labelClicks[nm] = { n: c.n + 1, ts: Date.now() }
              saveLabelClicks()
            }
            emit(st)
          },
          style: {
            cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10,
            background: isAll ? 'rgba(255,255,255,.08)' : (hexA(c, 0.18) || 'rgba(188,140,255,.16)'),
            color: isAll ? 'var(--dsw-alias-label-secondary,#a1a1aa)' : (c ? '#' + c : '#bc8cff'),
            border: '1px solid ' + (on ? selColor : borderColor),
          },
        }, nm)
      }
      const kpi = (num, lab, icon, color) => h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, [Ic({ n: icon, size: 11, color: color }), h('span', null, String(num) + ' ' + lab)])
      return h('div', null, [
        // v1.5：已选标签过滤条（仅标签 · 颜色 = 该标签配置色 · 点 ✕ 关闭）
        (st.lblFilters && st.lblFilters.length) ? h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 6 } }, [
          h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none' } }, tr('list.filterActive')),
          (st.lblFilters || []).map(function (nm) {
            const c = colorOf[nm]
            const hex = c ? '#' + c : '#bc8cff'
            return h('span', { key: 'f-label-' + nm, className: 'dsws-chip', style: { fontSize: 10, background: hexA(c, 0.18) || 'rgba(188,140,255,.16)', color: hex, border: '1px solid ' + (darken(c, 0.16) || 'rgba(188,140,255,.6)') } }, [
              nm,
              h('span', { onClick: function (e) { e.stopPropagation(); st.lblFilters = (st.lblFilters || []).filter(function (x) { return x !== nm }); emit(st) }, style: { cursor: 'pointer', marginLeft: 4, fontWeight: 700 } }, '✕'),
            ])
          }),
          h('span', { key: 'f-label-clear', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.lblFilters = []; emit(st) }, style: { fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid rgba(255,255,255,.15)' } }, tr('list.filterClear')),
        ]) : null,
        // B Timeline 定版（2026-08-28）：全屏红卡（NoRepoCard）不再挂载于列表页顶部——
        //   远端未关联/环境未就绪由检查页行内红卡表达，列表页保持 KPI + 列表（无顶部错误信息）
        // KPI 行 + 环境提示（v18-30：可接/占用 = 列表 open issue 口径）
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap', position: 'relative' } }, [
          kpi(frontierCount(st), tr('list.kpi.takeable'), 'target', '#4ade80'),
          kpi(occCount(st), tr('list.kpi.occupied'), 'lock', '#f0883e'),
          kpi(closedIssues.length, tr('list.kpi.closed'), 'check', '#52525b'),
          h('span', { style: { flex: 1 } }),
          // T2 #2：刷新按钮已上移至 OverlayPanel tabs 行（L1932）
        ]),
        // B Timeline 定版（2026-08-28）：「N 项环境未就绪」红条已移除（顶部无错误信息；状态由检查页行级表达）
        // #374/#375：状态过滤 + 排序 + label 过滤 chips（全部小号紧凑同排，窄屏换行不增高；展开态点选 label 不收起）
        h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0, marginBottom: 6 } }, [
          ['all', 'open', 'closed', 'blocked', 'frontier'].map(function (k) {
            const on = st.stateFilter === k
            return h('span', { key: 'stf-' + k, className: 'dsws-chip', onClick: function (e) {
              e.stopPropagation(); st.stateFilter = k; listPrefs.stateFilter = k; saveListPrefs(); emit(st)
            }, style: { cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10, background: on ? 'rgba(188,140,255,.18)' : 'rgba(255,255,255,.06)', color: on ? '#c084fc' : 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid ' + (on ? 'rgba(188,140,255,.6)' : 'rgba(255,255,255,.15)') } }, tr('list.state.' + k))
          }),
          h('span', { style: { width: 1, height: 12, background: 'var(--dsw-alias-border-l1,#2a2d35)', margin: '0 4px 3px', flex: 'none' } }),
          ['updatedAt', 'createdAt', 'number', 'title'].map(function (k) {
            const on = st.sortKey === k
            const arrow = on ? (st.sortDir === 'asc' ? '↑' : '↓') : ''
            return h('span', { key: 'srt-' + k, className: 'dsws-chip', onClick: function (e) {
              e.stopPropagation()
              if (st.sortKey === k) { st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc' }
              else { st.sortKey = k; st.sortDir = (k === 'title') ? 'asc' : 'desc' }
              listPrefs.sortKey = st.sortKey; listPrefs.sortDir = st.sortDir; saveListPrefs(); emit(st)
            }, style: { cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10, background: on ? 'rgba(88,166,255,.16)' : 'rgba(255,255,255,.06)', color: on ? '#58a6ff' : 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid ' + (on ? 'rgba(88,166,255,.55)' : 'rgba(255,255,255,.15)') } }, tr('list.sort.' + k) + arrow)
          }),
          h('span', { style: { width: 1, height: 12, background: 'var(--dsw-alias-border-l1,#2a2d35)', margin: '0 4px 3px', flex: 'none' } }),
          chip(tr('list.all'), false, !st.lblFilters || !st.lblFilters.length, true),
          // #405：filter row 默认可见数 9 → 4（与 per-row 一致）；+N 触发条件 + 数字同步
          (st.expLabels ? sortedLabels : sortedLabels.slice(0, 4)).map(function (nm) { return chip(nm, true, (st.lblFilters || []).indexOf(nm) >= 0, false) }),
          (!st.expLabels && sortedLabels.length > 4) ? h(Tip, { content: tr('list.tagsTitle', { names: sortedLabels.join('、') }) }, h('span', { key: 'lbl-more', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.expLabels = true; emit(st) }, style: { fontSize: 10, marginRight: 4, marginBottom: 3, background: 'rgba(188,140,255,.1)', color: '#bc8cff', border: '1px dashed rgba(188,140,255,.55)', cursor: 'pointer' } }, '+' + (sortedLabels.length - 4))) : null,
          st.expLabels ? h(Tip, { content: tr('list.tagsCollapseTitle') }, h('span', { key: 'lbl-less', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.expLabels = false; emit(st) }, style: { fontSize: 10, marginRight: 4, marginBottom: 3, background: 'rgba(255,255,255,.06)', color: 'var(--dsw-alias-label-caption,#8b8b95)', border: '1px dashed rgba(255,255,255,.3)', cursor: 'pointer' } }, tr('list.collapse'))) : null,
        ]),
        // T3 #5：加载遮罩（替代单行文本，全屏遮罩 + 转圈 + 禁点）
        // v1.3.3 修复：加载遮罩仅首开无数据时显示（手动刷新已走静默路径，不再叠加）
        // #58 缓存优先：已有快照（本 store 或 per-cwd 缓存）时不显示全屏 loading，秒开旧列表 + 后台静默刷新
        (st.snapMode === 'loading' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { className: 'dsws-loading-shade', style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 5, pointerEvents: 'auto' } }, [
          h('div', { className: 'dsws-spinner' }),
          h('span', { style: { fontSize: 12, color: '#e6edf3' } }, tr('list.loading')),
        ]) : null,
        (st.snapMode === 'err' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { style: { color: '#f87171', fontSize: 12, padding: '14px 0', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 12 }), h('span', null, tr('list.errFull', { err: st.snapError }))]) : null,
        st.snapMode === 'real' && st.snapshot && st.snapshot.fallback === 'rest' ? h('div', { style: { color: '#f59e0b', fontSize: 11, padding: '6px 12px', border: '1px solid rgba(245,158,11,.4)', borderRadius: 6, background: 'rgba(245,158,11,.08)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 11 }), h('span', null, tr('list.restFallback'))]) : null,
        // #374：状态过滤渲染 —— open 主体 / closed 列表 / 「全部」态保留已关闭折叠行
        showOpen ? (filteredOpen.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredOpen.map(function (x) { return listIssueRow(h, st, x, true, narrow, blockOf, colorOf) })) : null,
        showClosedList ? (filteredClosed.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredClosed.map(function (x) { return listIssueRow(h, st, x, false, narrow, blockOf, colorOf) })) : null,
        // v14-4⑤：列表底部「已关闭 (N)」折叠行（仅「全部」状态显示；默认收起，只占一行，展开可见）
        (st.stateFilter === 'all' && closedIssues.length) ? h('details', { style: { marginTop: 8 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 2px', userSelect: 'none' } }, [
            Ic({ n: 'check', size: 11 }),
            h('span', null, tr('list.closedN', { n: closedIssues.length })),
          ]),
          h('div', null, closedSorted.map(function (x) { return listIssueRow(h, st, x, false, narrow, blockOf, colorOf) })),
        ]) : null,
      ])
    }
