// 长任务通道与宿主唯一标准输入窄例外的接线叶子（#1740）：把运行器、任务库与执行层三块拼起来，
// 向入口暴露三条电话，并接住 fast-import 那条只读文件流例外。
//
// 三块各自的边：
//   1. 任务库（versionControlTaskStore）只认注入的 fs 门面与缓存目录，自己不解析路径；
//   2. 运行器（versionControlTaskRun）不自己起进程，命令拼装来自 task-protocol，进程出口是这里的
//      launchTaskGit（固定前缀、GIT_EDITOR、-C 钉仓库、报闸、字节上限与增量读都在这里）；
//   3. 这个叶子把宿主 fs 门面适配成任务库要的形状（fs 服务的读写要求先 resolve 出 target），
//      并在首次调用时把上一进程留下的在途记录标成中断。
//
// 为什么标准输入的文件核对也住这里：整份规格里只有 fast-import 需要标准输入，而它有两个入口——
// 普通写命令走 versionControl.ts 的 runGit，长任务走本文件的 launchTaskGit。文件核对（普通文件、
// 大小、摘要）只有这一份实现，两个入口都从这里取；两个文件都不许再写第二份尺寸/摘要判据。
//
// 三条不能改的约定：
//   - 任务记录只落缓存目录，不落仓库工作区；参数原文与输入文件内容不进记录文件；
//   - 运行器同一个进程只建一次（在途表只有一份，重建会把在途任务当成不存在）；
//   - 任何装配失败都回固定失败信封，不让入口抛出未处理异常（面板要能打开、能看见原因）。

import { failPhone, firstLine } from '../shared/version-control/exec-envelope.js'
import { fixedPrefix, subcommandOf, nonInteractiveGitEnv } from '../shared/version-control/src/commands.js'
import { createTaskStore } from './versionControlTaskStore.js'
import { createTaskRunner } from './versionControlTaskRun.js'
import { VC_TASK_POLL_INTERVAL_MS, VC_TASK_CANCEL_GRACE_MS, VC_TASK_HARD_KILL_MS, PROC_GRACE_MS } from '../shared/time-config/src/values.js'
// 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node，这些内建模块必然存在。
// @ts-expect-error
import { lstat as fsLstat, readFile as fsReadFile } from 'node:fs/promises'
// @ts-expect-error
import { isAbsolute as pathIsAbsolute } from 'node:path'
// @ts-expect-error
import { createHash as cryptoCreateHash } from 'node:crypto'

// 查询进度的节奏：太密会白读收集器，太稀会让界面上的百分比一跳一大段。值住中央 YAML。
export const TASK_POLL_MS: number = Math.max(100, Number(VC_TASK_POLL_INTERVAL_MS) || 400)
const TASK_FILE_KEY = 'tasks'
// 任务文件只留最近二十条：任务区一屏放得下，再多也没有人回头看。
const TASK_KEEP = 20

/**
 * 任务库要的 fs 形状：读写前先 resolve 出 fs 服务的 target 对象（直接传路径字符串会被拒绝），
 * 四个方法都对不存在与不可读做兜底——任务记录坏了最多丢一条，不许让面板打不开。
 */
function makeFsFace(face: any): any {
  async function targetOf(p: string): Promise<any> {
    if (face && typeof face.resolve === 'function') return await face.resolve(p)
    return p
  }
  return {
    async exists(p: string): Promise<boolean> {
      try { return !!(await face.exists(await targetOf(p))) } catch (e) {
        try { return !!(await face.exists(p)) } catch (e2) { return false }
      }
    },
    async readText(p: string): Promise<string> {
      const target = await targetOf(p)
      return String((await face.readText(target)) || '')
    },
    async writeText(p: string, text: string): Promise<void> {
      const target = await targetOf(p)
      await face.writeText(target, text)
    },
    async mkdir(p: string): Promise<void> {
      if (!face || typeof face.mkdir !== 'function') return
      try { await face.mkdir(await targetOf(p), { recursive: true }) } catch (e) {
        try { await face.mkdir(p) } catch (e2) { /* 已存在或不可建，写文件时会再报一次并被任务库兜住 */ }
      }
    },
  }
}

/** 取缓存目录（宿主 getCacheDir 是异步口）；拿不到就回空串——任务库写盘会失败，但内存里照常可用。 */
async function cacheDirOf(deps: any): Promise<string> {
  try {
    const dir = await Promise.resolve(typeof deps.getCacheDir === 'function' ? deps.getCacheDir() : null)
    return typeof dir === 'string' ? dir : ''
  } catch (e) { return '' }
}

/** 路径守卫：只收绝对路径、不许含 NUL、不许出现 .. 段。返回空串表示通过，否则返回给人看的理由。
 *  为什么连 .. 也挡：票据把路径绑成了字符串，repo/../outside 与 outside 是同一份文件，
 *  只做「开头是不是绝对路径」的检查会让路径比较失去意义。 */
function stdinPathProblem(p: any): string {
  if (typeof p !== 'string' || !p) return '路径为空或不是字符串'
  if (p.indexOf('\u0000') >= 0) return '路径里含 NUL'
  if (!pathIsAbsolute(p)) return '不是绝对路径'
  const segments: string[] = p.split(/[\\/]+/)
  if (segments.indexOf('..') >= 0) return '路径里含 .. 段'
  return ''
}

/** 打开 fast-import 的只读输入文件并核对票据绑定的「普通文件、大小、摘要」三件事。
 *  任何一项不符都在起进程之前给明确失败（零进程）；读文件留到最后，读出来再按字节数复核一次，
 *  防「查 stat 之后文件被换掉」这种小窗口。 */
export async function prepareStdinFile(spec: any): Promise<any> {
  if (!spec || typeof spec !== 'object') return { ok: false, reason: 'bad-spec', message: 'stdinFile 必须给出 path、sizeBytes 与 sha256' }
  const problem: string = stdinPathProblem(spec.path)
  if (problem) return { ok: false, reason: 'bad-path', message: problem }
  const sizeBytes: any = spec.sizeBytes
  const sha256: string = (typeof spec.sha256 === 'string') ? spec.sha256.toLowerCase() : ''
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) return { ok: false, reason: 'bad-spec', message: 'sizeBytes 必须是非负整数' }
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, reason: 'bad-spec', message: 'sha256 必须是 64 位十六进制摘要' }
  let st: any
  try { st = await fsLstat(spec.path) } catch (e) {
    const code: string = (e && (e as any).code) ? String((e as any).code) : ''
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, reason: 'missing-file', message: 'stdinFile 指向的文件不存在' }
    return { ok: false, reason: 'unreadable', message: '读不了 stdinFile 的文件信息：' + String(((e as any) && (e as any).message) || e) }
  }
  // lstat：符号链接本身不是普通文件，不收（否则「路径绑定」可以绕过成任意目标）。
  if (!st || typeof st.isFile !== 'function' || !st.isFile()) return { ok: false, reason: 'not-regular-file', message: 'stdinFile 只收普通文件' }
  if (st.size !== sizeBytes) return { ok: false, reason: 'size-mismatch', message: '文件大小与票据绑定的不一致（实际 ' + st.size + '，票据 ' + sizeBytes + '）' }
  let bytes: any
  try { bytes = await fsReadFile(spec.path) } catch (e) { return { ok: false, reason: 'unreadable', message: '读不了 stdinFile 的文件内容：' + String(((e as any) && (e as any).message) || e) } }
  if (bytes.length !== sizeBytes) return { ok: false, reason: 'size-mismatch', message: '读出来的字节数与票据绑定的不一致（实际 ' + bytes.length + '，票据 ' + sizeBytes + '）' }
  const actual: string = cryptoCreateHash('sha256').update(bytes).digest('hex')
  if (actual !== sha256) return { ok: false, reason: 'digest-mismatch', message: '文件摘要与票据绑定的不一致（实际 ' + actual.slice(0, 16) + '…，票据 ' + sha256.slice(0, 16) + '…）' }
  return { ok: true, bytes: bytes }
}

/** 造长任务的进程出口：固定前缀、钉死目录、非交互环境、报闸、字节上限与增量读收集器全在这一趟里。
 *  依赖（subprocess / timer / resolveGitExecutable / reportOutbound / readCollector / dirHash / fire 等）
 *  全部由入口显式传入，与 versionControl.ts 的 runGit 同一套字段口径；本文件不反向引用父文件。 */
export function makeLaunchTaskGit(d: any, pollMs: number): any {
  return async function launchTaskGit(options: any): Promise<any> {
    const resolved: any = await d.resolveGitExecutable()
    if (!resolved) return { ok: false, kind: 'spawn-failed', message: '找不到 git 可执行文件（platform.resolveExecutable("git") 没有给出路径）' }
    const dir: string = String((options && options.cwd) || d.repoRoot || '')
    const args: string[] = Array.isArray(options && options.args) ? options.args : []
    const argv: string[] = [resolved, '-C', dir].concat(fixedPrefix(), args)
    const wantStdin: boolean = !!(options && options.stdinBytes)
    // 非交互：GIT_EDITOR 设成必失败命令（规格第 7 节），终端提示与 askpass 一并关死，长任务不许卡在等输入。
    const childEnv: any = nonInteractiveGitEnv()
    d.reportOutbound()
    let handle: any
    try {
      handle = d.subprocess.spawn({
        argv: argv,
        cwd: dir,
        stdio: { stdin: wantStdin ? 'pipe' : 'ignore', stdout: { maxBytes: d.stdoutLimit }, stderr: { maxBytes: d.stderrLimit } },
        graceMs: PROC_GRACE_MS,
        env: childEnv,
      })
    } catch (e) {
      d.fire('warn', 'git.exec.fail', { argv0: d.gitName, cwdHash: d.dirHash(dir), via: d.via, cmd: subcommandOf(args), errorKind: 'spawn' })
      return { ok: false, kind: 'spawn-failed', message: String(((e as any) && (e as any).message) || (e as any)) }
    }
    const state: any = { stopped: false, outOff: 0, errOff: 0, outText: '', errText: '', outLossy: false, errLossy: false, stdinError: null }
    const onLine: any = (options && typeof options.onLine === 'function') ? options.onLine : null
    function takeChunk(kind: any): void {
      try {
        const collector: any = handle && handle.collected ? handle.collected[kind] : null
        if (!collector || typeof collector.readFrom !== 'function') return
        const offKey: string = kind === 'stdout' ? 'outOff' : 'errOff'
        const textKey: string = kind === 'stdout' ? 'outText' : 'errText'
        const lossyKey: string = kind === 'stdout' ? 'outLossy' : 'errLossy'
        const chunk: any = collector.readFrom(state[offKey]) || {}
        if (typeof chunk.nextOffset === 'number') state[offKey] = chunk.nextOffset
        if (typeof chunk.text === 'string' && chunk.text) {
          state[textKey] += chunk.text
          if (onLine) {
            const lines: string[] = chunk.text.split(/\r?\n/)
            for (let i: number = 0; i < lines.length; i++) { const line: string = lines[i]; if (line.trim()) onLine(line) }
          }
        }
        if (chunk.lossy === true) state[lossyKey] = true
      } catch (e) { /* 读收集器失败不影响任务本身 */ }
    }
    function pump(): void { takeChunk('stdout'); takeChunk('stderr') }
    function loop(): void {
      if (state.stopped) return
      pump()
      try { Promise.resolve(d.timer.timeout(pollMs)).then(loop).catch(function (): void {}) } catch (e) {}
    }
    if (wantStdin) {
      const sink: any = handle && handle.stdin ? handle.stdin : null
      if (!sink || typeof sink.write !== 'function') {
        try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch (eT) {}
        d.fire('warn', 'git.exec.fail', { argv0: d.gitName, cwdHash: d.dirHash(dir), via: d.via, cmd: subcommandOf(args), errorKind: 'stdin' })
        return { ok: false, kind: 'stdin-failed', message: '这条传输层服务不支持给 git 送标准输入，fast-import 跑不了' }
      }
      try {
        if (typeof sink.on === 'function') sink.on('error', function (e: any): void {
          state.stdinError = { kind: (e && e.code === 'EPIPE') ? 'epipe' : 'stdin-write-failed' }
          try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch (eT) {}
        })
      } catch (eOn) {}
      try {
        sink.write(options.stdinBytes)
        if (typeof sink.end === 'function') sink.end()
      } catch (eW) {
        const code: string = (eW && (eW as any).code) ? String((eW as any).code) : ''
        state.stdinError = { kind: code === 'EPIPE' ? 'epipe' : 'stdin-write-failed' }
        try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch (eT) {}
      }
    }
    loop()
    const finalDone: Promise<any> = Promise.resolve(handle.done).then(function (outcome: any): any {
      state.stopped = true
      pump()
      // 没有增量读能力的收集器（别家实现或测试假身）在结束时一次取全文；有增量读的已经在 pump 里读完。
      try {
        const so: any = handle && handle.collected ? handle.collected.stdout : null
        const se: any = handle && handle.collected ? handle.collected.stderr : null
        const noStream: boolean = !(so && typeof so.readFrom === 'function')
        if (noStream) {
          const o: any = d.readCollector(so)
          const r: any = d.readCollector(se)
          if (o.text) state.outText += o.text
          if (r.text) state.errText += r.text
          if (o.truncated || r.truncated) state.outLossy = true
        }
      } catch (eR) {}
      return {
        exitCode: (outcome && typeof outcome.exitCode === 'number') ? outcome.exitCode : null,
        signalled: !!(outcome && outcome.signal),
        stdout: state.outText,
        stderr: state.errText,
        truncated: state.outLossy || state.errLossy,
        stdinError: state.stdinError ? state.stdinError : null,
      }
    }, function (): any {
      state.stopped = true
      return { exitCode: null, signalled: false, stdout: state.outText, stderr: state.errText, truncated: state.outLossy || state.errLossy, stdinError: state.stdinError }
    })
    return {
      ok: true,
      handle: {
        done: finalDone,
        terminate: function (): void { try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch (eT) {} },
        stdin: handle.stdin,
      },
      stdinError: state.stdinError,
    }
  }
}

/** 把执行层与通道装配成三条带日志的电话：父文件只把宿主依赖递进来，
 *  再用同一个 loggedPhone 收口（成功落 host.call、失败落 host.call.fail，与其余电话同口径）。 */
export function createTaskPhones(deps: any): any {
  const d: any = deps || {}
  const now: any = typeof d.now === 'function' ? d.now : Date.now
  const channel: any = createTaskChannel({
    fs: d.fs,
    getCacheDir: d.getCacheDir,
    timer: d.timer,
    now: now,
    hash8: d.hash8,
    instanceId: 'vc-' + d.hash8(String(now()) + ':' + Math.random()),
    repoRoot: d.repoRoot,
    fire: d.fire,
    prepareStdinFile: prepareStdinFile,
    launch: makeLaunchTaskGit(d, TASK_POLL_MS),
  })
  const logged: any = typeof d.loggedPhone === 'function' ? d.loggedPhone : function (_method: any, _kind: any, fn: any): any { return fn }
  return {
    handleGitTaskStart: logged('wf.gitTaskStart', 'git-task-start', channel.handleGitTaskStart),
    handleGitTaskQuery: logged('wf.gitTaskQuery', 'git-task-query', channel.handleGitTaskQuery),
    handleGitTaskCancel: logged('wf.gitTaskCancel', 'git-task-cancel', channel.handleGitTaskCancel),
  }
}

export function createTaskChannel(deps: any): any {
  const d = deps || {}
  let runnerP: Promise<any> | null = null
  function runner(): Promise<any> {
    if (!runnerP) {
      runnerP = (async function (): Promise<any> {
        const dir = await cacheDirOf(d)
        const store = createTaskStore({ fs: makeFsFace(d.fs), dir: dir, fileKey: TASK_FILE_KEY, now: d.now, limit: TASK_KEEP })
        const r = createTaskRunner({
          store: store,
          launch: d.launch,
          prepareStdinFile: d.prepareStdinFile,
          timer: d.timer,
          now: d.now,
          hash8: d.hash8,
          instanceId: d.instanceId,
          repoRoot: d.repoRoot,
          fire: d.fire,
          // 软取消宽限与强杀等待值住中央 YAML；下限兜住配置写坏时变成 0 的情况。
          graceMs: Math.max(1000, Number(VC_TASK_CANCEL_GRACE_MS) || 5000),
          hardKillMs: Math.max(500, Number(VC_TASK_HARD_KILL_MS) || 2000),
        })
        // 上一进程留下的在途记录在这里统一标成中断：只做一次，标完不会再变。
        await r.resumeInterrupted()
        return r
      })()
      runnerP.catch(function (): void { runnerP = null })
    }
    return runnerP
  }
  async function call(method: string, args: any): Promise<any> {
    try {
      const r: any = await runner()
      return await r[method](args)
    } catch (e) {
      return failPhone('env', '长任务通道装配失败：' + firstLine(String(((e as any) && (e as any).message) || (e as any))))
    }
  }
  return {
    // 三条电话：开始、查询、取消。会话工作区由调用方给 cwd；没给就用宿主默认目录（与写命令同一口径）。
    handleGitTaskStart: function (args: any): Promise<any> { return call('start', args) },
    handleGitTaskQuery: function (args: any): Promise<any> { return call('query', args) },
    handleGitTaskCancel: function (args: any): Promise<any> { return call('cancel', args) },
  }
}

export default createTaskChannel
