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
 * 这个脚本守四件事：
 *   A. 每一条 session/event 监听器都在登记表里（没登记的一律判红：新写法要显式过审）。
 *   B. 每条监听器在「消费事件数据之前」已经过了工作区门（门 = 看 session.header.cwd 或按会话 id 放行）。
 *   C. 事件对象不许整份进日志/落盘调用（只许进白名单字段）。
 *   D. （#710 新增的运行期用例）**别的工作区的事件到达之后**：真把一条别的会话的写命令喂给
 *      src/host/refresh/writeEvents.js，断言它被工作区白名单拦住、而且没有留下任何痕迹
 *      —— 不调闸、不记日志、不写内存表、不产生任何判定结果。同时用一条「自己工作区」的正向用例
 *      证明拦住不是因为整条路都不动，并证明取数只从闸里走（把闸摘掉时一次都不发）。
 *
 * 用法：
 *   node tests/verify-deck-event-gate.mjs                    # 扫整个仓库（默认扫描根 = 本脚本所在目录的上一级）
 *   node tests/verify-deck-event-gate.mjs --root <目录>       # 换一个扫描根（例如探针样本目录）
 *   node tests/verify-deck-event-gate.mjs --registry <文件>   # 追加一份登记表（JSON 数组，形状与下面的 REGISTRY 相同）
 *   node tests/verify-deck-event-gate.mjs --skip-runtime      # 跳过门禁 D（只为扫样本目录时用）
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

/**
 * 生成产物（相对扫描根）不进本门禁：`scripts/build.mjs` 是「一源出两物」，这几个路径都是它生成的副本
 * （见 .gitignore 的「T0 可变产物」一节，不入库）。src/ 下那份才是真身，扫源文件就够了；
 * 口径与 verify-file-granularity 的 DERIVED_DIRS 同款。不跳过的话，谁跑过一次构建，门禁就会拿
 * 同一份代码的副本再判一次「这条订阅没登记」，红得没有道理。
 */
const DERIVED_PATHS = ['package/lib', 'package/scripts', 'host.js', 'client.js']

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
 *
 * #710（T6）把两条真实订阅点预填在这里：
 *   ① 写事件源（本票的 src/host/refresh/writeEvents.js）：订 tools/result（首选）与会话事件（可回看），
 *      只认自己工作区的写命令，用来触发补行或探测。
 *   ② 处理链（票 #714 T10 的订阅点 src/host/refresh/sessionTickets.js）：同一个订阅面，记「这个会话正在
 *      处理哪几张票」。#710 落地时这一行先预填（T10 先落地了数据侧、订阅点还没接），接上之后它就会命中。
 */
const REGISTRY = [
  {
    file: 'src/host/refresh/writeEvents.js',
    reason: '写事件源（#710 T6）：订阅面是整个 DSH，别的会话、子代理、工作区的事件都会到我们手上，' +
      '所以第一件事就是按工作区根白名单放行；只有自己工作区里「成功的写操作」才触发补行或探测。',
  },
  {
    file: 'src/host/refresh/sessionTickets.js',
    reason: '处理链（票 #714 T10）：同一个订阅面，记「这个会话正在处理哪几张票」。只为写与明确的处理动作记，' +
      '读不进链；落盘只存票 key、时间与动作类别。（这一行由 #710 按票面要求预填；#714 的订阅点落地在这里。）',
  },
]
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
      const rel = path.relative(ROOT, p).replace(/\\/g, '/')
      if (DERIVED_PATHS.indexOf(rel) >= 0 || DERIVED_PATHS.some((pre) => rel === pre || rel.startsWith(pre + '/'))) {
        skipped.push(rel)
        continue
      }
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

// ==== 门禁 D：运行期用例——别的工作区的事件到达之后，被白名单拦住且没有留下任何痕迹 ====
if (!argv.includes('--skip-runtime')) {
  console.log('\n== 门禁 D：别的工作区的事件到达之后（运行期用例，票面 #710 验收） ==')
  const REPO = path.join(HERE, '..')
  const W = path.win32
  /** 与 workspaceKey.js 的规整口径同形（Windows 折小写、去尾分隔符）：只用来搭一份假的文件服务。 */
  const keyOf = (p) => {
    const n = W.normalize(String(p))
    return /^[a-z]:\\$/i.test(n) ? n.toLowerCase() : n.toLowerCase().replace(/[\\/]+$/, '')
  }
  // 两个工作区：d:\mine（我们服务它）与 d:\theirs（别的工作区）。各自带一枚 .git 标记，上溯才停得下来。
  const MARKERS = new Set([keyOf('D:\\mine\\.git'), keyOf('D:\\theirs\\.git')])
  const fsSvc = { lstat: async (abs) => { if (MARKERS.has(keyOf(abs))) return { isDirectory: () => true }; throw new Error('ENOENT') } }
  const platform = { os: 'win32', path: W }

  let clock = 1700000000000
  const gateCalls = []
  const fetched = []
  const logLines = []
  const gate = {
    send: async (req, perform) => {
      gateCalls.push({ source: req.source, kind: req.kind, steps: req.plan.length })
      for (const step of req.plan) await perform(step, { category: req.category, kind: req.kind })
      return { sent: true, verdict: 'allow', reason: 'background-fits', requests: 1, points: 0 }
    },
  }
  const logCtx = { isEnabled: (lv) => lv === 'debug', fire: (lv, event, fields) => { logLines.push({ level: lv, event: event, fields: (typeof fields === 'function') ? fields() : fields }) } }
  /** 只看「写事件」这一条我们自己的日志点（工作区根判定那条 workspaceRoot.resolve 是既有日志，不算它的）。 */
  const writeLines = () => logLines.filter((l) => l.event === 'write.event')
  const deps = {
    gate: gate, logCtx: logCtx, now: () => clock,
    fetch: async (step) => { fetched.push(step.action); return { requests: 1, points: 0 } },
  }

  try {
    // 工作区钥匙用宿主既有出口（src/host/workspaceKey.js 的 canonicalWorkspaceKey）真算一遍：
    // 生产里这支函数由接线处从 src/host/index.js 传进来，测试里我们自己接一支同样口径的。
    const wk = await import(pathToFileURL(path.join(REPO, 'src', 'host', 'workspaceKey.js')).href)
    deps.canonicalKey = (cwd) => wk.canonicalWorkspaceKey(cwd, { getPlatform: async () => platform, getFs: () => fsSvc, logCtx: logCtx })
    const { createWriteEvents } = await import(pathToFileURL(path.join(REPO, 'src', 'host', 'refresh', 'writeEvents.js')).href)
    const own = createWriteEvents(deps)
    check(String(await own.allowRoot('D:\\mine')).length > 0, '先把 d:\\mine 加进白名单（宿主接线时按当前服务的工作区调它）')

    // ---- 反例：别的工作区的会话里，一条成功的写命令到达 ----
    const logsBefore = writeLines().length
    const foreign = await own.onToolResult(
      { agent: { session: { id: 's-theirs', header: { cwd: 'D:\\theirs\\sub' } } }, name: 'pwsh', arguments: { command: 'gh issue close 7' } },
      { isError: false, value: { exitCode: 0 } }
    )
    check(foreign === null, '别的工作区的事件：一个字都不判（返回 null）')
    check(gateCalls.length === 0, '别的工作区的事件：没有调闸（闸调用次数 0）')
    check(writeLines().length === logsBefore, '别的工作区的事件：没有写日志（写事件日志行数没增加，实得 ' + writeLines().length + '）')
    check(fetched.length === 0, '别的工作区的事件：没有发生任何取数')
    const st = own.debugState()
    check(st.knownSessions === 0, '别的工作区的事件：没有在内存表里留下这个会话（白名单里只有我们自己的工作区）')
    check(st.windows === 0, '别的工作区的事件：没有开过任何合并窗口')
    check(!JSON.stringify(st).includes('theirs') && !JSON.stringify(logLines).includes('theirs'), '留下的东西里拼不出那个工作区的任何写法')

    // ---- 正面：自己工作区（含子目录会话，按根算同一个工作区）的写命令到达 ----
    const mine = await own.onToolResult(
      { agent: { session: { id: 's-mine', header: { cwd: 'D:\\mine\\packages\\sub' } } }, name: 'pwsh', arguments: { command: 'gh issue close 12' } },
      { isError: false, value: { exitCode: 0 } }
    )
    check(!!mine && mine.tier === 'write-confirmed' && mine.ticket === '12' && mine.action === 'patch-now',
      '自己工作区的写命令：判成确定写、票号 12、立刻补那一行（实得 ' + JSON.stringify(mine) + '）')
    check(gateCalls.length === 1 && gateCalls[0].source === 'event.write' && gateCalls[0].kind === 'patch',
      '取数一律过闸，且闸那一侧看得出这是事件触发的一档（实得 ' + JSON.stringify(gateCalls[0] || null) + '）')
    check(fetched.length === 1 && fetched[0] === 'patch-now', '真取数发生在闸里面（闸放行之后才调 fetch）')
    check(own.debugState().knownSessions === 1, '自己工作区的会话进了白名单表（子目录会话按工作区根算同一个）')
    check(writeLines().length === logsBefore + 1 && writeLines()[logsBefore].event === 'write.event', '事件触发那一档单独记了一行日志（write.event）')
    const LOG_FIELDS = ['keyHash', 'shape', 'tier', 'reason', 'action', 'hasTicket']
    check(writeLines().slice(logsBefore).every((l) => Object.keys(l.fields).every((k) => LOG_FIELDS.includes(k))),
      '日志只进白名单字段（实得 ' + JSON.stringify(writeLines().map((l) => Object.keys(l.fields))) + '）')
    check(!JSON.stringify(logLines).includes('gh issue close') && !JSON.stringify(logLines).includes('packages'),
      '日志里没有命令原文、也没有路径原文')
    const credited = own.stats().event
    check(credited.requests === 1 && credited.points === 0, '事件触发那一档的花费单列记着（实得 ' + JSON.stringify(credited) + '）')

    // ---- 同一工作区 10 秒合并窗口 ----
    clock += 1000
    const second = await own.onToolResult(
      { agent: { session: { id: 's-mine-2', header: { cwd: 'D:\\mine' } } }, name: 'pwsh', arguments: { command: 'gh issue close 13' } },
      { isError: false, value: { exitCode: 0 } }
    )
    check(!!second && second.coalesced === true && gateCalls.length === 1, '同一工作区 10 秒内第二次写：并进上一次（不再取数）')
    clock += 10001
    await own.onToolResult(
      { agent: { session: { id: 's-mine-2', header: { cwd: 'D:\\mine' } } }, name: 'pwsh', arguments: { command: 'gh issue close 14' } },
      { isError: false, value: { exitCode: 0 } }
    )
    check(gateCalls.length === 2, '过了 10 秒合并窗口之后才允许再取一次（实得闸调用 ' + gateCalls.length + ' 次）')

    // ---- 只认成功 + 调用刚开始不做任何事 ----
    const before = gateCalls.length
    await own.onToolResult({ agent: { session: { id: 's-mine', header: { cwd: 'D:\\mine' } } }, name: 'pwsh', arguments: { command: 'gh issue close 99' } }, { isError: false, value: { exitCode: 1 } })
    const callPhase = own.onSessionEvent({ id: 's-mine', header: { cwd: 'D:\\mine' } }, { type: 'tool/call', data: { name: 'pwsh', arguments: '{"command":"gh issue close 98"}' } })
    await callPhase
    check(gateCalls.length === before, '失败的命令与「调用刚开始」的形态：一次取数都不发')

    // ---- 会话事件那条补充订阅路：命令行是 JSON 串也能判 ----
    clock += 10001
    const viaSession = await own.onSessionEvent(
      { id: 's-mine', header: { cwd: 'D:\\mine' } },
      { type: 'tool/ptc-dispatch', data: { name: 'pwsh', arguments: '{"command":"gh issue comment 21 --body hi"}', isError: false, content: '[exit code: 0]' } }
    )
    check(!!viaSession && viaSession.tier === 'write-confirmed' && viaSession.ticket === '21', '会话事件那条路（ptc 内层派发的收尾）照样判得出票号 21')

    // ---- 没有闸时一次都不发（I1：写事件触发的取数必须过闸，没有第二条路） ----
    const noGateFetches = []
    const noGate = createWriteEvents(Object.assign({}, deps, { gate: null, fetch: async (step) => { noGateFetches.push(step.action); return { requests: 1, points: 0 } } }))
    await noGate.allowRoot('D:\\mine')
    const blocked = await noGate.onToolResult({ agent: { session: { id: 's-x', header: { cwd: 'D:\\mine' } } }, name: 'pwsh', arguments: { command: 'gh issue close 31' } }, { isError: false, value: { exitCode: 0 } })
    check(!!blocked && blocked.gated === false && noGateFetches.length === 0 && noGate.stats().noGate === 1,
      '把闸摘掉时：只判定、不取数（绝不绕过闸自己发请求）')

    // ---- 静态隐私断言：这个文件本身没有任何落盘出口，也没有把参数交给日志 ----
    const src = fs.readFileSync(path.join(REPO, 'src', 'host', 'refresh', 'writeEvents.js'), 'utf8')
    check(!/\b(writeFile|writeFileSync|writeText|writeTextFile|createWriteStream|appendFile|persist|saveToDisk)\s*\(/.test(src),
      '写事件订阅那条路本身没有落盘出口（参数不落盘）')
    check(!/fire\s*\([^)]*\bcommand\b/.test(src) && !/fire\s*\([^)]*\barguments\b/.test(src),
      '没有任何一处日志调用带上命令行或参数对象')
  } catch (e) {
    check(false, '门禁 D 运行期用例可执行', String((e && e.stack) || e))
  }
}

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

      // ==== 落地第一步要验的三件事（票面 #710 加固补充）。这是离线探针：跑的是真 DSH 包
      //（真 Context / 真 SessionStore / 真作用域），不是活宿主里的插件。三条各验一次：
      //   ① 我们这种插件注册的监听器收不收得到会话事件；
      //   ② { global: true } 写不写都能收到吗；
      //   ③ 子代理那条路的写操作可见吗（可见才更说明白名单是唯一能守的地方）。
      const seenGlobal = []
      const seenPlain = []
      const seenRuntime = []
      root.on('session/event', (session, event) => { seenGlobal.push(session.id + '/' + event.type) }, { global: true })
      root.on('session/event', (session, event) => { seenPlain.push(session.id + '/' + event.type) })
      root.on('tools/result', (exec) => { seenRuntime.push(String(exec && exec.name)) })
      // 子代理会话：DSH 里子代理是另一个会话，这里用「另一个会话、另一条 cwd」代表它。
      const sSub = root.sessions.create('selfcheck-sub', { meta: { cwd: ROOT } })
      sA.append('tool/call', { callId: 'c', name: 'pwsh', arguments: '{"command":"gh issue close 12"}' })
      sSub.append('tool/ptc-dispatch', { rootCallId: 'r', parentCallId: 'p', subCallId: 's', name: 'pwsh', arguments: '{"command":"gh issue close 9"}', isError: false, content: '[exit code: 0]' })
      const execProbe = { name: 'pwsh', arguments: { command: 'gh issue close 12' }, agent: { session: sA } }
      try { root.emit('tools/result', execProbe, { isError: false, value: { exitCode: 0 } }) } catch (eE) {}
      check(seenGlobal.length >= 2, '① 落地实测：插件注册的普通监听器收得到会话事件（收到 ' + seenGlobal.length + ' 条：' + seenGlobal.join('、') + '）')
      check(seenPlain.length === seenGlobal.length && seenPlain.length > 0,
        '② 落地实测：{ global: true } 不写也收得到（带选项 ' + seenGlobal.length + ' 条 / 不带选项 ' + seenPlain.length + ' 条）')
      check(seenGlobal.some((x) => x.startsWith('selfcheck-sub')), '③ 落地实测：子代理那条路的写操作同样可见（白名单是唯一能守的地方）')
      check(seenRuntime.length >= 1, '落地实测：运行时事件 tools/result 在同一套事件总线上收得到（收到 ' + seenRuntime.length + ' 条）')
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
