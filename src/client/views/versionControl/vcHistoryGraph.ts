// views/versionControl/vcHistoryGraph.ts —— 提交历史页的 13.14 图形化视图（#1829 阶段 3 从 vcHistory.ts 拆出）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 为什么单开一叶：vcHistory.ts 已到文件粒度上限（每个源文件 350 有效行），图形视图这块的数据与画法
//   与列表/详情互不依赖，拆出来以后三件事各占一份文件，谁再改哪一块都看得见边界。
// 车道规则：一行一笔提交，父提交连线落进车道；父提交不回本页或车道占满时不画连线，只报个数。
//   300 宽放不下车道，退化成一句说明（门禁 Y7b 认这个退化）。

declare const VC_HISTORY_LANES_MAX: number
declare function vcHistoryWidthOf(...args: any[]): any
declare function vcOneLine(...args: any[]): any
declare function vcShortOid(...args: any[]): any
// 图形化视图：每条提交画一行，父提交连线落进车道。车道上限 VC_HISTORY_LANES_MAX 条；
//   父提交不在这页里（下一页才读得到）或车道占满时，这条连线不画，并记进 hiddenLanes 如实报数。
export const vcHistoryGraphOf = function (commits: any) {
  const list = Array.isArray(commits) ? commits : []
  const inPage: Record<string, boolean> = {}
  for (let i = 0; i < list.length; i += 1) inPage[String((list[i] && list[i].oid) || '')] = true
  const cols: any[] = []
  for (let i = 0; i < VC_HISTORY_LANES_MAX; i += 1) cols.push(null)
  const freeColOf = function () {
    for (let i = 0; i < VC_HISTORY_LANES_MAX; i += 1) if (cols[i] === null) return i
    return -1
  }
  const colOf = function (oid: string) {
    for (let i = 0; i < VC_HISTORY_LANES_MAX; i += 1) if (cols[i] === oid) return i
    return -1
  }
  const rows: any[] = []
  let hiddenLanes = 0
  for (let r = 0; r < list.length; r += 1) {
    const c = list[r] || {}
    const oid = String(c.oid || '')
    let lane = colOf(oid)
    if (lane < 0) lane = freeColOf()
    if (lane < 0) { lane = VC_HISTORY_LANES_MAX - 1; hiddenLanes += 1 }
    cols[lane] = null
    const parentList = Array.isArray(c.parents) ? c.parents : []
    const edges: number[] = []
    for (let p = 0; p < parentList.length; p += 1) {
      const poid = String(parentList[p])
      // 父提交在这一页里没有对应行（还没读到）时，不画一条凭空断掉的线，只记一处没画。
      if (inPage[poid] !== true) { hiddenLanes += 1; continue }
      let at = colOf(poid)
      if (at < 0) {
        const target = p === 0 && cols[lane] === null ? lane : freeColOf()
        if (target >= 0) { at = target; cols[target] = poid } else hiddenLanes += 1
      }
      if (at >= 0) edges.push(at)
    }
    rows.push({
      oid: oid,
      short: String(c.short || vcShortOid(oid)),
      subject: String(c.subject || ''),
      author: String(c.author || ''),
      authorDateMs: c.authorDateMs,
      parents: parentList.slice(),
      edges: edges,
      lane: lane,
    })
  }
  return { rows: rows, hiddenLanes: hiddenLanes, lanes: VC_HISTORY_LANES_MAX, external: false }
}

// 13.14 图形化历史：一行一笔提交，车道号只决定左侧标记的次序；父提交不在本页或车道占满时
//   不画连线、只在下面报个数。300 宽放不下车道，退化成一句说明（门禁 Y7b 认这个退化）。
export const vcHistoryGraphNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const width = vcHistoryWidthOf(opts.width)
  const graph = opts.graph || { rows: [], hiddenLanes: 0 }
  const rows = Array.isArray(graph.rows) ? graph.rows : []
  const kids: any[] = [
    h('h4', { key: 'title', className: 'vcs-hist-graph-title' }, t('vc.shell.history.graphTitle')),
    h('p', { key: 'note', className: 'vcs-hist-graph-note' }, t('vc.shell.history.graphNote')),
  ]
  if (graph.hiddenLanes > 0) {
    kids.push(h('p', { key: 'capped', className: 'vcs-hist-graph-capped', 'data-vc-graph-lanes-capped': '1' }, t('vc.shell.history.graphCapped', { n: graph.hiddenLanes })))
  }
  if (width < 380) {
    kids.push(h('p', { key: 'narrow', className: 'vcs-hist-graph-narrow', 'data-vc-graph-narrow': '1' }, t('vc.shell.history.graphNarrow', { n: VC_HISTORY_LANES_MAX, m: rows.length })))
  } else {
    kids.push(h('ol', { key: 'rows', className: 'vcs-hist-graph-rows', role: 'list' }, rows.map(function (row: any) {
      const lane = Math.max(0, Math.min(VC_HISTORY_LANES_MAX - 1, Number(row.lane) || 0))
      return h('li', { key: String(row.oid || ''), className: 'vcs-hist-graph-row', 'data-vc-graph-row': String(row.oid || '') }, [
        h('span', { key: 'lane', className: 'vcs-hist-graph-lane', 'data-vc-graph-lane': String(lane) }, String(lane + 1)),
        h('span', { key: 'subject', className: 'vcs-hist-graph-subject' }, vcOneLine(String(row.subject || ''), 60)),
      ])
    })))
  }
  return h('section', {
    key: 'graph',
    className: 'vcs-hist-graph',
    'data-vc-graph': '1',
    'data-vc-graph-source': 'panel',
    role: 'img',
    'aria-label': t('vc.shell.history.graphLabel'),
  }, kids)
}
