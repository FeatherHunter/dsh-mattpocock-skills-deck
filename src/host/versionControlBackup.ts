/**
 * src/host/versionControlBackup.ts —— 整仓备份的执行装置：镜像克隆或整仓打包（#1758 T22 从 T15 抽出）
 *
 * 为什么单独一叶：全库重写（#1750）与清除不可达对象（#1758）都要求「先做实备份、备份成功才继续」，
 * 两处必须用同一份备份实现，否则一个说成功了另一个说没成功，人就不知道该信哪边。
 * 这段逻辑原本长在 versionControlRewriteWrite.ts 里，抽出来只搬不改口径。
 *
 * 约定（改这里之前先读）：
 *   1. 本文件不自己起进程，全部走注入的 runPinned。
 *   2. 备份成功必须带回 {kind,path,bytes,elapsedMs} 四格；字节数读不出时回 backup-unreadable，
 *      但调用方要先按「备份成功才继续」的上游规则决定是否中止。
 *   3. 失败原因分两类：命令失败归 backup-failed（带 git 原话一句），读完信息不足归 backup-unreadable。
 */
import { firstLine } from '../shared/version-control/exec-envelope.js'
import { backupPointOf } from '../shared/version-control/src/recovery-point.js'
// 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node，这些内建模块必然存在。
// @ts-expect-error
import { stat, readdir } from 'node:fs/promises'

/** 起一条备份命令的输出上限：备份命令的输出只需要读到最后一行结论。 */
const WRITE_LIMIT: number = 1024 * 1024

/** 造备份执行层；failurePrefix 由调用方给出，好让失败话术衔接各自的后续动作。 */
export function createBackupRunner(deps: any): any {
  const writeTimeoutMs: number = Number(deps.writeTimeoutMs) || 600000
  const failurePrefix: string = String(deps.failurePrefix || '整仓备份失败，已中止（这次没有起后续命令）：')
  const now = function (): number { try { return typeof deps.now === 'function' ? Number(deps.now()) : Date.now() } catch (e) { return Date.now() } }

  /** 递归数一个目录的字节数：镜像备份的对象大小按 KiB 取整会得到 0，所以用实际文件大小兜底。 */
  async function dirBytesOf(dir: string): Promise<number> {
    let total: number = 0
    let names: any[] = []
    try { names = await readdir(dir, { recursive: true, withFileTypes: true }) } catch (e) { return 0 }
    for (let i = 0; i < names.length; i += 1) {
      const item: any = names[i]
      const isFile: boolean = (typeof item.isFile === 'function') ? item.isFile() : item.isFile === true
      if (!item || isFile !== true) continue
      try { const st: any = await stat(String(item.parentPath || item.path || dir) + '/' + String(item.name)); total += Number(st.size) || 0 } catch (e) { /* 数不到的文件跳过，结论里还有 count-objects 兜底 */ }
    }
    return total
  }

  /** 备份镜像目录的实际字节数：与仓库大小口径一致（松散对象 + 打包对象，KiB 相加）。 */
  async function mirrorBytesOf(exe: string, path: string): Promise<any> {
    let res: any
    try { res = await deps.runPinned(exe, path, ['count-objects', '-v'], { timeoutMs: writeTimeoutMs, stdoutLimit: 256 * 1024 }) } catch (e) { return { ok: false } }
    if (!res || res.kind !== 'ok') return { ok: false }
    let loose: number = 0
    let packed: number = 0
    const lines: string[] = String(res.stdout || '').replace(/\r/g, '').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const m: any = /^size(?:-pack)?:\s*(\d+)/.exec(lines[i])
      if (!m) continue
      if (lines[i].indexOf('size-pack:') === 0) packed = Number(m[1]); else loose = Number(m[1])
    }
    return { ok: true, bytes: (loose + packed) * 1024 }
  }

  /**
   * 做整仓备份：镜像克隆（默认）或整仓打包（磁盘不够时）。
   * 成功回 {ok:true,point}；失败回 {ok:false,reason,message}，调用方据此中止，绝不在备份失败后继续。
   */
  async function runBackup(exe: string, root: string, backupPlan: any): Promise<any> {
    const kind: string = backupPlan && backupPlan.kind === 'bundle' ? 'bundle' : 'mirror'
    const path: string = String((backupPlan && backupPlan.path) || '')
    if (path === '') return { ok: false, reason: 'backup-failed', message: '备份路径是空的，不知道该往哪里备份，已中止。' }
    const parent: string = path.replace(/[\\/][^\\/]+$/, '')
    const started: number = Date.now()
    let res: any
    try {
      res = (kind === 'bundle')
        ? await deps.runPinned(exe, root, ['bundle', 'create', path, '--all'], { timeoutMs: writeTimeoutMs, stdoutLimit: WRITE_LIMIT })
        : await deps.runPinned(exe, parent, ['clone', '--mirror', root, path], { timeoutMs: writeTimeoutMs, stdoutLimit: WRITE_LIMIT })
    } catch (e) {
      return { ok: false, reason: 'backup-failed', message: failurePrefix + '备份命令没有起进程：' + firstLine(String((e && (e as any).message) || e)) }
    }
    if (!res || res.kind !== 'ok') {
      const said: string = firstLine((res && (res.stderr || res.message)) || '') || '备份命令没有正常结束'
      return { ok: false, reason: 'backup-failed', message: failurePrefix + said }
    }
    const elapsedMs: number = Math.max(0, Date.now() - started)
    let bytes: number = 0
    if (kind === 'bundle') {
      try { const st: any = await stat(path); bytes = Number(st.size) || 0 } catch (e) { bytes = 0 }
    } else {
      const mb: any = await mirrorBytesOf(exe, path)
      // count-objects 的 size 是 KiB 取整，小仓库会给出 0；这时用实际文件大小兜底，别把备份说成 0 字节。
      const walked: number = await dirBytesOf(path)
      bytes = Math.max(mb.ok ? Number(mb.bytes) || 0 : 0, walked)
    }
    const point: any = backupPointOf({ kind: kind, path: path, bytes: bytes, elapsedMs: elapsedMs, atMs: now() })
    if (point.ok !== true) return { ok: false, reason: 'backup-unreadable', message: '备份做完了但读不出它的大小，按约定不能拿半份信息继续：' + String(point.message || '') }
    return { ok: true, point: point.point }
  }

  return { runBackup: runBackup }
}
