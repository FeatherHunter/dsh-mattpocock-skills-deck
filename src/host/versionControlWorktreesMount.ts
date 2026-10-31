/**
 * src/host/versionControlWorktreesMount.ts —— 工作树页两条电话的装配壳（#1752 T17）。
 *
 * 为什么单独成一层：父文件 src/host/versionControl.ts 已经贴着文件粒度门禁的 350 有效行上限，
 * 而「懒加载、加载失败兜底、loggedPhone 日志包装」这三件事与工作树业务判定无关，放进父文件
 * 只会再挤占二十来行额度。搬到这里之后父文件只留一个装配调用，行为一个字节都不变。
 *
 * 约定（改了会坏的地方）：
 *   1) createWorktreePhones 只在第一次拨电话时才动态载入，宿主启动不加载工作树那一族；
 *      载入失败必须回一个「明确失败」的失败信封，而不是让电话永远挂起。
 *   2) 预检与执行两条电话与 #1740 长任务、#1741 写操作、#1742 改动页同一个日志口径：都用父文件
 *      递进来的 loggedPhone 包一层，事件仍是 host.call / host.call.fail。
 *   3) 本层不新增任何业务判定：命令拼装、票据校验、拒绝理由全在 ./versionControlWorktrees.ts 里，
 *      这里只做接线；进程出口、失败信封、入参工作目录、路径探测、时间与随机数全部由父文件注入。
 */

/** 把宿主依赖接成工作树页的两条电话（预检与执行），日志包装在这一层完成。 */
export function createWorktreesMount(host: any): any {
  // 第一次拨电话时才装配执行层，装完缓存；装配失败只影响工作树页，不拖垮宿主其它电话。
  let assembling: any = null
  function worktreePhone(): Promise<any> {
    if (!assembling) {
      assembling = import('./versionControlWorktrees.js').then(function (m: any): any {
        return m.createWorktreePhones({
          resolveGitExecutable: host.resolveGitExecutable,
          resolveRepoRoot: host.resolveRepoRoot,
          runPinned: host.runPinned,
          failPhone: host.failPhone,
          firstLine: host.firstLine,
          failureFromExec: host.failureFromExec,
          cwdOf: host.cwdOf,
          pathExists: host.pathExists,
          nowMs: host.now,
          randomId: host.randomId,
        })
      }).catch(function (e: any): any {
        const message: string = '工作树页那一族加载失败：' + String((e && e.message) || e)
        const failed: any = function (): any { return host.failPhone('env', message) }
        return { handleGitWorktreeCheck: failed, handleGitWorktreeRun: failed }
      })
    }
    return assembling
  }

  return {
    handleGitWorktreeCheck: host.loggedPhone('wf.gitWorktreeCheck', 'git-worktree-check', function (args: any): Promise<any> {
      return worktreePhone().then(function (c: any): any { return c.handleGitWorktreeCheck(args) })
    }),
    handleGitWorktreeRun: host.loggedPhone('wf.gitWorktreeRun', 'git-worktree-run', function (args: any): Promise<any> {
      return worktreePhone().then(function (c: any): any { return c.handleGitWorktreeRun(args) })
    }),
  }
}
