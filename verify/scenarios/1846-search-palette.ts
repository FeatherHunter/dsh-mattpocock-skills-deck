// verify/scenarios/1846-search-palette.ts —— 真机验证 #1846：搜索页收口、命令面板遮罩、分支浮层（列出分支并就地切换）。
//
// 这一份验四件事（对应票面验收）：
//   1) 命令面板按遮罩呈现：Esc 关闭、点遮罩关闭、关闭后焦点回入口；
//   2) 搜索页是独立版式、只有一个输入框；空查询与无命中各有对应呈现；结果按来源分组；
//   3) 选中一条结果只跳到那条能力的入口并高亮，不执行任何动作；
//   4) 分支浮层列出首屏读到的本地分支（当前分支带标记且不可点），点一条按 4.3 的既有通路真的切过去
//      （预检 → 工作区有未提交改动时停确认卡 → 凭票执行 → 结果贴回浮层），其余四个动作仍各自指路。
//
// 宽度与皮肤早先只由源码闭包的并排对照图覆盖（assets/acceptance/2026-11-05-1846）。2026-11-05 任务二起
// 这一份真机场景补上有头能力：一种皮肤起一个实例（启动前把偏好写进隔离 home），宽度在同一次会话里
// 拖右栏把手标定——面板宽是宿主的布局偏好，只有真鼠标拖 div[data-side="rightbar"] 才会变。
// 维护者当天把待验范围收窄到 380 与 520 两档，也就是 380/520 × 深/浅共四组；用 DSH_1846_WIDTHS
// 与 DSH_1846_SKIN 指定，不设时默认就是这两档宽、皮肤由实例自己带（锁定前会如实记一条 fail）。
// 跑法（仓库根，DSH_HOME 指向批次 home；两轮各一个新实例）：
//   $env:DSH_1846_SKIN='dark';  $env:DSH_1846_WIDTHS='380,520'
//   node --import ./scripts/ts-hook.mts node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js run verify/scenarios/1846-search-palette.ts --profile web --declaration verify/profile-1833-headed.ts --work-root <工作根> --json
//   $env:DSH_1846_SKIN='light'; 再跑一次同样的命令。
//
// 进入会话视图的路径与 verify/scenarios/1843-vc-pages.ts 同源：欢迎屏的工作区选择器优先，
// 失败再点侧栏「新建会话」。夹具仓库在 prepareHome 里现建，不碰 ~/.dsh 与仓库本身。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { PageHandle, ScenarioContext, ScenarioHooks, ScenarioLaunchHookInfo, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { seedWorkspaceRegistry } from '../../scripts/real-machine/lib/workspace-seed.mts'

// ---- #1846 任务二：四组（380 / 520 宽 × 深 / 浅两皮肤）的宽度与皮肤标定 ----
// 皮肤只能在宿主启动前锁进隔离 home（运行中重载会回退），所以一次实例只验一种皮肤：
// DSH_1846_SKIN=dark 跑一轮（380 与 520 两档），再以 light 跑一轮。
// 宽度不靠窗口反解：面板档位由右栏那把把手决定，必须用真鼠标拖。
const NEWLINE = String.fromCharCode(10)
type Skin = 'dark' | 'light'
const LOCKED_SKIN: Skin | '' = process.env.DSH_1846_SKIN === 'dark' || process.env.DSH_1846_SKIN === 'light'
  ? (process.env.DSH_1846_SKIN as Skin)
  : ''
const WIDTHS: number[] = (() => {
  const parsed = String(process.env.DSH_1846_WIDTHS || '380,520')
    .split(',')
    .map((raw) => Number(raw.trim()))
    .filter((value) => Number.isFinite(value) && value >= 300 && value <= 520)
  // 写错了就不静默跳过：回落到维护者定下的两档，结论里照样会写出实际去的是哪两档。
  return parsed.length > 0 ? parsed : [380, 520]
})()
const WINDOW_HEIGHT = Number(process.env.DSH_1846_WINDOW_HEIGHT || '900')

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

interface RawBrowserPage {
  goto?: (url: string) => Promise<unknown>
  click?: (selector: string) => Promise<Result<unknown>>
  press?: (key: string) => Promise<Result<unknown>>
  /** 有头适配器把原始 Playwright 页面挂在 page 上：拖右栏把手要真指针事件，el.click() 拖不动。 */
  page?: unknown
  /** 有头适配器按外框尺寸改窗口（走 CDP）；无头适配器没有这个方法。 */
  resize?: (width: number, height: number) => Promise<Result<unknown>>
}

const SEL = {
  vcRoot: '#vc-real-root',
  searchEntry: '[data-vc-search-entry]',
  paletteBackdrop: '[data-vc-palette-backdrop]',
  paletteInput: '[data-vc-palette-input]',
  paletteRow: (id: string) => '[data-vc-palette-row="' + id + '"]',
  searchPage: '[data-vc-search-page]',
  searchInput: '[data-vc-search-input]',
  branchBtn: '[data-vc-branch-btn]',
  branchOverlay: '[data-vc-branch-overlay]',
  branchAction: (id: string) => '[data-vc-branch-overlay] [data-vc-branch-action="' + id + '"]',
  branchPick: (name: string) => '[data-vc-branch-overlay] [data-vc-branch-pick="' + name + '"]',
  branchCurrent: '[data-vc-branch-overlay] [data-vc-branch-current]',
  branchConfirm: '[data-vc-branch-overlay] [data-vc-confirm]',
  branchResult: '[data-vc-branch-overlay] [data-vc-result]',
  branchConfirmGo: '[data-vc-branch-overlay] .vcs-confirm-go',
  branchClose: '[data-vc-branch-close]',
  tabChanges: '[data-vc-tab="changes"]',
  back: '[data-vc-back]',
}

/** 分支浮层四个指路动作的落点：与 vcRealShell.ts 的 VC_REAL_BRANCH_LANDING 一一对应。 */
const LANDINGS: ReadonlyArray<{ action: string; page: string; selector: string }> = [
  { action: 'create', page: 'branch-tags', selector: '[data-vc-branch-forms] [data-vc-branch-action="create"]' },
  { action: 'delete', page: 'branch-tags', selector: '[data-vc-branch-row]:not([data-vc-branch-is-current]) [data-vc-branch-menu] [data-vc-branch-action="delete"]' },
  { action: 'merge', page: 'conflicts', selector: '[data-vc-conflicts-op="merge"]' },
  { action: 'rebase', page: 'rebase', selector: '[data-vc-rebase-op="rebase-onto"]' },
]

const BODY_DARK_SCRIPT = 'document.body.hasAttribute("data-ds-dark-theme")'
const SEL_CLOSE = 'button[aria-label="关闭"]'
const SEL_WORKSPACE = 'button[aria-label="选择工作区"]'
const SEL_SIDEBAR = 'button[aria-label="打开右侧边栏"]'
const SEL_GUIDE = 'button[data-sidebar-right-guide-entry="dsh-mattpocock-skills-deck:deck-map"]'
const SEL_VC_TAB = 'button.dsws-tab[data-log="panel.tab.versioncontrol"]'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function observe(input: { checkId: string; title: string; ok: boolean; detail: string; expected?: string; actual?: string; hint?: string; evidence?: readonly string[]; status?: 'pass' | 'fail' | 'skip' | 'blocked' }): ScenarioObservation {
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
  }
}

function boolScript(selector: string): string {
  return '!!document.querySelector(' + JSON.stringify(selector) + ')'
}

function focusScript(selector: string): string {
  return '(function () { var el = document.querySelector(' + JSON.stringify(selector) + '); return !!el && document.activeElement === el })()'
}

/** 按文字找元素再点（选择器口径变了时的兜底；例如右侧栏页签只有文字稳定）。 */
function clickTextScript(selector: string, text: string): string {
  return [
    '(function () {',
    '  var items = Array.prototype.slice.call(document.querySelectorAll(' + JSON.stringify(selector) + '));',
    '  for (var i = 0; i < items.length; i += 1) {',
    '    if (String(items[i].innerText || "").indexOf(' + JSON.stringify(text) + ') >= 0) { items[i].click(); return { ok: true, text: String(items[i].innerText || "").trim().slice(0, 20) }; }',
    '  }',
    '  return { ok: false, reason: "not-found" };',
    '})()',
  ].join('\n')
}

function clickScript(selector: string): string {
  return [
    '(function () {',
    '  var el = document.querySelector(' + JSON.stringify(selector) + ');',
    '  if (!el) return { ok: false, reason: "not-found" };',
    '  el.scrollIntoView({ block: "center" });',
    '  el.click();',
    '  return { ok: true, tag: el.tagName };',
    '})()',
  ].join('\n')
}

/** 点遮罩本身：Playwright 只能点元素中心，而面板盖住了遮罩中心，所以在遮罩四角内边找一个
 *  elementFromPoint 正好命中遮罩自己的位置，把点击派发到遮罩上（坐标与命中点都是真的）。 */
function clickBackdropScript(): string {
  return [
    '(function () {',
    '  var el = document.querySelector(' + JSON.stringify(SEL.paletteBackdrop) + ');',
    '  if (!el) return { ok: false, reason: "not-found" };',
    '  var r = el.getBoundingClientRect();',
    '  var pts = [',
    '    { x: r.left + 2, y: r.top + 2 }, { x: r.right - 2, y: r.top + 2 },',
    '    { x: r.left + 2, y: r.bottom - 2 }, { x: r.right - 2, y: r.bottom - 2 },',
    '  ];',
    '  for (var i = 0; i < pts.length; i += 1) {',
    '    var hit = document.elementFromPoint(pts[i].x, pts[i].y);',
    '    if (hit === el) {',
    '      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: pts[i].x, clientY: pts[i].y, view: window }));',
    '      return { ok: true, x: Math.round(pts[i].x), y: Math.round(pts[i].y) };',
    '    }',
    '  }',
    '  return { ok: false, reason: "backdrop-covered" };',
    '})()',
  ].join('\n')
}

function typeScript(selector: string, value: string): string {
  return [
    '(function () {',
    '  var el = document.querySelector(' + JSON.stringify(selector) + ');',
    '  if (!el) return { ok: false, reason: "not-found" };',
    '  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;',
    '  setter.call(el, ' + JSON.stringify(value) + ');',
    '  el.dispatchEvent(new Event("input", { bubbles: true }));',
    '  el.focus();',
    '  return { ok: true, value: el.value };',
    '})()',
  ].join('\n')
}

const STATE_SCRIPT = [
  '(function () {',
  '  function attr(el, name) { return el ? el.getAttribute(name) : null; }',
  '  function ids(selector, name) {',
  '    return Array.prototype.map.call(document.querySelectorAll(selector), function (el) { return el.getAttribute(name) });',
  '  }',
  '  var root = document.querySelector("' + SEL.vcRoot + '") || document.querySelector("[data-vc-root]");',
  '  var shell = document.querySelector("[data-vc-shell]");',
  '  var search = document.querySelector("' + SEL.searchPage + '");',
  '  var groups = Array.prototype.map.call(document.querySelectorAll("[data-vc-search-group]"), function (g) {',
  '    return { page: g.getAttribute("data-vc-search-group"), rows: Array.prototype.map.call(g.querySelectorAll("[data-vc-search-row]"), function (r) { return r.getAttribute("data-vc-search-row") }) };',
  '  });',
  '  var overlay = document.querySelector("' + SEL.branchOverlay + '");',
  '  var pointer = overlay ? overlay.querySelector(".vcs-branch-pointer") : null;',
  '  function textOf(el) { return el ? String(el.textContent || "").replace(/\\s+/g, " ").trim() : null; }',
  '  function overflowOf(el) { return el ? el.scrollWidth - el.clientWidth : null; }',
  '  var active = document.activeElement;',
  '  return {',
  '    url: location.href, title: document.title,',
  '    viewport: { w: window.innerWidth, h: window.innerHeight },',
  '    root: root ? { page: attr(root, "data-vc-live-page"), depth: attr(root, "data-vc-live-depth") } : null,',
  '    shell: shell ? { page: attr(shell, "data-vc-page"), width: attr(shell, "data-vc-width"), skin: attr(shell, "data-vc-skin"), overflowX: shell.scrollWidth - shell.clientWidth } : null,',
  '    palette: { backdrop: !!document.querySelector("' + SEL.paletteBackdrop + '"), input: !!document.querySelector("' + SEL.paletteInput + '"), rows: ids("[data-vc-palette-row]", "data-vc-palette-row"), overflowX: overflowOf(document.querySelector("[data-vc-palette]")) },',
  '    search: {',
  '      present: !!search,',
  '      inputs: document.querySelectorAll("' + SEL.searchInput + '").length,',
  '      paletteInputs: document.querySelectorAll("' + SEL.paletteInput + '").length,',
  '      empty: attr(document.querySelector("[data-vc-search-empty]"), "data-vc-search-empty"),',
  '      count: attr(document.querySelector("[data-vc-search-count]"), "data-vc-search-count"),',
  '      rows: ids("[data-vc-search-row]", "data-vc-search-row"),',
  '      groups: groups,',
  '      more: !!document.querySelector("[data-vc-search-more]"),',
  '      overflowX: overflowOf(search),',
  '    },',
  '    branch: { overlay: !!overlay, actions: ids("' + SEL.branchOverlay + ' [data-vc-branch-action]", "data-vc-branch-action"), rows: ids("' + SEL.branchOverlay + ' [data-vc-branch-pick]", "data-vc-branch-pick"), current: attr(document.querySelector("' + SEL.branchCurrent + '"), "data-vc-branch-pick"), confirm: !!document.querySelector("' + SEL.branchConfirm + '"), result: attr(document.querySelector("' + SEL.branchResult + '"), "data-vc-result"), close: !!document.querySelector("' + SEL.branchClose + '"), pointer: textOf(pointer), overflowX: overflowOf(overlay) },',
  '    focus: { tag: active ? active.tagName : null, searchEntry: active === document.querySelector("' + SEL.searchEntry + '"), paletteInput: active === document.querySelector("' + SEL.paletteInput + '"), text: active ? String(active.innerText || active.value || "").replace(/\\s+/g, " ").trim().slice(0, 40) : null },',
  '  };',
  '})()',
].join('\n')

// 夹具仓库的绝对路径：hooks 里现建，verify 步里要用（第二轮切换前在它里面放一个未跟踪文件，
// 让预检判成 warn，确认卡才会出现）。
let fixtureRepo = ''

// 夹具：实例目录下的一个真 git 仓库（一个提交、一个 dev 分支、一个 v1 标签），
// 让分支板/冲突/变基这些页面有真实数据可画。
function makeGitFixture(dir: string): string {
  const repo = path.join(dir, 'workspace-git')
  fs.mkdirSync(repo, { recursive: true })
  const git = (args: string[]): void => {
    const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error('夹具 git 命令失败：git ' + args.join(' ') + ' → ' + String(r.stderr || r.stdout))
  }
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', '1846 验证机器人'])
  git(['config', 'user.email', 'verify-1846@example.invalid'])
  fs.writeFileSync(path.join(repo, 'README.md'), '# 1846 真机夹具\n\n这个仓库由 verify/scenarios/1846-search-palette.ts 现建，只用于验证。\n', 'utf8')
  git(['add', '-A'])
  git(['commit', '-q', '-m', '初始提交：1846 真机夹具'])
  git(['branch', 'dev'])
  git(['tag', 'v1'])
  fixtureRepo = repo
  return repo
}

const hooks: ScenarioHooks<ScenarioContext> = {
  prepareHome(_context: ScenarioContext, info: ScenarioLaunchHookInfo) {
    // 皮肤必须在宿主起来之前写进隔离 home：运行中重载会回退（#1858 记录过）。
    // 没锁皮肤时什么都不写，由实例自己的主题决定；上面那条 width/skin 检查会如实说明。
    if (LOCKED_SKIN !== '') console.log('[1846] ' + setHomeThemePreference(info.home, LOCKED_SKIN))
    const repo = makeGitFixture(info.dir)
    const previous = process.env.DSH_VERIFY_WORK_ROOT
    process.env.DSH_VERIFY_WORK_ROOT = info.dir
    try {
      const seeded = seedWorkspaceRegistry(info.home, [{ path: repo, title: '1846 搜索夹具仓库' }], { defaultPath: repo })
      console.log('[1846] 已种工作区：' + seeded.registryPath + ' → ' + repo)
    } finally {
      if (previous === undefined) delete process.env.DSH_VERIFY_WORK_ROOT
      else process.env.DSH_VERIFY_WORK_ROOT = previous
    }
  },
}

async function evaluateValue<T>(page: PageHandle, script: string): Promise<T | null> {
  try {
    const r = await page.evaluate<T>(script)
    return r.ok ? r.value : null
  } catch {
    return null
  }
}

async function exists(page: PageHandle, selector: string): Promise<boolean> {
  return (await evaluateValue<boolean>(page, boolScript(selector))) === true
}

async function waitFor(page: PageHandle, script: string, tries = 40, gapMs = 200): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    if ((await evaluateValue<boolean>(page, script)) === true) return true
    await sleep(gapMs)
  }
  return false
}

async function realClick(page: PageHandle, raw: RawBrowserPage, selector: string): Promise<boolean> {
  if (raw.click !== undefined) {
    const r = await raw.click(selector)
    if (r.ok) return true
  }
  const fallback = await evaluateValue<{ ok?: boolean }>(page, clickScript(selector))
  return fallback !== null && fallback.ok === true
}

async function realPress(raw: RawBrowserPage, key: string): Promise<void> {
  if (raw.press !== undefined) await raw.press(key)
}

// ---- 进主视图：先经页面自己的 RPC 建好工作区与会话，再点宿主的「新建会话」 ----
// 2026-11-05 的有头实例上，欢迎屏只在左栏列出了已种的工作区，中间还停在「选择一个工作区开始」；
// 原场景只点欢迎屏的工作区菜单，那个菜单没有出现，后面的右侧栏与页签也就都没得点。
// 改用页面自己调的那组接口（与 1858 场景同源）把工作区与会话建出来，再点宿主给的入口；
// 原来那套菜单路径保留作兜底。
interface RpcProbe {
  status: number
  body: unknown
  text: string
}

function rpcScript(method: string, argsExpression: string): string {
  return [
    '(async function () {',
    '  var rpcId = globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());',
    '  var body = { type: "client-request", rpcId: rpcId, method: ' + JSON.stringify(method) + ', payload: { args: ' + argsExpression + ' } };',
    '  var response = await fetch("/api/" + ' + JSON.stringify(method) + ', {',
    '    method: "POST",',
    '    headers: { "content-type": "application/json" },',
    '    body: JSON.stringify(body),',
    '  });',
    '  var text = await response.text();',
    '  var parsed = null;',
    '  try { parsed = JSON.parse(text); } catch (error) { parsed = null; }',
    '  return { status: response.status, body: parsed, text: text.slice(0, 1500) };',
    '})()',
  ].join(NEWLINE)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function rpcValueOf(probe: RpcProbe): Record<string, unknown> | null {
  const result = asRecord(asRecord(probe.body)?.result)
  return asRecord(result?.value)
}

function findIdIn(value: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (value === null) return null
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  for (const nestedKey of ['workspace', 'session', 'request']) {
    const found = findIdIn(asRecord(value[nestedKey]), keys)
    if (found !== null) return found
  }
  return null
}

function sessionRowClickScript(): string {
  return [
    '(function () {',
    '  var rows = Array.prototype.slice.call(document.querySelectorAll("[data-row-key]"));',
    '  for (var i = 0; i < rows.length; i += 1) {',
    '    var key = String(rows[i].getAttribute("data-row-key") || "");',
    '    if (key.indexOf("session:") === 0) { rows[i].scrollIntoView({ block: "center" }); rows[i].click(); return { ok: true, key: key }; }',
    '  }',
    '  return { ok: false, count: rows.length };',
    '})()',
  ].join(NEWLINE)
}

interface MainViewResult {
  readonly ok: boolean
  readonly strategy: string
  readonly detail: string
  readonly facts: Record<string, unknown>
}

async function openMainView(page: PageHandle, raw: RawBrowserPage, tokenUrl: string, repoPath: string): Promise<MainViewResult> {
  const facts: Record<string, unknown> = {}
  if (await exists(page, SEL_SIDEBAR)) return { ok: true, strategy: 'already-main', detail: '页面已经在主视图（右侧边栏按钮存在）', facts: facts }
  const repoUrlPath = repoPath.split(String.fromCharCode(92)).join('/')
  const workspaceProbe = await evaluateValue<RpcProbe>(page, rpcScript('workspace/create', '{ request: { path: ' + JSON.stringify(repoUrlPath) + ' } }'))
  const workspaceId = workspaceProbe === null ? null : findIdIn(rpcValueOf(workspaceProbe), ['workspaceId'])
  facts.workspaceCreate = { status: workspaceProbe === null ? null : workspaceProbe.status, workspaceId: workspaceId, text: workspaceProbe === null ? null : workspaceProbe.text }
  let sessionId: string | null = null
  if (workspaceId !== null) {
    const sessionProbe = await evaluateValue<RpcProbe>(page, rpcScript('session/create', '{ request: { workspaceId: ' + JSON.stringify(workspaceId) + ' } }'))
    sessionId = sessionProbe === null ? null : findIdIn(rpcValueOf(sessionProbe), ['sessionId'])
    facts.sessionCreate = { status: sessionProbe === null ? null : sessionProbe.status, sessionId: sessionId, text: sessionProbe === null ? null : sessionProbe.text }
  }
  await sleep(1200)
  if (await exists(page, 'button[aria-label="新建会话"]')) {
    await realClick(page, raw, 'button[aria-label="新建会话"]')
    await sleep(3500)
  }
  if (await exists(page, SEL_SIDEBAR)) return { ok: true, strategy: 'rpc-then-new-session', detail: '经页面接口建好工作区与会话后点「新建会话」进入主视图', facts: facts }
  // 兜底一：欢迎屏的工作区菜单（11-03 那一版走的是这条）。
  if (await exists(page, SEL_WORKSPACE)) {
    await realClick(page, raw, SEL_WORKSPACE)
    await sleep(900)
    if (await waitFor(page, boolScript('[role=menuitem]'), 20, 200)) {
      await realClick(page, raw, '[role=menuitem]')
      await sleep(3500)
    }
  }
  if (await exists(page, SEL_SIDEBAR)) return { ok: true, strategy: 'hero-menu', detail: '从欢迎屏工作区菜单进入主视图', facts: facts }
  // 兜底二：刷新后用左栏的会话行进入。
  if (raw.goto !== undefined) await raw.goto(tokenUrl)
  await sleep(4500)
  if (await exists(page, 'button[aria-label="打开侧边栏"]')) {
    await realClick(page, raw, 'button[aria-label="打开侧边栏"]')
    await sleep(900)
  }
  facts.sessionRow = await evaluateValue<{ ok?: boolean; key?: string }>(page, sessionRowClickScript())
  await sleep(3000)
  if (await exists(page, SEL_SIDEBAR)) return { ok: true, strategy: 'reload-session-row', detail: '刷新后从左栏会话行进入主视图', facts: facts }
  return { ok: false, strategy: 'none', detail: '三条入口都没能进主视图（右侧边栏按钮始终不存在）', facts: facts }
}

interface SkinSwitchResult {
  readonly ok: boolean
  readonly via: string
  readonly detail: string
  readonly facts: Record<string, unknown>
}

/** 只改页面表现的主题属性：设置接口没生效时兜底。插件壳根的皮肤跟着这个属性走（#1860 D15 实测过）。 */
function bodySkinScriptOf(skin: Skin): string {
  return [
    '(function () {',
    '  var b = document.body;',
    '  if (!b) return null;',
    skin === 'dark' ? '  b.setAttribute("data-ds-dark-theme", "");' : '  b.removeAttribute("data-ds-dark-theme");',
    '  return ' + JSON.stringify(skin) + ';',
    '})()',
  ].join(NEWLINE)
}

/** 把宿主皮肤切到本轮要验的那一种。
 *  先试隔离 home 里的偏好（prepareHome 写的那一条）——宿主今天启动时会把它按设置存储改回来，
 *  所以还要走宿主自己的设置接口；接口也没切成时才退回只改 body 属性，并在结论里如实写明走了哪条路。 */
async function ensureSkin(page: PageHandle, skin: Skin): Promise<SkinSwitchResult> {
  const facts: Record<string, unknown> = {}
  const wantDark = skin === 'dark'
  const darkNow = async (): Promise<boolean | null> => {
    const value = await evaluateValue<boolean>(page, BODY_DARK_SCRIPT)
    return typeof value === 'boolean' ? value : null
  }
  const before = await darkNow()
  facts.bodyDarkBefore = before
  if (before === wantDark) {
    return { ok: true, via: 'locked-home', detail: '宿主启动时已经采用隔离 home 里的 ' + skin + ' 偏好', facts: facts }
  }
  // settings/mutate 的 args 必须恰好是一个普通对象 { ns, ops }；传数组会被网关拒（#1843 记录过）。
  const args = JSON.stringify({ ns: 'ui-theme', ops: [{ op: 'set', path: ['preference'], value: skin }] })
  const probe = await evaluateValue<RpcProbe>(page, rpcScript('settings/mutate', args))
  facts.settingsMutate = probe === null ? null : { status: probe.status, text: probe.text }
  let flipped = false
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await darkNow()) === wantDark) {
      flipped = true
      break
    }
    await sleep(400)
  }
  facts.bodyDarkFlipped = flipped
  let via = 'settings'
  if (!flipped) {
    // 兜底只改页面表现，不动设置；结论里 via 会写成 body-attribute，读证据的人一眼能分出差别。
    const attribute = await evaluateValue<string>(page, bodySkinScriptOf(skin))
    facts.bodyAttribute = attribute
    via = 'body-attribute'
  }
  // 宿主回执写 applies=live：偏好在当前页面就地生效，不需要、也不能重开页面——实测重开一次
  // 页面会退回启动时的深色（2026-11-05 浅色那一轮，body 的深色属性 true → false → true 就是这么来的）。
  await sleep(800)
  const after = await darkNow()
  return {
    ok: after === wantDark,
    via: via,
    detail: '皮肤 ' + skin + ' 经 ' + via + ' 生效；body[data-ds-dark-theme] ' + String(before) + ' → ' + String(after),
    facts: facts,
  }
}

async function readState(page: PageHandle): Promise<Record<string, any> | null> {
  return evaluateValue<Record<string, any>>(page, STATE_SCRIPT)
}

// ---- 皮肤的锁：启动前改隔离 home 里 ui-theme 的偏好 ----
// 这个文件是宿主每次启动都会读的补丁层；只改这个插件段的 preference，别的东西一个字不动。
// 找不到 ui-theme 段就如实返回一句话，让场景把「没锁上」写进结论，而不是假装锁上了。
function setHomeThemePreference(homeDir: string, skin: Skin): string {
  const patchPath = path.join(homeDir, 'profiles', 'web', 'cordis.patch.yml')
  if (!fs.existsSync(patchPath)) return '没有找到主题设置文件 ' + patchPath
  const raw = fs.readFileSync(patchPath, 'utf8')
  const lines = raw.split(NEWLINE)
  const nameIndex = lines.findIndex((line) => line.indexOf('@deepseek-ai/dsh-client-ui-theme') >= 0)
  if (nameIndex < 0) return '主题设置文件里没有 ui-theme 段，保持默认皮肤'
  let end = nameIndex + 1
  while (end < lines.length && lines[end].indexOf('- ') !== 0) end += 1
  let target = -1
  for (let index = nameIndex + 1; index < end; index += 1) {
    if (lines[index].trim().indexOf('preference:') === 0) {
      target = index
      break
    }
  }
  if (target >= 0) {
    const existing = lines[target]
    lines[target] = existing.slice(0, existing.indexOf('preference:')) + 'preference: ' + skin
  } else {
    lines.splice(end, 0, '    preference: ' + skin)
  }
  fs.writeFileSync(patchPath, lines.join(NEWLINE), 'utf8')
  return '已把 ' + patchPath + ' 的 ui-theme.preference 改成 ' + skin
}

// ---- 右栏把手拖拽：把面板档位拖到目标宽 ----
// 面板宽是宿主的右栏布局偏好，只有真鼠标按住 div[data-side="rightbar"] 横向拖才会变；
// 拖完读壳根的 data-vc-width 判定（插件按最近档归档，不要求像素级）。
interface MouseLike {
  move: (x: number, y: number, options?: { steps?: number }) => Promise<void>
  down: () => Promise<void>
  up: () => Promise<void>
}

interface PlaywrightPageLike {
  mouse: MouseLike
}

/** 有头适配器把原始 Playwright 页面挂在句柄的 page 字段上；无头适配器没有，拖不动。 */
function playwrightPageOf(raw: RawBrowserPage): PlaywrightPageLike | null {
  const candidate = raw.page
  if (candidate === null || candidate === undefined || typeof candidate !== 'object') return null
  const mouse = (candidate as { mouse?: unknown }).mouse
  if (mouse === null || mouse === undefined || typeof mouse !== 'object') return null
  return candidate as PlaywrightPageLike
}

interface HandleRect {
  ok: boolean
  reason?: string
  x: number
  y: number
  innerW: number
}

function handleRectScript(): string {
  return [
    '(function () {',
    '  var el = document.querySelector(\'[data-side="rightbar"]\');',
    '  if (!el) return { ok: false, reason: "no-rightbar-handle" };',
    '  var rect = el.getBoundingClientRect();',
    '  return { ok: true, x: rect.left + rect.width / 2, y: Math.max(80, Math.min(window.innerHeight - 80, rect.top + rect.height / 2)), innerW: window.innerWidth };',
    '})()',
  ].join(NEWLINE)
}

interface WidthCalibration {
  readonly ok: boolean
  readonly detail: string
  readonly reached: string | null
  readonly rounds: number
  readonly trace: readonly string[]
}

/** 先把窗口拉够宽（右栏可拖范围是 [300, 视口×0.7]，宽屏才放得下两档目标宽）。 */
async function ensureWideWindow(page: PageHandle, raw: RawBrowserPage): Promise<{ ok: boolean; detail: string; facts: Record<string, unknown> }> {
  const facts: Record<string, unknown> = {}
  if (typeof raw.resize !== 'function') {
    facts.resize = 'missing'
    return { ok: false, detail: '浏览器适配器没有 resize()：保留当前窗口宽，宽度标定可能拖不到目标档', facts }
  }
  const inner = await page.innerSize()
  const outer = await page.outerSize()
  const innerW = inner.ok ? inner.value.width : 0
  const outerW = outer.ok ? outer.value.width : 0
  const chrome = Math.max(0, outerW - innerW)
  facts.before = { innerW: innerW, outerW: outerW, chrome: chrome }
  const resized = await raw.resize(Math.max(1400, innerW) + chrome, WINDOW_HEIGHT)
  facts.resize = resized.ok ? 'ok' : resized.error.message
  await sleep(900)
  const after = await page.innerSize()
  const afterW = after.ok ? after.value.width : 0
  facts.after = after.ok ? after.value : null
  return { ok: afterW >= 1300, detail: '窗口内宽从 ' + String(innerW) + ' 拉到 ' + String(afterW), facts: facts }
}

/** 真拖把手，最多 10 轮；每轮按「当前档位 - 目标档位」的差值拖一次，差得大多分几步。 */
async function calibrateToWidth(page: PageHandle, raw: RawBrowserPage, target: number): Promise<WidthCalibration> {
  const playwrightPage = playwrightPageOf(raw)
  const trace: string[] = []
  if (playwrightPage === null) {
    return { ok: false, detail: '浏览器句柄没有原始 Playwright 页面：无头实例拖不了右栏把手', reached: null, rounds: 0, trace: trace }
  }
  let lastWidth: string | null = null
  for (let round = 1; round <= 10; round += 1) {
    const state = await readState(page)
    lastWidth = state === null ? null : String(state.shell?.width ?? '')
    trace.push('第 ' + String(round) + ' 轮 data-vc-width=' + String(lastWidth))
    if (lastWidth === String(target)) {
      return { ok: true, detail: '拖到 ' + String(target) + ' 档（第 ' + String(round) + ' 轮命中）', reached: lastWidth, rounds: round, trace: trace }
    }
    const handle = await evaluateValue<HandleRect>(page, handleRectScript())
    if (handle === null || handle.ok !== true) {
      trace.push('第 ' + String(round) + ' 轮找不到右栏把手：' + JSON.stringify(handle))
      break
    }
    const current = Number(lastWidth)
    if (!Number.isFinite(current)) {
      trace.push('第 ' + String(round) + ' 轮读不到整数档位，停止')
      break
    }
    let delta = current - target
    const maxStep = Math.max(40, Math.round(handle.innerW / 2))
    if (Math.abs(delta) > maxStep) delta = delta > 0 ? maxStep : -maxStep
    if (delta === 0) {
      trace.push('读数与目标差 0 但字符串对不上，停止')
      break
    }
    const startX = handle.x
    const targetX = Math.max(8, Math.min(handle.innerW - 8, startX + delta))
    await playwrightPage.mouse.move(startX, handle.y)
    await playwrightPage.mouse.down()
    await playwrightPage.mouse.move(targetX, handle.y, { steps: 14 })
    await playwrightPage.mouse.up()
    await sleep(450)
  }
  return { ok: false, detail: '拖了 10 轮仍未到 ' + String(target) + ' 档，最后 data-vc-width=' + String(lastWidth), reached: lastWidth, rounds: 10, trace: trace }
}

export default defineScenario<ScenarioContext>({
  id: 'vc-1846-search-palette',
  title: '搜索页、命令面板遮罩与分支浮层的就地切换（#1846）',
  description: '在隔离 web 实例里进入版本管理页签，验命令面板遮罩的 Esc/点遮罩关闭与焦点回归、搜索页独立版式与三种状态、选中结果只跳入口，以及分支浮层列出本地分支、当前分支不可点、点一条按 4.3 的既有通路真的切过去（干净工作区直接执行，脏工作区先停确认卡），四个指路动作各自落到对应入口并拿到焦点。2026-11-05 起补上有头能力：一种皮肤一个实例、同一次会话里真拖右栏把手，把面板标定到 380 与 520 两档，逐档验三块结构、无横向溢出、切换 smoke 并截图（维护者把范围收窄到这两档，共四组）。',
  hooks,
  steps: [
    { id: 'launch', kind: 'launch', title: '起一个装好候选包的隔离 web 实例' },
    {
      id: 'verify',
      kind: 'custom',
      timeoutMs: 900000,
      title: '进版本管理页签 → 标定第一档宽 → 验命令面板遮罩 → 搜索页三种状态 → 分支浮层清单与两次切换 → 四个指路落点 → 逐档结构/溢出/切换 smoke',
      run: async (context) => {
        const results: ScenarioObservation[] = []
        const evidence: string[] = []
        const facts: Record<string, unknown> = {}
        const save = async (name: string, value: unknown, note: string): Promise<void> => {
          try {
            const saved = await context.evidence.recordJson(name, value, { note })
            if (saved.ok) evidence.push(saved.value.path)
          } catch {
            // 存证据失败不掩盖界面结论：结论仍进 observations，这里只记一条事实。
            facts['evidenceError:' + name] = true
          }
        }
        const shot = async (page: PageHandle, name: string): Promise<string | null> => {
          const target = path.join(context.evidence.root, name)
          const saved = await page.screenshot(target)
          if (saved.ok) {
            evidence.push(target)
            return target
          }
          return null
        }
        // 只裁版本管理面板的图：整页截图里还有宿主侧栏与会话区，并排对照要的是面板本身。
        // 适配器没暴露原始 Playwright 页面时退回整页截图，并把名字加后缀区分，不假装是面板图。
        // 面板比视口高时，确认卡与结果会落在一屏之外；截图前先把它们滚到视口中间，图里才看得到。
        const scrollTo = async (page: PageHandle, selector: string): Promise<void> => {
          await evaluateValue(page, '(function () { var el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return false; el.scrollIntoView({ block: "center" }); return true; })()')
          await sleep(250)
        }
        const panelShot = async (page: PageHandle, raw: RawBrowserPage, name: string): Promise<string | null> => {
          const target = path.join(context.evidence.root, name)
          const rawPage: any = (raw as any).page
          try {
            if (rawPage && typeof rawPage.locator === 'function') {
              await rawPage.locator('[data-vc-shell]').first().screenshot({ path: target, timeout: 20000 })
              evidence.push(target)
              return target
            }
          } catch {
            // 落不了就退回整页截图，下面的名字带 full 后缀。
          }
          return shot(page, name.replace(/\.png$/, '-full.png'))
        }

        const pageResult = await context.primitives.page()
        if (!pageResult.ok) {
          return [observe({ checkId: 'page-open', title: '页面能为这个实例打开', ok: false, status: 'blocked', detail: pageResult.error.message })]
        }
        const page = pageResult.value
        const instance = context.instance
        if (instance === null) {
          return [observe({ checkId: 'instance-alive', title: 'launch 步留下了一个活着的实例', ok: false, status: 'blocked', detail: 'context.instance 是空的' })]
        }
        const raw = page.page as unknown as RawBrowserPage

        // ---- 进入版本管理页签 ----
        // 遮罩可能随手弹（登录提示、首开提示）；只在真的有遮罩时按 Esc，免得把已经开着的面板关掉。
        const dismissMasks = async (): Promise<void> => {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const masks = await evaluateValue<number>(page, 'document.querySelectorAll(' + JSON.stringify('[class*="_mask_"]') + ').length')
            if ((masks ?? 0) > 0) {
              await realPress(raw, 'Escape')
              await realClick(page, raw, SEL_CLOSE)
              await sleep(300)
              continue
            }
            if (await exists(page, SEL_WORKSPACE)) return
            if (await exists(page, SEL_SIDEBAR)) return
            await sleep(250)
          }
        }
        if (raw.goto !== undefined) await raw.goto(instance.record.tokenUrl)
        await sleep(2500)
        await dismissMasks()
        // 皮肤：隔离 home 里的偏好在今天的宿主上会被启动流程改回设置存储里的值，
        // 所以这里再走一次宿主自己的设置接口（接口没切成才退回只改 body 属性，见 ensureSkin）。
        if (LOCKED_SKIN !== '') {
          const skinSwitched = await ensureSkin(page, LOCKED_SKIN)
          facts['0a-skin'] = skinSwitched
          results.push(observe({
            checkId: 'skin-switch',
            title: '把宿主皮肤切到本轮要验的 ' + LOCKED_SKIN,
            ok: skinSwitched.ok,
            detail: skinSwitched.detail,
            expected: '页面 body 的主题属性与本轮皮肤一致',
            actual: JSON.stringify(skinSwitched.facts),
            hint: skinSwitched.ok ? undefined : '设置接口与 body 属性两条都没切成；先看 facts.settingsMutate 的回执。',
          }))
          await dismissMasks()
        }
        // 进主视图：经页面接口建工作区与会话，再点「新建会话」；三条入口都没成时把读数一并留证。
        // 2026-11-05 有头实例上原来那条「欢迎屏工作区菜单」没有出现（中间停在「选择一个工作区开始」），
        // 所以换了入口；菜单路径保留在 openMainView 里作兜底。
        const mainView = await openMainView(page, raw, instance.record.tokenUrl, fixtureRepo)
        facts['0-main-view'] = mainView
        if (!mainView.ok) {
          await shot(page, '1846-main-view-failed.png')
          await save('1846-main-view-failed.json', { mainView, pageErrors: page.pageErrors() }, '进不去主视图时的页面现状与三条入口的读数')
        }
        await realClick(page, raw, SEL_SIDEBAR)
        await sleep(1500)
        await realClick(page, raw, SEL_GUIDE)
        // 页签按钮要等右侧栏里的面板挂载完才出现，等到再点；等不到就按文字「版本管理」点。
        const tabsReady = await waitFor(page, boolScript(SEL_VC_TAB), 40, 250)
        if (tabsReady) await realClick(page, raw, SEL_VC_TAB)
        else await evaluateValue(page, clickTextScript('button.dsws-tab', '版本'))
        let vcReady = await waitFor(page, boolScript(SEL.vcRoot), 120, 250)
        if (!vcReady) {
          await evaluateValue(page, clickTextScript('button.dsws-tab', '版本'))
          vcReady = await waitFor(page, boolScript(SEL.vcRoot), 80, 250)
        }
        if (!vcReady) {
          facts['entryState'] = await readState(page)
          await shot(page, '1846-entry-failed.png')
          await save('1846-entry-failed.json', { facts, pageErrors: page.pageErrors() }, '进不进版本管理页签时的页面现状')
          return [observe({
            checkId: 'panel-entry',
            title: '进入会话视图并打开版本管理页签',
            ok: false,
            status: 'blocked',
            detail: '没有等到 ' + SEL.vcRoot + '；页面错误 ' + JSON.stringify(page.pageErrors().slice(0, 3)),
            hint: '欢迎屏遮罩或工作区菜单的路径可能改了，先看证据里的 entryState。',
            evidence,
          })]
        }
        const base = await readState(page)
        facts['1-entry'] = base
        results.push(observe({
          checkId: 'panel-entry',
          title: '进入会话视图并打开版本管理页签',
          ok: true,
          detail: '版本管理根节点出现；当前页 ' + String(base?.root?.page) + '；壳宽 ' + String(base?.shell?.width) + '；皮肤 ' + String(base?.shell?.skin) + '；窗口 ' + JSON.stringify(base?.viewport),
          evidence,
        }))

        // ---- 任务二：先锁皮肤、再把面板标定到第一档宽 ----
        // 皮肤锁在隔离 home 里，壳根的 data-vc-skin 是它到底生效没有的唯一凭据；
        // 宽度只能靠真拖右栏把手（面板档位是宿主的右栏布局偏好），先把窗口拉宽再拖。
        const wide = await ensureWideWindow(page, raw)
        facts['1b-wide-window'] = wide
        results.push(observe({
          checkId: 'wide-window',
          title: '先把窗口拉到够宽（右栏才有拖到 520 的余量）',
          ok: wide.ok,
          detail: wide.detail,
          hint: wide.ok ? undefined : '无头适配器没有 resize()：带 --declaration verify/profile-1833-headed.ts 跑，宽度才标得动。',
        }))
        const skinNow = String(base?.shell?.skin || '')
        if (LOCKED_SKIN === '') {
          results.push(observe({
            checkId: 'skin-locked',
            title: '本轮没有锁皮肤（DSH_1846_SKIN 未设置）',
            ok: false,
            status: 'blocked',
            detail: '四组验收要求一个实例只跑一种皮肤；这一轮只作接线检查，不能算进四组结论。',
            hint: '按「一皮肤一实例」跑两轮：DSH_1846_SKIN=dark 与 DSH_1846_SKIN=light，各带 DSH_1846_WIDTHS=380,520。',
          }))
        } else {
          results.push(observe({
            checkId: 'skin-locked',
            title: '隔离实例按启动前锁定的皮肤跑（' + LOCKED_SKIN + '）',
            ok: skinNow === LOCKED_SKIN,
            detail: '壳根 data-vc-skin=' + skinNow + '；锁定的皮肤 ' + LOCKED_SKIN,
            expected: 'data-vc-skin 等于锁定值 ' + LOCKED_SKIN,
            actual: skinNow,
          }))
        }
        const firstWidth = WIDTHS[0]
        const firstCal = await calibrateToWidth(page, raw, firstWidth)
        const firstState = await readState(page)
        facts['1c-calibrate-' + firstWidth] = { calibration: firstCal, state: firstState }
        results.push(observe({
          checkId: 'width-' + firstWidth + '-ready',
          title: '把面板拖到 ' + firstWidth + ' 档再开始验交互',
          ok: firstCal.ok && String(firstState?.shell?.width ?? '') === String(firstWidth),
          detail: firstCal.detail + '；壳根 data-vc-width=' + String(firstState?.shell?.width ?? '') + '；窗口 ' + JSON.stringify(firstState?.viewport ?? null),
          expected: '拖完 data-vc-width=' + firstWidth,
          actual: JSON.stringify({ reached: firstCal.reached, trace: firstCal.trace }),
        }))

        // ---- 1. 命令面板遮罩：打开、焦点进输入框、Esc 关闭且焦点回入口 ----
        await realClick(page, raw, SEL.searchEntry)
        const paletteOpen = await waitFor(page, boolScript(SEL.paletteBackdrop + ' ' + SEL.paletteInput), 30, 200)
        const openState = await readState(page)
        facts['2-palette-open'] = openState
        const openShot = await panelShot(page, raw, '1846-palette-open.png')
        const focusInPalette = openState?.focus?.paletteInput === true
        results.push(observe({
          checkId: 'palette-open',
          title: '命令面板按遮罩打开，输入框拿到焦点',
          ok: paletteOpen && focusInPalette,
          detail: '遮罩 ' + String(openState?.palette?.backdrop) + '；输入框 ' + String(openState?.palette?.input) + '；输入框拿到焦点 ' + String(focusInPalette) + '；面板登记结果 ' + String(openState?.palette?.rows?.length ?? 0) + ' 条',
          expected: '遮罩与输入框都在，焦点在命令面板输入框里',
          actual: JSON.stringify(openState?.focus ?? null),
          evidence: openShot === null ? [] : [openShot],
        }))

        await realPress(raw, 'Escape')
        const escClosed = await waitFor(page, '!' + boolScript(SEL.paletteBackdrop), 20, 150)
        const escFocus = await waitFor(page, focusScript(SEL.searchEntry), 25, 150)
        const escState = await readState(page)
        facts['3-palette-esc'] = escState
        results.push(observe({
          checkId: 'palette-esc-close',
          title: 'Esc 关闭命令面板，焦点回到入口',
          ok: escClosed && escFocus,
          detail: '关闭 ' + String(escClosed) + '；焦点回 [data-vc-search-entry] ' + String(escFocus),
          expected: '按 Esc 后遮罩消失，焦点回到打开面板的入口按钮',
          actual: JSON.stringify(escState?.focus ?? null),
        }))

        // ---- 2. 点遮罩关闭，焦点回入口 ----
        await realClick(page, raw, SEL.searchEntry)
        await waitFor(page, boolScript(SEL.paletteBackdrop), 30, 200)
        const backdropClick = await evaluateValue<{ ok?: boolean; reason?: string }>(page, clickBackdropScript())
        const backdropClosed = await waitFor(page, '!' + boolScript(SEL.paletteBackdrop), 20, 150)
        const backdropFocus = await waitFor(page, focusScript(SEL.searchEntry), 25, 150)
        facts['4-palette-backdrop'] = { click: backdropClick, state: await readState(page) }
        results.push(observe({
          checkId: 'palette-backdrop-close',
          title: '点遮罩本身关闭命令面板，焦点回到入口',
          ok: backdropClick?.ok === true && backdropClosed && backdropFocus,
          detail: '点击点 ' + JSON.stringify(backdropClick) + '；关闭 ' + String(backdropClosed) + '；焦点回入口 ' + String(backdropFocus),
          expected: '点在遮罩（不是面板）上时面板关闭，焦点回到入口',
          actual: JSON.stringify(await readState(page)),
          hint: backdropClick?.ok === false ? '遮罩四角都被面板盖住时无法在两个元素之间做真实命中，这条要人工复核。' : undefined,
        }))

        // ---- 3. 命令面板选中 13.3 → 搜索页独立版式（唯一输入框、空查询态） ----
        await realClick(page, raw, SEL.searchEntry)
        await waitFor(page, boolScript(SEL.paletteInput), 30, 200)
        await evaluateValue(page, typeScript(SEL.paletteInput, '13.3'))
        const rowReady = await waitFor(page, boolScript(SEL.paletteRow('13.3')), 30, 200)
        if (rowReady) await realClick(page, raw, SEL.paletteRow('13.3'))
        const onSearch = await waitFor(page, '(document.querySelector(' + JSON.stringify(SEL.vcRoot) + ') || { getAttribute: function () { return "" } }).getAttribute("data-vc-live-page") === "search"', 40, 250)
        const searchState = await readState(page)
        facts['5-search-empty-query'] = searchState
        const searchEmptyShot = await panelShot(page, raw, '1846-search-empty-query.png')
        const oneInput = searchState?.search?.inputs === 1
        const noPalette = searchState?.search?.paletteInputs === 0 && searchState?.palette?.backdrop === false
        const emptyQuery = searchState?.search?.empty === 'query'
        results.push(observe({
          checkId: 'search-page-layout',
          title: '搜索页是独立版式：只有一个输入框，空查询有对应呈现',
          ok: onSearch && oneInput && noPalette && emptyQuery,
          detail: '到搜索页 ' + String(onSearch) + '；输入框数 ' + String(searchState?.search?.inputs) + '；命令面板输入框数 ' + String(searchState?.search?.paletteInputs) + '；空态 ' + String(searchState?.search?.empty) + '；壳宽 ' + String(searchState?.shell?.width),
          expected: 'data-vc-search-input 恰 1 个、命令面板输入框 0 个、data-vc-search-empty="query"',
          actual: JSON.stringify(searchState?.search ?? null),
          evidence: searchEmptyShot === null ? [] : [searchEmptyShot],
        }))

        // ---- 4. 无命中态 ----
        await evaluateValue(page, typeScript(SEL.searchInput, 'zzzzqqq'))
        await waitFor(page, '(document.querySelector("[data-vc-search-empty]") || { getAttribute: function () { return "" } }).getAttribute("data-vc-search-empty") === "hit"', 25, 200)
        const hitState = await readState(page)
        facts['6-search-no-hit'] = hitState
        await shot(page, '1846-search-no-hit.png')
        results.push(observe({
          checkId: 'search-no-hit',
          title: '搜索无结果时有对应呈现',
          ok: hitState?.search?.empty === 'hit' && hitState?.search?.rows?.length === 0,
          detail: '空态 ' + String(hitState?.search?.empty) + '；结果行 ' + String(hitState?.search?.rows?.length ?? 0) + ' 条',
          expected: 'data-vc-search-empty="hit"，不画结果行',
          actual: JSON.stringify(hitState?.search ?? null),
        }))

        // ---- 5. 有结果：按来源分组、计数与行一致 ----
        await evaluateValue(page, typeScript(SEL.searchInput, 'git'))
        const grouped = await waitFor(page, 'document.querySelectorAll("[data-vc-search-group]").length >= 2', 30, 250)
        const rowsState = await readState(page)
        facts['7-search-rows'] = rowsState
        const rowsShot = await panelShot(page, raw, '1846-search-rows.png')
        const count = Number(rowsState?.search?.count)
        const rendered = rowsState?.search?.rows?.length ?? 0
        const groups = rowsState?.search?.groups ?? []
        const countsMatch = Number.isFinite(count) && (count === rendered || count > 40)
        const groupRowsMatch = groups.every((g: any) => g.rows.length > 0)
        results.push(observe({
          checkId: 'search-groups',
          title: '搜索结果按来源分组，计数与实际画出的行一致',
          ok: grouped && rendered > 0 && countsMatch && groupRowsMatch,
          detail: '分组 ' + String(groups.length) + ' 个（' + groups.map((g: any) => g.page + ':' + g.rows.length).join('、') + '）；计数 ' + String(count) + '；画出 ' + String(rendered) + ' 行',
          expected: '至少两个来源分组；计数 = 画出条数（截到 40 条时计数更大）；每组都有行',
          actual: JSON.stringify(rowsState?.search?.groups ?? null),
          evidence: rowsShot === null ? [] : [rowsShot],
        }))

        // ---- 6. 选中一条结果只跳对应入口并高亮 ----
        // 挑一条落在「别的页」的能力：从搜索页跳过去，才能证明是导航而不是原地不动。
        // 能力行与 data-cap-hit 已随 #1860 退役，所以这里不再断言高亮——跳转落点本身就是判据。
        const pickGroup = (groups as any[]).find((g) => g.page !== 'search' && g.page !== 'changes')
          ?? (groups as any[]).find((g) => g.page !== 'search')
          ?? (groups as any[])[0]
        const pickId = pickGroup?.rows?.[0]
        if (typeof pickId === 'string') await realClick(page, raw, '[data-vc-search-row="' + pickId + '"]')
        const jumped = await waitFor(page, '(document.querySelector(' + JSON.stringify(SEL.vcRoot) + ') || { getAttribute: function () { return "" } }).getAttribute("data-vc-live-page") === ' + JSON.stringify(pickGroup?.page ?? ''), 40, 250)
        const jumpState = await readState(page)
        facts['8-search-jump'] = jumpState
        const paletteClosed = !(await exists(page, SEL.paletteBackdrop))
        await shot(page, '1846-search-jump.png')
        results.push(observe({
          checkId: 'search-jump',
          title: '搜索页选中一条结果就跳到那条能力的页面，不在搜索页执行动作',
          ok: jumped && paletteClosed,
          detail: '选中 ' + String(pickId) + '（来源页 ' + String(pickGroup?.page) + '）→ 当前页 ' + String(jumpState?.root?.page) + '；命令面板已关 ' + String(paletteClosed) + '；页面错误 ' + JSON.stringify(page.pageErrors().slice(0, 2)),
          expected: '当前页等于该能力所在页，命令面板不在',
          actual: JSON.stringify(jumpState?.root ?? null),
        }))

        // ---- 7. 分支浮层：列出本地分支，当前分支带标记且不可点 ----
        await realClick(page, raw, SEL.branchBtn)
        const overlayOpen = await waitFor(page, boolScript(SEL.branchOverlay), 30, 200)
        const overlayState = await readState(page)
        facts['9-branch-overlay'] = overlayState
        const overlayShot = await panelShot(page, raw, '1846-branch-overlay.png')
        const actions = overlayState?.branch?.actions ?? []
        const rows = overlayState?.branch?.rows ?? []
        results.push(observe({
          checkId: 'branch-overlay',
          title: '分支浮层列出本地分支，四个指路动作按固定顺序排',
          ok: overlayOpen && actions.join(',') === 'create,delete,merge,rebase' && rows.length >= 2,
          detail: '浮层 ' + String(overlayOpen) + '；分支行 ' + JSON.stringify(rows) + '；动作顺序 ' + JSON.stringify(actions) + '；关闭按钮 ' + String(overlayState?.branch?.close),
          expected: '至少列出 main 与 dev 两条本地分支；四个指路动作按 create,delete,merge,rebase 排列',
          actual: JSON.stringify(overlayState?.branch ?? null),
          evidence: overlayShot === null ? [] : [overlayShot],
        }))
        const currentRowDisabled = await evaluateValue<boolean>(page, '(function () { var el = document.querySelector(' + JSON.stringify(SEL.branchCurrent) + '); return !!el && el.hasAttribute("disabled"); })()')
        results.push(observe({
          checkId: 'branch-overlay-current',
          title: '当前分支那一行带标记且不可点',
          ok: currentRowDisabled === true && String(overlayState?.branch?.current || '').length > 0,
          detail: '当前分支读作 ' + String(overlayState?.branch?.current) + '；disabled ' + String(currentRowDisabled),
          expected: '当前分支行带 data-vc-branch-current 且有 disabled 属性',
          actual: JSON.stringify({ current: overlayState?.branch?.current, disabled: currentRowDisabled }),
        }))

        // ---- 8. 工作区干净时点一条分支：签完票直接执行，结果贴回浮层 ----
        await realClick(page, raw, SEL.branchPick('dev'))
        const switchedClean = await waitFor(page, '(document.querySelector(' + JSON.stringify(SEL.branchCurrent) + ') || { getAttribute: function () { return "" } }).getAttribute("data-vc-branch-pick") === "dev"', 80, 250)
        const cleanState = await readState(page)
        facts['10-branch-switch-clean'] = cleanState
        await scrollTo(page, SEL.branchResult)
        const cleanShot = await panelShot(page, raw, '1846-branch-switch-clean.png')
        results.push(observe({
          checkId: 'branch-switch-clean',
          title: '工作区干净时点一条分支真的切过去（预检 → 直接执行 → 结果贴回浮层）',
          ok: switchedClean && cleanState?.branch?.result === 'ok' && cleanState?.branch?.confirm === false,
          detail: '当前分支标记 ' + String(cleanState?.branch?.current) + '；结果块 ' + String(cleanState?.branch?.result) + '；确认卡 ' + String(cleanState?.branch?.confirm),
          expected: '当前分支变成 dev，结果块 ok，且没有多停确认卡',
          actual: JSON.stringify(cleanState?.branch ?? null),
          evidence: cleanShot === null ? [] : [cleanShot],
        }))

        // ---- 9. 工作区有未提交改动时切回 main：确认卡 → 凭票执行 ----
        // 夹具仓库由这一趟自己放一个未跟踪文件；预检会判成 warn，确认卡才会出现。
        try { fs.writeFileSync(path.join(fixtureRepo, 'dirty-1846.txt'), '未提交的改动\n', 'utf8') } catch { /* 夹具目录不在时下一段会照实红 */ }
        await realClick(page, raw, SEL.branchPick('main'))
        const confirmShown = await waitFor(page, boolScript(SEL.branchConfirm), 60, 250)
        const confirmState = await readState(page)
        facts['11-branch-switch-confirm'] = confirmState
        await scrollTo(page, SEL.branchConfirm)
        const confirmShot = await panelShot(page, raw, '1846-branch-switch-confirm.png')
        results.push(observe({
          checkId: 'branch-switch-confirm',
          title: '工作区有未提交改动时先停在浮层里的确认卡上，不发执行电话',
          ok: confirmShown && confirmState?.branch?.current === 'dev',
          detail: '确认卡 ' + String(confirmState?.branch?.confirm) + '；当前分支仍是 ' + String(confirmState?.branch?.current) + '（还没切）',
          expected: '浮层里出现 data-vc-confirm，当前分支仍是 dev',
          actual: JSON.stringify(confirmState?.branch ?? null),
          evidence: confirmShot === null ? [] : [confirmShot],
        }))
        await realClick(page, raw, SEL.branchConfirmGo)
        const backToMain = await waitFor(page, '(document.querySelector(' + JSON.stringify(SEL.branchCurrent) + ') || { getAttribute: function () { return "" } }).getAttribute("data-vc-branch-pick") === "main"', 80, 250)
        const mainState = await readState(page)
        facts['12-branch-switch-confirm-go'] = mainState
        await scrollTo(page, SEL.branchResult)
        const mainShot = await panelShot(page, raw, '1846-branch-switch-confirm-go.png')
        results.push(observe({
          checkId: 'branch-switch-confirm-go',
          title: '确认后凭票执行，当前分支切回 main，结果贴回浮层',
          ok: backToMain && mainState?.branch?.result === 'ok',
          detail: '当前分支标记 ' + String(mainState?.branch?.current) + '；结果块 ' + String(mainState?.branch?.result) + '；确认卡 ' + String(mainState?.branch?.confirm),
          expected: '当前分支变成 main，结果块 ok，确认卡收起',
          actual: JSON.stringify(mainState?.branch ?? null),
          evidence: mainShot === null ? [] : [mainShot],
        }))
        try { fs.unlinkSync(path.join(fixtureRepo, 'dirty-1846.txt')) } catch { /* 文件不在也无妨 */ }

        // 浮层仍开着是第一段的检查留下的；先关掉，后面每轮都从「浮层不在」的状态开始，
        // 否则点一下分支按钮只会把开着的浮层关掉，看起来像「没能再次打开」。
        if (await exists(page, SEL.branchOverlay)) await realClick(page, raw, SEL.branchClose)
        await waitFor(page, '!' + boolScript(SEL.branchOverlay), 20, 150)
        for (const landing of LANDINGS) {
          if (!(await exists(page, SEL.branchOverlay))) await realClick(page, raw, SEL.branchBtn)
          if (!(await waitFor(page, boolScript(SEL.branchOverlay), 20, 150))) {
            results.push(observe({ checkId: 'branch-' + landing.action, title: '分支浮层动作 ' + landing.action + ' 落到分支页对应入口', ok: false, detail: '分支浮层没能再次打开', expected: '浮层打开后点动作', actual: '浮层未出现' }))
            continue
          }
          await realClick(page, raw, SEL.branchAction(landing.action))
          const pageOk = await waitFor(page, '(document.querySelector(' + JSON.stringify(SEL.vcRoot) + ') || { getAttribute: function () { return "" } }).getAttribute("data-vc-live-page") === ' + JSON.stringify(landing.page), 40, 250)
          const entryOk = await waitFor(page, boolScript(landing.selector), 60, 250)
          const focusOk = await waitFor(page, focusScript(landing.selector), 30, 200)
          // 浮层自己关是产品行为：等到 10 秒。还开着就点一次关闭按钮兜底，并在结论里分开写，
          // 不把检查自己的兜底当成产品表现。
          let closedOk = await waitFor(page, '!' + boolScript(SEL.branchOverlay), 40, 250)
          let closedByCheck = false
          if (!closedOk && (await exists(page, SEL.branchOverlay))) {
            await realClick(page, raw, SEL.branchClose)
            closedByCheck = await waitFor(page, '!' + boolScript(SEL.branchOverlay), 20, 150)
          }
          const landState = await readState(page)
          facts['branch-' + landing.action] = { pageOk, entryOk, focusOk, closedOk, closedByCheck, state: landState }
          const landShot = await shot(page, '1846-branch-' + landing.action + '.png')
          results.push(observe({
            checkId: 'branch-' + landing.action,
            title: '分支浮层动作 ' + landing.action + ' 落到 ' + landing.page + ' 的对应入口',
            ok: pageOk && entryOk && focusOk && closedOk,
            detail: '到页 ' + String(pageOk) + '；入口 ' + landing.selector + ' 存在 ' + String(entryOk) + '；焦点进那个入口 ' + String(focusOk) + '；浮层关闭 ' + String(closedOk) + (closedByCheck ? '（等不到自己关，由检查点关闭按钮兜底关掉）' : '') + '；当前页 ' + String(landState?.root?.page),
            expected: '当前页是 ' + landing.page + '，入口存在且拿到焦点，浮层关闭',
            actual: JSON.stringify(landState?.focus ?? null),
            evidence: landShot === null ? [] : [landShot],
          }))
        }


        // ---- 任务二：逐档过一遍三块结构 + 横向溢出 + 切换 smoke ----
        // 交互不随宽度变、版式才随宽度变：每档都量结构与溢出、各留一张截图；
        // 切换 smoke 只证明「这一档下浮层里的分支按钮仍然点得动」，不重复完整的两次切换流程。
        const overflowBad = (state: Record<string, any> | null): string[] => {
          const problems: string[] = []
          const fields: ReadonlyArray<{ label: string; value: unknown }> = [
            { label: '壳根', value: state?.shell?.overflowX },
            { label: '命令面板', value: state?.palette?.overflowX },
            { label: '搜索页', value: state?.search?.overflowX },
            { label: '分支浮层', value: state?.branch?.overflowX },
          ]
          for (const field of fields) {
            const value = Number(field.value)
            if (Number.isFinite(value) && value > 0) problems.push(field.label + '横向溢出 ' + String(value) + 'px')
          }
          return problems
        }
        // 回到「改动」页：命令面板只在非搜索页绘制（搜索页有自己的输入框，点图标不开面板），
        // 而二级页与搜索页的页头是「返回」不是四页签。有页签就点页签，没有就点返回，最多五次。
        const goChanges = async (): Promise<boolean> => {
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const now = await readState(page)
            if (String(now?.shell?.page || '') === 'changes') return true
            if (await exists(page, SEL.tabChanges)) await realClick(page, raw, SEL.tabChanges)
            else if (await exists(page, SEL.back)) await realClick(page, raw, SEL.back)
            else break
            await sleep(600)
          }
          const last = await readState(page)
          return String(last?.shell?.page || '') === 'changes'
        }
        for (const width of WIDTHS) {
          const skinLabel = LOCKED_SKIN === '' ? 'skin-unlocked' : LOCKED_SKIN
          const group = skinLabel + '-' + width
          const cal = await calibrateToWidth(page, raw, width)
          const calState = await readState(page)
          facts['2-calibrate-' + group] = { calibration: cal, state: calState }
          results.push(observe({
            checkId: 'w' + width + '-calibrate',
            title: width + ' 宽 · ' + skinLabel + '：面板真的拖到这一档',
            ok: cal.ok && String(calState?.shell?.width ?? '') === String(width) && (LOCKED_SKIN === '' || String(calState?.shell?.skin ?? '') === LOCKED_SKIN),
            detail: cal.detail + '；data-vc-width=' + String(calState?.shell?.width ?? '') + '；data-vc-skin=' + String(calState?.shell?.skin ?? ''),
            expected: 'data-vc-width=' + width + '，data-vc-skin=' + (LOCKED_SKIN === '' ? '（任意）' : LOCKED_SKIN),
            actual: JSON.stringify({ reached: cal.reached, trace: cal.trace }),
          }))

          // 命令面板：遮罩 + 输入框 + 至少一行结果。开面板前先回「改动」页：
          // 上一组结束在搜索页，而搜索页上点那颗图标不开面板（见 goChanges 的注释）。
          const backOnChanges = await goChanges()
          facts['4-go-changes-' + group] = backOnChanges
          await realClick(page, raw, SEL.searchEntry)
          const paletteReady = await waitFor(page, boolScript(SEL.paletteInput), 30, 200)
          // 空查询时面板只给一行「打开全库搜索」，截图看不出列表长什么样；搜一个常见的词，
          // 让这一档的取证图是真列表，同时顺手验了这一档下输入与过滤仍然工作。
          await evaluateValue(page, typeScript(SEL.paletteInput, 'git'))
          await waitFor(page, 'document.querySelectorAll("[data-vc-palette-row]").length >= 2', 30, 200)
          const paletteState = await readState(page)
          const paletteShot = await panelShot(page, raw, '1846-w' + width + '-' + skinLabel + '-palette.png')
          const paletteProblems = overflowBad(paletteState)
          results.push(observe({
            checkId: 'w' + width + '-palette',
            title: width + ' 宽：命令面板按遮罩打开，面板里不横向溢出',
            ok: paletteReady && paletteState?.palette?.backdrop === true && paletteState?.palette?.input === true && (paletteState?.palette?.rows?.length ?? 0) >= 2 && paletteProblems.length === 0,
            detail: '遮罩 ' + String(paletteState?.palette?.backdrop) + '；输入框 ' + String(paletteState?.palette?.input) + '；行 ' + String(paletteState?.palette?.rows?.length ?? 0) + '；溢出 ' + (paletteProblems.length ? paletteProblems.join('；') : '无'),
            expected: '遮罩与输入框都在、至少一行结果、无横向溢出',
            actual: JSON.stringify({ palette: paletteState?.palette ?? null, shell: paletteState?.shell ?? null }),
            evidence: paletteShot === null ? [] : [paletteShot],
          }))
          await realPress(raw, 'Escape')
          await waitFor(page, '!' + boolScript(SEL.paletteBackdrop), 20, 150)

          // 搜索页：从命令面板选中 13.3 进去（与交互那一段同一条路），再搜一次看分组
          await realClick(page, raw, SEL.searchEntry)
          await waitFor(page, boolScript(SEL.paletteInput), 30, 200)
          await evaluateValue(page, typeScript(SEL.paletteInput, '13.3'))
          await waitFor(page, boolScript(SEL.paletteRow('13.3')), 30, 200)
          await realClick(page, raw, SEL.paletteRow('13.3'))
          const onSearch = await waitFor(page, '(document.querySelector(' + JSON.stringify(SEL.vcRoot) + ') || { getAttribute: function () { return "" } }).getAttribute("data-vc-live-page") === "search"', 40, 250)
          await evaluateValue(page, typeScript(SEL.searchInput, 'git'))
          await waitFor(page, 'document.querySelectorAll("[data-vc-search-group]").length >= 2', 30, 250)
          const groupSearchState = await readState(page)
          const groupSearchShot = await panelShot(page, raw, '1846-w' + width + '-' + skinLabel + '-search.png')
          const searchProblems = overflowBad(groupSearchState)
          results.push(observe({
            checkId: 'w' + width + '-search',
            title: width + ' 宽：搜索页只有一个输入框、结果分组照常，页面不横向溢出',
            ok: onSearch && groupSearchState?.search?.inputs === 1 && (groupSearchState?.search?.groups?.length ?? 0) >= 2 && searchProblems.length === 0,
            detail: '到搜索页 ' + String(onSearch) + '；输入框 ' + String(groupSearchState?.search?.inputs) + '；分组 ' + String(groupSearchState?.search?.groups?.length ?? 0) + '；溢出 ' + (searchProblems.length ? searchProblems.join('；') : '无'),
            expected: '输入框 1 个、至少两组结果、无横向溢出',
            actual: JSON.stringify(groupSearchState?.search ?? null),
            evidence: groupSearchShot === null ? [] : [groupSearchShot],
          }))

          // 分支浮层：清单、当前分支、指路文案点名真实两页
          await realClick(page, raw, SEL.branchBtn)
          const overlayReady = await waitFor(page, boolScript(SEL.branchOverlay), 30, 200)
          const groupOverlayState = await readState(page)
          const groupOverlayShot = await panelShot(page, raw, '1846-w' + width + '-' + skinLabel + '-branch.png')
          const overlayProblems = overflowBad(groupOverlayState)
          const pointerText = String(groupOverlayState?.branch?.pointer || '')
          const copyOk = pointerText.indexOf('冲突向导') >= 0 && pointerText.indexOf('变基待办') >= 0
          const rowsNow: string[] = groupOverlayState?.branch?.rows ?? []
          results.push(observe({
            checkId: 'w' + width + '-branch',
            title: width + ' 宽：分支浮层列出本地分支，指路文案点名真实两页，浮层不横向溢出',
            ok: overlayReady && rowsNow.length >= 2 && String(groupOverlayState?.branch?.current || '').length > 0 && copyOk && overlayProblems.length === 0,
            detail: '浮层 ' + String(overlayReady) + '；分支 ' + JSON.stringify(rowsNow) + '；当前 ' + String(groupOverlayState?.branch?.current) + '；指路文案「' + pointerText + '」；溢出 ' + (overlayProblems.length ? overlayProblems.join('；') : '无'),
            expected: '至少两条分支、当前分支有标记、指路文案含「冲突向导」与「变基待办」、无横向溢出',
            actual: JSON.stringify(groupOverlayState?.branch ?? null),
            evidence: groupOverlayShot === null ? [] : [groupOverlayShot],
          }))

          // 切换 smoke：切到另一条再切回来，证明这一档下按钮仍然点得动
          const original = String(groupOverlayState?.branch?.current || '')
          const smokeTarget = rowsNow.find((name) => name !== original) ?? ''
          const currentScript = (name: string): string => '(document.querySelector(' + JSON.stringify(SEL.branchCurrent) + ') || { getAttribute: function () { return "" } }).getAttribute("data-vc-branch-pick") === ' + JSON.stringify(name)
          let switched = false
          let restored = false
          if (smokeTarget !== '' && original !== '') {
            await realClick(page, raw, SEL.branchPick(smokeTarget))
            switched = await waitFor(page, currentScript(smokeTarget), 80, 250)
            await realClick(page, raw, SEL.branchPick(original))
            restored = await waitFor(page, currentScript(original), 80, 250)
          }
          const smokeState = await readState(page)
          facts['3-switch-' + group] = smokeState
          results.push(observe({
            checkId: 'w' + width + '-switch',
            title: width + ' 宽：点一条分支真的切过去，再切回原分支',
            ok: switched && restored && smokeState?.branch?.result === 'ok',
            detail: '切到 ' + (smokeTarget === '' ? '（没有别的分支可切）' : smokeTarget) + ' ' + String(switched) + '；切回 ' + original + ' ' + String(restored) + '；结果块 ' + String(smokeState?.branch?.result),
            expected: '两次都切成功、结果块 ok',
            actual: JSON.stringify(smokeState?.branch ?? null),
          }))
          if (await exists(page, SEL.branchOverlay)) await realClick(page, raw, SEL.branchClose)
          await waitFor(page, '!' + boolScript(SEL.branchOverlay), 20, 150)
        }

        await shot(page, '1846-final.png')
        await save('1846-facts.json', { facts, skin: LOCKED_SKIN, widths: WIDTHS, pageErrors: page.pageErrors() }, '真机验证全过程读数：进入路径、皮肤与逐档宽度标定、命令面板、搜索页三态、分支浮层的清单与两次切换、四个指路落点、逐档结构与切换 smoke')
        const failed = results.filter((r) => !r.ok).length
        results.push(observe({
          checkId: 'summary',
          title: '#1846 真机验证汇总',
          ok: failed === 0,
          detail: '共 ' + String(results.length) + ' 条检查，失败 ' + String(failed) + ' 条；皮肤 ' + (LOCKED_SKIN === '' ? '未锁' : LOCKED_SKIN) + '；宽度档 ' + WIDTHS.join(' / ') + '；证据 ' + String(evidence.length) + ' 份；页面错误 ' + String(page.pageErrors().length) + ' 条',
          evidence,
        }))
        return results
      },
    },
    { id: 'stop', kind: 'stop', title: '停掉实例' },
  ],
})
