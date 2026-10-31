// 同步动作两条电话的装配壳（#1755 T19）：预检与执行共用一个装配对象（票表与 requestId 结果表必须同一份）。
//
// 与 versionControlBranchMount.ts 同一路数：懒加载两个叶子、加载失败回统一的失败信封、每条电话包一层
// loggedPhone 进出日志；父文件（versionControl.ts）贴着 350 有效行上限，所以装配壳与装配闭包都住这片叶子。
// 唯一的写入口是长任务通道：执行电话只调 host.startTask，不自己 spawn 任何进程。

export const SYNC_MOUNT_SOURCE = 'src/host/versionControlSyncMount.ts'

export function createSyncMount(host: any): any {
  const failPhone: any = host.failPhone
  const loggedPhone: any = host.loggedPhone
  let assembling: any = null
  function syncPhones(): Promise<any> {
    if (!assembling) {
      assembling = (async function (): Promise<any> {
        const checkMod: any = await import('./versionControlSyncCheck.js')
        const check: any = checkMod.createSyncCheck({
          failPhone: failPhone,
          failureFromExec: host.failureFromExec,
          resolveGitExecutable: host.resolveGitExecutable,
          resolveRepoRoot: host.resolveRepoRoot,
          readScreenOf: host.readScreenOf,
          runPinned: host.runPinned,
          now: host.now
        })
        const writeMod: any = await import('./versionControlSyncWrite.js')
        const write: any = writeMod.createSyncWrite({
          failPhone: failPhone,
          now: host.now,
          measure: check.measure,
          tickets: check.tickets,
          results: check.results,
          startTask: host.startTask
        })
        return { check: check, write: write }
      })()
      assembling.catch(function (): void { assembling = null })
    }
    return assembling
  }
  function failed(): Promise<any> {
    return Promise.resolve(failPhone('env', '同步模块加载失败：这次没有起任何 git 进程，重试一次或看诊断页'))
  }
  return {
    // 两条电话名与客户端 vcSyncData.ts、门禁、宿主入口注册必须逐字一致（wf.gitSyncCheck / wf.gitSyncWrite）。
    handleGitSyncCheck: loggedPhone('wf.gitSyncCheck', 'git-sync-check', function (args: any): Promise<any> {
      return syncPhones().then(function (p: any) { return p.check.handleGitSyncCheck(args) }, function () { return failed() })
    }),
    handleGitSyncWrite: loggedPhone('wf.gitSyncWrite', 'git-sync-write', function (args: any): Promise<any> {
      return syncPhones().then(function (p: any) { return p.write.handleGitSyncWrite(args) }, function () { return failed() })
    })
  }
}
