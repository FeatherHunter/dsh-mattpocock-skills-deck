/**
 * tests/lib/source-text.ts —— 门禁要读被测源码文本时走这里，不要各写各的（#1207 立）。
 *
 * 为什么需要这个文件
 *   tests/ 下有一批门禁的做法是「读一份源码文本，然后按文本形状扫描它，或者当场求值成函数」。
 *   写法从旧语言迁移过来的时候，一句话就够了：那些文件当时都是 .js，readFileSync 直接能读。
 *   等到有一份源码从 .js 变成 .ts（#1209 那批），同一句话当场读不到文件；要是每个门禁各自补一套
 *   「先看 .ts 再看 .js、是 .ts 就先转译」，就会几十处各写一遍、各错一遍，而且每处的转译参数都可能
 *   与构建不一致 —— 门禁看到的东西和真正拼进产物的东西慢慢分家，而这种偏差不报错。
 *   所以这两件事收在一处：门禁只从这一个入口取源。
 *
 * 三个入口
 *   sourcePath(rel)    这份源码今天住在哪个文件里（仓库相对路径）
 *   sourceText(rel)    它的原文，供按文本形状扫描（正则、字面量比对）的门禁用
 *   spliceableJs(rel)  可以直接交给 eval-probe 的 compileFn / evalWithScope 的 JavaScript 文本
 *
 * 「同名 .ts 优先」为什么这么定
 *   仓库的装载钩子（scripts/ts-hook.mjs）在模块说明符那一层就是这么改的：写 './x.js' 时，只要旁边
 *   有同名 x.ts，加载到的就是 x.ts。门禁读的是源码树，走同一条规则，两边结论才一致
 *   （见 AGENTS.md「测试怎么直接加载 .ts」）。保留 .js 回退是因为迁移期两种形态并存。
 *   一个必须记住的例外：**构建产物不要从这个入口读**。视图树里同名并排的 .ts/.js 是「一份源码 +
 *   一份产物」，这一处会给出源码（源码树该有的答案）；要读产物（client.js、package/lib/*、某份 .js
 *   产物）的门禁直接读那个文件，否则会静默改成读源码，判据跟着悄悄变味。
 *
 * 转译口径只有一份
 *   scripts/lib/transpile-unit.mjs 的 TRANSPILE_OPTIONS 加 inlineExportDeclarations，与构建
 *   （scripts/build.mjs 经 scripts/lib/transpile-domains.mjs 的 readSpliceFragmentSource）用的是同一份；
 *   这里不写第二遍参数，也不自己删 export。
 */
'use strict'

const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { REPO_ROOT, readSpliceFragmentSource } = require('../../scripts/lib/transpile-domains.mjs')

/**
 * 这份源码今天住在哪个文件里：问的是 '.js' 时同名 '.ts' 优先（与装载钩子同规则），问的是 '.ts' 时就用它自己。
 * 两种扩展名都不在盘上时抛错 —— 门禁宁可当场红，也不要静默读到空文本、把后面的判据全放过去。
 */
function sourcePath(rel: string): string {
  const asked = String(rel).replace(/\\/g, '/')
  if (asked.endsWith('.ts')) {
    if (!existsSync(resolve(REPO_ROOT, asked))) {
      throw new Error('找不到源码 ' + asked + '（这个路径在仓库里不存在）')
    }
    return asked
  }
  if (asked.endsWith('.js')) {
    const sibling = asked.slice(0, -'.js'.length) + '.ts'
    if (existsSync(resolve(REPO_ROOT, sibling))) return sibling
  }
  if (!existsSync(resolve(REPO_ROOT, asked))) {
    throw new Error('找不到源码 ' + asked + '（同名 .ts 与它自己都不在盘上，也可能这份文件已经改名）')
  }
  return asked
}

/** 这份源码的原文。按文本形状扫描的门禁用它；要用它求值请走 spliceableJs。 */
function sourceText(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, sourcePath(rel)), 'utf8')
}

/** 这份源码的 JavaScript 文本：.ts 先按全仓唯一那份口径转译，再交给 eval-probe 求值。 */
function spliceableJs(rel: string): string {
  return readSpliceFragmentSource(sourcePath(rel))
}

module.exports = { sourcePath, sourceText, spliceableJs }
