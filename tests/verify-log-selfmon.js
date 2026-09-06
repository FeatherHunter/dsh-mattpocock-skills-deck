// verify-log-selfmon.js —— #499 日志管道自监控门禁（附录第 4 节断言九）。
// 用法：在插件根目录执行 node tests/verify-log-selfmon.js，可独立运行。
// 断言文字：46～50 五个事件逐个有点名、级别全为错误与告警、字段全在附录 1.6 白名单内、
// 告警行无外层是否开启判断；看门狗超时字面为 5000 毫秒；落盘失败行带防繁殖守卫。
// 做法：前半静态扫描源码字面，后半运行时复现四类故障（分发抛错只做静态，因完整分发上下文需真机）。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

console.log('日志自监控门禁（#499：五类故障逐类有行，看门狗 5 秒自举证）')

const indexSrc = readSrc(path.join('src', 'host', 'index.js'))
const storeSrc = readSrc(path.join('src', 'host', 'logStore.js'))
const logSrc = readSrc(path.join('src', 'client', 'kernel', 'log.js'))
const menuSrc = readSrc(path.join('src', 'client', 'statusbar', 'StatusLogMenu.js'))
const settingsSrc = readSrc(path.join('src', 'client', 'views', 'SettingsPage.js'))

// 一、五事件逐个有点名（注释不算，只算代码里的加引号事件名）。
{
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
  check(code(indexSrc).includes("'host.dispatch.error'"), '46 分发异常行在宿主分发处有点名')
  check(code(storeSrc).includes("'log.persist.fail'"), '47 落盘失败行在日志库有点名')
  check(code(logSrc).includes("'log.forward.summary'"), '48 转发汇总行在客户端底座有点名')
  check(code(logSrc).includes("'log.switch.watchdog'"), '49 看门狗行在客户端底座有点名')
  check(code(logSrc).includes("'log.export.fail'"), '50 导出链路行在客户端底座有 helper')
  check(code(menuSrc).includes('logExportFail(') && code(settingsSrc).includes('logExportFail('), '50 两处界面（状态栏菜单与设置页）都经 helper 记账')
}

// 二、级别全为错误与告警（自监控行始终落盘，不用信息与调试）。
{
  check(indexSrc.includes("fireLog('error', 'host.dispatch.error'"), '46 取错误级（直通落盘）')
  check(storeSrc.includes("log('warn', 'log.persist.fail'"), '47 取告警级（直通落盘）')
  check(logSrc.includes("log('warn', 'log.forward.summary'"), '48 取告警级（开关关闭时仍可见）')
  check(logSrc.includes("log('warn', 'log.switch.watchdog'"), '49 取告警级（开关关闭时仍可见）')
  check(logSrc.includes("log('warn', 'log.export.fail'"), '50 取告警级（开关关闭时仍可见）')
}

// 三、字段全在附录 1.6 白名单内（发射点对象字面量逐键核对，之外的键一律不许出现）。
{
  const keysAt = (src, event) => {
    const at = src.indexOf("'" + event + "'")
    if (at < 0) return null
    const openAt = src.indexOf('{', at)
    if (openAt < 0 || openAt - at > 120) return null
    let depth = 0
    for (let i = openAt; i < src.length && i < openAt + 400; i++) {
      if (src[i] === '{') depth += 1
      if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(openAt, i + 1) }
    }
    return null
  }
  const keysOf = (seg) => Array.from(seg.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)).map((m) => m[1])
  const want = {
    'host.dispatch.error': ['method', 'argsHash', 'errorKind'],
    'log.persist.fail': ['op', 'reason', 'dirHash'],
    'log.forward.summary': ['droppedDelta', 'totalDropped', 'reason', 'windowMs'],
    'log.switch.watchdog': ['op', 'timeoutMs', 'stage'],
    'log.export.fail': ['op', 'reason', 'errorHash'],
  }
  const hold = {
    'host.dispatch.error': indexSrc, 'log.persist.fail': storeSrc, 'log.forward.summary': logSrc,
    'log.switch.watchdog': logSrc, 'log.export.fail': logSrc,
  }
  for (const name of Object.keys(want)) {
    const seg = keysAt(hold[name], name)
    const actual = seg ? keysOf(seg).sort() : []
    const expected = want[name].slice().sort()
    check(seg !== null && JSON.stringify(actual) === JSON.stringify(expected), '发射点字段 ' + name + '（实得 ' + (actual.join('、') || '无') + '）')
  }
}

// 四、告警行无外层是否开启判断（复用直通口径：warn 行带判断即红）。
{
  const warnLines = []
  const scan = (src, rel) => src.split('\n').forEach((line, i) => {
    if (/['"]warn['"]\s*,\s*['"]log\.(persist\.fail|forward\.summary|switch\.watchdog|export\.fail)['"]/.test(line)) {
      warnLines.push({ rel, i: i + 1, guarded: /isEnabled\s*\(/.test(line) })
    }
  })
  scan(storeSrc, 'logStore.js'); scan(logSrc, 'log.js'); scan(menuSrc, 'StatusLogMenu.js'); scan(settingsSrc, 'SettingsPage.js')
  check(warnLines.length >= 4, '告警发射点不少于 4 处（实得 ' + warnLines.length + ' 处）')
  const guarded = warnLines.filter((w) => w.guarded)
  check(guarded.length === 0, '告警直发不判开关' + (guarded.length ? ' —— 带判断：' + guarded.map((w) => w.rel + ' 第 ' + w.i + ' 行').join('；') : ''))
}

// 五、看门狗字面：5000 毫秒竞跑，set 与 reconcile 都挂表。
{
  check(logSrc.includes('LOG_WATCHDOG_MS = 5000'), '看门狗阈值 5000 毫秒（#499 票面 5 秒）')
  check(logSrc.includes("watchSwitchOp('reconcile'") && logSrc.includes("watchSwitchOp('set'"), '对账与设置都挂看门狗（竞跑，不取消原调用）')
}

// 六、汇总节流与防自激（有新增丢弃才记；汇总自己失败只计数，不再记新汇总）。
{
  check(logSrc.includes('logForwardState.lastSummaryDropped'), '汇总记上次位置（无新增丢弃不打扰）')
  check(logSrc.includes('onlySummary'), '汇总防自激（只剩汇总自己时失败只计数）')
}

// 七、防繁殖（落盘失败行在途未落定不再追加，全盘皆坏时链条终止）。
{
  check(storeSrc.includes('persistFailOutstanding'), '失败行带在途守卫（避免失败自我繁殖）')
}

// 八、附录 1.6 与枚举字面（实现与附录逐字锁死）。
{
  const appendix = readSrc(path.join('research', '489-appendix.md'))
  check(appendix.includes('### 1.6'), '附录有 1.6 自监控节')
  for (const w of ['host.dispatch.error', 'log.persist.fail', 'log.forward.summary', 'log.switch.watchdog', 'log.export.fail']) {
    check(appendix.includes(w), '附录 1.6 含 ' + w)
  }
  for (const w of ['queue-full', 'packet-trim', 'send-fail', 'host-reject', 'path-missing', 'waiting-host', 'exit']) {
    const inSrc = indexSrc.includes(w) || storeSrc.includes(w) || logSrc.includes(w) || menuSrc.includes(w) || settingsSrc.includes(w)
    check(appendix.includes(w) && inSrc, '枚举 ' + w + ' 附录与实现一致')
  }
  const pkg = JSON.parse(readSrc(path.join('package.json')))
  check(pkg.scripts.verify.includes('verify-log-selfmon.js'), '本门禁已接入 npm run verify 链')
}

async function main() {
  // 九、复现 47：开关文件坏而日志文件好，失败行落盘且三键齐。
  {
    const modUrl = pathToFileURL(path.join(ROOT, 'src', 'host', 'logStore.js')).href
    const mod = await import(modUrl)
    const mem = { texts: new Map() }
    const memFs = {
      async resolve(p) { return { __target: String(p) } },
      async readText(t) {
        const key = t && t.__target ? t.__target : String(t)
        if (!mem.texts.has(key)) throw new Error('文件不存在')
        return mem.texts.get(key)
      },
      async writeText(t, text) {
        const key = t && t.__target ? t.__target : String(t)
        if (String(key).endsWith('log-switch.json')) throw new Error('模拟开关文件写失败')
        mem.texts.set(key, String(text))
      },
    }
    const platform = { os: 'test-os', path: { join(...parts) { return parts.join('/').replace(/\/+/g, '/') } }, fs: { async resolve(p) { return { __target: String(p) } }, async mkdir() {}, async listDir() { return [] } } }
    const timer = { timeout(fn, ms) { if (typeof fn === 'number') return new Promise((r) => setTimeout(() => r({ exitCode: -1 }), fn)); return setTimeout(fn, ms) } }
    const store = mod.createLogStore({ fs: memFs, timer, getCacheDir: async () => '/cache', getPlatform: async () => platform, DEFAULT_CWD: '/work' })
    await store.setSwitch(true, 1)
    store.log('info', 'evt-partial', {})
    store.flush()
    await wait(120)
    const today = mod.formatLogFileName(new Date())
    const keys = Array.from(mem.texts.keys()).filter((k) => k.endsWith('/' + today))
    const body = keys.length ? String(mem.texts.get(keys[0]) || '') : ''
    check(body.includes('\"event\":\"log.persist.fail\"'), '复现 47：开关文件坏而日志好，失败行落盘')
    check(body.includes('\"op\":\"persistSwitch\"') && body.includes('\"reason\":\"write-fail\"'), '复现 47：失败行带操作与原因枚举')
    check(/\"dirHash\":\"[0-9a-f]{8}\"/.test(body), '复现 47：目录只记 8 位散列，不记原文')
  }

  // 十、复现 48：队列打满后发送落定，汇总行内容正确；宿主长坏时链条终止。
  {
    const body = logSrc.split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n')
    const factory = new Function('host', 'timer', 'localStorage', 'broadcastLogSwitch',
      body + '\nreturn { log, sendLogBatch, getDroppedCount, logExportFail, watchSwitchOp, LOG_WATCHDOG_MS, logSwitch, logQueue, logDroppedState, logForwardState };')
    const latest = (mod) => mod.logQueue[mod.logQueue.length - 1]
    const goodHost = { call(name, args) { return Promise.resolve({ ok: true, accepted: args.entries.length, dropped: 0 }) } }
    const noopTimer = { timeout(fn, ms) { return 1 } }
    const mod = factory(goodHost, noopTimer, { getItem() { return null }, setItem() {} }, () => {})
    mod.logSwitch.enabled = true
    for (let i = 0; i < 120; i++) mod.log('info', 'evt-' + i, { n: i })
    await mod.sendLogBatch()
    const s = latest(mod)
    check(s && s.event === 'log.forward.summary' && s.level === 'warn', '复现 48：发送落定后记一行转发汇总')
    check(s && s.fields.droppedDelta === 20 && s.fields.totalDropped === 20 && s.fields.reason === 'queue-full', '复现 48：汇总行新增 20、累计 20、原因 queue-full')
    const badHost = { call() { return Promise.reject(new Error('宿主长坏')) } }
    const mod2 = factory(badHost, noopTimer, { getItem() { return null }, setItem() {} }, () => {})
    mod2.logSwitch.enabled = true
    for (let i = 0; i < 10; i++) mod2.log('info', 'lost-' + i, {})
    for (let round = 0; round < 10 && mod2.logQueue.length > 0; round++) await mod2.sendLogBatch()
    check(mod2.logQueue.length === 0, '复现 48：宿主长坏时发送链条终止（队列排空，无新行滋生）')
    check(mod2.getDroppedCount() === 11, '复现 48：丢弃计数收敛为 11（10 行业务加 1 行汇总自身，实得 ' + mod2.getDroppedCount() + '）')
  }

  // 十一、复现 49：对账 5 秒未回，看门狗行自举证。
  {
    const body = logSrc.split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n')
    const factory = new Function('host', 'timer', 'localStorage', 'broadcastLogSwitch',
      body + '\nreturn { reconcileLogSwitch, logQueue };')
    const realTimer = { timeout(fn, ms) { if (typeof fn === 'number') return new Promise((r) => setTimeout(() => r({ exitCode: -1 }), fn)); return setTimeout(fn, ms) } }
    const sent = []
    const hangingHost = { call(name, args) { if (name === 'wf.logBatch') { sent.push(args); return Promise.resolve({ ok: true, accepted: 0, dropped: 0 }) } return new Promise(() => {}) } }
    const mod = factory(hangingHost, realTimer, { getItem() { return null }, setItem() {} }, () => {})
    const t0 = Date.now()
    const pending = mod.reconcileLogSwitch()
    await wait(5400)
    const found = sent.flatMap((a) => a.entries || []).filter((e) => e && e.event === 'log.switch.watchdog')
    check(found.length === 1, '复现 49：对账 5 秒未回记一行看门狗（实得 ' + found.length + ' 行）')
    check(found.length === 1 && found[0].level === 'warn' && found[0].fields.op === 'reconcile' && found[0].fields.timeoutMs === 5000 && found[0].fields.stage === 'waiting-host', '复现 49：看门狗行三键齐（操作、对账、5 秒、等宿主）')
    check(Date.now() - t0 < 6000, '复现 49：5 秒多一点即出看门狗行（灰开关 5 秒内自举证）')
    await Promise.race([pending, wait(100)])
  }

  // 十二、复现 50：helper 两路（有散列函数走散列，无则记 unknown）。
  {
    const body = logSrc.split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n')
    const factory = new Function('host', 'timer', 'localStorage', 'broadcastLogSwitch',
      body + '\nreturn { log, logQueue, logExportFail };')
    const mod = factory(undefined, { timeout(fn) { return 1 } }, { getItem() { return null }, setItem() {} }, () => {})
    globalThis.dswsLogHash = (s) => 'abcd1234'
    globalThis.dswsLogTrunc = (s) => String(s)
    mod.logExportFail('export', 'export-not-ok', new Error('断线'))
    let line = mod.logQueue[mod.logQueue.length - 1]
    check(line && line.event === 'log.export.fail' && line.level === 'warn' && line.fields.op === 'export' && line.fields.reason === 'export-not-ok' && line.fields.errorHash === 'abcd1234', '复现 50：有散列函数时错误走散列')
    delete globalThis.dswsLogHash
    delete globalThis.dswsLogTrunc
    mod.logQueue.length = 0
    mod.logExportFail('openDir', 'open-fail', '打不开')
    line = mod.logQueue[mod.logQueue.length - 1]
    check(line && line.event === 'log.export.fail' && /^[0-9a-f]{8}$/.test(line.fields.errorHash || ''), '复现 50：无脱敏散列时走底座纯散列，不抛错')
  }

  console.log(failed ? '\n存在失败 — verify-log-selfmon 未通过' : '\n全部通过 — 自监控门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log('  FAIL 门禁执行异常：' + (e && e.message ? e.message : String(e)))
  process.exit(1)
})
