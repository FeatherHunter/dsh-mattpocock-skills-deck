// host/versionControlConflictMount.ts —— 冲突向导（#1747 T12，规格域 6）的装配壳
//
// 为什么单独一层：父文件 versionControl.ts 已经顶到 350 有效行的上限，这里只做「懒加载 + 注入依赖 + 包日志」。
// 三片按需加载（读数 → 预检 → 执行），执行片共用预检片的同一张票表与结果表——重放与票校验的口径只在一处。
// 约定：加载失败一律回明确失败（不抛），tickets 只给门禁与测试读，不注册电话（客户端拿不到票表）。
export function createConflictMount(host: any): any {
  const h: any = host || {}
  let assembling: any = null
  function pieces(): Promise<any> {
    if (!assembling) {
      assembling = Promise.all([import('./versionControlConflictScene.js'), import('./versionControlConflictCheck.js'), import('./versionControlConflictWrite.js')]).then(function (mods: any[]) {
        const scene: any = mods[0].createConflictScene(h)
        const check: any = mods[1].createConflictCheck({ scene: scene, failPhone: h.failPhone, now: h.now, randomId: h.randomId })
        const write: any = mods[2].createConflictWrite({ failPhone: h.failPhone, runPinned: h.runPinned, resolveGitExecutable: h.resolveGitExecutable, measure: scene.measure, scene: scene, now: h.now, tickets: check.tickets, results: check.results })
        return { scene: scene, check: check, write: write }
      }).catch(function (e: any) {
        const said: string = String((e && e.message) || e)
        const fail: any = async function (): Promise<any> { return h.failPhone('env', '冲突向导这一层装配失败：' + said) }
        return { scene: null, check: { handleConflictCheck: fail, handleConflictRead: fail, tickets: new Map(), results: new Map() }, write: { handleConflictWrite: fail, tickets: new Map(), results: new Map() } }
      })
    }
    return assembling
  }
  async function tickets(): Promise<any> { const p: any = await pieces(); return (p.check && p.check.tickets) ? p.check.tickets : null }
  return {
    read: h.loggedPhone('wf.gitConflicts', 'git-conflicts', function (args: any): Promise<any> { return pieces().then(function (p: any) { return p.check.handleConflictRead(args) }) }),
    check: h.loggedPhone('wf.gitConflictCheck', 'git-conflict-check', function (args: any): Promise<any> { return pieces().then(function (p: any) { return p.check.handleConflictCheck(args) }) }),
    write: h.loggedPhone('wf.gitConflictWrite', 'git-conflict-write', function (args: any): Promise<any> { return pieces().then(function (p: any) { return p.write.handleConflictWrite(args) }) }),
    tickets: tickets,
  }
}

export const CONFLICT_MOUNT_SOURCE = 'src/host/versionControlConflictMount.ts'
