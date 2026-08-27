// verify-b2-map-newsession.js — dsh-waystation #456（v1.5 B2）行为契约测试
// 用法: node tests/verify-b2-map-newsession.js [file...]（默认 client.js + package/lib/client.js 双源）
//
// 验收标准（issue #456）：
//   a) map 行新会话 prompt 含 map 编号/URL/标题 —— AI 一开新会话即可定位对应 ISSUE；
//   b) 完成态 map（子票全关）新会话 prompt = 完成确认 prompt（COMPLETE_PROMPT 填好 #n/total/closed + map 标识），
//      未完成 = 推进式（MAP_EXECUTE_PROMPT）+ map 标识（B2 修订：新会话 prompt 跟随左侧主按钮语义）；
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

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']

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
  const entryRe = /^\s*"([a-zA-Z0-9.]+)": \{ version: (\d+), placeholders: \[([^\]]*)\], use: '([^']*)', zh: '([^']*)', en: '([^']*)' \},?$/gm
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
const buildEnv = function (src, lang) {
  const reg = parseRegistry(src)
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
  const COMPLETE_PROMPT = function () { return promptText('complete') }
  const BODY_FORMAT = function () { return promptText('bodyFormat') }
  const MAP_EXECUTE_PROMPT = function () { return promptText('mapExecute') }
  const renderTemplate = function (id, values) {
    const tpl = reg['tpl.' + id]
    if (!tpl) return ''
    let text = (lang0 === 'en' && tpl.en) ? tpl.en : (tpl.zh || '')
    if (values) text = text.replace(/\{(\w+)\}/g, function (m, name) { return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : m })
    return text
  }
  const withWayfinderPrefix = function (body) {
    if (/^\/wayfinder\b/.test(String(body || '').trim())) return body
    return '/wayfinder\n' + body
  }
  const completePromptSrc = extractBetween(src, 'const completePrompt = function (st, num, title, total, closed) {', "const FIXATE_PROMPT = function () { return promptText('fixate') }")
  const completePrompt = new Function('COMPLETE_PROMPT', 'BODY_FORMAT', 'repoStr', 'promptText', 'issueUrlFor', completePromptSrc + '; return completePrompt')(COMPLETE_PROMPT, BODY_FORMAT, repoStr, promptText, issueUrlFor)
  // #265 起 router 的命名契约段迁至 shared/naming-guardian.js；终止锚点随迁（#265 后稳定存在于源与产物）
  const startTextSrc = extractBetween(src, 'const startText = (st, t) => {', '// 契约 #205 会话标题')
  const startText = new Function('repoStr', 'promptText', 'completePrompt', 'MAP_EXECUTE_PROMPT', 'BODY_FORMAT', 'renderTemplate', 'withWayfinderPrefix', 'issueUrlFor', startTextSrc + '; return startText')(repoStr, promptText, completePrompt, MAP_EXECUTE_PROMPT, BODY_FORMAT, renderTemplate, withWayfinderPrefix, issueUrlFor)
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

const checkFile = function (file) {
  const src = fs.readFileSync(file, 'utf8')
  const env = buildEnv(src, 'zh')

  // a) 未完成 map 行（t 无 stats → snapshot 兜底）：推进式 + map 标识
  const out = env.startText(ST, mapIssue(305, '测试 map 标题'))
  assert.ok(out.indexOf('/wayfinder ' + URL305) === 0, file + ' zh 未完成 prompt 以 /wayfinder+空格+链接 开头')
  assert.ok(out.includes('请使用 wayfinder 技能推进该 map'), file + ' zh 未完成 = 推进式文案')
  assert.ok(out.includes('## 目标 map'), file + ' zh map 标识头')
  assert.ok(out.includes('编号：#305'), file + ' zh map 编号')
  assert.ok(out.includes('标题：测试 map 标题'), file + ' zh map 标题')
  assert.ok(out.includes('链接：' + URL305), file + ' zh map 链接')
  assert.ok(!out.includes('完成确认'), file + ' zh 未完成态不含完成确认')

  // b) 完成 map 行（t 自带 stats）：完成确认 prompt + map 标识，非推进式（#69 v4：标题 ## MAP完成确认，票号在首行 /wayfinder URL）
  const out2 = env.startText(ST, mapIssue(200, '完成 map', { total: 4, closed: 4 }))
  assert.ok(out2.includes('## MAP完成确认'), file + ' zh 完成确认标题（v4 MAP完成确认）')
  assert.ok(out2.indexOf('/wayfinder ' + URL200) === 0, file + ' zh 完成确认首行 /wayfinder+URL 含票号 #n')
  assert.ok(out2.includes('4/4'), file + ' zh 完成确认 closed/total 已填')
  assert.ok(out2.includes('## 目标 map') && out2.includes('编号：#200') && out2.includes('标题：完成 map') && out2.includes('链接：' + URL200), file + ' zh 完成态仍带 map 标识')
  assert.ok(!out2.includes('请使用 wayfinder 技能推进该 map'), file + ' zh 完成态不是推进式')

  // c) 完成态经 snapshot 兜底（t 无 stats 且 snapshot.maps 有该 map）
  const st2 = { snapshot: { maps: [{ number: 200, stats: { total: 4, closed: 4 } }] } }
  const out3 = env.startText(st2, mapIssue(200, '完成 map'))
  assert.ok(out3.includes('## MAP完成确认'), file + ' zh 完成态 snapshot 兜底（v4 标题）')

  // d) 零子票 map（total=0）→ 推进式（不算完成）
  const out4 = env.startText(ST, mapIssue(300, '空 map', { total: 0, closed: 0 }))
  assert.ok(out4.includes('请使用 wayfinder 技能推进该 map'), file + ' zh 零子票 map 仍推进式')
  assert.ok(out4.includes('编号：#300'), file + ' zh 零子票 map 带标识')

  // e) 普通票 execute 模板回归（非 map 分支未被 B2 改坏）
  const out5 = env.startText(ST, PLAIN)
  assert.ok(out5.includes('/wayfinder'), file + ' zh 普通票 /wayfinder 前缀')
  assert.ok(out5.includes(URL999), file + ' zh 普通票链接')
  assert.ok(out5.includes('执行这个 issue'), file + ' zh 普通票 execute 模板')

  // f) en 双语（以 en 为初始语言重建环境，忠实于模块加载时捕获常量别名）
  const enEnv = buildEnv(src, 'en')
  const out6 = enEnv.startText(ST, mapIssue(305, 'Test map title'))
  assert.ok(out6.includes('Please use the wayfinder skill to advance this map'), file + ' en 推进式')
  assert.ok(out6.includes('## Target map'), file + ' en map 标识头')
  assert.ok(out6.includes('No: #305'), file + ' en map 编号')
  assert.ok(out6.includes('Title: Test map title'), file + ' en map 标题')
  assert.ok(out6.includes('Link: ' + URL305), file + ' en map 链接')
  const out7 = enEnv.startText(ST, mapIssue(200, 'Done map', { total: 2, closed: 2 }))
  assert.ok(out7.includes('## MAP completion check'), file + ' en 完成确认标题（v4 MAP completion check）')
  assert.ok(out7.indexOf('/wayfinder ' + URL200) === 0, file + ' en 完成确认首行 /wayfinder+URL 含票号 #n')
  assert.ok(out7.includes('2/2'), file + ' en closed/total 已填')

  // g) 静态：详情页「在新会话打开」按钮（执行/完成旁，同语义 openInNewSession）
  assert.ok(src.includes('onClick: function () { openInNewSession(st, m) }'), file + ' 详情页新会话按钮 openInNewSession')
  assert.ok(src.includes("tr('map.newSessionTitle')"), file + ' 详情页新会话按钮双语 title 键')

  ok(file + ' · B2 map 新会话 prompt 行为契约（zh/en × 未完成/完成/零子票/普通票回归/详情页按钮）')
}

console.log('B2: #456 map 新会话 prompt 行为契约')
try {
  files.forEach(function (f) {
    try { checkFile(f) } catch (e) { console.log('  FAIL', f, '::', e.message); failed = true }
  })
} catch (e) {
  console.log('  FAIL ::', e.message)
  failed = true
}
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过：' + passedCount + '/' + files.length + ' 文件')
