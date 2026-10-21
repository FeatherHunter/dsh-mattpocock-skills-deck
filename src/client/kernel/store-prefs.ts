/**
 * src/client/kernel/store-prefs.ts — 偏好、免打扰红卡、导航栈与工作区镜像（#455 由 store.js 拆出）。
 *
 * 为什么本文件要单独存在：列表排序、标签热度、红卡收起、导航栈顶镜像这四件事都只和“人在面板里看到什么”
 * 有关，和快照从哪里来无关，所以它们住在偏好这一层，而不是快照那一层；两层混在一起，改快照会误伤偏好。
 * 本文件由 store-prefs.js 转写而来，转写时只加类型标注与环境声明，运行行为一字不改。
 * 构建时会去掉每行行首的 export 关键字，把声明体拼回 src/client/index.ts 的拼接标记处（apply 闭包内原位），
 * 与 ctx.ts 同模式，源码树里只有这一份真源；接口冻结清单见 docs/architecture/kernel-contract.md，改导出名要连那份文档一起改。
 * 反例：不要在这里读写快照内容（那是 store-snapshot.ts 的事），也不要在这里决定行该怎么画（那是 store-derived.ts 的事）。
 */
// 从中央时间参数目录真引用（与转写前的 .js 一致）。这条 import 不影响拼接：构建的拼接入口
// scripts/lib/transpile-unit.mjs 的 stripTimeConfigRefs 会把说明符里带 time-config 的这一行删掉，
// 名字由闭包里另一片 timeConfig 提供；而门禁把本文件当模块直接 import 跑时，它就是真引用。
import { SYNC_ISSUE_CACHE_TTL_MS } from '../../shared/time-config/values.js'
declare const SYNC: any;
declare function log(...args: any[]): any;
declare function wsKeyOf(...args: any[]): any;
declare function keyOf(...args: any[]): any;
declare function emit(...args: any[]): any;
declare const shared: any;
declare const stores: any;
declare function saveUiPrefs(...args: any[]): any;
declare function viewFlagOf(...args: any[]): any;
declare function setViewFlag(...args: any[]): any;
declare function h(...args: any[]): any;
// #1342：布局取值名单由构建从共享真源（src/shared/doc-layout）拼进闭包，本文件只声明、判断读它。
declare const DOC_LAYOUT_VALUES: readonly ('single' | 'multi')[]
export const DEFAULT_PANEL_H: number = (function (): number {
  try { return Math.max(240, Math.round((window.innerHeight || 800) * 0.5)) } catch (e) { return 400 }
})()
// #374：主列表偏好（排序/状态过滤）持久化（localStorage 不可用时降级默认值）
export const LIST_PREFS_KEY: string = 'dsws.listPrefs'
export const listPrefs: any = (function (): any {
  const d: any = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
  try {
    const raw: any = localStorage.getItem(LIST_PREFS_KEY)
    if (raw) return Object.assign(d, JSON.parse(raw))
  } catch (e) { try { log('warn', 'storage.fail', { key: LIST_PREFS_KEY, op: 'read' }) } catch (eL) {} }
  return d
})()
// #1012 第 3 步：这三格的新家是本机设置文件的 ui 节，读写那一趟住在 kernel/settings-ui.js。
//   下面这一条是改动前的老办法（整份写回旧键），只在那条新路接不下时兜底；过渡期里还写旧键的只此一处。
export const saveListPrefsLegacy = function (): void { try { localStorage.setItem(LIST_PREFS_KEY, JSON.stringify(listPrefs)) } catch (e) { try { log('warn', 'storage.fail', { key: LIST_PREFS_KEY, op: 'write' }) } catch (eL) {} } }
// 列表面板上点一下筛选或排序调的就是这里：先交给文件这条路（写进去了就不写旧键，先立后破），
//   接不下（文档问不到、是更高版本、或形状对不上）才照老办法整份写回旧键。
//   changed 是「这一下改的是哪几格」，由调用方点名往下传（见 views/ListTab.js）：只把动过的格交给文件，
//   没动过的格不许跟着一起提交 —— 文档还在路上时它们带的是旧表那一份，交上去会把文件里另外两格较新的值
//   顶掉并落盘（2026-10-12 复核 Q4 用两个窗口复现的缺陷）。不传时由 kernel/settings-ui.js 按记账推，
//   结果一样是「只交动过的格」。
export const saveListPrefs = function (changed: any): any { try { if (typeof saveUiPrefs === 'function' && saveUiPrefs(changed) === true) return } catch (e) {} saveListPrefsLegacy() }
// #375：label 点击记忆（次数 + 最近点击时间，双键排序）
// #1012（2026-10-12 维护者拍板）：这一项不落盘。它只是标签 chip 排序用的热度，丢了不影响
//   功能，本机设置文件里也不存它（核不再写 ui 节的 labelClicks）。所以这份计数只活在本次
//   会话的内存里：不读也不写 localStorage；旧键 dsws.labelClicks 里的历史数据不再读，
//   窗口一关热度就归零。两个导出名都保留：labelClicks 仍是 ListTab 读写的内存表，
//   saveLabelClicks 是空动作（调用点因此不必改）；LABEL_CLICKS_KEY 现在仓里没有一处读它，
//   留着是因为它写在 docs/architecture/kernel-contract.md 的接口冻结清单里，摘掉要连那份文档一起改。
export const LABEL_CLICKS_KEY: string = 'dsws.labelClicks'
export const labelClicks: any = {}
export const saveLabelClicks = function (): void {}
// T2 #35 · 无仓库红卡状态机（按工作区维度持久化 dismiss；表单态 expanded/name/visibility/loading/error）
// #653 修正：此前这里用 cwdHash 散列**原始串**（没走规整函数），同一个目录换一种写法（多一个尾斜杠、
//   盘符大小写不同）就会散出另一把键，收起过的红卡会重新冒出来。现在统一走工作区键（wsKeyOf）：
//   先按工作区根锚定，再散列，同一工作区只有一条记录。
export const NOREPO_DISMISS_PREFIX: string = 'dsws:noRepoDismiss:'
export const cwdHash = function (s: any): string { let h: number = 0; const t: string = String(s || ''); for (let i: number = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0; return String(h >>> 0) }
export const noRepoDismissKey = function (cwd: any): string { return NOREPO_DISMISS_PREFIX + cwdHash((typeof wsKeyOf === 'function' ? wsKeyOf(cwd) : (typeof keyOf === 'function' ? keyOf(cwd) : cwd)) || '') }
export const isNoRepoDismissed = function (cwd: any): boolean { try { return localStorage.getItem(noRepoDismissKey(cwd)) === '1' } catch (e) { try { log('warn', 'storage.fail', { key: NOREPO_DISMISS_PREFIX, op: 'read' }) } catch (eL) {}; return false } }
export const setNoRepoDismissed = function (cwd: any, v: any): void { try { if (v) localStorage.setItem(noRepoDismissKey(cwd), '1'); else localStorage.removeItem(noRepoDismissKey(cwd)) } catch (e) { try { log('warn', 'storage.fail', { key: NOREPO_DISMISS_PREFIX, op: 'write' }) } catch (eL) {} } }
export const cwdBasename = function (cwd: any): string { if (!cwd) return 'repo'; const parts: string[] = String(cwd).split(/[\\/]/); for (let i: number = parts.length - 1; i >= 0; i--) if (parts[i]) return parts[i]; return 'repo' }
export const isNoRepoNameValid = function (name: any): boolean { return typeof name === 'string' && name.length >= 1 && name.length <= 100 && /^[A-Za-z0-9._-]+$/.test(name) }
export const ensureNoRepoCard = function (st: any): any {
  if (!st.noRepoCard) st.noRepoCard = { expanded: false, name: '', visibility: 'private', loading: false, error: '', errorKind: '', errorRepoUrl: '' }
  if (!st.noRepoCard.visibility) st.noRepoCard.visibility = 'private'
  if (st.noRepoCard.errorRepoUrl === undefined) st.noRepoCard.errorRepoUrl = ''
  if (!st.noRepoCard.labelStep) st.noRepoCard.labelStep = { visible: false, repoStr: '', missing: [], have: 0, total: 10, checking: false }
  if (st.noRepoCard.labelStep.visible === undefined) st.noRepoCard.labelStep.visible = false
  return st.noRepoCard
}
// T1 #6 · IssueDetail 状态机（与 activeMap 互斥，in-panel 详情页 · v1.7.0）
// #552 导航栈：navStack 是真源，只存坐标 { kind: 'map' | 'issue', n: 数字编号, effortId: effort 标识 }，不存详情正文
// （地图正文走面板快照派生，工单正文走 60 秒详情缓存加 TEFNGY 降级，栈只做坐标）。
// effort 维度：本地 Markdown 一个仓库多个 effort，编号会重复，所以坐标必须带上 effortId（单 effort 后端恒为 ''）。
// activeMap 与 activeIssue 过渡期保留为栈顶镜像（读方逐个改到读栈顶之前，停靠栏/悬浮面板/技能页签照旧可用），
// activeEffortId 是同一个栈顶的 effort 镜像。
// 只读栈本身（同步镜像用，不带镜像兜底，否则弹空栈时会把旧镜像写回去）
export const navEffortOf = function (t: any): string { return (t && t.effortId !== undefined && t.effortId !== null) ? String(t.effortId) : '' }
export const peekStackNav = function (st: any): any {
  try {
    const s: any = st && st.navStack
    if (Array.isArray(s) && s.length) {
      const t: any = s[s.length - 1]
      if (t && (t.kind === 'map' || t.kind === 'issue') && typeof t.n === 'number' && !isNaN(t.n)) return t
    }
  } catch (e) {}
  return null
}
export const peekNav = function (st: any): any {
  const t: any = peekStackNav(st)
  if (t) return t
  // 没有栈的旧状态：从镜像回推栈顶，保证读方不崩
  try {
    const eff: string = (st && st.activeEffortId !== undefined && st.activeEffortId !== null) ? String(st.activeEffortId) : ''
    if (st && st.activeMap !== null && st.activeMap !== undefined) { const v: number = Number(st.activeMap); if (!isNaN(v)) return { kind: 'map', n: v, effortId: eff } }
    if (st && st.activeIssue !== null && st.activeIssue !== undefined) { const v2: number = Number(st.activeIssue); if (!isNaN(v2)) return { kind: 'issue', n: v2, effortId: eff } }
  } catch (e2) {}
  return null
}
export const syncNavMirror = function (st: any): any {
  const t: any = peekStackNav(st)
  if (t && t.kind === 'map') { st.activeMap = t.n; st.activeIssue = null; st.activeEffortId = navEffortOf(t) }
  else if (t && t.kind === 'issue') { st.activeIssue = t.n; st.activeMap = null; st.activeEffortId = navEffortOf(t) }
  else { st.activeMap = null; st.activeIssue = null; st.activeEffortId = '' }
  return t
}
export const pushNav = function (st: any, kind: any, n: any, effortId: any): any {
  if (!st) return null
  if (!Array.isArray(st.navStack)) st.navStack = []
  seedNavFromMirror(st)
  const v: any = (n == null) ? null : Number(n)
  if ((kind !== 'map' && kind !== 'issue') || v == null || isNaN(v)) return peekNav(st)
  const eff: string = (effortId === undefined || effortId === null) ? '' : String(effortId)
  const top: any = peekNav(st)
  // 同一详情重复进入不重复压栈（防双击把两个一样的压进栈）；同号不同 effort 是两条坐标，照压
  if (!top || top.kind !== kind || top.n !== v || navEffortOf(top) !== eff) st.navStack.push({ kind: kind, n: v, effortId: eff })
  syncNavMirror(st)
  emit(st)
  return peekNav(st)
}
// 没有栈的旧状态：先从镜像补一层再动栈，保证旧对象调清除也能清掉
export const seedNavFromMirror = function (st: any): void {
  if (!st || !Array.isArray(st.navStack) || st.navStack.length) return
  const t: any = peekNav(st)
  if (t) st.navStack.push({ kind: t.kind, n: t.n, effortId: navEffortOf(t) })
}
// 返回弹栈：只改栈与镜像，不碰滚动、展开、缓存与快照，所以上一级原样保留、不强制重刷
export const popNav = function (st: any): any {
  if (!st) return null
  if (!Array.isArray(st.navStack)) st.navStack = []
  seedNavFromMirror(st)
  const out: any = st.navStack.length ? st.navStack.pop() : null
  syncNavMirror(st)
  emit(st)
  return out
}
export const clearNavStack = function (st: any): void {
  if (!st) return
  st.navStack = []
  st.activeMap = null; st.activeIssue = null; st.activeEffortId = ''
  emit(st)
}
// 旧入口收敛为调新函数（T3/T4 再把调用方逐个改成直接压栈/弹栈）：
// 进入详情一律压栈——从列表进时栈是空的，压栈与旧的直接赋值效果一样；
// 从详情里再进下一级则保留返回路径，不再丢掉上一级。
export const setActiveMap = function (st: any, n: any, effortId: any): void {
  if (n == null) { clearActiveMap(st); return }
  pushNav(st, 'map', n, effortId)
}
export const clearActiveMap = function (st: any): void {
  const t: any = peekNav(st)
  if (t && t.kind === 'map') popNav(st)
  else { syncNavMirror(st); emit(st) }
}
export const setActiveIssue = function (st: any, n: any, effortId: any): void {
  if (n == null) { clearActiveIssue(st); return }
  pushNav(st, 'issue', n, effortId)
}
export const clearActiveIssue = function (st: any): void {
  const t: any = peekNav(st)
  if (t && t.kind === 'issue') popNav(st)
  else { syncNavMirror(st); emit(st) }
}
export const clearActiveDetail = function (st: any): void { clearNavStack(st) }
// T2 #7 · fetchIssueDetail 缓存与状态（独立于 snapshot，按 issue 号 60s TTL）
// 这一档住 config/ttl.yaml 的 syncIssueCacheTtlMs：正常路径取下面 SYNC 契约里的那一份（同一个数，
// 由 tests/verify-time-config.ts 看守）；SYNC 缺席时取本文件顶部声明的中央值 SYNC_ISSUE_CACHE_TTL_MS ——
// 构建拼闭包时没有那一行 import，名字由闭包里的时间片段提供；门禁把它当模块直接 import 时那一行是真引用。
// 本层不留数字字面量与缺键回落。
export const ISSUE_CACHE_TTL: number = ((typeof SYNC === 'object' && SYNC && SYNC.ISSUE_CACHE_TTL) || SYNC_ISSUE_CACHE_TTL_MS)
// #1003 退役：后端选择只认工作区文件，这张本地镜像表不再读写。
//   唯一真相在工作区文件里（宿主侧统一判定直接读文件）；本地再存一份就是第二份真相，
//   两份不一致时就要仲裁（修订号那套），这正是本票要结束的事。
//   本会话内的乐观选择（st.selection）不受影响——那是会话状态，不是持久化。
//   导出名保留为空壳（调用方在本次改动范围之外，留空壳免得它们崩，行为上已无镜像）。
export const selectionByCwd: any = {}
export const repositoryByCwd: any = {}
export const SELECTION_BY_CWD_KEY: string = 'dsws.selectionByCwd'
// #683（F1 · ADR 20260921 的 R7b）：写这张镜像表要「读回磁盘上那张 → 只换本工作区那一条 → 写回」。
//   从前这里是把进程内存里那份**整表**序列化写回：同一个访问地址开两个窗口时，后写的那扇窗会把
//   另一扇窗刚写进去的键整条顶掉（一个窗口里选完后端，另一个窗口一刷新就看不见了）。
//   写失败也不再一口吞掉：与同文件 saveListPrefs 同例记一条 storage.fail（ADR 的 R7c）。
//   （saveLabelClicks 从前也是这一档的例子；#1012 起标签点击次数不落盘，它已是空动作，不再记日志。）
//   本文件另有一张横幅折叠表（bannerFoldByCwd）还是老写法 —— 那条路今天没有跨窗口场景，本次不动它。
const writeTableEntry = function (storeKey: any, entryKey: any, value: any): void {
  try {
    let table: any = null
    try { const raw: any = localStorage.getItem(storeKey); table = raw ? JSON.parse(raw) : null } catch (eR) { table = null }
    if (!table || typeof table !== 'object' || Array.isArray(table)) table = {}
    table[entryKey] = value
    localStorage.setItem(storeKey, JSON.stringify(table))
  } catch (e) { try { log('warn', 'storage.fail', { key: storeKey, op: 'write' }) } catch (eL) {} }
}
// 别的工作区、别的窗口改了这张表时，把磁盘上那份合并回内存。磁盘那张是各窗口写进去的并集，
//   同名的那一条以磁盘为准 —— 我们自己刚写的那一次也在里面，不会被顶掉。
const mergeTableFromStorage = function (storeKey: any, inMemory: any): void {
  try {
    const raw: any = localStorage.getItem(storeKey)
    if (!raw) return
    const m: any = JSON.parse(raw)
    if (!m || typeof m !== 'object' || Array.isArray(m)) return
    for (const k of Object.keys(m)) inMemory[k] = m[k]
  } catch (e) { /* 磁盘上那份读不出来时就按内存里这份继续用 */ }
}
// storage 事件只处理布局表：选择镜像表已退役，不再读回磁盘（读了也没人看）。
const onStorageMerge = function (ev: any): void {
  try {
    const k: any = ev && ev.key
    if (k === SETUP_LAYOUT_BY_CWD_KEY) mergeTableFromStorage(SETUP_LAYOUT_BY_CWD_KEY, setupLayoutByCwd)
  } catch (e) {}
}
try { if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('storage', onStorageMerge) } catch (e) {}
// #422 · 提示横幅按工作区收起记忆（默认全部展开；各类提示横幅都可收，由调用方横幅决定是否给收起入口）。
//   存法沿用选择集同例：归一键 → 1（收起），缺席即展开；localStorage 不可用时降级为仅内存。
export const BANNER_FOLD_KEY: string = 'dsws.bannerFold'
export const bannerFoldByCwd: any = {}
;(function (): void {
  try {
    const raw: any = localStorage.getItem(BANNER_FOLD_KEY)
    if (raw) { const m: any = JSON.parse(raw); if (m && typeof m === 'object') { for (const k of Object.keys(m)) { const nk: any = (typeof keyOf === 'function' ? keyOf(k) : k); if (m[k] && !(nk in bannerFoldByCwd)) bannerFoldByCwd[nk] = 1 } } }
  } catch (e) { /* 存储不可用降级为仅内存 */ }
})()
const persistBannerFold = function (): void { try { localStorage.setItem(BANNER_FOLD_KEY, JSON.stringify(bannerFoldByCwd)) } catch (e) { /* 忽略 */ } }
// #1012：读写体搬去 kernel/settings-view.js（本机设置文件是唯一真源；旧表只是过渡）。
//   导出名与签名一字不变，旧表那几行原地留着当过渡 —— 新模块不在（老产物、或渲染替身里）时照旧干活。
//   新模块会在这四种情况下回 false（认不出工作区根、文档问不到、文件是更高版本、文档在手却写不进这一格），那时才走旧表这条路。
//   说准这一手兜得住什么：文件里已经有这个工作区的记录时，写进旧表这一份读不回来（读侧以文件里那条为准），
//   它只在本窗口内充当记性，页面一关就只剩文件里那一份。真正让一次改动不丢的是写那一趟自己：
//   写失败时把这一格留在待写队列里，下一趟写再试一次（见 kernel/settings-view-write.js）。
export const isBannerFolded = function (cwd: any): boolean {
  try { const v: any = (typeof viewFlagOf === 'function') ? viewFlagOf(cwd, 'bannerFolded') : undefined; if (typeof v === 'boolean') return v } catch (eN) {}
  try { if (!cwd) return false; const k: any = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd || '')); return !!bannerFoldByCwd[k] } catch (e) { return false }
}
// 把这一次折叠交给新模块（写本机设置文件那条路）：回 true 表示它接下了，旧表一个字都不动；
//   回 false 表示它接不下（认不出工作区根、文档问不到、文件只读、文档在手却写不进这一格）或根本不在，调用方照老办法写旧表。
const handoffBannerFold = function (cwd: any, folded: any): boolean {
  try { if (typeof setViewFlag === 'function' && cwd) return setViewFlag(cwd, 'bannerFolded', !!folded) === true } catch (eN) {}
  return false
}
// 同工作区各会话跟随重渲染（与 touchProbeAt 同例；设置页另有本地刷新兜底）：两条路都要走这一趟。
const emitBannerFold = function (cwd: any): void {
  try {
    const nk: any = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd || ''))
    if (typeof shared !== 'undefined' && shared && shared.cwd && keyOf(shared.cwd) === nk) emit(shared)
  } catch (e1) {}
  try {
    if (typeof stores !== 'undefined') Object.keys(stores).forEach(function (kk: any): void { const st2: any = stores[kk]; if (st2 && st2.cwd && keyOf(st2.cwd) === (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd || ''))) emit(st2) })
  } catch (e2) {}
}
export const setBannerFolded = function (cwd: any, folded: any): void {
  if (handoffBannerFold(cwd, folded)) { emitBannerFold(cwd); return }
  try {
    const k: any = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd || ''))
    if (!cwd || !k) return
    if (folded) bannerFoldByCwd[k] = 1
    else delete bannerFoldByCwd[k]
    persistBannerFold()
  } catch (e) { /* 忽略 */ }
  emitBannerFold(cwd)
}
// #1003 退役：镜像读写已删，这两个只剩空壳（调用方在本次范围外，留名免崩；一律按“无镜像”答）。
export const getCachedSelection = function (cwd: any): any { return null }
export const setCachedSelection = function (cwd: any, sel: any): void {}
// #1003 退役：宿主直接读文件，不再需要客户端上报“亲手选的哪条 + 版本号”。
//   名字留空壳，调用方拼出来的 hint 参数宿主侧直接忽略（判定只看文件）。
export const userHintOf = function (sel: any): any { return undefined }
// #1003 收尾：原先那个恒回 0 的「版本位」空壳随这一批删掉 —— 调用方不再上报它，宿主也不再读它。
// 用户点确认的乐观形状：后端、引用与点击时刻（pickedAt 只活在会话内存里，不落盘不上报）。
//   水合时凭它认出“刚点的那一下”，旧缓存不许盖掉它；宿主新回包不受影响（照旧合并）。
export const userPickSelection = function (backendId: any, ref: any, prevSelection: any): any {
  return { backendId: backendId, source: 'explicit', ref: (ref === undefined ? null : ref), pickedAt: Date.now() }
}
// 绑定回包的版本号无处可落（本地无镜像）：直接返回空，调用方照旧判绑定成败。
//   #1012 顺带把回包里「工作区配置文件写成什么样」记进会话状态，供状态栏如实展示；
//   每次调用整条替换（这次回包没有那一项就记空），所以上一次的旧话不会一直挂在那里误导人。
export const adoptBoundRev = function (st: any, res: any): any {
  try { if (st) st.workspaceFileResult = (res && (res.workspaceFile || (res.value && res.value.workspaceFile))) || null } catch (e) {}
  return null
}
// #1012 绑定回执里工作区配置文件的写入结果翻成人话：宿主已经算好，这里只翻译，不重算判断。
//   #1138 起口径变了：写成功才算这次选择生效，写不进去就是整次选择失败——那条失败由主提示
//   （状态栏/门控窗的「切换失败：…」）一条说清，所以这里只在**真的写成了**的时候出这一行小灰字。
//   失败那一支回空串，不再另说一句「绑定照旧有效」：绑定表已经没有了，那句话今天不成立，
//   同一件事说两遍还会让人以为「虽然报错但其实成了」。
//   形状对不上（例如给来一个空对象）同样回空串：宁可不说话，也不替一句没发生过的失败下结论。
export const workspaceFileNoteOf = function (wf: any): string {
  try {
    if (!wf || typeof wf !== 'object') return ''
    if (wf.ok !== true) return ''
    if (wf.reason === 'overwritten') return '已把这次选择写进工作区里的配置文件（覆盖了原来那一条）。'
    return '已把这次选择写进工作区里的配置文件。'
  } catch (e) { return '' }
}
// 状态栏那一行小灰字的节点：有结果才有这一行，没有结果回空（不占位，现有布局一个像素都不动）。
export const workspaceFileNoteEl = function (s: any): any {
  try {
    const txt: string = (s && s.workspaceFileResult) ? workspaceFileNoteOf(s.workspaceFileResult) : ''
    if (!txt) return null
    return h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', lineHeight: 1.4, textAlign: 'center', padding: '0 8px', wordBreak: 'break-word', whiteSpace: 'normal' } }, txt)
  } catch (e) { return null }
}
// #1003 退役：亲手标记已无生产者，合并时不再留标记，直接用宿主回包。
export const keepUserPick = function (cur: any, incoming: any): any { return incoming }
export const getCachedRepository = function (cwd: any): any { try { const k: any = wsKeyOf(cwd); return (cwd && k) ? repositoryByCwd[k] : null } catch(e){ return cwd ? repositoryByCwd[cwd] : null } }
export const setCachedRepository = function (cwd: any, repo: any): void { try { const k: any = wsKeyOf(cwd); if (cwd && k) repositoryByCwd[k] = repo } catch(e){ if (cwd) repositoryByCwd[cwd] = repo } }
// 初始化那张小卡上答的「域文档布局」按工作区记住（维护者 2026-09-21 拍板：A + 记住）。
//   此前它只活在本次会话的内存里 —— 同一个工作区新开一个会话又得答一遍，换个会话还可能答成另一个样，
//   而 AI 是照各自收到的那一句去写 docs/agents/domain.md 的。现在按工作区存一份，下次打开直接沿用；
//   想改随时在黄条那颗按钮弹出的那张卡上改（那条路每次都问，见 prompts.js 的 injectSetupDecision）。
//   存法沿用选择集同例：归一键 → 'single' | 'multi'；localStorage 不可用时降级为仅内存。
//   取值由拼进闭包的 DOC_LAYOUT_VALUES 把关（与 StatusBackend 的 SETUP_LAYOUT_VALUES 同一份真源；那边管卡片怎么画，这边管记不记得住）。
export const SETUP_LAYOUT_BY_CWD_KEY: string = 'dsws.setupLayoutByCwd'
export const setupLayoutByCwd: any = {}
;(function (): void {
  try {
    const raw: any = localStorage.getItem(SETUP_LAYOUT_BY_CWD_KEY)
    if (raw) { const m: any = JSON.parse(raw); if (m && typeof m === 'object') { for (const k of Object.keys(m)) { const nk: any = (typeof keyOf === 'function' ? keyOf(k) : k); if (!(nk in setupLayoutByCwd)) setupLayoutByCwd[nk] = m[k] } } }
  } catch (e) { /* 存储不可用降级为仅内存 */ }
})()
export const getCachedSetupLayout = function (cwd: any): any {
  try {
    const k: any = wsKeyOf(cwd)
    const raw: any = (cwd && k) ? setupLayoutByCwd[k] : (cwd ? setupLayoutByCwd[cwd] : null)
    // #683（F1 · ADR 的 R6）：这张表里一条现在存 {layout, pickedAt}（与后端那张同一种形状），
    //   读出来永远只给取值（老版本存的裸字符串照旧认，外面看不出形状变了）。
    const v: string = String((raw && typeof raw === 'object' ? raw.layout : raw) || '').toLowerCase()
    return ((DOC_LAYOUT_VALUES as readonly string[]).indexOf(v) >= 0) ? v : null
  } catch (e) { return null }
}
export const setCachedSetupLayout = function (cwd: any, v: any): void {
  try {
    // 卡上点的那一下传裸字符串（记下现在这一刻）；宿主回填传 {layout, pickedAt}（留着宿主那一刻）——
    //   两个壳各答一个样时按时刻仲裁：新的覆盖旧的（ R6：没有这个依据，落后的那扇窗永远停在老答案上）。
    let s: string = '', at: number = 0
    if (v && typeof v === 'object') { s = String(v.layout == null ? '' : v.layout).toLowerCase(); at = Number(v.pickedAt) || 0 }
    else { s = String(v == null ? '' : v).toLowerCase(); at = Date.now() }
    if ((DOC_LAYOUT_VALUES as readonly string[]).indexOf(s) < 0) return
    const k: any = wsKeyOf(cwd)
    if (cwd && k) {
      const cur: any = setupLayoutByCwd[k]
      const curAt: number = (cur && typeof cur === 'object') ? (Number(cur.pickedAt) || 0) : 0
      // 刚在卡上点的那一下（at=0 不可能：卡上走的一定是裸字符串那条，时刻就是现在）；宿主回填的老值不许
      //   顶掉本地更新的那条。老版本存的裸字符串一律当 0（宿主回填、或本次点确认都会把它换成带时刻的形状）。
      if (!(at > 0 && curAt > 0) || at >= curAt) { const rec: any = { layout: s, pickedAt: at }; setupLayoutByCwd[k] = rec; writeTableEntry(SETUP_LAYOUT_BY_CWD_KEY, k, rec) }
    }
  } catch (e) { /* 忽略 */ }
}
// #1003 退役：选择那条不再搬（无镜像可搬）；布局那条保留（随 #1012 搬）。
export const migrateCachedChoiceToKey = function (fromKey: any, toKey: any): boolean {
  try {
    if (!fromKey || !toKey || fromKey === toKey) return false
    let moved: boolean = false
    try { if (!(toKey in setupLayoutByCwd)) { const l: any = setupLayoutByCwd[fromKey]; if (l) { setupLayoutByCwd[toKey] = l; writeTableEntry(SETUP_LAYOUT_BY_CWD_KEY, toKey, l); moved = true } } } catch (e2) {}
    return moved
  } catch (e) { return false }
}
