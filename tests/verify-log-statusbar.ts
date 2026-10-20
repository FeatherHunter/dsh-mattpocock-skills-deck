// verify-log-statusbar.ts — 状态栏门禁。
// 用法：在插件根目录执行 node tests/verify-log-statusbar.ts，可独立运行。
//
// 这份文件原来还有「一～六」六段：读 StatusLogMenu.js、StatusBar.js、logStore.js、logPhones.js、
// LogDangerConfirm.js、scripts/build.mjs、src/client/index.js 的源码文本，断言里面必须出现某个色值、
// 某个调用字面、某个行数或某个事件名。那些断言盯的是手写源码写成什么样，改个等价写法就会变红，
// 已按维护者要求整段删除。
//
// 现在只剩一条：读界面词表真源，按 key 核对文案字典里 22 个状态栏文案键中英各一条。
// 这核的是字典内容（键与译文是否配齐），不是源码写法。
//
// #1294 把界面词表从十份手写片段（src/client/kernel/locale-*.ts）搬到 config/copy/*.yaml 之后，
// 旧路径 src/client/kernel/locale-word 已删除，真源变成生成物 src/client/kernel/locale-data.ts。
// 「旧路径 → 生成物里的哪一段」的换算只写在 tests/lib/locale-data.ts 一处，这里直接取 word 族那一段：
// 一段里中英各写一遍，所以每个键照旧应当恰好出现两次。
const path = require('path')
const { ensureLocaleData, legacyLocaleFamily, familySectionSource } = require('./lib/locale-data.ts')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('状态栏门禁（只保留文案键双语配对核对）')

let locale = ''
try {
  const family = legacyLocaleFamily('src/client/kernel/locale-word.ts')
  ensureLocaleData(ROOT)
  locale = familySectionSource(family, ROOT)
  check(true, '文案真源可读（生成物 src/client/kernel/locale-data.ts 的 ' + family + ' 族）')
} catch (e) {
  check(false, '文案真源可读（' + ((e && e.message) || e) + '）')
}

// 文案键双语配对（每键恰出现两次：中＋英）。
// 单引号与双引号写法都算命中——生成物按 config/copy 的键值烘出来之后，两种引号形态都可能出现。
const KEYS = ['logmenu.title', 'logmenu.titleOn', 'logmenu.export', 'logmenu.openDir', 'logmenu.copyPath', 'logmenu.clear', 'logmenu.note', 'logmenu.clearTitle', 'logmenu.clearDesc', 'logmenu.cancel', 'logmenu.confirmClear', 'logmenu.clearing', 'logmenu.exporting', 'logtoast.exported', 'logtoast.exportFallback', 'logtoast.exportFailed', 'logtoast.openFailed', 'logtoast.pathCopied', 'logtoast.cleared', 'logtoast.clearEmpty', 'logtoast.clearFailed', 'logtoast.hostUnavailable']
const countKey = (text, k) => text.split("'" + k + "':").length - 1 + (text.split('"' + k + '":').length - 1)
const unpaired = KEYS.filter((k) => countKey(locale, k) !== 2)
check(unpaired.length === 0, '22 个文案键中英配对' + (unpaired.length ? ' —— 缺：' + unpaired.join('、') : ''))

console.log(failed ? '\n存在失败 — verify-log-statusbar 未通过' : '\n全部通过 — 状态栏文案键核对生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
