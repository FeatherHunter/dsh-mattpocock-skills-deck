/**
 * views/MapDetailTop.js — 地图详情顶部操作行（#807 从 MapDetail.js 拆出）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，与 MapDetailHead.js 同模式）。
 * 为什么单独拆一份：MapDetail.js 贴着仓库 350 行的上限，顶栏这次要加折叠标记、
 * 右侧归组、新会话实心、复制与外链两颗图标，直接改会顶穿上限。
 *
 * 与 IssueDetail.js #763 同口径：单行不换行、越窄越收、只剩图标、不放省略号；
 * 图标永不消失；看不见的字直接裁掉，不补省略号；完整串留悬停。
 * 五串字（折叠机按此顺序让位）：返回按钮的字、面包屑、地图片的 wayfinder:map
 * （复用折叠机的 snapshot 槽，与工单页快照提示同位）、主动作按钮的字、新会话按钮的字。
 * 复制与外链是纯图标按钮，无字可折，不进阶梯。
 */
export const MapDetailTop = ({ st, m, navCrumb, effStats, goBack }) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const mEffort = (function () { try { return effortOf(m) } catch (e) { return '' } })()
  // #763 顶栏折叠机（与 IssueDetail.js 同一台；读顶栏 DOM 上的 data-detail-* 标记逐字收字）
  const topBarRef = useIssueDetailFold(st, m.number, mEffort)
  const isEmpty = !!(effStats && effStats.total === 0)
  const isDone = !!(effStats && effStats.total > 0 && effStats.closed === effStats.total)
  // 新会话与主动作同色实心：检查态橙、完成态绿、执行态走默认 primary（与主按钮一致）
  const newBg = isEmpty ? '#f59e0b' : isDone ? '#3fb950' : null
  const newColor = isEmpty ? '#140a1e' : isDone ? '#0c1a10' : null
  const newStyle = { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', borderColor: 'transparent' }
  if (newBg) { newStyle.background = newBg; newStyle.color = newColor; newStyle.fontWeight = 600 }
  const copyUrl = function (e) {
    if (e && e.stopPropagation) e.stopPropagation()
    try { copyText(st, issueUrlFor(st, m.number, mEffort), tr('toast.copiedLink', { n: m.number })) } catch (err) {}
  }
  const openUrl = (typeof issueUrlFor === 'function') ? (function () { try { return issueUrlFor(st, m.number, mEffort) } catch (err) { return '' } })() : ''
  const openIsHttp = /^https?:\/\//i.test(String(openUrl || ''))
  const openWeb = function (e) {
    if (e && e.stopPropagation) e.stopPropagation()
    const u = (typeof issueUrlFor === 'function') ? (function () { try { return issueUrlFor(st, m.number, mEffort) } catch (err2) { return '' } })() : ''
    if (!u) return
    if (/^https?:\/\//i.test(String(u))) { try { window.open(u, '_blank', 'noreferrer') } catch (err3) {} }
    else { try { if (typeof host !== 'undefined' && host.call) host.call('wf.openPath', { path: u }) } catch (err4) {} }
  }
  const primaryBtn = (effStats && effStats.total === 0)
    ? h(Tip, { content: tr('map.inspectTitle') }, h('button', { className: 'dsws-btn primary', onClick: function () {
        let t2 = ''
        try { t2 = inspectPrompt(st, m.number, m.title) } catch (e) { try { t2 = promptTextFor(st, 'mapInspect', { n: String(m.number || ''), ['title']: String(m.title || ''), url: issueUrlFor(st, m.number) }); if (t2) t2 = '/wayfinder ' + issueUrlFor(st, m.number) + '\n\n' + t2 } catch (_) { t2 = startText(st, m) } }
        inject(st, t2)
      }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, background: '#f59e0b', borderColor: 'transparent', color: '#140a1e', fontWeight: 600, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [
        Ic({ n: 'search', size: 10 }),
        h('span', { 'data-detail-primary-text': 1, 'data-full': tr('act.inspect'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('act.inspect')),
      ]))
    : (effStats && effStats.total > 0 && effStats.closed === effStats.total)
    ? h(Tip, { content: tr('map.doneTitle') }, h('button', { className: 'dsws-btn primary', onClick: function () {
        const text = completePrompt(st, m.number, m.title, effStats.total, effStats.closed)
        inject(st, text)
      }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 600, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [
        Ic({ n: 'check', size: 10 }),
        h('span', { 'data-detail-primary-text': 1, 'data-full': tr('act.done'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('act.done')),
      ]))
    : h(Tip, { content: tr('map.executeTitle') }, h('button', { className: 'dsws-btn primary', onClick: function () {
        inject(st, startText(st, m))
      }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [
        Ic({ n: 'play', size: 10 }),
        h('span', { 'data-detail-primary-text': 1, 'data-full': tr('act.execute'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('act.execute')),
      ]))
  return h('div', { ref: topBarRef, className: 'dsws-stickybar', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' } }, [
    // 返回按钮的悬停提示走 Tip（T2/T3 纪律），不再用原生 title
    h(Tip, { content: tr('list.back') }, h('button', { className: 'dsws-btn', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [
      Ic({ n: 'back', size: 12 }),
      h('span', { 'data-detail-back-text': 1, 'data-full': tr('list.back'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.back')),
    ])),
    h(Tip, { content: navCrumb }, h('span', { 'data-detail-crumb': 1, 'data-full': navCrumb, style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', whiteSpace: 'nowrap', flex: 'none', minWidth: 0, overflow: 'hidden' } }, navCrumb)),
    h(Tip, { content: 'wayfinder:map' }, h('span', { className: 'dsws-chip dsws-chip-m', style: { flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [
      Ic({ n: 'map', size: 11 }),
      h('span', { 'data-detail-snapshot': 1, 'data-full': 'wayfinder:map', style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, 'wayfinder:map'),
    ])),
    h('span', { style: { flex: 1, minWidth: 8 } }),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none', minWidth: 0, overflow: 'hidden', flexWrap: 'nowrap' } }, [
      primaryBtn,
      h(Tip, { content: tr('map.newSessionTitle') }, h('button', { className: 'dsws-btn primary', onClick: function (e) { e.stopPropagation(); openInNewSession(st, m) }, style: newStyle }, [
        Ic({ n: 'external-link', size: 10 }),
        h('span', { 'data-detail-new-text': 1, 'data-full': tr('list.newSessionLabel'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.newSessionLabel')),
      ])),
      h(Tip, { content: tr('tip.copyLink') }, h('button', { className: 'dsws-btn ghost', onClick: copyUrl, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'clipboard', size: 13 }))),
      openIsHttp
        ? h(Tip, { content: tr('tip.openInTracker', { n: m.number }) }, h('a', { className: 'dsws-btn ghost', href: openUrl, target: '_blank', rel: 'noreferrer', onClick: function (e) { e.stopPropagation() }, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' }, 'aria-label': tr('tip.openInTracker', { n: m.number }) }, Ic({ n: 'link', size: 13 })))
        : h(Tip, { content: tr('tip.openInTracker', { n: m.number }) }, h('button', { className: 'dsws-btn ghost', onClick: openWeb, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' }, 'aria-label': tr('tip.openInTracker', { n: m.number }) }, Ic({ n: 'link', size: 13 }))),
    ]),
  ])
}
