// 改动页电话的装配壳（#1742）：把父文件里已经造好的宿主闭包接给 ./versionControlChanges.ts。
//
// 为什么单独成一层：父文件 src/host/versionControl.ts 已经贴着文件粒度门禁的 350 有效行上限，
// 而「懒加载、加载失败兜底、loggedPhone 日志包装」这三件事与业务判定无关，放进父文件只会
// 再挤占十几行额度。搬到这里之后父文件只留一行装配调用与三个回包键名，行为一个字节都不变。
//
// 约定（改了会坏的地方）：
//   1) createChangesPhone 只在第一次拨电话时才动态载入，宿主启动不加载改动页那一族；
//      载入失败必须回一个「明确失败」的失败信封，而不是让电话永远挂起。
//   2) check / write 两条电话与 #1740 长任务、#1741 写操作同一个日志口径：都用父文件递进来的
//      loggedPhone 包一层，事件仍是 host.call / host.call.fail。
//   3) tickets 只给门禁与测试读票据表，不包 loggedPhone，也不注册成电话——客户端拿不到。
//   4) 本层不新增任何业务判定：命令拼装、票据校验、拒绝理由全在 ./versionControlChangesCheck.ts
//      与 ./versionControlChangesWrite.ts 里，这里只做接线。

/** 把宿主依赖（fs、runGit、固定前缀、日志包装等）接成改动页的两条电话与一张票据表。 */
export function createChangesMount(host: any): any {
  // 第一次拨电话时才装配执行层，装完缓存；装配失败只影响改动页，不拖垮宿主其它电话。
  let assembling: any = null
  function changesPhone(): Promise<any> {
    if (!assembling) {
      assembling = import('./versionControlChanges.js').then(function (m: any): any {
        return m.createChangesPhone(host)
      }).catch(function (e: any): any {
        const message: string = '改动页那一族加载失败：' + String((e && e.message) || e)
        const failed: any = function (): any { return host.failPhone('env', message) }
        return { check: failed, write: failed, tickets: new Map() }
      })
    }
    return assembling
  }

  /**
   * 票据表读取：与 #1741 的 writeTickets 同口径，只给门禁与测试把票据表拿出来做篡改测试。
   * 返回 null 表示改动页那一族还没装配过——宿主正常运行时这条从来不会被调用。
   */
  async function tickets(): Promise<any> {
    const c: any = await changesPhone()
    return c.tickets || null
  }

  return {
    check: host.loggedPhone('wf.gitChangesCheck', 'git-changes-check', function (args: any): Promise<any> {
      return changesPhone().then(function (c: any): any { return c.check(args) })
    }),
    write: host.loggedPhone('wf.gitChangesWrite', 'git-changes-write', function (args: any): Promise<any> {
      return changesPhone().then(function (c: any): any { return c.write(args) })
    }),
    tickets: tickets,
  }
}
