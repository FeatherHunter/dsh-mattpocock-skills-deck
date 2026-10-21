/**
 * views/subIssueRouting.ts — 子票与阻塞票点击的分流判定（从 IssueDetail.ts 原样抽出）。
 *
 * 为什么单独一片：详情页里「点这张子票/阻塞票该进地图详情还是工单详情」的判断要同时照顾
 * 节点自带标签、节点没有标签、快照里有没有对应地图三种情况；这段逻辑先有注释交代来由，
 * 再有三层判断，原文件因此越过每文件 350 有效行的门禁，按本书面约定抽到独立叶模块。
 * 只做分流，不改取数与评论通路；由构建拼进 src/client/index.ts 同一闭包，排在 IssueDetail 之前。
 * 反例：不要把导航栈本身或补丁取数写进来，那两件事仍归 IssueDetail 与 store 分片。
 */
declare function findMapByIdentity(...args: any[]): any;
declare function pushNav(...args: any[]): any;

// 节点的标签可能是字符串数组、{nodes:[]} 枚举形态或缺省，这里统一读成数组。
export const subLabelsOf = function (x: any): any {
  if (!x || x.labels == null) return []
  if (Array.isArray(x.labels)) return x.labels
  if (typeof x.labels === 'object' && Array.isArray(x.labels.nodes)) return x.labels.nodes
  return []
}

// 节点有没有可用于判种类的信息（标签或 type 字段）。没有时只能按快照里找不找得到这张地图来兜底。
export const subHasRoutingInfo = function (x: any): any {
  if (!x) return false
  if (subLabelsOf(x).length > 0) return true
  return typeof x.type === 'string' && x.type !== ''
}

// #1286：规格（实施地图）也是容器，点进去要走到同一套详情页骨架。
export const subHasMapTag = function (x: any): any {
  const ls = subLabelsOf(x)
  for (let i = 0; i < ls.length; i++) { const n = (typeof ls[i] === 'string') ? ls[i] : ls[i].name; if (n === 'wayfinder:map') return true }
  return x && (x.type === 'map' || x.type === 'spec')
}

// T4 整改 #554：子票与阻塞票点击按地图行同口径分流（T3 的做法）。
// 节点自带标签时按标签判：有地图标签且快照里找得到这张地图才进地图详情，否则回落工单详情；
// 节点没有标签（阻塞票节点只有编号标题状态）时按快照本地找图：找得到进地图详情，
// 找不到回落普通工单详情（有字可看，不静默回列表）。只定种类与编号，取数与评论不动。
export const enterSubDetail = function (st: any, x: any, issueEffort: any): void {
  if (!x || x.number == null) return
  // effort 维度：子票/阻塞票的 effort 取节点自带字段，没有就跟当前票同 effort（同 effort 内的引用）
  const eid = (x.effortId !== undefined && x.effortId !== null) ? String(x.effortId) : issueEffort
  if (subHasRoutingInfo(x)) {
    if (subHasMapTag(x) && findMapByIdentity(st.snapshot && st.snapshot.maps, x.number, eid)) pushNav(st, 'map', x.number, eid)
    else pushNav(st, 'issue', x.number, eid)
  } else {
    if (findMapByIdentity(st.snapshot && st.snapshot.maps, x.number, eid)) pushNav(st, 'map', x.number, eid)
    else pushNav(st, 'issue', x.number, eid)
  }
}
