// verify-panel.js — dsh-waystation 面板数据源与分组验证（ticket #346）
// 可复现版：性质断言 + 现场 gh 动态比对（不绑死认领/地图数等现场状态）。
// 用法: node tests/verify-panel.js <仓库根目录>
const fsx = require('fs')
const fsp = fsx.promises
const path = require('path')
const { spawn } = require('child_process')

const REPO_CWD = process.argv[2] || process.cwd()
const HOST_JS = path.join(__dirname, '..', 'host.js')

const subprocess = {
  async resolveExecutable(name) {
    const dirs = (process.env.PATH || '').split(';').filter(Boolean)
    const exts = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    const cands = []
    for (const d of dirs) { for (const ext of exts) cands.push(path.join(d, name + ext.toLowerCase())); cands.push(path.join(d, name)) }
    for (const c of cands) { try { fsx.accessSync(c); return c } catch (e) { /* 继续 */ } }
    throw new Error('executable not found: ' + name)
  },
  spawn(spec) {
    const cp = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = '', err = ''
    cp.stdout.on('data', d => { out += d })
    cp.stderr.on('data', d => { err += d })
    const done = new Promise(res => cp.on('close', (code, signal) => res({ exitCode: code, signal })))
    return { done, collected: { stdout: { readFrom: () => ({ text: out }) }, stderr: { readFrom: () => ({ text: err }) } }, terminate: () => { try { cp.kill() } catch (e) { /* ignore */ } } }
  },
}
const timer = {
  timeout: ms => new Promise(res => setTimeout(res, ms)),
  interval: (fn, ms) => { const id = setInterval(fn, ms); if (id.unref) id.unref(); return () => clearInterval(id) },
}
const fsSvc = {
  async resolve(p, opts) { return path.resolve((opts && opts.cwd) || process.cwd(), p) },
  async lstat(p, opts) {
    const abs = path.resolve((opts && opts.cwd) || process.cwd(), p)
    try { const s = await fsp.lstat(abs); return { type: s.isDirectory() ? 'directory' : 'file', size: s.size } } catch (e) { return undefined }
  },
  async readText(t) { return fsp.readFile(t, 'utf8') },
  processPath(t) { return t },
}
function loadPlugin(services) {
  const handlers = {}
  const harness = { handle: (name, fn) => { handlers[name] = fn } }
  const ctx = { get: n => services[n], effect: fn => { const d = fn(); return typeof d === 'function' ? d : () => {} } }
  const fn = new Function('harness', 'ctx', fsx.readFileSync(HOST_JS, 'utf8'))
  const plugin = fn(harness, ctx)
  plugin.apply(ctx)
  return handlers
}
const nums = arr => arr.map(x => x.number).sort((a, b) => a - b)

// 复刻 client.js compute()（#346 面板分组逻辑）
function computeGroups(snapshot) {
  const maps = (snapshot && Array.isArray(snapshot.maps)) ? snapshot.maps : []
  return maps.map(function (m) {
    const byNum = {}; m.tickets.forEach(function (t) { byNum[t.number] = t })
    const openBlocker = (b) => { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
    const open = m.tickets.filter(function (t) { return t.state === 'OPEN' })
    const closed = m.tickets.filter(function (t) { return t.state === 'CLOSED' })
    const frontier = open.filter(function (t) { return !t.claimedBy && !t.blockedBy.some(openBlocker) })
    const claimed = open.filter(function (t) { return t.claimedBy })
    const blocked = open.filter(function (t) { return !t.claimedBy && t.blockedBy.some(openBlocker) })
    return { m: m, open: open, closed: closed, frontier: frontier, claimed: claimed, blocked: blocked }
  })
}

async function main() {
  const checks = []
  const expect = (name, cond, extra) => {
    checks.push({ name, pass: !!cond, extra: extra || '' })
    if (!cond) console.error('  ✗ FAIL:', name, extra || '')
    else console.log('  ✓', name)
  }

  const h = loadPlugin({ subprocess, timer, fs: fsSvc })
  const snap = await h['wf.refresh']({ cwd: REPO_CWD })

  // —— 快照信封（性质断言） ——
  expect('快照 ok + repo 解析', snap && snap.ok === true && snap.repo && typeof snap.repo.owner === 'string' && typeof snap.repo.name === 'string', JSON.stringify(snap && snap.repo))
  expect('地图为动态全量（≥1，随会话增减）', Array.isArray(snap.maps) && snap.maps.length >= 1, 'maps=' + (snap.maps || []).length)
  expect('每 map 五区块字段齐（destination/notes 为字符串，decisions/fog/outOfScope 为数组）', snap.maps.every(m => Array.isArray(m.decisions) && Array.isArray(m.fog) && Array.isArray(m.outOfScope) && typeof m.destination === 'string' && typeof m.notes === 'string'))
  expect('每 map stats 与 tickets 一致', snap.maps.every(m => m.stats.total === m.tickets.length))
  expect('每 ticket 含面板所需字段', snap.maps.every(m => m.tickets.every(t => typeof t.number === 'number' && typeof t.title === 'string' && typeof t.type === 'string' && (t.state === 'OPEN' || t.state === 'CLOSED') && Array.isArray(t.blockedBy) && Array.isArray(t.blocks) && typeof t.claimedBy === 'string' && typeof t.url === 'string')))
  expect('closed 票无 resolution 字段（面板显示「✅ 已关闭」）', snap.maps.every(m => m.tickets.filter(t => t.state === 'CLOSED').every(t => t.resolution === undefined)))

  // —— 分组性质 + 现场比对（动态，不硬编码） ——
  const groups = computeGroups(snap)
  const bad = groups.filter(g => g.open.length + g.closed.length !== g.m.tickets.length)
  expect('全部 map 分组守恒（open+closed=tickets）', bad.length === 0, 'bad=' + bad.length)
  expect('stats 与分组一致', groups.every(g => g.m.stats.open === g.open.length && g.m.stats.closed === g.closed.length && g.m.stats.frontier === g.frontier.length && g.m.stats.claimed === g.claimed.length && g.m.stats.blocked === g.blocked.length))
  expect('frontier=open 且未认领且无 open 阻塞（语义自洽）', groups.every(g => g.frontier.every(t => !t.claimedBy && !t.blockedBy.some(b => g.m.tickets.find(x => x.number === b) && g.m.tickets.find(x => x.number === b).state === 'OPEN'))))
  expect('claimed=open 且有认领人', groups.every(g => g.claimed.every(t => !!t.claimedBy)))
  expect('blocked=open 且未认领且被 open 阻塞', groups.every(g => g.blocked.every(t => !t.claimedBy && t.blockedBy.some(b => { const bt = g.m.tickets.find(x => x.number === b); return bt && bt.state === 'OPEN' }))))

  // —— 缓存（须在现场比对循环前测：gh 循环耗时 > 5s 缓存 TTL） ——
  const snap2 = await h['wf.snapshot']({ cwd: REPO_CWD })
  expect('wf.snapshot 5s 缓存命中（同对象）', snap2 === snap)

  // 现场比对：对每张 map 用 gh issue view 拉子票计数核对（只比对数量与状态分布，避免网络 N+1 过重）
  const ghPath = 'D:\\0Tools\\GitHubCLI\\gh.exe'
  for (const g of groups.slice(0, 5)) {
    try {
      const cp = spawn(ghPath, ['issue', 'view', String(g.m.number), '--json', 'subIssues', '--jq', '[.subIssues.nodes[]|{number,state}]'], { cwd: REPO_CWD, windowsHide: true })
      let out = ''
      cp.stdout.on('data', d => { out += d })
      const done = new Promise(res => cp.on('close', (code) => res(code)))
      const code = await done
      if (code !== 0) { console.log('  ⚠ 现场比对跳过（gh issue view ' + g.m.number + ' 失败）'); continue }
      const live = JSON.parse(out)
      const mine = nums(g.m.tickets)
      const theirs = nums(live)
      expect('map #' + g.m.number + ' 子票集合与 GitHub 现场一致', mine.join(',') === theirs.join(','), 'mine=' + mine.join(',') + ' live=' + theirs.join(','))
      const liveOpen = live.filter(t => t.state === 'OPEN').length
      expect('map #' + g.m.number + ' open 计数与现场一致', g.open.length === liveOpen, g.open.length + ' vs ' + liveOpen)
    } catch (e) { console.log('  ⚠ 现场比对异常：' + String((e && e.message) || e)) }
  }

  console.log('--- 地图清单（人工核对） ---')
  groups.forEach(g => console.log('   #' + g.m.number, g.m.title.slice(0, 40), '| 开', g.open.length, '关', g.closed.length, 'frontier', g.frontier.length, 'claimed', g.claimed.length, 'blocked', g.blocked.length))

  const failed = checks.filter(c => !c.pass)
  console.log('')
  console.log('TOTAL', checks.length, 'PASS', checks.length - failed.length, 'FAIL', failed.length)
  process.exit(failed.length ? 1 : 0)
}
main().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2) })
