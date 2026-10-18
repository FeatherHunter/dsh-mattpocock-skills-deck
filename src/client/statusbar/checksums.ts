/**
 * statusbar/checksums.ts — 状态栏计数/徽标计算（5.2；v14 数字区等宽 + 依赖链检测）
 * G4 严格一文件：从 StatusBar.js 拆出的独立文件（#97 T4）。
 * 消费：StatusBar 内 const csx = checksumsOf(s)（cl 解构后各引用不变）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 * #284：全部读数改从链快照派生（九格目录视图退役）；pending 不计入分子分母。
 * #663：原先在这里算的那几个「今天该出哪条横幅」的读数（gh cli / 登录 / 初始化 / 技能那四个布尔）
 *   一并删了 —— 横幅改由 statusbar/bannerChain.ts 按引导链清单（src/shared/tracker/guide-steps.ts）
 *   逐步判，顺序只有那一份真源。本文件只剩胶囊上那几个计数与时间戳。
  * （#1251：本文件由同名 .js 转成 .ts，只补类型标注（形参一律 any）与环境声明，运行时行为一字不动。约束：不许加运行时 import（跨文件名字一律 ambient declare，构建拼闭包时拒收残留 import）；不许 export default；只写可剥离类型。）
 */
/**
 * 闭包环境声明（#1251 转 TS 时补的）：下面这些名字在源码树里没有定义，
 * 它们是别的叶子拼进同一个浏览器闭包时带进来的；类型检查靠这里声明形状。
 * 构建转译时会把 declare 整段抹掉，所以运行时一字不差。
 * 约束：以后新增跨文件引用只许在这里加 declare，不要加运行时 import
 * （构建侧 toSpliceableFragment 会拒收残留的 import，整个片段拼不进去）；
 * 也不要写 export default（构建侧 inlineExportDeclarations 不收 as 改名）。
 */
// 读数口径：开/关/各状态票数与探测时刻，由读数叶子提供。
declare function bugCount(...args: any[]): any;
declare function deckCountsOf(...args: any[]): any;
declare function frontierCount(...args: any[]): any;
declare function getProbeAt(...args: any[]): any;
declare function occCount(...args: any[]): any;
declare function readyCount(...args: any[]): any;
declare function timeOf(...args: any[]): any;
declare function timeOfMs(...args: any[]): any;
declare function triageCount(...args: any[]): any;

export const checksumsOf = function (s: any) {
  // v18-30：可接/占用 = 列表 open issue 口径（与面板列表一致）
  // #689：口径收成「工单口径」（拉取请求不算工单，判断住在 store-derived 的 isTicketRow，与主列表、KPI 共用）；
  //   「可接」再优先用宿主给的后端计数（deck.counts.open）减去本地数出来的阻塞 —— 数字与 KPI 那一行同源。
  const occ = occCount(s)
  const counts = deckCountsOf(s, false)
  const fr = counts ? Math.max(0, counts.open - occ) : frontierCount(s)
  const bugN = bugCount(s)
  const triageN = triageCount(s)
  const n = readyCount(s)
  // #327 特性 A：优先显示「上次探测时间」（数据不变也走针）；无探测记录回落快照生成时间/链加载时间
  const _probeMs = (s.cwd && typeof getProbeAt === 'function') ? getProbeAt(s.cwd) : 0
  const timeStr = (_probeMs && typeof timeOfMs === 'function' ? timeOfMs(_probeMs) : '') || timeOf(s.snapshot) || (s.chainLoadedAt ? s.chainLoadedAt.slice(5, 16) : '') || '-- --:--'
  return { fr: fr, bugN: bugN, triageN: triageN, n: n, timeStr: timeStr }
}
