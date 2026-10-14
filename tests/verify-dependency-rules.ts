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
//   一、图上的边：规则写在仓库根目录 .dependency-cruiser.cjs（同层互引五条、房间纪律三条、
//       房间只许装配点引用一条、deck 深引一条、纯规则侧两条、禁循环一条，合计十三条）。
//       本文件只负责跑它、核对存量豁免、判红判绿，不重复写规则；规则被删或降级时本文件会判红。
//   二、工具看不见的引用：非字面量动态 import。解析器只在参数是字符串字面量时才产生依赖，所以
//       await import(name)、import(`./x/${n}.js`)、import('./' + name) 这类写法在图上完全不存在。
//       老门禁的口径是「一律算违规」（#1014 Q2 明确要求沿用这条严格度），所以由本文件用文本扫描补上。
//   三、空间不许是空的：三棵树必须真实扫到源码文件、图上必须有模块。扫到 0 个一律判红——
//      老门禁在「一个文件都没扫到」时照样打印 PASS，这正是本票要修的假绿。
//   四、规则不许空转（#1136 补的五条结构判据 + 一条分母）：每条规则的起点、登记表每条条目都必须在
//      磁盘上匹配到真实源码文件；登记表每条要写 why 与 ticket、条数不许超过只许减的上限；登记表不许
//      匹配它所在规则要守的那类路径（「放宽白名单换假绿」的解药）；一条登记项不许覆盖另一条的全部
//      见证文件；起点在扫描域里有文件可判时，还必须在引擎报出来的图上命中至少一个模块（配置把它挡在
//      图外、扩展名引擎不跟、路径形状对不上，三种都会让规则静默空转）。五条都是纯结构判据，不需要
//      往工作树里写探针文件就能判 —— 正控与负控是验收手段，放样本门禁那侧。
//      第六条是分母：绿灯行必须报出「命中几个房间模块 / 盘上几个」。
//   五、工具分不清的边（#1153）：解析器把「解析不到」全归成一个类型，分不清「今天不在盘上的构建产物位」
//      与「路径真的断了」。本文件按「有没有同名源码会在构建后落在这个位置」把它拆开：有源码的打 INFO 放行，
//      没源码的判红；同一节还做一次对账，图上未解析的包名边必须条条都被规则
//      room-imports-unresolved-package 判到（规则哪天命不中这一类，就判红而不是安静放行）。
//      起因、口径与两个方向的实验见下面「二之三」那一节。
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
// 前三棵与两条老门禁的扫描域逐字相同。src/client/** 不进图（那里同名 .js 是构建产物，会重复计数）。
// 第四棵 src/tracker 是 #1136 补上的：房间（src/tracker/rooms/**）在那棵树里，而房间只靠 import 边入图，
// 没人引的房间文件根本不进图 —— 实测盘上 65 个房间源码只有 56 个进得来（缺的 9 个是 gitlab 房的
// 8 个 .js 与 markdown/normalize.ts）。写进根清单，「图是完整的」和「房间纪律真有判域」才不靠边碰巧够长。
const SCAN_TREES = ['src/host', 'src/shared', 'src/seam', 'src/tracker']
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
// 同层互引五条 + 房间纪律三条 + 房间只许装配点引用一条 + deck 深引一条 + 纯规则侧两条 + 禁循环一条。
// 出现在这里的作用是「配置被改松就判红」：少一条、名字改了、severity 不是 error，都会在下面对不上。
const EXPECTED_RULES = [
  'same-layer-import-platform',
  'same-layer-import-host',
  'same-layer-import-shared',
  'same-layer-import-seam',
  // #1152 补的第五条：src/tracker 原来长在 src/host/tracker/ 下、受 same-layer-import-host 管，
  // 搬进 src/tracker/ 之后掉出了所有同层规则，树内互引没人判。判域去掉三个房间（有自己的纪律）与
  // 契约层（纯类型与数据的公共面，内部值引用只许引自己，由 tests/verify-contract-types.js 守）。
  'same-layer-import-tracker',
  'cross-room-import',
  'room-imports-third-party-package',
  // #1153 拆出来的第二条：#1153 之前「解析不到的包名」与「确凿的第三方包」在同一张类型表里，
  // 本仓产物位缺失被误判成引了第三方包。拆完两条合起来才是原来「房间只许引内置模块」的完整判据，
  // 少任何一条都等于判据变松，所以两条都必须在这个清单里。
  'room-imports-unresolved-package',
  'rooms-imported-only-by-assembly',
  'deck-deep-import',
  'deck-rules-stay-pure',
  'deck-rules-no-node-builtins',
  'circular-dependency',
]
const SAME_LAYER_RULE_PREFIX = 'same-layer-import-'
// 起点为空对象（from: {}）的规则：只约束未来文件的规则必须在这里显式登记、写明理由，不许静默留空 ——
// 「起点是空的」与「起点指错地方」在门禁上长得一模一样，而后者正是 #1136 的假绿成因。
const EMPTY_SCOPE_RULES = ['circular-dependency'] // 环不是某一段路径的事，判据是整张图上的环，起点只能是空
// 房间源码的口径（磁盘与图上都用它）：判据五「报分母」用。
const ROOM_PATH_PREFIX = 'src/tracker/rooms/'

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
// 二之二、六条判据：让「规则空转」与「白名单抄宽」在门禁上当场红（#1136）
// ---------------------------------------------------------------------------
//
// 为什么要有这五条：这次的假绿不是「某条规则写错了」这么简单 —— 规则指着一个已经搬走的目录，
// 图上一条边都咬不到，而门禁只核对「规则名在不在、severity 是不是 error」，于是照样判绿。
// 前五条是纯结构判据，不需要注入样本就能判；第六条是分母，让绿灯行也算出一个具体的数：
//   一、活着：规则起点与登记表条目都要落在磁盘上真实存在的源码文件上；
//   二、有名有据：登记表每条要写 why 与 ticket，pattern 不重复，条数不许超过只许减的上限；   三、不吃自己：登记表条目不许匹配它所在规则要守的那类路径（放宽白名单换假绿的解药）；
//   四、不被吸收：一条登记项不许覆盖另一条的全部见证文件（两条说的是同一件事就该删一条）。
// 正控（注入一条确定违规的边，断言判红并点名）与负控（注入合法边，断言不红）是验收手段，
// 放样本门禁那一侧，不当常驻判据用。

type RoomImportEntry = { pattern?: string, why?: string, ticket?: number }
type RoomImports = { protected?: string, entries?: RoomImportEntry[], maxEntries?: number }
type ForbiddenRule = {
  name?: string
  severity?: string
  from?: { path?: string | string[] }
}

/** 房间依赖登记表的位置。为什么不放在规则文件里：dependency-cruiser 只认它自己那几个顶层键
 * （forbidden / allowed / allowedSeverity / required / options / extends），多一个自定义键就拒绝启动，
 * 所以登记表是旁边的这份 JSON：规则文件 require 它、门禁直接读它 —— 一份数据、两个读者。 */
const ROOM_IMPORTS_REL = 'tests/tracker-room-imports.json'

/** 读规则文件里的 forbid 规则，以及房间依赖登记表（登记表见上面 ROOM_IMPORTS_REL）。 */
function readGateConfig(): { forbidden: ForbiddenRule[], roomImports: RoomImports | null } | null {
  let forbidden: ForbiddenRule[]
  try {
    const req = createRequire(import.meta.url)
    const config = req('../.dependency-cruiser.cjs') as { forbidden?: ForbiddenRule[] }
    forbidden = config.forbidden || []
  } catch (e) {
    return null
  }
  let roomImports: RoomImports | null = null
  try {
    roomImports = JSON.parse(readFileSync(join(ROOT, ROOM_IMPORTS_REL), 'utf8')) as RoomImports
  } catch (e) {
    roomImports = null
  }
  return { forbidden, roomImports }
}

/** 把依赖图给的文件路径统一成仓库相对路径（正斜杠）。图上给绝对路径还是相对路径，两种都认。 */
export function toRepoRel(source: unknown): string {
  const raw = String(source || '')
  const slashed = raw.split('\\').join('/')
  if (raw.includes(':') || slashed.startsWith('/')) return relative(ROOT, slashed).split('\\').join('/')
  return slashed.replace(/^\.\//, '')
}

/** 一串正则里任意一条能匹配到磁盘上的源码文件，就算「有落点」。 */
export function matchesAnyFile(patterns: string[], fileRels: string[]): boolean {
  for (const p of patterns) {
    if (!p) continue
    let re: RegExp
    try {
      re = new RegExp(p)
    } catch (e) {
      continue
    }
    if (fileRels.some((f) => re.test(f))) return true
  }
  return false
}

/**
 * 判据一（活着）：每条规则必须有起点判据，且起点、登记表条目都要在磁盘上匹配到真实源码文件。
 * 只约束未来文件的规则要显式登记进 EMPTY_SCOPE_RULES 并写明理由 —— 不许静默留空，
 * 因为「起点空着」和「起点指去了搬家前的旧目录」在门禁上长得一模一样，而后者正是这次的假绿。
 */
export function deadScopeProblems(
  rules: ForbiddenRule[],
  entries: RoomImportEntry[],
  fileRels: string[],
  emptyScopeAllowed: string[] = EMPTY_SCOPE_RULES,
): string[] {
  const problems: string[] = []
  for (const rule of rules) {
    if (!rule || rule.severity !== 'error') continue
    const name = String(rule.name || '(未命名规则)')
    const fromPath = rule.from ? rule.from.path : undefined
    if (fromPath === undefined) {
      if (!emptyScopeAllowed.includes(name)) {
        problems.push('规则 ' + name + ' 的 from 里没有起点判据：只约束未来文件的规则要显式登记进 EMPTY_SCOPE_RULES 并写明理由，不许静默留空')
      }
      continue
    }
    const patterns = (Array.isArray(fromPath) ? fromPath : [fromPath]).map(String)
    if (!matchesAnyFile(patterns, fileRels)) {
      problems.push('规则 ' + name + ' 的起点 [' + patterns.join('、') + '] 在磁盘上一个源码文件都没匹配到 —— 起点可能仍指向搬家前的旧目录，这条规则今天一条边都咬不到')
    }
  }
  for (const entry of entries) {
    const pattern = String((entry && entry.pattern) || '')
    if (!pattern) continue
    if (!matchesAnyFile([pattern], fileRels)) {
      problems.push('登记表条目 ' + pattern + ' 在磁盘上一个源码文件都没匹配到 —— 死条目，删掉或改对（放行清单里的死条目和死规则一样会骗人）')
    }
  }
  return problems
}

/** 判据二（有名有据）：登记表每条要写 why 与正整数 ticket，pattern 不重复，条数不超上限。 */
/**
 * 判据六（图上活着）：起点在扫描域里有文件可判，却在引擎报出来的图上一个模块都没命中。
 *
 * 与判据一、判据五的分工：判据一看扫描域里有没有文件可判（它比的是扫描域实况，所以规则指到
 * 没人扫的目录时，判据一先红）；判据五看房间那一整棵树进没进图（数的是分母）；这条看**每一条规则
 * 自己**在图上咬不咬得到东西 —— 三种漏法各管一段。
 *
 * 它的触发面窄，但都是真事：文件在扫描域里、扫描时却没进图。已知的三种成因是配置里 exclude 把
 * 某些文件挡在门外、扩展名引擎不跟（#1136 里那 9 个 gitlab 房的 .js 就是这么没进图的）、
 * 以及引擎报出来的路径形状变了。触发面窄不代表可以省：判断「规则还咬不咬得到东西」是每条规则
 * 自己的事，拿房间那一棵树的分母代替不了其它规则（#1136 正是栽在「没人问这句话」上）。
 *
 * 域外规则不归它管：扫描域里都没有文件可判的起点（例如只管未来文件的规则）由判据一取舍，
 * 这条遇到扫描域命中为 0 就跳过，免得同一个坏形状被报两遍。
 */
export function graphScopeProblems(
  rules: ForbiddenRule[],
  modules: unknown[],
  fileRels: string[],
): string[] {
  const problems: string[] = []
  const sources = new Set<string>()
  for (const m of Array.isArray(modules) ? modules : []) {
    const source = m && typeof m === 'object' ? (m as { source?: unknown }).source : undefined
    if (source) sources.add(toRepoRel(String(source)))
  }
  for (const rule of rules || []) {
    if (!rule || rule.severity !== 'error') continue
    if (!rule.name || EMPTY_SCOPE_RULES.includes(rule.name)) continue
    const scope = rule.from && typeof rule.from.path === 'string' ? rule.from.path : ''
    if (!scope) continue
    let re: RegExp
    try {
      re = new RegExp(scope)
    } catch {
      continue // 起点正则本身写坏了是引擎与判据一那边的活，这里不重复报
    }
    const diskHits = fileRels.filter((rel) => re.test(rel)).length
    if (!diskHits) continue
    const graphHits = [...sources].filter((src) => re.test(src)).length
    if (!graphHits) {
      problems.push(
        '规则 ' + rule.name + ' 的起点 [' + scope + '] 在扫描域里匹配 ' + diskHits + ' 个源码文件，却在图上一个模块都没命中 —— ' +
          '要么配置文件把这些文件挡在图外，要么这些扩展名引擎不跟，要么引擎报出来的路径形状和这条正则对不上；三种都会让这条规则静默空转',
      )
    }
  }
  return problems
}

export function registryShapeProblems(registry: RoomImports | null): string[] {
  const problems: string[] = []
  if (!registry) {
    problems.push('读不到房间依赖登记表 ' + ROOM_IMPORTS_REL + '：房间白名单必须是这份文件里的唯一真源，别处只许指路（#1136）')
    return problems
  }
  if (!registry.protected || typeof registry.protected !== 'string') {
    problems.push('ROOM_IMPORTS 缺 protected：要写清两条房间规则守的是哪类路径，「不吃自己」那条判据靠它')
  }
  const entries = Array.isArray(registry.entries) ? registry.entries : []
  if (!entries.length) problems.push('ROOM_IMPORTS.entries 是空的：空集合不许当成「没有例外」')
  const max = registry.maxEntries
  if (!Number.isInteger(max) || (max as number) <= 0) {
    problems.push('ROOM_IMPORTS 缺 maxEntries（只许减的条数上限），或它不是正整数')
  } else if (entries.length > (max as number)) {
    problems.push('登记表 ' + entries.length + ' 条，超过 maxEntries ' + max + '：这份清单只许减不许增')
  }
  const seen = new Set<string>()
  entries.forEach((entry, i) => {
    const pattern = String((entry && entry.pattern) || '')
    const label = pattern || ('第 ' + (i + 1) + ' 条')
    if (!pattern) problems.push('登记表第 ' + (i + 1) + ' 条没有 pattern')
    else if (seen.has(pattern)) problems.push('登记表 pattern 重复：' + pattern)
    else {
      seen.add(pattern)
      try {
        new RegExp(pattern)
      } catch (e) {
        problems.push('登记表 pattern 不是合法正则：' + pattern)
      }
    }
    if (!String((entry && entry.why) || '').trim()) problems.push('登记表 ' + label + ' 没有写 why（为什么可以放行）')
    const ticket = entry ? entry.ticket : undefined
    if (!Number.isInteger(ticket) || (ticket as number) <= 0) problems.push('登记表 ' + label + ' 的 ticket 不是正整数（要能追到是哪张票定的）')
  })
  return problems
}

/** 判据三（不吃自己）：登记表条目不许匹配规则自己要守的那类路径。 */
export function selfEatingProblems(registry: RoomImports | null, fileRels: string[]): string[] {
  const problems: string[] = []
  if (!registry || !registry.protected || !Array.isArray(registry.entries)) return problems
  let guard: RegExp
  try {
    guard = new RegExp(registry.protected)
  } catch (e) {
    return problems
  }
  for (const entry of registry.entries) {
    const pattern = String((entry && entry.pattern) || '')
    if (!pattern) continue
    let re: RegExp
    try {
      re = new RegExp(pattern)
    } catch (e) {
      continue
    }
    const hits = fileRels.filter((f) => re.test(f) && guard.test(f))
    if (hits.length) {
      const sample = hits.slice(0, 3).join('、') + (hits.length > 3 ? ' 等 ' + hits.length + ' 个' : '')
      problems.push('登记表条目 ' + pattern + ' 匹配到了规则自己要守的路径（' + sample + '）：白名单不许把它所在规则要守的东西吃掉，这正是「放宽白名单换假绿」那次绕过')
    }
  }
  return problems
}

/** 判据四（不被吸收）：一条登记项不许覆盖另一条的全部见证文件（见证文件按磁盘源码近似）。 */
export function absorbedEntryProblems(registry: RoomImports | null, fileRels: string[]): string[] {
  const problems: string[] = []
  if (!registry || !Array.isArray(registry.entries)) return problems
  const sets = registry.entries.map((entry) => {
    const pattern = String((entry && entry.pattern) || '')
    let re: RegExp | null = null
    try {
      re = pattern ? new RegExp(pattern) : null
    } catch (e) {
      re = null
    }
    return { pattern, files: re ? fileRels.filter((f) => (re as RegExp).test(f)) : [] }
  })
  for (const a of sets) {
    if (!a.files.length) continue
    for (const b of sets) {
      if (b === a || !b.files.length) continue
      const bFiles = new Set(b.files)
      if (a.files.every((f) => bFiles.has(f))) {
        problems.push('登记表条目 ' + a.pattern + ' 的全部见证文件都落在 ' + b.pattern + ' 里：两条说的是同一件事，删掉被吸收的那条')
      }
    }
  }
  return problems
}

/** 判据五（报分母）用：图上有几个模块落在房间目录里（按 source 去重，同一文件可能出现两条）。 */
export function countRoomModules(modules: unknown): number {
  const list = Array.isArray(modules) ? modules : []
  const sources = new Set<string>()
  for (const m of list) {
    const source = m && typeof m === 'object' ? (m as { source?: unknown }).source : undefined
    if (!source) continue
    const rel = toRepoRel(source)
    if (rel.startsWith(ROOM_PATH_PREFIX)) sources.add(rel)
  }
  return sources.size
}

// ---------------------------------------------------------------------------
// 二之三、工具分不清的边：未解析的边由本文件分开判（#1153）
// ---------------------------------------------------------------------------
//
// 起因：规则 room-imports-third-party-package 原来把解析器的 unknown / undetermined / npm-unknown
// 与确凿的 npm 类型列在同一张表里，于是「解析不到」一律当成「引了第三方包」。房间引的本仓共享件写成
// 产物路径（../../../shared/refresh/idempotency.js）时，没跑过构建的检出上那些产物不在盘上，解析器
// 归成 unknown —— 同一份提交，未构建检出多报 12 条、构建后 0 条，输出格式与真违规一模一样，
// 人本地看得见红、CI（先构建）永远看不见。
//
// 为什么不能只把 unknown 从规则里删掉：解析不到还分两种，混在一张表里分不开，删掉就是「用改松判据换绿」。
// 现在这样分：
//   包名形状（ws、@scope/pkg、#subpath）解析不到 → 规则 room-imports-unresolved-package 判红；
//   路径形状（./x.js、../x.js、/abs、盘符）解析不到 → 本文件按「有没有同名源码会在构建后落在这个位置」判：
//     有（同位换扩展名，或 <目录>/src/<名字>.ts 这种源码位与产物位分离的形态）→ 打 INFO 放行；
//     没有 → 判红（路径真断了，或引的东西压根不存在）。
// 另外做一次对账：图上未解析的包名边必须条条都被那条新规则报出来 —— 规则的终点判据哪天命不中了
// （上游改类别名、pathNot 写松），这一条会当场红，而不是安静地放行。

/** 图上一条「解析不到的房间边」：从哪个房间文件出发、写的什么说明符、说明符落在本仓哪个位置（包名形状记空串）。 */
export type UnresolvedRoomEdge = { file: string, specifier: string, target: string }

/** 说明符是不是「路径形状」：相对路径、绝对路径、Windows 盘符。包名形状（ws、@scope/pkg、#subpath）不算。 */
export function isPathSpecifier(spec: string): boolean {
  return /^\.{1,2}(\/|\\|$)/.test(spec) || spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)
}

/** 把相对说明符换算成本仓相对路径（posix 斜杠）；不是相对路径、或走楼梯走到仓库外时返回空串。 */
export function resolveSpecifierTarget(file: string, spec: string): string {
  if (!/^\.{1,2}(\/|\\|$)/.test(spec)) return ''
  const parts = file.split('/').slice(0, -1).concat(spec.split(/[\\/]/))
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      // 走到仓库之外：这不是任何构建产物位，按判红那半边处置（记空串）。
      if (!stack.length) return ''
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

/** 构建产物位的「同名源码」候选：产物位旁边就是源码（换扩展名），以及源码位与产物位分离的 <目录>/src/<名字>.ts。 */
export function productSourceCandidates(target: string): string[] {
  if (!target) return []
  const slash = target.lastIndexOf('/')
  const dir = slash < 0 ? '' : target.slice(0, slash)
  const name = (slash < 0 ? target : target.slice(slash + 1)).replace(/\.(js|mjs|cjs|jsx)$/, '')
  if (!name) return []
  const out: string[] = []
  for (const ext of ['.ts', '.mts', '.cts', '.tsx']) {
    out.push((dir ? dir + '/' : '') + name + ext)
    out.push((dir ? dir + '/src/' : 'src/') + name + ext)
  }
  return out
}

/** 收集图上所有「从房间出发、解析不到」的边。target 只有路径形状的相对说明符才换算出值，其余记空串。 */
export function collectUnresolvedRoomEdges(modules: unknown): UnresolvedRoomEdge[] {
  const out: UnresolvedRoomEdge[] = []
  for (const m of Array.isArray(modules) ? modules : []) {
    if (!m || typeof m !== 'object') continue
    const source = (m as { source?: unknown }).source
    if (!source) continue
    const file = toRepoRel(source)
    if (!file.startsWith(ROOM_PATH_PREFIX)) continue
    const raw = (m as { dependencies?: unknown }).dependencies
    const deps = Array.isArray(raw) ? raw : []
    for (const d of deps) {
      if (!d || typeof d !== 'object') continue
      const dep = d as { module?: unknown, resolved?: unknown, couldNotResolve?: unknown }
      if (dep.couldNotResolve !== true) continue
      const specifier = String(dep.module || dep.resolved || '')
      if (!specifier) continue
      out.push({ file, specifier, target: resolveSpecifierTarget(file, specifier) })
    }
  }
  return out
}

/**
 * 判据七（未解析的路径边）：有同名源码的放行（未构建检出上的产物位），既没产物也没源码的判红。
 *
 * 为什么用「有没有同名源码」而不是按路径形状放行：形状一样的两条边里，一条是还没构建的产物位
 * （src/shared/refresh/idempotency.js 对应 src/shared/refresh/src/idempotency.ts），另一条是写错的路径
 * （idempotensy.js）。只看形状会把后者一起放行，等于改松；看源码在不在，两种才分得开。
 * exists 由调用方注入，自检夹具就能用它把「有源码 / 没源码 / 仓库外」三种情形都走一遍。
 */
export function unresolvedPathEdgeProblems(
  edges: UnresolvedRoomEdge[],
  exists: (rel: string) => boolean,
): { problems: string[], explained: UnresolvedRoomEdge[] } {
  const problems: string[] = []
  const explained: UnresolvedRoomEdge[] = []
  for (const edge of edges) {
    if (edge.target && productSourceCandidates(edge.target).some((c) => exists(c))) {
      explained.push(edge)
      continue
    }
    const where = edge.target
      ? '（解析为 ' + edge.target + '）'
      : '（这条边的目标落在本仓之外，不在任何构建产物位上）'
    problems.push(
      '房间引的路径既不在盘上、也没有同名源码会在构建后落在这个位置：' + edge.file +
      " -> '" + edge.specifier + "'" + where +
      ' —— 先修路径；如果它本该是构建产物，就把源码放在 <目录>/src/<名字>.ts（产物位的同名源码），让构建生成它',
    )
  }
  return { problems, explained }
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
  selfCheckRoomStructure()
  selfCheckUnresolvedEdges()
}

/**
 * 六条判据自己的夹具（#1136）：每条先证明「会红」，再证明「不误伤」，最后才拿去判真仓库。
 * 为什么非要这一层：这六条读的是规则文件、磁盘清单与真图，写松了（少一条循环、protected 写错、
 * 把显式登记的空起点也当红、把域外规则也拉进来）用肉眼看配置看不出来 —— 而它们正是这次假绿的解药。
 */
function selfCheckRoomStructure(): void {
  const rels = [
    'src/tracker/rooms/github/index.ts',
    'src/tracker/rooms/gitlab/index.ts',
    'src/tracker/contract/vocabulary.ts',
    'src/tracker/contract/operations.ts',
    'src/host/outbound/admission.ts',
  ]
  const liveEntry: RoomImportEntry = { pattern: '^src/tracker/contract/', why: '契约层是房间的共用词汇表', ticket: 1014 }
  const rules: ForbiddenRule[] = [
    { name: 'cross-room-import', severity: 'error', from: { path: '^src/tracker/rooms/([^/]+)/' } },
    { name: 'dead-rule', severity: 'error', from: { path: '^src/host/tracker/backends/' } },
    { name: 'circular-dependency', severity: 'error', from: {} },
  ]

  // 判据一（活着）：起点指空目录的规则、匹配不到东西的登记条目，两个都要判红。
  const dead = deadScopeProblems(rules, [liveEntry, { pattern: '^src/host/tracker/backends/', why: '旧路径', ticket: 1019 }], rels)
  if (dead.length === 2 && dead.some((p) => p.includes('dead-rule')) && dead.some((p) => p.includes('backends'))) {
    pass('判据一（活着）：起点指空目录的规则与死条目都被点名判红')
  } else {
    fail('判据一（活着）应同时报出死规则与死条目，实际 ' + dead.length + ' 条：' + JSON.stringify(dead))
  }
  const deadOk = deadScopeProblems([rules[0]], [liveEntry], rels)
  if (deadOk.length === 0) pass('判据一（活着）不误伤：起点与条目都落在磁盘上时不报')
  else fail('判据一（活着）误伤了正常起点或条目：' + JSON.stringify(deadOk))
  const deadEmpty = deadScopeProblems([rules[2]], [], rels)
  if (deadEmpty.length === 0) pass('判据一（活着）：显式登记的空起点（circular-dependency）跳过')
  else fail('判据一（活着）把显式登记的空起点也判红了：' + JSON.stringify(deadEmpty))
  const deadUnregistered = deadScopeProblems([{ name: 'some-future-rule', severity: 'error', from: {} }], [], rels)
  if (deadUnregistered.length === 1) pass('判据一（活着）：没登记的空起点判红（不许静默留空）')
  else fail('判据一（活着）漏了没登记的空起点：' + JSON.stringify(deadUnregistered))

  // 判据二（有名有据）：缺 why、ticket 非法、pattern 重复、超上限、没有 pattern，五种坏形状都判红。
  const okRegistry: RoomImports = { protected: '^src/tracker/rooms/', entries: [liveEntry], maxEntries: 12 }
  const shapeOk = registryShapeProblems(okRegistry)
  if (shapeOk.length === 0) pass('判据二（有名有据）不误伤：why 与 ticket 齐、条数没超上限')
  else fail('判据二（有名有据）误伤了正常登记表：' + JSON.stringify(shapeOk))
  const shapeBad = registryShapeProblems({
    protected: '^src/tracker/rooms/',
    entries: [{ pattern: '^src/tracker/contract/', why: '   ', ticket: 0 }, liveEntry, { why: '没有 pattern', ticket: 1 }],
    maxEntries: 1,
  })
  const wants = ['why', 'ticket', 'maxEntries', '重复', '没有 pattern']
  if (wants.every((w) => shapeBad.some((p) => p.includes(w)))) {
    pass('判据二（有名有据）：缺 why、ticket 非法、pattern 重复、超上限、没有 pattern 都判红')
  } else {
    fail('判据二（有名有据）漏了某种坏形状：' + JSON.stringify(shapeBad))
  }
  if (registryShapeProblems(null).length === 1) pass('判据二（有名有据）：登记表整个不存在时判红')
  else fail('判据二（有名有据）：登记表不存在时应当判红')

  // 判据三（不吃自己）：把登记表放宽到覆盖房间目录，当场判红 —— 这次绕过的解药。
  const eating = selfEatingProblems({ protected: '^src/tracker/rooms/', entries: [{ pattern: '^src/tracker/', why: '抄宽了', ticket: 1 }], maxEntries: 12 }, rels)
  if (eating.length === 1 && eating[0].includes('^src/tracker/')) pass('判据三（不吃自己）：覆盖房间目录的宽条目判红')
  else fail('判据三（不吃自己）没抓住覆盖房间目录的宽条目：' + JSON.stringify(eating))
  const eatingOk = selfEatingProblems(okRegistry, rels)
  if (eatingOk.length === 0) pass('判据三（不吃自己）不误伤：契约层那条不碰房间路径')
  else fail('判据三（不吃自己）误伤：' + JSON.stringify(eatingOk))

  // 判据四（不被吸收）：被更宽条目整个盖住的登记项判红，各管一块时都留。
  const absorbed = absorbedEntryProblems({
    protected: '^src/tracker/rooms/',
    entries: [liveEntry, { pattern: '^src/tracker/contract/vocabulary\\.ts$', why: '被上面那条整个盖住', ticket: 1 }],
    maxEntries: 12,
  }, rels)
  if (absorbed.length === 1 && absorbed[0].includes('全部见证文件')) pass('判据四（不被吸收）：被更宽条目整个盖住的登记项判红')
  else fail('判据四（不被吸收）没抓住被吸收的条目：' + JSON.stringify(absorbed))
  const absorbedOk = absorbedEntryProblems(okRegistry, rels)
  if (absorbedOk.length === 0) pass('判据四（不被吸收）不误伤：只留一条时不报')
  else fail('判据四（不被吸收）误伤：' + JSON.stringify(absorbedOk))

  // 判据五（报分母）：图上的房间模块数按仓库相对路径数出来。
  const counted = countRoomModules([
    { source: join(ROOT, 'src/tracker/rooms/github/index.ts') },
    { source: 'src/tracker/rooms/github/index.ts' },
    { source: join(ROOT, 'src/host/index.js') },
  ])
  if (counted === 1) pass('判据五（报分母）：绝对路径与相对路径都认，且同一文件只数一次')
  else fail('判据五（报分母）数错了房间模块，实际 ' + counted)

  // 判据六（图上活着）：磁盘上有文件、图上却一个模块都没命中的规则判红 —— 这次假绿的另一种形状。
  // 三种情形都要试：会红、不误伤、不越界管域外规则（磁盘上也没文件的那种）。
  const graphModules = [
    { source: 'src/tracker/rooms/github/index.ts' },
    { source: join(ROOT, 'src/tracker/rooms/gitlab/index.ts') },
    { source: 'src/host/index.js' },
  ]
  const silent = graphScopeProblems([{ name: 'silent-rule', severity: 'error', from: { path: '^src/host/outbound/' } }], graphModules, rels)
  if (silent.length === 1 && silent[0].includes('silent-rule')) {
    pass('判据六（图上活着）：扫描域里有文件、图上一个模块都没命中的规则判红')
  } else {
    fail('判据六（图上活着）漏了图上零命中的规则：' + JSON.stringify(silent))
  }
  const silentOk = graphScopeProblems(rules, graphModules, rels)
  if (silentOk.length === 0) pass('判据六（图上活着）不误伤：起点在图上命中时不报')
  else fail('判据六（图上活着）误伤了在图上能命中的规则：' + JSON.stringify(silentOk))
  const silentOutside = graphScopeProblems([{ name: 'future-rule', severity: 'error', from: { path: '^src/client/' } }], graphModules, rels)
  if (silentOutside.length === 0) pass('判据六（图上活着）：扫描域里也没文件的域外起点不归它管（那是判据一的活）')
  else fail('判据六（图上活着）越界管了域外起点：' + JSON.stringify(silentOutside))
  const silentDowngraded = graphScopeProblems([{ name: 'warn-rule', severity: 'warn', from: { path: '^src/tracker/rooms/' } }], [], rels)
  if (silentDowngraded.length === 0) pass('判据六（图上活着）：非 error 的规则不归它管（severity 由规则清单那条判）')
  else fail('判据六（图上活着）管了非 error 的规则：' + JSON.stringify(silentDowngraded))
}

/**
 * 判据七自己的夹具（#1153）：先证明「会红」，再证明「该放行的不误伤」，最后才拿去判真仓库。
 * 为什么要这一层：这条判据读的是图上的边与磁盘上的源码，写松了（路径形状认错、产物位候选少算一种、
 * 落在仓库外的边也当产物位放行）读一遍代码看不出来 —— 而它正是「未构建检出上多报 12 条」的解药。
 */
function selfCheckUnresolvedEdges(): void {
  console.log('== 未解析的路径边夹具（#1153）==')

  // 形状：判据七只吃路径形状；包名形状归规则 room-imports-unresolved-package，一条都不许漏到这边来。
  const shapeCases: Array<[string, boolean]> = [
    ['./x.js', true],
    ['../x.js', true],
    ['..', true],
    ['/abs/x.js', true],
    ['D:/x.js', true],
    ['ws', false],
    ['@scope/pkg', false],
    ['#subpath', false],
    ['ws/lib/x.js', false],
  ]
  for (const [spec, expect] of shapeCases) {
    const got = isPathSpecifier(spec)
    if (got === expect) pass('说明符 ' + spec + (expect ? ' 认成路径形状' : ' 不认成路径形状'))
    else fail('说明符 ' + spec + ' 的形状认错了：应为 ' + expect + '，实际 ' + got)
  }

  // 换算：房间文件在 src/tracker/rooms/github/ 下，三级 .. 回到 src/；走过头就是仓库外。
  const t1 = resolveSpecifierTarget('src/tracker/rooms/github/idempotency.ts', '../../../shared/refresh/idempotency.js')
  if (t1 === 'src/shared/refresh/idempotency.js') pass('相对说明符换算成本仓相对路径（' + t1 + '）')
  else fail('相对说明符换算错了：' + t1)
  const t2 = resolveSpecifierTarget('src/tracker/rooms/github/idempotency.ts', '../../../../../../outside.js')
  if (t2 === '') pass('走到仓库外的相对说明符不认成产物位（记空串）')
  else fail('走到仓库外的相对说明符应记空串，实际 ' + t2)

  // 产物位候选：同位换扩展名与「源码位与产物位分离」两种形态都要有，少一种就会误判真产物位。
  const cands = productSourceCandidates('src/shared/refresh/idempotency.js')
  if (cands.includes('src/shared/refresh/idempotency.ts') && cands.includes('src/shared/refresh/src/idempotency.ts')) {
    pass('产物位候选两种形态都在（同位换扩展名 + <目录>/src/<名字>.ts）')
  } else fail('产物位候选少了形态：' + cands.join('、'))

  const edge = (spec: string, target: string): UnresolvedRoomEdge => ({
    file: 'src/tracker/rooms/github/idempotency.ts',
    specifier: spec,
    target,
  })
  const sameDir = unresolvedPathEdgeProblems(
    [edge('./idempotency.js', 'src/tracker/rooms/github/idempotency.js')],
    (rel) => rel === 'src/tracker/rooms/github/idempotency.ts',
  )
  if (sameDir.problems.length === 0 && sameDir.explained.length === 1) pass('产物位缺失、但同位有同名源码时放行（打 INFO）')
  else fail('同位有同名源码时不该判红：' + JSON.stringify(sameDir.problems))

  const split = unresolvedPathEdgeProblems(
    [edge('../../../shared/refresh/idempotency.js', 'src/shared/refresh/idempotency.js')],
    (rel) => rel === 'src/shared/refresh/src/idempotency.ts',
  )
  if (split.problems.length === 0 && split.explained.length === 1) pass('源码位与产物位分离（<目录>/src/<名字>.ts）时放行')
  else fail('分离形态下不该判红：' + JSON.stringify(split.problems))

  const noSource = unresolvedPathEdgeProblems(
    [edge('../../../shared/refresh/idempotensy.js', 'src/shared/refresh/idempotensy.js')],
    () => false,
  )
  if (noSource.problems.length === 1) pass('既没产物也没同名源码的路径判红（写错的路径不许混过去）')
  else fail('没源码的路径应判红，实际 ' + noSource.problems.length + ' 个问题')

  const outside = unresolvedPathEdgeProblems([edge('../../../../../../outside.js', '')], () => true)
  if (outside.problems.length === 1) pass('走到仓库外的路径判红（磁盘上到处都有同名文件也不放行）')
  else fail('仓库外的路径应判红，实际 ' + outside.problems.length + ' 个问题')
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
// 判据五（报分母）用：图上落在房间目录里的模块数（按 source 去重）。
let roomModuleCount = 0
let dependencyCount = 0
let coreDependencyCount = 0
// 判据六（图上活着）用：引擎报出来的模块清单（判据自己按 source 去重后拿去和规则的起点对）。
let graphModules: unknown[] = []
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
    roomModuleCount = countRoomModules(parsed.modules)
    graphModules = Array.isArray(parsed.modules) ? parsed.modules : []
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

// 五条结构判据（#1136）：规则不许空转、登记表不许抄宽。跑在真仓库的磁盘清单、规则文件与真图上。
// 为什么放在规则清单核对与引擎跑完之后：先把「规则在不在、是不是 error」这层查完，再查「在的这条还咬不咬得到东西」。
{
  const gateConfig = readGateConfig()
  if (!gateConfig) {
    fail('读不出规则文件 ' + CONFIG_REL + '：起点是否活着、登记表是否抄宽都无从核对')
  } else {
    const rels = files.map((f) => f.rel)
    const entries = gateConfig.roomImports && Array.isArray(gateConfig.roomImports.entries) ? gateConfig.roomImports.entries : []
    const judgeProblems = [
      ...registryShapeProblems(gateConfig.roomImports),
      ...selfEatingProblems(gateConfig.roomImports, rels),
      ...absorbedEntryProblems(gateConfig.roomImports, rels),
      ...deadScopeProblems(gateConfig.forbidden, entries, rels),
      ...graphScopeProblems(gateConfig.forbidden, graphModules, rels),
    ]
    if (judgeProblems.length) {
      for (const p of judgeProblems) fail(p)
    } else {
      pass('五条结构判据全过：起点在扫描域里活着、在图上也咬得到东西、登记表有名有据（' + entries.length + ' 条）、没吃掉自己、没有互相吸收')
    }
  }
}

// 判据七（未解析的边，见上面「二之三」那一节）：未构建检出上的产物位放行，真断链判红；包名那一类与新规则对账。
// 为什么对账：新规则 room-imports-unresolved-package 的判据是文本（类型表 + pathNot），上游改类别名或
// pathNot 写松，它就会静默地一条都不报 —— 那时本判据会红，而不是安静地放行。
{
  const unresolvedEdges = collectUnresolvedRoomEdges(graphModules)
  const bareEdges = unresolvedEdges.filter((e) => !isPathSpecifier(e.specifier))
  const pathEdges = unresolvedEdges.filter((e) => isPathSpecifier(e.specifier))
  const judgedBare = violations.filter((v) => String((v.rule && v.rule.name) || '') === 'room-imports-unresolved-package').length
  if (bareEdges.length !== judgedBare) {
    fail(
      '判据七（对账）不符：图上未解析的包名边 ' + bareEdges.length + ' 条，规则 room-imports-unresolved-package 只报了 ' + judgedBare +
      ' 条 —— 这条规则的终点判据（dependencyTypes 与 pathNot）可能已经命不中这一类边了' +
      (bareEdges.length ? '；漏掉的例子：' + bareEdges.slice(0, 3).map((e) => e.file + " -> '" + e.specifier + "'").join('、') : ''),
    )
  } else {
    pass('判据七（对账）：图上未解析的包名边 ' + bareEdges.length + ' 条，与规则 room-imports-unresolved-package 报出的条数一致')
  }

  const triage = unresolvedPathEdgeProblems(pathEdges, (rel) => existsSync(join(ROOT, rel)))
  for (const p of triage.problems) fail(p)
  if (triage.explained.length) {
    info(
      '未解析的本仓路径 ' + triage.explained.length + ' 条：全是构建产物位（同名源码在盘上），没跑过构建的检出上本来就不在盘上，放行不判红；例：' +
      triage.explained.slice(0, 2).map((e) => e.file + " -> '" + e.specifier + "'").join('、'),
    )
  } else if (!pathEdges.length) {
    info('未解析的本仓路径 0 条（本检出上房间引的本仓路径都解析得到）')
  }
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

// 判据五（报分母）：房间纪律今天到底在判几个文件 —— 绿灯行必须报得出这个数。
// 没有分母时，「零违规」既可能是真的干净，也可能是规则一个人都没咬到（这次的假绿就是这样）。
const roomFilesOnDisk = files.filter((f) => f.rel.startsWith(ROOM_PATH_PREFIX)).length
if (!roomFilesOnDisk) {
  fail('盘上一个房间源码都没有：房间纪律的判域是空的（房间目录可能又搬家了）')
} else if (roomModuleCount < roomFilesOnDisk) {
  fail('房间源码只进了 ' + roomModuleCount + '/' + roomFilesOnDisk + ' 个图：没进图的房间文件不受任何规则管（#1136 把 src/tracker 写进根清单就是为这件事）')
} else {
  pass('判据五（报分母）：房间源码 ' + roomModuleCount + ' 个全部进图（盘上 ' + roomFilesOnDisk + ' 个）')
}

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
  ' + ' + (byRule.get('same-layer-import-seam') || 0) +
  ' + ' + (byRule.get('same-layer-import-tracker') || 0) + ' 条存量已记名，房间纪律与禁循环零违规；' +
  '房间模块 ' + roomModuleCount + '/' + roomFilesOnDisk + ' 个进图）')
