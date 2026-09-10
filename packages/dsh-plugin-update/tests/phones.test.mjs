/**
 * packages/dsh-plugin-update/tests/phones.test.mjs —— 宿主接线三电话的入参与回参、单例隔离、日志标识。
 *
 * 只测外部行为：在电话层传入不同前缀与标识断言名字与形状，在日志层断言标识字段存在。
 * 网络、落盘、子进程、桌面服务全用假件，不碰真机。
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHostUpdate, __resetSharedUpdateReaderForTests } from '../dist/host.js'

const RELEASE_VERSION = '9.9.9'
const TARGET = 'dsh-mattpocock-skills-deck'
const REGISTRY = 'https://registry.npmjs.org/'

function fakeFetch(targetName = TARGET) {
  return async (url) => {
    assert.equal(url, `${REGISTRY}${encodeURIComponent(targetName)}/latest`)
    return {
      ok: true,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          name: targetName,
          version: RELEASE_VERSION,
          engines: { node: '>=22' },
          dist: {
            tarball: `${REGISTRY}${targetName}/-/${targetName}-${RELEASE_VERSION}.tgz`,
            integrity: 'sha512-' + 'A'.repeat(86) + '==',
          },
        }),
    }
  }
}

function memoryStore() {
  let job = null
  let locked = null
  return {
    readJob: async () => job,
    writeJob: async (value) => {
      job = value
    },
    tryAcquireLock: async (id) => {
      if (locked !== null) return false
      locked = id
      return true
    },
    releaseLock: async (id) => {
      if (locked === id) locked = null
    },
    backupJob: async () => {},
  }
}

function eligibleEnv(installedVersion) {
  return {
    profileName: 'web',
    environmentKind: 'cli',
    homeDir: 'C:\\fake\\home',
    profileDir: 'C:\\fake\\profile',
    installedVersion,
    packageValid: true,
    sourceInstall: false,
    blockedReason: null,
    installationKey: 'fake-key',
    eligible: true,
  }
}

function makeHost({ pluginId, prefix, installedVersion = '1.0.0', fires, targetPackageName }) {
  const store = memoryStore()
  const host = createHostUpdate(
    {
      logCtx: { fire: (level, event, fields) => fires.push({ level, event, fields }) },
      readerOverrides: {
        runningVersion: '1.0.0',
        profileDir: 'C:\\fake\\profile',
        profileName: 'web',
        homeDir: 'C:\\fake\\home',
        fetchImpl: fakeFetch(targetPackageName ?? TARGET),
        now: () => 1_000_000,
        randomId: (() => {
          let n = 0
          return () => `id-${(n += 1)}`
        })(),
        nodeVersion: '22.0.0',
        environmentKind: 'cli',
        targetPackageName,
        readInstalled: async () => eligibleEnv(installedVersion),
        ...store,
        runInstall: async () => {},
      },
    },
    prefix === undefined ? { pluginId } : { pluginId, prefix }
  )
  return host
}

beforeEach(() => {
  __resetSharedUpdateReaderForTests()
})

describe('宿主接线三电话的入参与回参', () => {
  it('默认前缀下三名字与现状一字不差', () => {
    const fires = []
    const host = makeHost({ pluginId: 'dsh-mattpocock-skills-deck', fires })
    assert.deepEqual(host.phoneNames, {
      updateStatus: 'wf.updateStatus',
      updateCheck: 'wf.updateCheck',
      updateInstall: 'wf.updateInstall',
    })
    assert.deepEqual(Object.keys(host.handlers).sort(), ['wf.updateCheck', 'wf.updateInstall', 'wf.updateStatus'])
  })

  it('新插件传自己的前缀即隔离（电话名互不相撞）', () => {
    const fires = []
    const host = makeHost({ pluginId: 'other-plugin', prefix: 'other', fires })
    assert.equal(host.phoneNames.updateStatus, 'other.updateStatus')
    assert.equal(host.phoneNames.updateCheck, 'other.updateCheck')
    assert.equal(host.phoneNames.updateInstall, 'other.updateInstall')
  })

  it('查状态只读本地：快照恰好六字段，不联网', async () => {
    const fires = []
    let fetched = 0
    const store = memoryStore()
    const host = createHostUpdate(
      {
        logCtx: { fire: (level, event, fields) => fires.push({ level, event, fields }) },
        readerOverrides: {
          runningVersion: '1.0.0',
          profileDir: 'C:\\fake\\profile',
          profileName: 'web',
          homeDir: 'C:\\fake\\home',
          fetchImpl: async () => {
            fetched += 1
            throw new Error('must-not-fetch')
          },
          now: () => 1_000_000,
          randomId: () => 'id-1',
          nodeVersion: '22.0.0',
          environmentKind: 'cli',
          readInstalled: async () => eligibleEnv('1.0.0'),
          ...store,
          runInstall: async () => {},
        },
      },
      { pluginId: 'dsh-mattpocock-skills-deck' }
    )
    const out = await host.handlers['wf.updateStatus']({})
    assert.equal(out.ok, true)
    assert.deepEqual(Object.keys(out.snapshot).sort(), ['blockedReason', 'canInstall', 'installedVersion', 'job', 'latestVersion', 'runningVersion'])
    assert.equal(fetched, 0)
  })

  it('查新版联网一次：有新版即带凭证，成功包形状冻结', async () => {
    const fires = []
    const host = makeHost({ pluginId: 'dsh-mattpocock-skills-deck', fires })
    const out = await host.handlers['wf.updateCheck']({})
    assert.equal(out.ok, true)
    assert.equal(out.snapshot.latestVersion, RELEASE_VERSION)
    assert.equal(out.snapshot.canInstall, true)
    assert.ok(out.receipt && typeof out.receipt.checkId === 'string')
  })

  it('装更新拿凭证加请求编号提交：凭证不对即诚实失败', async () => {
    const fires = []
    const host = makeHost({ pluginId: 'dsh-mattpocock-skills-deck', fires })
    const bad = await host.handlers['wf.updateInstall']({ checkId: 'wrong', requestId: 'req-1' })
    assert.equal(bad.ok, false)
    assert.equal(bad.error, 'check-expired')
  })

  it('外面世界的脏错误收敛为检查失败', async () => {
    const fires = []
    const store = memoryStore()
    const host = createHostUpdate(
      {
        logCtx: { fire: (level, event, fields) => fires.push({ level, event, fields }) },
        readerOverrides: {
          runningVersion: '1.0.0',
          profileDir: 'C:\\fake\\profile',
          profileName: 'web',
          homeDir: 'C:\\fake\\home',
          fetchImpl: fakeFetch(),
          now: () => 1_000_000,
          randomId: () => 'id-1',
          nodeVersion: '22.0.0',
          environmentKind: 'cli',
          readInstalled: async () => {
            throw Object.assign(new Error('weird disk'), { code: 'EIO' })
          },
          ...store,
          runInstall: async () => {},
        },
      },
      { pluginId: 'dsh-mattpocock-skills-deck' }
    )
    const out = await host.handlers['wf.updateStatus']({})
    assert.equal(out.ok, false)
    assert.equal(out.error, 'check-failed')
  })

  it('单例复用键强制含标识：同前缀不同标识不串内存状态', async () => {
    const firesA = []
    const firesB = []
    const hostA = makeHost({ pluginId: 'plugin-a', installedVersion: '1.0.0', fires: firesA })
    const hostB = makeHost({ pluginId: 'plugin-b', installedVersion: '2.0.0', fires: firesB })
    const outA = await hostA.handlers['wf.updateStatus']({})
    const outB = await hostB.handlers['wf.updateStatus']({})
    assert.equal(outA.snapshot.installedVersion, '1.0.0')
    assert.equal(outB.snapshot.installedVersion, '2.0.0')
  })
})

describe('三个旧事件的必填插件标识', () => {
  it('成功事件 5 键：旧 4 键加必填标识', async () => {
    const fires = []
    const host = makeHost({ pluginId: 'dsh-mattpocock-skills-deck', fires })
    await host.handlers['wf.updateStatus']({})
    const calls = fires.filter((f) => f.event === 'host.call')
    assert.equal(calls.length, 1)
    assert.deepEqual(Object.keys(calls[0].fields).sort(), ['kind', 'latencyMs', 'method', 'ok', 'pluginId'])
    assert.equal(calls[0].fields.pluginId, 'dsh-mattpocock-skills-deck')
  })

  it('失败事件 4 键：旧 3 键加必填标识', async () => {
    const fires = []
    const host = makeHost({ pluginId: 'my-plugin', prefix: 'my', fires })
    await host.handlers['my.updateInstall']({ checkId: 'wrong', requestId: 'req-1' })
    const fails = fires.filter((f) => f.event === 'host.call.fail')
    assert.equal(fails.length, 1)
    assert.deepEqual(Object.keys(fails[0].fields).sort(), ['errorHash', 'kind', 'method', 'pluginId'])
    assert.equal(fails[0].fields.pluginId, 'my-plugin')
  })
})
