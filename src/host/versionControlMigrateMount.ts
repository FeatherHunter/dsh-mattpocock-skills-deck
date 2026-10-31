/**
 * src/host/versionControlMigrateMount.ts —— 迁移与备份域的装配壳（#1759 T23）。
 *
 * 本文件只做三件事：把宿主闭包递给预检与执行两个叶子、给两条电话套上统一的日志口径
 * （host.call / host.call.fail），以及把「路径在不在、目录里有什么、文件多大、摘要多少」这组
 * 文件服务探测收拢成一个 probe 对象。预检与执行两个叶子都不直接碰 node:fs，
 * 门禁可以注入假 probe 把边界一个个试出来。
 */
// 本域 tsconfig 不加载 Node 类型：运行时一定是 Node，这里只按用到的成员声明形状，编译后整体剥离。
// @ts-expect-error 宿主域没有 @types/node，node: 内建模块的类型由这行豁免；运行时真实存在。
import { stat, readdir, mkdir, readFile } from 'node:fs/promises'
// @ts-expect-error 同上：createHash 来自 node:crypto，只在运行时存在。
import { createHash } from 'node:crypto'
import { createMigrateCheck } from './versionControlMigrateCheck.js'
import { createMigrateWrite } from './versionControlMigrateWrite.js'

export const MIGRATE_MOUNT_SOURCE = 'src/host/versionControlMigrateMount.ts'

// 只把用到的四件能力做成 probe：stat / list / digest / makeDir。任一探测拿不到结论都回 null，
// 由调用方转成明确的失败信封，而不是猜「大概不存在」。
function makeProbe(): any {
  return {
    async stat(path: any): Promise<any> {
      try {
        const st: any = await stat(path)
        return { exists: true, isDirectory: st.isDirectory() === true, isFile: st.isFile() === true, sizeBytes: Number(st.size) }
      } catch (e) {
        const code: string = String(((e as any) && (e as any).code) || '')
        if (code === 'ENOENT') return { exists: false, isDirectory: false, isFile: false, sizeBytes: 0 }
        return null
      }
    },
    async list(path: any): Promise<any> {
      try { const rows: any = await readdir(path); return rows.map(function (x: any): string { return String(x) }) } catch (e) { return null }
    },
    async digest(path: any): Promise<any> {
      try {
        const bytes: any = await readFile(path)
        const hash: any = createHash('sha256')
        hash.update(bytes)
        return { sizeBytes: Number(bytes.length), sha256: String(hash.digest('hex')) }
      } catch (e) { return null }
    },
    async makeDir(path: any): Promise<any> {
      try { await mkdir(path); return { ok: true } } catch (e) { return { ok: false, message: String(((e as any) && ((e as any).code || (e as any).message)) || (e as any)) } }
    }
  }
}

export function createMigrateMount(host: any): any {
  const probe: any = makeProbe()
  const nowFn: any = (typeof host.now === 'function') ? host.now : Date.now
  let _p: any = null
  function phones(): any {
    if (!_p) {
      _p = Promise.all([import('./versionControlMigrateCheck.js'), import('./versionControlMigrateWrite.js')]).then(function (ms: any): any {
        const check: any = ms[0].createMigrateCheck({
          failPhone: host.failPhone,
          failureFromExec: host.failureFromExec,
          resolveGitExecutable: host.resolveGitExecutable,
          resolveRepoRoot: host.resolveRepoRoot,
          readScreenOf: host.readScreenOf,
          runPinned: host.runPinned,
          now: nowFn,
          probe: probe,
          defaultCwd: String(host.DEFAULT_CWD || '')
        })
        const write: any = ms[1].createMigrateWrite({
          failPhone: host.failPhone,
          now: nowFn,
          measure: check.measure,
          tickets: check.tickets,
          results: check.results,
          startTask: host.startTask,
          probe: probe,
          resolveGitExecutable: host.resolveGitExecutable,
          runPinned: host.runPinned
        })
        return {
          check: host.loggedPhone('wf.gitMigrateCheck', 'git-migrate-check', check.handleGitMigrateCheck),
          write: host.loggedPhone('wf.gitMigrateWrite', 'git-migrate-write', write.handleGitMigrateWrite),
          tickets: check.tickets,
          results: check.results
        }
      })
      _p.catch(function (): void { _p = null })
    }
    return _p
  }
  function failed(kind: string, message: string): any { return host.failPhone(kind, message) }
  const fallback: any = function (): any { return failed('env', '迁移与备份域的装配失败：这次没有起任何 git 进程，重试一次或看诊断页') }
  return {
    handleGitMigrateCheck: async function (a: any): Promise<any> { try { const p: any = await phones(); return p.check(a) } catch (e) { return failed('env', '迁移与备份域加载失败：' + String(((e as any) && (e as any).message) || (e as any))) } },
    handleGitMigrateWrite: async function (a: any): Promise<any> { try { const p: any = await phones(); return p.write(a) } catch (e) { return failed('env', '迁移与备份域加载失败：' + String(((e as any) && (e as any).message) || (e as any))) } },
    tickets: async function (): Promise<any> { try { const p: any = await phones(); return p.tickets } catch (e) { return null } },
    fallback: fallback
  }
}
