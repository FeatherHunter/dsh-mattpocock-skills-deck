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
 *      共用同一份读取实现），且叶子反向检查用的是 lib 里那份判据（不是 build.mjs 里自己写一遍）；
 *   5. **拦截走真缝**：一段真正会被拒绝的片段，在 readSpliceFragmentSource 这一层就必须抛错——判据 1、2
 *      测的是纯函数，谁把缝里那次调用换成一行内联的「去行首 export」，纯函数照样绿而缝不再拦；
 *      同一节还守着「不误伤」那一面：注释与模板串里写着的行首 import/export 是文本、不是代码；
 *   6. **登记表里的真片段逐份过缝**：不是只喂临时夹具——按路径前缀跳过转译、只对认识的扩展名转译这类
 *      改动，只有拿真片段跑才看得出来；顺带盯住 `.ts` 一族与 `.d.ts` 的分派；
 *   7. **叶子判据真跑一遍**：.js / 没有同名 .js 的 TypeScript / 有同名 .js 的 TypeScript / .d.ts 四种
 *      情形摆在临时目录里逐个断言（#1207 对抗式审查发现：写在 build.mjs 里时门禁只能拿正则看它有没有写）。
 *
 * 夹具都建在系统临时目录里，跑完就删，不往仓库里写东西。
 *
 * 能红也能绿（每条都实测过）：把任一处的 readSpliceFragmentSource 换回「读文件、去行首 export」→ 判据 3、5 红；
 * 把缝里那次 toSpliceableFragment 调用换成内联去 export → 判据 5 红；按路径前缀跳过转译 → 判据 6 红；
 * 把 toSpliceableFragment 的 leftover 判据删掉 → 判据 2 红；把 moduleForm 判据里的 `default\b` 去掉 → 判据 2 红；
 * 把叶子判据掏空成 `return false` → 判据 7 红；把 .js 分支改成 `source.trim()` → 判据 5 红；
 * 把某处统一入口调用改回直接读缝、掏空入口内的补换行、在别处另起读缝调用 → 判据 4 红；全对时绿。
 * 退出码 0 = 全通过；1 = 有断言不成立（会卡住 verify 链）。
 */
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { toSpliceableFragment } = require('../scripts/lib/transpile-unit.mjs')
const { REPO_ROOT, isLeafSourcePath, readSpliceFragmentSource } = require('../scripts/lib/transpile-domains.mjs')
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

    // ---- 判据 5：拦截与不误伤都走真缝（判据 1、2 测的是纯函数，这里测缝自己）----
    // 为什么单独走一遍真缝：谁把 readSpliceFragmentSource 里那次 toSpliceableFragment 调用换成一行内联的
    // 「去行首 export」，纯函数那两条判据照样绿，而缝已经不再拦任何东西（#1207 对抗式审查实测如此）。
    const valueImport = path.join(dir, 'bad-import.js')
    writeFileSync(valueImport, "import { readFileSync } from 'node:fs'\nconst read = readFileSync\n", 'utf8')
    const refused = throwsText(() => readSpliceFragmentSource(valueImport))
    ok(refused !== '' && refused.includes('bad-import.js'), '走真缝：片段里还留着模块级 import 时当场拒绝，报错指认是哪个片段')
    const badExport = path.join(dir, 'bad-export.js')
    writeFileSync(badExport, 'const a = 1\nexport { a }\n', 'utf8')
    ok(throwsText(() => readSpliceFragmentSource(badExport)) !== '', '走真缝：`export { a }` 同样当场拒绝')

    const tmpl = path.join(dir, 'ok-template.js')
    writeFileSync(tmpl, 'const help = `\nimport { a } from "b"\n`\n', 'utf8')
    ok(
      throwsText(() => readSpliceFragmentSource(tmpl)) === '',
      '不误伤：模板串里出现行首 import 的示例文本不算模块写法（对抗式审查 F7 指出这条原来会让构建失败）'
    )
    const commented = path.join(dir, 'ok-comment.js')
    writeFileSync(commented, '/*\nexport { a }\n*/\nconst a = 1\n', 'utf8')
    ok(throwsText(() => readSpliceFragmentSource(commented)) === '', '不误伤：块注释里出现行首 export 的示例文本不算模块写法')

    const plainJs = path.join(dir, 'plain.js')
    writeFileSync(plainJs, 'export const a = 1\n', 'utf8')
    ok(spliceableJs(plainJs) === 'const a = 1', '走真缝：只有 .js 的片段也过同一条形态判据（行首 export 去掉）')

    const tsDefault = path.join(dir, 'default.ts')
    writeFileSync(tsDefault, 'export default function f(): number { return 1 }\n', 'utf8')
    ok(
      throwsText(() => readSpliceFragmentSource(tsDefault)).includes('模块导出写法'),
      '走真缝：.ts 里的 `export default` 在转译前就被拦下，报错说的是模块导出写法（不是转译后的 as 改名）'
    )

    const mtsFixture = path.join(dir, 'plain.mts')
    writeFileSync(mtsFixture, 'export const n: number = 1\n', 'utf8')
    const mtsOut = spliceableJs(mtsFixture)
    ok(
      mtsOut.includes('const n = 1') && !/\bexport\b/.test(mtsOut),
      '.mts 片段同样认得、同样剥掉类型与行首 export（AGENTS.md 允许新写 .mts，原来这条是静默漏拼）'
    )

    const declOnly = path.join(dir, 'shape.d.ts')
    writeFileSync(declOnly, 'export interface Shape { a: number }\n', 'utf8')
    ok(throwsText(() => readSpliceFragmentSource(declOnly)) !== '', '纯类型声明 .d.ts 不能当片段：当场拒绝，而不是拼出一段空文本')

    // ---- 判据 7：叶子的认定真跑一遍（四种情形摆出来，而不是拿正则看源码里有没有写）----
    const leafRoot = path.join(dir, 'leaves')
    mkdirSync(leafRoot, { recursive: true })
    writeFileSync(path.join(leafRoot, 'only.ts'), 'export const a = 1\n', 'utf8')
    writeFileSync(path.join(leafRoot, 'both.ts'), 'export const b = 1\n', 'utf8')
    writeFileSync(path.join(leafRoot, 'both.js'), 'const b = 1\n', 'utf8')
    writeFileSync(path.join(leafRoot, 'plain.js'), 'const c = 1\n', 'utf8')
    writeFileSync(path.join(leafRoot, 'shape.d.ts'), 'export interface S { a: number }\n', 'utf8')
    writeFileSync(path.join(leafRoot, 'helper.mts'), 'const d = 1\n', 'utf8')
    writeFileSync(path.join(leafRoot, 'view.tsx'), 'const e = 1\n', 'utf8')
    writeFileSync(path.join(leafRoot, 'notes.md'), '# 说明\n', 'utf8')
    const leaf = (rel: string): boolean => isLeafSourcePath(leafRoot, rel)
    ok(leaf('only.ts') === true, '叶子判据：没有同名 .js 的 .ts 算一份叶子')
    // #1209 改口径：同名并排的 .ts/.js 里，那一份 .js 是构建写下的产物，不再算一份叶子。
    //   旧口径（两边都算）在 kernel / statusbar 这两处转成 TypeScript 之后，会让构建每次都在反向检查里
    //   报「StatusBackend.js 未在 LEAF_MODULES 登记」—— 而那份 .js 是构建自己刚写下的产物。
    ok(leaf('both.ts') === false && leaf('both.js') === false, '叶子判据：同名并排的 .ts/.js 一份都不算叶子（.js 那一边是产物，不是待登记的源码）')
    ok(leaf('plain.js') === true, '叶子判据：没有同名 .ts 的 .js 仍算一份叶子（登记表里今天记的就是这种）')
    ok(leaf('shape.d.ts') === false, '叶子判据：.d.ts 是纯类型声明，不算叶子')
    ok(leaf('helper.mts') === true && leaf('view.tsx') === true, '叶子判据：.mts / .tsx 也算叶子（不然它们既不被反向检查报出来，也拼不进去）')
    ok(leaf('notes.md') === false, '叶子判据：不是片段源码的扩展名不算叶子')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  // ---- 判据 4：三个拼接点都走同一条缝 ----
  // #1074 起三个拼接点先经 spliceText 这一处入口（补末尾换行，防上一段的尾注释吃掉下一段的头一行），
  // 再由它调构建与门禁共用的 readSpliceFragmentSource。对抗式审查补的三条（只数 m.file 会漏异名直调、
  // 跨函数正则会把搬走的调用也算数、只看接线会漏掉被掏空的补换行），所以这里：数统一入口的调用到 3 处、
  // 把统一入口的函数体抠出来断言两件事都在里面（调共用读取、补末尾换行）、抠掉入口与 import 行之后不许再有读缝调用。
  const buildSrc = readFileSync(path.join(REPO_ROOT, 'scripts/build.mjs'), 'utf8')
  const seamCalls = (buildSrc.match(/spliceText\(\w+\.file\)/g) || []).length
  ok(seamCalls === 3, 'kernel / leaf / shared 三处拼接点都走同一条缝（实到 ' + seamCalls + ' 处）')
  const spliceBody = /function spliceText\(file\) \{([\s\S]*?)\n\}/.exec(buildSrc)?.[1] || ''
  ok(
    spliceBody.includes('readSpliceFragmentSource(file)'),
    '统一入口内部调的是构建与门禁共用的那一份读取实现（不是各写一份，也不是搬到别处只留空壳）'
  )
  ok(
    spliceBody.includes("'\\n'"),
    '统一入口内部补了末尾换行（掏空这一句会让尾注释吃掉下一段的头一行，门禁要能变红）'
  )
  const withoutEntry = buildSrc
    .replace(/import [^\n]*readSpliceFragmentSource[^\n]*\n/, '')
    .replace(/function spliceText\(file\) \{[\s\S]*?\n\}/, '')
  ok(
    !/readSpliceFragmentSource\(/.test(withoutEntry),
    '除统一入口外没有别的读缝调用（异名变量的直接调用同样算绕过，不许留）'
  )
  ok(!/extractModuleBlock/.test(buildSrc), '拼接点不再各自写一份「读文件、去行首 export」')
  ok(
    /import \{[^}]*readSpliceFragmentSource[^}]*\} from '\.\/lib\/transpile-domains\.mjs'/.test(buildSrc),
    '拼接点用的是构建与门禁共用的那一份读取实现（不是各写一份）'
  )
  ok(
    /isLeafSourcePath\(ROOT, rel\)/.test(buildSrc) && /isLeafSourcePath[^\n]*from '\.\/lib\/transpile-domains\.mjs'/.test(buildSrc),
    '叶子反向检查用的是 lib 里那份判据（build.mjs 只调用，不自己再写一遍）'
  )
  ok(!/function isLeafSourcePath/.test(buildSrc), 'build.mjs 里不再留一份自己的叶子判据实现')

  // ---- 判据 6：登记表里的真片段逐份过缝（不是只喂临时夹具）----
  // 为什么要有它：判据 3、5 用的全是临时夹具，于是「按路径前缀跳过转译」「只对认识的扩展名转译」这类
  // 最像真实回归的改动正好落在盲区（对抗式审查 F3/F5 实测全绿）。这里把三份登记表里的真片段全过一遍，
  // 顺带把「转译完不留行首 import/export」这条守到每一份上——#1208/#1209 之后 .ts 片段会越来越多。
  const registered = [...buildSrc.matchAll(/file:\s*'([^']+)'/g)].map((m) => m[1])
  ok(registered.length >= 150, '登记表读得出条目（实到 ' + registered.length + ' 条）')
  let passed = 0
  let missing = 0
  let firstBad = ''
  for (const rel of registered) {
    if (!existsSync(path.join(REPO_ROOT, rel))) {
      // 盘上还没有这份文件（构建自己的错会当场报 ENOENT），门禁这里不替它判，只记下跳过了几份。
      missing++
      continue
    }
    let out = ''
    try {
      out = readSpliceFragmentSource(rel)
    } catch (e) {
      firstBad = rel + ' 过缝时报错：' + String((e && (e as { message?: unknown }).message) || e)
      break
    }
    if (/^[^\S\r\n]*(?:import|export)\b/m.test(out)) {
      firstBad = rel + ' 拼完还留着行首 import/export'
      break
    }
    passed++
  }
  ok(
    firstBad === '',
    '登记表里每一份真片段过缝之后都没有行首 import/export 残留（过了 ' + passed + ' 份' +
      (missing ? '，盘上还没有的跳过 ' + missing + ' 份' : '') +
      (firstBad ? ' — ' + firstBad : '') +
      '）'
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
