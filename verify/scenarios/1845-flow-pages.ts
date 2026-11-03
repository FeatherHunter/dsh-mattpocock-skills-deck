// verify/scenarios/1845-flow-pages.ts —— 真机验证 #1845：版本管理的「变基 / 冲突 / 任务」三个流程页按定稿原型重做。
//
// 验证路线：base 的真机验证能力把候选包装进隔离的 web profile 实例（隔离 home 由批次提供），
// 本场景从页面里用真鼠标打开「MattSkills」面板 → 点「版本管理」页签，然后在版本管理页顶部条上
// 点三个流程页入口（变基 / 冲突 / 任务；DOM 属性 data-vc-extra-link），对每一页在四档面板宽度
// （300 / 380 / 460 / 520）与深浅两皮肤下逐档读 DOM 并截图。
//
// 为什么必须用有头适配器：面板宽度不是页面能自己设的，它由宿主右侧栏的真实宽度决定（ResizeObserver
// 量出来写进 data-vc-width）。无头适配器固定 800x600、没有改窗原语，量不出四档；所以本场景要用
// verify/profile-1833-headed.ts（browser.module 指向 verify/probe-browser-headed.mjs）跑。
// 宽度怎么改：宿主右侧栏有一根拖拽手柄 div[data-side="rightbar"]，拖它时 onRightbarDrag(dx) 改
// rightbar 偏好（clamp 到 300..viewport*0.7）。这里用 Playwright 原生 mouse 真拖，按 data-vc-width
// 与目标值的差迭代校准（最多 8 轮，收敛到 ±1px）。屏幕不够宽会被宿主判成全屏（视口 <768 时右侧栏
// 100vw 且没有手柄），所以先把窗口改成 1500x900，确认 innerWidth >= 768 再做四档。
//
// 深/浅皮肤怎么切：版本管理页只在挂载时读一次皮肤（vcRealTab 的 useEffect([]) 读
// body.hasAttribute("data-ds-dark-theme")），所以切换必须发生在页签重新挂载之前。这里用 evaluate
// 直接设/删 body 的 data-ds-dark-theme（与宿主 ThemePresenter 用的同一个开关），然后把面板页签
// 切到「技能」再切回「版本管理」让组件卸载重挂，最后读页面根 data-vc-skin 确认真的生效。
// 皮肤只在两轮（先 dark 后 light）开始时各切一次，不每档重复挂载。
//
// 每档判定（PASS）的口径：页面根 data-vc-page / data-vc-width / data-vc-skin 与目标一致；页头
// （data-vc-page-head）在且标题非空；本页要求的区块标题按顺序出现（子序列匹配，额外区块只记读数）；
// 本页的决定性读数对（变基：op-count=9、九行动作行、待办区；冲突：data-vc-conflicts-count=15、
// 首段是危险段、五段按序出现且「进行中操作」按原型在无操作时不画；任务：三段、三条等宽命令、
// 四阶段等待态、运行中 0、空态）；页面根没有横向溢出、没有伸出版面右边的元素；本档期间没有新的
// console.error / pageerror。
// 与原型不符但属于「产品偏差」的项不在每档判 FAIL，而是统一记进证据与回复里的偏差清单，
// 例如变基页「本次变基」缺动作条、历史改写面板排在「本次变基」之前、第三段标题叫「待办清单」等。
//
// 跑法（在仓库根，先准备隔离批次 home；批次 home / 工作根换成你自己的）：
//   $env:DSH_HOME='D:\Temp\matt-1845-home'
//   node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js run verify/scenarios/1845-flow-pages.ts --profile web --work-root D:\Temp\matt-verify --declaration verify/profile-1833-headed.ts --json --collect-all
//
// 快速冒烟（只跑一页一档，约 1 分钟）：
//   $env:DSH_1845_PAGES='conflicts'; $env:DSH_1845_WIDTHS='460'; $env:DSH_1845_SKINS='dark'
//   $env:DSH_1845_TASK_PROBE='0'
//   （然后再用同一命令跑完整 24 档；可选环境变量说明见下面常量。）
//
// 证据落到两处：场景证据目录（context.evidence.root，base CLI 管理）与仓库内
// .scratch/1845/evidence/（默认；可用 DSH_1845_OUT 改），每档一份 PNG + 一份 DOM 读数 JSON。
//
// 任务页「运行中」进度条探针：干净仓库里任务页只画三段等待态，进度条 data-vc-flow-meter 只
// 在有真运行中任务时出现。为了拿到真机百分比读数，场景最后（24 档跑完后）用宿主的长任务电话
// wf.gitTaskStart 起一次浅克隆（clone 的高层协议会打 Receiving objects 百分比），轮询任务页
// 直到出现带百分比的进度条，截图并记读数，再用界面上的取消按钮 data-vc-task-cancel 取消，
// 删掉临时目录。克隆源用本仓库自己（file:// 地址），只取 depth=1；一旦观察到百分比立刻取消，
// 不会等它下完。DSH_1845_TASK_PROBE=0 可跳过这一步。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { PageHandle, ScenarioContext, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { hooks } from '../hooks.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
// 证据默认落仓库内的 .scratch/1845/evidence（本任务允许写的两处之一），base CLI 的证据目录里也存一份。
const OUT_DIR = process.env.DSH_1845_OUT === undefined ? path.join(REPO_ROOT, '.scratch', '1845', 'evidence') : String(process.env.DSH_1845_OUT)

// 四档面板宽度，顺序即编号顺序；两皮肤先 dark 后 light。
const WIDTHS = [300, 380, 460, 520]
const SKINS = [
  { id: 'dark', dark: true },
  { id: 'light', dark: false },
]
// 三个流程页：checkBase 是编号起点（变基 01-08、冲突 09-16、任务 17-24），
// expectedSections 是本页要求的区块标题顺序（原型给的四到六段，按子序列判定）。
const PAGES = [
  {
    id: 'rebase',
    link: 'rebase',
    checkBase: 1,
    // 原型 48 的顺序：先「本次变基」，再用「变基六步」讲流程，然后才是动作、待办与边界四格。
    // 历史改写五个能力面板排在页面体之后（壳层顺序，属产品现状），不在本序列里、不算多出来的段。
    expectedSections: ['本次变基', '变基六步', '变基动作', '待办清单（从上到下按顺序重放）', '会动与不会动'],
  },
  {
    id: 'conflicts',
    link: 'conflicts',
    checkBase: 9,
    expectedSections: ['当前冲突', '合并', '逐文件处置', '冲突内容与检查', '会动与不会动'],
  },
  {
    id: 'task',
    link: 'task',
    checkBase: 17,
    // 原型 50 的四段：说明、进度、清单、取消之后（最后一段是静态说明，没有按钮）。
    expectedSections: ['选一种长任务', '进度', '任务清单', '取消之后'],
  },
]

// 只跑一部分时用环境变量收窄（快速冒烟用；完整跑不要设）。
const ENABLED_PAGES = String(process.env.DSH_1845_PAGES || 'rebase,conflicts,task').split(',').map(function (s) { return s.trim() }).filter(function (s) { return s.length > 0 })
const ENABLED_WIDTHS = String(process.env.DSH_1845_WIDTHS || WIDTHS.join(',')).split(',').map(function (s) { return Number(s.trim()) }).filter(function (n) { return isFinite(n) && n > 0 })
const ENABLED_SKINS = String(process.env.DSH_1845_SKINS || 'dark,light').split(',').map(function (s) { return s.trim() }).filter(function (s) { return s.length > 0 })
const TASK_PROBE = String(process.env.DSH_1845_TASK_PROBE || '1') !== '0'

const MASK_COUNT_SCRIPT = 'document.querySelectorAll(' + JSON.stringify('[class*="_mask_"]') + ').length'
const CLOSE_BUTTON = 'button[aria-label="关闭"]'
const WORKSPACE_BUTTON = 'button[aria-label="选择工作区"]'
const PANEL_ENTRY = 'button[data-sidebar-right-guide-entry="dsh-mattpocock-skills-deck:deck-map"]'
const VERSION_TAB = 'button[data-ink-key="versionControl"]'
const SKILLS_TAB = 'button[data-ink-key="skills"]'
const RIGHTBAR_HANDLE = '[data-side="rightbar"]'

/** 有头适配器额外给的窗口原语与 Playwright 原生 Page 口子；标准适配器没有这些。 */
interface RawBrowserPage {
  readonly page: any
  readonly goto?: (url: string) => Promise<unknown>
  readonly press?: (key: string) => Promise<unknown>
  readonly click?: (selector: string) => Promise<{ ok: boolean; error?: { message?: string } }>
  readonly resize?: (width: number, height: number) => Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }>
  readonly measureWindow?: () => Promise<{ ok: boolean; value?: unknown }>
}

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}
function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
async function evaluateThrough<T>(page: PageHandle, script: string): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  const result = await page.evaluate<T>(script)
  return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message }
}
async function recordEvidence(context: ScenarioContext, name: string, value: unknown, note: string): Promise<{ path: string | null; problem: string | null }> {
  const saved = await context.evidence.recordJson(name, value, { note })
  if (!saved.ok) return { path: null, problem: '证据没写下来（' + name + '）：' + saved.error.message }
  return { path: saved.value.path, problem: null }
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
  readonly status?: 'pass' | 'fail' | 'skip' | 'blocked'
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
async function realClick(raw: RawBrowserPage, selector: string): Promise<{ ok: boolean; problem: string | null }> {
  if (raw.click === undefined) return { ok: false, problem: '浏览器适配器没有暴露 click()' }
  const clicked = await raw.click(selector)
  return clicked.ok ? { ok: true, problem: null } : { ok: false, problem: clicked.error === undefined ? 'unknown error' : clicked.error.message }
}
/** 页面内 RPC：与 1833 场景同一套信封（POST /api/<method>，client-request）。 */
function rpcScript(method: string, argsExpression: string): string {
  return [
    '(async function () {',
    '  var rpcId = globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());',
    '  var body = { type: "client-request", rpcId: rpcId, method: ' + JSON.stringify(method) + ', payload: { args: ' + argsExpression + ' } };',
    '  var response = await fetch("/api/" + ' + JSON.stringify(method) + ', {',
    '    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),',
    '  });',
    '  var text = await response.text();',
    '  var parsed = null;',
    '  try { parsed = JSON.parse(text); } catch (error) { parsed = null; }',
    '  return { status: response.status, body: parsed, text: text.slice(0, 1200) };',
    '})()',
  ].join('\n')
}

/** 把皮肤开关与目标值写进页面（与宿主 ThemePresenter 同一个属性名）。 */
function skinScript(dark: boolean): string {
  return [
    '(function () {',
    dark ? '  document.body.setAttribute("data-ds-dark-theme", "");' : '  document.body.removeAttribute("data-ds-dark-theme");',
    '  return { dark: document.body.hasAttribute("data-ds-dark-theme"), skin: document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light" };',
    '})()',
  ].join('\n')
}

/**
 * 运行时取证（只在本场景里用）：包住 console.error、未捕获错误、window.host.call、fetch 与
 * WebSocket.send，每条记录都带发生时刻、阶段标记与调用栈。用途是判定「unknown endpoint:
 * gitRebaseRead / gitConflicts」这类报错发生在哪个阶段（切肤重挂 / 宽度校准 / 进页导航 / 截图改窗），
 * 由哪一次宿主电话产生，宿主到底回了什么——只看 pageErrors 的字符串分不清这些。包装只改页面里的
 * 观测口，不改产品行为；诊断数据不参与 PASS/FAIL。
 */
const DIAG_INSTALL_SCRIPT = [
  '(function () {',
  '  if (window.__vcDiag && window.__vcDiag.installed === true) {',
  '    return { already: true, hasHost: typeof window.host !== "undefined", hostWrapped: !!(window.host && window.host.__vcDiagWrapped) };',
  '  }',
  '  var d = { installed: true, installedAt: Date.now(), hostCalls: [], fetch: [], console: [], errors: [], wsSend: [] };',
  '  window.__vcDiag = d;',
  '  window.__vcDiagPhase = "page-ready";',
  '  function safe(x, max) { try { return JSON.stringify(x).slice(0, max || 500); } catch (e) { return String(x).slice(0, max || 500); } }',
  '  function push(list, item) { try { if (list.length < 600) list.push(item); } catch (e) {} }',
  '  function here() { try { return String((new Error()).stack || "").split(String.fromCharCode(10)).slice(2, 7).join(" | "); } catch (e) { return ""; } }',
  '  // 1) 宿主电话：客户端 callHost 的唯一出口是 window.host.call(phone, args)。',
  '  var hostObj = null;',
  '  try { if (typeof window.host !== "undefined") hostObj = window.host; } catch (e) {}',
  '  var hostWrapped = false;',
  '  try {',
  '    if (hostObj && typeof hostObj.call === "function" && hostObj.__vcDiagWrapped !== true) {',
  '      var originalCall = hostObj.call;',
  '      hostObj.call = function (phone, args) {',
  '        var rec = { t: Date.now(), phase: window.__vcDiagPhase || "", phone: String(phone), args: safe(args, 400), stack: here() };',
  '        push(d.hostCalls, rec);',
  '        var p;',
  '        try { p = originalCall.apply(hostObj, arguments); } catch (e) { rec.threw = String(e && e.message || e).slice(0, 400); throw e; }',
  '        if (p && typeof p.then === "function") {',
  '          return p.then(function (res) {',
  '            rec.ok = !!(res && res.ok === true);',
  '            rec.error = res && res.error ? safe(res.error, 400) : null;',
  '            return res;',
  '          }, function (err) { rec.rejected = String(err && err.message || err).slice(0, 400); throw err; });',
  '        }',
  '        rec.ok = true;',
  '        return p;',
  '      };',
  '      hostObj.__vcDiagWrapped = true;',
  '      hostWrapped = true;',
  '    }',
  '  } catch (e) { hostWrapped = "failed: " + String(e && e.message || e); }',
  '  // 2) fetch：记录 /api/ 请求的方法名、状态码与响应正文片段（宿主电话若走 HTTP，这里能看到全过程）。',
  '  var fetchWrapped = false;',
  '  try {',
  '    var originalFetch = window.fetch;',
  '    if (typeof originalFetch === "function" && originalFetch.__vcDiagWrapped !== true) {',
  '      var wrappedFetch = function (input, init) {',
  '        var url = "";',
  '        try { url = String(typeof input === "string" ? input : (input && input.url) || ""); } catch (e) {}',
  '        var rec = { t: Date.now(), phase: window.__vcDiagPhase || "", url: url.slice(0, 300), method: (init && init.method) || (input && input.method) || "GET", rpc: "", status: null, resp: "" };',
  '        var bodyText = "";',
  '        try { bodyText = init && typeof init.body === "string" ? init.body : ""; } catch (e) {}',
  '        try { var parsed = bodyText ? JSON.parse(bodyText) : null; rec.rpc = parsed && parsed.method ? String(parsed.method) : ""; } catch (e) {}',
  '        push(d.fetch, rec);',
  '        var p = originalFetch.apply(this, arguments);',
  '        if (p && typeof p.then === "function") {',
  '          return p.then(function (resp) {',
  '            rec.status = resp.status;',
  '            try { resp.clone().text().then(function (text) { rec.resp = String(text).slice(0, 500); }, function () {}); } catch (e) {}',
  '            return resp;',
  '          }, function (err) { rec.status = "reject"; rec.resp = String(err && err.message || err).slice(0, 300); throw err; });',
  '        }',
  '        return p;',
  '      };',
  '      wrappedFetch.__vcDiagWrapped = true;',
  '      window.fetch = wrappedFetch;',
  '      fetchWrapped = true;',
  '    }',
  '  } catch (e) {}',
  '  // 3) WebSocket.send：宿主电话若走 WS，这里能看到发出的方法名。',
  '  var wsWrapped = false;',
  '  try {',
  '    var WS = window.WebSocket;',
  '    if (WS && WS.prototype && typeof WS.prototype.send === "function" && WS.prototype.__vcDiagWrapped !== true) {',
  '      var originalSend = WS.prototype.send;',
  '      WS.prototype.send = function (data) {',
  '        try {',
  '          var text = typeof data === "string" ? data : "";',
  '          var rec = { t: Date.now(), phase: window.__vcDiagPhase || "", rpc: "", snippet: text.slice(0, 300) };',
  '          try { var parsed = text ? JSON.parse(text) : null; rec.rpc = parsed && parsed.method ? String(parsed.method) : ""; } catch (e) {}',
  '          push(d.wsSend, rec);',
  '        } catch (e) {}',
  '        return originalSend.apply(this, arguments);',
  '      };',
  '      WS.prototype.__vcDiagWrapped = true;',
  '      wsWrapped = true;',
  '    }',
  '  } catch (e) {}',
  '  // 4) console.error 与未捕获错误：记下原文、调用栈与当时页面名/宽度/皮肤。',
  '  var originalError = console.error;',
  '  console.error = function () {',
  '    try {',
  '      var parts = Array.prototype.slice.call(arguments).map(function (a) {',
  '        try { return typeof a === "string" ? a : safe(a, 400); } catch (e) { return String(a); }',
  '      });',
  '      var root = document.querySelector("[data-vc-shell]");',
  '      push(d.console, { t: Date.now(), phase: window.__vcDiagPhase || "", msg: parts.join(" ").slice(0, 900), stack: here(), page: root ? root.getAttribute("data-vc-page") : null, width: root ? root.getAttribute("data-vc-width") : null, skin: root ? root.getAttribute("data-vc-skin") : null });',
  '    } catch (e) {}',
  '    return originalError.apply(console, arguments);',
  '  };',
  '  window.addEventListener("error", function (event) {',
  '    push(d.errors, { t: Date.now(), phase: window.__vcDiagPhase || "", kind: "error", msg: String(event && event.message || event).slice(0, 900), stack: String(event && event.error && event.error.stack || "").slice(0, 1200) });',
  '  });',
  '  window.addEventListener("unhandledrejection", function (event) {',
  '    push(d.errors, { t: Date.now(), phase: window.__vcDiagPhase || "", kind: "unhandledrejection", msg: String(event && event.reason && (event.reason.message || event.reason) || event).slice(0, 900), stack: String(event && event.reason && event.reason.stack || "").slice(0, 1200) });',
  '  });',
  '  return { installed: true, hasHost: hostObj !== null, hostCall: hostObj && typeof hostObj.call, hostWrapped: hostWrapped, fetchWrapped: fetchWrapped, wsWrapped: wsWrapped };',
  '})()',
].join('\n')

/** 取走页面里攒下的诊断记录（取走即清空）；按阶段归到对应的证据里。 */
const DIAG_DRAIN_SCRIPT = [
  '(function () {',
  '  var d = window.__vcDiag;',
  '  if (!d) return { installed: false };',
  '  return {',
  '    at: Date.now(),',
  '    phase: window.__vcDiagPhase || "",',
  '    hostCalls: (d.hostCalls || []).splice(0),',
  '    fetch: (d.fetch || []).splice(0),',
  '    console: (d.console || []).splice(0),',
  '    errors: (d.errors || []).splice(0),',
  '    wsSend: (d.wsSend || []).splice(0),',
  '  };',
  '})()',
].join('\n')

/** 只读根节点的三件事：页面名、宽度档、皮肤。用来等导航与校准宽度。 */
const ROOT_STATE_SCRIPT = [
  '(function () {',
  '  function norm(s) { return (s || "").replace(/\\s+/g, " ").trim(); }',
  '  var root = document.querySelector("[data-vc-shell]");',
  '  var body = document.querySelector("[data-vc-page-body]");',
  '  var head = document.querySelector("[data-vc-page-head]");',
  '  return {',
  '    hasRoot: !!root,',
  '    page: root ? root.getAttribute("data-vc-page") : null,',
  '    width: root ? Number(root.getAttribute("data-vc-width")) : null,',
  '    skin: root ? root.getAttribute("data-vc-skin") : null,',
  '    livePage: (function () { var r = document.querySelector("#vc-real-root"); return r ? r.getAttribute("data-vc-live-page") : null; })(),',
  '    bodyPage: body ? body.getAttribute("data-vc-page-body") : null,',
  '    headPage: head ? head.getAttribute("data-vc-page-head") : null,',
  '    headTitle: head ? norm((head.querySelector(".vcs-page-title") || {}).innerText) : null,',
  '  };',
  '})()',
].join('\n')

/**
 * 整页读数：页面根、页头、区块标题顺序、芯片、动作条、进度条、三页各自的决定性读数、
 * 横向溢出与文字裁切候选、滚动容器尺寸。所有取值都来自真实 DOM，不做源码推断。
 */
const FACTS_SCRIPT = [
  '(function () {',
  '  function norm(s) { return (s || "").replace(/\\s+/g, " ").trim(); }',
  '  function box(el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }',
  '  function txt(el) { return el ? norm(el.innerText || el.textContent || "") : null; }',
  '  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }',
  '  var root = document.querySelector("[data-vc-shell]");',
  '  if (!root) return { ok: false, reason: "no [data-vc-shell]" };',
  '  var bodyEl = document.querySelector("[data-vc-page-body]");',
  '  var scope = bodyEl || root;',
  '  var sections = all(".page-section", scope).map(function (sec) {',
  '    return {',
  '      title: txt(sec.querySelector(".section-title")),',
  '      danger: sec.getAttribute("data-vc-danger-section") === "1",',
  '      count: txt(sec.querySelector(".section-count")),',
  '      dangerText: txt(sec.querySelector(".section-danger")),',
  '      note: (txt(sec.querySelector(".section-note")) || "").slice(0, 200),',
  '      rows: all(".obj-row", sec).length,',
  '      factCells: all(".fact-cell", sec).length,',
  '      listItems: all("li", sec).length,',
  '    };',
  '  });',
  '  var head = document.querySelector("[data-vc-page-head]");',
  '  var chips = all("[data-vc-flow-chip]").map(function (c) { return { tone: c.getAttribute("data-vc-flow-chip"), text: txt(c) }; });',
  '  var controls = all(".vcs-flow-controls").map(function (c) { return { text: txt(c), buttons: all("button", c).map(function (b) { return { action: b.getAttribute("data-vc-flow-action"), text: txt(b), disabled: b.disabled === true }; }) }; });',
  '  var meters = all("[data-vc-flow-meter]").map(function (m) {',
  '    var b = m.querySelector("[data-vc-flow-meter-bar]");',
  '    return { pct: Number(m.getAttribute("data-vc-flow-meter")), aria: m.getAttribute("aria-valuenow"), barWidth: b ? b.style.width : null, barBox: b ? box(b) : null, label: txt(m.querySelector("[data-vc-flow-meter-label]")) };',
  '  });',
  '  var rebaseEl = document.querySelector("[data-vc-rebase-page]");',
  '  var conflictsEl = document.querySelector("[data-vc-conflicts-page]");',
  '  var taskEl = document.querySelector("[data-vc-task-area]");',
  '  var rebase = rebaseEl ? {',
  '    opCount: Number(rebaseEl.getAttribute("data-vc-rebase-op-count")),',
  '    state: rebaseEl.getAttribute("data-vc-rebase-state"),',
  '    actionRows: all("[data-vc-rebase-action-row]", rebaseEl).length,',
  '    actionOps: all("[data-vc-rebase-action-row]", rebaseEl).map(function (r) { return r.getAttribute("data-vc-rebase-action-row"); }),',
  '    primaryButtons: all("[data-vc-rebase-op]", rebaseEl).map(function (b) { return { op: b.getAttribute("data-vc-rebase-op"), text: txt(b), disabled: b.disabled === true }; }),',
  '    todoRows: all("[data-vc-rebase-rows] li", rebaseEl).length,',
  '    todoEmpty: (function () { var e = rebaseEl.querySelector("[data-vc-rebase-rows-empty]"); return e ? txt(e) : null; })(),',
  '    stateLine: (function () { var s = rebaseEl.querySelector("[data-vc-rebase-state-line]"); return s ? { kind: s.getAttribute("data-vc-rebase-state-line"), text: txt(s) } : null; })(),',
  '    readCards: all(".vcs-card[data-vc-rebase-read]", rebaseEl).map(function (c) { return { kind: c.getAttribute("data-vc-rebase-read"), title: txt(c.querySelector("h4")) }; }),',
  '    fields: all("[data-vc-rebase-field]", rebaseEl).map(function (f) { return f.getAttribute("data-vc-rebase-field"); }),',
  '    // #1845 新增的「变基六步」段：六行各带等宽命令与状态芯片（已完成 / 进行中 / 待处理）。',
  '    stepRows: (function () {',
  '      var stepsSec = null;',
  '      all(".page-section", rebaseEl).forEach(function (sec) { if (txt(sec.querySelector(".section-title")) === "变基六步") stepsSec = sec; });',
  '      if (!stepsSec) return null;',
  '      return all(".obj-row", stepsSec).map(function (row) {',
  '        var chip = row.querySelector("[data-vc-flow-chip]");',
  '        return { title: txt(row.querySelector(".obj-title")), command: txt(row.querySelector(".vcs-flow-cmd")), chipTone: chip ? chip.getAttribute("data-vc-flow-chip") : null, chipText: txt(chip) };',
  '      });',
  '    })(),',
  '  } : null;',
  '  var conflicts = conflictsEl ? {',
  '    count: Number(conflictsEl.getAttribute("data-vc-conflicts-count")),',
  '    state: (function () { var s = conflictsEl.querySelector("[data-vc-conflicts-state]"); return s ? s.getAttribute("data-vc-conflicts-state") : null; })(),',
  '    stateLine: (function () { var s = conflictsEl.querySelector("[data-vc-conflicts-state]"); return s ? txt(s) : null; })(),',
  '    fileRows: all("[data-vc-conflicts-file]", conflictsEl).length,',
  '    filesAttr: (function () { var e = conflictsEl.querySelector("[data-vc-conflicts-files]"); return e ? e.getAttribute("data-vc-conflicts-files") : null; })(),',
  '    filesEmpty: (function () { var e = conflictsEl.querySelector("[data-vc-conflicts-files-empty]"); return e ? txt(e) : null; })(),',
  '    ops: all("[data-vc-conflicts-op]", conflictsEl).map(function (o) { return { op: o.getAttribute("data-vc-conflicts-op"), text: txt(o) }; }),',
  '    // 汇总行只在有进行中操作时出现；按钮按剩余冲突数禁用（还有冲突就点不了）。',
  '    filesLeft: (function () { var e = conflictsEl.querySelector("[data-vc-conflicts-files-left]"); return e ? { count: Number(e.getAttribute("data-vc-conflicts-files-left")), text: txt(e) } : null; })(),',
  '    hasSummary: !!conflictsEl.querySelector("[data-vc-conflicts-files-summary]"),',
  '    continueBtn: (function () { var b = conflictsEl.querySelector("[data-vc-conflicts-file-continue]"); return b ? { count: Number(b.getAttribute("data-vc-conflicts-file-continue")), disabled: b.disabled === true, text: txt(b) } : null; })(),',
  '    fileResolveButtons: all("[data-vc-conflicts-file-resolve]", conflictsEl).length,',
  '    fileSideButtons: all("[data-vc-conflicts-file-side]", conflictsEl).length,',
  '  } : null;',
  '  var task = taskEl ? {',
  '    modeRows: all(".obj-row", taskEl).length,',
  '    cmds: all(".vcs-flow-cmd", taskEl).map(function (c) { return txt(c); }),',
  '    phaseRows: all(".vcs-task-phase", taskEl).map(function (p) {',
  '      var row = p.closest(".obj-row");',
  '      var chip = row ? row.querySelector("[data-vc-flow-chip]") : null;',
  '      return { phase: txt(p), chipTone: chip ? chip.getAttribute("data-vc-flow-chip") : null, chipText: txt(chip) };',
  '    }),',
  '    meterCount: all("[data-vc-flow-meter]", taskEl).length,',
  '    runningAttr: (function () { var c = taskEl.querySelector(".vcs-task-count"); return c ? { text: txt(c), running: c.getAttribute("data-vc-task-running") } : null; })(),',
  '    emptyText: (function () { var e = taskEl.querySelector("[data-vc-task-empty]"); return e ? txt(e) : null; })(),',
  '    rows: all("[data-vc-task-row]", taskEl).map(function (r) {',
  '      var cancel = r.querySelector("[data-vc-task-cancel]");',
  '      var pctEl = r.querySelector("[data-vc-task-percent]");',
  '      var phaseEl = r.querySelector("[data-vc-task-phase]");',
  '      return { id: r.getAttribute("data-vc-task-id"), state: r.getAttribute("data-vc-task-state"), percent: pctEl ? (pctEl.getAttribute("data-vc-task-percent") || "uncertain") : null, phase: phaseEl ? phaseEl.getAttribute("data-vc-task-phase") : null, cancel: cancel ? { text: txt(cancel), disabled: cancel.disabled === true } : null, text: txt(r).slice(0, 240) };',
  '    }),',
  '    idleNote: (function () { var d = taskEl.querySelector("[data-vc-flow-hint]"); return d ? txt(d) : null; })(),',
  '  } : null;',
  '  var facts = all(".fact-cell", scope).map(function (c) { return { key: txt(c.querySelector(".fact-key")), value: txt(c.querySelector(".fact-value")) }; });',
  '  // 颜色令牌读数：--vcs-* 来自宿主主题，深浅皮肤切换时值应跟着变；这里只记读数，不参与 PASS/FAIL。',
  '  var tokenMap = {};',
  '  var rootStyle = window.getComputedStyle(root);',
  '  try {',
  '    for (var ti = 0; ti < rootStyle.length; ti += 1) {',
  '      var tname = String(rootStyle[ti]);',
  '      if (tname.indexOf("--vcs-") === 0) tokenMap[tname] = String(rootStyle.getPropertyValue(tname) || "").trim();',
  '    }',
  '  } catch (e) { tokenMap["__error"] = String(e && e.message); }',
  '  function colorOf(el) { if (!el) return null; var cs = window.getComputedStyle(el); return { color: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor }; }',
  '  var colorReadings = {',
  '    root: colorOf(root),',
  '    body: colorOf(document.body),',
  '    title: colorOf(root.querySelector(".vcs-page-title")),',
  '    danger: colorOf(root.querySelector("[data-vc-danger-section=\\"1\\"]")),',
  '    chips: all("[data-vc-flow-chip]").slice(0, 8).map(function (c) { return { tone: c.getAttribute("data-vc-flow-chip"), style: colorOf(c) }; }),',
  '    meterBar: colorOf(root.querySelector("[data-vc-flow-meter-bar]")),',
  '  };',
  '  var bodyBox = box(bodyEl || root);',
  '  var rootBox = box(root);',
  '  var overflowEls = [];',
  '  var clipped = [];',
  '  all("*", scope).forEach(function (el) {',
  '    var r = el.getBoundingClientRect();',
  '    if (r.width > 0 && r.right > bodyBox.x + bodyBox.w + 2 && overflowEls.length < 12) overflowEls.push({ tag: el.tagName, cls: String(el.className || "").slice(0, 80), text: norm(el.innerText || "").slice(0, 80), right: Math.round(r.right), bodyRight: Math.round(bodyBox.x + bodyBox.w) });',
  '    var cs = window.getComputedStyle(el);',
  '    if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 3 && (cs.overflowY === "hidden" || cs.overflowY === "clip") && norm(el.innerText || "").length > 0 && clipped.length < 12) clipped.push({ tag: el.tagName, cls: String(el.className || "").slice(0, 80), text: norm(el.innerText || "").slice(0, 80), clientH: el.clientHeight, scrollH: el.scrollHeight });',
  '  });',
  '  var bodyScroll = bodyEl ? { scrollTop: Math.round(bodyEl.scrollTop), scrollHeight: bodyEl.scrollHeight, clientHeight: bodyEl.clientHeight, clientWidth: bodyEl.clientWidth, scrollWidth: bodyEl.scrollWidth } : null;',
  '  var scrollBox = document.querySelector(".dsws-body");',
  '  return {',
  '    ok: true,',
  '    viewport: { w: window.innerWidth, h: window.innerHeight },',
  '    root: { page: root.getAttribute("data-vc-page"), widthAttr: Number(root.getAttribute("data-vc-width")), skin: root.getAttribute("data-vc-skin"), depth: root.getAttribute("data-vc-depth"), clientWidth: root.clientWidth, scrollWidth: root.scrollWidth, box: rootBox },',
  '    head: head ? { page: head.getAttribute("data-vc-page-head"), title: txt(head.querySelector(".vcs-page-title")), count: txt(head.querySelector(".vcs-page-count")), kind: txt(head.querySelector(".vcs-page-kind")), depth: txt(head.querySelector(".vcs-page-depth")), lede: (txt(head.querySelector(".vcs-page-lede")) || "").slice(0, 220), back: !!head.querySelector("[data-vc-back]") } : null,',
  '    body: { page: bodyEl ? bodyEl.getAttribute("data-vc-page-body") : null, sections: sections, sectionTitles: sections.map(function (s) { return s.title; }) },',
  '    chips: chips,',
  '    controls: controls,',
  '    meters: meters,',
  '    rebase: rebase,',
  '    conflicts: conflicts,',
  '    task: task,',
  '    factCells: facts,',
  '    tokens: tokenMap,',
  '    colors: colorReadings,',
  '    overflow: { rootScroll: root.scrollWidth - root.clientWidth, bodyScrollWidth: bodyScroll ? bodyScroll.scrollWidth - bodyScroll.clientWidth : null, elements: overflowEls },',
  '    clipped: clipped,',
  '    bodyScroll: bodyScroll,',
  '    panelScroll: scrollBox ? { scrollTop: Math.round(scrollBox.scrollTop), scrollHeight: scrollBox.scrollHeight, clientHeight: scrollBox.clientHeight } : null,',
  '  };',
  '})()',
].join('\n')

/** 区块标题是否按顺序出现（子序列匹配；额外区块不算违反顺序）。 */
function sequenceOk(actual: readonly string[], expected: readonly string[]): { ok: boolean; missing: string[]; indices: number[] } {
  const indices: number[] = []
  let cursor = 0
  const missing: string[] = []
  for (const title of expected) {
    let found = -1
    for (let i = cursor; i < actual.length; i += 1) {
      if (actual[i] === title) { found = i; break }
    }
    if (found < 0) missing.push(title)
    else { indices.push(found); cursor = found + 1 }
  }
  return { ok: missing.length === 0, missing, indices }
}
function two(n: number): string {
  return n < 10 ? '0' + String(n) : String(n)
}
function joinText(values: readonly (string | null | undefined)[]): string {
  return values.map(function (v) { return v === null || v === undefined ? '' : String(v) }).join(' / ')
}

/** 读根节点三件事（页面 / 宽度 / 皮肤）；导航与宽度校准都靠它。 */
async function readRootState(page: PageHandle): Promise<{ ok: boolean; page: string | null; width: number | null; skin: string | null; bodyPage: string | null; livePage: string | null; problem?: string }> {
  const probe = await evaluateThrough<any>(page, ROOT_STATE_SCRIPT)
  if (!probe.ok) return { ok: false, page: null, width: null, skin: null, bodyPage: null, livePage: null, problem: probe.message }
  const v = probe.value || {}
  return { ok: v.hasRoot === true, page: v.page === undefined ? null : v.page, width: typeof v.width === 'number' && isFinite(v.width) ? v.width : null, skin: v.skin === undefined ? null : v.skin, bodyPage: v.bodyPage === undefined ? null : v.bodyPage, livePage: v.livePage === undefined ? null : v.livePage }
}

/** 去重后按出现顺序返回字符串列表（诊断摘要用）。 */
function uniqueStrings(values: readonly any[]): string[] {
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || value === '') continue
    if (out.indexOf(value) < 0) out.push(value)
  }
  return out
}

/** 设诊断阶段标记：此后页面里记下的宿主电话 / fetch / console 记录都带这个阶段名。 */
async function markDiagPhase(page: PageHandle, phase: string): Promise<void> {
  await evaluateThrough<any>(page, '(function () { window.__vcDiagPhase = ' + JSON.stringify(phase) + '; return window.__vcDiagPhase; })()')
}

/** 取走页面里攒下的诊断记录（取走即清空）；先等一小会让异步回包落进日志。 */
async function drainDiag(page: PageHandle): Promise<{ ok: boolean; value: any; problem: string | null }> {
  await sleep(220)
  const drained = await evaluateThrough<any>(page, DIAG_DRAIN_SCRIPT)
  if (!drained.ok) return { ok: false, value: null, problem: drained.message }
  return { ok: true, value: drained.value, problem: null }
}

/**
 * 诊断记录的摘要：只留计数、去重后的方法名与异常条目（unknown endpoint 单独挑出来），
 * 原始记录进 diagLog 证据按需查。诊断不参与 PASS/FAIL，只用来判定报错的性质与发生时机。
 */
function diagSummaryOf(value: any): Record<string, unknown> {
  const record = asRecord(value)
  if (record === null) return { installed: false }
  const hostCalls = asArray(record.hostCalls)
  const fetches = asArray(record.fetch)
  const consoles = asArray(record.console)
  const errors = asArray(record.errors)
  const wsSends = asArray(record.wsSend)
  const hostBad = hostCalls.filter(function (call: any) { return call && call.ok === false })
  const fetchBad = fetches.filter(function (call: any) {
    if (!call) return false
    if (call.status === 'reject') return true
    if (typeof call.status === 'number' && call.status >= 400) return true
    return typeof call.resp === 'string' && call.resp.indexOf('unknown endpoint') >= 0
  })
  const unknownEndpoint: string[] = []
  fetches.forEach(function (call: any) {
    if (call && typeof call.resp === 'string' && call.resp.indexOf('unknown endpoint') >= 0) {
      unknownEndpoint.push('fetch:' + String(call.rpc || call.url) + ' phase=' + String(call.phase) + ' resp=' + call.resp.slice(0, 300))
    }
  })
  consoles.forEach(function (entry: any) {
    if (entry && typeof entry.msg === 'string' && entry.msg.indexOf('unknown endpoint') >= 0) {
      unknownEndpoint.push('console phase=' + String(entry.phase) + ' page=' + String(entry.page) + ' width=' + String(entry.width) + ' skin=' + String(entry.skin) + ' msg=' + entry.msg.slice(0, 300) + ' stack=' + String(entry.stack || '').slice(0, 400))
    }
  })
  return {
    installed: record.installed === true,
    phase: record.phase === undefined ? null : record.phase,
    hostCalls: hostCalls.length,
    hostPhones: uniqueStrings(hostCalls.map(function (call: any) { return call && call.phone })),
    hostBad: hostBad.slice(0, 12).map(function (call: any) {
      return { phase: call.phase, phone: call.phone, error: call.error, threw: call.threw, rejected: call.rejected, stack: String(call.stack || '').slice(0, 300) }
    }),
    fetch: fetches.length,
    fetchRpcs: uniqueStrings(fetches.map(function (call: any) { return call && call.rpc })),
    fetchBad: fetchBad.slice(0, 12).map(function (call: any) {
      return { phase: call.phase, rpc: call.rpc, url: String(call.url || '').slice(0, 160), status: call.status, resp: String(call.resp || '').slice(0, 400) }
    }),
    wsSend: wsSends.length,
    wsRpcs: uniqueStrings(wsSends.map(function (call: any) { return call && call.rpc })),
    console: consoles.length,
    consoleMsgs: consoles.slice(0, 8).map(function (entry: any) { return { phase: entry.phase, page: entry.page, width: entry.width, skin: entry.skin, msg: String(entry.msg || '').slice(0, 300) } }),
    errors: errors.length,
    errorMsgs: errors.slice(0, 8).map(function (entry: any) { return { phase: entry.phase, kind: entry.kind, msg: String(entry.msg || '').slice(0, 300) } }),
    unknownEndpoint,
  }
}

/** 把 rpcScript 的回包折成摘要：传输状态 + body.result 里的 ok / error。 */
function summarizeRpcCall(call: any): Record<string, unknown> {
  const record = asRecord(call) || {}
  const body = asRecord(record.body)
  const result = body === null ? null : asRecord(body.result)
  const error = result === null ? (body === null ? null : asRecord(body.error)) : asRecord(result.error)
  return {
    transportOk: typeof record.status === 'number' && record.status >= 200 && record.status < 300,
    status: record.status === undefined ? null : record.status,
    ok: result !== null ? result.ok : (body === null ? null : body.ok),
    error: error === null ? null : JSON.stringify(error).slice(0, 400),
    text: typeof record.text === 'string' ? record.text.slice(0, 600) : null,
  }
}

/** 用 Playwright 原生鼠标真拖右侧栏手柄；dx 为正表示往右拖（面板变窄）。 */
async function dragRightbar(raw: RawBrowserPage, dx: number): Promise<{ ok: boolean; problem: string | null }> {
  const locator = raw.page.locator(RIGHTBAR_HANDLE)
  const box = await locator.boundingBox()
  if (box === null || box === undefined) return { ok: false, problem: '找不到右侧栏拖拽手柄的可见位置（' + RIGHTBAR_HANDLE + '）' }
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await raw.page.mouse.move(cx, cy)
  await raw.page.mouse.down()
  await sleep(60)
  await raw.page.mouse.move(cx + dx, cy, { steps: 8 })
  await sleep(60)
  await raw.page.mouse.up()
  await sleep(420)
  return { ok: true, problem: null }
}

/** 按 data-vc-width 迭代校准到目标宽度；最多 8 轮。 */
async function calibrateWidth(page: PageHandle, raw: RawBrowserPage, target: number): Promise<{ ok: boolean; width: number | null; attempts: number; problem: string | null }> {
  let last: number | null = null
  let problem: string | null = null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const state = await readRootState(page)
    if (!state.ok || state.width === null) { problem = state.problem || '读不到 data-vc-width'; break }
    last = state.width
    if (last === target) return { ok: true, width: last, attempts: attempt, problem: null }
    const delta = target - last
    const dragged = await dragRightbar(raw, -delta)
    if (!dragged.ok) { problem = dragged.problem; break }
  }
  return { ok: last === target, width: last, attempts: 8, problem: last === target ? null : problem || '校准后宽度仍是 ' + String(last) }
}

/** 等导航落到目标页：data-vc-page / data-vc-page-body 都等于目标。 */
async function waitForPage(page: PageHandle, pageId: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const state = await readRootState(page)
    if (state.ok && state.page === pageId && state.bodyPage === pageId) return true
    await sleep(220)
  }
  return false
}

/** 强制真鼠标点击：Playwright 的 force 跳过遮挡判定，但下发的仍是真实鼠标事件；面板列表骨架屏长期不消失时用它越过遮挡。 */
async function forceClick(raw: RawBrowserPage, selector: string): Promise<{ ok: boolean; problem: string | null }> {
  if (!raw.page || typeof raw.page.locator !== 'function') return { ok: false, problem: '适配器没有 Playwright locator' }
  try {
    await raw.page.locator(selector).first().click({ force: true, timeout: 8000 })
    return { ok: true, problem: null }
  } catch (error) {
    return { ok: false, problem: messageOf(error) }
  }
}

/** 等面板骨架屏消失：骨架屏 div 带 aria-hidden="true" 但会接住页签位置的指针事件，不消失就点不中页签。 */
async function waitForPanelReady(page: PageHandle, budgetMs: number): Promise<{ ok: boolean; detail: string }> {
  const script = '(function () { return { skeletons: document.querySelectorAll(' + JSON.stringify('[data-dsws-list-skeleton]') + ').length, tabCount: document.querySelectorAll(' + JSON.stringify('button[data-ink-key]') + ').length }; })()'
  const deadline = Date.now() + budgetMs
  let last: any = null
  while (Date.now() < deadline) {
    const probe = await evaluateThrough<any>(page, script)
    if (probe.ok) {
      last = probe.value
      if (last.skeletons === 0 && last.tabCount > 0) return { ok: true, detail: JSON.stringify(last) }
    }
    await sleep(300)
  }
  return { ok: false, detail: JSON.stringify(last) }
}

/** 切页签重挂版本管理页（皮肤只在挂载时读一次）；先点「技能」再点回「版本管理」。 */
async function remountVersionControl(raw: RawBrowserPage): Promise<{ ok: boolean; problem: string | null }> {
  await sleep(400)
  const toSkills = await realClick(raw, SKILLS_TAB)
  if (!toSkills.ok) return { ok: false, problem: '点技能页签失败：' + String(toSkills.problem) }
  await sleep(700)
  const back = await realClick(raw, VERSION_TAB)
  if (!back.ok) return { ok: false, problem: '点版本管理页签失败：' + String(back.problem) }
  await sleep(1400)
  return { ok: true, problem: null }
}

/**
 * 截图：整页面板（面板宽、内容全高）。做法是先把窗口视口临时加高到内容高度 + 余量，让宿主的
 * 滚动容器不再裁掉下半截，再截 [data-vc-shell] 整块；截完恢复视口，并再读一次宽度确认没被
 * 改窗弄偏。加高失败（有头窗口超过屏幕）时退化成整窗截图，并在读数里写明方法。
 */
async function capturePanel(page: PageHandle, raw: RawBrowserPage, filePath: string): Promise<{ ok: boolean; method: string; bytes: number; problem: string | null }> {
  const size = await page.innerSize()
  const viewportW = size.ok ? size.value.width : 1500
  const viewportH = size.ok ? size.value.height : 900
  const rootBox = await evaluateThrough<any>(page, '(function () { var r = document.querySelector("[data-vc-shell]"); if (!r) return null; var b = r.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })()')
  if (!rootBox.ok) return { ok: false, method: 'none', bytes: 0, problem: rootBox.message }
  const contentHeight = rootBox.value && typeof rootBox.value.h === 'number' ? rootBox.value.h : 0
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
    if (wantHeight > viewportH) {
      await raw.page.setViewportSize({ width: viewportW, height: viewportH })
      await sleep(320)
    }
    return { ok: st.size > 3000, method, bytes: st.size, problem: st.size > 3000 ? null : '截图只有 ' + String(st.size) + ' 字节，可能是空白' }
  } catch (error) {
    try { await raw.page.setViewportSize({ width: viewportW, height: viewportH }) } catch (e2) { /* 恢复视口失败不影响后面的读数 */ }
    try {
      await raw.page.screenshot({ path: filePath, timeout: 15000 })
      const st = fs.statSync(filePath)
      return { ok: st.size > 3000, method: 'viewport-fallback', bytes: st.size, problem: '整块截图失败（' + messageOf(error) + '），退化成整窗截图' }
    } catch (error2) {
      return { ok: false, method: 'failed', bytes: 0, problem: '截图失败：' + messageOf(error) + '；整窗截图也失败：' + messageOf(error2) }
    }
  }
}

/** 把证据图额外复制到仓库 .scratch/1845/evidence，方便回看；失败只记问题不影响判定。 */
function copyToScratch(sourcePath: string, fileName: string): { path: string | null; problem: string | null } {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const target = path.join(OUT_DIR, fileName)
    fs.copyFileSync(sourcePath, target)
    return { path: target, problem: null }
  } catch (error) {
    return { path: null, problem: '复制到 .scratch 失败：' + messageOf(error) }
  }
}

export default defineScenario<ScenarioContext>({
  id: 'flow-pages-1845',
  title: '版本管理三个流程页：变基 / 冲突 / 任务（#1845）',
  description: '在隔离的 web profile 实例里，用真鼠标打开 MattSkills 面板进版本管理页，对变基、冲突、任务三个流程页在 300/380/460/520 四档面板宽度与深/浅两皮肤下逐档截图并读 DOM：核对页头、区块标题顺序、各页决定性读数（变基动作数、冲突能力数、任务三行命令与四阶段）、横向溢出与 pageErrors；最后用宿主长任务电话起一次浅克隆，观察任务页运行中的进度条百分比并取消。',
  hooks,
  steps: [
    {
      id: 'launch',
      kind: 'launch',
      title: '起一个装好候选包的隔离 web 实例',
    },
    {
      id: 'flow-pages',
      kind: 'custom',
      // 24 档 ×（导航 + 校准 + 截图 + 读数）加最后的长任务探针，40 分钟足够。
      timeoutMs: 2400000,
      title: '打开版本管理页，逐页 × 四档宽 × 两皮肤截图并读 DOM',
      run: async (context) => {
        const observations: ScenarioObservation[] = []
        const pageResult = await context.primitives.page()
        if (!pageResult.ok) {
          return [observe({
            checkId: 'page-open',
            title: '页面能为这个实例打开',
            ok: false,
            status: 'blocked',
            detail: '拿不到页面句柄：' + pageResult.error.message,
            expected: '浏览器适配器为运行中的实例打开一个页面',
            actual: pageResult.error.message,
            hint: pageResult.error.hint || '先确认 verify/profile-1833-headed.ts 与 verify/probe-browser-headed.mjs',
          })]
        }
        const page = pageResult.value
        const instance = context.instance
        if (instance === null) {
          return [observe({
            checkId: 'instance-alive',
            title: 'launch 步留下了一个活着的实例',
            ok: false,
            status: 'blocked',
            detail: '页面拿到了，但 context.instance 是空的',
            expected: 'launch 步跑完后有一个可用的实例句柄',
            actual: 'context.instance === null',
            hint: 'launch 步必须在这次自定义步之前',
          })]
        }
        const raw = page.page as unknown as RawBrowserPage
        const facts: Record<string, unknown> = {}
        const save = async (name: string, value: unknown, note: string): Promise<string[]> => {
          const saved = await recordEvidence(context, name, value, note)
          if (saved.problem !== null) facts['evidenceProblem:' + name] = saved.problem
          return saved.path === null ? [] : [saved.path]
        }

        // 0) 有头适配器与宽窗口是四档宽度的前提：视口 <768 时右侧栏自动全屏、没有手柄。
        const adapter = {
          resize: typeof raw.resize === 'function',
          pageMouse: !!(raw.page && typeof raw.page.mouse === 'object' && raw.page.mouse !== null),
          setViewportSize: !!(raw.page && typeof raw.page.setViewportSize === 'function'),
          locator: !!(raw.page && typeof raw.page.locator === 'function'),
        }
        if (adapter.resize) {
          const applied = await raw.resize(1500, 900)
          facts.windowResize = applied.ok ? applied.value : { error: applied.error === undefined ? 'unknown' : applied.error.message }
        }
        await sleep(600)
        const sizeAfter = await page.innerSize()
        const viewport = sizeAfter.ok ? sizeAfter.value : { width: 0, height: 0 }
        facts.adapter = { adapter, viewport }
        if (!adapter.resize || !adapter.pageMouse || !adapter.setViewportSize || !adapter.locator || viewport.width < 768) {
          return [observe({
            checkId: 'headed-adapter',
            title: '有头适配器能改真实窗口并暴露鼠标/截图原语（四档宽度的前提）',
            ok: false,
            status: 'blocked',
            detail: '适配器能力：' + JSON.stringify(adapter) + '，改窗后视口 ' + JSON.stringify(viewport),
            expected: '有头适配器（verify/profile-1833-headed.ts）提供 resize/measureWindow 与 Playwright Page，且视口宽度 >= 768（否则右侧栏自动全屏、没有拖拽手柄）',
            actual: 'resize=' + String(adapter.resize) + '，page.mouse=' + String(adapter.pageMouse) + '，视口宽=' + String(viewport.width),
            hint: '标准 verify/profile.ts 是无头适配器（固定 800x600），四档宽测不了；要用 --declaration verify/profile-1833-headed.ts',
          })]
        }

        // 1) 打开页面、关首开引导遮罩、确认停在宿主工作台。复用 1833 场景的步骤。
        if (raw.goto !== undefined) await raw.goto(instance.record.tokenUrl)
        await sleep(2600)
        let maskCount = -1
        let workspaceButtonText: string | null = null
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const masks = await evaluateThrough<number>(page, MASK_COUNT_SCRIPT)
          maskCount = masks.ok ? masks.value : -1
          if (maskCount > 0) {
            if (raw.press !== undefined) await raw.press('Escape')
            await realClick(raw, CLOSE_BUTTON)
            await sleep(300)
            continue
          }
          const text = await page.text(WORKSPACE_BUTTON)
          if (text.ok && text.value !== null) { workspaceButtonText = text.value; break }
          await sleep(250)
        }
        const pageUrl = page.url()
        const pageReady = maskCount === 0 && workspaceButtonText !== null && pageUrl.indexOf(instance.record.originUrl) === 0
        facts.pageReady = { maskCount, workspaceButtonText, pageUrl }
        observations.push(observe({
          checkId: 'page-ready',
          title: '首开引导弹窗已关掉，页面是宿主工作台界面',
          ok: pageReady,
          status: pageReady ? undefined : 'blocked',
          hard: pageReady,
          detail: '遮罩 ' + String(maskCount) + ' 个，工作区按钮 ' + (workspaceButtonText === null ? '没找到' : '「' + workspaceButtonText + '」') + '，URL ' + pageUrl,
          expected: '遮罩 0 个、工作区按钮存在、URL 在实例源上',
          actual: '遮罩=' + String(maskCount) + '，工作区按钮=' + String(workspaceButtonText) + '，URL=' + pageUrl,
          hint: '页面卡在首开登录弹窗时这几项会同时不对',
          evidence: await save('page-state.json', facts.pageReady, '页面就绪检查的原始读数'),
        }))
        if (!pageReady) return observations

        // 2b) 装运行时取证：包住 console.error / 未捕获错误 / 宿主电话 / fetch。4 档 console.error 的
        // 性质（本票引入、宿主端点注册时序、还是环境噪声）与发生时机要靠它判定；诊断数据只进证据，
        // 不参与 PASS/FAIL。取走的记录按「阶段」归组，阶段名就是当时在做哪一步。
        const diagInstall = await evaluateThrough<any>(page, DIAG_INSTALL_SCRIPT)
        facts.diagInstall = diagInstall.ok ? diagInstall.value : { error: diagInstall.message }
        const diagLog: any[] = []
        const drainInto = async (label: string): Promise<any> => {
          const drained = await drainDiag(page)
          const entry = { label, at: new Date().toISOString(), ok: drained.ok, problem: drained.problem, summary: drained.ok ? diagSummaryOf(drained.value) : null, raw: drained.ok ? drained.value : null }
          diagLog.push(entry)
          return entry
        }

        // 2) 用 RPC 把本仓库挂成工作区与会话（与 1833 同一套电话）。版本管理页要真仓库才有读数。
        const workspacePath = REPO_ROOT.replace(/\\/g, '/')
        const createProbe = await evaluateThrough<Record<string, unknown>>(page, rpcScript('workspace/create', '{ request: { path: ' + JSON.stringify(workspacePath) + ' } }'))
        let workspaceId: string | null = null
        if (createProbe.ok) {
          const value = asRecord(asRecord(asRecord(createProbe.value.body)?.result)?.value)
          const ws = asRecord(value?.workspace)
          if (typeof ws?.workspaceId === 'string') workspaceId = ws.workspaceId
        }
        facts.workspaceCreate = { ok: createProbe.ok, workspaceId }
        if (workspaceId === null) {
          return observations.concat([observe({
            checkId: 'workspace-open',
            title: '工作区能在页面里打开',
            ok: false,
            status: 'blocked',
            detail: 'workspace/create 没回 workspaceId：' + (createProbe.ok ? JSON.stringify(createProbe.value.body).slice(0, 400) : createProbe.message),
            expected: '页面 RPC 建出一个会话可用的工作区',
            actual: createProbe.ok ? '回包里没有 workspace.workspaceId' : createProbe.message,
            hint: '确认隔离 home 与工作区路径；证据里 workspaceCreate 有回包',
            evidence: await save('workspace-create.json', facts.workspaceCreate, 'workspace/create RPC 的原始回包'),
          })])
        }
        const sessionProbe = await evaluateThrough<Record<string, unknown>>(page, rpcScript('session/create', '{ request: { workspaceId: ' + JSON.stringify(workspaceId) + ' } }'))
        let sessionId: string | null = null
        if (sessionProbe.ok) {
          const value = asRecord(asRecord(asRecord(sessionProbe.value.body)?.result)?.value)
          if (typeof value?.sessionId === 'string') sessionId = value.sessionId
        }
        facts.sessionCreate = { ok: sessionProbe.ok, sessionId }
        if (sessionId === null) {
          return observations.concat([observe({
            checkId: 'session-open',
            title: '会话能在页面里打开',
            ok: false,
            status: 'blocked',
            detail: 'session/create 没回 sessionId：' + (sessionProbe.ok ? JSON.stringify(sessionProbe.value.body).slice(0, 400) : sessionProbe.message),
            expected: '页面 RPC 建出一个会话',
            actual: sessionProbe.ok ? '回包里没有 sessionId' : sessionProbe.message,
            hint: '工作区这步过了才会走到这里；证据里 sessionCreate 有回包',
            evidence: await save('session-create.json', facts.sessionCreate, 'session/create RPC 的原始回包'),
          })])
        }
        await sleep(3500)

        // 3) 真鼠标开右侧边栏 → 点 MattSkills 入口 → 点「版本管理」页签。
        await realClick(raw, 'button[aria-label="打开右侧边栏"]')
        await sleep(1600)
        const entryClick = await realClick(raw, PANEL_ENTRY)
        await sleep(1200)
        const panelReady = await waitForPanelReady(page, 10000)
        facts.panelReady = panelReady
        // 默认页签会先显示列表骨架屏（GitHub 后端读票要十几秒）；骨架屏不消失就 force click 页签。
        let tabClick = panelReady.ok ? await realClick(raw, VERSION_TAB) : { ok: false, problem: '面板骨架屏 10 秒没消失（' + panelReady.detail + '）' }
        facts.tabClickFirst = tabClick
        await sleep(1600)
        let rootAfter = await readRootState(page)
        if (!rootAfter.ok) {
          const forced = await forceClick(raw, VERSION_TAB)
          facts.tabClickForced = forced
          await sleep(1800)
          rootAfter = await readRootState(page)
          if (rootAfter.ok) tabClick = forced
        }
        if (!rootAfter.ok) {
          const waited = await waitForPanelReady(page, 30000)
          facts.panelReadyLate = waited
          const forcedAgain = await forceClick(raw, VERSION_TAB)
          facts.tabClickForcedAgain = forcedAgain
          await sleep(2000)
          rootAfter = await readRootState(page)
          if (rootAfter.ok) tabClick = forcedAgain
        }
        const firstRoot = rootAfter
        facts.panel = { entryClick, panelReady, tabClick, firstRoot }
        if (!firstRoot.ok) {
          return observations.concat([observe({
            checkId: 'version-tab-open',
            title: '用真鼠标能打开 MattSkills 面板并进版本管理页',
            ok: false,
            status: 'blocked',
            detail: '点了侧栏入口与版本管理页签后，页面里没有 [data-vc-shell]。入口点击 ' + JSON.stringify(entryClick) + '，页签点击 ' + JSON.stringify(tabClick),
            expected: '版本管理页签打开后页面里有 [data-vc-shell] 根节点（data-vc-page / data-vc-width / data-vc-skin）',
            actual: JSON.stringify(firstRoot),
            hint: '面板入口、页签 data-ink-key 或版本管理页签可见性变了；看证据 panel 读数',
            evidence: await save('panel-open.json', facts.panel, '面板入口、页签点击与首个根节点读数'),
          })])
        }

        // 面板打开阶段的诊断基线：先取走，后面每档的新记录才分得清。
        facts.diagBaseline = (await drainInto('baseline:panel-open')).summary

        // 4) 逐皮肤 × 逐宽度 × 逐页：切肤 → 重挂页签 → 校准宽度 → 导航 → 读 DOM → 截图 → 记证据。
        let errorCursor = 0
        const allPageErrors: string[] = []
        const allUnrelatedErrors: string[] = []
        const comboSummaries: any[] = []
        const enabledPages = PAGES.filter(function (p) { return ENABLED_PAGES.indexOf(p.id) >= 0 })
        const enabledWidths = WIDTHS.filter(function (w) { return ENABLED_WIDTHS.indexOf(w) >= 0 })
        const enabledSkins = SKINS.filter(function (s) { return ENABLED_SKINS.indexOf(s.id) >= 0 })
        facts.plan = { pages: enabledPages.map(function (p) { return p.id }), widths: enabledWidths, skins: enabledSkins.map(function (s) { return s.id }), taskProbe: TASK_PROBE }

        for (const skin of enabledSkins) {
          // 皮肤要在页签挂载前设好；切完重挂后读页面根 data-vc-skin 确认。
          await markDiagPhase(page, 'skin:' + skin.id + ':remount')
          const skinApplied = await evaluateThrough<any>(page, skinScript(skin.dark))
          const remounted = await remountVersionControl(raw)
          const skinState = await readRootState(page)
          facts['skin:' + skin.id] = { applied: skinApplied.ok ? skinApplied.value : skinApplied.message, remounted, rootSkin: skinState.skin, rootPage: skinState.page }
          facts['diag:skin:' + skin.id] = (await drainInto('skin:' + skin.id + ':remount')).summary
          if (skinState.skin !== skin.id) {
            observations.push(observe({
              checkId: 'skin-' + skin.id,
              title: '皮肤切到 ' + skin.id + ' 后版本管理页真的按这套皮肤挂载',
              ok: false,
              status: 'blocked',
              detail: '设了 body 的 data-ds-dark-theme 并重挂页签后，页面根 data-vc-skin=' + String(skinState.skin) + '（重挂 ' + JSON.stringify(remounted) + '）',
              expected: '页面根 data-vc-skin 等于 ' + skin.id,
              actual: String(skinState.skin),
              hint: '皮肤只在 VcRealTab 挂载时读一次；确认重挂（技能 → 版本管理）确实发生了',
              evidence: await save('skin-' + skin.id + '.json', facts['skin:' + skin.id], '皮肤切换与重挂的读数'),
            }))
          }

          for (let widthIndex = 0; widthIndex < enabledWidths.length; widthIndex += 1) {
            const target = enabledWidths[widthIndex]
            await markDiagPhase(page, 'width:' + skin.id + ':' + String(target) + ':calibrate')
            const widthCal = await calibrateWidth(page, raw, target)
            facts['width:' + skin.id + ':' + target] = widthCal
            facts['diag:width:' + skin.id + ':' + target] = (await drainInto('width:' + skin.id + ':' + String(target))).summary
            for (const pageDef of enabledPages) {
              const checkNumber = two(pageDef.checkBase + widthIndex * 2 + (skin.dark ? 0 : 1))
              const checkId = 'flow-1845-' + checkNumber
              const beforeNavDiag = await drainInto('pre-nav:' + checkId)
              await markDiagPhase(page, 'nav:' + checkId)
              const nav = await realClick(raw, 'button[data-vc-extra-link="' + pageDef.link + '"]')
              const arrived = await waitForPage(page, pageDef.id, 12000)
              await sleep(900)
              const afterNavDiag = await drainInto('after-nav:' + checkId)
              const probe = await evaluateThrough<any>(page, FACTS_SCRIPT)
              if (!probe.ok) {
                comboSummaries.push({ checkId, error: 'DOM 读数失败：' + probe.message })
                observations.push(observe({
                  checkId,
                  title: '#1845 ' + pageDef.id + ' 页 ' + String(target) + ' 宽 ' + skin.id + ' 皮肤：读不到 DOM',
                  ok: false,
                  detail: 'FACTS_SCRIPT 失败：' + probe.message,
                  hint: '页面可能还没挂载出来，或导航没落到本页',
                }))
                continue
              }
              const data = probe.value
              const sectionTitles: string[] = asArray(data.body && data.body.sectionTitles).map(function (t: any) { return String(t) })
              const seq = sequenceOk(sectionTitles, pageDef.expectedSections)
              // 决定性读数与 PASS 判据（每页不同）。
              const problems: string[] = []
              let decisive = ''
              if (data.root.page !== pageDef.id) problems.push('根 data-vc-page=' + String(data.root.page) + '（应为 ' + pageDef.id + '）')
              if (data.root.widthAttr !== target) problems.push('data-vc-width=' + String(data.root.widthAttr) + '（应为 ' + target + '）')
              if (data.root.skin !== skin.id) problems.push('data-vc-skin=' + String(data.root.skin) + '（应为 ' + skin.id + '）')
              const head = data.head
              if (head === null || head === undefined) problems.push('页头 data-vc-page-head 不在')
              else {
                if (String(head.title || '').length === 0) problems.push('页头标题为空')
                if (head.page !== pageDef.id) problems.push('页头 data-vc-page-head=' + String(head.page))
              }
              if (!seq.ok) problems.push('缺少区块：' + seq.missing.join('、') + '（实际顺序：' + sectionTitles.join(' → ') + '）')
              if (data.overflow.rootScroll > 2) problems.push('页面根横向溢出 ' + String(data.overflow.rootScroll) + 'px')
              if (asArray(data.overflow.elements).length > 0) problems.push('有 ' + String(asArray(data.overflow.elements).length) + ' 个元素伸到版面右侧之外')
              if (pageDef.id === 'rebase') {
                const rb = data.rebase || {}
                if (rb.opCount !== 9) problems.push('data-vc-rebase-op-count=' + String(rb.opCount) + '（应为 9）')
                if (rb.actionRows !== 9) problems.push('九行动作实际 ' + String(rb.actionRows) + ' 行')
                if (rb.todoRows === undefined || rb.todoRows === null) problems.push('待办区没画出来')
                const rebaseSections = asArray(data.body && data.body.sections)
                const firstRebaseTitle = rebaseSections.length > 0 ? String(rebaseSections[0].title) : null
                if (firstRebaseTitle !== '本次变基') problems.push('页面体第一段是「' + String(firstRebaseTitle) + '」，原型要求「本次变基」在最先')
                // 变基六步：六行、每行一条等宽命令、芯片文案与仓库真实状态一致。干净仓库里六步全部待处理。
                const stepRows = asArray(rb.stepRows)
                if (stepRows.length !== 6) problems.push('变基六步行数 ' + String(stepRows.length) + '（应为 6）')
                const stepCmds = stepRows.filter(function (r: any) { return String(r.command || '').length > 0 })
                if (stepCmds.length !== stepRows.length) problems.push('变基六步里 ' + String(stepRows.length - stepCmds.length) + ' 行缺等宽命令')
                const chipTexts = stepRows.map(function (r: any) { return String(r.chipText || '') })
                const badChip = chipTexts.filter(function (one: string) { return ['已完成', '进行中', '待处理'].indexOf(one) < 0 })
                if (badChip.length > 0) problems.push('六步芯片文案不认识：' + badChip.join('、'))
                if (String(rb.state === undefined || rb.state === null ? '' : rb.state) === '') {
                  const notPending = chipTexts.filter(function (one: string) { return one !== '待处理' })
                  if (notPending.length > 0) problems.push('干净仓库（无进行中操作）里六步却有非待处理芯片：' + notPending.join('、'))
                }
                // 原型 48 的动作条（下一步 / 中止并回到开始前）只是演示推进器，生产侧没有对应动作；
                // 部件已删，这里的 0 是产品口径，记进读数但不参与判定。
                const demoControls = asArray(data.controls).length
                const extraSections = rebaseSections.slice(5).map(function (s: any) { return String(s.title) })
                decisive = 'op-count=' + String(rb.opCount) + '，状态=' + String(rb.state) + '，动作行=' + String(rb.actionRows) + '，待办行=' + String(rb.todoRows) + '，状态行=' + joinText([rb.stateLine && rb.stateLine.kind, rb.stateLine && rb.stateLine.text]) + '，六步行=' + String(stepRows.length) + '，六步命令=' + String(stepCmds.length) + '，六步芯片=' + JSON.stringify(chipTexts) + '，四格事实=' + String(asArray(data.factCells).length) + '，演示推进器部件 .vcs-flow-controls=' + String(demoControls) + '（产品偏差：无生产对应动作，不判 FAIL）' + (extraSections.length > 0 ? '，额外多出的段=' + JSON.stringify(extraSections) : '')
              } else if (pageDef.id === 'conflicts') {
                const cf = data.conflicts || {}
                if (cf.count !== 15) problems.push('data-vc-conflicts-count=' + String(cf.count) + '（应为 15）')
                // 危险标记是条件判据：有进行中操作、或已读到冲突文件时才画红段；0 冲突清空态是普通段。
                const conflictState = String(cf.state === 'none' || cf.state === null || cf.state === undefined ? '' : cf.state)
                const expectDanger = conflictState !== '' || Number(cf.fileRows) > 0
                const firstDanger = asArray(data.body && data.body.sections).length > 0 && data.body.sections[0].danger === true
                if (firstDanger !== expectDanger) problems.push('「当前冲突」危险标记=' + String(firstDanger) + '，按状态（state=' + conflictState + '，冲突文件 ' + String(cf.fileRows) + ' 个）应为 ' + String(expectDanger))
                if (sectionTitles.indexOf('进行中操作') >= 0) problems.push('干净仓库里画出了「进行中操作」段（原型要求无操作时整段不画）')
                if (conflictState === '') {
                  if (cf.hasSummary === true) problems.push('没有进行中操作却画出了包含「继续…」的汇总行')
                  if (cf.continueBtn !== null && cf.continueBtn !== undefined) problems.push('没有进行中操作却出现了「继续」按钮')
                } else {
                  if (cf.hasSummary !== true) problems.push('有进行中操作却没有汇总行')
                  if (cf.continueBtn === null || cf.continueBtn === undefined) problems.push('有进行中操作却没有「继续」按钮')
                  else {
                    const expectDisabled = Number(cf.fileRows) > 0
                    if (cf.continueBtn.disabled !== expectDisabled) problems.push('「继续」按钮 disabled=' + String(cf.continueBtn.disabled) + '，剩余冲突 ' + String(cf.fileRows) + ' 个，应为 disabled=' + String(expectDisabled))
                    if (cf.filesLeft === null || cf.filesLeft === undefined) problems.push('汇总行缺剩余冲突读数')
                    else if (cf.filesLeft.count !== Number(cf.fileRows)) problems.push('汇总行剩余冲突 ' + String(cf.filesLeft.count) + ' 与文件行数 ' + String(cf.fileRows) + ' 不一致')
                  }
                }
                if (Number(cf.fileRows) > 0 && Number(cf.fileResolveButtons) < Number(cf.fileRows)) problems.push('冲突文件行 ' + String(cf.fileRows) + ' 行但「标记已解决」按钮只有 ' + String(cf.fileResolveButtons) + ' 个')
                decisive = 'conflicts-count=' + String(cf.count) + '，状态=' + (conflictState === '' ? 'none' : conflictState) + '，首段危险=' + String(firstDanger) + '（按状态应为 ' + String(expectDanger) + '），状态行=' + String(cf.stateLine) + '，冲突文件行=' + String(cf.fileRows) + '，空态=' + String(cf.filesEmpty) + '，汇总行=' + String(cf.hasSummary) + '，继续按钮=' + JSON.stringify(cf.continueBtn) + '，四格事实=' + String(asArray(data.factCells).length) + '，芯片=' + JSON.stringify(data.chips)
              } else if (pageDef.id === 'task') {
                const tk = data.task || {}
                const cmds = asArray(tk.cmds)
                const phaseRows = asArray(tk.phaseRows)
                const mutedChips = phaseRows.filter(function (r: any) { return r.chipTone === 'muted' }).length
                if (cmds.length !== 3) problems.push('等宽命令 ' + String(cmds.length) + ' 条（应为 3）')
                if (phaseRows.length !== 4) problems.push('阶段行 ' + String(phaseRows.length) + ' 行（应为 4）')
                if (mutedChips !== 4) problems.push('等待态芯片 ' + String(mutedChips) + ' 个 muted（应为 4）')
                if (tk.runningAttr === null || tk.runningAttr === undefined) problems.push('任务清单缺 data-vc-task-count')
                else if (String(tk.runningAttr.running) !== '0') problems.push('data-vc-task-running=' + String(tk.runningAttr.running) + '（干净仓库应为 0）')
                if (tk.emptyText === null || tk.emptyText === undefined) problems.push('任务清单空态没画出来')
                // 「取消之后」是静态说明段：只有文案，没有按钮。
                const sectionsAll = asArray(data.body && data.body.sections)
                const cancelAfter = sectionsAll.filter(function (s: any) { return String(s.title) === '取消之后' })
                if (cancelAfter.length !== 1) problems.push('「取消之后」段出现 ' + String(cancelAfter.length) + ' 次（应为 1 段）')
                else if (String(cancelAfter[0].note || '').length === 0) problems.push('「取消之后」段没有说明文字')
                const waitChips = phaseRows.map(function (r: any) { return String(r.chipText || '') })
                if (waitChips.filter(function (one: string) { return one === '等待' }).length !== 4) problems.push('空闲态四阶段芯片不全是「等待」：' + waitChips.join('、'))
                decisive = '等宽命令=' + JSON.stringify(cmds) + '，阶段=' + phaseRows.map(function (r: any) { return String(r.phase) + ':' + String(r.chipTone) + '「' + String(r.chipText) + '」' }).join('，') + '，进度条数=' + String(tk.meterCount) + '，运行中=' + String(tk.runningAttr && tk.runningAttr.running) + '，空态=' + String(tk.emptyText) + '，取消之后段=' + (cancelAfter.length === 1 ? '在（说明 ' + String((cancelAfter[0].note || '').length) + ' 字）' : '缺') + '，芯片=' + JSON.stringify(data.chips)
              }
              // 本档新增的 console.error / pageerror。
              const errors = page.pageErrors()
              const newErrors = errors.slice(errorCursor)
              errorCursor = errors.length
              for (const one of newErrors) allPageErrors.push(checkId + ': ' + one)
              // 宿主 MattSkills 面板列表取数超时（client loadSnapshot timeout）与三个流程页无关：
              // 记录原始文本，但归到「环境噪声」，不因此判这一档页面不齐。
              const isHostListNoise = function (one: string) { return /client loadSnapshot timeout/.test(one) }
              const unrelatedErrors = newErrors.filter(isHostListNoise)
              const pageErrors = newErrors.filter(function (one) { return !isHostListNoise(one) })
              for (const one of unrelatedErrors) allUnrelatedErrors.push(checkId + ': ' + one)
              if (pageErrors.length > 0) problems.push('本档有 ' + String(pageErrors.length) + ' 条 console.error/pageerror：' + pageErrors.slice(0, 3).join(' | '))

              // 截图（整页面板）并复制到 .scratch。截图会临时改视口高度，这一段单独标阶段，
              // 万一是改窗触发了报错也能分辨出来。
              await markDiagPhase(page, 'shot:' + checkId)
              const shotName = '1845-' + checkNumber + '-' + pageDef.id + '-' + String(target) + '-' + skin.id + '.png'
              const shotPath = path.join(context.evidence.root, shotName)
              const shot = await capturePanel(page, raw, shotPath)
              const scratch = shot.ok ? copyToScratch(shotPath, shotName) : { path: null, problem: null }
              const afterShot = await readRootState(page)
              const afterShotDiag = await drainInto('after-shot:' + checkId)
              const comboEvidence = {
                checkId, page: pageDef.id, widthTarget: target, skinTarget: skin.id, skinMode: 'evaluate-body-attr+remount',
                nav: { clicked: nav.ok, arrived },
                widthCalibration: widthCal,
                afterScreenshot: { width: afterShot.width, skin: afterShot.skin, page: afterShot.page },
                screenshot: { method: shot.method, bytes: shot.bytes, problem: shot.problem, evidencePath: shotPath, scratchPath: scratch.path },
                facts: data,
                newPageErrors: newErrors,
                diag: {
                  beforeNav: beforeNavDiag.summary,
                  afterNav: afterNavDiag.summary,
                  afterShot: afterShotDiag.summary,
                },
                problems,
              }
              const jsonName = '1845-' + checkNumber + '-' + pageDef.id + '-' + String(target) + '-' + skin.id + '.json'
              const jsonPath = path.join(context.evidence.root, jsonName)
              try { fs.writeFileSync(jsonPath, JSON.stringify(comboEvidence, null, 2), 'utf8') } catch (e) { /* 写证据失败时仍用 recordJson */ }
              const scratchJson = copyToScratch(jsonPath, jsonName)
              const savedPaths = await save('combo-' + checkId + '.json', comboEvidence, '每档完整 DOM 读数与截图信息（' + pageDef.id + ' ' + String(target) + 'px ' + skin.id + '）')
              if (scratchJson.problem !== null) facts['scratchProblem:' + checkId] = scratchJson.problem
              if (shot.problem !== null) facts['shotProblem:' + checkId] = shot.problem
              const allEvidence = [shotPath].concat(scratch.path === null ? [] : [scratch.path]).concat(savedPaths)

              const ok = problems.length === 0
              const tokenEntries = Object.keys(data.tokens || {})
              comboSummaries.push({ checkId, page: pageDef.id, width: target, skin: skin.id, ok, problems, sectionTitles, decisive, screenshot: shotPath, tokens: data.tokens || {}, colors: data.colors || {}, tokenCount: tokenEntries.length })
              observations.push(observe({
                checkId,
                title: '#1845 ' + checkNumber + ' ' + pageDef.id + ' 页 ' + String(target) + 'px ' + skin.id + '：页头与区块顺序、决定性读数、无溢出无报错',
                ok,
                status: ok ? undefined : 'fail',
                detail: (ok ? 'PASS：' : 'FAIL（' + problems.join('；') + '）：') + '页面 ' + String(data.root.page) + '，data-vc-width=' + String(data.root.widthAttr) + '，data-vc-skin=' + String(data.root.skin) + '，区块顺序：' + sectionTitles.join(' → ') + '；决定性读数：' + decisive,
                expected: pageDef.expectedSections.join(' → ') + '；决定性读数与目标宽度/皮肤一致；无横向溢出、无 pageerror',
                actual: problems.length === 0 ? '全部符合' : problems.join('；'),
                hint: ok ? '截图与读数见 evidence' : '看这份证据 JSON 里的 facts 与 screenshot，先确认是产品问题还是场景定位问题',
                evidence: allEvidence,
              }))
            }
          }
        }

        // 5) 任务页运行中进度条探针：用宿主长任务电话起浅克隆，看到 data-vc-flow-meter 的真实百分比后取消。
        if (TASK_PROBE) {
          const probeObs = await runTaskProgressProbe(context, page, raw, save, facts, allPageErrors)
          observations.push(probeObs)
        }

        // 6) 汇总证据（含不参与 PASS/FAIL 的产品偏差口径）。
        const deviations = [
          { id: 'demo-controller', page: 'rebase', note: '原型 48 的动作条「下一步 / 中止并回到开始前」是演示推进器；生产侧没有对应动作，共用部件 vcFlowControlsNode 已删除，页面上 .vcs-flow-controls=0 属产品口径，不参与 PASS/FAIL' },
          { id: 'undo-panel-after-body', page: 'rebase', note: '历史改写五个能力面板（选一条动作 / 看影响 / 确认执行）排在页面体之后；多出来的段只记读数、不判 FAIL' },
          { id: 'life-pack', page: 'env', note: '隔离 home 里 dsh-life-pack 0.3.87 与当前宿主不兼容，已从隔离 profile 的 bundles 里去掉；真实 home 未动' },
          { id: 'host-list-noise', page: 'env', note: 'client loadSnapshot timeout 30s 来自宿主 MattSkills 面板列表取数（隔离 home 里 GitHub 后端取不到数），与三个流程页无关，原始文本保留在 unrelatedErrors' },
        ]
        const summary = {
          plan: facts.plan,
          adapter: facts.adapter,
          pageReady: facts.pageReady,
          diagInstall: facts.diagInstall,
          skinRuns: { dark: facts['skin:dark'], light: facts['skin:light'] },
          combos: comboSummaries,
          pageErrors: allPageErrors,
          unrelatedErrors: allUnrelatedErrors,
          diagnostics: diagLog.map(function (entry: any) { return { label: entry.label, at: entry.at, ok: entry.ok, problem: entry.problem, summary: entry.summary } }),
          deviations,
        }
        await save('summary-1845.json', summary, '本次运行的档位清单、每档判定与全部 pageErrors')
        await save('diagnostics-1845.json', diagLog, '运行时取证原始记录：宿主电话 / fetch / console.error / 未捕获错误，按阶段归组（不参与 PASS/FAIL）')
        observations.push(observe({
          checkId: 'summary',
          title: '本次运行的档位清单与 pageErrors 汇总',
          ok: true,
          detail: '跑了 ' + String(comboSummaries.length) + ' 档，其中 PASS ' + String(comboSummaries.filter(function (c) { return c.ok }).length) + ' 档；全部 pageErrors ' + String(allPageErrors.length) + ' 条',
          evidence: [],
        }))
        return observations
      },
    },
    {
      id: 'stop',
      kind: 'stop',
      title: '停掉隔离实例',
    },
  ],
})

/**
 * 任务页运行中态探针：干净仓库里任务页只有等待态，data-vc-flow-meter 只在真有在途长任务时出现。
 * 起一次本仓库自己的浅克隆（file:// 地址、depth=1），轮询任务页直到出现带百分比的进度条，
 * 截图并读读数，然后点界面上的取消按钮（data-vc-task-cancel）取消，删掉临时目录。
 * 观察不到就如实记 blocked 并说清原因（例如克隆太快、没等到宿主轮询到运行中快照）。
 */
async function runTaskProgressProbe(context: ScenarioContext, page: PageHandle, raw: RawBrowserPage, save: (name: string, value: unknown, note: string) => Promise<string[]>, facts: Record<string, unknown>, allPageErrors: string[]): Promise<ScenarioObservation> {
  const startedAt = Date.now()
  const tmpRoot = path.join(REPO_ROOT, '.scratch', '1845', 'probe')
  const cloneDir = path.join(tmpRoot, 'repo-' + String(startedAt))
  let taskId: string | null = null
  let meterSeen: any = null
  let started: any = null
  try {
    fs.mkdirSync(tmpRoot, { recursive: true })
    // 先确保在任务页观察（当前最后一档就在任务页；这里只确认页面在任务页）。
    const nav = await realClick(raw, 'button[data-vc-extra-link="task"]')
    await waitForPage(page, 'task', 8000)
    await sleep(600)
    const url = 'file:///' + REPO_ROOT.replace(/\\/g, '/')
    const express = '{ op: "clone", args: { url: ' + JSON.stringify(url) + ', dir: ' + JSON.stringify(cloneDir.replace(/\\/g, '/')) + ', depth: 1 }, cwd: ' + JSON.stringify(REPO_ROOT.replace(/\\/g, '/')) + ' }'
    // 先用控制电话确认插件端点此刻可达（上一次跑时 start 回 ok:false 但没记 error，分不清是端点
    // 不可达、参数被拒还是通道装配失败）。query 不带参数，任何时刻都该回 ok。
    await markDiagPhase(page, 'probe:query')
    const queryProbe = await evaluateThrough<any>(page, rpcScript('wf.gitTaskQuery', '{}'))
    facts.taskProbeQuery = queryProbe.ok ? summarizeRpcCall(queryProbe.value) : { scriptError: queryProbe.message }
    facts.taskProbeDiagQuery = (await drainInto('probe:query')).summary
    await markDiagPhase(page, 'probe:start')
    started = await evaluateThrough<any>(page, rpcScript('wf.gitTaskStart', express))
    let startValue: any = null
    if (started.ok) {
      startValue = asRecord(asRecord(asRecord(started.value.body)?.result)?.value)
      const task = asRecord(startValue?.task)
      if (typeof task?.taskId === 'string') taskId = task.taskId
      // 完整回包：传输状态、body.result 的 ok / error（含 kind/reason/message/hint）、正文片段。
      facts.taskProbeStart = {
        taskId,
        reused: startValue === null ? null : startValue.reused,
        call: summarizeRpcCall(started.value),
        startValue: startValue === null ? null : startValue,
        bodyText: String(started.value.text || '').slice(0, 1200),
      }
    } else {
      facts.taskProbeStart = { error: started.message }
    }
    facts.taskProbeDiagStart = (await drainInto('probe:start')).summary
    // 轮询：每 200ms 读一次任务页运行中快照，最多 45 秒。看到进度条就停。
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      const probe = await evaluateThrough<any>(page, FACTS_SCRIPT)
      if (probe.ok) {
        const data = probe.value
        const meters = asArray(data.meters)
        const runningRows = asArray(data.task && data.task.rows).filter(function (r: any) { return r.state === 'running' })
        if (meters.length > 0 && runningRows.length > 0) { meterSeen = { meters, runningRows, data }; break }
      }
      await sleep(200)
    }
    if (meterSeen !== null) {
      const shotName = '1845-probe-task-running-' + String(Date.now()) + '.png'
      const shotPath = path.join(context.evidence.root, shotName)
      const shot = await capturePanel(page, raw, shotPath)
      const scratch = shot.ok ? copyToScratch(shotPath, shotName) : { path: null, problem: null }
      const evidenceValue = {
        start: facts.taskProbeStart,
        meters: meterSeen.meters,
        runningRows: meterSeen.runningRows,
        taskFacts: meterSeen.data.task,
        screenshot: { method: shot.method, bytes: shot.bytes, path: shotPath, scratchPath: scratch.path, problem: shot.problem },
        sectionsAtCapture: meterSeen.data.body.sectionTitles,
      }
      const saved = await save('task-running-probe.json', evidenceValue, '任务页运行中进度条的真实百分比读数与截图')
      facts.taskProbeMeter = meterSeen.meters
      // 阶段芯片口径：最后一个 at<=percent 的段是「进行中」（琥珀），之前的段已完成（绿），之后的段等待（灰）；
      // percent 到 100 时四段全绿。这里按抓到的真实百分比独立算一遍，与 DOM 里的芯片逐段对照。
      const meter0 = meterSeen.meters[0]
      const pct0 = Number(meter0.pct)
      const STAGE_POINTS = [0, 20, 85, 100]
      let activeIdx = -1
      if (isFinite(pct0) && pct0 >= 0 && pct0 < 100) {
        activeIdx = 0
        for (let i = 0; i < STAGE_POINTS.length; i += 1) { if (pct0 >= STAGE_POINTS[i]) activeIdx = i }
      }
      const phaseAtCapture = asArray(meterSeen.data.task && meterSeen.data.task.phaseRows)
      const stageProblems: string[] = []
      if (phaseAtCapture.length !== 4) stageProblems.push('四阶段行 ' + String(phaseAtCapture.length) + ' 行（应为 4）')
      else {
        phaseAtCapture.forEach(function (row: any, idx: number) {
          const expectDone = pct0 >= 100 || idx < activeIdx
          const expectActive = pct0 < 100 && idx === activeIdx
          const expectTone = expectDone ? 'ok' : (expectActive ? 'warn' : 'muted')
          const expectText = expectDone ? '已完成' : (expectActive ? '进行中' : '等待')
          if (row.chipTone !== expectTone) stageProblems.push('第 ' + String(idx + 1) + ' 段芯片色调 ' + String(row.chipTone) + '（percent=' + String(pct0) + '，应为 ' + expectTone + '）')
          if (String(row.chipText || '') !== expectText) stageProblems.push('第 ' + String(idx + 1) + ' 段芯片文案「' + String(row.chipText) + '」（percent=' + String(pct0) + '，应为「' + expectText + '」）')
        })
      }
      const activeStageName = activeIdx >= 0 ? ['准备目标目录', '接收对象', '检出文件', '完成校验'][activeIdx] : (pct0 >= 100 ? '全部完成' : '无（没有真实百分比）')
      // 取消：界面上运行中行有取消按钮，真鼠标点它；找不到就用宿主电话取消。
      let cancel = await realClick(raw, '[data-vc-task-cancel="1"]')
      if (!cancel.ok && taskId !== null) {
        const cancelRpc = await evaluateThrough<any>(page, rpcScript('wf.gitTaskCancel', '{ taskId: ' + JSON.stringify(taskId) + ' }'))
        cancel = { ok: cancelRpc.ok, problem: cancelRpc.ok ? null : cancelRpc.message }
      }
      facts.taskProbeCancel = { ok: cancel.ok, problem: cancel.problem }
      await sleep(2500)
      const after = await evaluateThrough<any>(page, FACTS_SCRIPT)
      const afterRows = after.ok && after.value.task ? after.value.task.rows : null
      const savedAfter = await save('task-running-after-cancel.json', { cancel: facts.taskProbeCancel, rows: afterRows }, '取消后的任务清单读数')
      const meter = meterSeen.meters[0]
      const stageOk = stageProblems.length === 0
      facts.taskProbeStages = { percent: pct0, activeStage: activeStageName, problems: stageProblems, rows: phaseAtCapture }
      return observe({
        checkId: 'flow-probe-running-task',
        title: '任务页运行中态：data-vc-flow-meter 进度条带真实百分比，阶段芯片与百分比一致，运行中行有取消按钮',
        ok: stageOk,
        status: stageOk ? undefined : 'fail',
        detail: '观察到运行中任务：进度条 data-vc-flow-meter=' + String(meter.pct) + '%，aria-valuenow=' + String(meter.aria) + '，条宽 ' + String(meter.barWidth) + '，标签「' + String(meter.label) + '」；按 percent=' + String(pct0) + ' 应有进行中段「' + activeStageName + '」，DOM 芯片=' + JSON.stringify(phaseAtCapture.map(function (r: any) { return String(r.phase) + ':' + String(r.chipTone) + '「' + String(r.chipText) + '」' })) + (stageOk ? '（一致）' : '（不一致：' + stageProblems.join('；') + '）') + '；运行中行 ' + String(meterSeen.runningRows.length) + ' 行（state=running），取消按钮=' + JSON.stringify(meterSeen.runningRows.map(function (r: any) { return r.cancel })) + '；取消结果=' + JSON.stringify(facts.taskProbeCancel) + '；取消后行=' + JSON.stringify(afterRows),
        expected: '出现 data-vc-flow-meter（0<pct<100）与 data-vc-task-cancel；阶段芯片按「最后一个 at<=percent 的段进行中」着色；取消后任务行进入已结束结论',
        actual: 'meter=' + String(meter.pct) + '%，active=' + activeStageName + '，stageProblems=' + String(stageProblems.length) + '，cancel=' + String(cancel.ok),
        hint: stageOk ? '截图与读数见 evidence' : '对照证据 JSON 里的 rows 与 percent，确认是产品阶段口径问题还是抓取瞬间 percent 已前进',
        evidence: [shotPath].concat(scratch.path === null ? [] : [scratch.path]).concat(saved).concat(savedAfter),
      })
    }
    const idle = await evaluateThrough<any>(page, FACTS_SCRIPT)
    const idleDiag = await drainInto('probe:idle')
    const saved = await save('task-running-probe-idle.json', { start: facts.taskProbeStart, query: facts.taskProbeQuery, diag: idleDiag.summary, facts: idle.ok ? idle.value.task : null }, '运行中探针没观察到进度条时的任务页读数与完整开始回包')
    return observe({
      checkId: 'flow-probe-running-task',
      title: '任务页运行中态：data-vc-flow-meter 进度条（未观察到）',
      ok: false,
      status: 'blocked',
      detail: '起了浅克隆任务（taskId=' + String(taskId) + '）但在 45 秒窗口里任务页没有同时出现 data-vc-flow-meter 与 running 行；控制电话 wf.gitTaskQuery=' + JSON.stringify(facts.taskProbeQuery) + '；开始回包=' + JSON.stringify(facts.taskProbeStart),
      expected: '克隆运行中出现带百分比的进度条',
      actual: '观察窗口内没等到运行中快照',
      hint: '可能克隆在本机 file:// 上几秒就结束、宿主轮询没赶上；换更大的源或调慢网络可复现，需在报告里注明未覆盖',
      evidence: saved,
    })
  } catch (error) {
    return observe({
      checkId: 'flow-probe-running-task',
      title: '任务页运行中态：data-vc-flow-meter 进度条（探针异常）',
      ok: false,
      status: 'blocked',
      detail: '探针抛错：' + messageOf(error),
      hint: '看场景日志；临时目录见 ' + tmpRoot,
    })
  } finally {
    // 取消可能没点中，先尝试用电话再取消一次，然后删临时目录（clone 进程可能还占着文件，重试几次）。
    if (taskId !== null) {
      try { await evaluateThrough<any>(page, rpcScript('wf.gitTaskCancel', '{ taskId: ' + JSON.stringify(taskId) + ' }')) } catch (e) { /* 任务可能已经结束 */ }
    }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try { fs.rmSync(cloneDir, { recursive: true, force: true }); break } catch (e) { await sleep(700) }
    }
    try { fs.rmSync(cloneDir, { recursive: true, force: true }) } catch (e) { /* 删不掉就在报告里写路径 */ }
  }
}
