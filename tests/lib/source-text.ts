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
 * 四个入口
 *   sourcePath(rel)    这份源码今天住在哪个文件里（仓库相对路径）
 *   sourceText(rel)    它的原文，供按文本形状扫描（正则、字面量比对）的门禁用
 *   spliceableJs(rel)  可以直接交给 eval-probe 的 compileFn / evalWithScope 的 JavaScript 文本
 *   transpiledSourceText(rel)  原文按全仓唯一转译口径转译后的文本，不做拼接校验——整份文件
 *     不是片段、但门禁要拿「转译后形态」与产物逐字比对时用（例如客户端入口的内联函数）。
 *     spliceableJs 会拦 `export default` 这类模块写法，入口文件天生带它，不能走那一档。
 *
 * 「同名 .ts 优先」为什么这么定
 *   仓库的装载钩子（scripts/ts-hook.mts）在模块说明符那一层就是这么改的：写 './x.js' 时，只要旁边
 *   有同名 x.ts，加载到的就是 x.ts。门禁读的是源码树，走同一条规则，两边结论才一致
 *   （见 AGENTS.md「测试怎么直接加载 .ts」）。保留 .js 回退是因为迁移期两种形态并存。
 *   一个必须记住的例外：**构建产物不要从这个入口读**。视图树里同名并排的 .ts/.js 是「一份源码 +
 *   一份产物」，这一处会给出源码（源码树该有的答案）；要读产物（client.js、package/lib/*、某份 .js
 *   产物）的门禁直接读那个文件，否则会静默改成读源码，判据跟着悄悄变味。
 *
 * 转译口径只有一份
 *   scripts/lib/transpile-unit.mts 的 TRANSPILE_OPTIONS 加 inlineExportDeclarations，与构建
 *   （scripts/build.mts 经 scripts/lib/transpile-domains.mts 的 readSpliceFragmentSource）用的是同一份；
 *   这里不写第二遍参数，也不自己删 export。
 *
 * 为什么它敢引构建侧的 scripts/lib（层方向是反的，这是刻意取舍）
 *   这个文件住在 tests/lib/，却 require 构建侧的 scripts/lib/transpile-domains.mts，等于把构建侧
 *   （node:child_process、createRequire、esbuild 的惰性加载）拉进测试进程。#1207 的对抗式审查把这条
 *   记了一笔：同目录的 eval-probe.ts 之所以坚持「只引 node:vm」，是因为它要能在没有装载钩子的情况下
 *   被直接加载；本文件没有这个约束。取舍的理由是：真正要防的偏差是「门禁看到的源码形态与构建拼进产物的
 *   形态分家」，这个风险远大于层方向好不好看。只走 sourceText 那一档的门禁（按文本形状扫描，例如
 *   tests/verify-diagnostic-log-model.ts）不会因此多拉起 esbuild：transpile-domains.mts 里 esbuild 是
 *   惰性加载的。
 *   要彻底拆干净，得把纯文本判据（片段形态、扩展名分派）与「读盘 + 转译」分开住 —— 那是另一张票的活，
 *   本文件先把这条取舍写在明处。
 */
'use strict'

const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { REPO_ROOT, fragmentLoaderFor, loadEsbuild, readSpliceFragmentSource } = require('../../scripts/lib/transpile-domains.mts')
const { TRANSPILE_OPTIONS } = require('../../scripts/lib/transpile-unit.mts')

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

/**
 * 这份源码转译后的文本：只转译、不做拼接校验。
 *
 * 与 spliceableJs 的分工：spliceableJs 回答「这份文本能不能拼进闭包」，自带模块写法校验，
 * 入口这类整份文件（天生带 `export default`）走它会被当场拦下。这一档只回答「转译之后长什么样」，
 * 给「产物里拼的那一份必须与真源转译后逐字一致」这类文本比对门禁用。转译参数与构建同一份
 * （TRANSPILE_OPTIONS，loader 按扩展名给），.js 原文没有类型可剥，直接返回原文。
 */
function transpiledSourceText(rel: string): string {
  const p: string = sourcePath(rel)
  const { readFileSync } = require('node:fs')
  const { resolve } = require('node:path')
  const raw: string = readFileSync(resolve(REPO_ROOT, p), 'utf8')
  const loader: string = fragmentLoaderFor(p)
  if (!loader) return raw
  return loadEsbuild().transformSync(raw, { ...TRANSPILE_OPTIONS, loader }).code
}

module.exports = { sourcePath, sourceText, spliceableJs, transpiledSourceText }
