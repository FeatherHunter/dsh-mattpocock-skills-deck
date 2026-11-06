// verify/scenarios/1858-branch-page.ts —— 真机验证 #1858：「分支与标签」页按定稿原型 38 的版式。
//
// 这个场景在隔离实例里跑，不碰真实 DSH 主目录：隔离 home 由批次流程复制，prepareHome 只改副本里的文件。
// 夹具仓库在仓库外（默认 <系统临时目录>/matt1858/fixture/repo），第一次运行时自动创建：
// 一条带上游的 main、三条各自不同上游状态的分支（领先 / 落后 / 没有上游）、一条并入 main 的旧分支，
// 一个轻量标签与一个附注标签，外加一条分支说明 —— 页面上的每一类事实都有一个真出处。
//
// 跑法（有头，推荐一种皮肤起一个实例）：
//   $env:DSH_HOME = <批次 home>
//   $env:DSH_1858_SKIN = 'dark'
//   node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js run verify/scenarios/1858-branch-page.ts --profile web --declaration verify/profile-1833-headed.ts --work-root <工作根> --json
//
// 四档宽用两种办法按顺序试，命中判据都是壳根的 data-vc-width 恰好等于目标值：
//   1. 拖右栏把手：先把窗口拉到够宽，再按「实测档位 − 目标档」真实拖 div[data-side="rightbar"]，最多 8 轮；
//   2. 退回窗口反解：适配器的 raw.resize 改窗口内宽，面板宽随之分段线性变化，最多 16 轮。
// 两条都拿不到就记 blocked 并写实际面板宽，不伪造。无头适配器没有窗口 resize 也没有鼠标，宽度那部分一律记 blocked。
//
// 可调环境变量：
//   DSH_1858_FIXTURE        夹具仓库（默认 <系统临时目录>/matt1858/fixture/repo）
//   DSH_1858_QUICK          1 = 只跑第一档宽与第一种皮肤，先要一张基线图
//   DSH_1858_WIDTHS         宽度清单，默认 300,380,460,520
//   DSH_1858_SKIN           启动前把皮肤锁成 dark 或 light（改隔离 home 的 ui-theme 偏好）
//   DSH_1858_SKINS          皮肤清单，默认跟着 DSH_1858_SKIN，没锁过就是 dark,light
//   DSH_1858_WINDOW_HEIGHT  有头窗口高度，默认 900
//
// 每档判定（PASS）的口径：壳根的 data-vc-page / data-vc-width / data-vc-skin 与目标一致；页头是「分支与标签」；
// 正文三段按序是 分支 → 标签 → 上游跟踪；两段标题上的条数与夹具一致；分支行、标签行按读数画出来；
// 三颗筛选胶囊与搜索框在；四条上游事实在；当前分支排第一行、其余按读数顺序；页尾只剩两条新建入口
// （新建并切换分支、建标签）；没有横向溢出、关键句没有被截断。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type {
  PageHandle,
  ScenarioContext,
  ScenarioHooks,
  ScenarioLaunchHookInfo,
  ScenarioObservation,
} from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { seedWorkspaceRegistry } from '../../scripts/real-machine/lib/workspace-seed.mts'
const CHECK_ID = 'vc-1858-branch-page'
const NEWLINE = String.fromCharCode(10)
const QUOTE = String.fromCharCode(34)

/** 夹具仓库：默认放在系统临时目录下，绝不能落进仓库或真实 DSH 主目录。 */
const FIXTURE_REPO = path.resolve(process.env.DSH_1858_FIXTURE || path.join(os.tmpdir(), 'matt1858', 'fixture', 'repo'))
const QUICK = process.env.DSH_1858_QUICK === '1'
const WIDTHS = String(process.env.DSH_1858_WIDTHS || '300,380,460,520')
  .split(',')
  .map((piece) => Number(piece.trim()))
  .filter((width): width is number => Number.isFinite(width) && width >= 260 && width <= 640)
type Skin = 'dark' | 'light'
const SKINS = String(process.env.DSH_1858_SKINS || process.env.DSH_1858_SKIN || 'dark,light')
  .split(',')
  .map((piece) => piece.trim())
  .filter((skin): skin is Skin => skin === 'dark' || skin === 'light')
const WINDOW_HEIGHT = Number(process.env.DSH_1858_WINDOW_HEIGHT || '900')
/** 本场景只验一页：管理索引里的「分支与标签」。 */
const PAGE = 'branch-tags' as const
type PageName = typeof PAGE
type Status = 'pass' | 'fail' | 'skip' | 'blocked'
type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const CLOSE_BUTTON = 'button[aria-label=' + QUOTE + '关闭' + QUOTE + ']'
const WORKSPACE_BUTTON = 'button[aria-label=' + QUOTE + '选择工作区' + QUOTE + ']'
const RAIL_BUTTON = 'button[aria-label=' + QUOTE + '打开右侧边栏' + QUOTE + ']'
const NEW_SESSION_BUTTON = 'button[aria-label=' + QUOTE + '新建会话' + QUOTE + ']'
const GUIDE_ENTRY_BUTTON = 'button[data-sidebar-right-guide-entry=' + QUOTE + 'dsh-mattpocock-skills-deck:deck-map' + QUOTE + ']'
const VC_TAB_BUTTON = 'button.dsws-tab[data-log=' + QUOTE + 'panel.tab.versioncontrol' + QUOTE + ']'
const LIST_TAB_BUTTON = 'button.dsws-tab[data-log=' + QUOTE + 'panel.tab.list' + QUOTE + ']'
const GEAR_BUTTON = 'button[data-vc-gear-btn]'
const BACK_BUTTON = 'button[data-vc-back]'
const BRANCH_PAGE_SELECTOR = '[data-vc-branch2]'
const BODY_DARK_SCRIPT = 'document.body.hasAttribute(' + QUOTE + 'data-ds-dark-theme' + QUOTE + ')'
const PASSWORD_INPUT_SCRIPT = 'document.querySelectorAll(' + JSON.stringify('input[type=password]') + ').length'
const MASK_COUNT_SCRIPT = 'document.querySelectorAll(' + JSON.stringify('[class*=' + QUOTE + '_mask_' + QUOTE + ']') + ').length'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function scriptOf(lines: readonly string[]): string {
  return lines.join(NEWLINE)
}

function snippet(value: string | null, max = 200): string {
  if (value === null) return ''
  return value.length <= max ? value : value.slice(0, max) + '……'
}

interface RawBrowserPage {
  goto?: (url: string) => Promise<unknown>
  click?: (selector: string) => Promise<Result<unknown>>
  press?: (key: string) => Promise<Result<unknown>>
  preset?: (id: string) => Promise<Result<unknown>>
  resize?: (width: number, height: number) => Promise<Result<unknown>>
  measureWindow?: () => Promise<Result<unknown>>
  page?: unknown
}

async function evaluateThrough<T>(page: PageHandle, script: string): Promise<Result<T>> {
  try {
    return await page.evaluate<T>(script)
  } catch (error) {
    return { ok: false, error: { code: 'evaluate-threw', message: messageOf(error) } }
  }
}

async function realClick(raw: RawBrowserPage, selector: string): Promise<{ ok: boolean; detail: string }> {
  if (typeof raw.click !== 'function') return { ok: false, detail: '浏览器适配器没有暴露 click()' }
  const clicked = await raw.click(selector)
  return clicked.ok ? { ok: true, detail: 'click ' + selector } : { ok: false, detail: clicked.error.message }
}

function domClickScript(selector: string): string {
  return scriptOf([
    `(function () {`,
    `  var el = document.querySelector(` + JSON.stringify(selector) + `);`,
    `  if (!el) { return { ok: false, reason: "not-found" }; }`,
    `  if (typeof el.scrollIntoView === "function") { el.scrollIntoView({ block: "center" }); }`,
    `  el.click();`,
    `  return { ok: true, tag: el.tagName, text: String(el.innerText || "").slice(0, 80) };`,
    `})()`,
  ])
}

function dataAttrClickScript(attr: string, value: string): string {
  return scriptOf([
    `(function () {`,
    `  var attr = ` + JSON.stringify(attr) + `;`,
    `  var wanted = ` + JSON.stringify(value) + `;`,
    `  var nodes = document.querySelectorAll("[" + attr + "]");`,
    `  for (var i = 0; i < nodes.length; i += 1) {`,
    `    if (nodes[i].getAttribute(attr) === wanted) {`,
    `      if (typeof nodes[i].scrollIntoView === "function") { nodes[i].scrollIntoView({ block: "center" }); }`,
    `      nodes[i].click();`,
    `      return { ok: true, index: i };`,
    `    }`,
    `  }`,
    `  return { ok: false, reason: "not-found", count: nodes.length };`,
    `})()`,
  ])
}

function existsScript(selector: string): string {
  return 'document.querySelector(' + JSON.stringify(selector) + ') !== null'
}

function pageHeadScript(pageName: PageName): string {
  return scriptOf([
    `(function () {`,
    `  var wanted = ` + JSON.stringify(pageName) + `;`,
    `  var nodes = document.querySelectorAll("[data-vc-page-head]");`,
    `  for (var i = 0; i < nodes.length; i += 1) {`,
    `    if (nodes[i].getAttribute("data-vc-page-head") === wanted) { return true; }`,
    `  }`,
    `  return false;`,
    `})()`,
  ])
}

function headListScript(): string {
  return scriptOf([
    `(function () {`,
    `  return Array.prototype.map.call(document.querySelectorAll("[data-vc-page-head]"), function (el) { return el.getAttribute("data-vc-page-head"); });`,
    `})()`,
  ])
}

function tabListScript(): string {
  return scriptOf([
    `(function () {`,
    `  return Array.prototype.map.call(document.querySelectorAll("button.dsws-tab"), function (el) { return { log: el.getAttribute("data-log"), text: String(el.innerText || "").slice(0, 40) }; });`,
    `})()`,
  ])
}

async function exists(page: PageHandle, selector: string): Promise<boolean> {
  const probe = await evaluateThrough<boolean>(page, existsScript(selector))
  return probe.ok && probe.value === true
}

async function waitFor(page: PageHandle, selector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await exists(page, selector)) return true
    await sleep(300)
  }
  return false
}
interface RpcProbe {
  readonly status: number
  readonly body: unknown
  readonly text: string
}

function rpcScript(method: string, argsExpression: string): string {
  return scriptOf([
    `(async function () {`,
    `  var rpcId = globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());`,
    `  var body = { type: ` + JSON.stringify('client-request') + `, rpcId: rpcId, method: ` + JSON.stringify(method) + `, payload: { args: ` + argsExpression + ` } };`,
    `  var response = await fetch(` + JSON.stringify('/api/') + ` + ` + JSON.stringify(method) + `, {`,
    `    method: ` + JSON.stringify('POST') + `,`,
    `    headers: { ` + JSON.stringify('content-type') + `: ` + JSON.stringify('application/json') + ` },`,
    `    body: JSON.stringify(body),`,
    `  });`,
    `  var text = await response.text();`,
    `  var parsed = null;`,
    `  try { parsed = JSON.parse(text); } catch (error) { parsed = null; }`,
    `  return { status: response.status, body: parsed, text: text.slice(0, 1500) };`,
    `})()`,
  ])
}

function rpcValue(probe: RpcProbe): Record<string, unknown> | null {
  const result = asRecord(asRecord(probe.body)?.result)
  return asRecord(result?.value)
}

function findId(value: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (value === null) return null
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  for (const nestedKey of ['workspace', 'session', 'request']) {
    const nested = asRecord(value[nestedKey])
    const found = findId(nested, keys)
    if (found !== null) return found
  }
  return null
}
/** 页面侧量到的布局事实；字段与 MEASURE_SCRIPT 的返回一致。 */
interface Box { x: number; y: number; w: number; h: number }
interface UiFacts {
  url: string
  innerW: number
  innerH: number
  outerW: number
  outerH: number
  dpr: number
  bodyDark: boolean
  themeSource: string | null
  bodyBg: string
  rootRect: Box | null
  liveRect: Box | null
  panelRect: Box | null
  attrWidth: string | null
  attrSkin: string | null
  attrPage: string | null
  attrDepth: string | null
  liveEmpty: string | null
  headAttrs: string[]
}

const MEASURE_SCRIPT = scriptOf([
  `(function () {`,
  `  function rectOf(el) {`,
  `    if (!el) { return null; }`,
  `    var r = el.getBoundingClientRect();`,
  `    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };`,
  `  }`,
  `  var root = document.querySelector("[data-vc-root]");`,
  `  var live = document.querySelector("#vc-real-root");`,
  `  var panel = document.querySelector(".dsws-body");`,
  `  return {`,
  `    url: location.href.slice(0, 200),`,
  `    innerW: window.innerWidth,`,
  `    innerH: window.innerHeight,`,
  `    outerW: window.outerWidth,`,
  `    outerH: window.outerHeight,`,
  `    dpr: window.devicePixelRatio,`,
  `    bodyDark: document.body.hasAttribute("data-ds-dark-theme"),`,
  `    themeSource: document.documentElement.getAttribute("data-ds-theme-source"),`,
  `    bodyBg: getComputedStyle(document.body).backgroundColor,`,
  `    rootRect: rectOf(root),`,
  `    liveRect: rectOf(live),`,
  `    panelRect: rectOf(panel),`,
  `    attrWidth: root ? root.getAttribute("data-vc-width") : null,`,
  `    attrSkin: root ? root.getAttribute("data-vc-skin") : null,`,
  `    attrPage: root ? root.getAttribute("data-vc-page") : null,`,
  `    attrDepth: root ? root.getAttribute("data-vc-depth") : null,`,
  `    liveEmpty: live ? live.getAttribute("data-vc-live-empty") : null,`,
  `    headAttrs: Array.prototype.map.call(document.querySelectorAll("[data-vc-page-head]"), function (el) { return el.getAttribute("data-vc-page-head"); }),`,
  `  };`,
  `})()`,
])

async function measureUi(page: PageHandle): Promise<Result<UiFacts>> {
  return evaluateThrough<UiFacts>(page, MEASURE_SCRIPT)
}
interface GitOutcome { readonly ok: boolean; readonly text: string }

/** 只在这个场景自己的夹具仓库里跑 git；git 始终带 protocol.file.allow=always，才能把本地目录当子模块来源。 */
function gitRun(cwd: string, args: readonly string[]): GitOutcome {
  const result = spawnSync('git', ['-c', 'protocol.file.allow=always'].concat(args), { cwd: cwd, encoding: 'utf8', timeout: 60000 })
  const stdout = typeof result.stdout === 'string' ? result.stdout : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr : ''
  return { ok: result.status === 0, text: stdout + stderr }
}

function writeFixtureFile(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf8')
}

function fixtureWorkspaceYaml(): string {
  return ['version: 2', 'backendId: markdown', 'pickedAt: 2026-11-03T00:00:00.000Z', 'source: user', 'layout: multi', ''].join(NEWLINE)
}

/** 把 dir 下的改动提交掉；没有改动就跳过，重复运行不会因为 nothing-to-commit 失败。 */
function commitAll(dir: string, message: string): GitOutcome {
  const added = gitRun(dir, ['add', '-A'])
  if (!added.ok) return added
  const status = gitRun(dir, ['status', '--porcelain'])
  if (!status.ok) return status
  if (status.text.trim().length === 0) return { ok: true, text: 'nothing-to-commit' }
  return gitRun(dir, ['commit', '-m', message])
}

function ensureCommitRepo(dir: string, fileContent: string): void {
  fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(path.join(dir, '.git'))) gitRun(dir, ['init', '-b', 'main'])
  writeFixtureFile(path.join(dir, 'README.md'), fileContent + NEWLINE)
  commitAll(dir, '初始化 1858 子模块夹具')
}
async function recordEvidence(context: ScenarioContext, name: string, value: unknown, note: string): Promise<string | null> {
  const saved = await context.evidence.recordJson(name, value, { note: note })
  if (!saved.ok) {
    console.log('[1858] 证据写入失败 ' + name + '：' + saved.error.message)
    return null
  }
  return saved.value.path
}

function summarizeResult(value: unknown): unknown {
  const record = asRecord(value)
  if (record === null) return value === undefined ? 'undefined' : String(value)
  if (record.ok === true) return 'ok'
  const error = asRecord(record.error)
  const message = error !== null && typeof error.message === 'string' ? error.message : String(record.error)
  return { ok: false, message: message }
}

/** 把隔离 home 的 ui-theme 偏好改成指定皮肤（只在宿主启动前、DSH_1858_SKIN 锁定某皮肤时用）。 */
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
const SIDEBAR_OPEN_BUTTON = 'button[aria-label=' + QUOTE + '打开侧边栏' + QUOTE + ']'
const GEAR_INDEX_SELECTOR = '[data-vc-gear-index]'

interface MainViewResult { readonly ok: boolean; readonly detail: string; readonly facts: Record<string, unknown> }
interface SkinResult { readonly ok: boolean; readonly blocked: boolean; readonly detail: string; readonly facts: Record<string, unknown> }
interface PageOpenResult { readonly ok: boolean; readonly detail: string; readonly facts: Record<string, unknown> }

function menuClickScript(texts: readonly string[]): string {
  return scriptOf([
    `(function () {`,
    `  var wanted = ` + JSON.stringify(texts) + `;`,
    `  var nodes = Array.prototype.slice.call(document.querySelectorAll("[role=menuitem],button"));`,
    `  for (var i = 0; i < nodes.length; i += 1) {`,
    `    var text = String(nodes[i].innerText || "").split(String.fromCharCode(10)).join(" ").trim();`,
    `    for (var j = 0; j < wanted.length; j += 1) {`,
    `      if (text.length > 0 && text.indexOf(wanted[j]) >= 0) {`,
    `        if (typeof nodes[i].scrollIntoView === "function") { nodes[i].scrollIntoView({ block: "center" }); }`,
    `        nodes[i].click();`,
    `        return { ok: true, text: text.slice(0, 60) };`,
    `      }`,
    `    }`,
    `  }`,
    `  return { ok: false, count: nodes.length };`,
    `})()`,
  ])
}

function sessionRowClickScript(): string {
  return scriptOf([
    `(function () {`,
    `  var rows = Array.prototype.slice.call(document.querySelectorAll("[data-row-key]"));`,
    `  for (var i = 0; i < rows.length; i += 1) {`,
    `    var key = String(rows[i].getAttribute("data-row-key") || "");`,
    `    if (key.indexOf("session:") === 0) {`,
    `      if (typeof rows[i].scrollIntoView === "function") { rows[i].scrollIntoView({ block: "center" }); }`,
    `      rows[i].click();`,
    `      return { ok: true, key: key };`,
    `    }`,
    `  }`,
    `  return { ok: false, count: rows.length };`,
    `})()`,
  ])
}

function workspaceRowNewSessionScript(title: string): string {
  return scriptOf([
    `(function () {`,
    `  var wanted = ` + JSON.stringify(title) + `;`,
    `  var rows = Array.prototype.slice.call(document.querySelectorAll("[data-row-key]"));`,
    `  for (var i = 0; i < rows.length; i += 1) {`,
    `    var key = String(rows[i].getAttribute("data-row-key") || "");`,
    `    var text = String(rows[i].innerText || "");`,
    `    if (key.indexOf("workspace:") !== 0) { continue; }`,
    `    if (wanted.length > 0 && text.indexOf(wanted) < 0) { continue; }`,
    `    var buttons = Array.prototype.slice.call(rows[i].querySelectorAll("button"));`,
    `    for (var j = 0; j < buttons.length; j += 1) {`,
    `      var label = String(buttons[j].getAttribute("aria-label") || "") + " " + String(buttons[j].innerText || "");`,
    `      if (label.indexOf("新建会话") >= 0) {`,
    `        buttons[j].click();`,
    `        return { ok: true, key: key, label: label.slice(0, 80) };`,
    `      }`,
    `    }`,
    `    rows[i].click();`,
    `    return { ok: true, key: key, label: "row-click" };`,
    `  }`,
    `  return { ok: false, count: rows.length };`,
    `})()`,
  ])
}

function rowKeysScript(): string {
  return scriptOf([
    `(function () {`,
    `  var rows = Array.prototype.slice.call(document.querySelectorAll("[data-row-key]"));`,
    `  var keys = rows.map(function (el) { return String(el.getAttribute("data-row-key") || ""); });`,
    `  return { count: keys.length, keys: keys.slice(0, 40) };`,
    `})()`,
  ])
}

async function clickSelector(page: PageHandle, raw: RawBrowserPage, selector: string): Promise<{ ok: boolean; detail: string }> {
  const real = await realClick(raw, selector)
  if (real.ok) return real
  const dom = await evaluateThrough<{ ok: boolean; reason?: string; tag?: string }>(page, domClickScript(selector))
  if (dom.ok && dom.value.ok === true) return { ok: true, detail: 'dom-click ' + selector }
  const reason = dom.ok ? String(dom.value.reason) : dom.error.message
  return { ok: false, detail: '点不到 ' + selector + '：' + real.detail + '；DOM 点击 ' + reason }
}

async function clickDataAttr(page: PageHandle, raw: RawBrowserPage, attr: string, value: string): Promise<{ ok: boolean; detail: string }> {
  const selector = '[' + attr + '=' + QUOTE + value + QUOTE + ']'
  const real = await realClick(raw, selector)
  if (real.ok) return real
  const dom = await evaluateThrough<{ ok: boolean; reason?: string }>(page, dataAttrClickScript(attr, value))
  if (dom.ok && dom.value.ok === true) return { ok: true, detail: 'dom-click [' + attr + '=' + value + ']' }
  return { ok: false, detail: '点不到 [' + attr + '=' + value + ']：' + real.detail }
}

async function bodyDarkOf(page: PageHandle): Promise<boolean | null> {
  const probe = await evaluateThrough<boolean>(page, BODY_DARK_SCRIPT)
  return probe.ok ? probe.value === true : null
}
async function openMainView(page: PageHandle, raw: RawBrowserPage, tokenUrl: string): Promise<MainViewResult> {
  const facts: Record<string, unknown> = {}
  if (await exists(page, RAIL_BUTTON)) {
    facts.strategy = 'already-main'
    return { ok: true, detail: '页面已经在主视图（右侧边栏按钮存在）', facts: facts }
  }
  const workspacePath = FIXTURE_REPO.split(String.fromCharCode(92)).join('/')
  const createProbe = await evaluateThrough<RpcProbe>(page, rpcScript('workspace/create', '{ request: { path: ' + JSON.stringify(workspacePath) + ' } }'))
  const workspaceId = createProbe.ok ? findId(rpcValue(createProbe.value), ['workspaceId']) : null
  facts.workspaceCreate = {
    ok: createProbe.ok,
    workspaceId: workspaceId,
    status: createProbe.ok ? createProbe.value.status : null,
    text: createProbe.ok ? snippet(createProbe.value.text, 300) : createProbe.error.message,
  }
  let sessionId: string | null = null
  if (workspaceId !== null) {
    const sessionProbe = await evaluateThrough<RpcProbe>(page, rpcScript('session/create', '{ request: { workspaceId: ' + JSON.stringify(workspaceId) + ' } }'))
    sessionId = sessionProbe.ok ? findId(rpcValue(sessionProbe.value), ['sessionId']) : null
    facts.sessionCreate = {
      ok: sessionProbe.ok,
      sessionId: sessionId,
      status: sessionProbe.ok ? sessionProbe.value.status : null,
      text: sessionProbe.ok ? snippet(sessionProbe.value.text, 300) : sessionProbe.error.message,
    }
  }
  await sleep(1200)
  // 探针已经证实：RPC 建好工作区与会话后，点顶栏「新建会话」会落到主视图。
  const newSessionClick = await clickSelector(page, raw, NEW_SESSION_BUTTON)
  facts.newSessionClick = newSessionClick
  await sleep(3500)
  if (await exists(page, RAIL_BUTTON)) {
    facts.strategy = 'rpc-then-new-session'
    return { ok: true, detail: 'RPC 建工作区与会话后点「新建会话」进入主视图', facts: facts }
  }
  // 兜底一：欢迎屏的工作区选择器。
  await clickSelector(page, raw, WORKSPACE_BUTTON)
  await sleep(900)
  const menuPicked = await evaluateThrough<{ ok: boolean; text?: string; count?: number }>(page, menuClickScript(['1858 夹具仓库', '验证工作区']))
  facts.menuPick = menuPicked.ok ? menuPicked.value : { ok: false, message: menuPicked.error.message }
  await sleep(3500)
  if (await exists(page, RAIL_BUTTON)) {
    facts.strategy = 'hero-menu'
    return { ok: true, detail: '从欢迎屏工作区菜单选夹具仓库后进入主视图', facts: facts }
  }
  // 兜底二：刷新页面后用左栏会话行进入。
  if (typeof raw.goto === 'function') await raw.goto(tokenUrl)
  await sleep(4500)
  if (await exists(page, SIDEBAR_OPEN_BUTTON)) {
    await clickSelector(page, raw, SIDEBAR_OPEN_BUTTON)
    await sleep(900)
  }
  const rowClick = await evaluateThrough<{ ok: boolean; key?: string; count?: number }>(page, sessionRowClickScript())
  facts.sessionRowClick = rowClick.ok ? rowClick.value : { ok: false, message: rowClick.error.message }
  await sleep(3000)
  if (await exists(page, RAIL_BUTTON)) {
    facts.strategy = 'reload-session-row'
    return { ok: true, detail: '刷新后从左栏会话行进入主视图', facts: facts }
  }
  // 兜底三：左栏工作区行里的「新建会话」按钮。
  const workspaceRowClick = await evaluateThrough<{ ok: boolean; key?: string; label?: string }>(page, workspaceRowNewSessionScript('1858 夹具仓库'))
  facts.workspaceRowClick = workspaceRowClick.ok ? workspaceRowClick.value : { ok: false, message: workspaceRowClick.error.message }
  await sleep(3000)
  if (await exists(page, RAIL_BUTTON)) {
    facts.strategy = 'sidebar-workspace-row'
    return { ok: true, detail: '从左栏工作区行新建会话进入主视图', facts: facts }
  }
  const rows = await evaluateThrough<{ count: number; keys: string[] }>(page, rowKeysScript())
  facts.rowKeys = rows.ok ? rows.value : null
  return { ok: false, detail: '四种入口都没能让页面进入主视图（右侧边栏按钮始终不存在）', facts: facts }
}

async function openVersionControlPanel(page: PageHandle, raw: RawBrowserPage): Promise<PageOpenResult> {
  const facts: Record<string, unknown> = {}
  const railClick = await clickSelector(page, raw, RAIL_BUTTON)
  facts.railClick = railClick
  await sleep(1500)
  const entryClick = await clickSelector(page, raw, GUIDE_ENTRY_BUTTON)
  facts.entryClick = entryClick
  let tabSeen = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await exists(page, VC_TAB_BUTTON)) {
      tabSeen = true
      break
    }
    await sleep(500)
  }
  facts.tabSeen = tabSeen
  if (!tabSeen) return { ok: false, detail: '点开插件入口后 30 秒内没出现版本管理页签；入口点击：' + entryClick.detail, facts: facts }
  const tabClick = await clickSelector(page, raw, VC_TAB_BUTTON)
  facts.tabClick = tabClick
  let ready = false
  let lastMeasure: Result<UiFacts> | null = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    lastMeasure = await measureUi(page)
    if (lastMeasure.ok && lastMeasure.value.attrWidth !== null && lastMeasure.value.liveEmpty === null) {
      ready = true
      break
    }
    await sleep(500)
  }
  facts.measure = lastMeasure !== null && lastMeasure.ok ? lastMeasure.value : lastMeasure === null ? null : summarizeResult(lastMeasure)
  if (!ready) {
    const measure = lastMeasure !== null && lastMeasure.ok ? lastMeasure.value : null
    const reason = measure === null ? '页面读数失败' : '壳根没挂出来（data-vc-width=' + String(measure.attrWidth) + '，liveEmpty=' + String(measure.liveEmpty) + '）'
    return { ok: false, detail: '版本管理页签 30 秒内没有画出页面：' + reason, facts: facts }
  }
  return { ok: true, detail: '版本管理页签已打开，壳根与页面已挂出', facts: facts }
}

async function ensureSkin(page: PageHandle, raw: RawBrowserPage, skin: Skin): Promise<SkinResult> {
  const facts: Record<string, unknown> = {}
  const desiredDark = skin === 'dark'
  let current = await bodyDarkOf(page)
  facts.bodyDarkBefore = current
  const before = await measureUi(page)
  facts.skinBefore = before.ok ? before.value.attrSkin : null
  if (current === desiredDark) {
    // 皮肤本来就对：壳根属性也对就直接用，不重挂。重挂一次反而会丢掉壳根的 data-vc-skin
    //   （实测 380 / 460 两档在「列表页签 → 版本管理页签」这一趟之后变成 null），
    //   而重挂只在 body 主题需要翻转时才必要。
    if (before.ok && before.value.attrSkin === skin) {
      facts.strategy = 'already-' + skin + '-no-remount'
      return { ok: true, blocked: false, detail: '页面已经是 ' + skin + ' 皮肤，壳根 data-vc-skin 也一致，不用重挂', facts: facts }
    }
    const remounted = await remountVersionControlTab(page, raw)
    facts.remount = remounted
    let after: Result<UiFacts> | null = null
    for (let attempt = 0; attempt < 25; attempt += 1) {
      after = await measureUi(page)
      if (after.ok && after.value.attrSkin === skin) break
      await sleep(400)
    }
    facts.skinAfter = after !== null && after.ok ? after.value.attrSkin : null
    if (after !== null && after.ok && after.value.attrSkin === skin) {
      facts.strategy = 'already-' + skin
      return { ok: true, blocked: false, detail: '页面已经是 ' + skin + ' 皮肤（重挂后壳根属性也一致）', facts: facts }
    }
    return { ok: false, blocked: true, detail: 'body 主题属性已经是 ' + skin + '，但壳根 data-vc-skin=' + String(facts.skinAfter) + '，重挂载后仍不一致', facts: facts }
  }
  const locked = String(process.env.DSH_1858_SKIN || '')
  if (locked !== '' && locked !== skin) {
    return { ok: false, blocked: true, detail: 'DSH_1858_SKIN 锁定了 ' + locked + '，不切到 ' + skin + '；body 当前 bodyDark=' + String(current), facts: facts }
  }
  // settings/mutate 的参数必须是「恰好一个普通对象」（{ ns, ops }）。按位置传两个参数会被网关拒：
  //   Remote payload must contain exactly one plain-object args field —— #1860 已踩过一次，这里沿用它的形状。
  const args = JSON.stringify({ ns: 'ui-theme', ops: [{ op: 'set', path: ['preference'], value: skin }] })
  const probe = await evaluateThrough<RpcProbe>(page, rpcScript('settings/mutate', args))
  facts.settingsMutate = {
    ok: probe.ok,
    status: probe.ok ? probe.value.status : null,
    value: probe.ok ? rpcValue(probe.value) : null,
    text: probe.ok ? snippet(probe.value.text, 400) : probe.error.message,
  }
  if (!probe.ok || probe.value.status >= 300) {
    return { ok: false, blocked: true, detail: 'settings/mutate 切 ' + skin + ' 失败（不是页面功能问题，是主题设置通道）；原始回包见证据', facts: facts }
  }
  let flipped = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    current = await bodyDarkOf(page)
    if (current === desiredDark) {
      flipped = true
      break
    }
    await sleep(400)
  }
  facts.bodyDarkFlipped = flipped
  if (!flipped) return { ok: false, blocked: true, detail: 'settings/mutate 返回成功，但 12 秒内 body 主题属性没有翻转', facts: facts }
  const remounted = await remountVersionControlTab(page, raw)
  facts.remount = remounted
  let skinOk = false
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const state = await measureUi(page)
    if (state.ok && state.value.attrSkin === skin) {
      skinOk = true
      break
    }
    await sleep(400)
  }
  facts.skinOk = skinOk
  if (!skinOk) return { ok: false, blocked: true, detail: 'body 主题已切到 ' + skin + '，但壳根 data-vc-skin 没有跟上（重挂载后仍不对）', facts: facts }
  return { ok: true, blocked: false, detail: '已切到 ' + skin + ' 皮肤并重挂载版本管理页签', facts: facts }
}

async function remountVersionControlTab(page: PageHandle, raw: RawBrowserPage): Promise<Record<string, unknown>> {
  const facts: Record<string, unknown> = {}
  const toList = await clickSelector(page, raw, LIST_TAB_BUTTON)
  facts.toList = toList
  if (!toList.ok) return facts
  await sleep(700)
  const toVc = await clickSelector(page, raw, VC_TAB_BUTTON)
  facts.toVc = toVc
  await sleep(1500)
  return facts
}

async function openManagePage(page: PageHandle, raw: RawBrowserPage, pageName: PageName): Promise<PageOpenResult> {
  const facts: Record<string, unknown> = {}
  if (await exists(page, BACK_BUTTON)) {
    facts.backClick = await clickSelector(page, raw, BACK_BUTTON)
    await sleep(800)
  }
  if (!(await exists(page, GEAR_INDEX_SELECTOR))) {
    facts.gearClick = await clickSelector(page, raw, GEAR_BUTTON)
    await sleep(800)
  }
  const itemClick = await clickDataAttr(page, raw, 'data-vc-gear-item', pageName)
  facts.itemClick = itemClick
  const headSelector = '[data-vc-page-head=' + QUOTE + pageName + QUOTE + ']'
  let headSeen = false
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await exists(page, headSelector)) {
      headSeen = true
      break
    }
    await sleep(400)
  }
  facts.headSeen = headSeen
  const measure = await measureUi(page)
  facts.measure = measure.ok ? measure.value : summarizeResult(measure)
  if (!headSeen) return { ok: false, detail: '点开「' + pageName + '」后 16 秒内没有出现页头；分区卡点击：' + itemClick.detail, facts: facts }
  return { ok: true, detail: '已打开「' + pageName + '」页（页头已出现）', facts: facts }
}
interface ObservationInput {
  readonly checkId: string
  readonly title: string
  readonly ok: boolean
  readonly detail: string
  readonly expected?: string
  readonly actual?: string
  readonly hint?: string
  readonly evidence?: readonly string[]
  readonly status?: Status
  readonly hard?: boolean
}

function observe(input: ObservationInput): ScenarioObservation {
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

// —— 右栏拖拽标定：真实拖拽右栏把手，把面板宽拖到目标档 ——

interface MouseLike {
  move: (x: number, y: number, options?: { steps?: number }) => Promise<void>
  down: () => Promise<void>
  up: () => Promise<void>
}

interface PlaywrightPageLike {
  mouse: MouseLike
}

/** 有头适配器把原始 Playwright 页面挂在句柄的 page 字段上；拖把手要真实指针事件，不能用 el.click()。 */
function playwrightPageOf(raw: RawBrowserPage): PlaywrightPageLike | null {
  const candidate = (raw as unknown as { page?: unknown }).page
  if (candidate === null || candidate === undefined || typeof candidate !== 'object') return null
  const mouse = (candidate as { mouse?: unknown }).mouse
  if (mouse === null || mouse === undefined || typeof mouse !== 'object') return null
  return candidate as PlaywrightPageLike
}

interface HandleRect { ok: boolean; reason?: string; x: number; y: number; width: number; height: number; innerW: number }

function handleRectScript(): string {
  return scriptOf([
    `(function () {`,
    `  var el = document.querySelector('[data-side="rightbar"]');`,
    `  if (!el) { return { ok: false, reason: "no-rightbar-handle" }; }`,
    `  var rect = el.getBoundingClientRect();`,
    `  return { ok: true, x: rect.left + rect.width / 2, y: Math.max(80, Math.min(window.innerHeight - 80, rect.top + rect.height / 2)), width: rect.width, height: rect.height, innerW: window.innerWidth };`,
    `})()`,
  ])
}
async function calibrateByDrag(
  page: PageHandle,
  raw: RawBrowserPage,
  target: number,
): Promise<WidthCalibration | null> {
  const playwrightPage = playwrightPageOf(raw)
  if (playwrightPage === null) return null
  const firstRect = await evaluateThrough<HandleRect>(page, handleRectScript())
  if (!firstRect.ok || !firstRect.value.ok) return null
  const trace: string[] = ['走右栏把手拖拽：真实鼠标按住把手横向拖，再读壳根 data-vc-width']
  let attempts = 0
  let drags = 0
  let last: Result<UiFacts> | null = null
  while (attempts < 8) {
    attempts += 1
    const state = await measureUi(page)
    last = state
    if (!state.ok) {
      trace.push('第 ' + String(attempts) + ' 次读数失败：' + state.error.message)
      break
    }
    const panelW = state.value.panelRect === null ? null : state.value.panelRect.w
    trace.push('第 ' + String(attempts) + ' 次 attr=' + String(state.value.attrWidth) + ' panel=' + String(panelW) + ' inner=' + String(state.value.innerW))
    const attr = state.value.attrWidth === null ? Number.NaN : Number(state.value.attrWidth)
    if (Number.isFinite(attr) && attr === target) {
      return { ok: true, via: 'drag', target: target, reached: attr, innerW: state.value.innerW, outerW: state.value.outerW, panelW: panelW, attempts: attempts, trace: trace }
    }
    const rectState = await evaluateThrough<HandleRect>(page, handleRectScript())
    if (!rectState.ok || !rectState.value.ok) {
      trace.push('第 ' + String(attempts) + ' 次找不到右栏把手：' + (rectState.ok ? String(rectState.value.reason) : rectState.error.message))
      break
    }
    const rect = rectState.value
    let delta = (Number.isFinite(attr) ? attr : 0) - target
    const maxStep = Math.max(40, Math.round(rect.innerW / 2))
    if (Math.abs(delta) > maxStep) delta = delta > 0 ? maxStep : -maxStep
    if (delta === 0) {
      trace.push('读数与目标差 0 但字符串对不上，停止')
      break
    }
    const startX = rect.x
    const targetX = Math.max(8, Math.min(rect.innerW - 8, startX + delta))
    await playwrightPage.mouse.move(startX, rect.y)
    await playwrightPage.mouse.down()
    await playwrightPage.mouse.move(targetX, rect.y, { steps: 14 })
    await playwrightPage.mouse.up()
    drags += 1
    await sleep(500)
  }
  const lastValue = last !== null && last.ok ? last.value : null
  const reached = lastValue !== null && lastValue.attrWidth !== null ? Number(lastValue.attrWidth) : null
  trace.push('拖拽 ' + String(drags) + ' 次后仍未命中；只记录实际读数')
  return {
    ok: false,
    via: 'drag',
    target: target,
    reached: Number.isFinite(reached) ? reached : null,
    innerW: lastValue === null ? 0 : lastValue.innerW,
    outerW: lastValue === null ? 0 : lastValue.outerW,
    panelW: lastValue === null || lastValue.panelRect === null ? null : lastValue.panelRect.w,
    attempts: attempts,
    trace: trace,
  }
}

interface WideWindowResult { readonly ok: boolean; readonly detail: string; readonly facts: Record<string, unknown> }

/** 把窗口拉宽到内宽至少 1400：右栏可拖范围是 [300, 视口×0.7]，宽屏才够放下四档目标宽。 */
async function ensureWideWindow(page: PageHandle, raw: RawBrowserPage): Promise<WideWindowResult> {
  const facts: Record<string, unknown> = {}
  if (typeof raw.resize !== 'function') {
    facts.resize = 'missing'
    return { ok: false, detail: '浏览器适配器没有 resize()：保留当前窗口宽，四档宽不一定够拖', facts: facts }
  }
  const inner = await page.innerSize()
  const outer = await page.outerSize()
  const innerW = inner.ok ? inner.value.width : 0
  const outerW = outer.ok ? outer.value.width : 0
  facts.before = { innerW: innerW, outerW: outerW }
  const chrome = Math.max(0, outerW - innerW)
  const resized = await raw.resize(Math.max(1400, innerW) + chrome, WINDOW_HEIGHT)
  facts.resize = resized.ok ? 'ok' : resized.error.message
  await sleep(900)
  const after = await page.innerSize()
  facts.after = after.ok ? after.value : null
  const widened = after.ok && after.value.width >= 1300
  return { ok: widened, detail: '窗口内宽从 ' + String(innerW) + ' 拉到 ' + String(after.ok ? after.value.width : '读不到'), facts: facts }
}
interface WidthCalibration {
  readonly ok: boolean
  readonly target: number
  readonly reached: number | null
  readonly innerW: number
  readonly outerW: number
  readonly panelW: number | null
  readonly attempts: number
  readonly trace: readonly string[]
  readonly via?: string
}

/** 把窗口反解到某一档面板宽：有头适配器 resize 后，壳根的 data-vc-width 必须正好等于目标档。 */
async function calibrateToWidth(
  page: PageHandle,
  raw: RawBrowserPage,
  target: number,
  windowByWidth: Map<number, number>,
): Promise<WidthCalibration> {
  const byDrag = await calibrateByDrag(page, raw, target)
  if (byDrag !== null && byDrag.ok) return byDrag
  const trace: string[] = byDrag === null ? [] : byDrag.trace.slice()
  if (byDrag === null) {
    trace.push('浏览器句柄没有原始 Playwright 页面或右栏把手不可见：改走窗口宽反解')
  } else {
    trace.push('拖拽标定没命中目标档：回退窗口宽反解')
  }
  const initial = await measureUi(page)
  if (typeof raw.resize !== 'function') {
    if (byDrag !== null) return byDrag
    const reached = initial.ok ? Number(initial.value.attrWidth) : null
    return {
      ok: false,
      target: target,
      reached: Number.isFinite(reached) ? reached : null,
      innerW: initial.ok ? initial.value.innerW : 0,
      outerW: initial.ok ? initial.value.outerW : 0,
      panelW: initial.ok && initial.value.panelRect !== null ? initial.value.panelRect.w : null,
      attempts: 0,
      trace: ['浏览器适配器没有 resize()：无头实例只能拿实际窗口宽，四档精确宽度记 blocked'],
    }
  }
  const chrome = initial.ok ? Math.max(0, initial.value.outerW - initial.value.innerW) : 16
  const seeds: number[] = []
  const stored = windowByWidth.get(target)
  if (stored !== undefined) seeds.push(stored)
  seeds.push(target + 705, target + 404, 800, 1005, 1100)
  let attempts = 0
  let last = initial
  let guess = seeds.shift() as number
  while (attempts < 16) {
    attempts += 1
    const outerTarget = Math.max(700, Math.round(guess + chrome))
    const resized = await raw.resize(outerTarget, WINDOW_HEIGHT)
    if (!resized.ok) {
      trace.push('第 ' + String(attempts) + ' 次 resize 失败：' + resized.error.message)
      break
    }
    await sleep(650)
    const state = await measureUi(page)
    if (!state.ok) {
      trace.push('第 ' + String(attempts) + ' 次读数失败：' + state.error.message)
      break
    }
    last = state
    const attrText = state.value.attrWidth
    const attr = attrText === null ? Number.NaN : Number(attrText)
    const panelW = state.value.panelRect === null ? null : state.value.panelRect.w
    trace.push(
      '第 ' + String(attempts) + ' 次 outer=' + String(state.value.outerW) + ' inner=' + String(state.value.innerW) + ' panel=' + String(panelW) + ' attr=' + String(attrText),
    )
    if (attrText !== null && Number.isFinite(attr) && attr === target) {
      windowByWidth.set(target, state.value.innerW)
      return { ok: true, target: target, reached: attr, innerW: state.value.innerW, outerW: state.value.outerW, panelW: panelW, attempts: attempts, trace: trace }
    }
    if (attrText === null) {
      trace.push('壳根不在页面上（读不到 data-vc-width）')
      break
    }
    guess = state.value.innerW + (target - attr)
    if (guess < 500 || guess > 2100) {
      if (seeds.length === 0) {
        trace.push('推算窗口内宽 ' + String(guess) + ' 超出可试范围')
        break
      }
      guess = seeds.shift() as number
    }
  }
  const reached = last.ok ? Number(last.value.attrWidth) : null
  return {
    ok: false,
    target: target,
    reached: Number.isFinite(reached) ? reached : null,
    innerW: last.ok ? last.value.innerW : 0,
    outerW: last.ok ? last.value.outerW : 0,
    panelW: last.ok && last.value.panelRect !== null ? last.value.panelRect.w : null,
    attempts: attempts,
    trace: trace,
  }
}
async function captureScreenshot(
  context: ScenarioContext,
  page: PageHandle,
  name: string,
): Promise<{ path: string | null; problem: string | null }> {
  const target = path.join(context.evidence.root, name + '.png')
  const shot = await page.screenshot(target)
  if (!shot.ok) return { path: null, problem: '截图失败：' + shot.error.message }
  const filed = await context.evidence.recordFile(target, { kind: 'screenshot', note: '1858 真机截图：' + name })
  if (!filed.ok) return { path: target, problem: '截图写出了，但没登记进证据：' + filed.error.message }
  return { path: filed.value.path, problem: null }
}

function describeChecks(checks: readonly Check[]): string {
  const failed = checks.filter((check) => !check.ok)
  if (failed.length === 0) return '结构判据全部通过（' + String(checks.length) + ' 项）'
  return '结构判据失败 ' + String(failed.length) + ' 项：' + failed.map((check) => check.id + '（' + check.detail + '）').join('；')
}
interface HostReadyResult { readonly ok: boolean; readonly detail: string; readonly facts: Record<string, unknown> }

async function waitForHostReady(
  page: PageHandle,
  raw: RawBrowserPage,
  instance: NonNullable<ScenarioContext['instance']>,
): Promise<HostReadyResult> {
  const facts: Record<string, unknown> = {}
  if (typeof raw.goto === 'function') await raw.goto(instance.record.tokenUrl)
  await sleep(2500)
  let maskCount = -1
  let workspaceButtonText: string | null = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const masks = await evaluateThrough<number>(page, MASK_COUNT_SCRIPT)
    maskCount = masks.ok ? masks.value : -1
    if (maskCount > 0) {
      if (typeof raw.press === 'function') await raw.press('Escape')
      await realClick(raw, CLOSE_BUTTON)
      await sleep(300)
      continue
    }
    const text = await page.text(WORKSPACE_BUTTON)
    if (text.ok && text.value !== null) {
      workspaceButtonText = text.value
      break
    }
    await sleep(250)
  }
  const passwordInputs = await evaluateThrough<number>(page, PASSWORD_INPUT_SCRIPT)
  const pageUrl = page.url()
  const ready =
    maskCount === 0 &&
    workspaceButtonText !== null &&
    passwordInputs.ok &&
    passwordInputs.value === 0 &&
    pageUrl.indexOf(instance.record.originUrl) === 0
  facts.url = pageUrl
  facts.origin = instance.record.originUrl
  facts.maskCount = maskCount
  facts.workspaceButtonText = workspaceButtonText
  facts.passwordInputs = passwordInputs.ok ? passwordInputs.value : null
  const detail = ready
    ? '页面停在宿主工作台：工作区按钮「' + String(workspaceButtonText) + '」，没有首开弹窗与密码框'
    : '页面没就绪：遮罩 ' + String(maskCount) + ' 个，工作区按钮 ' + (workspaceButtonText === null ? '没找到' : '「' + workspaceButtonText + '」') + '，密码输入框 ' + String(passwordInputs.ok ? passwordInputs.value : '读不到') + '，URL ' + pageUrl
  return { ok: ready, detail: detail, facts: facts }
}

// —— 夹具仓库：一个真有上游、真有并入与没并入、真有附注标签的仓库 ——

interface FixtureFacts {
  readonly branchCount: number
  readonly tagCount: number
  readonly mergedCount: number
  readonly notMergedCount: number
  readonly branches: readonly string[]
}

/** 造夹具：bare origin + 一个工作仓库；分支与标签的每一种上游状态都造一个出来。 */
function ensureFixtureRepo(): { ok: boolean; detail: string; facts: Record<string, unknown> } {
  const facts: Record<string, unknown> = { repo: FIXTURE_REPO }
  try {
    const origin = path.resolve(FIXTURE_REPO, '..', 'origin.git')
    // 每次从零重建：这套夹具要造「领先 / 落后 / 没有上游 / 已并入」四种状态，在旧仓库上重跑
    // 会因为分支已存在、提交没有新内容而悄悄退化（上一轮就退化成全部齐平）。临时目录里的东西，删了最稳。
    fs.rmSync(FIXTURE_REPO, { recursive: true, force: true })
    fs.rmSync(origin, { recursive: true, force: true })
    fs.mkdirSync(FIXTURE_REPO, { recursive: true })
    if (!fs.existsSync(path.join(origin, 'HEAD'))) {
      fs.mkdirSync(origin, { recursive: true })
      gitRun(origin, ['init', '--bare', '-b', 'main'])
    }
    if (!fs.existsSync(path.join(FIXTURE_REPO, '.git'))) {
      gitRun(FIXTURE_REPO, ['init', '-b', 'main'])
      gitRun(FIXTURE_REPO, ['config', 'user.name', '1858 验证'])
      gitRun(FIXTURE_REPO, ['config', 'user.email', 'verify1858@example.com'])
    }
    writeFixtureFile(path.join(FIXTURE_REPO, 'README.md'), '# 1858 夹具仓库' + NEWLINE + NEWLINE + '真机验证用的临时仓库，不是产品代码。' + NEWLINE)
    writeFixtureFile(path.join(FIXTURE_REPO, 'docs', 'agents', 'workspace.yaml'), fixtureWorkspaceYaml())
    commitAll(FIXTURE_REPO, '初始化 1858 夹具仓库')
    // 上游：本地 bare 仓库，页面读的是本地上游跟踪引用，不联网。
    if (gitRun(FIXTURE_REPO, ['remote', 'get-url', 'origin']).ok === false) {
      gitRun(FIXTURE_REPO, ['remote', 'add', 'origin', origin])
    }
    gitRun(FIXTURE_REPO, ['push', '-u', 'origin', 'main', '--force'])
    // main 再走两步并推上去：与上游齐平。
    writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'a.txt'), 'a' + NEWLINE)
    commitAll(FIXTURE_REPO, '加一个文件')
    writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'b.txt'), 'b' + NEWLINE)
    commitAll(FIXTURE_REPO, '再加一个文件')
    gitRun(FIXTURE_REPO, ['push', 'origin', 'main'])
    // 分支说明（4.13 写的就是这条配置，页面会把它画在说明行里）。
    gitRun(FIXTURE_REPO, ['config', 'branch.main.description', '主干；发布从这里切'])
    // 领先：本地比上游多一笔。
    gitRun(FIXTURE_REPO, ['switch', '-c', 'feature/vc-redesign'])
    writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'branch-work.txt'), 'w' + NEWLINE)
    commitAll(FIXTURE_REPO, '分支上的改动')
    gitRun(FIXTURE_REPO, ['push', '-u', 'origin', 'feature/vc-redesign'])
    writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'branch-work2.txt'), 'w2' + NEWLINE)
    commitAll(FIXTURE_REPO, '没推上去的一笔')
    // 落后：从 main 切出来就停住，跟踪 origin/main；随后 main 自己再往前一步并推上去，
    // 这条分支相对上游就落后一笔（不是「推上去再说落后」，那样两头一样、永远是齐平）。
    gitRun(FIXTURE_REPO, ['switch', 'main'])
    gitRun(FIXTURE_REPO, ['switch', '-c', 'release/2026-10'])
    gitRun(FIXTURE_REPO, ['branch', '--set-upstream-to=origin/main', 'release/2026-10'])
    gitRun(FIXTURE_REPO, ['switch', 'main'])
    writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'c.txt'), 'c' + NEWLINE)
    commitAll(FIXTURE_REPO, '主干又走了一步')
    gitRun(FIXTURE_REPO, ['push', 'origin', 'main'])
    // 没有上游：只建分支、不设跟踪。
    gitRun(FIXTURE_REPO, ['switch', 'main'])
    gitRun(FIXTURE_REPO, ['switch', '-c', 'fix/rail-tab-overflow'])
    writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'fix.txt'), 'f' + NEWLINE)
    commitAll(FIXTURE_REPO, '修一处溢出')
    // 已并入：从 main 切出来、没有再提交的分支就是已并入的那一类。
    gitRun(FIXTURE_REPO, ['switch', 'main'])
    gitRun(FIXTURE_REPO, ['branch', 'chore/docs-cleanup'])
    // 标签：一个轻量、一个附注。
    gitRun(FIXTURE_REPO, ['tag', 'v1.8.0', 'HEAD~2'])
    gitRun(FIXTURE_REPO, ['tag', '-a', 'v1.9.0', '-m', '发布 1.9.0'])
    const branches = gitRun(FIXTURE_REPO, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])
    const tags = gitRun(FIXTURE_REPO, ['for-each-ref', '--format=%(refname:short)', 'refs/tags/'])
    const merged = gitRun(FIXTURE_REPO, ['branch', '--merged', 'main'])
    const notMerged = gitRun(FIXTURE_REPO, ['branch', '--no-merged', 'main'])
    const names = branches.text.split(NEWLINE).map((line) => line.trim()).filter((line) => line.length > 0)
    const tagNames = tags.text.split(NEWLINE).map((line) => line.trim()).filter((line) => line.length > 0)
    const mergedNames = merged.text.split(NEWLINE).map((line) => line.replace('*', '').trim()).filter((line) => line.length > 0)
    const notMergedNames = notMerged.text.split(NEWLINE).map((line) => line.replace('*', '').trim()).filter((line) => line.length > 0)
    facts.branches = names
    facts.tags = tagNames
    facts.merged = mergedNames
    facts.notMerged = notMergedNames
    if (names.length < 4 || tagNames.length !== 2 || !merged.ok || !notMerged.ok) {
      return { ok: false, detail: '夹具分支或标签不齐：分支 ' + names.join('、') + '；标签 ' + tagNames.join('、'), facts: facts }
    }
    if (mergedNames.indexOf('chore/docs-cleanup') < 0) {
      return { ok: false, detail: '「已并入」那条分支没被 git 认成已并入：' + mergedNames.join('、'), facts: facts }
    }
    return { ok: true, detail: '夹具就绪：' + String(names.length) + ' 条分支（已并入 ' + String(mergedNames.length) + '、没并入 ' + String(notMergedNames.length) + '）、' + String(tagNames.length) + ' 个标签', facts: facts }
  } catch (error) {
    return { ok: false, detail: '夹具仓库准备失败：' + messageOf(error), facts: facts }
  }
}

// —— 页面读数与判据 ——

function pageTitleOf(_pageName: PageName): string {
  return '分支与标签'
}

interface Check { readonly id: string; readonly ok: boolean; readonly detail: string; readonly actual?: string }

interface BranchPageFacts {
  url: string
  innerW: number
  bodyDark: boolean
  attrWidth: string | null
  attrSkin: string | null
  attrPage: string | null
  attrDepth: string | null
  headTitle: string
  headBack: boolean
  sections: string[]
  counts: string[]
  branchRows: string[]
  rowMetas: string[]
  /** 每行分支的说明行（.obj-sub）文字：第一条是「时间 · 提交主题」，有分支说明时第二条才是说明。 */
  rowSubs: string[][]
  tagRows: string[]
  tagAnnotated: string[]
  filters: string[]
  hasQuery: boolean
  facts: string[]
  factValues: string[]
  current: string | null
  scope: string | null
  forms: string | null
  listCount: string | null
  tagListCount: string | null
  noData: boolean
  state: string | null
  notice: string
  docOverflow: { scrollW: number; clientW: number }
  pageOverflow: { scrollW: number; clientW: number } | null
  clipped: string[]
}

function inspectScript(): string {
  return scriptOf([
    '(function () {',
    '  function q(selector) { return document.querySelector(selector) }',
    '  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)) }',
    '  function norm(value) {',
    '    var text = String(value || "")',
    '    text = text.split(String.fromCharCode(10)).join(" ")',
    '    text = text.split(String.fromCharCode(9)).join(" ")',
    '    while (text.indexOf("  ") >= 0) { text = text.split("  ").join(" ") }',
    '    return text.trim()',
    '  }',
    '  function texts(selector) { return all(selector).map(function (el) { return norm(el.textContent) }) }',
    '  function attrOf(selector, name) { var el = q(selector); return el === null ? null : el.getAttribute(name) }',
    '  var root = q("[data-vc-shell]")',
    '  var page = q("[data-vc-branch2]")',
    '  var head = q("[data-vc-page-head=branch-tags]")',
    '  var clipped = []',
    '  all(".vcs-branch2-name, .obj-meta, .obj-sub, .section-title, .section-note, .vcs-page-title, .vcs-page-lede").forEach(function (el) {',
    '    if (el.scrollWidth > el.clientWidth + 1) clipped.push(norm(el.className))',
    '  })',
    '  return {',
    '    url: location.href.slice(0, 200),',
    '    innerW: window.innerWidth,',
    '    bodyDark: document.body.hasAttribute("data-ds-dark-theme"),',
    '    attrWidth: root === null ? null : root.getAttribute("data-vc-width"),',
    '    attrSkin: root === null ? null : root.getAttribute("data-vc-skin"),',
    '    attrPage: root === null ? null : root.getAttribute("data-vc-page"),',
    '    attrDepth: root === null ? null : root.getAttribute("data-vc-depth"),',
    '    headTitle: head === null ? "" : norm((head.querySelector(".vcs-page-title") || {}).textContent),',
    '    headBack: head !== null && head.querySelector("[data-vc-back]") !== null,',
    '    sections: texts("[data-vc-branch2] .page-section .section-title"),',
    '    counts: texts("[data-vc-branch2] .page-section .section-count"),',
    '    branchRows: all("[data-vc-branch-row]").map(function (el) { return el.getAttribute("data-vc-branch-row") }),',
    '    rowMetas: all("[data-vc-branch-row]").map(function (el) { var meta = el.querySelector(".obj-meta"); return norm(meta === null ? "" : meta.textContent) }),',
    '    rowSubs: all("[data-vc-branch-row]").map(function (el) { return Array.prototype.slice.call(el.querySelectorAll(".obj-sub")).map(function (s) { return norm(s.textContent) }) }),',
    '    tagRows: all("[data-vc-tag-row]").map(function (el) { return el.getAttribute("data-vc-tag-row") }),',
    '    tagAnnotated: all("[data-vc-tag-row]").map(function (el) { return el.getAttribute("data-vc-tag-annotated") }),',
    '    filters: all("[data-vc-branch-filter]").map(function (el) { return el.getAttribute("data-vc-branch-filter") }),',
    '    hasQuery: q("[data-vc-branch-query]") !== null,',
    '    facts: texts("[data-vc-branch2] .fact-grid .fact-key"),',
    '    factValues: texts("[data-vc-branch2] .fact-grid .fact-value"),',
    '    current: attrOf("[data-vc-branch-current]", "data-vc-branch-current"),',
    '    scope: attrOf("[data-vc-branch-scope]", "data-vc-branch-scope"),',
    '    forms: attrOf("[data-vc-branch-forms]", "data-vc-branch-forms"),',
    '    listCount: attrOf("[data-vc-branch-list]", "data-vc-branch-list"),',
    '    tagListCount: attrOf("[data-vc-tag-list]", "data-vc-tag-list"),',
    '    noData: q("[data-vc-branch2-empty]") !== null,',
    '    state: attrOf("[data-vc-branch-state]", "data-vc-branch-state"),',
    '    notice: norm((q("[data-vc-branch2]") || {}).textContent).slice(0, 220),',
    '    docOverflow: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth },',
    '    pageOverflow: page === null ? null : { scrollW: page.scrollWidth, clientW: page.clientWidth },',
    '    clipped: clipped,',
    '  };',
    '})()',
  ])
}

/** 逐条判据：每一条都对着票面「做完」里的一句话，或者对着原型 38 的一个区块。 */
function checkBranchPage(facts: BranchPageFacts, fixture: FixtureFacts, width: number, skin: Skin, pageName: PageName): Check[] {
  const checks: Check[] = []
  const push = (id: string, ok: boolean, detail: string, actual?: string): void => {
    checks.push(actual === undefined ? { id: id, ok: ok, detail: detail } : { id: id, ok: ok, detail: detail, actual: actual })
  }
  const title = pageTitleOf(pageName)
  push('page-root', facts.attrPage === pageName, '壳根报的是「' + title + '」页', String(facts.attrPage))
  push('page-depth', facts.attrDepth === '2', '二级页层级是 2（管理分区页）', String(facts.attrDepth))
  push('page-head', facts.headTitle === title, '页头标题是「' + title + '」', facts.headTitle)
  push('page-head-back', facts.headBack, '页头有返回键（二级页）', String(facts.headBack))
  push('sections', facts.sections.join(',') === '分支,标签,上游跟踪', '正文三段是 分支 → 标签 → 上游跟踪', facts.sections.join(','))
  push('section-counts',
    facts.counts.length === 2 && facts.counts[0].indexOf(String(fixture.branchCount) + ' 条本地分支') === 0 && facts.counts[1].indexOf(String(fixture.tagCount) + ' 个标签') === 0,
    '两段标题上的条数与夹具一致（' + String(fixture.branchCount) + ' 条分支 / ' + String(fixture.tagCount) + ' 个标签）',
    facts.counts.join(' | '))
  push('branch-rows', facts.branchRows.length === fixture.branchCount && fixture.branches.every((name) => facts.branchRows.indexOf(name) >= 0),
    '分支行逐条画出来（' + String(fixture.branchCount) + ' 行）', facts.branchRows.join(','))
  // #1881：当前分支必须排第一行，其余保持读数的顺序。夹具的分支清单来自 for-each-ref（字母序），
  //   当前分支 main 排在中间，所以这条判据只有页面真做了「当前分支先排」才过得去。
  const restRows = facts.branchRows.slice(1)
  const restExpected = fixture.branches.filter((name) => name !== facts.current)
  push('branch-order', facts.current !== null && facts.current !== '' && facts.branchRows[0] === facts.current && restRows.join(',') === restExpected.join(','),
    '当前分支排第一行，其余保持读数顺序', facts.branchRows.join(','))
  // 票面点名的五个区块里，领先与落后必须真的画出来：夹具里有一条领先、一条落后，画不出来就是这一行没走到。
  push('ahead-shown', facts.rowMetas.some((meta) => meta.indexOf('领先') >= 0), '至少一条分支行画出「领先 N」', facts.rowMetas.join(' | ').slice(0, 200))
  push('behind-shown', facts.rowMetas.some((meta) => meta.indexOf('落后') >= 0), '至少一条分支行画出「落后 N」', facts.rowMetas.join(' | ').slice(0, 200))
  push('no-upstream-shown', facts.rowMetas.some((meta) => meta.indexOf('没有上游') >= 0), '没有上游的那条分支说得出「没有上游」', facts.rowMetas.join(' | ').slice(0, 200))
  // #1883：分支行的第三行是「时间 · 提交主题」（原型 38 的写法）。夹具里每条分支顶上都有一次提交，
  //   所以这一行必须既有时间也有主题；只有时间说明主题没读到，只有主题说明时间没读到，两种都要判红。
  const subsByRow = facts.rowSubs
  const subjectLinesOk = subsByRow.length === fixture.branchCount
    && subsByRow.every((lines) => lines.length >= 1 && lines[0].indexOf(' · ') > 0 && lines[0].split(' · ').slice(1).join(' · ').trim() !== '')
  push('row-subject-line', subjectLinesOk, '每条分支行的第三行都是「时间 · 提交主题」', subsByRow.map((lines) => lines.join(' | ')).join(' / ').slice(0, 240))
  // 夹具只给 main 配了分支说明；它必须另占一行（.obj-sub 第二条），不跟主题拼在同一行里。
  const currentIndex = facts.current === null ? -1 : facts.branchRows.indexOf(facts.current)
  const currentSubs = currentIndex >= 0 ? subsByRow[currentIndex] : []
  push('row-description-line', currentSubs.length === 2 && currentSubs[1] === '主干；发布从这里切',
    '分支说明有值时单独一行，不跟时间与主题抢同一行', currentSubs.join(' | '))
  push('tag-rows', facts.tagRows.length === fixture.tagCount, '标签行逐条画出来（' + String(fixture.tagCount) + ' 行）', facts.tagRows.join(','))
  push('tag-annotated', facts.tagAnnotated.indexOf('1') >= 0 && facts.tagAnnotated.indexOf('0') >= 0, '附注标签与轻量标签分得开', facts.tagAnnotated.join(','))
  push('filters', facts.filters.join(',') === 'all,current,unmerged', '三颗筛选胶囊按序在', facts.filters.join(','))
  push('search', facts.hasQuery, '按分支名搜索的输入框在', String(facts.hasQuery))
  push('tracking-facts', facts.facts.join(',') === '当前分支,上游,领先 / 落后,上游依据', '上游跟踪段是四条事实', facts.facts.join(','))
  push('tracking-current', facts.current !== null && facts.current.length > 0, '当前分支读数画出来了', String(facts.current))
  push('write-forms', facts.forms === '2', '页尾只剩两条新建入口（新建并切换分支、建标签）', String(facts.forms))
  push('no-empty', facts.noData === false, '有读数时不画「还没读到」的空态', String(facts.noData))
  push('no-horizontal-overflow',
    facts.docOverflow.scrollW <= facts.innerW + 1 && (facts.pageOverflow === null || facts.pageOverflow.scrollW <= facts.pageOverflow.clientW + 1),
    String(width) + ' 宽没有横向溢出',
    '文档 ' + String(facts.docOverflow.scrollW) + ' ≤ 视口 ' + String(facts.docOverflow.clientW) + '；页面 ' + (facts.pageOverflow === null ? '没量到' : String(facts.pageOverflow.scrollW) + ' / ' + String(facts.pageOverflow.clientW)))
  push('no-clipped', facts.clipped.length === 0, '关键句没有被横向截断', facts.clipped.join(',') || '无')
  push('width-attr', facts.attrWidth === String(width), '壳根 data-vc-width 是目标档', String(facts.attrWidth))
  push('skin-attr', facts.attrSkin === skin, '壳根 data-vc-skin 是目标皮肤', String(facts.attrSkin))
  push('body-theme', facts.bodyDark === (skin === 'dark'), '页面主题与目标皮肤一致', String(facts.bodyDark))
  return checks
}

/** 一个组合（宽度 × 皮肤）：切皮肤 → 开页面 → 标定宽度 → 读结构 → 截图 → 判定。 */
async function captureAt(
  context: ScenarioContext,
  page: PageHandle,
  raw: RawBrowserPage,
  fixture: FixtureFacts,
  width: number,
  skin: Skin,
  windowByWidth: Map<number, number>,
): Promise<ScenarioObservation[]> {
  const checkId = 'vc-1858-branch-tags-w' + String(width) + '-' + skin
  const label = '分支与标签页 / ' + String(width) + 'px / ' + skin
  const title = '「分支与标签」页在 ' + String(width) + 'px 宽、' + skin + ' 皮肤下的真机实测'
  const facts: Record<string, unknown> = { checkId: checkId, page: PAGE, width: width, skin: skin }
  const paths: string[] = []
  const skinResult = await ensureSkin(page, raw, skin)
  facts.skinResult = skinResult
  if (!skinResult.ok) {
    const shot = await captureScreenshot(context, page, '1858-branch-tags-w' + String(width) + '-' + skin + '-skin-blocked')
    if (shot.path !== null) paths.push(shot.path)
    const saved = await recordEvidence(context, checkId + '-blocked.json', { facts: facts, screenshot: shot }, label + ' 的皮肤切换失败读数')
    if (saved !== null) paths.push(saved)
    return [observe({
      checkId: checkId,
      title: title,
      ok: false,
      status: 'blocked',
      hard: false,
      detail: '皮肤切换没做成，这个组合没有截图结论：' + skinResult.detail,
      expected: '页面能切到 ' + skin + ' 皮肤（body 主题属性与壳根 data-vc-skin 一致）',
      actual: JSON.stringify(skinResult.facts).slice(0, 500),
      hint: '主题设置通道或重挂载路径变了；看证据里的 skinResult 与主题 RPC 回包',
      evidence: paths,
    })]
  }
  const pageResult = await openManagePage(page, raw, PAGE)
  facts.pageOpen = pageResult
  if (!pageResult.ok) {
    const shot = await captureScreenshot(context, page, '1858-branch-tags-w' + String(width) + '-' + skin + '-page-blocked')
    if (shot.path !== null) paths.push(shot.path)
    const saved = await recordEvidence(context, checkId + '-blocked.json', { facts: facts, screenshot: shot }, label + ' 的页面打开失败读数')
    if (saved !== null) paths.push(saved)
    return [observe({
      checkId: checkId,
      title: title,
      ok: false,
      status: 'blocked',
      hard: false,
      detail: '分支与标签页没打开，这个组合没有截图结论：' + pageResult.detail,
      expected: '点齿轮索引里的「分支与标签」卡片后出现页头 data-vc-page-head=branch-tags',
      actual: JSON.stringify(pageResult.facts).slice(0, 600),
      hint: '齿轮索引卡片或页头锚点变了；看证据里的 pageOpen',
      evidence: paths,
    })]
  }
  // 进页面那一下会发一次读分支的电话；读数没回来之前页面只有空态，判据会全红。
  // 所以先等「有分支行」出现（最多 12 秒），读失败也照实等——那种情况下面会带着失败原因记成红。
  let waited = 0
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const probe = await evaluateThrough<number>(page, 'document.querySelectorAll(' + JSON.stringify('[data-vc-branch-row]') + ').length')
    if (probe.ok && probe.value > 0) break
    waited += 400
    await sleep(400)
  }
  facts.waitedMs = waited
  const calibration = await calibrateToWidth(page, raw, width, windowByWidth)
  facts.calibration = calibration
  const inspect = await evaluateThrough<BranchPageFacts>(page, inspectScript())
  facts.inspect = inspect.ok ? inspect.value : summarizeResult(inspect)
  const checks = inspect.ok ? checkBranchPage(inspect.value, fixture, width, skin, PAGE) : []
  facts.structureChecks = checks
  const shot = await captureScreenshot(context, page, '1858-branch-tags-w' + String(width) + '-' + skin)
  if (shot.path !== null) paths.push(shot.path)
  if (shot.problem !== null) facts.screenshotProblem = shot.problem
  const attrWidth = inspect.ok ? inspect.value.attrWidth : null
  const widthOk = calibration.ok && attrWidth === String(width)
  const structureOk = inspect.ok && checks.length > 0 && checks.every((check) => check.ok)
  const ok = widthOk && structureOk
  const status: Status = ok ? 'pass' : widthOk ? 'fail' : 'blocked'
  const failedIds = checks.filter((check) => !check.ok).map((check) => check.id)
  facts.verdict = { widthOk: widthOk, structureOk: structureOk, failedIds: failedIds }
  const saved = await recordEvidence(context, checkId + '.json', facts, label + ' 的完整读数：窗口尺寸、面板宽、壳根属性、结构判据与截图路径')
  if (saved !== null) paths.push(saved)
  const actualParts: string[] = []
  actualParts.push('窗口内宽 ' + String(calibration.innerW) + '，外框宽 ' + String(calibration.outerW) + '，面板读数宽 ' + String(calibration.panelW))
  actualParts.push('壳根 data-vc-width=' + String(attrWidth))
  if (inspect.ok) actualParts.push('三段 ' + inspect.value.sections.join('/') + '；条数 ' + inspect.value.counts.join(' | '))
  if (failedIds.length > 0) actualParts.push('失败判据：' + failedIds.join('、'))
  actualParts.push('标定方式 ' + String(calibration.via === undefined ? 'resize' : calibration.via) + '，尝试 ' + String(calibration.attempts) + ' 次')
  const detail = ok
    ? label + '：宽度与结构都到位，' + describeChecks(checks)
    : label + '：' + (widthOk ? '宽度到位但' : '宽度没到位（实际 ' + String(calibration.reached) + '）且') + (structureOk ? '结构判据通过' : describeChecks(checks))
  return [observe({
    checkId: checkId,
    title: title,
    ok: ok,
    status: status,
    hard: widthOk,
    detail: detail,
    expected: '壳根 data-vc-width 正好等于 ' + String(width) + '；正文三段按序、两段条数与读数一致、行与筛选与事实齐全，且无横向溢出、无文字截断',
    actual: actualParts.join('；'),
    hint: status === 'blocked' ? '窄档靠窗口宽反解面板宽，没标定到目标档就如实记 blocked；看证据里的 calibration.trace' : '逐项看 structureChecks 里的失败判据与截图',
    evidence: paths,
  })]
}

/** 筛选与搜索在真机上真的生效：只在 460 宽深色点一次、输入一次，看行数与计数跟着变。 */
async function interactionAt(
  context: ScenarioContext,
  page: PageHandle,
  raw: RawBrowserPage,
  fixture: FixtureFacts,
): Promise<ScenarioObservation[]> {
  const checkId = 'vc-1858-branch-tags-interaction'
  const facts: Record<string, unknown> = { checkId: checkId, fixture: fixture }
  const paths: string[] = []
  const before = await evaluateThrough<BranchPageFacts>(page, inspectScript())
  const clickFilter = await clickDataAttr(page, raw, 'data-vc-branch-filter', 'unmerged')
  await sleep(400)
  const afterFilter = await evaluateThrough<BranchPageFacts>(page, inspectScript())
  facts.clickFilter = clickFilter
  facts.afterFilter = afterFilter.ok ? { rows: afterFilter.value.branchRows, scope: afterFilter.value.scope } : summarizeResult(afterFilter)
  // 搜索是在筛选之上再收窄：先把筛选拨回「全部」，否则「release」会被「未并入」挡掉（它是已并入的）。
  const clickAll = await clickDataAttr(page, raw, 'data-vc-branch-filter', 'all')
  await sleep(400)
  facts.clickAll = clickAll
  const querySelector = '[data-vc-branch2] [data-vc-branch-query]'
  let typed = false
  const playwrightPage = playwrightPageOf(raw)
  const fillable = playwrightPage as unknown as { fill?: (selector: string, value: string) => Promise<void> } | null
  if (fillable !== null && typeof fillable.fill === 'function') {
    try {
      await fillable.fill(querySelector, 'release')
      typed = true
    } catch (error) {
      facts.fillError = messageOf(error)
    }
  }
  await sleep(400)
  const afterQuery = await evaluateThrough<BranchPageFacts>(page, inspectScript())
  facts.typed = typed
  facts.afterQuery = afterQuery.ok ? { rows: afterQuery.value.branchRows, scope: afterQuery.value.scope } : summarizeResult(afterQuery)
  const filterOk = before.ok && afterFilter.ok && afterFilter.value.branchRows.length < before.value.branchRows.length && afterFilter.value.branchRows.length > 0
  const queryOk = !typed || (afterQuery.ok && afterQuery.value.branchRows.length === 1)
  const shot = await captureScreenshot(context, page, '1858-branch-tags-filtered-460-dark')
  if (shot.path !== null) paths.push(shot.path)

  // #1881：这一票把删除 / 重命名 / 切换提交 / 设上游 / 写说明收进了行尾的「⋯」菜单，标签行上仍有只读验签
  //   与删除。结构判据只能证明它们在 DOM 里，证明不了点得动，所以真机上各点一次并留截图。
  //   顺序是：开菜单 → 读五项 → 关菜单 → 点验签 → 点删除标签看确认卡 → 取消（标签一颗不少）。
  const openMenu = await clickSelector(page, raw, '[data-vc-branch-row] [data-vc-branch-menu] > summary')
  await sleep(400)
  const menuProbe = await evaluateThrough<{ ops: string[]; labels: string[] }>(page, scriptOf([
    '(function () {',
    '  var box = document.querySelector("[data-vc-branch-menu][open]")',
    '  if (box === null) return null',
    '  var ops = []',
    '  box.querySelectorAll("[data-vc-op-row]").forEach(function (row) { ops.push(String(row.getAttribute("data-vc-op-row") || "")) })',
    '  var labels = []',
    '  box.querySelectorAll(".vcs-branch2-op-label").forEach(function (el) { labels.push(String(el.textContent || "").trim()) })',
    '  return { ops: ops, labels: labels }',
    '})()',
  ]))
  const menuShot = await captureScreenshot(context, page, '1858-branch-tags-row-menu-460-dark')
  if (menuShot.path !== null) paths.push(menuShot.path)
  const closeMenu = await clickSelector(page, raw, '[data-vc-branch-menu][open] > summary')
  await sleep(250)
  const tagVerify = await clickDataAttr(page, raw, 'data-vc-tag-action', 'verify')
  await sleep(900)
  const verifyShot = await captureScreenshot(context, page, '1858-branch-tags-tag-verify-460-dark')
  if (verifyShot.path !== null) paths.push(verifyShot.path)
  const verifyProbe = await evaluateThrough<string>(page, '(function () { var el = document.querySelector("[data-vc-branch2] [data-vc-result]"); return el === null ? "" : String(el.getAttribute("data-vc-result") || "") })()')
  const tagDelete = await clickDataAttr(page, raw, 'data-vc-tag-action', 'delete')
  // 删除标签要走一次预检电话（这里实测 3 秒多），确认卡不是点完就有：等到卡片出现再截图与点取消。
  const confirmVisible = '(function () { return document.querySelector("[data-vc-branch2] [data-vc-confirm]") !== null })()'
  let confirmShownValue = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = await evaluateThrough<boolean>(page, confirmVisible)
    if (probe.ok && probe.value === true) { confirmShownValue = true; break }
    await sleep(200)
  }
  // 确认卡贴在面板最后，截图前先把它滚进视野，证据里才看得到卡本身（而不只是上方的标签行）。
  await evaluateThrough<boolean>(page, '(function () { var el = document.querySelector("[data-vc-branch2] [data-vc-confirm]"); if (el === null) return false; if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" }); return true })()')
  await sleep(300)
  const deleteShot = await captureScreenshot(context, page, '1858-branch-tags-tag-delete-confirm-460-dark')
  if (deleteShot.path !== null) paths.push(deleteShot.path)
  const cancelDelete = await clickSelector(page, raw, '[data-vc-branch2] [data-vc-confirm-cancel]')
  let confirmGoneValue = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const probe = await evaluateThrough<boolean>(page, confirmVisible)
    if (probe.ok && probe.value === false) { confirmGoneValue = true; break }
    await sleep(200)
  }
  // #1881 新增 A/B：点第一条标签的「检出」——页尾折叠要自动展开、起点预填成这个标签；
  //   展开之后才读得到「其余写动作在每一行的「⋯」里」那句说明。
  const tagCheckout = await clickDataAttr(page, raw, 'data-vc-tag-action', 'checkout')
  await sleep(600)
  const checkoutProbe = await evaluateThrough<{ open: boolean; prefill: string; value: string; hint: string }>(page, scriptOf([
    '(function () {',
    '  var box = document.querySelector("[data-vc-branch-forms]")',
    '  var input = document.querySelector("[data-vc-branch-input=create]")',
    '  var note = box === null ? null : box.querySelector(".vcs-branch2-note")',
    '  return {',
    '    open: box !== null && box.hasAttribute("open"),',
    '    prefill: box === null ? "" : String(box.getAttribute("data-vc-branch-prefill") || ""),',
    '    value: input === null ? "" : String(input.value || ""),',
    '    hint: note === null ? "" : String(note.textContent || "").trim(),',
    '  }',
    '})()',
  ]))
  // 页尾折叠在面板底部：截图前把预填好的那一格滚进视野，证据里才看得到「起点已填好」的样子。
  await evaluateThrough<boolean>(page, '(function () { var el = document.querySelector("[data-vc-branch-input=create]"); if (el === null) return false; if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" }); return true })()')
  await sleep(300)
  const checkoutShot = await captureScreenshot(context, page, '1858-branch-tags-tag-checkout-460-dark')
  if (checkoutShot.path !== null) paths.push(checkoutShot.path)
  const checkoutOk = tagCheckout.ok && checkoutProbe.ok && checkoutProbe.value.open === true && checkoutProbe.value.prefill !== ''
    && checkoutProbe.value.value === checkoutProbe.value.prefill + ' ' && checkoutProbe.value.hint.indexOf('其余写动作') >= 0
  facts.tagCheckout = { click: tagCheckout, probe: checkoutProbe.ok ? checkoutProbe.value : null, ok: checkoutOk }
  const afterCancel = await evaluateThrough<BranchPageFacts>(page, inspectScript())
  const menuOps = menuProbe.ok && menuProbe.value !== null ? menuProbe.value.ops : []
  const menuLabels = menuProbe.ok && menuProbe.value !== null ? menuProbe.value.labels : []
  const tagCountKept = before.ok && afterCancel.ok && afterCancel.value.tagRows.length === before.value.tagRows.length
  const menuOk = openMenu.ok && menuOps.join(',') === '4.6,4.5,4.4,4.7,4.13'
  const verifyOk = tagVerify.ok && verifyProbe.ok && verifyProbe.value !== ''
  const cancelOk = tagDelete.ok && confirmShownValue && cancelDelete.ok && confirmGoneValue && tagCountKept
  const checkoutPassed = checkoutOk === true
  facts.rowMenu = { open: openMenu, ops: menuOps, labels: menuLabels, closed: closeMenu }
  facts.tagVerify = { click: tagVerify, result: verifyProbe.ok ? verifyProbe.value : String(verifyProbe.ok ? '' : verifyProbe.error.message) }
  facts.tagDelete = { click: tagDelete, confirmShown: confirmShownValue, cancel: cancelDelete, confirmGone: confirmGoneValue, tagsKept: tagCountKept }
  const menuSaved = await recordEvidence(context, checkId + '-row-menu.json', { facts: facts, menu: menuOps, labels: menuLabels }, '行尾「⋯」菜单的五项、标签验签与删除标签的确认卡')
  if (menuSaved !== null) paths.push(menuSaved)

  const saved = await recordEvidence(context, checkId + '.json', facts, '筛选与搜索在真机上的前后行数')
  if (saved !== null) paths.push(saved)
  return [observe({
    checkId: checkId,
    title: '筛选胶囊与搜索框在真机上真的收窄分支行',
    ok: filterOk && queryOk,
    status: filterOk && queryOk ? 'pass' : 'fail',
    hard: false,
    detail: '点「未并入当前分支」后行数从 ' + String(before.ok ? before.value.branchRows.length : '?') + ' 收到 ' + String(afterFilter.ok ? afterFilter.value.branchRows.length : '?') + (typed ? '；搜索 release 后剩 ' + String(afterQuery.ok ? afterQuery.value.branchRows.length : '?') + ' 行' : '；这个适配器没有 fill()，搜索只按页面里的实现核对'),
    expected: '点筛选后只留没并入的分支；输入 release 后只剩同名分支',
    actual: JSON.stringify(facts).slice(0, 600),
    hint: '看证据里的 afterFilter / afterQuery 行列表',
    evidence: paths,
  }), observe({
    checkId: checkId + '-row-menu',
    title: '行尾「⋯」菜单、标签的检出 / 验签 / 删除标签在真机上都点得动',
    ok: menuOk && verifyOk && cancelOk && checkoutPassed,
    status: menuOk && verifyOk && cancelOk && checkoutPassed ? 'pass' : 'fail',
    hard: false,
    detail: (menuOk ? '菜单打开后五项按序在（' + menuOps.join(' / ') + '）' : '菜单里读到的不是五项（实得 ' + (menuOps.join(',') || '没有') + '）')
      + '；' + (verifyOk ? '标签验签点完出了结果块（结果 ' + String(verifyProbe.ok ? verifyProbe.value : '') + '；夹具里的标签没有签名，fail 是如实结论）' : '标签验签发出去没有结果块')
      + '；' + (cancelOk ? '删除标签先出确认卡、点取消后卡片收起且标签数不变' : '删除标签的确认卡或取消这一步没走通')
      + '；' + (checkoutPassed ? '点标签「检出」后页尾折叠自动展开、起点预填成这个标签，展开后读得到「其余写动作…」那句' : '标签「检出」没把页尾折叠打开或没预填起点'),
    expected: '点行尾「⋯」能展开菜单并读到 4.6 / 4.5 / 4.4 / 4.7 / 4.13 五项；标签行的「验签」只读、点了有结果；'
      + '「删除标签」先出确认卡，点取消后卡片消失、标签一颗不少',
    actual: JSON.stringify({ rowMenu: facts.rowMenu, tagVerify: facts.tagVerify, tagDelete: facts.tagDelete }).slice(0, 900),
    hint: '看证据里的 row-menu 截图与 ' + checkId + '-row-menu.json；菜单里读不到五项时先看 [data-vc-branch-menu] 是否展开',
    evidence: paths,
  })]
}

// —— 扫描主流程与场景导出 ——

async function runSweep(context: ScenarioContext): Promise<ScenarioObservation[]> {
  const observations: ScenarioObservation[] = []
  const pageResult = await context.primitives.page()
  if (!pageResult.ok) {
    return [observe({
      checkId: 'vc-1858-browser',
      title: '浏览器能开一个页面',
      ok: false,
      status: 'blocked',
      detail: '拿不到页面句柄：' + pageResult.error.message,
      expected: '浏览器适配器为运行中的实例打开一个页面',
      actual: pageResult.error.message,
      hint: '先确认 verify/browser.mjs 与 profile 里的 browser 声明',
    })]
  }
  const page = pageResult.value
  const instance = context.instance
  if (instance === null) {
    return [observe({
      checkId: 'vc-1858-instance',
      title: 'launch 步留下了一个活着的实例',
      ok: false,
      status: 'blocked',
      detail: '页面拿到了，但 context.instance 是空的',
      expected: 'launch 步跑完后有一个可用的实例句柄',
      actual: 'context.instance === null',
      hint: 'launch 步必须在这个自定义步之前',
    })]
  }
  const raw = page.page as unknown as RawBrowserPage
  const fixture = ensureFixtureRepo()
  const fixtureJson = await recordEvidence(context, '1858-fixture.json', { fixture: fixture, widths: WIDTHS, skins: SKINS, quick: QUICK, windowHeight: WINDOW_HEIGHT }, '夹具仓库状态、扫描范围与浏览器适配器能力')
  const fixturePaths = fixtureJson === null ? [] : [fixtureJson]
  observations.push(observe({
    checkId: 'vc-1858-fixture',
    title: '夹具仓库就绪（有上游、有领先后退、有没有上游、有附注标签）',
    ok: fixture.ok,
    status: fixture.ok ? undefined : 'blocked',
    hard: fixture.ok,
    detail: fixture.detail + '；宽档 ' + WIDTHS.join('/') + '，皮肤 ' + SKINS.join('/') + (QUICK ? '（QUICK 模式只跑第一档）' : ''),
    expected: '临时仓库里有 4 条以上分支（含已并入与没并入）、2 个标签（轻量 + 附注）、一条真上游',
    actual: JSON.stringify(fixture.facts).slice(0, 500),
    hint: '夹具在系统临时目录里现造；看证据 1858-fixture.json',
    evidence: fixturePaths,
  }))
  if (!fixture.ok) return observations
  const fixtureFacts: FixtureFacts = {
    branchCount: (fixture.facts.branches as string[]).length,
    tagCount: (fixture.facts.tags as string[]).length,
    mergedCount: (fixture.facts.merged as string[]).length,
    notMergedCount: (fixture.facts.notMerged as string[]).length,
    branches: fixture.facts.branches as string[],
  }
  const ready = await waitForHostReady(page, raw, instance)
  observations.push(observe({
    checkId: 'vc-1858-host-ready',
    title: '宿主页面就绪（不是登录页、没有首开弹窗）',
    ok: ready.ok,
    status: ready.ok ? undefined : 'blocked',
    hard: ready.ok,
    detail: ready.detail,
    expected: '遮罩 0 个、工作区按钮存在、没有密码输入框、URL 在实例源上',
    actual: JSON.stringify(ready.facts).slice(0, 500),
    hint: '页面卡在首开弹窗时这几项会同时不对；先看证据里的就绪读数',
  }))
  if (!ready.ok) return observations
  const mainView = await openMainView(page, raw, instance.record.tokenUrl)
  observations.push(observe({
    checkId: 'vc-1858-main-view',
    title: '页面进到主视图（右侧边栏按钮出现）',
    ok: mainView.ok,
    status: mainView.ok ? undefined : 'blocked',
    hard: mainView.ok,
    detail: mainView.detail,
    expected: '页面离开欢迎屏，进入挂夹具仓库会话的主视图',
    actual: JSON.stringify(mainView.facts).slice(0, 700),
    hint: 'RPC workspace/create + session/create 后用顶栏「新建会话」进主视图',
  }))
  if (!mainView.ok) return observations
  const wide = await ensureWideWindow(page, raw)
  const panel = await openVersionControlPanel(page, raw)
  observations.push(observe({
    checkId: 'vc-1858-panel',
    title: '右侧面板与版本管理页签能打开',
    ok: panel.ok,
    status: panel.ok ? undefined : 'blocked',
    hard: panel.ok,
    detail: panel.detail + '；' + wide.detail,
    expected: '右侧面板出现版本管理页签，点开后有壳根（不是空 cwd 态）',
    actual: JSON.stringify(panel.facts).slice(0, 700),
    hint: '版本管理页签需要工作区是 git 仓库；夹具仓库满足，检查夹具是否被真的挂上',
  }))
  if (!panel.ok) return observations
  const windowByWidth = new Map<number, number>()
  const combos: ScenarioObservation[] = []
  let interacted = false
  for (const skin of SKINS) {
    for (const width of WIDTHS) {
      if (QUICK && (width !== WIDTHS[0] || skin !== SKINS[0])) continue
      const at = await captureAt(context, page, raw, fixtureFacts, width, skin, windowByWidth)
      for (const observation of at) combos.push(observation)
      if (!interacted && width === 460 && skin === 'dark' && at.every((item) => item.ok)) {
        interacted = true
        for (const observation of await interactionAt(context, page, raw, fixtureFacts)) combos.push(observation)
      }
    }
  }
  observations.push(...combos)
  const passed = combos.filter((item) => item.ok).length
  const blocked = combos.filter((item) => item.status === 'blocked').length
  const failed = combos.length - passed - blocked
  const summaryJson = await recordEvidence(context, '1858-summary.json', {
    widths: WIDTHS,
    skins: SKINS,
    windowByWidth: Array.from(windowByWidth.entries()),
    total: combos.length,
    passed: passed,
    blocked: blocked,
    failed: failed,
  }, '这一轮四档宽 × 两皮肤的汇总')
  const summaryPaths = summaryJson === null ? [] : [summaryJson]
  observations.push(observe({
    checkId: 'vc-1858-summary',
    title: '四档宽 × 两皮肤全部核对完',
    ok: failed === 0,
    status: failed === 0 ? 'pass' : 'fail',
    hard: true,
    detail: '共 ' + String(combos.length) + ' 个组合：通过 ' + String(passed) + '，失败 ' + String(failed) + '，blocked ' + String(blocked),
    expected: '每一档宽 × 每一种皮肤都通过',
    actual: '通过 ' + String(passed) + ' / 共 ' + String(combos.length),
    hint: blocked > 0 ? '看每个组合证据里的 calibration.trace 与实际面板宽度' : '先看失败判据，再对照截图',
    evidence: summaryPaths,
  }))
  return observations
}

const hooks: ScenarioHooks = {
  prepareHome: async (_context: ScenarioContext, info: ScenarioLaunchHookInfo): Promise<void> => {
    const fixture = ensureFixtureRepo()
    if (!fixture.ok) throw new Error('夹具仓库没准备好，场景不继续：' + fixture.detail)
    const lockedSkin = String(process.env.DSH_1858_SKIN || '')
    if (lockedSkin === 'dark' || lockedSkin === 'light') {
      console.log('[1858] ' + setHomeThemePreference(info.home, lockedSkin as Skin))
    }
    const previousWorkRoot = process.env.DSH_VERIFY_WORK_ROOT
    process.env.DSH_VERIFY_WORK_ROOT = info.dir
    try {
      const seeded: unknown = seedWorkspaceRegistry(info.home, [{ path: FIXTURE_REPO, title: '1858 夹具仓库' }], { defaultPath: FIXTURE_REPO })
      const seededRecord = asRecord(seeded)
      const registryPath = seededRecord !== null && typeof seededRecord.registryPath === 'string' ? seededRecord.registryPath : ''
      console.log('[1858] 已种隔离 home 的工作区注册表 ' + registryPath + '；夹具：' + fixture.detail)
    } finally {
      if (previousWorkRoot === undefined) {
        delete process.env.DSH_VERIFY_WORK_ROOT
      } else {
        process.env.DSH_VERIFY_WORK_ROOT = previousWorkRoot
      }
    }
  },
}

export default defineScenario<ScenarioContext>({
  id: CHECK_ID,
  title: '版本管理页「分支与标签」在四档宽与深浅皮肤下的真机核对（#1858）',
  description:
    '在装好候选包的隔离 web 实例里，用有头浏览器打开版本管理页签，点齿轮索引进入「分支与标签」页：' +
    '在 300/380/460/520 四档面板宽与深浅两种皮肤下各截一张图，并直接读 DOM 判正文三段、两段条数、分支与标签行、' +
    '筛选与搜索、上游四条事实、写动作折叠区、横向溢出与文字截断；另外在 460 宽深色点一次筛选、输入一次搜索，' +
    '看行数真的跟着变。宽度靠拖右栏把手／反解窗口宽去命中，命中不了就记 blocked 并写实际面板宽，不伪造。',
  hooks: hooks,
  steps: [
    { id: 'launch', kind: 'launch', title: '起一个装好候选包的隔离 web 实例' },
    { id: 'branch-page', kind: 'custom', timeoutMs: 1800000, title: '逐档切宽切皮肤，给分支与标签页截图并判定', run: runSweep },
    { id: 'stop', kind: 'stop', title: '关闭实例' },
  ],
})
