/**
 * statusbar/checksums.js — 状态栏计数/徽标计算（5.2；v14 数字区等宽 + 依赖链检测）
 * G4 严格一文件：从 StatusBar.js 拆出的独立文件（#97 T4）。
 * 消费：StatusBar 内 `const csx = checksumsOf(s)`（cl 解构后各引用不变）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
export const checksumsOf = function (s) {
  // v18-30：可接/占用 = 列表 open issue 口径（与面板列表一致）
  const fr = frontierCount(s)
  const bugN = bugCount(s)
  const triageN = triageCount(s)
  const n = readyCount(s)
  const timeStr = timeOf(s.snapshot) || (s.checksUpdatedAt ? s.checksUpdatedAt.slice(5, 16) : '') || '-- --:--'
  const setup = setupCheck(s)
  const amber = s.checksMode === 'real' && setup && setup.level !== 'ok'
  // v1.5 T11：核心技能套件检测（检查 9）
  const skillsCheck = (s.checks || []).find(function (c) { return c.id === 9 })
  const skillsBad = s.checksMode === 'real' && skillsCheck && skillsCheck.level !== 'ok'
  // v1.5 引导依赖链（用户拍板 2026-08-17）：gh CLI → gh 登录 → setup → 技能 —— banner 显示依赖链上第一个缺失项
  const ghCliCheck = (s.checks || []).find(function (c) { return c.id === 4 })
  const ghAuthCheck = (s.checks || []).find(function (c) { return c.id === 5 })
  // #195 修复：warn（pending 探测态）不再当 bad —— 与 gh 是否安装无关的 UI 语义错误（pending 时 banner 文案误导为「未安装」）
  const ghCliBad = s.checksMode === 'real' && ghCliCheck && ghCliCheck.level === 'bad'
  const ghAuthBad = s.checksMode === 'real' && ghAuthCheck && ghAuthCheck.level === 'bad'
  // #195 修复：新增 pending 派生（供 UI 显示「探测中」状态，区别于「未安装」）
  const ghCliPending = s.checksMode === 'real' && ghCliCheck && ghCliCheck.level === 'warn'
  const ghAuthPending = s.checksMode === 'real' && ghAuthCheck && ghAuthCheck.level === 'warn'
  return { fr: fr, bugN: bugN, triageN: triageN, n: n, timeStr: timeStr, setup: setup, amber: amber, skillsCheck: skillsCheck, skillsBad: skillsBad, ghCliBad: ghCliBad, ghAuthBad: ghAuthBad, ghCliPending: ghCliPending, ghAuthPending: ghAuthPending }
}
