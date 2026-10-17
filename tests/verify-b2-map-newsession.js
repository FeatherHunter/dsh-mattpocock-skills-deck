// verify-b2-map-newsession.js — dsh-waystation #456（v1.5 B2）行为契约测试
// 用法: node tests/verify-b2-map-newsession.js [file...]（默认 client.js + package/lib/client.js 双源）
//
// 验收标准（issue #456）：
//   a) map 行新会话 prompt 首行即 /wayfinder+链接 —— AI 一开新会话即可定位对应 ISSUE（标识由首行承载，不再内嵌标识头）；
//   b) 完成态 map（子票全关）新会话 prompt = 完成确认 prompt（COMPLETE_PROMPT 填好 #n/total/closed + map 标识），
//      未完成 = 推进式（MAP_EXECUTE_PROMPT）+ 工具节（B2 修订：新会话 prompt 跟随左侧主按钮语义）；
//   c) 详情页执行/完成旁有「在新会话打开」按钮；
//   d) 双语（zh/en）。
//
// 本测试不复制 startText 逻辑，而是从目标文件提取真实的 completePrompt / startText 源码
// 并在沙箱中执行（依赖 = 同一文件解析出的真实 PROMPTS 注册表 + 最小忠实替身），
// 因此能抓住「逻辑改坏 / 模板改坏 / 双源漂移」三类回归。
//
// 忠实性注意：真实代码中 MAP_EXECUTE_PROMPT / COMPLETE_PROMPT / BODY_FORMAT 是
// 模块加载时 promptText(...) 捕获一次的常量别名（语言切换不重算），故 en 用例须
// 以 en 为初始语言重新构建环境，而非中途切换。
const fs = require('fs')
const assert = require('assert')
const { compileFn } = require('./lib/eval-probe.js')
const { spliceableJs } = require('./lib/source-text.ts')

const files = process.argv.slice(2)
// 2026-10-17 先修：默认目标原来是两个构建产物（client.js / package/lib/client.js）。产物里注册表整体变成一条
// 转义过的字符串、函数带上构建后的双引号形态，门禁的锚点与注册表正则全对不上——实测每条用例都在假红/假绿。
// 改成默认读真源：注册表取 prompts.ts 原文，函数片段取剥掉类型标注后的 prompts.ts 与 router.js，
// 详情页按钮那条静态判据读 MapDetailTop.js。产物那一侧由构建新鲜度门禁守。
const SOURCES = {
  reg: 'src/client/kernel/prompts.ts',      // PROMPTS 注册表（原文里键用双引号、值用单引号）
  prompts: 'src/client/kernel/prompts.ts',  // completePrompt / MAP_EXECUTE_PROMPT / FIXATE_PROMPT
  router: 'src/client/kernel/router.js',    // startText
  view: 'src/client/views/MapDetailTop.js', // 详情页「在新会话打开」按钮
}

// ---- 解析 PROMPTS 注册表（与 verify-prompts.js 同构）----
const unescapeStr = function (s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) { out += s[i + 1] === 'n' ? '\n' : s[i + 1]; i++ }
    else out += c
  }
  return out
}
const parseRegistry = function (src) {
  const reg = {}
  // 2026-10-17：原来的正则把条目钉在「行首…行尾逗号」上，而真源里整个注册表是一条长串、条目之间是字面的 \n，
  // 于是永远匹配不到；字符串值也改成「转义感知」，正文里出现转义引号不会截断。
  const entryRe = /["']([a-zA-Z0-9.]+)["']:\s*\{\s*version:\s*(\d+),\s*placeholders:\s*\[([^\]]*)\],\s*use:\s*'((?:\\.|[^'])*)',\s*zh:\s*'((?:\\.|[^'])*)',\s*en:\s*'((?:\\.|[^'])*)'\s*\}/g
  let m
  while ((m = entryRe.exec(src)) !== null) {
    const ph = m[3] ? m[3].split(',').map(function (x) { return x.trim().replace(/'/g, '') }).filter(Boolean) : []
    reg[m[1]] = { version: Number(m[2]), placeholders: ph, use: m[4], zh: unescapeStr(m[5]), en: unescapeStr(m[6]) }
  }
  return reg
}

// ---- 提取两段真实函数源码（锚点两侧）----
const extractBetween = function (src, from, to) {
  const i = src.indexOf(from)
  if (i < 0) throw new Error('起始锚点缺失: ' + from)
  const j = src.indexOf(to, i + from.length)
  if (j < 0) throw new Error('终止锚点缺失: ' + to)
  return src.slice(i, j)
}

// ---- 沙箱：真实函数 + 忠实替身依赖（lang = 构建时初始语言，模拟模块加载）----
const buildEnv = function (regSrc, promptsJs, routerJs, lang) {
  const reg = parseRegistry(regSrc)
  const lang0 = lang === 'en' ? 'en' : 'zh'
  const promptText = function (id, params) {
    const p = reg[id]
    if (!p) return ''
    let s = (lang0 === 'en' && p.en) ? p.en : (p.zh || '')
    if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m })
    return s
  }
  const repoStr = function () { return 'FeatherHunter/SKILLS' }
  // #231 清尾终态沙箱替身：与产品 link.js 同算法——模板取自 st.backendModules 各后端 links 声明
  const issueUrlFor = function (st, key) {
    const n = String(key == null ? '' : key).trim()
    if (!n) return ''
    const sel = st && (st.selection || (st.snapshot && st.snapshot.selection))
    const bid = sel ? sel.backendId : null
    if (bid == null) return ''
    const ms = st && Array.isArray(st.backendModules) ? st.backendModules : null
    let tpl = ''
    if (ms) for (let i = 0; i < ms.length; i++) { const m = ms[i]; if (m && m.id === bid && m.links) { tpl = String(m.links.issueUrlTemplate || ''); break } }
    if (!tpl) return ''
    const repo = st && st.snapshot && (st.snapshot.repository || st.snapshot.repo)
    const refId = repo ? (repo.refId || ((repo.owner && repo.name) ? repo.owner + '/' + repo.name : '')) : ''
    if (!refId) return ''
    return tpl.split('{refId}').join(refId).split('{key}').join(n)
  }
  // 2026-08-18（需求修复）：常量已函数化（语言切换实时重算）—— 沙箱同样以函数注入
  const COMPLETE_PROMPT = function (st) { return promptTextFor(st, 'complete') }
  const BODY_FORMAT = function (st) { return bodyFormatOf(st) }
  const MAP_EXECUTE_PROMPT = function (st) { return promptTextFor(st, 'mapExecute') }
  // #595：正文格式 / 子议题关联方式都按当前后端解析（沙箱忠实替身：查 st.backendModules 声明，缺声明落注册表兜底）
  const backendDecl = function (st, key) {
    const sel = st && (st.selection || (st.snapshot && st.snapshot.selection))
    const bid = sel ? sel.backendId : null
    const ms = st && Array.isArray(st.backendModules) ? st.backendModules : []
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]
      if (m && String(m.id) === String(bid) && m.prompts && m.prompts[key]) return m.prompts[key]
    }
    return null
  }
  const bodyFormatOf = function (st) {
    const d = backendDecl(st, 'bodyFormat')
    if (!d) return promptText('bodyFormat')
    return String((lang0 === 'en' && d.en) ? d.en : (d.zh || ''))
  }
  const subIssueOf = function (st) {
    const d = backendDecl(st, 'subIssue')
    if (!d) return '通过 Tracker 原生的父子关系关联（create 时带 parentKey 或创后 setParent）'
    return String((lang0 === 'en' && d.en) ? d.en : (d.zh || ''))
  }
  const promptTextFor = function (st, id, params) {
    const p = Object.assign({}, params || {})
    if (!Object.prototype.hasOwnProperty.call(p, 'bodyFormat')) p.bodyFormat = bodyFormatOf(st)
    if (!Object.prototype.hasOwnProperty.call(p, 'subIssue')) p.subIssue = subIssueOf(st)
    return promptText(id, p)
  }
  const renderTemplate = function (id, values, st) {
    const tpl = reg['tpl.' + id]
    if (!tpl) return ''
    let text = (lang0 === 'en' && tpl.en) ? tpl.en : (tpl.zh || '')
    const vals = Object.assign({}, values || {})
    if (!Object.prototype.hasOwnProperty.call(vals, 'bodyFormat')) vals.bodyFormat = bodyFormatOf(st)
    if (!Object.prototype.hasOwnProperty.call(vals, 'subIssue')) vals.subIssue = subIssueOf(st)
    text = text.replace(/\{(\w+)\}/g, function (m, name) { return Object.prototype.hasOwnProperty.call(vals, name) ? String(vals[name]) : m })
    return text
  }
  const withWayfinderPrefix = function (body) {
    if (/^\/wayfinder\b/.test(String(body || '').trim())) return body
    return '/wayfinder\n' + body
  }
  // 沙箱补登记：startText 现在会调 effortOf / idOf（multi-effort 维度引入的票身份键；实现在 src/tracker/kernel/identity-keys.ts，
  //   构建时拼进界面闭包）、空态分支会调 inspectPrompt（prompts.js 的渲染入口）。
  //   先前本沙箱的参数表漏了它们 → 提取出来的 startText 一执行就 ReferenceError，整个用例假红（与本次改动无关）。
  const effortOf = function (issue) { return (issue && issue.effortId !== undefined && issue.effortId !== null) ? String(issue.effortId) : '' }
  const idOfParts = function (effortId, key) {
    const effort = (effortId === undefined || effortId === null) ? '' : String(effortId)
    const k = (key === undefined || key === null) ? '' : String(key)
    return effort ? effort + '\u0000' + k : k
  }
  const idOf = function (issue) { return issue ? idOfParts(effortOf(issue), issue.key) : '' }
  const inspectPrompt = function (st, num, title) {
    const u = issueUrlFor(st, String(num == null ? '' : num))
    return '/wayfinder ' + u + '\n\n' + promptTextFor(st, 'mapInspect', { n: String(num == null ? '' : num), title: String(title || ''), url: u })
  }
  // 2026-10-17：片段从「剥掉类型标注后的真源」里切；产物的形态（export 去掉、类型去掉、引号重排）不再参与。
  // 终止锚点带上 const，免得切片尾部落下一个孤零零的 const（那会让求值当场报 Unexpected token）。
  const completePromptSrc = extractBetween(promptsJs, 'completePrompt = function', 'const FIXATE_PROMPT = function')
  // 本文件选 compileFn：这两处原来都是「把依赖名当参数、把从产物里切出来的源码当函数体」造函数再调用，
  //   依赖本来就全部显式传参（切出来的代码读不到本文件作用域），与共用入口用法一一对应。
  const completePrompt = compileFn(['COMPLETE_PROMPT', 'BODY_FORMAT', 'repoStr', 'promptText', 'issueUrlFor'], completePromptSrc + '; return completePrompt')(COMPLETE_PROMPT, BODY_FORMAT, repoStr, promptText, issueUrlFor)
  // #265 起 router 的命名契约段迁至命名守护共享核心（S2 #452 起为 shared/naming-titles.js 等 3 个文件）；终止锚点随迁（#265 后稳定存在于源与产物）
  const startTextSrc = extractBetween(routerJs, 'const startText = (st, t) => {', '// 契约 #205 会话标题')
  // 同上：startText 这一处的依赖表也是逐字传参，换成 compileFn 后参数与实参一字不变。
  const startText = compileFn(['repoStr', 'promptText', 'promptTextFor', 'inspectPrompt', 'completePrompt', 'MAP_EXECUTE_PROMPT', 'BODY_FORMAT', 'renderTemplate', 'withWayfinderPrefix', 'issueUrlFor', 'effortOf', 'idOf'], startTextSrc + '; return startText')(repoStr, promptText, promptTextFor, inspectPrompt, completePrompt, MAP_EXECUTE_PROMPT, BODY_FORMAT, renderTemplate, withWayfinderPrefix, issueUrlFor, effortOf, idOf)
  return { startText: startText }
}

// ---- 测试数据 ----
const ST = { snapshot: { maps: [{ number: 305, stats: { total: 3, closed: 1 } }], repository: { backend: 'github', refId: 'FeatherHunter/SKILLS', name: 'FeatherHunter/SKILLS' }, selection: { backendId: 'github', source: 'explicit' } }, backendModules: [ { id: 'github', label: 'GitHub', links: { issueUrlTemplate: 'https://github.com/{refId}/issues/{key}', repoUrlTemplate: 'https://github.com/{refId}', searchUrlTemplate: 'https://github.com/search?q={q}' } } ] }
const mapIssue = function (number, title, stats) {
  const t = { number: number, title: title, labels: [{ name: 'wayfinder:map' }] }
  if (stats) t.stats = stats
  return t
}
const PLAIN = { number: 999, title: '普通票', labels: [] }
const URL305 = 'https://github.com/FeatherHunter/SKILLS/issues/305'
const URL200 = 'https://github.com/FeatherHunter/SKILLS/issues/200'
const URL999 = 'https://github.com/FeatherHunter/SKILLS/issues/999'

let failed = false
let passedCount = 0
const ok = function (name) { passedCount++; console.log('  PASS', name) }

const checkFile = function (file, regSrc, promptsJs, routerJs, viewSrc) {
  const env = buildEnv(regSrc, promptsJs, routerJs, 'zh')

  // a) 未完成 map 行（t 无 stats → snapshot 兜底）：推进式 + 工具节
  const out = env.startText(ST, mapIssue(305, '测试 map 标题'))
  assert.ok(out.indexOf('/wayfinder ' + URL305) === 0, file + ' zh 未完成 prompt 以 /wayfinder+空格+链接 开头')
  assert.ok(out.includes('请使用 wayfinder 技能推进该 map'), file + ' zh 未完成 = 推进式文案')
  assert.ok(out.includes('## 工具') && out.includes('优先使用 deck_ 开头的工具'), file + ' zh 工具节（issue 操作优先走 deck 工具，不断后路）')
  assert.ok(!out.includes('## 目标 map') && !out.includes('编号：#305'), file + ' zh 未完成态不再内嵌 map 标识头（标识由首行 /wayfinder+链接承载）')
  assert.ok(!out.includes('完成确认'), file + ' zh 未完成态不含完成确认')

  // b) 完成 map 行（t 自带 stats）：完成确认 prompt + map 标识，非推进式（#69 v4：标题 ## MAP完成确认，票号在首行 /wayfinder URL）
  const out2 = env.startText(ST, mapIssue(200, '完成 map', { total: 4, closed: 4 }))
  assert.ok(out2.includes('## MAP完成确认'), file + ' zh 完成确认标题（v4 MAP完成确认）')
  assert.ok(out2.indexOf('/wayfinder ' + URL200) === 0, file + ' zh 完成确认首行 /wayfinder+URL 含票号 #n')
  assert.ok(out2.includes('4/4'), file + ' zh 完成确认 closed/total 已填')
  assert.ok(!out2.includes('## 目标 map') && !out2.includes('编号：#200'), file + ' zh 完成态不再内嵌 map 标识头（#779：标识由首行 /wayfinder+链接承载）')
  assert.ok(out2.includes('## 工具') && out2.includes('优先使用 deck_ 开头的工具') && out2.includes('deck_issue_report'), file + ' zh 完成态带两行工具节（#779）')
  assert.ok(!out2.includes('请使用 wayfinder 技能推进该 map'), file + ' zh 完成态不是推进式')

  // c) 完成态经 snapshot 兜底（t 无 stats 且 snapshot.maps 有该 map）
  const st2 = { snapshot: { maps: [{ number: 200, stats: { total: 4, closed: 4 } }] } }
  const out3 = env.startText(st2, mapIssue(200, '完成 map'))
  assert.ok(out3.includes('## MAP完成确认'), file + ' zh 完成态 snapshot 兜底（v4 标题）')

  // d) 零子票 map（total=0）→ 走「0/0 检查」prompt（mapInspect），不是推进式
  //    陈旧断言修正（与 #595 无关）：本条原写「零子票 map 仍推进式」，但现产品里 total=0 属异常态，
  //    startText 有意改走 map 空态 0/0 检查（列表与详情页的「检查」按钮同一入口），照原语义断言只会永久红。
  const out4 = env.startText(ST, mapIssue(300, '空 map', { total: 0, closed: 0 }))
  assert.ok(out4.includes('该 map 在面板中显示为 0/0') && out4.includes('## 排查'), file + ' zh 零子票 map 走 0/0 检查 prompt（不再推进）')
  assert.ok(!out4.includes('请使用 wayfinder 技能推进该 map'), file + ' zh 零子票 map 不是推进式')
  assert.ok(out4.includes('编号：#300'), file + ' zh 零子票 map 带标识')

  // e) 普通票 execute 模板回归（非 map 分支未被 B2 改坏）
  const out5 = env.startText(ST, PLAIN)
  assert.ok(out5.includes('/wayfinder'), file + ' zh 普通票 /wayfinder 前缀')
  assert.ok(out5.includes(URL999), file + ' zh 普通票链接')
  assert.ok(out5.includes('执行这个 issue'), file + ' zh 普通票 execute 模板')

  // f) en 双语（以 en 为初始语言重建环境，忠实于模块加载时捕获常量别名）
  const enEnv = buildEnv(regSrc, promptsJs, routerJs, 'en')
  const out6 = enEnv.startText(ST, mapIssue(305, 'Test map title'))
  assert.ok(out6.includes('Please use the wayfinder skill to advance this map'), file + ' en 推进式')
  assert.ok(out6.includes('## Tools') && out6.includes('Prefer the deck_ tools'), file + ' en 工具节（issue 操作优先走 deck 工具）')
  assert.ok(!out6.includes('## Target map') && !out6.includes('No: #305'), file + ' en 不再内嵌 map 标识头')
  const out7 = enEnv.startText(ST, mapIssue(200, 'Done map', { total: 2, closed: 2 }))
  assert.ok(out7.includes('## MAP completion check'), file + ' en 完成确认标题（v4 MAP completion check）')
  assert.ok(out7.indexOf('/wayfinder ' + URL200) === 0, file + ' en 完成确认首行 /wayfinder+URL 含票号 #n')
  assert.ok(out7.includes('2/2'), file + ' en closed/total 已填')
  assert.ok(!out7.includes('## Target map'), file + ' en 完成态不再内嵌 map 标识头（#779）')
  assert.ok(out7.includes('## Tools') && out7.includes('deck_issue_report'), file + ' en 完成态带两行工具节（#779）')

  // g) 静态：详情页「在新会话打开」按钮（执行/完成旁，同语义 openInNewSession）
  assert.ok(viewSrc.includes('openInNewSession(st, m)'), file + ' 详情页新会话按钮 openInNewSession')
  assert.ok(viewSrc.includes("tr('map.newSessionTitle')"), file + ' 详情页新会话按钮双语 title 键')

  ok(file + ' · B2 map 新会话 prompt 行为契约（zh/en × 未完成/完成/零子票/普通票回归/详情页按钮）')
}

console.log('B2: #456 map 新会话 prompt 行为契约')
try {
  if (files.length) {
    files.forEach(function (f) {
      try {
        const one = fs.readFileSync(f, 'utf8')
        checkFile(f, one, one, one, one)
      } catch (e) { console.log('  FAIL', f, '::', e.message); failed = true }
    })
  } else {
    const regSrc = fs.readFileSync(SOURCES.reg, 'utf8')
    const promptsJs = spliceableJs(SOURCES.prompts)
    const routerJs = spliceableJs(SOURCES.router)
    const viewSrc = fs.readFileSync(SOURCES.view, 'utf8')
    checkFile('真源 ' + Object.keys(SOURCES).length + ' 份', regSrc, promptsJs, routerJs, viewSrc)
    passedCountTarget = 1
  }
} catch (e) {
  console.log('  FAIL ::', e.message)
  failed = true
}
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过：' + passedCount + '/' + (files.length || 1) + ' 文件')
