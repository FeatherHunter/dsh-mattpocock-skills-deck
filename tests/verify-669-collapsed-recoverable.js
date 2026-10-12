// verify-669-collapsed-recoverable.js — 「收起之后必须回得来」（#669）
//
// 起因（2026-09-20 真机报告）：「在某个全新工作区一直操作到 /setup 黄条时点击了黄条后，整个胶囊状态栏全部消失了」。
//   那一次查到底的结论是：真凶为渲染当场抛错 —— 初始化小卡调了一个从来没定义过的函数，React 把整棵子树摘掉。
//   下面 C 组把这一条单独钉住（点黄条那颗主按钮，小卡必须真的渲染出来）。另外两处「点下去就会收起」也确实存在：
//   横幅最右那颗叉，与胶囊最右那颗 ∨。
//
// 2026-09-21 维护者裁定还原界面：2026-09-20 那两轮一度把横幅那颗叉改成带字的「收起」、把收起态那颗按钮画成
//   「有底色、有描边、12px 粗体、带面板图标」的一颗按钮；维护者看过真机之后要求退回改动前的样子。
//
// 2026-10-12：原本还有一组「A 静态层」的断言，读产物文本钉那几处写法的样子（字号 10、无描边、三处收起都不带字……），
//   维护者要求清掉这类「读源码文本钉形状」的门禁，整组已删。从产物里读字号 / 内边距 / 描边 / 圆角那几行留下了，
//   它们不断言任何东西，只当 B 组的输入（B 组量的是浏览器真渲染出来的样式）。
//
// 这一门现在钉三件事：
//   B 真 Chromium：两套写法按真样式渲染出来确实量得出差别（还原后的那一套：矮、无描边、无底色）。
//   C 真产物行为层：把状态栏真身挂起来，逐个点一遍 —— 除了那两处收起，任何一个点击都不许让横幅与胶囊消失；
//     收起之后必须出现一颗写着「展开」的按钮，点它整体回得来。
//   D 反证：把 C 里量到的东西做坏（给黄条整条挂上收起 / 把带字的写法塞回那三处收起），对应的断言必须当场变红。
//
// 依赖：playwright（含 chromium）—— 浏览器实例经 tests/lib/browser-pool.js 取：没设 DSH_TEST_BROWSER_WS 时自己起一个，设了就共用 scripts/browser-host.mjs 起的那一只。
//
// 用法：node tests/verify-669-collapsed-recoverable.js
const fs = require('fs')
const path = require('path')
const { getBrowser, closeBrowser } = require('./lib/browser-pool.js')
const { JSDOM } = require('jsdom')
const React = require('react')
const ReactDOMClient = require('react-dom/client')
const { act } = require('react')
const { evalInWindow } = require('./lib/eval-probe.js')

const ROOT = path.resolve(__dirname, '..')
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']

let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// ── 从产物里抠出「收起态那颗按钮」的四个样式数值（只当 B 组的输入，这里不作断言） ─────────
// 抠法照 verify-640 的先例：值必须从真源里读出来，不许在门里另抄一份常量。
const collapsedBranchOf = function (src) {
  const at = src.indexOf('if (deckFolded) {')
  if (at < 0) throw new Error('产物里找不到收起态那一支（if (deckFolded)）')
  const end = src.indexOf('// #522', at)
  if (end < 0) throw new Error('找不到收起态那一支的结尾（锚点 // #522）')
  return src.slice(at, end)
}
const fieldOf = function (block, field) {
  // 数值型的字段在产物里是 `fontSize: 10`，带单位的那些是 `padding: '0 8px'`，两种都要认。
  const m = block.match(new RegExp(field + ":\\s*(?:'([^']+)'|(\\d+))"))
  return m ? (m[1] !== undefined ? m[1] : m[2]) : null
}

const runStatic = function (src) {
  const block = collapsedBranchOf(src)
  const fontSize = fieldOf(block, 'fontSize')
  const padding = fieldOf(block, 'padding')
  const border = fieldOf(block, 'border')
  const radius = fieldOf(block, 'borderRadius')
  return { fontSize, padding, border, radius }
}

console.log('== 从产物里取出收起态那颗按钮的样式数值（B 组拿它当输入，这里不判任何东西） ==')
let values = null
for (const file of files) {
  const tag = file.indexOf('package/') >= 0 ? 'npm' : 'dyn'
  console.log('=== ' + file + ' ===')
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  try { const v = runStatic(src); if (!values) values = v } catch (e) { failed = true; console.log('  FAIL ' + tag + ' — ' + e.message) }
}

const main = async function () {
console.log('')
console.log('== B 真 Chromium：还原后的收起态是细小灰字那一档 ==')
{
  // 两套值同页渲染：一套是产物里读出来的真样式（还原后），一套是 2026-09-20 那一版的写法
  //   （源码里已经没有它可读，所以照那次提交的原文写死）。判据同一条，要求还原后的过、放大版不过 ——
  //   不过的那一套就是这一门的反证。
  const page = [
    '<!doctype html><html><head><meta charset=utf-8><style>',
    'body{margin:0;background:#0a0a0a;color:#e6edf3;font-family:Arial,Helvetica,sans-serif}',
    '.row{padding:16px}',
    '</style></head><body>',
    // 还原后那颗按钮的底色来自幽灵类名（.dsws-btn.ghost 的 background:transparent），行内样式里不写底色，
    //   所以这一页也要照样写 transparent —— 不写的话量到的是浏览器给按钮的默认底色，这一条会无故变红。
    '<div class="row"><button id="real" style="display:inline-flex;align-items:center;gap:4px;font-size:' + values.fontSize + ';padding:' + values.padding + ';line-height:1.2;border:' + values.border + ';border-radius:99px;background:transparent;color:#8b8b95">展开MattSkillsDeck</button></div>',
    '<div class="row"><button id="past" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:1.4;padding:3px 12px;border-radius:14px;border:1px solid #2a2d35;background:#10131a;color:#a1a1aa">展开MattSkillsDeck</button></div>',
    '</body></html>',
  ].join('\n')

  const browser = await getBrowser({ headless: true })
  const p = await browser.newPage({ viewport: { width: 900, height: 400 } })
  await p.setContent(page)
  const m = await p.evaluate(() => {
    const out = {}
    for (const id of ['real', 'past']) {
      const el = document.getElementById(id)
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      out[id] = {
        h: Math.round(r.height * 100) / 100, w: Math.round(r.width * 100) / 100,
        borderW: parseFloat(cs.borderTopWidth) || 0,
        bg: cs.backgroundColor,
        pageBg: getComputedStyle(document.body).backgroundColor,
      }
    }
    return out
  })
  await closeBrowser()

  const slim = (x) => x.h < 18 && x.borderW === 0 && x.bg === 'rgba(0, 0, 0, 0)'
  console.log('真样式：高 ' + m.real.h + 'px、宽 ' + m.real.w + 'px、描边 ' + m.real.borderW + 'px、底色 ' + m.real.bg)
  console.log('放大版：高 ' + m.past.h + 'px、宽 ' + m.past.w + 'px、描边 ' + m.past.borderW + 'px、底色 ' + m.past.bg)
  check(slim(m.real), '收起态那颗按钮量出来是细小灰字那一档：矮、无描边、无底色（实测 高 ' + m.real.h + 'px / 描边 ' + m.real.borderW + 'px / 底色 ' + m.real.bg + '）')
  check(!slim(m.past), '反证 B 成立：放大版那一套量不通过（高 ' + m.past.h + 'px、描边 ' + m.past.borderW + 'px、底色 ' + m.past.bg + '）')
}

// ── 时间压缩：本门 C/D 两组要挂十六次真产物，每次都得真等 React 那几拍（sleep 30 / step 25 / 点一下 40+40），
//    合计四秒多，等的时间全是空等。压成虚拟时间以后真实只等几毫秒，而门里判「收起之后回得来」靠的是点完之后的
//    版面状态，与真实触发时刻无关。
//    为什么装在这里、而不是文件开头：本门 B 组真起 Chromium，而 Playwright 自己的协议死线（例如 launch 的
//    180 秒）用的就是本进程的 setTimeout。装在文件开头会让那条死线在几毫秒内到期，B 组当场变成
//    「browserType.launch: Timeout 180000ms exceeded」——实测如此（2026-10-12）。所以压缩只罩住后面纯 jsdom 的
//    C/D 两组：B 组收工（closeBrowser）之后才装，装的位置就在这一行。
//    后人在本行之后再加真浏览器 / 真子进程的段落时注意：那些段落会踩到同一个坑，要么把它们放到压缩之前，
//    要么别在这一门里加。
//    断言一条没动；理由、两条不能破的语义与边界见 tests/lib/time-compress.js 文件头。
const { installTimeCompression, uninstallTimeCompression } = require('./lib/time-compress.js')
installTimeCompression()

// ── C 组：把真产物挂起来，逐个点一遍 ────────────────────────────────────────────────
// 假宿主只做两件事：快照里带上「这个工作区选的是 GitHub」（否则界面停在蓝条那一档），
// 链快照回「仓库已就绪、工作区还没初始化」那一档（于是横幅是黄条，也就是用户点的那一条）。
const CHAIN_SETUP = { steps: [
  { id: 'gh:installed', status: 'done' }, { id: 'gh:authed', status: 'done' },
  { id: 'gh:remote', status: 'done', show: { desc: 'FeatherHunter/665-demo' } },
  { id: 'tracker:initialized', status: 'current', show: { desc: 'docs/agents/issue-tracker.md 不存在' } },
  { id: 'skill:wayfinder', status: 'pending' }, { id: 'skill:setup-matt-pocock-skills', status: 'pending' }, { id: 'skill:ask-matt', status: 'pending' },
  { id: 'env:home', status: 'done' },
] }
const SNAP_GITHUB = { ok: true, value: { ok: true, selection: { backendId: 'github', source: 'explicit' }, repository: null, maps: [], checks: null, tickets: [], groups: {}, isLocal: false, version: 'v669', workspaceRoot: 'D:\\tmp\\669-fold' } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

global.IS_REACT_ACT_ENVIRONMENT = true

// 把产物真身挂起来一次（每个现场都新开一份 jsdom：收起记忆在模块作用域里，混着量不准）。
const mountLive = async function (code) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="bar"></div><textarea id="draft"></textarea></body></html>',
    { url: 'http://127.0.0.1:59519/', runScripts: 'dangerously' })
  const { window } = dom
  global.window = window
  global.document = window.document
  try { global.navigator = window.navigator } catch (e) {}
  global.Node = window.Node
  global.HTMLElement = window.HTMLElement
  global.getComputedStyle = window.getComputedStyle
  global.requestAnimationFrame = window.requestAnimationFrame || ((cb) => setTimeout(cb, 0))
  global.cancelAnimationFrame = window.cancelAnimationFrame || clearTimeout
  if (typeof window.ResizeObserver === 'undefined') window.ResizeObserver = class { observe () {} unobserve () {} disconnect () {} }
  global.ResizeObserver = window.ResizeObserver
  if (!window.document.fonts) window.document.fonts = { ready: Promise.resolve() }

  const methods = []
  const connection = { rpc: { call: async (channel, endpoint, req) => {
    const method = req && req.method
    methods.push(method)
    if (method === 'snapshot') return SNAP_GITHUB
    if (method === 'chain') return { ok: true, value: { ok: true, fullSnapshot: CHAIN_SETUP, backendId: 'github' } }
    return { ok: true, value: { ok: true } }
  } } }
  const dict = {}
  const trFn = (key, params) => {
    let s = dict[key] !== undefined ? dict[key] : key
    if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
    return s
  }
  const registrations = []
  const services = {
    slots: { register: (meta, comp) => { registrations.push({ meta: meta, comp: comp }); return () => {} }, inject: (name, fn) => { try { fn() } catch (e) {} } },
    sidebarRightTabs: { register: () => () => {} },
    connection: connection,
    locale: { register: (ns, d) => { Object.assign(dict, d.zh || {}, d.en || {}); return () => {} }, bind: () => trFn },
    workspaces: { list: async () => [] },
    sessions: { list: async () => [] },
    timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
  }
  const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (deps, cb) => { cb(ctx); return { dispose: () => {} } } }

  let loaded = null
  window.__ModuleLoader__ = { load (spec) { loaded = spec; return spec } }
  // 本文件选 evalInWindow：这段产物源码原来是在这扇 jsdom 窗口里跑的（建它时开了 runScripts），
  //   换成共用入口在同一个窗口环境里执行，环境与语义都不变。
  evalInWindow(dom, code)
  const mod = loaded.factory((m) => {
    if (m === 'react') return React
    if (m === 'react-dom') return ReactDOMClient
    throw new Error('产物要了一份没准备的模块：' + m)
  })
  mod.apply(ctx)
  const comp = registrations.filter((r) => r.meta && r.meta.name === 'conversation.input.dock').map((r) => r.comp)[0]
  if (!comp) throw new Error('状态栏组件没有登记到插槽上')
  const container = window.document.getElementById('bar')
  const root = ReactDOMClient.createRoot(container)
  // 注入的落点与界面上真用的一致（状态栏会把 props.inputActions.setDraft 写进会话状态）；
  //   #669 第 4 件起这一门要用它断言「确认之后注入的正文里带着选中的布局」。
  const drafts = []
  const step = async (ms) => { await act(async () => { await sleep(ms || 30) }) }
  await act(async () => {
    root.render(React.createElement(comp, {
      sessionId: 'sid-669',
      session: { cwd: 'D:\\tmp\\669-fold' },
      useSessions: () => undefined,
      inputActions: { setDraft: (t) => { drafts.push(String(t)) } },
    }))
    await sleep(30)
  })
  for (let i = 0; i < 40 && !container.querySelector('.dsws-banner'); i++) await step(25)
  const clickNode = async (el) => {
    if (!el) return false
    await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(40) })
    await step(40)
    return true
  }
  const click = async (sel) => clickNode(container.querySelector(sel))
  // 收工：把这一份挂载拆干净（卸载 React 根 + 关掉 jsdom 窗口）。不拆的话，状态栏里那颗 2 秒的定时器
  //   会跟着每个现场一直跑下去，这一门会越跑越慢、日志里全是 React 的账（实测：不拆时十几秒能跑完的一页跑不完）。
  const dispose = function () {
    try { root.unmount() } catch (e) {}
    try { window.close() } catch (e) {}
  }
  return { window: window, container: container, dict: dict, trFn: trFn, methods: methods, drafts: drafts, click: click, clickNode: clickNode, step: step, dispose: dispose }
}

// 收起态那颗按钮是还原后的写法：只带幽灵类名（dsws-btn ghost），所以它身上不再有专门的类名可抓，
//   改用无障碍名（与界面同源的那句「展开MattSkillsDeck」）去认；收起态里没有别的按钮，兜底取第一颗。
const recoverOf = function (container, dict) {
  const want = (dict && dict['banner.expandDeck']) || '展开MattSkillsDeck'
  const buttons = Array.prototype.slice.call(container.querySelectorAll('button'))
  const byLabel = buttons.filter((b) => (b.getAttribute('aria-label') || '') === want)[0]
  if (byLabel) return byLabel
  const folded = !container.querySelector('.dsws-banner') && !container.querySelector('.dsws-capsule')
  return folded ? (buttons[0] || null) : null
}

// 收起态那颗按钮在 jsdom 里的行内样式序列化：还原后的那一套长这样。不咬 `border` 的原文 ——
//   jsdom 会把 `border:none` 写成 `border:medium`，所以这里只要求「没有 1px 描边」「行内不写底色」，
//   放大版那两句（border:1px solid…、background:var(…)）一踩就红。
const slimStyle = function (s) {
  return /font-size:\s*10px/.test(s) && /border-radius:\s*99px/.test(s) &&
    !/border:\s*1px/.test(s) && !/font-size:\s*12px/.test(s) && !/background/.test(s)
}

const stateOf = (container, dict) => {
  const recover = recoverOf(container, dict)
  return {
    banner: !!container.querySelector('.dsws-banner'),
    capsule: !!container.querySelector('.dsws-capsule'),
    recover: recover,
    cardRadios: container.querySelectorAll('input[name=setup-layout]').length,
    moduleRadios: container.querySelectorAll('input[name=setup-pick]').length,
    text: String(container.textContent || '').replace(/\s+/g, ' ').slice(0, 400),
  }
}

const SWEEP = [
  ['横幅正文（整条）', '.dsws-banner', 'keep'],
  ['横幅里的文字那一段', '.dsws-banner > span', 'keep'],
  ['横幅上的主按钮', '.dsws-banner button.dsws-btn:not(.dsws-banner-fold-x)', 'keep'],
  ['胶囊整条', '.dsws-capsule', 'keep'],
  ['胶囊最左的名字那一段', '.dsws-capsule-word', 'keep'],
  ['胶囊里的一个状态段', '.dsws-seg', 'keep'],
  ['横幅上那颗叉（收起整个功能区）', '.dsws-banner-fold-x', 'fold'],
  ['胶囊最右那颗 ∨', '.dsws-fold-toggle', 'fold'],
]

// 走一遍全部点击目标；返回每个目标实得的结局（供 C 组断言、D 组反证复用）。
//   任何一步抛错都收成这一行的 err（不往外抛）：将来真回归时，这一门要报出「哪一处点下去炸了」，
//   而不是自己带一份堆栈死掉 —— #669 的真凶就是「渲染里抛错」，这一门必须能把那句话原样报出来。
const runSweep = async function (code) {
  const out = []
  const quietW = console.warn
  const quietE = console.error
  console.warn = function () {}
  console.error = function () {}
  try {
    for (const row of SWEEP) {
      const label = row[0]
      const sel = row[1]
      const want = row[2]
      const t0 = Date.now()
      let live = null
      try { live = await mountLive(code) } catch (e) { out.push({ label: label, want: want, err: '挂载就抛错：' + ((e && e.message) || e) }); continue }
      const before = stateOf(live.container, live.dict)
      if (!before.banner || !before.capsule) { live.dispose(); out.push({ label: label, want: want, err: '挂载后横幅或胶囊就不在（前置不成立）' }); continue }
      let clickErr = null
      const hit = await live.click(sel).catch((e) => { clickErr = (e && e.message) || String(e); return false })
      if (!hit) { live.dispose(); out.push({ label: label, want: want, err: clickErr ? '点下去抛错：' + clickErr : '页面上找不到 ' + sel }); continue }
      const after = stateOf(live.container, live.dict)
      const item = {
        label: label,
        want: want,
        banner: after.banner,
        capsule: after.capsule,
        recoverText: after.recover ? String(after.recover.textContent || '') : null,
        expectRecover: String(live.dict['banner.expandDeck'] || '展开MattSkillsDeck'),
        recoverStyle: after.recover ? String(after.recover.getAttribute('style') || '') : '',
        cardRadios: after.cardRadios,
        moduleRadios: after.moduleRadios,
        cardText: after.text,
        back: null,
        err: null,
      }
      if (after.recover) {
        const restored = await live.click('button[aria-label="' + item.expectRecover + '"]').catch(() => false)
        const back = stateOf(live.container, live.dict)
        item.back = !!(restored && back.banner && back.capsule)
      }
      item.ms = Date.now() - t0
      live.dispose()
      out.push(item)
    }
  } finally {
    console.warn = quietW
    console.error = quietE
  }
  return out
}

console.log('')
console.log('== C 真产物行为层：逐个点一遍，看谁会让整条状态栏消失 ==')
{
  const code = fs.readFileSync(path.join(ROOT, 'package/lib/client.js'), 'utf8')
  const rows = await runSweep(code)
  let hideSet = 0
  for (const r of rows) {
    if (r.err) { check(false, 'C「' + r.label + '」：' + r.err); continue }
    if (r.want === 'keep') {
      check(r.banner && r.capsule, 'C「' + r.label + '」点下去横幅与胶囊都还在（实得 横幅=' + r.banner + ' 胶囊=' + r.capsule + '）')
      if (!r.banner && !r.capsule) hideSet += 1
    } else {
      const okFold = !r.banner && !r.capsule && r.recoverText && r.recoverText === r.expectRecover
      check(okFold, 'C「' + r.label + '」点下去确实收起了整条功能区，并留了一颗写着「' + r.expectRecover + '」的按钮（实得 横幅=' + r.banner + ' 胶囊=' + r.capsule + '，按钮「' + r.recoverText + '」）')
      check(r.capsule === false && r.back === true, 'C「' + r.label + '」点那颗「展开」之后整体回得来（实得 ' + r.back + '）')
      check(slimStyle(r.recoverStyle),
        'C「' + r.label + '」收起态那颗按钮就是还原后的细小灰字写法（字号 10、圆角 99、没有 1px 描边、行内不写底色；实得 ' + r.recoverStyle + '）')
    }
  }
  check(hideSet === 0, 'C 汇总：点横幅正文 / 主按钮 / 胶囊 / 状态段，一处都没让状态栏消失（实得 ' + hideSet + ' 处）')
  // 黄条那颗主按钮这一处单独钉住（#669 第 4 件之后它问的东西变了）：
  //   ① 小卡必须真的渲染出来（而不是像 2026-09-21 之前那样在渲染里抛错、把整条状态栏带走）；
  //   ② 卡上只问「域文档布局」这一问 —— 不再有后端单选（后端到这一步早在门控那一步定完了）；
  //   ③ 卡上只读地写着这次用哪个后端；那句属于「挑后端」那一步的橙字提示也不该再出现在这张卡上。
  const primary = rows.filter((r) => r.label === '横幅上的主按钮')[0]
  check(!!primary && !primary.err && primary.cardRadios > 0, 'C：点黄条那颗主按钮之后，初始化小卡真的渲染出来了（布局单选框实得 ' + (primary && primary.cardRadios) + ' 个）')
  check(!!primary && primary.moduleRadios === 0, 'C：这张卡上不再有后端单选（实得 ' + (primary && primary.moduleRadios) + ' 个，应为 0）')
  check(!!primary && /GitHub/.test(primary.cardText || ''), 'C：卡上只读地写着这次用哪个后端（实得文字里有 GitHub：' + /GitHub/.test((primary && primary.cardText) || '') + '）')
  {
    const live0 = await mountLive(code)
    const wip = String(live0.dict['gate.wipNotice'] || 'Markdown 预览，GitLab 筹备中')
    await live0.click('.dsws-banner button.dsws-btn')
    const cardText = String(live0.container.textContent || '')
    check(cardText.indexOf(wip) < 0, 'C：那句「' + wip + '」不再出现在这张卡上（属于挑后端那一步的注解）')
    // 点卡上的「确认并继续」（它不在横幅里面，是横幅下面那张卡自己的按钮）：只记布局、只注入 ——
    //   不许再写选择、不许再打绑定电话。
    const confirmText = String(live0.dict['banner.setupPickConfirm'] || '确认并继续').trim()
    const confirmBtn = Array.prototype.slice.call(live0.container.querySelectorAll('button'))
      .filter((b) => String(b.textContent || '').trim() === confirmText)[0]
    check(!!confirmBtn, 'C：那张卡上找得到「' + confirmText + '」那颗按钮')
    const before = live0.methods.length
    await live0.clickNode(confirmBtn)
    const afterMethods = live0.methods.slice(before)
    const draft = String((live0.drafts || []).slice(-1)[0] || '')
    check(afterMethods.indexOf('bind') < 0, 'C：卡上那颗确认不再打绑定电话（这一段新出现的电话实得 ' + JSON.stringify(afterMethods) + '）')
    check(draft.indexOf('single-context') >= 0, 'C：确认之后按选中的布局注入了初始化全文（注入文案里找得到 single-context：' + (draft.indexOf('single-context') >= 0) + '；开头「' + draft.slice(0, 60) + '」）')
    check(!live0.container.querySelector('input[name=setup-layout]'), 'C：确认之后这张卡关掉了（布局单选框已从界面上消失）')
    check(!!live0.container.querySelector('.dsws-banner') && !!live0.container.querySelector('.dsws-capsule'), 'C：确认这一下没有把横幅或胶囊带走')
    live0.dispose()
  }
  // 那颗叉身上一个字都没有（还原的就是图形叉），但悬停与无障碍名仍是全称（与界面同源）。
  const live = await mountLive(code)
  const btn = live.container.querySelector('.dsws-banner-fold-x')
  const wantName = String(live.dict['banner.foldDeck'] || '收起MattSkillsDeck')
  check(!!btn && String(btn.textContent || '').trim() === '',
    'C：横幅那颗收起控件是纯图形叉、身上一个字都没有（实得「' + (btn ? String(btn.textContent || '') : '没找到') + '」）')
  check(!!btn && String(btn.getAttribute('aria-label') || '') === wantName,
    'C：那颗叉的无障碍名仍是全称「' + wantName + '」（实得「' + (btn ? String(btn.getAttribute('aria-label') || '') : '没找到') + '」）')
  live.dispose()
}

console.log('')
console.log('== D 反证：把量到的东西做坏，C 里对应的那几条必须当场变红 ==')
{
  const code = fs.readFileSync(path.join(ROOT, 'package/lib/client.js'), 'utf8')
  // D1：给黄条整条挂上收起（模拟真机现场那一种「点一下黄条整条就没了」）
  const NEEDLE = "return h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, cursor: 'default' } }"
  const d1 = code.replace(NEEDLE, "return h('div', { className: 'dsws-banner warn', onClick: foldBanner, style: { margin: 0, maxWidth: 560, cursor: 'default' } }")
  check(d1 !== code, '反证 D1：改动落到了产物上')
  const rows1 = await runSweep(d1)
  const broken = rows1.filter((r) => (r.want === 'keep') && (r.banner === false || r.capsule === false))
  check(broken.length > 0, '反证 D1：黄条整条一旦可收起C 组当场变红（红的有：' + (broken.map((b) => b.label).join('、') || '一处都没有 —— 这一门量不住这个毛病') + '）')

  // D2：把带字的「收起」塞回那三处触发，C 组那条「身上一个字都没有」必须红
  const d2 = code.replace(/Ic\(\{\s*n:\s*'x',\s*size:\s*11\s*\}\)/g, "[Ic({ n: 'x', size: 11 }), h('span', null, tr('banner.foldShort'))]")
  check(d2 !== code, '反证 D2：能把带字的写法塞回那三处收起')
  const live2 = await mountLive(d2)
  const btn2 = live2.container.querySelector('.dsws-banner-fold-x')
  const label2 = btn2 ? String(btn2.textContent || '').trim() : '没找到'
  check(label2 !== '', '反证 D2：塞回去之后那条断言当场变红（实得「' + label2 + '」，应为空）')
  live2.dispose()
}

console.log('')
console.log('共 ' + total + ' 项检查')
// 收工先把全局时钟还原：本仓打算把多扇门禁放进同一个进程跑，别把虚拟时钟留给后面那几扇。
uninstallTimeCompression()
if (failed) { console.log('存在失败'); process.exit(1) }
console.log('全部通过')
// 显式收工：这一门每走一步都会挂一份真产物（里面带着 2 秒的定时器与 React 根），
//   自然等事件循环排空是等不干净的 —— 该收的都收了之后，这里直接退出。
process.exit(0)
}

main().catch((e) => { console.error(e); uninstallTimeCompression(); process.exit(1) })
