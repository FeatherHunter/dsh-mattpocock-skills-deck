// verify-config-defaults.js —— #519 落地 A 默认文本存在检查（防误删后台默认提示词）。
//
// 背景：落地 A 只删配置页的人改入口（模板编辑器），后台默认提示词与行级快捷按钮必须保留。
// 本门禁锁死三件事，删错即红：
//   1) config.js 的 TPL_DEFAULT 九条全在，每条仍走 promptText 取默认文本；
//   2) prompts.js 的 PROMPTS 注册表九条全在（tpl.diagnose/fix/discuss/research/prototype/execute/handoff1/handoff2 + fixate）；
//   3) store-derived.js 的行级快捷按钮仍能渲染九条模板（含 research/prototype 两条分支）。
// 另锁两件事防手滑扩大：
//   4) SettingsPage.js 已无模板编辑符号（编辑器/底部栏/技能集卡/宽度组调用全清）；
//   5) 本地存档两把钥匙名不动（dsws.cfg / dsws.templates），旧模板读取仍合并。
//
// 用法：在插件根目录执行 node tests/verify-config-defaults.js，可独立运行。
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }

const NINE = ['diagnose', 'fix', 'discuss', 'research', 'prototype', 'execute', 'handoff1', 'handoff2', 'fixate']

// 1) TPL_DEFAULT 九条
try {
  const configSrc = read('src/client/kernel/config.js')
  const missing = NINE.filter(function (id) {
    return configSrc.indexOf(id + ': function () { return promptText(') < 0
  })
  if (!missing.length) ok('config.js TPL_DEFAULT 九条默认文本全在')
  else bad('config.js TPL_DEFAULT 缺 ' + missing.join('、'))
} catch (e) { bad('读 config.js 失败：' + e.message) }

// 2) PROMPTS 注册表九条
try {
  const promptsSrc = read('src/client/kernel/prompts.js')
  const missing = NINE.filter(function (id) {
    const key = (id === 'fixate') ? '"fixate"' : '"tpl.' + id + '"'
    return promptsSrc.indexOf(key + ': {') < 0 && promptsSrc.indexOf(key + '": {') < 0
  })
  if (!missing.length) ok('prompts.js PROMPTS 注册表九条全在')
  else bad('prompts.js PROMPTS 注册表缺 ' + missing.join('、'))
} catch (e) { bad('读 prompts.js 失败：' + e.message) }

// 3) 九条默认文本在客户端仍有调用（行级五个分支走 renderTemplate，执行/交接/沉淀走各自调用点）
try {
  const walk = function (dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (e.name.endsWith('.js')) out.push(fs.readFileSync(p, 'utf8'))
    }
  }
  const all = []
  walk(path.join(root, 'src', 'client'), all)
  const tree = all.join('\n')
  const missing = NINE.filter(function (id) {
    const promptRef = (id === 'fixate') ? "promptText('fixate')" : "promptText('tpl." + id + "')"
    const renderRef = "renderTemplate('" + id + "'"
    return tree.indexOf(promptRef) < 0 && tree.indexOf(renderRef) < 0
  })
  if (!missing.length) ok('客户端九条默认文本仍有调用（行级按钮与执行交接沉淀入口未断）')
  else bad('客户端默认文本调用缺 ' + missing.join('、'))
} catch (e) { bad('扫描 src/client 失败：' + e.message) }

// 4) 设置页人改入口已清
try {
  const settingsSrc = read('src/client/views/SettingsPage.js')
  const gone = ['TPL_EDIT_IDS', 'const tplCard', 'const validateAll', "tr('cfg.saveAll')", "tr('cfg.resetAll')",
    "tr('matte.", "tr('cfg.panelWidth')", "tr('cfg.tplEditor')", "tr('cfg.startTpl')", "tr('cfg.saved')"]
  const stayed = gone.filter(function (s) { return settingsSrc.indexOf(s) >= 0 })
  if (!stayed.length) ok('SettingsPage.js 人改入口符号已清（编辑器/底部栏/技能集卡/宽度组）')
  else bad('SettingsPage.js 残留人改入口 ' + stayed.join('、'))
} catch (e) { bad('读 SettingsPage.js 失败：' + e.message) }

// 5) 两把钥匙名不动且旧模板仍合并读取
try {
  const configSrc = read('src/client/kernel/config.js')
  const keysOk = configSrc.indexOf("CFG_KEY = 'dsws.cfg'") >= 0 && configSrc.indexOf("TPL_KEY = 'dsws.templates'") >= 0
  const mergeOk = configSrc.indexOf('Object.assign(d, JSON.parse(raw))') >= 0
  if (keysOk) ok('本地存档两把钥匙名不动（dsws.cfg / dsws.templates）')
  else bad('本地存档钥匙名被改')
  if (mergeOk) ok('旧模板读取仍合并（忽略旧值但不丢键）')
  else bad('旧模板合并读取丢失')
} catch (e) { bad('读 config.js 失败：' + e.message) }

console.log(failed ? '\n存在失败 — verify-config-defaults 未通过' : '\n全部通过 — 默认文本存在检查生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
