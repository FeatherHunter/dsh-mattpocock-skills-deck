/**
 * views/NoRepoCard.js — 无仓库红卡 + 表单（T2 #35）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ============ T2 #35 · NoRepo 红卡 + 表单（ListTab 首屏最优先 · 触发= checkRepo:bad && !dismissed）============
export     const NoRepoCard = function (props) {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const st = props.st
      const card = ensureNoRepoCard(st)
      const cs = activeChecks(st)
      const checkRepo = cs.find(function (c) { return c.id === 1 })
      const repoBad = !!(checkRepo && checkRepo.level === 'bad')
      const dismissed = isNoRepoDismissed(st.cwd)
      // #155：Selection 三态优先于 checkRepo（显式无后端/pending 态不走 NoRepo 红卡分支）
      const sel = st.selection || (st.snapshot && st.snapshot.selection) || null
      const isPending = !!(sel && sel.pending)
      const isOther = !!(sel && sel.backendId===null && !sel.pending)
      // PendingCard：pending=true 时无论 repoBad 都显示等待态（提示不阻断，pending 不 fallback）
      if (isPending) {
        return h('div', { className: 'dsws-no-repo-card', style:{ background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.35)' } }, [
          h('div', { className: 'head' }, [
            h('span', { className:'dsws-spinner', style:{ width:13, height:13, borderWidth:2, display:'inline-block' } }),
            h('div', { style:{ flex:1, minWidth:0 } }, [
              h('div', { className:'ttl', style:{ color:'#f59e0b' } }, '正在探测后端'),
              h('div', { className:'desc', style:{ color:'#f59e0b' } }, '3s 超时未决 — 若长时间停留请手动选择'),
            ]),
          ]),
          h('div', { className:'acts' }, [
            h('button', { className:'dsws-btn', onClick:function(){ st.tab='list'; emit(st) }, style:{ fontSize:11, padding:'3px 10px' } }, '去设置页选择'),
            h('button', { className:'dsws-btn primary', onClick:function(){ loadSnapshot(st,true,true) }, style:{ background:'#f59e0b', borderColor:'transparent', color:'#fff', fontSize:11, padding:'3px 10px' } }, '重试探测'),
          ]),
        ])
      }
      if (isOther) {
        return h('div', { className: 'dsws-no-repo-card', style:{ background:'rgba(110,118,129,.08)', border:'1px solid rgba(110,118,129,.35)' } }, [
          h('div', { className: 'head' }, [
            Ic({ n: 'compass', size: 13, color: '#6e7681' }),
            h('div', { style: { flex: 1, minWidth: 0 } }, [
              h('div', { className: 'ttl', style:{ color:'#6e7681' } }, '未绑定后端'),
              h('div', { className: 'desc', style:{ color:'#8b8b95' } }, '当前工作区未选择 Tracker 后端 — 去设置页选择（Other 逃生舱）'),
            ]),
          ]),
          h('div', { className: 'acts' }, [
            h('button', { className: 'dsws-btn primary', onClick:function(){ st.tab='list'; emit(st) }, style: { background: '#6e7681', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '3px 10px' } }, '选择后端'),
          ]),
        ])
      }
      const show = repoBad && !dismissed
      if (!show) return null
      const isValid = isNoRepoNameValid(card.name)
      const doDismiss = function () { setNoRepoDismissed(st.cwd, true); card.expanded = false; emit(st) }
      const doExpand = function () { if (!card.name) card.name = cwdBasename(st.cwd); card.expanded = true; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st) }
      const doCollapse = function () { card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st) }
      const doSubmit = function () {
        if (!isNoRepoNameValid(card.name)) { card.errorKind = 'bad-name'; card.error = tr('panel.noRepoErr.bad-name'); card.errorRepoUrl = ''; emit(st); return }
        if (typeof host === 'undefined' || typeof host.call !== 'function') { card.errorKind = 'unknown'; card.error = tr('err.hostUnavailable'); card.errorRepoUrl = ''; emit(st); return }
        card.loading = true; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
        host.call('wf.initPublish', { cwd: st.cwd, name: card.name, visibility: card.visibility }).then(function (res) {
          card.loading = false
          if (res && res.ok) {
            const repoStr2 = res.repo && res.repo.owner ? res.repo.owner + '/' + res.repo.name : (res.repo && res.repo.name ? res.repo.name : card.name)
            flash(st, tr('panel.noRepoCreateSuccess', { repo: repoStr2 }), 'ok')
            card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
            loadSnapshot(st, true, true); loadChecks(st, true, true)
          } else {
            const kind = (res && res.errorKind) || 'unknown'
            const raw = (res && res.error) || ''
            card.errorKind = kind
            card.errorRepoUrl = (res && res.repoUrl) || ''
            const key = 'panel.noRepoErr.' + kind
            const mapped = tr(key)
            const base = (mapped !== key) ? mapped : (raw ? String(raw).slice(0, 160) : tr('panel.noRepoErr.unknown'))
            card.error = base + (raw && base !== String(raw).slice(0, 160) && mapped !== raw ? ' · ' + String(raw).slice(0, 120) : '')
            emit(st)
          }
        }).catch(function (e) {
          card.loading = false; card.errorKind = 'unknown'; card.error = String((e && e.message) || e).slice(0, 200); card.errorRepoUrl = ''; emit(st)
        })
      }
      return h('div', { className: 'dsws-no-repo-card' }, [
        h('div', { className: 'head' }, [
          Ic({ n: 'alert', size: 13, color: '#f87171' }),
          h('div', { style: { flex: 1, minWidth: 0 } }, [
            h('div', { className: 'ttl' }, tr('panel.noRepoCardTitle')),
            h('div', { className: 'desc' }, tr('panel.noRepoCardDesc')),
          ]),
          h('button', { className: 'dsws-btn ghost', title: tr('panel.noRepoCardDismiss'), onClick: function (e) { e.stopPropagation(); doDismiss() }, style: { padding: '2px 6px', flex: 'none' } }, Ic({ n: 'x', size: 12 })),
        ]),
        h('div', { className: 'acts' }, !card.expanded ? [
          h('button', { className: 'dsws-btn primary', onClick: doExpand, style: { background: '#f87171', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '3px 10px' } }, tr('panel.noRepoCardAction')),
          h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); doDismiss() }, style: { fontSize: 11, padding: '3px 10px' } }, tr('panel.noRepoCardDismiss')),
        ] : null),
        card.expanded ? h('div', { className: 'dsws-no-repo-form' }, [
          h('div', { className: 'row' }, [
            h('label', null, tr('panel.noRepoFormName')),
            h('input', { type: 'text', value: card.name, placeholder: cwdBasename(st.cwd), onChange: function (e) { card.name = e.target.value; if (card.errorKind === 'bad-name') { card.error = ''; card.errorKind = '' } emit(st) } }),
          ]),
          h('div', { className: 'hint', style: (!isValid && card.name) ? { color: '#f87171' } : null }, tr('panel.noRepoFormNameHint')),
          h('div', { className: 'row' }, [
            h('label', null, tr('panel.noRepoFormVisibility')),
            h('label', { className: 'radio', style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' } }, [
              h('input', { type: 'radio', name: 'noRepoVis-' + (st.cwd || 'x'), checked: card.visibility === 'private', onChange: function () { card.visibility = 'private'; emit(st) } }),
              h('span', null, tr('panel.noRepoFormPrivate')),
            ]),
            h('label', { className: 'radio', style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginLeft: 12 } }, [
              h('input', { type: 'radio', name: 'noRepoVis-' + (st.cwd || 'x'), checked: card.visibility === 'public', onChange: function () { card.visibility = 'public'; emit(st) } }),
              h('span', null, tr('panel.noRepoFormPublic')),
            ]),
          ]),
          card.error ? (function () {
            const kind = card.errorKind || 'unknown'
            const isWarn = kind === 'no-git' || kind === 'no-gh' || kind === 'not-logged-in' || kind === 'network'
            const bg = isWarn ? 'rgba(245,158,11,.12)' : 'rgba(248,113,113,.12)'
            const bd = isWarn ? 'rgba(245,158,11,.45)' : 'rgba(248,113,113,.45)'
            const col = isWarn ? '#fbbf24' : '#f87171'
            return h('div', { className: 'err', style: { background: bg, border: '1px solid ' + bd, color: col, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } }, [
              Ic({ n: 'alert', size: 11, color: col }),
              h('span', { style: { marginLeft: 4, flex: '1 1 auto' } }, card.error),
              kind === 'no-git' ? h('a', { href: 'https://git-scm.com/', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '下载') : null,
              kind === 'no-gh' ? h('a', { href: 'https://cli.github.com/', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '下载') : null,
              kind === 'not-logged-in' ? h('a', { href: 'https://cli.github.com/manual/gh_auth_login', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '去登录') : null,
              kind === 'already-exists' ? h('a', { href: card.errorRepoUrl || ('https://github.com/search?q=' + encodeURIComponent(card.name)), target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '去查看') : null,
              kind === 'network' ? h('button', { onClick: doSubmit, disabled: card.loading, style: { marginLeft: 8, background: 'transparent', color: col, border: '1px solid ' + col, borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 } }, '重试') : null,
            ])
          })() : null,
          h('div', { className: 'row', style: { marginTop: 8 } }, [
            h('button', { className: 'dsws-btn primary', disabled: card.loading || !isValid, onClick: doSubmit, style: { opacity: (!isValid || card.loading) ? 0.6 : 1, background: '#f87171', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
              card.loading ? h('span', { className: 'dsws-spinner', style: { width: 12, height: 12, borderWidth: 2, display: 'inline-block', verticalAlign: '-2px' } }) : null,
              h('span', null, card.loading ? tr('panel.noRepoFormSubmitting') : tr('panel.noRepoFormSubmit')),
            ]),
            h('button', { className: 'dsws-btn', onClick: doCollapse, disabled: card.loading, style: { marginLeft: 6, fontSize: 11, padding: '4px 10px' } }, tr('panel.noRepoFormCancel')),
          ]),
        ]) : null,
      ])
    }
