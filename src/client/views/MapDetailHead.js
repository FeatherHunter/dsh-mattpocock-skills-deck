/**
 * views/MapDetailHead.js — 地图详情头部（#691 阶段 3 从 MapDetail.js 拆出：编号 + 标题 + 子票计数那一行）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js 的
 * `// ==== leaf:mapDetailHead (spliced by build) ====` 标记处（一源两物，与相邻叶子同模式）。
 * 为什么单独拆一份：MapDetail.js 本来就贴着仓库 350 行的上限，这一版要往头部加「本图 N 张子票」那一行，
 * 按仓库既有做法（头部拆出去）来做，不把一个文件顶穿。
 *
 * 子票那一行要把四种情形都说出来（不许静默）：
 *  - 正在取 / 取不到 / 已取回：三种状态各有各的话；取不到时给一颗「重试」与外链；
 *  - 取回后说清「本图 N 张子票（已关闭 M 张）」；
 *  - 撞到 1000 张硬上限 → 明说「只加载了前 1000 张」；
 *  - 拉到的张数与后端总数对不上 → 明说「还有 x 张没取到」。
 * 后端明确回「这条读路径我做不到」（unsupported）时**一个字都不加**：地图照旧画快照里那份行数据
 * （本地 Markdown 本来就读全、没有截断），这就是规格第 5.4 节的「按真实返回退化」，不做能力表（G5 红线）。
 */
export const MapDetailHead = ({ st, m, mt, multiEffort }) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const mode = (mt && mt.mode) || ''
  const stats = (mode === 'real' && mt.stats) ? mt.stats : (m.stats || null)
  const rows = (mode === 'real' && Array.isArray(mt.items)) ? mt.items : (m.tickets || [])
  const totalN = (stats && typeof stats.total === 'number') ? stats.total : rows.length
  const closedN = (stats && typeof stats.closed === 'number') ? stats.closed : 0
  const unsupported = (mode === 'err' && mt && mt.error && String(mt.error.kind) === 'unsupported')
  const failed = (mode === 'err' && !unsupported)
  const url = (typeof issueUrlFor === 'function') ? issueUrlFor(st, m.number, effortOf(m)) : ''
  const mapKey = (m.key != null) ? m.key : m.number
  const retry = function (e) { if (e && e.stopPropagation) e.stopPropagation(); if (typeof fetchMapTickets === 'function') fetchMapTickets(st, mapKey, { force: true, effortId: effortOf(m) }) }
  const openWeb = function (e) {
    if (e && e.stopPropagation) e.stopPropagation()
    if (!url) return
    if (/^https?:\/\//i.test(String(url))) { try { window.open(url, '_blank', 'noreferrer') } catch (err) {} }
    else { try { if (typeof host !== 'undefined' && host.call) host.call('wf.openPath', { path: url }) } catch (err) {} }
  }
  const line = (function () {
    if (mode === 'loading') return tr('map.subCountLoading')
    if (unsupported) return null
    if (failed) return tr('map.subCountFail', { msg: String((mt.error && mt.error.message) || '').slice(0, 120) })
    let s = tr('map.subCount', { n: totalN, c: closedN })
    if (mt && mt.capped) s += ' · ' + tr('map.subCountCapped', { n: 1000 })
    if (mt && mt.missing > 0) s += ' · ' + tr('map.subCountShort', { n: mt.missing })
    return s
  })()
  const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0 6px', fontSize: 10, flex: 'none' }
  return h('div', null, [
    // 编号徽章 + 标题（#691 由 MapDetail.js 原样移来，形态一字未改）
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: 2 } }, [
      h('span', { className: 'dsws-idnum', style: { color: '#c084fc', borderColor: '#c084fc', flex: 'none' } }, '#' + m.number),
      h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, m.title)]) }, h('div', { className: 'dsws-mtitle dsws-tt-wrap', style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 } }, [
        // effort 维度：地图属于哪个 effort 一眼可见（多个 effort 时同号地图不再分不清）
        (multiEffort && effortOf(m)) ? h(Tip, { content: effortOf(m) }, h('span', { className: 'dsws-chip dsws-eff', 'aria-label': effortOf(m), style: { fontSize: 10, lineHeight: 1.6, padding: '0 6px', flex: 'none', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'rgba(88,166,255,.14)', color: '#58a6ff', border: '1px solid rgba(88,166,255,.45)' } }, effortOf(m))) : null,
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, m.title),
      ])),
    ]),
    // 子票计数行（取数中 / 取不到 / 已取回三种话；被上限截断与对不上差额各补一句）
    line ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, [
      Ic({ n: failed ? 'alert' : 'map', size: 11, color: failed ? '#f87171' : undefined }),
      h('span', { style: { minWidth: 0 } }, line),
      failed ? h('button', { className: 'dsws-btn ghost', onClick: retry, style: ghostBtn }, tr('map.subCountRetry')) : null,
      (failed && url) ? h('button', { className: 'dsws-btn ghost', onClick: openWeb, style: ghostBtn }, tr('list.openInTrackerTitle', { n: m.number })) : null,
    ]) : null,
  ])
}
