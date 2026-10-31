/**
 * src/host/versionControlRebaseMount.ts —— 变基待办页（#1749 T14）四片宿主的装配壳
 *
 * 为什么单独一层：src/host/versionControl.ts 已贴着文件行数上限，装配代码再往里堆会把
 * 「一个文件只做一件事」压破。本层只做装配，不含业务判定：
 *   - 同一个读数（versionControlRebaseScene.ts）交给预检与执行两边，保证「预检看到的是执行时重算的」；
 *   - 同一张票据表与 requestId 结果表穿给预检和执行，预检签的票执行才找得到；
 *   - 同一个临时文件服务交给读层与执行层：预演 --autosquash 要临时收下 git 生成的待办，
 *     执行变基要把面板的待办覆盖过去，两处用的是同一套「普通临时文件、0600、用完就删」。
 *   - 三条电话都按 loggedPhone 口径包装（host.call / host.call.fail），失败一律给明确信封。
 *
 * 约定：本层懒加载，第一次打电话才去加载四片；装配失败不静默——电话回明确失败并说明原因。
 */
// @ts-expect-error 本域 tsconfig 有意不加载 Node 类型包（types 为空）；运行时一定是 Node，这些内建模块必然存在。
import { writeFile as fsWriteFile, readFile as fsReadFile, unlink as fsUnlink } from 'node:fs/promises'
// @ts-expect-error 同上：一次性临时文件放系统临时目录，不落仓库目录。
import { tmpdir as osTmpdir } from 'node:os'

/**
 * 临时文件服务：只在系统临时目录下建普通文件（0600），路径每次带随机段。
 * 规格第 8 节规定宿主给 git 的标准输入除 fast-import 外一律 ignore，所以待办与改说明的
 * 正文都走「临时文件 + 编辑器变量」，不往 stdin 里塞。
 */
function createTmpService(): any {
  function dirOf(): string { return String(osTmpdir() || '').replace(/[\\/]+$/, '') }
  return {
    write: async function (text: any): Promise<any> {
      const dir: string = dirOf()
      if (dir === '') return { ok: false, message: '系统临时目录不可用' }
      const abs: string = dir + '/dsh-vc-rebase-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1e9)) + '.txt'
      try { await fsWriteFile(abs, String(text === undefined || text === null ? '' : text), { mode: 0o600, encoding: 'utf8' }); return { ok: true, path: abs } } catch (e) { return { ok: false, message: String(((e as any) && (e as any).message) || (e as any)) } }
    },
    read: async function (abs: any): Promise<any> {
      try { return { ok: true, text: String(await fsReadFile(String(abs || ''), 'utf8')) } } catch (e) { return { ok: false, message: String(((e as any) && (e as any).message) || (e as any)) } }
    },
    remove: async function (abs: any): Promise<any> {
      try { await fsUnlink(String(abs || '')) } catch (e) { /* 删不掉不影响业务结论，下一次拿新文件 */ }
    },
  }
}

/**
 * 装配变基待办页的三条电话。host 由 src/host/versionControl.ts 按名传入（见该文件尾部装配行），
 * 这里只挑自己用得到的那些转给叶子，避免叶子直接摸到整个宿主对象。
 */
export function createRebaseMount(host: any): any {
  const h: any = host || {}
  const tmp: any = createTmpService()
  let assembling: any = null

  function phones(): Promise<any> {
    if (assembling) return assembling
    assembling = Promise.all([
      import('./versionControlRebaseScene.js'),
      import('./versionControlRebaseCheck.js'),
      import('./versionControlRebaseWrite.js'),
    ]).then(function (ms: any): any {
      const scene: any = ms[0].createRebaseScene({
        failPhone: h.failPhone,
        firstLine: h.firstLine,
        failureFromExec: h.failureFromExec,
        runPinned: h.runPinned,
        resolveGitExecutable: h.resolveGitExecutable,
        resolveRepoRoot: h.resolveRepoRoot,
        readScreenOf: h.readScreenOf,
        tmp: tmp,
        now: h.now,
      })
      const check: any = ms[1].createRebaseCheck({ scene: scene, failPhone: h.failPhone, now: h.now, randomId: h.randomId })
      const write: any = ms[2].createRebaseWrite({
        failPhone: h.failPhone,
        runPinned: h.runPinned,
        resolveGitExecutable: h.resolveGitExecutable,
        measure: scene.measure,
        scene: scene,
        now: h.now,
        tickets: check.tickets,
        results: check.results,
        tmp: tmp,
      })
      return { read: check.handleRebaseRead, check: check.handleRebaseCheck, write: write.handleRebaseWrite, tickets: check.tickets }
    }).catch(function (e: any): any {
      const said: string = String((e && e.message) || e)
      const bad: any = async function (): Promise<any> { return h.failPhone('env', '变基待办这一层装配失败：' + said) }
      return { read: bad, check: bad, write: bad, tickets: async function (): Promise<any> { return null } }
    })
    return assembling
  }

  return {
    read: h.loggedPhone('wf.gitRebaseRead', 'git-rebase-read', function (args: any): any { return phones().then(function (p: any) { return p.read(args) }) }),
    check: h.loggedPhone('wf.gitRebaseCheck', 'git-rebase-check', function (args: any): any { return phones().then(function (p: any) { return p.check(args) }) }),
    write: h.loggedPhone('wf.gitRebaseWrite', 'git-rebase-write', function (args: any): any { return phones().then(function (p: any) { return p.write(args) }) }),
    /** 票据表只给门禁与测试读取，不注册成电话：客户端拿不到它。 */
    tickets: async function (): Promise<any> { const p: any = await phones(); return p.tickets || null },
  }
}
