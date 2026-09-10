/**
 * packages/dsh-plugin-update/tests/config.test.mjs —— 配置面外部行为（规格 #591 第 1 到 5 条）。
 *
 * 只测外部行为：默认值、非法抛错、电话名拼法。不测内部私有常量与函数名。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildPhoneNames, resolveUpdateConfig } from '../dist/config.js'

describe('公共入口的配置校验与默认值', () => {
  it('插件标识必填：不给即抛错', () => {
    assert.throws(() => resolveUpdateConfig({}), /pluginId/)
    assert.throws(() => resolveUpdateConfig({ pluginId: '' }), /pluginId/)
  })

  it('插件标识不得含路径分隔符', () => {
    assert.throws(() => resolveUpdateConfig({ pluginId: 'a/b' }), /路径分隔符/)
    assert.throws(() => resolveUpdateConfig({ pluginId: 'a\\b' }), /路径分隔符/)
  })

  it('其余全可选并带默认值（默认值等于现状）', () => {
    const config = resolveUpdateConfig({ pluginId: 'my-plugin' })
    assert.equal(config.prefix, 'wf')
    assert.equal(config.targetPackageName, 'dsh-mattpocock-skills-deck')
    assert.equal(config.registryUrl, 'https://registry.npmjs.org/')
    assert.equal(config.homeDir, null)
    assert.equal(config.checkTimeoutMs, 10_000)
    assert.equal(config.confirmationTtlMs, 10 * 60_000)
    assert.equal(config.installTimeoutMs, 15 * 60_000)
    assert.equal(config.panelPollMs, 1_000)
  })

  it('超时只卡下限：前三项须为有限大于 0 的数，不设紧上界', () => {
    assert.throws(() => resolveUpdateConfig({ pluginId: 'p', checkTimeoutMs: 0 }), /checkTimeoutMs/)
    assert.throws(() => resolveUpdateConfig({ pluginId: 'p', confirmationTtlMs: -1 }), /confirmationTtlMs/)
    assert.throws(() => resolveUpdateConfig({ pluginId: 'p', installTimeoutMs: Number.NaN }), /installTimeoutMs/)
    // 慢网络插件调大不拦：很大的值照收。
    assert.equal(resolveUpdateConfig({ pluginId: 'p', checkTimeoutMs: 120_000 }).checkTimeoutMs, 120_000)
  })

  it('面板轮询不得小于 250 毫秒防止忙循环', () => {
    assert.throws(() => resolveUpdateConfig({ pluginId: 'p', panelPollMs: 100 }), /250/)
    assert.equal(resolveUpdateConfig({ pluginId: 'p', panelPollMs: 500 }).panelPollMs, 500)
  })

  it('默认电话名与现状一字不差（冻结）', () => {
    assert.deepEqual(buildPhoneNames('wf'), {
      updateStatus: 'wf.updateStatus',
      updateCheck: 'wf.updateCheck',
      updateInstall: 'wf.updateInstall',
    })
  })

  it('新插件传自己的前缀即隔离', () => {
    const names = buildPhoneNames('other')
    assert.equal(names.updateStatus, 'other.updateStatus')
    assert.equal(names.updateCheck, 'other.updateCheck')
    assert.equal(names.updateInstall, 'other.updateInstall')
  })
})
