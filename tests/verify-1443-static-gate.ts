// tests/verify-1443-static-gate.ts —— 门禁：旧路已删、A2 归位收口、gh 只剩一个传输持有者（#1443/#1445）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1443-static-gate.ts，可独立运行。
//
// 为什么要这一段：#1443 删掉 deck 壳旧选后端/过闸路径，额度同步改走 Tracker 会话读数；
// #1444/#1445 又把刷新后台的读写路径全部搬进会话。删了不等于不会长回来 —— 本门禁用文本扫描守住四条：
//   1. deck 壳的旧路标识一个不留；
//   2. 额度同步桥与刷新运行时不再直调 gh；
//   3. A2 未迁路径清单清零：全仓只剩一个「传输持有者」直接调 gh（git-execution.ts 的 gh repo view），
//      它调用在选后端之前、迁进会话会形成循环依赖，所以保留并逐条钉住，不许第二处长出来；
//   4. 注册表选择只剩新路一处，deck / 刷新 / 宿主都不再深引房间实现。
const path = require('path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// A2 未迁路径清零（#1445 收口）：名单必须是空的 —— 归位之后没有「还没迁的调用方」。
// 这不是放宽也不是缩水：真有一个文件还在调用方直调 gh，下面「传输持有者」那一条会当场红。
const A2_UNMIGRATED = []
// 传输持有者：唯一允许直接起 gh 的文件（它调用发生在选后端之前，迁进会话会形成循环依赖；
// gh-execution.ts 只是这层执行的实现体，不含调用点，由「调用点清单」一并钉住）。
const TRANSPORT_HOLDERS = ['src/refresh/rooms/host/git-execution.ts']
// 只算真正的调用点（await/赋值/返回 之后紧跟 runGh(），不算接口声明、传参与注释里的名字。
const RUNGH_CALL = /(?:await\s+|=\s*|return\s+|=>\s*)runGh\(/g
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
  return (code.match(RUNGH_CALL) || []).length
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
  // —— C. A2 收口：允许名单清零，全仓只剩一个传输持有者 ——
  const allTs = listTs(path.join(ROOT, 'src'))
  const callSites = []
  for (const abs of allTs) {
    const rel = relOf(abs)
    const n = runGhCallsOf(rel)
    if (n > 0) callSites.push({ file: rel, count: n })
  }
  const siteFiles = callSites.map(function (s) { return s.file }).sort()
  check(JSON.stringify(siteFiles) === JSON.stringify(TRANSPORT_HOLDERS.slice().sort()),
    '直接调 gh 的只剩传输持有者这一个文件' + (siteFiles.length ? '（实得：' + siteFiles.join('、') + '）' : ''))
  const holderCalls = callSites.filter(function (s) { return s.file === TRANSPORT_HOLDERS[0] })[0]
  check(!!holderCalls && holderCalls.count === 1, '传输持有者只许一处调用，且是 Tier3 取仓库名那一次（实得 ' + (holderCalls ? holderCalls.count : 0) + ' 处）')
  {
    const holderSrc = fs.readFileSync(path.join(ROOT, TRANSPORT_HOLDERS[0]), 'utf8')
    // 允许名单里的这一处必须是 gh repo view（读仓库名），不是任意 gh 命令 —— 换命令等于换了保留理由。
    check(/runGh\(\['repo',\s*'view'/.test(holderSrc), '传输持有者的这一次是 gh repo view（取仓库名，选后端之前那一步）')
    check(!/from\s+['"][^'"]*tracker\/rooms/.test(holderSrc), '传输持有者不 import 房间实现（保留它的理由是选后端之前的纯读，不是房内调用）')
  }
  check(A2_UNMIGRATED.length === 0, 'A2 未迁路径清单已清零（归位之后不该再有名字）')
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
  console.log(failed ? ('\n' + total + ' 条断言，失败') : ('\n' + total + ' 条断言，全部通过')); process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) })
