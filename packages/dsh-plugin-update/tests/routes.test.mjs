/**
 * packages/dsh-plugin-update/tests/routes.test.mjs —— 安装路由与参数模板（规格 #591 第 4、12 条）。
 *
 * 只测外部行为：路由二选一、参数数组形状、桌面激活范围对不上转手工、子进程不用 PATH 名。
 * 子进程与桌面服务全用假件，不起真进程。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { installRecipe, manualCommand } from '../dist/commands.js'
import { createUpdateExecutor, resolveCliEntry } from '../dist/store.js'

const TARGET = 'dsh-mattpocock-skills-deck'
const REGISTRY = 'https://registry.npmjs.org/'

describe('安装执行配方（冻结五键，值可调）', () => {
  it('桌面宿主走桌面服务，普通宿主走自己起进程', () => {
    assert.equal(installRecipe({ profileName: 'web', version: '1.2.3', environmentKind: 'desktop' }).route, 'desktop-service')
    assert.equal(installRecipe({ profileName: 'web', version: '1.2.3', environmentKind: 'cli' }).route, 'cli-process')
  })

  it('宿主种类不是已知两种取值不给配方（诚实失败转手工命令），不猜', () => {
    assert.equal(installRecipe({ profileName: 'web', version: '1.2.3', environmentKind: 'unknown' }), null)
  })

  it('参数数组一律带精确版本、官方源与 --save-exact', () => {
    const recipe = installRecipe({ profileName: 'web', version: '1.2.3', environmentKind: 'cli' })
    assert.deepEqual(recipe.pluginArgs, ['add', '--save-exact', `${TARGET}@1.2.3`, `--registry=${REGISTRY}`])
    assert.equal(recipe.timeoutMs, 15 * 60_000)
  })

  it('目标包名、官方源、安装时限可注入，默认等于现状', () => {
    const recipe = installRecipe({
      profileName: 'web',
      version: '1.2.3',
      environmentKind: 'cli',
      targetPackageName: 'other-plugin',
      registryUrl: 'https://example.invalid/',
      timeoutMs: 60_000,
    })
    assert.deepEqual(recipe.pluginArgs, ['add', '--save-exact', 'other-plugin@1.2.3', '--registry=https://example.invalid/'])
    assert.equal(recipe.timeoutMs, 60_000)
  })

  it('使用范围名单独成段原样保留：不做引号包裹、不按空格拆分', () => {
    const recipe = installRecipe({ profileName: 'my profile', version: '1.2.3', environmentKind: 'cli' })
    // 使用范围名走配方顶层的 profileName 字段（执行器拼成独立的 argv 段），不进 pluginArgs。
    assert.equal(recipe.profileName, 'my profile')
    assert.ok(!recipe.pluginArgs.some((arg) => arg.includes('"my profile"')))
  })
})

describe('手工兜底命令（冻结形状）', () => {
  it('形状沿用 dsh plugin --profile <名> add <包>@<版本>', () => {
    const command = manualCommand({
      profileName: 'web',
      latestVersion: '1.2.3',
      installedVersion: '1.0.0',
      runningVersion: '1.0.0',
      jobTargetVersion: null,
      blockedReason: null,
      sourceInstall: false,
    })
    assert.equal(command, `dsh plugin --profile web add --save-exact ${TARGET}@1.2.3 --registry=${REGISTRY}`)
  })

  it('源码安装等不安全情形不给命令', () => {
    assert.equal(
      manualCommand({
        profileName: 'web',
        latestVersion: '1.2.3',
        installedVersion: '1.0.0',
        runningVersion: '1.0.0',
        jobTargetVersion: null,
        blockedReason: 'source-install',
        sourceInstall: false,
      }),
      null
    )
  })
})

describe('双宿主执行器（假件）', () => {
  it('桌面宿主：经桌面服务用参数数组拉起，不碰垫片不经 shell', async () => {
    const seen = []
    const fires = []
    const runInstall = createUpdateExecutor({
      environmentKind: 'desktop',
      profileDir: 'C:\\fake\\profile',
      desktopPnpm: {
        runPlugin: (args, dir, extra) => {
          seen.push({ args, dir, extra })
          return { done: Promise.resolve({ exitCode: 0 }) }
        },
      },
      desktopProfiles: { current: { dir: 'C:\\fake\\profile' } },
      pluginId: 'my-plugin',
      log: (level, event, fields) => fires.push({ level, event, fields }),
    })
    await runInstall({ version: '1.2.3', profileName: 'web', environmentKind: 'desktop' })
    assert.equal(seen.length, 1)
    assert.deepEqual(seen[0].args, ['add', '--save-exact', `${TARGET}@1.2.3`, `--registry=${REGISTRY}`])
    assert.equal(seen[0].dir, 'C:\\fake\\profile')
    const exec = fires.filter((f) => f.event === 'update.install.exec')
    assert.equal(exec.length, 1)
    assert.deepEqual(Object.keys(exec[0].fields).sort(), ['durationMs', 'exitCode', 'ok', 'pluginId', 'route'])
    assert.equal(exec[0].fields.route, 'desktop-service')
    assert.equal(exec[0].fields.pluginId, 'my-plugin')
  })

  it('桌面激活范围对不上宁可不装（诚实失败转手工命令）', async () => {
    let called = 0
    const runInstall = createUpdateExecutor({
      environmentKind: 'desktop',
      profileDir: 'C:\\fake\\profile',
      desktopPnpm: {
        runPlugin: () => {
          called += 1
          return { done: Promise.resolve({ exitCode: 0 }) }
        },
      },
      desktopProfiles: { current: { dir: 'C:\\fake\\other-profile' } },
      pluginId: 'my-plugin',
      log: () => {},
    })
    await assert.rejects(() => runInstall({ version: '1.2.3', profileName: 'web', environmentKind: 'desktop' }), /install-failed/)
    assert.equal(called, 0)
  })

  it('普通宿主：数组起进程，不经 shell、不用 PATH 名、不按系统分支', async () => {
    const seen = []
    const runInstall = createUpdateExecutor({
      environmentKind: 'cli',
      profileDir: 'C:\\fake\\profile',
      runtimeExecutable: 'C:\\fake\\node.exe',
      runtimeExecArgs: [],
      cliEntry: 'C:\\fake\\cli.js',
      subprocess: {
        spawn: (opts) => {
          seen.push(opts)
          return { done: Promise.resolve({ exitCode: 0 }) }
        },
      },
      pluginId: 'my-plugin',
      log: () => {},
    })
    await runInstall({ version: '1.2.3', profileName: 'web', environmentKind: 'cli' })
    assert.equal(seen.length, 1)
    const opts = seen[0]
    assert.ok(Array.isArray(opts.argv))
    assert.deepEqual(opts.argv, [
      'C:\\fake\\node.exe',
      'C:\\fake\\cli.js',
      'plugin',
      '--profile',
      'web',
      'add',
      '--save-exact',
      `${TARGET}@1.2.3`,
      `--registry=${REGISTRY}`,
    ])
    // 无 shell 字符串、无命令名：只有参数数组，没有 command/shell 键。
    assert.equal(opts.shell, undefined)
    assert.equal(opts.command, undefined)
  })
})

describe('CLI 入口反查（绝不用 PATH 名）', () => {
  // 反查内部用真路径解析（只注入清单读取与符号链接解析），期望地址同样经真解析求得，不写死分隔符。
  const cliFile = resolve('/fake/cli.js')
  const cliDir = dirname(cliFile)

  it('入口与包声明的可执行入口对上才返回', async () => {
    const entry = await resolveCliEntry(cliFile, {
      realpath: async (p) => p,
      readManifest: async (directory) => {
        if (directory === cliDir) return { name: '@deepseek-ai/dsh', bin: { dsh: './cli.js' } }
        return null
      },
    })
    assert.equal(entry, cliFile)
  })

  it('声明的入口与实际文件对不上返回 null，不猜', async () => {
    const entry = await resolveCliEntry(resolve('/fake/other.js'), {
      realpath: async (p) => p,
      readManifest: async (directory) => {
        if (directory === cliDir) return { name: '@deepseek-ai/dsh', bin: { dsh: './cli.js' } }
        return null
      },
    })
    assert.equal(entry, null)
  })

  it('含空字节的输入直接返回 null', async () => {
    assert.equal(await resolveCliEntry('a\0b'), null)
  })
})
