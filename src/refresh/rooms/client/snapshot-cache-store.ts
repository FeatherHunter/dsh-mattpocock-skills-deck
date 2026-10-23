/**
 * src/refresh/rooms/client/snapshot-cache-store.ts — 会话存储核、快照与链缓存、水合与提醒（#455 由 store.js 拆出）。
 *
 * 为什么快照要和偏好分家：快照是“宿主刚才给了什么”，偏好是“人刚才点了什么”，前者随请求更新、
 * 后者随点击更新，更新节奏不同；混在一起时，一次快照回包会顺手把人刚点的东西盖掉。
 * 本文件由 store-snapshot.js 转写而来，只加类型标注与环境声明，运行行为一字不改。
 * 同工作区所有会话共用按工作区根分桶的内存表（#653），快照命中只记数不打扰人。
 * 反例：不要在这里决定行该怎么画（那是 store-derived.ts 的事），也不要在这里存人的偏好（那是 store-prefs.ts 的事）。
 */
declare function keyOf(...args: any[]): any;
declare function migrateCachedChoiceToKey(...args: any[]): any;
declare const DEFAULT_PANEL_H: number;
declare const listPrefs: any;
declare function isEnabled(...args: any[]): any;
declare function log(...args: any[]): any;
declare function dswsLogHash(...args: any[]): any;
declare function promptLang(...args: any[]): any;
declare function nowStr(...args: any[]): any;
declare const ctx: any;
declare function namingGuardianEvent(...args: any[]): any;
declare function installDialogSignals(...args: any[]): any;
declare function getCachedRepository(...args: any[]): any;
declare function setCachedRepository(...args: any[]): any;
declare function setPresentationMap(...args: any[]): any;
declare function keepUserPick(...args: any[]): any;
declare const React: any;
declare const timer: any;
declare const STORE_NOTICE_DISMISS_MS: number;
export const makeStore = (): any => ({
  open: false, tab: 'list', activeMap: null, activeIssue: null,
  // #552 导航栈（会话私有状态）：只存坐标不存正文，元素形状 { kind: 'map' | 'issue', n: 数字编号 }；
  // 进入压栈、返回弹栈、空栈回列表；activeMap 与 activeIssue 过渡期保留为栈顶镜像。
  navStack: [],
  issueCache: {}, issueMode: 'idle', issueError: null, issueDetail: null, issueCommentsMoreLoading: false, issueCommentsFailCount: 0, issueCommentsHasMore: true,
  // #255 评论输入区（受控）：草稿/提交态/分流错误/服务端确认闪烁
  cmtDraft: '', cmtSending: false, cmtError: null, cmtConfirm: null,
  notice: null, injector: null, tick: 0,
  // #1428：typeof 守卫理由同 refresh-timer.ts（闭包里值不变，闭包外不抛）。
  pos: null, size: { w: 460, h: (typeof DEFAULT_PANEL_H !== 'undefined' ? DEFAULT_PANEL_H : 0) }, 
  // 外观定死（用户拍板：图标/动作词不可配置）
  ui: { icon: 'compass', word: '沉淀' },
  snapshot: null,
  selection: null,
  repository: null,
  backendModules: null,
  backendMenuOpen: false,
  backendMenuPos: null,
  cwd: '', lblFilters: [], effFilters: [], expLabels: false,
  // 由 wf.cwd 带回来的工作区根（2026-09-19 加）：归属标志的早到来源，收下与写表在 probe-snapshot.js。
  sessionWorkspaceRoot: '',
  // 状态过滤 + 排序：默认档是「编号升序」，来自内核 listPrefs 的初始偏好（见 store-prefs）；
  //   面板每次换档写回同一处，下次启动沿用。
  stateFilter: ((typeof listPrefs !== 'undefined' ? listPrefs : {}) as any).stateFilter, sortKey: ((typeof listPrefs !== 'undefined' ? listPrefs : {}) as any).sortKey, sortDir: ((typeof listPrefs !== 'undefined' ? listPrefs : {}) as any).sortDir,
  chainSnapshot: null, chainLoadedAt: '', backendChain: null, fullChain: null,
  snapMode: 'loading', snapError: null, snapLoading: false,
  // #727：后端那条事实的读取状态。selPending =「这个工作区用哪个后端」还说不准、而且有真的在途原因（面板取数在飞，或那条专用电话在飞）；_selAskedKey = 已经为哪个工作区补问过那条电话（见 probe-select.js）。
  selPending: false, _selAskedKey: '',
  // T2 HoverTip 迁移（#381）：skillTip 已由 HoverTip 局部 state 统一，移除全局，skillHover 保留用于行高亮（后续可改 CSS :hover 再移除）
  refreshing: false, rowFlash: {}, issueFlash: {}, handoffReady: false, handoffSearching: false,
  // #787 交接会话隔离（会话私有状态）：本会话记下的时间戳、真实文件名、记下那一刻的目录。
  //   无记忆时为 null/空串；读时当时目录与当前目录对不上视为无记忆（fail-closed），绝不串到别的会话。
  handoffTs: null, handoffFile: null, handoffCwd: '',
  // #787 发出去防抖计时（800 毫秒）住会话自己身上；无记忆为 0。
  _lastHandoffOpenTs: 0,
  // #787 待注入本会话的首条草稿（别的会话交接过来）；本会话界面取完清空。
  incomingDraft: null,
  skillsOpen: false, skillHover: null, bugMenuOpen: false, bugMenuHover: false, bugMenuPos: null, takeMenuOpen: false, takeMenuHover: false, takeMenuPos: null, skillPopPos: null,
  // #1297 入口浮层（面板页签行与状态栏胶囊共用的那一层「新建需求」浮层）：entryOpen 是否展开、
  //   entryFrom 从哪个入口打开的（'panel' / 'statusbar'，只影响浮层朝上还是朝下弹）、
  //   entryPos 是打开那一刻量好的视口坐标。状态住全局 store 而不是浮层组件内部，是因为两处宿主
  //   会各自重挂（状态栏悬停菜单关闭、面板收起），浮层要由哪一处都画得出来、且同一时刻只有一层。
  entryOpen: false, entryFrom: '', entryPos: null,
  expTags: {}, subs: [],
  noRepoCard: { expanded: false, name: '', visibility: 'private', loading: false, error: '', errorKind: '', errorRepoUrl: '' },
  switchConfirm: null,
  gateModalOpen: false, gateSelected: null, gateLoading: false, gateError: '',
})
// ── 工作区键：分桶一律按「工作区根」，不按会话所选目录（#653，规则见 #649 定版记录 3.2 节）──
// 为什么客户端要认这条路：宿主从 #652 起把「哪个目录算这个会话的工作区」锚到了工作区根，
//   而客户端这五样抽屉（面板快照、检查链快照、在途去重、后端选择镜像、仓库引用）此前都按
//   「会话所选目录」分桶。同一个仓库里，根会话与子目录会话因此各占一桶、互不相认——
//   子目录会话打开面板时看不到根会话已经取好的数据，只会空着。
// 客户端自己算不出工作区根（要读文件系统：逐层向上找 `.git` 或主锚文件），所以这个值由宿主给：快照回包里的 workspaceRoot 一项。没拿到时一律退回所选目录，行为与改动前一致（诚实失败，不猜）。
// 存法：所选目录的规整键 → 工作区根（在装快照时记下）。同一张表里也把「工作区根 → 工作区根」记一份，于是在途去重那种手上只有请求键的场景传进来也能命中自己。
export const workspaceRootByCwd: any = {}
export const rememberWorkspaceRoot = function (selected: any, root: any): void {
  try {
    const sk: any = (typeof keyOf === 'function') ? keyOf(selected) : String(selected || '')
    const rk: any = (typeof keyOf === 'function') ? keyOf(root) : String(root || '')
    if (sk && rk) workspaceRootByCwd[sk] = rk
    if (rk) workspaceRootByCwd[rk] = rk
    // #683（F1 · ADR 的 R7d）：工作区根是**后来才**认出来的 —— 原先那份选择与布局按「会话所选目录」那把键存着，而从此读写都改走根键，老键那条就此没人再看（界面会一边说 Markdown、另一边说「还没有设置」）。认到根的这一刻把它搬过去；根键上已经有了就不动它。
    if (sk && rk && sk !== rk) { try { if (typeof migrateCachedChoiceToKey === 'function') migrateCachedChoiceToKey(sk, rk) } catch (eMv) {} }
  } catch (e) {}
}
// 分桶用的钥匙：给所选目录，回工作区根；认不出（宿主还没回过话）就回所选目录本身。
export const wsKeyOf = function (selected: any): string {
  try {
    const k: any = (typeof keyOf === 'function') ? keyOf(selected) : String(selected || '')
    if (!k) return ''
    const hit: any = workspaceRootByCwd[k]
    if (hit) return hit
    // 兜底两条：手上这份快照自己带着工作区根（磁盘缓存刚回放、或别的会话已经装过一次），
    // 以及 LRU 里那条记录。都能认出就顺手记进表，下一次直接命中。
    try { const e: any = snapshotByCwd.get(k); const r: any = e && e.snapshot && e.snapshot.workspaceRoot; if (r) { const rk: any = (typeof keyOf === 'function') ? keyOf(r) : String(r); if (rk) { workspaceRootByCwd[k] = rk; workspaceRootByCwd[rk] = rk; return rk } } } catch (e1) {}
    return k
  } catch (e) { return '' }
}
export const shared: any = makeStore()
export const stores: any = {}
// #58 缓存优先：按工作区键的内存快照表（新 store 秒开 + 跨会话同工作区共享，避免空 cwd 探路 miss）
// 单源工作区键（#301 / #324）：全库仅一份 keyOf，经 shared:workspaceKey 拼入；#653 起分桶再走 wsKeyOf 锚到工作区根
export const SNAP_CWD_LRU_MAX: number = 20
export const snapshotByCwd: any = new Map() // Map<normCwd,{snapshot,version,ts}> LRU20
export const touchLRUClient = function(map: any,key: any,val: any): any{ if(map.has(key)) map.delete(key); map.set(key,val); if(map.size>SNAP_CWD_LRU_MAX){ const first: any=map.keys().next().value; map.delete(first);} return val; }
const dswsClientSnapHitN: any = { n: 0 } // #498 客户端快照命中采样计数（百一采样，只增不显）
export const getCachedSnapshot = function (cwd: any): any { try{ const k: any=wsKeyOf(cwd); const e: any=snapshotByCwd.get(k); const s: any=e?e.snapshot||e:null; try { if (s) { dswsClientSnapHitN.n += 1; if (isEnabled('debug') && dswsClientSnapHitN.n % 100 === 0) log('debug', 'client.snapshot.hit', { keyHash: dswsLogHash(String(k)), ageMs: Date.now()-(((e&&e.ts)||Date.now())), kind: 'memory' }) } } catch(eL){} return s; }catch(e){ return null; } }
export const getCachedEntry = function(cwd: any): any{ try{ const k: any=wsKeyOf(cwd); return snapshotByCwd.get(k)||null; }catch(e){ return null; } }
// 落缓存：键 = 工作区键（#653 起锚到工作区根，子目录会话与根会话同桶）
// #1355：缓存条目按工作区共享，而 workRouteTable 里每行「是不是本会话」的标记是按请求它的那个会话算的——
//   同一份表交给别的会话，对方认出来的「本会话行」就全错，会把别人的行当成自己的。落缓存时浅拷贝再剥掉它。
export const setCachedSnapshot = function (cwd: any, snap: any): void { if(!cwd||!snap||snap.ok!==true||!Array.isArray(snap.maps)) return
  let s2: any
  try{ s2=Object.assign({},snap) }catch(eS){ return }
  // #232 · 落库前剥除响应传输态标记（仅属当次请求，不属缓存实体）
  try{ delete s2.notModified; delete s2.status; delete s2.cached }catch(eT){}
  // #1355 · 这份读数的「视角」只属于当时请求它的会话，不进按工作区共享的缓存（要这张表就用自己的会话号现算一份）
  try{ delete s2.workRouteTable }catch(eW){}
  try{ const k: any=wsKeyOf(cwd); const ver: any=s2.version||s2.etag||''; const ent: any={snapshot:s2, version:ver, ts:Date.now(), key:k, lastProbeAt:getProbeAt(k)}; touchLRUClient(snapshotByCwd,k,ent); try{ diskPutSnapshot(k, ent) }catch(eD1){} }catch(e){} }
// #1355 · 本会话手上那份快照缺自己的 workRouteTable 吗？缺的来路不止一种：同工作区别的会话水合过来的、升级前旧缓存留下的、
//   或这一版宿主根本没带这个字段；不管哪种，都得补发一次带当前会话号的快照请求。
//   忙（正在刷新 / 后端还说不准）时不判缺，所以三处接线重复触发也不会重复发请求。
//   只回答「缺不缺」，不回答「行是不是自己的」——读数里没有会话号，判不出归属；宿主在途去重那张票跟上（尚未建票）。
export const snapNeedsOwnWorkRoute = function (st: any): boolean {
  try {
    if (!st || !st.sessionId || !st.snapshot || st.snapLoading === true || st.selPending === true) return false
    const t: any = st.snapshot.workRouteTable
    return t === undefined || t === null
  } catch (e) { return false }
}
// #1355：剥表、补拉与三处接线共用的请求决策已搬到 kernel/work-route-own.ts（本文件贴着 350 行上限，#707 起如此；
//   搬家原因与那片的分工写在它的文件头）。这里只留「缺不缺表」这一条判据，因为缺表的样子由本文件的缓存形状决定。
export const getSnapshotVersion = function(cwd: any): string{ try{ const e: any=getCachedEntry(cwd); return e?e.version||'':''; }catch(e){ return ''; } }
// ============ #327 特性 A/B：上次探测时间 + 快照多级缓存（内存→磁盘→网络）============
export const lastProbeAtByCwd: any = new Map() // Map<工作区键, ms> —— 对该工作区完成任一次检查（探针/刷新/快照校验）即推进，数据不变也走针
export const getProbeAt = function (cwd: any): number { try { const v: any = lastProbeAtByCwd.get(wsKeyOf(cwd)); return v || 0 } catch (e) { return 0 } }
export const touchProbeAt = function (cwd: any, ms: any): void {
  try {
    const k: any = wsKeyOf(cwd); if (!k) return
    lastProbeAtByCwd.set(k, ms || Date.now())
    // 组内全量会话走针：同工作区的 shared/stores 全部 emit，状态栏随重渲染取新时间
    try { if (shared.cwd && wsKeyOf(shared.cwd) === k) emit(shared) } catch (e1) {}
    try { Object.keys(stores).forEach(function (kk: any): void { const st2: any = stores[kk]; if (st2 && st2.cwd && wsKeyOf(st2.cwd) === k) emit(st2) }) } catch (e2) {}
  } catch (e) {}
}
export const SNAP_DISK_CAP: number = 24
const _snapDbPromise: any = (function (): any {
  try {
    if (typeof window === 'undefined' || !window.indexedDB || !window.indexedDB.open) return null
    return new Promise(function (resolve: any): void {
      let req: any
      try { req = window.indexedDB.open('dsws-cache', 1) } catch (e0) { resolve(null); return }
      req.onupgradeneeded = function (): void { try { req.result.createObjectStore('snapshots') } catch (e00) {} }
      req.onsuccess = function (): void { resolve(req.result) }
      req.onerror = function (): void { resolve(null) }
      req.onblocked = function (): void { resolve(null) }
    })
  } catch (e) { return null }
})()
// 落盘：fire-and-forget；条目形如 {key, snapshot, version, ts, lastProbeAt}；超出 SNAP_DISK_CAP 按最旧淘汰
export const diskPutSnapshot = function (k: any, entry: any): void {
  try {
    if (!_snapDbPromise || !k || !entry) return
    _snapDbPromise.then(function (db: any): void {
      if (!db) return
      try {
        const st: any = db.transaction('snapshots', 'readwrite').objectStore('snapshots')
        st.put(entry, k)
        const allReq: any = st.getAll()
        allReq.onsuccess = function (): void {
          try {
            const rows: any[] = (allReq.result || []).filter(function (r: any): any { return r && r.key })
            if (rows.length <= SNAP_DISK_CAP) return
            rows.sort(function (a: any, b: any): number { return (a.ts || 0) - (b.ts || 0) })
            const kill: any[] = rows.slice(0, rows.length - SNAP_DISK_CAP)
            const tx2: any = db.transaction('snapshots', 'readwrite').objectStore('snapshots')
            kill.forEach(function (r: any): void { try { tx2.delete(r.key) } catch (e3) {} })
          } catch (eEv) {}
        }
      } catch (eTx) {}
    }).catch(function (): void {})
  } catch (e) {}
}
export const diskGetSnapshot = function (k: any): any {
  try {
    if (!_snapDbPromise || !k) return Promise.resolve(null)
    return _snapDbPromise.then(function (db: any): any {
      if (!db) return null
      return new Promise(function (resolve: any): void {
        try {
          const req: any = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(k)
          req.onsuccess = function (): void { try { resolve(req.result || null) } catch (e2) { resolve(null) } }
          req.onerror = function (): void { resolve(null) }
        } catch (e) { resolve(null) }
      })
    }).catch(function (): any { return null })
  } catch (e) { return Promise.resolve(null) }
}
// 链快照共享缓存（#324 · 键 = 工作区键 + 后端 id + 语言；#529 加语言维：中英快照分开存；#653：这里的「工作区键」走 wsKeyOf 锚到工作区根）
export const CHAIN_CWD_LRU_MAX: number = 20
export const chainByCwd: any = new Map() // Map<工作区键+'|'+backendId+'|'+lang, {snapshot, ts}>
export const getChainCacheKey = function(cwd: any, backendId: any, lang: any): string{ try{ return wsKeyOf(cwd) + '|' + String(backendId||'') + '|' + String(lang||''); }catch(e){ return String(cwd||'')+'|'+String(backendId||'')+'|'+String(lang||''); } }
export const getCachedChain = function(cwd: any, backendId: any, lang: any): any{ try{ const k: any=getChainCacheKey(cwd, backendId, lang); const e: any=chainByCwd.get(k); return e?e.snapshot:null; }catch(e){ return null; } }
export const setCachedChain = function(cwd: any, backendId: any, lang: any, snap: any): void{ if(!cwd||!snap) return; try{ const k: any=getChainCacheKey(cwd, backendId, lang); const ent: any={snapshot:snap, ts:Date.now()}; if(chainByCwd.has(k)) chainByCwd.delete(k); chainByCwd.set(k, ent); if(chainByCwd.size>CHAIN_CWD_LRU_MAX){ const first: any=chainByCwd.keys().next().value; chainByCwd.delete(first);} }catch(e){} }
// 水合守卫：刚点的那一下不被旧缓存盖掉（#1003 接替 userPicked 标记；只看时间，不落盘）。
export const justPicked = function (st: any, c: any): boolean {
  try {
    const sel: any = st && st.selection
    if (!sel || !sel.backendId || typeof sel.pickedAt !== 'number' || sel.pickedAt <= 0) return false
    const cacheMs: number = (c && typeof c.generatedMs === 'number' && c.generatedMs > 0) ? c.generatedMs : 0
    if (cacheMs > 0) return sel.pickedAt > cacheMs
    const incBid: any = c && c.selection && c.selection.backendId
    return !!(incBid && String(incBid) !== String(sel.backendId) && (Date.now() - sel.pickedAt) < 60000)
  } catch (e) { return false }
}
export const hydrateFromCache = function (st: any): boolean {
  if (!st || !st.cwd) return false
  let c: any = getCachedSnapshot(st.cwd)
  // #1355：旧版本落进内存/磁盘的缓存条目里还带着「当时请求那个会话」的工作路线读数。水合前先剥掉再装，
  //   否则本会话会把别人的行当自己的行。剥干净后写回内存条目；带条目外壳的旧缓存同时写回磁盘
  //   （裸快照形状只在更老版本出现，命中时按无表直接水合、不写回）。写盘前重读条目确认没被更新的写入换掉，避免旧条目盖新条目。
  //   不原地改老对象 —— 它可能正被同工作区的另一个会话当 st.snapshot 用（升级前的引用共享），原地删会清掉它的表。
  try {
    if (c && c.workRouteTable !== undefined) {
      const clean: any = Object.assign({}, c)
      delete clean.workRouteTable
      c = clean
      const ent: any = getCachedEntry(st.cwd)
      if (ent && ent.snapshot) {
        ent.snapshot = c
        try {
          const nowEnt: any = getCachedEntry(st.cwd)
          if (nowEnt === ent) diskPutSnapshot(wsKeyOf(st.cwd), ent)
        } catch (eD2) {}
      }
    }
  } catch (eWr0) {}
  // #653：这份缓存自己带着工作区根时先记住它，随后所有抽屉都按工作区根找（子目录会话秒显根会话的数据）
  try{ if(c && c.workspaceRoot) rememberWorkspaceRoot(st.cwd, c.workspaceRoot) }catch(eWr){}
  try{ if(c){ const _k: any=wsKeyOf(st.cwd); const _e: any=snapshotByCwd.get(_k); if(_e) touchLRUClient(snapshotByCwd,_k,_e);} }catch(e){}
  let changed: boolean=false
  // 胜负自证（#495）：记合并前双方版本号与谁胜出，串门时单行 #28 即可判定，不用跨行推理
  let _winnerVer: string = '', _loserVer: string = '', _outcome: string = 'current'
  if (c) {
    // 版本取舍：以最新生成时间者胜（水合与扇出一致，#301 契约）
    const incomingMs: number = c.generatedMs || 0
    const curMs: number = (st.snapshot && st.snapshot.generatedMs) || 0
    const _incVer: string = String((c && (c.version || c.etag)) || '')
    const _curVer: string = String((st.snapshot && (st.snapshot.version || st.snapshot.etag)) || '')
    _winnerVer = _curVer; _loserVer = _incVer
    if (!st.snapshot || incomingMs > curMs) {
      _winnerVer = _incVer; _loserVer = _curVer; _outcome = 'incoming'
      st.snapshot = c
      st.snapMode = 'real'
      st.snapError = null
      st.snapLoading = false
      changed=true
    } else if (st.snapMode !== 'real' && incomingMs === curMs) {
      st.snapMode = 'real'
      st.snapError = null
      changed=true
    } else if (!st.snapshot && c) {
      st.snapshot = c
      st.snapMode = 'real'
      st.snapError = null
      changed=true
    }
    // 同步 selection：水合的是旧缓存（切换前结论），刚点的那一下（pickedAt 更新）不合并，宿主新回包照旧纠正。
    if (c.selection !== undefined && !justPicked(st, c)) { if (mergeSelection(st, c.selection)) changed = true }
    if (c.repository !== undefined) { st.repository = c.repository; setCachedRepository(st.cwd, c.repository) }
    if (c.backendModules) { st.backendModules = c.backendModules; setPresentationMap(c.backendModules) } // backendModules 缓存
  }
  // selection 单独缓存兜底已随镜像退役而删（真相在宿主文件里，不在本地）。
  if (!st.repository) {
    const rep: any = getCachedRepository(st.cwd)
    if (rep) { st.repository = rep; changed=true }
  }
  // 链快照共享水合（#324 · 键 = 工作区键 + 后端 id + 语言；#529 加语言维，与 loadChain 同口径）
  try {
    const backendId: any = (st.selection && st.selection.backendId) || (c && c.selection && c.selection.backendId) || ''
    const chainLang: any = (typeof promptLang === 'function' ? promptLang() : 'zh')
    const cachedChain: any = getCachedChain(st.cwd, backendId, chainLang)
    if (cachedChain && !st.chainSnapshot) {
      st.chainSnapshot = cachedChain
      st.chain = cachedChain.chain || cachedChain
      st.fullChain = cachedChain.fullChain || null
      st.backendChain = cachedChain.backendChain || null
      st.chainLoadedAt = (typeof nowStr === 'function' ? nowStr() : '')
      st.chainLangLoaded = chainLang // #529：水合即该语言快照，记下供语言切换判定
      changed = true
    } else if (cachedChain && st.chainSnapshot) {
      // 已有链但缓存更新：以生成时间或加载时间新者为准
      const curT: any = st.chainLoadedAt || 0
      const cachedT: any = (cachedChain.generatedMs || cachedChain.ts || 0)
      // 简化：若不同对象则更新，保持最终一致
      if (cachedChain !== st.chainSnapshot) {
        // 保留选择：若缓存非空则覆盖，确保同工作区链一致
        // 不强制覆盖，避免闪烁，仅当缺失时秒显已处理；扇出时会统一覆盖
      }
    }
  } catch (eChainHydrate) {}
  try { if (changed) log('info', 'snapshot.hydrate', { cwdHash: dswsLogHash(st.cwd), source: 'memory', fresh: true, latencyMs: 0, winnerVersion: _winnerVer, loserVersion: _loserVer, outcome: _outcome }) } catch (eL) {}
  return changed
}
/**
 * 客户端 selection 合并唯一点（#1003：真相即宿主回包；本地无镜像，不写回）。
 *  - 有后端：覆盖；显式空：覆盖；fallback 空且当前有值：保留（防抖）；pending：保留。
 */
export const mergeSelection = function (st: any, incoming: any): boolean {
  if (!incoming || typeof incoming !== 'object') return false
  incoming = (typeof keepUserPick === 'function') ? keepUserPick(st.selection, incoming) : incoming
  if (!incoming.backendId) {
    if (incoming.pending) return false
    if (incoming.source === 'explicit') {
      try { log('info', 'backend.switch', { from: String((st.selection && st.selection.backendId) || ''), to: String(incoming.backendId || ''), cwdHash: dswsLogHash(st.cwd) }) } catch (eL) {}
      st.selection = incoming
      return true
    }
    const cur: any = st.selection
    if (cur && cur.backendId) return false // fallback null：尊重当前，不覆盖
      try { log('info', 'backend.switch', { from: String((st.selection && st.selection.backendId) || ''), to: String(incoming.backendId || ''), cwdHash: dswsLogHash(st.cwd) }) } catch (eL) {}
    st.selection = incoming
    return true
  }
  try { log('info', 'backend.switch', { from: String((st.selection && st.selection.backendId) || ''), to: String(incoming.backendId || ''), cwdHash: dswsLogHash(st.cwd) }) } catch (eL) {}
  st.selection = incoming
  return true
}
export const applySnapshotSelection = function (st: any, snap: any): void {
  if (!st || !snap) return
  if (snap.selection !== undefined) {
    // 2026-08-28 审查：合并语义收口到 mergeSelection——真相>意图>fallback 尊重意图>pending 保留
    mergeSelection(st, snap.selection)
  }
  if (snap.repository !== undefined) {
    const curSel: any = st.selection
    const nxtSel: any = snap.selection
    const isSuspiciousFallback2: boolean = !!(nxtSel && nxtSel.backendId===null && !nxtSel.pending && nxtSel.source==='fallback' && curSel && curSel.backendId)
    if (isSuspiciousFallback2) {
      // keep old repository as well
    } else {
      st.repository = snap.repository; if (st.cwd) setCachedRepository(st.cwd, snap.repository)
    }
  }
  if (snap.backendModules) { st.backendModules = snap.backendModules; setPresentationMap(snap.backendModules) }
  if (snap.repository && snap.repository.backend) {
    // 兼容旧 snapshot.repo 字段
    if (!st.snapshot) st.snapshot = snap
  }
}
export const getCwdSync = function (sid: any): string {
  try {
    const sessions: any = ctx.get('sessions')
    if (sessions && sid) {
      try {
        if (sessions.list && typeof sessions.list.getSnapshot === 'function') {
          const snap: any = sessions.list.getSnapshot()
          const hit: any = ((snap && snap.byId) || {})[sid] || (function(): any{ try { const ls: any = snap && snap.items; if (Array.isArray(ls)) { for (let i: number = 0; i < ls.length; i++) { const r: any = ls[i]; if (r && (r.id === sid || r.sessionId === sid)) return r } } } catch (eScan) {} return null })()
          const rcwd: any = hit && (hit.cwd || hit.path || hit.directory || hit.workspacePath || hit.worktree || hit.projectDir || (hit.header && (hit.header.cwd || hit.header.path)) || (hit.meta && (hit.meta.cwd || hit.meta.path)))
          if (typeof rcwd === 'string' && rcwd) return rcwd
        }
      } catch (e2) {}
      if (typeof sessions.get === 'function') {
        const s: any = sessions.get(sid)
        if (s) {
          const header: any = s.header || s.meta
          const cwd: any = header && (header.cwd || header.path || header.worktree || header.projectDir || header.directory || header.workspacePath || header.root)
          if (typeof cwd === 'string' && cwd) return cwd
          const meta: any = s.meta
          const cwd2: any = meta && (meta.cwd || meta.path || meta.worktree || meta.projectDir || meta.directory || meta.workspacePath || meta.root)
          if (typeof cwd2 === 'string' && cwd2) return cwd2
          if (typeof s.cwd === 'string' && s.cwd) return s.cwd
        }
      }
    }
  } catch (e) { /* 忽略 */ }
  return ''
}
export const storeOf = (sid: any): any => {
  if (!sid) { return shared }
  let st: any = stores[sid]
  if (!st) {
    st = makeStore(); st.sessionId = sid; stores[sid] = st; try { if (typeof namingGuardianEvent === 'function') namingGuardianEvent('store-touch') } catch (eNT) {} try { if (typeof installDialogSignals === 'function') installDialogSignals() } catch (eDS) {} // #746 会话store首次落定顺带拉取并装对话框焦点监听（每会话每窗口一次；对话框挂载必经此路）
    // #58 新 store 同步补 cwd 并尝试水合 per-cwd 缓存（秒开）
    if (!st.cwd) {
      const sync: any = getCwdSync(sid)
      if (sync) st.cwd = sync
    }
    if (st.cwd) hydrateFromCache(st)
  } else {
    // 已有 store 若 cwd 仍空且可同步补齐，立即水合
    if (!st.cwd) {
      const sync: any = getCwdSync(sid)
      if (sync) { st.cwd = sync; hydrateFromCache(st) }
    }
  }
  return st
}
export const emit = (st: any): void => { st.tick++; (st.subs || []).forEach(function (f: any): void { f(st.tick) }) }
export const sub = (st: any, f: any): any => { st.subs.push(f); return (): void => { const i: number = st.subs.indexOf(f); if (i >= 0) st.subs.splice(i, 1) } }
export const useStore = (sid: any): any => {
  const st: any = storeOf(sid)
  const [, set]: any = React.useState(0)
  React.useEffect((): any => sub(st, (n: any): void => set(n)), [st])
  return st
}
export const NOTICE_COLOR: any = { ok: '#4ade80', warn: '#fbbf24', info: '#a1a1aa' }
export const noticeIcon = (k: any): any => k === 'ok' ? 'check' : k === 'warn' ? 'alert' : 'clipboard'
export const flash = (st: any, msg: any, kind: any): void => {
  st.notice = { text: msg, kind: kind || 'info' }; emit(st)
  // 提示条自动消失的时间：这条提示亮这么久就自己退场；到点时若提示已经换成了别的内容，就不动它。
  // 数值写在 config/ttl.yaml 的 storeNoticeDismissMs，构建时由生成器变成常量、随界面闭包一起进来。
  if (timer !== undefined) timer.timeout(function (): void { if (st.notice && st.notice.text === msg) { st.notice = null; emit(st) } }, STORE_NOTICE_DISMISS_MS)
}
