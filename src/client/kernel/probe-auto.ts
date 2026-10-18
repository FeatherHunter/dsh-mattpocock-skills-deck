/**
 * src/client/kernel/probe-auto.ts — 内核模块（#456 由 probe.js 拆出之自动探测节拍、手动刷新与新鲜度）
 *
 * 为什么保留这份节拍契约：自动刷新按工作区键去重，同组共享一次探测，
 * 组间零污染；手动刷新走静默路径，不挡渲染。构建侧去掉行首 export 后
 * 拼回 src/client/index.js 的拼接标记处，一源两物、src 零复制。
 * 同名 .js 是构建产物，改这里。接口冻结清单见 kernel-contract.md。
 *
 * 节拍数字为什么不住这里：兜底探针周期与新鲜度阈值由契约层派生，
 * 正常路径取 tracker/sync.js 契约里的那一份，缺席时兜底取拼进闭包的
 * 中央常量（CLIENT_TIME_NAMES 列出的那几个），这里不留第二份数字。
 * 跨文件名字一律 declare，不做运行时引入（拼进浏览器闭包会拒收 import）。
 *
 * 反例：不要在界面层硬编码几秒刷一次；不要让 force 刷新被守卫丢弃；
 * 不要给后台工作区排定时器，后台由宿主按视野模型安排。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）。
declare const SYNC: any;
declare const SYNC_FALLBACK_PROBE_MS: number;
declare const SYNC_FOCUS_PROBE_MIN_MS: number;
declare const SYNC_SNAP_FRESH_MS: number;
declare const PROBE_AUTO_WAIT_MS: number;
declare const host: any;
declare const _attentionPlan: any;
declare const shared: any;
declare const stores: any;
declare const wsKeyOf: any;
declare const keyOf: any;
declare const log: any;
declare const dswsLogHash: any;
declare const dswsLogTrunc: any;
declare const touchProbeAt: any;
declare const emit: any;
declare const diffSnapshots: any;
declare const scheduleFlashClear: any;
declare const loadSnapshot: any;
declare const isEnabled: any;
declare const timer: any;
declare const document: any;
declare const window: any;
declare const hydrateFromCache: any;
declare const chainEventRefresh: any;
declare const loadChain: any;
declare const setupPendingOf: any;
declare const attentionVisible: any;
declare const attentionStoreOf: any;
declare const namingGuardianEvent: any;
declare const applySnapshotSelection: any;
declare const flash: any;
declare const tr: any;
// v1.5 R2（#2 MVP · 2026-08-18）：自动刷新 — probe 走 since 时间戳探测全 issue 增量
//   （#348 + v1.5 T10 B5「配额止血 · 第一性原理」延续）：① probe 降到 60s（用户感知阈值 · R1 是 5min）；
//   ② changed 只刷新与本次探测 cwd 相同的 store（多仓库会话并发不互串）；
//   ③ focus 触发限流 ≥60s（窗口来回切换不再疯狂烧）。
//   与 R1 区别：probe 范围从 `labels=wayfinder:map`（仅地图）扩到 `since=<ISO>`（全 issue，含子票）—— 见 host 侧 `case 'probe'`。
// #232 · 节拍真源单源化：兜底探针周期由契约层派生（UI 层不得硬编码知道底层几秒刷一次）。
// #1215：正常路径取 tracker/sync.js 契约里的那一份（config/intervals.yaml 的 syncFallbackProbeMs /
//   syncFocusProbeMinMs）；SYNC 缺席时兜底取拼进本闭包的中央常量 SYNC_FALLBACK_PROBE_MS /
//   SYNC_FOCUS_PROBE_MIN_MS（名字列在 scripts/build.mjs 的 CLIENT_TIME_NAMES 里），这里不留第二份数字。
export const PROBE_MS: number = ((typeof SYNC === 'object' && SYNC && SYNC.FALLBACK_PROBE_MS) || SYNC_FALLBACK_PROBE_MS);
export const FOCUS_PROBE_MIN_MS: number = ((typeof SYNC === 'object' && SYNC && SYNC.FOCUS_PROBE_MIN_MS) || SYNC_FOCUS_PROBE_MIN_MS);
export let lastFocusProbe: number = 0;
// v1.5 T10 R9（Q4 拍板 · DESIGN.md 12.2）：关键动作后延迟探测 —— 完成/执行/交接后面板尽快反映 GitHub 变化；
//   防抖（一次只排一个）+ 探测本身 1 次轻量 REST，配额安全
export let _actionProbePending: boolean = false;
export const probeNow = function (fromFocus: any): void {
  if (typeof host === 'undefined' || typeof host.call !== 'function') return;
  if (fromFocus) {
    const now: number = Date.now();
    // #707：宿主已经在活跃集合里给了这个工作区一个探测间隔（正在看的 5 秒），回到前台时按它判；
    //   拿不到那个间隔（还没上报过、或不在活跃集合里）就退回 #232 那条 60 秒的限流。
    const gateMs: number = (_attentionPlan.intervalMs > 0) ? _attentionPlan.intervalMs : FOCUS_PROBE_MIN_MS;
    if (now - lastFocusProbe < gateMs) return;
    lastFocusProbe = now;
  }
  // #45 修复（2026-08-20）：多工作区异步回调导致右侧面板串台
  // 根因：原实现经 shared（单例）广播新快照到所有 stores（Object.keys(stores).forEach），且 shared.cwd 仅首写，
  //   导致工作区 A 的异步变更（probe changed）把 A 的快照写入 B 的 store，右侧面板“串台”显示非当前工作区内容。
  // 修复：按 cwd 分组隔离 —— 同 cwd 组内共享 1 次 GraphQL（primary load → 余下拷贝），组间零污染；
  //   兜底路径按 sessionId→cwd 精确映射赋值，避免把任意首个 cwd 错绑到所有空 store。
  const refreshGroup = function (cwd: any): any {
    const probeT0: number = Date.now();
    return host.call('wf.probe', { cwd: cwd }).then(function (res: any): any {
      try { if (res && res.ok) log('info', 'host.call', { method: 'wf.probe', latencyMs: Date.now() - probeT0, ok: true, kind: 'probe' }); else log('warn', 'host.call.fail', { method: 'wf.probe', kind: 'probe', errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error) || 'probe-not-ok'), 120, 'error')) }); } catch (eL) {}
      // #327 特性 A：探测完成即走针（无论是否检出变化）
      try { if (res && res.ok) touchProbeAt(cwd); } catch (ePA) {}
      if (!(res && res.ok && res.changed)) return;
      // #723（T19c）第 E 件：宿主在探测那一步已经把变的那几条用薄查询补进列表了
      //   （res.mode === 'patch'，回包里带的 snapshot 就是补好的那一份），这里直接吃它，
      //   不再发整池大查询 —— 从前这一行下面一律 loadSnapshot(primary, true, true)，
      //   于是「只补变的那几条」那条窄路等于白写。
      //   宿主明确说「没并进去」时（被推迟 / 被丢弃 / 失败）这一拍什么都不做：水印一个字节都没动，
      //   下一拍仍然会发现同一条变化；这时候去整池反而会把「谁欠着一次」这件事抹掉。
      if (res.mode === 'deferred' || res.mode === 'failed' || res.mode === 'stale-dropped') return;
      const group: any[] = [];
      // #653：分组按工作区键（wsKeyOf）——同一个仓库里，根会话与子目录会话算同一组，
      //   一次全量重建的结果扇出给组内所有会话，不再各拉各的。
      const normWanted: any = wsKeyOf(cwd);
      if (shared.cwd && wsKeyOf(shared.cwd) === normWanted) group.push(shared);
      Object.keys(stores).forEach(function (k: string): void {
        const st: any = stores[k];
        if (st.cwd && wsKeyOf(st.cwd) === normWanted) group.push(st);
      });
      if (!group.length) {
        // #232 R3 · 应用时刻该 cwd 已无任何 store 持有（用户已切走）：不再为无人观看的工作区
        // 发起 wf.refresh 全量重建（旧兜底 = 一次大查询，违反「非当前工作区不刷新」）。
        // 切回该工作区时由 StatusBar.apply 的加载链路补新鲜度，这里静默放行即可。
        return;
      }
      const primary: any = group[0];
      if (!primary.cwd) primary.cwd = cwd;
      const rest: any[] = group.slice(1);
      // 把一份快照落进本组：主 store 就地更新，同组其余会话按差异带闪烁标记。
      const applySnap = function (raw: any): boolean {
        const newSnap: any = raw || primary.snapshot;
        if (!newSnap || newSnap.ok !== true || !Array.isArray(newSnap.maps)) return false;
        primary.snapshot = newSnap;
        primary.snapMode = 'real';
        primary.snapError = null;
        rest.forEach(function (st2: any): void {
          st2.lastDiff = diffSnapshots(st2.snapshot, newSnap);
          st2.rowFlash = {};
          st2.issueFlash = {};
          var _df: any = st2.lastDiff;
          _df.added.forEach(function (n: any): void { st2.rowFlash[n] = 'added'; });
          _df.changed.forEach(function (n: any): void { st2.rowFlash[n] = 'changed'; });
          if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (ki: string): void { st2.issueFlash[Number(ki)] = _df.issueFlash[ki]; });
          st2.snapshot = newSnap;
          st2.snapMode = 'real';
          st2.snapError = null;
          scheduleFlashClear(st2);
          emit(st2);
        });
        try { emit(primary); } catch (eEmit) {}
        return true;
      };
      // ① 宿主已经补好行级增量：直接用，一条大查询都不发。
      if (res.mode === 'patch' && res.snapshot && applySnap(res.snapshot)) return;
      // ② 宿主说该整池（冷启动 / 票号增减 / 条数过多 / 旧结构），或者这一版宿主没给增量结果：
      //    走原来那条整池重建的路（行为与改动前一致）。
      return loadSnapshot(primary, true, true).then(function (): void {
        applySnap(primary.snapshot);
      }).catch(function (): void { /* 忽略 */ });
    }).catch(function (e: any): void { try { log('warn', 'host.call.fail', { method: 'wf.probe', kind: 'probe', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }); } catch (eL) {} });
  };
  // 按工作区键去重（#324 · 同工作区只探一次；#653：键走 wsKeyOf，同一工作区根下的多个子目录会话收成一次）
  const cwdsByNorm: Map<string, any> = new Map();
  const addCwd = function (cwd: any): void { try { const nk: any = wsKeyOf(cwd); if (!nk) return; if (!cwdsByNorm.has(nk)) cwdsByNorm.set(nk, cwd); } catch (e) { if (cwd && !Array.from(cwdsByNorm.values()).includes(cwd)) cwdsByNorm.set(String(cwd), cwd); } };
  if (shared.cwd) addCwd(shared.cwd);
  Object.keys(stores).forEach(function (k: string): void {
    const c: any = stores[k] && stores[k].cwd;
    if (c) addCwd(c);
  });
  const cwds: any[] = Array.from(cwdsByNorm.values());
  if (!cwds.length) {
    const sids: any[] = [];
    if (shared.sessionId) sids.push(shared.sessionId);
    Object.keys(stores).forEach(function (k: string): void { if (stores[k].sessionId && sids.indexOf(stores[k].sessionId) < 0) sids.push(stores[k].sessionId); });
    if (!sids.length) return;
    Promise.all(sids.map(function (sid: any): any { return host.call('wf.cwd', { sessionId: sid }).catch(function (): null { return null; }); })).then(function (results: any[]): void {
      const sidToCwd: Record<string, any> = {};
      const foundCwdsByNorm: Map<string, any> = new Map();
      for (let i: number = 0; i < sids.length; i++) {
        const r: any = results[i];
        if (r && r.ok && r.cwd) {
          sidToCwd[sids[i]] = r.cwd;
          try { const nk: any = keyOf(r.cwd); if (nk && !foundCwdsByNorm.has(nk)) foundCwdsByNorm.set(nk, r.cwd); } catch (e) { if (foundCwdsByNorm.size === 0 || !Array.from(foundCwdsByNorm.values()).includes(r.cwd)) foundCwdsByNorm.set(String(r.cwd), r.cwd); }
        }
      }
      const foundCwds: any[] = Array.from(foundCwdsByNorm.values());
      if (!foundCwds.length) return;
      Object.keys(stores).forEach(function (k: string): void {
        const st: any = stores[k];
        if (!st.cwd && st.sessionId && sidToCwd[st.sessionId]) {
          st.cwd = sidToCwd[st.sessionId];
          // #58 空 cwd 补齐后立即水合 per-cwd 缓存，秒开
          if (hydrateFromCache(st)) emit(st);
        }
      });
      if (!shared.cwd && foundCwds.length) {
        shared.cwd = foundCwds[0];
        if (hydrateFromCache(shared)) emit(shared);
      }
      foundCwds.forEach(function (cwd: any): void { refreshGroup(cwd); });
    });
    return;
  }
  cwds.forEach(function (cwd: any): void { refreshGroup(cwd); });
};
export const scheduleActionProbe = function (): void {
  if (_actionProbePending) return;
  _actionProbePending = true;
  if (timer === undefined) { _actionProbePending = false; return; }
  timer.timeout(function (): void {
    // #232 R3 · 发起时刻资格复检：排队期间页签已藏 → 跳过本次发起新扫描；
    // 已发出的在途请求不受影响（R4 由 loadSnapshot 分支保障），恢复通道见 startAutoProbe。
    try { if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') { _actionProbePending = false; return; } } catch (e232ag) {}
    _actionProbePending = false;
    probeNow(false);
  }, ((typeof SYNC === 'object' && SYNC && SYNC.ACTION_PROBE_WINDOW_MS) || 8000));
};
export const startAutoProbe = function (): void {
  if (shared._probeTimer) return;
  // v1.5 R2-fix：跨 reload 清理旧 timer（dev_reload_package 后 JS setInterval 不自动清理，
  //   多个 timer 并行触发 probe 浪费配额）
  if (typeof globalThis !== 'undefined' && (globalThis as any).__dswsOldProbeTimer) {
    try { clearInterval((globalThis as any).__dswsOldProbeTimer); } catch (e) { /* 忽略 */ }
    (globalThis as any).__dswsOldProbeTimer = null;
  }
  shared._probeTimer = setInterval(function (): void {
    // #232 R3 · 视线门控：页签隐藏（无人在看）时不发起新扫描 —— 非当前工作区零刷新流量。
    // 回到前台由 focus 探针（下方监听，FOCUS_PROBE_MIN_MS 限流）与轮询栅格自然续上（R2 恢复通道）。
    try { if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return; } catch (e232g) {}
    probeNow(false);
  }, PROBE_MS);
  if (typeof globalThis !== 'undefined') (globalThis as any).__dswsOldProbeTimer = shared._probeTimer;
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('focus', function (): void { probeNow(true); });
  // #232 · 同一聚焦窗口内切页签不触发 window focus —— 补挂 visibilitychange 作为第二恢复通道
  //   （hidden 期间积压的差值由首拍栅格上报 + 本监听双保险收敛；共用 FOCUS_PROBE_MIN_MS 限流）。
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function (): void {
      try { if (document.visibilityState === 'visible') probeNow(true); } catch (e232v) {}
    });
  }
};
// ── #707（T3 第二批）：只服务活跃工作区的那条探测节拍 ──────────────────────────────────
// 这条循环替掉「遍历所有工作区各发一次探测」那件事：只探**我这个会话正在看的那个工作区根**，
// 间隔由宿主说了算（正在看的 5 秒、刚离开的 15 秒，见 wf.focus 回话里的 probeIntervalMs）。
// 三件事凑齐才探：① 面板可见；② 宿主说我在活跃集合里（standing 为 'active'）；③ 距上一次探测
// 不满一个间隔就不重复探（同一条工作区根只探一次，#324 / #653 的口径不变）。
// 后台那些工作区一次都不探 —— 它们由宿主那一侧按视野模型安排，界面上一个定时器都不给它们。
export const _activeProbeAt: { at: number } = { at: 0 };
export const startActiveProbeLoop = function (): void {
  try {
    if (!_attentionPlan.intervalMs) return;
    if (shared._activeTimer) {
      // 间隔变了（比如从「正在看」掉到「刚离开」）：重排一次，别让旧节拍继续跑。
      try { clearInterval(shared._activeTimer); } catch (eClr) {}
      shared._activeTimer = null;
    }
    const step = function (): void {
      try {
        if (!attentionVisible()) return;
        if (_attentionPlan.standing !== 'active') return;
        const st: any = attentionStoreOf(null);
        const cwd: any = (st && st.cwd) || '';
        if (!cwd) return;
        const gap: number = _attentionPlan.intervalMs || PROBE_MS;
        if (_activeProbeAt.at && (Date.now() - _activeProbeAt.at) < gap) return;
        _activeProbeAt.at = Date.now();
        // #776 只加日志不改行为：记下这一次探测节拍的间隔与工作区（与输入时间戳对齐用）。
        //   按需级，先判开关；节拍 5 秒一拍低频，不采样。
        try { if (isEnabled('debug')) log('debug', 'input.observe', { kind: 'probe-tick', count: 1, latencyMs: Math.round(Number(gap) || 0), keyHash: dswsLogHash(String(cwd || '')) }); } catch (ePt) {}
        probeNow(false);
        // #891：初始化那一步还没过时，顺带重算一次链。注入 setupRun 是往会话里写字，写文件发生在链外，
        // 链的四种事件里没有这一路，黄条就按旧快照常驻。这里复用正在看才跑的这一拍，不新开定时器；
        // 是否真算由宿主按退避裁定，人手重查那一路永不降档不受影响。全绿或根本没这一行时 setupPendingOf 为假，不多算。
        try {
          if (typeof setupPendingOf === 'function' && setupPendingOf(st)) {
            if (typeof chainEventRefresh === 'function') chainEventRefresh(st, 'setup-pending').catch(function (): void {});
            else if (typeof loadChain === 'function') loadChain(st, false, 'setup-pending').catch(function (): void {});
          }
        } catch (eSetup) {}
      } catch (e) {}
    };
    if (timer === undefined || typeof timer.interval !== 'function') {
      // 宿主没给定时器出口（单测与无计时器环境）：不排节拍，什么都不做。
      return;
    }
    shared._activeTimer = timer.interval(step, _attentionPlan.intervalMs);
  } catch (e) {}
};
// #746：对话框里的焦点/可见性只装一次（无定时器，纯事件）。装上后：切回本对话框即顺带催一次
// 改名拉取（标题在自己对话框里一定可读；后台切页/藏起不催）。跨窗口各装各的，互不干扰。
export let _dialogSignalsOn: boolean = false;
export const installDialogSignals = function (): void {
  try {
    if (_dialogSignalsOn) return;
    _dialogSignalsOn = true;
    const kick = function (): void {
      try {
        if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return;
        if (typeof namingGuardianEvent === 'function') namingGuardianEvent('dialog-focus');
      } catch (eK) {}
    };
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('focus', kick);
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', function (): void { try { if (document.visibilityState === 'visible') kick(); } catch (eV) {} });
  } catch (e) {}
};
// v1.5 T10 R7（用户拍板）：手动刷新（状态栏「更新」/ 列表「刷新」/ 检查页「重新检查」）
//   走静默路径 —— 无全屏遮罩、不禁点；按钮 spinner 即时反馈（命令式 DOM 直操作，不等 React 重渲染）
//   CSS 动画走合成线程：即使主线程被重渲染占用，转圈照常可见
export const spinAll = function (on: any): void {
  if (typeof document === 'undefined') return;
  try {
    const els: any = document.querySelectorAll('[data-dsws-host] .dsws-rficon');
    for (let i: number = 0; i < els.length; i++) els[i].classList.toggle('dsws-spin', on);
  } catch (e) { /* 忽略 */ }
};
export const refreshAll = function (st: any): void {
  if (st.refreshing) { try { st.refreshing = false; spinAll(false); } catch {} }
  // #195 约束：refreshAll 永不因 refreshing 锁死（重查按钮必须有反应）
  st.refreshing = true;
  // #746：手动刷新顺带催一次改名拉取（三个刷新按钮同一入口全包；自动探测走别路，不误触发）
  try { if (typeof namingGuardianEvent === 'function') namingGuardianEvent('manual-refresh'); } catch (eNR) {}
  // 先发 RPC（异步即返回），再触发渲染 —— 避免重渲染挡住数据请求
  // #709（T5）：这是「重新检查」按钮的真身。人亲手点的这一次永不降档，所以带上 'user-recheck'：
  // 宿主看到它就照做，不看退避退到了第几档。
  var _p1Raw: any = (typeof chainEventRefresh === 'function' ? chainEventRefresh(st, 'user-recheck').catch(function (): void {}) : (typeof loadChain === 'function' ? loadChain(st, true, 'user-recheck').catch(function (): void {}) : Promise.resolve()));
  // #366 补充：链刷新兜底超时，避免宿主链探测卡住导致按钮一直转圈
  // 等一次自动探测结果的上限：等了这么久还没回来，就按「这一次没有结果」往下走，按钮不会一直转圈。
  // 数值写在 config/timeouts.yaml 的 probeAutoWaitMs，构建时由生成器变成常量、随界面闭包一起进来。
  var p1: any = new Promise(function (resolve: any): void { var _t: any = setTimeout(function (): void { try { resolve(null); } catch (e) {} }, PROBE_AUTO_WAIT_MS); _p1Raw.then(function (v: any): void { clearTimeout(_t); resolve(v); }).catch(function (): void { clearTimeout(_t); resolve(null); }); });
  var p2: any = loadSnapshot(st, true, true);
  var p3: any = Promise.resolve();
  spinAll(true);
  emit(st);
  Promise.all([p1, p2]).then(function (): void {
    // #366 修复：强制刷新后扇出到同工作区全组（对齐 probeNow→refreshGroup 的扇出契约）
    try {
      const newSnap: any = st.snapshot;
      if (newSnap && newSnap.ok === true && Array.isArray(newSnap.maps)) {
        // #653：扇出分组按工作区键（同一个仓库里的子目录会话与根会话算同一组）
        const normWanted: any = (typeof wsKeyOf === 'function' ? wsKeyOf(st.cwd || '') : String(st.cwd || ''));
        if (normWanted) {
          const group: any[] = [];
          try { if (shared && shared.cwd && wsKeyOf(shared.cwd) === normWanted && shared !== st) group.push(shared); } catch (e0) {}
          try { Object.keys(stores).forEach(function (k: string): void { const st2: any = stores[k]; if (st2 && st2.cwd && wsKeyOf(st2.cwd) === normWanted && st2 !== st) group.push(st2); }); } catch (e1) {}
          group.forEach(function (st2: any): void {
            try { st2.lastDiff = diffSnapshots(st2.snapshot, newSnap); } catch (eDiff) {}
            st2.rowFlash = {};
            st2.issueFlash = {};
            try {
              const _df: any = st2.lastDiff;
              if (_df) {
                _df.added.forEach(function (n: any): void { st2.rowFlash[n] = 'added'; });
                _df.changed.forEach(function (n: any): void { st2.rowFlash[n] = 'changed'; });
                if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (k: string): void { st2.issueFlash[Number(k)] = _df.issueFlash[k]; });
                if (_df.removed && _df.removed.length) try { flash(st2, tr('panel.diffRemoved', { n: _df.removed.length }), 'info'); } catch (eFlash) {}
              }
            } catch (e2) {}
            st2.snapshot = newSnap;
            st2.snapMode = 'real';
            st2.snapError = null;
            try { if (typeof applySnapshotSelection === 'function') applySnapshotSelection(st2, newSnap); } catch (eSel) {}
            try { scheduleFlashClear(st2); } catch (eSch) {}
            emit(st2);
          });
        }
      }
    } catch (eFan) {}
    // 链快照同工作区扇出（#366 补充：refreshAll 同时刷新 chain，保持状态栏与面板链一致）
    try {
      const newChainSnap: any = st.chainSnapshot;
      if (newChainSnap && typeof newChainSnap === 'object') {
        const normWanted2: any = (typeof wsKeyOf === 'function' ? wsKeyOf(st.cwd || '') : String(st.cwd || ''));
        if (normWanted2) {
          const group2: any[] = [];
          try { if (shared && shared.cwd && wsKeyOf(shared.cwd) === normWanted2 && shared !== st && shared.chainSnapshot !== newChainSnap) group2.push(shared); } catch (e0c) {}
          try { Object.keys(stores).forEach(function (k: string): void { const st2: any = stores[k]; if (st2 && st2.cwd && wsKeyOf(st2.cwd) === normWanted2 && st2 !== st && st2.chainSnapshot !== newChainSnap) group2.push(st2); }); } catch (e1c) {}
          group2.forEach(function (st2: any): void {
            try { st2.chainSnapshot = newChainSnap; if (newChainSnap.chain) st2.chain = newChainSnap.chain; if (newChainSnap.fullChain) st2.fullChain = newChainSnap.fullChain; if (newChainSnap.backendChain !== undefined) st2.backendChain = newChainSnap.backendChain; st2.chainLoadedAt = st.chainLoadedAt; emit(st2); } catch (eChain) {}
          });
        }
      }
    } catch (eFan2) {}
    st.refreshing = false;
    spinAll(false);
    // #596 留痕：手动刷新没拿到新快照时记一行（按需级——判断与调用同一行，性能守卫口径）。
    // 当时那条通道没注册，这里静默走过，界面上「点了没反应、日志里也查不到」，故障才拖了这么久。
    // 只记散列与归一类别，不记路径原文与错误全文（#489 白名单）。
    try {
      const okSnap: boolean = !!(st.snapshot && st.snapshot.ok === true && Array.isArray(st.snapshot.maps));
      if (!okSnap && isEnabled('debug')) log('debug', 'host.call.fail', { method: 'wf.refresh', kind: 'manual-refresh', errorHash: dswsLogHash(dswsLogTrunc(String(st.snapError || st.snapMode || 'no-snapshot'), 120, 'error')) });
    } catch (eL2) {}
    emit(st);
  }).catch(function (): void { st.refreshing = false; spinAll(false); emit(st); });
};
// #376：打开面板即保证新鲜 —— 未就绪/失败 → force 加载（有「加载中」反馈）；
//   已就绪但过期（>60s）→ 触发加载；已就绪且新鲜（≤60s）→ 直接展示不重复请求（配额友好）。
//   force 不被 snapLoading 守卫丢弃（#370 已修），加载中打开面板最终也会完成并展示。
// #1215：60 秒这一档正常路径取契约里的 SYNC.SNAP_FRESH_MS（config/ttl.yaml 的 syncSnapFreshMs），
//   SYNC 缺席时兜底取拼进本闭包的 SYNC_SNAP_FRESH_MS，这里不留第二份数字。
export const SNAP_FRESH_MS: number = ((typeof SYNC === 'object' && SYNC && SYNC.SNAP_FRESH_MS) || SYNC_SNAP_FRESH_MS);
export const snapFresh = function (st: any): boolean {
  if (!st.snapshot || !st.snapshot.generatedMs) return false;
  try { return (Date.now() - st.snapshot.generatedMs) <= SNAP_FRESH_MS; } catch (e) { return false; }
};
