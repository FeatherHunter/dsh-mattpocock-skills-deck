/**
 * src/host/updateStore.js — 更新任务的落盘与执行跑腿（安装票 #542）
 *
 * 只跑腿不决策：状态目录按使用范围隔离（三件套：任务记录、防重锁、装前备份），
 * 安装命令经子进程跑（按钮强制官方源加精确版本）。决策顺序全在更新核心，
 * 本文件被更新胶水动态装配（同层边记基线），测试一律用假零件，不真写盘真跑命令。
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buttonCommand } from '../shared/update/commands.js'

const JOB_STATES = ['installing', 'verifying', 'restart-required', 'completed', 'failed', 'interrupted']
const SNAPSHOT_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']

function fail(code) { return Object.assign(new Error(code), { code }) }
function shortHash(text) {
  try {
    return createHash('sha256').update(String(text)).digest('hex').slice(0, 24)
  } catch {
    return '00000000'
  }
}

/** 状态目录：家目录下按使用范围隔离，短指纹只做同一性判断，不记原文。 */
export function pathsForUpdate(homeDir, profileDir) {
  if (typeof homeDir !== 'string' || !homeDir || typeof profileDir !== 'string' || !profileDir) return null
  const directory = join(homeDir, 'updates', 'dsh-mattpocock-skills-deck', shortHash(profileDir))
  return { directory, state: join(directory, 'state.json'), lock: join(directory, 'install.lock'), backup: join(directory, 'before.json') }
}

async function readJsonGuarded(filename, missing) {
  try {
    if ((await stat(filename)).size > 10 * 1024 * 1024) throw fail('install-failed')
    return JSON.parse(await readFile(filename, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return missing
    throw error && error.code ? error : fail('install-failed')
  }
}

async function writeJsonAtomic(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temporary, filename)
  } catch {
    throw fail('install-failed')
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

/** 建任务存取与锁：胶水按当前使用范围建一份，转交核心当零件。 */
export function createUpdateDiskPorts(homeDir, profileDir) {
  const paths = pathsForUpdate(homeDir, profileDir)
  async function readJob() {
    if (!paths) return null
    const job = await readJsonGuarded(paths.state, null)
    if (!job) {
      const lock = await readJsonGuarded(paths.lock, null)
      if (lock) return { id: 'locked', state: 'interrupted', message: 'recovery-required', targetVersion: null, requestId: null }
      return null
    }
    if (!JOB_STATES.includes(job.state) || typeof job.id !== 'string') {
      return { id: 'corrupt', state: 'interrupted', message: 'recovery-required', targetVersion: null, requestId: null }
    }
    return { requestId: null, message: null, ...job }
  }
  async function writeJob(job) {
    if (!paths) throw fail('install-failed')
    if (job === null) {
      await unlink(paths.state).catch((error) => { if (!error || error.code !== 'ENOENT') throw fail('install-failed') })
      return
    }
    await mkdir(paths.directory, { recursive: true, mode: 0o700 })
    await writeJsonAtomic(paths.state, job)
  }
  async function tryAcquireLock(lockId) {
    if (!paths) return false
    try {
      await mkdir(paths.directory, { recursive: true, mode: 0o700 })
      const handle = await open(paths.lock, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ id: lockId, pid: process.pid, startedAt: Date.now() }))
      } finally {
        await handle.close()
      }
      return true
    } catch (error) {
      if (!error || error.code !== 'EEXIST') return false
      try {
        const current = await readJsonGuarded(paths.lock, null)
        const job = await readJsonGuarded(paths.state, null)
        if (!current || (job && job.id === current.id)) return false
        await unlink(paths.lock).catch(() => {})
        const handle = await open(paths.lock, 'wx', 0o600)
        try {
          await handle.writeFile(JSON.stringify({ id: lockId, pid: process.pid, startedAt: Date.now() }))
        } finally {
          await handle.close()
        }
        return true
      } catch {
        return false
      }
    }
  }
  async function releaseLock(lockId) {
    if (!paths) return
    try {
      const current = await readJsonGuarded(paths.lock, null)
      if (current && current.id === lockId) await unlink(paths.lock).catch(() => {})
    } catch {}
  }
  async function backupJob(job) {
    if (!paths) throw fail('install-failed')
    const files = {}
    for (const name of SNAPSHOT_FILES) {
      try {
        const filename = join(profileDir, name)
        if ((await stat(filename)).size > 3 * 1024 * 1024) throw fail('install-failed')
        files[name] = await readFile(filename, 'utf8')
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw fail('install-failed')
      }
    }
    await mkdir(paths.directory, { recursive: true, mode: 0o700 })
    await writeJsonAtomic(paths.backup, { jobId: job.id, previousVersion: job.previousVersion ?? null, files })
  }
  return { paths, readJob, writeJob, tryAcquireLock, releaseLock, backupJob }
}

/** 真执行器：拼按钮命令并跑子进程；测试一律传假的，不走这里。 */
export function createUpdateExecutor({ profileName, spawnImpl, platform } = {}) {
  return async function runInstall({ version, profileName: liveName }) {
    const name = typeof liveName === 'string' && liveName ? liveName : (profileName ?? null)
    const command = buttonCommand(name, version)
    if (!command) throw fail('install-failed')
    if ((platform ?? process.platform) === 'win32') throw fail('install-failed')
    if (spawnImpl) {
      await spawnImpl({ version, profileName: name, command })
      return
    }
    await runDshCommand(command)
  }
}

async function runDshCommand(command) {
  const { spawn } = await import('node:child_process')
  const parts = String(command).split(' ').filter(Boolean)
  if (parts[0] !== 'dsh') throw fail('install-failed')
  await new Promise((resolve, reject) => {
    const child = spawn(parts[0], parts.slice(1), { env: { ...process.env, CI: 'true' }, stdio: 'ignore', timeout: 15 * 60_000 })
    child.on('error', () => reject(fail('install-failed')))
    child.on('close', (code) => { if (code === 0) resolve(null); else reject(fail('install-failed')) })
  })
}
