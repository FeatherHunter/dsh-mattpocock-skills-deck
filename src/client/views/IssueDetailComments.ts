// views/IssueDetailComments.ts — Issue 详情评论区（从 IssueDetail.js 拆出，V3 #463，纯结构、行为零变化）
// 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
// src/client/index.ts 的 leaf 标记处（源码树里只有这一份真源，标记 id 与本文件名一致）。
// 以后谁改它：改评论提交、评论列表、加载更多按钮、输入框的人改它。
// 接线：IssueDetail.js 的评论分组处调 renderIssueDetailComments，返回数组直接做分组子节点（此前是字面数组，原样）；
//   确认下标、错误文案、提交动作内聚在本函数里，主文件只留显隐谓词（底部动作也要读它）。
// 参数：h = 创建函数；st = 详情 store；detail = 详情自己那次取数（**评论一律以它为准**，见 #693）；
//   mode/commentsNodes/canComment = 派生（调用方传入）。
// #693 起，这里不再收「快照那一行」：那一行只是轻量预览，可能不带评论，
//   它的分页游标也只有详情带回来的那一份才有。
// 本文件由 .js 转来（转时只加类型标注与环境声明，行为一字不动）。
declare function submitIssueComment(...args: any[]): any;
declare function fetchIssueDetail(...args: any[]): any;
declare function fetchIssueComments(...args: any[]): any;
declare function probeNow(...args: any[]): any;
declare function mdToHtml(...args: any[]): any;
declare function idOfParts(...args: any[]): any;
declare function issueUrlFor(...args: any[]): any;
declare function openIssueUrl(...args: any[]): any;
declare function Ic(props?: any): any;
declare const Tip: any;
// 评论结果提示（成功打勾 / 失败打叉）在按钮上的停留时间（毫秒）。
// 数值写在 config/ttl.yaml 的 commentResultFlashMs，构建时由生成器变成常量拼进界面闭包；
// 这里的 declare 只是让 TypeScript 知道这个名字存在。
declare const COMMENT_RESULT_FLASH_MS: number;
// 「加载更多」至少转这么久（毫秒）才允许收起加载态：太快闪过反而像根本没加载。
// 数值写在 config/ttl.yaml 的 commentsMoreLoadingMinMs，构建时由生成器变成常量拼进界面闭包；
// 这里的 declare 只是让 TypeScript 知道这个名字存在。
declare const COMMENTS_MORE_LOADING_MIN_MS: number;
export const renderIssueDetailComments = function (h: any, st: any, issueNumber: any, detail: any, mode: any, commentsNodes: any, canComment: any, issueEffort: any): any {
      // 评论一页取多少条：只在这里写一次。切片、判「还有更多」、算「已显示多少」、以及
      //   「加载下 {count}」里的数字（config/copy/flow.yaml 的 detail.commentsMore）都用它。
      // 注意宿主取数那一半（src/refresh/rooms/host/comment-thread-fetch.ts 的 per_page=50 与按 50 算的页码）是另一份页大小，
      //   客户端显示拿不到它，两半之间没有编译器能校验的连线；改这里要同时确认宿主页大小，否则文案与实际条数会对不上。
      //   声明必须在函数体内：tests/verify-693-detail-fallback-honesty.ts 只把本函数的源码抠出来单独求值。
      const COMMENTS_PAGE_SIZE = 50
      const _eff = (issueEffort === undefined || issueEffort === null) ? '' : String(issueEffort)
      // #255 提交确认闪烁下标：仅当 force 重取后的评论里真实存在 body 全等匹配项才点亮
      // （新评论必须来自服务端重取的证据；定时清空归位，无乐观假设）
      let confirmedIdx = -1
      if (st.cmtConfirm && st.cmtConfirm.body) {
        const __cb = String(st.cmtConfirm.body)
        const __cap = Math.min(commentsNodes.length, COMMENTS_PAGE_SIZE)
        for (let __ci = __cap - 1; __ci >= 0; __ci--) {
          if (String(commentsNodes[__ci] && commentsNodes[__ci].body || '') === __cb) { confirmedIdx = __ci; break }
        }
      }
      const cmtErrTextOf = function (er: any) {
        const k = er && er.kind || ''
        if (k === 'auth') return tr('detail.cmtAuthFail')
        if (k === 'rate-limit') return tr('detail.cmtRateLimit')
        return tr('detail.cmtGeneric', { msg: String((er && er.message) || '').slice(0, 120) })
      }
      // #951：发送落定后的按钮样子（成功对勾加绿闪 1.5 秒自退，失败叉号加红闪抖动留到下一次操作）
      const cmtRes = (!st.cmtSending && st.cmtResult) ? st.cmtResult.kind : ''
      const doSubmit = function () {
        if (st.cmtSending) return
        const text = String(st.cmtDraft || '').trim()
        if (!text) return
        if (typeof submitIssueComment !== 'function') { st.cmtError = { kind: 'env' }; emit(st); return }
        st.cmtSending = true; st.cmtError = null; st.cmtResult = null; emit(st)
        const startedAt = Date.now()
        submitIssueComment(st, issueNumber, text, { effortId: _eff }).then(function (res: any) {
          st.cmtSending = false
          if (!res || res.ok !== true) {
            st.cmtError = (res && res.error) || { kind: 'network' }
            st.cmtResult = { kind: 'fail', at: Date.now() }
            emit(st)
            return
          }
          // 推进序列（无乐观假设）：清空输入 → 击穿详情缓存 force 重取（唯一推进源=重求值）
          // → probeNow 静默快照刷新（右侧列表行闪烁由 diff 真实产出）
          st.cmtDraft = ''
          st.cmtError = null
          st.cmtConfirm = { body: text, at: startedAt }
          st.cmtResult = { kind: 'ok', at: startedAt }
          emit(st)
          // 评论结果提示的停留时间：成功后绿闪亮这么久自己退掉；失败的红闪由上面那句注释说的规矩留着不动。
          try { setTimeout(function () { if (st.cmtResult && st.cmtResult.kind === 'ok' && st.cmtResult.at === startedAt) { st.cmtResult = null; try { emit(st) } catch (eR) {} } }, COMMENT_RESULT_FLASH_MS) } catch (eT) {}
          if (typeof fetchIssueDetail === 'function') fetchIssueDetail(st, issueNumber, { force: true, effortId: _eff })
          try { if (typeof probeNow === 'function') probeNow(false) } catch (ePn) {}
        }).catch(function (eSub: any) {
          st.cmtSending = false
          st.cmtError = { kind: 'network', message: String((eSub && eSub.message) || eSub) }
          st.cmtResult = { kind: 'fail', at: Date.now() }
          emit(st)
        })
      }
      return [
        // #693：详情还没回来时不许报「评论 (0)」—— 那是把「还没拿到」说成「没有」。
        h('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginBottom: 6 } }, detail
          ? '评论 ' + (commentsNodes.length ? '(' + commentsNodes.length + ')' : '(0)')
          : '评论 · ' + (mode === 'err' ? tr('detail.notYet') : tr('list.loading'))),
        commentsNodes.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, commentsNodes.slice(0, COMMENTS_PAGE_SIZE).map(function (c: any, i: any) {
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
            h('div', { style: { fontSize: 12, lineHeight: 1.5 } }, (typeof mdToHtml === 'function' ? mdToHtml(c.body || '', { st: st }) : (c.body || ''))),
          ])
        })) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '8px', background: 'rgba(255,255,255,.03)', borderRadius: 6, border: '1px dashed rgba(255,255,255,.1)' } }, detail
          ? tr('detail.noComments')
          : (mode === 'loading' ? tr('list.loading') : tr('detail.notYet'))),
        // 加载更多按钮（T5 反向分页 cursor，节流 600ms，失败重试与 3 次兜底）
        commentsNodes.length ? (function(){
          const fail = st.issueCommentsFailCount || 0
          if (fail >= 3) {
            return h('div', { style: { marginTop: 8, padding: '8px 10px', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.2)', borderRadius: 6, fontSize: 11, color: '#f87171', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' } }, [
              Ic({ n: 'alert', size: 11 }),
              h('span', null, tr('detail.commentsNotLoaded')),
                    // 本地票的 url 是文件路径不是网址：https 走新页，本地走宿主打开（裸 href 点了没反应，#1145）
      (function () {
        const _u: any = issueUrlFor(st, issueNumber, _eff)
        const _isHttp = /^https?:\/\//i.test(String(_u || ''))
        const _openLocal = function (e: any) { e.stopPropagation(); openIssueUrl(st, issueNumber, (typeof host !== 'undefined' ? host : undefined), _eff) }
        const _textStyle = { color: '#58a6ff', textDecoration: 'underline' }
        // 本次界面反馈需求：评论没加载出来时，这个链接是用户唯一的出路，附近没有带 data-log 的祖先，
        //   不接就完全没有日志；https 与本地两条分支各带一个定位串。
        return _isHttp
          ? h('a', { href: _u, target: '_blank', rel: 'noreferrer', className: 'dsws-hov', 'data-press': 'link', 'data-log': 'detail.cmt.tracker', style: _textStyle }, tr('detail.viewOnTrackerHint'))
          : h('button', { type: 'button', onClick: _openLocal, className: 'dsws-hov', 'data-press': 'button', 'data-log': 'detail.cmt.tracker.local', style: Object.assign({ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'inherit' }, _textStyle) }, tr('detail.viewOnTrackerHint'))
      })(),
            ])
          }
          const hasMore = (detail.comments && detail.comments.pageInfo) ? detail.comments.pageInfo.hasNextPage : commentsNodes.length >= COMMENTS_PAGE_SIZE
          if (!hasMore && fail===0) return null
          const label = st.issueCommentsMoreLoading ? tr('detail.commentsLoading') : (fail>0 ? tr('pr.retry') : tr('detail.commentsMore', { count: COMMENTS_PAGE_SIZE }))
          return h('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 8 } }, [
            h('button', {
              // #952：分页加载中用呼吸备用（无转圈的文字按钮，永不与转圈同开）。
              // 本次界面反馈需求：「加载下 50 / 重试」带按压态、悬停反馈与自己的点击日志。
              className: 'dsws-btn' + (st.issueCommentsMoreLoading ? ' loading dsws-fb-breath' : '') + ' dsws-hov',
              'data-press': 'button',
              'data-log': 'detail.cmt.more',
              disabled: !!st.issueCommentsMoreLoading,
              onClick: function () {
                if (st.issueCommentsMoreLoading) return
                // 节流：600ms 内禁用由 st.issueCommentsMoreLoading 保障，api 侧同样节流
                const after = (detail.comments && detail.comments.pageInfo && detail.comments.pageInfo.endCursor) ? detail.comments.pageInfo.endCursor : String(commentsNodes.length)
                if (typeof fetchIssueComments === 'function') fetchIssueComments(st, issueNumber, after, { effortId: _eff })
                // 「加载更多」至少转这么久的兜底：这条分支没有真的去取数（取数通路不在），
                // 转圈也要停够时间再收，否则一闪而过，人以为自己没点着。
                else { st.issueCommentsMoreLoading = true; emit(st); setTimeout(function(){ st.issueCommentsMoreLoading=false; emit(st); },COMMENTS_MORE_LOADING_MIN_MS) }
              },
              style: { padding: '2px 10px', fontSize: 11, opacity: st.issueCommentsMoreLoading ? 0.5 : 1 }
            }, label),
            fail>0 && fail<3 ? h(Tip, { content: tr('detail.commentsLoadFailed') }, h('span', { style: { fontSize: 11, color: '#8b8b95', cursor: 'help' } }, 'ⓘ')) : null,
          ])
        })() : null,
        // 超一页的静默提示（T5 前占位，T5 后由 hasMore 驱动）
        commentsNodes.length > COMMENTS_PAGE_SIZE ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', textAlign: 'center', marginTop: 6 } }, st.issueCommentsHasMore===false
          ? tr('detail.commentsShownAll', { shown: Math.min(COMMENTS_PAGE_SIZE, commentsNodes.length), total: commentsNodes.length })
          : tr('detail.commentsShownMore', { shown: Math.min(COMMENTS_PAGE_SIZE, commentsNodes.length), total: commentsNodes.length })) : null,
        // #255 评论输入区：位于评论列表后、原只读提示处；MISSING 不渲染、EMPTY 渲染（零分支判据见谓词）。
        canComment ? h('div', { style: { padding: '2px 0 6px' } }, [
          st.cmtError ? h('div', { style: { marginBottom: 6, padding: '7px 9px', borderRadius: 6, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            background: st.cmtError.kind === 'rate-limit' ? 'rgba(245,158,11,.08)' : 'rgba(248,113,113,.08)',
            border: st.cmtError.kind === 'rate-limit' ? '1px solid rgba(245,158,11,.3)' : '1px solid rgba(248,113,113,.25)',
            color: st.cmtError.kind === 'rate-limit' ? '#f59e0b' : '#f87171' } }, [
            Ic({ n: 'alert', size: 11 }),
            h('span', null, cmtErrTextOf(st.cmtError)),
                  // 本地票的 url 是文件路径不是网址：https 走新页，本地走宿主打开（裸 href 点了没反应，#1145）
      st.cmtError.kind === 'auth' ? (function () {
        const _u: any = issueUrlFor(st, issueNumber, _eff)
        const _isHttp = /^https?:\/\//i.test(String(_u || ''))
        const _openLocal = function (e: any) { e.stopPropagation(); openIssueUrl(st, issueNumber, (typeof host !== 'undefined' ? host : undefined), _eff) }
        const _textStyle = { color: '#58a6ff', textDecoration: 'underline' }
        // 本次界面反馈需求：授权失败时的这个入口带按压态、悬停反馈与点击日志；https 与本地两条分支各带一个定位串。
        return _isHttp
          ? h('a', { href: _u, target: '_blank', rel: 'noreferrer', className: 'dsws-hov', 'data-press': 'link', 'data-log': 'detail.cmt.authlink', style: _textStyle }, tr('detail.authFailCta'))
          : h('button', { type: 'button', onClick: _openLocal, className: 'dsws-hov', 'data-press': 'button', 'data-log': 'detail.cmt.authlink.local', style: Object.assign({ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'inherit' }, _textStyle) }, tr('detail.authFailCta'))
      })() : null,
          ]) : null,
          h('textarea', {
            value: st.cmtDraft || '',
            placeholder: tr('detail.cmtPlaceholder'),
            disabled: !!st.cmtSending,
            rows: 3,
            onKeyDown: function (ev: any) {
              if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { try { ev.preventDefault() } catch (ePd) {} doSubmit() }
            },
            onChange: function (ev: any) { st.cmtDraft = ev.target.value; st.cmtResult = null; emit(st) },
            style: { width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 56, fontSize: 12, lineHeight: 1.5, padding: '7px 9px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: 'rgba(255,255,255,.03)', color: 'var(--dsw-alias-label-primary,#e6edf3)' }, // 焦点环走全局宿主环（#1387 第五条）：行内隐藏会盖住键盘焦点，删掉后落到宿主蓝内环。
          }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 } }, [
            h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, 'Markdown · ⌘+Enter / Ctrl+Enter 发送'),
            h('span', { style: { flex: 1 } }),
            h(Tip, { content: (st.cmtSending ? tr('tip.sendingComment') : tr('tip.sendComment')) }, h('button', {
              className: 'dsws-btn primary' + (st.cmtSending ? ' dsws-fb-busy' : '') + (cmtRes === 'ok' ? ' dsws-fb-okflash' : '') + (cmtRes === 'fail' ? ' dsws-fb-errflash dsws-fb-shake' : ''), 'data-press': 'button', 'data-log': 'issue.comment.send',
              disabled: !(st.cmtDraft || '').trim() || !!st.cmtSending,
              onClick: function () { doSubmit() },
              style: { padding: '2px 12px', fontSize: 11, opacity: (!(st.cmtDraft || '').trim() || !!st.cmtSending) ? 0.5 : 1, cursor: ((!(st.cmtDraft || '').trim() || !!st.cmtSending) ? 'not-allowed' : 'pointer') }
            }, st.cmtSending ? [h('span', { className: 'fb-t', 'aria-hidden': 'true' }, tr('detail.cmtSending')), h('span', { className: 'fb-spin', 'aria-hidden': 'true' }, h('span', { className: 'dsws-spinner', style: { width: 11, height: 11, borderWidth: 2 } }))] : (cmtRes === 'ok' ? Ic({ n: 'check', size: 11 }) : (cmtRes === 'fail' ? Ic({ n: 'x', size: 11 }) : tr('detail.cmtSend'))))),
          ]),
        ]) : null,
      ]
}
