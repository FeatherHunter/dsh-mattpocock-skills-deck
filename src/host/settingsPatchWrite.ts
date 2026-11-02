/**
 * src/host/settingsPatchWrite.ts —— 按「只含改动格的补丁」写本机设置（#1802 新增）。
 *
 * 为什么要有它：两窗或两个插件实例共用同一份 settings.yaml 时，谁送整份文档谁就会把另一窗刚写进去的格
 *   悄悄顶掉。补丁写只把用户真正动过的那几格合并进「刚读到的最新一份」，别窗的格原样保留。
 *
 * 三条不能改的约定：
 * 1. 先在同一个实例的串行队列里排（由调用方负责），再抢跨进程文件锁：锁文件用独占创建得到，
 *    崩溃遗留超过十秒按过期处理。假文件系统不支持独占创建时退回不加锁执行，单窗仍然正确。
 * 2. 合并之前先比内容指纹（调用方读到的那一版 vs 盘上最新一份）。对不上回 conflict，一个字都不写；
 *    客户端重读最新内容后再把两边的改动合到一起，这条冲突路径是「不静默覆盖」的唯一保证。
 * 3. 落盘仍是整份归一写入（适配器只有这一个写口），但写进去的内容是合并后的最新文档，不是调用方送来的旧文档。
 */

// #1802：补丁合并、内容指纹与空文档都定义在核里，与读侧共用同一套「设置文档长什么样」的约定；
// 文件锁的路径段同样从核里取，避免这里再写一份 .dsh/mattskillsdeck/settings.yaml 的字面量。
import { SETTINGS_REL_SEGMENTS, mergeSettingsPatch, settingsContentHash, settingsEmptyDocument } from '../shared/config-store/src/settings.js'

// 造一个补丁写入口：依赖全部由调用方（settingsPhones）显式传入，本文件不自己取环境、不自己写日志。
export function createSettingsPatchWriter(deps?: any): any {
  const input = deps || {}
  const buildIo = input.buildIo
  const readLocalSettings = input.readLocalSettings
  const writeLocalSettings = input.writeLocalSettings
  const publishSettingsSnapshot = input.publishSettingsSnapshot
  const mapSettingsKind = input.mapSettingsKind
  const readonlyUpgrade = input.readonlyUpgrade
  // #1802：跨进程写设置的文件锁。
  // 为什么进程内串行队列不够：同一份 settings.yaml 可能被两个插件实例（两窗/两进程）同时写，
  // 只在各自进程内排队，两边仍会同时「读 → 改 → 写」，后写的那份会把先写的那份整份顶掉。
  // 锁文件由独占创建抢到，抢不到就等；崩溃遗留的锁超过十秒按过期处理（时间戳从锁文件内容读）。
  // 假文件系统不支持独占创建时不强行失败，退回不加锁执行：单窗场景仍然正确，双窗场景由内容指纹兜底。
  const SETTINGS_LOCK_WAIT_MS = 20
  const SETTINGS_LOCK_TRIES = 100
  const SETTINGS_LOCK_STALE_MS = 10000
  function settingsLockPath(home?: any) {
    const root = String(home || '').replace(/[\\/]+$/, '')
    return root + '/' + SETTINGS_REL_SEGMENTS.join('/') + '.lock'
  }
  function lockParentOf(lockPath?: any) {
    const text = String(lockPath || '')
    const cut = text.lastIndexOf('/')
    return cut > 0 ? text.slice(0, cut) : ''
  }
  function isLockExistsError(e?: any) {
    const code = String((e && ((e as any).code || ((e as any).cause && (e as any).cause.code))) || '')
    if (code === 'EEXIST' || code === 'FILE_EXISTS') return true
    return /EEXIST|already exists/i.test(String((e && (e as any).message) || e || ''))
  }
  function waitMs(ms?: any) {
    return new Promise(function(resolve) { setTimeout(resolve, ms) })
  }
  async function withSettingsFileLock(home?: any, task?: any) {
    const io = buildIo()
    if (typeof io.createExclusive !== 'function') return task()
    const lockPath = settingsLockPath(home)
    const parent = lockParentOf(lockPath)
    if (parent) { try { await io.mkdir(parent) } catch (eMk) {} }
    let held = false
    let lockUsable = true
    for (let i = 0; i < SETTINGS_LOCK_TRIES; i++) {
      try {
        await io.createExclusive(lockPath, String(Date.now()))
        held = true
        break
      } catch (eLock) {
        if (!isLockExistsError(eLock)) { lockUsable = false; break }
        try {
          const raw = await io.readText(lockPath)
          const at = Number(String(raw || '').trim())
          if (at > 0 && Date.now() - at > SETTINGS_LOCK_STALE_MS) { await io.rm(lockPath); continue }
        } catch (eRead) {}
        await waitMs(SETTINGS_LOCK_WAIT_MS)
      }
    }
    if (!held && !lockUsable) return task()
    if (!held) return { ok: false, error: { kind: 'environment', message: '另一个窗口正在保存本机设置，这一次先没有写，请过一秒再试。' } }
    try {
      return await task()
    } finally {
      try { await io.rm(lockPath) } catch (eRm) {}
    }
  }
  // #1802：按「只含改动格的补丁」写设置 —— 在串行队列与文件锁里重新读盘上最新一份，
  // 比内容指纹确认它就是调用方读到的那一份，只把点名的格合并进去，再整份归一落盘并发布新快照。
  // 这样另一个窗口刚写进去的格不会被这一窗拿旧文档覆盖；指纹对不上时明确回 conflict，让客户端重读后重试。
  async function writeSettingsPatch(home?: any, patch?: any, baseHash?: any) {
    return withSettingsFileLock(home, async function() {
      const io = buildIo()
      let raw: any = null
      try {
        raw = await readLocalSettings(home, io)
      } catch (e) {
        return { ok: false, error: { kind: 'environment', message: '读本机设置文件这一步出错了，所以这一次没有写。请重试一次。错误原文：' + String((e && (e as any).message) || e).slice(0, 120) } }
      }
      let latest: any = null
      if (raw && raw.ok === true) {
        if (raw.readonly === true) return readonlyUpgrade()
        latest = raw.value
      } else if (raw && raw.reason === 'missing') {
        latest = settingsEmptyDocument()
      } else {
        return { ok: false, error: { kind: mapSettingsKind(String((raw && raw.reason) || 'env')), message: String((raw && raw.message) || '读本机设置文件这一步出错了，所以这一次没有写。') } }
      }
      const latestHash = settingsContentHash(latest)
      const wantBase = String(baseHash === undefined || baseHash === null ? '' : baseHash)
      if (wantBase !== '' && wantBase !== latestHash) {
        return { ok: false, error: { kind: 'conflict', message: '这份设置刚被另一个窗口改过，这一次没有覆盖它；插件会重读最新内容后把两边的改动合到一起。' }, contentHash: latestHash }
      }
      const merged = mergeSettingsPatch(latest, patch)
      if (!merged || merged.ok !== true) {
        const out: any = { kind: mapSettingsKind(String((merged && merged.reason) || 'bad-shape')), message: String((merged && merged.message) || '这次要改的设置不合法，所以一个字都没有写。') }
        if (merged && Array.isArray(merged.keys)) out.keys = merged.keys
        return { ok: false, error: out, contentHash: latestHash }
      }
      if (!merged.changed) return { ok: true, from: 'yaml', value: merged.value, contentHash: latestHash, warnings: (raw && raw.warnings) || [] }
      let made: any = null
      try {
        made = await writeLocalSettings(merged.value, home, io)
      } catch (e) {
        return { ok: false, error: { kind: 'environment', message: '保存失败，写不进本机设置文件，请检查它的上一级目录在不在与当前账号能不能写入，然后重试。错误原文：' + String((e && (e as any).message) || e).slice(0, 120) } }
      }
      if (!(made && made.ok === true)) {
        const reason = String((made && made.reason) || 'env')
        if (reason === 'version-newer') return readonlyUpgrade()
        const out: any = { kind: mapSettingsKind(reason), message: String((made && made.message) || '保存失败，写不进本机设置文件。') }
        if (made && Array.isArray(made.keys)) out.keys = made.keys
        return { ok: false, error: out, contentHash: latestHash }
      }
      const nextHash = settingsContentHash(merged.value)
      publishSettingsSnapshot(merged.value)
      return { ok: true, from: made.from || 'yaml', value: merged.value, contentHash: nextHash, warnings: made.warnings || [] }
    })
  }

  return { writeSettingsPatch: writeSettingsPatch }
}

export default { createSettingsPatchWriter }
