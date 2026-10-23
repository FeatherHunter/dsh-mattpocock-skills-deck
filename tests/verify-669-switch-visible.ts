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
 * 断三组：
 *   B 真 Chromium：把产物里那张弹窗的真身（真 DOM + 真样式表）拿出来，在 604 与 380 两个宽度上量几何 ——
 *     每颗按钮都只有一行、卡片不横向溢出、✕ 在视口里；再把换行那两处做坏一次，同一条判据必须当场变红。
 *   C 行为层：把 probe-snapshot.js 真身取出来，喂一个可以按任意顺序回包的假宿主，走四种现场 ——
 *     切换前飞着重取、同一个后端上两次重取、非 force 在途撞 force、旧后端那份晚回来。
 *   D 反证：把去重键改回「只按工作区」、把守卫整段摘掉，C 里对应的那几条必须当场量不通过。
 *
 * 依赖：playwright（含 chromium）—— 浏览器实例经 tests/lib/browser-pool.js 取：没设 DSH_TEST_BROWSER_WS 时自己起一个，设了就共用 scripts/browser-host.mts 起的那一只。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-669-switch-visible.ts
 */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const React = require('react')
const ReactDOMClient = require('react-dom/client')
const { act } = require('react')
const { getBrowser, closeBrowser } = require('./lib/browser-pool.js')
// 本文件三处手法不同：窗口里跑产物走 evalInWindow，取真源里一行函数表达式走 evalWithScope，拼闭包造模块走 compileFn。
const { compileFn, evalWithScope, evalInWindow } = require('./lib/eval-probe.js')
// #1251：userHintOf 取出来要当场求值 —— 走 spliceableJs（与构建同一口径，先转译去类型）。
const { spliceableJs } = require('./lib/source-text.ts')
// 中央时间真值：快照等待只住 config/*.yaml，这里读同一份导出来预埋，不在测试里写第二份数字。
const centralTime = require('../src/shared/time-config/values.js')
;(globalThis as unknown as Record<string, unknown>).SNAP_WAIT_MS = centralTime.SNAP_WAIT_MS
// jsdom 挂载要往 Node 全局上写浏览器对象，测试里按任意值处理；运行时与原来一样。
declare const global: any
// 中央 import 在 compileFn 函数体里非法，求值前整行剥掉（闭包里它由时间片段提供，门禁里走上面的全局预埋）。
const stripTimeConfigImport = (s: string): string => s.split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
let passed = 0
let failed = 0
const check = (ok: unknown, msg: string): void => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

const prod = read('package/lib/client.js')

console.log('== B 真 Chromium：窄面板下那张弹窗的几何 ==')
// ── B 组：把产物里那张弹窗真身挂起来，取它的 DOM 与样式表 ───────────────────────────────────
// 2026-10-12 修：这一门原先写死「挂 sidebar.right.pane.tab 那一份、给它的 props 里塞 session.cwd」，
//   于是红了很久（红在「等 [data-repo-switch] 等空之后拿 null 去 dispatchEvent」）。
//   查下来根因与「按钮搬去了别的槽位」无关，而是**喂给面板的会话目录没送到**：
//   产物里 pane.tab 这一格注册的是 router.js 的 DeckSidebarTab，它按注册时的 inject 约定只收 sessionId，
//   转手交给 DetailsDock 的 props 里**没有 session**（那颗按钮就长在 DetailsDock 的头部，panel/Dock.js）。
//   真实宿主给这一格的就只有 sessionId，工作区目录是面板自己打电话（wf.cwd）问回来的 ——
//   旧桩把 wf.cwd 也答成一句空话 `{ok:true}`，于是会话永远没有 cwd → 不发快照 → 没有 selection →
//   那颗按钮按源码的判据（Dock.js: `_bid==null` 直接不渲染）本来就不该出现。桩补齐 wf.cwd 之后一切照旧。
//   同时这一门不再预设按钮属于哪个槽位：先把产物注册的槽位名单打出来，再逐个试挂，
//   挑**真的把 [data-repo-switch] 画出来**的那一份来量（按钮将来真搬了家，这里自动跟上）。
const WS = 'D:\\tmp\\669-visible'
const MODULES = [
  { id: 'github', label: 'GitHub', presentation: { color: '#58a6ff' } },
  { id: 'markdown', label: 'Markdown', presentation: { color: '#1a7f37' } },
  { id: 'gitlab', label: 'GitLab', presentation: { color: '#fc6d26' } },
]
const SNAP = (bid: string) => ({ ok: true, selection: { backendId: bid, source: 'explicit' }, repository: { backend: bid, refId: bid === 'markdown' ? 'local-folder' : 'X/Y', name: bid === 'markdown' ? 'local-folder' : 'X/Y', url: '' }, maps: [], checks: null, tickets: [], groups: {}, isLocal: false, version: 'v669', workspaceRoot: WS, backendModules: MODULES })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const mountModal = async function () {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="pane"></div></body></html>', { url: 'http://127.0.0.1:59519/', runScripts: 'dangerously' })
  const { window } = dom
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
  const dict: Record<string, string> = {}
  const trFn = (key: string, params: any) => { let s = dict[key] !== undefined ? dict[key] : key; if (params) s = s.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m)); return s }
  const registrations: any[] = []
  const services: Record<string, any> = {
    slots: { register: (meta, comp) => { registrations.push({ meta, comp }); return () => {} }, inject: (name, fn) => { try { fn() } catch (e) {} } },
    sidebarRightTabs: { register: () => () => {} },
    connection: { rpc: { call: async (channel, endpoint, req) => {
      const method = (req && req.method) || ''
      // 面板的工作区目录走的就是这条电话（panel/DockSync.js 里 host.call('wf.cwd', {sessionId})）：
      //   槽位注册时宿主只交进来一个 sessionId，目录得面板自己问。这里如实答上，缺了它整条取数链不启动。
      if (method === 'cwd') return { ok: true, value: { ok: true, cwd: WS, workspaceRoot: WS } }
      if (method === 'snapshot' || method === 'refresh') return { ok: true, value: SNAP('github') }
      if (method === 'chain') return { ok: true, value: { ok: true, backendId: 'github', fullSnapshot: { steps: [{ id: 'gh:remote', status: 'done' }] } } }
      if (method === 'registry') return { ok: true, value: { ok: true, modules: MODULES } }
      return { ok: true, value: { ok: true } }
    } } },
    // #1294：语言服务换新契约——词表按语言逐张注册 register('dsws', id, table)，
    //   旧 mock 把第二参当整表取 d.zh，收到的是语言 id 字符串，dict 就空了、界面渲染成键名，
    //   换行按钮量出来的几何就不是改造前那一版。这里三参形态逐门并进 dict（与旧行为一致：
    //   zh 先并、en 后并覆盖），两参旧形态保留兜底。getSnapshot/addLanguage 按新契约给出。
    locale: {
      register: (ns: string, a: any, b: any) => {
        if (b !== undefined) Object.assign(dict, b || {})
        else if (a && typeof a === 'object') Object.assign(dict, a.zh || {}, a.en || {})
        return () => {}
      },
      bind: () => trFn,
      getSnapshot: () => ({
        active: 'zh',
        locales: [
          { id: 'zh', label: '中文', fallback: 'en' },
          { id: 'en', label: 'English' },
        ],
        revision: 1,
      }),
      addLanguage: () => () => {},
    },
    workspaces: { list: async () => [] },
    sessions: { list: async () => [] },
    timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
    layout: { closeDetails: () => {} },
  }
  const ctx: any = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (deps, cb) => { cb(ctx); return { dispose: () => {} } } }
  let loaded: any = null
  window.__ModuleLoader__ = { load (spec) { loaded = spec; return spec } }
  // 本处走 evalInWindow：这张 jsdom 窗口开了 runScripts，与原来在窗口上求值等价。
  evalInWindow(dom, prod)
  const mod = loaded.factory((m) => { if (m === 'react') return React; if (m === 'react-dom') return ReactDOMClient; throw new Error('产物要了一份没准备的模块：' + m) })
  mod.apply(ctx)
  // 先把产物注册了哪些槽位打出来：按钮搬家（换槽位、换组件）时这一行就是下一次改这一门的入口。
  console.log('  产物注册的槽位：' + registrations.map((r) => (r.meta && r.meta.name) || '(无名)').join(' / '))
  const step = async (ms?: number) => { await act(async () => { await sleep(ms || 30) }) }
  // 逐个试挂，挑真的把 [data-repo-switch] 画出来的那一份。props 按产物注册时声明的 inject 约定给：
  //   pane.tab 那一份声明的是 inject(sessionId)，真实宿主交进来的就只有这一个值，所以这里也只给这一个。
  //   试挂没命中的那几份留在原地不再拆（拆 React 根会引出调度器在微任务里崩那一步，见文件末尾那段说明），
  //   它们各自的根节点互不相干，量的时候只认命中那一份的容器。
  let reg: any = null
  let container: any = null
  for (let i = 0; i < registrations.length && !reg; i++) {
    const cand = registrations[i]
    const name = (cand.meta && cand.meta.name) || '(无名)'
    const box = window.document.createElement('div')
    window.document.body.appendChild(box)
    try {
      const root = ReactDOMClient.createRoot(box)
      await act(async () => { root.render(React.createElement(cand.comp, { sessionId: 'sid-669v' })); await sleep(30) })
      for (let k = 0; k < 60 && !box.querySelector('[data-repo-switch]'); k++) await step(50)
    } catch (e) {
      console.log('  试挂 ' + name + ' 抛错（与这一门无关，跳过）：' + String((e && e.message) || e).slice(0, 120))
      continue
    }
    if (box.querySelector('[data-repo-switch]')) {
      reg = cand
      container = box
      console.log('  挂的是 ' + name + ' 这一份：它真的把 [data-repo-switch] 画出来了')
    } else {
      console.log('  试挂 ' + name + '：这一份里没有那颗按钮')
    }
  }
  if (!reg) {
    // 一条命都挂不上的时候不许闷声崩（旧写法就是在这里拿 null 去 dispatchEvent）：
    //   如实报「产物注册的这几份里没有一份画出那颗按钮」，这一条由调用处判红。
    return { overlayHTML: '', cardHTML: '', css: '', mountedFrom: null, registeredSlots: registrations.map((r) => (r.meta && r.meta.name) || '(无名)') }
  }
  await act(async () => { container.querySelector('[data-repo-switch]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(40) })
  await step(150)
  // 弹窗里那几个后端按钮：走到这里要是没出来，同样不许拿 null 去 dispatch（旧写法崩的就是这一手），
  //   如实回一份空的，由调用处那几条判红。
  const targetBtn = container.querySelector('[data-target-id="markdown"]')
  if (!targetBtn) return { overlayHTML: '', cardHTML: '', css: '', mountedFrom: (reg.meta && reg.meta.name) || null, registeredSlots: registrations.map((r) => (r.meta && r.meta.name) || '(无名)') }
  await act(async () => { targetBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(40) })
  await step(150)
  // 弹窗最外层（覆盖层）与卡片：含内联样式的真身
  const anyTarget = container.querySelector('[data-target-id]')
  const overlay = anyTarget && anyTarget.closest('div[style*="position: absolute"]')
  const card = overlay && overlay.firstElementChild
  const css = Array.prototype.slice.call(window.document.querySelectorAll('style')).map((s) => s.textContent || '').join('\n')
  const out = { overlayHTML: overlay ? overlay.outerHTML : '', cardHTML: card ? card.outerHTML : '', css: css, mountedFrom: (reg.meta && reg.meta.name) || null, registeredSlots: registrations.map((r) => (r.meta && r.meta.name) || '(无名)') }
  // 这一份 jsdom 窗口不拆：拆（unmount + window.close）之后 React 的调度器还会在微任务里跑一步，
  //   进程会以一句「performWorkUntilDeadline」的栈崩掉（实测）。这一门跑完就 process.exit，留着更稳。
  return out
}

const main = async function () {
global.IS_REACT_ACT_ENVIRONMENT = true
console.log('')
console.log('== B 真 Chromium：窄面板下那张弹窗的几何 ==')
const mounted = await mountModal()
// 先自报「按钮是从哪一份组件里长出来的」：这一条红了说明产物注册的槽位里没有一份画出那颗按钮，
//   后面几条量的就是空页面（它们会跟着红，不用另判）。
check(!!mounted.mountedFrom, 'B 挂上了真的画出 [data-repo-switch] 的那一份组件（挂的是「' + (mounted.mountedFrom || '没有一份画出那颗按钮') + '」；产物注册的槽位：' + (mounted.registeredSlots || []).join(' / ') + '）')
check(mounted.overlayHTML.length > 500 && mounted.cardHTML.length > 500, '取到了弹窗真身（覆盖层 ' + mounted.overlayHTML.length + ' 字 / 卡片 ' + mounted.cardHTML.length + ' 字）')
check(mounted.css.indexOf('.dsws-btn') >= 0, '取到了产物自己的样式表（含 .dsws-btn）')
{
  const browser = await getBrowser({ headless: true })
  const measure = async function (width: number, html: string, css: string) {
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
  const verdict = function (m: any) {
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
  await closeBrowser()
}

console.log('')
console.log('== C 行为层：快照那条路上「切换之后重取必须真发一次、旧的那份不许装」 ==')
// 守卫与去重键 2026-09-21 从 probe-snapshot.js 拆到 probe-stale.js（那个文件超了 350 行上限）：
//   两个文件在产物里是同一个闭包，所以这里一起求值，量法不变。
const staleSrc = spliceableJs('src/refresh/rooms/client/staleness-indicator.js')
// #1009：装快照那一整段搬去了 probe-select.js（正常那一路与迟到那一路共用同一处），所以这一门的闭包
//   也得把那一页带上 —— 不带的话「装进去的是哪一份」这条根本没有落地口，量出来全是 undefined。
// 这三份真源都已经是 .ts，要拼成同一个函数体求值，所以一律走 spliceableJs（与构建同一口径，
//   类型标注已剥掉、行首 export 已去掉；末端 stripTimeConfigImport 只是防御，那份中央 import 它已先删掉）。
const snapSrc = staleSrc + '\n' + stripTimeConfigImport(spliceableJs('src/refresh/rooms/client/snapshot-sync.js'))
  + '\n' + spliceableJs('src/refresh/rooms/client/probe-scope-selection.js')
const staleGuardSrc = spliceableJs('src/refresh/rooms/client/staleness-indicator.js')
const deferredOf = () => { let res: (value: any) => void = () => {}; const p = new Promise<any>((r) => { res = r }); return { p: p, res: res } }
const tick = () => new Promise((r) => setTimeout(r, 0))

// 假宿主 + 假 store：按任意顺序回包，量「发了哪几次请求」与「最后装进去的是哪一份」。
const makeSnap = function (srcText: string) {
  const calls: any[] = []
  const scope: Record<string, any> = {
    host: { call: (method: string, params: any) => { const d = deferredOf(); calls.push({ method, params, d }); return d.p } },
    wsKeyOf: (p: unknown) => String(p || '').replace(/\\/g, '/').toLowerCase(),
    tr: (k: unknown) => String(k),
    log: () => {},
    isEnabled: () => false,
    dswsLogHash: (s: unknown) => 'h' + String(s || '').length,
    dswsLogTrunc: (s: unknown) => String(s || '').slice(0, 120),
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
    applySnapshotSelection: (st: any, snap: any) => { if (snap.selection !== undefined) st.selection = snap.selection; if (snap.repository !== undefined) st.repository = snap.repository },
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
    // 本处走 evalWithScope：只是把真源里那段函数表达式求值出来，它不引用本文件的任何外层变量，scope 给空对象。
    // #1251：esbuild 会把单行函数拆成多行，按行掐只掐到函数头 —— 按整段函数体取（锚行首收尾，见 669-precedence 同款）。
    userHintOf: evalWithScope(((spliceableJs('src/client/kernel/store-prefs.js').match(/const userHintOf = function[\s\S]*?\n\}/) || [''])[0]).trim().replace(/^const userHintOf = /, ''), {}),
    timer: { timeout: (fn: () => void, ms: number) => setTimeout(fn, ms) },
    setTimeout, clearTimeout, AbortController,
    console: { log () {}, warn () {}, error () {} },
  }
  const body = 'with (scope) {\n' + srcText + '\n; return { loadSnapshot: loadSnapshot, pendingSnapshotByCwd: pendingSnapshotByCwd }\n}'
  // 本处走 compileFn：把拼好的闭包文本当函数体造函数，原来靠 with(scope) 显式拿外层名字，语义不变。
  const mod = compileFn(['scope'], body)(scope)
  // pending 那张在途登记表一并交出来：「这一次请求算在哪个后端名下」现在只剩这一个可观测的落点（见现场 1）。
  return { loadSnapshot: mod.loadSnapshot, calls, pending: mod.pendingSnapshotByCwd }
}
const snapOf = (bid: string, tag: string) => ({ ok: true, bid, tag, maps: [], selection: { backendId: bid, source: 'explicit' }, repository: { backend: bid, name: bid } })

const runScenarios = async function (srcText: string): Promise<Record<string, any>> {
  const out: Record<string, any> = {}
  // 现场 1：切换前飞着一次强制重取（用户在面板上点了刷新），绑定成功之后再强制重取一次。
  {
    const s = makeSnap(srcText)
    const st: Record<string, any> = { cwd: 'D:\\w1', selection: { backendId: 'github' }, snapshot: { bid: 'github-旧' } }
    s.loadSnapshot(st, true, true)
    st.selection = { backendId: 'markdown', userPicked: true } // 绑定成功：用户亲手切到新后端（带标记 → 这一次请求会把它当 hint 上报）
    s.loadSnapshot(st, true, true)
    await tick()
    out.debug = s.calls.map((c) => c.method + '|' + ((c.params && c.params.backendId) || '-'))
    out.switchSentTwo = s.calls.length
    if (!s.calls[1]) return out
    // 「第二次请求算的是切换后那个后端」这条改在**在途登记键**上量（2026-10-12）：产物这一版的取数请求
    //   参数里已经不带后端号了 —— #1003 起客户端不再上报「亲手选的那条」hint（store-prefs.js 的 userHintOf
    //   只剩一个返回 undefined 的空壳，宿主改用工作区文件判），所以后端身份现在只活在
    //   「工作区键 + 后端 id」这把登记键上：去重与回包守卫读的都是它。判据本身没松 —— 仍然要求
    //   「切换后那一次是新后端名下的一次请求」，D 组第 1 条反证（键里去掉后端）照样把它压红。
    out.pendKeys = Array.from(s.pending.keys()).map(String)
    out.secondOnNewBackendKey = out.pendKeys.filter((k) => /\|markdown$/.test(k)).length === 1 && out.pendKeys.filter((k) => /\|github$/.test(k)).length === 1
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
    const st: Record<string, any> = { cwd: 'D:\\w2', selection: { backendId: 'github' }, snapshot: null }
    s.loadSnapshot(st, true, true)
    await tick() // 等第一次登记在途（登记发生在几处 await 之后，这是这一门的量法要照顾的）
    s.loadSnapshot(st, true, true)
    await tick()
    out.sameBackendReuse = s.calls.length
  }
  // 现场 3（回归 #366）：非 force 的在途请求，撞上一次强制重取 —— 强制重取必须真发一次
  {
    const s = makeSnap(srcText)
    const st: Record<string, any> = { cwd: 'D:\\w3', selection: { backendId: 'github' }, snapshot: null }
    s.loadSnapshot(st, false, false)
    s.loadSnapshot(st, true, true)
    await tick()
    out.forceNotReused = s.calls.length
    out.forceMethod = s.calls[1] && s.calls[1].method
  }
  // 现场 4：一个会话中途换后端，旧后端那份晚回来 —— 不许把会话状态倒回旧后端
  {
    const s = makeSnap(srcText)
    const st: Record<string, any> = { cwd: 'D:\\w4', selection: { backendId: 'github' }, snapshot: null }
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
check(real.secondOnNewBackendKey, '现场 1：切换后那一次请求登记在「新后端」名下、切换前那次登记在旧后端名下（在途键实得 ' + JSON.stringify(real.pendKeys) + '；请求参数这一版已不带后端号，理由见这一处的注释）')
check(real.afterSwitch === '切换后那一份', '现场 1：切换后装进去的是新后端那一份（实得「' + real.afterSwitch + '」）')
check(real.selectionAfterSwitch === 'markdown', '现场 1：切换前那份晚回来之后，会话里的后端仍是切换后的那一个（实得「' + real.selectionAfterSwitch + '」）')
check(real.sameBackendReuse === 1, '现场 2（回归）：同一个后端上第二次强制重取照旧复用第一次、只发一次（实得 ' + real.sameBackendReuse + ' 次）')
check(real.forceNotReused === 2 && real.forceMethod === 'wf.refresh', '现场 3（回归 #366）：非 force 在途撞上强制重取时，强制那次照旧真发（实得 ' + real.forceNotReused + ' 次，第二次是 ' + real.forceMethod + '）')
check(real.staleDropped === true, '现场 4：旧后端那份晚回来一个字都没装（' + (real.staleDropped ? '已丢弃' : '被装了') + '）')

console.log('')
console.log('== D 反证：把这两处做坏，C 里对应的那几条必须当场量不通过 ==')
{
  // #1251：反证字符串按产物当下的形态写（esbuild 统一双引号），意图不变。
  const variants = [
    { label: '去重键改回「只按工作区」（不带后端）', patches: [['return wsKeyOf(cwd || "") + "|" + String(backendId || "")', 'return wsKeyOf(cwd || "") + "|"']], must: ['现场 1 发两次', '现场 1 问的是新后端', '现场 1 装新的', '现场 1 后端保持'] },
    { label: '回包守卫整段摘掉', patches: [['if (_snapRespStale(_reqNorm, _mine.seq, _mine.reqBackend, st)) {', 'if (false) {']], must: ['现场 1 后端保持', '现场 4 旧的不装'] },
  ]
  const worse = (key: string, got: Record<string, any>): boolean => {
    if (key === '现场 1 发两次') return got.switchSentTwo !== 2
    if (key === '现场 1 问的是新后端') return got.secondOnNewBackendKey !== true
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
