#!/usr/bin/env node
/**
 * tests/verify-1207-splice-ts.ts — 客户端拼接缝认得 TypeScript 片段（#1207）
 *
 * 为什么要有它：客户端那个大文件是把几十份源码片段**按文本拼**进闭包的。只要拼接还没换成模块加载，
 * 这条缝就是「改一份源码 → 面板行为」的唯一通道。而这次要把几份源码从 .js 转成 .ts（#1208 / #1209），
 * 转完它们没法像 .js 那样直接读出来拼进去：类型标注进了闭包就是语法错误。所以先让缝认得 .ts 片段
 * （先按全仓唯一那份转译口径转成 JavaScript，再拼），本门禁守的就是这件事，以及「没转译就拼」必须
 * 当场报错、不许等到运行时才炸。
 *
 * 判据：
 *   1. 片段形态判据（toSpliceableFragment，纯函数）：行首 export 去掉、首尾空白去掉、缩进保留；
 *   2. 没转译就拼要当场报错：文本里还留着模块级 import/export 时抛出，且报错指出是哪个片段；
 *      同时不许误伤 `exports.foo` 这类标识符与行首的动态导入 `import(...)`；
 *   3. 缝真的会转译 .ts 片段：带类型标注的 .ts 片段经 readSpliceFragmentSource 之后，类型标注被剥掉、
 *      行首 export 被去掉，而且拼出来的文本能当场交给 eval-probe 求值（vm 只吃纯 JavaScript）；
 *   4. 三个拼接点都走同一条缝：build.mjs 里三处 marker 替换都调 readSpliceFragmentSource（构建与门禁
 *      共用同一份读取实现），且叶子反向检查认得 .ts（漏登记的叶子要报错，不能静默不拼）。
 *
 * 夹具都建在系统临时目录里，跑完就删，不往仓库里写东西。
 *
 * 能红也能绿：把任一处的 readSpliceFragmentSource 换回「读文件、去行首 export」，第 3、4 条红；
 * 把 toSpliceableFragment 里那条 leftover 判据删掉，第 2 条红；全对时绿。
 * 退出码 0 = 全通过；1 = 有断言不成立（会卡住 verify 链）。
 */
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { toSpliceableFragment } = require('../scripts/lib/transpile-unit.mjs')
const { REPO_ROOT, readSpliceFragmentSource } = require('../scripts/lib/transpile-domains.mjs')
const { sourcePath, sourceText, spliceableJs } = require('./lib/source-text.ts')
const probe = require('./lib/eval-probe.ts')

let failures = 0
function ok(cond: unknown, msg: string): void {
  if (cond) console.log('[PASS]', msg)
  else {
    console.log('[FAIL]', msg)
    failures++
  }
}

/** 跑一段应当抛错的调用，拿回它的报错文字；没抛错就回空串（判据据此判红）。 */
function throwsText(fn: () => unknown): string {
  try {
    fn()
    return ''
  } catch (e) {
    return String((e && (e as { message?: unknown }).message) || e)
  }
}

function main(): void {
  // ---- 判据 1：片段形态（纯函数，不碰盘）----
  const strip = toSpliceableFragment('export const a = 1\nexport function b() { return a }\n\n', { source: 'demo.js' })
  ok(strip === 'const a = 1\nfunction b() { return a }', '片段形态：行首 export 去掉、首尾空白去掉')
  ok(
    toSpliceableFragment('const a = 1\n  export const c = 2\n', { source: 'demo.js' }) === 'const a = 1\n  const c = 2',
    '片段形态：行内那条的缩进原样保留（缩进变了会是另一份字节）'
  )

  // ---- 判据 2：没转译就拼必须当场报错，且不误伤正常写法 ----
  const red = throwsText(() => toSpliceableFragment("import { readFileSync } from 'node:fs'\nconst x = 1\n", { source: 'src/client/kernel/demo.ts' }))
  ok(red !== '', '没转译就拼：文本里还留着模块级 import 时当场抛出（不许拼进闭包等到运行时炸）')
  ok(red.includes('src/client/kernel/demo.ts') && red.includes('import'), '报错指认是哪个片段、哪一句写法')
  const moduleForm = throwsText(() => toSpliceableFragment('const a = 1\nexport * from "./x.js"\n', { source: 'demo.js' }))
  ok(moduleForm !== '', '改不动的模块写法（`export * from` / `export {…}` / `export default`）当场拦住，不许静默拼成语法错的文本')
  ok(
    throwsText(() => toSpliceableFragment('export { a, b }\n', { source: 'demo.js' })) !== '',
    '改不动的模块写法：`export { a, b }` 同样拦住（去掉 export 之后是个空语句块，不是导出）'
  )
  ok(
    throwsText(() => toSpliceableFragment('const exports1 = 1\nexports1 += 1\n', { source: 'demo.js' })) === '',
    '不误伤：`exports.foo` 这类正常标识符不算模块级写法'
  )
  ok(
    throwsText(() => toSpliceableFragment("import('./x.js').then(() => 1)\n", { source: 'demo.js' })) === '',
    '不误伤：行首的动态导入 `import(...)` 是合法 JavaScript'
  )

  // ---- 判据 3：缝真的会转译 .ts 片段（临时夹具，不碰仓库源码）----
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-1207-splice-'))
  try {
    const tsFixture = path.join(dir, 'fragment.ts')
    writeFileSync(
      tsFixture,
      "type Choice = 'single' | 'multi'\nexport const pick = (c: Choice): string => (c === 'single' ? '单' : '多')\n",
      'utf8'
    )
    const js = spliceableJs(tsFixture)
    ok(js.includes('const pick') && !/^[ \t]*export\b/m.test(js), '缝认得 .ts 片段：转译成 JavaScript 之后行首 export 被去掉')
    ok(!js.includes('type Choice') && !/:\s*string\b/.test(js), '缝认得 .ts 片段：类型标注与类型别名都被剥掉（vm 只吃纯 JavaScript）')
    ok(
      probe.compileFn([], js + '\nreturn pick("single")')() === '单',
      '拼出来的文本能当场求值成函数并算出正确结果（这是 #1209 那批门禁真正要用的能力）'
    )

    const twinJs = path.join(dir, 'twin.js')
    writeFileSync(twinJs, 'const fromJs = 1\n', 'utf8')
    writeFileSync(path.join(dir, 'twin.ts'), 'const fromTs: number = 2\n', 'utf8')
    ok(
      path.resolve(sourcePath(twinJs)) === path.resolve(path.join(dir, 'twin.ts')),
      '取源规则：问 .js 时同名 .ts 优先（与装载钩子 scripts/ts-hook.mjs 同规则）'
    )
    ok(sourceText(twinJs).includes('fromTs'), '取源规则：原文给的是源码 .ts 的内容，不是旁边的 .js')
    ok(
      sheetMissing(dir),
      '两种扩展名都不在盘上时当场报错（不许静默读到空文本，把后面的判据全放过去）'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  // ---- 判据 4：三个拼接点都走同一条缝 ----
  const buildSrc = readFileSync(path.join(REPO_ROOT, 'scripts/build.mjs'), 'utf8')
  const seamCalls = buildSrc.split('readSpliceFragmentSource(m.file)').length - 1
  ok(seamCalls === 3, 'kernel / leaf / shared 三处拼接点都走同一条缝（实到 ' + seamCalls + ' 处）')
  ok(!/extractModuleBlock/.test(buildSrc), '拼接点不再各自写一份「读文件、去行首 export」')
  ok(
    /import \{[^}]*readSpliceFragmentSource[^}]*\} from '\.\/lib\/transpile-domains\.mjs'/.test(buildSrc),
    '拼接点用的是构建与门禁共用的那一份读取实现（不是各写一份）'
  )
  ok(
    /isLeafSourcePath\(rel\)/.test(buildSrc) && /\.d\.ts/.test(buildSrc),
    '叶子反向检查认得 .ts 片段，且不会把纯类型声明 .d.ts 当成叶子'
  )

  console.log('')
  if (failures) {
    console.log('存在失败：' + failures + ' 条')
    process.exitCode = 1
  } else {
    console.log('全部通过 — 客户端拼接缝认得 .ts 片段，没转译就拼会当场报错')
  }
}

/** 「找不到源码」这条判据单独写出来，好让上面那段读起来还是一条一条的断言。 */
function sheetMissing(dir: string): boolean {
  const text = throwsText(() => sourceText(path.join(dir, 'nowhere.js')))
  return text.includes('找不到源码')
}

main()
