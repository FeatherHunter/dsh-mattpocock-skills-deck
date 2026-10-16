// verify-takeable-menu.js — 状态栏可接悬停需求入口的文案成对门（issue #638）
// 用法: node tests/verify-takeable-menu.js
// 验证：中英文文案 nav.takeableNew（中文需求 / 英文 Requirement）与新增需求提示标题双语成对
let failed = false
const bad = function (where, msg) { failed = true; console.log('  FAIL', where, msg) }
const ok = function (where, msg) { console.log('  PASS', where, msg) }
// 取源走共用入口（#1207 立的 tests/lib/source-text.ts）：locale-panel 已从 .js 转成 .ts，
// 按旧路径直接读会读到构建产物（字符串改双引号），下面只认单引号的断言会误报。
const { sourceText } = require('./lib/source-text.ts')

// ---------- 文案成对 ----------
try {
  const loc = sourceText('src/client/kernel/locale-panel.js')
  if (loc.indexOf("'nav.takeableNew': '需求'") < 0) bad('locale-panel zh', '缺中文需求文案')
  else if (loc.indexOf("'nav.takeableNew': 'Requirement'") < 0) bad('locale-panel en', '缺英文 Requirement 文案')
  else if (loc.indexOf('新增需求 prompt') < 0) bad('locale-panel title', '缺新增需求提示标题')
  else ok('locale-panel', '中英文需求文案成对')
} catch (e) { bad('locale-panel', '读取失败 ' + e.message) }

if (failed) { console.log('\n存在失败 — verify-takeable-menu 未通过'); process.exit(1) }
console.log('\n全部通过 — 可接悬停需求入口契约生效')
