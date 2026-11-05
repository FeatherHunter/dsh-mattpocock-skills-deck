// verify/scenarios/1846-search-palette.ts —— 真机验证 #1846：搜索页收口、命令面板遮罩、分支浮层（列出分支并就地切换）。
//
// 这一份验四件事（对应票面验收）：
//   1) 命令面板按遮罩呈现：Esc 关闭、点遮罩关闭、关闭后焦点回入口；
//   2) 搜索页是独立版式、只有一个输入框；空查询与无命中各有对应呈现；结果按来源分组；
//   3) 选中一条结果只跳到那条能力的入口并高亮，不执行任何动作；
//   4) 分支浮层列出首屏读到的本地分支（当前分支带标记且不可点），点一条按 4.3 的既有通路真的切过去
//      （预检 → 工作区有未提交改动时停确认卡 → 凭票执行 → 结果贴回浮层），其余四个动作仍各自指路。
//
// 四档宽与深浅两皮肤由源码闭包的并排对照图覆盖（assets/acceptance/2026-11-05-1846）；这一份真机场景
// 验的是接线与真实宿主行为，窗口按当前实宽记录在读数里，不伪造四档。
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

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

interface RawBrowserPage {
  goto?: (url: string) => Promise<unknown>
  click?: (selector: string) => Promise<Result<unknown>>
  press?: (key: string) => Promise<Result<unknown>>
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
}

/** 分支浮层四个指路动作的落点：与 vcRealShell.ts 的 VC_REAL_BRANCH_LANDING 一一对应。 */
const LANDINGS: ReadonlyArray<{ action: string; page: string; selector: string }> = [
  { action: 'create', page: 'branch-tags', selector: '[data-vc-branch-forms] [data-vc-branch-action="create"]' },
  { action: 'delete', page: 'branch-tags', selector: '[data-vc-branch-row]:not([data-vc-branch-is-current]) [data-vc-branch-menu] [data-vc-branch-action="delete"]' },
  { action: 'merge', page: 'conflicts', selector: '[data-vc-conflicts-op="merge"]' },
  { action: 'rebase', page: 'rebase', selector: '[data-vc-rebase-op="rebase-onto"]' },
]

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
  '  var active = document.activeElement;',
  '  return {',
  '    url: location.href, title: document.title,',
  '    viewport: { w: window.innerWidth, h: window.innerHeight },',
  '    root: root ? { page: attr(root, "data-vc-live-page"), depth: attr(root, "data-vc-live-depth") } : null,',
  '    shell: shell ? { page: attr(shell, "data-vc-page"), width: attr(shell, "data-vc-width"), skin: attr(shell, "data-vc-skin"), overflowX: shell.scrollWidth - shell.clientWidth } : null,',
  '    palette: { backdrop: !!document.querySelector("' + SEL.paletteBackdrop + '"), input: !!document.querySelector("' + SEL.paletteInput + '"), rows: ids("[data-vc-palette-row]", "data-vc-palette-row") },',
  '    search: {',
  '      present: !!search,',
  '      inputs: document.querySelectorAll("' + SEL.searchInput + '").length,',
  '      paletteInputs: document.querySelectorAll("' + SEL.paletteInput + '").length,',
  '      empty: attr(document.querySelector("[data-vc-search-empty]"), "data-vc-search-empty"),',
  '      count: attr(document.querySelector("[data-vc-search-count]"), "data-vc-search-count"),',
  '      rows: ids("[data-vc-search-row]", "data-vc-search-row"),',
  '      groups: groups,',
  '      more: !!document.querySelector("[data-vc-search-more]"),',
  '    },',
  '    branch: { overlay: !!overlay, actions: ids("' + SEL.branchOverlay + ' [data-vc-branch-action]", "data-vc-branch-action"), rows: ids("' + SEL.branchOverlay + ' [data-vc-branch-pick]", "data-vc-branch-pick"), current: attr(document.querySelector("' + SEL.branchCurrent + '"), "data-vc-branch-pick"), confirm: !!document.querySelector("' + SEL.branchConfirm + '"), result: attr(document.querySelector("' + SEL.branchResult + '"), "data-vc-result"), close: !!document.querySelector("' + SEL.branchClose + '") },',
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

async function readState(page: PageHandle): Promise<Record<string, any> | null> {
  return evaluateValue<Record<string, any>>(page, STATE_SCRIPT)
}

export default defineScenario<ScenarioContext>({
  id: 'vc-1846-search-palette',
  title: '搜索页、命令面板遮罩与分支浮层的就地切换（#1846）',
  description: '在隔离 web 实例里进入版本管理页签，验命令面板遮罩的 Esc/点遮罩关闭与焦点回归、搜索页独立版式与三种状态、选中结果只跳入口，以及分支浮层列出本地分支、当前分支不可点、点一条按 4.3 的既有通路真的切过去（干净工作区直接执行，脏工作区先停确认卡），四个指路动作各自落到对应入口并拿到焦点。四档宽与深浅皮肤由源码闭包的并排对照图覆盖，这里验真机窗口下的交互接线与真实宿主行为。',
  hooks,
  steps: [
    { id: 'launch', kind: 'launch', title: '起一个装好候选包的隔离 web 实例' },
    {
      id: 'verify',
      kind: 'custom',
      timeoutMs: 900000,
      title: '进版本管理页签 → 验命令面板遮罩 → 搜索页三种状态 → 分支浮层清单与两次切换 → 四个指路落点',
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
        if (raw.goto !== undefined) await raw.goto(instance.record.tokenUrl)
        await sleep(2500)
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const masks = await evaluateValue<number>(page, 'document.querySelectorAll(' + JSON.stringify('[class*="_mask_"]') + ').length')
          if ((masks ?? 0) > 0) {
            await realPress(raw, 'Escape')
            await realClick(page, raw, SEL_CLOSE)
            await sleep(300)
            continue
          }
          if (await exists(page, SEL_WORKSPACE)) break
          await sleep(250)
        }
        if (await exists(page, SEL_WORKSPACE)) {
          await realClick(page, raw, SEL_WORKSPACE)
          await sleep(900)
          if (await waitFor(page, boolScript('[role=menuitem]'), 20, 200)) {
            await realClick(page, raw, '[role=menuitem]')
            await sleep(4000)
          }
        }
        // 先建一个会话再开右侧栏。2026-11-03 真机实测：只选工作区、不建会话时，右侧栏的
        // 「版本管理」页签点开也不挂载 #vc-real-root（等 15 秒也不会出现）；建完会话立刻就好。
        if (await exists(page, 'button[aria-label="新建会话"]')) {
          await realClick(page, raw, 'button[aria-label="新建会话"]')
          await sleep(4000)
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
        const pickGroup = (groups as any[]).find((g) => g.page !== 'search') ?? (groups as any[])[0]
        const pickId = pickGroup?.rows?.[0]
        if (typeof pickId === 'string') await realClick(page, raw, '[data-vc-search-row="' + pickId + '"]')
        const jumped = await waitFor(page, '(document.querySelector(' + JSON.stringify(SEL.vcRoot) + ') || { getAttribute: function () { return "" } }).getAttribute("data-vc-live-page") === ' + JSON.stringify(pickGroup?.page ?? ''), 40, 250)
        const jumpState = await readState(page)
        facts['8-search-jump'] = jumpState
        const hitRow = await evaluateValue<boolean>(page, '!!document.querySelector("[data-cap-hit]")')
        await shot(page, '1846-search-jump.png')
        results.push(observe({
          checkId: 'search-jump',
          title: '搜索页选中结果只跳到对应入口并高亮，不执行动作',
          ok: jumped && hitRow === true,
          detail: '选中 ' + String(pickId) + '（来源页 ' + String(pickGroup?.page) + '）→ 当前页 ' + String(jumpState?.root?.page) + '；落点高亮 ' + String(hitRow) + '；页面错误 ' + JSON.stringify(page.pageErrors().slice(0, 2)),
          expected: '当前页等于该能力所在页，且能力清单里那一行带 data-cap-hit',
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

        await shot(page, '1846-final.png')
        await save('1846-facts.json', { facts, pageErrors: page.pageErrors() }, '真机验证全过程读数：进入路径、命令面板、搜索页三态、分支浮层的清单与两次切换、四个指路落点')
        const failed = results.filter((r) => !r.ok).length
        results.push(observe({
          checkId: 'summary',
          title: '#1846 真机验证汇总',
          ok: failed === 0,
          detail: '共 ' + String(results.length) + ' 条检查，失败 ' + String(failed) + ' 条；证据 ' + String(evidence.length) + ' 份；页面错误 ' + String(page.pageErrors().length) + ' 条',
          evidence,
        }))
        return results
      },
    },
    { id: 'stop', kind: 'stop', title: '停掉实例' },
  ],
})
