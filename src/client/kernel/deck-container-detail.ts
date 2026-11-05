/**
 * src/client/kernel/deck-container-detail.ts —— 已关闭容器的容器级投影（#1923，规格 #1885 §6 / S6）
 *
 * 为什么要有这一片：首屏投影按规格 §6 只装「开放工作集 + 开放容器的子票 + 已关闭容器行」，
 * 已关闭容器的子票不在首屏。用户打开一张已关闭容器时仍要看子票卡片、层级与统计，所以在
 * 「选中它」这一刻由视图模型的命令向宿主发一条 wf.containerProjection，把那一张容器的
 * 行、子票、层级与统计一次取回；首屏那一条路一个字节都不动，页面也不再自己发请求。
 *
 * 三条不能改的约定：
 *  1. 只有「已关闭容器」才取：开放容器的子票本来就在首屏投影里，再取一次等于白花一条电话。
 *  2. 一张容器一个版本只取一次：同样的 (工作区, 版本, 容器身份) 只发一条电话；重复点开、
 *     每次渲染的兜底触发都被这张表挡住。换版本才允许再取（库里的数据更新了）。
 *  3. 桶按「工作区 + 工作单元 + 容器编号」分桶：同号容器在不同工作单元、不同工作区是两张，
 *     不能互相顶替；桶的形状与页面认的 MapTicketsBucket 一致（mode / items / stats / error）。
 *
 * 反例：不要在这里拼卡片、不要在这里算层级或统计（那是宿主读侧的领域规则），也不要让页面
 * 直接调这里的取数——视图只读 mapDetail 切片。
 */

declare const host: any
declare const emit: any
declare const log: any
declare function dswsLogHash(...args: any[]): any
declare function dswsLogTrunc(...args: any[]): any
// 客户端唯一的失败档位出口（kernel/api-io.ts 里的同名函数，构建时拼进同一个闭包）。
// 本片不自己造 {kind, message}：交出去的失败对象必须带 raw（后端原文），档位只从这一处取。
declare function dswsNormalizeError(...args: any[]): any

/** 取数用的那一份最小端口：与 DeckViewScope 对齐，单独声明是为了本片可以脱离接线层单测。 */
export interface ContainerProjectionScope {
  host?: any
  wsKeyOf?: any
  idOfParts?: any
  findMapByIdentity?: any
  snapshotVersionBookOf?: any
}

/** 已发过的 (版本, 容器) 表：一个版本只取一次，换版本才允许再取。 */
const askedKeys: Record<string, boolean> = {}
/** 在途去重：同一张容器的并发触发合并成一条电话。 */
const inflight: Record<string, any> = {}

/** 当前库版本；读不到时回 null（不拿 0 冒充「版本 0」）。 */
function versionOf(scope: any, st: any): number | null {
  try {
    const book = (scope && typeof scope.snapshotVersionBookOf === 'function') ? scope.snapshotVersionBookOf(st && st.cwd) : null
    return (book && typeof book.version === 'number') ? book.version : null
  } catch (e) { return null }
}

/**
 * 容器的分桶键：工作区 + (工作单元, 编号)。
 *
 * 为什么把工作区也放进来：同一个会话换工作区之后，旧桶还在 st 上；只按「工作单元 + 编号」
 * 分桶会让新工作区里同号的容器读到上一个工作区的子票。
 */
export function deckContainerProjectionKeyOf(scope: any, st: any, effortId: any, key: any): string {
  let ws = ''
  try { ws = (scope && typeof scope.wsKeyOf === 'function') ? String(scope.wsKeyOf(st && st.cwd) || '') : String((st && st.cwd) || '') } catch (e) { ws = '' }
  let id = ''
  try {
    id = (scope && typeof scope.idOfParts === 'function')
      ? String(scope.idOfParts(effortId === undefined || effortId === null ? '' : String(effortId), key))
      : String(effortId || '') + '\u0000' + String(key)
  } catch (e2) { id = String(effortId || '') + '\u0000' + String(key) }
  return ws + '\u0000' + id
}

/** 当前阅读态打开的那张容器的桶；没打开、或还没有取过时回 null（页面据此按首屏投影画）。 */
export function deckContainerDetailOfStore(scope: any, st: any, reading: any): any {
  if (!st || !reading || reading.activeMap === null || reading.activeMap === undefined) return null
  const effortId = (reading.activeMapEffort === undefined || reading.activeMapEffort === null) ? '' : String(reading.activeMapEffort)
  // 取桶的键要用投影里那一行的规范键：本地 Markdown 的容器编号是补零的 '00'，阅读态里是数字 0；
  // 直接拿数字拼桶会读不到（'0' 与 '00' 是两个桶）。找不到那一行时才退回阅读态里的值。
  let key: any = reading.activeMap
  try {
    const maps = (st.snapshot && Array.isArray(st.snapshot.maps)) ? st.snapshot.maps : []
    const map = (scope && typeof scope.findMapByIdentity === 'function') ? scope.findMapByIdentity(maps, reading.activeMap, effortId) : null
    if (map && map.key !== undefined && map.key !== null) key = map.key
  } catch (e0) { key = reading.activeMap }
  const bucketKey = deckContainerProjectionKeyOf(scope, st, effortId, key)
  try { return (st.containerProjection && st.containerProjection[bucketKey]) || null } catch (e) { return null }
}

/**
 * 向宿主取一张容器的投影。回包落进 st.containerProjection 的桶里并 emit，
 * 下一次渲染视图模型就会带着新桶重算 mapDetail 切片。
 *
 * 失败不编数据：mode 记 err、error 带上宿主给的档位与那句人话；上一次已取到的桶不保留
 * （容器级数据每次打开都从库里现读，库是唯一真相，没有「上次的」可言）。
 */
export function fetchContainerProjection(scope: any, st: any, key: any, opts?: any): any {
  const o: any = opts || {}
  const effortId = (o.effortId === undefined || o.effortId === null) ? '' : String(o.effortId)
  const bucketKey = deckContainerProjectionKeyOf(scope, st, effortId, key)
  const version: number | null = (typeof o.version === 'number' && isFinite(o.version)) ? o.version : versionOf(scope, st)
  if (inflight[bucketKey]) return inflight[bucketKey]
  if (!st.containerProjection) st.containerProjection = {}
  const phone = (scope && scope.host) || (typeof host !== 'undefined' ? host : null)
  const failBucket = function (bucket: any): any {
    st.containerProjection[bucketKey] = bucket
    try { emit(st) } catch (e) {}
    return Promise.resolve({ ok: false, error: bucket.error })
  }
  if (!phone || typeof phone.call !== 'function') {
    return failBucket({ mode: 'err', version: version, key: String(key), effortId: effortId, container: null, items: [], stats: null, error: dswsNormalizeError({ error: '宿主电话不可用，取不到这张容器的子票。' }, '取不到这张容器的子票。'), ts: Date.now() })
  }
  st.containerProjection[bucketKey] = { mode: 'loading', version: version, key: String(key), effortId: effortId, container: null, items: [], stats: null, error: null, ts: Date.now() }
  try { emit(st) } catch (e2) {}
  const startedAt = Date.now()
  const args: any = { key: String(key) }
  if (effortId) args.effortId = effortId
  if (st && st.cwd) args.cwd = st.cwd
  let call: any = null
  try { call = phone.call('wf.containerProjection', args) } catch (e3) { call = Promise.reject(e3) }
  const done = Promise.resolve(call).then(function (res: any): any {
    try { delete inflight[bucketKey] } catch (eD) {}
    if (res && res.ok === true) {
      const bucket = {
        mode: 'real',
        version: (typeof res.version === 'number' && isFinite(res.version)) ? res.version : version,
        key: String(key),
        effortId: effortId,
        container: res.container || null,
        items: Array.isArray(res.tickets) ? res.tickets : [],
        stats: res.stats && typeof res.stats === 'object' ? res.stats : null,
        error: null,
        ts: Date.now(),
      }
      st.containerProjection[bucketKey] = bucket
      try { emit(st) } catch (e4) {}
      try { log('info', 'host.call', { method: 'wf.containerProjection', latencyMs: Date.now() - startedAt, ok: true, kind: 'container-projection' }) } catch (e5) {}
      return { ok: true, bucket: bucket }
    }
    const err = dswsNormalizeError({ kind: (res && res.errorKind), error: (res && res.error) }, '本地快照库读不到这张容器的子票。')
    st.containerProjection[bucketKey] = { mode: 'err', version: version, key: String(key), effortId: effortId, container: null, items: [], stats: null, error: err, ts: Date.now() }
    try { emit(st) } catch (e6) {}
    try { log('warn', 'host.call.fail', { method: 'wf.containerProjection', kind: 'container-projection', errorHash: dswsLogHash(dswsLogTrunc(err.message, 120, 'error')) }) } catch (e7) {}
    return { ok: false, error: err }
  }, function (e: any): any {
    try { delete inflight[bucketKey] } catch (eD) {}
    const err = dswsNormalizeError(e, '取不到这张容器的子票。')
    st.containerProjection[bucketKey] = { mode: 'err', version: version, key: String(key), effortId: effortId, container: null, items: [], stats: null, error: err, ts: Date.now() }
    try { emit(st) } catch (e6) {}
    try { log('warn', 'host.call.fail', { method: 'wf.containerProjection', kind: 'container-projection', errorHash: dswsLogHash(dswsLogTrunc(err.message, 120, 'error')) }) } catch (e7) {}
    return { ok: false, error: err }
  })
  inflight[bucketKey] = done
  return done
}

/**
 * 「选中一张容器」之后的容器级读取：只有已关闭容器才取，同一版本同一张只发一次。
 *
 * 这一条是视图模型命令（openMap）背后的端口实现；视图与选择器都不直接调它。
 * 找不到这张容器（投影里还没有它）时什么都不做：宁可等下一次刷新，也不猜一个身份去取。
 */
export function containerProjectionLoadOf(scope: any, st: any, payload: any): any {
  if (!st || !payload || payload.number === undefined || payload.number === null) return null
  const number = payload.number
  const effortId = (payload.effortId === undefined || payload.effortId === null) ? '' : String(payload.effortId)
  const projection = st.snapshot
  const maps = projection && Array.isArray(projection.maps) ? projection.maps : []
  const map = (scope && typeof scope.findMapByIdentity === 'function') ? scope.findMapByIdentity(maps, number, effortId) : null
  if (!map) return null
  if (String(map.state || '').toUpperCase() !== 'CLOSED') return null
  const key = (map.key !== undefined && map.key !== null) ? map.key : map.number
  const version = versionOf(scope, st)
  const bucketKey = deckContainerProjectionKeyOf(scope, st, effortId, key)
  let bucket: any = null
  try { bucket = (st.containerProjection && st.containerProjection[bucketKey]) || null } catch (e) { bucket = null }
  // 已经有了不比手上版本旧的桶：不再取（real 是完整一份；loading 是在途，等它回来）。
  if (bucket && (bucket.mode === 'real' || bucket.mode === 'loading')
    && (version === null || typeof bucket.version !== 'number' || bucket.version >= version)) return null
  const asked = String(version === null ? 'unknown' : version) + '\u0000' + bucketKey
  if (askedKeys[asked]) return null
  askedKeys[asked] = true
  // 放到微任务里再发：这条命令也会在渲染期被 deckViewOf 兜底调一次，若同步发电话，
  // 取数层会同步 emit，等于在渲染期改另一个组件的状态。推迟一拍不改变「谁触发」，
  // 只是让那次 emit 落在本次渲染之后。
  return Promise.resolve().then(function (): any {
    return fetchContainerProjection(scope, st, key, { effortId: effortId, version: version })
  })
}

/** 门禁与排查用：清掉「已发过」与在途表，让每个用例从干净状态开始。桶本身不动。 */
export function deckForgetContainerProjections(): void {
  for (const key of Object.keys(askedKeys)) delete askedKeys[key]
  for (const key of Object.keys(inflight)) delete inflight[key]
}
