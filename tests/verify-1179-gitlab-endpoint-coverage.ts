/**
 * tests/verify-1179-gitlab-endpoint-coverage.ts —— GitLab 房发出去的请求与采样登记表对不对得上（#1179）
 *
 * 门禁归属: src/tracker/rooms/gitlab
 * 门禁归属: tests/tracker-contract/gitlab-endpoints.ts
 *
 * 这个门禁回答的问题：「生成脚本照 `tests/tracker-contract/gitlab-endpoints.ts` 去采样的那一套请求，
 * 与本房源码真的会发出去的请求，是不是同一套。」
 *
 * 为什么要有它：`gitlab-real` 固件的价值全在「它采的是本房真的会发的那些请求」这一句上。若两者会各自漂移，
 * 采回来的东西可以全绿而毫无意义 —— 源码新发一个请求，采样表不知道；采样表多写一条，源码里没有。
 * 两边都没有编译器管，只能在这里逐条对。
 *
 * 它怎么读源码（不去猜、也不靠人维护第二份清单）：
 *   一、把注释换成等长空格（字符串与模板串原样保留，索引与原文一一对应），这样注释里写 `glab api ...`
 *       不会被当成真调用；
 *   二、找两类调用点 —— `['api', 路径, ...]` 这种数组实参，与 `.api(路径, ...)` 这种函数调用；
 *   三、把路径那一段文本解析成形状：字符串字面量原样取；模板串里的 `${...}` 与拼串的变量段写成 `{}`；
 *       `queries.ts` 里那几个拼路径的函数（projectPath / issuesPath / issuePath / notesPath /
 *       linksPath / milestonesPath）照它们自己的定义展开；认不出来的表达式一律写 `{}`。
 *   四、路径若是本文件里某个小助手（例如 `apiGet` / `apiPut`）的参数，就顺着这个参数回到它的调用点，
 *       把调用点那一段实参接着解析 —— 助手只是把路径转手，形状要看到调用方才算数。
 *
 * 唯一不扫的文件是 `client.ts`：它是本房唯一的出网出口，里面那句 `['api', path]` 里的 `path` 是调用方
 * 递进来的参数，形状得看调用方才算数。别处再出现一条真调用都跑不掉。
 *
 * 用法：node --import ./scripts/ts-hook.mjs tests/verify-1179-gitlab-endpoint-coverage.ts
 *       加 `--print` 只打印抽出来的形状（改采样表时先看一眼），不做判定。
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { GITLAB_ENDPOINTS } from './tracker-contract/gitlab-endpoints.js'

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const ROOM_DIR = path.join(ROOT, 'src/tracker/rooms/gitlab')
/** 本房唯一的出网出口，见文件头「唯一不扫的文件」。 */
const TRANSPORT_FILE = 'client.ts'
/** 顺着参数回到调用点，最多追这么多层；追不动就停下并写 `{}`，不猜。 */
const MAX_DEPTH = 6
/** 一个调用点最多展开出这么多种形状；超了就说明这段代码的形状不该由这个门禁来数。 */
const MAX_HITS = 64

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// ─────────────────────────── 一、把源码切成「看得懂的片段」 ───────────────────────────

/**
 * 把注释换成等长空格。字符串与模板串原样留着（路径就住在里面），索引与原文一一对应。
 * 做法是逐个字符走：进到引号里就一路走到收尾引号，`\\` 当转义跳过；引号之外遇到 `//` 或 `/*` 才开始抹。
 * 这一层不解析模板串里的 `${...}`（把整段模板当成一个字符串跳过），够用：注释不会写在插值里。
 */
function stripComments(text: string): string {
  const out = text.split('')
  let i = 0
  let quote: string | null = null
  while (i < text.length) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        out[i] = ' '
        i++
      }
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n') out[i] = ' '
        i++
      }
      if (i < text.length) {
        out[i] = ' '
        out[i + 1] = ' '
        i += 2
      }
      continue
    }
    i++
  }
  return out.join('')
}

/** 从 `i`（某个引号字符）走到它收尾的引号之后一位。 */
function skipString(text: string, i: number): number {
  const quote = text[i]
  i++
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2
      continue
    }
    if (text[i] === quote) return i + 1
    i++
  }
  return i
}

/** 从某个左括号出发找配对的右括号，返回它的下标；找不到回 -1。引号里的括号不算数。 */
function matchBracket(text: string, openIndex: number): number {
  const closer: { [open: string]: string } = { '[': ']', '(': ')', '{': '}' }
  const stack: string[] = []
  let i = openIndex
  while (i < text.length) {
    const ch = text[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(text, i)
      continue
    }
    if (closer[ch]) {
      stack.push(closer[ch])
      i++
      continue
    }
    if (ch === ']' || ch === ')' || ch === '}') {
      if (stack.length && stack[stack.length - 1] === ch) {
        stack.pop()
        if (!stack.length) return i
      }
      i++
      continue
    }
    i++
  }
  return -1
}

/** 按顶层分隔符切一段实参/数组元素/拼串：引号、模板串与各种括号里的分隔符不算数。 */
function splitTopLevel(text: string, sep = ','): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(text, i)
      continue
    }
    if (ch === '[' || ch === '(' || ch === '{') depth++
    else if (ch === ']' || ch === ')' || ch === '}') depth--
    else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
    i++
  }
  parts.push(text.slice(start))
  return parts
}

/** 取一段字符串字面量里的内容（`'x'` → `x`）。整段必须是**一个**完整的字面量，否则回 null。 */
function literalOf(expr: string): string | null {
  const t = expr.trim()
  if (t.length < 2) return null
  const q = t[0]
  if (q !== "'" && q !== '"') return null
  const end = skipString(t, 0)
  if (end !== t.length) return null
  return t.slice(1, -1)
}

/** 一段表达式的结束位置（顶层分号、换行，或括号收口）。 */
function endOfExpression(text: string): number {
  let depth = 0
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(text, i)
      continue
    }
    if (ch === '[' || ch === '(' || ch === '{') depth++
    else if (ch === ']' || ch === ')' || ch === '}') {
      if (depth === 0) return i
      depth--
    } else if (depth === 0 && (ch === ';' || ch === '\n')) return i
    i++
  }
  return text.length
}

// ─────────────────────────── 二、函数作用域：常量与参数都得看对地方 ───────────────────────────

interface FuncRange {
  readonly name: string
  readonly params: string[]
  readonly start: number
  readonly end: number
}

/** 文件里所有具名函数的范围（`function f(...) {...}` 与 `const f = (...) => {...}` 两种写法）。 */
function functionRanges(text: string): FuncRange[] {
  const out: FuncRange[] = []
  const heads = [
    /(?:export\s+)?(?:async\s+)?function\s+([\w$]+)\s*\(/g,
    /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g,
  ]
  for (const re of heads) {
    for (const m of text.matchAll(re)) {
      const name = m[1]
      const openParen = text.indexOf('(', m.index + m[0].length - (m[0].endsWith('(') ? 1 : 0))
      const headOpen = m[0].lastIndexOf('(')
      const parenAt = headOpen >= 0 ? m.index + headOpen : openParen
      const closeParen = matchBracket(text, parenAt)
      if (closeParen < 0) continue
      const braceAt = text.indexOf('{', closeParen)
      if (braceAt < 0) continue
      const braceEnd = matchBracket(text, braceAt)
      if (braceEnd < 0) continue
      const params = splitTopLevel(text.slice(parenAt + 1, closeParen)).map(paramName).filter(Boolean)
      out.push({ name, params, start: braceAt, end: braceEnd })
    }
  }
  return out
}

/** 参数声明 → 参数名（去掉类型标注、默认值、`...`）。 */
function paramName(decl: string): string {
  const head = decl.split('=')[0].split(':')[0].trim().replace(/^\.\.\./, '')
  return /^[A-Za-z_$][\w$]*$/.test(head) ? head : ''
}

/** 某个下标落在哪个函数里（取最内层那个）。 */
function enclosingFunction(ranges: FuncRange[], index: number): FuncRange | null {
  let best: FuncRange | null = null
  for (const r of ranges) {
    if (index > r.start && index < r.end) {
      if (!best || r.start > best.start) best = r
    }
  }
  return best
}

// ─────────────────────────── 三、把一段路径表达式解析成形状 ───────────────────────────

/**
 * `queries.ts` 里那几个拼路径的函数，展开成形状。
 *
 * 为什么这一层由人写死：它们的函数体是模板串加条件式，机器读不出「有查询串 / 没有查询串」两种形态
 * （`${q ? '?' + q : ''}` 这种写法展开出来是个含糊的 `{}`）。写死在这里的代价由下面第五节补上：
 * 门禁会去 `queries.ts` 核对这些函数确实存在、参数个数也对得上。
 */
const BUILDERS: { [name: string]: { params: number; shape: (args: string[]) => string } } = {
  projectPath: { params: 1, shape: () => 'projects/{}' },
  issuesPath: { params: 2, shape: (a) => 'projects/{}/issues' + (hasQuery(a[1]) ? '?{}' : '') },
  issuePath: { params: 2, shape: () => 'projects/{}/issues/{}' },
  notesPath: { params: 2, shape: () => 'projects/{}/issues/{}/notes' },
  linksPath: { params: 2, shape: () => 'projects/{}/issues/{}/links' },
  milestonesPath: { params: 2, shape: (a) => 'projects/{}/milestones' + (hasQuery(a[1]) ? '?{}' : '') },
}

/** 那个查询串实参会不会真的接上去。空字符串字面量（或没传）就是没有查询串，其余一律按「有」算。 */
function hasQuery(arg: string | undefined): boolean {
  if (arg === undefined) return false
  const lit = literalOf(arg)
  if (lit !== null) return lit.length > 0
  return true
}

/** 一个调用点解析出来的一种形状，附一条人看的来路。 */
interface ShapeHit {
  readonly shape: string
  readonly via: string
}

/** 房间里的每份源码（去掉注释后的文本），供顺着参数回到调用点时跨文件找。 */
const ROOM_SOURCES: { file: string; text: string; raw: string; ranges: FuncRange[] }[] = []

/** 解析一段路径表达式，返回它可能是的几种形状。解析不了的位置写 `{}`（宁可写得粗，也不猜）。 */
function resolve(expr: string, text: string, scope: FuncRange | null, via: string, depth: number): ShapeHit[] {
  if (depth > MAX_DEPTH) return [{ shape: '{}', via }]
  const t = expr.trim()
  if (!t) return [{ shape: '{}', via }]

  // 字符串字面量：整段就是路径。
  const lit = literalOf(t)
  if (lit !== null) return [{ shape: lit, via }]

  // 模板串：字面部分原样取，`${...}` 里的东西各自解析。
  if (t[0] === '`' && t[t.length - 1] === '`') {
    const parts = splitTemplate(t)
    let acc: ShapeHit[] = [{ shape: '', via }]
    for (const part of parts) {
      const hits = part.expr === null ? [{ shape: part.text, via }] : resolveInterp(part.expr, text, scope, via, depth + 1)
      acc = combine(acc, hits)
      if (acc.length > MAX_HITS) return [{ shape: '{}', via }]
    }
    return acc
  }

  // 拼串：顶层 `+` 切开逐段拼。
  const sum = splitTopLevel(t, '+').map((s) => s.trim())
  if (sum.length > 1) {
    let acc: ShapeHit[] = [{ shape: '', via }]
    for (const part of sum) {
      acc = combine(acc, resolve(part, text, scope, via, depth + 1))
      if (acc.length > MAX_HITS) return [{ shape: '{}', via }]
    }
    return acc
  }

  // 函数调用：认得的拼路径函数就展开，认不得的整段算一个变量位置。
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(t)
  if (call) {
    const name = call[1]
    const open = t.indexOf('(', call.index)
    const close = matchBracket(t, open)
    const args = close > 0 ? splitTopLevel(t.slice(open + 1, close)) : []
    const builder = BUILDERS[name]
    if (builder) return [{ shape: builder.shape(args), via }]
    return [{ shape: '{}', via }]
  }

  // 裸标识符：先看是不是本函数里的一个常量；不是常量就按「它是某个函数的参数」顺着调用点找回去。
  if (/^[A-Za-z_$][\w$]*$/.test(t)) {
    const local = lookupConst(text, scope, t)
    if (local !== null) return resolve(local, text, scope, via, depth + 1)
    if (scope) {
      const index = scope.params.indexOf(t)
      if (index >= 0) {
        const hits: ShapeHit[] = []
        for (const site of callSitesOf(scope.name)) {
          const arg = site.args[index]
          if (arg === undefined) continue
          const from = site.file + ':' + site.line
          hits.push(...resolve(arg, site.text, site.scope, via ? via + ' → ' + from : from, depth + 1))
          if (hits.length > MAX_HITS) break
        }
        return hits.length ? hits.slice(0, MAX_HITS) : [{ shape: '{}', via }]
      }
    }
    return [{ shape: '{}', via }]
  }

  // 其余（成员访问、三元、String(...) 之类）一律按一个变量位置算。
  return [{ shape: '{}', via }]
}

/** 模板串插值里的表达式：认得的拼路径函数展开，别的算一个变量位置。 */
function resolveInterp(expr: string, text: string, scope: FuncRange | null, via: string, depth: number): ShapeHit[] {
  const t = expr.trim()
  const lit = literalOf(t)
  if (lit !== null) return [{ shape: lit, via }]
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(t)
  if (call && BUILDERS[call[1]]) {
    const open = t.indexOf('(', call.index)
    const close = matchBracket(t, open)
    const args = close > 0 ? splitTopLevel(t.slice(open + 1, close)) : []
    return [{ shape: BUILDERS[call[1]].shape(args), via }]
  }
  return [{ shape: '{}', via }]
}

/** 模板串切成「字面段」与「插值段」。 */
function splitTemplate(text: string): { text: string; expr: string | null }[] {
  const inner = text.slice(1, -1)
  const out: { text: string; expr: string | null }[] = []
  let buf = ''
  let i = 0
  while (i < inner.length) {
    if (inner[i] === '\\') {
      buf += inner[i + 1]
      i += 2
      continue
    }
    if (inner[i] === '$' && inner[i + 1] === '{') {
      const close = matchBracket(inner, i + 1)
      if (close < 0) break
      out.push({ text: buf, expr: null })
      out.push({ text: '', expr: inner.slice(i + 2, close) })
      buf = ''
      i = close + 1
      continue
    }
    buf += inner[i]
    i++
  }
  out.push({ text: buf, expr: null })
  return out
}

/** 两组形状交叉拼接。 */
function combine(a: ShapeHit[], b: ShapeHit[]): ShapeHit[] {
  const out: ShapeHit[] = []
  for (const x of a) for (const y of b) out.push({ shape: x.shape + y.shape, via: x.via })
  return out
}

/** 在本函数范围内找一个常量的初始化表达式；找不到回 null（不回退到全文件，那样会把同名常量认错）。 */
function lookupConst(text: string, scope: FuncRange | null, name: string): string | null {
  const from = scope ? scope.start : 0
  const to = scope ? scope.end : text.length
  const re = new RegExp('(?:const|let|var)\\s+' + name + '\\s*(?::[^=\\n]+)?=\\s*', 'g')
  let found: string | null = null
  // 在切片上 matchAll：正则在切片里的下标要加回 from 才是原文里的位置。
  for (const m of text.slice(from, to).matchAll(re)) {
    const at = from + m.index + m[0].length
    found = text.slice(at, at + endOfExpression(text.slice(at)))
  }
  return found
}

/** 某个函数的调用点（整个房间一起找，因为助手可能被别的文件用）。 */
function callSitesOf(name: string): { file: string; line: number; text: string; scope: FuncRange | null; args: string[] }[] {
  const out: { file: string; line: number; text: string; scope: FuncRange | null; args: string[] }[] = []
  for (const src of ROOM_SOURCES) {
    if (src.file === TRANSPORT_FILE) continue
    const re = new RegExp('(?<![\\w$.])' + name + '\\s*\\(', 'g')
    for (const m of src.text.matchAll(re)) {
      // 跳过函数自己的定义那一处（`function apiGet(...)`），那不是调用。
      if (/\bfunction\s*$/.test(src.text.slice(Math.max(0, m.index - 12), m.index))) continue
      const open = src.text.indexOf('(', m.index)
      const close = matchBracket(src.text, open)
      if (close < 0) continue
      out.push({
        file: src.file,
        line: src.raw.slice(0, m.index).split('\n').length,
        text: src.text,
        scope: enclosingFunction(src.ranges, m.index),
        args: splitTopLevel(src.text.slice(open + 1, close)),
      })
      if (out.length > 200) return out
    }
  }
  return out
}

// ─────────────────────────── 四、找出所有真调用点 ───────────────────────────

interface CallSite {
  readonly file: string
  readonly line: number
  readonly method: string
  readonly hits: ShapeHit[]
}

/** 找出房间里所有发 `api` 请求的调用点，并解析出各自可能的形状。 */
function collectCallSites(): CallSite[] {
  const sites: CallSite[] = []
  for (const src of ROOM_SOURCES) {
    if (src.file === TRANSPORT_FILE) continue
    const { text, raw, ranges } = src
    const lineOf = (index: number) => raw.slice(0, index).split('\n').length

    // 形状一：数组实参 ['api', 路径, '--method', 'PUT', ...]
    for (const m of text.matchAll(/'api'/g)) {
      const at = m.index
      const open = enclosingBracket(text, at)
      if (open < 0) continue
      const close = matchBracket(text, open)
      if (close < 0) continue
      const parts = splitTopLevel(text.slice(open + 1, close))
      if (literalOf(parts[0] || '') !== 'api') continue
      const scope = enclosingFunction(ranges, at)
      const where = src.file + ':' + lineOf(at)
      sites.push({
        file: src.file,
        line: lineOf(at),
        method: methodFromArgs(parts),
        hits: resolve(parts[1] || '', text, scope, where, 0),
      })
    }

    // 形状二：函数调用 api(路径, {...}) / ctx.api(路径, {...})
    for (const m of text.matchAll(/(?<!['\w$])api\s*\(/g)) {
      const at = m.index
      if (/function\s*$/.test(text.slice(Math.max(0, at - 12), at))) continue
      const open = text.indexOf('(', at)
      const close = matchBracket(text, open)
      if (close < 0) continue
      const args = splitTopLevel(text.slice(open + 1, close))
      const scope = enclosingFunction(ranges, at)
      const where = src.file + ':' + lineOf(at)
      sites.push({
        file: src.file,
        line: lineOf(at),
        method: methodFromOptions(args[1]),
        hits: resolve(args[0] || '', text, scope, where, 0),
      })
    }
  }
  return sites
}

/** 从 `'api'` 字面量往前找它所在的那个 `[`。数组字面量都很短，往回数到第一个没配对的左方括号即可。 */
function enclosingBracket(text: string, from: number): number {
  let depth = 0
  for (let i = from - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === ']') depth++
    else if (ch === '[') {
      if (depth === 0) return i
      depth--
    }
  }
  return -1
}

/** 数组实参里的方法：`'--method', 'PUT'` 那一对。 */
function methodFromArgs(parts: string[]): string {
  for (let i = 0; i < parts.length - 1; i++) {
    if (literalOf(parts[i] || '') === '--method') return (literalOf(parts[i + 1] || '') || 'GET').toUpperCase()
  }
  return 'GET'
}

/** 选项对象里的方法：`{ method: 'PUT' }`。 */
function methodFromOptions(opts: string | undefined): string {
  if (!opts) return 'GET'
  const m = /method\s*:\s*(['"])([A-Za-z]+)\1/.exec(opts)
  return m ? m[2].toUpperCase() : 'GET'
}

// ─────────────────────────── 五、逐条对 ───────────────────────────

for (const name of fs.readdirSync(ROOM_DIR).filter((f) => f.endsWith('.ts')).sort()) {
  const raw = fs.readFileSync(path.join(ROOM_DIR, name), 'utf8')
  const text = stripComments(raw)
  ROOM_SOURCES.push({ file: name, text, raw, ranges: functionRanges(text) })
}

const sites = collectCallSites()
/** 形状 → 出现它的那些调用点（写成人看的 `文件:行`）。 */
const siteKeys = new Map<string, string[]>()
for (const s of sites) {
  for (const h of s.hits) {
    const key = s.method + ' ' + h.shape
    const where = s.file + ':' + s.line + (h.via && !h.via.startsWith(s.file + ':') ? '（经 ' + h.via + '）' : '')
    const list = siteKeys.get(key)
    if (list) list.push(where)
    else siteKeys.set(key, [where])
  }
}
const listedKeys = new Map(GITLAB_ENDPOINTS.map((e) => [e.method + ' ' + e.shape, e.id]))

if (process.argv.includes('--print')) {
  console.log('从源码里抽出来的请求形状（' + sites.length + ' 处调用点，共 ' + siteKeys.size + ' 种）：')
  for (const [key, where] of [...siteKeys].sort()) console.log('  ' + key + '    ← ' + where.join('、'))
  console.log('\n登记表里的形状（' + GITLAB_ENDPOINTS.length + ' 条）：')
  for (const e of GITLAB_ENDPOINTS) console.log('  ' + e.method + ' ' + e.shape + '    (' + e.id + ')')
  process.exit(0)
}

console.log('—— 一、源码里发出去的每一条，登记表里都有 ——')
const missing = [...siteKeys.keys()].filter((k) => !listedKeys.has(k)).sort()
check(
  missing.length === 0,
  '源码里没有未登记的请求' + (missing.length ? '：' + missing.map((k) => k + '（' + (siteKeys.get(k) || []).join('、') + '）').join('；') : ''),
)

console.log('\n—— 二、登记表里的每一条，源码里都真的会发 ——')
const extra = [...listedKeys.keys()].filter((k) => !siteKeys.has(k)).sort()
check(
  extra.length === 0,
  '登记表里没有源码发不出去的请求' +
    (extra.length ? '：' + extra.map((k) => k + '（' + listedKeys.get(k) + '）').join('；') : ''),
)

console.log('\n—— 三、登记表自身写得规矩 ——')
const ids = GITLAB_ENDPOINTS.map((e) => e.id)
check(new Set(ids).size === ids.length, '每条登记的 id 不重复' + (new Set(ids).size === ids.length ? '' : '：' + ids.join('、')))
const badShape = GITLAB_ENDPOINTS.filter((e) => /\/\/|\s{2,}|\/$/.test(e.shape) || !e.shape.trim())
check(
  badShape.length === 0,
  '形状写法规范（变量位置写 {}、不留多余空格）' + (badShape.length ? '：' + badShape.map((e) => e.id).join('、') : ''),
)
const noRequest = GITLAB_ENDPOINTS.filter((e) => e.request === null && !(e.skipReason || '').trim())
check(
  noRequest.length === 0,
  '这次不采的端点都写清了为什么' + (noRequest.length ? '：' + noRequest.map((e) => e.id).join('、') : ''),
)
const noNote = GITLAB_ENDPOINTS.filter((e) => !e.note.trim())
check(noNote.length === 0, '每条登记都有一句人话说明' + (noNote.length ? '：' + noNote.map((e) => e.id).join('、') : ''))
const getWithFields = GITLAB_ENDPOINTS.filter((e) => e.method === 'GET' && (e.fields || []).length)
check(
  getWithFields.length === 0,
  '读请求不带表单参数' + (getWithFields.length ? '：' + getWithFields.map((e) => e.id).join('、') : ''),
)
const writeWithoutFields = GITLAB_ENDPOINTS.filter(
  (e) => e.method !== 'GET' && e.method !== 'DELETE' && e.request !== null && !(e.fields || []).length,
)
check(
  writeWithoutFields.length === 0,
  '写请求都写清了要带什么参数' + (writeWithoutFields.length ? '：' + writeWithoutFields.map((e) => e.id).join('、') : ''),
)
/**
 * 项目引用的两种写法不许换用（#1181 那次误判留下的教训）：
 * 拼进地址那一格要用编码过的 `{id}`，当表单参数的值要用原样的 `{ref}`。
 * 换用了，采回来的就是一条房里根本不会发的请求 —— 2026-10-15 那次就采回一份 404，
 * 还照着它给本房开了一张「挂父子关系写不上去」的错票。这条断言让人不再靠记忆守这件事。
 */
const swappedProjectRef = GITLAB_ENDPOINTS.filter((e) => {
  const request = e.request || ''
  // `{ref}` 是表单参数专用的原样写法，拼进地址那一格会被远端当成另一个仓库。
  if (/\{ref\}/.test(request)) return true
  // 表单参数的值不许直接写成 `{id}`（地址那一份编码值）：编码值不经过 URL 解码，远端认不出来。
  return (e.fields || []).some((f) => f.slice(f.indexOf('=') + 1) === '{id}')
})
check(
  swappedProjectRef.length === 0,
  '项目引用的两种写法没换用（地址那一格写 {id}、表单参数那一格写 {ref}）' +
    (swappedProjectRef.length ? '：' + swappedProjectRef.map((e) => e.id).join('、') : ''),
)

console.log('\n—— 四、登记表里的请求，形状与写法自洽 ——')
/** 两段查询串是不是同一组参数：键要逐位相同，值可以不同 —— 形状里写成 `{}` 的那一位本来就是变量。 */
function sameQuery(a: string, b: string): boolean {
  const pa = a.split('&')
  const pb = b.split('&')
  if (pa.length !== pb.length) return false
  for (let i = 0; i < pa.length; i++) {
    const ka = pa[i].split('=')[0]
    const kb = pb[i].split('=')[0]
    if (ka !== kb) return false
    const va = pa[i].slice(ka.length + 1)
    const vb = pb[i].slice(kb.length + 1)
    if (va === vb) continue
    if (/\{\}/.test(va)) continue
    return false
  }
  return true
}
const mismatched = GITLAB_ENDPOINTS.filter((e) => {
  if (!e.request) return false
  const bare = e.request.split('?')[0].replace(/\{[a-z_]+\}/g, '{}')
  if (bare !== e.shape.split('?')[0]) return true
  // 形状里的查询串是整段拼出来的（`?{}`）就不比对内容；否则按键逐位对（值可以是 `{}`）。
  const shapeQuery = e.shape.includes('?') ? e.shape.slice(e.shape.indexOf('?') + 1) : ''
  if (!shapeQuery || shapeQuery === '{}') return false
  const reqQuery = e.request.includes('?') ? e.request.slice(e.request.indexOf('?') + 1) : ''
  return !sameQuery(shapeQuery, reqQuery)
})
check(
  mismatched.length === 0,
  '每条登记的 request 与 shape 指的是同一个地址' +
    (mismatched.length ? '：' + mismatched.map((e) => e.id + '（' + e.shape + ' vs ' + e.request + '）').join('；') : ''),
)

console.log('\n—— 五、写死的拼路径函数与 queries.ts 对得上 ——')
const queries = fs.readFileSync(path.join(ROOM_DIR, 'queries.ts'), 'utf8')
for (const name of Object.keys(BUILDERS).sort()) {
  const decl = new RegExp('export\\s+function\\s+' + name + '\\s*\\(([^)]*)\\)').exec(queries)
  const want = BUILDERS[name].params
  const got = decl ? decl[1].split(',').filter((p) => p.trim()).length : -1
  check(
    decl !== null && got === want,
    'queries.ts 里的 ' + name + ' 存在且收 ' + want + ' 个参数' + (decl === null ? '（没找到这个函数）' : got === want ? '' : '（实际 ' + got + ' 个）'),
  )
}

console.log('\n—— 六、出网只有一个出口 ——')
const transport = fs.readFileSync(path.join(ROOM_DIR, TRANSPORT_FILE), 'utf8')
check(/'api'/.test(stripComments(transport)), TRANSPORT_FILE + ' 里就是那句把 api 子命令拼进 glab 实参的地方（本房唯一的出网出口）')

console.log(
  failed
    ? '\n存在失败 — 采样登记表与本房源码发出去的请求对不上'
    : '\n全部通过 — 采样登记表与本房源码发出去的请求逐条对齐（' + siteKeys.size + ' 种请求形状，' + sites.length + ' 处调用点）',
)
process.exit(failed ? 1 : 0)
