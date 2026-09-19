/**
 * statusbar/checksums.js — 状态栏计数/徽标计算（5.2；v14 数字区等宽 + 依赖链检测）
 * G4 严格一文件：从 StatusBar.js 拆出的独立文件（#97 T4）。
 * 消费：StatusBar 内 const csx = checksumsOf(s)（cl 解构后各引用不变）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 * #284：全部读数改从链快照派生（九格目录视图退役）；pending 不计入分子分母。
 * #663：原先在这里算的那几个「今天该出哪条横幅」的读数（gh cli / 登录 / 初始化 / 技能那四个布尔）
 *   一并删了 —— 横幅改由 statusbar/bannerChain.js 按引导链清单（src/shared/tracker/guide-steps.js）
 *   逐步判，顺序只有那一份真源。本文件只剩胶囊上那几个计数与时间戳。
 */
export const checksumsOf = function (s) {
  // v18-30：可接/占用 = 列表 open issue 口径（与面板列表一致）
  const fr = frontierCount(s)
  const bugN = bugCount(s)
  const triageN = triageCount(s)
  const n = readyCount(s)
  // #327 特性 A：优先显示「上次探测时间」（数据不变也走针）；无探测记录回落快照生成时间/链加载时间
  const _probeMs = (s.cwd && typeof getProbeAt === 'function') ? getProbeAt(s.cwd) : 0
  const timeStr = (_probeMs && typeof timeOfMs === 'function' ? timeOfMs(_probeMs) : '') || timeOf(s.snapshot) || (s.chainLoadedAt ? s.chainLoadedAt.slice(5, 16) : '') || '-- --:--'
  return { fr: fr, bugN: bugN, triageN: triageN, n: n, timeStr: timeStr }
}
