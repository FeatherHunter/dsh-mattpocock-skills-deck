/**
 * src/host/versionControlDiagnosticsRead.ts —— 诊断页十三条只读查询的执行叶子（#1761 T25）
 *
 * 为什么单独一份：src/host/versionControl.ts 贴着有效行上限，查询明细不能往父文件里堆。
 * 本叶子只做三件事：按共享层给出的计划跑一条只读命令、把输出解析成界面能画的形状、失败照统一信封回。
 *
 * 只读纪律（规格第 8 节）：每条命令的 argv 都来自 diagnosticsReadPlanOf（参数白名单在那里），
 * 这里不再拼字符串、不读标准输入、不加固定前缀（前缀与 -C 钉仓库在注入的 runPinned 里）。
 * 13.12「应用补丁」只跑 git apply --check 做预演：补丁原文落一个临时文件，预演完立刻删掉，
 * 绝不真实应用；临时路径不进票据、不进日志。
 */
// @ts-expect-error 本域 tsconfig 有意不加载 Node 类型包（types 为空）；运行时一定是 Node，这些内建模块必然存在。
import { writeFile as fsWriteFile, unlink as fsUnlink } from 'node:fs/promises'
// @ts-expect-error 同上：系统临时目录只用来放一次性的补丁文件。
import { tmpdir as osTmpdir } from 'node:os'
import { diagnosticsReadPlanOf, diagnosticsBisectStateOf, diagnosticsTrailersOf, diagnosticsReplaceListOf } from '../shared/version-control/src/diagnostics-commands.js'
import { VC_DIAGNOSTICS_READ_TIMEOUT_MS as READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 只读查询单条命令的输出上限兜底：共享层给计划时已带 limit，这里只在老调用方没带时用。 */
const READ_LIMIT: number = 2 * 1024 * 1024

function linesOf(text: any): string[] {
  const t: string = String(text === undefined || text === null ? '' : text).replace(/\r\n/g, '\n')
  return t === '' ? [] : t.split('\n')
}

/** 5.12 替换清单与 13.x 的分隔输出都用 NUL；这里只做「按行/按 NUL 切」这件小事，解析口径在共享层。 */
function delimitedRows(text: any, per: number): string[][] {
  const parts: string[] = String(text === undefined || text === null ? '' : text).split('\u0000')
  const rows: string[][] = []
  for (let i: number = 0; i + per - 1 < parts.length; i += per) rows.push(parts.slice(i, i + per))
  return rows
}

/** 造诊断页只读电话：装配处递进进程出口与宿主依赖，这里不自己起进程、不读环境。 */
export function createDiagnosticsReadPhone(deps: any): any {
  const d: any = deps || {}
  const failPhone: any = d.failPhone
  const firstLine: any = d.firstLine
  const failureFromExec: any = d.failureFromExec
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const resolveRepoRoot: any = d.resolveRepoRoot
  const cwdOf: any = d.cwdOf
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now

  /** 找到 git 与仓库根：所有查询都钉在同一个仓库上，换目录不会偷偷换仓库。 */
  async function baseOf(cwd: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { ok: false, fail: failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const root: any = await resolveRepoRoot(exe, cwd)
    if (!root || root.ok !== true) return { ok: false, fail: root }
    return { ok: true, exe: exe, root: String(root.root) }
  }

  /** 13.12：补丁只做预演。写成临时文件是因为宿主给 git 的标准输入一律 ignore（规格第 8 节）。 */
  async function applyCheckOf(base: any, plan: any): Promise<any> {
    const stamp: string = String(Date.now()) + '-' + Math.random().toString(36).slice(2)
    const file: string = String(osTmpdir()).replace(/[\\/]+$/, '') + '/dsh-vc-applycheck-' + stamp + '.patch'
    try {
      await fsWriteFile(file, String(plan.patch || ''), { encoding: 'utf8', mode: 0o600 })
      const res: any = await runPinned(base.exe, base.root, ['apply', '--check', file], { stdoutLimit: READ_LIMIT, timeoutMs: READ_TIMEOUT_MS })
      if (res && res.kind === 'non-zero') return { ok: true, kind: 'apply-check', mode: 'check', atMs: nowFn(), clean: false, exitCode: Number(res.exitCode), gitSays: firstLine(res.stderr), args: ['apply', '--check', '<临时补丁文件>'] }
      const bad: any = failureFromExec(res, '预演这个补丁这一步')
      if (bad) return bad
      if (res.truncated) return failPhone('truncated', '补丁预演的输出超过上限被截断，结论不可信')
      return { ok: true, kind: 'apply-check', mode: 'check', atMs: nowFn(), clean: true, exitCode: 0, gitSays: '', args: ['apply', '--check', '<临时补丁文件>'] }
    } catch (e) {
      return failPhone('env', '补丁文件写不进系统临时目录：' + firstLine(String((e && (e as any).message) || e)))
    } finally {
      try { await fsUnlink(file) } catch (eDel) { /* 删不掉不影响结论；临时目录本来会被系统清理 */ }
    }
  }

  /** 把一条命令的输出翻成界面要的数据；每种查询一种形状，界面不再自己解析文本。 */
  function payloadOf(kind: string, plan: any, res: any): any {
    const stdout: string = String((res && res.stdout) || '')
    const exitCode: number = res && typeof res.exitCode === 'number' ? res.exitCode : 0
    if (kind === 'bisect-status') {
      const st: any = diagnosticsBisectStateOf(stdout)
      return { active: st.active, bad: st.bad, good: st.good, firstBad: st.firstBad, log: stdout }
    }
    if (kind === 'grep') {
      const matches: any[] = []
      const rows: string[] = linesOf(stdout)
      for (let i: number = 0; i < rows.length; i += 1) {
        const m: any = /^(.+?):(\d+):(.*)$/.exec(rows[i])
        if (m) matches.push({ path: m[1], line: Number(m[2]), text: m[3] })
      }
      return { matchCount: matches.length, matches: matches }
    }
    if (kind === 'ls-files') return { paths: String(stdout).split('\u0000').filter(function (p: string) { return p !== '' }) }
    if (kind === 'cat-file') {
      if (plan.mode === 'type') return { objectType: String(stdout).trim() }
      return { text: stdout }
    }
    if (kind === 'ls-tree') {
      const list: string[] = linesOf(stdout)
      const rows: any[] = []
      for (let i: number = 0; i < list.length; i += 1) {
        const m: any = /^(\d+) (\w+) ([0-9a-f]+)\s+(\S+)\t(.*)$/.exec(list[i])
        if (m) rows.push({ mode: m[1], type: m[2], oid: m[3], size: m[4], path: m[5] })
      }
      return { rows: rows }
    }
    if (kind === 'rev-parse') {
      const oid: string = String(stdout).trim()
      return oid === '' ? { missing: true, oid: null } : { missing: false, oid: oid }
    }
    if (kind === 'for-each-ref') {
      const rows: any[] = []
      const groups: string[][] = delimitedRows(stdout, 3)
      for (let i: number = 0; i < groups.length; i += 1) rows.push({ ref: groups[i][0], oid: groups[i][1], subject: groups[i][2] })
      return { rows: rows }
    }
    if (kind === 'is-ancestor') return { isAncestor: exitCode === 0 }
    if (kind === 'cherry') {
      const list: string[] = linesOf(stdout)
      const rows: any[] = []
      for (let i: number = 0; i < list.length; i += 1) {
        const m: any = /^([+\-=*]) ([0-9a-fA-F]+) (.*)$/.exec(list[i])
        if (m) rows.push({ marker: m[1], oid: m[2], subject: m[3] })
      }
      return { rows: rows }
    }
    if (kind === 'rev-list') {
      if (plan.mode === 'left-right') {
        const parts: string[] = String(stdout).trim().split(/\s+/)
        return { left: Number(parts[0]) || 0, right: Number(parts[1]) || 0 }
      }
      return { count: Number(String(stdout).trim()) || 0 }
    }
    if (kind === 'trailers') {
      const parsed: any = diagnosticsTrailersOf(stdout)
      return { trailers: parsed.trailers, lines: parsed.lines }
    }
    return { replaces: diagnosticsReplaceListOf(stdout) }
  }

  /** 13.2–13.13 + 5.12 的读侧：一次调用只跑一条命令，回包里带上那次真的 argv（门禁与诊断都据它核对）。 */
  async function handleGitDiagnosticsRead(args: any): Promise<any> {
    const a: any = args || {}
    const kind: string = String(a.kind || '')
    const planRes: any = diagnosticsReadPlanOf(kind, a.params || {})
    if (!planRes || planRes.ok !== true) return failPhone('args', '这条诊断查询的参数不合法：' + String((planRes && planRes.message) || '未知原因'))
    const plan: any = planRes.plan
    const cwd: any = cwdOf(a)
    const base: any = await baseOf(cwd)
    if (!base.ok) return base.fail
    if (kind === 'apply-check') return applyCheckOf(base, plan)
    const allowNonZero: boolean = kind === 'bisect-status' || (kind === 'rev-parse') || (kind === 'is-ancestor') || (kind === 'grep')
    const res: any = await runPinned(base.exe, base.root, plan.args, { stdoutLimit: plan.limit || READ_LIMIT, timeoutMs: READ_TIMEOUT_MS })
    if (res && res.kind === 'non-zero' && allowNonZero) {
      const out: any = { ok: true, kind: kind, atMs: nowFn(), args: plan.args }
      return Object.assign(out, payloadOf(kind, plan, { stdout: '', exitCode: Number(res.exitCode) }))
    }
    const bad: any = failureFromExec(res, '这条诊断查询')
    if (bad) return bad
    if (res.truncated) return failPhone('truncated', '这次输出超过上限被截断了，换更窄的条件（加路径或换目标）再读')
    const out: any = { ok: true, kind: kind, atMs: nowFn(), args: plan.args }
    return Object.assign(out, payloadOf(kind, plan, res))
  }

  return { handleGitDiagnosticsRead: handleGitDiagnosticsRead }
}
