// verify-log-store.ts —— #490 host 日志底座门禁（设计 #335 第 4.3 节映射到 host 的断言先行；#1143 起唯一真相是 dsh-log 包）。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-log-store.ts（在插件根目录）。
// 覆盖 5 项：关闭时零调用、串行写盘不丢行、按天命名、失败进重试可查、双产物含 5 个电话名。
// 外加 2 项包自检：防抖值 1000 毫秒（取包 export 常量，不读源码字面）、包电话名映射与真源登记一致。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

console.log('host 日志底座门禁（#490：关闭零调用、串行不丢行、按天命名、失败进重试可查、双产物含电话名；#1143 起测 dsh-log 包）')

// 内存文件服务夹具：行为与宿主文件服务同形（resolve 给目标对象，readText/writeText 按目标读写）。
function makeMemoryFiles() {
  return { texts: new Map(), writes: 0, failWrites: false }
}
function makeFs(mem) {
  return {
    async resolve(p) { return { __target: String(p) } },
    async readText(t) {
      const key = t && t.__target ? t.__target : String(t)
      if (!mem.texts.has(key)) throw new Error('文件不存在：' + key)
      return mem.texts.get(key)
    },
    async writeText(t, text) {
      mem.writes += 1
      if (mem.failWrites) throw new Error('模拟写盘失败')
      mem.texts.set(t && t.__target ? t.__target : String(t), String(text))
    }
  }
}
function makePlatform() {
  return {
    os: 'test-os',
    path: { join(...parts) { return parts.join('/').replace(/\/+/g, '/') } },
    fs: {
      async resolve(p) { return { __target: String(p) } },
      async mkdir() {},
      async listDir() { return [] }
    }
  }
}
// 计时器夹具：与宿主计时器同形（timeout(函数, 毫秒) 返回句柄；timeout(毫秒) 返回承诺）。
function makeTimer() {
  const calls = []
  const timeout = (fn, ms) => {
    if (typeof fn === 'number') return new Promise((resolve) => setTimeout(() => resolve({ exitCode: -1 }), fn))
    calls.push(ms)
    return setTimeout(fn, ms)
  }
  return { timeout, calls }
}
function makeStore(mem, cacheDir, extra) {
  const timer = makeTimer()
  const deps = Object.assign({ fs: makeFs(mem), timer, getCacheDir: async () => cacheDir, getPlatform: async () => makePlatform(), DEFAULT_CWD: '/work' }, extra || {})
  return { timer, deps }
}

async function main() {
  // #1143 起旧实现三件套已删（src/host/logStore.ts 不存在），唯一真相是 dsh-log 包：直接测包的宿主入口。
  let mod
  try {
    mod = await import('dsh-log/host')
  } catch (e) {
    check(false, '日志库可被动态加载（dsh-log/host 包宿主入口）：' + e.message)
    console.log(failed ? '\n存在失败' : '\n全部通过')
    process.exit(1)
  }
  // 包 createLogStore(deps, config)：config 决定日志名前缀，调用处统一传 {pluginId:'wf',prefix:'wf'}。
  const { createLogStore, formatLogFileName, LOG_DEBOUNCE_MS, createHostLog } = mod
  check(typeof createLogStore === 'function', '日志包导出工厂函数 createLogStore（dsh-log/host）')
  check(typeof formatLogFileName === 'function', '日志包导出按天文件名函数 formatLogFileName（dsh-log/host）')
  check(typeof createHostLog === 'function', '日志包导出宿主建库函数 createHostLog（电话名断言经它）')

  // ---- 包常量自检（#1143 起旧实现已删，不再读已删文件凑字面）----
  // 删掉了对 src/host/logStore.ts 与 src/host/logPhones.ts 的文件读取：两份文件已删，行数门与源码字面门无对象可量。
  // 防抖值不断言源码字面：真源是包 export 的 LOG_DEBOUNCE_MS 常量本身，不读包文件文本凑字面。
  check(LOG_DEBOUNCE_MS === 1000, '防抖窗口为 1000 毫秒（设计 2.2 字面，取包 export 的 LOG_DEBOUNCE_MS）')
  // LOG_SWITCH_FILE 不再断言不存在：包里为兼容仍有导出（值为旧字面），开关无第二份文件的行为由 single-source 门禁守。
  // 删掉的首行正则与 host.start 字面：旧实现源码已删，级别兜底与启动头由下面的行为节直接验（零调用节验 isEnabled 兜底，497 节调 writeStartupHeader）。
  // 删掉的 getDroppedCount 字面：改由行为节直接调用 store.getDroppedCount 验证提供性。
  check(/^\d{4}-\d{2}-\d{2}\.log$/.test(formatLogFileName(new Date(2026, 8, 6))), '按天命名示例：2026 年 9 月 6 日得 2026-09-06.log（设计 2.1）')

  // ---- 电话名字面（设计 2.5 冻结，一字不差）----
  const phones = ['wf.logBatch', 'wf.logExport', 'wf.logClear', 'wf.logGetSwitch', 'wf.logSetSwitch']
  const indexSrc = fs.readFileSync(path.join(ROOT, 'src', 'host', 'index.ts'), 'utf8')
  for (const name of phones) {
    check(indexSrc.includes("harness.handle('" + name + "'"), '真源登记电话 ' + name)
  }
  // 包电话名断言（dsh-log/host 的 createHostLog 返回 {store, phoneNames}，名前缀由配置 prefix 决定）。
  {
    const mem0 = makeMemoryFiles()
    const made0 = makeStore(mem0, '/cache')
    const holder0 = createHostLog(made0.deps, { pluginId: 'wf', prefix: 'wf' })
    for (const name of phones) {
      const action = name.replace(/^wf\./, '')
      check(holder0.phoneNames[action] === name, '包电话名映射含 ' + name)
    }
  }

  // ---- 关闭时零调用：info 与 debug 不进队列、不排定时器、不写盘、不计数 ----
  {
    const mem = makeMemoryFiles()
    const { timer, deps } = makeStore(mem, '/cache')
    const store = createLogStore(deps, { pluginId: 'wf', prefix: 'wf' })
    check(store.isEnabled('error') === true, '关闭时错误仍允许（error 始终落盘）')
    check(store.isEnabled('warn') === true, '关闭时告警仍允许（warn 始终落盘）')
    check(store.isEnabled('info') === false, '关闭时信息不允许（info 等开关）')
    check(store.isEnabled('debug') === false, '关闭时调试不允许（debug 等开关）')
    // 包 store 亲手验过方法表：有 getSwitchState，直接用（没有才用 isEnabled 等价行为替代）。
    const state = store.getSwitchState()
    check(state.enabled === false, '宿主开关默认关闭（设计 1.3）')
    const timerBefore = timer.calls.length
    const writesBefore = mem.writes
    for (let i = 0; i < 5; i++) store.log('info', 'evt.closed', { n: i })
    for (let i = 0; i < 5; i++) store.log('debug', 'evt.closed.debug', { n: i })
    check(timer.calls.length === timerBefore, '关闭时记信息与调试不排定时器（零调用）')
    store.flush()
    await wait(60)
    check(mem.writes === writesBefore, '关闭时记信息与调试不写盘（零写盘）')
    check(store.getDroppedCount() === 0, '关闭时丢弃计数保持零（直接返回不算丢弃）')
  }

  // ---- 串行写盘不丢行：20 行按序全部落盘 ----
  {
    const mem = makeMemoryFiles()
    const { deps } = makeStore(mem, '/cache')
    const store = createLogStore(deps, { pluginId: 'wf', prefix: 'wf' })
    await store.setSwitch(true, 1)
    const total_lines = 20
    for (let i = 0; i < total_lines; i++) store.log('info', 'evt-' + i, { n: i })
    store.flush()
    await wait(80)
    const today = formatLogFileName(new Date())
    const keys = Array.from(mem.texts.keys()).filter((k) => k.endsWith('/' + today))
    check(keys.length === 1, '串行写盘落到当天文件（' + today + '）')
    const body = keys.length ? String(mem.texts.get(keys[0]) || '') : ''
    const rows = body.split('\n').filter(Boolean)
    check(rows.length === total_lines, '串行 ' + total_lines + ' 行不丢行（实得 ' + rows.length + ' 行）')
    let ordered = rows.length === total_lines
    for (let i = 0; i < rows.length && ordered; i++) {
      try {
        const parsed = JSON.parse(rows[i])
        if (parsed.event !== 'evt-' + i || parsed.level !== 'info') ordered = false
      } catch (e) { ordered = false }
    }
    check(ordered, '串行写入保持调用顺序（evt-0 到 evt-19）')
  }

  // ---- 错误直通：关闭时 error 仍落盘且走直通（不等 1000 毫秒批量）----
  {
    const mem = makeMemoryFiles()
    const { timer, deps } = makeStore(mem, '/cache')
    const store = createLogStore(deps, { pluginId: 'wf', prefix: 'wf' })
    store.log('error', 'boom', { reason: 'test' })
    const lastCall = timer.calls[timer.calls.length - 1]
    check(lastCall === 0, '错误走直通刷盘（取消防抖等待，本轮事件循环末就写）')
    await wait(60)
    const today = formatLogFileName(new Date())
    const keys = Array.from(mem.texts.keys()).filter((k) => k.endsWith('/' + today))
    const body = keys.length ? String(mem.texts.get(keys[0]) || '') : ''
    check(body.includes('boom'), '关闭时错误仍落盘（崩溃窗口只剩毫秒级）')
    // 记录电话回参形状：接收条数加宿主侧累计丢弃数，调用处不等写盘完成。
    // 包如实计数（开关关着时 info 记 skipped 不记 accepted）：先打开开关再验 accepted，旧“关着也收 1 条”口径已随包更新。
    await store.setSwitch(true, 1)
    const batchRes = await store.handleLogBatch({ entries: [{ level: 'info', event: 'a', fields: {} }], droppedCount: 7 })
    check(batchRes && batchRes.ok === true && batchRes.accepted === 1 && typeof batchRes.dropped === 'number', '记录电话回参与设计 2.5 同形（ok、accepted、dropped）')
    const exportRes = await store.handleLogExport({})
    check(exportRes && exportRes.ok === true && typeof exportRes.fileName === 'string' && typeof exportRes.bytes === 'number' && exportRes.fallback === true, '导出电话回参与设计 2.5 同形（ok、fileName、bytes、fallback）')
    check(exportRes && typeof exportRes.dir === 'string' && exportRes.dir.length > 0, '497 真修：导出回包 dir 为非空字符串（目标对象已拆盒，不再发对象）')
    check(exportRes && typeof exportRes.path === 'string' && exportRes.path.length > 0, '497 真修：导出回包 path 为非空字符串（目标对象已拆盒，不再发对象）')
    const clearRes = await store.handleLogClear({ date: '2026-09-06' })
    check(clearRes && typeof clearRes.removed === 'number', '清空电话回参与设计 2.5 同形（ok、removed）')
    const getRes = await store.handleLogGetSwitch()
    check(getRes && getRes.ok === true && typeof getRes.enabled === 'boolean', '开关读电话回参与设计 2.5 同形（ok、enabled；包 0.3.0 起删掉从未生效的 sampleRate 死参数，不再断言它）')
    const setRes = await store.handleLogSetSwitch({ enabled: true, sampleRate: 1 })
    check(setRes && setRes.ok === true && setRes.enabled === true, '开关写电话回参与设计 2.5 同形（ok、enabled 生效值）')
  }

  // ---- 开关重启保持：开关只有一处真源，新实例问同一个来源仍读回打开（#1432）----
  {
    const mem = makeMemoryFiles()
    const truth = { enabled: null }
    const switchSource = { get: async () => truth.enabled, set: async (on) => { truth.enabled = on; return on } }
    const first = makeStore(mem, '/cache', { switchSource })
    const storeA = createLogStore(first.deps, { pluginId: 'wf', prefix: 'wf' })
    await storeA.setSwitch(true, 0.5)
    check(mem.writes === 0, '拨开关不写缓存目录里的文件（#1432：开关只进本机设置文件）')
    const second = makeStore(mem, '/cache', { switchSource })
    const storeB = createLogStore(second.deps, { pluginId: 'wf', prefix: 'wf' })
    const loaded = await storeB.loadSwitch()
    check(loaded.enabled === true, '开关打开后重启保持（新实例问同一个开关来源）')
  }

  // ---- 失败只计数：写盘失败不抛错，累计丢弃数增长 ----
  {
    const mem = makeMemoryFiles()
    mem.failWrites = true
    const { deps } = makeStore(mem, '/cache')
    const store = createLogStore(deps, { pluginId: 'wf', prefix: 'wf' })
    await store.setSwitch(true, 1)
    // 开关不再走文件服务（#1432）；下面三行日志在写盘失败时进重试位、不抛错（包语义：写失败不等于丢行）。
    const before = store.getDroppedCount()
    store.log('info', 'evt-fail-1', {})
    store.log('info', 'evt-fail-2', {})
    store.log('info', 'evt-fail-3', {})
    let threw = false
    try {
      store.flush()
      await wait(150)
    } catch (e) { threw = true }
    check(threw === false, '写盘失败不抛错（失败进重试，不抛）')
    const failState = store.getLastPersistFail()
    check(!!failState && failState.op === 'writeBatch', '写盘失败留可查状态（getLastPersistFail 记 writeBatch，不静默消失）')
    check(store.getPendingCount() > 0, '写盘失败行留重试位（pending 未清零，不静默丢行）')
    const settledAt = store.getDroppedCount()
    await wait(80)
    check(store.getDroppedCount() === settledAt, '全盘皆坏时刷盘链条终止（计数收敛，无新行滋生）')
    check(store.getDroppedCount() - before === 0, '写失败不等于丢行（重试位未满不计 dropped，实增 0，防繁殖）')
  }

  // ---- 497 双空不再无声：取目录返回空时导出回包仍带可用目录并记告警 ----
  {
    const mem = makeMemoryFiles()
    const timer = makeTimer()
    const deps = { fs: makeFs(mem), timer, getCacheDir: async () => '', getPlatform: async () => makePlatform(), DEFAULT_CWD: '/work' }
    const store = createLogStore(deps, { pluginId: 'wf', prefix: 'wf' })
    await store.writeStartupHeader()
    const res = await store.handleLogExport({})
    check(res && res.ok === true, '497 导出回包仍成功（取目录空不翻失败，保持旧形状）')
    check(res && (res.dir || res.path), '497 双空不再无声（成功必带可用目录或路径之一）')
    check(JSON.stringify([(res && res.dir), (res && res.path)]).indexOf('/work') >= 0, '497 兜底用启动已知目录（回包目录含启动目录）')
    // 删掉的源码字面检查（src/host/logStore.ts 与 logPhones.ts 已删）：告警行逻辑已随实现进包，落盘兜底由本节行为断言覆盖。
    check(res && res.fallback === true, '497 取目录空走启动目录兜底（fallback 为真，不翻失败）')
    check(!!(res && res.fileName && /^\d{4}-\d{2}-\d{2}\.log$/.test(res.fileName)), '497 旧回参形状兼容（文件名仍按天命名，只加不减字段）')
  }

  // ---- 497 真修：文件服务回目标对象（{targetKey, displayPath}）时回包仍为字符串 ----
  {
    const mem = makeMemoryFiles()
    const timer = makeTimer()
    const realShape = { os: 'test-os', path: { join(...parts) { return parts.join('/').replace(/\/+/g, '/') } }, fs: { async resolve(p) { return { targetKey: 'key:' + String(p), displayPath: String(p) } }, async mkdir() {}, async listDir() { return [] } } }
    const deps = { fs: makeFs(mem), timer, getCacheDir: async () => '/cache', getPlatform: async () => realShape, DEFAULT_CWD: '/work' }
    const store = createLogStore(deps, { pluginId: 'wf', prefix: 'wf' })
    const res = await store.handleLogExport({})
    check(res && res.ok === true, '497 真修：目标对象形态下导出仍成功（拆盒不翻失败）')
    check(res && typeof res.dir === 'string' && res.dir.indexOf('/cache/logs') >= 0, '497 真修：目标对象拆盒后 dir 为字符串（含缓存日志目录）')
    check(res && typeof res.path === 'string' && res.path.indexOf('.log') >= 0, '497 真修：目标对象拆盒后 path 为字符串（含日志文件名）')
  }

  // ---- 双产物含电话名：真源、开发产物、打包产物三处一致 ----
  {
    const devPath = path.join(ROOT, 'host.js')
    const pkgPath = path.join(ROOT, 'package', 'lib', 'index.js')
    // #1143 起构建不再产出这两份拷贝（package/lib/logStore.js 与 logPhones.js 已删）：删掉副本存在行，电话名内容断言保留。
    check(fs.existsSync(devPath), '开发产物存在（host.js，由构建生成）')
    check(fs.existsSync(pkgPath), '打包产物存在（package/lib/index.js，由构建生成）')
    if (fs.existsSync(devPath) && fs.existsSync(pkgPath)) {
      const dev = fs.readFileSync(devPath, 'utf8')
      const pkg = fs.readFileSync(pkgPath, 'utf8')
      for (const name of phones) {
        check(dev.includes(name), '开发产物含电话名 ' + name)
        check(pkg.includes(name), '打包产物含电话名 ' + name)
      }
    }
  }

  console.log(failed ? '\n存在失败' : '\n全部通过（' + total + ' checks）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log('  FAIL 门禁执行异常：' + (e && e.message ? e.message : String(e)))
  process.exit(1)
})
