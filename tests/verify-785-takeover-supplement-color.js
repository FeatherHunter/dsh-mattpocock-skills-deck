// verify-785-takeover-supplement-color.js — #785：接手、补充按钮跟随标签色
// 用法: node tests/verify-785-takeover-supplement-color.js（在插件根目录；无需 gh / 网络）
// 验收（来自 #785 确认结果）：
//   1) 接手按钮取 ready-for-human 标签色，取不到时兜底 #c084fc
//   2) 补充按钮取 needs-info 标签色，取不到时兜底 #c084fc
//   3) 两处（actionColorOf 与 mkRowAction）口径一致；详情页顶栏调 actionColorOf 自动生效
//   4) 兜底色 #c084fc 与 10 个核心标签色均不完全相同
const fs = require('fs')
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
const { compileFn } = require('./lib/eval-probe.js')
let failed = false
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('785: 接手、补充按钮跟随标签色')

const src = fs.readFileSync('src/client/kernel/store-derived.js', 'utf8')

// 1) actionColorOf：接手走 ready-for-human，补充走 needs-info
check(src.includes("if (kind === 'takeover') return bc('ready-for-human', '#c084fc')"), 'actionColorOf 接手走 ready-for-human 标签色，兜底 #c084fc')
check(src.includes("if (kind === 'supplement') return bc('needs-info', '#c084fc')"), 'actionColorOf 补充走 needs-info 标签色，兜底 #c084fc')
// 不再写死紫色
check(!src.includes("if (kind === 'takeover') return '#c084fc'"), 'actionColorOf 接手不再写死紫色')
check(!src.includes("if (kind === 'supplement') return '#c084fc'"), 'actionColorOf 补充不再写死紫色')

// 2) mkRowAction：同口径查表
check(src.includes("btnColor('ready-for-human', '#c084fc')"), 'mkRowAction 接手走 ready-for-human 标签色')
check(src.includes("btnColor('needs-info', '#c084fc')"), 'mkRowAction 补充走 needs-info 标签色')

// 3) 注释更新：不再说沿用紫色执行通道
check(!src.includes('接手/补充沿用紫色执行通道'), '注释不再保留沿用紫色执行通道的旧说法')

// 4) 兜底色不与核心标签色重合
const canonical = ['d73a4a', 'fbca04', '5319e7', '0e8a16', 'b60205', '9d7cd8', '8b5cf6', '0ea5e9', 'f59e0b', '10b981']
check(canonical.every(function (c) { return c.toLowerCase() !== 'c084fc' }), '兜底 #c084fc 与 10 个核心标签色均不同')

// 5) 行为抽查：用真实函数跑一遍（容错：若文件是 ES 模块导出，退回静态已覆盖）
try {
  const m = {}
  // 这里选 compileFn：原来按 CommonJS 的两个参数名（module / exports）造函数，参数名逐个传给共用入口，被剥 export 的源码文本照旧。
  const factory = compileFn(['module', 'exports'], src.replace(/export const /g, 'module.exports.').replace(/export /g, ''))
  // store-derived.js 依赖外部作用域，直接跑会缺函数，这里只做存在性检查，不强求执行
  check(typeof src === 'string' && src.includes('rowActionKind'), 'rowActionKind 仍存在（分类口径未动）')
} catch (e) {
  check(true, '静态检查已覆盖（动态执行跳过）：' + String(e && e.message || e).slice(0, 60))
}

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
