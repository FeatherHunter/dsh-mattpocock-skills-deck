// 分支与标签域电话的装配壳（#1746 T11）：把父文件已经造好的宿主闭包接给三个自包含叶子。
//
// 为什么要这一层：父文件 src/host/versionControl.ts 贴着文件粒度门禁的 350 有效行上限，
//   而「懒加载、加载失败兜底、loggedPhone 日志包装、三片共用一张票表」这些与业务判定无关，
//   放进父文件只会再挤占十几行额度。搬到这里之后父文件只留一行装配调用与三个回包键名。
//
// 三片分工（写了什么判定就在那一片，本层不新增任何业务判定）：
//   - versionControlBranch.ts      只读电话 wf.gitBranches：一次取回分支/标签/已并入/说明；
//   - versionControlBranchCheck.ts 预检 wf.gitBranchCheck：读现场、判定、签 120 秒票；
//   - versionControlBranchWrite.ts 执行 wf.gitBranchWrite：凭票执行、requestId 去重、零进程拒绝。
//
// 约定（改了会坏的地方）：
//   1) 三片只在第一次拨电话时才动态载入，宿主启动不加载这一族；载入失败回明确失败信封，
//      不能让电话永远挂起。
//   2) 预检与执行必须共用同一张票据表与同一张 requestId 结果表：执行叶子用的是预检叶子造出来的
//      tickets / results，不自己另造一份，否则「凭票执行」与「同 requestId 回同一份结果」都会失效。
//   3) 三条电话与 #1740 长任务、#1742 改动页同一日志口径：都用父文件递进来的 loggedPhone 包一层，
//      事件仍是 host.call / host.call.fail。
//   4) tickets 只给门禁与测试读票据表，不包 loggedPhone，也不注册成电话——客户端拿不到。

/** 把宿主依赖接成分支域的三条电话与一张票据表。host 里要有三个叶子各自需要的成员（见上）。 */
export function createBranchMount(host: any): any {
  // 第一次拨电话时才装配整族，装完缓存；装配失败只影响分支域，不拖垮宿主其它电话。
  let assembling: any = null
  function failedPhone(): any {
    const message: string = '分支与标签域那一族加载失败：' + String((host && host.loadError && host.loadError.message) || '未知原因')
    return function (): any { return host.failPhone('env', message) }
  }
  function branchPhones(): Promise<any> {
    if (!assembling) {
      assembling = import('./versionControlBranchCheck.js').then(function (checkMod: any): any {
        const check: any = checkMod.createBranchCheck(host)
        return import('./versionControlBranchWrite.js').then(function (writeMod: any): any {
          // 执行叶子共用预检叶子的票表与结果表，也共用同一个 measure（重算现场必须与签票时同一口径）。
          const write: any = writeMod.createBranchWrite({ failPhone: host.failPhone, runPinned: host.runPinned, resolveGitExecutable: host.resolveGitExecutable, measure: check.measure, now: host.now, tickets: check.tickets, results: check.results })
          return import('./versionControlBranch.js').then(function (readMod: any): any {
            const read: any = readMod.createBranchPhones(host)
            return { read: read.handleGitBranches, check: check.handleBranchCheck, write: write.handleBranchWrite, tickets: check.tickets }
          })
        })
      }).catch(function (e: any): any {
        const message: string = '分支与标签域那一族加载失败：' + String((e && e.message) || e)
        const failed: any = function (): any { return host.failPhone('env', message) }
        return { read: failed, check: failed, write: failed, tickets: async function (): Promise<any> { return null } }
      })
    }
    return assembling
  }
  /** 票据表读取：与 #1741 writeTickets、#1742 changesTickets 同口径，只给门禁与测试拿来做篡改测试。 */
  async function tickets(): Promise<any> {
    const p: any = await branchPhones()
    return p.tickets || null
  }
  return {
    read: host.loggedPhone('wf.gitBranches', 'git-branches', function (args: any): Promise<any> {
      return branchPhones().then(function (p: any): any { return p.read(args) })
    }),
    check: host.loggedPhone('wf.gitBranchCheck', 'git-branch-check', function (args: any): Promise<any> {
      return branchPhones().then(function (p: any): any { return p.check(args) })
    }),
    write: host.loggedPhone('wf.gitBranchWrite', 'git-branch-write', function (args: any): Promise<any> {
      return branchPhones().then(function (p: any): any { return p.write(args) })
    }),
    tickets: tickets,
  }
}

export const BRANCH_MOUNT_SOURCE = 'src/host/versionControlBranchMount.ts'
