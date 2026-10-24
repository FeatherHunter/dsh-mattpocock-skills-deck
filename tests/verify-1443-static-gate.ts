// tests/verify-1443-static-gate.ts —— 门禁：旧路已删、A2 归位收口、gh 只剩一个传输持有者（#1443/#1445）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1443-static-gate.ts，可独立运行。
//
// 为什么要这一段：#1443 删掉 deck 壳旧选后端/过闸路径，额度同步改走 Tracker 会话读数；
// #1444/#1445 又把刷新后台的读写路径全部搬进会话。删了不等于不会长回来 —— 本门禁用文本扫描守住四条：
//   1. deck 壳的旧路标识一个不留；
//   2. 额度同步桥与刷新运行时不再直调 gh；
//   3. A2 未迁路径清单清零：全仓没有一处直接调 gh。仓库定位的 gh repo view 曾经是「唯一例外」（#1443 的
//      传输持有者名单），#1453 起它搬进会话的 getRepoKey 能力：会话建立之后才问、问的时候先过裁决再按
//      后端口径记账，所以宿主这一层只剩本地证据，例外表今天为空。真要再留一处，必须写清文件、理由与
//      出处文档（见 TRANSPORT_EXCEPTIONS）；下面的顺序断言核对的是仓库身份确实在会话建立之后才补。
//   4. 注册表选择只剩新路一处，deck / 刷新 / 宿主都不再深引房间实现。
const path = require('path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// A2 未迁路径清零（#1445 收口）：名单必须是空的 —— 归位之后没有「还没迁的调用方」。
// 这不是放宽也不是缩水：真有一个文件还在调用方直调 gh，下面「调用点清单」那一条会当场红。
const A2_UNMIGRATED = []
// 直接调 gh 的例外（#1453 起不再是「名单放行」）：真要留一处，必须写清是哪一处、为什么留、出处在哪份文档，
// 三条缺一条就判红 —— 例外必须能被人追溯，不能只靠一张名字表放过去。今天一条都没有：仓库定位的
// gh repo view 已经搬进会话能力（见 src/tracker/rooms/github/repo.ts 与 src/refresh/rooms/host/session-opener.ts）。
const TRANSPORT_EXCEPTIONS: Array<{ file: string; reason: string; doc: string }> = []
// 只算真正的调用点：名字后面紧跟 `(` 或 `?.(`，且前面不是 `function` 的声明写法。
// 这样 await / 赋值 / return / 箭头 之后的调用都认，`deps.runGh(` 这类成员调用也认；
// 声明（`function runGh(`）、对象字面量的键（`runGh: any`）与 `.apply` 转发不算调用。
// #1456 第 2 条：从前只认 await/赋值/return/箭头 后面那四种写法，`deps.runGh(` 这种裸调用漏了。
const RUNGH_CALL = /runGh\s*(?:\?\.)?\s*\(/g
function countRunGhCalls(code) {
  let n = 0
  RUNGH_CALL.lastIndex = 0
  let m
  while ((m = RUNGH_CALL.exec(code)) !== null) {
    // 往前看一小段：紧挨着 function 的就是声明，不算调用。
    const before = code.slice(Math.max(0, m.index - 40), m.index)
    if (/\bfunction\s*$/.test(before)) continue
    n += 1
  }
  return n
}
// 注册表选择的唯一合法调用点（新路自动识别，旧壳已删）：
const SELECT_SANCTIONED = ['src/deck/tools/tracker-session.ts']

function stripComments(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map(function (l) { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l }).join('\n')
}
function listTs(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push.apply(out, listTs(abs));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(abs)
  }
  return out
}
function relOf(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/') }
function runGhCallsOf(rel) {
  const code = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  return countRunGhCalls(code)
}

async function main() {
  console.log('旧路删除与 A2 收口门禁（#1443/#1445：删旧路、允许名单清零）')
  // —— A. deck 壳旧选后端/过闸路径已删 ——
  const shell = stripComments(fs.readFileSync(path.join(ROOT, 'src/deck/shell/call-shell.ts'), 'utf8'))
  check(shell.indexOf('registry.select') < 0, '旧选后端已删（call-shell 无 registry.select）')
  check(shell.indexOf('gate.send') < 0 && shell.indexOf('admitAiTool') < 0, '旧过闸已删（call-shell 无 gate.send/admitAiTool）')
  check(shell.indexOf('runGh') < 0, '旧直调已删（call-shell 无 runGh）')
  check(shell.indexOf('pickBackend') < 0 && shell.indexOf('mergeOutcome') < 0 && shell.indexOf('noteGate') < 0, '旧壳件已删（无 pickBackend/mergeOutcome/noteGate）')
  check(shell.indexOf('estimateFor') >= 0 && shell.indexOf('repoOf') >= 0 && shell.indexOf('unsupported') >= 0 && shell.indexOf('envelope') >= 0, '壳的合法件还在（estimateFor/repoOf/unsupported/envelope 给九个工具用）')
  // —— B. 额度同步桥旧直调已删 ——
  const bridge = stripComments(fs.readFileSync(path.join(ROOT, 'src/refresh/registry/quota-sync-bridge.ts'), 'utf8'))
  check(bridge.indexOf('runGh') < 0, '桥不再直调 gh（无 runGh 依赖）')
  check(bridge.indexOf('noteRateLimited') < 0, '桥不再降档通知（无 noteRateLimited，耗尽由裁决按分桶算）')
  check(bridge.indexOf('.send(') < 0 && bridge.indexOf('quota-read') < 0, '桥不再经闸打免费读数（无 send/quota-read，读数走会话管线）')
  check(bridge.indexOf('parseRateLimit') < 0, '桥里旧解析已搬走（两桶解析住房间 budget.ts）')
  check(bridge.indexOf('readBudget') >= 0 && bridge.indexOf('sync-cooldown') >= 0 && bridge.indexOf('sync-empty') >= 0, '桥的新路在（经 readBudget 读数，失败仍退避）')
  // —— C. A2 收口：全仓没有一处直调 gh；例外必须带理由、出处与顺序断言（#1453） ——
  const allTs = listTs(path.join(ROOT, 'src'))
  const callSites: Array<{ file: string; count: number }> = []
  for (const abs of allTs) {
    const rel = relOf(abs)
    const n = runGhCallsOf(rel)
    if (n > 0) callSites.push({ file: rel, count: n })
  }
  const siteFiles = callSites.map(function (s) { return s.file }).sort()
  const exceptionFiles = TRANSPORT_EXCEPTIONS.map(function (x) { return x.file }).sort()
  check(JSON.stringify(siteFiles) === JSON.stringify(exceptionFiles),
    '直调 gh 的调用点只剩例外表里写明的那些（实得：' + (siteFiles.length ? siteFiles.join('、') : '零处') + '）')
  // 例外表本身的门槛：文件在、理由够一句话、出处文档能打开；缺一项就红（不是靠名单放行）。
  let exceptionShapeOk = true
  for (const x of TRANSPORT_EXCEPTIONS) {
    if (!x.file || !fs.existsSync(path.join(ROOT, x.file))) exceptionShapeOk = false
    if (!x.reason || x.reason.length < 10) exceptionShapeOk = false
    if (!x.doc || !fs.existsSync(path.join(ROOT, x.doc))) exceptionShapeOk = false
  }
  check(exceptionShapeOk, '例外表每一项都写了文件、理由（至少一句）与存得上的出处文档（' + TRANSPORT_EXCEPTIONS.length + ' 条）')
  check(A2_UNMIGRATED.length === 0, 'A2 未迁路径清单已清零（归位之后不该再有名字）')

  // #1453：宿主这一层只读本地证据（git remote、.git/config），gh 那一级已经删掉。
  const hostGit = stripComments(fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/git-execution.ts'), 'utf8'))
  check(hostGit.indexOf("'repo', 'view'") < 0 && hostGit.indexOf('gh repo view') < 0,
    '宿主的仓库定位只剩本地证据（git-execution 不再跑 gh repo view）')

  // 顺序断言：先开会话，之后才补仓库身份；补的时候问会话能力，不问宿主那一份。
  const opener = stripComments(fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/session-opener.ts'), 'utf8'))
  const openAt = opener.indexOf('await openTracker(')
  const refAt = opener.indexOf('await resolveRepoRef(')
  check(openAt >= 0 && refAt > openAt, '仓库身份在会话建立之后才补（openTracker 先于 resolveRepoRef）')
  check(opener.indexOf('(session as any).getRepoKey') >= 0,
    '补仓库身份问的是会话的 getRepoKey 能力（走操作管线：先裁决、再按后端口径记账）')
  check(opener.indexOf('deps.getRepoKey') < 0, '不再退回宿主那一份 getRepoKey（那份只读本地证据，起 gh 的那一级已删）')
  // 那一级要真的住在房间里：能力和实现分家时，这条会先红，提醒把调用点搬回去。
  const roomRepo = stripComments(fs.readFileSync(path.join(ROOT, 'src/tracker/rooms/github/repo.ts'), 'utf8'))
  check(roomRepo.indexOf('getRepoKey') >= 0 && roomRepo.indexOf("'repo', 'view'") >= 0,
    'gh repo view 这一级住在 GitHub 房间的 getRepoKey 里（会话能力，出站前过闸）')
  const runtime = stripComments(fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/refresh-runtime.ts'), 'utf8'))
  const quotaSeg = runtime.split('function quotaSyncOf')[1].split('function ensureDeckReading')[0]
  check(quotaSeg.indexOf('readBudget') >= 0 && quotaSeg.indexOf('runGh') < 0, '额度同步接线已改道（quotaSyncOf 经 readBudget，不再递 runGh）')
  // #1445：行级增量取数已由会话承担，旧判据「deps 里还有 runGh」改成「deps 里还有 openSession」。
  const deltaSeg = runtime.split('function deltaRefresh')[1] || ''
  check(deltaSeg.indexOf('openSession') >= 0 && deltaSeg.indexOf('runGh') < 0, '行级增量接线已改走会话（deltaRefresh 依赖 openSession，不再看 runGh）')
  // —— D. 注册表选择只剩新路 ——
  const deckFiles = listTs(path.join(ROOT, 'src/deck'))
  const selectors = deckFiles.filter(function (f) { return stripComments(fs.readFileSync(f, 'utf8')).indexOf('registry.select') >= 0 }).map(relOf).sort()
  check(JSON.stringify(selectors) === JSON.stringify(SELECT_SANCTIONED), '调注册表选择的只剩新路自动识别（' + selectors.join('、') + '）')
  // 宿主与刷新机制里不许再自己调注册表选择：选后端只有一个入口（openTracker）。
  const outer = listTs(path.join(ROOT, 'src/host')).concat(listTs(path.join(ROOT, 'src/refresh')))
  // 只看真正的调用（registry.select( ），不算「typeof registry.select」这类装配自检 —— 装配点要确认注册表带没带这一口。
  const outerSelectors = outer.filter(function (f) { return /registry\.select\s*\(/.test(stripComments(fs.readFileSync(f, 'utf8'))) }).map(relOf)
  check(outerSelectors.length === 0, '宿主与刷新机制不自己调注册表选择（选后端只经 openTracker）' + (outerSelectors.length ? '（违规：' + outerSelectors.join('、') + '）' : ''))
  // —— E. deck / 刷新机制 / 宿主发布都不深引房间 ——
  const scanned = listTs(path.join(ROOT, 'src/deck')).concat(listTs(path.join(ROOT, 'src/refresh'))).concat(listTs(path.join(ROOT, 'src/host')))
  const deep = scanned.filter(function (f) { return stripComments(fs.readFileSync(f, 'utf8')).split('\n').filter(function (l) { return /from\s+['"][^'"]*tracker\/rooms/.test(l) }).length > 0 }).map(relOf)
  check(deep.length === 0, 'deck / 刷新机制 / 宿主没有值引用房间实现（只许装配点引）' + (deep.length ? '（违规：' + deep.join('、') + '）' : ''))
  // —— F. 正则自检：把认识的调用写法与「不是调用」的写法钉住（#1456 第 2 条） ——
  // 为什么样例要进这条门禁：这条正则漏过一次（只认 await/赋值/return/箭头 后面的 runGh(，
  // 认不出 deps.runGh( 这类裸调用）。样例就是「下次改正则时先看这里红不红」的那份清单。
  const CALL_SAMPLES = [
    ['await runGh(a)', 1, 'await 之后'],
    ['const r = runGh(a)', 1, '赋值之后'],
    ['return runGh(a)', 1, 'return 之后'],
    ['f = () => runGh(a)', 1, '箭头函数体'],
    ['deps.runGh(a)', 1, '成员调用（裸调用，从前漏掉的写法）'],
    ['if (runGh(a)) {}', 1, '语句里的裸调用'],
    ['await deps.runGh?.(a)', 1, '可选链调用'],
  ]
  const NOT_CALL_SAMPLES = [
    ['function runGh(a) { return a }', '函数声明'],
    ['function  runGh (a) { return a }', '函数声明（多空格）'],
    ['h.runGh.apply(null, a)', '.apply 转发'],
    ['const d = { runGh: any }', '对象字面量的键'],
    ['const name = "runGh"', '字符串里的名字'],
  ]
  for (const s of CALL_SAMPLES) {
    const got = countRunGhCalls(stripComments(s[0]))
    check(got === s[1], '自检：' + s[2] + '算调用（应得 ' + s[1] + '）→ 实得 ' + got)
  }
  for (const s of NOT_CALL_SAMPLES) {
    const got = countRunGhCalls(stripComments(s[0]))
    check(got === 0, '自检：' + s[1] + '不算调用（应得 0）→ 实得 ' + got)
  }
  console.log(failed ? ('\n' + total + ' 条断言，失败') : ('\n' + total + ' 条断言，全部通过')); process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) })
