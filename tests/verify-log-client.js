// verify-log-client.js —— #490 client 日志底座门禁（设计 #335 第 1、4 章映射到 client 的断言）。
// 用法：node tests/verify-log-client.js（在插件根目录；先运行 node scripts/build.mjs 生成产物）。
// 覆盖 3 组：开关持久化（新键 dsws.debug、默认关闭、不动 dsws.cfg）、
//   对账（启动本地秒显、宿主为准、失败保持本地不回退开启）、广播（沿 broadcastCfg 同构）。
// 外加 4 项底座自检：统一接口同名同参、体内兜底第一行、批量字面、双产物含新电话名。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('client 日志底座门禁（#490：开关持久化、对账 winner 为宿主、广播同构）')

const LOG_SRC = path.join(ROOT, 'src', 'client', 'kernel', 'log.js')
const PROBE_SRC = path.join(ROOT, 'src', 'client', 'kernel', 'probe-snapshot.js')

// ---- 底座自检：文件行数、统一接口、体内兜底 ----
const src = fs.readFileSync(LOG_SRC, 'utf8')
check(src.split(/\r?\n/).length <= 350, '日志模块不超 350 行（实得 ' + src.split(/\r?\n/).length + ' 行）')
for (const name of ['isEnabled', 'log', 'flush', 'getDroppedCount']) {
  check(new RegExp('export\\s+(const|function)\\s+' + name + '\\b').test(src), '客户端导出与宿主同名同参接口 ' + name)
}
const logAt = src.indexOf('export const log = function')
let firstLineOk = false
if (logAt >= 0) {
  const after = src.slice(logAt).split('\n').slice(1, 4).map((l) => l.trim()).filter(Boolean)
  firstLineOk = after.length > 0 && after[0].includes('isEnabled')
}
check(firstLineOk, '级别判断放在 log 函数第一行（体内兜底，与宿主同纪律）')
check(src.includes('LOG_BATCH_MAX = 50'), '每批最多 50 条（设计 2.5 字面）')
check(src.includes('LOG_FLUSH_MS = 1000'), '每 1000 毫秒发一次（设计 2.5 字面）')
check(src.includes('LOG_PACKET_BYTES = 131072'), '单包 128KB 上限（设计 2.5 字面）')
check(src.includes('LOG_QUEUE_MAX = 100'), '队列 100 条封顶（先到先截，不无界缓冲）')
// 渲染路径禁令：日志模块里的对象转文本只许出现在转发估算与开关持久化两处（均为非渲染路径）。
const stringifyHits = src.split('\n').filter((l) => l.includes('JSON.stringify'))
check(stringifyHits.length === 2 && src.includes('estimateBatchBytes') && src.includes('persistLocalDebugSwitch'), '对象转文本只在转发估算与开关持久化两处（渲染路径禁令）')

// ---- 开关持久化：新键形状、默认关闭、不动旧键 ----
check(src.includes("LOG_DEBUG_KEY = 'dsws.debug'"), '本地开关新键为 dsws.debug（设计 1.3 字面）')
const srcNoComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
check(!srcNoComments.includes('dsws.cfg') && !srcNoComments.includes('CFG_KEY'), '不动 dsws.cfg 现有字段（设计 1.3，注释除外）')
check(/enabled:\s*false/.test(src), '开关默认关闭（设计 1.3：全局整机一个开关，默认关闭）')

// ---- 对账与广播接线字面 ----
check(src.includes("host.call('wf.logGetSwitch'"), '对账经宿主开关读电话 wf.logGetSwitch')
check(src.includes("host.call('wf.logSetSwitch'"), '设置经宿主开关写电话 wf.logSetSwitch')
check(src.includes("host.call('wf.logBatch'"), '转发经宿主记录电话 wf.logBatch')
check(!src.includes('wf.logExport') && !src.includes('wf.logClear'), '底座不碰导出与清空电话（界面批次范围，变了同步更新本门禁）')
const probeSrc = fs.readFileSync(PROBE_SRC, 'utf8')
check(/export\s+const\s+broadcastLogSwitch\b/.test(probeSrc), '开关变更广播函数 broadcastLogSwitch 在 probe-snapshot.js')
check(probeSrc.includes('applyTo(shared)') && probeSrc.includes('Object.keys(stores)'), '广播沿 broadcastCfg 同构（共享与全组逐个走访发出）')

// ---- 运行夹具：把日志模块按构建语义（去行首 export）载入，配假宿主与假存储 ----
function makeLocalStorage(preset) {
  const map = new Map(Object.entries(preset || {}))
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) { map.set(k, String(v)) },
    _map: map,
  }
}
function makeTimer() {
  const calls = []
  return { calls, timeout(fn, ms) { calls.push(ms); return calls.length } }
}
function loadLog(options) {
  const opts = options || {}
  const body = src.split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n')
  const factory = new Function(
    'host', 'timer', 'localStorage', 'broadcastLogSwitch',
    body + '\nreturn { isEnabled, log, flush, getDroppedCount, logSwitch, logQueue, logDroppedState,' +
    ' LOG_BATCH_MAX, LOG_FLUSH_MS, LOG_PACKET_BYTES, LOG_QUEUE_MAX,' +
    ' readLocalDebugSwitch, persistLocalDebugSwitch, sendLogBatch, reconcileLogSwitch, setLogSwitch };'
  )
  return factory(opts.host, opts.timer, opts.localStorage, opts.broadcastLogSwitch)
}

async function main() {
  // ---- 默认关闭：空本地存储载入，信息与调试不允许，错误与告警允许 ----
  {
    const mod = loadLog({ localStorage: makeLocalStorage(), timer: makeTimer() })
    check(mod.isEnabled('error') === true, '关闭时错误仍允许（error 始终落盘）')
    check(mod.isEnabled('warn') === true, '关闭时告警仍允许（warn 始终落盘）')
    check(mod.isEnabled('info') === false, '关闭时信息不允许（默认关闭）')
    check(mod.isEnabled('debug') === false, '关闭时调试不允许（默认关闭）')
    check(mod.logSwitch.enabled === false && mod.logSwitch.sampleRate === 1, '开关内存默认 { enabled 关闭, sampleRate 1 }')
  }

  // ---- 启动本地秒显：本地已开，载入即开，不等宿主 ----
  {
    const ls = makeLocalStorage({ 'dsws.debug': JSON.stringify({ enabled: true, sampleRate: 0.5, rev: 1 }) })
    const mod = loadLog({ localStorage: ls, timer: makeTimer() })
    check(mod.isEnabled('info') === true, '本地已开则秒显为开（启动先读本地）')
    check(mod.logSwitch.sampleRate === 0.5, '本地采样率秒显读回（0.5）')
  }

  // ---- 关闭时零调用：不进队列、不排定时器、不计数 ----
  {
    const timer = makeTimer()
    const mod = loadLog({ localStorage: makeLocalStorage(), timer })
    for (let i = 0; i < 5; i++) mod.log('info', 'evt.closed', { n: i })
    for (let i = 0; i < 5; i++) mod.log('debug', 'evt.closed.debug', { n: i })
    check(timer.calls.length === 0, '关闭时记信息与调试不排定时器（零调用）')
    check(mod.logQueue.length === 0, '关闭时记信息与调试不进队列')
    check(mod.getDroppedCount() === 0, '关闭时丢弃计数保持零（直接返回不算丢弃）')
  }

  // ---- 对账 winner 为宿主：本地开、宿主关，对账后关并落本地 ----
  {
    const ls = makeLocalStorage({ 'dsws.debug': JSON.stringify({ enabled: true, sampleRate: 1, rev: 1 }) })
    let broadcast = 0
    const host = { call(name) { return Promise.resolve({ ok: true, enabled: false, sampleRate: 1 }) } }
    const mod = loadLog({ localStorage: ls, timer: makeTimer(), host, broadcastLogSwitch() { broadcast += 1 } })
    check(mod.isEnabled('info') === true, '对账前读本地（秒显为开）')
    const res = await mod.reconcileLogSwitch()
    check(res.ok === true && mod.logSwitch.enabled === false, '对账后以宿主为准（本地开、宿主关则关）')
    check(JSON.parse(ls._map.get('dsws.debug')).enabled === false, '对账后本地持久化跟宿主走')
    check(broadcast === 1, '对账成功向全组广播一次（broadcastLogSwitch）')
    check(mod.isEnabled('info') === false, '对账后调用处判断同步变关（对账前不产调试日志）')
  }

  // ---- 对账失败保持本地：宿主不可用，不回退为开启 ----
  {
    const ls = makeLocalStorage({ 'dsws.debug': JSON.stringify({ enabled: true, sampleRate: 1, rev: 1 }) })
    const mod = loadLog({ localStorage: ls, timer: makeTimer(), host: { call() { return Promise.reject(new Error('断线')) } } })
    const res = await mod.reconcileLogSwitch()
    check(res.ok === false && mod.logSwitch.enabled === true, '转发失败保持本地值（仍开，不回退）')
    const mod2 = loadLog({ localStorage: makeLocalStorage(), timer: makeTimer() })
    const res2 = await mod2.reconcileLogSwitch()
    check(res2.ok === false && mod2.logSwitch.enabled === false, '无宿主时保持本地关（不回退为开启）')
  }

  // ---- 设置保存：宿主生效才更新本地并广播；失败保持旧值 ----
  {
    const ls = makeLocalStorage()
    let broadcast = 0
    let seen = null
    const host = { call(name, args) { seen = { name, args }; return Promise.resolve({ ok: true, enabled: true }) } }
    const mod = loadLog({ localStorage: ls, timer: makeTimer(), host, broadcastLogSwitch() { broadcast += 1 } })
    const res = await mod.setLogSwitch(true, 0.5)
    check(seen && seen.name === 'wf.logSetSwitch' && seen.args.enabled === true, '设置经 wf.logSetSwitch 下发（enabled、sampleRate 同形）')
    check(res.ok === true && mod.logSwitch.enabled === true, '宿主生效后内存更新为开')
    check(JSON.parse(ls._map.get('dsws.debug')).enabled === true, '宿主生效后本地持久化更新')
    check(broadcast === 1, '设置成功向全组广播一次')
    const badHost = { call() { return Promise.resolve({ ok: false }) } }
    const mod2 = loadLog({ localStorage: makeLocalStorage(), timer: makeTimer(), host: badHost })
    const res2 = await mod2.setLogSwitch(true, 1)
    check(res2.ok === false && mod2.logSwitch.enabled === false, '宿主未生效保持本地旧值（关）并返回失败')
  }

  // ---- 批量语义：120 条一次只发 50 条，队列封顶 100 条，多余记丢弃 ----
  {
    const seen = []
    const host = { call(name, args) { seen.push(args); return Promise.resolve({ ok: true, accepted: args.entries.length, dropped: 0 }) } }
    const mod = loadLog({ localStorage: makeLocalStorage(), timer: makeTimer(), host })
    mod.logSwitch.enabled = true
    for (let i = 0; i < 120; i++) mod.log('info', 'evt-' + i, { n: i })
    check(mod.logQueue.length === 100, '队列 100 条封顶（120 条进 100 条）')
    check(mod.getDroppedCount() === 20, '超队列 20 条记丢弃（实得 ' + mod.getDroppedCount() + '）')
    await mod.sendLogBatch()
    check(seen.length === 1 && seen[0].entries.length === 50, '一次转发最多 50 条（实发 ' + (seen[0] ? seen[0].entries.length : -1) + ' 条）')
    check(typeof seen[0].droppedCount === 'number', '转发带客户端累计丢弃数 droppedCount')
    check(mod.logQueue.length === 50, '发完 50 条队列剩 50 条（100 减 50）')
  }

  // ---- 直通与定时：错误立刻排（0 毫秒），普通走 1000 毫秒；转发失败整批记丢弃 ----
  {
    const timer = makeTimer()
    const host = { call() { return Promise.resolve({ ok: true, accepted: 1, dropped: 0 }) } }
    const mod = loadLog({ localStorage: makeLocalStorage(), timer, host })
    mod.log('error', 'boom', { reason: 'test' })
    check(timer.calls[timer.calls.length - 1] === 0, '错误走直通（本轮事件循环末就发）')
    mod.logSwitch.enabled = true
    mod.log('info', 'normal', {})
    check(timer.calls[timer.calls.length - 1] === 1000, '普通走 1000 毫秒批量')
    const failMod = loadLog({ localStorage: makeLocalStorage(), timer: makeTimer(), host: { call() { return Promise.reject(new Error('断线')) } } })
    failMod.logSwitch.enabled = true
    failMod.log('info', 'lost', {})
    const before = failMod.getDroppedCount()
    await failMod.sendLogBatch()
    check(failMod.getDroppedCount() - before === 1, '转发失败整批记丢弃（不抛错、不等待）')
    const flushRes = mod.flush()
    check(flushRes && flushRes.ok === true, 'flush 返回成功形状（客户端只管转发）')
  }

  // ---- 双产物：开发产物与打包产物同时含新电话名与新函数名 ----
  {
    const devPath = path.join(ROOT, 'client.js')
    const pkgPath = path.join(ROOT, 'package', 'lib', 'client.js')
    check(fs.existsSync(devPath), '开发产物存在（client.js，由构建生成）')
    check(fs.existsSync(pkgPath), '打包产物存在（package/lib/client.js，由构建生成）')
    const stale = []
    for (const s of ['src/client/kernel/log.js', 'src/client/kernel/probe-snapshot.js', 'src/client/panelAssembly.js', 'src/client/index.js', 'scripts/build.mjs']) {
      if (fs.existsSync(path.join(ROOT, s)) && fs.existsSync(devPath) && fs.statSync(path.join(ROOT, s)).mtimeMs > fs.statSync(devPath).mtimeMs + 1000) stale.push(s)
    }
    check(stale.length === 0, '产物新鲜（' + (stale.length ? '过期：' + stale.join('、') + '，请重跑 node scripts/build.mjs' : '已同步') + '）')
    if (fs.existsSync(devPath) && fs.existsSync(pkgPath)) {
      const dev = fs.readFileSync(devPath, 'utf8')
      const pkg = fs.readFileSync(pkgPath, 'utf8')
      for (const name of ['dsws.debug', 'wf.logBatch', 'wf.logGetSwitch', 'wf.logSetSwitch', 'broadcastLogSwitch', 'reconcileLogSwitch']) {
        check(dev.includes(name), '开发产物含 ' + name)
        check(pkg.includes(name), '打包产物含 ' + name)
      }
      check(!dev.includes('kernel:log (spliced by build)'), '开发产物无拼接标记残留（log 模块已拼入）')
    }
  }

  console.log(failed ? '\n存在失败' : '\n全部通过（' + total + ' checks）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log('  FAIL 门禁执行异常：' + (e && e.message ? e.message : String(e)))
  process.exit(1)
})
