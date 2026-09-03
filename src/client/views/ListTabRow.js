// views/ListTabRow.js — 主列表单行渲染（从 ListTab.js 拆出，V3 #463，纯结构、行为零变化）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
// src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
// 以后谁改它：改行两行结构、行动作按钮组、迷你圆环进度、阻塞徽标的人改它。
// 接线：行组装三处（open/closed/折叠）调 listIssueRow；表级派生（blockOf/colorOf）由调用方当参数传，
//   本文件不引用 ListTab.js（同闭包拼回，调用方向见 ListTab.js 行组装三处）。
// 参数：h = 行内创建函数；st = 列表 store；x = 本行票据；blockOf/colorOf = 表级派生。
export const listIssueRow = function (h, st, x, isOpen, narrow, blockOf, colorOf) {
      const has = function (x, nm) { return (x.labels || []).some(function (l) { return l.name === nm }) }
      const findMap = function (num) { const maps=st.snapshot&&st.snapshot.maps||[];const k=num!=null?String(num).padStart(2,'0'):'';return maps.find(function(m){return m.number===num||String(m.number)===String(num)||(m.key!=null&&String(m.key).padStart(2,'0')===k)}) }
      const openBlocked = function (blk) { setActiveMap(st, blk.map) }
      const copyUrl = function (x) { copyText(st, issueUrlFor(st, x.number), tr('toast.copiedLink', { n: x.number })) }
      // v14-4：行级动作按 label 四选一（诊断/修复/讨论/执行），全部预填输入框；
      // v19：共享 mkRowAction（列表与 map 详情同逻辑，按钮色动态取 label 配置色）；v14-3 按钮 80%；v14-19 窄屏折叠为纯图标
      // v1.3.3 UI 定稿（用户逐版确认）：两行结构 · 卡片风（C）· 编号/map 竖排（idcol）·
      //   行1 = 编号(上)+map徽章(下) 竖排 + 标题(占满,限2行) + 迷你圆环进度(右上)；
      //   行2 = 标签单行贪心折叠（宽多窄少,最少1个,放不下进 +N 弹窗）+ 按钮组（执行/完成/新会话常显,复制/外链 hover）
      //   +N 弹窗：fixed 定位,基准=面板容器,clamp 左右不越界,内容完整可见（用户验收 A 方案）
      const ringOf = function (stats) {
        const total = stats.total || 0, closed = stats.closed || 0
        const pct = total ? Math.round(closed / total * 100) : 0
        const C = 2 * Math.PI * 7
        const off = C * (1 - pct / 100)
        const color = pct >= 100 ? '#4ade80' : '#bc8cff'
        return h('span', { className: 'dsws-ring' }, [
          h('svg', { width: 18, height: 18, viewBox: '0 0 18 18' }, [
            h('circle', { cx: 9, cy: 9, r: 7, fill: 'none', stroke: 'rgba(255,255,255,.12)', strokeWidth: 2.4 }),
            h('circle', { cx: 9, cy: 9, r: 7, fill: 'none', stroke: color, strokeWidth: 2.4, strokeLinecap: 'round', strokeDasharray: String(C), strokeDashoffset: String(off) }),
          ]),
          h('span', { className: 'dsws-ring-txt', style: { color: color } }, closed + '/' + total),
        ])
      }
      const isMap = (x.type === 'map') || has(x, 'wayfinder:map')
      const mapObj = isMap ? findMap(x.number) : null
      // v15-26：被阻塞判定（open 阻塞者）→ 隐藏动作按钮 + 红色「被阻塞」标签（点击跳所属 map 详情）
      const blk = blockOf[x.number]
      const blocked = !!(blk && blk.by && blk.by.length)
      const mapDone=!!(isMap&&mapObj&&mapObj.stats&&mapObj.stats.total>0&&mapObj.stats.closed===mapObj.stats.total);const mapEmpty=!!(isMap&&mapObj&&mapObj.stats&&mapObj.stats.total===0)
      const numColor=mapDone?'#3fb950':mapEmpty?'#f59e0b':actionColorOf(x,colorOf)
      // v1.3.3 UI：全部标签渲染（渲染后贪心折叠，放不下的隐藏进 +N；+N 弹窗显示全部）
      const labels = x.labels || []
      const allNames = labels.map(function (l) { return l.name }).join('、')
      const openPop = function (e) {
        e.stopPropagation()
        const trig = e.currentTarget
        const host = trig.closest('.dsws-panel') || trig.closest('[data-dsws-host]')
        showPop(trig, host, labels, x.title)
      }
      // R5：变化行视觉（变更琥珀渐隐 / 新增绿闪）
      const _flashCls = (st.rowFlash && st.rowFlash[x.number]) ? (st.rowFlash[x.number] === 'added' ? ' dsws-row-added' : ' dsws-row-changed') : ''
      return h(Tip, { content: (isMap && mapObj) ? tr('list.mapTitle') : tr('list.issueDetailTitle') }, h('div', {
        key: x.number,
        className: 'dsws-aggrow' + _flashCls,
        onClick: function () {
          if (isMap && mapObj) { setActiveMap(st, x.number) }
          else { setActiveIssue(st, x.number) }
        },
        style: isMap ? { cursor: 'pointer', borderLeft: '3px solid #c084fc', background: 'rgba(188,140,255,.07)' } : { cursor: 'pointer' },
      }, [
        // 行1：idcol 竖排（编号上 map 徽章下）+ 标题 + 圆环进度（T1 Map #120：gap 6→8，idcol↔标题 8、标题↔圆环 8）
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%' } }, [
          h('span', { className: 'dsws-idcol' }, [
            isMap ? h('span', { className: 'dsws-chip dsws-chip-m', style: { fontSize: 11, fontWeight: 600, lineHeight: 1.7, padding: '0 8px' } }, [Ic({ n: 'map', size: 11 }), h('span', null, tr('list.mapChip'))]) : null,
            h('span', { className: 'dsws-idnum', style: { color: numColor, borderColor: numColor } }, '#' + (x.key != null ? x.key : x.number)),
          ]),
          h('span', { style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 } }, [h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, x.title)]) }, h('span', { className: 'dsws-tt-wrap', style: { flex: 1, minWidth: 0, fontWeight: isMap ? 600 : undefined, color: isOpen ? undefined : 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, x.title)), (x.author && x.author.login && x.author.login !== ((st.snapshot && (st.snapshot.viewer && st.snapshot.viewer.login || st.snapshot.viewerLogin)) || '')) ? (x.author.avatarUrl ? h(Tip, { content: (x.author.name ? x.author.name + ' (@' + x.author.login + ')' : '@' + x.author.login) }, h('img', { src: x.author.avatarUrl, style: { width: 16, height: 16, borderRadius: '50%', border: '2px solid ' + authorColor(x.author.login), flex: 'none' }, alt: x.author.login })) : h(Tip, { content: (x.author.name ? x.author.name + ' (@' + x.author.login + ')' : '@' + x.author.login) }, h('span', { style: { width: 16, height: 16, borderRadius: '50%', background: hexA(authorColor(x.author.login), 0.18), border: '2px solid ' + authorColor(x.author.login), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' } }, [Ic({ n: 'person', size: 10 })]))) : null]),
          (isMap && mapObj && mapObj.stats) ? ringOf(mapObj.stats) : null,
          !isOpen ? h('span', { className: 'dsws-chip', style: { fontSize: 10, marginRight: 0, flex: 'none', background: 'rgba(139,139,149,.12)', color: '#8b8b95', border: '1px solid rgba(139,139,149,.35)' } }, [Ic({ n: 'check', size: 9 }), h('span', null, tr('map.subClosed'))]) : null,
        ]),
        // 行2：标签贪心折叠（单行不换行）+ 按钮组（常显）（T1 Map #120：marginTop 8→2，全局收紧至 8px = gap6+mt2，所有行一致）
        h('div', { style: { marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, width: '100%' } }, [
          h('div', { className: 'dsws-tags', 'data-dsws-labels': JSON.stringify(labels.map(function (l) { return l.name })) }, [
            labels.map(function (l, i) {
              return h('span', { key: i, className: 'dsws-chip', style: { fontSize: 10, background: hexA(l.color, 0.18) || 'rgba(188,140,255,.16)', color: l.color ? '#' + l.color : '#bc8cff', border: '1px solid ' + (darken(l.color, 0.16) || 'rgba(188,140,255,.6)') } }, l.name)
            }),
            labels.length > 0 ? h(Tip, { content: tr('list.tagsTitle', { names: allNames }) }, h('span', { key: 'more', className: 'dsws-chip dsws-more', onClick: openPop }, '+0')) : null,
            blocked ? h(Tip, { content: tr('list.blockedTitle', { by: blk.by.map(function (b) { return '#' + b }).join('、') }) }, h('span', { key: 'blk', className: 'dsws-chip dsws-blocked', onClick: function (e) { e.stopPropagation(); openBlocked(blk) }, style: { fontSize: 10, background: 'rgba(248,113,113,.16)', color: '#f87171', border: '1px solid rgba(248,113,113,.55)', cursor: 'pointer' } }, [Ic({ n: 'lock', size: 10 }), h('span', null, tr('list.blocked'))])) : null,
          ]),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none', marginLeft: 'auto' } }, [
            isOpen && !blocked ? h('div', { style: { display: 'flex', gap: 3, alignItems: 'center', flex: 'none' } }, [mapEmpty?h(Tip, { content: tr('map.inspectTitle') }, h('button',{className:'dsws-btn primary'+(narrow?' narrow-icon':''),onClick:function(e){e.stopPropagation();let t='';try{t=inspectPrompt(st,x.number,x.title)}catch{const u=typeof issueUrlFor==='function'?(function(){try{return issueUrlFor(st,x.number)}catch(_){return''}})():'',uu=u||(x.number!=null?'#'+String(x.number):'');t=uu?'/wayfinder '+uu:'/wayfinder';try{t=promptText('mapInspect',{n:String(x.number||''),['title']:String(x.title||''),url:u});if(u)t='/wayfinder '+u+'\n\n'+t}catch(_){}}inject(st,t)},style:{display:'inline-flex',alignItems:'center',gap:3,padding:'1px 6px',fontSize:11,flex:'none',background:'#f59e0b',borderColor:'transparent',color:'#140a1e',fontWeight:600}},[Ic({n:'search',size:10}),narrow?null:h('span',null,tr('act.inspect'))])):mapDone?h(Tip, { content: tr('map.doneTitle') }, h('button',{className:'dsws-btn primary'+(narrow?' narrow-icon':''),onClick:function(e){e.stopPropagation();const t=completePrompt(st,x.number,mapObj.stats.total,mapObj.stats.closed);inject(st,t)},style:{display:'inline-flex',alignItems:'center',gap:3,padding:'1px 6px',fontSize:11,flex:'none',background:'#3fb950',borderColor:'transparent',color:'#0c1a10',fontWeight:600}},[Ic({n:'check',size:10}),narrow?null:h('span',null,tr('act.done'))])):mkRowAction(st,x,narrow,colorOf),h(Tip, { content: tr('tip.newSession', { n: x.number }) }, h('button',{className:'dsws-btn primary'+(narrow?' narrow-icon':''),onClick:function(e){e.stopPropagation();openInNewSession(st,x)},style:{textDecoration:'none',display:'inline-flex',alignItems:'center',gap:3,padding:'1px 6px',fontSize:11,flex:'none',marginLeft:4,background:mapEmpty?'#f59e0b':mapDone?'#3fb950':actionColorOf(x,colorOf),borderColor:'transparent',color:mapEmpty?'#140a1e':mapDone?'#0c1a10':(isLightHex(actionColorOf(x,colorOf))?'#140a1e':'#ffffff')}},[Ic({n:'external-link',size:10}),narrow?null:h('span',null,tr('list.newSessionLabel'))])),]) : null,
            isOpen ? h('div', { className: 'dsws-aux', style: { display: 'flex', gap: 2, alignItems: 'center', flex: 'none' } }, [
              // v1.3.3：复制/外链图标增大 11 → 13；Q6 解耦：复制=绝对路径/链接，跳转=按 url 前缀分流（https 开网页，file 盘符调 wf.openPath）
              h(Tip, { content: tr('tip.copyLink') }, h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); copyUrl(x) }, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'clipboard', size: 13 }))),
              (function(){
                const _u = issueUrlFor(st, x.number);
                const _isHttp = /^https?:\/\//i.test(String(_u||''));
                const _openLocal = function(e){ e.stopPropagation(); const u=issueUrlFor(st, x.number); if(!u) return; if(/^https?:\/\//i.test(String(u))) { try{ window.open(u,'_blank','noreferrer') }catch{} } else { try{ if(typeof host!=='undefined'&&host.call) host.call('wf.openPath',{path:u}) }catch{} } };
                return _isHttp ? h(Tip, { content: tr('tip.openInTracker', { n: x.number }) }, h('a', { className: 'dsws-btn ghost', href: _u, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'link', size: 13 }))) : h(Tip, { content: tr('tip.openInTracker', { n: x.number }) }, h('button', { className: 'dsws-btn ghost', onClick: _openLocal, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'link', size: 13 })));
              })(),
            ]) : null,
          ]),
        ]),
      ]))
}
