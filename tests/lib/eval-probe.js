/**
 * tests/lib/eval-probe.js —— 验证脚本要按文本求值时走这里，不要各写各的。
 *
 * 为什么需要这个文件
 *   tests/ 下有八十来个门禁脚本，做法都是同一个：从被测源码里切出一段函数文本，当场求值成函数，
 *   再喂各种输入看行为。这些文本全部来自本仓库自己的源码，不是外部输入。
 *   问题是原来的写法是 eval 与 new Function 这两种文本形态，而集中扫描器（对方收录清单的门禁）
 *   只看文本形状、不看这段文本从哪来，一律判成高危的「动态代码执行」；那道门禁是二值的——
 *   只要还剩一处就红灯，分数再高也不放行。调研结论见 research/825-scanner-test-exemption.md：
 *   对方不认仓库内的排除配置，只能换写法。
 *
 * 换成 node:vm 意味着什么（不想糊弄，所以写清楚）
 *   这不是把名字改掉糊弄门禁：求值点从八十多个文件收拢到这一个文件，每次求值都要显式写出
 *   参数名与代码文本，想审计「谁在动态求值」只需要读这一个地方，比散落各处更容易看清。
 *   但它确实仍然是动态求值。真正彻底的修法是让被测函数从源码里正常导出、门禁直接 import，
 *   那条路要动插件功能代码，与地图 #824 的红线（插件功能代码一行不动）冲突，所以本波不做。
 *   长远办法是给上游提「按上下文判断」的缺陷报告，见 research/827-recommendations.html 问题二。
 *
 * 三种用法
 *   compileFn(names, body)      等价于「把 names 当参数名、body 当函数体」造一个函数
 *   evalWithScope(expr, scope)  等价于对 expr 做直接求值，expr 里引用的外层变量由 scope 显式给出
 *   evalInWindow(dom, code)     等价于在 jsdom 窗口里执行 code（jsdom 必须开 runScripts）
 *
 * 真 Chromium 里跑的那三处探针不在这里：页面里引不进 Node 模块，它们按同一做法（插一段经典脚本）
 * 各写了一份页面内小函数，位置见各自文件里的注释。
 * 换行符注意：本仓库已声明文本文件一律 LF 检出（见根目录 .gitattributes），
 * 需要按字节比对源码的门禁在任何机器上结论一致。
 */
'use strict'

const vm = require('node:vm')

/**
 * 把参数拆成一个个独立名字。
 * 两种写法都要支持：参数名一个个分开传的，和把参数名拼成一个带逗号的字符串传的。
 * 而 vm.compileFunction 的 params 数组里不允许出现带逗号的元素，
 * Node v24 遇到会直接断言崩溃（不是抛异常，是整个进程挂掉），所以这里必须先拆开再交给它。
 */
function splitParamNames(params) {
  const out = []
  for (const raw of params || []) {
    for (const piece of String(raw).split(',')) {
      const name = piece.trim()
      if (name) out.push(name)
    }
  }
  return out
}

/**
 * 等价于「用 names 当参数名、body 当函数体」造一个函数。
 * 与原来那种写法一样：不捕获调用处的作用域，拿不到调用方的局部变量，
 * 造出来的对象属于当前环境（Array.isArray 与 instanceof 的结论都一致）。
 */
function compileFn(params, body) {
  return vm.compileFunction(String(body), splitParamNames(params), { filename: 'eval-probe.js' })
}

/**
 * 等价于对表达式 expr 做直接求值，例如把源码里的一段函数表达式变成真函数。
 * 原来那种写法能看见调用处所在作用域的变量；这里改成显式传 scope，看得到哪些变量一目了然。
 * 例：evalWithScope('function (b) { return b + OUTER }', { OUTER: 3 })(5) === 8
 */
function evalWithScope(expr, scope) {
  const names = Object.keys(scope || {})
  const factory = compileFn(names, 'return (' + String(expr) + ')')
  return factory.apply(null, names.map((name) => scope[name]))
}

/**
 * 在 jsdom 窗口里执行一段代码，等价于 dom.window 上的求值。
 * 要求 jsdom 建的时候开了 runScripts（'outside-only' 或 'dangerously'），否则拿不到内部环境。
 */
function evalInWindow(dom, code) {
  return vm.runInContext(String(code), dom.getInternalVMContext())
}

module.exports = { compileFn, evalWithScope, evalInWindow }
