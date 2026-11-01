/**
 * src/refresh/rooms/client/snapshot-sync.ts — 内核模块（#456 由 probe.js 拆出之颜色时间小函数、配置广播与快照加载）
 *
 * 为什么这份是真源：构建侧去掉行首 export 后拼回 src/client/index.ts 的拼接标记处，
 * 与 ctx.ts/seam 同模式，源码树里只有这一份真源。源码树里只有这一份真源，改这里就够。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 *
 * 等待上限为什么住中央：快照等待时长由 config/ttl.yaml 的 snapWaitMs 统一管，
 * 调时间改中央 YAML，不要在这里改数字。本文件顶部有一行从中央时间参数单行真引用
 * （构建拼进闭包时由 stripTimeConfigRefs 整行删掉，名字由闭包里另一片提供；单行是硬要求，
 * 写成跨行构建会拒收）。除这一行之外，其余跨闭包名字一律只声明（declare），不做运行时引入。
 * 超时只结束这次等待，不判结果作废，迟到落地见 refresh/rooms/client/probe-scope-selection.ts。
 *
 * 反例：不要在这里加运行时 import；不要把未知当成否去推进状态机；
 * 不要在迟到与正常两路各写一份安装逻辑，分岔迟早长岔。
 */
    import { SNAP_WAIT_MS } from '../../../shared/time-config/values.js'
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）。
declare const wsKeyOf: any;
declare const isEnabled: any;
declare const log: any;
declare const shared: any;
declare const stores: any;
declare const emit: any;
declare const rememberWorkspaceRoot: any;
declare const hydrateFromCache: any;
declare const reportWorkspaceAttention: any;
declare const getCachedSnapshot: any;
declare const setCachedSnapshot: any;
declare const diskGetSnapshot: any;
declare const getProbeAt: any;
declare const lastProbeAtByCwd: any;
declare const getSnapshotVersion: any;
declare const userHintOf: any;
declare const _snapReuseInFlight: any;
declare const _snapMarkRequest: any;
declare const _snapRespStale: any;
declare const _snapRequestKeyWas: any;
declare const _installLateSnapshot: any;
declare const _snapInstallBody: any;
declare const askSelectionOnce: any;
// #1626：快照失败/超时会把 selPending 收掉，被推迟的首帧链求值也要在这一刻兜底发出去（实现在 probe-chain-subscription）。
declare const _flushDeferredChain: any;
declare const adoptWorkRouteTableIfNewer: any;
declare const touchProbeAt: any;
declare const mergeSelection: any;
declare const getCwdSync: any;
declare const tr: any;
declare const flash: any;
declare const host: any;
declare const window: any;
export const pendingSnapshotByCwd: Map<string, any> = new Map(); // Map<工作区键+后端,{promise,controller,backendId,seq}> dedup 30s（#653：按工作区根去重；#669 第 5 件：键里再带后端 —— 换过后端就不是同一次请求，见 refresh/rooms/client/staleness-indicator.js）
// #727：这一次快照请求的落地状态。带上它是为了给「迟到的成功回包」划一条界线 ——
//   正常那一路已经跑过之后，迟到的这一份一个字节都不许重复装（同一个工作区两边同时就绪是会碰上的）。
//   判据与落地在 refresh/rooms/client/probe-scope-selection.js，读写都在本文件这一行与那里的迟到处理器之间。
/**
 * 快照请求的落地标记：正常路与迟到路共用的互斥记号，迟到处理器靠它判断是否已装过。
 * 跨请求不共享，判据细节见 refresh/rooms/client/probe-scope-selection.js，改动先看那两处处理器。
 */
export const _snapInstallState: { handedOff: boolean } = { handedOff: false };
// #1009 收口（2026-10-10）：只留一条「界面耐心」30 秒，不再按「手上有没有画面」分两档。
//   为什么删掉冷启动那一档：分档判据选错了信号 —— 「有没有画面」不等于「这次要等多久」；
//   2026-09-24 那个现场是「磁盘快照已有画面、重建要几分钟」，按该判据仍是热档，照样早放手。
//   删档只丢「等待体感」，不丢能力：迟到的结果仍会落地（判据与落地在 refresh/rooms/client/probe-scope-selection.js）。
//   超时原文回到固定串，散列 246ae7f1 与文档的对应关系继续成立。
// 这个等待上限住中央：config/ttl.yaml 的 snapWaitMs，值由 tests/verify-time-config.ts 看守（本文件顶部 import 真引用）。
// #491 房外埋点 helpers（同一闭包拼回后全内核文件可见；只记散列与计数，渲染路径不用）：
const dswsLogHash = function (s: any): string { try { const t: string = String(s || ''); let h: number = 5381; for (let i: number = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8); } catch (e) { return '00000000'; } };
const dswsScrubHits: Record<string, number> = {};
const dswsScrubN: { n: number } = { n: 0 };
const dswsDiskSnapHitN: { n: number } = { n: 0 }; // #498 磁盘快照命中采样计数（百一采样，只增不显）
const dswsLogTrunc = function (s: any, n: number, field: any): string { try { const t: string = String(s || ''); if (t.length <= n) return t; try { const k: string = String(field || 'text') + ':T' + n; dswsScrubHits[k] = (dswsScrubHits[k] || 0) + 1; dswsScrubN.n += 1; if (dswsScrubN.n % 50 === 0 && isEnabled('debug')) log('debug', 'privacy.scrub', { field: String(field || 'text'), rule: 'T' + n, hit: true }); } catch (e) {} return t.slice(0, n); } catch (e) { return ''; } };
const dswsDedupWin: { n: number } = { n: 0 };
// #707 拆出：颜色小函数（hexA / darken）、数据层增量差异 diffSnapshots、高亮清除 scheduleFlashClear
//   都搬去了 refresh/rooms/client/snapshot-sync-helpers.js（本文件当时已 349 行、门禁上限 350，没有下脚的地方）。
//   三样东西的行为一行没改，拼接顺序保证同一个闭包里前后可见；拼接标记在 src/client/index.ts 里。
// #727：这一趟取数里有三处与「子目录会话的第一帧」直接相关，判据与理由都在 refresh/rooms/client/probe-scope-selection.js
//   （本文件贴着上限，所以那一段的文字放在那边）：
//     ① 进工作区时补问一次 wf.selection（askSelectionOnce，本文件末尾那行接线）；
//     ② 超时之后那份回包迟到时的落地口（_installLateSnapshot，本文件里那行 _rawP.then 接线）；
//     ③ 回包过期判据换成「按请求发出时那条目录比」（_snapRequestKeyWas，就是下面 H2 那一处守卫）。
// ============================================================
// 4. 文本生成 + 复制/注入
// ============================================================
export const nowStr = (): string => {
  try { const d: Date = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; }
};
// 定稿 1A：时间固定格式 MM-DD HH:MM（本地）
export const timeOf = (snap: any): string => {
  if (!snap) return '';
  try {
    const ms: any = (typeof snap.generatedMs === 'number' && snap.generatedMs) || Date.parse(snap.updatedAt || '');
    if (!ms) return '';
    const d: Date = new Date(ms);
    return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } catch (e) { return ''; }
};
// #327 特性 A 的毫秒重载（保留给需要按毫秒格式化时刻的调用方；状态栏从 2026-10-24 起改画快照取数时刻）
export const timeOfMs = (ms: any): string => {
  if (!ms) return '';
  try { const d: Date = new Date(ms); return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; }
};
// ============================================================
// 4. 配置广播（v25-50：配置保存后同步所有会话 store 的面板尺寸；外观定死不广播）
// ============================================================
export const broadcastCfg = function (): void {
  const applyTo = function (st: any): void {
    if (!st) return;
    st.size = { w: st.size ? st.size.w : 460, h: Math.max(240, Math.round(((window as any).innerHeight || 800) * 0.5)) };
    emit(st);
  };
  applyTo(shared);
  Object.keys(stores).forEach(function (k: string): void { applyTo(stores[k]); });
};
// #490 client 日志底座：开关变更广播（与 broadcastCfg 同构：共享与全组逐个走访并逐个发出更新； 开关值本身只存一份（logSwitch 内存与 dsws.debug 本地），广播只为让各会话界面刷新）。
export const broadcastLogSwitch = function (): void {
  const applyTo = function (st: any): void {
    if (!st) return;
    emit(st);
  };
  applyTo(shared);
  Object.keys(stores).forEach(function (k: string): void { applyTo(stores[k]); });
};
// 收下 wf.cwd 顺手带回来的工作区根（2026-09-19 加）。做两件事：
//   ① 记进 store：面板头部那枚归属标志就能在快照到达之前先画出来（它原先只能等一整份仓库快照）；
//   ② 记进那张「所选目录 → 工作区根」的表（原样用于显示、折算键用于比较），别的抽屉按工作区根分桶时也能早点对齐。
//   空值什么都不做 —— 这条路上「不知道」就是不知道，不拿空串去顶替一个根。
export const rememberSessionWorkspaceRoot = function (st: any, root: any): void {
  try {
    const raw: string = String(root == null ? '' : root).trim();
    if (!st || !raw) return;
    st.sessionWorkspaceRoot = raw;
    if (st.cwd) rememberWorkspaceRoot(st.cwd, raw);
  } catch (eR) {}
};
// #707：切进工作区的那一瞬间要先用旧快照铺满（定稿第十章、票面验收的「目标 ≤100 毫秒」），再上报
//   「我在看谁」。hydrateFromCache 是同步的（内存里那份快照），宿主那条电话是异步的 —— 先同步铺满
//   就一定发生在异步上报之前，与谁先谁后无关。已有内容时不覆盖它（那是用户正在看的画面）。
export const cacheFirstThenAttend = function (st: any, kind: any): any {
  try {
    const had: boolean = !!(st && (st.snapshot || getCachedSnapshot(st.cwd || '')));
    if (st && typeof hydrateFromCache === 'function') { if (hydrateFromCache(st) && !had) emit(st); }
  } catch (eHyd) {}
  try { if (typeof reportWorkspaceAttention === 'function') reportWorkspaceAttention(st, kind, null); } catch (eAt) {}
  return st;
};
// 快照（#346：面板数据源；force 走 wf.refresh 全量重建；wf.snapshot 侧 5s 缓存）
// #58 缓存优先：按 cwd 内存快照 + 空 cwd 同步，避免首开空 cwd 探路 miss 缓存导致 100-400ms 闪 loading
// 第四参 why（#1355）：本次强制刷新是因为手上缺本会话的工作路线表时传 'work-route-missing'，只落到常驻 #26 host.call 的 reason 格
//   —— 成功那行与发起那行带，host.call.fail 的白名单里没有 reason，失败那行不带。
export const loadSnapshot = function (st: any, force: any, silent: any, why: any): any {
  // #727 表达面的原始出发点：这一趟取数还没回话之前，「这个工作区用哪个后端」是「还不知道」，
  //   不该显示成「没有设置」——状态栏那条横幅据此改说「正在读取」（StatusBar 的 _selReading 同时看
  //   snapLoading 与 selPending 两个开关，照样能表达这件事）。
  // #1767：这趟取数自己不再借用 selPending 登记「在飞」。那个开关只有一个主人——问后端的那条专用电话
  //   （probe-scope-selection 的 askSelectionOnce 自己置、自己清）；快照取数在飞由 snapLoading 表达。
  //   原先在这里置旗会漏掉一个出口：同一个工作区只问一次后端（_selAskedKey 记住问过），第二次取数
  //   （例如空目录工作区点一次状态栏刷新）没有那条电话来顺手清旗，成功回包又只清 snapLoading，于是旗子
  //   永远亮着，横幅永久停在「正在读取」（#1767 真机复现：302.8 秒仍在转圈）。两个开关各管一件事，
  //   才不会有出口漏清。
  const doLoad = async function (): Promise<any> {
    // #1003 空目录闸：还没认出工作区目录之前，不发任何会被宿主补成进程目录的取数请求。
    //   不产出“没有后端”的结论、不在这条目录里起任何外部命令；界面保持“还没就绪”，就绪后自行恢复。
    if (!st.cwd) {
      try { st.selPending = false; } catch (ePendEmpty) {}
      try { st.snapLoading = false; } catch (eLoadEmpty) {}
      return Promise.resolve();
    }
    // #370 次要观察：force 刷新时跳过 snapLoading 守卫（加载中点击「刷新」不再 no-op）
    // #669 第 5 件：在途复用（含「换过后端就不复用」「force 不复用非 force」两条判据）都判在 refresh/rooms/client/staleness-indicator.js。
    const _reuse: any = _snapReuseInFlight(st, force);
    if (_reuse) return _reuse;
    // fix H1: remove global snapLoading guard — rely on per-cwd pendingSnapshotByCwd dedup (gate flake, #diagnosing-bugs)
    if (typeof host === 'undefined' || typeof host.call !== 'function') {
      st.snapMode = 'err';
      st.snapError = tr('err.hostUnavailable');
      emit(st);
      return Promise.resolve();
    }
    // #58 先水合 per-cwd 缓存，实现秒开
    hydrateFromCache(st);
    let hasCache: boolean = !!(st.snapshot || getCachedSnapshot(st.cwd));
    // #327 特性 B · 多级缓存：内存未命中先查磁盘（IndexedDB）——命中即秒显旧数据，随后照常发起网络校验
    //（不出现可见加载态；磁盘读约几十毫秒，先读后发请求的次序天然避免遮罩闪现）
    if (!hasCache) {
      try {
        const ent: any = await diskGetSnapshot(wsKeyOf(st.cwd || ''));
        if (ent && ent.snapshot && !st.snapshot && !getCachedSnapshot(st.cwd)) {
          try {
            setCachedSnapshot(st.cwd, ent.snapshot);
            try { if (ent.lastProbeAt && ent.lastProbeAt > getProbeAt(st.cwd)) lastProbeAtByCwd.set(wsKeyOf(st.cwd), ent.lastProbeAt); } catch (ePA2) {}
            hydrateFromCache(st);
            emit(st);
          } catch (eHyd2) {}
          try { dswsDiskSnapHitN.n += 1; if (isEnabled('debug') && dswsDiskSnapHitN.n % 100 === 0) log('debug', 'client.snapshot.hit', { keyHash: dswsLogHash(wsKeyOf(st.cwd || '')), ageMs: Date.now() - ((ent && (ent.ts || (ent.snapshot && ent.snapshot.generatedMs))) || Date.now()), kind: 'disk' }); } catch (eL) {}
          hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd));
        }
      } catch (eDisk) {}
    }
    try { if (!hasCache && !(st.snapshot || getCachedSnapshot(st.cwd))) log('info', 'client.snapshot.miss', { keyHash: dswsLogHash(wsKeyOf(st.cwd || '')), reason: 'empty' }); } catch (eL) {}
    // #776 只加日志不改行为：记下这次打开走缓存三选一的哪一支（有缓存还是现拉）。
    //   按需级，先判开关；每次取数一次，低频，不采样。
    try { if (isEnabled('debug')) log('debug', 'input.observe', { kind: 'cache-choice', count: hasCache ? 1 : 0, latencyMs: 0, keyHash: dswsLogHash(wsKeyOf(st.cwd || '')) }); } catch (eCc) {}
    st.snapLoading = true;
    // v1.5 T9：silent（后台静默刷新）不显示加载遮罩、不弹错误 toast
    // #58 缓存优先：已有缓存（含磁盘命中）时不显示全屏 loading，静默刷新
    if (force && !silent && !hasCache) st.snapMode = 'loading';
    emit(st);
    const ver: any = (typeof getSnapshotVersion === 'function' ? getSnapshotVersion(st.cwd) : '') || (st.snapshot && st.snapshot.version) || '';
    // #669 第 6 件（ADR 20260921）：只有用户亲手选过的那条才当 hint 上报 —— 派生值不许冒充意图
    //   （宿主那边带 hint 就压过锚文件，见 store-prefs.js 的 userHintOf 与 ADR 的攻击 1）。
    const _hintBid: any = (typeof userHintOf === 'function') ? userHintOf(st.selection) : undefined;
    const args: any = Object.assign({}, st.cwd ? { cwd: st.cwd, ifNoneMatch: ver, version: ver } : (ver ? { ifNoneMatch: ver, version: ver } : {}), st.sessionId ? { sessionId: st.sessionId } : {}, _hintBid ? { backendId: _hintBid } : {}); // #1082：带上会话 id，宿主才算得出「这一条是不是本会话」
    const _normKeyP: any = wsKeyOf(st.cwd || '');
    let _ctrl: any = null; try { _ctrl = typeof AbortController !== 'undefined' ? new AbortController() : { signal: { aborted: false }, abort(): void {} }; } catch (e) { _ctrl = { signal: { aborted: false }, abort(): void {} }; }
    let _timer: any = null;
    const callT0: number = Date.now();
    const callMethod: string = force ? 'wf.refresh' : 'wf.snapshot';
    // #653 日志纪律：发起这条跨边界调用前先记一行，与收到回包时那一行配成一对（按需级，先判开关）
    try { if (isEnabled('debug')) log('debug', 'host.call', { method: callMethod, kind: force ? 'refresh' : 'snapshot', ok: true, latencyMs: 0, reason: why ? String(why) : undefined }); } catch (eL) {}
    const _rawP: any = force ? host.call('wf.refresh', args) : host.call('wf.snapshot', args);
    // #1009 收口：只等上面那一条 30 秒。超时原文是固定串（散列 246ae7f1），不按等待时长拼。
    const _waitMs: number = SNAP_WAIT_MS;
    const _timeoutP: any = new Promise((_: any, rej: any) => { _timer = setTimeout(() => { try { _ctrl.abort(); } catch {} ; rej(new Error('client loadSnapshot timeout 30s')); }, _waitMs); });
    const p: any = Promise.race([_rawP, _timeoutP]).finally(function (): void { try { clearTimeout(_timer); } catch {} ; });
    // #669 第 5 件：登记这一次请求（序号 + 这次问的后端 + 在途键），发出去就记（判据见 refresh/rooms/client/staleness-indicator.js）。
    const _mine: any = _snapMarkRequest(st);
    try { pendingSnapshotByCwd.set(_mine.pendKey, { promise: p, controller: _ctrl, force: !!force, backendId: _mine.reqBackend, seq: _mine.seq, sessionId: st.sessionId || '' }); p.finally(function (): void { try { const cur: any = pendingSnapshotByCwd.get(_mine.pendKey); if (cur && cur.promise === p) pendingSnapshotByCwd.delete(_mine.pendKey); } catch {} }); } catch (e) {}
    const _reqNorm: any = _normKeyP; // capture request cwd for H2 stale discard
    // #1009：死线只结束「这一次等待」，不判「这份结果作废」—— 已经发出去的请求，回来时只要还是这把键上
    //   最新的一次、后端没换过、工作区没真的换走，就把**整份**装上（#727 那版只补 selection 与仓库引用
    //   那一小块；真机上更常见的后果是宿主辛苦拿回来的那份被丢掉、下一次还得整趟重跑）。判据与落地都在
    //   refresh/rooms/client/probe-scope-selection.js（本文件只留这一行接线）。
    _rawP.then(function (lateSnap: any): void { try { _installLateSnapshot(st, lateSnap, _reqNorm, _mine); } catch (eLate) {} }, function (): void { try { if (typeof _snapRespStale !== 'function' || !_snapRespStale(_reqNorm, _mine.seq, _mine.reqBackend, st)) { st.snapPending = false; emit(st); } } catch (eLateFail) {} });
    // #653：宿主这次回话里带的工作区根，先记进工作区键表——本会话与同工作区的其它会话随后都按它分桶。
    //   不管 ok 与否都记：它是宿主算出来的事实，与这份快照能不能装没有关系。
    return p.then(function (snap: any): any {
      // _snapInstallState.handedOff 已退役：重复安装改按这次请求的 gaveUp/mine.done 判，不跨请求共享。
      _mine.done = true; // #1009：那道判据收窄到「**这一次**请求装过没有」—— 更早的请求装过，不挡这一份迟到结果落地
      try { if (snap && snap.workspaceRoot) rememberWorkspaceRoot(st.cwd, snap.workspaceRoot); } catch (eWr) {}
      try { const okSnap: boolean = !!(snap && (snap.ok === true || snap.notModified === true || snap.status === 304)); const callKind: string = force ? 'refresh' : 'snapshot'; if (okSnap) log('info', 'host.call', { method: callMethod, latencyMs: Date.now() - callT0, ok: true, kind: callKind, reason: why ? String(why) : undefined }); else log('warn', 'host.call.fail', { method: callMethod, kind: callKind, errorHash: dswsLogHash(dswsLogTrunc(String((snap && snap.error) || 'snapshot-failed'), 120, 'error')) }); } catch (eL) {}
      // #327 特性 A：对该工作区完成了一次检查（成功/304/串台落地均算——请求已真实发出并返回）→ 时间走针
      try { if (snap && (snap.ok === true || snap.notModified === true || snap.status === 304)) touchProbeAt(_normKeyP); } catch (ePA) {}
      // fix H2 stale discard — if 工作区根 switched during flight, drop stale fallback (gate flake guard)
      // #727：这把尺子换成「请求发出时」那条目录（判据见下面这段末尾与 refresh/rooms/client/probe-scope-selection.js 的 _snapRequestKeyWas）。
      const _curNorm: any = wsKeyOf(st.cwd || '');
      if (_curNorm !== _reqNorm && !_snapRequestKeyWas(_reqNorm, st)) {
        // #232 R4 · 在途结果必须落地：请求发出时该工作区正被观看，响应到达即写内存 LRU 缓存，
        // 切回时 hydrateFromCache 秒显最新数据（零新请求）。仍不给换视图后的 store 直接 emit
        // （#45 串台回归防线不动）；setCachedSnapshot 自带 ok/maps 守卫，坏形自然丢弃。
        // #653：这里的键是请求发出时的那把工作区键，不是会话所选目录——跨会话复用的正是它。
        try { setCachedSnapshot(_reqNorm, snap); } catch (e232r4) {}
        st.snapLoading = false;
        try { const cur2: any = pendingSnapshotByCwd.get(_mine.pendKey); if (cur2 && cur2.promise === p) pendingSnapshotByCwd.delete(_mine.pendKey); } catch (e) {}
        return;
      }
      // #669 第 5 件：换过后端的这一份不算数（或已经不是这把键上最新的一次）—— 照装的话，
      //   面板会从刚切过去的后端退回切换前那个，用户看到的就是「点了确认没反应」（判据见 probe-stale.js）。
      if (_snapRespStale(_reqNorm, _mine.seq, _mine.reqBackend, st)) {
        try { if (isEnabled('debug')) log('debug', 'snapshot.stale.drop', { keyHash: dswsLogHash(_reqNorm) }); } catch (eDrop) {}
        st.snapLoading = false; emit(st); return;
      }
      st.snapLoading = false;
      try { st.snapPending = false; } catch (ePendOk) {}
      if (snap && (snap.notModified === true || snap.status === 304)) {
        // 304 zero emit per spec: version unchanged -> keep old table, no UI change
        st.snapLoading = false;
        // #1355：版本没变（304）也可能带着本会话的工作路线读数 —— 「缺表补拉撞上内容一个字没变」正是这条路的现场。
        // #1373：本地那份表「有、但是旧的」时也不能扔掉来者 —— report 只改账本不改版本号，
        //   旧表不换的话胶囊永远是空的。什么算「更新」只收 work-route-own 那一个函数说了算。
        //   表只挂到当前会话手上那份快照的浅拷贝上（不替换别的内容、不原地改），也不写按工作区共享的缓存（那边本来也会剥掉它）。
        try { if (typeof adoptWorkRouteTableIfNewer === 'function') adoptWorkRouteTableIfNewer(st, snap) } catch (eWr304) {}
        // #683（F1 · ADR 的 R4）：304 也要合并权威选择 —— 「只换了后端、快照内容一个字没变」正是这条路的现场：版本号没变所以这里什么都不做，于是面板头与状态栏继续显示旧后端，而同屏的链与横幅（走 wf.detect）已经按新值答了。宿主这一版回包里带着 {selection, rev}，这里合并它。
        try { if (snap.selection && typeof mergeSelection === 'function') { if (mergeSelection(st, snap.selection)) emit(st); } } catch (eSel) {}
        // #683（F1 · R6）/#1449：304 也把布局合并进会话手上那份快照（版本号没变不代表布局没变）。
        //   宿主现在无条件带 setupLayout（含 null），这里照收；快照是共享缓存，合并时浅拷贝，不原地改。
        try { if (snap.setupLayout !== undefined) { st.snapshot = Object.assign({}, st.snapshot || {}, { setupLayout: snap.setupLayout }); } } catch (eSL) {}
        // still touch LRU ts via setCachedSnapshot? keep old
        emit(st); // minimal tick for probe freshness but no data change
        return;
      }
      if (snap && snap.ok === true && Array.isArray(snap.maps)) {
        // #1009：装快照那一整段搬去 refresh/rooms/client/probe-scope-selection.js 的 _snapInstallBody —— 正常那一路与迟到那一路
        //   共用同一处，免得两处各写一遍、判据（缓存优先落表、补标签颜色、回填布局）迟早长岔。
        _snapInstallBody(st, snap);
      } else {
        st.snapMode = 'err';
        st.snapError = (snap && snap.error) ? String(snap.error).slice(0, 160) : tr('err.snapshotEmpty');
        // #715：这次取数失败，把「是哪一种失败」一起收下 —— 判据由宿主看真实读数分好类
        //   （wf.snapshot 回包的 failKind：配额被别人耗尽 / 插件自己的取数失败），界面只翻成两句不同的话。
        st.snapFail = { kind: (snap && snap.failKind === 'quota-exhausted') ? 'quota-exhausted' : 'fetch-failed', at: Date.now() };
        if (force && !silent) flash(st, tr('toast.snapFail', { err: st.snapError }), 'warn');
      }
      emit(st);
    }).catch(function (e: any): void {
      try { _mine.gaveUp = true; } catch (eGave) {}
      try { log('warn', 'host.call.fail', { method: callMethod, kind: force ? 'refresh' : 'snapshot', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }); } catch (eL) {}
      st.snapLoading = false;
      // #1009 收口：放弃等待时立一面诚实旗子 —— 30 秒到点界面会说失败，可活还在跑；
      //   有这面旗子，提示语改说「仍在等，拿到后自动更新」，不再把「没等到」说成「失败了」。
      //   迟到落地或真失败时清掉（落地那两处在 refresh/rooms/client/probe-scope-selection.js，迟到失败在上面那行 late 口）。
      // 优化：过期请求（已有更新一次在后）不碰旗子，免得老超时盖掉新数据的状态。
      try {
        const _msg: string = String((e && e.message) || e);
        const _stale: boolean = (typeof _snapRespStale === 'function') ? _snapRespStale(_reqNorm, _mine.seq, _mine.reqBackend, st) : false;
        if (!_stale) {
          if (_msg.indexOf('client loadSnapshot timeout') >= 0) st.snapPending = true;
          else st.snapPending = false;
        }
      } catch (ePend2) {}
      // #727：这一次等待到此为止（超时也算）——「在途」这个理由不再成立，横幅回到原来那套判据上。
      //   注意这里只结束「等待」：那份回包若后来还是回来了，由上面的迟到处理器收下（#1009 起整份落地）。
      if (st.selPending === true) st.selPending = false;
      // #1626：这一次取数失败了，「选择还说不准」的那个在途理由也随之收回；若首帧链求值正被推迟着，
      //   按空键诚实降级发一次（与修前行为一致），别让它永远等一个不会来的选择。
      try { if (typeof _flushDeferredChain === 'function') _flushDeferredChain(st); } catch (eFlushSnapFail) {}
      st.snapMode = 'err';
      st.snapError = String((e && e.message) || e).slice(0, 160);
      if (force && !silent) flash(st, tr('toast.snapFail', { err: st.snapError }), 'warn');
      emit(st);
    });
  };
  // #58 若 cwd 仍空且可同步补齐，先补 cwd 再加载，避免空 cwd miss 磁盘缓存
  if (!st.cwd) {
    const sync: any = getCwdSync(st.sessionId);
    if (sync) { st.cwd = sync; hydrateFromCache(st); }
  }
  // #707：老会话与直接进面板这两条常见路径也要先铺满、再上报「我在看谁」。
  //   放在这里（而不是更早）是因为此刻工作区根已经能拿到（hydrateFromCache 顺路把缓存里的根收进来）。
  try { cacheFirstThenAttend(st, 'panel-open'); } catch (eAtt) {}
  if (!st.cwd && st.sessionId && typeof host !== 'undefined' && typeof host.call === 'function') {
    return host.call('wf.cwd', { sessionId: st.sessionId }).then(function (res: any): any {
      // 这条电话从 2026-09-19 起顺手带回「这个会话的工作区根」。先收下它：面板头部那枚归属标志
      //   只要这一个值，收下就能在下面那份快照到达之前先画出来（缓存没命中时快照要等几十秒）。
      try { if (res && res.workspaceRoot) rememberSessionWorkspaceRoot(st, res.workspaceRoot); } catch (eR) {}
      if (res && res.ok && res.cwd && !st.cwd) { st.cwd = res.cwd; hydrateFromCache(st); emit(st); }
      return doLoad();
    }).catch(function (): any { return doLoad(); });
  }
  // cwd 已经有了的常见情形：这条电话本来不一定会走，但工作区根值得单独问一次 —— 它很便宜
  //   （宿主侧 30 秒缓存），而且是那枚标志唯一的早到来源。拿到了就重画一次；拿不到什么都不做，
  //   界面上不会因为这一条失败而出现任何变化。
  //   只问一次（记在 store 的 _wsRootAsked 上）：万一宿主那一版还不回这个字段，也不至于每次开面板都多一问。
  if (st.cwd && st.sessionId && !st.sessionWorkspaceRoot && !st._wsRootAsked && typeof host !== 'undefined' && typeof host.call === 'function') {
    st._wsRootAsked = true;
    try {
      host.call('wf.cwd', { sessionId: st.sessionId }).then(function (res: any): void {
        if (res && res.workspaceRoot) { rememberSessionWorkspaceRoot(st, res.workspaceRoot); emit(st); }
      }).catch(function (): void {});
    } catch (eAsk) {}
  }
  // #727（I1）：进工作区时若还不知道这个工作区用哪个后端，补问一次宿主那条专用电话（wf.selection）。
  //   为什么放在这里：这一刻 cwd 已经是最终值（上面两条补齐 cwd 的路都走完了），而「等那份完整快照」
  //   在大工作区上要几分钟 —— 一条几十字节的事实不该搭那趟车。幂等、限次、失败不弹提示，判据全在
  //   refresh/rooms/client/probe-scope-selection.js 的 askSelectionOnce 里（本文件只留这一行接线）。
  try { if (typeof askSelectionOnce === 'function') askSelectionOnce(st); } catch (eSelAsk) {}
  return doLoad();
};
