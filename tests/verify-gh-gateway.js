#!/usr/bin/env node
/**
 * verify-gh-gateway.js —— 门禁：去 GitHub 的每一笔都从唯一出口闸过（#706 T2 第二批 · I1）
 *
 * 为什么需要它（依据 docs/architecture/refresh-budget-architecture.html 第一章 I1 与第三章）：
 * 从前「超限」治不住，根子不是哪个数字写大了，而是**没有出口**——探测、重建、检查链、命名守护、
 * 单票详情各写各的调用点，任何一处多写一行，整体就越线。所以这一票把出口收成一道闸，
 * 而「收成了没有」不能靠自觉：这条门禁盯着真正能起 gh 进程的那几个地方。
 *
 * 它守三件事：
 *   A. **静态扫描**：扫整个 src/（含以后新增的目录）里每一个能起进程的调用点，
 *      逐个必须在下面的出口登记表里；没登记的一律判红——新写一条绕开闸的路当场被抓住。
 *   B. **登记表不许说谎**：表里每一行都必须真的命中（过时的登记表判红）；
 *      真能起 gh 的存量出口必须写明由哪张票接线，而且这种「还没接线」的行数只许减不许增。
 *   C. **运行期漏网计数为 0**：真跑一遍「账本 + 闸」（用假的传输层，它每真发一条就报给闸），
 *      走闸的那条路漏网数必须为 0；直连传输层绕开闸的那条路必须被数出来（这是门禁自己的反证夹具）。
 *
 * 三向验证（照 tests/verify-deck-event-gate.mjs 的写法）：现状绿 / 违规样本红 / 合规样本绿。
 * 后两向每次运行都会自动跑一遍（夹具在 tests/fixtures/gh-gateway/ 下），所以「门禁有没有牙齿」
 * 不需要人记得去试。也可以用 --root 手动指向夹具目录单独跑。
 *
 * 用法：
 *   node tests/verify-gh-gateway.js                       # 扫整个仓库（默认扫描根 = 本脚本上一级）
 *   node tests/verify-gh-gateway.js --root <目录>          # 换扫描根（例如探针样本目录）
 *   node tests/verify-gh-gateway.js --registry <文件>      # 追加一份登记表（JSON 数组）
 *   node tests/verify-gh-gateway.js --list                # 只列出扫到的调用点，不做判定
 * 退出码：0 = 通过；1 = 有违规。
 */
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
/** 探针样本目录（相对扫描根）：扫仓库时一律跳过，否则「现状」那一跑会被自己的样本判红。 */
const PROBE_DIR = 'tests/fixtures/gh-gateway'

let failed = false
let total = 0
const check = (ok, msg, detail) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}

/** 能起进程的调用点：DSH 的 subprocess.spawn、以及直接起某个程序的 exec/spawn。 */
const SPAWN_RE = /(?:^|[^A-Za-z0-9_$.])(?:subprocess\s*\.\s*spawn|spawn|spawnSync)\s*\(\s*[/{]/g
const EXEC_RE = /(?:^|[^A-Za-z0-9_$.])exec(?:File|FileSync)?\s*\(\s*['"][A-Za-z]/g
/** 「把这一笔报给闸」的写法。真能起 gh 的出口必须有它（登记表说了话，代码得做到）。 */
const REPORT_RE = /noteOutbound\s*\(|ghGate\b|refresh\/gate\.js/

/**
 * 出口登记表。**新增能起 gh 进程的代码必须在这里加一行**，并写清理由。
 * role 三种：
 *   gateway          —— 这个调用点已经在闸后面（正文里把每一笔报给了闸）；
 *   transport-pending —— 真的能起 gh 进程的存量出口，还没接线，必须写 ticket（哪张票接）；
 *   not-github       —— 起的是别的程序（更新安装器、打开文件、另一个平台后端），不是 GitHub 的出口。
 */
const EXITS = [
  { file: 'src/host/repoKeys.js', role: 'transport-pending', ticket: '#706（第三批接线：闸接进取数层）', reason: '宿主侧取数层的执行出口：runGh 起 gh、execProc 起任意命令（含 gh 与 git），全仓绝大多数 GitHub 出站都从这里出去' },
  { file: 'src/host/platformChannel.js', role: 'transport-pending', ticket: '#706（第三批接线：闸接进取数层）', reason: '操作上下文交给后端的那种 exec 出口（tracker 三个房间与快照那几路都走它）' },
  { file: 'src/host/tracker/backends/github/client.js', role: 'transport-pending', ticket: '#706（第三批接线：闸接进取数层）', reason: 'GitHub 房间执行 gh 的地方（exec(\'gh\', args) 与 gh --version 探测），最终落到上面两个出口' },
  { file: 'src/host/platform/index.js', role: 'not-github', reason: '起的是「打开文件 / 打开文件夹」那条路，不是 GitHub 出站' },
  { file: 'src/host/updateStore.js', role: 'not-github', reason: '更新安装器：起的是 dsh 自己那条命令，不是 GitHub 出站' },
  { file: 'src/host/updatePkg/store.js', role: 'not-github', reason: '更新包的派生副本（packages/dsh-plugin-update 编译产物），同上' },
  { file: 'src/host/tracker/backends/gitlab/client.js', role: 'not-github', reason: '起的是 glab（另一个后端），不是 GitHub 的出口' },
  { file: 'src/host/tracker/backends/gitlab/index.js', role: 'not-github', reason: '起的是 git（读远端地址），不是 GitHub 出站' },
  { file: 'src/host/tracker/backends/gitlab/preflight.js', role: 'not-github', reason: '起的是 glab（另一个后端的预检），不是 GitHub 的出口' },
]

/** 「还没接线的存量出口」只许减不许增：加一行必须同一次改动里把这个数字一起改大（会让评审看见）。 */
const LEGACY_MAX = 3

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length))
}

function listJsFiles(dir, skipAbs) {
  const out = []
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) { if (path.resolve(p) === skipAbs) continue; walk(p) }
      else if (ent.name.endsWith('.js')) out.push(p)
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return out
}

/** 扫一棵树，返回 { hits, files }。hits: [{ file, line, text }]，file 相对扫描根。 */
function scan(root, skipAbs) {
  const srcDir = path.join(root, 'src')
  const files = listJsFiles(fs.existsSync(srcDir) ? srcDir : root, skipAbs)
  const hits = []
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join('/')
    const text = stripComments(fs.readFileSync(abs, 'utf8'))
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const re of [SPAWN_RE, EXEC_RE]) {
        re.lastIndex = 0
        if (re.test(lines[i])) { hits.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 120) }); break }
      }
    }
  }
  return { hits: hits, files: files, root: root }
}

/** 判定一棵树：返回违规清单（空 = 绿）。 */
function judge(result, registry) {
  const bad = []
  const seen = {}
  for (const h of result.hits) {
    const row = registry.find((r) => path.normalize(r.file) === path.normalize(h.file))
    seen[path.normalize(h.file)] = true
    if (!row) { bad.push('未登记的出站调用点 ' + h.file + ':' + h.line + '（新增调用点要么走闸、要么在出口登记表里写明理由）'); continue }
    if (row.role === 'gateway') {
      const text = stripComments(fs.readFileSync(path.join(result.root, row.file), 'utf8'))
      if (!REPORT_RE.test(text)) {
        bad.push('登记为 gateway 却没把每一笔报给闸 ' + h.file + ':' + h.line + '（正文里找不到 noteOutbound 这类报账调用——登记表不许说谎）')
      }
    }
  }
  for (const row of registry) {
    if (!seen[path.normalize(row.file)]) bad.push('出口登记表里的这一行没有对应调用点（过时登记）：' + row.file)
    if (row.role === 'transport-pending' && !row.ticket) bad.push('transport-pending 这一行没写 ticket（哪张票接线）：' + row.file)
  }
  const pending = registry.filter((r) => r.role === 'transport-pending').length
  if (pending > LEGACY_MAX) bad.push('还没接线的存量出口 ' + pending + ' 个，超过只减不增的上限 ' + LEGACY_MAX + ' 个（新加出口必须直接接进闸）')
  return { violations: bad, pending: pending, hits: result.hits.length, files: result.files.length }
}

function loadRegistry(file) {
  if (!file) return []
  const abs = path.resolve(ROOT, file)
  if (!fs.existsSync(abs)) { console.log('登记表文件不存在：' + abs); process.exit(1) }
  const rows = JSON.parse(fs.readFileSync(abs, 'utf8'))
  if (!Array.isArray(rows)) { console.log('登记表要求是 JSON 数组：' + abs); process.exit(1) }
  return rows
}

async function runtimePart() {
  console.log('\n== 运行期：漏网计数（真跑一遍账本 + 闸，用假的传输层） ==')
  const ledgerMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'ledger.js')).href)
  const gateMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'gate.js')).href)
  let clock = 1700000000000
  const build = function () {
    const ledger = ledgerMod.createLedger({ now: () => clock })
    ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
    const sent = { requests: 0, points: 0 }
    const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
    // 假的传输层：每真发一条就报给闸 —— 生产里挂在起 gh 进程那一层。
    const transport = {
      send: function (entry) { gate.noteOutbound({ requests: entry.requests || 1, points: entry.points || 0 }); sent.requests += entry.requests || 1; sent.points += entry.points || 0 },
    }
    return { ledger: ledger, gate: gate, transport: transport, sent: sent }
  }

  // 走闸：漏网数必须是 0
  const g = build()
  g.gate.setWorkspace('ws-1', { active: true })
  const viaGate = await g.gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: 'ws-1' }, async function () {
    g.transport.send({ requests: 1 })
    return { requests: 1 }
  })
  check(viaGate.sent === true && viaGate.requests === 1, '经闸发出的那一笔记成 1 条真实请求（' + JSON.stringify({ sent: viaGate.sent, requests: viaGate.requests }) + '）')
  const esc = g.gate.escaped()
  check(esc.requests === 0 && esc.points === 0, '走闸那条路：运行期漏网计数为 0（实得 ' + JSON.stringify(esc) + '）')

  // 绕开闸：直连传输层，必须被数出来（门禁自己的反证夹具：数不出来就说明这个计数器是摆设）
  const g2 = build()
  g2.gate.setWorkspace('ws-2', { active: true })
  await g2.gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: 'ws-2' }, async function () { g2.transport.send({ requests: 1 }); return { requests: 1 } })
  g2.transport.send({ requests: 1 })   // ← 故意绕过闸
  const esc2 = g2.gate.escaped()
  check(esc2.requests === 1, '绕开闸的那一条被数出来（漏网实得 ' + esc2.requests + ' 条，应为 1 条）',
    '若这条判红，说明漏网计数器不工作，I1 的「运行期那一半」等于没有')
}

async function main() {
  const customRoot = argOf('--root')
  const registry = EXITS.concat(loadRegistry(argOf('--registry')))
  console.log('== 门禁 A/B：整个 src 的出站调用点都在闸后（#706 · I1） ==')
  console.log('插件根：' + ROOT)

  if (argv.includes('--list')) {
    const r = scan(customRoot ? path.resolve(ROOT, customRoot) : ROOT, path.resolve(ROOT, PROBE_DIR))
    console.log('扫到 ' + r.hits.length + ' 个能起进程的调用点（' + r.files.length + ' 个 js 文件）：')
    for (const h of r.hits) console.log('  ' + h.file + ':' + h.line + '  ' + h.text)
    return
  }

  // 第一向：现状（或 --root 指定的那棵树）
  const skipAbs = path.resolve(ROOT, PROBE_DIR)
  const target = customRoot ? path.resolve(ROOT, customRoot) : ROOT
  if (!customRoot) console.log('（跳过探针样本目录：' + PROBE_DIR + '）')
  const mine = judge(scan(target, skipAbs), registry)
  check(mine.violations.length === 0, '扫描根这一棵树：出站调用点全部在闸后' + (mine.violations.length ? '' : '（' + mine.hits + ' 处调用点 / ' + mine.files + ' 个文件，存量待接线 ' + mine.pending + ' 处）'),
    mine.violations.join('；'))
  if (customRoot) {
    await runtimePart()
    console.log(failed ? '\n存在失败 — 出站闸门禁未通过' : '\n全部通过 — 出站都在闸后')
    process.exit(failed ? 1 : 0)
  }
  // I1 的已知缺口不许当装饰藏着：每一次运行都把「还没接线的存量出口」逐条打出来（带票号）。
  for (const row of registry.filter((r) => r.role === 'transport-pending')) {
    console.log('  INFO I1 的已知缺口：这一处出口还没接线，由 ' + row.ticket + ' 接 —— ' + row.file)
  }

  // 第二向与第三向：违规样本必须红、合规样本必须绿（每次运行都验一遍门禁自己的牙齿）
  const bad = judge(scan(path.join(ROOT, PROBE_DIR, 'violating'), null), loadRegistry('tests/fixtures/gh-gateway/violating.registry.json'))
  check(bad.violations.length >= 2, '违规样本判红（未登记的调用点与「登记了却没报给闸」各抓一处，实得 ' + bad.violations.length + ' 处）',
    '违规样本没被抓出来 = 这条门禁没有牙齿')
  const good = judge(scan(path.join(ROOT, PROBE_DIR, 'compliant'), null), loadRegistry('tests/fixtures/gh-gateway/compliant.registry.json'))
  check(good.violations.length === 0, '合规样本判绿（同一处出口，但正文里把每一笔报给了闸）',
    good.violations.join('；'))

  await runtimePart()

  console.log(failed ? '\n存在失败 — 出站闸门禁未通过' : '\n全部通过 — 出站都在闸后（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
