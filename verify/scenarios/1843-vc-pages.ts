// verify/scenarios/1843-vc-pages.ts —— 真机验证 #1843：版本管理页里的「子模块」「维护」两个分区页。
//
// 这个场景在隔离实例里跑，不碰真实 DSH 主目录：隔离 home 由批次流程复制，prepareHome 只改副本里的文件。
// 夹具仓库在仓库外（默认 <TEMP>/matt1843/fixture/repo），第一次运行时自动创建：主仓库登记两个子模块，
// sub-a 已初始化且与记录一致，sub-b 已登记未初始化；空态用 DSH_1843_LAYOUT=empty 的另一份夹具验。
//
// 跑法（有头）：
//   $env:DSH_HOME = <批次 home>
//   node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js run verify/scenarios/1843-vc-pages.ts --profile web --declaration verify/profile-1833-headed.ts --work-root <工作根> --json
//
// 四档宽用两种办法按顺序试，命中判据都是壳根的 data-vc-width 恰好等于目标值：
//   1. 拖右栏把手：先把窗口拉到够宽，再按「实测档位 − 目标档」真实拖 div[data-side="rightbar"]，最多 8 轮；
//      右栏宽度是宿主的持久偏好（layoutInfo.rightbar），只有拖把手会改，所以这条最稳。
//   2. 退回窗口反解：适配器的 raw.resize 改窗口内宽，面板宽随之分段线性变化，最多 16 轮。
// 两条都拿不到就记 blocked 并写实际面板宽，不伪造。无头适配器没有窗口 resize 也没有鼠标，宽度那部分一律记 blocked：
//   ... run verify/scenarios/1843-vc-pages.ts --profile web --work-root <工作根> --json
//
// 可调环境变量：
//   DSH_1843_FIXTURE       夹具仓库（默认 <TEMP>/matt1843/fixture/repo）
//   DSH_1843_LAYOUT        rows（默认，两个子模块）| empty（没有 .gitmodules 的仓库）
//   DSH_1843_QUICK         1 = 只走机械路径并标定宽度，不拍 16 张图
//   DSH_1843_WIDTHS        宽度清单，默认 300,380,460,520
//   DSH_1843_SKINS         皮肤清单，默认 dark,light
//   DSH_1843_SKIN          锁定一种皮肤（宿主启动前改隔离 home 的 ui-theme 偏好），不设就两种都跑
//   DSH_1843_WINDOW_HEIGHT 有头窗口高度，默认 900

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

const CHECK_ID = 'vc-1843-pages'
const NEWLINE = String.fromCharCode(10)
const QUOTE = String.fromCharCode(34)

/** 夹具仓库：默认放在系统临时目录下，绝不能落进仓库或真实 DSH 主目录。 */
const FIXTURE_REPO = path.resolve(process.env.DSH_1843_FIXTURE || path.join(os.tmpdir(), 'matt1843', 'fixture', 'repo'))
type FixtureLayout = 'rows' | 'empty'
const LAYOUT: FixtureLayout = process.env.DSH_1843_LAYOUT === 'empty' ? 'empty' : 'rows'
const QUICK = process.env.DSH_1843_QUICK === '1'
const WIDTHS = String(process.env.DSH_1843_WIDTHS || '300,380,460,520')
  .split(',')
  .map((piece) => Number(piece.trim()))
  .filter((width): width is number => Number.isFinite(width) && width >= 260 && width <= 640)
type Skin = 'dark' | 'light'
const SKINS = String(process.env.DSH_1843_SKINS || 'dark,light')
  .split(',')
  .map((piece) => piece.trim())
  .filter((skin): skin is Skin => skin === 'dark' || skin === 'light')
const WINDOW_HEIGHT = Number(process.env.DSH_1843_WINDOW_HEIGHT || '900')
const PAGES = ['submodules', 'maintenance'] as const
type PageName = (typeof PAGES)[number]
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
const VC_ROOT_SELECTOR = '[data-vc-root]'
const SUB_PAGE_SELECTOR = '#vc-submodules-page'
const MAINT_PAGE_SELECTOR = '#vc-maintenance-page'
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

interface TextClip { text: string; scrollW: number; clientW: number; clipped: boolean }
interface OverflowFacts { scrollW: number; clientW: number; scrollH: number; clientH: number }
interface AttrMap { [name: string]: string }
interface RootFacts { attrs: AttrMap; box: Box; overflow: OverflowFacts; overflowX: string; bg: string; color: string }
interface HeadFacts { box: Box; title: string; count: string; sub: TextClip | null; lede: TextClip | null; back: boolean }
interface SectionFacts { title: string; className: string; dangerAttr: string | null; borderLeftColor: string; borderTopColor: string; badge: string; note: TextClip | null }
interface SubActionFacts { action: string; path: string | null; danger: string | null; box: Box }
interface SubRowFacts { path: string; initialized: string | null; actions: SubActionFacts[] }
interface SubFacts {
  listState: string | null
  listClass: string | null
  rows: SubRowFacts[]
  rowCount: number
  initializedCount: number
  addForm: { box: Box; fieldCount: number; submit: boolean } | null
  batchButtons: { id: string | null; task: string | null; box: Box; clipped: boolean }[]
  entries: { cap: string | null; name: string | null; buttons: number }[]
  confirm: boolean
  blocked: boolean
}
interface DangerSectionFacts { attrs: AttrMap; box: Box; radius: string; borderLeftColor: string; borderTopColor: string; badge: string; badgeBox: Box | null; title: string; note: TextClip | null }
interface MaintFacts {
  dangerCount: string | null
  wrapper: { attrs: AttrMap; box: Box } | null
  dangerSection: DangerSectionFacts | null
  prune: { attrs: AttrMap; box: Box; danger: string | null; facts: { key: string | null; text: string }[] } | null
  formCards: { form: string | null; title: string; box: Box }[]
  jump: { href: string | null; text: string } | null
  writeCards: { action: string | null; kind: string | null; danger: string | null }[]
  readCards: { op: string | null; rows: number }[]
}
interface PageRootFacts { id: string; className: string; role: string | null; attrs: AttrMap; box: Box; overflow: OverflowFacts; scrollClipped: boolean }
interface InspectFacts {
  page: string
  url: string
  innerW: number
  innerH: number
  outerW: number
  outerH: number
  bodyDark: boolean
  themeSource: string | null
  bodyBg: string
  panelOverflowX: string | null
  root: RootFacts | null
  live: { box: Box; overflow: OverflowFacts; empty: string | null } | null
  panel: { box: Box; overflow: OverflowFacts } | null
  head: HeadFacts | null
  pageRoot: PageRootFacts | null
  sections: SectionFacts[]
  sub: SubFacts | null
  maint: MaintFacts | null
}


function inspectScript(pageName: PageName): string {
  return scriptOf([
    `(function () {`,
    `  function q(selector) { return document.querySelector(selector); }`,
    `  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }`,
    `  function norm(value) {`,
    `    var text = String(value || "");`,
    `    text = text.split(String.fromCharCode(10)).join(" ");`,
    `    text = text.split(String.fromCharCode(13)).join(" ");`,
    `    text = text.split(String.fromCharCode(9)).join(" ");`,
    `    while (text.indexOf("  ") >= 0) { text = text.split("  ").join(" "); }`,
    `    return text.trim();`,
    `  }`,
    `  function box(el) {`,
    `    if (!el) { return null; }`,
    `    var r = el.getBoundingClientRect();`,
    `    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };`,
    `  }`,
    `  function overflow(el) {`,
    `    if (!el) { return null; }`,
    `    return { scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight };`,
    `  }`,
    `  function textOf(el) { return el ? norm(el.innerText).slice(0, 500) : ""; }`,
    `  function clipOf(el) {`,
    `    if (!el) { return null; }`,
    `    return { text: textOf(el).slice(0, 200), scrollW: el.scrollWidth, clientW: el.clientWidth, clipped: el.scrollWidth > el.clientWidth + 1 };`,
    `  }`,
    `  function attrMap(el) {`,
    `    var map = {};`,
    `    if (!el) { return map; }`,
    `    for (var i = 0; i < el.attributes.length; i += 1) { map[el.attributes[i].name] = el.attributes[i].value; }`,
    `    return map;`,
    `  }`,
    `  function headOf(page) {`,
    `    var nodes = all("[data-vc-page-head]");`,
    `    for (var i = 0; i < nodes.length; i += 1) {`,
    `      if (nodes[i].getAttribute("data-vc-page-head") === page) { return nodes[i]; }`,
    `    }`,
    `    return null;`,
    `  }`,
    `  function headFacts(page) {`,
    `    var el = headOf(page);`,
    `    if (!el) { return null; }`,
    `    return {`,
    `      box: box(el),`,
    `      title: textOf(el.querySelector(".vcs-page-title")),`,
    `      count: textOf(el.querySelector(".vcs-page-count")),`,
    `      sub: clipOf(el.querySelector(".vcs-page-sub")),`,
    `      lede: clipOf(el.querySelector(".vcs-page-lede")),`,
    `      back: el.querySelector("[data-vc-back]") !== null,`,
    `    };`,
    `  }`,
    `  function sectionFacts() {`,
    `    return all("section.page-section").map(function (el) {`,
    `      var style = getComputedStyle(el);`,
    `      return {`,
    `        title: textOf(el.querySelector(".section-title")),`,
    `        className: String(el.className),`,
    `        dangerAttr: el.getAttribute("data-vc-danger-section"),`,
    `        borderLeftColor: String(style.borderLeftColor),`,
    `        borderTopColor: String(style.borderTopColor),`,
    `        badge: textOf(el.querySelector(".section-danger")),`,
    `        note: clipOf(el.querySelector(".section-note")),`,
    `      };`,
    `    });`,
    `  }`,
    `  function subFacts() {`,
    `    var listNode = q("[data-vc-sub-list]");`,
    `    var rows = all("[data-vc-sub-row]").map(function (row) {`,
    `      return {`,
    `        path: row.getAttribute("data-vc-sub-row"),`,
    `        initialized: row.getAttribute("data-vc-sub-initialized"),`,
    `        actions: all("[data-vc-sub-action]").filter(function (action) { return row.contains(action); }).map(function (action) {`,
    `          return {`,
    `            action: action.getAttribute("data-vc-sub-action"),`,
    `            path: action.getAttribute("data-vc-sub-path"),`,
    `            danger: action.getAttribute("data-vc-sub-danger"),`,
    `            box: box(action),`,
    `          };`,
    `        }),`,
    `      };`,
    `    });`,
    `    var formNode = q("[data-vc-sub-form=add]");`,
    `    var submitNode = formNode === null ? null : formNode.querySelector("[data-vc-sub-action=add]");`,
    `    var batch = all("[data-vc-sub-batch]").map(function (el) {`,
    `      return { id: el.getAttribute("data-vc-sub-batch"), task: el.getAttribute("data-vc-sub-task-op"), box: box(el), clipped: el.scrollWidth > el.clientWidth + 1 };`,
    `    });`,
    `    var entries = all("[data-vc-sub-entry]").map(function (el) {`,
    `      return { cap: el.getAttribute("data-vc-sub-entry"), name: el.getAttribute("data-vc-sub-cap-name"), buttons: el.querySelectorAll("button").length };`,
    `    });`,
    `    var initializedCount = rows.filter(function (row) { return row.initialized === "1"; }).length;`,
    `    return {`,
    `      listState: listNode === null ? null : listNode.getAttribute("data-vc-sub-list"),`,
    `      listClass: listNode === null ? null : String(listNode.className),`,
    `      rows: rows,`,
    `      rowCount: rows.length,`,
    `      initializedCount: initializedCount,`,
    `      addForm: formNode === null ? null : { box: box(formNode), fieldCount: formNode.querySelectorAll("input").length, submit: submitNode !== null },`,
    `      batchButtons: batch,`,
    `      entries: entries,`,
    `      confirm: q("[data-vc-sub-confirm]") !== null,`,
    `      blocked: q("[data-vc-sub-blocked]") !== null,`,
    `    };`,
    `  }`,
    `  function maintFacts() {`,
    `    var pageRoot = q("#vc-maintenance-page");`,
    `    if (!pageRoot) { return null; }`,
    `    var wrapper = q("[data-vc-maint-danger-section]");`,
    `    var sectionNode = pageRoot.querySelector("section.page-section.is-danger");`,
    `    var dangerSection = null;`,
    `    if (sectionNode) {`,
    `      var style = getComputedStyle(sectionNode);`,
    `      dangerSection = {`,
    `        attrs: attrMap(sectionNode),`,
    `        box: box(sectionNode),`,
    `        radius: String(style.borderTopLeftRadius),`,
    `        borderLeftColor: String(style.borderLeftColor),`,
    `        borderTopColor: String(style.borderTopColor),`,
    `        badge: textOf(sectionNode.querySelector(".section-danger")),`,
    `        badgeBox: box(sectionNode.querySelector(".section-danger")),`,
    `        title: textOf(sectionNode.querySelector(".section-title")),`,
    `        note: clipOf(sectionNode.querySelector(".section-note")),`,
    `      };`,
    `    }`,
    `    var pruneNode = q("[data-vc-maint-danger-entry=prune]");`,
    `    var prune = null;`,
    `    if (pruneNode) {`,
    `      prune = {`,
    `        attrs: attrMap(pruneNode),`,
    `        box: box(pruneNode),`,
    `        danger: pruneNode.getAttribute("data-vc-maint-danger"),`,
    `        facts: all("[data-vc-maint-danger-fact]").filter(function (el) { return pruneNode.contains(el); }).map(function (el) {`,
    `          return { key: el.getAttribute("data-vc-maint-danger-fact"), text: textOf(el).slice(0, 160) };`,
    `        }),`,
    `      };`,
    `    }`,
    `    var formCards = all("[data-vc-maint-danger-form]").map(function (el) {`,
    `      return { form: el.getAttribute("data-vc-maint-danger-form"), title: textOf(el.querySelector("[data-vc-maint-danger-form-title]")), box: box(el) };`,
    `    });`,
    `    var jumpNode = q("[data-vc-maint-danger-jump]");`,
    `    var writeCards = all("[data-vc-maint-action]").map(function (el) {`,
    `      return { action: el.getAttribute("data-vc-maint-action"), kind: el.getAttribute("data-vc-maint-kind"), danger: el.getAttribute("data-vc-maint-danger") };`,
    `    });`,
    `    var readCards = all("[data-vc-maint-read-card]").map(function (el) {`,
    `      return { op: el.getAttribute("data-vc-maint-read-card"), rows: el.querySelectorAll("[data-vc-maint-read-row]").length };`,
    `    });`,
    `    return {`,
    `      dangerCount: pageRoot.getAttribute("data-vc-maint-danger-count"),`,
    `      wrapper: wrapper === null ? null : { attrs: attrMap(wrapper), box: box(wrapper) },`,
    `      dangerSection: dangerSection,`,
    `      prune: prune,`,
    `      formCards: formCards,`,
    `      jump: jumpNode === null ? null : { href: jumpNode.getAttribute("href"), text: textOf(jumpNode) },`,
    `      writeCards: writeCards,`,
    `      readCards: readCards,`,
    `    };`,
    `  }`,
    `  function pageRootFacts(selector) {`,
    `    var el = q(selector);`,
    `    if (!el) { return null; }`,
    `    var over = overflow(el);`,
    `    return { id: el.id, className: String(el.className), role: el.getAttribute("role"), attrs: attrMap(el), box: box(el), overflow: over, scrollClipped: over.scrollW > over.clientW + 1 };`,
    `  }`,
    `  var PAGE = ` + JSON.stringify(pageName) + `;`,
    `  var pageSelector = PAGE === "submodules" ? "#vc-submodules-page" : "#vc-maintenance-page";`,
    `  var root = q("[data-vc-root]");`,
    `  var live = q("#vc-real-root");`,
    `  var panel = q(".dsws-body");`,
    `  return {`,
    `    page: PAGE,`,
    `    url: location.href.slice(0, 200),`,
    `    innerW: window.innerWidth,`,
    `    innerH: window.innerHeight,`,
    `    outerW: window.outerWidth,`,
    `    outerH: window.outerHeight,`,
    `    bodyDark: document.body.hasAttribute("data-ds-dark-theme"),`,
    `    themeSource: document.documentElement.getAttribute("data-ds-theme-source"),`,
    `    bodyBg: getComputedStyle(document.body).backgroundColor,`,
    `    panelOverflowX: panel === null ? null : String(getComputedStyle(panel).overflowX),`,
    `    root: root === null ? null : { attrs: attrMap(root), box: box(root), overflow: overflow(root), overflowX: String(getComputedStyle(root).overflowX), bg: String(getComputedStyle(root).backgroundColor), color: String(getComputedStyle(root).color) },`,
    `    live: live === null ? null : { box: box(live), overflow: overflow(live), empty: live.getAttribute("data-vc-live-empty") },`,
    `    panel: panel === null ? null : { box: box(panel), overflow: overflow(panel) },`,
    `    head: headFacts(PAGE),`,
    `    pageRoot: pageRootFacts(pageSelector),`,
    `    sections: sectionFacts(),`,
    `    sub: PAGE === "submodules" ? subFacts() : null,`,
    `    maint: PAGE === "maintenance" ? maintFacts() : null,`,
    `  };`,
    `})()`,
  ])
}


function parseRgb(value: string | null): { r: number; g: number; b: number } | null {
  if (typeof value !== 'string') return null
  const open = value.indexOf('(')
  const close = value.indexOf(')')
  if (open < 0 || close <= open) return null
  const pieces = value.slice(open + 1, close).split(',')
  if (pieces.length < 3) return null
  const r = Number.parseFloat(pieces[0])
  const g = Number.parseFloat(pieces[1])
  const b = Number.parseFloat(pieces[2])
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null
  return { r: r, g: g, b: b }
}

/** 判一条 computed 颜色是不是「红」：红分量足够高，且明显压过绿蓝。危险区红边、红色徽章都用它判。 */
function isReddish(value: string | null): boolean {
  const rgb = parseRgb(value)
  if (rgb === null) return false
  return rgb.r >= 150 && rgb.r > rgb.g * 1.4 && rgb.r > rgb.b * 1.4
}

interface Check { readonly id: string; readonly ok: boolean; readonly detail: string; readonly actual?: string }

/** 页内结构核对：两个页各自的 DOM 锚点、危险区红边与徽章、横向溢出与文字截断。 */
function checkStructure(pageName: PageName, facts: InspectFacts): Check[] {
  const checks: Check[] = []
  const push = (id: string, ok: boolean, detail: string, actual?: string): void => {
    checks.push(actual === undefined ? { id: id, ok: ok, detail: detail } : { id: id, ok: ok, detail: detail, actual: actual })
  }
  const head = facts.head
  push('page-head', head !== null && head.title.length > 0, '页头已画出且标题非空', head === null ? '没有 data-vc-page-head 匹配当前页' : '标题：' + snippet(head.title, 60))
  push('head-back', head !== null && head.back, '页头有返回键（二级页）', head === null ? '没有页头' : head.back ? '有 [data-vc-back]' : '没有返回键')
  push('head-lede', head !== null && head.lede !== null && head.lede.text.length > 0, '页头导语非空', head === null || head.lede === null ? '没有导语' : snippet(head.lede.text, 100))
  push('head-lede-clip', !(head !== null && head.lede !== null && head.lede.clipped), '页头导语没有被横向截断', head !== null && head.lede !== null && head.lede.clipped ? '导语 scrollWidth 大于 clientWidth' : 'ok')
  const pageRoot = facts.pageRoot
  push('page-root', pageRoot !== null, '页面根节点存在（section）', pageRoot === null ? '找不到页面根' : pageRoot.id)
  const rootOverflow = facts.root === null ? null : facts.root.overflow
  const overflowOk = pageRoot !== null ? !pageRoot.scrollClipped : rootOverflow !== null && rootOverflow.scrollW <= rootOverflow.clientW + 1
  push('no-horizontal-overflow', overflowOk, '壳根没有横向溢出（scrollWidth <= clientWidth + 1）', pageRoot === null ? '没有可见的壳根或页面根' : String(pageRoot.overflow.scrollW) + ' / ' + String(pageRoot.overflow.clientW))
  if (facts.root !== null) {
    push('root-width-attr', facts.root.attrs['data-vc-width'] !== undefined, '壳根带 data-vc-width', String(facts.root.attrs['data-vc-width']))
    push('root-skin-attr', facts.root.attrs['data-vc-skin'] !== undefined, '壳根带 data-vc-skin', String(facts.root.attrs['data-vc-skin']))
  } else {
    push('root-width-attr', false, '壳根带 data-vc-width', '没有 [data-vc-root]')
    push('root-skin-attr', false, '壳根带 data-vc-skin', '没有 [data-vc-root]')
  }
  const clippedSections = facts.sections.filter((section) => section.note !== null && section.note.clipped)
  push('section-notes-clip', clippedSections.length === 0, '分区说明文字没有被横向截断', clippedSections.length === 0 ? 'ok' : clippedSections.map((section) => section.title).join('、'))
  if (pageName === 'submodules') {
    const sub = facts.sub
    const knownStates = sub !== null && (sub.listState === 'rows' || sub.listState === 'empty' || sub.listState === 'loading' || sub.listState === 'error')
    push('sub-list-state', knownStates, '子模块清单有合法状态（loading/error/empty/rows）', sub === null ? '没有清单容器' : String(sub.listState))
    const rowsRender = sub !== null && (sub.listState === 'rows' ? sub.rows.length > 0 && sub.rows.every((row) => row.path !== null && row.path.length > 0) : true)
    push('sub-rows', rowsRender, '有行时每行都画出来了', sub === null ? '没有清单' : '状态 ' + String(sub.listState) + '，' + String(sub.rowCount) + ' 行')
    const initMarked = sub !== null && (sub.listState === 'rows' ? sub.initializedCount > 0 : true)
    push('sub-initialized-mark', initMarked, '行上带初始化标记（至少一行 data-vc-sub-initialized=1）', sub === null ? '没有清单' : String(sub.initializedCount) + ' / ' + String(sub.rowCount))
    const addOk = sub !== null && sub.addForm !== null && sub.addForm.fieldCount > 0 && sub.addForm.submit
    push('sub-add-form', addOk, '添加表单有输入框与提交按钮', sub === null || sub.addForm === null ? '没有 [data-vc-sub-form=add]' : '输入框 ' + String(sub.addForm.fieldCount) + ' 个，提交按钮 ' + String(sub.addForm.submit))
    const batchOk = sub !== null && sub.batchButtons.length >= 4
    push('sub-batch-buttons', batchOk, '批量动作至少有四个按钮', sub === null ? '没有清单' : String(sub.batchButtons.length) + ' 个')
    const clippedBatch = sub === null ? [] : sub.batchButtons.filter((button) => button.clipped)
    push('sub-batch-clip', clippedBatch.length === 0, '批量按钮文字没有被横向截断', clippedBatch.length === 0 ? 'ok' : '截断 ' + String(clippedBatch.length) + ' 个')
    const entriesOk = sub !== null && sub.entries.length > 0
    push('sub-entries', entriesOk, '能力入口卡片有内容', sub === null ? '没有清单' : String(sub.entries.length) + ' 张')
  } else {
    const maint = facts.maint
    const wrapper = maint === null ? null : maint.wrapper
    push('maint-danger-wrapper', wrapper !== null, '危险区外层包装存在（[data-vc-maint-danger-section]）', wrapper === null ? '没有危险区包装' : JSON.stringify(wrapper.attrs))
    const danger = maint === null ? null : maint.dangerSection
    push('maint-danger-section', danger !== null && danger.className.indexOf('is-danger') >= 0, '危险区是 section.page-section.is-danger', danger === null ? '没有危险区 section' : danger.className)
    const redLeft = danger !== null && isReddish(danger.borderLeftColor)
    const redTop = danger !== null && isReddish(danger.borderTopColor)
    push('maint-danger-red-edge', redLeft || redTop, '危险区有红色边（左边框或上边框）', danger === null ? '没有危险区' : '左边框 ' + danger.borderLeftColor + '；上边框 ' + danger.borderTopColor)
    push('maint-danger-badge', danger !== null && danger.badge.length > 0, '危险区有红色徽章且文字非空', danger === null ? '没有危险区' : '徽章：' + snippet(danger.badge, 20))
    push('maint-danger-count', maint !== null && maint.dangerCount !== null, '维护页带危险动作计数（data-vc-maint-danger-count）', maint === null ? '没有维护页' : String(maint.dangerCount))
    const prune = maint === null ? null : maint.prune
    push('maint-prune-card', prune !== null && prune.danger !== null, '危险动作卡存在（prune，且 data-vc-maint-danger=1）', prune === null ? '没有 prune 危险卡' : 'data-vc-maint-danger=' + String(prune.danger))
    const factKeys = prune === null ? [] : prune.facts.map((fact) => fact.key)
    const factsOk = ['loss', 'reversible', 'recovery', 'backup'].every((key) => factKeys.indexOf(key) >= 0)
    push('maint-prune-consequences', factsOk, '危险卡有四段后果（loss/reversible/recovery/backup）', prune === null ? '没有 prune 危险卡' : factKeys.join('、'))
    const forms = maint === null ? [] : maint.formCards
    push('maint-rewrite-forms', forms.length > 0, '重写表单卡存在', '数量 ' + String(forms.length))
    const jump = maint === null ? null : maint.jump
    push('maint-danger-jump', jump !== null && jump.href !== null && jump.href.length > 0, '危险区有跳到重写页的链接', jump === null ? '没有跳转链接' : String(jump.href))
    const writeCards = maint === null ? [] : maint.writeCards
    push('maint-write-cards', writeCards.length > 0, '整理动作里有写操作卡', String(writeCards.length) + ' 张')
    const readCards = maint === null ? [] : maint.readCards
    push('maint-read-cards', readCards.length > 0, '整理动作里有只读读数卡', String(readCards.length) + ' 张')
  }
  return checks
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
  commitAll(dir, '初始化 1843 子模块夹具')
}

function submoduleRegistered(repo: string, name: string): boolean {
  const modulesFile = path.join(repo, '.gitmodules')
  if (!fs.existsSync(modulesFile)) return false
  return fs.readFileSync(modulesFile, 'utf8').indexOf('path = ' + name) >= 0
}

/** 造夹具主仓库：rows 形态登记两个子模块（sub-a 已初始化、sub-b 已反初始化），empty 形态不登记任何子模块。 */
function ensureFixtureRepo(): { ok: boolean; detail: string; facts: Record<string, unknown> } {
  const facts: Record<string, unknown> = { repo: FIXTURE_REPO, layout: LAYOUT }
  try {
    fs.mkdirSync(FIXTURE_REPO, { recursive: true })
    if (!fs.existsSync(path.join(FIXTURE_REPO, '.git'))) gitRun(FIXTURE_REPO, ['init', '-b', 'main'])
    writeFixtureFile(path.join(FIXTURE_REPO, 'README.md'), '# 1843 夹具仓库' + NEWLINE + NEWLINE + '这是真机验证用的临时仓库，不是产品代码。' + NEWLINE)
    writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'app.txt'), 'hello submodules' + NEWLINE)
    writeFixtureFile(path.join(FIXTURE_REPO, 'docs', 'agents', 'workspace.yaml'), fixtureWorkspaceYaml())
    commitAll(FIXTURE_REPO, '初始化 1843 夹具仓库')
    if (LAYOUT === 'rows') {
      const names = ['sub-a', 'sub-b'] as const
      for (const name of names) {
        const subDir = path.resolve(FIXTURE_REPO, '..', name)
        ensureCommitRepo(subDir, '1843 子模块夹具 ' + name)
        if (!submoduleRegistered(FIXTURE_REPO, name)) {
          const added = gitRun(FIXTURE_REPO, ['submodule', 'add', '-f', pathToFileURL(subDir).href, name])
          if (!added.ok) throw new Error('登记子模块 ' + name + ' 失败：' + added.text)
        }
      }
      commitAll(FIXTURE_REPO, '登记两个子模块')
      gitRun(FIXTURE_REPO, ['submodule', 'update', '--init', 'sub-a'])
      gitRun(FIXTURE_REPO, ['submodule', 'deinit', '-f', 'sub-b'])
    }
    const status = gitRun(FIXTURE_REPO, ['submodule', 'status'])
    if (!status.ok) throw new Error('git submodule status 失败：' + status.text)
    const lines = status.text.split(NEWLINE).map((line) => line.trim()).filter((line) => line.length > 0)
    facts.statusLines = lines
    if (LAYOUT === 'empty') {
      if (lines.length !== 0) return { ok: false, detail: '空态夹具里仍有子模块登记：' + JSON.stringify(lines), facts: facts }
      return { ok: true, detail: '空态夹具就绪（没有 .gitmodules 登记）', facts: facts }
    }
    const initialized = lines.filter((line) => line.charAt(0) !== '-')
    const pending = lines.filter((line) => line.charAt(0) === '-')
    facts.initialized = initialized.length
    facts.pending = pending.length
    if (initialized.length < 1 || pending.length < 1) {
      return { ok: false, detail: '夹具子模块状态不符合要求：已初始化 ' + String(initialized.length) + ' 个、未初始化 ' + String(pending.length) + ' 个', facts: facts }
    }
    return { ok: true, detail: '夹具就绪：' + String(initialized.length) + ' 个已初始化、' + String(pending.length) + ' 个未初始化', facts: facts }
  } catch (error) {
    return { ok: false, detail: '夹具仓库准备失败：' + messageOf(error), facts: facts }
  }
}

async function recordEvidence(context: ScenarioContext, name: string, value: unknown, note: string): Promise<string | null> {
  const saved = await context.evidence.recordJson(name, value, { note: note })
  if (!saved.ok) {
    console.log('[1843] 证据写入失败 ' + name + '：' + saved.error.message)
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

/** 把隔离 home 的 ui-theme 偏好改成指定皮肤（只在宿主启动前、DSH_1843_SKIN 锁定某皮肤时用）。 */
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

const hooks: ScenarioHooks = {
  prepareHome: async (_context: ScenarioContext, info: ScenarioLaunchHookInfo): Promise<void> => {
    const fixture = ensureFixtureRepo()
    if (!fixture.ok) throw new Error('夹具仓库没准备好，场景不继续：' + fixture.detail)
    const lockedSkin = String(process.env.DSH_1843_SKIN || '')
    if (lockedSkin === 'dark' || lockedSkin === 'light') {
      console.log('[1843] ' + setHomeThemePreference(info.home, lockedSkin as Skin))
    }
    const previousWorkRoot = process.env.DSH_VERIFY_WORK_ROOT
    process.env.DSH_VERIFY_WORK_ROOT = info.dir
    try {
      const seeded: unknown = seedWorkspaceRegistry(info.home, [{ path: FIXTURE_REPO, title: '1843 夹具仓库' }], { defaultPath: FIXTURE_REPO })
      const seededRecord = asRecord(seeded)
      const registryPath = seededRecord !== null && typeof seededRecord.registryPath === 'string' ? seededRecord.registryPath : ''
      console.log('[1843] 已种隔离 home 的工作区注册表 ' + registryPath + '；夹具：' + fixture.detail)
    } finally {
      if (previousWorkRoot === undefined) {
        delete process.env.DSH_VERIFY_WORK_ROOT
      } else {
        process.env.DSH_VERIFY_WORK_ROOT = previousWorkRoot
      }
    }
  },
}


// —— 导航与皮肤：主视图、版本管理页签、管理分区页、深浅皮肤切换 ——

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
  const menuPicked = await evaluateThrough<{ ok: boolean; text?: string; count?: number }>(page, menuClickScript(['1843 夹具仓库', '验证工作区']))
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
  const workspaceRowClick = await evaluateThrough<{ ok: boolean; key?: string; label?: string }>(page, workspaceRowNewSessionScript('1843 夹具仓库'))
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
    const remounted = await remountVersionControlTab(page, raw)
    facts.remount = remounted
    const after = await measureUi(page)
    facts.skinAfter = after.ok ? after.value.attrSkin : null
    if (after.ok && after.value.attrSkin === skin) {
      facts.strategy = 'already-' + skin
      return { ok: true, blocked: false, detail: '页面已经是 ' + skin + ' 皮肤（body 主题属性一致）', facts: facts }
    }
    return { ok: false, blocked: true, detail: 'body 主题属性已经是 ' + skin + '，但壳根 data-vc-skin=' + String(after.ok ? after.value.attrSkin : null) + '，重挂载后仍不一致', facts: facts }
  }
  const locked = String(process.env.DSH_1843_SKIN || '')
  if (locked !== '' && locked !== skin) {
    return { ok: false, blocked: true, detail: 'DSH_1843_SKIN 锁定了 ' + locked + '，不切到 ' + skin + '；body 当前 bodyDark=' + String(current), facts: facts }
  }
  const args = '[' + JSON.stringify('ui-theme') + ', [{ op: ' + JSON.stringify('set') + ', path: [' + JSON.stringify('preference') + '], value: ' + JSON.stringify(skin) + ' }]]'
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


// —— 宽度标定、逐组合截图与判定 ——

function pageTitleOf(pageName: PageName): string {
  return pageName === 'submodules' ? '子模块' : '维护'
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

/** 拖拽标定：每轮按「实际读数宽 − 目标宽」把把手横向拖同样的像素，最多 8 轮。 */
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
  const filed = await context.evidence.recordFile(target, { kind: 'screenshot', note: '1843 真机截图：' + name })
  if (!filed.ok) return { path: target, problem: '截图写出了，但没登记进证据：' + filed.error.message }
  return { path: filed.value.path, problem: null }
}

function describeChecks(checks: readonly Check[]): string {
  const failed = checks.filter((check) => !check.ok)
  if (failed.length === 0) return '结构判据全部通过（' + String(checks.length) + ' 项）'
  return '结构判据失败 ' + String(failed.length) + ' 项：' + failed.map((check) => check.id + '（' + check.detail + '）').join('；')
}

/** 一个组合（页面 × 宽度 × 皮肤）：切皮肤、开页面、标定宽度、读结构、截图、判定。 */
async function captureAt(
  context: ScenarioContext,
  page: PageHandle,
  raw: RawBrowserPage,
  pageName: PageName,
  width: number,
  skin: Skin,
  windowByWidth: Map<number, number>,
): Promise<ScenarioObservation[]> {
  const checkId = 'vc-1843-' + pageName + '-w' + String(width) + '-' + skin
  const label = pageTitleOf(pageName) + '页 / ' + String(width) + 'px / ' + skin
  const title = '「' + pageTitleOf(pageName) + '」页在 ' + String(width) + 'px 宽、' + skin + ' 皮肤下的真机实测'
  const facts: Record<string, unknown> = { checkId: checkId, page: pageName, width: width, skin: skin }
  const paths: string[] = []
  const skinResult = await ensureSkin(page, raw, skin)
  facts.skinResult = skinResult
  if (!skinResult.ok) {
    const shot = await captureScreenshot(context, page, '1843-' + pageName + '-w' + String(width) + '-' + skin + '-skin-blocked')
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
  const pageResult = await openManagePage(page, raw, pageName)
  facts.pageOpen = pageResult
  if (!pageResult.ok) {
    const shot = await captureScreenshot(context, page, '1843-' + pageName + '-w' + String(width) + '-' + skin + '-page-blocked')
    if (shot.path !== null) paths.push(shot.path)
    const saved = await recordEvidence(context, checkId + '-blocked.json', { facts: facts, screenshot: shot }, label + ' 的页面打开失败读数')
    if (saved !== null) paths.push(saved)
    return [observe({
      checkId: checkId,
      title: title,
      ok: false,
      status: 'blocked',
      hard: false,
      detail: '管理分区页没打开，这个组合没有截图结论：' + pageResult.detail,
      expected: '点齿轮索引里的「' + pageName + '」卡片后出现页头 data-vc-page-head=' + pageName,
      actual: JSON.stringify(pageResult.facts).slice(0, 600),
      hint: '齿轮索引卡片或页头锚点变了；看证据里的 pageOpen',
      evidence: paths,
    })]
  }
  const calibration = await calibrateToWidth(page, raw, width, windowByWidth)
  facts.calibration = calibration
  const inspect = await evaluateThrough<InspectFacts>(page, inspectScript(pageName))
  facts.inspect = inspect.ok ? inspect.value : summarizeResult(inspect)
  const checks = inspect.ok ? checkStructure(pageName, inspect.value) : []
  if (inspect.ok && pageName === 'submodules' && inspect.value.sub !== null) {
    const wantState = LAYOUT === 'empty' ? 'empty' : 'rows'
    const stateText = inspect.value.sub.listState
    checks.push({ id: 'sub-list-expected-state', ok: stateText === wantState, detail: '清单状态应为 ' + wantState + '（当前 ' + String(stateText) + '）', actual: String(stateText) })
  }
  facts.structureChecks = checks
  const shot = await captureScreenshot(context, page, '1843-' + pageName + '-w' + String(width) + '-' + skin)
  if (shot.path !== null) paths.push(shot.path)
  if (shot.problem !== null) facts.screenshotProblem = shot.problem
  const attrWidth = inspect.ok && inspect.value.root !== null ? inspect.value.root.attrs['data-vc-width'] : null
  const attrSkin = inspect.ok && inspect.value.root !== null ? inspect.value.root.attrs['data-vc-skin'] : null
  const widthOk = calibration.ok && attrWidth === String(width)
  const skinOk = attrSkin === skin
  const bodyOk = inspect.ok && inspect.value.bodyDark === (skin === 'dark')
  const headOk = inspect.ok && inspect.value.head !== null
  const structureOk = inspect.ok && checks.length > 0 && checks.every((check) => check.ok)
  const ok = widthOk && skinOk && bodyOk && headOk && structureOk
  const status: Status = ok ? 'pass' : widthOk ? 'fail' : 'blocked'
  const failedIds = checks.filter((check) => !check.ok).map((check) => check.id)
  facts.verdict = { widthOk: widthOk, skinOk: skinOk, bodyOk: bodyOk, headOk: headOk, structureOk: structureOk, failedIds: failedIds }
  const saved = await recordEvidence(context, checkId + '.json', facts, label + ' 的完整读数：窗口尺寸、面板宽、壳根属性、结构判据与截图路径')
  if (saved !== null) paths.push(saved)
  const actualParts: string[] = []
  actualParts.push('窗口内宽 ' + String(calibration.innerW) + '，外框宽 ' + String(calibration.outerW) + '，面板读数宽 ' + String(calibration.panelW))
  actualParts.push('壳根 data-vc-width=' + String(attrWidth) + '，data-vc-skin=' + String(attrSkin) + '，bodyDark=' + String(inspect.ok ? inspect.value.bodyDark : null))
  if (failedIds.length > 0) actualParts.push('失败判据：' + failedIds.join('、'))
  actualParts.push('标定方式 ' + String(calibration.via === undefined ? 'resize' : calibration.via) + '，标定尝试 ' + String(calibration.attempts) + ' 次')
  const detail = ok
    ? label + '：宽高与皮肤都到位，' + describeChecks(checks)
    : label + '：' + (widthOk ? '宽度到位但' : '宽度没到位（实际 ' + String(calibration.reached) + '）且') + (structureOk ? '结构判据通过' : describeChecks(checks))
  return [observe({
    checkId: checkId,
    title: title,
    ok: ok,
    status: status,
    hard: widthOk && skinOk,
    detail: detail,
    expected: '壳根 data-vc-width 正好等于 ' + String(width) + '、data-vc-skin 等于 ' + skin + '，页头与分区结构齐全且无横向溢出、无文字截断',
    actual: actualParts.join('；'),
    hint: status === 'blocked' ? '窄档靠窗口宽反解面板宽，没标定到目标档就如实记 blocked；看证据里的 calibration.trace' : '逐项看 structureChecks 里的失败判据与截图',
    evidence: paths,
  })]
}


// —— 页面就绪、扫描主流程与场景导出 ——

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

async function runSweep(context: ScenarioContext): Promise<ScenarioObservation[]> {
  const observations: ScenarioObservation[] = []
  const pageResult = await context.primitives.page()
  if (!pageResult.ok) {
    return [observe({
      checkId: 'vc-1843-page',
      title: '页面能为这个实例打开',
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
      checkId: 'vc-1843-instance',
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
  const fixtureJson = await recordEvidence(context, '1843-fixture.json', {
    layout: LAYOUT,
    fixture: fixture,
    widths: WIDTHS,
    skins: SKINS,
    quick: QUICK,
    windowHeight: WINDOW_HEIGHT,
    adapter: { headed: typeof raw.resize === 'function', preset: typeof raw.preset === 'function', measureWindow: typeof raw.measureWindow === 'function', rawPlaywrightPage: playwrightPageOf(raw) !== null },
  }, '夹具仓库状态、扫描范围与浏览器适配器能力')
  const fixturePaths = fixtureJson === null ? [] : [fixtureJson]
  observations.push(observe({
    checkId: 'vc-1843-fixture',
    title: '夹具仓库就绪（' + (LAYOUT === 'empty' ? '空态：没有子模块登记' : '两行：一个已初始化、一个未初始化') + '）',
    ok: fixture.ok,
    status: fixture.ok ? undefined : 'blocked',
    hard: fixture.ok,
    detail: fixture.detail + '；宽档 ' + WIDTHS.join('/') + '，皮肤 ' + SKINS.join('/') + (QUICK ? '（QUICK 模式只跑第一档）' : ''),
    expected: '临时仓库里有两行子模块状态（或空态没有登记），且 git submodule status 可读',
    actual: JSON.stringify(fixture.facts).slice(0, 500),
    hint: '夹具在系统临时目录里现造；看证据 1843-fixture.json',
    evidence: fixturePaths,
  }))
  if (!fixture.ok) return observations
  const ready = await waitForHostReady(page, raw, instance)
  const readyJson = await recordEvidence(context, '1843-host-ready.json', ready.facts, '页面就绪读数：遮罩、工作区按钮、密码框、URL')
  const readyPaths = readyJson === null ? [] : [readyJson]
  observations.push(observe({
    checkId: 'vc-1843-host-ready',
    title: '宿主页面就绪（不是登录页、没有首开弹窗）',
    ok: ready.ok,
    status: ready.ok ? undefined : 'blocked',
    hard: ready.ok,
    detail: ready.detail,
    expected: '遮罩 0 个、工作区按钮存在、没有密码输入框、URL 在实例源上',
    actual: JSON.stringify(ready.facts).slice(0, 500),
    hint: '页面卡在首开弹窗时这几项会同时不对；先看证据里的 1843-host-ready.json',
    evidence: readyPaths,
  }))
  if (!ready.ok) return observations
  const mainView = await openMainView(page, raw, instance.record.tokenUrl)
  const mainJson = await recordEvidence(context, '1843-main-view.json', mainView.facts, '进入主视图的每种尝试与 RPC 回包的摘要')
  const mainPaths = mainJson === null ? [] : [mainJson]
  observations.push(observe({
    checkId: 'vc-1843-main-view',
    title: '页面进到主视图（右侧边栏按钮出现）',
    ok: mainView.ok,
    status: mainView.ok ? undefined : 'blocked',
    hard: mainView.ok,
    detail: mainView.detail,
    expected: '页面离开欢迎屏，进入挂夹具仓库会话的主视图',
    actual: JSON.stringify(mainView.facts).slice(0, 700),
    hint: 'RPC workspace/create + session/create 后用顶栏「新建会话」进主视图；失败时看四种入口的读数',
    evidence: mainPaths,
  }))
  if (!mainView.ok) return observations
  const wide = await ensureWideWindow(page, raw)
  const wideJson = await recordEvidence(context, '1843-wide-window.json', wide.facts, '开面板前把窗口拉宽、给右栏拖拽留出夹取范围的读数')
  const widePaths = wideJson === null ? [] : [wideJson]
  const panel = await openVersionControlPanel(page, raw)
  const panelJson = await recordEvidence(context, '1843-panel.json', panel.facts, '打开右侧面板、插件入口与版本管理页签的读数')
  const panelPaths = panelJson === null ? [] : [panelJson]
  observations.push(observe({
    checkId: 'vc-1843-panel',
    title: '右侧面板与版本管理页签能打开',
    ok: panel.ok,
    status: panel.ok ? undefined : 'blocked',
    hard: panel.ok,
    detail: panel.detail + '；' + wide.detail,
    expected: '右侧面板出现版本管理页签，点开后有 :vc-real-root 壳根（不是空 cwd 态）',
    actual: JSON.stringify(panel.facts).slice(0, 700),
    hint: '版本管理页签需要工作区是 git 仓库；夹具仓库满足，检查夹具是否被真的挂上',
    evidence: panelPaths.concat(widePaths),
  }))
  if (!panel.ok) return observations
  const windowByWidth = new Map<number, number>()
  const combos: ScenarioObservation[] = []
  for (const skin of SKINS) {
    for (const pageName of PAGES) {
      for (const width of WIDTHS) {
        if (QUICK && (width !== WIDTHS[0] || skin !== SKINS[0])) continue
        const at = await captureAt(context, page, raw, pageName, width, skin, windowByWidth)
        for (const observation of at) combos.push(observation)
      }
    }
  }
  observations.push(...combos)
  const passed = combos.filter((item) => item.ok).length
  const blocked = combos.filter((item) => item.status === 'blocked').length
  const failed = combos.length - passed - blocked
  const summaryJson = await recordEvidence(context, '1843-summary.json', {
    layout: LAYOUT,
    widths: WIDTHS,
    skins: SKINS,
    windowByWidth: Array.from(windowByWidth.entries()),
    total: combos.length,
    passed: passed,
    blocked: blocked,
    failed: failed,
    observations: combos.map((item) => ({ checkId: item.checkId, ok: item.ok, status: item.status, detail: item.detail, evidence: item.evidence })),
  }, '本次扫描的汇总：每个组合的状态、窗口尺寸与证据路径')
  const summaryPaths = summaryJson === null ? [] : [summaryJson]
  observations.push(observe({
    checkId: 'vc-1843-summary',
    title: '四档宽 × 深浅皮肤扫描汇总',
    ok: failed === 0 && blocked === 0 && combos.length > 0,
    status: failed === 0 && blocked === 0 && combos.length > 0 ? 'pass' : blocked > 0 ? 'blocked' : 'fail',
    hard: false,
    detail: '共 ' + String(combos.length) + ' 个组合：通过 ' + String(passed) + '，失败 ' + String(failed) + '，blocked ' + String(blocked),
    expected: '每个页面在 ' + WIDTHS.join('/') + ' 四档宽 × ' + SKINS.join('/') + ' 两皮肤下全部通过',
    actual: '通过 ' + String(passed) + ' / 共 ' + String(combos.length),
    hint: blocked > 0 ? '看每个组合证据里的 calibration.trace 与实际面板宽度' : '先看失败判据，再对照截图',
    evidence: summaryPaths,
  }))
  return observations
}

export default defineScenario<ScenarioContext>({
  id: CHECK_ID,
  title: '版本管理页「子模块」「维护」两个分区页在四档宽与深浅皮肤下的真机核对（#1843）',
  description:
    '在装好候选包的隔离 web 实例里，用有头浏览器打开版本管理页签，逐个点开「子模块」「维护」两个管理分区页：' +
    '在 300/380/460/520 四档面板宽与深浅两种皮肤下各截一张图，并直接读 DOM 判页头、分区结构、危险区的红边与红色徽章、' +
    '横向溢出与文字截断；宽度靠反解窗口宽去命中，命中不了就记 blocked 并写实际面板宽，不伪造。',
  hooks: hooks,
  steps: [
    {
      id: 'launch',
      kind: 'launch',
      title: '起一个装好候选包的隔离 web 实例',
    },
    {
      id: 'pages',
      kind: 'custom',
      timeoutMs: 1800000,
      title: '逐档切宽切皮肤，给两个分区页截图并判定',
      run: runSweep,
    },
    {
      id: 'stop',
      kind: 'stop',
      title: '关闭实例',
    },
  ],
})

