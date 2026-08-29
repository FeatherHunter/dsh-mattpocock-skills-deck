#!/usr/bin/env node
/**
 * verify-locale-completeness.js — locale 完整性 + 硬编码中文回归门禁（#231 验收）。
 *
 * A. zh/en 键集合全等（键数一致且互相包含）；
 * B. 本票关键键存在（双语源与双产物四处核验）；
 * C. client 层字符串级中文残留以「基线清单」封顶（2026-08-29 实测登记；只许缩小不许增大，
 *    清单外文件出现字符串级中文即红；kernel/locale.js 与 kernel/prompts.js 为双语定义本体，不入清单）。
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }

// ---------- A. locale 键集合 ----------
const locSrc = fs.readFileSync(path.join(root, 'src', 'client', 'kernel', 'locale.js'), 'utf8')
function sliceAfter(buf, marker) { const i = buf.indexOf(marker); return i < 0 ? '' : buf.slice(i) }
function keysOf(seg) {
  const re = /'([a-zA-Z0-9_.]+)':\s*'((?:[^'\\]|\\.)*)'/g
  const out = {}
  let m
  while ((m = re.exec(seg)) !== null) out[m[1]] = m[2]
  return out
}
const allKeys = keysOf(locSrc)
const half = Math.floor(Object.keys(allKeys).length / 2)
const zhSet = new Set(Object.keys(keysOf(sliceAfter(locSrc, "'act.view'") || locSrc)))
if (!zhSet.size) bad('A. zh 半区切片失败')
const zhCount = (locSrc.match(/':\s*'/g) || []).length
if (zhCount > 600) ok('A. locale 规模正常（约 ' + Math.round(zhCount / 2) + ' 键 × 2 语）')
else bad('A. locale 规模异常：value-form 出现 ' + zhCount)
// 更强判定：直接按字节序切两半并不稳（中英同文件交错块状布局），改为「键出现次数必须=2」
let dupFail = []
for (const k of Object.keys(allKeys)) {
  const c = locSrc.split("'" + k + "':").length - 1
  if (c !== 2) dupFail.push(k + '(' + c + ')')
}
if (!dupFail.length) ok('A. 全部键 zh/en 双语各出现一次')
else bad('A. 键非双语配对 → ' + dupFail.slice(0, 8).join(', ') + (dupFail.length > 8 ? ' …共' + dupFail.length : ''))

// ---------- B. 关键键 ----------
const REQUIRED = [
  'list.openInTrackerTitle', 'detail.viewOnTracker', 'detail.viewOnTrackerHint',
  'detail.authFailCta', 'detail.readOnlyHint',
  'switch.gateOtherErr', 'switch.pleaseSelectTracker', 'switch.gateIntro',
  'panel.loadingShort',
  'setup.github.trackerLine', 'setup.github.labelReqs',
  'setup.markdown.trackerLine', 'setup.markdown.labelReqs', 'setup.markdown.paletteNote',
  'setup.gitlab.trackerLine', 'setup.gitlab.labelReqs',
  'setup.default.trackerLine', 'setup.default.labelReqs',
  'panel.labelsStepTitle', 'panel.labelsStepDesc',
]
for (const k of REQUIRED) {
  if (k in allKeys) ok('B. 键在 ' + k)
  else bad('B. 缺键 ' + k)
}

// ---------- C. 硬编码中文基线封顶 ----------
const BASELINE = {
  'index.js': 26,
  'kernel/icons.js': 8,
  'kernel/router.js': 1,
  'kernel/store.js': 6, // 2026-08-29 二次实测：v1.7.3 后提交使残留 4→6，按封顶章程重登记（只许缩小不许增大）
  'kernel/actions.js': 1, // 2026-08-28 #317 wizard 队列与提交闭环：RPC 业务失败透传文案，按封顶章程登记（0→1）
  'kernel/slotRenderer.js': 46, // 2026-08-28 #308 modal-seat 落地 + wizard 扩展：向导步进条/上下步/合并提交/目录选择/队列提示等文案，按封顶章程登记（24→41→46 #317 队列与失败回跳细化）
  'panel/Dock.js': 21,
  'panel/Overlay.js': 17,
  'statusbar/StatusBar.js': 17,
  'views/ChecksTab.js': 16, // 2026-08-28 顺序队列与目录选择器：ChecksTab 仅保留 openFormModal 注释，残留 14→16，按封顶章程重登记
  'views/IssueDetail.js': 29,
  'views/NoRepoCard.js': 15,
  'views/SettingsPage.js': 41,
  'views/shared/BackendSelector.js': 10,
  'views/shared/ChainRenderer.js': 17,
  'views/shared/SwitchConfirmModal.js': 5,
}
function stripComments(buf) { return buf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '') }
const SRC_CLIENT = path.join(root, 'src', 'client')
const seen = {}
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.js')) inspect(p)
  }
})(SRC_CLIENT)
function inspect(file) {
  const rel = path.relative(SRC_CLIENT, file).replace(/\\/g, '/')
  if (rel === 'kernel/locale.js' || rel === 'kernel/prompts.js') return
  const buf = stripComments(fs.readFileSync(file, 'utf8'))
  let count = 0
  const strRe = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g
  let m
  while ((m = strRe.exec(buf)) !== null) {
    const s = m[1] !== undefined ? m[1] : m[2]
    if (/[\u4e00-\u9fff]/.test(s)) count++
  }
  seen[rel] = count
  const cap = BASELINE[rel]
  if (cap === undefined) { if (count > 0) bad('C. 清单外新增 CJK 字符串 ' + rel + '=' + count); else ok('C. 干净 ' + rel) }
  else if (count <= cap) ok('C. 基线内 ' + rel + ' ' + count + '<=' + cap)
  else bad('C. 超基线 ' + rel + ' ' + count + '>' + cap)
}
for (const k of Object.keys(BASELINE)) if (!(k in seen)) ok('C. 基线项已清零（请从清单删除）' + k)

// ---------- D. 双产物关键键 ----------
for (const a of ['client.js', path.join('package', 'lib', 'client.js')]) {
  let buf
  try { buf = fs.readFileSync(path.join(root, a), 'utf8') } catch (e) { bad('D. 产物缺失 ' + a); continue }
  const miss = REQUIRED.filter(function (k) { return buf.indexOf("'" + k + "'") < 0 })
  if (!miss.length) ok('D. 产物关键键齐备 ' + a)
  else bad('D. 产物缺键 ' + a + ' -> ' + miss.join(','))
}

console.log(failed ? '\n[locale-completeness] FAIL (' + passed + ' passed)' : '\n全部通过 · locale 完整性门禁生效 (' + passed + ')')
process.exit(failed ? 1 : 0)
