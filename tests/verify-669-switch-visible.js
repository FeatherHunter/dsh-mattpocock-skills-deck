#!/usr/bin/env node
/**
 * verify-669-switch-visible.js —— 「点确认切换之后，界面必须真的跟着走」门禁（#669 第 5 件）
 *
 * 起因（用户 2026-09-21 真机上报，附两张截图）：
 *   ① 面板里选 Markdown、点「确认切换」之后「没有任何反应」——弹窗关不关、界面动不动都说不清；
 *   ② 面板窄的时候那张弹窗的标题行崩了：「清除后端选择」竖着排了六行、确认按钮被推出卡片右边、✕ 看不见。
 *
 * 查明的根因（①）在面板那份快照那一路，两处一起坏：
 *   切换前已经飞着一次**强制重取**（wf.refresh）时，绑定成功之后那次重取被「同一个工作区」这条去重规则
 *   当成同一次请求复用掉了 —— 根本没发新请求，面板拿回的是**切换前**那份快照（连 selection 都还是旧后端），
 *   于是仓库标、引导链看着全没动，用户看到的就是「点了确认没反应」。
 *   改法：去重键从「工作区」变成「工作区 + 后端」（换过后端就不是同一次请求），并在回包处加一道
 *   「这一次还算不算数」的守卫（这个工作区上又发过更新的一次 / 这次问的后端已经不是用户现在选的那个 → 丢弃）。
 *
 * 断四组：
 *   A 静态层：弹窗标题就是维护者 2026-09-21 拍板的四个字（中英成对），标题行是可换行 + 按钮不许断行。
 *   B 真 Chromium：把产物里那张弹窗的真身（真 DOM + 真样式表）拿出来，在 604 与 380 两个宽度上量几何 ——
 *     每颗按钮都只有一行、卡片不横向溢出、✕ 在视口里；再把换行那两处做坏一次，同一条判据必须当场变红。
 *   C 行为层：把 probe-snapshot.js 真身取出来，喂一个可以按任意顺序回包的假宿主，走四种现场 ——
 *     切换前飞着重取、同一个后端上两次重取、非 force 在途撞 force、旧后端那份晚回来。
 *   D 反证：把去重键改回「只按工作区」、把守卫整段摘掉，C 里对应的那几条必须当场量不通过。
 *
 * 用法：node tests/verify-669-switch-visible.js
 */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const React = require('react')
const ReactDOMClient = require('react-dom/client')
const { act } = require('react')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
let passed = 0
let failed = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

const locWord = read('src/client/kernel/locale-word.js')
const prod = read('package/lib/client.js')

console.log('== A 静态层：标题四个字、标题行可换行、按钮不许断行 ==')
{
  check(locWord.indexOf("'switch.title': '切换后端'") >= 0, '中文标题就是维护者拍板的四个字（切换后端）')
  check(locWord.indexOf("'switch.title': 'Switch backend'") >= 0, '英文标题成对改成 Switch backend（中英必须成对）')
  check(!/'switch\.title':\s*'切换 Tracker 后端'/.test(locWord) && !/'switch\.title':\s*'Switch Tracker Backend'/.test(locWord), '词条里不再有切换那个长标题（只许出现在说明为什么改短的注释里）')
  check(prod.indexOf("'switch.title': '切换后端'") >= 0, '产物里也是这四个字（package/lib/client.js）')
  // 标题行：外层可换行（flexWrap），标题那一组可收缩（minWidth 0 + 省略号），按钮那一组不许断行（whiteSpace nowrap）
  const at = prod.indexOf("tr('switch.title')")
  check(at > 0, '产物里找得到那张弹窗的标题（tr switch.title）')
  const rowSlice = prod.slice(Math.max(0, at - 3000), at + 2500)
  check(/flexWrap:\s*'wrap'/.test(rowSlice), '标题那一行可以换行（flexWrap wrap）——窄面板下按钮整组挪到第二行，而不是被压成竖排')
  check(/minWidth:\s*0[^}]*overflow:\s*'hidden'[^}]*textOverflow:\s*'ellipsis'/.test(rowSlice) || /overflow:\s*'hidden'[^}]*textOverflow:\s*'ellipsis'[^}]*whiteSpace:\s*'nowrap'/.test(rowSlice), '标题自己可收缩（minWidth 0 + 省略号）')
  const nowrapCount = (rowSlice.match(/whiteSpace:\s*'nowrap'/g) || []).length
  check(nowrapCount >= 3, '标题行里三颗按钮都写了「不许断行」（实得 ' + nowrapCount + ' 处，应为 3：取消 / 确认切换 / ✕ —— 「清除后端选择」那颗 2026-09-21 已删）')
  check(/overflowX:\s*'hidden'/.test(rowSlice), '卡片自己也挡住横向溢出（overflowX hidden）')
}

// ── C 组与 B 组共用：把产物里那张弹窗真身挂起来，取它的 DOM 与样式表 ─────────────────────────
const WS = 'D:\\tmp\\669-visible'
const MODULES = [
  { id: 'github', label: 'GitHub', presentation: { color: '#58a6ff' } },
  { id: 'markdown', label: 'Markdown', presentation: { color: '#1a7f37' } },
  { id: 'gitlab', label: 'GitLab', presentation: { color: '#fc6d26' } },
]
const SNAP = (bid) => ({ ok: true, selection: { backendId: bid, source: 'explicit' }, repository: { backend: bid, refId: bid === 'markdown' ? 'local-folder' : 'X/Y', name: bid === 'markdown' ? 'local-folder' : 'X/Y', url: '' }, maps: [], checks: null, tickets: [], groups: {}, isLocal: false, version: 'v669', workspaceRoot: WS, backendModules: MODULES })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const mountModal = async function () {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="pane"></div></body></html>', { url: 'http://127.0.0.1:59519/', runScripts: 'dangerously' })
  const { window } = dom
  const saved = { window: global.window, document: global.document, navigator: global.navigator, Node: global.Node, HTMLElement: global.HTMLElement, getComputedStyle: global.getComputedStyle, requestAnimationFrame: global.requestAnimationFrame, cancelAnimationFrame: global.cancelAnimationFrame, ResizeObserver: global.ResizeObserver }
  global.window = window
  global.document = window.document
  try { global.navigator = window.navigator } catch (e) {}
  global.Node = window.Node
  global.HTMLElement = window.HTMLElement
  global.getComputedStyle = window.getComputedStyle
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  global.cancelAnimationFrame = clearTimeout
  window.requestAnimationFrame = global.requestAnimationFrame
  if (typeof window.ResizeObserver === 'undefined') window.ResizeObserver = class { observe () {} unobserve () {} disconnect () {} }
  global.ResizeObserver = window.ResizeObserver
  if (!window.document.fonts) window.document.fonts = { ready: Promise.resolve() }
  const dict = {}
  const trFn = (key, params) => { let s = dict[key] !== undefined ? dict[key] : key; if (params) s = s.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m)); return s }
  const registrations = []
  const services = {
    slots: { register: (meta, comp) => { registrations.push({ meta, comp }); return () => {} }, inject: (name, fn) => { try { fn() } catch (e) {} } },
    sidebarRightTabs: { register: () => () => {} },
    connection: { rpc: { call: async (channel, endpoint, req) => {
      const method = (req && req.method) || ''
      if (method === 'snapshot' || method === 'refresh') return { ok: true, value: SNAP('github') }
      if (method === 'chain') return { ok: true, value: { ok: true, backendId: 'github', fullSnapshot: { steps: [{ id: 'gh:remote', status: 'done' }] } } }
      if (method === 'registry') return { ok: true, value: { ok: true, modules: MODULES } }
      return { ok: true, value: { ok: true } }
    } } },
    locale: { register: (ns, d) => { Object.assign(dict, d.zh || {}, d.en || {}); return () => {} }, bind: () => trFn },
    workspaces: { list: async () => [] },
    sessions: { list: async () => [] },
    timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
    layout: { closeDetails: () => {} },
  }
  const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (deps, cb) => { cb(ctx); return { dispose: () => {} } } }
  let loaded = null
  window.__ModuleLoader__ = { load (spec) { loaded = spec; return spec } }
  window.eval(prod)
  const mod = loaded.factory((m) => { if (m === 'react') return React; if (m === 'react-dom') return ReactDOMClient; throw new Error('产物要了一份没准备的模块：' + m) })
  mod.apply(ctx)
  const reg = registrations.filter((r) => r.meta && r.meta.name === 'sidebar.right.pane.tab')[0]
  const container = window.document.getElementById('pane')
  const root = ReactDOMClient.createRoot(container)
  const step = async (ms) => { await act(async () => { await sleep(ms || 30) }) }
  await act(async () => { root.render(React.createElement(reg.comp, { sessionId: 'sid-669v', session: { id: 'sid-669v', cwd: WS }, useSessions: () => undefined, inputActions: { setDraft: () => {} } })); await sleep(30) })
  for (let i = 0; i < 60 && !container.querySelector('[data-repo-switch]'); i++) await step(50)
  await act(async () => { container.querySelector('[data-repo-switch]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(40) })
  await step(150)
  await act(async () => { container.querySelector('[data-target-id="markdown"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(40) })
  await step(150)
  // 弹窗最外层（覆盖层）与卡片：含内联样式的真身
  const overlay = container.querySelector('[data-target-id]').closest('div[style*="position: absolute"]')
  const card = overlay && overlay.firstElementChild
  const css = Array.prototype.slice.call(window.document.querySelectorAll('style')).map((s) => s.textContent || '').join('\n')
  const out = { overlayHTML: overlay ? overlay.outerHTML : '', cardHTML: card ? card.outerHTML : '', css: css }
  // 这一份 jsdom 窗口不拆：拆（unmount + window.close）之后 React 的调度器还会在微任务里跑一步，
  //   进程会以一句「performWorkUntilDeadline」的栈崩掉（实测）。这一门跑完就 process.exit，留着更稳。
  return out
}

const main = async function () {
global.IS_REACT_ACT_ENVIRONMENT = true
console.log('')
console.log('== B 真 Chromium：窄面板下那张弹窗的几何 ==')
const mounted = await mountModal()
check(mounted.overlayHTML.length > 500 && mounted.cardHTML.length > 500, '取到了弹窗真身（覆盖层 ' + mounted.overlayHTML.length + ' 字 / 卡片 ' + mounted.cardHTML.length + ' 字）')
check(mounted.css.indexOf('.dsws-btn') >= 0, '取到了产物自己的样式表（含 .dsws-btn）')
{
  const browser = await chromium.launch({ headless: true })
  const measure = async function (width, html, css) {
    const p = await browser.newPage({ viewport: { width: width + 40, height: 900 } })
    await p.setContent('<!doctype html><html><head><meta charset=utf-8><style>html,body{margin:0;background:#0a0a0a}body{padding:20px}#stage{position:relative;width:' + width + 'px;height:820px}' + css + '</style></head><body><div id="stage"></div></body></html>')
    await p.evaluate((h) => { document.getElementById('stage').innerHTML = h }, html)
    const m = await p.evaluate(() => {
      const stage = document.getElementById('stage')
      const card = stage.firstElementChild && stage.firstElementChild.firstElementChild
      const btns = Array.prototype.slice.call(stage.querySelectorAll('button'))
      const rectOf = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), left: Math.round(r.left) } }
      return {
        card: card ? { scrollW: card.scrollWidth, clientW: card.clientWidth, right: Math.round(card.getBoundingClientRect().right) } : null,
        btns: btns.map((b) => Object.assign({ t: (b.textContent || '').trim().slice(0, 10) }, rectOf(b))),
        viewport: window.innerWidth,
      }
    })
    await p.close()
    return m
  }
  // 判据：每颗按钮都只有一行（高 ≤ 40）、卡片不横向溢出（scrollWidth ≤ clientWidth + 1）、
  //   每颗按钮都待在卡片里（不越过卡片右边 —— 用户看到的就是确认按钮被推出卡片右边、✕ 不见了），
  //   而且最右那颗的右边不越过视口。
  const verdict = function (m) {
    const tall = m.btns.filter((b) => b.h > 40)
    const over = m.btns.filter((b) => m.card && b.right > m.card.right + 1)
    const past = m.btns.filter((b) => b.right > m.viewport + 1)
    return { ok: m.card && m.card.scrollW <= m.card.clientW + 1 && tall.length === 0 && over.length === 0 && past.length === 0, tall, over, past, card: m.card, btns: m.btns }
  }
  for (const w of [604, 380]) {
    const m = await measure(w, mounted.overlayHTML, mounted.css)
    const v = verdict(m)
    console.log('  宽度 ' + w + '：卡片 ' + JSON.stringify(m.card) + '；按钮 ' + JSON.stringify(m.btns.map((b) => b.t + ':' + b.w + 'x' + b.h)))
    check(v.ok, '宽度 ' + w + ' 下：每颗按钮都只有一行（竖排的高 >40 的有 ' + v.tall.length + ' 颗）、卡片不横向溢出、按钮都待在卡片里（越界 ' + v.over.length + ' 颗）')
  }
  // 反证：这一条量的是**尺子还灵不灵**，要复现的是用户截图里那一版（长标签按钮 + 没有那几处换行保护）：
  //   ① 把当初「清除后端选择」那颗六字长按钮放回去；② 把 title 行的 white-space:nowrap / flex-wrap:wrap /
  //   flex:none 三处保护撤掉。2026-09-21 对抗式审查指出：只做 ② 已经压不垮这一行（长按钮删了，剩下的字都短），
  //   反证红不起来等于这一门失去了反证 —— 所以把 ① 一起做进去。
  const broken = mounted.overlayHTML.replace(/(<button\b[^>]*>)([^<]*)(<\/button>)/g, function (m, open, text, close) {
    return /Confirm|确认/.test(text) ? open + '清除后端选择（长标签压测）' + close : m
  })
    .replace(/white-space:\s*nowrap/gi, 'white-space: normal')
    .replace(/flex-wrap:\s*wrap/gi, 'flex-wrap: nowrap')
    .replace(/flex:\s*none/gi, 'flex: 0 1 auto')
  check(broken !== mounted.overlayHTML, '反证 B：能把一颗按钮换回当初那颗长标签（说明这一门量的就是那一行）')
  const mb = await measure(380, broken, mounted.css)
  const vb = verdict(mb)
  check(!vb.ok, '反证 B 成立：放进长标签之后 380 宽度当场量不通过（竖排按钮 ' + vb.tall.length + ' 颗、越出卡片 ' + vb.over.length + ' 颗、卡片 ' + JSON.stringify(vb.card) + '）')
  await browser.close()
}

console.log('')
console.log('== C 行为层：快照那条路上「切换之后重取必须真发一次、旧的那份不许装」 ==')
// 守卫与去重键 2026-09-21 从 probe-snapshot.js 拆到 probe-stale.js（那个文件超了 350 行上限）：
//   两个文件在产物里是同一个闭包，所以这里一起求值，量法不变。
const staleSrc = read('src/client/kernel/probe-stale.js').replace(/^[ \t]*export[ \t]+/gm, '')
const snapSrc = staleSrc + '\n' + read('src/client/kernel/probe-snapshot.js').replace(/^[ \t]*export[ \t]+/gm, '')
const staleGuardSrc = read('src/client/kernel/probe-stale.js')
const deferredOf = () => { let res; const p = new Promise((r) => { res = r }); return { p, res } }
const tick = () => new Promise((r) => setTimeout(r, 0))

// 假宿主 + 假 store：按任意顺序回包，量「发了哪几次请求」与「最后装进去的是哪一份」。
const makeSnap = function (srcText) {
  const calls = []
  const scope = {
    host: { call: (method, params) => { const d = deferredOf(); calls.push({ method, params, d }); return d.p } },
    wsKeyOf: (p) => String(p || '').replace(/\\/g, '/').toLowerCase(),
    tr: (k) => String(k),
    log: () => {},
    isEnabled: () => false,
    dswsLogHash: (s) => 'h' + String(s || '').length,
    dswsLogTrunc: (s) => String(s || '').slice(0, 120),
    emit: () => {},
    hydrateFromCache: () => false,
    getCachedSnapshot: () => null,
    setCachedSnapshot: () => {},
    diskGetSnapshot: async () => null,
    getProbeAt: () => 0,
    touchProbeAt: () => {},
    lastProbeAtByCwd: new Map(),
    rememberWorkspaceRoot: () => {},
    // 只用来「看见」装进去的是哪一份：selection/repository 的镜像规则见 store-snapshot.js 的 applySnapshotSelection
    applySnapshotSelection: (st, snap) => { if (snap.selection !== undefined) st.selection = snap.selection; if (snap.repository !== undefined) st.repository = snap.repository },
    startAutoProbe: () => {},
    scheduleFlashClear: () => {},
    flash: () => {},
    diffSnapshots: () => ({ added: [], changed: [], removed: [] }),
    getSnapshotVersion: () => '',
    getCwdSync: () => null,
    setPresentationMap: () => {},
    nowStr: () => '00:00:00',
    lcApplySavedColorsOnInstall: () => {},
    promptLang: () => 'zh',
    // #669 第 6 件（ADR 20260921）：hint 只报「用户亲手选过的那条」——这条闸的真身在 store-prefs.js，
    //   这里取真身来判，所以 fixture 里的选择必须带 userPicked 才会上报后端（不带时请求上就没有 backendId）。
    userHintOf: new Function('return ' + (read('src/client/kernel/store-prefs.js').split('\n').filter((l) => l.indexOf('export const userHintOf = function') >= 0)[0] || '').trim().replace(/^export const userHintOf = /, ''))(),
    timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
    setTimeout, clearTimeout, AbortController,
    console: { log () {}, warn () {}, error () {} },
  }
  const body = 'with (scope) {\n' + srcText + '\n; return { loadSnapshot: loadSnapshot, pendingSnapshotByCwd: pendingSnapshotByCwd }\n}'
  const mod = new Function('scope', body)(scope)
  return { loadSnapshot: mod.loadSnapshot, calls }
}
const snapOf = (bid, tag) => ({ ok: true, bid, tag, maps: [], selection: { backendId: bid, source: 'explicit' }, repository: { backend: bid, name: bid } })

const runScenarios = async function (srcText) {
  const out = {}
  // 现场 1：切换前飞着一次强制重取（用户在面板上点了刷新），绑定成功之后再强制重取一次。
  {
    const s = makeSnap(srcText)
    const st = { cwd: 'D:\\w1', selection: { backendId: 'github' }, snapshot: { bid: 'github-旧' } }
    s.loadSnapshot(st, true, true)
    st.selection = { backendId: 'markdown', userPicked: true } // 绑定成功：用户亲手切到新后端（带标记 → 这一次请求会把它当 hint 上报）
    s.loadSnapshot(st, true, true)
    await tick()
    out.debug = s.calls.map((c) => c.method + '|' + ((c.params && c.params.backendId) || '-'))
    out.switchSentTwo = s.calls.length
    if (!s.calls[1]) return out
    out.secondCarriesNewBackend = !!(s.calls[1] && s.calls[1].params && s.calls[1].params.backendId === 'markdown')
    // 新的那份先回，旧的那份（切换前）后回
    s.calls[1].d.res(snapOf('markdown', '切换后那一份'))
    await tick()
    s.calls[0].d.res(snapOf('github', '切换前那一份'))
    await tick()
    out.afterSwitch = st.snapshot && st.snapshot.tag
    out.selectionAfterSwitch = st.selection && st.selection.backendId
  }
  // 现场 2（回归）：同一个后端上两次强制重取 —— 第二次仍复用第一次（#366 那层去重不能被弄丢）
  {
    const s = makeSnap(srcText)
    const st = { cwd: 'D:\\w2', selection: { backendId: 'github' }, snapshot: null }
    s.loadSnapshot(st, true, true)
    await tick() // 等第一次登记在途（登记发生在几处 await 之后，这是这一门的量法要照顾的）
    s.loadSnapshot(st, true, true)
    await tick()
    out.sameBackendReuse = s.calls.length
  }
  // 现场 3（回归 #366）：非 force 的在途请求，撞上一次强制重取 —— 强制重取必须真发一次
  {
    const s = makeSnap(srcText)
    const st = { cwd: 'D:\\w3', selection: { backendId: 'github' }, snapshot: null }
    s.loadSnapshot(st, false, false)
    s.loadSnapshot(st, true, true)
    await tick()
    out.forceNotReused = s.calls.length
    out.forceMethod = s.calls[1] && s.calls[1].method
  }
  // 现场 4：一个会话中途换后端，旧后端那份晚回来 —— 不许把会话状态倒回旧后端
  {
    const s = makeSnap(srcText)
    const st = { cwd: 'D:\\w4', selection: { backendId: 'github' }, snapshot: null }
    s.loadSnapshot(st, true, true)
    await tick()
    st.selection = { backendId: 'markdown', userPicked: true }
    s.calls[0].d.res(snapOf('github', '切换前那一份'))
    await tick()
    out.staleDropped = !st.snapshot || st.snapshot.tag !== '切换前那一份'
  }
  return out
}
const real = await runScenarios(snapSrc)
console.log('  [现场 1 发出去的请求] ' + JSON.stringify(real.debug))
check(real.switchSentTwo === 2, '现场 1：切换前那次在途不吞掉切换后那次 —— 两个后端各自真发了一次请求（实得 ' + real.switchSentTwo + ' 次）')
check(real.secondCarriesNewBackend, '现场 1：第二次请求带的是切换后的后端（实得 ' + JSON.stringify(real.debug && real.debug[1]) + '）')
check(real.afterSwitch === '切换后那一份', '现场 1：切换后装进去的是新后端那一份（实得「' + real.afterSwitch + '」）')
check(real.selectionAfterSwitch === 'markdown', '现场 1：切换前那份晚回来之后，会话里的后端仍是切换后的那一个（实得「' + real.selectionAfterSwitch + '」）')
check(real.sameBackendReuse === 1, '现场 2（回归）：同一个后端上第二次强制重取照旧复用第一次、只发一次（实得 ' + real.sameBackendReuse + ' 次）')
check(real.forceNotReused === 2 && real.forceMethod === 'wf.refresh', '现场 3（回归 #366）：非 force 在途撞上强制重取时，强制那次照旧真发（实得 ' + real.forceNotReused + ' 次，第二次是 ' + real.forceMethod + '）')
check(real.staleDropped === true, '现场 4：旧后端那份晚回来一个字都没装（' + (real.staleDropped ? '已丢弃' : '被装了') + '）')

console.log('')
console.log('== D 反证：把这两处做坏，C 里对应的那几条必须当场量不通过 ==')
{
  const variants = [
    { label: '去重键改回「只按工作区」（不带后端）', patches: [["return wsKeyOf(cwd || '') + '|' + String(backendId || '')", "return wsKeyOf(cwd || '') + '|'"]], must: ['现场 1 发两次', '现场 1 装新的', '现场 1 后端保持'] },
    { label: '回包守卫整段摘掉', patches: [['if (_snapRespStale(_reqNorm, _mine.seq, _mine.reqBackend, st)) {', 'if (false) {']], must: ['现场 1 后端保持', '现场 4 旧的不装'] },
  ]
  const worse = (key, got) => {
    if (key === '现场 1 发两次') return got.switchSentTwo !== 2
    if (key === '现场 1 装新的') return got.afterSwitch !== '切换后那一份'
    if (key === '现场 1 后端保持') return got.selectionAfterSwitch !== 'markdown'
    if (key === '现场 4 旧的不装') return got.staleDropped !== true
    return false
  }
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]
    let broken = snapSrc
    let ok = true
    for (const pair of v.patches) {
      const at = broken.indexOf(pair[0]) >= 0 ? broken : (staleGuardSrc.indexOf(pair[0]) >= 0 ? staleGuardSrc : null)
      if (!at) { ok = false; break }
      if (at === broken) broken = broken.replace(pair[0], pair[1])
      else broken = snapSrc.replace(staleGuardSrc, staleGuardSrc.replace(pair[0], pair[1]))
    }
    if (!ok) { check(false, '反证 ' + (i + 1) + '（' + v.label + '）：没能在真源里找到要改的那一段，这道反证本身坏了'); continue }
    const got = await runScenarios(broken)
    const notRed = v.must.filter((k) => !worse(k, got))
    check(notRed.length === 0, '反证 ' + (i + 1) + '（' + v.label + '）：该红的都红了（' + (notRed.length ? '这几条没红：' + notRed.join(' / ') : v.must.join('、')) + '）')
  }
}

console.log('')
console.log(failed ? 'FAIL ' + passed + ' 项通过 / ' + failed + ' 项未过' : 'PASS 全部 ' + passed + ' 项检查通过')
process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('崩了：' + ((e && e.stack) || e)); process.exit(1) })
