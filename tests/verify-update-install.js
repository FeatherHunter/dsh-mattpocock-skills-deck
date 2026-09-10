// verify-update-install.js — 安装闭环与手工兜底门禁（落地票 #542）
// 规则：
//   1) 开始更新后轮询到待手动重启，重启前运行版本不变（假执行器只改磁盘版本，不碰运行版本）。
//   2) 同一个请求编号重复提交不重装（执行器只跑一次）；凭证过期或环境变化报错（check-expired / installation-changed）。
//   3) 正在安装时不同编号再提交报正在更新（update-busy）；装不了的情形有原因说明加手工命令（源码安装不给命令）。
//   4) 相关日志只复用常驻事件（调用、调用失败，加 #548 安装执行的跨边界事件 update.install.exec），无新增事件名；
//      宿主注册装更新电话，客户端有安装调用与轮询。
//   5) 测试全程假执行器：全仓搜真安装调用点零命中（无子进程真跑、无 registry 直连），构建通过。
// 用法：node tests/verify-update-install.js（在仓库根目录）
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
  console.log('安装闭环与手工兜底门禁（#542：轮询到待重启 + 去重 + 凭证 + 手工命令 + 假执行器）')
  const INTEGRITY = `sha512-${'A'.repeat(86)}==`
  const releaseBody = (version) => JSON.stringify({
    name: 'dsh-mattpocock-skills-deck',
    version,
    engines: {},
    dist: { tarball: `https://registry.npmjs.org/dsh-mattpocock-skills-deck/-/dsh-mattpocock-skills-deck-${version}.tgz`, integrity: INTEGRITY },
  })
  const fakeFetch = (version, counter) => async () => {
    if (counter) counter.calls += 1
    return { ok: true, headers: { get: () => null }, text: async () => releaseBody(version) }
  }
  const baseEnv = (over = {}) => ({
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
    ...over,
  })

  // ---- 1) 宿主注册装更新电话，胶水与面板不另写查询 ----
  const indexSrc = strip(read('src/host/index.js'))
  check(indexSrc.includes("harness.handle('wf.updateInstall'"), '宿主注册装更新电话 wf.updateInstall')
  const updateSrc = strip(read('src/host/update.js'))
  check(updateSrc.includes('handleUpdateInstall') && updateSrc.includes("loggedPhone('wf.updateInstall'"), '胶水有装更新电话的日志行')
  check(updateSrc.includes('reader.install('), '装更新走核心 reader.install')
  check(!updateSrc.includes('registry.npmjs.org'), '胶水不另写查询（无官方源地址字面量，命令拼接在共享层）')
  const clientSettings = strip(read('src/client/views/SettingsPage.js'))
  // #586：客户端不再写电话名字面量，电话名与轮询间隔都从更新包派生的取值来。
  const derivedClient = read('scripts/generated/updateClient.derived.js')
  check(derivedClient.includes("UPD_PHONE_NAMES.updateStatus === 'wf.updateStatus'"), '派生文件带零变化断言（默认前缀下三个电话名与旧字面一致）')
  check(clientSettings.includes('host.call(UPD_INSTALL'), '面板有点更新调用（开始更新，走派生电话名）')
  check(clientSettings.includes('setInterval(function () { updReadStatus() }, UPD_POLL)'), '安装中按派生间隔轮询查状态（不再写死 1000）')
  check(!clientSettings.includes('registry.npmjs.org') && !clientSettings.includes('fetch('), '面板不直连源（手工命令由宿主回包提供）')
  check(clientSettings.includes("tr('cfg.updateDialogBody')") && clientSettings.includes("tr('cfg.updateStart')"), '对话框两行字与开始更新走词条')

  // ---- 2) 日志只复用常驻事件 ----
  const phoneEvents = [...updateSrc.matchAll(/(?:fire|log)\s*\(\s*'(info|warn|debug|error)'\s*,\s*'([^']+)'/g)].map((m) => m[2])
  const settingsEvents = [...clientSettings.matchAll(/(?:fire|log)\s*\(\s*'(info|warn|debug|error)'\s*,\s*'([^']+)'/g)].map((m) => m[2])
  const fresh = phoneEvents.concat(settingsEvents).filter((e) => e !== 'host.call' && e !== 'host.call.fail' && e !== 'host.dispatch.error')
  const preExisting = new Set(['settings.save', 'update.install.exec'])
  check(fresh.filter((e) => !preExisting.has(e)).length === 0, '安装链路只复用常驻事件（' + [...new Set(phoneEvents.concat(settingsEvents))].join('、') + '）')
  check(strip(read('src/host/updateStore.js')).includes("'info', 'update.install.exec'"), '安装执行器记跨边界调用与结果（常驻事件 update.install.exec）')

  // ---- 3) 核心闭环（假执行器，永不真跑） ----
  const core = await import(pathToFileURL(path.join(ROOT, 'src/shared/update/service.js')).href)
  const commands = await import(pathToFileURL(path.join(ROOT, 'src/shared/update/commands.js')).href)
  const newCore = (opts = {}) => {
    const mem = { job: null, lock: null, runs: 0 }
    let nowValue = opts.now ?? 1000000
    let idN = 0
    const installed = { value: opts.installed ?? '1.7.14' }
    const key = { value: opts.key ?? 'key-1' }
    const c = core.createUpdateCore({
      readRunningVersion: () => '1.7.14',
      readInstalled: () => baseEnv({ installedVersion: installed.value, installationKey: key.value, ...(opts.envOver ?? {}) }),
      fetchImpl: fakeFetch(opts.release ?? '9.9.9', opts.counter),
      now: () => nowValue,
      randomId: () => `id-${++idN}`,
      nodeVersion: '24.0.0',
      readJob: async () => mem.job,
      writeJob: async (j) => { mem.job = j },
      tryAcquireLock: async (id) => { if (mem.lock) return false; mem.lock = id; return true },
      releaseLock: async (id) => { if (mem.lock === id) mem.lock = null },
      backupJob: async () => { mem.backedUp = true },
      runInstall: async ({ version }) => { mem.runs += 1; installed.value = version },
    })
    return { c, mem, installed, key, setNow: (v) => { nowValue = v } }
  }
  // 3a) 开始更新后轮询到待手动重启，重启前运行版本不变
  {
    const { c, mem, installed } = newCore()
    const { receipt } = await c.check()
    check(!!receipt && !!receipt.checkId, '查新版交凭证（安装前置）')
    const installing = await c.install({ checkId: receipt.checkId, requestId: 'req-1' })
    check(installing.job && installing.job.state === 'installing', '开始更新返回正在安装')
    check(installing.runningVersion === '1.7.14', '重启前运行版本不变（实际 ' + installing.runningVersion + '）')
    await new Promise((r) => setTimeout(r, 30))
    const after = await c.status()
    check(after.job && after.job.state === 'restart-required', '轮询到待手动重启（实际 ' + ((after.job && after.job.state) || '无任务') + '）')
    check(after.runningVersion === '1.7.14' && after.installedVersion === '9.9.9', '磁盘已是新版、运行仍是旧版（待重启）')
    check(after.blockedReason === 'pending-restart' && after.canInstall === false, '待重启时不能再装')
    check(mem.runs === 1 && installed.value === '9.9.9', '假执行器只跑一次（实际 ' + mem.runs + ' 次）')
  }
  // 3b) 同一个请求编号重复提交不重装
  {
    const { c, mem } = newCore()
    const { receipt } = await c.check()
    await c.install({ checkId: receipt.checkId, requestId: 'same-req' })
    await new Promise((r) => setTimeout(r, 30))
    const again = await c.install({ checkId: receipt.checkId, requestId: 'same-req' })
    check(again.job && again.job.state === 'restart-required', '重复提交返回旧结果（待重启，不重装）')
    check(mem.runs === 1, '重复提交执行器仍只跑一次（实际 ' + mem.runs + ' 次）')
  }
  // 3c) 凭证过期报错
  {
    const { c, setNow } = newCore()
    const { receipt } = await c.check()
    setNow(1000000 + 11 * 60_000)
    let code = ''
    try {
      await c.install({ checkId: receipt.checkId, requestId: 'req-exp' })
    } catch (e) { code = (e && e.code) || '' }
    check(code === 'check-expired', '凭证过期报 check-expired（实际 ' + code + '）')
  }
  // 3d) 环境变化报错
  {
    const { c, key } = newCore()
    const { receipt } = await c.check()
    key.value = 'key-2'
    let code = ''
    try {
      await c.install({ checkId: receipt.checkId, requestId: 'req-env' })
    } catch (e) { code = (e && e.code) || '' }
    check(code === 'installation-changed', '环境变化报 installation-changed（实际 ' + code + '）')
  }
  // 3e) 正在安装时不同编号再提交报正在更新
  {
    const { c } = newCore()
    const { receipt } = await c.check()
    await c.install({ checkId: receipt.checkId, requestId: 'req-a' })
    let code = ''
    try {
      await c.install({ checkId: receipt.checkId, requestId: 'req-b' })
    } catch (e) { code = (e && e.code) || '' }
    check(code === 'update-busy', '安装中再提交报 update-busy（实际 ' + code + '）')
    await new Promise((r) => setTimeout(r, 30))
  }
  // 3f) 装不了的情形：原因说明加手工命令（源码安装不给命令）
  {
    check(commands.manualCommand({ profileName: 'web', latestVersion: '9.9.9', installedVersion: '1.7.14', runningVersion: '1.7.14', jobTargetVersion: null, blockedReason: null, sourceInstall: false }) === 'dsh plugin --profile web add --save-exact dsh-mattpocock-skills-deck@9.9.9 --registry=https://registry.npmjs.org/', '能装时手工命令可用（带官方源与精确版本）')
    check(commands.manualCommand({ profileName: 'web', latestVersion: '9.9.9', installedVersion: '1.7.14', runningVersion: '1.7.14', jobTargetVersion: null, blockedReason: 'source-install', sourceInstall: true }) === null, '源码安装不给手工命令')
    const recipe = commands.installRecipe({ profileName: 'web', version: '9.9.9', environmentKind: 'cli' })
    check(!!recipe && recipe.pluginArgs.join(' ') === 'add --save-exact dsh-mattpocock-skills-deck@9.9.9 --registry=https://registry.npmjs.org/', '安装配方强制官方源加精确版本')
  }

  // ---- 4) 宿主电话走通（假环境：注入读盘与假执行器，不碰真实盘） ----
  {
    const mod = await import(pathToFileURL(path.join(ROOT, 'src/host/update.js')).href)
    mod.__resetSharedUpdateReaderForTests()
    const mem = { job: null, lock: null, runs: 0 }
    const installed = { value: '1.7.14' }
    const fakeEnv = () => baseEnv({ installedVersion: installed.value })
    const phones = mod.createUpdatePhoneHandlers({
      logCtx: { fire: () => {} },
      readerOverrides: {
        runningVersion: '1.7.14',
        profileDir: '/fake/profiles/web',
        profileName: 'web',
        homeDir: '/fake',
        fetchImpl: fakeFetch('9.9.9'),
        now: () => 1000000,
        randomId: (() => { let n = 0; return () => `phone-${++n}` })(),
        nodeVersion: '24.0.0',
        readInstalled: fakeEnv,
        readJob: async () => mem.job,
        writeJob: async (j) => { mem.job = j },
        tryAcquireLock: async (id) => { if (mem.lock) return false; mem.lock = id; return true },
        releaseLock: async (id) => { if (mem.lock === id) mem.lock = null },
        backupJob: async () => {},
        runInstall: async ({ version }) => { mem.runs += 1; installed.value = version },
      },
    })
    const checked = await phones.handleUpdateCheck({})
    check(checked && checked.ok === true && checked.snapshot.latestVersion === '9.9.9' && !!checked.receipt, '电话查新版带凭证')
    check(typeof checked.manual === 'string' && checked.manual.includes('dsh plugin'), '电话回包带手工命令（实际 ' + (checked.manual || '无') + '）')
    const started = await phones.handleUpdateInstall({ checkId: checked.receipt.checkId, requestId: 'phone-req-1' })
    check(started && started.ok === true && started.snapshot.job && started.snapshot.job.state === 'installing', '电话装更新返回正在安装')
    await new Promise((r) => setTimeout(r, 30))
    const polled = await phones.handleUpdateStatus({})
    check(polled && polled.ok === true && polled.snapshot.job && polled.snapshot.job.state === 'restart-required', '电话轮询到待手动重启')
    const dup = await phones.handleUpdateInstall({ checkId: checked.receipt.checkId, requestId: 'phone-req-1' })
    check(dup && dup.ok === true && mem.runs === 1, '电话重复提交不重装（执行器 ' + mem.runs + ' 次）')
    mod.__resetSharedUpdateReaderForTests()
    const phones2 = mod.createUpdatePhoneHandlers({
      logCtx: { fire: () => {} },
      readerOverrides: {
        runningVersion: '1.7.14',
        profileDir: '/fake/profiles/web',
        profileName: 'web',
        homeDir: '/fake',
        fetchImpl: fakeFetch('9.9.9'),
        now: () => 1000000,
        randomId: (() => { let n = 0; return () => `phone2-${++n}` })(),
        nodeVersion: '24.0.0',
        readInstalled: () => baseEnv(),
        readJob: async () => null,
        writeJob: async () => {},
        tryAcquireLock: async () => true,
        releaseLock: async () => {},
        backupJob: async () => {},
        runInstall: async () => {},
      },
    })
    const bad = await phones2.handleUpdateInstall({ checkId: 'bad-check', requestId: 'phone-req-2' })
    check(bad && bad.ok === false && bad.error === 'check-expired', '电话凭证过期报错（实际 ' + ((bad && bad.error) || '无码') + '）')
    mod.__resetSharedUpdateReaderForTests()
  }

  // ---- 5) 真安装零命中：测试与门禁不跑真命令 ----
  {
    const allTests = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.startsWith('verify-update-')).map((f) => read(`tests/${f}`)).join('\n')
    check(!/(^|[^A-Za-z0-9_])spawn\s*\(|execFile\s*\(/.test(allTests), '更新门禁无真安装调用（全假执行器，tsc 的 spawnSync 除外）')
    check(!/runDshCommand\s*\(/.test(allTests), '更新门禁不调真执行器')
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 安装闭环与手工兜底门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
