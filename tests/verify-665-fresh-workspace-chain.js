// verify-665-fresh-workspace-chain.js — #665 验收：全新目录从蓝条走到注入，四条判据钉进门禁
// 这张票要的是「真机走一遍 + 四条判据进门禁」。本文件承担四条判据那一半：把那个闭包里真正会跑的
//   几个模块取出来，在同一个沙箱里让它们互相调用 —— 状态栏那条横幅（statusbar/bannerChain.js）、
//   状态栏后端与门控动作（statusbar/StatusBackend.js）、注入决策（kernel/prompts.js），
//   加上真的顺序清单（shared/tracker/guide-steps.js）、真的中英词表（kernel/locale-*.js）、
//   真的后端声明（host/tracker/backends/<id>/index.js 的 prompts 与 setupPrompt）。
//   喂一条按步骤推进的链快照，断言「今天出哪一条横幅 / 那颗按钮点下去给出去的是什么 / 有没有多给一个字」。
// 四条判据与钉它的行（#662 定版五点名要进门禁的四条）：
//   ① 门控只问后端         —— 第 1 组（点确认只定后端、不注入、不弹卡、不记布局 + 源码里那个窗没有布局单选）
//   ② 仓库就绪前不注入     —— 第 2 组（三种入口形态都 blocked、动作分发器也不许把键名当文案塞进去）
//   ③ 黄条等仓库就绪       —— 第 3 组（缺仓库时出的是仓库那一段；仓库绿了才轮到黄条；黄条只弹卡不注入）
//   ④ 安装按钮注入原话     —— 第 4 组（点一下注入的就是维护者那句原话，逐字）
// 另外第 5 组走反向（已经建好仓库、已经初始化过的目录：这几段都不出现、不重复注入）。
// 取源做法照 tests/verify-655-setup-layout.js（喂假状态、调真函数）与 tests/verify-663-banner-chain.js（沙箱拼闭包）。
// 用法: node tests/verify-665-fresh-workspace-chain.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const root = path.resolve(__dirname, '..')
let failed = false
let failedN = 0
let total = 0
const ok = (cond, msg) => { total++; if (cond) console.log('  PASS ' + msg); else { failed = true; failedN += 1; console.log('  FAIL ' + msg) } }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const url = (rel) => pathToFileURL(path.join(root, rel)).href

// 维护者 2026-09-19 给的那句原话（与 tests/verify-663-gh-install-inject.js 同源：那边单独钉这一句的来历，
//   这边钉「从蓝条走到这一步时点下去给的就是它」）。
const GH_INSTALL_ORIGINAL = '/wizard 帮用户安装gh cli 官方地址：https://cli.github.com/'
// #664 按规格删掉的初始化全文尾巴（正文里不许再出现这几段之一）。
const RETIRED_TAIL = [
  '若此目录还没有关联 GitHub 远端',
  '建仓成功并重查变绿后',
  '仓库还没就绪',
]
// 真词表：四个片段按 kernel/locale.js 的合并逻辑拼起来（与 verify-655 / verify-setup-describe 同口径）。
async function loadLocale() {
  const P = await import(url('src/client/kernel/locale-panel.js'))
  const F = await import(url('src/client/kernel/locale-flow.js'))
  const W = await import(url('src/client/kernel/locale-word.js'))
  const L = await import(url('src/client/kernel/locale-labels.js'))
  return {
    zh: Object.assign({}, P.L_PANEL.zh, F.L_FLOW.zh, W.L_WORD.zh, L.L_LABELS.zh),
    en: Object.assign({}, P.L_PANEL.en, F.L_FLOW.en, W.L_WORD.en, L.L_LABELS.en),
  }
}

// 后端声明：直接用宿主那几个后端模块里声明的 prompts 与 setupPrompt（真数据，不是替身）。
async function loadBackends() {
  const gh = await import(url('src/host/tracker/backends/github/index.js'))
  const md = await import(url('src/host/tracker/backends/markdown/index.js'))
  const pick = (m) => ({ id: m.id, label: m.label, setupPrompt: m.setupPrompt, prompts: m.prompts, capabilities: m.capabilities || {} })
  return {
    github: pick(gh.githubModule),
    markdown: pick(md.markdownModule),
    // GitLab 本轮整条不动（#661 第⑩条）：它的后端声明里没有可复用的模块对象（那个文件只导出工厂函数），
    // 所以这里只给一个带 id 的最小壳 —— 本门禁用它，只是为了确认「GitLab 那条链上没有仓库那一段」。
    gitlab: { id: 'gitlab', label: 'GitLab', setupPrompt: null, prompts: null, capabilities: {} },
  }
}

// —— 一个沙箱装上整条链：横幅 + 后端动作 + 注入决策，三处互相调用，闭包里的外部依赖按真形状顶替 ——
async function loadChain(locale, backends) {
  const guide = await import(url('src/shared/tracker/guide-steps.js'))
  const actions = await import(url('src/client/kernel/actions.js'))
  const seen = {
    injected: [],      // 真的写进会话的字（inject）
    logged: [],        // 落下的日志（level / event / fields）
    forms: [],         // 开出来的弹窗载荷
    flashed: [],       // 界面上闪过的话
    bound: [],         // 打给宿主的电话
    gateOpened: 0,     // 开过几次选后端窗
    layoutMemory: {},  // 按工作区记住的域文档布局（store-prefs.js 那两张函数的替身账本，2026-09-21 维护者拍板「记住」）
  }
  const backendMetaOf = function (st, bid) {
    const list = (st && Array.isArray(st.backendModules)) ? st.backendModules : []
    for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(bid)) return list[i] }
    return null
  }
  // 三个模块的真实文件文本拼在一起，装饰掉行首 export 后当同一个闭包求值（与 scripts/build.mjs 的拼法一致）。
  const body = read('src/client/kernel/prompts.js').replace(/^[ \t]*export[ \t]+/gm, '')
    + read('src/client/statusbar/StatusBackend.js').replace(/^[ \t]*export[ \t]+/gm, '')
    + read('src/client/statusbar/bannerChain.js').replace(/^[ \t]*export[ \t]+/gm, '')
  // 词表本身在生产里也住同一个闭包（kernel/locale.js 合并四个片段得到），这里照同一形状塞进去。
  const tail = '\n;const L = ' + JSON.stringify({ zh: locale.zh, en: locale.en }) + ';'
    + '\n;return {'
    + ' readSetupLayout: readSetupLayout, setupBlockedByGuide: setupBlockedByGuide, setupOrRepoPrompt: setupOrRepoPrompt,'
    + ' injectSetupDecision: injectSetupDecision, setupRunTextForClick: setupRunTextForClick,'
    + ' guideBannerStep: guideBannerStep, guideBannerParams: guideBannerParams, runGuideMissing: runGuideMissing,'
    + ' confirmStatusGate: confirmStatusGate, onStatusSetupInit: onStatusSetupInit, openStatusGate: openStatusGate,'
    + ' layoutRadios: layoutRadios, layoutSelectionOf: layoutSelectionOf, applyStatusSetupLayout: applyStatusSetupLayout }'
  // 沙箱里的「自由变量」只留这三个模块自己没有声明的那几样（声明过的一律用真身，不许顶替）：
  //   prompts.js 自己声明 promptLang / promptText / currentBackendId，StatusBackend 声明 tr 的调用方向，
  //   所以下表里没有它们 —— 顶上就是遮蔽真身，测出来的就不是真行为了。
  const sandbox = {
    inject: function (st, text) { seen.injected.push(String(text)) },
    emit: function () {},
    isEnabled: function () { return false },
    log: function (level, event, fields) { seen.logged.push({ level: level, event: event, fields: fields }) },
    console: { log: function () {}, warn: function () {}, error: function () {} },
    localeSvc: { getSnapshot: function () { return { active: 'zh' } } },
    moduleMetaOf: backendMetaOf,
    guideStepsFor: guide.guideStepsFor,
    guideStepDone: guide.guideStepDone,
    chainSteps: function (st) { return (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : [] },
    chainStep: function (st, id) {
      const list = (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : []
      for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(id)) return list[i] }
      return null
    },
    checkShowTitle: function (show, fallback) { return String((show && (show.title || show.fallback || show.desc)) || fallback || '') },
    installSkillsParams: function () { return { probeList: 'wayfinder', probeCount: '1' } },
    getCachedSelection: function () { return null },
    tr: function (key, params) {
      let s = (locale.zh && locale.zh[key] !== undefined) ? String(locale.zh[key]) : String(key)
      if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return (name in params) ? String(params[name]) : m })
      return s
    },
    labelOf: function (id) { return String(id) },
    firstBackendIdOf: function () { return 'github' },
    setCachedSelection: function (cwd, sel) { seen.bound.push({ cwd: cwd, selection: sel, kind: 'cache' }) },
    // 「按工作区记住的域文档布局」两张函数的替身：真身住在 kernel/store-prefs.js（那两张函数只管读写与校验，
    //   取值合法性由它们自己把关），本门禁量的是 StatusBackend 与 prompts.js 有没有照着用。
    getCachedSetupLayout: function (cwd) { return seen.layoutMemory[String(cwd || '')] || null },
    setCachedSetupLayout: function (cwd, v) { const s = String(v == null ? '' : v).toLowerCase(); if (s === 'single' || s === 'multi') seen.layoutMemory[String(cwd || '')] = s },
    setPresentationMap: function () {},
    flash: function (st, text) { seen.flashed.push(String(text)) },
    loadSnapshot: function () {},
    loadChain: function () {},
    host: { call: function (method, params) { seen.bound.push({ method: method, params: params }); return Promise.resolve({ ok: true }) } },
    openFormModal: function (st, payload, onSubmit) { seen.forms.push(payload) },
    openUrl: function () {},
    createActionDispatcher: actions.createActionDispatcher,
  }
  const names = Object.keys(sandbox)
  const factory = new Function(...names, body + tail)
  return { mod: factory.apply(null, names.map(function (n) { return sandbox[n] })), seen: seen, guide: guide, backends: backends }
}

// 链快照替身：只喂这一步「什么状态」；后端要的修复动作另行挂在某一步上。
const chainOf = (statusMap, actions) => ({
  steps: Object.keys(statusMap).map(function (id) {
    const it = { id: id, status: statusMap[id] }
    if (actions && actions[id]) it.actions = actions[id]
    return it
  }),
})
// 会话状态：后端 + 链快照 + 后端声明（形状与宿主转发来的 modules 元素一致）。
const stateOf = (chain, ctx) => {
  const o = ctx || {}
  const st = {
    cwd: '/w/fresh-demo',
    selection: o.backend === null ? { backendId: null } : ((o.backend === undefined) ? { backendId: null } : { backendId: o.backend, source: 'explicit' }),
    backendModules: [o.backends.github, o.backends.markdown, o.backends.gitlab],
    chainSnapshot: chain,
  }
  if (o.layout) st.setupLayout = o.layout
  return st
}
const bannerOf = (mod, st, gateOpen) => mod.guideBannerStep(st, !!gateOpen)

// 全新目录走到每一步时的链快照（自上而下就是那条链：gh 装 → 登录 → 仓库 → 初始化 → 技能）。
const STEP_CHAIN = {
  // 后端还没选定：链快照里一件事都没查到（真机此刻就是这样）。
  none: {},
  // gh cli 没装：它红着，后面几步还没轮到。
  noGh: { 'gh:installed': 'fail' },
  // 装了 gh、没登录。
  noAuth: { 'gh:installed': 'done', 'gh:authed': 'fail' },
  // 登录好了、还没有远端仓库（这一档下面挂那个两步建仓弹窗）。
  noRepo: { 'gh:installed': 'done', 'gh:authed': 'done', 'gh:remote': 'fail' },
  // 仓库建好了、工作区还没初始化。
  noSetup: { 'gh:installed': 'done', 'gh:authed': 'done', 'gh:remote': 'done', 'tracker:initialized': 'fail' },
  // 一路走到技能那一步。
  noSkills: { 'gh:installed': 'done', 'gh:authed': 'done', 'gh:remote': 'done', 'tracker:initialized': 'done', 'skill:wayfinder': 'fail' },
  // 已经建好仓库、已经初始化过（反向场景）。
  ready: { 'gh:installed': 'done', 'gh:authed': 'done', 'gh:remote': 'done', 'tracker:initialized': 'done', 'skill:wayfinder': 'done', 'skill:setup-matt-pocock-skills': 'done', 'skill:ask-matt': 'done' },
}

async function main() {
  const locale = await loadLocale()
  const backends = await loadBackends()
  const { mod, seen, guide } = await loadChain(locale, backends)
  const wizard = {
    type: 'wizard',
    label: { zh: '创建并发布', en: 'Create & publish' },
    steps: [{ title: { zh: '仓库信息' }, schema: [{ name: 'name', type: 'text' }] }, { title: { zh: '可见性' }, schema: [{ name: 'visibility', type: 'single' }] }],
    submitAction: { type: 'rpc', method: 'wf.initPublish', params: {} },
  }
  const clickAndCount = (st) => {
    const step = bannerOf(mod, st, false)
    if (!step) return { out: null, logs: [] }   // 没有横幅就没有那颗按钮可点
    const before = seen.logged.length
    const out = mod.runGuideMissing(st, step)
    const logs = seen.logged.slice(before).filter(function (l) { return l.event === 'guide.inject' })
    return { out: out, logs: logs }
  }

  console.log('== 判据①：门控只问后端（点确认只把后端定下来，不注入、不弹卡、不记布局）==')
  const gateSrc = read('src/client/statusbar/StatusBar.js')
  ok(gateSrc.indexOf('confirmGateStatus') >= 0, '门控那个窗的确认按钮确实接到 confirmStatusGate（读的是真产物那一份）')
  ok(gateSrc.indexOf("s.gateModalOpen && s.gateModalSource==='status'") >= 0, '门控窗的渲染分支还在（它不是凭空消失）')
  // 这个窗里只许有一组单选（后端那组）。渲染那段源码里 layoutRadios 不许出现 —— 出现了就是把布局那一问塞回门控窗。
  const gateBlock = gateSrc.slice(gateSrc.indexOf("gateModalOpen && s.gateModalSource==='status'"), gateSrc.indexOf('#663：这个窗里那组'))
  ok(gateBlock.indexOf('layoutRadios') < 0, '门控窗那段渲染里没有布局那组单选（只问后端）')
  ok((gateSrc.match(/layoutRadios\(s, h\)/g) || []).length === 1, '全文件里布局那组单选只剩一处（初始化那张小卡）')
  for (const backend of [null, 'markdown', 'gitlab']) {
    const st = stateOf(chainOf(STEP_CHAIN.noRepo, { 'gh:remote': [wizard] }), { backend: backend, backends: backends })
    st.gateModalOpen = true
    st.gateModalSource = 'status'
    st.gateSelected = backend || 'github'
    const before = seen.injected.length
    mod.confirmStatusGate(st)
    await new Promise((r) => setTimeout(r, 0))
    const tag = '门控确认（' + String(backend) + '）'
    ok(st.gateModalOpen === false, tag + '：窗关掉了')
    ok(seen.injected.length === before, tag + '：一个字的注入都没有（此前这里会顺手注入初始化长文）')
    ok(st.setupLayout === undefined && st.setupLayoutCardOpen !== true, tag + '：没顺手记布局、也没弹那张小卡')
    ok(st.setupPickLayout === undefined, tag + '：布局选项一个字都没被写进会话状态')
  }
  const boundMethods = seen.bound.filter(function (b) { return b.method }).map(function (b) { return b.method })
  ok(boundMethods.length > 0 && boundMethods.every(function (m) { return m === 'wf.bind' }), '这条路打给宿主的只有绑定那一通电话（实得 ' + JSON.stringify(boundMethods) + '）')

  console.log('== 判据②：仓库就绪前不注入（三种入口形态都挡住，动作分发器也不许把键名当文案塞进去）==')
  const entryForms = [
    { label: '能弹卡来的入口（allowCard:true）', opts: { allowCard: true } },
    { label: '只取决定的入口（injectNow:false, allowCard:true）', opts: { injectNow: false, allowCard: true } },
    { label: '拿不到卡的入口（不传 opts）', opts: undefined },
  ]
  for (const form of entryForms) {
    const st = stateOf(chainOf(STEP_CHAIN.noRepo, { 'gh:remote': [wizard] }), { backend: 'github', backends: backends })
    const before = seen.injected.length
    const kind = mod.injectSetupDecision(st, 'github', form.opts)
    ok(kind === 'blocked', '仓库没就绪 · ' + form.label + ' → 决定是「不注入」（实得 ' + kind + '）')
    ok(seen.injected.length === before, '仓库没就绪 · ' + form.label + ' → 一个字都没注入')
    ok(st.setupLayoutCardOpen !== true, '仓库没就绪 · ' + form.label + ' → 那张小卡也没开')
  }
  // 判据本身：读的是共享清单里标着 blocksSetup 的那一步，不是后端能力位。
  ok(mod.setupBlockedByGuide(stateOf(chainOf(STEP_CHAIN.noRepo), { backend: 'github', backends: backends }), 'github') === true, '判据：仓库那一步红着 → 挡住初始化')
  ok(mod.setupBlockedByGuide(stateOf(chainOf(STEP_CHAIN.noSetup), { backend: 'github', backends: backends }), 'github') === false, '判据：仓库那一步绿了 → 不挡')
  ok(mod.setupBlockedByGuide(stateOf(chainOf(STEP_CHAIN.noSetup), { backend: 'markdown', backends: backends }), 'markdown') === false, '判据：本地 Markdown 没有那一步 → 永远不挡')
  ok(guide.GUIDE_STEPS.filter(function (s) { return s.blocksSetup === true }).map(function (s) { return s.id }).join(',') === 'gh:remote', '清单里标着「挡住初始化」的只有「已关联 GitHub 仓库」那一步')
  // 检查页那颗「执行初始化」按钮：这一次确实什么都不该注入（返回 null），别落到「解析不出来就把键名原样注入」那条兜底上。
  const stClick = stateOf(chainOf(STEP_CHAIN.noRepo), { backend: 'github', backends: backends })
  ok(mod.setupRunTextForClick(stClick) === null, '检查页那颗按钮在仓库没就绪时拿到的决定是 null（这次就该一个字都不注入）')
  // 真跑一遍动作分发器：后端把键名当文案那种兜底，在「不注入」这一档必须被认出来是 null 而不是空串。
  const dispatched = []
  const dispatcher = (await import(url('src/client/kernel/actions.js'))).createActionDispatcher({
    inject: function (text) { dispatched.push(String(text)) },
    openUrl: function () {}, hostCall: function () { return Promise.resolve({ ok: true }) },
    renderForm: function () {}, refresh: function () {},
  })
  dispatcher.dispatch({ type: 'inject-prompt', prompt: null })
  ok(dispatched.indexOf('setupRun') < 0 && dispatched.length === 0, '分发器拿到 null 时一个字都不注入（键名 setupRun 不许当文案塞进会话）')

  console.log('== 判据③：黄条等仓库就绪（缺仓库时出的是仓库那一段，仓库绿了才轮到黄条）==')
  const stGateOff = stateOf(chainOf(STEP_CHAIN.none), { backends: backends })
  const gateStep = bannerOf(mod, stGateOff, true)
  ok(!!gateStep && gateStep.id === 'selection:backendSelected', '后端还没定 → 出的是蓝条那一步（实得 ' + (gateStep && gateStep.id) + '）')
  ok(!!gateStep && gateStep.banner.tone === 'info', '蓝条那一步的配色是 info')
  // 蓝条：这里还没有会话可注入，一个字都不许有；那颗按钮开的是选后端窗（真身 openStatusGate 就住在 StatusBackend 里）。
  const blueBefore = seen.injected.length
  const blueOut = mod.runGuideMissing(stGateOff, gateStep)
  ok(blueOut === 'action' && stGateOff.gateModalOpen === true && stGateOff.gateModalSource === 'status', '蓝条那颗按钮开的是选后端窗（不是往会话里写字）')
  ok(seen.injected.length === blueBefore, '蓝条这一步没有任何注入')
  // 装了 gh 的那一段：出的还是 gh 那一步（仓库那一段还没轮到）。
  const stNoRepo = stateOf(chainOf(STEP_CHAIN.noRepo, { 'gh:remote': [wizard] }), { backend: 'github', backends: backends })
  const repoStep = bannerOf(mod, stNoRepo, false)
  ok(!!repoStep && repoStep.id === 'gh:remote', '缺仓库时出的是「已关联 GitHub 仓库」那一步（实得 ' + (repoStep && repoStep.id) + '）')
  ok(!!repoStep && repoStep.banner.text === 'banner.repo' && repoStep.banner.btn === 'banner.repoBtn', '那一段用的是新加的那对词条键')
  ok(!!repoStep && repoStep.banner.text !== 'banner.setup', '此刻出的不是「该工作区尚未初始化」那条黄条')
  // 仓库那一段的按钮：开那个两步建仓弹窗，一个字都不注入。
  const beforeRepo = seen.injected.length
  const repoClick = clickAndCount(stNoRepo)
  await new Promise((r) => setTimeout(r, 0))
  ok(repoClick.out === 'action' && seen.forms.length === 1, '仓库那一段的按钮开的是那个弹窗（开出来 ' + seen.forms.length + ' 次）')
  ok(seen.forms[0] && seen.forms[0].type === 'wizard' && seen.forms[0].steps.length === 2 && seen.forms[0].submitAction.method === 'wf.initPublish', '开出来的是那个两步建仓弹窗，提交动作仍是 wf.initPublish')
  ok(seen.injected.length === beforeRepo, '仓库那一段也没有一个字被注入')
  ok(repoClick.logs.length === 1 && repoClick.logs[0].fields.step === 'gh:remote' && repoClick.logs[0].fields.outcome === 'action', '这一回在日志里记成「哪一步、给出去的是哪一类」（action）')
  // 仓库绿了：才轮到黄条。
  const stNoSetup = stateOf(chainOf(STEP_CHAIN.noSetup), { backend: 'github', backends: backends })
  const setupStep = bannerOf(mod, stNoSetup, false)
  ok(!!setupStep && setupStep.id === 'tracker:initialized', '仓库就绪后出的是初始化那一步（实得 ' + (setupStep && setupStep.id) + '）')
  ok(!!setupStep && setupStep.banner.text === 'banner.setup', '那一步的横幅就是「该工作区尚未初始化」黄条')
  // 黄条那颗按钮：布局没答过 → 只弹卡，不注入。
  const beforeCard = seen.injected.length
  const cardClick = clickAndCount(stNoSetup)
  ok(cardClick.out === 'action', '布局没答过 → 归到「交给弹窗那类端点动作」（实得 ' + cardClick.out + '）')
  ok(seen.injected.length === beforeCard, '这一刻一个字的注入都没有（只弹卡）')
  ok(stNoSetup.setupLayoutCardOpen === true, '那张布局小卡被要求打开（它渲染在黄条下面）')
  ok(cardClick.logs.length === 1 && cardClick.logs[0].fields.step === 'tracker:initialized' && cardClick.logs[0].fields.outcome === 'action', '这一回记成 action')

  console.log('== 判据④：安装按钮注入原话（缺 gh 那一步点一下给的就是维护者那句）==')
  const stNoGh = stateOf(chainOf(STEP_CHAIN.noGh), { backend: 'github', backends: backends })
  const ghStep = bannerOf(mod, stNoGh, false)
  ok(!!ghStep && ghStep.id === 'gh:installed', 'gh cli 没装 → 出的是 gh 那一步（实得 ' + (ghStep && ghStep.id) + '）')
  ok(!!ghStep && ghStep.missing.text === GH_INSTALL_ORIGINAL, '清单里那一步的注入文案逐字等于维护者给的那句原话')
  const beforeGh = seen.injected.length
  const ghClick = clickAndCount(stNoGh)
  ok(ghClick.out === 'text' && seen.injected.length === beforeGh + 1, '点一下恰好注入一次（实得 ' + (seen.injected.length - beforeGh) + ' 次）')
  ok(seen.injected[seen.injected.length - 1] === GH_INSTALL_ORIGINAL, '注入的正文逐字等于那句原话')
  ok(ghClick.logs.length === 1 && ghClick.logs[0].level === 'info' && ghClick.logs[0].fields.step === 'gh:installed' && ghClick.logs[0].fields.outcome === 'text', '这一回记成常驻日志：哪一步 + 给出去的是哪一类（text）')
  ok(Object.keys(ghClick.logs[0].fields).length === 2, '日志字段就这两个（不记注入正文、不记路径）')

  console.log('== 第 7 组：链快照里「没有」仓库那一行时，横幅不许跳到黄条（真机现场 2026-09-21）==')
  // 现场：全新空目录里选完 GitHub，宿主探测把「空目录」当成过期工作区、把客户端这一下选的后端也一并作废，
  //   于是后端链没组装，链快照里只剩这六行（.scratch/665-diag-bar.out 的读数）。
  const CHAIN_NO_REPO_ROW = { 'selection:backendSelected': 'current', 'tracker:initialized': 'current', 'skill:wayfinder': 'pending', 'skill:setup-matt-pocock-skills': 'pending', 'skill:ask-matt': 'pending', 'env:home': 'done' }
  const stNoRepoRow = stateOf(chainOf(CHAIN_NO_REPO_ROW), { backend: 'github', backends: backends })
  const noRowBanner = bannerOf(mod, stNoRepoRow, false)
  ok(noRowBanner === null, '仓库那一行不在快照里 → 横幅不许落到「该工作区尚未初始化」上（实得 ' + (noRowBanner && noRowBanner.id) + '）')
  ok(mod.setupBlockedByGuide(stNoRepoRow, 'github') === true, '同一份快照：那道「不注入」的阀门仍然是关着的（挡住初始化）')
  const beforeNoRow = seen.injected.length
  const noRowDecision = mod.injectSetupDecision(stNoRepoRow, 'github', { allowCard: true })
  ok(noRowDecision === 'blocked', '同一份快照：硬走一次决策也返回 blocked（实得 ' + noRowDecision + '）')
  ok(stNoRepoRow.setupLayoutCardOpen !== true, '同一份快照：连那张布局小卡都不开')
  ok(seen.injected.length === beforeNoRow, '同一份快照：一个字都不注入')
  // 不许误伤：本地 Markdown 的清单里本来就没有仓库那一步，黄条照旧出得来。
  const stMdNoRow = stateOf(chainOf({ 'tracker:initialized': 'current', 'skill:wayfinder': 'done', 'skill:setup-matt-pocock-skills': 'done', 'skill:ask-matt': 'done', 'env:home': 'done' }), { backend: 'markdown', backends: backends })
  const mdNoRowBanner = bannerOf(mod, stMdNoRow, false)
  ok(!!mdNoRowBanner && mdNoRowBanner.id === 'tracker:initialized', '本地 Markdown 不受这条守卫影响：黄条照出（实得 ' + (mdNoRowBanner && mdNoRowBanner.id) + '）')
  // 仓库那一行在、但红着时，出的仍然是仓库那一段（守卫不许把正常路径也挡掉）。
  const stRepoRow = stateOf(chainOf(STEP_CHAIN.noRepo, { 'gh:remote': [wizard] }), { backend: 'github', backends: backends })
  const repoRowBanner = bannerOf(mod, stRepoRow, false)
  ok(!!repoRowBanner && repoRowBanner.id === 'gh:remote', '仓库那一行在且没过 → 出的就是它（实得 ' + (repoRowBanner && repoRowBanner.id) + '）')

  console.log('== 第 5 组：黄条点一下先问布局（每次都问，卡上预选着上次那一项），卡上确认之后注入初始化全文 ==')
  const stFull = stateOf(chainOf(STEP_CHAIN.noSetup), { backend: 'github', backends: backends, layout: 'single' })
  const beforeClickInject = seen.injected.length
  const setupClick = clickAndCount(stFull)
  // 2026-09-21 维护者拍板（A）：黄条那颗按钮**每次都先问** —— 布局答过也照旧把卡弹出来（卡上预选着上次那一项），
  //   所以点这一下的归类是「开了张动作/小卡」，不是「注入了一段文案」；注入发生在卡上确认之后。
  ok(setupClick.out === 'action', '布局答过 → 点黄条归到「开了那张小卡」（实得 ' + setupClick.out + '）')
  ok(stFull.setupLayoutCardOpen === true, '布局答过 → 卡照样被要求打开（askLayout：看得见、随时能改）')
  ok(seen.injected.length === beforeClickInject, '点黄条这一下一个字都不注入（等用户在卡上确认）')
  ok(setupClick.logs.length === 1 && setupClick.logs[0].fields.outcome === 'action', '这一回记成 action')
  // 卡上确认（confirmStatusSetupPick 走的就是这两步：先把布局记进会话与本地缓存，再走同一个决策函数）
  mod.applyStatusSetupLayout(stFull, 'single')
  const confirmed = mod.injectSetupDecision(stFull, 'github', { allowCard: true })
  ok(confirmed === 'setup', '卡上确认之后 → 直接注入（实得 ' + confirmed + '）')
  const fullText = seen.injected[seen.injected.length - 1] || ''
  ok(fullText.indexOf('/setup-matt-pocock-skills') === 0, '注入的全文以那条命令开头')
  ok(fullText.indexOf('本次已选后端：GitHub。') >= 0, '全文里带着「本次已选后端：GitHub。」')
  ok(fullText.indexOf('single-context') >= 0, '全文里带着用户这次选的布局结论（single-context）')
  ok(seen.layoutMemory[stFull.cwd] === 'single', '卡上确认的那一项按工作区记住了（下一个会话直接用，不再问流程外的第二遍）')
  const foundRetired = RETIRED_TAIL.filter(function (frag) { return fullText.indexOf(frag) >= 0 })
  ok(foundTailOk(foundRetired), '全文里没有那段被删掉的重复与告诫' + (foundRetired.length ? '（多出：' + foundRetired.join('、') + '）' : ''))
  // 换个会话（同一工作区、本次会话没答过）：记住的那一份被直接用上，注入的仍是同一句结论
  const stNext = stateOf(chainOf(STEP_CHAIN.noSetup), { backend: 'github', backends: backends })
  ok(mod.readSetupLayout(stNext) === 'single', '同一个工作区的新会话：读到记住的那一份（single）')
  const nNext = seen.injected.length
  ok(mod.injectSetupDecision(stNext, 'github', { allowCard: true }) === 'setup', '新会话里检查页/切换那条路直接用记住的那份注入（不再问）')
  ok(seen.injected.length === nNext + 1 && seen.injected[seen.injected.length - 1].indexOf('single-context') >= 0, '新会话注入的也是同一句布局结论（single-context）')

  console.log('== 第 6 组：反向场景 —— 已经建好仓库、已经初始化过的目录：这几段都不出现、不重复注入 ==')
  const stReady = stateOf(chainOf(STEP_CHAIN.ready), { backend: 'github', backends: backends })
  ok(bannerOf(mod, stReady, false) === null, '链全绿 → 一条横幅都不出（黄条不出现、仓库那一段与蓝条也不出现）')
  const beforeReady = seen.injected.length
  const readyClick = clickAndCount(stReady)
  ok(readyClick.out === null && readyClick.logs.length === 0, '链全绿时没有横幅可点（也就没有日志、没有弹窗）')
  // 反向再加一道：即使有入口硬要在这里走一次决策，它也不往会话里写字。
  //   注意：这里要的是「这个工作区从没答过、也没记住过」那一档 —— 上一个 block 已经把 /w/fresh-demo 的
  //   答案按工作区记下了，所以这一档换一个从没出现过的目录来量（否则量到的是「记住过就照记住的来」）。
  const stReady2 = stateOf(chainOf(STEP_CHAIN.ready), { backend: 'github', backends: backends })
  stReady2.cwd = '/w/never-answered'
  ok(mod.readSetupLayout(stReady2) === null, '反向：这个目录从没答过也没记住过（确实是「未选定」那一档）')
  const readyDecision = mod.injectSetupDecision(stReady2, 'github', { allowCard: true })
  ok(readyDecision === 'setup-card', '反向：硬走一次决策，返回的是「先问」（实得 ' + readyDecision + '），不是自动注入')
  ok(stReady2.setupLayoutCardOpen === true, '反向：这一步开的是那张卡（等用户回答，不是自动写字）')
  ok(seen.injected.length === beforeReady, '反向：没有第二次注入（整轮下来会话里一个字都没多）')
  // 反向再确认一条：全绿之后不会再有「重建远端仓库」那一段被点开。
  const formsBefore = seen.forms.length
  ok(bannerOf(mod, stReady, false) === null && seen.forms.length === formsBefore, '反向：建仓弹窗也不会被再开一次')
  // 本地 Markdown 那条链：仓库那一段一个字都不插。
  const stMd = stateOf(chainOf(STEP_CHAIN.noSetup), { backend: 'markdown', backends: backends })
  const mdStep = bannerOf(mod, stMd, false)
  ok(!!mdStep && mdStep.id === 'tracker:initialized', '本地 Markdown 缺初始化 → 直接出黄条（它的清单里没有仓库那一段）')
  ok(guide.guideStepsFor('markdown').every(function (s) { return s.id !== 'gh:remote' }), 'Markdown 的清单里根本没有「已关联仓库」那一步')
  ok(guide.guideStepsFor('github').map(function (s) { return s.id }).join(' → ') === 'selection:backendSelected → gh:installed → gh:authed → gh:remote → tracker:initialized → skill:wayfinder', 'GitHub 那条链的顺序就是定版那一条（蓝条只问后端 → gh 装 → 登录 → 仓库 → 初始化 → 技能）')

  console.log('== 接线：双产物里真的带着这几处（改完没重新构建就会红在这）==')
  const clientBundle = read('client.js')
  const pkgBundle = read('package/lib/client.js')
  for (const pair of [['client.js', clientBundle], ['package/lib/client.js', pkgBundle]]) {
    ok(pair[1].indexOf('const guideBannerStep = function') >= 0, pair[0] + ' 里带着横幅那条链')
    ok(pair[1].indexOf("'guide.inject'") >= 0, pair[0] + ' 里带着那条常驻注入日志')
    ok(pair[1].indexOf(GH_INSTALL_ORIGINAL) >= 0, pair[0] + ' 里带着那句安装原话（缺 gh 时点一下给得出来）')
  }

  console.log(failed ? 'FAIL ' + total + ' 项检查里有 ' + failedN + ' 项未过' : 'PASS 全部 ' + total + ' 项检查通过')
  process.exit(failed ? 1 : 0)
}
// 退役文案检查的小帮手（单独写出来，方便失败信息读得懂）。
function foundTailOk(found) { return found.length === 0 }

main().catch(function (e) { console.error('RUNNER ERROR:', e); process.exit(1) })
