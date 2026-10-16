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
console.log(failed ? '\\n\u5B58\u5728\u5931\u8D25 \u2014 verify-891 \u672A\u901A\u8FC7' : '\\n\u5168\u90E8\u901A\u8FC7 \u2014 ' + total + ' \u9879\u65AD\u8A00')
// 退出码用 process.exitCode 而不是 process.exit()：这个文件里用 vm.compileFunction 造函数，
// 在 Windows 上强行 process.exit() 偶尔会撞 Node 内部的 libuv 断言崩溃（退出码变成 0xC0000409），
// 让门禁偶发判红；交给进程自然退出，退出码语义完全一样（失败 1、成功 0）。
process.exitCode = failed ? 1 : 0
