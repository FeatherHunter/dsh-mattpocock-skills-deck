// verify-detail-levels.js — 分层 MapDetail 数据层验证（T1 #442）
// 断言：wf.snapshot 每个 map 的 stats.levels 结构正确 + 每张票带 level + DAG 分层语义自洽
// 用法: node tests/verify-detail-levels.js <仓库根目录>
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
const timer = { timeout: ms => new Promise(res => setTimeout(res, ms)), interval: (fn, ms) => { const id = setInterval(fn, ms); if (id.unref) id.unref(); return () => clearInterval(id) } }
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

async function main() {
  const checks = []
  const expect = (name, cond, extra) => {
    checks.push({ name, pass: !!cond, extra: extra || '' })
    if (!cond) console.error('  ✗ FAIL:', name, extra || '')
    else console.log('  ✓', name)
  }

  const h = loadPlugin({ subprocess, timer, fs: fsSvc })
  const snap = await h['wf.refresh']({ cwd: REPO_CWD })
  expect('快照 ok', snap && snap.ok === true)
  const maps = (snap && Array.isArray(snap.maps)) ? snap.maps : []

  // T1a：每个 map 的 stats.levels 存在且结构正确
  const withTickets = maps.filter(function (m) { return m.tickets && m.tickets.length > 0 })
  expect('存在含子票的 map', withTickets.length > 0)
  withTickets.forEach(function (m) {
    const lv = m.stats && m.stats.levels
    expect('map #' + m.number + ' stats.levels 存在', Array.isArray(lv) && lv.length > 0)
    if (Array.isArray(lv)) {
      // level 从 0 起连续递增
      const okSeq = lv.every(function (l, i) { return l.level === i })
      expect('map #' + m.number + ' levels 层级连续(0..' + (lv.length - 1) + ')', okSeq)
      // 每层 total = open + closed
      const okSum = lv.every(function (l) { return l.total === (l.open + l.closed) })
      expect('map #' + m.number + ' 每层 total=open+closed', okSum)
      // 层内状态细分和
      const okSub = lv.every(function (l) { return l.open === (l.frontier + l.claimed + l.blocked) })
      expect('map #' + m.number + ' 每层 open=frontier+claimed+blocked', okSub)
      // numbers 数量 = total
      const okNums = lv.every(function (l) { return l.numbers.length === l.total })
      expect('map #' + m.number + ' 每层 numbers 数量=total', okNums)
    }
  })

  // T1b：每张票带 level，且与 stats.levels 归属一致
  withTickets.forEach(function (m) {
    const lv = m.stats && m.stats.levels
    if (!Array.isArray(lv)) return
    const levelSet = {}
    lv.forEach(function (l) { l.numbers.forEach(function (n) { levelSet[n] = l.level }) })
    const allHave = m.tickets.every(function (t) { return typeof t.level === 'number' })
    expect('map #' + m.number + ' 每张票带 level', allHave)
    if (allHave) {
      const okConsist = m.tickets.every(function (t) { return levelSet[t.number] === t.level })
      expect('map #' + m.number + ' 票 level 与 stats.levels 一致', okConsist)
    }
  })

  // T1c：DAG 语义 —— 若票 A 被票 B 阻塞，则 A.level > B.level（严格递增）
  withTickets.forEach(function (m) {
    const byNum = {}
    m.tickets.forEach(function (t) { byNum[t.number] = t })
    let bad = 0
    m.tickets.forEach(function (t) {
      ;(t.blockedBy || []).forEach(function (b) {
        const bt = byNum[b]
        if (bt && typeof bt.level === 'number' && typeof t.level === 'number' && t.level <= bt.level) bad++
      })
    })
    expect('map #' + m.number + ' DAG 语义：被阻塞者 level 严格大于阻塞者（bad=' + bad + '）', bad === 0)
  })

  // T1d：真实数据层级数合理（1..10 层内）
  withTickets.forEach(function (m) {
    const lv = m.stats && m.stats.levels
    if (Array.isArray(lv)) {
      expect('map #' + m.number + ' 层级数 ' + lv.length + ' 在 1..10', lv.length >= 1 && lv.length <= 10)
    }
  })

  const pass = checks.filter(function (c) { return c.pass }).length
  const fail = checks.length - pass
  console.log('')
  console.log('TOTAL ' + checks.length + ' PASS ' + pass + ' FAIL ' + fail)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch(function (e) { console.error('ERROR', e); process.exit(2) })
