// verify-log-selfmon.ts —— #499 日志管道自监控门禁（附录第 4 节断言九）。
// 用法：在插件根目录执行 node tests/verify-log-selfmon.ts，可独立运行。
// 断言文字：46～50 五个事件逐个在附录 1.6 里点名，附录末尾「枚举取值」段逐个登记齐全。
// 做法：运行时复现四类故障（落盘失败、队列打满后的转发汇总、看门狗超时、导出失败两路散列）。
// 原来还有「一～七」七段静态扫描：读 logStore.js、client/kernel/log.js、StatusLogMenu.js、SettingsPage.js、
// rpcChannel.js、dispatchMeta.js 的源码文本，断言里面有某个事件名字面、某个级别字面、某个字段键集合、
// 某处不带开关判断、某个常量等于 5000、某个变量名存在。那些盯的是源码写成什么样，等价重构就会变红，
// 已按维护者要求整段删除；旧文件已删，行为由包保证，只留附录自身的登记核对。
const fs = require('fs')
const path = require('path')
// 完成证据（#1158）：收尾交一行 GATE-RESULT，执行器据此判「跑完了没有」。
const { printGateResult } = require('./lib/gate-result.ts')
// 时间压缩：本门的墙钟时间几乎全花在「等超时」上 —— 第十一段要等那条对账看门狗真的烧完
// （多等包里看门狗阈值之上几百毫秒，加产品自己那条包里阈值的定时器，占全门时间里的绝大部分）。
// 压成虚拟时间以后真实只等几毫秒，而 Date.now() 报出来的仍是阈值多一点：看门狗仍在虚拟阈值那一刻自举证，
// 「阈值多一点即出看门狗行」与「恰好一行」两条判据照旧成立（虚拟队列按到期时间排队，
// 包里阈值那条先于多等几百毫秒那条到）。断言一条没动；理由、两条不能破的语义与边界见 tests/lib/time-compress.js 文件头。
const { installTimeCompression, uninstallTimeCompression } = require('./lib/time-compress.js')
installTimeCompression()

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

console.log('日志自监控门禁（#499：五类故障逐类有行，看门狗 5 秒自举证）')

// 客户端日志内核已随 #1143 切到 dsh-log 包：旧文件已删，行为由包保证，
// 这里不再拼旧源码文本求值，直接用包里建好的真日志器。
// 一～七段静态扫描已按维护者要求删除（原来读六份手写源码文本，钉事件名、级别、字段键、常量值、
// 变量名与「某行不带开关判断」这些写法；旧文件已删，行为由包保证）。下面只剩附录那一面与运行时复现。
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
  // 那一段找不到时后面七条会整组红，所以先把「它在不在」单独钉一条（免得红得莫名其妙）。
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
  //   旧文件已删，行为由包保证：这里直接用 dsh-log/host 建真宿主库，不再读旧 src/host/logStore.js。
  //   包里写一批内部重试一次才记失败行，所以这里让头两次落盘写都失败、第三次成功，
  //   量的仍是同一个东西：一次写盘失败之后，那条 log.persist.fail 失败行自己还能写进文件。
  {
    const { createLogStore, formatLogFileName } = await import('dsh-log/host')
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
          if (mem.logWrites <= 2) throw new Error('模拟写盘失败')
        }
        mem.texts.set(key, String(text))
      },
    }
    const platform = { os: 'test-os', path: { join(...parts) { return parts.join('/').replace(/\/+/g, '/') } }, fs: { async resolve(p) { return { __target: String(p) } }, async mkdir() {}, async listDir() { return [] } } }
    const timer = { timeout(fn, ms) { if (typeof fn === 'number') return new Promise((r) => setTimeout(() => r({ exitCode: -1 }), fn)); return setTimeout(fn, ms) } }
    const store = createLogStore({ fs: memFs, timer, getCacheDir: async () => '/cache', getPlatform: async () => platform, DEFAULT_CWD: '/work' }, { pluginId: 'wf', prefix: 'wf' })
    // 开关不再有自己那份文件（#1432）：setSwitch 只把内存开关打开，包里开关来源不同，但本节只量落盘失败行，三键齐即可。
    await store.setSwitch(true, 1)
    store.log('info', 'evt-partial', {})
    store.flush()
    await wait(120)
    try { await store.synced() } catch (e) {}
    try { await store.flushNow() } catch (e) {}
    await wait(50)
    const today = formatLogFileName(new Date())
    const keys = Array.from(mem.texts.keys()).filter((k) => k.endsWith('/' + today))
    const body = keys.length ? String(mem.texts.get(keys[0]) || '') : ''
    check(body.includes('"event":"log.persist.fail"'), '复现 47：写盘失败一次之后，失败行仍然落盘')
    check(body.includes('"op":"writeBatch"') && body.includes('"reason":"write-fail"'), '复现 47：失败行带操作与原因枚举')
    check(/"dirHash":"[0-9a-f]{8}"/.test(body), '复现 47：目录只记 8 位散列，不记原文')
  }

  // 十、复现 48：队列打满后发送落定，汇总行内容正确；宿主长坏时链条终止。
  //   旧文件已删，行为由包保证：这里直接用 dsh-log/client 建真日志器，不再拼旧源码文本求值。
  {
    const { createClientLog } = await import('dsh-log/client')
    const latest = (mod) => mod.logQueue[mod.logQueue.length - 1]
    const goodHost = { call(name, args) { return Promise.resolve({ ok: true, accepted: args.entries.length, dropped: 0 }) } }
    const noopTimer = { timeout(fn, ms) { return 1 } }
    const mod = createClientLog({ host: goodHost, timer: noopTimer, localStorage: { getItem() { return null }, setItem() {} }, broadcastLogSwitch() {} }, { pluginId: 'wf', prefix: 'wf' })
    mod.logSwitch.enabled = true
    for (let i = 0; i < 120; i++) mod.log('info', 'evt-' + i, { n: i })
    await mod.sendLogBatch()
    const s = latest(mod)
    check(s && s.event === 'log.forward.summary' && s.level === 'warn', '复现 48：发送落定后记一行转发汇总')
    check(s && s.fields.droppedDelta === 20 && s.fields.totalDropped === 20 && s.fields.reason === 'queue-full', '复现 48：汇总行新增 20、累计 20、原因 queue-full')
    const badHost = { call() { return Promise.reject(new Error('宿主长坏')) } }
    const mod2 = createClientLog({ host: badHost, timer: noopTimer, localStorage: { getItem() { return null }, setItem() {} }, broadcastLogSwitch() {} }, { pluginId: 'wf', prefix: 'wf' })
    mod2.logSwitch.enabled = true
    for (let i = 0; i < 11; i++) mod2.log('info', 'lost-' + i, {})
    // 包里发送失败先进有界重试位，到顶才计丢弃：这里连发多轮把重试位排空，终态与旧语义一致（队列排空、计数收敛）。
    for (let round = 0; round < 10; round++) await mod2.sendLogBatch()
    check(mod2.logQueue.length === 0, '复现 48：宿主长坏时发送链条终止（队列排空，无新行滋生）')
    check(mod2.getDroppedCount() === 11, '复现 48：丢弃计数收敛为 11（10 行业务加 1 行汇总自身，实得 ' + mod2.getDroppedCount() + '）')
  }

  // 十一、复现 49：对账在包里看门狗阈值内未回，看门狗行自举证。
  //   旧文件已删，行为由包保证：这里直接用 dsh-log/client 建真日志器，阈值从包里另取。
  {
    const { createClientLog, LOG_WATCHDOG_MS } = await import('dsh-log/client')
    const realTimer = { timeout(fn, ms) { if (typeof fn === 'number') return new Promise((r) => setTimeout(() => r({ exitCode: -1 }), fn)); return setTimeout(fn, ms) } }
    const sent = []
    const hangingHost = { call(name, args) { if (name === 'wf.logBatch') { sent.push(args); return Promise.resolve({ ok: true, accepted: 0, dropped: 0 }) } return new Promise(() => {}) } }
    const mod = createClientLog({ host: hangingHost, timer: realTimer, localStorage: { getItem() { return null }, setItem() {} }, broadcastLogSwitch() {} }, { pluginId: 'wf', prefix: 'wf' })
    const t0 = Date.now()
    const pending = mod.reconcileLogSwitch()
    await wait(LOG_WATCHDOG_MS + 400)
    const found = sent.flatMap((a) => a.entries || []).filter((e) => e && e.event === 'log.switch.watchdog')
    check(found.length === 1, '复现 49：对账在中央阈值内未回记一行看门狗（实得 ' + found.length + ' 行）')
    check(found.length === 1 && found[0].level === 'warn' && found[0].fields.op === 'reconcile' && found[0].fields.timeoutMs === LOG_WATCHDOG_MS && found[0].fields.stage === 'waiting-host', '复现 49：看门狗行三键齐（操作、对账、中央阈值、等宿主）')
    check(Date.now() - t0 < LOG_WATCHDOG_MS + 1000, '复现 49：阈值多一点即出看门狗行（灰开关阈值内自举证）')
    await Promise.race([pending, wait(100)])
  }

  // 十二、复现 50：helper 两路（有散列函数走散列，无则记 unknown）。
  //   旧文件已删，行为由包保证：散列经建日志器时的 hashFn 注入，不再读全局裸函数。
  {
    const { createClientLog } = await import('dsh-log/client')
    const mod = createClientLog({ host: undefined, timer: { timeout(fn) { return 1 } }, localStorage: { getItem() { return null }, setItem() {} }, broadcastLogSwitch() {}, hashFn: (s) => 'abcd1234' }, { pluginId: 'wf', prefix: 'wf' })
    mod.logExportFail('export', 'export-not-ok', new Error('断线'))
    let line = mod.logQueue[mod.logQueue.length - 1]
    check(line && line.event === 'log.export.fail' && line.level === 'warn' && line.fields.op === 'export' && line.fields.reason === 'export-not-ok' && line.fields.errorHash === 'abcd1234', '复现 50：有散列函数时错误走散列')
    const mod2 = createClientLog({ host: undefined, timer: { timeout(fn) { return 1 } }, localStorage: { getItem() { return null }, setItem() {} }, broadcastLogSwitch() {} }, { pluginId: 'wf', prefix: 'wf' })
    mod2.logExportFail('openDir', 'open-fail', '打不开')
    line = mod2.logQueue[mod2.logQueue.length - 1]
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
