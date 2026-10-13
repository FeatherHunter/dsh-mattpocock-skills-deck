// tests/verify-dependency-rules.ts —— 源码引用方向门禁（issue #1017 换轨后）
//
// 这条门禁替掉两条老门禁：
//   tests/verify-no-same-layer-import.js（同层互引，#439）
//   tests/verify-no-cross-import.js（三个后端房间的纪律，#326）
// 换轨的理由记在讨论票 #1014 的 Q2 结论里：老门禁按路径扫 .js 文本，文件改名之后扫不到东西还判绿
// （空集合假绿），而 .ts 是一整个空窗。现在判据来自依赖图（dependency-cruiser 读真源），两种源码一起看，
// 「文件在不在」由解析器说了算。
//
// 判据分三层，缺一层都不算换完：
//   一、图上的边：规则写在仓库根目录 .dependency-cruiser.cjs（同层互引四条、房间纪律两条、禁循环一条）。
//       本文件只负责跑它、核对存量豁免、判红判绿，不重复写规则；规则被删或降级时本文件会判红。
//   二、工具看不见的引用：非字面量动态 import。解析器只在参数是字符串字面量时才产生依赖，所以
//       await import(name)、import(`./x/${n}.js`)、import('./' + name) 这类写法在图上完全不存在。
//       老门禁的口径是「一律算违规」（#1014 Q2 明确要求沿用这条严格度），所以由本文件用文本扫描补上。
//   三、空间不许是空的：三棵树必须真实扫到源码文件、图上必须有模块。扫到 0 个一律判红——
//      老门禁在「一个文件都没扫到」时照样打印 PASS，这正是本票要修的假绿。
//
// 存量豁免：tests/same-layer-baseline.json 的 entries（键 file|resolved），只许减不许增。
//   在册的边放行；不在册的新边判红；在册但图上已经没有的条目打 INFO，提示可以清理。
//   房间纪律与禁循环没有豁免清单：违规即红。非字面量动态引用同样没有豁免。
//
// 用法：
//   node tests/verify-dependency-rules.ts        跑门禁（已挂在 npm run verify 链上）
//   退出码 0 = 通过，1 = 有新增违规、工具起不来、或结构不对（扫到 0 个文件也算）。
// 手工对抗自检（证明「故意违规能被抓住」）：往 src/shared/ 下临时放两个互相 import 的文件再跑一遍本门禁，
//   应当判红；跑完删掉。本文件启动时先跑内存夹具，夹具里包含「故意违规」与「空集合」两组反例。
//
// 与外部的衔接：
//   规则文件 .dependency-cruiser.cjs 的头部注释写着三条口径约定（只看三棵树、类型级 import 也算边、
//   非字面量动态引用由本文件补），改规则前先读那里。
//   tests/verify-gate-map.js 检查「每个源码文件都有门禁覆盖」，本文件读的 .dependency-cruiser.cjs 与
//   tests/same-layer-baseline.json 会被它算成归属依据，所以规则的落点改名字时两处要一起动。

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanCode } from '../scripts/gate-map.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// 与两条老门禁的扫描域逐字相同：只看这三棵树。src/client/** 不进图（那里同名 .js 是构建产物，会重复计数）。
const SCAN_TREES = ['src/host', 'src/shared', 'src/seam']
// 第四棵树是「有就扫、没有也不算缺」：src/deck/ 是把 deck 业务代码搬过去之后的目标树
// （CONTEXT.md 的 deck 重构词条里写着它的位置）。实测它多数文件本来就会被 src/host/tools/**
// 的 import 边带进图里（37 个里 35 个），只有 src/deck/rules/index.ts 与
// src/deck/registration/agent-row.ts 两个叶子文件必须写进根清单才进得来。
// 所以这里的作用不是「让规则第一次有判据可判」，而是让「图是完整的」不依赖「import 边碰巧够长」：
// 以后往 deck 里加一个没人引用的新文件，它也会自动进图、自动受 deck 深引与纯规则侧两条管。
const OPTIONAL_TREES = ['src/deck']
const CONFIG_REL = '.dependency-cruiser.cjs'
const BASELINE_REL = 'tests/same-layer-baseline.json'
const DEPCRUISE_BIN_REL = 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'
const SOURCE_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']
// 同层互引四条 + 房间纪律两条 + deck 深引一条 + 纯规则侧两条 + 禁循环一条。出现在这里的作用是
// 「配置被改松就判红」：少一条、名字改了、severity 不是 error，都会在下面对不上。
const EXPECTED_RULES = [
  'same-layer-import-platform',
  'same-layer-import-host',
  'same-layer-import-shared',
  'same-layer-import-seam',
  'cross-room-import',
  'room-imports-third-party-package',
  'deck-deep-import',
  'deck-rules-stay-pure',
  'deck-rules-no-node-builtins',
  'circular-dependency',
]
const SAME_LAYER_RULE_PREFIX = 'same-layer-import-'

type Violation = {
  from?: string
  to?: string
  unresolvedTo?: string
  rule?: { name?: string, severity?: string, comment?: string }
}
type NonLiteralRef = { file: string, line: number, snippet: string }
type BaselineEntry = { file: string, resolved: string }
type ScopeFile = { rel: string, abs: string }

let failed = false
function fail(msg: string): void {
  failed = true
  console.log('  FAIL ' + msg)
}
function pass(msg: string): void {
  console.log('  PASS ' + msg)
}
function info(msg: string): void {
  console.log('  INFO ' + msg)
}

// ---------------------------------------------------------------------------
// 一、非字面量动态引用（工具盲区，文本扫描补上）
// ---------------------------------------------------------------------------

/** 跳过空白与注释，返回下一个有效字符的位置（注释按 JS 词法规则识别）。 */
function skipTrivia(code: string, from: number): number {
  let i = from
  while (i < code.length) {
    const ch = code[i]
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1
      continue
    }
    if (ch === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && code[i + 1] === '*') {
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1
      i = Math.min(code.length, i + 2)
      continue
    }
    break
  }
  return i
}

/** 从引号位置扫出字符串字面量的右引号位置（处理反斜杠转义，行内不跨行）。 */
function endOfString(code: string, quoteAt: number): number {
  const quote = code[quoteAt]
  let i = quoteAt + 1
  while (i < code.length) {
    if (code[i] === '\\') {
      i += 2
      continue
    }
    if (code[i] === quote) return i
    if (code[i] === '\n') return i
    i += 1
  }
  return i
}

/** 从反引号位置扫出模板串的收尾反引号位置，并报告它有没有 ${} 插值。 */
function endOfTemplate(code: string, tickAt: number): { end: number, hasSub: boolean } {
  let i = tickAt + 1
  let hasSub = false
  let depth = 0
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (depth === 0 && ch === '`') return { end: i, hasSub }
    if (ch === '$' && code[i + 1] === '{') {
      hasSub = true
      depth += 1
      i += 2
      continue
    }
    if (depth > 0 && ch === '}') depth -= 1
    i += 1
  }
  return { end: i, hasSub }
}

/**
 * 找出「非字面量动态引用」：import(...) 或 require(...) 的实参不是一个自足的字符串字面量。
 * 判定沿用老门禁的严格度，并把老门禁漏掉的一种也算上：
 *   import(name)、import(`./x/${n}.js`)、require(name)   → 违规（老门禁也判）
 *   import('./x.js')、import('./x.js', 带第二参数)        → 放行（字面量，图上也有这条边）
 *   import('./' + name)                                  → 违规（路径是算出来的，图上没有这条边）
 * 注释与字符串内部的同名文本不算（靠 gate-map 的 scanCode 先把注释与字符串内容抹平，
 * 它同时带有正则字面量的启发式识别，比在本文件里另写一套可靠）。
 */
export function scanNonLiteralDynamicRefs(rel: string, code: string): NonLiteralRef[] {
  const { masked } = scanCode(code)
  const out: NonLiteralRef[] = []
  const head = /(?:\bimport\s*\(|\brequire\s*\()/g
  let m: RegExpExecArray | null
  while ((m = head.exec(masked)) !== null) {
    const afterParen = skipTrivia(code, m.index + m[0].length)
    const first = code[afterParen]
    let bad = false
    if (first === undefined || first === ')') continue
    if (first === "'" || first === '"') {
      // 字面量开头：只有当右引号后面紧跟着 ')' 或 ',' 时才算「自足的路径」；
      // 跟着 '+' 之类说明路径是拼出来的，图上同样没有这条边，按老口径判违规。
      const close = endOfString(code, afterParen)
      const afterClose = skipTrivia(code, close + 1)
      bad = !(code[afterClose] === ')' || code[afterClose] === ',')
    } else if (first === '`') {
      // 模板串：带 ${} 插值的一定是拼出来的；不带插值的在老门禁里也算非字面量（spec 记 'template'），
      // 口径从严，一律判违规——今天三棵树里一条都没有，将来真要用就显式记进豁免并说明理由。
      const tpl = endOfTemplate(code, afterParen)
      bad = true
      void tpl
    } else {
      bad = true
    }
    if (!bad) continue
    const line = code.slice(0, m.index).split('\n').length
    out.push({ file: rel, line, snippet: code.slice(m.index, m.index + 70).split('\n')[0].trim() })
  }
  // 同一行同一片段只报一次（例如 import( 在链式写法里被扫到两遍）。
  const seen = new Set<string>()
  return out.filter((r) => {
    const key = r.file + '|' + r.line + '|' + r.snippet
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ---------------------------------------------------------------------------
// 二、把图上的违规分成「白名单里放行」与「新增判红」
// ---------------------------------------------------------------------------

/**
 * 只有同层互引允许走存量豁免；房间纪律、第三方包、循环依赖一律判红。
 * allowed 的键是 file|resolved（与 tests/same-layer-baseline.json 的键一致）。
 */
export function classifyViolations(
  violations: Violation[],
  allowed: Set<string>,
): { fresh: Violation[], tolerated: Violation[] } {
  const fresh: Violation[] = []
  const tolerated: Violation[] = []
  for (const v of violations) {
    const name = String((v.rule && v.rule.name) || '')
    const key = String(v.from || '') + '|' + String(v.to || '')
    const isSameLayer = name.startsWith(SAME_LAYER_RULE_PREFIX)
    if (isSameLayer && allowed.has(key)) tolerated.push(v)
    else fresh.push(v)
  }
  return { fresh, tolerated }
}

// ---------------------------------------------------------------------------
// 三、扫描域：三棵树里到底有没有文件
// ---------------------------------------------------------------------------

/**
 * 这次实际要进图的树：三棵树必看，src/deck 存在就一起看
 * （见上面 OPTIONAL_TREES 的注释：那棵树一出现，deck 深引规则就该有判据可判）。
 */
function cruiseRoots(): string[] {
  return SCAN_TREES.concat(OPTIONAL_TREES.filter((tree) => existsSync(join(ROOT, tree))))
}

/** 递归收集扫描域里的源码文件；三棵树都在、且至少扫到一个文件，才算扫描域成立。 */
export function collectScopeFiles(): ScopeFile[] {
  const out: ScopeFile[] = []
  for (const tree of cruiseRoots()) {
    const abs = join(ROOT, tree)
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue
    const stack = [abs]
    while (stack.length) {
      const cur = stack.pop() as string
      for (const entry of readdirSync(cur, { withFileTypes: true })) {
        const full = join(cur, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else if (entry.isFile() && SOURCE_EXTS.includes(entry.name.slice(entry.name.lastIndexOf('.')))) {
          out.push({ rel: relative(ROOT, full).split('\\').join('/'), abs: full })
        }
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

/**
 * 空集合判红：三棵树缺一棵、一个文件都没扫到、图上一个模块都没有，都不许判绿。
 * treeExists 留成参数是为了自检能用「假装三棵树都不存在」的夹具把它试出来，
 * 正式运行时不传，按磁盘实况查。
 */
export function scopeProblems(
  files: ScopeFile[],
  moduleCount: number,
  treeExists: (tree: string) => boolean = (tree) => existsSync(join(ROOT, tree)),
): string[] {
  const problems: string[] = []
  for (const tree of SCAN_TREES) {
    if (!treeExists(tree)) problems.push('扫描域的目录不存在：' + tree)
  }
  if (!files.length) problems.push('三棵树里一个源码文件都没扫到（空集合不许判绿）')
  if (moduleCount <= 0) problems.push('依赖图里一个模块都没有（空集合不许判绿）')
  return problems
}

// ---------------------------------------------------------------------------
// 自检内存夹具（先自己证明判据会红，再去判真仓库）
// ---------------------------------------------------------------------------

function selfCheck(): void {
  console.log('== 自检内存夹具 ==')
  const cases: Array<[string, string, number]> = [
    ["const a = await import('./x.js')", '字面量动态 import 放行', 0],
    ["const a = await import(/* 注释 */ './x.js')", '注释后的字面量放行', 0],
    ["const a = await import('./x.js', { with: { type: 'json' } })", '带第二个参数的字面量放行', 0],
    ['const a = await import(\n  \'./x.js\'\n)', '跨行的字面量放行', 0],
    ['const b = await import(name)', '非字面量 dynamic import 判红（老门禁同款）', 1],
    ["const c = await import('./' + name)", '拼出来的路径判红（老门禁漏了，本门禁补上）', 1],
    ['const d = await import(`./x/${n}.js`)', '带插值的模板串判红', 1],
    ['const e = require(name)', '非字面量 require 判红', 1],
    ["const e2 = require('./x.js')", '字面量 require 放行', 0],
    ['// 注释里写 import(name) 不算数\nconst f = 1', '注释里的不算（原老门禁夹具同款）', 0],
    ["const g = 'import(name)'", '字符串里的不算', 0],
    ["/** @param {import('./c.js').X} a */\nmodule.exports = {}", 'JSDoc 类型引用不算（原老门禁夹具同款）', 0],
  ]
  for (const [src, label, expect] of cases) {
    const got = scanNonLiteralDynamicRefs('src/shared/fixture.js', src).length
    if (got === expect) pass(label + '（命中 ' + got + ' 条）')
    else fail(label + '：应命中 ' + expect + ' 条，实际 ' + got + ' 条')
  }

  // 白名单判据：在册放行、不在册判红、非白名单规则（房间纪律）永远判红、空白名单不许自动放行。
  const sameLayer: Violation = {
    from: 'src/shared/a.js',
    to: 'src/shared/b.js',
    rule: { name: 'same-layer-import-shared', severity: 'error' },
  }
  const room: Violation = {
    from: 'src/tracker/rooms/github/x.ts',
    to: 'src/tracker/rooms/gitlab/y.js',
    rule: { name: 'cross-room-import', severity: 'error' },
  }
  const r1 = classifyViolations([sameLayer], new Set(['src/shared/a.js|src/shared/b.js']))
  if (r1.tolerated.length === 1 && r1.fresh.length === 0) pass('在册的存量同层边放行')
  else fail('在册的存量同层边应放行，实际 tolerated=' + r1.tolerated.length + ' fresh=' + r1.fresh.length)
  const r2 = classifyViolations([sameLayer], new Set())
  if (r2.fresh.length === 1) pass('不在册的同层边判红')
  else fail('不在册的同层边应判红，实际 fresh=' + r2.fresh.length)
  const r3 = classifyViolations([room], new Set(['src/tracker/rooms/github/x.ts|src/tracker/rooms/gitlab/y.js']))
  if (r3.fresh.length === 1) pass('房间纪律违规不进豁免（哪怕键在清单里也判红）')
  else fail('房间纪律违规应判红，实际 fresh=' + r3.fresh.length)
  const r4 = classifyViolations([], new Set())
  if (r4.fresh.length === 0) pass('没有违规时判绿（判据本身不无中生有）')
  else fail('没有违规时不应有 fresh')

  // 空集合：三棵树缺目录、扫到 0 个文件、图上 0 个模块，三种都要报问题。
  const p1 = scopeProblems([], 0, () => false)
  if (p1.length >= 3) pass('空集合判红（缺目录 + 零文件 + 零模块都报）')
  else fail('空集合应报至少 3 个问题，实际 ' + p1.length + '：' + JSON.stringify(p1))
  const p1b = scopeProblems([], 0, () => true)
  if (p1b.length === 2) pass('三棵树都在但零文件零模块时仍判红（这就是老门禁的假绿点）')
  else fail('三棵树都在、零文件零模块时应报 2 个问题，实际 ' + p1b.length + '：' + JSON.stringify(p1b))
  const p2 = scopeProblems([{ rel: 'src/seam/gate.js', abs: join(ROOT, 'src/seam/gate.js') }], 3, () => true)
  if (p2.length === 0) pass('扫描域正常时不误报')
  else fail('扫描域正常时不该报问题：' + JSON.stringify(p2))

  selfCheckPurityRules()
}

// ---------------------------------------------------------------------------
// 纯规则侧两条规则的夹具（#1039：判据先自己证明会红，再去判真仓库）
// ---------------------------------------------------------------------------

type PurityRule = { name?: string, severity?: string, from?: { path?: string }, to?: { path?: string[], pathNot?: string, dependencyTypes?: string[] } }

/**
 * 取配置里那条规则；没有就返回 null（调用方判红）。
 * 用 createRequire 读 .cjs：本文件是 ESM，而配置文件是 CommonJS（理由见它的文件头）。
 */
function purityRule(name: string): PurityRule | null {
  let config: { forbidden?: PurityRule[] } = {}
  try {
    const req = createRequire(import.meta.url)
    config = req('../.dependency-cruiser.cjs') as { forbidden?: PurityRule[] }
  } catch (e) {
    return null
  }
  return (config.forbidden || []).find((r) => r && r.name === name) || null
}

/**
 * 把一条规则的 to 判据拿去试一个目标路径：命中就说明这个方向会被判红。
 * path 命中、pathNot 不命中 —— 两个条件都要模拟（契约层就是靠 pathNot 放行的）。
 * 为什么必须模拟 pathNot：少了这一步，夹具会把「规则已经放行契约层」读成「还禁着」，
 * 夹具的结论就与真仓库里引擎的结论相反 —— 那种绿比红更危险，因为它会掩盖一次误伤。
 */
function purityRuleCatches(rule: PurityRule | null, target: string): boolean {
  const patterns = (rule && rule.to && rule.to.path) || []
  const notPattern = (rule && rule.to && rule.to.pathNot) || ''
  if (notPattern && new RegExp(notPattern).test(target)) return false
  return patterns.some((p) => new RegExp(p).test(target))
}

/**
 * 自检内存夹具：证明「纯规则侧不许碰世界」那两条规则真的会红、且不误伤。
 * 为什么要有它：配置里的规则是文本，改松了（删一条、把 path 写错、把 severity 降成 warn）
 * 靠读一遍配置看不出来；这里把规则取出来当场对着几条假目标试一遍。
 * 真仓库那一侧的判据由 dependency-cruiser 自己跑（本文件末尾统一判红绿）。
 */
function selfCheckPurityRules(): void {
  console.log('== 纯规则侧两条规则的夹具（#1039）==')
  const pure = purityRule('deck-rules-stay-pure')
  const builtins = purityRule('deck-rules-no-node-builtins')

  // 两条规则各查四件事：在不在、是不是 error、管的起点对不对（from.path）、管的终点对不对（to）。
  // 为什么四条都要查：只查「在不在」与「severity」时，把 from.path 写错（写成 ^src/deck/ 这种更宽的）
  // 或把终点判据写错，夹具照样全绿，而规则实际上已经不管纯侧了 —— 这正是假门禁的典型形状。
  if (pure && pure.severity === 'error' && pure.from && pure.from.path === '^src/deck/rules/') {
    pass('规则在配置里：deck-rules-stay-pure（error 级，from 是纯规则侧）')
  } else {
    fail('配置里没有 deck-rules-stay-pure 这条 error 级规则，或它的 from.path 不是纯规则侧（#1039 的判据被删或改松了）')
  }
  if (builtins && builtins.severity === 'error' && builtins.from && builtins.from.path === '^src/deck/rules/') {
    pass('规则在配置里：deck-rules-no-node-builtins（error 级，from 是纯规则侧）')
  } else {
    fail('配置里没有 deck-rules-no-node-builtins 这条 error 级规则，或它的 from.path 不是纯规则侧（#1039 的判据被删或改松了）')
  }
  if (builtins && (builtins.to?.dependencyTypes || []).includes('core')) {
    pass('终点判据在：deck-rules-no-node-builtins 管的是内置模块这一类依赖（dependencyTypes 里有 core）')
  } else {
    fail('deck-rules-no-node-builtins 的 to.dependencyTypes 里没有 core（内置模块这一类判据丢了）')
  }
  // 「两条各管一面」这件事要双向查：本配置里一条规则的 to 各条件是「同时满足」，
  // 谁把两件事合进同一条，就会变成「既要落在这些目录、又要是内置模块」，两边一起漏。
  if (pure && pure.to && !pure.to.dependencyTypes) {
    pass('deck-rules-stay-pure 只管目录，不掺内置模块判据（掺了会变成同时满足，两边都漏）')
  } else {
    fail('deck-rules-stay-pure 的 to 里掺进了 dependencyTypes：两条判据合成一条会互相抵消，拆回两条')
  }
  if (builtins && builtins.to && !builtins.to.path) {
    pass('deck-rules-no-node-builtins 只管内置模块，不掺目录判据（同上，两条各管一面）')
  } else {
    fail('deck-rules-no-node-builtins 的 to 里掺进了 path：两条判据合成一条会互相抵消，拆回两条')
  }

  const hostTargets = [
    'src/host/tracker/detection/backendDecision.ts',
    'src/tracker/registry/core.ts',
    'src/deck/shell/call-shell.ts',
    'src/deck/tools/issue-create.ts',
    'src/deck/registration/host-assemble.ts',
    'src/client/views/deck.ts',
    'src/seam/gate.ts',
  ]
  for (const target of hostTargets) {
    if (purityRuleCatches(pure, target)) pass('会判红：纯规则侧引 ' + target)
    else fail('漏判：纯规则侧引 ' + target + ' 应当判红')
  }
  for (const target of ['src/deck/rules/anchor.ts', 'src/shared/labels.js']) {
    if (!purityRuleCatches(pure, target)) pass('不误伤：' + target + '（纯侧内部与共享层照旧可引）')
    else fail('误伤：' + target + ' 不该被 deck-rules-stay-pure 判红')
  }
  // 契约层是唯一放行的往外引用（#1038 第 4 条与 #1108 架构条：「纯规则只引用契约接口，
  // 不深引用房间与宿主能力」）。这条断言曾经写反过：当时按「追踪器整棵都禁」来断言，
  // 结果是门禁会拦住规范明确要求放行的那一种引用，纯侧想按契约写类型只能自己手抄一份 ——
  // 而本图的目的是「规则只有一份」，手抄正是要消灭的东西。现在两面都断言。
  if (!purityRuleCatches(pure, 'src/tracker/contract/deck.ts')) {
    pass('放行：纯规则侧引 src/tracker/contract/deck.ts（契约层是纯类型与数据，规范明确允许）')
  } else {
    fail('误伤：纯规则侧引 src/tracker/contract/deck.ts 不该判红（#1038 第 4 条与 #1108 架构条要求放行契约接口）')
  }
  if (pure && pure.to && pure.to.pathNot === '^src/tracker/contract/') {
    pass('契约层放行写在 to.pathNot 上：tracker 下将来新增的目录自动落进禁列，不会漏放')
  } else {
    fail('deck-rules-stay-pure 的 to.pathNot 不是契约层：放行契约这条判据被删或改宽了')
  }
  if (!purityRuleCatches(pure, 'node:fs') && !purityRuleCatches(pure, 'path')) {
    pass('内置模块不由「不许引宿主目录」那条管（两条规则各管一面，合起来才是完整判据）')
  } else {
    fail('内置模块应当由 deck-rules-no-node-builtins 管，不该混进 deck-rules-stay-pure')
  }
}

// ---------------------------------------------------------------------------
// 真仓库：跑图 → 核豁免 → 判红绿
// ---------------------------------------------------------------------------

/**
 * 数一数真图上「内置模块」这一类依赖边有几条。
 *
 * 为什么要数：deck-rules-no-node-builtins 的终点判据是 `to.dependencyTypes: ['core']`，
 * 而 `core` 这个类别名是 dependency-cruiser 给的，不是本仓定的。哪天上游改了名，
 * 这条规则会**静默地永不命中** —— 配置文本没变、内存夹具照过、真仓库一条违规都没有（看着更绿），
 * 只有「真图上一条 core 都没有」能说明判据已经废了。所以这一条必须拿真图来判，不能只看配置文本。
 */
export function countCoreDependencies(modules: unknown): number {
  const list = Array.isArray(modules) ? modules : []
  let n = 0
  for (const m of list) {
    const deps = (m && typeof m === 'object' && Array.isArray((m as { dependencies?: unknown }).dependencies))
      ? (m as { dependencies: unknown[] }).dependencies : []
    for (const d of deps) {
      const types = (d && typeof d === 'object' && Array.isArray((d as { dependencyTypes?: unknown }).dependencyTypes))
        ? (d as { dependencyTypes: unknown[] }).dependencyTypes : []
      if (types.map(String).includes('core')) n++
    }
  }
  return n
}

selfCheck()
if (failed) {
  console.log('\n自检失败 —— 门禁实现没通过内存夹具，先修实现再判仓库')
  process.exit(1)
}

console.log('\n== 真实仓库 ==')
const files = collectScopeFiles()
const configAbs = join(ROOT, CONFIG_REL)
const binAbs = join(ROOT, DEPCRUISE_BIN_REL)

let moduleCount = 0
let dependencyCount = 0
let coreDependencyCount = 0
const violations: Violation[] = []
const ruleSetUsed: Violation['rule'][] = []

if (!existsSync(configAbs)) {
  fail('规则文件不存在：' + CONFIG_REL)
} else if (!existsSync(binAbs)) {
  fail('依赖检查工具没装：' + DEPCRUISE_BIN_REL + '（先 pnpm install）')
} else {
  const run = spawnSync(
    process.execPath,
    [binAbs, ...cruiseRoots(), '--config', CONFIG_REL, '--output-type', 'json', '--no-progress'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
  )
  const stdout = String(run.stdout || '')
  if (run.error) {
    fail('起不来依赖检查工具：' + String(run.error.message || run.error))
  } else if (!stdout.trim()) {
    fail('依赖检查工具没有输出（退出码 ' + run.status + '）：' + String(run.stderr || '').slice(0, 800))
  } else {
    let parsed: {
      modules?: unknown[]
      summary?: {
        totalDependenciesCruised?: number
        violations?: Violation[]
        ruleSetUsed?: { forbidden?: Violation['rule'][] }
      }
    } = {}
    try {
      parsed = JSON.parse(stdout)
    } catch (e) {
      fail('依赖检查工具的输出不是 JSON：' + String((e as Error).message))
    }
    moduleCount = Array.isArray(parsed.modules) ? parsed.modules.length : 0
    coreDependencyCount = countCoreDependencies(parsed.modules)
    dependencyCount = Number((parsed.summary && parsed.summary.totalDependenciesCruised) || 0)
    for (const v of (parsed.summary && parsed.summary.violations) || []) violations.push(v)
    for (const r of (parsed.summary && parsed.summary.ruleSetUsed && parsed.summary.ruleSetUsed.forbidden) || []) ruleSetUsed.push(r)
  }
}

// 规则清单核对：配置里少一条、名字改了、降成 warn，都判红。这是「漏登会静默变松」的机器判据。
if (ruleSetUsed.length) {
  const got = new Set(ruleSetUsed.map((r) => String((r && r.name) || '')))
  const missing = EXPECTED_RULES.filter((n) => !got.has(n))
  const downgraded = ruleSetUsed.filter((r) => EXPECTED_RULES.includes(String((r && r.name) || '')) && r && r.severity !== 'error')
  if (missing.length) fail('规则清单少了：' + missing.join('、'))
  else pass('规则清单齐全（' + EXPECTED_RULES.length + ' 条）')
  if (downgraded.length) fail('这些规则的 severity 不是 error：' + downgraded.map((r) => String((r && r.name) || '')).join('、'))
  else pass('所有规则的 severity 都是 error')
}

// 存量豁免
let allowed = new Set<string>()
const baselineAbs = join(ROOT, BASELINE_REL)
if (!existsSync(baselineAbs)) {
  fail('存量豁免清单不存在：' + BASELINE_REL)
} else {
  let entries: BaselineEntry[] = []
  try {
    const parsed = JSON.parse(readFileSync(baselineAbs, 'utf8')) as { entries?: BaselineEntry[] }
    entries = Array.isArray(parsed.entries) ? parsed.entries : []
  } catch (e) {
    fail('存量豁免清单不是合法 JSON：' + String((e as Error).message))
  }
  if (!entries.length) fail('存量豁免清单是空的（空集合不许当成「没有违规」）')
  else {
    allowed = new Set(entries.map((e) => String(e.file) + '|' + String(e.resolved)))
    info('存量豁免 ' + entries.length + ' 条（只许减不许增）')
  }
}

// 非字面量动态引用（工具盲区）
const nonLiteral: NonLiteralRef[] = []
for (const f of files) {
  const code = readFileSync(f.abs, 'utf8')
  if (!/import\s*\(|require\s*\(/.test(code)) continue
  for (const hit of scanNonLiteralDynamicRefs(f.rel, code)) nonLiteral.push(hit)
}

// 判红判绿
const problems = scopeProblems(files, moduleCount)
for (const p of problems) fail(p)
if (!problems.length) pass('扫描域成立：' + files.length + ' 个源码文件，图上 ' + moduleCount + ' 个模块、' + dependencyCount + ' 条依赖边')

// 判据的「词汇」还在不在：deck-rules-no-node-builtins 靠 core 这个类别名认内置模块。
// 这一条查的是真图，不是配置文本 —— 上游改类别名时只有它能报出来。
if (coreDependencyCount > 0) {
  pass('图上认得出内置模块这一类依赖（' + coreDependencyCount + ' 条）：deck-rules-no-node-builtins 的判据今天真的能命中')
} else {
  fail('真图上一条「内置模块」依赖都没有：deck-rules-no-node-builtins 的 dependencyTypes 判据在当前 dependency-cruiser 上已经命不中了（类别名可能改了），先修判据再谈其它')
}

const { fresh, tolerated } = classifyViolations(violations, allowed)
const byRule = new Map<string, number>()
for (const v of violations) {
  const name = String((v.rule && v.rule.name) || '(未命名规则)')
  byRule.set(name, (byRule.get(name) || 0) + 1)
}
info('图上违规合计 ' + violations.length + ' 条：' + [...byRule.entries()].map(([n, c]) => n + ' ' + c + ' 条').join('、'))
info('其中在存量豁免里放行 ' + tolerated.length + ' 条，新增 ' + fresh.length + ' 条')
for (const v of fresh) {
  const name = String((v.rule && v.rule.name) || '')
  const comment = String((v.rule && v.rule.comment) || '')
  fail(
    name + '：' + String(v.from || '?') + " -> '" + String(v.unresolvedTo || v.to || '?') + "'" +
      (v.to && v.unresolvedTo ? '（解析为 ' + v.to + '）' : '') +
      (comment ? '\n         规则说明：' + comment : ''),
  )
}
if (!fresh.length) pass('真实仓库零新增方向违规')

// 在册但图上已经没有的条目：只提示，不判红（老门禁同款口径）
const liveKeys = new Set(violations.map((v) => String(v.from || '') + '|' + String(v.to || '')))
const stale = [...allowed].filter((k) => !liveKeys.has(k))
if (stale.length) {
  for (const k of stale) info('豁免条目已消除可清理：' + k.split('|')[0] + ' -> ' + k.split('|')[1] + '（拆分票记得同票删条目）')
} else {
  info('豁免清单没有可清理的条目（' + allowed.size + ' 条全在）')
}

if (nonLiteral.length) {
  for (const hit of nonLiteral) {
    fail('非字面量动态引用（依赖图看不见，图上没有这条边）：' + hit.file + ':' + hit.line + '  ' + hit.snippet)
  }
} else {
  pass('三棵树里没有非字面量动态引用（工具盲区当前是空的）')
}

if (failed) {
  console.log('\n门禁未通过：新增方向违规要先拆分消边，或按「只许减不许增」记进 ' + BASELINE_REL + '（写清理由与归属拆分票）')
  process.exit(1)
}
console.log('\n引用方向门禁通过（同层 ' + (byRule.get('same-layer-import-platform') || 0) +
  ' + ' + (byRule.get('same-layer-import-host') || 0) +
  ' + ' + (byRule.get('same-layer-import-shared') || 0) +
  ' + ' + (byRule.get('same-layer-import-seam') || 0) + ' 条存量已记名，房间纪律与禁循环零违规）')
