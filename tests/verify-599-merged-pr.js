#!/usr/bin/env node
/**
 * 回归门禁：GitHub 房的「已合并」拉取请求 #599。
 *
 * 背景（2026-09-11 的诊断）：面板拉取请求列表的查询只向 GitHub 要「打开」与「已关闭」两种状态，
 * 而 GitHub 的拉取请求有三种（打开 / 已关闭 / 已合并），已合并的因此一条也不回来；
 * 而且插件内部把「不是已关闭」的一律当成「打开」，词表里也没有「已合并」。
 * 两道缺陷都要钉住，否则修好一道会立刻露出另一道。
 *
 * 这份门禁管四件事：
 *  一、数据路：列表查询发出的条件里必须含「已合并」；对同一批数据，主路（GraphQL）与兜底路（REST）
 *      给出相同的条数与相同的状态（已合并归到已关闭，合并时间保留）。
 *  二、归一：已合并归到已关闭；坏值（state 缺失、缺合并时间）收敛，不抛错。
 *  三、界面：把构建产物里的拉取请求列表与单票详情两个组件单独切出来，用真 React 渲染，
 *      断言已合并的显示「已合并」、已关闭没合并的仍显示「已关闭」、打开的仍显示「打开」。
 *  四、判据单源：两个界面文件都不再自己判「不是 CLOSED 就当打开」，而是调用 stateKind.js。
 *
 * 运行：node tests/verify-599-merged-pr.js
 *   （界面那几条需要先跑 node scripts/build.mjs；产物不在时自动跳过并说明）
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
function check(cond, msg) {
  if (cond) console.log('  PASS ' + msg)
  else { failed++; console.log('  FAIL ' + msg) }
}

// 真仓此刻的事实（2026-09-11 用 gh 查得，独立于被测代码）：
// 本仓共 10 条拉取请求，其中 5 条已合并（#316 #321 #517 #518 #575）、5 条已关闭没有合并（#106 #273 #275 #287 #493）。
// 下面用的就是这个事实，不是复算被测代码的结果。
const MERGED_NUMBERS = [316, 321, 517, 518, 575]
const CLOSED_ONLY_NUMBERS = [106, 273, 275, 287, 493]
const MERGED_AT = {
  316: '2026-08-30T05:34:11Z',
  321: '2026-08-30T05:08:57Z',
  517: '2026-09-06T17:56:01Z',
  518: '2026-09-06T18:00:21Z',
  575: '2026-09-10T08:55:53Z',
}
const ALL_PR_NUMBERS = MERGED_NUMBERS.concat(CLOSED_ONLY_NUMBERS).sort((a, b) => a - b)

// ------------------------------------------------------------------
// 一、数据路：用插件自己的代码（GitHub 后端 listIssues）对合成数据跑一遍
// ------------------------------------------------------------------
const { normalizeIssue } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/backends/github/normalize.js')).href)
const { listIssues } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/backends/github/issues.js')).href)
const { prStateKind } = await import(pathToFileURL(resolve(ROOT, 'src/client/views/shared/stateKind.js')).href)

const REPO = { refId: 'FeatherHunter/dsh-mattpocock-skills-deck' }

function gqlPR(n) {
  const merged = Object.prototype.hasOwnProperty.call(MERGED_AT, n)
  return {
    number: n, title: 'PR #' + n, state: merged ? 'MERGED' : 'CLOSED', body: 'b',
    url: 'https://github.com/o/r/pull/' + n,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', closedAt: '2026-01-03T00:00:00Z',
    mergedAt: merged ? MERGED_AT[n] : null,
    author: { login: 'a' }, assignees: { nodes: [] }, labels: { nodes: [] }, milestone: null,
    comments: { nodes: [] }, reviews: { nodes: [] },
  }
}
function restPR(n) {
  const merged = Object.prototype.hasOwnProperty.call(MERGED_AT, n)
  return {
    number: n, title: 'PR #' + n, state: 'closed', body: 'b',
    html_url: 'https://github.com/o/r/pull/' + n,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', closed_at: '2026-01-03T00:00:00Z',
    merged_at: merged ? MERGED_AT[n] : null,
    user: { login: 'a' }, labels: [], assignees: [], reviews: [],
  }
}
function restIssue(n) {
  // 注意：这一份必须和真 GitHub 的 /issues 一致 —— 里面有 reviews 键的话，
  //   归一会把整批普通工单都误认成拉取请求（实测过一次：505 条全变成 PR）。
  const out = {
    number: n, title: 'issue ' + n, state: 'open', body: '', html_url: 'https://github.com/o/r/issues/' + n,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', closed_at: null,
    user: { login: 'a' }, labels: [], assignees: [],
  }
  // 真 REST 的 /issues 列表把拉取请求也夹带回来，并挂一个 pull_request 标记（归一靠它认出是拉取请求）。
  // 要点：这一条里 state 写的是 open、merge 标记里也没有合并时间 —— 真 GitHub 就是这样，
  // 合并时间要靠 /pulls 富化才补上（见 pulls.js 的 enrichRestPRs），所以归一时不能只看 state。
  if (ALL_PR_NUMBERS.indexOf(n) >= 0) out.pull_request = { merged_at: null }
  return out
}

/** 主路：GraphQL 能正常返回。桩按查询里写的状态条件回答（与真 GitHub 行为一致），并记下收到的查询文本。 */
function makeGraphQLCtx() {
  const queries = []
  const ctx = {
    cwd: ROOT,
    platform: { resolveExecutable: async (n) => (n === 'gh' ? 'gh' : null), env: { get: () => '' } },
    exec: async (cmd, args) => {
      const joined = (args || []).join('\n')
      if (joined.includes('graphql')) {
        if (joined.includes('pullRequests(')) {
          queries.push(joined)
          const statesPart = (joined.match(/states:\[([^\]]*)\]/) || [])[1] || ''
          const wantMerged = /MERGED/.test(statesPart)
          const nodes = ALL_PR_NUMBERS.filter((n) => wantMerged || !Object.prototype.hasOwnProperty.call(MERGED_AT, n)).map(gqlPR)
          return { code: 0, stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } }), stderr: '' }
        }
        return { code: 0, stdout: JSON.stringify({ data: { repository: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }), stderr: '' }
      }
      return { code: 1, stdout: '', stderr: 'unexpected: ' + joined.slice(0, 80) }
    },
    logEvent: () => {},
    isEnabled: () => false,
  }
  return { ctx, queries }
}

/** 兜底路：GraphQL 整条失败，REST 顶上（/issues 给工单加拉取请求条目，/pulls 富化合并时间）。
 *  桩必须按 page 分页回答（第 2 页起给空）：这是真 GitHub 的行为，
 *  不给空的话列表那条「翻到不足一页为止」的循环会拿同一页翻满 10 页，条数会被放大十倍。 */
function makeRESTCtx() {
  const calls = []
  const ctx = {
    cwd: ROOT,
    platform: { resolveExecutable: async (n) => (n === 'gh' ? 'gh' : null), env: { get: () => '' } },
    exec: async (cmd, args) => {
      const joined = (args || []).join('\n')
      calls.push(joined)
      const page = Number((joined.match(/[?&]page=(\d+)/) || [])[1] || 1)
      if (joined.includes('graphql')) return { code: 1, stdout: '', stderr: 'Post "https://api.github.com/graphql": unexpected EOF' }
      if (joined.includes('/issues?state=all')) {
        if (page > 1) return { code: 0, stdout: '[]', stderr: '' }
        // 工单编号从 1000 起，避开真仓那 10 条拉取请求的编号：
        //   真 GitHub 的 /issues 列表本来就带拉取请求条目（下面那段就是对它的模拟），
        //   若工单也占这些编号，同一编号会出现两条，条数判断就失了准头（实测踩过一次）。
        const arr = []
        for (let i = 0; i < 505; i++) arr.push(restIssue(1000 + i))
        for (const n of ALL_PR_NUMBERS) arr.push(restIssue(n))
        return { code: 0, stdout: JSON.stringify(arr), stderr: '' }
      }
      if (joined.includes('/pulls?state=all')) {
        if (page > 1) return { code: 0, stdout: '[]', stderr: '' }
        return { code: 0, stdout: JSON.stringify(ALL_PR_NUMBERS.map(restPR)), stderr: '' }
      }
      return { code: 1, stdout: '', stderr: 'unexpected: ' + joined.slice(0, 80) }
    },
    logEvent: () => {},
    isEnabled: () => false,
  }
  return { ctx, calls }
}

function prsOf(res) { return (res && res.ok ? res.data : []).filter((x) => x.isPullRequest === true) }

{
  const { ctx, queries } = makeGraphQLCtx()
  const res = await listIssues(REPO, {}, ctx)
  const prs = prsOf(res)
  check(prs.length === 10, '主路：拉取请求条数与真仓一致（10 条，实得 ' + prs.length + '）')
  const nums = prs.map((p) => Number(p.key)).sort((a, b) => a - b)
  check(JSON.stringify(nums) === JSON.stringify(ALL_PR_NUMBERS), '主路：回来的就是真仓那 10 条（实得 ' + nums.join(',') + '）')
  const merged = prs.filter((p) => p.mergedAt)
  check(merged.length === 5, '主路：已合并的 5 条在列表里（实得 ' + merged.length + '）')
  check(merged.every((p) => p.state === 'closed'), '主路：已合并的归到「已关闭」（界面才画得对）')
  check(merged.every((p) => MERGED_AT[Number(p.key)] === p.mergedAt), '主路：合并时间原样保留（判「已合并」靠它）')
  const closedOnly = prs.filter((p) => CLOSED_ONLY_NUMBERS.indexOf(Number(p.key)) >= 0)
  check(closedOnly.length === 5 && closedOnly.every((p) => p.state === 'closed' && !p.mergedAt), '主路：已关闭没合并的 5 条仍是「已关闭」且合并时间为空')
  const prQuery = queries.find((q) => q.includes('pullRequests(')) || ''
  const statesPart = (prQuery.match(/states:\[([^\]]*)\]/) || [])[1] || ''
  check(/MERGED/.test(statesPart), '主路：拉取请求列表查询把「已合并」写进条件（实得 states:[' + statesPart + ']）')
  check(statesPart.split(',').length === 3, '主路：条件是三种状态而不是两种（实得 ' + statesPart + '）')
}

{
  const { ctx, calls } = makeRESTCtx()
  const res = await listIssues(REPO, {}, ctx)
  const prs = prsOf(res)
  check(calls.some((c) => c.includes('/pulls?state=all')), '兜底路：确实走了 REST（/pulls 被调用）')
  check(prs.length === 10, '兜底路：条数与主路一致（10 条，实得 ' + prs.length + '）')
  const merged = prs.filter((p) => p.mergedAt)
  check(merged.length === 5 && merged.every((p) => p.state === 'closed'), '兜底路：已合并的 5 条归到「已关闭」且合并时间有值')
  check(merged.every((p) => MERGED_AT[Number(p.key)] === p.mergedAt), '兜底路：合并时间与主路一致')
  const closedOnly = prs.filter((p) => CLOSED_ONLY_NUMBERS.indexOf(Number(p.key)) >= 0)
  check(closedOnly.length === 5 && closedOnly.every((p) => p.state === 'closed' && !p.mergedAt), '兜底路：已关闭没合并的与主路口径相同')
}

// ------------------------------------------------------------------
// 二、归一：已合并收成已关闭；坏值收敛
// ------------------------------------------------------------------
{
  const m = normalizeIssue(gqlPR(575))
  check(m.state === 'closed' && m.mergedAt === MERGED_AT[575], '归一：GitHub 回来的「已合并」收成已关闭，合并时间保留')
  const c = normalizeIssue(gqlPR(106))
  check(c.state === 'closed' && c.mergedAt === null, '归一：已关闭没合并的仍是已关闭，合并时间为空')
  const o = normalizeIssue({ number: 1, title: 't', state: 'OPEN', mergedAt: null })
  check(o.state === 'open', '归一：打开的仍是打开')
  const restM = normalizeIssue(restPR(575))
  check(restM.state === 'closed' && restM.mergedAt === MERGED_AT[575], '归一：REST 形状的已合并在同一口径上')
  // 真 REST 的 /issues 条目：state 写 open，合并时间靠 /pulls 富化补上（这是兜底路上最容易被漏掉的一种形状）
  const restIssuesEntry = normalizeIssue({ number: 575, title: 'PR #575', state: 'open', html_url: 'https://github.com/o/r/issues/575', pull_request: { merged_at: null }, merged_at: MERGED_AT[575], user: { login: 'a' }, labels: [] })
  check(restIssuesEntry.state === 'closed' && restIssuesEntry.isPullRequest === true, '归一：兜底路 /issues 里 state=open 的已合并条目也收成已关闭（只看 state 会漏掉）')
  const plainIssue = normalizeIssue({ number: 506, title: '普通工单', state: 'open', html_url: 'https://github.com/o/r/issues/506', user: { login: 'a' }, labels: [] })
  check(plainIssue.state === 'open' && plainIssue.mergedAt === null, '归一：普通工单不受影响（仍是打开，合并时间为空）')
  const noState = normalizeIssue({ number: 2, title: 't' })
  check(noState.state === 'open', '坏值：来源缺 state 时收敛为打开（不抛错）')
  const weird = normalizeIssue({ number: 3, title: 't', state: 42, mergedAt: 12345 })
  check(weird.state === 'open' && weird.mergedAt === null, '坏值：state 是数字、合并时间是数字时都收敛（state=open、mergedAt=null）')
  const upper = normalizeIssue({ number: 4, title: 't', state: 'MERGED' })
  check(upper.state === 'closed', '坏值：合并时间缺失但 state 写着 MERGED 时仍收成已关闭（不画成打开）')
}

// ------------------------------------------------------------------
// 四、判据单源（先跑，界面一节要用这个判据喂数据）
// ------------------------------------------------------------------
{
  check(typeof prStateKind === 'function', '判据单源：views/shared/stateKind.js 导出 prStateKind')
  check(prStateKind({ state: 'closed', mergedAt: MERGED_AT[575], isPullRequest: true }) === 'merged', '判据：已关闭 + 合并时间有值 + 是拉取请求 = 已合并')
  check(prStateKind({ state: 'closed', mergedAt: null, isPullRequest: true }) === 'closed', '判据：已关闭 + 无合并时间 = 已关闭')
  check(prStateKind({ state: 'open', mergedAt: null, isPullRequest: true }) === 'open', '判据：打开 = 打开')
  check(prStateKind({ state: 'closed', mergedAt: MERGED_AT[575], isPullRequest: false }) === 'closed', '判据：普通工单带合并时间也不画成已合并（只认拉取请求）')
  check(prStateKind({ state: 'merged', mergedAt: null }) === 'merged', '判据：来源直接写 MERGED 时也认（不依赖某一路归一）')
  check(prStateKind({}) === 'open', '判据：来源为空时不抛错（按打开收敛）')
  for (const rel of ['src/client/views/PrTab.js', 'src/client/views/IssueDetail.js']) {
    const src = readFileSync(resolve(ROOT, rel), 'utf8')
    check(!/String\([^)]*state[^)]*\)\s*\.toUpperCase\(\)\s*!==\s*'CLOSED'/.test(src), '不再用「不是 CLOSED 就当打开」：' + rel)
    check(src.includes('prStateKind'), '用同一份判据：' + rel + ' 调 prStateKind')
  }
}

// ------------------------------------------------------------------
// 三、界面：把产物里的组件单独切出来渲染
// 为什么这么切：整块面板需要一个已经被宿主数据灌满的内部状态对象，门禁里造不出来；
// 而这两个组件本身是纯渲染（输入一张票、输出 DOM），单独渲染正好验的是「显示成什么」。
// ------------------------------------------------------------------
const PRODUCT = resolve(ROOT, 'package/lib/client.js')
if (!existsSync(PRODUCT)) {
  console.log('  SKIP 界面一节：产物 package/lib/client.js 不在（先跑 node scripts/build.mjs）')
} else {
  const { JSDOM } = await import('jsdom')
  const React = (await import('react')).default
  const ReactDOMClient = await import('react-dom/client')
  const { act } = await import('react')
  const esbuild = (await import('esbuild')).default
  const bundle = readFileSync(PRODUCT, 'utf8')

  // 词条从产物里读真货（与线上同一份文字），避免门禁自己造词
  const dict = {}
  for (const key of ['list.state.open', 'list.state.closed', 'list.state.merged']) {
    const re = new RegExp("'" + key + "':\\s*'([^']*)'", 'g')
    const hits = []
    let m
    while ((m = re.exec(bundle)) !== null) hits.push(m[1])
    check(hits.length === 2, '词条 ' + key + ' 在产物里中英各一条（实得 ' + hits.length + ' 条）')
    dict[key] = hits[0]
  }
  const trFn = (key, params) => {
    let s = dict[key] !== undefined ? dict[key] : key
    if (params) s = s.replace(/\{(\w+)\}/g, (mm, n) => (n in params ? String(params[n]) : mm))
    return s
  }

  function extractFn(src, header) {
    const i = src.indexOf(header)
    if (i < 0) throw new Error('产物里找不到：' + header)
    let depth = 0
    let started = false
    for (let k = i; k < src.length; k++) {
      const c = src[k]
      if (c === '{') { depth++; started = true }
      else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1) }
    }
    throw new Error('函数体没有闭合：' + header)
  }

  /** 把产物里的一个组件函数包成模块：函数体照抄，它依赖的名字由下面这段垫片按测试桩喂进去。 */
  function loadComponent(fnSrc, label) {
    const shim = [
      'const React = globalThis.__REACT__',
      'const h = React.createElement',
      'const tr = globalThis.__TR__',
      'const Ic = globalThis.__IC__',
      'const Tip = globalThis.__TIP__',
      'const DswsCtx = React.createContext(null)',
      'const prStateKind = globalThis.__PRSTATEKIND__',
      'const prFilterForList = () => ({ isPullRequest: true })',
      'const prIssuesOf = globalThis.__PRISSUES__',
      'const setActiveIssue = globalThis.__SETACTIVE__',
      'const loadSnapshot = () => {}',
      'const buildColorOf = () => ({})',
      'const hexA = () => null',
      'const darken = () => null',
      'const isLightHex = () => false',
      'const colorOf = {}',
      'const emit = () => {}',
      'const peekNav = () => null',
      'const popNav = () => {}',
      'const pushNav = () => {}',
      'const copyText = () => {}',
      'const issueUrlFor = () => ""',
      'const repoStr = () => ""',
      'const effortOf = () => ""',
      'const effortNamesOf = () => []',
      'const idOfParts = (a, b) => String(a) + "\\u0000" + String(b)',
      'const openInNewSession = () => {}',
      'const actionColorOf = () => null',
      'const mkRowAction = () => null',
      'const fetchIssueDetail = () => {}',
      // 详情页会把评论区渲染函数**当值**塞进一个三元表达式，取不到值会在求值那一刻抛
      // 「temporal dead zone」——不是调用才炸。所以这里给一个函数体，不是 null。
      'const renderIssueDetailComments = () => null',
      'const selectIssueComment = () => null',
      'const mdImgOverlay = () => null',
      'const mdToHtml = (x) => String(x == null ? "" : x)',
      '',
    ].join('\n')
    const dir = mkdtempSync(join(tmpdir(), 'dsws599-'))
    const code = shim + fnSrc + '\nexport { ' + label + ' }\n'
    const built = esbuild.transformSync(code, { loader: 'js', format: 'esm' }).code
    const file = join(dir, label + '.mjs')
    writeFileSync(file, built, 'utf8')
    return import(pathToFileURL(file).href)
  }

  // jsdom + 真 React 的一套环境
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:59599/' })
  const { window } = dom
  window.requestAnimationFrame = window.requestAnimationFrame || ((cb) => setTimeout(cb, 0))
  window.cancelAnimationFrame = window.cancelAnimationFrame || clearTimeout
  if (typeof window.ResizeObserver === 'undefined') window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  if (!window.document.fonts) window.document.fonts = { ready: Promise.resolve() }
  global.window = window
  global.document = window.document
  global.Node = window.Node
  global.HTMLElement = window.HTMLElement
  global.IS_REACT_ACT_ENVIRONMENT = true

  const snapshots = ALL_PR_NUMBERS.map((n) => {
    const merged = Object.prototype.hasOwnProperty.call(MERGED_AT, n)
    return {
      key: String(n), number: n, title: 'PR #' + n, state: 'closed',
      mergedAt: merged ? MERGED_AT[n] : null, isPullRequest: true, reviews: [],
      labels: [], assignees: [], author: { login: 'a' }, comments: [],
      updatedAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', body: '正文',
    }
  })
  // 打开状态本仓现在没有，单造一张用来看「打开的还显示打开」
  const openPR = { key: '900', number: 900, title: 'PR #900', state: 'open', mergedAt: null, isPullRequest: true, reviews: [], labels: [], assignees: [], author: { login: 'a' }, comments: [], updatedAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', body: '正文' }

  // 下面这几个全局是切出来的组件要用的桩。
  // 注意：垫片是在模块装载那一刻取一次（const prIssuesOf = globalThis.__PRISSUES__），
  //   所以这些必须在装载之前就位，之后再改 globalThis 是没用的（踩过一次：组件里 prIssuesOf 变成 undefined）。
  let currentIssues = []
  globalThis.__REACT__ = React
  globalThis.__TR__ = trFn
  globalThis.__IC__ = () => null
  globalThis.__TIP__ = function (props) { return props && props.children ? props.children : null }
  globalThis.__PRSTATEKIND__ = prStateKind
  globalThis.__PRISSUES__ = () => currentIssues
  globalThis.__SETACTIVE__ = () => {}

  async function render(Comp, props) {
    const container = window.document.createElement('div')
    window.document.body.appendChild(container)
    let root = null
    let html = ''
    try {
      await act(async () => {
        root = ReactDOMClient.createRoot(container)
        root.render(React.createElement(Comp, props))
        await new Promise((r) => setTimeout(r, 20))
      })
      html = container.innerHTML
    } finally {
      try { if (root) root.unmount() } catch (e) {}
      try { if (container.parentNode) container.parentNode.removeChild(container) } catch (e) {}
    }
    return html
  }

  // ---- 先跑单票详情页：它先跑，后面拉取请求页那一段才不会把整份门禁带走 ----
  {
    const mod = await loadComponent(extractFn(bundle, 'const IssueDetail = function (props)'), 'IssueDetail')
    const storeOf = (issue) => ({ snapshot: { issues: [issue], maps: [] }, issueDetail: issue, activeIssue: issue.number, issueMode: 'real', cwd: 'D:\\ws', selection: null, backendModules: [], activeEffortId: '', navStack: [] })
    const merged575 = snapshots.filter((x) => x.number === 575)[0]
    const closed106 = snapshots.filter((x) => x.number === 106)[0]
    const htmlMerged = await render(mod.IssueDetail, { st: storeOf(merged575) })
    const headMerged = htmlMerged.split('描述')[0] || htmlMerged
    check(headMerged.includes('已合并'), '界面·详情页：已合并的 #575 顶部状态显示「已合并」')
    check(!/>已关闭</.test(headMerged) && !/>Open</.test(headMerged), '界面·详情页：没有把已合并的 #575 画成「已关闭」或「打开」')
    const htmlClosed = await render(mod.IssueDetail, { st: storeOf(closed106) })
    const headClosed = htmlClosed.split('描述')[0] || htmlClosed
    check(headClosed.includes('已关闭'), '界面·详情页：已关闭没合并的 #106 仍显示「已关闭」')
    const htmlOpen = await render(mod.IssueDetail, { st: storeOf(openPR) })
    const headOpen = htmlOpen.split('描述')[0] || htmlOpen
    check(headOpen.includes('Open'), '界面·详情页：打开的 #900 仍显示「Open」')
  }

  // ---- 拉取请求页 ----
  {
    const mod = await loadComponent(extractFn(bundle, 'const PrTab = function (props)'), 'PrTab')
    const issues = snapshots.concat([openPR])
    currentIssues = issues
    const html = await render(mod.PrTab, { st: { snapshot: { issues }, selection: null, backendModules: [] } })
    check(html.includes('PR #575'), '界面·拉取请求页：已合并的 #575 在列表里')
    const mergedBadges = (html.match(/已合并/g) || []).length
    check(mergedBadges === 5, '界面·拉取请求页：正好 5 条显示「已合并」（实得 ' + mergedBadges + '）')
    // 徽章文字整个就是「已关闭」（前后就是标签边界），按「恰好是这个词」来数，
    //   不用「已」这种零宽断言 —— 之前那版在本机数出来是 0，白查了一轮。
    const closedBadges = (html.match(/>已关闭</g) || []).length
    check(closedBadges === 5, '界面·拉取请求页：已关闭没合并的 5 条仍显示「已关闭」（实得 ' + closedBadges + '）')
    check(html.includes('PR #900') && (html.match(/>Open</g) || []).length === 1, '界面·拉取请求页：打开的仍显示「Open」（本仓现无打开项，用造的 #900 验）')
    check(!/PR #575[\s\S]{0,400}?>已关闭</.test(html), '界面·拉取请求页：#575 那行没有显示成「已关闭」')
  }
}

if (failed) { console.log('\n[verify-599-merged-pr] FAIL（' + failed + ' 项）'); process.exit(1) }
console.log('\n[verify-599-merged-pr] GREEN 已合并拉取请求门禁就绪')
