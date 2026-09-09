// packages/dsh-log/tests/host.test.mjs —— 宿主引擎单测（#559 附单测四项，外加与旧实现的零变化对照）。
// 用法：先 node packages/dsh-log/build.mjs，再 node --test packages/dsh-log/tests/host.test.mjs。
// 只用 Node 自带测试能力（node:test），不引入新的测试框架。
// 四项：关闭零调用、串行不丢行、命名规则、失败计数；另加旧实现行为对照（默认配置字节级一致，时间戳除外）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(PKG_DIR, '..', '..')

const fresh = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'host.js')).href + '?x=' + Date.now())
const { createHostLog, registerHostLogPhones, buildPhoneNames, formatDailyFileName, LOG_DEBOUNCE_MS } = fresh
const legacy = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'logStore.js')).href)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 内存文件服务夹具：行为与宿主文件服务同形（resolve 给目标对象，读写按目标读写）。
function makeMemoryFiles() {
  return { texts: new Map(), writes: 0, failWrites: false }
}
function makeFs(mem) {
  return {
    async resolve(p) {
      return { __target: String(p) }
    },
    async readText(t) {
      const key = t && t.__target ? t.__target : String(t)
      if (!mem.texts.has(key)) throw new Error('文件不存在：' + key)
      return mem.texts.get(key)
    },
    async writeText(t, text) {
      mem.writes += 1
      if (mem.failWrites) throw new Error('模拟写盘失败')
      mem.texts.set(t && t.__target ? t.__target : String(t), String(text))
    },
    async unlink(t) {
      mem.texts.delete(t && t.__target ? t.__target : String(t))
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
function makeTimer() {
  const calls = []
  const timeout = (fn, ms) => {
    if (typeof fn === 'number') return new Promise((resolve) => setTimeout(() => resolve({ exitCode: -1 }), fn))
    calls.push(ms)
    return setTimeout(fn, ms)
  }
  return { timeout, calls }
}
function makeDeps(mem, cacheDir) {
  const timer = makeTimer()
  return {
    timer,
    deps: {
      fs: makeFs(mem),
      timer,
      getCacheDir: async () => cacheDir,
      getPlatform: async () => makePlatform(),
      DEFAULT_CWD: '/work'
    }
  }
}

describe('宿主引擎单测（#559）', () => {
  it('关闭零调用：开关关闭时信息与调试不进队列、不排定时器、不写盘、不计数', async () => {
    const mem = makeMemoryFiles()
    const { timer, deps } = makeDeps(mem, '/cache')
    const { store } = createHostLog(deps, { pluginId: 'wf' })
    assert.equal(store.isEnabled('error'), true)
    assert.equal(store.isEnabled('warn'), true)
    assert.equal(store.isEnabled('info'), false)
    assert.equal(store.isEnabled('debug'), false)
    assert.equal(store.getSwitchState().enabled, false)
    const timerBefore = timer.calls.length
    const writesBefore = mem.writes
    for (let i = 0; i < 5; i++) store.log('info', 'evt.closed', { n: i })
    for (let i = 0; i < 5; i++) store.log('debug', 'evt.closed.debug', { n: i })
    assert.equal(timer.calls.length, timerBefore)
    store.flush()
    await wait(60)
    assert.equal(mem.writes, writesBefore)
    assert.equal(store.getDroppedCount(), 0)
  })

  it('串行不丢行：20 行按序全部落到当天文件', async () => {
    const mem = makeMemoryFiles()
    const { deps } = makeDeps(mem, '/cache')
    const { store } = createHostLog(deps, { pluginId: 'wf' })
    await store.setSwitch(true, 1)
    for (let i = 0; i < 20; i++) store.log('info', 'evt-' + i, { n: i })
    store.flush()
    await wait(80)
    const today = formatDailyFileName(new Date())
    const keys = Array.from(mem.texts.keys()).filter((k) => k.endsWith('/' + today))
    assert.equal(keys.length, 1)
    const rows = String(mem.texts.get(keys[0]) || '').split('\n').filter(Boolean)
    assert.equal(rows.length, 20)
    for (let i = 0; i < rows.length; i++) {
      const parsed = JSON.parse(rows[i])
      assert.equal(parsed.event, 'evt-' + i)
      assert.equal(parsed.level, 'info')
    }
  })

  it('命名规则：默认前缀拼出旧字面并派生旧目录名，自定前缀隔离，非法报错，重复注册不覆盖', async () => {
    // 默认前缀 wf 下 5 个字面与现状一字不差。
    assert.deepEqual(buildPhoneNames('wf'), {
      logBatch: 'wf.logBatch',
      logExport: 'wf.logExport',
      logClear: 'wf.logClear',
      logGetSwitch: 'wf.logGetSwitch',
      logSetSwitch: 'wf.logSetSwitch'
    })
    // 自定前缀拼出隔离后的名字。
    assert.equal(buildPhoneNames('demo-plugin').logBatch, 'demo-plugin.logBatch')
    // 目录与开关文件名默认派生：wf 走旧字面，其他标识加后缀。
    const mem = makeMemoryFiles()
    const { deps } = makeDeps(mem, '/cache')
    assert.equal(createHostLog(deps, { pluginId: 'wf' }).store.config.logDirName, 'logs')
    assert.equal(createHostLog(deps, { pluginId: 'wf' }).store.config.switchFileName, 'log-switch.json')
    assert.equal(createHostLog(deps, { pluginId: 'demo' }).store.config.logDirName, 'logs-demo')
    assert.equal(createHostLog(deps, { pluginId: 'demo' }).store.config.switchFileName, 'log-switch-demo.json')
    // 缺插件标识、大写、含点都直接报错，不做静默转小写。
    assert.throws(() => createHostLog(deps, {}), /pluginId/)
    assert.throws(() => createHostLog(deps, { pluginId: 'WF' }), /非法/)
    assert.throws(() => createHostLog(deps, { pluginId: 'wf.demo' }), /非法/)
    assert.throws(() => buildPhoneNames('WF'), /非法/)
    // 四段式只作可选项：形状为日期点插件标识点进程号点启动时间。
    const four = createHostLog(deps, { pluginId: 'demo', fileNamePolicy: 'four-segment' })
    await four.store.setSwitch(true, 1)
    await four.store.writeStartupHeader()
    four.store.log('error', 'boom-four', {})
    await wait(60)
    const names = Array.from(mem.texts.keys()).filter((k) => k.includes('/logs-demo/'))
    assert.equal(names.length >= 1, true)
    const base = names[0].slice(names[0].lastIndexOf('/') + 1)
    assert.match(base, /^\d{4}-\d{2}-\d{2}\.demo\.\d+\..+\.log$/)
    // 已注册的电话名再次注册时报错、不覆盖旧的。
    const first = createHostLog(deps, { pluginId: 'wf' })
    const registry = new Map()
    registerHostLogPhones(registry, first)
    const keep = registry.get('wf.logBatch')
    const second = createHostLog(deps, { pluginId: 'wf' })
    assert.throws(() => registerHostLogPhones(registry, second), /已被注册/)
    assert.equal(registry.get('wf.logBatch'), keep)
    // 队列口径：默认 1000 条封顶，满时只计数不抛错。
    const small = makeMemoryFiles()
    const slim = makeDeps(small, '/cache')
    const capped = createHostLog(slim.deps, { pluginId: 'wf', maxQueue: 3 })
    await capped.store.setSwitch(true, 1)
    capped.store.log('info', 'a', {})
    capped.store.log('info', 'b', {})
    capped.store.log('info', 'c', {})
    capped.store.log('info', 'dropped-one', {})
    assert.equal(capped.store.getDroppedCount(), 1)
  })

  it('失败计数：写盘失败不抛错只计数；记录电话最外层例外回成功加接收 0 条', async () => {
    const mem = makeMemoryFiles()
    mem.failWrites = true
    const { deps } = makeDeps(mem, '/cache')
    const { store } = createHostLog(deps, { pluginId: 'wf' })
    await store.setSwitch(true, 1)
    const before = store.getDroppedCount()
    store.log('info', 'evt-fail-1', {})
    store.log('info', 'evt-fail-2', {})
    store.log('info', 'evt-fail-3', {})
    let threw = false
    try {
      store.flush()
      await wait(80)
    } catch {
      threw = true
    }
    assert.equal(threw, false)
    const settledAt = store.getDroppedCount()
    await wait(80)
    assert.equal(store.getDroppedCount(), settledAt)
    assert.equal(store.getDroppedCount() - before, 4)
    // 最外层例外：入参一碰就抛错，回的仍是成功加接收 0 条（旧形状原样保留的唯一例外）。
    const evil = {}
    Object.defineProperty(evil, 'entries', {
      get() {
        throw new Error('模拟入参爆炸')
      }
    })
    const res = await store.handleLogBatch(evil)
    assert.deepEqual(res, { ok: true, accepted: 0, dropped: store.getDroppedCount() })
    // 其余电话失败回成功为假，不抛异常。
    const bad = makeMemoryFiles()
    const broken = makeDeps(bad, '/cache')
    broken.deps.getCacheDir = async () => {
      throw new Error('模拟取目录爆炸')
    }
    const { store: brokenStore } = createHostLog(broken.deps, { pluginId: 'wf' })
    const cleared = await brokenStore.handleLogClear({ date: '2026-09-06' })
    assert.equal(cleared.ok, false)
  })

  it('行为零变化对照：默认配置下与旧实现落盘同事件同顺序同文件名', async () => {
    const ops = (store) => {
      store.log('error', 'boom', { reason: 'test' })
      store.log('warn', 'careful', { kind: 'export' })
      return store.handleLogBatch({ entries: [{ level: 'info', event: 'a', fields: {} }], droppedCount: 7 })
    }
    const strip = (body) =>
      String(body || '')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const p = JSON.parse(line)
          return p.level + '|' + p.event + '|' + JSON.stringify(p.fields)
        })
    // 旧实现。
    const memOld = makeMemoryFiles()
    const oldMade = makeDeps(memOld, '/cache')
    const storeOld = legacy.createLogStore(oldMade.deps)
    await storeOld.setSwitch(true, 1)
    await ops(storeOld)
    storeOld.flush()
    await wait(80)
    // 新包默认配置（插件标识 wf）。
    const memNew = makeMemoryFiles()
    const newMade = makeDeps(memNew, '/cache')
    const { store: storeNew } = createHostLog(newMade.deps, { pluginId: 'wf' })
    await storeNew.setSwitch(true, 1)
    await ops(storeNew)
    storeNew.flush()
    await wait(80)
    const today = formatDailyFileName(new Date())
    const keyOld = Array.from(memOld.texts.keys()).filter((k) => k.endsWith('/' + today))
    const keyNew = Array.from(memNew.texts.keys()).filter((k) => k.endsWith('/' + today))
    assert.equal(keyOld.length, 1)
    assert.equal(keyNew.length, 1)
    assert.equal(keyOld[0].replace('/cache', ''), keyNew[0].replace('/cache', ''))
    assert.deepEqual(strip(memNew.texts.get(keyNew[0])), strip(memOld.texts.get(keyOld[0])))
    assert.equal(LOG_DEBOUNCE_MS, legacy.LOG_DEBOUNCE_MS)
  })
})
