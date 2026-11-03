// verify/scenarios/1833-list-head.ts —— 真机验证 #1833：列表页头部的四块吸顶，失败与额度提示搬出状态行。
//
// 验证路线：base 的真机验证能力会把候选包装进隔离的 web profile 实例，这里从页面里用真鼠标打开
// 「MattSkills」面板（右侧边栏 → 工具列表 → MattSkills），然后：
//   1) 量吸顶几何 —— .dsws-body（面板滚动容器）里的 [data-list-sticky] 在滚动前后是否一直贴着容器顶边；
//      这一块里必须真的有 KPI（[data-list-head="kpi"]）与筛选行（[data-ink-group] 芯片），而列表行、
//      历史票翻页行、状态句（.dsws-truth）必须留在吸顶块外面随列表滚动。
//   2) 失败态 —— 换一个指向不存在远端仓库的临时工作区（场景自己造），等刷新彻底失败后看面板头部
//      刷新按钮旁那枚「失败」小标识：文字是「失败」、悬停读得到原因、列表状态行不再有一条独占的失败句；
//      再把远端改回真仓库、点刷新，等失败标识消失、列表行回来（这一步用真刷新验证「恢复后消失」）。
//   3) 额度入口 —— 健康仓库 + 空历史时，通知中心应当画得出来（这是 #1833 修复要求的「当前状态别依赖历史」），
//      打开后能看到「额度」行、人话档位，展开还能看原始读数。真机没画出来就如实记 fail，不拿源码推断顶替。
//
// 两次跑法（工作根、批次 home 换成你自己的）：
//   # 健康仓库：吸顶 + 额度入口
//   $env:DSH_HOME='<批次 home>'
//   node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js `
//     run verify/scenarios/1833-list-head.ts --profile web --work-root <工作根> --json --collect-all
//
//   # 失败态：坏远端工作区 + 恢复
//   $env:DSH_1833_MODE='broken'
//   （同一个命令再跑一次；坏工作区由场景自己在临时目录里造，不需要手工准备）
//
// 可选环境变量（用来复现宽面板/极窄面板，需要有头适配器暴露 preset/resize；标准适配器只有 headless
// 的 800x600，此时如实记下视口，不假装验过别的档位）：
//   DSH_1833_PRESET=wide|narrow|short   窗口预设（verify/presets.mjs 同名档位）
//   DSH_1833_RESIZE=WxH                 直接改窗口尺寸（例如 460x1000）
//   DSH_1833_WORKSPACE=<绝对路径>       健康态要挂的仓库（默认本仓库）
//   DSH_1833_FAIL_WAIT=<毫秒>           坏仓库等刷新彻底失败的时间（默认 20000）
//   DSH_1833_RECOVER=0                  关掉「失败后改回真远端再刷新」这一步
//
// 判据口径：每条 observation 的 ok 是这条验收的结论；status=blocked 表示环境做不出这一条，
// 不是产品失败。证据写进 evidence（DOM 读数 JSON + 截图），报告里带路径。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { PageHandle, ScenarioContext, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { hooks } from '../hooks.ts'

/** 场景文件在 verify/scenarios/ 下，仓库根在它上面两层。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
/** 健康态挂哪个工作区；默认本仓库（真实 GitHub 后端，列表页有上千张票可滚）。 */
const HEALTHY_WORKSPACE = process.env.DSH_1833_WORKSPACE === undefined ? REPO_ROOT.replace(/\\/g, '/') : String(process.env.DSH_1833_WORKSPACE)
/** 模式：healthy 验吸顶与额度入口；broken 验失败小标识与恢复。 */
const MODE = String(process.env.DSH_1833_MODE || 'healthy').toLowerCase() === 'broken' ? 'broken' : 'healthy'
/** 坏仓库指向的远端：域名合法但仓库不存在，刷新会 404 / 解析失败。 */
const BROKEN_REMOTE = 'https://github.com/FeatherHunter/definitely-not-a-real-repo-1833-xyz.git'
/** 等刷新失败的时间：宿主取数有重试与退避，太短会读到「正在重试」中间态。 */
const FAIL_WAIT_MS = Number(process.env.DSH_1833_FAIL_WAIT || 20000)
/** 失败后恢复那一步：把远端改回真仓库再点刷新；DSH_1833_RECOVER=0 关掉。 */
const RECOVER_ENABLED = String(process.env.DSH_1833_RECOVER || '1') !== '0'

const MASK_COUNT_SCRIPT = 'document.querySelectorAll(' + JSON.stringify('[class*="_mask_"]') + ').length'
const CLOSE_BUTTON = 'button[aria-label="关闭"]'
const WORKSPACE_BUTTON = 'button[aria-label="选择工作区"]'
const PASSWORD_INPUT_SCRIPT = 'document.querySelectorAll(' + JSON.stringify('input[type="password"]') + ').length'

/**
 * 在页面里走客户端的 RPC 协议建工作区与会话：POST /api/<method>，信封是 DSH 的 client-request。
 * 不用 hooks 种下的本地 markdown 工作区 —— 那个工作区没初始化，Deck 列表页挂不出来；这边要的是真实仓库。
 */
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

/** 面板吸顶块与滚动容器的读数：几何、KPI/筛选行是否在块里、列表行/翻页行/状态句是否在块外。 */
const STICKY_FACTS_SCRIPT = [
  '(function () {',
  '  function norm(s) { return (s || "").replace(/\\s+/g, " ").trim(); }',
  '  function box(el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }',
  '  var body = document.querySelector(".dsws-body");',
  '  var sticky = document.querySelector("[data-list-sticky]");',
  '  var kpi = document.querySelector("[data-list-head=\\"kpi\\"]");',
  '  function insideSticky(el) { return !!(sticky && el && sticky.contains(el)); }',
  '  function countInside(selector) {',
  '    var all = Array.prototype.slice.call(document.querySelectorAll(selector));',
  '    var n = 0;',
  '    for (var i = 0; i < all.length; i += 1) if (insideSticky(all[i])) n += 1;',
  '    return { total: all.length, inside: n };',
  '  }',
  '  var truth = document.querySelector(".dsws-truth");',
  '  var notice = document.querySelector("[data-notice-budget]");',
  '  var fail = document.querySelector("[data-head-fail]");',
  '  return {',
  '    viewport: { w: window.innerWidth, h: window.innerHeight },',
  '    hasBody: !!body,',
  '    bodyBox: body ? box(body) : null,',
  '    bodyScroll: body ? { scrollTop: Math.round(body.scrollTop), scrollHeight: body.scrollHeight, clientHeight: body.clientHeight } : null,',
  '    stickyBox: sticky ? box(sticky) : null,',
  '    stickyText: sticky ? norm(sticky.innerText).slice(0, 400) : null,',
  '    kpiBox: kpi ? box(kpi) : null,',
  '    kpiInsideSticky: insideSticky(kpi),',
  '    filterChips: countInside("[data-ink-group]"),',
  '    rows: countInside("[data-log^=\\"list.row.\\"]"),',
  '    pager: countInside(".dsws-closed-note"),',
  '    truth: { inDom: !!truth, inside: insideSticky(truth), text: truth ? norm(truth.innerText).slice(0, 200) : null },',
  '    failMark: fail ? { text: norm(fail.innerText), aria: fail.getAttribute("aria-label"), reason: fail.getAttribute("data-head-fail"), box: box(fail) } : null,',
  '    noticeRow: notice ? { tier: notice.getAttribute("data-notice-budget"), text: norm(notice.innerText).slice(0, 200) } : null,',
  '  };',
  '})()',
].join('\n')

/** 从列表位置的 React fiber 往上找带 props.st 的组件，读快照 refresh 那一格：额度视图的原料、失败态的原料。 */
const SNAPSHOT_STATE_SCRIPT = [
  '(function () {',
  '  function fiberKey(el) {',
  '    var keys = Object.keys(el);',
  '    for (var i = 0; i < keys.length; i += 1) {',
  '      var k = keys[i];',
  "      if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0) return k;",
  '    }',
  '    return null;',
  '  }',
  "  var anchor = document.querySelector('.dsws-stickybar') || document.querySelector('.dsws-body') || document.querySelector('.dws-body');",
  '  if (!anchor) return { found: false, reason: "no panel anchor" };',
  '  var key = fiberKey(anchor);',
  '  if (key === null) return { found: false, reason: "no react fiber key on anchor" };',
  '  var fiber = anchor[key];',
  '  for (var depth = 0; fiber && depth < 80; depth += 1) {',
  '    var props = fiber.memoizedProps;',
  "    if (props && props.st && typeof props.st === 'object' && typeof props.st.snapMode === 'string') {",
  '      var st = props.st;',
  '      var snap = st.snapshot || null;',
  '      var refresh = snap && snap.refresh ? snap.refresh : null;',
  '      var view = props.view || null;',
  '      return {',
  '        found: true,',
  '        depth: depth,',
  '        snapMode: st.snapMode,',
  '        snapPending: st.snapPending === true,',
  '        snapError: st.snapError ? String(st.snapError).slice(0, 300) : null,',
  '        hasSnapshot: !!snap,',
  '        hasRefresh: !!refresh,',
  '        refreshKeys: refresh ? Object.keys(refresh) : [],',
  '        hasRefreshBackend: !!(refresh && refresh.backend),',
  '        backendBudgetKind: refresh && refresh.backend ? refresh.backend.budgetKind : null,',
  '        backendReadKnown: refresh && refresh.backend ? refresh.backend.readKnown : null,',
  '        selectionBackendId: st.selection && st.selection.backendId ? st.selection.backendId : null,',
  '        viewReadable: view ? view.readable === true : null,',
  '        viewEvents: view && Array.isArray(view.events) ? view.events.length : null,',
  '      };',
  '    }',
  '    fiber = fiber.return;',
  '  }',
  '  return { found: false, reason: "no props.st.snapMode within 80 fibers" };',
  '})()',
].join('\n')
/** 把滚动容器推到 50% 与底部，量吸顶块是否一直贴着容器顶边；顺手把吸顶块里外的行数再数一遍。 */
const SCROLL_SCRIPT = [
  '(function () {',
  '  function box(el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }',
  '  var body = document.querySelector(".dsws-body");',
  '  var sticky = document.querySelector("[data-list-sticky]");',
  '  if (!body || !sticky) return { ok: false, reason: !body ? "no .dsws-body" : "no [data-list-sticky]" };',
  '  function snap(label) { return { label: label, scrollTop: Math.round(body.scrollTop), sticky: box(sticky), body: box(body) }; }',
  '  var before = snap("before");',
  '  body.scrollTop = Math.round(body.scrollHeight * 0.5);',
  '  var mid = snap("mid");',
  '  body.scrollTop = body.scrollHeight;',
  '  var end = snap("end");',
  '  var inside = { rows: 0, pager: 0 };',
  '  var rows = document.querySelectorAll("[data-log^=\\"list.row.\\"]");',
  '  for (var i = 0; i < rows.length; i += 1) if (sticky.contains(rows[i])) inside.rows += 1;',
  '  var notes = document.querySelectorAll(".dsws-closed-note");',
  '  for (var j = 0; j < notes.length; j += 1) if (sticky.contains(notes[j])) inside.pager += 1;',
  '  body.scrollTop = 0;',
  '  return { ok: true, before: before, mid: mid, end: end, rowsTotal: rows.length, rowsInsideSticky: inside.rows, pagerInsideSticky: inside.pager };',
  '})()',
].join('\n')

/** 失败态的落点：头部小标识、列表状态行有没有失败句、整份错误行在不在。 */
const FAIL_FACTS_SCRIPT = [
  '(function () {',
  '  function norm(s) { return (s || "").replace(/\\s+/g, " ").trim(); }',
  '  var mark = document.querySelector("[data-head-fail]");',
  '  var truth = document.querySelector(".dsws-truth");',
  '  var body = document.body.innerText || "";',
  '  var r = mark ? mark.getBoundingClientRect() : null;',
  '  return {',
  '    hasFailMark: !!mark,',
  '    failReason: mark ? mark.getAttribute("data-head-fail") : null,',
  '    failText: mark ? norm(mark.innerText) : null,',
  '    failAria: mark ? mark.getAttribute("aria-label") : null,',
  '    failVisible: !!(r && r.width > 0 && r.height > 0),',
  '    hasTruthRow: !!truth,',
  '    truthText: truth ? norm(truth.innerText).slice(0, 300) : null,',
  '    hasFullErrorRow: body.indexOf("快照加载失败") >= 0,',
  '    listRows: document.querySelectorAll(\'[data-log^="list.row."]\').length,',
  '  };',
  '})()',
].join('\n')

/** 通知中心：铃铛在不在、额度行画没画、档位与展开后的原始读数。 */
const NOTICE_FACTS_SCRIPT = [
  '(function () {',
  '  function norm(s) { return (s || "").replace(/\\s+/g, " ").trim(); }',
  '  var entry = document.querySelector("[data-notice-entry]");',
  '  var er = entry ? entry.getBoundingClientRect() : null;',
  '  var row = document.querySelector("[data-notice-budget]");',
  '  var state = document.querySelector("[data-notice-budget-state]");',
  '  var toggle = document.querySelector("[data-notice-budget-toggle]");',
  '  var detail = document.querySelector("[data-notice-budget-detail]");',
  '  var badge = document.querySelector(\'[data-head-fold="badge"]\');',
  '  return {',
  '    hasEntry: !!entry,',
  '    entryVisible: !!(er && er.width > 0 && er.height > 0),',
  '    entryAria: entry ? entry.getAttribute("aria-label") : null,',
  '    badgeInDom: !!badge,',
  '    badgeFolded: badge ? (String(badge.className || "").indexOf("dsws-folded") >= 0) : null,',
  '    hasBudgetRow: !!row,',
  '    tier: row ? row.getAttribute("data-notice-budget") : null,',
  '    rowText: row ? norm(row.innerText).slice(0, 300) : null,',
  '    stateText: state ? norm(state.innerText) : null,',
  '    hasToggle: !!toggle,',
  '    detailText: detail ? norm(detail.innerText).slice(0, 400) : null,',
  '  };',
  '})()',
].join('\n')

interface RawBrowserPage {
  readonly goto?: (url: string) => Promise<{ ok: boolean; error?: { message?: string } }>
  readonly click?: (selector: string) => Promise<{ ok: boolean; error?: { message?: string } }>
  readonly press?: (key: string) => Promise<{ ok: boolean; error?: { message?: string } }>
  /** 有头适配器额外给的窗口原语；标准适配器没有。 */
  readonly preset?: (id: string) => Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }>
  readonly resize?: (width: number, height: number) => Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }>
  readonly measureWindow?: () => Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }>
}

interface StickyFacts {
  readonly viewport?: { readonly w: number; readonly h: number }
  readonly hasBody?: boolean
  readonly bodyBox?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null
  readonly bodyScroll?: { readonly scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number } | null
  readonly stickyBox?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null
  readonly stickyText?: string | null
  readonly kpiBox?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null
  readonly kpiInsideSticky?: boolean
  readonly filterChips?: { readonly total: number; readonly inside: number }
  readonly rows?: { readonly total: number; readonly inside: number }
  readonly pager?: { readonly total: number; readonly inside: number }
  readonly truth?: { readonly inDom: boolean; readonly inside: boolean; readonly text: string | null }
  readonly failMark?: { readonly text: string; readonly aria: string | null; readonly reason: string | null; readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } } | null
  readonly noticeRow?: { readonly tier: string | null; readonly text: string } | null
}

interface ScrollFacts {
  readonly ok: boolean
  readonly reason?: string
  readonly before?: Record<string, unknown>
  readonly mid?: Record<string, unknown>
  readonly end?: Record<string, unknown>
  readonly rowsTotal?: number
  readonly rowsInsideSticky?: number
  readonly pagerInsideSticky?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
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

/** 造一个「声明自己是 GitHub 后端、但远端仓库不存在」的临时工作区：刷新必然失败。 */
function createBrokenWorkspace(): { dir: string; problem: string | null } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1833-broken-'))
  try {
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    // 后端声明与仓库根 docs/agents/workspace.yaml 同形：list页判定 github 后端，列表就去问 GitHub。
    fs.writeFileSync(
      path.join(dir, 'docs', 'agents', 'workspace.yaml'),
      ['version: 2', 'backendId: github', 'pickedAt: ' + String(Date.now()), 'source: user', 'layout: single', ''].join('\n'),
      'utf8'
    )
    const init = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
    if (init.status !== 0) return { dir, problem: 'git init 失败：' + String(init.stderr || init.error || '') }
    const remote = spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', BROKEN_REMOTE], { encoding: 'utf8' })
    if (remote.status !== 0) return { dir, problem: 'git remote add 失败：' + String(remote.stderr || remote.error || '') }
    return { dir, problem: null }
  } catch (error) {
    return { dir, problem: '造坏工作区失败：' + messageOf(error) }
  }
}

/** 真仓库的远端地址：恢复那一步把坏工作区的 origin 改回它。 */
function realRemoteUrl(): string | null {
  const proc = spawnSync('git', ['-C', REPO_ROOT, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })
  if (proc.status !== 0) return null
  const url = String(proc.stdout || '').trim()
  return url.length === 0 ? null : url
}

/** 用真鼠标点：适配器 click(selector) 走 Playwright locator.click，不靠页面里的合成事件。 */
async function realClick(raw: RawBrowserPage, selector: string): Promise<{ ok: boolean; problem: string | null }> {
  if (raw.click === undefined) return { ok: false, problem: '浏览器适配器没有暴露 click()' }
  const clicked = await raw.click(selector)
  return clicked.ok ? { ok: true, problem: null } : { ok: false, problem: clicked.error === undefined ? 'unknown error' : clicked.error.message }
}

export default defineScenario<ScenarioContext>({
  id: 'list-head-1833',
  title: '列表页头部四块吸顶，失败与额度提示退出状态行（#1833）',
  description: '在隔离的 web profile 实例里，用真鼠标打开 MattSkills 面板：量吸顶块在滚动前后是否一直贴着滚动容器顶边、块里是否真有 KPI 与筛选行、列表行与翻页行是否留在块外；失败态换一个远端不存在的临时工作区，看头部「失败」小标识、列表状态行不再独占失败句、恢复后标识消失；健康仓库空历史下看通知中心「额度」行是否真的可达。做不出的档位记 blocked 并说明。',
  hooks,
  steps: [
    {
      id: 'launch',
      kind: 'launch',
      title: '起一个装好候选包的隔离 web 实例',
    },
    {
      id: 'list-head',
      kind: 'custom',
      // 两次刷新（失败 + 恢复）加起来要等宿主取数重试，默认 120 秒不够。
      timeoutMs: 600000,
      title: '打开面板，量吸顶几何、失败小标识与额度入口',
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
            hint: pageResult.error.hint || '先确认 verify/browser.mjs 与 profile 里的 browser 声明',
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

        const facts: Record<string, unknown> = { mode: MODE }
        const save = async (name: string, value: unknown, note: string): Promise<string[]> => {
          const saved = await recordEvidence(context, name, value, note)
          if (saved.problem !== null) facts['evidenceProblem:' + name] = saved.problem
          return saved.path === null ? [] : [saved.path]
        }

        // 适配器只保证 PageHandle；goto/click/press 是适配器额外给的（同 verify/scenarios/ui.ts），
        // 挂在 PageHandle.page 上（上面那层 Result 的 .value 才是 PageHandle）。
        const raw = page.page as unknown as RawBrowserPage

        // 工作区：健康态挂真仓库；失败态现造一个坏远端工作区。
        let workspace = HEALTHY_WORKSPACE
        let brokenWorkspace: { dir: string; problem: string | null } | null = null
        if (MODE === 'broken') {
          brokenWorkspace = createBrokenWorkspace()
          facts.brokenWorkspace = brokenWorkspace
          if (brokenWorkspace.problem !== null) {
            return [observe({
              checkId: 'broken-workspace',
              title: '坏远端工作区造出来了',
              ok: false,
              status: 'blocked',
              detail: brokenWorkspace.problem,
              expected: '临时目录里有一个声明 github 后端、origin 指向不存在仓库的工作区',
              actual: brokenWorkspace.problem,
              hint: '失败态这条依赖它；造不出来时后面没法验失败标识',
            })]
          }
          workspace = brokenWorkspace.dir.replace(/\\/g, '/')
        }

        // 窗口档位：只有有头适配器才暴露 preset/resize。标准适配器是 headless 的 800x600，
        // 这一档本身也有效（右侧边栏窄面板），但要在报告里说清是哪一档，别当成真全屏。
        const wantPreset = process.env.DSH_1833_PRESET === undefined ? '' : String(process.env.DSH_1833_PRESET)
        const wantResize = process.env.DSH_1833_RESIZE === undefined ? '' : String(process.env.DSH_1833_RESIZE)
        if (wantPreset !== '' && typeof raw.preset === 'function') {
          const applied = await raw.preset(wantPreset)
          facts.window = applied.ok ? applied.value : { requested: wantPreset, error: applied.error === undefined ? 'unknown' : applied.error.message }
        } else if (wantResize !== '' && typeof raw.resize === 'function') {
          const size = wantResize.split('x')
          const applied = await raw.resize(Number(size[0]), Number(size[1]))
          facts.window = applied.ok ? applied.value : { requested: wantResize, error: applied.error === undefined ? 'unknown' : applied.error.message }
        } else {
          facts.window = { requested: wantPreset || wantResize || '', applied: 'default-window', adapters: { preset: typeof raw.preset === 'function', resize: typeof raw.resize === 'function' } }
        }

        // 1) 打开页面，关掉首开引导弹窗，确认停在宿主工作台（不是登录页）。
        if (raw.goto !== undefined) await raw.goto(instance.record.tokenUrl)
        await sleep(2500)
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
          if (text.ok && text.value !== null) {
            workspaceButtonText = text.value
            break
          }
          await sleep(250)
        }
        const passwordInputs = await evaluateThrough<number>(page, PASSWORD_INPUT_SCRIPT)
        const pageUrl = page.url()
        const pageReady = maskCount === 0 && workspaceButtonText !== null && passwordInputs.ok && passwordInputs.value === 0 && pageUrl.indexOf(instance.record.originUrl) === 0
        const pageEvidence = await save('page-state.json', { mode: MODE, workspace, window: facts.window, url: pageUrl, origin: instance.record.originUrl, maskCount, workspaceButtonText, passwordInputs: passwordInputs.ok ? passwordInputs.value : null }, '页面就绪检查的原始读数：遮罩数、工作区按钮、密码输入框、URL 与窗口档位')
        observations.push(observe({
          checkId: 'page-ready',
          title: '首开引导弹窗已关掉，页面是宿主工作台界面（不是登录页）',
          ok: pageReady,
          status: pageReady ? undefined : 'blocked',
          hard: pageReady,
          detail: '遮罩 ' + String(maskCount) + ' 个，工作区按钮 ' + (workspaceButtonText === null ? '没找到' : '「' + workspaceButtonText + '」') + '，密码输入框 ' + String(passwordInputs.ok ? passwordInputs.value : '读不到') + ' 个，窗口档位 ' + JSON.stringify(facts.window),
          expected: '遮罩 0 个、工作区按钮存在、没有密码输入框、URL 在实例源上',
          actual: '遮罩=' + String(maskCount) + '，工作区按钮=' + String(workspaceButtonText) + '，URL=' + pageUrl,
          hint: '页面卡在首开登录弹窗时这几项会同时不对；先看证据里的 page-state.json',
          evidence: pageEvidence,
        }))
        if (!pageReady) return observations

        // 2) 用 RPC 建这个工作区与会话，页面挂到真实仓库/坏仓库上。hooks 种下的本地 markdown 工作区
        //    没初始化，Deck 列表页挂不出来，所以不走它。
        const createProbe = await evaluateThrough<Record<string, unknown>>(page, rpcScript('workspace/create', '{ request: { path: ' + JSON.stringify(workspace) + ' } }'))
        let workspaceId: string | null = null
        if (createProbe.ok) {
          const value = asRecord(asRecord(asRecord(createProbe.value.body)?.result)?.value)
          const ws = asRecord(value?.workspace)
          if (typeof ws?.workspaceId === 'string') workspaceId = ws.workspaceId
        }
        facts.workspaceCreate = { ok: createProbe.ok, workspaceId, probe: createProbe.ok ? createProbe.value.body : createProbe.message }
        if (workspaceId === null) {
          const evidence = await save('workspace-create.json', facts.workspaceCreate, 'workspace/create RPC 的原始回包')
          return observations.concat([observe({
            checkId: 'workspace-open',
            title: '工作区能在页面里打开',
            ok: false,
            status: 'blocked',
            detail: 'workspace/create 没回 workspaceId：' + (createProbe.ok ? JSON.stringify(createProbe.value.body).slice(0, 400) : createProbe.message),
            expected: '页面 RPC 建出一个会话可用的工作区',
            actual: createProbe.ok ? '回包里没有 workspace.workspaceId' : createProbe.message,
            hint: '工作区路径打错了（Windows 路径要正斜杠或不带尾引号）或宿主拒绝挂这个目录',
            evidence,
          })])
        }
        const sessionProbe = await evaluateThrough<Record<string, unknown>>(page, rpcScript('session/create', '{ request: { workspaceId: ' + JSON.stringify(workspaceId) + ' } }'))
        let sessionId: string | null = null
        if (sessionProbe.ok) {
          const value = asRecord(asRecord(asRecord(sessionProbe.value.body)?.result)?.value)
          if (typeof value?.sessionId === 'string') sessionId = value.sessionId
        }
        facts.sessionCreate = { ok: sessionProbe.ok, sessionId, probe: sessionProbe.ok ? sessionProbe.value.body : sessionProbe.message }
        if (sessionId === null) {
          const evidence = await save('session-create.json', facts.sessionCreate, 'session/create RPC 的原始回包')
          return observations.concat([observe({
            checkId: 'session-open',
            title: '会话能在页面里打开',
            ok: false,
            status: 'blocked',
            detail: 'session/create 没回 sessionId：' + (sessionProbe.ok ? JSON.stringify(sessionProbe.value.body).slice(0, 400) : sessionProbe.message),
            expected: '页面 RPC 建出一个会话',
            actual: sessionProbe.ok ? '回包里没有 sessionId' : sessionProbe.message,
            hint: '看证据里的回包；工作区这一步过了才会走到这里',
            evidence,
          })])
        }
        await sleep(3500)

        // 3) 打开右侧边栏，点工具列表里的「MattSkills」。这一步必须用真鼠标：页面里合成的 click
        //    会被组件里的 pointerdown 处理跳过（前三版探针踩过）。
        await realClick(raw, 'button[aria-label="打开右侧边栏"]')
        await sleep(1500)
        const entrySelector = 'button[data-sidebar-right-guide-entry="dsh-mattpocock-skills-deck:deck-map"]'
        const deckEntry = await realClick(raw, entrySelector)
        facts.panelEntry = deckEntry
        // 列表取数要等宿主把票真的读回来（本机实测 GitHub 后端一次要十几秒）；轮询到列表行出现、
        // 或滚动容器被列表撑起来为止，最多等 40 秒。读得太早会把「0 条」当成结果。
        let headFacts: StickyFacts | null = null
        let waitAttempts = 0
        const waitBudget = MODE === 'broken' ? 4 : 26
        for (let attempt = 0; attempt < waitBudget; attempt += 1) {
          waitAttempts = attempt + 1
          const probe = await evaluateThrough<StickyFacts>(page, STICKY_FACTS_SCRIPT)
          if (probe.ok) {
            headFacts = probe.value
            const rowsNow = probe.value.rows?.total ?? 0
            const overflow = probe.value.bodyScroll === null || probe.value.bodyScroll === undefined ? 0 : probe.value.bodyScroll.scrollHeight - probe.value.bodyScroll.clientHeight
            const failed = probe.value.failMark !== null && probe.value.failMark !== undefined
            if (rowsNow > 0 || overflow > 80 || failed) break
          }
          await sleep(1500)
        }
        facts.listWait = {
          attempts: waitAttempts,
          rows: headFacts?.rows?.total ?? null,
          bodyScroll: headFacts?.bodyScroll ?? null,
        }
        const snapProbe = await evaluateThrough<Record<string, unknown>>(page, SNAPSHOT_STATE_SCRIPT)
        facts.snapshotState = snapProbe.ok ? snapProbe.value : { error: snapProbe.message }
        facts.stickyFacts = headFacts ?? { error: 'STICKY_FACTS_SCRIPT 没有返回读数' }
        const baseEvidence = await save('sticky-facts.json', { wait: facts.listWait, sticky: headFacts, snapshotState: facts.snapshotState }, '面板打开后的吸顶块与滚动容器读数，以及列表就绪耗时与快照 refresh 读数')
        const panelOpen = headFacts !== null && headFacts.hasBody === true && headFacts.stickyBox !== null && headFacts.stickyBox !== undefined
        observations.push(observe({
          checkId: 'panel-open',
          title: '用真鼠标能打开 MattSkills 面板，列表头吸顶块挂在页面里',
          ok: panelOpen,
          status: panelOpen ? undefined : 'blocked',
          hard: panelOpen,
          detail: panelOpen
            ? '面板打开：滚动容器 ' + JSON.stringify(headFacts?.bodyBox) + '，吸顶块 ' + JSON.stringify(headFacts?.stickyBox)
            : '点开入口后没找到 .dsws-body + [data-list-sticky]；入口点击结果 ' + JSON.stringify(deckEntry),
          expected: '右侧边栏工具列表点开 MattSkills 后，页面里有 .dsws-body 滚动容器与 [data-list-sticky] 吸顶块',
          actual: headFacts === null ? 'DOM 读数失败' : 'hasBody=' + String(headFacts.hasBody) + '，stickyBox=' + String(headFacts.stickyBox),
          hint: '侧栏入口的 data-sidebar-right-guide-entry 属性变了，或面板还停在加载态；看证据里的 sticky-facts.json',
          evidence: baseEvidence,
        }))
        if (!panelOpen) return observations

        // 4) 判定 1833-01：吸顶块里真的有 KPI 与筛选行；滚动前后一直贴着容器顶边；列表行/翻页行/状态句在块外。
        const stickyText = String(headFacts?.stickyText || '')
        const kpiIn = headFacts?.kpiInsideSticky === true
        const chipsIn = (headFacts?.filterChips?.inside ?? 0) > 0
        const chipsTotal = headFacts?.filterChips?.total ?? 0
        const headInside = kpiIn && chipsIn && chipsTotal > 0
        observations.push(observe({
          checkId: 'sticky-holds-list-head',
          title: '1833-01：KPI 统计行与筛选行真的在吸顶块里',
          ok: headInside,
          detail: 'KPI 在吸顶块里=' + String(kpiIn) + '，筛选芯片共 ' + String(chipsTotal) + ' 个、其中在吸顶块里 ' + String(headFacts?.filterChips?.inside ?? 0) + ' 个，吸顶块文字：' + stickyText.slice(0, 200),
          expected: '吸顶块同时包含 [data-list-head="kpi"] 与至少一枚 [data-ink-group] 筛选芯片',
          actual: 'KPI inside=' + String(kpiIn) + '，chips inside=' + String(headFacts?.filterChips?.inside ?? 0) + '/' + String(chipsTotal),
          hint: '吸顶包装只包了部分节点，或某个节点被挪到包装外；对照 src/client/views/ListTab.ts 头部那一段',
          evidence: baseEvidence,
        }))

        const scrolled = await evaluateThrough<ScrollFacts>(page, SCROLL_SCRIPT)
        const scrollFacts = scrolled.ok ? scrolled.value : null
        facts.scroll = scrollFacts ?? { error: scrolled.ok ? null : scrolled.message }
        await sleep(400)
        const afterScroll = await evaluateThrough<StickyFacts>(page, STICKY_FACTS_SCRIPT)
        facts.stickyFactsAfterScroll = afterScroll.ok ? afterScroll.value : { error: afterScroll.message }
        const scrollEvidence = await save('sticky-scroll.json', facts.scroll, '滚动到 50% 与底部时吸顶块与容器顶边的读数（before/mid/end）')

        const topOf = (entry: Record<string, unknown> | undefined): number | null => {
          const sticky = asRecord(entry?.sticky)
          const body = asRecord(entry?.body)
          if (sticky === null || body === null) return null
          return typeof sticky.y === 'number' && typeof body.y === 'number' ? Math.round(sticky.y - body.y) : null
        }
        const deltaBefore = scrollFacts === null ? null : topOf(scrollFacts.before)
        const deltaMid = scrollFacts === null ? null : topOf(scrollFacts.mid)
        const deltaEnd = scrollFacts === null ? null : topOf(scrollFacts.end)
        const endScrollTop = scrollFacts === null ? null : (typeof scrollFacts.end?.scrollTop === 'number' ? scrollFacts.end.scrollTop : null)
        const beforeScrollTop = scrollFacts === null ? null : (typeof scrollFacts.before?.scrollTop === 'number' ? scrollFacts.before.scrollTop : null)
        const scrollable = headFacts?.bodyScroll !== null && headFacts?.bodyScroll !== undefined && (headFacts.bodyScroll.scrollHeight - headFacts.bodyScroll.clientHeight > 80)
        const pinned = scrollFacts !== null && scrollFacts.ok && deltaBefore !== null && deltaMid !== null && deltaEnd !== null &&
          Math.abs(deltaBefore) <= 2 && Math.abs(deltaMid) <= 2 && Math.abs(deltaEnd) <= 2 &&
          beforeScrollTop !== null && endScrollTop !== null && endScrollTop - beforeScrollTop > 100
        observations.push(observe({
          checkId: 'sticky-pinned-on-scroll',
          title: '1833-01：列表滚动时吸顶块一直贴着滚动容器顶边',
          ok: scrollable ? pinned : false,
          status: scrollable ? undefined : 'blocked',
          detail: scrollable
            ? '吸顶块顶边相对滚动容器顶边的偏移：滚动前 ' + String(deltaBefore) + 'px、滚到 50% ' + String(deltaMid) + 'px、滚到底 ' + String(deltaEnd) + 'px；scrollTop 从 ' + String(beforeScrollTop) + ' 到 ' + String(endScrollTop) + '；滚动容器 ' + JSON.stringify(headFacts?.bodyScroll)
            : '这份列表比滚动容器矮（' + JSON.stringify(headFacts?.bodyScroll) + '），滚动这条测不出来；换一个有更多票的工作区再跑',
          expected: '三次读数里吸顶块顶边与容器顶边偏差都不超过 2px，且 scrollTop 实际移动超过 100px',
          actual: '偏移 before/mid/end = ' + String(deltaBefore) + '/' + String(deltaMid) + '/' + String(deltaEnd) + '，scrollTop 移动 ' + String(beforeScrollTop !== null && endScrollTop !== null ? endScrollTop - beforeScrollTop : null) + 'px',
          hint: 'position:sticky 没生效（父级 overflow 或 z-index 被别的层盖住）、或吸顶块高度比容器还高；看证据里的 sticky-scroll.json',
          evidence: scrollEvidence,
        }))

        const rowsOutside = (scrollFacts !== null && scrollFacts.rowsInsideSticky === 0) || (headFacts?.rows?.inside === 0 && (headFacts?.rows?.total ?? 0) > 0)
        const pagerOutside = (scrollFacts?.pagerInsideSticky ?? 0) === 0 && (headFacts?.pager?.inside ?? 0) === 0
        const truthOutside = headFacts?.truth?.inside !== true
        observations.push(observe({
          checkId: 'scrolling-content-stays-out',
          title: '1833-01：列表行、历史票翻页行与状态句都留在吸顶块外面（随列表滚动）',
          ok: rowsOutside && pagerOutside && truthOutside,
          detail: '列表行共 ' + String(headFacts?.rows?.total ?? 0) + ' 条、其中在吸顶块里 ' + String(headFacts?.rows?.inside ?? 0) + ' 条；翻页行（.dsws-closed-note）共 ' + String(headFacts?.pager?.total ?? 0) + ' 个、其中在吸顶块里 ' + String(headFacts?.pager?.inside ?? 0) + ' 个；状态句在吸顶块里=' + String(headFacts?.truth?.inside) + '、在页面里=' + String(headFacts?.truth?.inDom),
          expected: '吸顶块里没有列表行、没有翻页行、没有状态句；它们都在块外的滚动区',
          actual: 'rows inside=' + String(headFacts?.rows?.inside ?? 0) + '，pager inside=' + String(headFacts?.pager?.inside ?? 0) + '，truth inside=' + String(headFacts?.truth?.inside),
          hint: '吸顶包装把闭包节点一起包进去了；对照 ListTab.ts 的包装边界',
          evidence: baseEvidence,
        }))

        if (MODE === 'healthy') {
          // 5) 判定 1833-03：健康仓库 + 空历史时通知中心应当能画出来（额度行是「当前状态」，不依赖历史）。
          const noticeBefore = await evaluateThrough<Record<string, unknown>>(page, NOTICE_FACTS_SCRIPT)
          const noticeFacts = noticeBefore.ok ? noticeBefore.value : null
          facts.noticeFacts = noticeFacts ?? { error: noticeBefore.ok ? null : noticeBefore.message }
          const noticeEvidenceBefore = await save('notice-budget.json', { notice: noticeFacts, snapshotState: facts.snapshotState }, '通知中心入口与「当前状态·额度」行的读数，以及列表组件的快照 refresh 读数（额度视图的原料）')
          const hasEntry = noticeFacts?.hasEntry === true
          if (hasEntry) {
            await realClick(raw, '[data-notice-entry]')
            await sleep(900)
            const opened = await evaluateThrough<Record<string, unknown>>(page, NOTICE_FACTS_SCRIPT)
            facts.noticeFactsOpened = opened.ok ? opened.value : { error: opened.message }
            const openedFacts = opened.ok ? opened.value : null
            const toggle = openedFacts?.hasToggle === true
            if (toggle) {
              await realClick(raw, '[data-notice-budget-toggle]')
              await sleep(500)
              const expanded = await evaluateThrough<Record<string, unknown>>(page, NOTICE_FACTS_SCRIPT)
              facts.noticeFactsExpanded = expanded.ok ? expanded.value : { error: expanded.message }
            }
          }
          const openedFacts = asRecord(facts.noticeFactsOpened)
          const expandedFacts = asRecord(facts.noticeFactsExpanded)
          const tier = openedFacts === null ? null : openedFacts.tier
          const stateText = openedFacts === null ? null : openedFacts.stateText
          const detailText = expandedFacts === null ? null : expandedFacts.detailText
          const budgetOk = hasEntry && openedFacts !== null && typeof tier === 'string' && tier.length > 0 && typeof stateText === 'string' && stateText.length > 0 && typeof detailText === 'string' && detailText.length > 0
          const noticeEvidence = await save('notice-budget-opened.json', { entry: noticeFacts, opened: openedFacts, expanded: expandedFacts }, '点开通知中心后的额度行读数：档位、人话措辞与展开的原始读数')
          const stateEvidence = await save('list-head-state.json', { sticky: headFacts, scroll: scrollFacts, snapshotState: facts.snapshotState, notice: facts.noticeFacts, opened: openedFacts, expanded: expandedFacts }, '这一轮面板的关键读数合订本')
          observations.push(observe({
            checkId: 'notice-budget-reachable',
            title: '1833-03：健康仓库、空历史时通知中心也能看到「额度」行，展开有原始读数',
            ok: budgetOk,
            detail: budgetOk
              ? '通知中心入口可见；额度行档位=' + String(tier) + '，措辞「' + String(stateText) + '」，展开里有原始读数 ' + String(detailText).slice(0, 180)
              : '通知中心入口' + (hasEntry ? '在' : '不在') + '，额度行' + (openedFacts === null || openedFacts.hasBudgetRow !== true ? '没画出来' : '画了但档位/措辞/展开不齐：tier=' + String(tier) + '，state=' + String(stateText) + '，detail=' + String(detailText)),
            expected: '健康 GitHub 仓库 + 空历史：通知中心铃铛可见，当前状态里有「额度」行、人话档位，点开能看到原始读数',
            actual: hasEntry
              ? '入口在；' + JSON.stringify({ tier, stateText, detailText })
              : 'DOM 里没有 [data-notice-entry]（NotificationCenter 返回了 null）；badge 在 DOM=' + String(noticeFacts?.badgeInDom) + '，折叠=' + String(noticeFacts?.badgeFolded) + '；列表组件快照：snapMode=' + String(asRecord(facts.snapshotState)?.snapMode) + '，refresh 的键=' + JSON.stringify(asRecord(facts.snapshotState)?.refreshKeys) + '，refresh.backend 在=' + String(asRecord(facts.snapshotState)?.hasRefreshBackend),
            hint: '额度视图由快照的 refresh.backend 推出；真机快照里这一格缺席时 budgetTierViewOf 返回 null，通知中心整块不画。看证据 notice-budget.json 里的 snapshotState 与源码链（宿主 snapshot.ts 的 readBackendBudget / budget-state.ts 的 createBudgetState）',
            evidence: noticeEvidenceBefore.concat(noticeEvidence).concat(stateEvidence),
          }))
        }

        if (MODE === 'broken') {
          // 6) 判定 1833-02：等刷新失败，看头部小标识与列表状态行。
          await sleep(FAIL_WAIT_MS)
          const failProbe = await evaluateThrough<Record<string, unknown>>(page, FAIL_FACTS_SCRIPT)
          const failFacts = failProbe.ok ? failProbe.value : null
          facts.failFacts = failFacts ?? { error: failProbe.ok ? null : failProbe.message }
          const failEvidence = await save('fail-mark.json', failFacts, '刷新失败后：头部「失败」小标识、列表状态句、整份错误行的读数')
          const failText = String(failFacts?.failText || '')
          const failAria = String(failFacts?.failAria || '')
          const markOk = failFacts?.hasFailMark === true && failFacts?.failVisible === true && failText.indexOf('失败') >= 0 && (failAria.indexOf('刷新失败') >= 0 || failAria.indexOf('正在重试') >= 0)
          const statusRowQuiet = failFacts?.hasTruthRow !== true || String(failFacts?.truthText || '').indexOf('失败') < 0
          const fullErrorRow = failFacts?.hasFullErrorRow === true
          observations.push(observe({
            checkId: 'head-fail-mark',
            title: '1833-02：刷新失败由面板头部刷新按钮旁一枚「失败」小标识表达，悬停说原因',
            ok: markOk && statusRowQuiet,
            detail: '头部小标识：在=' + String(failFacts?.hasFailMark) + '、可见=' + String(failFacts?.failVisible) + '、文字「' + failText + '」、aria「' + failAria + '」、原因档=' + String(failFacts?.failReason) + '；列表状态行（.dsws-truth）：在=' + String(failFacts?.hasTruthRow) + '、文字=' + String(failFacts?.truthText) + '；整份错误行在=' + String(fullErrorRow),
            expected: '失败标识可见、文字含「失败」、aria 说清「刷新失败，正在重试」；列表状态行不再有一条独占的失败句（整份错误行仍可接受）',
            actual: 'mark=' + String(failFacts?.hasFailMark) + '，text=' + failText + '，aria=' + failAria + '，truthRow=' + String(failFacts?.truthText),
            hint: '小标识没画说明 truthFailureOf 没认出这次失败，或 Dock 里 RefreshFailMark 没挂上；状态行还有失败句说明 truthNoticeLines 的失败分支没删干净',
            evidence: failEvidence,
          }))
          const errorRowOk = fullErrorRow
          observations.push(observe({
            checkId: 'full-error-row',
            title: '1833-02：失败原因没有被藏掉，列表区仍给出完整错误行',
            ok: errorRowOk,
            detail: errorRowOk ? '列表区能看到「快照加载失败：…」整份错误行（这是允许的；被禁止的是状态行里那条会随列表滚走的独占失败句）' : '列表区没找到「快照加载失败」这行，失败原因只剩 aria，用户看不见',
            expected: '没有快照时仍有一行完整错误说明（list.errFull）',
            actual: 'hasFullErrorRow=' + String(fullErrorRow),
            hint: '错误整行在 ListTab.ts 的 snapMode==="err" && !snapshot 分支；别把它和状态句一起退役',
            evidence: failEvidence,
          }))

          // 7) 恢复：把坏远端改回真仓库，点头部「刷新」，等失败标识消失、列表行回来。
          if (RECOVER_ENABLED) {
            const realRemote = realRemoteUrl()
            if (realRemote === null || brokenWorkspace === null) {
              observations.push(observe({
                checkId: 'fail-mark-recover-skipped',
                title: '1833-02：恢复后失败标识消失、列表回来',
                ok: false,
                status: 'blocked',
                detail: '做不出恢复：' + (realRemote === null ? '读不到真仓库的 origin 地址' : '坏工作区没造出来'),
                expected: '把坏工作区的 origin 改回真仓库后刷新成功',
                actual: 'recover 前置条件缺失',
                hint: '这台机器上 git 读不到本仓库 origin；可以手工设 DSH_1833_RECOVER=0 跳过这条',
              }))
            } else {
              const setUrl = spawnSync('git', ['-C', brokenWorkspace.dir, 'remote', 'set-url', 'origin', realRemote], { encoding: 'utf8' })
              facts.recover = { realRemote, setUrlStatus: setUrl.status, stderr: String(setUrl.stderr || '').slice(0, 300) }
              const refreshClick = await realClick(raw, '[data-head-refresh]')
              facts.recover.refreshClick = refreshClick
              let recovered: Record<string, unknown> | null = null
              for (let attempt = 0; attempt < 60; attempt += 1) {
                await sleep(1500)
                const probe = await evaluateThrough<Record<string, unknown>>(page, FAIL_FACTS_SCRIPT)
                if (!probe.ok) continue
                recovered = probe.value
                if (probe.value.hasFailMark !== true && typeof probe.value.listRows === 'number' && probe.value.listRows > 0) break
              }
              facts.recover.after = recovered
              const recoverEvidence = await save('fail-recovered.json', facts.recover, '把坏工作区远端改回真仓库、点刷新之后的读数：失败标识是否消失、列表行是否回来')
              const markGone = recovered?.hasFailMark !== true
              const rowsBack = typeof recovered?.listRows === 'number' && recovered.listRows > 0
              observations.push(observe({
                checkId: 'fail-mark-recovered',
                title: '1833-02：远端改回真仓库后点刷新，失败标识消失、列表回来',
                ok: markGone && rowsBack,
                detail: '刷新点击=' + JSON.stringify(refreshClick) + '；之后：失败标识在=' + String(recovered?.hasFailMark) + '，列表行=' + String(recovered?.listRows) + '，整份错误行在=' + String(recovered?.hasFullErrorRow),
                expected: '一次成功刷新后 [data-head-fail] 消失、列表行数大于 0',
                actual: 'mark=' + String(recovered?.hasFailMark) + '，rows=' + String(recovered?.listRows),
                hint: '恢复依赖宿主取数恢复；失败标识不消失说明失败态没被新快照清掉（或刷新根本没跑成功）',
                evidence: recoverEvidence,
              }))
            }
          }
        }

        // 8) 过程留痕：截图只作排查线索，不参与结论。
        const pageErrors = page.pageErrors().slice(0, 10)
        const shotPath = path.join(context.evidence.root, '1833-' + MODE + '.png')
        const shot = await page.screenshot(shotPath)
        facts['pageErrors'] = pageErrors
        facts['screenshot'] = shot.ok ? shot.value : { error: shot.error.message }
        const allEvidence = await save('1833-facts.json', facts, '这一轮真机验证的全部事实：页面、吸顶几何、滚动读数、失败小标识、恢复结果与额度入口')
        observations.push(observe({
          checkId: 'page-screenshot-artifact',
          title: '过程留痕：页面截图（不作为结论判据）',
          ok: shot.ok && shot.value.bytes > 0,
          hard: false,
          detail: shot.ok ? String(shot.value.bytes) + ' 字节，' + shotPath + '；只供排查界面状态，结论看上面的 DOM 读数与证据文件' : '截图失败：' + shot.error.message,
          expected: '证据目录里有一张非空的 PNG（过程留痕，不参与结论）',
          actual: shot.ok ? String(shot.value.bytes) + ' 字节' : shot.error.message,
          evidence: shot.ok && shot.value.bytes > 0 ? [shotPath] : [],
        }))
        observations.push(observe({
          checkId: 'evidence-recorded',
          title: '这一轮的全部读数写进了证据文件',
          ok: true,
          hard: false,
          detail: '证据：' + allEvidence.join('、'),
          expected: 'DOM 读数与截图都落在证据目录里',
          actual: allEvidence.length > 0 ? allEvidence.join('、') : '没有证据路径',
          evidence: allEvidence,
        }))
        return observations
      },
    },
    {
      id: 'stop',
      kind: 'stop',
      title: '停实例并确认清理干净',
    },
  ],
})
