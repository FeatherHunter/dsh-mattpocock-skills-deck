// verify-655-setup-layout.js — #655 初始化时由用户选域文档布局（规格 #657）行为验收
// 只测外部行为、不测内部常量与 DOM：喂假会话状态 + 后端描述数据，断言「该注入哪段文本」与「该先问而不是注入」。
// 唯一的缝是客户端内核里的注入决策函数（prompts.js 的 setupOrRepoPrompt / injectSetupDecision），所有入口都汇聚在它上面。
// 参照系：tests/verify-544-standalone-blocked.js 的取源做法（把真源取出来喂假状态、调真函数）。
// 用法: node tests/verify-655-setup-layout.js
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
let failed = false
let total = 0
const ok = (cond, msg) => { total++; if (cond) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg) } }

// —— 取真源：prompts.js 是内核模块（每行行首 export），去掉 export 后在闭包里求值 ——
//   闭包里的四样同名依赖用替身顶上：inject 记下注入的文本，emit 只当「界面重绘一次」，
//   isEnabled/log 是日志开关（本测试不开调试开关，两处都该安静地什么都不做），
//   L 是真词表——生产里由 kernel/locale.js 合并四个片段得到，standalone 求值没有它，
//   所以这里把真词表塞进求值体的末尾（不塞的话占位符会空着，测的就不是真行为了）。
function loadPrompts(localeDict) {
  const src = fs.readFileSync(path.join(root, 'src/client/kernel/prompts.js'), 'utf8')
  const body = src.replace(/^[ \t]*export[ \t]+/gm, '')
  const injected = []
  const emitted = []
  const logged = []
  // moduleMetaOf 不由 prompts.js 提供：它在真正的产物里由另一个内核模块（kernel/builtin-backends.js）声明，
  //   与 prompts.js 拼回同一个闭包后直接可用。沙箱里必须自己顶一个替身，否则「缺仓库改发建仓指引」那一档
  //   在本门禁里永远走不到（typeof 判定为假 → 一路回落到「直接注入」），等于那半条路径没人守。
  const moduleMetaOf = function (st, bid) {
    const list = (st && Array.isArray(st.backendModules)) ? st.backendModules : []
    for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(bid)) return list[i] }
    return null
  }
  const tail = '\n;const L = ' + JSON.stringify(localeDict) + ';'
    + '\n;return { PROMPTS: PROMPTS, setupRunParamsFrom: setupRunParamsFrom, setupRunPrompt: setupRunPrompt, setupOrRepoPrompt: setupOrRepoPrompt, injectSetupDecision: injectSetupDecision, consumePendingSetup: consumePendingSetup, readSetupLayout: readSetupLayout, normalizeSetupLayout: normalizeSetupLayout, SETUP_LAYOUT_TEXT_KEYS: SETUP_LAYOUT_TEXT_KEYS }'
  const factory = new Function('inject', 'emit', 'isEnabled', 'log', 'console', 'moduleMetaOf', body + tail)
  const mod = factory(
    function (st, text) { injected.push(String(text)) },
    function (st) { emitted.push(st) },
    function () { return false },
    function (level, event, fields) { logged.push({ level: level, event: event, fields: fields }) },
    { log: function () {}, warn: function () {}, error: function () {} },
    moduleMetaOf
  )
  return { mod: mod, injected: injected, emitted: emitted, logged: logged }
}

// —— 真词表：直接 import 四个片段，按 kernel/locale.js 合并器同一逻辑拼出来（与 verify-setup-describe 同口径）——
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

// —— 三个后端的描述数据替身（形状与 host 转发来的 modules 元素一致）——
//   注意 repoRemoteFix：真实后端模块声明了这条「缺仓库时改发的建仓指引」，不声明它的话
//   #496 那一档会一路回落到「直接注入初始化全文」，测出来的就不是真行为了。
const repoFixOf = (id) => ({ zh: '缺仓库指引 · ' + id, en: 'repo guide · ' + id })
const BACKENDS = {
  github: { id: 'github', setupPrompt: { trackerLine: 'setup.github.trackerLine', trackerChoice: 'setup.github.trackerChoice', backendNote: 'setup.github.backendNote', labelReqs: 'setup.github.labelReqs' }, capabilities: { repoCreateChain: true }, prompts: { repoRemoteFix: repoFixOf('github') } },
  gitlab: { id: 'gitlab', setupPrompt: { trackerLine: 'setup.gitlab.trackerLine', trackerChoice: 'setup.gitlab.trackerChoice', backendNote: 'setup.gitlab.backendNote', labelReqs: 'setup.gitlab.labelReqs' }, capabilities: { repoCreateChain: true }, prompts: { repoRemoteFix: repoFixOf('gitlab') } },
  markdown: { id: 'markdown', setupPrompt: { trackerLine: 'setup.markdown.trackerLine', trackerChoice: 'setup.markdown.trackerChoice', backendNote: 'setup.markdown.backendNote', labelReqs: 'setup.markdown.labelReqs' }, capabilities: {} },
}
// 会话状态：有仓库 / 没仓库 / 布局已选 / 布局未选，四个维度按用例拼
const stateOf = (opts) => {
  const o = opts || {}
  const st = {
    cwd: '/w/demo',
    backendModules: Object.keys(BACKENDS).map((k) => BACKENDS[k]),
    selection: { backendId: o.backend },
  }
  if (o.hasRepo !== false) st.repository = { owner: 'acme', name: 'demo' }
  if (o.layout) st.setupLayout = o.layout
  return st
}

async function main() {
  const L = await loadLocale()
  const { mod, injected, emitted, logged } = loadPrompts(L)
  const MODULES = Object.keys(BACKENDS).map((k) => BACKENDS[k])
  // 取占位符值时要显式喂 locale 字典：standalone 求值没有闭包里的 L，与 verify-setup-describe 同口径。
  const paramOf = (backend, layout, lang) => mod.setupRunParamsFrom(MODULES, backend, (L[lang || 'zh'] || null), layout)
  // 用真 locale 把模板填成全文（与生产 promptText 的替换算法同一形状）
  const textOf = (backend, layout, lang) => String(mod.PROMPTS.setupRun[lang]).replace(/\{(\w+)\}/g, function (m, name) {
    const p = paramOf(backend, layout, lang)
    return Object.prototype.hasOwnProperty.call(p, name) ? String(p[name]) : m
  })

  console.log('== #655 · 能弹出卡来的入口（allowCard）：布局未定时先问，不注入 ==')
  for (const backend of Object.keys(BACKENDS)) {
    for (const hasRepo of [true, false]) {
      const st = stateOf({ backend: backend, hasRepo: hasRepo })
      const before = injected.length
      const kind = mod.injectSetupDecision(st, backend, { allowCard: true })
      ok(kind === 'setup-card', '布局未选 · ' + backend + (hasRepo ? ' · 有仓库' : ' · 缺仓库') + ' → 决定是先问（实得 ' + kind + '）')
      ok(injected.length === before, '布局未选 · ' + backend + ' → 一个字都没注入')
      ok(st.setupLayoutCardOpen === true, '布局未选 · ' + backend + ' → 那张小卡被要求打开')
      ok(emitted.length > 0, '布局未选 · ' + backend + ' → 要求界面重绘，卡才看得见')
    }
  }
  // 回归守卫（2026-09-19 现场）：切换后端那条路拿不到那张卡（卡只在「该工作区尚未初始化」的黄条里渲染），
  //   所以它不许走「先问」这一档——否则既弹不出卡、又不注入，用户看到的是「点了确定什么都没发生」。
  //   判据：不传 allowCard 的入口，布局没选过也必须照旧注入（按缺省布局填），而不是卡在半路。
  console.log('== #655 · 拿不到卡的入口（切换后端等）：布局没选过也照旧注入，不许卡在半路 ==')
  for (const backend of Object.keys(BACKENDS)) {
    const b = BACKENDS[backend]
    const claimsRepo = !!(b.capabilities && b.capabilities.repoCreateChain)
    for (const hasRepo of [true, false]) {
      const st = stateOf({ backend: backend, hasRepo: hasRepo })
      const before = injected.length
      const kind = mod.injectSetupDecision(st, backend)
      const tag = '布局未选 · ' + backend + (hasRepo ? ' · 有仓库' : ' · 缺仓库')
      if (claimsRepo && !hasRepo) {
        // 旧行为的分支一：这个后端自带创仓链能力位、而眼下还没有仓库 → 照旧改发建仓指引，不塞初始化全文
        ok(kind === 'repo', tag + ' → 照旧改发建仓指引（实得 ' + kind + '）')
        ok(injected.length === before + 1 && injected[injected.length - 1] === repoFixOf(backend).zh, tag + ' → 建仓指引确实注入了，不是「什么都没发生」')
        ok(st.pendingSetupAfterPublish === true, tag + ' → 记下了「建仓成功后补发一次」的标记')
      } else {
        // 旧行为的分支二与三：有仓库（github/gitlab）、或这个后端本来就没有创仓链能力位（markdown）→ 注入初始化全文
        ok(kind === 'setup', tag + ' → 仍然注入全文（实得 ' + kind + '）')
        ok(injected.length === before + 1, tag + ' → 确实注入了，不是「什么都没发生」')
        ok(injected[injected.length - 1].indexOf('{contextLayout}') < 0, tag + ' → 注入的全文里没有悬空占位符')
        ok(injected[injected.length - 1].indexOf(L.zh['setup.layout.single']) >= 0, tag + ' → 没选过布局时按缺省「根目录一份 CONTEXT.md」填，不留空')
      }
    }
  }
  // 缺仓那一档也需要一条真能走到的用例：#496 说「有创仓链能力位 + 缺仓库 + 该后端声明了建仓指引」才改发指引。
  //   这里喂一份带 repoRemoteFix 的后端描述数据，把这条分支真正走一遍（否则上面那两条只是「判定不成立时回落」）。
  const repoFixStub = { id: 'github', setupPrompt: { trackerLine: 'setup.github.trackerLine', trackerChoice: 'setup.github.trackerChoice', backendNote: 'setup.github.backendNote', labelReqs: 'setup.github.labelReqs' }, capabilities: { repoCreateChain: true }, prompts: { repoRemoteFix: { zh: '先建仓库再初始化', en: 'create the repo first' } } }
  const stFix = { cwd: '/w/fix', backendModules: [repoFixStub], selection: { backendId: 'github' } }
  const beforeFix = injected.length
  ok(mod.injectSetupDecision(stFix, 'github') === 'repo', '带建仓指引声明的后端缺仓库时 → 走建仓指引那一档')
  ok(injected.length === beforeFix + 1 && injected[injected.length - 1] === '先建仓库再初始化', '建仓指引的原文确实注入了')
  ok(stFix.pendingSetupAfterPublish === true, '缺仓这一档照样记下补发标记')

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

  console.log('== #655 · 缺仓库那一档不被布局挡死 ==')
  const stNoRepo = stateOf({ backend: 'markdown', layout: 'single', hasRepo: false })
  const decMd = mod.setupOrRepoPrompt(stNoRepo, 'markdown')
  ok(decMd.kind === 'setup', 'Markdown（无创仓链能力位）缺仓库也直接注入（与改造前一致）')

  console.log('== #655 · 建仓成功后的补发沿用已选答案，不再问第二次 ==')
  const stRe = stateOf({ backend: 'github', layout: 'multi' })
  stRe.pendingSetupAfterPublish = true
  stRe.pendingSetupCwd = stRe.cwd
  const n2 = injected.length
  ok(mod.consumePendingSetup(stRe) === true, '补发发生了一次')
  ok(injected.length === n2 + 1, '补发恰好多注入一次')
  ok(injected[injected.length - 1] === textOf('github', 'multi', 'zh'), '补发用的是本次会话已选的布局（multi），不是缺省值')
  ok(stRe.pendingSetupAfterPublish === false, '补发标记被消费掉，不会重复补发')
  ok(mod.consumePendingSetup(stRe) === false, '第二次调用不再补发（仅一次）')

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
  ok(checkSrc.indexOf('resolveSetupRunText') >= 0 && checkSrc.indexOf('injectSetupDecision') >= 0, '检查页红牌那颗「执行初始化」按钮走的是同一个注入决策函数')
  const statusSrc = fs.readFileSync(path.join(root, 'src/client/statusbar/StatusBackend.js'), 'utf8')
  ok(statusSrc.indexOf('injectSetupDecision') >= 0, '状态栏黄条与门控弹窗也走同一个注入决策函数')
  const barSrc = fs.readFileSync(path.join(root, 'src/client/statusbar/StatusBar.js'), 'utf8')
  ok(barSrc.indexOf('layoutRadios(s, h)') >= 0 && (barSrc.match(/layoutRadios\(s, h\)/g) || []).length >= 2, '那张小卡与门控弹窗里都放了这组单选')

  console.log(failed ? 'FAIL ' + (total - 0) + ' 项检查中有失败' : 'PASS 全部 ' + total + ' 项检查通过')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error('RUNNER ERROR:', e); process.exit(1) })
