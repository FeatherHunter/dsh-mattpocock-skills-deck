// verify-log-selfmon.ts —— #499 日志管道自监控门禁（附录第 4 节断言九）。
// 用法：在插件根目录执行 node tests/verify-log-selfmon.ts，可独立运行。
// 断言文字：46～50 五个事件逐个在附录 1.6 里点名，附录末尾「枚举取值」段逐个登记齐全。
// 做法：运行时复现四类故障（落盘失败、队列打满后的转发汇总、看门狗超时、导出失败两路散列）。
// 原来还有「一～七」七段静态扫描：读 logStore.js、client/kernel/log.js、StatusLogMenu.js、SettingsPage.js、
// rpcChannel.js、dispatchMeta.js 的源码文本，断言里面有某个事件名字面、某个级别字面、某个字段键集合、
// 某处不带开关判断、某个常量等于 5000、某个变量名存在。那些盯的是源码写成什么样，等价重构就会变红，
// 已按维护者要求整段删除；附录与实现的字面锁死一并取消，只留附录自身的登记核对。
const fs = require('fs')
const path = require('path')
// 完成证据（#1158）：收尾交一行 GATE-RESULT，执行器据此判「跑完了没有」。
const { printGateResult } = require('./lib/gate-result.ts')
const { pathToFileURL } = require('url')
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
const { compileFn } = require('./lib/eval-probe.js')
// 取源走共用入口（tests/lib/source-text.ts）：这一阶段 src/client 下的同名 .js 构建产物已经删掉，
//   按 'src/client/kernel/log.js' 直接 fs.readFileSync 会 ENOENT。spliceableJs 按构建唯一口径
//   把 .ts 真源转成可拼接的 JavaScript（中央时间 import 行、行首 export 都已经处理好），
//   下面几段 compileFn 拼函数体的读法一行不用改。
const { spliceableJs } = require('./lib/source-text.ts')
// 中央时间真值：看门狗阈值只住 config/*.yaml，这里读同一份导出来比对，不在测试里写第二份数字。
const centralTime = require('../src/shared/time-config/values.js')
// 日志模块顶部那一行中央 import 在 compileFn 函数体里是非法的（函数体不许出现 import），
// 求值前剥掉；名字走全局预埋，值就是中央导出的同一份。
globalThis.LOG_FLUSH_MS = centralTime.LOG_FLUSH_MS
globalThis.LOG_WATCHDOG_MS = centralTime.LOG_WATCHDOG_MS
const stripTimeConfigImport = (text) => text.split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')
// 时间压缩：本门的墙钟时间几乎全花在「等超时」上 —— 第十一段要等那条对账看门狗真的烧完
// （多等中央阈值之上几百毫秒，加产品自己那条中央阈值的定时器，占全门时间里的绝大部分）。
// 压成虚拟时间以后真实只等几毫秒，而 Date.now() 报出来的仍是阈值多一点：看门狗仍在虚拟阈值那一刻自举证，
// 「阈值多一点即出看门狗行」与「恰好一行」两条判据照旧成立（虚拟队列按到期时间排队，
// 中央阈值那条先于多等几百毫秒那条到）。断言一条没动；理由、两条不能破的语义与边界见 tests/lib/time-compress.js 文件头。
const { installTimeCompression, uninstallTimeCompression } = require('./lib/time-compress.js')
installTimeCompression()

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

console.log('日志自监控门禁（#499：五类故障逐类有行，看门狗 5 秒自举证）')

// 客户端日志内核的真源码文本：第十～十二段把它抠出来配上假零件跑（不是拿它比对写法）。
//   取源见上面的说明：spliceableJs 已经把中央 import 与行首 export 处理掉，下面两处再剥一遍是幂等的空操作。
const logSrc = spliceableJs('src/client/kernel/log.js')

// 一～七段静态扫描已按维护者要求删除（原来读六份手写源码文本，钉事件名、级别、字段键、常量值、
// 变量名与「某行不带开关判断」这些写法）。下面只剩附录那一面与运行时复现。
// 八、附录 1.6 与枚举登记。
{
  const appendix = readSrc(path.join('research', '489-appendix.md'))
  check(appendix.includes('### 1.6'), '附录有 1.6 自监控节')
  for (const w of ['host.dispatch.error', 'log.persist.fail', 'log.forward.summary', 'log.switch.watchdog', 'log.export.fail']) {
    check(appendix.includes(w), '附录 1.6 含 ' + w)
  }
  // 附录这一面的判据原来写的是 appendix.includes(w) —— 整份八百多行的附录里出现过这个子串就算数，
  // 「exitCode 退出码」这类别的行也能把它喂饱，等于没判。收紧成「附录末尾那段『枚举取值』的行里
  // 逐个点名了它」：那一段才是这些取值的登记处，这才对得上「附录与实现一致」这句话。
  // 那一段找不到时后面七条会整组红，所以先把它在不在单独钉一条（免得红得莫名其妙）。
  const enumNote = appendix.split('\n').filter((l) => l.indexOf('枚举取值') >= 0).join('\n')
  check(enumNote.length > 0, '附录有「枚举取值」那一段（本组判据的附录面）')
  for (const w of ['queue-full', 'packet-trim', 'send-fail', 'host-reject', 'path-missing', 'waiting-host', 'exit']) {
    // 这里原来还要求这些取值在实现源码里也出现（把六份手写源码的文本各扫一遍），那是盯源码写法，
    // 已按维护者要求去掉，只核附录这一面的登记。
    check(enumNote.includes(w), '枚举 ' + w + ' 已在附录「枚举取值」段登记')
  }
  const { isGatePlanned } = require('../scripts/lib/discover-gates.ts')
  check(isGatePlanned(ROOT, 'tests/verify-log-selfmon.ts'), '本门禁已接入 verify 链（规划函数里有它，#1125 起不再读 package.json 长串）')
}

async function main() {
  // 九、复现 47（#1432 改口径）：当天日志文件第一次写失败、第二次成功，失败行仍能落盘且三键齐。
  //   原来这档造的是「开关文件坏、日志文件好」，开关文件已经整条删掉，改成让真正在用的日志文件坏一次，
  //   量的是同一个东西：一次写盘失败之后，那条 log.persist.fail 失败行自己还能写进文件。
  {
    const modUrl = pathToFileURL(path.join(ROOT, 'src', 'host', 'logStore.js')).href
    const mod = await import(modUrl)
    const mem = { texts: new Map(), logWrites: 0 }
    const memFs = {
      async resolve(p) { return { __target: String(p) } },
      async readText(t) {
        const key = t && t.__target ? t.__target : String(t)
        if (!mem.texts.has(key)) throw new Error('文件不存在')
        return mem.texts.get(key)
      },
      async writeText(t, text) {
        const key = t && t.__target ? t.__target : String(t)
        if (String(key).endsWith('.log')) {
          mem.logWrites += 1
          if (mem.logWrites === 1) throw new Error('模拟写盘失败')
        }
        mem.texts.set(key, String(text))
      },
    }
    const platform = { os: 'test-os', path: { join(...parts) { return parts.join('/').replace(/\/+/g, '/') } }, fs: { async resolve(p) { return { __target: String(p) } }, async mkdir() {}, async listDir() { return [] } } }
    const timer = { timeout(fn, ms) { if (typeof fn === 'number') return new Promise((r) => setTimeout(() => r({ exitCode: -1 }), fn)); return setTimeout(fn, ms) } }
    const store = mod.createLogStore({ fs: memFs, timer, getCacheDir: async () => '/cache', getPlatform: async () => platform, DEFAULT_CWD: '/work' })
    // 开关不再有自己那份文件（#1432）：setSwitch 不写盘，这里只把它当「打开日志」的开关用。
    await store.setSwitch(true, 1)
    store.log('info', 'evt-partial', {})
    store.flush()
    await wait(120)
    const today = mod.formatLogFileName(new Date())
    const keys = Array.from(mem.texts.keys()).filter((k) => k.endsWith('/' + today))
    const body = keys.length ? String(mem.texts.get(keys[0]) || '') : ''
    check(body.includes('\"event\":\"log.persist.fail\"'), '复现 47：写盘失败一次之后，失败行仍然落盘')
    check(body.includes('\"op\":\"writeBatch\"') && body.includes('\"reason\":\"write-fail\"'), '复现 47：失败行带操作与原因枚举')
    check(/\"dirHash\":\"[0-9a-f]{8}\"/.test(body), '复现 47：目录只记 8 位散列，不记原文')
  }

  // 十、复现 48：队列打满后发送落定，汇总行内容正确；宿主长坏时链条终止。
  {
    const stripped = stripTimeConfigImport(logSrc)
    const body = stripped.split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n')
    // 这里选 compileFn：四个依赖名逐个传（与原写法一模一样），被求值的日志内核源码文本原样，仍跑在 Node 全局环境里。
    const factory = compileFn(['host', 'timer', 'localStorage', 'broadcastLogSwitch'],
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

  // 十一、复现 49：对账在中央看门狗阈值内未回，看门狗行自举证。
  {
    const stripped = stripTimeConfigImport(logSrc)
    const body = stripped.split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n')
    // 这里选 compileFn：同上（四个依赖名逐个传，源码文本不变），只是取的导出少几样。
    const factory = compileFn(['host', 'timer', 'localStorage', 'broadcastLogSwitch'],
      body + '\nreturn { reconcileLogSwitch, logQueue };')
    const realTimer = { timeout(fn, ms) { if (typeof fn === 'number') return new Promise((r) => setTimeout(() => r({ exitCode: -1 }), fn)); return setTimeout(fn, ms) } }
    const sent = []
    const hangingHost = { call(name, args) { if (name === 'wf.logBatch') { sent.push(args); return Promise.resolve({ ok: true, accepted: 0, dropped: 0 }) } return new Promise(() => {}) } }
    const mod = factory(hangingHost, realTimer, { getItem() { return null }, setItem() {} }, () => {})
    const t0 = Date.now()
    const pending = mod.reconcileLogSwitch()
    await wait(centralTime.LOG_WATCHDOG_MS + 400)
    const found = sent.flatMap((a) => a.entries || []).filter((e) => e && e.event === 'log.switch.watchdog')
    check(found.length === 1, '复现 49：对账在中央阈值内未回记一行看门狗（实得 ' + found.length + ' 行）')
    check(found.length === 1 && found[0].level === 'warn' && found[0].fields.op === 'reconcile' && found[0].fields.timeoutMs === centralTime.LOG_WATCHDOG_MS && found[0].fields.stage === 'waiting-host', '复现 49：看门狗行三键齐（操作、对账、中央阈值、等宿主）')
    check(Date.now() - t0 < centralTime.LOG_WATCHDOG_MS + 1000, '复现 49：阈值多一点即出看门狗行（灰开关阈值内自举证）')
    await Promise.race([pending, wait(100)])
  }

  // 十二、复现 50：helper 两路（有散列函数走散列，无则记 unknown）。
  {
    const body = stripTimeConfigImport(logSrc).split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n')
    // 这里选 compileFn：同上（四个依赖名逐个传，源码文本不变），取的导出只有三样。
    const factory = compileFn(['host', 'timer', 'localStorage', 'broadcastLogSwitch'],
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
  // 完成记录：total 是实际跑过的断言数（#1158）。
  printGateResult('verify-log-selfmon', total, failed ? 1 : 0)
  // 收工先把全局时钟还原：本仓打算把多扇门禁放进同一个进程跑，别把虚拟时钟留给后面那几扇。
  uninstallTimeCompression()
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log('  FAIL 门禁执行异常：' + (e && e.message ? e.message : String(e)))
  uninstallTimeCompression()
  process.exit(1)
})
