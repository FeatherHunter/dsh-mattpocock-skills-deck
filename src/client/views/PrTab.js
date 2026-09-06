/**
 * views/PrTab.js — 拉取请求独立页签内容区（#506 前端房，首版只读加评论查看）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
 * 数据：快照组装全留，过滤归前端（prIssuesOf 只收 isPullRequest 为真的票）。
 * 门控：页签显隐由 prTabVisible 驱动（只读能力位，不写后端名字）；无能力回列表由容器侧回退。
 * 列表过滤器接线（#506 小修：消除登记未接线）：本列表以 prFilterForList() 为过滤依据（见下方接线点），
 * 后端直调示例：listIssues({ refId: 'owner/name' }, prFilterForList(), ctx)，即只取拉取请求；
 * 后端 github 房已按该字段过滤，contract.js 的 ListFilter 同票登记该字段（界面过滤分界内）。
 * 详情链路（Overlay 端已核）：悬浮面板 Overlay 本来就没有详情分支，点行后详情走别层——
 * 右侧停靠 Dock 按 activeIssue 渲染 IssueDetail（与主列表同一机制），本页点行只调 setActiveIssue；#507 再验。
 * 同号留痕：activeIssue 是裸数字，同号的普通工单与拉取请求进同一个详情，评审合并展示留后续；#507 验。
 * 评论只读：拉取请求详情只看评论列表，不给输入框（IssueDetail.js 内把 canComment 对拉取请求置假）；首版如此。
 * 日志：复用既有快照链路，无新增跨边界调用与缓存与定时器，故无新增日志点，附录不动。
 * 首版范围：列表显标题与作者与状态与标签与更新五个字段；点行进详情基础加评论查看（复用 IssueDetail）。
 */
export const PrTab = function (props) {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = props.st
  // 接线点：过滤依据取自 prFilterForList（与后端 listIssues 的 ListFilter 同形，调用示例见文件头注释）。
  const listFilter = (typeof prFilterForList === 'function') ? prFilterForList() : { isPullRequest: true }
  const onlyPr = !(listFilter && listFilter.isPullRequest === false)
  const candidates = (typeof prIssuesOf === 'function') ? prIssuesOf(st) : []
  const prs = onlyPr ? candidates.filter(function (x) { return x && x.isPullRequest === true }) : candidates
  const doRetry = function () { if (typeof loadSnapshot === 'function') loadSnapshot(st, true) }
  const openPr = function (x) {
    var n = (x && x.number != null) ? x.number : (x && x.key != null ? Number(x.key) : null)
    if (typeof setActiveIssue === 'function') setActiveIssue(st, n)
  }
  if (st.snapMode === 'loading' && !st.snapshot) {
    return h('div', { style: { padding: '24px 0', textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 12 } }, [
      h('div', { className: 'dsws-spinner', style: { width: 14, height: 14, border: '2px solid rgba(255,255,255,.15)', borderTopColor: '#c084fc', borderRadius: '50%', animation: 'dsws-spin 1s linear infinite', margin: '0 auto 8px' } }),
      h('span', null, tr('list.loading')),
    ])
  }
  if (st.snapMode === 'err' && !st.snapshot) {
    return h('div', null, [
      h('div', { style: { padding: '26px 16px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 13, border: '1px dashed var(--dsw-alias-border-l2,#3a3f4a)', borderRadius: 10 } }, [
        h('div', { style: { fontSize: 14, color: '#f87171', fontWeight: 700, marginBottom: 4 } }, tr('pr.loadFail')),
        h('div', { style: { marginTop: 8 } }, [
          h('button', { className: 'dsws-btn', onClick: doRetry, style: { padding: '2px 10px', fontSize: 11 } }, tr('pr.retry')),
        ]),
      ]),
    ])
  }
  if (!prs.length) {
    return h('div', { style: { padding: '26px 16px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 13, border: '1px dashed var(--dsw-alias-border-l2,#3a3f4a)', borderRadius: 10 } }, [
      h('div', { style: { fontSize: 14, color: 'var(--dsw-alias-label-primary,#e6edf3)', fontWeight: 700, marginBottom: 4 } }, tr('pr.empty')),
    ])
  }
  const sorted = prs.slice().sort(function (a, b) {
    var au = String(a.updatedAt || '')
    var bu = String(b.updatedAt || '')
    if (au !== bu) return au < bu ? 1 : -1
    return Number(a.number || a.key || 0) - Number(b.number || b.key || 0)
  })
  const colorOf = (typeof buildColorOf === 'function') ? buildColorOf(st) : {}
  return h('div', null, sorted.map(function (x) {
    var key = (x.key != null ? x.key : x.number)
    var isOpen = String(x.state || '').toUpperCase() !== 'CLOSED'
    var login = (x.author && x.author.login) ? String(x.author.login) : ''
    var labels = Array.isArray(x.labels) ? x.labels : []
    var upd = x.updatedAt ? String(x.updatedAt).slice(0, 10) : ''
    return h('div', { key: String(key), className: 'dsws-aggrow', onClick: function () { openPr(x) }, style: { cursor: 'pointer' } }, [
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, width: '100%' } }, [
        h('span', { className: 'dsws-idnum', style: { color: isOpen ? '#3fb950' : '#8b949e', borderColor: isOpen ? '#3fb950' : '#8b949e' } }, '#' + String(key)),
        h('span', { className: 'dsws-tt-wrap', style: { flex: 1, minWidth: 0, fontWeight: 600 } }, String(x.title || ('#' + String(key)))),
        h('span', { className: 'dsws-chip', style: { fontSize: 10, flex: 'none', background: isOpen ? 'rgba(63,185,80,.15)' : 'rgba(139,148,158,.15)', color: isOpen ? '#3fb950' : '#8b949e', border: '1px solid ' + (isOpen ? '#3fb950' : '#8b949e') } }, isOpen ? tr('list.state.open') : tr('list.state.closed')),
      ]),
      h('div', { style: { marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, [
        login ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3 } }, [Ic({ n: 'person', size: 10 }), h('span', null, '@' + login)]) : null,
        labels.map(function (l, i) {
          var nm = (l && l.name) ? String(l.name) : ''
          var col = (l && l.color) ? String(l.color) : ''
          var cc = colorOf[nm] || col.replace(/^#/, '')
          return h('span', { key: i, className: 'dsws-chip', style: { fontSize: 10, background: (typeof hexA === 'function' ? hexA(cc, 0.18) : null) || 'rgba(188,140,255,.16)', color: cc ? '#' + cc : '#bc8cff', border: '1px solid ' + ((typeof darken === 'function' ? darken(cc, 0.16) : null) || 'rgba(188,140,255,.6)') } }, nm)
        }),
        upd ? h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, upd) : null,
      ]),
    ])
  }))
}
