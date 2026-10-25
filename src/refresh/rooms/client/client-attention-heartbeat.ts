/**
 * src/refresh/rooms/client/client-attention-heartbeat.ts — 内核模块（#707 第二阶段：视野模型 + 心跳 + 客户端节拍）
 *
 * 这个文件回答一个问题：「我在看哪个工作区」这件事，界面怎么可靠地说给宿主听。
 * 它只做四件事，一件都不多做（节拍、重试、配额判断都不在界面这一层，界面没有能力犯错）：
 * ① 给这个窗口造一个身份：平台不提供窗口身份与焦点信号，所以标识由客户端自己造，
 * 放 sessionStorage —— 不能放 localStorage（同源所有窗口共享，后写覆盖先写，
 * 几个窗口会互相冒充）。sessionStorage 的寿命正好是这个标签页的这一份会话。
 * ② 在会话切换、面板打开、窗口获焦时上报一次我在看谁（工作区根，不是会话目录）。
 * ③ 面板可见时每 20 秒一次本地心跳：零配额、不出网，只上报界面还在看这个工作区。
 * ④ 把宿主回话里的探测间隔与处境交给同一闭包的探测循环，界面自己不做判断。
 *
 * 心跳间隔来自契约层 SYNC.ATTENTION_HEARTBEAT_MS（与预算同一个数同源，
 * 客户端半边不 import 核心产物）。静默阈值住中央 config/ttl.yaml 的 attentionExpiryMs。
 * 本文件为模块真源，同名 .js 是构建产物，构建侧去掉行首 export 后拼回闭包。
 *
 * 反例：不要把窗口身份放 localStorage；不要在心跳里顺手做探测判断；
 * 中央时间参数走顶部单行真引用（构建剥离后由闭包另一片提供，单行是硬要求），
 * 其余跨闭包名字一律 declare，不要加 export default。
 */
    import { ATTENTION_EXPIRY_MS, ATTENTION_HEARTBEAT_MS } from '../../../shared/time-config/values.js'
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）。
declare const host: any;
declare const stores: any;
declare const shared: any;
declare const wsKeyOf: any;
declare const dswsLogHash: any;
declare const dswsLogTrunc: any;
declare const isEnabled: any;
declare const log: any;
declare const getCachedSnapshot: any;
declare const startActiveProbeLoop: any;
declare const sessionStorage: any;
declare const document: any;
declare const window: any;
declare const timer: any;
declare const SYNC: any;
declare const PROBE_MS: number;
/** 这个窗口的身份：sessionStorage 里现造一个，造不出来就退回内存里那一个（绝不退回空串）。 */
export let _attentionWindowId: string = '';
export const attentionWindowId = function (): string {
  if (_attentionWindowId) return _attentionWindowId;
  try {
    const k: string = 'dsws.windowId';
    const got: any = (typeof sessionStorage !== 'undefined' && sessionStorage) ? sessionStorage.getItem(k) : '';
    if (got) { _attentionWindowId = String(got); return _attentionWindowId; }
    // 造一个够短的随机标识：时间戳 + 随机片段。它不是密钥，只是「这个窗口和那个窗口不一样」。
    const made: string = 'w' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
    try { if (typeof sessionStorage !== 'undefined' && sessionStorage) sessionStorage.setItem(k, made); } catch (eSet) {}
    _attentionWindowId = made;
  } catch (e) {
    // sessionStorage 整个不可用（隐私模式、被策略挡掉）：退回内存里的那一个，本窗口内仍然稳定。
    _attentionWindowId = 'w' + Date.now().toString(36) + '-mem';
  }
  return _attentionWindowId;
};
/** 面板此刻可不可见（页签藏起来时 document.visibilityState 会说 hidden）。 */
export const attentionVisible = function (): boolean {
  try { return !(typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible'); } catch (e) { return true; }
};
/** 最近一次人类输入是什么时候（点击 / 按键 / 滚轮 / 触摸）。心跳只证明「还看着」，这一条才是「真有人在用」。 */
export let _attentionHumanAt: number = 0;
export const attentionNoteHuman = function (): void { try { _attentionHumanAt = Date.now(); } catch (e) {} };
/** 这个工作区根对应的那个会话状态（面板正在看的那个；shared 优先，其次任意一个非空 cwd 的 store）。 */
export const attentionStoreOf = function (st: any): any {
  if (st && st.cwd) return st;
  try { if (shared && shared.cwd) return shared; } catch (e0) {}
  try {
    const keys: string[] = Object.keys(stores);
    for (let i: number = 0; i < keys.length; i++) { const one: any = stores[keys[i]]; if (one && one.cwd) return one; }
  } catch (e1) {}
  return st || null;
};
/** 这个会话现在在看哪个工作区根：优先用宿主已经答过的那个值（wf.cwd 顺路带回，零额外请求）。 */
export const attentionRootOf = function (st: any): string {
  const one: any = attentionStoreOf(st);
  if (!one) return '';
  try {
    const known: string = String(one.sessionWorkspaceRoot || '').trim();
    if (known) return known;
    const cached: any = (typeof getCachedSnapshot === 'function') ? getCachedSnapshot(one.cwd || '') : null;
    if (cached && cached.workspaceRoot) return String(cached.workspaceRoot);
    if (one.snapshot && one.snapshot.workspaceRoot) return String(one.snapshot.workspaceRoot);
    // 拿不到权威的工作区根就报所选目录本身：宿主那一侧会照同一把尺子再锚一次根，
    // 所以这里报粗一点也不会算成两个工作区。
    return String(one.cwd || '');
  } catch (e) { return ''; }
};
/** #707：宿主对同一条目录的两种写法算两个工作区就白省了额度，所以上报前先按工作区键洗一次。 */
export const attentionKeyOf = function (cwd: any): string {
  try { return (typeof wsKeyOf === 'function') ? wsKeyOf(String(cwd || '')) : String(cwd || '').toLowerCase(); } catch (e) { return String(cwd || ''); }
};
/** 位置态：这个工作区根现在按什么间隔探测、我在不在活跃集合里、上限几个（宿主只说事实，界面不自己判）。 */
export const _attentionPlan: { root: string; intervalMs: number; lingerMs: number; standing: string; limit: number; atMs: number } = { root: '', intervalMs: 0, lingerMs: 0, standing: '', limit: 0, atMs: 0 };
/** 上一次心跳是什么时候（同一窗口内只用来判「该不该再报一次」，不做节流决策）。 */
export let _attentionLastBeatAt: number = 0;
/** #776 观测计数：面板打开过几次（只加日志不改行为，不做单例守卫，只计数）。 */
export let _signalInstallN: number = 0;
/** 最近一次「宿主真的收下了我的上报」是什么时候（毫秒时刻）。它断流就是断流，界面不许把故障装成安静。 */
export let _attentionAckAt: number = 0;
/** #707：90 秒内没有任何回话 → 自动刷新已被宿主停掉，界面要直说「自动刷新已暂停」。 */
export const ATTENTION_SILENT_MS: number = ATTENTION_EXPIRY_MS;
export const attentionSuspended = function (): boolean {
  try {
    if (!_attentionAckAt) return false;
    return (Date.now() - _attentionAckAt) > ATTENTION_SILENT_MS;
  } catch (e) { return false; }
};
/**
 * 上报一次「我在看谁」。kind 见 attention.ts 的取值表：focus / panel-open /
 * session-switch / heartbeat / window-blur / panel-hidden。
 * 三件事同时发生：① 立刻把旧快照铺满（同步，≤100 毫秒，见缓存优先）；
 * ② 这一条跨边界调用按日志纪律记一行；③ 回话里的间隔交给探测循环。
 */
export const reportWorkspaceAttention = function (st: any, kind: any, syncFirst: any): any {
  try {
    const one: any = attentionStoreOf(st);
    if (typeof syncFirst === 'function') syncFirst();
    if (typeof host === 'undefined' || typeof host.call !== 'function') return Promise.resolve(null);
    const root: string = attentionRootOf(one);
    if (!root) return Promise.resolve(null);
    const args: any = {
      windowId: attentionWindowId(),
      workspaceRoot: root,
      kind: kind || 'focus',
      visible: attentionVisible(),
      lastHumanInputMs: _attentionHumanAt || 0,
    };
    const t0: number = Date.now();
    // #776 只加日志不改行为：每次上报记一笔发送（与既有 host.call 配对，数获焦发了几遍）。
    // 按需级，先判开关；上报本身低频（打开/切换/获焦），不采样。
    try { if (isEnabled('debug')) log('debug', 'input.observe', { kind: 'focus-send', count: 1, latencyMs: 0 }); } catch (eSnd) {}
    const p: any = host.call('wf.focus', args);
    return p.then(function (res: any): any {
      try {
        const okRes: boolean = !!(res && res.ok);
        if (okRes) log('info', 'host.call', { method: 'wf.focus', latencyMs: Date.now() - t0, ok: true, kind: String(kind || 'focus') });
        else log('warn', 'host.call.fail', { method: 'wf.focus', kind: String(kind || 'focus'), errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error) || 'focus-not-ok'), 120, 'error')) });
      } catch (eL) {}
      try { if (res && res.ok) adoptAttentionPlan(res, root); } catch (ePlan) {}
      return res;
    }).catch(function (e: any): any {
      try { log('warn', 'host.call.fail', { method: 'wf.focus', kind: String(kind || 'focus'), errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }); } catch (eL) {}
      return null;
    });
  } catch (e) { return Promise.resolve(null); }
};
/** 收下宿主的回话：这个根按多少毫秒探一次、我在不在活跃集合里。界面据此起停那条本地探测。 */
export const adoptAttentionPlan = function (res: any, root: any): any {
  _attentionPlan.root = String((res && res.root) || root || '');
  _attentionPlan.standing = String((res && res.standing) || '');
  _attentionPlan.limit = (res && typeof res.limit === 'number') ? res.limit : 0;
  _attentionPlan.atMs = Date.now();
  // 只有真收下过回话才记这一笔：断流时这个时刻会停在原地，界面据此说「自动刷新已暂停」。
  if (res && res.ok) _attentionAckAt = Date.now();
  const interval: number = (res && typeof res.probeIntervalMs === 'number') ? res.probeIntervalMs : 0;
  const linger: number = (res && typeof res.probeIntervalLingerMs === 'number') ? res.probeIntervalLingerMs : 0;
  _attentionPlan.intervalMs = interval > 0 ? interval : 0;
  _attentionPlan.lingerMs = linger > 0 ? linger : 0;
  try { if (typeof startActiveProbeLoop === 'function') startActiveProbeLoop(); } catch (eLoop) {}
  return _attentionPlan;
};
/** 界面要说的那句话：这个工作区根现在在不在被刷新的那一档（不在 →「未在刷新（同时活跃上限 2）」）。 */
export const attentionStandingOf = function (cwd: any): string {
  try {
    const key: string = attentionKeyOf(cwd);
    if (!_attentionPlan.root || !key) return '';
    if (attentionKeyOf(_attentionPlan.root) !== key) return '';
    return _attentionPlan.standing || '';
  } catch (e) { return ''; }
};
/**
 * 20 秒一次的本地心跳。零配额、不出网那一半说的是「它不引发任何探测」：它只上报事实。
 * 三条门在源头上就把它掐掉 —— 面板不可见、窗口不在前台、最近一分钟没有任何人类输入（人走开了的窗口
 * 不该靠心跳一直霸着活跃名额）。三条任何一条不成立，连 host.call 都不发。
 */
export const attentionBeat = function (): void {
  try {
    if (!attentionVisible()) return;
    try { if (typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus()) return; } catch (eF) {}
    if (!_attentionHumanAt || (Date.now() - _attentionHumanAt) > 60000) return;
    _attentionLastBeatAt = Date.now();
    reportWorkspaceAttention(null, 'heartbeat', null);
  } catch (e) {}
};
/** 心跳定时器（只起一个；跨 reload 时清掉旧的，与 #232 那条探测定时器同一个防重复做法）。 */
export const startAttentionHeartbeat = function (): void {
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__dswsOldBeatTimer) {
      // #1220：宿主交回的句柄是一支可调用的撤销器函数，全局 clearInterval 对它空操作（撤不掉也不报错）。
      //   先走 timer.clearTimeout（它按 dispose → 调用句柄本身 → 全局 clearTimeout 三档处理），再退回全局 clearInterval。
      try {
        const oldTimer: any = (globalThis as any).__dswsOldBeatTimer
        if (timer && typeof timer.clearTimeout === 'function') timer.clearTimeout(oldTimer)
        else clearInterval(oldTimer)
      } catch (eOld) {}
      (globalThis as any).__dswsOldBeatTimer = null;
    }
    if (shared._beatTimer) return;
    if (timer === undefined || typeof timer.interval !== 'function') return;
    shared._beatTimer = timer.interval(function (): void { attentionBeat(); }, ((typeof SYNC === 'object' && SYNC && SYNC.ATTENTION_HEARTBEAT_MS) || ATTENTION_HEARTBEAT_MS));
    if (typeof globalThis !== 'undefined') (globalThis as any).__dswsOldBeatTimer = shared._beatTimer;
  } catch (e) {}
};
/** 装监听：窗口获焦、页签可见性变化、人类输入三样。幂等（只装一次）。 */
export const startAttentionSignals = function (): void {
  try {
    // #776 只加日志不改行为：记下这是第几次打开面板（计数只增不减）。
    // 按需级，先判开关再组装字段；低频（每次打开面板一次），不采样。
    try { _signalInstallN += 1; if (isEnabled('debug')) log('debug', 'input.observe', { kind: 'signal-install', count: _signalInstallN, latencyMs: 0 }); } catch (eCnt) {}
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function (): void {
        try { if (attentionVisible()) reportWorkspaceAttention(null, 'focus', null); } catch (eV) {}
      });
      // 有人动过：记下时刻。心跳只证明「还看着」，这一条才是「真有人在用」（被动回前台不算）。
      const human = function (): void { attentionNoteHuman(); };
      document.addEventListener('pointerdown', human, true);
      document.addEventListener('keydown', human, true);
      document.addEventListener('wheel', human, true);
      document.addEventListener('touchstart', human, true);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('focus', function (): void { try { reportWorkspaceAttention(null, 'focus', null); } catch (eW) {} });
      window.addEventListener('blur', function (): void { try { reportWorkspaceAttention(null, 'window-blur', null); } catch (eB) {} });
    }
  } catch (e) {}
  startAttentionHeartbeat();
};
/** 页面要关掉/销毁时最后报一次「我不再活跃了」（能发出去就发，发不出去也不留尾巴）。 */
export const stopAttentionSignals = function (): void {
  try { reportWorkspaceAttention(null, 'panel-hidden', null); } catch (e) {}
  // #1220：同 startAttentionHeartbeat 里的撤销口径——宿主句柄是撤销器，得走 timer.clearTimeout。
  try {
    if (shared._beatTimer) {
      if (timer && typeof timer.clearTimeout === 'function') timer.clearTimeout(shared._beatTimer)
      else if (typeof clearInterval === 'function') clearInterval(shared._beatTimer)
    }
  } catch (e2) {}
  try { shared._beatTimer = null; } catch (e3) {}
};

// ── #1418 P1：探测范围与降档 ─────────────────────────────────────────────────────────────
// 为什么要住在这一片：探测范围本来就是「人正在看哪个工作区」的推论，视野模型（_attentionPlan.root、
//   shared/stores 的 cwd）都在这里；放回 refresh-timer 会把那份文件顶过每文件 350 有效行的上限。
// 两条规矩（对应票面「只探面板可见仓库」「连续无变化退避」）：
//   ① probeTargetNow：只回一个工作区目录（宿主按目录认仓库），后台节拍按降档间隔跳过时回空串；
//   ② noteProbeReply：探成且没变化才加一级退避，有变化 / 变了没并进去 / 人回到前台都清零。
// 反例：不要拿「某个会话的 cwd 不在 _attentionPlan.root 下」当理由去探第二个工作区 —— 那就是 3 工作区
//   每拍 3 条探测、一小时烧掉两千多点 GraphQL、把 deck 工具整轮停掉的那条路（#1418 实测）。
export const _probeBackoff: { step: number; lastAt: number; lastCwd: string } = { step: 0, lastAt: 0, lastCwd: '' };
const BACKOFF_FACTORS: number[] = [1, 1, 2, 5, 10];
export const backoffGap = function (): number {
  const i: number = Math.min(Number(_probeBackoff.step) || 0, BACKOFF_FACTORS.length - 1);
  return Math.max(1, Number(PROBE_MS) || 0) * BACKOFF_FACTORS[i];
};
const logProbeBackoff = function (): void {
  try { log('info', 'probe.loop', { reason: 'backoff', intervalMs: Math.round(backoffGap()), visible: attentionVisible(), timerOk: !!(timer && typeof timer.interval === 'function') }); } catch (eLog) {}
};
export const resetProbeBackoff = function (): void {
  if (_probeBackoff.step === 0) return;
  _probeBackoff.step = 0;
  logProbeBackoff();
};
/**
 * 这一拍该探哪个工作区。三种回话必须分开（漏了就会把「降档跳过」当成「还没有目录」去冷启动）：
 *   null —— 后台节拍还在降档间隔里，这一拍整个跳过（连 wf.cwd 都不问）；
 *   ''   —— 真的还没有可分组的目录（store 还没水合），调用方去补 cwd 再问一次；
 *   目录 —— 这一拍就探它。
 */
export const probeTargetNow = function (background: boolean): any {
  if (!background) resetProbeBackoff();
  const root: string = String(_attentionPlan.root || '');
  const all: string[] = [];
  if (shared && shared.cwd) all.push(String(shared.cwd));
  try { Object.keys(stores || {}).forEach(function (k: string): void { const c: any = stores[k] && stores[k].cwd; if (c) all.push(String(c)); }); } catch (eStores) {}
  let target: string = root || all[0] || '';
  if (root) { for (let i: number = 0; i < all.length; i++) { try { if (all[i] === root || wsKeyOf(all[i]) === wsKeyOf(root)) { target = all[i]; break; } } catch (eSame) {} } }
  if (!target) return '';
  if (_probeBackoff.lastCwd && _probeBackoff.lastCwd !== target) resetProbeBackoff();
  _probeBackoff.lastCwd = target;
  if (background && _probeBackoff.lastAt && (Date.now() - _probeBackoff.lastAt) < backoffGap()) return null;
  _probeBackoff.lastAt = Date.now();
  return target;
};
/** 记一拍探测的结局：探成且没变化加一级；有变化 / 变了没并进去 / 前台拍都清零。 */
export const noteProbeReply = function (res: any, background: boolean): void {
  if (!background) { resetProbeBackoff(); return; }
  if (!res || res.ok !== true) return;
  if (res.changed === true || res.mode === 'deferred' || res.mode === 'failed' || res.mode === 'stale-dropped') { resetProbeBackoff(); return; }
  if (_probeBackoff.step < BACKOFF_FACTORS.length - 1) { _probeBackoff.step += 1; logProbeBackoff(); }
};
