/**
 * src/host/versionControlChanges.ts —— 改动页（规格域 1）两条电话的装配叶子（#1742）
 *
 * 为什么单独一份：src/host/versionControl.ts 早已贴着文件行数上限，再往里堆装配代码会把
 * 「一个文件只做一件事」这条拆文件纪律压破。本叶子只做装配，不含任何业务判定：
 *   - 同一个首屏读数（readScreenOf）交给预检与执行两边，保证「预检看到的就是执行时复核的」；
 *   - 同一个进程出口（固定前缀、-C 钉仓库、报闸、字节上限、git.exec 日志）由 versionControl.ts 注入；
 *   - 同一套 loggedPhone 口径（host.call / host.call.fail）包两条电话；
 *   - 改动页自己的票据表与 requestId 结果表住在本叶子闭包里，只活在宿主进程内存，不落盘。
 *
 * 本叶子还需要三件「宿主进程才知道怎么办」的能力，全部由装配处传入，自己不去猜环境：
 *   1. 读仓库内文本文件（仓库根 .gitignore）；
 *   2. 覆写仓库内文本文件（只用于追加忽略行）；
 *   3. 把一段补丁写成 0600 普通临时文件并在执行后删掉——规格第 8 节规定宿主给 git 的标准输入
 *      除 fast-import 外一律 ignore，逐块暂存只能走临时补丁文件这条路；路径不进票据、不进日志。
 */
// @ts-expect-error 本域 tsconfig 有意不加载 Node 类型包（types 为空）；运行时一定是 Node，这些内建模块必然存在。
import { writeFile as fsWriteFile, unlink as fsUnlink } from 'node:fs/promises'
// @ts-expect-error 同上：系统临时目录只用来放一次性的补丁文件。
import { tmpdir as osTmpdir } from 'node:os'
// @ts-expect-error 同上：票据绑定表用 sha256 的前 16 位十六进制做摘要，不把原文带进票据。
import { createHash as cryptoCreateHash } from 'node:crypto'

/** 拼仓库内相对路径：git 在 Windows 上也认正斜杠，这里统一用正斜杠，避免两处写法算出两个路径。 */
function joinRepo(root: any, rel: any): string { return String(root || '').replace(/[\\/]+$/, '') + '/' + String(rel || '') }

/** 摘要：票据绑定表只用这 16 位十六进制，够区分「同一块/同一份清单」且不把原文带进票据。 */
function digest16Of(text: any): string { try { return cryptoCreateHash('sha256').update(String(text === undefined || text === null ? '' : text), 'utf8').digest('hex').slice(0, 16) } catch (e) { return '0000000000000000' } }

/**
 * 造改动页两条电话：预检（发票）与执行（凭票写）。
 * 装配处（versionControl.ts）把进程出口与首屏读数传进来；这里只负责把同一批依赖分给两个叶子，
 * 并保证两边拿到的是同一张票据表——预检签的票，执行必须能在同一张表里找到。
 */
export function createChangesPhone(deps: any): Promise<any> {
  const d: any = deps || {}
  const fs: any = d.fs
  const failPhone: any = d.failPhone
  const fsAbsence: any = d.fsAbsence
  const resolveGitExecutable: any = d.resolveGitExecutable
  const runGit: any = d.runGit
  const fixedPrefix: any = d.fixedPrefix
  const pathExists: any = d.pathExists
  const readScreenOf: any = d.readScreenOf
  const loggedPhone: any = d.loggedPhone
  const DEFAULT_CWD: any = d.DEFAULT_CWD
  const timeoutMs: any = (typeof d.timeoutMs === 'number' && d.timeoutMs > 0) ? d.timeoutMs : 20000
  const STDOUT_LIMIT: number = (typeof d.STDOUT_LIMIT === 'number' && d.STDOUT_LIMIT > 0) ? d.STDOUT_LIMIT : 8 * 1024 * 1024
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now

  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()

  /** 读仓库内一个相对路径的文本文件：缺失与读不了分开回，调用方按 reason 决定是「还没有这份文件」还是真失败。 */
  async function readTextFile(root: any, rel: any): Promise<any> {
    if (!fs || typeof fs.readText !== 'function' || typeof fs.resolve !== 'function') return { ok: false, reason: 'unreadable', message: '文件服务不可用，读不了这个文件' }
    const abs: string = joinRepo(root, rel)
    let target: any
    try { target = await fs.resolve(abs) } catch (e) {
      try { if ((await fsAbsence()).isAbsenceError(e)) return { ok: false, reason: 'missing' } } catch (eA) {}
      return { ok: false, reason: 'unreadable', message: String(((e as any) && (e as any).message) || (e as any)) }
    }
    try { const txt: any = await fs.readText(target); return { ok: true, text: String(txt === undefined || txt === null ? '' : txt) } } catch (e) {
      try { if ((await fsAbsence()).isAbsenceError(e)) return { ok: false, reason: 'missing' } } catch (eA) {}
      return { ok: false, reason: 'unreadable', message: String(((e as any) && (e as any).message) || (e as any)) }
    }
  }

  /** 覆写仓库内一个相对路径的文本文件（本票只用于仓库根 .gitignore）：先 resolve 再写，失败如实回。 */
  async function writeTextFile(root: any, rel: any, text: any): Promise<any> {
    if (!fs || typeof fs.writeText !== 'function' || typeof fs.resolve !== 'function') return { ok: false, error: { message: '文件服务不可用，写不了这个文件' } }
    const abs: string = joinRepo(root, rel)
    try { const target: any = await fs.resolve(abs); await fs.writeText(target, String(text)); return { ok: true } } catch (e) { return { ok: false, error: { message: String(((e as any) && (e as any).message) || (e as any)) } } }
  }

  /** 把一块补丁写成 0600 的普通临时文件：只落在系统临时目录下，名字带随机段，调用方执行完立刻删。 */
  async function writeTempPatch(text: any): Promise<any> {
    const dir: string = String(osTmpdir() || '').replace(/[\\/]+$/, '')
    if (dir === '') return { ok: false, message: '系统临时目录不可用' }
    const abs: string = dir + '/dsh-vc-patch-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1e9)) + '.patch'
    try { await fsWriteFile(abs, String(text), { mode: 0o600, encoding: 'utf8' }); return { ok: true, path: abs } } catch (e) { return { ok: false, message: String(((e as any) && (e as any).message) || (e as any)) } }
  }

  /** 删临时补丁文件：删不掉不影响已经跑完的写命令，下一次预检会重新生成内容。 */
  async function deleteFile(abs: any): Promise<any> { try { await fsUnlink(String(abs || '')) } catch (e) { /* 不抛：临时文件清理失败不改变业务结论 */ } }

  /** 改动页叶子用的命令出口：与读电话同一条固定前缀、同一个 -C 钉仓库、同一条报闸与日志。 */
  async function readChangesGit(cwd: any, argv: any, opts?: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { kind: 'spawn-failed', message: '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）' }
    const dir: string = String(cwd || DEFAULT_CWD || '')
    const args: string[] = Array.isArray(argv) ? argv : []
    return runGit(exe, dir, ['-C', dir].concat(fixedPrefix(), args), { stdoutLimit: (opts && opts.stdoutLimit) || STDOUT_LIMIT, timeoutMs: (opts && opts.timeoutMs) || timeoutMs })
  }

  /** 查仓库内一个相对路径在不在：转成绝对路径交给 #858 那条三路探测。 */
  async function relPathExists(cwd: any, rel: any): Promise<any> { return pathExists(joinRepo(cwd, rel)) }

  return Promise.all([import('./versionControlChangesCheck.js'), import('./versionControlChangesWrite.js')]).then(function (ms: any): any {
    const c: any = ms[0].createChangesCheck({ readScreenOf: readScreenOf, runRead: readChangesGit, readTextFile: readTextFile, pathExists: relPathExists, failPhone: failPhone, nowMs: nowFn, randomId: function (): string { return Math.random().toString(36).slice(2) }, digest16: digest16Of, tickets: tickets, results: results })
    const w: any = ms[1].createChangesWrite({ readScreenOf: readScreenOf, runCommand: readChangesGit, readTextFile: readTextFile, writeTextFile: writeTextFile, writeTempPatch: writeTempPatch, deleteFile: deleteFile, nowMs: nowFn, digest16: digest16Of, tickets: tickets, results: results })
    return {
      check: loggedPhone('wf.gitChangesCheck', 'git-changes-check', c.handleChangesCheck),
      write: loggedPhone('wf.gitChangesWrite', 'git-changes-write', w.handleChangesWrite),
      tickets: tickets,
      results: results,
    }
  })
}
