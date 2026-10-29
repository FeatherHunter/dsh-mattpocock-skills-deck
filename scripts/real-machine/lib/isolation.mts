// isolation.mts —— 设置文件隔离探针，以及隔离失败时的备份/全局锁/按哈希恢复这套替代动作。
//
// 探针只做一件事：起一个子进程，把它的 USERPROFILE 指到临时目录，看 os.homedir() 是否跟着变、
// 在里面写标记文件是否成功，同时确认真实设置文件一个字节都没变。子进程只写临时目录，不写真实 home。
//
// 如果探针结论是「隔离不住」，替代流程是：
//   1. 先备份真实 settings.yaml，并记下 SHA256；
//   2. 取全局锁（同一时刻只让一个实例使用真实 home），锁用 mkdir 原子创建；
//   3. 验证结束后按哈希核对，不一致就用备份恢复，再核对一次。

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertWritableTarget } from './paths.mts'
import { ensureDir, exists, isDir, nowIso, rmrf, sha256File, stamp, writeJson, writeText } from './util.mts'

/** 真实 DSH home 里插件设置文件的相对位置。 */
const SETTINGS_SEGMENTS = ['.dsh', 'mattskillsdeck', 'settings.yaml']

export interface SettingsIsolationProbe {
  ok: boolean
  method: 'USERPROFILE 重定向'
  realHomedir: string
  childHomedir: string
  tempHome: string
  marker: string
  markerFile: string
  /** 临时 home 里的标记文件确实写成功了。 */
  markerWritten: boolean
  /** 子进程从临时 home 读回了同样的标记。 */
  markerReadBack: boolean
  realSettingsPath: string
  realHashBefore: string | null
  realHashAfter: string | null
  realBytesBefore: number | null
  realBytesAfter: number | null
  /** 真实设置文件在探针前后哈希一致（没被动过）。 */
  realUnchanged: boolean
  childStdout: string
  childStderr: string
  tempDir: string
  reason: string
}

const PROBE_SCRIPT = `// 由隔离探针生成：只读 homedir、可写标记，不碰真实 home。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mode = process.argv[2] || 'print'
const homedir = os.homedir()
const output = { homedir, markerFile: '', markerOk: false }
if (mode === 'write') {
  const dir = path.join(homedir, '.dsh', 'mattskillsdeck')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'settings.yaml')
  const marker = 'isolation-probe-' + process.pid + '-' + Date.now()
  fs.writeFileSync(file, '# 隔离探针写的标记文件，不是真实设置\\nmarker: ' + marker + '\\n', 'utf8')
  const readBack = fs.readFileSync(file, 'utf8')
  output.markerFile = file
  output.markerOk = readBack.indexOf(marker) >= 0
  output.marker = marker
}
console.log(JSON.stringify(output))
`

function runChild(scriptPath: string, mode: 'print' | 'write', env: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, mode], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: any) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk: any) => {
      stderr += String(chunk)
    })
    child.on('error', () => resolve({ stdout, stderr, code: null }))
    child.on('exit', (code: any) => resolve({ stdout, stderr, code }))
  })
}

function parseLastJson(stdout: string): any {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i])
    } catch {
      // 继续往上找。
    }
  }
  return null
}

/**
 * 跑隔离探针。realHome 省缺按 USERPROFILE（或 DSH_REAL_HOME）算；结果同时写成 JSON 文件，供证据工具收走。
 */
export async function probeSettingsIsolation(options: { batchDir: string; realHome?: string }): Promise<SettingsIsolationProbe> {
  const batchDir = path.resolve(options.batchDir)
  assertWritableTarget(batchDir)
  const realHome = path.resolve(options.realHome || process.env.DSH_REAL_HOME || path.join(os.homedir(), '.dsh'))
  const realSettingsPath = path.join(realHome, SETTINGS_SEGMENTS[1], SETTINGS_SEGMENTS[2])
  const tempDir = path.join(batchDir, 'probes', 'isolation-' + stamp())
  const tempHome = path.join(tempDir, 'userprofile')
  ensureDir(tempHome)
  const scriptPath = path.join(tempDir, 'probe-homedir.mjs')
  writeText(scriptPath, PROBE_SCRIPT)

  const hashBefore = exists(realSettingsPath) ? sha256File(realSettingsPath) : null
  const bytesBefore = exists(realSettingsPath) ? fs.statSync(realSettingsPath).size : null

  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')) as Record<string, string>
  const baseline = parseLastJson((await runChild(scriptPath, 'print', baseEnv)).stdout)
  const redirected = await runChild(scriptPath, 'write', { ...baseEnv, USERPROFILE: tempHome, HOME: tempHome })
  const child = parseLastJson(redirected.stdout)

  const hashAfter = exists(realSettingsPath) ? sha256File(realSettingsPath) : null
  const bytesAfter = exists(realSettingsPath) ? fs.statSync(realSettingsPath).size : null
  const markerFile = String((child && child.markerFile) || '')
  const markerWritten = Boolean(child && child.markerOk)
  const childHomedir = String((child && child.homedir) || '')
  const tempPrefix = tempHome.toLowerCase()
  const redirectedOk = childHomedir.toLowerCase().startsWith(tempPrefix)
  const realUnchanged = hashBefore === hashAfter && bytesBefore === bytesAfter
  const ok = Boolean(baseline && child) && redirectedOk && markerWritten && realUnchanged

  const reason = ok
    ? '子进程的 os.homedir() 跟着 USERPROFILE 落在临时目录；标记文件在临时 home 写入并读回成功；真实设置文件前后哈希一致。'
    : [
        !baseline ? '基线子进程没有输出可解析的 homedir。' : '',
        !child ? '重定向子进程没有输出可解析的结果。' : '',
        baseline && child && !redirectedOk ? '重定向后子进程的 homedir 仍然是「' + childHomedir + '」，没有落到临时目录。' : '',
        child && !markerWritten ? '临时 home 里的标记文件没有写成功或读回不一致。' : '',
        !realUnchanged ? '真实设置文件在探针前后哈希不一致：' + String(hashBefore) + ' → ' + String(hashAfter) + '。' : '',
      ]
        .filter(Boolean)
        .join(' ')

  const result: SettingsIsolationProbe = {
    ok,
    method: 'USERPROFILE 重定向',
    realHomedir: String((baseline && baseline.homedir) || os.homedir()),
    childHomedir,
    tempHome,
    marker: String((child && child.marker) || ''),
    markerFile,
    markerWritten,
    markerReadBack: markerWritten,
    realSettingsPath,
    realHashBefore: hashBefore,
    realHashAfter: hashAfter,
    realBytesBefore: bytesBefore,
    realBytesAfter: bytesAfter,
    realUnchanged,
    childStdout: redirected.stdout.trim(),
    childStderr: redirected.stderr.trim(),
    tempDir,
    reason,
  }
  writeJson(path.join(batchDir, 'probes', 'isolation-' + stamp() + '.json'), result)
  return result
}

export interface IsolationFallbackStep {
  title: string
  why: string
  command: string
}

/** 隔离失败时的替代流程说明：备份、全局锁、验后按哈希恢复。命令都指向本 harness 的命令脚本。 */
export function isolationFallbackPlan(options: { batchDir: string; realHome?: string; repoRoot: string }): { reason: string; steps: IsolationFallbackStep[] } {
  const realHome = path.resolve(options.realHome || process.env.DSH_REAL_HOME || path.join(os.homedir(), '.dsh'))
  const settings = path.join(realHome, 'mattskillsdeck', 'settings.yaml')
  const backupDir = path.join(path.resolve(options.batchDir), 'settings-backup')
  const lockDir = path.join(path.resolve(options.batchDir), 'real-settings.lock')
  const runner = 'node --import ./scripts/ts-hook.mts scripts/real-machine/commands'
  return {
    reason: 'USERPROFILE 重定向不能把设置文件隔离到临时 home 时，实例会直接读写真实 home 里的 ' + settings + '：一个批次的设置改动会污染另一个批次。替代办法是让同一时刻只有一个批次碰真实 home，并在批次前后按哈希核对与恢复。',
    steps: [
      {
        title: '第一步：先备份真实设置文件',
        why: '不管后面成功还是失败，先有一份可以逐字节恢复的副本；备份时记下 SHA256，恢复后要核到同一个哈希。',
        command: runner + '/backup-settings.mts --out "' + backupDir + '"',
      },
      {
        title: '第二步：取全局锁，独占真实 home',
        why: '锁用 mkdir 原子创建（目录已存在就说明有别的批次在跑）；拿到锁才启动实例，跑完在 finally 里释放，避免两个批次互相覆盖设置。',
        command: runner + '/global-lock.mts --lock "' + lockDir + '" --purpose "批次名"',
      },
      {
        title: '第三步：验证结束后按哈希恢复',
        why: '退出前比较真实设置文件当前的 SHA256 与备份值：一致就保留现状；不一致就写回备份，再核一次，确保下一个批次从干净的设置开始。',
        command: runner + '/restore-settings.mts --backup "' + backupDir + '"',
      },
      {
        title: '第四步：释放全局锁',
        why: '不释放会让后续批次一直等锁；异常退出时同样要释放，所以放在 finally 里做。',
        command: runner + '/global-lock.mts --release --lock "' + lockDir + '"',
      },
    ],
  }
}

/** 备份真实设置文件；返回备份路径与哈希。文件不存在时如实记 absent，不当作失败的重试理由。 */
export function backupRealSettings(options: { outDir: string; realHome?: string }): { targetPath: string; backupPath: string; sha256: string | null; bytes: number | null; existed: boolean } {
  const outDir = path.resolve(options.outDir)
  assertWritableTarget(outDir)
  const realHome = path.resolve(options.realHome || process.env.DSH_REAL_HOME || path.join(os.homedir(), '.dsh'))
  const targetPath = path.join(realHome, 'mattskillsdeck', 'settings.yaml')
  ensureDir(outDir)
  const backupPath = path.join(outDir, 'settings.yaml')
  const metadataPath = path.join(outDir, 'settings-backup.json')
  if (!exists(targetPath)) {
    writeJson(metadataPath, { targetPath, existed: false, backedUpAt: nowIso() })
    return { targetPath, backupPath, sha256: null, bytes: null, existed: false }
  }
  fs.copyFileSync(targetPath, backupPath)
  const sha256 = sha256File(backupPath)
  const bytes = fs.statSync(backupPath).size
  writeJson(metadataPath, { targetPath, backupPath, existed: true, sha256, bytes, backedUpAt: nowIso() })
  return { targetPath, backupPath, sha256, bytes, existed: true }
}

/** 按备份恢复真实设置文件：先核对备份自身的哈希，再写回，最后再核一次目标哈希。 */
export function restoreRealSettings(options: { backupDir: string; realHome?: string; force?: boolean }): { restored: boolean; skipped: boolean; targetPath: string; backupPath: string; expectedSha256: string | null; actualSha256: string | null; matchedBefore: boolean } {
  const backupDir = path.resolve(options.backupDir)
  const metadataPath = path.join(backupDir, 'settings-backup.json')
  if (!exists(metadataPath)) throw new Error('备份目录「' + backupDir + '」里没有 settings-backup.json：先跑 backup-settings。')
  const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as any
  const targetPath = String(meta.targetPath || '')
  if (!targetPath) throw new Error('备份记录里没有 targetPath，无法确定要恢复到哪个文件。')
  assertWritableTarget(targetPath)
  const realHome = path.resolve(options.realHome || process.env.DSH_REAL_HOME || path.join(os.homedir(), '.dsh'))
  if (path.resolve(path.join(realHome, 'mattskillsdeck', 'settings.yaml')) !== path.resolve(targetPath)) {
    throw new Error('备份记录的 targetPath「' + targetPath + '」与当前真实 home 的设置路径不一致：拒绝跨机器恢复。')
  }
  if (!meta.existed) return { restored: false, skipped: true, targetPath, backupPath: '', expectedSha256: null, actualSha256: exists(targetPath) ? sha256File(targetPath) : null, matchedBefore: false }
  const backupPath = String(meta.backupPath || path.join(backupDir, 'settings.yaml'))
  if (!exists(backupPath)) throw new Error('备份文件「' + backupPath + '」不见了，无法恢复。')
  const expectedSha256 = String(meta.sha256 || '')
  const backupSha = sha256File(backupPath)
  if (expectedSha256 && backupSha !== expectedSha256) throw new Error('备份文件自身的哈希与记录不一致：记录 ' + expectedSha256 + '，实际 ' + backupSha + '。备份已被改动，拒绝用它恢复。')
  const currentSha = exists(targetPath) ? sha256File(targetPath) : null
  const matchedBefore = currentSha === expectedSha256
  if (matchedBefore && !options.force) return { restored: false, skipped: true, targetPath, backupPath, expectedSha256, actualSha256: currentSha, matchedBefore: true }
  ensureDir(path.dirname(targetPath))
  fs.copyFileSync(backupPath, targetPath)
  const actualSha256 = sha256File(targetPath)
  if (expectedSha256 && actualSha256 !== expectedSha256) throw new Error('恢复后哈希仍然不一致：期望 ' + expectedSha256 + '，实际 ' + actualSha256 + '。请人工检查。')
  return { restored: true, skipped: false, targetPath, backupPath, expectedSha256, actualSha256, matchedBefore }
}

export interface GlobalLock {
  lockDir: string
  ownerPath: string
  acquiredAt: string
}

/** 取全局锁：mkdir 是原子操作，目录已存在就抛错（提示谁在占用）。 */
export function acquireGlobalLock(options: { lockDir: string; purpose?: string }): GlobalLock {
  const lockDir = path.resolve(options.lockDir)
  const ownerPath = path.join(lockDir, 'owner.json')
  try {
    fs.mkdirSync(lockDir, { recursive: false })
  } catch (error: any) {
    if (error && error.code === 'EEXIST') {
      let owner = ''
      try {
        owner = fs.readFileSync(ownerPath, 'utf8')
      } catch {
        owner = ''
      }
      throw new Error('全局锁已被占用：「' + lockDir + '」已存在。占用记录：' + (owner || '（没有 owner.json，可能是上次异常退出留下的；确认没有实例在跑后手工删掉这个目录）'))
    }
    throw error
  }
  const lock: GlobalLock = { lockDir, ownerPath, acquiredAt: nowIso() }
  writeJson(ownerPath, { pid: process.pid, purpose: options.purpose || '', acquiredAt: lock.acquiredAt, host: os.hostname() })
  return lock
}

/** 释放全局锁：只删自己的锁目录（owner pid 对不上时不删，交给占用的进程自己释放）。 */
export function releaseGlobalLock(lockDir: string): { released: boolean; reason: string } {
  const resolved = path.resolve(lockDir)
  if (!exists(resolved)) return { released: false, reason: '锁目录不存在，可能已经释放过了。' }
  const ownerPath = path.join(resolved, 'owner.json')
  if (exists(ownerPath)) {
    try {
      const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as any
      if (owner && owner.pid && Number(owner.pid) !== process.pid && Number(owner.pid) !== 0) {
        return { released: false, reason: '锁的 owner 是 pid ' + owner.pid + '，不是当前进程；确认它已经退出后再手工删除。' }
      }
    } catch {
      // owner.json 坏了也允许删，锁已经失去意义。
    }
  }
  rmrf(resolved)
  return { released: true, reason: '' }
}

/** 真实设置文件的哈希，用于在批次前后对比。 */
export function realSettingsFingerprint(realHome?: string): { path: string; exists: boolean; sha256: string | null; bytes: number | null } {
  const home = path.resolve(realHome || process.env.DSH_REAL_HOME || path.join(os.homedir(), '.dsh'))
  const target = path.join(home, 'mattskillsdeck', 'settings.yaml')
  if (!exists(target)) return { path: target, exists: false, sha256: null, bytes: null }
  return { path: target, exists: true, sha256: sha256File(target), bytes: fs.statSync(target).size }
}

export { isDir }
