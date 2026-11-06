// runtime/storage-kind.ts —— 库文件落在本地磁盘还是网络盘（#1932，规格 #1930 §2.2）
//
// 为什么要有这一格：同一份 SQLite 文件在本地磁盘上可以被多个进程同时打开、靠写锁排队；
// 在网络盘（UNC / SMB / NFS / FUSE 挂载）上多进程写同一份文件不保证安全，必须退回「单写者 +
// 抢不到就只读」。两条路的写模型不一样，而路径长什么样只有这一处能回答。
//
// 三条约定：
//   1. 判不出来一律按本地（local）处理。取舍是「宁可多窗口可写，也不把一个人的本地库锁成只读」：
//      把网络盘误判成本地，最坏是并发写出现 SQLite 的网络盘风险（已有 WAL 回退与错误处理兜着）；
//      把本地误判成网络盘，会让所有用户的第二窗口莫名只读——后者是确定会发生的坏结果。
//      这条取舍写进了 src/workspace-snapshot/README.md 的「写模型」一节，改之前先读那一段。
//   2. 判定结果按进程缓存：Windows 那次查系统网络盘集合要起一个 PowerShell，不能每次开库都付一次。
//   3. 门禁要能在任一种主机上验两条路：平台与文件系统类型读数都可以注入，生产代码不传。
import type { SnapshotStorageKind } from '../model/types.js'
import { SNAPSHOT_NETWORK_DRIVE_PROBE_MS } from '../../shared/time-config/src/values.js'
import { dirname, existsSync, statfsTypeOf } from './node-builtins.js'
import { WORKSPACE_ROOT_MAX_DEPTH } from './paths.js'

// process 在这里只用两件事：读平台、取内置模块。声明写窄是为了不把 Node 的环境声明带进
// refresh / host 的编译程序（理由与 node-builtins.ts 文件头相同）。
declare const process: { platform: string, env?: Record<string, string | undefined>, getBuiltinModule(id: string): any }

/** 一次判定的结果：类别 + 依据（依据只进日志与诊断，不参与判断）。 */
export interface StorageKindDetection {
  kind: SnapshotStorageKind
  /** 判定依据的代号：unc-path / network-drive / local-drive / posix-nfs / probe-failed 之类。 */
  reason: string
}

/** 判定入口的可注入部分。生产代码不传；门禁靠它验两种平台与两条路径，不依赖跑在哪种主机上。 */
export interface DetectStorageKindOptions {
  /** 覆盖平台判断（缺省读 process.platform）。门禁在 Windows 上验 POSIX 那一路时用它。 */
  platform?: string
  /** 覆盖文件系统类型读数（POSIX 那一路），返回 statfs 的 f_type。 */
  statfsTypeOf?: (target: string) => number
  /** 覆盖「本机网络盘集合」探测：返回盘符集合；抛错表示探测失败（按本地处理）。 */
  networkDrivesOf?: () => string[]
}

/**
 * 网络文件系统的 f_type（statfs 的 magic）。取值来自 Linux 的 statfs 定义：
 * NFS 0x6969、SMB 0x517B、SMB2 0xFE534D42、CIFS 0xFF534D42、FUSE 0x65735546、
 * AFS 0x5346414F、9P 0x01021997。只认这几族：认不出来的一律当本地盘。
 */
export const NETWORK_FILESYSTEM_MAGIC: Record<string, number> = {
  nfs: 0x6969,
  smb: 0x517b,
  smb2: 0xfe534d42,
  cifs: 0xff534d42,
  fuse: 0x65735546,
  afs: 0x5346414f,
  ninep: 0x01021997,
}

/** 进程级缓存：null = 还没查过。查失败也缓存（空集合 + 说明），避免每次开库都重试一次 PowerShell。 */
let cachedNetworkDrives: { drives: Set<string> } | null = null

function currentPlatform(): string {
  return typeof process !== 'undefined' && process ? String(process.platform || '') : ''
}

/** Windows 路径的反斜杠统一成正斜杠再判形状：UNC 的两种写法（\\ 与 //）由此归一。 */
function slashed(path: string): string {
  return String(path).replace(/\\/g, '/')
}

/** UNC：\\server\share 与 //server/share 都算网络路径，不需要再问系统。 */
function isUncPath(path: string): boolean {
  return slashed(path).slice(0, 2) === '//'
}

/** 盘符路径（X:\ 或 X:/）的盘符，大写带冒号；不是盘符路径回 null。 */
function driveLetterOf(path: string): string | null {
  const hit = /^([a-zA-Z]):\//.exec(slashed(path))
  return hit ? hit[1].toUpperCase() + ':' : null
}

/**
 * 查本机的网络盘集合（DriveType=4 的逻辑盘）。只查一次，结果与失败都缓存。
 *
 * 为什么用 PowerShell 而不是直接读注册表：Win32_LogicalDisk 是唯一稳定的「这块盘是不是网络驱动器」
 * 来源，映射盘（Z: → \\server\share）在路径上完全看不出来。查询失败（没有 PowerShell、被策略拦住、
 * 超时）就按本地处理并让调用方记一行日志 —— 见文件头第 1 条取舍。
 */
function networkDrivesOfThisMachine(): Set<string> {
  if (cachedNetworkDrives) return cachedNetworkDrives.drives
  const drives = new Set<string>()
  try {
    const childProcess: any = process.getBuiltinModule('node:child_process')
    const probe = childProcess.spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=4" | Select-Object -ExpandProperty DeviceID'],
      { encoding: 'utf8', timeout: SNAPSHOT_NETWORK_DRIVE_PROBE_MS, windowsHide: true },
    )
    const text = String((probe && probe.stdout) || '')
    for (const line of text.split(/\r?\n/)) {
      const hit = /^\s*([a-zA-Z]):?/.exec(line)
      if (hit) drives.add(hit[1].toUpperCase() + ':')
    }
  } catch {
    // 查不到就按本地处理：这条分支本来就是要「失败也不挡开库」。
  }
  cachedNetworkDrives = { drives }
  return drives
}

/** 从给定路径向上找到第一个存在的目录或文件；都找不到回 null（调用方按本地处理）。 */
function nearestExistingAncestor(target: string): string | null {
  let current = target
  for (let depth = 0; depth < WORKSPACE_ROOT_MAX_DEPTH; depth += 1) {
    if (existsSync(current)) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

/** 按 f_type 认网络文件系统；认不出来回 null（= 本地盘）。 */
function networkFilesystemNameOf(type: number): string | null {
  const value = Number(type) >>> 0
  for (const name of Object.keys(NETWORK_FILESYSTEM_MAGIC)) {
    if (NETWORK_FILESYSTEM_MAGIC[name] === value) return name
  }
  return null
}

/**
 * 判定一份库文件所在的存储类别，并把依据一起交出来。生产代码用下面的 detectStorageKind
 * 只取类别；open.ts 取依据写进开库日志，排查时能回答「这个窗口为什么按多写者工作」。
 */
export function detectStorageKindDetailed(
  dbPath: string,
  options?: DetectStorageKindOptions,
): StorageKindDetection {
  if (typeof dbPath !== 'string' || dbPath.length === 0) return { kind: 'local', reason: 'no-path' }
  if (isUncPath(dbPath)) return { kind: 'network', reason: 'unc-path' }

  const platform = options && options.platform ? options.platform : currentPlatform()
  if (platform === 'win32') {
    const drive = driveLetterOf(dbPath)
    // 既不是 UNC 也不是盘符（相对路径、\\?\ 扩展前缀之类）：按本地处理，不冒险锁成只读。
    if (!drive) return { kind: 'local', reason: 'local-path' }
    // 系统盘不可能是映射的网络驱动器（Windows 不允许把网络驱动器映射到系统盘的盘符），
    // 直接判本地，省掉那一次 PowerShell 查询。绝大多数用户的工作区就在系统盘上，这一次省下来
    // 就是每次进程第一次开库不再多等约 300 毫秒。
    const systemDrive = typeof process !== 'undefined' && process.env && process.env.SystemDrive
      ? String(process.env.SystemDrive).toUpperCase()
      : ''
    if (systemDrive && drive === (systemDrive.endsWith(':') ? systemDrive : systemDrive + ':')) {
      return { kind: 'local', reason: 'system-drive' }
    }
    let drives: Set<string>
    try {
      drives = options && options.networkDrivesOf
        ? new Set(options.networkDrivesOf().map((item) => String(item).toUpperCase()))
        : networkDrivesOfThisMachine()
    } catch {
      return { kind: 'local', reason: 'probe-failed' }
    }
    return drives.has(drive) ? { kind: 'network', reason: 'network-drive' } : { kind: 'local', reason: 'local-drive' }
  }

  // POSIX 与其他类 Unix：库文件可能还不存在（第一次开库），所以查最近的已存在祖先。
  const anchor = nearestExistingAncestor(dbPath)
  if (!anchor) return { kind: 'local', reason: 'no-existing-ancestor' }
  let type = 0
  try {
    type = options && options.statfsTypeOf ? Number(options.statfsTypeOf(anchor)) : statfsTypeOf(anchor)
  } catch {
    return { kind: 'local', reason: 'statfs-failed' }
  }
  const name = networkFilesystemNameOf(type)
  return name ? { kind: 'network', reason: 'posix-' + name } : { kind: 'local', reason: 'local-disk' }
}

/** 只要类别的那一半。门禁与调用方读这一句就够；要依据用 detectStorageKindDetailed。 */
export function detectStorageKind(
  dbPath: string,
  options?: DetectStorageKindOptions,
): SnapshotStorageKind {
  return detectStorageKindDetailed(dbPath, options).kind
}

/** 门禁用的清缓存入口：两次断言之间换了注入的探测函数时，不共享上一次的结果。 */
export function resetStorageKindProbeCache(): void {
  cachedNetworkDrives = null
}
