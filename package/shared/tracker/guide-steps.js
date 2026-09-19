// src/shared/tracker/guide-steps.js —— 首开引导链的顺序真源（#668 落地，规格见 #662「定版一」）。
// 以后谁改它：改首开引导链有哪些步骤、步骤之间谁先谁后的人。预估约 130 行，超 350 打回。
// 它是「一份顺序、三处读它」里的那一份：宿主按它给链快照排序（src/host/detectChain.js），
// 状态栏横幅与注入决策（#663 / #664）从它读「下一步该给什么」。这三处都不许自己再抄一份顺序。
// 接线：零依赖——本文件不许 import 任何东西（它要被 scripts/build.mjs 的 SHARED_SPLICE
//   拼进客户端闭包，客户端半边没有运行时 import）；共享层文件之间也不许互相 import。

/** 步骤顺序的取值（GUIDE_STEPS 里每一步都有这一项）。
 *  就绪口径：'chain' = 这一步过没过，读链快照里那几项检查的状态；
 *  'gate' = 读客户端自己的门控状态（后端还没选定那一类本地状态，链快照里没有对应检查项）。 */
const STEP_READY = Object.freeze({ CHAIN: 'chain', GATE: 'gate' })

/** 步骤没过时给哪个界面动作（清单只声明，界面只分发）。
 *  'inject' 是往会话里注入一段文字；'fixes-action' 是用当前后端为这一步声明的修复动作
 *  （载荷写在后端自己的 fixes 里，清单不抄第二份）。 */
const STEP_ACTION = Object.freeze({ INJECT: 'inject', FIXES_ACTION: 'fixes-action' })

/** 步骤没过时怎么给（与 #662「定版一」那张表的「没过时给什么」一列逐格对应）。 */
const MISSING = Object.freeze({
  // 「已选择后端」这一步由界面自己开那张选后端的窗（它不碰后端，所以不是后端声明的修复动作）。
  pickBackend: Object.freeze({ type: 'open-backend-picker' }),
  // 「gh cli 已安装」这一步注入维护者 2026-09-19 给的原话：让代理用 /wizard 技能帮用户装。
  installGh: Object.freeze({ type: STEP_ACTION.INJECT, text: '/wizard 帮用户安装gh cli 官方地址：https://cli.github.com/' }),
  // 「已登录 GitHub」注入按当前后端解析的登录指引（提示词 id 与今天一致）。
  ghAuthLogin: Object.freeze({ type: STEP_ACTION.INJECT, prompt: 'ghAuthLogin' }),
  // 「已关联 GitHub 仓库」用后端为这一项声明的第一个修复动作（GitHub 那枚两步建仓弹窗）。
  repoRemoteFix: Object.freeze({ type: STEP_ACTION.FIXES_ACTION }),
  // 「工作区已初始化」注入初始化全文（布局没选过时先弹那张小卡，由注入决策漏斗负责）。
  setupRun: Object.freeze({ type: STEP_ACTION.INJECT, prompt: 'setupRun' }),
  // 技能套件那一步注入安装指引。
  installSkills: Object.freeze({ type: STEP_ACTION.INJECT, prompt: 'installSkills' }),
})

/** 步骤没过时出哪一条横幅（文案与按钮标签是 locale 词条键名，界面不许写死文字；null = 这一步不出横幅）。 */
const BANNER = Object.freeze({
  gate: Object.freeze({ text: 'banner.gate', btn: 'banner.gateBtn', tone: 'info' }),
  ghCli: Object.freeze({ text: 'banner.ghcli', btn: 'banner.ghcliBtn', tone: 'warn' }),
  ghAuth: Object.freeze({ text: 'banner.ghauth', btn: 'banner.ghauthBtn', tone: 'warn' }),
  setup: Object.freeze({ text: 'banner.setup', btn: 'banner.setupBtn', tone: 'warn' }),
  skills: Object.freeze({ text: 'banner.skills', btn: 'banner.skillsBtn', tone: 'warn' }),
  repo: Object.freeze({ text: 'banner.repo', btn: 'banner.repoBtn', tone: 'warn' }),
})

/**
 * 首开引导链的步骤清单（顺序即维护者 2026-09-19 定的那一条）。
 * 每一步的字段见 #662「定版一」：id / checks / backends / ready / banner / missing / blocksSetup。
 * 通用步骤三个后端都写；GitHub 专属的只写 ['github']（GitLab 与本地 Markdown 本轮不插仓库那一段）。
 */
export const GUIDE_STEPS = Object.freeze([
  {
    // 第 1 步：后端还没选定。链快照常常比后端选择先到，照快照判会让全新工作区闪一下
    // 「尚未初始化／技能缺失」黄条再跳回蓝条，所以这一步读本地门控状态，不读链快照。
    id: 'selection:backendSelected',
    checks: ['selection:backendSelected'],
    backends: ['github', 'markdown', 'gitlab'],
    ready: STEP_READY.GATE,
    banner: BANNER.gate,
    missing: MISSING.pickBackend,
    blocksSetup: false,
  },
  {
    // 第 2 步：gh cli 装没装（只管 GitHub 这条链）。
    id: 'gh:installed',
    checks: ['gh:installed'],
    backends: ['github'],
    ready: STEP_READY.CHAIN,
    banner: BANNER.ghCli,
    missing: MISSING.installGh,
    blocksSetup: false,
  },
  {
    // 第 3 步：登录 GitHub。
    id: 'gh:authed',
    checks: ['gh:authed'],
    backends: ['github'],
    ready: STEP_READY.CHAIN,
    banner: BANNER.ghAuth,
    missing: MISSING.ghAuthLogin,
    blocksSetup: false,
  },
  {
    // 第 4 步：远端仓库已关联（复用检查页已有的 gh:remote，不新增检查项）。这一步没过之前
    // 一律不注入初始化全文——今天那条「缺仓库就发一段长文」的老行为到此结束。
    id: 'gh:remote',
    checks: ['gh:remote'],
    backends: ['github'],
    ready: STEP_READY.CHAIN,
    banner: BANNER.repo,
    missing: MISSING.repoRemoteFix,
    blocksSetup: true,
  },
  {
    // 第 5 步：工作区已初始化（读工作区根那份 docs/agents/issue-tracker.md，口径与今天一致）。
    id: 'tracker:initialized',
    checks: ['tracker:initialized'],
    backends: ['github', 'markdown', 'gitlab'],
    ready: STEP_READY.CHAIN,
    banner: BANNER.setup,
    missing: MISSING.setupRun,
    blocksSetup: false,
  },
  {
    // 第 6 步：技能套件的三个技能，一条横幅管三项（取三项里最差的那一项，与今天渲染一致）。
    id: 'skill:wayfinder',
    checks: ['skill:wayfinder', 'skill:setup-matt-pocock-skills', 'skill:ask-matt'],
    backends: ['github', 'markdown', 'gitlab'],
    ready: STEP_READY.CHAIN,
    banner: BANNER.skills,
    missing: MISSING.installSkills,
    blocksSetup: false,
  },
])

/**
 * 按后端过滤出适用的步骤，顺序不变。
 * @param {string|null} backendId 'github' | 'markdown' | 'gitlab'（为空或未知则返回空数组）
 * @returns {ReadonlyArray<Object>}
 */
export function guideStepsFor(backendId) {
  try {
    const id = String(backendId || '')
    if (!id) return []
    return GUIDE_STEPS.filter(function (s) {
      return !!(s && Array.isArray(s.backends) && s.backends.indexOf(id) >= 0)
    })
  } catch (e) { return [] }
}

/**
 * 这一步过没过：它的检查项在链快照里全部是 'done' 才算过。
 * 检查项在链快照里根本没有（例如该后端不适用）时一律算没过——宁可再问一次，也不把没有证据当成过了。
 * @param {Object} step GUIDE_STEPS 里的一步
 * @param {Array<{id:string,status:string}>} chainSteps 链快照里的步骤（st.chainSnapshot.steps）
 * @returns {boolean}
 */
export function guideStepDone(step, chainSteps) {
  try {
    const ids = step && Array.isArray(step.checks) ? step.checks : []
    if (!ids.length) return false
    const list = Array.isArray(chainSteps) ? chainSteps : []
    const statusOf = {}
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      if (it && it.id != null) statusOf[String(it.id)] = String((it && it.status) || '')
    }
    return ids.every(function (id) {
      return statusOf[String(id)] === 'done'
    })
  } catch (e) { return false }
}

/**
 * 把链快照的步骤按清单排好：清单上的步骤按清单顺序排在前，清单没覆盖的检查项按原有的先后接在后面。
 * 宿主组装 fullSnapshot 时用它（见 src/host/detectChain.js）；界面只照快照渲染，不自己排序。
 * ready 为 'gate' 的步骤不在链快照里（它没有对应检查项），参与排序时自动跳过。
 * @param {ReadonlyArray<Object>} guideSteps 某后端的清单（guideStepsFor 的结果）
 * @param {Array<Object>} chainSteps 链快照里的步骤
 * @returns {Array<Object>} 排好序的新数组（不改动入参）
 */
export function orderStepsByGuide(guideSteps, chainSteps) {
  const list = Array.isArray(chainSteps) ? chainSteps : []
  const steps = Array.isArray(guideSteps) ? guideSteps : []
  const byId = {}
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    if (it && it.id != null && !byId[String(it.id)]) byId[String(it.id)] = it
  }
  const out = []
  const taken = {}
  for (let g = 0; g < steps.length; g++) {
    const step = steps[g]
    if (!step || step.ready === STEP_READY.GATE) continue
    const ids = Array.isArray(step.checks) ? step.checks : []
    for (let c = 0; c < ids.length; c++) {
      const key = String(ids[c])
      if (taken[key] || !byId[key]) continue
      taken[key] = true
      out.push(byId[key])
    }
  }
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    if (it && it.id != null && taken[String(it.id)]) continue
    out.push(it)
  }
  return out
}
