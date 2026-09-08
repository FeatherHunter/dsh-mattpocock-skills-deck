// verify-update-regression.js — 更新链路五行为回归门禁（落地票 #543）
// 规则：查状态、查新版、安装、轮询、重启自愈各有检查用例，改坏任一个就变红。
//   1) 查状态：只读本地不联网，快照恰好六字段且不带钥匙（前三票行为的回归锚点，详见各票门禁）。
//   2) 查新版：联网一次带回远端版本，凭证另交、快照与凭证都不带环境指纹。
//   3) 安装：开始更新后轮询到待手动重启且运行版本不变；同编号重复提交不重装；
//      凭证过期、环境变化、安装中再提交各有各的错。
//   4) 轮询：面板只在正在安装或正在校验时每秒查状态；清理只停定时器不取消后台任务；
//      后台 fire-and-forget，调用方不轮询任务自己也能走到待重启（关页面不取消）。
//   5) 重启自愈：残留正在安装（锁已消失）改为已中断需人工确认；待重启或已完成的任务
//      用磁盘版本与运行版本重新核对，对不上标安装状态变了，对上才标已完成。
// 约束：测试全程假执行器与假网络，永不真跑安装命令、不直连官方源。
// 用法：node tests/verify-update-regression.js（在仓库根目录）
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
  console.log('更新链路五行为回归门禁（#543：查状态 + 查新版 + 安装 + 轮询 + 重启自愈）')
  const INTEGRITY = `sha512-${'A'.repeat(86)}==`
  const releaseBody = (version) => JSON.stringify({
    name: 'dsh-mattpocock-skills-deck',
    version,
    engines: {},
    dist: { tarball: `https://registry.npmjs.org/dsh-mattpocock-skills-deck/-/dsh-mattpocock-skills-deck-${version}.tgz`, integrity: INTEGRITY },
  })
  const fakeFetch = (version) => async () => ({ ok: true, headers: { get: () => null }, text: async () => releaseBody(version) })
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
  const core = await import(pathToFileURL(path.join(ROOT, 'src/shared/update/service.js')).href)
  const newCore = (opts = {}) => {
    const mem = { job: null, lock: null, runs: 0 }
    let nowValue = opts.now ?? 1000000
    let idN = 0
    const installed = { value: opts.installed ?? '1.7.14' }
    const key = { value: opts.key ?? 'key-1' }
    const running = { value: opts.running ?? '1.7.14' }
    const c = core.createUpdateCore({
      readRunningVersion: () => running.value,
      readInstalled: () => (opts.readInstalled ? opts.readInstalled() : baseEnv({ installedVersion: installed.value, installationKey: key.value, ...(opts.envOver ?? {}) })),
      fetchImpl: opts.fetchImpl || fakeFetch(opts.release ?? '9.9.9'),
      now: () => nowValue,
      randomId: () => `reg-${++idN}`,
      nodeVersion: '24.0.0',
      readJob: opts.readJob ?? (async () => mem.job),
      writeJob: opts.writeJob ?? (async (j) => { mem.job = j }),
      tryAcquireLock: async (id) => { if (mem.lock) return false; mem.lock = id; return true },
      releaseLock: async (id) => { if (mem.lock === id) mem.lock = null },
      backupJob: async () => {},
      runInstall: opts.runInstall ?? (async ({ version }) => { mem.runs += 1; installed.value = version }),
    })
    return { c, mem, installed, key, running, setNow: (v) => { nowValue = v } }
  }

  // ---- 1) 查状态：只读本地不联网 ----
  {
    const { c } = newCore({ fetchImpl: async () => { throw new Error('status 摸了网络') } })
    const snap = await c.status()
    const keys = Object.keys(snap).sort()
    check(JSON.stringify(keys) === JSON.stringify(['blockedReason', 'canInstall', 'installedVersion', 'job', 'latestVersion', 'runningVersion'].sort()), '查状态快照恰好六字段（实际 ' + keys.join(',') + '）')
    check(!('checkId' in snap) && !('installationKey' in snap), '查状态快照里没有钥匙')
    check(snap.runningVersion === '1.7.14' && snap.installedVersion === '1.7.14', '查状态读本地版本正确')
  }

  // ---- 2) 查新版：凭证另交，指纹只留内存 ----
  {
    const { c } = newCore({ release: '9.9.9' })
    const { snapshot, receipt } = await c.check()
    check(snapshot.latestVersion === '9.9.9' && snapshot.canInstall === true, '查新版带回远端 9.9.9 且能装')
    check(!!receipt && !!receipt.checkId && !('installationKey' in receipt), '查新版凭证另交且不带环境指纹')
    check(!('checkId' in snapshot), '查新版快照里没有钥匙')
  }

  // ---- 3) 安装：闭环 + 去重 + 三种报错 ----
  {
    const { c, mem } = newCore()
    const { receipt } = await c.check()
    check(!!(receipt && receipt.checkId), '查新版先交凭证（安装前置）')
    const installing = await c.install({ checkId: (receipt && receipt.checkId) || 'missing-receipt', requestId: 'reg-req-1' })
    check(installing.job && installing.job.state === 'installing', '开始更新返回正在安装')
    check(installing.runningVersion === '1.7.14', '重启前运行版本不变')
    let busy = ''
    try {
      await c.install({ checkId: (receipt && receipt.checkId) || 'missing-receipt', requestId: 'reg-req-2' })
    } catch (e) { busy = (e && e.code) || '' }
    check(busy === 'update-busy', '安装中不同编号再提交报正在更新（实际 ' + busy + '）')
    await new Promise((r) => setTimeout(r, 30))
    let again = null
    let againCode = ''
    try {
      again = await c.install({ checkId: (receipt && receipt.checkId) || 'missing-receipt', requestId: 'reg-req-1' })
    } catch (e) { againCode = (e && e.code) || String(e) }
    check(!!(again && again.job && again.job.state === 'restart-required'), '同编号重复提交不重装（实际 ' + ((again && again.job && again.job.state) || ('抛错 ' + againCode)) + '）')
    const after = await c.status()
    check(after.job && after.job.state === 'restart-required', '轮询到待手动重启（实际 ' + ((after.job && after.job.state) || '无任务') + '）')
    check(after.runningVersion === '1.7.14' && after.installedVersion === '9.9.9', '磁盘已是新版、运行仍是旧版')
    check(mem.runs === 1, '执行器只跑一次（实际 ' + mem.runs + ' 次）')
  }
  {
    const { c, setNow } = newCore()
    const { receipt } = await c.check()
    setNow(1000000 + 11 * 60_000)
    let code = ''
    try {
      await c.install({ checkId: (receipt && receipt.checkId) || 'missing-receipt', requestId: 'reg-req-exp' })
    } catch (e) { code = (e && e.code) || '' }
    check(code === 'check-expired', '凭证过期报检查凭证过期（实际 ' + code + '）')
  }
  {
    const { c, key } = newCore()
    const { receipt } = await c.check()
    key.value = 'key-2'
    let code = ''
    try {
      await c.install({ checkId: (receipt && receipt.checkId) || 'missing-receipt', requestId: 'reg-req-env' })
    } catch (e) { code = (e && e.code) || '' }
    check(code === 'installation-changed', '环境变化报安装状态变了（实际 ' + code + '）')
  }

  // ---- 4) 轮询：只在安装中每秒查只读状态，清理不取消后台 ----
  {
    const settings = strip(read('src/client/views/SettingsPage.js'))
    check(settings.includes("if (updJobState !== 'installing' && updJobState !== 'verifying') return"), '面板只在正在安装或正在校验时才轮询')
    check(settings.includes('setInterval(function () { updReadStatus() }, 1000)'), '轮询每秒查一次状态')
    check(settings.includes('clearInterval(timerId)'), '清理停掉定时器')
    const effectAt = settings.indexOf("if (updJobState !== 'installing'")
    const cleanup = settings.slice(effectAt, effectAt + 400)
    check(!/wf\.update(Cancel|Abort|Stop)|writeJob\s*\(\s*null|abort\s*\(/i.test(cleanup), '清理不取消后台任务（只停定时器，关页面不取消已提交的安装）')
    check(settings.includes("host.call('wf.updateStatus'"), '轮询走只读查状态电话（不联网，见第 1 节）')
    const serviceSrc = strip(read('src/shared/update/service.js'))
    check(serviceSrc.includes('void runBackground(job, env)'), '安装后台 fire-and-forget（调用返回后任务自己往下走）')
  }
  {
    // 调用方不轮询，任务自己也能走到待重启：装完只查一次状态
    const { c } = newCore()
    const { receipt } = await c.check()
    await c.install({ checkId: (receipt && receipt.checkId) || 'missing-receipt', requestId: 'reg-nopoll' })
    await new Promise((r) => setTimeout(r, 30))
    const snap = await c.status()
    check(snap.job && snap.job.state === 'restart-required', '不轮询也能到待重启（后台自己推进，实际 ' + ((snap.job && snap.job.state) || '无任务') + '）')
  }

  // ---- 5) 重启自愈：残留任务在重启后被纠正 ----
  {
    // 5a) 磁盘上标着正在安装但本进程没在跑（锁已消失）：改为已中断需人工确认
    const stale = { id: 'old-job', state: 'installing', targetVersion: '9.9.9', message: null, requestId: 'old-req' }
    const { c } = newCore({ readJob: async () => stale })
    const snap = await c.status()
    check(snap.job && snap.job.state === 'interrupted' && snap.job.message === 'recovery-required', '残留正在安装改为已中断需人工确认（实际 ' + ((snap.job && `${snap.job.state}/${snap.job.message}`) || '无任务') + '）')
  }
  {
    // 5b) 待重启但磁盘版本对不上目标：标安装状态变了
    const drifted = { id: 'j1', state: 'restart-required', targetVersion: '9.9.9', message: null, requestId: 'r1' }
    const { c } = newCore({ installed: '1.7.14', readJob: async () => drifted })
    const snap = await c.status()
    check(snap.job && snap.job.state === 'interrupted' && snap.job.message === 'installation-changed', '磁盘对不上目标标安装状态变了（实际 ' + ((snap.job && `${snap.job.state}/${snap.job.message}`) || '无任务') + '）')
  }
  {
    // 5c) 待重启且磁盘对得上：运行等于目标才算完成，否则继续待重启
    const waiting = { id: 'j2', state: 'restart-required', targetVersion: '9.9.9', message: null, requestId: 'r2' }
    const done = newCore({ installed: '9.9.9', running: '9.9.9', readJob: async () => waiting })
    const snapDone = await done.c.status()
    check(snapDone.job && snapDone.job.state === 'completed', '重启后运行等于目标才算完成（实际 ' + ((snapDone.job && snapDone.job.state) || '无任务') + '）')
    const pending = newCore({ installed: '9.9.9', running: '1.7.14', readJob: async () => waiting })
    const snapPending = await pending.c.status()
    check(snapPending.job && snapPending.job.state === 'restart-required', '运行对不上继续待重启（实际 ' + ((snapPending.job && snapPending.job.state) || '无任务') + '）')
  }
  {
    // 5d) 落盘层：任务记录丢了但锁还在、任务记录坏了，都按需人工确认处理
    const store = await import(pathToFileURL(path.join(ROOT, 'src/host/updateStore.js')).href)
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'upd543-'))
    const home = path.join(scratch, 'home')
    const profile = path.join(scratch, 'profiles', 'web')
    fs.mkdirSync(profile, { recursive: true })
    const disk = store.createUpdateDiskPorts(home, profile)
    await disk.tryAcquireLock('lingering-lock')
    const orphan = await disk.readJob()
    check(orphan && orphan.state === 'interrupted' && orphan.message === 'recovery-required', '有锁无任务按需人工确认处理（实际 ' + ((orphan && `${orphan.state}/${orphan.message}`) || '无任务') + '）')
    await disk.releaseLock('lingering-lock')
    await disk.writeJob({ id: 'x', state: 'not-a-state', targetVersion: '9.9.9' })
    const corrupt = await disk.readJob()
    check(corrupt && corrupt.state === 'interrupted' && corrupt.message === 'recovery-required', '坏任务记录按需人工确认处理（实际 ' + ((corrupt && `${corrupt.state}/${corrupt.message}`) || '无任务') + '）')
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  {
    // 5e) 电话层透出自愈结果：查状态能看到已中断
    const mod = await import(pathToFileURL(path.join(ROOT, 'src/host/update.js')).href)
    mod.__resetSharedUpdateReaderForTests()
    const stale = { id: 'old-phone-job', state: 'installing', targetVersion: '9.9.9', message: null, requestId: 'old-phone-req' }
    const phones = mod.createUpdatePhoneHandlers({
      logCtx: { fire: () => {} },
      readerOverrides: {
        runningVersion: '1.7.14',
        profileDir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'upd543-p-')), 'profiles', 'web'),
        profileName: 'web',
        homeDir: '/fake',
        fetchImpl: fakeFetch('9.9.9'),
        now: () => 1000000,
        randomId: (() => { let n = 0; return () => `regp-${++n}` })(),
        nodeVersion: '24.0.0',
        readInstalled: () => baseEnv(),
        readJob: async () => stale,
        writeJob: async () => {},
        tryAcquireLock: async () => true,
        releaseLock: async () => {},
        backupJob: async () => {},
        runInstall: async () => {},
      },
    })
    const res = await phones.handleUpdateStatus({})
    check(res && res.ok === true && res.snapshot.job && res.snapshot.job.state === 'interrupted', '电话查状态透出自愈后的已中断（实际 ' + ((res && res.snapshot && res.snapshot.job && res.snapshot.job.state) || '无任务') + '）')
    mod.__resetSharedUpdateReaderForTests()
  }

  // ---- 6) 真安装零命中：回归门禁本身不跑真命令 ----
  {
    const mine = read('tests/verify-update-regression.js')
    check(!/(^|[^A-Za-z0-9_])spawn\s*\(|execFile\s*\(/.test(mine), '回归门禁无真安装调用（全假执行器）')
    check(!/runDshCommand\s*\(/.test(mine), '回归门禁不调真执行器')
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 更新链路五行为回归门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
