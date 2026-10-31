// src/host/versionControlPlatformRead.ts —— 平台与边界页的三条只读电话（#1762 T26）
//
// 三条电话各管一件事，都不改仓库：
//   - read：只读本机配置里的凭据助手链与 rebase.updateRefs（规格第 1 节永久例外二：面板只展示
//     助手链，绝不读、不存、不落盘令牌；8.15 只读；5.9 说明的检测输入）。
//   - requestPull：调用只读的 git request-pull 生成一段说明文本（14.3）。
//   - patchFiles：列 14.1 的输出目录里有哪些补丁文件（读目录，不读文件内容）。
//
// 约定：
//   1) 读配置时 exitCode===1 是「没设置」而不是失败（git config 未命中就回 1）——这不是错误，
//      不能把「没配置」画成红色失败；其它非零才按失败上报，并带 git 原话首行。
//   2) request-pull 的参数只用共享层 platform-inspect 的 vcRequestPullArgsOf 拼 argv，宿主与界面
//      同一份守卫；输出被截断要如实说截断，不给半份。
//   3) 列目录用 deps.fs.resolve + deps.fs.listDir（宿主文件服务的标准用法）；目录不存在回
//      {ok:true, exists:false, patches:[]}，列表为空与目录缺失分得清。
//   4) 三条电话共用父文件的固定前缀与报闸：进程只走 runPinned，不自己起进程。

import { vcCredentialHelpersOf, vcCredentialRiskOf, vcUpdateRefsOf, vcRequestPullArgsOf, vcPatchSummaryOf } from '../shared/version-control/src/platform-inspect.js'
import { VC_CHANGES_READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** request-pull 的 stdout 上限：一段说明文本，256KB 足够；超了算截断。 */
const RP_STDOUT_LIMIT: number = 256 * 1024

export function createPlatformReadPhones(deps: any): any {
  const runPinned: any = deps.runPinned
  const failPhone: any = deps.failPhone
  const firstLine: any = deps.firstLine
  const failureFromExec: any = deps.failureFromExec
  const resolveGitExecutable: any = deps.resolveGitExecutable
  const resolveRepoRoot: any = deps.resolveRepoRoot
  const cwdOf: any = deps.cwdOf
  const fs: any = deps.fs
  const fsAbsence: any = deps.fsAbsence
  const nowMs: any = typeof deps.now === 'function' ? deps.now : Date.now
  const DEFAULT_CWD: any = deps.DEFAULT_CWD

  function fail(kind: string, reason: string, message: string, extra?: any): any {
    return { ok: false, error: { kind: kind, reason: reason, message: message, hint: deps.writeHintFor ? deps.writeHintFor(reason) : '' } }
  }

  async function prepared(args: any): Promise<any> {
    const a: any = args && typeof args === 'object' ? args : {}
    const cwd: any = cwdOf(a)
    const exe: any = await resolveGitExecutable()
    if (!exe) return { ok: false, error: failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const rootReply: any = await resolveRepoRoot(exe, cwd)
    if (!rootReply || rootReply.ok !== true) return { ok: false, error: rootReply }
    return { ok: true, exe: exe, cwd: cwd, root: String(rootReply.root || cwd) }
  }

  /** 跑一条只读 git 配置查询：exitCode 1 回 {set:false}，别的非零按失败。 */
  async function readConfig(prep: any, argv: string[]): Promise<any> {
    const res: any = await runPinned(prep.exe, prep.root, argv, { stdoutLimit: 64 * 1024, timeoutMs: VC_CHANGES_READ_TIMEOUT_MS })
    if (res && res.kind === 'ok') return { ok: true, set: String(res.stdout || '').trim() !== '', text: String(res.stdout || '') }
    if (res && res.kind === 'non-zero' && res.exitCode === 1) return { ok: true, set: false, text: '' }
    const failed: any = failureFromExec(res, '读 git 配置')
    return { ok: false, error: failed || failPhone('other', '读 git 配置失败') }
  }

  /** 平台页读取：凭据助手链 + rebase.updateRefs。两个查询各自成败分明，一个失败不连坐另一个。 */
  async function read(args: any): Promise<any> {
    const prep: any = await prepared(args)
    if (!prep.ok) return prep
    const helpers: any = await readConfig(prep, ['config', '--null', '--get-all', 'credential.helper'])
    const update: any = await readConfig(prep, ['config', '--get', 'rebase.updateRefs'])
    const helperValues: string[] = helpers.ok ? vcCredentialHelpersOf(helpers.text) : []
    const risk: any = vcCredentialRiskOf(helperValues)
    const refs: any = vcUpdateRefsOf(update.ok ? update.text : '')
    return {
      ok: true,
      readAtMs: nowMs(),
      repoRoot: prep.root,
      credential: {
        helpers: helperValues,
        store: risk.storeHelper,
        risk: risk.risk,
        advice: risk.advice,
        state: helpers.ok ? 'ok' : 'error',
        error: helpers.ok ? null : { kind: (helpers.error && helpers.error.kind) || 'other', message: (helpers.error && helpers.error.message) || '' },
      },
      updateRefs: {
        value: refs.value,
        enabled: refs.enabled,
        state: update.ok ? 'ok' : 'error',
        error: update.ok ? null : { kind: (update.error && update.error.kind) || 'other', message: (update.error && update.error.message) || '' },
      },
    }
  }

  /** 14.3 request-pull：只读，生成说明文本；截断与失败都如实说。 */
  async function requestPull(args: any): Promise<any> {
    const a: any = args && typeof args === 'object' ? args : {}
    const built: any = vcRequestPullArgsOf({ start: a.start, url: a.url, end: a.end })
    if (!built.ok) return fail('args', built.reason, built.message)
    const prep: any = await prepared(a)
    if (!prep.ok) return prep
    const t0: number = nowMs()
    const res: any = await runPinned(prep.exe, prep.root, built.args, { stdoutLimit: RP_STDOUT_LIMIT, timeoutMs: VC_CHANGES_READ_TIMEOUT_MS })
    const ms: number = Math.max(0, nowMs() - t0)
    if (!res || res.kind !== 'ok') {
      const failed: any = failureFromExec(res, '生成请求拉取说明')
      return failed || fail('other', 'request-pull-failed', 'git request-pull 没有成功')
    }
    if (res.truncated === true) return fail('truncated', 'truncated', 'request-pull 输出太长被截断，不给你半份；换更短的区间再试')
    return { ok: true, text: String(res.stdout || ''), truncated: false, ms: ms, cmd: 'request-pull', range: String(a.start || '') }
  }

  /** 14.1 输出目录：列出补丁文件（只读名字，不读内容）。 */
  async function patchFiles(args: any): Promise<any> {
    const a: any = args && typeof args === 'object' ? args : {}
    const prep: any = await prepared(a)
    if (!prep.ok) return prep
    const dirIn: string = String(a.dir === undefined || a.dir === null ? 'patches' : a.dir).trim() || 'patches'
    const dir: string = /^([A-Za-z]:[\\/]|[\\/])/.test(dirIn) ? dirIn : String(prep.root).replace(/[\\/]+$/, '') + '/' + dirIn.replace(/^[\\/]+/, '')
    let entries: any = null
    try {
      const target: any = fs && typeof fs.resolve === 'function' ? await fs.resolve(dir) : dir
      entries = await fs.listDir(target)
    } catch (e) {
      const absence: any = fsAbsence && typeof fsAbsence === 'function' ? await fsAbsence() : null
      const absent: boolean = !!(absence && typeof absence.isAbsenceError === 'function' && absence.isAbsenceError(e))
      if (absent) return { ok: true, dir: dir, exists: false, patches: [], others: 0, total: 0, truncated: false, readAtMs: nowMs() }
      return fail('env', 'env', '输出目录列不出来：' + firstLine(String(((e as any) && (e as any).message) || e)))
    }
    const summary: any = vcPatchSummaryOf(entries)
    return { ok: true, dir: dir, exists: true, patches: summary.patches, others: summary.others, total: summary.total, truncated: summary.truncated, readAtMs: nowMs() }
  }

  return { read: read, requestPull: requestPull, patchFiles: patchFiles }
}
