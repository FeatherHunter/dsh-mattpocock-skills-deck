/**
 * views/TicketRow.js — 票务行（地图详情内，5.3）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ---- 5.3 票务行（地图详情内：标题/阻塞来源 ellipsis；v19：按标签给 诊断/修复/讨论/执行 动作，预填输入框）----
export     const ticketAuthorColor = function(l){let h=0;for(let i=0;i<l.length;i++)h=(h*31+l.charCodeAt(i))%360;h=(h*137.508)%360;let s=0.72,ll=0.5,c=(1-Math.abs(2*ll-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=ll-c/2,r=0,g=0,b=0;if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}r=Math.round((r+m)*255);g=Math.round((g+m)*255);b=Math.round((b+m)*255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
export     const TicketRow = React.memo(({ st, g, t, indent, colorOf }) => {
      const wayfinderTypeOf = function(x){ const ls=(x.labels||[]); for(let i=0;i<ls.length;i++){ const n=typeof ls[i]==='string'?ls[i]:ls[i].name; if(n==='wayfinder:map') return 'map'; if(n==='wayfinder:research') return 'research'; if(n==='wayfinder:prototype') return 'prototype'; if(n==='wayfinder:grilling') return 'grilling'; if(n==='wayfinder:task') return 'task'; } const tt=x.type||''; if(['research','prototype','grilling','task','map'].indexOf(tt)>=0) return tt; return 'issue'; };
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const openBlocker = function (b) { const bt = g.m.tickets.find(function (x) { return x.number === b }); return bt && bt.state === 'OPEN' }
      const blocked = t.state === 'OPEN' && t.blockedBy.some(openBlocker)
      const subItem = (icon, color, text) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, color: color, minWidth: 0 } }, [
        Ic({ n: icon, size: 11 }),
        h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.text')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, text)]) }, h('span', { className: 'dsws-ellip', style: { maxWidth: 200 } }, text)),
      ])
      return h('div', { className: 'dsws-trow', style: indent ? { paddingLeft: 18 } : null }, [
        h('div', { className: 'dsws-tt' }, [
          h('div', { className: 'dsws-tt-name' }, [
            // T2 #3：编号前置
            h('span', { style: { color: 'var(--dsw-alias-label-caption,#8b8b95)', fontSize: 11, flex: 'none' } }, '#' + (t.key != null ? t.key : t.number)),
            TypeChip({ type: wayfinderTypeOf(t) }),
            h('span', { className: 'dsws-tt-wrap', style: { flex: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
              h('span', { style: { flex: 1, minWidth: 0 } }, t.title),
              (t.author && t.author.login && t.author.login !== ((st.snapshot && (st.snapshot.viewer && st.snapshot.viewer.login || st.snapshot.viewerLogin)) || '')) ? (t.author.avatarUrl ? h(Tip, { content: (t.author.name ? t.author.name + ' (@' + t.author.login + ')' : '@' + t.author.login) }, h('img', { src: t.author.avatarUrl, style: { width: 16, height: 16, borderRadius: '50%', border: '2px solid ' + ticketAuthorColor(t.author.login), flex: 'none' }, alt: t.author.login })) : h(Tip, { content: (t.author.name ? t.author.name + ' (@' + t.author.login + ')' : '@' + t.author.login) }, h('span', { style: { width: 16, height: 16, borderRadius: '50%', background: hexA(ticketAuthorColor(t.author.login), 0.18), border: '2px solid ' + ticketAuthorColor(t.author.login), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' } }, [Ic({ n: 'person', size: 10 })]))) : null
            ]),
          ]),
          h('div', { className: 'dsws-tt-sub', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
            t.claimedBy ? subItem('person', '#58a6ff', tr('map.subClaimed', { who: t.claimedBy })) : null,
            // #370：被阻塞 chip 只显示仍 OPEN 的阻塞者（与 compute/主列表/按钮抑制口径一致）
            blocked ? subItem('lock', '#f0883e', tr('map.subBlocked', { who: blockerNames(t, g.m) })) : null,
            t.state === 'CLOSED' ? subItem('check', '#3fb950', tr('map.subClosed')) : null,
            tStatusBadge(t),
          ]),
          (t.state === 'OPEN') ? tProgressBar(t) : null,
        ]),
        t.state === 'OPEN' ? h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', flex: 'none' } }, [
          blocked ? null : mkRowAction(st, t, false, colorOf),
          // #361 能力保留（同 cwd + 自动命名 + 预填指令）；#394：去 ghost/icon-only，与 nav.handoff 解耦
          //   marginLeft:4 与左侧 mkRowAction 形成隐式分组（动作组 vs 辅助组）
          h(Tip, { content: tr('tip.newSession', { n: t.number }) }, h('button', { className: 'dsws-btn primary', onClick: function (e) { e.stopPropagation(); openInNewSession(st, t) }, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', marginLeft: 4, background: actionColorOf(t, colorOf), borderColor: 'transparent', color: isLightHex(actionColorOf(t, colorOf)) ? '#140a1e' : '#ffffff' } }, [Ic({ n: 'external-link', size: 10 }), h('span', null, tr('list.newSessionLabel'))])),
          (function(){ const _u=issueUrlFor(st, t.number); const _isHttp=/^https?:\/\//i.test(String(_u||'')); const _openLocal=function(e){ e.stopPropagation(); const u=issueUrlFor(st, t.number); if(!u) return; if(/^https?:\/\//i.test(String(u))) { try{ window.open(u,'_blank','noreferrer') }catch{} } else { try{ if(typeof host!=='undefined'&&host.call) host.call('wf.openPath',{path:u}) }catch{} } }; return _isHttp ? h(Tip, { content: tr('tip.openInTracker', { n: t.number }) }, h('a', { className: 'dsws-btn ghost', href: _u, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '3px 6px' } }, Ic({ n: 'link', size: 12 }))) : h(Tip, { content: tr('tip.openInTracker', { n: t.number }) }, h('button', { className: 'dsws-btn ghost', onClick: _openLocal, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '3px 6px' } }, Ic({ n: 'link', size: 12 }))); })(),
        ]) : h('a', { className: 'dsws-btn ghost', href: issueUrlFor(st, t.number), target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none' } }, tr('act.view')),
      ])
      })
