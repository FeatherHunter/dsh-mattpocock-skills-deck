#!/usr/bin/env node
// tests/verify-issue529-checks-i18n.js — #529 回归守卫：英文版下环境检查面板零中文
// 用法：node tests/verify-issue529-checks-i18n.js（在插件根目录；无需网络）
// 背景：环境检查面板的标题栏与按钮早已走词条，但十条检查项标题、行内说明与底部诊断卡
// 是写死的中文或直取中文兜底，且链请求没带语言导致 host 明细恒为中文。本门禁钉住四条验收判据。
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }
const check = function (cond, name) { if (cond) ok(name); else bad(name) }
const read = function (f) { return fs.readFileSync(path.join(root, f), 'utf8') }

const locSrc = read('src/client/kernel/locale-panel.js') + read('src/client/kernel/locale-flow.js') + read('src/client/kernel/locale-word.js')
const hasPair = function (k) { return locSrc.split("'" + k + "':").length - 1 === 2 }

// 判据 1：检查项翻译键中英成对（与 check-catalog-views.js 的 i18nKey 一字对齐，含后端动态键）
const catalogKeys = []
;[...read('src/shared/tracker/check-catalog-views.js').matchAll(/i18nKey:\s*'([^']+)'/g)].forEach(function (m) {
  if (/^check\.[a-zA-Z0-9_.:\-]+\.(pass|fail)$/.test(m[1]) && catalogKeys.indexOf(m[1]) < 0) catalogKeys.push(m[1])
})
check(catalogKeys.length >= 12, '目录静态翻译键可枚举（' + catalogKeys.length + ' 个）')
const backendIds = ['gh:remote', 'gh:installed', 'gh:authed', 'gh:repoAccess', 'gh:labels', 'glab:installed', 'glab:authed', 'glab:repoAccess', 'md:scratchWritable', 'md:parseOk']
backendIds.forEach(function (id) {
  catalogKeys.push('check.' + id + '.pass')
  catalogKeys.push('check.' + id + '.fail')
})
const missingKeys = catalogKeys.filter(function (k) { return !hasPair(k) })
check(!missingKeys.length, '全部检查项键中英成对' + (missingKeys.length ? '（缺：' + missingKeys.slice(0, 4).join(', ') + '）' : '（' + catalogKeys.length + ' 键）'))

// 判据 2：面板行内与诊断卡文案键中英成对
const chromeKeys = ['env.diagTitle', 'env.diagBackend', 'env.diagRepo', 'env.diagLocal', 'env.diagFields', 'env.diagNote', 'env.diagViewLog', 'env.diagLogged', 'env.actRun', 'env.actOpenUrl', 'env.actFillForm', 'env.actRefresh', 'env.actInjectGuide', 'env.actFailed', 'env.actUnknown', 'env.actUnsupported', 'env.formRequired', 'env.formPattern', 'env.formNoSubmit', 'env.formSubmitted', 'env.formSubmitFail', 'env.formPick', 'env.formReset', 'env.formSubmit', 'env.chainDone']
const missingChrome = chromeKeys.filter(function (k) { return !hasPair(k) })
check(!missingChrome.length, '面板行内与诊断卡键中英成对' + (missingChrome.length ? '（缺：' + missingChrome.slice(0, 4).join(', ') + '）' : '（' + chromeKeys.length + ' 键）'))

// 判据 3：标题解析走翻译键，不再直取中文兜底
const renderer = read('src/client/views/shared/ChainRenderer.js')
const checksTab = read('src/client/views/ChecksTab.js')
const modal = read('src/client/views/shared/SwitchConfirmModal.js')
check(renderer.indexOf('export const checkShowTitle') >= 0, 'ChainRenderer 导出标题解析单源 checkShowTitle')
check(renderer.indexOf('show.fallback || s.show.title || s.show.i18nKey') < 0 && renderer.indexOf('show.fallback || show.title || show.i18nKey') < 0, 'ChainRenderer 不再直取 fallback 当标题')
check(checksTab.indexOf('checkShowTitle(s.show, s.id)') >= 0, 'ChecksTab 行标题经 checkShowTitle 解析')
check(checksTab.indexOf('show.fallback || s.show.title || s.show.i18nKey') < 0, 'ChecksTab 不再直取 fallback 当标题')
check(modal.indexOf('checkShowTitle') >= 0, '切换确认框检查名与检查页同口径')
check(checksTab.indexOf("tr('env.diagTitle')") >= 0 && checksTab.indexOf("tr('env.diagBackend')") >= 0 && checksTab.indexOf("tr('env.diagViewLog')") >= 0, '诊断卡标题/后端/按钮走词条')

// 判据 4：语言进链路（客户端传语言、客户端缓存分语言、宿主按语言产出明细）
const probe = read('src/client/kernel/probe-chain.js')
check(/host\.call\('wf\.chain', args\)/.test(probe) && probe.indexOf('lang: _langForChain') >= 0, '链请求携带当前语言')
check(/getChainCacheKey\s*=\s*function\s*\(cwd,\s*backendId,\s*lang\)/.test(read('src/client/kernel/store-snapshot.js')), '客户端链缓存键含语言维')
const detect = read('src/host/detectChain.js')
check(detect.indexOf("args.lang === 'en'") >= 0, '宿主按请求语言产出明细（防回退）')
// 判据 4b：语言切换即时重取（面板开着切语言，说明行不许停留在旧语言）
const switcher = read('src/client/kernel/store-switch.js')
check(switcher.indexOf('lang: criLang') >= 0, '切换确认框链请求携带当前语言')
check(probe.indexOf('st.chainLangLoaded = _langForChain') >= 0, '链加载记下快照语言')
check(checksTab.indexOf('st.chainLangLoaded !== curLang') >= 0 && checksTab.indexOf('loadChain(st, true)') >= 0, '检查页语言变化时重取链快照')

// 判据 5：两渲染文件中文字符串清零（防回退收紧，与 locale-completeness 基线同口径）
function cjkCount(buf) {
  const clean = buf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  let n = 0
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g
  let m
  while ((m = re.exec(clean)) !== null) {
    const s = m[1] !== undefined ? m[1] : m[2]
    if (/[一-鿿]/.test(s)) n++
  }
  return n
}
check(cjkCount(checksTab) === 0, 'ChecksTab 中文字符串清零')
check(cjkCount(renderer) === 0, 'ChainRenderer 中文字符串清零')

console.log(failed ? '\n[issue529-checks-i18n] FAIL (' + passed + ' passed)' : '\n全部通过 · 环境检查英文零中文门禁生效 (' + passed + ')')
process.exit(failed ? 1 : 0)
