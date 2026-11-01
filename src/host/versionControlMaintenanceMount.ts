/**
 * src/host/versionControlMaintenanceMount.ts —— 维护页三件叶子的懒装配（#1758 T22）
 *
 * 为什么单独一叶：父文件 versionControl.ts 的有效行已经顶到 350 上限，新一族电话只能在同层外壳里装配。
 * 本文件只做三件事：懒加载读数/预检/执行三片、把父层依赖原样转交、失败时回明确的环境类失败。
 *
 * 约定（改这里之前先读）：
 *   1. 只在第一次打电话时 import，失败重试会重新试一次，不会把失败缓存成永久失败。
 *   2. tickets 只给门禁与测试读取票据表，不注册成电话，界面拿不到。
 *   3. 本文件不做任何业务判定，判定在共享协议与三片叶子里。
 */
import { failPhone } from '../shared/version-control/exec-envelope.js'
import { createBackupRunner } from './versionControlBackup.js'

/** 造装配外壳；host 是父文件的一组内部依赖。 */
export function createMaintenanceMount(host: any): any {
  let assembling: any = null

  /** 懒加载三片：读数先建，预检拿它量现场，执行拿预检的票表与结果表。 */
  function pieces(): any {
    if (!assembling) {
      assembling = Promise.all([
        import('./versionControlMaintenanceRead.js'),
        import('./versionControlMaintenanceCheck.js'),
        import('./versionControlMaintenanceWrite.js'),
      ]).then(function (mods: any[]) {
        const read: any = mods[0].createMaintenanceRead(host)
        const check: any = mods[1].createMaintenanceCheck({ read: read, failPhone: host.failPhone, now: host.now, randomId: host.randomId })
        const backup: any = createBackupRunner({ runPinned: host.runPinned, now: host.now, failurePrefix: '整仓备份失败，已中止清理（这次没有起 prune）：' })
        const write: any = mods[2].createMaintenanceWrite({ read: read, failPhone: host.failPhone, runPinned: host.runPinned, taskStart: host.taskStart, backup: backup, now: host.now, tickets: check.tickets, results: check.results })
        return { read: read, check: check, write: write }
      }).catch(function (err: any) {
        const said: string = String((err && (err.stack || err.message)) || err)
        const failure: any = failPhone('env', '维护页这一层装配失败：' + said)
        const failFn: any = function () { return failure }
        return { read: { readOf: failFn }, check: { handleMaintenanceRead: failFn, handleMaintenanceCheck: failFn, tickets: new Map() }, write: { handleMaintenanceWrite: failFn } }
      })
    }
    return assembling
  }

  /** 票据表读取：只给门禁与测试用，不注册成电话。 */
  function ticketTable(): any {
    return pieces().then(function (parts: any) { return parts.check.tickets || null })
  }

  return {
    read: host.loggedPhone('wf.gitMaintenanceRead', 'git-maintenance-read', function (args: any) { return pieces().then(function (parts: any) { return parts.check.handleMaintenanceRead(args) }) }),
    check: host.loggedPhone('wf.gitMaintenanceCheck', 'git-maintenance-check', function (args: any) { return pieces().then(function (parts: any) { return parts.check.handleMaintenanceCheck(args) }) }),
    write: host.loggedPhone('wf.gitMaintenanceWrite', 'git-maintenance-write', function (args: any) { return pieces().then(function (parts: any) { return parts.write.handleMaintenanceWrite(args) }) }),
    tickets: ticketTable,
  }
}
