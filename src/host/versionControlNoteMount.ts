// 门禁归属: tests/verify-1903-history-entries.ts
/**
 * src/host/versionControlNoteMount.ts —— 提交备注两条电话的装配壳（#1903，能力 3.12）
 *
 * 为什么单独成一层：父文件 src/host/versionControl.ts 贴着文件粒度门禁的 350 有效行上限，
 * 而「懒加载、加载失败兜底、loggedPhone 日志包装」这三件事与备注本身无关。
 * 照 #1748 历史改写那一片的同一先例搬出来（versionControlUndoMount.ts）。
 *
 * 约定（改了会坏的地方）：
 *   1) 业务叶子只在第一次拨电话时才动态载入；载入失败回明确失败信封，不让电话挂起；
 *   2) 预检与执行共用同一张票表与同一张 requestId 结果表 —— 票只留在宿主进程内存里；
 *   3) 同一份宿主依赖只装配一次并缓存：每次拨电话都新建一份的话，票表会被换掉，
 *      「预检签的票」在执行时就成了查无此票；
 *   4) 本层不写任何业务判定：输入校验、票据复核、argv 拼装都在叶子里。
 */

/** 已经装配好的那一份（按宿主依赖对象认：同一个宿主只装配一次）。 */
let CACHED: any = null
let CACHED_HOST: any = null

/** 装配一份电话集合；同一份宿主依赖反复调用回的是同一个对象（票表因此不会丢）。 */
export function notePhonesOf(host: any): any {
  if (CACHED !== null && CACHED_HOST === host) return CACHED
  CACHED_HOST = host
  let phonesP: any = null
  function phones(): Promise<any> {
    if (!phonesP) {
      phonesP = import('./versionControlNote.js').then(function (m: any): any {
        return m.createNotePhones({
          failPhone: host.failPhone,
          runPinned: host.runPinned,
          resolveGitExecutable: host.resolveGitExecutable,
          resolveRepoRoot: host.resolveRepoRoot,
          cwdOf: host.cwdOf,
          nowMs: host.now,
          randomId: function (): string { return Math.random().toString(36).slice(2) },
        })
      }).catch(function (e: any): any {
        const message: string = '提交备注那一族加载失败：' + String((e && e.message) || e)
        const fail: any = function (): any { return host.failPhone('env', message) }
        return { check: fail, write: fail, tickets: new Map(), results: new Map() }
      })
    }
    return phonesP
  }
  CACHED = {
    handleGitNoteCheck: host.loggedPhone('wf.gitNoteCheck', 'git-note-check', function (args: any): Promise<any> {
      return phones().then(function (p: any): any { return p.check(args) })
    }),
    handleGitNoteWrite: host.loggedPhone('wf.gitNoteWrite', 'git-note-write', function (args: any): Promise<any> {
      return phones().then(function (p: any): any { return p.write(args) })
    }),
    // 只给门禁与测试读票表（与 #1741 writeTickets 同一条口径：不注册成电话，客户端拿不到）。
    noteTickets: function (): Promise<any> { return phones().then(function (p: any): any { return p.tickets || null }) },
  }
  return CACHED
}

/** 票表的单独出口（父文件按需加载时只想要这一份）。 */
export function noteTicketsOf(host: any): Promise<any> {
  return notePhonesOf(host).noteTickets()
}

export const NOTE_MOUNT_SOURCE = 'src/host/versionControlNoteMount.ts'
