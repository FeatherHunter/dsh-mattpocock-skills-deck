// verify-655-setup-layout.js — #655 初始化时由用户选域文档布局（规格 #657）行为验收
// 只测外部行为、不测内部常量与 DOM：喂假会话状态 + 后端描述数据，断言「该注入哪段文本」与「该先问而不是注入」。
// 唯一的缝是客户端内核里的注入决策函数（prompts.js 的 setupOrRepoPrompt / injectSetupDecision / setupBlockedByGuide），
// 所有入口都汇聚在它上面。
// 参照系：tests/verify-544-standalone-blocked.js 的取源做法（把真源取出来喂假状态、调真函数）。
//
// #664 改写说明（首开引导链定版 #661 第⑤⑥条 / 规格 #662 定版二第 3 条）：
//   1. 仓库那一步没过时一个字都不注入 —— 判据从「会话里有没有仓库引用 + 后端有没有建仓能力位」换成
//      「共享清单里标着 blocksSetup 的那一步过没过（读链快照，与状态栏那条横幅同一个口径）」。
//      所以夹具从「有没有仓库引用」换成「链快照里仓库那一步绿没绿」，原先那三条喂 repoRemoteFix
//      的用例（断言缺仓长文真的注入了）整段删掉，「仓库没就绪 → 一个字都不注入」那条用例补上来。
//   2. 仓库没就绪时连那张布局小卡也不开：卡只有在那条黄条下面才有位置，而仓库没就绪时按顺序还轮不到黄条，
//      先弹卡会让用户选完布局才发现什么都没注入（#655 收尾时修过的同一类毛病）。
// 用法: node tests/verify-655-setup-layout.js
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
let failed = false
let total = 0
const ok = (cond, msg) => { total++; if (cond) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg) } }

// —— 取真源：prompts.js 是内核模块（每行行首 export），去掉 export 后在闭包里求值 ——
//   闭包里的几样同名依赖用替身顶上：inject 记下注入的文本，emit 只当「界面重绘一次」，
//   isEnabled/log 是日志开关（本测试不开调试开关，两处都该安静地什么都不做），
//   L 是真词表——生产里由 kernel/locale.js 合并四个片段得到，standalone 求值没有它，
//   所以这里把真词表塞进求值体的末尾（不塞的话占位符会空着，测的就不是真行为了）。
//   guideStepsFor / guideStepDone 是共享清单 src/shared/tracker/guide-steps.js 里的两个真函数
//   （生产里随构建拼进同一个闭包，沙箱里必须自己顶上，否则「仓库那一步没过」那一档永远走不到）。
function loadPrompts(localeDict, guide, cachedLayout) {
  const src = fs.readFileSync(path.join(root, 'src/client/kernel/prompts.js'), 'utf8')
  const body = src.replace(/^[ \t]*export[ \t]+/gm, '')
  const injected = []
  const emitted = []
  const logged = []
  // getCachedSetupLayout 在生产里由 kernel/store-prefs.js 声明、与 prompts.js 拼进同一个闭包；
  //   沙箱里默认给一个「什么都没记住」的替身（等价于旧行为），要量「按工作区记住」那一档时由调用方换掉它。
  const cached = (cachedLayout && typeof cachedLayout.getCachedSetupLayout === 'function') ? cachedLayout.getCachedSetupLayout : function () { return null }
  // moduleMetaOf 不由 prompts.js 提供：它在真正的产物里由另一个内核模块（kernel/builtin-backends.js）声明，
  //   与 prompts.js 拼回同一个闭包后直接可用。沙箱里必须自己顶一个替身，否则按后端查声明数据那几处
  //   在本门禁里永远拿不到东西，测出来的就不是真行为了。
  const moduleMetaOf = function (st, bid) {
    const list = (st && Array.isArray(st.backendModules)) ? st.backendModules : []
    for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(bid)) return list[i] }
    return null
  }
  const tail = '\n;const L = ' + JSON.stringify(localeDict) + ';'
    + '\n;return { PROMPTS: PROMPTS, setupRunParamsFrom: setupRunParamsFrom, setupRunPrompt: setupRunPrompt, setupOrRepoPrompt: setupOrRepoPrompt, injectSetupDecision: injectSetupDecision, setupBlockedByGuide: setupBlockedByGuide, setupRunTextForClick: setupRunTextForClick, consumePendingSetup: consumePendingSetup, readSetupLayout: readSetupLayout, normalizeSetupLayout: normalizeSetupLayout, SETUP_LAYOUT_TEXT_KEYS: SETUP_LAYOUT_TEXT_KEYS }'
  const factory = new Function('inject', 'emit', 'isEnabled', 'log', 'console', 'moduleMetaOf', 'guideStepsFor', 'guideStepDone', 'getCachedSetupLayout', body + tail)
  const mod = factory(
    function (st, text) { injected.push(String(text)) },
    function (st) { emitted.push(st) },
    function () { return false },
    function (level, event, fields) { logged.push({ level: level, event: event, fields: fields }) },
    { log: function () {}, warn: function () {}, error: function () {} },
    moduleMetaOf,
    guide.guideStepsFor,
    guide.guideStepDone,
    cached
  )
  return { mod: mod, injected: injected, emitted: emitted, logged: logged }
}

// —— 真词表：直接 import 四个片段，按 kernel/locale.js 合并器同一逻辑拼出来（与 verify-setup-describe 同口径）——
const fUrl = (f) => require('url').pathToFileURL(path.join(root, f)).href
async function loadLocale() {
  const { pathToFileURL } = require('url')
  const url = (f) => pathToFileURL(path.join(root, f)).href
  const P = await import(url('src/client/kernel/locale-panel.js'))
  const F = await import(url('src/client/kernel/locale-flow.js'))
  const W = await import(url('src/client/kernel/locale-word.js'))
  const L = await import(url('src/client/kernel/locale-labels.js'))
  return {
    zh: Object.assign({}, P.L_PANEL.zh, F.L_FLOW.zh, W.L_WORD.zh, L.L_LABELS.zh),
    en: Object.assign({}, P.L_PANEL.en, F.L_FLOW.en, W.L_WORD.en, L.L_LABELS.en),
  }
}
async function loadGuide() {
  const { pathToFileURL } = require('url')
  return import(pathToFileURL(path.join(root, 'src/shared/tracker/guide-steps.js')).href)
}

// —— 三个后端的描述数据替身（形状与 host 转发来的 modules 元素一致）——
//   #664 起不再需要 repoRemoteFix：缺仓库那件事由界面上那一段负责，注入决策里没有这一档了。
const BACKENDS = {
  github: { id: 'github', setupPrompt: { trackerLine: 'setup.github.trackerLine', trackerChoice: 'setup.github.trackerChoice', backendNote: 'setup.github.backendNote', labelReqs: 'setup.github.labelReqs' }, capabilities: { repoCreateChain: true }, prompts: {} },
  gitlab: { id: 'gitlab', setupPrompt: { trackerLine: 'setup.gitlab.trackerLine', trackerChoice: 'setup.gitlab.trackerChoice', backendNote: 'setup.gitlab.backendNote', labelReqs: 'setup.gitlab.labelReqs' }, capabilities: { repoCreateChain: true }, prompts: {} },
  markdown: { id: 'markdown', setupPrompt: { trackerLine: 'setup.markdown.trackerLine', trackerChoice: 'setup.markdown.trackerChoice', backendNote: 'setup.markdown.backendNote', labelReqs: 'setup.markdown.labelReqs' }, capabilities: {}, prompts: {} },
}
// 链快照：决定初始化放不放行的只有一件事 —— 清单里标着 blocksSetup 的那一步（GitHub 的「已关联仓库」）过没过。
//   repoDone 省略/true = 那一步绿（仓库就绪）；repoDone:false = 那一步红（仓库还没建好）。
//   本地 Markdown 与 GitLab 本轮没有那一步，所以它们永远不挡初始化。
const chainOf = (backend, repoDone) => (backend === 'github'
  ? [{ id: 'gh:remote', status: repoDone === false ? 'fail' : 'done' }]
  : [])
// 会话状态：后端 / 布局 / 链快照三个维度按用例拼
const stateOf = (opts) => {
  const o = opts || {}
  const st = {
    cwd: '/w/demo',
    backendModules: Object.keys(BACKENDS).map((k) => BACKENDS[k]),
    selection: { backendId: o.backend },
    chainSnapshot: { steps: chainOf(o.backend, o.repoDone) },
  }
  if (o.layout) st.setupLayout = o.layout
  return st
}

async function main() {
  const L = await loadLocale()
  const G = await loadGuide()
  const { mod, injected, emitted, logged } = loadPrompts(L, G)
  const MODULES = Object.keys(BACKENDS).map((k) => BACKENDS[k])
  // 取占位符值时要显式喂 locale 字典：standalone 求值没有闭包里的 L，与 verify-setup-describe 同口径。
  const paramOf = (backend, layout, lang) => mod.setupRunParamsFrom(MODULES, backend, (L[lang || 'zh'] || null), layout)
  // 用真 locale 把模板填成全文（与生产 promptText 的替换算法同一形状）
  const textOf = (backend, layout, lang) => String(mod.PROMPTS.setupRun[lang]).replace(/\{(\w+)\}/g, function (m, name) {
    const p = paramOf(backend, layout, lang)
    return Object.prototype.hasOwnProperty.call(p, name) ? String(p[name]) : m
  })

  console.log('== #664 · 仓库那一步没过：无论走哪条入口，一个字都不注入、也不弹卡 ==')
  // 链快照里「已关联 GitHub 仓库」是红的（仓库还没建好）——三种入口形态（能弹卡的 / 只取决定的 / 拿不到卡的）
  //   都试一遍：一个字都不许注入，那张小卡也不许开（开了也没有地方渲染）。
  const entryForms = [
    { label: '能弹卡来的入口（allowCard:true）', opts: { allowCard: true } },
    { label: '只取决定的入口（injectNow:false, allowCard:true）', opts: { injectNow: false, allowCard: true } },
    { label: '拿不到卡的入口（不传 opts）', opts: undefined },
  ]
  for (const form of entryForms) {
    const st = stateOf({ backend: 'github', repoDone: false })
    const before = injected.length
    const kind = mod.injectSetupDecision(st, 'github', form.opts)
    ok(kind === 'blocked', '仓库没就绪 · ' + form.label + ' → 决定是「不注入」（实得 ' + kind + '）')
    ok(injected.length === before, '仓库没就绪 · ' + form.label + ' → 一个字都没注入')
    ok(st.setupLayoutCardOpen !== true, '仓库没就绪 · ' + form.label + ' → 那张小卡没被要求打开')
  }
  // 判据本身也单独钉一条：它读的是共享清单里标着 blocksSetup 的那一步，不是后端能力位、也不是品牌名。
  ok(mod.setupBlockedByGuide(stateOf({ backend: 'github', repoDone: false }), 'github') === true, '判据：仓库那一步没过 → 算「挡住初始化」')
  ok(mod.setupBlockedByGuide(stateOf({ backend: 'github' }), 'github') === false, '判据：仓库那一步绿了 → 不挡')
  ok(mod.setupBlockedByGuide(stateOf({ backend: 'markdown' }), 'markdown') === false, '判据：本地 Markdown 没有那一步，永远不挡')

  console.log('== #655 · 能弹出卡来的入口（allowCard）：布局未定时先问，不注入 ==')
  for (const backend of Object.keys(BACKENDS)) {
    const st = stateOf({ backend: backend })
    const before = injected.length
    const kind = mod.injectSetupDecision(st, backend, { allowCard: true })
    ok(kind === 'setup-card', '布局未选 · ' + backend + ' → 决定是先问（实得 ' + kind + '）')
    ok(injected.length === before, '布局未选 · ' + backend + ' → 一个字都没注入')
    ok(st.setupLayoutCardOpen === true, '布局未选 · ' + backend + ' → 那张小卡被要求打开')
    ok(emitted.length > 0, '布局未选 · ' + backend + ' → 要求界面重绘，卡才看得见')
  }
  // 回归守卫（2026-09-19 现场）：切换后端那条老路拿不到那张卡（卡只在「该工作区尚未初始化」的黄条里渲染），
  //   所以它不许走「先问」这一档——否则既弹不出卡、又不注入，用户看到的是「点了确定什么都没发生」。
  //   判据：不传 allowCard 的入口，布局没选过也照旧注入（按缺省布局填），而不是卡在半路。
  //   #664：切换后端那条路已经不调这个函数了，但这条口径本身仍然是 #655 的用户故事 13（建仓成功后的补发等
  //   拿不到卡的入口），所以留着。
  console.log('== #655 · 拿不到卡的入口：布局没选过也照旧注入，不许卡在半路（仓库就绪时）==')
  for (const backend of Object.keys(BACKENDS)) {
    const st = stateOf({ backend: backend })
    const before = injected.length
    const kind = mod.injectSetupDecision(st, backend)
    const tag = '布局未选 · ' + backend
    ok(kind === 'setup', tag + ' → 仍然注入全文（实得 ' + kind + '）')
    ok(injected.length === before + 1, tag + ' → 确实注入了，不是「什么都没发生」')
    ok(injected[injected.length - 1].indexOf('{contextLayout}') < 0, tag + ' → 注入的全文里没有悬空占位符')
    ok(injected[injected.length - 1].indexOf(L.zh['setup.layout.single']) >= 0, tag + ' → 没选过布局时按缺省「根目录一份 CONTEXT.md」填，不留空')
  }

  console.log('== #655 · 选过之后注入全文，两种布局是两句不同的话 ==')
  const seen = {}
  for (const backend of Object.keys(BACKENDS)) {
    for (const lang of ['zh', 'en']) {
      for (const layout of ['single', 'multi']) {
        const st = stateOf({ backend: backend, layout: layout })
        const dec = mod.setupOrRepoPrompt(st, backend)
        ok(dec.kind === 'setup', '布局已选 ' + layout + ' · ' + backend + ' · ' + lang + ' → 直接注入（实得 ' + dec.kind + '）')
        ok(dec.text.length > 0, '布局已选 ' + layout + ' · ' + backend + ' → 有全文可注入')
        ok(dec.text.indexOf('{contextLayout}') < 0, '布局已选 ' + layout + ' · ' + backend + ' → 没有悬空的 {contextLayout}')
        // 决策函数这条生产路径只取当前界面语言那一份模板（中文界面取中文），所以逐字金样按中文断言；
        //   英文那一份由下面的按语言取帧的断言覆盖（与 verify-setup-describe 同一口径）。
        const want = L[lang]['setup.layout.' + layout]
        ok(want && want.length > 0, 'locale ' + lang + ' 有 setup.layout.' + layout + ' 这一句')
        ok(paramOf(backend, layout, lang).contextLayout === want, '占位符取值来自用户选的布局（' + lang + '）')
        if (lang === 'zh') ok(dec.text.indexOf(want) >= 0, '布局已选 ' + layout + ' · ' + backend + ' → 注入文本里就是这一句结论')
        seen[backend + '|' + layout] = paramOf(backend, layout, 'zh').contextLayout
      }
    }
  }
  // 按语言取模板帧：中文那一句进中文全文、英文那一句进英文全文，两种布局各自不同（两句不同的话）。
  const fill = (backend, layout, lang) => String(mod.PROMPTS.setupRun[lang]).replace(/\{(\w+)\}/g, function (m, name) {
    const p = paramOf(backend, layout, lang)
    return Object.prototype.hasOwnProperty.call(p, name) ? String(p[name]) : m
  })
  for (const backend of Object.keys(BACKENDS)) {
    for (const lang of ['zh', 'en']) {
      const one = fill(backend, 'single', lang)
      const many = fill(backend, 'multi', lang)
      ok(one.indexOf(L[lang]['setup.layout.single']) >= 0, lang + ' · ' + backend + ' 单上下文全文里是单上下文那一句')
      ok(many.indexOf(L[lang]['setup.layout.multi']) >= 0, lang + ' · ' + backend + ' 多上下文全文里是多上下文那一句')
      ok(one.indexOf(L[lang]['setup.layout.multi']) < 0 && many.indexOf(L[lang]['setup.layout.single']) < 0, lang + ' · ' + backend + ' 两种布局各出各的，不串台')
      ok(one.indexOf('{') < 0 && many.indexOf('{') < 0, lang + ' · ' + backend + ' 两种布局的全文都不留占位符')
      ok(one !== many, lang + ' · ' + backend + ' 两种布局的全文不同（金样不同）')
    }
  }
  for (const backend of Object.keys(BACKENDS)) {
    ok(seen[backend + '|single'] !== seen[backend + '|multi'], '同后端的两种布局产出两句不同的话（金样不同）：' + backend)
  }
  // 三种后端共用同一份模板：把布局那一句与四个后端描述值都挖掉后逐字相同
  const bodyOf = (backend) => {
    const p = paramOf(backend, 'single', 'zh')
    let t = fill(backend, 'single', 'zh')
    ;['contextLayout', 'trackerLine', 'trackerChoice', 'backendNote', 'labelReqs'].forEach(function (k) { t = t.split(String(p[k])).join('\u0000') })
    return t
  }
  ok(bodyOf('github') === bodyOf('gitlab'), 'GitHub 与 GitLab 共用同一段模板（只有布局与后端描述值不同）')
  // Markdown 的 labelReqs 是空串（本地后端不要求标签齐全）：它与 GitHub 的全文差别只允许在后端描述值，
  //   以及少了那条「标签齐全」；句末标点因为空值会直接顶在句尾，一并按标点归一化后再比（不是行为差异）。
  const norm = (t, vals) => {
    let s = String(t)
    vals.forEach(function (v) { if (v) s = s.split(String(v)).join('') })
    return s.replace(/[\s。．，,；;：:、]/g, '')
  }
  const ghVals = ['contextLayout', 'trackerLine', 'trackerChoice', 'backendNote', 'labelReqs'].map(function (k) { return paramOf('github', 'single', 'zh')[k] })
  const mdVals = ['contextLayout', 'trackerLine', 'trackerChoice', 'backendNote', 'labelReqs'].map(function (k) { return paramOf('markdown', 'single', 'zh')[k] })
  ok(norm(fill('github', 'single', 'zh'), ghVals) === norm(fill('markdown', 'single', 'zh'), mdVals), 'Markdown 也用同一段模板（差别只在后端描述值，以及它本来就没有「标签齐全」那一条）')
  ok(fill('github', 'single', 'zh').indexOf('docs/agents/domain.md') >= 0, '注入文本点名了要写结论的那份说明文件')

  console.log('== #655 · 单漏斗：注入只发生在决策函数里，且只注入一次 ==')
  const st1 = stateOf({ backend: 'github', layout: 'multi' })
  const n0 = injected.length
  ok(mod.injectSetupDecision(st1, 'github') === 'setup', '选定布局后注入决策返回 setup')
  ok(injected.length === n0 + 1, '注入恰好一次（不重复注入）')
  ok(injected[injected.length - 1] === textOf('github', 'multi', 'zh'), '注入的全文与金样逐字相同')
  const n1 = injected.length
  ok(mod.injectSetupDecision(st1, 'github', { injectNow: false }) === 'setup', 'injectNow:false 时仍然给出 setup 这个决定（检查页那颗按钮要靠它）')
  ok(injected.length === n1, 'injectNow:false 时决策函数自己不注入（注入动作归调用处）')
  const stCard = stateOf({ backend: 'github' })
  ok(mod.injectSetupDecision(stCard, 'github', { injectNow: false, allowCard: true }) === 'setup-card', 'injectNow:false + allowCard 时布局未定也返回先问（检查页那颗按钮）')
  ok(stCard.setupLayoutCardOpen === true, 'injectNow:false 时那一档照样开卡')

  console.log('== 2026-09-21（维护者拍板 A + 记住）· 黄条那颗按钮每次都先问；答过的那一份按工作区记住 ==')
  {
    // ① 黄条那颗按钮（askLayout:true）：布局答过也照样先把卡弹出来（卡上预选着上次那一项），确认之后才注入。
    const stA = stateOf({ backend: 'github', layout: 'single' })
    const nA = injected.length
    const kA = mod.injectSetupDecision(stA, 'github', { allowCard: true, askLayout: true })
    ok(kA === 'setup-card', '黄条那颗按钮：布局已答（single）→ 仍然先弹卡（实得 ' + kA + '）')
    ok(stA.setupLayoutCardOpen === true, '黄条那颗按钮：那张卡确实被要求打开（看得见上次选的是哪一项）')
    ok(injected.length === nA, '黄条那颗按钮：弹卡的这一下一个字都不注入（等用户点确认）')
    // ② 别的入口（检查页那颗按钮、切换后端那条路）不传 askLayout：答过就直接注入，别再让人多点一次。
    const stB = stateOf({ backend: 'github', layout: 'single' })
    const nB = injected.length
    const kB = mod.injectSetupDecision(stB, 'github', { allowCard: true })
    ok(kB === 'setup', '检查页/切换那条路（不传 askLayout）：布局已答 → 直接注入（实得 ' + kB + '）')
    ok(injected.length === nB + 1 && injected[injected.length - 1] === textOf('github', 'single', 'zh'), '那条路注入的全文与金样逐字相同（还是那句已答的结论）')
    // ③ 按工作区记住：会话里没答过时，读这个工作区记住过的那一份（同一个工作区换个会话不该再问一遍）。
    const remembered = { '/w/demo': 'multi' }
    const withCache = loadPrompts(L, G, { getCachedSetupLayout: function (cwd) { return remembered[String(cwd || '')] || null } })
    const stC = stateOf({ backend: 'github' }) // 本次会话没答过
    ok(withCache.mod.readSetupLayout(stC) === 'multi', '会话里没答过 → 读到这个工作区记住的那一份（multi）')
    ok(withCache.mod.injectSetupDecision(stC, 'github', { allowCard: true }) === 'setup', '记住过之后，检查页/切换那条路直接用记住的那份注入（不再问）')
    ok(withCache.injected[withCache.injected.length - 1].indexOf(L.zh['setup.layout.multi']) >= 0, '注入的就是记住的那一份（多上下文那一句）')
    const stD = stateOf({ backend: 'github', layout: 'single' }) // 本次会话答过 single，工作区记住的是 multi
    ok(withCache.mod.readSetupLayout(stD) === 'single', '会话里答过 → 本次会话那一份优先于记住的那一份（当场改的立刻生效）')
    const stE = stateOf({ backend: 'github' }) // 工作区没记住过 + 会话没答过
    const none = loadPrompts(L, G, { getCachedSetupLayout: function () { return null } })
    ok(none.mod.readSetupLayout(stE) === null, '既没答过、也没记住过 → 仍然算没答过（照旧先问）')
    ok(none.mod.injectSetupDecision(stE, 'github', { allowCard: true }) === 'setup-card', '没答过的那一档照旧先弹卡')
    // ④ 记住的那一份不认识时不许当答案用（按未选定处理，免得把垃圾值写进注入文本）
    const junk = loadPrompts(L, G, { getCachedSetupLayout: function () { return 'nonsense' } })
    ok(junk.mod.readSetupLayout({ cwd: '/w/demo', selection: { backendId: 'github' } }) === null, '记住的值不认识时按未选定处理（不认识的取值不参与填空）')
  }

  console.log('== #664 · 本地 Markdown 没有「先建仓库」这一步：缺仓库也直接注入（与改造前一致）==')
  const stMd = stateOf({ backend: 'markdown', layout: 'single' })
  const decMd = mod.setupOrRepoPrompt(stMd, 'markdown')
  ok(decMd.kind === 'setup', 'Markdown（清单里没有被 blocksSetup 标住的步骤）缺仓库也直接注入')

  console.log('== #655 · 建仓成功后的补发沿用已选答案，不再问第二次 ==')
  // #664：置真补发标记的那一档已退役（见 prompts.js 里的说明），这里喂的就是「仓库已就绪 + 标记被置真」
  //   那一刻的样子，钉住补发本身的行为：沿用本次会话已选的布局、只补一次。
  const stRe = stateOf({ backend: 'github', layout: 'multi' })
  stRe.pendingSetupAfterPublish = true
  stRe.pendingSetupCwd = stRe.cwd
  const n2 = injected.length
  ok(mod.consumePendingSetup(stRe) === true, '补发发生了一次')
  ok(injected.length === n2 + 1, '补发恰好多注入一次')
  ok(injected[injected.length - 1] === textOf('github', 'multi', 'zh'), '补发用的是本次会话已选的布局（multi），不是缺省值')
  ok(stRe.pendingSetupAfterPublish === false, '补发标记被消费掉，不会重复补发')
  ok(mod.consumePendingSetup(stRe) === false, '第二次调用不再补发（仅一次）')

  console.log('== #664 · 检查页那颗「执行初始化」按钮：决定说「不给文字」时一个字都不注入 ==')
  // 现场实测出来的缺陷：这颗按钮的文案是点下去才定的，解析不出来时分发器会按 action.prompt 原样注入，
  //   于是「仓库还没就绪」那一档会把键名 setupRun 当文案塞进会话。下面照 ChecksTab 那条路走一遍真的分发器
  //   （真动作分发器 + 内核那处判据 setupRunTextForClick），三种情形各看一遍会话里收到几段。
  const actionsMod = await import(fUrl('src/client/kernel/actions.js'))
  const clickInitRow = async function (st) {
    const got = []
    const dispatcher = actionsMod.createActionDispatcher({
      inject: function (text) { got.push(String(text)) },
      openUrl: function () {},
      hostCall: function () { return Promise.reject(new Error('n/a')) },
      renderForm: function () {},
      refresh: async function () {},
      resolvePrompt: function (id) {
        try { if (id === 'setupRun') return mod.setupRunTextForClick(st); return '' } catch (e) { return '' }
      },
    })
    await dispatcher.dispatch({ type: 'inject-prompt', prompt: 'setupRun', label: '执行初始化' })
    return got
  }
  const stClickBlocked = stateOf({ backend: 'github', repoDone: false })
  ok((await clickInitRow(stClickBlocked)).length === 0, '仓库那一步没过 → 一个字都没注入（不会把键名 setupRun 当文案塞进会话）')
  const stClickCard = stateOf({ backend: 'github' })
  ok((await clickInitRow(stClickCard)).length === 0, '布局还没选 → 一个字都没注入（这次只开卡）')
  ok(stClickCard.setupLayoutCardOpen === true, '布局还没选 → 那张小卡确实开了')
  const stClickReady = stateOf({ backend: 'github', layout: 'single' })
  const clicked = await clickInitRow(stClickReady)
  ok(clicked.length === 1 && clicked[0] === textOf('github', 'single', 'zh'), '布局已选、仓库就绪 → 注入的就是初始化全文（逐字相同）')

  console.log('== #655 · 兜底取值与入参容错 ==')
  ok(mod.setupRunParamsFrom([], undefined, L.zh, undefined).contextLayout === L.zh['setup.layout.single'], '布局参数缺失时按缺省布局填一句（不留空、不留标记）')
  ok(mod.readSetupLayout({ setupLayout: 'multi' }) === 'multi', '读得到已选布局')
  ok(mod.readSetupLayout({ setupLayout: 'nonsense' }) === null, '不认识的值按未选定处理')
  ok(mod.readSetupLayout({}) === null && mod.readSetupLayout(null) === null, '没这个字段时按未选定处理，不抛错')
  ok(mod.setupRunParamsFrom(null, 'x', L.zh, 'single').backendNote.length > 0, '后端未声明描述数据时落到缺省键组（与改造前一致）')

  console.log('== #655 · 日志：只记枚举，调试开关关着时不组装字段 ==')
  ok(logged.length === 0, '调试开关关闭时一条日志都没记（决策函数外层先判开关）')

  console.log('== #655 · 结构门禁：产物里只允许一条注入初始化文案的路径 ==')
  // 这两条是结构门禁（源与双产物都查一遍），不是行为测试：谁再写一处「直接注入初始化文案」就红。
  const files = ['src/client/views/ChecksTab.js', 'src/client/views/NoRepoCard.js', 'client.js', 'package/lib/client.js']
  const directCalls = []
  for (const rel of files) {
    let src = ''
    try { src = fs.readFileSync(path.join(root, rel), 'utf8') } catch (e) { continue }
    // ① 取初始化文案必须经注入决策函数：出现「promptText('setupRun'」但同一行不走 setupRunParamsFrom 就算直注
    const lines = src.split(/\r?\n/)
    lines.forEach(function (line, i) {
      if (/promptText\(\s*'setupRun'\s*,/.test(line) && line.indexOf('setupRunParamsFrom') < 0) directCalls.push(rel + ':' + (i + 1) + ' 直接取初始化文案（应经注入决策函数）')
    })
  }
  ok(directCalls.length === 0, '产物与视图里没有绕开决策函数直取初始化文案的地方' + (directCalls.length ? '（' + directCalls.join('；') + '）' : ''))
  const checkSrc = fs.readFileSync(path.join(root, 'src/client/views/ChecksTab.js'), 'utf8')
  ok(checkSrc.indexOf('resolveSetupRunText') >= 0 && checkSrc.indexOf('setupRunTextForClick') >= 0, '检查页红牌那颗「执行初始化」按钮走的是同一个注入决策函数（经内核那一处判据）')
  const statusSrc = fs.readFileSync(path.join(root, 'src/client/statusbar/StatusBackend.js'), 'utf8')
  ok(statusSrc.indexOf('injectSetupDecision') >= 0, '状态栏黄条与那张小卡的确认都走同一个注入决策函数')
  const barSrc = fs.readFileSync(path.join(root, 'src/client/statusbar/StatusBar.js'), 'utf8')
  // #663：门控那个窗里那组单选撤了（全新工作区还没装 gh、还没建仓库，先把「各部分共用一套用语吗」问出来是超前的问题），
  //   布局那一问现在只在初始化那一步出现 —— 所以源码里只剩那张小卡一处放这组单选。
  ok(barSrc.indexOf('layoutRadios(s, h)') >= 0 && (barSrc.match(/layoutRadios\(s, h\)/g) || []).length >= 1, '初始化那张小卡上放着这组单选（门控弹窗里那组已按 #663 撤掉）')
  // #664：**门控确认**那两条路不再注入任何文字（原先它们都调过这个决策函数）。
  //   #669 第 6 件（ADR 20260921）：切换后端那条路**重新**按场景注入 —— 未初始化且仓库就绪时走这个决策函数
  //   （与黄条同一条：先开布局小卡、选完注入初始化全文），已初始化时注入的是另一条「切换后对齐」的 prompt。
  //   场景分流由 tests/verify-669-choice-precedence.js 守着（含三种场景与反证），这里只守门控那两条路。
  const noInjectFiles = ['src/client/panel/Dock.js', 'src/client/panel/OverlayGate.js']
  const stillInject = noInjectFiles.filter(function (rel) {
    try { return /injectSetupDecision\s*\(/.test(fs.readFileSync(path.join(root, rel), 'utf8')) } catch (e) { return false }
  })
  ok(stillInject.length === 0, '门控那两条路都不再注入任何文字' + (stillInject.length ? '（还在调：' + stillInject.join('、') + '）' : ''))

  console.log(failed ? 'FAIL ' + (total - 0) + ' 项检查中有失败' : 'PASS 全部 ' + total + ' 项检查通过')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error('RUNNER ERROR:', e); process.exit(1) })
