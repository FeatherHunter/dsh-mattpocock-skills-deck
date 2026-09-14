/**
 * views/labels/labelColorPatch.js — 保存成功后把后端确认的颜色写进面板那份快照（#635 新增）
 *
 * 要解决的问题（#635 正文里写的第 2 条）：改色保存成功之后，右侧面板上的标签颜色不会自己变，
 * 要手动刷新一次才看到新色。原因不是「没有刷新」——现在是有的，问题是那次刷新太慢：
 * 面板那一次走的是「重新拉一份全量快照」，在 GitHub 工作区上实测要二十多秒（真机日志里两次
 * 分别记了 23667 与 29608 毫秒），而弹窗那边一两秒就报保存成功了。用户等不到二十多秒，
 * 看到的就是「说保存成功了、颜色却没变」。
 *
 * 所以这里不靠等它：保存成功那一刻，后端已经在回包里告诉了界面「哪几个标签改成了什么颜色」，
 * 那就当场把这几条写进面板正在用的那份快照（面板代码里的 `st.snapshot`），面板立刻按新色显示。
 * 那次全量重拉照旧在后台跑，它管的是别的变化（新开的票、改了标题的票这些）。
 *
 * 写进去的一律是**后端确认过的**色值（用配色核心的 `normalizeColor` 归一成不带井号的小写六位），
 * 不是用户填进格子的原文——原文可能带井号、大小写不一致，谁对由后端裁决。
 * 这不算「乐观刷新」：乐观刷新指的是还没拿到后端答复就先按用户的输入改界面；这里等的就是后端答复。
 *
 * 三个函数，一份记录（记录存在面板自己的 store 上，字段名 `lcSavedColors`）：
 *   - `lcRememberSavedColors`：保存成功后记一笔「这几个标签，在 at 这一刻被后端确认成了这个样子」。
 *   - `lcPanelSavedColors`：面板在收到「保存成功」时要做的第一件事——记一笔，并把它写进当前那份快照。
 *   - `lcApplySavedColorsOnInstall`：任何一份快照被装进面板时都要过这一道。这份快照如果是在那一笔
 *     记录**之前**生成的（保存前就发出去、保存后才回来的那一次刷新），它不知道这次改色，就按记录
 *     把那几个标签补上，别让面板倒回旧色；如果是在记录**之后**生成的，它自己就知道真相，记录当场作废
 *     （不再往后补，免得盖掉后来别人又改过的颜色）。
 *
 * 为什么同一个标签要写四处：标签在快照里有四个落脚点，只写一处会让面板上一半新色一半旧色——
 * 快照自带的标签表、地图这个容器自己、地图下面的每一张票、没挂在地图下的票（外加派生出来的色板）。
 *
 * 本地诊断日志（按需事件 #62 `labelColors.panelPatch`，只记工作区键散列与枚举）：这一笔记录住在面板的
 * 内存里，它决定「保存成功那一刻面板按什么颜色显示」，而这条链路以前没有日志点能回答「面板当时到底
 * 改没改、有没有被旧快照盖回去」。三种归宿各记一条，且只有真发生才记：`applied` 当场写动、
 * `kept` 装进来的快照比记录旧、按记录补色、`expired` 装进来的快照比记录新、记录作废。
 * 落点是三个：`lcPanelSavedColors` 与 `lcApplySavedColorsOnInstall` 的两条分支。
 */
/** 记一行本地诊断日志（按需 #62，调试开关打开时才落盘）；记日志失败不影响功能。 */
const lcPanelPatchLog = function (st, kind, count) {
  try {
    if (typeof log !== 'function') return
    log('debug', 'labelColors.panelPatch', {
      cwdHash: (typeof dswsLogHash === 'function') ? dswsLogHash((st && st.cwd) || '') : '',
      kind: kind,
      count: count,
    })
  } catch (eLog) { /* 记日志失败不影响功能 */ }
}

/** 把「这一次真正改成功的那几条」整理成一张「标签名 → 归一后的色值」的表；认不出的一律丢掉。 */
export const lcSavedColorMapOf = function (applied) {
  const map = {}
  const list = Array.isArray(applied) ? applied : []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (!a || !a.name) continue
    const hex = (typeof normalizeColor === 'function') ? normalizeColor(a.color) : null
    if (!hex) continue
    map[String(a.name)] = hex
  }
  return map
}

/** 把这张表写进一份快照；返回真正写动的处数（面板靠它决定要不要重画）。 */
export const lcPatchSnapshotColors = function (snap, colorMap) {
  if (!snap || typeof snap !== 'object' || !colorMap) return 0
  const names = Object.keys(colorMap)
  if (!names.length) return 0
  let places = 0
  // 标签条目有两种形状：字符串（只带名字、没有颜色）与对象（带 name 与 color）。只有对象能改色，
  // 字符串原样跳过——不把它换成对象，那等于替后端改数据形状。
  const patchList = function (arr) {
    if (!Array.isArray(arr)) return
    for (let i = 0; i < arr.length; i++) {
      const l = arr[i]
      if (!l || typeof l !== 'object') continue
      const nm = (l.name === undefined || l.name === null) ? '' : String(l.name)
      if (!Object.prototype.hasOwnProperty.call(colorMap, nm)) continue
      const now = (l.color === undefined || l.color === null) ? '' : String(l.color).replace(/^#/, '').toLowerCase()
      if (now === colorMap[nm]) continue
      l.color = colorMap[nm]
      places += 1
    }
  }
  patchList(snap.labels)
  try { if (snap.deck && typeof snap.deck === 'object') patchList(snap.deck.labels) } catch (eDeck) {}
  const maps = Array.isArray(snap.maps) ? snap.maps : []
  for (let i = 0; i < maps.length; i++) {
    const m = maps[i]
    if (!m || typeof m !== 'object') continue
    patchList(m.labels)
    const tickets = Array.isArray(m.tickets) ? m.tickets : []
    for (let j = 0; j < tickets.length; j++) { if (tickets[j]) patchList(tickets[j].labels) }
  }
  const issues = Array.isArray(snap.issues) ? snap.issues : []
  for (let k = 0; k < issues.length; k++) { if (issues[k]) patchList(issues[k].labels) }
  return places
}

/** 保存成功后记一笔。返回这一笔记录，没得可记（没有一条认出颜色）时给 null。 */
export const lcRememberSavedColors = function (st, applied, at) {
  try {
    if (!st) return null
    const map = lcSavedColorMapOf(applied)
    if (!Object.keys(map).length) return null
    const prev = (st.lcSavedColors && st.lcSavedColors.colors) || {}
    st.lcSavedColors = { colors: Object.assign({}, prev, map), at: Number(at) || Date.now() }
    return st.lcSavedColors
  } catch (e) { return null }
}

/** 面板收到「保存成功」时做的第一件事：记一笔，再当场把当前那份快照改成新色（返回真表示要重画）。 */
export const lcPanelSavedColors = function (st, applied, at) {
  if (!lcRememberSavedColors(st, applied, at)) return false
  const places = lcPatchSnapshotColors(st.snapshot, st.lcSavedColors.colors)
  if (places > 0) lcPanelPatchLog(st, 'applied', places)
  return places > 0
}

/** 一份快照被装进面板时过这一道（见文件头）。返回真表示真补过色。 */
export const lcApplySavedColorsOnInstall = function (st, snap) {
  try {
    const rec = st && st.lcSavedColors
    if (!rec || !snap || typeof snap !== 'object') return false
    const ms = Number(snap.generatedMs) || 0
    // 这份快照是在那一笔记录之后生成的：它自带真相，记录功成身退（不再往后补）。
    if (ms && ms >= Number(rec.at || 0)) {
      const held = Object.keys(rec.colors || {}).length
      st.lcSavedColors = null
      lcPanelPatchLog(st, 'expired', held)
      return false
    }
    const places = lcPatchSnapshotColors(snap, rec.colors)
    if (places > 0) lcPanelPatchLog(st, 'kept', places)
    return places > 0
  } catch (e) { return false }
}
