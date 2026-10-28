// verify-665-fresh-workspace-chain.ts — #665 验收：全新目录从蓝条走到注入，四条判据钉进门禁
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
// 用法: node --import ./scripts/ts-hook.mts tests/verify-665-fresh-workspace-chain.ts
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')
// 本文件选 compileFn 手法：这一段是把拼好的源码文本当函数体造沙箱函数，要传进去的名字本来就列在 names 数组里。
const { compileFn } = require('./lib/eval-probe.js')
// 取源走共用入口（#1207 立）：sourceText 给源码原文（按文本形状扫描用），spliceableJs 给
// 「可以直接当函数体求值」的 JavaScript 文本（.ts 会先按构建那份口径转译，引号与换行会被重排，
// 所以只扫关键字的判据用 sourceText、要拿去求值的用 spliceableJs，别混着用）。
const { sourceText, spliceableJs, sourcePath } = require('./lib/source-text.ts')
// #1292：要拼进沙箱的提示词数据生成物怎么取、不在时怎么生成，收在共用入口里（五份沙箱门禁共用）。
const { promptDataSpliceable } = require('./lib/prompt-data.ts')
// 中央时间真值：locale-flow.js 的界面文案改成按中央参数现算（提交 2d0a3f85）之后，真词表模块一加载就会用到
// SETTINGS_DEBUG_PUSH_WAIT_MS 等常量（模块作用域求值，import 时就炸）；改成先把 values.js 的数值导出
// 整批挂到 globalThis（裸标识符回落全局），以后再有新常量也不会当场 ReferenceError。
const centralTime = require('../src/shared/time-config/values.js')
for (const [k, v] of Object.entries(centralTime)) {
  if (typeof v === 'number' && globalThis[k] === undefined) globalThis[k] = v
}

const root = path.resolve(__dirname, '..')
let failed = false
let failedN = 0
let total = 0
const ok = (cond: unknown, msg: string) => { total++; if (cond) console.log('  PASS ' + msg); else { failed = true; failedN += 1; console.log('  FAIL ' + msg) } }
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')
const url = (rel: string): string => pathToFileURL(path.join(root, rel)).href

// 注入正文的金样（#1621 定稿：先确认 gh 装没装，再按结果分流。与 tests/verify-663-gh-install-inject.ts 同源：
//   那边单独钉这段文本本身，这边钉「从蓝条走到这一步时点下去给的就是它」；文案契约另见
//   tests/verify-1621-gh-missing-copy.ts）。旧话（维护者 2026-09-19 那句 /wizard 原话）已退役。
const GH_INSTALL_TEXT = [
  '确认 gh 安装状态：在 DSH 之外的终端执行 `gh --version`。',
  '有版本号输出：gh 已安装。无需重复安装。将 gh 所在目录加入 PATH，或设置本插件读取的 DSH_GH_PATH 为 gh 可执行文件的绝对路径，再重启 DSH Desktop；若该目录已在 PATH 中，直接重启 DSH Desktop。',
  '无版本号输出：该终端也无法执行 gh。检查 gh 的安装目录（Windows 默认：C:\\Program Files\\GitHub CLI\\gh.exe）；确认未安装后执行：/wizard 安装 gh CLI（官方地址：https://cli.github.com/）',
].join('\n')
// #664 按规格删掉的初始化全文尾巴（正文里不许再出现这几段之一）。
const RETIRED_TAIL = [
  '若此目录还没有关联 GitHub 远端',
  '建仓成功并重查变绿后',
  '仓库还没就绪',
]
// 词表是动态 import 进来的未标注模块：只收中英两套键值表，其余形状不约束。
interface LocalePair { zh: Record<string, string>; en: Record<string, string> }
// 真词表：各族词条取自同一份生成物并按旧合并逻辑拼起来（与 verify-655 / verify-setup-describe 同口径）。
// #1294：旧片段路径经 tests/lib/source-text.ts 的 sourcePath 映射到 src/client/kernel/locale-data.ts。
async function loadLocale(): Promise<LocalePair> {
  const locUrl = (f: string) => url(sourcePath(f))
  const P = await import(locUrl('src/client/kernel/locale-panel.js'))
  const F = await import(locUrl('src/client/kernel/locale-flow.js'))
  const W = await import(locUrl('src/client/kernel/locale-word.js'))
  // #698：布局那一问的四条键（问题、两个选项、两条结论句）搬去了 locale-pages 族（locale-panel 贴着 350 行上限）
  const L = await import(locUrl('src/client/kernel/locale-labels.js'))
  const PG = await import(locUrl('src/client/kernel/locale-pages.js'))
  return {
    zh: Object.assign({}, P.L_PANEL.zh, F.L_FLOW.zh, W.L_WORD.zh, L.L_LABELS.zh, PG.L_PAGES.zh),
    en: Object.assign({}, P.L_PANEL.en, F.L_FLOW.en, W.L_WORD.en, L.L_LABELS.en, PG.L_PAGES.en),
  }
}

// 后端声明三件套：github 与 markdown 取真模块的子集，gitlab 本轮只给最小壳（形状在 loadBackends 里定）。
interface BackendPick {
  id: string
  label?: unknown
  setupPrompt: unknown
  prompts: unknown
  capabilities: Record<string, unknown>
}
// 后端声明：直接用宿主那几个后端模块里声明的 prompts 与 setupPrompt（真数据，不是替身）。
async function loadBackends(): Promise<{ github: BackendPick; markdown: BackendPick; gitlab: BackendPick }> {
  const gh = await import(url('src/tracker/rooms/github/index.ts'))
  const md = await import(url('src/tracker/rooms/markdown/index.ts'))
  const pick = (m: any): BackendPick => ({ id: m.id, label: m.label, setupPrompt: m.setupPrompt, prompts: m.prompts, capabilities: m.capabilities || {} })
  return {
    github: pick(gh.githubModule),
    markdown: pick(md.markdownModule),
    // GitLab 本轮整条不动（#661 第⑩条）：它的后端声明里没有可复用的模块对象（那个文件只导出工厂函数），
    // 所以这里只给一个带 id 的最小壳 —— 本门禁用它，只是为了确认「GitLab 那条链上没有仓库那一段」。
    gitlab: { id: 'gitlab', label: 'GitLab', setupPrompt: null, prompts: null, capabilities: {} },
  }
}
// 沙箱账本：跨组累积（injected/forms/logged/bound），组顺序不许重排，重排会改计数。
// #1449：布局不再按工作区写浏览器本地表，账本里那本 layoutMemory 一并撤掉；新会话的布局只从快照回包来。
interface ChainSeen {
  injected: string[]
  logged: Array<{ level: string; event: string; fields: Record<string, any> }>
  forms: any[]
  flashed: string[]
  bound: any[]
  gateOpened: number
}
// #1292：提示词数据（PROMPTS 那张表与词表默认值）的真身搬进了 config/prompts/ 下的 YAML，
//   客户端里那几张表由 scripts/generate-prompt-config.mts 现场生成到 src/client/kernel/prompt-data.ts，
//   构建时把这份生成物拼在 prompts.js 前面（scripts/build.mts 的 KERNEL_MODULES 顺序：promptData → prompts）。
//   沙箱要照同一顺序拼：少了它，prompts.js 里那行 `const PROMPTS = PROMPT_TEMPLATE_DATA` 求值时
//   PROMPT_TEMPLATE_DATA 还不存在，当场 ReferenceError，整扇门禁一条断言都跑不到。
//   生成物不在盘上时现场生成一份 —— 这件事收在 tests/lib/prompt-data.ts，五份沙箱门禁共用那一处。
function promptDataSplice(): string {
  return promptDataSpliceable(root)
}

// —— 一个沙箱装上整条链：横幅 + 后端动作 + 注入决策，三处互相调用，闭包里的外部依赖按真形状顶替 ——
async function loadChain(locale: LocalePair, backends: { github: BackendPick; markdown: BackendPick; gitlab: BackendPick }, sbPatch?: { text: string }): Promise<{ mod: any; seen: ChainSeen; guide: any; backends: { github: BackendPick; markdown: BackendPick; gitlab: BackendPick } }> {
  const guide = await import(url('src/shared/tracker/guide-steps.js'))
  const actions = await import(url('src/client/kernel/actions.js'))
  const seen: ChainSeen = {
    injected: [],      // 真的写进会话的字（inject）
    logged: [],        // 落下的日志（level / event / fields）
    forms: [],         // 开出来的弹窗载荷
    flashed: [],       // 界面上闪过的话
    bound: [],         // 打给宿主的电话
    gateOpened: 0,     // 开过几次选后端窗
  }
  const backendMetaOf = function (st: any, bid: any) {
    const list = (st && Array.isArray(st.backendModules)) ? st.backendModules : []
    for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(bid)) return list[i] }
    return null
  }
  // 三个模块的真实文件文本拼在一起，装饰掉行首 export 后当同一个闭包求值（与 scripts/build.mts 的拼法一致）。
  //   #698：注入决策那一段（injectSetupDecision / layoutCardShouldOpen）搬去了 kernel/prompts-setup.js，
  //   构建时与 prompts.js 拼回同一个闭包；沙箱里照同一口径把它接在 prompts.js 后面。
  // #1292：提示词数据那一份生成物照构建的顺序接在最前面（promptData → prompts → promptsSetup → …），
  //   否则 prompts.js 里那行 `const PROMPTS = PROMPT_TEMPLATE_DATA` 求值时 PROMPT_TEMPLATE_DATA 还不存在。
  // #1294：词表真源搬到 config/copy/*.yaml 后，生成物 locale-data.ts 与取词助手 locale.ts 也要按构建顺序
  //   （localeData → locale → promptData → prompts）先于 prompts.js 进闭包；tail 里原来那份
  //   `const L = <dict>` 由 locale.ts 的真 L 取代，这里不再重复声明。
  // 这四份真源都已经是 .ts，要拼成同一个函数体求值，所以一律走 spliceableJs（与构建同一份转译口径，
  //   它已剥掉每行行首的 export）；末尾那一遍剥 export 只是防御，不改变任何一份片段的语义。
  const body = (spliceableJs('src/client/kernel/locale-data.ts')
    + '\n' + spliceableJs('src/client/kernel/locale.js')
    + '\n' + promptDataSplice()
    + '\n' + spliceableJs('src/client/kernel/prompts.js')
    + '\n' + spliceableJs('src/client/kernel/prompts-setup.js')
    // sbPatch：反证用 —— 把 StatusBackend 的真源按改动后的文本喂进来（正常路径下就是真源本身）
    + '\n' + ((sbPatch && sbPatch.text) ? sbPatch.text : spliceableJs('src/client/statusbar/StatusBackend.js'))
    + '\n' + spliceableJs('src/client/statusbar/bannerChain.js'))
    .replace(/^[ \t]*export[ \t]+/gm, '')
  // 词表本身在生产里也住同一个闭包（由 locale-data 与 locale.ts 提供，见上面 #1294 注释）。
  const tail = '\n;return {'
    + ' readSetupLayout: readSetupLayout, setupBlockedByGuide: setupBlockedByGuide, setupOrRepoPrompt: setupOrRepoPrompt,'
    + ' injectSetupDecision: injectSetupDecision, setupRunTextForClick: setupRunTextForClick,'
    + ' guideBannerStep: guideBannerStep, guideBannerParams: guideBannerParams, runGuideMissing: runGuideMissing,'
    + ' confirmStatusGate: confirmStatusGate, onStatusSetupInit: onStatusSetupInit, openStatusGate: openStatusGate,'
    + ' layoutRadios: layoutRadios, layoutSelectionOf: layoutSelectionOf, applyStatusSetupLayout: applyStatusSetupLayout }'
  // 沙箱里的「自由变量」只留这三个模块自己没有声明的那几样（声明过的一律用真身，不许顶替）：
  //   prompts.js 自己声明 promptLang / promptText / currentBackendId，StatusBackend 声明 tr 的调用方向，
  //   所以下表里没有它们 —— 顶上就是遮蔽真身，测出来的就不是真行为了。
  const sandbox = {
    // #1342：StatusBackend 的布局取值名单由构建从共享真源 src/shared/doc-layout 拼进闭包，
    //   这里把几份真源当同一个函数体求值，所以按真值顶一份（取值本身由 verify-655 与 verify-683 把着）。
    DOC_LAYOUT_VALUES: ['single', 'multi'],
    inject: function (st: any, text: any) { seen.injected.push(String(text)) },
    emit: function () {},
    isEnabled: function () { return false },
    log: function (level: string, event: string, fields: Record<string, any>) { seen.logged.push({ level: level, event: event, fields: fields }) },
    console: { log: function () {}, warn: function () {}, error: function () {} },
    localeSvc: { getSnapshot: function () { return { active: 'zh' } } },
    moduleMetaOf: backendMetaOf,
    guideStepsFor: guide.guideStepsFor,
    guideStepDone: guide.guideStepDone,
    chainSteps: function (st: any) { return (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : [] },
    chainStep: function (st: any, id: string) {
      const list = (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : []
      for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(id)) return list[i] }
      return null
    },
    checkShowTitle: function (show: any, fallback: string) { return String((show && (show.title || show.fallback || show.desc)) || fallback || '') },
    installSkillsParams: function () { return { probeList: 'wayfinder', probeCount: '1' } },
    getCachedSelection: function () { return null },
    tr: function (key: string, params: any) {
      let s = (locale.zh && locale.zh[key] !== undefined) ? String(locale.zh[key]) : String(key)
      if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return (name in params) ? String(params[name]) : m })
      return s
    },
    labelOf: function (id: any) { return String(id) },
    firstBackendIdOf: function () { return 'github' },
    setCachedSelection: function (cwd: any, sel: any) { seen.bound.push({ cwd: cwd, selection: sel, kind: 'cache' }) },
    // #1449：布局不再走浏览器本地表，那两个替身（getCachedSetupLayout / setCachedSetupLayout）一并撤掉；
    //   工作区那份答案只从快照回包（st.snapshot.setupLayout）来，会话本次选择住 st.setupLayout。
    setPresentationMap: function () {},
    flash: function (st: any, text: any) { seen.flashed.push(String(text)) },
    loadSnapshot: function () {},
    loadChain: function () {},
    host: { call: function (method: string, params: unknown) { seen.bound.push({ method: method, params: params }); return Promise.resolve({ ok: true }) } },
    openFormModal: function (st: any, payload: any, onSubmit: any) { seen.forms.push(payload) },
    openUrl: function () {},
    createActionDispatcher: actions.createActionDispatcher,
  }
  const names = Object.keys(sandbox)
  // 本处走 compileFn：参数名与参数值都来自同一个 names 数组，展开传法与原来一致。
  const factory = compileFn(names, body + tail)
  return { mod: factory.apply(null, names.map(function (n) { return (sandbox as Record<string, any>)[n] })), seen: seen, guide: guide, backends: backends }
}

// 快照行是按 id 挂修复动作的散表：值只有状态字，动作另挂。
// 链快照替身：只喂这一步「什么状态」；后端要的修复动作另行挂在某一步上。
const chainOf = (statusMap: Record<string, string>, actions?: Record<string, unknown>) => ({
  steps: Object.keys(statusMap).map(function (id) {
    const it: { id: string; status: string; actions?: unknown } = { id: id, status: statusMap[id] }
    if (actions && actions[id]) it.actions = actions[id]
    return it
  }),
})
// 会话状态是喂给真函数的形状：只保证后端 / 链快照 / 后端声明三维齐，用 any 承载（测试桩，不进类型注册表）。
const stateOf = (chain: any, ctx: any): any => {
  const o = ctx || {}
  const st: any = {
    cwd: '/w/fresh-demo',
    selection: o.backend === null ? { backendId: null } : ((o.backend === undefined) ? { backendId: null } : { backendId: o.backend, source: 'explicit' }),
    backendModules: [o.backends.github, o.backends.markdown, o.backends.gitlab],
    chainSnapshot: chain,
  }
  if (o.layout) st.setupLayout = o.layout
  return st
}
const bannerOf = (mod: any, st: any, gateOpen: boolean) => mod.guideBannerStep(st, !!gateOpen)

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
  const clickAndCount = (st: any) => {
    const step = bannerOf(mod, st, false)
    if (!step) return { out: null, logs: [] }   // 没有横幅就没有那颗按钮可点
    const before = seen.logged.length
    const out = mod.runGuideMissing(st, step)
    const logs = seen.logged.slice(before).filter(function (l) { return l.event === 'guide.inject' })
    return { out: out, logs: logs }
  }

  console.log('== 判据①：门控只问后端（点确认只把后端定下来，不注入、不弹卡、不记布局）==')
  // 【已删除】原先这里读 StatusBar.js 与 views/SetupCard.js 的源码文本，断言确认按钮接着 confirmStatusGate、
  //   门控窗那段渲染分支还在、那段里不出现 layoutRadios、以及整组单选在 SetupCard.js 里正好一处、状态栏里零处。
  //   断言对象都是手写源码的文本（改个写法、挪个位置、换个行数就变红），整段撤掉；
  //   这一组的实质结论由下面这圈真状态驱动的确认动作守着。
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
  // #1190：两家后端各一步挡初始化（gh:remote 只适用 github、glab:repoAccess 只适用 gitlab），合在一起是两步。
  ok(guide.GUIDE_STEPS.filter(function (s: any) { return s.blocksSetup === true }).map(function (s: any) { return s.id }).join(',') === 'gh:remote,glab:repoAccess', '清单里标着「挡住初始化」的是两家后端的仓库步骤（gh:remote、glab:repoAccess）')
  // 检查页那颗「执行初始化」按钮：这一次确实什么都不该注入（返回 null），别落到「解析不出来就把键名原样注入」那条兜底上。
  const stClick = stateOf(chainOf(STEP_CHAIN.noRepo), { backend: 'github', backends: backends })
  ok(mod.setupRunTextForClick(stClick) === null, '检查页那颗按钮在仓库没就绪时拿到的决定是 null（这次就该一个字都不注入）')
  // 真跑一遍动作分发器：后端把键名当文案那种兜底，在「不注入」这一档必须被认出来是 null 而不是空串。
  const dispatched: string[] = []
  const dispatcher = (await import(url('src/client/kernel/actions.js'))).createActionDispatcher({
    inject: function (text: any) { dispatched.push(String(text)) },
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

  console.log('== 判据④：安装按钮注入排查/安装指引（缺 gh 那一步点一下给的就是后端声明那份）==')
  const stNoGh = stateOf(chainOf(STEP_CHAIN.noGh), { backend: 'github', backends: backends })
  const ghStep = bannerOf(mod, stNoGh, false)
  ok(!!ghStep && ghStep.id === 'gh:installed', 'gh cli 没装 → 出的是 gh 那一步（实得 ' + (ghStep && ghStep.id) + '）')
  // #716 起的现状：这句话不再写死在共享清单里（清单是三个后端共用的文件，装 CLI 的地址与名字跟具体后端
  //   有关），清单只声明「按哪条提示词键注入」（missing.prompt = cliInstall），文本住在后端声明里。
  //   所以这一条量的是**清单声明的那条键**；那句话本身逐字对不对，由下面那一下真点击量（注入的正文）。
  ok(!!ghStep && ghStep.missing && ghStep.missing.prompt === 'cliInstall', '清单里那一步声明的是「按后端声明的那条 cliInstall 提示词注入」（实得 ' + JSON.stringify(ghStep && ghStep.missing) + '）')
  const beforeGh = seen.injected.length
  const ghClick = clickAndCount(stNoGh)
  ok(ghClick.out === 'text' && seen.injected.length === beforeGh + 1, '点一下恰好注入一次（实得 ' + (seen.injected.length - beforeGh) + ' 次）')
  ok(seen.injected[seen.injected.length - 1] === GH_INSTALL_TEXT, '注入的正文逐字等于后端声明里那份指引（金样）')
  ok(ghClick.logs.length === 1 && ghClick.logs[0].level === 'info' && ghClick.logs[0].fields.step === 'gh:installed' && ghClick.logs[0].fields.outcome === 'text', '这一回记成常驻日志：哪一步 + 给出去的是哪一类（text）')
  ok(Object.keys(ghClick.logs[0].fields).length === 2, '日志字段就这两个（不记注入正文、不记路径）')

  console.log('== 第 7 组：链快照里「没有」仓库那一行时，既不跳到黄条、也不静默（#661 / #1363）==')
  // 现场：全新空目录里选完 GitHub，宿主探测把「空目录」当成过期工作区、把客户端这一下选的后端也一并作废，
  //   于是后端链没组装，链快照里只剩这六行（.scratch/665-diag-bar.out 的读数）。
  const CHAIN_NO_REPO_ROW = { 'selection:backendSelected': 'current', 'tracker:initialized': 'current', 'skill:wayfinder': 'pending', 'skill:setup-matt-pocock-skills': 'pending', 'skill:ask-matt': 'pending', 'env:home': 'done' }
  const stNoRepoRow = stateOf(chainOf(CHAIN_NO_REPO_ROW), { backend: 'github', backends: backends })
  const noRowBanner = bannerOf(mod, stNoRepoRow, false)
  // #1363 场景一：从前这里一条横幅都不出（人不知道下一步做什么、也分不清「还没查到」与「确实没有」）。
  //   现在快照里有别的行、偏偏缺这条挡路的行时，出的是那条中性兜底（点一下走重查），不再是「尚未初始化」黄条。
  ok(!!noRowBanner && noRowBanner.id === 'chain:unread', '仓库那一行不在快照里 → 出的是中性兜底那一条、不是「该工作区尚未初始化」黄条（实得 ' + (noRowBanner && noRowBanner.id) + '）')
  const noRowMeta = (typeof mod.guideBannerMeta === 'function') ? mod.guideBannerMeta(stNoRepoRow, noRowBanner) : (noRowBanner && noRowBanner.banner)
  ok(!!noRowMeta && noRowMeta.text === 'banner.chainUnread', '中性兜底用的是新加的那对词条键（实得 ' + (noRowMeta && noRowMeta.text) + '）')
  ok(!!noRowBanner && !!noRowBanner.missing && noRowBanner.missing.type === 'recheck', '中性兜底的按钮走既有的重查那一路（人亲手点的那次永不降档）')
  // 快照里一行都没有（读数还没到）时仍然安静等着，不许提前出任何横幅（#661 第④条）。
  const stNoSnapshot = stateOf({ steps: [] }, { backend: 'github', backends: backends })
  ok(bannerOf(mod, stNoSnapshot, false) === null, '快照一行都还没有 → 仍然安静等着，不出横幅')
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
  ok(stFull.setupLayout === 'single', '卡上确认的那一项只记在本次会话里（不再写浏览器本地表；工作区那份真源由宿主写文件、随快照回包）')
  const foundRetired = RETIRED_TAIL.filter(function (frag) { return fullText.indexOf(frag) >= 0 })
  ok(foundTailOk(foundRetired), '全文里没有那段被删掉的重复与告诫' + (foundRetired.length ? '（多出：' + foundRetired.join('、') + '）' : ''))
  // 换个会话（同一工作区、本次会话没答过）：宿主快照回包里带着工作区文件里那份答案，直接用它，注入的仍是同一句结论
  const stNext = stateOf(chainOf(STEP_CHAIN.noSetup), { backend: 'github', backends: backends })
  stNext.snapshot = { setupLayout: { layout: 'single', pickedAt: 0 } }
  ok(mod.readSetupLayout(stNext) === 'single', '同一个工作区的新会话：读到快照回包里的那份答案（single）')
  // 卡上「换一个选项」必须当场生效（2026-09-25 真机上报：记住过答案之后，卡上另一个选项点不动 ——
  //   原因是卡片预选读的是「记住的那一份」并且排在用户刚点的那一下前面，于是刚点的立刻被按回去）。
  const stEdit = stateOf(chainOf(STEP_CHAIN.noSetup), { backend: 'github', backends: backends })
  stEdit.cwd = '/w/pick-edit'
  stEdit.snapshot = { setupLayout: { layout: 'single', pickedAt: 0 } } // 这个工作区之前答过 single（快照回包带着它）
  stEdit.setupLayoutCardOpen = true            // 卡开着
  ok(mod.layoutSelectionOf(stEdit) === 'single', '卡刚打开：预选的是快照里那一项（single）')
  stEdit.setupPickLayout = 'multi'             // 用户在卡上点了另一个选项
  ok(mod.layoutSelectionOf(stEdit) === 'multi', '用户在卡上点了另一项 → 当场就选成那一项（记住的那份不许把它按回去）')
  mod.applyStatusSetupLayout(stEdit, mod.layoutSelectionOf(stEdit)) // 卡上「确认并继续」
  ok(stEdit.setupLayout === 'multi', '卡上确认 → 会话里改成用户刚选的那一项（multi；工作区文件由宿主去写，下一份快照再回来）')
  const textEdited = mod.setupOrRepoPrompt(stEdit, 'github').text || ''
  ok(textEdited.indexOf('multi-context') >= 0, '注入的全文跟着换成「多上下文」那一句结论（不是记住的旧答案）')
  // 反证：把「卡片开着时以卡上刚点的那一下为准」这一段从待求值的文本里拆掉，上面三条必须当场变红
  //   （这个 bug 就是这么进来的：1.7.25 让卡片预选去读「记住的那一份」，却没把它排在用户刚点的那一下后面）。
  //   要找的那一段在两种排法里都写得出来（手写原文挤成一行、esbuild 交出来的是多行），所以两边都先把
  //   空白抹平、并允许把 if(...) 那层括号拆成 `if ...`，再按抹平后的形状找下标、把下标换回原文去切片。
  //   拆下来的是待求值的那份文本（spliceableJs 的输出）：拆完要能直接喂进沙箱。
  //   找不到那段就原样返回，下面那圈静默跳过、不当场判红（以源码文本形状为对象的断言早先已按维护者口径整段删除）。
  // flatten 把两边拉到同一个形状再比：去空白、去分号（转译必加分号，真源里可写可不写，#1372）、
  //   把 if( 那层括号拆成 if 。锚点与下标换算两边都按同一个「保留字符」口径数。
  const flatten = (t: string) => t.replace(/if\s*\(/g, 'if ').replace(/;/g, '').replace(/\s+/g, '')
  // 保留字符：flatten 之后还留着的字符。下面两个循环都按这个口径数，不然一定对不上。
  //   注意 flatten 的第一步会吃掉 if 后面的左括号（/if\\s*\\(/ 整个换成 if 再去空白），
  //   所以这里同样跳过「if（中间可隔空白）后面的那个左括号」；只跳空白与分号是不够的，
  //   每遇到一个 if ( 就会差一个字符（#1372 修第二遍时亲手量出来的 drift）。
  // 注：下面闭包里读到的 sbJs 在后面一行才定义，调用时它已经就绪（调用都在 if (foundAnchor) 里）。
  const droppedParenAt = (i: number): boolean => {
    if (sbJs[i] !== '(') return false
    let j = i - 1
    while (j >= 0 && /\s/.test(sbJs[j])) j--
    return j >= 1 && sbJs[j - 1] === 'i' && sbJs[j] === 'f'
  }
  const keptCharAt = (i: number): boolean => {
    const c = sbJs[i]
    if (/\s/.test(c) || c === ';') return false
    return !droppedParenAt(i)
  }
  const flatAnchor = flatten('try{ if(s&&s.setupLayoutCardOpen===true){ const p=inCard(); if(p) return p } }catch(e){}')
  const foundAnchor = flatten(sourceText('src/client/statusbar/StatusBackend.js')).indexOf(flatAnchor) >= 0
  const sbJs = spliceableJs('src/client/statusbar/StatusBackend.js')
  let brokenText = sbJs
  if (foundAnchor) {
    const flatSb = flatten(sbJs)
    // 按「抹平后第 atAnchor 个保留字符」换回 sbJs 的下标（flatten 只删除空白与分号、替换 `if (`，不改保留字符的先后）。
    const atAnchor = flatSb.indexOf(flatAnchor)
    if (atAnchor < 0) {
      // 真源里找得到、待求值文本里找不到：两边排法没对上，反证没跑。必须当场变红，
      // 不许静默跳过（静默跳过就是 #1372：三条反证断言一次都不执行，门禁照绿）。
      ok(false, '反证没跑：锚点在真源里找得到，在待求值文本里找不到（两边排法没对上），先修锚点再谈反证')
    }
    let origAt = -1
    let kept = 0
    for (let i = 0; i < sbJs.length; i++) {
      if (!keptCharAt(i)) continue
      if (kept === atAnchor) { origAt = i; break }
      kept++
    }
    if (origAt >= 0) {
      // 终点：从 origAt 起数够「抹平后模板那一段」的保留字符数。
      const want = flatAnchor.length
      let seenCount = 0
      let end = origAt
      while (end < sbJs.length && seenCount < want) {
        if (keptCharAt(end)) seenCount++
        end++
      }
      brokenText = sbJs.slice(0, origAt) + sbJs.slice(end)
    } else if (atAnchor >= 0) {
      // 锚点找得到却换不回下标：映射口径 drift，同样当场变红，不许静默跳过。
      ok(false, '反证没跑：锚点在待求值文本里找得到，却换不回原文下标（映射口径 drift），先修映射再谈反证')
    }
  }
  // 【已删除】原先这里有一条 ok(brokenText !== sbText, '反证：能在真源里拆掉…')——它断言的是手写源码里必须
  //   出现上面那段字符串，属于以源码文本为对象的门禁，撤掉。下面这圈「把那一段拆掉再跑一遍」的变异试验
  //   本身是抠真源出来执行（HYBRID，口径要求保留），所以这个 if 判断留着：源码里没有这段可拆时，
  //   这一圈静默跳过，不当场变红。
  if (brokenText !== sbJs) {
    const brokenChain = await loadChain(locale, backends, { text: brokenText })
    const stBroken = stateOf(chainOf(STEP_CHAIN.noSetup), { backend: 'github', backends: backends })
    stBroken.cwd = '/w/pick-edit'
    stBroken.snapshot = { setupLayout: { layout: 'single', pickedAt: 0 } }
    stBroken.setupLayoutCardOpen = true
    stBroken.setupPickLayout = 'multi'
    ok(brokenChain.mod.layoutSelectionOf(stBroken) !== 'multi', '反证成立：拆掉之后，卡上刚点的另一项被记住的那份按了回去（实得 ' + brokenChain.mod.layoutSelectionOf(stBroken) + '）—— 正是真机上报的「点不动」')
  }
  const nNext = seen.injected.length
  ok(mod.injectSetupDecision(stNext, 'github', { allowCard: true }) === 'setup', '新会话里检查页/切换那条路直接用快照那份注入（不再问）')
  ok(seen.injected.length === nNext + 1 && seen.injected[seen.injected.length - 1].indexOf('single-context') >= 0, '新会话注入的也是同一句布局结论（single-context）')

  console.log('== 第 6 组：反向场景 —— 已经建好仓库、已经初始化过的目录：这几段都不出现、不重复注入 ==')
  const stReady = stateOf(chainOf(STEP_CHAIN.ready), { backend: 'github', backends: backends })
  ok(bannerOf(mod, stReady, false) === null, '链全绿 → 一条横幅都不出（黄条不出现、仓库那一段与蓝条也不出现）')
  const beforeReady = seen.injected.length
  const readyClick = clickAndCount(stReady)
  ok(readyClick.out === null && readyClick.logs.length === 0, '链全绿时没有横幅可点（也就没有日志、没有弹窗）')
  // 反向再加一道：即使有入口硬要在这里走一次决策，它也不往会话里写字。
  //   注意：这里要的是「这个工作区从没答过、快照里也没有」那一档 —— 上一组已经把答案记进了快照，
  //   所以这一档换一个从没出现过的目录来量（否则量到的是「快照里有就照快照的来」）。
  const stReady2 = stateOf(chainOf(STEP_CHAIN.ready), { backend: 'github', backends: backends })
  stReady2.cwd = '/w/never-answered'
  ok(mod.readSetupLayout(stReady2) === null, '反向：这个目录从没答过、快照里也没有（确实是「未选定」那一档）')
  const readyDecision = mod.injectSetupDecision(stReady2, 'github', { allowCard: true })
  ok(readyDecision === 'askLayout', '反向：硬走一次决策，返回的是「先问」（实得 ' + readyDecision + '），不是自动注入')
  ok(stReady2.setupLayoutCardOpen === true, '反向：这一步开的是那张卡（等用户回答，不是自动写字）')
  ok(seen.injected.length === beforeReady, '反向：没有第二次注入（整轮下来会话里一个字都没多）')
  // 反向再确认一条：全绿之后不会再有「重建远端仓库」那一段被点开。
  const formsBefore = seen.forms.length
  ok(bannerOf(mod, stReady, false) === null && seen.forms.length === formsBefore, '反向：建仓弹窗也不会被再开一次')
  // 本地 Markdown 那条链：仓库那一段一个字都不插。
  const stMd = stateOf(chainOf(STEP_CHAIN.noSetup), { backend: 'markdown', backends: backends })
  const mdStep = bannerOf(mod, stMd, false)
  ok(!!mdStep && mdStep.id === 'tracker:initialized', '本地 Markdown 缺初始化 → 直接出黄条（它的清单里没有仓库那一段）')
  ok(guide.guideStepsFor('markdown').every(function (s: any) { return s.id !== 'gh:remote' }), 'Markdown 的清单里根本没有「已关联仓库」那一步')
  ok(guide.guideStepsFor('github').map(function (s: any) { return s.id }).join(' → ') === 'selection:backendSelected → gh:installed → gh:authed → gh:remote → tracker:initialized → skill:wayfinder', 'GitHub 那条链的顺序就是定版那一条（蓝条只问后端 → gh 装 → 登录 → 仓库 → 初始化 → 技能）')

  console.log('== 接线：双产物里真的带着这几处（改完没重新构建就会红在这）==')
  const clientBundle = read('client.js')
  const pkgBundle = read('package/lib/client.js')
  for (const pair of [['client.js', clientBundle], ['package/lib/client.js', pkgBundle]]) {
    ok(pair[1].indexOf('const guideBannerStep = function') >= 0, pair[0] + ' 里带着横幅那条链')
    // 「产物里带着那条常驻注入日志」判据不变，但查的是**发射那一处**（log('info', 'guide.inject', …)），
    //   不是「哪个角落出现过这个键名」：事件名白名单里也有这一条，只查「出现过」会被白名单顶成假绿。
    //   引号两种都认 —— 产物由 esbuild 拼出来（#1251 起同名 .js 是构建产物），esbuild 统一输出双引号，
    //   真源那份写的是单引号（src/client/statusbar/bannerChain.ts 的 logGuideInject）。
    ok(/log\(\s*['"][a-z]+['"]\s*,\s*['"]guide\.inject['"]/.test(pair[1]),
      pair[0] + ' 里带着那条常驻注入日志（发射那一处真在产物里）')
  }
  // #716 起的现状：那段排查/安装指引按「一个缺失状态只有一份说明」的口径挪回了后端声明（GitHub 模块的
  //   prompts.cliInstall），产物里因此不再有那段字面文本，只有它的键名；替身账本里也没有 GitHub 模块的
  //   prompts（loadBackends 只搬了 id/label/setupPrompt/prompts，而替身走的是下面这条真身渲染路）。
  //   所以这里改成量**真行为**：拿真后端声明（宿主那个模块）渲染这一步的按钮文案，看它逐字是不是金样。
  const ghModule = (await import(url('src/tracker/rooms/github/index.ts'))).githubModule
  const declared = ghModule && ghModule.prompts && ghModule.prompts.cliInstall
  const rendered = declared ? String((declared.zh || declared.en || '')) : ''
  ok(rendered === GH_INSTALL_TEXT,
    '这一步那颗按钮真渲染出来的文案逐字等于金样（读的是宿主那份后端声明；#716 起字面文本住在那儿；#1621 换了说法）')
  for (const pair of [['client.js', clientBundle], ['package/lib/client.js', pkgBundle]]) {
    ok(pair[1].indexOf('cliInstall') >= 0, pair[0] + ' 里带着那个提示词键名（界面据此向后端声明要文本）')
  }

  console.log(failed ? 'FAIL ' + total + ' 项检查里有 ' + failedN + ' 项未过' : 'PASS 全部 ' + total + ' 项检查通过')
  process.exit(failed ? 1 : 0)
}
// 退役文案检查的小帮手（单独写出来，方便失败信息读得懂）。
function foundTailOk(found: string[]) { return found.length === 0 }

main().catch(function (e: any) { console.error('RUNNER ERROR:', e); process.exit(1) })
