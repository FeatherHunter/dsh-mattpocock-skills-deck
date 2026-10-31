// 配置与钩子域电话的装配壳（#1760 T24）：把父文件已经造好的宿主闭包接给三个自包含叶子。
//
// 为什么要这一层：父文件 src/host/versionControl.ts 贴着文件粒度门禁的 350 有效行上限，
//   而「懒加载、加载失败兜底、loggedPhone 日志包装、两片共用一张票表」这些与业务判定无关，
//   放进父文件只会再挤占十几行额度。搬到这里之后父文件只留一条展开调用。
//
// 三片分工（写了什么判定就在那一片，本层不新增任何业务判定）：
//   - versionControlConfig.ts      读取电话 wf.gitConfigRead 与预检 wf.gitConfigCheck：
//                                  读配置清单、版本、钩子目录，判定边界与版本门，签 120 秒票；
//   - versionControlConfigWrite.ts 执行电话 wf.gitConfigWrite：凭票执行、requestId 去重、零进程拒绝。
//
// 约定（改了会坏的地方）：
//   1) 两片只在第一次拨电话时才动态载入，宿主启动不加载这一族；载入失败回明确失败信封，
//      不能让电话永远挂起。
//   2) 预检与执行必须共用同一张票据表与同一张 requestId 结果表：执行叶子用的是预检叶子造出来的
//      tickets / results，也不自己另造一份，否则「凭票执行」与「同 requestId 回同一份结果」都会失效。
//   3) 三条电话与 #1740 长任务、#1742 改动页、#1746 分支域同一日志口径：都用父文件递进来的
//      loggedPhone 包一层，事件仍是 host.call / host.call.fail。
//   4) tickets 只给门禁与测试读票据表，不包 loggedPhone，也不注册成电话——客户端拿不到。

/** 把宿主依赖接成配置与钩子域的三条电话与一张票据表。host 里要有两个叶子各自需要的成员（见上）。 */
export function createConfigMount(host: any): any {
  // 第一次拨电话时才装配整族，装完缓存；装配失败只影响配置域，不拖垮宿主其它电话。
  let assembling: any = null
  function failedPhone(): any {
    const message: string = '配置与钩子域那一族加载失败：' + String((host && host.loadError && host.loadError.message) || '未知原因')
    return function (): any { return host.failPhone('env', message) }
  }
  function configPhones(): Promise<any> {
    if (!assembling) {
      assembling = import('./versionControlConfig.js').then(function (mod: any): any {
        const check: any = mod.createConfigPhones(host)
        return import('./versionControlConfigWrite.js').then(function (writeMod: any): any {
          // 执行叶子共用预检叶子的票表与结果表，也共用同一个 measure（重算现场必须与签票时同一口径）。
          const write: any = writeMod.createConfigWrite({ runPinned: host.runPinned, resolveGitExecutable: host.resolveGitExecutable, measure: check.measure, now: host.now, tickets: check.tickets, results: check.results })
          return { read: check.handleGitConfigRead, check: check.handleConfigCheck, write: write.handleConfigWrite, tickets: check.tickets }
        })
      }).catch(function (e: any): any {
        const message: string = '配置与钩子域那一族加载失败：' + String((e && e.message) || e)
        const failed: any = function (): any { return host.failPhone('env', message) }
        return { read: failed, check: failed, write: failed, tickets: async function (): Promise<any> { return null } }
      })
    }
    return assembling
  }
  /** 票据表读取：与 #1741 writeTickets、#1742 changesTickets 同口径，只给门禁与测试拿来做篡改测试。 */
  async function tickets(): Promise<any> {
    const p: any = await configPhones()
    return p.tickets || null
  }
  void failedPhone
  return {
    read: host.loggedPhone('wf.gitConfigRead', 'git-config-read', function (args: any): Promise<any> {
      return configPhones().then(function (p: any): any { return p.read(args) })
    }),
    check: host.loggedPhone('wf.gitConfigCheck', 'git-config-check', function (args: any): Promise<any> {
      return configPhones().then(function (p: any): any { return p.check(args) })
    }),
    write: host.loggedPhone('wf.gitConfigWrite', 'git-config-write', function (args: any): Promise<any> {
      return configPhones().then(function (p: any): any { return p.write(args) })
    }),
    tickets: tickets,
  }
}

export const CONFIG_MOUNT_SOURCE = 'src/host/versionControlConfigMount.ts'
