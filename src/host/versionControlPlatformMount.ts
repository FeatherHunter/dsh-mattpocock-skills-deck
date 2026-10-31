// src/host/versionControlPlatformMount.ts —— 平台段五条电话的装配壳（#1762 T26）
//
// 与 #1742 改动页的装配壳同一形状：父文件 src/host/versionControl.ts 贴着 350 有效行上限，
// 「懒加载、加载失败兜底、loggedPhone 日志包装」三件事搬到这里，父文件只留一行装配调用。
//
// 约定：
//   1) 两个执行层叶子（versionControlPlatform.ts 与 versionControlPlatformRead.ts）第一次拨电话
//      才动态载入，宿主启动不加载平台段；载入失败回明确失败信封，不让电话永远挂起。
//   2) 五条电话都用父文件递进来的 loggedPhone 包一层，事件仍是 host.call / host.call.fail。
//   3) tickets 只给门禁与测试读票据表，不包 loggedPhone，也不注册成电话。

/** 把宿主依赖接成平台段五条电话与一张票据表。 */
export function createPlatformMount(host: any): any {
  let assembling: any = null
  function phones(): Promise<any> {
    if (!assembling) {
      assembling = Promise.all([import('./versionControlPlatform.js'), import('./versionControlPlatformRead.js')]).then(function (ms: any): any {
        const tickets: any = ms[0].createPlatformTicketPhones(host)
        const reads: any = ms[1].createPlatformReadPhones(host)
        return { check: tickets.check, run: tickets.run, tickets: tickets.tickets, read: reads.read, requestPull: reads.requestPull, patchFiles: reads.patchFiles }
      }).catch(function (e: any): any {
        const message: string = '平台段那一族加载失败：' + String((e && e.message) || e)
        const failed: any = function (): any { return host.failPhone('env', message) }
        return { check: failed, run: failed, tickets: new Map(), read: failed, requestPull: failed, patchFiles: failed }
      })
    }
    return assembling
  }

  async function tickets(): Promise<any> {
    const p: any = await phones()
    return p.tickets || null
  }

  function wired(method: string, kind: string, pick: any): any {
    return host.loggedPhone(method, kind, function (args: any): Promise<any> {
      return phones().then(function (p: any): any { return pick(p)(args) })
    })
  }

  return {
    check: wired('wf.gitPlatformCheck', 'git-platform-check', function (p: any): any { return p.check }),
    run: wired('wf.gitPlatformRun', 'git-platform-run', function (p: any): any { return p.run }),
    read: wired('wf.gitPlatformRead', 'git-platform-read', function (p: any): any { return p.read }),
    requestPull: wired('wf.gitRequestPull', 'git-request-pull', function (p: any): any { return p.requestPull }),
    patchFiles: wired('wf.gitPatchFiles', 'git-patch-files', function (p: any): any { return p.patchFiles }),
    tickets: tickets,
  }
}
