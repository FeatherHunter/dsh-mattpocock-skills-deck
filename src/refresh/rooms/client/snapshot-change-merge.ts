/**
 * src/refresh/rooms/client/snapshot-change-merge.ts —— 变化集并进手上那份快照（#1891，规格 #1885 S4；#1885 评审修复）
 *
 * 为什么单列一片：同步引擎（snapshot-version-sync.ts）管「什么时候取」，这一片只管「取回来怎么并」。
 * 两件事的变化原因不同 —— 信号源换了引擎要动，行的形状变了这一片才动 —— 合在一份会让彼此互相牵制，
 * 也会把两片的有效行一起顶到 350 行的上限。
 *
 * 四条不能改的约定：
 *  1. 按行并、不整份重拼：没变的行连对象引用都不换，界面据此只重画变化的那几行；
 *     容器（maps）只在真有子票变动时才换对象。
 *  2. 只写这一趟真正表达了的字段组：换算只此一份（src/shared/snapshot-row-fields.ts，构建时把同一份
 *     文本拼进闭包）。组记录缺席 / unknown / truncated + 空一律不写，不补空数组、不补 null ——
 *     并进已有行时不拿「不知道」去盖「已知」（规格 I6 三态）。
 *  3. 「这一行该放在哪里」由宿主的回包说了算（item.placement，见快照库变化集投影）：
 *     map = 这一行自己是容器，child = 挂到哪个容器的子票里，thin = 已关闭容器里已关闭子票的瘦身行，
 *     issue = 未挂图票。客户端不查 parentKey、不自己判容器归属（规格 D1「领域规则一处实现」）。
 *     老回包没有这一格时按 issue（未挂图票）机械落位，不重新实现一遍规则。
 *  4. 墓碑行从四处一起拿掉（未挂图票、容器子票、容器本身、瘦身行）；容器自己被判不存在时整个拿掉。
 *     删除与否是宿主回包（missing）的决定，这里只照单执行，不猜「没出现就是删了」。
 *
 * 反例：不要在这里按时间判新旧、不要在这里发任何电话；合并结果只依赖入参、options.idOf 与
 * options.rowFieldsOf（缺省用闭包里拼进来的那一份）。
 */

// 客户端半边不能运行时 import：这一份换算由 scripts/build.mts 的 SHARED_SPLICE 把同一份源码
// （src/shared/snapshot-row-fields.ts）拼进闭包。门禁单独求值本文件时，调用方经 options.rowFieldsOf
// 把同一份函数递进来；两边跑的是同一个实现，不是第二份拷贝。
declare function snapshotRowFieldsOf(item: any): any

/** 变化集并进之后的结果：新的手上那份 + 这次真正换了内容 / 被拿掉的那些行（界面按这份名单重画）。 */
export interface SnapshotChangeMerge {
  snapshot: any
  redrawn: string[]
  removed: string[]
}

/** 只认非负整数版本：0 是合法版本，不能被当成「没有」。 */
function mergeVersionNumber(value: any): number | null {
  return (typeof value === 'number' && Number.isInteger(value) && value >= 0) ? value : null
}

/** 来者的库版本比手上那份新才算更新；任何一边不知道都回 false（不知道 ≠ 更新）。 */
export function isNewerSnapshotVersion(incoming: any, current: any): boolean {
  const a = mergeVersionNumber(incoming)
  const b = mergeVersionNumber(current)
  if (a === null || b === null) return false
  return a > b
}

/** 毫秒转 ISO；没有时间回 null（不拿 1970 冒充「时间不知道」）。 */
function changeIsoOf(value: any): string | null {
  return (typeof value === 'number' && Number.isFinite(value)) ? new Date(value).toISOString() : null
}

/** 这一行该落在哪里；老回包没有 placement 时按未挂图票机械兜底（不重算领域规则）。 */
interface ChangePlacement {
  place: 'map' | 'child' | 'thin' | 'issue'
  containerEffortId?: string
  containerKey?: string
}

function changePlacementOf(item: any): ChangePlacement {
  const p = item && item.placement
  if (p && p.place === 'map') return p
  if (p && p.place === 'child') return p
  if (p && p.place === 'thin') return p
  return { place: 'issue' }
}

/**
 * 库列表投影的一行 → 能并进界面行的那几格。换算是共享的那一份（snapshotRowFieldsOf），
 * 这一层只做形状收窄：界面行状态大写、时间 ISO；不知道的字段一律不出现。
 */
export function changeRowPatch(item: any, rowFieldsOf?: ((row: any) => any) | null): any {
  const fieldsOf = (typeof rowFieldsOf === 'function')
    ? rowFieldsOf
    : (typeof snapshotRowFieldsOf === 'function' ? snapshotRowFieldsOf : null)
  if (!fieldsOf) throw new Error('变化集合并没有行换算：客户端闭包里没有 snapshotRowFieldsOf，调用方也没交 options.rowFieldsOf')
  const f = fieldsOf(item)
  const patch: any = { key: f.key }
  if (f.number !== null) patch.number = f.number
  patch.effortId = f.effortId
  if (f.type.known) patch.type = f.type.value
  if (f.title.known) patch.title = f.title.value
  if (f.state.known) patch.state = f.state.value === 'closed' ? 'CLOSED' : 'OPEN'
  if (f.url.known) patch.url = f.url.value
  if (f.createdAtMs.known) patch.createdAt = changeIsoOf(f.createdAtMs.value)
  if (f.updatedAtMs.known) patch.updatedAt = changeIsoOf(f.updatedAtMs.value)
  if (f.closedAtMs.known) patch.closedAt = changeIsoOf(f.closedAtMs.value)
  if (f.isPullRequest.known) patch.isPullRequest = f.isPullRequest.value
  if (f.commentCount.known) patch.commentCount = f.commentCount.value
  if (f.reason.known) patch.reason = f.reason.value
  if (f.status.known) patch.status = f.status.value
  if (f.statusVisible.known) patch.statusVisible = f.statusVisible.value
  if (f.statusSource.known) patch.statusSource = f.statusSource.value
  if (f.labels.known) patch.labels = f.labels.value
  if (f.assignees.known) patch.assignees = f.assignees.value
  if (f.parentKey.known) patch.parentKey = f.parentKey.value
  if (f.blockedBy.known) patch.blockedBy = f.blockedBy.value
  if (f.mergedAtMs.known) patch.mergedAt = changeIsoOf(f.mergedAtMs.value)
  return patch
}

/** 两格的「是不是同一份内容」：只用来决定这一行要不要重画，不用来判新旧。 */
function changeSameValue(a: any, b: any): boolean {
  if (a === b) return true
  try { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b) } catch (e) { return false }
}

/**
 * 把变化集并进手上那份快照。手上那份不是可合并的快照（没有 maps/issues）时回 null ——
 * 调用方按「没有基线」整份重取，绝不把半份数据装上去。
 *
 * options.idOf 是票身份算法（(effortId, key) 现算一把），由调用方从闭包里的那一份传进来：
 * 这一片不能运行时 import，也不该自己再写一份身份算法。
 * options.rowFieldsOf 只给门禁直接 import 本文件时用；生产闭包里用拼进来的共享换算。
 */
export function applySnapshotChangeSet(
  snapshot: any,
  changes: any,
  missing: any,
  options: { idOf: (row: any) => string, counts?: any, rowFieldsOf?: ((row: any) => any) | null },
): SnapshotChangeMerge | null {
  if (!snapshot || snapshot.ok !== true || !Array.isArray(snapshot.maps) || !Array.isArray(snapshot.issues)) return null
  if (!options || typeof options.idOf !== 'function') return null
  const identity = options.idOf
  const fieldsOf = (typeof options.rowFieldsOf === 'function') ? options.rowFieldsOf : null
  const maps: any[] = snapshot.maps.slice()
  const issues: any[] = snapshot.issues.slice()
  const thin: any[] = Array.isArray(snapshot.thinTickets) ? snapshot.thinTickets.slice() : []
  const redrawn: string[] = []
  const removed: string[] = []
  const clonedMaps: Record<number, boolean> = {}

  const writableMap = function (index: number): any {
    if (!clonedMaps[index]) { maps[index] = Object.assign({}, maps[index], { tickets: (maps[index].tickets || []).slice() }); clonedMaps[index] = true }
    return maps[index]
  }
  const mapIndexOf = function (effortId: any, key: any): number {
    const want = identity({ effortId: String(effortId === null || effortId === undefined ? '' : effortId), key: String(key === null || key === undefined ? '' : key) })
    for (let mi = 0; mi < maps.length; mi++) if (identity(maps[mi]) === want) return mi
    return -1
  }
  const issueIndexOf = function (id: string): number {
    for (let i = 0; i < issues.length; i++) if (identity(issues[i]) === id) return i
    return -1
  }
  const thinIndexOf = function (id: string): number {
    for (let i = 0; i < thin.length; i++) if (identity(thin[i]) === id) return i
    return -1
  }
  const differs = function (held: any, patch: any): boolean {
    const keys = Object.keys(patch)
    for (let i = 0; i < keys.length; i++) if (!changeSameValue(held[keys[i]], patch[keys[i]])) return true
    return false
  }
  /** 把这一行从所有「票所在的位置」拿掉（容器本身不在内）：换位置、或墓碑都走这一句。 */
  const detachFromPlaces = function (id: string): boolean {
    let hit = false
    const at = issueIndexOf(id)
    if (at >= 0) { issues.splice(at, 1); hit = true }
    const thinAt = thinIndexOf(id)
    if (thinAt >= 0) { thin.splice(thinAt, 1); hit = true }
    for (let mi = 0; mi < maps.length; mi++) {
      const tickets = maps[mi].tickets || []
      for (let ti = tickets.length - 1; ti >= 0; ti--) if (identity(tickets[ti]) === id) { writableMap(mi).tickets.splice(ti, 1); hit = true }
    }
    return hit
  }
  const putIssue = function (id: string, patch: any): void {
    const at = issueIndexOf(id)
    if (at >= 0) {
      if (!differs(issues[at], patch)) return
      issues[at] = Object.assign({}, issues[at], patch)
      redrawn.push(id)
      return
    }
    issues.push(Object.assign({}, patch))
    redrawn.push(id)
  }
  const putMap = function (id: string, patch: any): void {
    for (let mi = 0; mi < maps.length; mi++) {
      if (identity(maps[mi]) !== id) continue
      if (!differs(maps[mi], patch)) return
      // 更新容器头时保留它已经拼好的 tickets / stats 等派生格（补丁只表达这一行知道的字段）。
      maps[mi] = Object.assign({}, maps[mi], patch)
      redrawn.push(id)
      return
    }
    detachFromPlaces(id)
    maps.push(Object.assign({ tickets: [] }, patch))
    redrawn.push(id)
  }
  const putChild = function (id: string, patch: any, placement: ChangePlacement): void {
    const mi = mapIndexOf(placement.containerEffortId, placement.containerKey)
    if (mi < 0) { putIssue(id, patch); return }
    const map = writableMap(mi)
    for (let ti = 0; ti < map.tickets.length; ti++) {
      if (identity(map.tickets[ti]) !== id) continue
      if (!differs(map.tickets[ti], patch)) return
      map.tickets[ti] = Object.assign({}, map.tickets[ti], patch)
      redrawn.push(id)
      return
    }
    detachFromPlaces(id)
    map.tickets.push(Object.assign({}, patch))
    redrawn.push(id)
  }
  const putThin = function (id: string, patch: any, placement: ChangePlacement): void {
    // 瘦身行只留查标题要用的四样（标题目录、状态、类型、身份），与组装层 thinRowOf 同口径。
    const next = Object.assign({}, (thinIndexOf(id) >= 0 ? thin[thinIndexOf(id)] : {}), {
      key: patch.key,
      number: patch.number || 0,
      effortId: patch.effortId,
      type: patch.type || 'issue',
      state: 'CLOSED',
      title: patch.title || '',
    })
    const at = thinIndexOf(id)
    if (at >= 0) {
      if (!differs(thin[at], next)) return
      thin[at] = next
      redrawn.push(id)
      return
    }
    detachFromPlaces(id)
    thin.push(next)
    redrawn.push(id)
  }
  const placeRow = function (id: string, patch: any, placement: ChangePlacement): void {
    if (placement.place === 'map') { putMap(id, patch); return }
    if (placement.place === 'thin') { putThin(id, patch, placement); return }
    if (placement.place === 'child') { putChild(id, patch, placement); return }
    putIssue(id, patch)
  }

  ;(Array.isArray(changes) ? changes : []).forEach(function (item: any): void {
    const patch = changeRowPatch(item, fieldsOf)
    const id = identity(patch)
    if (!id) return
    placeRow(id, patch, changePlacementOf(item))
  })

  ;(Array.isArray(missing) ? missing : []).forEach(function (tomb: any): void {
    const id = identity({ effortId: String((tomb && tomb.effortId) || ''), key: (tomb && tomb.key) })
    if (!id) return
    let hit = detachFromPlaces(id)
    for (let mi = maps.length - 1; mi >= 0; mi--) if (identity(maps[mi]) === id) { maps.splice(mi, 1); hit = true }
    if (hit) removed.push(id)
  })

  // #1887：变化集回包带着库的六个数字。换行与换数字必须在同一次合并里落地：
  //   只换行会让界面上的数字落后于列表，只换数字又会在下一次渲染时被旧的 deck 盖回去。
  const out: any = Object.assign({}, snapshot, { maps: maps, issues: issues, thinTickets: thin })
  if (options.counts !== undefined) {
    const deck: any = Object.assign({}, (snapshot.deck && typeof snapshot.deck === 'object') ? snapshot.deck : {})
    if (options.counts) deck.counts = options.counts
    else delete deck.counts
    out.deck = deck
  }
  return { snapshot: out, redrawn: redrawn, removed: removed }
}
