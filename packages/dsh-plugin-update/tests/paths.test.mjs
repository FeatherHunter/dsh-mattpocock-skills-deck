/**
 * packages/dsh-plugin-update/tests/paths.test.mjs —— 落盘目录派生、旧路径冻结、双读规则。
 *
 * 只测外部行为：在落盘层断言新旧路径读写规则。不测内部私有常量与函数名。
 * 文件读写走真实临时目录（前缀隔离），不碰生产路径；网络与子进程一律不用。
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createUpdateDiskPorts, pathsForUpdate } from '../dist/store.js'

function shortHash(text) {
  return createHash('sha256').update(String(text)).digest('hex').slice(0, 24)
}

let homeDir = ''
let profileDir = ''

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'dpu-home-'))
  profileDir = mkdtempSync(join(tmpdir(), 'dpu-profile-'))
})

after(() => {
  rmSync(homeDir, { recursive: true, force: true })
  rmSync(profileDir, { recursive: true, force: true })
})

describe('落盘执行器的目录派生与双读', () => {
  it('目录按标识派生，三文件名不变', () => {
    const paths = pathsForUpdate(homeDir, 'my-plugin', profileDir)
    assert.equal(paths.directory, join(homeDir, 'updates', 'my-plugin', shortHash(profileDir)))
    assert.equal(paths.state, join(paths.directory, 'state.json'))
    assert.equal(paths.lock, join(paths.directory, 'install.lock'))
    assert.equal(paths.backup, join(paths.directory, 'before.json'))
  })

  it('旧标识对应的旧路径一字不差（冻结验收项）', () => {
    const fresh = pathsForUpdate(homeDir, 'dsh-mattpocock-skills-deck', profileDir)
    // 旧原文：join(家目录, 'updates', 'dsh-mattpocock-skills-deck', 短指纹)。
    const legacyLiteral = join(homeDir, 'updates', 'dsh-mattpocock-skills-deck', shortHash(profileDir))
    assert.equal(fresh.directory, legacyLiteral)
  })

  it('写只写新路径：旧影子目录不产生文件', async () => {
    const ports = createUpdateDiskPorts(homeDir, 'my-plugin', profileDir)
    const job = { id: 'job-1', state: 'installing', targetVersion: '1.0.0', message: null, requestId: 'req-1' }
    await ports.writeJob(job)
    const readBack = await ports.readJob()
    assert.equal(readBack.id, 'job-1')
    assert.equal(readBack.targetVersion, '1.0.0')
    // 旧影子目录没有被写出。
    const legacyState = join(homeDir, 'updates', 'dsh-mattpocock-skills-deck', shortHash(profileDir), 'state.json')
    const { stat } = await import('node:fs/promises')
    await assert.rejects(() => stat(legacyState), /ENOENT/)
    await ports.writeJob(null)
    assert.equal(await ports.readJob(), null)
  })

  it('读走双读：新路径没有回退读旧路径', async () => {
    // 先往旧影子写一份（模拟升级前的老用户资产）。
    const legacyPorts = createUpdateDiskPorts(homeDir, 'dsh-mattpocock-skills-deck', profileDir)
    const legacyJob = { id: 'legacy-job', state: 'failed', targetVersion: '0.9.0', message: 'install-failed', requestId: null }
    await legacyPorts.writeJob(legacyJob)
    // 新标识的端口读不到自己的新文件时，回退读到旧资产。
    const ports = createUpdateDiskPorts(homeDir, 'brand-new-plugin', profileDir)
    const fallback = await ports.readJob()
    assert.equal(fallback.id, 'legacy-job')
    // 新路径一旦有自己的文件，优先读新，不再回退。
    const ownJob = { id: 'own-job', state: 'failed', targetVersion: '1.0.0', message: 'install-failed', requestId: null }
    await ports.writeJob(ownJob)
    assert.equal((await ports.readJob()).id, 'own-job')
    await ports.writeJob(null)
    await legacyPorts.writeJob(null)
  })

  it('旧标识自己的读写不受双读干扰（新旧同一目录）', async () => {
    const ports = createUpdateDiskPorts(homeDir, 'dsh-mattpocock-skills-deck', profileDir)
    assert.equal(ports.legacyPaths, null)
    const job = { id: 'legacy-self', state: 'installing', targetVersion: '1.0.0', message: null, requestId: 'r' }
    await ports.writeJob(job)
    assert.equal((await ports.readJob()).id, 'legacy-self')
    await ports.writeJob(null)
  })
})
