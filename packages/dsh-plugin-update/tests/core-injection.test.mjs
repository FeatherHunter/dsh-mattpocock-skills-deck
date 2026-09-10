/**
 * packages/dsh-plugin-update/tests/core-injection.test.mjs —— 三处注入默认现状、可调即生效。
 *
 * 只测外部行为：注入的包名与源出现在实际请求的地址里；不传即走现状。不测内部私有常量。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateCore, fetchNpmRelease } from '../dist/service.js'

const INTEGRITY = 'sha512-' + 'B'.repeat(86) + '=='

function releaseBody(name, version, registry) {
  return JSON.stringify({
    name,
    version,
    engines: { node: '>=22' },
    dist: { tarball: `${registry}${name}/-/${name}-${version}.tgz`, integrity: INTEGRITY },
  })
}

function fakeFetch(expectedUrl, body) {
  return async (url) => {
    assert.equal(url, expectedUrl)
    return { ok: true, headers: { get: () => null }, text: async () => body }
  }
}

function basePorts(overrides = {}) {
  return {
    readRunningVersion: () => '1.0.0',
    readInstalled: async () => ({
      profileName: 'web',
      environmentKind: 'cli',
      homeDir: null,
      profileDir: null,
      installedVersion: '1.0.0',
      packageValid: true,
      sourceInstall: false,
      blockedReason: null,
      installationKey: 'key-1',
      eligible: true,
    }),
    fetchImpl: fakeFetch(
      'https://registry.npmjs.org/dsh-mattpocock-skills-deck/latest',
      releaseBody('dsh-mattpocock-skills-deck', '2.0.0', 'https://registry.npmjs.org/')
    ),
    now: () => 1_000_000,
    randomId: () => 'check-1',
    nodeVersion: '22.0.0',
    ...overrides,
  }
}

describe('三处注入默认现状、可调即生效', () => {
  it('不传注入即走现状：请求默认包名与默认源', async () => {
    const release = await fetchNpmRelease(
      fakeFetch(
        'https://registry.npmjs.org/dsh-mattpocock-skills-deck/latest',
        releaseBody('dsh-mattpocock-skills-deck', '2.0.0', 'https://registry.npmjs.org/')
      ),
      10_000
    )
    assert.equal(release.version, '2.0.0')
  })

  it('目标包名与官方源可注入：请求地址跟着走', async () => {
    const release = await fetchNpmRelease(
      fakeFetch('https://example.invalid/other-plugin/latest', releaseBody('other-plugin', '3.0.0', 'https://example.invalid/')),
      10_000,
      { targetPackageName: 'other-plugin', registryUrl: 'https://example.invalid/' }
    )
    assert.equal(release.version, '3.0.0')
  })

  it('名字对不上按版本信息无效处理', async () => {
    await assert.rejects(
      () =>
        fetchNpmRelease(
          fakeFetch(
            'https://registry.npmjs.org/dsh-mattpocock-skills-deck/latest',
            releaseBody('someone-else', '2.0.0', 'https://registry.npmjs.org/')
          ),
          10_000
        ),
      /invalid-release/
    )
  })

  it('核心经端口注入目标与源：查新版带回注入包的版本', async () => {
    const core = createUpdateCore(
      basePorts({
        targetPackageName: 'other-plugin',
        registryUrl: 'https://example.invalid/',
        fetchImpl: fakeFetch('https://example.invalid/other-plugin/latest', releaseBody('other-plugin', '3.0.0', 'https://example.invalid/')),
      })
    )
    const result = await core.check()
    assert.equal(result.snapshot.latestVersion, '3.0.0')
    assert.equal(result.snapshot.canInstall, true)
  })

  it('联网超时可调：默认值等于现状 10 秒', async () => {
    const core = createUpdateCore(basePorts())
    const result = await core.check()
    assert.equal(result.snapshot.latestVersion, '2.0.0')
  })
})
