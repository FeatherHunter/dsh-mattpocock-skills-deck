// verify-update-panel.js — 更新入口委托门禁（落地票 #876 搭架、主题票 #877 切档案卷皮肤）
// 规则：
//   1) 旧面板实现已删：入口挂载点与入口件绑定包都在，绑定包头上写明的更新包版本＝已安装版本（派生文件新鲜度）。
//   2) 更新日志文件随包：包根 CHANGELOG.md 存在、包清单白名单含它，包清单依赖与根清单同范围。
//   3) 电话行为（假环境 + 假网络）：查状态不联网、点了才联网、查新版与查状态共用同一个读取器、
//      连不上与坏发行信息各报各的码。
// 用法：node tests/verify-update-panel.js（在仓库根目录）
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

async function main() {
  console.log('更新入口委托门禁（#876 搭架 + #877 档案卷皮肤：宿主四电话 + 面板只挂入口件 + 更新日志随包）')

  // ---- 面板委托：自有实现已删，入口挂载点与绑定包都在 ----
  for (const rel of ['src/client/views/useUpdatePanel.js', 'src/client/views/UpdateDialog.js', 'src/client/views/UpdateRestartBanner.js']) {
    check(!exists(rel), '自有面板实现已删：' + rel)
  }
  check(exists('src/client/views/UpdateEntryHost.js'), '入口挂载点存在：src/client/views/UpdateEntryHost.js')
  check(exists('scripts/generated/updateEntryPanel.bundle.js'), '入口件绑定包存在（构建产物，人手不改）')
  const bundleHead = read('scripts/generated/updateEntryPanel.bundle.js').split('\n').slice(0, 3).join('\n')
  const installedUpd = JSON.parse(read('node_modules/dsh-plugin-update/package.json')).version
  check(bundleHead.includes('dsh-plugin-update@' + installedUpd), '绑定包头写明已安装更新包版本（实际 ' + installedUpd + '）')

  // ---- 更新日志文件随包 ----
  check(exists('package/CHANGELOG.md'), '包根更新日志文件存在（面板日志章自动展示的前提）')
  const pkgManifest = JSON.parse(read('package/package.json'))
  const rootManifest = JSON.parse(read('package.json'))
  check(pkgManifest.dependencies && pkgManifest.dependencies['dsh-plugin-update'] === rootManifest.dependencies['dsh-plugin-update'], '包清单依赖与根清单同范围（实际 ' + (pkgManifest.dependencies && pkgManifest.dependencies['dsh-plugin-update']) + '）')
  check(Array.isArray(pkgManifest.files) && pkgManifest.files.includes('CHANGELOG.md'), '包清单白名单含更新日志文件（随包发布）')

  // ---- 电话行为（假环境：不存在的范围目录 + 可控网络） ----
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/host/updateFromPackage.js')).href)
  check(typeof mod.createUpdatePhoneHandlers === 'function', '电话工厂可被动态加载')
  const INTEGRITY = `sha512-${'A'.repeat(86)}==`
  const releaseBody = (version) => JSON.stringify({
    name: 'dsh-mattpocock-skills-deck',
    version,
    engines: {},
    dist: { tarball: `https://registry.npmjs.org/dsh-mattpocock-skills-deck/-/dsh-mattpocock-skills-deck-${version}.tgz`, integrity: INTEGRITY },
  })
  const fakeFetch = (version) => async () => ({ ok: true, headers: { get: () => null }, text: async () => releaseBody(version) })
  const scratch = (tag) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), `upd876-${tag}-`)), 'profiles', 'web')
  const quietLogs = { fire: () => {} }

  // 7a) 查状态不联网：网络实现一碰就抛，状态照样返回
  {
    mod.__resetSharedUpdateReaderForTests()
    const phones = mod.createUpdatePhoneHandlers({ logCtx: quietLogs, readerOverrides: { runningVersion: '1.7.14', profileDir: scratch('a'), fetchImpl: async () => { throw new Error('status 摸了网络') } } })
    const res = await phones.handleUpdateStatus({})
    const keys = res && res.snapshot ? Object.keys(res.snapshot).sort() : []
    check(res && res.ok === true, '查状态成功返回（不联网）')
    check(JSON.stringify(keys) === JSON.stringify(['blockedReason', 'canInstall', 'installed', 'installedVersion', 'job', 'latestVersion', 'runningVersion'].sort()), '查状态快照恰好七字段（实际 ' + keys.join(',') + '）')
    check(typeof res.snapshot.installed === 'boolean', '新增的 installed 是布尔（装没装上，0.17 起有这一格）')
    check(!('checkId' in (res.snapshot || {})), '查状态快照里没有钥匙')
  }
  // 7b) 点了才联网：有新版时快照带出远端版本；单例让随后的查状态也能看到
  {
    mod.__resetSharedUpdateReaderForTests()
    const phones = mod.createUpdatePhoneHandlers({ logCtx: quietLogs, readerOverrides: { runningVersion: '1.7.14', profileDir: scratch('b'), fetchImpl: fakeFetch('9.9.9') } })
    const checked = await phones.handleUpdateCheck({})
    check(checked && checked.ok === true && checked.snapshot && checked.snapshot.latestVersion === '9.9.9', '查新版带回远端 9.9.9')
    const after = await phones.handleUpdateStatus({})
    check(after && after.ok === true && after.snapshot && after.snapshot.latestVersion === '9.9.9', '单例：查状态能看到刚查到的远端版本')
  }
  // 7c) 无新版：远端等于运行版
  {
    mod.__resetSharedUpdateReaderForTests()
    const phones = mod.createUpdatePhoneHandlers({ logCtx: quietLogs, readerOverrides: { runningVersion: '1.7.14', profileDir: scratch('c'), fetchImpl: fakeFetch('1.7.14') } })
    const res = await phones.handleUpdateCheck({})
    check(res && res.ok === true && res.snapshot && res.snapshot.latestVersion === '1.7.14' && res.snapshot.canInstall === false, '无新版：远端等于运行版，不能装')
  }
  // 7d) 错误收敛：连不上与坏发行信息各有各的码
  {
    mod.__resetSharedUpdateReaderForTests()
    const down = mod.createUpdatePhoneHandlers({ logCtx: quietLogs, readerOverrides: { runningVersion: '1.7.14', profileDir: scratch('d'), fetchImpl: async () => { throw new Error('断网') } } })
    const r1 = await down.handleUpdateCheck({})
    check(r1 && r1.ok === false && r1.error === 'check-failed', '连不上报检查失败（实际 ' + ((r1 && r1.error) || '无码') + '）')
    mod.__resetSharedUpdateReaderForTests()
    const badFetch = async () => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ name: '别人家的包', version: '9.9.9' }) })
    const bad = mod.createUpdatePhoneHandlers({ logCtx: quietLogs, readerOverrides: { runningVersion: '1.7.14', profileDir: scratch('e'), fetchImpl: badFetch } })
    const r2 = await bad.handleUpdateCheck({})
    check(r2 && r2.ok === false && r2.error === 'invalid-release', '坏发行信息报版本信息无效（实际 ' + ((r2 && r2.error) || '无码') + '）')
  }
  mod.__resetSharedUpdateReaderForTests()

  console.log(failed ? '\n存在失败' : '\n全部通过 — 更新入口委托门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
