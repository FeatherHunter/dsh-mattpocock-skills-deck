// 子模块域电话的装配壳（#1757 T21）：把父文件已经造好的宿主闭包接给四个自包含叶子。
//
// 为什么要这一层：父文件 src/host/versionControl.ts 贴着文件粒度门禁的 350 有效行上限，
//   「懒加载、加载失败兜底、loggedPhone 日志包装、票表与结果表共用」这些与业务判定无关的逻辑
//   放进父文件只会再挤占十几行额度。搬到这里之后父文件只留一行装配调用与四个回包键名。
//
// 四片分工（写了什么判定就在那一片，本层不新增任何业务判定）：
//   - versionControlSubmodules.ts      读数电话 wf.gitSubmodules：一次取回子模块状态、地址、跟踪分支与能否吸收；
//   - versionControlSubmodulesCheck.ts 预检电话 wf.gitSubmoduleCheck：读现场、判定、签 120 秒票（写动作与任务动作共用）；
//   - versionControlSubmodulesWrite.ts 执行电话 wf.gitSubmoduleWrite：凭票改配置/取消登记/吸收 .git，零进程拒绝；
//   - versionControlSubmodulesTask.ts  任务电话 wf.gitSubmoduleTask：凭票转给长任务通道（新增/初始化/更新/抓取）。
//
// 约定（改了会坏的地方）：
//   1) 四片只在第一次拨电话时才动态载入，宿主启动不加载这一族；载入失败回明确失败信封，不能让电话永远挂起。
//   2) 预检与执行/任务必须共用同一张票据表与同一张 requestId 结果表（执行与任务是预检叶子造出来的
//      tickets / results），否则「凭票执行」与「同 requestId 回同一份结果」都会失效。
//   3) 四条电话与 #1740 长任务、#1742 改动页同一日志口径：都用父文件递进来的 loggedPhone 包一层，
//      事件仍是 host.call / host.call.fail。
//   4) tickets 只给门禁与测试读票据表，不包 loggedPhone，也不注册成电话——客户端拿不到。
//
// 第四个参数 taskStart 是父文件传进来的宿主长任务 start（wf.gitTaskStart 的同款实现）；本层不自己起进程。

/** 把宿主依赖接成子模块域的四条电话与一张票据表。host 里要有四个叶子各自需要的成员（见上）。 */
export function createSubmoduleMount(host: any): any {
  // 第一次拨电话时才装配整族，装完缓存；装配失败只影响子模块域，不拖垮宿主其它电话。
  let assembling: any = null
  function submodulePhones(): Promise<any> {
    if (!assembling) {
      assembling = import('./versionControlSubmodulesCheck.js').then(function (checkMod: any): any {
        const check: any = checkMod.createSubmoduleCheck(host)
        return import('./versionControlSubmodulesWrite.js').then(function (writeMod: any): any {
          // 执行叶子共用预检叶子的票表、结果表，也共用同一个 measure（重算现场必须与签票时同一口径）。
          const write: any = writeMod.createSubmoduleWrite({ failPhone: host.failPhone, runPinned: host.runPinned, resolveGitExecutable: host.resolveGitExecutable, measure: check.measure, now: host.now, tickets: check.tickets, results: check.results })
          return import('./versionControlSubmodulesTask.js').then(function (taskMod: any): any {
            const task: any = taskMod.createSubmoduleTask({ failPhone: host.failPhone, measure: check.measure, now: host.now, tickets: check.tickets, results: check.results, taskStart: host.taskStart })
            return import('./versionControlSubmodules.js').then(function (readMod: any): any {
              const read: any = readMod.createSubmodulePhones(host)
              return { read: read.handleGitSubmodules, check: check.handleGitSubmoduleCheck, write: write.handleGitSubmoduleWrite, task: task.handleGitSubmoduleTask, tickets: check.tickets }
            })
          })
        })
      }).catch(function (e: any): any {
        const message: string = '子模块域那一族加载失败：' + String((e && e.message) || e)
        const failed: any = function (): any { return host.failPhone('env', message) }
        return { read: failed, check: failed, write: failed, task: failed, tickets: async function (): Promise<any> { return null } }
      })
    }
    return assembling
  }
  /** 票据表读取：与 #1741 writeTickets、#1742 changesTickets 同口径，只给门禁与测试拿来做篡改测试。 */
  async function submoduleTickets(): Promise<any> {
    const p: any = await submodulePhones()
    return p.tickets || null
  }
  return {
    handleGitSubmodules: host.loggedPhone('wf.gitSubmodules', 'git-submodules', function (args: any): Promise<any> {
      return submodulePhones().then(function (p: any): any { return p.read(args) })
    }),
    handleGitSubmoduleCheck: host.loggedPhone('wf.gitSubmoduleCheck', 'git-submodule-check', function (args: any): Promise<any> {
      return submodulePhones().then(function (p: any): any { return p.check(args) })
    }),
    handleGitSubmoduleWrite: host.loggedPhone('wf.gitSubmoduleWrite', 'git-submodule-write', function (args: any): Promise<any> {
      return submodulePhones().then(function (p: any): any { return p.write(args) })
    }),
    handleGitSubmoduleTask: host.loggedPhone('wf.gitSubmoduleTask', 'git-submodule-task', function (args: any): Promise<any> {
      return submodulePhones().then(function (p: any): any { return p.task(args) })
    }),
    submoduleTickets: submoduleTickets,
  }
}

export const SUBMODULE_MOUNT_SOURCE = 'src/host/versionControlSubmodulesMount.ts'
