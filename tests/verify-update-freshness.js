// verify-update-freshness.js — 更新核心新鲜度门禁（落地票 #540）
// 规则：
//   1) update-core/src/ 每个 TS 转译后必须与 src/shared/update/ 下同名 JS 逐字一致；
//      改了 TS 没跑 node update-core/build.mjs 就变红（转译口径直接复用 build.mjs，永不漂移）。
//   2) tsc --noEmit 必须通过（538 决议：转译之外另做类型检查）。
//   3) 只读行为契约（离线假适配器，直接调生成的 JS）：查状态不联网、快照恰好六字段
//      且不带钥匙、查新版有新版与无新版两种情形、凭证另交、安装桩诚实失败。
// 用法：node tests/verify-update-freshness.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const UNITS = [
  { ts: 'update-core/src/ports.ts', js: 'src/shared/update/ports.js' },
  { ts: 'update-core/src/service.ts', js: 'src/shared/update/service.js' },
]

async function main() {
  console.log('更新核心新鲜度门禁（#540：TS 改了 JS 没跟上就红）')

  // ---- 1) 新鲜度：逐字一致 ----
  let transpileUnit
  try {
    const buildMod = await import(pathToFileURL(path.join(ROOT, 'update-core', 'build.mjs')).href)
    transpileUnit = buildMod.transpileUnit
    check(typeof transpileUnit === 'function', '构建脚本导出同一转译口径 transpileUnit')
  } catch (e) {
    check(false, '构建脚本可加载（update-core/build.mjs）：' + (e && e.message))
    console.log('\n存在失败')
    process.exit(1)
  }
  for (const u of UNITS) {
    const tsName = path.basename(u.ts)
    let expected
    try {
      expected = transpileUnit(tsName)
    } catch (e) {
      check(false, u.ts + ' 转译成功：' + (e && e.message))
      continue
    }
    const jsAbs = path.join(ROOT, u.js)
    if (!fs.existsSync(jsAbs)) {
      check(false, u.js + ' 存在（请运行 node update-core/build.mjs 后提交）')
      continue
    }
    const actual = fs.readFileSync(jsAbs, 'utf8').replace(/\r\n/g, '\n')
    check(actual === expected, u.js + ' 与 ' + u.ts + ' 转译一致（不一致请跑 node update-core/build.mjs）')
  }
  const portsJs = fs.readFileSync(path.join(ROOT, 'src/shared/update/ports.js'), 'utf8')
  check(portsJs.includes('PORTS_SOURCE'), '插口生成物带模块标识 PORTS_SOURCE（空壳可追溯）')
  const serviceJs = fs.readFileSync(path.join(ROOT, 'src/shared/update/service.js'), 'utf8')
  check(!/from\s+['"]\.\.?[^'"]*['"]/.test(serviceJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')),
    '生成物零相对引用（同层互引门禁天然能过）')

  // ---- 2) 类型检查 ----
  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!fs.existsSync(tscBin)) {
    check(false, 'typescript 已安装（node_modules/typescript 缺失，请跑 pnpm install）')
  } else {
    const r = spawnSync(process.execPath, [tscBin, '-p', path.join(ROOT, 'update-core', 'tsconfig.json')], { encoding: 'utf8' })
    check(r.status === 0, 'tsc --noEmit 通过' + (r.status === 0 ? '' : '：' + ((r.stdout || '') + (r.stderr || '')).slice(0, 500)))
  }

  // ---- 3) 只读行为契约（离线假适配器） ----
  let core
  try {
    core = await import(pathToFileURL(path.join(ROOT, 'src/shared/update/service.js')).href)
  } catch (e) {
    check(false, '生成的核心可被动态加载：' + (e && e.message))
    console.log('\n存在失败')
    process.exit(1)
  }
  const { createUpdateCore, validVersion, compareVersions, satisfiesNodeRange } = core
  check(typeof createUpdateCore === 'function', '核心导出工厂函数 createUpdateCore')

  const PACKAGE = 'dsh-mattpocock-skills-deck'
  const REG = 'https://registry.npmjs.org/'
  const INTEGRITY = 'sha512-' + 'A'.repeat(86) + '=='
  const releaseBody = (version, nodeRange) => JSON.stringify({
    name: PACKAGE,
    version,
    engines: nodeRange ? { node: nodeRange } : {},
    dist: { tarball: `${REG}${PACKAGE}/-/${PACKAGE}-${version}.tgz`, integrity: INTEGRITY },
  })
  const fakeFetch = (version, nodeRange, counter) => async () => {
    counter.calls += 1
    return { ok: true, headers: { get: () => null }, text: async () => releaseBody(version, nodeRange) }
  }
  const baseEnv = () => ({
    profileName: 'web',
    environmentKind: 'cli',
    homeDir: '/home/u/.dsh',
    profileDir: '/home/u/.dsh/profiles/web',
    installedVersion: '1.7.14',
    packageValid: true,
    sourceInstall: false,
    blockedReason: null,
    installationKey: 'key-1',
    eligible: true,
  })
  const makeCore = (opts = {}) => {
    const counter = { calls: 0 }
    let nowValue = 1000000
    const c = createUpdateCore({
      readRunningVersion: () => '1.7.14',
      readInstalled: () => baseEnv(),
      fetchImpl: opts.fetchImpl || fakeFetch(opts.release || '1.7.14', opts.nodeRange, counter),
      now: () => nowValue,
      randomId: () => 'check-1',
      nodeVersion: opts.nodeVersion || '24.19.0',
    })
    return { c, counter, setNow: (v) => { nowValue = v } }
  }

  // 3a) 查状态只读本地不联网，快照恰好六字段
  {
    const { c } = makeCore({ fetchImpl: async () => { throw new Error('status 摸了网络') } })
    const snap = await c.status()
    const keys = Object.keys(snap).sort()
    const want = ['blockedReason', 'canInstall', 'installedVersion', 'job', 'latestVersion', 'runningVersion'].sort()
    check(JSON.stringify(keys) === JSON.stringify(want), '快照恰好六字段（实际 ' + keys.join(',') + '）')
    check(snap.runningVersion === '1.7.14' && snap.installedVersion === '1.7.14', '快照本地版本正确（运行=磁盘=1.7.14）')
    check(snap.latestVersion === null && snap.job === null, '没查过：远端版本与任务均为 null')
    check(!('checkId' in snap) && !('installationKey' in snap), '快照里没有钥匙（无检查编号与环境指纹）')
  }
  // 3b) 查新版：有新版
  {
    const { c } = makeCore({ release: '9.9.9' })
    const { snapshot, receipt } = await c.check()
    check(snapshot.latestVersion === '9.9.9' && snapshot.canInstall === true, '有新版：远端 9.9.9 且能装')
    check(!!receipt && receipt.checkId === 'check-1' && receipt.expiresAt > receipt.checkedAt, '凭证另交（含编号与有效期）')
    check(!('installationKey' in receipt), '凭证里没有环境指纹（指纹只留核心内存）')
  }
  // 3c) 查新版：无新版
  {
    const { c } = makeCore({ release: '1.7.14' })
    const { snapshot, receipt } = await c.check()
    check(snapshot.latestVersion === '1.7.14' && snapshot.canInstall === false, '无新版：远端等于运行版，不能装')
    check(receipt === null, '不能装时不交凭证（receipt 为 null）')
  }
  // 3d) 2 秒内重复点击只联网一次
  {
    const { c, counter, setNow } = makeCore({ release: '9.9.9' })
    await c.check()
    setNow(1001000)
    await c.check()
    check(counter.calls === 1, '2 秒内重复查只联网一次（实际 ' + counter.calls + ' 次）')
  }
  // 3e) 坏发行信息按版本信息无效处理，失败不缓存为成功
  {
    const badFetch = async () => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ name: '别人家的包', version: '9.9.9' }) })
    const counter = { calls: 0 }
    const counting = async (...a) => { counter.calls += 1; return badFetch(...a) }
    const c = createUpdateCore({
      readRunningVersion: () => '1.7.14',
      readInstalled: () => baseEnv(),
      fetchImpl: counting,
      now: () => 1000000,
      randomId: () => 'check-1',
      nodeVersion: '24.19.0',
    })
    let code = ''
    try {
      await c.check()
    } catch (e) {
      code = (e && e.code) || ''
    }
    check(code === 'invalid-release', '坏发行信息报 invalid-release（实际 ' + code + '）')
    const snap = await c.status()
    check(snap.canInstall === false && snap.latestVersion === null, '失败后不留远端版本、不标记能装')
  }
  // 3f) 运行环境不满足远端要求只给原因不给装
  {
    const { c } = makeCore({ release: '9.9.9', nodeRange: '>=99.0.0', nodeVersion: '24.19.0' })
    const { snapshot } = await c.check()
    check(snapshot.blockedReason === 'incompatible-node' && snapshot.canInstall === false, '运行环境不满足：原因 incompatible-node 且不能装')
  }
  // 3g) 装更新桩诚实失败
  {
    const { c } = makeCore()
    let code = ''
    try {
      await c.install({ checkId: 'check-1', requestId: 'req-1' })
    } catch (e) {
      code = (e && e.code) || ''
    }
    check(code === 'unsupported', '只读半程装更新报 unsupported（实际 ' + code + '）')
  }
  // 3h) 版本号小工具抽查
  check(validVersion('1.7.14') === true && validVersion('1.7.14-beta') === false, '纯数字三段才算合法版本（预发布拒绝）')
  check(compareVersions('1.7.15', '1.7.14') === 1 && compareVersions('1.7.14', '1.7.14') === 0, '版本比对正确')
  check(satisfiesNodeRange('20.0.0', '>=18.0.0') === true && satisfiesNodeRange('16.0.0', '>=18.0.0') === false, '运行环境范围判定正确')

  console.log(failed ? '\n存在失败' : '\n全部通过 — 更新核心新鲜度门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
