// views/IssueDetailComments.js — Issue 详情评论区（从 IssueDetail.js 拆出，V3 #463，纯结构、行为零变化）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
// src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
// 以后谁改它：改评论提交、评论列表、加载下 50、输入框的人改它。
// 接线：IssueDetail.js 的评论分组处调 renderIssueDetailComments，返回数组直接做分组子节点（此前是字面数组，原样）；
//   确认下标、错误文案、提交动作内聚在本函数里，主文件只留显隐谓词（底部动作也要读它）。
// 参数：h = 创建函数；st = 详情 store；src = 快照或详情源；detail/mode/commentsNodes/canComment = 派生（调用方传入）。
export const renderIssueDetailComments = function (h, st, issueNumber, src, detail, mode, commentsNodes, canComment) {
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
      return [
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
      ]
}
