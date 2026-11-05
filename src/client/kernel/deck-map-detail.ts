/**
 * src/client/kernel/deck-map-detail.ts —— 地图详情这一屏的数据（#1895，规格 #1885 S6）
 *
 * 为什么要有这一份：地图详情页原来自己算「打开的是哪张图、这张图下有哪些子票、共有几层、各状态几张」，
 * 还在进页面时单独给宿主发一条 wf.mapTickets。同一份快照在列表页、地图详情页各读各的，同一张票就可能
 * 在两边说出两个状态。这一份把「地图详情要看的东西」从投影里一次取出来交给视图模型，页面只照着画，
 * 不再摸宿主、也不再从会话存储里挑字段。
 *
 * 一个切片的形状（字段名是公开契约，页面与门禁都按它读）：
 *   map        当前打开的那张容器行（投影 maps 里的同一个对象，不是拷贝）；没打开时为 null；
 *   key        容器身份（key 优先，退回编号）；认不出时为空串；
 *   kind       'map' / 'spec'（认不出、没打开时为空串）；
 *   tickets    这张图的子票数组（与 map.tickets 同一个数组）；
 *   stats      投影里那张容器行自带的统计（groupTickets 的产物，含 levels / levelOf）；
 *   levels     stats.levels（层级；来源没给统计时是空数组，不补零不补层）；
 *   containers 容器树：投影里的全部容器行（与 projection.maps 同一个数组）；
 *   source     'projection'（来自投影）/ 'none'（没打开或投影里找不到）。
 *
 * 三条不能改的约定：
 *  1. 纯函数：不打电话、不读时钟、不改入参；同一份投影与阅读态连续调用两次结果逐字相同。
 *  2. 三态纪律：投影没给统计就返回 null / 空数组，不按子票张数现算一份冒充「宿主统计」；
 *     找不到当前容器就老实说 none，不拿第一张容器顶上。
 *  3. 认容器身份只问调用方给的 mapOf（生产里是 store-derived 的 findMapByIdentity，全仓同一把尺子）；
 *     这里不另写一份「按编号猜」的逻辑，免得同号不同工作单元的容器被认错。
 *
 * 反例：不要在这里拼卡片、不要在这里排序（排序是 ticketBoard 的事）、不要在这里调 fetchMapTickets ——
 * 地图详情不再单独向宿主取数（#1895 验收第二条）。
 */

/** 一张容器在地图详情这一屏要用的东西；字段含义见文件头。 */
export interface DeckMapDetail {
  map: any
  key: string
  kind: string
  tickets: any[]
  stats: any
  levels: any[]
  containers: any[]
  source: string
}

/** 空切片的唯一写法：没打开任何容器时各字段的稳定形状（数组每次新建，调用方改了也不会串）。 */
function emptyDetail(containers: any[]): DeckMapDetail {
  return {
    map: null,
    key: '',
    kind: '',
    tickets: [],
    stats: null,
    levels: [],
    containers: containers,
    source: 'none',
  }
}

/**
 * 从一份投影与一份阅读态算出地图详情切片。
 *
 * input.projection 是视图模型 projection 切片里的那份快照；
 * input.reading 是 reading 切片（读 activeMap / activeMapEffort）；
 * input.mapOf(maps, number, effortId) 由调用方给（生产是 findMapByIdentity），缺席时按「找不到」处理。
 */
export function deckMapDetailOf(input: any): DeckMapDetail {
  const projection: any = (input && input.projection) || {}
  const reading: any = (input && input.reading) || {}
  const containers: any[] = Array.isArray(projection.maps) ? projection.maps : []
  const number = reading.activeMap
  if (number === null || number === undefined) return emptyDetail(containers)
  const mapOf = (input && typeof input.mapOf === 'function') ? input.mapOf : null
  const map: any = mapOf ? mapOf(containers, number, reading.activeMapEffort) : null
  if (!map) return emptyDetail(containers)
  const stats: any = (map.stats && typeof map.stats === 'object') ? map.stats : null
  const kind: string = String(map.type || '') === 'spec' ? 'spec' : 'map'
  const key: string = (map.key !== undefined && map.key !== null) ? String(map.key) : (map.number !== undefined && map.number !== null ? String(map.number) : '')
  return {
    map: map,
    key: key,
    kind: kind,
    tickets: Array.isArray(map.tickets) ? map.tickets : [],
    stats: stats,
    levels: (stats && Array.isArray(stats.levels)) ? stats.levels : [],
    containers: containers,
    source: 'projection',
  }
}
