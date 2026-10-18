// verify-log-statusbar.ts — 状态栏门禁。
// 用法：在插件根目录执行 node tests/verify-log-statusbar.ts，可独立运行。
//
// 这份文件原来还有「一～六」六段：读 StatusLogMenu.js、StatusBar.js、logStore.js、logPhones.js、
// LogDangerConfirm.js、scripts/build.mjs、src/client/index.js 的源码文本，断言里面必须出现某个色值、
// 某个调用字面、某个行数或某个事件名。那些断言盯的是手写源码写成什么样，改个等价写法就会变红，
// 已按维护者要求整段删除。
//
// 现在只剩一条：读 locale 数据模块，按 key 核对文案字典里 22 个状态栏文案键中英各一条。
// 这核的是字典内容（键与译文是否配齐），不是源码写法。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 读手写源时同名 .ts 优先（这份源早晚会按 #1239 转成 TypeScript），退回 .js。
// 写死 .js 的毛病是源一改名就读不到，第一条 check 当场假红，跟字典内容好不好没关系。
const readSource = (base) => {
  try { return read(base + '.ts') } catch (e) { return read(base + '.js') }
}

console.log('状态栏门禁（只保留文案键双语配对核对）')

let locale = ''
try { locale = readSource('src/client/kernel/locale-word'); check(true, '文案文件可读') } catch (e) { check(false, '文案文件可读') }

// 文案键双语配对（每键恰出现两次：中＋英）。
// 单引号与双引号写法都算命中——只看单引号会把 esbuild 转译后的产物误报成缺键（#1209 起 locale 真源是 .ts）。
const KEYS = ['logmenu.title', 'logmenu.titleOn', 'logmenu.export', 'logmenu.openDir', 'logmenu.copyPath', 'logmenu.clear', 'logmenu.note', 'logmenu.clearTitle', 'logmenu.clearDesc', 'logmenu.cancel', 'logmenu.confirmClear', 'logmenu.clearing', 'logmenu.exporting', 'logtoast.exported', 'logtoast.exportFallback', 'logtoast.exportFailed', 'logtoast.openFailed', 'logtoast.pathCopied', 'logtoast.cleared', 'logtoast.clearEmpty', 'logtoast.clearFailed', 'logtoast.hostUnavailable']
const countKey = (text, k) => text.split("'" + k + "':").length - 1 + (text.split('"' + k + '":').length - 1)
const unpaired = KEYS.filter((k) => countKey(locale, k) !== 2)
check(unpaired.length === 0, '22 个文案键中英配对' + (unpaired.length ? ' —— 缺：' + unpaired.join('、') : ''))

console.log(failed ? '\n存在失败 — verify-log-statusbar 未通过' : '\n全部通过 — 状态栏文案键核对生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
