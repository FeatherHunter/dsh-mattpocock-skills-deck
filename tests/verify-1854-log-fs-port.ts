// verify-1854-log-fs-port.ts —— 宿主日志文件服务能力探测与切换（#1854）
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1854-log-fs-port.ts（在插件根目录）
// 门禁归属: src/host/logFromPackage.ts
//
// 为什么要有这扇门禁：2026-11-03 宿主进程两次 OOM。根因是插件把 DSH 平台文件服务当成完整文件服务递给
// dsh-log：平台接口没有 appendText / rename / unlink / sizeOf，日志库于是退化成「每次刷盘把整份日志读出来、
// 拼上新行、再整份写回去」，单日日志涨到 180MB，5MB 封存与 14 天清理都失效，最终把宿主堆拖爆。
// 修复是建库前探测这四个能力，缺任一就换用 dsh-log 自带的 Node 文件服务，并把平台对象剥成只含 os 与
// path.join 的最小形状（避免平台目标对象形状混进来，被 Node 服务写成 [object Object]）。
//
// 这扇门禁守三件事：探测判断对不对（缺能力的判要切、能力齐全的判不用切、真实宿主那种「只缺三格」的形状
// 也要认）、切换后真的落到真实文件（文件名与正文里都不许出现 [object Object]）、能力齐全时仍用调用方递进来的
// 服务（老行为不回归）。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')
const { makeMemoryLogFs } = require('./lib/memory-log-fs.ts')

const ROOT = path.resolve(__dirname, '..')
let failed = 0
let total = 0
const check = (ok, msg) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed += 1
}

// 临时目录：门禁自己建、自己收，不往工作树里丢东西。
function makeTmp(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-log-fs-port-' + tag + '-'))
}

// 把目录下的文件收全（门禁只读自己刚建出来的日志目录，目录可能还不存在）。
function walkFiles(dir, out) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name)
    const st = fs.statSync(abs)
    if (st.isDirectory()) walkFiles(abs, out)
    else out.push(abs)
  }
  return out
}

// 平台形状的文件服务：DSH 平台给的就是这些（读、写、列目录、建目录、resolve），
// 没有 appendText / rename / sizeOf；这里连 unlink 也不给，凑满四缺。
function makePlatformFs() {
  const counts = { read: 0, write: 0 }
  return {
    counts,
    async resolve(p) { return { displayPath: String(p), targetKey: String(p) } },
    async readText() { counts.read += 1; throw new Error('门禁没有预期平台读：能力齐全的 Node 服务已经接管') },
    async writeText() { counts.write += 1; throw new Error('门禁没有预期平台写：能力齐全的 Node 服务已经接管') },
    async mkdir() {},
    async listDir() { return [] },
    async lstat() { throw new Error('门禁没有预期平台 lstat') },
    async stat() { throw new Error('门禁没有预期平台 stat') },
  }
}

// 与宿主接线同一形状的平台对象（os + path.join）；切换分支要把它的 fs 剥掉，只留 os 与 path.join。
function platformOf(fileService) {
  return {
    os: 'test-os',
    path: { join(...parts) { return parts.join('/').replace(/\/+/g, '/') } },
    fs: fileService,
  }
}

async function main() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'logFromPackage.ts')).href)
  const dshNode = await import('dsh-log/node')

  // ── 一、探测函数本身 ────────────────────────────────────────────────────
  check(typeof mod.missingLogFsCapabilities === 'function', 'logFromPackage 导出能力探测函数（门禁要直接验判断，而不是只看行为）')
  check(typeof dshNode.createNodeFileService === 'function', 'dsh-log/node 提供 createNodeFileService（缺失时切换分支无从谈起）')
  const caps = Array.isArray(mod.LOG_FS_CAPABILITIES) ? mod.LOG_FS_CAPABILITIES : []
  check(
    caps.length === 4 && ['appendText', 'rename', 'unlink', 'sizeOf'].every((name) => caps.indexOf(name) >= 0),
    '导出的四格能力清单正好是追加、改名、删除、取长度（门禁与源码不各抄一份；实得：' + JSON.stringify(caps) + '）'
  )

  if (typeof mod.missingLogFsCapabilities === 'function') {
    const platformFs = makePlatformFs()
    const missingPlatform = mod.missingLogFsCapabilities(platformFs)
    const missingList = Array.isArray(missingPlatform) ? missingPlatform : []
    check(
      missingList.length === 4 && caps.every((name) => missingList.indexOf(name) >= 0),
      '平台形状的文件服务被判定为四格全缺（实得：' + JSON.stringify(missingList) + '）'
    )
    const nodeFs = dshNode.createNodeFileService()
    const missingNode = mod.missingLogFsCapabilities(nodeFs)
    check(Array.isArray(missingNode) && missingNode.length === 0, 'Node 文件服务被判定为能力齐全（不误判，免得每次开机都换服务）')
    // 平台对象用 getter 暴露方法时，读属性本身可能抛错；探测不能把开机带崩。
    const throwing = {}
    Object.defineProperty(throwing, 'appendText', { get() { throw new Error('读取就抛错') } })
    let crashed = null
    let missingThrowing = null
    try { missingThrowing = mod.missingLogFsCapabilities(throwing) } catch (e) { crashed = e }
    check(crashed === null && Array.isArray(missingThrowing) && missingThrowing.length === 4, '探测过程读属性抛错时不炸，按缺失处理')
    check(mod.missingLogFsCapabilities(null).length === 4, '没递文件服务（null）时也按四格全缺处理')
    // 真实宿主的形状是「缺三格」：平台文件服务的白名单里有 unlink，但没有 appendText / rename / sizeOf。
    // 只测四格全缺会漏掉这一种，所以补一条：凑到一格也不能放过。
    const mostlyMissingFs = Object.assign(makePlatformFs(), { unlink: async () => {} })
    const missingMostly = mod.missingLogFsCapabilities(mostlyMissingFs)
    check(
      Array.isArray(missingMostly) && missingMostly.length === 3 && missingMostly.indexOf('unlink') < 0,
      '真实宿主那种只有 unlink 的形状被判为缺三格，不会因为凑到一格就放过（实得：' + JSON.stringify(missingMostly) + '）'
    )
  }

  // ── 二、缺能力时真的切到 Node 服务：日志写进真实文件 ────────────────────
  const fallbackRoot = makeTmp('fallback')
  const fallbackCacheDir = path.join(fallbackRoot, 'cache')
  const fallbackPlatformFs = makePlatformFs()
  const fallbackStore = await mod.createLogFromPackage({
    fs: fallbackPlatformFs,
    getCacheDir: async () => fallbackCacheDir,
    getPlatform: async () => platformOf(fallbackPlatformFs),
    DEFAULT_CWD: fallbackRoot,
  })
  check(!!fallbackStore && typeof fallbackStore.log === 'function', '缺能力的文件服务下日志库照样建得起来（切换后不挡开机）')
  if (fallbackStore && typeof fallbackStore.log === 'function') {
    fallbackStore.log('warn', 'gate.probe.line', { case: 'fallback' })
    await fallbackStore.flushNow()
  }
  const fallbackLogDir = path.join(fallbackCacheDir, 'logs')
  const fallbackFiles = walkFiles(fallbackLogDir, [])
  const fallbackNames = fallbackFiles.map((f) => path.basename(f))
  check(fallbackNames.length > 0, '切换后日志目录里有真实文件（不是只活在内存的假象）')
  check(
    fallbackNames.some((n) => /^\d{4}-\d{2}-\d{2}(\.\d+)?\.log$/.test(n)),
    '切换后日志文件名是日期形态（如 2026-11-03.log，实得：' + JSON.stringify(fallbackNames) + '）'
  )
  const fallbackBody = fallbackFiles.map((f) => { try { return fs.readFileSync(f, 'utf8') } catch (e) { return '' } }).join('\n')
  check(fallbackBody.indexOf('gate.probe.line') >= 0, '切换后那一行真的写进了文件（真实落盘）')
  check(!fallbackFiles.some((f) => f.indexOf('[object Object]') >= 0), '没有任何文件叫 [object Object]（平台目标对象形状没有混进 Node 服务）')
  check(fallbackBody.indexOf('[object Object]') < 0, '日志正文里也没有 [object Object]（目标对象字符串化的痕迹）')
  check(
    fallbackPlatformFs.counts.read === 0 && fallbackPlatformFs.counts.write === 0,
    '切换后不再回落到平台文件服务读写（平台被绕过；实得 read=' + fallbackPlatformFs.counts.read + ' write=' + fallbackPlatformFs.counts.write + '）'
  )

  // ── 三、能力齐全时不切换：仍用调用方递进来的服务 ────────────────────────
  const capableRoot = makeTmp('capable')
  const capableCacheDir = path.join(capableRoot, 'cache')
  const capableMemory = makeMemoryLogFs()
  const capableFs = capableMemory.fs
  const capableStore = await mod.createLogFromPackage({
    fs: capableFs,
    timer: {
      timeout(fn, ms) { return setTimeout(fn, ms) },
      interval(fn, ms) { return setInterval(fn, ms) },
    },
    getCacheDir: async () => capableCacheDir,
    getPlatform: async () => platformOf(capableFs),
    DEFAULT_CWD: capableRoot,
  })
  check(!!capableStore && typeof capableStore.log === 'function', '能力齐全时日志库正常建起来')
  if (capableStore && typeof capableStore.log === 'function') {
    capableStore.log('warn', 'gate.probe.line', { case: 'capable' })
    await capableStore.flushNow()
  }
  const capableLogKeys = Array.from(capableMemory.snapshot().keys()).filter((k) => String(k).indexOf('/logs/') >= 0)
  check(capableLogKeys.length > 0, '能力齐全时日志仍写进调用方递进来的文件服务（没有被悄悄替换）')
  const capableBody = capableLogKeys.map((k) => String(capableMemory.snapshot().get(k))).join('\n')
  check(capableBody.indexOf('gate.probe.line') >= 0, '能力齐全时那一行也真的写进了调用方服务的文件')
  check(
    capableMemory.calls.append + capableMemory.calls.write > 0,
    '能力齐全时调用方服务真的被调用过（append/write 至少一次）'
  )
  check(!fs.existsSync(path.join(capableCacheDir, 'logs')), '能力齐全时没有另建真实日志目录（没有静默换服务）')

  fs.rmSync(fallbackRoot, { recursive: true, force: true })
  fs.rmSync(capableRoot, { recursive: true, force: true })

  console.log(failed ? '\n存在失败：' + failed + ' 条' : '\n全部通过')
  printGateResult('verify-1854-log-fs-port', total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log('  FAIL 门禁执行异常：' + (e && e.message ? e.message : String(e)))
  printGateResult('verify-1854-log-fs-port', total, 1)
  process.exit(1)
})
