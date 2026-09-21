#!/usr/bin/env node
/**
 * 回归门禁：单票详情页的兜底不许说错话（#693）。
 *
 * 为什么要这道门：详情页的数据分两跳 —— 快照里那一行先拿来把标题画出来（秒开，#58 的成果），
 * 详情自己那次取数随后才到。快照那一行是**轻量预览**，它不带正文、也不带评论；
 * 阶段 2 把历史行换成更薄的片段之后，它会连正文与评论一起省掉。
 * 旧代码把这一行当成完整的详情用，于是说了两句假话：
 *   没有正文 → 画「无描述」（把「还没拿到」说成「这张票没有描述」）；
 *   没有评论 → 显示「只读」（把「还没拿到」说成「不能评论」）。
 *
 * 做法：把构建产物里的详情组件（连同评论区）切出来，用真 React 渲染，
 * 把每一种状态分别喂进去，断言它说的每句话都是真话。
 * 断言用的文案从产物里读真货（跟线上同一份字），门禁不自己造词。
 *
 * 五种状态：
 *   一、薄片段 + 详情还在路上 → 不说「无描述」、不说「只读」、不报「评论 (0)」，且标题已经画出来
 *   二、详情取数失败          → 不说「无描述」、不说「只读」，页面给得出失败原因与重试
 *   三、详情回来了但正文、评论确实是空的 → 「无描述」「无评论」这时候才可以说，输入框也在
 *   四、拉取请求              → 「只读」可以说（确实不能评论），且不给输入框
 *   五、详情回来了、这个后端不带评论能力 → 「只读」可以说，且不给输入框
 *   （另加一条：详情回来了、正文与评论都有 → 正常画出来，兜底没把正常路径带坏）
 *
 * 运行：node tests/verify-693-detail-fallback-honesty.js
 *   （界面那几条需要先跑 node scripts/build.mjs；产物不在时直接失败，不静默跳过）
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

const PRODUCT = resolve(ROOT, 'package/lib/client.js')
if (!existsSync(PRODUCT)) {
  check(false, '产物 package/lib/client.js 不在 —— 先跑 node scripts/build.mjs；npm run verify 链里产物已备')
  console.log('\n[verify-693] FAIL（' + failed + ' 项）')
  process.exit(1)
}

// ------------------------------------------------------------------
// 一、源码口径（不渲染也能验的两条）：正文与评论的取数来源
// ------------------------------------------------------------------
{
  const detailSrc = readFileSync(resolve(ROOT, 'src/client/views/IssueDetail.js'), 'utf8')
  const commentsSrc = readFileSync(resolve(ROOT, 'src/client/views/IssueDetailComments.js'), 'utf8')
  // 「无描述」这句话本身不再由详情页自己写死（改走词条），写死会让中英两语漏一份
  check(!detailSrc.includes("'无描述'"), '详情页不再写死「无描述」（改走词条，中英各一份）')
  check(!detailSrc.includes('无描述（快照未命中'), '连兜底占位那句也不再从「无描述」起头')
  // 评论区的取数来源只能是详情那次取数，不是快照那一行
  check(commentsSrc.includes('detail.notYet'), '评论区有「还没拿到」这一档说法（不是只有加载中与无评论两档）')
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
  check(String((pkg.scripts || {}).verify || '').includes('verify-693-detail-fallback-honesty.js'), '本门禁已挂进 npm run verify 链')
}

// ------------------------------------------------------------------
// 二、界面：把产物里的组件单独切出来，用真 React 渲染
// 为什么这么切：整块面板需要一个已被宿主数据灌满的内部状态对象，门禁里造不出来；
//   而这两个组件本身是纯渲染（输入一份状态、输出 DOM），单独渲染正好验的是「显示成什么」。
// ------------------------------------------------------------------
const { JSDOM } = await import('jsdom')
const React = (await import('react')).default
const ReactDOMClient = await import('react-dom/client')
const { act } = await import('react')
const esbuild = (await import('esbuild')).default
const bundle = readFileSync(PRODUCT, 'utf8')

// 词条从产物里读真货（与线上同一份文字），门禁不另造一份
const dict = {}
function localeOf(key, expectLang) {
  // 中英各一条：先出现的是中文（locale 源文件里中文半区在前），后出现的是英文
  const re = new RegExp("'" + key.replace(/\./g, '\\.') + "':\\s*'((?:[^'\\\\]|\\\\.)*)'", 'g')
  const hits = []
  let m
  while ((m = re.exec(bundle)) !== null) hits.push(m[1])
  check(hits.length >= 2, '词条 ' + key + ' 在产物里中英各一条（实得 ' + hits.length + ' 条）')
  dict[key] = hits[0] || key
  return dict[key]
}
const ZH = {
  readOnlyHint: localeOf('detail.readOnlyHint'),
  noBody: localeOf('detail.noBody'),
  bodyNotYet: localeOf('detail.bodyNotYet'),
  notYet: localeOf('detail.notYet'),
  noComments: localeOf('detail.noComments'),
  loading: localeOf('list.loading'),
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

/** 把产物里的两个函数包成一个模块：函数体照抄，它们依赖的名字由下面这段垫片按测试桩喂进去。 */
async function loadDetailModule() {
  const ridcSrc = extractFn(bundle, 'const renderIssueDetailComments = function')
    .replace('const renderIssueDetailComments = function', 'const __ridc = function')
  const detailFnSrc = extractFn(bundle, 'const IssueDetail = function (props)')
  const shim = [
    'const React = globalThis.__REACT__',
    'const h = React.createElement',
    'const tr = globalThis.__TR__',
    'const Ic = () => null',
    'const Tip = function (props) { return props && props.children ? props.children : null }',
    'const DswsCtx = React.createContext(null)',
    'const prStateKind = globalThis.__PRSTATEKIND__',
    'const buildColorOf = () => ({})',
    'const hexA = () => null',
    'const darken = () => null',
    'const isLightHex = () => false',
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
    'const fetchIssueComments = () => {}',
    'const submitIssueComment = async () => ({ ok: true })',
    'const probeNow = () => {}',
    'const findMapByIdentity = () => null',
    'const selectIssueComment = () => null',
    'const mdImgOverlay = () => null',
    'const mdToHtml = (x) => String(x == null ? "" : x)',
    '',
  ].join('\n')
  const dir = mkdtempSync(join(tmpdir(), 'dsws693-'))
  const code = shim + ridcSrc + '\nconst renderIssueDetailComments = __ridc\n' + detailFnSrc + '\nexport { IssueDetail }\n'
  const built = esbuild.transformSync(code, { loader: 'js', format: 'esm' }).code
  const file = join(dir, 'IssueDetail.mjs')
  writeFileSync(file, built, 'utf8')
  return import(pathToFileURL(file).href)
}

// jsdom + 真 React 的一套环境
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:59593/' })
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

const { prStateKind } = await import(pathToFileURL(resolve(ROOT, 'src/client/views/shared/stateKind.js')).href)
globalThis.__REACT__ = React
globalThis.__TR__ = trFn
globalThis.__PRSTATEKIND__ = prStateKind

const mod = await loadDetailModule()

/** 渲染一份 store，返回剥掉标签之后的可见文字与原始 HTML。 */
async function renderStore(st) {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  let root = null
  let html = ''
  try {
    await act(async () => {
      root = ReactDOMClient.createRoot(container)
      root.render(React.createElement(mod.IssueDetail, { st }))
      await new Promise((r) => setTimeout(r, 20))
    })
    html = container.innerHTML
  } finally {
    try { if (root) root.unmount() } catch (e) {}
    try { if (container.parentNode) container.parentNode.removeChild(container) } catch (e) {}
  }
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
  return { html, text }
}

/**
 * 快照里的一行「薄片段」：标题、状态、标签、指派人这些画行要用的字段都在，
 * 正文与评论不在 —— 阶段 2 把历史行换成薄片段之后，点开详情拿到的就是这样一行。
 */
const thinRow = {
  key: '693', number: 693, title: '修复：单票详情页的兜底不许说错话', state: 'open',
  labels: [], assignees: [], author: { login: 'a' },
  updatedAt: '2026-09-21T18:27:40Z', createdAt: '2026-09-21T18:27:40Z',
}
function storeOf(patch) {
  return Object.assign({
    snapshot: { issues: [thinRow], maps: [] },
    issueDetail: null,
    activeIssue: 693,
    issueMode: 'loading',
    issueError: null,
    cwd: 'D:\\ws',
    selection: null,
    backendModules: [],
    activeEffortId: '',
    navStack: [],
  }, patch || {})
}

// ---- 一、薄片段 + 详情还在路上：不许断言「没有」 ----
{
  const { html, text } = await renderStore(storeOf({ issueMode: 'loading' }))
  check(text.includes('修复：单票详情页的兜底不许说错话'), '薄片段·秒开保留：标题已经用快照那一行画出来（#58 的成果不动）')
  check(text.includes('描述'), '薄片段：描述那一段照常画出来（不是整页空白）')
  check(!text.includes(ZH.noBody), '薄片段：「无描述」没出现（正文只是还没拿到，不是没有）')
  check(!text.includes(ZH.readOnlyHint), '薄片段：「只读」没出现（没拿到评论不等于不能评论）')
  check(!text.includes('评论 (0)'), '薄片段：没报「评论 (0)」（评论只是还没拿到，不是没有）')
  check(text.includes(ZH.loading) || text.includes(ZH.bodyNotYet) || text.includes(ZH.notYet), '薄片段：正文那格说的是加载中或还没拿到（实得：「' + text.slice(0, 200) + '」）')
  check(!html.includes('<textarea'), '薄片段：详情没回来时不给输入框（没拿到评论，不知道能不能发）')
}

// ---- 二、详情取数失败：不许退回「无描述」，要给得出失败与重试 ----
{
  const { html, text } = await renderStore(storeOf({ issueMode: 'err', issueError: { kind: 'network', message: 'boom' } }))
  check(!text.includes(ZH.noBody), '取数失败：「无描述」没出现（取不到，不是没有）')
  check(!text.includes(ZH.readOnlyHint), '取数失败：「只读」没出现')
  check(!text.includes('评论 (0)'), '取数失败：没报「评论 (0)」')
  check(text.includes(ZH.bodyNotYet) || text.includes(ZH.notYet), '取数失败：正文那格说的是「还没拿到」')
  check(text.includes('network') && text.includes('boom'), '取数失败：把失败原因说出来（network: boom）')
  check(text.includes('重试'), '取数失败：给得出重试')
  check(text.includes('修复：单票详情页的兜底不许说错话'), '取数失败：上次拿到的标题仍在（不白屏）')
  check(!html.includes('<textarea'), '取数失败：不给输入框')
}

// ---- 三、详情回来了、正文与评论确实是空的：这时候「无描述」「无评论」才是真话 ----
{
  const emptyDetail = {
    key: '693', number: 693, title: '修复：单票详情页的兜底不许说错话', state: 'open',
    body: '', labels: [], assignees: [], author: { login: 'a' }, comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  }
  const { html, text } = await renderStore(storeOf({ issueDetail: emptyDetail, issueMode: 'real' }))
  check(text.includes(ZH.noBody), '详情回来了·正文为空：「无描述」这时候才出现（真的是空）')
  check(text.includes(ZH.noComments), '详情回来了·评论为空：「无评论」这时候才出现（真的是空）')
  check(text.includes('评论 (0)'), '详情回来了·评论为空：这时候才报「评论 (0)」')
  check(!text.includes(ZH.readOnlyHint), '详情回来了·评论为空：不说「只读」（这个后端给了评论能力，只是还没人评论）')
  check(html.includes('<textarea'), '详情回来了·评论为空：给输入框（能评论）')
}

// ---- 四、拉取请求：确实不能评论，「只读」这时候才该说 ----
{
  const prRow = Object.assign({}, thinRow, { isPullRequest: true })
  const st = storeOf({ issueMode: 'loading' })
  st.snapshot.issues = [prRow]
  const { html, text } = await renderStore(st)
  check(text.includes(ZH.readOnlyHint), '拉取请求：真不能评论，「只读」照说（这句话没被这次修改堵掉）')
  check(!html.includes('<textarea'), '拉取请求：不给输入框')
  check(!text.includes(ZH.noBody), '拉取请求：仍然不说「无描述」（正文只是还没拿到）')
}

// ---- 五、详情回来了、这个后端不带评论能力：「只读」也是真话 ----
{
  const noCommentCapability = {
    key: '693', number: 693, title: '修复：单票详情页的兜底不许说错话', state: 'open',
    body: '这张票的正文', labels: [], assignees: [], author: { login: 'a' },
    // 没有 comments 字段 —— 本地 Markdown 这类后端就是这样，它是「真不能评论」
  }
  const { html, text } = await renderStore(storeOf({ issueDetail: noCommentCapability, issueMode: 'real' }))
  check(text.includes(ZH.readOnlyHint), '后端不带评论能力：详情已经回来说清了，「只读」说得出')
  check(!html.includes('<textarea'), '后端不带评论能力：不给输入框')
  check(text.includes('这张票的正文'), '后端不带评论能力：正文照常画出来')
}

// ---- 六、正常路径没被带坏：详情回来了、正文与评论都有 ----
{
  const full = {
    key: '693', number: 693, title: '修复：单票详情页的兜底不许说错话', state: 'open',
    body: '这张票的正文', labels: [], assignees: [], author: { login: 'a' },
    comments: { nodes: [{ author: { login: 'b' }, body: '一条评论', createdAt: '2026-09-22T00:00:00Z' }], pageInfo: { hasNextPage: false, endCursor: null } },
  }
  const { html, text } = await renderStore(storeOf({ issueDetail: full, issueMode: 'real' }))
  check(text.includes('这张票的正文'), '正常路径：正文画出来')
  check(text.includes('@b') && text.includes('一条评论'), '正常路径：评论画出来')
  check(text.includes('评论 (1)'), '正常路径：评论条数照常报')
  check(html.includes('<textarea') && !text.includes(ZH.readOnlyHint), '正常路径：给输入框，不说「只读」')
  check(!text.includes(ZH.noBody) && !text.includes(ZH.noComments), '正常路径：兜底那两句都不出现')
}

if (failed) { console.log('\n[verify-693] FAIL（' + failed + ' 项）'); process.exit(1) }
console.log('\n[verify-693] GREEN 详情页兜底口径就绪')
