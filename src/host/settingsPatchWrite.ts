/**
 * src/host/settingsPatchWrite.ts —— 按「只含改动格的补丁」写本机设置（#1802 新增）。
 *
 * 为什么要有它：两窗或两个插件实例共用同一份 settings.yaml 时，谁送整份文档谁就会把另一窗刚写进去的格
 *   悄悄顶掉。补丁写只把用户真正动过的那几格合并进「刚读到的最新一份」，别窗的格原样保留。
 *
 * 三条不能改的约定：
 * 1. 写入由调用方（settingsPhones 的 serialWrite）在同一个宿主进程里串行排队：两窗共用一个宿主进程，
 *    队列里一笔一笔读最新文件、合并、写回，不会交错。多个操作系统进程同时写同一份文件不在本票范围，
 *    那条路与改动前一样没有保护，由内容指纹在能看见的时候兜底报冲突。
 * 2. 合并之前先比内容指纹（调用方读到的那一版 vs 盘上最新一份）。对不上回 conflict，一个字都不写；
 *    客户端重读最新内容后再把两边的改动合到一起，这条冲突路径是「不静默覆盖」的唯一保证。
 * 3. 落盘仍是整份归一写入（适配器只有这一个写口），但写进去的内容是合并后的最新文档，不是调用方送来的旧文档。
 */

// #1802：补丁合并、内容指纹与空文档都定义在核里，与读侧共用同一套「设置文档长什么样」的约定。
import { mergeSettingsPatch, settingsContentHash, settingsEmptyDocument } from '../shared/config-store/src/settings.js'

// 造一个补丁写入口：依赖全部由调用方（settingsPhones）显式传入，本文件不自己取环境、不自己写日志。
export function createSettingsPatchWriter(deps?: any): any {
  const input = deps || {}
  const buildIo = input.buildIo
  const readLocalSettings = input.readLocalSettings
  const writeLocalSettings = input.writeLocalSettings
  const publishSettingsSnapshot = input.publishSettingsSnapshot
  const mapSettingsKind = input.mapSettingsKind
  const readonlyUpgrade = input.readonlyUpgrade
  // #1802：按「只含改动格的补丁」写设置 —— 调用方已经在宿主进程的串行队列里排好，
  // 这里重新读盘上最新一份，比内容指纹确认它就是调用方读到的那一份，只把点名的格合并进去，
  // 再整份归一落盘并发布新快照。这样另一个窗口刚写进去的格不会被这一窗拿旧文档覆盖；
  // 指纹对不上时明确回 conflict，让客户端重读后重试。
  async function writeSettingsPatch(home?: any, patch?: any, baseHash?: any) {
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
  }

  return { writeSettingsPatch: writeSettingsPatch }
}

export default { createSettingsPatchWriter }
