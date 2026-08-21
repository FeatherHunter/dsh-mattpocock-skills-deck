// verify-t2b-templates.js — dsh-waystation v25 T2b 模板引擎验证（ticket #368）
// 复刻 client.js §2.5 模板引擎（TPL_DEFAULT/renderTemplate/validateTemplate/extractHandoffFile），验证：
//   1) 默认模板渲染（诊断/修复/讨论/执行/交接两击/沉淀）
//   2) 占位符替换与未知占位符保留
//   3) 转义 {{x}} → 字面量 {x}（不被替换、不被误判）
//   4) 校验：未知占位符拒绝 / 强制占位符缺失拒绝 / 全通过
//   5) 交接两击一致性（F1：{file} = 第一击渲染解析的实际文件名）
// 用法: node tests/verify-t2b-templates.js
const assert = require('assert')

const GUIDE_LINE = '从第一性原理出发完成任务，并对抗式审查。'
const PH = ['url', 'number', 'title', 'ts', 'file']
const TPL_REQUIRED = {
  diagnose: ['url'], fix: ['url'], discuss: ['url'], execute: ['url'],
  handoff1: ['ts'], handoff2: ['file'], fixate: [],
}
const TPL_DEFAULT = {
  diagnose: '/triage\n{url}\n\n' + GUIDE_LINE,
  fix: '/wayfinder\n{url}\n\n' + GUIDE_LINE,
  discuss: '/wayfinder\n{url}\n\n' + GUIDE_LINE,
  execute: '{url}\n\n' + GUIDE_LINE,
  handoff1: '/handoff\n\n请把当前会话生成交接文档，写到 .scratch/handoff/{ts}.md（相对当前工作目录），包含三部分：\n' +
    '1. 结论：本次会话已确认的决定与成果；\n2. 未完成事项：下一步要继续的事；\n3. 建议 skill：新会话接手时建议加载的技能。\n\n' + GUIDE_LINE,
  handoff2: '请阅读 .scratch/handoff/{file}（上一会话生成的交接文档），复述你的理解后再继续推进：\n\n## 复述理解\n- [ ] 结论：本会话已确认的决定与成果\n- [ ] 未完成事项：下一步要继续的事\n- [ ] 建议 skill：新会话接手时应加载的技能\n- [ ] 把以上三点复述给我；若有遗漏或不确定 → 先问我确认，不猜\n\n## 继续推进\n- [ ] 从第一性原理出发，继续完成未完成事项',
  fixate: '里程碑固化点。暂停推进，执行「零丢失快照」，从第一性原理出发：\n\n1. 全量复述：…',
}
const templates = { diagnose: '', fix: '', discuss: '', execute: '', handoff1: '', handoff2: '', fixate: '' }
const tplText = (id) => templates[id] || TPL_DEFAULT[id] || ''

// ---- 与 client.js 同构的引擎 ----
const renderTemplate = function (id, values) {
  let text = String(tplText(id))
  const esc = []
  text = text.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, function (m, name) { esc.push('{' + name + '}'); return '\u0001' + (esc.length - 1) + '\u0001' })
  text = text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, function (m, name) {
    return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : m
  })
  esc.forEach(function (s, i) { text = text.replace('\u0001' + i + '\u0001', s) })
  return text
}
const validateTemplate = function (id, text) {
  const found = []
  const scrubbed = String(text || '').replace(/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g, '')
  const re = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g
  let m
  while ((m = re.exec(scrubbed)) !== null) found.push(m[1])
  const unknown = []
  found.forEach(function (n) { if (PH.indexOf(n) < 0 && unknown.indexOf(n) < 0) unknown.push(n) })
  const missing = []
  ;(TPL_REQUIRED[id] || []).forEach(function (n) { if (found.indexOf(n) < 0 && missing.indexOf(n) < 0) missing.push(n) })
  return { ok: unknown.length === 0 && missing.length === 0, unknown: unknown, missing: missing }
}
const extractHandoffFile = function (text) {
  const m = String(text || '').match(/\.scratch\/handoff\/([^\s"'`]+\.md)/)
  return m ? m[1] : null
}

let passed = 0
const ok = (name) => { passed++; console.log('  PASS', name) }

console.log('T1: 默认模板渲染')
{
  const url = 'https://github.com/FeatherHunter/SKILLS/issues/365'
  assert.strictEqual(renderTemplate('diagnose', { url }), '/triage\n' + url + '\n\n' + GUIDE_LINE)
  assert.strictEqual(renderTemplate('fix', { url }), '/wayfinder\n' + url + '\n\n' + GUIDE_LINE)
  assert.strictEqual(renderTemplate('discuss', { url }), '/wayfinder\n' + url + '\n\n' + GUIDE_LINE)
  const ex = renderTemplate('execute', { number: '365', url, title: 'T1 规格' })
  assert.ok(ex.includes(url) && ex.includes(GUIDE_LINE) && !ex.includes('{url}'), 'execute 渲染')
  const h1 = renderTemplate('handoff1', { ts: '20260814-172113' })
  assert.ok(h1.includes('.scratch/handoff/20260814-172113.md'), 'handoff1 {ts} 注入')
  const h2 = renderTemplate('handoff2', { file: '20260814-172113.md' })
  assert.ok(h2.includes('.scratch/handoff/20260814-172113.md'), 'handoff2 {file} 注入')
  assert.ok(!h2.includes('/read'), 'handoff2 不含 /read 命令（DSH 无此命令）')
  assert.ok(renderTemplate('fixate', {}).includes('里程碑固化点'), 'fixate 渲染')
  ok('七模板默认渲染')
}

console.log('T2: 未知占位符保留 + 自定义模板生效')
{
  templates.execute = '请处理 {title} → {url}（#{number}）'
  const out = renderTemplate('execute', { number: '365', url: 'U', title: 'T' })
  assert.strictEqual(out, '请处理 T → U（#365）')
  const withUnknown = '处理 {url} 和 {foo}'
  templates.diagnose = withUnknown
  const r = renderTemplate('diagnose', { url: 'U' })
  assert.strictEqual(r, '处理 U 和 {foo}', '未知占位符保留原样（运行层兜底）')
  templates.diagnose = ''
  ok('自定义模板替换 + 未知保留')
}

console.log('T3: 转义 {{x}} → 字面量 {x}')
{
  templates.diagnose = '不要粘贴 {{url}} 这个字面量，用 {url} 真值'
  const r = renderTemplate('diagnose', { url: 'U' })
  assert.strictEqual(r, '不要粘贴 {url} 这个字面量，用 U 真值')
  templates.diagnose = ''
  ok('双花括号转义正确')
}

console.log('T4: 校验规则')
{
  // 未知占位符拒绝
  let v = validateTemplate('diagnose', '/triage\n{urll}')
  assert.strictEqual(v.ok, false); assert.deepStrictEqual(v.unknown, ['urll'])
  // 强制缺失拒绝（execute 删 {url}）
  v = validateTemplate('execute', '只写标题 {title}')
  assert.strictEqual(v.ok, false); assert.deepStrictEqual(v.missing, ['url'])
  // handoff1 缺 {ts} 拒绝
  v = validateTemplate('handoff1', '/handoff 写到固定文件 latest.md')
  assert.strictEqual(v.ok, false); assert.deepStrictEqual(v.missing, ['ts'])
  // handoff2 缺 {file} 拒绝
  v = validateTemplate('handoff2', '/read 某文档')
  assert.strictEqual(v.ok, false); assert.deepStrictEqual(v.missing, ['file'])
  // 转义的不算未知（{{foo}} 合法）
  v = validateTemplate('fixate', '写 {{foo}} 字面量')
  assert.strictEqual(v.ok, true)
  // 全通过
  v = validateTemplate('execute', '请处理 {url}（#{number} {title}）')
  assert.strictEqual(v.ok, true)
  // fixate 无强制，任意文本通过
  v = validateTemplate('fixate', '任意内容')
  assert.strictEqual(v.ok, true)
  ok('未知/缺失/转义/通过 六种校验')
}

console.log('T5: 交接两击一致性（F1 修正）')
{
  // 默认结构
  let text = renderTemplate('handoff1', { ts: '20260814-172113' })
  assert.strictEqual(extractHandoffFile(text), '20260814-172113.md')
  // 用户自定义文件名结构（对抗式审查 F1 场景）
  templates.handoff1 = '/handoff\n\n写到 .scratch/handoff/交接-{ts}.md（相对当前工作目录）'
  text = renderTemplate('handoff1', { ts: '20260814-172113' })
  assert.strictEqual(extractHandoffFile(text), '交接-20260814-172113.md', '自定义前缀解析')
  // 第二击读同一文件
  const h2 = renderTemplate('handoff2', { file: extractHandoffFile(text) })
  assert.ok(h2.includes('.scratch/handoff/交接-20260814-172113.md'), '第二击读自定义文件名')
  // 解析失败兜底 handoffTs + '.md'
  templates.handoff1 = '/handoff 没有文件名'
  assert.strictEqual(extractHandoffFile(renderTemplate('handoff1', { ts: '20260814-172113' })), null)
  templates.handoff1 = ''
  ok('默认/自定义/兜底三种文件名解析')
}

console.log('T6: 沉淀模板可编辑（无强制占位符）')
{
  templates.fixate = '自定义沉淀：把 {url} 记下来'
  const r = renderTemplate('fixate', { url: 'U' })
  assert.strictEqual(r, '自定义沉淀：把 U 记下来')
  templates.fixate = ''
  ok('fixate 模板渲染')
}

console.log(`\n全部通过：${passed}/6 组`)
