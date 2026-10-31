/**
 * src/host/versionControlDiagnosticsMount.ts —— 诊断页三条电话的装配壳（#1761 T25）
 *
 * 为什么单独一份：父文件 versionControl.ts 贴着有效行上限，懒加载、失败兜底、日志包装三件事
 * 都收进这一片。本壳不含任何业务判定：预检与执行共用一张票据表与一张 requestId 结果表，
 * 三个电话走同一个 loggedPhone 口径（host.call / host.call.fail），失败统一回宿主信封。
 */
export function createDiagnosticsMount(host: any): any {
  const h: any = host || {}
  let assembling: any = null

  function phones(): any {
    if (!assembling) {
      assembling = Promise.all([import('./versionControlDiagnosticsRead.js'), import('./versionControlDiagnosticsCheck.js'), import('./versionControlDiagnosticsWrite.js')]).then(function (ms: any) {
        const read: any = ms[0].createDiagnosticsReadPhone({ failPhone: h.failPhone, firstLine: h.firstLine, failureFromExec: h.failureFromExec, runPinned: h.runPinned, resolveGitExecutable: h.resolveGitExecutable, resolveRepoRoot: h.resolveRepoRoot, cwdOf: h.cwdOf, now: h.now })
        const check: any = ms[1].createDiagnosticsCheck({ failPhone: h.failPhone, firstLine: h.firstLine, failureFromExec: h.failureFromExec, runPinned: h.runPinned, resolveGitExecutable: h.resolveGitExecutable, resolveRepoRoot: h.resolveRepoRoot, cwdOf: h.cwdOf, now: h.now })
        const write: any = ms[2].createDiagnosticsWrite({ failPhone: h.failPhone, failureFromExec: h.failureFromExec, runPinned: h.runPinned, resolveGitExecutable: h.resolveGitExecutable, measure: check.measure, now: h.now, tickets: check.tickets, results: check.results })
        return { read: read.handleGitDiagnosticsRead, check: check.handleGitDiagnosticsCheck, write: write.handleGitDiagnosticsWrite, tickets: check.tickets }
      }).catch(function (e: any): any {
        const message: string = '诊断页三条电话那一族加载失败：' + String((e && (e as any).message) || e)
        const failed: any = function (): any { return h.failPhone('env', message) }
        return { read: failed, check: failed, write: failed, tickets: async function (): Promise<any> { return null } }
      })
    }
    return assembling
  }

  return {
    read: h.loggedPhone('wf.gitDiagnosticsRead', 'git-diagnostics-read', function (args: any): any { return phones().then(function (p: any) { return p.read(args) }) }),
    check: h.loggedPhone('wf.gitDiagnosticsCheck', 'git-diagnostics-check', function (args: any): any { return phones().then(function (p: any) { return p.check(args) }) }),
    write: h.loggedPhone('wf.gitDiagnosticsWrite', 'git-diagnostics-write', function (args: any): any { return phones().then(function (p: any) { return p.write(args) }) }),
    tickets: async function (): Promise<any> { const p: any = await phones(); return p.tickets || null },
  }
}
