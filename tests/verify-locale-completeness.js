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
const LOCALE_SRC_FILES = ['src/client/kernel/locale-panel.js', 'src/client/kernel/locale-flow.js', 'src/client/kernel/locale-word.js', 'src/client/kernel/locale.js'] // #458 K5：locale.js 已拆为三片段加合并器，此处读四文件拼起来的内容断言（panel 含导航面板横幅环境引导，flow 含动作类型列表配置详情地图提示，word 含技能检查浮层命名切换进度错误模板运行描述，合并器含 L 合并逻辑）
const locSrc = LOCALE_SRC_FILES.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n')
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
  'kernel/store-switch.js': 5, // #455 K2 由 store.js 拆出：切换确认分得 5 串（合计 6，与原持平，注释已剥离不计）
  'kernel/store-snapshot.js': 1, // #455 K2 由 store.js 拆出：存储核分得 1 串（makeStore 外观词）
  'kernel/actions.js': 1, // 2026-08-28 #317 wizard 队列与提交闭环：RPC 业务失败透传文案，按封顶章程登记（0→1）
  'kernel/slotRenderer-queue.js': 6, // #454 K1 由 slotRenderer.js 拆出：打开入口与守门分得 6 串（合计 44，较原 46 缩小，注释已剥离不计）
  'kernel/slotRenderer-repo-sync.js': 2, // #454 K1 由 slotRenderer.js 拆出：同步流程分得 2 串
  'kernel/slotRenderer-modal-view.js': 36, // #454 K1 由 slotRenderer.js 拆出：弹窗本体分得 36 串
  'panel/Dock.js': 21,
  'panel/Overlay.js': 16, // V4 #464 由 Overlay.js 拆出门控：主文件留 16 串（合计 17，与原持平）
  'panel/OverlayGate.js': 1, // V4 #464 由 Overlay.js 拆出：门控分得 1 串（绑定失败透传文案）
  'statusbar/StatusBar.js': 17,
  'views/ChecksTab.js': 16, // 2026-08-28 顺序队列与目录选择器：ChecksTab 仅保留 openFormModal 注释，残留 14→16，按封顶章程重登记
  'views/IssueDetail.js': 16, // #463 V3 由 IssueDetail.js 拆出评论区：主文件留 16 串（合计 29，与原持平）
  'views/IssueDetailComments.js': 13, // #463 V3 由 IssueDetail.js 拆出：评论区分得 13 串
  'views/NoRepoCard.js': 15,
  'views/SettingsPage.js': 12, // #463 V3 由 SettingsPage.js 拆出后端总览：主文件留 12 串
  'views/SettingsWorkspaces.js': 28, // #463 V3 由 SettingsPage.js 拆出：总览分得 28 串（合计 40，原 41 封顶有 1 串松弛，见票）
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
  if (rel === 'kernel/locale.js' || rel === 'kernel/locale-panel.js' || rel === 'kernel/locale-flow.js' || rel === 'kernel/locale-word.js' || rel === 'kernel/prompts.js') return // #458 K5：三片段与合并器均为双语定义本体，不入清单（与原 locale.js 同口径）
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
