/**
 * views/MapDetail.js — 地图详情（漏斗分层/迷雾/仪式环，5.4）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ---- 5.4 地图详情（v1.4 · T2 #443：漏斗分层 + 战争迷雾 + 72px 仪式环 + 四态动作，D1-D8 规格）----
    //   层 = blockedBy DAG 最长路径深度（T1 #442 已算 stats.levels + 每票 t.level）
export     const MapDetail = ({ st, g }) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const m = g.m
      const colorOf = buildColorOf(st)
      const wayfinderTypeOf = function(t){ const ls=(t.labels||[]); for(let i=0;i<ls.length;i++){ const n=typeof ls[i]==='string'?ls[i]:ls[i].name; if(n==='wayfinder:map') return 'map'; if(n==='wayfinder:research') return 'research'; if(n==='wayfinder:prototype') return 'prototype'; if(n==='wayfinder:grilling') return 'grilling'; if(n==='wayfinder:task') return 'task'; } const tt=t.type||''; if(['research','prototype','grilling','task','map'].indexOf(tt)>=0) return tt; return 'issue'; };
      const tickets = m.tickets || []
      // 区块字段防御性兜底：快照组装层已恒填 EMPTY（[] / ''），旧磁盘缓存/异常数据仍可能缺失，
      // 缺失时按空区块渲染（曾因 m.decisions 等 undefined 直接读 .length 抛 Cannot read properties of undefined）
      const decisions = Array.isArray(m.decisions) ? m.decisions : []
      const fogList = Array.isArray(m.fog) ? m.fog : []
      const outOfScope = Array.isArray(m.outOfScope) ? m.outOfScope : []
      const levels = (m.stats && m.stats.levels) || []
      const totalLayers = levels.length
      // 当前层 = 第一个含 open 票的层（无 open 全 done → 最后一层）
      const curLevel = (function () {
        for (let i = 0; i < levels.length; i++) { if (levels[i].open > 0) return i }
        return Math.max(0, levels.length - 1)
      })()
      const passedLayers = levels.filter(function (l, i) { return i < curLevel }).length
      const byLevel = {}
      tickets.forEach(function (t) { const lv = (typeof t.level === 'number') ? t.level : 0; (byLevel[lv] = byLevel[lv] || []).push(t) })
      // 迷雾：fog 票（Not yet specified）+ 被阻塞且其阻塞者 open 的票（半雾）；D7 视觉遮蔽
      const isFog = function (t) {
        if (t.state !== 'OPEN') return false
        const blk = (t.blockedBy || []).map(function (b) { return tickets.find(function (x) { return x.number === b }) }).filter(Boolean)
        return blk.some(function (b) { return b.state === 'OPEN' })
      }
      const fogTitles = fogList.map(function (f) { return String(f).trim() })
      const isFogTitle = function (t) { return fogTitles.some(function (f) { return f && t.title && t.title.indexOf(f) >= 0 }) }
      // v1.4：同层内排序 —— 可执行（open 且非迷雾）最左 → open 被阻塞 → 已关闭靠右（一眼看到当前能做什么）
      Object.keys(byLevel).forEach(function (lv) {
        byLevel[lv].sort(function (a, b) {
          const rank = function (t) {
            if (t.state === 'OPEN') return isFog(t) || isFogTitle(t) ? 1 : 0
            return 2
          }
          return rank(a) - rank(b) || a.number - b.number
        })
      })
      // 迷雾点击去雾状态（st 上按 map 存）
      st.reveal = st.reveal || {}
      const nodeCls = function (t) {
        let cls = 'dsws-node'
        if (t.state === 'CLOSED') cls += ' done'
        else if (t.level === curLevel) cls += ' now'
        const fog = isFog(t) || isFogTitle(t)
        if (fog) { cls += ' fog'; if (st.reveal[m.number] && st.reveal[m.number][t.number]) cls += ' revealed' }
        // R5：子票级变化高亮（issueFlash）
        if (st.issueFlash && st.issueFlash[t.number]) cls += st.issueFlash[t.number] === 'added' ? ' dsws-row-added' : ' dsws-row-changed'
        return cls
      }
      const toggleReveal = function (t) {
        st.reveal[m.number] = st.reveal[m.number] || {}
        st.reveal[m.number][t.number] = !(st.reveal[m.number][t.number])
        emit(st)
      }
      const gateState = function (layerIndex) {
        // 闸门：该层全 closed → open(绿✓)；层含 open 且在其之前层全 closed → open；否则 lock
        const lv = levels[layerIndex]
        if (!lv) return 'open'
        if (lv.closed === lv.total && lv.total > 0) return 'open'
        const prevAllClosed = levels.slice(0, layerIndex).every(function (p) { return p.closed === p.total })
        return prevAllClosed ? 'open' : 'lock'
      }
      const node = function (t) {
        const blocked = isFog(t)
        // T15：acts 恒渲染容器（CLOSED/fog 空占位）→ 卡片高度恒定
        // 补齐「新会话」按钮（与列表页 issueRow 一致）：primary 色随 actionColorOf，浅色自动深字，marginLeft 4 与 mkRowAction 成组
        const acts = h('div', { className: 'acts' }, (t.state === 'OPEN' && !blocked) ? [
          mkRowAction(st, t, false, colorOf),
          h(Tip, { content: tr('tip.newSession', { n: t.number }) }, h('button', { className: 'dsws-btn primary', onClick: function (e) { e.stopPropagation(); openInNewSession(st, t) }, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', marginLeft: 4, background: actionColorOf(t, colorOf), borderColor: 'transparent', color: isLightHex(actionColorOf(t, colorOf)) ? '#140a1e' : '#ffffff' } }, [Ic({ n: 'external-link', size: 10 }), h('span', null, tr('list.newSessionLabel'))])),
          (function(){ const _u=issueUrlFor(st, t.number); const _isHttp=/^https?:\/\//i.test(String(_u||'')); const _open=function(e){ e.stopPropagation(); const u=issueUrlFor(st, t.number); if(!u) return; if(/^https?:\/\//i.test(String(u))) { try{ window.open(u,'_blank','noreferrer') }catch{} } else { try{ if(typeof host!=='undefined'&&host.call) host.call('wf.openPath',{path:u}) }catch{} } }; return _isHttp ? h(Tip, {content: tr('list.openInTrackerTitle', { n: t.number })}, h('a', { className: 'dsws-btn ghost', href: _u, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px' }, 'aria-label': tr('list.openInTrackerTitle', { n: t.number }) }, Ic({ n: 'link', size: 11 }))) : h(Tip, {content: tr('list.openInTrackerTitle', { n: t.number })}, h('button', { className: 'dsws-btn ghost', onClick: _open, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px' }, 'aria-label': tr('list.openInTrackerTitle', { n: t.number }) }, Ic({ n: 'link', size: 11 }))); })(),
        ] : [])
        // v1.4 修复：图标名必须用 Ic 支持的（search/hammer/chat/gear），原 mag/bolt/wrench 不存在 → 节点图标空白
        const _wt = wayfinderTypeOf(t); const ic = _wt === 'research' ? 'search' : _wt === 'prototype' ? 'hammer' : _wt === 'grilling' ? 'chat' : _wt === 'map' ? 'map' : _wt === 'task' ? 'gear' : 'gear'
        return h('div', {
          key: t.number,
          className: nodeCls(t),
          onClick: (isFog(t) || isFogTitle(t)) ? function (e) { e.stopPropagation(); toggleReveal(t) } : undefined,
        }, [
          h('div', { className: 'row1' }, [
            h('span', { className: 'icbox' }, Ic({ n: ic, size: 12 })),
            h('div', { style: { flex: 1, minWidth: 0 } }, [
              h('div', { className: 'meta' }, [
                h('span', { className: 'no' }, '#' + (t.key != null ? t.key : t.number)),
                TypeChip({ type: wayfinderTypeOf(t) }),
              ]),
              h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, t.title)]) }, h('div', { className: 'tt' }, t.title)),
              h('div', { className: 'sub', style: { fontSize: 8, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 1, minHeight: 12, display: 'flex', gap: 5, flexWrap: 'wrap' } }, [
                t.state === 'CLOSED' ? h('span', { style: { color: '#3fb950', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'check', size: 8 }), h('span', null, tr('map.subClosed'))]) : null,
                t.claimedBy ? h('span', { style: { color: '#58a6ff', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'person', size: 8 }), h('span', null, t.claimedBy)]) : null,
                blocked ? h('span', { style: { color: '#f0883e', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'lock', size: 8 }), h('span', null, tr('map.subBlocked', { who: blockerNames(t, m) }))]) : null,
              ]),
              // v1.5 T12：进度条 + 状态徽章（open 票显示真实进度 · 修 0/13）
              tProgressBar(t),
              h('div', { style: { marginTop: 2, minHeight: 14, display: 'flex', alignItems: 'center', gap: 2 } }, [tStatusBadge(t)]),
            ]),
          ]),
          acts,
          (isFog(t) || isFogTitle(t)) ? h('svg', { className: 'qmark', viewBox: '0 0 24 24' }, [h('path', { d: 'M9.5 9a2.5 2.5 0 1 1 3.7 2.2c-.9.4-1.2 1-1.2 1.8' }), h('circle', { cx: '12', cy: '18', r: '.6' })]) : null,
        ])
      }
      const layerBlock = function (layerIndex) {
        const lv = levels[layerIndex]
        if (!lv) return null
        const layerTickets = byLevel[layerIndex] || []
        const gate = gateState(layerIndex)
        const isCur = layerIndex === curLevel
        // T15：层容器 + 明显层号（当前层高亮）；层内网格自适应
        return [
          h('div', { className: 'dsws-layerbox' + (isCur ? ' cur' : '') }, [
            h('div', { className: 'dsws-layerTag' }, [
              h('span', { className: 'dsws-layerNo' }, String(layerIndex + 1)),
              h('span', { className: 'dsws-layerTitle' }, tr('map.layer', { n: layerIndex + 1 }) + ' · ' + lv.open + ' open'),
              h('span', { className: 'sp' }),
            ]),
            h('div', { className: 'dsws-layer' }, layerTickets.map(function (t) { return node(t) })),
          ]),
          h('div', { className: 'dsws-gate' }, [
            h('span', { className: 'g ' + gate }, Ic({ n: gate === 'open' ? 'check' : 'lock', size: 12 })),
          ]),
        ]
      }
      // 完成态：全 closed → 进度条全绿 + 环满圈
      const allClosed = m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total
      const ringPct = allClosed ? 1 : (totalLayers ? Math.min(1, (passedLayers + 1) / totalLayers) : 0)
      const C = 2 * Math.PI * 31
      const ringOff = C * (1 - ringPct)
      return h('div', null, [
        // 顶部操作行：返回 + map chip + 执行/完成
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } }, [
          h('button', { className: 'dsws-btn', onClick: function () { clearActiveMap(st) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
            Ic({ n: 'back', size: 12 }),
            h('span', null, tr('list.back')),
          ]),
          h('span', { className: 'dsws-chip dsws-chip-m' }, [Ic({ n: 'map', size: 11 }), h('span', null, 'wayfinder:map')]),
          h('span', { style: { flex: 1 } }),
          (m.stats && m.stats.total === 0)
            ? h(Tip, { content: tr('map.inspectTitle') }, h('button', { className: 'dsws-btn primary', onClick: function () {
                let t2 = ''
                try { t2 = inspectPrompt(st, m.number, m.title) } catch(e) { try { t2 = promptText('mapInspect', { n: String(m.number||''), ['title']: String(m.title||''), url: issueUrlFor(st, m.number) }); if (t2) t2 = '/wayfinder ' + issueUrlFor(st, m.number) + '\n\n' + t2 } catch(_){ t2 = startText(st, m) } }
                inject(st, t2)
              }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, background: '#f59e0b', borderColor: 'transparent', color: '#140a1e', fontWeight: 600 } }, [
                Ic({ n: 'search', size: 10 }),
                h('span', null, tr('act.inspect')),
              ]))
            : (m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total)
            ? h(Tip, { content: tr('map.doneTitle') }, h('button', { className: 'dsws-btn primary', onClick: function () {
                const text = completePrompt(st, m.number, m.stats.total, m.stats.closed)
                inject(st, text)
              }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 600 } }, [
                Ic({ n: 'check', size: 10 }),
                h('span', null, tr('act.done')),
              ]))
            : h(Tip, { content: tr('map.executeTitle') }, h('button', { className: 'dsws-btn primary', onClick: function () {
                // v1.4：map 推进式执行（startText 检测 wayfinder:map → MAP_EXECUTE_PROMPT）
                inject(st, startText(st, m))
              }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11 } }, [
                Ic({ n: 'play', size: 10 }),
                h('span', null, tr('act.execute')),
              ])),
          // v1.5 B2（O5）：详情页「在新会话打开」—— 与 执行/完成 同语义，开新会话推进该 map
          h(Tip, { content: tr('map.newSessionTitle') }, h('button', { className: 'dsws-btn ghost', onClick: function () { openInNewSession(st, m) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, flex: 'none' } }, [
            Ic({ n: 'external-link', size: 10 }),
            h('span', null, tr('list.newSessionLabel')),
          ])),
        ]),
        // T14：map 编号徽章 —— 标题前方、紫色、与列表 map 行同款（dsws-idnum）
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: 2 } }, [
          h('span', { className: 'dsws-idnum', style: { color: '#c084fc', borderColor: '#c084fc', flex: 'none' } }, '#' + m.number),
          h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, m.title)]) }, h('div', { className: 'dsws-mtitle dsws-tt-wrap', style: { flex: 1, minWidth: 0 } }, m.title)),
        ]),
        m.error ? h('div', { style: { color: '#f87171', fontSize: 11, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 11 }), h('span', null, String((m.error && m.error.error) || tr('list.loadFail')).slice(0, 160))]) : null,
        // D2：分段静态进度条 = 地图层缩略图（无动画，唯一真相源）
        (levels.length > 0) ? h('div', { className: 'dsws-layers' }, [
          h('div', { className: 'row1' }, [
            h('span', { className: 'cap' }, tr('map.progressCap')),
            h('div', { className: 'segs' }, levels.map(function (l, i) {
              const segCls = i < curLevel ? 'seg past' : (i === curLevel ? 'seg curr' : 'seg future')
              return h(Tip, { content: tr('map.layer', { n: i + 1 }) }, h('div', { key: i, className: segCls }))
            })),
          ]),
          h('div', { className: 'row2' }, [
            h('span', { className: 'cur' }, [Ic({ n: 'play', size: 9 }), h('span', null, tr('map.curLayer', { n: curLevel + 1 }))]),
            h('span', { className: 'pos' }, tr('map.layersPassed', { n: passedLayers, t: totalLayers })),
          ]),
        ]) : null,
        // T17 修订：Destination 走 markdown 渲染（**加粗** 等不再裸露；去 ellip 允许换行）
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 12, color: '#4ade80', margin: '4px 0 2px' } }, [Ic({ n: 'target', size: 12, style: { marginTop: 2, flex: 'none' } }), h('div', { style: { flex: 1, minWidth: 0 } }, m.destination ? mdToHtml(m.destination) : tr('list.noDest'))]),
        // T17 修订：正文详情（Notes）默认折叠 —— <details> 收起，点击展开
        h('details', { style: { margin: '2px 0 4px' } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 } }, [
            Ic({ n: 'note', size: 11 }),
            h('span', null, tr('map.notesCap')),
          ]),
          m.notes ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--dsw-alias-border-l1,#2a2d35)' } }, mdToHtml(m.notes)) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 4, paddingLeft: 8 } }, tr('list.noNotes')),
        ]),
        // 漏斗分层主体
        h('div', { style: { marginTop: 2 } }, [
          h('div', { className: 'dsws-start' }, [
            h('span', { className: 'cap' }, tr('map.startCap')),
          ]),
          levels.map(function (l, i) { return layerBlock(i) }),
          // D3：Destination 72px 仪式环（环心旗帜，无数字）
          h('div', { className: 'dsws-dest' }, [
            h('div', { className: 'ring' }, [
              h('svg', { width: 72, height: 72, viewBox: '0 0 72 72' }, [
                h('circle', { className: 'track', cx: 36, cy: 36, r: 31 }),
                h('circle', { className: 'prog', cx: 36, cy: 36, r: 31, strokeDasharray: String(C), strokeDashoffset: String(ringOff) }),
              ]),
              h('div', { className: 'core' }, h('svg', { viewBox: '0 0 24 24' }, [h('path', { d: 'M5 3v18' }), h('path', { d: 'M5 4c4-2 6 2 12 0v9c-6 2-8-2-12 0' })])),
            ]),
            h('div', { className: 'title' }, tr('map.destCap')),
            h('div', { className: 'acts' }, [
              // v1.4：底部按钮与顶部同语义 —— 完成态「完成」（COMPLETE_PROMPT 同列表）/ 未完成「执行」（execute 模板）
              (m.stats && m.stats.total === 0)
                ? h(Tip, { content: tr('map.inspectTitle') }, h('button', { className: 'dsws-btn primary', onClick: function () {
                    let t2b = ''
                    try { t2b = inspectPrompt(st, m.number, m.title) } catch(e) { try { t2b = promptText('mapInspect', { n: String(m.number||''), ['title']: String(m.title||''), url: issueUrlFor(st, m.number) }); if (t2b) t2b = '/wayfinder ' + issueUrlFor(st, m.number) + '\n\n' + t2b } catch(_){ t2b = startText(st, m)} }
                    inject(st, t2b)
                  }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: '#f59e0b', borderColor: 'transparent', color: '#140a1e', fontWeight: 700 } }, [
                    Ic({ n: 'search', size: 11 }),
                    h('span', null, tr('act.inspect')),
                  ]))
                : (m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total)
                ? h(Tip, { content: tr('map.doneTitle') }, h('button', { className: 'dsws-btn primary', onClick: function () {
                    const text = completePrompt(st, m.number, m.stats.total, m.stats.closed)
                    inject(st, text)
                  }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 700 } }, [
                    Ic({ n: 'check', size: 11 }),
                    h('span', null, tr('act.done')),
                  ]))
                : h(Tip, { content: tr('map.executeTitle') }, h('button', { className: 'dsws-btn primary', onClick: function () {
                    // v1.4：map 推进式执行（startText 检测 wayfinder:map → MAP_EXECUTE_PROMPT）
                    inject(st, startText(st, m))
                  }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: '#4ade80', borderColor: 'transparent', color: '#04120a', fontWeight: 700 } }, [
                    Ic({ n: 'play', size: 11 }),
                    h('span', null, tr('act.execute')),
                  ])),
              (function(){ const _u=issueUrlFor(st, m.number); const _isHttp=/^https?:\/\//i.test(String(_u||'')); const _open=function(e){ e.stopPropagation(); const u=issueUrlFor(st, m.number); if(!u) return; if(/^https?:\/\//i.test(String(u))) { try{ window.open(u,'_blank','noreferrer') }catch{} } else { try{ if(typeof host!=='undefined'&&host.call) host.call('wf.openPath',{path:u}) }catch{} } }; return _isHttp ? h('a', { className: 'dsws-btn ghost', href: _u, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('map.archive'))]) : h('button', { className: 'dsws-btn ghost', onClick: _open, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('map.archive'))]); })(),
            ]),
          ]),
        ]),
        // 折叠块：Decisions / Fog / Out of scope（保留信息展示）
        h('details', { style: { marginTop: 10, marginBottom: 4 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.decisions', { n: decisions.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, decisions.map(function (d, i) {
            return h('div', { key: i, style: { margin: '2px 0' } }, [
              h('span', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, '· '),
              (d.url ? h('a', { href: d.url, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'underline' } }, d.title) : h('span', null, d.title)),
              d.gist ? h('span', { style: { color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, ' — ' + d.gist) : null,
            ])
          })),
        ]),
        h('details', { style: { marginBottom: 4 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.fog', { n: fogList.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, fogList.map(function (f, i) {
            return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('· ' + f))
          })),
        ]),
        h('details', { style: { marginBottom: 4 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.outOfScope', { n: outOfScope.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, outOfScope.map(function (o, i) {
            return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('· ' + o))
          })),
        ]),
      ])
    }
