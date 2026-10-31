/**
 * src/host/versionControlMaintenanceRead.ts —— 维护页的现场读数与预检共用事实（#1758 T22，规格 #1586 域 11）
 *
 * 为什么单独一叶：诊断页与维护页要的读数（对象与体积、不可达对象、打包状态、提交图、多包索引、
 * 引用打包、自动维护状态）同时喂给界面和预检签票。预检与执行前重验必须读同一份现场，
 * 所以读数、绑定值、量现场集中在这里；本文件不签票、不起任务（那在 Check/Write 两片）。
 *
 * 约定（改这里之前先读）：
 *   1. 一条只读命令走 runPinned（父文件注入），本文件不自己 spawn。
 *   2. 读数解析失败或输出被截断时明确标 truncated / 回失败信封，不拿半份数字当真。
 *   3. 动作名、版本门、任务参数住共享层 maintenance-ops.ts，本文件不复制第二份。
 *   4. 文件存在性（提交图、多包索引、packed-refs）用文件系统判断，不靠命令退出码——缺失时
 *      这些命令也返回 0，只看退出码会把「没有」误判成「有」。
 */
import { failPhone, firstLine } from '../shared/version-control/exec-envelope.js'
import { makeBindings, worktreeBindingInput, canonicalJson } from '../shared/version-control/src/write-ticket.js'
import { maintenancePlanInput, maintenanceOpMetaOf, maintenanceVersionAtLeast, maintenanceVisibleOf, MAINTENANCE_CHECK_CONTRACT, MAINTENANCE_CHECK_VERSION } from '../shared/version-control/src/maintenance-ops.js'
import { rewriteBackupPlanOf } from '../shared/version-control/src/rewrite-ops.js'
import { VC_MAINTENANCE_READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'
// 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node，这些内建模块必然存在。
// @ts-expect-error
import { stat, readdir, readFile, statfs } from 'node:fs/promises'
// @ts-expect-error
import { createHash } from 'node:crypto'

/** 只读命令的输出上限：对象清单、不可达清单与配置读数都按这一个上限读。 */
const READ_LIMIT: number = 8 * 1024 * 1024
/** 不可达对象清单最多逐条进回包多少条：再多只给计数，免得一条清单把回包撑爆。 */
const ITEM_LIMIT: number = 200

/** 造现场读取层；依赖全部由装配壳显式传入，本文件不引别的宿主文件（同层单向）。 */
export function createMaintenanceRead(deps: any): any {
  const readTimeoutMs: number = Number(deps.readTimeoutMs) || VC_MAINTENANCE_READ_TIMEOUT_MS
  const now = function (): number { try { return typeof deps.now === 'function' ? Number(deps.now()) : Date.now() } catch (e) { return Date.now() } }
  const mkDigest = function (text: any): string { return createHash('sha256').update(String(text)).digest('hex').slice(0, 16) }

  /** 失败信封：沿用宿主既有形状，另带稳定 reason 供界面与门禁对账。 */
  function fail(kind: any, reason: any, message: any, extra?: any): any {
    const base: any = failPhone(kind, message)
    base.error.reason = String(reason || '')
    base.reason = String(reason || '')
    if (extra) Object.assign(base, extra)
    return base
  }

  /** 跑一条只读命令并翻成 {ok:true,stdout,truncated} 或失败信封；非零退出默认不算成功。 */
  async function readOut(exe: string, root: string, args: string[], opts?: any): Promise<any> {
    let res: any
    try { res = await deps.runPinned(exe, root, args, { timeoutMs: readTimeoutMs, stdoutLimit: (opts && opts.stdoutLimit) || READ_LIMIT }) } catch (e) { return fail('env', 'unknown', '只读命令没有起进程：' + firstLine(String((e && (e as any).message) || e))) }
    const view: any = opts || {}
    if (res && res.kind === 'ok') return { ok: true, stdout: String(res.stdout || ''), stderr: String(res.stderr || ''), truncated: res.truncated === true }
    if (res && res.kind === 'non-zero' && view.allowNonZero === true) return { ok: true, nonZero: true, exitCode: Number(res.exitCode) || 0, stdout: String(res.stdout || ''), stderr: String(res.stderr || ''), truncated: res.truncated === true }
    if (res && res.kind === 'non-zero') return fail('read', 'unknown', firstLine(res.stderr) || '只读命令以非零退出码结束了')
    return fail('read', 'unknown', firstLine(res && res.message) || '只读命令没有正常结束')
  }

  /** 允许非零的读：老版本 git 不认某个开关时按「没有这个事实」处理，不判失败。 */
  async function readMaybe(exe: string, root: string, args: string[]): Promise<any> {
    try { return await deps.runPinned(exe, root, args, { timeoutMs: readTimeoutMs, stdoutLimit: READ_LIMIT }) } catch (e) { return { kind: 'spawn-failed', message: String((e && (e as any).message) || e) } }
  }

  /** 解析仓库：找不到 git 或不是仓库都回明确失败信封；裸仓库在维护页一律拒绝。 */
  async function repoOf(cwd: string): Promise<any> {
    let exe: any = null
    try { exe = await deps.resolveGitExecutable() } catch (e) { exe = null }
    if (!exe) return fail('env', 'unknown', '找不到 git 命令，读不了仓库现场。')
    const repo: any = await deps.resolveRepoRoot(exe, cwd)
    if (!repo || repo.ok !== true) return repo && repo.error ? repo : fail('not-repo', 'unknown', '当前目录不是 git 仓库：' + cwd)
    return { ok: true, exe: String(exe), root: String(repo.root), bare: repo.kind === 'bare' }
  }

  /** 读 git 版本（完整串，例如 "git version 2.49.0.windows.1"）：版本门与替代说明都从它判。 */
  async function versionOf(exe: string, root: string): Promise<string> {
    const res: any = await readMaybe(exe, root, ['version'])
    return res && res.kind === 'ok' ? String(res.stdout || '').trim() : ''
  }

  /** git 目录的绝对路径：--git-path 给的是相对路径，拼回仓库根后再给文件系统读。 */
  async function gitDirOf(exe: string, root: string): Promise<any> {
    const res: any = await readOut(exe, root, ['rev-parse', '--git-dir'], { stdoutLimit: 4096 })
    if (res.ok !== true) return res
    const raw: string = String(res.stdout || '').trim().replace(/\\/g, '/')
    let dir: string = raw
    if (!/^[A-Za-z]:\//.test(dir) && dir.charAt(0) !== '/') dir = String(root).replace(/\\/g, '/') + '/' + dir.replace(/^\.\//, '')
    return { ok: true, dir: dir.replace(/\/+$/, '') }
  }

  /** 文件多一个字节还是不存在都如实回：读不到按不存在处理，不把异常往上抛。 */
  async function fileInfoOf(path: string): Promise<any> {
    try { const st: any = await stat(path); return { exists: true, bytes: Number(st.size) || 0, mtimeMs: Number(st.mtimeMs) || 0 } } catch (e) { return { exists: false, bytes: 0, mtimeMs: 0 } }
  }

  /** 目录里以某前缀开头的文件清单：pack 目录与 refs 目录都用它数文件。 */
  async function listFilesOf(dir: string): Promise<any[]> {
    try { const names: any[] = await readdir(dir, { withFileTypes: true }); return names.filter(function (n) { return (typeof n.isFile === 'function' ? n.isFile() : n.isFile === true) === true }).map(function (n) { return String(n.name) }) } catch (e) { return [] }
  }

  /** 对象统计（11.4）：count-objects -v 的十进制 KiB 值换算成字节，界面再用 humanBytesOf 排版。 */
  async function objectStatsOf(exe: string, root: string): Promise<any> {
    const res: any = await readOut(exe, root, ['count-objects', '-v'], { stdoutLimit: 256 * 1024 })
    if (res.ok !== true) return res
    const fields: any = {}
    String(res.stdout || '').replace(/\r/g, '').split('\n').forEach(function (line) {
      const m: any = /^([a-z-]+):\s*(\d+)/.exec(line)
      if (m) fields[m[1]] = Number(m[2])
    })
    const looseSizeBytes: number = (Number(fields.size) || 0) * 1024
    const packSizeBytes: number = (Number(fields['size-pack']) || 0) * 1024
    return {
      ok: true,
      looseCount: Number(fields.count) || 0,
      looseSizeBytes: looseSizeBytes,
      inPack: Number(fields['in-pack']) || 0,
      packs: Number(fields.packs) || 0,
      packSizeBytes: packSizeBytes,
      prunePackable: Number(fields['prune-packable']) || 0,
      garbage: Number(fields.garbage) || 0,
      repoSizeBytes: looseSizeBytes + packSizeBytes,
    }
  }

  /** 不可达对象清单：fsck --unreachable 的只读结果，顺手读松散对象文件的修改时间当「最早时间」。 */
  async function unreachableOf(exe: string, root: string): Promise<any> {
    const gitDir: any = await gitDirOf(exe, root)
    if (gitDir.ok !== true) return gitDir
    const res: any = await readOut(exe, root, ['fsck', '--unreachable', '--no-progress'], { stdoutLimit: READ_LIMIT })
    if (res.ok !== true) return res
    const all: any[] = []
    String(res.stdout || '').replace(/\r/g, '').split('\n').forEach(function (line) {
      const m: any = /^unreachable (\w+) ([0-9a-f]{40,64})$/.exec(line.trim())
      if (m) all.push({ oid: m[2], type: m[1] })
    })
    const items: any[] = all.slice(0, ITEM_LIMIT)
    const earliest: any = await earliestLooseOf(gitDir.dir, items)
    return { ok: true, count: all.length, items: items, truncated: all.length > items.length, earliestAtMs: earliest.value, looseFound: earliest.found, packedUnknown: all.length - earliest.found }
  }

  /** 读一批对象的松散文件修改时间，回最小值：打包后的对象没有松散文件，读不到就回 null 并计数。 */
  async function earliestLooseOf(gitDir: string, items: any[]): Promise<any> {
    let min: any = null
    let found: number = 0
    for (let i = 0; i < items.length; i += 1) {
      const oid: string = String(items[i].oid || '')
      if (!/^[0-9a-f]{40,64}$/.test(oid)) continue
      const info: any = await fileInfoOf(gitDir + '/objects/' + oid.slice(0, 2) + '/' + oid.slice(2))
      if (info.exists !== true) continue
      found += 1
      if (min === null || info.mtimeMs < min) min = info.mtimeMs
    }
    return { value: min, found: found }
  }

  /** 清除不可达对象的预演（11.6）：git prune -n -v 只列会被删的对象，不真删。 */
  async function prunePreviewOf(exe: string, root: string): Promise<any> {
    const gitDir: any = await gitDirOf(exe, root)
    if (gitDir.ok !== true) return gitDir
    const res: any = await readOut(exe, root, ['prune', '-n', '-v'], { stdoutLimit: READ_LIMIT })
    if (res.ok !== true) return res
    const all: any[] = []
    String(res.stdout || '').replace(/\r/g, '').split('\n').forEach(function (line) {
      const m: any = /^([0-9a-f]{40,64}) (\w+)$/.exec(line.trim())
      if (m) all.push({ oid: m[1], type: m[2] })
    })
    const items: any[] = all.slice(0, ITEM_LIMIT)
    const earliest: any = await earliestLooseOf(gitDir.dir, items)
    return { ok: true, count: all.length, items: items, truncated: all.length > items.length, earliestAtMs: earliest.value, looseFound: earliest.found, packedUnknown: all.length - earliest.found }
  }

  /** 重新打包的状态（11.7 只读）：几个包、松散对象多少、最后一次打包时间；面板不提供触发按钮。 */
  async function repackOf(exe: string, root: string): Promise<any> {
    const gitDir: any = await gitDirOf(exe, root)
    if (gitDir.ok !== true) return gitDir
    const statsRes: any = await objectStatsOf(exe, root)
    if (statsRes.ok !== true) return statsRes
    const names: string[] = await listFilesOf(gitDir.dir + '/objects/pack')
    const packFiles: string[] = names.filter(function (n) { return /^pack-[0-9a-f]+\.pack$/.test(n) })
    let lastPackAtMs: any = null
    for (let i = 0; i < packFiles.length; i += 1) {
      const info: any = await fileInfoOf(gitDir.dir + '/objects/pack/' + packFiles[i])
      if (info.exists !== true) continue
      if (lastPackAtMs === null || info.mtimeMs > lastPackAtMs) lastPackAtMs = info.mtimeMs
    }
    return { ok: true, packs: statsRes.packs, packFiles: packFiles, looseCount: statsRes.looseCount, packSizeBytes: statsRes.packSizeBytes, lastPackAtMs: lastPackAtMs, canRepack: statsRes.looseCount > 0 || statsRes.packs > 1 }
  }

  /** 提交图（11.9 只读）：支持版本、存在与否、是否拆分、校验结果。 */
  async function commitGraphOf(exe: string, root: string, gitVersion: string): Promise<any> {
    const supported: boolean = maintenanceVersionAtLeast(gitVersion, '2.18')
    const gitDir: any = await gitDirOf(exe, root)
    if (gitDir.ok !== true) return gitDir
    const mainPath: string = gitDir.dir + '/objects/info/commit-graph'
    const chainPath: string = gitDir.dir + '/objects/info/commit-graphs/commit-graph-chain'
    const mainInfo: any = await fileInfoOf(mainPath)
    const chainInfo: any = await fileInfoOf(chainPath)
    let verifyOk: any = null
    let verifyMessage: string = ''
    if (supported) {
      const res: any = await readMaybe(exe, root, ['commit-graph', 'verify'])
      verifyOk = !!(res && res.kind === 'ok')
      verifyMessage = res && res.kind !== 'ok' ? firstLine(res.stderr || res.message) : ''
    }
    return { ok: true, supported: supported, exists: mainInfo.exists || chainInfo.exists, split: chainInfo.exists, bytes: mainInfo.bytes + chainInfo.bytes, verifyOk: verifyOk, verifyMessage: verifyMessage }
  }

  /** 多包索引（11.10 只读）：支持版本、存在与否、校验结果。 */
  async function multiPackIndexOf(exe: string, root: string, gitVersion: string): Promise<any> {
    const supported: boolean = maintenanceVersionAtLeast(gitVersion, '2.21')
    const gitDir: any = await gitDirOf(exe, root)
    if (gitDir.ok !== true) return gitDir
    const info: any = await fileInfoOf(gitDir.dir + '/objects/pack/multi-pack-index')
    const names: string[] = await listFilesOf(gitDir.dir + '/objects/pack')
    const packFiles: string[] = names.filter(function (n) { return /^pack-[0-9a-f]+\.pack$/.test(n) })
    let verifyOk: any = null
    let verifyMessage: string = ''
    if (supported) {
      const res: any = await readMaybe(exe, root, ['multi-pack-index', 'verify'])
      verifyOk = !!(res && res.kind === 'ok')
      verifyMessage = res && res.kind !== 'ok' ? firstLine(res.stderr || res.message) : ''
    }
    return { ok: true, supported: supported, exists: info.exists, bytes: info.bytes, packs: packFiles.length, verifyOk: verifyOk, verifyMessage: verifyMessage }
  }

  /** 引用打包状态（11.11 只读）：packed-refs 里的引用条数、松散引用文件数；面板只展示不触发。 */
  async function packRefsOf(exe: string, root: string): Promise<any> {
    const gitDir: any = await gitDirOf(exe, root)
    if (gitDir.ok !== true) return gitDir
    const info: any = await fileInfoOf(gitDir.dir + '/packed-refs')
    let packedRefCount: number = 0
    let peeledCount: number = 0
    if (info.exists) {
      let text: string = ''
      try { text = String(await readFile(gitDir.dir + '/packed-refs', 'utf8')) } catch (e) { text = '' }
      text.replace(/\r/g, '').split('\n').forEach(function (line) {
        if (line === '' || line.charAt(0) === '#') return
        if (line.charAt(0) === '^') { peeledCount += 1; return }
        if (/^[0-9a-f]{40,64} /.test(line)) packedRefCount += 1
      })
    }
    let looseRefCount: number = 0
    try {
      const names: any[] = await readdir(gitDir.dir + '/refs', { recursive: true, withFileTypes: true })
      looseRefCount = names.filter(function (n) { return (typeof n.isFile === 'function' ? n.isFile() : n.isFile === true) === true }).length
    } catch (e) { looseRefCount = 0 }
    return { ok: true, packedRefsExists: info.exists, packedRefCount: packedRefCount, peeledCount: peeledCount, looseRefCount: looseRefCount, bytes: info.bytes, canPack: looseRefCount > 0 }
  }

  /** 自动维护状态（11.8 只读）：是否已登记、开启了哪些任务、策略是什么；读不到按未登记处理。 */
  async function maintenanceStatusOf(exe: string, root: string, gitVersion: string): Promise<any> {
    const supported: boolean = maintenanceVersionAtLeast(gitVersion, '2.30')
    const res: any = await readMaybe(exe, root, ['config', '--get-all', 'maintenance.repo'])
    const entries: string[] = (res && res.kind === 'ok') ? String(res.stdout || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== '' }).map(function (l) { return l.trim() }) : []
    const normalize = function (p: string): string { return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
    const target: string = normalize(root)
    let registeredLocal: boolean = false
    let registeredGlobal: boolean = false
    entries.forEach(function (entry) { if (normalize(entry) === target) registeredLocal = true; else registeredGlobal = true })
    const tasksRes: any = await readMaybe(exe, root, ['config', '--get-regexp', '^maintenance\\.'])
    const enabledTasks: string[] = []
    let strategy: string = ''
    if (tasksRes && tasksRes.kind === 'ok') {
      String(tasksRes.stdout || '').replace(/\r/g, '').split('\n').forEach(function (line) {
        const m: any = /^maintenance\.([a-z-]+)\.enabled\s+(\w+)$/.exec(line.trim())
        if (m && /^(true|yes|on|1)$/i.test(m[2])) enabledTasks.push(m[1])
        const s: any = /^maintenance\.strategy\s+(\w+)$/.exec(line.trim())
        if (s) strategy = s[1]
      })
    }
    return { ok: true, supported: supported, registeredLocal: registeredLocal, registeredGlobal: registeredGlobal, registered: registeredLocal || registeredGlobal, repos: entries, enabledTasks: enabledTasks, strategy: strategy }
  }

  /** 工作区是否脏：维护命令不改工作区，但自动维护与 gc 会动对象库，现场干净时结论最好解释。 */
  function dirtyOf(screen: any): boolean {
    const count = function (v: any): number { if (Array.isArray(v)) return v.length; const n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0 }
    return count(screen && screen.staged) + count(screen && screen.unstaged) + count(screen && screen.conflictCount) > 0
  }

  /** 进行中的操作：合并、变基、拣选、还原任一为真都算；维护动作要等的只是「别在别人收尾时动对象库」。 */
  function operationOf(screen: any): string | null {
    const r: any = (screen && screen.repo) || {}
    if (r.merging === true) return 'merge'
    if (r.rebasing === true) return 'rebase'
    if (r.cherryPicking === true) return 'cherry-pick'
    if (r.reverting === true) return 'revert'
    return null
  }

  /** 读父目录剩余空间：读不出来按 0 处理，备份决策会因此降级成整仓打包（更保守）。 */
  async function freeBytesOf(target: string): Promise<number> {
    try {
      const fn: any = (deps && deps.fs && typeof deps.fs.statfs === 'function') ? deps.fs.statfs : statfs
      const st: any = await fn(target)
      return Math.max(0, Math.floor(Number(st.bsize) * Number(st.bavail)))
    } catch (e) { return 0 }
  }

  /**
   * 读一次现场：仓库根、HEAD、分支、git 版本、对象统计、自动维护状态、仓库大小、磁盘余量、
   * 进行中操作与工作区脏不脏。预检与执行前重验都走这一个函数，两次口径一样才比得出「变没变」。
   */
  async function sceneOf(cwd: string): Promise<any> {
    const repo: any = await repoOf(cwd)
    if (repo.ok !== true) return repo
    if (repo.bare === true) return fail('blocked', 'repo-bare', '这是一个裸仓库：维护页要在有工作区的仓库里做，请换一个普通仓库。')
    const exe: string = repo.exe
    const root: string = repo.root
    let sc: any = null
    try { sc = await deps.readScreenOf(cwd) } catch (e) { sc = null }
    if (!sc || sc.ok !== true) return fail('read', 'unknown', '读不到仓库首屏，判断不了现场（' + firstLine(String((sc && sc.error && sc.error.message) || sc)) + '）')
    const screen: any = sc.screen
    const gitVersion: string = await versionOf(exe, root)
    if (gitVersion === '') return fail('read', 'unknown', '读不出 git 版本：版本门没法判，先停在这里。')
    const statsRes: any = await objectStatsOf(exe, root)
    if (statsRes.ok !== true) return statsRes
    const maintRes: any = await maintenanceStatusOf(exe, root, gitVersion)
    if (maintRes.ok !== true) return maintRes
    const branchRes: any = await readMaybe(exe, root, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const branch: string = branchRes && branchRes.kind === 'ok' ? String(branchRes.stdout || '').trim() : ''
    const parent: string = root.replace(/[\\/][^\\/]+$/, '') || root
    const freeBytes: number = await freeBytesOf(parent)
    const scene: any = {
      repoRoot: root,
      repoName: root.replace(/^.*[\\/]/, ''),
      headOid: String((screen && screen.identity && screen.identity.oid) || ''),
      branch: branch,
      gitVersion: gitVersion,
      objects: { looseCount: statsRes.looseCount, looseSizeBytes: statsRes.looseSizeBytes, inPack: statsRes.inPack, packs: statsRes.packs, packSizeBytes: statsRes.packSizeBytes, prunePackable: statsRes.prunePackable, garbage: statsRes.garbage, repoSizeBytes: statsRes.repoSizeBytes },
      maintenance: { supported: maintRes.supported, registeredLocal: maintRes.registeredLocal, registeredGlobal: maintRes.registeredGlobal, registered: maintRes.registered, enabledTasks: maintRes.enabledTasks, strategy: maintRes.strategy },
      repoSizeBytes: statsRes.repoSizeBytes,
      freeBytes: freeBytes,
      operation: operationOf(screen),
      dirty: dirtyOf(screen),
      readAtMs: now(),
    }
    return { ok: true, exe: exe, screen: screen, scene: scene }
  }

  /** 计划与现场的绑定值：计划摘要 + 工作区形状；开启/关闭自动维护再多绑一份维护配置。 */
  function bindingsOf(screen: any, plan: any, maintenance: any): any {
    const op: string = String((plan && plan.op) || '')
    const configOldValue: any = (op === 'maintenance-enable' || op === 'maintenance-disable')
      ? mkDigest(canonicalJson({ repos: (maintenance && maintenance.repos) || [], enabledTasks: (maintenance && maintenance.enabledTasks) || [] }))
      : null
    return makeBindings({
      preconditions: {
        planDigest: mkDigest(maintenancePlanInput(plan)),
        worktreeDigest: mkDigest(worktreeBindingInput(screen)),
        configOldValue: configOldValue,
        remoteOid: null,
        pathAbsent: [],
      },
      counters: { indexEntries: null },
    })
  }

  /** 预检与执行前重验共用的量现场：任何一格变了都让票失效，零进程拒绝。 */
  async function measure(cwd: string, plan: any): Promise<any> {
    const measured: any = await sceneOf(cwd)
    if (measured.ok !== true) return measured
    return { ok: true, exe: measured.exe, screen: measured.screen, scene: measured.scene, repoRoot: measured.scene.repoRoot, headOid: measured.scene.headOid, bindings: bindingsOf(measured.screen, plan, measured.scene.maintenance) }
  }

  /** 备份决策：复用整仓重写的同一份估算（镜像克隆优先，磁盘不够降级整仓打包）。 */
  function backupPlanOf(scene: any): any {
    return rewriteBackupPlanOf({ repoRoot: scene.repoRoot, freeBytes: scene.freeBytes, repoSizeBytes: scene.repoSizeBytes, nowMs: scene.readAtMs })
  }

  /**
   * 按动作分派读数：只读电话与预检都从这里拿事实，界面只认这一份回包形状。
   * 回包里带上 op/capId/readAtMs，界面不需要自己再猜这是哪条动作的结果。
   */
  async function readOf(cwd: string, op: string): Promise<any> {
    const metaFound: any = maintenanceOpMetaOf(op)
    if (metaFound === null || metaFound.kind !== 'read') return fail('args', 'bad-target', '认不出的只读动作：' + String(op))
    if (typeof cwd !== 'string' || cwd.trim() === '') return fail('args', 'bad-target', '缺少仓库目录，不知道该读哪个仓库。')
    const repo: any = await repoOf(cwd)
    if (repo.ok !== true) return repo
    const exe: string = repo.exe
    const root: string = repo.root
    const gitVersion: string = await versionOf(exe, root)
    if (gitVersion === '') return fail('read', 'unknown', '读不出 git 版本：不知道这个版本的 git 支不支持这条读数。')
    if (op !== 'overview' && !maintenanceVisibleOf(metaFound.capId, gitVersion)) return fail('blocked', 'version-unsupported', '这个 git 版本（' + gitVersion + '）还没有这条能力，已按版本门隐藏。', { op: op, capId: metaFound.capId, gitVersion: gitVersion })
    let data: any = null
    if (op === 'objects') data = await objectStatsOf(exe, root)
    else if (op === 'unreachable') data = await unreachableOf(exe, root)
    else if (op === 'prune-preview') data = await prunePreviewOf(exe, root)
    else if (op === 'repack') data = await repackOf(exe, root)
    else if (op === 'commit-graph') data = await commitGraphOf(exe, root, gitVersion)
    else if (op === 'multi-pack-index') data = await multiPackIndexOf(exe, root, gitVersion)
    else if (op === 'pack-refs') data = await packRefsOf(exe, root)
    else if (op === 'maintenance-status') data = await maintenanceStatusOf(exe, root, gitVersion)
    else {
      // 总览：维护页一次读完所有卡片要的读数；任何一项读失败按整体失败回，避免半份读数误导。
      const objects: any = await objectStatsOf(exe, root)
      const repack: any = await repackOf(exe, root)
      const status: any = await maintenanceStatusOf(exe, root, gitVersion)
      if (objects.ok !== true) return objects
      if (repack.ok !== true) return repack
      if (status.ok !== true) return status
      data = { ok: true, objects: objects, repack: repack, maintenance: status, gitVersion: gitVersion }
    }
    if (data.ok !== true) return data
    const body: any = { ok: true, contract: MAINTENANCE_CHECK_CONTRACT, version: MAINTENANCE_CHECK_VERSION, op: op, capId: metaFound.capId, readAtMs: now() }
    Object.keys(data).forEach(function (key) { if (key !== 'ok') body[key] = data[key] })
    return body
  }

  return {
    fail: fail,
    readOut: readOut,
    readMaybe: readMaybe,
    repoOf: repoOf,
    versionOf: versionOf,
    gitDirOf: gitDirOf,
    objectStatsOf: objectStatsOf,
    unreachableOf: unreachableOf,
    prunePreviewOf: prunePreviewOf,
    repackOf: repackOf,
    commitGraphOf: commitGraphOf,
    multiPackIndexOf: multiPackIndexOf,
    packRefsOf: packRefsOf,
    maintenanceStatusOf: maintenanceStatusOf,
    sceneOf: sceneOf,
    bindingsOf: bindingsOf,
    measure: measure,
    backupPlanOf: backupPlanOf,
    readOf: readOf,
    digest16: mkDigest,
  }
}
