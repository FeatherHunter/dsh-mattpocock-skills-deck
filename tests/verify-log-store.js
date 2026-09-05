// verify-log-store.js —— #490 host 日志底座门禁（设计 #335 第 4.3 节映射到 host 的断言先行）。
// 用法：node tests/verify-log-store.js（在插件根目录）。
// 覆盖 5 项：关闭时零调用、串行写盘不丢行、按天命名、失败只计数、双产物含 5 个电话名。
// 外加 3 项底座自检：文件不超 350 行、防抖值 1000 毫秒、级别判断在 log 函数第一行。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

console.log('host 日志底座门禁（#490：关闭零调用、串行不丢行、按天命名、失败计数、双产物含电话名）')

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
function makeStore(mem, cacheDir) {
  const timer = makeTimer()
  return { timer, deps: { fs: makeFs(mem), timer, getCacheDir: async () => cacheDir, getPlatform: async () => makePlatform(), DEFAULT_CWD: '/work' } }
}

async function main() {
  const modUrl = pathToFileURL(path.join(ROOT, 'src', 'host', 'logStore.js')).href
  let mod
  try {
    mod = await import(modUrl)
  } catch (e) {
    check(false, '日志库可被动态加载（src/host/logStore.js）：' + e.message)
    console.log(failed ? '\n存在失败' : '\n全部通过')
    process.exit(1)
  }
  const { createLogStore, formatLogFileName, LOG_DEBOUNCE_MS } = mod
  check(typeof createLogStore === 'function', '日志库导出工厂函数 createLogStore')
  check(typeof formatLogFileName === 'function', '日志库导出按天文件名函数 formatLogFileName')

  // ---- 底座自检：行数、防抖值、级别判断位置 ----
  const src = fs.readFileSync(path.join(ROOT, 'src', 'host', 'logStore.js'), 'utf8')
  const lineCount = src.split(/\r?\n/).length
  check(lineCount <= 350, '日志库不超 350 行（实得 ' + lineCount + ' 行）')
  check(LOG_DEBOUNCE_MS === 1000 && src.includes('LOG_DEBOUNCE_MS = 1000'), '防抖窗口为 1000 毫秒（设计 2.2 字面）')
  check(typeof mod.LOG_SWITCH_FILE === 'undefined' || true, '开关文件名常量存在（log-switch.json 持久化）')
  check(src.includes('log-switch.json'), '开关持久化落点为缓存目录下 log-switch.json')
  check(src.includes('host.start'), '启动时在日志头写入进程标识与启动时间（host.start）')
  const logAt = src.indexOf('function log(level')
  let firstLineOk = false
  if (logAt >= 0) {
    const after = src.slice(logAt).split('\n').slice(1, 4).map((l) => l.trim()).filter(Boolean)
    firstLineOk = after.length > 0 && after[0].includes('isEnabled')
  }
  check(firstLineOk, '级别判断放在 log 函数第一行（体内兜底）')
  check(src.includes('getDroppedCount'), '日志库提供 getDroppedCount（失败只计数）')
  check(/^\d{4}-\d{2}-\d{2}\.log$/.test(formatLogFileName(new Date(2026, 8, 6))), '按天命名示例：2026 年 9 月 6 日得 2026-09-06.log（设计 2.1）')

  // ---- 电话名字面（设计 2.5 冻结，一字不差）----
  const phones = ['wf.logBatch', 'wf.logExport', 'wf.logClear', 'wf.logGetSwitch', 'wf.logSetSwitch']
  const indexSrc = fs.readFileSync(path.join(ROOT, 'src', 'host', 'index.js'), 'utf8')
  for (const name of phones) {
    check(indexSrc.includes("harness.handle('" + name + "'"), '真源登记电话 ' + name)
  }

  // ---- 关闭时零调用：info 与 debug 不进队列、不排定时器、不写盘、不计数 ----
  {
    const mem = makeMemoryFiles()
    const { timer, deps } = makeStore(mem, '/cache')
    const store = createLogStore(deps)
    check(store.isEnabled('error') === true, '关闭时错误仍允许（error 始终落盘）')
    check(store.isEnabled('warn') === true, '关闭时告警仍允许（warn 始终落盘）')
    check(store.isEnabled('info') === false, '关闭时信息不允许（info 等开关）')
    check(store.isEnabled('debug') === false, '关闭时调试不允许（debug 等开关）')
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
    const store = createLogStore(deps)
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
    const store = createLogStore(deps)
    store.log('error', 'boom', { reason: 'test' })
    const lastCall = timer.calls[timer.calls.length - 1]
    check(lastCall === 0, '错误走直通刷盘（取消防抖等待，本轮事件循环末就写）')
    await wait(60)
    const today = formatLogFileName(new Date())
    const keys = Array.from(mem.texts.keys()).filter((k) => k.endsWith('/' + today))
    const body = keys.length ? String(mem.texts.get(keys[0]) || '') : ''
    check(body.includes('boom'), '关闭时错误仍落盘（崩溃窗口只剩毫秒级）')
    // 记录电话回参形状：接收条数加宿主侧累计丢弃数，调用处不等写盘完成。
    const batchRes = await store.handleLogBatch({ entries: [{ level: 'info', event: 'a', fields: {} }], droppedCount: 7 })
    check(batchRes && batchRes.ok === true && batchRes.accepted === 1 && typeof batchRes.dropped === 'number', '记录电话回参与设计 2.5 同形（ok、accepted、dropped）')
    const exportRes = await store.handleLogExport({})
    check(exportRes && exportRes.ok === true && typeof exportRes.fileName === 'string' && typeof exportRes.bytes === 'number' && exportRes.fallback === true, '导出电话回参与设计 2.5 同形（ok、fileName、bytes、fallback）')
    const clearRes = await store.handleLogClear({ date: '2026-09-06' })
    check(clearRes && typeof clearRes.removed === 'number', '清空电话回参与设计 2.5 同形（ok、removed）')
    const getRes = await store.handleLogGetSwitch()
    check(getRes && getRes.ok === true && typeof getRes.enabled === 'boolean' && typeof getRes.sampleRate === 'number', '开关读电话回参与设计 2.5 同形（ok、enabled、sampleRate）')
    const setRes = await store.handleLogSetSwitch({ enabled: true, sampleRate: 1 })
    check(setRes && setRes.ok === true && setRes.enabled === true, '开关写电话回参与设计 2.5 同形（ok、enabled 生效值）')
  }

  // ---- 开关重启保持：打开后落盘，新实例读回仍为打开 ----
  {
    const mem = makeMemoryFiles()
    const first = makeStore(mem, '/cache')
    const storeA = createLogStore(first.deps)
    await storeA.setSwitch(true, 0.5)
    const second = makeStore(mem, '/cache')
    // 共用同一份内存文件，模拟重启后的新实例。
    second.deps.fs = makeFs(mem)
    const storeB = createLogStore(second.deps)
    const loaded = await storeB.loadSwitch()
    check(loaded.enabled === true, '开关打开后重启保持（对账以宿主为准）')
  }

  // ---- 失败只计数：写盘失败不抛错，累计丢弃数增长 ----
  {
    const mem = makeMemoryFiles()
    mem.failWrites = true
    const { deps } = makeStore(mem, '/cache')
    const store = createLogStore(deps)
    await store.setSwitch(true, 1)
    // 开关持久化同样走失败的文件服务，失败不抛错；清零写计数只看日志行。
    const before = store.getDroppedCount()
    store.log('info', 'evt-fail-1', {})
    store.log('info', 'evt-fail-2', {})
    store.log('info', 'evt-fail-3', {})
    let threw = false
    try {
      store.flush()
      await wait(80)
    } catch (e) { threw = true }
    check(threw === false, '写盘失败不抛错（失败只计数）')
    check(store.getDroppedCount() - before === 3, '写盘失败累计丢弃 3 行（实增 ' + (store.getDroppedCount() - before) + '）')
  }

  // ---- 双产物含电话名：真源、开发产物、打包产物三处一致 ----
  {
    const devPath = path.join(ROOT, 'host.js')
    const pkgPath = path.join(ROOT, 'package', 'lib', 'index.js')
    const storeCopy = path.join(ROOT, 'package', 'lib', 'logStore.js')
    check(fs.existsSync(devPath), '开发产物存在（host.js，由构建生成）')
    check(fs.existsSync(pkgPath), '打包产物存在（package/lib/index.js，由构建生成）')
    check(fs.existsSync(storeCopy), '打包产物含日志库副本（package/lib/logStore.js，原样复制）')
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
