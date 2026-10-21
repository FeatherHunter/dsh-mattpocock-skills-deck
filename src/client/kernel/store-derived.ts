/**
 * src/client/kernel/store-derived.ts — 派生统计与行级动作全家（#455 由 store.js 拆出）。
 *
 * 为什么派生要单独一层：快照是“宿主给了什么”，派生是“照当前快照算出来给人看的数字和按钮”，
 * 同一份快照在不同地方（主列表、状态栏、地图详情）要算出同一个数，所以只此一份实现，别处只调它。
 * 本文件由 store-derived.js 转写而来（#1251）：转写时只加类型标注与环境声明，运行行为一字不改；同一张票里
 * 紧接着又做了一笔有记录的优化——compute() 从「每张票最多扫六趟」改成「单趟分桶」，来由与不许改的约定见该函数
 * 上方注释。除这一处，其余运行行为仍与转写前一致。
 * 反例：不要在这里读写快照缓存（那是 store-snapshot.ts 的事），也不要在这里拼界面节点之外的东西。
 */
declare function idOfParts(...args: any[]): any;
declare function idOf(...args: any[]): any;
declare function promptText(...args: any[]): any;
declare function effortOf(...args: any[]): any;
declare function refKeyOf(...args: any[]): any;
declare function issueUrlFor(...args: any[]): any;
declare function renderTemplate(...args: any[]): any;
declare function startText(...args: any[]): any;
declare function tr(...args: any[]): any;
declare function h(...args: any[]): any;
declare const Tip: any;
declare function Ic(...args: any[]): any;
declare function inject(...args: any[]): any;
declare function moduleMetaOf(...args: any[]): any;
// #1296：身份色只从中央色表取（container-view.ts 的 CONTAINER_ACCENT，构建时排在本文件之前）。
declare const CONTAINER_ACCENT: any;
// #1286 收口：规格与地图也是快照里的「行」，行级动作要先认出容器再走三态口径（见下方 containerActionOf）。
declare function containerKindOf(...args: any[]): any;
declare function containerStateOf(...args: any[]): any;
declare function containerTriState(...args: any[]): any;
declare function containerPromptText(...args: any[]): any;
// ---- effort 维度共用小件（面板多处要按身份找地图/分组/取 effort 名单，只此一份实现）----
/** 按票身份 (effort, 编号) 在 maps 数组里找地图；找不到就老实返回空，不猜第一张。
  * 只有整份快照都没有工作单元标识（老快照）时，才回落按编号找——新快照里按编号取第一张会开错地图。 */
export const findMapByIdentity = function (maps: any, num: any, effortId: any): any {
  try {
    const list: any[] = Array.isArray(maps) ? maps : []
    const k: string = num != null ? String(num).padStart(2, '0') : ''
    const wantId: any = idOfParts(effortId === undefined || effortId === null ? '' : String(effortId), k)
    const exact: any = list.find(function (m: any): any { return m && idOf(m) === wantId })
    if (exact) return exact
    const anyEffort: boolean = list.some(function (m: any): any { return m && effortOf(m) !== '' })
    if (anyEffort) return null
    return list.find(function (m: any): any { return m && (m.number === num || String(m.number) === String(num) || (m.key != null && String(m.key).padStart(2, '0') === k)) }) || null
  } catch (e) { return null }
}
/** 同上，但输入是 compute() 的分组数组（分组元素形如 { m: 地图 }）。 */
export const findGroupByIdentity = function (groups: any, num: any, effortId: any): any {
  try {
    const list: any[] = Array.isArray(groups) ? groups : []
    const hit: any = findMapByIdentity(list.map(function (g: any): any { return g && g.m }), num, effortId)
    if (!hit) return null
    return list.find(function (g: any): any { return g && g.m === hit }) || null
  } catch (e) { return null }
}
/** 当前快照里有几个 effort（去重排序）；单 effort 后端恒为 []，界面据此决定要不要标 effort。 */
export const effortNamesOf = function (st: any): any {
  try {
    const set: any = {}
    const put = function (x: any): void { const e: any = effortOf(x); if (e) set[e] = true }
    const snap: any = (st && st.snapshot) || {}
    ;(Array.isArray(snap.maps) ? snap.maps : []).forEach(function (m: any): void { put(m); (m && m.tickets || []).forEach(put) })
    ;(Array.isArray(snap.issues) ? snap.issues : []).forEach(put)
    return Object.keys(set).sort()
  } catch (e) { return [] }
}
/** 地图子票的阻断表（open 阻塞者才算阻塞）：按票身份 (effort, 编号) 键入，并记下所属地图的 effort 供跳转用。 */
export const mapBlockOf = function (snapshot: any): any {
  const blockOf: any = {}
  try {
    const maps: any[] = (snapshot && Array.isArray(snapshot.maps)) ? snapshot.maps : []
    maps.forEach(function (m: any): void {
      const tickets: any[] = (m && Array.isArray(m.tickets)) ? m.tickets : []
      const byId: any = {}
      tickets.forEach(function (t: any): void { byId[idOf(t)] = t })
      tickets.forEach(function (t: any): void {
        if (!t || !Array.isArray(t.blockedBy) || !t.blockedBy.length) return
        const openBlockers: any[] = t.blockedBy.filter(function (b: any): any { const bt: any = byId[idOfParts(effortOf(t), refKeyOf(b))]; return bt && bt.state === 'OPEN' })
        if (openBlockers.length) blockOf[idOf(t)] = { map: m.number, mapEffort: effortOf(m), mapTitle: m.title, by: openBlockers }
      })
    })
  } catch (e) { /* 坏数据不崩整表 */ }
  return blockOf
}

// 派生：票务分组（frontier/claimed/blocked/closed）
// 怎么算的（#1251 这一笔优化）：先把票按身份收进 byId，再单趟遍历按状态分桶。原来对每张票最多扫六趟
//   （open/closed/frontier/claimed/blocked 各一次 filter），其中未认领的开放票还要把 blockedBy.some(openBlocker)
//   算两遍——而 openBlocker 只读快照、算一遍与算两遍结果必然相同，所以两遍是白算。今天每张票只读一次状态、
//   阻塞判定只算一遍，趟数从六降到二。
// 不能改的约定：五个数组的元素顺序仍与 m.tickets 一致（面板按这个顺序画）；
//   判定表达式与短路条件原样保留——t.claimedBy 为真时根本不碰 blockedBy，blockedBy 是 undefined 时照旧当场抛错（不兜底、不吞）。
// 这一笔优化成立的前提：state 与 blockedBy 是纯数据（普通属性，读几次结果都一样）。哪天它们变成带副作用的取值器
//   （getter 或 Proxy），「每张票只读一次状态」就不再等价于原来读三次，届时要么改回多趟，要么把票据在入口处先拍成纯数据。
export const compute = (st: any): any => {
  const maps: any[] = (st.snapshot && Array.isArray(st.snapshot.maps)) ? st.snapshot.maps : []
  return maps.map(function (m: any): any {
    // effort 维度：地图内的票按身份 (effort, 编号) 索引；阻塞引用只在同一 effort 内解析
    const byId: any = {}; m.tickets.forEach(function (t: any): void { byId[idOf(t)] = t })
    const openBlocker = (b: any): any => { const t: any = byId[idOfParts(effortOf(m), refKeyOf(b))]; return t !== undefined && t.state === 'OPEN' }
    const open: any[] = []
    const closed: any[] = []
    const frontier: any[] = []
    const claimed: any[] = []
    const blocked: any[] = []
    m.tickets.forEach(function (t: any): void {
      if (t.state === 'CLOSED') { closed.push(t); return }
      if (t.state !== 'OPEN') return
      open.push(t)
      if (t.claimedBy) { claimed.push(t); return }
      if (t.blockedBy.some(openBlocker)) blocked.push(t)
      else frontier.push(t)
    })
    return { m: m, open: open, closed: closed, frontier: frontier, claimed: claimed, blocked: blocked }
  })
}
export const frontierAll = (st: any): any => compute(st).reduce(function (n: any, g: any): any { return n + g.frontier.length }, 0)

// #689 工单口径（唯一一处判断）：拉取请求不算工单 —— 主列表、KPI、状态栏那几枚共用它。
//   #294/#505 裁定拉取请求与工单同池、不新增集合，而面板另有专门的拉取请求页签，所以凡要说「工单」的地方都从这里过；池子本身与拉取请求页签照旧。
export const isTicketRow = (x: any): any => !(x && x.isPullRequest === true)
export const ticketRowsOf = (arr: any): any => (Array.isArray(arr) ? arr : []).filter(isTicketRow)
// #689 宿主给的后端计数（deck.counts，产出见 tracker/snapshot.js）：面板顶部那几个数字改读它。拿不到（这个后端没实现计数 / 配额耗尽 / 还没升级的旧快照）返回 null，调用方退回按池子派生；scoped=true 表示界面当前带着筛选（按工作单元或标签筛过）—— 全仓数字与眼前这一屏不是一个口径，一并返回 null。
export const deckCountsOf = function (st: any, scoped: any): any {
  try {
    if (scoped) return null
    const c: any = (st && st.snapshot && st.snapshot.deck && st.snapshot.deck.counts) || null
    if (!c) return null
    const isN = function (v: any): any { return typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v }
    return (isN(c.open) && isN(c.closed) && isN(c.total)) ? { open: c.open, closed: c.closed, total: c.total } : null
  } catch (e) { return null }
}
// v18-30：状态栏可接/占用改用「列表 open issue」口径（与面板列表一致）：
//   可接 = open issue 中未认领且未被 open 阻塞；占用 = 已认领 + 被阻塞；两者之和 = 全部 open issue
export const openIssuesOf = (st: any): any => ticketRowsOf((st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []).filter(function (x: any): any { return x.state !== 'CLOSED' })
// #544 独立票阻塞边共用小函数（isOccupied 回落与 applyStandaloneBlocks 共用）：
//   standaloneKeyOfRef 把数字/字符串/{key}/{number} 等形状归一成 key 字符串；
//   standaloneStateMapOf 把快照里全部票（issues + 各地图子票）的状态按数字与 key 双键收成大写表。
const standaloneKeyOfRef = function (b: any): string {
  if (b === undefined || b === null) return ''
  if (typeof b === 'number' || typeof b === 'string') return String(b)
  if (typeof b === 'object') {
    if (b.key !== undefined && b.key !== null && b.key !== '') return String(b.key)
    if (b.number !== undefined && b.number !== null) return String(b.number)
  }
  return ''
}
const standaloneStateMapOf = function (st: any): any {
  const stateOf: any = {}
  const put = function (k: any, s: any): void { if (k === undefined || k === null || k === '') return; stateOf[String(k)] = String(s || '').toUpperCase() }
  const snap: any = (st && st.snapshot) || {}
  const issues: any[] = Array.isArray(snap.issues) ? snap.issues : []
  const maps: any[] = Array.isArray(snap.maps) ? snap.maps : []
  // effort 维度：状态表按身份 (effort, 编号) 键入；同一 effort 内才允许互相解析
  issues.forEach(function (it: any): void { if (!it) return; put(idOf(it), it.state); if (it.key !== undefined && it.key !== null) put(idOfParts(effortOf(it), it.key), it.state) })
  maps.forEach(function (m: any): void { (m.tickets || []).forEach(function (t: any): void { if (!t) return; put(idOf(t), t.state); if (t.key !== undefined && t.key !== null) put(idOfParts(effortOf(t), t.key), t.state) }) })
  return stateOf
}
// #544 独立票阻塞边判定：一条阻塞边算数，当且仅当按 live 状态表查到阻塞者为 open；
// 查不到 live 状态时，用边自带 state 回落（open 才算数），都没有则不算。
const standaloneHasOpenBlocker = function (stateOf: any, arr: any): boolean {
  if (!Array.isArray(arr)) return false
  for (let i: number = 0; i < arr.length; i++) {
    const k: string = standaloneKeyOfRef(arr[i])
    if (!k) continue
    const live: any = stateOf[k]
    if (live === 'OPEN') return true
    if ((live === undefined || live === '') && arr[i] && typeof arr[i] === 'object' && String(arr[i].state || '').toUpperCase() === 'OPEN') return true
  }
  return false
}
export const isOccupied = function (st: any, x: any): boolean {
  if (!x || x.state === 'CLOSED') return false
  if (x.assignees && x.assignees.length) return true
  const maps: any[] = (st.snapshot && st.snapshot.maps) || []
  let inMap: boolean = false
  for (let mi: number = 0; mi < maps.length; mi++) {
    const m: any = maps[mi]
    if (!m.tickets || !m.tickets.length) continue
    const byId: any = {}
    m.tickets.forEach(function (t: any): void { byId[idOf(t)] = t })
    const t: any = byId[idOf(x)]
    if (t) {
      inMap = true
      if (t.blockedBy && t.blockedBy.length) {
        const openBlockers: any[] = t.blockedBy.filter(function (b: any): any { const bt: any = byId[idOfParts(effortOf(t), refKeyOf(b))]; return bt && bt.state === 'OPEN' })
        if (openBlockers.length) return true
      }
    }
  }
  if (inMap) return false
  // #544 独立票合并：不属于任何地图子票的行，看自己身上的阻塞边；
  // 地图票的判定以上循环为准，这里不碰，保证地图分层与计数一字不差。
  try {
    return standaloneHasOpenBlocker(standaloneStateMapOf(st), x.blockedBy)
  } catch (e) { return false }
}
export const occCount = (st: any): any => openIssuesOf(st).filter(function (x: any): any { return isOccupied(st, x) }).length
export const frontierCount = (st: any): any => openIssuesOf(st).length - occCount(st)
// #544 独立票阻塞边合并：把快照 issues 里独立票自身的 blockedBy 合并进表级 blockOf；
// 只挂自己身上（已是地图子票的行、地图节点行、已关闭行、已有关联的行一律跳过，不碰地图层级与计数）。
// 数据来自列表查询已有的阻塞边片段（零请求）；单票边解析失败只跳过当票，不抛，不影响整表。
export const applyStandaloneBlocks = function (st: any, blockOf: any): any {
  const snap: any = (st && st.snapshot) || {}
  const issues: any[] = Array.isArray(snap.issues) ? snap.issues : []
  if (!issues.length || !blockOf) return blockOf
  const maps: any[] = Array.isArray(snap.maps) ? snap.maps : []
  const inMap: any = {}
  maps.forEach(function (m: any): void {
    (m.tickets || []).forEach(function (t: any): void {
      if (!t) return
      inMap[idOf(t)] = true
      if (t.key !== undefined && t.key !== null) inMap[idOfParts(effortOf(t), t.key)] = true
    })
  })
  const stateOf: any = standaloneStateMapOf(st)
  // #1286：容器行也算容器 —— 探索地图（type==='map' 或带 wayfinder:map 标签）与规格（type==='spec'）。
  //   容器不是「一张要独立接手的票」，所以不挂独立票那套阻塞徽标（地图子票、规格单票都算）。
  //   口径与内核 container-view.ts 的 containerKindOf 一致；这里内联写死而不是调它：门禁
  //   tests/verify-544-standalone-blocked.ts 会把本文件单独求值，跨文件调函数会 ReferenceError。
  const isMapRow = function (x: any): any { return x.type === 'map' || x.type === 'spec' || ((x.labels || []).some(function (l: any): any { return l && l.name === 'wayfinder:map' })) }
  issues.forEach(function (x: any): void {
    try {
      if (!x || x.state === 'CLOSED' || isMapRow(x)) return
      const id: any = idOf(x)
      if (!id || blockOf[id] !== undefined) return
      if (inMap[id]) return
      const arr: any[] = Array.isArray(x.blockedBy) ? x.blockedBy : []
      if (!arr.length) return
      const openBlockers: any[] = []
      arr.forEach(function (b: any): void {
        const k: string = standaloneKeyOfRef(b)
        if (!k) return
        // effort 维度：阻塞引用只在同一 effort 内解析（同号票在别的 effort 里不算数）
        const live: any = stateOf[idOfParts(effortOf(x), k)]
        if (live === 'OPEN') { openBlockers.push(k); return }
        if ((live === undefined || live === '') && b && typeof b === 'object' && String(b.state || '').toUpperCase() === 'OPEN') openBlockers.push(k)
      })
      if (openBlockers.length) blockOf[id] = { map: null, mapTitle: '', by: openBlockers }
    } catch (e) { /* 单票边解析失败只跳过当票，不崩整表 */ }
  })
  return blockOf
}
// v1.5 T1：BUG / 诊断计数（open 且带对应标签，与「可接」同口径）
export const hasLabelOf = function (x: any, nm: any): any { return (x.labels || []).some(function (l: any): any { return (typeof l === 'string') ? l === nm : l.name === nm }) }
export const isTriageLike = function (x: any): any { const labs: any = (x && x.labels) || []; if (!Array.isArray(labs) || labs.length === 0) return true; return labs.some(function (l: any): any { return (typeof l === 'string' ? l : l.name) === 'needs-triage' }) }
export const bugCount = (st: any): any => openIssuesOf(st).filter(function (x: any): any { return hasLabelOf(x, 'bug') }).length
export const triageCount = (st: any): any => openIssuesOf(st).filter(function (x: any): any { return isTriageLike(x) }).length

// v19：共享 —— 标签配置色映射（聚合：快照全量 labels + 票面最终色）。
// 票面色是宿主算好的最终色：本地 Markdown 后端按工作区配色文件 docs/agents/label-colors.json 查色，
// 文件里没收的回落内置默认 11 色，都没有才回灰（#618；旧的那张 docs/agents/triage-labels.md 调色盘表已不再被读）。
// 这里只聚合这份结果，不自己查表算色，也不直读后端自报的 labelPalette。
export const buildColorOf = function (st: any): any {
  const colorOf: any = {}
  const snapLabels: any[] = (st.snapshot && Array.isArray(st.snapshot.labels)) ? st.snapshot.labels : []
  snapLabels.forEach(function (l: any): void { if (l && l.name && l.color) colorOf[String(l.name).trim()] = String(l.color).trim().replace(/^#/, '') })
  const issues: any[] = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
  issues.forEach(function (x: any): void { (x.labels || []).forEach(function (l: any): void { if (l && l.name && l.color) colorOf[String(l.name).trim()] = String(l.color).trim().replace(/^#/, '') }) })
  const maps: any[] = (st.snapshot && Array.isArray(st.snapshot.maps)) ? st.snapshot.maps : []
  maps.forEach(function (m: any): void { (m.tickets || []).forEach(function (t: any): void { (t.labels || []).forEach(function (l: any): void { if (l && l.name && l.color) colorOf[String(l.name).trim()] = String(l.color).trim().replace(/^#/, '') }) }) })
  return colorOf
}
// T9：行级动作主色计算（与 mkRowAction 共享 · 给新会话按钮复用：与执行按钮同 label 主色）
// 字色判据（#764 诊断落地）：按无障碍对比度在两种字色里择优，不用固定阈值一刀切。
export const isLightHex = function (hex: any): boolean {
  try {
    var hh: string = String(hex || '').trim().replace(/^#/, '')
    if (/^[0-9a-fA-F]{3}$/.test(hh)) hh = hh[0] + hh[0] + hh[1] + hh[1] + hh[2] + hh[2]
    if (!/^[0-9a-fA-F]{6}$/.test(hh)) return false
    var toLin = function (part: any): number { var v: number = parseInt(part, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    var Lbg: number = 0.2126 * toLin(hh.slice(0, 2)) + 0.7152 * toLin(hh.slice(2, 4)) + 0.0722 * toLin(hh.slice(4, 6))
    var Ldark: number = 0.2126 * toLin('14') + 0.7152 * toLin('0a') + 0.0722 * toLin('1e')
    var loW: number = Lbg < 1 ? Lbg : 1, hiW: number = Lbg < 1 ? 1 : Lbg
    var cWhite: number = (hiW + 0.05) / (loW + 0.05)
    var loD: number = Lbg < Ldark ? Lbg : Ldark, hiD: number = Lbg < Ldark ? Ldark : Lbg
    var cDark: number = (hiD + 0.05) / (loD + 0.05)
    return cDark >= cWhite
  } catch (e) { return false }
}
// 行级动作（containerActionOf / rowActionKind / actionColorOf / rowActionText / mkRowAction）
// 已拆到 kernel/row-actions.ts：构建时紧随本文件拼入同一闭包，外部调用点无需改动。
// 拆出的理由：本文件越过每文件 350 有效行的门禁，且那族函数与派生统计没有共享状态。
// #506 拉取请求页签门控与列表派生（前端房纯函数，无日志点：无跨边界调用、无新缓存、无定时器，复用既有快照链路）
// 门控只读后端模块的能力位，不写后端名字；快照组装全留，过滤归前端。
// ListFilter 登记（前端房登记，后端按此实现过滤；示例见 #504 正文）：
//   const res = await listIssues({ refId: 'owner/name' }, { state: 'open', isPullRequest: true }, ctx)
// 成功时只返回拉取请求，同池逐票仍必带三个扩展字段。
export const prTabVisible = function (st: any): boolean {
  try {
    var sel: any = (st && (st.selection || (st.snapshot && st.snapshot.selection))) || null
    var bid: any = sel ? sel.backendId : null
    if (bid == null) return false
    var meta: any = null
    try { meta = (typeof moduleMetaOf === 'function') ? moduleMetaOf(st, bid) : null } catch (eM) { meta = null }
    if (meta && meta.capabilities && meta.capabilities.pullRequests === true) return true
    var ms: any = (st && Array.isArray(st.backendModules)) ? st.backendModules : null
    if (ms) for (var i: number = 0; i < ms.length; i++) { var m: any = ms[i]; if (m && m.id === bid && m.capabilities && m.capabilities.pullRequests === true) return true }
    return false
  } catch (e) { return false }
}
export const prIssuesOf = function (st: any): any[] {
  try {
    var snap: any = (st && st.snapshot) || null
    if (!snap) return []
    var out: any[] = []
    var seen: any = {}
    var push = function (x: any): void {
      if (!x || x.isPullRequest !== true) return
      var k: string = (x.key != null ? String(x.key) : (x.number != null ? String(x.number) : ''))
      if (!k) return
      var pid: string = idOfParts(x.effortId, k) + '\0pr'
      if (seen[pid]) return
      seen[pid] = true
      out.push(x)
    }
    if (Array.isArray(snap.issues)) snap.issues.forEach(push)
    if (Array.isArray(snap.maps)) snap.maps.forEach(function (m: any): void { if (m && Array.isArray(m.tickets)) m.tickets.forEach(push) })
    return out
  } catch (e2) { return [] }
}
export const prFilterForList = function (): any { return { isPullRequest: true } }
// v19：交接文档时间戳文件名（YYYYMMDD-HHMMSS-mmm）
// #787 P1-1：后加 3 位毫秒，把同秒碰撞窗口从秒级压到毫秒级；固定宽度，字典序仍等于时间序，
//   主机按前缀匹配与按名兜底排序都不用改；旧文件（无毫秒段）仍可被最新回退读到。
export const timeStampStr = (): string => {
  try {
    const d: any = new Date()
    const p = function (n: any): string { return String(n).padStart(2, '0') }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + String(d.getMilliseconds()).padStart(3, '0')
  } catch (e) { return 'latest' }
}
