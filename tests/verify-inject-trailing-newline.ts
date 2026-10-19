// verify-inject-trailing-newline.js — 注入尾部补 1 个换行（#789 A 方案）
// 用法: node --import ./scripts/ts-hook.mts tests/verify-inject-trailing-newline.ts
//
// 验收标准（用户选 A）：
//   a) 不是换行结尾的注入文本补 1 个换行，已经是的不重复补，空文本不动；
//   b) 三处调宿主写草稿的落点共用同一归一（主注入、草稿消费、新会话直注）；
//   c) 光标兜底（#786）在归一之后跑，自然落到新行开头。
const assert = require('assert')
// 取源入口（tests/lib/source-text.ts）：src/client/kernel/api-io.js 只是 pixel-ts 写下的同名产物（这一阶段要删），
// 真源是 api-io.ts。这里要把文件里的一段函数切成可求值的代码，所以走 spliceableJs —— 它按构建同一套转译参数
// 转成 JavaScript 并剥掉行首 export，切出来的那一段不带类型标注，交给 compileFn 才能真跑。
const { spliceableJs } = require('./lib/source-text.ts')
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
const { compileFn } = require('./lib/eval-probe.js')

const ioSrc = spliceableJs('src/client/kernel/api-io.js')

// ---- 行为：把源码里的归一函数切出来跑 ----
const start = ioSrc.indexOf('const withTrailingNewline = function')
const brace0 = ioSrc.indexOf('{', start)
let depth = 0
let fn: ((text: unknown) => string) | null = null
for (let i = brace0; i < ioSrc.length; i++) {
  if (ioSrc[i] === '{') depth += 1
  if (ioSrc[i] === '}') {
    depth -= 1
    if (depth === 0) {
      const mod = { exports: null }
      // 把源码里切出来的一段（改成往假 module 上导出）当函数体造函数，参数名 module / exports 显式写出，所以走 compileFn。
      fn = compileFn(['module', 'exports'], ioSrc.slice(start, i + 1).replace('const withTrailingNewline =', 'module.exports =') + '\nreturn module.exports;')(mod, mod.exports)
      break
    }
  }
}
if (!fn) throw new Error('归一函数提取失败')
const eq = (name: string, got: unknown, want: unknown) => { assert.strictEqual(got, want, name); console.log('  PASS · ' + name) }
eq('普通文本补 1 个换行', fn('第一行\n第二行'), '第一行\n第二行\n')
eq('已有换行不重复', fn('abc\n'), 'abc\n')
eq('多个尾随换行动', fn('a\n\n'), 'a\n\n')
eq('空串不动', fn(''), '')
eq('null 不抛错', fn(null), '')
eq('前导换行只看尾部', fn('\nabc'), '\nabc\n')

console.log('\n全部通过 — #789 归一生效（行为 6 项）')
