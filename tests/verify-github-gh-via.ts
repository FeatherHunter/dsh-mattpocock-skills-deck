import { createOutboundControl } from '../src/host/platform/outbound-control.ts'
// tests/verify-github-gh-via.ts —— #1052 专属门禁：GitHub 房读路径每一次起 gh 进程都带上「这一次是谁发的、走到哪一支」的短标签
//
// 门禁归属: src/tracker/rooms/github/
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-github-gh-via.ts
//
// 为什么要有这一页：一趟读操作会落好几行常驻 gh.exec，字段长得一模一样（argv0 都是 gh、
// kind 都是 ok、exitCode 都是 0）。#1052 实测跑一遍读路径（探测、拉列表、取一张票、计数、
// 翻页、子票拉全、仓库权限，全部成功）落 13 行，13 行分不出哪一行属于哪条操作、走的是主路
// 还是降级路。于是常驻 gh.exec 增补一格 via：调用点在 opts.via 里写死一个短标签。
//
// 这一页钉住三件事：
//   一、管子通着：client.ts 把 opts.via 一路带到 gh.exec 的发射处（字段名就叫 via）。
//   二、读路径每个调用点都带标签，而且标签在登记册里。
//   三、登记册里不许有没人用的标签 —— 标签写错字、调用点被删掉、名字改了却忘了改登记册，
//       这三种都会让「按标签定位」当场失效，三种都在这里判红。
//
// 它不判写路径与关系边那两片（#1053、#1054）：那里 via 是可选的，谁动到谁补，口径与附录一致。

import { readFileSync } from 'node:fs'
import { ghClient } from '../src/tracker/rooms/github/client.ts'

const HERE = 'tests/verify-github-gh-via.ts'
const CLIENT = 'src/tracker/rooms/github/client.ts'

/** 读路径这一片的调用点：每一条都由 #1052 逐个贴过标签。 */
const READ_CALL_FILES = [
  'src/tracker/rooms/github/issues.ts',
  'src/tracker/rooms/github/counts.ts',
  'src/tracker/rooms/github/page.ts',
  'src/tracker/rooms/github/preflight.ts',
  'src/tracker/rooms/github/sub-issues.ts',
  'src/tracker/rooms/github/repo-permissions.ts',
  'src/tracker/rooms/github/repo.ts',
  // pulls.ts 是 #1052 合成回包实跑时抓出来的漏网：拉列表走 REST 降级那一支会顺带起两笔
  // /pulls 富化（列表翻页 + 单票补合并时间/评审），当时它们不带标签，日志里落的是空 via。
  'src/tracker/rooms/github/pulls.ts',
]

/**
 * 标签登记册：操作名 → { 允许的支、确实不需要标签的调用点、为什么不需要 }。
 * 前三个字段是硬判据；第四个字段只给人读，写清「为什么这几处不需要」，免得后来的人以为漏了。
 */
const TAG_SPEC: Record<string, { branches: string[]; opsWithNoNeed?: number; whyNoNeed?: string }> = {
  preflight: {
    branches: ['auth', 'repo-view', 'api'],
    whyNoNeed: '第一项门禁失败时连进程都不起（没有仓库标识可探），所以失败那一路日志里没有它自己的行；第三项门禁（能连上接口）这一笔 via 写 preflight.api，于是「走到第三项、这一项过没过」在日志里直接读得出来。',
  },
  list: { branches: ['gql', 'rest', 'pr'] },
  get: { branches: ['gql', 'rest', 'rest-pr', 'pr'] },
  counts: { branches: ['gql'] },
  listPage: { branches: ['gql'] },
  subIssues: { branches: ['gql', 'retry'] },
  permissions: { branches: ['api'] },
  repo: { branches: ['tier3'] },
  // 拉取请求富化那三笔（#1052 合成回包实跑时补上）：列表 REST 翻页、单票补合并时间、单票拉评审明细。
  pulls: { branches: ['rest', 'detail', 'reviews'] },
  describe: { branches: [] },
  issueAddress: { branches: [] },
  // 定位口 getRepoKey 走的是别的帮手，不在这一页的解析范围里（它不调 execGh）。
}

let failures = 0
let count = 0
function check(ok: boolean, label: string): void {
  count++
  if (ok) { console.log('  PASS ' + label); return }
  failures++
  console.log('  FAIL ' + label)
}

function readSelf(rel: string): string {
  return readFileSync(rel, 'utf8')
}

/**
 * 取调用括号里那个选项对象的正文。四条实测出来的坑，都在这几行里躲开：
 *   一、**第一个左花括号未必是选项对象**：`execGh(['api', `repos/${owner}/…`], { … })` 里
 *      模板串的 `${` 就是这一行第一个左花括号。第一版直接找第一个 `{`，读到的是 `{owner}` ——
 *      #1052 第一次跑这一页时，list.rest、get.rest、get.rest-pr、preflight.api 四个标签就是这样假红掉的。
 *   二、模板串的 `${}` 里是真代码，可能有自己的花括号，不能当成「引号里的一串字符」读到下一个反引号了事。
 *   三、选项对象里可能有注释，注释里的花括号同样算不得数；四、普通字符串里的花括号也不作数。
 * 所以这里扫参数表：普通字符串、模板串、注释整体跳过，方括号与圆括号成对跳过，**第一个出现在
 * 参数表这一层的左花括号**才是选项对象。
 */
function skipTemplate(src: string, i: number): number {
  i++ // 吃掉落笔的反引号
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '`') return i + 1
    if (ch === '$' && src[i + 1] === '{') {
      i += 2
      let depth = 1
      while (i < src.length && depth > 0) {
        const c = src[i]
        if (c === '\\') { i += 2; continue }
        if (c === '{') { depth++; i++; continue }
        if (c === '}') { depth--; i++; continue }
        if (c === '`') { i = skipTemplate(src, i); continue }
        if (c === "'" || c === '"') { i = skipQuoted(src, i); continue }
        i++
      }
      continue
    }
    i++
  }
  return i
}

/** 跳过一段用引号（' 或 "）包起来的普通字符串，返回收尾引号之后的位置。 */
function skipQuoted(src: string, i: number): number {
  const q = src[i]
  i++
  while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ }
  return i + 1
}

/** 从 at 开始找「参数表这一层」的第一个左花括号，返回它的位置；找不到回 -1。 */
function atBraceStart(src: string, at: number): number {
  let i = at
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '/' && next === '/') { const nl = src.indexOf('\n', i); if (nl < 0) return -1; i = nl + 1; continue }
    if (ch === '/' && next === '*') { const end = src.indexOf('*/', i + 2); if (end < 0) return -1; i = end + 2; continue }
    if (ch === '`') { i = skipTemplate(src, i); continue }
    if (ch === "'" || ch === '"') { i = skipQuoted(src, i); continue }
    if (ch === '{') return i
    if (ch === '[' || ch === '(') {
      let depth = 1
      i++
      while (i < src.length && depth > 0) {
        const c = src[i]
        if (c === '`') { i = skipTemplate(src, i); continue }
        if (c === "'" || c === '"') { i = skipQuoted(src, i); continue }
        if (c === '[' || c === '(') { depth++; i++; continue }
        if (c === ']' || c === ')') { depth--; i++; continue }
        i++
      }
      continue
    }
    if (ch === ')' || ch === ';' || ch === '\n') return -1
    i++
  }
  return -1
}

/** 从选项对象那个左花括号开始，读到与它配对的右花括号，返回整段正文。 */
function optsBody(src: string, at: number): string | null {
  const open = atBraceStart(src, at)
  if (open < 0) return null
  let i = open + 1
  let depth = 1
  while (i < src.length && depth > 0) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '/' && next === '/') { const nl = src.indexOf('\n', i); if (nl < 0) return null; i = nl + 1; continue }
    if (ch === '/' && next === '*') { const end = src.indexOf('*/', i + 2); if (end < 0) return null; i = end + 2; continue }
    if (ch === '`') { i = skipTemplate(src, i); continue }
    if (ch === "'" || ch === '"') {
      i++
      while (i < src.length && src[i] !== ch) { if (src[i] === '\\') i++; i++ }
      i++
      continue
    }
    if (ch === '{') { depth++; i++; continue }
    if (ch === '}') { depth--; i++; continue }
    i++
  }
  return depth === 0 ? src.slice(open, i) : null
}

/** 从源码里抠出 execGh 调用点：调用括号里第一个选项对象里的 via 值。 */
function tagOf(src: string, at: number): string | null {
  const body = optsBody(src, at)
  if (body === null) return null
  const m = /(?:^|[{,\s])via\s*:\s*'([^']*)'/.exec(body)
  return m ? m[1] : null
}

/** 数一个文件里的 execGh 调用点，逐条回「标签值（null 表示没带）」。 */
function callSites(rel: string): { line: number; tag: string | null }[] {
  const src = readSelf(rel)
  const out: { line: number; tag: string | null }[] = []
  const re = /\bexecGh\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const upto = src.slice(0, m.index)
    out.push({ line: upto.split('\n').length, tag: tagOf(src, m.index + m[0].length) })
  }
  return out
}

console.log('== 一、管子通着：opts.via 一路到 gh.exec ==')
const client = readSelf(CLIENT)
check(/via\?:\s*string/.test(client), 'client.ts 的 GhExecOpts 里有 via 这一格')
check(/emitGhExec\([^)]*via\?:\s*string/.test(client), 'emitGhExec 收得下 via 这个参数')
check(/roomLogEvent\(ctx,\s*'info',\s*'gh\.exec',\s*\{[^}]*via:\s*String\(via \|\| ''\)/s.test(client), "gh.exec 那一行里写进了 via 字段（没给标签的调用点落空串）")
const emitCalls = /\bemitGhExec\s*\(/g
let em: RegExpExecArray | null
let emitTotal = 0
let emitWithVia = 0
while ((em = emitCalls.exec(client)) !== null) {
  // 定义那一处（带类型标注）不算调用点：它后面紧跟的是 `): void {`
  const tail = client.slice(em.index + em[0].length, em.index + em[0].length + 400)
  if (/^[^)]*\)\s*:\s*void\s*\{/.test(tail)) continue
  emitTotal++
  if (/opts\.via|,\s*via\)/.test(tail.slice(0, tail.indexOf('\n')))) emitWithVia++
}
check(emitTotal >= 8, 'client.ts 里向外发射的 emitGhExec 调用点都数到了（实得 ' + emitTotal + ' 处）')
check(emitTotal === emitWithVia, '每一处发射都把 via 带上了（' + emitWithVia + '/' + emitTotal + '）')

console.log('== 二、读路径每个调用点都带标签，且标签在登记册里 ==')
const allowed = new Set<string>()
for (const [op, spec] of Object.entries(TAG_SPEC)) for (const b of spec.branches) allowed.add(op + '.' + b)

const used = new Map<string, string>()
let siteTotal = 0
for (const rel of READ_CALL_FILES) {
  const sites = callSites(rel)
  check(sites.length > 0, rel + ' 里至少有一个 execGh 调用点（实得 ' + sites.length + ' 处）')
  for (const s of sites) {
    siteTotal++
    if (s.tag === null) { check(false, rel + ':' + s.line + ' 的调用点没带 via 标签'); continue }
    check(allowed.has(s.tag), rel + ':' + s.line + ' 的标签 ' + s.tag + ' 在登记册里')
    used.set(s.tag, rel + ':' + s.line)
  }
}
const needMin = Object.values(TAG_SPEC).reduce((n, s) => n + s.branches.length, 0)
check(siteTotal >= needMin, '读路径调用点数不少于登记册里的支数（实得 ' + siteTotal + '，登记 ' + needMin + '）')

console.log('== 三、登记册里不许有没人用的标签 ==')
for (const [op, spec] of Object.entries(TAG_SPEC)) {
  const sites = READ_CALL_FILES.reduce((n, rel) => n + callSites(rel).filter((s) => String(s.tag || '').startsWith(op + '.')).length, 0)
  check(sites >= spec.branches.length, '操作 ' + op + '：调用点 ' + sites + ' 处，登记 ' + spec.branches.length + ' 支（少了说明有登记没人用）')
  if (spec.opsWithNoNeed) check(typeof spec.whyNoNeed === 'string' && spec.whyNoNeed.length > 20, '操作 ' + op + ' 记了 ' + spec.opsWithNoNeed + ' 处不需要标签的调用点，并写清了为什么')
}
for (const tag of allowed) check(used.has(tag), '登记册里的标签 ' + tag + ' 真有调用点在用')

console.log('== 四、标签本身的形状 ==')
const pattern = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z0-9-]*$/
for (const tag of allowed) check(pattern.test(tag), '标签 ' + tag + ' 长成「操作名.支名」的短枚举')
check(!allowed.has(''), '登记册里没有空标签')
check(new Set([...allowed]).size === allowed.size, '登记册里没有重复标签')

console.log('== 五、判据自己先演一遍（反面证明 #3） ==')
// 这五条是判据的自演：判据若只回 true，上面那些 PASS 就全是假绿。
// 注意起点与真调用点一致 —— callSites 传进来的是「吃掉了 execGh( 之后」的位置，所以这里也传
// 那个长度；第一版传了 0，扫描器从 execGh 这个词本身开始扫，先把 ( 当成进入参数表，于是
// 三个自演全假红（#1052 实测踩过）。
const CALL_AT = 'execGh('.length
check(pattern.test('list.gql') && !pattern.test('List.Gql') && !pattern.test('list') && !pattern.test('list.gql.extra') && !pattern.test('list.1'),
  '形状断言认得对的样子、也拦得住大写、缺支名、多一段、数字这四种写错')
check(tagOf('execGh(args, { cwd: cwd })', CALL_AT) === null, '解析器把没带标签的调用点判成 null（不是悄悄算过）')
check(tagOf("execGh(args, { cwd: cwd, via: 'list.gql' })", CALL_AT) === 'list.gql', '解析器从调用括号里读得出标签')
// 这一条里的反引号用 \x60 写：直接写反引号会把外层模板串当场截断（第一次试过，语法就崩了），
// 而 \x60 到了串里就是真反引号，于是这一条演的是真实形状的模板串 + 真插值表达式。
const templated = `execGh(['api', \x60repos/\${o}/\${n}/issues?page=\${p}\x60], { cwd: ctx && ctx.cwd, via: 'list.rest' })`
check(tagOf(templated, CALL_AT) === 'list.rest',
  '解析器认得选项对象里带模板串的调用点（模板里的花括号不许把对象读断）')
check(tagOf("execGh(args, { cwd: cwd /* 说明（父边） */, via: 'get.gql' })", CALL_AT) === 'get.gql', '解析器认得选项对象里带注释的调用点')

console.log('== 六、真跑一段：标签确实落进了 gh.exec 那一行（不是只写在调用点上） ==')
// 为什么这一段必须有：上面五节读的是源码文本，只能证明「调用点写了标签」。
// 标签要真落进日志那一行，还得管子通、发射处认它。这一段用一个假执行器把这一笔跑完，
// 收下来的事件与真跑读路径时落盘的是同一条路（同一个 emitGhExec、同一份字段）。
const EVENT_LOG: Array<{ level: string; event: string; fields: Record<string, unknown> }> = []
const FAKE_CTX = {
  cwd: 'D:\\fake-workspace',
  // #1052 续：宿主起这一趟操作时生成的编号，房间原样记进 gh.exec；这一段断的就是它有没有真落进去。
  opId: 'testop-7',
  signal: new AbortController().signal,
  outbound: createOutboundControl(),
  platform: {
    resolveExecutable: () => 'gh',
    exec: async () => ({ stdout: '[]', stderr: '', code: 0 }),
  },
  logEvent: (level: string, event: string, fields: Record<string, unknown>) => { EVENT_LOG.push({ level, event, fields }) },
  isEnabled: (level: string) => level === 'info',
  memo: new Map(),
} as never

const CLIENT_FOR_RUN = ghClient(FAKE_CTX)
const runs = [
  { tag: 'counts.gql', args: ['api', 'graphql', '-f', 'query=query{}'], out: '{"data":{"repository":{"issues":{"totalCount":3}}}}' },
  { tag: 'list.rest', args: ['api', 'repos/o/n/issues?state=all&per_page=100&page=1'], out: '[]' },
]
let runOk = true
for (const r of runs) {
  EVENT_LOG.length = 0
  const res = await CLIENT_FOR_RUN.execGh(r.args, { cwd: 'D:\\fake-workspace', timeout: 2000, via: r.tag })
  const ghEvents = EVENT_LOG.filter((e) => e.event === 'gh.exec')
  if (!res.ok || ghEvents.length !== 1) { runOk = false; check(false, '用 via=' + r.tag + ' 跑一笔：应当成功且只落一行 gh.exec（实得 ok=' + res.ok + '、行数 ' + ghEvents.length + '）'); continue }
  const f = ghEvents[0].fields
  check(f.via === r.tag, '真跑一笔：gh.exec 的 via 就是 ' + r.tag + '（实得 ' + JSON.stringify(f.via) + '）')
  check(JSON.stringify(Object.keys(f).sort()) === JSON.stringify(['argv0', 'cwdHash', 'exitCode', 'kind', 'latencyMs', 'opId', 'via', 'waitedMs']),
    '真跑一笔：gh.exec 的字段恰好是登记的那八格（实得 ' + Object.keys(f).sort().join('、') + '）')
  check(f.exitCode === 0 && f.kind === 'ok', '真跑一笔：成功这一笔记的是退出码 0 与 kind=ok')
  // #1052 续：编号取自上下文（调用点给不了它），落进 gh.exec 之后才能与宿主那层 host.call 对上。
  check(f.opId === 'testop-7', '真跑一笔：gh.exec 记下了上下文里的操作编号（实得 ' + JSON.stringify(f.opId) + '）')
}
// 不给标签的调用点：照旧落一行，via 记空串（不是「这一格没写」，而是如实说没给）。
EVENT_LOG.length = 0
await CLIENT_FOR_RUN.execGh(['api', 'user'], { cwd: 'D:\\fake-workspace', timeout: 2000 })
const noTag = EVENT_LOG.filter((e) => e.event === 'gh.exec')
check(noTag.length === 1 && noTag[0].fields.via === '', '不给标签的调用点照样落一行，via 记空串（行为与从前一字不差）')
// 两笔不同的读落在同一份事件流里，靠 via 分得开 —— 这正是加这一格要解决的问题。
EVENT_LOG.length = 0
await CLIENT_FOR_RUN.execGh(['api', 'graphql', '-f', 'query=query{}'], { cwd: 'D:\\fake-workspace', timeout: 2000, via: 'counts.gql' })
await CLIENT_FOR_RUN.execGh(['api', 'repos/o/n/issues'], { cwd: 'D:\\fake-workspace', timeout: 2000, via: 'list.rest' })
const both = EVENT_LOG.filter((e) => e.event === 'gh.exec').map((e) => String(e.fields.via))
check(both.length === 2 && both[0] === 'counts.gql' && both[1] === 'list.rest',
  '两笔不同的读落在同一份事件流里，靠 via 分得出谁是谁（实得 ' + JSON.stringify(both) + '）')
check(runOk, '上面每一笔都真的跑完了（没跑完的笔数会在这里露出来）')

console.log('')
if (failures) {
  console.log('发现 ' + failures + ' 处问题（共 ' + count + ' 项断言）：读路径的 via 标签与登记册对不上，按上面的行号改。')
  process.exit(1)
}
console.log('全部通过 — 读路径 ' + siteTotal + ' 个调用点都带标签、都在登记册里、登记册没有空转（共 ' + count + ' 项断言）。')
