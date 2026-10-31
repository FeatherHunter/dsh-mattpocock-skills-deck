/**
 * views/shared/notificationCenterModel.ts — 面板内通知中心的判据与取数（票 #1697）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回 src/client/index.ts
 * 的 leaf:notificationCenterModel 标记处（源码树里只有这一份真源）。
 *
 * 这个文件只放「怎么算」：事件怎么排、哪条算未读、时间怎么说、轻提示该不该响、取数处于哪一档。
 * 「怎么画」在 views/shared/notificationCenter.ts（徽标入口与历史浮层两个组件）。
 *
 * 三条不能改的约定（ADR docs/adr/20261030-panel-snapshot-single-source.md §2.6，规格 §12）：
 * 1) 当前是否降级永远从快照的 fallback 标记派生（noticeCurrentDegradedOf 只读 st.snapshot.fallback）；
 *    事件库只记历史。历史里还有未闭合的降级、快照却说已恢复时，界面按快照说当前正常，
 *    另给一句「历史与当前对不上」的说明 —— 不许拿历史冒充现在，也不许把事件库反写成快照。
 * 2) 未读与已读标记是会话呈现态：只写 sessionStorage（键里带工作区，各开会话各记各的），
 *    不写快照、不写事件库、不落盘。
 * 3) 轻提示只回声「刚发生的最新一条」：第一次读到历史只当基线、不补响；之后最新一条换了才响一次。
 *    历史永不靠轻提示补，关掉面板期间发生的往事由通知中心的历史列表自己说。
 *
 * 取数走宿主电话 wf.notifications（返回 { ok, events }，事件来自宿主侧事件库）；
 * 还没读到、读坏了、宿主版本太旧没有这条电话时，readable=false，入口与历史都不画，
 * 不拿「没有通知」冒充「读不到」。
 */
declare const React: any
declare const host: any
declare const flash: any
declare const tr: any
// 新鲜度三档取色映射（views/shared/truthLines.ts）：警告档的琥珀只住那个文件，这里不再抄一份。
declare function freshnessToneColor(...args: any[]): any

/** 宿主侧四类事件，顺序与 src/refresh/kernel/notification-events.ts 的类型清单一致（筛选按钮照它排）。 */
export const NOTICE_TYPES = ['degraded-start', 'degraded-recovery', 'refresh-failed', 'write-failed']

/** 事件类型 → 类型名的词条键。不认识的类型不猜，统一说「其他通知」。 */
export const noticeTypeKeyOf = function (type: any) {
  const t = String(type || '')
  if (t === 'degraded-start') return 'notice.type.degradedStart'
  if (t === 'degraded-recovery') return 'notice.type.degradedRecovery'
  if (t === 'refresh-failed') return 'notice.type.refreshFailed'
  if (t === 'write-failed') return 'notice.type.writeFailed'
  return 'notice.type.unknown'
}

/** 一条事件在历史列表里的标题（说「发生了什么」，不说严重级别）。 */
export const noticeTitleOf = function (event: any) {
  const t = String((event && event.type) || '')
  if (t === 'degraded-start') return tr('notice.event.degradedStart')
  if (t === 'degraded-recovery') return tr('notice.event.degradedRecovery')
  if (t === 'refresh-failed') return tr('notice.event.refreshFailed')
  if (t === 'write-failed') return tr('notice.event.writeFailed')
  return tr('notice.event.unknown')
}

/** 轻提示与列表圆点的语气：恢复是好事，其余三类是警告，不认识的中性。 */
export const noticeToneOf = function (event: any) {
  const t = String((event && event.type) || '')
  if (t === 'degraded-recovery') return 'ok'
  if (t === 'degraded-start' || t === 'refresh-failed' || t === 'write-failed') return 'warn'
  return 'muted'
}

/**
 * 语气的颜色（只用于圆点与未读数字；正文颜色仍由主题令牌决定）。
 * 警告档不自己写一份琥珀：借 views/shared/truthLines.ts 的 freshnessToneColor（新鲜度三档映射）
 * 里的 yellow 档，颜色值只住那一个文件；成功与中性档取设计系统变量、取不到时用同义兜底色，
 * 避免把容器空态橙与完成态绿的两个字面量在这条通知呈现路径上再抄一遍。
 */
export const noticeToneColorOf = function (tone: any) {
  if (tone === 'ok') return 'var(--dsw-alias-state-success-primary,#4ade80)'
  if (tone === 'warn') return freshnessToneColor('yellow')
  return 'var(--dsw-alias-label-caption,#8b8b95)'
}

export const noticeColorOf = function (event: any) {
  return noticeToneColorOf(noticeToneOf(event))
}

/**
 * 事件开始时刻 → 人话。刚发生说「刚刚」，一小时内按分钟、一天内按小时、再久按天；
 * 超过一天不细到小时是故意的：历史里要的是「大概多久以前」，不是精确时间戳。
 */
export const noticeTimeTextOf = function (now: any, at: any) {
  const n = typeof now === 'number' ? now : Date.now()
  const t = Number(at) || 0
  if (!t) return ''
  const gap = Math.max(0, n - t)
  if (gap < 60000) return tr('notice.time.justNow')
  if (gap < 3600000) return tr('notice.time.minutesAgo', { n: Math.floor(gap / 60000) })
  if (gap < 86400000) return tr('notice.time.hoursAgo', { n: Math.floor(gap / 3600000) })
  return tr('notice.time.daysAgo', { n: Math.floor(gap / 86400000) })
}

/** 排序键：开始时刻、最后更新时刻、事件 id（三道都相同才并列，保证每次渲染顺序一致）。 */
const noticeSortValueOf = function (event: any): [number, number, string] {
  const e = event || {}
  const started = Number(e.startedAt) || 0
  const updated = Number(e.updatedAt) || 0
  return [started, updated, String(e.id || '')]
}

/** 历史一律新的在上：开始时刻晚的在前，同刻按更新时刻，再同按 id 倒序。 */
export const noticeNewerFirstOf = function (a: any, b: any) {
  const av = noticeSortValueOf(a)
  const bv = noticeSortValueOf(b)
  if (av[0] !== bv[0]) return bv[0] - av[0]
  if (av[1] !== bv[1]) return bv[1] - av[1]
  return av[2] < bv[2] ? 1 : (av[2] > bv[2] ? -1 : 0)
}

/** 最新一条（按同一套排序键）；空历史给 null。轻提示只认这一条。 */
export const noticeLatestOf = function (events: any) {
  const list = Array.isArray(events) ? events : []
  let best: any = null
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (!e || typeof e !== 'object') continue
    if (!best || noticeNewerFirstOf(e, best) < 0) best = e
  }
  return best
}

/** 某一笔是否已读：已读标记只按事件 id 记，不按类型或时间推断。 */
export const noticeIsReadOf = function (readIds: any, id: any) {
  if (!readIds || typeof readIds !== 'object') return false
  return Object.prototype.hasOwnProperty.call(readIds, String(id || ''))
}

/** 未读条数：只数有 id 的事件；读不到历史时由调用方按 readable=false 整块不画，不走这里。 */
export const noticeUnreadOf = function (events: any, readIds: any) {
  const list = Array.isArray(events) ? events : []
  let n = 0
  for (let i = 0; i < list.length; i++) {
    const id = String((list[i] && list[i].id) || '')
    if (id && !noticeIsReadOf(readIds, id)) n++
  }
  return n
}

/**
 * 历史列表要画的那些行：先按筛选（all 或四类之一）过滤，再按新的在上排。
 * 行里只带画界面要用的东西（标题、时间、次数、说明、已读），不把事件原样漏给视图层。
 */
export const noticeRowsOf = function (events: any, filter: any, readIds: any, now: any) {
  const list = Array.isArray(events) ? events.slice() : []
  const f = String(filter || 'all')
  list.sort(noticeNewerFirstOf)
  const rows: any[] = []
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (!e || typeof e !== 'object') continue
    const type = String(e.type || '')
    if (f !== 'all' && type !== f) continue
    const id = String(e.id || '')
    if (!id) continue
    rows.push({
      id: id,
      type: type,
      title: noticeTitleOf(e),
      tone: noticeToneOf(e),
      color: noticeColorOf(e),
      time: noticeTimeTextOf(now, e.startedAt),
      count: Math.max(1, Number(e.count) || 1),
      detail: String(e.detail || ''),
      read: noticeIsReadOf(readIds, id),
    })
  }
  return rows
}

/** 未读标记的存储键：会话呈现态，键里带工作区；同一浏览器不同会话各记各的。 */
export const noticeReadKeyOf = function (st: any) {
  const snap = (st && st.snapshot) || null
  const where = (st && st.cwd) || (snap && (snap.repoRoot || snap.repo)) || ''
  return 'dsws.noticeRead:' + String(where)
}

/** 把 sessionStorage 里读回的原样数据收成 { 事件id: 标记时刻 }；坏数据一律当「都没读过」。 */
export const noticeReadIdsOf = function (raw: any) {
  const out: any = {}
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) if (raw[i]) out[String(raw[i])] = 1
    return out
  }
  if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw)
    for (let i = 0; i < keys.length; i++) out[String(keys[i])] = Number(raw[keys[i]]) || 1
  }
  return out
}

/** 从 sessionStorage 读这一把键上的已读标记；没值、坏 JSON 都当空。 */
export const noticeReadIdsRawOf = function (key: any) {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const text = sessionStorage.getItem(String(key))
    if (!text) return null
    return noticeReadIdsOf(JSON.parse(text))
  } catch (e) {
    return null
  }
}

/**
 * 写已读标记。超过 500 条时按标记时刻从旧到新丢（会话呈现态只留最近一批，不让存储无限长）；
 * 写不进去（隐私模式）不抛，退化成「这一会话里读过的只在内存里」。
 */
export const noticeSaveReadIdsOf = function (key: any, ids: any) {
  try {
    if (typeof sessionStorage === 'undefined') return false
    const src = (ids && typeof ids === 'object') ? ids : {}
    const keys = Object.keys(src)
    const kept: any = {}
    if (keys.length > 500) {
      keys.sort(function (a: any, b: any) { return (Number(src[a]) || 0) - (Number(src[b]) || 0) })
      for (let i = keys.length - 500; i < keys.length; i++) kept[keys[i]] = src[keys[i]]
    } else {
      for (let i = 0; i < keys.length; i++) kept[keys[i]] = src[keys[i]]
    }
    sessionStorage.setItem(String(key), JSON.stringify(kept))
    return true
  } catch (e) {
    return false
  }
}

/** 「全部已读」：把当前历史里每条都记上（已在的不动），返回新的标记表。 */
export const noticeAllReadIdsOf = function (oldIds: any, events: any) {
  const out = noticeReadIdsOf(oldIds)
  const now = Date.now()
  const list = Array.isArray(events) ? events : []
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    const id = String((e && e.id) || '')
    if (id && !Object.prototype.hasOwnProperty.call(out, id)) out[id] = Number(e.updatedAt) || now
  }
  return out
}

/**
 * 轻提示该不该响：第一次读到历史（prevId 还不是字符串）只当基线、不响；
 * 之后最新一条的 id 变了才响一次。返回 { next, echo }：next 是下一回的基线，echo 是要响的那条（不响给 null）。
 */
export const noticeEchoOf = function (prevId: any, events: any) {
  const latest = noticeLatestOf(events)
  const next = latest ? String(latest.id || '') : ''
  const echo = (typeof prevId === 'string' && next !== '' && next !== prevId) ? latest : null
  return { next: next, echo: echo }
}

/** 轻提示那一句：标题 + 次数（同一原因在去重窗口里合并过就带上「发生 N 次」）。 */
export const noticeToastTextOf = function (event: any) {
  const title = noticeTitleOf(event)
  const count = Math.max(1, Number((event && event.count) || 1))
  return count > 1 ? title + ' ' + tr('notice.times', { n: count }) : title
}

/** 当前是否降级：只从快照的 fallback 标记派生（规格 §12、ADR §2.6 的第一条）。 */
export const noticeCurrentDegradedOf = function (st: any) {
  const snap = (st && st.snapshot) || null
  return !!(snap && snap.fallback === 'rest')
}

/**
 * 历史与当前对不对得上：历史里有一段未闭合的降级（endedAt 为空），而快照说当前正常，或反过来。
 * 对不上时界面按快照说当前状态，另补一句说明 —— 事件库只做历史，不改写现在。
 */
export const noticeHistoryMismatchOf = function (st: any, events: any) {
  const list = Array.isArray(events) ? events : []
  let open = false
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (e && e.type === 'degraded-start' && (e.endedAt === null || e.endedAt === undefined)) open = true
  }
  return open !== noticeCurrentDegradedOf(st)
}

/** 头部要不要让出一格给徽标：读得到历史且有未读才出现（没有未读就整颗不画，不占窄面板的地方）。 */
export const noticeHeadBadgeOf = function (view: any) {
  return (view && view.readable && Number(view.unread) > 0) ? 'badge' : ''
}

/** 徽标上的数字：0 或读不到给空串（不画数字），超过 99 说 99+。 */
export const noticeUnreadTextOf = function (view: any) {
  if (!view || !view.readable) return ''
  const n = Number(view.unread) || 0
  if (n <= 0) return ''
  if (n > 99) return '99+'
  return String(n)
}

/** 快照换版（或工作区换人）就重新取一次历史：版本号、etag 与生成时刻任一变了都算换版。 */
export const noticeVersionOf = function (st: any) {
  const snap = (st && st.snapshot) || null
  if (!snap) return ''
  return String(snap.version || '') + '|' + String(snap.etag || '') + '|' + String(snap.generatedMs || '') + '|' + String(snap.updatedAt || '')
}

/**
 * 取数 hook：从宿主事件库读历史、维护本会话的已读标记、在最新一条换了时回声一条轻提示。
 * 返回 { readable, loading, events, unread, latest, readIds, key, markAllRead, clearRead, refresh }。
 * 这里不排任何定时器：重取只跟着快照换版、工作区切换、面板打开时调 refresh 走（ADR I2：不新增后台定时器）。
 */
export const useNotifications = function (st: any) {
  const key = noticeReadKeyOf(st)
  const ver = noticeVersionOf(st)
  const cwd = (st && st.cwd) || ''
  const [view, setView] = React.useState({ readable: false, loading: true, events: [] })
  const [readIds, setReadIds] = React.useState(function () { return noticeReadIdsOf(noticeReadIdsRawOf(key)) })
  const [tick, setTick] = React.useState(0)
  const seenRef: any = React.useRef(undefined)
  React.useEffect(function () {
    let alive = true
    setReadIds(noticeReadIdsOf(noticeReadIdsRawOf(key)))
    const call = (typeof host !== 'undefined' && host && typeof host.call === 'function') ? host.call('wf.notifications', { cwd: cwd }) : null
    Promise.resolve(call).then(function (res: any) {
      if (!alive) return
      const list = (res && Array.isArray(res.events)) ? res.events : (Array.isArray(res) ? res : null)
      setView({ readable: list !== null, loading: false, events: list || [] })
      if (list === null) return
      const step = noticeEchoOf(seenRef.current, list)
      seenRef.current = step.next
      if (!step.echo) return
      try { if (typeof flash === 'function') flash(st, noticeToastTextOf(step.echo), noticeToneOf(step.echo)) } catch (eF) {}
    }, function () { if (alive) setView({ readable: false, loading: false, events: [] }) })
    return function () { alive = false }
  }, [key, ver, cwd, tick])
  const unread = noticeUnreadOf(view.events, readIds)
  const latest = noticeLatestOf(view.events)
  const markAllRead = function () {
    const ids = noticeAllReadIdsOf(readIds, view.events)
    noticeSaveReadIdsOf(key, ids)
    setReadIds(ids)
  }
  const clearRead = function () {
    noticeSaveReadIdsOf(key, {})
    setReadIds({})
  }
  const refresh = function () { setTick(function (t: any) { return (Number(t) || 0) + 1 }) }
  return { readable: !!view.readable, loading: !!view.loading, events: view.events, unread: unread, latest: latest, readIds: readIds, key: key, markAllRead: markAllRead, clearRead: clearRead, refresh: refresh }
}
