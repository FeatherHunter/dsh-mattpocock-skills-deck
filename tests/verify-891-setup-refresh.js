// tests/verify-891-setup-refresh.js — #891 初始化黄条不消失：活跃探测顺带重算链
// 规约：复用正在看才跑的那一拍，不新开定时器，不新增日志事件；只有初始化那一步没过才多算一次。
// 用法：node tests/verify-891-setup-refresh.js
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头（本文件是 ESM，用 import 取具名导出）。
import { compileFn } from './lib/eval-probe.js'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail='') => { total++; if (ok) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg + (detail ? ' \u2014 ' + detail : '')); } }
console.log('== #891 setup \u9EC4\u6761\u81EA\u52A8\u91CD\u7B97 ==')
const chainSrc = fs.readFileSync(path.join(ROOT, 'src/client/kernel/probe-chain.js'), 'utf8')
const autoSrc = fs.readFileSync(path.join(ROOT, 'src/client/kernel/probe-auto.js'), 'utf8')
// 1. \u65B0\u7406\u7531\u5B57\u7B26\u4E32\u5B58\u5728\uFF0C\u4E14\u53EA\u589E\u4E00\u4E2A\u952E
check(chainSrc.includes("setupPending: 'setup-pending'") || chainSrc.includes('setupPending:'), 'CHAIN_EVENT_REASONS \u542B setup-pending')
check(chainSrc.includes('export const setupPendingOf'), 'setupPendingOf \u5BFC\u51FA\u5B58\u5728')
// 2. \u7EAF\u51FD\u6570\u884C\u4E3A\uFF1A\u62BD\u51FA\u6A21\u5757\u4E2D\u7684 setupPendingOf \u5355\u72EC\u6C42\u503C
let setupPendingOf = null
try {
  const m = chainSrc.match(/export const setupPendingOf = function[\s\S]*?\n    \}/)
  check(!!m, 'setupPendingOf \u6E90\u7801\u53EF\u63D0\u53D6')
  if (m) {
    const fnSrc = m[0].replace(/^\s*export const setupPendingOf/, 'const setupPendingOf')
    // 把源码里抽出的纯函数体当函数体造函数，它的自由变量 chainSteps 显式当参数名，所以走 compileFn。
    const factory = compileFn(['chainSteps'], fnSrc + '\n;return setupPendingOf;')
    setupPendingOf = factory(null)
  }
} catch (e) { check(false, 'setupPendingOf \u53EF\u6267\u884C', String((e && e.message) || e)); }
check(typeof setupPendingOf === 'function', 'setupPendingOf \u4E3A\u51FD\u6570')
if (typeof setupPendingOf === 'function') {
  const stFail = { chainSnapshot: { steps: [{ id: 'tracker:initialized', status: 'fail' }, { id: 'skill:wayfinder', status: 'done' }] } }
  const stCurrent = { chainSnapshot: { steps: [{ id: 'tracker:initialized', status: 'current' }] } }
  const stDone = { chainSnapshot: { steps: [{ id: 'tracker:initialized', status: 'done' }] } }
  const stEmpty = { chainSnapshot: { steps: [] } }
  const stNone = { chainSnapshot: { steps: [{ id: 'skill:wayfinder', status: 'fail' }] } }
  const stNoSnap = {}
  check(setupPendingOf(stFail) === true, 'initialized fail \u65F6\u9700\u91CD\u7B97')
  check(setupPendingOf(stCurrent) === true, 'initialized current \u65F6\u9700\u91CD\u7B97')
  check(setupPendingOf(stDone) === false, '\u5DF2 done \u65F6\u4E0D\u591A\u7B97')
  check(setupPendingOf(stEmpty) === false, '\u5FEB\u7167\u4E3A\u7A7A\u65F6\u4E0D\u591A\u7B97')
  check(setupPendingOf(stNone) === false, '\u6CA1\u6709\u521D\u59CB\u5316\u884C\u65F6\u4E0D\u591A\u7B97')
  check(setupPendingOf(stNoSnap) === false, '\u65E0\u5FEB\u7167\u65F6\u4E0D\u591A\u7B97')
  check(setupPendingOf(null) === false, 'null \u65F6\u4E0D\u4E2D\u65AD')
}
// 3. active \u5FAA\u73AF\u91CC\u6709\u94A9\u5B50\uFF0C\u4E14\u6709 typeof \u515C\u5E95\uFF0C\u4E0D\u65B0\u5F00\u5B9A\u65F6\u5668
check(autoSrc.includes('setupPendingOf'), 'active \u5FAA\u73AF\u8C03 setupPendingOf')
check(autoSrc.includes("'setup-pending'") || autoSrc.includes('"setup-pending"'), 'active \u5FAA\u73AF\u4F20 setup-pending \u7406\u7531')
check(autoSrc.includes('chainEventRefresh') && autoSrc.includes('loadChain'), 'setup \u94A9\u5B50\u4E24\u8DEF\u515C\u5E95\uFF08\u4E8B\u4EF6\u5165\u53E3\u4E0E\u76F4\u8C03\uFF09')
const timers = (autoSrc.match(/timer\.interval\s*\(/g) || []).length
check(timers === 1, '\u4E0D\u65B0\u5F00\u5B9A\u65F6\u5668\uFF08timer.interval \u4ECD 1 \u5904\uFF0C\u5B9E\u5F97 ' + timers + ' \u5904\uFF09')
const natives = (autoSrc.match(/setInterval\s*\(/g) || []).length
check(natives === 1, '\u539F\u751F setInterval \u4ECD 1 \u5904\uFF0C\u5B9E\u5F97 ' + natives + ' \u5904\uFF09')
// 4. \u4E0D\u65B0\u589E\u65E5\u5FD7\u4E8B\u4EF6\uFF1A\u94A9\u5B50\u6BB5\u4E0D\u76F4\u63A5\u8C03 log(\uFF0C\u590D\u7528 chain.event \u90A3\u4E00\u884C\uFF09
const hookAt = autoSrc.indexOf('setupPendingOf')
const probeAt = autoSrc.indexOf('probeNow(false)', Math.max(0, hookAt - 1200))
const hookWin = (hookAt >= 0 && probeAt >= 0) ? autoSrc.slice(probeAt, hookAt + 900) : ''
check(hookAt >= 0 && probeAt >= 0 && !/log\s*\(\s*['"]debug['"]/.test(hookWin), '\u94A9\u5B50\u6BB5\u4E0D\u76F4\u63A5\u8BB0\u65E5\u5FD7\uFF08\u590D\u7528 chain.event\uFF09')
// 5. \u4EC5\u5728\u6D3B\u8DC3\u53EF\u89C1\u65F6\u624D\u8DDF\u7740\u8DD1\uFF08\u590D\u7528\u73B0\u6709\u4E09\u9053\u95E8\uFF09
check(hookWin.includes('attentionVisible') || autoSrc.includes('attentionVisible'), '\u590D\u7528\u53EF\u89C1\u95E8')
console.log(failed ? '\\n\u5B58\u5728\u5931\u8D25 \u2014 verify-891 \u672A\u901A\u8FC7' : '\\n\u5168\u90E8\u901A\u8FC7 \u2014 ' + total + ' \u9879\u65AD\u8A00')
process.exit(failed ? 1 : 0)
