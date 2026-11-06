// verify/scenarios/1857-vc-pages.ts —— 规格 #1857 的二级页真机验证场景：
// 迁移与备份 / 诊断 / 平台与边界（#1844）与 变基待办 / 冲突向导 / 任务进度（#1845）六页，
// 在 300 / 380 / 460 / 520 四档面板宽度与深 / 浅两皮肤下逐档读 DOM 并截图。
//
// 为什么要有这一份：票面的验收是「原型区块顺序在四档宽两皮肤下成立、页面不横向溢出、
// 页尾没有能力清单」——这三件事全在布局与挂载上，静态门禁能表达结构，真机才能证明
// 装进产品之后还是这个样子。场景只做观测与截图，判定写在每条 observation 里。
//
// 运行方式（在仓库根；先按 verify/README 准备隔离批次 home）：
//   $env:DSH_HOME='D:/Temp/matt-1857-home'
//   node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js run verify/scenarios/1857-vc-pages.ts --profile web --work-root D:/Temp/matt-verify --declaration verify/profile-1833-headed.ts --json
//
// 可选环境变量：
//   DSH_1857_PAGES   要跑的页（默认六页全跑）：migrate,diagnostics,platform,rebase,conflicts,task
//   DSH_1857_WIDTHS  要跑的档宽（默认 300,380,460,520）
//   DSH_1857_SKINS   要跑的皮肤（默认 dark,light）
//   DSH_1857_REPO    工作区指向的仓库路径（默认本文件所在仓库根）
//   DSH_1857_OUT     截图与读数另存目录（默认仓库下的 .scratch/1857/evidence）
//
// 隔离实例的批次 home 必须真的装上了本插件（profile 的 dsh.profile.bundles 里有
// dsh-mattpocock-skills-deck），否则右侧栏不会出现 MattSkills 入口，本场景会在
// 打开面板那一步报 blocked —— 那是环境问题，不是页面问题。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { PageHandle, ScenarioContext, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { hooks } from '../hooks.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const OUT_DIR = process.env.DSH_1857_OUT === undefined ? path.join(REPO_ROOT, '.scratch', '1857', 'evidence') : String(process.env.DSH_1857_OUT)

const WIDTHS = [300, 380, 460, 520]
const SKINS = [
  { id: 'dark', dark: true },
  { id: 'light', dark: false },
]

// 每一页：导航方式（gear = 齿轮进管理索引再点卡；link = 顶部条上的额外入口）、页头标题，
// 以及按原型顺序期望出现的正文区块标题。区块标题按「子序列」匹配：页面可以有意料之外的
// 额外区块（产品必须有、原型没有的那些），只要原型那几块按序出现。
const PAGES = [
  { id: 'migrate', kind: 'gear', title: '迁移与备份', sections: ['克隆与初始化', '归档与离线包', '历史与邮件', '备份与恢复'] },
  { id: 'diagnostics', kind: 'gear', title: '诊断', sections: ['版本与计数', '只读对象查看', '检查与定位'] },
  { id: 'platform', kind: 'gear', title: '平台与边界', sections: ['交出去的六条能力', '四条边界'] },
  { id: 'rebase', kind: 'link', title: '变基待办', sections: ['本次变基', '六步待办', '会动与不会动'] },
  { id: 'conflicts', kind: 'link', title: '冲突向导', sections: ['本次合并', '会动与不会动'] },
  { id: 'task', kind: 'link', title: '任务进度', sections: ['选一种长任务', '进度', '取消之后'] },
  // #1848 收口走查的其余四页：管理索引（齿轮那屏）与三张分区页。这几页的区块写法由各自的切片票
  // 定过，收口这一轮只验「四档宽两皮肤下首屏还在、不横向溢出、页尾没有能力清单」。
  { id: 'manage', kind: 'gear-index', title: '管理', sections: [] },
  // 四个一级页签也走同一套四档宽两皮肤读数（#1904 / #1905 的工作区页与储藏页就在这里）。
  // #1883：分支与标签页是二级页（齿轮进），第三行写「时间 · 提交主题」，这一页要多读一份行文本。
  { id: 'branch-tags', kind: 'gear', title: '分支与标签', sections: [], branchRow: true },
  // #1904 / #1905：这三页是一级页签，按原型不画页头（页头只给二级页），所以判据换成
  //   「页签处于选中态 + 正文根对得上」，再各点一条本页特有的入口，证明这一页真的挂出来了。
  { id: 'changes', kind: 'tab', title: '改动', sections: [], need: ['[data-vc-stash-arrow]'] },
  { id: 'worktrees', kind: 'tab', title: '工作区', sections: [], need: ['[data-wt-create-open]', '[data-wt-action="expand"]'] },
  { id: 'stash', kind: 'tab', title: '储藏', sections: [], need: ['[data-vc-stash-op="list"]', '[data-vc-stash-clear]', '[data-vc-stash-row-menu]'] },
  { id: 'remote', kind: 'gear', title: '远端与同步', sections: [] },
  { id: 'config', kind: 'gear', title: '配置', sections: [] },
  { id: 'hooks', kind: 'gear', title: '钩子', sections: [] },
]

const ENABLED_PAGES = String(process.env.DSH_1857_PAGES || 'migrate,diagnostics,platform,rebase,conflicts,task')
  .split(',').map(function (s) { return s.trim() }).filter(function (s) { return s.length > 0 })
const ENABLED_WIDTHS = String(process.env.DSH_1857_WIDTHS || WIDTHS.join(','))
  .split(',').map(function (s) { return Number(s.trim()) }).filter(function (n) { return isFinite(n) && n > 0 })
// DSH_1857_ACTIONS=1：在页签页上额外点开三张就地表单（新建工作区 / 储藏三种收法 / 记录行菜单与清空），
// 每开一张截一张图。默认 0：只读页面版式，不改变页面状态。
const ACTIONS = process.env.DSH_1857_ACTIONS === '1'
const ENABLED_SKINS = String(process.env.DSH_1857_SKINS || 'dark,light')
  .split(',').map(function (s) { return s.trim() }).filter(function (s) { return s.length > 0 })

const SKILLS_TAB = 'button[data-ink-key="skills"]'
const VERSION_TAB = 'button[data-ink-key="versionControl"]'
// 宿主面板上的页签本身也带 data-log；两个选择器都留着，哪个在就用哪个。
const VERSION_TAB_ALT = 'button.dsws-tab[data-log="panel.tab.versioncontrol"]'
const RIGHTBAR_HANDLE = '[data-side="rightbar"]'
const PANEL_ENTRY = 'button[data-sidebar-right-guide-entry="dsh-mattpocock-skills-deck:deck-map"]'
const GEAR_BTN = '[data-vc-gear-btn]'
const EXTRA_LINK_PREFIX = '[data-vc-extra-link="'

interface RawResult { readonly ok: boolean; readonly error?: { readonly message?: string } }
interface RawBrowserPage {
  readonly page: any
  readonly goto?: (url: string) => Promise<RawResult>
  readonly click?: (selector: string) => Promise<RawResult>
  readonly press?: (key: string) => Promise<RawResult>
}
interface RootState {
  page: string | null; width: string | null; skin: string | null; depth: string | null
  bodyPage: string | null; headTitle: string | null; selectedTab: string | null
  sections: string[]; folds: string[]; capPrimaries: number; branchSubs: string[]
  docScrollWidth: number; innerWidth: number
  rootRight: number; rootLeft: number; maxRight: number; minLeft: number; rootWidthPx: number
}

function sleep(ms: number): Promise<void> { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }

async function evaluateThrough<T>(page: PageHandle, script: string): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  const result = await page.evaluate<T>(script)
  return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message }
}

function observe(input: {
  checkId: string; title: string; ok: boolean; detail: string
  expected?: string; actual?: string; hint?: string; evidence?: string[]
  status?: 'pass' | 'fail' | 'skip' | 'blocked'; hard?: boolean
}): ScenarioObservation {
  return {
    checkId: input.checkId,
    title: input.title,
    ok: input.ok,
    detail: input.detail,
    ...(input.expected === undefined ? {} : { expected: input.expected }),
    ...(input.actual === undefined ? {} : { actual: input.actual }),
    ...(input.hint === undefined ? {} : { hint: input.hint }),
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.hard === undefined ? {} : { hard: input.hard }),
  }
}

/** 页面内 RPC：与 ui / 1845 场景同一套信封（POST /api/<method>，client-request）。 */
function rpcScript(method: string, argsExpression: string): string {
  return [
    '(async function () {',
    '  var rpcId = String(Date.now()) + "-" + String(Math.random()).slice(2);',
    '  var body = { type: "client-request", rpcId: rpcId, method: ' + JSON.stringify(method) + ', payload: { args: ' + argsExpression + ' } };',
    '  var response = await fetch("/api/" + ' + JSON.stringify(method) + ', {',
    '    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),',
    '  });',
    '  var text = await response.text();',
    '  var parsed = null;',
    '  try { parsed = JSON.parse(text); } catch (error) { parsed = null; }',
    '  return { status: response.status, body: parsed, text: text.slice(0, 400) };',
    '})()',
  ].join('\n')
}

/** 皮肤开关写进 body（与宿主 ThemePresenter 同一个属性名）。 */
function skinScript(dark: boolean): string {
  return [
    '(function () {',
    dark ? '  document.body.setAttribute("data-ds-dark-theme", "");' : '  document.body.removeAttribute("data-ds-dark-theme");',
    '  return { skin: document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light" };',
    '})()',
  ].join('\n')
}

/**
 * 关掉首开弹窗。宿主 2026-11 的版本里有两种弹窗：预览版说明（按钮文字「继续」）与
 * 「开始使用 / 登录」引导（关闭按钮 aria-label=关闭）。它们都会挡住指针事件，不关掉
 * 就点不到右侧栏与面板入口。只点看得见的按钮，最多试 6 次。
 */
const DISMISS_SCRIPT = [
  '(function () {',
  '  var labels = ["继续", "我知道了", "知道了", "开始使用", "下一步", "关闭"]',
  '  var visible = function (el) { var r = el.getBoundingClientRect(); var s = window.getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4 }',
  '  var roots = [document.querySelectorAll("[role=dialog]"), document.querySelectorAll("[class*=_mask_]")]',
  '  for (var s = 0; s < roots.length; s += 1) {',
  '    var group = roots[s]',
  '    for (var i = 0; i < group.length; i += 1) {',
  '      if (!visible(group[i])) continue',
  '      var buttons = group[i].querySelectorAll("button, [role=button]")',
  '      for (var j = 0; j < buttons.length; j += 1) {',
  '        var el = buttons[j]',
  '        if (!visible(el)) continue',
  '        var text = String(el.textContent || "").trim()',
  '        var label = String(el.getAttribute("aria-label") || "")',
  '        if (labels.indexOf(text) >= 0 || labels.indexOf(label) >= 0) { el.click(); return { text: text, label: label } }',
  '      }',
  '    }',
  '  }',
  '  return null',
  '})()',
].join('\n')

/** 副页面读数：根节点属性、页头标题、正文区块标题、横向溢出与页尾能力清单。 */
const READ_STATE_SCRIPT = [
  '(function () {',
  '  var root = document.querySelector("[data-vc-shell]")',
  '  if (!root) return null',
  '  var body = document.querySelector("[data-vc-page-body]")',
  '  var head = document.querySelector("[data-vc-page-head]")',
  '  var box = root.getBoundingClientRect()',
  '  var maxRight = -1e9, minLeft = 1e9',
  '  var all = root.querySelectorAll("*")',
  '  for (var i = 0; i < all.length; i += 1) {',
  '    var el = all[i]',
  '    var cs = window.getComputedStyle(el)',
  '    if (cs.display === "none" || cs.visibility === "hidden") continue',
  '    var r = el.getBoundingClientRect()',
  '    if (r.width <= 0 && r.height <= 0) continue',
  '    if (r.right > maxRight) maxRight = r.right',
  '    if (r.left < minLeft) minLeft = r.left',
  '  }',
  '  return {',
  '    page: root.getAttribute("data-vc-page"), width: root.getAttribute("data-vc-width"),',
  '    skin: root.getAttribute("data-vc-skin"), depth: root.getAttribute("data-vc-depth"),',
  '    bodyPage: body === null ? null : body.getAttribute("data-vc-page-body"),',
  '    headTitle: head === null ? null : (head.querySelector(".vcs-page-title") === null ? null : String(head.querySelector(".vcs-page-title").textContent || "").trim()),',
  '    selectedTab: (function () { var el = document.querySelector("[data-vc-tab][aria-selected=true]"); return el === null ? null : el.getAttribute("data-vc-tab") })(),',
  '    sections: Array.prototype.map.call((body === null ? document : body).querySelectorAll(".page-section .section-title"), function (n) { return String(n.textContent || "").trim() }),',
  '    folds: Array.prototype.map.call((body === null ? document : body).querySelectorAll(".fold-title"), function (n) { return String(n.textContent || "").trim() }),',
  '    capPrimaries: (body === null ? document : body).querySelectorAll("[data-cap-primary]").length,',
  '    branchSubs: Array.prototype.map.call(document.querySelectorAll("[data-vc-branch-row] .obj-sub"), function (n) { return String(n.textContent || "").trim() }),',
  '    docScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,',
  '    rootRight: box.right, rootLeft: box.left, maxRight: maxRight, minLeft: minLeft, rootWidthPx: Math.round(box.width),',
  '  }',
  '})()',
].join('\n')

async function readState(page: PageHandle): Promise<RootState | null> {
  const probe = await evaluateThrough<RootState | null>(page, READ_STATE_SCRIPT)
  return probe.ok ? probe.value : null
}

async function realClick(raw: RawBrowserPage, selector: string): Promise<{ ok: boolean; problem: string | null }> {
  if (raw.click === undefined) return { ok: false, problem: '浏览器适配器没有暴露 click()' }
  const clicked = await raw.click(selector)
  return clicked.ok ? { ok: true, problem: null } : { ok: false, problem: clicked.error === undefined ? 'unknown error' : clicked.error.message }
}

async function forceClick(raw: RawBrowserPage, selector: string): Promise<{ ok: boolean; problem: string | null }> {
  try {
    await raw.page.locator(selector).first().click({ force: true, timeout: 8000 })
    return { ok: true, problem: null }
  } catch (error) {
    return { ok: false, problem: messageOf(error) }
  }
}

/** 真拖右侧栏手柄；dx 为正表示往右拖（面板变窄）。 */
async function dragRightbar(raw: RawBrowserPage, dx: number): Promise<{ ok: boolean; problem: string | null }> {
  try {
    const box = await raw.page.locator(RIGHTBAR_HANDLE).boundingBox()
    if (box === null || box === undefined) return { ok: false, problem: '找不到右侧栏拖拽手柄的可见位置' }
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await raw.page.mouse.move(cx, cy)
    await raw.page.mouse.down()
    await sleep(120)
    // 先动 2px 让宿主的拖拽判定接上，再一口气拖到目标：一气呵成时宿主有时认不到第一次位移。
    await raw.page.mouse.move(cx + Math.sign(dx) * 2, cy, { steps: 2 })
    await sleep(80)
    await raw.page.mouse.move(cx + dx, cy, { steps: 12 })
    await sleep(100)
    await raw.page.mouse.up()
    await sleep(460)
    return { ok: true, problem: null }
  } catch (error) {
    return { ok: false, problem: messageOf(error) }
  }
}

async function calibrateWidth(page: PageHandle, raw: RawBrowserPage, target: number): Promise<{ ok: boolean; width: number | null; problem: string | null }> {
  let last: number | null = null
  let problem: string | null = null
  // 拖一次没动就加大拖动量再来：实测从 460 往 520 拖 60px 常常「一点没动」（宿主把很小的位移丢掉），
  // 而往窄处拖同样的 60px 会生效。每次没变化就把系数放大，最到 3 倍，避免一直原地打转。
  // 拖拽方向不能想当然：本机实测同一个拖法在某一档会「变宽」、在相邻档会「变窄」（手柄按
  // 指针落点认边），所以每轮先按一个方向拖，宽度没往目标动就换反方向，再不行才加大拖动量。
  let sign = -1
  let boost = 1
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const state = await readState(page)
    if (state === null || state.width === null) { problem = '读不到 data-vc-width'; break }
    last = Number(state.width)
    if (last === target) return { ok: true, width: last, problem: null }
    const delta = Math.abs(target - last) * boost
    const dragged = await dragRightbar(raw, sign * delta)
    if (!dragged.ok) { problem = dragged.problem; break }
    const after = await readState(page)
    const now = after === null || after.width === null ? null : Number(after.width)
    if (now === null || now === last) { sign = -sign; boost = Math.min(3, boost * 1.5) }
    else if (Math.abs(target - now) >= Math.abs(target - last)) { sign = -sign }
  }
  return { ok: last === target, width: last, problem: last === target ? null : problem || '校准后宽度仍是 ' + String(last) }
}

async function waitForBodyPage(page: PageHandle, pageId: string, budgetMs: number): Promise<RootState | null> {
  const deadline = Date.now() + budgetMs
  let last: RootState | null = null
  while (Date.now() < deadline) {
    last = await readState(page)
    if (last !== null && last.bodyPage === pageId) return last
    await sleep(220)
  }
  return null
}

/** 等面板骨架屏消失、页签出现（骨架屏会接住指针事件）。 */
async function waitForPanelReady(page: PageHandle, budgetMs: number): Promise<boolean> {
  const script = '(function () { return { skeletons: document.querySelectorAll("[data-dsws-list-skeleton]").length, tabs: document.querySelectorAll("button[data-ink-key]").length }; })()'
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const probe = await evaluateThrough<any>(page, script)
    if (probe.ok && probe.value !== null && probe.value.skeletons === 0 && probe.value.tabs > 0) return true
    await sleep(300)
  }
  return false
}

/** 切页签重挂版本管理页（皮肤只在挂载时读一次）：点「技能」再点回「版本管理」。 */
async function remountVersionControl(raw: RawBrowserPage): Promise<{ ok: boolean; problem: string | null }> {
  await sleep(400)
  const toSkills = await realClick(raw, SKILLS_TAB)
  if (!toSkills.ok) return { ok: false, problem: '点技能页签失败：' + String(toSkills.problem) }
  await sleep(700)
  const back = await realClick(raw, VERSION_TAB)
  if (!back.ok) return { ok: false, problem: '点版本管理页签失败：' + String(back.problem) }
  await sleep(1500)
  return { ok: true, problem: null }
}

/** 截图：整页面板（面板宽、内容全高）。先把视口加高到内容高度，再截 [data-vc-shell]。 */
async function capturePanel(page: PageHandle, raw: RawBrowserPage, filePath: string): Promise<{ ok: boolean; method: string; bytes: number; problem: string | null }> {
  const size = await page.innerSize()
  const viewportW = size.ok ? size.value.width : 1500
  const viewportH = size.ok ? size.value.height : 900
  const boxProbe = await evaluateThrough<any>(page, '(function () { var r = document.querySelector("[data-vc-shell]"); if (!r) return null; var b = r.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })()')
  if (!boxProbe.ok) return { ok: false, method: 'none', bytes: 0, problem: boxProbe.message }
  const contentHeight = boxProbe.value !== null && typeof boxProbe.value.h === 'number' ? boxProbe.value.h : 0
  const wantHeight = Math.min(9000, Math.max(viewportH, contentHeight + 260))
  let method = 'element-direct'
  try {
    if (wantHeight > viewportH) {
      method = 'tall-viewport+element'
      await raw.page.setViewportSize({ width: viewportW, height: wantHeight })
      await sleep(450)
    }
    await raw.page.locator('[data-vc-shell]').screenshot({ path: filePath, timeout: 20000 })
    const st = fs.statSync(filePath)
    if (wantHeight > viewportH) { await raw.page.setViewportSize({ width: viewportW, height: viewportH }); await sleep(320) }
    return { ok: st.size > 3000, method, bytes: st.size, problem: st.size > 3000 ? null : '截图只有 ' + String(st.size) + ' 字节，可能是空白' }
  } catch (error) {
    try { await raw.page.setViewportSize({ width: viewportW, height: viewportH }) } catch (e2) { /* 恢复视口失败不影响读数 */ }
    try {
      await raw.page.screenshot({ path: filePath, timeout: 15000 })
      const st = fs.statSync(filePath)
      return { ok: st.size > 3000, method: 'viewport-fallback', bytes: st.size, problem: '整块截图失败（' + messageOf(error) + '），退化成整窗截图' }
    } catch (error2) {
      return { ok: false, method: 'failed', bytes: 0, problem: '截图失败：' + messageOf(error) + '；整窗截图也失败：' + messageOf(error2) }
    }
  }
}

/** 点一个选择器；找不到或点不动就如实记下来，不抛。动作截图是给人看的，缺一张不该把整趟判红。 */
async function softClick(raw: RawBrowserPage, selector: string): Promise<boolean> {
  const found = await waitForSelector(raw, selector, 6000)
  if (!found) return false
  const clicked = await realClick(raw, selector)
  if (clicked.ok) { await sleep(700); return true }
  const forced = await forceClick(raw, selector)
  if (forced.ok) await sleep(700)
  return forced.ok
}

/** 新建工作区的目标目录：放在夹具仓库旁边，绝不落进仓库或真实 DSH 主目录。 */
const WT_NEW_BASE = String(process.env.DSH_1857_WT_BASE || 'D:/temp/matt1857/fixture1904')
// 每一趟跑都用新的目录与分支名：同名工作树第二次建会直接失败，而动作截图每趟都要真建一棵。
const WT_RUN_TAG = String(Date.now()).slice(-6)

/** 读一个元素的文字（找不到就是空串）。 */
async function textOf(page: PageHandle, selector: string): Promise<string> {
  const probe = await evaluateThrough<string>(page, '(function () { var el = document.querySelector(' + JSON.stringify(selector) + '); return el === null ? "" : String(el.textContent || "").trim() })()')
  return probe.ok ? probe.value : ''
}

/** 移动表单：填新目录再保存，等结果条；返回是否出了结果与结果条上的字。 */
async function saveMove(page: PageHandle, raw: RawBrowserPage, target: string): Promise<{ ok: boolean; problem: string | null; text: string }> {
  try {
    await raw.page.fill('[data-wt-move-input]', target)
    await sleep(200)
    const saved = await realClick(raw, '[data-wt-move-save]')
    if (!saved.ok) return { ok: false, problem: '点保存失败：' + String(saved.problem), text: '' }
    const shown = await waitForSelector(raw, '[data-wt-result]', 25000)
    return { ok: shown, problem: shown ? null : '保存后 25 秒内没有结果条', text: shown ? await textOf(page, '[data-wt-result-text]') : '' }
  } catch (error) {
    return { ok: false, problem: messageOf(error), text: '' }
  }
}

/** 稀疏检出：一个都不勾就点保存，看页面是否拒绝；返回结果条上的字与语气。 */
async function saveSparse(page: PageHandle, raw: RawBrowserPage): Promise<{ ok: boolean; problem: string | null; text: string; tone: string }> {
  try {
    const saved = await realClick(raw, '[data-wt-sparse-save]')
    if (!saved.ok) return { ok: false, problem: '点保存失败：' + String(saved.problem), text: '', tone: '' }
    const shown = await waitForSelector(raw, '[data-wt-result]', 20000)
    const tone = await evaluateThrough<string>(page, '(function () { var el = document.querySelector("[data-wt-result]"); return el === null ? "" : String(el.getAttribute("data-wt-result") || "") })()')
    return { ok: shown, problem: shown ? null : '保存后 20 秒内没有结果条', text: shown ? await textOf(page, '[data-wt-result-text]') : '', tone: tone.ok ? tone.value : '' }
  } catch (error) {
    return { ok: false, problem: messageOf(error), text: '', tone: '' }
  }
}

/** 读当前工作区页上逐行的路径（按页面画的顺序）。 */
async function readWorktreeRows(raw: RawBrowserPage): Promise<string[]> {
  try {
    return await raw.page.locator('[data-wt-row]').evaluateAll(function (nodes: any[]) {
      return nodes.map(function (n: any) { return String(n.getAttribute('data-wt-path') || '') })
    })
  } catch (error) {
    return []
  }
}

/** 在「新建工作区」表单里填目录与分支再提交，等结果条出现；返回是否真的出了结果。 */
async function createWorktree(raw: RawBrowserPage, target: string, branch: string): Promise<{ ok: boolean; problem: string | null; rows: string[] }> {
  try {
    await raw.page.fill('[data-wt-create-path]', target)
    await sleep(200)
    await raw.page.fill('[data-wt-create-branch-input]', branch)
    await sleep(200)
    const submitted = await realClick(raw, '[data-wt-create-submit]')
    if (!submitted.ok) return { ok: false, problem: '点提交失败：' + String(submitted.problem), rows: [] }
    const shown = await waitForSelector(raw, '[data-wt-result]', 25000)
    const rows = await raw.page.locator('[data-wt-row]').evaluateAll(function (nodes: any[]) {
      return nodes.map(function (n: any) { return String(n.getAttribute('data-wt-path') || '') })
    })
    return { ok: shown, problem: shown ? null : '提交后 25 秒内没有出现结果条', rows: rows }
  } catch (error) {
    return { ok: false, problem: messageOf(error), rows: [] }
  }
}

/** 行内表单没打开时留一份现场：表单节点数、展开着的行数、展开区里的文字。 */
async function probeRowState(page: PageHandle): Promise<Record<string, unknown>> {
  const probe = await evaluateThrough<Record<string, unknown>>(page, '(function () { var open = document.querySelectorAll("[data-wt-expandable][open]"); var box = open.length > 0 ? open[0].querySelector("[data-wt-detail-box]") : null; return { moveForms: document.querySelectorAll("[data-wt-move-form]").length, sparseForms: document.querySelectorAll("[data-wt-sparse-form]").length, openRows: open.length, detail: box === null ? "" : String(box.innerText || "").slice(0, 300) } })()')
  return probe.ok ? probe.value : { error: probe.message }
}

/** 按路径展开某一行（已经展开就不动它）；返回这一行是不是展开着的。 */
async function expandRow(raw: RawBrowserPage, path: string): Promise<boolean> {
  const base = '[data-wt-expandable="' + path + '"]'
  if (!(await waitForSelector(raw, base, 10000))) return false
  const isOpen = async (): Promise<boolean> => {
    try {
      return await raw.page.locator(base).first().evaluate(function (node: any) { return node.hasAttribute('open') === true })
    } catch (error) {
      return false
    }
  }
  if (await isOpen()) return true
  // 点 summary 而不是点箭头：箭头自己带着一个 expand 动作，点它会和 details 的原生切换互相抵消。
  await realClick(raw, base + ' summary')
  await sleep(500)
  return await isOpen()
}

/** 在清单里第一棵「其它工作区」上展开行、点 move-open / sparse-open，并等表单真的画出来。
 *  用 locator 定位而不是拼属性选择器：行的 data-wt-expandable 记的是宿主读到的原始路径，
 *  与界面上的 data-wt-path 未必逐字相同（实测拼出来的选择器一个都匹配不上）。 */
async function openFirstRowForm(raw: RawBrowserPage, op: string, readySelector: string, budgetMs: number): Promise<boolean> {
  try {
    const row = raw.page.locator('[data-wt-expandable]').first()
    if (await row.count() === 0) return false
    const opened = await row.evaluate(function (node: any) { return node.hasAttribute('open') === true })
    if (!opened) {
      await row.locator('summary').first().click({ timeout: 8000 })
      await sleep(500)
    }
    const button = row.locator('[data-wt-action="' + op + '"]').first()
    if (await button.count() === 0) return false
    // 用元素自己的 click() 而不是指针点击：这两个按钮在 <summary> 里，指针点击会连带触发
    //   details 的开关，看起来像「点了没反应」；元素级 click 只走 React 的 onClick。
    await button.evaluate(function (node: any) { node.click() })
    if (await waitForSelector(raw, readySelector, Math.round(budgetMs / 2))) return true
    // 这两个按钮在 <summary> 里：点它们会顺带把行收起一次，再点一次 summary 展开，表单状态还在。
    await row.locator('summary').first().click({ timeout: 8000 })
    await sleep(500)
    return await waitForSelector(raw, readySelector, Math.round(budgetMs / 2))
  } catch (error) {
    return false
  }
}

/** 页签页上的三张就地表单（#1904 / #1905）：打开、截图、再关掉，页面回到原样。 */
async function captureActions(page: PageHandle, raw: RawBrowserPage, spec: any, skin: any, width: number, outDir: string, facts: any): Promise<void> {
  const shots: any[] = []
  const shot = async (name: string): Promise<void> => {
    const shotPath = path.join(outDir, spec.id + '-' + name + '-' + skin.id + '-' + width + '.png')
    const r = await capturePanel(page, raw, shotPath)
    shots.push({ name, ok: r.ok, bytes: r.bytes, problem: r.problem })
  }
  if (spec.id === 'worktrees') {
    // 这一轮新建出来的目录：后面「移动 / 稀疏检出」都挂在这一行上，所以先声明在外面。
    const target = WT_NEW_BASE + '/wt-created-' + skin.id + '-' + width + '-' + WT_RUN_TAG
    let createdOk = false
    if (await softClick(raw, '[data-wt-create-open]')) {
      await shot('create')
      if (await softClick(raw, '[data-wt-create-mode="existing"]')) { await shot('create-existing'); await softClick(raw, '[data-wt-create-mode="new"]') }
      // 空目录直接提交：错误要留在表单里（不跳到页底结果条），改正后还能接着提交。
      await realClick(raw, '[data-wt-create-submit]')
      const errShown = await waitForSelector(raw, '[data-wt-create-error]', 12000)
      facts['createError:' + spec.id + ':' + skin.id + ':' + width] = { shown: errShown, text: errShown ? await textOf(page, '[data-wt-create-error]') : '' }
      await shot('create-error')
      // 真建一棵：目录与分支都填上再提交，结果条与「新建的那一棵排在最前」才有真凭据。
      const created = await createWorktree(raw, target, 'ticket/1904-' + skin.id + '-' + width + '-' + WT_RUN_TAG)
      createdOk = created.ok
      if (created.ok) {
        await shot('created')
        // 结果条出来时清单还是动作之前那一份：点一次「重新读取」再拍一张，才看得出新建的那一棵排在最前。
        await softClick(raw, '[data-vc-refresh]')
        await sleep(2600)
        const rowsAfter = await readWorktreeRows(raw)
        facts['rowsAfterCreate:' + spec.id + ':' + skin.id + ':' + width] = rowsAfter
        await shot('created-refreshed')
      }
      facts['create:' + spec.id + ':' + skin.id + ':' + width] = created
      await softClick(raw, '[data-wt-create-close]')
    }
    // 移动与稀疏检出挂在某一行上，而「新建的那一棵」刚被刷新到清单最前：按它的路径精确展开那一行，
    //   不要按「第一个展开箭头」碰运气（刷新之后第一个箭头可能落在当前工作区那张卡上）。
    if (createdOk) {
      // 移动与稀疏检出的按钮 op 是 move-open / sparse-open（vcWorktreesView 的 vcWtFormOpenButtonNode）。
      const moveOpened = await openFirstRowForm(raw, 'move-open', '[data-wt-move-input]', 12000)
      facts['moveOpened:' + spec.id + ':' + skin.id + ':' + width] = moveOpened
      facts['moveProbe:' + spec.id + ':' + skin.id + ':' + width] = await probeRowState(page)
      if (moveOpened) {
        await shot('move')
        const movedTarget = WT_NEW_BASE + '/wt-moved-' + skin.id + '-' + width + '-' + WT_RUN_TAG
        const moved = await saveMove(page, raw, movedTarget)
        facts['moveProbe:' + spec.id + ':' + skin.id + ':' + width] = await probeRowState(page)
        facts['move:' + spec.id + ':' + skin.id + ':' + width] = moved
        if (moved.ok) await shot('moved')
        await softClick(raw, '[data-wt-move-close]')
      }
      // 稀疏检出的面板打开时会先发一次预检，预检回来之前只有一行「读取中」——要等保存键出现再动手。
      const sparseOpened = await openFirstRowForm(raw, 'sparse-open', '[data-wt-sparse-save]', 30000)
      facts['sparseOpened:' + spec.id + ':' + skin.id + ':' + width] = sparseOpened
      if (sparseOpened) {
        await shot('sparse')
        const refused = await saveSparse(page, raw)
        facts['sparse:' + spec.id + ':' + skin.id + ':' + width] = refused
        await shot('sparse-refused')
        await softClick(raw, '[data-wt-sparse-close]')
      }
    }
  }
  if (spec.id === 'changes') {
    if (await softClick(raw, '[data-vc-stash-arrow]')) { await shot('variants'); await softClick(raw, '[data-vc-stash-arrow]') }
  }
  if (spec.id === 'stash') {
    if (await softClick(raw, '[data-vc-stash-row-menu] summary')) { await shot('row-menu'); await softClick(raw, '[data-vc-stash-op="branch"]'); await shot('branch-form') }
    if (await softClick(raw, '[data-vc-stash-clear]')) { await shot('clear-confirm'); await softClick(raw, '[data-vc-stash-confirm-cancel]') }
  }
  facts['actions:' + spec.id + ':' + skin.id + ':' + width] = shots
}

/** 子序列匹配：期望序列是否按序出现在实得序列里；返回缺失项与命中下标。 */
function sequenceOk(actual: readonly string[], expected: readonly string[]): { ok: boolean; missing: string[]; indices: number[] } {
  const indices: number[] = []
  const missing: string[] = []
  let cursor = -1
  for (const want of expected) {
    let found = -1
    for (let i = cursor + 1; i < actual.length; i += 1) {
      if (actual[i].indexOf(want) >= 0) { found = i; break }
    }
    if (found < 0) missing.push(want)
    else { indices.push(found); cursor = found }
  }
  return { ok: missing.length === 0, missing, indices }
}

/** 一批选择器里哪些在页面上找不到（空数组表示都在）。用来证明「这一页真的挂出了自己的入口」。 */
async function missingSelectors(page: PageHandle, selectors: readonly string[]): Promise<string[]> {
  if (selectors.length === 0) return []
  const script = '(function (list) { return list.filter(function (sel) { return document.querySelector(sel) === null }) })(' + JSON.stringify(selectors) + ')'
  const probe = await evaluateThrough<string[]>(page, script)
  return probe.ok ? probe.value : selectors.slice()
}

/** 等一个选择器真的出现在 DOM 里（顶部条的额外入口与齿轮卡都是读数落定后才画的）。 */
async function waitForSelector(raw: RawBrowserPage, selector: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    try {
      const count = await raw.page.locator(selector).count()
      if (count > 0) return true
    } catch (error) { /* 页面正在重挂时 locator 可能短暂失败，继续等 */ }
    await sleep(250)
  }
  return false
}

/** 进子页：先试真点击；不在视口或被遮挡时退回强制点击。 */
async function goToPage(page: PageHandle, raw: RawBrowserPage, spec: { id: string; kind: string }): Promise<{ ok: boolean; detail: string }> {
  const current = await readState(page)
  if (current !== null && current.bodyPage === spec.id) return { ok: true, detail: 'already-there' }
  if (spec.kind === 'tab') {
    const tabSel = '[data-vc-tab="' + spec.id + '"]'
    let clicked = await realClick(raw, tabSel)
    if (!clicked.ok) {
      // 二级页上没有页签条（页头换成了返回键）：先回上一层，再点页签。
      const back = await realClick(raw, '[data-vc-back]')
      if (back.ok) { await sleep(900); clicked = await realClick(raw, tabSel) }
    }
    if (!clicked.ok) clicked = await forceClick(raw, tabSel)
    if (!clicked.ok) return { ok: false, detail: '点页签失败：' + String(clicked.problem) }
    const landed = await waitForBodyPage(page, spec.id, 12000)
    if (landed !== null) return { ok: true, detail: 'navigated' }
    return { ok: false, detail: '没有落到 ' + spec.id }
  }
  if (spec.kind === 'gear-index') {
    // 管理索引就是齿轮按下去的那一屏，没有卡片要点。
    let opened = await realClick(raw, GEAR_BTN)
    if (!opened.ok) opened = await forceClick(raw, GEAR_BTN)
    if (!opened.ok) return { ok: false, detail: '点齿轮失败：' + String(opened.problem) }
    const landedIndex = await waitForBodyPage(page, spec.id, 12000)
    if (landedIndex !== null) return { ok: true, detail: 'navigated' }
    return { ok: false, detail: '没有落到管理索引（期望 ' + spec.id + '）' }
  }
  if (spec.kind === 'link') {
    // 顶部条的额外入口只在二级页上画（一级页签不画，见 vcRealTab 的 !firstLevelTab）：
    // 所以从一级页签出发时先点齿轮进管理索引（那已经是二级页），再点额外入口。
    const firstLevel = ['changes', 'commits', 'worktrees', 'stash']
    const departure = await readState(page)
    if (departure === null || departure.bodyPage === null || firstLevel.indexOf(String(departure.bodyPage)) >= 0) {
      const openedForLink = await realClick(raw, GEAR_BTN)
      if (!openedForLink.ok) await forceClick(raw, GEAR_BTN)
      await sleep(1000)
    }
    const found = await waitForSelector(raw, EXTRA_LINK_PREFIX + spec.id + '"]', 12000)
    if (!found) {
      try { await raw.page.screenshot({ path: path.join(OUT_DIR, 'missing-' + spec.id + '.png') }) } catch (error) { /* 诊断用 */ }
    }
    let clicked = await realClick(raw, EXTRA_LINK_PREFIX + spec.id + '"]')
    if (!clicked.ok) clicked = await forceClick(raw, EXTRA_LINK_PREFIX + spec.id + '"]')
    if (!clicked.ok) return { ok: false, detail: '点额外入口失败：' + String(clicked.problem) }
  } else {
    let opened = await realClick(raw, GEAR_BTN)
    if (!opened.ok) opened = await forceClick(raw, GEAR_BTN)
    if (!opened.ok) return { ok: false, detail: '点齿轮失败：' + String(opened.problem) }
    await sleep(700)
    const card = '[data-vc-gear-item="' + spec.id + '"]'
    await waitForSelector(raw, card, 8000)
    let clicked = await realClick(raw, card)
    if (!clicked.ok) clicked = await forceClick(raw, card)
    if (!clicked.ok) return { ok: false, detail: '点管理索引里的卡失败：' + String(clicked.problem) }
  }
  const landed = await waitForBodyPage(page, spec.id, 12000)
  if (landed !== null) return { ok: true, detail: 'navigated' }
  const back = await realClick(raw, '[data-vc-back]')
  if (back.ok) {
    await sleep(900)
    return goToPage(page, raw, spec)
  }
  const now = await readState(page)
  try { await raw.page.screenshot({ path: path.join(OUT_DIR, 'fail-' + spec.id + '.png') }) } catch (error) { /* 失败路径的截图只为诊断 */ }
  return { ok: false, detail: '没有落到 ' + spec.id + '（当前 ' + String(now === null ? null : now.bodyPage) + '）' }
}

export default defineScenario<ScenarioContext>({
  id: 'vc-pages-1857',
  title: '版本管理二级页：迁移 / 诊断 / 平台 / 变基 / 冲突 / 任务（#1844 #1845）',
  description: '在隔离实例里用真鼠标打开 MattSkills 面板进版本管理，对六个二级页在四档面板宽度与深浅两皮肤下逐档读 DOM 并截图：核对页头、正文区块顺序、无横向溢出、页尾没有能力清单。',
  hooks,
  steps: [
    { id: 'launch', kind: 'launch', title: '起一个装好候选包的隔离 web 实例' },
    {
      id: 'vc-pages',
      kind: 'custom',
      timeoutMs: 2400000,
      title: '逐页 × 四档宽 × 两皮肤截图并读 DOM',
      run: async (context): Promise<ScenarioObservation[]> => {
        const observations: ScenarioObservation[] = []
        const pageResult = await context.primitives.page()
        if (!pageResult.ok) {
          return [observe({ checkId: 'page-open', title: '页面能为这个实例打开', ok: false, status: 'blocked', detail: '拿不到页面句柄：' + pageResult.error.message, expected: '浏览器适配器为运行中的实例打开一个页面', actual: pageResult.error.message, hint: '先确认 verify/profile-1833-headed.ts 与 verify/probe-browser-headed.mjs' })]
        }
        const page = pageResult.value as PageHandle
        const raw = page.page as unknown as RawBrowserPage
        const instance = context.instance
        if (instance === null) {
          return [observe({ checkId: 'instance-alive', title: 'launch 步留下了一个活着的实例', ok: false, status: 'blocked', detail: '页面拿到了，但 context.instance 是空的', expected: 'launch 步跑完后有一个可用的实例句柄', actual: 'context.instance === null' })]
        }
        const facts: Record<string, unknown> = {}
        const save = async (name: string, value: unknown, note: string): Promise<void> => {
          const r = await context.evidence.recordJson(name, value, { note })
          if (r.ok) facts[name + ':path'] = r.value.path
        }
        fs.mkdirSync(OUT_DIR, { recursive: true })

        // 0) 有头适配器与宽窗口是四档宽度的前提（视口 <768 时右侧栏全屏、没有手柄）。
        // 视口宽度决定右栏能拖多宽：本机屏幕在 190% 缩放下只有 1152 CSS px 宽，宿主把右栏
        // 上限卡在视口的一个比例上，于是 460 档就到顶、520 档永远拖不到（实测：460 档时面板
        // 只有 451px）。这里把页面视口设成 1460 CSS px（浏览器原生视口仿真，窗口还是那个有头
        // 窗口），520 档才有余地；不改的话四档里有一档测不了。
        const resize = typeof (raw as any).resize === 'function' ? await (raw as any).resize(1500, 1000) : { ok: false }
        try { await raw.page.setViewportSize({ width: 1460, height: 1000 }) } catch (error) { /* 老适配器没有 Playwright Page 时忽略 */ }
        await sleep(800)
        const size = await page.innerSize()
        const viewport = size.ok ? size.value : { width: 0, height: 0 }
        facts.adapter = { resize: resize.ok, viewport }
        if (!resize.ok || viewport.width < 768) {
          return [observe({ checkId: 'headed-adapter', title: '有头适配器能改真实窗口（四档宽度的前提）', ok: false, status: 'blocked', detail: '改窗结果 ' + JSON.stringify(resize) + '，视口 ' + JSON.stringify(viewport), expected: 'resize 成功且视口宽度 >= 768', actual: 'resize=' + String(resize.ok) + '，视口宽=' + String(viewport.width), hint: '要用 --declaration verify/profile-1833-headed.ts' })]
        }

        // 1) 打开页面，关掉首开弹窗（预览版说明与登录引导都会挡住指针事件）。
        if (raw.goto !== undefined) await raw.goto(instance.record.tokenUrl)
        await sleep(2600)
        const dismissed: any[] = []
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const hit = await page.evaluate<any>(DISMISS_SCRIPT)
          if (!hit.ok || hit.value === null) break
          dismissed.push(hit.value)
          await sleep(600)
        }
        facts.dismissed = dismissed
        if (page.url().indexOf(instance.record.originUrl) !== 0) {
          return [observe({ checkId: 'page-url', title: '页面停在实例源上', ok: false, status: 'blocked', detail: '页面 URL 是 ' + page.url(), expected: 'URL 以 ' + instance.record.originUrl + ' 开头', actual: page.url() })]
        }

        // 1b) 场景自备夹具：hooks 种下的「验证工作区」是给 markdown 后端用的空目录，
        //     版本管理页在它里面读不到任何 git 读数（每个分片都报「这个目录不在任何 git 仓库里」）。
        //     这里就地把它变成一个有初始提交的仓库；#1904 / #1905 还要真行可点，所以再造一条
        //     其它工作树、一条储藏记录、一个已暂存文件与一个未暂存文件。只改这一趟的实例目录，不碰仓库。
        const seededDir = path.join(String((instance.record as any).dir || ''), 'workspace')
        const fixtureDir = String(process.env.DSH_1857_REPO || seededDir)
        const fixture: Record<string, unknown> = { dir: fixtureDir, steps: [] as string[] }
        try {
          const git = function (args: string[]): string { return execFileSync('git', args, { cwd: fixtureDir, encoding: 'utf8' }) }
          const gitQuiet = function (args: string[]): void { execFileSync('git', args, { cwd: fixtureDir, stdio: 'ignore' }) }
          gitQuiet(['init', '-q', '-b', 'main'])
          // 身份写进仓库本地配置：stash 也要造提交，只给 add/commit 挂 -c 的话 stash 会因为
          //   「Author identity unknown」直接失败（实测这一轮就卡在这一步）。
          gitQuiet(['config', 'user.email', 'verify@example.com'])
          gitQuiet(['config', 'user.name', 'verify'])
          ;(fixture.steps as string[]).push('init')
          // 插件的快照缓存目录（.dsh-mattskillsdeck-cache）在宿主运行时会锁着里面的 sqlite-wal，
          //   git 收改动时删不掉它（实测 stash 到一半 fatal）。它本来就不该进仓库，写进 .gitignore。
          fs.writeFileSync(path.join(fixtureDir, '.gitignore'), '.dsh-mattskillsdeck-cache/' + '\n', 'utf8')
          gitQuiet(['add', '-A'])
          ;(fixture.steps as string[]).push('add')
          gitQuiet(['commit', '-qm', '验证夹具：初始提交'])
          ;(fixture.steps as string[]).push('commit')
          const worktreePath = path.join(path.dirname(fixtureDir), 'wt-feature')
          gitQuiet(['worktree', 'add', worktreePath, '-b', 'feature/vc-page'])
          ;(fixture.steps as string[]).push('worktree')
          // 改一个已经提交过的文件：没有已跟踪的改动时 git stash 什么都不收（实测「No local changes to save」），
          //   储藏页就没有记录行可点。
          fs.appendFileSync(path.join(fixtureDir, 'docs', 'agents', 'workspace.yaml'), '\n# 储藏前的改动\n', 'utf8')
          // 用会带回显的那一支：stash 在没有改动时退出码可能是 0 也可能不是（随版本），
          //   真失败时要把 git 自己那句话留在 facts 里，否则只能看到一句「Command failed」。
          git(['stash', 'push', '-m', '验证夹具：一条储藏记录'])
          ;(fixture.steps as string[]).push('stash')
          fs.writeFileSync(path.join(fixtureDir, 'staged.txt'), 'staged\n', 'utf8')
          gitQuiet(['add', 'staged.txt'])
          fs.writeFileSync(path.join(fixtureDir, 'unstaged.txt'), 'unstaged\n', 'utf8')
          ;(fixture.steps as string[]).push('changes')
          fixture.worktrees = git(['worktree', 'list']).trim().split('\n').length
          fixture.stashes = git(['stash', 'list']).trim().split('\n').filter(function (line) { return line.length > 0 }).length
          fixture.status = git(['status', '--porcelain']).trim()
          fixture.ok = true
        } catch (error) {
          fixture.ok = false
          const stderr = (error as any) !== null && typeof error === 'object' ? (error as any).stderr : undefined
          const stdout = (error as any) !== null && typeof error === 'object' ? (error as any).stdout : undefined
          fixture.problem = messageOf(error) + (stderr === undefined ? '' : '；stderr：' + String(stderr).slice(0, 300)) + (stdout === undefined ? '' : '；stdout：' + String(stdout).slice(0, 200))
        }
        facts.fixture = fixture

        // 2) 用 RPC 把夹具目录挂成工作区并建一条会话（版本管理页要有真仓库才有读数）。
        const workspacePath = fixtureDir.replace(/\\/g, '/')
        const ws = await page.evaluate<any>(rpcScript('workspace/create', '{ request: { path: ' + JSON.stringify(workspacePath) + ' } }'))
        let workspaceId: string | null = null
        if (ws.ok) {
          const body: any = (ws.value as any).body
          const value: any = body && body.result ? body.result.value : null
          workspaceId = value && value.workspace && typeof value.workspace.workspaceId === 'string' ? value.workspace.workspaceId : null
        }
        facts.workspaceCreate = { ok: ws.ok, workspaceId }
        if (workspaceId === null) {
          await save('workspace-create.json', facts.workspaceCreate, 'workspace/create 的原始回包摘要')
          return observations.concat([observe({ checkId: 'workspace-open', title: '工作区能在页面里打开', ok: false, status: 'blocked', detail: 'workspace/create 没回 workspaceId', expected: '页面 RPC 建出一个工作区', actual: ws.ok ? '回包里没有 workspaceId' : String((ws as any).error && (ws as any).error.message), hint: '确认隔离 home 与工作区路径' })])
        }
        const se = await page.evaluate<any>(rpcScript('session/create', '{ request: { workspaceId: ' + JSON.stringify(workspaceId) + ' } }'))
        let sessionId: string | null = null
        if (se.ok) {
          const body: any = (se.value as any).body
          const value: any = body && body.result ? body.result.value : null
          sessionId = value && typeof value.sessionId === 'string' ? value.sessionId : null
        }
        facts.sessionCreate = { ok: se.ok, sessionId }
        if (sessionId === null) {
          await save('session-create.json', facts.sessionCreate, 'session/create 的原始回包摘要')
          return observations.concat([observe({ checkId: 'session-open', title: '会话能在页面里打开', ok: false, status: 'blocked', detail: 'session/create 没回 sessionId', expected: '页面 RPC 建出一条会话', actual: se.ok ? '回包里没有 sessionId' : String((se as any).error && (se as any).error.message) })])
        }
        await sleep(3000)

        // 2b) 面板读的是「当前会话」的工作目录：RPC 建完工作区与会话后，还要让宿主切到那条会话，
        //     否则面板仍在原来的工作区上（实测停在仓库根，读到的是仓库自己的改动）。
        //     顶栏「新建会话」会落到刚建的那条会话上（#1858 那一轮已证实）。
        const newSessionClick = await realClick(raw, 'button[aria-label="新建会话"]')
        if (!newSessionClick.ok) await forceClick(raw, 'button[aria-label="新建会话"]')
        facts.newSessionClick = newSessionClick
        await sleep(3500)

        // 3) 真鼠标：打开右侧栏 → 点 MattSkills 入口 → 点「版本管理」页签。
        let sideClick = await realClick(raw, 'button[aria-label="打开右侧边栏"]')
        if (!sideClick.ok) sideClick = await forceClick(raw, 'button[aria-label="打开右侧边栏"]')
        await sleep(1600)
        facts.sidebar = sideClick
        let entryClick = await realClick(raw, PANEL_ENTRY)
        if (!entryClick.ok) entryClick = await forceClick(raw, PANEL_ENTRY)
        await sleep(1400)
        facts.panelEntry = entryClick
        facts.panelReady = await waitForPanelReady(page, 25000)
        // 页签用宿主面板自己的 data-log 选择器（#1858 那一轮已证实它在真机上稳定命中），
        //   data-ink-key 那一枚在有的构建里指到别的按钮上，点得动却什么也没切。
        await waitForSelector(raw, VERSION_TAB_ALT, 15000)
        let tabClick = await realClick(raw, VERSION_TAB_ALT)
        if (!tabClick.ok) tabClick = await realClick(raw, VERSION_TAB)
        if (!tabClick.ok) tabClick = await forceClick(raw, VERSION_TAB_ALT)
        // 面板首屏要先拉一遍读数才会画出壳根：固定睡 2.4 秒在冷缓存下不够（实测这一次就没等到），
        //   改成轮询最多 30 秒，中途隔几次补点一下页签，防止第一次点在骨架上。
        let root = await readState(page)
        for (let attempt = 0; attempt < 60 && (root === null || root.page === null); attempt += 1) {
          await sleep(500)
          if (attempt === 8 || attempt === 20) await realClick(raw, VERSION_TAB_ALT)
          root = await readState(page)
        }
        facts.tabOpen = { tabClick, root: root === null ? null : { page: root.page, width: root.width, skin: root.skin } }
        if (root === null || root.page === null) {
          // 打不开时留一张现场图与面板里的文字：只报「root=null」看不出是点在别的页签上，
          //   还是面板停在了「还没有工作区」的空态。
          try {
            const raw2 = await page.evaluate<any>(READ_STATE_SCRIPT)
            facts.readStateProbe = raw2.ok ? { ok: true, value: raw2.value } : { ok: false, message: raw2.error.message }
            const attrProbe = await page.evaluate<any>('(function () { var r = document.querySelector("[data-vc-shell]"); if (!r) return null; return { page: r.getAttribute("data-vc-page"), width: r.getAttribute("data-vc-width"), skin: r.getAttribute("data-vc-skin"), cls: r.className, html: String(r.outerHTML || "").slice(0, 200) } })()')
            facts.shellAttrs = attrProbe.ok ? attrProbe.value : String((attrProbe as any).error && (attrProbe as any).error.message)
          } catch (error) {
            facts.shellAttrs = messageOf(error)
          }
          try {
            const probe = await page.evaluate<any>('(function () { var body = document.querySelector(".dsws-body"); var tabs = Array.prototype.map.call(document.querySelectorAll("button.dsws-tab"), function (b) { return { log: b.getAttribute("data-log"), text: String(b.innerText || "").slice(0, 20), on: b.getAttribute("aria-selected") } }); var ink = Array.prototype.map.call(document.querySelectorAll("button[data-ink-key]"), function (b) { return b.getAttribute("data-ink-key") }); return { tabs: tabs, ink: ink, text: body === null ? null : String(body.innerText || "").slice(0, 600), shell: document.querySelector("[data-vc-shell]") !== null, liveEmpty: (document.querySelector("#vc-real-root") || {}).getAttribute ? document.querySelector("#vc-real-root").getAttribute("data-vc-live-empty") : null }; })()')
            facts.panelProbe = probe.ok ? probe.value : String((probe as any).error && (probe as any).error.message)
          } catch (error) {
            facts.panelProbe = messageOf(error)
          }
          try {
            const shotPath = path.join(OUT_DIR, 'panel-open-failed.png')
            await raw.page.screenshot({ path: shotPath })
            facts.panelShot = shotPath
          } catch (error) {
            facts.panelShotProblem = messageOf(error)
          }
          await save('panel-open.json', facts, '打开面板与页签的读数')
          return observations.concat([observe({ checkId: 'version-tab-open', title: '用真鼠标能打开 MattSkills 面板并进版本管理页', ok: false, status: 'blocked', detail: '侧栏 ' + JSON.stringify(sideClick) + '，入口 ' + JSON.stringify(entryClick) + '，页签 ' + JSON.stringify(tabClick) + '，页面根 ' + JSON.stringify(root), expected: '版本管理页签打开后页面里有 [data-vc-shell]', actual: 'root=' + JSON.stringify(root), hint: '批次 home 的 profile bundles 里必须有 dsh-mattpocock-skills-deck' })])
        }
        const comboSummaries: any[] = []
        const enabledPages = PAGES.filter(function (p) { return ENABLED_PAGES.indexOf(p.id) >= 0 })
        const enabledSkins = SKINS.filter(function (s) { return ENABLED_SKINS.indexOf(s.id) >= 0 })
        facts.plan = { pages: enabledPages.map(function (p) { return p.id }), widths: ENABLED_WIDTHS, skins: enabledSkins.map(function (s) { return s.id }) }

        // 4) 逐皮肤 → 逐档宽 → 逐页：切肤重挂 → 校准宽度 → 进页 → 读 DOM → 截图。
        for (const skin of enabledSkins) {
          const skinApplied = await page.evaluate<any>(skinScript(skin.dark))
          // 面板盯着 body 的主题属性（vcRealSkinWatchOf），宿主换肤后壳根自己会跟上；先等它跟上，
          //   跟不上才重挂。反过来「先重挂」实测会把壳根的 data-vc-skin 弄丢（#1858 那一轮踩过）。
          let afterSkin = await readState(page)
          for (let attempt = 0; attempt < 20 && (afterSkin === null || afterSkin.skin !== skin.id); attempt += 1) {
            await sleep(400)
            afterSkin = await readState(page)
          }
          let remounted: any = null
          if (afterSkin === null || afterSkin.skin !== skin.id) {
            remounted = await remountVersionControl(raw)
            for (let attempt = 0; attempt < 20 && (afterSkin === null || afterSkin.skin !== skin.id); attempt += 1) {
              await sleep(400)
              afterSkin = await readState(page)
            }
          }
          facts['skin:' + skin.id] = { applied: skinApplied.ok ? skinApplied.value : String((skinApplied as any).error && (skinApplied as any).error.message), remounted, rootSkin: afterSkin === null ? null : afterSkin.skin }
          if (afterSkin === null || afterSkin.skin !== skin.id) {
            observations.push(observe({ checkId: 'skin-' + skin.id, title: '皮肤切到 ' + skin.id + ' 后版本管理页按这套皮肤挂载', ok: false, status: 'blocked', detail: '页面根 data-vc-skin=' + String(afterSkin === null ? null : afterSkin.skin) + '，重挂 ' + JSON.stringify(remounted), expected: 'data-vc-skin 等于 ' + skin.id, actual: String(afterSkin === null ? null : afterSkin.skin) }))
            continue
          }
          for (const width of ENABLED_WIDTHS) {
            const calibrated = await calibrateWidth(page, raw, width)
            const pxAfterCalibration = await readState(page)
            facts['width:' + skin.id + ':' + width] = { calibrated, px: pxAfterCalibration === null ? null : pxAfterCalibration.rootWidthPx, viewport: viewport.width }
            for (const spec of enabledPages) {
              const checkId = 'vc-' + spec.id + '-' + skin.id + '-' + width
              const nav = await goToPage(page, raw, spec)
              const state = nav.ok ? await readState(page) : null
              const shotPath = path.join(OUT_DIR, spec.id + '-' + skin.id + '-' + width + '.png')
              let shot: any = { ok: false, bytes: 0, problem: nav.ok ? null : nav.detail }
              if (nav.ok) shot = await capturePanel(page, raw, shotPath)
              // 动作截图只跑一遍（460 宽深色）：表单与菜单的形状与宽度档无关，多拍只是重复。
              if (nav.ok && ACTIONS && width === 460 && (spec.id === 'worktrees' || spec.id === 'stash' || spec.id === 'changes')) {
                await captureActions(page, raw, spec, skin, width, OUT_DIR, facts)
              }
              const sections = state === null ? [] : state.sections
              const seq = sequenceOk(sections, spec.sections)
              const widthOk = state !== null && state.width === String(width)
              const pageOk = state !== null && state.bodyPage === spec.id
              // 一级页签按原型不画页头，判据换成「这一枚页签处于选中态」；二级页仍按页头标题判。
              const titleOk = state === null
                ? false
                : (spec.kind === 'tab'
                  ? state.selectedTab === spec.id
                  : state.headTitle !== null && state.headTitle.indexOf(spec.title) >= 0)
              // 每页各点一条本页特有的入口：页签能选中不代表这一页真的挂出了正文。
              const needMissing = state === null ? [] : await missingSelectors(page, spec.need === undefined ? [] : spec.need)
              const overflow = state === null ? true : (state.docScrollWidth > state.innerWidth + 1 || state.maxRight > state.rootRight + 1)
              const capFree = state !== null && state.capPrimaries === 0
              const foldFree = state === null ? true : state.folds.every(function (f) { return !/能力|capabilit/i.test(f) })
              // #1883：分支与标签页多一条判据——每条分支行的第三行必须带「时间 · 主题」的中间点，
              // 且主题不是空串（主题来自宿主新追加的 subject 字段）。
              const branchSubs = state === null ? [] : state.branchSubs
              const branchOk = spec.branchRow !== true || (branchSubs.length > 0 && branchSubs.every(function (line) { return line.indexOf(' · ') > 0 && line.split(' · ').slice(1).join(' · ').trim() !== '' }))
              const ok = nav.ok && widthOk && pageOk && titleOk && needMissing.length === 0 && seq.ok && !overflow && capFree && foldFree && shot.ok && branchOk
              const detail = [
                '页 ' + String(state === null ? null : state.bodyPage) + '（期望 ' + spec.id + '）',
                '宽 ' + String(state === null ? null : state.width) + '（期望 ' + width + '）',
                '页头 ' + JSON.stringify(state === null ? null : state.headTitle),
                '选中页签 ' + JSON.stringify(state === null ? null : state.selectedTab),
                '本页入口缺 ' + JSON.stringify(needMissing),
                '区块 ' + JSON.stringify(sections),
                '缺 ' + JSON.stringify(seq.missing),
                '溢出 ' + String(overflow) + '（文档 ' + String(state === null ? null : state.docScrollWidth) + ' ≤ 视口 ' + String(state === null ? null : state.innerWidth) + '，后代右界 ' + String(state === null ? null : Math.round(state.maxRight)) + ' ≤ 根右界 ' + String(state === null ? null : Math.round(state.rootRight)) + '）',
                '页尾能力清单 ' + String(capFree ? '无' : '有 ' + String(state === null ? 0 : state.capPrimaries) + ' 条主入口'),
                '截图 ' + (shot.ok ? String(shot.bytes) + ' 字节' : String(shot.problem)),
                spec.branchRow === true ? '分支行第三行 ' + JSON.stringify(branchSubs) : '',
              ].join('；')
              comboSummaries.push({ checkId, page: spec.id, skin: skin.id, width, ok, detail, nav: nav.detail, sections, missing: seq.missing, shot: shotPath })
              await save(checkId + '.json', { checkId, page: spec.id, skin: skin.id, width, ok, nav, state, sequence: seq, shot }, '一档组合的完整读数')
              observations.push(observe({
                checkId,
                title: spec.title + ' · ' + width + ' 宽 · ' + (skin.dark ? '深色' : '浅色') + '：区块顺序、宽度、页头与无溢出',
                ok,
                detail,
                expected: (spec.kind === 'tab' ? '页签「' + spec.title + '」处于选中态' : '页头含「' + spec.title + '」') + '；正文区块按序包含 ' + JSON.stringify(spec.sections) + '；本页入口都在（' + (spec.need === undefined ? '' : spec.need.join('、')) + '）；无横向溢出；页尾没有能力清单',
                actual: detail,
                hint: nav.ok ? '看同目录的 ' + checkId + '.json 与截图' : '导航失败：' + nav.detail,
              }))
            }
          }
        }
        facts.combos = comboSummaries
        await save('vc-1857-facts.json', facts, '整趟的读数与组合清单')
        try { fs.writeFileSync(path.join(OUT_DIR, 'vc-1857-facts.json'), JSON.stringify(facts, null, 2)) } catch (error) { facts.factsWriteProblem = messageOf(error) }
        return observations
      },
    },
    { id: 'stop', kind: 'stop', title: '停掉实例' },
  ],
})
