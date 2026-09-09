// packages/dsh-log/tests/client.test.mjs —— 客户端引擎单测（#560 附单测，含两种消费形态对照）。
// 用法：先 node packages/dsh-log/build.mjs，再 node --test packages/dsh-log/tests/client.test.mjs。
// 只用 Node 自带测试能力（node:test），不引入新的测试框架。
// 覆盖：电话名拼法、批量口径、开关默认与秒显、关闭零调用、批量与截断、失败只计数、
// 对账与设置、看门狗不改返回值、自定义前缀隔离、对象清单复用、旧实现行为对照、
// 两种消费形态对照（直接 import 与闭包四名字直传）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(PKG_DIR, '..', '..')

const clientUrl = pathToFileURL(path.join(PKG_DIR, 'dist', 'client.js')).href + '?x=' + Date.now()
const client = await import(clientUrl)
const { createClientLog, resolveClientLogConfig, buildClientPhoneNames, CLIENT_BATCH } = client
const OLD_SRC = readFileSync(path.join(ROOT, 'src', 'client', 'kernel', 'log.js'), 'utf8')

function makeStorage(preset) {
  const map = new Map(Object.entries(preset || {}))
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) { map.set(k, String(v)) },
    _map: map
  }
}
function makeTimer() {
  const calls = []
  return { calls, timeout(fn, ms) { calls.push(ms); return calls.length } }
}
function makeManualTimer() {
  const fns = []
  return { fns, timeout(fn, ms) { fns.push({ fn, ms }); return fns.length } }
}
function okHost(seen) {
  return {
    call(name, args) {
      if (seen) seen.push({ name, args })
      if (name.endsWith('.logGetSwitch')) return Promise.resolve({ ok: true, enabled: false, sampleRate: 1 })
      if (name.endsWith('.logSetSwitch')) return Promise.resolve({ ok: true, enabled: true })
      return Promise.resolve({ ok: true, accepted: args && args.entries ? args.entries.length : 0, dropped: 0 })
    }
  }
}
// 旧实现按构建语义载入（去行首 export，闭包四名字直传），与 tests/verify-log-client.js 同 harness。
function loadOld(options) {
  const opts = options || {}
  const body = OLD_SRC.split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n')
  const factory = new Function(
    'host', 'timer', 'localStorage', 'broadcastLogSwitch',
    body + '\nreturn { isEnabled, log, flush, getDroppedCount, logSwitch, logQueue, logDroppedState,' +
    ' sendLogBatch, reconcileLogSwitch, setLogSwitch, watchSwitchOp, logExportFail };'
  )
  return factory(opts.host, opts.timer, opts.localStorage, opts.broadcastLogSwitch)
}

describe('客户端引擎单测（#560）', () => {
  it('电话名与口径：默认 wf 拼出旧字面，批量数字复用常量不另写', () => {
    assert.deepEqual(buildClientPhoneNames('wf'), {
      logBatch: 'wf.logBatch',
      logExport: 'wf.logExport',
      logClear: 'wf.logClear',
      logGetSwitch: 'wf.logGetSwitch',
      logSetSwitch: 'wf.logSetSwitch'
    })
    assert.deepEqual(CLIENT_BATCH, { maxPerBatch: 50, intervalMs: 1000, packetBytes: 131072, queueMax: 100 })
    assert.equal(client.LOG_BATCH_MAX, 50)
    assert.equal(client.LOG_FLUSH_MS, 1000)
    assert.equal(client.LOG_PACKET_BYTES, 131072)
    assert.equal(client.LOG_QUEUE_MAX, 100)
    assert.equal(client.LOG_DEBUG_KEY, 'dsws.debug')
  })

  it('源码静态断言：电话名全走前缀拼装，无写死旧字面，无闭包自由变量', () => {
    const src = readFileSync(path.join(PKG_DIR, 'src', 'client.ts'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
    assert.ok(code.includes('phoneNames.logBatch'), '转发调拼出来的记录电话名')
    assert.ok(code.includes('phoneNames.logGetSwitch'), '对账调拼出来的开关读电话名')
    assert.ok(code.includes('phoneNames.logSetSwitch'), '设置调拼出来的开关写电话名')
    assert.ok(!code.includes("'wf.logBatch'"), '无写死的旧记录电话名字面')
    assert.ok(!code.includes("'wf.logGetSwitch'"), '无写死的旧开关读字面')
    assert.ok(!code.includes("'wf.logSetSwitch'"), '无写死的旧开关写字面')
    assert.ok(!code.includes('typeof host ==='), '宿主只认传入的依赖，不碰闭包自由变量')
    assert.ok(!code.includes('typeof timer !=='), '计时器只认传入的依赖')
    assert.ok(!code.includes('typeof broadcastLogSwitch ==='), '广播只认传入的依赖')
    const quoted = new Set(Array.from(code.matchAll(/'(log\.[a-z.]+|host\.call\.fail)'/g)).map((m) => m[1]))
    assert.deepEqual(Array.from(quoted).sort(), ['host.call.fail', 'log.export.fail', 'log.forward.summary', 'log.switch.watchdog'])
  })

  it('配置：默认即 wf，自定前缀隔离，非法报错，对象清单复用', () => {
    assert.deepEqual(resolveClientLogConfig(), { pluginId: 'wf', prefix: 'wf', eventList: null })
    assert.deepEqual(resolveClientLogConfig({}), { pluginId: 'wf', prefix: 'wf', eventList: null })
    const demo = resolveClientLogConfig({ pluginId: 'demo' })
    assert.equal(demo.prefix, 'demo')
    assert.equal(createClientLog({ storage: makeStorage() }, { pluginId: 'demo' }).phoneNames.logBatch, 'demo.logBatch')
    assert.throws(() => resolveClientLogConfig({ pluginId: 'WF' }), /非法/)
    assert.throws(() => resolveClientLogConfig({ pluginId: 'wf.demo' }), /非法/)
    assert.throws(() => createClientLog({ storage: makeStorage() }, { pluginId: 'WF' }), /非法/)
    // 对象清单格式复用（与宿主入口同一验形函数）：对象合法透过，数组被拦，字符串只存不解析。
    const list = { version: 1, pluginId: 'wf', counts: { resident: 0, ondemand: 0, selfmon: 0 }, events: {} }
    assert.deepEqual(resolveClientLogConfig({ pluginId: 'wf', eventList: list }).eventList, list)
    assert.throws(() => resolveClientLogConfig({ pluginId: 'wf', eventList: [] }), /事件清单/)
    assert.equal(resolveClientLogConfig({ pluginId: 'wf', eventList: 'some/path.json' }).eventList, 'some/path.json')
  })

  it('开关默认关闭与本地秒显：空存储默认关，预设开秒显，坏值回默认', () => {
    const fresh = createClientLog({ storage: makeStorage(), timer: makeTimer() }, { pluginId: 'wf' })
    assert.equal(fresh.isEnabled('error'), true)
    assert.equal(fresh.isEnabled('warn'), true)
    assert.equal(fresh.isEnabled('info'), false)
    assert.equal(fresh.isEnabled('debug'), false)
    assert.deepEqual({ enabled: fresh.logSwitch.enabled, sampleRate: fresh.logSwitch.sampleRate }, { enabled: false, sampleRate: 1 })
    const preset = makeStorage({ 'dsws.debug': JSON.stringify({ enabled: true, sampleRate: 0.5, rev: 1 }) })
    const opened = createClientLog({ storage: preset, timer: makeTimer() }, { pluginId: 'wf' })
    assert.equal(opened.isEnabled('info'), true)
    assert.equal(opened.logSwitch.sampleRate, 0.5)
    const broken = makeStorage({ 'dsws.debug': '不是 JSON' })
    assert.equal(createClientLog({ storage: broken }, { pluginId: 'wf' }).isEnabled('info'), false)
    assert.equal(createClientLog({}, { pluginId: 'wf' }).isEnabled('info'), false)
  })

  it('关闭零调用：信息与调试不进队列、不排定时器、不计数，错误仍允许', () => {
    const timer = makeTimer()
    const logger = createClientLog({ storage: makeStorage(), timer }, { pluginId: 'wf' })
    for (let i = 0; i < 5; i++) logger.log('info', 'evt.closed', { n: i })
    for (let i = 0; i < 5; i++) logger.log('debug', 'evt.closed.debug', { n: i })
    assert.equal(timer.calls.length, 0)
    assert.equal(logger.logQueue.length, 0)
    assert.equal(logger.getDroppedCount(), 0)
    logger.log('error', 'boom', {})
    assert.equal(logger.logQueue.length, 1)
    assert.equal(timer.calls[timer.calls.length - 1], 0)
  })

  it('批量语义：120 条进 100 条记 20 丢弃，一次发 50 条，落定记一行转发汇总', async () => {
    const seen = []
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: okHost(seen) }, { pluginId: 'wf' })
    logger.logSwitch.enabled = true
    for (let i = 0; i < 120; i++) logger.log('info', 'evt-' + i, { n: i })
    assert.equal(logger.logQueue.length, 100)
    assert.equal(logger.getDroppedCount(), 20)
    await logger.sendLogBatch()
    assert.equal(seen.length, 1)
    assert.equal(seen[0].name, 'wf.logBatch')
    assert.equal(seen[0].args.entries.length, 50)
    assert.equal(typeof seen[0].args.droppedCount, 'number')
    const summary = logger.logQueue[logger.logQueue.length - 1]
    assert.equal(summary.level, 'warn')
    assert.equal(summary.event, 'log.forward.summary')
    assert.equal(summary.fields.droppedDelta, 20)
    assert.equal(summary.fields.totalDropped, 20)
    assert.equal(summary.fields.reason, 'queue-full')
    assert.equal(typeof summary.fields.windowMs, 'number')
    assert.equal(logger.logQueue.length, 51)
  })

  it('超包截断：单包超 128KB 先到先截，裁掉记丢弃，尾条记截断标记', async () => {
    const seen = []
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: okHost(seen) }, { pluginId: 'wf' })
    logger.logSwitch.enabled = true
    for (let i = 0; i < 60; i++) logger.log('info', 'big-' + i, { blob: 'x'.repeat(5000) })
    assert.equal(logger.getDroppedCount(), 0)
    await logger.sendLogBatch()
    const sent = seen[0].args.entries
    assert.ok(sent.length < 50, '超包后实发少于 50 条（实发 ' + sent.length + ' 条）')
    assert.ok(logger.getDroppedCount() > 0, '裁掉的记入丢弃数')
    assert.equal(sent[sent.length - 1].truncated, true)
    assert.ok(logger.estimateBatchBytes(sent) <= 131072, '实发包体积回到 128KB 以内')
  })

  it('失败只计数不抛：转发失败整批记丢弃，flush 只管转发', async () => {
    const timer = makeTimer()
    const logger = createClientLog({ storage: makeStorage(), timer, host: okHost() }, { pluginId: 'wf' })
    logger.log('error', 'boom', { reason: 'test' })
    assert.equal(timer.calls[timer.calls.length - 1], 0)
    logger.logSwitch.enabled = true
    logger.log('info', 'normal', {})
    assert.equal(timer.calls[timer.calls.length - 1], 1000)
    const failing = createClientLog(
      { storage: makeStorage(), timer: makeTimer(), host: { call() { return Promise.reject(new Error('断线')) } } },
      { pluginId: 'wf' }
    )
    failing.logSwitch.enabled = true
    failing.log('info', 'lost', {})
    const before = failing.getDroppedCount()
    let threw = false
    try {
      const res = await failing.sendLogBatch()
      assert.equal(res.ok, false)
    } catch {
      threw = true
    }
    assert.equal(threw, false)
    assert.equal(failing.getDroppedCount() - before, 1)
    assert.deepEqual(logger.flush(), { ok: true })
  })

  it('对账 winner 为宿主：成功跟宿主走并广播，失败保持本地不回退开启', async () => {
    const ls = makeStorage({ 'dsws.debug': JSON.stringify({ enabled: true, sampleRate: 1, rev: 1 }) })
    let broadcast = 0
    const logger = createClientLog(
      { storage: ls, timer: makeTimer(), host: okHost(), broadcastLogSwitch() { broadcast += 1 } },
      { pluginId: 'wf' }
    )
    assert.equal(logger.isEnabled('info'), true)
    const res = await logger.reconcileLogSwitch()
    assert.equal(res.ok, true)
    assert.equal(logger.logSwitch.enabled, false)
    assert.equal(JSON.parse(ls._map.get('dsws.debug')).enabled, false)
    assert.equal(broadcast, 1)
    const keepLs = makeStorage({ 'dsws.debug': JSON.stringify({ enabled: true, sampleRate: 1, rev: 1 }) })
    const keep = createClientLog(
      { storage: keepLs, timer: makeTimer(), host: { call() { return Promise.reject(new Error('断线')) } } },
      { pluginId: 'wf' }
    )
    const res2 = await keep.reconcileLogSwitch()
    assert.equal(res2.ok, false)
    assert.equal(keep.logSwitch.enabled, true)
    const noHost = createClientLog({ storage: makeStorage(), timer: makeTimer() }, { pluginId: 'wf' })
    const res3 = await noHost.reconcileLogSwitch()
    assert.equal(res3.ok, false)
    assert.equal(noHost.logSwitch.enabled, false)
  })

  it('设置保存：宿主生效才更新本地并广播，失败保持旧值并给机器码', async () => {
    const ls = makeStorage()
    let broadcast = 0
    let seen = null
    const host = {
      call(name, args) {
        seen = { name, args }
        return Promise.resolve({ ok: true, enabled: true })
      }
    }
    const logger = createClientLog({ storage: ls, timer: makeTimer(), host, broadcastLogSwitch() { broadcast += 1 } }, { pluginId: 'wf' })
    const res = await logger.setLogSwitch(true, 0.5)
    assert.equal(seen.name, 'wf.logSetSwitch')
    assert.equal(seen.args.enabled, true)
    assert.equal(res.ok, true)
    assert.equal(logger.logSwitch.enabled, true)
    assert.equal(logger.logSwitch.sampleRate, 0.5)
    assert.equal(JSON.parse(ls._map.get('dsws.debug')).enabled, true)
    assert.equal(broadcast, 1)
    const rejected = createClientLog(
      { storage: makeStorage(), timer: makeTimer(), host: { call() { return Promise.resolve({ ok: false }) } } },
      { pluginId: 'wf' }
    )
    const res2 = await rejected.setLogSwitch(true, 1)
    assert.equal(res2.ok, false)
    assert.equal(res2.error, 'host-rejected')
    assert.equal(rejected.logSwitch.enabled, false)
    const noHost = createClientLog({ storage: makeStorage(), timer: makeTimer() }, { pluginId: 'wf' })
    const res3 = await noHost.setLogSwitch(true, 1)
    assert.equal(res3.error, 'host-unavailable')
    const failRow = noHost.logQueue.find((e) => e.event === 'host.call.fail')
    assert.ok(failRow, '无宿主时记一行开关写失败分类行')
    assert.equal(failRow.fields.method, 'wf.logSetSwitch')
  })

  it('看门狗：计时先到记一行告警，原调用照常落定不改返回值', async () => {
    const timer = makeManualTimer()
    let resolveHost = null
    const hanging = { call() { return new Promise((resolve) => { resolveHost = resolve }) } }
    const logger = createClientLog({ storage: makeStorage(), timer, host: hanging }, { pluginId: 'wf' })
    const pending = logger.setLogSwitch(true, 1)
    const watchdog = timer.fns.find((f) => f.ms === 5000)
    assert.ok(watchdog, '开关写注册 5 秒看门狗')
    watchdog.fn()
    const row = logger.logQueue.find((e) => e.event === 'log.switch.watchdog')
    assert.ok(row, '计时先到记一行看门狗')
    assert.equal(row.level, 'warn')
    assert.deepEqual(row.fields, { op: 'set', timeoutMs: 5000, stage: 'waiting-host' })
    resolveHost({ ok: true, enabled: true })
    const res = await pending
    assert.equal(res.ok, true)
    assert.equal(res.enabled, true)
    assert.equal(logger.logQueue.filter((e) => e.event === 'log.switch.watchdog').length, 1)
  })

  it('导出链路行：有全局散列走散列，无则回退包内散列，不抛错', () => {
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer() }, { pluginId: 'wf' })
    globalThis.dswsLogHash = (s) => 'abcd1234'
    globalThis.dswsLogTrunc = (s) => String(s)
    logger.logExportFail('export', 'export-not-ok', new Error('断线'))
    let line = logger.logQueue[logger.logQueue.length - 1]
    assert.equal(line.event, 'log.export.fail')
    assert.equal(line.fields.errorHash, 'abcd1234')
    delete globalThis.dswsLogHash
    delete globalThis.dswsLogTrunc
    logger.logQueue.length = 0
    logger.logExportFail('openDir', 'open-fail', '打不开')
    line = logger.logQueue[logger.logQueue.length - 1]
    assert.ok(/^[0-9a-f]{8}$/.test(line.fields.errorHash || ''))
  })

  it('自定义前缀隔离：转发与失败行方法名跟随前缀，不回落旧字面', async () => {
    const seen = []
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: okHost(seen) }, { pluginId: 'demo' })
    assert.equal(logger.phoneNames.logBatch, 'demo.logBatch')
    logger.logSwitch.enabled = true
    logger.log('info', 'hello-demo', {})
    await logger.sendLogBatch()
    assert.equal(seen[0].name, 'demo.logBatch')
    const noHost = createClientLog({ storage: makeStorage(), timer: makeTimer() }, { pluginId: 'demo' })
    await noHost.setLogSwitch(true, 1)
    const failRow = noHost.logQueue.find((e) => e.event === 'host.call.fail')
    assert.equal(failRow.fields.method, 'demo.logSetSwitch')
  })

  it('旧实现行为对照：默认 wf 下同操作同电话名同队列同丢弃同开关', async () => {
    async function snapshot(mod, seen) {
      const summary = mod.logQueue[mod.logQueue.length - 1]
      return {
        calls: seen.map((s) => s.name),
        sent: seen.length ? seen[0].args.entries.length : -1,
        queue: mod.logQueue.length,
        dropped: mod.getDroppedCount(),
        summary: summary ? { event: summary.event, level: summary.level, fields: summary.fields } : null,
        strip: mod.logQueue.slice(0, 3).map((e) => e.level + '|' + e.event + '|' + JSON.stringify(e.fields))
      }
    }
    async function operate(mod) {
      mod.log('error', 'boom', { reason: 'test' })
      mod.log('warn', 'careful', { kind: 'export' })
      mod.logSwitch.enabled = true
      for (let i = 0; i < 120; i++) mod.log('info', 'evt-' + i, { n: i })
      await mod.sendLogBatch()
    }
    const oldSeen = []
    const oldMod = loadOld({ host: okHost(oldSeen), timer: makeTimer(), localStorage: makeStorage() })
    await operate(oldMod)
    const fromOld = await snapshot(oldMod, oldSeen)
    const newSeen = []
    const newMod = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: okHost(newSeen) }, { pluginId: 'wf' })
    await operate(newMod)
    const fromNew = await snapshot(newMod, newSeen)
    assert.deepEqual(fromNew, fromOld)
  })

  it('两种消费形态对照：直接 import 与闭包四名字直传行为一致', async () => {
    const direct = createClientLog(
      { storage: makeStorage(), timer: makeTimer(), host: okHost() },
      { pluginId: 'wf' }
    )
    // 文本拼接形态：消费方闭包里只有 host、timer、localStorage、broadcastLogSwitch 四个名字，原样传入。
    const viaClosure = new Function(
      'createClientLog', 'host', 'timer', 'localStorage', 'broadcastLogSwitch',
      'return createClientLog({ host: host, timer: timer, localStorage: localStorage, broadcastLogSwitch: broadcastLogSwitch }, { pluginId: "wf" })'
    )(
      createClientLog,
      okHost(),
      makeTimer(),
      makeStorage(),
      () => {}
    )
    for (const mod of [direct, viaClosure]) {
      mod.logSwitch.enabled = true
      mod.log('info', 'hello', { n: 1 })
    }
    assert.equal(direct.logQueue.length, viaClosure.logQueue.length)
    assert.equal(direct.getDroppedCount(), viaClosure.getDroppedCount())
    assert.deepEqual(direct.phoneNames, viaClosure.phoneNames)
    const [r1, r2] = await Promise.all([direct.sendLogBatch(), viaClosure.sendLogBatch()])
    assert.deepEqual(r1, r2)
  })

  it('宿主长坏链条终止：多轮发送排空队列，丢弃计数收敛不滋生', async () => {
    const bad = { call() { return Promise.reject(new Error('宿主长坏')) } }
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: bad }, { pluginId: 'wf' })
    logger.logSwitch.enabled = true
    for (let i = 0; i < 10; i++) logger.log('info', 'lost-' + i, {})
    for (let round = 0; round < 10 && logger.logQueue.length > 0; round++) await logger.sendLogBatch()
    assert.equal(logger.logQueue.length, 0)
    assert.equal(logger.getDroppedCount(), 11)
  })
})
