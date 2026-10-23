// tests/verify-1443-static-gate.ts —— 门禁：旧路已删、A2 未迁路径显式收口（#1443）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1443-static-gate.ts，可独立运行。
//
// 为什么要这一段：#1443 删掉 deck 壳旧选后端/过闸路径，额度同步改走 Tracker 会话读数。
// 删了不等于不会长回来 —— 本门禁用文本扫描守住三条：旧路标识一个不留、房间边界没人深引、
// A2 未迁的直接调 gh 站点全部记进下面的显式名单（只减不增，A2 清零时缩到空）。
const path = require('path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// A2 到期说明：刷新后台读写链归位（1444/1445）后，未迁路径清零，名单同步缩到空，只减不增。
const A2_EXPIRY = 'A2 清零时删除（1444/1445 归位后，未迁路径清零，名单缩到空）'
// A2 未迁的直接调 gh 站点（房内直调，调用方永不搬家那几处除外）：
const A2_RUNGH_FILES = ['git-execution.ts', 'comment-thread-fetch.ts', 'check-chain-evaluation.ts', 'thin-row-fetch.ts', 'snapshot-build.ts', 'issue-detail-fetch.ts', 'issue-list-fetch.ts']
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

async function main() {
  console.log('旧路删除与 A2 收口门禁（#1443：删旧路、名单只减不增）')
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
  // —— C. A2 未迁直调 gh 站点显式收口 ——
  const hostDir = path.join(ROOT, 'src/refresh/rooms/host')
  // gh-execution.ts 是执行封装本身（定义处，不是调用点）；refresh-runtime.ts 另由下条断言盯（quotaSyncOf 已改道，patchOf 仍是 A2）。
  const hostFiles = listTs(hostDir).filter(function (f) { return path.basename(f) !== 'gh-execution.ts' && path.basename(f) !== 'refresh-runtime.ts' })
  const withRunGh = hostFiles.filter(function (f) { return stripComments(fs.readFileSync(f, 'utf8')).indexOf('runGh(') >= 0 }).map(relOf)
  const foreign = withRunGh.filter(function (f) { return A2_RUNGH_FILES.indexOf(path.basename(f)) < 0 })
  check(foreign.length === 0, '房内直调 gh 的文件全在 A2 名单里' + (foreign.length ? '（名单外：' + foreign.join('、') + '）' : '（' + withRunGh.length + ' 处）'))
  const stale = A2_RUNGH_FILES.filter(function (n) { return withRunGh.filter(function (f) { return f.endsWith('/' + n) }).length === 0 })
  check(stale.length === 0, 'A2 名单没有僵尸项（已迁走的要删行，只减不增）' + (stale.length ? '（僵尸：' + stale.join('、') + '）' : ''))
  const runtime = stripComments(fs.readFileSync(path.join(hostDir, 'refresh-runtime.ts'), 'utf8'))
  const quotaSeg = runtime.split('function quotaSyncOf')[1].split('function ensureDeckReading')[0]
  check(quotaSeg.indexOf('readBudget') >= 0 && quotaSeg.indexOf('runGh') < 0, '额度同步接线已改道（quotaSyncOf 经 readBudget，不再递 runGh）')
  check(runtime.indexOf('patchOf') >= 0, '行级增量接线还在（patchOf 的 runGh 仍是 A2，由 1444/1445 收）[' + A2_EXPIRY + ']')
  // —— D. 注册表选择只剩新路 ——
  const deckFiles = listTs(path.join(ROOT, 'src/deck'))
  const selectors = deckFiles.filter(function (f) { return stripComments(fs.readFileSync(f, 'utf8')).indexOf('registry.select') >= 0 }).map(relOf).sort()
  check(JSON.stringify(selectors) === JSON.stringify(SELECT_SANCTIONED), '调注册表选择的只剩新路自动识别（' + selectors.join('、') + '）')
  // —— E. deck 与刷新机制不深引房间 ——
  const scanned = listTs(path.join(ROOT, 'src/deck')).concat(listTs(path.join(ROOT, 'src/refresh')))
  const deep = scanned.filter(function (f) { return stripComments(fs.readFileSync(f, 'utf8')).split('\n').filter(function (l) { return /from\s+['"][^'"]*tracker\/rooms/.test(l) }).length > 0 }).map(relOf)
  check(deep.length === 0, 'deck 与刷新机制没有值引用房间实现（只许装配点引）' + (deep.length ? '（违规：' + deep.join('、') + '）' : ''))
  console.log(failed ? ('\n' + total + ' 条断言，失败') : ('\n' + total + ' 条断言，全部通过')); process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) })
