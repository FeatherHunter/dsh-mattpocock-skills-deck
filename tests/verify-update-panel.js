// verify-update-panel.js — 标题行更新入口门禁（落地票 #541）
// 规则：
//   1) 宿主注册两个只读电话（查状态、查新版），动态引入更新胶水，不新增静态引用。
//   2) 电话复用只读核心：查状态走 reader.status（不联网），查新版走 reader.check（点一次联网一次）；
//      不另写查询逻辑（宿主电话与客户端均不出现官方源地址字面量），快照原样透传不重建。
//   3) 单例：查新版的结果查状态要能看到（同一进程只建一个读取器）。
//   4) 错误码收敛：核心已知码原样返回，外面世界的脏错误收敛为检查失败；日志只复用常驻事件，不新增事件名。
//   5) 面板三态：检查更新 / 检查中 / 更新至某版本；点开设置页先读状态，用户点了才联网检查；按钮检查中禁用。
//   6) 文案走中英文词条，不写死中文；四个改动文件均不超 350 行。
// 用法：node tests/verify-update-panel.js（在仓库根目录）
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

async function main() {
  console.log('标题行更新入口门禁（#541：三态显示 + 先读状态后联网 + 复用只读核心）')

  // ---- 1) 宿主注册 ----
  const indexSrc = strip(read('src/host/index.js'))
  check(indexSrc.includes("harness.handle('wf.updateStatus'"), '宿主注册查状态电话 wf.updateStatus')
  check(indexSrc.includes("harness.handle('wf.updateCheck'"), '宿主注册查新版电话 wf.updateCheck')
  check(indexSrc.includes("import('./update.js')"), '更新胶水走动态引入（无静态 import）')
  check(!/^import .*update\.js/m.test(indexSrc), '宿主入口无更新胶水的静态引用')

  // ---- 2) 电话复用核心，不另写查询 ----
  const updateSrc = strip(read('src/host/update.js'))
  check(updateSrc.includes('createUpdatePhoneHandlers'), '胶水导出电话工厂 createUpdatePhoneHandlers')
  check(updateSrc.includes('reader.status()'), '查状态走核心 reader.status')
  check(updateSrc.includes('reader.check()'), '查新版走核心 reader.check')
  check(!updateSrc.includes('registry.npmjs.org'), '胶水电话不另写查询（无官方源地址字面量）')
  const clientSettings = strip(read('src/client/views/SettingsPage.js'))
  check(!clientSettings.includes('registry.npmjs.org') && !clientSettings.includes('fetch('), '面板不另写查询（无源地址与直连请求）')

  // ---- 3) 日志只复用常驻事件 ----
  const phoneEvents = [...updateSrc.matchAll(/(?:fire|log)\s*\(\s*'(info|warn|debug|error)'\s*,\s*'([^']+)'/g)].map((m) => m[2])
  const settingsEvents = [...clientSettings.matchAll(/(?:fire|log)\s*\(\s*'(info|warn|debug|error)'\s*,\s*'([^']+)'/g)].map((m) => m[2])
  const freshEvents = phoneEvents.concat(settingsEvents).filter((e) => e !== 'host.call' && e !== 'host.call.fail' && e !== 'host.dispatch.error')
  const preExisting = new Set(['settings.save'])
  const freshNew = freshEvents.filter((e) => !preExisting.has(e))
  check(freshNew.length === 0, '电话与按钮只复用常驻事件（' + [...new Set(phoneEvents.concat(settingsEvents))].join('、') + '）')
  check(updateSrc.includes("loggedPhone('wf.updateStatus'") && updateSrc.includes("loggedPhone('wf.updateCheck'"), '宿主日志按电话名记行（查状态与查新版各一行方法可识行，装更新行由安装门禁覆盖）')
  check(clientSettings.includes("method: 'wf.updateStatus'") && clientSettings.includes("method: 'wf.updateCheck'"), '客户端调用点相邻有行（两处调用各有日志行覆盖）')

  // ---- 4) 面板三态与先读后查 ----
  check(clientSettings.includes("tr('cfg.updateCheck')"), '按钮平时显示检查更新（走词条）')
  check(clientSettings.includes("tr('cfg.updateChecking')"), '按钮检查中显示检查中（走词条）')
  check(clientSettings.includes("tr('cfg.updateToVersion'"), '按钮有新版显示更新至某版本（走词条带版本号）')
  check(clientSettings.includes('React.useEffect(function () { updReadStatus() }, [])'), '点开设置页先读本地状态（挂载即读）')
  check(clientSettings.includes("host.call('wf.updateStatus'") && clientSettings.includes("host.call('wf.updateCheck'"), '先读状态电话、点了才调检查电话')
  const statusAt = clientSettings.indexOf("host.call('wf.updateStatus'")
  const checkAt = clientSettings.indexOf("host.call('wf.updateCheck'")
  check(statusAt >= 0 && checkAt >= 0 && statusAt < checkAt, '状态调用在检查调用之前（先状态后检查）')
  check(clientSettings.includes('updChecking || updBusy') && clientSettings.includes('disabled: !!(updChecking'), '检查中与安装中禁用按钮（重复点击不重发，#542 加忙碌态）')
  check(clientSettings.includes("tr('cfg.updateCheckFail')"), '检查失败给可读提示（走词条）')

  // ---- 5) 文案中英成对 ----
  const localeSrc = read('src/client/kernel/locale-word.js')
  for (const k of ['cfg.updateCheck', 'cfg.updateChecking', 'cfg.updateToVersion', 'cfg.updateCheckFail']) {
    const times = localeSrc.split(`'${k}':`).length - 1
    check(times === 2, `词条中英成对 ${k}（实际 ${times} 处）`)
  }

  // ---- 6) 文件粒度 ----
  for (const rel of ['src/host/update.js', 'src/host/index.js', 'src/client/views/SettingsPage.js', 'src/client/kernel/locale-word.js']) {
    const n = read(rel).split(/\r?\n/).length
    check(n <= 350, `${rel} ${n} 行（上限 350）`)
  }

  // ---- 7) 电话行为（假环境：不存在的范围目录 + 可控网络） ----
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/host/update.js')).href)
  check(typeof mod.createUpdatePhoneHandlers === 'function', '电话工厂可被动态加载')
  const INTEGRITY = `sha512-${'A'.repeat(86)}==`
  const releaseBody = (version) => JSON.stringify({
    name: 'dsh-mattpocock-skills-deck',
    version,
    engines: {},
    dist: { tarball: `https://registry.npmjs.org/dsh-mattpocock-skills-deck/-/dsh-mattpocock-skills-deck-${version}.tgz`, integrity: INTEGRITY },
  })
  const fakeFetch = (version) => async () => ({ ok: true, headers: { get: () => null }, text: async () => releaseBody(version) })
  const scratch = (tag) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), `upd541-${tag}-`)), 'profiles', 'web')
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

  console.log(failed ? '\n存在失败' : '\n全部通过 — 标题行更新入口门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
