#!/usr/bin/env node
/**
 * verify-deck-event-gate.mjs — 门禁：订阅会话事件必须先过「工作区那道门」
 *
 * 为什么需要它（依据见 docs/architecture/refresh-budget-architecture.html 第十二章与第十五章）：
 *   1. 未打作用域标的普通 Cordis 监听器会收到**全部**会话的 session/event —— 别的会话、
 *      别的子代理、别的工作区都到我们手上（dsh-scope 的 scopeTarget 在 tag===undefined 时放行；
 *      session/event 的载体键是会话服务所在 ctx 的作用域，实测恒为 undefined）。
 *   2. 所以「能不能看见」不是我们能选的；「看见了以后做什么」才是唯一能守的地方。
 *   3. 会话对象上没有 workspaceRoot，只有 header.cwd（绝对路径）。归一到工作区根只能自己算。
 *
 * 这个脚本守三件事：
 *   A. 每一条 session/event 监听器都在登记表里（没登记的一律判红：新写法要显式过审）。
 *   B. 每条监听器在「消费事件数据之前」已经过了工作区门（门 = 看 session.header.cwd 或按会话 id 放行）。
 *   C. 事件对象不许整份进日志/落盘调用（只许进白名单字段）。
 *
 * 用法：
 *   node tests/verify-deck-event-gate.mjs                    # 扫整个仓库（默认扫描根 = 本脚本所在目录的上一级）
 *   node tests/verify-deck-event-gate.mjs --root <目录>       # 换一个扫描根（例如探针样本目录）
 *   node tests/verify-deck-event-gate.mjs --registry <文件>   # 追加一份登记表（JSON 数组，形状与下面的 REGISTRY 相同）
 *   node tests/verify-deck-event-gate.mjs --selfcheck --dsh <目录>
 *
 * 关于 --dsh：只有 --selfcheck 需要它，指向 DSH 安装目录里的 node_modules
 * （例如 "<DSH 安装目录>\resources\app\node_modules"），也可以改用环境变量 DSH_APP_NODE_MODULES。
 * 脚本里不写死任何本机路径；不给就明确报错并说清怎么传。
 *
 * 退出码：0 = 门禁通过；1 = 有违规（或参数给得不对）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
/** 默认扫描根是仓库根（本脚本在 tests/ 下，上一级就是仓库根），这样从哪个目录调用都一样。 */
const ROOT = path.resolve(argOf('--root', process.env.DECK_PLUGIN_ROOT || path.join(HERE, '..')))
const SELFCHECK = argv.includes('--selfcheck')
const DSH_APP = argOf('--dsh', process.env.DSH_APP_NODE_MODULES)

/**
 * 探针样本目录（相对扫描根）：里面放着故意写坏的样本，扫插件源码时一律跳过——
 * 否则「现状」那一跑会被自己的样本判红。要检查样本本身，用 --root 直接指到样本目录。
 */
const PROBE_DIR = 'tests/fixtures/deck-event-gate'

let failed = false
const check = (ok, msg, detail) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}

/**
 * 已登记的监听器表。**新增订阅必须在这里加一行**，并在 reason 里写清「为什么必须看别人的会话」
 * （写不出来，就说明这条订阅不该存在）。路径相对扫描根。
 *
 * 这里只许出现仓库里真实的订阅点。门禁自己的探针样本（tests/fixtures/deck-event-gate/ 下）
 * 一律经 --registry 传参，不许混进这张表。
 *
 * 形状：{ file: 'src/host/refresh/writeEvents.js', reason: '写事件源：只认自己工作区的写命令，用来触发刷新' }
 */
const REGISTRY = []
if (argOf('--registry')) {
  const regFile = path.resolve(argOf('--registry'))
  if (!fs.existsSync(regFile)) {
    console.log('登记表文件不存在：' + regFile)
    process.exit(1)
  }
  let rows
  try {
    rows = JSON.parse(fs.readFileSync(regFile, 'utf8'))
  } catch (e) {
    console.log('登记表文件读不出来（要求是 JSON 数组）：' + regFile + '\n  ' + String((e && e.message) || e))
    process.exit(1)
  }
  if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.file !== 'string')) {
    console.log('登记表文件的形状不对（要求是 { file, reason } 组成的 JSON 数组）：' + regFile)
    process.exit(1)
  }
  REGISTRY.push(...rows)
}

/** 一道门长什么样：在消费 event 之前出现工作区判定。两个可接受形状：
 *   ① 直接读 cwd 并比对：/header\.cwd|workspaceRoot|cwdOf|canonicalWorkspaceKey/
 *   ② 按会话 id 白名单放行：/allowedSession|isOurs|ours\.has\(/
 */
const GATE_RE = /header\.cwd|workspaceRoot|cwdOf|canonicalWorkspaceKey|allowedSession|isOurs|ours\.has\(/
/** 消费事件数据的形状：读 event.xxx。 */
const CONSUME_RE = /\b(event|ev|e)\.(data|type|name)/
/** 日志/落盘调用的形状（只认我们自己的日志出口与写盘出口）。 */
const SINK_RE = /\b(logCtx\.fire|log\.(fire|info|warn|error)|fireLog|writeTextFile|writeFile|writeText|persist|saveToDisk)\s*\(/
/** 允许把事件数据递给 sink 的白名单形状：取了具体字段或字面量。 */
const SAFE_ARG_RE = /['"][A-Za-z0-9_:.\-]{1,40}['"]|typeof |Boolean\(|Number\(|\?\s*true/

function pluginFiles(dir) {
  const out = []
  const skipped = []
  const probeAbs = path.resolve(ROOT, PROBE_DIR)
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) {
        if (path.resolve(p) === probeAbs) { skipped.push(path.relative(ROOT, p).replace(/\\/g, '/')); continue }
        walk(p)
      } else if (ent.name.endsWith('.js')) out.push(p)
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return { files: out, skipped }
}

/** 从 `ctx.on(` 位置起，截出注册调用与处理体（括号配对估算，宁可多算不可少算）。 */
function sliceRegistration(src, onIdx) {
  const after = src.slice(onIdx, onIdx + 400)
  if (!/['"]session\/event['"]/.test(after)) return null
  let end = src.indexOf('\n\n', onIdx)
  if (end < 0) end = src.length
  const brace = src.indexOf('{', onIdx)
  if (brace >= 0 && brace < end + 400) {
    let depth = 0
    for (let i = brace; i < Math.min(src.length, brace + 8000); i++) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) { end = Math.max(end, i + 1); break } }
    }
  }
  return { bodyText: src.slice(onIdx, end) }
}

console.log('== 门禁 A/B/C：会话事件订阅必须先过工作区门 ==')
console.log('插件根：' + ROOT)

const scanned = pluginFiles(ROOT)
const allFiles = scanned.files
for (const d of scanned.skipped) console.log('（跳过探针样本目录：' + d + '）')
const hits = []
for (const f of allFiles) {
  const src = fs.readFileSync(f, 'utf8')
  const patterns = [/ctx\.on\s*\(/g, /(?:harness|scopeCtx|baseCtx|sessionsCtx|events)\s*\.\s*on\s*\(/g]
  for (const re of patterns) {
    let m
    while ((m = re.exec(src))) {
      const s = sliceRegistration(src, m.index)
      if (!s) continue
      hits.push({
        file: path.relative(ROOT, f).replace(/\\/g, '/'),
        line: src.slice(0, m.index).split('\n').length,
        bodyText: s.bodyText,
      })
    }
  }
}

console.log(`扫描了 ${allFiles.length} 个插件源文件，找到 ${hits.length} 处 session/event 订阅`)
if (hits.length === 0) {
  console.log('  （当前插件还没有订阅会话事件——门禁此刻应当是绿的）')
}

for (const h of hits) {
  const tag = `${h.file}:${h.line}`
  const reg = REGISTRY.find((r) => path.normalize(r.file) === path.normalize(h.file))
  check(!!reg, `${tag} 已在登记表里（新增订阅要先登记并写明理由）`,
    reg ? '' : '在 REGISTRY 里加一行 { file, reason }；写不出「为什么必须看别人会话」的理由就别订阅')

  const gateAt = h.bodyText.search(GATE_RE)
  const consumeAt = h.bodyText.search(CONSUME_RE)
  if (consumeAt < 0) {
    check(true, `${tag} 没有消费事件数据（只做触发，不需要门）`)
  } else if (gateAt < 0) {
    check(false, `${tag} 在消费事件数据前没有工作区门`,
      '补一句 `const cwd = session && session.header && session.header.cwd; if (cwdHash(cwd) !== MINE) return`，且必须排在第一个 return/使用之前')
  } else {
    check(gateAt < consumeAt, `${tag} 工作区门排在消费事件数据之前`,
      `门在第 ${gateAt} 字符、消费在第 ${consumeAt} 字符——把门提到最前面`)
  }

  // C. 事件数据不许整份进 sink
  const sinkIdx = []
  const sinkRe = new RegExp(SINK_RE.source, 'g')
  let sm
  while ((sm = sinkRe.exec(h.bodyText))) sinkIdx.push(sm.index)
  if (sinkIdx.length === 0) {
    check(true, `${tag} 没有把事件数据交给日志/落盘出口`)
  } else {
    let bad = 0
    const details = []
    for (const i of sinkIdx) {
      const open = h.bodyText.indexOf('(', i)
      if (open < 0) continue
      let depth = 0
      let end = open
      for (let k = open; k < h.bodyText.length; k++) {
        const c = h.bodyText[k]
        if (c === '(') depth++
        else if (c === ')') { depth--; if (depth === 0) { end = k; break } }
      }
      const args = h.bodyText.slice(open + 1, end)
      // 先把字符串字面量挖空：否则 'deck.event.seen' 这种文案会被当成裸事件对象误判
      // （踩过一次：`.event.` 正好落在正则的 [^.\w$] 与 $ 之间，产生假命中）。
      const codeArgs = args.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, '``')
      const bareEvent = /(^|[^.\w$])(event|ev|e)\s*(?:[,)]|$)/.test(codeArgs)
      if (bareEvent && !SAFE_ARG_RE.test(codeArgs)) {
        bad++
        details.push(('...' + args).replace(/\s+/g, ' ').trim().slice(0, 120))
      }
    }
    check(bad === 0, `${tag} 事件对象没有整份进日志/落盘（只许进白名单字段）`, details.join(' | '))
  }
}

console.log('\n== 门禁说明 ==')
console.log('  这道门禁只做静态检查，有两处已知的保守：')
console.log('   · 处理体边界靠括号配对估算，函数体嵌套过深时可能多算（多算只会更容易判红，不会漏判）。')
console.log('   · 「门」只认已知写法（header.cwd / workspaceRoot / canonicalWorkspaceKey / 会话白名单）；')
console.log('     换一种等价写法会被判红——这是有意的：门的写法要少而固定。')

if (SELFCHECK) {
  console.log('\n== 运行期自检：作用域不隔离（证明「门只能自己守」） ==')
  if (!DSH_APP) {
    check(false, '自检：没有给出 DSH 安装目录里的 node_modules',
      '用 --dsh <目录> 指定，或设环境变量 DSH_APP_NODE_MODULES；' +
      '例：--dsh "<DSH 安装目录>\\resources\\app\\node_modules"。脚本里不写死本机路径。')
  } else if (!fs.existsSync(path.resolve(DSH_APP))) {
    check(false, '自检：--dsh 指向的目录不存在（要指向 DSH 安装目录里的 node_modules）',
      `实测目录 = ${path.resolve(DSH_APP)}`)
  } else {
    try {
      const req = createRequire(path.join(path.resolve(DSH_APP), 'package.json'))
      const load = (spec) => import(pathToFileURL(req.resolve(spec)).href)
      const { Context } = await load('@deepseek-ai/cordis')
      const { SessionStore } = await load('@deepseek-ai/dsh-session')
      const { createScope, scopeOf, scopeTarget, carrierKeyOf } = await load('@deepseek-ai/dsh-scope')
      const root = new Context()
      new SessionStore(root)
      createScope(root, 'scope-A')
      createScope(root, 'scope-B')
      const sA = root.sessions.create('selfcheck-A', { meta: { cwd: path.join(ROOT, '.') } })
      const sB = root.sessions.create('selfcheck-B', { meta: { cwd: path.parse(ROOT).root } })
      const seen = new Set()
      root.on('session/event', (session) => { seen.add(session.id) }, { global: true })
      sA.append('tool/call', { callId: 'a', name: 'bash', arguments: '{"command":"gh issue close 1"}' })
      sB.append('tool/call', { callId: 'b', name: 'bash', arguments: '{"command":"gh issue close 2"}' })
      check(seen.has('selfcheck-B'), '自检：本工作区之外的会话事件确实会到达未打标监听器（说明必须自己打门）',
        '若这条变红，说明平台行为变了，本门禁依据的实测结论要复核')
      const carrier = String(carrierKeyOf(scopeTarget(sA, scopeOf(root))))
      check(carrier === 'undefined', '自检：会话事件载体键不是某个工作区作用域（作用域标无法隔离）',
        `载体键实测 = ${carrier}`)
    } catch (e) {
      check(false, '自检：无法加载 DSH 包（用 --dsh 指定安装目录里的 node_modules）', String((e && e.message) || e))
    }
  }
}

if (failed) {
  console.log('\n存在失败 — 会话事件门禁未通过')
  process.exit(1)
}
console.log('\n全部通过 — 会话事件订阅都在工作区门后面')
