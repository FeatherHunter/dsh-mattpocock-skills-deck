// tests/verify-836-mapdetail-execute-color.js — #836：地图详情页底部执行按钮与顶部颜色一致
// 用法: node tests/verify-836-mapdetail-execute-color.js（在插件根目录；无需 gh / 网络）
// 背景：同一张地图未完成且有子票时，顶部执行按钮是紫色 #c084fc（主要按钮默认样式），
//   底部仪式环下执行按钮却写死绿色 #4ade80。空地图（橙 #f59e0b）与全部完成（绿 #3fb950）
//   两边本来就一致，只有执行态不一致。行级执行标准色也是紫色（store-derived.js）。
// 验收（独立真源 = 顶部默认样式 + 行级标准色，不是底部代码自己）：
//   1) 底部执行态底色与默认主要按钮同值（从样式真源实时取出，默认一变这里跟着红），不再是绿色
//   2) 底部执行态字色同样与默认同值，不再是绿色系深字
//   3) 空状态与完成态两边保持不变（橙 #f59e0b / 绿 #3fb950 仍在）
//   4) 顶部执行态仍走默认样式（不写死底色），行级执行标准仍是紫色
const fs = require('fs')
let failed = false
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('836: 地图详情页底部执行按钮与顶部颜色一致')

const detail = fs.readFileSync('src/client/views/MapDetail.js', 'utf8')
const top = fs.readFileSync('src/client/views/MapDetailTop.js', 'utf8')
const derived = fs.readFileSync('src/client/kernel/store-derived.js', 'utf8')
const styles = fs.readFileSync('src/client/kernel/styles.js', 'utf8')

// 取底部执行分支的样式块：从 map.executeTitle 那一行起，取到本按钮结尾
const bottomExecIdx = detail.indexOf("tr('map.executeTitle')")
check(bottomExecIdx >= 0, '底部存在执行分支（map.executeTitle）')
// 只看代码本身：先去掉行注释，避免注释里提到的旧色值干扰判定
const bottomExecRaw = bottomExecIdx >= 0 ? detail.slice(bottomExecIdx, bottomExecIdx + 800) : ''
const bottomExecSlice = bottomExecRaw.replace(/\/\/[^\n]*/g, '')

// 1) 底部执行态底色与默认主要按钮同值（默认一变这里跟着红，而不是悄悄裂开），不再是绿色
const norm = function (s) { return String(s || '').toLowerCase() }
const defBg = (styles.match(/\.dsws-btn\.primary\{background:(#[0-9a-fA-F]{6})/) || [])[1]
const defTx = (styles.match(/\.dsws-btn\.primary\{[^}]*color:(#[0-9a-fA-F]{6})/) || [])[1]
check(!!defBg && !!defTx, '读得出默认主要按钮的底色与字色（判据的真源）')
const bottomBg = (bottomExecSlice.match(/background:\s*'(#[0-9a-fA-F]{6})'/) || [])[1]
check(!!bottomBg, '读得出底部执行态的底色写法')
check(!!defBg && !!bottomBg && norm(bottomBg) === norm(defBg), '底部执行态底色与默认主要按钮同值（今日同为紫色 ' + norm(defBg) + '）')
check(!bottomExecSlice.includes('#4ade80'), '底部执行态不再写死绿色 #4ade80')

// 2) 底部执行态字色同样与默认同值，不再是绿色系深字
const bottomTx = (bottomExecSlice.match(/,\s*color:\s*'(#[0-9a-fA-F]{6})'/) || [])[1]
check(!!bottomTx, '读得出底部执行态的字色写法')
check(!!defTx && !!bottomTx && norm(bottomTx) === norm(defTx), '底部执行态字色与默认主要按钮同值（今日同为 ' + norm(defTx) + '）')
check(!bottomExecSlice.includes('#04120a'), '底部执行态字色不再是绿色系 #04120a')

// 3) 空状态与完成态保持不变（两边仍在，不回归）
check(detail.includes("'#f59e0b'") && top.includes("'#f59e0b'"), '空地图橙色 #f59e0b 两边仍在')
check(detail.includes("'#3fb950'") && top.includes("'#3fb950'"), '全部完成绿色 #3fb950 两边仍在')

// 4) 顶部执行态仍走默认样式（执行分支不写底色），行级执行标准仍是紫色
const topExecIdx = top.indexOf("tr('map.executeTitle')")
const topExecSlice = topExecIdx >= 0 ? top.slice(topExecIdx, topExecIdx + 800) : ''
check(topExecIdx >= 0, '顶部存在执行分支（map.executeTitle）')
check(!topExecSlice.includes('#4ade80') && !topExecSlice.includes('#c084fc'), '顶部执行态仍走默认主要按钮样式（不写死底色）')
check(styles.includes('.dsws-btn.primary{background:#c084fc'), '默认主要按钮底色仍是紫色 #c084fc（顶部的独立真源）')
check(derived.includes("return mk('play', tr('act.execute'), rowActionText(st, x), '#c084fc')"), '行级执行标准仍是紫色 #c084fc（另一处独立真源）')

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
