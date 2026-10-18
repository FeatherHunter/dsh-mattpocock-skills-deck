/**
 * 一个域里的「一份源码 → 一份产物」怎么算：路径怎么推、转译出来的代码长什么样。
 *
 * 这个文件只放纯函数——给一份源码路径或者一段代码，算出结果，不读盘、不写盘、不碰环境。
 * 之所以把它们单独放一处：这四条判据原先抄了五份（四个计算核各一份、客户端像素那一段一份），
 * 五份的判据逐字一样、只有报错前缀不同；抄五份的东西改一处就要记得改五处，所以按 #1023
 * 的决定收成一处。放成纯函数还有个好处：它们能被直接拿几组输入调一遍，不必起一次完整构建。
 *
 * 判据为什么是这几条，见下面每个函数自己的说明。
 */

/**
 * 转译参数只在这一处写：仓里所有把 TypeScript 逐份转成 JavaScript 的地方都用这一份。
 *
 * 为什么必须只有一份：这些参数是「产物的字节长什么样」的全部来源，两处各写一份时，只要有人
 * 给其中一处补一个参数（历史上就是 `charset` 这个参数只补给了客户端像素那一段），同一份源码
 * 在两条流水线上就会产出两种字节，而这种差别不会报错、只会静默留在产物里。统一成一份之后，
 * 「两条流水线产出的字节形态一致」不再靠人记得，而是结构上只有一种写法。
 *
 * 四个参数各自的意思：
 *   - `loader: 'ts'`：输入是 TypeScript，让 esbuild 认这个后缀并剥掉类型标注。
 *   - `format: 'esm'`：产物用 ES 模块写法，Node 宿主与浏览器闭包两边都能用。
 *   - `target: 'es2020'`：保守目标，保住运行时下限（见根 package.json 的 engines.node）。
 *   - `charset: 'utf8'`：产物里的中文保持原样，不转成 `\uXXXX` 转义。生成物也是给人看的，
 *     中文被转义之后读日志、读产物、比对两份产物都会变得难认。不传这个参数时 esbuild 默认
 *     转义非 ASCII 字符。
 *
 * 这是一份纯数据，不是函数，所以放在这个「只放纯函数」的文件里也不破例：它不读盘、不碰环境，
 * 谁都可以直接拿去用或直接比对。
 */
export const TRANSPILE_OPTIONS = Object.freeze({
  loader: 'ts',
  format: 'esm',
  target: 'es2020',
  charset: 'utf8',
})

/** 域名到「这个域在源码里的位置」的换算只在这一处写：域目录就是 src/shared/<域名>/。 */
export function domainDir(domain) {
  return `src/shared/${domain}`
}

/**
 * 源码路径推产物路径：把域里的 `src/` 这一段去掉，再把后缀换成 `.js`，别的都不动。
 *
 * 为什么用纯函数推、而不是维护一张清单：清单要人记得加一行，忘了加就静默不产出，
 * 而漏掉产物这件事只有到运行时才发现。这条规律是机械的，写清楚一次就不会错；
 * 顺带还带来两个结构性结果——同一份源码只可能推出一个产物路径（不会互相覆盖），
 * 一个产物路径也只可能来自一份源码（不会有人抢着写同一个文件）。
 *
 * 位置规律：`src/shared/<域>/src/x.ts` → `src/shared/<域>/x.js`。源码聚在域目录里的 `src/`
 * 子目录下（与手写产物、说明文档、类型配置分开住），产物写在域目录的表层，与手写产物并排。
 *
 * @param {string} sourcePath 仓库相对的 .ts 源码路径
 * @returns {string} 仓库相对的 .js 产物路径
 */
export function deriveOutputPath(sourcePath) {
  if (!sourcePath.endsWith('.ts')) {
    throw new Error(`[transpile] 只接受 .ts 源码路径，收到「${sourcePath}」`)
  }
  const rel = sourcePath.replace(/\\/g, '/')
  const marker = '/src/'
  const at = rel.indexOf(marker)
  if (at < 0) {
    throw new Error(`[transpile] 源码路径里找不到 /src/ 这一段，认不出它属于哪个域：「${sourcePath}」（域源码的形状是 src/shared/<功能名>/src/x.ts）`)
  }
  return rel.slice(0, at + 1) + rel.slice(at + marker.length, -'.ts'.length) + '.js'
}

/**
 * 产物落地后相对引用减一层：源码住 `<域>/src/` 下、产物落域表层，跨出源码目录的
 * 相对引用在产物里会多走一层 `../`，运行时指到别处去（#1215 单源头改造发现：
 * budget.js 产物里的 `../../time-config/values.js` 被解成 `src/time-config/values.js`，
 * 宿主一起，门禁第二节当场红，运行时同样起不来）。
 *
 * 只改“逃出源码目录”的引用：`./ports.js` 这种不出门的原样不动；`yaml` 这种裸说明符
 * 不是路径，更不动。目标位置按源码目录解出来、再按产物目录重新算，纯路径数学，
 * 不读盘（目标在不在盘上是构建与门禁的事，这里只管“指的方向对不对”）。
 * 解出来跑到仓库根上面去了（`../../../..` 冒头），说明源码本来就写错了，这里不动它，
 * 让 tsc 与运行时去报——这里瞎改一个方向，报错会指到别处。
 *
 * @param {string} code esbuild 转译出来的代码
 * @param {{ sourcePath: string }} options 仓库相对的 .ts 源码路径（`/` 分隔）
 * @returns {string} 引用重算后的代码
 */
export function rebaseEscapingImports(code, { sourcePath }) {
  const srcDir = sourcePath.slice(0, sourcePath.lastIndexOf('/'))
  const outPath = deriveOutputPath(sourcePath)
  const outDir = outPath.slice(0, outPath.lastIndexOf('/'))
  if (srcDir === outDir) return code
  const pat = /\b(?:import\s+(?:[^'"]*?\bfrom\s+)|\bexport\s+[^'"]*?\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])(\.[^'"]*)\1/g
  return code.replace(pat, (m, q, spec) => {
    const target = resolvePosix(srcDir, spec)
    // 出不了门的不动；解到根上面去的也不动（源码写错了，让 tsc 去报）。
    if (target === null || target === srcDir || target.startsWith(srcDir + '/')) return m
    return m.slice(0, m.length - spec.length - 1) + relativePosix(outDir, target) + q
  })
}

/** posix 路径数学（仓库相对路径只用 `/`，这里不碰 node:path，保持纯函数可单测）。 */
function splitPosix(p) {
  return p.split('/').filter((s) => s !== '' && s !== '.')
}
function resolvePosix(base, spec) {
  const out = splitPosix(base)
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(seg)
  }
  return out.join('/')
}
function relativePosix(from, to) {
  const f = splitPosix(from)
  const t = splitPosix(to)
  let i = 0
  while (i < f.length && i < t.length && f[i] === t[i]) i++
  const up = f.length - i
  const rel = [...Array(up).fill('..'), ...t.slice(i)].join('/')
  return rel.startsWith('..') ? rel : './' + rel
}
/**
 * 把 esbuild 收在文件末尾的导出块改写成声明前的行首 export。
 *
 * 为什么必须改写：esbuild 的转译结果不是 `export const X = 1` 这种行首形式，而是把声明照常写在
 * 前面、末尾收一个 `export { X, Y };` 块。产物里有一部分要被拼进客户端闭包，拼接的做法是去掉
 * 每行行首的 `export `（见 scripts/build.mjs 的 extractModuleBlock）；那种末尾块去掉行首 export
 * 之后只剩一个 `{ X, Y };` 语句块，名字虽然还在（函数声明与 const 都在同一作用域里），形态却与
 * 仓库里其它拼进闭包的共享文件完全不一样，读代码的人会看不懂。所以这里统一改回行首形式。
 *
 * 只认「名字能在同一份文件里找到 function / const / let / var / class 声明」这一种情形；
 * 找不到就抛错，绝不静默产出一个少了一个导出的产物。
 *
 * @param {string} code esbuild 转译出来的代码
 * @param {string} prefix 报错时写在最前面的来源标记，用来指认是哪个域出的问题
 */
export function inlineExportDeclarations(code, prefix) {
  const clause = /(^|\n)export \{\n([\s\S]*?)\n\};\n?$/.exec(code)
  if (!clause) {
    if (/(^|\n)export \{/.test(code)) {
      throw new Error(`${prefix} 转译结果里出现了没有预料到的导出块写法，拒绝改写：\n` + code.slice(-300))
    }
    return code
  }
  const names = clause[2]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  let body = code.slice(0, clause.index) + (clause[1] === '\n' ? '\n' : '')
  for (const name of names) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      throw new Error(`${prefix} 导出块里有改不了名的条目「${name}」：本步骤只支持原样导出，不支持 as 改名`)
    }
    const decl = new RegExp('^(?:async )?function ' + name + '\\b|^(?:const|let|var) ' + name + '\\b|^class ' + name + '\\b', 'm')
    const hit = decl.exec(body)
    if (!hit) {
      throw new Error(`${prefix} 导出块里的名字「${name}」在这份文件里找不到声明，拒绝生成少一个导出的产物`)
    }
    body = body.slice(0, hit.index) + 'export ' + body.slice(hit.index)
  }
  return body
}

/**
 * 把一段源码文本整成「可以拼进客户端闭包」的形态：行首的 export 去掉、首尾空白去掉。
 *
 * 为什么要有它：客户端那个大文件是把几十份源码片段按文本拼出来的（拼接点见 scripts/build.mjs 的
 * wireModules），拼接的规则就是这一条。片段现在有两种来源——手写的 .js，和先按 TRANSPILE_OPTIONS
 * 转译过的 .ts——两条来源必须落成同一种形态；规则只写在拼接点那一处的话，谁把一份片段改成 .ts、
 * 走另一条读取路径，就会拼出不一样的字节，而且不报错。
 *
 * 里面那两条报错是**防静默拼错**。第一条管「这份片段根本不是拼进闭包该有的形态」：拼进闭包的
 * 是函数体里的一段声明，行首 `export <声明>` 去掉 export 就对了，而模块写法（`export {…}`、
 * `export * from`、`export default`）去掉 export 之后剩下的不是合法语句——静默拼出来只会是一段
 * 语法错的文本，等构建的语法门禁去报，报出来的位置离真因很远。第二条管「.ts 片段没走过转译」：
 * 那种文本里留着模块级 import，拼进闭包不会当场报错（闭包是一个函数体，编译器只管语法），
 * 要到运行时才炸成 “Cannot use import statement outside a module”。两条都在构建这一处指名报错。
 * 判据只认行首那几个真写法：`import x`、`import {`、`import 'x'`、`export{`、`export *`、`export default`，
 * 不碰 `exports.foo` 这类正常标识符，也不碰行首的 `import(`（那是合法的动态导入）。判据看的是
 * **涂掉字符串与注释之后**的文本（maskNonCodeText）：注释里举例写的 `import x`、模板串里的示例代码
 * 都不算数——它们不是代码，当成模块写法会把本来能拼的片段判死。
 *
 * 它挡不住什么：一份从没转译过的 .ts 片段，如果只有类型写法（`const x: number = 1`、`type T = …`）
 * 而没有任何 import/export，这段文本能过这里；它会在构建的语法门禁那一关当场报语法错——那也是
 * 构建期报错，只是报错位置在语法门禁不在这一处。同理，`import` 与 `{` 之间夹着别的写法这类怪形状
 * 也留给语法门禁：这里只认行首、且只认能一句话说清的那几种。
 *
 * 中央时间参数是个例外（#1215 单源头）：被拼的片段允许写一行从 time-config 引名字的
 * import / export-from（宿主与门禁把它当普通模块 import 进来跑时，这一行是真的引用；
 * 拼进闭包时这一行会被 stripTimeConfigRefs 删掉，名字由闭包里另一片 timeConfig 提供）。
 * 只认单行写法——跨行的 import/export-from 在这里看不见，会走到下面那条报错；
 * 想拼就写成一行。
 *
 * @param {string} code 已经是 JavaScript 的源码文本（.ts 必须先过转译口径再进来）
 * @param {{ source: string }} options source 是仓库相对路径，只用于报错时指认是哪个片段
 * @returns {string} 可直接拼进闭包的文本
 */
export function toSpliceableFragment(code, { source }) {
  const withoutCentral = stripTimeConfigRefs(code)
  checkSpliceableModuleForms(withoutCentral, { source })
  const stripped = withoutCentral
    .split('\n')
    .map((line) => line.replace(/^(\s*)export\s+/, '$1'))
    .join('\n')
    .trim()
  const leftover = /^[^\S\r\n]*(?:import|export)[\s.{"'*]/m.exec(maskNonCodeText(stripped))
  if (leftover) {
    throw new Error(
      `片段 ${source} 在拼接前还留着模块级写法「${lineAt(stripped, leftover.index)}」：` +
        '拼接点吃的是 JavaScript 文本，.ts 片段必须先按全仓唯一那份转译口径（本文件的 ' +
        'TRANSPILE_OPTIONS 加 inlineExportDeclarations）转成 JavaScript 再拼。'
    )
  }
  return stripped
}

/**
 * 删掉片段里“从中央时间参数引名字”的那几行（#1215 单源头）。
 *
 * 为什么是删而不是留：拼进闭包的是一段函数体里的声明，模块级的 import/export-from
 * 留在里面，运行时是语法错。宿主与门禁把同一份文件当模块跑时，这些行是真的引用；
 * 拼进闭包时名字由另一片 timeConfig 提供（构建断言“删掉的名字都在拼接名单里”，
 * 见 scripts/build.mjs 的 CLIENT_TIME_NAMES），所以这里只管删，不管名字对不对。
 *
 * 只删说明符里带 time-config 的单行 import / export-from——别的 import 留给下面报错，
 * 注释与字符串里的举例不受影响（按涂掉非代码后的文本认行首，行号用原行对）。
 * 被删的行整行变空（不是删掉这一行），报错指的行号不受影响。
 *
 * @param {string} code 片段文本（转译前、转译后都可调，转译前的那一次由调用方负责）
 * @returns {string} 删掉中央引用行、其余一字不动的文本
 */
export function stripTimeConfigRefs(code) {
  const masked = maskNonCodeText(code).split('\n')
  return code.split('\n').map((line, i) => {
    const m = masked[i] || ''
    // 形状看涂掉字符串注释后的（注释里的举例不算），是不是中央参数看原文
    // （说明符本身是字符串，涂掉之后反而看不见了）。
    if (!/time-config/.test(line)) return line
    if (/^[^\S\r\n]*import[\s{"'*]/.test(m)) return ''
    if (/^[^\S\r\n]*export[\s{"'*]/.test(m) && /\bfrom\b/.test(m)) return ''
    return line
  }).join('\n')
}

/**
 * 把一段文本里「不是代码」的部分涂成空格：字符串、模板串、行注释、块注释。
 *
 * 为什么要它：上面两条判据是逐行正则，只按行首形状认模块写法。片段里常有注释和模板串，里面为举例
 * 写着一行 `import x from 'y'`——那不是代码，正则却会当成代码把整份片段拦下，把本来能拼进去的片段
 * 判死（#1207 的对抗式审查发现）。涂成空格只改判据看到的东西，片段文本本身一个字不动。
 *
 * 涂法是**等长**的：换行原样保留、其余字符换成空格，所以报错里引用的那一行、行号都还对得上。
 * 它只回答「哪一段不是代码」，不看语法：模板串里的 `${…}` 也一并涂掉（那是代码，但一个片段不该把
 * import 藏在插值里；真藏了还有构建的语法门禁兜着）。
 *
 * @param {string} text 片段原文
 * @returns {string} 与原文等长、行结构相同的文本，代码之外的部分是空格
 */
function maskNonCodeText(text) {
  const out = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') {
        out.push(' ')
        i++
      }
      continue
    }
    if (ch === '/' && next === '*') {
      out.push(' ', ' ')
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out.push(text[i] === '\n' ? '\n' : ' ')
        i++
      }
      if (i < text.length) {
        out.push(' ', ' ')
        i += 2
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      out.push(' ')
      i++
      while (i < text.length) {
        const c = text[i]
        if (c === '\\') {
          out.push(' ', ' ')
          i += 2
          continue
        }
        if (c === '\n') {
          // 单双引号串里出现换行，说明这段文本本来就不是合法 JavaScript，涂到这里为止；
          // 模板串里的换行是正常内容，留着（行结构不变，后面的行仍按「不是代码」涂）。
          if (quote !== '`') break
          out.push('\n')
          i++
          continue
        }
        if (c === quote) {
          out.push(' ')
          i++
          break
        }
        out.push(' ')
        i++
      }
      continue
    }
    out.push(ch)
    i++
  }
  return out.join('')
}

/** 报错里引用出错那一行的原文：从命中位置取到行尾、去掉首尾空白（命中位置在行首，见下面两条判据）。 */
function lineAt(text, index) {
  const end = text.indexOf('\n', index)
  return text.slice(index, end < 0 ? text.length : end).trim()
}

/**
 * 找「改不动的模块写法」：`export {…}`、`export * from`、`export default`。
 *
 * 这三种去掉 export 之后剩下的不是合法语句（`{ a }` 是个空块、`* from` 与 `default` 直接是语法错），
 * 拼进闭包只会得到一段语法错的文本，等构建的语法门禁去报，报出来的位置离真因很远。
 * 前导空白用 `[^\S\r\n]`（任何空白但不算换行），这样缩进是全角空格或不断行空格也认。
 */
function findUnfixableModuleForm(code) {
  return /^[^\S\r\n]*export\s*(\{|\*|default\b)/m.exec(maskNonCodeText(code))
}

/**
 * 只查「改不动的模块写法」这一条，不改动文本；给 .ts 片段在**转译之前**先过一遍。
 *
 * 为什么要在转译前查：`.ts` 里的 `export default f` 经 esbuild 会变成 `export { f as default }`，
 * 于是先撞上 inlineExportDeclarations 那句「不支持 as 改名」，把病因指到别处（#1207 对抗式审查发现）。
 *
 * 这一条**不查**模块级 import：.ts 里没被用到的 import 会被 esbuild 删掉，删干净之后确实能拼，
 * 在转译前把它拦下反而会把本来能构建的片段判死（转译之后仍留着 import 的，toSpliceableFragment 会拦）。
 *
 * @param {string} code 片段原文（可以是 .ts，不必先转译）
 * @param {{ source: string }} options source 只用于报错时指认是哪个片段
 */
export function checkSpliceableModuleForms(code, { source }) {
  const hit = findUnfixableModuleForm(code)
  if (hit) {
    throw new Error(
      `片段 ${source} 里是模块导出写法「${lineAt(code, hit.index)}」：拼进闭包的片段只能写 ` +
        '`export <声明>` 这种行首形式（去掉 export 就是一段普通声明），' +
        '`export {…}` / `export * from` / `export default` 去掉 export 之后不是合法语句。'
    )
  }
}

/**
 * 产物第一行那句「这是机器生成的、别手改，真源在哪」。
 *
 * 为什么不带时间和版本号：那样每构建一次字节都变，产物进了 git 就会天天有噪音改动，
 * 「改了源码没重新生成产物」这件事也就淹没在噪音里看不出来了。
 */
export function generatedHeader(sourcePath) {
  return `// AUTO-GENERATED by node scripts/build.mjs — DO NOT EDIT. Source: ${sourcePath}\n`
}

/**
 * 域目录与产物目录之间的双向判据：**每一份产物都要能追溯回一份源码，每一份源码都要有产物**。
 *
 * 这是 #1023 里顶替四条「新鲜度门禁」的那条结构性保证。旧门禁比的是时间与快照
 * （源码的修改时间新过产物就报红），它依赖人记得跑构建、也依赖比对口径不出错；
 * 这条判据只问一件事：这棵树上有没有追溯不到源的产物、有没有该有而没有的产物。
 * 只要构建是唯一写产物的人（本仓就是这么定的），这两问就把「陈旧」这整类故障堵死了。
 *
 * 两个方向都在这里算，调用方一次拿到完整结论：
 *   - 有产物、没有同名源码 → 陈旧产物（多半是源码删了或改了名，产物留在盘上）；
 *   - 有源码、没有同名产物 → 缺产物（多半是构建没跑完，或者构建根本没有产出它）。
 *
 * `handWritten` 是**手写**在域目录里的产物名单：域里允许住手写文件（今天有三份，见各自的域说明），
 * 它们没有同名源码，不算陈旧。名单由调用方给，这个函数不猜——猜（比如「文件头没有生成标记就当手写」）
 * 会把「构建漏写了生成标记」这种真故障当成合法情况放过去。
 *
 * @param {{ sources: string[], outputs: string[], handWritten?: string[] }} input 三个名单都写文件名，不写完整路径
 * @returns {{ problem: string, detail: string }[]} 问题清单，空数组表示两个方向都干净
 */
export function checkDomainConsistency({ sources, outputs, handWritten = [] }) {
  const problems = []
  const sourceSet = new Set(sources)
  const outputSet = new Set(outputs)
  const handWrittenSet = new Set(handWritten)

  // 名单里出现两次同一个名字，说明调用方自己就搞错了（比如同一个文件被两条规则各收一次）。
  // 这条不查也不会让上面两条判据出错，但会让「这份名单到底代表什么」慢慢变得没人说得清，
  // 所以在这里当场报出来。
  for (const [label, list] of [['源码', sources], ['产物', outputs], ['手写产物', handWritten]]) {
    if (new Set(list).size !== list.length) {
      problems.push({
        problem: 'duplicate-name',
        detail: `${label}名单里有重名条目（${list.length} 条、去重后 ${new Set(list).size} 条）：一份名单里同一个文件只该出现一次。`,
      })
    }
  }

  if (sources.length === 0) {
    problems.push({
      problem: 'empty-domain',
      detail: '这个域里一份 .ts 源码都没有：要么源码被搬空了，要么域目录指错了。构建在这里必须失败，而不是静默产出一个空域。',
    })
  }

  for (const name of outputs) {
    if (name.endsWith('.ts')) continue // 扩展名反了才会走到这里，源码那一条会报出来
    if (sourceSet.has(name.slice(0, -'.js'.length) + '.ts')) continue
    if (handWrittenSet.has(name)) continue
    problems.push({
      problem: 'stale-output',
      detail: `产物 ${name} 在这个域里找不到同名 .ts 源码，也不是名单里的手写文件：它已经追溯不到来源，请删掉它，或者把源码补回来。`,
    })
  }

  for (const name of sources) {
    // 产物该叫什么，由路径推导那一份实现算（deriveOutputPath），这里不重写第二遍换后缀的规则。
    const derived = deriveOutputPath(syntheticSourcePath(name))
    const expected = derived.slice(derived.lastIndexOf('/') + 1)
    if (outputSet.has(expected)) continue
    problems.push({
      problem: 'missing-output',
      detail: `源码 ${name} 没有对应的产物 ${expected}：构建没把它写出来，或者构建根本没跑到这一步。`,
    })
  }

  return problems
}

/**
 * 把一份域内的源码文件名拼成「仓库相对路径」的样子，只为了让 deriveOutputPath 认得它。
 *
 * 为什么需要这一层：双向判据收的是**文件名**（调用方在域目录里读到的就是文件名），
 * 而路径推导那条规律吃的是仓库相对路径。拼出来的这份路径只用于推导，不指向盘上任何东西。
 */
function syntheticSourcePath(name) {
  return `src/shared/x/src/${name}`
}
