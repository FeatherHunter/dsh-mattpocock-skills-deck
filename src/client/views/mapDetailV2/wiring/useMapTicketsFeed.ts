/**
 * views/mapDetailV2/wiring/useMapTicketsFeed.ts —— 进页面就把这张地图的子票要回来，并交回首屏快照那一份。
 *
 * 为什么单独一份：取数这件事是「页面与宿主」的接线，不是判断也不是画法。它和 kernel 打一次招呼
 * （fetchMapTickets 会自己开请求、写回 st.mapTickets、完了重渲染），页面只读那个桶。
 *
 * 与老页同一口径（views/MapDetail.ts:71-75）：进页面就取一次，依赖是「哪张图 + 工作区」；
 * 取数桶可能还没有（首帧），也可能正在取、取失败、后端不支持——这些状态由 model 的 ticketFeedOf 分辨，
 * 这里不判，只把桶原样交出去。
 *
 * 叶子约定：本文件由构建拼进客户端闭包（scripts/build.mts 的 LEAF_MODULES），只能有 import type，
 * 调别的叶子/内核函数一律靠同一作用域里的名字（见文件头 declare）。
 */
declare function idOfParts(...args: any[]): any
declare function effortOf(...args: any[]): any
declare function fetchMapTickets(...args: any[]): any

/**
 * 这张地图的取数桶（可能为 null）。返回值形状见 model/contracts/mapDetailTypes.d.ts 的 MapTicketsBucket。
 *
 * 依赖只写「哪张图、哪个工作区」：地图行对象每次快照刷新都是新的，把它放进依赖会让每帧都重发请求。
 */
export function useMapTicketsFeed(st: any, m: any): any {
  // 读桶与发请求必须用同一对「工作单元 + 键」现算一次：老页读桶用 idOf(m)（只认 m.key）、
  // 发请求用 m.key ?? m.number，m.key 缺失时两边会分叉（读的是 '' 那个桶，写的是编号那个桶），
  // 页面永远读不到取回的数据，且切图时因为键没变不会重发。这里按 fetchMapTickets 的同一算法
  // （key 去空白、缺工作单元就是编号本身）算 bucketKey，读和写都只认它。
  const effortId = String(effortOf(m) || '')
  const rawKey = m && m.key !== undefined && m.key !== null && String(m.key) !== ''
    ? m.key
    : (m && m.number)
  const mKey = String(rawKey === undefined || rawKey === null ? '' : rawKey).trim()
  const bucketKey = idOfParts(effortId, mKey)
  const cwd = st && st.cwd
  const bucket = (st && st.mapTickets && st.mapTickets[bucketKey]) || null
  React.useEffect(function (): void {
    if (!m || !mKey) return
    // 失败由桶里的 error 与老页同一个提示口径交代，这里不吞成一句自造的话。
    try {
      fetchMapTickets(st, mKey, { effortId: effortId })
    } catch (e) {
      // 同步抛错属于调用参数问题（宿主电话还没装上等），页面按「还没有桶」画，日志由调用侧记录。
    }
  }, [bucketKey, cwd])
  return bucket
}
