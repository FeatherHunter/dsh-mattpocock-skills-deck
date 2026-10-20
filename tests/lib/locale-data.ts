/**
 * tests/lib/locale-data.ts —— 门禁读界面词表生成物（src/client/kernel/locale-data.ts）的唯一入口（#1294 立）。
 *
 * 为什么需要这个文件
 *   #1294 把界面词表的真源从十份手写片段（src/client/kernel/locale-*.ts）搬到了 config/copy/*.yaml，
 *   运行时代码读的是生成物 src/client/kernel/locale-data.ts（不入库）。旧门禁里有一批是「读某一份
 *   locale-*.js 的源码文本、按文本形状扫描，或者当场求值成对象」的写法；它们要跟着这条搬家线继续
 *   能跑，就得知道「旧路径 → 生成物里的哪一段」。这个换算只写在这一处，门禁各写一遍只会各错一遍。
 *
 * 两种读法（对应 source-text.ts 的四个入口）
 *   · 文本档：旧路径问的是「这一族词条文本」，就取生成物里 `// ===== family: <族> ...` 到下一个
 *     段标记之间的那一段（familySectionSource / familyTranspiledText）。
 *   · 可拼接档：旧路径要的是一段能交给 compileFn / 直接拼起来的 JavaScript 文本，就取同一段，
 *     按全仓唯一那份转译口径转译、剥掉行首 export（familySpliceableJs）。
 *   · 整份档：旧路径要的是「import 这个模块拿它的导出」，整份生成物就是今天对应的模块
 *     （每族仍导出同名常量 L_PANEL … L_SPEC，合并词表与语言清单也都在），sourcePath 直接返回整份。
 *
 * 族清单不手写：#1289 的教训就是手写清单漏掉了 locale-cards / locale-skilldetail / locale-spec
 * 三份（65 个键从没被那份门禁按到）。这里按 config/copy/ 目录发现，加一份 YAML 就多一族，
 * 不需要回来改任何名单。
 */
'use strict'

const { existsSync, readFileSync, readdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { REPO_ROOT, loadEsbuild } = require('../../scripts/lib/transpile-domains.mts')
const {
  TRANSPILE_OPTIONS,
  checkSpliceableModuleForms,
  inlineExportDeclarations,
  toSpliceableFragment,
} = require('../../scripts/lib/transpile-unit.mts')

/** 生成物在仓库里的相对路径（不入库；.gitignore 里有它）。 */
const LOCALE_DATA_REL = 'src/client/kernel/locale-data.ts'
/** 界面词表的真源目录：一族一份 YAML，文件名就是族名。 */
const COPY_DIR_REL = 'config/copy'
/** 生成器（不在盘上时测试自己现场跑一次，与 tests/lib/prompt-data.ts 对 prompt 生成物的做法一致）。 */
const GENERATOR_REL = 'scripts/generate-locale-config.mts'
/** 生成物里每族一段的开头标记，形如 `// ===== family: panel (config/copy/panel.yaml) =====`。 */
const FAMILY_MARK = '// ===== family: '

/**
 * 确保生成物在盘上：不在就跑一次生成器现场生成，返回仓库相对路径。
 *
 * 为什么让测试自己生成而不是要求先构建：门禁的职责是判「真源与界面词表是否对得上」，
 * 它不该因为「上一次构建没跑」这种与判据无关的原因失败；与 prompt 那边的 ensurePromptData 同一个理由。
 */
function ensureLocaleData(root) {
  const base = root || REPO_ROOT
  const abs = resolve(base, LOCALE_DATA_REL)
  if (existsSync(abs)) return LOCALE_DATA_REL
  const r = spawnSync(process.execPath, [resolve(base, GENERATOR_REL)], { cwd: base, encoding: 'utf8' })
  if (r.status !== 0 || !existsSync(abs)) {
    throw new Error(
      '界面词表生成物不在，且现场跑生成器没有成功（' +
        LOCALE_DATA_REL +
        '）：\n' +
        String(r.stderr || '') +
        String(r.stdout || '')
    )
  }
  return LOCALE_DATA_REL
}

/** 生成物全文。 */
function localeDataText(root) {
  return readFileSync(resolve(root || REPO_ROOT, ensureLocaleData(root)), 'utf8')
}

/**
 * 族清单：按 config/copy/ 目录发现（文件名去后缀、排序）。
 * 真源目录不在时当场报错——静默返回空清单会让后面的判据一个都跑不到、却全绿。
 */
function copyFamilyNames(root) {
  const dir = resolve(root || REPO_ROOT, COPY_DIR_REL)
  if (!existsSync(dir)) throw new Error('读不到界面词表真源目录 ' + COPY_DIR_REL + '（#1294 之后它必须存在）')
  return readdirSync(dir)
    .filter(function (name) {
      return /\.ya?ml$/.test(name)
    })
    .map(function (name) {
      return name.replace(/\.ya?ml$/, '')
    })
    .sort()
}

/** 一族的段标记行。族名与 YAML 文件名一一对应，标记里的路径也由它拼出。 */
function familyMarkLine(family) {
  return FAMILY_MARK + family + ' (config/copy/' + family + '.yaml) ====='
}

/**
 * 取生成物里某一族的源码段（含段标记行与它下面那段声明，不含下一个段标记）。
 * 生成物里所有段标记都是行首 `// ===== `，所以「下一个标记」按行首找，不误伤正文。
 */
function familySectionSource(family, root) {
  const text = localeDataText(root)
  const want = familyMarkLine(family)
  const at = text.indexOf(want)
  if (at < 0) {
    throw new Error(
      '生成物 ' + LOCALE_DATA_REL + ' 里没有词族「' + family + '」的段标记（期望含「' + want + '」）：' +
        'config/copy 里加了族却没重新生成，或者生成器的段标记格式改了而这里没跟上。'
    )
  }
  // 从段标记行首开始切（标记前那一行属于上一族）
  const lineStart = text.lastIndexOf('\n', at) + 1
  const rest = text.slice(at + want.length)
  const nextRel = rest.search(/\n\/\/ ===== /)
  if (nextRel < 0) {
    // 落到文件末尾之前应该还有「合并词表」段；真没有就取到末尾，不在这里硬判结构。
    return text.slice(lineStart)
  }
  return text.slice(lineStart, at + want.length + nextRel + 1)
}

/** 一族分段「只转译」的文本（不做拼接校验），给要拿转译后形态比对的门禁用。 */
function familyTranspiledText(family, root) {
  const src = familySectionSource(family, root)
  const js = loadEsbuild().transformSync(src, Object.assign({}, TRANSPILE_OPTIONS, { loader: 'ts' })).code
  return js
}

/**
 * 一族分段「能直接交给 compileFn / 拼起来」的 JavaScript 文本：转译、把末尾导出块改回行首、
 * 再按拼接口径剥掉行首 export。三步用的都是构建侧同一份实现，门禁看到的形态与拼进闭包的一致。
 */
function familySpliceableJs(family, root) {
  const src = familySectionSource(family, root)
  const label = '词族 ' + family + '（config/copy/' + family + '.yaml）'
  checkSpliceableModuleForms(src, { source: label })
  const js = loadEsbuild().transformSync(src, Object.assign({}, TRANSPILE_OPTIONS, { loader: 'ts' })).code
  return toSpliceableFragment(inlineExportDeclarations(js, '[tests] ' + label), { source: label })
}

/**
 * 旧路径 → 族名：`src/client/kernel/locale-<族>.js`（也接受 .ts）。
 * 不是这份形状时返回空串，调用方照常按普通源码文件处理。
 */
function legacyLocaleFamily(rel) {
  const asked = String(rel).replace(/\\/g, '/')
  const m = /^src\/client\/kernel\/locale-([a-z0-9]+)\.(?:js|ts)$/.exec(asked)
  if (!m) return ''
  // 语言清单与合并词表不在任何一族的 YAML 里；它们今天仍在手写的 locale.ts 里活着。
  if (m[1] === 'data') return ''
  return m[1]
}

module.exports = {
  LOCALE_DATA_REL,
  COPY_DIR_REL,
  ensureLocaleData,
  localeDataText,
  copyFamilyNames,
  familySectionSource,
  familyTranspiledText,
  familySpliceableJs,
  legacyLocaleFamily,
}
