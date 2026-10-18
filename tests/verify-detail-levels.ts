// verify-detail-levels.js — 分层 MapDetail 数据层验证（T1 #442）
// 断言：wf.snapshot 每个 map 的 stats.levels 结构正确 + 每张票带 level + DAG 分层语义自洽
// 用法: node --import ./scripts/ts-hook.mjs tests/verify-detail-levels.js <仓库根目录>
// 为什么不再读根目录的 host.js：那是 gitignore 的构建产物，别人改完 src 没重建时这里量到的是旧行为
//   （2026-10-17 之前它就红在这上面：宿主改成 apply 内部自己收注册、经 /api/dsws 分发之后，
//   老的「假 harness 收 handler」写法一个 handler 都收不到）。现在直接 import 真源 src/host/index.ts，
//   再照客户端的样子发一次真信封，走的就是生产那一条通路。
const fsx = require('fs')
const fsp = fsx.promises
const path = require('path')
const { spawn } = require('child_process')

const REPO_CWD = process.argv[2] || process.cwd()

const subprocess = {
  async resolveExecutable(name) {
    // PATH 分隔符与可执行后缀都按平台取：原来写死 ";" 与 PATHEXT，只有 Windows 找得到；
    // Linux/macOS 的 PATH 是冒号分隔，这些门禁在 CI 上会全场景报「找不到 git」。
    // （#600 附带的 CI 修复：verify-t1-initpublish.js 就是这么在 ubuntu/macos 上必红的。）
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    const exts = process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).map(function (x) { return x.toLowerCase() })
      : ['']
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
// 宿主今天的样子（2026-10-17 核对 src/host/index.ts 与 src/host/rpcChannel.js）：
//   apply 内部自己造 harness 表，把 59 条电话注册进一张 Map，再把这张表交给 RPC 通道；
//   通道用 ctx.get('connection').fetch.register 挂一条精确路由 /api/dsws，
//   端点名在请求体里（wf. 前缀在注册时被剥掉），调用要走真实信封。
// 所以这里不再用「假 harness 收 handler」那种老写法（那样一个 handler 也收不到，
// 门禁会红在 h['wf.refresh'] is not a function 上），改成把 connection.fetch.register 接下来，
// 再照客户端的样子发一次 POST 信封。这条通路正是生产走的那一条。
const HOST_ROUTE = '/api/dsws'
const RPC_ID = 'verify-detail-levels'
const ROUTE_WAIT_MS = 5000

function loadPlugin(services) {
  let routeFetch = null
  const connection = {
    fetch: {
      register(spec) { routeFetch = spec.fetch; return function () {} },
    },
  }
  const ctx = {
    get: name => (name === 'connection' ? connection : services[name]),
    effect: fn => { const d = fn(); return typeof d === 'function' ? d : function () {} },
    inject: () => {},
  }

  // 通道注册是异步的（宿主内部动态 import 通道模块）：等到路由出现为止；等不到就直说失败。
  // 不能静默略过——「一条断言都没跑却退出 0」正是这扇门禁最容易骗人的地方。
  async function waitRoute() {
    const t0 = Date.now()
    while (routeFetch === null && Date.now() - t0 < ROUTE_WAIT_MS) await new Promise(r => setTimeout(r, 20))
    if (routeFetch === null) {
      throw new Error('宿主没有把 RPC 通道注册进来（等了 ' + ROUTE_WAIT_MS + 'ms）：先确认 src/host/rpcChannel.js 还在、connection.fetch.register 的形状没变')
    }
    return routeFetch
  }

  // 一次真调用：照 src/seam/rpc.ts 的信封形状发 POST，取 result.value；失败信封原样报出来。
  async function callEndpoint(endpoint, payload) {
    const route = await waitRoute()
    const req = new Request('http://dsh.internal' + HOST_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: RPC_ID, payload: { method: endpoint, payload } }),
    })
    const res = await route(req)
    const env = await res.json()
    const result = env && env.result
    if (!result || result.ok !== true) {
      throw new Error('端点 ' + endpoint + ' 没回成功：' + JSON.stringify((result && result.error) || result))
    }
    return result.value
  }

  async function start() {
    // 真源是 TypeScript：显式 .ts 说明符，装载钩子会按同名优先规则处理它内部的 .js 说明符。
    const mod = await import('../src/host/index.ts')
    const plugin = mod.default
    plugin.apply(ctx)
    return { callEndpoint }
  }

  return { start, callEndpoint }
}

async function main() {
  const checks = []
  const expect = (name, cond, extra) => {
    checks.push({ name, pass: !!cond, extra: extra || '' })
    if (!cond) console.error('  ✗ FAIL:', name, extra || '')
    else console.log('  ✓', name)
  }

  const { start, callEndpoint } = loadPlugin({ subprocess, timer, fs: fsSvc })
  await start()
  const snap = await callEndpoint('refresh', { cwd: REPO_CWD })
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
