/**
 * packages/dsh-plugin-update/tests/gate.test.mjs —— 门禁模板自查（#584 落地门禁模板）。
 *
 * 给第二个接入更新包的插件照抄：字段白名单与三类计数检查、空模板随包发布、
 * 双前缀串扰（两家同机不串电话名目录锁）、无新依赖、数组无 shell。
 * 只用 Node 自带测试能力（node:test），不引入新的测试框架。
 * 网络、落盘（除隔离断言的临时目录）、子进程、桌面服务全用假件或临时目录，不碰真机。
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const gateUrl = pathToFileURL(path.join(PKG_DIR, 'dist', 'gate.js')).href + '?x=' + Date.now()
const gate = await import(gateUrl)
const { parseEventListManifest, checkEventFields, checkEventCounts } = gate
const host = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'host.js')).href + '?x=' + Date.now())
const store = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'store.js')).href + '?x=' + Date.now())

function shortHash(text) {
  return createHash('sha256').update(String(text)).digest('hex').slice(0, 24)
}

// 一份手写小清单：两常驻、一按需、一自监控，计数自报一致。
function makeSample() {
  return {
    version: 1,
    pluginId: 'my-plugin',
    counts: { resident: 2, ondemand: 1, selfmon: 1 },
    events: {
      'host.call': {
        level: 'info',
        kind: 'resident',
        fields: ['method', 'latencyMs', 'ok', 'kind', 'pluginId']
      },
      'update.install.exec': {
        level: 'info',
        kind: 'resident',
        fields: ['route', 'ok', 'exitCode', 'durationMs', 'pluginId'],
        codes: [],
        rules: []
      },
      'chain.cache.miss': {
        level: 'debug',
        kind: 'ondemand',
        fields: ['keyHash', 'lang', 'reason'],
        guard: '按事件，有穿透才记'
      },
      'log.persist.fail': {
        level: 'warn',
        kind: 'selfmon',
        fields: ['op', 'reason', 'dirHash'],
        codes: ['H_CWD']
      }
    }
  }
}

describe('门禁模板：空模板随包发布', () => {
  it('空模板合法：读包内模板，验形通过，计数全零一致', () => {
    const raw = readFileSync(path.join(PKG_DIR, 'event-list.template.json'), 'utf8')
    const manifest = parseEventListManifest(JSON.parse(raw))
    assert.equal(manifest.version, 1)
    assert.deepEqual(Object.keys(manifest.events), [])
    assert.deepEqual(checkEventCounts(manifest), { ok: true, problems: [] })
  })

  it('模板进发布白名单：files 含模板，npm pack 能带上', () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'))
    assert.ok(Array.isArray(pkg.files))
    assert.ok(pkg.files.includes('event-list.template.json'))
    assert.ok(pkg.files.includes('dist'))
  })
})

describe('门禁模板：字段白名单与三类计数检查', () => {
  it('白名单通过：清单里的事件配清单里的字段，全过', () => {
    const manifest = parseEventListManifest(makeSample())
    const got = checkEventFields(manifest, 'host.call', ['method', 'latencyMs', 'ok', 'kind', 'pluginId'])
    assert.deepEqual(got, { ok: true, unknownEvent: false, unknownFields: [] })
  })

  it('白名单揪出未知字段：把名单带回，不误伤已知字段', () => {
    const manifest = parseEventListManifest(makeSample())
    const got = checkEventFields(manifest, 'host.call', ['method', 'token'])
    assert.equal(got.ok, false)
    assert.equal(got.unknownEvent, false)
    assert.deepEqual(got.unknownFields, ['token'])
  })

  it('未知事件名算不通过：拼错名或漏登记都拦下', () => {
    const manifest = parseEventListManifest(makeSample())
    const got = checkEventFields(manifest, 'host.call2', ['method'])
    assert.deepEqual(got, { ok: false, unknownEvent: true, unknownFields: [] })
  })

  it('计数检查通过：三类实际条数与自报一致', () => {
    const manifest = parseEventListManifest(makeSample())
    assert.deepEqual(checkEventCounts(manifest), { ok: true, problems: [] })
  })

  it('计数对不上被揪出：增删事件不同步改 counts 就红', () => {
    const sample = makeSample()
    sample.counts.resident = 1
    const manifest = parseEventListManifest(sample)
    const got = checkEventCounts(manifest)
    assert.equal(got.ok, false)
    assert.equal(got.problems.length, 1)
    assert.match(got.problems[0], /resident/)
  })

  it('非法形状直接报中文错：级别写错', () => {
    const sample = makeSample()
    sample.events['host.call'].level = 'fatal'
    assert.throws(() => parseEventListManifest(sample), /level 只许/)
  })

  it('非法形状直接报中文错：条目多出不认识的键（多半是拼写错误）', () => {
    const sample = makeSample()
    sample.events['host.call'].fileds = sample.events['host.call'].fields
    assert.throws(() => parseEventListManifest(sample), /不认识的键 fileds/)
  })

  it('路径形式被拦下：包不读盘，调用方自己读成对象再传', () => {
    assert.throws(() => parseEventListManifest('event-list.json'), /自己读成对象再传入/)
  })

  it('数组形式同样被拦下：只收对象，与坏对象同口径', () => {
    assert.throws(() => parseEventListManifest([]), /只收对象形式/)
  })

  it('宿主入口同样导出检查器：包根可达', () => {
    assert.equal(typeof host.parseEventListManifest, 'function')
    assert.equal(typeof host.checkEventFields, 'function')
    assert.equal(typeof host.checkEventCounts, 'function')
    assert.deepEqual(checkEventCounts(host.parseEventListManifest(makeSample())), { ok: true, problems: [] })
  })
})

describe('门禁模板：双前缀串扰（两家同机不串电话名目录锁）', () => {
  let homeDir = ''
  let profileDir = ''

  before(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'dpu-gate-home-'))
    profileDir = mkdtempSync(join(tmpdir(), 'dpu-gate-profile-'))
  })

  after(() => {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(profileDir, { recursive: true, force: true })
  })

  it('电话名互不相撞：默认 wf 与新前缀拼出的三名字全不同', () => {
    const { buildPhoneNames } = host
    const first = buildPhoneNames('wf')
    const second = buildPhoneNames('other')
    for (const action of ['updateStatus', 'updateCheck', 'updateInstall']) {
      assert.notEqual(first[action], second[action])
    }
    assert.deepEqual(first, {
      updateStatus: 'wf.updateStatus',
      updateCheck: 'wf.updateCheck',
      updateInstall: 'wf.updateInstall'
    })
  })

  it('落盘目录互不相撞：同机同使用范围下两家目录与锁文件全不同', () => {
    const first = store.pathsForUpdate(homeDir, 'plugin-a', profileDir)
    const second = store.pathsForUpdate(homeDir, 'plugin-b', profileDir)
    assert.notEqual(first.directory, second.directory)
    assert.notEqual(first.state, second.state)
    assert.notEqual(first.lock, second.lock)
    assert.notEqual(first.backup, second.backup)
    assert.equal(first.directory, join(homeDir, 'updates', 'plugin-a', shortHash(profileDir)))
    assert.equal(second.directory, join(homeDir, 'updates', 'plugin-b', shortHash(profileDir)))
  })

  it('锁互不相撞：两家各拿各的锁，互不阻塞', async () => {
    const first = store.createUpdateDiskPorts(homeDir, 'plugin-a', profileDir)
    const second = store.createUpdateDiskPorts(homeDir, 'plugin-b', profileDir)
    assert.notEqual(first.paths.lock, second.paths.lock)
    assert.equal(await first.tryAcquireLock('a-1'), true)
    // 第二家拿自己的锁不受第一家影响。
    assert.equal(await second.tryAcquireLock('b-1'), true)
    await first.releaseLock('a-1')
    await second.releaseLock('b-1')
    // 同一家同一目录复用同一把锁文件（证明同家走同一把锁，不是每调一次换一把）。
    const again = store.createUpdateDiskPorts(homeDir, 'plugin-a', profileDir)
    assert.equal(again.paths.lock, first.paths.lock)
    assert.equal(await again.tryAcquireLock('a-2'), true)
    await again.releaseLock('a-2')
  })
})

describe('门禁模板：无新依赖与数组无 shell', () => {
  it('零运行时依赖：package.json 无 dependencies，包内不引用外部包', async () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'))
    const deps = pkg.dependencies || {}
    assert.deepEqual(Object.keys(deps), [])
    const { readdirSync } = await import('node:fs')
    const srcDir = path.join(PKG_DIR, 'src')
    const files = readdirSync(srcDir).filter((n) => n.endsWith('.ts'))
    assert.ok(files.includes('gate.ts'))
    for (const name of files) {
      const raw = readFileSync(path.join(srcDir, name), 'utf8')
      // 去注释后再扫导入，避免注释里的示例命令被误伤。
      const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
      for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]
        const ok = spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('node:')
        assert.ok(ok, name + ' 不引用外部包（命中 ' + spec + '）')
      }
    }
  })

  it('数组无 shell：执行器只走参数数组，不经 shell、不用 PATH 名、不按系统分支', () => {
    const text = readFileSync(path.join(PKG_DIR, 'src', 'store.ts'), 'utf8')
    // 有参数数组的形状。
    assert.match(text, /argv/)
    // 无 shell 字符串、无命令名字段。
    assert.ok(!/shell\s*:/.test(text), '执行器不给子进程能力传 shell 选项')
    assert.ok(!/execFile|execSync/.test(text), '执行器不用裸子进程')
    assert.ok(!/cmd\.exe/.test(text), '执行器不拼 Windows 垫片名')
    // 不按操作系统分支：包内不出现平台分支字面。
    assert.ok(!/process\.platform/.test(text), '执行器不按操作系统分支')
    // 配方侧同样无 shell：复查命令拼接文件。
    const commands = readFileSync(path.join(PKG_DIR, 'src', 'commands.ts'), 'utf8')
    assert.ok(!/shell\s*:/.test(commands))
    assert.ok(!/process\.platform/.test(commands))
  })
})
