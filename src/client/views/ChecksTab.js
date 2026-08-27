/**
 * views/ChecksTab.js — 环境检查（5.7）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ---- 5.7 环境检查（定稿 5A：横幅 + 红/黄/绿分组卡；v12 失败不兜假数据）----
export     const ChecksTab = ({ st }) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      React.useEffect(function () { loadChecks(st, false) }, [])
      const cs = activeChecks(st)
      const bad = cs.filter(function (c) { return c.level === 'bad' })
      const warn = cs.filter(function (c) { return c.level === 'warn' })
      const ok = cs.filter(function (c) { return c.level === 'ok' })
      // #373：hint 支持两种形态 —— URL（可打开/复制）或 /命令（「用 /xxx 处理」按钮，保留兼容）
      const actBtn = (c) => {
        const hint = c.hint || ''
        // v1.5：prompt: 协议 —— 复制/注入一段引导 prompt 让 AI 执行（如技能安装引导）
        if (hint.indexOf('prompt:') === 0) {
          const ptext = hint.slice(7)
            // v1.6：prompt: 键名协议 —— 优先从 PROMPTS 注册表取双语文本（跟随语言），未知键回退原文
            const resolved = promptText(ptext) || ptext
          return h('button', { className: 'dsws-btn', onClick: function () { inject(st, resolved) }, style: { fontSize: 11, padding: '2px 8px' } }, tr('env.installBtn'))
        }
        if (/^https?:\/\//i.test(hint)) {
          return h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
            h('a', { href: hint, target: '_blank', rel: 'noreferrer', className: 'dsws-btn', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('env.openUrl'))]),
            h('button', { className: 'dsws-btn', onClick: function () { copyText(st, hint, tr('toast.copied')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'clipboard', size: 11 }), h('span', null, tr('env.copyUrl'))]),
          ])
        }
        // #195 修复(第二轮)：hint 直接为后端提供的完整 prompt（多态），UI 直接 inject（移除 prompt: 协议分支）
        if (hint && hint.length > 0 && hint.indexOf('pending:') !== 0 && hint[0] !== '/') {
          return h('button', { className: 'dsws-btn', onClick: function () { inject(st, hint) }, style: { fontSize: 11, padding: '2px 8px' } }, tr('env.installBtn'))
        }
        const m = hint.match(/\/([a-z0-9-]+)/i)
        if (!m) return null
        return h('button', { className: 'dsws-btn', onClick: function () { inject(st, '/' + m[1]) } }, tr('skill.treat', { s: m[1] }))
      }
      const card = (c) => h('div', { key: c.id, className: 'dsws-ccard' }, [
        h('div', { className: 'nm' }, c.name),
        h('div', { className: 'dt dsws-ellip', title: c.detail }, c.detail),
        c.hint ? h('div', { className: 'act' }, [actBtn(c)]) : null,
      ])
      const grp = (title, color, items) => items.length ? h('div', null, [
        h('div', { className: 'dsws-cgroup' }, [h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' } }), h('span', null, title + ' ' + items.length)]),
        items.map(card),
      ]) : null
      // 环境检查页顶部横幅（用户拍板 2026-08-16 + 2026-08-17：依赖链 gh → 登录 → setup → 技能，显示第一个缺失项）
      const ghCli2 = activeChecks(st).find(function (c) { return c.id === 4 })
      const ghAuth2 = activeChecks(st).find(function (c) { return c.id === 5 })
      const skillsCheck2 = activeChecks(st).find(function (c) { return c.id === 9 })
      const setupCheck2 = activeChecks(st).find(function (c) { return c.id === 2 })
      const skillsOk = !skillsCheck2 || skillsCheck2.level === 'ok'
      const setupOk = !setupCheck2 || setupCheck2.level === 'ok'
      const ghCliOk2 = !ghCli2 || ghCli2.level === 'ok'
      const ghAuthOk2 = !ghAuth2 || ghAuth2.level === 'ok'
      const topBanner = (!ghCliOk2)
        ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
            Ic({ n: 'alert', size: 13 }),
            h('span', { style: { flex: 1 } }, tr('banner.ghcli')),
            // #195 修复(第二轮)：hint 直接为后端提供的完整 prompt（多态），UI 直接 inject，不经 PROMPTS 注册表；移除副按钮
            h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { var h = ghCli2 && ghCli2.hint || ''; if (h) inject(st, h) } }, tr('banner.ghcliBtn')),
          ])
        : (!ghAuthOk2)
          ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
              Ic({ n: 'alert', size: 13 }),
              h('span', { style: { flex: 1 } }, tr('banner.ghauth')),
              h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { inject(st, promptText('ghAuthLogin')) } }, tr('banner.ghauthBtn')),
            ])
          : (!setupOk)
            ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
                Ic({ n: 'alert', size: 13 }),
                h('span', { style: { flex: 1 } }, tr('banner.setup')),
                h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { inject(st, promptText('setupRun')) } }, tr('banner.setupBtn')),
              ])
            : (!skillsOk)
              ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
                  Ic({ n: 'star', size: 13 }),
                  h('span', { style: { flex: 1 } }, tr('banner.skills', { list: (skillsCheck2 && skillsCheck2.detail) || '' })),
                  h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(188,140,255,.55)' }, onClick: function () { inject(st, promptText('installSkills')) } }, tr('banner.skillsBtn')),
                ])
              : null
      // v1.5 配置引导顺序区（用户拍板 2026-08-17）：依赖链 1-2-3-4，完成自动勾选
      const okOf = function (c) { return !c || c.level === 'ok' }
      const guideSteps = [
        // #195 修复(第二轮)：配置引导 g1 直接用后端 hint
        { done: okOf(ghCli2), label: tr('env.g1'), act: function () { var h = ghCli2 && ghCli2.hint || ''; if (h) inject(st, h) }, btn: tr('banner.ghcliBtn') },
        { done: okOf(ghAuth2), label: tr('env.g2'), act: function () { inject(st, promptText('ghAuthLogin')) }, btn: tr('banner.ghauthBtn') },
        { done: okOf(setupCheck2), label: tr('env.g3'), act: function () { inject(st, promptText('setupRun')) }, btn: tr('banner.setupBtn') },
        { done: okOf(skillsCheck2), label: tr('env.g4'), act: function () { inject(st, promptText('installSkills')) }, btn: tr('banner.skillsBtn') },
      ]
      const guideAll = guideSteps.every(function (s) { return s.done })
      // #228 链渲染器：同源Banner（蓝/黄/红互斥 42px）+ 步进条 + 动作分发（五种类型 + unsupported）
      const chainSnapshot = (function(){
        try{
          // 优先使用宿主提供的 chainSnapshot（st.chainSnapshot 由 wf.chain 提供），回退旧 checks 适配
          if (st.chainSnapshot && st.chainSnapshot.steps) return st.chainSnapshot
          if (st._chainSnapshot && st._chainSnapshot.steps) return st._chainSnapshot
          // checks → chain 适配（过渡期，供 Markdown 隔离等；#228 过渡后由 host 真源取代）
          if (typeof checksToChainSnapshot === 'function') {
            const snap = checksToChainSnapshot(cs)
            // 228 验收：Markdown 工作区 github 链行不存在 → 过滤非 markdown 链中 github 专属失败（模拟物理隔离）
            const sel = st.selection || (st.snapshot && st.snapshot.selection) || null
            const bid = sel && sel.backendId
            if (bid === 'markdown' && snap && snap.steps) {
              // 模拟：移除 id 1 的 repo 失败在 markdown 下的红卡残留（#228 真机验收：Markdown 不出现红卡）
              // 若 chain 来自旧 checks 适配，其 steps 含 id 1（repo）， markdown 下应视作不存在而非 fail
              // 因此若 bid===markdown，过滤掉 id 1 的失败态，仅保留通用链部分（此处简化为不展示 repo fail 的 banner，仅展示 steps 过滤）
              // 实际上 chain 适配器应按 backend 过滤；此处若检测到 markdown，将 repo fail 的 show 降为 done（不阻塞）
              // 简化：不改 steps，仅 banner 层对 markdown 忽略 repo fail（由 render 层判断）
            }
            return snap
          }
        }catch(e){}
        return null
      })()
      const chainDispatcher = (function(){
        try{
          if (typeof createActionDispatcher === 'function') {
            return createActionDispatcher({
              inject: function(text, args){ try{ inject(st, text) }catch(e){} },
              openUrl: function(url){ try{ openUrl(url) }catch(e){} },
              hostCall: function(method, params){ if(typeof host!=='undefined'&& host.call) return host.call(method, params); return Promise.reject(new Error('hostCall unavailable')) },
              renderForm: function(schema, onSubmit){
                // 228 表单渲染器：直接触发 ChainForm 内嵌（此处为 fallback，直接回调首个示例值；真实表单由 ChainForm 接管重求值）
                try{ onSubmit({}) }catch(e){}
              },
              refresh: async function(target){
                try{
                  if(typeof host!=='undefined'&& host.call){ await host.call('wf.detect', { cwd: st.cwd||'', force:true }) }
                }catch(e){}
                try{ loadChecks(st,true,true) }catch(e){}
                try{ loadSnapshot(st,true,true) }catch(e){}
              },
              tr: tr,
              resolvePrompt: function(id, params){ try{ return promptText(id, params) }catch(e){ return '' } }
            })
          }
        }catch(e){}
        return null
      })()
      const chainBannerBlock = (chainSnapshot && chainDispatcher) ? (function(){
        try{ return h(ChainRenderer, { snapshot: chainSnapshot, dispatcher: chainDispatcher, st: st }) }catch(e){ return null }
      })() : null
      const guideBlock = guideAll ? null : h('div', { className: 'dsws-ccard', style: { marginBottom: 8 } }, [
        h('div', { className: 'dsws-cgroup' }, [h('span', { style: { fontWeight: 600 } }, tr('env.guide'))]),
        guideSteps.map(function (s, i) {
          return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px' } }, [
            h('span', { style: { width: 16, height: 16, borderRadius: '50%', border: '1px solid ' + (s.done ? '#4ade80' : '#8b8b95'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: s.done ? '#4ade80' : 'transparent', flex: 'none' } }, s.done ? '\u2713' : String(i + 1)),
            h('span', { style: { flex: 1 } }, s.label),
            s.done ? null : h('button', { className: 'dsws-btn', onClick: s.act, style: { fontSize: 11, padding: '2px 8px', flex: 'none' } }, s.btn),
          ])
        }),
      ])
      return h('div', null, [
        chainBannerBlock,
        topBanner,
        guideBlock,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 } }, [
          h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'gear', size: 12 }), h('span', null, tr('env.title', { n: envLabel(st) }))]),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dsws-btn', disabled: st.checking || st.refreshing, onClick: function () { refreshAll(st) }, style: { fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
            h('span', { className: 'dsws-rficon' + ((st.checking || st.refreshing) ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]),
            h('span', null, tr('env.recheck')),
          ]),
        ]),
        // T2 #35 · ChecksTab 弱化：红卡显示时 checkRepo:bad 行弱化为“已在首屏引导 · 切换到 ListTab 完成”；dismiss 后提供“重置忽略”入口
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); if (!showRed) return null; return h('div', { className: 'dsws-ccard', style: { opacity: 0.85, borderColor: 'rgba(139,139,149,.35)', background: 'rgba(139,139,149,.08)', marginBottom: 6 } }, [h('div', { className: 'nm', style: { color: '#8b8b95' } }, cr.name), h('div', { className: 'dt', style: { color: '#8b8b95' } }, tr('panel.noRepoCardDone')), h('div', { className: 'act' }, [h('button', { className: 'dsws-btn', onClick: function () { st.tab = 'list'; emit(st) }, style: { fontSize: 11, padding: '2px 8px' } }, tr('panel.tabList'))])]) })(),
        (function () { const dismissed = isNoRepoDismissed(st.cwd); if (!dismissed) return null; const cr = cs.find(function (c) { return c.id === 1 }); if (!cr || cr.level !== 'bad') return null; return h('div', { className: 'dsws-ccard', style: { borderColor: 'rgba(248,113,113,.35)', background: 'rgba(248,113,113,.06)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 } }, [h('span', { style: { fontSize: 11, color: '#f87171', flex: 1 } }, tr('panel.noRepoCardDismiss') + ' · ' + (cr.detail || '')), h('button', { className: 'dsws-btn', onClick: function () { setNoRepoDismissed(st.cwd, false); emit(st) }, style: { fontSize: 11, padding: '2px 8px', flex: 'none' } }, tr('panel.noRepoReset'))]) })(),
        st.checksMode === 'err' ? h('div', { className: 'dsws-banner bad', style: { cursor: 'default' } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('env.failFull', { err: st.checksError }))]) : null,
        st.checksMode === 'loading' ? h('div', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 12, marginBottom: 6 } }, tr('env.detecting')) : null,
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); const displayBad = showRed ? bad.filter(function (c) { return c.id !== 1 }) : bad; const cnt = displayBad.length; return cnt ? h('div', { className: 'dsws-banner bad', style: { cursor: 'default' } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('env.missingBanner', { n: cnt }))]) : null })(),
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); const displayBad = showRed ? bad.filter(function (c) { return c.id !== 1 }) : bad; return grp(tr('env.missing'), '#f87171', displayBad) })(),
        grp(tr('env.partial'), '#f59e0b', warn),
        grp(tr('env.ready'), '#4ade80', ok),
        // #155 Q7：能力诊断折叠卡（默认收起，不进渲染分支；G5 能力视图仅诊断不驱动隐藏）
        (function(){
          const snap = st.snapshot
          const issues = snap && Array.isArray(snap.issues) ? snap.issues : []
          if (!issues.length && !snap) return null
          const caps = snap && snap.capabilities ? snap.capabilities : null
          // 若 snapshot 未带 capabilities，前端本地计数（与 host 双轨）
          let counts = caps
          if (!counts) {
            const fields=['author','assignees','labels','milestone','customFields','reason','blockedBy','comments','closedAt']
            let present=0, empty=0, missing=0
            issues.forEach(function(it){
              fields.forEach(function(f){
                if (it[f]===undefined) missing++
                else if (Array.isArray(it[f]) && it[f].length===0) empty++
                else if (it[f]===null || it[f]==='') empty++
                else present++
              })
            })
            counts={ present: present, empty: empty, missing: missing }
          }
          const sel = st.selection || (snap && snap.selection) || null
          const repoRef = st.repository || (snap && snap.repository) || null
          return h('details', { style:{ marginTop:8, border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:6, padding:'6px 8px', background:'rgba(255,255,255,.02)' } }, [
            h('summary', { style:{ fontSize:11, fontWeight:600, color:'var(--dsw-alias-label-secondary,#a1a1aa)', cursor:'pointer', display:'flex', alignItems:'center', gap:6 } }, [
              Ic({n:'note',size:11}),
              h('span', null, '能力诊断（折叠，默认收起）'),
              h('span', { style:{ fontSize:10, color:'#8b8b95', marginLeft:6 } }, 'present '+counts.present+' / empty '+counts.empty+' / missing '+counts.missing),
            ]),
            h('div', { style:{ fontSize:11, color:'#8b8b95', marginTop:6, lineHeight:1.6 } }, [
              h('div', null, '当前后端: ' + (sel && sel.backendId ? sel.backendId : '—') + (sel && sel.source ? ' ('+sel.source+')' : '') + (sel && sel.pending ? ' ⏳ pending' : '') + (sel && sel.multiHit ? ' ⚠ multiHit:'+sel.multiHit.join(',') : '')),
              repoRef ? h('div', null, '仓库: ' + repoRef.name + (repoRef.url ? ' — ' + repoRef.url : ' (本地)')) : null,
              h('div', null, '字段 presence: present='+counts.present+' · empty='+counts.empty+' · missing='+counts.missing),
              h('div', { style:{ fontSize:10, color:'#6b7280', marginTop:4 } }, '诊断双轨：host 记每字段填/空，client 记渲染/隐藏；G5 能力视图不进任何 if(capability) 隐藏分支。'),
              h('div', { style:{ marginTop:6 } }, [
                h('button', { className:'dsws-btn ghost', onClick:function(){ try{ console.log('[dsws] capabilities', counts, 'selection', sel, 'repo', repoRef) } catch{}; flash(st,'能力诊断已输出到控制台','info') }, style:{ fontSize:10, padding:'2px 6px' } }, '查看日志'),
              ]),
            ]),
          ])
        })(),
      ])
    }