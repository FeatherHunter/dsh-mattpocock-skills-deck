// verify-669-collapsed-recoverable.js — 「收起那一颗必须说清自己在收什么，收起之后必须回得来」（#669）
//
// 起因（2026-09-20 真机报告）：「在某个全新工作区一直操作到 /setup 黄条时点击了黄条后，整个胶囊状态栏全部消失了」。
//   2026-09-21 用真产物 + 真 Chromium 把状态栏上每个能点的地方逐个点了一遍（脚本 .scratch/669-click-sweep.mjs），
//   得到的事实是：点横幅正文、横幅文字、横幅那颗主按钮、胶囊本体、胶囊里的状态段 —— 横幅与胶囊都还在，
//   只有两处会让整条状态栏消失：横幅最右那颗「收起」（原来是个纯图形叉，被读成「关掉这条黄条」）
//   与胶囊最右那颗 ∨；而收起状态按工作区记着，刷新之后依旧收着 —— 用户看到的就是「点了黄条，整条胶囊没了」。
//
// 所以这一门钉四件事：
//   A 静态层：收起态那颗按钮看得见（字够大、有描边、有底色、写得清是展开谁）；三处「收起」都带字、都离主按钮 12px。
//   B 真 Chromium：收起态按钮按真样式渲染出来确实是看得见的一颗按钮（拿改动前的旧写法做反证，旧写法必须量不通过）。
//   C 真产物行为层：把状态栏真身挂起来，逐个点一遍 —— 除了那两颗「收起」，任何一个点击都不许让横幅与胶囊消失；
//     点了「收起」之后必须出现一颗写着「展开」的按钮，点它整体回得来。
//   D 反证：把 A、C 里量到的东西做坏（把「收起」上的字摘掉 / 给黄条整条挂上收起），对应的断言必须当场变红。
//
// 用法：node tests/verify-669-collapsed-recoverable.js
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const { JSDOM } = require('jsdom')
const React = require('react')
const ReactDOMClient = require('react-dom/client')
const { act } = require('react')

const ROOT = path.resolve(__dirname, '..')
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']

let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// ── 从产物里抠出「收起态那颗按钮」的样式与其身上的几处断言 ─────────────────────────
// 抠法照 verify-640 的先例：值必须从真源里读出来，读不到就报错，不许在门里另抄一份常量。
const collapsedBranchOf = function (src) {
  const at = src.indexOf('if (deckFolded) {')
  if (at < 0) throw new Error('产物里找不到收起态那一支（if (deckFolded)）')
  const end = src.indexOf('// #522', at)
  if (end < 0) throw new Error('找不到收起态那一支的结尾（锚点 // #522）')
  return src.slice(at, end)
}
const fieldOf = function (block, field) {
  // 数值型的字段在产物里是 `fontSize: 12`，百分号/尺寸那些是 `padding: '3px 12px'`，两种都要认。
  const m = block.match(new RegExp(field + ":\\s*(?:'([^']+)'|(\\d+))"))
  return m ? (m[1] !== undefined ? m[1] : m[2]) : null
}

// 三处「收起」触发的写法（黄条 / 探测中黄条 / 蓝条）——同一份声明，三处都该长这样。
const TRIGGER_CLASS = 'dsws-btn ghost dsws-banner-collapse'
// 每一处「收起」身上必须有：一个朝下的字形 + 一句看得见的短词条（不写死词条原文，只认它取的是哪个键）。
const labeledAt = function (slice) { return slice.indexOf("'chev-down'") >= 0 && slice.indexOf("tr('banner.foldShort')") >= 0 }
// 「收起」那颗上的标签（词条键）在真源里长什么样 —— 两种排版（紧凑 / 带空格）都要认得出，摘字那两道反证靠它。
const LABEL_TEXT = /, h\('span',\s*\{\s*key:\s*'txt'\s*\},\s*tr\('banner\.foldShort'\)\)/g
const runStatic = function (src, tag) {
  const block = collapsedBranchOf(src)
  const fontSize = fieldOf(block, 'fontSize')
  const padding = fieldOf(block, 'padding')
  const border = fieldOf(block, 'border')
  const background = fieldOf(block, 'background')
  check(!!fontSize && Number(fontSize) >= 12, tag + ' · 收起态按钮字号不小于 12（现在是 ' + fontSize + '）')
  check(!!border && border !== 'none' && /solid/.test(border), tag + ' · 收起态按钮有描边（现在是 ' + border + '）')
  check(!!background && /var\(--dsw-alias-bg-layer-1/.test(background), tag + ' · 收起态按钮有底色（与胶囊同源变量；现在是 ' + background + '）')
  check(/borderRadius:\s*14/.test(block), tag + ' · 收起态按钮圆角与胶囊同形（14）')
  check(block.indexOf("tr('banner.expandDeck')") >= 0, tag + ' · 收起态按钮写着面板名（tr banner.expandDeck）')
  check(/'?aria-label'?:\s*tr\('banner.expandDeck'\)/.test(block), tag + ' · 收起态按钮保留无障碍名')
  check(/onClick:\s*expandBanner/.test(block), tag + ' · 收起态按钮点下去调 expandBanner')
  // 旧写法必须消失：否则这一门会对着幽灵按钮误绿
  check(!/fontSize:\s*10,\s*padding:\s*'0 8px'/.test(block), tag + ' · 旧的 10px 幽灵写法已消失')
  check(!/lineHeight:\s*1\.2/.test(block), tag + ' · 旧的紧凑行高写法已消失')
  // 回得来：展开仍然把这条工作区的收起标记删掉
  const prefs = fs.readFileSync(path.join(ROOT, 'src/client/kernel/store-prefs.js'), 'utf8')
  check(/setBannerFolded = function \(cwd, folded\)[\s\S]{0,400}else delete bannerFoldByCwd\[k\]/.test(prefs),
    tag + ' · setBannerFolded(cwd,false) 仍然是删掉标记（展开真回得来）')
  // 三处「收起」都要带字（#669 返工：原来是个纯图形叉，被读成「关掉这条黄条」）
  const triggers = src.match(new RegExp(TRIGGER_CLASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []
  let labeledAll = 0
  let at = src.indexOf(TRIGGER_CLASS)
  while (at >= 0) {
    if (labeledAt(src.slice(at, at + 420))) labeledAll += 1
    at = src.indexOf(TRIGGER_CLASS, at + 1)
  }
  check(triggers.length >= 3, tag + ' · 收起触发共 ' + triggers.length + ' 处（黄条 / 探测中黄条 / 蓝条）')
  check(labeledAll >= triggers.length, tag + ' · 每一处「收起」都带着看得见的字（带字的 ' + labeledAll + ' / 共 ' + triggers.length + '）')
  const spacedAll = (function () {
    let n = 0
    let i = src.indexOf(TRIGGER_CLASS)
    while (i >= 0) { if (/marginLeft:\s*12/.test(src.slice(i, i + 260))) n += 1; i = src.indexOf(TRIGGER_CLASS, i + 1) }
    return n
  })()
  check(spacedAll >= triggers.length, tag + ' · 每处收起都带 marginLeft:12 离开主按钮（带距离的 ' + spacedAll + ' / 共 ' + triggers.length + '）')
  check(!/className:\s*'dsws-btn ghost dsws-banner-fold-x'/.test(src), tag + ' · 旧的纯图形叉写法已消失（不再有一颗只说「关掉」的叉）')
  return { fontSize, padding, border, background }
}

console.log('== A 静态层：收起态看得见、三处「收起」都带字 ==')
let values = null
for (const file of files) {
  const tag = file.indexOf('package/') >= 0 ? 'npm' : 'dyn'
  console.log('=== ' + file + ' ===')
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  try { const v = runStatic(src, tag); if (!values) values = v } catch (e) { failed = true; console.log('  FAIL ' + tag + ' — ' + e.message) }
}
// 反证：把「收起」上的字摘掉（还原成纯图形叉），上面那条「带字」必须当场变红。
{
  const src = fs.readFileSync(path.join(ROOT, files[0]), 'utf8')
  const stripped = src.replace(LABEL_TEXT, '')
  check(stripped !== src, '反证 A：能把「收起」上的字摘下来（说明那条断言量的就是这几处）')
  const triggers = (stripped.match(new RegExp(TRIGGER_CLASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  let labeledAll = 0
  let at = stripped.indexOf(TRIGGER_CLASS)
  while (at >= 0) { if (labeledAt(stripped.slice(at, at + 420))) labeledAll += 1; at = stripped.indexOf(TRIGGER_CLASS, at + 1) }
  check(labeledAll < triggers, '反证 A：摘掉字之后，带字那一问当场变红（带字的 ' + labeledAll + ' < 触发 ' + triggers + '）')
}

const main = async function () {
console.log('')
console.log('== B 真 Chromium：收起态那颗按钮按真样式渲染出来，确实是看得见的一颗按钮 ==')
{
  // 两套值同页渲染：一套是产物里读出来的真样式，一套是改动前的旧写法。判据同一条，
  // 要求真样式过、旧写法不过 —— 不过的那一套就是这一门的反证。
  const capsuleBorder = (fs.readFileSync(path.join(ROOT, 'src/client/kernel/styles.js'), 'utf8').match(/1px solid var\(--dsw-alias-border-l1[^']*/) || [''])[0]
  const page = [
    '<!doctype html><html><head><meta charset=utf-8><style>',
    'body{margin:0;background:#0a0a0a;color:#e6edf3;font-family:Arial,Helvetica,sans-serif}',
    '.row{padding:16px}',
    '</style></head><body>',
    '<div class="row"><button id="real" style="display:inline-flex;align-items:center;gap:6px;font-size:' + values.fontSize + ';line-height:1.4;padding:' + values.padding + ';border-radius:14px;border:' + values.border + ';background:' + values.background + ';color:#a1a1aa">展开MattSkillsDeck</button></div>',
    '<div class="row"><button id="old" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:0 8px;line-height:1.2;border:none;border-radius:99px;color:#8b8b95">展开MattSkillsDeck</button></div>',
    '</body></html>',
  ].join('\n')
  void capsuleBorder

  const browser = await chromium.launch({ headless: true })
  const p = await browser.newPage({ viewport: { width: 900, height: 400 } })
  await p.setContent(page)
  const m = await p.evaluate(() => {
    const out = {}
    for (const id of ['real', 'old']) {
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
  await browser.close()

  const visible = (x) => x.h >= 20 && x.borderW >= 1 && x.bg !== x.pageBg
  console.log('真样式：高 ' + m.real.h + 'px、宽 ' + m.real.w + 'px、描边 ' + m.real.borderW + 'px、底色 ' + m.real.bg + '（页面底色 ' + m.real.pageBg + '）')
  console.log('旧写法：高 ' + m.old.h + 'px、宽 ' + m.old.w + 'px、描边 ' + m.old.borderW + 'px、底色 ' + m.old.bg)
  check(visible(m.real), '收起态按钮看得见：高≥20px 且有描边且有底色（实测 ' + m.real.h + 'px / ' + m.real.borderW + 'px / ' + m.real.bg + '）')
  check(m.real.w >= 110, '收起态按钮够宽（写全面板名，实测 ' + m.real.w + 'px ≥ 110）')
  check(!visible(m.old), '反证 B 成立：旧写法量不通过（高 ' + m.old.h + 'px、描边 ' + m.old.borderW + 'px、底色 ' + m.old.bg + '）')
}

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
  window.eval(code)
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
  const step = async (ms) => { await act(async () => { await sleep(ms || 30) }) }
  await act(async () => {
    root.render(React.createElement(comp, {
      sessionId: 'sid-669',
      session: { cwd: 'D:\\tmp\\669-fold' },
      useSessions: () => undefined,
      inputActions: { setDraft: () => {} },
    }))
    await sleep(30)
  })
  for (let i = 0; i < 40 && !container.querySelector('.dsws-banner'); i++) await step(25)
  const click = async (sel) => {
    const el = container.querySelector(sel)
    if (!el) return false
    await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(40) })
    await step(40)
    return true
  }
  // 收工：把这一份挂载拆干净（卸载 React 根 + 关掉 jsdom 窗口）。不拆的话，状态栏里那颗 2 秒的定时器
  //   会跟着每个现场一直跑下去，这一门会越跑越慢、日志里全是 React 的账（实测：不拆时十几秒能跑完的一页跑不完）。
  const dispose = function () {
    try { root.unmount() } catch (e) {}
    try { window.close() } catch (e) {}
  }
  return { window: window, container: container, dict: dict, trFn: trFn, methods: methods, click: click, step: step, dispose: dispose }
}

const stateOf = (container) => ({
  banner: !!container.querySelector('.dsws-banner'),
  capsule: !!container.querySelector('.dsws-capsule'),
  recover: container.querySelector('button.dsws-cap-recover'),
  cardRadios: container.querySelectorAll('input[name=setup-layout]').length,
  moduleRadios: container.querySelectorAll('input[name=setup-pick]').length,
  text: String(container.textContent || '').replace(/\s+/g, ' ').slice(0, 400),
})

const SWEEP = [
  ['横幅正文（整条）', '.dsws-banner', 'keep'],
  ['横幅里的文字那一段', '.dsws-banner > span', 'keep'],
  ['横幅上的主按钮', '.dsws-banner button.dsws-btn:not(.dsws-banner-collapse)', 'keep'],
  ['胶囊整条', '.dsws-capsule', 'keep'],
  ['胶囊最左的名字那一段', '.dsws-capsule-word', 'keep'],
  ['胶囊里的一个状态段', '.dsws-seg', 'keep'],
  ['横幅上那颗「收起」', '.dsws-banner-collapse', 'fold'],
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
      const before = stateOf(live.container)
      if (!before.banner || !before.capsule) { live.dispose(); out.push({ label: label, want: want, err: '挂载后横幅或胶囊就不在（前置不成立）' }); continue }
      let clickErr = null
      const hit = await live.click(sel).catch((e) => { clickErr = (e && e.message) || String(e); return false })
      if (!hit) { live.dispose(); out.push({ label: label, want: want, err: clickErr ? '点下去抛错：' + clickErr : '页面上找不到 ' + sel }); continue }
      const after = stateOf(live.container)
      const item = {
        label: label,
        want: want,
        banner: after.banner,
        capsule: after.capsule,
        recoverText: after.recover ? String(after.recover.textContent || '') : null,
        expectRecover: String(live.dict['banner.expandDeck'] || '展开MattSkillsDeck'),
        recoverBorder: after.recover ? String(after.recover.getAttribute('style') || '').indexOf('border') >= 0 : false,
        cardRadios: after.cardRadios,
        moduleRadios: after.moduleRadios,
        cardText: after.text,
        back: null,
        err: null,
      }
      if (after.recover) {
        const restored = await live.click('button.dsws-cap-recover').catch(() => false)
        const back = stateOf(live.container)
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
      check(r.recoverBorder, 'C「' + r.label + '」收起态那颗按钮带着自己的样式（不是一句灰字）')
    }
  }
  check(hideSet === 0, 'C 汇总：点横幅正文 / 主按钮 / 胶囊 / 状态段，一处都没让状态栏消失（实得 ' + hideSet + ' 处）')
  // 真凶那一处单独钉一遍：点黄条那颗主按钮，初始化小卡必须真的出来（后端名单还没到时走内置兜底名单），
  //   而不是像 2026-09-21 之前那样，在那条兜底分支里抛 ReferenceError 把整条状态栏带走。
  const primary = rows.filter((r) => r.label === '横幅上的主按钮')[0]
  check(!!primary && !primary.err && primary.cardRadios > 0, 'C：点黄条那颗主按钮之后，初始化小卡真的渲染出来了（布局单选框实得 ' + (primary && primary.cardRadios) + ' 个）')
  check(!!primary && primary.moduleRadios >= 3, 'C：那张小卡的选项列的是内置兜底名单（后端单选项实得 ' + (primary && primary.moduleRadios) + ' 个，应有 3 个）')
  check(!!primary && /GitHub/.test(primary.cardText || ''), 'C：那张小卡的选项里看得见 GitHub（实得文字里有 GitHub：' + /GitHub/.test((primary && primary.cardText) || '') + '）')
  // 收起那颗上的字就是要人看见的那句话（取自真词条表，与界面同源）
  const live = await mountLive(code)
  const btn = live.container.querySelector('.dsws-banner-collapse')
  const wantLabel = live.dict['banner.foldShort'] || '收起'
  check(!!btn && String(btn.textContent || '') === wantLabel, 'C：横幅上那颗收起写着「' + wantLabel + '」（实得「' + (btn ? String(btn.textContent || '') : '没找到') + '」）')
  live.dispose()
}

console.log('')
console.log('== D 反证：把量到的东西做坏，C 里对应的那几条必须当场变红 ==')
{
  const code = fs.readFileSync(path.join(ROOT, 'package/lib/client.js'), 'utf8')
  // D1：给黄条整条挂上收起（模拟真机现场那一种「点一下黄条整条就没了」）
  const NEEDLE = "return h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, cursor: 'default' } }"
  check(code.indexOf(NEEDLE) >= 0, '反证 D1：能在产物里找到黄条那一处渲染（找不到就是这一道反证本身坏了）')
  const d1 = code.replace(NEEDLE, "return h('div', { className: 'dsws-banner warn', onClick: foldBanner, style: { margin: 0, maxWidth: 560, cursor: 'default' } }")
  check(d1 !== code, '反证 D1：改动落到了产物上')
  const rows1 = await runSweep(d1)
  const broken = rows1.filter((r) => (r.want === 'keep') && (r.banner === false || r.capsule === false))
  check(broken.length > 0, '反证 D1：黄条整条一旦可收起C 组当场变红（红的有：' + (broken.map((b) => b.label).join('、') || '一处都没有 —— 这一门量不住这个毛病') + '）')

  // D2：把「收起」上的字摘掉（还原成纯图形叉），C 组那条「写着收起」必须红
  const d2 = code.replace(/, h\('span',\s*\{\s*key:\s*'txt'\s*\},\s*tr\('banner\.foldShort'\)\)/g, '')
  check(d2 !== code, '反证 D2：能把收起上的字摘下来')
  const live2 = await mountLive(d2)
  const btn2 = live2.container.querySelector('.dsws-banner-collapse')
  const label2 = btn2 ? String(btn2.textContent || '') : '没找到'
  const want2 = live2.dict['banner.foldShort'] || '收起'
  check(label2 !== want2, '反证 D2：摘掉字之后那条断言当场变红（实得「' + label2 + '」，应有「' + want2 + '」）')
  live2.dispose()
}

console.log('')
console.log('共 ' + total + ' 项检查')
if (failed) { console.log('存在失败'); process.exit(1) }
console.log('全部通过')
// 显式收工：这一门每走一步都会挂一份真产物（里面带着 2 秒的定时器与 React 根），
//   自然等事件循环排空是等不干净的 —— 该收的都收了之后，这里直接退出。
process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
