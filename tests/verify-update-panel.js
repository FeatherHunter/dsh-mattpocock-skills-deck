// verify-update-panel.js — 更新入口委托门禁（落地票 #876 搭架、主题票 #877 切档案卷皮肤）
// 规则：
//   1) 宿主注册四个电话（查状态、查新版、装更新、取更新日志），动态引入更新胶水，不新增静态引用。
//   2) 电话复用包的能力：查状态走 reader.status（不联网），查新版走 reader.check（点一次联网一次）；
//      不另写查询逻辑（宿主电话与客户端均不出现官方源地址字面量），快照原样透传不重建。
//   3) 单例：查新版的结果查状态要能看到（同一进程只建一个读取器）。
//   4) 错误码收敛：核心已知码原样返回，外面世界的脏错误收敛为检查失败；日志只复用常驻事件，不新增事件名。
//   5) 面板委托：本仓不再自带按钮状态机与浮层弹窗（三个旧文件已删），配置页只挂包的入口件
//      （默认摆法）与它内部的 dialog 面板；调用只走包的电话名与轮询间隔，不写电话名字面量，
//      不自己起定时器，关闭与轮询收尾按包的约定来（卸载只停轮询）。
//   5b) 皮肤只用档案卷（主题票 #877）：挂载时传档案卷皮肤，不自定义皮肤变量；深浅跟随系统，
//      档案头与印章与待重启横幅按包的档案卷呈现（入口件打开的 dialog 面板同步换肤）。
//   6) 更新日志文件：包根 CHANGELOG.md 存在且形状合法，并随包发布（面板日志章自动展示的前提，
//      缺文件时只给中性提示，不挡安装）；包清单依赖跟踪最新，版本头与锁文件一致。
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
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

async function main() {
  console.log('更新入口委托门禁（#876 搭架 + #877 档案卷皮肤：宿主四电话 + 面板只挂入口件 + 更新日志随包）')

  // ---- 1) 宿主注册 ----
  const indexSrc = strip(read('src/host/index.js'))
  check(indexSrc.includes("harness.handle('wf.updateStatus'"), '宿主注册查状态电话 wf.updateStatus')
  check(indexSrc.includes("harness.handle('wf.updateCheck'"), '宿主注册查新版电话 wf.updateCheck')
  check(indexSrc.includes("harness.handle('wf.updateInstall'"), '宿主注册装更新电话 wf.updateInstall')
  check(indexSrc.includes("harness.handle('wf.updateChangelog'"), '宿主注册取更新日志电话 wf.updateChangelog')
  check(indexSrc.includes("import('./updateFromPackage.js')"), '更新胶水走动态引入（无静态 import）')
  check(!/^import .*update\.js/m.test(indexSrc), '宿主入口无更新胶水的静态引用')

  // ---- 2) 电话复用包的能力，不另写查询 ----
  const updateSrc = strip(read('src/host/updateFromPackage.js'))
  check(updateSrc.includes('createUpdatePhoneHandlers'), '胶水导出电话工厂 createUpdatePhoneHandlers')
  check(updateSrc.includes('createHostUpdate(') && updateSrc.includes('phoneNames.updateStatus'), '查状态走包的能力（建能力入口加电话名表，不自写查询）')
  check(updateSrc.includes('phoneNames.updateCheck'), '查新版走包的能力（电话名从包读，不自拼字符串）')
  check(updateSrc.includes('phoneNames.updateChangelog'), '取更新日志走包的能力（面板日志章用，不自拼字符串）')
  check(!updateSrc.includes('registry.npmjs.org'), '胶水电话不另写查询（无官方源地址字面量）')
  check(updateSrc.includes("UPDATE_RELEASE_CHANNEL = 'prerelease'"), '版本通道取预发布档（跑测试版也能查更新，2026-10-10 拍板，见 CHANGELOG v1.8.0-rc.2）')
  const leafSrc = strip(read('src/client/views/UpdateEntryHost.js'))
  check(!leafSrc.includes('registry.npmjs.org') && !leafSrc.includes('fetch('), '面板不另写查询（无源地址与直连请求）')

  // ---- 3) 日志只复用常驻事件 ----
  const phoneEvents = [...updateSrc.matchAll(/(?:fire|log)\s*\(\s*'(info|warn|debug|error)'\s*,\s*'([^']+)'/g)].map((m) => m[2])
  const leafEvents = [...leafSrc.matchAll(/(?:fire|log)\s*\(\s*'(info|warn|debug|error)'\s*,\s*'([^']+)'/g)].map((m) => m[2])
  const freshEvents = phoneEvents.concat(leafEvents).filter((e) => e !== 'host.call' && e !== 'host.call.fail' && e !== 'host.dispatch.error')
  const preExisting = new Set(['settings.save', 'panel.render', 'update.install.manifestSync'])
  const freshNew = freshEvents.filter((e) => !preExisting.has(e))
  check(freshNew.length === 0, '电话与入口挂载点只复用已有事件（' + [...new Set(phoneEvents.concat(leafEvents))].join('、') + '）')
  check(!updateSrc.includes('loggedPhone('), '胶水不自写按电话记行的包装（记行已收进包内，由包自带测试与日志门禁覆盖）')
  const derivedClientSrc = read('scripts/generated/updateClient.derived.js')
  check(derivedClientSrc.includes("UPD_PHONE_NAMES.updateStatus === 'wf.updateStatus'") && derivedClientSrc.includes("UPD_PHONE_NAMES.updateCheck === 'wf.updateCheck'"),
    '派生文件带零变化断言（默认前缀下查状态与查新版电话名与旧字面一致）')

  // ---- 4) 面板委托：旧文件已删，只挂入口件 ----
  for (const rel of ['src/client/views/useUpdatePanel.js', 'src/client/views/UpdateDialog.js', 'src/client/views/UpdateRestartBanner.js']) {
    check(!exists(rel), '自有面板实现已删：' + rel)
  }
  check(exists('src/client/views/UpdateEntryHost.js'), '入口挂载点存在：src/client/views/UpdateEntryHost.js')
  check(exists('scripts/generated/updateEntryPanel.bundle.js'), '入口件绑定包存在（构建产物，人手不改）')
  const bundleHead = read('scripts/generated/updateEntryPanel.bundle.js').split('\n').slice(0, 3).join('\n')
  const installedUpd = JSON.parse(read('node_modules/dsh-plugin-update/package.json')).version
  check(bundleHead.includes('dsh-plugin-update@' + installedUpd), '绑定包头写明已安装更新包版本（实际 ' + installedUpd + '）')
  const bundleSrc = read('scripts/generated/updateEntryPanel.bundle.js')
  check(bundleSrc.includes('mountUpdateEntry'), '绑定包里有入口件挂载函数')
  check(leafSrc.includes('mountUpdateEntry'), '挂载点调用包的入口件（不自拼面板）')
  check(leafSrc.includes("pluginId: 'dsh-mattpocock-skills-deck'") && leafSrc.includes("prefix: 'wf'"), '挂载点传插件标识与电话名前缀（与宿主侧一致）')
  check(!leafSrc.includes('wf.updateStatus') && !leafSrc.includes('wf.updateCheck') && !leafSrc.includes('wf.updateInstall'), '挂载点不写电话名字面量（电话名由包从前缀算）')
  check(!leafSrc.includes('setInterval') && !leafSrc.includes('UPD_POLL'), '挂载点不自己起定时器（轮询间隔走包默认）')
  check(leafSrc.includes('.unmount()'), '挂载点卸载时按包的约定收尾（只停轮询）')
  check(!leafSrc.includes('onCloseRequested') && !leafSrc.includes('onRestartRequested'), '挂载点不加关闭与重启接线（走包默认）')
  check(leafSrc.includes("theme: 'archive'"), '挂载点传档案卷皮肤（只用档案卷，入口件与 dialog 面板同步换肤）')
  check(!leafSrc.includes('themeTokens') && !leafSrc.includes('locale') && !leafSrc.includes('sizing'), '挂载点不自定义皮肤变量、不做语言与尺寸附加项（深浅跟随系统，走包默认）')
  const settingsSrc = strip(read('src/client/views/SettingsPage.js'))
  check(settingsSrc.includes('UpdateEntryHost'), '配置页挂载入口件（标题行按钮走包的默认摆法）')
  check(!settingsSrc.includes('useUpdatePanel') && !settingsSrc.includes('UpdateDialog') && !settingsSrc.includes('UpdateRestartBanner'), '配置页不再引用自有按钮状态机与浮层弹窗')
  check(!settingsSrc.includes('updIsNewer') && !settingsSrc.includes('setUpdDialog'), '配置页不再自带版本比对与弹窗开关（判据收进包内）')

  // ---- 5) 构建接线：绑定包拼进客户端，旧叶子已摘 ----
  const buildSrc = read('scripts/build.mjs')
  check(buildSrc.includes("file: 'scripts/generated/updateEntryPanel.bundle.js'"), '构建登记绑定包（拼进客户端闭包）')
  check(buildSrc.includes("file: 'src/client/views/UpdateEntryHost.js'"), '构建登记挂载点叶子')
  check(!buildSrc.includes('UpdateDialog.js') && !buildSrc.includes('UpdateRestartBanner.js') && !buildSrc.includes('useUpdatePanel.js'), '构建不再登记旧面板叶子')
  const clientIndex = read('src/client/index.js')
  check(clientIndex.includes('kernel:updateEntryBundle'), '客户端留绑定包拼接标记')
  check(clientIndex.includes('leaf:updateEntryHost'), '客户端留挂载点拼接标记')
  check(!clientIndex.includes('leaf:updateDialog') && !clientIndex.includes('leaf:useUpdatePanel'), '客户端旧面板标记已摘')
  const product = read('package/lib/client.js')
  check(product.includes('__DshUpdateEntry') && product.includes('UpdateEntryHost'), '发布产物含绑定包与挂载点')
  check(!product.includes('useUpdatePanel') && !product.includes('data-role=\"update-dialog\"') && !product.includes('dsws-upd-dlg'), '发布产物无自有按钮状态机与浮层弹窗')

  // ---- 6) 更新日志文件随包 ----
  check(exists('package/CHANGELOG.md'), '包根更新日志文件存在（面板日志章自动展示的前提）')
  const changelog = read('package/CHANGELOG.md')
  check(/^# Changelog/m.test(changelog), '更新日志有标题行')
  check(/## \[1\.7\.\d+\] - \d{4}-\d{2}-\d{2}/.test(changelog), '更新日志有版本节（## [x.y.z] - 日期，最新在前）')
  check(/### (Added|Fixed|Changed|Security)/.test(changelog), '更新日志有面板必显分类（Added/Fixed/Changed/Security）')
  const pkgManifest = JSON.parse(read('package/package.json'))
  const rootManifest = JSON.parse(read('package.json'))
  check(pkgManifest.dependencies && pkgManifest.dependencies['dsh-plugin-update'] === rootManifest.dependencies['dsh-plugin-update'], '包清单依赖与根清单同范围（实际 ' + (pkgManifest.dependencies && pkgManifest.dependencies['dsh-plugin-update']) + '）')
  check(Array.isArray(pkgManifest.files) && pkgManifest.files.includes('CHANGELOG.md'), '包清单白名单含更新日志文件（随包发布）')

  // ---- 7) 电话行为（假环境：不存在的范围目录 + 可控网络） ----
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
    check(JSON.stringify(keys) === JSON.stringify(['blockedReason', 'canInstall', 'installedVersion', 'job', 'latestVersion', 'runningVersion'].sort()), '查状态快照恰好六字段（实际 ' + keys.join(',') + '）')
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

  // ---- 8) 文件粒度 ----
  for (const rel of ['src/host/updateFromPackage.js', 'src/host/index.js', 'src/client/views/SettingsPage.js', 'src/client/views/UpdateEntryHost.js', 'scripts/bundle-update-entry.mjs']) {
    const n = read(rel).split(/\r?\n/).length
    check(n <= 350, `${rel} ${n} 行（上限 350）`)
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 更新入口委托门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
