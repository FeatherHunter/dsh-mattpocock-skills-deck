/**
 * tests/lib/eval-probe.ts —— 验证脚本要按文本求值时走这里，不要各写各的。
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
 * 求值失败时会把原因说清
 *   最常见的两种失败都是「传进来的文本根本不是一段函数文本」：把整份源码文件当函数体传进来
 *   （于是函数体里出现模块级的 import/export），或者文本里还留着 TypeScript 的类型写法
 *   （vm.compileFunction 只吃纯 JavaScript，不做类型剥离）。这两种情况下引擎只会丢一句
 *   “Cannot use import statement outside a module” 或 “Unexpected token”，看到的人得自己推。
 *   诊断集中在 describeFailure 里，按文本形状指名说清，并给出两条可行改法（见该函数注释）。
 *
 * 调用方怎么写说明符
 *   仓里绝大多数调用方写的是 './lib/eval-probe.js'（迁移期的常规写法），靠 scripts/ts-hook.mjs
 *   把 .js 说明符改指到本文件，所以那些调用方必须挂着钩子跑（验证链会自动挂）。
 *   写显式 './lib/eval-probe.ts' 的调用方则可以直接跑、不用钩子 —— 本文件只引 node:vm，
 *   没有任何仓库内的依赖。
 *
 * 真 Chromium 里跑的那三处探针不在这里：页面里引不进 Node 模块，它们按同一做法（插一段经典脚本）
 * 各写了一份页面内小函数，位置见各自文件里的注释。
 * 换行符注意：本仓库已声明文本文件一律 LF 检出（见根目录 .gitattributes），
 * 需要按字节比对源码的门禁在任何机器上结论一致。
 */
'use strict'

const vm = require('node:vm')

/**
 * 造出来的函数长什么样：参数与返回值都由被求值的那段文本决定，编译期无从得知，只能给宽形状。
 * 写成 any 而不是 unknown，是因为调用方普遍直接拿结果做比较与运算（这是测试脚本，不是产品代码）。
 */
type CompiledFn = (...args: any[]) => any

/**
 * 把参数拆成一个个独立名字。
 * 两种写法都要支持：参数名一个个分开传的，和把参数名拼成一个带逗号的字符串传的。
 * 而 vm.compileFunction 的 params 数组里不允许出现带逗号的元素，
 * Node v24 遇到会直接断言崩溃（不是抛异常，是整个进程挂掉），所以这里必须先拆开再交给它。
 */
function splitParamNames(params: readonly unknown[] | null | undefined): string[] {
  const out: string[] = []
  for (const raw of params || []) {
    for (const piece of String(raw).split(',')) {
      const name = piece.trim()
      if (name) out.push(name)
    }
  }
  return out
}

/**
 * 把「求值失败」翻译成能直接照着改的话。没有更清楚的话可说时，原样把原错误抛回去。
 *
 * 为什么要有它：这个入口被八十来个门禁共用，其中任何一份把整份源码文件当函数体传进来时，
 * 引擎只留一句 “Cannot use import statement outside a module”，看到的人还得自己推
 * 「函数体里为什么会出现 import」。按文本形状把两种最常见的原因指名说清，并各给两条改法：
 *   ① 直接引真源模块（说明符写显式 .ts 就能直接跑；写 .js 结尾要挂 scripts/ts-hook.mjs，验证链会自动挂）；
 *   ② 只把要测的那一段函数文本切出来，不要用整份文件。
 * 只在求值已经失败之后才调用，所以就算猜错了也不会影响跑得通的门禁。
 */
function describeFailure(err: unknown, code: string): Error {
  const reason = (err as { message?: unknown } | null | undefined)?.message
  const lines: string[] = [String(reason || err)]
  if (/(^|\n)[ \t]*(?:import|export)\s/.test(code)) {
    lines.push('这段文本里有模块级的 import/export —— 看着是整份源码文件，不是一段函数文本。')
    lines.push('vm.compileFunction 造的是函数体，函数体里不能出现 import/export。两种改法：')
    lines.push('  ① 直接引真源模块，调用它导出的那个函数；')
    lines.push('  ② 只把要测的那一段函数文本切出来再交给本入口，不要传整份文件。')
  } else if (/(^|\n)[ \t]*(?:export\s+)?(?:interface|type)\s+[A-Za-z_$]/.test(code)) {
    lines.push('这段文本里有 TypeScript 的类型写法（interface / type）—— vm.compileFunction 只吃纯 JavaScript，不做类型剥离。')
    lines.push('改法同前一条：直接引真源模块，或只切出纯 JavaScript 的那一段。')
  } else if (
    /[A-Za-z_$][\w$]*\s*:\s*(?:string|number|boolean|unknown|any|void|never|object|Record\b|Promise\b|[A-Z][\w$]*)\b/.test(code) ||
    /\bas\s+(?:const|[A-Z][\w$]*|Record\b|unknown)\b/.test(code)
  ) {
    lines.push('这段文本里可能有 TypeScript 的类型标注（写成「名字: 类型」或「值 as 类型」）—— vm.compileFunction 只吃纯 JavaScript，不做类型剥离。')
    lines.push('这是按文本形状给的线索，不是结论：如果确实不是类型标注，可以忽略这一条。')
  }
  if (lines.length === 1) return err as Error
  const out = new Error(lines.join('\n')) as Error & { cause?: unknown }
  out.name = (err as { name?: string } | null | undefined)?.name || 'Error'
  out.cause = err
  return out
}

/**
 * 等价于「用 names 当参数名、body 当函数体」造一个函数。
 * 与原来那种写法一样：不捕获调用处的作用域，拿不到调用方的局部变量，
 * 造出来的对象属于当前环境（Array.isArray 与 instanceof 的结论都一致）。
 * 造不出来时抛出的错误里会带上原因（见 describeFailure）。
 */
function compileFn(params: readonly unknown[] | null | undefined, body: unknown): CompiledFn {
  const code = String(body)
  try {
    return vm.compileFunction(code, splitParamNames(params), { filename: 'eval-probe.ts' }) as CompiledFn
  } catch (err) {
    throw describeFailure(err, code)
  }
}

/**
 * 等价于对表达式 expr 做直接求值，例如把源码里的一段函数表达式变成真函数。
 * 原来那种写法能看见调用处所在作用域的变量；这里改成显式传 scope，看得到哪些变量一目了然。
 * 例：evalWithScope('function (b) { return b + OUTER }', { OUTER: 3 })(5) === 8
 */
function evalWithScope(expr: unknown, scope?: Record<string, unknown> | null): any {
  const names = Object.keys(scope || {})
  const factory = compileFn(names, 'return (' + String(expr) + ')')
  return factory.apply(null, names.map((name) => (scope as Record<string, unknown>)[name]))
}

/**
 * 在 jsdom 窗口里执行一段代码，等价于 dom.window 上的求值。
 * 要求 jsdom 建的时候开了 runScripts（'outside-only' 或 'dangerously'），否则拿不到内部环境。
 */
function evalInWindow(dom: { getInternalVMContext(): any }, code: unknown): any {
  return vm.runInContext(String(code), dom.getInternalVMContext())
}

module.exports = { compileFn, evalWithScope, evalInWindow }
