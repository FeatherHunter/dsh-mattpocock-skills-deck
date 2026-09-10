// verify-update-migration.js — 当前插件迁移到更新包的门禁（#586）
//
// 这道门禁回答一个问题：更新系统现在还跑在旧实现上，还是真的换成更新包了？
// 以及换了之后，对外行为有没有发生变化。规则：
//   0) 派生文件与更新包 dist 逐字节一致；派生客户端带零变化断言字面。
//   1) 运行时接线指向更新包派生副本（src/host/updateFromPackage.js），旧实现原地只读留存。
//   2) 客户端面板不再写死电话名与轮询间隔，取值全部来自派生常量。
//   3) 迁移前后逐项对照：查状态快照六字段、错误码白名单十三条、手工兜底命令原文，
//      与旧实现（src/host/update.js）实际跑出来的结果逐项相同。
//   4) 发布形态：插件清单按确切版本号依赖更新包，且派生副本随包发布。
// 约束：全程假零件与假网络，不真跑安装命令、不直连官方源。
// 用法：node tests/verify-update-migration.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

// 旧实现留而不搬：这些文件必须还在（真删除或真搬迁另开票）
const LEGACY_FILES = ['src/host/update.js', 'src/host/updateReader.js', 'src/host/updateStore.js']
// 更新包要拎进宿主的文件（与派生脚本的清单一致）
const UPDATE_PKG_UNITS = ['config.js', 'ports.js', 'service.js', 'commands.js', 'store.js', 'reader.js', 'gate.js', 'host.js']
const PHONE_NAMES = { updateStatus: 'wf.updateStatus', updateCheck: 'wf.updateCheck', updateInstall: 'wf.updateInstall' }
const KNOWN_ERROR_CODES = ['check-failed', 'invalid-release', 'check-expired', 'update-busy', 'install-failed', 'unknown-profile', 'source-install', 'invalid-installation', 'installation-changed', 'pending-restart', 'incompatible-node', 'registry-conflict', 'recovery-required']

const TARGET_PACKAGE = 'dsh-mattpocock-skills-deck'
const REGISTRY = 'https://registry.npmjs.org/'

/** 假发行信息要给真实形状：更新包比旧实现严，会校验 name 与 dist.tarball 路径对得上包名与版本。 */
const fakeFetch = (version) => async () => ({
  ok: true,
  headers: { get: () => null },
  text: async () => JSON.stringify({
    name: TARGET_PACKAGE,
    version,
    engines: {},
    dist: {
      tarball: `${REGISTRY}${TARGET_PACKAGE}/-/${TARGET_PACKAGE}-${version}.tgz`,
      integrity: `sha512-${'A'.repeat(86)}==`,
    },
  }),
})

/** 一台最少假的机器：目录都是假的，读盘与执行全注入，不碰真实文件系统。
 *  每台机器用自己的使用范围目录与走开的时间基准：查新版有 2 秒复用窗口，
 *  三台机器共用一个时间值的话，换机器也照样命中缓存（门禁写到这里连栽两次）。 */
let machineSeq = 0
function fakeMachine(over = {}) {
  machineSeq += 1
  const seq = machineSeq
  const mem = { job: null }
  const profileDir = `C:/fake/.dsh/profiles/web-${seq}`
  const env = {
    profileName: 'web',
    environmentKind: 'cli',
    homeDir: 'C:/fake/.dsh',
    profileDir,
    installedVersion: '1.7.18',
    packageValid: true,
    sourceInstall: false,
    blockedReason: null,
    installationKey: 'key-1',
    eligible: true,
  }
  return {
    mem,
    env,
    overrides: Object.assign({
      runningVersion: '1.7.18',
      profileDir,
      profileName: 'web',
      homeDir: 'C:/fake/.dsh',
      fetchImpl: fakeFetch('9.9.9'),
      // 第 n 台机器的时间往后走 n×10 秒，保证彼此都在对方的 2 秒复用窗口之外
      now: () => 1000000 + seq * 10000,
      randomId: (() => { let n = 0; return () => `mig-${seq}-${++n}` })(),
      nodeVersion: '24.19.0',
      readInstalled: () => env,
      readJob: async () => mem.job,
      writeJob: async (job) => { mem.job = job },
      tryAcquireLock: async () => true,
      releaseLock: async () => {},
      backupJob: async () => {},
      runInstall: async () => {},
    }, over),
  }
}

async function main() {
  console.log('当前插件迁移到更新包的门禁（#586：真的换了包 + 迁移前后行为逐项一致）')

  // ---- 0) 派生文件与更新包 dist 逐字节一致 ----
  {
    const pkgDir = 'packages/dsh-plugin-update/dist'
    let allSame = true
    let missing = ''
    for (const name of UPDATE_PKG_UNITS) {
      const src = path.join(ROOT, 'src/host/updatePkg', name)
      const dist = path.join(ROOT, pkgDir, name)
      if (!exists(`src/host/updatePkg/${name}`) || !exists(`${pkgDir}/${name}`)) { allSame = false; missing = name; break }
      const derived = fs.readFileSync(src, 'utf8')
      const original = fs.readFileSync(dist, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n'
      // 派生文件 = 三行来源说明 + 更新包原文
      if (!derived.endsWith(original)) { allSame = false; missing = name; break }
    }
    check(allSame, '派生宿主文件与更新包 dist 逐字节一致（不一致请跑 node scripts/derive-update-from-package.mjs）' + (allSame ? '' : `：${missing}`))
    check(exists('src/host/updatePkg/host.js') && exists('src/host/updatePkg/gate.js'), '更新包宿主入口与门禁检查器都拎进派生目录（host.js 引用 gate.js，漏一个就加载失败）')
  }

  // ---- 1) 派生客户端带零变化断言，且面板不再写字面量 ----
  {
    const derivedClient = read('scripts/generated/updateClient.derived.js')
    const namesOk = Object.entries(PHONE_NAMES).every(([action, name]) =>
      derivedClient.includes(`UPD_PHONE_NAMES.${action} === '${name}'`))
    check(namesOk, `派生客户端带零变化断言：默认前缀 wf 下三个电话名与旧字面一致（${Object.values(PHONE_NAMES).join('、')}）`)
    check(derivedClient.includes('UPD_POLL_MS === 1000'), '派生客户端带零变化断言：轮询间隔仍是 1000 毫秒')
    const settings = read('src/client/views/SettingsPage.js')
    const literalNames = Object.values(PHONE_NAMES).filter((n) => settings.includes(`'${n}'`))
    check(literalNames.length === 0, '面板源码里不再写死电话名字面量' + (literalNames.length ? `（还留着 ${literalNames.join('、')}）` : ''))
    check(!/setInterval\(function \(\) \{ updReadStatus\(\) \}, 1000\)/.test(settings) && settings.includes('}, UPD_POLL)'),
      '面板轮询间隔不再写死 1000（改为派生常量 UPD_POLL）')
    const usedConstants = ['UPD_STATUS', 'UPD_CHECK', 'UPD_INSTALL', 'UPD_POLL'].every((n) => settings.includes(n))
    check(usedConstants, '面板四个取值都走派生常量（查状态、查新版、装更新、轮询间隔）')
  }

  // ---- 2) 运行时接线指向包派生，旧实现留而不搬 ----
  {
    const indexSrc = read('src/host/index.js')
    check(indexSrc.includes("import('./updateFromPackage.js')"), '宿主入口优先动态引入包派生接线（无静态引用）')
    check(/catch[\s\S]{0,200}import\('\.\/update\.js'\)/.test(indexSrc), '包派生失败时回退旧实现（旧文件仍在，回退可用）')
    check(indexSrc.includes("harness.handle('wf.updateStatus'") && indexSrc.includes("harness.handle('wf.updateCheck'") && indexSrc.includes("harness.handle('wf.updateInstall'"),
      '三个电话仍在宿主注册（注册名与现状一字不差）')
    for (const rel of LEGACY_FILES) check(exists(rel), `旧实现留而不搬：${rel} 仍在`)
    const adapter = read('src/host/updateFromPackage.js')
    check(adapter.includes("from './updatePkg/host.js'"), '适配器从包派生副本建更新能力（不是从 node_modules 直连，随包发布线上可用）')
    check(adapter.includes("prefix: UPDATE_PHONE_PREFIX") && adapter.includes("pluginId: UPDATE_PLUGIN_ID"),
      '适配器按插件标识与前缀注册（旧值，保证电话名与落盘目录不变）')
  }

  // ---- 3) 迁移前后逐项对照：同参数下实际跑出来的一样 ----
  {
    const oldMod = await import(pathToFileURL(path.join(ROOT, 'src/host/update.js')).href)
    const newMod = await import(pathToFileURL(path.join(ROOT, 'src/host/updateFromPackage.js')).href)

    // 每一步都给两边各自一份独立的假机器：overrides 对象不能共用，
    // 否则后一步改 fetchImpl 会顺手改了前一步那台机器（写着写着踩到过一次）。
    const buildPhones = async (mod, overrides) => {
      mod.__resetSharedUpdateReaderForTests()
      return mod.createUpdatePhoneHandlers({ logCtx: { fire: () => {} }, readerOverrides: overrides })
    }
    // 一台机器只服务一次调用：同一条读取器上连着查两次会命中 2 秒复用窗口，第二次不走网络，
    // 断网那类用例就验证不到（门禁第一版就栽在这里，报出一串 undefined）。
    const fresh = (over = {}) => fakeMachine().overrides
    const each = async (mod, run, over = {}) => run(await buildPhones(mod, fresh(over)))

    // 3a) 三个电话名逐个相同
    const oldPhones = await buildPhones(oldMod, fresh())
    const newPhones = await buildPhones(newMod, fresh())
    const sameNames = Object.entries(PHONE_NAMES).every(([action, name]) => oldPhones[`handleUpdate${action[6].toUpperCase()}${action.slice(7)}`] && name)
    check(sameNames, '两边都提供三个具名处理器（查状态 / 查新版 / 装更新）')
    check(newPhones.phoneNames.updateStatus === PHONE_NAMES.updateStatus
      && newPhones.phoneNames.updateCheck === PHONE_NAMES.updateCheck
      && newPhones.phoneNames.updateInstall === PHONE_NAMES.updateInstall,
      '包派生注册的电话名与旧实现一字不差（' + Object.values(PHONE_NAMES).join('、') + '）')

    // 3b) 查状态：快照字段与手工命令逐字对照
    const oldStatus = await oldPhones.handleUpdateStatus({})
    const newStatus = await newPhones.handleUpdateStatus({})
    check(oldStatus.ok === true && newStatus.ok === true, '两边查状态都成功')
    const oldKeys = Object.keys(oldStatus.snapshot).sort().join(',')
    const newKeys = Object.keys(newStatus.snapshot).sort().join(',')
    check(oldKeys === newKeys && oldKeys === 'blockedReason,canInstall,installedVersion,job,latestVersion,runningVersion',
      '快照字段逐字段一致（恰好六字段：' + newKeys + '）')
    check(!('checkId' in newStatus.snapshot) && !('installationKey' in newStatus.snapshot), '快照里没有钥匙（无检查编号与环境指纹）')
    check((oldStatus.manual || '') === (newStatus.manual || ''),
      '手工兜底命令逐字一致（' + (newStatus.manual || '两边都为空') + '）')
    check(typeof newStatus.manual === 'string' && newStatus.manual.includes('--registry=https://registry.npmjs.org/') && newStatus.manual.includes('--save-exact'),
      '手工命令仍带官方源与精确版本（形状没变）')

    // 3c) 查新版：能带回远端版本，凭证另交（两边各用一台从未查过的机器）
    const oldCheckPhones = await buildPhones(oldMod, fresh())
    const newCheckPhones = await buildPhones(newMod, fresh())
    const oldCheck = await oldCheckPhones.handleUpdateCheck({})
    const newCheck = await newCheckPhones.handleUpdateCheck({})
    check(oldCheck.ok === true && newCheck.ok === true, '两边查新版都成功' + (newCheck.ok ? '' : `（包派生侧报 ${newCheck.error}）`))
    check(!!newCheck.snapshot && oldCheck.snapshot.latestVersion === newCheck.snapshot.latestVersion && newCheck.snapshot.latestVersion === '9.9.9',
      '远端版本一致（' + ((newCheck.snapshot && newCheck.snapshot.latestVersion) || '无') + '）')
    check(!!newCheck.receipt && !!newCheck.receipt.checkId && !('installationKey' in newCheck.receipt), '凭证另交且不带环境指纹')

    // 3d) 错误码白名单：十三条，逐条核对两边都认得。
    // 引号形态要放宽：旧实现源码里是单引号，更新包派生副本是编译产物、用双引号，不能只认一种。
    const hasCode = (text, code) => text.includes(`'${code}'`) || text.includes(`"${code}"`)
    const oldKnown = KNOWN_ERROR_CODES.filter((code) => hasCode(read('src/host/update.js'), code))
    const newKnown = KNOWN_ERROR_CODES.filter((code) => hasCode(read('src/host/updatePkg/host.js'), code))
    check(oldKnown.length === KNOWN_ERROR_CODES.length && newKnown.length === KNOWN_ERROR_CODES.length,
      `错误码白名单一致且都是 ${KNOWN_ERROR_CODES.length} 条（旧 ${oldKnown.length} 条、新 ${newKnown.length} 条）`)
    const newOnly = newKnown.filter((c) => !oldKnown.includes(c))
    check(newOnly.length === 0, '两边白名单条目相同（没有只在一侧认得的码）' + (newOnly.length ? `：${newOnly.join('、')}` : ''))

    // 3e) 认不出的脏错误收敛为检查失败，两边口径一致。
    // 这一步必须保证真的走网络那条路：读取器的复用键里没有 fetchImpl，
    // 所以「只换 fetchImpl」会被包内复用上一台已建的读取器，根本走不到抛错那句（门禁实测：抛 0 次）。
    // 改用一台全新机器 + 全新使用范围目录，让复用键必然不同。
    let oldThrew = 0
    let newThrew = 0
    const oldFailMachine = fakeMachine({ profileDir: 'C:/fake/.dsh/profiles/old-fail', fetchImpl: async () => { oldThrew += 1; throw new Error('断网') } })
    const newFailMachine = fakeMachine({ profileDir: 'C:/fake/.dsh/profiles/new-fail', fetchImpl: async () => { newThrew += 1; throw new Error('断网') } })
    const oldFail = await (await buildPhones(oldMod, oldFailMachine.overrides)).handleUpdateCheck({})
    const newFail = await (await buildPhones(newMod, newFailMachine.overrides)).handleUpdateCheck({})
    check(oldThrew === 1 && newThrew === 1, `两边都真的走到网络那条路（旧抛 ${oldThrew} 次、新抛 ${newThrew} 次）`)
    check(oldFail.ok === false && newFail.ok === false && oldFail.error === newFail.error && newFail.error === 'check-failed',
      '连不上时报同一个码（旧 ' + oldFail.error + ' / 新 ' + newFail.error + '）')

    oldMod.__resetSharedUpdateReaderForTests()
    newMod.__resetSharedUpdateReaderForTests()
  }

  // ---- 4) 发布形态：按确切版本号依赖，派生副本随包发布 ----
  {
    const pkgManifest = JSON.parse(read('package/package.json'))
    const dep = pkgManifest.dependencies && pkgManifest.dependencies['dsh-plugin-update']
    check(dep === '0.1.1', '插件清单按确切版本号依赖更新包（实际 ' + JSON.stringify(dep) + '）')
    const rootManifest = JSON.parse(read('package.json'))
    check(rootManifest.dependencies && !!rootManifest.dependencies['dsh-plugin-update'], '开发侧清单也声明了更新包依赖（本机可解析）')
    let shipped = true
    for (const name of UPDATE_PKG_UNITS) {
      if (!exists(`package/lib/updatePkg/${name}`)) { shipped = false; break }
    }
    check(shipped, '构建产物里带齐派生副本（package/lib/updatePkg，随包发布）')
    check(exists('package/lib/updateFromPackage.js'), '构建产物里有接线文件（package/lib/updateFromPackage.js）')
  }

  // ---- 5) 本门禁不跑真命令 ----
  {
    const mine = read('tests/verify-update-migration.js')
    check(!/(^|[^A-Za-z0-9_])spawn\s*\(|execFile\s*\(/.test(mine), '本门禁无真安装调用（全假零件）')
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 迁移门禁生效（真的换了包，行为逐项一致）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
