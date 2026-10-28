/**
 * src/refresh/rooms/client/probe-scope-selection.ts —— 后端选定的两条专用轨迹（#727 从 probe-snapshot.ts 拆出）
 *
 * 为什么拆出来：probe-snapshot.ts 一直贴着「单文件 ≤350 行」那条上限，
 * 加上这两段就过线了；#707 也是为同一个原因从它身上拆出过颜色与差异那三样。
 * 本文件为模块真源，源码树里只有这一份真源，改这里就够。
 * 构建侧把声明体拼回 src/client/index.ts 里那条 probeSelect 拼接标记处。
 *
 * 本文件管两件事，都与「这个工作区用哪个后端」这条事实有关：
 * ① 进工作区时补问一次宿主那条专用电话（wf.selection）；
 * ② 「那次快照等超时了、但它后来还是回来了」的回包怎么落地。
 * 两件事共用一条界线，与那次请求的登记同处，所以同住一处。
 *
 * 三条不变量（门禁 tests/verify-subdir-first-frame.js 按这三条写）：
 * I1 便宜且专用：一条事实只由一条代价相称的专用通道投递；
 * I2 未知不等于否：「还没读到」必须与「确实没有设置」分开表达；
 * I3 迟到的正确结果必须能落地：30 秒死线只决定这次等待结束，不决定结果作废。
 * 调用方只在 probe-snapshot.ts 的 doLoad 里接线，改接线先看那几行调用。
 *
 * 反例：不要在这里加运行时 import；不要把空回包当成「没有设置」去顶替结论；
 * 不要把迟到回包整份丢掉，用户只能靠再点一次刷新才看得见它。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）。
declare const host: any;
declare const wsKeyOf: any;
declare const isEnabled: any;
declare const log: any;
declare const dswsLogHash: any;
declare const dswsLogTrunc: any;
declare const mergeSelection: any;
declare const workspaceRootByCwd: any;
declare const keyOf: any;
declare const _snapRespStale: any;
declare const emit: any;
// #1626：把推迟的那一次链求值补发出去（实现在 probe-chain-subscription 片段里，叶子沙箱可能没有它）。
declare const _flushDeferredChain: any;
declare const setCachedRepository: any;
declare const diffSnapshots: any;
declare const flash: any;
declare const tr: any;
declare const scheduleFlashClear: any;
declare const lcApplySavedColorsOnInstall: any;
declare const applySnapshotSelection: any;
declare const setCachedSnapshot: any;
declare const setPresentationMap: any;
declare const startAutoProbe: any;
declare const touchProbeAt: any;
declare const adoptWorkRouteTableIfNewer: any;
// 进工作区时补问一次「这个工作区用哪个后端」（I1：几十字节的事实不搭 16 MB 的车）。
// 宿主那边这条电话本来就有（wf.selection），只是界面进工作区时一条都不用 —— 全仓原先只有设置页在调。
// 判据（口径只此一处）：
//   · 手上有后端时不问（缓存先命中就不该再打这条电话）；cwd 还不认识时也不问
//     （拿宿主的默认目录去问等于替用户认一个工作区 —— 那不叫修，那叫猜）。
//   · 每个工作区只问一次（幂等、限次）：问过就记在 st._selAskedKey 上，失败也不重问、不弹提示。
//   · 回包里 selection 为空时什么都不做（I2）：那是「还没读到证据」，不是「没有设置」。
// 拿到的那条走的是与快照同一条合并口（mergeSelection，住在 store-snapshot.js），
// 所以面板头、状态栏、引导链读到的都是同一份结论，不用各自改口径。
export const askSelectionOnce = function (st: any): any {
  try {
    if (!st || typeof host === 'undefined' || typeof host.call !== 'function') return null;
    if (st.selection && st.selection.backendId) return null;
    if (!st.cwd) return null;
    const k: any = wsKeyOf(st.cwd);
    if (!k) return null;
    if (st._selAskedKey === k) return null;
    st._selAskedKey = k;
    // I2 的表达面：从这一刻起，「后端还说不准」这件事有了一个真的在途原因 ——
    //   状态栏据此不说「该工作区还没有设置」（见 statusbar/StatusBar.js 的 _selReading）。
    st.selPending = true;
    emit(st);
    const method: string = 'wf.selection';
    const t0: number = Date.now();
    // 跨边界调用先记一行（按需级，外层先判开关），与收到回包那一行配成一对。
    try { if (isEnabled('debug')) log('debug', 'host.call', { method: method, kind: 'selection', ok: true, latencyMs: 0 }); } catch (eL) {}
    return host.call(method, { cwd: st.cwd, sessionId: st.sessionId || '' }).then(function (res: any): any {
      try {
        const okRes: boolean = !!(res && (res.ok === true || (res.value && res.value.ok === true)));
        if (okRes) log('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: 'selection' });
        else log('warn', 'host.call.fail', { method: method, kind: 'selection', errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error) || 'selection-failed'), 120, 'error')) });
      } catch (eL) {}
      // I2：回包里没有选择就是「还不知道」，什么都不做 —— 绝不拿空值去顶替一个结论。
      try {
        const sel: any = (res && res.selection) || (res.value && res.value.selection) || null;
        if (sel && typeof mergeSelection === 'function' && mergeSelection(st, sel)) emit(st);
      } catch (eSel) {}
      st.selPending = false;
      // #1626：选择落定了 —— 首帧被推迟的那一次链求值现在可以带着完整键发出去。
      try { if (typeof _flushDeferredChain === 'function') _flushDeferredChain(st); } catch (eFlushSel) {}
      emit(st);
      return res;
    }).catch(function (e: any): any {
      try { log('warn', 'host.call.fail', { method: method, kind: 'selection', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }); } catch (eL) {}
      st.selPending = false;
      // #1626：这条电话失败了也不吊死首帧 —— 照旧按空键求值一次（诚实降级，与以前的行为一致）。
      try { if (typeof _flushDeferredChain === 'function') _flushDeferredChain(st); } catch (eFlushErr) {}
      emit(st);
      return null;
    });
  } catch (eAsk) { return null; }
};
// 那份「等超时了、后来还是回来了」的回包，还能不能收下 —— 按**请求发出时**那条目录比。
// 为什么要换尺子：原来拿「回包自己带回来的根」去比「请求时那条子目录键」，而 learn 那一步就发生在
//   同一份回包里（先教会客户端根、再比对），于是子目录会话的第一份回包必判「工作区换过了」。
// 换尺子不许丢掉 #232 R4 / #45 的原意：请求时目录 A、现在目录 B（会话真的换走了）仍然判过期，
//   那条反证写在新门禁的「反向」一组里（把这条判据改回原样，子目录那一式必须变红）。
// 三种情形的判法：
//   · 请求时那条目录还是现在这条（两把键相等）：收。这就是改动前的旧判据，一行没动。
//   · 请求那条键上已经学到过根：拿同一个根重算这把请求键 —— 学到根之后它必然等于现在这把键。
//   · 两条都不成立（请求时目录 A、现在目录 B）：不收。
export const _snapRequestKeyWas = function (reqNorm: any, st: any): boolean {
  try {
    const raw: any = (st && st.cwd) || '';
    if (!reqNorm || reqNorm === wsKeyOf(raw)) return true;
    const hit: any = (typeof workspaceRootByCwd === 'object' && workspaceRootByCwd) ? workspaceRootByCwd[reqNorm] : '';
    if (hit && keyOf(hit) === wsKeyOf(raw)) return true;
    return false;
  } catch (e) { return false; }
};
// 迟到的成功回包（Promise.race 已经判超时、可这份回包还是回到了）：至少把 selection 这一小块装上，
// 它正是「用哪个后端」那条事实的载体（I3）。为什么必须落地：死线只结束了「这次等待」，
//   而这份结果是真的、只差没赶上；不装的话用户只能靠再点一次刷新或换个会话再切回来才看得见它。
// 只装 selection 与 repository —— 快照正文那一大块等下一次正常取数，不在这里偷偷换掉用户正在看的画面。
// 三个前提缺一不可：这一次还没走过正常那一路、这条键上后面没发过更新的一次（且后端没换过）、
//   工作区没真的换走（#45 串台防线）。
export const _installLateSnapshotSelection = function (st: any, snap: any, reqNorm: any, mine: any): boolean {
  try {
    if (!snap || !st || !mine) return false;
    // #1009 收口 F1：迟到落地只在真的放弃等待之后生效。正常那一路先回来时，这一次还没放弃，
    //   这里一个字节都不装，也不再记那一行日志（原来靠正常路后置的标记挡，会被微任务顺序绕过）。
    if (!mine.gaveUp) return false;
    // 同一次请求已装过就不重复装（按这次请求判，不跨请求共享；全局 handedOff 已退役）。
    if (mine.done === true) return false;
    // 后来发过更新的一次、或用户已经换到别的后端：与正常那一路同一把尺子，扔（#669 第 5 件）。
    if (typeof _snapRespStale === 'function' && _snapRespStale(reqNorm, mine.seq, mine.reqBackend, st)) return false;
    if (!_snapRequestKeyWas(reqNorm, st)) return false;
    mine.done = true;
    let changed: boolean = false;
    if (snap.selection !== undefined && typeof mergeSelection === 'function') { try { if (mergeSelection(st, snap.selection)) changed = true; } catch (eSel) {} }
    // #1449：迟到回包也把布局合并进会话手上那份快照（宿主无条件带 setupLayout，含 null）。
    if (snap.setupLayout !== undefined) { try { st.snapshot = Object.assign({}, st.snapshot || {}, { setupLayout: snap.setupLayout }); changed = true; } catch (eSL) {} }
    // #1373：迟到的 304 同样可能捎着更新的工作路线读数 —— 只补 selection 的老路会把它丢掉，
    //   胶囊就还是空的。判据与正常那一路共用 adoptWorkRouteTableIfNewer，换上才记 changed（会 emit）。
    try { if (typeof adoptWorkRouteTableIfNewer === 'function' && adoptWorkRouteTableIfNewer(st, snap)) changed = true } catch (eWrLate) {}
    if (snap.repository !== undefined) { try { st.repository = snap.repository; if (st.cwd) setCachedRepository(st.cwd, snap.repository); } catch (eRep) {} }
    st.selPending = false;
    try { st.snapPending = false; } catch (ePendLate) {}
    // #1626：迟到落地也可能正是「选择终于到了」的那一刻；有被推迟的链求值就补发。
    try { if (typeof _flushDeferredChain === 'function') _flushDeferredChain(st); } catch (eFlushLate) {}
    if (changed) emit(st);
    // 这条轨迹按需记：迟到本身就少见，而「为什么这一格后来自己好了」正是以后要查的那一问。
    try { if (isEnabled('debug')) log('debug', 'snapshot.late.install', { keyHash: dswsLogHash(reqNorm), installed: !!changed }); } catch (eL) {}
    return changed;
  } catch (eLate) { return false; }
};
// #1009：装一份「真的拿到了」的快照。正常那一路与迟到那一路共用这一处 ——
//   两处各写一遍的话，判据（缓存优先落表、补标签颜色、清错误态）迟早长岔。
// #1449：布局不再单独回填浏览器表——它就是快照里的一个字段，读的地方直接读 st.snapshot.setupLayout。
// 装与不装由调用方判（_snapRespStale / _snapRequestKeyWas）；本函数只管装，返回 true = 装上了。
export const _snapInstallBody = function (st: any, snap: any): boolean {
  try {
    if (!st || !snap || snap.ok !== true || !Array.isArray(snap.maps)) return false;
    // v1.5 T10 R4：数据层增量 diff（新旧快照对比）—— 供多视图增量与 R5 视觉
    st.lastDiff = diffSnapshots(st.snapshot, snap);
    st.rowFlash = {};
    st.issueFlash = {};
    var _df: any = st.lastDiff;
    _df.added.forEach(function (n: any): void { st.rowFlash[n] = 'added'; });
    _df.changed.forEach(function (n: any): void { st.rowFlash[n] = 'changed'; });
    if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (k: string): void { st.issueFlash[k] = _df.issueFlash[k]; });
    // R5 视觉：有变化才提示 + 定时清除高亮（防堆积）
    if (_df.removed.length) flash(st, tr('panel.diffRemoved', { n: _df.removed.length }), 'info');
    scheduleFlashClear(st);
    st.snapshot = snap;
    // #635：这份快照如果是「保存前就发出去、保存后才回来」的那一次刷新拿回来的，它不知道刚改过的
    // 标签颜色，装进来就会把面板倒回旧色。装进来之后先按那次保存确认过的色值补一遍，
    // 补的规则与记录都住在 views/labels/labelColorPatch.js（比那份记录旧才补，新的就作废记录）。
    try { if (typeof lcApplySavedColorsOnInstall === 'function') lcApplySavedColorsOnInstall(st, st.snapshot); } catch (eLC) {}
    st.snapMode = 'real';
    st.snapError = null;
    // #155：同步 selection/repository 镜像
    try { if (typeof applySnapshotSelection === 'function') applySnapshotSelection(st, snap); } catch {}
    // #1626：正常快照也可能带着 selection 回来（例如那条专用电话失败/超时）；有被推迟的链求值就补发。
    try { if (typeof _flushDeferredChain === 'function') _flushDeferredChain(st); } catch (eFlushSnap) {}
    // #58 缓存优先：落内存表，供新会话秒开 — suspicious fallback 不污染缓存
    // #653：这里从前会先把同一份快照按 snap.repoRoot 存一把、再按所选目录存一把（两把键，两个桶），
    //   子目录会话与根会话因此各看各的。现在 setCachedSnapshot 自己按工作区键（wsKeyOf）落，
    //   只需要一次调用，同一工作区天然同桶。
    try {
      const nxt: any = snap.selection;
      const cur: any = st.selection;
      const isSuspicious: boolean = !!(nxt && nxt.backendId === null && !nxt.pending && nxt.source === 'fallback' && cur && cur.backendId);
      if (!isSuspicious) {
        setCachedSnapshot(st.cwd, snap);
      }
    } catch (e) { /* 忽略 */ }
    // 拉取 backendModules（若 snapshot 未带，则另调 registry）
    try {
      if (!st.backendModules && typeof host !== 'undefined' && host.call) {
        host.call('wf.registry', { cwd: st.cwd }).then(function (r: any): void {
          if (r && r.ok && Array.isArray(r.modules)) { st.backendModules = r.modules; try { setPresentationMap(r.modules); } catch {} ; emit(st); }
        }).catch(function (): void {});
      }
    } catch {}
    // v1.5 T10：启动自动变化探测（幂等；快照就绪后生效）
    startAutoProbe();
    // v1.5 B5 修订：磁盘缓存秒开（fromCache）→ 不再 400ms 强制全量刷新。
    //   原逻辑每次打开面板 = 1 次额外 wf.refresh（aliases 大查询 ≈ 18 GraphQL 点），
    //   多仓库会话下成倍放大；变化检测已由低频 probe（5min + focus 限流）接管，
    //   磁盘缓存本身是最新全量快照，秒开直接展示即可，无需立即重建。
    return true;
  } catch (e) { return false; }
};
// #1009：等超时了、可那份回包后来还是回来了 —— 它算不算数、怎么算数。三种走法：
//   ① 还是这把工作区键上最新的一次、后端没换过、工作区也没真的换走 → **整份装上**，并把「上一次刷新」
//      那根针往前拨一次（这份数据确实是刚拿回来的）。为什么不再只补 selection 那一小块（#727 那版的做法）：
//      真机上更常见的后果是宿主辛苦拿回来的那份被丢掉，用户既没看到新数据、下一次还得整趟重跑。
//   ② 工作区确实换走了 → 不装进新视图（#45 串台防线照旧），但按**请求时那把键**落进内存表：
//      结果不作废，切回那个工作区时秒开。
//   ③ 回来的不是完整正文（304 / 空结果）→ 退回 #727 的原做法：只补 selection 与仓库引用那一小块。
// 三个前提：真的放弃等待过（mine.gaveUp，只在超时那一支立）、同一个请求的正常那一路没装过
//  （mine.done，两边同时就绪的竞态）、这份没被判过期；整份装之前再比一次数据新旧（最新者胜）。
export const _installLateSnapshot = function (st: any, snap: any, reqNorm: any, mine: any): boolean {
  try {
    if (!snap || !st || !mine) return false;
    // #1009 收口 F1：同上。超时那一支立 flag 之前，迟到的处理器不许装（正常回包先到正是这种情况）。
    if (!mine.gaveUp) return false;
    if (mine.done === true) return false;
    if (typeof _snapRespStale === 'function' && _snapRespStale(reqNorm, mine.seq, mine.reqBackend, st)) return false;
    const hasBody: boolean = !!(snap.ok === true && Array.isArray(snap.maps));
    if (!hasBody) return _installLateSnapshotSelection(st, snap, reqNorm, mine);
    if (!_snapRequestKeyWas(reqNorm, st)) {
      try { setCachedSnapshot(reqNorm, snap); } catch (eC) {}
      return false;
    }
    // #1009 收口 F2：装之前比数据新旧（最新者胜）。两边都有时间戳才比大小，来者大才装；
    //   只有一边有时，有值者胜；两边都没有时退回上面的序号判，不因缺字段丢掉。
    //   丢掉时沿用既有事件记一行（字段只用 keyHash 与 installed，不加字段），原因靠 installed:false 表达。
    try {
      const _incMs: number = (snap && typeof snap.generatedMs === 'number' && snap.generatedMs > 0) ? snap.generatedMs : 0;
      const _curMs: number = (st.snapshot && typeof st.snapshot.generatedMs === 'number' && st.snapshot.generatedMs > 0) ? st.snapshot.generatedMs : 0;
      if (_incMs > 0 && _curMs > 0) {
        if (!(_incMs > _curMs)) {
          try { if (isEnabled('debug')) log('debug', 'snapshot.late.install', { keyHash: dswsLogHash(reqNorm), installed: false }); } catch (eOld) {}
          try { st.snapPending = false; } catch (ePendOld) {}
          return false;
        }
      } else if (_incMs === 0 && _curMs > 0) {
        try { if (isEnabled('debug')) log('debug', 'snapshot.late.install', { keyHash: dswsLogHash(reqNorm), installed: false }); } catch (eOld2) {}
        try { st.snapPending = false; } catch (ePendOld2) {}
        return false;
      }
    } catch (eCmp) {}
    mine.done = true;
    st.snapLoading = false;
    try { st.snapPending = false; } catch (ePendDone) {}
    const installed: boolean = _snapInstallBody(st, snap);
    if (installed) {
      try { touchProbeAt(reqNorm); } catch (ePA) {}
      try { emit(st); } catch (eE) {}
    }
    // 这条轨迹按需记：迟到本身就少见，而「为什么这一格后来自己好了」正是以后要查的那一问。
    try { if (isEnabled('debug')) log('debug', 'snapshot.late.install', { keyHash: dswsLogHash(reqNorm), installed: !!installed }); } catch (eL) {}
    return installed;
  } catch (eLate2) { return false; }
};
