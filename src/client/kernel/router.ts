/**
 * src/client/kernel/router.ts — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源；构建时去掉行首 export 后拼回 src/client/index.ts，
 * 源码树里只有这一份真源。源码树里只有这一份真源，改这里就够。
 * 接口冻结清单见 kernel-contract.md，导出名与形状一字不差。
 *
 * 面板只有一条路：本插件在原生右侧边栏的类型登记表里注册一个类型，
 * 右栏里那一格由我们渲染。拿不到原生控制器就不算打开，记一行日志
 * 并给用户一句可见提示，不再悄悄退回别的形态（页内浮窗已退役）。
 * 打开计时的起点与各段都归 panelClock 一个对象管，用完即清，不挂在
 * 会话状态上，也不上全局，避免污染与残留。
 *
 * 反例：不要在这里加运行时 import；不要把空壳画成透亮的空块，
 * 空壳与面板根节点共用同一档底色，从第一帧起就是面板已经在。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）。
declare const isEnabled: any;
declare const log: any;
declare const ctx: any;
declare const h: any;
declare const React: any;
declare const DetailsDock: any;
declare const tr: any;
declare const flash: any;
declare const emit: any;
declare const getCwdSync: any;
declare const hydrateFromCache: any;
declare const getCachedSnapshot: any;
declare const snapFresh: any;
declare const loadSnapshot: any;
declare const startAttentionSignals: any;
declare const keyOf: any;
declare const getSnapshotVersion: any;
declare const issueUrlFor: any;
declare const repoUrlFor: any;
declare const effortOf: any;
declare const idOf: any;
declare const renderTemplate: any;
declare const promptText: any;
declare const promptTextFor: any;
declare const promptLang: any;
declare const newWayfinderPrompt: any;
declare const newSpecPrompt: any;
declare const NEW_BUG_FIELDS_BODY_EN: any;
declare const NEW_BUG_FIELDS_BODY: any;
declare const inspectPrompt: any;
declare const completePrompt: any;
declare const dswsLogHash: any;
// #606 面板打开各阶段计时的唯一状态。一次点开面板的调用链上只写读这几个数：
//   openPanel 记下点击那一刻；Dock 记下进入渲染那一刻与提交完成；
//   列表把提交阶段里做折叠测量花掉的毫秒累加进来；DockSync 在副作用里把各段落成日志。
// 刻意不挂在会话状态对象上（那会被当成业务状态、参与相等比较与持久化），也不挂到全局上
// （那会污染全局并在会话之间残留）。构建时这几个文件拼进同一个闭包，共享这个对象不需要任何导入。
export const panelClock: { t0: number; renderT0: number; commitMs: number; fitMs: number } = { t0: 0, renderT0: 0, commitMs: -1, fitMs: 0 };
// 计时用的时钟：优先高精度性能计时，没有就用墙上时间。四处共用同一个函数，免得两段相减跨了两种时钟。
export const panelNow = function (): number {
  try { if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now(); } catch (e) {}
  return Date.now();
};
// 打开面板各阶段写一行日志（按需级）：只在调试开关打开时才组装字段，关着时连字段对象都不建。
//   为什么毫秒放在 ms 字段、而不是编进 stage 取值：日志的 ts 是宿主收到批次那一刻盖的章，
//   同一批内所有行共享同一毫秒、批内先后顺序不可信；可信的是每行自带的毫秒数，所以耗时必须有正规字段装。
export const logPanelStage = function (stage: any, ms: any): void {
  try { if (isEnabled('debug')) log('debug', 'panel.render', { stage: String(stage || ''), ms: Math.round(Number(ms) || 0) }); } catch (e) {}
};
// 面板只有一条路：本插件自己在原生右侧边栏的类型登记表里注册一个类型，右栏里那一格由我们渲染。
//   拿不到原生控制器就不算打开 —— 记一行日志并给用户一句可见提示，不再悄悄退回别的形态（页内浮窗已退役）。
//   这里两个标识必须成对：kind 是打开请求上带的类型名，id 是类型在登记表里的身份，右栏按 id 找内容体与标题。
export const DECK_NATIVE_TAB_KIND: string = 'dsh-mattpocock-skills-deck:deck-map';
export const DECK_NATIVE_TYPE_ID: string = 'dsh-mattpocock-skills-deck/deck:map';
// 右侧边栏里那张标签的内容体（面板本体）。
//   先出空壳、下一帧再挂内容（#603）：打开是在点击处理器里同步跑完的，一次把整棵树建完会让浏览器
//   在处理器返回前画不出第一帧 —— 用户看到的就是点了半天面板不出来。
// 空壳自己必须是面板本人，不能是一块透亮的空块。挂载这一路上有两个时刻会画空壳，
// 空壳没有背景的话，那几帧里这一格显示的是底下透出来的东西，紧接着才被面板整块盖住。
// 所以空壳与面板根节点共用同一档底色：从第一帧起就是面板已经在、内容还没到。
// 注意这里改的是第一帧画什么，那两跳是为了不让点击白等，不要顺手删。
export const DeckSidebarTab = function (props: any): any {
  // 会话号由原生右栏就近给：注册内容体槽位时写了 inject(sessionId)，宿主在渲染这一格时把它交进来。
  const sessionId: any = (props && props.sessionId) || undefined;
  const [ready, setReady] = React.useState(false);
  React.useEffect(function (): any {
    if (ready) return;
    // 两跳：第一跳让本次渲染提交、浏览器有机会画外壳；第二跳才挂内容。
    const raf: any = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function (fn: any): any { return setTimeout(fn, 0); };
    let id2: any = null;
    const id1: any = raf(function (): void { id2 = raf(function (): void { setReady(true); }); });
    return function (): void { try { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id1); } catch (eC1) {} try { if (id2 !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id2); } catch (eC2) {} };
  }, [ready]);
  if (!ready) return h('div', { className: 'dsws-hold' });
  return h('div', { className: 'dsws-hold' }, h(DetailsDock, { sessionId: sessionId }));
};
// 右栏标签条上那枚标题：内容就是面板名。
export const DeckNativeTabTitle = function (): any { return h('span', null, tr('panel.title')); };
// 打开面板的收尾：把这次打开记成面板已开，并按 #58 的规矩缓存优先（已水合就直接展示，否则后台拉）。
export const afterPanelOpened = function (st: any): void {
  // 面板打开就是我开始看这个工作区了的一个信号源，所以在这里装监听与心跳（幂等，只装一次）。
  try { if (typeof startAttentionSignals === 'function') startAttentionSignals(); } catch (eSig) {}
  if (!st.cwd) {
    const sync: any = getCwdSync(st.sessionId);
    if (sync) { st.cwd = sync; hydrateFromCache(st); }
  } else { hydrateFromCache(st); }
  st.open = true;
  const hasCache: boolean = !!(st.snapshot || getCachedSnapshot(st.cwd));
  const isReal: boolean = st.snapMode === 'real' || !!st.snapshot || !!getCachedSnapshot(st.cwd);
  if (isReal && snapFresh(st)) {
    if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real'; }
    emit(st);
  } else if (isReal || hasCache) {
    if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real'; }
    emit(st);
    loadSnapshot(st, false);
  } else {
    st.snapMode = 'loading';
    emit(st);
    loadSnapshot(st, false);
  }
};
// 打开面板：把面板交进原生右侧边栏，类型见上方 DECK_NATIVE_TAB_KIND。
//   拿不到原生控制器就返回 false，由调用处决定下一步 —— 不再悄悄退回别的形态。
export const openInNativeRight = function (st: any): boolean {
  const api: any = ctx.get('sidebarRight');
  if (!(api && typeof api.openTab === 'function')) return false;
  try {
    if (isEnabled('debug')) logPanelStage('native-open', panelNow() - panelClock.t0);
    if (st.sessionId && typeof api.openTabIn === 'function') api.openTabIn(st.sessionId, DECK_NATIVE_TAB_KIND, { revealIfOpened: true });
    else api.openTab(DECK_NATIVE_TAB_KIND, { revealIfOpened: true });
    if (isEnabled('debug')) logPanelStage('native-opened', panelNow() - panelClock.t0);
  } catch (e) { return false; }
  afterPanelOpened(st);
  return true;
};
export const openPanel = function (st: any): void {
  // 面板只有一条路：本插件注册的类型，开进原生右侧边栏，右栏里那一格由我们渲染。
  // 原来这里还有一个二选一（把面板交给第三方插件打开）。两条路并存时，那个插件会把面板
  // 画进同一列，于是原生右栏的引导页里出现两枚同名入口，所以那条路连同它的注册整段删除。
  try { const _keyHash: any = dswsLogHash((typeof keyOf === 'function' ? keyOf(st.cwd || '') : String(st.cwd || ''))); const _snapVer: any = (typeof getSnapshotVersion === 'function' ? getSnapshotVersion(st.cwd) : '') || (st.snapshot && st.snapshot.version) || ''; const _bid: string = String((st.selection && st.selection.backendId) || ''); log('info', 'panel.open', { hasCache: !!(st.snapshot || (typeof getCachedSnapshot === 'function' && getCachedSnapshot(st.cwd))), snapFresh: (typeof snapFresh === 'function' ? snapFresh(st) : false), keyHash: _keyHash, snapVersion: _snapVer, backendId: _bid }); } catch (eL) {}
  // 常规测点起点：记下点开面板这一刻，供后面各段算出各自耗时。用完即清；不挂在会话状态对象上，也不挂到全局上。
  // 调试开关关着时这一整段跳过：连时钟都不读，后面各段也就没有起点可算，唯一代价是读一次开关。
  if (isEnabled('debug')) {
    panelClock.t0 = panelNow();
    panelClock.renderT0 = 0;
    panelClock.commitMs = -1;
    panelClock.fitMs = 0;
  }
  if (openInNativeRight(st)) return;
  logPanelStage('entry-unavailable', panelNow() - panelClock.t0);
  try { flash(st, tr('panel.openUnavailable'), 'warn'); } catch (e) {}
};
export const togglePanel = function (st: any): void {
  if (st.open) { st.open = false; emit(st); return; }
  openPanel(st);
};
// #227 迁移：repoStr 改由后端 describe 供给（repository.refId 优先，兼容旧 repo），通用占位不再硬编码
export const repoStr = (st: any): string => {
  const repo: any = st.snapshot && (st.snapshot.repository || st.snapshot.repo);
  if (repo && typeof repo.refId === 'string' && repo.refId) return repo.refId;
  if (repo && repo.owner && repo.name) return repo.owner + '/' + repo.name;
  if (st.snapshot && st.snapshot.repo) return st.snapshot.repo.owner + '/' + st.snapshot.repo.name;
  return 'owner/repo';
};
// v21：开始 prompt 精简 —— /wayfinder + URL + 统一引导句（技能内部细节自带，不再重复灌输）
// v25 · T2b：execute 走模板渲染（templates.execute 或默认）
// #1012 定案第 10 条：这里原来还有一道前缀开关，它随旧配置存档一起删除；在删之前它就已经恒为开。
export const withWayfinderPrefix = function (body: any): any {
  if (/^\/wayfinder\b/.test(String(body || '').trim())) return body;
  return '/wayfinder\n' + body;
};
export const startText = (st: any, t: any): string => {
  const url: string = issueUrlFor(st, t.number, effortOf(t)); // #231 清尾：链接一律后端声明模板；无元数据即空
  // v1.4（T2 #443）：map 用推进式 prompt（加载技能→分析map→挑下一个issue→执行）；普通 issue 用 execute 模板
  const isMap: boolean = (t.labels || []).some(function (l: any): boolean { return (typeof l === 'string') ? l === 'wayfinder:map' : l.name === 'wayfinder:map'; });
  // v1.5 B2 修订：新会话/执行 prompt 跟随行状态 —— map 完成态 → 完成确认 prompt；未完成 → 推进式；统一带 map 标识
  if (isMap) {
    const stats: any = t.stats || (function (): any {
      const mo: any = ((st.snapshot && st.snapshot.maps) || []).find(function (m: any): boolean { return idOf(m) === idOf(t); }) || ((st.snapshot && st.snapshot.maps) || []).find(function (m: any): boolean { return m.number === t.number; });
      return mo ? mo.stats : null;
    })();
    const empty: boolean = !!(stats && stats.total === 0);
    if (empty) {
      try { return inspectPrompt(st, t.number, t.title); } catch (e) { return '/wayfinder ' + url + '\n\n' + promptTextFor(st, 'mapInspect', { n: String(t.number || ''), title: (t.title || ''), url: url }); }
    }
    const done: boolean = !!(stats && stats.total > 0 && stats.closed === stats.total);
    if (done) {
      // #77 定版：mapHead 自包含化 —— 标识头已内联 complete v5，head 外挂删除
      return completePrompt(st, t.number, t.title, stats.total, stats.closed);
    }
    // v1.5：技能 + 链接前置（具体操作 prompt 开头 = /wayfinder + ISSUE 链接，单行空格分隔）
    return '/wayfinder ' + url + '\n\n' + promptTextFor(st, 'mapExecute', { n: String(t.number || ''), title: (t.title || ''), url: url });
  }
  const body: string = renderTemplate('execute', { number: String(t.number), url: url, title: t.title }, st);
  return withWayfinderPrefix(body);
};
// 契约 #205 会话标题与占位判定已迁至命名守护共享核心（#265 · 单一真源；构建时经 splice 拼入本闭包）。
// 本文件不再声明任何命名真源，均以上述共享核心为准。
// v1.5 T6：新增 wayfinder prompt —— /wayfinder + 仓库信息 + 需求引导
// 注意那个空行：提示词与需求描述之间隔着两个换行（'\n\n'），转写时曾漏成一个、对抗审查抓回来了，别顺手「整理」掉。
export const newWayfinderText = (st: any): string => newWayfinderPrompt(st) + (promptLang() === 'en' ? '\n\nRequirement: ' : '\n\n需求描述：');
// issue #4：新增 BUG 单 —— 与「+ 新建需求」同构（新会话 + 预填 /wayfinder prompt）
export const newBugWayfinderText = (st: any): string => promptText('newBugWayfinder', { repo: repoUrlFor(st) }) + (promptLang() === 'en' ? NEW_BUG_FIELDS_BODY_EN() : NEW_BUG_FIELDS_BODY());
// #1281：「写规格」蓝入口 —— 与「+ 新建需求」同构（新会话 + 预填 /grill-with-docs prompt）。
//   面板与状态栏两处都调这一个函数，开场白因此逐字一致（#1280 验收口径）。
export const newSpecText = (st: any): string => newSpecPrompt(st) + (promptLang() === 'en' ? '\n\nRequirement: ' : '\n\n需求描述：');
