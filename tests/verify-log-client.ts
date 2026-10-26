// verify-log-client.ts —— #490 client 日志底座门禁（设计 #335 第 1、4 章映射到 client 的断言）。
// 用法：node tests/verify-log-client.ts（在插件根目录；先运行 node scripts/build.mts 生成产物）。
// 覆盖 3 组：开关持久化（名字空间 dsws.debug.<插件标识>、默认关闭、不动旧键）、
//   对账（启动本地秒显、宿主为准、失败保持本地不回退开启）、广播（沿 broadcastCfg 同构）。
// 行为口径由包内日志库保证：手写文件已删（旧 src/client/kernel/log.js 不在盘上），
//   不再按手写文件查行数与字面；统一接口、批量口径、电话名都以 dsh-log/client 包内常量与
//   工厂返回对象的同一组接口（isEnabled/log/flush/getDroppedCount）为准；缺插件标识或前缀
//   当场抛中文错的早失败哨兵由 main 开头一组断言直接核。
// 外加双产物含新电话名；开关变更广播那半（broadcastLogSwitch 在 snapshot 文件）保持不动。
const fs = require('fs')
const path = require('path')
// 快照文件的 broadcastLogSwitch 断言仍按文本读源，走统一取源入口（#1207 立的规矩）。
const { sourcePath } = require('./lib/source-text.ts')
// 产物新鲜度判据全仓只有一份：scripts/lib/build-cache.mts 的 judgeProducts（#1326）。缓存可用时比内容摘要；
// 缓存不可用时回落按修改时间判断，原因用 INFO 行打出来（判绿也打，不静默），失败文案直接用判据给的原因。
const { judgeProducts } = require('../scripts/lib/build-cache.mts')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('client 日志底座门禁（#490：开关持久化、对账 winner 为宿主、广播同构）')

const PROBE_SRC = path.join(ROOT, sourcePath('src/refresh/rooms/client/snapshot-sync.js'))

// 行为断言全部走包内日志库（dsh-log/client）：手写文件已删，不再读手写源。
// dsh-log 是 ESM 包、这里是 CJS 门禁，动态 import 放在 main 开头赋值，下面先声明。
let createClientLog = null
let LOG_BATCH_MAX = 0
let LOG_FLUSH_MS = 0
let LOG_PACKET_BYTES = 0
let LOG_QUEUE_MAX = 0
let LOG_DEBUG_KEY = ''
let debugStorageKey = null
let buildClientPhoneNames = null

// ---- 底座自检：手写文件已删，口径由包内常量与早失败哨兵保证 ----
// 这一组原来是读手写源的静态断言（不超 350 行、export 正则、LOG_BATCH_MAX 字面、
// JSON.stringify 只两处、dsws.debug 键形状）：手写文件已删（旧 src/client/kernel/log.js
// 不在盘上），整组删掉，不硬改成去查派生 bundle（bundle 是生成物，行数与写法无意义）。
// 同一设计数字改由 main 开头的包内常量断言（包是唯一真源），接口改由工厂返回对象在运行时断言。
const probeSrc = fs.readFileSync(PROBE_SRC, 'utf8')
check(/export\s+const\s+broadcastLogSwitch\b/.test(probeSrc), '开关变更广播函数 broadcastLogSwitch 在 probe-snapshot.js')
check(probeSrc.includes('applyTo(shared)') && probeSrc.includes('Object.keys(stores)'), '广播沿 broadcastCfg 同构（共享与全组逐个走访发出）')

// ---- 运行夹具：包内工厂配假宿主与假存储，插件配置固定 wf ----
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
function loadPkgLog(options) {
  const opts = options || {}
  // 包内工厂：调用方传宿主、计时器、存储、开关广播四个依赖与 wf 插件配置，拿回独立日志器。
  return createClientLog({
    host: opts.host || null,
    timer: opts.timer || makeTimer(),
    localStorage: opts.localStorage || makeLocalStorage(),
    broadcastLogSwitch: opts.broadcastLogSwitch || null,
  }, { pluginId: 'wf', prefix: 'wf' })
}

async function main() {
  // 行为断言全部走包内日志库（dsh-log/client）：手写文件已删，不再读手写源。
  // CJS 门禁引用 ESM 包走动态 import；失败会抛到 main 末尾的 catch 报红。
  ;({ createClientLog, LOG_BATCH_MAX, LOG_FLUSH_MS, LOG_PACKET_BYTES, LOG_QUEUE_MAX,
    LOG_DEBUG_KEY, debugStorageKey, buildClientPhoneNames } = await import('dsh-log/client'))
  // 包内常量即设计口径（包是唯一真源，不在门禁里写第二份数字）。
  check(LOG_BATCH_MAX === 50, '包内批量口径：每批最多 50 条（设计 2.5）')
  check(LOG_FLUSH_MS === 1000, '包内发批间隔 1000 毫秒（设计 2.5）')
  check(LOG_PACKET_BYTES === 131072, '包内单包 128KB 上限（设计 2.5）')
  check(LOG_QUEUE_MAX === 100, '包内队列 100 条封顶（先到先截，不无界缓冲）')
  check(LOG_DEBUG_KEY === 'dsws.debug', '包内本地开关以前缀 dsws.debug 派生名字空间')
  check(debugStorageKey('wf') === 'dsws.debug.wf', 'wf 插件实际存储键为 dsws.debug.wf（旧单键不再共用）')
  check(JSON.stringify(buildClientPhoneNames('wf')) === JSON.stringify({ logBatch: 'wf.logBatch', logExport: 'wf.logExport', logClear: 'wf.logClear', logGetSwitch: 'wf.logGetSwitch', logSetSwitch: 'wf.logSetSwitch' }), '包内电话名拼法与现状一字不差（前缀加点加动作名）')
  for (const name of ['isEnabled', 'log', 'flush', 'getDroppedCount']) {
    check(typeof createClientLog({ localStorage: makeLocalStorage(), timer: makeTimer() }, { pluginId: 'wf', prefix: 'wf' })[name] === 'function', '包内客户端返回对象含接口 ' + name)
  }
  // 早失败哨兵：缺插件标识或前缀，建库当场抛包内中文错，不等到落盘才静默丢数据。
  for (const bad of [undefined, { prefix: 'wf' }, { pluginId: 'wf' }]) {
    let threw = false
    try { createClientLog({ localStorage: makeLocalStorage(), timer: makeTimer() }, bad) } catch (e) { threw = /dsh-log/.test(String((e && e.message) || e)) }
    check(threw, '缺配置当场抛包内中文错（入参 ' + JSON.stringify(bad) + '）')
  }
  // ---- 默认关闭：空本地存储载入，信息与调试不允许，错误与告警允许 ----
  {
    const mod = loadPkgLog({ localStorage: makeLocalStorage(), timer: makeTimer() })
    check(mod.isEnabled('error') === true, '关闭时错误仍允许（error 始终落盘）')
    check(mod.isEnabled('warn') === true, '关闭时告警仍允许（warn 始终落盘）')
    check(mod.isEnabled('info') === false, '关闭时信息不允许（默认关闭）')
    check(mod.isEnabled('debug') === false, '关闭时调试不允许（默认关闭）')
    check(mod.logSwitch.enabled === false, '开关内存默认关闭')
  }

  // ---- 启动本地秒显：本地已开，载入即开，不等宿主 ----
  {
    const ls = makeLocalStorage({ [debugStorageKey('wf')]: JSON.stringify({ enabled: true, rev: 1 }) })
    const mod = loadPkgLog({ localStorage: ls, timer: makeTimer() })
    check(mod.isEnabled('info') === true, '本地已开则秒显为开（启动先读本地）')
    check(mod.readLocalDebugSwitch().enabled === true, '本地开关读回为开（秒显与持久化同键）')
  }

  // ---- 关闭时零调用：不进队列、不排定时器、不计数 ----
  {
    const timer = makeTimer()
    const mod = loadPkgLog({ localStorage: makeLocalStorage(), timer })
    for (let i = 0; i < 5; i++) mod.log('info', 'evt.closed', { n: i })
    for (let i = 0; i < 5; i++) mod.log('debug', 'evt.closed.debug', { n: i })
    check(timer.calls.length === 0, '关闭时记信息与调试不排定时器（零调用）')
    check(mod.logQueue.length === 0, '关闭时记信息与调试不进队列')
    check(mod.getDroppedCount() === 0, '关闭时丢弃计数保持零（直接返回不算丢弃）')
  }

  // ---- 对账 winner 为宿主：本地开、宿主关，对账后关并落本地 ----
  {
    const ls = makeLocalStorage({ [debugStorageKey('wf')]: JSON.stringify({ enabled: true, rev: 1 }) })
    let broadcast = 0
    let seenName = null
    const host = { call(name) { seenName = name; return Promise.resolve({ ok: true, enabled: false }) } }
    const mod = loadPkgLog({ localStorage: ls, timer: makeTimer(), host, broadcastLogSwitch() { broadcast += 1 } })
    check(mod.isEnabled('info') === true, '对账前读本地（秒显为开）')
    const res = await mod.reconcileLogSwitch()
    check(res.ok === true && mod.logSwitch.enabled === false, '对账后以宿主为准（本地开、宿主关则关）')
    check(JSON.parse(ls._map.get(debugStorageKey('wf'))).enabled === false, '对账后本地持久化跟宿主走')
    check(seenName === 'wf.logGetSwitch', '对账经宿主开关读电话 wf.logGetSwitch')
    check(broadcast === 1, '对账成功向全组广播一次（broadcastLogSwitch）')
    check(mod.isEnabled('info') === false, '对账后调用处判断同步变关（对账前不产调试日志）')
  }

  // ---- 对账失败保持本地：宿主不可用，不回退为开启 ----
  {
    const ls = makeLocalStorage({ [debugStorageKey('wf')]: JSON.stringify({ enabled: true, rev: 1 }) })
    const mod = loadPkgLog({ localStorage: ls, timer: makeTimer(), host: { call() { return Promise.reject(new Error('断线')) } } })
    const res = await mod.reconcileLogSwitch()
    check(res.ok === false && mod.logSwitch.enabled === true, '转发失败保持本地值（仍开，不回退）')
    const mod2 = loadPkgLog({ localStorage: makeLocalStorage(), timer: makeTimer() })
    const res2 = await mod2.reconcileLogSwitch()
    check(res2.ok === false && mod2.logSwitch.enabled === false, '无宿主时保持本地关（不回退为开启）')
  }

  // ---- 设置保存：宿主生效才更新本地并广播；失败保持旧值 ----
  {
    const ls = makeLocalStorage()
    let broadcast = 0
    let seen = null
    const host = { call(name, args) { seen = { name, args }; return Promise.resolve({ ok: true, enabled: true }) } }
    const mod = loadPkgLog({ localStorage: ls, timer: makeTimer(), host, broadcastLogSwitch() { broadcast += 1 } })
    const res = await mod.setLogSwitch(true)
    check(seen && seen.name === 'wf.logSetSwitch' && seen.args.enabled === true, '设置经 wf.logSetSwitch 下发（enabled 同形）')
    check(res.ok === true && mod.logSwitch.enabled === true, '宿主生效后内存更新为开')
    check(JSON.parse(ls._map.get(debugStorageKey('wf'))).enabled === true, '宿主生效后本地持久化更新')
    check(broadcast === 1, '设置成功向全组广播一次')
    const badHost = { call() { return Promise.resolve({ ok: false }) } }
    const mod2 = loadPkgLog({ localStorage: makeLocalStorage(), timer: makeTimer(), host: badHost })
    const res2 = await mod2.setLogSwitch(true)
    check(res2.ok === false && mod2.logSwitch.enabled === false, '宿主未生效保持本地旧值（关）并返回失败')
  }

  // ---- 批量语义：120 条一次只发 50 条，队列封顶 100 条，多余记丢弃；落定后记一行转发汇总 ----
  {
    const seen = []
    const host = { call(name, args) { seen.push(args); return Promise.resolve({ ok: true, accepted: args.entries.length, dropped: 0 }) } }
    const mod = loadPkgLog({ localStorage: makeLocalStorage(), timer: makeTimer(), host })
    mod.logSwitch.enabled = true
    for (let i = 0; i < 120; i++) mod.log('info', 'evt-' + i, { n: i })
    check(mod.logQueue.length === 100, '队列 100 条封顶（120 条进 100 条）')
    check(mod.getDroppedCount() === 20, '超队列 20 条记丢弃（实得 ' + mod.getDroppedCount() + '）')
    await mod.sendLogBatch()
    check(seen.length === 1 && seen[0].entries.length === 50, '一次转发最多 50 条（实发 ' + (seen[0] ? seen[0].entries.length : -1) + ' 条）')
    check(typeof seen[0].droppedCount === 'number', '转发带客户端累计丢弃数 droppedCount')
    const summary = mod.logQueue[mod.logQueue.length - 1]
    check(summary.level === 'warn' && summary.event === 'log.forward.summary', '汇总行为告警级且事件名为 log.forward.summary')
    check(summary.fields.droppedDelta === 20 && summary.fields.totalDropped === 20, '汇总行带新增数 20 与累计数 20')
    check(summary.fields.reason === 'queue-full' && typeof summary.fields.windowMs === 'number', '汇总行带原因 queue-full 与窗口毫秒')
    check(mod.logQueue.length === 51, '发完 50 条剩 50 条未发加 1 行转发汇总')
  }

  // ---- 直通与定时：错误立刻排（0 毫秒），普通走中央发批间隔；转发失败整批记丢弃 ----
  {
    const timer = makeTimer()
    const host = { call() { return Promise.resolve({ ok: true, accepted: 1, dropped: 0 }) } }
    const mod = loadPkgLog({ localStorage: makeLocalStorage(), timer, host })
    mod.log('error', 'boom', { reason: 'test' })
    check(timer.calls[timer.calls.length - 1] === 0, '错误走直通（本轮事件循环末就发）')
    mod.logSwitch.enabled = true
    mod.log('info', 'normal', {})
    check(timer.calls[timer.calls.length - 1] === LOG_FLUSH_MS, '普通走发批间隔批量（与包内常量同值 ' + LOG_FLUSH_MS + '）')
    const failMod = loadPkgLog({ localStorage: makeLocalStorage(), timer: makeTimer(), host: { call() { return Promise.reject(new Error('断线')) } } })
    failMod.logSwitch.enabled = true
    failMod.log('info', 'lost', {})
    const before = failMod.getDroppedCount()
    // 包内语义（错误永不丢）：转发失败先入有界重试位，不抛错、不立刻记丢弃。
    let sendThrew = false
    let sendRes = null
    try { sendRes = await failMod.sendLogBatch() } catch (e) { sendThrew = true }
    check(sendThrew === false && sendRes && sendRes.ok === false, '转发失败不抛错、返回失败形状（不等待）')
    check(failMod.getDroppedCount() - before === 0, '转发失败不立刻记丢弃（行入有界重试位，错误永不丢）')
    const flushRes = mod.flush()
    check(flushRes && flushRes.ok === true, 'flush 返回成功形状（客户端只管转发）')
  }

  // ---- 双产物：开发产物与打包产物同时含新电话名与新函数名 ----
  {
    const devPath = path.join(ROOT, 'client.js')
    const pkgPath = path.join(ROOT, 'package', 'lib', 'client.js')
    check(fs.existsSync(devPath), '开发产物存在（client.js，由构建生成）')
    check(fs.existsSync(pkgPath), '打包产物存在（package/lib/client.js，由构建生成）')
    // 产物新鲜度判据全仓只有一份（scripts/lib/build-cache.mts 的 judgeProducts，#1326）：缓存可用时比内容摘要，
    // 不可用时回落按修改时间判断，原因用 INFO 行打出来；这里只查开发产物，覆盖面与原先一样。
    const judged = judgeProducts({
      products: ['client.js'],
      sources: ['scripts/generated/logKernel.derived.js', 'src/refresh/rooms/client/snapshot-sync.ts', 'src/client/panelAssembly.ts', 'src/client/index.ts', 'scripts/build.mts'],
    })
    judged.notices.forEach((n) => console.log('  INFO ' + n))
    const judgedDev = judged.products[0]
    check(judgedDev.freshness === 'fresh', '产物新鲜（' + (judgedDev.freshness === 'fresh' ? '已同步' : judgedDev.reason) + '）')
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
