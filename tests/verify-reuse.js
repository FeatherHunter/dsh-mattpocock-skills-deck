// verify-reuse.js — 复用门禁（G1 规格 #391 承 R2 #375 §5 轻量两问）
// 作用：卡住新增的全局 store 直读与 portal/翻转样板重复，按 2 标记 3 即抽 5 必卡执行
// 形态：文本扫描（同 verify-no-cross-import 轻量），白名单仅内核底座与悬浮样板真源
// 用法: node tests/verify-reuse.js
const fs = require('fs')
const path = require('path')
let failed = false
let warned = false
const check = (ok, level, msg) => {
  const tag = ok ? '  PASS ' : (level === 'error' ? '  FAIL ' : '  WARN ')
  console.log(tag + msg)
  if (!ok && level === 'error') failed = true
  if (!ok && level === 'warn') warned = true
}
const ALLOWLIST = new Set([
  'src/client/kernel/portal.js',
  'src/client/views/primitives/HoverTip.js',
  'src/client/views/primitives/Tip.js',
])
function collectFiles(dir, out) {
  const abs = path.resolve(dir)
  if (!fs.existsSync(abs)) return
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, ent.name)
    if (ent.isDirectory()) collectFiles(rel, out)
    else if (ent.isFile() && rel.endsWith('.js')) out.push(rel)
  }
}
const primitives = []
collectFiles('src/client/views/primitives', primitives)
const allLeaves = []
collectFiles('src/client/views', allLeaves)
collectFiles('src/client/panel', allLeaves)
collectFiles('src/client/statusbar', allLeaves)
collectFiles('src/client/floating', allLeaves)
collectFiles('src/client/kernel', allLeaves)
const Q1_RE = /(\buseStore\b|\bemit\s*\(|s\.cfgTip|s\.skillTip|s\.skillHover)/
let q1Hits = []
for (const f of primitives) {
  if (ALLOWLIST.has(f)) continue
  let src = ''
  try { src = fs.readFileSync(f, 'utf8') } catch (e) { continue }
  if (Q1_RE.test(src)) q1Hits.push(f)
}
const Q2_RE = /(getBoundingClientRect.*flip|caret.*rotate|zIndex:\s*2147483000.*fixed|portalTop.*fixed|tip\.x \+ 238|estW|flip.*auto)/
const Q2_ALT = (src) => src.includes('getBoundingClientRect') && src.includes('portalTop')
const Q2_STOCK_ALLOW = new Set([
  'src/client/views/shared/Tabs.js',
  'src/client/floating/Pop.js',
  'src/client/kernel/portal.js',
  'src/client/views/primitives/HoverTip.js',
])
let q2Hits = []
for (const f of allLeaves) {
  if (ALLOWLIST.has(f)) continue
  if (Q2_STOCK_ALLOW.has(f)) continue
  const STOCK_NON_TOOLTIP = new Set([
    'src/client/panel/Overlay.js',
    'src/client/statusbar/StatusBar.js',
    'src/client/index.js',
    'src/client/floating/SkillFloatList.js',
    'src/client/kernel/styles.js',
    'src/client/kernel/store.js',
    'src/client/kernel/slotRenderer.js',
  ])
  if (STOCK_NON_TOOLTIP.has(f)) continue
  let src = ''
  try { src = fs.readFileSync(f, 'utf8') } catch (e) { continue }
  if (Q2_RE.test(src) || Q2_ALT(src)) q2Hits.push(f)
}
console.log('复用门禁（G1 #391 · R2 §5 两问 · 2 标记 3 即抽 5 必卡）')
console.log('  扫描范围：Q1 primitives （' + primitives.length + ' 文件）| Q2 全 UI 叶（白名单与存量豁免除外）')
console.log('  白名单：' + Array.from(ALLOWLIST).join(', '))
console.log('  Q1 全局 store 直读 命中 ' + q1Hits.length + ' 处：' + (q1Hits.length ? q1Hits.join(', ') : '0'))
console.log('  Q2 portal/翻转重复 命中 ' + q2Hits.length + ' 处：' + (q2Hits.length ? q2Hits.join(', ') : '0'))
if (q1Hits.length === 0) check(true, 'ok', 'Q1 primitives 全局 store 直读 0 处（通过）')
else if (q1Hits.length === 1) check(true, 'ok', 'Q1 1 处（未达 2 标记）：' + q1Hits[0])
else if (q1Hits.length === 2) check(false, 'warn', 'Q1 2 处标记（// TODO reuse:q1）：' + q1Hits.join(', ') + ' — 下一处即抽')
else check(false, 'error', 'Q1 ' + q1Hits.length + ' 处即抽（≥3）：' + q1Hits.join(', ') + ' — 复用控件请改为 props 注入经 DswsCtx')
if (q2Hits.length === 0) check(true, 'ok', 'Q2 portal/翻转重复 0 处（通过）')
else if (q2Hits.length === 1) check(true, 'ok', 'Q2 1 处（未达 2 标记）：' + q2Hits[0])
else if (q2Hits.length === 2) check(false, 'warn', 'Q2 2 处标记（// TODO reuse:q2）：' + q2Hits.join(', ') + ' — 下一处即抽')
else check(false, 'error', 'Q2 ' + q2Hits.length + ' 处即抽（≥3）：' + q2Hits.join(', ') + ' — 请复用 kernel/portal 与 HoverTip')
if (q1Hits.length >= 5) check(false, 'error', 'Q1 5 处必卡（≥5）— 合并门禁卡住，不抽不合入')
if (q2Hits.length >= 5) check(false, 'error', 'Q2 5 处必卡（≥5）— 合并门禁卡住，不抽不合入')
for (const f of primitives) {
  try {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).length
    if (lines > 200) { console.log('  FAIL 粒度 ' + f + ' ' + lines + ' 行 >200'); failed = true } else console.log('  PASS 粒度 ' + f + ' ' + lines + ' 行 ≤200')
  } catch (e) {}
}
for (const f of primitives) {
  try {
    const src = fs.readFileSync(f, 'utf8')
    if (/from\s+['"]\.\.\/primitives\//.test(src) || /from\s+['"]\.\/.*primitives/.test(src) || (/import.*primitives/.test(src) && !ALLOWLIST.has(f))) {
      console.log('  FAIL 横向依赖 ' + f + ' 含 primitives 间 import（同层禁互 import）'); failed = true
    }
  } catch (e) {}
}
if (failed) { console.log('\n存在失败（门禁卡住）'); process.exit(1) }
if (warned) { console.log('\n存在警告（2 标记，下处即抽）— 不阻断但需记 TODO reuse'); }
else console.log('\n全部通过 — 复用阈值 2 标记 3 即抽 5 必卡生效，白名单合规')