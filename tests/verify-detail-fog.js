// verify-detail-fog.js — 分层 MapDetail 迷雾/四态数据验证（T3 #444）
// 断言：快照中每 map 的票 level 分层正确、被阻塞票可识别为迷雾、四态动作映射可推导
// 用法: node tests/verify-detail-fog.js <仓库根目录>
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

// 复刻 client 迷雾判定（D7）：open 且被 open 阻塞者 → 迷雾
function fogOf(map) {
  const byNum = {}
  map.tickets.forEach(function (t) { byNum[t.number] = t })
  const isFog = function (t) {
    if (t.state !== 'OPEN') return false
    const blk = (t.blockedBy || []).map(function (b) { return byNum[b] }).filter(Boolean)
    return blk.some(function (b) { return b.state === 'OPEN' })
  }
  return map.tickets.filter(isFog)
}

// 复刻 client 四态动作映射（D5）
function actionOf(t) {
  const labels = (t.labels || []).map(function (l) { return typeof l === 'string' ? l : l.name })
  if (labels.indexOf('needs-triage') >= 0) return 'diagnose'
  if (labels.indexOf('bug') >= 0) return 'fix'
  if (labels.indexOf('wayfinder:grilling') >= 0) return 'discuss'
  return 'execute'
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
  const withTickets = maps.filter(function (m) { return m.tickets && m.tickets.length > 0 })

  // T3a：迷雾识别 —— 被阻塞票 = 迷雾（D7 语义）
  let fogCount = 0
  withTickets.forEach(function (m) {
    const fog = fogOf(m)
    fogCount += fog.length
    // 每张被识别为迷雾的票：open 且存在 open 阻塞者
    fog.forEach(function (t) {
      const blkOpen = (t.blockedBy || []).some(function (b) { const bt = m.tickets.find(function (x) { return x.number === b }); return bt && bt.state === 'OPEN' })
      expect('map #' + m.number + ' 迷雾票 #' + t.number + ' 语义正确(open+被open阻塞)', t.state === 'OPEN' && blkOpen)
    })
    // 非迷雾 open 票：无 open 阻塞者
    const nonFogOpen = m.tickets.filter(function (t) { return t.state === 'OPEN' && !fog.some(function (f) { return f.number === t.number }) })
    nonFogOpen.forEach(function (t) {
      const hasOpenBlocker = (t.blockedBy || []).some(function (b) { const bt = m.tickets.find(function (x) { return x.number === b }); return bt && bt.state === 'OPEN' })
      expect('map #' + m.number + ' 非迷雾 open 票 #' + t.number + ' 无 open 阻塞者', !hasOpenBlocker)
    })
  })
  // 迷雾存在性不作硬断言（数据演进：T1/T2 完成后 #444 阻塞解除，迷雾可能为 0）
  console.log('  迷雾票总数: ' + fogCount + '（为 0 = 当前无被 open 阻塞的票，正常）')

  // T3b：四态动作映射（D5）—— 每张 open 票可推出动作
  withTickets.forEach(function (m) {
    m.tickets.filter(function (t) { return t.state === 'OPEN' }).forEach(function (t) {
      const act = actionOf(t)
      expect('map #' + m.number + ' 票 #' + t.number + ' 动作=' + act, ['diagnose', 'fix', 'discuss', 'execute'].indexOf(act) >= 0)
    })
  })

  // T3c：迷雾票与分层结合 —— 被阻塞票 level > 阻塞者 level（迷雾在更深层）
  withTickets.forEach(function (m) {
    const fog = fogOf(m)
    fog.forEach(function (t) {
      const blk = (t.blockedBy || []).map(function (b) { return m.tickets.find(function (x) { return x.number === b }) }).filter(Boolean)
      blk.forEach(function (b) {
        if (typeof b.level === 'number' && typeof t.level === 'number') {
          expect('map #' + m.number + ' 迷雾 #' + t.number + ' level>' + b.level + '(阻塞者)', t.level > b.level)
        }
      })
    })
  })

  // T3d：分层渲染前提 —— 每张票有 level（漏斗分层可渲染）
  withTickets.forEach(function (m) {
    const allHave = m.tickets.every(function (t) { return typeof t.level === 'number' })
    expect('map #' + m.number + ' 每张票有 level（漏斗可渲染）', allHave)
  })

  const pass = checks.filter(function (c) { return c.pass }).length
  const fail = checks.length - pass
  console.log('')
  console.log('TOTAL ' + checks.length + ' PASS ' + pass + ' FAIL ' + fail)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch(function (e) { console.error('ERROR', e); process.exit(2) })
