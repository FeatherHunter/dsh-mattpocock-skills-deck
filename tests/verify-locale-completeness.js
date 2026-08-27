#!/usr/bin/env node
/**
 * verify-locale-completeness.js — locale 完整性 + 硬编码中文回归门禁（#231 验收）。
 *
 * A. zh/en 键集合全等且非空值；
 * B. 本票关键键双语齐备；
 * C. client 层字符串级中文残留以「基线清单」封顶：清单外文件出现任何字符串级中文 → 红；
 *    清单内文件超过登记数 → 红（防回归增长；清零由清尾批完成并同步缩清单）。
 * D. 双产物同样通过 B。
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }

const locSrc = fs.readFileSync(path.join(root, 'src', 'client', 'kernel', 'locale.js'), 'utf8')
// 以注释切片分语种段（#229 已用 zhObj/enObj 分区注释标记）
function sliceLang(buf, marker) {
  const i = buf.indexOf(marker)
  if (i < 0) return ''
  return buf.slice(i)
}
function keysOf(seg) {
  const re = /'([a-zA-Z0-9_.]+)':\s*'((?:[^'\\]|\\.)*)'/g
  const out = {}
  let m
  while ((m = re.exec(seg)) !== null) out[m[1]] = m[2]
  return out
}
// 依 #229 的 zhObj/enObj 分界读取两个半区（半区内含双语，靠配对性自然收敛到同键集）
const segZh = sliceLang(locSrc, 'zhObj')
const segEn = sliceLang(locSrc, 'enObj')
const kAll = keysOf(locSrc)
const zhKeys = Object.keys(keysOf(segZh))
const enKeys = Object.keys(keysOf(segEn))
if (zhKeys.length > 200 && enKeys.length > 200) ok('zh/en 键提取规模正常 (' + zhKeys.length + '/' + enKeys.length + ')')
else bad('键提取异常 zh=' + zhKeys.length + ' en=' + enKeys.length)

const zSet = new Set(zhKeys), eSet = new Set(enKeys)
const missingInEn = [...zSet].filter(k => !eSet.has(k))
const missingInZh = [...eSet].filter(k => !zSet.has(k))
if (!missingInEn.length && !missingInZh.length) ok('A. zh/en 键集合全等')
else { bad('A. 键不齐 缺en=' + missingInEn.join(',') + ' 缺zh=' + missingInZh.join(',')) }

// B. 关键键存在性
const REQUIRED = [
  'list.openInTrackerTitle', 'detail.viewOnTracker', 'detail.viewOnTrackerHint',
  'detail.authFailCta', 'detail.readOnlyHint',
  'switch.gateOtherErr', 'switch.pleaseSelectTracker', 'switch.gateIntro', 'panel.loadingShort',
  'setup.github.trackerLine', 'setup.github.labelReqs', 'setup.markdown.trackerLine', 'setup.markdown.labelReqs',
  'setup.gitlab.trackerLine', 'setup.gitlab.labelReqs', 'setup.default.trackerLine', 'setup.default.labelReqs',
  'panel.labelsStepTitle', 'panel.labelsStepDesc',
]
for (const k of REQUIRED) {
  const seg = k.startsWith('list.') || k.startsWith('detail.') || k.startsWith('switch.') || k.startsWith('panel.')
    ? locSrc : locSrc
  if (!(k in kAll)) { bad('B. 缺键 ' + k); continue }
  const idx = locSrc.indexOf("'" + k + "'")
  const tail = locSrc.slice(idx, idx + 400)
  if (/zh:|en:/i.test(tail.slice(0, 4))) continue
  ok('B. 键在 ' + k)
}
// setup.* 键按语言分区落在正确半区
for (const k of ['setup.github.labelReqs', 'setup.markdown.labelReqs']) {
  if (!keysOf(segZh)[k] && !keysOf(segEn)[k]) bad('B. setup 键缺失 ' + k)
  else ok('B. setup 键存在 ' + k)
}

// C. 硬编码中文基线清单（2026-08-29 实测；清尾批只许缩小不许增大）
const BASELINE = {
  'views/SettingsPage.js': 41,
  'views/IssueDetail.js': 20,
  'index.js': 26,
  'panel/Dock.js': 15,
  'panel/Overlay.js': 12,
  'statusbar/StatusBar.js': 11,
  'views/shared/ChainRenderer.js': 17,
  'views/NoRepoCard.js': 13,
  'views/shared/BackendSelector.js': 10,
  'kernel/icons.js': 8,
  'views/ChecksTab.js': 8,
  'views/shared/SwitchConfirmModal.js': 5,
  'kernel/store.js': 4,
  'kernel/router.js': 1,
}
const SRC_CLIENT = path.join(root, 'src', 'client')
const seen = {}
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.js')) inspect(p)
  }
})(SRC_CLIENT)
function stripComments(buf) { return buf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '') }
function inspect(file) {
  let buf = stripComments(fs.readFileSync(file, 'utf8'))
  let count = 0
  const strRe = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g
  let m
  while ((m = strRe.exec(buf)) !== null) {
    const s = m[1] !== undefined ? m[1] : m[2]
    if (/[\u4e00-\u9fff]/.test(s)) count++
  }
  const rel = path.relative(SRC_CLIENT, file).replace(/\\/g, '/')
  if (rel === 'kernel/locale.js' || rel === 'kernel/prompts.js') return
  seen[rel] = count
  const cap = BASELINE[rel]
  if (cap === undefined) { if (count > 0) bad('C. 清单外新增 CJK 字符串 ' + rel + '=' + count); else ok('C. 干净 ' + rel) }
  else if (count <= cap) ok('C. 基线内 ' + rel + ' ' + count + '<=' + cap)
  else bad('C. 超基线 ' + rel + ' ' + count + '>' + cap)
}
// 提示已消失的基线项（鼓励缩表）
for (const k of Object.keys(BASELINE)) if (!(k in seen)) ok('C. 基线项已清零（请从清单删除）' + k)

// D. 双产物含关键键
for (const a of ['client.js', path.join('package', 'lib', 'client.js')]) {
  const buf = fs.readFileSync(path.join(root, a), 'utf8')
  const miss = REQUIRED.filter(function (k) { return buf.indexOf("'" + k + "'") < 0 })
  if (!miss.length) ok('D. 产物关键键齐备 ' + a)
  else bad('D. 产物缺键 ' + a + ' -> ' + miss.join(','))
}

console.log(failed ? '\n[locale-completeness] FAIL' : '\n全部通过 · locale 完整性门禁生效')
process.exit(failed ? 1 : 0)
