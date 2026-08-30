/**
 * statusbar/checksums.js — 状态栏计数/徽标计算（5.2；v14 数字区等宽 + 依赖链检测）
 * G4 严格一文件：从 StatusBar.js 拆出的独立文件（#97 T4）。
 * 消费：StatusBar 内 const csx = checksumsOf(s)（cl 解构后各引用不变）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 * #284：全部读数改从链快照派生（九格目录视图退役）；pending 不计入分子分母。
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
  const setup = setupCheck(s)
  const setupSts = setup ? setup.status : 'pending'
  const amber = setupSts !== 'done' && setupSts !== 'pending'
  // v1.5 T11 + #229/#284：核心技能 = 三个通用技能步的最差态（链步骤 status 派生）
  const skillIds = ['skill:wayfinder', 'skill:setup-matt-pocock-skills', 'skill:ask-matt']
  const _skillSteps = skillIds.map(function (k) { return chainStep(s, k) }).filter(Boolean)
  const worstOf = function (arr) {
    const rank = { done: 0, current: 1, fail: 2, pending: 3 }
    let worst = null
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i]
      if (!worst || rank[x.status] > rank[worst.status]) worst = x
    }
    return worst
  }
  const skillsCheck = worstOf(_skillSteps)
  const skillsBad = !!(skillsCheck && skillsCheck.status !== 'done' && skillsCheck.status !== 'pending')
  // v1.5 引导依赖链（用户拍板 2026-08-17）：gh CLI → gh 登录 → setup → 技能 —— banner 显示依赖链上第一个缺失项（链步骤不存在则该环节跳过）
  const ghCliStep = chainStep(s, 'gh:installed')
  const ghAuthStep = chainStep(s, 'gh:authed')
  // #195 修复：pending 探测态不当作 bad（与 gh 是否安装无关的 UI 语义错误）
  const ghCliBad = !!(ghCliStep && ghCliStep.status === 'fail')
  const ghAuthBad = !!(ghAuthStep && ghAuthStep.status === 'fail')
  const ghCliPending = !!(ghCliStep && ghCliStep.status === 'pending')
  const ghAuthPending = !!(ghAuthStep && ghAuthStep.status === 'pending')
  return { fr: fr, bugN: bugN, triageN: triageN, n: n, timeStr: timeStr, setup: setup, amber: amber, skillsCheck: skillsCheck, skillsBad: skillsBad, ghCliBad: ghCliBad, ghAuthBad: ghAuthBad, ghCliPending: ghCliPending, ghAuthPending: ghAuthPending }
}