/**
 * src/refresh/rooms/client/snapshot-change-merge.ts —— 变化集并进手上那份快照（#1891，规格 #1885 S4）
 *
 * 为什么单列一片：同步引擎（snapshot-version-sync.ts）管「什么时候取」，这一片只管「取回来怎么并」。
 * 两件事的变化原因不同 —— 信号源换了引擎要动，行的形状变了这一片才动 —— 合在一份会让彼此互相牵制，
 * 也会把两片的有效行一起顶到 350 行的上限。
 *
 * 三条不能改的约定：
 *  1. 按行并、不整份重拼：没变的行连对象引用都不换，界面据此只重画变化的那几行；
 *     容器（maps）只在真有子票变动时才换对象。
 *  2. 只写这一趟真正表达了的字段组：组记录缺席（null）表示「没取过」，不写、不补空数组 ——
 *     并进已有行时不拿「不知道」去盖「已知」（规格 I6 三态）。
 *  3. 墓碑行从四处一起拿掉（未挂图票、容器子票、容器本身、瘦身行）；容器自己被判不存在时整个拿掉。
 *
 * 反例：不要在这里按时间判新旧、不要在这里发任何电话；合并结果只依赖入参与 options.idOf。
 */

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

/** 界面的状态口径是大写 OPEN / CLOSED（电话层 upcaseSnapStates 的约定）；认不出的状态不写。 */
function changeStateWord(value: any): string {
  const text = String(value === null || value === undefined ? '' : value).toUpperCase()
  return text === 'CLOSED' ? 'CLOSED' : (text === 'OPEN' ? 'OPEN' : '')
}

function changeLabelOf(item: any): any {
  const out: any = { name: String((item && item.name) || '') }
  if (item && typeof item.color === 'string') out.color = item.color
  if (item && typeof item.description === 'string' && item.description) out.description = item.description
  return out
}

function changePersonOf(item: any): any {
  const out: any = { login: String((item && item.login) || '') }
  if (item && item.name) out.name = item.name
  if (item && item.avatarUrl) out.avatarUrl = item.avatarUrl
  return out
}

/**
 * 库列表投影的一行 → 能并进界面行的那几格。
 *
 * 界面自己算出来的列（progress / claimedBy / level 之类）不在这里出现，原样留着：
 * 变化集只表达「这一行的这一组是什么」，没表达的那些组一个字节都不许动。
 */
export function changeRowPatch(item: any): any {
  const row = (item && item.row) || {}
  const groups = (item && item.groups) || {}
  const rawKey = (item && item.key) === null || (item && item.key) === undefined ? '' : item.key
  const patch: any = { key: String(rawKey) }
  if (/^[0-9]+$/.test(patch.key)) patch.number = Number(patch.key)
  patch.effortId = String((item && item.effortId) || '')
  patch.type = (row.type === 'map' || row.type === 'spec') ? row.type : 'issue'
  if (row.title !== null && row.title !== undefined) patch.title = String(row.title)
  const state = changeStateWord(row.state)
  if (state) patch.state = state
  if (typeof row.url === 'string' && row.url) patch.url = row.url
  const created = changeIsoOf(row.createdAtMs)
  if (created) patch.createdAt = created
  const updated = changeIsoOf(row.updatedAtMs)
  if (updated) patch.updatedAt = updated
  if (row.closedAtMs !== undefined) patch.closedAt = changeIsoOf(row.closedAtMs)
  if (typeof row.isPullRequest === 'boolean') patch.isPullRequest = row.isPullRequest
  if (typeof row.commentCount === 'number') patch.commentCount = row.commentCount
  if (row.stateReason) patch.reason = row.stateReason
  if (row.status) patch.status = row.status
  if (row.statusVisible) patch.statusVisible = row.statusVisible
  if (row.statusSource) patch.statusSource = row.statusSource
  if (groups.labels) patch.labels = Array.isArray(item.labels) ? item.labels.map(changeLabelOf) : []
  if (groups.assignees) patch.assignees = Array.isArray(item.assignees) ? item.assignees.map(changePersonOf) : []
  if (groups.parents) patch.parentKey = (Array.isArray(item.parents) && item.parents.length) ? String(item.parents[0]) : null
  if (groups.mergeInfo) patch.mergedAt = typeof item.mergedAtMs === 'number' ? changeIsoOf(item.mergedAtMs) : null
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
 */
export function applySnapshotChangeSet(snapshot: any, changes: any, missing: any, options: { idOf: (row: any) => string }): SnapshotChangeMerge | null {
  if (!snapshot || snapshot.ok !== true || !Array.isArray(snapshot.maps) || !Array.isArray(snapshot.issues)) return null
  if (!options || typeof options.idOf !== 'function') return null
  const identity = options.idOf
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
  const placeOf = function (id: string): any {
    for (let i = 0; i < issues.length; i++) if (identity(issues[i]) === id) return { kind: 'issue', index: i }
    for (let mi = 0; mi < maps.length; mi++) {
      const tickets = maps[mi].tickets || []
      for (let ti = 0; ti < tickets.length; ti++) if (identity(tickets[ti]) === id) return { kind: 'ticket', mapIndex: mi, index: ti }
    }
    return null
  }
  const putRow = function (patch: any): void {
    const parentKey = patch.parentKey
    if (parentKey) {
      const want = identity({ effortId: patch.effortId, key: parentKey })
      for (let mi = 0; mi < maps.length; mi++) {
        if (identity(maps[mi]) !== want) continue
        if (String(maps[mi].state || '').toUpperCase() === 'CLOSED' && patch.state === 'CLOSED') {
          thin.push({ key: patch.key, number: patch.number || 0, effortId: patch.effortId, type: patch.type, state: 'CLOSED', title: patch.title || '' })
          return
        }
        writableMap(mi).tickets.push(Object.assign({}, patch))
        return
      }
    }
    issues.push(Object.assign({}, patch))
  }
  const differs = function (held: any, patch: any): boolean {
    const keys = Object.keys(patch)
    for (let i = 0; i < keys.length; i++) if (!changeSameValue(held[keys[i]], patch[keys[i]])) return true
    return false
  }

  ;(Array.isArray(changes) ? changes : []).forEach(function (item: any): void {
    const patch = changeRowPatch(item)
    const id = identity(patch)
    if (!id) return
    const place = placeOf(id)
    if (place && place.kind === 'issue') {
      if (!differs(issues[place.index], patch)) return
      issues[place.index] = Object.assign({}, issues[place.index], patch)
      redrawn.push(id)
      return
    }
    if (place && place.kind === 'ticket') {
      const held = maps[place.mapIndex].tickets[place.index]
      if (!differs(held, patch)) return
      writableMap(place.mapIndex).tickets[place.index] = Object.assign({}, held, patch)
      redrawn.push(id)
      return
    }
    const thinAt = thin.findIndex(function (x: any): boolean { return identity(x) === id })
    if (thinAt >= 0) {
      if (patch.state !== 'CLOSED') {
        thin.splice(thinAt, 1)
        putRow(patch)
        redrawn.push(id)
        return
      }
      if (differs(thin[thinAt], patch)) {
        thin[thinAt] = Object.assign({}, thin[thinAt], { title: patch.title, state: 'CLOSED', type: patch.type, key: patch.key })
        redrawn.push(id)
      }
      return
    }
    putRow(patch)
    redrawn.push(id)
  })

  ;(Array.isArray(missing) ? missing : []).forEach(function (tomb: any): void {
    const id = identity({ effortId: String((tomb && tomb.effortId) || ''), key: (tomb && tomb.key) })
    if (!id) return
    let hit = false
    for (let i = issues.length - 1; i >= 0; i--) if (identity(issues[i]) === id) { issues.splice(i, 1); hit = true }
    for (let mi = maps.length - 1; mi >= 0; mi--) {
      const tickets = maps[mi].tickets || []
      for (let ti = tickets.length - 1; ti >= 0; ti--) if (identity(tickets[ti]) === id) { writableMap(mi).tickets.splice(ti, 1); hit = true }
      if (identity(maps[mi]) === id) { maps.splice(mi, 1); hit = true }
    }
    for (let i = thin.length - 1; i >= 0; i--) if (identity(thin[i]) === id) { thin.splice(i, 1); hit = true }
    if (hit) removed.push(id)
  })

  return { snapshot: Object.assign({}, snapshot, { maps: maps, issues: issues, thinTickets: thin }), redrawn: redrawn, removed: removed }
}