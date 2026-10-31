/**
 * src/host/versionControlUndoMount.ts —— 历史改写五条动作两条电话的装配壳（#1748 T13，规格 #1586 域 5）
 *
 * 为什么单独成一层：父文件 src/host/versionControl.ts 贴着文件粒度门禁的 350 有效行上限，
 * 而「懒加载、加载失败兜底、loggedPhone 日志包装、把预检层的票表交给执行层」这四件事与
 * 历史改写业务判定无关，放进父文件只会再挤占十几行额度。照 #500/#821/#1739 的同一条先例搬出来。
 *
 * 约定（改了会坏的地方）：
 *   1) 两个叶子都只在第一次拨电话时才动态载入，宿主启动不加载历史改写那一族；
 *      载入失败必须回「明确失败」的失败信封，而不是让电话永远挂起。
 *   2) 预检与执行共用同一张票表与同一张 requestId 结果表：两片叶子互不引用，
 *      由本壳把预检层造好后显式把 measure / tickets / results 交给执行层。
 *   3) 本层不新增任何业务判定：命令拼装、票据校验、拒绝理由都在两片叶子里，这里只做接线。
 */

/** 把宿主依赖接成历史改写两条电话（预检、凭票执行），日志包装在这一层完成。 */
export function createUndoMount(host: any): any {
  // 第一次拨电话时才装配预检层，装完缓存；装配失败只影响变基待办页，不拖垮宿主其它电话。
  let checkP: any = null
  function checkPhone(): Promise<any> {
    if (!checkP) {
      checkP = import('./versionControlUndoCheck.js').then(function (m: any): any {
        return m.createUndoCheck({
          readScreenOf: host.readScreenOf,
          resolveGitExecutable: host.resolveGitExecutable,
          resolveRepoRoot: host.resolveRepoRoot,
          runPinned: host.runPinned,
          nowMs: host.now,
          readTimeoutMs: host.undoReadTimeoutMs,
          defaultCwd: host.DEFAULT_CWD,
        })
      }).catch(function (e: any): any {
        const message: string = '历史改写预检层加载失败：' + String((e && e.message) || e)
        return { handleCheck: function (): any { return host.failPhone('env', message) }, measure: function (): any { return host.failPhone('env', message) }, tickets: new Map(), results: new Map() }
      })
    }
    return checkP
  }

  // 执行层在预检层就绪之后装配：两片叶子共享同一张票表与结果表（票只留在宿主进程内存里）。
  let writeP: any = null
  function writePhone(): Promise<any> {
    if (!writeP) {
      writeP = checkPhone().then(function (check: any): any {
        return import('./versionControlUndoWrite.js').then(function (m: any): any {
          return m.createUndoWrite({
            runPinned: host.runPinned,
            failPhone: host.failPhone,
            measure: check.measure,
            tickets: check.tickets,
            results: check.results,
            nowMs: host.now,
            writeTimeoutMs: host.undoWriteTimeoutMs,
            defaultCwd: host.DEFAULT_CWD,
          })
        })
      }).catch(function (e: any): any {
        const message: string = '历史改写执行层加载失败：' + String((e && e.message) || e)
        return { handleWrite: function (): any { return host.failPhone('env', message) } }
      })
    }
    return writeP
  }

  return {
    handleGitUndoCheck: host.loggedPhone('wf.gitUndoCheck', 'git-undo-check', function (args: any): Promise<any> {
      return checkPhone().then(function (c: any): any { return c.handleCheck(args) })
    }),
    handleGitUndoWrite: host.loggedPhone('wf.gitUndoWrite', 'git-undo-write', function (args: any): Promise<any> {
      return writePhone().then(function (w: any): any { return w.handleWrite(args) })
    }),
    // 只给门禁与测试读票表（与 #1741 writeTickets、#1746 branchTickets 同一条口径：不注册成电话，客户端拿不到）。
    undoTickets: function (): Promise<any> { return checkPhone().then(function (c: any): any { return c.tickets || null }) },
  }
}
