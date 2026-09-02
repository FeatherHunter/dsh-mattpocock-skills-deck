/**
 * views/IssueDetail.js — Issue 详情页（独立叶模块 · v1.7.0 T1/T2/T3）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 对应叶标记处（一源两物）。
 * 设计约束：每个模块可独立并发开发 — 本文件仅依赖内核 seam（store/router/api/locale/shared组件），
 * 同层禁止 import 其他视图（ListTab/MapDetail 等），像插件般隔离；所有共享能力经 DswsCtx 取用。
 * T2 数据通路：fetchIssueDetail(n)（GraphQL+REST 双通道，host 侧 wf.issueDetail），60s 缓存命中即用，loading/real/err 三态。
 */
export const IssueDetail = function (props) {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const st = props.st
      const issueNumber = st.activeIssue
      const repoStrLocal = repoStr(st)
      const colorOf = (typeof buildColorOf === 'function') ? buildColorOf(st) : {}
      if (!issueNumber) return null
      // 触发拉取（缓存命中则同步回 real，不多发请求；force 重试由按钮控制）
      React.useEffect(function () {
        if (!issueNumber) return
        if (typeof fetchIssueDetail === 'function') fetchIssueDetail(st, issueNumber)
      }, [issueNumber, st.cwd])
      // #255 提交确认闪烁定时清除（类 rowFlash 同语义，防堆积；置于 early-return 之前保 hooks 顺序恒定）
      React.useEffect(function () {
        if (!st.cmtConfirm) return undefined
        const t = setTimeout(function () { st.cmtConfirm = null; emit(st) }, 3000)
        return function () { clearTimeout(t) }
      }, [st.cmtConfirm])
      const detail = (st.issueDetail && st.issueDetail.number === issueNumber) ? st.issueDetail : null
      const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
      const snapIssue = issues.find(function (x) { return x.number === issueNumber })
      const src = detail || snapIssue
      const mode = st.issueMode || 'idle'
      const err = st.issueError
      const goBack = function () { clearActiveIssue(st) }
      const doRetry = function () { if (typeof fetchIssueDetail === 'function') fetchIssueDetail(st, issueNumber, { force: true }) }
      const copyUrl = function (n) {
        const url = issueUrlFor(st, n)
        copyText(st, url, tr('toast.copiedLink', { n: n }))
      }
      // parent map ribbon（从快照探测，若 detail 含 subIssues 则优先 detail）
      const parentMap = (function () {
        const maps = (st.snapshot && st.snapshot.maps) || []
        for (let mi = 0; mi < maps.length; mi++) {
          const m = maps[mi]
          const hits = (m.tickets || []).some(function (t) { return t.number === issueNumber })
          if (hits) return m
        }
        return null
      })()
      // loading（首拉无缓存且无 snap 降级）
      if (mode === 'loading' && !src) {
        return h('div', null, [
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } }, [
            h('button', { className: 'dsws-btn', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'back', size: 12 }), h('span', null, tr('list.back'))]),
            h('span', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 11 } }, ' / #' + issueNumber),
            h('span', { style: { flex: 1 } }),
          ]),
          h('div', { style: { padding: '24px 0', textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 } }, [h('div', { className: 'dsws-spinner', style: { width: 14, height: 14, border: '2px solid rgba(255,255,255,.15)', borderTopColor: '#c084fc', borderRadius: '50%', animation: 'dsws-spin 1s linear infinite' } }), h('span', null, tr('list.loading'))]),
        ])
      }
      // err 无 src（且非 snap 降级可显）→ 错误横幅
      if (mode === 'err' && !src) {
        const kind = err && err.kind || 'network'
        const msg = err && (err.message || err.error) || tr('list.loadFail')
        return h('div', null, [
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } }, [
            h('button', { className: 'dsws-btn', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'back', size: 12 }), h('span', null, tr('list.back'))]),
            h('span', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 11 } }, ' / #' + issueNumber),
            h('span', { style: { flex: 1 } }),
          ]),
          h('div', { style: { padding: '12px', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 8, fontSize: 12, color: '#f87171', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
            Ic({ n: 'alert', size: 13 }),
            h('span', null, kind + ': ' + String(msg).slice(0, 160)),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'dsws-btn primary', onClick: doRetry, style: { padding: '1px 8px', fontSize: 11, background: '#f87171', borderColor: 'transparent', color: '#fff' } }, '重试'),
            h('a', { className: 'dsws-btn ghost', href: issueUrlFor(st, issueNumber), target: '_blank', rel: 'noreferrer', style: { padding: '1px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('detail.viewOnTracker'))]),
          ]),
        ])
      }
      // src 兜底缺失（snap 与 detail 均无）→ 轻量占位（可能为历史 closed 未加载全量，已在 loading 分支处理，此处为缺口保护）
      if (!src) {
        return h('div', null, [
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } }, [
            h('button', { className: 'dsws-btn', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'back', size: 12 }), h('span', null, tr('list.back'))]),
            h('span', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 11 } }, ' / #' + issueNumber),
          ]),
          h('div', { style: { padding: '24px 0', textAlign: 'center', color: 'var(--dsw-alias-label-caption,#8b8b95)', fontSize: 12 } }, '无描述（快照未命中，细节加载中）'),
        ])
      }
      const labels = (src.labels && src.labels.nodes) ? src.labels.nodes : (src.labels || [])
      const labelArr = Array.isArray(labels) ? labels : []
      const assigneesRaw = (src.assignees && src.assignees.nodes) ? src.assignees.nodes : (src.assignees || [])
      const assignees = Array.isArray(assigneesRaw) ? assigneesRaw : []
      const stateRaw = src.state || 'OPEN'
      const isOpen = String(stateRaw).toUpperCase() !== 'CLOSED'
      const stateColor = isOpen ? '#3fb950' : '#8b949e'
      const stateLabel = isOpen ? tr('list.state.open') : tr('list.state.closed')
      const title = src.title || ('#' + issueNumber)
      const body = src.body || ''
      const has = function (nm) { return labelArr.some(function (l) { return (l.name || l) === nm }) }
      const _isTriageLikeLocal = !labelArr.length || has('needs-triage')
      const fakeIssue = { number: issueNumber, ['title']: title, labels: labelArr.map(function (l) { return typeof l === 'string' ? { name: l } : l }), state: stateRaw }
      const primaryBtn = (function () {
        if (_isTriageLikeLocal) return mkRowAction(st, fakeIssue, false, colorOf)
        if (has('bug')) return mkRowAction(st, fakeIssue, false, colorOf)
        if (has('wayfinder:grilling')) return mkRowAction(st, fakeIssue, false, colorOf)
        if (has('wayfinder:research')) return mkRowAction(st, fakeIssue, false, colorOf)
        if (has('wayfinder:prototype')) return mkRowAction(st, fakeIssue, false, colorOf)
        return mkRowAction(st, fakeIssue, false, colorOf)
      })()
      const actColor = (typeof actionColorOf === 'function') ? actionColorOf(fakeIssue, colorOf) : stateColor
      const actTextColor = (typeof isLightHex === 'function' && isLightHex(actColor)) ? '#140a1e' : '#ffffff'
      const subNodes = (src.subIssues && src.subIssues.nodes) ? src.subIssues.nodes : []
      const subTotal = (src.subIssues && typeof src.subIssues.totalCount === 'number') ? src.subIssues.totalCount : subNodes.length
      const blockedNodes = (src.blockedBy && src.blockedBy.nodes) ? src.blockedBy.nodes : []
      const commentsNodes = (src.comments && src.comments.nodes) ? src.comments.nodes : []
      // #255 提交确认闪烁下标：仅当 force 重取后的评论里真实存在 body 全等匹配项才点亮
      // （新评论必须来自服务端重取的证据；定时清空归位，无乐观假设）
      let confirmedIdx = -1
      if (st.cmtConfirm && st.cmtConfirm.body) {
        const __cb = String(st.cmtConfirm.body)
        const __cap = Math.min(commentsNodes.length, 50)
        for (let __ci = __cap - 1; __ci >= 0; __ci--) {
          if (String(commentsNodes[__ci] && commentsNodes[__ci].body || '') === __cb) { confirmedIdx = __ci; break }
        }
      }
      const isStale = !detail && !!snapIssue
      // ======== #255 · 评论输入区（GitHub 单点 · MISSING 零分支）========
      // 显隐以能力字段有无判：comments 存在即渲染（EMPTY=[] 渲染、MISSING=省略 不渲染），
      // 零后端身份分支。数组形状（契约 Comment[]）与 GraphQL 形状（{nodes,pageInfo}）双兼容。
      const rawComments = src.comments
      const canComment = !!rawComments && (Array.isArray(rawComments) ? true : !!(typeof rawComments === 'object' && Array.isArray(rawComments.nodes)))
      const cmtErrTextOf = function (er) {
        const k = er && er.kind || ''
        if (k === 'auth') return tr('detail.cmtAuthFail')
        if (k === 'rate-limit') return tr('detail.cmtRateLimit')
        return tr('detail.cmtGeneric', { msg: String((er && er.message) || '').slice(0, 120) })
      }
      const doSubmit = function () {
        if (st.cmtSending) return
        const text = String(st.cmtDraft || '').trim()
        if (!text) return
        if (typeof submitIssueComment !== 'function') { st.cmtError = { kind: 'env' }; emit(st); return }
        st.cmtSending = true; st.cmtError = null; emit(st)
        const startedAt = Date.now()
        submitIssueComment(st, issueNumber, text).then(function (res) {
          st.cmtSending = false
          if (!res || res.ok !== true) {
            st.cmtError = (res && res.error) || { kind: 'network' }
            emit(st)
            return
          }
          // 推进序列（无乐观假设）：清空输入 → 击穿详情缓存 force 重取（唯一推进源=重求值）
          // → probeNow 静默快照刷新（右侧列表行闪烁由 diff 真实产出）
          st.cmtDraft = ''
          st.cmtError = null
          st.cmtConfirm = { body: text, at: startedAt }
          emit(st)
          if (typeof fetchIssueDetail === 'function') fetchIssueDetail(st, issueNumber, { force: true })
          try { if (typeof probeNow === 'function') probeNow(false) } catch (ePn) {}
        }).catch(function (eSub) {
          st.cmtSending = false
          st.cmtError = { kind: 'network', message: String((eSub && eSub.message) || eSub) }
          emit(st)
        })
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
        // 顶部固定行
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
          h('button', { className: 'dsws-btn', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' } }, [Ic({ n: 'back', size: 12 }), h('span', null, tr('list.back'))]),
          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', whiteSpace: 'nowrap' } }, '列表 / #' + issueNumber),
          h('span', { style: { flex: 1, minWidth: 8 } }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none' } }, [
            detail ? h('span', { style: { fontSize: 10, color: isStale ? '#f59e0b' : '#8b8b95' } }, isStale ? '快照' : (mode === 'loading' ? tr('list.loading') : '')) : null,
            h(Tip, { content: tr('tip.newSession', { n: issueNumber }) }, h('button', { className: 'dsws-btn primary', onClick: function (e) { e.stopPropagation(); openInNewSession(st, { number: issueNumber, ['title']: title, labels: labelArr }) }, style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, background: actColor, borderColor: 'transparent', color: actTextColor } }, [Ic({ n: 'external-link', size: 10 }), h('span', null, tr('list.newSessionLabel'))])),
            h(Tip, { content: tr('tip.copyLink') }, h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); copyUrl(issueNumber) }, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px' } }, Ic({ n: 'clipboard', size: 13 }))),
            h(Tip, { content: tr('tip.openInTracker', { n: issueNumber }) }, h('a', { className: 'dsws-btn ghost', href: issueUrlFor(st, issueNumber), target: '_blank', rel: 'noreferrer', style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px' } }, Ic({ n: 'link', size: 13 }))),
          ]),
        ]),
        // 顶部 err 横幅（有 src 时可重试，不遮挡主体）
        mode === 'err' && err ? h('div', { style: { padding: '8px 10px', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.25)', borderRadius: 6, fontSize: 11, color: '#f87171', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
          Ic({ n: 'alert', size: 11 }),
          h('span', null, (err.kind || 'err') + ': ' + String(err.message || err.error || '').slice(0,140)),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dsws-btn', onClick: doRetry, style: { padding: '1px 6px', fontSize: 11 } }, '重试'),
          !detail && snapIssue ? h('span', { style: { fontSize: 10, color: '#f59e0b' } }, '（显示快照降级）') : null,
        ]) : null,
        // header
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 } }, [
          h('span', { className: 'dsws-idnum', style: { color: actColor, borderColor: actColor, flex: 'none' } }, '#' + issueNumber),
          h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, title)]) }, h('span', { className: 'dsws-tt-wrap', style: { flex: 1, fontSize: 14, fontWeight: 600 } }, title)),
          h('span', { className: 'dsws-chip', style: { fontSize: 10, background: isOpen ? 'rgba(63,185,80,.15)' : 'rgba(139,148,158,.15)', color: stateColor, border: '1px solid ' + stateColor, flex: 'none' } }, [Ic({ n: isOpen ? 'dot' : 'check', size: 9 }), h('span', { style: { marginLeft: 3 } }, stateLabel)]),
        ]),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } }, [
          labelArr.map(function (l, i) {
            const nm = l.name || l
            const col = l.color || ''
            return h('span', { key: i, className: 'dsws-chip', style: { fontSize: 10, background: hexA ? hexA(col, 0.18) : ('#' + col), color: col ? '#' + col : '#bc8cff', border: '1px solid ' + (darken ? darken(col, 0.16) : 'rgba(188,140,255,.6)') } }, nm)
          }),
          assignees.map(function (a, i) {
            const login = (typeof a === 'string') ? a : (a.login || '')
            return h('span', { key: 'a' + i, className: 'dsws-chip', style: { fontSize: 10, background: 'rgba(88,166,255,.12)', color: '#58a6ff', border: '1px solid rgba(88,166,255,.4)' } }, [Ic({ n: 'person', size: 9 }), h('span', { style: { marginLeft: 3 } }, '@' + login)])
          }),
          src.updatedAt ? h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, '· 更新 ' + String(src.updatedAt).slice(0,10)) : null,
          src.createdAt ? h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, '· 创建 ' + String(src.createdAt).slice(0,10)) : null,
          // #155 Q6 2🟡新增：author + closedAt（仅当字段存在时显示，undefined → 不渲染；符合 §2 不新增隐藏逻辑）
          (src.author && src.author.login) ? h('span', { style:{ fontSize:10, color:'#8b8b95', display:'inline-flex', alignItems:'center', gap:3 } }, [
            src.author.avatarUrl ? h('img', { src: src.author.avatarUrl, style:{ width:12, height:12, borderRadius:'50%' } }) : Ic({n:'person',size:10}),
            h('span', null, '@' + src.author.login)
          ]) : null,
          (!isOpen && src.closedAt) ? h('span', { style:{ fontSize:10, color:'#8b8b95' } }, '· 关闭 ' + String(src.closedAt).slice(0,10)) : null,
        ]),
        parentMap ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'rgba(188,140,255,.06)', border: '1px solid rgba(188,140,255,.2)', borderRadius: 6, fontSize: 11 } }, [
          Ic({ n: 'map', size: 11, color: '#c084fc' }),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, '属于'),
          h('a', { href: '#', onClick: function (e) { e.preventDefault(); setActiveMap(st, parentMap.number) }, style: { color: '#c084fc', textDecoration: 'underline', fontWeight: 600 } }, '#' + parentMap.number + ' ' + parentMap.title),
        ]) : null,
        // body
        h('div', { style: { padding: '8px 0', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)' } }, [
          h('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginBottom: 4 } }, '描述'),
          (body && String(body).trim())
            ? h('div', { style: { fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-primary,#e6edf3)' } }, (typeof mdToHtml === 'function' ? mdToHtml(body) : String(body)))
            : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, '无描述'),
        ]),
        // sub-issues
        subNodes.length || subTotal ? h('div', { style: { padding: '6px 0' } }, [
          h('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginBottom: 6 } }, '子票 ' + subTotal + (subNodes.length ? '' : '（无加载）')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, subNodes.map(function (s) {
            const sc = s.state === 'CLOSED' ? '#3fb950' : '#8b8b95'
            return h('div', { key: s.number, className: 'dsws-aggrow', onClick: function () { setActiveIssue(st, s.number) }, style: { cursor: 'pointer', padding: '6px 8px' } }, [
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
                h('span', { className: 'dsws-idnum', style: { color: sc, borderColor: sc, fontSize: 11 } }, '#' + s.number),
                h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, s.title)]) }, h('span', { className: 'dsws-tt-wrap', style: { flex: 1, fontSize: 12 } }, s.title)),
                h('span', { className: 'dsws-chip', style: { fontSize: 10, background: s.state === 'CLOSED' ? 'rgba(63,185,80,.12)' : 'rgba(139,148,158,.12)', color: sc, border: '1px solid ' + sc } }, s.state === 'CLOSED' ? '已关闭' : 'Open'),
              ])
            ])
          })),
        ]) : null,
        // blockers
        blockedNodes.length ? h('div', { style: { padding: '6px 0' } }, [
          h('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginBottom: 6 } }, '被阻塞 · ' + blockedNodes.length),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, blockedNodes.map(function (b) {
            return h('div', { key: b.number, className: 'dsws-aggrow', onClick: function () { setActiveIssue(st, b.number) }, style: { cursor: 'pointer', padding: '6px 8px' } }, [
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
                Ic({ n: 'lock', size: 10, color: '#f0883e' }),
                h('span', { className: 'dsws-idnum', style: { color: '#f0883e', borderColor: '#f0883e', fontSize: 11 } }, '#' + b.number),
                h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, b.title || ('#' + b.number))]) }, h('span', { style: { flex: 1, fontSize: 12 } }, b.title || ('#' + b.number))),
              ])
            ])
          })),
        ]) : null,
        // comments
        h('div', { style: { padding: '8px 0 4px' } }, [
          h('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginBottom: 6 } }, '评论 ' + (commentsNodes.length ? '(' + commentsNodes.length + ')' : '(0)') + (mode === 'loading' && !detail ? ' · 加载中' : '')),
          commentsNodes.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, commentsNodes.slice(0,50).map(function (c, i) {
            const login = c.author && c.author.login || 'ghost'
            const t = c.createdAt ? String(c.createdAt).slice(0,10) : ''
            const itemCls = (typeof confirmedIdx === 'number' && confirmedIdx === i) ? ' dsws-row-added' : ''
            return h('div', { key: i, className: 'dsws-cmt-item' + itemCls, style: { padding: '6px 8px', background: 'rgba(255,255,255,.02)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 6 } }, [
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, [
                Ic({ n: 'person', size: 10 }),
                h('span', { style: { fontWeight: 600, color: '#58a6ff' } }, '@' + login),
                c.authorAssociation ? h('span', { className: 'dsws-chip', style: { fontSize: 9, padding: '0 4px', background: 'rgba(88,166,255,.08)', color: '#8b8b95', border: '1px solid rgba(88,166,255,.2)' } }, c.authorAssociation) : null,
                h('span', { style: { flex: 1 } }),
                h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, t),
              ]),
              h('div', { style: { fontSize: 12, lineHeight: 1.5 } }, (typeof mdToHtml === 'function' ? mdToHtml(c.body || '') : (c.body || ''))),
            ])
          })) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '8px', background: 'rgba(255,255,255,.03)', borderRadius: 6, border: '1px dashed rgba(255,255,255,.1)' } }, mode === 'loading' && !detail ? '加载中…' : '无评论'),
          // 加载下 50 按钮（T5 反向分页 cursor，节流 600ms，失败重试与 3 次兜底）
          commentsNodes.length ? (function(){
            const fail = st.issueCommentsFailCount || 0
            if (fail >= 3) {
              return h('div', { style: { marginTop: 8, padding: '8px 10px', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.2)', borderRadius: 6, fontSize: 11, color: '#f87171', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' } }, [
                Ic({ n: 'alert', size: 11 }),
                h('span', null, '以下评论未加载，'),
                h('a', { href: issueUrlFor(st, issueNumber), target: '_blank', rel: 'noreferrer', style: { color: '#58a6ff', textDecoration: 'underline' } }, tr('detail.viewOnTrackerHint')),
              ])
            }
            const hasMore = (src.comments && src.comments.pageInfo) ? src.comments.pageInfo.hasNextPage : commentsNodes.length >= 50
            if (!hasMore && fail===0) return null
            const label = st.issueCommentsMoreLoading ? '加载中' : (fail>0 ? '重试' : '加载下 50')
            return h('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 8 } }, [
              h('button', {
                className: 'dsws-btn' + (st.issueCommentsMoreLoading ? ' loading' : ''),
                disabled: !!st.issueCommentsMoreLoading,
                onClick: function () {
                  if (st.issueCommentsMoreLoading) return
                  // 节流：600ms 内禁用由 st.issueCommentsMoreLoading 保障，api 侧同样节流
                  const after = (src.comments && src.comments.pageInfo && src.comments.pageInfo.endCursor) ? src.comments.pageInfo.endCursor : String(commentsNodes.length)
                  if (typeof fetchIssueComments === 'function') fetchIssueComments(st, issueNumber, after)
                  else { st.issueCommentsMoreLoading = true; emit(st); setTimeout(function(){ st.issueCommentsMoreLoading=false; emit(st); },600) }
                },
                style: { padding: '2px 10px', fontSize: 11, opacity: st.issueCommentsMoreLoading ? 0.5 : 1 }
              }, label),
              fail>0 && fail<3 ? h(Tip, { content: '加载失败，可重试' }, h('span', { style: { fontSize: 11, color: '#8b8b95', cursor: 'help' } }, 'ⓘ')) : null,
            ])
          })() : null,
          // 超 50 的静默提示（T5 前占位，T5 后由 hasMore 驱动）
          commentsNodes.length > 50 ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', textAlign: 'center', marginTop: 6 } }, '已显示 ' + Math.min(50, commentsNodes.length) + '/' + commentsNodes.length + (st.issueCommentsHasMore===false ? ' · 已加载全部' : ' · 可加载更多')) : null,
        ]),
        // #255 评论输入区：位于评论列表后、原只读提示处；MISSING 不渲染、EMPTY 渲染（零分支判据见谓词）。
        canComment ? h('div', { style: { padding: '2px 0 6px' } }, [
          st.cmtError ? h('div', { style: { marginBottom: 6, padding: '7px 9px', borderRadius: 6, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            background: st.cmtError.kind === 'rate-limit' ? 'rgba(245,158,11,.08)' : 'rgba(248,113,113,.08)',
            border: st.cmtError.kind === 'rate-limit' ? '1px solid rgba(245,158,11,.3)' : '1px solid rgba(248,113,113,.25)',
            color: st.cmtError.kind === 'rate-limit' ? '#f59e0b' : '#f87171' } }, [
            Ic({ n: 'alert', size: 11 }),
            h('span', null, cmtErrTextOf(st.cmtError)),
            st.cmtError.kind === 'auth' ? h('a', { href: issueUrlFor(st, issueNumber), target: '_blank', rel: 'noreferrer', style: { color: '#58a6ff', textDecoration: 'underline' } }, tr('detail.authFailCta')) : null,
          ]) : null,
          h('textarea', {
            value: st.cmtDraft || '',
            placeholder: tr('detail.cmtPlaceholder'),
            disabled: !!st.cmtSending,
            rows: 3,
            onKeyDown: function (ev) {
              if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { try { ev.preventDefault() } catch (ePd) {} doSubmit() }
            },
            onChange: function (ev) { st.cmtDraft = ev.target.value; emit(st) },
            style: { width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 56, fontSize: 12, lineHeight: 1.5, padding: '7px 9px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: 'rgba(255,255,255,.03)', color: 'var(--dsw-alias-label-primary,#e6edf3)', outline: 'none' },
          }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 } }, [
            h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, 'Markdown · ⌘+Enter / Ctrl+Enter 发送'),
            h('span', { style: { flex: 1 } }),
            h(Tip, { content: (st.cmtSending ? tr('tip.sendingComment') : tr('tip.sendComment')) }, h('button', {
              className: 'dsws-btn primary',
              disabled: !(st.cmtDraft || '').trim() || !!st.cmtSending,
              onClick: function () { doSubmit() },
              style: { padding: '2px 12px', fontSize: 11, opacity: (!(st.cmtDraft || '').trim() || !!st.cmtSending) ? 0.5 : 1 }
            }, st.cmtSending ? tr('detail.cmtSending') : tr('detail.cmtSend'))),
          ]),
        ]) : null,
        // 底部动作
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } }, [
          primaryBtn,
          h('span', { style: { flex: 1 } }),
          !canComment ? h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tr('detail.readOnlyHint')) : null,
        ]),
      ])
    }